package storage

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Counts is what a household holds that fair use bounds (PRD 04 §5): its objects, and the rows each
// module holds in the tables it declares (module.StorageSource).
type Counts struct {
	Objects int64
	Rows    map[string]int64
}

// Count counts, now, what household holds, as meter, the meter role's pool, reads it from one
// snapshot: the counters item 16's fair-use ceilings compare with, before a write, where the daily
// sample holds the same figures as of the night, read the same way (Sampler).
//
// It reads as the meter role, never in the caller's context as the request role: a module narrows
// what the request role reads with a restrictive policy, a private item's owner's (ADR 0005), which
// keeps every other member's private rows from the caller, and every private row from a context
// with no caller. The household's rows are all of them, whoever may read them: counted as the
// caller, another member's private notes would count for nothing against the household's ceiling,
// and the figure would differ with each member who asked. The meter's policy admits it to every row,
// and it reads only the column that names the household (architecture tests 2 and 11).
func Count(ctx context.Context, meter tenant.Beginner, household uuid.UUID, modules *module.Registry) (Counts, error) {
	tables, err := declaredTables(modules)
	if err != nil {
		return Counts{}, err
	}
	out := Counts{Rows: map[string]int64{}}
	err = pgx.BeginTxFunc(ctx, meter, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM files WHERE household_id = $1", household).Scan(&out.Objects); err != nil {
			return err
		}
		for _, t := range tables {
			var n int64
			if err := tx.QueryRow(ctx, "SELECT count(*) FROM "+t.name.Sanitize()+" WHERE household_id = $1", household).Scan(&n); err != nil {
				return err
			}
			out.Rows[t.module] += n
		}
		return nil
	})
	return out, err
}
