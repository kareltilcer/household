package app_test

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/federation"
	"github.com/kareltilcer/household/server/internal/platform/federation/federationtest"
	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// The tests in this file are of what the web client needs of a provider beside the sign-in itself
// (plan item 25): which providers the server signs in with, and where Apple's answer lands.

// withApple is a site that signs in with Google and with Apple.
func withApple(t *testing.T) *site {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := federation.ParseAppleKey(string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})))
	if err != nil {
		t.Fatal(err)
	}
	idp := federationtest.New(t, "com.household.web", "")
	apple, err := federation.New(federation.Apple, federation.Config{Issuer: idp.Issuer(), ClientID: "com.household.web",
		Apple: &federation.AppleKey{TeamID: "TEAM", KeyID: "KEY", Key: parsed}})
	if err != nil {
		t.Fatal(err)
	}
	google, err := federation.New(federation.Google, federation.Config{Issuer: idp.Issuer(), ClientID: "household-web", ClientSecret: "the-secret"})
	if err != nil {
		t.Fatal(err)
	}
	return newSite(t, apptest.Options{
		Providers:    map[string]*federation.Provider{federation.Google: google, federation.Apple: apple},
		RedirectURIs: []string{redirectURI, apptest.WebURL + "/api/v1" + identity.AppleReturnPath},
	})
}

// providersOf is what getAuthOauth answers b.
func providersOf(t *testing.T, b *browser) []string {
	t.Helper()
	rec := b.send(request{method: http.MethodGet, path: "/auth/oauth", noOrigin: true})
	expect(t, rec, http.StatusOK, "")
	var listed struct {
		Providers []string `json:"providers"`
	}
	decode(t, rec, &listed)
	if listed.Providers == nil {
		t.Fatalf("no list of providers: %s", rec.Body.String())
	}
	return listed.Providers
}

// A client draws a provider's control only where the server signs in with it (FR-ID2): the list is
// what the server is configured for, in one order, and is read before anyone has signed in.
func TestTheConfiguredProvidersAreListedToAnyone(t *testing.T) {
	plain := newSite(t, apptest.Options{})
	if got := providersOf(t, plain.browser()); len(got) != 0 {
		t.Errorf("a server with no provider lists %v", got)
	}
	one, _ := federated(t, apptest.Options{})
	if got := providersOf(t, one.browser()); !slices.Equal(got, []string{federation.Google}) {
		t.Errorf("a server with Google lists %v", got)
	}
	if got := providersOf(t, withApple(t).browser()); !slices.Equal(got, []string{federation.Google, federation.Apple}) {
		t.Errorf("a server with both lists %v", got)
	}
}

// appleForm posts fields to Apple's return route as a page at origin does: a form, with no
// cookie of Household's.
func appleForm(b *browser, origin string, fields url.Values) *httptest.ResponseRecorder {
	return b.send(request{method: http.MethodPost, path: identity.AppleReturnPath, body: fields.Encode(),
		contentType: "application/x-www-form-urlencoded", header: http.Header{"Origin": {origin}}})
}

// fragmentOf is where rec sends the browser, and the fields in that address's fragment.
func fragmentOf(t *testing.T, rec *httptest.ResponseRecorder) (string, url.Values) {
	t.Helper()
	expect(t, rec, http.StatusSeeOther, "")
	to, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	fields, err := url.ParseQuery(to.EscapedFragment())
	if err != nil {
		t.Fatalf("the fragment %q: %v", to.EscapedFragment(), err)
	}
	to.Fragment, to.RawFragment = "", ""
	return to.String(), fields
}

// Apple's page posts its answer to the API, which the static web client cannot receive, and the
// API sends the browser on to the web client with the answer in the fragment, which reaches no
// server: the code and the state, and the name Apple gives once.
func TestApplesFormIsSentOnToTheWebClientInTheFragment(t *testing.T) {
	s := withApple(t)
	b := s.browser()
	const code = "the code/with+signs & more"
	to, fields := fragmentOf(t, appleForm(b, identity.AppleOrigin, url.Values{
		"code": {code}, "state": {"the-state"},
		"user": {`{"name":{"firstName":"Jana","lastName":"Tilcerová"},"email":"jana@example.test"}`},
	}))
	if to != apptest.WebURL+"/sign-in/apple" {
		t.Errorf("sent on to %s", to)
	}
	if fields.Get("code") != code || fields.Get("state") != "the-state" || fields.Get("name") != "Jana Tilcerová" || len(fields) != 3 {
		t.Errorf("the fragment carries %v", fields)
	}
	// Nothing was signed in, and nothing set: the page that holds the verifier completes it.
	if len(b.cookies) != 0 {
		t.Errorf("the return set cookies: %v", b.cookies)
	}

	// A person who turned the sign-in down is sent on too, to be told so, with no code.
	_, refused := fragmentOf(t, appleForm(b, identity.AppleOrigin, url.Values{
		"error": {"user_cancelled_authorize"}, "state": {"the-state"}, "code": {"ignored"}}))
	if refused.Get("error") != "user_cancelled_authorize" || refused.Get("state") != "the-state" || refused.Has("code") {
		t.Errorf("a refusal's fragment carries %v", refused)
	}
	// A name that is none is left out, and the sign-in goes on without it.
	_, unnamed := fragmentOf(t, appleForm(b, identity.AppleOrigin, url.Values{"code": {"c"}, "state": {"s"}, "user": {"not json"}}))
	if unnamed.Has("name") || unnamed.Get("code") != "c" {
		t.Errorf("a form with no name: %v", unnamed)
	}
}

// The return route is the one unsafe route another site's page may post to, and Apple's is the one
// site: any other origin is refused there as it is everywhere, and Apple's is refused everywhere
// else.
func TestOnlyApplesOriginIsAdmittedAndOnlyToItsReturnRoute(t *testing.T) {
	s := withApple(t)
	b := s.browser()
	form := url.Values{"code": {"c"}, "state": {"s"}}
	expect(t, appleForm(b, "https://evil.example", form), http.StatusForbidden, problem.CodeCsrfFailed)
	expect(t, appleForm(b, "https://appleid.apple.com.evil.example", form), http.StatusForbidden, problem.CodeCsrfFailed)
	expect(t, appleForm(b, identity.AppleOrigin, form), http.StatusSeeOther, "")
	// The web client's own origin is on the list for every route, this one among them.
	expect(t, appleForm(b, apptest.WebOrigin, form), http.StatusSeeOther, "")
	expect(t, b.send(request{method: http.MethodPost, path: "/auth/register", header: http.Header{"Origin": {identity.AppleOrigin}},
		body: jsonBody(t, map[string]string{"email": "a@example.test", "password": "correct horse battery", "display_name": "A"})}),
		http.StatusForbidden, problem.CodeCsrfFailed)
}

// A form that answers nothing, or carries more than the contract admits, is refused; so is one
// sent to a server that does not sign in with Apple.
func TestApplesFormIsHeldToTheContract(t *testing.T) {
	s := withApple(t)
	b := s.browser()
	if got := fieldErrorsOf(t, appleForm(b, identity.AppleOrigin, url.Values{"state": {"s"}})); len(got) != 1 || got[0].Field != "" {
		t.Errorf("a form with neither a code nor an error: %v", got)
	}
	long := url.Values{"code": {"c"}, "state": {strings.Repeat("s", 129)}}
	if got := fieldErrorsOf(t, appleForm(b, identity.AppleOrigin, long)); len(got) != 1 || got[0].Field != "/state" {
		t.Errorf("a state too long: %v", got)
	}
	google, _ := federated(t, apptest.Options{})
	expect(t, appleForm(google.browser(), identity.AppleOrigin, url.Values{"code": {"c"}, "state": {"s"}}), http.StatusNotFound, problem.CodeNotFound)
}
