package privacy

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Why an account's deletion was scheduled.
const (
	causeRequested    = "requested"
	causeChildRemoved = "child_removed"
)

// blocked is the contract's AccountDeletionBlocked: every household that stands in the way, at once
// (FR-PR3), so that nobody clears one blocker to meet the next.
func blocked(sole []household.Standing, payer []uuid.UUID) *problem.Problem {
	type soleOwned struct {
		HouseholdID uuid.UUID `json:"household_id"`
		Name        string    `json:"name"`
		MemberCount int       `json:"member_count"`
	}
	owned := make([]soleOwned, 0, len(sole))
	for _, st := range sole {
		owned = append(owned, soleOwned{HouseholdID: st.Household, Name: st.Name, MemberCount: st.Members})
	}
	if payer == nil {
		payer = []uuid.UUID{}
	}
	p := problem.New(http.StatusConflict, problem.CodeAccountDeletionBlocked)
	p.Extensions = map[string]any{"sole_owned_households": owned, "billing_payer_for": payer}
	return p
}

// resolve resolves each of user's households for their account's deletion (FR-PR3), chosen being the
// households they chose to delete with it, and returns those that are to be scheduled for deletion
// now, or the problem that blocks it:
//
//   - a household they are the only member of goes with the account, unasked;
//   - one they are the only owner of, with other members in it, blocks, until they make someone
//     else an owner or choose to delete it, which they do by naming it;
//   - one they are the payer of blocks while it goes on without them, until billing is someone
//     else's, and blocks while its subscription still charges, until that is cancelled;
//   - in any other, the membership ends when the account does.
//
// A household named that is not theirs alone to delete is refused 422.
func resolve(standings []household.Standing, chosen []uuid.UUID) ([]uuid.UUID, error) {
	var (
		sole     []household.Standing
		payer    []uuid.UUID
		schedule []uuid.UUID
	)
	for i, id := range chosen {
		if !slices.ContainsFunc(standings, func(st household.Standing) bool { return st.Household == id && st.SoleOwner }) {
			return nil, invalid(fmt.Sprintf("/delete_sole_owned_households/%d", i), problem.FieldInvalid)
		}
	}
	for _, st := range standings {
		goes := st.Members == 1 || st.WithAccount || (st.SoleOwner && slices.Contains(chosen, st.Household))
		switch {
		case st.SoleOwner && !goes:
			sole = append(sole, st)
		case goes && st.Members > 1 && !st.WithAccount:
			schedule = append(schedule, st.Household)
		}
		if st.Payer && (!goes || st.Paying) {
			payer = append(payer, st.Household)
		}
	}
	if len(sole) > 0 || len(payer) > 0 {
		return nil, blocked(sole, payer)
	}
	return schedule, nil
}

// requestDeletion is postMeDeletion (FR-PR3, FR-PR4, FR-ID8): the account's deletion is scheduled
// for 30 days on. It is asked for with the account's password, or, by an account that has none, with
// its own address typed out, since a stolen session alone must not delete an account; a child
// profile, which an owner removes, is refused 403. Every household the account is in is resolved
// first, and whatever blocks it is answered at once, 409 (resolve). Then the households chosen to go
// with it are scheduled for deletion, their members told, each counting among its household's five
// schedulings a day and refusing the request 429 past them (household.Service.ScheduleWithAccount),
// and the account is disabled: every session and device's sign-in ends, this request's own among
// them, nothing signs it in again, and its address is sent the link that cancels it. The answer
// carries that link's token too, the one thing the client that asked still holds. The email is sent
// once and may not arrive: asking for a password reset at the address sends the link again, with a
// new token in place of this one (identity.Service.renewCancelLink, D-136).
//
// It keeps no Idempotency-Key, whose fingerprint would be a fast hash of the password (D-97).
func (s *Service) requestDeletion(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	var req struct {
		Proof  string      `json:"password_or_confirmation"`
		Chosen []uuid.UUID `json:"delete_sole_owned_households"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	owner, err := s.cfg.Accounts.ConfirmDeletion(ctx, user, req.Proof)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	standings, err := s.cfg.Households.Standings(ctx, user)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	schedule, err := resolve(standings, req.Chosen)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	// What was scheduled is undone if the account's own deletion then is not: best effort, since the
	// nightly job cancels a household's deletion that follows an account's which no longer stands.
	undo := func(scheduled []uuid.UUID) {
		for _, id := range scheduled {
			if err := s.cfg.Households.CancelWithAccount(context.WithoutCancel(ctx), s.cfg.Registry, id, user); err != nil {
				s.cfg.Log.LogAttrs(ctx, slog.LevelError, "privacy: undo a household's deletion", slog.String(logging.KeyHouseholdID, id.String()),
					slog.Any("error", err))
			}
		}
	}
	for i, id := range schedule {
		err := s.cfg.Households.ScheduleWithAccount(ctx, id, user)
		if errors.Is(err, household.ErrNotSoleOwner) {
			// Someone became an owner, or left, since the households were resolved: resolved again,
			// the request is blocked by what is true now, or asks for a household that is not theirs.
			if standings, err = s.cfg.Households.Standings(ctx, user); err == nil {
				if _, err = resolve(standings, req.Chosen); err == nil {
					err = blocked(nil, nil)
				}
			}
		}
		if err != nil {
			undo(schedule[:i])
			s.fail(w, r, err)
			return
		}
	}
	// The contract's DeletionRequest, an account's: its CancelToken is what the email's link carries,
	// handed to the client that asked too, which is signed out by the answer and could not cancel
	// otherwise.
	var (
		d     household.Deletion
		token string
		fresh bool
	)
	err = tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
		if err := identity.LockAccount(ctx, tx, user); err != nil {
			return err
		}
		// The proof was checked before this transaction: a password reset or changed since then wins,
		// and the request answers as a wrong password does.
		if err := s.cfg.Accounts.HoldConfirmation(ctx, tx, user, owner); err != nil {
			return err
		}
		now := s.cfg.Now()
		d = household.Deletion{ID: idgen.New(), Scope: scopeUser, RequestedAt: now.UTC(), ExecutesAt: now.Add(household.DeletionWindow).UTC()}
		tag, err := tx.Exec(ctx, `
			INSERT INTO account_deletions (user_id, id, cause, requested_at, executes_at) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (user_id) DO NOTHING`, user, d.ID, causeRequested, d.RequestedAt, d.ExecutesAt)
		if err != nil {
			return err
		}
		if fresh = tag.RowsAffected() > 0; !fresh {
			// Scheduled already, by a request that ran beside this one: answered as it stands, with no
			// second link.
			return tx.QueryRow(ctx, "SELECT id, requested_at, executes_at FROM account_deletions WHERE user_id = $1", user).
				Scan(&d.ID, &d.RequestedAt, &d.ExecutesAt)
		}
		if token, err = s.cfg.Accounts.IssueCancelLink(ctx, tx, user, owner.Address, household.DeletionWindow); err != nil {
			return err
		}
		return s.cfg.Accounts.Disable(ctx, tx, user)
	})
	if err != nil {
		undo(schedule)
		s.fail(w, r, err)
		return
	}
	if fresh {
		d.CancelToken = &token
		s.cfg.Accounts.SendCancelLink(ctx, owner.Address, owner.Locale, token, int(household.DeletionWindow/(24*time.Hour)))
	}
	d.RequestedAt, d.ExecutesAt = d.RequestedAt.UTC(), d.ExecutesAt.UTC()
	if _, ok := session.Current(ctx); ok {
		session.ClearCookies(w)
	}
	identity.NoStore(w)
	httpx.WriteJSON(w, http.StatusAccepted, d)
}

// cancelDeletion is postAuthDeletionCancel (FR-PR4): the link a scheduled deletion's email carried
// cancels it, within its 30 days. The account signs in again as it did, with the password it had;
// nothing it held was touched. The households that were to be deleted with it are no longer, and
// their members are told. A link that was used, or whose time has passed, is answered 410, and one
// nobody issued 404, as every link is.
//
// It is reached signed out, since the account signs nobody in, and keeps no Idempotency-Key (D-97).
func (s *Service) cancelDeletion(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		Token string `json:"token"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	var user uuid.UUID
	err := tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
		var err error
		if user, err = s.cfg.Accounts.SpendCancelLink(ctx, tx, req.Token); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, "DELETE FROM account_deletions WHERE user_id = $1 AND cause = $2", user, causeRequested)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	// The households that were to go with it, each cancelled on its own: one that fails is logged,
	// and its owner, signed in again, cancels it from the household. Past the request's own context,
	// as a scheduling's undo is: the account's cancellation has committed, and a client that hung up
	// then would otherwise leave them scheduled, their members still told they are to be deleted,
	// until the nightly job cancels each on the day it falls due.
	following := context.WithoutCancel(ctx)
	standings, err := s.cfg.Households.Standings(following, user)
	if err != nil {
		s.cfg.Log.LogAttrs(ctx, slog.LevelError, "privacy: a cancelled deletion's households", slog.Any("error", err))
	}
	for _, st := range standings {
		if !st.WithAccount {
			continue
		}
		if err := s.cfg.Households.CancelWithAccount(following, s.cfg.Registry, st.Household, user); err != nil {
			s.cfg.Log.LogAttrs(ctx, slog.LevelError, "privacy: cancel a household's deletion", slog.String(logging.KeyHouseholdID, st.Household.String()),
				slog.Any("error", err))
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// Named is the household surface's Named hook, which runs in the transaction of a mutation a user
// makes in a household they are no member of, declining its invitation: the event it records names
// them as who did it, and an erased account's name comes off the events it caused (FR-PR4, D-141),
// which the nightly job finds household by household, by the account's memberships and its
// departures (eraseAccount). So the household keeps a departure of theirs that says only that its log
// names them: nothing was kept there to delete, so it is written as erased already, which no window
// waits on and no export takes. A departure of theirs that is there already, one who left and whose
// window is open, stays as it is. now is the clock, time.Now when nil.
func Named(now func() time.Time) func(ctx context.Context, tx pgx.Tx, household, user uuid.UUID) error {
	if now == nil {
		now = time.Now
	}
	return func(ctx context.Context, tx pgx.Tx, household, user uuid.UUID) error {
		at := now()
		_, err := tx.Exec(ctx, `
			INSERT INTO departures (household_id, user_id, cause, departed_at, erase_after, erased_at) VALUES ($1, $2, 'declined', $3, $4, $3)
			ON CONFLICT (household_id, user_id) DO NOTHING`, household, user, at, at.Add(PrivateKept))
		return err
	}
}

// Departed is the household surface's Lost hook for a member who left a household or was removed
// from it (FR-PR7), which runs in the transaction that ends their membership: what they kept
// privately there is theirs to export for 30 days more, and is deleted then (Erase). A child profile
// removed from its household is nothing outside it, and nobody can sign in to it (ADR 0012): its
// account is scheduled for deletion as an account its user asked to delete is, with the same window,
// and no link, since there is nobody to cancel it. A member whose account was erased left nothing to
// wait for (household.CauseErased). now is the clock, time.Now when nil.
func Departed(now func() time.Time) func(context.Context, pgx.Tx, household.Loss) error {
	if now == nil {
		now = time.Now
	}
	return func(ctx context.Context, tx pgx.Tx, loss household.Loss) error {
		if loss.Cause != household.CauseLeft && loss.Cause != household.CauseRemoved {
			return nil
		}
		at := now()
		for member, modules := range loss.Members {
			if modules != nil {
				continue
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO departures (household_id, user_id, cause, departed_at, erase_after) VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (household_id, user_id) DO UPDATE SET cause = excluded.cause, departed_at = excluded.departed_at,
				  erase_after = excluded.erase_after, erased_at = NULL`,
				loss.Household, member, string(loss.Cause), at, at.Add(PrivateKept)); err != nil {
				return err
			}
			child, err := identity.IsChild(ctx, tx, member)
			if err != nil {
				return err
			}
			if !child {
				continue
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO account_deletions (user_id, id, cause, requested_at, executes_at) VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (user_id) DO NOTHING`,
				member, idgen.New(), causeChildRemoved, at, at.Add(household.DeletionWindow)); err != nil {
				return err
			}
		}
		return nil
	}
}
