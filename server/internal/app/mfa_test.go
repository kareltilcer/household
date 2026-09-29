package app_test

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/mfa"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
)

// The tests in this file serve item 9's second step (FR-ID5) through the whole router.

// code is secret's authenticator code at s's now.
func (s *site) code(secret string) string {
	s.t.Helper()
	c, err := mfa.Code(secret, mfa.Step(s.clock.now()))
	if err != nil {
		s.t.Fatal(err)
	}
	return c
}

// nextCode moves s's clock to the next time step, since a code is accepted once, and returns its
// code.
func (s *site) nextCode(secret string) string {
	s.clock.advance(mfa.Period)
	return s.code(secret)
}

// enrol turns the second step on for b's account, whose password is pw, and returns its secret and
// its recovery codes.
func (b *browser) enrol(pw string) (string, []string) {
	b.s.t.Helper()
	rec := b.post("/auth/mfa/enroll", jsonBody(b.s.t, map[string]string{"password": pw}))
	expect(b.s.t, rec, http.StatusOK, "")
	var e struct {
		Secret string `json:"secret"`
		URI    string `json:"otpauth_uri"`
	}
	decode(b.s.t, rec, &e)
	rec = b.post("/auth/mfa/activate", jsonBody(b.s.t, map[string]string{"code": b.s.code(e.Secret)}))
	expect(b.s.t, rec, http.StatusOK, "")
	var codes struct {
		RecoveryCodes []string `json:"recovery_codes"`
	}
	decode(b.s.t, rec, &codes)
	return e.Secret, codes.RecoveryCodes
}

// challenge is the contract's MfaChallenge.
type challenge struct {
	Error             string   `json:"error"`
	ChallengeToken    string   `json:"challenge_token"`
	Methods           []string `json:"methods"`
	RecoveryCodesLeft int      `json:"recovery_codes_left"`
}

// challenged expects rec to be a sign-in's challenge, and returns it.
func challenged(t *testing.T, rec *httptest.ResponseRecorder) challenge {
	t.Helper()
	expect(t, rec, http.StatusConflict, "")
	var c challenge
	decode(t, rec, &c)
	if c.Error != "mfa_required" || c.ChallengeToken == "" || len(rec.Result().Cookies()) != 0 {
		t.Fatalf("%+v, cookies %v", c, rec.Result().Cookies())
	}
	return c
}

// verify answers challenge c with code from b.
func (b *browser) verify(c challenge, code string, remember bool) *httptest.ResponseRecorder {
	b.s.t.Helper()
	return b.post("/auth/mfa/verify", jsonBody(b.s.t, map[string]any{"challenge_token": c.ChallengeToken, "code": code, "remember_device": remember}))
}

func (b *browser) signIn(address, pw string) *httptest.ResponseRecorder {
	b.s.t.Helper()
	return b.post("/auth/login", jsonBody(b.s.t, map[string]string{"email": address, "password": pw, "client_type": "web"}))
}

func TestTurningOnTheSecondStep(t *testing.T) {
	s := newSite(t, apptest.Options{})
	b := s.signUp(s.a("jana@tilcerovi.cz"), "correct horse battery")
	expect(t, b.post("/auth/mfa/enroll", jsonBody(t, map[string]string{"password": "wrong horse battery"})),
		http.StatusUnauthorized, problem.CodeInvalidCredentials)
	expect(t, b.post("/auth/mfa/activate", jsonBody(t, map[string]string{"code": "123456"})), http.StatusUnprocessableEntity, problem.CodeValidationFailed)

	rec := b.post("/auth/mfa/enroll", jsonBody(t, map[string]string{"password": "correct horse battery"}))
	expect(t, rec, http.StatusOK, "")
	var e struct {
		Secret string `json:"secret"`
		URI    string `json:"otpauth_uri"`
	}
	decode(t, rec, &e)
	if !strings.HasPrefix(e.URI, "otpauth://totp/Household:") || !strings.Contains(e.URI, "secret="+e.Secret) {
		t.Fatalf("%+v", e)
	}
	if me := b.me(); me.MFAEnabled {
		t.Fatal("an enrolment is on before its first code")
	}
	if got := fieldErrorsOf(t, b.post("/auth/mfa/activate", jsonBody(t, map[string]string{"code": "000000"}))); !slices.Equal(got,
		[]problem.FieldError{{Field: "/code", Code: problem.FieldInvalid}}) {
		t.Fatalf("%v", got)
	}
	// The answer carries the recovery codes, which no Idempotency-Key keeps: a repeat answers 409.
	rec = b.send(request{method: http.MethodPost, path: "/auth/mfa/activate", body: jsonBody(t, map[string]string{"code": s.code(e.Secret)}),
		header: withKey("activate")})
	expect(t, rec, http.StatusOK, "")
	var codes struct {
		RecoveryCodes []string `json:"recovery_codes"`
	}
	decode(t, rec, &codes)
	if len(codes.RecoveryCodes) != 10 {
		t.Fatalf("%v", codes)
	}
	repeat := b.send(request{method: http.MethodPost, path: "/auth/mfa/activate", body: jsonBody(t, map[string]string{"code": s.code(e.Secret)}),
		header: withKey("activate")})
	expect(t, repeat, http.StatusConflict, problem.CodeIdempotencyInProgress)
	if strings.Contains(repeat.Body.String(), codes.RecoveryCodes[0]) {
		t.Fatal("a repeat was answered with the codes")
	}
	if n := s.count("SELECT count(*) FROM account_idempotency_keys WHERE key = 'activate' AND body IS NOT NULL"); n != 0 {
		t.Fatal("a key kept the codes")
	}
	var raw struct {
		MFAEnabled bool `json:"mfa_enabled"`
		Left       *int `json:"mfa_recovery_codes_left"`
	}
	decode(t, b.get("/me"), &raw)
	if !raw.MFAEnabled || raw.Left == nil || *raw.Left != 10 {
		t.Fatalf("%+v", raw)
	}
	// The secret is sealed, and no code is kept in the clear.
	if n := s.count("SELECT count(*) FROM mfa_totp WHERE position($1::bytea IN secret) > 0", []byte(e.Secret)); n != 0 {
		t.Fatal("the secret is kept in the clear")
	}
}

// Done when (plan item 9): the MFA new-device rule. With the second step on, a sign-in from a
// browser or a device that is not trusted is challenged, and signs in only once the challenge is
// answered; answered to remember it, that browser, or that device, is trusted for thirty days.
func TestTheSecondStepIsAskedOfEveryBrowserAndDeviceNotTrusted(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	secret, _ := s.signUp(address, "correct horse battery").enrol("correct horse battery")

	b := s.browser()
	c := challenged(t, b.signIn(address, "correct horse battery"))
	if !slices.Equal(c.Methods, []string{"totp", "recovery_code"}) || c.RecoveryCodesLeft != 10 {
		t.Fatalf("%+v", c)
	}
	if b.get("/me").Code != http.StatusUnauthorized {
		t.Fatal("a challenged sign-in is signed in")
	}
	rec := b.verify(c, s.nextCode(secret), true)
	expect(t, rec, http.StatusOK, "")
	var trust *http.Cookie
	for _, ck := range rec.Result().Cookies() {
		if ck.Name == "__Host-hh_trust" {
			trust = ck
		}
	}
	if trust == nil || !trust.HttpOnly || !trust.Secure || trust.MaxAge != int((30*24*time.Hour).Seconds()) {
		t.Fatalf("the trust cookie: %+v", trust)
	}
	if me := b.me(); me.Email == nil || *me.Email != address {
		t.Fatalf("%+v", me)
	}
	// The trusted browser signs in without the second step; another browser does not.
	expect(t, b.signIn(address, "correct horse battery"), http.StatusOK, "")
	challenged(t, s.browser().signIn(address, "correct horse battery"))
	// Thirty days on, the browser is asked again.
	s.clock.advance(30 * 24 * time.Hour)
	challenged(t, b.signIn(address, "correct horse battery"))

	// A device alike: challenged, then trusted by the token it is given.
	p := s.phone("iPhone")
	rec = p.login(address, "correct horse battery")
	c = challenged(t, rec)
	rec = p.send(http.MethodPost, "/auth/mfa/verify", jsonBody(t, map[string]any{"challenge_token": c.ChallengeToken,
		"code": s.nextCode(secret), "remember_device": true}), nil)
	expect(t, rec, http.StatusOK, "")
	var result struct {
		Tokens     *pair   `json:"tokens"`
		TrustToken *string `json:"trust_token"`
	}
	decode(t, rec, &result)
	if result.Tokens == nil || result.TrustToken == nil || len(rec.Result().Cookies()) != 0 {
		t.Fatalf("%+v", result)
	}
	p.keep(rec)
	if list := p.devices(); len(list) != 1 || list[0].ID != p.id || list[0].Label != "iPhone" {
		t.Fatalf("the device the challenge was for: %+v", list)
	}
	expect(t, p.login(address, "correct horse battery", map[string]any{"trust_token": *result.TrustToken}), http.StatusOK, "")
	challenged(t, p.login(address, "correct horse battery"))
	challenged(t, s.phone("").login(address, "correct horse battery", map[string]any{"trust_token": "made-up"}))
}

// Wrong codes are limited per account, and the tenth since the last right one locks the
// authenticator and ends the account's challenges; a recovery code, spent and emailed about,
// unlocks it (D-100).
func TestWrongCodesLockTheSecondStepUntilARecoveryCode(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	secret, codes := s.signUp(address, "correct horse battery").enrol("correct horse battery")
	b := s.browser()
	c := challenged(t, b.signIn(address, "correct horse battery"))
	for range ratelimit.MFAAccount.Max {
		expect(t, b.verify(c, "000000", false), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	}
	rec := b.verify(c, s.nextCode(secret), false)
	expect(t, rec, http.StatusTooManyRequests, problem.CodeRateLimited)
	s.clock.advance(ratelimit.MFAAccount.Window)
	other := challenged(t, s.browser().signIn(address, "correct horse battery"))
	for range 4 {
		expect(t, b.verify(c, "000000", false), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	}
	// The tenth locks it, and ends every challenge the account had.
	expect(t, b.verify(c, "000000", false), http.StatusLocked, problem.CodeMfaLocked)
	s.clock.advance(ratelimit.MFAAccount.Window)
	expect(t, b.verify(c, s.nextCode(secret), false), http.StatusUnauthorized, problem.CodeUnauthenticated)
	expect(t, b.verify(other, s.nextCode(secret), false), http.StatusUnauthorized, problem.CodeUnauthenticated)

	// Locked, a sign-in is offered only a recovery code, and a code from the app is refused.
	c = challenged(t, b.signIn(address, "correct horse battery"))
	if !slices.Equal(c.Methods, []string{"recovery_code"}) {
		t.Fatalf("%+v", c)
	}
	expect(t, b.verify(c, s.nextCode(secret), false), http.StatusLocked, problem.CodeMfaLocked)
	c = challenged(t, b.signIn(address, "correct horse battery"))
	before := len(s.outbox.To(address))
	expect(t, b.verify(c, strings.ToLower(codes[3]), false), http.StatusOK, "")
	messages := s.outbox.To(address)
	if len(messages) != before+1 || !strings.Contains(messages[len(messages)-1].Body, "You have 9 left.") {
		t.Fatalf("%+v", messages[before:])
	}
	// Unlocked; the spent code is spent.
	c = challenged(t, s.browser().signIn(address, "correct horse battery"))
	if !slices.Equal(c.Methods, []string{"totp", "recovery_code"}) || c.RecoveryCodesLeft != 9 {
		t.Fatalf("%+v", c)
	}
	expect(t, b.verify(c, codes[3], false), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	expect(t, b.verify(c, s.nextCode(secret), false), http.StatusOK, "")
}

// A code from the app is accepted once: a second challenge answered with it is refused.
func TestACodeIsAcceptedOnce(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	secret, _ := s.signUp(address, "correct horse battery").enrol("correct horse battery")
	b := s.browser()
	first := challenged(t, b.signIn(address, "correct horse battery"))
	second := challenged(t, s.browser().signIn(address, "correct horse battery"))
	code := s.nextCode(secret)
	expect(t, b.verify(first, code, false), http.StatusOK, "")
	expect(t, b.verify(second, code, false), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	// A challenge lasts ten minutes.
	s.clock.advance(11 * time.Minute)
	expect(t, b.verify(second, s.code(secret), false), http.StatusUnauthorized, problem.CodeUnauthenticated)
}

// Turning the second step off, with the password, removes it, trusts no browser any longer, and
// tells the account's address; new recovery codes retire the old ones.
func TestTurningTheSecondStepOffAndMakingNewCodes(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	b := s.signUp(address, "correct horse battery")
	_, codes := b.enrol("correct horse battery")

	expect(t, b.post("/auth/mfa/recovery-codes", jsonBody(t, map[string]string{"password": "wrong horse battery"})),
		http.StatusUnauthorized, problem.CodeInvalidCredentials)
	rec := b.post("/auth/mfa/recovery-codes", jsonBody(t, map[string]string{"password": "correct horse battery"}))
	expect(t, rec, http.StatusOK, "")
	var fresh struct {
		RecoveryCodes []string `json:"recovery_codes"`
	}
	decode(t, rec, &fresh)
	c := challenged(t, s.browser().signIn(address, "correct horse battery"))
	expect(t, b.verify(c, codes[0], false), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	expect(t, b.verify(c, fresh.RecoveryCodes[0], true), http.StatusOK, "")
	if s.count("SELECT count(*) FROM mfa_trusts WHERE user_id = $1", b.me().ID) != 1 {
		t.Fatal("no trust was kept")
	}

	expect(t, b.post("/auth/mfa/disable", jsonBody(t, map[string]string{"password": "wrong horse battery"})),
		http.StatusUnauthorized, problem.CodeInvalidCredentials)
	before := len(s.outbox.To(address))
	expect(t, b.post("/auth/mfa/disable", jsonBody(t, map[string]string{"password": "correct horse battery"})), http.StatusNoContent, "")
	if messages := s.outbox.To(address); len(messages) != before+1 || !strings.Contains(messages[len(messages)-1].Subject, "second step") {
		t.Fatalf("%+v", messages[before:])
	}
	me := b.me()
	if me.MFAEnabled || s.count("SELECT count(*) FROM mfa_trusts WHERE user_id = $1", me.ID) != 0 ||
		s.count("SELECT count(*) FROM mfa_recovery_codes WHERE user_id = $1", me.ID) != 0 {
		t.Fatalf("%+v", me)
	}
	expect(t, s.browser().signIn(address, "correct horse battery"), http.StatusOK, "")
	expect(t, b.post("/auth/mfa/recovery-codes", jsonBody(t, map[string]string{"password": "correct horse battery"})),
		http.StatusNotFound, problem.CodeNotFound)
	// Off already, it answers alike, and tells no one.
	expect(t, b.post("/auth/mfa/disable", jsonBody(t, map[string]string{"password": "correct horse battery"})), http.StatusNoContent, "")
	if len(s.outbox.To(address)) != before+1 {
		t.Fatal("turning off a second step already off sent an email")
	}
}

// A password reset keeps the second step on, and ends every trust and every challenge.
func TestAResetKeepsTheSecondStepAndEndsItsTrust(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@tilcerovi.cz")
	secret, _ := s.signUp(address, "correct horse battery").enrol("correct horse battery")
	b := s.browser()
	expect(t, b.verify(challenged(t, b.signIn(address, "correct horse battery")), s.nextCode(secret), true), http.StatusOK, "")
	waiting := challenged(t, s.browser().signIn(address, "correct horse battery"))

	expect(t, b.post("/auth/password-reset", jsonBody(t, map[string]string{"email": address})), http.StatusAccepted, "")
	tok, _ := s.token(address)
	reset := "a new horse battery"
	expect(t, b.post("/auth/password-reset/confirm", jsonBody(t, map[string]string{"token": tok, "password": reset})),
		http.StatusNoContent, "")
	expect(t, b.verify(waiting, s.nextCode(secret), false), http.StatusUnauthorized, problem.CodeUnauthenticated)
	challenged(t, b.signIn(address, reset))
}
