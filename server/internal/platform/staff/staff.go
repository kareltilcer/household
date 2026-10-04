// Package staff is the platform staff API (PRD 02 §8, PRD 05 §6; plan item 21, ADR 0022): what
// support and platform_admin see of an account and a household, and what they do to one.
//
// Staff read no household's content, and there is no mechanism by which they could (D-3). What they
// see is read through a database role of its own, the staff role, which holds SELECT on the columns
// that are metadata and on nothing else (D-143, architecture test 12): no handler here could answer
// a field of a content row, whatever it asked for. What they do is written by the request role, in
// the household's own context: through the mutation spine where it changes a household's row, so
// that every action is in the household's own log, by a service actor (FR-AL7, D-75), and in the
// platform's own log, in the transaction of its effect (FR-PS2).
//
// A staff member is an account with a row in platform.staff and the second step turned on (D-144). A
// caller who is neither is answered 404, as for anything else they may not see; one whose second
// step is off, or whose role does not reach the operation, is answered 403.
package staff

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/billing"
	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/text"
)

// Role is a platform role (PRD 02 §8). Neither is a household role, and neither appears in any
// household's member list.
type Role string

const (
	// Support is customer support: account and billing metadata, and the support actions.
	Support Role = "support"
	// Admin is platform_admin: everything support does, the platform's log, the staff themselves, a
	// household's suspension and its fair-use ceilings.
	Admin Role = "platform_admin"
)

// reaches reports whether r may do what needs the role min.
func (r Role) reaches(min Role) bool { return r == Admin || r == min }

// ErrNoRole is ParseRole's answer for a name that is no platform role. It does not say the name: an
// error may be logged, and what a request sent is kept out of the log (FR-NF5).
var ErrNoRole = errors.New("staff: no such platform role: support or platform_admin")

// ParseRole returns the platform role s names, or ErrNoRole.
func ParseRole(s string) (Role, error) {
	switch r := Role(s); r {
	case Support, Admin:
		return r, nil
	}
	return "", ErrNoRole
}

// Label is the actor a staff action is recorded by in a household's own log (FR-AL7): the platform's
// support, whichever staff member it was. Who it was is the platform's log's to say.
const Label = "support"

// Operator is who an action made through the command line is recorded by in the platform's log: the
// operator who made the first platform_admin (runbooks/platform-staff.md).
const Operator = "operator"

// maxReason is the longest reason an action carries, in characters.
const maxReason = 500

// Config is what the service needs.
type Config struct {
	// Pool opens the transactions of what staff do, connected as the request role.
	Pool tenant.Beginner
	// Staff reads what staff see, connected as the staff role, which reads metadata and nothing else
	// (D-143).
	Staff tenant.Beginner
	Log   *slog.Logger
	// Catalog is the module registry with the platform's own modules, which what staff do to a
	// household is checked against.
	Catalog *module.Registry
	// Accounts, Households, Billing and Notify are the surfaces whose support actions staff take.
	Accounts   *identity.Service
	Households *household.Service
	Billing    *billing.Service
	Notify     *notify.Service
	// Now is the clock; time.Now when nil.
	Now func() time.Time
}

// Service serves the routes.
type Service struct {
	cfg Config
}

// New returns the service.
func New(cfg Config) (*Service, error) {
	if cfg.Pool == nil || cfg.Staff == nil || cfg.Log == nil || cfg.Catalog == nil || cfg.Accounts == nil ||
		cfg.Households == nil || cfg.Billing == nil || cfg.Notify == nil {
		return nil, errors.New("staff: the service is missing a dependency")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Service{cfg: cfg}, nil
}

// Routes returns what registers the staff API on the API's router, behind the authentication and a
// check that there is a caller. Each route admits the staff whose role reaches it, and only then
// reads the request's Idempotency-Key, through keyed, the account's: a key answers a repeat with what
// the first request was answered, so it is read behind the admission, as a module's is behind its
// gate, and a caller who is staff no longer is answered 404 and not what they were answered while
// they were (D-144).
func (s *Service) Routes(keyed func(http.Handler) http.Handler) func(chi.Router) {
	return func(r chi.Router) {
		support, admin := r.With(s.admit(Support), keyed), r.With(s.admit(Admin), keyed)
		const h = "/platform/households/{household_id}"

		support.Get("/platform/households", s.searchHouseholds)
		support.Get(h, s.getHousehold)
		support.Post(h+"/trial", s.extendTrial)
		support.Post(h+"/credit", s.credit)
		support.Post(h+"/invoices/{invoice_id}/resend", s.resendInvoice)
		support.Post(h+"/notifications/{notification_id}/redrive", s.redrive)
		support.Put(h+"/flags/{key}", s.setHouseholdFlag)
		admin.Patch(h+"/limits", s.setLimit)
		admin.Put(h+"/suspension", s.setSuspension)

		support.Get("/platform/users", s.searchUsers)
		support.Get("/platform/users/{user_id}", s.getUser)
		support.Post("/platform/users/{user_id}/actions", s.actOnUser)

		support.Get("/platform/diagnostics/{bundle_id}", s.getDiagnostics)

		support.Get("/platform/flags", s.listFlags)
		support.Put("/platform/flags/{key}", s.setFlag)

		admin.Get("/platform/audit", s.listAudit)
		admin.Get("/platform/staff", s.listStaff)
		admin.Put("/platform/staff/{user_id}", s.setStaff)
	}
}

// member is a staff member, as a request found them.
type member struct {
	id    uuid.UUID
	role  Role
	email string
}

type memberKey struct{}

// caller returns the staff member ctx's request was admitted as.
func caller(ctx context.Context) member {
	m, _ := ctx.Value(memberKey{}).(member)
	return m
}

// admit returns the middleware that admits the staff whose role reaches min. A caller who is not
// staff is answered 404, as for anything else they may not see; a staff member whose second step is
// off is answered 403 staff_mfa_required, since the platform's staff sign in with one (PRD 02 §8),
// and one whose role does not reach min 403 forbidden.
func (s *Service) admit(min Role) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			user, ok := auth.User(ctx)
			if !ok {
				s.fail(w, r, problem.New(http.StatusUnauthorized, problem.CodeUnauthenticated))
				return
			}
			m, err := s.member(ctx, user)
			switch {
			case err != nil:
				s.fail(w, r, err)
				return
			case !m.role.reaches(min):
				s.fail(w, r, problem.New(http.StatusForbidden, problem.CodeForbidden))
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, memberKey{}, m)))
		})
	}
}

// member reads user as a staff member, as the request role: their role, their address, which the
// platform's log records them by, and that their second step is on. It is read on every request, so
// that a staff member removed, or one who turned the step off, is one no longer at once.
func (s *Service) member(ctx context.Context, user uuid.UUID) (member, error) {
	m := member{id: user}
	err := tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
		var role string
		err := tx.QueryRow(ctx, `
			SELECT s.role::text, u.email FROM platform.staff s JOIN users u ON u.id = s.user_id
			WHERE s.user_id = $1 AND u.email IS NOT NULL AND u.deleted_at IS NULL`, user).Scan(&role, &m.email)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.NotFound()
		}
		if err != nil {
			return err
		}
		if m.role, err = ParseRole(role); err != nil {
			return err
		}
		on, err := identity.SecondStepOn(ctx, tx, user)
		if err != nil {
			return err
		}
		if !on {
			return problem.New(http.StatusForbidden, problem.CodeStaffMfaRequired)
		}
		return nil
	})
	return m, err
}

// entry is one staff action as the platform's log records it (FR-PS2).
type entry struct {
	// action names what was done: "household.suspend", "user.unlock".
	action string
	// household and user are what the action touched, uuid.Nil for none.
	household, user uuid.UUID
	// reason is why, which every action carries.
	reason string
	// meta is what else the action says of itself.
	meta map[string]any
}

// record writes e to the platform's log in tx, the transaction of its effect, as m's action; or as
// the operator's when m is the zero member, an action made through the command line.
func record(ctx context.Context, tx pgx.Tx, m member, e entry) error {
	meta := e.meta
	if meta == nil {
		meta = map[string]any{}
	}
	data, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	label, actor, role := m.email, nullable(m.id), any(string(m.role))
	if m.id == uuid.Nil {
		label, role = Operator, nil
	}
	var reason any
	if e.reason != "" {
		reason = e.reason
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO platform.audit_log (id, actor_id, actor_label, actor_role, action, household_id, target_user_id, reason, meta)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		idgen.New(), actor, label, role, e.action, nullable(e.household), nullable(e.user), reason, data)
	return err
}

// nullable is id, or NULL for the zero UUID.
func nullable(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

// acting returns ctx in e's household's scope, with no caller, as the platform's staff: what is done
// there is recorded in the household's own log by the service actor (FR-AL7, D-75), and in the
// platform's log as m's action e, with the household's event it goes with, in the transaction of its
// effect. An action that changes nothing records nothing in either.
func (s *Service) acting(ctx context.Context, m member, e entry) context.Context {
	scoped := tenant.Assume(ctx, s.cfg.Pool, e.household, uuid.Nil, "")
	scoped = mutation.WithVia(mutation.WithCatalog(scoped, s.cfg.Catalog), audit.ViaSystem)
	return mutation.AsService(scoped, mutation.Service{
		Label: Label,
		Witness: func(ctx context.Context, tx pgx.Tx, event uuid.UUID) error {
			logged := e
			logged.meta = map[string]any{"event_id": event}
			for k, v := range e.meta {
				logged.meta[k] = v
			}
			return record(ctx, tx, m, logged)
		},
	})
}

// witness is e as an account's support action records it (identity.Witness): m's action, in the
// transaction of its effect.
func witness(m member, e entry) identity.Witness {
	return func(ctx context.Context, tx pgx.Tx) error { return record(ctx, tx, m, e) }
}

// fail answers err's problem, or 500 for an error that is not one, which it logs.
func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	var p *problem.Problem
	if !errors.As(err, &p) {
		s.cfg.Log.LogAttrs(r.Context(), slog.LevelError, "staff request failed", slog.Any("error", err))
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

// inapplicable is the 409 for an action that does not apply to what it names as it stands: an
// address verified already, a second step that is not locked, an invoice that is not paid, an account
// whose deletion no link cancels any more.
func inapplicable() *problem.Problem {
	return problem.New(http.StatusConflict, problem.CodeNotApplicable)
}

// reasoned is reason as an action's reason is kept: trimmed, with something in it, and no longer
// than maxReason, or the 422 naming /reason.
func reasoned(reason string) (string, error) {
	kept, ok := text.Message(reason)
	if !ok || kept == "" || len([]rune(kept)) > maxReason {
		return "", invalid("/reason", problem.FieldInvalid)
	}
	return kept, nil
}

// pathUUID is the path parameter name as a UUID; the edge has checked its form.
func pathUUID(r *http.Request, name string) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, name))
	if err != nil {
		return uuid.Nil, problem.NotFound()
	}
	return id, nil
}

// actorRef is the contract's ActorRef, of a staff member: their address as it was.
type actorRef = entitlement.ActorRef

// read runs fn in one read-only transaction of the staff role's, so that what a response puts
// together is of one moment.
func (s *Service) read(ctx context.Context, fn func(pgx.Tx) error) error {
	return pgx.BeginTxFunc(ctx, s.cfg.Staff, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, fn)
}

// found turns a row that was not there into the 404 it answers.
func found(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return problem.NotFound()
	}
	return err
}

// contains is the SQL condition that column holds needle, whatever their case, with nothing in
// needle read as a pattern.
func contains(column, needle string) string {
	return "position(lower(" + needle + ") in lower(" + column + ")) > 0"
}

// trimmed is the query parameter name of r, trimmed.
func trimmed(r *http.Request, name string) string {
	return strings.TrimSpace(r.URL.Query().Get(name))
}
