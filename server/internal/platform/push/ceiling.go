package push

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/fairuse"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// The mutations ctx's household's replicas push on a UTC day, the metering bucket every household
// shares (D-109), are held to their fair use (fairuse.SyncMutations, or what the platform raised it
// to for the household, PRD 04 §5): a rate, which falls on its own, as a 429 says (D-116, D-127).
// admit refuses a batch once the day's count has reached it, and count adds the mutations a batch was
// answered for. The count is the push's own record, no entity's history, kept in transactions of its
// own, as its answers are (keep).

// admit refuses a batch, 429 with Retry-After until the UTC day ends, when the count of ctx's
// household's mutations on this day had reached the day's fair use already. A refused batch is not
// counted, and nothing in it is applied.
func (s *Service) admit(ctx context.Context) error {
	household := tenant.From(ctx).HouseholdID()
	now := s.now().UTC()
	var pushed, ceiling int64
	if err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, "SELECT coalesce((SELECT mutations FROM sync_usage WHERE household_id = $1 AND day = $2::date), 0)",
			household, now.Format(time.DateOnly)).Scan(&pushed); err != nil {
			return err
		}
		var err error
		ceiling, err = fairuse.Ceiling(ctx, tx, household, fairuse.KeySyncMutations, fairuse.SyncMutations)
		return err
	}); err != nil {
		return fmt.Errorf("push: read the day's mutations: %w", err)
	}
	if pushed < ceiling {
		return nil
	}
	tomorrow := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
	return ratelimit.Refusal(tomorrow.Sub(now))
}

// count adds n, the mutations of a batch the push answered for the first time, to the count of ctx's
// household's mutations on this UTC day: never a replay answered from what was kept for it, nor a
// mutation deferred to its replay, so that a batch sent again, after its answer was lost or the
// server failed it, counts each of its mutations once. The batch that takes the count across 80 % of
// the day's fair use tells the household's owners, once. Two batches admitted at once may each take
// the count past the day's fair use by their own size: it catches automation, not the last batch.
func (s *Service) count(ctx context.Context, n int) error {
	if n == 0 {
		return nil
	}
	household := tenant.From(ctx).HouseholdID()
	day := s.now().UTC().Format(time.DateOnly)
	warned := false
	err := tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		var after int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO sync_usage AS u (household_id, day, mutations) VALUES ($1, $2::date, $3)
			ON CONFLICT (household_id, day) DO UPDATE SET mutations = u.mutations + excluded.mutations
			RETURNING mutations`, household, day, n).Scan(&after); err != nil {
			return fmt.Errorf("push: count the day's mutations: %w", err)
		}
		if s.notify == nil {
			return nil
		}
		ceiling, err := fairuse.Ceiling(ctx, tx, household, fairuse.KeySyncMutations, fairuse.SyncMutations)
		if err != nil || !fairuse.Crossed(after-int64(n), after, ceiling) {
			return err
		}
		warned = true
		return fairuse.SyncNotice(ctx, tx, s.notify, household, after, ceiling)
	})
	if err == nil && warned {
		s.notify.Nudge(ctx, household)
	}
	return err
}
