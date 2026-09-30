package app_test

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/health"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/password"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// The tests in this file serve the account surfaces of item 8 through the whole router, against
// the committed contract, as a browser would call them: from the web client's origin, keeping the
// cookies it is given and sending the CSRF token back.

// breached is a password the tests' breached-password corpus holds.
const breached = "password1234"

// clock is a time a test moves by hand, for the sessions and the throttles.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// site is one test's server and what it sent.
type site struct {
	t      *testing.T
	router *chi.Mux
	admin  *pgxpool.Pool
	outbox *apptest.Outbox
	clock  *clock
	// domain, peer and other are this test's own: its addresses end in the first, its browsers come
	// from the second, and the third is another network, for a limit one network has used up.
	domain, peer, other string
}

// newSite is a site whose surfaces o adjusts, and whose router each of options adjusts further.
func newSite(t *testing.T, o apptest.Options, options ...func(*app.Deps)) *site {
	t.Helper()
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	d := testsupport.Open(t)
	pool := d.Pool(t, db.RoleApp)
	log := logging.New(io.Discard, slog.LevelDebug)
	clk := &clock{t: time.Now().UTC().Truncate(time.Second)}
	o.Now = clk.now
	o.Breached = append(o.Breached, breached)
	accounts, outbox := apptest.Accounts(t, pool, log, o)
	deps := app.Deps{
		Logger: log, Contract: c, Health: health.New(log, time.Second),
		Pool: pool, MaxBodyBytes: 1 << 16, Accounts: accounts,
		Households: apptest.Households(t, pool, log, accounts, outbox, o),
		Sync:       apptest.Sync(t, log, o),
	}
	for _, option := range options {
		option(&deps)
	}
	r, err := app.NewRouter(deps)
	if err != nil {
		t.Fatal(err)
	}
	n := sites.Add(1)
	return &site{t: t, router: r, admin: d.Pool(t, ""), outbox: outbox, clock: clk,
		domain: fmt.Sprintf("site%d.test", n), peer: fmt.Sprintf("198.51.%d.%d:4000", n/256, n%256),
		other: fmt.Sprintf("198.18.%d.%d:5000", n/256, n%256)}
}

// sites counts the sites the package's tests made, so that each has addresses and networks of
// its own: the tests share one database, where the accounts and the throttles of one test, or of
// an earlier run of it, would otherwise meet the next one's.
var sites atomic.Int64

// host is addr, host:port, without its port.
func host(addr string) string {
	h, _, _ := net.SplitHostPort(addr)
	return h
}

// a is address as this test's own: the same mailbox, at a domain no other test uses.
func (s *site) a(address string) string { return address + "." + s.domain }

// browser is a web client: the cookies it holds, and where it says it is.
type browser struct {
	s       *site
	cookies map[string]string
	peer    string
}

func (s *site) browser() *browser {
	return &browser{s: s, cookies: map[string]string{}, peer: s.peer}
}

// request is one request a browser sends: from the web client's origin, with its cookies, and
// with the CSRF token when it holds one, unless the test says otherwise.
type request struct {
	method, path, body string
	header             http.Header
	noOrigin, noCSRF   bool
}

func (b *browser) send(req request) *httptest.ResponseRecorder {
	b.s.t.Helper()
	var body io.Reader
	if req.body != "" {
		body = strings.NewReader(req.body)
	}
	r := httptest.NewRequestWithContext(b.s.t.Context(), req.method, "/api/v1"+req.path, body)
	r.RemoteAddr = b.peer
	if req.body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	if !req.noOrigin {
		r.Header.Set("Origin", apptest.WebOrigin)
	}
	for _, name := range slices.Sorted(maps.Keys(b.cookies)) {
		r.AddCookie(&http.Cookie{Name: name, Value: b.cookies[name]}) //nolint:gosec // G124: a request's cookie is a name and a value; attributes are the response's.
	}
	if csrf, ok := b.cookies[session.CSRFCookie]; ok && !req.noCSRF {
		r.Header.Set(session.CSRFHeader, csrf)
	}
	for key, values := range req.header {
		r.Header.Del(key)
		for _, v := range values {
			r.Header.Add(key, v)
		}
	}
	rec := testsupport.Serve(b.s.t, b.s.router, r)
	for _, c := range rec.Result().Cookies() {
		if c.MaxAge < 0 {
			delete(b.cookies, c.Name)
		} else {
			b.cookies[c.Name] = c.Value
		}
	}
	return rec
}

func (b *browser) post(path, body string) *httptest.ResponseRecorder {
	b.s.t.Helper()
	return b.send(request{method: http.MethodPost, path: path, body: body})
}

func (b *browser) get(path string) *httptest.ResponseRecorder {
	b.s.t.Helper()
	return b.send(request{method: http.MethodGet, path: path})
}

func jsonBody(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// register registers address with pw, as Jana, and expects 202.
func (b *browser) register(address, pw string) {
	b.s.t.Helper()
	rec := b.post("/auth/register", jsonBody(b.s.t, map[string]string{"email": address, "password": pw, "display_name": "Jana"}))
	expect(b.s.t, rec, http.StatusAccepted, "")
}

// login signs in and expects to.
func (b *browser) login(address, pw string) meBody {
	b.s.t.Helper()
	rec := b.post("/auth/login", jsonBody(b.s.t, map[string]string{"email": address, "password": pw, "client_type": "web"}))
	expect(b.s.t, rec, http.StatusOK, "")
	var result struct {
		User   meBody          `json:"user"`
		Tokens json.RawMessage `json:"tokens"`
	}
	decode(b.s.t, rec, &result)
	if string(result.Tokens) != "null" {
		b.s.t.Fatalf("a web sign-in answered tokens %s", result.Tokens)
	}
	return result.User
}

// signUp registers address and signs in.
func (s *site) signUp(address, pw string) *browser {
	s.t.Helper()
	b := s.browser()
	b.register(address, pw)
	b.login(address, pw)
	return b
}

// meBody is the contract's Me, as a client reads it.
type meBody struct {
	ID             uuid.UUID `json:"id"`
	Email          *string   `json:"email"`
	EmailVerified  bool      `json:"email_verified"`
	DisplayName    string    `json:"display_name"`
	AvatarURL      *string   `json:"avatar_url"`
	Locale         string    `json:"locale"`
	Timezone       *string   `json:"timezone"`
	FirstDayOfWeek *int      `json:"first_day_of_week"`
	IsChild        bool      `json:"is_child"`
	MFAEnabled     bool      `json:"mfa_enabled"`
	Credentials    []string  `json:"credentials"`
}

func (b *browser) me() meBody {
	b.s.t.Helper()
	rec := b.get("/me")
	expect(b.s.t, rec, http.StatusOK, "")
	var me meBody
	decode(b.s.t, rec, &me)
	return me
}

var tokenInLink = regexp.MustCompile(`#token=([A-Za-z0-9_-]+)`)

// token returns the token in the link of the last message to address, and that message.
func (s *site) token(address string) (string, mail.Message) {
	s.t.Helper()
	messages := s.outbox.To(address)
	if len(messages) == 0 {
		s.t.Fatalf("no message to %s", address)
	}
	m := messages[len(messages)-1]
	match := tokenInLink.FindStringSubmatch(m.Body)
	if match == nil {
		s.t.Fatalf("no token in the message to %s: %q", address, m.Body)
	}
	return match[1], m
}

// shape is what a response shows a caller who is not the account's: its status, the names of
// its headers, and its body with the request's own id taken out.
func shape(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	names := slices.Sorted(maps.Keys(rec.Header()))
	body := rec.Body.String()
	if body != "" {
		var doc map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
			t.Fatal(err)
		}
		delete(doc, "request_id")
		body = jsonBody(t, doc)
	}
	return fmt.Sprintf("%d %v %s", rec.Code, names, body)
}

func fieldErrorsOf(t *testing.T, rec *httptest.ResponseRecorder) []problem.FieldError {
	t.Helper()
	expect(t, rec, http.StatusUnprocessableEntity, problem.CodeValidationFailed)
	var doc struct {
		Errors []problem.FieldError `json:"errors"`
	}
	decode(t, rec, &doc)
	return doc.Errors
}

func (s *site) count(sql string, args ...any) int {
	s.t.Helper()
	var n int
	if err := s.admin.QueryRow(s.t.Context(), sql, args...).Scan(&n); err != nil {
		s.t.Fatal(err)
	}
	return n
}

// An address that has an account and one that does not get the same answer, in the same shape,
// and the mail differs (D-13): a link to verify a new address, and a note to the existing one's
// owner, whose account is left as it was.
func TestRegisteringAnswersAlikeWhetherOrNotTheAddressHasAnAccount(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.browser()
	first := b.post("/auth/register", jsonBody(t, map[string]string{
		"email": s.a("jana@tilcerovi.cz"), "password": "correct horse battery", "display_name": "  Jana Tilcerová ",
	}))
	again := b.post("/auth/register", jsonBody(t, map[string]string{
		"email": s.a("JANA@Tilcerovi.cz"), "password": "another long passphrase", "display_name": "Mallory",
	}))
	expect(t, first, http.StatusAccepted, "")
	if shape(t, first) != shape(t, again) || first.Body.Len() != 0 {
		t.Fatalf("a new address answered %s, an existing one %s", shape(t, first), shape(t, again))
	}
	if n := s.count("SELECT count(*) FROM users WHERE lower(email) = $1", s.a("jana@tilcerovi.cz")); n != 1 {
		t.Fatalf("%d accounts for one address", n)
	}

	messages := s.outbox.To(s.a("jana@tilcerovi.cz"))
	if len(messages) != 2 || s.outbox.Len() != 2 {
		t.Fatalf("%d messages to the address, %d in all", len(messages), s.outbox.Len())
	}
	if messages[0].Subject != "Confirm your email address for Household" ||
		!strings.Contains(messages[0].Body, apptest.WebURL+"/verify-email#token=") {
		t.Errorf("the new address's message: %+v", messages[0])
	}
	if messages[1].Subject != "You already have a Household account" || !strings.Contains(messages[1].Body, apptest.WebURL+"/sign-in") ||
		strings.Contains(messages[1].Body, "#token=") {
		t.Errorf("the existing address's message: %+v", messages[1])
	}

	// The account is the first registration's, name trimmed, and its password is the first one.
	me := s.browser().login(s.a("jana@tilcerovi.cz"), "correct horse battery")
	if me.DisplayName != "Jana Tilcerová" || me.EmailVerified || me.Locale != "en" || !slices.Equal(me.Credentials, []string{"password"}) {
		t.Fatalf("%+v", me)
	}
	expect(t, s.browser().post("/auth/login", jsonBody(t, map[string]string{
		"email": s.a("jana@tilcerovi.cz"), "password": "another long passphrase", "client_type": "web",
	})), http.StatusUnauthorized, problem.CodeInvalidCredentials)
}

// A registration names its language, or takes the first of the browser's that Household ships,
// and its email is in that language.
func TestARegistrationsLanguageIsItsEmails(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.browser()
	expect(t, b.send(request{method: http.MethodPost, path: "/auth/register",
		body:   jsonBody(t, map[string]string{"email": s.a("petr@example.com"), "password": "correct horse battery", "display_name": "Petr"}),
		header: http.Header{"Accept-Language": {"fr-FR, de-AT;q=0.9, cs;q=0.5"}}}), http.StatusAccepted, "")
	b.register(s.a("milos@example.com"), "correct horse battery")
	expect(t, b.post("/auth/register", jsonBody(t, map[string]any{
		"email": s.a("adam@example.com"), "password": "correct horse battery", "display_name": "Adam", "locale": "cs-cz",
	})), http.StatusAccepted, "")
	for address, want := range map[string]string{
		s.a("petr@example.com"):  "Bestätigen Sie Ihre E-Mail-Adresse für Household",
		s.a("milos@example.com"): "Confirm your email address for Household",
		s.a("adam@example.com"):  "Potvrďte svou e-mailovou adresu v aplikaci Household",
	} {
		if got := s.outbox.To(address); len(got) != 1 || got[0].Subject != want {
			t.Errorf("%s: %+v", address, got)
		}
	}
	if me := s.browser().login(s.a("adam@example.com"), "correct horse battery"); me.Locale != "cs-CZ" {
		t.Errorf("a locale is kept in its canonical form: %q", me.Locale)
	}
}

func TestARegistrationIsChecked(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.browser()
	for name, tc := range map[string]struct {
		body map[string]any
		want []problem.FieldError
	}{
		"a breached password": {map[string]any{"email": s.a("a@example.com"), "password": breached, "display_name": "A"},
			[]problem.FieldError{{Field: "/password", Code: problem.FieldInvalid}}},
		"a short password": {map[string]any{"email": s.a("a@example.com"), "password": "short", "display_name": "A"},
			[]problem.FieldError{{Field: "/password", Code: "min_length"}}},
		"a blank name": {map[string]any{"email": s.a("a@example.com"), "password": "correct horse battery", "display_name": "   "},
			[]problem.FieldError{{Field: "/display_name", Code: problem.FieldInvalid}}},
		"a name with a line break": {map[string]any{"email": s.a("a@example.com"), "password": "correct horse battery", "display_name": "A\nB"},
			[]problem.FieldError{{Field: "/display_name", Code: problem.FieldInvalid}}},
		"a name with a line separator": {map[string]any{"email": s.a("a@example.com"), "password": "correct horse battery", "display_name": "A B"},
			[]problem.FieldError{{Field: "/display_name", Code: problem.FieldInvalid}}},
		"a name turned around": {map[string]any{"email": s.a("a@example.com"), "password": "correct horse battery", "display_name": string(rune(0x202e)) + "anaJ"},
			[]problem.FieldError{{Field: "/display_name", Code: problem.FieldInvalid}}},
		"no language": {map[string]any{"email": s.a("a@example.com"), "password": "correct horse battery", "display_name": "A", "locale": "not a tag"},
			[]problem.FieldError{{Field: "/locale", Code: problem.FieldMalformed}}},
		"a private-use tag": {map[string]any{"email": s.a("a@example.com"), "password": "correct horse battery", "display_name": "A", "locale": "x-home"},
			[]problem.FieldError{{Field: "/locale", Code: problem.FieldMalformed}}},
		"a language only guessed": {map[string]any{"email": s.a("a@example.com"), "password": "correct horse battery", "display_name": "A", "locale": "und-CZ"},
			[]problem.FieldError{{Field: "/locale", Code: problem.FieldMalformed}}},
		"no address": {map[string]any{"email": "Jana <a@example.com>", "password": "correct horse battery", "display_name": "A"},
			[]problem.FieldError{{Field: "/email", Code: "format"}}},
	} {
		t.Run(name, func(t *testing.T) {
			got := fieldErrorsOf(t, b.post("/auth/register", jsonBody(t, tc.body)))
			if !slices.Equal(got, tc.want) {
				t.Fatalf("%v, want %v", got, tc.want)
			}
		})
	}
	if n := s.count("SELECT count(*) FROM users WHERE email LIKE $1", "%"+s.domain); n != 0 || s.outbox.Len() != 0 {
		t.Fatalf("a refused registration made %d accounts and sent %d messages", n, s.outbox.Len())
	}
}

// A link verifies its address once, within its 24 hours. Opened again it still answers 204 while
// the address it verified stands; a link past its time, or spent on an address the account no
// longer has, answers 410, and a link nobody was sent 404.
func TestALinkVerifiesItsAddress(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.browser()
	b.register(s.a("jana@tilcerovi.cz"), "correct horse battery")
	token, _ := s.token(s.a("jana@tilcerovi.cz"))
	verify := func(token string) *httptest.ResponseRecorder {
		return s.browser().post("/auth/verify-email", jsonBody(t, map[string]string{"token": token}))
	}
	expect(t, verify(token), http.StatusNoContent, "")
	if !b.loginAndMe(s.a("jana@tilcerovi.cz"), "correct horse battery").EmailVerified {
		t.Fatal("the address is not verified")
	}
	expect(t, verify(token), http.StatusNoContent, "")
	expect(t, verify("no-such-token"), http.StatusNotFound, problem.CodeNotFound)

	s.browser().post("/auth/verify-email/resend", jsonBody(t, map[string]string{"email": s.a("petr@example.com")}))
	b.register(s.a("petr@example.com"), "correct horse battery")
	late, _ := s.token(s.a("petr@example.com"))
	s.clock.advance(VerifyFor + time.Second)
	expect(t, verify(late), http.StatusGone, problem.CodeTokenExpired)

	// The address changed since the link was spent: the link is spent, not a verification.
	if _, err := s.admin.Exec(t.Context(), "UPDATE users SET email = $1, email_verified_at = NULL WHERE email = $2",
		s.a("jana@example.com"), s.a("jana@tilcerovi.cz")); err != nil {
		t.Fatal(err)
	}
	expect(t, verify(token), http.StatusGone, problem.CodeTokenAlreadyUsed)
}

// VerifyFor is how long a verification link works.
const VerifyFor = 24 * time.Hour

func (b *browser) loginAndMe(address, pw string) meBody {
	b.s.t.Helper()
	b.login(address, pw)
	return b.me()
}

// A resend answers 202 alike for an unverified account, a verified one and no account at all, and
// only the first gets mail; an address may ask once a minute and five times an hour.
func TestAResendMailsOnlyAnUnverifiedAddress(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.browser()
	b.register(s.a("jana@tilcerovi.cz"), "correct horse battery")
	b.register(s.a("petr@example.com"), "correct horse battery")
	token, _ := s.token(s.a("petr@example.com"))
	expect(t, b.post("/auth/verify-email", jsonBody(t, map[string]string{"token": token})), http.StatusNoContent, "")

	resend := func(address string) *httptest.ResponseRecorder {
		return b.post("/auth/verify-email/resend", jsonBody(t, map[string]string{"email": address}))
	}
	unverified, verified, nobody := resend(s.a("Jana@Tilcerovi.cz")), resend(s.a("petr@example.com")), resend(s.a("nobody@example.com"))
	expect(t, unverified, http.StatusAccepted, "")
	if shape(t, unverified) != shape(t, verified) || shape(t, verified) != shape(t, nobody) {
		t.Fatalf("%s / %s / %s", shape(t, unverified), shape(t, verified), shape(t, nobody))
	}
	if len(s.outbox.To(s.a("jana@tilcerovi.cz"))) != 2 || len(s.outbox.To(s.a("petr@example.com"))) != 1 || len(s.outbox.To(s.a("nobody@example.com"))) != 0 {
		t.Fatalf("messages: jana %d, petr %d, nobody %d", len(s.outbox.To(s.a("jana@tilcerovi.cz"))),
			len(s.outbox.To(s.a("petr@example.com"))), len(s.outbox.To(s.a("nobody@example.com"))))
	}
	// Both links work: a resend does not undo the one before it.
	second, _ := s.token(s.a("jana@tilcerovi.cz"))
	expect(t, b.post("/auth/verify-email", jsonBody(t, map[string]string{"token": second})), http.StatusNoContent, "")

	again := resend(s.a("jana@tilcerovi.cz"))
	expect(t, again, http.StatusTooManyRequests, problem.CodeRateLimited)
	if again.Header().Get("Retry-After") != "60" {
		t.Errorf("Retry-After %q, want 60", again.Header().Get("Retry-After"))
	}
	for range 4 {
		s.clock.advance(time.Minute)
		expect(t, resend(s.a("nobody@example.com")), http.StatusAccepted, "")
	}
	s.clock.advance(time.Minute)
	expect(t, resend(s.a("nobody@example.com")), http.StatusTooManyRequests, problem.CodeRateLimited)
}

// A web sign-in sets the session cookie and the readable CSRF cookie, each as the contract
// describes it, and answers the user with no tokens.
func TestAWebSignInSetsTheSessionCookies(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.browser()
	b.register(s.a("jana@tilcerovi.cz"), "correct horse battery")
	rec := b.post("/auth/login", jsonBody(t, map[string]string{
		"email": s.a("JANA@tilcerovi.cz"), "password": "correct horse battery", "client_type": "web",
	}))
	expect(t, rec, http.StatusOK, "")
	cookies := map[string]*http.Cookie{}
	for _, c := range rec.Result().Cookies() {
		cookies[c.Name] = c
	}
	sess, csrf := cookies[session.Cookie], cookies[session.CSRFCookie]
	if sess == nil || !sess.HttpOnly || !sess.Secure || sess.SameSite != http.SameSiteLaxMode || sess.Path != "/" ||
		sess.Domain != "" || sess.MaxAge != int((30*24*time.Hour).Seconds()) || len(sess.Value) < 40 {
		t.Fatalf("session cookie %+v", sess)
	}
	if csrf == nil || csrf.HttpOnly || !csrf.Secure || csrf.SameSite != http.SameSiteLaxMode || csrf.Path != "/" || csrf.Value == sess.Value {
		t.Fatalf("CSRF cookie %+v", csrf)
	}
	if n := s.count("SELECT count(*) FROM sessions WHERE token_hash = $1", session.Hash(sess.Value)); n != 1 {
		t.Fatal("the session is not kept by its token's hash")
	}
	if me := b.me(); me.Email == nil || *me.Email != s.a("jana@tilcerovi.cz") {
		t.Fatalf("%+v", me)
	}
	// A native client's sign-in names its device.
	if got := fieldErrorsOf(t, b.post("/auth/login", jsonBody(t, map[string]string{
		"email": s.a("jana@tilcerovi.cz"), "password": "correct horse battery", "client_type": "mobile",
	}))); !slices.Equal(got, []problem.FieldError{{Field: "/device", Code: "required"}}) {
		t.Fatalf("%v", got)
	}
}

// Signing in again from a browser that holds a session ends that session: its cookie is replaced.
func TestSigningInAgainEndsTheBrowsersSession(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.signUp(s.a("jana@tilcerovi.cz"), "correct horse battery")
	old := b.cookies[session.Cookie]
	b.login(s.a("jana@tilcerovi.cz"), "correct horse battery")
	if n := s.count("SELECT count(*) FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL", session.Hash(old)); n != 0 {
		t.Fatal("the replaced session is still live")
	}
	stale := s.browser()
	stale.cookies[session.Cookie] = old
	expect(t, stale.get("/me"), http.StatusUnauthorized, problem.CodeUnauthenticated)
}

// Every failed sign-in is one answer, whatever failed (FR-ID3): a wrong password, an address with
// no account, and an account with no password.
func TestFailedSignInsAreAlike(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.browser()
	b.register(s.a("jana@tilcerovi.cz"), "correct horse battery")
	if _, err := s.admin.Exec(t.Context(), "INSERT INTO users (id, email, display_name) VALUES ($1, $2, 'N')", uuid.New(), s.a("nopassword@example.com")); err != nil {
		t.Fatal(err)
	}
	var shapes []string
	for _, address := range []string{s.a("jana@tilcerovi.cz"), s.a("nobody@example.com"), s.a("nopassword@example.com")} {
		rec := b.post("/auth/login", jsonBody(t, map[string]string{"email": address, "password": "wrong password here", "client_type": "web"}))
		expect(t, rec, http.StatusUnauthorized, problem.CodeInvalidCredentials)
		if len(rec.Result().Cookies()) != 0 {
			t.Fatal("a failed sign-in set a cookie")
		}
		shapes = append(shapes, shape(t, rec))
	}
	if shapes[0] != shapes[1] || shapes[1] != shapes[2] {
		t.Fatalf("failures differ:\n%s", strings.Join(shapes, "\n"))
	}
}

// Ten failures in fifteen minutes cool an address down, whether or not it has an account, and the
// right password waits too; the cooldown lengthens with each failure after it, and a sign-in once
// it is over clears it.
func TestSignInFailuresCoolAnAddressDown(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.browser()
	b.register(s.a("jana@tilcerovi.cz"), "correct horse battery")
	attempt := func(address, pw string) *httptest.ResponseRecorder {
		return b.post("/auth/login", jsonBody(t, map[string]string{"email": address, "password": pw, "client_type": "web"}))
	}
	for _, address := range []string{s.a("jana@tilcerovi.cz"), s.a("nobody@example.com")} {
		for range 10 {
			expect(t, attempt(address, "wrong password here"), http.StatusUnauthorized, problem.CodeInvalidCredentials)
		}
	}
	right, nobody := attempt(s.a("jana@tilcerovi.cz"), "correct horse battery"), attempt(s.a("nobody@example.com"), "correct horse battery")
	expect(t, right, http.StatusTooManyRequests, problem.CodeRateLimited)
	if shape(t, right) != shape(t, nobody) || right.Header().Get("Retry-After") != "60" {
		t.Fatalf("an account's cooldown %s (%s), no account's %s", shape(t, right), right.Header().Get("Retry-After"), shape(t, nobody))
	}
	s.clock.advance(time.Minute)
	expect(t, attempt(s.a("jana@tilcerovi.cz"), "wrong password here"), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	if rec := attempt(s.a("jana@tilcerovi.cz"), "correct horse battery"); rec.Header().Get("Retry-After") != "120" {
		t.Fatalf("the cooldown after the eleventh failure: %d %s", rec.Code, rec.Header().Get("Retry-After"))
	}
	s.clock.advance(2 * time.Minute)
	b.login(s.a("jana@tilcerovi.cz"), "correct horse battery")
	expect(t, attempt(s.a("jana@tilcerovi.cz"), "wrong password here"), http.StatusUnauthorized, problem.CodeInvalidCredentials)
}

// Sign-ins sent at once meet the limit one by one: of twenty-five wrong guesses at an address sent
// together, ten have their password checked, and the rest wait out the cooldown the tenth began.
func TestSignInsSentAtOnceAreCountedOneByOne(t *testing.T) {
	s := newSite(t, apptest.Options{})
	s.browser().register(s.a("jana@tilcerovi.cz"), "correct horse battery")
	body := jsonBody(t, map[string]string{"email": s.a("jana@tilcerovi.cz"), "password": "wrong password here", "client_type": "web"})
	var checked, refused atomic.Int32
	var wg sync.WaitGroup
	for range 25 {
		b := s.browser()
		wg.Go(func() {
			switch rec := b.post("/auth/login", body); rec.Code {
			case http.StatusUnauthorized:
				checked.Add(1)
			case http.StatusTooManyRequests:
				refused.Add(1)
			default:
				t.Errorf("%d %s", rec.Code, rec.Body)
			}
		})
	}
	wg.Wait()
	if int(checked.Load()) != ratelimit.LoginAccount.Max || int(refused.Load()) != 25-ratelimit.LoginAccount.Max {
		t.Fatalf("%d checked and %d refused, want %d checked", checked.Load(), refused.Load(), ratelimit.LoginAccount.Max)
	}
}

// Sixty failures from one network in fifteen minutes stop its sign-ins, whichever addresses they
// named, and a sign-in that succeeds is not one of them; another network signs in.
func TestSignInFailuresCoolANetworkDown(t *testing.T) {
	s := newSite(t, apptest.Options{})
	s.browser().register(s.a("jana@tilcerovi.cz"), "correct horse battery")
	b := s.browser()
	guess := func(i int) {
		t.Helper()
		rec := b.post("/auth/login", jsonBody(t, map[string]string{"email": s.a(fmt.Sprintf("guess%d@example.com", i)), "password": "wrong password here", "client_type": "web"}))
		expect(t, rec, http.StatusUnauthorized, problem.CodeInvalidCredentials)
	}
	for i := range ratelimit.LoginNetwork.Max - 1 {
		guess(i)
	}
	for range 3 {
		b.login(s.a("jana@tilcerovi.cz"), "correct horse battery")
	}
	guess(ratelimit.LoginNetwork.Max - 1)
	expect(t, b.post("/auth/login", jsonBody(t, map[string]string{
		"email": s.a("jana@tilcerovi.cz"), "password": "correct horse battery", "client_type": "web",
	})), http.StatusTooManyRequests, problem.CodeRateLimited)
	other := s.browser()
	other.peer = s.other
	other.login(s.a("jana@tilcerovi.cz"), "correct horse battery")
}

// A network registers five times an hour; a registration refused for its password is not one.
func TestRegistrationsFromANetworkAreLimited(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.browser()
	for range 3 {
		fieldErrorsOf(t, b.post("/auth/register", jsonBody(t, map[string]string{"email": s.a("user@example.com"), "password": breached, "display_name": "U"})))
	}
	for i := range 5 {
		b.register(s.a(fmt.Sprintf("user%d@example.com", i)), "correct horse battery")
	}
	rec := b.post("/auth/register", jsonBody(t, map[string]string{"email": s.a("user5@example.com"), "password": "correct horse battery", "display_name": "U"}))
	expect(t, rec, http.StatusTooManyRequests, problem.CodeRateLimited)
	if rec.Header().Get("Retry-After") != "3600" {
		t.Errorf("Retry-After %q", rec.Header().Get("Retry-After"))
	}
}

// A network asks for twenty resets and twenty resends an hour, whichever addresses it names, so
// that one client naming a new address each time cannot fill the queue every email waits in
// (D-96); another network has a budget of its own.
func TestResetsAndResendsFromANetworkAreLimited(t *testing.T) {
	s := newSite(t, apptest.Options{})
	for _, surface := range []struct {
		path  string
		limit ratelimit.Limit
	}{{"/auth/password-reset", ratelimit.ResetNetwork}, {"/auth/verify-email/resend", ratelimit.ResendNetwork}} {
		ask := func(b *browser, i int) *httptest.ResponseRecorder {
			t.Helper()
			return b.post(surface.path, jsonBody(t, map[string]string{"email": s.a(fmt.Sprintf("user%d@example.com", i))}))
		}
		b := s.browser()
		for i := range surface.limit.Max {
			expect(t, ask(b, i), http.StatusAccepted, "")
		}
		rec := ask(b, surface.limit.Max)
		expect(t, rec, http.StatusTooManyRequests, problem.CodeRateLimited)
		if rec.Header().Get("Retry-After") != "3600" {
			t.Errorf("%s: Retry-After %q", surface.path, rec.Header().Get("Retry-After"))
		}
		other := s.browser()
		other.peer = s.other
		expect(t, ask(other, surface.limit.Max), http.StatusAccepted, "")
	}
}

// An unsafe request the session cookie authenticates needs its session's CSRF token, in the
// header and the cookie alike, from the web client's origin; a safe one needs neither. An unsafe
// request from another origin is refused whatever it carries, and one that names no origin and
// carries no session, a native client's, is not.
func TestCSRF(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.signUp(s.a("jana@tilcerovi.cz"), "correct horse battery")
	rename := func(req request) *httptest.ResponseRecorder {
		req.method, req.path, req.body = http.MethodPatch, "/me", `{"display_name":"Jana T."}`
		return b.send(req)
	}
	expect(t, rename(request{noCSRF: true}), http.StatusForbidden, problem.CodeCsrfFailed)
	expect(t, rename(request{header: http.Header{session.CSRFHeader: {"forged"}}}), http.StatusForbidden, problem.CodeCsrfFailed)
	expect(t, rename(request{noOrigin: true}), http.StatusForbidden, problem.CodeCsrfFailed)
	expect(t, rename(request{header: http.Header{"Origin": {"https://evil.example"}}}), http.StatusForbidden, problem.CodeCsrfFailed)
	expect(t, rename(request{noOrigin: true, header: http.Header{"Referer": {apptest.WebURL + "/account"}}}), http.StatusOK, "")

	// A matching pair planted by another site is not the session's token.
	planted := s.browser()
	planted.cookies[session.Cookie] = b.cookies[session.Cookie]
	planted.cookies[session.CSRFCookie] = "planted"
	expect(t, planted.send(request{method: http.MethodPatch, path: "/me", body: `{"display_name":"X"}`}), http.StatusForbidden, problem.CodeCsrfFailed)

	expect(t, b.send(request{method: http.MethodGet, path: "/me", noCSRF: true, noOrigin: true}), http.StatusOK, "")
	expect(t, rename(request{}), http.StatusOK, "")
	if me := b.me(); me.DisplayName != "Jana T." {
		t.Fatalf("%+v", me)
	}

	fresh := s.browser()
	expect(t, fresh.send(request{method: http.MethodPost, path: "/auth/register", header: http.Header{"Origin": {"https://evil.example"}},
		body: jsonBody(t, map[string]string{"email": s.a("petr@example.com"), "password": "correct horse battery", "display_name": "P"})}),
		http.StatusForbidden, problem.CodeCsrfFailed)
	expect(t, fresh.send(request{method: http.MethodPost, path: "/auth/register", noOrigin: true,
		body: jsonBody(t, map[string]string{"email": s.a("petr@example.com"), "password": "correct horse battery", "display_name": "P"})}),
		http.StatusAccepted, "")
}

// A session lasts 30 days from its last use, however long it has been kept in use (D-95), and a
// use slides it at most once an hour.
func TestASessionSlidesWithUse(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.signUp(s.a("jana@tilcerovi.cz"), "correct horse battery")
	lastSeen := func() time.Time {
		var at time.Time
		if err := s.admin.QueryRow(t.Context(), "SELECT last_seen_at FROM sessions WHERE token_hash = $1", session.Hash(b.cookies[session.Cookie])).Scan(&at); err != nil {
			t.Fatal(err)
		}
		return at
	}
	signedIn := lastSeen()
	s.clock.advance(30 * time.Minute)
	if rec := b.get("/me"); rec.Code != http.StatusOK || len(rec.Result().Cookies()) != 0 || !lastSeen().Equal(signedIn) {
		t.Fatalf("a use within the hour slid the session: %d, cookies %v", rec.Code, rec.Result().Cookies())
	}
	for range 3 {
		s.clock.advance(29 * 24 * time.Hour)
		rec := b.get("/me")
		expect(t, rec, http.StatusOK, "")
		if len(rec.Result().Cookies()) != 2 || !lastSeen().Equal(s.clock.now()) {
			t.Fatalf("a use a day before expiry did not slide the session: cookies %v", rec.Result().Cookies())
		}
	}
	s.clock.advance(30*24*time.Hour + time.Second)
	expect(t, b.get("/me"), http.StatusUnauthorized, problem.CodeUnauthenticated)
}

// Signing out ends the session and drops its cookies. A repeat whose first answer was lost comes
// from the ended session, and answers 401 as everything from it does.
func TestSigningOut(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.signUp(s.a("jana@tilcerovi.cz"), "correct horse battery")
	token, csrf := b.cookies[session.Cookie], b.cookies[session.CSRFCookie]
	logout := func() *httptest.ResponseRecorder {
		return b.send(request{method: http.MethodPost, path: "/auth/logout", header: http.Header{"Idempotency-Key": {"logout-1"}}})
	}
	expect(t, logout(), http.StatusNoContent, "")
	if _, ok := b.cookies[session.Cookie]; ok {
		t.Fatal("the session cookie was not dropped")
	}
	b.cookies[session.Cookie], b.cookies[session.CSRFCookie] = token, csrf
	expect(t, logout(), http.StatusUnauthorized, problem.CodeUnauthenticated)
	expect(t, b.get("/me"), http.StatusUnauthorized, problem.CodeUnauthenticated)
	expect(t, s.browser().post("/auth/logout", ""), http.StatusUnauthorized, problem.CodeUnauthenticated)
}

// A reset is asked for alike whether or not the address has an account, and mails only one that
// has; its link, once, within its hour, sets the password, verifies the address, ends every
// session and every other reset link, and is confirmed by email.
func TestAPasswordReset(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.signUp(s.a("jana@tilcerovi.cz"), "correct horse battery")
	other := s.browser()
	other.login(s.a("jana@tilcerovi.cz"), "correct horse battery")

	ask := func(address string) *httptest.ResponseRecorder {
		return s.browser().post("/auth/password-reset", jsonBody(t, map[string]string{"email": address}))
	}
	known, unknown := ask(s.a("jana@tilcerovi.cz")), ask(s.a("nobody@example.com"))
	expect(t, known, http.StatusAccepted, "")
	if shape(t, known) != shape(t, unknown) || len(s.outbox.To(s.a("nobody@example.com"))) != 0 {
		t.Fatalf("%s / %s", shape(t, known), shape(t, unknown))
	}
	stale, _ := s.token(s.a("jana@tilcerovi.cz"))
	ask(s.a("jana@tilcerovi.cz"))
	token, m := s.token(s.a("jana@tilcerovi.cz"))
	if m.Subject != "Reset your Household password" || !strings.Contains(m.Body, apptest.WebURL+"/reset/set#token=") {
		t.Fatalf("%+v", m)
	}

	confirm := func(token, pw string) *httptest.ResponseRecorder {
		return s.browser().post("/auth/password-reset/confirm", jsonBody(t, map[string]string{"token": token, "password": pw}))
	}
	if got := fieldErrorsOf(t, confirm(token, breached)); !slices.Equal(got, []problem.FieldError{{Field: "/password", Code: problem.FieldInvalid}}) {
		t.Fatalf("%v", got)
	}
	expect(t, confirm("no-such-token", "a new long password"), http.StatusNotFound, problem.CodeNotFound)
	expect(t, confirm(token, "a new long password"), http.StatusNoContent, "")
	expect(t, confirm(token, "another new password"), http.StatusGone, problem.CodeTokenAlreadyUsed)
	expect(t, confirm(stale, "another new password"), http.StatusGone, problem.CodeTokenAlreadyUsed)

	for _, br := range []*browser{b, other} {
		expect(t, br.get("/me"), http.StatusUnauthorized, problem.CodeUnauthenticated)
	}
	expect(t, s.browser().post("/auth/login", jsonBody(t, map[string]string{
		"email": s.a("jana@tilcerovi.cz"), "password": "correct horse battery", "client_type": "web",
	})), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	if me := s.browser().loginAndMe(s.a("jana@tilcerovi.cz"), "a new long password"); !me.EmailVerified {
		t.Fatal("the link did not verify the address it proved")
	}
	last := s.outbox.To(s.a("jana@tilcerovi.cz"))
	if got := last[len(last)-1]; got.Subject != "Your Household password was changed" || !strings.Contains(got.Body, apptest.WebURL+"/reset") {
		t.Fatalf("%+v", got)
	}

	ask(s.a("jana@tilcerovi.cz"))
	late, _ := s.token(s.a("jana@tilcerovi.cz"))
	s.clock.advance(time.Hour + time.Second)
	expect(t, confirm(late, "yet another password"), http.StatusGone, problem.CodeTokenExpired)
	expect(t, ask(s.a("jana@tilcerovi.cz")), http.StatusAccepted, "")
	expect(t, ask(s.a("jana@tilcerovi.cz")), http.StatusAccepted, "")
	expect(t, ask(s.a("jana@tilcerovi.cz")), http.StatusAccepted, "")
	expect(t, ask(s.a("JANA@tilcerovi.cz")), http.StatusTooManyRequests, problem.CodeRateLimited)
}

// Two reset links of one account confirmed at once set one password, and the other answers as
// the spent link it is, never as a failure of the server's: each confirmation spends the other's
// link, so neither may hold its own while it waits for the other's.
func TestTwoResetLinksConfirmedAtOnceSetOnePassword(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	s.signUp(address, "correct horse battery")
	for round := range 10 {
		// A new hour each round, for the address's three reset requests an hour.
		s.clock.advance(time.Hour)
		var links [2]string
		for i := range links {
			expect(t, s.browser().post("/auth/password-reset", jsonBody(t, map[string]string{"email": address})), http.StatusAccepted, "")
			links[i], _ = s.token(address)
		}
		var set, spent atomic.Int32
		var wg sync.WaitGroup
		for i, link := range links {
			b := s.browser()
			wg.Go(func() {
				rec := b.post("/auth/password-reset/confirm", jsonBody(t, map[string]string{"token": link, "password": fmt.Sprintf("round %d password %d", round, i)}))
				switch rec.Code {
				case http.StatusNoContent:
					set.Add(1)
				case http.StatusGone:
					spent.Add(1)
				default:
					t.Errorf("round %d: %d %s", round, rec.Code, rec.Body)
				}
			})
		}
		wg.Wait()
		if set.Load() != 1 || spent.Load() != 1 {
			t.Fatalf("round %d: %d set and %d spent, want one of each", round, set.Load(), spent.Load())
		}
	}
}

// Confirmations of one link sent at once take turns: the first sets its password, and the rest find
// the link spent before they screen or hash theirs, so that a burst of them hashes one password,
// not one each.
func TestConfirmationsOfOneLinkSentAtOnceHashOnePassword(t *testing.T) {
	var screened atomic.Int32
	s := newSite(t, apptest.Options{Screening: func(string) {
		screened.Add(1)
		// Long enough for the confirmations sent beside the first to reach the link while it works.
		time.Sleep(20 * time.Millisecond)
	}})
	address := s.a("jana@tilcerovi.cz")
	s.signUp(address, "correct horse battery")
	expect(t, s.browser().post("/auth/password-reset", jsonBody(t, map[string]string{"email": address})), http.StatusAccepted, "")
	link, _ := s.token(address)
	screened.Store(0)
	var set, spent atomic.Int32
	var wg sync.WaitGroup
	for i := range 10 {
		b := s.browser()
		wg.Go(func() {
			rec := b.post("/auth/password-reset/confirm", jsonBody(t, map[string]string{"token": link, "password": fmt.Sprintf("burst password %d", i)}))
			switch {
			case rec.Code == http.StatusNoContent:
				set.Add(1)
			case rec.Code == http.StatusGone && strings.Contains(rec.Body.String(), string(problem.CodeTokenAlreadyUsed)):
				spent.Add(1)
			default:
				t.Errorf("%d %s", rec.Code, rec.Body)
			}
		})
	}
	wg.Wait()
	if set.Load() != 1 || spent.Load() != 9 || screened.Load() != 1 {
		t.Fatalf("%d set, %d spent and %d passwords screened; want 1, 9 and 1", set.Load(), spent.Load(), screened.Load())
	}
}

// A change takes the current password, which a wrong guess counts against as a sign-in does, and
// ends every other session. It keeps no Idempotency-Key, whose fingerprint would hash the
// passwords, so a repeat runs again, and finds the current password changed. A reset link sent
// before it still works: the address's owner takes the account back with it.
func TestChangingThePassword(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.signUp(s.a("jana@tilcerovi.cz"), "correct horse battery")
	other := s.browser()
	other.login(s.a("jana@tilcerovi.cz"), "correct horse battery")
	change := func(current, next string) *httptest.ResponseRecorder {
		return b.post("/auth/password", jsonBody(t, map[string]string{"current_password": current, "new_password": next}))
	}
	expect(t, change("not the password", "a new long password"), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	if got := fieldErrorsOf(t, change("correct horse battery", breached)); !slices.Equal(got, []problem.FieldError{{Field: "/new_password", Code: problem.FieldInvalid}}) {
		t.Fatalf("%v", got)
	}
	// A reset link sent before the change, which outlives it.
	expect(t, s.browser().post("/auth/password-reset", jsonBody(t, map[string]string{"email": s.a("jana@tilcerovi.cz")})), http.StatusAccepted, "")
	reset, _ := s.token(s.a("jana@tilcerovi.cz"))
	keyed := func() *httptest.ResponseRecorder {
		return b.send(request{method: http.MethodPost, path: "/auth/password", header: http.Header{"Idempotency-Key": {"change-1"}},
			body: jsonBody(t, map[string]string{"current_password": "correct horse battery", "new_password": "a new long password"})})
	}
	expect(t, keyed(), http.StatusNoContent, "")
	if n := s.count("SELECT count(*) FROM account_idempotency_keys WHERE key = 'change-1'"); n != 0 {
		t.Fatalf("a password change kept %d keys", n)
	}
	expect(t, keyed(), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	expect(t, b.get("/me"), http.StatusOK, "")
	expect(t, other.get("/me"), http.StatusUnauthorized, problem.CodeUnauthenticated)
	s.browser().login(s.a("jana@tilcerovi.cz"), "a new long password")
	if got := s.outbox.To(s.a("jana@tilcerovi.cz")); got[len(got)-1].Subject != "Your Household password was changed" {
		t.Fatalf("%+v", got[len(got)-1])
	}
	// Ten wrong guesses, after the change cleared the first, cool the account's sign-ins down too.
	for range 10 {
		expect(t, change("not the password", "a new long password"), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	}
	expect(t, s.browser().post("/auth/login", jsonBody(t, map[string]string{
		"email": s.a("jana@tilcerovi.cz"), "password": "a new long password", "client_type": "web",
	})), http.StatusTooManyRequests, problem.CodeRateLimited)

	// The link sent before the change takes the account back from whoever made it.
	expect(t, s.browser().post("/auth/password-reset/confirm", jsonBody(t, map[string]string{"token": reset, "password": "the owner's own password"})),
		http.StatusNoContent, "")
	expect(t, b.get("/me"), http.StatusUnauthorized, problem.CodeUnauthenticated)
	s.browser().login(s.a("jana@tilcerovi.cz"), "the owner's own password")
}

// A reset that lands while a change is running wins: the change checked a current password the
// reset has since replaced, so it answers as a wrong one does, its new password never works, and
// the session it came with stays ended.
func TestAResetLandingDuringAChangeWins(t *testing.T) {
	var (
		s     *site
		reset string
	)
	changed, restored := "the change's new password", "the reset's new password"
	address := func() string { return s.a("jana@tilcerovi.cz") }
	s = newSite(t, apptest.Options{Screening: func(pw string) {
		// The change has checked the current password and screens its new one: the reset lands now.
		if pw == changed {
			expect(t, s.browser().post("/auth/password-reset/confirm", jsonBody(t, map[string]string{"token": reset, "password": restored})),
				http.StatusNoContent, "")
		}
	}})
	b := s.signUp(address(), "correct horse battery")
	expect(t, s.browser().post("/auth/password-reset", jsonBody(t, map[string]string{"email": address()})), http.StatusAccepted, "")
	reset, _ = s.token(address())

	expect(t, b.post("/auth/password", jsonBody(t, map[string]string{"current_password": "correct horse battery", "new_password": changed})),
		http.StatusUnauthorized, problem.CodeInvalidCredentials)
	expect(t, s.browser().post("/auth/login", jsonBody(t, map[string]string{
		"email": address(), "password": changed, "client_type": "web",
	})), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	s.browser().login(address(), restored)
	if n := s.count("SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1 AND s.revoked_at IS NULL", address()); n != 1 {
		t.Fatalf("%d live sessions, want the one the reset's password signed in", n)
	}
}

// A hash made with other parameters is replaced at the next sign-in with one of the server's, and
// replacing it changes no password: a change that checked the current password against the old
// hash while a sign-in replaced it still lands.
func TestASignInRehashesWithoutChangingThePassword(t *testing.T) {
	const pw, changed = "correct horse battery", "the change's new password"
	var s *site
	address := func() string { return s.a("jana@tilcerovi.cz") }
	s = newSite(t, apptest.Options{Screening: func(next string) {
		// The change has checked the current password against the old hash: a sign-in replaces it now.
		if next == changed {
			s.browser().login(address(), pw)
		}
	}})
	b := s.signUp(address(), pw)
	older, err := password.New(password.Params{Memory: 2 * apptest.Cheap.Memory, Time: 1, Threads: 1, SaltLen: 16, KeyLen: 32}, 1)
	if err != nil {
		t.Fatal(err)
	}
	// olden stores the password as an earlier release hashed it, set when it was.
	olden := func() {
		t.Helper()
		old, err := older.Hash(t.Context(), pw)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.admin.Exec(t.Context(), `
			UPDATE credentials c SET secret = $1 FROM users u WHERE u.id = c.user_id AND u.email = $2 AND c.type = 'password'`,
			old, address()); err != nil {
			t.Fatal(err)
		}
	}
	stored := func() string {
		t.Helper()
		var secret string
		if err := s.admin.QueryRow(t.Context(), `
			SELECT c.secret FROM credentials c JOIN users u ON u.id = c.user_id WHERE u.email = $1 AND c.type = 'password'`,
			address()).Scan(&secret); err != nil {
			t.Fatal(err)
		}
		return secret
	}

	olden()
	s.browser().login(address(), pw)
	if current := fmt.Sprintf("$m=%d,t=%d,p=%d$", apptest.Cheap.Memory, apptest.Cheap.Time, apptest.Cheap.Threads); !strings.Contains(stored(), current) {
		t.Fatalf("a sign-in kept the old hash %s", stored())
	}

	olden()
	expect(t, b.post("/auth/password", jsonBody(t, map[string]string{"current_password": pw, "new_password": changed})),
		http.StatusNoContent, "")
	s.browser().login(address(), changed)
	expect(t, s.browser().post("/auth/login", jsonBody(t, map[string]string{"email": address(), "password": pw, "client_type": "web"})),
		http.StatusUnauthorized, problem.CodeInvalidCredentials)
}

// Behind a trusted proxy a limit counts the client the proxy forwarded for, not the proxy, and never
// an address a client claims for itself (HOUSEHOLD_TRUSTED_PROXIES).
func TestALimitCountsTheClientBehindATrustedProxy(t *testing.T) {
	s := newSite(t, apptest.Options{TrustedProxies: []string{"10.0.0.0/8"}})
	register := func(i int, forwarded string) *httptest.ResponseRecorder {
		t.Helper()
		b := s.browser()
		b.peer = "10.0.0.7:4000"
		return b.send(request{method: http.MethodPost, path: "/auth/register", header: http.Header{"X-Forwarded-For": {forwarded}},
			body: jsonBody(t, map[string]string{"email": s.a(fmt.Sprintf("user%d@example.com", i)), "password": "correct horse battery", "display_name": "U"})})
	}
	// One client, claiming another address of its own each time.
	client, another := host(s.peer), host(s.other)
	for i := range ratelimit.RegisterNetwork.Max {
		expect(t, register(i, fmt.Sprintf("192.0.2.%d, %s", i, client)), http.StatusAccepted, "")
	}
	expect(t, register(ratelimit.RegisterNetwork.Max, "192.0.2.99, "+client), http.StatusTooManyRequests, problem.CodeRateLimited)
	// Another client, through the same proxy, has a budget of its own.
	expect(t, register(ratelimit.RegisterNetwork.Max+1, another), http.StatusAccepted, "")
}

// The note to an address that has an account goes out three times an hour, and the registrations
// past that answer 202 as ever, sending nothing (D-96).
func TestAnAddressIsSentFewRegistrationNotes(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.browser()
	notes := func() int {
		n := 0
		for _, m := range s.outbox.To(s.a("jana@tilcerovi.cz")) {
			if m.Subject == "You already have a Household account" {
				n++
			}
		}
		return n
	}
	b.register(s.a("jana@tilcerovi.cz"), "correct horse battery")
	for range ratelimit.RegisterNote.Max + 1 {
		b.register(s.a("jana@tilcerovi.cz"), "correct horse battery")
	}
	if n := notes(); n != ratelimit.RegisterNote.Max {
		t.Fatalf("%d notes, want %d", n, ratelimit.RegisterNote.Max)
	}
	s.clock.advance(time.Hour)
	b.register(s.a("JANA@tilcerovi.cz"), "correct horse battery")
	if n := notes(); n != ratelimit.RegisterNote.Max+1 {
		t.Fatalf("%d notes an hour on, want %d", n, ratelimit.RegisterNote.Max+1)
	}
}

// The profile is a merge: a member left out stays, null clears one that may be empty, and each
// refusal names its field.
func TestTheProfile(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.signUp(s.a("jana@tilcerovi.cz"), "correct horse battery")
	patch := func(body string) *httptest.ResponseRecorder {
		return b.send(request{method: http.MethodPatch, path: "/me", body: body})
	}
	rec := patch(`{"display_name":"Jana Tilcerová","locale":"cs","timezone":"Europe/Prague","first_day_of_week":1}`)
	expect(t, rec, http.StatusOK, "")
	var me meBody
	decode(t, rec, &me)
	if me.DisplayName != "Jana Tilcerová" || me.Locale != "cs" || me.Timezone == nil || *me.Timezone != "Europe/Prague" ||
		me.FirstDayOfWeek == nil || *me.FirstDayOfWeek != 1 {
		t.Fatalf("%+v", me)
	}
	expect(t, patch(`{"timezone":null}`), http.StatusOK, "")
	if me = b.me(); me.Timezone != nil || me.FirstDayOfWeek == nil || me.DisplayName != "Jana Tilcerová" {
		t.Fatalf("clearing the timezone: %+v", me)
	}
	expect(t, patch(`{"first_day_of_week":null,"avatar_url":null}`), http.StatusOK, "")
	if me = b.me(); me.FirstDayOfWeek != nil || me.AvatarURL != nil {
		t.Fatalf("%+v", me)
	}
	if got := fieldErrorsOf(t, patch(`{"display_name":"  ","timezone":"Mars/Olympus","locale":"??","avatar_url":"https://x.example/a.png"}`)); !slices.Equal(got, []problem.FieldError{
		{Field: "/display_name", Code: problem.FieldInvalid}, {Field: "/locale", Code: problem.FieldMalformed},
		{Field: "/timezone", Code: problem.FieldInvalid}, {Field: "/avatar_url", Code: problem.FieldInvalid},
	}) {
		t.Fatalf("%v", got)
	}
	for _, bad := range []string{`{"first_day_of_week":7}`, `{"timezone":"Local"}`, `{"timezone":""}`, `{"locale":"x-home"}`, `{"display_name":"J T"}`} {
		if rec := patch(bad); rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s: %d", bad, rec.Code)
		}
	}
	if me = b.me(); me.DisplayName != "Jana Tilcerová" || me.Locale != "cs" {
		t.Fatalf("a refused change changed %+v", me)
	}
	expect(t, s.browser().get("/me"), http.StatusUnauthorized, problem.CodeUnauthenticated)
}

// The session list is the caller's live sessions, the one the request came with marked; one ends
// alone, another user's is not found, and signing out everywhere ends them all.
func TestTheSessionList(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.signUp(s.a("jana@tilcerovi.cz"), "correct horse battery")
	phone := s.browser()
	phone.send(request{method: http.MethodPost, path: "/auth/login", header: http.Header{"User-Agent": {"Firefox on Android\x00"}},
		body: jsonBody(t, map[string]string{"email": s.a("jana@tilcerovi.cz"), "password": "correct horse battery", "client_type": "web"})})
	stranger := s.signUp(s.a("petr@example.com"), "correct horse battery")

	type item struct {
		ID                  uuid.UUID `json:"id"`
		UserAgent           string    `json:"user_agent"`
		IsCurrent           bool      `json:"is_current"`
		ApproximateLocation *string   `json:"approximate_location"`
	}
	list := func(br *browser) []item {
		rec := br.get("/me/sessions")
		expect(t, rec, http.StatusOK, "")
		var body struct {
			Items []item `json:"items"`
		}
		decode(t, rec, &body)
		return body.Items
	}
	items := list(b)
	if len(items) != 2 || items[0].IsCurrent == items[1].IsCurrent {
		t.Fatalf("%+v", items)
	}
	var mine, theirs item
	for _, it := range items {
		if it.IsCurrent {
			mine = it
		} else {
			theirs = it
		}
	}
	if theirs.UserAgent != "Firefox on Android" {
		t.Errorf("the user agent kept: %q", theirs.UserAgent)
	}
	strangers := list(stranger)
	expect(t, b.send(request{method: http.MethodDelete, path: "/me/sessions/" + strangers[0].ID.String()}), http.StatusNotFound, problem.CodeNotFound)
	expect(t, b.send(request{method: http.MethodDelete, path: "/me/sessions/" + theirs.ID.String()}), http.StatusNoContent, "")
	expect(t, b.send(request{method: http.MethodDelete, path: "/me/sessions/" + theirs.ID.String()}), http.StatusNotFound, problem.CodeNotFound)
	expect(t, phone.get("/me"), http.StatusUnauthorized, problem.CodeUnauthenticated)
	if items = list(b); len(items) != 1 || items[0].ID != mine.ID {
		t.Fatalf("%+v", items)
	}

	phone.login(s.a("jana@tilcerovi.cz"), "correct horse battery")
	expect(t, b.send(request{method: http.MethodDelete, path: "/me/sessions"}), http.StatusNoContent, "")
	if _, ok := b.cookies[session.Cookie]; ok {
		t.Fatal("signing out everywhere left this browser's cookie")
	}
	expect(t, phone.get("/me"), http.StatusUnauthorized, problem.CodeUnauthenticated)
	expect(t, stranger.get("/me"), http.StatusOK, "")
}

// A signed-in user's key is kept on their account: a repeat is answered with the first response,
// and does not repeat the change.
func TestAnAccountRequestIsRepeatable(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.signUp(s.a("jana@tilcerovi.cz"), "correct horse battery")
	rename := func(name, key string) *httptest.ResponseRecorder {
		return b.send(request{method: http.MethodPatch, path: "/me", body: jsonBody(t, map[string]string{"display_name": name}),
			header: http.Header{"Idempotency-Key": {key}}})
	}
	first := rename("Jana T.", "rename-1")
	expect(t, first, http.StatusOK, "")
	if _, err := s.admin.Exec(t.Context(), "UPDATE users SET display_name = 'Changed since' WHERE email = $1", s.a("jana@tilcerovi.cz")); err != nil {
		t.Fatal(err)
	}
	again := rename("Jana T.", "rename-1")
	if again.Code != http.StatusOK || again.Body.String() != first.Body.String() {
		t.Fatalf("the repeat answered %d %s", again.Code, again.Body)
	}
	if me := b.me(); me.DisplayName != "Changed since" {
		t.Fatalf("the repeat renamed again: %+v", me)
	}
	if got := fieldErrorsOf(t, rename("Someone else", "rename-1")); !slices.Equal(got, []problem.FieldError{{Field: "header:Idempotency-Key", Code: problem.FieldInvalid}}) {
		t.Fatalf("%v", got)
	}
	if n := s.count(`
		SELECT count(*) FROM account_idempotency_keys k JOIN users u ON u.id = k.user_id
		WHERE k.key = 'rename-1' AND k.state = 'completed' AND u.email = $1`, s.a("jana@tilcerovi.cz")); n != 1 {
		t.Fatalf("%d completed keys", n)
	}
}

// A signed-in user's API calls share one budget, which a refusal names the wait for.
func TestASignedInUsersRequestsAreLimited(t *testing.T) {
	s := newSite(t, apptest.Options{UserLimit: ratelimit.Rate{PerMinute: 60, Burst: 3}})
	b := s.signUp(s.a("jana@tilcerovi.cz"), "correct horse battery")
	for range 3 {
		expect(t, b.get("/me"), http.StatusOK, "")
	}
	rec := b.get("/reference/units")
	expect(t, rec, http.StatusTooManyRequests, problem.CodeRateLimited)
	if rec.Header().Get("Retry-After") != "1" {
		t.Errorf("Retry-After %q", rec.Header().Get("Retry-After"))
	}
	s.clock.advance(time.Second)
	expect(t, b.get("/me"), http.StatusOK, "")
	other := s.signUp(s.a("petr@example.com"), "correct horse battery")
	expect(t, other.get("/me"), http.StatusOK, "")
}
