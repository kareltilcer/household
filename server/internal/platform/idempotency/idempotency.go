// Package idempotency makes a household's unsafe REST requests safe to repeat (PRD 01 §6; the
// contract's Idempotency-Key): a request that carries a key the caller has used in the last 7
// days gets the response the first one got, and its effect is not repeated.
//
// A key moves through three states in idempotency_keys. The middleware claims it, in_flight,
// before the handler runs. The mutation spine marks it committed in the transaction that
// commits the request's effect, so the key and the effect commit together or not at all. The
// middleware then stores the response, completed, which a repeat is answered with. What a repeat
// finds decides its answer:
//
//   - completed: the stored response.
//   - in_flight or committed: 409 idempotency_in_progress, while the first request is still
//     running. An in_flight claim older than the lease is taken for one whose request ended
//     without committing its effect, a process that died, so a repeat takes it over and runs;
//     the request it was taken from, should it still be running, can no longer commit, and is
//     answered 409 idempotency_in_progress itself (ErrClaimLost). A committed key whose
//     response never arrived, because the process died between the commit and the store, keeps
//     answering 409 until it expires: running the request again would repeat the effect, which
//     is the one thing the key exists to prevent.
//   - the key used for a different request: 422 validation_failed on header:Idempotency-Key.
//
// A response other than a 2xx is not stored, and the claim is released, so that a repeat runs
// the request again: a refusal commits no effect, and a refusal stored for 7 days would answer a
// retry after the reason had gone, a 402 after the payment, a 404 after the grant. A request
// answered so after its effect committed, by a second mutation that failed for instance, keeps
// its key committed, and a repeat is answered 409 as for a response that never arrived.
package idempotency

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Header is the request header that carries the key.
const Header = "Idempotency-Key"

const (
	// Retention is how long a key is kept: the contract's 7 days.
	Retention = 7 * 24 * time.Hour
	// Lease is how long a claim holds a key before a repeat may take it over, which only a
	// request that ended without committing its effect leaves behind. It is longer than any
	// request should run.
	Lease = 5 * time.Minute
	// maxStored caps the response body a key stores. A larger response is not stored, and its
	// key is released unless its effect committed.
	maxStored = 1 << 20
)

// storedHeaders are the response headers a key stores and a repeat is answered with: those
// that describe the representation. Set-Cookie is never among them.
var storedHeaders = []string{
	"Cache-Control", "Content-Language", "Content-Location", "Content-Type", "ETag", "Last-Modified",
	"Location", "X-Content-Type-Options",
}

// ErrClaimLost is Commit's answer for a request whose claim on its key was taken over by a
// repeat after the lease: the repeat is running the request, so this one must not commit. It is
// the 409 idempotency_in_progress problem, which a handler that answers with the error it got
// writes as it is: another request holds the key, and nothing on the server failed.
var ErrClaimLost error = problem.New(http.StatusConflict, problem.CodeIdempotencyInProgress)

type claimKey struct{}

// claim is a request's hold on its key.
type claim struct {
	household, user uuid.UUID
	key             string
	token           uuid.UUID
}

// Commit marks the key ctx's request holds as committed, in tx, the transaction that commits
// the request's effect: the mutation spine calls it in every mutation. It does nothing for a
// request that holds no key. It returns ErrClaimLost when the request no longer holds it, so
// that tx rolls back.
func Commit(ctx context.Context, tx pgx.Tx) error {
	c, ok := ctx.Value(claimKey{}).(claim)
	if !ok {
		return nil
	}
	tag, err := tx.Exec(ctx, `
		UPDATE idempotency_keys SET state = 'committed'
		WHERE household_id = $1 AND user_id = $2 AND key = $3 AND claim = $4 AND state <> 'completed'`,
		c.household, c.user, c.key, c.token)
	if err != nil {
		return fmt.Errorf("idempotency: mark the key committed: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrClaimLost
	}
	return nil
}

// Middleware makes the unsafe requests it serves that carry Idempotency-Key repeatable. Install
// it behind the tenant middleware and the module's gate, so that a caller who may no longer see
// a module is not answered from it; log records a failure to store or release a key. maxBody is
// the edge's cap on a JSON body (contract.Limits.MaxBody), which a JSON body read here is held
// to as well: the edge bounds the body of a request an operation matches, and this middleware
// also serves the requests none does, which the router then refuses. For the same reason it
// refuses a key the edge would, and answers a body that stops arriving as the edge does.
func Middleware(log *slog.Logger, maxBody int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := r.Header.Get(Header)
			scope := tenant.From(r.Context())
			if key == "" || safe(r.Method) || scope == nil {
				next.ServeHTTP(w, r)
				return
			}
			requestID := reqctx.RequestID(r.Context())
			if code, ok := unstorable(key); ok {
				problem.Write(w, requestID, problem.Validation(problem.FieldError{Field: "header:" + Header, Code: code}))
				return
			}
			fingerprint, err := fingerprintOf(w, r, maxBody)
			var tooLarge *http.MaxBytesError
			switch {
			case errors.As(err, &tooLarge):
				problem.Write(w, requestID, problem.New(http.StatusRequestEntityTooLarge, problem.CodePayloadTooLarge))
				return
			case errors.Is(err, os.ErrDeadlineExceeded):
				// The body did not arrive within its deadline (httpx.BodyDeadline), as the edge
				// treats it: a client that slow is not reading a response either.
				panic(http.ErrAbortHandler)
			case err != nil:
				// The client stopped sending the body it announced; the edge answers the same.
				problem.Write(w, requestID, problem.Validation(problem.FieldError{Field: "", Code: problem.FieldInvalid}))
				return
			}
			c := claim{household: scope.HouseholdID(), user: scope.UserID(), key: key, token: idgen.New()}
			held, found, err := take(r.Context(), c, fingerprint)
			switch {
			case err != nil:
				log.LogAttrs(r.Context(), slog.LevelError, "idempotency: claim the key", slog.Any("error", err))
				problem.Write(w, requestID, problem.Internal())
				return
			case !held:
				answer(w, requestID, found, fingerprint)
				return
			}

			rec := &recorder{ResponseWriter: w}
			completed := false
			defer func() {
				// A handler that panicked, or answered other than 2xx, committed nothing that a
				// repeat must not repeat, unless its effect committed; then the key stays
				// committed. The release outlives a request whose client has gone.
				if !completed {
					if err := release(context.WithoutCancel(r.Context()), c); err != nil {
						log.LogAttrs(r.Context(), slog.LevelError, "idempotency: release the key", slog.Any("error", err))
					}
				}
			}()
			next.ServeHTTP(rec, r.WithContext(context.WithValue(r.Context(), claimKey{}, c)))
			if rec.status() < 200 || rec.status() > 299 || rec.overflow {
				return
			}
			if err := store(context.WithoutCancel(r.Context()), c, rec); err != nil {
				log.LogAttrs(r.Context(), slog.LevelError, "idempotency: store the response", slog.Any("error", err))
				return
			}
			completed = true
		})
	}
}

// maxKeyLength is the longest key a row holds, in characters: the contract's maxLength.
const maxKeyLength = 128

// unstorable returns why key cannot be held, in the code the edge refuses the header with, and
// false for a key that can: bytes that are not UTF-8, or U+0000, which PostgreSQL does not store
// as text, are malformed, and a key longer than the contract allows fails max_length. The edge
// refuses both on an operation that declares the header, as every unsafe one does; this
// middleware also serves the requests no operation matches, whose headers the edge does not
// read, and the row would refuse such a key with a 500.
func unstorable(key string) (string, bool) {
	switch {
	case !utf8.ValidString(key) || strings.ContainsRune(key, 0):
		return problem.FieldMalformed, true
	case utf8.RuneCountInString(key) > maxKeyLength:
		return "max_length", true
	}
	return "", false
}

// safe reports whether method is one RFC 9110 calls safe, which repeats harmlessly anyway.
func safe(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodTrace:
		return true
	}
	return false
}

// fingerprintOf is what makes two requests the same request: the method, the path and query,
// the precondition, the media type and the body. A JSON body is read, up to maxBody bytes, and
// put back for the handler; on a request an operation matches, the edge has already read it
// into memory under the same cap. A body in another media type, an upload, is the handler's to
// stream and is not read here, so its length stands in for it.
func fingerprintOf(w http.ResponseWriter, r *http.Request, maxBody int64) ([]byte, error) {
	h := sha256.New()
	contentType := r.Header.Get("Content-Type")
	for _, part := range []string{r.Method, r.URL.EscapedPath(), r.URL.RawQuery, r.Header.Get("If-Match"), contentType} {
		_, _ = io.WriteString(h, part)
		_, _ = h.Write([]byte{0})
	}
	mediaType, _, _ := mime.ParseMediaType(contentType)
	isJSON := mediaType == "application/json" || strings.HasSuffix(mediaType, "+json")
	if r.Body == nil || r.Body == http.NoBody || !isJSON {
		_, _ = io.WriteString(h, strconv.FormatInt(r.ContentLength, 10))
		return h.Sum(nil), nil
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		return nil, err
	}
	_ = r.Body.Close()
	r.Body = io.NopCloser(bytes.NewReader(body))
	_, _ = h.Write(body)
	return h.Sum(nil), nil
}

// found is the row a request finds holding its key when it cannot take it.
type found struct {
	fingerprint []byte
	state       string
	status      int
	header      map[string]string
	body        []byte
}

// take claims c's key for c, unless another request holds it: a key that does not exist, one
// past its retention, and an in_flight claim past its lease for the same request are taken. It
// reports whether c holds the key and, when not, the row that does.
func take(ctx context.Context, c claim, fingerprint []byte) (bool, found, error) {
	var (
		held bool
		f    found
	)
	err := tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			INSERT INTO idempotency_keys (household_id, user_id, key, fingerprint, state, claim, claimed_at)
			VALUES ($1, $2, $3, $4, 'in_flight', $5, now())
			ON CONFLICT (household_id, user_id, key) DO UPDATE
			  SET fingerprint = excluded.fingerprint, state = 'in_flight', claim = excluded.claim,
			      claimed_at = now(), created_at = now(), status = NULL, header = NULL, body = NULL
			  WHERE idempotency_keys.created_at <= now() - make_interval(secs => $6)
			     OR (idempotency_keys.state = 'in_flight' AND idempotency_keys.claimed_at <= now() - make_interval(secs => $7)
			         AND idempotency_keys.fingerprint = excluded.fingerprint)
			RETURNING true`,
			c.household, c.user, c.key, fingerprint, c.token, Retention.Seconds(), Lease.Seconds()).Scan(&held)
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		var status *int
		var header []byte
		err = tx.QueryRow(ctx, `
			SELECT fingerprint, state::text, status, header, body FROM idempotency_keys
			WHERE household_id = $1 AND user_id = $2 AND key = $3`,
			c.household, c.user, c.key).Scan(&f.fingerprint, &f.state, &status, &header, &f.body)
		if errors.Is(err, pgx.ErrNoRows) {
			// The request that held the key released it since the claim was refused: this one is
			// answered as though it were still running, and a repeat takes the key.
			f = found{fingerprint: fingerprint, state: "in_flight"}
			return nil
		}
		if err != nil {
			return err
		}
		if status != nil {
			f.status = *status
		}
		if header != nil {
			return json.Unmarshal(header, &f.header)
		}
		return nil
	})
	return held, f, err
}

// answer answers a request that found its key held: the stored response, or why there is none.
func answer(w http.ResponseWriter, requestID string, f found, fingerprint []byte) {
	switch {
	case !bytes.Equal(f.fingerprint, fingerprint):
		problem.Write(w, requestID, problem.Validation(problem.FieldError{Field: "header:" + Header, Code: problem.FieldInvalid}))
	case f.state != "completed":
		problem.Write(w, requestID, problem.New(http.StatusConflict, problem.CodeIdempotencyInProgress))
	default:
		h := w.Header()
		for _, name := range storedHeaders {
			if v, ok := f.header[name]; ok {
				h.Set(name, v)
			}
		}
		// A 204 carries no body, and no Content-Length either (RFC 9110 §8.6), as the handler's
		// own 204 did not.
		if f.status != http.StatusNoContent {
			h.Set("Content-Length", strconv.Itoa(len(f.body)))
		}
		w.WriteHeader(f.status)
		_, _ = w.Write(f.body)
	}
}

// store records the response rec captured under c's key, which the request still holds.
func store(ctx context.Context, c claim, rec *recorder) error {
	header := map[string]string{}
	sent := rec.sent()
	for _, name := range storedHeaders {
		if v := sent.Get(name); v != "" {
			header[name] = v
		}
	}
	headerJSON, err := json.Marshal(header)
	if err != nil {
		return err
	}
	return tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE idempotency_keys SET state = 'completed', status = $5, header = $6, body = $7
			WHERE household_id = $1 AND user_id = $2 AND key = $3 AND claim = $4`,
			c.household, c.user, c.key, c.token, rec.status(), headerJSON, rec.body.Bytes())
		if err == nil && tag.RowsAffected() != 1 {
			err = ErrClaimLost
		}
		return err
	})
}

// release gives up c's key, unless its effect committed, when it stays committed: a repeat of a
// request whose effect committed must not run it again.
func release(ctx context.Context, c claim) error {
	return tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			DELETE FROM idempotency_keys
			WHERE household_id = $1 AND user_id = $2 AND key = $3 AND claim = $4 AND state = 'in_flight'`,
			c.household, c.user, c.key, c.token)
		return err
	})
}

// recorder passes a response through to the client and keeps a copy of it, up to maxStored
// bytes of body, for its key to store.
type recorder struct {
	http.ResponseWriter
	code     int
	header   http.Header
	body     bytes.Buffer
	overflow bool
}

// WriteHeader records the status and the headers as they go out: those of the final response,
// never an informational one (1xx other than 101) that net/http sends ahead of it.
func (r *recorder) WriteHeader(code int) {
	informational := code >= 100 && code <= 199 && code != http.StatusSwitchingProtocols
	if r.code == 0 && !informational {
		r.code = code
		r.header = r.ResponseWriter.Header().Clone()
	}
	r.ResponseWriter.WriteHeader(code)
}

// Write keeps a copy of b, until the copy would pass maxStored.
func (r *recorder) Write(b []byte) (int, error) {
	if r.code == 0 {
		r.WriteHeader(http.StatusOK)
	}
	if !r.overflow {
		if r.body.Len()+len(b) > maxStored {
			r.overflow = true
			r.body.Reset()
		} else {
			r.body.Write(b)
		}
	}
	return r.ResponseWriter.Write(b)
}

// Unwrap returns the writer it wraps, for http.NewResponseController.
func (r *recorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

// status is the status that went out: 200 for a response that wrote nothing, as net/http
// sends.
func (r *recorder) status() int {
	if r.code == 0 {
		return http.StatusOK
	}
	return r.code
}

// sent is the header that went out: for a response that wrote nothing, the handler's header as
// it stands once the handler has returned, which is what net/http then sends.
func (r *recorder) sent() http.Header {
	if r.code == 0 {
		return r.Header()
	}
	return r.header
}
