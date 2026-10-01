package storage

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Sampler takes the daily usage sample (FR-ST2): for every household, the bytes it keeps, derived
// variants included (FR-ST3), by module and by member, its objects, and the rows of each module's
// tables, which fair use watches (PRD 04 §5). The meter role measures every household at once, as
// it alone may, and each household's sample is written in its own context by the request role: no
// role both reads across households and writes. Item 15's scheduler runs it nightly; billing
// averages the samples over its period (item 19).
type Sampler struct {
	// Meter measures, connected as the meter role.
	Meter tenant.Beginner
	// Pool writes each household's sample, connected as the request role.
	Pool tenant.Beginner
	// Modules are the modules whose tables are counted (module.StorageSource).
	Modules *module.Registry
	Log     *slog.Logger
	// Now is the clock, time.Now when nil: a sample is the day's it is taken on, in UTC.
	Now func() time.Time
}

// batch is how many households one measurement reads at once.
const batch = 500

// Sample takes every household's sample as of now, replacing any taken on the same day, and returns
// how many households it sampled. A household that cannot be written is logged and the rest are
// sampled, and so is a table a module declares that cannot be counted, which the samples leave out
// (countable); every failure is returned.
func (s *Sampler) Sample(ctx context.Context) (int, error) {
	now := time.Now
	if s.Now != nil {
		now = s.Now
	}
	at := now().UTC()
	day := time.Date(at.Year(), at.Month(), at.Day(), 0, 0, 0, 0, time.UTC)
	tables, failed := declaredTables(s.Modules)
	if failed != nil {
		s.Log.LogAttrs(ctx, slog.LevelError, "storage: a module declares a table that is not one", slog.Any("error", failed))
	}
	tables, refused, err := s.countable(ctx, tables)
	if err != nil {
		return 0, errors.Join(failed, err)
	}
	failed = errors.Join(append([]error{failed}, refused...)...)
	var (
		after   uuid.UUID
		sampled int
	)
	for {
		samples, err := s.measure(ctx, after, tables)
		if err != nil {
			return sampled, errors.Join(failed, err)
		}
		if len(samples) == 0 {
			return sampled, failed
		}
		for _, u := range samples {
			if err := s.write(ctx, day, at, u); err != nil {
				s.Log.LogAttrs(ctx, slog.LevelError, "storage: write a usage sample",
					slog.String(logging.KeyHouseholdID, u.household.String()), slog.Any("error", err))
				failed = errors.Join(failed, err)
				continue
			}
			sampled++
		}
		after = samples[len(samples)-1].household
		if ctx.Err() != nil {
			return sampled, ctx.Err()
		}
	}
}

// usage is one household's measurement.
type usage struct {
	household uuid.UUID
	stored    int64
	derived   int64
	objects   int64
	modules   map[string]*moduleUsage
	members   map[uuid.UUID]*memberUsage
}

type moduleUsage struct{ stored, derived, objects, rows int64 }

type memberUsage struct{ stored, objects int64 }

// countedTable is a table a module declares, whose rows are counted as the module's.
type countedTable struct {
	module string
	name   pgx.Identifier
}

// declaredTables returns the tables modules declare, whose rows the sample and the live counts
// count as each declaring module's, and a failure for each declaration that is not a table's name,
// which it leaves out.
func declaredTables(modules *module.Registry) ([]countedTable, error) {
	var (
		out []countedTable
		bad error
	)
	for _, m := range modules.All() {
		src, ok := m.(module.StorageSource)
		if !ok {
			continue
		}
		for _, t := range src.StorageTables() {
			parts := strings.Split(t, ".")
			if len(parts) > 2 || slices.Contains(parts, "") {
				bad = errors.Join(bad, fmt.Errorf("storage: %s declares %q, which is not a table's name", m.Name(), t))
				continue
			}
			out = append(out, countedTable{module: m.Name(), name: pgx.Identifier(parts)})
		}
	}
	return out, bad
}

// countable returns the tables of tables the meter role can count, each asked once, in a transaction
// of its own, before any household is measured, and why it cannot count each of the others. A table
// a module declares that is not there, or whose household the role may not read, would fail the
// snapshot each batch of households is measured from, and with it every household's sample, the
// bytes billing averages among them (FR-ST2): it is logged and left out, its module's rows counted
// without it, and the households are sampled all the same. A database that fails the question
// otherwise is err, which fails the sample, as it would fail the measurement.
func (s *Sampler) countable(ctx context.Context, tables []countedTable) ([]countedTable, []error, error) {
	var (
		out     []countedTable
		refused []error
	)
	for _, t := range tables {
		err := pgx.BeginTxFunc(ctx, s.Meter, pgx.TxOptions{AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, "SELECT household_id FROM "+t.name.Sanitize()+" LIMIT 0")
			return err
		})
		if err == nil {
			out = append(out, t)
			continue
		}
		err = fmt.Errorf("storage: count the rows of %s's %s: %w", t.module, t.name.Sanitize(), err)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || !slices.Contains(undeclarable, pgErr.Code) {
			return nil, nil, err
		}
		s.Log.LogAttrs(ctx, slog.LevelError, "storage: a table a module declares cannot be counted",
			slog.String("module", t.module), slog.Any("error", err))
		refused = append(refused, err)
	}
	return out, refused, nil
}

// undeclarable are the SQLSTATEs of a table the meter role cannot count because of what a module
// declares: invalid_schema_name, undefined_table, undefined_column and insufficient_privilege.
var undeclarable = []string{"3F000", "42P01", "42703", "42501"}

// measure reads, as the meter role and from one snapshot, what the next batch of households after
// after keep.
func (s *Sampler) measure(ctx context.Context, after uuid.UUID, tables []countedTable) ([]*usage, error) {
	var out []*usage
	err := pgx.BeginTxFunc(ctx, s.Meter, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT id FROM households WHERE id > $1 ORDER BY id LIMIT $2", after, batch)
		if err != nil {
			return err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		if err != nil || len(ids) == 0 {
			return err
		}
		byID := make(map[uuid.UUID]*usage, len(ids))
		for _, id := range ids {
			u := &usage{household: id, modules: map[string]*moduleUsage{}, members: map[uuid.UUID]*memberUsage{}}
			byID[id] = u
			out = append(out, u)
		}
		of := func(u *usage, m string) *moduleUsage {
			if u.modules[m] == nil {
				u.modules[m] = &moduleUsage{}
			}
			return u.modules[m]
		}

		rows, err = tx.Query(ctx, `
			SELECT household_id, module, variant <> 'original', sum(byte_size)::bigint, count(*)
			FROM files WHERE household_id = ANY($1) GROUP BY 1, 2, 3`, ids)
		if err != nil {
			return err
		}
		var (
			household uuid.UUID
			name      string
			derived   bool
			bytes, n  int64
		)
		if _, err := pgx.ForEachRow(rows, []any{&household, &name, &derived, &bytes, &n}, func() error {
			u, m := byID[household], of(byID[household], name)
			u.stored, u.objects, m.stored, m.objects = u.stored+bytes, u.objects+n, m.stored+bytes, m.objects+n
			if derived {
				u.derived, m.derived = u.derived+bytes, m.derived+bytes
			}
			return nil
		}); err != nil {
			return err
		}

		rows, err = tx.Query(ctx, `
			SELECT household_id, owner_id, sum(byte_size)::bigint, count(*)
			FROM files WHERE household_id = ANY($1) AND owner_id IS NOT NULL GROUP BY 1, 2`, ids)
		if err != nil {
			return err
		}
		var member uuid.UUID
		if _, err := pgx.ForEachRow(rows, []any{&household, &member, &bytes, &n}, func() error {
			byID[household].members[member] = &memberUsage{stored: bytes, objects: n}
			return nil
		}); err != nil {
			return err
		}

		for _, t := range tables {
			rows, err := tx.Query(ctx, "SELECT household_id, count(*) FROM "+t.name.Sanitize()+
				" WHERE household_id = ANY($1) GROUP BY 1", ids)
			if err != nil {
				return fmt.Errorf("storage: count the rows of %s's %s: %w", t.module, t.name.Sanitize(), err)
			}
			if _, err := pgx.ForEachRow(rows, []any{&household, &n}, func() error {
				of(byID[household], t.module).rows += n
				return nil
			}); err != nil {
				return err
			}
		}
		return nil
	})
	return out, err
}

// write replaces u's household's sample of day in its own context.
func (s *Sampler) write(ctx context.Context, day, at time.Time, u *usage) error {
	scoped := tenant.Assume(ctx, s.Pool, u.household, uuid.Nil, "")
	return tenant.InWriteTx(scoped, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO usage_samples (household_id, sampled_on, sampled_at, stored_bytes, derived_bytes, object_count)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (household_id, sampled_on) DO UPDATE SET sampled_at = excluded.sampled_at,
			  stored_bytes = excluded.stored_bytes, derived_bytes = excluded.derived_bytes, object_count = excluded.object_count`,
			u.household, day, at, u.stored, u.derived, u.objects); err != nil {
			return err
		}
		for _, table := range []string{"usage_sample_modules", "usage_sample_members"} {
			if _, err := tx.Exec(ctx, "DELETE FROM "+table+" WHERE household_id = $1 AND sampled_on = $2", u.household, day); err != nil {
				return err
			}
		}
		for name, m := range u.modules {
			if _, err := tx.Exec(ctx, `
				INSERT INTO usage_sample_modules (household_id, sampled_on, module, stored_bytes, derived_bytes, object_count, row_count)
				VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				u.household, day, name, m.stored, m.derived, m.objects, m.rows); err != nil {
				return err
			}
		}
		for member, m := range u.members {
			if _, err := tx.Exec(ctx, `
				INSERT INTO usage_sample_members (household_id, sampled_on, user_id, stored_bytes, object_count)
				VALUES ($1, $2, $3, $4, $5)`,
				u.household, day, member, m.stored, m.objects); err != nil {
				return err
			}
		}
		return nil
	})
}
