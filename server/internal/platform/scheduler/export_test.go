package scheduler

import (
	"context"
	"time"
)

// Take is take, for a test that takes a slot as two instances that both lead would.
func (s *Scheduler) Take(ctx context.Context, j Job, now time.Time) (bool, error) {
	return s.take(ctx, j, now)
}

// Next is c's first slot after t.
func Next(c Cadence, t time.Time) time.Time { return c.next(t) }
