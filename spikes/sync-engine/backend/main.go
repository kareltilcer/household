// Command spikesync is the sync-engine spike's backend (plan item 5). Throwaway.
//
// It stands where Household's API will stand for either candidate engine:
//
//   - POST /token issues the HS256 token a client presents to PowerSync and to this backend,
//     with the user id as sub.
//   - POST /households/{household_id}/shopping/upload takes a batch of mutations, the shape of
//     PRD 03 §2.4, and applies each one through the real tenant middleware, grant check and
//     mutation spine on item 4's schema, answering applied or rejected with a code per
//     mutation. PowerSync's connector and the Electric harness's own outbox both call it.
//   - GET /households/{household_id}/shopping/shape proxies Electric's shape API, adding the
//     table and the where clause the caller may read: variant=gate checks the grant here and
//     answers 404 without it; variant=subquery lets Electric's where hold the grant through
//     subqueries, so that a revoked grant moves rows out of the shape.
package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/grant"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// secret is the HS256 key PowerSync's powersync.yaml holds as base64url.
var secret = []byte("household-spike-hs256-secret-not-a-real-key")

const (
	shopping = "shopping"
	entity   = "shopping.item"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	if err := run(log); err != nil {
		log.Error("spikesync failed", slog.Any("error", err))
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	ctx := context.Background()
	pool, err := db.Open(ctx, env("SPIKE_DATABASE_URL", "postgres://household_app:household_app@127.0.0.1:5442/household?sslmode=disable"), "spikesync")
	if err != nil {
		return err
	}
	defer pool.Close()
	reg, err := module.NewRegistry(shoppingModule{})
	if err != nil {
		return err
	}
	tenantMW, err := tenant.Middleware(tenant.Config{Pool: pool, Logger: log})
	if err != nil {
		return err
	}
	s := &server{electric: env("SPIKE_ELECTRIC_URL", "http://127.0.0.1:3010"), log: log}

	r := chi.NewRouter()
	r.Post("/token", s.token)
	r.Group(func(r chi.Router) {
		r.Use(authenticate, mutation.Catalog(reg))
		r.Route("/households/{household_id}", func(r chi.Router) {
			r.Use(tenantMW)
			r.Post("/shopping/upload", s.upload)
			r.Get("/shopping/shape", s.shape)
		})
	})
	addr := env("SPIKE_ADDR", "127.0.0.1:8091")
	log.Info("spikesync listening", slog.String("addr", addr))
	return (&http.Server{Addr: addr, Handler: r, ReadHeaderTimeout: 10 * time.Second}).ListenAndServe()
}

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

// shoppingModule declares the spike's one entity and its audit actions, as a module would.
type shoppingModule struct{}

func (shoppingModule) Name() string              { return shopping }
func (shoppingModule) Migrations() fs.FS         { return nil }
func (shoppingModule) RegisterRoutes(chi.Router) {}

func (shoppingModule) AuditActions() []module.AuditAction {
	return []module.AuditAction{
		{Key: "shopping.item.create", SummaryKey: "shopping.item.create"},
		{Key: "shopping.item.update", SummaryKey: "shopping.item.update"},
		{Key: "shopping.item.check", SummaryKey: "shopping.item.check"},
		{Key: "shopping.item.delete", SummaryKey: "shopping.item.delete"},
	}
}

func (shoppingModule) SyncEntities() []sync.Entity {
	return []sync.Entity{{
		Name: entity, Table: "shopping_items", Policy: sync.LWWField, Access: sync.Grant, OfflineWrites: true,
	}}
}

type server struct {
	electric string
	log      *slog.Logger
}

// --- tokens ----------------------------------------------------------------------------

func (s *server) token(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID uuid.UUID `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == uuid.Nil {
		http.Error(w, "user_id", http.StatusBadRequest)
		return
	}
	now := time.Now()
	expires := now.Add(time.Hour)
	tok, err := sign(map[string]any{"sub": body.UserID.String(), "aud": "powersync", "iat": now.Unix(), "exp": expires.Unix()})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": tok, "expires_at": expires.UTC().Format(time.RFC3339)})
}

var b64 = base64.RawURLEncoding

func sign(claims map[string]any) (string, error) {
	header, err := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT", "kid": "spike"})
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	unsigned := b64.EncodeToString(header) + "." + b64.EncodeToString(payload)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(unsigned))
	return unsigned + "." + b64.EncodeToString(mac.Sum(nil)), nil
}

// authenticate takes the caller from a Bearer token this backend signed.
func authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, err := verify(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		if err != nil {
			problem.Write(w, "", problem.New(http.StatusUnauthorized, problem.CodeUnauthenticated))
			return
		}
		next.ServeHTTP(w, r.WithContext(auth.WithUser(r.Context(), user)))
	})
}

func verify(tok string) (uuid.UUID, error) {
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		return uuid.Nil, errors.New("malformed")
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	got, err := b64.DecodeString(parts[2])
	if err != nil || !hmac.Equal(got, mac.Sum(nil)) {
		return uuid.Nil, errors.New("bad signature")
	}
	payload, err := b64.DecodeString(parts[1])
	if err != nil {
		return uuid.Nil, err
	}
	var claims struct {
		Sub string `json:"sub"`
		Exp int64  `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return uuid.Nil, err
	}
	if time.Now().Unix() >= claims.Exp {
		return uuid.Nil, errors.New("expired")
	}
	return uuid.Parse(claims.Sub)
}

// --- the write path --------------------------------------------------------------------

// mutationIn is one mutation of a pushed batch (PRD 03 §2.4), cut to what the spike needs.
type mutationIn struct {
	MutationID uuid.UUID      `json:"mutation_id"`
	Op         string         `json:"op"` // create, update, delete
	EntityID   uuid.UUID      `json:"entity_id"`
	Fields     map[string]any `json:"fields"`
	ClientTime time.Time      `json:"client_time"`
}

// outcome is its result: applied, with the row's version after it (unchanged when the
// mutation found its state already in place), or rejected with a code.
type outcome struct {
	MutationID uuid.UUID `json:"mutation_id"`
	Result     string    `json:"result"`
	Code       string    `json:"code,omitempty"`
	Version    int64     `json:"version,omitempty"`
	Noop       bool      `json:"noop,omitempty"`
}

type item struct {
	ID          uuid.UUID  `json:"id"`
	HouseholdID uuid.UUID  `json:"household_id"`
	Title       string     `json:"title"`
	Checked     bool       `json:"checked"`
	CheckedAt   *time.Time `json:"checked_at"`
	Version     int64      `json:"version"`
	DeletedAt   *time.Time `json:"deleted_at"`
}

const itemColumns = "id, household_id, title, checked, checked_at, version, deleted_at"

func scanItem(row pgx.Row) (item, error) {
	var it item
	err := row.Scan(&it.ID, &it.HouseholdID, &it.Title, &it.Checked, &it.CheckedAt, &it.Version, &it.DeletedAt)
	return it, err
}

var errGone = errors.New("the item is not there")

// upload applies a batch in order, each mutation in its own transaction, and answers every
// one: a rejected mutation does not stop the ones after it (FR-SY6).
func (s *server) upload(w http.ResponseWriter, r *http.Request) {
	ctx := mutation.WithVia(r.Context(), audit.ViaSync)
	var batch struct {
		Mutations []mutationIn `json:"mutations"`
	}
	if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
		problem.Write(w, "", problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed}))
		return
	}
	results := make([]outcome, 0, len(batch.Mutations))
	for _, m := range batch.Mutations {
		o := s.apply(ctx, m)
		s.log.Info("mutation", slog.String("user", mustUser(ctx)), slog.String("op", m.Op),
			slog.String("entity_id", m.EntityID.String()), slog.String("result", o.Result), slog.String("code", o.Code))
		results = append(results, o)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func mustUser(ctx context.Context) string {
	u, _ := auth.User(ctx)
	return u.String()
}

func (s *server) apply(ctx context.Context, m mutationIn) outcome {
	o := outcome{MutationID: m.MutationID}
	// A member who lost the module, or never had it, hears not_found (404, not 403); one who
	// can see it and may not write hears forbidden.
	if err := grant.Require(ctx, shopping, access.Contribute); err != nil {
		return reject(o, err)
	}
	household := tenant.From(ctx).HouseholdID()

	var it item
	res, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		var (
			action string
			err    error
		)
		switch m.Op {
		case "create":
			action = "item.create"
			title, _ := m.Fields["title"].(string)
			it, err = scanItem(tx.QueryRow(ctx,
				"INSERT INTO shopping_items (id, household_id, title) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING "+itemColumns,
				m.EntityID, household, title))
		case "update":
			action = "item.update"
			if checked, ok := m.Fields["checked"].(bool); ok {
				// state_set on (item), latest_client_time: the intent is the state it wants, and an
				// intent older than the one in place loses. A state already in place writes nothing.
				action = "item.check"
				it, err = scanItem(tx.QueryRow(ctx, `
					UPDATE shopping_items SET checked = $2, checked_at = $3
					WHERE id = $1 AND deleted_at IS NULL AND checked IS DISTINCT FROM $2
					  AND (checked_at IS NULL OR checked_at <= $3)
					RETURNING `+itemColumns, m.EntityID, checked, m.ClientTime))
			}
			if title, ok := m.Fields["title"].(string); ok && err == nil {
				// lww_field by server receipt.
				it, err = scanItem(tx.QueryRow(ctx, `
					UPDATE shopping_items SET title = $2
					WHERE id = $1 AND deleted_at IS NULL AND title IS DISTINCT FROM $2
					RETURNING `+itemColumns, m.EntityID, title))
			}
		case "delete":
			action = "item.delete"
			it, err = scanItem(tx.QueryRow(ctx,
				"UPDATE shopping_items SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING "+itemColumns, m.EntityID))
		default:
			return mutation.Record{}, problem.Validation(problem.FieldError{Field: "op", Code: problem.FieldMalformed})
		}
		if errors.Is(err, pgx.ErrNoRows) {
			// Nothing written: the state is already in place, or the item is not there to write.
			var live bool
			if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM shopping_items WHERE id = $1 AND deleted_at IS NULL)", m.EntityID).Scan(&live); err != nil {
				return mutation.Record{}, err
			}
			if !live && m.Op != "delete" {
				return mutation.Record{}, errGone
			}
			return mutation.Record{}, nil
		}
		if err != nil {
			return mutation.Record{}, err
		}
		change := sync.Change{Entity: entity, ID: it.ID, Op: sync.Upsert, Version: it.Version, Row: it}
		if m.Op == "delete" {
			change = sync.Change{Entity: entity, ID: it.ID, Op: sync.Delete, Version: it.Version}
		}
		return mutation.Record{
			Event: audit.Event{
				Module: shopping, Action: action, EntityType: entity, EntityID: it.ID,
				SummaryKey: "shopping." + action, SummaryArgs: map[string]any{"title": it.Title},
			},
			Changes: []sync.Change{change},
		}, nil
	})
	switch {
	case errors.Is(err, errGone):
		o.Result, o.Code = "rejected", "not_found"
	case err != nil:
		return reject(o, err)
	case res.EventID == uuid.Nil:
		o.Result, o.Noop = "applied", true
	default:
		o.Result, o.Version = "applied", it.Version
	}
	return o
}

func reject(o outcome, err error) outcome {
	o.Result = "rejected"
	var p *problem.Problem
	if errors.As(err, &p) {
		o.Code = string(p.Code)
	} else {
		o.Code = "internal: " + err.Error()
	}
	return o
}

// --- Electric ---------------------------------------------------------------------------

// shape proxies Electric's shape API for the caller, adding what they may read.
func (s *server) shape(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	household, user := scope.HouseholdID(), scope.UserID()
	q := url.Values{"table": {"shopping_items"}}
	for _, k := range []string{"offset", "handle", "live", "cursor"} {
		if v := r.URL.Query().Get(k); v != "" {
			q.Set(k, v)
		}
	}
	switch r.URL.Query().Get("variant") {
	case "subquery":
		q.Set("where", fmt.Sprintf(`household_id = '%[1]s' AND deleted_at IS NULL`+
			` AND household_id IN (SELECT household_id FROM module_enablement WHERE module = 'shopping' AND enabled)`+
			` AND (household_id IN (SELECT household_id FROM module_grants WHERE user_id = '%[2]s' AND module = 'shopping' AND level::text <> 'none')`+
			` OR household_id IN (SELECT household_id FROM memberships WHERE user_id = '%[2]s' AND role::text = 'owner'))`,
			household, user))
	default:
		if err := grant.Require(ctx, shopping, access.View); err != nil {
			problem.Write(w, "", err)
			return
		}
		q.Set("where", fmt.Sprintf(`household_id = '%s' AND deleted_at IS NULL`, household))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.electric+"/v1/shape?"+q.Encode(), nil)
	if err != nil {
		problem.Write(w, "", err)
		return
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		problem.Write(w, "", err)
		return
	}
	defer resp.Body.Close()
	for k, vs := range resp.Header {
		if strings.HasPrefix(strings.ToLower(k), "electric-") || k == "Content-Type" || k == "Cache-Control" || k == "Location" {
			w.Header()[k] = vs
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
