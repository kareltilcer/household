package household

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	"github.com/kareltilcer/household/server/internal/platform/etag"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/money"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/storage"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/text"
)

// settings are a household's row: its settings, its code and its payer.
type settings struct {
	id             uuid.UUID
	name           string
	country        string
	timezone       string
	currency       string
	locale         string
	units          string
	firstDayOfWeek int
	joinCode       string
	payer          *uuid.UUID
	version        int64
	createdAt      time.Time
}

// settingsColumns are the columns scanSettings reads, in its order.
const settingsColumns = `id, name, country, timezone, base_currency, locale, units::text, first_day_of_week, join_code,
	billing_payer_id, version, created_at`

func scanSettings(row pgx.Row) (settings, error) {
	var h settings
	err := row.Scan(&h.id, &h.name, &h.country, &h.timezone, &h.currency, &h.locale, &h.units, &h.firstDayOfWeek,
		&h.joinCode, &h.payer, &h.version, &h.createdAt)
	return h, err
}

// readSettings reads household, the household of tx's context. A change of the settings locks it first
// (lockAsOwner), FOR NO KEY UPDATE: it writes no key of the row, and so need not hold up another
// mutation of the household, whose audit event's foreign key locks the row FOR KEY SHARE, as FOR
// UPDATE would.
func readSettings(ctx context.Context, tx pgx.Tx, household uuid.UUID) (settings, error) {
	return scanSettings(tx.QueryRow(ctx, "SELECT "+settingsColumns+" FROM households WHERE id = $1", household))
}

// householdBody is the contract's Household. The household code, and the caller's role and levels,
// are the caller's: the code is shown to owners alone (PRD modules/17 §1), and the household's sync
// row carries none of the three. Nor does it carry the entitlement, which every member reads here
// and on the household list, and which a 402 names.
type householdBody struct {
	ID             uuid.UUID               `json:"id"`
	Name           string                  `json:"name"`
	Country        string                  `json:"country"`
	Timezone       string                  `json:"timezone"`
	BaseCurrency   string                  `json:"base_currency"`
	Locale         string                  `json:"locale"`
	Units          string                  `json:"units"`
	FirstDayOfWeek int                     `json:"first_day_of_week"`
	Version        int64                   `json:"version"`
	CreatedAt      time.Time               `json:"created_at"`
	JoinCode       string                  `json:"join_code,omitempty"`
	MyRole         access.Role             `json:"my_role,omitempty"`
	MyGrants       map[string]access.Level `json:"my_grants,omitempty"`
	Entitlement    *entitlement.Summary    `json:"entitlement,omitempty"`
}

// row is h as its sync row carries it, and as a member who is not the caller reads it.
func (h settings) row() householdBody {
	return householdBody{
		ID: h.id, Name: h.name, Country: h.country, Timezone: h.timezone, BaseCurrency: h.currency, Locale: h.locale,
		Units: h.units, FirstDayOfWeek: h.firstDayOfWeek, Version: h.version, CreatedAt: h.createdAt.UTC(),
	}
}

// body is h as a caller whose role is role, and whose level on each of modules level gives, reads
// it, with its entitlement as e says it.
func (h settings) body(role access.Role, level func(string) access.Level, modules []string, e entitlement.Summary) householdBody {
	b := h.row()
	b.Entitlement = &e
	b.MyRole = role
	if role == access.Owner {
		b.JoinCode = h.joinCode
	}
	b.MyGrants = make(map[string]access.Level, len(modules))
	for _, m := range modules {
		b.MyGrants[m] = level(m)
	}
	return b
}

// bodyFor is h as scope's caller reads it at now, with the entitlement the request found, the state
// being resolved once per request (PRD 04 §3), and its storage standing at st against its allowance.
func (h settings) bodyFor(scope *tenant.Scope, modules []string, now time.Time, st storage.Standing) householdBody {
	return h.body(scope.Role(), scope.Level, modules, withStorage(scope.Entitlement().Summary(now), st))
}

// withStorage is e saying the household's storage as st has it.
func withStorage(e entitlement.Summary, st storage.Standing) entitlement.Summary {
	return e.WithStorage(st.Used, st.Included, st.Blocks)
}

// standing reads, in tx in household's context, what it stores against its allowance: what its
// entitlement says of its storage, beside its state (PRD 04 §4).
func (s *Service) standing(ctx context.Context, tx pgx.Tx, household uuid.UUID) (storage.Standing, error) {
	usage, err := storage.ReadUsage(ctx, tx, household, s.Now())
	if err != nil {
		return storage.Standing{}, err
	}
	return s.Allowance.Standing(usage), nil
}

// settingsChange is the sync change of h, as it stands after a mutation.
func settingsChange(h settings) sync.Change {
	return sync.Change{Entity: entitySettings, ID: h.id, Op: sync.Upsert, Version: h.version, Row: h.row()}
}

// codeAlphabet is the household code's: no 0 and O, no 1 and I, which read alike (FR-CH1).
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// newJoinCode returns a household code: eight characters of codeAlphabet, drawn uniformly, since
// the alphabet's 32 characters divide 256.
func newJoinCode() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = codeAlphabet[int(b[i])%len(codeAlphabet)]
	}
	return string(b)
}

// codeTries is how many codes a household is offered before its write gives up: a code taken is
// one chance in 2^40 per household that already exists.
const codeTries = 5

// profile is what a household takes from its country's profile when the request does not say.
type profile struct {
	units          string
	firstDayOfWeek int
}

// countryProfile reads country's profile, and false for a country Household has none of.
func countryProfile(ctx context.Context, tx pgx.Tx, country string) (profile, bool, error) {
	var p profile
	err := tx.QueryRow(ctx, "SELECT default_units::text, first_day_of_week FROM country_profiles WHERE code = $1", country).
		Scan(&p.units, &p.firstDayOfWeek)
	if errors.Is(err, pgx.ErrNoRows) {
		return profile{}, false, nil
	}
	return p, err == nil, err
}

// settingsFields are the settings a request writes, each nil when it leaves the setting as it is.
type settingsFields struct {
	Name           *string `json:"name"`
	Country        *string `json:"country"`
	Timezone       *string `json:"timezone"`
	BaseCurrency   *string `json:"base_currency"`
	Locale         *string `json:"locale"`
	Units          *string `json:"units"`
	FirstDayOfWeek *int    `json:"first_day_of_week"`
}

// check canonicalises the settings f names and refuses what is wrong with them, each field by its
// pointer: a name with nothing in it or a control character, a timezone the binary does not know, a
// currency ISO 4217 does not list, and a language tag that names no language. The edge has checked
// every type, the name's length, the country's and the currency's form, the units and the day. The
// country is checked against its profile where it is written.
func (f *settingsFields) check() error {
	var errs []problem.FieldError
	if f.Name != nil {
		name, ok := text.Name(*f.Name)
		if !ok {
			errs = append(errs, problem.FieldError{Field: "/name", Code: problem.FieldInvalid})
		}
		f.Name = &name
	}
	if f.Timezone != nil && !i18n.Timezone(*f.Timezone) {
		errs = append(errs, problem.FieldError{Field: "/timezone", Code: problem.FieldInvalid})
	}
	if f.BaseCurrency != nil {
		if _, err := money.Exponent(*f.BaseCurrency); err != nil {
			errs = append(errs, problem.FieldError{Field: "/base_currency", Code: problem.FieldInvalid})
		}
	}
	if f.Locale != nil {
		tag, ok := i18n.Canonical(*f.Locale)
		if !ok {
			errs = append(errs, problem.FieldError{Field: "/locale", Code: problem.FieldInvalid})
		}
		f.Locale = &tag
	}
	if len(errs) > 0 {
		return problem.Validation(errs...)
	}
	return nil
}

// createRequest is the contract's HouseholdCreate.
type createRequest struct {
	ID uuid.UUID `json:"id"`
	settingsFields
}

// errIDTaken is the create's answer for an id another household has.
var errIDTaken = invalid("/id", problem.FieldInvalid)

// createHousehold creates a household (FR-HH1): any user, verified or not, may, and becomes its
// owner and its payer of record. It enables every module, grants its owner Manage on each, gives it
// a household code, and starts its trial, which its row's insert begins (FR-HH1). Its units and first
// day of the week are its country's unless the request says, and a country Household has no profile
// of is refused. A child profile is refused 403: it is a profile an owner manages in their household,
// never a household's owner and payer (D-17, D-104). A user who owns as many households as they may
// is refused 403 household_limit_reached, and one this household brings to 80 % of them is told
// (PRD 04 §5, D-116).
func (s *Service) createHousehold(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	var req createRequest
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := req.check(); err != nil {
		s.fail(w, r, err)
		return
	}
	scoped := tenant.Assume(ctx, s.Pool, req.ID, user, access.Owner)
	var (
		created settings
		status  entitlement.Status
		modules = Modules
		noticed bool
	)
	_, err := mutation.Apply(scoped, func(tx pgx.Tx) (mutation.Record, error) {
		switch child, err := identity.IsChild(ctx, tx, user); {
		case err != nil:
			return mutation.Record{}, err
		case child:
			return mutation.Record{}, forbidden()
		}
		p, ok, err := countryProfile(ctx, tx, *req.Country)
		switch {
		case err != nil:
			return mutation.Record{}, err
		case !ok:
			return mutation.Record{}, invalid("/country", problem.FieldInvalid)
		}
		owned, err := ownedCeiling(scoped, tx, user)
		if err != nil {
			return mutation.Record{}, err
		}
		units, firstDay := p.units, p.firstDayOfWeek
		if req.Units != nil {
			units = *req.Units
		}
		if req.FirstDayOfWeek != nil {
			firstDay = *req.FirstDayOfWeek
		}
		if created, err = insertHousehold(ctx, tx, req, user, units, firstDay); err != nil {
			return mutation.Record{}, err
		}
		changes := []sync.Change{settingsChange(created)}
		m, err := insertMembership(ctx, tx, created.id, user, access.Owner, Defaults(access.Owner, modules))
		if err != nil {
			return mutation.Record{}, err
		}
		for _, module := range modules {
			e := enablement{id: idgen.New(), module: module, enabled: true}
			if e.version, err = e.insert(ctx, tx, created.id); err != nil {
				return mutation.Record{}, err
			}
			changes = append(changes, e.change())
		}
		// Its trial began with it (FR-HH1), by the row's own default, in the version the change above
		// records.
		if status, err = readStatus(ctx, tx, created.id); err != nil {
			return mutation.Record{}, err
		}
		// Told in the household it made, of which it is a member now.
		if noticed, err = s.ownedNotice(scoped, tx, created.id, user, owned); err != nil {
			return mutation.Record{}, err
		}
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: actionCreate, EntityType: entitySettings, EntityID: created.id,
				SummaryKey: Name + "." + actionCreate, SummaryArgs: map[string]any{"household": created.name},
			},
			Changes: append(changes, m.change(created.id, created.payer, modules)),
		}, nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if noticed {
		s.Notify.Nudge(ctx, created.id)
	}
	// The creator is its owner, with Manage on every module, each of which it enables.
	manage := func(string) access.Level { return access.Manage }
	etag.Set(w, created.version)
	// It stores nothing yet, against the base allowance.
	fresh := s.Allowance.Standing(storage.Usage{})
	httpx.WriteJSON(w, http.StatusCreated, created.body(access.Owner, manage, modules, withStorage(status.Summary(s.Now()), fresh)))
}

// insertHousehold writes the household req names, with its creator as its payer, and returns it. An
// id another household has is refused; a code another household has is drawn again.
func insertHousehold(ctx context.Context, tx pgx.Tx, req createRequest, payer uuid.UUID, units string, firstDay int) (settings, error) {
	for range codeTries {
		h, err := scanSettings(tx.QueryRow(ctx, `
			INSERT INTO households (id, name, country, timezone, base_currency, locale, units, first_day_of_week, join_code,
			                        billing_payer_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT DO NOTHING
			RETURNING `+settingsColumns,
			req.ID, *req.Name, *req.Country, *req.Timezone, *req.BaseCurrency, *req.Locale, units, firstDay, newJoinCode(), payer))
		if !errors.Is(err, pgx.ErrNoRows) {
			return h, err
		}
		var taken bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM households WHERE id = $1)", req.ID).Scan(&taken); err != nil {
			return settings{}, err
		}
		if taken {
			return settings{}, errIDTaken
		}
	}
	return settings{}, fmt.Errorf("household: no free household code in %d tries", codeTries)
}

// householdSummary is the contract's HouseholdSummary.
type householdSummary struct {
	ID          uuid.UUID            `json:"id"`
	Name        string               `json:"name"`
	AvatarURL   *string              `json:"avatar_url"`
	MyRole      access.Role          `json:"my_role"`
	MemberCount int                  `json:"member_count"`
	Entitlement *entitlement.Summary `json:"entitlement"`
}

// listHouseholds lists the households the caller belongs to, in the order they were made (A-36), each
// with its entitlement: a suspended one among them, whose every route answers 404, so that a client
// shows its lockout rather than nothing (D-115).
func (s *Service) listHouseholds(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	items := []householdSummary{}
	err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT h.id, h.name, m.role::text
			FROM memberships m
			JOIN households h ON h.id = m.household_id
			WHERE m.user_id = $1
			ORDER BY h.created_at, h.id`, user)
		if err != nil {
			return err
		}
		items, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (householdSummary, error) {
			var h householdSummary
			err := row.Scan(&h.ID, &h.Name, &h.MyRole)
			return h, err
		})
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	// Each household's members and entitlement are read in its own context, where its memberships are.
	now := s.Now()
	for i := range items {
		err := s.readTx(ctx, items[i].ID, user, func(tx pgx.Tx) error {
			if err := tx.QueryRow(ctx, "SELECT count(*) FROM memberships WHERE household_id = $1", items[i].ID).
				Scan(&items[i].MemberCount); err != nil {
				return err
			}
			status, err := readStatus(ctx, tx, items[i].ID)
			if err != nil {
				return err
			}
			st, err := s.standing(ctx, tx, items[i].ID)
			if err != nil {
				return err
			}
			summary := withStorage(status.Summary(now), st)
			items[i].Entitlement = &summary
			return nil
		})
		if err != nil {
			s.fail(w, r, err)
			return
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

// getHousehold answers the household's settings, which every member reads (PRD modules/17
// Permissions).
func (s *Service) getHousehold(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	var (
		h  settings
		st storage.Standing
	)
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		var err error
		if h, err = readSettings(ctx, tx, scope.HouseholdID()); err != nil {
			return err
		}
		st, err = s.standing(ctx, tx, scope.HouseholdID())
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	etag.Set(w, h.version)
	httpx.WriteJSON(w, http.StatusOK, h.bodyFor(scope, Modules, s.Now(), st))
}

// updateHousehold changes the household's settings (FR-HA1), an owner's to change, under If-Match. A
// new country changes which reference data is offered from then on and nothing recorded; the base
// currency, whose change recomputes history, is item 62's (FR-HA2), so a new one is refused until
// then.
func (s *Service) updateHousehold(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if err := owner(ctx); err != nil {
		s.fail(w, r, err)
		return
	}
	var req settingsFields
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := req.check(); err != nil {
		s.fail(w, r, err)
		return
	}
	precondition := etag.IfMatch(r)
	var (
		h       settings
		st      storage.Standing
		modules = Modules
	)
	_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		if _, err := lockAsOwner(ctx, tx); err != nil {
			return mutation.Record{}, err
		}
		old, err := readSettings(ctx, tx, scope.HouseholdID())
		if err != nil {
			return mutation.Record{}, err
		}
		h = old
		if st, err = s.standing(ctx, tx, old.id); err != nil {
			return mutation.Record{}, err
		}
		if !precondition.Allows(old.version) {
			return mutation.Record{}, problem.Conflict(old.bodyFor(scope, modules, s.Now(), st), old.version)
		}
		if req.BaseCurrency != nil && *req.BaseCurrency != old.currency {
			return mutation.Record{}, invalid("/base_currency", problem.FieldInvalid)
		}
		if req.Country != nil && *req.Country != old.country {
			if _, ok, err := countryProfile(ctx, tx, *req.Country); err != nil || !ok {
				if err == nil {
					err = invalid("/country", problem.FieldInvalid)
				}
				return mutation.Record{}, err
			}
		}
		next := old
		set(&next.name, req.Name)
		set(&next.country, req.Country)
		set(&next.timezone, req.Timezone)
		set(&next.locale, req.Locale)
		set(&next.units, req.Units)
		set(&next.firstDayOfWeek, req.FirstDayOfWeek)
		diffs := settingsDiffs(old, next)
		if len(diffs) == 0 {
			return mutation.Record{}, nil
		}
		if h, err = scanSettings(tx.QueryRow(ctx, `
			UPDATE households SET name = $2, country = $3, timezone = $4, locale = $5, units = $6, first_day_of_week = $7
			WHERE id = $1
			RETURNING `+settingsColumns,
			old.id, next.name, next.country, next.timezone, next.locale, next.units, next.firstDayOfWeek)); err != nil {
			return mutation.Record{}, err
		}
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: actionUpdate, EntityType: entitySettings, EntityID: h.id,
				SummaryKey: Name + "." + actionUpdate, Changes: diffs,
			},
			Changes: []sync.Change{settingsChange(h)},
		}, nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	etag.Set(w, h.version)
	httpx.WriteJSON(w, http.StatusOK, h.bodyFor(scope, modules, s.Now(), st))
}

// set sets *field to *value when value is not nil.
func set[T any](field *T, value *T) {
	if value != nil {
		*field = *value
	}
}

// settingsDiffs are the settings that differ between old and next, as the audit event's diffs.
func settingsDiffs(old, next settings) []audit.Change {
	var out []audit.Change
	diff := func(field string, a, b any) {
		if a != b {
			out = append(out, audit.Change{Field: field, Old: a, New: b})
		}
	}
	diff("name", old.name, next.name)
	diff("country", old.country, next.country)
	diff("timezone", old.timezone, next.timezone)
	diff("locale", old.locale, next.locale)
	diff("units", old.units, next.units)
	diff("first_day_of_week", old.firstDayOfWeek, next.firstDayOfWeek)
	return out
}

// regenerateJoinCode gives the household a new code (FR-CH1), an owner's to do: the old one signs
// nobody in from then on, and the sessions it signed in stay. The audit event does not carry the
// code, which only owners see.
func (s *Service) regenerateJoinCode(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if err := owner(ctx); err != nil {
		s.fail(w, r, err)
		return
	}
	var (
		h       settings
		st      storage.Standing
		modules = Modules
	)
	_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		if _, err := lockAsOwner(ctx, tx); err != nil {
			return mutation.Record{}, err
		}
		var err error
		if h, err = setJoinCode(ctx, tx, scope.HouseholdID()); err != nil {
			return mutation.Record{}, err
		}
		if st, err = s.standing(ctx, tx, h.id); err != nil {
			return mutation.Record{}, err
		}
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: actionJoinCode, EntityType: entitySettings, EntityID: h.id,
				SummaryKey: Name + "." + actionJoinCode,
			},
			Changes: []sync.Change{settingsChange(h)},
		}, nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	etag.Set(w, h.version)
	httpx.WriteJSON(w, http.StatusOK, h.bodyFor(scope, modules, s.Now(), st))
}

// setJoinCode gives household a new code, drawn again under a savepoint while another household has
// it, and returns the household.
func setJoinCode(ctx context.Context, tx pgx.Tx, household uuid.UUID) (settings, error) {
	for range codeTries {
		var h settings
		err := pgx.BeginFunc(ctx, tx, func(sp pgx.Tx) error {
			var err error
			h, err = scanSettings(sp.QueryRow(ctx,
				"UPDATE households SET join_code = $2 WHERE id = $1 RETURNING "+settingsColumns, household, newJoinCode()))
			return err
		})
		if !db.UniqueViolation(err, "households_join_code_key") {
			return h, err
		}
	}
	return settings{}, fmt.Errorf("household: no free household code in %d tries", codeTries)
}
