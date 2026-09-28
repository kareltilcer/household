package reference_test

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"testing"
	"testing/fstest"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/reference"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// rolledBack returns a transaction as the migrate role, which loads as a deploy does, rolled back
// when the test ends. Load opens its own transaction inside it as a savepoint, so each test starts
// from the data the package's database was cloned with, which testsupport loaded.
func rolledBack(t *testing.T) pgx.Tx {
	t.Helper()
	tx, err := testsupport.Open(t).Pool(t, db.RoleMigrate).Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	return tx
}

// snapshot returns every row of the reference tables, each beside the id of the transaction that
// wrote it, which changes when a row is written even with the values it had.
func snapshot(t *testing.T, tx pgx.Tx) string {
	t.Helper()
	var s string
	if err := tx.QueryRow(t.Context(), `SELECT json_build_array(
		(SELECT json_agg(json_build_array(t.xmin::text, t) ORDER BY t.name) FROM reference_datasets t),
		(SELECT json_agg(json_build_array(t.xmin::text, t) ORDER BY t.code) FROM country_profiles t),
		(SELECT json_agg(json_build_array(t.xmin::text, t) ORDER BY t.key) FROM unit_dimensions t),
		(SELECT json_agg(json_build_array(t.xmin::text, t) ORDER BY t.key) FROM units t))::text`,
	).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

// load runs Load on fsys in tx and returns its reports by dataset.
func load(t *testing.T, tx pgx.Tx, fsys fs.FS) map[string]reference.Report {
	t.Helper()
	reports, err := reference.Load(t.Context(), tx, fsys)
	if err != nil {
		t.Fatal(err)
	}
	byDataset := map[string]reference.Report{}
	for _, r := range reports {
		byDataset[r.Dataset] = r
	}
	return byDataset
}

// shipped counts the rows the shipped data holds, by dataset.
func shipped(t *testing.T) map[string]int {
	t.Helper()
	data, err := reference.Read(reference.Files())
	if err != nil {
		t.Fatal(err)
	}
	units := len(data.Dimensions)
	for _, d := range data.Dimensions {
		units += len(d.Units)
	}
	return map[string]int{reference.Countries: len(data.Countries), reference.Units: units}
}

// Plan item 7's Done-when: the loader is idempotent. Loading the files the database already holds
// writes no row, not even with the values it had, and leaves every version where it was.
func TestLoadingTheSameFilesAgainWritesNothing(t *testing.T) {
	tx := rolledBack(t)
	before := snapshot(t, tx)
	rows := shipped(t)
	for range 2 {
		for dataset, r := range load(t, tx, reference.Files()) {
			want := reference.Report{Dataset: dataset, Version: 1, Unchanged: rows[dataset]}
			if r != want {
				t.Errorf("%+v, want %+v", r, want)
			}
		}
		if after := snapshot(t, tx); after != before {
			t.Fatalf("the load wrote:\n%s\nwas:\n%s", after, before)
		}
	}
}

// Into empty tables, a load inserts every row at version 1, and each dataset at version 1; loading
// again writes nothing.
func TestLoadingIntoEmptyTables(t *testing.T) {
	tx := rolledBack(t)
	if _, err := tx.Exec(t.Context(),
		"DELETE FROM units; DELETE FROM unit_dimensions; DELETE FROM country_profiles; DELETE FROM reference_datasets"); err != nil {
		t.Fatal(err)
	}
	rows := shipped(t)
	for dataset, r := range load(t, tx, reference.Files()) {
		if want := (reference.Report{Dataset: dataset, Version: 1, Inserted: rows[dataset]}); r != want {
			t.Errorf("%+v, want %+v", r, want)
		}
	}
	var versions []int64
	if err := tx.QueryRow(t.Context(), `SELECT array_agg(DISTINCT version) FROM (
		SELECT version FROM country_profiles UNION ALL SELECT version FROM unit_dimensions
		UNION ALL SELECT version FROM units) v`).Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if len(versions) != 1 || versions[0] != 1 {
		t.Errorf("versions %v, want every row at 1", versions)
	}
	before := snapshot(t, tx)
	for _, r := range load(t, tx, reference.Files()) {
		if r.Changed() || r.Version != 1 {
			t.Errorf("loading again: %+v", r)
		}
	}
	if after := snapshot(t, tx); after != before {
		t.Fatal("loading again wrote")
	}
}

// edited returns the shipped files with the record in name changed by edit.
func edited(t *testing.T, name string, edit func(record map[string]any)) fstest.MapFS {
	t.Helper()
	fsys := fstest.MapFS{}
	copyInto(t, fsys, ".", reference.Files())
	var record map[string]any
	if err := json.Unmarshal(fsys[name].Data, &record); err != nil {
		t.Fatal(err)
	}
	edit(record)
	data, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	fsys[name] = &fstest.MapFile{Data: data}
	return fsys
}

// field returns the field key of record.
func field(t *testing.T, record map[string]any, key string) map[string]any {
	t.Helper()
	f, ok := record[key].(map[string]any)
	if !ok {
		t.Fatalf("no field %s", key)
	}
	return f
}

// countryVersions returns each country profile's version, and CZ's rate of VAT.
func countryVersions(t *testing.T, tx pgx.Tx) (map[string]int64, string) {
	t.Helper()
	rows, err := tx.Query(t.Context(), "SELECT code, version FROM country_profiles")
	if err != nil {
		t.Fatal(err)
	}
	versions := map[string]int64{}
	var (
		code    string
		version int64
	)
	if _, err := pgx.ForEachRow(rows, []any{&code, &version}, func() error {
		versions[code] = version
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var vat string
	if err := tx.QueryRow(t.Context(), "SELECT vat_standard_percent::text FROM country_profiles WHERE code = 'CZ'").Scan(&vat); err != nil {
		t.Fatal(err)
	}
	return versions, vat
}

// A change to one record updates that row alone and increments its version and its dataset's; the
// other dataset is untouched. Loading the old files again is a change like any other: the row goes
// back, and both versions move on rather than back.
func TestLoadingAChangeVersionsWhatChanged(t *testing.T) {
	tx := rolledBack(t)
	changed := edited(t, "countries/CZ.json", func(record map[string]any) {
		field(t, record, "vat_standard_percent")["value"] = "22"
	})
	rows := shipped(t)

	reports := load(t, tx, changed)
	if want := (reference.Report{Dataset: reference.Countries, Version: 2, Updated: 1, Unchanged: rows[reference.Countries] - 1}); reports[reference.Countries] != want {
		t.Errorf("countries: %+v, want %+v", reports[reference.Countries], want)
	}
	if r := reports[reference.Units]; r.Changed() || r.Version != 1 {
		t.Errorf("units: %+v, want it unchanged at version 1", r)
	}
	versions, vat := countryVersions(t, tx)
	if vat != "22" {
		t.Errorf("CZ's VAT is %s, want 22", vat)
	}
	for code, v := range versions {
		want := int64(1)
		if code == "CZ" {
			want = 2
		}
		if v != want {
			t.Errorf("%s is at version %d, want %d", code, v, want)
		}
	}

	if r := load(t, tx, reference.Files())[reference.Countries]; r.Updated != 1 || r.Version != 3 {
		t.Errorf("loading the old files again: %+v, want CZ updated and the dataset at version 3", r)
	}
	if versions, vat := countryVersions(t, tx); vat != "21" || versions["CZ"] != 3 {
		t.Errorf("CZ at version %d with VAT %s, want version 3 with 21", versions["CZ"], vat)
	}
}

// A record the files no longer hold stays, as it was, and is counted as kept: an app in the field
// may still name it (D-11). Keeping it writes nothing, so no version moves.
func TestLoadingKeepsARecordTheFilesDrop(t *testing.T) {
	tx := rolledBack(t)
	fsys := edited(t, "units/volume.json", func(record map[string]any) {
		units, ok := record["units"].([]any)
		if !ok || len(units) == 0 {
			t.Fatal("volume has no units")
		}
		var kept []any
		for _, u := range units {
			if unit, ok := u.(map[string]any); !ok || unit["key"] != "gal" {
				kept = append(kept, u)
			}
		}
		if len(kept) != len(units)-1 {
			t.Fatal("volume has no gallon")
		}
		record["units"] = kept
	})
	delete(fsys, "countries/GB.json")
	before := snapshot(t, tx)

	reports := load(t, tx, fsys)
	for dataset, r := range reports {
		if r.Kept != 1 || r.Changed() || r.Version != 1 {
			t.Errorf("%s: %+v, want one row kept and nothing written", dataset, r)
		}
	}
	if after := snapshot(t, tx); after != before {
		t.Fatal("keeping the rows wrote")
	}
}

// A load of files Read refuses writes nothing, and says why.
func TestLoadingInvalidFilesWritesNothing(t *testing.T) {
	tx := rolledBack(t)
	fsys := edited(t, "countries/CZ.json", func(record map[string]any) {
		name, ok := field(t, record, "name")["value"].(map[string]any)
		if !ok {
			t.Fatal("CZ's name is not an object")
		}
		delete(name, "pl")
	})
	before := snapshot(t, tx)
	_, err := reference.Load(t.Context(), tx, fsys)
	var invalid *reference.Invalid
	if !errors.As(err, &invalid) || len(invalid.Problems) != 1 || invalid.Problems[0] != "countries/CZ.json#/name/value: missing property 'pl'" {
		t.Fatalf("Load: %v", err)
	}
	if after := snapshot(t, tx); after != before {
		t.Fatal("a refused load wrote")
	}
}

// The request role reads the reference tables and writes none of them (PRD 01 §2.4: read-only to
// tenants). Each write runs in a transaction that is rolled back, so that a privilege granted by
// mistake cannot change the data other tests read.
func TestTheRequestRoleReadsTheReferenceTablesAndWritesNone(t *testing.T) {
	pool := testsupport.Open(t).Pool(t, db.RoleApp)
	for _, table := range []string{"reference_datasets", "country_profiles", "unit_dimensions", "units"} {
		var n int
		if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM "+table).Scan(&n); err != nil || n == 0 {
			t.Errorf("%s: read %d rows: %v", table, n, err)
		}
		for _, stmt := range []string{
			"INSERT INTO " + table + " DEFAULT VALUES",
			"UPDATE " + table + " SET version = version",
			"DELETE FROM " + table,
		} {
			err := pgx.BeginFunc(t.Context(), pool, func(tx pgx.Tx) error {
				_, err := tx.Exec(t.Context(), stmt)
				if err == nil {
					return errors.New("allowed")
				}
				return err
			})
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
				t.Errorf("%s: %v, want insufficient_privilege", stmt, err)
			}
		}
	}
}
