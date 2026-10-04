package conformance_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/conformance"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/push"
	"github.com/kareltilcer/household/server/internal/platform/replica"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// entry is one entity type of a replica's report.
type entry struct {
	EntityType string `json:"entity_type"`
	Hash       string `json:"hash"`
	Count      int64  `json:"count"`
}

// verdict is the report's answer.
type verdict struct {
	Matched            bool `json:"matched"`
	ResnapshotRequired bool `json:"resnapshot_required"`
	Entries            []struct {
		EntityType  string `json:"entity_type"`
		Matched     bool   `json:"matched"`
		ServerCount int64  `json:"server_count"`
	} `json:"entries"`
}

// entryOf is the entry a replica holding rows, by id and version, reports for entity.
func entryOf(entity string, rows map[uuid.UUID]int64) entry {
	var d replica.Digest
	for id, version := range rows {
		d.Add(id, version)
	}
	return entry{EntityType: entity, Hash: d.Hex(), Count: d.Count}
}

// report sends household's replica's report, as token's member, with entries and its health.
func (w *world) report(household uuid.UUID, token string, replicaID uuid.UUID, entries ...entry) *httptest.ResponseRecorder {
	w.t.Helper()
	return w.reportAs(household, bearer(token), replicaID, entries...)
}

// reportAs is report, signed in by header: a device's token, or a web session's cookies.
func (w *world) reportAs(household uuid.UUID, header http.Header, replicaID uuid.UUID, entries ...entry) *httptest.ResponseRecorder {
	w.t.Helper()
	body, err := json.Marshal(map[string]any{
		"replica_id": replicaID, "checkpoint": "42", "algorithm": replica.Algorithm,
		"health":  map[string]int{"pending_mutations": 0, "unresolved": 1, "checksum_failures": 0},
		"entries": entries,
	})
	if err != nil {
		w.t.Fatal(err)
	}
	return w.send(http.MethodPost, household, header, "digest", body)
}

func (w *world) post(household uuid.UUID, token, what string, body []byte) *httptest.ResponseRecorder {
	w.t.Helper()
	return w.send(http.MethodPost, household, bearer(token), what, body)
}

// send sends household's sync route what a request of method, signed in by header, with body when
// it is not nil.
func (w *world) send(method string, household uuid.UUID, header http.Header, what string, body []byte) *httptest.ResponseRecorder {
	w.t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), method,
		"/api/v1/households/"+household.String()+"/sync/"+what, bytes.NewReader(body))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for name, values := range header {
		for _, v := range values {
			req.Header.Add(name, v)
		}
	}
	return w.serve(req)
}

func (w *world) verdict(rec *httptest.ResponseRecorder) verdict {
	w.t.Helper()
	if rec.Code != http.StatusOK {
		w.t.Fatalf("the report answered %d: %s", rec.Code, rec.Body)
	}
	var v verdict
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		w.t.Fatal(err)
	}
	return v
}

// matches is each of v's entries as "entity_type matched server_count".
func matches(v verdict) []string {
	var out []string
	for _, e := range v.Entries {
		s := e.EntityType + " " + map[bool]string{true: "matched", false: "mismatched"}[e.Matched]
		out = append(out, s)
	}
	return out
}

type syncState struct {
	Replicas []struct {
		ReplicaID       uuid.UUID  `json:"replica_id"`
		DeviceID        *uuid.UUID `json:"device_id"`
		Label           string     `json:"label"`
		Checkpoint      *string    `json:"checkpoint"`
		Unresolved      int        `json:"unresolved_conflicts"`
		NeedsResnapshot bool       `json:"needs_resnapshot"`
		Mismatched      []string   `json:"digest_mismatch_entity_types"`
	} `json:"replicas"`
}

func (w *world) state(household uuid.UUID, token string) syncState {
	w.t.Helper()
	return w.stateAs(household, bearer(token))
}

// stateAs is state, signed in by header.
func (w *world) stateAs(household uuid.UUID, header http.Header) syncState {
	w.t.Helper()
	rec := w.send(http.MethodGet, household, header, "state", nil)
	if rec.Code != http.StatusOK {
		w.t.Fatalf("the state answered %d: %s", rec.Code, rec.Body)
	}
	var s syncState
	if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil {
		w.t.Fatal(err)
	}
	return s
}

// A replica that holds what its member may see matches, entity type by entity type, as the generated
// streams send it (D-125): the items, the member's own private note and another's as its redacted
// projection, which a replica counts once by id, but not another's private comment, and the messages
// whose readers name them. A replica that holds one row too few, or a version behind, does not; an
// entity type the server does not sync matches nothing; and the report is kept for its member alone.
func TestAReplicasReportMatchesWhatItsMemberMaySee(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	other := w.member(household, "contribute")
	token, theirs := w.signIn(member, 0), w.signIn(other, 0)
	milk, eggs, mine, ours, plan, remark := idgen.New(), idgen.New(), idgen.New(), idgen.New(), idgen.New(), idgen.New()
	w.want(w.results(w.push(household, token, key(),
		mutationOf(conformance.Item, "create", milk, map[string]any{"title": "Milk"}),
		mutationOf(conformance.Item, "create", eggs, map[string]any{"title": "Eggs"}),
		based(mutationOf(conformance.Item, "update", eggs, map[string]any{"title": "Six eggs"}), 1),
		mutationOf(conformance.Note, "create", mine, map[string]any{"title": "Mine", "visibility": "private", "owner_id": member.String()}),
		mutationOf(conformance.Note, "create", ours, map[string]any{"title": "Ours"}),
	)), push.Applied, push.Applied, push.Applied, push.Applied, push.Applied)
	w.want(w.results(w.push(household, theirs, key(),
		mutationOf(conformance.Note, "create", plan, map[string]any{"title": "Theirs", "visibility": "private", "owner_id": other.String()}),
		mutationOf(conformance.NoteComment, "create", remark, map[string]any{"note_id": plan.String(), "body": "Two weeks?"}),
	)), push.Applied, push.Applied)
	replicaID := idgen.New()
	holds := []entry{
		entryOf(conformance.Item, map[uuid.UUID]int64{milk: 1, eggs: 2}),
		entryOf(conformance.Note, map[uuid.UUID]int64{mine: 1, ours: 1, plan: 1}),
		entryOf(conformance.NoteComment, nil),
		entryOf(conformance.Message, nil),
		entryOf("admin.module_enablement", w.rowsOf("module_enablement", household)),
	}
	v := w.verdict(w.report(household, token, replicaID, holds...))
	if !v.Matched || v.ResnapshotRequired || len(v.Entries) != len(holds) || v.Entries[1].ServerCount != 3 {
		t.Fatalf("a replica holding what its member may see: %+v", v)
	}

	behind := slices.Clone(holds)
	behind[0] = entryOf(conformance.Item, map[uuid.UUID]int64{milk: 1, eggs: 1})
	behind[2] = entryOf(conformance.NoteComment, map[uuid.UUID]int64{remark: 1})
	behind = append(behind, entry{EntityType: "conformance.unknown", Hash: "0000000000000000", Count: 0})
	v = w.verdict(w.report(household, token, replicaID, behind...))
	if v.Matched || v.ResnapshotRequired || !slices.Equal(matches(v), []string{
		"conformance.item mismatched", "conformance.note matched", "conformance.note_comment mismatched", "conformance.message matched",
		"admin.module_enablement matched", "conformance.unknown mismatched",
	}) {
		t.Fatalf("a replica a version behind, holding a row it may not see, and an entity type nobody syncs: %+v", v)
	}
	s := w.state(household, token)
	if len(s.Replicas) != 1 || s.Replicas[0].ReplicaID != replicaID || s.Replicas[0].DeviceID == nil || s.Replicas[0].Checkpoint == nil ||
		*s.Replicas[0].Checkpoint != "42" || s.Replicas[0].Unresolved != 1 || s.Replicas[0].NeedsResnapshot ||
		!slices.Equal(s.Replicas[0].Mismatched, []string{"conformance.item", "conformance.note_comment", "conformance.unknown"}) {
		t.Errorf("the member's replicas: %+v", s)
	}
	if s := w.state(household, theirs); len(s.Replicas) != 0 {
		t.Errorf("another member's replicas: %+v", s)
	}
	// Another member may not report for the replica, nor ask it to download itself again.
	if rec := w.report(household, theirs, replicaID, holds...); rec.Code != http.StatusNotFound {
		t.Errorf("another member's report for the replica answered %d: %s", rec.Code, rec.Body)
	}
	if rec := w.post(household, theirs, "reset", []byte(`{"replica_id": "`+replicaID.String()+`"}`)); rec.Code != http.StatusNotFound {
		t.Errorf("another member's reset of the replica answered %d: %s", rec.Code, rec.Body)
	}
	if rec := w.report(household, token, idgen.New(), holds[0], holds[0]); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("a report naming an entity type twice answered %d: %s", rec.Code, rec.Body)
	}
}

// rowsOf is each row of household in table, by id, at its version.
func (w *world) rowsOf(table string, household uuid.UUID) map[uuid.UUID]int64 {
	w.t.Helper()
	rows, err := w.admin.Query(context.Background(), "SELECT id, version FROM "+table+" WHERE household_id = $1", household)
	if err != nil {
		w.t.Fatal(err)
	}
	defer rows.Close()
	out := map[uuid.UUID]int64{}
	for rows.Next() {
		var (
			id      uuid.UUID
			version int64
		)
		if err := rows.Scan(&id, &version); err != nil {
			w.t.Fatal(err)
		}
		out[id] = version
	}
	return out
}

// A disagreement is divergence only when a report a minute or more after the first disagrees on the
// same entity type while the server's own hash held still (D-125): not a report within the minute,
// nor one after the household was written to. A replica found divergent, or one its member asked to
// download itself again, is told so at its next report, and is shown as needing it until the report
// after, which it sends once it has. An entity type the server does not sync is never divergence.
func TestADisagreementThatHeldStillIsDivergence(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	milk := idgen.New()
	w.want(w.results(w.push(household, token, key(), mutationOf(conformance.Item, "create", milk, map[string]any{"title": "Milk"}))), push.Applied)
	replicaID := idgen.New()
	wrong := []entry{entryOf(conformance.Item, nil), {EntityType: "conformance.unknown", Hash: "0000000000000001", Count: 1}}
	backdate := func() {
		t.Helper()
		w.exec(`UPDATE sync_replicas SET mismatches = (SELECT coalesce(jsonb_object_agg(k, jsonb_set(v, '{since}', to_jsonb(now() - interval '61 seconds'))), '{}')
		        FROM jsonb_each(mismatches) AS m (k, v)) WHERE id = $1`, replicaID)
	}

	if v := w.verdict(w.report(household, token, replicaID, wrong...)); v.Matched || v.ResnapshotRequired {
		t.Fatalf("a first disagreement: %+v", v)
	}
	// Within the minute: not yet.
	if v := w.verdict(w.report(household, token, replicaID, wrong...)); v.ResnapshotRequired {
		t.Fatalf("a disagreement within the minute: %+v", v)
	}
	// A minute on, but the household was written to in it: the server's hash moved, so the replica may
	// only not have received the write yet.
	backdate()
	w.want(w.results(w.push(household, token, key(), mutationOf(conformance.Item, "create", idgen.New(), map[string]any{"title": "Eggs"}))), push.Applied)
	if v := w.verdict(w.report(household, token, replicaID, wrong...)); v.ResnapshotRequired {
		t.Fatalf("a disagreement over rows written in the minute: %+v", v)
	}
	// A minute on, the server's hash held still: divergence.
	backdate()
	v := w.verdict(w.report(household, token, replicaID, wrong...))
	if !v.ResnapshotRequired || v.Matched {
		t.Fatalf("a disagreement that held still for a minute: %+v", v)
	}
	if s := w.state(household, token); len(s.Replicas) != 1 || !s.Replicas[0].NeedsResnapshot {
		t.Errorf("a replica told to download itself again: %+v", s)
	}
	// The report it sends once it has: what the server holds, and no longer told.
	right := w.rowsOf("conformance_items", household)
	if v := w.verdict(w.report(household, token, replicaID, entryOf(conformance.Item, right))); !v.Matched || v.ResnapshotRequired {
		t.Errorf("the report after the download: %+v", v)
	}
	if s := w.state(household, token); s.Replicas[0].NeedsResnapshot || len(s.Replicas[0].Mismatched) != 0 {
		t.Errorf("a replica that downloaded itself again: %+v", s)
	}
	// An entity type the server does not sync disagrees however long it holds still.
	unknown := wrong[1:]
	w.verdict(w.report(household, token, replicaID, unknown...))
	backdate()
	if v := w.verdict(w.report(household, token, replicaID, unknown...)); v.ResnapshotRequired {
		t.Errorf("an entity type nobody syncs, a minute on: %+v", v)
	}

	// The member asks: told at the next report, and only then.
	if rec := w.post(household, token, "reset", []byte(`{"replica_id": "`+replicaID.String()+`"}`)); rec.Code != http.StatusNoContent {
		t.Fatalf("a reset answered %d: %s", rec.Code, rec.Body)
	}
	if s := w.state(household, token); !s.Replicas[0].NeedsResnapshot {
		t.Errorf("a replica marked to download itself again: %+v", s)
	}
	if v := w.verdict(w.report(household, token, replicaID, entryOf(conformance.Item, right))); !v.ResnapshotRequired || !v.Matched {
		t.Errorf("the report after a reset: %+v", v)
	}
	if v := w.verdict(w.report(household, token, replicaID, entryOf(conformance.Item, right))); v.ResnapshotRequired {
		t.Errorf("the report after that: %+v", v)
	}
	if rec := w.post(household, token, "reset", []byte(`{"replica_id": "`+idgen.New().String()+`"}`)); rec.Code != http.StatusNotFound {
		t.Errorf("a reset of a replica that never reported answered %d: %s", rec.Code, rec.Body)
	}
}

// A member whose grant on the module is none holds none of its rows, and reports none.
func TestAReplicaWithoutTheGrantHoldsNothingOfTheModule(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	w.want(w.results(w.push(household, token, key(), mutationOf(conformance.Item, "create", idgen.New(), map[string]any{"title": "Milk"}))), push.Applied)
	w.exec("UPDATE module_grants SET level = 'none' WHERE household_id = $1 AND user_id = $2", household, member)
	v := w.verdict(w.report(household, token, idgen.New(), entryOf(conformance.Item, nil)))
	if !v.Matched || v.Entries[0].ServerCount != 0 {
		t.Errorf("a replica without the grant: %+v", v)
	}
}

// A replica keeps a module's rows while the module's flag is off for its household: no stream reads a
// flag, and one turned off retracts nothing already replicated (D-146). Its report is compared with
// what the streams send it, which is those rows still, and matches. Compared with what its member's
// requests may do, which is nothing while the flag is off, it would disagree for as long as the flag
// stayed off, a disagreement that holds still, and the replica would be told to download itself again
// after every report.
func TestAReplicaKeepsAModulesRowsWhileItsFlagIsOff(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	milk := idgen.New()
	w.want(w.results(w.push(household, token, key(), mutationOf(conformance.Item, "create", milk, map[string]any{"title": "Milk"}))), push.Applied)
	// The flag is the platform's, and the package's tests share one database: it is on for the
	// platform, off for this household alone, and goes with the test.
	flag := tenant.ModuleFlag(conformance.Name)
	t.Cleanup(func() {
		for _, stmt := range []string{"DELETE FROM household_flags WHERE key = $1", "DELETE FROM platform.feature_flags WHERE key = $1"} {
			if _, err := w.admin.Exec(context.Background(), stmt, flag); err != nil {
				t.Errorf("%s: %v", stmt, err)
			}
		}
	})
	w.exec("INSERT INTO platform.feature_flags (key, enabled) VALUES ($1, true)", flag)
	w.exec("INSERT INTO household_flags (household_id, key, enabled) VALUES ($1, $2, false)", household, flag)

	replicaID := idgen.New()
	holds := entryOf(conformance.Item, map[uuid.UUID]int64{milk: 1})
	v := w.verdict(w.report(household, token, replicaID, holds))
	if !v.Matched || v.ResnapshotRequired || v.Entries[0].ServerCount != 1 {
		t.Fatalf("a replica holding the rows of a module whose flag is off: %+v", v)
	}
	if s := w.state(household, token); len(s.Replicas) != 1 || s.Replicas[0].NeedsResnapshot || len(s.Replicas[0].Mismatched) != 0 {
		t.Errorf("the replica as its member reads it: %+v", s)
	}
	// What the member's requests may do is the flag's to say: the module takes no push while it is off.
	refused := outcomes(w.results(w.push(household, token, key(), mutationOf(conformance.Item, "create", idgen.New(), map[string]any{"title": "Eggs"}))))
	if len(refused) != 1 || strings.HasPrefix(refused[0], push.Applied) {
		t.Fatalf("a push to a module whose flag is off: %v", refused)
	}
	// One that dropped them does disagree: the streams still send them.
	if v := w.verdict(w.report(household, token, replicaID, entryOf(conformance.Item, nil))); v.Matched || v.Entries[0].ServerCount != 1 {
		t.Fatalf("a replica that holds none of them: %+v", v)
	}
}

// A replica's reports are its member's and leave with their membership, as the answers kept for them
// do: a member removed from the household, or one who left it, leaves none behind, and another
// member's stay. One removed while their report is answered is answered as the tenant middleware
// answers their next request, 404 not_found, and never as a failure of the server's.
func TestAReplicasReportsLeaveWithItsMembersMembership(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	other := w.member(household, "contribute")
	token, theirs := w.signIn(member, 0), w.signIn(other, 0)
	w.verdict(w.report(household, token, idgen.New(), entryOf(conformance.Item, nil)))
	w.verdict(w.report(household, theirs, idgen.New(), entryOf(conformance.Item, nil)))
	w.exec("DELETE FROM memberships WHERE household_id = $1 AND user_id = $2", household, member)
	if n := w.count("SELECT count(*) FROM sync_replicas WHERE household_id = $1 AND user_id = $2", household, member); n != 0 {
		t.Errorf("%d reports of a removed member's replicas kept, want none", n)
	}
	if n := w.count("SELECT count(*) FROM sync_replicas WHERE household_id = $1", household); n != 1 {
		t.Errorf("%d reports kept in the household, want the other member's one", n)
	}

	// As an owner's removal does, between the tenant middleware's look-up and the report's being kept.
	w.exec(`CREATE FUNCTION remove_reporter() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
	        BEGIN
	          DELETE FROM memberships WHERE household_id = NEW.household_id AND user_id = NEW.user_id;
	          RETURN NEW;
	        END $$`)
	t.Cleanup(func() { w.exec("DROP FUNCTION remove_reporter() CASCADE") })
	w.exec(`CREATE TRIGGER remove_reporter BEFORE INSERT ON sync_replicas FOR EACH ROW
	        WHEN (NEW.household_id = '` + household.String() + `') EXECUTE FUNCTION remove_reporter()`)
	rec := w.report(household, theirs, idgen.New(), entryOf(conformance.Item, nil))
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"not_found"`) {
		t.Fatalf("a member removed while their report is answered: %d %s", rec.Code, rec.Body)
	}
	if n := w.failures.Load(); n != 0 {
		t.Errorf("%d failures logged, want none", n)
	}
}

// A replica is shown by where it last reported from: a device's by the device and its label, a web
// session's by its browser, with no device.
func TestAReplicaIsShownByWhereItReportedFrom(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	var tokens session.Tokens
	if err := tenant.AccountTx(t.Context(), w.pool, member, func(tx pgx.Tx) error {
		var err error
		_, tokens, err = w.accounts.Sessions.Create(t.Context(), tx, member, "a browser")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	web := http.Header{
		"Cookie":           {session.Cookie + "=" + tokens.Session + "; " + session.CSRFCookie + "=" + tokens.CSRF},
		session.CSRFHeader: {tokens.CSRF},
		"Origin":           {apptest.WebOrigin},
	}
	onDevice, inBrowser := idgen.New(), idgen.New()
	w.verdict(w.report(household, token, onDevice, entryOf(conformance.Item, nil)))
	w.verdict(w.reportAs(household, web, inBrowser, entryOf(conformance.Item, nil)))
	// Either sign-in reads both: they are the member's.
	s := w.stateAs(household, web)
	if len(s.Replicas) != 2 {
		t.Fatalf("the member's replicas: %+v", s)
	}
	for _, r := range s.Replicas {
		switch r.ReplicaID {
		case onDevice:
			if r.DeviceID == nil || r.Label != "conformance" {
				t.Errorf("the replica that reported from a device: %+v", r)
			}
		case inBrowser:
			if r.DeviceID != nil || r.Label != "a browser" {
				t.Errorf("the replica that reported from a web session: %+v", r)
			}
		default:
			t.Errorf("a replica nobody reported: %+v", r)
		}
	}
}
