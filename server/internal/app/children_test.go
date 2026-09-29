package app_test

import (
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
)

// The tests in this file serve the child profiles of item 11 through the whole router, against the
// committed contract: an owner's browser makes and manages them, and a child's phone signs in with
// the household's code, a profile and a PIN.

// childDoc is the contract's Membership.child, as a client reads it.
type childDoc struct {
	YearOfBirth     *int `json:"year_of_birth"`
	PinLocked       bool `json:"pin_locked"`
	DashboardLocked bool `json:"dashboard_locked"`
}

// childOf reads m's child, and fails for a member who is not a child profile.
func childOf(t *testing.T, m memberDoc) childDoc {
	t.Helper()
	var c childDoc
	if m.Child == nil || string(*m.Child) == "null" {
		t.Fatalf("%s is no child profile: %+v", m.DisplayName, m)
	}
	if err := json.Unmarshal(*m.Child, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

// childLevels are FR-AC4's defaults for a new child profile.
var childLevels = only(map[string]string{
	"chores": "contribute", "shopping": "contribute", "calendar": "contribute", "tasks": "contribute", "pets": "contribute",
	"reminders": "view", "dashboard": "view",
})

func (b *browser) put(path, body string) *httptest.ResponseRecorder {
	b.s.t.Helper()
	return b.send(request{method: http.MethodPut, path: path, body: body})
}

// makeChild asks household h for a child profile named name with pin and fields.
func (b *browser) makeChild(h uuid.UUID, name, pin string, fields map[string]any) *httptest.ResponseRecorder {
	b.s.t.Helper()
	body := map[string]any{"id": idgen.New(), "display_name": name, "pin": pin}
	for k, v := range fields {
		body[k] = v
	}
	return b.post(householdPath(h, "/children"), jsonBody(b.s.t, body))
}

// child makes a child profile named name with pin in household h, and expects 201.
func (b *browser) child(h uuid.UUID, name, pin string, fields map[string]any) memberDoc {
	b.s.t.Helper()
	rec := b.makeChild(h, name, pin, fields)
	expect(b.s.t, rec, http.StatusCreated, "")
	var m memberDoc
	decode(b.s.t, rec, &m)
	return m
}

// profiles looks code up on the phone, the first step of a child's sign-in.
func (p *phone) profiles(code string) *httptest.ResponseRecorder {
	p.s.t.Helper()
	return p.send(http.MethodPost, "/auth/child/profiles", jsonBody(p.s.t, map[string]string{"household_code": code}), nil)
}

// childLogin signs profile in on the phone with code and pin, and keeps the pair it is given.
func (p *phone) childLogin(code string, profile uuid.UUID, pin string) *httptest.ResponseRecorder {
	p.s.t.Helper()
	rec := p.send(http.MethodPost, "/auth/child/login", jsonBody(p.s.t, map[string]any{
		"household_code": code, "profile_id": profile, "pin": pin, "device": p.deviceBody(),
	}), nil)
	p.keep(rec)
	return rec
}

// levels lists the caller's effective level on each of household h's modules, with the phone's
// access token.
func (p *phone) levels(h uuid.UUID) map[string]string {
	p.s.t.Helper()
	rec := p.send(http.MethodGet, householdPath(h, "/modules"), "", nil)
	expect(p.s.t, rec, http.StatusOK, "")
	var list struct {
		Items []struct {
			Module  string `json:"module"`
			MyLevel string `json:"my_level"`
		} `json:"items"`
	}
	decode(p.s.t, rec, &list)
	out := map[string]string{}
	for _, m := range list.Items {
		out[m.Module] = m.MyLevel
	}
	return out
}

// An owner makes a child profile (FR-CH1): an account with no address whose credential is the PIN,
// and a child's membership with FR-AC4's levels under the request's, never manage nor more than view
// on Finance, whose birth year only the owners and the child read. Its id is its account's and its
// membership's, and speaks the household's language.
func TestAnOwnerMakesAChildProfile(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")

	id := idgen.New()
	rec := jana.post(householdPath(h.ID, "/children"), jsonBody(t, map[string]any{
		"id": id, "display_name": "  Adam ", "year_of_birth": 2016, "pin": "1234",
	}))
	expect(t, rec, http.StatusCreated, "")
	if rec.Header().Get("ETag") == "" {
		t.Error("no ETag")
	}
	var adam memberDoc
	decode(t, rec, &adam)
	if adam.UserID != id || adam.DisplayName != "Adam" || adam.Role != "child" || adam.Email != nil || adam.IsBillingPayer {
		t.Fatalf("%+v", adam)
	}
	equal(t, "Adam's grants", adam.Grants, childLevels)
	if c := childOf(t, adam); c.YearOfBirth == nil || *c.YearOfBirth != 2016 || c.PinLocked || !c.DashboardLocked {
		t.Errorf("%+v", c)
	}
	var membership uuid.UUID
	var locale string
	if err := s.admin.QueryRow(t.Context(), `
		SELECT m.id, u.locale FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.user_id = $1`, id).
		Scan(&membership, &locale); err != nil {
		t.Fatal(err)
	}
	if membership != id || locale != "cs" {
		t.Errorf("membership %s, locale %s", membership, locale)
	}
	if n := s.count("SELECT count(*) FROM credentials WHERE user_id = $1 AND type = 'child_pin'", id); n != 1 {
		t.Errorf("%d PINs", n)
	}
	if n := s.count("SELECT count(*) FROM audit_events WHERE household_id = $1 AND action = 'child.create' AND actor_id = $2",
		h.ID, jana.me().ID); n != 1 {
		t.Errorf("%d events", n)
	}

	// Its levels are the request's over the defaults, up to a child's ceiling.
	ema := jana.child(h.ID, "Ema", "123456", map[string]any{
		"grants": map[string]string{"finance": "view", "pets": "none", "notes": "contribute"}, "lock_dashboard": false,
	})
	want := maps.Clone(childLevels)
	want["finance"], want["pets"], want["notes"] = "view", "none", "contribute"
	equal(t, "Ema's grants", ema.Grants, want)
	if childOf(t, ema).DashboardLocked {
		t.Error("Ema's dashboard is locked")
	}

	// Granting a child manage, or more than view on Finance, is refused, at making and after.
	for _, grants := range []map[string]string{{"tasks": "manage"}, {"finance": "contribute"}} {
		var module string
		for m := range grants {
			module = m
		}
		got := fieldErrorsOf(t, jana.makeChild(h.ID, "Bára", "1234", map[string]any{"grants": grants}))
		if !slices.Equal(got, []problem.FieldError{{Field: "/grants/" + module, Code: problem.FieldInvalid}}) {
			t.Errorf("%v: %v", grants, got)
		}
		got = fieldErrorsOf(t, jana.patch(householdPath(h.ID, "/members/"+id.String()), jsonBody(t, map[string]any{"grants": grants}), nil))
		if !slices.Equal(got, []problem.FieldError{{Field: "/grants/" + module, Code: problem.FieldInvalid}}) {
			t.Errorf("%v on Adam: %v", grants, got)
		}
	}
	for _, c := range []struct {
		fields map[string]any
		field  string
	}{
		{map[string]any{"avatar_url": "https://example.com/adam.png"}, "/avatar_url"},
		{map[string]any{"year_of_birth": time.Now().Year() + 1}, "/year_of_birth"},
		{map[string]any{"id": id}, "/id"},
		{map[string]any{"id": jana.me().ID}, "/id"},
	} {
		if got := fieldErrorsOf(t, jana.makeChild(h.ID, "Bára", "1234", c.fields)); len(got) != 1 || got[0].Field != c.field {
			t.Errorf("%v: %v", c.fields, got)
		}
	}
	for _, pin := range []string{"123", "1234567", "12a4"} {
		if got := fieldErrorsOf(t, jana.makeChild(h.ID, "Bára", pin, nil)); len(got) != 1 || got[0].Field != "/pin" {
			t.Errorf("%q: %v", pin, got)
		}
	}

	// Only an owner makes one; a member is refused, and their read of Adam carries no birth year.
	petr, _ := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	expect(t, petr.makeChild(h.ID, "Bára", "1234", nil), http.StatusForbidden, problem.CodeForbidden)
	if c := childOf(t, petr.members(h.ID)["Adam"]); c.YearOfBirth != nil || !c.DashboardLocked {
		t.Errorf("Adam as Petr reads him: %+v", c)
	}
}

// A child signs in on a phone with the household's code, the profile it picks from those the code
// opens, and its PIN (FR-CH1): the code lists the household's child profiles and no adult, and signs
// in nobody by itself; the sign-in is a device's, with no second step, at the child's levels.
func TestAChildSignsInWithTheCodeAProfileAndAPIN(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	adam := jana.child(h.ID, "Adam", "1234", nil)
	ema := jana.child(h.ID, "Ema", "5678", nil)
	petr, _ := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	phone := s.phone("Adam's phone")

	// Case, spaces and dashes do not matter.
	typed := strings.ToLower(h.JoinCode[:4] + " - " + h.JoinCode[4:])
	rec := phone.profiles(typed)
	expect(t, rec, http.StatusOK, "")
	var list struct {
		HouseholdName string `json:"household_name"`
		Items         []struct {
			ID          uuid.UUID `json:"id"`
			DisplayName string    `json:"display_name"`
		} `json:"items"`
	}
	decode(t, rec, &list)
	if list.HouseholdName != "Tilcerovi" || len(list.Items) != 2 || list.Items[0].ID != adam.UserID || list.Items[0].DisplayName != "Adam" ||
		list.Items[1].ID != ema.UserID {
		t.Fatalf("%+v", list)
	}
	expect(t, phone.profiles("ABCD2345"), http.StatusNotFound, problem.CodeNotFound)

	// What does not match signs nobody in, alike.
	for _, c := range []struct {
		code    string
		profile uuid.UUID
		pin     string
	}{
		{h.JoinCode, adam.UserID, "0000"},
		{h.JoinCode, adam.UserID, "5678"},
		{"ABCD2345", adam.UserID, "1234"},
		{h.JoinCode, petr.me().ID, "1234"},
		{h.JoinCode, idgen.New(), "1234"},
	} {
		expect(t, phone.childLogin(c.code, c.profile, c.pin), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	}
	if got := fieldErrorsOf(t, phone.send(http.MethodPost, "/auth/child/login", jsonBody(t, map[string]any{
		"household_code": h.JoinCode, "profile_id": adam.UserID, "pin": "1234",
	}), nil)); len(got) != 1 || got[0].Field != "/device" {
		t.Errorf("no device: %v", got)
	}

	rec = phone.childLogin(typed, adam.UserID, "1234")
	expect(t, rec, http.StatusOK, "")
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Error("a sign-in's answer may be cached")
	}
	var result struct {
		User meBody `json:"user"`
	}
	decode(t, rec, &result)
	if result.User.ID != adam.UserID || !result.User.IsChild || result.User.Email != nil ||
		!slices.Equal(result.User.Credentials, []string{"child_pin"}) || result.User.Locale != "cs" {
		t.Fatalf("%+v", result.User)
	}
	equal(t, "Adam's levels", phone.levels(h.ID), childLevels)
	devices := phone.send(http.MethodGet, "/me/devices", "", nil)
	expect(t, devices, http.StatusOK, "")
	if !strings.Contains(devices.Body.String(), phone.id.String()) {
		t.Errorf("the device is not listed: %s", devices.Body)
	}
	// A shared tablet signs each profile in once, a sign-in of its own each (D-104).
	tablet := s.phone("Kitchen iPad")
	expect(t, tablet.childLogin(h.JoinCode, ema.UserID, "5678"), http.StatusOK, "")
	emaOnTablet := tablet.access
	expect(t, tablet.childLogin(h.JoinCode, adam.UserID, "1234"), http.StatusOK, "")
	tablet.access = emaOnTablet
	if tablet.me() != http.StatusOK {
		t.Error("Ema's sign-in on the tablet ended when Adam's began")
	}

	// A new code opens the household from then on; the old one opens nothing, and the sign-ins it made
	// stay.
	expect(t, jana.post(householdPath(h.ID, "/join-code"), ""), http.StatusOK, "")
	expect(t, phone.profiles(h.JoinCode), http.StatusNotFound, problem.CodeNotFound)
	expect(t, s.phone("Another").childLogin(h.JoinCode, adam.UserID, "1234"), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	if phone.me() != http.StatusOK {
		t.Error("a new code ended a sign-in")
	}
}

// Thirty codes that open no household in an hour stop a network's lookups; a code that opens one is
// not counted.
func TestCodeLookupsFromANetworkAreLimited(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	phone := s.phone("Adam's phone")
	for i := range ratelimit.ChildCodeNetwork.Max {
		expect(t, phone.profiles(fmt.Sprintf("ZZZZ%04d", i)[:8]), http.StatusNotFound, problem.CodeNotFound)
		if i == 0 {
			expect(t, phone.profiles(h.JoinCode), http.StatusOK, "")
		}
	}
	expect(t, phone.profiles(h.JoinCode), http.StatusTooManyRequests, problem.CodeRateLimited)
}

// Ten wrong PINs since the last right one lock a profile until an owner unlocks it (FR-CH5, D-104):
// the tenth answers 423, as does every attempt after it, the right PIN's included; the lock is the
// system's change of the membership, which the owners read; a right PIN clears the count.
func TestTenWrongPINsLockAProfileUntilAnOwnerUnlocksIt(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	adam := jana.child(h.ID, "Adam", "1234", nil)
	phone := s.phone("Adam's phone")
	wrong := func(n int) {
		t.Helper()
		for range n {
			expect(t, phone.childLogin(h.JoinCode, adam.UserID, "0000"), http.StatusUnauthorized, problem.CodeInvalidCredentials)
		}
	}

	wrong(household.LockAfter - 1)
	expect(t, phone.childLogin(h.JoinCode, adam.UserID, "1234"), http.StatusOK, "")
	wrong(household.LockAfter - 1)
	expect(t, phone.childLogin(h.JoinCode, adam.UserID, "0000"), http.StatusLocked, problem.CodeChildProfileLocked)
	expect(t, phone.childLogin(h.JoinCode, adam.UserID, "1234"), http.StatusLocked, problem.CodeChildProfileLocked)
	if !childOf(t, jana.members(h.ID)["Adam"]).PinLocked {
		t.Fatal("the member list shows Adam unlocked")
	}
	if n := s.count(`SELECT count(*) FROM audit_events WHERE household_id = $1 AND action = 'child.lock'
		AND actor_type = 'system' AND actor_id IS NULL`, h.ID); n != 1 {
		t.Errorf("%d lock events", n)
	}
	if n := s.count("SELECT count(*) FROM sync_changes WHERE household_id = $1 AND entity_id = $2 AND payload->'child'->>'pin_locked' = 'true'",
		h.ID, adam.UserID); n != 1 {
		t.Errorf("%d changes carry the lock", n)
	}

	// Only an owner unlocks, a child profile alone.
	petr, petrID := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	expect(t, petr.post(householdPath(h.ID, "/children/"+adam.UserID.String()+"/unlock"), ""), http.StatusForbidden, problem.CodeForbidden)
	expect(t, jana.post(householdPath(h.ID, "/children/"+petrID.String()+"/unlock"), ""), http.StatusNotFound, problem.CodeNotFound)
	expect(t, jana.post(householdPath(h.ID, "/children/"+adam.UserID.String()+"/unlock"), ""), http.StatusNoContent, "")
	if childOf(t, jana.members(h.ID)["Adam"]).PinLocked {
		t.Fatal("the member list shows Adam locked")
	}
	expect(t, phone.childLogin(h.JoinCode, adam.UserID, "1234"), http.StatusOK, "")
	// Unlocking a profile that is not locked records nothing.
	events := s.count("SELECT count(*) FROM audit_events WHERE household_id = $1 AND action = 'child.unlock'", h.ID)
	expect(t, jana.post(householdPath(h.ID, "/children/"+adam.UserID.String()+"/unlock"), ""), http.StatusNoContent, "")
	if n := s.count("SELECT count(*) FROM audit_events WHERE household_id = $1 AND action = 'child.unlock'", h.ID); n != events || n != 1 {
		t.Errorf("%d unlock events, %d before", n, events)
	}
}

// PINs sent at once meet the lock one by one: of fifteen wrong ones sent together, ten are checked,
// the tenth locking the profile, and the other five are refused unchecked.
func TestPINsSentAtOnceAreCountedOneByOne(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	adam := jana.child(h.ID, "Adam", "1234", nil)
	var wrong, locked atomic.Int32
	var wg sync.WaitGroup
	for range 15 {
		p := s.phone("Adam's phone")
		wg.Go(func() {
			switch rec := p.childLogin(h.JoinCode, adam.UserID, "0000"); rec.Code {
			case http.StatusUnauthorized:
				wrong.Add(1)
			case http.StatusLocked:
				locked.Add(1)
			default:
				t.Errorf("%d %s", rec.Code, rec.Body)
			}
		})
	}
	wg.Wait()
	if wrong.Load() != household.LockAfter-1 || locked.Load() != 15-(household.LockAfter-1) {
		t.Fatalf("%d wrong and %d locked", wrong.Load(), locked.Load())
	}
	if n := s.count("SELECT failures FROM credentials WHERE user_id = $1", adam.UserID); n != household.LockAfter {
		t.Fatalf("%d failures counted", n)
	}
	if n := s.count("SELECT count(*) FROM audit_events WHERE household_id = $1 AND action = 'child.lock'", h.ID); n != 1 {
		t.Errorf("%d lock events", n)
	}
}

// An owner sets a new PIN (FR-CH5): the old one signs nobody in, the profile is unlocked, and every
// device it was signed in on is signed out (D-104).
func TestAnOwnerSetsANewPIN(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	adam := jana.child(h.ID, "Adam", "1234", nil)
	phone := s.phone("Adam's phone")
	expect(t, phone.childLogin(h.JoinCode, adam.UserID, "1234"), http.StatusOK, "")
	guesser := s.phone("Somebody's")
	for range household.LockAfter {
		guesser.childLogin(h.JoinCode, adam.UserID, "0000")
	}

	path := householdPath(h.ID, "/children/"+adam.UserID.String()+"/pin")
	expect(t, jana.put(path, jsonBody(t, map[string]string{"pin": "24680"})), http.StatusNoContent, "")
	if phone.me() != http.StatusUnauthorized {
		t.Error("the phone is still signed in")
	}
	if childOf(t, jana.members(h.ID)["Adam"]).PinLocked {
		t.Error("Adam is still locked")
	}
	expect(t, phone.childLogin(h.JoinCode, adam.UserID, "1234"), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	expect(t, phone.childLogin(h.JoinCode, adam.UserID, "24680"), http.StatusOK, "")
	if n := s.count("SELECT count(*) FROM audit_events WHERE household_id = $1 AND action = 'child.pin'", h.ID); n != 1 {
		t.Errorf("%d events", n)
	}
	// Only an owner sets one, for a child profile alone, and no key is kept for it.
	petr, petrID := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	expect(t, petr.put(path, jsonBody(t, map[string]string{"pin": "1111"})), http.StatusForbidden, problem.CodeForbidden)
	expect(t, jana.put(householdPath(h.ID, "/children/"+petrID.String()+"/pin"), jsonBody(t, map[string]string{"pin": "1111"})),
		http.StatusNotFound, problem.CodeNotFound)
	keyed := jana.send(request{method: http.MethodPut, path: path, body: jsonBody(t, map[string]string{"pin": "1357"}),
		header: http.Header{"Idempotency-Key": {"a-pin"}}})
	expect(t, keyed, http.StatusNoContent, "")
	if n := s.count("SELECT count(*) FROM idempotency_keys WHERE key = 'a-pin'"); n != 0 {
		t.Errorf("%d keys kept for a PIN", n)
	}
}

// graduationToken is the token in the link of the last graduation mailed to address.
func (s *site) graduationToken(address string) string {
	s.t.Helper()
	token, m := s.token(address)
	if !strings.Contains(m.Body, apptest.WebURL+"/graduate#token=") {
		s.t.Fatalf("the last message to %s is no graduation: %q", address, m.Body)
	}
	return token
}

// A graduation (FR-CH4): a verified owner sends the address the profile is to have a link, with which
// the young adult chooses a password; the profile is a child, signing in with its PIN, until then,
// and a member after, with the address verified, the password its credential, its devices signed out,
// and everything it made and its levels kept. A link works once, for 14 days, and a newer one replaces
// it.
func TestAChildProfileGraduates(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	adam := jana.child(h.ID, "Adam", "1234", map[string]any{"year_of_birth": 2008, "grants": map[string]string{"notes": "contribute"}})
	phone := s.phone("Adam's phone")
	expect(t, phone.childLogin(h.JoinCode, adam.UserID, "1234"), http.StatusOK, "")
	// Something Adam made, which stays his.
	made := idgen.New()
	arrange(t, s, func(tx pgx.Tx) {
		exec(t, tx, `INSERT INTO audit_events (id, household_id, actor_type, actor_id, actor_label, module, action, summary_key)
			VALUES ($1, $2, 'user', $3, 'Adam', 'admin', 'member.update', 'admin.member.update')`, made, h.ID, adam.UserID)
	})
	path := householdPath(h.ID, "/children/"+adam.UserID.String()+"/graduate")

	first := s.a("adam@tilcerovi.cz")
	expect(t, jana.post(path, jsonBody(t, map[string]string{"email": first})), http.StatusAccepted, "")
	oldLink := s.graduationToken(first)
	address := s.a("adam.tilcer@tilcerovi.cz")
	expect(t, jana.post(path, jsonBody(t, map[string]string{"email": address})), http.StatusAccepted, "")
	link := s.graduationToken(address)
	// Until the link is opened, Adam is a child, who signs in with the PIN.
	if m := jana.members(h.ID)["Adam"]; m.Role != "child" || m.Email != nil {
		t.Fatalf("%+v", m)
	}
	expect(t, s.phone("Adam's tablet").childLogin(h.JoinCode, adam.UserID, "1234"), http.StatusOK, "")

	confirm := func(token, pw string) *httptest.ResponseRecorder {
		t.Helper()
		return s.browser().post("/auth/graduation/confirm", jsonBody(t, map[string]string{"token": token, "password": pw}))
	}
	expect(t, confirm(oldLink, passphrase), http.StatusGone, problem.CodeTokenAlreadyUsed)
	expect(t, confirm("no-such-link", passphrase), http.StatusNotFound, problem.CodeNotFound)
	if got := fieldErrorsOf(t, confirm(link, breached)); len(got) != 1 || got[0].Field != "/password" {
		t.Errorf("a breached password: %v", got)
	}
	expect(t, confirm(link, passphrase), http.StatusNoContent, "")
	expect(t, confirm(link, passphrase), http.StatusGone, problem.CodeTokenAlreadyUsed)

	m := jana.members(h.ID)["Adam"]
	if m.UserID != adam.UserID || m.Role != "member" || m.Email == nil || *m.Email != address ||
		(m.Child != nil && string(*m.Child) != "null") || m.LastActiveAt == nil {
		t.Fatalf("%+v", m)
	}
	equal(t, "Adam's grants", m.Grants, adam.Grants)
	if phone.me() != http.StatusUnauthorized {
		t.Error("the phone is still signed in with the PIN")
	}
	expect(t, phone.childLogin(h.JoinCode, adam.UserID, "1234"), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	b := s.browser()
	me := b.login(address, passphrase)
	if me.ID != adam.UserID || me.IsChild || !me.EmailVerified || !slices.Equal(me.Credentials, []string{"password"}) {
		t.Fatalf("%+v", me)
	}
	if n := s.count("SELECT count(*) FROM audit_events WHERE id = $1 AND actor_id = $2", made, adam.UserID); n != 1 {
		t.Error("what Adam made is gone")
	}
	if n := s.count(`SELECT count(*) FROM audit_events WHERE household_id = $1 AND action = 'member.graduate'
		AND actor_id = $2 AND meta->>'via' = 'web'`, h.ID, adam.UserID); n != 1 {
		t.Errorf("%d graduation events", n)
	}
	var year *int
	if err := s.admin.QueryRow(t.Context(), "SELECT year_of_birth FROM memberships WHERE user_id = $1", adam.UserID).Scan(&year); err != nil ||
		year != nil {
		t.Errorf("the birth year is kept: %v %v", year, err)
	}
	// A member is no child profile to graduate.
	expect(t, jana.post(path, jsonBody(t, map[string]string{"email": s.a("again@tilcerovi.cz")})), http.StatusNotFound, problem.CodeNotFound)
}

// A graduation's refusals: an address an account has, at sending and at opening; an owner whose own
// address is unverified; a member who is not an owner; and a link past its 14 days.
func TestAGraduationsRefusals(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	adam := jana.child(h.ID, "Adam", "1234", nil)
	path := householdPath(h.ID, "/children/"+adam.UserID.String()+"/graduate")

	expect(t, jana.post(path, jsonBody(t, map[string]string{"email": strings.ToUpper(s.a("jana@tilcerovi.cz"))})),
		http.StatusConflict, problem.CodeEmailTaken)
	petr, _ := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	expect(t, petr.post(path, jsonBody(t, map[string]string{"email": s.a("adam@tilcerovi.cz")})), http.StatusForbidden, problem.CodeForbidden)
	klara := s.unverified("Klára", s.a("klara@tilcerovi.cz"))
	h2 := klara.create("Chata")
	bara := klara.child(h2.ID, "Bára", "1234", nil)
	expect(t, klara.post(householdPath(h2.ID, "/children/"+bara.UserID.String()+"/graduate"),
		jsonBody(t, map[string]string{"email": s.a("bara@tilcerovi.cz")})), http.StatusForbidden, problem.CodeAccountUnverified)

	// An address taken between the sending and the opening.
	address := s.a("adam@tilcerovi.cz")
	expect(t, jana.post(path, jsonBody(t, map[string]string{"email": address})), http.StatusAccepted, "")
	link := s.graduationToken(address)
	s.browser().register(strings.ToUpper(address), passphrase)
	expect(t, s.browser().post("/auth/graduation/confirm", jsonBody(t, map[string]string{"token": link, "password": passphrase})),
		http.StatusConflict, problem.CodeEmailTaken)
	if m := jana.members(h.ID)["Adam"]; m.Role != "child" {
		t.Fatalf("Adam graduated: %+v", m)
	}

	// A link past its time.
	other := s.a("adam.t@tilcerovi.cz")
	expect(t, jana.post(path, jsonBody(t, map[string]string{"email": other})), http.StatusAccepted, "")
	link = s.graduationToken(other)
	s.clock.advance(household.GraduateFor + time.Minute)
	expect(t, s.browser().post("/auth/graduation/confirm", jsonBody(t, map[string]string{"token": link, "password": passphrase})),
		http.StatusGone, problem.CodeTokenExpired)
}

// A child profile is managed by its household's owners (D-17, D-104): it cannot make a household of its
// own, leave its household, or link a provider that would sign it in past its PIN; and, as item 10
// has it, it cannot invite or change the household's settings.
func TestAChildProfileIsManaged(t *testing.T) {
	s, _ := federated(t, apptest.Options{})
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	adam := jana.child(h.ID, "Adam", "1234", map[string]any{"grants": map[string]string{"admin": "view"}})
	phone := s.phone("Adam's phone")
	expect(t, phone.childLogin(h.JoinCode, adam.UserID, "1234"), http.StatusOK, "")

	expect(t, phone.send(http.MethodPost, "/households", jsonBody(t, map[string]any{
		"id": idgen.New(), "name": "Adam's", "country": "CZ", "timezone": "Europe/Prague", "base_currency": "CZK", "locale": "cs",
	}), nil), http.StatusForbidden, problem.CodeForbidden)
	expect(t, phone.send(http.MethodPost, householdPath(h.ID, "/leave"), "", nil), http.StatusForbidden, problem.CodeForbidden)
	expect(t, phone.send(http.MethodPost, "/auth/oauth/google/link", jsonBody(t, map[string]string{
		"code": "a-code", "state": "a-state", "code_verifier": verifier,
	}), nil), http.StatusForbidden, problem.CodeForbidden)
	expect(t, phone.send(http.MethodPost, householdPath(h.ID, "/invitations"), jsonBody(t, map[string]any{
		"id": idgen.New(), "kind": "link", "role": "member",
	}), nil), http.StatusForbidden, problem.CodeForbidden)
	expect(t, phone.send(http.MethodPatch, householdPath(h.ID, ""), jsonBody(t, map[string]any{"name": "Adam's"}), nil),
		http.StatusForbidden, problem.CodeForbidden)
	if n := s.count("SELECT count(*) FROM memberships WHERE user_id = $1", adam.UserID); n != 1 {
		t.Errorf("Adam is in %d households", n)
	}
}
