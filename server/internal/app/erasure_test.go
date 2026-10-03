package app_test

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// deletionDoc is the contract's DeletionRequest, as a client reads it.
type deletionDoc struct {
	ID          uuid.UUID `json:"id"`
	Scope       string    `json:"scope"`
	RequestedAt time.Time `json:"requested_at"`
	ExecutesAt  time.Time `json:"executes_at"`
	CancelToken *string   `json:"cancel_token"`
}

// deleteAccount asks for the account's deletion with proof, naming the households to delete with it.
func (b *browser) deleteAccount(proof string, households ...uuid.UUID) *httptest.ResponseRecorder {
	b.s.t.Helper()
	body := map[string]any{"password_or_confirmation": proof}
	if households != nil {
		body["delete_sole_owned_households"] = households
	}
	return b.post("/me/deletion", jsonBody(b.s.t, body))
}

// scheduledFor is when household h is to be deleted, as b reads it, nil for never.
func (b *browser) scheduledFor(h uuid.UUID) *time.Time {
	b.s.t.Helper()
	rec := b.get(householdPath(h, ""))
	expect(b.s.t, rec, http.StatusOK, "")
	var doc struct {
		DeletionScheduledAt *time.Time `json:"deletion_scheduled_at"`
	}
	decode(b.s.t, rec, &doc)
	return doc.DeletionScheduledAt
}

// lastMail is the subject of the last message to address, "" for none.
func (s *site) lastMail(address string) string {
	messages := s.outbox.To(address)
	if len(messages) == 0 {
		return ""
	}
	return messages[len(messages)-1].Subject
}

// An account's deletion resolves every household first and says what blocks it at once (FR-PR3);
// scheduled, it disables the account, whose sign-in then fails as a wrong password does (FR-PR4,
// FR-ID3), and tells the members of the household that goes with it; and the link its email carries
// cancels it, once, and the household's with it.
func TestAnAccountsDeletionIsResolvedScheduledAndCancelled(t *testing.T) {
	p := newPrivacySite(t)
	address := p.a("jana@tilcerovi.cz")
	jana := p.person("Jana", address)
	h := jana.create("Tilcerovi")
	petr, _ := p.joined(jana, h.ID, "Petr", p.a("petr@tilcerovi.cz"), "member", nil)
	chata := petr.create("Chata")

	// A stolen session alone deletes nothing.
	expect(t, jana.deleteAccount("not her password"), http.StatusUnauthorized, problem.CodeInvalidCredentials)

	// She is the only owner of a household with another member in it, and its payer: both block, at once.
	rec := jana.deleteAccount(passphrase)
	expect(t, rec, http.StatusConflict, problem.CodeAccountDeletionBlocked)
	var blocked struct {
		Sole []struct {
			HouseholdID uuid.UUID `json:"household_id"`
			Name        string    `json:"name"`
			MemberCount int       `json:"member_count"`
		} `json:"sole_owned_households"`
		Payer []uuid.UUID `json:"billing_payer_for"`
	}
	decode(t, rec, &blocked)
	if len(blocked.Sole) != 1 || blocked.Sole[0].HouseholdID != h.ID || blocked.Sole[0].Name != "Tilcerovi" || blocked.Sole[0].MemberCount != 2 ||
		len(blocked.Payer) != 1 || blocked.Payer[0] != h.ID {
		t.Fatalf("blocked by %+v", blocked)
	}
	// A household that is not hers alone to delete is not hers to name.
	if errs := fieldErrorsOf(t, jana.deleteAccount(passphrase, chata.ID)); len(errs) != 1 || errs[0].Field != "/delete_sole_owned_households/0" {
		t.Fatalf("naming Petr's household answered %+v", errs)
	}
	if p.count("SELECT count(*) FROM account_deletions WHERE user_id = $1", jana.me().ID) != 0 {
		t.Fatal("a refused request scheduled a deletion")
	}

	// Naming it schedules both: hers, and the household's with it.
	before := p.clock.now()
	rec = jana.deleteAccount(passphrase, h.ID)
	expect(t, rec, http.StatusAccepted, "")
	var d deletionDoc
	decode(t, rec, &d)
	if d.Scope != "user" || d.CancelToken == nil || !d.ExecutesAt.Equal(d.RequestedAt.Add(30*24*time.Hour)) || d.RequestedAt.Before(before.Add(-time.Second)) {
		t.Fatalf("scheduled as %+v", d)
	}
	// The account is switched off: her session is over, and no sign-in admits her.
	expect(t, jana.get("/me"), http.StatusUnauthorized, problem.CodeUnauthenticated)
	wrong := p.browser().post("/auth/login", jsonBody(t, map[string]string{"email": address, "password": "not her password", "client_type": "web"}))
	off := p.browser().post("/auth/login", jsonBody(t, map[string]string{"email": address, "password": passphrase, "client_type": "web"}))
	expect(t, off, http.StatusUnauthorized, problem.CodeInvalidCredentials)
	if shape(t, off) != shape(t, wrong) {
		t.Errorf("a disabled account's sign-in answers %s, a wrong password %s", shape(t, off), shape(t, wrong))
	}
	// Her address has the link, whose token is the one the answer carried.
	token, mail := p.token(address)
	if token != *d.CancelToken || !strings.Contains(mail.Body, "/account/deletion/cancel#token=") || !strings.Contains(mail.Subject, "30 days") {
		t.Fatalf("the email reads %q: %s", mail.Subject, mail.Body)
	}
	// The household goes with her, and its other member is told now.
	if at := petr.scheduledFor(h.ID); at == nil || !at.Equal(d.ExecutesAt) {
		t.Fatalf("the household is scheduled for %v, want %v", at, d.ExecutesAt)
	}
	if got := p.lastMail(p.a("petr@tilcerovi.cz")); !strings.Contains(got, "Tilcerovi will be deleted in 30 days") {
		t.Fatalf("Petr was told %q", got)
	}
	if at := petr.scheduledFor(chata.ID); at != nil {
		t.Fatalf("Petr's own household is scheduled for %v", at)
	}

	// The link cancels it, once.
	cancel := func(token string) *httptest.ResponseRecorder {
		return p.browser().post("/auth/deletion/cancel", jsonBody(t, map[string]string{"token": token}))
	}
	expect(t, cancel("nobody-issued-this"), http.StatusNotFound, problem.CodeNotFound)
	expect(t, cancel(token), http.StatusNoContent, "")
	expect(t, cancel(token), http.StatusGone, problem.CodeTokenAlreadyUsed)
	back := p.browser()
	back.login(address, passphrase)
	if at := back.scheduledFor(h.ID); at != nil {
		t.Fatalf("cancelled, the household is still scheduled for %v", at)
	}
	if got := p.lastMail(p.a("petr@tilcerovi.cz")); !strings.Contains(got, "Tilcerovi will not be deleted") {
		t.Fatalf("Petr was told %q", got)
	}
	// A link past its 30 days cancels nothing.
	rec = back.deleteAccount(passphrase, h.ID)
	expect(t, rec, http.StatusAccepted, "")
	decode(t, rec, &d)
	p.clock.advance(30*24*time.Hour + time.Minute)
	expect(t, cancel(*d.CancelToken), http.StatusGone, problem.CodeTokenExpired)
}

// The link that cancels a deletion is the one way back in, and its email is sent once (D-130):
// whoever lost it, or never got it, asks for a password reset, and the account's address is sent the
// link again, with a new token in place of the one before. No reset link goes to an account no
// password signs in; cancelled, the account is sent one as any other is; and once nothing cancels the
// deletion any more, it is sent nothing.
func TestAPasswordResetAskedOfAnAccountBeingDeletedSendsItsCancelLinkAgain(t *testing.T) {
	p := newPrivacySite(t)
	address := p.a("jana@tilcerovi.cz")
	jana := p.person("Jana", address)
	janaID := jana.me().ID
	ask := func() {
		t.Helper()
		expect(t, p.browser().post("/auth/password-reset", jsonBody(t, map[string]string{"email": address})), http.StatusAccepted, "")
	}
	cancel := func(token string) *httptest.ResponseRecorder {
		return p.browser().post("/auth/deletion/cancel", jsonBody(t, map[string]string{"token": token}))
	}
	resets := func() int {
		return p.count("SELECT count(*) FROM email_tokens WHERE user_id = $1 AND purpose = 'reset_password'", janaID)
	}

	rec := jana.deleteAccount(passphrase)
	expect(t, rec, http.StatusAccepted, "")
	var d deletionDoc
	decode(t, rec, &d)

	// Ten days on, with a part of a day gone: twenty days are left, and the email says so.
	p.clock.advance(10*24*time.Hour + time.Hour)
	ask()
	token, mail := p.token(address)
	if token == *d.CancelToken || !strings.Contains(mail.Body, "/account/deletion/cancel#token=") || !strings.Contains(mail.Subject, "20 days") {
		t.Fatalf("asked for a reset, the account was sent %q: %s", mail.Subject, mail.Body)
	}
	if n := resets(); n != 0 {
		t.Errorf("%d reset links were issued for an account no password signs in", n)
	}
	// The link sent before cancels nothing any more, and the new one does.
	expect(t, cancel(*d.CancelToken), http.StatusNotFound, problem.CodeNotFound)
	if n := p.count("SELECT count(*) FROM account_deletions WHERE user_id = $1", janaID); n != 1 {
		t.Fatal("the link sent before still cancelled the deletion")
	}
	expect(t, cancel(token), http.StatusNoContent, "")
	p.browser().login(address, passphrase)

	// Cancelled, the account is sent a reset link as any other is.
	ask()
	if _, mail := p.token(address); !strings.Contains(mail.Body, "/reset/set#token=") || resets() != 1 {
		t.Fatalf("cancelled and asked for a reset, the account was sent %q: %s", mail.Subject, mail.Body)
	}

	// A deletion whose link has run out is cancelled by nothing, and nothing is sent for it.
	back := p.browser()
	back.login(address, passphrase)
	expect(t, back.deleteAccount(passphrase), http.StatusAccepted, "")
	p.clock.advance(30*24*time.Hour + time.Minute)
	sent := len(p.outbox.To(address))
	ask()
	if got := len(p.outbox.To(address)); got != sent || resets() != 1 {
		t.Fatalf("past its link's time the account was sent %d more messages, and holds %d reset links", got-sent, resets())
	}
}

// An erased account leaves a tombstone and a former member (FR-PR4): its own tables are emptied,
// its objects removed, the household it was alone in goes with it, and in the household that goes on
// its membership ends, what it kept privately is deleted, what it made stays, and the events it
// caused lose its name.
func TestAnErasedAccountLeavesATombstoneAndAFormerMember(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi")
	address := p.a("petr@tilcerovi.cz")
	petr, petrID := p.joined(jana, h.ID, "Petr", address, "member", nil)
	chata := petr.create("Chata")
	p.probe(h.ID, map[uuid.UUID]string{janaID: "manage", petrID: "contribute"})
	p.probe(chata.ID, map[uuid.UUID]string{petrID: "manage"})
	made := p.item(h.ID, petrID, false, "nákup.txt", "shared, Petr made it")
	own := p.item(h.ID, petrID, true, "petr.txt", "Petr's own")
	p.item(chata.ID, petrID, false, "chata.txt", "the cottage's")

	// What the account keeps outside any household: a consent, a bundle and an export's archive.
	expect(t, petr.put("/me/consents", `{"analytics":true}`), http.StatusOK, "")
	expect(t, petr.post("/me/diagnostics", `{"screen":"sync-health","payload":{"queue_depth":3}}`), http.StatusCreated, "")
	exportOf(t, petr.post("/me/exports", ""), http.StatusAccepted)
	p.work()
	if keys := p.objects("u/" + petrID.String() + "/"); len(keys) != 1 {
		t.Fatalf("the store holds %v of his", keys)
	}

	// A member of one household and alone in the other: nothing blocks.
	expect(t, petr.deleteAccount(passphrase), http.StatusAccepted, "")
	if n := len(jana.members(h.ID)); n != 2 {
		t.Fatalf("scheduled, the household has %d members: the membership ends with the account", n)
	}
	p.clock.advance(15 * 24 * time.Hour)
	jana.me()
	if p.erase(); p.count("SELECT count(*) FROM users WHERE id = $1 AND deleted_at IS NULL", petrID) != 1 {
		t.Fatal("halfway through the window the job erased the account")
	}
	p.clock.advance(15*24*time.Hour + time.Minute)
	p.erase()
	p.files.Drain(t.Context(), h.ID)

	// The tombstone: an id and a time.
	var (
		email   *string
		name    string
		deleted *time.Time
	)
	if err := p.admin.QueryRow(t.Context(), "SELECT email, display_name, deleted_at FROM users WHERE id = $1", petrID).
		Scan(&email, &name, &deleted); err != nil || email != nil || name != "" || deleted == nil {
		t.Fatalf("the users row reads %v %q %v (%v)", email, name, deleted, err)
	}
	for _, table := range []string{"credentials", "sessions", "email_tokens", "consents", "diagnostic_bundles", "exports", "account_deletions", "avatars"} {
		if n := p.count("SELECT count(*) FROM "+table+" WHERE user_id = $1", petrID); n != 0 {
			t.Errorf("%s keeps %d of his rows", table, n)
		}
	}
	if keys := p.objects("u/" + petrID.String() + "/"); len(keys) != 0 {
		t.Errorf("the store keeps %v of his", keys)
	}
	off := p.browser().post("/auth/login", jsonBody(t, map[string]string{"email": address, "password": passphrase, "client_type": "web"}))
	expect(t, off, http.StatusUnauthorized, problem.CodeInvalidCredentials)

	// The household he was alone in went with him: no row of it, and no object.
	if rows := p.rowsOf(chata.ID); len(rows) != 0 {
		t.Errorf("his own household keeps %v", rows)
	}
	if keys := p.objects("h/" + chata.ID.String() + "/"); len(keys) != 0 {
		t.Errorf("the store keeps %v of his own household", keys)
	}
	if n := p.count("SELECT count(*) FROM erasures WHERE kind = 'household' AND id = $1 AND cause = 'account' AND purged_at IS NOT NULL", chata.ID); n != 1 {
		t.Errorf("no tombstone of his own household")
	}

	// The household that goes on: he is no member, what he kept is gone, what he made stays.
	members := jana.members(h.ID)
	if _, there := members["Petr"]; there || len(members) != 1 {
		t.Fatalf("the household's members are %v", members)
	}
	if p.count("SELECT count(*) FROM probe_items WHERE id = $1", own) != 0 || p.count("SELECT count(*) FROM probe_items WHERE id = $1 AND created_by = $2", made, petrID) != 1 {
		t.Error("his private item stayed, or what he made went")
	}
	if keys := p.objects("h/" + h.ID.String() + "/probe/" + own.String()); len(keys) != 0 {
		t.Errorf("his private item's file stayed: %v", keys)
	}
	if n := p.count("SELECT count(*) FROM audit_events WHERE household_id = $1 AND actor_id = $2 AND actor_label IS NOT NULL", h.ID, petrID); n != 0 {
		t.Errorf("%d of the events he caused still carry his name", n)
	}
	if n := p.count("SELECT count(*) FROM audit_events WHERE household_id = $1 AND action = 'member.erase' AND actor_type = 'system'", h.ID); n != 1 {
		t.Errorf("the household's log records his going %d times", n)
	}
	if n := p.count("SELECT count(*) FROM notifications WHERE household_id = $1 AND user_id = $2", h.ID, petrID); n != 0 {
		t.Errorf("%d notifications to him are kept", n)
	}
	// As the household reads its log now, he is a former member.
	e := exportOf(t, jana.post(householdPath(h.ID, "/exports"), ""), http.StatusAccepted)
	p.work()
	entries, _ := p.stored(e.ID)
	if log := entries["activity-log.csv"]; !strings.Contains(log, "Former member,admin,member.join,") || strings.Contains(log, "Petr,") {
		t.Errorf("the activity log reads:\n%s", log)
	}
}

// The payer of a household that goes with the account blocks its deletion only while the household's
// subscription still charges (FR-PR3, D-131): paid and current, or with a failed payment being tried
// again. In grace nothing is charged any more, dunning exhausted or a trial ended unpaid (PRD 04 §3),
// and there is nothing to cancel first: whoever let a trial run out deletes their account that day.
func TestAHouseholdThatChargesNothingKeepsNobodyFromDeletingTheirAccount(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")

	// Billing's states are item 19's to move; here they move as the administrator moves them.
	p.exec("UPDATE households SET billing_state = 'past_due', dunning_ends_at = $2 WHERE id = $1", h.ID, p.clock.now().Add(7*24*time.Hour))
	rec := jana.deleteAccount(passphrase)
	expect(t, rec, http.StatusConflict, problem.CodeAccountDeletionBlocked)
	var blocked struct {
		Payer []uuid.UUID `json:"billing_payer_for"`
	}
	decode(t, rec, &blocked)
	if len(blocked.Payer) != 1 || blocked.Payer[0] != h.ID {
		t.Fatalf("with a payment still being tried, blocked by %+v", blocked)
	}

	p.exec("UPDATE households SET billing_state = 'grace', grace_ends_at = $2 WHERE id = $1", h.ID, p.clock.now().Add(14*24*time.Hour))
	expect(t, jana.deleteAccount(passphrase), http.StatusAccepted, "")
}

// Nobody leaves a household to an owner who is leaving it too: an owner whose account is scheduled
// for deletion counts as none (FR-HH4, FR-PR3). Where one is the last all the same when their account
// is erased, the adult who has been a member longest is made an owner, and billing passes to them,
// rather than the household being left with nobody to run it (D-131).
func TestTheLastOwnerErasedIsSucceeded(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petr, petrID := p.joined(jana, h.ID, "Petr", p.a("petr@tilcerovi.cz"), "member", nil)
	eva, _ := p.joined(jana, h.ID, "Eva", p.a("eva@tilcerovi.cz"), "member", nil)
	expect(t, jana.post(householdPath(h.ID, "/ownership/transfer"), jsonBody(t, map[string]any{"user_id": petrID})), http.StatusOK, "")

	// With another owner she is the payer of a household that goes on: billing first.
	expect(t, jana.deleteAccount(passphrase), http.StatusConflict, problem.CodeAccountDeletionBlocked)
	// Billing is item 19's to move; here it moves as the administrator moves it.
	p.exec("UPDATE households SET billing_payer_id = $2 WHERE id = $1", h.ID, petrID)
	expect(t, jana.deleteAccount(passphrase), http.StatusAccepted, "")

	// Petr is now the only owner who will still be there, and cannot leave.
	expect(t, petr.post(householdPath(h.ID, "/leave"), ""), http.StatusConflict, problem.CodeLastOwner)

	// Should she be the last owner all the same when the day comes, the household is not left ownerless.
	p.exec("UPDATE memberships SET role = 'member' WHERE household_id = $1 AND user_id = $2", h.ID, petrID)
	p.exec("UPDATE households SET billing_payer_id = (SELECT user_id FROM memberships WHERE household_id = $1 AND role = 'owner') WHERE id = $1", h.ID)
	p.clock.advance(15 * 24 * time.Hour)
	eva.me()
	petr.me()
	p.clock.advance(15*24*time.Hour + time.Minute)
	p.erase()

	members := eva.members(h.ID)
	if len(members) != 2 || members["Petr"].Role != "owner" || members["Eva"].Role != "member" {
		t.Fatalf("the household's members are %+v", members)
	}
	if n := p.count("SELECT count(*) FROM households WHERE id = $1 AND billing_payer_id = $2", h.ID, petrID); n != 1 {
		t.Error("billing did not pass to the owner who stays")
	}
	for _, action := range []string{"member.succeed", "member.erase"} {
		if n := p.count("SELECT count(*) FROM audit_events WHERE household_id = $1 AND action = $2 AND actor_type = 'system'", h.ID, action); n != 1 {
			t.Errorf("the log records %s %d times", action, n)
		}
	}
}

// Billing passes to an owner who is staying before one whose own account is scheduled for deletion,
// however long either has been a member (D-131): an account that is disabled pays for nothing it can
// see, and the owner who stays could not remove its payer.
func TestBillingPassesToAnOwnerWhoStaysBeforeOneWhoIsLeaving(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi")
	petr, petrID := p.joined(jana, h.ID, "Petr", p.a("petr@tilcerovi.cz"), "member", nil)
	_, evaID := p.joined(jana, h.ID, "Eva", p.a("eva@tilcerovi.cz"), "member", nil)
	for _, id := range []uuid.UUID{petrID, evaID} {
		expect(t, jana.post(householdPath(h.ID, "/ownership/transfer"), jsonBody(t, map[string]any{"user_id": id})), http.StatusOK, "")
	}
	// Billing is item 19's to move; here it moves as the administrator moves it: away from Jana for
	// her to ask, and back, so that it is hers to pass on when her account is erased.
	p.exec("UPDATE households SET billing_payer_id = $2 WHERE id = $1", h.ID, petrID)
	expect(t, jana.deleteAccount(passphrase), http.StatusAccepted, "")
	p.exec("UPDATE households SET billing_payer_id = $2 WHERE id = $1", h.ID, janaID)
	// Petr, an owner who joined before Eva, goes too, ten days on: Eva is the owner who stays.
	p.clock.advance(10 * 24 * time.Hour)
	expect(t, petr.deleteAccount(passphrase), http.StatusAccepted, "")

	p.clock.advance(20*24*time.Hour + time.Minute)
	p.erase()
	if n := p.count("SELECT count(*) FROM memberships WHERE household_id = $1 AND user_id = $2", h.ID, janaID); n != 0 {
		t.Fatal("her membership outlived her account")
	}
	if n := p.count("SELECT count(*) FROM households WHERE id = $1 AND billing_payer_id = $2", h.ID, evaID); n != 1 {
		t.Error("billing passed to an owner whose own account is scheduled for deletion, with one who stays beside him")
	}
}

// A household is not erased while an adult who could run it may still come back (D-131). An owner
// whose own account is scheduled for deletion counts as none for whoever would leave the household to
// them, and is its owner still when the other owner's account is erased first: the household goes on
// until their own 30 days are over, and is theirs if they cancel.
func TestAHouseholdOutlivesAnOwnerWhileAnotherMayStillComeBack(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	address := p.a("petr@tilcerovi.cz")
	petr, petrID := p.joined(jana, h.ID, "Petr", address, "member", nil)
	expect(t, jana.post(householdPath(h.ID, "/ownership/transfer"), jsonBody(t, map[string]any{"user_id": petrID})), http.StatusOK, "")
	// Billing is item 19's to move; here it moves as the administrator moves it.
	p.exec("UPDATE households SET billing_payer_id = $2 WHERE id = $1", h.ID, petrID)

	// Jana goes first, with another owner there. Twenty days on Petr goes too: he is by then the only
	// owner who will still be there, so the household is his to delete with his account, in 30 days.
	expect(t, jana.deleteAccount(passphrase), http.StatusAccepted, "")
	p.clock.advance(20 * 24 * time.Hour)
	expect(t, petr.deleteAccount(passphrase), http.StatusConflict, problem.CodeAccountDeletionBlocked)
	rec := petr.deleteAccount(passphrase, h.ID)
	expect(t, rec, http.StatusAccepted, "")
	var d deletionDoc
	decode(t, rec, &d)

	// Jana's 30 days end ten days into his. Her account is erased and her membership with it; the
	// household, which is not due for twenty days and whose owner he still is, stays.
	p.clock.advance(10*24*time.Hour + time.Minute)
	p.erase()
	if n := p.count("SELECT count(*) FROM households WHERE id = $1 AND deletion_scheduled_at = $2", h.ID, d.ExecutesAt); n != 1 {
		t.Fatal("the household went with the first owner's account, while the other may still come back to it")
	}
	if n := p.count("SELECT count(*) FROM memberships WHERE household_id = $1", h.ID); n != 1 {
		t.Fatalf("the household has %d members, want Petr alone", n)
	}

	// He comes back within his own 30 days, to the household he had, which is no longer to be deleted.
	expect(t, p.browser().post("/auth/deletion/cancel", jsonBody(t, map[string]string{"token": *d.CancelToken})), http.StatusNoContent, "")
	back := p.browser()
	back.login(address, passphrase)
	if at := back.scheduledFor(h.ID); at != nil {
		t.Fatalf("cancelled, the household is still scheduled for %v", at)
	}
	if members := back.members(h.ID); len(members) != 1 || members["Petr"].Role != "owner" {
		t.Fatalf("the household's members are %+v", members)
	}
}

// Where the only adult left in a household is one whose own account is scheduled for deletion, they
// are made its owner all the same (D-131): the household is theirs if they come back, and goes with
// their account if they do not. It goes with the last owner's account only when child profiles alone
// are left in it.
func TestTheLastOwnerErasedIsSucceededByAnAdultWhoMayStillComeBack(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	address := p.a("petr@tilcerovi.cz")
	petr, petrID := p.joined(jana, h.ID, "Petr", address, "member", nil)
	jana.child(h.ID, "Tomáš", "4821", nil)
	expect(t, jana.post(householdPath(h.ID, "/ownership/transfer"), jsonBody(t, map[string]any{"user_id": petrID})), http.StatusOK, "")
	p.exec("UPDATE households SET billing_payer_id = $2 WHERE id = $1", h.ID, petrID)
	expect(t, jana.deleteAccount(passphrase), http.StatusAccepted, "")
	// She is the last owner all the same when the day comes, and the one adult beside her is leaving too.
	p.exec("UPDATE memberships SET role = 'member' WHERE household_id = $1 AND user_id = $2", h.ID, petrID)
	p.exec("UPDATE households SET billing_payer_id = (SELECT user_id FROM memberships WHERE household_id = $1 AND role = 'owner') WHERE id = $1", h.ID)
	p.clock.advance(10 * 24 * time.Hour)
	rec := petr.deleteAccount(passphrase)
	expect(t, rec, http.StatusAccepted, "")
	var d deletionDoc
	decode(t, rec, &d)

	p.clock.advance(20*24*time.Hour + time.Minute)
	p.erase()
	if n := p.count("SELECT count(*) FROM memberships WHERE household_id = $1 AND user_id = $2 AND role = 'owner'", h.ID, petrID); n != 1 {
		t.Fatal("the household was not left to the adult who may still come back to it")
	}
	if n := p.count("SELECT count(*) FROM households WHERE id = $1 AND billing_payer_id = $2", h.ID, petrID); n != 1 {
		t.Error("billing did not pass to him")
	}

	// He does not come back: the household, with nobody but its child profile left, goes with his account.
	p.clock.advance(10 * 24 * time.Hour)
	p.erase()
	if rows := p.rowsOf(h.ID); len(rows) != 0 {
		t.Fatalf("with child profiles alone left in it, the household keeps %v", rows)
	}
	expect(t, p.browser().post("/auth/deletion/cancel", jsonBody(t, map[string]string{"token": *d.CancelToken})), http.StatusNotFound, problem.CodeNotFound)
}

// A household its only owner chose to delete with their account goes the night the account does,
// whoever owns it by then (D-131): an owner who came back to it and left its deletion standing was
// told the day, and it is not kept a night past that day for them.
func TestAHouseholdChosenWithAnAccountGoesWithItWhoeverOwnsItByThen(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi")
	address := p.a("petr@tilcerovi.cz")
	petr, petrID := p.joined(jana, h.ID, "Petr", address, "member", nil)
	expect(t, jana.post(householdPath(h.ID, "/ownership/transfer"), jsonBody(t, map[string]any{"user_id": petrID})), http.StatusOK, "")

	// Petr goes first, so Jana is the only owner who will still be there, and names the household.
	rec := petr.deleteAccount(passphrase)
	expect(t, rec, http.StatusAccepted, "")
	var d deletionDoc
	decode(t, rec, &d)
	expect(t, jana.deleteAccount(passphrase, h.ID), http.StatusAccepted, "")
	// He comes back, an owner of a household that is to be deleted, and leaves its deletion as it is.
	expect(t, p.browser().post("/auth/deletion/cancel", jsonBody(t, map[string]string{"token": *d.CancelToken})), http.StatusNoContent, "")
	back := p.browser()
	back.login(address, passphrase)
	at := back.scheduledFor(h.ID)
	if at == nil {
		t.Fatal("his own cancellation cancelled the deletion of a household that follows her account")
	}

	p.clock.advance(30*24*time.Hour + time.Minute)
	p.erase()
	if p.count("SELECT count(*) FROM users WHERE id = $1 AND deleted_at IS NOT NULL", janaID) != 1 {
		t.Fatal("her account was not erased")
	}
	if rows := p.rowsOf(h.ID); len(rows) != 0 {
		t.Fatalf("the night her account went, past %s, the household she chose to delete with it keeps %v", at, rows)
	}
	if n := p.count("SELECT count(*) FROM erasures WHERE kind = 'household' AND id = $1 AND cause = 'account'", h.ID); n != 1 {
		t.Error("no tombstone of the household")
	}
	if p.count("SELECT count(*) FROM users WHERE id = $1 AND deleted_at IS NULL", petrID) != 1 {
		t.Error("his account went with the household")
	}
}

// An account that declined a household's invitation, and never joined it, is named by that
// household's log all the same, as who declined. Erased, it reads as a former member there too
// (FR-PR4, D-135): the job finds the household by the record the decline left, which keeps nothing
// of theirs for a window and gives their own export nothing.
func TestAnErasedAccountsNameLeavesTheLogOfAHouseholdItOnlyDeclined(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	address := p.a("eva@tilcerovi.cz")
	eva := p.person("Eva", address)
	evaID := eva.me().ID
	jana.invite(h.ID, map[string]any{"kind": "email", "email": address, "role": "member"})
	expect(t, eva.post("/me/invitations/"+p.invitationToken(address)+"/decline", ""), http.StatusNoContent, "")
	const named = "SELECT count(*) FROM audit_events WHERE household_id = $1 AND actor_id = $2 AND actor_label IS NOT NULL"
	if n := p.count(named, h.ID, evaID); n != 1 {
		t.Fatalf("%d of the household's events name her, want the one that says she declined", n)
	}
	if n := p.count("SELECT count(*) FROM departures WHERE household_id = $1 AND user_id = $2 AND cause = 'declined' AND erased_at IS NOT NULL",
		h.ID, evaID); n != 1 {
		t.Fatal("nothing records that the household's log names her")
	}
	// The record is no window: her own export takes nothing of a household she never joined.
	e := exportOf(t, eva.post("/me/exports", ""), http.StatusAccepted)
	p.work()
	if _, m := p.stored(e.ID); len(m.Households) != 0 {
		t.Errorf("her export takes a part of %+v", m.Households)
	}

	expect(t, eva.deleteAccount(passphrase), http.StatusAccepted, "")
	p.clock.advance(30*24*time.Hour + time.Minute)
	p.erase()
	if p.count("SELECT count(*) FROM users WHERE id = $1 AND deleted_at IS NOT NULL", evaID) != 1 {
		t.Fatal("her account was not erased")
	}
	if n := p.count(named, h.ID, evaID); n != 0 {
		t.Errorf("%d of the events she caused still carry her name", n)
	}
	if n := p.count("SELECT count(*) FROM departures WHERE household_id = $1 AND user_id = $2", h.ID, evaID); n != 0 {
		t.Error("the record outlived her account")
	}
}

// A sign-in never waits for a deletion being scheduled: it is refused as a wrong password is while
// the scheduling holds the account's row (FR-PR4). Waiting for it, a second step's answer, which
// holds its challenge, would deadlock with the scheduling, which ends the account's challenges.
func TestASignInBesideADeletionBeingScheduledIsRefusedAndNeverWaits(t *testing.T) {
	p := newPrivacySite(t)
	address := p.a("jana@tilcerovi.cz")
	jana := p.person("Jana", address)
	janaID := jana.me().ID

	// The scheduling's transaction, as far as the lock it takes first.
	tx, err := p.admin.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(t.Context())) }()
	if err := identity.LockAccount(t.Context(), tx, janaID); err != nil {
		t.Fatal(err)
	}
	body := jsonBody(t, map[string]string{"email": address, "password": passphrase, "client_type": "web"})
	answered := make(chan *httptest.ResponseRecorder, 1)
	go func() { answered <- p.browser().post("/auth/login", body) }()
	select {
	case rec := <-answered:
		expect(t, rec, http.StatusUnauthorized, problem.CodeInvalidCredentials)
	case <-time.After(15 * time.Second):
		t.Fatal("the sign-in waited for the deletion being scheduled")
	}

	// The scheduling given up, the account signs in as it did.
	if err := tx.Rollback(t.Context()); err != nil {
		t.Fatal(err)
	}
	p.browser().login(address, passphrase)
}

// A deletion is held to the proof that confirmed it (FR-PR3). The password is checked before the
// transaction that schedules the deletion, as a password's change checks its own: one reset or
// changed in between ends what the check proved, and the scheduling answers as a wrong password does.
func TestADeletionIsHeldToThePasswordThatConfirmedIt(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	owner, err := p.identity.ConfirmDeletion(t.Context(), janaID, passphrase)
	if err != nil {
		t.Fatal(err)
	}
	// The scheduling's transaction, as far as its hold on what was confirmed.
	hold := func() error {
		tx, err := p.admin.Begin(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(context.WithoutCancel(t.Context())) }()
		return p.identity.HoldConfirmation(t.Context(), tx, janaID, owner)
	}
	if err := hold(); err != nil {
		t.Fatalf("with the password it was confirmed with still the account's, the hold answered %v", err)
	}
	// A reset lands between the check and the scheduling: the password is one set at another moment.
	p.exec("UPDATE credentials SET updated_at = clock_timestamp() WHERE user_id = $1 AND type = 'password'", janaID)
	var refused *problem.Problem
	if err := hold(); !errors.As(err, &refused) || refused.Code != problem.CodeInvalidCredentials {
		t.Fatalf("with the password set again since it was checked, the hold answered %v", err)
	}
	// And the request itself goes on working with the password as it now is.
	expect(t, jana.deleteAccount(passphrase), http.StatusAccepted, "")
}

// An erasure that fails partway is finished the next night, with nothing of it left undone (FR-PR4):
// while a module's part of a household fails, the account stays scheduled and its membership stays,
// which is how the job finds the household again.
func TestAnErasureThatFailedPartwayIsFinishedTheNextNight(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi")
	petr, petrID := p.joined(jana, h.ID, "Petr", p.a("petr@tilcerovi.cz"), "member", nil)
	p.probe(h.ID, map[uuid.UUID]string{janaID: "manage", petrID: "contribute"})
	own := p.item(h.ID, petrID, true, "petr.txt", "Petr's own")
	expect(t, petr.deleteAccount(passphrase), http.StatusAccepted, "")
	p.clock.advance(15 * 24 * time.Hour)
	jana.me()
	p.clock.advance(15*24*time.Hour + time.Minute)

	p.refuse.Store(true)
	if _, err := p.privacy.Erase(t.Context()); err == nil {
		t.Fatal("the job reported nothing of a module that refused")
	}
	if p.count("SELECT count(*) FROM users WHERE id = $1 AND deleted_at IS NULL", petrID) != 1 {
		t.Fatal("the account was erased with a household's part of it undone")
	}
	if n := p.count("SELECT count(*) FROM memberships WHERE household_id = $1 AND user_id = $2", h.ID, petrID); n != 1 {
		t.Fatal("his membership ended before what the household keeps of him was deleted: nothing finds the household again")
	}

	p.refuse.Store(false)
	p.erase()
	p.files.Drain(t.Context(), h.ID)
	if p.count("SELECT count(*) FROM users WHERE id = $1 AND deleted_at IS NOT NULL", petrID) != 1 {
		t.Fatal("the next night did not erase the account")
	}
	if p.count("SELECT count(*) FROM probe_items WHERE id = $1", own) != 0 {
		t.Error("what he kept privately outlived his account")
	}
	if n := p.count("SELECT count(*) FROM audit_events WHERE household_id = $1 AND actor_id = $2 AND actor_label IS NOT NULL", h.ID, petrID); n != 0 {
		t.Errorf("%d of the events he caused still carry his name", n)
	}
	if members := jana.members(h.ID); len(members) != 1 {
		t.Errorf("the household's members are %+v", members)
	}
}

// Nothing cancels a deletion once its execution has begun (FR-PR4). The link is issued a clock's
// reading after the day is set and lasts that much longer, so it would still pass its own check as
// the nightly job finds the account due: the job ends it before it reads the deletion, and an account
// it had begun on, and left half erased when a module's part failed, is not brought back.
func TestADeletionBeingExecutedIsNoLongerCancelled(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi")
	petr, petrID := p.joined(jana, h.ID, "Petr", p.a("petr@tilcerovi.cz"), "member", nil)
	p.probe(h.ID, map[uuid.UUID]string{janaID: "manage", petrID: "contribute"})
	p.item(h.ID, petrID, true, "petr.txt", "Petr's own")

	// The clock runs while the request is served, as a real one does.
	p.clock.run(time.Second)
	rec := petr.deleteAccount(passphrase)
	p.clock.run(0)
	expect(t, rec, http.StatusAccepted, "")
	var d deletionDoc
	decode(t, rec, &d)
	// The instant after the deletion falls due, with its link not yet past its own time.
	p.clock.advance(d.ExecutesAt.Add(time.Millisecond).Sub(p.clock.now()))
	if n := p.count("SELECT count(*) FROM email_tokens WHERE user_id = $1 AND purpose = 'cancel_deletion' AND used_at IS NULL AND expires_at > $2",
		petrID, p.clock.now()); n != 1 {
		t.Fatal("the link does not outlast the day its deletion falls due: the test proves nothing")
	}

	p.refuse.Store(true)
	if _, err := p.privacy.Erase(t.Context()); err == nil {
		t.Fatal("the job reported nothing of a module that refused")
	}
	p.refuse.Store(false)
	expect(t, p.browser().post("/auth/deletion/cancel", jsonBody(t, map[string]string{"token": *d.CancelToken})),
		http.StatusGone, problem.CodeTokenAlreadyUsed)
	if n := p.count("SELECT count(*) FROM account_deletions WHERE user_id = $1", petrID); n != 1 {
		t.Fatal("a deletion whose execution had begun was cancelled")
	}
	p.erase()
	if p.count("SELECT count(*) FROM users WHERE id = $1 AND deleted_at IS NOT NULL", petrID) != 1 {
		t.Fatal("the next run did not erase the account")
	}
}

// A household's deletion is an owner's, who types its name (FR-PR6, FR-HA16): every member is told,
// any owner cancels it within 30 days, and after them the nightly job erases every row of it and
// every object, with its child profiles' accounts, and nothing of any other household.
func TestAHouseholdsDeletionErasesEveryRowOfIt(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi")
	other := jana.create("Chata")
	petr, petrID := p.joined(jana, h.ID, "Petr", p.a("petr@tilcerovi.cz"), "member", nil)
	child := jana.child(h.ID, "Tomáš", "4821", nil)
	p.probe(h.ID, map[uuid.UUID]string{janaID: "manage", petrID: "contribute"})
	p.item(h.ID, janaID, false, "smlouva.txt", "shared")
	p.item(h.ID, petrID, true, "petr.txt", "Petr's own")
	exportOf(t, jana.post(householdPath(h.ID, "/exports"), ""), http.StatusAccepted)
	p.work()
	// A bundle a member sent about it is the account's, and goes with the household it was about.
	expect(t, petr.post("/me/diagnostics", jsonBody(t, map[string]any{"screen": "sync-health", "household_id": h.ID, "payload": map[string]any{}})),
		http.StatusCreated, "")
	path := householdPath(h.ID, "/deletion")
	schedule := func(b *browser, name string) *httptest.ResponseRecorder {
		return b.post(path, jsonBody(t, map[string]string{"confirm_name": name}))
	}

	expect(t, schedule(petr, "Tilcerovi"), http.StatusForbidden, problem.CodeForbidden)
	if errs := fieldErrorsOf(t, schedule(jana, "Chata")); len(errs) != 1 || errs[0].Field != "/confirm_name" {
		t.Fatalf("another name answered %+v", errs)
	}
	rec := schedule(jana, " tilcerovi ")
	expect(t, rec, http.StatusAccepted, "")
	var d deletionDoc
	decode(t, rec, &d)
	if d.Scope != "household" || d.CancelToken != nil || !d.ExecutesAt.Equal(d.RequestedAt.Add(30*24*time.Hour)) {
		t.Fatalf("scheduled as %+v", d)
	}
	// Scheduled already, it is answered as it stands.
	var again deletionDoc
	decode(t, schedule(jana, "Tilcerovi"), &again)
	if again.ID != d.ID {
		t.Fatalf("a second request scheduled %s beside %s", again.ID, d.ID)
	}
	// Every member reads when it goes, and is told.
	if at := petr.scheduledFor(h.ID); at == nil || !at.Equal(d.ExecutesAt) {
		t.Fatalf("the household is scheduled for %v, want %v", at, d.ExecutesAt)
	}
	for _, address := range []string{p.a("jana@tilcerovi.cz"), p.a("petr@tilcerovi.cz")} {
		if got := p.lastMail(address); !strings.Contains(got, "Tilcerovi will be deleted in 30 days") {
			t.Errorf("%s was told %q", address, got)
		}
	}
	// Until then it works as it did, and an owner cancels it.
	expect(t, petr.delete(path), http.StatusForbidden, problem.CodeForbidden)
	expect(t, jana.delete(path), http.StatusNoContent, "")
	expect(t, jana.delete(path), http.StatusNotFound, problem.CodeNotFound)
	if at := petr.scheduledFor(h.ID); at != nil || !strings.Contains(p.lastMail(p.a("petr@tilcerovi.cz")), "will not be deleted") {
		t.Fatalf("cancelled, it is scheduled for %v and Petr was told %q", at, p.lastMail(p.a("petr@tilcerovi.cz")))
	}

	expect(t, schedule(jana, "Tilcerovi"), http.StatusAccepted, "")
	p.clock.advance(29 * 24 * time.Hour)
	jana.me()
	if p.erase(); p.count("SELECT count(*) FROM households WHERE id = $1", h.ID) != 1 {
		t.Fatal("a day before its time the job erased the household")
	}
	before := p.rowsOf(h.ID)
	for _, table := range []string{
		"households", "memberships", "module_enablement", "module_grants", "invitations", "audit_events", "audit_changes",
		"notifications", "notification_deliveries", "files", "probe_items", "exports", "diagnostic_bundles",
	} {
		if before[table] == 0 {
			t.Errorf("the household holds no row of %s to erase: %v", table, before)
		}
	}
	if keys := p.objects("h/" + h.ID.String() + "/"); len(keys) != 2 {
		t.Fatalf("the store holds %v of the household", keys)
	}
	kept := p.rowsOf(other.ID)

	// The clock runs while the job does, as a real one does: what the job schedules as due at once,
	// the child profile's erasure, is due in the run that scheduled it.
	p.clock.advance(24*time.Hour + time.Minute)
	p.clock.run(time.Millisecond)
	done := p.erase()
	p.clock.run(0)
	if rows := p.rowsOf(h.ID); len(rows) != 0 {
		t.Fatalf("erased, the household keeps %v", rows)
	}
	// The run counts the objects it removed: the household's two files, at the least.
	if done.Objects < 2 {
		t.Errorf("the run says it removed %d objects, with the household's two files among them", done.Objects)
	}
	if keys := p.objects("h/" + h.ID.String() + "/"); len(keys) != 0 {
		t.Errorf("the store keeps %v of the household", keys)
	}
	if keys := p.objects("u/" + janaID.String() + "/exports/"); len(keys) != 0 {
		t.Errorf("the store keeps the archive of its export: %v", keys)
	}
	if n := p.count("SELECT count(*) FROM erasures WHERE kind = 'household' AND id = $1 AND cause = 'requested' AND purged_at IS NOT NULL", h.ID); n != 1 {
		t.Error("no tombstone of the household")
	}
	// Its child profile is nothing outside it: erased with it.
	if n := p.count("SELECT count(*) FROM users WHERE id = $1 AND deleted_at IS NOT NULL", child.UserID); n != 1 {
		t.Error("its child profile's account was not erased")
	}
	// Its members' accounts, and the other household, are as they were.
	expect(t, jana.get(householdPath(h.ID, "")), http.StatusNotFound, problem.CodeNotFound)
	if got := p.rowsOf(other.ID); len(got) != len(kept) || got["memberships"] != kept["memberships"] || got["audit_events"] != kept["audit_events"] {
		t.Errorf("the other household holds %v, held %v", got, kept)
	}
	if n := p.count("SELECT count(*) FROM users WHERE id = ANY ($1) AND deleted_at IS NULL", []uuid.UUID{janaID, petrID}); n != 2 {
		t.Error("an adult member's account went with the household")
	}

	// What an upload in flight put after the erasure is removed the night after.
	late := "h/" + h.ID.String() + "/probe/" + idgen.New().String() + "/original"
	if err := p.store.PutOnce(t.Context(), late, strings.NewReader("late"), 4,
		objectstore.Object{ContentType: "text/plain", SHA256: sha256.Sum256([]byte("late"))}); err != nil {
		t.Fatal(err)
	}
	p.clock.advance(24 * time.Hour)
	if p.erase(); len(p.objects("h/"+h.ID.String()+"/")) != 0 {
		t.Error("bytes put after the erasure were kept")
	}
}

// A household's deletion is scheduled five times a day (PRD 02 §9, D-132): each scheduling emails
// every member, as the cancellation after it does, and no member mutes either, so an owner who
// scheduled and cancelled in a loop would otherwise send them as fast as the API answers. A request
// that schedules nothing, one refused or one that finds a deletion pending, counts for nothing, and
// the household named with its owner's account counts as the owner's own request does.
func TestAHouseholdsDeletionIsScheduledFiveTimesADay(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi")
	address := p.a("petr@tilcerovi.cz")
	p.joined(jana, h.ID, "Petr", address, "member", nil)
	path := householdPath(h.ID, "/deletion")
	schedule := func(name string) *httptest.ResponseRecorder {
		return jana.post(path, jsonBody(t, map[string]string{"confirm_name": name}))
	}

	before := len(p.outbox.To(address))
	for range 5 {
		expect(t, schedule("Tilcerovi"), http.StatusAccepted, "")
		// Asked again while it is pending, and asked under another name: nobody is told anything.
		expect(t, schedule("Tilcerovi"), http.StatusAccepted, "")
		expect(t, schedule("Chata"), http.StatusUnprocessableEntity, problem.CodeValidationFailed)
		expect(t, jana.delete(path), http.StatusNoContent, "")
	}
	told := len(p.outbox.To(address))
	if told-before != 10 {
		t.Fatalf("five schedulings and their cancellations sent Petr %d emails, want 10", told-before)
	}

	rec := schedule("Tilcerovi")
	expect(t, rec, http.StatusTooManyRequests, problem.CodeRateLimited)
	if rec.Header().Get("Retry-After") == "" {
		t.Error("the refusal names no time to try again")
	}
	// Naming it with her account is the same scheduling, and is refused with it: nothing is scheduled,
	// hers included.
	expect(t, jana.deleteAccount(passphrase, h.ID), http.StatusTooManyRequests, problem.CodeRateLimited)
	if n := p.count("SELECT count(*) FROM account_deletions WHERE user_id = $1", janaID); n != 0 {
		t.Fatal("her account's deletion was scheduled without the household she named")
	}
	if at := jana.scheduledFor(h.ID); at != nil || len(p.outbox.To(address)) != told {
		t.Fatalf("past the day's five, the household is scheduled for %v and Petr has %d emails", at, len(p.outbox.To(address)))
	}

	p.clock.advance(24*time.Hour + time.Minute)
	expect(t, schedule("Tilcerovi"), http.StatusAccepted, "")
}

// A lapsed household's data is deleted when its retention has run out and its owners were warned
// three times (D-119), and not a warning sooner.
func TestALapsedHouseholdGoesWhenItsRetentionRanOut(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	lapse := func(warnings int) {
		p.exec(`UPDATE households SET billing_state = 'read_only', lapsed_at = $2, retained_until = $3, retention_warnings = $4 WHERE id = $1`,
			h.ID, p.clock.now().Add(-395*24*time.Hour), p.clock.now().Add(-time.Hour), warnings)
	}
	lapse(2)
	if p.erase(); p.count("SELECT count(*) FROM households WHERE id = $1", h.ID) != 1 {
		t.Fatal("the household went with a warning still unsent")
	}
	lapse(3)
	p.erase()
	if rows := p.rowsOf(h.ID); len(rows) != 0 {
		t.Fatalf("its retention run out, the household keeps %v", rows)
	}
	if n := p.count("SELECT count(*) FROM erasures WHERE kind = 'household' AND id = $1 AND cause = 'lapsed'", h.ID); n != 1 {
		t.Error("no tombstone of the lapsed household")
	}
}

// A member removed keeps what they held privately for 30 days (FR-PR7), and keeps it for good if
// they are back by then; a child profile removed is nothing outside its household, and its account is
// erased when the window ends (ADR 0012).
func TestAMemberRemovedIsKeptForAWindowAndAChildProfileErased(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi")
	address := p.a("petr@tilcerovi.cz")
	petr, petrID := p.joined(jana, h.ID, "Petr", address, "member", nil)
	child := jana.child(h.ID, "Tomáš", "4821", nil)
	p.probe(h.ID, map[uuid.UUID]string{janaID: "manage", petrID: "contribute"})
	own := p.item(h.ID, petrID, true, "petr.txt", "Petr's own")

	expect(t, jana.delete(householdPath(h.ID, "/members/"+petrID.String())), http.StatusNoContent, "")
	expect(t, jana.delete(householdPath(h.ID, "/members/"+child.UserID.String())), http.StatusNoContent, "")
	if n := p.count("SELECT count(*) FROM departures WHERE household_id = $1 AND cause = 'removed' AND erased_at IS NULL", h.ID); n != 2 {
		t.Fatalf("%d departures are recorded, want both", n)
	}
	if n := p.count("SELECT count(*) FROM account_deletions WHERE user_id = $1 AND cause = 'child_removed'", child.UserID); n != 1 {
		t.Fatal("the removed child profile's erasure is not scheduled")
	}
	if n := p.count("SELECT count(*) FROM account_deletions WHERE user_id = $1", petrID); n != 0 {
		t.Fatal("a removed adult's account is scheduled for deletion")
	}

	// Petr is asked back before the window ends, and keeps what he had.
	p.clock.advance(20 * 24 * time.Hour)
	jana.login(p.a("jana@tilcerovi.cz"), passphrase)
	jana.invite(h.ID, map[string]any{"kind": "email", "email": address, "role": "member"})
	petr.login(address, passphrase)
	expect(t, petr.post("/me/invitations/"+p.invitationToken(address)+"/accept", ""), http.StatusOK, "")
	p.clock.advance(10*24*time.Hour + time.Minute)
	p.erase()
	if p.count("SELECT count(*) FROM probe_items WHERE id = $1", own) != 1 {
		t.Error("back before the window ended, he lost what he kept privately")
	}
	if n := p.count("SELECT count(*) FROM departures WHERE household_id = $1 AND user_id = $2", h.ID, petrID); n != 0 {
		t.Error("the record of his leaving outlived his return")
	}
	// The child profile's account is a tombstone, and the household's log names a former member.
	var deleted *time.Time
	if err := p.admin.QueryRow(t.Context(), "SELECT deleted_at FROM users WHERE id = $1", child.UserID).Scan(&deleted); err != nil || deleted == nil {
		t.Fatalf("the child profile's account was not erased (%v)", err)
	}
	if n := p.count("SELECT count(*) FROM credentials WHERE user_id = $1", child.UserID); n != 0 {
		t.Error("the child profile's PIN was kept")
	}
	if n := p.count("SELECT count(*) FROM departures WHERE household_id = $1", h.ID); n != 0 {
		t.Errorf("%d departures are kept", n)
	}
}

// Consent is the account's, off until its user turns it on and withdrawn by leaving it out (FR-PR9);
// a child profile gives none and deletes no account (PRD 05 §7, D-104). A diagnostic bundle is kept as
// its member sent it, once, for 30 days, about a household of theirs or none (FR-PS1).
func TestConsentsAndDiagnosticBundles(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petr := p.person("Petr", p.a("petr@tilcerovi.cz"))

	type consents struct {
		Analytics      bool       `json:"analytics"`
		MarketingEmail bool       `json:"marketing_email"`
		UpdatedAt      *time.Time `json:"updated_at"`
	}
	var c consents
	decode(t, jana.get("/me/consents"), &c)
	if c != (consents{}) {
		t.Fatalf("an account that said nothing consented to %+v", c)
	}
	rec := jana.put("/me/consents", `{"analytics":true}`)
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &c)
	if !c.Analytics || c.MarketingEmail || c.UpdatedAt == nil {
		t.Fatalf("set, they read %+v", c)
	}
	c = consents{}
	decode(t, jana.put("/me/consents", `{"marketing_email":true}`), &c)
	if c.Analytics || !c.MarketingEmail {
		t.Fatalf("a consent left out was not withdrawn: %+v", c)
	}
	c = consents{}
	decode(t, petr.get("/me/consents"), &c)
	if c != (consents{}) {
		t.Fatalf("another account reads %+v", c)
	}

	// A child profile, signed in on a tablet, consents to nothing and deletes no account.
	child := jana.child(h.ID, "Tomáš", "4821", nil)
	tablet := p.phone("Tablet")
	expect(t, tablet.childLogin(h.JoinCode, child.UserID, "4821"), http.StatusOK, "")
	expect(t, tablet.send(http.MethodPut, "/me/consents", `{"analytics":true}`, nil), http.StatusForbidden, problem.CodeForbidden)
	expect(t, tablet.send(http.MethodPost, "/me/deletion", `{"password_or_confirmation":"4821"}`, nil), http.StatusForbidden, problem.CodeForbidden)
	c = consents{}
	decode(t, tablet.send(http.MethodGet, "/me/consents", "", nil), &c)
	if c != (consents{}) {
		t.Fatalf("a child profile reads %+v", c)
	}

	// A bundle, about a household of the sender's.
	id := idgen.New()
	bundle := map[string]any{
		"id": id, "screen": "sync-health", "household_id": h.ID, "ticket_reference": "HH-1042",
		// A number past 2^53, which a float64 does not hold: the bundle is kept as it was sent, not as
		// the server would write it again.
		"payload": map[string]any{
			"last_checkpoint": "184467", "queue_depth": 3, "last_op_id": int64(9007199254740993), "outcomes": []string{"conflict", "rejected"},
		},
		"redacted_fields": []string{"/payload/device_label"},
	}
	rec = jana.post("/me/diagnostics", jsonBody(t, bundle))
	expect(t, rec, http.StatusCreated, "")
	var sent struct {
		ID        uuid.UUID `json:"id"`
		ExpiresAt time.Time `json:"expires_at"`
	}
	decode(t, rec, &sent)
	if sent.ID != id || sent.ExpiresAt.Sub(p.clock.now()) != 30*24*time.Hour {
		t.Fatalf("kept as %+v", sent)
	}
	var payload json.RawMessage
	if err := p.admin.QueryRow(t.Context(), "SELECT payload FROM diagnostic_bundles WHERE id = $1 AND household_id = $2 AND redacted_fields = $3",
		id, h.ID, []string{"/payload/device_label"}).Scan(&payload); err != nil || !strings.Contains(string(payload), `"queue_depth": 3`) ||
		!strings.Contains(string(payload), `"last_op_id": 9007199254740993`) {
		t.Fatalf("the bundle is kept as %s (%v)", payload, err)
	}
	// Sent again, it is kept once and answered as it was; another's id is nobody else's to take.
	var twice struct {
		ExpiresAt time.Time `json:"expires_at"`
	}
	p.clock.advance(time.Hour)
	decode(t, jana.post("/me/diagnostics", jsonBody(t, bundle)), &twice)
	if !twice.ExpiresAt.Equal(sent.ExpiresAt) || p.count("SELECT count(*) FROM diagnostic_bundles WHERE id = $1", id) != 1 {
		t.Fatalf("sent again, it expires at %s, not %s", twice.ExpiresAt, sent.ExpiresAt)
	}
	delete(bundle, "household_id")
	if errs := fieldErrorsOf(t, petr.post("/me/diagnostics", jsonBody(t, bundle))); len(errs) != 1 || errs[0].Field != "/id" {
		t.Fatalf("another's id answered %+v", errs)
	}
	// A household the sender is no member of is not theirs to send about.
	bundle["id"], bundle["household_id"] = idgen.New(), h.ID
	if errs := fieldErrorsOf(t, petr.post("/me/diagnostics", jsonBody(t, bundle))); len(errs) != 1 || errs[0].Field != "/household_id" {
		t.Fatalf("a bundle about another's household answered %+v", errs)
	}

	// What its member took out is named, and the names are held to a size as the payload is: a bundle
	// is no way to keep whatever fits a request.
	for what, fields := range map[string][]string{
		"201 fields":               make([]string, 201),
		"a name of 201 characters": {strings.Repeat("x", 201)},
	} {
		bundle["id"], bundle["redacted_fields"] = idgen.New(), fields
		if errs := fieldErrorsOf(t, jana.post("/me/diagnostics", jsonBody(t, bundle))); len(errs) != 1 || errs[0].Field != "/redacted_fields" {
			t.Errorf("a bundle with %s answered %+v", what, errs)
		}
	}
	// An account sends twenty in a day (PRD 02 §9): Jana sent one an hour ago, and the twenty-first is
	// refused until that one is a day old, while one sent before is still answered as it was.
	bundle["redacted_fields"] = []string{}
	for i := 2; i <= 20; i++ {
		bundle["id"] = idgen.New()
		expect(t, jana.post("/me/diagnostics", jsonBody(t, bundle)), http.StatusCreated, "")
	}
	last := bundle["id"]
	bundle["id"] = idgen.New()
	rec = jana.post("/me/diagnostics", jsonBody(t, bundle))
	expect(t, rec, http.StatusTooManyRequests, problem.CodeRateLimited)
	if rec.Header().Get("Retry-After") == "" {
		t.Error("the refusal names no time to try again")
	}
	if n := p.count("SELECT count(*) FROM diagnostic_bundles WHERE id = $1", bundle["id"]); n != 0 {
		t.Error("a bundle past the day's twenty was kept")
	}
	late := bundle["id"]
	bundle["id"] = last
	expect(t, jana.post("/me/diagnostics", jsonBody(t, bundle)), http.StatusCreated, "")
	// Another account's count is its own.
	bundle["id"], bundle["household_id"] = idgen.New(), nil
	expect(t, petr.post("/me/diagnostics", jsonBody(t, bundle)), http.StatusCreated, "")
	p.clock.advance(23 * time.Hour)
	bundle["id"], bundle["household_id"] = late, h.ID
	expect(t, jana.post("/me/diagnostics", jsonBody(t, bundle)), http.StatusCreated, "")
}
