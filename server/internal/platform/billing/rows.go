package billing

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// What a subscription is to its household (billing_subscriptions.standing).
const (
	standingPending = "pending"
	standingCurrent = "current"
	standingEnded   = "ended"
)

// subscription is a household's subscription as the platform keeps it.
type subscription struct {
	id, customer       string
	payer              uuid.UUID
	standing, status   string
	interval, currency string
	periodStart        *time.Time
	periodEnd          *time.Time
	cancelAtPeriodEnd  bool
	brand, last4       *string
	expMonth, expYear  *int16
	reason             *string
	startedAt, endedAt *time.Time
}

const subscriptionColumns = `stripe_subscription_id, stripe_customer_id, payer_id, standing, status, billing_interval, currency,
	current_period_start, current_period_end, cancel_at_period_end, payment_method_brand, payment_method_last4,
	payment_method_exp_month, payment_method_exp_year, cancellation_reason, started_at, ended_at`

func scanSubscription(row pgx.CollectableRow) (subscription, error) {
	var s subscription
	err := row.Scan(&s.id, &s.customer, &s.payer, &s.standing, &s.status, &s.interval, &s.currency, &s.periodStart, &s.periodEnd,
		&s.cancelAtPeriodEnd, &s.brand, &s.last4, &s.expMonth, &s.expYear, &s.reason, &s.startedAt, &s.endedAt)
	return s, err
}

// readSubscriptions reads household's subscriptions, in tx in its context, the newest first.
func readSubscriptions(ctx context.Context, tx pgx.Tx, household uuid.UUID) ([]subscription, error) {
	rows, err := tx.Query(ctx, "SELECT "+subscriptionColumns+` FROM billing_subscriptions
		WHERE household_id = $1 ORDER BY created_at DESC, stripe_subscription_id`, household)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanSubscription)
}

// readStatus reads household's entitlement as its row has it now, in tx in its context.
func readStatus(ctx context.Context, tx pgx.Tx, household uuid.UUID) (entitlement.Status, error) {
	var e entitlement.Row
	if err := tx.QueryRow(ctx, entitlement.Query, household).Scan(e.Dest()...); err != nil {
		return entitlement.Status{}, err
	}
	return e.Status()
}

// standing returns the one of subs whose standing is what, if any.
func standing(subs []subscription, what string) (subscription, bool) {
	for _, s := range subs {
		if s.standing == what {
			return s, true
		}
	}
	return subscription{}, false
}

// lastEnded returns the one of subs that was the household's and ended last, if any.
func lastEnded(subs []subscription) (subscription, bool) {
	var (
		out   subscription
		found bool
	)
	for _, s := range subs {
		if s.standing != standingEnded || s.startedAt == nil || s.endedAt == nil {
			continue
		}
		if !found || s.endedAt.After(*out.endedAt) {
			out, found = s, true
		}
	}
	return out, found
}

// live reports whether s, as the processor last said it, still charges: active, past due or waiting
// out another's period.
func (s subscription) live() bool {
	return s.status == StatusActive || s.status == StatusPastDue || s.status == StatusTrialing
}

// paidUp reports whether s, as the processor last said it, leaves the household paid for until its
// period ends: active, or waiting out a period another has paid for, which its own trial ends with.
func (s subscription) paidUp() bool {
	return s.status == StatusActive || s.status == StatusTrialing
}

// said is s as the processor says p stands, at now: its fields as p has them, and its standing moved
// on where p moved it. One waiting becomes the household's once it is live, and is over once it
// expired unpaid; the household's is over once the processor cancelled it or gave up collecting it.
func (s subscription) said(p Subscription, now time.Time) subscription {
	next := s
	next.status, next.cancelAtPeriodEnd = p.Status, p.CancelAtPeriodEnd
	if p.Interval != "" {
		next.interval = p.Interval
	}
	if !p.PeriodStart.IsZero() {
		next.periodStart, next.periodEnd = &p.PeriodStart, &p.PeriodEnd
	}
	next.brand, next.last4, next.expMonth, next.expYear = nil, nil, nil, nil
	if pm := p.PaymentMethod; pm != nil {
		next.brand = &pm.Brand
		if len(pm.Last4) == 4 {
			next.last4 = &pm.Last4
		}
		if pm.ExpMonth >= 1 && pm.ExpMonth <= 12 {
			month, year := int16(pm.ExpMonth), int16(pm.ExpYear) //nolint:gosec // G115: a month and a year of the calendar.
			next.expMonth, next.expYear = &month, &year
		}
	}
	if p.CancellationReason != "" {
		next.reason = &p.CancellationReason
	}
	switch {
	case s.standing == standingPending && p.Live():
		next.standing, next.startedAt = standingCurrent, &now
	case s.standing != standingEnded && p.Over():
		next.standing, next.endedAt = standingEnded, &now
	}
	return next
}

// insert writes s as household's, in tx; one already kept is left as it is.
func (s subscription) insert(ctx context.Context, tx pgx.Tx, household uuid.UUID) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO billing_subscriptions (household_id, stripe_subscription_id, stripe_customer_id, payer_id, standing, status,
		                                   billing_interval, currency, current_period_start, current_period_end)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (household_id, stripe_subscription_id) DO NOTHING`,
		household, s.id, s.customer, s.payer, s.standing, s.status, s.interval, s.currency, s.periodStart, s.periodEnd)
	return err
}

// update writes what s says of household's subscription of its id, in tx.
func (s subscription) update(ctx context.Context, tx pgx.Tx, household uuid.UUID) error {
	_, err := tx.Exec(ctx, `
		UPDATE billing_subscriptions SET standing = $3, status = $4, billing_interval = $5, current_period_start = $6,
		  current_period_end = $7, cancel_at_period_end = $8, payment_method_brand = $9, payment_method_last4 = $10,
		  payment_method_exp_month = $11, payment_method_exp_year = $12, cancellation_reason = $13, started_at = $14,
		  ended_at = $15, updated_at = now()
		WHERE household_id = $1 AND stripe_subscription_id = $2`,
		household, s.id, s.standing, s.status, s.interval, s.periodStart, s.periodEnd, s.cancelAtPeriodEnd, s.brand, s.last4,
		s.expMonth, s.expYear, s.reason, s.startedAt, s.endedAt)
	return err
}

// newRow is the row of a subscription just made at the processor for household, paid by payer,
// waiting to become the household's.
func newRow(p Subscription, payer uuid.UUID, interval string) subscription {
	s := subscription{
		id: p.ID, customer: p.Customer, payer: payer, standing: standingPending, status: p.Status,
		interval: interval, currency: p.Currency,
	}
	if !p.PeriodStart.IsZero() {
		s.periodStart, s.periodEnd = &p.PeriodStart, &p.PeriodEnd
	}
	return s
}

// facts are what billing reads of a household's own row: who pays, what it is charged in, and what
// a customer made for its payer is told of it.
type facts struct {
	payer    *uuid.UUID
	label    *string
	member   bool
	currency string
	country  string
	locale   string
}

// readFacts reads household's, in tx in its context.
func readFacts(ctx context.Context, tx pgx.Tx, household uuid.UUID) (facts, error) {
	var f facts
	err := tx.QueryRow(ctx, `
		SELECT h.billing_payer_id, u.display_name,
		  EXISTS (SELECT FROM memberships m WHERE m.household_id = h.id AND m.user_id = h.billing_payer_id),
		  h.base_currency, h.country, h.locale
		FROM households h LEFT JOIN users u ON u.id = h.billing_payer_id
		WHERE h.id = $1`, household).Scan(&f.payer, &f.label, &f.member, &f.currency, &f.country, &f.locale)
	return f, err
}

// pays reports whether user is the household's payer.
func (f facts) pays(user uuid.UUID) bool { return f.payer != nil && *f.payer == user }

// offered is the payer's offer of billing to another owner (billing_transfers).
type offered struct {
	by, to            uuid.UUID
	byLabel, toLabel  string
	offeredAt, expiry time.Time
}

// readOffer reads household's offer still open at now, in tx in its context, and false for none.
func readOffer(ctx context.Context, tx pgx.Tx, household uuid.UUID, now time.Time) (offered, bool, error) {
	var o offered
	err := tx.QueryRow(ctx, `
		SELECT t.offered_by, t.offered_to, b.display_name, o.display_name, t.offered_at, t.expires_at
		FROM billing_transfers t JOIN users b ON b.id = t.offered_by JOIN users o ON o.id = t.offered_to
		WHERE t.household_id = $1 AND t.expires_at > $2`, household, now).
		Scan(&o.by, &o.to, &o.byLabel, &o.toLabel, &o.offeredAt, &o.expiry)
	if errors.Is(err, pgx.ErrNoRows) {
		return offered{}, false, nil
	}
	return o, err == nil, err
}

// isOwner reports whether user is one of household's owners, read in tx in its context.
func isOwner(ctx context.Context, tx pgx.Tx, household, user uuid.UUID) (bool, error) {
	var owner bool
	err := tx.QueryRow(ctx, "SELECT role = 'owner' FROM memberships WHERE household_id = $1 AND user_id = $2", household, user).
		Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return owner, err
}

// account is what a customer made for a payer is told of them.
type account struct {
	email, name, locale string
}

// customer returns the processor's customer of user in currency, making it when they have none:
// asked of the processor first, under a key of the user's and the currency's so that two requests at
// once make one, and kept on the account, where a second request finds it (billing_customers).
func (s *Service) customer(ctx context.Context, p Processor, user uuid.UUID, currency, country string) (string, error) {
	var (
		id string
		a  account
	)
	err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, "SELECT stripe_customer_id FROM billing_customers WHERE user_id = $1 AND currency = $2", user, currency).
			Scan(&id)
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		return tx.QueryRow(ctx, "SELECT coalesce(email, ''), display_name, locale FROM users WHERE id = $1", user).
			Scan(&a.email, &a.name, &a.locale)
	})
	if err != nil || id != "" {
		return id, err
	}
	made, err := p.CreateCustomer(ctx, NewCustomer{
		User: user, Email: a.email, Name: a.name, Locale: a.locale, Country: country,
		IdempotencyID: "customer:" + user.String() + ":" + currency,
	})
	if err != nil {
		return "", err
	}
	err = tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO billing_customers (user_id, currency, stripe_customer_id) VALUES ($1, $2, $3)
			ON CONFLICT (user_id, currency) DO UPDATE SET stripe_customer_id = billing_customers.stripe_customer_id
			RETURNING stripe_customer_id`, user, currency, made).Scan(&id)
	})
	return id, err
}

// verified refuses user, in tx, unless their address is verified: an unverified account cannot attach
// a payment method and subscribe (PRD 02 §3).
func verified(ctx context.Context, tx pgx.Tx, user uuid.UUID) (bool, error) {
	var ok bool
	err := tx.QueryRow(ctx, "SELECT email_verified_at IS NOT NULL FROM users WHERE id = $1", user).Scan(&ok)
	return ok, err
}
