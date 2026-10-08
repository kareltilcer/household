// Package session is the web client's credential (FR-ID3, PRD 07 §4, D-7): a session cookie,
// __Host-hh_session, HttpOnly, Secure and SameSite=Lax, and beside it a CSRF token the page can
// read, __Host-hh_csrf, which every unsafe request sends back in X-CSRF-Token.
//
// A session is a row in sessions, found by the SHA-256 of the cookie's token: the token itself is
// only ever in the browser. The CSRF token is bound to its session the same way, so a request
// passes only with the very token its session was given, which a cookie planted from another
// site cannot supply; the header must match the readable cookie as well, the double submit the
// PRD names. An unsafe request the session cookie authenticates must also come from an origin on
// the allowlist, and an unsafe request that names any other origin is refused whatever it
// carries (Origins). Both refusals are 403 csrf_failed.
//
// A session lasts 30 days from its last use, with no limit on how long it may be kept in use
// (D-95), until it is revoked: by signing out, from the session list, by signing out
// everywhere, or by a password reset.
package session

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// The cookies and the header, as the contract names them.
const (
	Cookie     = "__Host-hh_session"
	CSRFCookie = "__Host-hh_csrf"
	CSRFHeader = "X-CSRF-Token"
)

// IdleTimeout is how long a session lasts from its last use (D-95).
const IdleTimeout = 30 * 24 * time.Hour

// touchEvery is how stale a session's last use may be before a request records a new one: a
// session slides forward at most once an hour, not with a write on every request.
const touchEvery = time.Hour

// maxUserAgent is the longest user agent a session keeps, in characters.
const maxUserAgent = 256

// Session is a live web session.
type Session struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	UserAgent  string
	CreatedAt  time.Time
	LastSeenAt time.Time
	ExpiresAt  time.Time
	csrfHash   []byte
}

// Tokens are a new session's two tokens, which only its cookies carry.
type Tokens struct {
	Session, CSRF string
}

// NewToken returns 256 random bits, URL-safe: a session's token, its CSRF token, or an email's
// link.
func NewToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b) // It never fails: the process ends first.
	return base64.RawURLEncoding.EncodeToString(b)
}

// Hash is the SHA-256 of a token, which is what a row keeps of it.
func Hash(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// Pool is the database a Store keeps sessions in, connected as the request role: it opens
// transactions, and reads a row outside one.
type Pool interface {
	tenant.Beginner
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Store reads and writes sessions.
type Store struct {
	pool    Pool
	origins *Origins
	log     *slog.Logger
	now     func() time.Time
}

// NewStore returns the sessions in pool's database. origins are those an unsafe request the
// session cookie authenticates may come from; log records a session that could not be read; now is
// the clock, time.Now when nil.
func NewStore(pool Pool, origins *Origins, log *slog.Logger, now func() time.Time) *Store {
	if now == nil {
		now = time.Now
	}
	return &Store{pool: pool, origins: origins, log: log, now: now}
}

// Now is the store's clock.
func (s *Store) Now() time.Time { return s.now() }

// Create starts a session for user in tx, from a browser whose user agent is userAgent, and
// returns its id and its tokens.
func (s *Store) Create(ctx context.Context, tx pgx.Tx, user uuid.UUID, userAgent string) (uuid.UUID, Tokens, error) {
	id, tokens, now := idgen.New(), Tokens{Session: NewToken(), CSRF: NewToken()}, s.now()
	_, err := tx.Exec(ctx, `
		INSERT INTO sessions (id, user_id, token_hash, csrf_hash, user_agent, created_at, last_seen_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
		id, user, Hash(tokens.Session), Hash(tokens.CSRF), cleanUserAgent(userAgent), now, now.Add(IdleTimeout))
	if err != nil {
		return uuid.Nil, Tokens{}, fmt.Errorf("session: create: %w", err)
	}
	return id, tokens, nil
}

// cleanUserAgent is a User-Agent header as a row keeps it: text PostgreSQL stores, with no
// control characters, and at most maxUserAgent characters.
func cleanUserAgent(ua string) string {
	ua = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.ToValidUTF8(ua, ""))
	if utf8.RuneCountInString(ua) > maxUserAgent {
		ua = string([]rune(ua)[:maxUserAgent])
	}
	return ua
}

// lookup returns the live session token opens, and false for none: no such session, or one that
// has been revoked or has expired. Every request a cookie signs in reads it, one row of a table
// that no row-level security guards, so it is one statement on the pool rather than a transaction,
// which would cost three more round trips.
func (s *Store) lookup(ctx context.Context, token string) (Session, bool, error) {
	var sess Session
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, user_agent, created_at, last_seen_at, expires_at, csrf_hash FROM sessions
		WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
		Hash(token), s.now()).Scan(&sess.ID, &sess.UserID, &sess.UserAgent, &sess.CreatedAt, &sess.LastSeenAt,
		&sess.ExpiresAt, &sess.csrfHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, false, nil
	}
	if err != nil {
		return Session{}, false, err
	}
	return sess, true, nil
}

// touch records a use of sess now, which pushes its expiry IdleTimeout on.
func (s *Store) touch(ctx context.Context, sess Session, now time.Time) error {
	return tenant.AccountTx(ctx, s.pool, sess.UserID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "UPDATE sessions SET last_seen_at = $2, expires_at = $3 WHERE id = $1 AND revoked_at IS NULL",
			sess.ID, now, now.Add(IdleTimeout))
		return err
	})
}

// RevokeToken ends the live session token opens, whoever's it is, in tx, and reports whether
// there was one.
func (s *Store) RevokeToken(ctx context.Context, tx pgx.Tx, token string) (bool, error) {
	tag, err := tx.Exec(ctx, "UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL",
		Hash(token), s.now())
	return tag.RowsAffected() > 0, err
}

// Live reports whether user's session id is still live in tx: a request it authenticated before a
// reset or signing out everywhere ended it may still be running.
func (s *Store) Live(ctx context.Context, tx pgx.Tx, user, id uuid.UUID) (bool, error) {
	var live bool
	err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > $3)",
		id, user, s.now()).Scan(&live)
	return live, err
}

// Revoke ends user's live session id in tx, and reports whether it had one.
func (s *Store) Revoke(ctx context.Context, tx pgx.Tx, user, id uuid.UUID) (bool, error) {
	now := s.now()
	tag, err := tx.Exec(ctx, `
		UPDATE sessions SET revoked_at = $3 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > $3`,
		id, user, now)
	return tag.RowsAffected() > 0, err
}

// RevokeAll ends every live session of user's but except, uuid.Nil for none, in tx.
func (s *Store) RevokeAll(ctx context.Context, tx pgx.Tx, user, except uuid.UUID) error {
	_, err := tx.Exec(ctx, "UPDATE sessions SET revoked_at = $3 WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
		user, except, s.now())
	return err
}

// List returns user's live sessions in tx, the most recently used first.
func (s *Store) List(ctx context.Context, tx pgx.Tx, user uuid.UUID) ([]Session, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, user_id, user_agent, created_at, last_seen_at, expires_at FROM sessions
		WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2
		ORDER BY last_seen_at DESC, id DESC`, user, s.now())
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Session, error) {
		var sess Session
		err := row.Scan(&sess.ID, &sess.UserID, &sess.UserAgent, &sess.CreatedAt, &sess.LastSeenAt, &sess.ExpiresAt)
		return sess, err
	})
}

type currentKey struct{}

// Current returns the session that authenticated ctx's request, and false when none did.
func Current(ctx context.Context) (uuid.UUID, bool) {
	id, ok := ctx.Value(currentKey{}).(uuid.UUID)
	return id, ok
}

// Authenticate is the middleware that signs a request in with its session cookie: the caller is
// the session's user, and the request's changes arrive via the web. An unsafe request must come
// from an allowed origin with its session's CSRF token, or it is refused 403 csrf_failed. A request
// with no cookie, or one that opens no live session, passes on with no caller, for a route that
// needs one to answer 401. A session in use is pushed forward, and its cookies with it.
func (s *Store) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(Cookie)
		if err != nil || c.Value == "" {
			next.ServeHTTP(w, r)
			return
		}
		ctx := r.Context()
		sess, ok, err := s.lookup(ctx, c.Value)
		if err != nil {
			s.log.LogAttrs(ctx, slog.LevelError, "session lookup failed", slog.Any("error", err))
			problem.Write(w, reqctx.RequestID(ctx), problem.Internal())
			return
		}
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		if !httpx.Safe(r.Method) && (!s.origins.fromAllowed(r) || !csrfMatches(r, sess)) {
			problem.Write(w, reqctx.RequestID(ctx), Refusal())
			return
		}
		if now := s.now(); now.Sub(sess.LastSeenAt) >= touchEvery {
			if err := s.touch(ctx, sess, now); err != nil {
				// The request goes on: the session is live, and the next request slides it.
				s.log.LogAttrs(ctx, slog.LevelWarn, "session touch failed", slog.Any("error", err))
			} else {
				SetCookies(w, Tokens{Session: c.Value, CSRF: cookieValue(r, CSRFCookie)})
			}
		}
		ctx = auth.WithUser(ctx, sess.UserID)
		ctx = mutation.WithVia(ctx, audit.ViaWeb)
		ctx = context.WithValue(ctx, currentKey{}, sess.ID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Refusal is the 403 csrf_failed problem.
func Refusal() *problem.Problem { return problem.New(http.StatusForbidden, problem.CodeCsrfFailed) }

// csrfMatches reports whether r carries sess's CSRF token, in its header and its cookie alike.
func csrfMatches(r *http.Request, sess Session) bool {
	header := r.Header.Get(CSRFHeader)
	cookie := cookieValue(r, CSRFCookie)
	if header == "" || cookie == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(header), []byte(cookie)) == 1 &&
		subtle.ConstantTimeCompare(Hash(header), sess.csrfHash) == 1
}

func cookieValue(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return c.Value
}

// SetCookies sets the session's two cookies on w, each lasting IdleTimeout. A CSRF token of "" is
// left as it is.
func SetCookies(w http.ResponseWriter, tokens Tokens) {
	maxAge := int(IdleTimeout.Seconds())
	http.SetCookie(w, &http.Cookie{Name: Cookie, Value: tokens.Session, Path: "/", MaxAge: maxAge,
		HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode})
	if tokens.CSRF != "" {
		// The page reads this one, to send it back in X-CSRF-Token: it is not HttpOnly by design.
		http.SetCookie(w, &http.Cookie{Name: CSRFCookie, Value: tokens.CSRF, Path: "/", MaxAge: maxAge, //nolint:gosec // G124: see above.
			Secure: true, SameSite: http.SameSiteLaxMode})
	}
}

// ClearCookies tells the browser to drop both cookies.
func ClearCookies(w http.ResponseWriter) {
	for _, name := range []string{Cookie, CSRFCookie} {
		http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", MaxAge: -1, //nolint:gosec // G124: the CSRF cookie is readable by design.
			HttpOnly: name == Cookie, Secure: true, SameSite: http.SameSiteLaxMode})
	}
}

// Origins is the allowlist of the origins the web client is served from.
type Origins struct {
	allowed map[string]bool
}

// NewOrigins returns the allowlist of origins, each scheme://host[:port], as a browser sends it
// in Origin.
func NewOrigins(origins ...string) (*Origins, error) {
	o := &Origins{allowed: map[string]bool{}}
	for _, raw := range origins {
		origin, ok := normalise(raw)
		if !ok {
			return nil, fmt.Errorf("session: %q is not an origin", raw)
		}
		o.allowed[origin] = true
	}
	return o, nil
}

// normalise returns raw as an origin compares, and false when it is not one. A scheme's default
// port is dropped, as a browser drops it from the Origin it sends.
func normalise(raw string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return "", false
	}
	host := strings.TrimSuffix(u.Host, ":")
	if port := u.Port(); (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
		host = strings.TrimSuffix(host, ":"+port)
	}
	return strings.ToLower(u.Scheme + "://" + host), true
}

// origin returns the origin r says it comes from: its Origin header, or failing that its Referer's,
// and "" when it names none.
func origin(r *http.Request) string {
	if o := r.Header.Get("Origin"); o != "" {
		return o
	}
	if ref, err := url.Parse(r.Header.Get("Referer")); err == nil && ref.Scheme != "" && ref.Host != "" {
		return ref.Scheme + "://" + ref.Host
	}
	return ""
}

// fromAllowed reports whether r names an origin on the list.
func (o *Origins) fromAllowed(r *http.Request) bool {
	origin, ok := normalise(origin(r))
	return ok && o.allowed[origin]
}

// Middleware refuses, 403 csrf_failed, an unsafe request from an origin not on the list: a page
// on another site, whose browser says so. A request that names no origin, which is not a
// browser's, passes, and the credential it carries decides.
func (o *Origins) Middleware(next http.Handler) http.Handler {
	return o.Admitting(func(*http.Request) string { return "" })(next)
}

// Admitting is Middleware for a router one of whose routes another site's page is meant to post
// to: foreign returns the origin r's route takes an unsafe request from beside the list's, and ""
// for every route that takes none. The route so named reads no session, since a request it admits
// is not the web client's own.
func (o *Origins) Admitting(foreign func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !httpx.Safe(r.Method) && origin(r) != "" && !o.fromAllowed(r) && !from(r, foreign(r)) {
				problem.Write(w, reqctx.RequestID(r.Context()), Refusal())
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// from reports whether r names admitted as its origin; never for an admitted that is none.
func from(r *http.Request, admitted string) bool {
	want, ok := normalise(admitted)
	if !ok {
		return false
	}
	got, ok := normalise(origin(r))
	return ok && got == want
}
