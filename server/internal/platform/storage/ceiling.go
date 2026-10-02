package storage

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/fairuse"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// RowCeiling holds each module of a household to the rows it may hold (PRD 04 §5, D-116), for the
// mutation spine to ask of every mutation that creates rows (mutation.Ceiling).
//
// A household's last daily sample says how many rows each module held the night before: one indexed
// read, in the mutation's own transaction. Below 80 % of the ceiling that is enough, since the
// ceiling exists to catch automation rather than a family, and a household that far below it does not
// reach it in a day of either. At or above, the module's rows are counted now, as the meter role
// reads them all, every member's private rows among them (Count), and a create that would pass the
// ceiling is refused 403 fair_use_ceiling. So a household near the ceiling pays for a count with each
// create, and one that deletes rows to come back below it is let in at once, not the next night.
type RowCeiling struct {
	// Meter is the meter role's pool, which counts every row of a household.
	Meter tenant.Beginner
	// Modules declare their tables (module.StorageSource).
	Modules *module.Registry
	// Ceiling is the rows a module may hold, fairuse.Rows when zero.
	Ceiling int64
}

// Check is the mutation spine's ceiling (mutation.Ceiling). A module that declares no tables, as the
// platform's own do not, holds no rows fair use counts.
func (c RowCeiling) Check(ctx context.Context, tx pgx.Tx, household uuid.UUID, mod string, creates int64) error {
	ceiling := c.Ceiling
	if ceiling == 0 {
		ceiling = fairuse.Rows
	}
	tables, err := declaredTables(c.Modules)
	if err != nil {
		return err
	}
	var own []countedTable
	for _, t := range tables {
		if t.module == mod {
			own = append(own, t)
		}
	}
	if len(own) == 0 {
		return nil
	}
	var sampled int64
	err = tx.QueryRow(ctx, `
		SELECT row_count FROM usage_sample_modules WHERE household_id = $1 AND module = $2
		ORDER BY sampled_on DESC LIMIT 1`, household, mod).Scan(&sampled)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if !fairuse.Warns(sampled+creates, ceiling) {
		return nil
	}
	var rows int64
	err = pgx.BeginTxFunc(ctx, c.Meter, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(mtx pgx.Tx) error {
		for _, t := range own {
			var n int64
			if err := mtx.QueryRow(ctx, "SELECT count(*) FROM "+t.name.Sanitize()+" WHERE household_id = $1", household).Scan(&n); err != nil {
				return err
			}
			rows += n
		}
		return nil
	})
	if err != nil {
		return err
	}
	if rows+creates > ceiling {
		return fairuse.Refusal(fairuse.ResourceRows, ceiling, mod)
	}
	return nil
}
