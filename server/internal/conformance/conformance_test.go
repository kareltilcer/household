package conformance_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/conformance"
	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/health"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/push"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/replica"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/storage"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
	"github.com/kareltilcer/household/server/internal/syncconfig"
)

func TestMain(m *testing.M) {
	block, err := conformance.Block()
	if err != nil {
		panic(err)
	}
	testsupport.Main(m, block)
}

// world is one test's API, the server's own with the conformance module registered and the suite's
// sign-in around it, as cmd/conformance-api serves it, and the administrator's pool to arrange and
// check rows.
type world struct {
	t        *testing.T
	admin    *pgxpool.Pool
	pool     *pgxpool.Pool
	accounts app.Accounts
	router   chi.Router
	// failures counts the records the API logged at ERROR.
	failures *atomic.Int64
}

func newWorld(t *testing.T, o apptest.Options) *world {
	t.Helper()
	return newWorldOf(t, o, conformance.Module{})
}

// newWorldOf is newWorld with m registered in the conformance module's place.
func newWorldOf(t *testing.T, o apptest.Options, m module.Module) *world {
	t.Helper()
	d := testsupport.Open(t)
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	// What a request could not do is the test's to read, when it fails.
	failures := &atomic.Int64{}
	log := slog.New(slog.NewTextHandler(testLog{t, failures}, &slog.HandlerOptions{Level: slog.LevelWarn}))
	pool := d.Pool(t, db.RoleApp)
	registry, err := module.NewRegistry(m)
	if err != nil {
		t.Fatal(err)
	}
	accounts, outbox := apptest.Accounts(t, pool, log, o)
	notifier := apptest.Notify(t, pool, log, outbox, &apptest.Pushes{}, o)
	router, err := app.NewRouter(app.Deps{
		Logger: log, Contract: c, Health: health.New(log, time.Second), Pool: pool, Modules: registry,
		MaxBodyBytes: 1 << 20, Accounts: accounts,
		Households: apptest.Households(t, pool, log, accounts, notifier, o),
		Notify:     notifier,
		Sync:       apptest.Sync(t, log, o),
		Storage:    &storage.Picture{Log: log},
	})
	if err != nil {
		t.Fatal(err)
	}
	around, err := conformance.Around(apptest.TokenKeys)(router, app.Served{Pool: pool, Devices: accounts.Devices})
	if err != nil {
		t.Fatal(err)
	}
	root, ok := around.(chi.Router)
	if !ok {
		t.Fatalf("Around answered a %T", around)
	}
	return &world{t: t, admin: d.Pool(t, ""), pool: pool, accounts: accounts, router: root, failures: failures}
}

// testLog writes a log's lines to the test's, and counts those at ERROR in failures: the handler
// writes each record in one call.
type testLog struct {
	t        *testing.T
	failures *atomic.Int64
}

func (l testLog) Write(p []byte) (int, error) {
	if bytes.Contains(p, []byte(" level=ERROR ")) {
		l.failures.Add(1)
	}
	l.t.Log(strings.TrimRight(string(p), "\n"))
	return len(p), nil
}

func (w *world) exec(sql string, args ...any) {
	w.t.Helper()
	if _, err := w.admin.Exec(context.Background(), sql, args...); err != nil {
		w.t.Fatalf("%s: %v", sql, err)
	}
}

func (w *world) count(sql string, args ...any) int {
	w.t.Helper()
	var n int
	if err := w.admin.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		w.t.Fatalf("%s: %v", sql, err)
	}
	return n
}

// user makes a user.
func (w *world) user() uuid.UUID {
	w.t.Helper()
	id := idgen.New()
	w.exec("INSERT INTO users (id, display_name) VALUES ($1, 'Member')", id)
	return id
}

// household makes a household with the conformance module enabled, owned by a user, and a member
// holding level on the module; it returns the household and the member.
func (w *world) household(level string) (household, member uuid.UUID) {
	w.t.Helper()
	household, owner, member := idgen.New(), w.user(), w.user()
	w.exec(testsupport.InsertHousehold, household)
	w.exec(testsupport.InsertMember, household, owner, "owner")
	w.exec(testsupport.InsertMember, household, member, "member")
	w.exec(testsupport.InsertEnablement, household, conformance.Name, true)
	w.exec("INSERT INTO module_grants (household_id, user_id, module, level) VALUES ($1, $2, $3, $4)", household, member, conformance.Name, level)
	return household, member
}

// serve serves req, checked against the contract but for the suite's own routes, which it is not.
func (w *world) serve(req *http.Request) *httptest.ResponseRecorder {
	w.t.Helper()
	if strings.HasPrefix(req.URL.Path, "/conformance/") {
		rec := httptest.NewRecorder()
		w.router.ServeHTTP(rec, req)
		return rec
	}
	return testsupport.Serve(w.t, w.router, req)
}

// signIn signs user in through the suite's sign-in, for ttl when it is not zero, and returns the
// access token.
func (w *world) signIn(user uuid.UUID, ttl time.Duration) string {
	w.t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/conformance/sign-in",
		strings.NewReader(fmt.Sprintf(`{"user_id": %q, "ttl_seconds": %d}`, user, int(ttl.Seconds()))))
	rec := w.serve(req)
	var out struct {
		Token     string    `json:"token"`
		ExpiresAt time.Time `json:"expires_at"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || rec.Code != http.StatusOK || out.Token == "" {
		w.t.Fatalf("sign-in: %d %s", rec.Code, rec.Body)
	}
	return out.Token
}

// push sends mutations to household's push with token under key, and returns the answer.
func (w *world) push(household uuid.UUID, token, key string, mutations ...map[string]any) *httptest.ResponseRecorder {
	w.t.Helper()
	body, err := json.Marshal(map[string]any{"mutations": mutations})
	if err != nil {
		w.t.Fatal(err)
	}
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost,
		"/api/v1/households/"+household.String()+"/sync/mutations", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	return w.serve(req)
}

// results decodes a push's answer.
func (w *world) results(rec *httptest.ResponseRecorder) push.BatchResult {
	w.t.Helper()
	if rec.Code != http.StatusOK {
		w.t.Fatalf("the push answered %d: %s", rec.Code, rec.Body)
	}
	var out push.BatchResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		w.t.Fatal(err)
	}
	return out
}

// outcomes is each result as "outcome" or "outcome code".
func outcomes(b push.BatchResult) []string {
	out := make([]string, len(b.Results))
	for i, r := range b.Results {
		out[i] = r.Outcome
		if r.Code != nil {
			out[i] += " " + *r.Code
		}
	}
	return out
}

func mutationOf(entity, op string, id uuid.UUID, fields map[string]any) map[string]any {
	if fields == nil {
		fields = map[string]any{}
	}
	return map[string]any{
		"mutation_id": idgen.New().String(), "entity_type": entity, "entity_id": id.String(), "op": op, "fields": fields,
	}
}

func at(m map[string]any, t time.Time) map[string]any {
	m["client_time"] = t.Format(time.RFC3339Nano)
	return m
}

func key() string { return idgen.New().String() }

// Every mutation goes through the spine: its row, its audit event, recorded via sync, and its
// change; each answered with the version it committed at and the row as the API serialises it.
func TestPushWritesItemsThroughTheSpine(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	milk := idgen.New()
	got := w.results(w.push(household, token, key(),
		mutationOf(conformance.Item, "create", milk, map[string]any{"title": "Milk"}),
		mutationOf(conformance.Item, "update", milk, map[string]any{"title": "Oat milk"}),
		mutationOf(conformance.Item, "update", milk, map[string]any{"note": "two litres", "quantity": 2}),
		mutationOf(conformance.Item, "delete", milk, nil),
	))
	if want := []string{push.Applied, push.Applied, push.Applied, push.Applied}; fmt.Sprint(outcomes(got)) != fmt.Sprint(want) {
		t.Fatalf("outcomes %v, want %v", outcomes(got), want)
	}
	for i, r := range got.Results {
		if r.Version == nil || *r.Version != int64(i+1) {
			t.Errorf("mutation %d answered version %v, want %d", i, r.Version, i+1)
		}
	}
	var (
		title, note string
		quantity    int
		deleted     *time.Time
	)
	if err := w.admin.QueryRow(context.Background(), "SELECT title, note, quantity, deleted_at FROM conformance_items WHERE id = $1", milk).
		Scan(&title, &note, &quantity, &deleted); err != nil {
		t.Fatal(err)
	}
	if title != "Oat milk" || note != "two litres" || quantity != 2 || deleted == nil {
		t.Errorf("the item is %q, %q, %d, deleted %v", title, note, quantity, deleted)
	}
	if n := w.count("SELECT count(*) FROM audit_events WHERE entity_id = $1 AND meta->>'via' = 'sync'", milk); n != 4 {
		t.Errorf("%d audit events via sync, want 4", n)
	}
	if n := w.count("SELECT count(*) FROM sync_changes WHERE entity_id = $1", milk); n != 4 {
		t.Errorf("%d changes, want 4", n)
	}
	if last := w.count("SELECT max(seq) FROM sync_changes WHERE household_id = $1", household); got.Seq != int64(last) {
		t.Errorf("seq %d, want the feed's %d", got.Seq, last)
	}
}

// Each mutation is answered in order, every outcome but applied with a code: a refused field, a
// mutation after a failure to write what it depends on (the row, or one a field names), an entity
// this push does not write yet, a row that is not there, and a field the entity does not take.
func TestPushAnswersEveryMutation(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	rice, jam, gone := idgen.New(), idgen.New(), idgen.New()
	got := w.results(w.push(household, token, key(),
		mutationOf(conformance.Item, "create", rice, map[string]any{"title": "Rice"}),
		mutationOf(conformance.Item, "update", rice, map[string]any{"quantity": 0}),
		mutationOf(conformance.Item, "update", rice, map[string]any{"note": "organic"}),
		mutationOf(conformance.ItemChecked, "create", idgen.New(), map[string]any{"item_id": rice.String(), "checked": true}),
		mutationOf(conformance.Item, "create", jam, map[string]any{"title": "Jam"}),
		mutationOf("conformance.budget", "create", idgen.New(), map[string]any{"name": "Food"}),
		mutationOf(conformance.Item, "update", gone, map[string]any{"title": "Nothing"}),
		mutationOf(conformance.Item, "update", jam, map[string]any{"colour": "red"}),
		mutationOf("conformance.nothing", "create", idgen.New(), nil),
	))
	want := []string{
		push.Applied, "rejected validation_failed", "deferred " + push.DependencyFailed, "deferred " + push.DependencyFailed,
		push.Applied, "rejected validation_failed", "rejected not_found", "rejected validation_failed", "rejected validation_failed",
	}
	if fmt.Sprint(outcomes(got)) != fmt.Sprint(want) {
		t.Errorf("outcomes\n  %v\nwant\n  %v", outcomes(got), want)
	}
}

// A constraint only the database sees is a rejection, never a 500, and writes nothing: a check
// naming another household's item breaks the household's foreign key, and a check under an id
// another household's check holds, the primary key.
func TestPushRefusesWhatTheDatabaseRefuses(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	other, _ := w.household("contribute")
	token := w.signIn(member, 0)
	mine, theirs, theirCheck := idgen.New(), idgen.New(), idgen.New()
	w.exec("INSERT INTO conformance_items (id, household_id, title) VALUES ($1, $2, 'Milk'), ($3, $4, 'Firewood')",
		mine, household, theirs, other)
	w.exec("INSERT INTO conformance_item_checks (id, household_id, item_id, checked, checked_at) VALUES ($1, $2, $3, true, now())",
		theirCheck, other, theirs)
	got := w.results(w.push(household, token, key(),
		mutationOf(conformance.ItemChecked, "create", idgen.New(), map[string]any{"item_id": theirs.String(), "checked": true}),
		mutationOf(conformance.ItemChecked, "create", theirCheck, map[string]any{"item_id": mine.String(), "checked": true}),
	))
	if want := []string{"rejected not_found", "rejected validation_failed"}; fmt.Sprint(outcomes(got)) != fmt.Sprint(want) {
		t.Errorf("outcomes %v, want %v", outcomes(got), want)
	}
	if n := w.count("SELECT count(*) FROM conformance_item_checks WHERE household_id = $1", household); n != 0 {
		t.Errorf("%d checks written", n)
	}
	if n := w.count("SELECT count(*) FROM conformance_item_checks WHERE id = $1 AND household_id = $2 AND item_id = $3", theirCheck, other, theirs); n != 1 {
		t.Errorf("the other household's check changed")
	}
}

// A member who may not write the module is refused each mutation: not_found without the module,
// forbidden with it at view; nothing is written.
func TestPushRefusesAMemberWithoutTheGrant(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	for level, code := range map[string]string{"none": "not_found", "view": "forbidden"} {
		household, member := w.household(level)
		item := idgen.New()
		got := w.results(w.push(household, w.signIn(member, 0), key(),
			mutationOf(conformance.Item, "create", item, map[string]any{"title": "Milk"})))
		if want := []string{"rejected " + code}; fmt.Sprint(outcomes(got)) != fmt.Sprint(want) {
			t.Errorf("%s: outcomes %v, want %v", level, outcomes(got), want)
		}
		if n := w.count("SELECT count(*) FROM conformance_items WHERE id = $1", item); n != 0 {
			t.Errorf("%s: the item was written", level)
		}
	}
}

// An entity that is read-only offline (D-84) is refused through the push, whatever the caller's
// grant: admin's are never written offline (D-80).
func TestPushRefusesAnEntityThatIsReadOnlyOffline(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, _ := w.household("contribute")
	var owner uuid.UUID
	if err := w.admin.QueryRow(context.Background(), "SELECT user_id FROM memberships WHERE household_id = $1 AND role = 'owner'", household).
		Scan(&owner); err != nil {
		t.Fatal(err)
	}
	w.exec(testsupport.InsertEnablement, household, "admin", true)
	got := w.results(w.push(household, w.signIn(owner, 0), key(),
		mutationOf("admin.household_settings", "update", household, map[string]any{"name": "Ours"})))
	if want := []string{"rejected forbidden"}; fmt.Sprint(outcomes(got)) != fmt.Sprint(want) {
		t.Errorf("outcomes %v, want %v", outcomes(got), want)
	}
}

// A check is keyed on its item whatever id each client gave it; an older intent loses to the one in
// place, one already in place writes nothing, and a client time more than a day out is clamped and
// flagged.
func TestPushResolvesChecksByItemAndClientTime(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	now := time.Now()
	milk, first, second := idgen.New(), idgen.New(), idgen.New()
	w.exec("INSERT INTO conformance_items (id, household_id, title) VALUES ($1, $2, 'Milk')", milk, household)
	check := func(id uuid.UUID, checked bool, t time.Time) map[string]any {
		return at(mutationOf(conformance.ItemChecked, "create", id, map[string]any{"item_id": milk.String(), "checked": checked}), t)
	}
	state := func() (id uuid.UUID, checked, flagged bool, version int64, when time.Time) {
		w.t.Helper()
		if err := w.admin.QueryRow(context.Background(),
			"SELECT id, checked, clock_flagged, version, checked_at FROM conformance_item_checks WHERE item_id = $1", milk).
			Scan(&id, &checked, &flagged, &version, &when); err != nil {
			w.t.Fatal(err)
		}
		return id, checked, flagged, version, when
	}

	w.results(w.push(household, token, key(), check(first, true, now)))
	// Older, under another id: it loses. The same state again: nothing is written.
	w.results(w.push(household, token, key(), check(second, false, now.Add(-time.Hour)), check(second, true, now.Add(time.Minute))))
	if id, checked, _, version, _ := state(); id != first || !checked || version != 1 {
		t.Errorf("after an older uncheck: %s checked %v at version %d", id, checked, version)
	}
	if n := w.count("SELECT count(*) FROM audit_events WHERE entity_type = $1", conformance.ItemChecked); n != 1 {
		t.Errorf("%d audit events for checks, want 1", n)
	}
	// Later, two days ahead: it wins, clamped to a day and flagged, on the row the first made.
	w.results(w.push(household, token, key(), check(second, false, now.Add(48*time.Hour))))
	id, checked, flagged, version, when := state()
	if id != first || checked || !flagged || version != 2 || when.After(time.Now().Add(push.ClockClamp)) || when.Before(now.Add(push.ClockClamp-time.Minute)) {
		t.Errorf("after a skewed uncheck: %s checked %v flagged %v version %d at %v", id, checked, flagged, version, when)
	}
}

// Two completions of one occurrence, under different ids, are one row, applied once (D-52); a
// completion names a calendar day.
func TestPushKeysACompletionOnItsChoreAndOccurrence(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	dishes := idgen.New()
	w.exec("INSERT INTO conformance_chores (id, household_id, name, rotation) VALUES ($1, $2, 'Dishes', ARRAY[$3::uuid])",
		dishes, household, member)
	done := func(day string) map[string]any {
		return mutationOf(conformance.Completion, "create", idgen.New(), map[string]any{"chore_id": dishes.String(), "occurrence": day, "done": true})
	}
	got := w.results(w.push(household, token, key(), done("2026-09-30"), done("2026-09-30"), done("30.9.2026")))
	if want := []string{push.Applied, push.Applied, "rejected validation_failed"}; fmt.Sprint(outcomes(got)) != fmt.Sprint(want) {
		t.Errorf("outcomes %v, want %v", outcomes(got), want)
	}
	if n := w.count("SELECT count(*) FROM conformance_completions WHERE chore_id = $1", dishes); n != 1 {
		t.Errorf("%d completions, want 1", n)
	}
	if n := w.count("SELECT count(*) FROM audit_events WHERE entity_type = $1", conformance.Completion); n != 1 {
		t.Errorf("%d audit events, want 1", n)
	}
}

// An additive series holds its invariant on arrival (scenario 17): a reading that falls below the
// one before it, or rises above the one after it, is rejected monotonicity_violation, naming the
// neighbour, and writes nothing; one between its neighbours is applied. A meter named in upper case
// is the same series, and a meter that is no id, or a time in a zone PostgreSQL does not know, is
// refused as the database refuses it, never failing the batch. An additive row is only created, and
// a state_set write is never a delete.
func TestPushHoldsAnAdditiveSeriesToItsInvariant(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	meter, before, after := idgen.New(), idgen.New(), idgen.New()
	day := func(n int) string { return time.Date(2026, 9, n, 7, 0, 0, 0, time.UTC).Format(time.RFC3339) }
	w.exec("INSERT INTO conformance_readings (id, household_id, meter_id, read_at, value) VALUES ($1, $3, $4, $5, 100), ($2, $3, $4, $6, 300)",
		before, after, household, meter, day(1), day(3))
	readingOf := func(meter string, n, value int) map[string]any {
		return mutationOf(conformance.Reading, "create", idgen.New(), map[string]any{"meter_id": meter, "read_at": day(n), "value": value})
	}
	reading := func(n, value int) map[string]any { return readingOf(meter.String(), n, value) }
	got := w.results(w.push(household, token, key(),
		reading(2, 50), reading(2, 400), reading(2, 200), reading(4, 250),
		mutationOf(conformance.Reading, "update", before, map[string]any{"value": 110}),
		mutationOf(conformance.ItemChecked, "delete", idgen.New(), nil),
		readingOf(strings.ToUpper(meter.String()), 4, 250), readingOf("the kitchen meter", 4, 350),
		// 22023, a time zone PostgreSQL does not know: a code of a class the database refuses a value with.
		mutationOf(conformance.Reading, "create", idgen.New(), map[string]any{
			"meter_id": meter.String(), "read_at": "2026-09-04 07:00:00 Nowhere/Else", "value": 350,
		}),
	))
	want := []string{
		"rejected monotonicity_violation", "rejected monotonicity_violation", push.Applied, "rejected monotonicity_violation",
		"rejected validation_failed", "rejected validation_failed", "rejected monotonicity_violation", "rejected validation_failed",
		"rejected validation_failed",
	}
	if fmt.Sprint(outcomes(got)) != fmt.Sprint(want) {
		t.Fatalf("outcomes\n  %v\nwant\n  %v", outcomes(got), want)
	}
	// A data exception names no constraint, and its message leaves none dangling.
	if m := got.Results[7].Message; m == nil || *m != "a field is out of range" {
		t.Errorf("the message of a meter that is no id: %v", m)
	}
	for i, neighbour := range map[int]uuid.UUID{0: before, 1: after, 3: after} {
		r := got.Results[i]
		row, _ := json.Marshal(r.Row)
		if !strings.Contains(*r.Message, neighbour.String()) || !strings.Contains(string(row), neighbour.String()) {
			t.Errorf("result %d names %s in neither %q nor %s", i, neighbour, *r.Message, row)
		}
	}
	if n := w.count("SELECT count(*) FROM conformance_readings WHERE meter_id = $1", meter); n != 3 {
		t.Errorf("%d readings, want 3", n)
	}
}

// Rows at one place in a series' order are no neighbours of each other, so a place may hold several,
// whatever their values; a reading beside that place is held to every one of them, the greatest of
// those before it and the least of those after it, whichever of them was written first.
func TestPushHoldsAReadingToEveryRowAtItsNeighboursPlace(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	day := func(n int) string { return time.Date(2026, 9, n, 7, 0, 0, 0, time.UTC).Format(time.RFC3339) }
	// Four meters, each with two readings at one time, 100 and 300: the day before the new reading
	// or the day after it, each written low first and high first.
	type series struct {
		meter, low, high uuid.UUID
		day              int
	}
	var all []series
	var batch []map[string]any
	for _, d := range []int{1, 3} {
		for _, lowFirst := range []bool{true, false} {
			s := series{meter: idgen.New(), low: idgen.New(), high: idgen.New(), day: d}
			first, second := []any{s.low, 100}, []any{s.high, 300}
			if !lowFirst {
				first, second = second, first
			}
			for _, r := range [][]any{first, second} {
				w.exec("INSERT INTO conformance_readings (id, household_id, meter_id, read_at, value) VALUES ($1, $2, $3, $4, $5)",
					r[0], household, s.meter, day(d), r[1])
			}
			all = append(all, s)
			batch = append(batch, mutationOf(conformance.Reading, "create", idgen.New(),
				map[string]any{"meter_id": s.meter.String(), "read_at": day(2), "value": 200}))
		}
	}
	got := w.results(w.push(household, token, key(), batch...))
	answers := outcomes(got)
	for i, s := range all {
		// Before it, the 300 is what it falls below; after it, the 100 is what it rises above.
		neighbour, message := s.high, ""
		if s.day == 3 {
			neighbour = s.low
		}
		if m := got.Results[i].Message; m != nil {
			message = *m
		}
		if answers[i] != "rejected monotonicity_violation" || !strings.Contains(message, neighbour.String()) {
			t.Errorf("a reading of 200 beside day %d's 100 and 300: %s, %q", s.day, answers[i], message)
		}
	}
	if n := w.count("SELECT count(*) FROM conformance_readings WHERE household_id = $1", household); n != 8 {
		t.Errorf("%d readings, want the 8 there were", n)
	}
}

// A batch delivered again under its key is answered as it was the first time and writes nothing
// more; a batch without a key is refused at the edge.
func TestPushAnswersABatchDeliveredAgain(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	k := key()
	batch := []map[string]any{mutationOf(conformance.Item, "create", idgen.New(), map[string]any{"title": "Milk"})}
	first := w.push(household, token, k, batch...)
	again := w.push(household, token, k, batch...)
	if first.Code != http.StatusOK || again.Body.String() != first.Body.String() {
		t.Errorf("delivered again: %d %s, first %d %s", again.Code, again.Body, first.Code, first.Body)
	}
	if n := w.count("SELECT count(*) FROM audit_events WHERE household_id = $1", household); n != 1 {
		t.Errorf("%d audit events, want 1", n)
	}
	if rec := w.push(household, token, "", batch...); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("without a key: %d, want 422", rec.Code)
	}
}

// Per-mutation idempotency (FR-SY5): a batch delivered again under a fresh key is answered from each
// mutation's kept answer, outcome, code and version alike, and takes no second effect, though the
// rows moved on since, and a state already in place and a refusal are kept as an applied write is.
// A deferred mutation keeps none, and runs when delivered again. A mutation id sent again carrying
// another mutation is refused, and a mutation id another member sent is new to the caller.
func TestPushAnswersEachMutationAsItWasAnsweredFirst(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	milk, bread := idgen.New(), idgen.New()
	w.exec("INSERT INTO conformance_items (id, household_id, title) VALUES ($1, $2, 'Bread')", bread, household)
	batch := []map[string]any{
		mutationOf(conformance.Item, "create", milk, map[string]any{"title": "Milk"}),
		mutationOf(conformance.Item, "update", milk, map[string]any{"quantity": 0}),
		mutationOf(conformance.Item, "update", milk, map[string]any{"note": "semi-skimmed"}),
		mutationOf(conformance.Item, "update", bread, map[string]any{"title": "Bread"}),
	}
	first := w.results(w.push(household, token, key(), batch...))
	if want := []string{push.Applied, "rejected validation_failed", "deferred " + push.DependencyFailed, push.Applied}; fmt.Sprint(outcomes(first)) != fmt.Sprint(want) {
		t.Fatalf("outcomes %v, want %v", outcomes(first), want)
	}
	// The rows move on meanwhile.
	w.results(w.push(household, token, key(), mutationOf(conformance.Item, "update", milk, map[string]any{"title": "Oat milk"})))
	events := w.count("SELECT count(*) FROM audit_events WHERE household_id = $1", household)

	// The deferred mutation replayed alone, as the connector replays it: it runs.
	replayed := w.results(w.push(household, token, key(), batch[2]))
	if want := []string{push.Applied}; fmt.Sprint(outcomes(replayed)) != fmt.Sprint(want) {
		t.Fatalf("the replay: %v, want %v", outcomes(replayed), want)
	}
	again := w.results(w.push(household, token, key(), batch...))
	for i, r := range again.Results {
		want := first.Results[i]
		if i == 2 {
			want = replayed.Results[0]
		}
		if answered(r) != answered(want) {
			t.Errorf("mutation %d sent again: %s, first %s", i, answered(r), answered(want))
		}
	}
	if n := w.count("SELECT count(*) FROM audit_events WHERE household_id = $1", household); n != events+1 {
		t.Errorf("%d audit events, want %d: only the replay's", n, events+1)
	}

	// The same mutation encoded otherwise, as a client that kept its queue as objects encodes it
	// again: a letter escaped is the letter, and a nested object's keys in another order are the same
	// object. Each is answered as it was.
	respelled := map[string]any{"mutation_id": batch[0]["mutation_id"], "entity_type": conformance.Item, "entity_id": milk.String(),
		"op": "create", "fields": map[string]any{"title": json.RawMessage(`"\u004dilk"`)}}
	if got := w.results(w.push(household, token, key(), respelled)); answered(got.Results[0]) != answered(first.Results[0]) {
		t.Errorf("the first mutation encoded otherwise: %s, first %s", answered(got.Results[0]), answered(first.Results[0]))
	}
	nested := mutationOf(conformance.Item, "create", idgen.New(), map[string]any{"title": "Tea", "extra": json.RawMessage(`{"a": 1, "b": [2, {"c": 3, "d": 4}]}`)})
	refused := w.results(w.push(household, token, key(), nested))
	nested["fields"] = map[string]any{"extra": json.RawMessage(`{"b":[2,{"d":4,"c":3}],"a":1}`), "title": "Tea"}
	reordered := w.results(w.push(household, token, key(), nested))
	if outcomes(refused)[0] != "rejected validation_failed" || *reordered.Results[0].Message != *refused.Results[0].Message {
		t.Errorf("a nested object's keys in another order: %q, first %v %q", *reordered.Results[0].Message, outcomes(refused),
			*refused.Results[0].Message)
	}

	changed := batch[0]
	changed = map[string]any{"mutation_id": changed["mutation_id"], "entity_type": conformance.Item, "entity_id": milk.String(), "op": "update",
		"fields": map[string]any{"title": "Goat milk"}}
	if got := outcomes(w.results(w.push(household, token, key(), changed))); fmt.Sprint(got) != "[rejected validation_failed]" {
		t.Errorf("a mutation id sent again with another mutation: %v", got)
	}

	// Another member of the household sends the same mutation id: it is theirs, and new.
	other := w.user()
	w.exec(testsupport.InsertMember, household, other, "member")
	w.exec("INSERT INTO module_grants (household_id, user_id, module, level) VALUES ($1, $2, $3, 'contribute')", household, other, conformance.Name)
	theirs := map[string]any{"mutation_id": batch[3]["mutation_id"], "entity_type": conformance.Item, "entity_id": bread.String(), "op": "update",
		"fields": map[string]any{"note": "sliced"}}
	got := w.results(w.push(household, w.signIn(other, 0), key(), theirs))
	if outcomes(got)[0] != push.Applied || got.Results[0].Version == nil || *got.Results[0].Version != 2 {
		t.Errorf("another member's mutation under the same id: %v", outcomes(got))
	}
}

// A mutation id a batch repeats is answered as its first delivery in the batch was, the answers
// having been read before the batch began: a write is answered with the version it committed and
// takes no second effect, and a refusal is answered as a refusal, never deferred behind itself.
func TestPushAnswersAMutationTheBatchRepeatsAsItsFirstDelivery(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	milk := idgen.New()
	create := mutationOf(conformance.Item, "create", milk, map[string]any{"title": "Milk"})
	refused := mutationOf(conformance.Item, "update", milk, map[string]any{"quantity": 0})
	got := w.results(w.push(household, token, key(), create, create, refused, refused))
	want := []string{push.Applied, push.Applied, "rejected validation_failed", "rejected validation_failed"}
	if fmt.Sprint(outcomes(got)) != fmt.Sprint(want) {
		t.Fatalf("outcomes %v, want %v", outcomes(got), want)
	}
	if answered(got.Results[1]) != answered(got.Results[0]) {
		t.Errorf("the repeat: %s, first %s", answered(got.Results[1]), answered(got.Results[0]))
	}
	if n := w.count("SELECT count(*) FROM audit_events WHERE entity_id = $1", milk); n != 1 {
		t.Errorf("%d audit events, want 1", n)
	}
}

// answered is r's outcome, code and version, as invariant 3 compares them.
func answered(r push.Result) string {
	code, version := "-", "-"
	if r.Code != nil {
		code = *r.Code
	}
	if r.Version != nil {
		version = fmt.Sprint(*r.Version)
	}
	return r.Outcome + " " + code + " " + version
}

// A batch of more than 500 mutations is refused whole, 413 batch_too_large, for the client to send
// in smaller ones; and a device's batches are limited, 429 past them.
func TestPushLimitsABatchAndADevice(t *testing.T) {
	w := newWorld(t, apptest.Options{PushLimit: ratelimit.Rate{PerMinute: 2, Burst: 2}})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	big := make([]map[string]any, push.MaxBatch+1)
	for i := range big {
		big[i] = mutationOf(conformance.Item, "create", idgen.New(), map[string]any{"title": "Milk"})
	}
	rec := w.push(household, token, key(), big...)
	if rec.Code != http.StatusRequestEntityTooLarge || !strings.Contains(rec.Body.String(), `"batch_too_large"`) {
		t.Errorf("a batch of %d: %d %s", len(big), rec.Code, rec.Body)
	}
	w.push(household, token, key(), big[0])
	if rec := w.push(household, token, key(), big[1]); rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Errorf("a third batch within the minute: %d %v", rec.Code, rec.Header())
	}
	// Another device of the member's has a budget of its own.
	if rec := w.push(household, w.signIn(member, 0), key(), big[2]); rec.Code != http.StatusOK {
		t.Errorf("another device's batch: %d %s", rec.Code, rec.Body)
	}
}

// takeover is the conformance module with a writer that runs take before each write: a test's way in
// between the Idempotency-Key's claim and the mutation's commit.
type takeover struct {
	conformance.Module
	take func()
}

func (m takeover) WriteSync(ctx context.Context, tx pgx.Tx, mut push.Mutation) (push.Written, error) {
	m.take()
	return m.Module.WriteSync(ctx, tx, mut)
}

// A batch whose Idempotency-Key a repeat of the request took over, once the key's lease had passed,
// can no longer commit: its mutation is rolled back, it keeps no answer, and it is answered as a
// repeat of a request still running is, 409 idempotency_in_progress, with nothing logged as a
// failure, since nothing on the server failed.
func TestPushAnswersABatchWhoseKeyWasTakenOver(t *testing.T) {
	var take func()
	w := newWorldOf(t, apptest.Options{}, takeover{take: func() { take() }})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	k, milk := key(), idgen.New()
	// As take does to a claim past its lease: the repeat holds the key under a claim of its own.
	take = func() {
		w.exec("UPDATE idempotency_keys SET claim = gen_random_uuid(), claimed_at = now() WHERE household_id = $1 AND key = $2", household, k)
	}
	rec := w.push(household, token, k, mutationOf(conformance.Item, "create", milk, map[string]any{"title": "Milk"}))
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"idempotency_in_progress"`) {
		t.Fatalf("a batch whose key was taken over: %d %s", rec.Code, rec.Body)
	}
	if n := w.count("SELECT count(*) FROM conformance_items WHERE id = $1", milk); n != 0 {
		t.Errorf("%d items written, want none", n)
	}
	if n := w.count("SELECT count(*) FROM sync_mutations WHERE household_id = $1", household); n != 0 {
		t.Errorf("%d answers kept, want none", n)
	}
	if n := w.failures.Load(); n != 0 {
		t.Errorf("%d failures logged, want none", n)
	}
}

// A member removed from the household while their batch runs, as one who leaves it, is answered as
// the tenant middleware answers their next request, 404 not_found, and never as a failure of the
// server's: the answer to the mutation the removal caught cannot be kept for a sender who is no longer
// a member, and the mutation is rolled back with it.
func TestPushAnswersAMemberRemovedWhileTheirBatchRuns(t *testing.T) {
	var take func()
	w := newWorldOf(t, apptest.Options{}, takeover{take: func() { take() }})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	// As an owner's removal does, between the tenant middleware's look-up and the mutation's commit.
	take = func() {
		w.exec("DELETE FROM memberships WHERE household_id = $1 AND user_id = $2", household, member)
	}
	milk := idgen.New()
	rec := w.push(household, token, key(), mutationOf(conformance.Item, "create", milk, map[string]any{"title": "Milk"}))
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"not_found"`) {
		t.Fatalf("a member removed while their batch runs: %d %s", rec.Code, rec.Body)
	}
	if n := w.count("SELECT count(*) FROM conformance_items WHERE id = $1", milk); n != 0 {
		t.Errorf("%d items written, want none", n)
	}
	if n := w.failures.Load(); n != 0 {
		t.Errorf("%d failures logged, want none", n)
	}
}

// serviceLayer is the conformance module with a writer that refuses as a module's REST service layer
// does, with a problem: an item titled Refused as a validation_failed naming its title, one titled
// Stale as the version_conflict of an item written since, and one titled Broken as a failure of the
// server's own.
type serviceLayer struct{ conformance.Module }

func (m serviceLayer) WriteSync(ctx context.Context, tx pgx.Tx, mut push.Mutation) (push.Written, error) {
	switch string(mut.Fields["title"]) {
	case `"Refused"`:
		return push.Written{}, problem.Validation(problem.FieldError{Field: "/title", Code: "max_length"})
	case `"Stale"`:
		return push.Written{}, problem.Conflict(map[string]any{"id": mut.EntityID, "title": "Fresh", "version": 3}, 3)
	case `"Broken"`:
		return push.Written{}, problem.Internal()
	}
	return m.Module.WriteSync(ctx, tx, mut)
}

// A writer that writes through its module's service layer refuses as that layer answers the REST
// routes, with a problem, and the push answers it as a refusal, never failing the batch: rejected
// with the problem's code, naming the fields it names, and a version_conflict as a conflict carrying
// the row as it stands. A later mutation of the row is deferred behind it, as behind any refusal, and
// each answer is kept, so that the batch delivered again is answered as it was. A problem of the
// server's own fails the batch.
func TestPushAnswersTheProblemsAWritersServiceLayerRefusesWith(t *testing.T) {
	w := newWorldOf(t, apptest.Options{}, serviceLayer{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	refused := idgen.New()
	batch := []map[string]any{
		mutationOf(conformance.Item, "create", refused, map[string]any{"title": "Refused"}),
		mutationOf(conformance.Item, "update", refused, map[string]any{"note": "later"}),
		mutationOf(conformance.Item, "create", idgen.New(), map[string]any{"title": "Stale"}),
		mutationOf(conformance.Item, "create", idgen.New(), map[string]any{"title": "Milk"}),
	}
	want := fmt.Sprint([]string{"rejected validation_failed", "deferred " + push.DependencyFailed, "conflict version_conflict", push.Applied})
	got := w.results(w.push(household, token, key(), batch...))
	if fmt.Sprint(outcomes(got)) != want {
		t.Fatalf("outcomes\n  %v\nwant\n  %v", outcomes(got), want)
	}
	if m := got.Results[0].Message; m == nil || !strings.Contains(*m, "/title max_length") {
		t.Errorf("a refusal naming the title: %v", m)
	}
	if row, _ := json.Marshal(got.Results[2].Row); !strings.Contains(string(row), `"title":"Fresh"`) {
		t.Errorf("a conflict's row: %s", row)
	}
	// Delivered again under a fresh key, as a client retries a batch whole.
	if again := w.results(w.push(household, token, key(), batch...)); fmt.Sprint(outcomes(again)) != want {
		t.Errorf("the batch delivered again: %v, want %v", outcomes(again), want)
	}
	if n := w.count("SELECT count(*) FROM sync_mutations WHERE household_id = $1", household); n != 3 {
		t.Errorf("%d answers kept, want 3: every one but the deferred", n)
	}
	if n := w.failures.Load(); n != 0 {
		t.Errorf("%d failures logged, want none", n)
	}
	rec := w.push(household, token, key(), mutationOf(conformance.Item, "create", idgen.New(), map[string]any{"title": "Broken"}))
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("a problem of the server's own: %d %s", rec.Code, rec.Body)
	}
}

// credentials asks household's credentials with header, and returns the answer.
func (w *world) credentials(household uuid.UUID, header http.Header) *httptest.ResponseRecorder {
	w.t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost,
		"/api/v1/households/"+household.String()+"/sync/credentials", nil)
	for name, values := range header {
		for _, v := range values {
			req.Header.Add(name, v)
		}
	}
	return w.serve(req)
}

func bearer(token string) http.Header { return http.Header{"Authorization": {"Bearer " + token}} }

// A member's credentials name PowerSync and a token of PowerSync's own: EdDSA, the keys the API
// publishes verifying it, its subject the member, its audience PowerSync's, lasting five minutes;
// the API refuses it. A stranger to the household is not found, and a device whose sign-in ended, or
// no credential at all, is refused; a web session is handed credentials as a device is.
func TestTheCredentialsHandOutPowerSyncsToken(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("view")
	token := w.signIn(member, 0)
	rec := w.credentials(household, bearer(token))
	var creds struct {
		Endpoint  string    `json:"endpoint"`
		Token     string    `json:"token"`
		ExpiresAt time.Time `json:"expires_at"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &creds); err != nil || rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("credentials: %d %s %v", rec.Code, rec.Body, rec.Header())
	}
	if creds.Endpoint != apptest.PowerSyncURL || time.Until(creds.ExpiresAt) > replica.Lifetime || time.Until(creds.ExpiresAt) < replica.Lifetime-time.Minute {
		t.Errorf("credentials: %+v", creds)
	}

	// Verified as PowerSync verifies it, with the keys the API publishes.
	jwksRec := w.serve(httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/sync/jwks", nil))
	var set struct {
		Keys []struct {
			Kid, X string
		} `json:"keys"`
	}
	if err := json.Unmarshal(jwksRec.Body.Bytes(), &set); err != nil || jwksRec.Code != http.StatusOK || len(set.Keys) == 0 {
		t.Fatalf("the keys: %d %s", jwksRec.Code, jwksRec.Body)
	}
	// PowerSync's asking again for a key it does not hold reaches the API, past any cache on the way.
	if got := jwksRec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("the keys' Cache-Control: %q, want no-cache", got)
	}
	var claims jwt.RegisteredClaims
	_, err := jwt.ParseWithClaims(creds.Token, &claims, func(tok *jwt.Token) (any, error) {
		for _, k := range set.Keys {
			if k.Kid == tok.Header["kid"] {
				x, err := base64.RawURLEncoding.DecodeString(k.X)
				return ed25519.PublicKey(x), err
			}
		}
		return nil, fmt.Errorf("no key %v", tok.Header["kid"])
	}, jwt.WithValidMethods([]string{"EdDSA"}), jwt.WithAudience(replica.Audience))
	if err != nil || claims.Subject != member.String() {
		t.Errorf("PowerSync's token: %v, sub %s", err, claims.Subject)
	}

	stranger := w.user()
	revoked := w.signIn(member, 0)
	w.exec("UPDATE device_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND created_at = (SELECT max(created_at) FROM device_sessions WHERE user_id = $1)", member)
	for name, tc := range map[string]struct {
		header http.Header
		want   int
	}{
		"a stranger to the household":  {bearer(w.signIn(stranger, 0)), http.StatusNotFound},
		"PowerSync's own token":        {bearer(creds.Token), http.StatusUnauthorized},
		"a device whose sign-in ended": {bearer(revoked), http.StatusUnauthorized},
		"no credential":                {nil, http.StatusUnauthorized},
		"the member, for contrast":     {bearer(token), http.StatusOK},
	} {
		if got := w.credentials(household, tc.header).Code; got != tc.want {
			t.Errorf("%s: credentials answered %d, want %d", name, got, tc.want)
		}
	}
}

// A web session is handed credentials as a device is.
func TestTheCredentialsAnswerAWebSession(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("view")
	var tokens session.Tokens
	if err := tenant.AccountTx(t.Context(), w.pool, member, func(tx pgx.Tx) error {
		var err error
		_, tokens, err = w.accounts.Sessions.Create(t.Context(), tx, member, "a browser")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	rec := w.credentials(household, http.Header{
		"Cookie":           {session.Cookie + "=" + tokens.Session + "; " + session.CSRFCookie + "=" + tokens.CSRF},
		session.CSRFHeader: {tokens.CSRF},
		"Origin":           {apptest.WebOrigin},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("a web session's credentials: %d %s", rec.Code, rec.Body)
	}
}

// The suite's sign-in signs a new device of the member's in, for as long as it is asked to, and never
// longer than an access token lasts.
func TestTheSuitesSignInSignsADeviceIn(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("view")
	short := w.signIn(member, 2*time.Second)
	if rec := w.credentials(household, bearer(short)); rec.Code != http.StatusOK {
		t.Fatalf("a short token: %d %s", rec.Code, rec.Body)
	}
	claims, err := apptest.TokenKeys.Verify(short, time.Now())
	if err != nil || time.Until(claims.ExpiresAt) > 3*time.Second {
		t.Errorf("a two-second token: %+v %v", claims, err)
	}
	if n := w.count("SELECT count(*) FROM device_sessions WHERE user_id = $1 AND revoked_at IS NULL", member); n != 1 {
		t.Errorf("%d live sign-ins, want 1", n)
	}
	rec := w.serve(httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/conformance/sign-in",
		strings.NewReader(fmt.Sprintf(`{"user_id": %q, "ttl_seconds": 3600}`, member))))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("an hour's token: %d", rec.Code)
	}
}

// The suite's streams read what the conformance module's migrations publish (architecture test 10,
// on the suite's database).
func TestTheSuitesStreamsReadWhatIsReplicated(t *testing.T) {
	streams, err := syncconfig.SuiteStreams()
	if err != nil {
		t.Fatal(err)
	}
	registry, err := module.NewRegistry(conformance.Module{})
	if err != nil {
		t.Fatal(err)
	}
	tx, err := testsupport.Open(t).Pool(t, "").Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	violations, err := syncconfig.Replication(t.Context(), tx, streams, registry.Entities())
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range violations {
		t.Error(v)
	}
}
