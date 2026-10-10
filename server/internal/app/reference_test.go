package app_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// read sends a GET for path to the server, as user, or with no caller when user is uuid.Nil, and
// checks the response against the contract. The reference reads name no household, so the caller
// needs no membership, nor even a row: any authenticated user may read them.
func read(t *testing.T, path string, user uuid.UUID) *httptest.ResponseRecorder {
	t.Helper()
	r, _ := router(t)
	req := get(t, path)
	if user != uuid.Nil {
		req = req.WithContext(auth.WithUser(req.Context(), user))
	}
	return testsupport.Serve(t, r, req)
}

// decode decodes rec's body into v.
func decode(t *testing.T, rec *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), v); err != nil {
		t.Fatalf("%v: %s", err, rec.Body.String())
	}
}

func TestReferenceReadsAnswerOnlyAnAuthenticatedCaller(t *testing.T) {
	for _, path := range []string{"/api/v1/reference/countries", "/api/v1/reference/countries/CZ", "/api/v1/reference/units"} {
		expect(t, read(t, path, uuid.Nil), http.StatusUnauthorized, problem.CodeUnauthenticated)
	}
}

// country is the contract's Country, as a client reads it.
type country struct {
	Code               string            `json:"code"`
	Version            int64             `json:"version"`
	Name               map[string]string `json:"name"`
	Currency           string            `json:"currency"`
	VATStandardPercent string            `json:"vat_standard_percent"`
	DefaultUnits       string            `json:"default_units"`
	FirstDayOfWeek     int               `json:"first_day_of_week"`
	HolidaySet         string            `json:"holiday_set"`
	InspectionLabel    string            `json:"inspection_label"`
	DocumentTypeSet    string            `json:"document_type_set"`
	Authority          authority         `json:"supervisory_authority"`
}

// authority is the contract's SupervisoryAuthority, as a client reads it.
type authority struct {
	Name map[string]string `json:"name"`
	URL  string            `json:"url"`
}

func TestReferenceCountries(t *testing.T) {
	rec := read(t, "/api/v1/reference/countries", idgen.New())
	expect(t, rec, http.StatusOK, "")
	var body struct {
		Version int64     `json:"version"`
		Items   []country `json:"items"`
	}
	decode(t, rec, &body)
	var codes []string
	for _, c := range body.Items {
		codes = append(codes, c.Code)
	}
	if want := []string{"CZ", "DE", "GB", "PL", "SK"}; body.Version != 1 || !slices.Equal(codes, want) {
		t.Fatalf("version %d, countries %v; want version 1, %v", body.Version, codes, want)
	}
	cz := body.Items[0]
	if want := (country{
		Code: "CZ", Version: 1,
		Name:     map[string]string{"en": "Czechia", "cs": "Česko", "sk": "Česko", "de": "Tschechien", "pl": "Czechy"},
		Currency: "CZK", VATStandardPercent: "21", DefaultUnits: "metric", FirstDayOfWeek: 1,
		HolidaySet: "cz", InspectionLabel: "STK", DocumentTypeSet: "cz",
		Authority: authority{
			Name: map[string]string{
				"en": "Office for Personal Data Protection", "cs": "Úřad pro ochranu osobních údajů",
				"sk": "Úřad pro ochranu osobních údajů", "de": "Úřad pro ochranu osobních údajů", "pl": "Úřad pro ochranu osobních údajů",
			},
			URL: "https://uoou.gov.cz/poradna/chci-podat-stiznost-na-spravce-nebo-zpracovatele",
		},
	}); !reflect.DeepEqual(cz, want) {
		t.Errorf("CZ is %+v, want %+v", cz, want)
	}
}

// Each of the five countries answers its supervisory authority (PRD 05 §3), in the list and on its
// own: the authority's name in every language Household ships, in its own language where another
// has none for it, and the https address of its own page for a complaint. Germany's is the federal
// authority, whose page lists the Länder's.
func TestEveryCountryAnswersItsSupervisoryAuthority(t *testing.T) {
	user := idgen.New()
	rec := read(t, "/api/v1/reference/countries", user)
	expect(t, rec, http.StatusOK, "")
	var body struct {
		Items []country `json:"items"`
	}
	decode(t, rec, &body)
	// Each authority's name in its country's own language and in English, and where its page is.
	want := map[string]struct{ language, own, english, address string }{
		"CZ": {"cs", "Úřad pro ochranu osobních údajů", "Office for Personal Data Protection",
			"https://uoou.gov.cz/poradna/chci-podat-stiznost-na-spravce-nebo-zpracovatele"},
		"DE": {"de", "Der Bundesbeauftragte für den Datenschutz und die Informationsfreiheit",
			"The Federal Commissioner for Data Protection and Freedom of Information",
			"https://www.bfdi.bund.de/DE/Service/Anschriften/Laender/Laender-node.html"},
		"GB": {"en", "Information Commission", "Information Commission", "https://ico.org.uk/make-a-complaint/"},
		"PL": {"pl", "Urząd Ochrony Danych Osobowych", "Personal Data Protection Office", "https://uodo.gov.pl/pl/492/2464"},
		"SK": {"sk", "Úrad na ochranu osobných údajov Slovenskej republiky", "Office for Personal Data Protection of the Slovak Republic",
			"https://dataprotection.gov.sk/sk/dotknute-osoby/konanie-ochrane-osobnych-udajov/"},
	}
	if len(body.Items) != len(want) {
		t.Fatalf("%d countries, want %d", len(body.Items), len(want))
	}
	for _, c := range body.Items {
		w, a := want[c.Code], c.Authority
		if a.Name[w.language] != w.own || a.Name["en"] != w.english || a.URL != w.address {
			t.Errorf("%s names %+v, want %+v", c.Code, a, w)
		}
		for _, language := range []string{"en", "cs", "sk", "de", "pl"} {
			if a.Name[language] == "" {
				t.Errorf("%s's authority has no name in %s: %+v", c.Code, language, a.Name)
			}
		}
		// The country's own read answers the same.
		one := read(t, "/api/v1/reference/countries/"+c.Code, user)
		expect(t, one, http.StatusOK, "")
		var alone country
		decode(t, one, &alone)
		if !reflect.DeepEqual(alone.Authority, a) {
			t.Errorf("%s alone names %+v, and in the list %+v", c.Code, alone.Authority, a)
		}
	}
}

func TestReferenceCountry(t *testing.T) {
	user := idgen.New()
	rec := read(t, "/api/v1/reference/countries/GB", user)
	expect(t, rec, http.StatusOK, "")
	if tag := rec.Header().Get("ETag"); tag != `"1"` {
		t.Errorf("ETag %s, want the profile's version", tag)
	}
	var gb country
	decode(t, rec, &gb)
	if gb.Code != "GB" || gb.Currency != "GBP" || gb.DefaultUnits != "metric" || gb.InspectionLabel != "MOT" || gb.Name["en"] != "United Kingdom" {
		t.Errorf("GB is %+v", gb)
	}

	// A code Household has no profile of, and one the United Kingdom does not have in ISO 3166-1.
	for _, code := range []string{"US", "UK"} {
		expect(t, read(t, "/api/v1/reference/countries/"+code, user), http.StatusNotFound, problem.CodeNotFound)
	}
	// Not a code at all: the edge refuses it against the contract's pattern.
	expect(t, read(t, "/api/v1/reference/countries/gb", user), http.StatusUnprocessableEntity, problem.CodeValidationFailed)
}

func TestReferenceUnits(t *testing.T) {
	rec := read(t, "/api/v1/reference/units", idgen.New())
	expect(t, rec, http.StatusOK, "")
	type conversion struct{ Offset, Numerator, Denominator string }
	var body struct {
		Version    int64 `json:"version"`
		Dimensions []struct {
			Key      string            `json:"key"`
			Name     map[string]string `json:"name"`
			BaseUnit string            `json:"base_unit"`
		} `json:"dimensions"`
		Units []struct {
			Key         string     `json:"key"`
			Dimension   string     `json:"dimension"`
			System      string     `json:"system"`
			Symbol      string     `json:"symbol"`
			CLDR        string     `json:"cldr"`
			ToBase      conversion `json:"to_base"`
			Counterpart *string    `json:"counterpart"`
		} `json:"units"`
	}
	decode(t, rec, &body)
	var dimensions []string
	for _, d := range body.Dimensions {
		dimensions = append(dimensions, d.Key)
	}
	if want := []string{"area", "length", "mass", "temperature", "volume"}; body.Version != 1 || !slices.Equal(dimensions, want) {
		t.Fatalf("version %d, dimensions %v; want version 1, %v", body.Version, dimensions, want)
	}

	// The units by dimension, metric first, each system's from the smallest.
	var length []string
	for _, u := range body.Units {
		if u.Dimension == "length" {
			length = append(length, u.Key)
		}
		switch u.Key {
		case "fahrenheit":
			if want := (conversion{"-32", "5", "9"}); u.ToBase != want || u.Symbol != "°F" || u.System != "imperial" {
				t.Errorf("°F: %+v, want the conversion %+v", u, want)
			}
		case "m3":
			if u.Counterpart != nil {
				t.Errorf("m³ is shown as %s in imperial, want as it is", *u.Counterpart)
			}
		case "km":
			if u.Counterpart == nil || *u.Counterpart != "mi" || u.CLDR != "kilometer" {
				t.Errorf("km: %+v", u)
			}
		}
	}
	if want := []string{"mm", "cm", "m", "km", "in", "ft", "yd", "mi"}; !slices.Equal(length, want) {
		t.Errorf("length units %v, want %v", length, want)
	}
}
