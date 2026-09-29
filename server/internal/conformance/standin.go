package conformance

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/device"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// The audiences the stand-in's two tokens carry. PowerSync checks its token's against the one its
// configuration names (packages/sync/conformance/stack/powersync/powersync.yaml); the stand-in
// takes only an API token, so a PowerSync token authenticates nothing here, as item 13's API will
// accept no token minted for PowerSync (ADR 0001).
const (
	APIAudience       = "household-conformance-api"
	PowerSyncAudience = "powersync"
)

// PowerSyncKeyID names the stand-in's PowerSync key, as powersync.yaml's JWKS does.
const PowerSyncKeyID = "conformance"

// DefaultAPITokenLifetime is how long an API token lasts when its sign-in names no lifetime, and
// PowerSyncTokenLifetime how long a PowerSync token does.
const (
	DefaultAPITokenLifetime = time.Hour
	PowerSyncTokenLifetime  = 5 * time.Minute
)

// Config is what the stand-in needs.
type Config struct {
	// Pool opens every transaction, connected as the request role.
	Pool tenant.Beginner
	// Logger records what a request could not do.
	Logger *slog.Logger
	// Contract is the contract the push is validated against at the edge.
	Contract *contract.Contract
	// PowerSyncURL is the service a client's credentials point it at.
	PowerSyncURL string
	// PowerSyncKey signs the tokens PowerSync verifies (HS256), and APIKey the stand-in's own.
	PowerSyncKey, APIKey []byte
	// MaxBodyBytes caps a request body at the edge.
	MaxBodyBytes int64
	// Now is the clock, time.Now when nil.
	Now func() time.Time
}

// StandIn serves the stand-ins of the API the conformance suite runs against.
type StandIn struct {
	cfg      Config
	registry *module.Registry
}

// New returns the stand-in for cfg.
func New(cfg Config) (*StandIn, error) {
	switch {
	case cfg.Pool == nil || cfg.Logger == nil || cfg.Contract == nil:
		return nil, errors.New("conformance: the stand-in needs a pool, a logger and the contract")
	case len(cfg.PowerSyncKey) < 32 || len(cfg.APIKey) < 32:
		return nil, errors.New("conformance: each signing key is at least 32 bytes")
	case cfg.PowerSyncURL == "":
		return nil, errors.New("conformance: the stand-in needs PowerSync's URL")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	registry, err := module.NewRegistry(Module{})
	if err != nil {
		return nil, err
	}
	return &StandIn{cfg: cfg, registry: registry}, nil
}

// Router returns the stand-in's routes:
//
//	GET  /standin/healthz                                      200 once the stand-in serves
//	POST /standin/sign-in                                      an API token for a user
//	POST /standin/households/{household_id}/sync/credentials   PowerSync's URL and a token for it
//	POST /api/v1/households/{household_id}/sync/mutations      the push (postSyncMutations)
//
// The sign-in trusts the user id it is given: the stand-in is the suite's, never deployed, and
// stands in for item 9's device sign-in. The credentials, which item 13 builds as a contract
// operation, answer a household's members only. The push is the contract's operation, validated
// at the edge against the committed contract, behind the tenant middleware and the household's
// Idempotency-Key, and it writes through the mutation spine.
func (s *StandIn) Router() (http.Handler, error) {
	tenancy, err := tenant.Middleware(tenant.Config{Pool: s.cfg.Pool, Logger: s.cfg.Logger})
	if err != nil {
		return nil, err
	}
	catalog := mutation.Catalog(s.registry)

	root := chi.NewRouter()
	root.Use(httpx.RequestScope, httpx.AccessLog(s.cfg.Logger), httpx.Recover(s.cfg.Logger))
	root.NotFound(httpx.NotFound)
	root.MethodNotAllowed(httpx.MethodNotAllowed)

	root.Get("/standin/healthz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	root.Post("/standin/sign-in", s.signIn)
	root.With(s.authenticate, tenancy).Post("/standin/households/{"+tenant.Param+"}/sync/credentials", s.credentials)

	api := chi.NewRouter()
	api.Use(s.cfg.Contract.Middleware(api, contract.Limits{MaxBody: s.cfg.MaxBodyBytes}))
	api.NotFound(httpx.NotFound)
	api.MethodNotAllowed(httpx.MethodNotAllowed)
	api.With(s.authenticate, tenancy, catalog, idempotency.Middleware(s.cfg.Logger, s.cfg.MaxBodyBytes)).
		Post("/households/{"+tenant.Param+"}/sync/mutations", s.push)
	root.Mount(contract.BasePath, api)
	return root, nil
}

type signInRequest struct {
	UserID uuid.UUID `json:"user_id"`
	// TTLSeconds is the API token's lifetime, DefaultAPITokenLifetime when zero: a short one lets
	// the suite see its connector renew a credential the push refuses.
	TTLSeconds int `json:"ttl_seconds"`
}

type tokenResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (s *StandIn) signIn(w http.ResponseWriter, r *http.Request) {
	var body signInRequest
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body)
	if err != nil || body.UserID == uuid.Nil || body.TTLSeconds < 0 {
		problem.Write(w, reqctx.RequestID(r.Context()), problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed}))
		return
	}
	ttl := DefaultAPITokenLifetime
	if body.TTLSeconds > 0 {
		ttl = time.Duration(body.TTLSeconds) * time.Second
	}
	tok, expires, err := s.sign(s.cfg.APIKey, "", APIAudience, body.UserID, ttl)
	if err != nil {
		problem.Write(w, reqctx.RequestID(r.Context()), err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, tokenResponse{Token: tok, ExpiresAt: expires})
}

type credentialsResponse struct {
	Endpoint  string    `json:"endpoint"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

// credentials hands a member PowerSync's URL and a token of its own, whose sub is the member: the
// household is the stream subscription's parameter, not the token's.
func (s *StandIn) credentials(w http.ResponseWriter, r *http.Request) {
	user := tenant.From(r.Context()).UserID()
	tok, expires, err := s.sign(s.cfg.PowerSyncKey, PowerSyncKeyID, PowerSyncAudience, user, PowerSyncTokenLifetime)
	if err != nil {
		problem.Write(w, reqctx.RequestID(r.Context()), err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, credentialsResponse{Endpoint: s.cfg.PowerSyncURL, Token: tok, ExpiresAt: expires})
}

// sign returns an HS256 token for user with audience aud, signed with key and named kid when kid
// is not empty, valid for ttl, and when it expires.
func (s *StandIn) sign(key []byte, kid, aud string, user uuid.UUID, ttl time.Duration) (string, time.Time, error) {
	now := s.cfg.Now().UTC().Truncate(time.Second)
	expires := now.Add(ttl)
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject:   user.String(),
		Audience:  jwt.ClaimStrings{aud},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(expires),
	})
	if kid != "" {
		t.Header["kid"] = kid
	}
	signed, err := t.SignedString(key)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("conformance: sign a token: %w", err)
	}
	return signed, expires, nil
}

// authenticate signs a request in by the API token its Authorization header carries, and answers
// 401 unauthenticated to one without a valid one: another audience's, PowerSync's included, an
// expired one, or one another key signed.
func (s *StandIn) authenticate(next http.Handler) http.Handler {
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithAudience(APIAudience),
		jwt.WithExpirationRequired(),
		jwt.WithTimeFunc(func() time.Time { return s.cfg.Now() }),
	)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, ok := device.Bearer(r)
		var claims jwt.RegisteredClaims
		if ok {
			_, err := parser.ParseWithClaims(raw, &claims, func(*jwt.Token) (any, error) { return s.cfg.APIKey, nil })
			ok = err == nil
		}
		user, err := uuid.Parse(claims.Subject)
		if !ok || err != nil || user == uuid.Nil {
			problem.Write(w, reqctx.RequestID(r.Context()), problem.New(http.StatusUnauthorized, problem.CodeUnauthenticated))
			return
		}
		next.ServeHTTP(w, r.WithContext(auth.WithUser(r.Context(), user)))
	})
}
