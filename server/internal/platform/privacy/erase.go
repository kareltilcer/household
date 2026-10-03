package privacy

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/billing"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// What erased a household or an account, as its tombstone says it (erasures.cause). A household that
// goes with an erased account is erased for the cause the household surface answers
// (household.Fate.Cause), which says it too when nobody is left in it who could own it.
const (
	causeAccount = "account"
	causeLapsed  = "lapsed"

	kindHousehold = "household"
	kindAccount   = "account"
)

// errResolveAgain leaves a household that was to go with an erased account as it is, and the account
// scheduled: its members changed between the read that decided it and the lock it is erased under.
var errResolveAgain = errors.New("privacy: the household's members changed since its fate was read; it is resolved again on the next run")

// Erased is what a run of the nightly job erased.
type Erased struct {
	Households, Accounts, Departures, Objects int
}

// Erase is the nightly erasure job (FR-PR4, FR-PR6, FR-PR7, D-119; PRD 03 §5). It executes what was
// scheduled and has come due:
//
//   - the households whose deletion an owner scheduled 30 days ago, and the lapsed ones whose
//     retention ran out with their three warnings sent;
//   - the accounts whose deletion was scheduled 30 days ago, each with the households that go with
//     it, and the child profiles of every household erased, which are nothing outside it;
//   - the private data of the members who left a household 30 days ago;
//   - and the objects of what was erased, under its prefix in the store.
//
// Each erasure is its own transaction, and what one leaves undone is found again the next night: a
// household or an account that fails is logged and the rest go on, and every failure is returned. It
// runs before PowerSync's compaction, which then drops from bucket storage the rows it deleted
// (D-93, runbooks/compaction.md).
func (s *Service) Erase(ctx context.Context) (Erased, error) {
	var (
		done   Erased
		failed error
	)
	now := s.cfg.Now()
	note := func(what string, id uuid.UUID, err error) {
		if err != nil {
			s.cfg.Log.LogAttrs(ctx, slog.LevelError, "privacy: an erasure failed", slog.String("of", what), slog.String("id", id.String()),
				slog.Any("error", err))
			failed = errors.Join(failed, err)
		}
	}

	rows, err := s.cfg.Meter.Query(ctx, `
		SELECT id FROM households
		WHERE deletion_scheduled_at <= $1
		   OR (billing_state IN ('read_only', 'canceled') AND retained_until <= $1 AND retention_warnings >= 3)
		ORDER BY id`, now)
	if err != nil {
		return done, err
	}
	households, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return done, err
	}
	for _, id := range households {
		erased, err := s.eraseDue(ctx, id, now)
		note("a household", id, err)
		if erased {
			done.Households++
		}
		if ctx.Err() != nil {
			return done, ctx.Err()
		}
	}

	// The accounts due, and then those the households they took with them left due: a household's
	// child profiles. Twice is as deep as it goes, since a child profile owns no household.
	seen := map[uuid.UUID]bool{}
	for range 2 {
		var accounts []uuid.UUID
		err := tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
			rows, err := tx.Query(ctx, "SELECT user_id FROM account_deletions WHERE executes_at <= $1 ORDER BY executes_at, user_id", now)
			if err != nil {
				return err
			}
			accounts, err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
			return err
		})
		if err != nil {
			return done, errors.Join(failed, err)
		}
		for _, user := range accounts {
			if seen[user] {
				continue
			}
			seen[user] = true
			n, erased, err := s.eraseAccount(ctx, user, now)
			note("an account", user, err)
			done.Households += n
			if erased {
				done.Accounts++
			}
			if ctx.Err() != nil {
				return done, ctx.Err()
			}
		}
	}

	rows, err = s.cfg.Meter.Query(ctx, `
		SELECT household_id, user_id FROM departures WHERE erased_at IS NULL AND erase_after <= $1 ORDER BY household_id, user_id`, now)
	if err != nil {
		return done, errors.Join(failed, err)
	}
	type departure struct{ household, user uuid.UUID }
	departures, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (departure, error) {
		var d departure
		err := row.Scan(&d.household, &d.user)
		return d, err
	})
	if err != nil {
		return done, errors.Join(failed, err)
	}
	for _, d := range departures {
		erased, err := s.eraseDeparture(ctx, d.household, d.user, now)
		note("a departed member's private data", d.household, err)
		if erased {
			done.Departures++
		}
		if ctx.Err() != nil {
			return done, ctx.Err()
		}
	}
	// The purge jobs a private root's files left run now, not at the workers' next poll.
	s.cfg.Files.Nudge()

	objects, err := s.purge(ctx, now)
	done.Objects = objects
	failed = errors.Join(failed, err)
	if done != (Erased{}) {
		s.cfg.Log.LogAttrs(ctx, slog.LevelInfo, "privacy: erased what was due", slog.Int("households", done.Households),
			slog.Int("accounts", done.Accounts), slog.Int("departures", done.Departures), slog.Int("objects", done.Objects))
	}
	return done, failed
}

// eraseDue erases household if it is still due at now, read again under its lock: its deletion
// scheduled and come due, or its retention run out (D-119). An owner who cancelled, or a
// subscription that resumed, since the search leaves nothing to do. A deletion that follows an
// account's is that account's to execute, with everything else of its (eraseAccount); should the
// account's deletion no longer stand, cancelled while this household's cancellation failed, it is
// cancelled here.
func (s *Service) eraseDue(ctx context.Context, household uuid.UUID, now time.Time) (bool, error) {
	var (
		cause   string
		account *uuid.UUID
	)
	err := tenant.InTx(s.system(ctx, household), func(tx pgx.Tx) error {
		var scheduled, retained *time.Time
		var billing string
		var warnings int
		err := tx.QueryRow(ctx, `
			SELECT deletion_scheduled_at, deletion_account, billing_state::text, retained_until, retention_warnings
			FROM households WHERE id = $1`, household).Scan(&scheduled, &account, &billing, &retained, &warnings)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		switch {
		case err != nil:
			return err
		case scheduled != nil && !scheduled.After(now):
			cause = causeRequested
		case (billing == "read_only" || billing == "canceled") && retained != nil && !retained.After(now) && warnings >= 3:
			cause = causeLapsed
		}
		return nil
	})
	if err != nil || cause == "" {
		return false, err
	}
	if cause == causeRequested && account != nil {
		var pending, gone bool
		err := tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, `
				SELECT EXISTS (SELECT FROM account_deletions d WHERE d.user_id = u.id), u.deleted_at IS NOT NULL
				FROM users u WHERE u.id = $1`, *account).Scan(&pending, &gone)
		})
		switch {
		case err != nil:
			return false, err
		case pending:
			return false, nil
		case !gone:
			return false, s.cfg.Households.CancelWithAccount(ctx, s.cfg.Registry, household, *account)
		}
		cause = causeAccount
	}
	return s.eraseHousehold(ctx, household, cause, now, func(ctx context.Context, tx pgx.Tx) (bool, error) {
		// Still due, under the lock: neither cancelled nor resumed since it was read. A deletion
		// cancelled leaves no day to compare, which is not due rather than unknown.
		var due bool
		err := tx.QueryRow(ctx, `
			SELECT coalesce(deletion_scheduled_at <= $2, false)
			  OR coalesce(billing_state IN ('read_only', 'canceled') AND retained_until <= $2 AND retention_warnings >= 3, false)
			FROM households WHERE id = $1`, household, now).Scan(&due)
		return due, err
	})
}

// tombstone records, in tx, that the household or the account id was erased at at, for cause
// (erasures): what erasure leaves of it, with its objects still to be removed (purge).
func tombstone(ctx context.Context, tx pgx.Tx, kind string, id uuid.UUID, cause string, at time.Time) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO erasures (kind, id, cause, erased_at) VALUES ($1, $2, $3, $4)
		ON CONFLICT (kind, id) DO UPDATE SET erased_at = excluded.erased_at, purged_at = NULL`,
		kind, id, cause, at)
	return err
}

// EraseRows deletes every row of household, in tx, a transaction of its own that may write: each
// module of reg is asked to erase what it keeps (module.EraseSource), and then the household's own
// row goes, which every tenant table hangs from, directly or through a table that does, so that the
// cascade takes the rest. A tenant table the cascade did not reach would keep a deleted household's
// rows for good, where no member could ever read them again: a test holds every one to it, over
// the isolation fixture, which has a row in each (internal/arch).
func EraseRows(ctx context.Context, tx pgx.Tx, reg *module.Registry, household uuid.UUID) error {
	for _, src := range sources(reg) {
		if src.erase == nil {
			continue
		}
		if err := src.erase(ctx, tx, module.Erasure{Household: household}); err != nil {
			return fmt.Errorf("privacy: erase %s: %w", src.name, err)
		}
	}
	_, err := tx.Exec(ctx, "DELETE FROM households WHERE id = $1", household)
	return err
}

// eraseMember asks each module of reg to delete what member kept privately in household, in tx.
func eraseMember(ctx context.Context, tx pgx.Tx, reg *module.Registry, household, member uuid.UUID) error {
	for _, src := range sources(reg) {
		if src.erase == nil {
			continue
		}
		if err := src.erase(ctx, tx, module.Erasure{Household: household, Member: member}); err != nil {
			return fmt.Errorf("privacy: erase %s: %w", src.name, err)
		}
	}
	return nil
}

// eraseHousehold erases household for cause (FR-PR6): in one transaction of its own, every module's
// Erase, then the household's row, which every tenant table hangs from, so that its settings,
// members, grants, invitations, modules' rows, files' rows, notifications, audit log and the rest go
// with it, and the tombstone its objects are removed by once that has committed (purge). still, when
// not nil, is asked under the row's lock whether the household is still to be erased. Its child
// profiles, which are nothing outside it, are scheduled for erasure at now, the time the job's run
// searches by, so that the run that erased their household erases them too; and the archives of its
// exports are removed with it. It reports whether it erased it.
func (s *Service) eraseHousehold(ctx context.Context, household uuid.UUID, cause string, now time.Time,
	still func(context.Context, pgx.Tx) (bool, error),
) (bool, error) {
	var (
		archives []string
		erased   bool
	)
	scoped := s.system(ctx, household)
	err := tenant.InWriteTx(scoped, func(tx pgx.Tx) error {
		// FOR UPDATE, against every mutation of the household, whose audit event holds its row.
		var id uuid.UUID
		err := tx.QueryRow(ctx, "SELECT id FROM households WHERE id = $1 FOR UPDATE", household).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if still != nil {
			if ok, err := still(ctx, tx); err != nil || !ok {
				return err
			}
		}
		// A child profile is an account nobody can sign in to once its household is gone: its erasure
		// is due now, by the run's own time. A clock read here would be later than the one the run
		// finds the accounts due by, and the profile would wait a night for nothing.
		rows, err := tx.Query(ctx, "SELECT user_id FROM memberships WHERE household_id = $1 AND role = 'child' ORDER BY user_id", household)
		if err != nil {
			return err
		}
		children, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		if err != nil {
			return err
		}
		for _, child := range children {
			if _, err := tx.Exec(ctx, `
				INSERT INTO account_deletions (user_id, id, cause, requested_at, executes_at) VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (user_id) DO UPDATE SET executes_at = least(account_deletions.executes_at, excluded.executes_at)`,
				child, idgen.New(), causeChildRemoved, now.Add(-time.Second), now); err != nil {
				return err
			}
		}
		rows, err = tx.Query(ctx, "SELECT object FROM exports WHERE household_id = $1 AND object IS NOT NULL", household)
		if err != nil {
			return err
		}
		if archives, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return err
		}
		// A household deleted is no longer charged: its subscriptions are ended at the payment
		// processor here, once the row's lock is held and nothing cancels the erasure any more, and
		// before the rows that name them go (billing.Service.Close). The processor is asked inside the
		// transaction, which is held meanwhile: a failure there leaves the household as it was, for the
		// next night, where a subscription ended and then not erased would be the lesser harm, a
		// household due for deletion that lapses a night early.
		if err := s.cfg.Billing.Close(ctx, tx, household); err != nil {
			return err
		}
		if err := EraseRows(scoped, tx, s.cfg.Registry, household); err != nil {
			return err
		}
		err = tombstone(ctx, tx, kindHousehold, household, cause, now)
		erased = err == nil
		return err
	})
	if err != nil || !erased {
		return false, err
	}
	s.cfg.Log.LogAttrs(ctx, slog.LevelInfo, "privacy: erased a household", slog.String(logging.KeyHouseholdID, household.String()),
		slog.String("cause", cause))
	// The archives now, which are under their requesters' prefixes and which no row names any more: one
	// that stays is the expiry sweep's to find (sweep). The objects under the household's own prefix are
	// the tombstone's, removed as the run ends and again on the nights after (purge).
	return true, s.cfg.Files.Store().Delete(ctx, archives...)
}

// eraseAccount executes user's scheduled deletion (FR-PR3, FR-PR4), read again as it is: cancelled
// since the search, it does nothing, and from that read on its link cancels nothing
// (identity.Service.EndCancelLink). Household by household, in each one's own context, what the
// household keeps of the user is deleted (forget), what they kept privately by its modules, what was
// sent to them, and their name on the events they caused; and the household surface ends their
// membership and says what becomes of the household (household.Service.Depart): one that goes with
// the account is erased. The households they had left before, and those whose invitation they
// declined without ever joining, whose logs name them too (Named), are found by their departures, and
// treated the same. The account's own tables go last, in one transaction, which leaves the tombstone.
//
// A failure before that leaves the account scheduled, and the next night goes over the households
// again, each step doing nothing where it was done. It finds a household by the membership, or by
// the departure, so whichever it is goes last there: a household the user is a member of is
// forgotten before the membership ends, and one they had left loses the record of it only once the
// rest is done. Ended first, a membership would leave nothing to find the household by, and what a
// failed night left there of the user would stay for good.
//
// It returns how many households it erased, and whether it erased the account.
func (s *Service) eraseAccount(ctx context.Context, user uuid.UUID, now time.Time) (int, bool, error) {
	var cause string
	err := tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
		// The link that cancels it ends here, before the deletion is read: a cancellation under way
		// is waited for, and has taken the deletion's row by the time it is read below; one that comes
		// later finds its link spent. Nothing cancels a deletion once its execution has begun.
		if err := s.cfg.Accounts.EndCancelLink(ctx, tx, user, now); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, "SELECT cause FROM account_deletions WHERE user_id = $1 AND executes_at <= $2", user, now).Scan(&cause)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	})
	if err != nil || cause == "" {
		return 0, false, err
	}
	var member []uuid.UUID
	if err := tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT household_id FROM memberships WHERE user_id = $1 ORDER BY household_id", user)
		if err != nil {
			return err
		}
		member, err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		return err
	}); err != nil {
		return 0, false, err
	}
	rows, err := s.cfg.Meter.Query(ctx, "SELECT household_id FROM departures WHERE user_id = $1 ORDER BY household_id", user)
	if err != nil {
		return 0, false, err
	}
	left, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return 0, false, err
	}
	households := 0
	for _, id := range member {
		if err := s.forget(ctx, id, user); err != nil {
			return households, false, err
		}
		fate, err := s.cfg.Households.Depart(ctx, s.cfg.Registry, id, user)
		if err != nil {
			return households, false, err
		}
		if !fate.Erase {
			continue
		}
		// The household's fate was read in a transaction that has ended: it is erased only as it was
		// read, with the members it had then. One who joined since, by an invitation the account sent
		// before it was disabled, makes it theirs to run (D-137): the account stays scheduled, and the
		// job's next run resolves the household again.
		erased, err := s.eraseHousehold(ctx, id, fate.Cause, now, func(ctx context.Context, tx pgx.Tx) (bool, error) {
			var members int
			if err := tx.QueryRow(ctx, "SELECT count(*) FROM memberships WHERE household_id = $1", id).Scan(&members); err != nil {
				return false, err
			}
			if members != fate.Members {
				return false, errResolveAgain
			}
			return true, nil
		})
		if erased {
			households++
		}
		if err != nil {
			return households, false, err
		}
	}
	for _, id := range left {
		// A member who came back inside their window is both, and was taken out above: the household
		// may have gone with them.
		if slices.Contains(member, id) {
			continue
		}
		if _, err := s.cfg.Households.Depart(ctx, s.cfg.Registry, id, user); err != nil {
			return households, false, err
		}
		if err := s.forget(ctx, id, user); err != nil {
			return households, false, err
		}
	}
	// The account's customers at the payment processor go before the rows that name them: asked
	// again the next night, should what follows fail, a customer deleted already is gone already.
	if err := s.cfg.Billing.Forget(ctx, user); err != nil {
		return households, false, err
	}
	err = tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
		if err := billing.ForgetRows(ctx, tx, user); err != nil {
			return err
		}
		for _, table := range []string{"exports", "diagnostic_bundles", "consents", "account_deletions"} {
			if _, err := tx.Exec(ctx, "DELETE FROM "+table+" WHERE user_id = $1", user); err != nil {
				return err
			}
		}
		if err := notify.EraseAccount(ctx, tx, user); err != nil {
			return err
		}
		if err := s.cfg.Accounts.Erase(ctx, tx, user); err != nil {
			return err
		}
		return tombstone(ctx, tx, kindAccount, user, cause, now)
	})
	if err != nil {
		return households, false, err
	}
	s.cfg.Log.LogAttrs(ctx, slog.LevelInfo, "privacy: erased an account", slog.String("user_id", user.String()),
		slog.String("cause", cause))
	return households, true, nil
}

// forget deletes what household keeps of user beside their membership, which the household surface
// ends: what they kept privately there, each module's to delete; the notifications sent to them; and
// their name on the events they caused, which read as a former member's from then on (FR-PR4). The
// record that they once left it goes too: the tombstone needs none.
func (s *Service) forget(ctx context.Context, household, user uuid.UUID) error {
	scoped := s.system(ctx, household)
	err := tenant.InWriteTx(scoped, func(tx pgx.Tx) error {
		if err := eraseMember(scoped, tx, s.cfg.Registry, household, user); err != nil {
			return err
		}
		if err := notify.EraseMember(ctx, tx, household, user); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "SELECT forget_actor($1)", user); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, "DELETE FROM departures WHERE household_id = $1 AND user_id = $2", household, user)
		return err
	})
	if err == nil {
		s.cfg.Files.Nudge()
	}
	return err
}

// eraseDeparture deletes what user, who left household, kept privately there, once their window
// has ended at now (FR-PR7): each module's to delete, with its files. A user who is a member again
// keeps what they had, and the record of their leaving goes. It reports whether it erased anything.
func (s *Service) eraseDeparture(ctx context.Context, household, user uuid.UUID, now time.Time) (bool, error) {
	scoped := s.system(ctx, household)
	erased := false
	err := tenant.InWriteTx(scoped, func(tx pgx.Tx) error {
		var back bool
		err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT FROM memberships m WHERE m.household_id = d.household_id AND m.user_id = d.user_id)
			FROM departures d
			WHERE d.household_id = $1 AND d.user_id = $2 AND d.erased_at IS NULL AND d.erase_after <= $3
			FOR UPDATE OF d`, household, user, now).Scan(&back)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if back {
			_, err := tx.Exec(ctx, "DELETE FROM departures WHERE household_id = $1 AND user_id = $2", household, user)
			return err
		}
		if err := eraseMember(scoped, tx, s.cfg.Registry, household, user); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, "UPDATE departures SET erased_at = $3 WHERE household_id = $1 AND user_id = $2", household, user, now)
		erased = err == nil
		return err
	})
	return erased, err
}

// purge removes the objects of every erasure whose objects are not known to be gone, this run's
// among them, and of every one made in the last days, again: an upload in flight when its household
// was erased put its bytes after the first pass, and no row is left to name them. It is the one place
// an erasure's objects are removed, so what it returns is how many objects the run removed.
func (s *Service) purge(ctx context.Context, now time.Time) (int, error) {
	type erasure struct {
		kind string
		id   uuid.UUID
	}
	var due []erasure
	err := tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT kind, id FROM erasures WHERE purged_at IS NULL OR erased_at > $1 ORDER BY erased_at, id",
			now.Add(-Repurge))
		if err != nil {
			return err
		}
		due, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (erasure, error) {
			var e erasure
			err := row.Scan(&e.kind, &e.id)
			return e, err
		})
		return err
	})
	if err != nil {
		return 0, err
	}
	var (
		removed int
		failed  error
	)
	for _, e := range due {
		n, err := s.purgeOne(ctx, e.kind, e.id)
		removed += n
		if err != nil {
			s.cfg.Log.LogAttrs(ctx, slog.LevelError, "privacy: remove an erasure's objects", slog.String("kind", e.kind),
				slog.String("id", e.id.String()), slog.Any("error", err))
			failed = errors.Join(failed, err)
		}
		if ctx.Err() != nil {
			return removed, ctx.Err()
		}
	}
	return removed, failed
}

// purgeOne removes the objects under the prefix of the erased household or account id, h/{id}/ or
// u/{id}/, a household's files and their variants or an account's pictures and archives, and marks
// the erasure purged. It returns how many it removed.
func (s *Service) purgeOne(ctx context.Context, kind string, id uuid.UUID) (int, error) {
	var (
		n   int
		err error
	)
	if kind == kindHousehold {
		n, err = s.cfg.Files.Erase(ctx, id)
	} else {
		n, err = s.cfg.Files.Store().RemoveAll(ctx, "u/"+id.String()+"/")
	}
	if err != nil {
		return n, err
	}
	return n, tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "UPDATE erasures SET purged_at = $3 WHERE kind = $1 AND id = $2", kind, id, s.cfg.Now())
		return err
	})
}
