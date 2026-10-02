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
// read, in the mutation's own transaction. Below 80 % of the ceiling that is trusted, since the
// ceiling exists to catch automation rather than a family: a household would have to create a fifth
// of the ceiling between two samples, which only automation does, and the next night's sample then
// holds it. Until then nothing bounds what it creates but its request limits (and item 17's ceiling
// on a day's sync mutations), so automation may pass the ceiling by what it creates in that day. At
// or above 80 %, the module's rows are counted now, as the meter role reads them all, every member's
// private rows among them (Count), and a create that would pass the ceiling is refused 403
// fair_use_ceiling. So a household near the ceiling pays for a count with each create, and one whose
// rows fall back below it is let in at once, not the next night.
//
// What is counted is the rows the database holds, as the sample counts them (PRD 04 §5, §8): a row a
// module deletes stays, a tombstone (ADR 0006), and counts until it is erased, so deleting does not
// bring a household back below the ceiling. Exceeding it is a support conversation, which raises the
// household's ceiling (PRD 04 §5, item 21). Two creates at once each count the rows committed before
// them, and so may pass the ceiling by the other's: fair use catches automation, not the last row.
type RowCeiling struct {
	// Meter is the meter role's pool, which counts every row of a household.
	Meter tenant.Beginner
	// Modules declare their tables (module.StorageSource).
	Modules *module.Registry
}

// Check is the mutation spine's ceiling (mutation.Ceiling). A module that declares no tables, as the
// platform's own do not, holds no rows fair use counts. A declaration that is no table's name is left
// out, as the sampler leaves it out and reports it each night (Sampler.Sample), rather than failing
// every create of every module.
func (c RowCeiling) Check(ctx context.Context, tx pgx.Tx, household uuid.UUID, mod string, creates int64) error {
	const ceiling = fairuse.Rows
	tables, _ := declaredTables(c.Modules)
	var own []countedTable
	for _, t := range tables {
		if t.module == mod {
			own = append(own, t)
		}
	}
	if len(own) == 0 {
		return nil
	}
	// The module's rows in the household's latest sample, none when that sample has no row for it:
	// the sampler writes none for a module that holds nothing, whose older rows are long past.
	var sampled int64
	err := tx.QueryRow(ctx, `
		SELECT coalesce(m.row_count, 0) FROM usage_samples s
		LEFT JOIN usage_sample_modules m ON m.household_id = s.household_id AND m.sampled_on = s.sampled_on AND m.module = $2
		WHERE s.household_id = $1
		ORDER BY s.sampled_on DESC LIMIT 1`, household, mod).Scan(&sampled)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if !fairuse.Warns(sampled+creates, ceiling) {
		return nil
	}
	var rows map[string]int64
	err = pgx.BeginTxFunc(ctx, c.Meter, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(mtx pgx.Tx) error {
		var err error
		rows, err = countRows(ctx, mtx, household, own)
		return err
	})
	if err != nil {
		return err
	}
	if rows[mod]+creates > ceiling {
		return fairuse.Refusal(fairuse.ResourceRows, ceiling, mod)
	}
	return nil
}
