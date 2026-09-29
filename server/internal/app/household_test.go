package app_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// The tests in this file serve the household surface of item 10 through the whole router, against
// the committed contract, as a browser calls it.

// hookLog records what the household surface tells the items that plug into it.
type hookLog struct {
	mu      sync.Mutex
	created []uuid.UUID
	lost    []household.Loss
	changed []household.Change
}

func (h *hookLog) hooks() household.Hooks {
	return household.Hooks{
		Created: func(_ context.Context, _ pgx.Tx, id uuid.UUID) error {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.created = append(h.created, id)
			return nil
		},
		Lost: func(_ context.Context, _ pgx.Tx, loss household.Loss) error {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.lost = append(h.lost, loss)
			return nil
		},
		Changed: func(_ context.Context, change household.Change) {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.changed = append(h.changed, change)
		},
	}
}

// take returns what h recorded, and forgets it.
func (h *hookLog) take() ([]uuid.UUID, []household.Loss, []household.Change) {
	h.mu.Lock()
	defer h.mu.Unlock()
	created, lost, changed := h.created, h.lost, h.changed
	h.created, h.lost, h.changed = nil, nil, nil
	return created, lost, changed
}

// newHouseholdSite is a site whose household surface reports to a hook log.
func newHouseholdSite(t *testing.T) (*site, *hookLog) {
	t.Helper()
	log := &hookLog{}
	return newSite(t, apptest.Options{Hooks: log.hooks()}), log
}

// passphrase is every test person's password.
const passphrase = "correct horse battery"

// person registers name at address, verifies the address and signs in.
func (s *site) person(name, address string) *browser {
	s.t.Helper()
	b := s.unverified(name, address)
	s.verify(address)
	return b
}

var verificationLink = regexp.MustCompile(`/verify-email#token=([A-Za-z0-9_-]+)`)

// verify opens the link of the last verification mailed to address.
func (s *site) verify(address string) {
	s.t.Helper()
	messages := s.outbox.To(address)
	for i := len(messages) - 1; i >= 0; i-- {
		if m := verificationLink.FindStringSubmatch(messages[i].Body); m != nil {
			rec := s.browser().post("/auth/verify-email", jsonBody(s.t, map[string]string{"token": m[1]}))
			expect(s.t, rec, http.StatusNoContent, "")
			return
		}
	}
	s.t.Fatalf("no verification to %s", address)
}

// unverified registers name at address and signs in, without verifying the address.
func (s *site) unverified(name, address string) *browser {
	s.t.Helper()
	b := s.browser()
	rec := b.post("/auth/register", jsonBody(s.t, map[string]string{"email": address, "password": passphrase, "display_name": name}))
	expect(s.t, rec, http.StatusAccepted, "")
	b.login(address, passphrase)
	return b
}

func (b *browser) patch(path, body string, header http.Header) *httptest.ResponseRecorder {
	b.s.t.Helper()
	return b.send(request{method: http.MethodPatch, path: path, body: body, header: header})
}

func (b *browser) delete(path string) *httptest.ResponseRecorder {
	b.s.t.Helper()
	return b.send(request{method: http.MethodDelete, path: path})
}

// householdDoc is the contract's Household, as a client reads it.
type householdDoc struct {
	ID             uuid.UUID         `json:"id"`
	Name           string            `json:"name"`
	Country        string            `json:"country"`
	Timezone       string            `json:"timezone"`
	BaseCurrency   string            `json:"base_currency"`
	Locale         string            `json:"locale"`
	Units          string            `json:"units"`
	FirstDayOfWeek int               `json:"first_day_of_week"`
	Version        int64             `json:"version"`
	JoinCode       string            `json:"join_code"`
	MyRole         string            `json:"my_role"`
	MyGrants       map[string]string `json:"my_grants"`
}

// memberDoc is the contract's Membership, as a client reads it.
type memberDoc struct {
	UserID         uuid.UUID         `json:"user_id"`
	DisplayName    string            `json:"display_name"`
	Email          *string           `json:"email"`
	Role           string            `json:"role"`
	Grants         map[string]string `json:"grants"`
	IsBillingPayer bool              `json:"is_billing_payer"`
	LastActiveAt   *time.Time        `json:"last_active_at"`
	Version        int64             `json:"version"`
	Child          *json.RawMessage  `json:"child"`
}

// invitationDoc is the contract's Invitation, as a client reads it.
type invitationDoc struct {
	ID        uuid.UUID         `json:"id"`
	Kind      string            `json:"kind"`
	Email     *string           `json:"email"`
	Role      string            `json:"role"`
	Grants    map[string]string `json:"grants"`
	URL       *string           `json:"url"`
	Status    string            `json:"status"`
	ExpiresAt time.Time         `json:"expires_at"`
	MaxUses   int               `json:"max_uses"`
	Uses      int               `json:"uses"`
}

// preview is the contract's InvitationForInvitee, as a client reads it.
type preview struct {
	Token         string `json:"token"`
	HouseholdName string `json:"household_name"`
	InvitedBy     string `json:"invited_by"`
	Role          string `json:"role"`
	Modules       []struct {
		Module string `json:"module"`
		Level  string `json:"level"`
	} `json:"modules"`
	Message *string `json:"message"`
}

// create creates a Czech household named name and expects 201.
func (b *browser) create(name string) householdDoc {
	b.s.t.Helper()
	rec := b.post("/households", jsonBody(b.s.t, map[string]any{
		"id": idgen.New(), "name": name, "country": "CZ", "timezone": "Europe/Prague", "base_currency": "CZK", "locale": "cs",
	}))
	expect(b.s.t, rec, http.StatusCreated, "")
	var h householdDoc
	decode(b.s.t, rec, &h)
	return h
}

func householdPath(h uuid.UUID, rest string) string { return fmt.Sprintf("/households/%s%s", h, rest) }

// invite sends an invitation to household h with fields, and expects 201.
func (b *browser) invite(h uuid.UUID, fields map[string]any) invitationDoc {
	b.s.t.Helper()
	fields["id"] = idgen.New()
	rec := b.post(householdPath(h, "/invitations"), jsonBody(b.s.t, fields))
	expect(b.s.t, rec, http.StatusCreated, "")
	var i invitationDoc
	decode(b.s.t, rec, &i)
	return i
}

// members lists household h's members, by display name.
func (b *browser) members(h uuid.UUID) map[string]memberDoc {
	b.s.t.Helper()
	rec := b.get(householdPath(h, "/members"))
	expect(b.s.t, rec, http.StatusOK, "")
	var list struct {
		Items []memberDoc `json:"items"`
	}
	decode(b.s.t, rec, &list)
	out := map[string]memberDoc{}
	for _, m := range list.Items {
		out[m.DisplayName] = m
	}
	return out
}

// levels lists the caller's effective level on each of household h's modules.
func (b *browser) levels(h uuid.UUID) map[string]string {
	b.s.t.Helper()
	rec := b.get(householdPath(h, "/modules"))
	expect(b.s.t, rec, http.StatusOK, "")
	var list struct {
		Items []struct {
			Module  string `json:"module"`
			Enabled bool   `json:"enabled"`
			MyLevel string `json:"my_level"`
		} `json:"items"`
	}
	decode(b.s.t, rec, &list)
	out := map[string]string{}
	for _, m := range list.Items {
		out[m.Module] = m.MyLevel
	}
	return out
}

// all is level on every module.
func all(level string) map[string]string {
	out := map[string]string{}
	for _, m := range household.Modules {
		out[m] = level
	}
	return out
}

// only is none on every module but those levels names.
func only(levels map[string]string) map[string]string {
	out := all("none")
	for m, l := range levels {
		out[m] = l
	}
	return out
}

var invitationLink = regexp.MustCompile(`https://app\.household\.test/invitation#token=([A-Za-z0-9_-]+)`)

// invitationToken is the token in the link of the last invitation mailed to address.
func (s *site) invitationToken(address string) string {
	s.t.Helper()
	messages := s.outbox.To(address)
	for i := len(messages) - 1; i >= 0; i-- {
		if m := invitationLink.FindStringSubmatch(messages[i].Body); m != nil {
			return m[1]
		}
	}
	s.t.Fatalf("no invitation to %s", address)
	return ""
}

func equal(t *testing.T, what string, got, want map[string]string) {
	t.Helper()
	if !mapsEqual(got, want) {
		t.Errorf("%s: %v, want %v", what, got, want)
	}
}

func mapsEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if w, ok := b[k]; !ok || w != v {
			return false
		}
	}
	return true
}

// Any user may create a household, verified or not (FR-HH1), and becomes its owner and payer: it
// starts with every module enabled and its owner on Manage, its country's units and first day, a
// household code, and its trial; its creation is recorded, and changes every row it made.
func TestCreatingAHousehold(t *testing.T) {
	s, hooks := newHouseholdSite(t)
	jana := s.unverified("Jana", s.a("jana@tilcerovi.cz"))
	id := idgen.New()
	body := jsonBody(t, map[string]any{
		"id": id, "name": "  Tilcerovi ", "country": "CZ", "timezone": "Europe/Prague", "base_currency": "CZK", "locale": "cs-cz",
	})
	key := http.Header{"Idempotency-Key": {"create-1"}}
	rec := jana.send(request{method: http.MethodPost, path: "/households", body: body, header: key})
	expect(t, rec, http.StatusCreated, "")
	var h householdDoc
	decode(t, rec, &h)
	if h.ID != id || h.Name != "Tilcerovi" || h.Locale != "cs-CZ" || h.Units != "metric" || h.FirstDayOfWeek != 1 ||
		h.Version != 1 || h.MyRole != "owner" || rec.Header().Get("ETag") != `"1"` {
		t.Fatalf("created %+v, ETag %s", h, rec.Header().Get("ETag"))
	}
	if !regexp.MustCompile(`^[A-HJ-NP-Z2-9]{8}$`).MatchString(h.JoinCode) {
		t.Errorf("household code %q", h.JoinCode)
	}
	equal(t, "the creator's levels", h.MyGrants, all("manage"))
	if created, _, _ := hooks.take(); !slices.Equal(created, []uuid.UUID{id}) {
		t.Errorf("the trial hook ran for %v", created)
	}

	// A repeat with the key is answered as the first was, and makes nothing.
	again := jana.send(request{method: http.MethodPost, path: "/households", body: body, header: key})
	if again.Code != http.StatusCreated || again.Body.String() != rec.Body.String() {
		t.Fatalf("the repeat answered %d %s", again.Code, again.Body.String())
	}
	if n := s.count("SELECT count(*) FROM households WHERE id = $1", id); n != 1 {
		t.Fatalf("%d households", n)
	}
	// Without the key, the id is another household's.
	fields := fieldErrorsOf(t, jana.post("/households", body))
	if len(fields) != 1 || fields[0].Field != "/id" {
		t.Errorf("a taken id: %v", fields)
	}

	if n := s.count(`SELECT count(*) FROM module_enablement WHERE household_id = $1 AND enabled`, id); n != len(household.Modules) {
		t.Errorf("%d modules enabled", n)
	}
	if n := s.count(`SELECT count(*) FROM module_grants WHERE household_id = $1 AND level = 'manage'`, id); n != len(household.Modules) {
		t.Errorf("%d grants of manage", n)
	}
	if n := s.count(`SELECT count(*) FROM households h JOIN users u ON u.id = h.billing_payer_id
		WHERE h.id = $1 AND u.email = $2`, id, s.a("jana@tilcerovi.cz")); n != 1 {
		t.Error("the creator is not the payer")
	}
	if n := s.count(`SELECT count(*) FROM audit_events WHERE household_id = $1 AND module = 'admin' AND action = 'household.create'
		AND summary_args ->> 'household' = 'Tilcerovi' AND actor_label = 'Jana'`, id); n != 1 {
		t.Errorf("%d creation events", n)
	}
	if n := s.count(`SELECT count(*) FROM sync_changes WHERE household_id = $1`, id); n != len(household.Modules)+2 {
		t.Errorf("%d changes: want the settings, the membership and every module's enablement", n)
	}

	rec = jana.get("/households")
	expect(t, rec, http.StatusOK, "")
	var list struct {
		Items []struct {
			ID          uuid.UUID `json:"id"`
			Name        string    `json:"name"`
			MyRole      string    `json:"my_role"`
			MemberCount int       `json:"member_count"`
		} `json:"items"`
	}
	decode(t, rec, &list)
	if len(list.Items) != 1 || list.Items[0].ID != id || list.Items[0].Name != "Tilcerovi" ||
		list.Items[0].MyRole != "owner" || list.Items[0].MemberCount != 1 {
		t.Errorf("the list: %+v", list.Items)
	}

	// A British household in imperial units starting on Sunday says so; its country's first day
	// would have been Monday.
	rec = jana.post("/households", jsonBody(t, map[string]any{
		"id": idgen.New(), "name": "Flat", "country": "GB", "timezone": "Europe/London", "base_currency": "GBP", "locale": "en-GB",
		"units": "imperial", "first_day_of_week": 0,
	}))
	expect(t, rec, http.StatusCreated, "")
	decode(t, rec, &h)
	if h.Units != "imperial" || h.FirstDayOfWeek != 0 {
		t.Errorf("the British household: %+v", h)
	}

	for field, value := range map[string]any{
		"/country": "US", "/timezone": "Mars/Olympus", "/base_currency": "ABC", "/locale": "x-home", "/name": "Tilcerovi" + string(rune(0x202e)),
	} {
		fields := map[string]any{
			"id": idgen.New(), "name": "Tilcerovi", "country": "CZ", "timezone": "Europe/Prague", "base_currency": "CZK", "locale": "cs",
		}
		fields[strings.TrimPrefix(field, "/")] = value
		errs := fieldErrorsOf(t, jana.post("/households", jsonBody(t, fields)))
		if len(errs) != 1 || errs[0].Field != field {
			t.Errorf("%s %v: %v", field, value, errs)
		}
	}
}

// The five personas of design/v1's fixtures.js, joined as the product joins them, hold exactly the
// fixture's grants (plan item 10's Done-when): Jana creates Tilcerovi and pays for it, Petr, Klára and
// Miloš accept email invitations carrying their levels, and Jana makes Adam's child profile with his,
// which he signs in to on his phone (item 11). Accepting gives exactly what was proposed.
func TestThePersonasGrantsResolveAsTheFixtureHasThem(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")

	fixture := map[string]map[string]string{
		"Petr":  only(map[string]string{"dashboard": "view", "shopping": "contribute", "utilities": "manage", "admin": "view"}),
		"Klára": only(map[string]string{"dashboard": "view", "shopping": "contribute", "chat": "view"}),
		"Miloš": only(map[string]string{"dashboard": "view", "documents": "view", "garden": "manage", "admin": "view"}),
		"Adam": only(map[string]string{
			"dashboard": "view", "tasks": "contribute", "calendar": "view", "shopping": "contribute", "chores": "contribute",
			"notes": "view", "chat": "view",
		}),
	}
	browsers := map[string]*browser{}
	for _, name := range []string{"Petr", "Klára", "Miloš"} {
		address := s.a(strings.ToLower(strings.NewReplacer("á", "a", "š", "s").Replace(name)) + "@tilcerovi.cz")
		i := jana.invite(h.ID, map[string]any{"kind": "email", "email": address, "role": "member", "grants": fixture[name]})
		equal(t, name+"'s invitation", i.Grants, fixture[name])
		browsers[name] = s.person(name, address)
		rec := browsers[name].post("/me/invitations/"+s.invitationToken(address)+"/accept", "")
		expect(t, rec, http.StatusOK, "")
		var m memberDoc
		decode(t, rec, &m)
		if m.Role != "member" {
			t.Errorf("%s joined as %s", name, m.Role)
		}
		equal(t, name+"'s membership", m.Grants, fixture[name])
	}

	adam := jana.child(h.ID, "Adam", "1234", map[string]any{"grants": fixture["Adam"]})
	equal(t, "Adam's profile", adam.Grants, fixture["Adam"])
	onPhone := s.phone("Adam's phone")
	expect(t, onPhone.childLogin(h.JoinCode, adam.UserID, "1234"), http.StatusOK, "")

	members := jana.members(h.ID)
	if len(members) != 5 {
		t.Fatalf("%d members", len(members))
	}
	equal(t, "Jana's grants", members["Jana"].Grants, all("manage"))
	if !members["Jana"].IsBillingPayer || members["Jana"].Role != "owner" {
		t.Errorf("Jana: %+v", members["Jana"])
	}
	for name, want := range fixture {
		equal(t, name+"'s grants", members[name].Grants, want)
		if members[name].IsBillingPayer {
			t.Errorf("%s is a payer", name)
		}
	}
	if members["Adam"].Role != "child" || members["Adam"].Child == nil || members["Petr"].Child != nil {
		t.Errorf("Adam: %+v; Petr: %+v", members["Adam"], members["Petr"])
	}
	// Every member reads every member's grants (FR-HA3), and an address is an owner's and its own to
	// read.
	seen := browsers["Klára"].members(h.ID)
	equal(t, "Petr's grants as Klára sees them", seen["Petr"].Grants, fixture["Petr"])
	if seen["Petr"].Email != nil || seen["Klára"].Email == nil || members["Petr"].Email == nil {
		t.Errorf("addresses: Petr to Klára %v, Klára to herself %v, Petr to Jana %v",
			seen["Petr"].Email, seen["Klára"].Email, members["Petr"].Email)
	}
	// What each can do resolves to the fixture's levels, every module being enabled.
	equal(t, "Jana's levels", jana.levels(h.ID), all("manage"))
	for name, b := range browsers {
		equal(t, name+"'s levels", b.levels(h.ID), fixture[name])
	}
	equal(t, "Adam's levels", onPhone.levels(h.ID), fixture["Adam"])
}

// arrange runs fn in a transaction as the administrator, and commits it.
func arrange(t *testing.T, s *site, fn func(pgx.Tx)) {
	t.Helper()
	if err := pgx.BeginFunc(t.Context(), s.admin, func(tx pgx.Tx) error { fn(tx); return nil }); err != nil {
		t.Fatal(err)
	}
}

func exec(t *testing.T, tx pgx.Tx, sql string, args ...any) {
	t.Helper()
	if _, err := tx.Exec(t.Context(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

// An email invitation is sent by a verified owner to an address that is no member's and has no
// invitation waiting; it shows exactly what it gives, is accepted once by the verified account with
// its address and no other, and expires in 14 days.
func TestAnEmailInvitation(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.unverified("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petr := s.a("petr@tilcerovi.cz")
	invitation := map[string]any{"id": idgen.New(), "kind": "email", "email": petr, "role": "member",
		"grants": map[string]string{"garden": "manage"}, "message": "  Welcome aboard!\nJana  "}
	expect(t, jana.post(householdPath(h.ID, "/invitations"), jsonBody(t, invitation)), http.StatusForbidden, problem.CodeAccountUnverified)
	s.verify(s.a("jana@tilcerovi.cz"))

	for field, change := range map[string]map[string]any{
		"/role":           {"role": "child"},
		"/email":          {"email": s.a("jana@tilcerovi.cz")},
		"/grants/nothing": {"grants": map[string]string{"nothing": "view"}},
		"/max_uses":       {"max_uses": 2},
	} {
		body := map[string]any{"id": idgen.New(), "kind": "email", "email": petr, "role": "member"}
		for k, v := range change {
			body[k] = v
		}
		errs := fieldErrorsOf(t, jana.post(householdPath(h.ID, "/invitations"), jsonBody(t, body)))
		if len(errs) != 1 || errs[0].Field != field {
			t.Errorf("%s: %v", field, errs)
		}
	}

	i := jana.invite(h.ID, invitation)
	want := only(map[string]string{
		"dashboard": "contribute", "tasks": "contribute", "reminders": "contribute", "calendar": "contribute",
		"shopping": "contribute", "chores": "contribute", "notes": "contribute", "chat": "contribute", "pets": "contribute",
		"documents": "view", "activity": "view", "admin": "view", "garden": "manage",
	})
	if i.Status != "pending" || i.URL != nil || i.MaxUses != 1 || i.Uses != 0 || !i.ExpiresAt.Equal(s.clock.now().Add(household.EmailFor)) {
		t.Errorf("the invitation: %+v", i)
	}
	equal(t, "the proposed grants, the member defaults with Garden raised", i.Grants, want)
	errs := fieldErrorsOf(t, jana.post(householdPath(h.ID, "/invitations"), jsonBody(t, map[string]any{
		"id": idgen.New(), "kind": "email", "email": strings.ToUpper(petr), "role": "member",
	})))
	if len(errs) != 1 || errs[0].Field != "/email" {
		t.Errorf("a second invitation to the address: %v", errs)
	}

	messages := s.outbox.To(petr)
	// In the household's language, the address having no account whose language it could be.
	if len(messages) != 1 || messages[0].Subject != "Jana vás zve do domácnosti Tilcerovi v aplikaci Household" ||
		!strings.Contains(messages[0].Body, "Welcome aboard!\nJana") {
		t.Fatalf("the invitation's email: %+v", messages)
	}
	link := s.invitationToken(petr)

	rec := s.browser().get("/me/invitations/" + link)
	expect(t, rec, http.StatusOK, "")
	var p preview
	decode(t, rec, &p)
	if p.Token != link || p.HouseholdName != "Tilcerovi" || p.InvitedBy != "Jana" || p.Role != "member" ||
		p.Message == nil || *p.Message != "Welcome aboard!\nJana" || len(p.Modules) != len(household.Modules) {
		t.Errorf("the preview: %+v", p)
	}
	expect(t, s.browser().get("/me/invitations/no-such-token"), http.StatusNotFound, problem.CodeNotFound)

	// Another account holding the link is not its addressee, and an addressee must verify first.
	mallory := s.person("Mallory", s.a("mallory@example.com"))
	expect(t, mallory.post("/me/invitations/"+link+"/accept", ""), http.StatusNotFound, problem.CodeNotFound)
	petrs := s.unverified("Petr", petr)
	expect(t, petrs.post("/me/invitations/"+link+"/accept", ""), http.StatusForbidden, problem.CodeAccountUnverified)
	s.verify(petr)

	rec = petrs.post("/me/invitations/"+link+"/accept", "")
	expect(t, rec, http.StatusOK, "")
	var m memberDoc
	decode(t, rec, &m)
	equal(t, "Petr's grants", m.Grants, want)
	if m.Role != "member" || m.Email == nil || m.Version != 1 {
		t.Errorf("Petr's membership: %+v", m)
	}
	expect(t, petrs.post("/me/invitations/"+link+"/accept", ""), http.StatusGone, problem.CodeTokenAlreadyUsed)
	expect(t, s.browser().get("/me/invitations/"+link), http.StatusGone, problem.CodeTokenAlreadyUsed)
	if n := s.count(`SELECT count(*) FROM audit_events WHERE household_id = $1 AND action = 'member.join' AND actor_label = 'Petr'`, h.ID); n != 1 {
		t.Errorf("%d join events", n)
	}

	// An invitation 14 days old has expired.
	klara := s.a("klara@tilcerovi.cz")
	jana.invite(h.ID, map[string]any{"kind": "email", "email": klara, "role": "owner"})
	late := s.invitationToken(klara)
	s.clock.advance(household.EmailFor)
	expect(t, s.browser().get("/me/invitations/"+late), http.StatusGone, problem.CodeTokenExpired)
	expect(t, s.person("Klára", klara).post("/me/invitations/"+late+"/accept", ""), http.StatusGone, problem.CodeTokenExpired)
}

// A link invitation is accepted by as many accounts as it names within 72 hours, by anyone who holds
// it, and is answered once: its Idempotency-Key does not keep the response that carries it.
func TestALinkInvitation(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	errs := fieldErrorsOf(t, jana.post(householdPath(h.ID, "/invitations"), jsonBody(t, map[string]any{
		"id": idgen.New(), "kind": "link", "email": s.a("petr@tilcerovi.cz"), "role": "member",
	})))
	if len(errs) != 1 || errs[0].Field != "/email" {
		t.Errorf("a link with an address: %v", errs)
	}

	// It carries a starting dashboard, which item 36 applies, kept as it was sent.
	layout := map[string]any{"entries": []map[string]any{{"widget_key": "shopping.list", "visible": true, "size": "medium"}}}
	body := jsonBody(t, map[string]any{"id": idgen.New(), "kind": "link", "role": "member", "max_uses": 2, "dashboard_layout": layout})
	key := http.Header{"Idempotency-Key": {"link-1"}}
	rec := jana.send(request{method: http.MethodPost, path: householdPath(h.ID, "/invitations"), body: body, header: key})
	expect(t, rec, http.StatusCreated, "")
	var i invitationDoc
	decode(t, rec, &i)
	if i.URL == nil || i.MaxUses != 2 || !i.ExpiresAt.Equal(s.clock.now().Add(household.LinkFor)) {
		t.Fatalf("the link: %+v", i)
	}
	if n := s.count(`SELECT count(*) FROM invitations WHERE id = $1
		AND dashboard_layout = '{"entries": [{"widget_key": "shopping.list", "visible": true, "size": "medium"}]}'::jsonb`, i.ID); n != 1 {
		t.Error("the starting dashboard is not kept")
	}
	none := jana.invite(h.ID, map[string]any{"kind": "link", "role": "member", "dashboard_layout": nil})
	if n := s.count(`SELECT count(*) FROM invitations WHERE id = $1 AND dashboard_layout IS NULL`, none.ID); n != 1 {
		t.Error("a null starting dashboard is kept as one")
	}
	link := invitationLink.FindStringSubmatch(*i.URL)[1]
	again := jana.send(request{method: http.MethodPost, path: householdPath(h.ID, "/invitations"), body: body, header: key})
	expect(t, again, http.StatusConflict, problem.CodeIdempotencyInProgress)

	for n, name := range []string{"Petr", "Klára"} {
		b := s.person(name, s.a(fmt.Sprintf("p%d@example.com", n)))
		expect(t, b.post("/me/invitations/"+link+"/accept", ""), http.StatusOK, "")
	}
	third := s.person("Miloš", s.a("milos@example.com"))
	expect(t, third.post("/me/invitations/"+link+"/accept", ""), http.StatusGone, problem.CodeTokenAlreadyUsed)
	if got := jana.members(h.ID); len(got) != 3 {
		t.Errorf("%d members", len(got))
	}

	i = jana.invite(h.ID, map[string]any{"kind": "link", "role": "member"})
	s.clock.advance(household.LinkFor)
	expect(t, third.post("/me/invitations/"+invitationLink.FindStringSubmatch(*i.URL)[1]+"/accept", ""),
		http.StatusGone, problem.CodeTokenExpired)
}

// Declining closes the invitation and tells the owner who sent it (FR-HH3, A-25); sending it again
// opens it with a new link, which replaces the old one.
func TestDecliningTellsTheInviter(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petr := s.a("petr@tilcerovi.cz")
	i := jana.invite(h.ID, map[string]any{"kind": "email", "email": petr, "role": "member"})
	link := s.invitationToken(petr)
	petrs := s.unverified("Petr", petr)

	expect(t, s.unverified("Mallory", s.a("mallory@example.com")).post("/me/invitations/"+link+"/decline", ""),
		http.StatusNotFound, problem.CodeNotFound)
	expect(t, petrs.post("/me/invitations/"+link+"/decline", ""), http.StatusNoContent, "")
	told := s.outbox.To(s.a("jana@tilcerovi.cz"))
	if len(told) == 0 || told[len(told)-1].Subject != "Petr declined your invitation to Tilcerovi" {
		t.Fatalf("the inviter was told: %+v", told)
	}
	expect(t, petrs.post("/me/invitations/"+link+"/decline", ""), http.StatusNotFound, problem.CodeNotFound)
	expect(t, s.browser().get("/me/invitations/"+link), http.StatusGone, problem.CodeTokenAlreadyUsed)

	expect(t, jana.post(householdPath(h.ID, "/invitations/"+i.ID.String()+"/resend"), ""), http.StatusAccepted, "")
	fresh := s.invitationToken(petr)
	if fresh == link {
		t.Fatal("the resend sent the old link")
	}
	expect(t, s.browser().get("/me/invitations/"+link), http.StatusNotFound, problem.CodeNotFound)
	expect(t, s.browser().get("/me/invitations/"+fresh), http.StatusOK, "")
	rec := jana.get(householdPath(h.ID, "/invitations"))
	expect(t, rec, http.StatusOK, "")
	var list struct {
		Items []invitationDoc `json:"items"`
	}
	decode(t, rec, &list)
	if len(list.Items) != 1 || list.Items[0].Status != "pending" {
		t.Errorf("the invitations: %+v", list.Items)
	}

	// Withdrawn, it works no more; a link has no address to send again to.
	expect(t, jana.delete(householdPath(h.ID, "/invitations/"+i.ID.String())), http.StatusNoContent, "")
	expect(t, s.browser().get("/me/invitations/"+fresh), http.StatusGone, problem.CodeTokenAlreadyUsed)
	l := jana.invite(h.ID, map[string]any{"kind": "link", "role": "member"})
	expect(t, jana.post(householdPath(h.ID, "/invitations/"+l.ID.String()+"/resend"), ""), http.StatusNotFound, problem.CodeNotFound)
}

// The invitations waiting for a verified address are listed to its account, each by its id, which
// its addressee may accept by; nobody else may.
func TestTheInvitationsAddressedToMe(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petr := s.a("petr@tilcerovi.cz")
	petrs := s.unverified("Petr", petr)
	i := jana.invite(h.ID, map[string]any{"kind": "email", "email": petr, "role": "member"})

	listed := func(b *browser) []preview {
		rec := b.get("/me/invitations")
		expect(t, rec, http.StatusOK, "")
		var list struct {
			Items []preview `json:"items"`
		}
		decode(t, rec, &list)
		return list.Items
	}
	if got := listed(petrs); len(got) != 0 {
		t.Fatalf("an unverified address is listed %+v", got)
	}
	s.verify(petr)
	got := listed(petrs)
	if len(got) != 1 || got[0].Token != i.ID.String() || got[0].HouseholdName != "Tilcerovi" {
		t.Fatalf("listed %+v", got)
	}
	mallory := s.person("Mallory", s.a("mallory@example.com"))
	if len(listed(mallory)) != 0 {
		t.Error("another account is listed the invitation")
	}
	expect(t, mallory.post("/me/invitations/"+i.ID.String()+"/accept", ""), http.StatusNotFound, problem.CodeNotFound)
	expect(t, s.browser().get("/me/invitations/"+i.ID.String()), http.StatusNotFound, problem.CodeNotFound)
	expect(t, petrs.get("/me/invitations/"+i.ID.String()), http.StatusOK, "")
	expect(t, petrs.post("/me/invitations/"+i.ID.String()+"/accept", ""), http.StatusOK, "")
	if len(listed(petrs)) != 0 {
		t.Error("an accepted invitation is still listed")
	}
}

// An email invitation to someone who has joined since, by another invitation, asks them into a
// household they are in: it is not sent again, as inviting their address anew is refused, it is not
// listed to them, and they do not decline it, nor the link they joined by, whose closing would shut
// out those it may still bring in and tell its inviter of a refusal that is not one.
func TestAnInvitationToSomeoneWhoJoinedIsNotSentAgain(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petr := s.a("petr@tilcerovi.cz")
	petrs := s.person("Petr", petr)
	declined := jana.invite(h.ID, map[string]any{"kind": "email", "email": petr, "role": "member"})
	expect(t, petrs.post("/me/invitations/"+declined.ID.String()+"/decline", ""), http.StatusNoContent, "")
	waiting := jana.invite(h.ID, map[string]any{"kind": "email", "email": petr, "role": "member"})

	listed := func() int {
		rec := petrs.get("/me/invitations")
		expect(t, rec, http.StatusOK, "")
		var list struct {
			Items []preview `json:"items"`
		}
		decode(t, rec, &list)
		return len(list.Items)
	}
	if n := listed(); n != 1 {
		t.Fatalf("%d invitations listed before Petr joined", n)
	}
	// Nor is the declined one sent again while the other waits: an address has one invitation waiting,
	// as inviting it anew is refused.
	expect(t, jana.post(householdPath(h.ID, "/invitations/"+declined.ID.String()+"/resend"), ""), http.StatusNotFound, problem.CodeNotFound)
	if n := listed(); n != 1 {
		t.Fatalf("%d invitations listed after the declined one was sent again", n)
	}
	link := jana.invite(h.ID, map[string]any{"kind": "link", "role": "member", "max_uses": 2})
	token := invitationLink.FindStringSubmatch(*link.URL)[1]
	expect(t, petrs.post("/me/invitations/"+token+"/accept", ""), http.StatusOK, "")
	if n := listed(); n != 0 {
		t.Errorf("%d invitations listed to a member", n)
	}

	told := len(s.outbox.To(s.a("jana@tilcerovi.cz")))
	expect(t, petrs.post("/me/invitations/"+waiting.ID.String()+"/decline", ""), http.StatusNotFound, problem.CodeNotFound)
	expect(t, petrs.post("/me/invitations/"+token+"/decline", ""), http.StatusNotFound, problem.CodeNotFound)
	if n := len(s.outbox.To(s.a("jana@tilcerovi.cz"))); n != told {
		t.Errorf("the inviter was told of %d refusals by a member", n-told)
	}
	klara := s.person("Klára", s.a("klara@tilcerovi.cz"))
	expect(t, klara.post("/me/invitations/"+token+"/accept", ""), http.StatusOK, "")

	sent := len(s.outbox.To(petr))
	for _, i := range []invitationDoc{declined, waiting} {
		expect(t, jana.post(householdPath(h.ID, "/invitations/"+i.ID.String()+"/resend"), ""), http.StatusNotFound, problem.CodeNotFound)
	}
	if n := len(s.outbox.To(petr)); n != sent {
		t.Errorf("%d invitations mailed to a member", n-sent)
	}
}

// A household sends twenty invitations a day, resends among them (PRD 02 §9); one refused sends
// nothing, and is not counted.
func TestAHouseholdSendsTwentyInvitationsADay(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	i := jana.invite(h.ID, map[string]any{"kind": "email", "email": s.a("petr@tilcerovi.cz"), "role": "member"})
	var l invitationDoc
	for range 18 {
		l = jana.invite(h.ID, map[string]any{"kind": "link", "role": "member"})
	}
	errs := fieldErrorsOf(t, jana.post(householdPath(h.ID, "/invitations"), jsonBody(t, map[string]any{
		"id": idgen.New(), "kind": "email", "email": s.a("petr@tilcerovi.cz"), "role": "member",
	})))
	if len(errs) != 1 || errs[0].Field != "/email" {
		t.Errorf("a second invitation to the address: %v", errs)
	}
	expect(t, jana.post(householdPath(h.ID, "/invitations/"+l.ID.String()+"/resend"), ""), http.StatusNotFound, problem.CodeNotFound)
	expect(t, jana.post(householdPath(h.ID, "/invitations/"+i.ID.String()+"/resend"), ""), http.StatusAccepted, "")
	rec := jana.post(householdPath(h.ID, "/invitations"), jsonBody(t, map[string]any{"id": idgen.New(), "kind": "link", "role": "member"}))
	expect(t, rec, http.StatusTooManyRequests, problem.CodeRateLimited)
	if rec.Header().Get("Retry-After") == "" {
		t.Error("no Retry-After")
	}
	expect(t, jana.post(householdPath(h.ID, "/invitations/"+i.ID.String()+"/resend"), ""), http.StatusTooManyRequests, problem.CodeRateLimited)
	s.clock.advance(24 * time.Hour)
	jana.invite(h.ID, map[string]any{"kind": "link", "role": "member"})
}

// joined makes name, at address, a member of h with grants through an email invitation from owner,
// and returns their browser and their id.
func (s *site) joined(owner *browser, h uuid.UUID, name, address, role string, grants map[string]string) (*browser, uuid.UUID) {
	s.t.Helper()
	fields := map[string]any{"kind": "email", "email": address, "role": role}
	if grants != nil {
		fields["grants"] = grants
	}
	owner.invite(h, fields)
	b := s.person(name, address)
	rec := b.post("/me/invitations/"+s.invitationToken(address)+"/accept", "")
	expect(s.t, rec, http.StatusOK, "")
	var m memberDoc
	decode(s.t, rec, &m)
	return b, m.UserID
}

// An owner changes a member's role and grants under If-Match (FR-HA5): the member's next request has
// them, what they can no longer see is retracted, and they are told. A child is never granted Manage
// nor more than View on Finance, stays a child, and nobody else becomes one; the last owner and the
// payer stay owners.
func TestChangingAMembersAccess(t *testing.T) {
	s, hooks := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petr, petrID := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	hooks.take()
	path := householdPath(h.ID, "/members/"+petrID.String())

	rec := jana.get(path)
	expect(t, rec, http.StatusOK, "")
	if rec.Header().Get("ETag") != `"1"` {
		t.Fatalf("ETag %q", rec.Header().Get("ETag"))
	}
	// The nil UUID, which the contract's Uuid admits, names nobody: not the first member to join,
	// Jana, the payer and last owner, whom a change naming it would otherwise make a member.
	nobody := householdPath(h.ID, "/members/"+uuid.Nil.String())
	expect(t, jana.get(nobody), http.StatusNotFound, problem.CodeNotFound)
	expect(t, jana.patch(nobody, `{"role":"member"}`, nil), http.StatusNotFound, problem.CodeNotFound)
	expect(t, jana.post(householdPath(h.ID, "/ownership/transfer"), jsonBody(t, map[string]any{"user_id": uuid.Nil})),
		http.StatusNotFound, problem.CodeNotFound)
	if got := jana.members(h.ID)["Jana"]; got.Role != "owner" || got.Version != 1 {
		t.Fatalf("Jana after the nil UUID: %+v", got)
	}
	stale := http.Header{"If-Match": {`"7"`}}
	expect(t, jana.patch(path, `{"grants":{"tasks":"none"}}`, stale), http.StatusConflict, problem.CodeVersionConflict)
	expect(t, petr.patch(path, `{"grants":{"tasks":"none"}}`, nil), http.StatusForbidden, problem.CodeForbidden)

	rec = jana.patch(path, `{"grants":{"tasks":"none","garden":"manage"}}`, http.Header{"If-Match": {`"1"`}})
	expect(t, rec, http.StatusOK, "")
	var m memberDoc
	decode(t, rec, &m)
	if m.Grants["tasks"] != "none" || m.Grants["garden"] != "manage" || m.Version != 2 || rec.Header().Get("ETag") != `"2"` {
		t.Fatalf("after the change: %+v, ETag %s", m, rec.Header().Get("ETag"))
	}
	if got := petr.levels(h.ID); got["tasks"] != "none" || got["garden"] != "manage" {
		t.Errorf("Petr's next request: %v", got)
	}
	_, lost, changed := hooks.take()
	if len(lost) != 1 || lost[0].Cause != household.CauseGrant || !slices.Equal(lost[0].Members[petrID], []string{"tasks"}) {
		t.Errorf("retracted %+v", lost)
	}
	if len(changed) != 1 || changed[0].Member != petrID {
		t.Errorf("told %+v", changed)
	}
	if n := s.count(`SELECT count(*) FROM audit_changes c JOIN audit_events e ON e.household_id = c.household_id AND e.id = c.event_id
		WHERE e.household_id = $1 AND e.action = 'member.update' AND c.field IN ('grants.tasks', 'grants.garden')`, h.ID); n != 2 {
		t.Errorf("%d diffs", n)
	}

	for field, body := range map[string]string{
		"/grants/nothing": `{"grants":{"nothing":"view"}}`,
		"/role":           `{"role":"child"}`,
	} {
		errs := fieldErrorsOf(t, jana.patch(path, body, nil))
		if len(errs) != 1 || errs[0].Field != field {
			t.Errorf("%s: %v", field, errs)
		}
	}

	adam := idgen.New()
	arrange(t, s, func(tx pgx.Tx) {
		exec(t, tx, "INSERT INTO users (id, display_name) VALUES ($1, 'Adam')", adam)
		exec(t, tx, "INSERT INTO memberships (id, household_id, user_id, role) VALUES ($1, $2, $3, 'child')", idgen.New(), h.ID, adam)
	})
	child := householdPath(h.ID, "/members/"+adam.String())
	for field, body := range map[string]string{
		"/grants/tasks":   `{"grants":{"tasks":"manage"}}`,
		"/grants/finance": `{"grants":{"finance":"contribute"}}`,
		"/role":           `{"role":"member"}`,
	} {
		errs := fieldErrorsOf(t, jana.patch(child, body, nil))
		if len(errs) != 1 || errs[0].Field != field {
			t.Errorf("the child's %s: %v", field, errs)
		}
	}
	expect(t, jana.patch(child, `{"grants":{"finance":"view","tasks":"contribute"}}`, nil), http.StatusOK, "")

	// The last owner stays one; a second owner may be made a member again, keeping Manage.
	janaPath := householdPath(h.ID, "/members/"+jana.me().ID.String())
	expect(t, jana.patch(janaPath, `{"role":"member"}`, nil), http.StatusConflict, problem.CodeLastOwner)
	rec = jana.post(householdPath(h.ID, "/ownership/transfer"), jsonBody(t, map[string]any{"user_id": petrID}))
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &m)
	equal(t, "Petr made an owner", m.Grants, all("manage"))
	errs := fieldErrorsOf(t, jana.post(householdPath(h.ID, "/ownership/transfer"), jsonBody(t, map[string]any{"user_id": adam})))
	if len(errs) != 1 || errs[0].Field != "/user_id" {
		t.Errorf("a child made an owner: %v", errs)
	}
	expect(t, petr.patch(janaPath, `{"role":"member"}`, nil), http.StatusConflict, problem.CodeBillingPayer)
	rec = jana.patch(path, `{"role":"member"}`, nil)
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &m)
	if m.Role != "member" {
		t.Errorf("Petr is %s", m.Role)
	}
	equal(t, "Petr made a member again", m.Grants, all("manage"))
	expect(t, petr.post(householdPath(h.ID, "/ownership/transfer"), jsonBody(t, map[string]any{"user_id": petrID})),
		http.StatusForbidden, problem.CodeForbidden)
}

// A removed member's next request finds no household, their replica loses it, and they are told
// (FR-HH5); an owner leaves instead of removing themself, and the payer is removed once billing
// moves.
func TestRemovingAMember(t *testing.T) {
	s, hooks := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petr, petrID := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "owner", nil)
	klara, klaraID := s.joined(jana, h.ID, "Klára", s.a("klara@tilcerovi.cz"), "member", nil)
	hooks.take()

	expect(t, klara.delete(householdPath(h.ID, "/members/"+petrID.String())), http.StatusForbidden, problem.CodeForbidden)
	expect(t, jana.delete(householdPath(h.ID, "/members/"+jana.me().ID.String())), http.StatusForbidden, problem.CodeForbidden)
	expect(t, petr.delete(householdPath(h.ID, "/members/"+jana.me().ID.String())), http.StatusConflict, problem.CodeBillingPayer)
	// The nil UUID names nobody, not the first member to join, whom it would otherwise remove.
	expect(t, jana.delete(householdPath(h.ID, "/members/"+uuid.Nil.String())), http.StatusNotFound, problem.CodeNotFound)

	expect(t, petr.delete(householdPath(h.ID, "/members/"+klaraID.String())), http.StatusNoContent, "")
	expect(t, klara.get(householdPath(h.ID, "")), http.StatusNotFound, problem.CodeNotFound)
	expect(t, jana.delete(householdPath(h.ID, "/members/"+klaraID.String())), http.StatusNotFound, problem.CodeNotFound)
	_, lost, changed := hooks.take()
	if len(lost) != 1 || lost[0].Cause != household.CauseRemoved || lost[0].Members[klaraID] != nil || len(lost[0].Members) != 1 {
		t.Errorf("retracted %+v", lost)
	}
	if len(changed) != 1 || changed[0].Member != klaraID || changed[0].Cause != household.CauseRemoved {
		t.Errorf("told %+v", changed)
	}
	if n := s.count(`SELECT count(*) FROM sync_changes WHERE household_id = $1 AND entity_type = 'admin.membership' AND op = 'delete'`, h.ID); n != 1 {
		t.Errorf("%d deletions in the feed", n)
	}
}

// Any member may leave (FR-HH4), and a repeat of the request is answered as the first was, its key
// being the account's; the last owner and the payer may not, and are told both reasons at once.
func TestLeavingAHousehold(t *testing.T) {
	s, hooks := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petr, petrID := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	hooks.take()

	rec := jana.post(householdPath(h.ID, "/leave"), "")
	expect(t, rec, http.StatusConflict, problem.CodeLastOwner)
	var blocked struct {
		BlockedBy []string `json:"blocked_by"`
	}
	decode(t, rec, &blocked)
	if !slices.Equal(blocked.BlockedBy, []string{"last_owner", "billing_payer"}) {
		t.Errorf("blocked by %v", blocked.BlockedBy)
	}
	expect(t, jana.post(householdPath(h.ID, "/ownership/transfer"), jsonBody(t, map[string]any{"user_id": petrID})), http.StatusOK, "")
	rec = jana.post(householdPath(h.ID, "/leave"), "")
	expect(t, rec, http.StatusConflict, problem.CodeBillingPayer)
	decode(t, rec, &blocked)
	if !slices.Equal(blocked.BlockedBy, []string{"billing_payer"}) {
		t.Errorf("blocked by %v", blocked.BlockedBy)
	}
	hooks.take()

	key := http.Header{"Idempotency-Key": {"leave-1"}}
	expect(t, petr.send(request{method: http.MethodPost, path: householdPath(h.ID, "/leave"), header: key}), http.StatusNoContent, "")
	expect(t, petr.send(request{method: http.MethodPost, path: householdPath(h.ID, "/leave"), header: key}), http.StatusNoContent, "")
	expect(t, petr.get(householdPath(h.ID, "")), http.StatusNotFound, problem.CodeNotFound)
	_, lost, changed := hooks.take()
	if len(lost) != 1 || lost[0].Cause != household.CauseLeft || len(lost[0].Members) != 1 || len(changed) != 0 {
		t.Errorf("retracted %+v, told %+v", lost, changed)
	}
	if got := jana.members(h.ID); len(got) != 1 {
		t.Errorf("%d members", len(got))
	}
}

// An invitation is an owner's grant of access, and lapses with their ownership (D-103): what an owner
// sent that is still waiting is withdrawn when they are removed, leave or are made a member, so that
// none of it brings them, or anyone, back; another owner may send an email invitation again, as
// theirs, and an owner who stays keeps theirs.
func TestAnOwnersInvitationsLapseWithTheirOwnership(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petr, petrID := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "owner", nil)
	milos, milosID := s.joined(jana, h.ID, "Miloš", s.a("milos@tilcerovi.cz"), "owner", nil)
	klara, _ := s.joined(jana, h.ID, "Klára", s.a("klara@tilcerovi.cz"), "owner", nil)
	link := func(b *browser) (invitationDoc, string) {
		i := b.invite(h.ID, map[string]any{"kind": "link", "role": "owner"})
		return i, invitationLink.FindStringSubmatch(*i.URL)[1]
	}
	petrs, petrsLink := link(petr)
	miloss, milossLink := link(milos)
	klaras, klarasLink := link(klara)
	_, janasLink := link(jana)
	adam := s.a("adam@example.com")
	email := petr.invite(h.ID, map[string]any{"kind": "email", "email": adam, "role": "member"})

	// Removed, Petr does not come back through the link he kept, and his email is withdrawn with it.
	expect(t, jana.delete(householdPath(h.ID, "/members/"+petrID.String())), http.StatusNoContent, "")
	expect(t, petr.post("/me/invitations/"+petrsLink+"/accept", ""), http.StatusGone, problem.CodeTokenAlreadyUsed)
	expect(t, s.browser().get("/me/invitations/"+s.invitationToken(adam)), http.StatusGone, problem.CodeTokenAlreadyUsed)
	// Made a member, Miloš's link brings nobody in; Klára's goes when she leaves.
	expect(t, jana.patch(householdPath(h.ID, "/members/"+milosID.String()), `{"role":"member"}`, nil), http.StatusOK, "")
	stranger := s.person("Eva", s.a("eva@example.com"))
	expect(t, stranger.post("/me/invitations/"+milossLink+"/accept", ""), http.StatusGone, problem.CodeTokenAlreadyUsed)
	expect(t, klara.post(householdPath(h.ID, "/leave"), ""), http.StatusNoContent, "")
	expect(t, klara.post("/me/invitations/"+klarasLink+"/accept", ""), http.StatusGone, problem.CodeTokenAlreadyUsed)

	rec := jana.get(householdPath(h.ID, "/invitations"))
	expect(t, rec, http.StatusOK, "")
	var list struct {
		Items []invitationDoc `json:"items"`
	}
	decode(t, rec, &list)
	status := map[uuid.UUID]string{}
	for _, i := range list.Items {
		status[i.ID] = i.Status
	}
	for _, i := range []invitationDoc{petrs, miloss, klaras, email} {
		if status[i.ID] != "revoked" {
			t.Errorf("invitation %s is %s", i.ID, status[i.ID])
		}
		if n := s.count(`SELECT count(*) FROM sync_changes WHERE household_id = $1 AND entity_type = 'admin.invitation'
			AND entity_id = $2 AND payload ->> 'status' = 'revoked'`, h.ID, i.ID); n != 1 {
			t.Errorf("%d withdrawals of %s in the feed", n, i.ID)
		}
	}

	// Jana sends the email again, now hers; her own link still works.
	expect(t, jana.post(householdPath(h.ID, "/invitations/"+email.ID.String()+"/resend"), ""), http.StatusAccepted, "")
	expect(t, s.browser().get("/me/invitations/"+s.invitationToken(adam)), http.StatusOK, "")
	expect(t, stranger.post("/me/invitations/"+janasLink+"/accept", ""), http.StatusOK, "")
}

// An owner removed, or made a member, while their request is on its way is an owner no longer when
// it writes: the role the tenant middleware read is read again under the household's lock, which the
// removal and the demotion take as well, so that no invitation outlives the withdrawal that ended its
// sender's ownership (D-103), and a demoted owner does not promote themself back.
func TestAnOwnershipEndedMidRequestEndsItsWrite(t *testing.T) {
	// meanwhile runs once, in the next request whose household the tenant middleware resolves: after
	// the caller's role is read, and before the handler runs.
	var meanwhile atomic.Pointer[func()]
	s := newSite(t, apptest.Options{}, func(d *app.Deps) {
		d.Entitlement = func(*http.Request) error {
			if f := meanwhile.Swap(nil); f != nil {
				(*f)()
			}
			return nil
		}
	})
	then := func(f func()) { meanwhile.Store(&f) }
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petr, petrID := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "owner", nil)
	milos, milosID := s.joined(jana, h.ID, "Miloš", s.a("milos@tilcerovi.cz"), "owner", nil)

	// Removed while his link is on its way, Petr sends none.
	then(func() {
		expect(t, jana.delete(householdPath(h.ID, "/members/"+petrID.String())), http.StatusNoContent, "")
	})
	link := jsonBody(t, map[string]any{"id": idgen.New(), "kind": "link", "role": "owner"})
	expect(t, petr.post(householdPath(h.ID, "/invitations"), link), http.StatusNotFound, problem.CodeNotFound)
	if n := s.count(`SELECT count(*) FROM invitations WHERE household_id = $1 AND invited_by = $2`, h.ID, petrID); n != 0 {
		t.Errorf("Petr sent %d invitations once removed", n)
	}

	// Made a member while his promotion of himself is on its way, Miloš stays one.
	then(func() {
		expect(t, jana.patch(householdPath(h.ID, "/members/"+milosID.String()), `{"role":"member"}`, nil), http.StatusOK, "")
	})
	promotion := jsonBody(t, map[string]any{"user_id": milosID})
	expect(t, milos.post(householdPath(h.ID, "/ownership/transfer"), promotion), http.StatusForbidden, problem.CodeForbidden)
	if role := jana.members(h.ID)["Miloš"].Role; role != "member" {
		t.Errorf("Miloš is %s", role)
	}
}

// An owner turns a module off for everyone and on again (FR-HA8): off, it is none for every member,
// and retracted from whoever could see it; its data stays. Household settings stays on.
func TestTurningAModuleOffAndOn(t *testing.T) {
	s, hooks := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	milos, milosID := s.joined(jana, h.ID, "Miloš", s.a("milos@tilcerovi.cz"), "member", map[string]string{"garden": "manage"})
	_, petrID := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	hooks.take()
	garden := householdPath(h.ID, "/modules/garden")

	expect(t, milos.patch(garden, `{"enabled":false}`, nil), http.StatusForbidden, problem.CodeForbidden)
	// Household settings is never turned off; turned on, which it is, it stays as it is.
	admin := householdPath(h.ID, "/modules/admin")
	expect(t, jana.patch(admin, `{"enabled":false}`, nil), http.StatusForbidden, problem.CodeForbidden)
	rec := jana.patch(admin, `{"enabled":true}`, nil)
	expect(t, rec, http.StatusOK, "")
	var state struct {
		Enabled bool   `json:"enabled"`
		MyLevel string `json:"my_level"`
	}
	decode(t, rec, &state)
	if !state.Enabled || state.MyLevel != "manage" {
		t.Errorf("admin turned on: %+v", state)
	}
	rec = jana.patch(garden, `{"enabled":false}`, nil)
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &state)
	if state.Enabled || state.MyLevel != "none" {
		t.Errorf("turned off: %+v", state)
	}
	if got := milos.levels(h.ID)["garden"]; got != "none" {
		t.Errorf("Miloš's garden is %s", got)
	}
	_, lost, _ := hooks.take()
	if len(lost) != 1 || lost[0].Cause != household.CauseModule || len(lost[0].Members) != 2 ||
		!slices.Equal(lost[0].Members[milosID], []string{"garden"}) || lost[0].Members[petrID] != nil {
		t.Errorf("retracted %+v", lost)
	}
	expect(t, jana.patch(garden, `{"enabled":false}`, nil), http.StatusOK, "")
	rec = jana.patch(garden, `{"enabled":true}`, nil)
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &state)
	if !state.Enabled || state.MyLevel != "manage" || milos.levels(h.ID)["garden"] != "manage" {
		t.Errorf("turned on: %+v", state)
	}
	if n := s.count(`SELECT count(*) FROM audit_events WHERE household_id = $1 AND action LIKE 'module.%'`, h.ID); n != 2 {
		t.Errorf("%d module events", n)
	}

	// A module the household has no row for is off already, which turning it off leaves as it is;
	// turned on, it gets its row.
	arrange(t, s, func(tx pgx.Tx) {
		exec(t, tx, "DELETE FROM module_enablement WHERE household_id = $1 AND module = 'pets'", h.ID)
	})
	pets := householdPath(h.ID, "/modules/pets")
	rec = jana.patch(pets, `{"enabled":false}`, nil)
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &state)
	if state.Enabled || state.MyLevel != "none" {
		t.Errorf("pets, off already: %+v", state)
	}
	expect(t, jana.patch(pets, `{"enabled":true}`, nil), http.StatusOK, "")
	if n := s.count(`SELECT count(*) FROM audit_events WHERE household_id = $1 AND summary_args ->> 'module' = 'pets'`, h.ID); n != 1 {
		t.Errorf("%d events about pets: want its enabling alone", n)
	}
	if n := s.count(`SELECT count(*) FROM module_enablement WHERE household_id = $1 AND module = 'pets' AND enabled`, h.ID); n != 1 {
		t.Error("pets has no row once enabled")
	}
}

// Every member reads the household's settings, the household code alone being its owners'; an owner
// changes them under If-Match (FR-HA1), except the base currency, which is item 62's, and makes a new
// household code.
func TestTheHouseholdsSettings(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petr, _ := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	path := householdPath(h.ID, "")

	rec := petr.get(path)
	expect(t, rec, http.StatusOK, "")
	var got householdDoc
	decode(t, rec, &got)
	if got.JoinCode != "" || got.MyRole != "member" || got.MyGrants["tasks"] != "contribute" || got.MyGrants["finance"] != "none" {
		t.Errorf("Petr reads %+v", got)
	}
	expect(t, petr.patch(path, `{"name":"Mine"}`, nil), http.StatusForbidden, problem.CodeForbidden)
	expect(t, jana.patch(path, `{"name":"Tilcerovi II"}`, http.Header{"If-Match": {`"9"`}}), http.StatusConflict, problem.CodeVersionConflict)
	for field, body := range map[string]string{
		"/base_currency": `{"base_currency":"EUR"}`,
		"/country":       `{"country":"US"}`,
		// As long as a new household's may be, which the row holds it to.
		"/name": `{"name":"` + strings.Repeat("a", 81) + `"}`,
	} {
		errs := fieldErrorsOf(t, jana.patch(path, body, nil))
		if len(errs) != 1 || errs[0].Field != field {
			t.Errorf("%s: %v", field, errs)
		}
	}
	rec = jana.patch(path, `{"name":"Tilcerovi II","country":"SK","base_currency":"CZK","first_day_of_week":0}`, http.Header{"If-Match": {`"1"`}})
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &got)
	if got.Name != "Tilcerovi II" || got.Country != "SK" || got.FirstDayOfWeek != 0 || got.Version != 2 || got.JoinCode != h.JoinCode {
		t.Errorf("after the change: %+v", got)
	}
	if n := s.count(`SELECT count(*) FROM audit_changes c JOIN audit_events e ON e.household_id = c.household_id AND e.id = c.event_id
		WHERE e.household_id = $1 AND e.action = 'household.update'`, h.ID); n != 3 {
		t.Errorf("%d diffs", n)
	}

	expect(t, petr.post(householdPath(h.ID, "/join-code"), ""), http.StatusForbidden, problem.CodeForbidden)
	rec = jana.post(householdPath(h.ID, "/join-code"), "")
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &got)
	if got.JoinCode == h.JoinCode || got.Version != 3 {
		t.Errorf("a new code: %+v", got)
	}
}

// The household's invitations are admin's data, read with view on admin; a member without it finds
// none.
func TestInvitationsAreReadWithViewOnAdmin(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petr, _ := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	klara, _ := s.joined(jana, h.ID, "Klára", s.a("klara@tilcerovi.cz"), "member", map[string]string{"admin": "none"})
	expect(t, petr.get(householdPath(h.ID, "/invitations")), http.StatusOK, "")
	expect(t, klara.get(householdPath(h.ID, "/invitations")), http.StatusNotFound, problem.CodeNotFound)
	i := jana.invite(h.ID, map[string]any{"kind": "email", "email": s.a("milos@tilcerovi.cz"), "role": "member"})
	link := jana.invite(h.ID, map[string]any{"kind": "link", "role": "member"})
	// A member who sees the invitations may not change them; one who cannot see them finds none to
	// change.
	for b, want := range map[*browser]struct {
		status int
		code   problem.Code
	}{petr: {http.StatusForbidden, problem.CodeForbidden}, klara: {http.StatusNotFound, problem.CodeNotFound}} {
		expect(t, b.post(householdPath(h.ID, "/invitations"), jsonBody(t, map[string]any{"id": idgen.New(), "kind": "link", "role": "member"})),
			want.status, want.code)
		expect(t, b.delete(householdPath(h.ID, "/invitations/"+link.ID.String())), want.status, want.code)
		expect(t, b.post(householdPath(h.ID, "/invitations/"+i.ID.String()+"/resend"), ""), want.status, want.code)
	}
}
