package reference

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"path"
	"slices"
	"strconv"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"golang.org/x/text/language"
	"golang.org/x/text/message"

	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/money"
)

// The files Read reads, laid out as the reference-data directory lays them out.
const (
	sourcesFile  = "sources.json"
	schemasDir   = "schemas"
	countriesDir = "countries"
	unitsDir     = "units"
)

// The schema each kind of file is held to, in schemas/.
const (
	sourcesSchema   = "sources.schema.json"
	countrySchema   = "country.schema.json"
	dimensionSchema = "dimension.schema.json"
)

// schemaBase is the URL the schemas are compiled under, which serves only to resolve their $refs
// to one another. Every file in schemas/ is added to the compiler before any is compiled and
// nothing is fetched, so a $ref to a schema that is not there fails to compile.
const schemaBase = "https://reference.household.invalid/schemas/"

// printer renders the schema validator's messages.
var printer = message.NewPrinter(language.English)

// Invalid is Read's refusal: every problem it found, each "<file>#<JSON pointer>: <what is
// wrong>", sorted.
type Invalid struct {
	Problems []string
}

func (e *Invalid) Error() string {
	return "reference data is invalid:\n  " + strings.Join(e.Problems, "\n  ")
}

// Read reads the reference data in fsys, laid out as the reference-data directory is, and checks
// all of it before returning any: each file against its schema, which refuses a field without a
// source and a text without one of the languages (PL-10), and then what a schema cannot see:
//
//   - a field names a source sources.json lists;
//   - a text carries every language the server ships (i18n.Locales), which the schema could lag;
//   - a file is named for its record's key, and holds nothing but JSON records;
//   - a country's currency is ISO 4217's;
//   - a unit's key and CLDR identifier are unique across every dimension, its dimension's base
//     unit is one of the dimension's and converts to itself, and its counterpart is a unit of the
//     same dimension in the other system.
//
// Its error is an *Invalid listing every problem, not only the first.
func Read(fsys fs.FS) (*Data, error) {
	schemas, err := compileSchemas(fsys)
	if err != nil {
		return nil, err
	}
	r := &reader{fsys: fsys, schemas: schemas}

	var sources struct {
		Sources map[string]json.RawMessage `json:"sources"`
	}
	_, sourcesRead := r.decode(sourcesFile, sourcesSchema, &sources)

	data := &Data{}
	for _, name := range r.files(countriesDir) {
		var c Country
		if doc, ok := r.decode(name, countrySchema, &c); ok {
			r.cite(name, "", doc)
			r.checkCountry(name, c)
			data.Countries = append(data.Countries, c)
		}
	}
	var dimensionFiles []string
	for _, name := range r.files(unitsDir) {
		var d Dimension
		if doc, ok := r.decode(name, dimensionSchema, &d); ok {
			r.cite(name, "", doc)
			data.Dimensions = append(data.Dimensions, d)
			dimensionFiles = append(dimensionFiles, name)
		}
	}
	r.checkDimensions(dimensionFiles, data.Dimensions)
	if sourcesRead {
		data.Uncited = r.checkSources(sources.Sources)
	}

	if len(r.problems) > 0 {
		slices.Sort(r.problems)
		return nil, &Invalid{Problems: r.problems}
	}
	return data, nil
}

// compileSchemas compiles the schema of each kind of file, from the files in fsys's schemas/.
func compileSchemas(fsys fs.FS) (map[string]*jsonschema.Schema, error) {
	entries, err := fs.ReadDir(fsys, schemasDir)
	if err != nil {
		return nil, fmt.Errorf("reference data: %w", err)
	}
	c := jsonschema.NewCompiler()
	c.DefaultDraft(jsonschema.Draft2020)
	for _, e := range entries {
		raw, err := fs.ReadFile(fsys, path.Join(schemasDir, e.Name()))
		if err != nil {
			return nil, fmt.Errorf("reference data: %w", err)
		}
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
		if err != nil {
			return nil, fmt.Errorf("reference data: %s/%s: %w", schemasDir, e.Name(), err)
		}
		if err := c.AddResource(schemaBase+e.Name(), doc); err != nil {
			return nil, fmt.Errorf("reference data: %s/%s: %w", schemasDir, e.Name(), err)
		}
	}
	schemas := make(map[string]*jsonschema.Schema, 3)
	for _, name := range []string{sourcesSchema, countrySchema, dimensionSchema} {
		s, err := c.Compile(schemaBase + name)
		if err != nil {
			return nil, fmt.Errorf("reference data: %s/%s: %w", schemasDir, name, err)
		}
		schemas[name] = s
	}
	return schemas, nil
}

// reader collects the problems of one Read.
type reader struct {
	fsys     fs.FS
	schemas  map[string]*jsonschema.Schema
	problems []string
	// citations are the sources the fields of the files read so far name, and where.
	citations []citation
}

// citation is a field's source, and where the field is.
type citation struct {
	file, pointer, source string
}

// add records a problem with the value at pointer, a JSON pointer, in file.
func (r *reader) add(file, pointer, format string, args ...any) {
	r.problems = append(r.problems, file+"#"+pointer+": "+fmt.Sprintf(format, args...))
}

// files returns the dataset files in dir, and records anything else there as a problem.
func (r *reader) files(dir string) []string {
	entries, err := fs.ReadDir(r.fsys, dir)
	if err != nil {
		r.add(dir, "", "%v", err)
		return nil
	}
	var names []string
	for _, e := range entries {
		name := path.Join(dir, e.Name())
		if e.IsDir() || path.Ext(e.Name()) != ".json" {
			r.add(name, "", "is not a record: %s holds one <key>.json file per record", dir)
			continue
		}
		names = append(names, name)
	}
	return names
}

// decode reads the file name, checks it against schema and decodes it into v, returning the file
// as the validator read it. It reports false, having recorded why, when the file cannot be read,
// is not JSON, or does not pass the schema.
func (r *reader) decode(name, schema string, v any) (any, bool) {
	raw, err := fs.ReadFile(r.fsys, name)
	if err != nil {
		r.add(name, "", "%v", err)
		return nil, false
	}
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		r.add(name, "", "is not JSON: %v", err)
		return nil, false
	}
	if err := r.schemas[schema].Validate(doc); err != nil {
		var invalid *jsonschema.ValidationError
		if !errors.As(err, &invalid) {
			r.add(name, "", "%v", err)
			return nil, false
		}
		for _, leaf := range leaves(invalid) {
			r.add(name, pointer(leaf.InstanceLocation), "%s", leaf.ErrorKind.LocalizedString(printer))
		}
		return nil, false
	}
	if err := json.Unmarshal(raw, v); err != nil {
		// The schema admits a value the Go type cannot hold: the two disagree.
		r.add(name, "", "passes %s but does not decode: %v", schema, err)
		return nil, false
	}
	return doc, true
}

// leaves returns the validation errors at the ends of err's causes: the checks that failed, each
// with where.
func leaves(err *jsonschema.ValidationError) []*jsonschema.ValidationError {
	if len(err.Causes) == 0 {
		return []*jsonschema.ValidationError{err}
	}
	var out []*jsonschema.ValidationError
	for _, cause := range err.Causes {
		out = append(out, leaves(cause)...)
	}
	return out
}

// escaper escapes a JSON pointer's reference token (RFC 6901).
var escaper = strings.NewReplacer("~", "~0", "/", "~1")

// pointer returns the JSON pointer of tokens.
func pointer(tokens []string) string {
	var b strings.Builder
	for _, t := range tokens {
		b.WriteByte('/')
		b.WriteString(escaper.Replace(t))
	}
	return b.String()
}

// cite records the source of every field in v, the value at pointer at in the file name. A field
// is an object holding a value and a source, which only a field does in a file its schema passed.
func (r *reader) cite(name, at string, v any) {
	switch v := v.(type) {
	case map[string]any:
		if source, ok := v["source"].(string); ok {
			if _, field := v["value"]; field {
				r.citations = append(r.citations, citation{file: name, pointer: at, source: source})
			}
		}
		for key, child := range v {
			r.cite(name, at+"/"+escaper.Replace(key), child)
		}
	case []any:
		for i, child := range v {
			r.cite(name, at+"/"+strconv.Itoa(i), child)
		}
	}
}

// checkSources checks every citation against the sources listed, and returns the sources listed
// that no field cites, sorted.
func (r *reader) checkSources(listed map[string]json.RawMessage) []string {
	cited := make(map[string]bool, len(listed))
	for _, c := range r.citations {
		cited[c.source] = true
		if _, ok := listed[c.source]; !ok {
			r.add(c.file, c.pointer+"/source", "names %s, which %s does not list", c.source, sourcesFile)
		}
	}
	var uncited []string
	for id := range listed {
		if !cited[id] {
			uncited = append(uncited, id)
		}
	}
	slices.Sort(uncited)
	return uncited
}

// checkLocalized checks that text, the value at at in file, has a text in every shipped language
// and in no other.
func (r *reader) checkLocalized(file, at string, text Localized) {
	for _, l := range i18n.Locales {
		if strings.TrimSpace(text[string(l)]) == "" {
			r.add(file, at, "has no text in %s, a language the server ships", l)
		}
	}
	for l := range text {
		if !slices.Contains(i18n.Locales, i18n.Locale(l)) {
			r.add(file, at+"/"+escaper.Replace(l), "is in a language the server does not ship")
		}
	}
}

// checkCountry checks what the country schema cannot about c, read from file.
func (r *reader) checkCountry(file string, c Country) {
	if path.Base(file) != c.Code+".json" {
		r.add(file, "/code", "is %s, so the file is %s.json", c.Code, c.Code)
	}
	r.checkLocalized(file, "/name/value", c.Name.Value)
	if _, err := money.Exponent(c.Currency.Value); err != nil {
		r.add(file, "/currency/value", "%s is not an ISO 4217 currency", c.Currency.Value)
	}
}

// unitAt is a unit, its dimension, and where it is.
type unitAt struct {
	unit      Unit
	dimension string
	file, at  string
}

// checkDimensions checks what the dimension schema cannot about dims, read from files: each one
// on its own, and the units of all of them together.
func (r *reader) checkDimensions(files []string, dims []Dimension) {
	units := map[string]unitAt{}
	cldr := map[string]string{}
	for i, d := range dims {
		file := files[i]
		if path.Base(file) != d.Key+".json" {
			r.add(file, "/key", "is %s, so the file is %s.json", d.Key, d.Key)
		}
		r.checkLocalized(file, "/name/value", d.Name.Value)
		base := false
		for j, u := range d.Units {
			at := "/units/" + strconv.Itoa(j)
			r.checkLocalized(file, at+"/name/value", u.Name.Value)
			if other, dup := units[u.Key]; dup {
				r.add(file, at+"/key", "%s is also the key of the unit at %s#%s", u.Key, other.file, other.at)
			} else {
				units[u.Key] = unitAt{unit: u, dimension: d.Key, file: file, at: at}
			}
			if other, dup := cldr[u.CLDR.Value]; dup {
				r.add(file, at+"/cldr/value", "%s is also the CLDR identifier of the unit at %s", u.CLDR.Value, other)
			} else {
				cldr[u.CLDR.Value] = file + "#" + at
			}
			if u.Key == d.BaseUnit.Value {
				base = true
				if u.ToBase.Value != identity {
					r.add(file, at+"/to_base/value", "is the base unit's, so it converts to itself: offset 0, numerator 1, denominator 1")
				}
			}
		}
		if !base {
			r.add(file, "/base_unit/value", "%s is not a unit of the dimension", d.BaseUnit.Value)
		}
	}

	for _, key := range slices.Sorted(maps.Keys(units)) {
		u := units[key]
		if u.unit.Counterpart == nil {
			continue
		}
		at := u.at + "/counterpart/value"
		counterpart, ok := units[u.unit.Counterpart.Value]
		switch {
		case !ok:
			r.add(u.file, at, "%s is not a unit", u.unit.Counterpart.Value)
		case counterpart.dimension != u.dimension:
			r.add(u.file, at, "%s is a unit of %s, not of %s", counterpart.unit.Key, counterpart.dimension, u.dimension)
		case counterpart.unit.System.Value == u.unit.System.Value:
			r.add(u.file, at, "%s is %s too; a counterpart is in the other system", counterpart.unit.Key, u.unit.System.Value)
		}
	}
}
