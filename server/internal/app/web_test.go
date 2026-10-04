package app_test

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// webRequest sends a request to w's router as the web client does, with cookies, and the CSRF
// token from them, from the web client's origin.
func (w *world) webRequest(method, path, body string, cookies map[string]string) *httptest.ResponseRecorder {
	w.t.Helper()
	var r *http.Request
	if body != "" {
		r = httptest.NewRequestWithContext(w.t.Context(), method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r = httptest.NewRequestWithContext(w.t.Context(), method, path, nil)
	}
	r.Header.Set("Origin", apptest.WebOrigin)
	for name, value := range cookies {
		r.AddCookie(&http.Cookie{Name: name, Value: value}) //nolint:gosec // G124: a request's cookie is a name and a value; attributes are the response's.
	}
	if csrf, ok := cookies[session.CSRFCookie]; ok {
		r.Header.Set(session.CSRFHeader, csrf)
	}
	return testsupport.ServeContract(w.t, w.contract, w.router, r)
}

// signIn registers address as name and signs in on the web, and returns the account and its
// cookies.
func (w *world) signIn(address, name string) (uuid.UUID, map[string]string) {
	w.t.Helper()
	expect(w.t, w.webRequest(http.MethodPost, "/api/v1/auth/register",
		`{"email":"`+address+`","password":"correct horse battery","display_name":"`+name+`"}`, nil), http.StatusAccepted, "")
	rec := w.webRequest(http.MethodPost, "/api/v1/auth/login",
		`{"email":"`+address+`","password":"correct horse battery","client_type":"web"}`, nil)
	expect(w.t, rec, http.StatusOK, "")
	cookies := map[string]string{}
	for _, c := range rec.Result().Cookies() {
		cookies[c.Name] = c.Value
	}
	var user uuid.UUID
	if err := w.admin.QueryRow(w.t.Context(), "SELECT id FROM users WHERE email = $1", address).Scan(&user); err != nil {
		w.t.Fatal(err)
	}
	return user, cookies
}

// A change a session cookie brings arrives via the web, and its audit event is labelled with the
// member's name as it was when the change was made (item 4's hooks, filled in by item 8).
func TestASessionsChangeArrivesViaTheWebUnderTheMembersName(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	user, cookies := w.signIn("jana@via.test", "Jana Tilcerová")
	w.join(h, user, access.Member, level(access.Contribute))
	it := idgen.New()
	expect(t, w.webRequest(http.MethodPost, items(h), itemBody(it, h), cookies), http.StatusCreated, "")

	var via, label string
	var actor uuid.UUID
	if err := w.admin.QueryRow(t.Context(), "SELECT meta->>'via', actor_label, actor_id FROM audit_events WHERE entity_id = $1", it).
		Scan(&via, &label, &actor); err != nil {
		t.Fatal(err)
	}
	if via != "web" || label != "Jana Tilcerová" || actor != user {
		t.Fatalf("via %q, label %q, actor %s", via, label, actor)
	}

	// Without its CSRF token the same request is refused before it reaches the household.
	delete(cookies, session.CSRFCookie)
	expect(t, w.webRequest(http.MethodPost, items(h), itemBody(idgen.New(), h), cookies), http.StatusForbidden, problem.CodeCsrfFailed)
}

// The server holds a new password to its minimum length itself, not only through the contract's
// edge: the probe's contract, unlike the real one, declares no minimum.
func TestAPasswordIsHeldToItsMinimumLength(t *testing.T) {
	w := newWorld(t)
	rec := w.webRequest(http.MethodPost, "/api/v1/auth/register", `{"email":"short@via.test","password":"eleven char","display_name":"S"}`, nil)
	if got := fieldErrorsOf(t, rec); !slices.Equal(got, []problem.FieldError{{Field: "/password", Code: "min_length"}}) {
		t.Fatalf("%v", got)
	}
}

// A household's members share its API budget; a caller who is not a member spends none of it, and
// another household has its own.
func TestAHouseholdsRequestsAreLimited(t *testing.T) {
	w := newWorld(t, func(d *app.Deps) {
		d.Accounts.HouseholdLimit = ratelimit.NewBuckets(ratelimit.Rate{PerMinute: 1, Burst: 2}, nil)
	})
	h, other := w.household(true), w.household(true)
	jana, petr := w.member(h, access.Member, level(access.View)), w.member(h, access.Member, level(access.View))
	stranger := w.member(other, access.Owner, nil)
	for range 5 {
		expect(t, w.do(http.MethodGet, items(h), stranger, ""), http.StatusNotFound, problem.CodeNotFound)
	}
	expect(t, w.do(http.MethodGet, items(h), jana, ""), http.StatusOK, "")
	expect(t, w.do(http.MethodGet, items(h), petr, ""), http.StatusOK, "")
	rec := w.do(http.MethodGet, items(h), jana, "")
	expect(t, rec, http.StatusTooManyRequests, problem.CodeRateLimited)
	if rec.Header().Get("Retry-After") == "" {
		t.Error("no Retry-After")
	}
	expect(t, w.do(http.MethodGet, items(other), stranger, ""), http.StatusOK, "")

	// A household whose rate the platform raised has a budget in that proportion (PRD 04 §5): six
	// times the requests a minute, and six times the burst.
	raised := w.household(true)
	eva := w.member(raised, access.Owner, nil)
	w.exec(`INSERT INTO household_limits (household_id, key, value, reason, set_by_label)
		VALUES ($1, 'api_rate', 6, 'An integration that polls', 'staff@household.example')`, raised)
	for range 12 {
		expect(t, w.do(http.MethodGet, items(raised), eva, ""), http.StatusOK, "")
	}
	expect(t, w.do(http.MethodGet, items(raised), eva, ""), http.StatusTooManyRequests, problem.CodeRateLimited)
}
