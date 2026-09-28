package reference

import (
	"context"
	"errors"
	"fmt"
	"io/fs"

	"github.com/jackc/pgx/v5"
)

// Report is what one load did to one dataset.
type Report struct {
	Dataset string
	// Version is the dataset's version once the load is done: incremented when the load wrote any
	// of its rows, and otherwise what it was, 0 for a dataset never loaded.
	Version int64
	// Inserted, Updated and Unchanged count the rows the files hold, by what the load did to each.
	Inserted, Updated, Unchanged int
	// Kept counts the rows the files no longer hold. The loader never deletes one: an app in the
	// field may still name it (D-11).
	Kept int
}

// Changed reports whether the load wrote any of the dataset's rows.
func (r Report) Changed() bool { return r.Inserted+r.Updated > 0 }

// Beginner opens the loader's transaction: a connection or a pool, or a transaction, in which it
// opens a savepoint.
type Beginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// loadLock is the advisory lock key that serialises loads, so that two instances deploying at
// once apply one load after the other rather than racing to insert the same rows.
const loadLock int64 = 0x72656665_72656e63 // "referenc"

// Load reads the reference data in fsys (Read) and writes it into the reference tables in one
// transaction, which commits all of it or none, returning what it did to each dataset. It runs as
// the migrate role, which owns the tables, once the migrations have run.
//
// Loading the same files again writes nothing. A row the files hold is inserted at version 1, and
// updated, its version incremented, only when a column differs; a dataset's version is incremented
// only when a load wrote any of its rows. A row the files no longer hold is kept.
func Load(ctx context.Context, db Beginner, fsys fs.FS) ([]Report, error) {
	data, err := Read(fsys)
	if err != nil {
		return nil, err
	}
	var reports []Report
	err = pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", loadLock); err != nil {
			return err
		}
		units, err := loadUnits(ctx, tx, data.Dimensions)
		if err != nil {
			return fmt.Errorf("%s: %w", Units, err)
		}
		countries, err := loadCountries(ctx, tx, data.Countries)
		if err != nil {
			return fmt.Errorf("%s: %w", Countries, err)
		}
		reports = []Report{countries, units}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("reference data: load: %w", err)
	}
	return reports, nil
}

// upsert runs stmt, an INSERT … ON CONFLICT DO UPDATE … WHERE the row differs, RETURNING (xmax =
// 0): true for a row it inserted, false for one it updated, and no row at all for one it left
// alone, since the update's WHERE held nothing to change. It counts the outcome in r.
func upsert(ctx context.Context, tx pgx.Tx, r *Report, stmt string, args ...any) error {
	var inserted bool
	err := tx.QueryRow(ctx, stmt, args...).Scan(&inserted)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		r.Unchanged++
	case err != nil:
		return err
	case inserted:
		r.Inserted++
	default:
		r.Updated++
	}
	return nil
}

// held is the rows of one of a dataset's tables that its files hold: their keys, in the column key.
type held struct {
	table, key string
	keys       []string
}

// finish counts in r the rows of each table that the files no longer hold, and settles the
// dataset's version: incremented when the load wrote any of its rows, read otherwise.
func finish(ctx context.Context, tx pgx.Tx, r *Report, tables ...held) error {
	for _, h := range tables {
		var kept int
		if err := tx.QueryRow(ctx,
			"SELECT count(*) FROM "+pgx.Identifier{h.table}.Sanitize()+
				" WHERE NOT ("+pgx.Identifier{h.key}.Sanitize()+" = ANY ($1))", h.keys,
		).Scan(&kept); err != nil {
			return err
		}
		r.Kept += kept
	}
	if !r.Changed() {
		err := tx.QueryRow(ctx, "SELECT version FROM reference_datasets WHERE name = $1", r.Dataset).Scan(&r.Version)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	return tx.QueryRow(ctx, `
		INSERT INTO reference_datasets AS d (name, version, changed_at) VALUES ($1, 1, now())
		ON CONFLICT (name) DO UPDATE SET version = d.version + 1, changed_at = now()
		RETURNING version`, r.Dataset).Scan(&r.Version)
}

// loadCountries writes the country profiles.
func loadCountries(ctx context.Context, tx pgx.Tx, countries []Country) (Report, error) {
	r := Report{Dataset: Countries}
	codes := make([]string, 0, len(countries))
	for _, c := range countries {
		codes = append(codes, c.Code)
		if err := upsert(ctx, tx, &r, `
			INSERT INTO country_profiles AS t (code, name, currency, vat_standard_percent, default_units,
			  first_day_of_week, holiday_set, inspection_label, document_type_set)
			VALUES ($1, $2::jsonb, $3, $4::text::numeric, $5::unit_system, $6, $7, $8, $9)
			ON CONFLICT (code) DO UPDATE SET
			  name = EXCLUDED.name, currency = EXCLUDED.currency,
			  vat_standard_percent = EXCLUDED.vat_standard_percent, default_units = EXCLUDED.default_units,
			  first_day_of_week = EXCLUDED.first_day_of_week, holiday_set = EXCLUDED.holiday_set,
			  inspection_label = EXCLUDED.inspection_label, document_type_set = EXCLUDED.document_type_set,
			  version = t.version + 1
			WHERE (t.name, t.currency, t.vat_standard_percent, t.default_units, t.first_day_of_week,
			       t.holiday_set, t.inspection_label, t.document_type_set)
			  IS DISTINCT FROM
			      (EXCLUDED.name, EXCLUDED.currency, EXCLUDED.vat_standard_percent, EXCLUDED.default_units,
			       EXCLUDED.first_day_of_week, EXCLUDED.holiday_set, EXCLUDED.inspection_label,
			       EXCLUDED.document_type_set)
			RETURNING (xmax = 0)`,
			c.Code, c.Name.Value, c.Currency.Value, c.VATStandardPercent.Value, c.DefaultUnits.Value,
			c.FirstDayOfWeek.Value, c.HolidaySet.Value, c.InspectionLabel.Value, c.DocumentTypeSet.Value,
		); err != nil {
			return r, fmt.Errorf("%s: %w", c.Code, err)
		}
	}
	return r, finish(ctx, tx, &r, held{table: "country_profiles", key: "code", keys: codes})
}

// loadUnits writes the dimensions and their units. The keys between them are checked when the
// transaction commits, so a dimension is written before the base unit it names exists.
func loadUnits(ctx context.Context, tx pgx.Tx, dimensions []Dimension) (Report, error) {
	r := Report{Dataset: Units}
	// Empty rather than nil: nil binds as NULL, against which finish would count no row as kept.
	dimensionKeys, unitKeys := []string{}, []string{}
	for _, d := range dimensions {
		dimensionKeys = append(dimensionKeys, d.Key)
		if err := upsert(ctx, tx, &r, `
			INSERT INTO unit_dimensions AS t (key, name, base_unit) VALUES ($1, $2::jsonb, $3)
			ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, base_unit = EXCLUDED.base_unit,
			  version = t.version + 1
			WHERE (t.name, t.base_unit) IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.base_unit)
			RETURNING (xmax = 0)`,
			d.Key, d.Name.Value, d.BaseUnit.Value,
		); err != nil {
			return r, fmt.Errorf("%s: %w", d.Key, err)
		}
		for _, u := range d.Units {
			unitKeys = append(unitKeys, u.Key)
			var counterpart *string
			if u.Counterpart != nil {
				counterpart = &u.Counterpart.Value
			}
			if err := upsert(ctx, tx, &r, `
				INSERT INTO units AS t (key, dimension, system, symbol, cldr, name,
				  to_base_offset, to_base_numerator, to_base_denominator, counterpart)
				VALUES ($1, $2, $3::unit_system, $4, $5, $6::jsonb,
				  $7::text::numeric, $8::text::numeric, $9::text::numeric, $10)
				ON CONFLICT (key) DO UPDATE SET
				  dimension = EXCLUDED.dimension, system = EXCLUDED.system, symbol = EXCLUDED.symbol,
				  cldr = EXCLUDED.cldr, name = EXCLUDED.name, to_base_offset = EXCLUDED.to_base_offset,
				  to_base_numerator = EXCLUDED.to_base_numerator,
				  to_base_denominator = EXCLUDED.to_base_denominator, counterpart = EXCLUDED.counterpart,
				  version = t.version + 1
				WHERE (t.dimension, t.system, t.symbol, t.cldr, t.name, t.to_base_offset,
				       t.to_base_numerator, t.to_base_denominator, t.counterpart)
				  IS DISTINCT FROM
				      (EXCLUDED.dimension, EXCLUDED.system, EXCLUDED.symbol, EXCLUDED.cldr, EXCLUDED.name,
				       EXCLUDED.to_base_offset, EXCLUDED.to_base_numerator, EXCLUDED.to_base_denominator,
				       EXCLUDED.counterpart)
				RETURNING (xmax = 0)`,
				u.Key, d.Key, u.System.Value, u.Symbol.Value, u.CLDR.Value, u.Name.Value,
				u.ToBase.Value.Offset, u.ToBase.Value.Numerator, u.ToBase.Value.Denominator, counterpart,
			); err != nil {
				return r, fmt.Errorf("%s: %w", u.Key, err)
			}
		}
	}
	return r, finish(ctx, tx, &r,
		held{table: "unit_dimensions", key: "key", keys: dimensionKeys},
		held{table: "units", key: "key", keys: unitKeys})
}
