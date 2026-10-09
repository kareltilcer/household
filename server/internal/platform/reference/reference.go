// Package reference holds the global reference data (PRD 01 §2.4): the country profiles, the
// units, and later each module's own sets. Its source is the reference-data directory, embedded
// through that directory's Go module, where every field names where it comes from and every text
// people read carries each shipped language (PL-10, PRD 03 §9).
//
// Read checks those files, against their JSON Schemas and against each other. Load writes them
// into the reference tables when the server migrates, which is the path by which a change to the
// data ships without a change to the code (D-61, D-70). Routes serves them to any authenticated
// user, read-only.
//
// A module's own set is a Set: a directory of reference-data named for the module, which Read
// and Load take beside the platform's data, from the registry (module.ReferenceSource).
package reference

import (
	"io/fs"

	referencedata "github.com/kareltilcer/household/reference-data"
)

// Files returns the reference data the server ships: the reference-data directory, embedded.
func Files() fs.FS { return referencedata.FS }

// The datasets, each the name the loader records its version under (reference_datasets).
const (
	// Countries is the country profiles, countries/<code>.json.
	Countries = "countries"
	// Units is the dimensions and their units, units/<dimension>.json.
	Units = "units"
)

// Field is a value of a record and the source it comes from. Drafted marks a value drafted
// without an expert, for review (PL-10); Note is what the reviewer should know besides.
type Field[T any] struct {
	Value   T      `json:"value"`
	Source  string `json:"source"`
	Drafted bool   `json:"drafted"`
	Note    string `json:"note"`
}

// Localized is one text per shipped language, keyed by the language's code (i18n.Locales).
type Localized map[string]string

// Country is a country profile: what a household in the country is offered (PRD 03 §9).
type Country struct {
	// Code is ISO 3166-1 alpha-2, and the name of the country's file.
	Code string           `json:"code"`
	Name Field[Localized] `json:"name"`
	// Currency is the country's, ISO 4217: a new household's base currency.
	Currency Field[string] `json:"currency"`
	// VATStandardPercent is the standard rate of VAT, a decimal percent.
	VATStandardPercent Field[string] `json:"vat_standard_percent"`
	// DefaultUnits is the system of units a new household starts with: metric or imperial.
	DefaultUnits Field[string] `json:"default_units"`
	// FirstDayOfWeek is 0 for Sunday to 6 for Saturday, as time.Weekday counts.
	FirstDayOfWeek Field[int] `json:"first_day_of_week"`
	// HolidaySet names the country's public holidays, which Calendar defines (plan item 75).
	HolidaySet Field[string] `json:"holiday_set"`
	// InspectionLabel is the country's own word for the statutory vehicle inspection.
	InspectionLabel Field[string] `json:"inspection_label"`
	// DocumentTypeSet names the country's document types, which Documents defines (plan item 46).
	DocumentTypeSet Field[string] `json:"document_type_set"`
	// SupervisoryAuthority is whom a person in the country complains to about their personal data.
	SupervisoryAuthority Authority `json:"supervisory_authority"`
}

// Authority is a country's supervisory authority for personal data (GDPR Art. 77, PRD 05 §3): two
// fields of the country's record, each with its own source.
type Authority struct {
	// Name is the authority's name: its official one, in its own language, wherever a language has
	// no established name for it.
	Name Field[Localized] `json:"name"`
	// URL is the address of the authority's own page where a complaint is lodged, or which says
	// how: https.
	URL Field[string] `json:"url"`
}

// Dimension is a kind of quantity and its units, in the name of the dimension's file.
type Dimension struct {
	Key  string           `json:"key"`
	Name Field[Localized] `json:"name"`
	// BaseUnit is the key of the unit every unit of the dimension converts to.
	BaseUnit Field[string] `json:"base_unit"`
	Units    []Unit        `json:"units"`
}

// Unit is a unit of measurement.
type Unit struct {
	// Key is the unit's key, unique across every dimension.
	Key string `json:"key"`
	// System is metric or imperial.
	System Field[string] `json:"system"`
	// Symbol is the same in every language.
	Symbol Field[string] `json:"symbol"`
	// CLDR is the unit's Unicode CLDR identifier, which ICU formats a quantity in.
	CLDR   Field[string]     `json:"cldr"`
	Name   Field[Localized]  `json:"name"`
	ToBase Field[Conversion] `json:"to_base"`
	// Counterpart is the key of the unit of the other system a quantity in this one is shown
	// in, when the household uses that system; nil where it is shown as it is in both.
	Counterpart *Field[string] `json:"counterpart"`
}

// Conversion converts a quantity to its dimension's base unit, exactly: base = (value + Offset)
// × Numerator ÷ Denominator. Each is a decimal as a string.
type Conversion struct {
	Offset      string `json:"offset"`
	Numerator   string `json:"numerator"`
	Denominator string `json:"denominator"`
}

// identity is the conversion of a dimension's base unit.
var identity = Conversion{Offset: "0", Numerator: "1", Denominator: "1"}

// Data is the reference data, read and checked: the countries in the order of their codes, and
// the dimensions in the order of their keys, each with its units as its file lists them.
type Data struct {
	Countries  []Country
	Dimensions []Dimension
	// Sets is what each module's set read of its own files, by the set's name (Set).
	Sets map[string]any
	// Uncited are the sources sources.json lists that no field cites, sorted: harmless to a load,
	// which is why Read does not refuse them, and refused by the test of the data the server ships.
	// A set's follow the platform's, each as <set>/<source>.
	Uncited []string
}
