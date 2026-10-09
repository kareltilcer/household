package reference

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"net/url"
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
//   - a country's currency is ISO 4217's, and its supervisory authority's address an https one
//     with a host;
//   - a unit's key and CLDR identifier are unique across every dimension, its dimension's base
//     unit is one of the dimension's and converts to itself, and its counterpart is a unit of the
//     same dimension in the other system.
//
// It reads each of sets, the modules' reference data, in the same pass: a set's files against the
// schemas it names and no other set's, its fields against the sources its own directory lists, and
// whatever else its Read checks (Set). A set reads within its own directory, and a file there that
// its Read did not read is a problem: a record in a directory nothing lists is one nothing checks.
// Its error is an *Invalid listing every problem, the platform's and each set's, not only the
// first.
func Read(fsys fs.FS, sets ...Set) (*Data, error) {
	if err := checkSets(sets); err != nil {
		return nil, err
	}
	own := []string{sourcesSchema, countrySchema, dimensionSchema}
	names := slices.Clone(own)
	for _, set := range sets {
		names = append(names, set.Schemas...)
	}
	schemas, err := compileSchemas(fsys, names)
	if err != nil {
		return nil, err
	}
	r := &Reader{fsys: fsys, schemas: only(schemas, own...)}

	sources, sourcesRead := r.sources(sourcesFile)

	data := &Data{}
	for _, name := range r.Files(countriesDir) {
		var c Country
		if r.Decode(name, countrySchema, &c) {
			r.checkCountry(name, c)
			data.Countries = append(data.Countries, c)
		}
	}
	var dimensionFiles []string
	for _, name := range r.Files(unitsDir) {
		var d Dimension
		if r.Decode(name, dimensionSchema, &d) {
			data.Dimensions = append(data.Dimensions, d)
			dimensionFiles = append(dimensionFiles, name)
		}
	}
	r.checkDimensions(dimensionFiles, data.Dimensions)
	if sourcesRead {
		data.Uncited = r.checkSources(sourcesFile, sources)
	}
	problems := r.problems

	for _, set := range sets {
		// A reader of its own: a set's fields cite the sources its own directory lists, and it reads
		// that directory alone, against the schema of a source list and the schemas it names.
		sr := &Reader{fsys: fsys, schemas: only(schemas, append([]string{sourcesSchema}, set.Schemas...)...), dir: set.Name}
		listed := path.Join(set.Name, sourcesFile)
		sources, sourcesRead := sr.sources(listed)
		read := set.Read(sr)
		sr.unread()
		if sourcesRead {
			for _, id := range sr.checkSources(listed, sources) {
				data.Uncited = append(data.Uncited, set.Name+"/"+id)
			}
		}
		if data.Sets == nil {
			data.Sets = map[string]any{}
		}
		data.Sets[set.Name] = read
		problems = append(problems, sr.problems...)
	}

	if len(problems) > 0 {
		slices.Sort(problems)
		return nil, &Invalid{Problems: problems}
	}
	return data, nil
}

// compileSchemas compiles the schemas named, from the files in fsys's schemas/.
func compileSchemas(fsys fs.FS, names []string) (map[string]*jsonschema.Schema, error) {
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
	schemas := make(map[string]*jsonschema.Schema, len(names))
	for _, name := range names {
		s, err := c.Compile(schemaBase + name)
		if err != nil {
			return nil, fmt.Errorf("reference data: %s/%s: %w", schemasDir, name, err)
		}
		schemas[name] = s
	}
	return schemas, nil
}

// only returns those of schemas that names names: what one Reader holds its files to.
func only(schemas map[string]*jsonschema.Schema, names ...string) map[string]*jsonschema.Schema {
	out := make(map[string]*jsonschema.Schema, len(names))
	for _, name := range names {
		if s, ok := schemas[name]; ok {
			out[name] = s
		}
	}
	return out
}

// Reader reads reference data files for Read and collects what is wrong with them: the platform's
// own files, and then, one Reader each, the files of every Set, whose Read is handed it. A set's
// Reader reads the set's directory and no other, against the schemas the set names.
type Reader struct {
	fsys    fs.FS
	schemas map[string]*jsonschema.Schema
	// dir is the directory a set's Reader reads within, the set's own; empty for the platform's.
	dir string
	// asked are the files Decode was asked for and the entries Files refused: unread leaves them be.
	asked    map[string]bool
	problems []string
	// citations are the sources the fields of the files read so far name, and where.
	citations []citation
}

// citation is a field's source, and where the field is.
type citation struct {
	file, pointer, source string
}

// Problem records a problem with the value at pointer, a JSON pointer, in file. Read refuses the
// data when any is recorded, and reports them all.
func (r *Reader) Problem(file, pointer, format string, args ...any) {
	r.problems = append(r.problems, file+"#"+pointer+": "+fmt.Sprintf(format, args...))
}

// within reports whether name is in the directory the Reader reads, recording a problem with it
// when it is not: a set's Reader reads its own set.
func (r *Reader) within(name string) bool {
	if clean := path.Clean(name); r.dir == "" || clean == r.dir || strings.HasPrefix(clean, r.dir+"/") {
		return true
	}
	r.Problem(name, "", "is outside %s, the directory of the set that reads it", r.dir)
	return false
}

// ask notes that name was asked for, or refused: it is no file that nothing read.
func (r *Reader) ask(name string) {
	if r.asked == nil {
		r.asked = map[string]bool{}
	}
	r.asked[path.Clean(name)] = true
}

// unread records as a problem each file of a set's directory that its Read neither decoded nor
// had refused: a record in a directory the set does not list, say, which nothing would check or
// load.
func (r *Reader) unread() {
	_ = fs.WalkDir(r.fsys, r.dir, func(name string, d fs.DirEntry, err error) error {
		switch {
		case err != nil:
			// The directory itself is missing or unreadable, which the set's sources.json has said.
			if name != r.dir {
				r.Problem(name, "", "%v", err)
			}
			return nil
		case r.asked[name] && d.IsDir():
			return fs.SkipDir
		case r.asked[name] || d.IsDir():
			return nil
		}
		r.Problem(name, "", "is read by nothing: %s's Read does not decode it", r.dir)
		return nil
	})
}

// Files returns the dataset files in dir, in the order of their names, and records anything else
// there as a problem: a directory holds one <key>.json file per record.
func (r *Reader) Files(dir string) []string {
	if !r.within(dir) {
		return nil
	}
	entries, err := fs.ReadDir(r.fsys, dir)
	if err != nil {
		r.Problem(dir, "", "%v", err)
		return nil
	}
	var names []string
	for _, e := range entries {
		name := path.Join(dir, e.Name())
		if e.IsDir() || path.Ext(e.Name()) != ".json" {
			r.Problem(name, "", "is not a record: %s holds one <key>.json file per record", dir)
			r.ask(name)
			continue
		}
		names = append(names, name)
	}
	return names
}

// Named checks that file is named for key, the value at at in it: a record's file is <key>.json.
func (r *Reader) Named(file, at, key string) {
	if path.Base(file) != key+".json" {
		r.Problem(file, at, "is %s, so the file is %s.json", key, key)
	}
}

// Decode reads the file name, checks it against schema, one of schemas/ that Read compiled,
// decodes it into v and notes the source of each of its fields, for Read to check against the
// sources listed. It reports false, having recorded why, when the file is not one the Reader may
// read, cannot be read, is not JSON, or does not pass the schema.
func (r *Reader) Decode(name, schema string, v any) bool {
	if !r.within(name) {
		return false
	}
	r.ask(name)
	raw, err := fs.ReadFile(r.fsys, name)
	if err != nil {
		r.Problem(name, "", "%v", err)
		return false
	}
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		r.Problem(name, "", "is not JSON: %v", err)
		return false
	}
	compiled, ok := r.schemas[schema]
	if !ok {
		r.Problem(name, "", "is held to %s, which its set does not name among its schemas", schema)
		return false
	}
	if err := compiled.Validate(doc); err != nil {
		var invalid *jsonschema.ValidationError
		if !errors.As(err, &invalid) {
			r.Problem(name, "", "%v", err)
			return false
		}
		for _, leaf := range leaves(invalid) {
			r.Problem(name, pointer(leaf.InstanceLocation), "%s", leaf.ErrorKind.LocalizedString(printer))
		}
		return false
	}
	if err := json.Unmarshal(raw, v); err != nil {
		// The schema admits a value the Go type cannot hold: the two disagree.
		r.Problem(name, "", "passes %s but does not decode: %v", schema, err)
		return false
	}
	r.cite(name, "", doc)
	return true
}

// sources reads the sources the file name lists, reporting false when it cannot be read.
func (r *Reader) sources(name string) (map[string]json.RawMessage, bool) {
	var sources struct {
		Sources map[string]json.RawMessage `json:"sources"`
	}
	ok := r.Decode(name, sourcesSchema, &sources)
	return sources.Sources, ok
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
func (r *Reader) cite(name, at string, v any) {
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

// checkSources checks every citation against the sources listed in file, and returns the sources
// listed that no field cites, sorted.
func (r *Reader) checkSources(file string, listed map[string]json.RawMessage) []string {
	cited := make(map[string]bool, len(listed))
	for _, c := range r.citations {
		cited[c.source] = true
		if _, ok := listed[c.source]; !ok {
			r.Problem(c.file, c.pointer+"/source", "names %s, which %s does not list", c.source, file)
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

// Localized checks that text, the value at at in file, has a text in every shipped language and
// in no other.
func (r *Reader) Localized(file, at string, text Localized) {
	for _, l := range i18n.Locales {
		if strings.TrimSpace(text[string(l)]) == "" {
			r.Problem(file, at, "has no text in %s, a language the server ships", l)
		}
	}
	for l := range text {
		if !slices.Contains(i18n.Locales, i18n.Locale(l)) {
			r.Problem(file, at+"/"+escaper.Replace(l), "is in a language the server does not ship")
		}
	}
}

// checkCountry checks what the country schema cannot about c, read from file.
func (r *Reader) checkCountry(file string, c Country) {
	r.Named(file, "/code", c.Code)
	r.Localized(file, "/name/value", c.Name.Value)
	if _, err := money.Exponent(c.Currency.Value); err != nil {
		r.Problem(file, "/currency/value", "%s is not an ISO 4217 currency", c.Currency.Value)
	}
	r.Localized(file, "/supervisory_authority/name/value", c.SupervisoryAuthority.Name.Value)
	if address := c.SupervisoryAuthority.URL.Value; !httpsAddress(address) {
		r.Problem(file, "/supervisory_authority/url/value", "%s is not the https address of a page", address)
	}
}

// httpsAddress reports whether address is one a client may link to as it stands: an https URL with
// a host, carrying no credentials. The schema holds it to its scheme; this, to being an address.
func httpsAddress(address string) bool {
	u, err := url.Parse(address)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil
}

// unitAt is a unit, its dimension, and where it is.
type unitAt struct {
	unit      Unit
	dimension string
	file, at  string
}

// checkDimensions checks what the dimension schema cannot about dims, read from files: each one
// on its own, and the units of all of them together.
func (r *Reader) checkDimensions(files []string, dims []Dimension) {
	units := map[string]unitAt{}
	cldr := map[string]string{}
	for i, d := range dims {
		file := files[i]
		r.Named(file, "/key", d.Key)
		r.Localized(file, "/name/value", d.Name.Value)
		base := false
		for j, u := range d.Units {
			at := "/units/" + strconv.Itoa(j)
			r.Localized(file, at+"/name/value", u.Name.Value)
			if other, dup := units[u.Key]; dup {
				r.Problem(file, at+"/key", "%s is also the key of the unit at %s#%s", u.Key, other.file, other.at)
			} else {
				units[u.Key] = unitAt{unit: u, dimension: d.Key, file: file, at: at}
			}
			if other, dup := cldr[u.CLDR.Value]; dup {
				r.Problem(file, at+"/cldr/value", "%s is also the CLDR identifier of the unit at %s", u.CLDR.Value, other)
			} else {
				cldr[u.CLDR.Value] = file + "#" + at
			}
			if u.Key == d.BaseUnit.Value {
				base = true
				if u.ToBase.Value != identity {
					r.Problem(file, at+"/to_base/value", "is the base unit's, so it converts to itself: offset 0, numerator 1, denominator 1")
				}
			}
		}
		if !base {
			r.Problem(file, "/base_unit/value", "%s is not a unit of the dimension", d.BaseUnit.Value)
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
			r.Problem(u.file, at, "%s is not a unit", u.unit.Counterpart.Value)
		case counterpart.dimension != u.dimension:
			r.Problem(u.file, at, "%s is a unit of %s, not of %s", counterpart.unit.Key, counterpart.dimension, u.dimension)
		case counterpart.unit.System.Value == u.unit.System.Value:
			r.Problem(u.file, at, "%s is %s too; a counterpart is in the other system", counterpart.unit.Key, u.unit.System.Value)
		}
	}
}
