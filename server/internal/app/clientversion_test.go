package app_test

import (
	"net/http"
	"testing"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/clientversion"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// Done when (plan item 9): the please-update response. A client older than the oldest of its type
// the server serves is answered 400 update_required, naming that version, whatever it asked for:
// before its request is held to the contract, signed in or not.
func TestAClientBelowTheMinimumIsToldToUpdate(t *testing.T) {
	minimum, _ := clientversion.ParseVersion("1.6.0")
	s := newSite(t, apptest.Options{MinClients: clientversion.Minimums{clientversion.Mobile: minimum}})
	address := s.a("jana@tilcerovi.cz")
	s.browser().register(address, "correct horse battery")
	p := s.phone("")
	p.version = "1.6.0"
	expect(t, p.login(address, "correct horse battery"), http.StatusOK, "")

	p.version = "1.5.9"
	for _, rec := range []struct {
		method, path, body string
	}{
		{http.MethodGet, "/me", ""},
		{http.MethodPost, "/auth/token", `{"refresh_token":"` + p.refresh + `"}`},
		// A body the contract refuses is still answered please-update.
		{http.MethodPost, "/auth/login", `{"not":"a sign-in"}`},
		{http.MethodGet, "/no/such/route", ""},
	} {
		got := p.send(rec.method, rec.path, rec.body, nil)
		expect(t, got, http.StatusBadRequest, problem.CodeUpdateRequired)
		var doc struct {
			Minimum string `json:"minimum_version"`
		}
		decode(t, got, &doc)
		if doc.Minimum != "1.6.0" {
			t.Fatalf("%s %s: %s", rec.method, rec.path, got.Body.String())
		}
	}
	// Its sign-in is untouched, and serves again once the app is updated.
	p.version = "1.7.0-beta.2"
	if p.me() != http.StatusOK {
		t.Fatal("an updated client is refused")
	}
	p.renew()
	var app string
	if err := s.admin.QueryRow(t.Context(), "SELECT app_version FROM devices WHERE id = $1", p.id).Scan(&app); err != nil {
		t.Fatal(err)
	}
	if app != "1.7.0-beta.2" {
		t.Fatalf("the device's version: %q", app)
	}

	// No minimum for the web; a request that names no client is held to none; a header that is not
	// a client's is refused as the edge refuses a header.
	b := s.browser()
	expect(t, b.send(request{method: http.MethodGet, path: "/me", header: http.Header{"Household-Client": {"web/0.0.1"}}}),
		http.StatusUnauthorized, problem.CodeUnauthenticated)
	p.version = ""
	if p.me() != http.StatusOK {
		t.Fatal("a request naming no client was refused")
	}
	for _, bad := range []string{"mobile", "mobile/1.4", "desktop/1.0.0", "mobile/01.0.0"} {
		rec := b.send(request{method: http.MethodGet, path: "/me", header: http.Header{"Household-Client": {bad}}})
		if got := fieldErrorsOf(t, rec); len(got) != 1 || got[0] != (problem.FieldError{Field: "header:Household-Client", Code: problem.FieldMalformed}) {
			t.Fatalf("%q: %v", bad, got)
		}
	}
}
