package expiry_test

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/expiry"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

func TestMain(m *testing.M) { testsupport.Main(m) }

type world struct {
	t     *testing.T
	admin *pgxpool.Pool
	s     *expiry.Sweeper
	// purged counts the calls to purge the invitations.
	purged int
}

func newWorld(t *testing.T) *world {
	t.Helper()
	d := testsupport.Open(t)
	w := &world{t: t, admin: d.Pool(t, "")}
	var err error
	w.s, err = expiry.New(expiry.Config{
		Pool: d.Pool(t, db.RoleApp), Meter: d.Pool(t, db.RoleMeter), Log: logging.New(io.Discard, slog.LevelDebug),
		Invitations: func(context.Context) (int, error) {
			w.purged++
			return 0, nil
		},
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

// left reports which of ids the query, given them, still finds.
func (w *world) left(query string, ids ...uuid.UUID) map[uuid.UUID]bool {
	w.t.Helper()
	out := map[uuid.UUID]bool{}
	for _, id := range ids {
		var found bool
		if err := w.admin.QueryRow(w.t.Context(), query, id).Scan(&found); err != nil {
			w.t.Fatal(err)
		}
		out[id] = found
	}
	return out
}

func (w *world) user() uuid.UUID {
	w.t.Helper()
	u := idgen.New()
	w.exec("INSERT INTO users (id) VALUES ($1)", u)
	return u
}

func hash(id uuid.UUID) []byte {
	b := make([]byte, 32)
	copy(b, id[:])
	copy(b[16:], id[:])
	return b
}

// The expiry sweep deletes what its retentions say and nothing a retention still keeps: ended
// sessions, Idempotency-Keys a week old, used refresh tokens a month old, revoked device sign-ins
// once their tokens are gone, expired trusts, and throttles that count nothing any more.
func TestTheNightlySweepKeepsWhatIsStillWithinItsRetention(t *testing.T) {
	w := newWorld(t)
	u := w.user()
	sessions := map[string]uuid.UUID{"live": idgen.New(), "revoked": idgen.New(), "expired": idgen.New()}
	for name, id := range sessions {
		revoked, expires := "NULL", "now() + interval '1 day'"
		switch name {
		case "revoked":
			revoked = "now()"
		case "expired":
			expires = "now() - interval '1 second'"
		}
		w.exec(`INSERT INTO sessions (id, user_id, token_hash, csrf_hash, created_at, expires_at, revoked_at)
		        VALUES ($1, $2, $3, $3, now() - interval '2 days', `+expires+`, `+revoked+`)`, id, u, hash(id))
	}
	keys := map[string]string{"old": "now() - interval '8 days'", "young": "now() - interval '6 days'"}
	for key, at := range keys {
		w.exec(`INSERT INTO account_idempotency_keys (user_id, key, fingerprint, state, claim, claimed_at, created_at)
		        VALUES ($1, $2, '\x01', 'in_flight', gen_random_uuid(), now(), `+at+`)`, u, key)
	}
	device := idgen.New()
	w.exec("INSERT INTO devices (user_id, id) VALUES ($1, $2)", u, device)
	revokedEmpty, revokedHolding, live := idgen.New(), idgen.New(), idgen.New()
	w.exec(`INSERT INTO device_sessions (id, user_id, device_id, revoked_at) VALUES ($1, $4, $5, now()), ($2, $4, $5, now()), ($3, $4, $5, NULL)`,
		revokedEmpty, revokedHolding, live, u, device)
	oldToken, youngToken := idgen.New(), idgen.New()
	w.exec(`INSERT INTO refresh_tokens (id, session_id, token_hash, used_at, replaced_by) VALUES
	          ($1, $3, $4, now() - interval '31 days', gen_random_uuid()), ($2, $3, $5, now() - interval '29 days', gen_random_uuid())`,
		oldToken, youngToken, revokedHolding, hash(oldToken), hash(youngToken))
	expiredTrust, liveTrust := idgen.New(), idgen.New()
	w.exec(`INSERT INTO mfa_trusts (id, user_id, token_hash, created_at, expires_at) VALUES
	          ($1, $3, $4, now() - interval '31 days', now() - interval '1 day'), ($2, $3, $5, now() - interval '1 day', now() + interval '29 days')`,
		expiredTrust, liveTrust, u, hash(expiredTrust), hash(liveTrust))
	throttles := map[string]string{
		"counting": "now() + interval '1 minute', NULL",
		"blocked":  "now() - interval '1 minute', now() - interval '1 hour'",
		"done":     "now() - interval '1 minute', now() - interval '25 hours'",
		"quiet":    "now() - interval '1 minute', NULL",
	}
	for name, values := range throttles {
		w.exec(`INSERT INTO auth_throttles (key, count, window_ends_at, blocked_until) VALUES (sha256($1::bytea), 1, `+values+`)`, []byte(name))
	}

	if err := w.s.Sweep(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := w.left("SELECT EXISTS (SELECT FROM sessions WHERE id = $1)", sessions["live"], sessions["revoked"], sessions["expired"]); !got[sessions["live"]] ||
		got[sessions["revoked"]] || got[sessions["expired"]] {
		t.Errorf("sessions: %v", got)
	}
	var keysLeft []string
	if err := w.admin.QueryRow(t.Context(), "SELECT array(SELECT key FROM account_idempotency_keys WHERE user_id = $1)", u).Scan(&keysLeft); err != nil {
		t.Fatal(err)
	}
	if len(keysLeft) != 1 || keysLeft[0] != "young" {
		t.Errorf("account keys: %v", keysLeft)
	}
	if got := w.left("SELECT EXISTS (SELECT FROM refresh_tokens WHERE id = $1)", oldToken, youngToken); got[oldToken] || !got[youngToken] {
		t.Errorf("refresh tokens: %v", got)
	}
	if got := w.left("SELECT EXISTS (SELECT FROM device_sessions WHERE id = $1)", revokedEmpty, revokedHolding, live); got[revokedEmpty] ||
		!got[revokedHolding] || !got[live] {
		t.Errorf("device sign-ins: %v", got)
	}
	if got := w.left("SELECT EXISTS (SELECT FROM mfa_trusts WHERE id = $1)", expiredTrust, liveTrust); got[expiredTrust] || !got[liveTrust] {
		t.Errorf("trusts: %v", got)
	}
	for name, want := range map[string]bool{"counting": true, "blocked": true, "done": false, "quiet": false} {
		var found bool
		if err := w.admin.QueryRow(t.Context(), "SELECT EXISTS (SELECT FROM auth_throttles WHERE key = sha256($1::bytea))", []byte(name)).
			Scan(&found); err != nil {
			t.Fatal(err)
		}
		if found != want {
			t.Errorf("throttle %s kept: %v; want %v", name, found, want)
		}
	}
}

// A household's own rows past their time are found by the meter role and deleted in their household:
// Idempotency-Keys and the push's answers a week old, and what a notification said, after its seven
// days, which leaves the outcome.
func TestTheNightlySweepReachesEveryHousehold(t *testing.T) {
	w := newWorld(t)
	u := w.user()
	var households []uuid.UUID
	for range 2 {
		h := idgen.New()
		w.exec(testsupport.InsertHousehold, h)
		w.exec(testsupport.InsertMember, h, u, "owner")
		for _, at := range []string{"8 days", "6 days"} {
			w.exec(`INSERT INTO idempotency_keys (household_id, user_id, key, fingerprint, state, claim, claimed_at, created_at)
			        VALUES ($1, $2, $3, '\x01', 'in_flight', gen_random_uuid(), now(), now() - $4::interval)`, h, u, at, at)
			w.exec(`INSERT INTO sync_mutations (household_id, user_id, mutation_id, fingerprint, outcome, created_at)
			        VALUES ($1, $2, gen_random_uuid(), decode(repeat('a1', 32), 'hex'), 'applied', now() - $3::interval)`, h, u, at)
		}
		n := idgen.New()
		w.exec(`INSERT INTO notifications (household_id, id, user_id, category, message, status, settled_at)
		        VALUES ($1, $2, $3, 'direct', 'notification.access_changed', 'sent', now())`, h, n, u)
		w.exec(`INSERT INTO notification_deliveries (household_id, id, notification_id, user_id, category, transport, status, title, body, body_expires_at)
		        VALUES ($1, gen_random_uuid(), $2, $3, 'direct', 'web_push', 'sent', 'old', 'old', now() - interval '1 second'),
		               ($1, gen_random_uuid(), $2, $3, 'direct', 'web_push', 'sent', 'new', 'new', now() + interval '1 day')`, h, n, u)
		households = append(households, h)
	}
	if err := w.s.Sweep(t.Context()); err != nil {
		t.Fatal(err)
	}
	for _, h := range households {
		var keys, answers int
		var titles []*string
		if err := w.admin.QueryRow(t.Context(), `
			SELECT (SELECT count(*) FROM idempotency_keys WHERE household_id = $1), (SELECT count(*) FROM sync_mutations WHERE household_id = $1),
			  array(SELECT title FROM notification_deliveries WHERE household_id = $1 ORDER BY title NULLS FIRST)`, h).
			Scan(&keys, &answers, &titles); err != nil {
			t.Fatal(err)
		}
		if keys != 1 || answers != 1 || len(titles) != 2 || titles[0] != nil || titles[1] == nil || *titles[1] != "new" {
			t.Errorf("household %s: %d keys, %d answers, titles %v", h, keys, answers, titles)
		}
	}
}

// The hourly expiry deletes the single-use tokens a while past their time, and purges the invitations
// that stopped working a month ago.
func TestTheHourlyExpiryDeletesTokensPastTheirTime(t *testing.T) {
	w := newWorld(t)
	u := w.user()
	links := map[string]uuid.UUID{"long expired": idgen.New(), "just expired": idgen.New(), "spent": idgen.New()}
	for name, id := range links {
		expires, used := "now() - interval '8 days'", "NULL"
		switch name {
		case "just expired":
			expires = "now() - interval '1 day'"
		case "spent":
			expires, used = "now() + interval '1 hour'", "now()"
		}
		w.exec(`INSERT INTO email_tokens (id, user_id, purpose, token_hash, email, created_at, expires_at, used_at)
		        VALUES ($1, $2, 'reset_password', $3, 'a@example.test', now() - interval '9 days', `+expires+`, `+used+`)`, id, u, hash(id))
	}
	steps := map[string]uuid.UUID{"ended": idgen.New(), "expired": idgen.New(), "waiting": idgen.New()}
	for name, id := range steps {
		expires, ended := "now() + interval '5 minutes'", "NULL"
		switch name {
		case "ended":
			ended = "now() - interval '2 days'"
		case "expired":
			expires = "now() - interval '2 days'"
		}
		w.exec(`INSERT INTO mfa_challenges (id, user_id, token_hash, client_type, created_at, expires_at, ended_at)
		        VALUES ($1, $2, $3, 'web', now() - interval '3 days', `+expires+`, `+ended+`)`, id, u, hash(id))
	}
	if err := w.s.Tokens(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := w.left("SELECT EXISTS (SELECT FROM email_tokens WHERE id = $1)", links["long expired"], links["just expired"], links["spent"]); got[links["long expired"]] ||
		!got[links["just expired"]] || !got[links["spent"]] {
		t.Errorf("email links: %v", got)
	}
	if got := w.left("SELECT EXISTS (SELECT FROM mfa_challenges WHERE id = $1)", steps["ended"], steps["expired"], steps["waiting"]); got[steps["ended"]] ||
		got[steps["expired"]] || !got[steps["waiting"]] {
		t.Errorf("second steps: %v", got)
	}
	if w.purged != 1 {
		t.Errorf("the invitations were purged %d times", w.purged)
	}
}
