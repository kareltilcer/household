package files

import (
	"context"
	"errors"
	"log/slog"
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
func (s *Service) Sweep(ctx context.Context, household uuid.UUID) (int, error) {
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
	cutoff := s.now().Add(-SweepGrace)
	var keys []string
	if err := s.store.List(ctx, "h/"+household.String()+"/", func(o objectstore.Info) error {
		if !recorded[o.Key] && o.LastModified.Before(cutoff) {
			keys = append(keys, o.Key)
		}
		return nil
	}); err != nil {
		return 0, err
	}
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
			s.log.LogAttrs(ctx, slog.LevelError, "files: sweep a household", slog.String("household_id", h.String()), slog.Any("error", err))
			failed = errors.Join(failed, err)
		case n > 0:
			s.log.LogAttrs(ctx, slog.LevelInfo, "files: swept objects no row records",
				slog.String("household_id", h.String()), slog.Int("objects", n))
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return failed
}
