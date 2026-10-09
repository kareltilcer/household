package app_test

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// The tests in this file serve the notification transport of item 15 through the whole router,
// against the committed contract: where a member's browsers and devices are reached, what they want
// to be told, and what the household surface tells them.

// subscription is the contract's PushSubscription.
type subscription struct {
	ID         uuid.UUID `json:"id"`
	Transport  string    `json:"transport"`
	CreatedAt  time.Time `json:"created_at"`
	LastSeenAt time.Time `json:"last_seen_at"`
}

// browserKeys are a browser's subscription keys: an uncompressed P-256 point and 16 bytes of secret.
func browserKeys() map[string]string {
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		panic(err)
	}
	return map[string]string{
		"p256dh": base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()),
		"auth":   base64.RawURLEncoding.EncodeToString([]byte("0123456789abcdef")),
	}
}

// offCurve are subscription keys whose p256dh is 65 bytes of an uncompressed point's form, which is
// on no curve: no push could be encrypted to it.
func offCurve() map[string]string {
	point := append([]byte{4}, make([]byte, 64)...)
	point[1] = 7
	keys := browserKeys()
	keys["p256dh"] = base64.RawURLEncoding.EncodeToString(point)
	return keys
}

// subscribe subscribes the browser at a push service endpoint of its own, and returns the endpoint.
func (b *browser) subscribe() string {
	b.s.t.Helper()
	endpoint := "https://" + apptest.PushHost + "/send/" + idgen.New().String()
	rec := b.post("/push/subscriptions", jsonBody(b.s.t, map[string]any{"transport": "web_push", "endpoint": endpoint, "keys": browserKeys()}))
	expect(b.s.t, rec, http.StatusCreated, "")
	return endpoint
}

func TestTheVAPIDKeyIsTheOneTheServerSignsWith(t *testing.T) {
	s := newSite(t, apptest.Options{})
	rec := s.signUp(s.a("jana@tilcerovi.cz"), passphrase).get("/push/vapid-key")
	expect(t, rec, http.StatusOK, "")
	var body struct {
		Key string `json:"key"`
	}
	decode(t, rec, &body)
	want, err := notify.VAPIDPublicKey(apptest.VAPIDKey)
	if err != nil {
		t.Fatal(err)
	}
	if body.Key != want {
		t.Fatalf("key %q; want %q", body.Key, want)
	}
	expect(t, s.browser().get("/push/vapid-key"), http.StatusUnauthorized, problem.CodeUnauthenticated)
}

// A browser registers its Web Push subscription from its web session, once per endpoint, at a push
// service the server knows; a phone registers its Expo token from its own sign-in. Removing either
// answers 204 whether or not it was there.
func TestRegisteringWhereAMemberIsReached(t *testing.T) {
	s := newSite(t, apptest.Options{})
	jana := s.signUp(s.a("jana@tilcerovi.cz"), passphrase)
	endpoint := "https://" + apptest.PushHost + "/send/" + idgen.New().String()
	body := jsonBody(t, map[string]any{"transport": "web_push", "endpoint": endpoint, "keys": browserKeys()})
	rec := jana.post("/push/subscriptions", body)
	expect(t, rec, http.StatusCreated, "")
	var first subscription
	decode(t, rec, &first)
	if first.Transport != "web_push" || first.ID == uuid.Nil {
		t.Fatalf("the subscription: %+v", first)
	}
	rec = jana.post("/push/subscriptions", body)
	expect(t, rec, http.StatusOK, "")
	var again subscription
	decode(t, rec, &again)
	if again.ID != first.ID {
		t.Fatalf("registering again made another: %v, %v", first.ID, again.ID)
	}
	// The session's browser, subscribed anew at another endpoint, holds that subscription alone.
	next := "https://" + apptest.PushHost + "/send/" + idgen.New().String()
	expect(t, jana.post("/push/subscriptions", jsonBody(t, map[string]any{"transport": "web_push", "endpoint": next, "keys": browserKeys()})),
		http.StatusCreated, "")
	var before, after int
	if err := s.admin.QueryRow(t.Context(), `
		SELECT count(*) FILTER (WHERE endpoint = $1), count(*) FILTER (WHERE endpoint = $2) FROM push_subscriptions`,
		endpoint, next).Scan(&before, &after); err != nil {
		t.Fatal(err)
	}
	if before != 0 || after != 1 {
		t.Fatalf("the session's subscriptions: %d at the endpoint before, %d at the next; want 0 and 1", before, after)
	}
	endpoint = next

	for _, bad := range []map[string]any{
		{"transport": "web_push", "endpoint": "https://attacker.example/push", "keys": browserKeys()},
		{"transport": "web_push", "endpoint": "http://" + apptest.PushHost + "/send/1", "keys": browserKeys()},
		{"transport": "web_push", "endpoint": "https://user:pw@" + apptest.PushHost + "/send/1", "keys": browserKeys()},
		// A scheme no browser spells, which the table would refuse.
		{"transport": "web_push", "endpoint": "HTTPS://" + apptest.PushHost + "/send/4", "keys": browserKeys()},
		{"transport": "web_push", "endpoint": "https://" + apptest.PushHost + "/send/2", "keys": map[string]string{"p256dh": "AAAA", "auth": "AAAA"}},
		{"transport": "web_push", "endpoint": "https://" + apptest.PushHost + "/send/5", "keys": offCurve()},
		{"transport": "web_push", "endpoint": "https://" + apptest.PushHost + "/send/3"},
		// A browser's sign-in is reached through its subscription, not a device's token.
		{"transport": "expo", "endpoint": "ExponentPushToken[abc]"},
	} {
		expect(t, jana.post("/push/subscriptions", jsonBody(t, bad)), http.StatusUnprocessableEntity, problem.CodeValidationFailed)
	}

	phone := s.phone("Jana's phone")
	expect(t, phone.login(s.a("jana@tilcerovi.cz"), passphrase), http.StatusOK, "")
	token := "ExponentPushToken[" + strings.ReplaceAll(idgen.New().String(), "-", "") + "]"
	register := func(token string, device any) int {
		t.Helper()
		fields := map[string]any{"transport": "expo", "endpoint": token}
		if device != nil {
			fields["device_id"] = device
		}
		return phone.send(http.MethodPost, "/push/subscriptions", jsonBody(t, fields), nil).Code
	}
	if code := register(token, phone.id); code != http.StatusCreated {
		t.Fatalf("a phone's token: %d", code)
	}
	if code := register(token, nil); code != http.StatusOK {
		t.Fatalf("the same token again: %d", code)
	}
	for _, bad := range []struct {
		token  string
		device any
	}{{"not-a-token", nil}, {token, idgen.New()}} {
		if code := register(bad.token, bad.device); code != http.StatusUnprocessableEntity {
			t.Errorf("token %q for device %v: %d", bad.token, bad.device, code)
		}
	}
	pushEnabled := func() bool {
		t.Helper()
		rec := phone.send(http.MethodGet, "/me/devices", "", nil)
		expect(t, rec, http.StatusOK, "")
		var devices struct {
			Items []struct {
				ID          uuid.UUID `json:"id"`
				PushEnabled bool      `json:"push_enabled"`
			} `json:"items"`
		}
		decode(t, rec, &devices)
		if len(devices.Items) != 1 {
			t.Fatalf("the devices: %+v", devices.Items)
		}
		return devices.Items[0].PushEnabled
	}
	if !pushEnabled() {
		t.Fatal("a registered token is not push_enabled")
	}
	// A token five failures marked stale is not pushed to, and says so, until it is registered again.
	if _, err := s.admin.Exec(t.Context(), "UPDATE devices SET push_failures = 5, push_stale_at = now() WHERE push_token = $1", token); err != nil {
		t.Fatal(err)
	}
	if pushEnabled() {
		t.Fatal("a stale token is push_enabled")
	}
	if code := register(token, nil); code != http.StatusOK || !pushEnabled() {
		t.Fatalf("registered again: %d, push_enabled %v", code, pushEnabled())
	}

	// The profiles signed in on one installation, a shared tablet's, each keep its token (D-104); the
	// app installed again on the phone registers it from an installation of its own, which takes it
	// from every installation before, whoever signed in there.
	holders := func() []uuid.UUID {
		t.Helper()
		rows, err := s.admin.Query(t.Context(), "SELECT id FROM devices WHERE push_token = $1 ORDER BY user_id", token)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var ids []uuid.UUID
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				t.Fatal(err)
			}
			ids = append(ids, id)
		}
		return ids
	}
	s.signUp(s.a("petr@tilcerovi.cz"), passphrase)
	tablet := s.phone("Jana's phone")
	tablet.id = phone.id
	expect(t, tablet.login(s.a("petr@tilcerovi.cz"), passphrase), http.StatusOK, "")
	if code := tablet.send(http.MethodPost, "/push/subscriptions", jsonBody(t, map[string]any{"transport": "expo", "endpoint": token}), nil).Code; code != http.StatusCreated {
		t.Fatalf("another profile's token on the installation: %d", code)
	}
	if ids := holders(); len(ids) != 2 || ids[0] != phone.id || ids[1] != phone.id {
		t.Fatalf("the installation's profiles hold the token on %v; want both on %v", ids, phone.id)
	}
	reinstalled := s.phone("Jana's phone")
	expect(t, reinstalled.login(s.a("jana@tilcerovi.cz"), passphrase), http.StatusOK, "")
	if code := reinstalled.send(http.MethodPost, "/push/subscriptions", jsonBody(t, map[string]any{"transport": "expo", "endpoint": token}), nil).Code; code != http.StatusCreated {
		t.Fatalf("the token from the app installed again: %d", code)
	}
	if ids := holders(); len(ids) != 1 || ids[0] != reinstalled.id {
		t.Fatalf("the token is held on %v; want the installation that registered it last, %v, alone", ids, reinstalled.id)
	}

	expect(t, jana.delete("/push/subscriptions?endpoint="+url.QueryEscape(endpoint)), http.StatusNoContent, "")
	expect(t, jana.delete("/push/subscriptions?endpoint="+url.QueryEscape(endpoint)), http.StatusNoContent, "")
	expect(t, phone.send(http.MethodDelete, "/push/subscriptions?endpoint="+url.QueryEscape(token), "", nil), http.StatusNoContent, "")
	var left int
	if err := s.admin.QueryRow(t.Context(), `
		SELECT (SELECT count(*) FROM push_subscriptions WHERE endpoint = $1) + (SELECT count(*) FROM devices WHERE push_token = $2)`,
		endpoint, token).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Fatalf("%d targets left after removing both", left)
	}
}

// preferences is the contract's NotificationPreferences.
type preferences struct {
	HouseholdID *uuid.UUID      `json:"household_id"`
	Enabled     bool            `json:"enabled"`
	Categories  map[string]bool `json:"categories"`
	QuietHours  *struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"quiet_hours"`
}

func (b *browser) preferences(query string) preferences {
	b.s.t.Helper()
	rec := b.get("/me/notification-preferences" + query)
	expect(b.s.t, rec, http.StatusOK, "")
	var p preferences
	decode(b.s.t, rec, &p)
	return p
}

// A member's preferences are their account's in every household until they set their own there, and
// their own there from then on; a household they are not in is not found, and what is not a category
// or not two different times of day is refused.
func TestAMembersPreferences(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	in := "?household_id=" + h.ID.String()

	p := jana.preferences("")
	if p.HouseholdID != nil || !p.Enabled || len(p.Categories) != 4 || !p.Categories["digest"] || p.QuietHours != nil {
		t.Fatalf("the built-in defaults: %+v", p)
	}
	rec := jana.patch("/me/notification-preferences", `{"categories": {"digest": false}, "quiet_hours": {"from": "22:00", "to": "07:00"}}`, nil)
	expect(t, rec, http.StatusOK, "")
	p = jana.preferences(in)
	if p.HouseholdID == nil || *p.HouseholdID != h.ID || p.Categories["digest"] || p.QuietHours == nil || p.QuietHours.From != "22:00" {
		t.Fatalf("the household's, before it has its own: %+v", p)
	}

	expect(t, jana.patch("/me/notification-preferences"+in, `{"enabled": false, "quiet_hours": null}`, nil), http.StatusOK, "")
	expect(t, jana.patch("/me/notification-preferences", `{"categories": {"direct": false}}`, nil), http.StatusOK, "")
	p = jana.preferences(in)
	if p.Enabled || p.QuietHours != nil || p.Categories["digest"] || !p.Categories["direct"] {
		t.Fatalf("the household's own, which the account's no longer change: %+v", p)
	}
	if a := jana.preferences(""); !a.Enabled || a.Categories["direct"] || a.QuietHours == nil {
		t.Fatalf("the account's: %+v", a)
	}

	petr := s.person("Petr", s.a("petr@tilcerovi.cz"))
	expect(t, petr.get("/me/notification-preferences"+in), http.StatusNotFound, problem.CodeNotFound)
	expect(t, petr.patch("/me/notification-preferences"+in, `{"enabled": false}`, nil), http.StatusNotFound, problem.CodeNotFound)
	for _, bad := range []string{
		`{"categories": {"chat": false}}`,
		`{"quiet_hours": {"from": "22:00"}}`,
		`{"quiet_hours": {"from": "7:00", "to": "08:00"}}`,
		`{"quiet_hours": {"from": "24:00", "to": "08:00"}}`,
		`{"quiet_hours": {"from": "08:00", "to": "08:00"}}`,
	} {
		expect(t, jana.patch("/me/notification-preferences", bad, nil), http.StatusUnprocessableEntity, problem.CodeValidationFailed)
	}
	// Every field that is wrong is named at once, quiet hours that are no window among them.
	both := fieldErrorsOf(t, jana.patch("/me/notification-preferences",
		`{"categories": {"chat": false}, "quiet_hours": {"from": "08:00", "to": "08:00"}}`, nil))
	if fmt.Sprint(both) != "[{/categories/chat invalid} {/quiet_hours/to invalid}]" {
		t.Fatalf("named: %v", both)
	}
}

// Two changes to a member's preferences at once both hold: the second waits for the first and applies
// its own to what the first wrote, rather than writing back what it read before.
func TestTwoPreferenceChangesAtOnceBothHold(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	user := jana.me().ID
	for _, c := range []struct{ query, table, where string }{
		{"", "notification_defaults", "user_id = $1"},
		{"?household_id=" + h.ID.String(), "notification_preferences", "user_id = $1 AND household_id = '" + h.ID.String() + "'"},
	} {
		expect(t, jana.patch("/me/notification-preferences"+c.query, `{"enabled": true, "categories": {"digest": false, "direct": true}}`, nil),
			http.StatusOK, "")
		// The first change, under way: it has written the row and not yet committed.
		first, err := s.admin.Begin(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := first.Exec(t.Context(), "UPDATE "+c.table+" SET direct = false WHERE "+c.where, user); err != nil {
			t.Fatal(err)
		}
		second := make(chan int, 1)
		go func() {
			second <- jana.patch("/me/notification-preferences"+c.query, `{"enabled": false}`, nil).Code
		}()
		for deadline, waiting := time.Now().Add(10*time.Second), 0; waiting == 0; {
			if err := s.admin.QueryRow(t.Context(), `
				SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`).
				Scan(&waiting); err != nil {
				t.Fatal(err)
			}
			if waiting == 0 && time.Now().After(deadline) {
				_ = first.Rollback(t.Context())
				t.Fatalf("the second change did not wait for the first: %d", <-second)
			}
			if waiting == 0 {
				time.Sleep(10 * time.Millisecond)
			}
		}
		if err := first.Commit(t.Context()); err != nil {
			t.Fatal(err)
		}
		if code := <-second; code != http.StatusOK {
			t.Fatalf("the second change: %d", code)
		}
		if p := jana.preferences(c.query); p.Enabled || p.Categories["direct"] || p.Categories["digest"] {
			t.Fatalf("after both changes%s: %+v", c.query, p)
		}
	}
}

// A member is told when their access changes (D-78): by a push when their grants or their role
// change, those an owner makes in the minutes after the first merging into one, and by email when
// they are removed.
func TestAMemberIsToldWhenTheirAccessChanges(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petrs, petr := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	petrs.subscribe()

	change := func(level string) {
		t.Helper()
		version := jana.members(h.ID)["Petr"].Version
		rec := jana.patch(householdPath(h.ID, "/members/"+petr.String()), `{"grants": {"finance": "`+level+`"}}`,
			http.Header{"If-Match": {fmt.Sprintf("%q", strconv.FormatInt(version, 10))}})
		expect(t, rec, http.StatusOK, "")
	}
	change("view")
	told := s.pushes.To(petr)
	if len(told) != 1 || told[0].Push.Title != "Your access in Tilcerovi changed" || !told[0].Push.Urgent {
		t.Fatalf("Petr was told: %+v", told)
	}
	change("contribute")
	change("none")
	if n := len(s.pushes.To(petr)); n != 1 {
		t.Fatalf("the changes after the first were pushed at once: %d pushes", n)
	}
	var count int
	var due time.Time
	if err := s.admin.QueryRow(t.Context(), `
		SELECT count, run_at FROM notifications WHERE household_id = $1 AND user_id = $2 AND status = 'queued'`, h.ID, petr).
		Scan(&count, &due); err != nil {
		t.Fatal(err)
	}
	if count != 2 || time.Until(due) < 10*time.Minute {
		t.Fatalf("the later changes wait as one: count %d, due in %s", count, time.Until(due))
	}

	expect(t, jana.delete(householdPath(h.ID, "/members/"+petr.String())), http.StatusNoContent, "")
	mail := s.outbox.To(s.a("petr@tilcerovi.cz"))
	if last := mail[len(mail)-1]; last.Subject != "You were removed from Tilcerovi on Household" {
		t.Fatalf("Petr was emailed: %+v", last)
	}
}

// An owner who changes their own role, as one of two owners may, is not told of what they just did.
func TestAnOwnerIsNotToldOfTheirOwnChange(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petrs, petr := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "owner", nil)
	petrs.subscribe()
	expect(t, petrs.patch(householdPath(h.ID, "/members/"+petr.String()), `{"role": "member"}`, nil), http.StatusOK, "")
	if m := jana.members(h.ID)["Petr"]; m.Role != "member" {
		t.Fatalf("Petr: %+v", m)
	}
	if told := s.pushes.To(petr); len(told) != 0 {
		t.Fatalf("Petr was told of his own change: %+v", told)
	}
}

// A child profile's graduation email that waits for the mail server goes with the profile: removing it
// spends its link, and nothing arrives once the mail server takes mail again.
func TestARemovedChildProfilesGraduationEmailGoesWithIt(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	adam := jana.child(h.ID, "Adam", "1234", nil)
	address := s.a("adam@tilcerovi.cz")
	s.outbox.Refuse(1)
	expect(t, jana.post(householdPath(h.ID, "/children/"+adam.UserID.String()+"/graduate"), jsonBody(t, map[string]string{"email": address})),
		http.StatusAccepted, "")
	expect(t, jana.delete(householdPath(h.ID, "/members/"+adam.UserID.String())), http.StatusNoContent, "")
	if _, err := s.admin.Exec(t.Context(), "UPDATE notifications SET run_at = now() WHERE household_id = $1 AND status = 'queued'", h.ID); err != nil {
		t.Fatal(err)
	}
	s.notifier.Drain(t.Context(), h.ID)
	if n := len(s.outbox.To(address)); n != 0 {
		t.Fatalf("the removed profile's graduation was emailed %d times", n)
	}
	if n := s.count("SELECT count(*) FROM email_tokens WHERE user_id = $1 AND purpose = 'graduate' AND used_at IS NULL", adam.UserID); n != 0 {
		t.Fatalf("%d of the removed profile's links still work", n)
	}
}

// The owners are told when ten wrong PINs lock a child profile (A-18), whoever else is in the
// household.
func TestTheOwnersAreToldWhenAChildProfileLocks(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	janaID := jana.me().ID
	jana.subscribe()
	petrs, petr := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	petrs.subscribe()
	adam := jana.child(h.ID, "Adam", "1234", nil)
	phone := s.phone("Adam's phone")
	for range household.LockAfter {
		phone.childLogin(h.JoinCode, adam.UserID, "0000")
	}
	told := s.pushes.To(janaID)
	if len(told) != 1 || told[0].Push.Title != "Adam’s profile is locked" ||
		told[0].Push.Link != "/households/"+h.ID.String()+"/settings/members/"+adam.UserID.String() {
		t.Fatalf("Jana was told: %+v", told)
	}
	if n := len(s.pushes.To(petr)); n != 0 {
		t.Fatalf("Petr, who is not an owner, was told %d times", n)
	}
}

// An invitation's email carries its link, whose token waited sealed and is gone from the queue once
// the email went; the delivery log keeps its subject, never its body.
func TestAnInvitationsTokenIsNotKeptOnceSent(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	address := s.a("petr@tilcerovi.cz")
	jana.invite(h.ID, map[string]any{"kind": "email", "email": address, "role": "member"})
	token := s.invitationToken(address)
	var (
		left              int
		subject, body     *string
		status, transport string
	)
	if err := s.admin.QueryRow(t.Context(), `
		SELECT (SELECT count(*) FROM notifications WHERE household_id = $1 AND (secret IS NOT NULL OR address IS NOT NULL)),
		  d.title, d.body, d.status::text, d.transport::text
		FROM notification_deliveries d WHERE d.household_id = $1`, h.ID).Scan(&left, &subject, &body, &status, &transport); err != nil {
		t.Fatal(err)
	}
	// In the household's language, since the address has no account whose language it would be.
	sent := s.outbox.To(address)
	if left != 0 || subject == nil || len(sent) == 0 || *subject != sent[len(sent)-1].Subject || body != nil ||
		status != "sent" || transport != "email" || token == "" {
		t.Fatalf("kept: %d, logged %q %v %s %s", left, *subject, body, status, transport)
	}
}

// An invitation's email that waits for the mail server goes with its invitation: sending it again
// replaces it, so that only the new link arrives, and withdrawing it withdraws it, so that nothing
// invites anyone once the mail server takes mail again.
func TestAnInvitationsWaitingEmailGoesWithIt(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petr, klara := s.a("petr@tilcerovi.cz"), s.a("klara@tilcerovi.cz")
	later := func() {
		t.Helper()
		if _, err := s.admin.Exec(t.Context(), "UPDATE notifications SET run_at = now() WHERE household_id = $1 AND status = 'queued'", h.ID); err != nil {
			t.Fatal(err)
		}
		s.notifier.Drain(t.Context(), h.ID)
	}

	s.outbox.Refuse(1)
	sent := jana.invite(h.ID, map[string]any{"kind": "email", "email": petr, "role": "member"})
	if n := len(s.outbox.To(petr)); n != 0 {
		t.Fatalf("%d emails while the mail server refused them", n)
	}
	expect(t, jana.post(householdPath(h.ID, "/invitations/"+sent.ID.String()+"/resend"), ""), http.StatusAccepted, "")
	later()
	if n := len(s.outbox.To(petr)); n != 1 {
		t.Fatalf("Petr was emailed %d times; want the new link alone", n)
	}
	expect(t, s.browser().get("/me/invitations/"+s.invitationToken(petr)), http.StatusOK, "")

	s.outbox.Refuse(1)
	withdrawn := jana.invite(h.ID, map[string]any{"kind": "email", "email": klara, "role": "member"})
	expect(t, jana.delete(householdPath(h.ID, "/invitations/"+withdrawn.ID.String())), http.StatusNoContent, "")
	later()
	if n := len(s.outbox.To(klara)); n != 0 {
		t.Fatalf("Klára was emailed a withdrawn invitation %d times", n)
	}
}

// An invitation that stopped working a month ago is deleted, through the spine, so that its deletion
// reaches every replica and the activity log records it (D-110); one that ended less long ago, or one
// still waiting, is kept.
func TestEndedInvitationsAreDeletedAMonthOn(t *testing.T) {
	s, _ := newHouseholdSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	invite := func(address string) uuid.UUID {
		return jana.invite(h.ID, map[string]any{"kind": "email", "email": s.a(address), "role": "member"}).ID
	}
	expired, declined, recent, waiting := invite("old@example.com"), invite("no@example.com"), invite("new@example.com"), invite("yes@example.com")
	nos := s.unverified("No", s.a("no@example.com"))
	expect(t, nos.post("/me/invitations/"+s.invitationToken(s.a("no@example.com"))+"/decline", ""), http.StatusNoContent, "")
	// Backdated past the triggers that keep updated_at, as a month would leave them.
	tx, err := s.admin.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		"SET LOCAL session_replication_role = replica",
		"UPDATE invitations SET expires_at = now() - interval '31 days' WHERE id = '" + expired.String() + "'",
		"UPDATE invitations SET updated_at = now() - interval '31 days' WHERE id = '" + declined.String() + "'",
		"UPDATE invitations SET updated_at = now() - interval '29 days' WHERE id = '" + recent.String() + "'",
		"UPDATE invitations SET updated_at = now() - interval '40 days' WHERE id = '" + waiting.String() + "'",
	} {
		if _, err := tx.Exec(t.Context(), statement); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	registry, err := module.NewRegistry()
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := registry.WithPlatform(household.Admin())
	if err != nil {
		t.Fatal(err)
	}
	n, err := s.households.PurgeInvitations(t.Context(), testsupport.Open(t).Pool(t, db.RoleMeter), catalog)
	if err != nil || n != 2 {
		t.Fatalf("purged %d: %v", n, err)
	}
	var left []uuid.UUID
	var events int
	if err := s.admin.QueryRow(t.Context(), `
		SELECT array(SELECT id FROM invitations WHERE household_id = $1 ORDER BY id),
		  (SELECT count(*) FROM audit_events WHERE household_id = $1 AND module = 'admin' AND action = 'invitation.purge')`, h.ID).
		Scan(&left, &events); err != nil {
		t.Fatal(err)
	}
	want := []uuid.UUID{recent, waiting}
	slices.SortFunc(want, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	if !slices.Equal(left, want) || events != 2 {
		t.Fatalf("left %v (want %v), %d events", left, want, events)
	}
}
