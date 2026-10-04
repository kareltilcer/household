package reference_test

import (
	"context"
	"errors"
	"io/fs"
	"slices"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/reference"
)

// brick is a record of the set the tests declare: toys, a module's reference data with one kind
// of record, held to a schema of its own, citing its own sources, and loaded into a table the
// test makes.
type brick struct {
	Key    string                  `json:"key"`
	Colour reference.Field[string] `json:"colour"`
}

const (
	brickSchema = "toys-brick.schema.json"
	bricksDir   = "toys/bricks"
)

// toys returns the set, with a Load when load says so.
func toys(load bool) reference.Set {
	set := reference.Set{
		Name:    "toys",
		Schemas: []string{brickSchema},
		Read: func(r *reference.Reader) any {
			var bricks []brick
			for _, name := range r.Files(bricksDir) {
				var b brick
				if !r.Decode(name, brickSchema, &b) {
					continue
				}
				r.Named(name, "/key", b.Key)
				bricks = append(bricks, b)
			}
			return bricks
		},
	}
	if load {
		set.Load = func(ctx context.Context, tx pgx.Tx, data any) ([]reference.Report, error) {
			r := reference.Report{Dataset: "toys_bricks"}
			// Nil while the files hold no brick, which Finish takes for none.
			var keys []string
			bricks, _ := data.([]brick)
			for _, b := range bricks {
				keys = append(keys, b.Key)
				if err := reference.Upsert(ctx, tx, &r, `
					INSERT INTO toy_bricks AS t (key, colour) VALUES ($1, $2)
					ON CONFLICT (key) DO UPDATE SET colour = EXCLUDED.colour, version = t.version + 1
					WHERE t.colour IS DISTINCT FROM EXCLUDED.colour
					RETURNING (xmax = 0)`, b.Key, b.Colour.Value); err != nil {
					return nil, err
				}
			}
			return []reference.Report{r}, reference.Finish(ctx, tx, &r, reference.Held{Table: "toy_bricks", Key: "key", Keys: keys})
		}
	}
	return set
}

// withToys returns the shipped files with the set's schema, its sources and its bricks, each
// brick a colour by its key.
func withToys(t *testing.T, bricks map[string]string) fstest.MapFS {
	t.Helper()
	fsys := fstest.MapFS{}
	copyInto(t, fsys, ".", reference.Files())
	fsys["schemas/"+brickSchema] = &fstest.MapFile{Data: []byte(`{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"required": ["key", "colour"],
		"properties": {
			"key": { "$ref": "defs.schema.json#/$defs/key" },
			"colour": { "$ref": "defs.schema.json#/$defs/textField" }
		},
		"additionalProperties": false
	}`)}
	fsys["toys/sources.json"] = &fstest.MapFile{Data: []byte(
		`{"sources": {"catalogue": {"title": "The brick catalogue", "url": "https://example.com/bricks"}}}`)}
	for key, colour := range bricks {
		fsys[bricksDir+"/"+key+".json"] = &fstest.MapFile{Data: []byte(
			`{"key": "` + key + `", "colour": {"value": "` + colour + `", "source": "catalogue"}}`)}
	}
	return fsys
}

// Read reads a module's set in the same pass as the platform's data, and returns what the set
// read under its name. A source of the set that nothing cites is listed as the set's.
func TestReadReadsASetBesideThePlatformsData(t *testing.T) {
	fsys := withToys(t, map[string]string{"red": "red", "blue": "blue"})
	data, err := reference.Read(fsys, toys(false))
	if err != nil {
		t.Fatal(err)
	}
	bricks, ok := data.Sets["toys"].([]brick)
	if !ok || len(bricks) != 2 || bricks[0].Key != "blue" || bricks[1].Colour.Value != "red" {
		t.Errorf("the set read %+v", data.Sets["toys"])
	}
	if len(data.Countries) == 0 || len(data.Uncited) != 0 {
		t.Errorf("%d countries, uncited %v", len(data.Countries), data.Uncited)
	}

	fsys["toys/sources.json"] = &fstest.MapFile{Data: []byte(`{"sources": {
		"catalogue": {"title": "The brick catalogue", "url": "https://example.com/bricks"},
		"spare": {"title": "A source no brick cites", "url": "https://example.com/spare"}}}`)}
	data, err = reference.Read(fsys, toys(false))
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"toys/spare"}; !slices.Equal(data.Uncited, want) {
		t.Errorf("uncited %v, want %v", data.Uncited, want)
	}
}

// A set's files are held to its schemas and to the sources its own directory lists, a source of
// the platform's list among those it may not cite, and its problems are reported with the
// platform's, all at once.
func TestReadReportsASetsProblemsWithThePlatforms(t *testing.T) {
	fsys := withToys(t, map[string]string{"red": "red"})
	fsys[bricksDir+"/green.json"] = &fstest.MapFile{Data: []byte(
		`{"key": "green", "colour": {"value": "green", "source": "iso-4217"}}`)}
	fsys[bricksDir+"/blue.json"] = &fstest.MapFile{Data: []byte(`{"key": "navy", "colour": {"value": "blue"}}`)}
	fsys[bricksDir+"/black.json"] = &fstest.MapFile{Data: []byte(`{"key": "white", "colour": {"value": "white", "source": "catalogue"}}`)}
	fsys[bricksDir+"/notes.txt"] = &fstest.MapFile{Data: []byte("not a record")}
	delete(fsys, "countries/GB.json")
	fsys["countries/GB.json"] = &fstest.MapFile{Data: []byte(`{}`)}

	_, err := reference.Read(fsys, toys(false))
	var invalid *reference.Invalid
	if !errors.As(err, &invalid) {
		t.Fatalf("Read: %v, want an *Invalid", err)
	}
	var theSets []string
	platform := 0
	for _, p := range invalid.Problems {
		if strings.HasPrefix(p, "toys/") {
			theSets = append(theSets, p)
		} else {
			platform++
		}
	}
	want := []string{
		"toys/bricks/black.json#/key: is white, so the file is white.json",
		"toys/bricks/blue.json#/colour: missing property 'source'",
		"toys/bricks/green.json#/colour/source: names iso-4217, which toys/sources.json does not list",
		"toys/bricks/notes.txt#: is not a record: toys/bricks holds one <key>.json file per record",
	}
	if !slices.Equal(theSets, want) {
		t.Errorf("the set's problems:\n  %s\nwant:\n  %s", strings.Join(theSets, "\n  "), strings.Join(want, "\n  "))
	}
	if platform == 0 {
		t.Error("the platform's own problems were not reported beside the set's")
	}
	if !slices.IsSorted(invalid.Problems) {
		t.Errorf("the problems are not sorted: %v", invalid.Problems)
	}
}

// A set reads its files against the schemas it names, and no other.
func TestASetIsHeldToTheSchemasItNames(t *testing.T) {
	set := toys(false)
	set.Schemas = nil
	_, err := reference.Read(withToys(t, map[string]string{"red": "red"}), set)
	var invalid *reference.Invalid
	want := "toys/bricks/red.json#: is held to toys-brick.schema.json, which its set does not name among its schemas"
	if !errors.As(err, &invalid) || !slices.Equal(invalid.Problems, []string{want}) {
		t.Fatalf("Read: %v, want %s", err, want)
	}

	set.Schemas = []string{"missing.schema.json"}
	if _, err := reference.Read(withToys(t, nil), set); err == nil || errors.As(err, &invalid) {
		t.Fatalf("Read with a schema schemas/ does not hold: %v, want it refused outright", err)
	}

	// Another set's naming the schema, or the platform's, does not lend it.
	set.Schemas = nil
	fsys := withToys(t, map[string]string{"red": "red"})
	fsys["games/sources.json"] = &fstest.MapFile{Data: []byte(`{"sources": {}}`)}
	games := reference.Set{Name: "games", Schemas: []string{brickSchema}, Read: func(r *reference.Reader) any {
		var c reference.Country
		r.Decode("games/sources.json", "country.schema.json", &c)
		return nil
	}}
	_, err = reference.Read(fsys, set, games)
	wants := []string{
		"games/sources.json#: is held to country.schema.json, which its set does not name among its schemas",
		want,
	}
	if !errors.As(err, &invalid) || !slices.Equal(invalid.Problems, wants) {
		t.Fatalf("Read beside a set that names the schema: %v, want %v", err, wants)
	}
}

// A set reads its own directory: a file outside it is not its to read, and a file inside it that
// its Read does not decode is a record nothing checks.
func TestASetReadsItsOwnDirectoryAndAllOfIt(t *testing.T) {
	set := toys(false)
	bricks := set.Read
	set.Read = func(r *reference.Reader) any {
		var c reference.Country
		r.Decode("countries/CZ.json", brickSchema, &c)
		r.Files("units")
		r.Files("toys/../countries")
		return bricks(r)
	}
	fsys := withToys(t, map[string]string{"red": "red"})
	fsys["toys/brick/blue.json"] = &fstest.MapFile{Data: []byte(`{"key": "blue", "colour": {"value": "blue", "source": "catalogue"}}`)}
	fsys["toys/README.md"] = &fstest.MapFile{Data: []byte("# Toys")}
	fsys[bricksDir+"/spare/green.json"] = &fstest.MapFile{Data: []byte(`{}`)}

	_, err := reference.Read(fsys, set)
	var invalid *reference.Invalid
	want := []string{
		"countries/CZ.json#: is outside toys, the directory of the set that reads it",
		"toys/../countries#: is outside toys, the directory of the set that reads it",
		"toys/README.md#: is read by nothing: toys's Read does not decode it",
		"toys/brick/blue.json#: is read by nothing: toys's Read does not decode it",
		// A directory among the records is refused once, and what it holds with it.
		"toys/bricks/spare#: is not a record: toys/bricks holds one <key>.json file per record",
		"units#: is outside toys, the directory of the set that reads it",
	}
	if !errors.As(err, &invalid) || !slices.Equal(invalid.Problems, want) {
		t.Fatalf("Read: %v, want:\n  %s", err, strings.Join(want, "\n  "))
	}
}

// Read refuses sets it could not tell apart, or read at all.
func TestReadRefusesSetsItCannotTellApart(t *testing.T) {
	read := func(*reference.Reader) any { return nil }
	for name, sets := range map[string][]reference.Set{
		"a name no directory carries":    {{Name: "Toy Box", Read: read}},
		"no name":                        {{Read: read}},
		"two of one name":                {{Name: "toys", Read: read}, {Name: "toys", Read: read}},
		"a directory of the platform's":  {{Name: "units", Read: read}},
		"the directory of the schemas":   {{Name: "schemas", Read: read}},
		"no Read":                        {{Name: "toys"}},
		"one sound, one without a Read":  {{Name: "toys", Read: read}, {Name: "games"}},
		"a name with a path of its own":  {{Name: "toys/bricks", Read: read}},
		"a name that climbs out":         {{Name: "..", Read: read}},
		"a name with a trailing joiner_": {{Name: "toys_", Read: read}},
	} {
		if _, err := reference.Read(reference.Files(), sets...); err == nil {
			t.Errorf("%s: Read took %+v", name, sets)
		}
	}
}

// toyTable makes the set's table in tx, as its module's migration would.
func toyTable(t *testing.T, tx pgx.Tx) {
	t.Helper()
	if _, err := tx.Exec(t.Context(), `CREATE TABLE toy_bricks (
		key text PRIMARY KEY, version bigint NOT NULL DEFAULT 1, colour text NOT NULL)`); err != nil {
		t.Fatal(err)
	}
}

// Load writes a set through its own Load, in the load's transaction and after the platform's
// datasets, and versions its rows and its dataset as it does the platform's: a repeated load
// writes nothing, a change moves the row's version and the dataset's, and a record the files drop
// is kept.
func TestLoadWritesASetWithThePlatformsData(t *testing.T) {
	tx := rolledBack(t)
	toyTable(t, tx)
	loadToys := func(bricks map[string]string) reference.Report {
		t.Helper()
		reports, err := reference.Load(t.Context(), tx, withToys(t, bricks), toys(true))
		if err != nil {
			t.Fatal(err)
		}
		if len(reports) != 3 || reports[0].Dataset != reference.Countries || reports[1].Dataset != reference.Units {
			t.Fatalf("reports %+v, want the platform's two datasets and then the set's", reports)
		}
		return reports[2]
	}

	both := map[string]string{"red": "red", "blue": "blue"}
	if r, want := loadToys(both), (reference.Report{Dataset: "toys_bricks", Version: 1, Inserted: 2}); r != want {
		t.Errorf("the first load: %+v, want %+v", r, want)
	}
	if r, want := loadToys(both), (reference.Report{Dataset: "toys_bricks", Version: 1, Unchanged: 2}); r != want {
		t.Errorf("the same files again: %+v, want %+v", r, want)
	}
	if r, want := loadToys(map[string]string{"red": "crimson"}), (reference.Report{Dataset: "toys_bricks", Version: 2, Updated: 1, Kept: 1}); r != want {
		t.Errorf("a change and a dropped record: %+v, want %+v", r, want)
	}
	var rows string
	if err := tx.QueryRow(t.Context(),
		"SELECT string_agg(key || ' ' || colour || ' ' || version, ', ' ORDER BY key) FROM toy_bricks").Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if want := "blue blue 1, red crimson 2"; rows != want {
		t.Errorf("the set's rows are %q, want %q", rows, want)
	}
	var version int64
	if err := tx.QueryRow(t.Context(), "SELECT version FROM reference_datasets WHERE name = 'toys_bricks'").Scan(&version); err != nil || version != 2 {
		t.Errorf("the set's dataset is at version %d: %v", version, err)
	}

	// Files that hold no record of a table keep every row of it, and say so: the set's Load hands
	// Finish no keys at all.
	none := withToys(t, nil)
	none[bricksDir] = &fstest.MapFile{Mode: fs.ModeDir}
	reports, err := reference.Load(t.Context(), tx, none, toys(true))
	if err != nil {
		t.Fatal(err)
	}
	if r, want := reports[len(reports)-1], (reference.Report{Dataset: "toys_bricks", Version: 2, Kept: 2}); r != want {
		t.Errorf("files with no brick: %+v, want %+v", r, want)
	}
}

// A set with no Load has no tables yet: its files are checked with everything else, before
// anything is written, and nothing of it is.
func TestLoadChecksASetWithNoLoadAndWritesNothingOfIt(t *testing.T) {
	tx := rolledBack(t)
	reports, err := reference.Load(t.Context(), tx, withToys(t, map[string]string{"red": "red"}), toys(false))
	if err != nil || len(reports) != 2 {
		t.Fatalf("Load: %+v, %v, want the platform's two datasets alone", reports, err)
	}

	before := snapshot(t, tx)
	fsys := withToys(t, map[string]string{"red": "red"})
	fsys[bricksDir+"/red.json"] = &fstest.MapFile{Data: []byte(`{"key": "red"}`)}
	fsys["countries/CZ.json"] = &fstest.MapFile{Data: []byte(strings.Replace(string(fsys["countries/CZ.json"].Data), `"21"`, `"22"`, 1))}
	_, err = reference.Load(t.Context(), tx, fsys, toys(false))
	var invalid *reference.Invalid
	if !errors.As(err, &invalid) || !slices.Equal(invalid.Problems, []string{"toys/bricks/red.json#: missing property 'colour'"}) {
		t.Fatalf("Load: %v, want the set's file refused", err)
	}
	if after := snapshot(t, tx); after != before {
		t.Fatal("a load whose set is refused wrote the platform's data")
	}
}

// A set's datasets are named for it, so that no set's version is another's, or the platform's.
func TestLoadRefusesASetsDatasetNotNamedForIt(t *testing.T) {
	tx := rolledBack(t)
	before := snapshot(t, tx)
	set := toys(false)
	set.Load = func(context.Context, pgx.Tx, any) ([]reference.Report, error) {
		return []reference.Report{{Dataset: reference.Countries}}, nil
	}
	fsys := withToys(t, map[string]string{"red": "red"})
	fsys["countries/CZ.json"] = &fstest.MapFile{Data: []byte(strings.Replace(string(fsys["countries/CZ.json"].Data), `"21"`, `"22"`, 1))}
	_, err := reference.Load(t.Context(), tx, fsys, set)
	if err == nil || !strings.Contains(err.Error(), `toys: its dataset "countries" is not named toys_<dataset>`) {
		t.Fatalf("Load: %v", err)
	}
	if after := snapshot(t, tx); after != before {
		t.Fatal("a load that failed in a set's Load kept what the platform's wrote")
	}
}
