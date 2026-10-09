package reference_test

import (
	"bufio"
	"encoding/json"
	"errors"
	"io/fs"
	"math/big"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/reference"
	"github.com/kareltilcer/household/server/internal/platform/repo"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

func TestMain(m *testing.M) { testsupport.Main(m) }

// The data the server ships passes every check Read makes: the check CI runs on each change to
// reference-data, since the files load as the server migrates.
func TestTheShippedDataIsValid(t *testing.T) {
	data, err := reference.Read(reference.Files())
	if err != nil {
		t.Fatal(err)
	}
	var codes, dimensions []string
	for _, c := range data.Countries {
		codes = append(codes, c.Code)
	}
	for _, d := range data.Dimensions {
		dimensions = append(dimensions, d.Key)
	}
	// Plan item 7's five countries, the United Kingdom as ISO 3166-1 codes it, and PRD 03 §9's
	// five dimensions.
	if want := []string{"CZ", "DE", "GB", "PL", "SK"}; !slices.Equal(codes, want) {
		t.Errorf("countries %v, want %v", codes, want)
	}
	if want := []string{"area", "length", "mass", "temperature", "volume"}; !slices.Equal(dimensions, want) {
		t.Errorf("dimensions %v, want %v", dimensions, want)
	}
	// A source nothing cites would not stop a load, but it is a citation nobody can check.
	if len(data.Uncited) > 0 {
		t.Errorf("sources.json lists %v, which no field cites", data.Uncited)
	}
}

// Plan item 7's Done-when: CI rejects a record missing a language or a source. Each directory in
// testdata holds reference data that breaks the rules, and its want.txt is every problem Read
// must report, all of them at once: in violations/, countries/CZ.json misses a language and
// countries/DE.json a source. Plan item 27's are there too: a country with no supervisory
// authority, and one whose authority's address is not https.
func TestReadCatchesEachViolation(t *testing.T) {
	for _, dir := range []string{"violations", "sources"} {
		t.Run(dir, func(t *testing.T) {
			fsys, want := overlay(t, filepath.Join("testdata", dir))
			_, err := reference.Read(fsys)
			var invalid *reference.Invalid
			if !errors.As(err, &invalid) {
				t.Fatalf("Read: %v, want an *Invalid", err)
			}
			if !slices.Equal(invalid.Problems, want) {
				t.Fatalf("problems:\n  %s\nwant:\n  %s", strings.Join(invalid.Problems, "\n  "), strings.Join(want, "\n  "))
			}
		})
	}
}

// Read does not refuse a source nothing cites, which is harmless to a load, but lists it, for the
// test of the shipped data to refuse.
func TestReadListsTheSourcesNothingCites(t *testing.T) {
	fsys, _ := overlay(t, filepath.Join("testdata", "unused"))
	data, err := reference.Read(fsys)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"unused"}; !slices.Equal(data.Uncited, want) {
		t.Fatalf("uncited %v, want %v", data.Uncited, want)
	}
}

// overlay returns the shipped schemas beside the data in dir, and the lines of dir's want.txt, if
// it has one.
func overlay(t *testing.T, dir string) (fstest.MapFS, []string) {
	t.Helper()
	fsys := fstest.MapFS{}
	schemas, err := fs.Sub(reference.Files(), "schemas")
	if err != nil {
		t.Fatal(err)
	}
	data := os.DirFS(dir)
	copyInto(t, fsys, "schemas", schemas)
	copyInto(t, fsys, ".", data)
	delete(fsys, "want.txt")

	f, err := data.Open("want.txt")
	if errors.Is(err, fs.ErrNotExist) {
		return fsys, nil
	}
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	var want []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		if line := strings.TrimSpace(scanner.Text()); line != "" && !strings.HasPrefix(line, "#") {
			want = append(want, line)
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	return fsys, want
}

// copyInto copies every file of src into dst, under prefix.
func copyInto(t *testing.T, dst fstest.MapFS, prefix string, src fs.FS) {
	t.Helper()
	err := fs.WalkDir(src, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := fs.ReadFile(src, name)
		if err != nil {
			return err
		}
		dst[path.Join(prefix, name)] = &fstest.MapFile{Data: data}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// A text carries every language the server ships, which the schemas require by name: the list
// in defs.schema.json is i18n.Locales, so a language added there is required of the data too,
// in an editor that validates against the schemas as well as in Read.
func TestTheSchemasRequireTheShippedLanguages(t *testing.T) {
	raw, err := fs.ReadFile(reference.Files(), "schemas/defs.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	var defs struct {
		Defs map[string]struct {
			Required   []string                   `json:"required"`
			Properties map[string]json.RawMessage `json:"properties"`
		} `json:"$defs"`
	}
	if err := json.Unmarshal(raw, &defs); err != nil {
		t.Fatal(err)
	}
	localized := defs.Defs["localized"]
	var shipped []string
	for _, l := range i18n.Locales {
		shipped = append(shipped, string(l))
	}
	if !slices.Equal(localized.Required, shipped) {
		t.Errorf("localized requires %v; the server ships %v", localized.Required, shipped)
	}
	var properties []string
	for key := range localized.Properties {
		properties = append(properties, key)
	}
	if slices.Sort(properties); !slices.Equal(properties, slices.Sorted(slices.Values(shipped))) {
		t.Errorf("localized has properties %v; the server ships %v", properties, shipped)
	}
}

// A source that is a document in this repository names one that exists.
func TestTheSourcesInTheRepositoryExist(t *testing.T) {
	raw, err := fs.ReadFile(reference.Files(), "sources.json")
	if err != nil {
		t.Fatal(err)
	}
	var sources struct {
		Sources map[string]struct {
			Path string `json:"path"`
		} `json:"sources"`
	}
	if err := json.Unmarshal(raw, &sources); err != nil {
		t.Fatal(err)
	}
	for id, s := range sources.Sources {
		if s.Path == "" {
			continue
		}
		if _, err := repo.ReadFile(s.Path); err != nil {
			t.Errorf("source %s: %v", id, err)
		}
	}
}

// Each conversion holds the relations that define its unit: the imperial ones by the Weights and
// Measures Act 1985, Schedule 1, the metric ones by the SI, and °F by its two fixed points. Every
// unit shipped is in a relation, so a digit mistyped in any factor fails here.
func TestTheConversionsAreExact(t *testing.T) {
	data, err := reference.Read(reference.Files())
	if err != nil {
		t.Fatal(err)
	}
	units := map[string]reference.Unit{}
	for _, d := range data.Dimensions {
		for _, u := range d.Units {
			units[u.Key] = u
		}
	}
	rat := func(s string) *big.Rat {
		r, ok := new(big.Rat).SetString(s)
		if !ok {
			t.Fatalf("%q is not a decimal", s)
		}
		return r
	}
	// toBase converts value, in the unit key, to its dimension's base unit.
	toBase := func(key, value string) *big.Rat {
		u, ok := units[key]
		if !ok {
			t.Fatalf("no unit %s", key)
		}
		c := u.ToBase.Value
		base := new(big.Rat).Add(rat(value), rat(c.Offset))
		base.Mul(base, rat(c.Numerator))
		return base.Quo(base, rat(c.Denominator))
	}
	covered := map[string]bool{}
	for _, c := range []struct {
		name         string
		unit, amount string
		is, other    string
	}{
		{"a millimetre is a thousandth of a metre", "mm", "1000", "1", "m"},
		{"a centimetre is a hundredth of a metre", "cm", "100", "1", "m"},
		{"a kilometre is a thousand metres", "km", "1", "1000", "m"},
		{"an inch is 2.54 centimetres", "in", "1", "2.54", "cm"},
		{"a foot is 12 inches", "ft", "1", "12", "in"},
		{"a yard is 0.9144 metres", "yd", "1", "0.9144", "m"},
		{"a yard is 3 feet", "yd", "1", "3", "ft"},
		{"a mile is 1760 yards", "mi", "1", "1760", "yd"},
		{"a mile is 1.609344 kilometres", "mi", "1", "1.609344", "km"},
		{"a hectare is 10000 square metres", "ha", "1", "10000", "m2"},
		{"a square foot is a foot squared", "ft2", "1", "0.09290304", "m2"},
		{"an acre is 43560 square feet", "ac", "1", "43560", "ft2"},
		{"a gram is a thousandth of a kilogram", "g", "1000", "1", "kg"},
		{"a pound is 0.45359237 kilograms", "lb", "1", "0.45359237", "kg"},
		{"a pound is 16 ounces", "lb", "1", "16", "oz"},
		{"a stone is 14 pounds", "st", "1", "14", "lb"},
		{"water freezes at 32 °F", "fahrenheit", "32", "0", "celsius"},
		{"and boils at 212 °F", "fahrenheit", "212", "100", "celsius"},
		{"the scales cross at -40", "fahrenheit", "-40", "-40", "celsius"},
		{"a millilitre is a thousandth of a litre", "ml", "1000", "1", "l"},
		{"a cubic metre is a thousand litres", "m3", "1", "1000", "l"},
		{"a gallon is 4.54609 litres", "gal", "1", "4.54609", "l"},
		{"a gallon is 8 pints", "gal", "1", "8", "pt"},
		{"a pint is 20 fluid ounces", "pt", "1", "20", "fl_oz"},
	} {
		if got, want := toBase(c.unit, c.amount), toBase(c.other, c.is); got.Cmp(want) != 0 {
			t.Errorf("%s: %s %s is %s in the base unit, and %s %s is %s", c.name,
				c.amount, c.unit, got.FloatString(9), c.is, c.other, want.FloatString(9))
		}
		covered[c.unit], covered[c.other] = true, true
	}
	for key := range units {
		if !covered[key] {
			t.Errorf("unit %s is in no relation here; add the one that defines it", key)
		}
	}
}
