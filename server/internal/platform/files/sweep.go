package files

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// SweepGrace is how old an object no row records must be before the sweep removes it: an upload
// in flight has put its bytes and not yet committed its row for a moment, never a day.
const SweepGrace = 24 * time.Hour

// Sweep removes the objects under household's prefix that no row records and that are older than
// SweepGrace: what an upload whose mutation failed, or a process that died between the store and
// the commit, left behind, which nothing bills (FR-ST2 samples the rows) and nothing would ever
// remove. It returns how many it removed.
//
// It lists the old objects first and reads the rows after, so that a row committed while the listing
// ran keeps its bytes: a retry that found its own bytes stored a day before, never recorded, records
// them now (Put). A row committed between the read and the delete is a window of moments that only a
// delete conditional on the row could close, which the store cannot be asked.
func (s *Service) Sweep(ctx context.Context, household uuid.UUID) (int, error) {
	cutoff := s.now().Add(-SweepGrace)
	var old []string
	if err := s.store.List(ctx, "h/"+household.String()+"/", func(o objectstore.Info) error {
		if o.LastModified.Before(cutoff) {
			old = append(old, o.Key)
		}
		return nil
	}); err != nil {
		return 0, err
	}
	if len(old) == 0 {
		return 0, nil
	}
	recorded := map[string]bool{}
	err := tenant.InTx(s.system(ctx, household), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT module, entity_id, variant FROM files WHERE household_id = $1", household)
		if err != nil {
			return err
		}
		var (
			module, variant string
			entity          uuid.UUID
		)
		_, err = pgx.ForEachRow(rows, []any{&module, &entity, &variant}, func() error {
			recorded[Key(household, module, entity, variant)] = true
			return nil
		})
		return err
	})
	if err != nil {
		return 0, err
	}
	keys := slices.DeleteFunc(old, func(k string) bool { return recorded[k] })
	return len(keys), s.store.Delete(ctx, keys...)
}

// SweepAll sweeps every household, as the meter role lists them. A household that fails is
// logged and the rest are swept, and every failure is returned. Item 15's scheduler runs it
// nightly.
func (s *Service) SweepAll(ctx context.Context) error {
	rows, err := s.meter.Query(ctx, "SELECT id FROM households ORDER BY id")
	if err != nil {
		return err
	}
	households, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return err
	}
	var failed error
	for _, h := range households {
		n, err := s.Sweep(ctx, h)
		switch {
		case err != nil:
			s.log.LogAttrs(ctx, slog.LevelError, "files: sweep a household", householdAttr(h), slog.Any("error", err))
			failed = errors.Join(failed, err)
		case n > 0:
			s.log.LogAttrs(ctx, slog.LevelInfo, "files: swept objects no row records",
				householdAttr(h), slog.Int("objects", n))
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return failed
}
