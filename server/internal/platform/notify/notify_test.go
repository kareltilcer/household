package notify_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/localtime"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/mfa"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

func TestMain(m *testing.M) { testsupport.Main(m) }

// pushed is a push the tests' push services took, with the ticket it was answered with.
type pushed struct {
	target notify.Target
	push   notify.Push
	ticket string
}

// pushes keep the pushes sent, Web Push's and Expo's alike, and answer each as answer says: accepted,
// with a ticket for Expo, when it is nil.
type pushes struct {
	mu       sync.Mutex
	sent     []pushed
	answer   func(notify.Target) notify.Outcome
	receipts map[string]notify.Status
	// unread, when set, is how Expo's getReceipts fails.
	unread error
}

func (p *pushes) Push(_ context.Context, t notify.Target, m notify.Push) notify.Outcome {
	p.mu.Lock()
	defer p.mu.Unlock()
	o := notify.Outcome{Status: notify.Accepted}
	if p.answer != nil {
		o = p.answer(t)
	} else if t.Transport == "expo" {
		o.Ticket = "ticket-" + idgen.New().String()
	}
	p.sent = append(p.sent, pushed{target: t, push: m, ticket: o.Ticket})
	return o
}

func (p *pushes) Receipts(_ context.Context, tickets []string) (map[string]notify.Status, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.unread != nil {
		return nil, p.unread
	}
	out := map[string]notify.Status{}
	for _, t := range tickets {
		if s, ok := p.receipts[t]; ok {
			out[t] = s
		}
	}
	return out, nil
}

func (p *pushes) to(user uuid.UUID) []pushed {
	p.mu.Lock()
	defer p.mu.Unlock()
	var out []pushed
	for _, s := range p.sent {
		if s.target.User == user {
			out = append(out, s)
		}
	}
	return out
}

// mailbox keeps the email sent, and refuses the next fail of them; during, when set, runs as each is
// handed to it, and then after each it took.
type mailbox struct {
	mu     sync.Mutex
	sent   []mail.Message
	fail   int
	during func()
	then   func()
}

func (m *mailbox) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	during := m.during
	m.mu.Unlock()
	if during != nil {
		during()
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail > 0 {
		m.fail--
		return errors.New("the mail server is down")
	}
	m.sent = append(m.sent, msg)
	if m.then != nil {
		m.then()
	}
	return nil
}

func (m *mailbox) all() []mail.Message {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]mail.Message(nil), m.sent...)
}

// clock is a time a test moves by hand: the clock quiet hours are read on.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) set(t time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = t
}

var keys = func() *mfa.Keys {
	k, err := mfa.NewKeys(bytes.Repeat([]byte{3}, 32))
	if err != nil {
		panic(err)
	}
	return k
}()

// world is one test's notification transport and the database it delivers from.
type world struct {
	t      *testing.T
	admin  *pgxpool.Pool
	app    *pgxpool.Pool
	pushes *pushes
	mail   *mailbox
	clock  *clock
	s      *notify.Service
}

func newWorld(t *testing.T) *world {
	t.Helper()
	d := testsupport.Open(t)
	catalogs, err := i18n.Default()
	if err != nil {
		t.Fatal(err)
	}
	web, _ := url.Parse("https://app.household.test")
	w := &world{t: t, admin: d.Pool(t, ""), app: d.Pool(t, db.RoleApp), pushes: &pushes{receipts: map[string]notify.Status{}},
		mail: &mailbox{}, clock: &clock{t: time.Now()}}
	w.s, err = notify.New(notify.Config{
		Pool: w.app, Meter: d.Pool(t, db.RoleMeter), Log: logging.New(io.Discard, slog.LevelDebug),
		Catalogs: catalogs, WebURL: web, Keys: keys, WebPush: w.pushes, Expo: w.pushes, Receipts: w.pushes, Mail: w.mail,
		VAPIDKey: "key", Now: w.clock.now, Poll: 20 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	return w
}

func (w *world) exec(sql string, args ...any) {
	w.t.Helper()
	if _, err := w.admin.Exec(w.t.Context(), sql, args...); err != nil {
		w.t.Fatal(err)
	}
}

// household is a household, in Prague, with every module enabled.
func (w *world) household() uuid.UUID {
	w.t.Helper()
	h := idgen.New()
	w.exec(testsupport.InsertHousehold, h)
	w.exec(`INSERT INTO module_enablement (id, household_id, module, enabled) SELECT gen_random_uuid(), $1, id, true FROM modules`, h)
	return h
}

// user is an English-speaking user with a verified address.
func (w *world) user(name string) uuid.UUID {
	w.t.Helper()
	u := idgen.New()
	w.exec(`INSERT INTO users (id, email, email_verified_at, display_name, locale) VALUES ($1, $2, now(), $3, 'en')`,
		u, strings.ToLower(name)+"-"+u.String()+"@example.test", name)
	return u
}

// member makes u a member of h with role, holding levels on the modules they name.
func (w *world) member(h, u uuid.UUID, role string, levels map[string]string) {
	w.t.Helper()
	w.exec(testsupport.InsertMember, h, u, role)
	for module, level := range levels {
		w.exec(`INSERT INTO module_grants (household_id, user_id, module, level) VALUES ($1, $2, $3, $4)`, h, u, module, level)
	}
}

// browser is a browser u is signed in on, subscribed for Web Push; it returns the subscription.
func (w *world) browser(u uuid.UUID) uuid.UUID {
	w.t.Helper()
	session, sub := idgen.New(), idgen.New()
	w.exec(`INSERT INTO sessions (id, user_id, token_hash, csrf_hash, expires_at)
	        VALUES ($1, $2, $3, $3, now() + interval '30 days')`, session, u, idgen.New().String()[:32])
	w.exec(`INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4, $5, $6)`,
		sub, u, session, "https://push.example/"+sub.String(), strings.Repeat("A", 87), strings.Repeat("B", 22))
	return sub
}

// phone is a device u is signed in on, with an Expo token; it returns the device and the token.
func (w *world) phone(u uuid.UUID) (uuid.UUID, string) {
	w.t.Helper()
	device := idgen.New()
	token := "ExponentPushToken[" + device.String() + "]"
	w.exec(`INSERT INTO devices (user_id, id, push_token, push_registered_at) VALUES ($1, $2, $3, now())`, u, device, token)
	w.exec(`INSERT INTO device_sessions (id, user_id, device_id) VALUES ($1, $2, $3)`, idgen.New(), u, device)
	return device, token
}

// send queues ns in h, and delivers what is due there.
func (w *world) send(h uuid.UUID, ns ...notify.Notification) {
	w.t.Helper()
	if err := w.s.Send(w.t.Context(), h, ns...); err != nil {
		w.t.Fatal(err)
	}
	w.s.Drain(w.t.Context(), h)
}

// queued is a notification as the administrator reads it.
type queued struct {
	id                uuid.UUID
	status            string
	reason            *string
	runAt             time.Time
	attempts, count   int
	sealed, addressed bool
}

// notifications are h's notifications, oldest first.
func (w *world) notifications(h uuid.UUID) []queued {
	w.t.Helper()
	rows, err := w.admin.Query(w.t.Context(), `
		SELECT id, status::text, reason, run_at, attempts, count, secret IS NOT NULL, address IS NOT NULL
		FROM notifications WHERE household_id = $1 ORDER BY created_at, id`, h)
	if err != nil {
		w.t.Fatal(err)
	}
	defer rows.Close()
	var out []queued
	for rows.Next() {
		var q queued
		if err := rows.Scan(&q.id, &q.status, &q.reason, &q.runAt, &q.attempts, &q.count, &q.sealed, &q.addressed); err != nil {
			w.t.Fatal(err)
		}
		out = append(out, q)
	}
	return out
}

// delivery is a row of the delivery log.
type delivery struct {
	transport, status, reason string
	title, body               *string
	kept                      *time.Time
}

func (w *world) deliveries(h uuid.UUID) []delivery {
	w.t.Helper()
	rows, err := w.admin.Query(w.t.Context(), `
		SELECT coalesce(transport::text, ''), status::text, coalesce(reason, ''), title, body, body_expires_at
		FROM notification_deliveries WHERE household_id = $1 ORDER BY sent_at, transport NULLS FIRST, id`, h)
	if err != nil {
		w.t.Fatal(err)
	}
	defer rows.Close()
	var out []delivery
	for rows.Next() {
		var d delivery
		if err := rows.Scan(&d.transport, &d.status, &d.reason, &d.title, &d.body, &d.kept); err != nil {
			w.t.Fatal(err)
		}
		out = append(out, d)
	}
	return out
}

func (w *world) one(h uuid.UUID) queued {
	w.t.Helper()
	all := w.notifications(h)
	if len(all) != 1 {
		w.t.Fatalf("%d notifications; want one: %+v", len(all), all)
	}
	return all[0]
}

func (q queued) why() string {
	if q.reason == nil {
		return ""
	}
	return *q.reason
}

// withdraw withdraws what waits in h under key, as a cause's transaction does.
func (w *world) withdraw(h uuid.UUID, key string) {
	w.t.Helper()
	scoped := tenant.Assume(w.t.Context(), w.app, h, uuid.Nil, "")
	if err := tenant.InWriteTx(scoped, func(tx pgx.Tx) error { return w.s.Withdraw(scoped, tx, key) }); err != nil {
		w.t.Fatal(err)
	}
}

// due moves h's waiting notifications to now, for a test that has moved the clock past their time.
func (w *world) due(h uuid.UUID) {
	w.t.Helper()
	w.exec("UPDATE notifications SET run_at = now() WHERE household_id = $1 AND status = 'queued'", h)
}

func accessChanged(to uuid.UUID) notify.Notification {
	return notify.Notification{To: to, Category: notify.Direct, Message: "notification.access_changed", Link: "/households"}
}

// A push goes to each of its recipient's browsers and devices, rendered in their language with the
// household's name, and every attempt is logged with what it said, kept for seven days.
func TestAPushReachesEveryTargetAndIsLogged(t *testing.T) {
	w := newWorld(t)
	h, jana := w.household(), w.user("Jana")
	w.member(h, jana, "member", nil)
	w.browser(jana)
	device, token := w.phone(jana)

	w.send(h, accessChanged(jana))
	// Pushed at once, in whichever order their push services answer.
	got := w.pushes.to(jana)
	slices.SortFunc(got, func(a, b pushed) int { return strings.Compare(a.target.Transport, b.target.Transport) })
	if len(got) != 2 || got[0].push.Title != "Your access in Test changed" || got[0].push.Link != "/households" ||
		got[0].target.Transport != "expo" || got[0].target.Token != token || got[1].target.Transport != "web_push" {
		t.Fatalf("pushed: %+v", got)
	}
	if q := w.one(h); q.status != "sent" || q.reason != nil {
		t.Fatalf("the notification: %+v", q)
	}
	logged := w.deliveries(h)
	if len(logged) != 2 {
		t.Fatalf("logged: %+v", logged)
	}
	for _, d := range logged {
		if d.status != "sent" || d.title == nil || *d.title != "Your access in Test changed" || d.body == nil || d.kept == nil ||
			time.Until(*d.kept) < 6*24*time.Hour {
			t.Errorf("logged: %+v", d)
		}
	}
	var (
		tickets int
		args    time.Time
	)
	if err := w.admin.QueryRow(t.Context(), `
		SELECT (SELECT count(*) FROM push_receipts WHERE device_id = $1), (SELECT args_expires_at FROM notifications WHERE household_id = $2)`,
		device, h).Scan(&tickets, &args); err != nil {
		t.Fatal(err)
	}
	if tickets != 1 {
		t.Fatalf("%d Expo tickets wait for their receipts; want 1", tickets)
	}
	// What it was rendered from is kept as long as what it said.
	if until := time.Until(args); until < 6*24*time.Hour || until > 8*24*time.Hour {
		t.Fatalf("its arguments are kept until %s", args)
	}
}

// Quiet hours hold a push until they end, on the member's own clock, and drop nothing; an email of the
// fixed set goes whatever the hour (FR-NT1, FR-NT2).
func TestQuietHoursDeferDelivery(t *testing.T) {
	w := newWorld(t)
	h, jana := w.household(), w.user("Jana")
	w.member(h, jana, "member", nil)
	w.browser(jana)
	// Quiet from an hour ago to two hours from now in Prague, the household's timezone, which Jana
	// follows: read on the real clock, since the database's decides what is due.
	prague := localtime.Zone("Europe/Prague")
	now := time.Now()
	local := localtime.Of(now.In(prague))
	quiet := localtime.Window{From: (local - 60 + localtime.Day) % localtime.Day, To: (local + 120) % localtime.Day}
	w.exec(`INSERT INTO notification_preferences (household_id, user_id, enabled, direct, household, reminders, digest, quiet_from, quiet_to)
	        VALUES ($1, $2, true, true, true, true, true, $3, $4)`, h, jana, quiet.From.String(), quiet.To.String())
	w.clock.set(now)

	w.send(h, accessChanged(jana))
	if n := len(w.pushes.to(jana)); n != 0 {
		t.Fatalf("pushed %d during quiet hours", n)
	}
	end := localtime.Next(now, quiet.To, prague)
	q := w.one(h)
	if q.status != "queued" || q.why() != "quiet_hours" || !q.runAt.Equal(end) || q.attempts != 0 {
		t.Fatalf("held until %s: %+v", end, q)
	}
	if logged := w.deliveries(h); len(logged) != 0 {
		t.Fatalf("logged while held: %+v", logged)
	}
	// Held again, its earlier failures still count: the hold uncounts its own claim alone.
	w.exec("UPDATE notifications SET attempts = 3 WHERE household_id = $1", h)
	w.due(h)
	w.s.Drain(t.Context(), h)
	if q := w.one(h); q.status != "queued" || q.why() != "quiet_hours" || q.attempts != 3 {
		t.Fatalf("held after three failed attempts: %+v", q)
	}

	w.send(h, notify.Notification{To: jana, Category: notify.Direct, Message: "email.member_removed", Email: true})
	if sent := w.mail.all(); len(sent) != 1 || sent[0].Subject != "You were removed from Test on Household" {
		t.Fatalf("the email: %+v", sent)
	}

	// Once quiet hours end.
	w.clock.set(end.Add(time.Minute))
	w.due(h)
	w.s.Drain(t.Context(), h)
	if n := len(w.pushes.to(jana)); n != 1 {
		t.Fatalf("pushed %d once quiet hours ended; want 1", n)
	}
	if all := w.notifications(h); all[0].status != "sent" {
		t.Fatalf("after quiet hours: %+v", all[0])
	}

	// Jana's own timezone, not the household's: six hours behind Prague, she is not in her quiet hours.
	w.exec("UPDATE users SET timezone = 'America/New_York' WHERE id = $1", jana)
	w.clock.set(now)
	w.send(h, accessChanged(jana))
	if n := len(w.pushes.to(jana)); n != 2 {
		t.Fatalf("pushed %d outside her own quiet hours; want 2", n)
	}
}

// A member's grant is read when a notification goes out (FR-NT5): none on its module, or the module
// disabled, drops it, as do a private item's that is not theirs and a recipient who is no longer a
// member; each drop is logged with its reason.
func TestAGrantOfNoneSuppressesDelivery(t *testing.T) {
	w := newWorld(t)
	h := w.household()
	jana, petr, milos, klara := w.user("Jana"), w.user("Petr"), w.user("Milos"), w.user("Klara")
	w.member(h, jana, "owner", nil)
	w.member(h, petr, "member", map[string]string{"finance": "none"})
	w.member(h, milos, "member", map[string]string{"finance": "view"})
	for _, u := range []uuid.UUID{jana, petr, milos, klara} {
		w.browser(u)
	}
	finance := func(to uuid.UUID) notify.Notification {
		n := accessChanged(to)
		n.Module = "finance"
		return n
	}
	w.send(h, finance(jana), finance(petr), finance(milos), finance(klara))
	if len(w.pushes.to(jana)) != 1 || len(w.pushes.to(milos)) != 1 || len(w.pushes.to(petr)) != 0 || len(w.pushes.to(klara)) != 0 {
		for _, q := range w.notifications(h) {
			t.Logf("%+v %s", q, q.why())
		}
		t.Fatalf("pushed: Jana %d, Milos %d, Petr %d, Klara %d", len(w.pushes.to(jana)), len(w.pushes.to(milos)),
			len(w.pushes.to(petr)), len(w.pushes.to(klara)))
	}
	reasons := map[string]int{}
	for _, d := range w.deliveries(h) {
		if d.status == "dropped" && d.transport == "" && d.title == nil {
			reasons[d.reason]++
		}
	}
	if reasons["no_grant"] != 1 || reasons["not_member"] != 1 {
		t.Fatalf("drops logged: %v", reasons)
	}

	w.exec("UPDATE module_enablement SET enabled = false WHERE household_id = $1 AND module = 'finance'", h)
	w.send(h, finance(milos), finance(jana))
	if len(w.pushes.to(milos)) != 1 || len(w.pushes.to(jana)) != 1 {
		t.Fatal("a disabled module's notice was pushed")
	}

	private := accessChanged(milos)
	private.Owner = jana
	w.send(h, private)
	if all := w.notifications(h); all[len(all)-1].why() != "private" {
		t.Fatalf("another's private item: %+v", all[len(all)-1])
	}
}

// What a member switched off drops what it covers: everything for the master switch, one category for
// its own; the account's defaults hold in a household with no preferences of its own.
func TestAMembersOwnMuteWins(t *testing.T) {
	w := newWorld(t)
	h, jana := w.household(), w.user("Jana")
	w.member(h, jana, "member", nil)
	w.browser(jana)
	w.exec(`INSERT INTO notification_defaults (user_id, enabled, direct, household, reminders, digest) VALUES ($1, true, false, true, true, true)`, jana)
	w.send(h, accessChanged(jana))
	w.exec(`INSERT INTO notification_preferences (household_id, user_id, enabled, direct, household, reminders, digest)
	        VALUES ($1, $2, false, true, true, true, true)`, h, jana)
	w.send(h, accessChanged(jana))
	w.exec(`UPDATE notification_preferences SET enabled = true WHERE household_id = $1`, h)
	w.send(h, accessChanged(jana))
	all := w.notifications(h)
	if len(all) != 3 || all[0].why() != "category_muted" || all[1].why() != "muted" || all[2].status != "sent" {
		t.Fatalf("the notifications: %+v", all)
	}
}

// A member reached nowhere is logged as such: no browser whose session lives, no device whose sign-in
// does, and none that failures marked stale.
func TestATargetMustBeLiveToBePushedTo(t *testing.T) {
	w := newWorld(t)
	h, jana := w.household(), w.user("Jana")
	w.member(h, jana, "member", nil)
	sub := w.browser(jana)
	device, _ := w.phone(jana)
	w.exec("UPDATE sessions SET revoked_at = now() WHERE user_id = $1", jana)
	w.exec("UPDATE device_sessions SET revoked_at = now() WHERE device_id = $1", device)
	w.send(h, accessChanged(jana))
	w.exec("UPDATE sessions SET revoked_at = NULL WHERE user_id = $1", jana)
	w.exec("UPDATE push_subscriptions SET stale_at = now() WHERE id = $1", sub)
	w.send(h, accessChanged(jana))
	for _, q := range w.notifications(h) {
		if q.status != "dropped" || q.why() != "no_target" {
			t.Fatalf("pushed to a target that is not live: %+v", q)
		}
	}
	if n := len(w.pushes.to(jana)); n != 0 {
		t.Fatalf("%d pushes", n)
	}
}

// A push service's 404 or 410 deletes the subscription; five failures in a row mark a target stale,
// and one success ends the run (FR-NT6): a browser's push service taking it, and for a device Apple's
// or Google's, as its receipt says, not Expo's ticket. A push service that is down, or throttles the
// server, holds nothing against the targets it did not take a push for, however long it lasts.
func TestAGoneTargetIsDeletedAndAFailingOneGoesStale(t *testing.T) {
	w := newWorld(t)
	h, jana, petr := w.household(), w.user("Jana"), w.user("Petr")
	w.member(h, jana, "member", nil)
	w.member(h, petr, "member", nil)
	gone := w.browser(jana)
	failing := w.browser(petr)
	device, token := w.phone(petr)
	w.pushes.answer = func(t notify.Target) notify.Outcome {
		if t.ID == gone {
			return notify.Outcome{Status: notify.Gone}
		}
		return notify.Outcome{Status: notify.Failed}
	}
	w.send(h, accessChanged(jana))
	var subs int
	if err := w.admin.QueryRow(t.Context(), "SELECT count(*) FROM push_subscriptions WHERE id = $1", gone).Scan(&subs); err != nil {
		t.Fatal(err)
	}
	if q := w.one(h); subs != 0 || q.status != "failed" || q.why() != "gone" {
		t.Fatalf("a gone subscription: %d left, %+v", subs, q)
	}

	for range 4 {
		w.send(h, accessChanged(petr))
	}
	failures := func() (int, bool, int, bool) {
		var subFailures, devFailures int
		var subStale, devStale bool
		if err := w.admin.QueryRow(t.Context(), `
			SELECT p.failures, p.stale_at IS NOT NULL, d.push_failures, d.push_stale_at IS NOT NULL
			FROM push_subscriptions p, devices d WHERE p.id = $1 AND d.id = $2`, failing, device).
			Scan(&subFailures, &subStale, &devFailures, &devStale); err != nil {
			t.Fatal(err)
		}
		return subFailures, subStale, devFailures, devStale
	}
	if sf, ss, df, ds := failures(); sf != 4 || ss || df != 4 || ds {
		t.Fatalf("after four failures: %d %v %d %v", sf, ss, df, ds)
	}
	w.pushes.answer = nil
	w.send(h, accessChanged(petr))
	if sf, ss, df, ds := failures(); sf != 0 || ss || df != 4 || ds {
		t.Fatalf("after a success, before the device's receipt: %d %v %d %v", sf, ss, df, ds)
	}
	w.exec("UPDATE push_receipts SET sent_at = now() - interval '20 minutes' WHERE device_id = $1", device)
	w.pushes.mu.Lock()
	for _, p := range w.pushes.sent {
		if p.target.ID == device && p.ticket != "" {
			// Apple or Google took the push Expo ticketed.
			w.pushes.receipts[p.ticket] = notify.Accepted
		}
	}
	w.pushes.mu.Unlock()
	if err := w.s.CheckReceipts(t.Context()); err != nil {
		t.Fatal(err)
	}
	if sf, ss, df, ds := failures(); sf != 0 || ss || df != 0 || ds {
		t.Fatalf("after the device's receipt: %d %v %d %v", sf, ss, df, ds)
	}
	w.pushes.answer = func(notify.Target) notify.Outcome { return notify.Outcome{Status: notify.Unavailable} }
	for range 6 {
		w.send(h, accessChanged(petr))
	}
	if sf, ss, df, ds := failures(); sf != 0 || ss || df != 0 || ds {
		t.Fatalf("after the push services were unavailable: %d %v %d %v", sf, ss, df, ds)
	}
	logged := w.deliveries(h)
	if last := logged[len(logged)-1]; last.status != "failed" || last.reason != "push_unavailable" {
		t.Fatalf("an unavailable push service logged: %+v", last)
	}
	w.pushes.answer = func(notify.Target) notify.Outcome { return notify.Outcome{Status: notify.Failed} }
	for range 5 {
		w.send(h, accessChanged(petr))
	}
	if sf, ss, df, ds := failures(); sf != 5 || !ss || df != 5 || !ds {
		t.Fatalf("after five failures: %d %v %d %v", sf, ss, df, ds)
	}
	before := len(w.pushes.to(petr))
	w.send(h, accessChanged(petr))
	if after := len(w.pushes.to(petr)); after != before {
		t.Fatalf("a stale target was tried: %d pushes, then %d", before, after)
	}
	_ = token
}

// Expo's receipt of DeviceNotRegistered clears the token it was sent to, unless the device registered
// another since; an error of the push's on the device counts as a failure, and one of the project's
// or of Expo's own as none; a push Apple or Google took ends the device's run of failures; a ticket
// answered, or a day old, is done with.
func TestExposReceiptsAreRead(t *testing.T) {
	w := newWorld(t)
	jana := w.user("Jana")
	dead, deadToken := w.phone(jana)
	failing, failingToken := w.phone(jana)
	renewed, renewedToken := w.phone(jana)
	throttled, throttledToken := w.phone(jana)
	delivered, deliveredToken := w.phone(jana)
	w.exec("UPDATE devices SET push_failures = 3 WHERE id IN ($1, $2)", throttled, delivered)
	// Tickets are global: this run's are its own.
	run := "-" + idgen.New().String()
	w.exec(`INSERT INTO push_receipts (ticket, user_id, device_id, token, sent_at) VALUES
	          ('t-dead' || $10, $1, $2, $3, now() - interval '20 minutes'),
	          ('t-failing' || $10, $1, $4, $5, now() - interval '20 minutes'),
	          ('t-renewed' || $10, $1, $6, $7, now() - interval '20 minutes'),
	          ('t-throttled' || $10, $1, $8, $9, now() - interval '20 minutes'),
	          ('t-delivered' || $10, $1, $11, $12, now() - interval '20 minutes'),
	          ('t-unread' || $10, $1, $2, $3, now() - interval '20 minutes'),
	          ('t-old' || $10, $1, $2, $3, now() - interval '25 hours'),
	          ('t-young' || $10, $1, $2, $3, now() - interval '1 minute')`,
		jana, dead, deadToken, failing, failingToken, renewed, renewedToken, throttled, throttledToken, run, delivered, deliveredToken)
	w.exec("UPDATE devices SET push_token = 'ExponentPushToken[new]' WHERE id = $1", renewed)
	w.pushes.receipts = map[string]notify.Status{
		"t-dead" + run: notify.Gone, "t-failing" + run: notify.Failed, "t-renewed" + run: notify.Gone, "t-throttled" + run: notify.Unavailable,
		"t-delivered" + run: notify.Accepted,
	}
	if err := w.s.CheckReceipts(t.Context()); err != nil {
		t.Fatal(err)
	}
	var (
		deadTokenNow, renewedTokenNow                  *string
		failures, throttledFailures, deliveredFailures int
		left                                           []string
	)
	if err := w.admin.QueryRow(t.Context(), `
		SELECT (SELECT push_token FROM devices WHERE id = $1), (SELECT push_failures FROM devices WHERE id = $2),
		  (SELECT push_token FROM devices WHERE id = $3), (SELECT push_failures FROM devices WHERE id = $5),
		  (SELECT push_failures FROM devices WHERE id = $6),
		  array(SELECT ticket FROM push_receipts WHERE user_id = $4 ORDER BY ticket)`, dead, failing, renewed, jana, throttled, delivered).
		Scan(&deadTokenNow, &failures, &renewedTokenNow, &throttledFailures, &deliveredFailures, &left); err != nil {
		t.Fatal(err)
	}
	if deadTokenNow != nil || failures != 1 || renewedTokenNow == nil || *renewedTokenNow != "ExponentPushToken[new]" ||
		throttledFailures != 3 || deliveredFailures != 0 || fmt.Sprint(left) != fmt.Sprintf("[t-unread%s t-young%s]", run, run) {
		t.Fatalf("dead %v, failures %d, renewed %v, throttled's failures %d, delivered's %d, left %v", deadTokenNow, failures,
			renewedTokenNow, throttledFailures, deliveredFailures, left)
	}
}

// A ticket a day old is done with even while Expo does not answer for receipts: none outlives the day
// Expo keeps its receipt, and the oldest batch is not asked for again on every run.
func TestATicketPastItsDayGoesWhileExpoDoesNotAnswer(t *testing.T) {
	w := newWorld(t)
	jana := w.user("Jana")
	device, token := w.phone(jana)
	run := "-" + idgen.New().String()
	w.exec(`INSERT INTO push_receipts (ticket, user_id, device_id, token, sent_at) VALUES
	          ('t-old' || $4, $1, $2, $3, now() - interval '25 hours'),
	          ('t-unread' || $4, $1, $2, $3, now() - interval '20 minutes')`, jana, device, token, run)
	w.pushes.unread = errors.New("the Expo push service answered 503")
	if err := w.s.CheckReceipts(t.Context()); err == nil {
		t.Fatal("Expo's failure was not reported")
	}
	var left []string
	if err := w.admin.QueryRow(t.Context(), "SELECT array(SELECT ticket FROM push_receipts WHERE user_id = $1 ORDER BY ticket)", jana).
		Scan(&left); err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(left) != fmt.Sprintf("[t-unread%s]", run) {
		t.Fatalf("left %v", left)
	}
}

// What a push says of its target is written as the push is settled, and failing to write it, for a
// device deleted meanwhile, keeps nothing from settling: the push is not left claimed, to go again
// once its lease has passed.
func TestAPushSettlesWhenWhatItSaysOfItsTargetCannotBeWritten(t *testing.T) {
	w := newWorld(t)
	h, jana := w.household(), w.user("Jana")
	w.member(h, jana, "member", nil)
	w.phone(jana)
	w.pushes.answer = func(notify.Target) notify.Outcome {
		// A ticket push_receipts refuses, as it refuses one for a device deleted since.
		return notify.Outcome{Status: notify.Accepted, Ticket: strings.Repeat("t", 200)}
	}
	w.send(h, accessChanged(jana))
	if q := w.one(h); q.status != "sent" {
		t.Fatalf("the notification: %+v", q)
	}
	if logged := w.deliveries(h); len(logged) != 1 || logged[0].status != "sent" {
		t.Fatalf("logged: %+v", logged)
	}
}

// A push that panics is recovered, and is one its push service did not take: what another service
// took is sent and not pushed again, and a notification no service took is tried again later.
func TestAPushThatPanicsIsOneNoServiceTook(t *testing.T) {
	w := newWorld(t)
	h, jana := w.household(), w.user("Jana")
	w.member(h, jana, "member", nil)
	w.browser(jana)
	w.phone(jana)
	panics := func(t notify.Target) notify.Outcome {
		if t.Transport == "expo" {
			panic("the push service's client went wrong")
		}
		return notify.Outcome{Status: notify.Accepted}
	}
	w.pushes.answer = panics
	w.send(h, accessChanged(jana))
	if q := w.one(h); q.status != "sent" {
		t.Fatalf("after a push panicked beside one its service took: %+v", q)
	}
	w.due(h)
	w.s.Drain(t.Context(), h)
	if n := len(w.pushes.to(jana)); n != 1 {
		t.Fatalf("%d pushes; want the browser's alone, once", n)
	}
	logged := w.deliveries(h)
	slices.SortFunc(logged, func(a, b delivery) int { return strings.Compare(a.transport, b.transport) })
	if len(logged) != 2 || logged[0].transport != "expo" || logged[0].reason != "push_unavailable" || logged[1].status != "sent" {
		t.Fatalf("logged: %+v", logged)
	}

	alone := w.household()
	w.member(alone, jana, "member", nil)
	w.exec("DELETE FROM push_subscriptions WHERE user_id = $1", jana)
	w.send(alone, accessChanged(jana))
	if q := w.one(alone); q.status != "queued" || q.why() != "push_unavailable" || q.attempts != 1 || time.Until(q.runAt) < 30*time.Second {
		t.Fatalf("after the one push panicked: %+v", q)
	}
}

// A push no push service took, one failing on its own side, is tried again with an email's backoff,
// since none holds it for the device, each attempt logged and what it says of its targets recorded,
// and is failed after the fifth; one a service took is sent and not tried again.
func TestAPushNoServiceTookIsTriedAgain(t *testing.T) {
	w := newWorld(t)
	h, jana := w.household(), w.user("Jana")
	w.member(h, jana, "member", nil)
	refusing := w.browser(jana)
	w.phone(jana)
	w.pushes.answer = func(t notify.Target) notify.Outcome {
		if t.ID == refusing {
			return notify.Outcome{Status: notify.Failed}
		}
		return notify.Outcome{Status: notify.Unavailable}
	}
	w.send(h, accessChanged(jana))
	q := w.one(h)
	if q.status != "queued" || q.why() != "push_unavailable" || q.attempts != 1 || time.Until(q.runAt) < 30*time.Second {
		t.Fatalf("after no service took it: %+v", q)
	}
	var failures int
	if err := w.admin.QueryRow(t.Context(), "SELECT failures FROM push_subscriptions WHERE id = $1", refusing).Scan(&failures); err != nil {
		t.Fatal(err)
	}
	if logged := w.deliveries(h); len(logged) != 2 || failures != 1 {
		t.Fatalf("after the first attempt: %d failures, logged %+v", failures, logged)
	}
	w.pushes.answer = nil
	w.due(h)
	w.s.Drain(t.Context(), h)
	if q := w.one(h); q.status != "sent" || q.reason != nil || len(w.pushes.to(jana)) != 4 {
		t.Fatalf("tried again: %+v, %d pushed", q, len(w.pushes.to(jana)))
	}

	other := w.household()
	w.member(other, jana, "member", nil)
	w.pushes.answer = func(notify.Target) notify.Outcome { return notify.Outcome{Status: notify.Unavailable} }
	w.send(other, accessChanged(jana))
	for range 6 {
		w.due(other)
		w.s.Drain(t.Context(), other)
	}
	if q := w.one(other); q.status != "failed" || q.why() != "push_unavailable" || q.attempts != 5 {
		t.Fatalf("after five attempts: %+v", q)
	}
	if n := len(w.deliveries(other)); n != 10 {
		t.Fatalf("%d attempts logged; want 5 at each of 2 targets", n)
	}
}

// An email the mail server does not take is tried again, after a minute, then five, and so on, each
// attempt logged, and given up after the fifth.
func TestAnEmailIsTriedAgainThenGivenUp(t *testing.T) {
	w := newWorld(t)
	h, jana := w.household(), w.user("Jana")
	removed := notify.Notification{To: jana, Category: notify.Direct, Message: "email.member_removed", Email: true}
	w.mail.fail = 1
	w.send(h, removed)
	q := w.one(h)
	if q.status != "queued" || q.why() != "email_failed" || q.attempts != 1 || time.Until(q.runAt) < 30*time.Second {
		t.Fatalf("after a failure: %+v", q)
	}
	w.due(h)
	w.s.Drain(t.Context(), h)
	if q := w.one(h); q.status != "sent" || len(w.mail.all()) != 1 {
		t.Fatalf("tried again: %+v, %d sent", q, len(w.mail.all()))
	}
	logged := w.deliveries(h)
	if len(logged) != 2 || logged[0].status != "failed" || logged[1].status != "sent" || logged[1].body != nil ||
		logged[1].title == nil || *logged[1].title != "You were removed from Test on Household" {
		t.Fatalf("logged: %+v", logged)
	}

	other := w.household()
	w.mail.fail = 10
	w.send(other, removed)
	for range 6 {
		w.due(other)
		w.s.Drain(t.Context(), other)
	}
	if q := w.one(other); q.status != "failed" || q.why() != "email_failed" {
		t.Fatalf("after five failures: %+v", q)
	}
	if n := len(w.deliveries(other)); n != 5 {
		t.Fatalf("%d attempts logged; want 5", n)
	}
}

// An email's link carries its token, which waits sealed under the notification keys, bound to its
// notification, and is erased with the address once the email has gone.
func TestAnEmailsLinkIsSealedUntilItGoes(t *testing.T) {
	w := newWorld(t)
	h := w.household()
	invite := notify.Notification{
		Address: "petr@example.test", Locale: "en", Category: notify.Direct, Message: "email.invitation", Email: true,
		Route: "invitation", Secret: "the-token",
		Args: i18n.Args{"inviter": "Jana", "household": "Tilcerovi", "hasMessage": "no", "message": ""},
	}
	if err := w.s.Send(t.Context(), h, invite); err != nil {
		t.Fatal(err)
	}
	var (
		id     uuid.UUID
		sealed []byte
	)
	if err := w.admin.QueryRow(t.Context(), "SELECT id, secret FROM notifications WHERE household_id = $1", h).Scan(&id, &sealed); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, []byte("the-token")) {
		t.Fatal("the token waits in the clear")
	}
	if opened, err := keys.Open(id, sealed); err != nil || string(opened) != "the-token" {
		t.Fatalf("opened %q, %v", opened, err)
	}
	if _, err := keys.Open(idgen.New(), sealed); err == nil {
		t.Fatal("the seal opened for another notification")
	}
	w.s.Drain(t.Context(), h)
	sent := w.mail.all()
	if len(sent) != 1 || sent[0].To != "petr@example.test" || !strings.Contains(sent[0].Body, "https://app.household.test/invitation#token=the-token") {
		t.Fatalf("sent: %+v", sent)
	}
	if q := w.one(h); q.status != "sent" || q.sealed || q.addressed {
		t.Fatalf("kept after sending: %+v", q)
	}
}

// Repeats with one coalescing key merge: into one that waits, and, after one has gone, into one held
// until the window since it has passed.
func TestRepeatsCoalesce(t *testing.T) {
	w := newWorld(t)
	h, jana := w.household(), w.user("Jana")
	w.member(h, jana, "member", nil)
	w.browser(jana)
	n := accessChanged(jana)
	n.Coalesce = "access_changed"
	if err := w.s.Send(t.Context(), h, n, n); err != nil {
		t.Fatal(err)
	}
	if q := w.one(h); q.count != 2 {
		t.Fatalf("two that wait: %+v", q)
	}
	w.s.Drain(t.Context(), h)
	w.send(h, n)
	w.send(h, n)
	all := w.notifications(h)
	if len(all) != 2 || all[1].status != "queued" || all[1].count != 2 || time.Until(all[1].runAt) < notify.Window-time.Minute {
		t.Fatalf("after one went: %+v", all)
	}
	if got := len(w.pushes.to(jana)); got != 1 {
		t.Fatalf("pushed %d; want the first alone", got)
	}

	// One going out now, claimed by a worker, is as good as sent: a repeat neither merges into it nor
	// goes straight after it.
	other := w.household()
	w.member(other, jana, "member", nil)
	if err := w.s.Send(t.Context(), other, n); err != nil {
		t.Fatal(err)
	}
	w.exec("UPDATE notifications SET claim = gen_random_uuid(), attempts = 1, run_at = now() + interval '5 minutes' WHERE household_id = $1", other)
	if err := w.s.Send(t.Context(), other, n); err != nil {
		t.Fatal(err)
	}
	all = w.notifications(other)
	if len(all) != 2 || all[0].count != 1 || all[1].status != "queued" || all[1].count != 1 ||
		time.Until(all[1].runAt) < notify.Window-time.Minute {
		t.Fatalf("a repeat while one went out: %+v", all)
	}
	// The one going out is put back, its push unavailable, and two wait: the next repeat merges into
	// the latest alone, rather than into both, which would then each go counting it.
	w.exec("UPDATE notifications SET claim = NULL WHERE household_id = $1 AND id = $2", other, all[0].id)
	if err := w.s.Send(t.Context(), other, n); err != nil {
		t.Fatal(err)
	}
	if all = w.notifications(other); len(all) != 2 || all[0].count != 1 || all[1].count != 2 {
		t.Fatalf("a repeat while two waited: %+v", all)
	}

	// The one a repeat merges into says what the repeat says, the latest word, counting both.
	third := w.household()
	w.member(third, jana, "member", nil)
	latest := n
	latest.Category, latest.Message, latest.Args = notify.Household, "notification.child_locked", i18n.Args{"member": "Petr"}
	if err := w.s.Send(t.Context(), third, n, latest); err != nil {
		t.Fatal(err)
	}
	var (
		category, message string
		count             int
	)
	if err := w.admin.QueryRow(t.Context(), "SELECT category::text, message, count FROM notifications WHERE household_id = $1", third).
		Scan(&category, &message, &count); err != nil {
		t.Fatal(err)
	}
	if category != string(notify.Household) || message != latest.Message || count != 2 {
		t.Fatalf("merged: %s, %s, %d; want the latest's, counting both", category, message, count)
	}

	// The latest word has had no try of its own: merged into one waiting out its backoff after its
	// fourth, it goes now and has its own five, while one held for quiet hours stays held.
	fourth := w.household()
	w.member(fourth, jana, "member", nil)
	if err := w.s.Send(t.Context(), fourth, n); err != nil {
		t.Fatal(err)
	}
	w.exec(`UPDATE notifications SET attempts = 4, reason = 'push_unavailable', run_at = now() + interval '2 hours'
	        WHERE household_id = $1`, fourth)
	if err := w.s.Send(t.Context(), fourth, n); err != nil {
		t.Fatal(err)
	}
	if q := w.one(fourth); q.count != 2 || q.attempts != 0 || q.reason != nil || time.Until(q.runAt) > time.Minute {
		t.Fatalf("merged into one in backoff: %+v", q)
	}
	w.exec(`UPDATE notifications SET attempts = 2, reason = 'quiet_hours', run_at = now() + interval '6 hours'
	        WHERE household_id = $1`, fourth)
	if err := w.s.Send(t.Context(), fourth, n); err != nil {
		t.Fatal(err)
	}
	if q := w.one(fourth); q.count != 3 || q.attempts != 0 || q.why() != "quiet_hours" || time.Until(q.runAt) < 5*time.Hour {
		t.Fatalf("merged into one held for quiet hours: %+v", q)
	}
	// So does one waiting out the backoff of a failure to read or render it, which records no reason;
	// one waiting the window since one went, which has had no try, still waits it.
	fifth := w.household()
	w.member(fifth, jana, "member", nil)
	if err := w.s.Send(t.Context(), fifth, n); err != nil {
		t.Fatal(err)
	}
	w.exec(`UPDATE notifications SET attempts = 4, reason = NULL, run_at = now() + interval '2 hours' WHERE household_id = $1`, fifth)
	if err := w.s.Send(t.Context(), fifth, n); err != nil {
		t.Fatal(err)
	}
	if q := w.one(fifth); q.count != 2 || q.attempts != 0 || q.reason != nil || time.Until(q.runAt) > time.Minute {
		t.Fatalf("merged into one in backoff with no reason: %+v", q)
	}
	w.exec(`UPDATE notifications SET run_at = now() + interval '10 minutes' WHERE household_id = $1`, fifth)
	if err := w.s.Send(t.Context(), fifth, n); err != nil {
		t.Fatal(err)
	}
	if q := w.one(fifth); q.count != 3 || time.Until(q.runAt) < 5*time.Minute {
		t.Fatalf("merged into one waiting the window: %+v", q)
	}
}

// A repeat queued while its notification was claimed, which then did not go, merges into it as it is
// put back, rather than waiting the window to go beside it, as it would once both were held for the
// same quiet hours: tried again because no push service took it, or put back by a stopping worker, it
// says what the repeat says, and stands for both.
func TestARepeatQueuedWhileItsNotificationWasClaimedMergesWhenItDidNotGo(t *testing.T) {
	w := newWorld(t)
	jana := w.user("Jana")
	w.browser(jana)
	n := accessChanged(jana)
	n.Coalesce = "access_changed"
	latest := n
	latest.Category, latest.Message, latest.Args = notify.Household, "notification.child_locked", i18n.Args{"member": "Petr"}
	message := func(h uuid.UUID) string {
		t.Helper()
		var m string
		if err := w.admin.QueryRow(t.Context(), "SELECT message FROM notifications WHERE household_id = $1", h).Scan(&m); err != nil {
			t.Fatal(err)
		}
		return m
	}

	h := w.household()
	w.member(h, jana, "member", nil)
	repeat := sync.OnceFunc(func() {
		if err := w.s.Send(t.Context(), h, latest); err != nil {
			t.Error(err)
		}
	})
	w.pushes.answer = func(notify.Target) notify.Outcome {
		repeat()
		return notify.Outcome{Status: notify.Unavailable}
	}
	w.send(h, n)
	// Merged as it was put back, it went again at once with a try of its own, and waits its backoff.
	if q := w.one(h); q.status != "queued" || q.count != 2 || q.why() != "push_unavailable" || q.attempts != 1 {
		t.Fatalf("a repeat while no service took it: %+v", q)
	}
	if m := message(h); m != latest.Message {
		t.Fatalf("says %s; want the repeat's", m)
	}
	w.pushes.answer = nil
	w.due(h)
	w.s.Drain(t.Context(), h)
	if q := w.one(h); q.status != "sent" || q.count != 2 {
		t.Fatalf("once a service took it: %+v", q)
	}

	other := w.household()
	w.member(other, jana, "member", nil)
	ctx, stop := context.WithCancel(t.Context())
	defer stop()
	again := sync.OnceFunc(func() {
		if err := w.s.Send(t.Context(), other, latest); err != nil {
			t.Error(err)
		}
	})
	w.pushes.answer = func(notify.Target) notify.Outcome {
		again()
		stop()
		return notify.Outcome{Status: notify.Failed}
	}
	if err := w.s.Send(t.Context(), other, n); err != nil {
		t.Fatal(err)
	}
	w.s.Drain(ctx, other)
	if q := w.one(other); q.status != "queued" || q.count != 2 || q.attempts != 0 || time.Until(q.runAt) > time.Second {
		t.Fatalf("a repeat while a stopping worker had it: %+v", q)
	}
	if m := message(other); m != latest.Message {
		t.Fatalf("says %s; want the repeat's", m)
	}
}

// Two transactions queueing one member's repeats under one key at once still merge them: the second
// waits for the first to commit, then finds its notification waiting.
func TestRepeatsQueuedAtOnceCoalesce(t *testing.T) {
	w := newWorld(t)
	h, jana := w.household(), w.user("Jana")
	w.member(h, jana, "member", nil)
	n := accessChanged(jana)
	n.Coalesce = "access_changed"
	scoped := tenant.Assume(t.Context(), w.app, h, uuid.Nil, "")
	queue := func(held func()) error {
		return tenant.InWriteTx(scoped, func(tx pgx.Tx) error {
			if err := w.s.Queue(scoped, tx, n); err != nil {
				return err
			}
			held()
			return nil
		})
	}
	queued, commit := make(chan struct{}), make(chan struct{})
	release := sync.OnceFunc(func() { close(commit) })
	defer release()
	first, second := make(chan error, 1), make(chan error, 1)
	go func() { first <- queue(func() { close(queued); <-commit }) }()
	<-queued
	go func() { second <- queue(func() {}) }()
	// The second waits on the first's lock before the first commits.
	for deadline, waiting := time.Now().Add(10*time.Second), 0; waiting == 0; {
		if err := w.admin.QueryRow(t.Context(), `
			SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory'`).
			Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting == 0 && time.Now().After(deadline) {
			release()
			<-first
			t.Fatalf("the second did not wait for the first: %v", <-second)
		}
		if waiting == 0 {
			time.Sleep(10 * time.Millisecond)
		}
	}
	release()
	if err := errors.Join(<-first, <-second); err != nil {
		t.Fatal(err)
	}
	if q := w.one(h); q.count != 2 {
		t.Fatalf("two queued at once: %+v", q)
	}
}

// A push's tag, which a push service and a device keep one push of, is its coalescing key's in its
// household: the same key in two households is two notices, and neither replaces the other.
func TestAPushesTagIsItsHouseholds(t *testing.T) {
	w := newWorld(t)
	jana := w.user("Jana")
	w.browser(jana)
	n := accessChanged(jana)
	n.Coalesce = "access_changed"
	tags := map[string]bool{}
	for range 2 {
		h := w.household()
		w.member(h, jana, "member", nil)
		w.send(h, n)
	}
	for _, p := range w.pushes.to(jana) {
		if p.push.Tag == "" {
			t.Fatalf("a coalescing push without a tag: %+v", p.push)
		}
		tags[p.push.Tag] = true
	}
	if len(tags) != 2 {
		t.Fatalf("two households' pushes under one key: tags %v", tags)
	}
}

// A delivery the worker's end stops before it went is put back, its attempt not counted and nothing
// held against its target; one that went is settled, not left claimed to go again once its lease has
// passed.
func TestADeliveryAShutdownStopsIsPutBackAndOneThatWentIsSettled(t *testing.T) {
	w := newWorld(t)
	h, jana := w.household(), w.user("Jana")
	w.member(h, jana, "member", nil)
	sub := w.browser(jana)

	ctx, stop := context.WithCancel(t.Context())
	defer stop()
	w.pushes.answer = func(notify.Target) notify.Outcome {
		stop()
		return notify.Outcome{Status: notify.Failed}
	}
	if err := w.s.Send(t.Context(), h, accessChanged(jana)); err != nil {
		t.Fatal(err)
	}
	w.s.Drain(ctx, h)
	q := w.one(h)
	if q.status != "queued" || q.attempts != 0 || time.Until(q.runAt) > time.Second {
		t.Fatalf("a push the shutdown stopped: %+v", q)
	}
	var failures int
	if err := w.admin.QueryRow(t.Context(), "SELECT failures FROM push_subscriptions WHERE id = $1", sub).Scan(&failures); err != nil {
		t.Fatal(err)
	}
	if logged := w.deliveries(h); len(logged) != 0 || failures != 0 {
		t.Fatalf("held against its target: %d failures, logged %+v", failures, logged)
	}
	w.pushes.answer = nil
	w.s.Drain(t.Context(), h)
	if q := w.one(h); q.status != "sent" {
		t.Fatalf("once it ran again: %+v", q)
	}

	other := w.household()
	sending, stopSending := context.WithCancel(t.Context())
	defer stopSending()
	w.mail.then = stopSending
	if err := w.s.Send(t.Context(), other, notify.Notification{To: jana, Category: notify.Direct, Message: "email.member_removed", Email: true}); err != nil {
		t.Fatal(err)
	}
	w.s.Drain(sending, other)
	if q := w.one(other); q.status != "sent" || len(w.mail.all()) != 1 {
		t.Fatalf("an email that went as the worker stopped: %+v, %d sent", q, len(w.mail.all()))
	}
}

// An email's that waits under a key (Replaces) is dropped when another is queued under it, and when
// its cause withdraws it: neither goes once the mail server takes mail again, and each drop is logged.
func TestAWaitingEmailIsReplacedOrWithdrawn(t *testing.T) {
	w := newWorld(t)
	h := w.household()
	invite := func(token string) notify.Notification {
		return notify.Notification{
			Address: "petr@example.test", Locale: "en", Category: notify.Direct, Message: "email.invitation", Email: true,
			Route: "invitation", Secret: token, Replaces: "invitation:1",
			Args: i18n.Args{"inviter": "Jana", "household": "Tilcerovi", "hasMessage": "no", "message": ""},
		}
	}
	w.mail.fail = 1
	w.send(h, invite("first"))
	w.send(h, invite("second"))
	sent := w.mail.all()
	if len(sent) != 1 || !strings.Contains(sent[0].Body, "#token=second") {
		t.Fatalf("sent: %+v", sent)
	}
	all := w.notifications(h)
	if len(all) != 2 || all[0].status != "dropped" || all[0].why() != "replaced" || all[0].sealed || all[0].addressed ||
		all[1].status != "sent" {
		t.Fatalf("the notifications: %+v", all)
	}

	w.mail.fail = 1
	waiting := invite("third")
	waiting.Replaces = "invitation:2"
	w.send(h, waiting)
	w.withdraw(h, "invitation:2")
	w.due(h)
	w.s.Drain(t.Context(), h)
	if n := len(w.mail.all()); n != 1 {
		t.Fatalf("a withdrawn email went: %d sent", n)
	}
	all = w.notifications(h)
	if last := all[len(all)-1]; last.status != "dropped" || last.why() != "withdrawn" || last.sealed || last.addressed {
		t.Fatalf("withdrawn: %+v", last)
	}
	reasons := map[string]int{}
	for _, d := range w.deliveries(h) {
		if d.status == "dropped" {
			reasons[d.reason]++
		}
	}
	if reasons["replaced"] != 1 || reasons["withdrawn"] != 1 {
		t.Fatalf("drops logged: %v", reasons)
	}
}

// An email withdrawn while a worker hands it to the mail server is logged as what became of it: sent,
// after its drop, when the mail server took it, and otherwise left dropped and never tried again.
func TestAnEmailWithdrawnAsItGoesIsLoggedAsWhatBecameOfIt(t *testing.T) {
	w := newWorld(t)
	invite := notify.Notification{
		Address: "petr@example.test", Locale: "en", Category: notify.Direct, Message: "email.invitation", Email: true,
		Route: "invitation", Secret: "the-token", Replaces: "invitation:1",
		Args: i18n.Args{"inviter": "Jana", "household": "Tilcerovi", "hasMessage": "no", "message": ""},
	}
	h := w.household()
	w.mail.during = func() { w.withdraw(h, "invitation:1") }
	w.send(h, invite)
	if q := w.one(h); q.status != "sent" || q.sealed || q.addressed || len(w.mail.all()) != 1 {
		t.Fatalf("an email that went as it was withdrawn: %+v, %d sent", q, len(w.mail.all()))
	}
	if logged := w.deliveries(h); len(logged) != 2 || logged[0].status != "dropped" || logged[0].reason != "withdrawn" ||
		logged[1].status != "sent" || logged[1].transport != "email" {
		t.Fatalf("logged: %+v", logged)
	}

	other := w.household()
	w.mail.fail = 1
	w.mail.during = func() { w.withdraw(other, "invitation:1") }
	w.send(other, invite)
	w.mail.during = nil
	w.due(other)
	w.s.Drain(t.Context(), other)
	if q := w.one(other); q.status != "dropped" || q.why() != "withdrawn" || len(w.mail.all()) != 1 {
		t.Fatalf("an email the mail server refused as it was withdrawn: %+v, %d sent", q, len(w.mail.all()))
	}
	if logged := w.deliveries(other); len(logged) != 2 || logged[0].status != "dropped" || logged[1].status != "failed" ||
		logged[1].reason != "email_failed" {
		t.Fatalf("logged: %+v", logged)
	}

	// On its last attempt too, when a refusal would otherwise fail it.
	last := w.household()
	if err := w.s.Send(t.Context(), last, invite); err != nil {
		t.Fatal(err)
	}
	w.exec("UPDATE notifications SET attempts = 4 WHERE household_id = $1", last)
	w.mail.fail = 1
	w.mail.during = func() { w.withdraw(last, "invitation:1") }
	w.s.Drain(t.Context(), last)
	w.mail.during = nil
	if q := w.one(last); q.status != "dropped" || q.why() != "withdrawn" {
		t.Fatalf("an email refused on its last attempt as it was withdrawn: %+v", q)
	}
	if logged := w.deliveries(last); len(logged) != 2 || logged[0].status != "dropped" || logged[1].status != "failed" ||
		logged[1].reason != "email_failed" {
		t.Fatalf("logged: %+v", logged)
	}
}

// A notification claimed more times than it may be tried, its workers ending before they settled it,
// is given up, and the log says so.
func TestANotificationNeverSettledIsGivenUpAndLogged(t *testing.T) {
	w := newWorld(t)
	h, jana := w.household(), w.user("Jana")
	w.member(h, jana, "member", nil)
	w.browser(jana)
	if err := w.s.Send(t.Context(), h, accessChanged(jana)); err != nil {
		t.Fatal(err)
	}
	w.exec("UPDATE notifications SET attempts = 5 WHERE household_id = $1", h)
	w.s.Drain(t.Context(), h)
	if q := w.one(h); q.status != "failed" || q.why() != "gave_up" {
		t.Fatalf("given up: %+v", q)
	}
	if n := len(w.pushes.to(jana)); n != 0 {
		t.Fatalf("pushed %d", n)
	}
	if logged := w.deliveries(h); len(logged) != 1 || logged[0].status != "failed" || logged[0].reason != "gave_up" || logged[0].transport != "" {
		t.Fatalf("logged: %+v", logged)
	}
}

// The workers deliver what a commit of their instance queued as soon as it nudges them, and find
// what is due in any other household, as the meter role, every Poll.
func TestTheWorkersDeliverWhatIsDue(t *testing.T) {
	w := newWorld(t)
	h, other, jana, petr := w.household(), w.household(), w.user("Jana"), w.user("Petr")
	w.member(h, jana, "member", nil)
	w.member(other, petr, "member", nil)
	w.browser(jana)
	w.browser(petr)
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		defer close(done)
		w.s.Run(ctx)
	}()
	defer func() {
		cancel()
		<-done
	}()
	if err := w.s.Send(t.Context(), h, accessChanged(jana)); err != nil {
		t.Fatal(err)
	}
	for deadline := time.Now().Add(10 * time.Second); len(w.pushes.to(jana)) == 0; time.Sleep(10 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("the workers delivered nothing")
		}
	}
	// Queued by another instance, which nudges this one's workers not.
	scoped := tenant.Assume(t.Context(), w.app, other, uuid.Nil, "")
	if err := tenant.InWriteTx(scoped, func(tx pgx.Tx) error { return w.s.Queue(scoped, tx, accessChanged(petr)) }); err != nil {
		t.Fatal(err)
	}
	for deadline := time.Now().Add(10 * time.Second); len(w.pushes.to(petr)) == 0; time.Sleep(10 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("the workers did not find what another instance queued")
		}
	}
}

func TestANotificationIsForSomeoneAndSaysSomething(t *testing.T) {
	w := newWorld(t)
	h, jana := w.household(), w.user("Jana")
	for _, n := range []notify.Notification{
		{Category: notify.Direct, Message: "notification.access_changed"},
		{To: jana, Category: "chat", Message: "notification.access_changed"},
		{To: jana, Category: notify.Direct, Message: "Not a key"},
		{Address: "petr@example.test", Category: notify.Direct, Message: "email.invitation"},
		{To: jana, Category: notify.Direct, Message: "notification.access_changed", Secret: "token"},
		{To: jana, Category: notify.Direct, Message: "notification.access_changed", Link: "https://elsewhere.example"},
		// An email is each one's own, and merges with nothing.
		{To: jana, Category: notify.Direct, Message: "email.member_removed", Email: true, Coalesce: "removed"},
		{Address: "petr@example.test", Category: notify.Direct, Message: "email.invitation", Email: true, Coalesce: "invited"},
	} {
		if err := w.s.Send(t.Context(), h, n); err == nil {
			t.Errorf("queued %+v", n)
		}
	}
}
