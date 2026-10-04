package catalog_test

import (
	"bufio"
	"errors"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/kareltilcer/household/server/internal/modules/garden/catalog"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/reference"
)

// shipped reads the reference data the server ships, with Garden's set.
func shipped(t *testing.T) (*reference.Data, *catalog.Catalog) {
	t.Helper()
	data, err := reference.Read(reference.Files(), catalog.Set())
	if err != nil {
		t.Fatal(err)
	}
	c := catalog.Of(data)
	if c == nil {
		t.Fatal("Read returned no catalog")
	}
	return data, c
}

// Plan item 22's Done-when: the validator is green. The catalog the server ships passes every
// check Read makes, which is what CI runs on each change to reference-data/garden until the
// module declares the set and a deploy checks it too.
func TestTheShippedCatalogIsValid(t *testing.T) {
	data, c := shipped(t)
	// A source nothing cites is a citation nobody can check.
	if len(data.Uncited) > 0 {
		t.Errorf("the sources list %v, which no field cites", data.Uncited)
	}
	for _, kind := range []struct {
		name string
		n    int
	}{
		{"families", len(c.Families)}, {"pests", len(c.Pests)}, {"diseases", len(c.Diseases)},
		{"rules", len(c.Rules)}, {"climate", len(c.Climate)},
	} {
		if kind.n == 0 {
			t.Errorf("the catalog holds no %s", kind.name)
		}
	}
}

// Plan item 22's Done-when: 100 crops exist in all five languages. Read holds each name and
// each note to the shipped languages; this holds the catalog to the first hundred.
func TestTheCatalogHoldsTheFirstHundredCrops(t *testing.T) {
	_, c := shipped(t)
	if len(c.Crops) < 100 {
		t.Fatalf("the catalog holds %d crops, and plan item 22 ships 100", len(c.Crops))
	}
	for _, crop := range c.Crops {
		for _, l := range i18n.Locales {
			if crop.Name.Value[string(l)] == "" || crop.CareNotes.Value[string(l)] == "" {
				t.Errorf("%s has no name or no care notes in %s", crop.Key, l)
			}
		}
	}
}

// The catalog's rules carry what the prototype's and the predecessor's did: each of the three
// scopes, and both kinds of claim, so that agronomy and tradition are told apart by looking (D-66).
func TestTheRulesCoverEveryScopeAndBothBases(t *testing.T) {
	_, c := shipped(t)
	var scopes []string
	bases := map[string]int{}
	for _, set := range c.Rules {
		scopes = append(scopes, set.Scope)
		for _, rule := range set.Rules {
			bases[rule.Claim.Value.Basis]++
		}
	}
	if want := []string{catalog.CropPair, catalog.FamilyPair, catalog.Succession}; !slices.Equal(scopes, want) {
		t.Errorf("rules of the scopes %v, want %v", scopes, want)
	}
	if bases["agronomic"] == 0 || bases["traditional"] == 0 {
		t.Errorf("claims by basis: %v; the catalog holds both agronomic and traditional ones", bases)
	}
}

// Plan item 22: the climate dataset is for the five countries. Each country that has a profile
// has its places, and no other does.
func TestTheClimateCoversTheCountryProfiles(t *testing.T) {
	data, c := shipped(t)
	var profiles, climates []string
	for _, country := range data.Countries {
		profiles = append(profiles, country.Code)
	}
	for _, climate := range c.Climate {
		climates = append(climates, climate.Country)
	}
	if !slices.Equal(climates, profiles) {
		t.Errorf("climate profiles for %v; the country profiles are %v", climates, profiles)
	}
}

// months are the names of the months in each shipped language, in the forms a sentence uses: the
// noun in its cases, and the adjective made of it ("květnový výsev", "majowy siew", a German
// compound such as "Augustaussaat"; not one of Mai, which Mais would be).
var months = map[i18n.Locale]string{
	i18n.English: `January|February|March|April|May|June|July|August|September|October|November|December`,
	i18n.Czech: `(?i:led(en|na|nu)|únor(a|u)?|břez(en|na|nu)|dub(en|na|nu)|květ(en|na|nu)|červ(en|na|nu)|červen(ec|ce|ci)|` +
		`srp(en|na|nu)|září|říj(en|na|nu)|listopadu?|prosin(ec|ce|ci)|` +
		`(ledn|únor|březn|dubn|květn|červn|červenc|srpn|zářij|říjn|listopad|prosinc)ov\p{L}+)`,
	i18n.Slovak: `(?i:január[ai]?|február[ai]?|mar(ec|ca|ci)|apríl[ai]?|máj[ai]?|jún[ai]?|júl[ai]?|august[ae]?|` +
		`septemb(er|ra|ri)|októb(er|ra|ri)|novemb(er|ra|ri)|decemb(er|ra|ri)|` +
		`(január|február|marc|apríl|máj|jún|júl|august|septembr|októbr|novembr|decembr)ov\p{L}+)`,
	i18n.German: `Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|` +
		`(Januar|Februar|März|April|Juni|Juli|August|September|Oktober|November|Dezember)\p{L}+`,
	i18n.Polish: `(?i:stycz(eń|nia|niu)|lut(y|ego|ym)|marz?(ec|ca|cu)|kwie(cień|tnia|tniu)|maj[au]?|czerw(iec|ca|cu)|` +
		`lip(iec|ca|cu)|sierp(ień|nia|niu)|wrze(sień|śnia|śniu)|październik[au]?|listopad(a|zie)?|grud(zień|nia|niu)|` +
		`(styczni|lut|marc|kwietni|maj|czerwc|lipc|sierpni|wrześni|październik|listopad|grudni)ow\p{L}+)`,
}

// Plan item 22: timings are offsets from the household's frost dates, and no absolute dates. A
// window cannot hold one, which the schema sees to; this holds what a member reads, a crop's
// notes, a variety's and a rule's reason, to naming no date, no month and no year, in any of the
// languages: "after the last frost" is true in Kuřim and in Córdoba, and "in the middle of May"
// in one of them. The longest day is not such a date, and a note may name it (midsummer, the
// solstice): a sowing that bolts in lengthening days and a harvest that ends with them answer to
// it, and it is the same day in both.
func TestTheCatalogHoldsNoAbsoluteDate(t *testing.T) {
	_, c := shipped(t)
	numeric := regexp.MustCompile(`\d{4}-\d{2}-\d{2}|\b\d{1,2}\.\s?\d{1,2}\.|\b(1[89]|20)\d{2}\b`)
	named := map[i18n.Locale]*regexp.Regexp{}
	for _, l := range i18n.Locales {
		names, ok := months[l]
		if !ok {
			t.Fatalf("the months are not named in %s, a language the server ships", l)
		}
		// A word of its own: \b is ASCII's, and a month may begin or end with a letter that is not.
		named[l] = regexp.MustCompile(`(^|[^\p{L}])(` + names + `)($|[^\p{L}])`)
	}
	check := func(where string, text reference.Localized) {
		t.Helper()
		for _, l := range i18n.Locales {
			s := text[string(l)]
			if m := numeric.FindString(s); m != "" {
				t.Errorf("%s in %s: %q reads as a date: a timing is days from a frost date", where, l, m)
			}
			if m := named[l].FindStringSubmatch(s); m != nil {
				t.Errorf("%s in %s names a month, %q: a timing is days from a frost date", where, l, m[2])
			}
		}
	}
	for _, crop := range c.Crops {
		check(crop.Key+"'s care notes", crop.CareNotes.Value)
		for _, v := range crop.Varieties {
			if v.Note != nil {
				check(crop.Key+"'s variety "+v.Key, v.Note.Value)
			}
		}
	}
	for _, set := range c.Rules {
		for _, rule := range set.Rules {
			check("the "+set.Scope+" rule on "+rule.A+" and "+rule.B, rule.Reason.Value)
		}
	}
}

// The patterns that hold the notes to naming no month see each form a sentence uses, and leave
// alone the words that only begin as a month does.
func TestTheMonthPatternsSeeEachForm(t *testing.T) {
	for l, texts := range map[i18n.Locale]struct{ named, clear []string }{
		i18n.English: {[]string{"Sow in mid-May.", "March sowings bolt."}, []string{"It may bolt.", "Sow after midsummer."}},
		i18n.Czech:   {[]string{"Sejte v květnu.", "Květnový výsev vybíhá.", "srpnové výsevy"}, []string{"Květní stvoly odstraňujte.", "po posledním mrazu", "po letním slunovratu"}},
		i18n.Slovak:  {[]string{"Sejte v máji.", "májový výsev", "augustové výsevy"}, []string{"okolo letného slnovratu", "po poslednom mraze"}},
		i18n.German:  {[]string{"Mitte Mai säen.", "Die Augustaussaat gelingt.", "Märzsaaten schossen."}, []string{"Der Mais gibt Halt.", "zur Sommersonnenwende"}},
		i18n.Polish:  {[]string{"Siej w maju.", "majowy siew", "sierpniowe siewy"}, []string{"połyśnicę marchwiankę", "około przesilenia letniego", "pod lipą"}},
	} {
		re := regexp.MustCompile(`(^|[^\p{L}])(` + months[l] + `)($|[^\p{L}])`)
		for _, s := range texts.named {
			if !re.MatchString(s) {
				t.Errorf("%s: %q names a month, and the pattern does not see it", l, s)
			}
		}
		for _, s := range texts.clear {
			if m := re.FindStringSubmatch(s); m != nil {
				t.Errorf("%s: %q names no month, and the pattern sees %q", l, s, m[2])
			}
		}
	}
}

// Each directory in testdata is a garden set that breaks the rules, beside the platform's own
// data as the server ships it, and its want.txt is every problem Read must report, all at once.
func TestReadCatchesEachViolation(t *testing.T) {
	entries, err := os.ReadDir("testdata")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		t.Run(e.Name(), func(t *testing.T) {
			fsys, want := overlay(t, filepath.Join("testdata", e.Name()))
			_, err := reference.Read(fsys, catalog.Set())
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

// overlay returns the reference data the server ships with its garden directory replaced by the
// one in dir, and the lines of dir's want.txt.
func overlay(t *testing.T, dir string) (fstest.MapFS, []string) {
	t.Helper()
	fsys := fstest.MapFS{}
	set := os.DirFS(dir)
	copyInto(t, fsys, reference.Files(), func(name string) bool { return !strings.HasPrefix(name, catalog.Name+"/") })
	copyInto(t, fsys, set, func(name string) bool { return name != "want.txt" })

	f, err := set.Open("want.txt")
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

// copyInto copies the files of src that keep admits into dst, at the paths they have.
func copyInto(t *testing.T, dst fstest.MapFS, src fs.FS, keep func(name string) bool) {
	t.Helper()
	err := fs.WalkDir(src, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !keep(name) {
			return err
		}
		data, err := fs.ReadFile(src, name)
		if err != nil {
			return err
		}
		dst[path.Clean(name)] = &fstest.MapFile{Data: data}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
