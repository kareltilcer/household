package catalog

import (
	"fmt"
	"math"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/reference"
)

// The directories of the set, in reference-data, each holding one <key>.json file per record.
const (
	familiesDir = Name + "/families"
	pestsDir    = Name + "/pests"
	diseasesDir = Name + "/diseases"
	cropsDir    = Name + "/crops"
	rulesDir    = Name + "/rules"
	climateDir  = Name + "/climate"
)

// The schema each kind of file is held to, in schemas/.
const (
	familySchema  = "garden-family.schema.json"
	problemSchema = "garden-problem.schema.json"
	cropSchema    = "garden-crop.schema.json"
	rulesSchema   = "garden-rules.schema.json"
	climateSchema = "garden-climate.schema.json"
)

// Set is Garden's reference data as the platform's pipeline takes it. Its Read is the catalog's
// validator: each file against its schema, which refuses a field without a source and a name
// without one of the languages, and then the completeness a schema cannot see:
//
//   - a file is named for its record;
//   - a crop's family, pests and diseases are records of the catalog, its Latin name and its name
//     in each language are no other crop's, and its ranges run from the lesser to the greater;
//   - a crop has a sowing or planting window beside the harvest window its schema requires, one
//     sown under cover is planted out, and a window runs forwards;
//   - a crop with a sowing window has a sowing depth and one without has none, one started from
//     seed has a sowing window, a germination temperature and days to germinate, and one that is
//     not a perennial has days to maturity;
//   - a crop has a harvest unit, a yield and a storage, but a green manure, which has none;
//   - a variety's key is its crop's alone, and what it overrides is held to the same: each value as
//     the crop's own is, and the crop with the variety's differences to the rules between a crop's
//     fields, so that a variety makes of no crop one they refuse, and one that overrides the
//     spacing overrides the plants per square metre its crop gives (checkVariety);
//   - a rule names two crops, or two families, that the catalog holds, a pair once and its lesser
//     key first;
//   - a place's key carries its country and is no other place's, its frost dates are days of the
//     year, the spring one before the autumn one, and its season is the days between them.
//
// It has no Load: the tables the catalog loads into are plan item 68's.
func Set() reference.Set {
	return reference.Set{
		Name:    Name,
		Schemas: []string{familySchema, problemSchema, cropSchema, rulesSchema, climateSchema},
		Read:    func(r *reference.Reader) any { return read(r) },
	}
}

// Of returns the catalog in data, which a Read with Set returned; nil when it was read without.
func Of(data *reference.Data) *Catalog {
	c, _ := data.Sets[Name].(*Catalog)
	return c
}

// read reads the set's files through r and checks them.
func read(r *reference.Reader) *Catalog {
	c := &Catalog{}
	families := map[string]bool{}
	for _, name := range r.Files(familiesDir) {
		var f Family
		if !r.Decode(name, familySchema, &f) {
			continue
		}
		r.Named(name, "/key", f.Key)
		r.Localized(name, "/name/value", f.Name.Value)
		if strings.ToLower(f.NameLatin.Value) != f.Key {
			r.Problem(name, "/name_latin/value", "is %s, so the key is %s", f.NameLatin.Value, strings.ToLower(f.NameLatin.Value))
		}
		families[f.Key] = true
		c.Families = append(c.Families, f)
	}
	pests := problems(r, pestsDir, &c.Pests)
	diseases := problems(r, diseasesDir, &c.Diseases)
	for key := range pests {
		if diseases[key] {
			r.Problem(path.Join(diseasesDir, key+".json"), "/key", "%s is also a pest: a key is one or the other", key)
		}
	}

	seen := unique{}
	crops := map[string]bool{}
	for _, name := range r.Files(cropsDir) {
		var crop Crop
		if !r.Decode(name, cropSchema, &crop) {
			continue
		}
		checkCrop(r, name, crop, families, pests, diseases, seen)
		crops[crop.Key] = true
		c.Crops = append(c.Crops, crop)
	}
	for key := range crops {
		if families[key] {
			r.Problem(path.Join(cropsDir, key+".json"), "/key", "%s is also a family: a succession could not tell them apart", key)
		}
	}

	for _, name := range r.Files(rulesDir) {
		var set RuleSet
		if !r.Decode(name, rulesSchema, &set) {
			continue
		}
		checkRules(r, name, set, crops, families)
		c.Rules = append(c.Rules, set)
	}

	places := map[string]string{}
	for _, name := range r.Files(climateDir) {
		var climate Climate
		if !r.Decode(name, climateSchema, &climate) {
			continue
		}
		checkClimate(r, name, climate, places)
		c.Climate = append(c.Climate, climate)
	}
	return c
}

// problems reads the pests or the diseases in dir into out, and returns their keys.
func problems(r *reference.Reader, dir string, out *[]Problem) map[string]bool {
	keys := map[string]bool{}
	for _, name := range r.Files(dir) {
		var p Problem
		if !r.Decode(name, problemSchema, &p) {
			continue
		}
		r.Named(name, "/key", p.Key)
		r.Localized(name, "/name/value", p.Name.Value)
		keys[p.Key] = true
		*out = append(*out, p)
	}
	return keys
}

// unique is where each value that must be one crop's alone was first seen, by what it is: a Latin
// name, or a name in a language.
type unique map[string]string

// claim records value, of the kind given, as the one at at in file, or reports whose it already is.
func (u unique) claim(r *reference.Reader, file, at, kind, value string) {
	key := kind + "\x00" + strings.ToLower(value)
	if other, taken := u[key]; taken {
		r.Problem(file, at, "%s is also the %s of %s", value, kind, other)
		return
	}
	u[key] = file
}

// checkCrop checks what the crop schema cannot about crop, read from file.
func checkCrop(r *reference.Reader, file string, crop Crop, families, pests, diseases map[string]bool, seen unique) {
	r.Named(file, "/key", crop.Key)
	r.Localized(file, "/name/value", crop.Name.Value)
	r.Localized(file, "/care_notes/value", crop.CareNotes.Value)
	seen.claim(r, file, "/name_latin/value", "Latin name", crop.NameLatin.Value)
	for _, l := range i18n.Locales {
		if name := crop.Name.Value[string(l)]; name != "" {
			seen.claim(r, file, "/name/value/"+string(l), "name in "+string(l), name)
		}
	}
	if !families[crop.Family.Value] {
		r.Problem(file, "/family/value", "%s is not a family of %s", crop.Family.Value, familiesDir)
	}
	listed(r, file, "/pests/value", crop.Pests.Value, pests, pestsDir)
	listed(r, file, "/diseases/value", crop.Diseases.Value, diseases, diseasesDir)
	if crop.SoilPH.Value.Min > crop.SoilPH.Value.Max {
		r.Problem(file, "/soil_ph/value", "runs from %v down to %v", crop.SoilPH.Value.Min, crop.SoilPH.Value.Max)
	}
	ordered(r, file, "/days_to_germinate/value", crop.DaysToGerminate)
	ordered(r, file, "/days_to_maturity/value", crop.DaysToMaturity)

	w := crop.Windows
	checkWindows(r, file, "/windows", w)
	if w.SowIndoor == nil && w.SowDirect == nil && w.Transplant == nil {
		r.Problem(file, "/windows", "has no sowing or planting window: a crop is sown under cover, sown or planted where it grows, or planted out")
	}
	if w.SowIndoor != nil && w.Transplant == nil {
		r.Problem(file, "/windows", "is sown under cover and never planted out: it has no transplant window")
	}

	sown := w.sown()
	switch {
	case sown && crop.SowDepthCM == nil:
		r.Problem(file, "", "has a sowing window and no sow_depth_cm")
	case !sown && crop.SowDepthCM != nil:
		r.Problem(file, "/sow_depth_cm", "is a sowing's, and the crop has no sowing window")
	}
	if crop.Propagation.Value == "seed" {
		if !sown {
			r.Problem(file, "/windows", "is started from seed and has no sowing window")
		}
		if crop.GerminationTempC == nil {
			r.Problem(file, "", "is started from seed and has no germination_temp_c")
		}
		if crop.DaysToGerminate == nil {
			r.Problem(file, "", "is started from seed and has no days_to_germinate")
		}
	} else {
		if crop.GerminationTempC != nil {
			r.Problem(file, "/germination_temp_c", "is a seed's, and the crop is not started from seed")
		}
		if crop.DaysToGerminate != nil {
			r.Problem(file, "/days_to_germinate", "is a seed's, and the crop is not started from seed")
		}
	}
	if crop.LifeCycle.Value == "perennial" {
		if crop.DaysToMaturity != nil {
			r.Problem(file, "/days_to_maturity", "is not a perennial's, which crops year after year from where it stands")
		}
	} else if crop.DaysToMaturity == nil {
		r.Problem(file, "", "is %s and has no days_to_maturity", crop.LifeCycle.Value)
	}
	for _, harvest := range []struct {
		name   string
		absent bool
	}{
		{"harvest_unit", crop.HarvestUnit == nil}, {"yield", crop.Yield == nil}, {"storage", crop.Storage == nil},
	} {
		switch manure := crop.PlantType.Value == GreenManure; {
		case manure && !harvest.absent:
			r.Problem(file, "/"+harvest.name, "is a harvest's, and a green manure is dug in, not harvested")
		case !manure && harvest.absent:
			r.Problem(file, "", "is harvested and has no %s", harvest.name)
		}
	}
	if crop.Storage != nil {
		methods(r, file, "/storage/value", crop.Storage.Value)
	}

	keys := map[string]int{}
	for i, v := range crop.Varieties {
		at := "/varieties/" + strconv.Itoa(i)
		if first, dup := keys[v.Key]; dup {
			r.Problem(file, at+"/key", "%s is also the key of the variety at /varieties/%d", v.Key, first)
		} else {
			keys[v.Key] = i
		}
		checkVariety(r, file, at, crop, v)
	}
}

// checkVariety checks v, the variety at at of crop in file. What it overrides is held to what the
// crop's own values are, and then the crop with the variety's differences, which is the record a
// household growing the variety is served (FR-GA2), to the rules between a crop's fields. A
// problem the crop has without the variety is the crop's, and is not said again of each variety.
func checkVariety(r *reference.Reader, file, at string, crop Crop, v Variety) {
	if v.Note != nil {
		r.Localized(file, at+"/note/value", v.Note.Value)
	}
	o, over := v.Overrides, at+"/overrides"
	ordered(r, file, over+"/days_to_maturity/value", o.DaysToMaturity)
	if o.DaysToMaturity != nil && crop.LifeCycle.Value == "perennial" {
		r.Problem(file, over+"/days_to_maturity", "is not a perennial's, which crops year after year from where it stands")
	}
	if o.Storage != nil {
		methods(r, file, over+"/storage/value", o.Storage.Value)
	}
	for _, harvest := range []struct {
		name    string
		present bool
	}{{"yield", o.Yield != nil}, {"storage", o.Storage != nil}} {
		if harvest.present && crop.PlantType.Value == GreenManure {
			r.Problem(file, over+"/"+harvest.name, "is a harvest's, and a green manure is dug in, not harvested")
		}
	}
	if o.Spacing != nil && o.PlantsPerM2 == nil && crop.PlantsPerM2 != nil {
		r.Problem(file, over, "overrides spacing and not plants_per_m2, which its crop gives for the crop's own spacing")
	}

	w := crop.Windows
	if o.Windows != nil {
		checkWindows(r, file, over+"/windows", *o.Windows)
		w = w.with(*o.Windows)
	}
	if w.SowIndoor != nil && w.Transplant == nil && crop.Windows.SowIndoor == nil {
		r.Problem(file, over+"/windows", "is sown under cover and never planted out: neither it nor its crop has a transplant window")
	}
	switch sown := w.sown(); {
	case sown && !crop.Windows.sown() && crop.SowDepthCM == nil && o.SowDepthCM == nil:
		r.Problem(file, over, "has a sowing window and no sow_depth_cm, and neither has its crop")
	case !sown && o.SowDepthCM != nil:
		r.Problem(file, over+"/sow_depth_cm", "is a sowing's, and neither the variety nor its crop has a sowing window")
	}
}

// sown reports whether w has a sowing window, under cover or where the crop grows.
func (w Windows) sown() bool { return w.SowIndoor != nil || w.SowDirect != nil }

// with returns w with each window o has in place of its own: a crop's windows as a variety's
// overrides leave them.
func (w Windows) with(o Windows) Windows {
	if o.SowIndoor != nil {
		w.SowIndoor = o.SowIndoor
	}
	if o.SowDirect != nil {
		w.SowDirect = o.SowDirect
	}
	if o.Transplant != nil {
		w.Transplant = o.Transplant
	}
	if o.Harvest != nil {
		w.Harvest = o.Harvest
	}
	return w
}

// listed checks that each of keys, the value at at in file, is a record of dir.
func listed(r *reference.Reader, file, at string, keys []string, records map[string]bool, dir string) {
	for i, key := range keys {
		if !records[key] {
			r.Problem(file, at+"/"+strconv.Itoa(i), "%s is not a record of %s", key, dir)
		}
	}
}

// ordered checks that the range at at in file, when it has one, runs from the lesser to the greater.
func ordered(r *reference.Reader, file, at string, days *reference.Field[Range]) {
	if days != nil && days.Value.Min > days.Value.Max {
		r.Problem(file, at, "runs from %d down to %d", days.Value.Min, days.Value.Max)
	}
}

// checkWindows checks that each window of w, at at in file, runs forwards.
func checkWindows(r *reference.Reader, file, at string, w Windows) {
	for _, window := range []struct {
		name  string
		field *reference.Field[Window]
	}{
		{"sow_indoor", w.SowIndoor}, {"sow_direct", w.SowDirect}, {"transplant", w.Transplant}, {"harvest", w.Harvest},
	} {
		if f := window.field; f != nil && f.Value.FromDays > f.Value.ToDays {
			r.Problem(file, at+"/"+window.name+"/value", "runs from day %d back to day %d", f.Value.FromDays, f.Value.ToDays)
		}
	}
}

// methods checks that stored, the value at at in file, names each method once.
func methods(r *reference.Reader, file, at string, stored []Stored) {
	seen := map[string]int{}
	for i, s := range stored {
		if first, dup := seen[s.Method]; dup {
			r.Problem(file, at+"/"+strconv.Itoa(i)+"/method", "%s is also the method at %s/%d", s.Method, at, first)
		} else {
			seen[s.Method] = i
		}
	}
}

// checkRules checks what the rules schema cannot about set, read from file: that each rule names
// records of the catalog, of the kind its scope is about, and that no pair is ruled on twice.
func checkRules(r *reference.Reader, file string, set RuleSet, crops, families map[string]bool) {
	r.Named(file, "/scope", set.Scope)
	seen := map[[2]string]int{}
	for i, rule := range set.Rules {
		at := "/rules/" + strconv.Itoa(i)
		r.Localized(file, at+"/reason/value", rule.Reason.Value)
		switch set.Scope {
		case CropPair:
			known(r, file, at, rule, crops, "crop", cropsDir)
		case FamilyPair:
			known(r, file, at, rule, families, "family", familiesDir)
		case Succession:
			// What follows what is said of two crops or of two families, never of one of each.
			switch {
			case crops[rule.A] && crops[rule.B], families[rule.A] && families[rule.B]:
			case crops[rule.A] && families[rule.B], families[rule.A] && crops[rule.B]:
				r.Problem(file, at, "names a crop and a family: a succession is between two crops or two families")
			default:
				for _, end := range []struct{ at, key string }{{"/a", rule.A}, {"/b", rule.B}} {
					if !crops[end.key] && !families[end.key] {
						r.Problem(file, at+end.at, "%s is neither a crop of %s nor a family of %s", end.key, cropsDir, familiesDir)
					}
				}
			}
		}
		if set.Scope != Succession && rule.A >= rule.B {
			// A pair is matched both ways, so it is written one way: a rule of a crop with itself is none.
			r.Problem(file, at, "pairs %s with %s: a pair is two records, the lesser key first", rule.A, rule.B)
		}
		pair := [2]string{rule.A, rule.B}
		if first, dup := seen[pair]; dup {
			r.Problem(file, at, "rules on %s and %s, as the rule at /rules/%d does", rule.A, rule.B, first)
		} else {
			seen[pair] = i
		}
	}
}

// known checks that both ends of rule, at at in file, are records of dir, each a kind.
func known(r *reference.Reader, file, at string, rule Rule, records map[string]bool, kind, dir string) {
	for _, end := range []struct{ at, key string }{{"/a", rule.A}, {"/b", rule.B}} {
		if !records[end.key] {
			r.Problem(file, at+end.at, "%s is not a %s of %s", end.key, kind, dir)
		}
	}
}

// checkClimate checks what the climate schema cannot about climate, read from file. places holds
// where each place's key was first seen, across every country.
func checkClimate(r *reference.Reader, file string, climate Climate, places map[string]string) {
	r.Named(file, "/country", climate.Country)
	prefix := strings.ToLower(climate.Country) + "_"
	names := map[string]int{}
	for i, p := range climate.Places {
		at := "/places/" + strconv.Itoa(i)
		if !strings.HasPrefix(p.Key, prefix) {
			r.Problem(file, at+"/key", "is %s: a place's key begins with its country's code, %s", p.Key, prefix)
		}
		if other, dup := places[p.Key]; dup {
			r.Problem(file, at+"/key", "%s is also the key of the place at %s", p.Key, other)
		} else {
			places[p.Key] = file + "#" + at
		}
		if first, dup := names[p.Name.Value]; dup {
			r.Problem(file, at+"/name/value", "%s is also the name of the place at /places/%d", p.Name.Value, first)
		} else {
			names[p.Name.Value] = i
		}
		for _, degree := range []struct {
			name  string
			value float64
		}{{"latitude", p.Location.Value.Latitude}, {"longitude", p.Location.Value.Longitude}} {
			if math.Abs(degree.value*100-math.Round(degree.value*100)) > 1e-6 {
				r.Problem(file, at+"/location/value/"+degree.name, "is %v: a place is given to two decimal places", degree.value)
			}
		}
		last, lastOK := dayOfYear(p.LastSpringFrost.Value)
		if !lastOK {
			r.Problem(file, at+"/last_spring_frost/value", "%s is not a day of the year", p.LastSpringFrost.Value)
		}
		first, firstOK := dayOfYear(p.FirstAutumnFrost.Value)
		if !firstOK {
			r.Problem(file, at+"/first_autumn_frost/value", "%s is not a day of the year", p.FirstAutumnFrost.Value)
		}
		if !lastOK || !firstOK {
			continue
		}
		if last >= first {
			r.Problem(file, at+"/first_autumn_frost/value", "%s is not after the last spring frost, %s", p.FirstAutumnFrost.Value, p.LastSpringFrost.Value)
		} else if days := first - last; p.SeasonLengthDays.Value != days {
			r.Problem(file, at+"/season_length_days/value", "is %d; from %s to %s is %d days", p.SeasonLengthDays.Value,
				p.LastSpringFrost.Value, p.FirstAutumnFrost.Value, days)
		}
	}
}

// dayOfYear returns the day of a year of 365 that monthDay, MM-DD, is, counting from 1, and
// whether it is one: a normal of thirty years has no 29 February.
func dayOfYear(monthDay string) (int, bool) {
	// 2023 is no leap year.
	t, err := time.Parse("2006-01-02", fmt.Sprintf("2023-%s", monthDay))
	if err != nil {
		return 0, false
	}
	return t.YearDay(), true
}
