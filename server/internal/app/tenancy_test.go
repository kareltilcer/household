package app_test

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/app/testdata/probe"
	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/health"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// The tests in this file serve the probe module (testdata/probe), a module that exists only to
// prove what the platform does to every module: the tenant middleware, the grant levels, and
// the row-level security under its table.

// probeBlocks returns the probe's migration block, which TestMain applies to the package's
// database.
func probeBlocks() []db.Block {
	registry, err := module.NewRegistry(probe.Module{})
	if err != nil {
		panic(err)
	}
	return registry.Blocks()
}

// world is one test's router, serving the probe module against its contract, and the
// administrator's pool, which passes every policy, to arrange rows and to check them.
type world struct {
	t        *testing.T
	contract *contract.Contract
	router   *chi.Mux
	admin    *pgxpool.Pool
	logs     *syncBuffer
}

// newWorld builds a world; each option adjusts the router's dependencies.
func newWorld(t *testing.T, options ...func(*app.Deps)) *world {
	t.Helper()
	d := testsupport.Open(t)
	c, err := contract.Parse(probe.Contract())
	if err != nil {
		t.Fatal(err)
	}
	logs := &syncBuffer{}
	log := logging.New(logs, slog.LevelDebug)
	registry, err := module.NewRegistry(probe.Module{Log: log})
	if err != nil {
		t.Fatal(err)
	}
	deps := app.Deps{
		Logger: log, Contract: c, Health: health.New(log, time.Second),
		Pool: d.Pool(t, db.RoleApp), Modules: registry, MaxBodyBytes: 1 << 10,
	}
	for _, o := range options {
		o(&deps)
	}
	r, err := app.NewRouter(deps)
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}
	return &world{t: t, contract: c, router: r, admin: d.Pool(t, ""), logs: logs}
}

// in returns w reporting to t, a subtest of w's test, so that a failure in the subtest fails it
// rather than calling its parent's FailNow from the subtest's goroutine.
func (w *world) in(t *testing.T) *world {
	sub := *w
	sub.t = t
	return &sub
}

func (w *world) exec(sql string, args ...any) {
	w.t.Helper()
	if _, err := w.admin.Exec(w.t.Context(), sql, args...); err != nil {
		w.t.Fatalf("%s: %v", sql, err)
	}
}

// household creates a household with the probe module enabled or not.
func (w *world) household(probeEnabled bool) uuid.UUID {
	w.t.Helper()
	h := idgen.New()
	w.exec("INSERT INTO households (id) VALUES ($1)", h)
	w.exec("INSERT INTO module_enablement (household_id, module, enabled) VALUES ($1, $2, $3)", h, probe.Name, probeEnabled)
	return h
}

// member adds a new user to household with role and, unless level is nil, a grant on the
// probe.
func (w *world) member(household uuid.UUID, role access.Role, level *access.Level) uuid.UUID {
	w.t.Helper()
	u := idgen.New()
	w.exec("INSERT INTO users (id) VALUES ($1)", u)
	w.join(household, u, role, level)
	return u
}

// join adds user to household with role and, unless level is nil, a grant on the probe.
func (w *world) join(household, user uuid.UUID, role access.Role, level *access.Level) {
	w.t.Helper()
	w.exec("INSERT INTO memberships (household_id, user_id, role) VALUES ($1, $2, $3)", household, user, string(role))
	if level != nil {
		w.exec("INSERT INTO module_grants (household_id, user_id, module, level) VALUES ($1, $2, $3, $4)",
			household, user, probe.Name, level.String())
	}
}

// item creates a probe item in household.
func (w *world) item(household uuid.UUID) uuid.UUID {
	w.t.Helper()
	id := idgen.New()
	w.exec("INSERT INTO probe_items (id, household_id) VALUES ($1, $2)", id, household)
	return id
}

// count returns how many probe items have id, whichever household holds them.
func (w *world) count(id uuid.UUID) int {
	w.t.Helper()
	var n int
	if err := w.admin.QueryRow(w.t.Context(), "SELECT count(*) FROM probe_items WHERE id = $1", id).Scan(&n); err != nil {
		w.t.Fatal(err)
	}
	return n
}

// do sends a request as user, or with no caller when user is uuid.Nil, and checks the
// response against the probe's contract.
func (w *world) do(method, path string, user uuid.UUID, body string) *httptest.ResponseRecorder {
	w.t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequestWithContext(w.t.Context(), method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if user != uuid.Nil {
		req = req.WithContext(auth.WithUser(req.Context(), user))
	}
	return testsupport.ServeContract(w.t, w.contract, w.router, req)
}

func items(household uuid.UUID) string {
	return fmt.Sprintf("/api/v1/households/%s/probe/items", household)
}

func itemPath(household, item uuid.UUID) string {
	return fmt.Sprintf("%s/%s", items(household), item)
}

func itemBody(item, household uuid.UUID) string {
	return fmt.Sprintf(`{"id":%q,"household_id":%q}`, item, household)
}

func level(l access.Level) *access.Level { return &l }

// expect fails the test unless rec has status, and, for a problem, code.
func expect(t *testing.T, rec *httptest.ResponseRecorder, status int, code problem.Code) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status %d, want %d: %s", rec.Code, status, rec.Body.String())
	}
	if code == "" {
		return
	}
	var doc struct {
		Code problem.Code `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil || doc.Code != code {
		t.Fatalf("code %q, want %q: %s", doc.Code, code, rec.Body.String())
	}
}

// listed returns the ids a list response holds.
func listed(t *testing.T, rec *httptest.ResponseRecorder) []uuid.UUID {
	t.Helper()
	var body struct {
		Items []probe.Item `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	var ids []uuid.UUID
	for _, it := range body.Items {
		ids = append(ids, it.ID)
	}
	return ids
}

func TestAHouseholdRouteNeedsACaller(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	expect(t, w.do(http.MethodGet, items(h), uuid.Nil, ""), http.StatusUnauthorized, problem.CodeUnauthenticated)
}

// A caller who is not a member of a household gets the answer a household that does not exist
// gets (D-16): the tenant middleware refuses before any route runs.
func TestANonMemberCannotTellTheHouseholdExists(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	w.item(h)
	stranger := w.member(w.household(true), access.Owner, nil)

	theirs := w.do(http.MethodGet, items(h), stranger, "")
	none := w.do(http.MethodGet, items(idgen.New()), stranger, "")
	expect(t, theirs, http.StatusNotFound, problem.CodeNotFound)
	expect(t, none, http.StatusNotFound, problem.CodeNotFound)
	strip := func(body string) string {
		var doc map[string]any
		if err := json.Unmarshal([]byte(body), &doc); err != nil {
			t.Fatal(err)
		}
		delete(doc, "request_id")
		out, _ := json.Marshal(doc)
		return string(out)
	}
	if a, b := strip(theirs.Body.String()), strip(none.Body.String()); a != b {
		t.Fatalf("a household the caller is not in answers\n  %s\nand one that does not exist\n  %s", a, b)
	}
	expect(t, w.do(http.MethodPost, items(h), stranger, itemBody(idgen.New(), h)), http.StatusNotFound, problem.CodeNotFound)
}

// A module granted none is absent (FR-AC2): its every route answers 404, reads and writes
// alike, where a 403 would confirm that the household uses it. No grant row at all is none.
func TestAModuleGrantedNoneIsAbsent(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	it := w.item(h)
	for name, l := range map[string]*access.Level{"granted none": level(access.None), "no grant row": nil} {
		t.Run(name, func(t *testing.T) {
			sub := w.in(t)
			u := sub.member(h, access.Member, l)
			expect(t, sub.do(http.MethodGet, items(h), u, ""), http.StatusNotFound, problem.CodeNotFound)
			expect(t, sub.do(http.MethodPost, items(h), u, itemBody(idgen.New(), h)), http.StatusNotFound, problem.CodeNotFound)
			expect(t, sub.do(http.MethodDelete, itemPath(h, it), u, ""), http.StatusNotFound, problem.CodeNotFound)
		})
	}
	if w.count(it) != 1 {
		t.Fatal("a member with none deleted an item")
	}
}

// A module the household disables is absent to every member, its owners included, whatever
// they are granted; its data stays, and enabling it again brings it back (PRD 01 §5, FR-HA8).
// A household with no row for the module has it disabled.
func TestADisabledModuleIsAbsentAndKeepsItsData(t *testing.T) {
	w := newWorld(t)
	h := w.household(false)
	it := w.item(h)
	owner := w.member(h, access.Owner, nil)
	manager := w.member(h, access.Member, level(access.Manage))
	for _, u := range []uuid.UUID{owner, manager} {
		expect(t, w.do(http.MethodGet, items(h), u, ""), http.StatusNotFound, problem.CodeNotFound)
		expect(t, w.do(http.MethodDelete, itemPath(h, it), u, ""), http.StatusNotFound, problem.CodeNotFound)
	}

	unlisted := idgen.New()
	w.exec("INSERT INTO households (id) VALUES ($1)", unlisted)
	unlistedOwner := w.member(unlisted, access.Owner, nil)
	expect(t, w.do(http.MethodGet, items(unlisted), unlistedOwner, ""), http.StatusNotFound, problem.CodeNotFound)

	w.exec("UPDATE module_enablement SET enabled = true WHERE household_id = $1 AND module = $2", h, probe.Name)
	rec := w.do(http.MethodGet, items(h), owner, "")
	expect(t, rec, http.StatusOK, "")
	if got := listed(t, rec); !slices.Equal(got, []uuid.UUID{it}) {
		t.Fatalf("re-enabled, the module lists %v, want %v", got, []uuid.UUID{it})
	}
}

// Each level is a floor: view reads, contribute writes, manage hard-deletes. A member who can
// see the module but not do this to it is refused with 403, which confirms nothing they could
// not read (FR-AC1, PRD modules/00 §2).
func TestEachLevelAllowsWhatItNames(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	viewer := w.member(h, access.Member, level(access.View))
	contributor := w.member(h, access.Member, level(access.Contribute))
	manager := w.member(h, access.Member, level(access.Manage))

	expect(t, w.do(http.MethodGet, items(h), viewer, ""), http.StatusOK, "")
	expect(t, w.do(http.MethodPost, items(h), viewer, itemBody(idgen.New(), h)), http.StatusForbidden, problem.CodeForbidden)

	it := idgen.New()
	expect(t, w.do(http.MethodPost, items(h), contributor, itemBody(it, h)), http.StatusCreated, "")
	expect(t, w.do(http.MethodDelete, itemPath(h, it), contributor, ""), http.StatusForbidden, problem.CodeForbidden)
	expect(t, w.do(http.MethodDelete, itemPath(h, it), viewer, ""), http.StatusForbidden, problem.CodeForbidden)

	expect(t, w.do(http.MethodDelete, itemPath(h, it), manager, ""), http.StatusNoContent, "")
	if w.count(it) != 0 {
		t.Fatal("the manager's delete left the item")
	}
}

// An owner has Manage on every enabled module without a grant row, and a grant of none does
// not reduce it (PRD modules/00 §2). A child never has Manage, whatever their grant says
// (FR-AC4).
func TestAnOwnerManagesAndAChildNeverDoes(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	owner := w.member(h, access.Owner, level(access.None))
	child := w.member(h, access.Child, level(access.Manage))

	it := idgen.New()
	expect(t, w.do(http.MethodPost, items(h), child, itemBody(it, h)), http.StatusCreated, "")
	expect(t, w.do(http.MethodDelete, itemPath(h, it), child, ""), http.StatusForbidden, problem.CodeForbidden)
	expect(t, w.do(http.MethodDelete, itemPath(h, it), owner, ""), http.StatusNoContent, "")
}

// A handler that forgets its WHERE household_id reads only the household the request
// addresses, not another family's rows (D-2): the probe's list has no WHERE clause at all. A
// user in both households sees each one's items in its own requests only.
func TestAHandlerMissingItsWhereReadsOnlyItsHousehold(t *testing.T) {
	w := newWorld(t)
	ours, theirs := w.household(true), w.household(true)
	a, b := w.item(ours), w.item(theirs)
	u := w.member(ours, access.Member, level(access.View))
	both := w.member(ours, access.Member, level(access.View))
	w.join(theirs, both, access.Member, level(access.View))

	for _, tc := range []struct {
		user      uuid.UUID
		household uuid.UUID
		want      []uuid.UUID
	}{
		{u, ours, []uuid.UUID{a}},
		{both, ours, []uuid.UUID{a}},
		{both, theirs, []uuid.UUID{b}},
	} {
		rec := w.do(http.MethodGet, items(tc.household), tc.user, "")
		expect(t, rec, http.StatusOK, "")
		if got := listed(t, rec); !slices.Equal(got, tc.want) {
			t.Errorf("GET %s as %s lists %v, want %v", items(tc.household), tc.user, got, tc.want)
		}
	}
}

// A handler that writes a row into another household is refused by PostgreSQL (D-2): the
// request fails, and nothing is written, even for a caller who is a member of both households.
func TestACrossTenantInsertErrors(t *testing.T) {
	w := newWorld(t)
	ours, theirs := w.household(true), w.household(true)
	u := w.member(ours, access.Member, level(access.Contribute))
	w.join(theirs, u, access.Member, level(access.Contribute))

	it := idgen.New()
	expect(t, w.do(http.MethodPost, items(ours), u, itemBody(it, theirs)), http.StatusInternalServerError, problem.CodeInternal)
	if w.count(it) != 0 {
		t.Fatal("a request addressed to one household wrote a row into another")
	}
	// PostgreSQL's insufficient_privilege: the policy's WITH CHECK refused the row.
	if !strings.Contains(w.logs.String(), "SQLSTATE 42501") {
		t.Fatalf("the refusal was not row-level security's:\n%s", w.logs)
	}
	expect(t, w.do(http.MethodPost, items(ours), u, itemBody(it, ours)), http.StatusCreated, "")
}

// The tenant lasts as long as its transaction (PRD 01 §2.2): the connection a request used goes
// back to the pool with no household, no caller, and the request role.
func TestTheTenantDoesNotOutliveItsTransaction(t *testing.T) {
	cfg, err := pgxpool.ParseConfig(testsupport.Open(t).URL(db.RoleApp))
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	w := newWorld(t, func(d *app.Deps) { d.Pool = pool })
	h := w.household(true)
	u := w.member(h, access.Member, level(access.View))
	expect(t, w.do(http.MethodGet, items(h), u, ""), http.StatusOK, "")

	var noHousehold, noUser bool
	var role string
	if err := pool.QueryRow(t.Context(),
		"SELECT app_household_id() IS NULL, app_user_id() IS NULL, current_user::text",
	).Scan(&noHousehold, &noUser, &role); err != nil {
		t.Fatal(err)
	}
	if !noHousehold || !noUser || role != db.RoleApp {
		t.Fatalf("after the request the pooled connection has household unset %v, user unset %v, role %s",
			noHousehold, noUser, role)
	}
}

// A grant is resolved on every request, so a change takes effect on the next one (D-15).
func TestAGrantChangeTakesEffectOnTheNextRequest(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	u := w.member(h, access.Member, level(access.View))
	expect(t, w.do(http.MethodGet, items(h), u, ""), http.StatusOK, "")
	w.exec("UPDATE module_grants SET level = 'none' WHERE household_id = $1 AND user_id = $2", h, u)
	expect(t, w.do(http.MethodGet, items(h), u, ""), http.StatusNotFound, problem.CodeNotFound)
	w.exec("DELETE FROM memberships WHERE household_id = $1 AND user_id = $2", h, u)
	expect(t, w.do(http.MethodGet, items(h), u, ""), http.StatusNotFound, problem.CodeNotFound)
}

// The entitlement hook (item 18) is asked once the tenant is resolved, with the tenant in the
// request's context, and its problem is the answer.
func TestTheEntitlementHookAnswersForTheHousehold(t *testing.T) {
	var asked []uuid.UUID
	readOnly := func(r *http.Request) error {
		asked = append(asked, tenant.From(r.Context()).HouseholdID())
		if r.Method != http.MethodGet {
			return problem.New(http.StatusPaymentRequired, problem.CodeEntitlementReadOnly)
		}
		return nil
	}
	w := newWorld(t, func(d *app.Deps) { d.Entitlement = readOnly })
	h := w.household(true)
	u := w.member(h, access.Member, level(access.Contribute))

	expect(t, w.do(http.MethodGet, items(h), u, ""), http.StatusOK, "")
	it := idgen.New()
	expect(t, w.do(http.MethodPost, items(h), u, itemBody(it, h)), http.StatusPaymentRequired, problem.CodeEntitlementReadOnly)
	if w.count(it) != 0 {
		t.Fatal("a refused write was written")
	}
	if !slices.Equal(asked, []uuid.UUID{h, h}) {
		t.Fatalf("the hook was asked for %v", asked)
	}
	stranger := w.member(w.household(true), access.Owner, nil)
	expect(t, w.do(http.MethodGet, items(h), stranger, ""), http.StatusNotFound, problem.CodeNotFound)
	if len(asked) != 2 {
		t.Fatal("the hook was asked about a household the caller is not in")
	}
}

// Every line a household-scoped request logs carries its household (FR-NF5).
func TestAHouseholdRequestLogsItsHousehold(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	u := w.member(h, access.Member, level(access.View))
	expect(t, w.do(http.MethodGet, items(h), u, ""), http.StatusOK, "")
	if !strings.Contains(w.logs.String(), `"`+logging.KeyHouseholdID+`":"`+h.String()+`"`) {
		t.Fatalf("the access log does not name the household:\n%s", w.logs)
	}
}
