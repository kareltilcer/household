package storage

import (
	"context"

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

// Count counts, now, what ctx's household holds, reading in its context as the request role: the
// counters item 16's fair-use ceilings compare with, before a write, where the daily sample holds the
// same figures as of the night.
func Count(ctx context.Context, modules *module.Registry) (Counts, error) {
	s := &Sampler{Modules: modules}
	tables, err := s.tables()
	if err != nil {
		return Counts{}, err
	}
	out := Counts{Rows: map[string]int64{}}
	err = tenant.InTx(ctx, func(tx pgx.Tx) error {
		household := tenant.From(ctx).HouseholdID()
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
