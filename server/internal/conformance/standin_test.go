package conformance

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

func TestMain(m *testing.M) {
	block, err := Block()
	if err != nil {
		panic(err)
	}
	testsupport.Main(m, block)
}

var (
	powerSyncKey = []byte("conformance-test-powersync-key-of-32-bytes")
	apiKey       = []byte("conformance-test-standin-api-key-of-32-bytes")
)

// world is one test's stand-in, its router, and the administrator's pool to arrange and check rows.
type world struct {
	t      *testing.T
	admin  *pgxpool.Pool
	s      *StandIn
	router chi.Router
	now    time.Time
}

func newWorld(t *testing.T) *world {
	t.Helper()
	d := testsupport.Open(t)
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	w := &world{t: t, admin: d.Pool(t, ""), now: time.Now()}
	w.s, err = New(Config{
		Pool: d.Pool(t, db.RoleApp), Logger: slog.New(slog.DiscardHandler), Contract: c,
		PowerSyncURL: "http://powersync.test", PowerSyncKey: powerSyncKey, APIKey: apiKey, MaxBodyBytes: 1 << 20,
		Now: func() time.Time { return w.now },
	})
	if err != nil {
		t.Fatal(err)
	}
	if w.router, err = w.s.Router(); err != nil {
		t.Fatal(err)
	}
	return w
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

// household makes a household with the conformance module enabled, owned by a user, and a member
// holding level on the module; it returns the household and the member.
func (w *world) household(level string) (household, member uuid.UUID) {
	w.t.Helper()
	household, owner, member := idgen.New(), idgen.New(), idgen.New()
	w.exec("INSERT INTO users (id) VALUES ($1), ($2)", owner, member)
	w.exec(testsupport.InsertHousehold, household)
	w.exec(testsupport.InsertMember, household, owner, "owner")
	w.exec(testsupport.InsertMember, household, member, "member")
	w.exec(testsupport.InsertEnablement, household, Name, true)
	w.exec("INSERT INTO module_grants (household_id, user_id, module, level) VALUES ($1, $2, $3, $4)", household, member, Name, level)
	return household, member
}

func (w *world) token(user uuid.UUID) string {
	w.t.Helper()
	tok, _, err := w.s.sign(apiKey, "", APIAudience, user, time.Hour)
	if err != nil {
		w.t.Fatal(err)
	}
	return tok
}

// push sends mutations to household's push as user under key, checks the response against the
// contract, and returns it.
func (w *world) push(household, user uuid.UUID, key string, mutations ...map[string]any) *httptest.ResponseRecorder {
	w.t.Helper()
	body, err := json.Marshal(map[string]any{"mutations": mutations})
	if err != nil {
		w.t.Fatal(err)
	}
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost,
		"/api/v1/households/"+household.String()+"/sync/mutations", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+w.token(user))
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	return testsupport.Serve(w.t, w.router, req)
}

// results decodes a push's answer.
func (w *world) results(rec *httptest.ResponseRecorder) BatchResult {
	w.t.Helper()
	if rec.Code != http.StatusOK {
		w.t.Fatalf("the push answered %d: %s", rec.Code, rec.Body)
	}
	var out BatchResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		w.t.Fatal(err)
	}
	return out
}

// outcomes is each result as "outcome" or "outcome code".
func outcomes(b BatchResult) []string {
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

func TestTokens(t *testing.T) {
	w := newWorld(t)
	household, member := w.household("contribute")
	stranger := idgen.New()
	w.exec("INSERT INTO users (id) VALUES ($1)", stranger)

	credentials := func(token string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodPost,
			"/standin/households/"+household.String()+"/sync/credentials", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		w.router.ServeHTTP(rec, req)
		return rec
	}

	// The sign-in names the caller, for as long as it is asked to.
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/standin/sign-in",
		strings.NewReader(fmt.Sprintf(`{"user_id": %q, "ttl_seconds": 60}`, member)))
	rec := httptest.NewRecorder()
	w.router.ServeHTTP(rec, req)
	var signedIn tokenResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &signedIn); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("sign-in: %d %s", rec.Code, rec.Body)
	}
	if got := signedIn.ExpiresAt.Sub(w.now.Truncate(time.Second)); got != time.Minute {
		t.Errorf("the API token lasts %v, want the minute asked for", got)
	}

	// A member's credentials name PowerSync and a token of its own for them.
	rec = credentials(signedIn.Token)
	var creds credentialsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &creds); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("credentials: %d %s", rec.Code, rec.Body)
	}
	var claims jwt.RegisteredClaims
	parsed, err := jwt.ParseWithClaims(creds.Token, &claims, func(*jwt.Token) (any, error) { return powerSyncKey, nil },
		jwt.WithAudience(PowerSyncAudience), jwt.WithTimeFunc(func() time.Time { return w.now }))
	if err != nil || claims.Subject != member.String() || parsed.Header["kid"] != PowerSyncKeyID || creds.Endpoint != "http://powersync.test" {
		t.Errorf("credentials: %v, sub %s, kid %v, endpoint %s", err, claims.Subject, parsed.Header["kid"], creds.Endpoint)
	}

	for name, tc := range map[string]struct {
		token string
		want  int
	}{
		"a stranger to the household":  {w.token(stranger), http.StatusNotFound},
		"PowerSync's token":            {creds.Token, http.StatusUnauthorized},
		"no token":                     {"", http.StatusUnauthorized},
		"a token another key signed":   {func() string { tok, _, _ := w.s.sign(powerSyncKey, "", APIAudience, member, time.Hour); return tok }(), http.StatusUnauthorized},
		"a token that expired":         {func() string { tok, _, _ := w.s.sign(apiKey, "", APIAudience, member, -time.Minute); return tok }(), http.StatusUnauthorized},
		"a member's own, for contrast": {w.token(member), http.StatusOK},
	} {
		if got := credentials(tc.token).Code; got != tc.want {
			t.Errorf("%s: credentials answered %d, want %d", name, got, tc.want)
		}
	}
}

// Every mutation goes through the spine: its row, its audit event, via sync, and its change.
func TestPushWritesItemsThroughTheSpine(t *testing.T) {
	w := newWorld(t)
	household, member := w.household("contribute")
	milk := idgen.New()
	got := w.results(w.push(household, member, idgen.New().String(),
		mutationOf(Item, "create", milk, map[string]any{"title": "Milk"}),
		mutationOf(Item, "update", milk, map[string]any{"title": "Oat milk"}),
		mutationOf(Item, "update", milk, map[string]any{"note": "two litres", "quantity": 2}),
		mutationOf(Item, "delete", milk, nil),
	))
	if want := []string{Applied, Applied, Applied, Applied}; fmt.Sprint(outcomes(got)) != fmt.Sprint(want) {
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

// Each mutation is answered in order, and one after a failure to write what it depends on waits.
func TestPushAnswersEveryMutation(t *testing.T) {
	w := newWorld(t)
	household, member := w.household("contribute")
	rice, jam, gone := idgen.New(), idgen.New(), idgen.New()
	got := w.results(w.push(household, member, idgen.New().String(),
		mutationOf(Item, "create", rice, map[string]any{"title": "Rice"}),
		mutationOf(Item, "update", rice, map[string]any{"quantity": 0}),
		mutationOf(Item, "update", rice, map[string]any{"note": "organic"}),
		mutationOf(ItemChecked, "create", idgen.New(), map[string]any{"item_id": rice.String(), "checked": true}),
		mutationOf(Item, "create", jam, map[string]any{"title": "Jam"}),
		mutationOf("conformance.budget", "create", idgen.New(), map[string]any{"name": "Food"}),
		mutationOf(Item, "update", gone, map[string]any{"title": "Nothing"}),
		mutationOf(Item, "update", jam, map[string]any{"colour": "red"}),
	))
	want := []string{
		Applied, "rejected validation_failed", "deferred " + DependencyFailed, "deferred " + DependencyFailed,
		Applied, "rejected validation_failed", "rejected not_found", "rejected validation_failed",
	}
	if fmt.Sprint(outcomes(got)) != fmt.Sprint(want) {
		t.Errorf("outcomes\n  %v\nwant\n  %v", outcomes(got), want)
	}
}

// A member who may not write the module is refused each mutation: not_found without the module,
// forbidden with it at view; nothing is written.
func TestPushRefusesAMemberWithoutTheGrant(t *testing.T) {
	w := newWorld(t)
	for level, code := range map[string]string{"none": "not_found", "view": "forbidden"} {
		household, member := w.household(level)
		item := idgen.New()
		got := w.results(w.push(household, member, idgen.New().String(), mutationOf(Item, "create", item, map[string]any{"title": "Milk"})))
		if want := []string{"rejected " + code}; fmt.Sprint(outcomes(got)) != fmt.Sprint(want) {
			t.Errorf("%s: outcomes %v, want %v", level, outcomes(got), want)
		}
		if n := w.count("SELECT count(*) FROM conformance_items WHERE id = $1", item); n != 0 {
			t.Errorf("%s: the item was written", level)
		}
	}
}

// A check is keyed on its item whatever id each client gave it; an older intent loses to the one in
// place, one already in place writes nothing, and a client time more than a day out is clamped and
// flagged.
func TestPushResolvesChecksByItemAndClientTime(t *testing.T) {
	w := newWorld(t)
	household, member := w.household("contribute")
	milk, first, second := idgen.New(), idgen.New(), idgen.New()
	w.exec("INSERT INTO conformance_items (id, household_id, title) VALUES ($1, $2, 'Milk')", milk, household)
	check := func(id uuid.UUID, checked bool, t time.Time) map[string]any {
		return at(mutationOf(ItemChecked, "create", id, map[string]any{"item_id": milk.String(), "checked": checked}), t)
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

	w.results(w.push(household, member, idgen.New().String(), check(first, true, w.now)))
	// Older, under another id: it loses. The same state again: nothing is written.
	w.results(w.push(household, member, idgen.New().String(), check(second, false, w.now.Add(-time.Hour)), check(second, true, w.now.Add(time.Minute))))
	if id, checked, _, version, _ := state(); id != first || !checked || version != 1 {
		t.Errorf("after an older uncheck: %s checked %v at version %d", id, checked, version)
	}
	if n := w.count("SELECT count(*) FROM audit_events WHERE entity_type = $1", ItemChecked); n != 1 {
		t.Errorf("%d audit events for checks, want 1", n)
	}
	// Later, two days ahead: it wins, clamped to a day and flagged, on the row the first made.
	w.results(w.push(household, member, idgen.New().String(), check(second, false, w.now.Add(48*time.Hour))))
	id, checked, flagged, version, when := state()
	if id != first || checked || !flagged || version != 2 || !when.Equal(w.now.Add(ClockClamp).Truncate(time.Microsecond)) {
		t.Errorf("after a skewed uncheck: %s checked %v flagged %v version %d at %v", id, checked, flagged, version, when)
	}
}

// A batch delivered again under its key is answered as it was the first time and writes nothing
// more; a batch without a key is refused at the edge.
func TestPushAnswersABatchDeliveredAgain(t *testing.T) {
	w := newWorld(t)
	household, member := w.household("contribute")
	key := idgen.New().String()
	batch := []map[string]any{mutationOf(Item, "create", idgen.New(), map[string]any{"title": "Milk"})}
	first := w.push(household, member, key, batch...)
	again := w.push(household, member, key, batch...)
	if first.Code != http.StatusOK || again.Body.String() != first.Body.String() {
		t.Errorf("delivered again: %d %s, first %d %s", again.Code, again.Body, first.Code, first.Body)
	}
	if n := w.count("SELECT count(*) FROM audit_events WHERE household_id = $1", household); n != 1 {
		t.Errorf("%d audit events, want 1", n)
	}
	if rec := w.push(household, member, "", batch...); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("without a key: %d, want 422", rec.Code)
	}
}

// Setup gives PowerSync a role that replicates past row-level security and reads the replicated
// tables and nothing else, the tables at REPLICA IDENTITY FULL in the publication, and a database
// of its own for its buckets; run again, it changes nothing.
func TestSetupPreparesPowerSync(t *testing.T) {
	ctx := context.Background()
	d := testsupport.Open(t)
	suffix := strings.ReplaceAll(idgen.New().String()[24:], "-", "")
	roles := Roles{
		Replication: "conformance_test_ps_" + suffix, ReplicationPassword: "replication",
		Storage: "conformance_test_storage_" + suffix, StoragePassword: "storage",
		StorageDatabase: "conformance_test_buckets_" + suffix,
	}
	cluster, err := pgx.Connect(ctx, testsupport.AdminURL())
	if err != nil {
		t.Fatal(err)
	}
	admin, err := pgx.Connect(ctx, d.URL(""))
	if err != nil {
		t.Fatal(err)
	}
	// The roles and the database are the cluster's, so they go once the test is done.
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = cluster.Exec(ctx, "DROP DATABASE IF EXISTS "+pgx.Identifier{roles.StorageDatabase}.Sanitize())
		_, _ = admin.Exec(ctx, "DROP PUBLICATION IF EXISTS "+Publication)
		for _, r := range []string{roles.Replication, roles.Storage} {
			_, _ = admin.Exec(ctx, "DROP OWNED BY "+pgx.Identifier{r}.Sanitize())
			_, _ = cluster.Exec(ctx, "DROP ROLE IF EXISTS "+pgx.Identifier{r}.Sanitize())
		}
		_ = admin.Close(ctx)
		_ = cluster.Close(ctx)
	})
	for range 2 {
		if err := Setup(ctx, admin, d.Name, roles); err != nil {
			t.Fatal(err)
		}
	}

	var replication, bypass bool
	if err := admin.QueryRow(ctx, "SELECT rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1", roles.Replication).
		Scan(&replication, &bypass); err != nil || !replication || !bypass {
		t.Errorf("the replication role: REPLICATION %v, BYPASSRLS %v, %v", replication, bypass, err)
	}
	for table, want := range map[string]bool{"conformance_items": true, "memberships": true, "users": false, "credentials": false, "audit_events": false} {
		var reads bool
		if err := admin.QueryRow(ctx, "SELECT has_table_privilege($1, $2, 'SELECT')", roles.Replication, table).Scan(&reads); err != nil || reads != want {
			t.Errorf("the replication role reads %s: %v, want %v (%v)", table, reads, want, err)
		}
	}
	var published []string
	rows, err := admin.Query(ctx, "SELECT tablename FROM pg_publication_tables WHERE pubname = $1 ORDER BY tablename", Publication)
	if err == nil {
		published, err = pgx.CollectRows(rows, pgx.RowTo[string])
	}
	if err != nil || len(published) != len(Replicated) {
		t.Errorf("published %v, want %v (%v)", published, Replicated, err)
	}
	if n := countOn(t, admin, `SELECT count(*) FROM pg_class WHERE relname = ANY ($1) AND relreplident = 'f'`, Replicated); n != len(Replicated) {
		t.Errorf("%d of %d replicated tables at REPLICA IDENTITY FULL", n, len(Replicated))
	}
	if n := countOn(t, admin, `SELECT count(*) FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE d.datname = $1 AND r.rolname = '`+roles.Storage+`'`,
		roles.StorageDatabase); n != 1 {
		t.Errorf("the bucket storage's database is not the storage role's")
	}
}

func countOn(t *testing.T, conn *pgx.Conn, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := conn.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}
