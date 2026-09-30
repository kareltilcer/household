package app_test

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/device"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
	"github.com/kareltilcer/household/server/internal/platform/token"
)

// The tests in this file serve the mobile client's credential of item 9 through the whole router,
// as a phone would call it: no origin and no cookies, its access token in Authorization.

// phone is a mobile installation: its device's id, the token pair it holds, and the version it
// names itself with, none when "".
type phone struct {
	s               *site
	id              uuid.UUID
	label           string
	access, refresh string
	version         string
}

func (s *site) phone(label string) *phone { return &phone{s: s, id: idgen.New(), label: label} }

// send sends a request as the phone does: with its access token, when it holds one, and its
// version, when it names one.
func (p *phone) send(method, path, body string, header http.Header) *httptest.ResponseRecorder {
	p.s.t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	r := httptest.NewRequestWithContext(p.s.t.Context(), method, "/api/v1"+path, reader)
	r.RemoteAddr = p.s.peer
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	if p.access != "" {
		r.Header.Set("Authorization", "Bearer "+p.access)
	}
	if p.version != "" {
		r.Header.Set("Household-Client", "mobile/"+p.version)
	}
	for key, values := range header {
		r.Header[key] = values
	}
	return testsupport.Serve(p.s.t, p.s.router, r)
}

// deviceBody is the phone's DeviceSignIn.
func (p *phone) deviceBody() map[string]any {
	return map[string]any{"id": p.id, "label": p.label, "platform": "ios", "app_version": "1.0.0"}
}

// login signs in as address with pw, and keeps the pair it is given.
func (p *phone) login(address, pw string, extra ...map[string]any) *httptest.ResponseRecorder {
	p.s.t.Helper()
	body := map[string]any{"email": address, "password": pw, "client_type": "mobile", "device": p.deviceBody()}
	for _, e := range extra {
		for k, v := range e {
			body[k] = v
		}
	}
	rec := p.send(http.MethodPost, "/auth/login", jsonBody(p.s.t, body), nil)
	p.keep(rec)
	return rec
}

// keep keeps the pair a sign-in answered with.
func (p *phone) keep(rec *httptest.ResponseRecorder) {
	p.s.t.Helper()
	if rec.Code != http.StatusOK {
		return
	}
	var result struct {
		Tokens *pair `json:"tokens"`
	}
	decode(p.s.t, rec, &result)
	if result.Tokens == nil {
		p.s.t.Fatal("a mobile sign-in answered no tokens")
	}
	p.access, p.refresh = result.Tokens.AccessToken, result.Tokens.RefreshToken
}

// pair is the contract's TokenPair.
type pair struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
}

// exchange presents refresh, and returns the answer and the pair it carried, if any.
func (p *phone) exchange(refresh string) (*httptest.ResponseRecorder, pair) {
	p.s.t.Helper()
	saved := p.access
	p.access = ""
	rec := p.send(http.MethodPost, "/auth/token", jsonBody(p.s.t, map[string]string{"refresh_token": refresh}), nil)
	p.access = saved
	var got pair
	if rec.Code == http.StatusOK {
		decode(p.s.t, rec, &got)
	}
	return rec, got
}

// renew exchanges the phone's refresh token, keeps the new pair, and expects to.
func (p *phone) renew() {
	p.s.t.Helper()
	rec, got := p.exchange(p.refresh)
	expect(p.s.t, rec, http.StatusOK, "")
	p.access, p.refresh = got.AccessToken, got.RefreshToken
}

// me reads /me with the phone's access token and returns the status.
func (p *phone) me() int {
	p.s.t.Helper()
	return p.send(http.MethodGet, "/me", "", nil).Code
}

// deviceItem is the contract's Device.
type deviceItem struct {
	ID          uuid.UUID `json:"id"`
	Label       string    `json:"label"`
	Platform    string    `json:"platform"`
	AppVersion  string    `json:"app_version"`
	LastSeenAt  time.Time `json:"last_seen_at"`
	PushEnabled bool      `json:"push_enabled"`
	IsCurrent   bool      `json:"is_current"`
}

func (p *phone) devices() []deviceItem {
	p.s.t.Helper()
	rec := p.send(http.MethodGet, "/me/devices", "", nil)
	expect(p.s.t, rec, http.StatusOK, "")
	var list struct {
		Items []deviceItem `json:"items"`
	}
	decode(p.s.t, rec, &list)
	return list.Items
}

func TestAMobileSignInIssuesATokenPairForItsDevice(t *testing.T) {
	s := newSite(t, apptest.Options{})
	s.browser().register(s.a("jana@tilcerovi.cz"), "correct horse battery")
	p := s.phone("Jana's iPhone")
	rec := p.login(s.a("jana@tilcerovi.cz"), "correct horse battery")
	expect(t, rec, http.StatusOK, "")
	var result struct {
		User   meBody `json:"user"`
		Tokens pair   `json:"tokens"`
	}
	decode(t, rec, &result)
	if result.Tokens.ExpiresIn != 900 || result.Tokens.TokenType != "Bearer" || len(rec.Result().Cookies()) != 0 {
		t.Fatalf("%+v, cookies %v", result.Tokens, rec.Result().Cookies())
	}
	unkept(t, rec)
	claims, err := apptest.TokenKeys.Verify(p.access, s.clock.now())
	if err != nil || claims.Subject != result.User.ID {
		t.Fatalf("%+v %v", claims, err)
	}
	if p.me() != http.StatusOK {
		t.Fatal("the access token does not sign the phone in")
	}
	list := p.devices()
	if len(list) != 1 || list[0].ID != p.id || list[0].Label != "Jana's iPhone" || list[0].Platform != "ios" ||
		list[0].AppVersion != "1.0.0" || !list[0].IsCurrent || list[0].PushEnabled {
		t.Fatalf("%+v", list)
	}
	// Past its fifteen minutes the access token signs nobody in; the refresh token still works.
	s.clock.advance(token.Lifetime)
	if p.me() != http.StatusUnauthorized {
		t.Fatal("an expired access token signed the phone in")
	}
	rec, renewed := p.exchange(p.refresh)
	expect(t, rec, http.StatusOK, "")
	unkept(t, rec)
	p.access, p.refresh = renewed.AccessToken, renewed.RefreshToken
	if p.me() != http.StatusOK {
		t.Fatal("the renewed access token does not sign the phone in")
	}
}

// Done when (plan item 9): reuse detection. A refresh token is exchanged once; presented again
// once its minute of grace is over, it revokes the family, whose access tokens then open nothing,
// and the account's owner is told.
func TestARefreshTokenPresentedTwiceRevokesItsFamily(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	s.browser().register(address, "correct horse battery")
	p := s.phone("Kitchen iPad")
	expect(t, p.login(address, "correct horse battery"), http.StatusOK, "")
	stolen := p.refresh
	p.renew()
	before := len(s.outbox.To(address))

	s.clock.advance(device.RetryGrace)
	rec, _ := p.exchange(stolen)
	expect(t, rec, http.StatusUnauthorized, problem.CodeRefreshTokenInvalid)
	if p.me() != http.StatusUnauthorized {
		t.Fatal("the family's access token still signs in after a reuse")
	}
	rec, _ = p.exchange(p.refresh)
	expect(t, rec, http.StatusUnauthorized, problem.CodeRefreshTokenInvalid)
	messages := s.outbox.To(address)
	if len(messages) != before+1 || !strings.Contains(messages[len(messages)-1].Body, "Kitchen iPad") ||
		!strings.Contains(messages[len(messages)-1].Body, apptest.WebURL+"/reset") {
		t.Fatalf("the takeover notice: %+v", messages[before:])
	}
	// Its device is no longer listed among the account's.
	web := s.browser()
	web.login(address, "correct horse battery")
	rec = web.get("/me/devices")
	expect(t, rec, http.StatusOK, "")
	if !strings.Contains(rec.Body.String(), `"items":[]`) {
		t.Fatalf("%s", rec.Body.String())
	}
}

// A refresh whose answer was lost is retried with the same token: within a minute, while the token
// it was exchanged for is unused, it is answered with a new pair (D-98), and the pair the lost
// answer carried is retired, so that a thief who beat the device to it is found out at the
// device's next refresh.
func TestARefreshRetriedWithinAMinuteIsAnsweredAgain(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	s.browser().register(address, "correct horse battery")
	p := s.phone("")
	expect(t, p.login(address, "correct horse battery"), http.StatusOK, "")
	first := p.refresh
	rec, lost := p.exchange(first)
	expect(t, rec, http.StatusOK, "")

	s.clock.advance(30 * time.Second)
	rec, retried := p.exchange(first)
	expect(t, rec, http.StatusOK, "")
	if retried.RefreshToken == lost.RefreshToken || retried.AccessToken == "" {
		t.Fatal("the retry was answered with the lost pair")
	}
	// The retried pair works; the lost one is retired, and presenting it is a reuse.
	p.access, p.refresh = retried.AccessToken, retried.RefreshToken
	p.renew()
	rec, _ = p.exchange(lost.RefreshToken)
	expect(t, rec, http.StatusUnauthorized, problem.CodeRefreshTokenInvalid)
	if p.me() != http.StatusUnauthorized {
		t.Fatal("presenting the retired pair did not revoke the family")
	}

	// The pair a retry retired is a reuse however soon it comes, even while the retry's own pair is
	// still unused: it is never answered as a retry itself.
	r := s.phone("")
	expect(t, r.login(address, "correct horse battery"), http.StatusOK, "")
	first = r.refresh
	rec, lost = r.exchange(first)
	expect(t, rec, http.StatusOK, "")
	s.clock.advance(10 * time.Second)
	rec, retried = r.exchange(first)
	expect(t, rec, http.StatusOK, "")
	s.clock.advance(10 * time.Second)
	rec, _ = r.exchange(lost.RefreshToken)
	expect(t, rec, http.StatusUnauthorized, problem.CodeRefreshTokenInvalid)
	r.access, r.refresh = retried.AccessToken, retried.RefreshToken
	if r.me() != http.StatusUnauthorized {
		t.Fatal("presenting a retired pair within the minute did not revoke the family")
	}

	// Once the token it was exchanged for has been used, a retry is a reuse, however soon.
	q := s.phone("")
	expect(t, q.login(address, "correct horse battery"), http.StatusOK, "")
	first = q.refresh
	q.renew()
	q.renew()
	rec, _ = q.exchange(first)
	expect(t, rec, http.StatusUnauthorized, problem.CodeRefreshTokenInvalid)
	if q.me() != http.StatusUnauthorized {
		t.Fatal("a retry after the next token's use did not revoke the family")
	}
}

// A refresh token presented twice at once is exchanged once: the second presentation waits for the
// first, then finds the token used, and is answered as a retry (D-98), which retires the pair the
// first was given. The two answers never leave two live pairs beside each other, which reuse
// detection would never find.
func TestARefreshTokenPresentedTwiceAtOnceIsExchangedOnce(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	s.browser().register(address, "correct horse battery")
	p := s.phone("")
	expect(t, p.login(address, "correct horse battery"), http.StatusOK, "")

	// The device's sign-in is held, so that both refreshes have read the token before either has
	// its turn.
	ctx := t.Context()
	hold, err := s.admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hold.Rollback(context.WithoutCancel(ctx)) }()
	if _, err := hold.Exec(ctx, "SELECT FROM device_sessions WHERE device_id = $1 AND revoked_at IS NULL FOR UPDATE", p.id); err != nil {
		t.Fatal(err)
	}
	body := jsonBody(t, map[string]string{"refresh_token": p.refresh})
	answers := []*httptest.ResponseRecorder{httptest.NewRecorder(), httptest.NewRecorder()}
	var wg sync.WaitGroup
	for _, rec := range answers {
		r := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/auth/token", strings.NewReader(body))
		r.RemoteAddr = s.peer
		r.Header.Set("Content-Type", "application/json")
		wg.Go(func() { s.router.ServeHTTP(rec, r) })
	}
	for deadline := time.Now().Add(10 * time.Second); s.count(`
		SELECT count(*) FROM pg_stat_activity
		WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM refresh_tokens t%'`) < 2; {
		if time.Now().After(deadline) {
			t.Fatal("the two refreshes never both waited for the sign-in")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := hold.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	for _, rec := range answers {
		expect(t, rec, http.StatusOK, "")
	}
	if live := s.count(`
		SELECT count(*) FROM refresh_tokens t JOIN device_sessions d ON d.id = t.session_id
		WHERE d.device_id = $1 AND d.revoked_at IS NULL AND t.used_at IS NULL`, p.id); live != 1 {
		t.Fatalf("%d refresh tokens are live after one token was exchanged twice at once", live)
	}
}

// Signing in again on a device while it refreshes waits for the refresh rather than deadlocking with
// it: a refresh holds the device's sign-in and then writes the device's row, and a sign-in takes
// them in the same order.
func TestSigningInAgainWhileTheDeviceRefreshesWaitsItsTurn(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	s.browser().register(address, "correct horse battery")
	p := s.phone("iPhone")
	expect(t, p.login(address, "correct horse battery"), http.StatusOK, "")

	// A refresh under way: the sign-in's row held, the device's row written next.
	ctx := t.Context()
	hold, err := s.admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hold.Rollback(context.WithoutCancel(ctx)) }()
	if _, err := hold.Exec(ctx, "SELECT FROM device_sessions WHERE device_id = $1 AND revoked_at IS NULL FOR UPDATE", p.id); err != nil {
		t.Fatal(err)
	}
	body := jsonBody(t, map[string]any{"email": address, "password": "correct horse battery", "client_type": "mobile", "device": p.deviceBody()})
	rec := httptest.NewRecorder()
	r := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
	r.RemoteAddr = s.peer
	r.Header.Set("Content-Type", "application/json")
	var wg sync.WaitGroup
	wg.Go(func() { s.router.ServeHTTP(rec, r) })
	for deadline := time.Now().Add(10 * time.Second); s.count(`
		SELECT count(*) FROM pg_stat_activity
		WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%device_sessions%'`) < 1; {
		if time.Now().After(deadline) {
			t.Fatal("the sign-in never waited for the refresh")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := hold.Exec(ctx, "UPDATE devices SET last_seen_at = now() WHERE id = $1", p.id); err != nil {
		t.Fatalf("the refresh met the sign-in: %v", err)
	}
	if err := hold.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	expect(t, rec, http.StatusOK, "")
	if live := s.count("SELECT count(*) FROM device_sessions WHERE device_id = $1 AND revoked_at IS NULL", p.id); live != 1 {
		t.Fatalf("%d sign-ins are live on one device", live)
	}
}

func TestAnUnknownRefreshTokenOpensNothing(t *testing.T) {
	s := newSite(t, apptest.Options{})
	rec, _ := s.phone("").exchange("made-up")
	expect(t, rec, http.StatusUnauthorized, problem.CodeRefreshTokenInvalid)
}

// The devices a user is signed in on are listed, renamed and revoked; a device revoked opens
// nothing from then on, its access token included, and one another user holds is not found.
func TestDevicesAreListedRenamedAndRevoked(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	s.browser().register(address, "correct horse battery")
	phone, tablet := s.phone("iPhone"), s.phone("iPad")
	phone.version = "1.2.3"
	expect(t, phone.login(address, "correct horse battery"), http.StatusOK, "")
	s.clock.advance(time.Minute)
	expect(t, tablet.login(address, "correct horse battery"), http.StatusOK, "")

	list := phone.devices()
	if len(list) != 2 || list[0].ID != tablet.id || list[1].ID != phone.id || list[0].IsCurrent || !list[1].IsCurrent ||
		list[1].AppVersion != "1.2.3" {
		t.Fatalf("%+v", list)
	}
	rec := phone.send(http.MethodPatch, "/me/devices/"+tablet.id.String(), `{"label":"  Kitchen\u0007 iPad "}`, nil)
	expect(t, rec, http.StatusOK, "")
	var renamed deviceItem
	decode(t, rec, &renamed)
	if renamed.Label != "Kitchen iPad" || renamed.ID != tablet.id || renamed.IsCurrent {
		t.Fatalf("%+v", renamed)
	}
	expect(t, phone.send(http.MethodDelete, "/me/devices/"+tablet.id.String(), "", nil), http.StatusNoContent, "")
	if tablet.me() != http.StatusUnauthorized {
		t.Fatal("a revoked device's access token still signs in")
	}
	rec, _ = tablet.exchange(tablet.refresh)
	expect(t, rec, http.StatusUnauthorized, problem.CodeRefreshTokenInvalid)
	if list := phone.devices(); len(list) != 1 || list[0].ID != phone.id {
		t.Fatalf("%+v", list)
	}
	expect(t, phone.send(http.MethodDelete, "/me/devices/"+tablet.id.String(), "", nil), http.StatusNotFound, problem.CodeNotFound)
	expect(t, phone.send(http.MethodPatch, "/me/devices/"+tablet.id.String(), `{"label":"x"}`, nil), http.StatusNotFound, problem.CodeNotFound)

	// Another user's device, one id the two share on a shared tablet included, is not found.
	other := s.a("petr@tilcerovi.cz")
	s.browser().register(other, "correct horse battery")
	shared := s.phone("Shared")
	shared.id = phone.id
	expect(t, shared.login(other, "correct horse battery"), http.StatusOK, "")
	if list := shared.devices(); len(list) != 1 || list[0].Label != "Shared" {
		t.Fatalf("%+v", list)
	}
	outsider := s.phone("")
	expect(t, outsider.login(other, "correct horse battery"), http.StatusOK, "")
	expect(t, outsider.send(http.MethodDelete, "/me/devices/"+tablet.id.String(), "", nil), http.StatusNotFound, problem.CodeNotFound)
	if phone.me() != http.StatusOK || shared.me() != http.StatusOK {
		t.Fatal("one account's sign-in on a shared device ended the other's")
	}
}

// Signing in again on a device ends the sign-in it held; signing out on it ends its own.
func TestADeviceSignsInOnceAtATime(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	s.browser().register(address, "correct horse battery")
	p := s.phone("iPhone")
	expect(t, p.login(address, "correct horse battery"), http.StatusOK, "")
	earlier := *p
	expect(t, p.login(address, "correct horse battery"), http.StatusOK, "")
	if earlier.me() != http.StatusUnauthorized {
		t.Fatal("the earlier sign-in's access token still signs in")
	}
	rec, _ := earlier.exchange(earlier.refresh)
	expect(t, rec, http.StatusUnauthorized, problem.CodeRefreshTokenInvalid)

	expect(t, p.send(http.MethodPost, "/auth/logout", "", nil), http.StatusNoContent, "")
	if p.me() != http.StatusUnauthorized {
		t.Fatal("a device signed out still signs in")
	}
	rec, _ = p.exchange(p.refresh)
	expect(t, rec, http.StatusUnauthorized, problem.CodeRefreshTokenInvalid)
}

// Signing out everywhere, a password reset and a password change each end the devices' sign-ins:
// a change, every device but the one it was made on.
func TestTheAccountsEndingsReachItsDevices(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	b := s.signUp(address, "correct horse battery")
	p := s.phone("")
	expect(t, p.login(address, "correct horse battery"), http.StatusOK, "")
	expect(t, b.send(request{method: http.MethodDelete, path: "/me/sessions"}), http.StatusNoContent, "")
	if p.me() != http.StatusUnauthorized {
		t.Fatal("signing out everywhere left the device signed in")
	}

	expect(t, p.login(address, "correct horse battery"), http.StatusOK, "")
	other := s.phone("")
	expect(t, other.login(address, "correct horse battery"), http.StatusOK, "")
	current, changed := "correct horse battery", "a new horse battery"
	expect(t, p.send(http.MethodPost, "/auth/password",
		jsonBody(t, map[string]string{"current_password": current, "new_password": changed}), nil), http.StatusNoContent, "")
	if p.me() != http.StatusOK || other.me() != http.StatusUnauthorized {
		t.Fatal("a change made on a device: it stays, the others go")
	}

	b = s.browser()
	expect(t, b.post("/auth/password-reset", jsonBody(t, map[string]string{"email": address})), http.StatusAccepted, "")
	tok, _ := s.token(address)
	expect(t, b.post("/auth/password-reset/confirm", jsonBody(t, map[string]string{"token": tok, "password": "the third horse battery"})),
		http.StatusNoContent, "")
	if p.me() != http.StatusUnauthorized {
		t.Fatal("a reset left the device signed in")
	}
}

// An Authorization header alone decides who a request is: one whose token signs nobody in is not
// signed in by the session cookie it also carries.
func TestABearerTokenAloneDecides(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.signUp(s.a("jana@tilcerovi.cz"), "correct horse battery")
	rec := b.send(request{method: http.MethodGet, path: "/me", header: http.Header{"Authorization": {"Bearer not-a-token"}}})
	expect(t, rec, http.StatusUnauthorized, problem.CodeUnauthenticated)
	if b.get("/me").Code != http.StatusOK {
		t.Fatal("the cookie alone does not sign the browser in")
	}
	// A header in another scheme is not the API's, such as the Basic credentials a browser resends
	// to a proxy that asked for them: the cookie decides.
	basic := "Basic " + base64.StdEncoding.EncodeToString([]byte("staging:"+s.domain))
	rec = b.send(request{method: http.MethodGet, path: "/me", header: http.Header{"Authorization": {basic}}})
	expect(t, rec, http.StatusOK, "")
}

// A change made with an access token arrives via mobile (item 4's hook, filled in by item 9).
func TestADevicesChangeArrivesViaMobile(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	user, _ := w.signIn("jana@mobile.test", "Jana Tilcerová")
	w.join(h, user, access.Member, level(access.Contribute))
	rec := w.webRequest(http.MethodPost, "/api/v1/auth/login", jsonBody(t, map[string]any{
		"email": "jana@mobile.test", "password": "correct horse battery", "client_type": "mobile",
		"device": map[string]any{"id": idgen.New()},
	}), nil)
	expect(t, rec, http.StatusOK, "")
	var result struct {
		Tokens pair `json:"tokens"`
	}
	decode(t, rec, &result)
	it := idgen.New()
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, items(h), strings.NewReader(itemBody(it, h)))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+result.Tokens.AccessToken)
	expect(t, testsupport.ServeContract(t, w.contract, w.router, r), http.StatusCreated, "")
	var via string
	if err := w.admin.QueryRow(t.Context(), "SELECT meta->>'via' FROM audit_events WHERE entity_id = $1", it).Scan(&via); err != nil {
		t.Fatal(err)
	}
	if via != "mobile" {
		t.Fatalf("via %q", via)
	}
}
