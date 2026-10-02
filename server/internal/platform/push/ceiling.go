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

// count adds n, the mutations of a batch, to the count of the mutations ctx's household's replicas
// pushed on this UTC day, the metering bucket every household shares (D-109), and refuses the batch,
// 429 with Retry-After until the day ends, when the count had reached the day's fair use already
// (fairuse.SyncMutations, PRD 04 §5): a rate, which falls on its own, as a 429 says (D-116, D-127). A
// refused batch is not counted. The batch that crosses 80 % of it tells the household's owners, once.
//
// The count is the push's own record, no entity's history, kept in a transaction of its own, as its
// answers are (keep).
func (s *Service) count(ctx context.Context, n int) error {
	household := tenant.From(ctx).HouseholdID()
	now := s.now().UTC()
	warned := false
	err := tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		var after int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO sync_usage AS u (household_id, day, mutations) VALUES ($1, $2::date, $3)
			ON CONFLICT (household_id, day) DO UPDATE SET mutations = u.mutations + excluded.mutations
			RETURNING mutations`, household, now.Format(time.DateOnly), n).Scan(&after); err != nil {
			return fmt.Errorf("push: count the day's mutations: %w", err)
		}
		before := after - int64(n)
		if before >= fairuse.SyncMutations {
			tomorrow := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
			return ratelimit.Refusal(tomorrow.Sub(now))
		}
		if s.notify == nil || !fairuse.Crossed(before, after, fairuse.SyncMutations) {
			return nil
		}
		warned = true
		return fairuse.SyncNotice(ctx, tx, s.notify, household, after)
	})
	if err == nil && warned {
		s.notify.Nudge(ctx, household)
	}
	return err
}
