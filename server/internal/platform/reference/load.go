package reference

import (
	"context"
	"errors"
	"fmt"
	"io/fs"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/db"
)

// Report is what one load did to one dataset.
type Report struct {
	Dataset string
	// Version is the dataset's version once the load is done: incremented when the load wrote any
	// of its rows, and otherwise what it was, 0 for a dataset never loaded.
	Version int64
	// Inserted, Updated and Unchanged count the rows the files hold, by what the load did to each.
	Inserted, Updated, Unchanged int
	// Held counts the rows an administrator edited whose values the files do not have: the load
	// leaves each as its administrator left it (D-148). Released counts the edited rows the files
	// have caught up with, which are the files' again; a release changes no value, and no version.
	Held, Released int
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
const loadLock = db.ReferenceLock

// Load reads the reference data in fsys (Read) and writes it into the reference tables in one
// transaction, which commits all of it or none, returning what it did to each dataset. It runs as
// the migrate role, which owns the tables, once the migrations have run.
//
// Loading the same files again writes nothing. A row the files hold is inserted at version 1, and
// updated, its version incremented, only when a column differs; a dataset's version is incremented
// only when a load wrote any of its rows. A row the files no longer hold is kept.
//
// A row an administrator edited (edited_at) is theirs until the files hold the same values (D-148,
// ADR 0022): while they differ the load leaves it as it is, and reports it held, so that a change
// made without a deploy is not undone by the next one; once they agree, the row is the files' again,
// and a later change to the files updates it as it does any other.
//
// Each of sets, the modules' reference data, is read and checked with the platform's, before
// anything is written, and then written by its own Load in the same transaction, after the
// platform's datasets, in the order given. A set with no Load is checked and not written.
func Load(ctx context.Context, db Beginner, fsys fs.FS, sets ...Set) ([]Report, error) {
	data, err := Read(fsys, sets...)
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
		for _, set := range sets {
			if set.Load == nil {
				continue
			}
			loaded, err := loadSet(ctx, tx, set, data.Sets[set.Name])
			if err != nil {
				return err
			}
			reports = append(reports, loaded...)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("reference data: load: %w", err)
	}
	return reports, nil
}

// Upsert runs stmt, an INSERT … ON CONFLICT DO UPDATE … WHERE Theirs(…), RETURNING (xmax = 0) and
// Released(…): a row it inserted, one it updated, one an administrator had edited that it released,
// and no row at all for one it left alone, since the update's WHERE held nothing to change: a row
// as the files have it, or an edited one they differ from, which Finish tells apart. It counts the
// outcome in r. A set's Load writes its rows through it, as the platform's own datasets are.
func Upsert(ctx context.Context, tx pgx.Tx, r *Report, stmt string, args ...any) error {
	var inserted, released bool
	err := tx.QueryRow(ctx, stmt, args...).Scan(&inserted, &released)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		r.Unchanged++
	case err != nil:
		return err
	case inserted:
		r.Inserted++
	case released:
		r.Released++
	default:
		r.Updated++
	}
	return nil
}

// The three parts of an upsert that keep an administrator's edit (D-148). A statement names its
// table t, sets edited_at to NULL and its version by Bumped, updates WHERE Theirs(differs), differs
// being whether the row's values are not the files', and returns Released(table, key). A set's
// table carries edited_at as the platform's do, and its Load writes its statements of the same parts.

// Bumped is the version of a row the upsert writes: one more for a row the files changed, and the
// same for an edited row released, whose values did not change.
const Bumped = "t.version + CASE WHEN t.edited_at IS NULL THEN 1 ELSE 0 END"

// Theirs is the condition under which the upsert writes a row that exists: one nobody edited whose
// values differ from the files', which takes them, or an edited one whose values are the files',
// which is released. An edited row that differs is left alone, and so is an unedited one that does
// not.
func Theirs(differs string) string { return "(t.edited_at IS NULL) = (" + differs + ")" }

// Released is whether the row the upsert wrote had been edited, read as the statement found it: a
// subquery in RETURNING sees the row as it was before the statement, where the row itself is as the
// statement left it. An inserted row was not there, and reads as not edited.
func Released(table, key string) string {
	return "coalesce((SELECT o.edited_at IS NOT NULL FROM " + table + " o WHERE o." + key + " = t." + key + "), false)"
}

// Held is the rows of one of a dataset's tables that its files hold: their keys, in the column
// Key. Keys is nil or empty for a table the files hold no row of.
type Held struct {
	Table, Key string
	Keys       []string
}

// Finish counts in r the rows of each table that the files no longer hold, and those an
// administrator edited that the files differ from, which the load left as they are, and settles the
// dataset's version: incremented when the load wrote any of its rows, read otherwise.
func Finish(ctx context.Context, tx pgx.Tx, r *Report, tables ...Held) error {
	for _, h := range tables {
		table, key := pgx.Identifier{h.Table}.Sanitize(), pgx.Identifier{h.Key}.Sanitize()
		keys := h.Keys
		if keys == nil {
			// nil binds as NULL, against which no row would count as kept.
			keys = []string{}
		}
		var kept, edited int
		if err := tx.QueryRow(ctx, "SELECT count(*) FILTER (WHERE NOT ("+key+" = ANY ($1))),"+
			" count(*) FILTER (WHERE "+key+" = ANY ($1) AND edited_at IS NOT NULL) FROM "+table, keys,
		).Scan(&kept, &edited); err != nil {
			return err
		}
		r.Kept += kept
		// An edited row the files hold is still edited only when they differ: the upsert released the
		// rest. It was counted as left alone.
		r.Held += edited
		r.Unchanged -= edited
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
		if err := Upsert(ctx, tx, &r, `
			INSERT INTO country_profiles AS t (code, name, currency, vat_standard_percent, default_units,
			  first_day_of_week, holiday_set, inspection_label, document_type_set)
			VALUES ($1, $2::jsonb, $3, $4::text::numeric, $5::unit_system, $6, $7, $8, $9)
			ON CONFLICT (code) DO UPDATE SET
			  name = EXCLUDED.name, currency = EXCLUDED.currency,
			  vat_standard_percent = EXCLUDED.vat_standard_percent, default_units = EXCLUDED.default_units,
			  first_day_of_week = EXCLUDED.first_day_of_week, holiday_set = EXCLUDED.holiday_set,
			  inspection_label = EXCLUDED.inspection_label, document_type_set = EXCLUDED.document_type_set,
			  version = `+Bumped+`, edited_at = NULL
			WHERE `+Theirs(`(t.name, t.currency, t.vat_standard_percent, t.default_units, t.first_day_of_week,
			       t.holiday_set, t.inspection_label, t.document_type_set)
			  IS DISTINCT FROM
			      (EXCLUDED.name, EXCLUDED.currency, EXCLUDED.vat_standard_percent, EXCLUDED.default_units,
			       EXCLUDED.first_day_of_week, EXCLUDED.holiday_set, EXCLUDED.inspection_label,
			       EXCLUDED.document_type_set)`)+`
			RETURNING (xmax = 0), `+Released("country_profiles", "code"),
			c.Code, c.Name.Value, c.Currency.Value, c.VATStandardPercent.Value, c.DefaultUnits.Value,
			c.FirstDayOfWeek.Value, c.HolidaySet.Value, c.InspectionLabel.Value, c.DocumentTypeSet.Value,
		); err != nil {
			return r, fmt.Errorf("%s: %w", c.Code, err)
		}
	}
	return r, Finish(ctx, tx, &r, Held{Table: "country_profiles", Key: "code", Keys: codes})
}

// loadUnits writes the dimensions and their units. The keys between them are checked when the
// transaction commits, so a dimension is written before the base unit it names exists.
func loadUnits(ctx context.Context, tx pgx.Tx, dimensions []Dimension) (Report, error) {
	r := Report{Dataset: Units}
	var dimensionKeys, unitKeys []string
	for _, d := range dimensions {
		dimensionKeys = append(dimensionKeys, d.Key)
		if err := Upsert(ctx, tx, &r, `
			INSERT INTO unit_dimensions AS t (key, name, base_unit) VALUES ($1, $2::jsonb, $3)
			ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, base_unit = EXCLUDED.base_unit,
			  version = `+Bumped+`, edited_at = NULL
			WHERE `+Theirs("(t.name, t.base_unit) IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.base_unit)")+`
			RETURNING (xmax = 0), `+Released("unit_dimensions", "key"),
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
			if err := Upsert(ctx, tx, &r, `
				INSERT INTO units AS t (key, dimension, system, symbol, cldr, name,
				  to_base_offset, to_base_numerator, to_base_denominator, counterpart)
				VALUES ($1, $2, $3::unit_system, $4, $5, $6::jsonb,
				  $7::text::numeric, $8::text::numeric, $9::text::numeric, $10)
				ON CONFLICT (key) DO UPDATE SET
				  dimension = EXCLUDED.dimension, system = EXCLUDED.system, symbol = EXCLUDED.symbol,
				  cldr = EXCLUDED.cldr, name = EXCLUDED.name, to_base_offset = EXCLUDED.to_base_offset,
				  to_base_numerator = EXCLUDED.to_base_numerator,
				  to_base_denominator = EXCLUDED.to_base_denominator, counterpart = EXCLUDED.counterpart,
				  version = `+Bumped+`, edited_at = NULL
				WHERE `+Theirs(`(t.dimension, t.system, t.symbol, t.cldr, t.name, t.to_base_offset,
				       t.to_base_numerator, t.to_base_denominator, t.counterpart)
				  IS DISTINCT FROM
				      (EXCLUDED.dimension, EXCLUDED.system, EXCLUDED.symbol, EXCLUDED.cldr, EXCLUDED.name,
				       EXCLUDED.to_base_offset, EXCLUDED.to_base_numerator, EXCLUDED.to_base_denominator,
				       EXCLUDED.counterpart)`)+`
				RETURNING (xmax = 0), `+Released("units", "key"),
				u.Key, d.Key, u.System.Value, u.Symbol.Value, u.CLDR.Value, u.Name.Value,
				u.ToBase.Value.Offset, u.ToBase.Value.Numerator, u.ToBase.Value.Denominator, counterpart,
			); err != nil {
				return r, fmt.Errorf("%s: %w", u.Key, err)
			}
		}
	}
	return r, Finish(ctx, tx, &r,
		Held{Table: "unit_dimensions", Key: "key", Keys: dimensionKeys},
		Held{Table: "units", Key: "key", Keys: unitKeys})
}
