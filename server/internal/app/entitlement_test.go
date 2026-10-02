package app_test

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	"github.com/kareltilcer/household/server/internal/platform/fairuse"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// The tests in this file hold a household to its entitlement (plan item 16, PRD 04): the gate that
// refuses what its state does not permit (FR-BI1), the owner's restriction (FR-BI7), the clock that
// moves its subscription along and warns its owners before its data goes (D-32, D-119), the
// suspension the platform holds it to (D-115), and the fair-use ceilings (PRD 04 §5, D-116).

// entitlementDoc is the contract's EntitlementSummary, as a client reads it.
type entitlementDoc struct {
	State             string     `json:"state"`
	TrialEndsAt       *time.Time `json:"trial_ends_at"`
	TrialNotice       string     `json:"trial_notice"`
	CanWrite          bool       `json:"can_write"`
	CanUpload         bool       `json:"can_upload"`
	GraceEndsAt       *time.Time `json:"grace_ends_at"`
	DataRetainedUntil *time.Time `json:"data_retained_until"`
	Restriction       *struct {
		RestrictedBy struct {
			UserID         *uuid.UUID `json:"user_id"`
			Label          string     `json:"label"`
			IsFormerMember bool       `json:"is_former_member"`
		} `json:"restricted_by"`
		RestrictedAt time.Time `json:"restricted_at"`
		Reason       *string   `json:"reason"`
	} `json:"restriction"`
	SuspendedAt *time.Time `json:"suspended_at"`
}

// refusalDoc is the contract's EntitlementProblem, and its FairUseProblem, as a client reads them.
type refusalDoc struct {
	Code     problem.Code `json:"code"`
	State    string       `json:"state"`
	Remedy   string       `json:"remedy"`
	Resource string       `json:"resource"`
	Ceiling  int64        `json:"ceiling"`
	Module   string       `json:"module"`
}

func refusalOf(t *testing.T, rec *httptest.ResponseRecorder) refusalDoc {
	t.Helper()
	var r refusalDoc
	if err := json.Unmarshal(rec.Body.Bytes(), &r); err != nil {
		t.Fatalf("%v: %s", err, rec.Body)
	}
	return r
}

// clocks is what a test sets on a household's row to put it in a state, beside the reset that takes
// it back to a trial that has just begun.
const clocks = `billing_state = 'trialing', trial_ends_at = now() + interval '720 hours', dunning_ends_at = NULL,
	grace_ends_at = NULL, lapsed_at = NULL, retained_until = NULL, retention_warnings = 0, restricted_at = NULL,
	restricted_by = NULL, restricted_by_label = NULL, restriction_reason = NULL, suspended_at = NULL`

// The states, as the hourly job, Stripe's webhooks and the staff leave them on the row.
var states = map[string]string{
	"trialing":   "",
	"active":     "billing_state = 'active'",
	"past_due":   "billing_state = 'past_due', dunning_ends_at = now() + interval '7 days'",
	"grace":      "billing_state = 'grace', grace_ends_at = now() + interval '14 days'",
	"read_only":  "billing_state = 'read_only', lapsed_at = now(), retained_until = now() + interval '395 days'",
	"canceled":   "billing_state = 'canceled', lapsed_at = now(), retained_until = now() + interval '395 days'",
	"restricted": "restricted_at = now(), restricted_by_label = 'Jana'",
	"suspended":  "suspended_at = now()",
}

func (w *world) state(h uuid.UUID, name string) {
	w.t.Helper()
	w.exec("UPDATE households SET "+clocks+" WHERE id = $1", h)
	if states[name] != "" {
		w.exec("UPDATE households SET "+states[name]+" WHERE id = $1", h)
	}
}

// FR-BI1 over the probe's routes, which are any module's: every state reads; the four that write
// take a write; the rest refuse it 402, naming the state and the remedy, the owner's and anyone
// else's, with entitlement_restricted in a restriction; and leaving and a replica's credentials are
// let through in each, as the closed list of exemptions says. A suspended household answers every
// route 404, its exemptions too.
func TestTheGateHoldsEachStateToWhatItPermits(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	owner := w.member(h, access.Owner, nil)
	member := w.member(h, access.Member, level(access.Contribute))
	for name, tc := range map[string]struct {
		writes bool
		code   problem.Code
		remedy string
	}{
		"trialing":   {writes: true},
		"active":     {writes: true},
		"past_due":   {writes: true},
		"grace":      {writes: true},
		"read_only":  {code: problem.CodeEntitlementReadOnly, remedy: entitlement.RemedySubscribe},
		"canceled":   {code: problem.CodeEntitlementReadOnly, remedy: entitlement.RemedySubscribe},
		"restricted": {code: problem.CodeEntitlementRestricted, remedy: entitlement.RemedyLiftRestriction},
	} {
		t.Run(name, func(t *testing.T) {
			w := w.in(t)
			w.state(h, name)
			kept := w.item(h)
			expect(t, w.do(http.MethodGet, items(h), member, ""), http.StatusOK, "")
			it := idgen.New()
			rec := w.do(http.MethodPost, items(h), member, itemBody(it, h))
			if tc.writes {
				expect(t, rec, http.StatusCreated, "")
				expect(t, w.do(http.MethodDelete, itemPath(h, kept), owner, ""), http.StatusNoContent, "")
				return
			}
			expect(t, rec, http.StatusPaymentRequired, tc.code)
			if r := refusalOf(t, rec); r.State != name || r.Remedy != entitlement.RemedyContactOwner {
				t.Errorf("the member's refusal: %+v", r)
			}
			rec = w.do(http.MethodDelete, itemPath(h, kept), owner, "")
			expect(t, rec, http.StatusPaymentRequired, tc.code)
			if r := refusalOf(t, rec); r.Remedy != tc.remedy {
				t.Errorf("the owner's remedy: %+v", r)
			}
			if w.count(it) != 0 || w.count(kept) != 1 {
				t.Fatal("a refused write was written")
			}
			// The exemptions: a replica's credentials, and leaving.
			expect(t, w.do(http.MethodPost, fmt.Sprintf("/api/v1/households/%s/sync/credentials", h), member, ""), http.StatusOK, "")
			leaver := w.member(h, access.Member, nil)
			expect(t, w.do(http.MethodPost, fmt.Sprintf("/api/v1/households/%s/leave", h), leaver, ""), http.StatusNoContent, "")
		})
	}

	w.state(h, "suspended")
	kept := w.item(h)
	for _, rec := range []*httptest.ResponseRecorder{
		w.do(http.MethodGet, items(h), owner, ""),
		w.do(http.MethodPost, items(h), owner, itemBody(idgen.New(), h)),
		w.do(http.MethodDelete, itemPath(h, kept), owner, ""),
		w.do(http.MethodPost, fmt.Sprintf("/api/v1/households/%s/sync/credentials", h), member, ""),
		w.do(http.MethodPost, fmt.Sprintf("/api/v1/households/%s/leave", h), member, ""),
		w.do(http.MethodPost, fmt.Sprintf("/api/v1/households/%s/restriction", h), owner, ""),
	} {
		expect(t, rec, http.StatusNotFound, problem.CodeNotFound)
	}
}

// The household carries its entitlement, which every member reads, on itself and on the list of the
// households they are in: a trial of 30 days, silent for twenty, then DD-9's notice and banner.
func TestAHouseholdCarriesItsEntitlement(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	before := time.Now()
	h := jana.create("Tilcerovi")
	petrs, _ := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	read := func(b *browser) entitlementDoc {
		t.Helper()
		rec := b.get(householdPath(h.ID, ""))
		expect(t, rec, http.StatusOK, "")
		var doc struct {
			Entitlement entitlementDoc `json:"entitlement"`
		}
		decode(t, rec, &doc)
		return doc.Entitlement
	}
	e := read(petrs)
	if e.State != "trialing" || !e.CanWrite || !e.CanUpload || e.TrialNotice != entitlement.NoticeNone || e.TrialEndsAt == nil ||
		e.TrialEndsAt.Before(before.Add(entitlement.TrialFor-time.Minute)) || e.TrialEndsAt.After(time.Now().Add(entitlement.TrialFor+time.Minute)) {
		t.Fatalf("a new household: %+v", e)
	}
	listed := listHouseholds(t, petrs)
	if len(listed) != 1 || listed[0].Entitlement.State != "trialing" || listed[0].Entitlement.TrialEndsAt == nil {
		t.Fatalf("the list: %+v", listed)
	}
	// A minute into each day: the trial began when the row was written, a moment after the clock was set.
	s.clock.advance(20*24*time.Hour + time.Minute)
	if e := read(jana); e.TrialNotice != entitlement.NoticeNotice {
		t.Fatalf("day 21: %+v", e)
	}
	s.clock.advance(5 * 24 * time.Hour)
	if e := read(jana); e.TrialNotice != entitlement.NoticeBanner {
		t.Fatalf("day 26: %+v", e)
	}
}

type summaryDoc struct {
	ID          uuid.UUID      `json:"id"`
	Name        string         `json:"name"`
	Entitlement entitlementDoc `json:"entitlement"`
}

func listHouseholds(t *testing.T, b *browser) []summaryDoc {
	t.Helper()
	rec := b.get("/households")
	expect(t, rec, http.StatusOK, "")
	var doc struct {
		Items []summaryDoc `json:"items"`
	}
	decode(t, rec, &doc)
	return doc.Items
}

// Any owner restricts the household (FR-BI7) and any owner lifts it, at once; a member does neither.
// While it holds, nothing is written, a 402 entitlement_restricted, and every member sees who
// restricted it, when and why. A lapse outranks it (D-114): the household is read_only, with its
// deletion date, and still says who restricted it; lifting the restriction leaves it read_only.
func TestRestrictingAHousehold(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi")
	petrs, _ := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	restriction := householdPath(h.ID, "/restriction")
	summary := func(rec *httptest.ResponseRecorder) entitlementDoc {
		t.Helper()
		expect(t, rec, http.StatusOK, "")
		var e entitlementDoc
		decode(t, rec, &e)
		return e
	}

	expect(t, petrs.post(restriction, ""), http.StatusForbidden, problem.CodeForbidden)
	e := summary(jana.post(restriction, jsonBody(t, map[string]string{"reason": "  We are moving house  "})))
	if e.State != "restricted" || e.CanWrite || e.CanUpload || e.Restriction == nil || e.Restriction.RestrictedBy.Label != "Jana" ||
		*e.Restriction.RestrictedBy.UserID != janaID || e.Restriction.RestrictedBy.IsFormerMember ||
		e.Restriction.Reason == nil || *e.Restriction.Reason != "We are moving house" {
		t.Fatalf("restricted: %+v", e)
	}
	rec := jana.patch(householdPath(h.ID, ""), `{"name":"Tilcerovi doma"}`, nil)
	expect(t, rec, http.StatusPaymentRequired, problem.CodeEntitlementRestricted)
	if r := refusalOf(t, rec); r.State != "restricted" || r.Remedy != entitlement.RemedyLiftRestriction {
		t.Fatalf("the owner's refusal: %+v", r)
	}
	if listed := listHouseholds(t, petrs); listed[0].Entitlement.Restriction == nil || listed[0].Entitlement.State != "restricted" {
		t.Fatalf("Petr's list: %+v", listed)
	}
	// Restricting it again changes nothing.
	again := summary(jana.post(restriction, ""))
	if again.Restriction == nil || !again.Restriction.RestrictedAt.Equal(e.Restriction.RestrictedAt) || *again.Restriction.Reason != "We are moving house" {
		t.Fatalf("restricted again: %+v", again)
	}
	if n := s.count("SELECT count(*) FROM audit_events WHERE household_id = $1 AND action = 'household.restrict'", h.ID); n != 1 {
		t.Fatalf("%d restrictions recorded", n)
	}

	expect(t, petrs.delete(restriction), http.StatusForbidden, problem.CodeForbidden)
	if e := summary(jana.delete(restriction)); e.State != "trialing" || e.Restriction != nil || !e.CanWrite {
		t.Fatalf("lifted: %+v", e)
	}
	expect(t, jana.patch(householdPath(h.ID, ""), `{"name":"Tilcerovi doma"}`, nil), http.StatusOK, "")
	if e := summary(jana.delete(restriction)); e.State != "trialing" {
		t.Fatalf("lifted again: %+v", e)
	}

	// Under a lapse, the lapse shows, with its date, and the restriction beside it.
	summary(jana.post(restriction, ""))
	if _, err := s.admin.Exec(t.Context(), `UPDATE households SET billing_state = 'read_only', lapsed_at = now(),
		retained_until = now() + interval '395 days' WHERE id = $1`, h.ID); err != nil {
		t.Fatal(err)
	}
	rec = jana.get(householdPath(h.ID, ""))
	var doc struct {
		Entitlement entitlementDoc `json:"entitlement"`
	}
	decode(t, rec, &doc)
	if doc.Entitlement.State != "read_only" || doc.Entitlement.DataRetainedUntil == nil || doc.Entitlement.Restriction == nil {
		t.Fatalf("a restricted lapse: %+v", doc.Entitlement)
	}
	rec = jana.patch(householdPath(h.ID, ""), `{"name":"Chata"}`, nil)
	expect(t, rec, http.StatusPaymentRequired, problem.CodeEntitlementReadOnly)
	if e := summary(jana.delete(restriction)); e.State != "read_only" || e.Restriction != nil || e.DataRetainedUntil == nil {
		t.Fatalf("lifted under a lapse: %+v", e)
	}
	if n := s.count("SELECT count(*) FROM audit_events WHERE household_id = $1 AND action = 'household.unrestrict'", h.ID); n != 2 {
		t.Fatalf("%d lifts recorded", n)
	}
}

// A suspended household (D-115) is on the list of its members' households, so that a client shows
// its lockout, and nowhere else: its own routes answer 404, its household code opens nothing for a
// child's sign-in, and a member accepting an invitation into it is not answered their membership.
// Lifted, it opens again.
func TestASuspendedHouseholdIsListedAndNothingMore(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petrs, _ := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	adam := jana.child(h.ID, "Adam", "1234", nil)
	link := jana.invite(h.ID, map[string]any{"kind": "link", "role": "member"})
	accept := "/me/invitations/" + invitationLink.FindStringSubmatch(*link.URL)[1] + "/accept"
	phone := s.phone("Adam's phone")

	s.suspension(h.ID, true)
	listed := listHouseholds(t, jana)
	if len(listed) != 1 || listed[0].Name != "Tilcerovi" || listed[0].Entitlement.State != "suspended" ||
		listed[0].Entitlement.SuspendedAt == nil || listed[0].Entitlement.CanWrite {
		t.Fatalf("the list: %+v", listed)
	}
	expect(t, jana.get(householdPath(h.ID, "")), http.StatusNotFound, problem.CodeNotFound)
	expect(t, jana.get(householdPath(h.ID, "/members")), http.StatusNotFound, problem.CodeNotFound)
	expect(t, jana.delete(householdPath(h.ID, "/restriction")), http.StatusNotFound, problem.CodeNotFound)
	expect(t, phone.profiles(h.JoinCode), http.StatusNotFound, problem.CodeNotFound)
	expect(t, phone.childLogin(h.JoinCode, adam.UserID, "1234"), http.StatusUnauthorized, problem.CodeInvalidCredentials)
	expect(t, petrs.post(accept, ""), http.StatusNotFound, problem.CodeNotFound)

	s.suspension(h.ID, false)
	expect(t, phone.profiles(h.JoinCode), http.StatusOK, "")
	expect(t, phone.childLogin(h.JoinCode, adam.UserID, "1234"), http.StatusOK, "")
	expect(t, petrs.post(accept, ""), http.StatusOK, "")
}

// suspension suspends household h, or lifts its suspension, as the platform's staff will (item 21).
func (s *site) suspension(h uuid.UUID, suspended bool) {
	s.t.Helper()
	if _, err := s.admin.Exec(s.t.Context(), "UPDATE households SET suspended_at = CASE WHEN $2 THEN now() END WHERE id = $1",
		h, suspended); err != nil {
		s.t.Fatal(err)
	}
}

// Accepting an invitation and declining one are held to the household's entitlement (D-120): a
// household that does not write is joined and declined by nobody, 402 naming its state, the invitee
// told to ask an owner, and a suspended one is not found, its invitation neither previewed nor listed.
// The invitation is left as it was, and works once the household writes again.
func TestAnInvitationIsHeldToTheHouseholdsState(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	jana.invite(h.ID, map[string]any{"kind": "email", "email": s.a("eva@tilcerovi.cz"), "role": "member"})
	eva := s.person("Eva", s.a("eva@tilcerovi.cz"))
	token := s.invitationToken(s.a("eva@tilcerovi.cz"))
	accept, decline := "/me/invitations/"+token+"/accept", "/me/invitations/"+token+"/decline"

	expect(t, jana.post(householdPath(h.ID, "/restriction"), ""), http.StatusOK, "")
	for _, path := range []string{accept, decline} {
		rec := eva.post(path, "")
		expect(t, rec, http.StatusPaymentRequired, problem.CodeEntitlementRestricted)
		if r := refusalOf(t, rec); r.State != "restricted" || r.Remedy != entitlement.RemedyContactOwner {
			t.Fatalf("%s's refusal: %+v", path, r)
		}
	}
	// Nor is it shown, previewed or listed, while its household is suspended (D-115).
	listed := func() int {
		t.Helper()
		rec := eva.get("/me/invitations")
		expect(t, rec, http.StatusOK, "")
		var list struct {
			Items []preview `json:"items"`
		}
		decode(t, rec, &list)
		return len(list.Items)
	}
	expect(t, eva.get("/me/invitations/"+token), http.StatusOK, "")
	if n := listed(); n != 1 {
		t.Fatalf("listed %d invitations", n)
	}
	s.suspension(h.ID, true)
	expect(t, eva.get("/me/invitations/"+token), http.StatusNotFound, problem.CodeNotFound)
	if n := listed(); n != 0 {
		t.Fatalf("a suspended household's invitation is listed (%d)", n)
	}
	expect(t, eva.post(accept, ""), http.StatusNotFound, problem.CodeNotFound)
	expect(t, eva.post(decline, ""), http.StatusNotFound, problem.CodeNotFound)
	if n := s.count("SELECT count(*) FROM memberships WHERE household_id = $1", h.ID); n != 1 {
		t.Fatalf("%d members", n)
	}
	if n := s.count("SELECT count(*) FROM invitations WHERE household_id = $1 AND status = 'pending'", h.ID); n != 1 {
		t.Fatal("a refused decline closed the invitation")
	}

	s.suspension(h.ID, false)
	expect(t, eva.get("/me/invitations/"+token), http.StatusOK, "")
	expect(t, jana.delete(householdPath(h.ID, "/restriction")), http.StatusOK, "")
	expect(t, eva.post(accept, ""), http.StatusOK, "")
}

// Confirming a child profile's graduation makes it a member of its household, a write held to the
// household's entitlement as an invitation's acceptance is (D-120): refused 402 while the household
// does not write, not found while it is suspended, and the link works once the household writes again.
func TestAGraduationIsHeldToTheHouseholdsState(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	adam := jana.child(h.ID, "Adam", "1234", nil)
	address := s.a("adam@tilcerovi.cz")
	expect(t, jana.post(householdPath(h.ID, "/children/"+adam.UserID.String()+"/graduate"), jsonBody(t, map[string]string{"email": address})),
		http.StatusAccepted, "")
	link := s.graduationToken(address)
	confirm := func() *httptest.ResponseRecorder {
		t.Helper()
		return s.browser().post("/auth/graduation/confirm", jsonBody(t, map[string]string{"token": link, "password": passphrase}))
	}

	expect(t, jana.post(householdPath(h.ID, "/restriction"), ""), http.StatusOK, "")
	rec := confirm()
	expect(t, rec, http.StatusPaymentRequired, problem.CodeEntitlementRestricted)
	if r := refusalOf(t, rec); r.State != "restricted" || r.Remedy != entitlement.RemedyContactOwner {
		t.Fatalf("the refusal: %+v", r)
	}
	s.suspension(h.ID, true)
	expect(t, confirm(), http.StatusNotFound, problem.CodeNotFound)

	s.suspension(h.ID, false)
	if m := jana.members(h.ID)["Adam"]; m.Role != "child" {
		t.Fatalf("Adam graduated in a household that writes nothing: %+v", m)
	}
	expect(t, jana.delete(householdPath(h.ID, "/restriction")), http.StatusOK, "")
	expect(t, confirm(), http.StatusNoContent, "")
	if m := jana.members(h.ID)["Adam"]; m.Role != "member" {
		t.Fatalf("Adam once the household writes again: %+v", m)
	}
}

// adminCatalog is the module registry with admin, which the platform's own mutations are checked
// against.
func adminCatalog(t *testing.T) *module.Registry {
	t.Helper()
	registry, err := module.NewRegistry()
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := registry.WithPlatform(household.Admin())
	if err != nil {
		t.Fatal(err)
	}
	return catalog
}

// The hourly job moves a household along its subscription's clock (PRD 03 §5): a trial that ended
// enters grace, which blocks uploads only, and grace that ended read_only, whose countdown starts
// then; each move is the system's, recorded. Its owners are emailed a month, a week and a day before
// the data goes, each warning once, the latest when several fell due while the job did not run.
// Nothing is due while nothing has run out, and a household reached a month late lapses as it would
// have.
func TestTheClockMovesAHouseholdAlong(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "owner", nil)
	meter := testsupport.Open(t).Pool(t, db.RoleMeter)
	catalog := adminCatalog(t)
	transition := func(want int) {
		t.Helper()
		n, err := s.households.Transition(t.Context(), meter, catalog)
		if err != nil || n != want {
			t.Fatalf("transitioned %d households, want %d: %v", n, want, err)
		}
	}
	set := func(sql string, args ...any) {
		t.Helper()
		if _, err := s.admin.Exec(t.Context(), "UPDATE households SET "+sql+" WHERE id = $1", append([]any{h.ID}, args...)...); err != nil {
			t.Fatal(err)
		}
	}
	type row struct {
		billing                 string
		trial                   time.Time
		grace, lapsed, retained *time.Time
		warnings                int
	}
	read := func() row {
		t.Helper()
		var r row
		if err := s.admin.QueryRow(t.Context(), `SELECT billing_state::text, trial_ends_at, grace_ends_at, lapsed_at, retained_until,
			retention_warnings FROM households WHERE id = $1`, h.ID).Scan(&r.billing, &r.trial, &r.grace, &r.lapsed, &r.retained, &r.warnings); err != nil {
			t.Fatal(err)
		}
		return r
	}

	transition(0)
	ended := s.clock.now().Add(-time.Hour).Truncate(time.Microsecond)
	set("trial_ends_at = $2", ended)
	transition(1)
	if r := read(); r.billing != "grace" || !r.grace.Equal(ended.Add(entitlement.GraceFor)) {
		t.Fatalf("a trial that ended: %+v", r)
	}
	if n := s.count(`SELECT count(*) FROM audit_events WHERE household_id = $1 AND action = 'household.entitlement'
		AND actor_type = 'system'`, h.ID); n != 1 {
		t.Fatalf("%d transitions recorded", n)
	}
	expect(t, jana.patch(householdPath(h.ID, ""), `{"locale":"cs-CZ"}`, nil), http.StatusOK, "")

	graceEnded := s.clock.now().Add(-time.Hour).Truncate(time.Microsecond)
	set("grace_ends_at = $2", graceEnded)
	transition(1)
	r := read()
	if r.billing != "read_only" || !r.lapsed.Equal(graceEnded) || !r.retained.Equal(entitlement.RetainedUntil(graceEnded)) || r.warnings != 0 {
		t.Fatalf("grace that ended: %+v", r)
	}
	rec := jana.patch(householdPath(h.ID, ""), `{"name":"Chata"}`, nil)
	expect(t, rec, http.StatusPaymentRequired, problem.CodeEntitlementReadOnly)
	if refusal := refusalOf(t, rec); refusal.State != "read_only" || refusal.Remedy != entitlement.RemedySubscribe {
		t.Fatalf("the refusal: %+v", refusal)
	}
	transition(0)

	owners := []string{s.a("jana@tilcerovi.cz"), s.a("petr@tilcerovi.cz")}
	warned := func(subject string, want int) {
		t.Helper()
		for _, address := range owners {
			n := 0
			for _, m := range s.outbox.To(address) {
				if m.Subject == subject {
					n++
				}
			}
			if n != want {
				t.Errorf("%s was sent %q %d times, want %d", address, subject, n, want)
			}
		}
	}
	month := s.clock.now().Add(30 * 24 * time.Hour).Truncate(time.Microsecond)
	set("retained_until = $2", month)
	transition(1)
	warned("Tilcerovi’s data will be deleted in 30 days", 1)
	transition(0)
	warned("Tilcerovi’s data will be deleted in 30 days", 1)
	if r := read(); r.warnings != 1 || !r.retained.Equal(month) {
		t.Fatalf("after the first warning: %+v", r)
	}
	// The job did not run for the week and the day: the latest warning goes, once, and the deletion
	// moves out to give the day's notice it promises.
	set("retained_until = $2", s.clock.now().Add(12*time.Hour))
	transition(1)
	warned("Tilcerovi’s data will be deleted in 1 day", 1)
	transition(0)
	if r := read(); r.warnings != 3 || !r.retained.Equal(s.clock.now().Add(24*time.Hour).Truncate(time.Microsecond)) {
		t.Fatalf("after the last warning: %+v", r)
	}
	if n := s.count("SELECT count(*) FROM audit_events WHERE household_id = $1 AND action = 'household.retention_warning'", h.ID); n != 2 {
		t.Fatalf("%d warnings recorded", n)
	}

	late := jana.create("Chata")
	monthAgo := s.clock.now().Add(-30 * 24 * time.Hour).Truncate(time.Microsecond)
	if _, err := s.admin.Exec(t.Context(), "UPDATE households SET trial_ends_at = $2 WHERE id = $1", late.ID, monthAgo); err != nil {
		t.Fatal(err)
	}
	transition(1)
	var billing string
	var lapsed time.Time
	if err := s.admin.QueryRow(t.Context(), "SELECT billing_state::text, lapsed_at FROM households WHERE id = $1", late.ID).
		Scan(&billing, &lapsed); err != nil {
		t.Fatal(err)
	}
	if billing != "read_only" || !lapsed.Equal(monthAgo.Add(entitlement.GraceFor)) {
		t.Fatalf("a trial a month past: %s, lapsed %s", billing, lapsed)
	}
}

// Grace blocks uploads and nothing else (PRD 04 §3): a write goes on, and an upload is refused 402,
// naming grace. The storage ceiling's 402 names the household's state as the request found it.
func TestGraceBlocksUploadsAlone(t *testing.T) {
	w := newFileWorld(t)
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	expect(t, w.upload(h, jana, "note.txt", []byte("before"), map[string]string{"id": idgen.New().String()}), http.StatusCreated, "")
	w.state(h, "grace")
	expect(t, w.do(http.MethodPost, items(h), jana, itemBody(idgen.New(), h)), http.StatusCreated, "")
	rec := w.upload(h, jana, "note.txt", []byte("during"), map[string]string{"id": idgen.New().String()})
	expect(t, rec, http.StatusPaymentRequired, problem.CodeEntitlementReadOnly)
	if r := refusalOf(t, rec); r.State != "grace" || r.Remedy != entitlement.RemedySubscribe {
		t.Fatalf("grace's refusal: %+v", r)
	}
	w.state(h, "active")
	expect(t, w.upload(h, jana, "note.txt", []byte("after"), map[string]string{"id": idgen.New().String()}), http.StatusCreated, "")
}

// A household holds 100 000 objects at most (PRD 04 §5): the upload past them is refused 403
// fair_use_ceiling, its bytes stored nowhere.
func TestAHouseholdHoldsSoManyObjects(t *testing.T) {
	w := newFileWorld(t)
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	w.exec(`INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size, sha256, variants)
		SELECT $1, 'probe', gen_random_uuid(), 'original', 'text/plain', 1, sha256(i::text::bytea), 'none'
		FROM generate_series(1, $2::int) i`, h, fairuse.Objects-1)
	expect(t, w.upload(h, jana, "note.txt", []byte("the last"), map[string]string{"id": idgen.New().String()}), http.StatusCreated, "")
	item := idgen.New()
	rec := w.upload(h, jana, "note.txt", []byte("one too many"), map[string]string{"id": item.String()})
	expect(t, rec, http.StatusForbidden, problem.CodeFairUseCeiling)
	if r := refusalOf(t, rec); r.Resource != fairuse.ResourceObjects || r.Ceiling != fairuse.Objects {
		t.Fatalf("the refusal: %+v", r)
	}
	if objects := w.objects(fmt.Sprintf("h/%s/probe/%s/", h, item)); len(objects) != 0 {
		t.Fatalf("the refused upload stored %v", objects)
	}
}

// A module of a household holds 250 000 rows at most (PRD 04 §5, D-116), counted where the night's
// sample says it is near them: a household its sample puts below 80 % creates without a count, and
// the next night's sample holds it; one at the ceiling is refused the create, 403 fair_use_ceiling
// naming the module. The rows are the ones the database holds: a row deleted, a tombstone, still
// counts, and the household creates again as soon as rows are erased.
func TestAModuleHoldsSoManyRows(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	w.exec("INSERT INTO probe_items (id, household_id) SELECT gen_random_uuid(), $1 FROM generate_series(1, $2::int)", h, fairuse.Rows)
	expect(t, w.do(http.MethodPost, items(h), jana, itemBody(idgen.New(), h)), http.StatusCreated, "")

	w.exec(`INSERT INTO usage_samples (household_id, sampled_on, sampled_at, stored_bytes, derived_bytes, object_count)
		VALUES ($1, current_date, now(), 0, 0, 0)`, h)
	w.exec(`INSERT INTO usage_sample_modules (household_id, sampled_on, module, stored_bytes, derived_bytes, object_count, row_count)
		VALUES ($1, current_date, 'probe', 0, 0, 0, $2)`, h, fairuse.Rows+1)
	it := idgen.New()
	rec := w.do(http.MethodPost, items(h), jana, itemBody(it, h))
	expect(t, rec, http.StatusForbidden, problem.CodeFairUseCeiling)
	if r := refusalOf(t, rec); r.Resource != fairuse.ResourceRows || r.Module != "probe" || r.Ceiling != fairuse.Rows {
		t.Fatalf("the refusal: %+v", r)
	}
	if w.count(it) != 0 {
		t.Fatal("the refused create was written")
	}
	w.exec("UPDATE probe_items SET deleted_at = now() WHERE id IN (SELECT id FROM probe_items WHERE household_id = $1 LIMIT 2)", h)
	expect(t, w.do(http.MethodPost, items(h), jana, itemBody(it, h)), http.StatusForbidden, problem.CodeFairUseCeiling)
	w.exec("DELETE FROM probe_items WHERE id IN (SELECT id FROM probe_items WHERE household_id = $1 AND deleted_at IS NOT NULL)", h)
	expect(t, w.do(http.MethodPost, items(h), jana, itemBody(it, h)), http.StatusCreated, "")
}

// A user owns five households at most (PRD 04 §5, D-116): the fourth they make tells them they are
// at 80 % of it, once, and the sixth is refused 403 household_limit_reached. A household someone else
// made, which they are in, counts for nothing.
func TestAUserOwnsFiveHouseholdsAtMost(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	jana.subscribe()
	petr := s.person("Petr", s.a("petr@tilcerovi.cz"))
	h := petr.create("Petrovi")
	petr.invite(h.ID, map[string]any{"kind": "email", "email": s.a("jana@tilcerovi.cz"), "role": "member"})
	expect(t, jana.post("/me/invitations/"+s.invitationToken(s.a("jana@tilcerovi.cz"))+"/accept", ""), http.StatusOK, "")
	for i := range fairuse.Households {
		jana.create(fmt.Sprintf("Tilcerovi %d", i))
	}
	var told []string
	for _, p := range s.pushes.To(janaID) {
		if p.Push.Title == "You are near the fair-use limit on households" {
			told = append(told, p.Push.Body)
		}
	}
	if len(told) != 1 || !strings.Contains(told[0], "With Tilcerovi 3, you own 4 households, 80 % of the 5") {
		t.Fatalf("Jana was told %q", told)
	}
	rec := jana.post("/households", jsonBody(t, map[string]any{
		"id": idgen.New(), "name": "One too many", "country": "CZ", "timezone": "Europe/Prague", "base_currency": "CZK", "locale": "cs",
	}))
	expect(t, rec, http.StatusForbidden, problem.CodeHouseholdLimitReached)
	if n := len(listHouseholds(t, jana)); n != fairuse.Households+1 {
		t.Fatalf("Jana is in %d households", n)
	}
}

// The households one user creates at once count each other (D-116): their creations are serialised on
// a lock of the user's (db.OwnerLock), so that of two sent together by a user who owns four, one is
// made and the other refused 403 household_limit_reached, never both made.
func TestHouseholdsCreatedAtOnceCountEachOther(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	for i := range fairuse.Households - 1 {
		jana.create(fmt.Sprintf("Tilcerovi %d", i))
	}
	codes := make([]int, 2)
	var wg sync.WaitGroup
	for i := range codes {
		// The same signed-in browser, twice: each request with a copy of its cookies.
		b := &browser{s: s, cookies: maps.Clone(jana.cookies), peer: jana.peer}
		body := jsonBody(t, map[string]any{
			"id": idgen.New(), "name": fmt.Sprintf("At once %d", i), "country": "CZ", "timezone": "Europe/Prague",
			"base_currency": "CZK", "locale": "cs",
		})
		wg.Go(func() { codes[i] = b.post("/households", body).Code })
	}
	wg.Wait()
	slices.Sort(codes)
	if !slices.Equal(codes, []int{http.StatusCreated, http.StatusForbidden}) {
		t.Fatalf("two creations at once answered %v", codes)
	}
	if n := len(listHouseholds(t, jana)); n != fairuse.Households {
		t.Fatalf("Jana owns %d households", n)
	}
}

// A household has twelve members at most (PRD 04 §5, D-116), child profiles among them: its owners
// are told when it reaches ten, and the thirteenth is refused 403 fair_use_ceiling, whether it is
// a child profile an owner makes or an invitation someone accepts.
func TestAHouseholdHasTwelveMembersAtMost(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	jana.subscribe()
	h := jana.create("Tilcerovi")
	jana.invite(h.ID, map[string]any{"kind": "email", "email": s.a("eva@tilcerovi.cz"), "role": "member"})
	add := func(n int) {
		t.Helper()
		for range n {
			u := idgen.New()
			if _, err := s.admin.Exec(t.Context(), "INSERT INTO users (id) VALUES ($1)", u); err != nil {
				t.Fatal(err)
			}
			if _, err := s.admin.Exec(t.Context(), testsupport.InsertMember, h.ID, u, "member"); err != nil {
				t.Fatal(err)
			}
		}
	}
	add(8)
	jana.child(h.ID, "Adam", "1234", nil)
	told := s.pushes.To(janaID)
	if len(told) != 1 || told[0].Push.Title != "Tilcerovi is near its fair-use limit" ||
		!strings.Contains(told[0].Push.Body, "10 members, 80 % of the 12") {
		t.Fatalf("Jana was told: %+v", told)
	}
	add(2)
	rec := jana.makeChild(h.ID, "Ema", "1234", nil)
	expect(t, rec, http.StatusForbidden, problem.CodeFairUseCeiling)
	if r := refusalOf(t, rec); r.Resource != fairuse.ResourceMembers || r.Ceiling != fairuse.Members {
		t.Fatalf("the refusal: %+v", r)
	}
	eva := s.person("Eva", s.a("eva@tilcerovi.cz"))
	expect(t, eva.post("/me/invitations/"+s.invitationToken(s.a("eva@tilcerovi.cz"))+"/accept", ""), http.StatusForbidden,
		problem.CodeFairUseCeiling)
	if n := s.count("SELECT count(*) FROM memberships WHERE household_id = $1", h.ID); n != fairuse.Members {
		t.Fatalf("%d members", n)
	}
}

// The nightly sample tells a household's owners when its objects, or a module's rows, cross 80 % of
// their fair-use ceiling (PRD 04 §5): once for each, as the sample crosses it, and not again while it
// stays above, whether the sample is taken again that day or on the next.
func TestTheSampleWarnsOfAFairUseCeilingOnce(t *testing.T) {
	w := newFileWorld(t)
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	// A member, who is told nothing of it.
	w.member(h, access.Member, level(access.Contribute))
	w.exec(`INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size, sha256, variants)
		SELECT $1, 'probe', gen_random_uuid(), 'original', 'text/plain', 1, sha256(i::text::bytea), 'none'
		FROM generate_series(1, $2::int) i`, h, fairuse.Objects*4/5)
	w.exec("INSERT INTO probe_items (id, household_id) SELECT gen_random_uuid(), $1 FROM generate_series(1, $2::int)", h, fairuse.Rows*4/5)
	pool := testsupport.Open(t).Pool(t, db.RoleApp)
	log := logging.New(io.Discard, slog.LevelDebug)
	outbox := &apptest.Outbox{}
	notifier := apptest.Notify(t, pool, log, outbox, &apptest.Pushes{}, apptest.Options{})
	// Each warning by whom it went to and what it counted.
	warnings := func() map[string]int {
		t.Helper()
		rows, err := w.admin.Query(t.Context(), `SELECT user_id::text || ' ' || (args->>'resource') || ' ' || (args->>'module'), count(*)
			FROM notifications WHERE household_id = $1 AND message = 'notification.fair_use' GROUP BY 1`, h)
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]int{}
		var (
			key string
			n   int
		)
		if _, err := pgx.ForEachRow(rows, []any{&key, &n}, func() error { out[key] = n; return nil }); err != nil {
			t.Fatal(err)
		}
		return out
	}
	want := map[string]int{jana.String() + " objects ": 1, jana.String() + " rows probe": 1}
	night := time.Date(2026, 10, 1, 1, 0, 0, 0, time.UTC)
	for _, at := range []time.Time{night, night.Add(time.Hour), night.Add(24 * time.Hour)} {
		s := w.sampler(at)
		s.Notify = notifier
		if _, err := s.Sample(t.Context()); err != nil {
			t.Fatal(err)
		}
		if got := warnings(); !maps.Equal(got, want) {
			t.Fatalf("sampled at %s, the owners were warned %v, want %v", at, got, want)
		}
	}
}
