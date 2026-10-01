package notify

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"net/http"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/localtime"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Preferences are what a member wants to be told (FR-NT2): whether anything at all, which of the four
// categories, and the quiet hours that hold a push until they end, read on the member's own clock.
type Preferences struct {
	Enabled bool
	// Muted are the categories switched off.
	Muted map[Category]bool
	Quiet *localtime.Window
}

// Defaults are an account's preferences until it sets its own: everything on, and no quiet hours.
func Defaults() Preferences { return Preferences{Enabled: true, Muted: map[Category]bool{}} }

// preferencesJSON is the contract's NotificationPreferences.
type preferencesJSON struct {
	HouseholdID *uuid.UUID      `json:"household_id"`
	Enabled     bool            `json:"enabled"`
	Categories  map[string]bool `json:"categories"`
	QuietHours  *quietJSON      `json:"quiet_hours"`
}

type quietJSON struct {
	From string `json:"from"`
	To   string `json:"to"`
}

func (p Preferences) json(household uuid.UUID) preferencesJSON {
	out := preferencesJSON{Enabled: p.Enabled, Categories: map[string]bool{}}
	if household != uuid.Nil {
		out.HouseholdID = &household
	}
	for _, c := range Categories {
		out.Categories[string(c)] = !p.Muted[c]
	}
	if p.Quiet != nil {
		out.QuietHours = &quietJSON{From: p.Quiet.From.String(), To: p.Quiet.To.String()}
	}
	return out
}

// preferenceColumns are the columns of notification_defaults and notification_preferences that hold
// preferences, in the order scanPreferences reads them.
const preferenceColumns = "enabled, direct, household, reminders, digest, quiet_from, quiet_to"

// scanPreferences reads preferenceColumns.
func scanPreferences(row pgx.Row) (Preferences, error) {
	var (
		p        = Defaults()
		on       [4]bool
		from, to pgtype.Time
	)
	if err := row.Scan(&p.Enabled, &on[0], &on[1], &on[2], &on[3], &from, &to); err != nil {
		return p, err
	}
	for i, c := range Categories {
		p.Muted[c] = !on[i]
	}
	if from.Valid && to.Valid {
		p.Quiet = &localtime.Window{From: clockOf(from), To: clockOf(to)}
	}
	return p, nil
}

func clockOf(t pgtype.Time) localtime.Clock {
	return localtime.Clock(t.Microseconds / int64(60*1e6))
}

func timeOf(c localtime.Clock) pgtype.Time {
	return pgtype.Time{Microseconds: int64(c) * 60 * 1e6, Valid: true}
}

// values are p's preferenceColumns, as a statement takes them.
func (p Preferences) values() []any {
	var from, to pgtype.Time
	if p.Quiet != nil {
		from, to = timeOf(p.Quiet.From), timeOf(p.Quiet.To)
	}
	return []any{p.Enabled, !p.Muted[Direct], !p.Muted[Household], !p.Muted[Reminders], !p.Muted[Digest], from, to}
}

// accountPreferences reads user's account-wide defaults, or the built-in ones.
func accountPreferences(ctx context.Context, tx pgx.Tx, user uuid.UUID) (Preferences, error) {
	p, err := scanPreferences(tx.QueryRow(ctx, "SELECT "+preferenceColumns+" FROM notification_defaults WHERE user_id = $1", user))
	if errors.Is(err, pgx.ErrNoRows) {
		return Defaults(), nil
	}
	return p, err
}

// householdPreferences reads user's preferences in tx's household: their own there, or their
// account's.
func householdPreferences(ctx context.Context, tx pgx.Tx, household, user uuid.UUID) (Preferences, error) {
	p, err := scanPreferences(tx.QueryRow(ctx,
		"SELECT "+preferenceColumns+" FROM notification_preferences WHERE household_id = $1 AND user_id = $2", household, user))
	if errors.Is(err, pgx.ErrNoRows) {
		return accountPreferences(ctx, tx, user)
	}
	return p, err
}

// preferencesUpdate is a NotificationPreferencesUpdate: each member that is set, to its value.
type preferencesUpdate struct {
	enabled    *bool
	categories map[Category]bool
	setQuiet   bool
	quiet      *localtime.Window
}

// apply returns p with u applied.
func (u preferencesUpdate) apply(p Preferences) Preferences {
	out := Preferences{Enabled: p.Enabled, Muted: maps.Clone(p.Muted), Quiet: p.Quiet}
	if out.Muted == nil {
		out.Muted = map[Category]bool{}
	}
	if u.enabled != nil {
		out.Enabled = *u.enabled
	}
	for c, on := range u.categories {
		out.Muted[c] = !on
	}
	if u.setQuiet {
		out.Quiet = u.quiet
	}
	return out
}

func (u preferencesUpdate) empty() bool {
	return u.enabled == nil && len(u.categories) == 0 && !u.setQuiet
}

// readPreferencesUpdate reads the request's NotificationPreferencesUpdate. The edge has checked its
// members' types; a category the contract does not name, and quiet hours that are not two different
// times of day, HH:MM, are refused here, naming each.
func readPreferencesUpdate(r *http.Request) (preferencesUpdate, error) {
	var (
		body struct {
			Enabled    *bool           `json:"enabled"`
			Categories map[string]bool `json:"categories"`
			Quiet      json.RawMessage `json:"quiet_hours"`
		}
		u    preferencesUpdate
		errs []problem.FieldError
	)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return u, problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed})
	}
	u.enabled = body.Enabled
	if len(body.Categories) > 0 {
		u.categories = map[Category]bool{}
	}
	for name, on := range body.Categories {
		if !slices.Contains(Categories, Category(name)) {
			errs = append(errs, problem.FieldError{Field: problem.Pointer("categories", name), Code: problem.FieldInvalid})
			continue
		}
		u.categories[Category(name)] = on
	}
	if body.Quiet != nil {
		u.setQuiet = true
		if string(body.Quiet) != "null" {
			var q struct {
				From *string `json:"from"`
				To   *string `json:"to"`
			}
			if err := json.Unmarshal(body.Quiet, &q); err != nil {
				return u, problem.Validation(problem.FieldError{Field: "/quiet_hours", Code: problem.FieldMalformed})
			}
			var (
				w      localtime.Window
				parsed = true
			)
			for _, f := range []struct {
				name  string
				value *string
				into  *localtime.Clock
			}{{"from", q.From, &w.From}, {"to", q.To, &w.To}} {
				if f.value == nil {
					errs = append(errs, problem.FieldError{Field: "/quiet_hours/" + f.name, Code: "required"})
					parsed = false
					continue
				}
				var err error
				if *f.into, err = localtime.ParseClock(*f.value); err != nil {
					errs = append(errs, problem.FieldError{Field: "/quiet_hours/" + f.name, Code: "pattern"})
					parsed = false
				}
			}
			if parsed && w.From == w.To {
				errs = append(errs, problem.FieldError{Field: "/quiet_hours/to", Code: problem.FieldInvalid})
			}
			u.quiet = &w
		}
	}
	if len(errs) > 0 {
		slices.SortFunc(errs, func(a, b problem.FieldError) int { return strings.Compare(a.Field, b.Field) })
		return u, problem.Validation(errs...)
	}
	return u, nil
}

// householdParam is the request's household_id, uuid.Nil when it names none. The edge has checked
// its form.
func householdParam(r *http.Request) (uuid.UUID, error) {
	raw := r.URL.Query().Get("household_id")
	if raw == "" {
		return uuid.Nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, problem.Validation(problem.FieldError{Field: "query:household_id", Code: problem.FieldMalformed})
	}
	return id, nil
}

// member refuses a caller who is not a member of tx's household with the 404 a household they cannot
// see is answered with (D-16). In a transaction that writes, it holds their membership until tx ends,
// so that their preferences there are not written past their removal.
func member(ctx context.Context, tx pgx.Tx, household, user uuid.UUID, write bool) error {
	statement := "SELECT EXISTS (SELECT FROM memberships WHERE household_id = $1 AND user_id = $2)"
	if write {
		statement = "SELECT EXISTS (SELECT FROM memberships WHERE household_id = $1 AND user_id = $2 FOR SHARE)"
	}
	var found bool
	if err := tx.QueryRow(ctx, statement, household, user).Scan(&found); err != nil {
		return err
	}
	if !found {
		return problem.NotFound()
	}
	return nil
}

// getPreferences is getMeNotificationPreferences: the caller's preferences in the household the query
// names, which are their account's until they set their own there, or their account's.
func (s *Service) getPreferences(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	household, err := householdParam(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var p Preferences
	if household == uuid.Nil {
		err = tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
			p, err = accountPreferences(ctx, tx, user)
			return err
		})
	} else {
		err = tenant.InTx(tenant.Assume(ctx, s.cfg.Pool, household, user, ""), func(tx pgx.Tx) error {
			if err := member(ctx, tx, household, user, false); err != nil {
				return err
			}
			p, err = householdPreferences(ctx, tx, household, user)
			return err
		})
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, p.json(household))
}

// patchPreferences is patchMeNotificationPreferences. A household's preferences start from the
// account's the first time they are set, and are the member's own there from then on; the account's
// change nothing in a household that has its own. They are the member's settings, no household's
// history, so they are neither audited nor synced: the client reads them here.
func (s *Service) patchPreferences(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	household, err := householdParam(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	u, err := readPreferencesUpdate(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var p Preferences
	if household == uuid.Nil {
		err = tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
			if p, err = accountPreferences(ctx, tx, user); err != nil {
				return err
			}
			if u.empty() {
				return idempotency.Commit(ctx, tx)
			}
			p = u.apply(p)
			if _, err := tx.Exec(ctx, `
				INSERT INTO notification_defaults (user_id, `+preferenceColumns+`) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				ON CONFLICT (user_id) DO UPDATE SET enabled = $2, direct = $3, household = $4, reminders = $5, digest = $6,
				  quiet_from = $7, quiet_to = $8, updated_at = now()`, append([]any{user}, p.values()...)...); err != nil {
				return err
			}
			return idempotency.Commit(ctx, tx)
		})
	} else {
		err = tenant.InWriteTx(tenant.Assume(ctx, s.cfg.Pool, household, user, ""), func(tx pgx.Tx) error {
			if err := member(ctx, tx, household, user, true); err != nil {
				return err
			}
			if p, err = householdPreferences(ctx, tx, household, user); err != nil {
				return err
			}
			if u.empty() {
				return idempotency.Commit(ctx, tx)
			}
			p = u.apply(p)
			if _, err := tx.Exec(ctx, `
				INSERT INTO notification_preferences (household_id, user_id, `+preferenceColumns+`)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
				ON CONFLICT (household_id, user_id) DO UPDATE SET enabled = $3, direct = $4, household = $5, reminders = $6,
				  digest = $7, quiet_from = $8, quiet_to = $9, updated_at = now()`, append([]any{household, user}, p.values()...)...); err != nil {
				return err
			}
			return idempotency.Commit(ctx, tx)
		})
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, p.json(household))
}
