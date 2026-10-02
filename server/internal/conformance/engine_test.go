package conformance_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/conformance"
	"github.com/kareltilcer/household/server/internal/platform/fairuse"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/push"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// Plan item 17's engine, as the conformance module's writers and the push answer it: merged and
// conflict on a base version, the loser lww_row preserves, the access a row carries rewritten without
// an edit, the rotation a completion advances, an audience's readers, an attachment's upload, and the
// mutations a household may push in a day.

// based is m made against version.
func based(m map[string]any, version int64) map[string]any {
	m["base_version"] = version
	return m
}

// owner is household's owner.
func (w *world) owner(household uuid.UUID) uuid.UUID {
	w.t.Helper()
	var id uuid.UUID
	if err := w.admin.QueryRow(context.Background(), "SELECT user_id FROM memberships WHERE household_id = $1 AND role = 'owner'", household).
		Scan(&id); err != nil {
		w.t.Fatal(err)
	}
	return id
}

// member makes a member of household holding level on the module.
func (w *world) member(household uuid.UUID, level string) uuid.UUID {
	w.t.Helper()
	id := w.user()
	w.exec(testsupport.InsertMember, household, id, "member")
	w.exec("INSERT INTO module_grants (household_id, user_id, module, level) VALUES ($1, $2, $3, $4)", household, id, conformance.Name, level)
	return id
}

// want fails the test unless got answers as want says, in order.
func (w *world) want(got push.BatchResult, want ...string) {
	w.t.Helper()
	if fmt.Sprint(outcomes(got)) != fmt.Sprint(want) {
		w.t.Fatalf("outcomes\n  %v\nwant\n  %v", outcomes(got), want)
	}
}

// rowOf is r's row, decoded.
func rowOf(t *testing.T, r push.Result) map[string]any {
	t.Helper()
	raw, err := json.Marshal(r.Row)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// An lww_field write made against an older version than the row's is applied over the change it had
// not seen and answered merged, concurrent_change, with the row (D-122): what the server keeps is not
// what its client expected. The value it replaced stays in the activity log. A write against the
// row's own version, or a create, is applied, and so is a later write of the batch made against the
// version an earlier one was: the replica made it having seen what the earlier wrote.
func TestPushAnswersAWriteBehindItsRowMerged(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	milk := idgen.New()
	w.exec("INSERT INTO conformance_items (id, household_id, title) VALUES ($1, $2, 'Milk')", milk, household)
	w.want(w.results(w.push(household, w.signIn(w.owner(household), 0), key(),
		based(mutationOf(conformance.Item, "update", milk, map[string]any{"title": "Oat milk"}), 1))), push.Applied)
	got := w.results(w.push(household, token, key(),
		based(mutationOf(conformance.Item, "update", milk, map[string]any{"title": "Soy milk"}), 1),
		based(mutationOf(conformance.Item, "update", milk, map[string]any{"note": "two litres"}), 1),
		based(mutationOf(conformance.Item, "update", milk, map[string]any{"note": "one litre"}), 4),
	))
	w.want(got, push.Merged+" "+push.ConcurrentChange, push.Applied, push.Applied)
	if row := rowOf(t, got.Results[0]); row["title"] != "Soy milk" || *got.Results[0].Version != 3 {
		t.Errorf("the merged write's row: %v at %d", row, *got.Results[0].Version)
	}
	if v := *got.Results[2].Version; v != 5 {
		t.Errorf("the last write landed at version %d, want 5", v)
	}
	if n := w.count(`SELECT count(*) FROM audit_changes c JOIN audit_events e ON e.household_id = c.household_id AND e.id = c.event_id
		WHERE e.entity_id = $1 AND c.field = 'title' AND c.old_value = '"Oat milk"' AND c.new_value = '"Soy milk"'`, milk); n != 1 {
		t.Errorf("the activity log keeps %d diffs from the value the merged write replaced, want 1", n)
	}
}

// A strict_version update or delete is applied only against the version the row is at: one made
// against another is a conflict carrying the row as it stands, and writes nothing; one that names no
// version is refused.
func TestPushHoldsAStrictVersionWriteToItsBaseVersion(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	groceries := idgen.New()
	amount := func(minor int) map[string]any { return map[string]any{"amount_minor": minor} }
	w.want(w.results(w.push(household, token, key(),
		mutationOf(conformance.Budget, "create", groceries, map[string]any{"name": "Groceries", "amount_minor": 450_000, "currency": "CZK"}),
		based(mutationOf(conformance.Budget, "update", groceries, amount(500_000)), 1),
	)), push.Applied, push.Applied)
	conflict := w.results(w.push(household, token, key(), based(mutationOf(conformance.Budget, "update", groceries, amount(400_000)), 1)))
	w.want(conflict, "conflict version_conflict")
	if row := rowOf(t, conflict.Results[0]); row["amount_minor"] != float64(500_000) || row["version"] != float64(2) {
		t.Errorf("the conflict's row: %v", row)
	}
	w.want(w.results(w.push(household, token, key(), mutationOf(conformance.Budget, "update", groceries, amount(1)))),
		"rejected validation_failed")
	w.want(w.results(w.push(household, token, key(), based(mutationOf(conformance.Budget, "delete", groceries, nil), 2))), push.Applied)
	w.want(w.results(w.push(household, token, key(), based(mutationOf(conformance.Budget, "delete", groceries, nil), 2))),
		"conflict version_conflict")
	var (
		minor   int64
		version int64
		deleted bool
	)
	if err := w.admin.QueryRow(context.Background(), "SELECT amount_minor, version, deleted_at IS NOT NULL FROM conformance_budgets WHERE id = $1", groceries).
		Scan(&minor, &version, &deleted); err != nil {
		t.Fatal(err)
	}
	if minor != 500_000 || version != 3 || !deleted {
		t.Errorf("the budget is %d at version %d, deleted %v", minor, version, deleted)
	}
}

// A replica that writes a row twice before it hears back makes both writes against the version it
// holds: the later is held to the version the earlier of its batch left, having seen it, and is no
// conflict with it (D-122). An edit of a row created in the same batch, which could name no version,
// is held to the create's. Another replica's write between is still a conflict.
func TestPushHoldsALaterWriteOfABatchToWhatTheEarlierLeft(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	groceries := idgen.New()
	amount := func(minor int) map[string]any { return map[string]any{"amount_minor": minor} }
	w.want(w.results(w.push(household, token, key(),
		mutationOf(conformance.Budget, "create", groceries, map[string]any{"name": "Groceries", "amount_minor": 450_000, "currency": "CZK"}),
		mutationOf(conformance.Budget, "update", groceries, amount(500_000)),
		mutationOf(conformance.Budget, "update", groceries, amount(550_000)),
	)), push.Applied, push.Applied, push.Applied)
	w.want(w.results(w.push(household, token, key(),
		based(mutationOf(conformance.Budget, "update", groceries, amount(600_000)), 3),
		based(mutationOf(conformance.Budget, "update", groceries, amount(650_000)), 3),
	)), push.Applied, push.Applied)
	if n := w.count("SELECT count(*) FROM conformance_budgets WHERE id = $1 AND amount_minor = 650000 AND version = 5", groceries); n != 1 {
		t.Error("the budget is not the batch's last write at version 5")
	}
	w.want(w.results(w.push(household, w.signIn(w.owner(household), 0), key(),
		based(mutationOf(conformance.Budget, "update", groceries, amount(700_000)), 5))), push.Applied)
	w.want(w.results(w.push(household, token, key(),
		based(mutationOf(conformance.Budget, "update", groceries, amount(1)), 5),
		based(mutationOf(conformance.Budget, "update", groceries, amount(2)), 5),
	)), "conflict version_conflict", "deferred "+push.DependencyFailed)
}

// An lww_row write made against an older version than the note's replaces it whole, answered merged,
// and keeps the note it replaced, the loser, with the version it stood at, the version the write was
// made against, and who wrote each (PRD 03 §2.5). A replica's own earlier write is no loser: a later
// write of its batch made against the same version replaces it, applied, and keeps nothing.
func TestANoteWriteBehindKeepsItsLoser(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	owner := w.owner(household)
	plan := idgen.New()
	w.want(w.results(w.push(household, token, key(),
		mutationOf(conformance.Note, "create", plan, map[string]any{"title": "Plan", "body": "A"}),
		based(mutationOf(conformance.Note, "update", plan, map[string]any{"body": "B"}), 1),
	)), push.Applied, push.Applied)
	w.want(w.results(w.push(household, w.signIn(owner, 0), key(),
		based(mutationOf(conformance.Note, "update", plan, map[string]any{"body": "C"}), 1),
		based(mutationOf(conformance.Note, "update", plan, map[string]any{"body": "D"}), 1),
	)), push.Merged+" "+push.ConcurrentChange, push.Applied)
	if n := w.count("SELECT count(*) FROM conformance_note_versions WHERE note_id = $1", plan); n != 1 {
		t.Fatalf("%d losers kept, want the one another member's write replaced", n)
	}
	var (
		version, base int64
		body          string
		writtenBy     uuid.UUID
		supersededBy  uuid.UUID
	)
	if err := w.admin.QueryRow(context.Background(), `
		SELECT version, base_version, row->>'body', written_by, superseded_by FROM conformance_note_versions WHERE note_id = $1`, plan).
		Scan(&version, &base, &body, &writtenBy, &supersededBy); err != nil {
		t.Fatal(err)
	}
	if version != 2 || base != 1 || body != "B" || writtenBy != member || supersededBy != owner {
		t.Errorf("the loser: version %d against %d, %q, written by %s, replaced by %s", version, base, body, writtenBy, supersededBy)
	}
	if n := w.count("SELECT count(*) FROM conformance_notes WHERE id = $1 AND body = 'D' AND version = 4", plan); n != 1 {
		t.Error("the note is not the last write's")
	}
}

// A private note, and every comment it bounds, are its owner's alone: another member's write to either
// is answered as a write to a row that is not there. Making the note private, or shared again, rewrites
// the visibility and the owner its comments carry, which is no edit of them: their version stays, so
// that an edit their owner made against it applies rather than merging over a change she never made.
// Only its maker makes a note private, and to herself.
func TestAPrivateNoteAndItsCommentsAreItsOwners(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	other := w.member(household, "contribute")
	token, theirs := w.signIn(member, 0), w.signIn(other, 0)
	plan, remark := idgen.New(), idgen.New()
	w.want(w.results(w.push(household, token, key(),
		mutationOf(conformance.Note, "create", plan, map[string]any{"title": "Plan"}),
		mutationOf(conformance.NoteComment, "create", remark, map[string]any{"note_id": plan.String(), "body": "Two weeks?"}),
	)), push.Applied, push.Applied)
	w.want(w.results(w.push(household, theirs, key(),
		mutationOf(conformance.Note, "update", plan, map[string]any{"visibility": "private", "owner_id": member.String()}))),
		"rejected validation_failed")

	w.want(w.results(w.push(household, token, key(), based(mutationOf(conformance.Note, "update", plan, map[string]any{"visibility": "private"}), 1))),
		push.Applied)
	comment := func() (visibility string, owner *uuid.UUID, version int64) {
		t.Helper()
		if err := w.admin.QueryRow(context.Background(), "SELECT visibility, owner_id, version FROM conformance_note_comments WHERE id = $1", remark).
			Scan(&visibility, &owner, &version); err != nil {
			t.Fatal(err)
		}
		return visibility, owner, version
	}
	if visibility, owner, version := comment(); visibility != "private" || owner == nil || *owner != member || version != 1 {
		t.Fatalf("the comment of a note made private: %s, %v, version %d", visibility, owner, version)
	}
	if n := w.count("SELECT count(*) FROM audit_events WHERE entity_id = $1 AND visibility = 'private' AND owner_id = $2", plan, member); n != 1 {
		t.Errorf("%d private events of the note made private, want 1", n)
	}

	w.want(w.results(w.push(household, theirs, key(),
		mutationOf(conformance.Note, "update", plan, map[string]any{"title": "Ours"}),
		mutationOf(conformance.NoteComment, "update", remark, map[string]any{"body": "Ours"}),
	)), "rejected not_found", "rejected not_found")
	w.want(w.results(w.push(household, theirs, key(),
		mutationOf(conformance.NoteComment, "create", idgen.New(), map[string]any{"note_id": plan.String(), "body": "Hello"}),
	)), "rejected not_found")

	// The owner's edit of the comment, made against the version she saw before the move.
	w.want(w.results(w.push(household, token, key(),
		based(mutationOf(conformance.NoteComment, "update", remark, map[string]any{"body": "Ten days"}), 1))), push.Applied)
	w.want(w.results(w.push(household, token, key(), based(mutationOf(conformance.Note, "update", plan, map[string]any{"visibility": "shared"}), 2))),
		push.Applied)
	if visibility, owner, version := comment(); visibility != "shared" || owner != nil || version != 2 {
		t.Errorf("the comment of a note shared again: %s, %v, version %d", visibility, owner, version)
	}
}

// A rewrite of the access a row carries changes the access columns it names, and nothing else, and
// leaves the row's version as it was; an update after it in the same transaction is an edit again.
func TestAnAccessRewriteChangesOnlyTheAccess(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	talk, said := idgen.New(), idgen.New()
	w.exec("INSERT INTO conformance_conversations (id, household_id, title) VALUES ($1, $2, 'Shopping')", talk, household)
	w.exec("INSERT INTO conformance_messages (id, household_id, conversation_id, seq, body, readers) VALUES ($1, $2, $3, 1, 'Hi', ARRAY[$4::uuid])",
		said, household, talk, member)
	ctx := t.Context()
	tx, err := w.admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if _, err := sync.RewriteAccess(ctx, tx, []string{"body"}, "UPDATE conformance_messages SET body = '' WHERE id = $1", said); err == nil {
		t.Error("a rewrite of a column that is no access")
	}
	if _, err := tx.Exec(ctx, "SAVEPOINT before"); err != nil {
		t.Fatal(err)
	}
	if _, err := sync.RewriteAccess(ctx, tx, []string{sync.ReadersColumn},
		"UPDATE conformance_messages SET readers = '{}', body = 'Bye' WHERE id = $1", said); err == nil || !strings.Contains(err.Error(), "changed more than readers") {
		t.Errorf("a rewrite that edits: %v", err)
	}
	if _, err := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT before"); err != nil {
		t.Fatal(err)
	}
	n, err := sync.RewriteAccess(ctx, tx, []string{sync.ReadersColumn}, "UPDATE conformance_messages SET readers = '{}' WHERE id = $1", said)
	if err != nil || n != 1 {
		t.Fatalf("a rewrite of the readers: %d, %v", n, err)
	}
	var version int64
	if err := tx.QueryRow(ctx, "SELECT version FROM conformance_messages WHERE id = $1", said).Scan(&version); err != nil || version != 1 {
		t.Fatalf("after the rewrite the message is at version %d (%v), want 1", version, err)
	}
	if err := tx.QueryRow(ctx, "UPDATE conformance_messages SET body = 'Bye' WHERE id = $1 RETURNING version", said).Scan(&version); err != nil || version != 2 {
		t.Errorf("an edit after the rewrite: version %d (%v), want 2", version, err)
	}
}

// An occurrence advances its chore's rotation once, as it first comes to be done, however many
// completions of it arrive, and not again when it is undone and done again (D-52); another
// occurrence advances it again, round the rotation.
func TestACompletionAdvancesTheRotationOnce(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	dishes := idgen.New()
	w.exec("INSERT INTO conformance_chores (id, household_id, name, rotation) VALUES ($1, $2, 'Dishes', ARRAY[$3::uuid, $4::uuid])",
		dishes, household, member, w.owner(household))
	now := time.Now()
	complete := func(day string, done bool, t time.Time) map[string]any {
		return at(mutationOf(conformance.Completion, "create", idgen.New(), map[string]any{"chore_id": dishes.String(), "occurrence": day, "done": done}), t)
	}
	place := func() (index int, version int64) {
		w.t.Helper()
		if err := w.admin.QueryRow(context.Background(), "SELECT rotation_index, version FROM conformance_chores WHERE id = $1", dishes).
			Scan(&index, &version); err != nil {
			w.t.Fatal(err)
		}
		return index, version
	}
	w.want(w.results(w.push(household, token, key(), complete("2026-09-30", true, now), complete("2026-09-30", true, now.Add(time.Second)))),
		push.Applied, push.Applied)
	if index, version := place(); index != 1 || version != 2 {
		t.Fatalf("after one occurrence's two completions: place %d, version %d", index, version)
	}
	w.want(w.results(w.push(household, token, key(),
		complete("2026-09-30", false, now.Add(time.Minute)), complete("2026-09-30", true, now.Add(2*time.Minute)))),
		push.Applied, push.Applied)
	if index, _ := place(); index != 1 {
		t.Fatalf("after the occurrence was undone and done again: place %d, want 1", index)
	}
	w.want(w.results(w.push(household, token, key(), complete("2026-10-01", true, now))), push.Applied)
	if index, version := place(); index != 0 || version != 3 {
		t.Errorf("after another occurrence: place %d, version %d; want round to 0 at 3", index, version)
	}
}

// A conversation's members read its messages from the floor they joined at (D-90): each message
// keeps on its row the members whose floor it is at or above. A member who leaves is taken out of the
// readers of every message of it, which is no edit of them, and their own message is then answered as
// one to a conversation they cannot see, as is one by a member who was never in it.
func TestAConversationsMessagesReachTheirReadersFromTheirFloor(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, ana := w.household("contribute")
	ben, cyril := w.member(household, "contribute"), w.member(household, "contribute")
	tokens := map[uuid.UUID]string{ana: w.signIn(ana, 0), ben: w.signIn(ben, 0), cyril: w.signIn(cyril, 0)}
	talk := idgen.New()
	membership := map[uuid.UUID]uuid.UUID{ana: idgen.New(), ben: idgen.New(), cyril: idgen.New()}
	join := func(who uuid.UUID) map[string]any {
		return mutationOf(conformance.ConversationMember, "create", membership[who], map[string]any{
			"conversation_id": talk.String(), "user_id": who.String(),
		})
	}
	post := func(body string) map[string]any {
		return mutationOf(conformance.Message, "create", idgen.New(), map[string]any{"conversation_id": talk.String(), "body": body})
	}
	first := post("Who buys bread?")
	w.want(w.results(w.push(household, tokens[ana], key(),
		mutationOf(conformance.Conversation, "create", talk, map[string]any{"title": "Shopping"}), join(ana), join(ben), first)),
		push.Applied, push.Applied, push.Applied, push.Applied)
	second := post("I will")
	w.want(w.results(w.push(household, tokens[ben], key(), second)), push.Applied)
	w.want(w.results(w.push(household, tokens[ana], key(), join(cyril))), push.Applied)
	third := post("Welcome")
	w.want(w.results(w.push(household, tokens[cyril], key(), third)), push.Applied)

	readers := func(message map[string]any) []uuid.UUID {
		t.Helper()
		var out []uuid.UUID
		if err := w.admin.QueryRow(context.Background(), "SELECT readers FROM conformance_messages WHERE id = $1", message["entity_id"]).
			Scan(&out); err != nil {
			t.Fatal(err)
		}
		slices.SortFunc(out, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
		return out
	}
	sorted := func(ids ...uuid.UUID) []uuid.UUID {
		slices.SortFunc(ids, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
		return ids
	}
	if got := readers(first); !slices.Equal(got, sorted(ana, ben)) {
		t.Errorf("the first message's readers: %v", got)
	}
	if got := readers(third); !slices.Equal(got, sorted(ana, ben, cyril)) {
		t.Errorf("the third message's readers, Cyril's floor at it: %v", got)
	}

	w.want(w.results(w.push(household, tokens[ana], key(),
		based(mutationOf(conformance.ConversationMember, "delete", membership[ben], nil), 1))), push.Applied)
	for _, m := range []map[string]any{first, second, third} {
		if slices.Contains(readers(m), ben) {
			t.Errorf("Ben, gone from the conversation, still reads %s", m["entity_id"])
		}
	}
	if n := w.count("SELECT count(*) FROM conformance_messages WHERE conversation_id = $1 AND version <> 1", talk); n != 0 {
		t.Errorf("%d messages edited by the rewrite of their readers", n)
	}
	w.want(w.results(w.push(household, tokens[ben], key(), post("And milk"))), "rejected not_found")
	w.want(w.results(w.push(household, w.signIn(w.owner(household), 0), key(), post("Hello"))), "rejected not_found")

	// Ben may be added again, by a membership of his own, and reads from the conversation's next message
	// on: nothing written while he was out, nor before.
	w.want(w.results(w.push(household, tokens[ana], key(), mutationOf(conformance.ConversationMember, "create", idgen.New(), map[string]any{
		"conversation_id": talk.String(), "user_id": ben.String(),
	}))), push.Applied)
	fourth := post("Back again")
	w.want(w.results(w.push(household, tokens[ben], key(), fourth)), push.Applied)
	if got := readers(fourth); !slices.Equal(got, sorted(ana, ben, cyril)) {
		t.Errorf("the message after Ben's return: readers %v", got)
	}
	if slices.Contains(readers(third), ben) {
		t.Error("Ben, back, reads a message written while he was out")
	}
}

// Removing a member from the household, through item 10's route, takes them out of the readers of
// every row an audience bounds, in the removal's transaction (app.Retract): readers left behind would
// reach them again were they ever brought back with the grant. The conversation's members stay as they
// were, and a message written after the removal does not name them either.
func TestRemovalFromTheHouseholdTakesAMemberOutOfEveryAudience(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, ana := w.household("contribute")
	ben := w.member(household, "contribute")
	w.exec(testsupport.InsertEnablement, household, "admin", true)
	talk := idgen.New()
	w.exec("INSERT INTO conformance_conversations (id, household_id, title) VALUES ($1, $2, 'Shopping')", talk, household)
	for _, who := range []uuid.UUID{ana, ben} {
		w.exec("INSERT INTO conformance_conversation_members (id, household_id, conversation_id, user_id, floor_seq) VALUES ($1, $2, $3, $4, 1)",
			idgen.New(), household, talk, who)
	}
	for i, body := range []string{"Bread", "Milk"} {
		w.exec("INSERT INTO conformance_messages (id, household_id, conversation_id, seq, body, readers) VALUES ($1, $2, $3, $4, $5, ARRAY[$6::uuid, $7::uuid])",
			idgen.New(), household, talk, i+1, body, ana, ben)
	}
	req := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, "/api/v1/households/"+household.String()+"/members/"+ben.String(), nil)
	req.Header.Set("Authorization", "Bearer "+w.signIn(w.owner(household), 0))
	if rec := w.serve(req); rec.Code != http.StatusNoContent {
		t.Fatalf("removing Ben: %d %s", rec.Code, rec.Body)
	}
	w.want(w.results(w.push(household, w.signIn(ana, 0), key(),
		mutationOf(conformance.Message, "create", idgen.New(), map[string]any{"conversation_id": talk.String(), "body": "Eggs"}))), push.Applied)
	if n := w.count("SELECT count(*) FROM conformance_messages WHERE conversation_id = $1 AND $2 = ANY (readers)", talk, ben); n != 0 {
		t.Errorf("Ben, removed from the household, still reads %d messages", n)
	}
	if n := w.count("SELECT count(*) FROM conformance_messages WHERE conversation_id = $1 AND readers = ARRAY[$2::uuid] AND version = 1", talk, ana); n != 3 {
		t.Errorf("%d messages Ana alone reads, unedited; want 3", n)
	}
}

// Only a member gone from the household leaves the readers (app.Retract): a grant lowered to none or a
// module disabled changes what every stream looks up, and the member, still in the conversation, reads
// it again when the access comes back.
func TestRetractKeepsTheReadersOfAMemberWhoStays(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	home, ana := w.household("contribute")
	talk, said := idgen.New(), idgen.New()
	w.exec("INSERT INTO conformance_conversations (id, household_id, title) VALUES ($1, $2, 'Shopping')", talk, home)
	w.exec("INSERT INTO conformance_messages (id, household_id, conversation_id, seq, body, readers) VALUES ($1, $2, $3, 1, 'Hi', ARRAY[$4::uuid])",
		said, home, talk, ana)
	registry, err := module.NewRegistry(conformance.Module{})
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := registry.WithPlatform(household.Admin())
	if err != nil {
		t.Fatal(err)
	}
	retract := app.Retract(catalog)
	ctx := t.Context()
	tx, err := w.admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	reads := func() bool {
		t.Helper()
		var reads bool
		if err := tx.QueryRow(ctx, "SELECT $2 = ANY (readers) FROM conformance_messages WHERE id = $1", said, ana).Scan(&reads); err != nil {
			t.Fatal(err)
		}
		return reads
	}
	for _, cause := range []household.Cause{household.CauseGrant, household.CauseModule} {
		if err := retract(ctx, tx, household.Loss{Household: home, Cause: cause, Members: map[uuid.UUID][]string{ana: {conformance.Name}}}); err != nil {
			t.Fatal(err)
		}
		if !reads() {
			t.Errorf("a loss of the module (%s) took Ana out of the readers", cause)
		}
	}
	if err := retract(ctx, tx, household.Loss{Household: home, Cause: household.CauseRemoved, Members: map[uuid.UUID][]string{ana: nil}}); err != nil {
		t.Fatal(err)
	}
	if reads() {
		t.Error("Ana, gone from the household, still reads the message")
	}
}

// upload uploads content, named name, as the bytes of attachment, with token, and returns the answer.
func (w *world) upload(household, attachment uuid.UUID, token, name string, content []byte) *httptest.ResponseRecorder {
	w.t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("file", name)
	if err != nil {
		w.t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		w.t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		w.t.Fatal(err)
	}
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost,
		"/conformance/households/"+household.String()+"/attachments/"+attachment.String()+"/content", &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	return w.serve(req)
}

// An attachment's row syncs whatever becomes of its bytes (D-25): an upload the pipeline refuses for
// good, a program, marks it failed, its reason the refusal's code, once; one it takes marks it ready.
// A member who cannot see the module is not found.
func TestAnAttachmentsUploadSettlesItsRow(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	milk, receipt, list := idgen.New(), idgen.New(), idgen.New()
	w.exec("INSERT INTO conformance_items (id, household_id, title) VALUES ($1, $2, 'Milk')", milk, household)
	w.want(w.results(w.push(household, token, key(),
		mutationOf(conformance.Attachment, "create", receipt, map[string]any{"item_id": milk.String(), "file_name": "receipt.exe", "attachment_status": "pending"}),
		mutationOf(conformance.Attachment, "create", list, map[string]any{"item_id": milk.String(), "file_name": "list.txt"}),
		mutationOf(conformance.Attachment, "create", idgen.New(), map[string]any{"item_id": milk.String(), "file_name": "x.txt", "attachment_status": "ready"}),
	)), push.Applied, push.Applied, "rejected validation_failed")

	program := []byte{0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00}
	for range 2 {
		if rec := w.upload(household, receipt, token, "receipt.exe", program); rec.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("a program's upload: %d %s", rec.Code, rec.Body)
		}
	}
	var (
		status  string
		reason  *string
		version int64
	)
	if err := w.admin.QueryRow(context.Background(), "SELECT attachment_status, failure_reason, version FROM conformance_attachments WHERE id = $1", receipt).
		Scan(&status, &reason, &version); err != nil {
		t.Fatal(err)
	}
	if status != "failed" || reason == nil || *reason != "unsupported_media_type" || version != 2 {
		t.Errorf("a program's attachment: %s, %v, version %d", status, reason, version)
	}
	if rec := w.upload(household, list, token, "list.txt", []byte("Milk, bread\n")); rec.Code != http.StatusOK {
		t.Fatalf("a text's upload: %d %s", rec.Code, rec.Body)
	}
	if n := w.count("SELECT count(*) FROM conformance_attachments WHERE id = $1 AND attachment_status = 'ready'", list); n != 1 {
		t.Error("the text's attachment is not ready")
	}
	if n := w.count("SELECT count(*) FROM files WHERE household_id = $1 AND module = $2 AND entity_id = $3", household, conformance.Name, list); n != 1 {
		t.Error("the text's bytes are not recorded")
	}
	none := w.member(household, "none")
	if rec := w.upload(household, list, w.signIn(none, 0), "list.txt", []byte("Milk\n")); rec.Code != http.StatusNotFound {
		t.Errorf("a member without the module: %d %s", rec.Code, rec.Body)
	}
}

// A household's replicas push at most fairuse.SyncMutations mutations on a UTC day between them (PRD 04
// §5, D-127): past them a batch is refused whole, 429, until the day ends, and is not counted. The
// batch that takes the day past 80 % tells the owners, once. Yesterday's count is no part of today's.
func TestPushHoldsAHouseholdToItsDaysMutations(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	today := time.Now().UTC().Format(time.DateOnly)
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format(time.DateOnly)
	w.exec("INSERT INTO sync_usage (household_id, day, mutations) VALUES ($1, $2, $3), ($1, $4, $5)",
		household, yesterday, fairuse.SyncMutations, today, fairuse.SyncMutations*4/5-1)
	item := func() map[string]any {
		return mutationOf(conformance.Item, "create", idgen.New(), map[string]any{"title": "Milk"})
	}
	w.want(w.results(w.push(household, token, key(), item(), item())), push.Applied, push.Applied)
	warnings := func() int {
		return w.count("SELECT count(*) FROM notifications WHERE household_id = $1 AND message = 'notification.fair_use_sync'", household)
	}
	if n := warnings(); n != 1 {
		t.Errorf("%d warnings of the day's mutations, want 1 to the owner", n)
	}
	w.results(w.push(household, token, key(), item()))
	if n := warnings(); n != 1 {
		t.Errorf("%d warnings after a later batch, want the one", n)
	}
	w.exec("UPDATE sync_usage SET mutations = $3 WHERE household_id = $1 AND day = $2", household, today, fairuse.SyncMutations-1)
	w.results(w.push(household, token, key(), item(), item()))
	rec := w.push(household, token, key(), item())
	retry, _ := strconv.Atoi(rec.Header().Get("Retry-After"))
	if rec.Code != http.StatusTooManyRequests || !strings.Contains(rec.Body.String(), `"rate_limited"`) || retry < 1 || retry > 24*60*60 {
		t.Errorf("a batch past the day's mutations: %d, Retry-After %q, %s", rec.Code, rec.Header().Get("Retry-After"), rec.Body)
	}
	if n := w.count("SELECT mutations FROM sync_usage WHERE household_id = $1 AND day = $2", household, today); n != fairuse.SyncMutations+1 {
		t.Errorf("the day counts %d mutations, want %d: the refused batch is not counted", n, fairuse.SyncMutations+1)
	}
}
