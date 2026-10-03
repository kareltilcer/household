// Package replica is the platform's side of the read half of sync (D-93, ADR 0001, ADR 0014): the
// credentials a client's replica connects to PowerSync with, and the keys PowerSync verifies them
// by; and each replica's report of itself, which the server holds against PostgreSQL (Reports,
// D-125, ADR 0019). PowerSync replicates each household's rows into the buckets its generated streams
// define (internal/syncconfig); the API hands a member PowerSync's URL and a token of PowerSync's
// own, and publishes the public keys that sign it.
//
// The token is signed with the keys that sign a device's access tokens (item 9), and carries an
// audience, which PowerSync checks and the API's authentication refuses: a PowerSync token opens no
// route of the API, and an access token, carrying none, opens no PowerSync connection. Its lifetime
// bounds how long a device revoked, or a member removed, keeps the connection it already holds
// (FR-ID7): once it expires, the client asks for another, and the credentials operation, behind the
// authentication and the tenant middleware, refuses a device whose sign-in has ended and a caller no
// longer in the household.
package replica

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/token"
)

// Audience is the audience of every token the credentials hand out, the one PowerSync's
// configuration names (client_auth.audience).
const Audience = "powersync"

// Lifetime is how long a token the credentials hand out lasts: how long a device that was revoked,
// or a member who was removed, may keep syncing on the connection it holds (FR-ID7). PowerSync's
// client asks for new credentials before its token expires.
const Lifetime = 5 * time.Minute

// Config is what the credentials need.
type Config struct {
	// URL is where a client reaches PowerSync.
	URL string
	// Keys sign the tokens, and are published as the JWKS PowerSync verifies them with.
	Keys   *token.Keys
	Logger *slog.Logger
	// Now is the clock, time.Now when nil.
	Now func() time.Time
}

// Service serves the credentials and the keys.
type Service struct {
	cfg  Config
	jwks []byte
}

// New returns the credentials for cfg.
func New(cfg Config) (*Service, error) {
	if cfg.URL == "" || cfg.Keys == nil || cfg.Logger == nil {
		return nil, errors.New("replica: the credentials need PowerSync's URL, the keys and a logger")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	jwks, err := cfg.Keys.JWKS()
	if err != nil {
		return nil, err
	}
	return &Service{cfg: cfg, jwks: jwks}, nil
}

// PublicRoutes registers the keys, which PowerSync fetches with no credential of its own:
//
//	GET /sync/jwks   getSyncJwks
func (s *Service) PublicRoutes(r chi.Router) {
	r.Get("/sync/jwks", s.keys)
}

// HouseholdRoutes registers the credentials, which the router mounts in the household, behind the
// authentication and the tenant middleware. No Idempotency-Key is kept for them: a credential is
// never kept to be answered with, and asking again asks for another.
//
//	POST /households/{household_id}/sync/credentials   postSyncCredentials
func (s *Service) HouseholdRoutes(r chi.Router) {
	r.Post("/households/{"+tenant.Param+"}/sync/credentials", s.credentials)
}

// keys answers the public keys as a JSON Web Key Set, the signing key first. PowerSync caches them
// and asks again every few minutes, and at once for a token signed by a key it does not hold, so a
// key added in front of the others signs a token PowerSync verifies. That asking again must reach
// the API: a cache on the way that kept an earlier set would answer it with the set that lacks the
// new key, and PowerSync would refuse every token it signs until the cached set expired. So no cache
// answers with a set it holds without asking the API first (no-cache); PowerSync's own is its own.
func (s *Service) keys(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(s.jwks)
}

// credentialsBody is the contract's SyncCredentials.
type credentialsBody struct {
	Endpoint  string    `json:"endpoint"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

// credentials hands the caller, a member of the household, PowerSync's URL and a token of its own,
// whose subject is the caller: the household is the stream subscription's parameter (D-4), and
// the generated streams hold the caller to it. A device whose sign-in has ended reaches none of this,
// since the authentication no longer knows it.
func (s *Service) credentials(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	signed, expires, err := s.cfg.Keys.Replica(tenant.From(ctx).UserID(), Audience, s.cfg.Now(), Lifetime)
	if err != nil {
		s.cfg.Logger.LogAttrs(ctx, slog.LevelError, "replica: sign a token", slog.Any("error", err))
		problem.Write(w, reqctx.RequestID(ctx), problem.Internal())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, credentialsBody{Endpoint: s.cfg.URL, Token: signed, ExpiresAt: expires.UTC()})
}
