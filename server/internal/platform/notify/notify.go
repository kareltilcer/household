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
// again with backoff; a push is not, since its push service holds it for the device already.
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
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

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
	// changed, by whichever owner and however many times in a few minutes.
	Coalesce string
	// Email sends it by email: one of the fixed set, security, billing, invitations and a member's
	// removal, that arrives whatever the member muted, quiet hours or not (FR-NT1).
	Email bool
	// Route and Secret make an email's link: the web client's Route, with Secret in the fragment,
	// which no server is sent. The secret is sealed while it waits (Config.Keys).
	Route, Secret string
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
	case n.Address != "" && n.Coalesce != "":
		return errors.New("notify: an email to an address coalesces with nothing")
	case n.Secret != "" && (!n.Email || n.Route == ""):
		return errors.New("notify: a secret that no email's link carries")
	case n.Route != "" && (!n.Email || !routeName.MatchString(n.Route)):
		return errors.New("notify: a route that is no email's link")
	case n.Link != "" && (!strings.HasPrefix(n.Link, "/") || len(n.Link) > 512):
		return errors.New("notify: a link that is not a path in the app")
	case len(n.Coalesce) > 200:
		return errors.New("notify: a coalescing key over 200 bytes")
	}
	for _, c := range Categories {
		if c == n.Category {
			return nil
		}
	}
	return fmt.Errorf("notify: category %q", n.Category)
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
	return &Service{cfg: cfg, wake: make(chan struct{}, 1), busy: map[uuid.UUID]bool{}}, nil
}

// Queue queues ns in tx, the transaction of what caused them, in ctx's household: they exist exactly
// when it commits. A notification whose Coalesce matches one still waiting for its recipient merges
// into it; one that matches one sent within Window waits until Window has passed since, and the
// repeats after it merge into it. The caller calls Nudge once tx has committed.
func (s *Service) Queue(ctx context.Context, tx pgx.Tx, ns ...Notification) error {
	scope := tenant.From(ctx)
	if scope == nil {
		return tenant.ErrNoTenant
	}
	household := scope.HouseholdID()
	for _, n := range ns {
		if err := n.check(); err != nil {
			return err
		}
		args := n.Args
		if args == nil {
			args = i18n.Args{}
		}
		if n.Coalesce != "" {
			tag, err := tx.Exec(ctx, `
				UPDATE notifications SET count = count + 1, args = $4, link = $5, module = $6, owner_id = $7
				WHERE household_id = $1 AND user_id = $2 AND coalesce_key = $3 AND status = 'queued' AND claim IS NULL`,
				household, n.To, n.Coalesce, args, nullable(n.Link), nullable(n.Module), nullableID(n.Owner))
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
		if _, err := tx.Exec(ctx, `
			INSERT INTO notifications (household_id, id, user_id, address, locale, category, message, args, route, secret,
			                           module, owner_id, link, coalesce_key, email, run_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
			        coalesce((SELECT max(settled_at) + make_interval(secs => $16) FROM notifications
			                  WHERE household_id = $1 AND user_id = $3 AND coalesce_key = $14 AND status = 'sent'
			                    AND settled_at > now() - make_interval(secs => $16)), now()))`,
			household, id, nullableID(n.To), nullable(n.Address), nullable(n.Locale), string(n.Category), n.Message, args,
			nullable(n.Route), secret, nullable(n.Module), nullableID(n.Owner), nullable(n.Link), nullable(n.Coalesce),
			n.Email, Window.Seconds()); err != nil {
			return fmt.Errorf("notify: queue: %w", err)
		}
	}
	return nil
}

// Send queues ns in a transaction of their own, in household's context, as the system, and wakes the
// workers: what is told after a commit rather than in it, such as an access change (household.Hooks).
func (s *Service) Send(ctx context.Context, household uuid.UUID, ns ...Notification) error {
	scoped := s.system(ctx, household)
	if err := tenant.InWriteTx(scoped, func(tx pgx.Tx) error { return s.Queue(scoped, tx, ns...) }); err != nil {
		return err
	}
	s.Nudge(ctx, household)
	return nil
}

// Nudge wakes the workers, once a transaction that queued notifications of household's has
// committed. Inline, it delivers them before it returns.
func (s *Service) Nudge(ctx context.Context, household uuid.UUID) {
	if s.cfg.Inline {
		s.Drain(context.WithoutCancel(ctx), household)
		return
	}
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
