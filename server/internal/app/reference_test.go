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
	}); !reflect.DeepEqual(cz, want) {
		t.Errorf("CZ is %+v, want %+v", cz, want)
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
