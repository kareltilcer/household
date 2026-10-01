package notify

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/localtime"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// The workers' timing: a worker that claims a notification holds it for lease, after which another
// may take it as one whose worker died; an email that failed waits backoff[attempts-1] before it is
// tried again, and a notification claimed maxAttempts times without being settled is given up.
const (
	lease       = 5 * time.Minute
	maxAttempts = 5
	// turn is how long a worker delivers one household's notifications before letting the others found
	// due with it take their turn.
	turn = 30 * time.Second
	// keepBodies is how long the delivery log keeps what it sent (PRD 03 §5, FR-HA12).
	keepBodies = 7 * 24 * time.Hour
	// stale is how many failures in a row mark a target stale (FR-NT6).
	stale = 5
	// holdAtLeast is the least a notification is held for its recipient's quiet hours (holdUntil).
	holdAtLeast = time.Minute
)

var backoff = []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute, 2 * time.Hour}

// The reasons a notification did not arrive, as the delivery log records them.
const (
	reasonNotMember     = "not_member"
	reasonNoGrant       = "no_grant"
	reasonPrivate       = "private"
	reasonMuted         = "muted"
	reasonCategoryMuted = "category_muted"
	reasonQuietHours    = "quiet_hours"
	reasonNoTarget      = "no_target"
	reasonNoAddress     = "no_address"
	reasonGone          = "gone"
	reasonPushFailed    = "push_failed"
	reasonEmailFailed   = "email_failed"
	reasonGaveUp        = "gave_up"
)

// The transports, as the contract spells them.
const (
	transportWebPush = "web_push"
	transportExpo    = "expo"
	transportEmail   = "email"
)

// Target is a place a push goes: a browser's subscription or a device's token.
type Target struct {
	Transport string
	// ID is the subscription's, or the device's.
	ID   uuid.UUID
	User uuid.UUID
	// Endpoint, P256dh and Auth are a browser's subscription.
	Endpoint, P256dh, Auth string
	// Token is a device's Expo push token.
	Token string
}

// Push is what a push says, rendered in its recipient's language.
type Push struct {
	Notification uuid.UUID
	Household    uuid.UUID
	Title, Body  string
	// Link is the path in the app it opens.
	Link string
	// Tag collapses it with an earlier push of the same, on the device and at the push service.
	Tag string
	// Urgent asks the push service to wake the device for it: someone means the member.
	Urgent bool
}

// Status is how an attempt at a target went.
type Status int

// The statuses of an attempt.
const (
	// Accepted is a push its push service took.
	Accepted Status = iota
	// Gone is a target that no longer exists: a 404 or a 410, or Expo's DeviceNotRegistered.
	Gone
	// Failed is any other failure.
	Failed
)

// Outcome is how an attempt at a target went.
type Outcome struct {
	Status Status
	// Ticket is Expo's, whose receipt says later whether the push arrived.
	Ticket string
}

// queued is a notification a worker has claimed.
type queued struct {
	household, id uuid.UUID
	user          *uuid.UUID
	address       *string
	locale        *string
	category      Category
	message       string
	args          i18n.Args
	count         int
	route         *string
	secret        []byte
	module        *string
	owner         *uuid.UUID
	link          *string
	coalesce      *string
	email         bool
	attempts      int
	claim         uuid.UUID
}

// Run runs the workers until ctx ends, then waits for the deliveries they hold. It looks for
// households with notifications due when a commit of this instance wakes it (Nudge), and every Poll
// for the rest, as the files workers do; each household's are delivered by one worker at a time.
func (s *Service) Run(ctx context.Context) {
	var running sync.WaitGroup
	slots := make(chan struct{}, s.cfg.Workers)
	ticker := time.NewTicker(s.cfg.Poll)
	defer ticker.Stop()
	for {
		households, err := s.due(ctx)
		if err != nil && ctx.Err() == nil {
			s.cfg.Log.LogAttrs(ctx, slog.LevelError, "notify: find the notifications due", slog.Any("error", err))
		}
		for _, h := range households {
			if !s.hold(h) {
				continue
			}
			select {
			case slots <- struct{}{}:
			case <-ctx.Done():
				s.release(h, false)
				running.Wait()
				return
			}
			running.Add(1)
			go func() {
				more := false
				defer func() {
					<-slots
					s.release(h, more)
					running.Done()
				}()
				more = s.drain(ctx, h)
			}()
		}
		select {
		case <-ctx.Done():
			running.Wait()
			return
		case <-ticker.C:
		case <-s.wake:
		}
	}
}

// hold marks household as one a worker of this instance is delivering to, and reports false when
// one already is, which then looks again once it lets the household go.
func (s *Service) hold(household uuid.UUID) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, held := s.busy[household]; held {
		s.busy[household] = true
		return false
	}
	s.busy[household] = false
	return true
}

// release lets household go, and wakes the workers when it was found due while held, or when its
// worker's turn ended with notifications perhaps left.
func (s *Service) release(household uuid.UUID, more bool) {
	s.mu.Lock()
	again := s.busy[household] || more
	delete(s.busy, household)
	s.mu.Unlock()
	if again {
		select {
		case s.wake <- struct{}{}:
		default:
		}
	}
}

// due returns the households with a notification due, as the meter role reads them, the one that has
// waited longest first.
func (s *Service) due(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := s.cfg.Meter.Query(ctx, `
		SELECT household_id FROM notifications WHERE status = 'queued' AND run_at <= now()
		GROUP BY household_id ORDER BY min(run_at), household_id LIMIT 1000`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

// Drain delivers household's notifications due now, in the caller's goroutine, until none is left.
func (s *Service) Drain(ctx context.Context, household uuid.UUID) {
	for more := true; more && ctx.Err() == nil; {
		more = s.drain(ctx, household)
	}
}

// drain delivers household's notifications due, one after another, until none is left, ctx ends, or
// the worker's turn is over, and reports whether it stopped for its turn.
func (s *Service) drain(ctx context.Context, household uuid.UUID) bool {
	began := time.Now()
	for ctx.Err() == nil {
		q, ok, err := s.claim(ctx, household)
		if err != nil {
			if ctx.Err() == nil {
				s.cfg.Log.LogAttrs(ctx, slog.LevelError, "notify: claim a notification", householdAttr(household), slog.Any("error", err))
			}
			return false
		}
		if !ok {
			return false
		}
		s.deliver(ctx, q)
		if time.Since(began) >= turn {
			return true
		}
	}
	return false
}

// claim takes household's next notification due, moving it past its lease.
func (s *Service) claim(ctx context.Context, household uuid.UUID) (queued, bool, error) {
	q := queued{household: household, claim: idgen.New()}
	found := false
	err := tenant.InWriteTx(s.system(ctx, household), func(tx pgx.Tx) error {
		var args []byte
		// The row is chosen by a subquery in WHERE, which PostgreSQL runs once: one in FROM may be run
		// again for each row the UPDATE reads, and each run skips the row the last one claimed, so that
		// a single UPDATE would claim every notification due.
		err := tx.QueryRow(ctx, `
			UPDATE notifications n SET run_at = now() + make_interval(secs => $2), attempts = n.attempts + 1, claim = $3
			WHERE n.household_id = $1 AND n.id = (
			  SELECT id FROM notifications WHERE household_id = $1 AND status = 'queued' AND run_at <= now()
			  ORDER BY run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
			RETURNING n.id, n.user_id, n.address, n.locale, n.category::text, n.message, n.args, n.count, n.route, n.secret,
			  n.module, n.owner_id, n.link, n.coalesce_key, n.email, n.attempts`,
			household, lease.Seconds(), q.claim).Scan(&q.id, &q.user, &q.address, &q.locale, &q.category, &q.message, &args,
			&q.count, &q.route, &q.secret, &q.module, &q.owner, &q.link, &q.coalesce, &q.email, &q.attempts)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		found = true
		d := json.NewDecoder(bytes.NewReader(args))
		d.UseNumber()
		return d.Decode(&q.args)
	})
	return q, found, err
}

// recipient is what deliver reads about a notification's recipient and household when it goes out.
type recipient struct {
	locale, timezone, address string
	verified                  bool
	householdName, zone       string
	role                      string
	prefs                     Preferences
	targets                   []Target
}

// verdict is what a notification comes to once its recipient is read: dropped for a reason, held
// until a time, or sent.
type verdict struct {
	drop  string
	until time.Time
}

// deliver delivers q and settles it. A panic is recovered and counted as a failed attempt, which the
// next claim tries again until maxAttempts.
func (s *Service) deliver(ctx context.Context, q queued) {
	defer func() {
		if v := recover(); v != nil {
			s.cfg.Log.LogAttrs(ctx, slog.LevelError, "notify: a delivery panicked", householdAttr(q.household),
				slog.String("message", q.message), slog.String("panic", httpx.TypeName(v)), slog.String("stack", logging.Stack()))
			s.retry(ctx, q, nil)
		}
	}()
	if q.attempts > maxAttempts {
		s.settle(ctx, q, "failed", reasonGaveUp, nil, nil)
		return
	}
	r, v, err := s.read(ctx, q)
	switch {
	case err != nil:
		s.cfg.Log.LogAttrs(ctx, slog.LevelError, "notify: read a notification's recipient", householdAttr(q.household), slog.Any("error", err))
		s.retry(ctx, q, nil)
	case v.drop != "":
		s.settle(ctx, q, "dropped", v.drop, []attempt{{status: "dropped", reason: v.drop}}, nil)
	case !v.until.IsZero():
		s.holdUntil(ctx, q, v.until)
	case q.email:
		s.sendEmail(ctx, q, r)
	default:
		s.sendPush(ctx, q, r)
	}
}

// read reads q's recipient in its household, and what that comes to now (FR-NT5): a push is for a
// member who holds view on its module, whose own it is if it is private, who has not switched it off
// or muted its category, and whose quiet hours are not now; an email of the fixed set goes whatever
// the member muted, to their verified address, or to the address it was queued for.
func (s *Service) read(ctx context.Context, q queued) (recipient, verdict, error) {
	var (
		r recipient
		v verdict
	)
	err := tenant.InTx(s.system(ctx, q.household), func(tx pgx.Tx) error {
		if q.user == nil {
			r.address = *q.address
			if q.locale != nil {
				r.locale = *q.locale
			}
			return tx.QueryRow(ctx, "SELECT name FROM households WHERE id = $1", q.household).Scan(&r.householdName)
		}
		user := *q.user
		if err := tx.QueryRow(ctx, `
			SELECT u.locale, coalesce(u.timezone, ''), coalesce(u.email, ''), u.email_verified_at IS NOT NULL,
			  h.name, h.timezone, coalesce(m.role::text, '')
			FROM users u
			JOIN households h ON h.id = $2
			LEFT JOIN memberships m ON m.household_id = h.id AND m.user_id = u.id
			WHERE u.id = $1`, user, q.household).
			Scan(&r.locale, &r.timezone, &r.address, &r.verified, &r.householdName, &r.zone, &r.role); err != nil {
			return err
		}
		switch {
		case q.owner != nil && *q.owner != user:
			v.drop = reasonPrivate
			return nil
		case q.module != nil:
			if r.role == "" {
				v.drop = reasonNotMember
				return nil
			}
			level, err := s.level(ctx, tx, q.household, user, access.Role(r.role), *q.module)
			if err != nil {
				return err
			}
			if level < access.View {
				v.drop = reasonNoGrant
				return nil
			}
		}
		if q.email {
			if r.address == "" || !r.verified {
				v.drop = reasonNoAddress
			}
			return nil
		}
		if r.role == "" {
			v.drop = reasonNotMember
			return nil
		}
		var err error
		if r.prefs, err = householdPreferences(ctx, tx, q.household, user); err != nil {
			return err
		}
		switch {
		case !r.prefs.Enabled:
			v.drop = reasonMuted
			return nil
		case r.prefs.Muted[q.category]:
			v.drop = reasonCategoryMuted
			return nil
		case r.prefs.Quiet != nil:
			if end, quiet := r.prefs.Quiet.End(s.cfg.Now(), localtime.Zone(r.timezone, r.zone)); quiet {
				v.until = end
				return nil
			}
		}
		if r.targets, err = targets(ctx, tx, user); err != nil {
			return err
		}
		if len(r.targets) == 0 {
			v.drop = reasonNoTarget
		}
		return nil
	})
	return r, v, err
}

// level is user's effective level on module in household, whose role there is role (tenant.Effective).
func (s *Service) level(ctx context.Context, tx pgx.Tx, household, user uuid.UUID, role access.Role, module string) (access.Level, error) {
	var (
		enabled bool
		granted string
	)
	err := tx.QueryRow(ctx, `
		SELECT e.enabled, coalesce(g.level::text, 'none')
		FROM module_enablement e
		LEFT JOIN module_grants g ON g.household_id = e.household_id AND g.module = e.module AND g.user_id = $2
		WHERE e.household_id = $1 AND e.module = $3`, household, user, module).Scan(&enabled, &granted)
	if errors.Is(err, pgx.ErrNoRows) {
		return access.None, nil
	}
	if err != nil {
		return access.None, err
	}
	level, err := access.ParseLevel(granted)
	if err != nil {
		return access.None, err
	}
	return tenant.Effective(role, module, enabled, level), nil
}

// targets are where user's pushes go: each browser subscription whose web session lives, and each
// device token whose device's sign-in does, but those a run of failures marked stale.
func targets(ctx context.Context, tx pgx.Tx, user uuid.UUID) ([]Target, error) {
	rows, err := tx.Query(ctx, `
		SELECT 'web_push', p.id, p.endpoint, p.p256dh, p.auth, ''
		FROM push_subscriptions p JOIN sessions s ON s.id = p.session_id AND s.user_id = p.user_id
		WHERE p.user_id = $1 AND p.stale_at IS NULL AND s.revoked_at IS NULL AND s.expires_at > now()
		UNION ALL
		SELECT 'expo', d.id, '', '', '', d.push_token
		FROM devices d
		WHERE d.user_id = $1 AND d.push_token IS NOT NULL AND d.push_stale_at IS NULL
		  AND EXISTS (SELECT FROM device_sessions ds WHERE ds.user_id = d.user_id AND ds.device_id = d.id AND ds.revoked_at IS NULL)
		ORDER BY 1, 2`, user)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Target, error) {
		t := Target{User: user}
		err := row.Scan(&t.Transport, &t.ID, &t.Endpoint, &t.P256dh, &t.Auth, &t.Token)
		return t, err
	})
}

// args are q's arguments as its message is rendered with them: the household's name unless q names
// it, and how many notifications q stands for.
func (q queued) render(r recipient) i18n.Args {
	args := maps.Clone(q.args)
	if args == nil {
		args = i18n.Args{}
	}
	if _, ok := args["household"]; !ok {
		args["household"] = r.householdName
	}
	args["count"] = q.count
	return args
}

// sendPush renders q in its recipient's language and pushes it to each of their targets. It is sent
// when one push service took it; a push is not tried again, since its service holds it for the
// device already.
func (s *Service) sendPush(ctx context.Context, q queued, r recipient) {
	locale := i18n.Match(r.locale)
	args := q.render(r)
	title, err := s.cfg.Catalogs.Render(locale, q.message+".title", args)
	var body string
	if err == nil {
		body, err = s.cfg.Catalogs.Render(locale, q.message+".body", args)
	}
	if err != nil {
		s.cfg.Log.LogAttrs(ctx, slog.LevelError, "notify: render a push", householdAttr(q.household),
			slog.String("message", q.message), slog.Any("error", err))
		s.retry(ctx, q, nil)
		return
	}
	p := Push{Notification: q.id, Household: q.household, Title: title, Body: body, Urgent: q.category == Direct}
	if q.link != nil {
		p.Link = *q.link
	}
	if q.coalesce != nil {
		sum := sha256.Sum256([]byte(*q.coalesce))
		p.Tag = base64.RawURLEncoding.EncodeToString(sum[:24])
	}
	var (
		attempts []attempt
		healths  []health
		sent     bool
		// allGone is whether every target that did not take it is gone, which is the notification's
		// reason then.
		allGone = true
	)
	for _, t := range r.targets {
		pusher := s.cfg.WebPush
		if t.Transport == transportExpo {
			pusher = s.cfg.Expo
		}
		o := pusher.Push(ctx, t, p)
		a := attempt{transport: t.Transport, title: &title, body: &body}
		switch o.Status {
		case Accepted:
			a.status, sent = "sent", true
		case Gone:
			a.status, a.reason = "failed", reasonGone
		case Failed:
			a.status, a.reason, allGone = "failed", reasonPushFailed, false
		}
		attempts = append(attempts, a)
		healths = append(healths, func(ctx context.Context, tx pgx.Tx) error { return recordHealth(ctx, tx, t, o) })
	}
	switch {
	case sent:
		s.settle(ctx, q, "sent", "", attempts, healths)
	case allGone:
		s.settle(ctx, q, "failed", reasonGone, attempts, healths)
	default:
		s.settle(ctx, q, "failed", reasonPushFailed, attempts, healths)
	}
}

// sendEmail renders q in its recipient's language and sends it, trying again with backoff when the
// mail server does not take it.
func (s *Service) sendEmail(ctx context.Context, q queued, r recipient) {
	args := q.render(r)
	if q.route != nil {
		token := ""
		if q.secret != nil {
			opened, err := s.cfg.Keys.Open(q.id, q.secret)
			if err != nil {
				// No key opens it: the key it was sealed under is gone, and no retry will mend that.
				s.cfg.Log.LogAttrs(ctx, slog.LevelError, "notify: open an email's secret", householdAttr(q.household),
					slog.String("message", q.message), slog.Any("error", err))
				s.settle(ctx, q, "failed", reasonEmailFailed, []attempt{{transport: transportEmail, status: "failed", reason: reasonEmailFailed}}, nil)
				return
			}
			token = string(opened)
		}
		args["link"] = s.link(*q.route, token)
	}
	m, err := mail.Render(s.cfg.Catalogs, i18n.Match(r.locale), mail.Template(q.message), args, r.address)
	if err == nil {
		err = s.cfg.Mail.Send(ctx, m)
	}
	subject := m.Subject
	a := attempt{transport: transportEmail, status: "sent"}
	if subject != "" {
		a.title = &subject
	}
	if err != nil {
		s.cfg.Log.LogAttrs(ctx, slog.LevelWarn, "notify: an email was not sent", householdAttr(q.household),
			slog.String("message", q.message), slog.Int("attempt", q.attempts), slog.Any("error", err))
		a.status, a.reason = "failed", reasonEmailFailed
		s.retry(ctx, q, &a)
		return
	}
	s.settle(ctx, q, "sent", "", []attempt{a}, nil)
}

// link is the web client's route, with token in its fragment, which a browser sends to no server.
func (s *Service) link(route, token string) string {
	u := *s.cfg.WebURL
	u.Path = strings.TrimSuffix(u.Path, "/") + "/" + route
	u.RawQuery = ""
	u.Fragment = ""
	if token != "" {
		u.Fragment = "token=" + token
	}
	return u.String()
}

// attempt is one row of the delivery log.
type attempt struct {
	transport   string
	status      string
	reason      string
	title, body *string
}

// health records what an attempt says of its target, in the transaction that settles it.
type health func(ctx context.Context, tx pgx.Tx) error

// recordHealth records what o says of t (FR-NT6): a target that is gone is deleted, a failure counts
// towards the run of them that marks it stale, an accepted push ends the run, and an Expo ticket waits
// for its receipt.
func recordHealth(ctx context.Context, tx pgx.Tx, t Target, o Outcome) error {
	var err error
	switch {
	case t.Transport == transportWebPush && o.Status == Gone:
		_, err = tx.Exec(ctx, "DELETE FROM push_subscriptions WHERE id = $1 AND endpoint = $2", t.ID, t.Endpoint)
	case t.Transport == transportWebPush && o.Status == Failed:
		_, err = tx.Exec(ctx, `
			UPDATE push_subscriptions SET failures = failures + 1,
			  stale_at = CASE WHEN failures + 1 >= $3 THEN now() ELSE stale_at END
			WHERE id = $1 AND endpoint = $2`, t.ID, t.Endpoint, stale)
	case t.Transport == transportWebPush:
		_, err = tx.Exec(ctx, "UPDATE push_subscriptions SET failures = 0 WHERE id = $1 AND endpoint = $2 AND failures > 0", t.ID, t.Endpoint)
	case o.Status == Gone:
		err = forgetToken(ctx, tx, t.User, t.ID, t.Token)
	case o.Status == Failed:
		err = failToken(ctx, tx, t.User, t.ID, t.Token)
	default:
		if _, err = tx.Exec(ctx, `
			UPDATE devices SET push_failures = 0 WHERE user_id = $1 AND id = $2 AND push_token = $3 AND push_failures > 0`,
			t.User, t.ID, t.Token); err == nil && o.Ticket != "" {
			_, err = tx.Exec(ctx, `
				INSERT INTO push_receipts (ticket, user_id, device_id, token) VALUES ($1, $2, $3, $4)
				ON CONFLICT (ticket) DO NOTHING`, o.Ticket, t.User, t.ID, t.Token)
		}
	}
	return err
}

// forgetToken clears a device's token that its push service no longer knows, unless the device has
// registered another since.
func forgetToken(ctx context.Context, tx pgx.Tx, user, device uuid.UUID, token string) error {
	_, err := tx.Exec(ctx, `
		UPDATE devices SET push_token = NULL, push_registered_at = NULL, push_failures = 0, push_stale_at = NULL
		WHERE user_id = $1 AND id = $2 AND push_token = $3`, user, device, token)
	return err
}

// failToken counts a failure against a device's token, marking it stale at the run's end.
func failToken(ctx context.Context, tx pgx.Tx, user, device uuid.UUID, token string) error {
	_, err := tx.Exec(ctx, `
		UPDATE devices SET push_failures = push_failures + 1,
		  push_stale_at = CASE WHEN push_failures + 1 >= $4 THEN now() ELSE push_stale_at END
		WHERE user_id = $1 AND id = $2 AND push_token = $3`, user, device, token, stale)
	return err
}

// holdUntil puts q back until until, its recipient's quiet hours' end: nothing quiet hours hold is
// dropped (FR-NT2), and holding it is no failed attempt. It waits a minute at least, by the database's
// clock, which decides what is due: were the instance's clock behind it, a hold ending before the
// database's now would be claimed again at once, and held again, for as long as the two disagreed.
func (s *Service) holdUntil(ctx context.Context, q queued, until time.Time) {
	err := tenant.InWriteTx(s.system(ctx, q.household), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			UPDATE notifications SET run_at = greatest($4, now() + make_interval(secs => $6)), reason = $5, attempts = 0, claim = NULL
			WHERE household_id = $1 AND id = $2 AND claim = $3`, q.household, q.id, q.claim, until, reasonQuietHours, holdAtLeast.Seconds())
		return err
	})
	if err != nil {
		s.cfg.Log.LogAttrs(ctx, slog.LevelError, "notify: hold a notification", householdAttr(q.household), slog.Any("error", err))
	}
}

// retry puts q back for its next attempt after its backoff, recording a, the attempt that failed,
// when there was one; q is failed once it has had maxAttempts.
func (s *Service) retry(ctx context.Context, q queued, a *attempt) {
	var attempts []attempt
	if a != nil {
		attempts = append(attempts, *a)
	}
	if q.attempts >= maxAttempts {
		reason := reasonGaveUp
		if a != nil {
			reason = a.reason
		}
		s.settle(ctx, q, "failed", reason, attempts, nil)
		return
	}
	wait := backoff[min(q.attempts, len(backoff))-1]
	err := tenant.InWriteTx(s.system(ctx, q.household), func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE notifications SET run_at = now() + make_interval(secs => $4), reason = $5, claim = NULL
			WHERE household_id = $1 AND id = $2 AND claim = $3`, q.household, q.id, q.claim, wait.Seconds(), nullable(reasonOf(a)))
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		return logAttempts(ctx, tx, q, attempts)
	})
	if err != nil {
		s.cfg.Log.LogAttrs(ctx, slog.LevelError, "notify: put a notification back", householdAttr(q.household), slog.Any("error", err))
	}
}

func reasonOf(a *attempt) string {
	if a == nil {
		return ""
	}
	return a.reason
}

// settle ends q as status, for reason, recording its attempts and what they say of their targets, and
// erases what it kept only until then: the address it went to and its email's sealed secret. A worker
// whose lease another took settles nothing.
func (s *Service) settle(ctx context.Context, q queued, status, reason string, attempts []attempt, healths []health) {
	err := tenant.InWriteTx(s.system(ctx, q.household), func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE notifications SET status = $4, reason = $5, settled_at = now(), claim = NULL, address = NULL, secret = NULL
			WHERE household_id = $1 AND id = $2 AND claim = $3`, q.household, q.id, q.claim, status, nullable(reason))
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		for _, h := range healths {
			if err := h(ctx, tx); err != nil {
				return err
			}
		}
		return logAttempts(ctx, tx, q, attempts)
	})
	if err != nil {
		s.cfg.Log.LogAttrs(ctx, slog.LevelError, "notify: settle a notification", householdAttr(q.household), slog.Any("error", err))
	}
}

// logAttempts writes attempts to the delivery log. What a push said is kept for keepBodies, and an
// email's subject as long, never its body.
func logAttempts(ctx context.Context, tx pgx.Tx, q queued, attempts []attempt) error {
	for _, a := range attempts {
		if _, err := tx.Exec(ctx, `
			INSERT INTO notification_deliveries (household_id, id, notification_id, user_id, category, transport, status, reason,
			                                     title, body, body_expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
			        CASE WHEN $9::text IS NOT NULL OR $10::text IS NOT NULL THEN now() + make_interval(secs => $11) END)`,
			q.household, idgen.New(), q.id, q.user, string(q.category), nullable(a.transport), a.status, nullable(a.reason),
			a.title, a.body, keepBodies.Seconds()); err != nil {
			return fmt.Errorf("notify: log an attempt: %w", err)
		}
	}
	return nil
}

func householdAttr(household uuid.UUID) slog.Attr {
	return slog.String(logging.KeyHouseholdID, household.String())
}
