package app_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/federation"
	"github.com/kareltilcer/household/server/internal/platform/federation/federationtest"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// The tests in this file sign in with an identity provider (FR-ID2) through the whole router,
// against a provider of the test's own: Done when (plan item 9), OIDC against a mock identity
// provider.

const redirectURI = apptest.WebURL + "/sign-in/google"

// federated is a site that signs in with Google, and the provider behind it.
func federated(t *testing.T, o apptest.Options) (*site, *federationtest.Provider) {
	t.Helper()
	idp := federationtest.New(t, "household-web", "the-secret")
	google, err := federation.New(federation.Google, federation.Config{Issuer: idp.Issuer(), ClientID: "household-web", ClientSecret: "the-secret"})
	if err != nil {
		t.Fatal(err)
	}
	o.Providers = map[string]*federation.Provider{federation.Google: google}
	o.RedirectURIs = []string{redirectURI, "household://sign-in"}
	return newSite(t, o), idp
}

// verifier is the tests' PKCE verifier.
var verifier = strings.Repeat("v", 43)

// start begins a sign-in with Google from b, and returns the authorization URL and the state.
func (b *browser) start(clientType string) (string, string) {
	b.s.t.Helper()
	rec := b.post("/auth/oauth/google/start", jsonBody(b.s.t, map[string]string{"redirect_uri": redirectURI,
		"code_challenge": federation.Challenge(verifier), "client_type": clientType}))
	expect(b.s.t, rec, http.StatusOK, "")
	var begun struct {
		URL   string `json:"authorization_url"`
		State string `json:"state"`
	}
	decode(b.s.t, rec, &begun)
	return begun.URL, begun.State
}

// google signs person in with Google from b, and returns the callback's answer.
func (b *browser) google(idp *federationtest.Provider, person federationtest.Person) *httptest.ResponseRecorder {
	b.s.t.Helper()
	authURL, state := b.start("web")
	code, returned := idp.Authorize(authURL, person)
	if returned != state {
		b.s.t.Fatalf("the provider sent back %q for %q", returned, state)
	}
	return b.post("/auth/oauth/google/callback", jsonBody(b.s.t, map[string]string{"code": code, "state": state, "code_verifier": verifier}))
}

func TestSigningInWithGoogleMakesAnAccountAndKeepsIt(t *testing.T) {
	s, idp := federated(t, apptest.Options{})
	address := s.a("jana@gmail.test")
	b := s.browser()
	rec := b.google(idp, federationtest.Person{Subject: s.a("g-jana"), Email: address, EmailVerified: true, Name: "Jana Tilcerová"})
	expect(t, rec, http.StatusOK, "")
	me := b.me()
	if me.Email == nil || *me.Email != address || !me.EmailVerified || me.DisplayName != "Jana Tilcerová" ||
		!slices.Equal(me.Credentials, []string{"google"}) {
		t.Fatalf("%+v", me)
	}
	// The subject, not the address, is who it is: signed in again with another address, the same
	// account.
	again := s.browser()
	expect(t, again.google(idp, federationtest.Person{Subject: s.a("g-jana"), Email: s.a("renamed@gmail.test"), EmailVerified: true}), http.StatusOK, "")
	if again.me().ID != me.ID {
		t.Fatal("the same subject signed in as another account")
	}
	// A password sign-in finds no password on it.
	expect(t, s.browser().signIn(address, "correct horse battery"), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	// An address the provider does not vouch for is kept unverified.
	other := s.browser()
	expect(t, other.google(idp, federationtest.Person{Subject: s.a("g-petr"), Email: s.a("petr@gmail.test")}), http.StatusOK, "")
	if m := other.me(); m.EmailVerified || m.DisplayName != "" {
		t.Fatalf("%+v", m)
	}
	// A name longer than an account keeps, which a provider does not hold to, is cut to it.
	long := s.browser()
	expect(t, long.google(idp, federationtest.Person{Subject: s.a("g-long"), Email: s.a("long@gmail.test"), EmailVerified: true,
		Name: strings.Repeat("Ř", 100)}), http.StatusOK, "")
	if m := long.me(); m.DisplayName != strings.Repeat("Ř", 80) {
		t.Fatalf("%+v", m)
	}
}

// Two first sign-ins with one subject at once make one account, and both sign in to it: the one
// that waited for the other's address finds the subject the other gave it, and is not told to link
// an account that is its own.
func TestTwoFirstSignInsWithOneSubjectAtOnceMakeOneAccount(t *testing.T) {
	s, idp := federated(t, apptest.Options{})
	address := s.a("jana@gmail.test")
	person := federationtest.Person{Subject: s.a("g-jana"), Email: address, EmailVerified: true}
	authURL, state := s.browser().start("web")
	code, _ := idp.Authorize(authURL, person)

	// The other sign-in's account, made and not yet committed.
	ctx := t.Context()
	hold, err := s.admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hold.Rollback(context.WithoutCancel(ctx)) }()
	first := idgen.New()
	if _, err := hold.Exec(ctx, "INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())", first, address); err != nil {
		t.Fatal(err)
	}
	if _, err := hold.Exec(ctx, "INSERT INTO credentials (user_id, type, subject) VALUES ($1, 'google', $2)", first, person.Subject); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	r := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/auth/oauth/google/callback",
		strings.NewReader(jsonBody(t, map[string]string{"code": code, "state": state, "code_verifier": verifier})))
	r.RemoteAddr = s.peer
	r.Header.Set("Content-Type", "application/json")
	var wg sync.WaitGroup
	wg.Go(func() { s.router.ServeHTTP(rec, r) })
	for deadline := time.Now().Add(10 * time.Second); s.count(`
		SELECT count(*) FROM pg_stat_activity
		WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%INSERT INTO users%'`) < 1; {
		if time.Now().After(deadline) {
			t.Fatal("the sign-in never waited for the other's account")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := hold.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	expect(t, rec, http.StatusOK, "")
	var result struct {
		User meBody `json:"user"`
	}
	decode(t, rec, &result)
	if result.User.ID != first {
		t.Fatalf("signed in as %s, not the subject's account %s", result.User.ID, first)
	}
}

// A subject no account holds, whose address an account has, is never linked on its own: its owner
// signs in with the password, begins signed in, and links it; it then signs the account in, and
// the account's address is told.
func TestAnAccountWithTheAddressLinksGoogleItself(t *testing.T) {
	s, idp := federated(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	s.browser().register(address, "correct horse battery")
	person := federationtest.Person{Subject: s.a("g-jana"), Email: address, EmailVerified: true}
	// The account has not verified its address, and the identity is still not linked on its own
	// (D-102).
	expect(t, s.browser().google(idp, person), http.StatusConflict, problem.CodeLinkRequired)
	if n := s.count("SELECT count(*) FROM credentials WHERE subject = $1", s.a("g-jana")); n != 0 {
		t.Fatal("a subject was linked on its own")
	}

	b := s.browser()
	b.login(address, "correct horse battery")
	authURL, state := b.start("web")
	code, _ := idp.Authorize(authURL, person)
	before := len(s.outbox.To(address))
	expect(t, b.post("/auth/oauth/google/link", jsonBody(t, map[string]string{"code": code, "state": state, "code_verifier": verifier})),
		http.StatusNoContent, "")
	if messages := s.outbox.To(address); len(messages) != before+1 || !strings.Contains(messages[len(messages)-1].Subject, "Google") {
		t.Fatalf("%+v", messages[before:])
	}
	if me := b.me(); !slices.Equal(me.Credentials, []string{"password", "google"}) {
		t.Fatalf("%+v", me.Credentials)
	}
	g := s.browser()
	expect(t, g.google(idp, person), http.StatusOK, "")
	if g.me().ID != b.me().ID {
		t.Fatal("the linked subject signed in as another account")
	}

	// Unlinked, it no longer signs in; the account's only credential cannot be unlinked.
	expect(t, b.send(request{method: http.MethodDelete, path: "/auth/oauth/google"}), http.StatusNoContent, "")
	expect(t, b.send(request{method: http.MethodDelete, path: "/auth/oauth/google"}), http.StatusNotFound, problem.CodeNotFound)
	expect(t, s.browser().google(idp, person), http.StatusConflict, problem.CodeLinkRequired)
	only := s.browser()
	expect(t, only.google(idp, federationtest.Person{Subject: s.a("g-only"), Email: s.a("only@gmail.test"), EmailVerified: true}), http.StatusOK, "")
	expect(t, only.send(request{method: http.MethodDelete, path: "/auth/oauth/google"}), http.StatusConflict, problem.CodeOnlyCredential)
}

// A reset that proves an address nobody had proven unlinks the providers the account held before
// it (D-102): whoever registered with someone else's address and linked their own Google signs in
// with it no longer once the address's owner has reset the password. An account whose address was
// proven keeps its providers.
func TestAResetThatProvesTheAddressUnlinksTheProvidersBeforeIt(t *testing.T) {
	s, idp := federated(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	squatter := s.signUp(address, "squatter horse battery")
	intruder := federationtest.Person{Subject: s.a("g-squatter"), Email: s.a("squatter@gmail.test"), EmailVerified: true}
	authURL, state := squatter.start("web")
	code, _ := idp.Authorize(authURL, intruder)
	expect(t, squatter.post("/auth/oauth/google/link", jsonBody(t, map[string]string{"code": code, "state": state, "code_verifier": verifier})),
		http.StatusNoContent, "")

	owner := s.browser()
	expect(t, owner.post("/auth/password-reset", jsonBody(t, map[string]string{"email": address})), http.StatusAccepted, "")
	tok, _ := s.token(address)
	expect(t, owner.post("/auth/password-reset/confirm", jsonBody(t, map[string]string{"token": tok, "password": "correct horse battery"})),
		http.StatusNoContent, "")
	me := owner.loginAndMe(address, "correct horse battery")
	if !me.EmailVerified || !slices.Equal(me.Credentials, []string{"password"}) {
		t.Fatalf("%+v", me)
	}
	// The squatter's Google now opens an account of its own, not the owner's.
	g := s.browser()
	expect(t, g.google(idp, intruder), http.StatusOK, "")
	if g.me().ID == me.ID {
		t.Fatal("the squatter's Google still signs in to the owner's account")
	}

	// Proven, the address's owner links Google, and a later reset keeps it.
	mine := federationtest.Person{Subject: s.a("g-jana"), Email: address, EmailVerified: true}
	authURL, state = owner.start("web")
	code, _ = idp.Authorize(authURL, mine)
	expect(t, owner.post("/auth/oauth/google/link", jsonBody(t, map[string]string{"code": code, "state": state, "code_verifier": verifier})),
		http.StatusNoContent, "")
	expect(t, owner.post("/auth/password-reset", jsonBody(t, map[string]string{"email": address})), http.StatusAccepted, "")
	tok, _ = s.token(address)
	again := "a new horse battery"
	expect(t, owner.post("/auth/password-reset/confirm", jsonBody(t, map[string]string{"token": tok, "password": again})),
		http.StatusNoContent, "")
	expect(t, s.browser().google(idp, mine), http.StatusOK, "")
}

// A sign-in with a provider takes turns with the reset that unlinks it (D-102): one that reached the
// credential while the reset was unlinking it waits for the reset, and then finds nothing linked,
// rather than signing in to the account the reset took back with a session the reset never saw.
func TestASignInWithAProviderWaitsForTheResetThatUnlinksIt(t *testing.T) {
	s, idp := federated(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	squatter := s.signUp(address, "squatter horse battery")
	intruder := federationtest.Person{Subject: s.a("g-squatter"), Email: s.a("squatter@gmail.test"), EmailVerified: true}
	authURL, state := squatter.start("web")
	code, _ := idp.Authorize(authURL, intruder)
	expect(t, squatter.post("/auth/oauth/google/link", jsonBody(t, map[string]string{"code": code, "state": state, "code_verifier": verifier})),
		http.StatusNoContent, "")
	account := squatter.me().ID

	// The reset's unlink, made and not yet committed.
	ctx := t.Context()
	hold, err := s.admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hold.Rollback(context.WithoutCancel(ctx)) }()
	if _, err := hold.Exec(ctx, "DELETE FROM credentials WHERE user_id = $1 AND type IN ('google', 'apple')", account); err != nil {
		t.Fatal(err)
	}

	authURL, state = s.browser().start("web")
	code, _ = idp.Authorize(authURL, intruder)
	rec := httptest.NewRecorder()
	r := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/auth/oauth/google/callback",
		strings.NewReader(jsonBody(t, map[string]string{"code": code, "state": state, "code_verifier": verifier})))
	r.RemoteAddr = s.peer
	r.Header.Set("Content-Type", "application/json")
	var wg sync.WaitGroup
	wg.Go(func() { s.router.ServeHTTP(rec, r) })
	for deadline := time.Now().Add(10 * time.Second); s.count(`
		SELECT count(*) FROM pg_stat_activity
		WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM credentials WHERE type%'`) < 1; {
		if time.Now().After(deadline) {
			t.Fatal("the sign-in never waited for the reset's unlink")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := hold.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	// The squatter's Google opens an account of its own.
	expect(t, rec, http.StatusOK, "")
	var result struct {
		User meBody `json:"user"`
	}
	decode(t, rec, &result)
	if result.User.ID == account {
		t.Fatal("a sign-in with an unlinked provider signed in to the account")
	}
}

// A link whose code is redeemed while a reset takes the account back lands not at all: the reset
// ended the session the link came with, and unlinks every provider linked before it (D-102), so a
// link landing after it would keep whoever it took the account from signing in.
func TestALinkDoesNotLandAfterAResetConfirmedMeanwhile(t *testing.T) {
	s, idp := federated(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	squatter := s.signUp(address, "squatter horse battery")
	intruder := federationtest.Person{Subject: s.a("g-squatter"), Email: s.a("squatter@gmail.test"), EmailVerified: true}
	owner := s.browser()
	expect(t, owner.post("/auth/password-reset", jsonBody(t, map[string]string{"email": address})), http.StatusAccepted, "")
	tok, _ := s.token(address)
	confirm := jsonBody(t, map[string]string{"token": tok, "password": "correct horse battery"})
	confirmed := make(chan int, 1)
	idp.Redeeming = func() {
		// Confirmed while the server waits on the provider, on the provider's goroutine, where none
		// of t's helpers may stop the test.
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/auth/password-reset/confirm", strings.NewReader(confirm))
		r.RemoteAddr = s.peer
		r.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		s.router.ServeHTTP(rec, r)
		confirmed <- rec.Code
	}

	authURL, state := squatter.start("web")
	code, _ := idp.Authorize(authURL, intruder)
	expect(t, squatter.post("/auth/oauth/google/link", jsonBody(t, map[string]string{"code": code, "state": state, "code_verifier": verifier})),
		http.StatusUnauthorized, problem.CodeUnauthenticated)
	if status := <-confirmed; status != http.StatusNoContent {
		t.Fatalf("the reset answered %d", status)
	}
	if n := s.count("SELECT count(*) FROM credentials WHERE subject = $1", intruder.Subject); n != 0 {
		t.Fatal("a link landed after the reset that took the account back")
	}
}

// A link completes only a start its own account made, and never takes a subject another account
// holds.
func TestALinkIsTheAccountsOwn(t *testing.T) {
	s, idp := federated(t, apptest.Options{})
	jana, petr := s.a("jana@tilcerovi.cz"), s.a("petr@tilcerovi.cz")
	b := s.signUp(jana, "correct horse battery")
	other := s.signUp(petr, "correct horse battery")

	// A start made signed out, or by another account, is not this account's to link.
	authURL, state := s.browser().start("web")
	code, _ := idp.Authorize(authURL, federationtest.Person{Subject: s.a("g-x")})
	if got := fieldErrorsOf(t, b.post("/auth/oauth/google/link", jsonBody(t, map[string]string{"code": code, "state": state,
		"code_verifier": verifier}))); !slices.Equal(got, []problem.FieldError{{Field: "/state", Code: problem.FieldInvalid}}) {
		t.Fatalf("%v", got)
	}
	authURL, state = other.start("web")
	code, _ = idp.Authorize(authURL, federationtest.Person{Subject: s.a("g-x")})
	if got := fieldErrorsOf(t, b.post("/auth/oauth/google/link", jsonBody(t, map[string]string{"code": code, "state": state,
		"code_verifier": verifier}))); !slices.Equal(got, []problem.FieldError{{Field: "/state", Code: problem.FieldInvalid}}) {
		t.Fatalf("%v", got)
	}

	// A subject another account holds is refused.
	expect(t, s.browser().google(idp, federationtest.Person{Subject: s.a("g-held"), Email: s.a("held@gmail.test"), EmailVerified: true}), http.StatusOK, "")
	authURL, state = b.start("web")
	code, _ = idp.Authorize(authURL, federationtest.Person{Subject: s.a("g-held")})
	expect(t, b.post("/auth/oauth/google/link", jsonBody(t, map[string]string{"code": code, "state": state, "code_verifier": verifier})),
		http.StatusConflict, problem.CodeIdentityAlreadyLinked)
	// A code the provider does not vouch for names the code.
	authURL, state = b.start("web")
	_, _ = idp.Authorize(authURL, federationtest.Person{Subject: s.a("g-jana")})
	if got := fieldErrorsOf(t, b.post("/auth/oauth/google/link", jsonBody(t, map[string]string{"code": "made-up", "state": state,
		"code_verifier": verifier}))); !slices.Equal(got, []problem.FieldError{{Field: "/code", Code: problem.FieldInvalid}}) {
		t.Fatalf("%v", got)
	}
}

// The flow is held to its start: the redirect URI registered exactly, the state used once and
// within ten minutes, and the verifier the challenge's; a provider not configured is not found.
func TestAProviderSignInIsHeldToItsStart(t *testing.T) {
	s, idp := federated(t, apptest.Options{})
	b := s.browser()
	rec := b.post("/auth/oauth/google/start", jsonBody(t, map[string]string{"redirect_uri": redirectURI + "/",
		"code_challenge": federation.Challenge(verifier)}))
	expect(t, rec, http.StatusUnprocessableEntity, problem.CodeRedirectUriNotRegistered)
	var refused struct {
		Errors []problem.FieldError `json:"errors"`
	}
	decode(t, rec, &refused)
	if !slices.Equal(refused.Errors, []problem.FieldError{{Field: "/redirect_uri", Code: problem.FieldInvalid}}) {
		t.Fatalf("%v", refused.Errors)
	}
	expect(t, b.post("/auth/oauth/apple/start", jsonBody(t, map[string]string{"redirect_uri": redirectURI,
		"code_challenge": federation.Challenge(verifier)})), http.StatusNotFound, problem.CodeNotFound)

	person := federationtest.Person{Subject: s.a("g-jana"), Email: s.a("jana@gmail.test"), EmailVerified: true}
	callback := func(code, state, v string) *httptest.ResponseRecorder {
		return b.post("/auth/oauth/google/callback", jsonBody(t, map[string]string{"code": code, "state": state, "code_verifier": v}))
	}
	authURL, state := b.start("web")
	code, _ := idp.Authorize(authURL, person)
	expect(t, callback(code, state, strings.Repeat("w", 43)), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	// The state was spent by that attempt.
	expect(t, callback(code, state, verifier), http.StatusUnauthorized, problem.CodeInvalidCredentials)

	authURL, state = b.start("web")
	code, _ = idp.Authorize(authURL, person)
	s.clock.advance(11 * time.Minute)
	expect(t, callback(code, state, verifier), http.StatusUnauthorized, problem.CodeInvalidCredentials)

	authURL, state = b.start("web")
	_, _ = idp.Authorize(authURL, person)
	expect(t, callback("made-up", state, verifier), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	if idp.Redeemed != 0 {
		t.Fatalf("%d codes were redeemed", idp.Redeemed)
	}
}

// A provider sign-in is a sign-in like any other: a device's is given a token pair, and one to an
// account with the second step on is challenged.
func TestAProviderSignInOnADeviceAndWithTheSecondStep(t *testing.T) {
	s, idp := federated(t, apptest.Options{})
	p := s.phone("Pixel")
	rec := p.send(http.MethodPost, "/auth/oauth/google/start", jsonBody(t, map[string]string{"redirect_uri": "household://sign-in",
		"code_challenge": federation.Challenge(verifier), "client_type": "mobile"}), nil)
	expect(t, rec, http.StatusOK, "")
	var begun struct {
		URL   string `json:"authorization_url"`
		State string `json:"state"`
	}
	decode(t, rec, &begun)
	code, _ := idp.Authorize(begun.URL, federationtest.Person{Subject: s.a("g-jana"), Email: s.a("jana@gmail.test"), EmailVerified: true})
	body := map[string]any{"code": code, "state": begun.State, "code_verifier": verifier, "client_type": "web"}
	// The start said mobile, so the device is needed, whatever the callback says.
	if got := fieldErrorsOf(t, p.send(http.MethodPost, "/auth/oauth/google/callback", jsonBody(t, body), nil)); !slices.Equal(got,
		[]problem.FieldError{{Field: "/device", Code: "required"}}) {
		t.Fatalf("%v", got)
	}
	rec = p.send(http.MethodPost, "/auth/oauth/google/start", jsonBody(t, map[string]string{"redirect_uri": "household://sign-in",
		"code_challenge": federation.Challenge(verifier), "client_type": "mobile"}), nil)
	decode(t, rec, &begun)
	code, _ = idp.Authorize(begun.URL, federationtest.Person{Subject: s.a("g-jana")})
	body = map[string]any{"code": code, "state": begun.State, "code_verifier": verifier, "device": p.deviceBody()}
	rec = p.send(http.MethodPost, "/auth/oauth/google/callback", jsonBody(t, body), nil)
	expect(t, rec, http.StatusOK, "")
	p.keep(rec)
	if list := p.devices(); len(list) != 1 || list[0].Label != "Pixel" {
		t.Fatalf("%+v", list)
	}

	// With the second step on, the callback is challenged, as a sign-in with a password is.
	w := s.browser()
	expect(t, w.google(idp, federationtest.Person{Subject: s.a("g-mfa"), Email: s.a("mfa@gmail.test"), EmailVerified: true}), http.StatusOK, "")
	w.post("/auth/password-reset", jsonBody(t, map[string]string{"email": s.a("mfa@gmail.test")}))
	tok, _ := s.token(s.a("mfa@gmail.test"))
	expect(t, w.post("/auth/password-reset/confirm", jsonBody(t, map[string]string{"token": tok, "password": "correct horse battery"})),
		http.StatusNoContent, "")
	w.login(s.a("mfa@gmail.test"), "correct horse battery")
	secret, _ := w.enrol("correct horse battery")
	c := challenged(t, s.browser().google(idp, federationtest.Person{Subject: s.a("g-mfa")}))
	expect(t, w.verify(c, s.nextCode(secret), false), http.StatusOK, "")
}
