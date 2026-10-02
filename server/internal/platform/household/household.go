// Package household is the household surface of PRD 02 §3–6 and PRD modules/17 (plan items 10 and
// 11): creating a household and changing its settings, its members' roles and grants, the invitations
// that bring members in, members leaving and being removed, the modules the household enables, and
// the child profiles an owner makes, which sign in with the household's code and a PIN.
//
// These are admin's, the module the platform serves itself (ADR 0011): its routes are at the
// household's root rather than under /admin, and its writes go through the mutation spine as a
// module's do, recording admin's audit actions and changing admin's sync entities (Admin). Two of
// them are made for a caller who is not a member of the household they write, and so pass no
// tenant middleware: creating a household, whose creator it does not have yet, what the holder of
// an invitation does with it, the lock ten wrong PINs put on a child profile, and the graduation its
// link finishes. Those hold the household's scope through tenant.Assume, once the request has proved
// its right to it.
//
// What a household's working depends on is read by every member, as PRD modules/17 lists it: its
// settings, its members and their grants, and its modules. Its invitations are read with view on
// admin. Every write is an owner's (PRD 02 §4), except a member's leaving, which is their own, what
// an invitation's holder does with it, and what a child profile's PIN and its graduation's link do.
package household

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Config is what the service needs.
type Config struct {
	// Pool opens the transactions, connected as the request role.
	Pool tenant.Beginner
	Log  *slog.Logger
	// Throttles count the invitations a household sends (PRD 02 §9).
	Throttles *ratelimit.Throttles
	// Notify sends what the household surface tells people (item 15): an invitation's and a
	// graduation's email, an inviter's notice of a decline, the owners' of a locked child profile, and
	// a member's of a change of their access.
	Notify *notify.Service
	// WebURL is where the web client is served, which an invitation's link opens.
	WebURL *url.URL
	// Now is the clock; time.Now when nil.
	Now func() time.Time
	// Hooks are what later items plug in.
	Hooks Hooks
	// Accounts is the identity service, whose half of a child profile's sign-in and graduation is
	// the account's: the device sign-in a PIN admits, the password a graduation sets, and the
	// hashing, the devices and the client's network they need (item 11).
	Accounts *identity.Service
}

// Service serves the routes.
type Service struct {
	Config
}

// New returns the service.
func New(cfg Config) (*Service, error) {
	if cfg.Pool == nil || cfg.Log == nil || cfg.Throttles == nil || cfg.Notify == nil || cfg.WebURL == nil ||
		cfg.Accounts == nil {
		return nil, errors.New("household: the service is missing a dependency")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Service{Config: cfg}, nil
}

// PublicRoutes registers the routes a person reaches before signing in, on the API's router, behind
// the module registry the mutation spine checks against and keeping no Idempotency-Key (ADR 0009):
// a child profile's sign-in, which a household's code and a PIN make, and the link that finishes a
// child profile's graduation (ADR 0012).
func (s *Service) PublicRoutes(r chi.Router) {
	r.Post("/auth/child/profiles", s.childProfiles)
	r.Post("/auth/child/login", s.childLogin)
	r.Post("/auth/graduation/confirm", s.confirmGraduation)
}

// OptionalRoutes registers the route a person reaches signed in or not, on the API's router, behind
// the authentication but no check that there is a caller: an invitation's preview, which its link
// opens before the invitee has an account.
func (s *Service) OptionalRoutes(r chi.Router) {
	r.Get("/me/invitations/{token}", s.previewInvitation)
}

// AccountRoutes registers the routes a signed-in user calls outside any household, on the API's
// router, behind the authentication, a check that there is a caller, the account's
// Idempotency-Key, and the module registry the mutation spine checks against: their households,
// creating one, and the invitations addressed to them.
func (s *Service) AccountRoutes(r chi.Router) {
	r.Get("/households", s.listHouseholds)
	r.Post("/households", s.createHousehold)
	r.Get("/me/invitations", s.myInvitations)
	r.Post("/me/invitations/{token}/accept", s.acceptInvitation)
	r.Post("/me/invitations/{token}/decline", s.declineInvitation)
}

// HouseholdRoutes registers the routes about one household, on the API's router, behind the tenant
// middleware and the member's Idempotency-Key in the household.
func (s *Service) HouseholdRoutes(r chi.Router) {
	const h = "/households/{" + tenant.Param + "}"
	r.Get(h, s.getHousehold)
	r.Patch(h, s.updateHousehold)
	r.Post(h+"/join-code", s.regenerateJoinCode)
	r.Post(h+"/restriction", s.restrict)
	r.Delete(h+"/restriction", s.unrestrict)
	r.Get(h+"/members", s.listMembers)
	r.Get(h+"/members/{user_id}", s.getMember)
	r.Patch(h+"/members/{user_id}", s.updateMember)
	r.Delete(h+"/members/{user_id}", s.removeMember)
	r.Post(h+"/ownership/transfer", s.promote)
	r.Get(h+"/invitations", s.listInvitations)
	r.Post(h+"/invitations", s.invite)
	r.Delete(h+"/invitations/{invitation_id}", s.revokeInvitation)
	r.Post(h+"/invitations/{invitation_id}/resend", s.resendInvitation)
	r.Get(h+"/modules", s.listModules)
	r.Patch(h+"/modules/{module}", s.updateModule)
	r.Post(h+"/children/{user_id}/unlock", s.unlockChild)
	r.Put(h+"/children/{user_id}/avatar", s.putChildAvatar)
	r.Delete(h+"/children/{user_id}/avatar", s.clearChildAvatar)
	r.Post(h+"/children/{user_id}/graduate", s.graduate)
}

// PINRoutes registers the routes about one household whose body carries a child profile's PIN, on
// the API's router, behind the tenant middleware but not the member's Idempotency-Key: a key's
// fingerprint is a fast hash of the body, and so of the PIN, which is kept for no request (D-97,
// D-104).
func (s *Service) PINRoutes(r chi.Router) {
	const h = "/households/{" + tenant.Param + "}"
	r.Post(h+"/children", s.createChild)
	r.Put(h+"/children/{user_id}/pin", s.setPIN)
}

// LeaveRoutes registers leaving a household, on the API's router, behind the account's
// Idempotency-Key rather than the member's, and then the tenant middleware: leaving ends the
// membership, and a member's keys go with it, where a repeat would find none, and the tenant
// middleware would answer it as a stranger's.
func (s *Service) LeaveRoutes(r chi.Router) {
	r.Post("/households/{"+tenant.Param+"}/leave", s.leave)
}

// fail answers err's problem, or 500 for an error that is not one, which it logs.
func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	var p *problem.Problem
	if !errors.As(err, &p) {
		s.Log.LogAttrs(r.Context(), slog.LevelError, "household request failed", slog.Any("error", err))
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

// forbidden is the 403 for a caller who can see what they ask to change, and may not change it.
func forbidden() *problem.Problem { return problem.New(http.StatusForbidden, problem.CodeForbidden) }

// owner refuses a caller who is not an owner of ctx's household, as every write of the household's
// but leaving is an owner's (PRD 02 §4). Every member can see what the write would change. It reads
// the role the tenant middleware resolved, before the request's body is read; the write reads it
// again in its own transaction, under the household's lock (lockAsOwner).
func owner(ctx context.Context) error {
	s := tenant.From(ctx)
	if s == nil {
		return tenant.ErrNoTenant
	}
	if s.Role() != access.Owner {
		return forbidden()
	}
	return nil
}

// pathUUID is the path parameter name as a UUID; the edge has checked its form.
func pathUUID(r *http.Request, name string) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, name))
	if err != nil {
		return uuid.Nil, problem.NotFound()
	}
	return id, nil
}

// readTx runs fn in a read-only transaction of household, whatever ctx's scope, with user as the
// caller: the details of a household that an invitation's holder may see, or of each of a user's
// households, read in that household's context.
func (s *Service) readTx(ctx context.Context, household, user uuid.UUID, fn func(pgx.Tx) error) error {
	return tenant.InTx(tenant.Assume(ctx, s.Pool, household, user, access.Member), fn)
}
