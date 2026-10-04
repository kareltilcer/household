package app_test

import (
	"context"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/staff"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// The tests in this file serve item 21's platform staff API (PRD 02 §8) through the whole router,
// every response checked against the contract.

// grant makes the account at address one of the platform's staff with role, as the operator does
// through the command line.
func (s *site) grant(address string, role staff.Role) {
	s.t.Helper()
	pool := testsupport.Open(s.t).Pool(s.t, db.RoleApp)
	if _, err := staff.Grant(s.t.Context(), pool, address, role, s.clock.now()); err != nil {
		s.t.Fatal(err)
	}
}

// staffer registers name at address, verifies it, turns the second step on and makes the account one
// of the platform's staff with role.
func (s *site) staffer(name, address string, role staff.Role) *browser {
	s.t.Helper()
	b := s.person(name, address)
	b.enrol(passphrase)
	s.grant(address, role)
	return b
}

func platformPath(h uuid.UUID, rest string) string {
	return fmt.Sprintf("/platform/households/%s%s", h, rest)
}

// platformHousehold is the contract's PlatformHousehold, as the staff's client reads it.
type platformHousehold struct {
	ID               uuid.UUID  `json:"id"`
	Name             string     `json:"name"`
	State            string     `json:"state"`
	MemberCount      int        `json:"member_count"`
	TrialEndsAt      *time.Time `json:"trial_ends_at"`
	SuspendedAt      *time.Time `json:"suspended_at"`
	SuspensionNotice *string    `json:"suspension_notice"`
	Members          []struct {
		UserID  uuid.UUID `json:"user_id"`
		Email   *string   `json:"email"`
		Role    string    `json:"role"`
		IsChild bool      `json:"is_child"`
	} `json:"members"`
	ModulesEnabled   []string         `json:"modules_enabled"`
	StorageBytes     int64            `json:"storage_bytes"`
	StorageByModule  map[string]int64 `json:"storage_by_module"`
	RecentActionKeys []struct {
		Action string `json:"action"`
		Count  int    `json:"count"`
	} `json:"recent_action_keys"`
	LimitOverrides []struct {
		Key   string `json:"key"`
		Value *int64 `json:"value"`
	} `json:"limit_overrides"`
	Flags []struct {
		Key        string `json:"key"`
		Enabled    bool   `json:"enabled"`
		Overridden bool   `json:"overridden"`
	} `json:"flags"`
	Invoices []struct {
		ID     uuid.UUID `json:"id"`
		Status string    `json:"status"`
	} `json:"invoices"`
	Notifications []struct {
		ID         uuid.UUID `json:"id"`
		Message    string    `json:"message"`
		Status     string    `json:"status"`
		Redrivable bool      `json:"redrivable"`
	} `json:"notifications"`
}

func (b *browser) platformHousehold(h uuid.UUID) platformHousehold {
	b.s.t.Helper()
	rec := b.get(platformPath(h, ""))
	expect(b.s.t, rec, http.StatusOK, "")
	var d platformHousehold
	decode(b.s.t, rec, &d)
	return d
}

// auditEntry is one entry of the contract's PlatformAuditPage.
type auditEntry struct {
	ID    uuid.UUID `json:"id"`
	Actor struct {
		UserID *uuid.UUID `json:"user_id"`
		Label  string     `json:"label"`
	} `json:"actor"`
	ActorRole    *string        `json:"actor_role"`
	Action       string         `json:"action"`
	HouseholdID  *uuid.UUID     `json:"household_id"`
	TargetUserID *uuid.UUID     `json:"target_user_id"`
	Reason       *string        `json:"reason"`
	Meta         map[string]any `json:"meta"`
}

// logged are the entries of the platform's log the query selects, newest first, as admin reads them.
func (b *browser) logged(query string) []auditEntry {
	b.s.t.Helper()
	rec := b.get("/platform/audit" + query)
	expect(b.s.t, rec, http.StatusOK, "")
	var page struct {
		Items []auditEntry `json:"items"`
	}
	decode(b.s.t, rec, &page)
	return page.Items
}

// events are what household h's own log records of action, as the administrator reads the table: the
// actor's type and label of each, oldest first.
func (s *site) events(h uuid.UUID, action string) []string {
	s.t.Helper()
	rows, err := s.admin.Query(s.t.Context(), `
		SELECT actor_type::text || ':' || coalesce(actor_label, '') || ':' || (meta ->> 'via')
		FROM audit_events WHERE household_id = $1 AND module = 'admin' AND action = $2 ORDER BY occurred_at, id`, h, action)
	if err != nil {
		s.t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var e string
		if err := rows.Scan(&e); err != nil {
			s.t.Fatal(err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		s.t.Fatal(err)
	}
	return out
}

// Plan item 21's Done-when: the role matrix is tested. Every operation of the staff API answers a
// request with no caller 401, a member who is not staff 404, as for anything else they may not see,
// a staff member whose second step is off 403 staff_mfa_required, support what its role reaches and
// 403 forbidden past it, and platform_admin everything.
func TestTheStaffRoleMatrix(t *testing.T) {
	s := newSite(t, apptest.Options{})
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	member := jana.me().ID

	admin := s.staffer("Karel", s.a("karel@example"), staff.Admin)
	support := s.staffer("Sára", s.a("sara@example"), staff.Support)
	// One of the staff whose second step is off: made staff, and never enrolled.
	stepless := s.person("Otto", s.a("otto@example"))
	s.grant(s.a("otto@example"), staff.Support)
	target := s.person("Nový", s.a("novy@example")).me().ID

	// What the operations act on: a flag, a paid invoice, a notification that failed, and a bundle.
	rec := admin.put("/platform/flags/matrix.flag", `{"enabled": false, "reason": "for the matrix"}`)
	expect(t, rec, http.StatusOK, "")
	invoice, notification, bundle := idgen.New(), idgen.New(), idgen.New()
	ctx := t.Context()
	for _, stmt := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO billing_invoices (household_id, id, stripe_invoice_id, payer_id, number, status, currency, total_minor, tax_minor,
			issued_at, period_start, period_end, lines)
			VALUES ($1, $2, $4, $3, 'HH-0042', 'paid', 'EUR', 5988, 0, now(), now(), now() + interval '1 year', '[]')`,
			[]any{h.ID, invoice, member, "in_matrix_" + invoice.String()}},
		{`INSERT INTO notifications (household_id, id, user_id, category, message, email, status, reason, settled_at, args_expires_at)
			VALUES ($1, $2, $3, 'direct', 'email.household_unsuspended', true, 'failed', 'email_failed', now(), now() + interval '7 days')`,
			[]any{h.ID, notification, member}},
	} {
		if _, err := s.admin.Exec(ctx, stmt.sql, stmt.args...); err != nil {
			t.Fatal(err)
		}
	}
	rec = jana.post("/me/diagnostics", jsonBody(t, map[string]any{"id": bundle, "screen": "sync-health", "household_id": h.ID,
		"payload": map[string]any{"queue_depth": 3}}))
	expect(t, rec, http.StatusCreated, "")

	reason := `"reason": "a member asked"`
	for _, op := range []struct {
		method, path, body string
		// admin says the operation is platform_admin's alone, and status what it answers when admitted.
		admin  bool
		status int
		code   problem.Code
	}{
		{http.MethodGet, "/platform/households?q=Tilcer", "", false, http.StatusOK, ""},
		{http.MethodGet, platformPath(h.ID, ""), "", false, http.StatusOK, ""},
		{http.MethodPost, platformPath(h.ID, "/trial"), `{"days": 7, ` + reason + `}`, false, http.StatusOK, ""},
		// No payment processor is configured for this site: the credit is admitted, and cannot be made.
		{http.MethodPost, platformPath(h.ID, "/credit"), `{"amount": {"amount_minor": 500, "currency": "EUR"}, ` + reason + `}`, false,
			http.StatusServiceUnavailable, problem.CodeBillingUnavailable},
		{http.MethodPost, platformPath(h.ID, "/invoices/"+invoice.String()+"/resend"), `{` + reason + `}`, false, http.StatusAccepted, ""},
		{http.MethodPost, platformPath(h.ID, "/notifications/"+notification.String()+"/redrive"), `{` + reason + `}`, false,
			http.StatusAccepted, ""},
		{http.MethodPut, platformPath(h.ID, "/flags/matrix.flag"), `{"enabled": true, ` + reason + `}`, false, http.StatusOK, ""},
		{http.MethodPatch, platformPath(h.ID, "/limits"), `{"key": "members", "value": 20, ` + reason + `}`, true, http.StatusOK, ""},
		{http.MethodPut, platformPath(h.ID, "/suspension"), `{"suspended": false, ` + reason + `}`, true, http.StatusOK, ""},
		{http.MethodGet, "/platform/users?q=novy", "", false, http.StatusOK, ""},
		{http.MethodGet, "/platform/users/" + target.String(), "", false, http.StatusOK, ""},
		{http.MethodPost, "/platform/users/" + target.String() + "/actions", `{"action": "clear_rate_limit", ` + reason + `}`, false,
			http.StatusAccepted, ""},
		{http.MethodGet, "/platform/diagnostics/" + bundle.String(), "", false, http.StatusOK, ""},
		{http.MethodGet, "/platform/flags", "", false, http.StatusOK, ""},
		{http.MethodPut, "/platform/flags/matrix.other", `{"enabled": true, ` + reason + `}`, false, http.StatusOK, ""},
		{http.MethodGet, "/platform/audit", "", true, http.StatusOK, ""},
		{http.MethodGet, "/platform/staff", "", true, http.StatusOK, ""},
		{http.MethodPut, "/platform/staff/" + target.String(), `{"role": null, ` + reason + `}`, true, http.StatusNoContent, ""},
	} {
		t.Run(op.method+" "+op.path, func(t *testing.T) {
			do := func(b *browser) *httptest.ResponseRecorder {
				return b.send(request{method: op.method, path: op.path, body: op.body})
			}
			expect(t, do(s.browser()), http.StatusUnauthorized, problem.CodeUnauthenticated)
			expect(t, do(jana), http.StatusNotFound, problem.CodeNotFound)
			expect(t, do(stepless), http.StatusForbidden, problem.CodeStaffMfaRequired)
			if op.admin {
				expect(t, do(support), http.StatusForbidden, problem.CodeForbidden)
			} else {
				expect(t, do(support), op.status, op.code)
			}
			// The invoice and the notification are sent again as often as they are asked for; a
			// notification that went the first time is no longer one that failed.
			want, code := op.status, op.code
			if !op.admin && strings.HasSuffix(op.path, "/redrive") {
				want, code = http.StatusConflict, problem.CodeNotApplicable
			}
			expect(t, do(admin), want, code)
		})
	}
}

// Plan item 21's Done-when: a staff action appears in the household's activity. An action on a
// household is recorded twice (FR-PS2, D-75): in the platform's log, as the staff member's, with why,
// and in the household's own, as done by the platform's support, with no name and no reason.
func TestAStaffActionIsInTheHouseholdsOwnLog(t *testing.T) {
	s := newSite(t, apptest.Options{})
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	admin := s.staffer("Karel", s.a("karel@example"), staff.Admin)
	support := s.staffer("Sára", s.a("sara@example"), staff.Support)
	sara := support.me().ID

	before := support.platformHousehold(h.ID)
	rec := support.post(platformPath(h.ID, "/trial"), `{"days": 14, "reason": "The family was away for two weeks"}`)
	expect(t, rec, http.StatusOK, "")
	var after platformHousehold
	decode(t, rec, &after)
	if before.TrialEndsAt == nil || after.TrialEndsAt == nil || !after.TrialEndsAt.Equal(before.TrialEndsAt.AddDate(0, 0, 14)) {
		t.Fatalf("the trial ends %v, was %v, want fourteen days more", after.TrialEndsAt, before.TrialEndsAt)
	}

	// In the household's own log: the trial's move, by the platform's support, as the system's moves
	// of it are recorded, and nothing of who or why.
	if got := s.events(h.ID, "household.entitlement"); !slices.Equal(got, []string{"service:support:system"}) {
		t.Fatalf("the household's log: %v", got)
	}
	if n := s.count(`SELECT count(*) FROM audit_events WHERE household_id = $1 AND (summary_args::text LIKE '%away%' OR meta::text LIKE '%away%'
		OR actor_id IS NOT NULL AND actor_type = 'service')`, h.ID); n != 0 {
		t.Fatal("the household's log carries the staff's reason, or names the staff member")
	}

	// In the platform's log: who, what, on which household, why, and the household's event it goes with.
	entries := admin.logged("?household_id=" + h.ID.String())
	if len(entries) != 1 {
		t.Fatalf("%d entries about the household, want the trial's", len(entries))
	}
	e := entries[0]
	if e.Action != "household.trial" || e.Actor.UserID == nil || *e.Actor.UserID != sara || e.Actor.Label != s.a("sara@example") ||
		e.ActorRole == nil || *e.ActorRole != "support" || e.HouseholdID == nil || *e.HouseholdID != h.ID ||
		e.Reason == nil || *e.Reason != "The family was away for two weeks" || e.Meta["days"] != float64(14) {
		t.Fatalf("the platform's log: %+v", e)
	}
	if n := s.count("SELECT count(*) FROM audit_events WHERE household_id = $1 AND id = $2", h.ID, e.Meta["event_id"]); n != 1 {
		t.Fatalf("the entry names the event %v, which the household's log does not have", e.Meta["event_id"])
	}

	// An action that changes nothing is recorded in neither: a suspension lifted from a household that
	// has none.
	expect(t, admin.put(platformPath(h.ID, "/suspension"), `{"suspended": false, "reason": "a mistake"}`), http.StatusOK, "")
	if n := len(admin.logged("?household_id=" + h.ID.String())); n != 1 {
		t.Fatalf("%d entries once nothing was changed, want the one", n)
	}

	// A household that has subscribed has no trial to extend, and one nobody has is not found.
	if _, err := s.admin.Exec(t.Context(), "UPDATE households SET billing_state = 'active' WHERE id = $1", h.ID); err != nil {
		t.Fatal(err)
	}
	expect(t, support.post(platformPath(h.ID, "/trial"), `{"days": 14, "reason": "again"}`), http.StatusConflict, problem.CodeNotApplicable)
	expect(t, support.post(platformPath(idgen.New(), "/trial"), `{"days": 14, "reason": "nobody's"}`), http.StatusNotFound, problem.CodeNotFound)
	// An action without its reason is refused.
	fields := fieldErrorsOf(t, support.post(platformPath(h.ID, "/trial"), `{"days": 14, "reason": " "}`))
	if len(fields) != 1 || fields[0].Field != "/reason" {
		t.Fatalf("a blank reason: %+v", fields)
	}
	// The log is the staff's own page by page, and held to its filters.
	if n := len(admin.logged("?actor_id=" + sara.String())); n != 1 {
		t.Fatalf("%d entries of Sára's, want the trial's", n)
	}
	if n := len(admin.logged("?household_id=" + idgen.New().String())); n != 0 {
		t.Fatalf("%d entries about a household nobody has", n)
	}
	if n := len(admin.logged("?to=" + time.Now().Add(-time.Hour).UTC().Format(time.RFC3339))); n != 0 {
		t.Fatalf("%d entries before an hour ago", n)
	}
	expect(t, admin.get("/platform/audit?cursor=nonsense"), http.StatusUnprocessableEntity, problem.CodeValidationFailed)
}

// A suspension is platform_admin's (PRD 04 §3, D-115): it carries a notice, which the household's
// lockout shows and its owners are emailed, every household route answers 404 while it stands, and
// lifting it puts the household back as it was. Both are in the household's own log.
func TestStaffSuspendAHouseholdWithItsNotice(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@example")
	jana := s.person("Jana", address)
	h := jana.create("Tilcerovi")
	admin := s.staffer("Karel", s.a("karel@example"), staff.Admin)
	suspension := platformPath(h.ID, "/suspension")

	// A suspension always carries its notice.
	fields := fieldErrorsOf(t, admin.put(suspension, `{"suspended": true, "reason": "a court order"}`))
	if len(fields) != 1 || fields[0].Field != "/notice" {
		t.Fatalf("a suspension with no notice: %+v", fields)
	}
	const notice = "We were ordered to suspend this household while a complaint is looked into."
	rec := admin.put(suspension, jsonBody(t, map[string]any{"suspended": true, "reason": "a court order, ref 12/2026", "notice": notice}))
	expect(t, rec, http.StatusOK, "")
	var d platformHousehold
	decode(t, rec, &d)
	if d.State != "suspended" || d.SuspendedAt == nil || d.SuspensionNotice == nil || *d.SuspensionNotice != notice {
		t.Fatalf("suspended: %+v", d)
	}

	// The household is not found on its own routes, and the list still names it, with the notice.
	expect(t, jana.get(householdPath(h.ID, "")), http.StatusNotFound, problem.CodeNotFound)
	rec = jana.get("/households")
	expect(t, rec, http.StatusOK, "")
	var list struct {
		Items []struct {
			ID          uuid.UUID `json:"id"`
			Entitlement struct {
				State            string  `json:"state"`
				SuspensionNotice *string `json:"suspension_notice"`
			} `json:"entitlement"`
		} `json:"items"`
	}
	decode(t, rec, &list)
	if len(list.Items) != 1 || list.Items[0].Entitlement.State != "suspended" || list.Items[0].Entitlement.SuspensionNotice == nil ||
		*list.Items[0].Entitlement.SuspensionNotice != notice {
		t.Fatalf("the household list: %+v", list.Items)
	}
	// Its owner is emailed the notice, and never the staff's own reason.
	messages := s.outbox.To(address)
	last := messages[len(messages)-1]
	if !strings.Contains(last.Subject, "suspended") || !strings.Contains(last.Body, notice) || strings.Contains(last.Body, "12/2026") {
		t.Fatalf("the owner's email: %q %q", last.Subject, last.Body)
	}
	if got := s.events(h.ID, "support.suspend"); !slices.Equal(got, []string{"service:support:system"}) {
		t.Fatalf("the household's log: %v", got)
	}
	// Suspended already, it stands as it is: nothing more is recorded, and nobody is emailed again.
	expect(t, admin.put(suspension, jsonBody(t, map[string]any{"suspended": true, "reason": "again", "notice": "Another notice"})),
		http.StatusOK, "")
	if n, mails := len(s.events(h.ID, "support.suspend")), len(s.outbox.To(address)); n != 1 || mails != len(messages) {
		t.Fatalf("%d suspensions recorded and %d emails, want the one and %d", n, mails, len(messages))
	}

	expect(t, admin.put(suspension, `{"suspended": false, "reason": "the complaint was withdrawn"}`), http.StatusOK, "")
	expect(t, jana.get(householdPath(h.ID, "")), http.StatusOK, "")
	if got := s.events(h.ID, "support.unsuspend"); !slices.Equal(got, []string{"service:support:system"}) {
		t.Fatalf("the household's log once lifted: %v", got)
	}
	if subject := s.lastMail(address); !strings.Contains(subject, "no longer suspended") {
		t.Fatalf("the owner's email once lifted: %q", subject)
	}
	if n := s.count("SELECT count(*) FROM households WHERE id = $1 AND suspended_at IS NULL AND suspension_notice IS NULL", h.ID); n != 1 {
		t.Fatal("the suspension's notice outlived it")
	}
	actions := []string{}
	for _, e := range admin.logged("?household_id=" + h.ID.String()) {
		actions = append(actions, e.Action)
	}
	if !slices.Equal(actions, []string{"household.unsuspend", "household.suspend"}) {
		t.Fatalf("the platform's log: %v", actions)
	}
}

// A fair-use ceiling raised for a household is the one it is held to (PRD 04 §5): the thirteenth
// member a household may not have joins once its ceiling is raised, and is refused again once the
// ceiling is put back.
func TestARaisedCeilingIsTheOneTheHouseholdIsHeldTo(t *testing.T) {
	s := newSite(t, apptest.Options{})
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	admin := s.staffer("Karel", s.a("karel@example"), staff.Admin)
	limits := platformPath(h.ID, "/limits")

	for i := range 11 {
		jana.child(h.ID, fmt.Sprintf("Dítě %d", i+1), "1234", nil)
	}
	thirteenth := func() *httptest.ResponseRecorder { return jana.makeChild(h.ID, "Třinácté", "1234", nil) }
	expect(t, thirteenth(), http.StatusForbidden, problem.CodeFairUseCeiling)

	// A ceiling is raised: one below what every household is held to is refused, as is one nobody
	// names, and one past what every client reads exactly, which where a ceiling is enforced would
	// overflow what is computed from it, and refuse what it was raised to allow.
	for body, field := range map[string]string{
		`{"key": "members", "value": 11, "reason": "fewer"}`:                           "/value",
		`{"key": "households", "value": 9, "reason": "?"}`:                             "/key",
		`{"key": "file_size_bytes", "value": 9223372036854775807, "reason": "no end"}`: "/value",
		`{"key": "members", "value": 9007199254740992, "reason": "no end"}`:            "/value",
	} {
		if fields := fieldErrorsOf(t, admin.patch(limits, body, nil)); len(fields) != 1 || fields[0].Field != field {
			t.Fatalf("%s: %+v", body, fields)
		}
	}
	rec := admin.patch(limits, `{"key": "members", "value": 13, "reason": "Three generations under one roof"}`, nil)
	expect(t, rec, http.StatusOK, "")
	var raised struct {
		Key   string `json:"key"`
		Value *int64 `json:"value"`
		SetBy struct {
			Label string `json:"label"`
		} `json:"set_by"`
	}
	decode(t, rec, &raised)
	if raised.Key != "members" || raised.Value == nil || *raised.Value != 13 || raised.SetBy.Label != s.a("karel@example") {
		t.Fatalf("the ceiling raised: %+v", raised)
	}
	expect(t, thirteenth(), http.StatusCreated, "")
	refused := jana.makeChild(h.ID, "Čtrnácté", "1234", nil)
	expect(t, refused, http.StatusForbidden, problem.CodeFairUseCeiling)
	var p struct {
		Ceiling int64 `json:"ceiling"`
	}
	decode(t, refused, &p)
	if p.Ceiling != 13 {
		t.Fatalf("the refusal names the ceiling %d, want the household's own, 13", p.Ceiling)
	}
	if d := admin.platformHousehold(h.ID); len(d.LimitOverrides) != 1 || d.LimitOverrides[0].Key != "members" || *d.LimitOverrides[0].Value != 13 {
		t.Fatalf("the household's ceilings: %+v", d.LimitOverrides)
	}
	if got := s.events(h.ID, "support.limit"); !slices.Equal(got, []string{"service:support:system"}) {
		t.Fatalf("the household's log: %v", got)
	}
	// Raised to the value it has already, the ceiling stands as it was set, by whom and why, and nothing
	// more is recorded in either log.
	rec = admin.patch(limits, `{"key": "members", "value": 13, "reason": "again"}`, nil)
	expect(t, rec, http.StatusOK, "")
	var stands struct {
		Value  *int64 `json:"value"`
		Reason string `json:"reason"`
	}
	decode(t, rec, &stands)
	if stands.Value == nil || *stands.Value != 13 || stands.Reason != "Three generations under one roof" {
		t.Fatalf("the ceiling raised to the value it has: %+v", stands)
	}
	if n, logged := len(s.events(h.ID, "support.limit")), len(admin.logged("?household_id="+h.ID.String())); n != 1 || logged != 1 {
		t.Fatalf("%d changes of the ceiling in the household's log and %d in the platform's, want the one raise in each", n, logged)
	}

	// Put back, with a null value: the ceiling is every household's again, and putting it back again
	// changes and records nothing.
	for range 2 {
		rec = admin.patch(limits, `{"key": "members", "value": null, "reason": "the grandparents moved out"}`, nil)
		expect(t, rec, http.StatusOK, "")
	}
	if n := len(s.events(h.ID, "support.limit")); n != 2 {
		t.Fatalf("%d changes of the ceiling recorded, want the raise and the one putting it back", n)
	}
	if d := admin.platformHousehold(h.ID); len(d.LimitOverrides) != 0 {
		t.Fatalf("the household's ceilings once put back: %+v", d.LimitOverrides)
	}
	expect(t, jana.makeChild(h.ID, "Čtrnácté", "1234", nil), http.StatusForbidden, problem.CodeFairUseCeiling)
}

// A feature flag is on for a household by its own setting, or by the platform's where it has none
// (PRD 06 §7): the household's representation names the flags that are on, and the staff read which
// are the household's own.
func TestAFlagIsTheHouseholdsOwnBeforeThePlatforms(t *testing.T) {
	s := newSite(t, apptest.Options{})
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	support := s.staffer("Sára", s.a("sara@example"), staff.Support)
	// A flag of this test's own: the package's tests share one database.
	key := "trial_" + strings.ReplaceAll(s.domain, ".", "_") + ".flag"
	flags := func() []string {
		t.Helper()
		rec := jana.get(householdPath(h.ID, ""))
		expect(t, rec, http.StatusOK, "")
		var d struct {
			Flags []string `json:"flags"`
		}
		decode(t, rec, &d)
		return d.Flags
	}
	household := platformPath(h.ID, "/flags/"+key)

	// A household's setting of a flag the platform does not have says nothing.
	expect(t, support.put(household, `{"enabled": true, "reason": "early"}`), http.StatusNotFound, problem.CodeNotFound)
	expect(t, support.put("/platform/flags/"+key, `{"enabled": false, "reason": "ship it dark"}`), http.StatusOK, "")
	if slices.Contains(flags(), key) {
		t.Fatal("a flag that is off for the platform is on for the household")
	}
	// On for this household first.
	rec := support.put(household, `{"enabled": true, "reason": "they asked to try it"}`)
	expect(t, rec, http.StatusOK, "")
	var f struct {
		Enabled, Overridden bool
	}
	decode(t, rec, &f)
	if !f.Enabled || !f.Overridden || !slices.Contains(flags(), key) {
		t.Fatalf("the household's own setting: %+v, flags %v", f, flags())
	}
	if got := s.events(h.ID, "support.flag"); !slices.Equal(got, []string{"service:support:system"}) {
		t.Fatalf("the household's log: %v", got)
	}
	// Set as it stands already, nothing more is recorded.
	expect(t, support.put(household, `{"enabled": true, "reason": "again"}`), http.StatusOK, "")
	if n := len(s.events(h.ID, "support.flag")); n != 1 {
		t.Fatalf("%d changes of the flag recorded, want the one", n)
	}
	// Its setting taken away, the platform's holds; turned on for the platform, it is on for everyone.
	rec = support.put(household, `{"enabled": null, "reason": "the trial is over"}`)
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &f)
	if f.Enabled || f.Overridden || slices.Contains(flags(), key) {
		t.Fatalf("the household's setting taken away: %+v, flags %v", f, flags())
	}
	expect(t, support.put("/platform/flags/"+key, `{"enabled": true, "reason": "launch"}`), http.StatusOK, "")
	if !slices.Contains(flags(), key) {
		t.Fatal("a flag that is on for the platform is off for the household")
	}
}

// Household settings is never off (FR-HA8, D-146): the flag of its module, module.admin, gates nothing,
// since nobody in a household it was off for could turn it on again. Off for the platform and for the
// household, an owner still holds manage on admin, and still reads the household's invitations.
func TestNoFlagTurnsHouseholdSettingsOff(t *testing.T) {
	s := newSite(t, apptest.Options{})
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	support := s.staffer("Sára", s.a("sara@example"), staff.Support)
	const flag = "module.admin"
	// The flag is the platform's, and the package's tests share one database: it goes with the test.
	t.Cleanup(func() {
		for _, stmt := range []string{"DELETE FROM household_flags WHERE key = $1", "DELETE FROM platform.feature_flags WHERE key = $1"} {
			if _, err := s.admin.Exec(context.Background(), stmt, flag); err != nil {
				t.Errorf("%s: %v", stmt, err)
			}
		}
	})
	expect(t, support.put("/platform/flags/"+flag, `{"enabled": false, "reason": "a mistake"}`), http.StatusOK, "")
	expect(t, support.put(platformPath(h.ID, "/flags/"+flag), `{"enabled": false, "reason": "another"}`), http.StatusOK, "")

	rec := jana.get(householdPath(h.ID, ""))
	expect(t, rec, http.StatusOK, "")
	var d householdDoc
	decode(t, rec, &d)
	if d.MyGrants["admin"] != "manage" {
		t.Fatalf("with its flag off, an owner holds %q on household settings, want manage", d.MyGrants["admin"])
	}
	expect(t, jana.get(householdPath(h.ID, "/invitations")), http.StatusOK, "")
}

// What support does for an account (PRD 02 §8, D-100): the verification and the reset link sent
// again, what is counted against it forgotten, and a second step unlocked or turned off, each in the
// platform's log and in no household's.
func TestSupportActOnAnAccount(t *testing.T) {
	s := newSite(t, apptest.Options{})
	admin := s.staffer("Karel", s.a("karel@example"), staff.Admin)
	support := s.staffer("Sára", s.a("sara@example"), staff.Support)
	act := func(user uuid.UUID, action string) *httptest.ResponseRecorder {
		return support.post("/platform/users/"+user.String()+"/actions", jsonBody(t, map[string]string{"action": action, "reason": "they wrote in"}))
	}

	// An address not verified yet is sent a new link, which verifies it; a verified one has none to send.
	address := s.a("novy@example")
	novy := s.unverified("Nový", address)
	id := novy.me().ID
	sent := len(s.outbox.To(address))
	expect(t, act(id, "resend_verification"), http.StatusAccepted, "")
	if n := len(s.outbox.To(address)); n != sent+1 {
		t.Fatalf("%d messages, want the verification sent again", n)
	}
	s.verify(address)
	expect(t, act(id, "resend_verification"), http.StatusConflict, problem.CodeNotApplicable)

	// A reset link, which sets a new password.
	expect(t, act(id, "send_password_reset"), http.StatusAccepted, "")
	token, _ := s.token(address)
	rec := s.browser().post("/auth/password-reset/confirm", jsonBody(t, map[string]string{"token": token, "password": "a new and longer passphrase"}))
	expect(t, rec, http.StatusNoContent, "")

	// An address blocked by its wrong passwords signs in again once support forgets them.
	guesser := s.browser()
	for range 12 {
		guesser.post("/auth/login", jsonBody(t, map[string]string{"email": address, "password": "not the passphrase", "client_type": "web"}))
	}
	login := jsonBody(t, map[string]string{"email": address, "password": "a new and longer passphrase", "client_type": "web"})
	expect(t, s.browser().post("/auth/login", login), http.StatusTooManyRequests, problem.CodeRateLimited)
	expect(t, act(id, "clear_rate_limit"), http.StatusAccepted, "")
	fresh := s.browser()
	expect(t, fresh.post("/auth/login", login), http.StatusOK, "")

	// A second step that is not on can be neither unlocked nor turned off.
	expect(t, act(id, "unlock"), http.StatusConflict, problem.CodeNotApplicable)
	expect(t, act(id, "disable_mfa"), http.StatusConflict, problem.CodeNotApplicable)
	fresh.enrol("a new and longer passphrase")
	// One that is on and not locked has nothing to unlock.
	expect(t, act(id, "unlock"), http.StatusConflict, problem.CodeNotApplicable)
	if _, err := s.admin.Exec(t.Context(), "UPDATE mfa_totp SET failures = 10, locked_at = now() WHERE user_id = $1", id); err != nil {
		t.Fatal(err)
	}
	rec = support.get("/platform/users/" + id.String())
	expect(t, rec, http.StatusOK, "")
	var u struct {
		Email      *string `json:"email"`
		MFAEnabled bool    `json:"mfa_enabled"`
		MFALocked  bool    `json:"mfa_locked"`
		Sessions   []any   `json:"sessions"`
	}
	decode(t, rec, &u)
	if u.Email == nil || *u.Email != address || !u.MFAEnabled || !u.MFALocked || len(u.Sessions) == 0 {
		t.Fatalf("the account as support reads it: %+v", u)
	}
	expect(t, act(id, "unlock"), http.StatusAccepted, "")
	if n := s.count("SELECT count(*) FROM mfa_totp WHERE user_id = $1 AND locked_at IS NULL AND failures = 0", id); n != 1 {
		t.Fatal("the authenticator is still locked")
	}
	// Turned off, for an owner who lost the authenticator and the codes: both go, and the address is told.
	expect(t, act(id, "disable_mfa"), http.StatusAccepted, "")
	if n := s.count("SELECT (SELECT count(*) FROM mfa_totp WHERE user_id = $1) + (SELECT count(*) FROM mfa_recovery_codes WHERE user_id = $1)", id); n != 0 {
		t.Fatalf("%d rows of the second step left", n)
	}
	if subject := s.lastMail(address); !strings.Contains(subject, "second step was turned off") {
		t.Fatalf("the account was not told its second step is off: %q", subject)
	}

	// Each is in the platform's log, about the account, and about no household.
	var actions []string
	for _, e := range admin.logged("?limit=200") {
		if e.TargetUserID != nil && *e.TargetUserID == id {
			if e.HouseholdID != nil || e.Reason == nil || *e.Reason != "they wrote in" {
				t.Fatalf("an account's action: %+v", e)
			}
			actions = append(actions, e.Action)
		}
	}
	slices.Sort(actions)
	want := []string{"user.clear_rate_limit", "user.disable_mfa", "user.resend_verification", "user.send_password_reset", "user.unlock"}
	if !slices.Equal(actions, want) {
		t.Fatalf("the platform's log of the account: %v, want %v", actions, want)
	}

	// A user support cannot act on is not found: nobody's id, and a child profile, which has no address.
	expect(t, act(idgen.New(), "send_password_reset"), http.StatusNotFound, problem.CodeNotFound)
	jana := s.person("Jana", s.a("jana@example"))
	child := jana.child(jana.create("Tilcerovi").ID, "Adam", "1234", nil)
	expect(t, act(child.UserID, "send_password_reset"), http.StatusNotFound, problem.CodeNotFound)
}

// The staff are managed by platform_admin: an account with a verified address is made staff, is
// admitted to nothing until its second step is on, and is staff no longer once taken out. The last
// platform_admin keeps the role.
func TestThePlatformsStaffAreManagedByItsAdmins(t *testing.T) {
	s := newSite(t, apptest.Options{})
	admin := s.staffer("Karel", s.a("karel@example"), staff.Admin)
	karel := admin.me().ID
	address := s.a("sara@example")
	sara := s.person("Sára", address)
	id := sara.me().ID
	set := func(user uuid.UUID, role any) *httptest.ResponseRecorder {
		return admin.put("/platform/staff/"+user.String(), jsonBody(t, map[string]any{"role": role, "reason": "joined the team"}))
	}

	expect(t, sara.get("/platform/households"), http.StatusNotFound, problem.CodeNotFound)
	expect(t, set(id, "support"), http.StatusNoContent, "")
	expect(t, sara.get("/platform/households"), http.StatusForbidden, problem.CodeStaffMfaRequired)
	sara.enrol(passphrase)
	expect(t, sara.get("/platform/households"), http.StatusOK, "")
	expect(t, sara.get("/platform/audit"), http.StatusForbidden, problem.CodeForbidden)

	rec := admin.get("/platform/staff")
	expect(t, rec, http.StatusOK, "")
	type staffMember struct {
		UserID     uuid.UUID `json:"user_id"`
		Role       string    `json:"role"`
		MFAEnabled bool      `json:"mfa_enabled"`
		GrantedBy  *struct {
			UserID *uuid.UUID `json:"user_id"`
		} `json:"granted_by"`
	}
	var list struct {
		Items []staffMember `json:"items"`
	}
	decode(t, rec, &list)
	i := slices.IndexFunc(list.Items, func(m staffMember) bool { return m.UserID == id })
	if i < 0 || list.Items[i].Role != "support" || !list.Items[i].MFAEnabled || list.Items[i].GrantedBy == nil ||
		*list.Items[i].GrantedBy.UserID != karel {
		t.Fatalf("the staff: %+v", list.Items)
	}

	// An account whose address is not verified cannot be staff, nor one nobody has.
	unverified := s.unverified("Nový", s.a("novy@example")).me().ID
	expect(t, set(unverified, "support"), http.StatusNotFound, problem.CodeNotFound)
	expect(t, set(idgen.New(), "support"), http.StatusNotFound, problem.CodeNotFound)

	// Taken out, they are staff no longer, at once.
	expect(t, set(id, nil), http.StatusNoContent, "")
	expect(t, sara.get("/platform/households"), http.StatusNotFound, problem.CodeNotFound)

	// The grants and the removal are in the platform's log; the first admin's is the operator's.
	var actions []string
	for _, e := range admin.logged("?limit=200") {
		switch {
		case e.TargetUserID != nil && *e.TargetUserID == id:
			actions = append(actions, e.Action+":"+e.Actor.Label)
		case e.TargetUserID != nil && *e.TargetUserID == karel:
			if e.Actor.UserID != nil || e.Actor.Label != staff.Operator || e.ActorRole != nil {
				t.Fatalf("the first platform_admin's entry: %+v", e)
			}
			actions = append(actions, e.Action+":"+e.Actor.Label)
		}
	}
	want := []string{"staff.revoke:" + s.a("karel@example"), "staff.grant:" + s.a("karel@example"), "staff.grant:operator"}
	if !slices.Equal(actions, want) {
		t.Fatalf("the platform's log: %v, want %v", actions, want)
	}
}

// A change of the staff is made by one who is a platform_admin still when it is made (D-144): the
// request of an admin that was on its way while another took them out of the staff is answered as
// their next would be, changes nothing, and does not make them staff again.
func TestAnAdminTakenOutWhileTheirRequestIsOnItsWayChangesNoStaff(t *testing.T) {
	s := newSite(t, apptest.Options{})
	s.staffer("Karel", s.a("karel@example"), staff.Admin)
	leaving := s.staffer("Otto", s.a("otto@example"), staff.Admin)
	otto := leaving.me().ID
	ctx := t.Context()

	// Another admin's change holds the staff's lock, as it does until it commits. Otto's request is
	// admitted, an admin as he still is, and waits for the lock.
	tx, err := s.admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if _, err := tx.Exec(ctx, "LOCK TABLE platform.staff IN SHARE ROW EXCLUSIVE MODE"); err != nil {
		t.Fatal(err)
	}
	var (
		rec *httptest.ResponseRecorder
		wg  sync.WaitGroup
	)
	// The same signed-in browser, with a copy of its cookies, since the test goes on meanwhile.
	b := &browser{s: s, cookies: maps.Clone(leaving.cookies), peer: leaving.peer}
	wg.Go(func() {
		rec = b.put("/platform/staff/"+otto.String(), `{"role": "platform_admin", "reason": "staying"}`)
	})
	for waited := time.Duration(0); ; waited += 10 * time.Millisecond {
		if n := s.count(`SELECT count(*) FROM pg_locks l JOIN pg_database d ON d.oid = l.database
			WHERE d.datname = current_database() AND l.relation = 'platform.staff'::regclass AND NOT l.granted`); n > 0 {
			break
		}
		if waited > 30*time.Second {
			t.Fatal("the request never waited for the staff's lock")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM platform.staff WHERE user_id = $1", otto); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	expect(t, rec, http.StatusNotFound, problem.CodeNotFound)
	if n := s.count("SELECT count(*) FROM platform.staff WHERE user_id = $1", otto); n != 0 {
		t.Fatal("an admin taken out of the staff made themself staff again")
	}
}

// A key answers a repeat with what the first request was answered, so the staff API reads it only
// once its caller is admitted (D-144): a staff member's repeat is answered from their key, and one
// taken out of the staff who sends a request of theirs again is answered 404, as a stranger is, and
// not what they were answered while they were staff.
func TestAFormerStaffMemberIsNotAnsweredFromTheirKey(t *testing.T) {
	s := newSite(t, apptest.Options{})
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	admin := s.staffer("Karel", s.a("karel@example"), staff.Admin)
	support := s.staffer("Sára", s.a("sara@example"), staff.Support)
	sara := support.me().ID
	// A flag of this test's own: the package's tests share one database.
	key := "keyed_" + strings.ReplaceAll(s.domain, ".", "_") + ".flag"
	expect(t, admin.put("/platform/flags/"+key, `{"enabled": false, "reason": "ship it dark"}`), http.StatusOK, "")

	set := func() *httptest.ResponseRecorder {
		return support.send(request{
			method: http.MethodPut, path: platformPath(h.ID, "/flags/"+key), body: `{"enabled": true, "reason": "they asked to try it"}`,
			header: http.Header{"Idempotency-Key": {"sara-sets-the-flag"}},
		})
	}
	first := set()
	expect(t, first, http.StatusOK, "")
	again := set()
	expect(t, again, http.StatusOK, "")
	if again.Body.String() != first.Body.String() || len(s.events(h.ID, "support.flag")) != 1 {
		t.Fatalf("the repeat: %s, with %d changes recorded; want the first answer, %s, and the one change",
			again.Body, len(s.events(h.ID, "support.flag")), first.Body)
	}

	rec := admin.put("/platform/staff/"+sara.String(), `{"role": null, "reason": "left the team"}`)
	expect(t, rec, http.StatusNoContent, "")
	expect(t, set(), http.StatusNotFound, problem.CodeNotFound)
}

// The platform never loses its last platform_admin: nobody could make another through the API.
func TestTheLastPlatformAdminKeepsTheRole(t *testing.T) {
	s := newSite(t, apptest.Options{})
	admin := s.staffer("Karel", s.a("karel@example"), staff.Admin)
	karel := admin.me().ID
	// The package's tests share one database: the others' platform_admins are taken out of the way,
	// in a transaction of this test's own, so that this one is the last.
	if _, err := s.admin.Exec(t.Context(), "DELETE FROM platform.staff WHERE role = 'platform_admin' AND user_id <> $1", karel); err != nil {
		t.Fatal(err)
	}
	for _, role := range []any{nil, "support"} {
		rec := admin.put("/platform/staff/"+karel.String(), jsonBody(t, map[string]any{"role": role, "reason": "leaving"}))
		expect(t, rec, http.StatusConflict, problem.CodeNotApplicable)
	}
	expect(t, admin.get("/platform/staff"), http.StatusOK, "")
}

// What staff read of a household is its metadata (PRD 02 §8, PRD 05 §6): who is in it, what it
// enables and stores, and which actions its log records, by their keys alone. The search finds it by
// its id, by part of its name and by a member's whole address, in the state asked for.
func TestStaffReadAHouseholdsMetadata(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@example")
	jana := s.person("Jana", address)
	name := "Tilcerovi " + s.domain
	h := jana.create(name)
	adam := jana.child(h.ID, "Adam", "1234", nil)
	support := s.staffer("Sára", s.a("sara@example"), staff.Support)

	d := support.platformHousehold(h.ID)
	if d.Name != name || d.State != "trialing" || d.MemberCount != 2 || d.TrialEndsAt == nil || len(d.Members) != 2 {
		t.Fatalf("the household: %+v", d)
	}
	owner, child := d.Members[0], d.Members[1]
	if owner.Email == nil || *owner.Email != address || owner.Role != "owner" || owner.IsChild ||
		child.UserID != adam.UserID || child.Email != nil || child.Role != "child" || !child.IsChild {
		t.Fatalf("the members: %+v", d.Members)
	}
	if !slices.Contains(d.ModulesEnabled, "admin") || len(d.ModulesEnabled) != 17 {
		t.Fatalf("the modules: %v", d.ModulesEnabled)
	}
	keys := map[string]int{}
	for _, a := range d.RecentActionKeys {
		keys[a.Action] = a.Count
	}
	if keys["admin.household.create"] != 1 || keys["admin.child.create"] != 1 {
		t.Fatalf("the action keys: %v", d.RecentActionKeys)
	}
	// Nothing a member wrote there but the household's name: no member's name is in the answer.
	body := support.get(platformPath(h.ID, "")).Body.String()
	for _, written := range []string{"Adam", "Jana"} {
		if strings.Contains(body, written) {
			t.Fatalf("the household's metadata names %s", written)
		}
	}

	found := func(query string) []uuid.UUID {
		t.Helper()
		rec := support.get("/platform/households" + query)
		expect(t, rec, http.StatusOK, "")
		var page struct {
			Items []platformHousehold `json:"items"`
		}
		decode(t, rec, &page)
		var ids []uuid.UUID
		for _, i := range page.Items {
			ids = append(ids, i.ID)
		}
		return ids
	}
	for _, query := range []string{"?q=" + h.ID.String(), "?q=" + strings.ToUpper(s.domain), "?q=" + address, "?q=" + s.domain + "&state=trialing"} {
		if got := found(query); !slices.Equal(got, []uuid.UUID{h.ID}) {
			t.Errorf("%s finds %v, want the household", query, got)
		}
	}
	// Part of an address finds nothing, nor does a pattern, nor a state the household is not in.
	for _, query := range []string{"?q=jana@", "?q=%25" + s.domain, "?q=" + s.domain + "&state=suspended"} {
		if got := found(query); len(got) != 0 {
			t.Errorf("%s finds %v, want nothing", query, got)
		}
	}
	s.suspension(h.ID, true)
	if got := found("?q=" + s.domain + "&state=suspended"); !slices.Equal(got, []uuid.UUID{h.ID}) {
		t.Errorf("suspended, the household is found as %v", got)
	}
	s.suspension(h.ID, false)

	// The search is paged, newest first, and its cursor resumes after the last household of a page.
	second := jana.create("Chalupa " + s.domain)
	rec := support.get("/platform/households?limit=1&q=" + s.domain)
	expect(t, rec, http.StatusOK, "")
	var page struct {
		Items []platformHousehold `json:"items"`
		Meta  struct {
			NextCursor *string `json:"next_cursor"`
			HasMore    bool    `json:"has_more"`
		} `json:"meta"`
	}
	decode(t, rec, &page)
	if len(page.Items) != 1 || page.Items[0].ID != second.ID || !page.Meta.HasMore || page.Meta.NextCursor == nil {
		t.Fatalf("the first page: %+v", page)
	}
	if got := found("?limit=1&q=" + s.domain + "&cursor=" + *page.Meta.NextCursor); !slices.Equal(got, []uuid.UUID{h.ID}) {
		t.Fatalf("the second page: %v", got)
	}
	expect(t, support.get("/platform/households?cursor=nonsense"), http.StatusUnprocessableEntity, problem.CodeValidationFailed)

	// An account is found by its id and by part of its address, and read with the households it is in.
	rec = support.get("/platform/users?q=" + strings.ToUpper("jana@example."+s.domain))
	expect(t, rec, http.StatusOK, "")
	var users struct {
		Items []struct {
			ID             uuid.UUID `json:"id"`
			HouseholdCount int       `json:"household_count"`
			IsChild        bool      `json:"is_child"`
		} `json:"items"`
	}
	decode(t, rec, &users)
	if len(users.Items) != 1 || users.Items[0].ID != jana.me().ID || users.Items[0].HouseholdCount != 2 || users.Items[0].IsChild {
		t.Fatalf("the accounts found: %+v", users.Items)
	}
	rec = support.get("/platform/users/" + adam.UserID.String())
	expect(t, rec, http.StatusOK, "")
	var profile struct {
		Email      *string `json:"email"`
		IsChild    bool    `json:"is_child"`
		Households []struct {
			HouseholdID uuid.UUID `json:"household_id"`
			Name        string    `json:"name"`
			Role        string    `json:"role"`
		} `json:"households"`
	}
	decode(t, rec, &profile)
	if profile.Email != nil || !profile.IsChild || len(profile.Households) != 1 || profile.Households[0].HouseholdID != h.ID ||
		profile.Households[0].Role != "child" {
		t.Fatalf("the child profile as support reads it: %+v", profile)
	}
	expect(t, support.get("/platform/users/"+idgen.New().String()), http.StatusNotFound, problem.CodeNotFound)
}

// A household's state as the staff's search filters by it is the state its members read
// (entitlement.Status.State, D-114): a suspension first, then a lapse, then a restriction, then the
// subscription's own.
func TestTheStaffsStateIsTheMembers(t *testing.T) {
	s := newSite(t, apptest.Options{})
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	support := s.staffer("Sára", s.a("sara@example"), staff.Support)
	for name, set := range map[string]string{
		"trialing":   "billing_state = 'trialing'",
		"active":     "billing_state = 'active'",
		"past_due":   "billing_state = 'past_due', dunning_ends_at = now() + interval '7 days'",
		"grace":      "billing_state = 'grace', grace_ends_at = now() + interval '14 days'",
		"read_only":  "billing_state = 'read_only', lapsed_at = now(), retained_until = now() + interval '395 days'",
		"canceled":   "billing_state = 'canceled', lapsed_at = now(), retained_until = now() + interval '395 days'",
		"restricted": "billing_state = 'active', restricted_at = now(), restricted_by_label = 'An owner'",
		// A lapse outranks a restriction, and a suspension everything.
		"read_only over a restriction": "billing_state = 'read_only', lapsed_at = now(), retained_until = now() + interval '395 days', " +
			"restricted_at = now(), restricted_by_label = 'An owner'",
		"suspended": "billing_state = 'active', restricted_at = now(), restricted_by_label = 'An owner', suspended_at = now()",
	} {
		t.Run(name, func(t *testing.T) {
			for _, columns := range []string{
				`billing_state = 'trialing', dunning_ends_at = NULL, grace_ends_at = NULL, lapsed_at = NULL, retained_until = NULL,
				 restricted_at = NULL, restricted_by_label = NULL, suspended_at = NULL`,
				set,
			} {
				if _, err := s.admin.Exec(t.Context(), "UPDATE households SET "+columns+" WHERE id = $1", h.ID); err != nil {
					t.Fatal(err)
				}
			}
			want, _, _ := strings.Cut(name, " ")
			// As its members read it, on the list, which names a suspended household too.
			rec := jana.get("/households")
			expect(t, rec, http.StatusOK, "")
			var list struct {
				Items []struct {
					Entitlement struct {
						State string `json:"state"`
					} `json:"entitlement"`
				} `json:"items"`
			}
			decode(t, rec, &list)
			if len(list.Items) != 1 || list.Items[0].Entitlement.State != want {
				t.Fatalf("its members read %+v, want %s", list.Items, want)
			}
			if got := support.platformHousehold(h.ID).State; got != want {
				t.Fatalf("the staff read %s, want %s", got, want)
			}
			rec = support.get("/platform/households?q=" + h.ID.String() + "&state=" + want)
			expect(t, rec, http.StatusOK, "")
			var page struct {
				Items []platformHousehold `json:"items"`
			}
			decode(t, rec, &page)
			if len(page.Items) != 1 || page.Items[0].State != want {
				t.Fatalf("the search by state %s finds %+v", want, page.Items)
			}
		})
	}
}

// A notification that failed is sent again as it was queued (PRD 02 §8), and reaches its member; one
// that did not fail, one whose link carried a secret, and one nobody has cannot be.
func TestSupportRedriveANotificationThatFailed(t *testing.T) {
	s := newSite(t, apptest.Options{})
	address := s.a("jana@example")
	jana := s.person("Jana", address)
	h := jana.create("Tilcerovi")
	support := s.staffer("Sára", s.a("sara@example"), staff.Support)
	failed, sealed := idgen.New(), idgen.New()
	for id, isSealed := range map[uuid.UUID]bool{failed: false, sealed: true} {
		if _, err := s.admin.Exec(t.Context(), `
			INSERT INTO notifications (household_id, id, user_id, category, message, email, sealed, status, reason, settled_at, args_expires_at)
			VALUES ($1, $2, $3, 'direct', 'email.household_unsuspended', true, $4, 'failed', 'email_failed', now(), now() + interval '7 days')`,
			h.ID, id, jana.me().ID, isSealed); err != nil {
			t.Fatal(err)
		}
	}
	// One that failed more than seven days ago, as the expiry sweep leaves it: its arguments emptied,
	// and no time left at which they would be.
	swept := idgen.New()
	if _, err := s.admin.Exec(t.Context(), `
		INSERT INTO notifications (household_id, id, user_id, category, message, email, status, reason, created_at, settled_at)
		VALUES ($1, $2, $3, 'direct', 'email.household_unsuspended', true, 'failed', 'email_failed', now() - interval '9 days',
		        now() - interval '8 days')`, h.ID, swept, jana.me().ID); err != nil {
		t.Fatal(err)
	}
	redrive := func(id uuid.UUID) *httptest.ResponseRecorder {
		return support.post(platformPath(h.ID, "/notifications/"+id.String()+"/redrive"), `{"reason": "their mail server was down"}`)
	}
	d := support.platformHousehold(h.ID)
	redrivable := map[uuid.UUID]bool{}
	for _, n := range d.Notifications {
		redrivable[n.ID] = n.Redrivable
	}
	if len(redrivable) != 3 || !redrivable[failed] || redrivable[sealed] || redrivable[swept] {
		t.Fatalf("the notifications as support reads them: %+v", d.Notifications)
	}

	expect(t, redrive(sealed), http.StatusConflict, problem.CodeNotApplicable)
	expect(t, redrive(swept), http.StatusConflict, problem.CodeNotApplicable)
	expect(t, redrive(idgen.New()), http.StatusNotFound, problem.CodeNotFound)
	sent := len(s.outbox.To(address))
	expect(t, redrive(failed), http.StatusAccepted, "")
	if n := len(s.outbox.To(address)); n != sent+1 || !strings.Contains(s.lastMail(address), "no longer suspended") {
		t.Fatalf("%d messages, the last %q: want the notification sent again", n, s.lastMail(address))
	}
	if n := s.count("SELECT count(*) FROM notifications WHERE household_id = $1 AND id = $2 AND status = 'sent'", h.ID, failed); n != 1 {
		t.Fatal("the notification is not recorded as sent")
	}
	// Sent, it is no longer one that failed.
	expect(t, redrive(failed), http.StatusConflict, problem.CodeNotApplicable)
	if got := s.events(h.ID, "support.redrive"); !slices.Equal(got, []string{"service:support:system"}) {
		t.Fatalf("the household's log: %v", got)
	}
}

// A credit goes to the balance of the customer who pays the household's subscription (PRD 02 §8), in
// the currency it pays in, and is in both logs. It is made once at the payment processor however
// often its request is sent: the processor is asked before the transaction that records the credit
// commits, so a request whose answer never arrived is sent again, and the processor is told it is the
// same request.
func TestSupportCreditTheHouseholdsPayer(t *testing.T) {
	s, stripe := billingSite(t)
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	admin := s.staffer("Karel", s.a("karel@example"), staff.Admin)
	support := s.staffer("Sára", s.a("sara@example"), staff.Support)
	credit := func(key string, minor int64, currency string) *httptest.ResponseRecorder {
		t.Helper()
		header := http.Header{}
		if key != "" {
			header.Set("Idempotency-Key", key)
		}
		return support.send(request{
			method: http.MethodPost, path: platformPath(h.ID, "/credit"), header: header,
			body: jsonBody(t, map[string]any{
				"amount": map[string]any{"amount_minor": minor, "currency": currency}, "reason": "An outage on our side",
			}),
		})
	}
	// asked are the names the credits the server asked Stripe for since the last call were asked under.
	asked := func() []string {
		var keys []string
		for _, r := range stripe.Requests() {
			if strings.HasSuffix(r.Path, "/balance_transactions") {
				keys = append(keys, r.IdempotencyKey)
			}
		}
		return keys
	}
	recorded := func() int { return len(s.events(h.ID, "support.credit")) }

	// A household nobody pays for has nothing to credit; one that is paid for is credited in the
	// currency it pays in. Neither refusal is recorded.
	expect(t, credit("", 500, "EUR"), http.StatusConflict, problem.CodeNotSubscribed)
	s.paid(stripe, jana, h.ID, "year")
	if fields := fieldErrorsOf(t, credit("", 500, "CZK")); len(fields) != 1 || fields[0].Field != "/amount/currency" {
		t.Fatalf("a credit in another currency: %+v", fields)
	}
	asked()

	// The processor fails: nothing is recorded, and the request, sent again, is the same request there.
	stripe.Down(true)
	expect(t, credit("the-outage", 500, "EUR"), http.StatusServiceUnavailable, problem.CodeBillingUnavailable)
	stripe.Down(false)
	failed := asked()
	if len(failed) != 1 || !strings.HasPrefix(failed[0], "credit:") || recorded() != 0 || len(stripe.Credits()) != 0 {
		t.Fatalf("the credit that failed was asked under %q, with %d recorded and %d made", failed, recorded(), len(stripe.Credits()))
	}
	expect(t, credit("the-outage", 500, "EUR"), http.StatusNoContent, "")
	if again := asked(); !slices.Equal(again, failed) {
		t.Fatalf("the request sent again was asked under %q, want the name it had, %q", again, failed)
	}
	credits := stripe.Credits()
	if len(credits) != 1 || credits[0].Get("amount") != "-500" || credits[0].Get("currency") != "eur" ||
		credits[0].Get("description") != "Kredit od podpory Household" {
		t.Fatalf("the credits at Stripe: %v", credits)
	}
	// Answered once, a repeat is answered from its key, and the processor is not asked again.
	expect(t, credit("the-outage", 500, "EUR"), http.StatusNoContent, "")
	if again := asked(); len(again) != 0 || len(stripe.Credits()) != 1 || recorded() != 1 {
		t.Fatalf("a repeat asked the processor %q: %d credits made, %d recorded", again, len(stripe.Credits()), recorded())
	}
	// Another request is another credit, under a name of its own; one with no key has none.
	expect(t, credit("another", 500, "EUR"), http.StatusNoContent, "")
	expect(t, credit("", 250, "EUR"), http.StatusNoContent, "")
	if other := asked(); len(other) != 2 || other[0] == failed[0] || !strings.HasPrefix(other[0], "credit:") ||
		strings.HasPrefix(other[1], "credit:") || len(stripe.Credits()) != 3 {
		t.Fatalf("two more credits were asked under %q, with %d made", other, len(stripe.Credits()))
	}

	// Each is in the household's own log, as done by the platform's support, and in the platform's, with
	// what was credited and why.
	if got := s.events(h.ID, "support.credit"); !slices.Equal(got, slices.Repeat([]string{"service:support:system"}, 3)) {
		t.Fatalf("the household's log: %v", got)
	}
	var credited []string
	for _, e := range admin.logged("?household_id=" + h.ID.String()) {
		if e.Action != "household.credit" || e.Reason == nil || *e.Reason != "An outage on our side" || e.Meta["currency"] != "EUR" {
			t.Fatalf("the platform's log: %+v", e)
		}
		credited = append(credited, fmt.Sprint(e.Meta["amount_minor"]))
	}
	if !slices.Equal(credited, []string{"250", "500", "500"}) {
		t.Fatalf("the platform's log records credits of %v minor units, newest first", credited)
	}
}

// A diagnostic bundle is read as its member sent it, for the thirty days it is kept (FR-PS1).
func TestStaffReadADiagnosticBundleAsItWasSent(t *testing.T) {
	s := newSite(t, apptest.Options{})
	jana := s.person("Jana", s.a("jana@example"))
	support := s.staffer("Sára", s.a("sara@example"), staff.Support)
	bundle := idgen.New()
	rec := jana.post("/me/diagnostics", jsonBody(t, map[string]any{"id": bundle, "screen": "sync-health", "ticket_reference": "T-42",
		"payload": map[string]any{"queue_depth": 3, "last_outcomes": []string{"applied", "conflict"}}, "redacted_fields": []string{"checksum"}}))
	expect(t, rec, http.StatusCreated, "")

	rec = support.get("/platform/diagnostics/" + bundle.String())
	expect(t, rec, http.StatusOK, "")
	var b struct {
		Screen          string         `json:"screen"`
		TicketReference *string        `json:"ticket_reference"`
		Payload         map[string]any `json:"payload"`
		RedactedFields  []string       `json:"redacted_fields"`
	}
	decode(t, rec, &b)
	if b.Screen != "sync-health" || b.TicketReference == nil || *b.TicketReference != "T-42" || b.Payload["queue_depth"] != float64(3) ||
		!slices.Equal(b.RedactedFields, []string{"checksum"}) {
		t.Fatalf("the bundle: %+v", b)
	}
	expect(t, support.get("/platform/diagnostics/"+idgen.New().String()), http.StatusNotFound, problem.CodeNotFound)
	// Past its thirty days it is gone, whether or not the sweep has removed it yet.
	if _, err := s.admin.Exec(t.Context(), "UPDATE diagnostic_bundles SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day' WHERE id = $1",
		bundle); err != nil {
		t.Fatal(err)
	}
	expect(t, support.get("/platform/diagnostics/"+bundle.String()), http.StatusGone, problem.CodeTokenExpired)
}
