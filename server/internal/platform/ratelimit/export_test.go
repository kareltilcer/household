package ratelimit

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Blocked returns how long subject must wait before l lets it try again, zero when it may now.
func (t *Throttles) Blocked(ctx context.Context, l Limit, subject string) (time.Duration, error) {
	var s state
	err := pgx.BeginTxFunc(ctx, t.pool, pgx.TxOptions{AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		var blocked *time.Time
		err := tx.QueryRow(ctx, "SELECT count, window_ends_at, blocked_until FROM auth_throttles WHERE key = $1",
			key(l, subject)).Scan(&s.count, &s.windowEnds, &blocked)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if blocked != nil {
			s.blockedUntil = *blocked
		}
		return err
	})
	if err != nil {
		return 0, err
	}
	return l.wait(s, t.now()), nil
}

// Kept reports whether l keeps a row for subject.
func (t *Throttles) Kept(ctx context.Context, l Limit, subject string) (bool, error) {
	var kept bool
	err := pgx.BeginTxFunc(ctx, t.pool, pgx.TxOptions{AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM auth_throttles WHERE key = $1)", key(l, subject)).Scan(&kept)
	})
	return kept, err
}
