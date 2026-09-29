package household

import (
	"context"
	"errors"
	"maps"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/etag"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// membership is a member's row, with what the member list shows of them.
type membership struct {
	id         uuid.UUID
	user       uuid.UUID
	role       access.Role
	version    int64
	joined     time.Time
	name       string
	email      *string
	lastActive *time.Time
	// grants are the member's stored levels, by module: none for a module with no row.
	grants map[string]access.Level
	// child is what a child profile's membership says of it, and nil for any other member's.
	child *childProfile
}

// childProfile is what a child profile's membership says of it (FR-CH1, FR-CH5).
type childProfile struct {
	// yearOfBirth is the birth year an owner gave, or nil.
	yearOfBirth *int
	// dashboardLocked keeps the child from rearranging their dashboard (item 36).
	dashboardLocked bool
	// pinLocked is a profile whose PIN has counted LockAfter wrong ones since its last right one,
	// until an owner unlocks it.
	pinLocked bool
}

// membershipColumns are the columns scanMembership reads, in its order, of memberships m joined to
// users u. A member's last activity in the household is their newest event in its log (FR-HA3); a
// child profile is locked while its PIN has counted LockAfter wrong ones since its last right one.
var membershipColumns = `m.id, m.user_id, m.role::text, m.version, m.created_at, u.display_name, u.email,
	(SELECT max(e.occurred_at) FROM audit_events e WHERE e.household_id = m.household_id AND e.actor_id = m.user_id),
	m.year_of_birth, m.dashboard_locked,
	coalesce((SELECT c.failures FROM credentials c WHERE c.user_id = m.user_id AND c.type = 'child_pin'), 0) >= ` +
	strconv.Itoa(LockAfter)

func scanMembership(row pgx.CollectableRow) (membership, error) {
	var (
		m           membership
		p           childProfile
		yearOfBirth *int16
	)
	err := row.Scan(&m.id, &m.user, &m.role, &m.version, &m.joined, &m.name, &m.email, &m.lastActive,
		&yearOfBirth, &p.dashboardLocked, &p.pinLocked)
	m.grants = map[string]access.Level{}
	if m.role == access.Child {
		if yearOfBirth != nil {
			y := int(*yearOfBirth)
			p.yearOfBirth = &y
		}
		m.child = &p
	}
	return m, err
}

// readMemberships reads household's members in the order they joined, with their grants: every one
// of them when only is nil, else only's alone; lock locks the rows FOR UPDATE. Every member is asked
// for with nil, never with a user id: the contract's Uuid admits the nil UUID in a path, and a
// request naming it must find nobody rather than everybody.
func readMemberships(ctx context.Context, tx pgx.Tx, household uuid.UUID, only *uuid.UUID, lock bool) ([]membership, error) {
	statement := "SELECT " + membershipColumns + `
		FROM memberships m JOIN users u ON u.id = m.user_id
		WHERE m.household_id = $1 AND ($2::uuid IS NULL OR m.user_id = $2)
		ORDER BY m.created_at, m.id`
	if lock {
		statement += " FOR UPDATE OF m"
	}
	rows, err := tx.Query(ctx, statement, household, only)
	if err != nil {
		return nil, err
	}
	members, err := pgx.CollectRows(rows, scanMembership)
	if err != nil || len(members) == 0 {
		return members, err
	}
	rows, err = tx.Query(ctx, `
		SELECT user_id, module, level::text FROM module_grants
		WHERE household_id = $1 AND ($2::uuid IS NULL OR user_id = $2)`, household, only)
	if err != nil {
		return nil, err
	}
	byUser := make(map[uuid.UUID]*membership, len(members))
	for i := range members {
		byUser[members[i].user] = &members[i]
	}
	var (
		member        uuid.UUID
		module, level string
	)
	_, err = pgx.ForEachRow(rows, []any{&member, &module, &level}, func() error {
		l, err := access.ParseLevel(level)
		if m := byUser[member]; m != nil && err == nil {
			m.grants[module] = l
		}
		return err
	})
	return members, err
}

// readMembership reads user's membership in household, or the 404 problem when they hold none.
func readMembership(ctx context.Context, tx pgx.Tx, household, user uuid.UUID, lock bool) (membership, error) {
	members, err := readMemberships(ctx, tx, household, &user, lock)
	switch {
	case err != nil:
		return membership{}, err
	case len(members) == 0:
		return membership{}, problem.NotFound()
	}
	return members[0], nil
}

// lockHousehold locks household's row against every other change of its members, its payer, its
// settings and its modules until tx ends, and returns its payer: the rules that hold across members,
// the last owner and the payer (FR-HH4), are checked under it, so that two owners leaving at once
// cannot both find the other still an owner, and so is who lost access to a change, which depends on
// both a member's grants and the household's modules. FOR NO KEY UPDATE, so that another mutation's
// audit event, whose foreign key locks the row FOR KEY SHARE, is not held up by it.
func lockHousehold(ctx context.Context, tx pgx.Tx, household uuid.UUID) (*uuid.UUID, error) {
	var payer *uuid.UUID
	err := tx.QueryRow(ctx, "SELECT billing_payer_id FROM households WHERE id = $1 FOR NO KEY UPDATE", household).Scan(&payer)
	return payer, err
}

// lockAsOwner locks ctx's household as lockHousehold does, returns its payer, and refuses the caller
// unless they are still one of its owners once the lock is held. owner read the role the tenant
// middleware resolved, in a transaction before this one; an owner removed or made a member while
// their request was on its way would otherwise finish it as one, writing an invitation the
// withdrawal that ended their ownership has already passed (D-103), or promoting themself back.
// Every change of a member's role or membership takes the same lock, so the role read under it is
// the one that change committed. A caller who is no longer a member is answered 404, as their next
// request would be, and one who is no longer an owner 403.
func lockAsOwner(ctx context.Context, tx pgx.Tx) (*uuid.UUID, error) {
	scope := tenant.From(ctx)
	if scope == nil {
		return nil, tenant.ErrNoTenant
	}
	payer, err := lockHousehold(ctx, tx, scope.HouseholdID())
	if err != nil {
		return nil, err
	}
	var role string
	err = tx.QueryRow(ctx, "SELECT role::text FROM memberships WHERE household_id = $1 AND user_id = $2",
		scope.HouseholdID(), scope.UserID()).Scan(&role)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil, problem.NotFound()
	case err != nil:
		return nil, err
	case access.Role(role) != access.Owner:
		return nil, forbidden()
	}
	return payer, nil
}

// grantsOf are the levels role and stored give on each of modules, as the member list shows them: an
// owner's Manage, whatever is stored, and a member's or a child's stored level, capped at their
// ceiling (access.Ceiling).
func grantsOf(role access.Role, stored map[string]access.Level, modules []string) map[string]access.Level {
	out := make(map[string]access.Level, len(modules))
	for _, m := range modules {
		if role == access.Owner {
			out[m] = access.Manage
		} else {
			out[m] = min(stored[m], access.Ceiling(role, m))
		}
	}
	return out
}

// memberBody is the contract's Membership.
type memberBody struct {
	UserID         uuid.UUID               `json:"user_id"`
	HouseholdID    uuid.UUID               `json:"household_id"`
	DisplayName    string                  `json:"display_name"`
	Email          *string                 `json:"email"`
	AvatarURL      *string                 `json:"avatar_url"`
	Role           access.Role             `json:"role"`
	Grants         map[string]access.Level `json:"grants"`
	IsBillingPayer bool                    `json:"is_billing_payer"`
	JoinedAt       time.Time               `json:"joined_at"`
	LastActiveAt   *time.Time              `json:"last_active_at"`
	Version        int64                   `json:"version"`
	Child          *childBody              `json:"child"`
}

// childBody is what the member list shows of a child profile.
type childBody struct {
	YearOfBirth     *int `json:"year_of_birth"`
	PinLocked       bool `json:"pin_locked"`
	DashboardLocked bool `json:"dashboard_locked"`
}

// row is m as its sync row carries it to every member: without their address, their last activity,
// which changes with no change of the membership, and a child's birth year, which only the owners and
// the child read.
func (m membership) row(household uuid.UUID, payer *uuid.UUID, modules []string) memberBody {
	b := memberBody{
		UserID: m.user, HouseholdID: household, DisplayName: m.name, Role: m.role,
		Grants: grantsOf(m.role, m.grants, modules), IsBillingPayer: payer != nil && *payer == m.user,
		JoinedAt: m.joined.UTC(), Version: m.version,
	}
	if m.child != nil {
		b.Child = &childBody{PinLocked: m.child.pinLocked, DashboardLocked: m.child.dashboardLocked}
	}
	return b
}

// body is m as scope's caller reads it: their address, and a child's birth year, are shown to the
// household's owners, who invite and manage its members, and to the member themself (FR-CH2).
func (m membership) body(scope *tenant.Scope, payer *uuid.UUID, modules []string) memberBody {
	b := m.row(scope.HouseholdID(), payer, modules)
	if scope.Role() == access.Owner || scope.UserID() == m.user {
		b.Email = m.email
		if b.Child != nil {
			b.Child.YearOfBirth = m.child.yearOfBirth
		}
	}
	if m.lastActive != nil {
		t := m.lastActive.UTC()
		b.LastActiveAt = &t
	}
	return b
}

// change is the sync change of m, as it stands after a mutation.
func (m membership) change(household uuid.UUID, payer *uuid.UUID, modules []string) sync.Change {
	return sync.Change{Entity: entityMembership, ID: m.id, Op: sync.Upsert, Version: m.version, Row: m.row(household, payer, modules)}
}

// gone is the sync change of m's deletion, which orders after every write a replica holds of it.
func (m membership) gone() sync.Change {
	return sync.Change{Entity: entityMembership, ID: m.id, Op: sync.Delete, Version: m.version + 1}
}

// insertMembership makes user a member of household with role and grants, and returns the
// membership.
func insertMembership(ctx context.Context, tx pgx.Tx, household, user uuid.UUID, role access.Role, grants map[string]access.Level) (membership, error) {
	return insertProfile(ctx, tx, idgen.New(), household, user, role, grants, childProfile{})
}

// insertProfile makes user a member of household with role and grants, whose membership's id is id,
// and with what p says of them when they are a child profile, and returns the membership.
func insertProfile(ctx context.Context, tx pgx.Tx, id, household, user uuid.UUID, role access.Role, grants map[string]access.Level,
	p childProfile,
) (membership, error) {
	rows, err := tx.Query(ctx, `
		WITH m AS (
		  INSERT INTO memberships (id, household_id, user_id, role, year_of_birth, dashboard_locked)
		  VALUES ($1, $2, $3, $4, $5, $6)
		  RETURNING id, household_id, user_id, role, version, created_at, year_of_birth, dashboard_locked
		)
		SELECT `+membershipColumns+` FROM m JOIN users u ON u.id = m.user_id`,
		id, household, user, string(role), p.yearOfBirth, p.dashboardLocked)
	if err != nil {
		return membership{}, err
	}
	m, err := pgx.CollectExactlyOneRow(rows, scanMembership)
	if err != nil {
		return membership{}, err
	}
	if err := writeGrants(ctx, tx, household, user, grants); err != nil {
		return membership{}, err
	}
	maps.Copy(m.grants, grants)
	return m, nil
}

// writeGrants sets user's levels in household to grants, module by module.
func writeGrants(ctx context.Context, tx pgx.Tx, household, user uuid.UUID, grants map[string]access.Level) error {
	if len(grants) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, module := range slices.Sorted(maps.Keys(grants)) {
		batch.Queue(`
			INSERT INTO module_grants (household_id, user_id, module, level) VALUES ($1, $2, $3, $4)
			ON CONFLICT (household_id, user_id, module) DO UPDATE SET level = excluded.level`,
			household, user, module, grants[module].String())
	}
	return tx.SendBatch(ctx, batch).Close()
}

// touch bumps m's version for a change of what its row carries, its role, its grants or a child
// profile's lock, which a new PIN, a lock and an unlock change, and returns m as it stands with role.
func touch(ctx context.Context, tx pgx.Tx, m membership, role access.Role) (membership, error) {
	if err := tx.QueryRow(ctx, "UPDATE memberships SET role = $2 WHERE id = $1 RETURNING version", m.id, string(role)).
		Scan(&m.version); err != nil {
		return membership{}, err
	}
	m.role = role
	return m, nil
}

// enabledModules reads which of the household's modules it enables.
func enabledModules(ctx context.Context, tx pgx.Tx, household uuid.UUID) (map[string]bool, error) {
	rows, err := tx.Query(ctx, "SELECT module, enabled FROM module_enablement WHERE household_id = $1", household)
	if err != nil {
		return nil, err
	}
	out := map[string]bool{}
	var (
		module  string
		enabled bool
	)
	_, err = pgx.ForEachRow(rows, []any{&module, &enabled}, func() error {
		out[module] = enabled
		return nil
	})
	return out, err
}

// lostModules are the modules of modules that role and grants let a member see, with the household's
// enablement, and next and nextGrants do not.
func lostModules(modules []string, enabled map[string]bool, role access.Role, grants map[string]access.Level,
	next access.Role, nextGrants map[string]access.Level,
) []string {
	var out []string
	for _, m := range modules {
		before := tenant.Effective(role, m, enabled[m], grants[m])
		after := tenant.Effective(next, m, enabled[m], nextGrants[m])
		if before >= access.View && after < access.View {
			out = append(out, m)
		}
	}
	return out
}

// listMembers lists the household's members, their roles and every one's grants, which every member
// reads: the comparison is the point of the screen (FR-HA3, PRD modules/17 Permissions).
func (s *Service) listMembers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	var items []memberBody
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		modules := Modules
		h, err := readSettings(ctx, tx, scope.HouseholdID())
		if err != nil {
			return err
		}
		members, err := readMemberships(ctx, tx, scope.HouseholdID(), nil, false)
		if err != nil {
			return err
		}
		items = make([]memberBody, 0, len(members))
		for _, m := range members {
			items = append(items, m.body(scope, h.payer, modules))
		}
		return nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

// getMember answers one member, with their membership's version as its ETag.
func (s *Service) getMember(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	user, err := pathUUID(r, "user_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var body memberBody
	err = tenant.InTx(ctx, func(tx pgx.Tx) error {
		modules := Modules
		h, err := readSettings(ctx, tx, scope.HouseholdID())
		if err != nil {
			return err
		}
		m, err := readMembership(ctx, tx, scope.HouseholdID(), user, false)
		if err != nil {
			return err
		}
		body = m.body(scope, h.payer, modules)
		return nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	etag.Set(w, body.Version)
	httpx.WriteJSON(w, http.StatusOK, body)
}

// memberUpdate is the contract's MembershipUpdate.
type memberUpdate struct {
	Role   *access.Role            `json:"role"`
	Grants map[string]access.Level `json:"grants"`
}

// errLastOwner and errPayer are the refusals of a change that would leave the household with no
// owner, or its payer outside it or no longer an owner (FR-HH4, FR-HH6): billing moves only between
// owners.
var (
	errLastOwner = problem.New(http.StatusConflict, problem.CodeLastOwner)
	errPayer     = problem.New(http.StatusConflict, problem.CodeBillingPayer)
)

// otherOwners counts household's owners other than user.
func otherOwners(ctx context.Context, tx pgx.Tx, household, user uuid.UUID) (int, error) {
	var n int
	err := tx.QueryRow(ctx, "SELECT count(*) FROM memberships WHERE household_id = $1 AND role = 'owner' AND user_id <> $2",
		household, user).Scan(&n)
	return n, err
}

// checkGrants refuses a level in grants for a module the household does not know, or above the
// ceiling of role there (FR-AC4), naming each by its pointer under field; an owner, who holds Manage
// everywhere, can be granted nothing less.
func checkGrants(field string, grants map[string]access.Level, role access.Role, modules []string) error {
	var errs []problem.FieldError
	for _, m := range slices.Sorted(maps.Keys(grants)) {
		level := grants[m]
		switch {
		case !slices.Contains(modules, m):
		case role == access.Owner && level != access.Manage:
		case level > access.Ceiling(role, m):
		default:
			continue
		}
		errs = append(errs, problem.FieldError{Field: field + "/" + escapePointer(m), Code: problem.FieldInvalid})
	}
	if len(errs) > 0 {
		return problem.Validation(errs...)
	}
	return nil
}

// updateMember changes a member's role or grants (FR-HA5), an owner's to change, under If-Match. It
// takes effect on the member's next request. A child stays a child, since a child profile is made
// and graduated rather than given a role (FR-CH1, FR-CH4); an owner made a member keeps the levels
// they held, until the same or a later change lowers them, and the invitations they sent that are
// still waiting are withdrawn (D-103). The last owner and the payer stay owners.
// What the member can no longer see is retracted from their replica (Hooks.Lost), and they are told
// (Hooks.Changed, D-78).
func (s *Service) updateMember(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if err := owner(ctx); err != nil {
		s.fail(w, r, err)
		return
	}
	user, err := pathUUID(r, "user_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var req memberUpdate
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	precondition := etag.IfMatch(r)
	household := scope.HouseholdID()
	var (
		m       membership
		payer   *uuid.UUID
		modules = Modules
		changed bool
	)
	_, err = mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		var err error
		if payer, err = lockAsOwner(ctx, tx); err != nil {
			return mutation.Record{}, err
		}
		old, err := readMembership(ctx, tx, household, user, true)
		if err != nil {
			return mutation.Record{}, err
		}
		m = old
		if !precondition.Allows(old.version) {
			return mutation.Record{}, problem.Conflict(old.body(scope, payer, modules), old.version)
		}
		role := old.role
		if req.Role != nil {
			role = *req.Role
		}
		if role != old.role && (role == access.Child || old.role == access.Child) {
			return mutation.Record{}, invalid("/role", problem.FieldInvalid)
		}
		if old.role == access.Owner && role != access.Owner {
			others, err := otherOwners(ctx, tx, household, user)
			switch {
			case err != nil:
				return mutation.Record{}, err
			case others == 0:
				return mutation.Record{}, errLastOwner
			case payer != nil && *payer == user:
				return mutation.Record{}, errPayer
			}
		}
		if err := checkGrants("/grants", req.Grants, role, modules); err != nil {
			return mutation.Record{}, err
		}
		grants := maps.Clone(old.grants)
		if role == access.Owner && old.role != access.Owner {
			grants = Defaults(access.Owner, modules)
		}
		maps.Copy(grants, req.Grants)
		diffs := memberDiffs(old.role, role, old.grants, grants, modules)
		if len(diffs) == 0 {
			return mutation.Record{}, nil
		}
		changed = true
		if err := writeGrants(ctx, tx, household, user, changedGrants(old.grants, grants, modules)); err != nil {
			return mutation.Record{}, err
		}
		if m, err = touch(ctx, tx, old, role); err != nil {
			return mutation.Record{}, err
		}
		m.grants = grants
		enabled, err := enabledModules(ctx, tx, household)
		if err != nil {
			return mutation.Record{}, err
		}
		loss := Loss{Household: household, Cause: CauseGrant, Members: map[uuid.UUID][]string{}}
		if lost := lostModules(modules, enabled, old.role, old.grants, role, grants); len(lost) > 0 {
			loss.Members[user] = lost
		}
		if err := s.Hooks.lost(ctx, tx, loss); err != nil {
			return mutation.Record{}, err
		}
		changes := []sync.Change{m.change(household, payer, modules)}
		if old.role == access.Owner && role != access.Owner {
			withdrawn, err := withdraw(ctx, tx, household, user, s.Now())
			if err != nil {
				return mutation.Record{}, err
			}
			changes = append(changes, withdrawn...)
		}
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: actionMemberUpdate, EntityType: entityMembership, EntityID: m.id,
				SummaryKey: Name + "." + actionMemberUpdate, SummaryArgs: map[string]any{"member": m.name}, Changes: diffs,
			},
			Changes: changes,
		}, nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if changed {
		s.changed(ctx, Change{Household: household, Member: user, Cause: CauseGrant})
	}
	etag.Set(w, m.version)
	httpx.WriteJSON(w, http.StatusOK, m.body(scope, payer, modules))
}

// changedGrants are the levels of next that differ from old's.
func changedGrants(old, next map[string]access.Level, modules []string) map[string]access.Level {
	out := map[string]access.Level{}
	for _, m := range modules {
		if old[m] != next[m] {
			out[m] = next[m]
		}
	}
	return out
}

// memberDiffs are a membership's changes as the audit event's diffs (FR-AU2: every permission and
// membership change): its role, and each module's level as grants.<module>.
func memberDiffs(role, nextRole access.Role, grants, next map[string]access.Level, modules []string) []audit.Change {
	var out []audit.Change
	if role != nextRole {
		out = append(out, audit.Change{Field: "role", Old: role, New: nextRole})
	}
	for _, m := range modules {
		if grants[m] != next[m] {
			out = append(out, audit.Change{Field: "grants." + m, Old: grants[m], New: next[m]})
		}
	}
	return out
}

// joinDiffs are a new membership as the audit event's diffs: its role, and each level it gives above
// none, from nothing.
func joinDiffs(role access.Role, grants map[string]access.Level, modules []string) []audit.Change {
	out := []audit.Change{{Field: "role", Old: nil, New: role}}
	for _, m := range modules {
		if grants[m] > access.None {
			out = append(out, audit.Change{Field: "grants." + m, Old: nil, New: grants[m]})
		}
	}
	return out
}

// changed tells the Changed hook of change, when one is set.
func (s *Service) changed(ctx context.Context, change Change) {
	if s.Hooks.Changed != nil {
		s.Hooks.Changed(context.WithoutCancel(ctx), change)
	}
}

// removeMember removes a member (FR-HH5), an owner's to do, and never the caller, who leaves instead.
// It is immediate: their next request finds no membership, their replica loses the household
// (Hooks.Lost), no invitation they sent brings them back (withdraw), and they are told
// (Hooks.Changed). The payer is refused until billing moves, and the content they made stays with
// the household. A child profile removed is signed out of every device.
func (s *Service) removeMember(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if err := owner(ctx); err != nil {
		s.fail(w, r, err)
		return
	}
	user, err := pathUUID(r, "user_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if user == scope.UserID() {
		s.fail(w, r, forbidden())
		return
	}
	household := scope.HouseholdID()
	removed := false
	_, err = mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		payer, err := lockAsOwner(ctx, tx)
		if err != nil {
			return mutation.Record{}, err
		}
		m, err := readMembership(ctx, tx, household, user, true)
		if err != nil {
			return mutation.Record{}, err
		}
		if payer != nil && *payer == user {
			return mutation.Record{}, errPayer
		}
		// A child profile is nothing outside its household, and nobody can sign it in again once it
		// is out of it (ADR 0012): it is signed out of every device it was signed in on, as a new PIN
		// signs it out, rather than left with a sign-in to an account with no household.
		//
		// Its PIN's updated_at moves first, under the row's lock, as a new PIN's does (setPIN). A
		// sign-in reads the membership this deletes without waiting for it, and holds the PIN alone
		// (findPIN): one that held it first has finished when the devices are signed out below, and
		// is signed out with them; one that reaches it after waits for this to commit, and finds the
		// PIN it checked moved, and signs nobody in. Left alone, the PIN would let a sign-in commit
		// between the sign-out and the removal's commit, keeping a device's sign-in to the profile.
		if m.role == access.Child {
			if _, err := tx.Exec(ctx, "UPDATE credentials SET updated_at = clock_timestamp() WHERE user_id = $1 AND type = 'child_pin'",
				user); err != nil {
				return mutation.Record{}, err
			}
			if err := s.Accounts.Devices.RevokeAll(ctx, tx, user, uuid.Nil); err != nil {
				return mutation.Record{}, err
			}
		}
		rec, err := s.end(ctx, tx, household, m, CauseRemoved, actionMemberRemove)
		removed = err == nil
		return rec, err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if removed {
		s.changed(ctx, Change{Household: household, Member: user, Cause: CauseRemoved})
	}
	w.WriteHeader(http.StatusNoContent)
}

// end deletes m, a member leaving or removed from household for cause, their grants and their
// Idempotency-Keys in it with it, withdraws the invitations they sent that are still waiting, and
// returns the mutation's record, recorded as action.
func (s *Service) end(ctx context.Context, tx pgx.Tx, household uuid.UUID, m membership, cause Cause, action string) (mutation.Record, error) {
	if _, err := tx.Exec(ctx, "DELETE FROM memberships WHERE id = $1", m.id); err != nil {
		return mutation.Record{}, err
	}
	withdrawn, err := withdraw(ctx, tx, household, m.user, s.Now())
	if err != nil {
		return mutation.Record{}, err
	}
	if err := s.Hooks.lost(ctx, tx, Loss{Household: household, Cause: cause, Members: map[uuid.UUID][]string{m.user: nil}}); err != nil {
		return mutation.Record{}, err
	}
	return mutation.Record{
		Event: audit.Event{
			Module: Name, Action: action, EntityType: entityMembership, EntityID: m.id,
			SummaryKey: Name + "." + action, SummaryArgs: map[string]any{"member": m.name},
			Changes: []audit.Change{{Field: "role", Old: m.role, New: nil}},
		},
		Changes: append([]sync.Change{m.gone()}, withdrawn...),
	}, nil
}

// leaveBlocked is the contract's LeaveBlockedProblem: every reason the caller cannot leave yet, at
// once, since a payer who is also the last owner has two things to do (FR-HH4).
func leaveBlocked(reasons []problem.Code) *problem.Problem {
	p := problem.New(http.StatusConflict, reasons[0])
	p.Extensions = map[string]any{"blocked_by": reasons}
	return p
}

// leave takes the caller out of the household (FR-HH4), which any member may do at any time, unless
// they are its last owner, or its payer, which are refused together. What they made stays with the
// household; their private root is item 20's (Hooks.Lost); the invitations they sent that are still
// waiting are withdrawn (withdraw). A child profile does not leave, since it is nothing outside its
// household, and is refused 403: an owner removes it (D-104).
func (s *Service) leave(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	household, user := scope.HouseholdID(), scope.UserID()
	_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		payer, err := lockHousehold(ctx, tx, household)
		if err != nil {
			return mutation.Record{}, err
		}
		m, err := readMembership(ctx, tx, household, user, true)
		if err != nil {
			return mutation.Record{}, err
		}
		if m.role == access.Child {
			return mutation.Record{}, forbidden()
		}
		var blocked []problem.Code
		if m.role == access.Owner {
			others, err := otherOwners(ctx, tx, household, user)
			if err != nil {
				return mutation.Record{}, err
			}
			if others == 0 {
				blocked = append(blocked, problem.CodeLastOwner)
			}
		}
		if payer != nil && *payer == user {
			blocked = append(blocked, problem.CodeBillingPayer)
		}
		if len(blocked) > 0 {
			return mutation.Record{}, leaveBlocked(blocked)
		}
		return s.end(ctx, tx, household, m, CauseLeft, actionMemberLeave)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// promoteRequest is the body of the ownership transfer.
type promoteRequest struct {
	UserID uuid.UUID `json:"user_id"`
}

// promote makes a member an owner (FR-HH6, FR-HA17), an owner's to do: there may be several, and
// billing does not move with it. The new owner holds Manage on every module, which they keep if made
// a member again. A child cannot be an owner.
func (s *Service) promote(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if err := owner(ctx); err != nil {
		s.fail(w, r, err)
		return
	}
	var req promoteRequest
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	household := scope.HouseholdID()
	var (
		m        membership
		payer    *uuid.UUID
		modules  = Modules
		promoted bool
	)
	_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		var err error
		if payer, err = lockAsOwner(ctx, tx); err != nil {
			return mutation.Record{}, err
		}
		old, err := readMembership(ctx, tx, household, req.UserID, true)
		if err != nil {
			return mutation.Record{}, err
		}
		m = old
		switch old.role {
		case access.Owner:
			return mutation.Record{}, nil
		case access.Child:
			return mutation.Record{}, invalid("/user_id", problem.FieldInvalid)
		case access.Member:
		}
		grants := Defaults(access.Owner, modules)
		if err := writeGrants(ctx, tx, household, old.user, grants); err != nil {
			return mutation.Record{}, err
		}
		if m, err = touch(ctx, tx, old, access.Owner); err != nil {
			return mutation.Record{}, err
		}
		m.grants = grants
		promoted = true
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: actionMemberPromote, EntityType: entityMembership, EntityID: m.id,
				SummaryKey: Name + "." + actionMemberPromote, SummaryArgs: map[string]any{"member": m.name},
				Changes: memberDiffs(old.role, access.Owner, old.grants, grants, modules),
			},
			Changes: []sync.Change{m.change(household, payer, modules)},
		}, nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if promoted {
		s.changed(ctx, Change{Household: household, Member: req.UserID, Cause: CauseGrant})
	}
	etag.Set(w, m.version)
	httpx.WriteJSON(w, http.StatusOK, m.body(scope, payer, modules))
}
