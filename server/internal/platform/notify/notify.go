// Package notify is the platform's notification transport (PRD 03 §4, plan item 15, ADR 0016): what
// a module or the platform tells a member, queued in the transaction of what caused it, and delivered
// once that commits by Web Push to a browser, by Expo to a phone or tablet, or by email for the small
// set that must arrive whatever the member muted (FR-NT1).
//
// Everything about whether a notification reaches someone is decided when it goes out, not when it
// was queued (FR-NT5): that they are still a member, that they hold view on the module it is about,
// that a private item's is theirs, that they have not switched notifications off or muted its
// category (FR-NT2), and that it is not their quiet hours, which hold it until they end rather than
// drop it. It is rendered then, in the recipient's own language, once for each recipient. Repeats
// with the same coalescing key merge: into one still waiting, or, after one has just gone out, into
// one held until the window since it has passed.
//
// Workers in every instance deliver, as the files workers derive: the meter role finds the
// households with something due, and each notification is claimed under a lease with FOR UPDATE SKIP
// LOCKED, so an instance's worker that dies leaves it for another. Every attempt is recorded in the
// delivery log (FR-NT6): a target that answers 404 or 410 is deleted, and one that fails five times in
// a row is marked stale and left alone until it is registered again. An email that fails is tried
// again with backoff; a push is not once a push service took it, since that service holds it for the
// device, and is, as an email is, when none did because a push service failed on its own side.
//
// Rules and digests (FR-NT3, FR-NT4) are item 53's, and queue through Queue as everything here does.
package notify

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/mfa"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Category is one of the four a member mutes on their own (FR-NT2).
type Category string

// The categories, as the contract's NotificationCategory spells them.
const (
	// Direct is someone meaning the member: an assignment, a mention, a message, their access changed.
	Direct Category = "direct"
	// Household is something changed that the member asked to hear about: every owner's rule.
	Household Category = "household"
	// Reminders is a due date the member subscribed to.
	Reminders Category = "reminders"
	// Digest is a scheduled summary.
	Digest Category = "digest"
)

// Categories lists them, in the contract's order.
var Categories = []Category{Direct, Household, Reminders, Digest}

// Window is how long repeats with the same coalescing key merge after one has gone out.
const Window = 15 * time.Minute

// Notification is one notification to one recipient.
type Notification struct {
	// To is the member it is for. An email may be for an address instead (Address).
	To uuid.UUID
	// Address is where an email goes when it is for no account yet: an invitation's. It is kept
	// until the notification is settled, and no longer.
	Address string
	// Locale is the language an email to an address is written in. A member reads their own.
	Locale   string
	Category Category
	// Message is the catalog key its text is rendered from: <Message>.title and <Message>.body for a
	// push, <Message>.subject and <Message>.body for an email. The household's name is the argument
	// "household" unless Args names it, and how many notifications it stands for once repeats merged
	// into it is "count".
	Message string
	Args    i18n.Args
	// Module, when set, is the module whose view the recipient must hold when it goes out (FR-NT5).
	Module string
	// Owner, when set, is the member a private item's notification may reach, and no one else.
	Owner uuid.UUID
	// Link is the path in the app a push opens: the entity it is about, which the app resolves, or
	// shows a neutral message for when the member can no longer see it (PRD 06 §6).
	Link string
	// Coalesce, when set, is the key repeats merge under, for the same recipient: a member's access
	// changed, by whichever owner and however many times in a few minutes. A push's: the merged one
	// says what the latest repeat says, counting them all. An email merges with nothing.
	Coalesce string
	// Email sends it by email: one of the fixed set, security, billing, invitations and a member's
	// removal, that arrives whatever the member muted, quiet hours or not (FR-NT1).
	Email bool
	// Route and Secret make an email's link: the web client's Route, with Secret in the fragment,
	// which no server is sent. The secret is sealed while it waits (Config.Keys).
	Route, Secret string
	// Replaces, when set, is the key of what the notification is the latest word on, in its household:
	// queuing it drops the one still waiting under the key, which it makes stale, and Withdraw drops
	// it once nothing should go. An invitation's email, whose link a resend replaces and a withdrawal
	// ends, so that no stale link or withdrawn invitation arrives once the mail server takes mail again.
	Replaces string
}

var (
	messageKey = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`)
	routeName  = regexp.MustCompile(`^[a-z][a-z0-9/_-]*$`)
)

// check returns what makes n unqueueable.
func (n Notification) check() error {
	switch {
	case !messageKey.MatchString(n.Message):
		return fmt.Errorf("notify: message %q is not a catalog key", n.Message)
	case n.To == uuid.Nil && n.Address == "":
		return errors.New("notify: a notification for no one")
	case n.To != uuid.Nil && n.Address != "":
		return errors.New("notify: a notification for a member and an address")
	case n.Address != "" && (!n.Email || !mail.ValidAddress(n.Address)):
		return errors.New("notify: an address that is not an email's")
	case n.Email && n.Coalesce != "":
		// An email is each one's own: one merged into another, or a push into it, would leave its link
		// or the push unsent.
		return errors.New("notify: an email coalesces with nothing")
	case n.Secret != "" && (!n.Email || n.Route == ""):
		return errors.New("notify: a secret that no email's link carries")
	case n.Route != "" && (!n.Email || !routeName.MatchString(n.Route)):
		return errors.New("notify: a route that is no email's link")
	case n.Link != "" && (!strings.HasPrefix(n.Link, "/") || len(n.Link) > 512):
		return errors.New("notify: a link that is not a path in the app")
	case len(n.Coalesce) > 200 || len(n.Replaces) > 200:
		return errors.New("notify: a key over 200 bytes")
	case n.Coalesce != "" && n.Replaces != "":
		return errors.New("notify: a notification that replaces another merges with none")
	case !slices.Contains(Categories, n.Category):
		return fmt.Errorf("notify: category %q", n.Category)
	}
	return nil
}

// Querier runs a query: the meter role's pool.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Pusher delivers a push to one target: Web Push or Expo.
type Pusher interface {
	Push(ctx context.Context, t Target, m Push) Outcome
}

// Config is what the service needs.
type Config struct {
	// Pool is the database, connected as the request role.
	Pool tenant.Beginner
	// Meter finds the households with notifications due, connected as the meter role.
	Meter Querier
	Log   *slog.Logger
	// Catalogs render the notifications, in each recipient's language.
	Catalogs *i18n.Catalogs
	// WebURL is where the web client is served, which an email's link opens.
	WebURL *url.URL
	// Keys seal the secret an email's link carries while it waits (HOUSEHOLD_NOTIFY_KEYS): keys of
	// their own, sealed as the second step's secrets are.
	Keys *mfa.Keys
	// WebPush and Expo deliver pushes, Receipts reads what Expo says of them later, and Mail
	// delivers email.
	WebPush, Expo Pusher
	Receipts      ReceiptReader
	Mail          mail.Sender
	// VAPIDKey is the public key of the server's VAPID key, which a browser subscribes with.
	VAPIDKey string
	// PushHosts are the push services a browser's subscription may name: DefaultPushHosts and those
	// the deployment adds.
	PushHosts []string
	// Workers is how many households this instance delivers to at once, 4 when zero, and Poll how
	// often it looks for notifications due when no commit of its own woke it, 30 seconds when zero.
	Workers int
	Poll    time.Duration
	// Inline delivers what a commit queued in the caller's goroutine, before Nudge returns: a test's,
	// which reads what was sent as soon as its request has been answered.
	Inline bool
	// Now is the clock quiet hours are read on, time.Now when nil.
	Now func() time.Time
}

// Service queues and delivers notifications.
type Service struct {
	cfg  Config
	wake chan struct{}

	mu   sync.Mutex
	busy map[uuid.UUID]bool
	// nudged are the households Run is to deliver to when it wakes, without looking across every
	// household for what is due: those a commit of this instance queued in, and those its workers let go
	// with notifications perhaps left (release).
	nudged map[uuid.UUID]bool
}

// New returns the service.
func New(cfg Config) (*Service, error) {
	if cfg.Pool == nil || cfg.Meter == nil || cfg.Log == nil || cfg.Catalogs == nil || cfg.WebURL == nil ||
		cfg.Keys == nil || cfg.WebPush == nil || cfg.Expo == nil || cfg.Receipts == nil || cfg.Mail == nil || cfg.VAPIDKey == "" {
		return nil, errors.New("notify: the service is missing a dependency")
	}
	hosts := make([]string, 0, len(cfg.PushHosts))
	for _, h := range cfg.PushHosts {
		if h = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(h), ".")); h != "" {
			hosts = append(hosts, h)
		}
	}
	if len(hosts) == 0 {
		hosts = DefaultPushHosts
	}
	cfg.PushHosts = hosts
	if cfg.Workers <= 0 {
		cfg.Workers = 4
	}
	if cfg.Poll <= 0 {
		cfg.Poll = 30 * time.Second
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Service{cfg: cfg, wake: make(chan struct{}, 1), busy: map[uuid.UUID]bool{}, nudged: map[uuid.UUID]bool{}}, nil
}

// coalesceLock is the namespace of the locks that serialise queueing a recipient's repeats under one
// coalescing key, and merging into a notification put back after its claim those queued meanwhile
// (fold): the first key of the two-key advisory lock whose second is the hash of the household, the
// recipient and the key (coalescing).
const coalesceLock = db.CoalesceLock

// coalescing names household's notifications to user under the coalescing key key, in the lock that
// serialises queueing them (coalesceLock).
func coalescing(household, user uuid.UUID, key string) string {
	return household.String() + "\x1f" + user.String() + "\x1f" + key
}

// lockCoalescing takes, in tx and until it ends, the lock on each of keys (coalescing), in one order,
// so that two transactions with the same keys never wait on each other's.
func lockCoalescing(ctx context.Context, tx pgx.Tx, keys []string) error {
	slices.Sort(keys)
	for _, key := range slices.Compact(keys) {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1, hashtext($2))", coalesceLock, key); err != nil {
			return fmt.Errorf("notify: coalesce: %w", err)
		}
	}
	return nil
}

// fresh is what a notification a repeat merges into keeps of its own waiting (Queue, fold), its table
// aliased n: the merged one says the latest word, which has had no try of its own. What it waits on
// stands, quiet hours or the window since one went, but the backoff and the tries of what it said
// before do not, which would hold the latest word hours and give it up at its first failure: a backoff
// is a push no service took (reasonPushUnavailable), or a failure to read or render it, which records
// no reason and has had a try, as nothing else waiting without a reason has.
const fresh = `attempts = 0,
  run_at = CASE WHEN n.reason = '` + reasonPushUnavailable + `' OR (n.reason IS NULL AND n.attempts > 0) THEN least(n.run_at, now()) ELSE n.run_at END,
  reason = CASE WHEN n.reason = '` + reasonPushUnavailable + `' THEN NULL ELSE n.reason END`

// Queue queues ns in tx, the transaction of what caused them, in ctx's household: they exist exactly
// when it commits. A notification whose Coalesce matches one still waiting for its recipient merges
// into it, the latest when two wait; one that matches one going out now, or sent within Window, waits
// until Window has passed since, and the repeats after it merge into it. One whose Replaces matches
// one still waiting drops it. The caller calls Nudge once tx has committed.
//
// Two transactions queueing one recipient's repeats under one key at once take turns, under an
// advisory lock held until tx ends: each would otherwise find none waiting that the other has not
// committed yet, and both would go. The locks a call takes are taken in one order, so that two calls
// with the same keys never wait on each other's.
func (s *Service) Queue(ctx context.Context, tx pgx.Tx, ns ...Notification) error {
	scope := tenant.From(ctx)
	if scope == nil {
		return tenant.ErrNoTenant
	}
	household := scope.HouseholdID()
	var keys []string
	for _, n := range ns {
		if n.Coalesce != "" {
			keys = append(keys, coalescing(household, n.To, n.Coalesce))
		}
	}
	if err := lockCoalescing(ctx, tx, keys); err != nil {
		return err
	}
	for _, n := range ns {
		if err := n.check(); err != nil {
			return err
		}
		args := n.Args
		if args == nil {
			args = i18n.Args{}
		}
		if n.Replaces != "" {
			if err := withdraw(ctx, tx, household, n.Replaces, reasonReplaced); err != nil {
				return err
			}
		}
		if n.Coalesce != "" {
			// Into one alone, the latest: two may still wait at once, one put back after its claim and a
			// repeat queued meanwhile that had been tried already, which fold leaves, and a repeat merged
			// into both would go twice, each counting it. The outer conditions are read again on
			// a row a worker claims meanwhile, which then takes nothing, and the repeat is queued to wait
			// Window as one going out makes it. The merged one says what the repeat says, the latest
			// word, counting the repeats, and is fresh.
			tag, err := tx.Exec(ctx, `
				UPDATE notifications n SET count = n.count + 1, category = $8, message = $9, args = $4, link = $5, module = $6, owner_id = $7,
				  `+fresh+`
				WHERE n.household_id = $1 AND n.status = 'queued' AND n.claim IS NULL AND n.id = (
				  SELECT id FROM notifications
				  WHERE household_id = $1 AND user_id = $2 AND coalesce_key = $3 AND status = 'queued' AND claim IS NULL
				  ORDER BY created_at DESC, id DESC LIMIT 1)`,
				household, n.To, n.Coalesce, args, nullable(n.Link), nullable(n.Module), nullableID(n.Owner), string(n.Category), n.Message)
			if err != nil {
				return fmt.Errorf("notify: coalesce: %w", err)
			}
			if tag.RowsAffected() > 0 {
				continue
			}
		}
		id := idgen.New()
		var secret []byte
		if n.Secret != "" {
			secret = s.cfg.Keys.Seal(id, []byte(n.Secret))
		}
		// One going out now, claimed, is as good as sent: a repeat neither merges into it, nor goes
		// straight after it, but waits Window from now, and merges into it should it be put back
		// without going (fold).
		if _, err := tx.Exec(ctx, `
			INSERT INTO notifications (household_id, id, user_id, address, locale, category, message, args, route, secret,
			                           module, owner_id, link, coalesce_key, email, replace_key, run_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $17,
			        coalesce((SELECT max(coalesce(settled_at, now())) + make_interval(secs => $16) FROM notifications
			                  WHERE household_id = $1 AND user_id = $3 AND coalesce_key = $14
			                    AND ((status = 'sent' AND settled_at > now() - make_interval(secs => $16))
			                         OR (status = 'queued' AND claim IS NOT NULL))), now()))`,
			household, id, nullableID(n.To), nullable(n.Address), nullable(n.Locale), string(n.Category), n.Message, args,
			nullable(n.Route), secret, nullable(n.Module), nullableID(n.Owner), nullable(n.Link), nullable(n.Coalesce),
			n.Email, Window.Seconds(), nullable(n.Replaces)); err != nil {
			return fmt.Errorf("notify: queue: %w", err)
		}
	}
	return nil
}

// Withdraw drops, in tx, what still waits in ctx's household under each of keys (Notification.Replaces),
// once nothing should go: an invitation withdrawn, declined or accepted, a graduation's link spent.
// Each drop is logged. One a worker is sending at this moment may still arrive, and is then logged as
// sent after its drop, but is not sent again.
func (s *Service) Withdraw(ctx context.Context, tx pgx.Tx, keys ...string) error {
	scope := tenant.From(ctx)
	if scope == nil {
		return tenant.ErrNoTenant
	}
	for _, key := range keys {
		if err := withdraw(ctx, tx, scope.HouseholdID(), key, reasonWithdrawn); err != nil {
			return err
		}
	}
	return nil
}

// withdraw drops what waits in household under key, for reason, erasing its address and its sealed
// secret and logging each drop. One a worker has claimed keeps its claim, for the worker, which read
// all it sends when it claimed it, to settle it as what became of it: sent, when it went, which the log
// then says after the drop, and otherwise left dropped, never tried again (retry).
func withdraw(ctx context.Context, tx pgx.Tx, household uuid.UUID, key, reason string) error {
	rows, err := tx.Query(ctx, `
		UPDATE notifications SET status = 'dropped', reason = $3, settled_at = now(), address = NULL, secret = NULL,
		  args_expires_at = now() + make_interval(secs => $4)
		WHERE household_id = $1 AND replace_key = $2 AND status = 'queued'
		RETURNING id, user_id, category::text, email`, household, key, reason, keepBodies.Seconds())
	if err != nil {
		return fmt.Errorf("notify: withdraw: %w", err)
	}
	dropped, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (queued, error) {
		q := queued{household: household}
		err := row.Scan(&q.id, &q.user, &q.category, &q.email)
		return q, err
	})
	if err != nil {
		return fmt.Errorf("notify: withdraw: %w", err)
	}
	for _, q := range dropped {
		if err := logAttempts(ctx, tx, q, []attempt{{status: "dropped", reason: reason}}); err != nil {
			return err
		}
	}
	return nil
}

// Nudge wakes the workers for household, once a transaction that queued notifications of its has
// committed: they deliver to it without looking across every household, which they do every Poll.
// Inline, it delivers them before it returns.
func (s *Service) Nudge(ctx context.Context, household uuid.UUID) {
	if s.cfg.Inline {
		s.Drain(context.WithoutCancel(ctx), household)
		return
	}
	s.mu.Lock()
	s.nudged[household] = true
	s.mu.Unlock()
	s.signal()
}

// signal wakes Run, unless a wake already waits for it.
func (s *Service) signal() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// system is ctx in household's context with no caller: the platform's own reads and writes there.
func (s *Service) system(ctx context.Context, household uuid.UUID) context.Context {
	return tenant.Assume(ctx, s.cfg.Pool, household, uuid.Nil, "")
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func nullableID(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}
