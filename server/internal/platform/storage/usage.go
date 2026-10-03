package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Month is the calendar month at falls in, UTC's, as the daily samples it averages are (D-109): from
// its first day to the first day of the next, which it excludes. Storage is averaged, shown and
// billed by it (PRD 04 §4, D-31, D-128).
func Month(at time.Time) (from, to time.Time) {
	at = at.UTC()
	from = time.Date(at.Year(), at.Month(), 1, 0, 0, 0, 0, time.UTC)
	return from, from.AddDate(0, 1, 0)
}

// Usage is what a household stores over a month, as the storage screen shows it and the invoice
// bills it (FR-BI4).
type Usage struct {
	// From and To are the month, To excluded.
	From, To time.Time
	// Current is what the household stores now, as its files record it.
	Current int64
	// Samples are the month's daily samples so far, in the order of their days.
	Samples []int64
	// Average is their mean, and Current before the month's first sample is taken; Projected is the
	// average the month ends on if the household goes on storing what it stores now.
	Average, Projected int64
}

// ReadUsage reads household's usage of the month now falls in, in tx in its context: what it stores
// now, summed live from its files, and the month's daily samples (FR-ST2). The days still to be
// sampled are those after the latest sample's, or the whole of the month from today when it has none.
func ReadUsage(ctx context.Context, tx pgx.Tx, household uuid.UUID, now time.Time) (Usage, error) {
	u := Usage{}
	u.From, u.To = Month(now)
	if err := tx.QueryRow(ctx, "SELECT coalesce(sum(byte_size), 0)::bigint FROM files WHERE household_id = $1", household).
		Scan(&u.Current); err != nil {
		return Usage{}, err
	}
	latest, err := u.read(ctx, tx, household)
	if err != nil {
		return Usage{}, err
	}
	today := now.UTC()
	next := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
	if !latest.IsZero() {
		next = latest.AddDate(0, 0, 1)
	}
	remaining := int(u.To.Sub(next) / (24 * time.Hour))
	u.Average = u.Current
	if len(u.Samples) > 0 {
		u.Average = Average(u.Samples)
	}
	u.Projected = Projected(u.Samples, u.Current, remaining)
	return u, nil
}

// MonthUsage reads household's samples of the whole month from falls in, in tx in its context: what
// a month that has ended is billed from. Current is nothing, since the month is over.
func MonthUsage(ctx context.Context, tx pgx.Tx, household uuid.UUID, from time.Time) (Usage, error) {
	u := Usage{}
	u.From, u.To = Month(from)
	if _, err := u.read(ctx, tx, household); err != nil {
		return Usage{}, err
	}
	u.Average = Average(u.Samples)
	u.Projected = u.Average
	return u, nil
}

// read fills in u's samples, and returns the day of the latest, the zero time when it has none.
func (u *Usage) read(ctx context.Context, tx pgx.Tx, household uuid.UUID) (time.Time, error) {
	rows, err := tx.Query(ctx, `
		SELECT sampled_on, stored_bytes FROM usage_samples
		WHERE household_id = $1 AND sampled_on >= $2 AND sampled_on < $3 ORDER BY sampled_on`, household, u.From, u.To)
	if err != nil {
		return time.Time{}, err
	}
	var (
		latest, day time.Time
		bytes       int64
	)
	_, err = pgx.ForEachRow(rows, []any{&day, &bytes}, func() error {
		u.Samples = append(u.Samples, bytes)
		latest = day
		return nil
	})
	return latest, err
}

// Standing is what a household's storage stands at against its allowance: what it stores, the blocks
// its month-to-date average needs, and what they bring its allowance to. It is what the household's
// entitlement and its storage picture say (EntitlementSummary, StorageReport).
type Standing struct {
	Used, Included int64
	Blocks         int
}

// Standing is u against a.
func (a Allowance) Standing(u Usage) Standing {
	blocks := a.Blocks(u.Average)
	return Standing{Used: u.Current, Included: a.Included(blocks), Blocks: blocks}
}
