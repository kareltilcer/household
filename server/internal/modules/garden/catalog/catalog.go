// Package catalog is Garden's reference data (PRD 11, D-66): the curated crop catalog, with the
// families its crops belong to, the pests and diseases that trouble them, the catalog's varieties
// and its rules of what grows beside and after what, and the climate profiles a household's place
// resolves to. Its source is reference-data/garden, which goes through the platform's pipeline
// (ADR 0008, ADR 0023): Set is what the module hands the registry, and its Read is the catalog's
// validator, the schemas and then what a schema cannot see.
//
// The package is the first of the Garden module's, which arrives with plan items 68 to 71: the
// tables the catalog loads into, the bundle a client caches and the one resolution function are
// theirs. Until the module declares the set (module.ReferenceSource), this package's own tests
// are what holds the shipped files to it.
package catalog

import (
	"github.com/kareltilcer/household/server/internal/platform/reference"
)

// Name is the set's name, the module's, and its directory in reference-data.
const Name = "garden"

// Catalog is Garden's reference data, read and checked, each kind of record in the order of its
// keys.
type Catalog struct {
	Families []Family
	Pests    []Problem
	Diseases []Problem
	Crops    []Crop
	// Rules holds one set per scope the files hold.
	Rules []RuleSet
	// Climate holds one set of places per country.
	Climate []Climate
}

// Family is a botanical family, which rotation and the family rules join on.
type Family struct {
	// Key is the family's Latin name in lower case, and the name of its file.
	Key       string                               `json:"key"`
	Name      reference.Field[reference.Localized] `json:"name"`
	NameLatin reference.Field[string]              `json:"name_latin"`
}

// Problem is a pest, or a disease or disorder, that commonly troubles a crop.
type Problem struct {
	Key  string                               `json:"key"`
	Name reference.Field[reference.Localized] `json:"name"`
	// NameLatin is the organism's scientific name; nil for a disorder no organism causes.
	NameLatin *reference.Field[string] `json:"name_latin"`
}

// Crop is a crop of the catalog. A measure is metric, and a timing a Window.
type Crop struct {
	// Key is the crop's identity in the catalog, and the name of its file.
	Key       string                               `json:"key"`
	Name      reference.Field[reference.Localized] `json:"name"`
	NameLatin reference.Field[string]              `json:"name_latin"`
	// Family is the key of the crop's Family.
	Family      reference.Field[string] `json:"family"`
	PlantType   reference.Field[string] `json:"plant_type"`
	LifeCycle   reference.Field[string] `json:"life_cycle"`
	Propagation reference.Field[string] `json:"propagation"`
	Hardiness   reference.Field[string] `json:"hardiness"`
	FeederClass reference.Field[string] `json:"feeder_class"`
	RootDepth   reference.Field[string] `json:"root_depth"`
	Sun         reference.Field[string] `json:"sun"`
	WaterNeed   reference.Field[string] `json:"water_need"`
	SoilPH      reference.Field[PH]     `json:"soil_ph"`
	// RotationBreakYears is the years before the crop or its family returns to a bed.
	RotationBreakYears reference.Field[int] `json:"rotation_break_years"`
	// SowDepthCM is nil for a crop that is only ever planted out, and for no other.
	SowDepthCM *reference.Field[float64] `json:"sow_depth_cm"`
	Spacing    reference.Field[Spacing]  `json:"spacing"`
	// PlantsPerM2 is what a square metre holds at the spacing, as a grower counts them; nil, it is
	// what the spacing gives.
	PlantsPerM2 *reference.Field[float64] `json:"plants_per_m2"`
	// GerminationTempC and DaysToGerminate are a crop's that is started from seed.
	GerminationTempC *reference.Field[float64] `json:"germination_temp_c"`
	DaysToGerminate  *reference.Field[Range]   `json:"days_to_germinate"`
	// DaysToMaturity is nil for a perennial.
	DaysToMaturity *reference.Field[Range]   `json:"days_to_maturity"`
	Windows        Windows                   `json:"windows"`
	CareTasks      reference.Field[[]string] `json:"care_tasks"`
	// HarvestUnit, Yield and Storage are nil for a green manure, which is dug in, not harvested.
	HarvestUnit *reference.Field[string]             `json:"harvest_unit"`
	Yield       *reference.Field[Yield]              `json:"yield"`
	Storage     *reference.Field[[]Stored]           `json:"storage"`
	Pests       reference.Field[[]string]            `json:"pests"`
	Diseases    reference.Field[[]string]            `json:"diseases"`
	CareNotes   reference.Field[reference.Localized] `json:"care_notes"`
	Varieties   []Variety                            `json:"varieties"`
}

// GreenManure is the plant type of a crop grown to be dug in.
const GreenManure = "green_manure"

// PH is a range of soil pH.
type PH struct {
	Min float64 `json:"min"`
	Max float64 `json:"max"`
}

// Range is a span of days.
type Range struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

// Spacing is the distance between rows and between plants in a row, in cm.
type Spacing struct {
	RowCM   float64 `json:"row_cm"`
	PlantCM float64 `json:"plant_cm"`
}

// Yield is what a crop gives in a season, in its harvest unit; either may be nil, not both.
type Yield struct {
	PerM2    *float64 `json:"per_m2"`
	PerPlant *float64 `json:"per_plant"`
}

// Stored is one way a harvest keeps, and for how long.
type Stored struct {
	Method        string `json:"method"`
	ShelfLifeDays int    `json:"shelf_life_days"`
}

// The anchors a Window counts from: a household's two frost dates (FR-GA3), and the first autumn
// frost of the year before the harvest, for a crop that stands the winter (FR-GA17).
const (
	LastFrost          = "last_frost"
	FirstFrost         = "first_frost"
	PreviousFirstFrost = "previous_first_frost"
)

// Window is a span of days counted from an anchor, negative before it: never a calendar date.
type Window struct {
	Anchor   string `json:"anchor"`
	FromDays int    `json:"from_days"`
	ToDays   int    `json:"to_days"`
}

// Windows are a crop's timings; one it does not have is nil. A variety's are those in which it
// differs from its crop.
type Windows struct {
	SowIndoor  *reference.Field[Window] `json:"sow_indoor"`
	SowDirect  *reference.Field[Window] `json:"sow_direct"`
	Transplant *reference.Field[Window] `json:"transplant"`
	Harvest    *reference.Field[Window] `json:"harvest"`
}

// Variety is a catalog variety of a crop: a name, and the fields in which it differs (FR-GA2).
type Variety struct {
	// Key is unique among its crop's varieties.
	Key       string                                `json:"key"`
	Name      reference.Field[string]               `json:"name"`
	Note      *reference.Field[reference.Localized] `json:"note"`
	Overrides Overrides                             `json:"overrides"`
}

// Overrides are the fields a variety may differ in; nil is the crop's own. One that overrides the
// spacing of a crop that gives its plants per square metre overrides those too.
type Overrides struct {
	SowDepthCM     *reference.Field[float64]  `json:"sow_depth_cm"`
	Spacing        *reference.Field[Spacing]  `json:"spacing"`
	PlantsPerM2    *reference.Field[float64]  `json:"plants_per_m2"`
	DaysToMaturity *reference.Field[Range]    `json:"days_to_maturity"`
	Windows        *Windows                   `json:"windows"`
	Yield          *reference.Field[Yield]    `json:"yield"`
	Storage        *reference.Field[[]Stored] `json:"storage"`
}

// The scopes of a rule (FR-GA21).
const (
	CropPair   = "crop_pair"
	FamilyPair = "family_pair"
	Succession = "succession"
)

// RuleSet is the catalog's rules of one scope, in the name of its file.
type RuleSet struct {
	Scope string `json:"scope"`
	Rules []Rule `json:"rules"`
}

// Rule is a claim about a pair: two crops or two families, written once with the lesser key
// first and matched both ways, or, in a succession, what was grown and what follows it.
type Rule struct {
	A      string                               `json:"a"`
	B      string                               `json:"b"`
	Claim  reference.Field[Claim]               `json:"claim"`
	Reason reference.Field[reference.Localized] `json:"reason"`
}

// Claim is what a rule claims of its pair. Basis tells agronomy from tradition (D-66).
type Claim struct {
	Relation string `json:"relation"`
	Basis    string `json:"basis"`
	Severity string `json:"severity"`
	// MinYearsGap is a succession's alone.
	MinYearsGap *int `json:"min_years_gap"`
}

// Climate is a country's climate profiles, in the file named for its code.
type Climate struct {
	Country string  `json:"country"`
	Places  []Place `json:"places"`
}

// Place is the climate profile of a place: what a household there starts from, and may edit.
type Place struct {
	Key      string                    `json:"key"`
	Name     reference.Field[string]   `json:"name"`
	Location reference.Field[Location] `json:"location"`
	// AltitudeM is the altitude the values hold at, the source's grid cell's.
	AltitudeM reference.Field[int] `json:"altitude_m"`
	// LastSpringFrost and FirstAutumnFrost are days of the year, MM-DD.
	LastSpringFrost  reference.Field[string] `json:"last_spring_frost"`
	FirstAutumnFrost reference.Field[string] `json:"first_autumn_frost"`
	HardinessZone    reference.Field[string] `json:"hardiness_zone"`
	SeasonLengthDays reference.Field[int]    `json:"season_length_days"`
}

// Location is a point in degrees, to two decimal places.
type Location struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}
