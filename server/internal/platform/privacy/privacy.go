// Package privacy is the platform's export and erasure (PRD 05 §3–5, §9; PRD 01 §4's export and
// erase catalog; plan item 20, ADR 0020): the rights a member exercises themself, in the app, with
// no support ticket (D-35).
//
//   - Exports (FR-PR2): a member's of everything about them, and an owner's of a household, each a
//     job a worker builds into a ZIP and keeps for seven days (Run). Every module writes its part
//     through module.ExportSource, and the platform writes the files, the activity log and the
//     manifest that says what is inside.
//   - Account deletion (FR-PR3, FR-PR4): asked for with the account's password, resolved against
//     every household the account is in, and then a 30-day window in which the account signs nobody
//     in and the link its email carries cancels it.
//   - Erasure (Erase): the nightly job that executes what was scheduled, an account's deletion, a
//     household's (FR-PR6, which the household surface schedules), a lapsed household's whose
//     retention ran out (D-119), and the private data of a member who left 30 days ago (FR-PR7);
//     and removes the objects of what it erased.
//   - The diagnostic bundle a member chose to send (FR-PS1), and what an account consented to
//     (FR-PR9).
//
// Erasure is the platform's own deletion and no entity's history: it writes through tenant.InWriteTx
// and tenant.AccountTx, and records no audit event, since the log is among what goes (FR-AU5). What
// it changes of a household that goes on, a membership ended, an owner made, is the household
// surface's mutation, through the spine (household.Service.Depart).
package privacy

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/files"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// The retentions this package keeps (PRD 03 §5, PRD 05 §3).
const (
	// ArchiveKept is how long an export's archive is downloadable once it is ready.
	ArchiveKept = 7 * 24 * time.Hour
	// JobsKept is how long an export's row is kept once it ended, ready, failed or expired: what the
	// list shows of an export that can no longer be downloaded.
	JobsKept = 30 * 24 * time.Hour
	// BundlesKept is how long a diagnostic bundle is kept (FR-PS1).
	BundlesKept = 30 * 24 * time.Hour
	// PrivateKept is how long a member who left a household may still export what they kept
	// privately there, before it is deleted (FR-PR7).
	PrivateKept = 30 * 24 * time.Hour
	// Repurge is how long after an erasure its objects are removed again each night: longer than
	// the day an upload's bytes may wait for their row (files.SweepGrace).
	Repurge = 3 * 24 * time.Hour
)

// Querier reads across households: the meter role's pool (PRD 01 §2.3).
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Config is what the service needs.
type Config struct {
	// Pool opens the transactions, connected as the request role.
	Pool tenant.Beginner
	// Meter finds, across households, the households and the departures the nightly job has work in,
	// and the households a user left, as the meter role: by the columns that schedule the work.
	Meter Querier
	Log   *slog.Logger
	// Registry is the module registry with the platform's own modules: whose ExportSource and
	// EraseSource are asked, and what the household surface's mutations are checked against.
	Registry *module.Registry
	// Accounts is the identity service, whose half of an account's deletion is the account's.
	Accounts *identity.Service
	// Households is the household surface, which resolves an account's households and ends its
	// memberships.
	Households *household.Service
	// Files is the files pipeline, whose store keeps the archives and whose objects erasure removes.
	Files *files.Service
	// Catalogs render an export's activity log in its requester's language.
	Catalogs *i18n.Catalogs
	// APIVersion is the contract's version, which an archive's manifest names: its JSON matches the
	// API's schemas at that version.
	APIVersion string
	// Now is the clock; time.Now when nil.
	Now func() time.Time
	// Poll is how often the export workers look for jobs other instances' requests left, 30 seconds
	// when zero, and Lease how long a worker holds a job it takes, six hours when zero.
	Poll  time.Duration
	Lease time.Duration
}

// Service serves the routes, builds the exports and runs the erasure.
type Service struct {
	cfg  Config
	wake chan struct{}
}

// New returns the service.
func New(cfg Config) (*Service, error) {
	if cfg.Pool == nil || cfg.Meter == nil || cfg.Log == nil || cfg.Registry == nil || cfg.Accounts == nil ||
		cfg.Households == nil || cfg.Files == nil || cfg.Catalogs == nil {
		return nil, errors.New("privacy: the service is missing a dependency")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Poll <= 0 {
		cfg.Poll = 30 * time.Second
	}
	if cfg.Lease <= 0 {
		cfg.Lease = 6 * time.Hour
	}
	return &Service{cfg: cfg, wake: make(chan struct{}, 1)}, nil
}

// PublicRoutes registers the route a person reaches before signing in, on the API's router, keeping
// no Idempotency-Key (ADR 0009): cancelling an account's deletion with the link its email carried,
// which is the only way into an account that signs nobody in.
func (s *Service) PublicRoutes(r chi.Router) {
	r.Post("/auth/deletion/cancel", s.cancelDeletion)
}

// PasswordRoutes registers the account route whose body carries a password, on the API's router,
// behind the authentication, a check that there is a caller and the module registry the mutation
// spine checks against, but not the account's Idempotency-Key (D-97): asking for the account's
// deletion.
func (s *Service) PasswordRoutes(r chi.Router) {
	r.Post("/me/deletion", s.requestDeletion)
}

// AccountRoutes registers the routes a signed-in user calls about their own data, on the API's
// router, behind the authentication, a check that there is a caller and the account's
// Idempotency-Key: their consents, their exports and the diagnostic bundle they send.
func (s *Service) AccountRoutes(r chi.Router) {
	r.Get("/me/consents", s.getConsents)
	r.Put("/me/consents", s.putConsents)
	r.Get("/me/exports", s.listExports)
	r.Post("/me/exports", s.requestExport)
	r.Get("/me/exports/{export_id}", s.getExport)
	r.Post("/me/diagnostics", s.sendDiagnostics)
}

// HouseholdRoutes registers the routes about one household's exports, on the API's router, behind the
// tenant middleware and the member's Idempotency-Key in the household.
func (s *Service) HouseholdRoutes(r chi.Router) {
	const h = "/households/{" + tenant.Param + "}"
	r.Get(h+"/exports", s.listExports)
	r.Post(h+"/exports", s.requestExport)
	r.Get(h+"/exports/{export_id}", s.getExport)
}

// fail answers err's problem, or 500 for an error that is not one, which it logs.
func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	var p *problem.Problem
	if !errors.As(err, &p) {
		s.cfg.Log.LogAttrs(r.Context(), slog.LevelError, "privacy request failed", slog.Any("error", err))
	}
	problem.Write(w, reqctx.RequestID(r.Context()), err)
}

// decode reads r's JSON body into v. The edge has held it to the contract already, so a body that
// does not decode is refused as the edge refuses one.
func decode(r *http.Request, v any) error {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed})
	}
	return nil
}

// invalid is the 422 naming field with code.
func invalid(field, code string) *problem.Problem {
	return problem.Validation(problem.FieldError{Field: field, Code: code})
}

// system returns ctx carrying household's scope with no caller: the worker's and the nightly job's,
// which act for no member.
func (s *Service) system(ctx context.Context, household uuid.UUID) context.Context {
	return tenant.Assume(ctx, s.cfg.Pool, household, uuid.Nil, "")
}

// source is one module's export and erasure, a registered module's or one the platform serves itself.
type source struct {
	name   string
	export func(ctx context.Context, tx pgx.Tx, e module.Export, a module.Archive) error
	erase  func(ctx context.Context, tx pgx.Tx, e module.Erasure) error
}

// sources are the modules of reg that export and erase, the platform's own first: every one
// implements both (D-6, architecture test 3), and one that somehow does not is asked for nothing.
func sources(reg *module.Registry) []source {
	var out []source
	for _, p := range reg.Platform() {
		out = append(out, source{name: p.Name, export: p.Export, erase: p.Erase})
	}
	for _, m := range reg.All() {
		src := source{name: m.Name()}
		if e, ok := m.(module.ExportSource); ok {
			src.export = e.Export
		}
		if e, ok := m.(module.EraseSource); ok {
			src.erase = e.Erase
		}
		out = append(out, src)
	}
	return out
}
