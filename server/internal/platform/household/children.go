package household

import (
	"context"
	"errors"
	"log/slog"
	"maps"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/avatar"
	"github.com/kareltilcer/household/server/internal/platform/clientip"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/etag"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/text"
)

// A child profile (PRD 02 §6, ADR 0012) is an account with no address whose one credential is a PIN,
// child_pin, and a membership of the household whose owner made it, whose role is child. It signs in
// with the household's code, which says which household, its profile, picked from the list the code
// opens, and the PIN, on a device, as a mobile sign-in does. A shared tablet holds one such sign-in
// per profile, and the client switches between them (D-104).

// LockAfter is how many wrong PINs since its last right one lock a child profile, until an owner
// unlocks it or sets a new PIN (FR-CH5, D-104).
const LockAfter = 10

// GraduateFor is how long a graduation's link works: an email invitation's fourteen days, since each
// is an owner's email asking someone into a membership.
const GraduateFor = EmailFor

// The email a graduation sends, and the web client's route its link opens.
const (
	emailGraduate mail.Template = "email.graduate"

	routeGraduate = "graduate"
)

// errLocked is the answer to every attempt at a locked profile's PIN.
var errLocked = problem.New(http.StatusLocked, problem.CodeChildProfileLocked)

// joinCode is code as a household keeps it: in capitals, and without the spaces and dashes a person
// types between the groups a client shows it in (FR-CH1). Every space and every dash Unicode has
// goes, not only the ASCII ones: a keyboard's smart punctuation may make " - " an en dash, a code
// copied from a screen may carry a non-breaking space or hyphen, and a right code refused for either
// would count against the network's lookups as a guess does.
func joinCode(code string) string {
	return strings.ToUpper(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || unicode.Is(unicode.Pd, r) {
			return -1
		}
		return r
	}, code))
}

// network is the client's network, as a throttle counts it.
func (s *Service) network(r *http.Request) string {
	return clientip.Network(s.Accounts.ClientIP.Addr(r))
}

// childEntry is one child profile of the contract's ChildProfileList, with a link to its picture.
type childEntry struct {
	ID          uuid.UUID `json:"id"`
	DisplayName string    `json:"display_name"`
	AvatarURL   *string   `json:"avatar_url"`
}

// childProfiles is postAuthChildProfiles, the first step of a child's sign-in (A-14, A-15): the
// household a code opens, by its name, and its child profiles, in the order they were made, to pick
// one from. An adult, who signs in by email, is not listed (D-104). A code that opens no household
// answers 404 and counts against the client's network, which may look up thirty such an hour
// (ratelimit.ChildCodeNetwork): the code identifies a household and authenticates nobody, so guessing
// codes is what is limited. The code of a suspended household opens nothing, as nothing in it is
// found (D-115).
func (s *Service) childProfiles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		HouseholdCode string `json:"household_code"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	// Counted before it is looked up, as a sign-in's failure is, and taken back once the code opens a
	// household, so that lookups sent at once meet the limit one by one.
	network := s.network(r)
	if wait, err := s.Throttles.Attempt(ctx, ratelimit.Count{Limit: ratelimit.ChildCodeNetwork, Subject: network}); err != nil || wait > 0 {
		s.fail(w, r, ratelimit.Verdict(wait, err))
		return
	}
	var (
		household uuid.UUID
		name      string
	)
	err := tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		code := joinCode(req.HouseholdCode)
		if _, err := tx.Exec(ctx, "SELECT set_config('app.join_code', $1, true)", code); err != nil {
			return err
		}
		return tx.QueryRow(ctx, "SELECT id, name FROM households WHERE join_code = $1 AND suspended_at IS NULL", code).
			Scan(&household, &name)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		err = problem.NotFound()
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.Throttles.Refund(ctx, ratelimit.ChildCodeNetwork, network); err != nil {
		s.fail(w, r, err)
		return
	}
	items := []childEntry{}
	err = s.readTx(ctx, household, uuid.Nil, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT m.user_id, u.display_name, `+avatar.Columns("m.user_id")+`
			FROM memberships m JOIN users u ON u.id = m.user_id
			WHERE m.household_id = $1 AND m.role = 'child'
			ORDER BY m.created_at, m.id`, household)
		if err != nil {
			return err
		}
		items, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (childEntry, error) {
			var (
				e       childEntry
				picture avatar.Ref
			)
			err := row.Scan(&e.ID, &e.DisplayName, &picture.ID, &picture.ContentType)
			// The code opened the household, which is what lets its holder see its profiles to pick one.
			e.AvatarURL = s.Accounts.Avatars.URL(ctx, e.ID, picture)
			return e, err
		})
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"household_name": name, "items": items})
}

// pin is a child profile's PIN as a sign-in finds it: the household whose code found it, its hash,
// its updated_at, which moves whenever an owner sets it, unlocks it or removes its profile, and the
// wrong ones counted since the last right one, or since that moment when it is later.
type pin struct {
	household uuid.UUID
	secret    string
	set       time.Time
	failures  int
}

// findPIN reads profile's PIN in tx, locked for it, when profile is a child profile of the household
// whose code is code, and reports false for any other code and profile, and for a suspended
// household's, which signs nobody in (D-115). tx's caller is profile, whose own memberships, and the
// households they are in, it reads outside any household's context.
func findPIN(ctx context.Context, tx pgx.Tx, code string, profile uuid.UUID) (pin, bool, error) {
	var p pin
	err := tx.QueryRow(ctx, `
		SELECT m.household_id, c.secret, c.updated_at, c.failures
		FROM credentials c
		JOIN memberships m ON m.user_id = c.user_id AND m.role = 'child'
		JOIN households h ON h.id = m.household_id
		WHERE c.user_id = $1 AND c.type = 'child_pin' AND h.join_code = $2 AND h.suspended_at IS NULL
		FOR UPDATE OF c`, profile, code).Scan(&p.household, &p.secret, &p.set, &p.failures)
	if errors.Is(err, pgx.ErrNoRows) {
		return pin{}, false, nil
	}
	return p, err == nil, err
}

// childLogin is postAuthChildLogin (FR-CH1, FR-CH5): the household's code, a profile and its PIN sign
// the child in on the device the body names, with a device's token pair and no second step (FR-ID5,
// identity.SignInChild). A code, a profile or a PIN that does not match, a profile that is not a
// child's, and a profile of a suspended household (D-115), are one 401 in one time, as a password's
// sign-in's failures are, and count against the client's network as those do (ratelimit.LoginNetwork).
//
// A wrong PIN counts against the profile. It is counted before the PIN is checked, so that attempts
// sent at once meet the lock one by one, and a right PIN clears the count: LockAfter wrong ones in a
// row lock the profile until an owner unlocks it or sets a new PIN, and every attempt at a locked
// profile, the one that locked it included, answers 423 (D-104), a right PIN that another attempt's
// lock overtook while it was checked among them. So once LockAfter are counted, no attempt that
// follows has its PIN checked until an owner acts, however many are sent at once. What the count
// bounds is the wrong PINs since the last right one, as FR-CH5 has it, not every PIN checked between
// two unlocks: a right one starts it again.
func (s *Service) childLogin(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		HouseholdCode string                `json:"household_code"`
		ProfileID     uuid.UUID             `json:"profile_id"`
		PIN           string                `json:"pin"`
		Device        identity.DeviceSignIn `json:"device"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	if req.Device.ID == uuid.Nil {
		s.fail(w, r, invalid("/device/id", problem.FieldInvalid))
		return
	}
	network := s.network(r)
	if wait, err := s.Throttles.Attempt(ctx, ratelimit.Count{Limit: ratelimit.LoginNetwork, Subject: network}); err != nil || wait > 0 {
		s.fail(w, r, ratelimit.Verdict(wait, err))
		return
	}
	code, profile := joinCode(req.HouseholdCode), req.ProfileID
	var (
		p              pin
		found, blocked bool
	)
	err := tenant.AccountTx(ctx, s.Pool, profile, func(tx pgx.Tx) error {
		var err error
		if p, found, err = findPIN(ctx, tx, code, profile); err != nil || !found {
			return err
		}
		if blocked = p.failures >= LockAfter; blocked {
			return nil
		}
		p.failures++
		_, err = tx.Exec(ctx, "UPDATE credentials SET failures = $2 WHERE user_id = $1 AND type = 'child_pin'", profile, p.failures)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	// fail answers err to an attempt that signs nobody in, wrong when its PIN was checked and found
	// wrong. The attempt that counted the tenth locks the profile unless it signs the child in: a wrong
	// PIN leaves the count at ten, and so does a check or a sign-in that ended otherwise, a client that
	// went away while its PIN waited to be hashed among them, since only a right PIN that signs in
	// clears it. So the lock is recorded whatever ended the attempt, and beyond its client, so that the
	// owners and every replica read what every later attempt is told; a wrong PIN is then answered 423,
	// and any other end as it ended. A record the database refused leaves the lock standing
	// unrecorded until an owner acts, as a count at ten is the lock (ADR 0012).
	fail := func(err error, wrong bool) {
		if found && p.failures == LockAfter {
			locked, lockErr := s.lockChild(context.WithoutCancel(ctx), p.household, profile, p.set)
			switch {
			case !wrong:
				if lockErr != nil {
					s.Log.LogAttrs(ctx, slog.LevelError, "child profile's lock not recorded", slog.Any("error", lockErr))
				}
			case lockErr != nil:
				err = lockErr
			case locked:
				err = errLocked
			}
		}
		s.fail(w, r, err)
	}
	hasher := s.Accounts.Hasher
	var ok, rehash bool
	switch {
	case !found:
		// The same hash as a PIN that is wrong, so that the answer's time says nothing either.
		err = hasher.Burn(ctx, req.PIN)
	case blocked:
		s.fail(w, r, errLocked)
		return
	default:
		ok, rehash, err = hasher.Verify(ctx, req.PIN, p.secret)
	}
	switch {
	case err != nil:
		fail(err, false)
		return
	case !ok:
		fail(identity.InvalidCredentials(), true)
		return
	}
	// The attempt succeeded: the network's count takes it back.
	if err := s.Throttles.Refund(ctx, ratelimit.LoginNetwork, network); err != nil {
		fail(err, false)
		return
	}
	var newSecret string
	if rehash {
		if newSecret, err = hasher.Hash(ctx, req.PIN); err != nil {
			fail(err, false)
			return
		}
	}
	var result identity.LoginResult
	err = tenant.AccountTx(ctx, s.Pool, profile, func(tx pgx.Tx) error {
		// The PIN was checked before this transaction: an owner's new PIN since then, their unlock, a
		// graduation or the profile's removal wins, and this one signs nobody in. A graduation deletes
		// the PIN; each of the others moves its updated_at, an unlock too, since the count this attempt
		// read, and a lock it counted, belong to the time before it.
		//
		// So does a lock another attempt counted meanwhile. The count never passes LockAfter, since an
		// attempt at it is refused uncounted, and while updated_at stays where it was, only a right
		// PIN's sign-in brings it down, which no attempt but the tenth's own reaches once the tenth is
		// counted: a count at LockAfter above this attempt's own is another's tenth, which locked the
		// profile if it was wrong, and one at LockAfter that this attempt counted is its own. A right
		// PIN given after a lock opens it no more than a wrong one does. Were it let in, it would clear
		// a lock the owners and the replicas have read, with no record of it.
		now, found, err := findPIN(ctx, tx, code, profile)
		switch {
		case err != nil:
			return err
		case !found || !now.set.Equal(p.set):
			return identity.InvalidCredentials()
		case now.failures >= LockAfter && p.failures < LockAfter:
			return errLocked
		}
		// The same PIN, hashed again, is no change of it: its updated_at stays.
		if _, err := tx.Exec(ctx, `
			UPDATE credentials SET failures = 0, secret = coalesce(nullif($2, ''), secret) WHERE user_id = $1 AND type = 'child_pin'`,
			profile, newSecret); err != nil {
			return err
		}
		result, err = s.Accounts.SignInChild(ctx, tx, r, profile, req.Device)
		return err
	})
	if err != nil {
		fail(err, false)
		return
	}
	identity.NoStore(w)
	httpx.WriteJSON(w, http.StatusOK, result)
}

// lockChild records that profile, a child profile of household, is locked, as the system's change of
// its membership, and reports whether it was: the attempt that counted the LockAfter-th wrong PIN,
// having read the PIN's updated_at as set, locked it when it signed nobody in, unless an owner has
// since set a new PIN, unlocked the profile or removed it, when nothing is recorded. Each of those
// moves updated_at, and the count is then another's: a count at LockAfter under a later updated_at is
// a later attempt's tenth, whose lock that attempt records, and this one would record it twice. The
// membership's row carries the lock to the household's replicas.
func (s *Service) lockChild(ctx context.Context, household, profile uuid.UUID, set time.Time) (bool, error) {
	scoped := mutation.WithVia(tenant.Assume(ctx, s.Pool, household, uuid.Nil, access.Child), audit.ViaMobile)
	locked := false
	_, err := mutation.Apply(scoped, func(tx pgx.Tx) (mutation.Record, error) {
		payer, err := lockHousehold(ctx, tx, household)
		if err != nil {
			return mutation.Record{}, err
		}
		m, err := readMembership(ctx, tx, household, profile, true)
		var p *problem.Problem
		switch {
		case errors.As(err, &p):
			return mutation.Record{}, nil
		case err != nil:
			return mutation.Record{}, err
		}
		failures, at, err := lockPIN(ctx, tx, m)
		if err != nil || failures < LockAfter || !at.Equal(set) {
			return mutation.Record{}, err
		}
		m.child.pinLocked, locked = true, true
		if m, err = touch(ctx, tx, m, m.role, m.grants); err != nil {
			return mutation.Record{}, err
		}
		// The owners are told, since only they can unlock it (A-18).
		notices, err := lockNotices(ctx, tx, household, m)
		if err == nil {
			err = s.Notify.Queue(scoped, tx, notices...)
		}
		if err != nil {
			return mutation.Record{}, err
		}
		return childRecord(household, payer, m, actionChildLock), nil
	})
	if locked && err == nil {
		s.Notify.Nudge(ctx, household)
	}
	return locked && err == nil, err
}

// messageChildLocked is the push that tells the owners a child profile locked.
const messageChildLocked = "notification.child_locked"

// lockNotices are the notices to each of household's owners, read in tx, that m, a child profile's
// membership, locked: someone who means them, the child asking to be let in.
func lockNotices(ctx context.Context, tx pgx.Tx, household uuid.UUID, m membership) ([]notify.Notification, error) {
	owners, err := tenant.Owners(ctx, tx, household)
	if err != nil {
		return nil, err
	}
	out := make([]notify.Notification, 0, len(owners))
	for _, o := range owners {
		out = append(out, notify.Notification{
			To: o, Category: notify.Direct, Message: messageChildLocked, Args: i18n.Args{"member": m.name}, Module: Name,
			Link: "/households/" + household.String() + "/members/" + m.user.String(), Coalesce: "child_locked:" + m.user.String(),
		})
	}
	return out, nil
}

// lockPIN locks the PIN of m, a child profile's membership, in tx, and returns the wrong PINs it has
// counted since its last right one, and its updated_at, which a sign-in reads as pin.set; -1 when m
// is no child profile's, which has none.
func lockPIN(ctx context.Context, tx pgx.Tx, m membership) (int, time.Time, error) {
	if m.child == nil {
		return -1, time.Time{}, nil
	}
	var (
		failures int
		at       time.Time
	)
	err := tx.QueryRow(ctx, "SELECT failures, updated_at FROM credentials WHERE user_id = $1 AND type = 'child_pin' FOR UPDATE", m.user).
		Scan(&failures, &at)
	if errors.Is(err, pgx.ErrNoRows) {
		return -1, time.Time{}, nil
	}
	return failures, at, err
}

// childRecord is the record of action on child profile m's membership, as it stands after it.
func childRecord(household uuid.UUID, payer *uuid.UUID, m membership, action string) mutation.Record {
	return mutation.Record{
		Event: audit.Event{
			Module: Name, Action: action, EntityType: entityMembership, EntityID: m.id,
			SummaryKey: Name + "." + action, SummaryArgs: map[string]any{"member": m.name},
		},
		Changes: []sync.Change{m.change(household, payer, Modules)},
	}
}

// childCreate is the contract's ChildProfileCreate.
type childCreate struct {
	ID            uuid.UUID               `json:"id"`
	DisplayName   string                  `json:"display_name"`
	YearOfBirth   *int                    `json:"year_of_birth"`
	AvatarURL     *string                 `json:"avatar_url"`
	PIN           string                  `json:"pin"`
	Grants        map[string]access.Level `json:"grants"`
	LockDashboard *bool                   `json:"lock_dashboard"`
}

// check canonicalises the name req gives and refuses what is wrong with it, each field by its
// pointer: a name with nothing in it or a control character, a birth year after thisYear, the
// household's, an avatar other than none, since a picture is uploaded once the profile exists
// (putChildAvatar) and never named by a URL, and a level above a child's ceiling (FR-AC4). The edge
// has checked the types, the name's length, the earliest year and the PIN's digits.
func (req *childCreate) check(thisYear int) error {
	var errs []problem.FieldError
	name, ok := text.Name(req.DisplayName)
	if !ok {
		errs = append(errs, problem.FieldError{Field: "/display_name", Code: problem.FieldInvalid})
	}
	req.DisplayName = name
	if req.YearOfBirth != nil && *req.YearOfBirth > thisYear {
		errs = append(errs, problem.FieldError{Field: "/year_of_birth", Code: problem.FieldInvalid})
	}
	if req.AvatarURL != nil {
		errs = append(errs, problem.FieldError{Field: "/avatar_url", Code: problem.FieldInvalid})
	}
	if err := checkGrants("/grants", req.Grants, access.Child, Modules); err != nil {
		var p *problem.Problem
		if errors.As(err, &p) {
			errs = append(errs, p.Errors...)
		}
	}
	if len(errs) > 0 {
		return problem.Validation(errs...)
	}
	return nil
}

// thisYear is the year it is in the household of ctx, in its timezone, where its calendar days are
// counted: a birth year after it has not begun there yet, whatever year the server's clock is in.
func (s *Service) thisYear(ctx context.Context) (int, error) {
	var zone string
	if err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, "SELECT timezone FROM households WHERE id = $1", tenant.From(ctx).HouseholdID()).Scan(&zone)
	}); err != nil {
		return 0, err
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return 0, err
	}
	return s.Now().In(loc).Year(), nil
}

// createChild is postChildren (FR-CH1, FR-HA7): an owner makes a child profile, an account with no
// address whose credential is the PIN, and a child's membership of the household, whose levels are
// FR-AC4's with the request's over them, never manage, nor more than view on Finance. The id is the
// profile's, its account's and its membership's alike, and one another account or membership has is
// refused 422 naming /id. The profile speaks the household's language, and its dashboard is locked
// unless the request says otherwise. No Idempotency-Key is kept, whose fingerprint would be a fast
// hash of the PIN (PINRoutes): a repeat of one that was made is refused for its id.
func (s *Service) createChild(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if err := owner(ctx); err != nil {
		s.fail(w, r, err)
		return
	}
	var req childCreate
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	thisYear, err := s.thisYear(ctx)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if err := req.check(thisYear); err != nil {
		s.fail(w, r, err)
		return
	}
	secret, err := s.Accounts.Hasher.Hash(ctx, req.PIN)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	household, modules := scope.HouseholdID(), Modules
	lock := req.LockDashboard == nil || *req.LockDashboard
	var (
		m       membership
		payer   *uuid.UUID
		noticed bool
	)
	_, err = mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		var err error
		if payer, err = lockAsOwner(ctx, tx); err != nil {
			return mutation.Record{}, err
		}
		members, err := memberCeiling(ctx, tx, household)
		if err != nil {
			return mutation.Record{}, err
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO users (id, display_name, locale) SELECT $1, $2, locale FROM households WHERE id = $3
			ON CONFLICT (id) DO NOTHING`, req.ID, req.DisplayName, household)
		switch {
		case err != nil:
			return mutation.Record{}, err
		case tag.RowsAffected() == 0:
			return mutation.Record{}, invalid("/id", problem.FieldInvalid)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO credentials (user_id, type, secret) VALUES ($1, 'child_pin', $2)", req.ID, secret); err != nil {
			return mutation.Record{}, err
		}
		grants := Defaults(access.Child, modules)
		maps.Copy(grants, req.Grants)
		m, err = insertProfile(ctx, tx, req.ID, household, req.ID, access.Child, grants,
			childProfile{yearOfBirth: req.YearOfBirth, dashboardLocked: lock})
		if db.UniqueViolation(err, "memberships_pkey") {
			return mutation.Record{}, invalid("/id", problem.FieldInvalid)
		}
		if err != nil {
			return mutation.Record{}, err
		}
		if noticed, err = s.membersNotice(ctx, tx, household, members); err != nil {
			return mutation.Record{}, err
		}
		rec := childRecord(household, payer, m, actionChildCreate)
		rec.Event.Changes = joinDiffs(access.Child, grants, modules)
		return rec, nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if noticed {
		s.Notify.Nudge(ctx, household)
	}
	etag.Set(w, m.version)
	httpx.WriteJSON(w, http.StatusCreated, s.member(ctx, scope, payer, modules, m))
}

// childOf reads the membership of the child profile the request's {user_id} names, locked for tx,
// with the household's payer, once the caller is found an owner still under the household's lock: a
// member who is not a child profile is not found.
func childOf(ctx context.Context, tx pgx.Tx, user uuid.UUID) (membership, *uuid.UUID, error) {
	payer, err := lockAsOwner(ctx, tx)
	if err != nil {
		return membership{}, nil, err
	}
	m, err := readMembership(ctx, tx, tenant.From(ctx).HouseholdID(), user, true)
	switch {
	case err != nil:
		return membership{}, nil, err
	case m.child == nil:
		return membership{}, nil, problem.NotFound()
	}
	return m, payer, nil
}

// setPIN is putChildrenByUserIdPin (FR-CH5): an owner sets a child profile's PIN, which unlocks it
// too, and signs it out of every device it is signed in on, since whoever knew the old PIN may hold
// one of them (D-104). A sign-in checking the old PIN meanwhile signs nobody in. No Idempotency-Key is
// kept (PINRoutes): a repeat sets the same PIN again.
func (s *Service) setPIN(w http.ResponseWriter, r *http.Request) {
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
	var req struct {
		PIN string `json:"pin"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	secret, err := s.Accounts.Hasher.Hash(ctx, req.PIN)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	household := scope.HouseholdID()
	_, err = mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		m, payer, err := childOf(ctx, tx, user)
		if err != nil {
			return mutation.Record{}, err
		}
		if _, _, err := lockPIN(ctx, tx, m); err != nil {
			return mutation.Record{}, err
		}
		// updated_at is the moment it is written, under the row's lock, so that a sign-in that
		// checked the old PIN finds it changed.
		if _, err := tx.Exec(ctx, `
			UPDATE credentials SET secret = $2, updated_at = clock_timestamp(), failures = 0 WHERE user_id = $1 AND type = 'child_pin'`,
			user, secret); err != nil {
			return mutation.Record{}, err
		}
		if err := s.Accounts.Devices.RevokeAll(ctx, tx, user, uuid.Nil); err != nil {
			return mutation.Record{}, err
		}
		m.child.pinLocked = false
		if m, err = touch(ctx, tx, m, m.role, m.grants); err != nil {
			return mutation.Record{}, err
		}
		return childRecord(household, payer, m, actionChildPIN), nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// unlockChild is postChildrenByUserIdUnlock (FR-CH5): an owner lifts a child profile's lock, and its
// wrong PINs are counted from none again. The PIN's updated_at moves with it, under the row's lock, as
// a new PIN's does (setPIN), since a count of ten before the unlock and one after it are the same
// number, and only updated_at tells them apart: a sign-in that read the PIN before the unlock, the one
// that counted the tenth among them, then signs nobody in after it, and records no lock, where it
// would take the tenth of ten more counted meanwhile for its own (childLogin, lockChild). A profile
// that is not locked is left as it is, and nothing is recorded.
func (s *Service) unlockChild(w http.ResponseWriter, r *http.Request) {
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
	household := scope.HouseholdID()
	_, err = mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		m, payer, err := childOf(ctx, tx, user)
		if err != nil {
			return mutation.Record{}, err
		}
		failures, _, err := lockPIN(ctx, tx, m)
		if err != nil || failures < LockAfter {
			return mutation.Record{}, err
		}
		if _, err := tx.Exec(ctx, "UPDATE credentials SET failures = 0, updated_at = clock_timestamp() WHERE user_id = $1 AND type = 'child_pin'",
			user); err != nil {
			return mutation.Record{}, err
		}
		m.child.pinLocked = false
		if m, err = touch(ctx, tx, m, m.role, m.grants); err != nil {
			return mutation.Record{}, err
		}
		return childRecord(household, payer, m, actionChildUnlock), nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// putChildAvatar is putChildrenByUserIdAvatar: an owner gives a child profile a picture, made from an
// image they upload (avatar.Upload), in place of any it had, which goes once the new one is recorded.
// The picture is the child's account's, as a member's own is theirs (D-107), and counts against no
// household's storage; the membership's version moves with it, so an owner's edit made against the
// profile as it was is refused as a conflict. A member who is not a child profile is not found, and
// is looked for before the upload is read. It is an upload, which grace refuses as it refuses every
// other (PRD 04 §3), before the upload is read; the gate refuses it in every state that does not
// write.
func (s *Service) putChildAvatar(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if err := owner(ctx); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := scope.Entitlement().Uploadable(scope.Role()); err != nil {
		s.fail(w, r, err)
		return
	}
	user, err := pathUUID(r, "user_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	household := scope.HouseholdID()
	if err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		m, err := readMembership(ctx, tx, household, user, false)
		if err == nil && m.child == nil {
			err = problem.NotFound()
		}
		return err
	}); err != nil {
		s.fail(w, r, err)
		return
	}
	picture, err := s.Accounts.Avatars.Upload(w, r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.Accounts.Avatars.Put(ctx, user, picture); err != nil {
		s.fail(w, r, err)
		return
	}
	var (
		body     memberBody
		replaced uuid.UUID
	)
	_, err = mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		m, payer, err := childOf(ctx, tx, user)
		if err != nil {
			return mutation.Record{}, err
		}
		if replaced, err = avatar.Set(ctx, tx, user, picture); err != nil {
			return mutation.Record{}, err
		}
		if m, err = touch(ctx, tx, m, m.role, m.grants); err != nil {
			return mutation.Record{}, err
		}
		m.picture = avatar.Ref{ID: &picture.ID, ContentType: &picture.ContentType}
		body = s.member(ctx, scope, payer, Modules, m)
		rec := childRecord(household, payer, m, actionChildAvatar)
		rec.Event.SummaryArgs["change"] = "set"
		return rec, nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.Accounts.Avatars.Purge(ctx, user, replaced)
	etag.Set(w, body.Version)
	httpx.WriteJSON(w, http.StatusOK, body)
}

// clearChildAvatar is deleteChildrenByUserIdAvatar: an owner takes a child profile's picture away. A
// profile with none is answered as it is, and nothing is recorded.
func (s *Service) clearChildAvatar(w http.ResponseWriter, r *http.Request) {
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
	household := scope.HouseholdID()
	var (
		body    memberBody
		cleared uuid.UUID
	)
	_, err = mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		m, payer, err := childOf(ctx, tx, user)
		if err != nil {
			return mutation.Record{}, err
		}
		if cleared, err = avatar.Clear(ctx, tx, user); err != nil || cleared == uuid.Nil {
			body = s.member(ctx, scope, payer, Modules, m)
			return mutation.Record{}, err
		}
		if m, err = touch(ctx, tx, m, m.role, m.grants); err != nil {
			return mutation.Record{}, err
		}
		m.picture = avatar.Ref{}
		body = s.member(ctx, scope, payer, Modules, m)
		rec := childRecord(household, payer, m, actionChildAvatar)
		rec.Event.SummaryArgs["change"] = "cleared"
		return rec, nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.Accounts.Avatars.Purge(ctx, user, cleared)
	etag.Set(w, body.Version)
	httpx.WriteJSON(w, http.StatusOK, body)
}

// graduate is postChildrenByUserIdGraduate (FR-CH4): an owner sends the address a child profile is to
// have a link, which works GraduateFor, with which the young adult chooses a password and becomes a
// member (confirmGraduation). The profile stays a child, signing in with its PIN, until then. The
// owner's address must be verified, as an invitation's sender's must: the link is trust extended past
// the household (FR-ID1). The link is the owner's, and lapses with their ownership, as an invitation
// does (D-103): it is spent with their invitations (withdraw), and its confirmation checks it too.
// Sending again sends a new link, to the same address or another, and the one before stops working,
// however many are sent at once. An address an account has is refused 409; each link counts among
// the household's twenty emails a day (ratelimit.InvitationHousehold), and so does each address
// refused, since the refusal says that an account has it: counted, an owner learns that of twenty
// addresses a day at most, as a sign-up tells nobody of any (D-13).
func (s *Service) graduate(w http.ResponseWriter, r *http.Request) {
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
	var req struct {
		Email string `json:"email"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	household := scope.HouseholdID()
	var letter notify.Notification
	err = tenant.InTx(ctx, func(tx pgx.Tx) error {
		m, err := readMembership(ctx, tx, household, user, false)
		switch {
		case err != nil:
			return err
		case m.child == nil:
			return problem.NotFound()
		}
		if err := verified(ctx, tx, scope.UserID()); err != nil {
			return err
		}
		var owner, name, locale string
		if err := tx.QueryRow(ctx, `
			SELECT o.display_name, h.name, c.locale FROM users o, households h, users c
			WHERE o.id = $1 AND h.id = $2 AND c.id = $3`, scope.UserID(), household, user).Scan(&owner, &name, &locale); err != nil {
			return err
		}
		// The link's email replaces the one still waiting for the profile, whose link this one retires.
		letter = notify.Notification{
			Address: req.Email, Locale: locale, Category: notify.Direct, Message: string(emailGraduate),
			Args: i18n.Args{"owner": owner, "household": name, "member": m.name}, Email: true, Route: routeGraduate,
			Replaces: graduationKey(user),
		}
		return nil
	})
	if err == nil {
		err = s.throttle(ctx, household)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	token, hash := newToken()
	letter.Secret = token
	// The link and its email are written in one transaction, so that the email is sent exactly when
	// the link exists; in the household's context, where the email waits, and the link's row, which is
	// the account's, is written as it is anywhere.
	err = tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		// The household first, which every change of a member's role or membership locks, and under it
		// the sender's ownership and the profile's membership read again: the profile's removal, or the
		// end of the sender's ownership, that committed since the read above spent the links it found
		// and withdrew their emails (removeMember, withdraw), and a link written after it would arrive
		// with its email all the same, to open nothing.
		if _, err := lockAsOwner(ctx, tx); err != nil {
			return err
		}
		m, err := readMembership(ctx, tx, household, user, false)
		switch {
		case err != nil:
			return err
		case m.child == nil:
			return problem.NotFound()
		}
		// The profile's account next, as its graduation's confirmation locks it before its links, so
		// that two links sent at once are written one after the other, and the later retires the
		// earlier: each statement reads what had committed when it began, and neither sending would
		// otherwise see the other's link to retire it.
		if _, err := tx.Exec(ctx, "SELECT FROM users WHERE id = $1 FOR NO KEY UPDATE", user); err != nil {
			return err
		}
		var taken bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM users WHERE lower(email) = lower($1))", req.Email).Scan(&taken); err != nil {
			return err
		}
		if taken {
			return identity.ErrEmailTaken
		}
		now := s.Now()
		if _, err := tx.Exec(ctx, "UPDATE email_tokens SET used_at = $2 WHERE user_id = $1 AND purpose = 'graduate' AND used_at IS NULL",
			user, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO email_tokens (id, user_id, purpose, token_hash, email, created_at, expires_at, sent_by)
			VALUES ($1, $2, 'graduate', $3, $4, $5, $6, $7)`, idgen.New(), user, hash, req.Email, now, now.Add(GraduateFor), scope.UserID()); err != nil {
			return err
		}
		return s.Notify.Queue(ctx, tx, letter)
	})
	if err != nil {
		// An address an account has keeps its count: its refusal is what the count limits.
		if !errors.Is(err, identity.ErrEmailTaken) {
			s.refund(ctx, household)
		}
		s.fail(w, r, err)
		return
	}
	s.Notify.Nudge(ctx, household)
	w.WriteHeader(http.StatusAccepted)
}

// graduation is a graduation's link, as its row holds it: sentBy is the owner who sent it.
type graduation struct {
	user, sentBy uuid.UUID
	email        string
	expires      time.Time
	used         *time.Time
}

// errLinkSpent is the answer to a graduation's link that was used, replaced by a newer one, or
// withdrawn with its sender's ownership or with its profile's removal.
var errLinkSpent = problem.New(http.StatusGone, problem.CodeTokenAlreadyUsed)

// findGraduation reads the graduation link token opens in tx, locked for it when lock, and refuses one
// that opens nothing, 404, one spent or replaced by a newer one, 410 token_already_used, and one past
// its time at now, 410 token_expired.
func findGraduation(ctx context.Context, tx pgx.Tx, token string, now time.Time, lock bool) (graduation, error) {
	statement := "SELECT user_id, sent_by, email, expires_at, used_at FROM email_tokens WHERE token_hash = $1 AND purpose = 'graduate'"
	if lock {
		statement += " FOR UPDATE"
	}
	var g graduation
	err := tx.QueryRow(ctx, statement, session.Hash(token)).Scan(&g.user, &g.sentBy, &g.email, &g.expires, &g.used)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return g, problem.NotFound()
	case err != nil:
		return g, err
	case g.used != nil:
		return g, errLinkSpent
	case !now.Before(g.expires):
		return g, problem.New(http.StatusGone, problem.CodeTokenExpired)
	}
	return g, nil
}

// confirmGraduation is postAuthGraduationConfirm (FR-CH4): a graduation's link, once, within
// GraduateFor, with the password the young adult chooses, makes the child profile a member of its
// household, keeping everything it made and its levels, and its account the address's, verified, with
// the password in place of the PIN (identity.Graduate). It is their own change, recorded as theirs,
// via the web client the link opens. The link is checked before the password is hashed, and again
// under the membership's lock, so that two confirmations of one link graduate the profile once.
//
// A link lapses with its sender's ownership, as an invitation does (D-103): one whose sender has been
// removed, has left or has been made a member since is refused as spent, 410 token_already_used,
// since whoever holds it would come into the household with the profile's account and everything it
// made, at an address the owners who stay never chose. The ownership's end spends it, with the
// sender's invitations (withdraw), so that it stays spent once they are an owner again, and the
// sending reads their role under the household's lock, which every change of a role takes, so that
// none is written after that; it is checked here too, under the same lock.
//
// It writes into the household from outside its routes, so it is held to the household's state as
// accepting an invitation is (writable, D-120): a household that does not write graduates nobody until
// it writes again, 402, and a suspended one is not found. The link stays as it was for when it does.
func (s *Service) confirmGraduation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	var (
		g         graduation
		household uuid.UUID
	)
	err := tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		var err error
		g, err = findGraduation(ctx, tx, req.Token, s.Now(), false)
		return err
	})
	if err == nil {
		// The profile's household is read as the profile's own membership, outside any household's
		// context: a child profile is in one household, the one whose owner made it.
		err = tenant.AccountTx(ctx, s.Pool, g.user, func(tx pgx.Tx) error {
			err := tx.QueryRow(ctx, "SELECT household_id FROM memberships WHERE user_id = $1 AND role = 'child'", g.user).
				Scan(&household)
			if errors.Is(err, pgx.ErrNoRows) {
				return problem.NotFound()
			}
			return err
		})
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	secret, err := s.Accounts.NewPassword(ctx, "/password", req.Password)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	scoped := mutation.WithVia(tenant.Assume(ctx, s.Pool, household, g.user, access.Child), audit.ViaWeb)
	_, err = mutation.Apply(scoped, func(tx pgx.Tx) (mutation.Record, error) {
		payer, err := lockHousehold(ctx, tx, household)
		if err != nil {
			return mutation.Record{}, err
		}
		m, err := readMembership(ctx, tx, household, g.user, true)
		switch {
		case err != nil:
			return mutation.Record{}, err
		case m.child == nil:
			return mutation.Record{}, problem.NotFound()
		}
		// A membership changed from outside the household's routes, held to its state as an
		// invitation's acceptance is (D-120).
		if err := writable(ctx, tx, household); err != nil {
			return mutation.Record{}, err
		}
		// The profile's account before its link, in the order a sending takes them (graduate), which
		// holds the account while it retires the links before its own: taken the other way round, a
		// sending and a confirmation of the link it retires would each wait for the other.
		if _, err := tx.Exec(ctx, "SELECT FROM users WHERE id = $1 FOR NO KEY UPDATE", m.user); err != nil {
			return mutation.Record{}, err
		}
		link, err := findGraduation(ctx, tx, req.Token, s.Now(), true)
		if err != nil {
			return mutation.Record{}, err
		}
		var owns bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM memberships WHERE household_id = $1 AND user_id = $2 AND role = 'owner')",
			household, link.sentBy).Scan(&owns); err != nil {
			return mutation.Record{}, err
		}
		if !owns {
			return mutation.Record{}, errLinkSpent
		}
		if _, err := tx.Exec(ctx, "UPDATE email_tokens SET used_at = $2 WHERE user_id = $1 AND purpose = 'graduate' AND used_at IS NULL",
			m.user, s.Now()); err != nil {
			return mutation.Record{}, err
		}
		if err := s.Accounts.Graduate(ctx, tx, m.user, link.email, secret); err != nil {
			return mutation.Record{}, err
		}
		shown, err := shownGrants(access.Member, m.grants)
		if err != nil {
			return mutation.Record{}, err
		}
		if err := tx.QueryRow(ctx, `
			UPDATE memberships SET role = 'member', year_of_birth = NULL, dashboard_locked = false, pin_locked = false, grants = $2
			WHERE id = $1 RETURNING version`,
			m.id, shown).Scan(&m.version); err != nil {
			return mutation.Record{}, err
		}
		m.role, m.child = access.Member, nil
		rec := childRecord(household, payer, m, actionGraduate)
		rec.Event.Changes = []audit.Change{{Field: "role", Old: access.Child, New: access.Member}}
		return rec, nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
