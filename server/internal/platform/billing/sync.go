package billing

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	households "github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// SignatureHeader carries the processor's signature of a webhook's payload.
const SignatureHeader = "Stripe-Signature"

// dunningSlack is how long past the processor's last retry the hourly backstop waits before it takes
// a past_due household into grace itself (entitlement.Status.Advance): the processor's retries end
// at seven days and it says so as it happens, so the clock on the row is for a webhook that never
// arrives, and must not run out minutes before a last retry that would have succeeded.
const dunningSlack = 24 * time.Hour

// The emails billing sends, each of the fixed set that arrives whatever its reader muted (FR-NT1).
const (
	emailInvoice       = "email.invoice"
	emailPaymentFailed = "email.payment_failed"
	emailBillingOffer  = "email.billing_offer"
	// emailNotCollected tells a payer that the first payment of a subscription, a bank debit that
	// takes days to clear, did not go through, and that the subscription was therefore not started.
	emailNotCollected = "email.payment_not_collected"
	emailBillingMoved = "email.billing_moved"
	// messageDeclined is the push that tells the payer their offer of billing was declined.
	messageDeclined = "notification.billing_declined"
)

// webhook is postWebhooksStripe: what the processor tells the platform as it happens. Its signature
// proves it; an event says only what to look at, and the handler reads that from the processor as it
// stands and records it, so that an event delivered twice, late or out of order leaves the same
// state. Anything that fails answers 500, and the processor delivers the event again.
func (s *Service) webhook(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	p, err := s.processor()
	if err != nil {
		s.fail(w, r, err)
		return
	}
	payload, err := io.ReadAll(r.Body)
	if err != nil {
		s.fail(w, r, problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed}))
		return
	}
	event, err := p.Event(payload, r.Header.Get(SignatureHeader))
	if err != nil {
		s.Log.LogAttrs(ctx, slog.LevelWarn, "billing: a webhook was refused", slog.Any("error", err))
		problem.Write(w, reqctx.RequestID(ctx), problem.Validation(problem.FieldError{Field: "header:" + SignatureHeader, Code: problem.FieldInvalid}))
		return
	}
	if err := s.Handle(ctx, event); err != nil {
		s.Log.LogAttrs(ctx, slog.LevelError, "billing: a webhook failed", slog.String("event", event.ID),
			slog.String("type", event.Type), slog.Any("error", err))
		problem.Write(w, reqctx.RequestID(ctx), problem.Internal())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Handle acts on event: a subscription's, an invoice's, or a setup that succeeded. Any other is
// none of billing's.
func (s *Service) Handle(ctx context.Context, event Event) error {
	if event.Object == "" {
		return nil
	}
	switch {
	case strings.HasPrefix(event.Type, "customer.subscription."):
		return s.subscriptionChanged(ctx, event)
	case strings.HasPrefix(event.Type, "invoice."):
		return s.invoiceChanged(ctx, event)
	case event.Type == "setup_intent.succeeded":
		return s.setupSucceeded(ctx, event.Object)
	}
	return nil
}

// subscriptionChanged records what the processor says of the subscription event names, in the
// household its metadata names, read from the processor when the event carries none.
func (s *Service) subscriptionChanged(ctx context.Context, event Event) error {
	household := event.Household
	if household == uuid.Nil {
		sub, err := s.Processor.Subscription(ctx, event.Object)
		if err != nil {
			return err
		}
		household = sub.Household
	}
	if household == uuid.Nil {
		return nil
	}
	return s.sync(s.system(ctx, household), household, event.Object)
}

// errUnknown is a subscription the processor names that is none of the household's: one made by hand
// at the processor, whose metadata names no household or another.
var errUnknown = errors.New("billing: a subscription that is not the household's")

// sync records what the processor says of household's subscription id, and settles the household's
// row from it (settle). ctx is in the household's context, the system's or a caller's.
//
// The reading and the record are one unit under the household's lock: the subscription is read from
// the processor once the lock is held, so that of two deliveries the later reading is recorded last.
// A subscription that became the household's takes the place of the one it had, which is then
// cancelled at the processor: at the end of the period it has been paid for when it is paid up, so
// that nothing lapses in between and nobody pays twice (FR-BI6), and at once when it is past due.
//
// A subscription the processor holds for the household that no row records is one whose request
// ended between the processor's answer and its own record. It is taken up, so that it is not left
// charging its payer for a household that does not know of it: as the household's at once when it
// is paid for, whatever waits, and as the one waiting when it waits itself and the household has none
// waiting. Where one waits already, a second that waits too is ended, while it still waits
// (Processor.Abandon): one that charges is never ended for being unrecorded, which would undo a
// payment.
//
// A subscription is the household's once its payment went through, which its invoice says and its
// own status does not (Subscription.Paid, D-131): one paid for by a bank debit is active at the
// processor for the days the debit takes, and waits here until its invoice is paid. A debit that
// fails leaves it active there with its invoice voided, charging nothing until its next period: it is
// ended, and its payer told (unpaid).
func (s *Service) sync(ctx context.Context, household uuid.UUID, id string) error {
	return s.syncOnce(ctx, household, id, true)
}

// syncOnce is sync; again says whether a second subscription found to charge after all is read once
// more, which it is once and no further.
func (s *Service) syncOnce(ctx context.Context, household uuid.UUID, id string, again bool) error {
	now := s.Now()
	var (
		replaced       []subscription
		second, failed bool
	)
	err := tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		if err := lock(ctx, tx, household); err != nil {
			return err
		}
		said, err := s.Processor.Subscription(ctx, id)
		if err != nil {
			return err
		}
		if said.Household != household {
			return errUnknown
		}
		subs, err := readSubscriptions(ctx, tx, household)
		if err != nil {
			return err
		}
		var (
			row   subscription
			found bool
		)
		for _, sub := range subs {
			if sub.id == id {
				row, found = sub, true
			}
		}
		if !found {
			if said.Over() || said.Payer == uuid.Nil {
				return nil
			}
			row = newRow(said, said.Payer, said.Interval)
		}
		next := row.said(said, now)
		failed = next.standing == standingPending && said.Failed()
		if !found && next.standing == standingPending {
			if _, waiting := standing(subs, standingPending); waiting {
				second = true
				return nil
			}
		}
		if row.standing == standingPending && next.standing == standingCurrent {
			if old, ok := standing(subs, standingCurrent); ok {
				old.standing, old.endedAt = standingEnded, &now
				if err := old.update(ctx, tx, household); err != nil {
					return err
				}
			}
		}
		if !found {
			// As what it is to the household by now: one paid for is its own once the one before it
			// is over, above, and is never a second one waiting.
			if err := next.insert(ctx, tx, household); err != nil {
				return err
			}
		}
		if err := next.update(ctx, tx, household); err != nil {
			return err
		}
		// Every one that is over for the household and still charges at the processor, this delivery's
		// or an earlier one's whose cancellation did not get through.
		subs, err = readSubscriptions(ctx, tx, household)
		if err != nil {
			return err
		}
		if _, ok := standing(subs, standingCurrent); ok {
			for _, sub := range subs {
				if sub.standing == standingEnded && sub.live() && !sub.cancelAtPeriodEnd {
					replaced = append(replaced, sub)
				}
			}
		}
		return nil
	})
	switch {
	case errors.Is(err, errGone), errors.Is(err, errUnknown):
		return nil
	case err != nil:
		return err
	case second && failed:
		// Never recorded, and its first payment did not go through: ended, as one recorded is (unpaid), so
		// that it charges no later period for a household it was never the subscription of.
		return s.Processor.Cancel(ctx, id)
	case second:
		// Ended while it still waits. One that charges after all is read once more: paid for since it was
		// read above, it is taken up as the household's; with its payment still on its way, it is left
		// for the event its invoice sends.
		gone, err := s.Processor.Abandon(ctx, id)
		if err != nil || gone || !again {
			return err
		}
		return s.syncOnce(ctx, household, id, false)
	case failed:
		return s.unpaid(ctx, household, id)
	}
	for _, old := range replaced {
		if err := s.retire(ctx, household, old); err != nil {
			return err
		}
	}
	return s.settle(ctx, household)
}

// unpaid ends household's subscription id, which waits on a first payment that did not go through:
// it is cancelled at the processor, where it would otherwise stay active and charge its next period
// for a household it was never the subscription of, what the processor then says is recorded, and
// its payer is emailed, once, that the subscription was not started (D-131). The household is as it
// was, and its payer may subscribe again.
func (s *Service) unpaid(ctx context.Context, household uuid.UUID, id string) error {
	if err := s.Processor.Cancel(ctx, id); err != nil {
		return err
	}
	now := s.Now()
	told := false
	err := tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		if err := lock(ctx, tx, household); err != nil {
			return err
		}
		said, err := s.Processor.Subscription(ctx, id)
		if err != nil {
			return err
		}
		subs, err := readSubscriptions(ctx, tx, household)
		if err != nil {
			return err
		}
		for _, sub := range subs {
			if sub.id != id {
				continue
			}
			next := sub.said(said, now)
			if err := next.update(ctx, tx, household); err != nil {
				return err
			}
			if sub.standing != standingPending || next.standing != standingEnded {
				return nil
			}
			told = true
			return s.Notify.Queue(ctx, tx, notify.Notification{
				To: sub.payer, Category: notify.Direct, Message: emailNotCollected, Email: true, Route: billingRoute(household),
			})
		}
		return nil
	})
	if errors.Is(err, errGone) {
		return nil
	}
	if err == nil && told {
		s.Notify.Nudge(ctx, household)
	}
	return err
}

// retire cancels old at the processor, a subscription another took the place of, and records what
// the processor then says of it: at the end of the period it is paid up for, or at once when it is
// past due.
func (s *Service) retire(ctx context.Context, household uuid.UUID, old subscription) error {
	if old.status == StatusPastDue {
		if err := s.Processor.Cancel(ctx, old.id); err != nil {
			return err
		}
	} else if _, err := s.Processor.CancelAtPeriodEnd(ctx, old.id, true); err != nil {
		return err
	}
	return s.record(ctx, household, old.id)
}

// record writes what the processor says of household's subscription id as it stands, read once the
// household's lock is held, as sync reads it, so that the reading recorded last is the latest: a copy
// of the row read before the lock was let go, written back whole, would undo whatever a delivery
// recorded of it since, the event of its own cancellation among them. A subscription no row records
// is sync's to take up, and is left.
func (s *Service) record(ctx context.Context, household uuid.UUID, id string) error {
	now := s.Now()
	err := tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		if err := lock(ctx, tx, household); err != nil {
			return err
		}
		said, err := s.Processor.Subscription(ctx, id)
		if err != nil {
			return err
		}
		subs, err := readSubscriptions(ctx, tx, household)
		if err != nil {
			return err
		}
		for _, sub := range subs {
			if sub.id == id {
				return sub.said(said, now).update(ctx, tx, household)
			}
		}
		return nil
	})
	if errors.Is(err, errGone) {
		return nil
	}
	return err
}

// settle brings household's row to what its subscriptions, as they are recorded, make of it (decide),
// through the mutation spine. ctx is in the household's context, the system's or a caller's, whose
// change it then is.
func (s *Service) settle(ctx context.Context, household uuid.UUID) error {
	now := s.Now()
	return s.bill(ctx, household, func(tx pgx.Tx, b households.Billing) (households.Billing, error) {
		subs, err := readSubscriptions(ctx, tx, household)
		if err != nil {
			return b, err
		}
		next := decide(b, subs, now)
		if cur, ok := standing(subs, standingCurrent); ok {
			// Billing moves to whoever pays the household's subscription, an owner still: one made a
			// member since is left out, and the payer of record stays (D-103).
			owner, err := isOwner(ctx, tx, household, cur.payer)
			if err != nil {
				return b, err
			}
			if owner {
				next.Payer = &cur.payer
			} else if b.Payer == nil || *b.Payer != cur.payer {
				s.Log.LogAttrs(ctx, slog.LevelError, "billing: the subscription's payer is not an owner; the payer of record stays",
					slog.String(logging.KeyHouseholdID, household.String()))
			}
		}
		return next, nil
	})
}

// decide is what household's subscriptions make of its state at now (PRD 04 §3), from b, what its
// row says.
//
// One that is the household's and is paid up, or waits out a period another paid for, makes it
// active, with every clock cleared: at any point of a lapse's retention, which restores it (D-32).
// One the processor is still trying to collect makes a household that was paid up past_due, with the
// clock the hourly backstop reads; a household the backstop has already taken on stays where it is
// until a payment succeeds. With none, a household that was active or past_due has lost its
// subscription: canceled, with its countdown, when its payer cancelled it, and in grace when the
// processor gave up collecting. Any other household is left as it is: its trial or its lapse is the
// clock's.
func decide(b households.Billing, subs []subscription, now time.Time) households.Billing {
	next := b
	st := b.Status
	paying := st.Billing == entitlement.Active || st.Billing == entitlement.PastDue
	if cur, ok := standing(subs, standingCurrent); ok {
		switch cur.status {
		case StatusActive, StatusTrialing:
			st.Billing = entitlement.Active
			st.DunningEndsAt, st.GraceEndsAt, st.LapsedAt, st.RetainedUntil, st.RetentionWarnings = nil, nil, nil, nil, 0
		case StatusPastDue:
			if paying || st.Billing == "" || st.Billing == entitlement.Trialing {
				if st.Billing != entitlement.PastDue || st.DunningEndsAt == nil {
					ends := now.Add(entitlement.DunningFor + dunningSlack)
					st.DunningEndsAt = &ends
				}
				st.Billing = entitlement.PastDue
				st.GraceEndsAt, st.LapsedAt, st.RetainedUntil, st.RetentionWarnings = nil, nil, nil, 0
			}
		}
		next.Status = st
		return next
	}
	last, ok := lastEnded(subs)
	if !ok || !paying {
		return next
	}
	if last.reason != nil && *last.reason == ReasonRequested {
		retained := entitlement.RetainedUntil(now)
		st.Billing, st.LapsedAt, st.RetainedUntil, st.RetentionWarnings = entitlement.Canceled, &now, &retained, 0
		st.DunningEndsAt, st.GraceEndsAt = nil, nil
	} else {
		ends := now.Add(entitlement.GraceFor)
		st.Billing, st.GraceEndsAt = entitlement.Grace, &ends
		if st.DunningEndsAt == nil {
			// A lapse through dunning is told from a trial that ended by the clock it keeps (01020).
			st.DunningEndsAt = &now
		}
	}
	next.Status = st
	return next
}

// bill changes household's row to what decide makes of it under the household's lock
// (household.Bill), in one mutation of ctx's, and does what a move of the payer brings with it in the
// same transaction: the offer it was made on is spent, its email with it should that still wait, and
// whoever paid until now is told by email (FR-BI6). decide reads in tx and writes nothing.
func (s *Service) bill(ctx context.Context, household uuid.UUID, decide func(pgx.Tx, households.Billing) (households.Billing, error)) error {
	res, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		var before, after households.Billing
		rec, err := households.Bill(ctx, tx, household, func(b households.Billing) (households.Billing, error) {
			var err error
			before = b
			after, err = decide(tx, b)
			return after, err
		})
		if err != nil || rec.Event.Module == "" {
			return rec, err
		}
		if after.Payer == nil || (before.Payer != nil && *before.Payer == *after.Payer) {
			return rec, nil
		}
		if _, err := tx.Exec(ctx, "DELETE FROM billing_transfers WHERE household_id = $1", household); err != nil {
			return mutation.Record{}, err
		}
		if err := s.Notify.Withdraw(ctx, tx, offerKey); err != nil {
			return mutation.Record{}, err
		}
		if before.Payer == nil {
			return rec, nil
		}
		var name string
		if err := tx.QueryRow(ctx, "SELECT display_name FROM users WHERE id = $1", *after.Payer).Scan(&name); err != nil {
			return mutation.Record{}, err
		}
		return rec, s.Notify.Queue(ctx, tx, notify.Notification{
			To: *before.Payer, Category: notify.Direct, Message: emailBillingMoved, Email: true,
			Args: i18n.Args{"member": name}, Route: billingRoute(household),
		})
	})
	if err != nil {
		return err
	}
	if res.EventID != uuid.Nil {
		s.Notify.Nudge(ctx, household)
	}
	return nil
}

// billingRoute is the web client's billing screen of household (A-28), which an email's link opens.
func billingRoute(household uuid.UUID) string {
	return "households/" + household.String() + "/settings/billing"
}

// invoiceChanged records what the processor says of the invoice event names.
func (s *Service) invoiceChanged(ctx context.Context, event Event) error {
	household := event.Household
	if household == uuid.Nil {
		inv, err := s.Processor.Invoice(ctx, event.Object)
		if err != nil {
			return err
		}
		household = inv.Household
	}
	if household == uuid.Nil {
		return nil
	}
	return s.syncInvoice(s.system(ctx, household), household, event.Object)
}

// syncInvoice records household's invoice id as the processor has it, once it is issued, and tells
// its payer what they are owed to be told (PRD 04 §6): that it was paid, once, with where to read
// it, and of each retry that failed to collect it, once each. The first failure is the banner's
// alone, which the household's state shows its owners from then on; the retries after it, at one,
// three, five and seven days, are each emailed. An invoice for nothing, which a subscription that
// begins by waiting out another's period is issued, is not kept.
//
// An invoice of a subscription no row records, one whose request ended between the processor's
// answer and its record and whose own event has not been handled yet, is not dropped for arriving
// first: its subscription is taken up as its own event would have it (sync), and the invoice is
// recorded once it is the household's.
//
// An invoice of a subscription that still waits is what says whether it was paid for: the
// subscription is read again as the invoice is recorded (sync), and becomes the household's once the
// invoice is paid, or is ended once its payment failed. The processor sends no event of the
// subscription's own when a bank debit clears, since nothing of the subscription changes then.
func (s *Service) syncInvoice(ctx context.Context, household uuid.UUID, id string) error {
	unrecorded, waiting, err := s.recordInvoice(ctx, household, id)
	if err != nil {
		return err
	}
	if unrecorded != "" {
		if err := s.sync(ctx, household, unrecorded); err != nil {
			return err
		}
		if _, waiting, err = s.recordInvoice(ctx, household, id); err != nil {
			return err
		}
	}
	if waiting != "" {
		return s.sync(ctx, household, waiting)
	}
	return nil
}

// recordInvoice is syncInvoice's one reading of the invoice id, recorded under the household's lock.
// It returns the invoice's subscription as unrecorded when no row records it, and so nothing was
// recorded, and as waiting when the row that records it still waits to become the household's.
func (s *Service) recordInvoice(ctx context.Context, household uuid.UUID, id string) (unrecorded, waiting string, err error) {
	told := false
	err = tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		if err := lock(ctx, tx, household); err != nil {
			return err
		}
		inv, err := s.Processor.Invoice(ctx, id)
		if err != nil {
			return err
		}
		if inv.Status == "" || inv.Status == "draft" || inv.TotalMinor == 0 {
			return nil
		}
		// An invoice is its subscription's payer's, or, for one the processor ties to no subscription,
		// the payer's whose customer it bills.
		var (
			payer        uuid.UUID
			stands, kept string
		)
		err = tx.QueryRow(ctx, `
			SELECT payer_id, standing, stripe_subscription_id FROM billing_subscriptions
			WHERE household_id = $1 AND (stripe_subscription_id = $2 OR ($2 = '' AND stripe_customer_id = $3))
			ORDER BY (stripe_subscription_id = $2) DESC, created_at DESC LIMIT 1`, household, inv.Subscription, inv.Customer).
			Scan(&payer, &stands, &kept)
		if errors.Is(err, pgx.ErrNoRows) {
			unrecorded = inv.Subscription
			return nil
		}
		if err != nil {
			return err
		}
		if stands == standingPending && kept == inv.Subscription {
			waiting = kept
		}
		var (
			was      string
			attempts int
		)
		err = tx.QueryRow(ctx, "SELECT status, attempts FROM billing_invoices WHERE household_id = $1 AND stripe_invoice_id = $2",
			household, id).Scan(&was, &attempts)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		var ns []notify.Notification
		if inv.Status == "paid" && was != "paid" {
			ns = append(ns, notify.Notification{
				To: payer, Category: notify.Direct, Message: emailInvoice, Email: true,
				Args: i18n.Args{"number": inv.Number}, Route: billingRoute(household),
			})
		}
		// A retry that failed leaves the invoice open, or, where the account writes off what its last
		// retry could not collect, uncollectible by the time it is read here.
		if (inv.Status == "open" || inv.Status == "uncollectible") && inv.Attempts >= 2 && inv.Attempts > attempts {
			again := "no"
			if !inv.NextAttempt.IsZero() {
				again = "yes"
			}
			ns = append(ns, notify.Notification{
				To: payer, Category: notify.Direct, Message: emailPaymentFailed, Email: true,
				Args: i18n.Args{"again": again}, Route: billingRoute(household),
			})
		}
		if inv.Attempts > attempts {
			attempts = inv.Attempts
		}
		lines, err := json.Marshal(linesOf(inv.Lines))
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO billing_invoices (household_id, id, stripe_invoice_id, payer_id, number, status, currency, total_minor,
			                              tax_minor, issued_at, period_start, period_end, lines, attempts)
			VALUES ($1, $2, $3, $4, nullif($5, ''), $6, $7, $8, $9, $10, $11, $12, $13, $14)
			ON CONFLICT (household_id, stripe_invoice_id) DO UPDATE SET number = excluded.number, status = excluded.status,
			  total_minor = excluded.total_minor, tax_minor = excluded.tax_minor, issued_at = excluded.issued_at,
			  period_start = excluded.period_start, period_end = excluded.period_end, lines = excluded.lines,
			  attempts = excluded.attempts, updated_at = now()`,
			household, idgen.New(), id, payer, inv.Number, inv.Status, inv.Currency, inv.TotalMinor, inv.TaxMinor, inv.IssuedAt,
			inv.PeriodStart, inv.PeriodEnd, lines, attempts); err != nil {
			return err
		}
		told = len(ns) > 0
		return s.Notify.Queue(ctx, tx, ns...)
	})
	if errors.Is(err, errGone) {
		return "", "", nil
	}
	if err != nil {
		return "", "", err
	}
	if told {
		s.Notify.Nudge(ctx, household)
	}
	return unrecorded, waiting, nil
}

// linesOf is lines as the row keeps them: an array, never null.
func linesOf(lines []InvoiceLine) []InvoiceLine {
	if lines == nil {
		return []InvoiceLine{}
	}
	return lines
}

// setupSucceeded acts on a payment method the processor confirmed for later charges: the one a
// subscription is charged with from now on, or the card of the owner taking billing over.
func (s *Service) setupSucceeded(ctx context.Context, id string) error {
	intent, err := s.Processor.SetupIntent(ctx, id)
	if err != nil {
		return err
	}
	if intent.Household == uuid.Nil || intent.Status != "succeeded" || intent.PaymentMethod == "" {
		return nil
	}
	scoped := s.system(ctx, intent.Household)
	switch intent.Purpose {
	case PurposePaymentMethod:
		return s.methodConfirmed(scoped, intent)
	case PurposeTakeover:
		return s.takeOver(scoped, intent)
	}
	return nil
}

// methodConfirmed makes the payment method intent confirmed the one the household's subscription is
// charged with, and, when the processor is still trying to collect an invoice, tries it now with the
// new one rather than at the next retry.
func (s *Service) methodConfirmed(ctx context.Context, intent SetupIntent) error {
	household := intent.Household
	kept := false
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		subs, err := readSubscriptions(ctx, tx, household)
		if err != nil {
			return err
		}
		cur, ok := standing(subs, standingCurrent)
		kept = ok && cur.id == intent.Subscription && cur.payer == intent.User
		return nil
	})
	if err != nil || !kept {
		return err
	}
	said, err := s.Processor.SetPaymentMethod(ctx, intent.Subscription, intent.PaymentMethod)
	if err != nil {
		return err
	}
	if err := s.sync(ctx, household, intent.Subscription); err != nil {
		return err
	}
	if said.Status != StatusPastDue || said.LatestInvoice == "" {
		return nil
	}
	if err := s.Processor.Pay(ctx, said.LatestInvoice); err != nil {
		if errors.Is(err, ErrUnavailable) {
			return err
		}
		// The new method was refused too: the processor's retries go on, and its events say what comes.
		s.Log.LogAttrs(ctx, slog.LevelInfo, "billing: an invoice was not collected with the new payment method",
			slog.String(logging.KeyHouseholdID, household.String()), slog.Any("error", err))
	}
	return nil
}

// takeOver finishes the take-over of household's billing by the owner whose card intent confirmed
// (FR-BI6), while the offer made them still stands and they are an owner still. With a subscription
// to take over, it makes theirs, charged with the card: from the end of the period the household is
// paid up for, or at once when the processor could not collect it; sync then puts it in the old
// one's place, and settle moves the payer. With none, the payer alone moves (acceptAlone).
//
// The household is paid up by a subscription that is active, and by one that itself waits out a
// period another paid for, a take-over's whose period has not begun: its trial ends where that
// period does, and so does the trial of the one that takes over from it, so that billing handed on
// twice within one paid period charges nobody for days already paid for (D-133). So is it by one
// that is past due over an invoice that bills no base fee, a yearly plan's month of storage: the
// period itself is paid for, the new subscription waits for its end as for any other's, and the old
// one is ended at once with that invoice voided (retire), so that what it could not collect is tried
// against nobody. Only a period the processor could not collect, a renewal's, has the new one
// charged at once.
//
// What the household is paid up for is the processor's to say, as it stands under the lock, and is
// recorded as sync records it: the row is what the last event to arrive said, and a renewal or a
// collection whose event is still on its way would otherwise have the new subscription charged at
// once for a period the old one has just been paid for, or the old one ended at once, unrefunded. One
// the processor says has ended since leaves none to take over: it is settled, and the payer moves
// alone.
//
// A subscription still waiting is ended for the one this card makes, one an earlier card could not
// pay among them: a subscription is made with its payment method and never has one changed while it
// waits unpaid, which the processor does not promise to take. It is ended only while the processor
// says it still waits (Processor.Abandon). One that charges is a confirmation's own, made by an
// earlier delivery that did not get as far as recording it, or one whose payment, a bank debit, is
// still on its way: it is recorded and settled, which moves billing to whoever pays it once it is
// paid for, and none is made. And where the household's subscription is theirs
// already, an earlier delivery made it and did not get as far as settling: it is recorded and
// settled again, and none is made.
func (s *Service) takeOver(ctx context.Context, intent SetupIntent) error {
	household, now := intent.Household, s.Now()
	var (
		// made is the subscription this card made, and kept one that charges already, which is recorded
		// rather than another made.
		made, kept string
		alone      bool
	)
	err := tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		if err := lock(ctx, tx, household); err != nil {
			return err
		}
		offer, ok, err := readOffer(ctx, tx, household, now)
		if err != nil || !ok || offer.to != intent.User {
			return err
		}
		if owner, err := isOwner(ctx, tx, household, intent.User); err != nil || !owner {
			return err
		}
		subs, err := readSubscriptions(ctx, tx, household)
		if err != nil {
			return err
		}
		cur, ok := standing(subs, standingCurrent)
		if !ok {
			alone = true
			return nil
		}
		if cur.payer == intent.User {
			// Theirs already, by an earlier delivery of this confirmation: nothing more is asked for.
			kept = cur.id
			return nil
		}
		held, err := s.Processor.Subscription(ctx, cur.id)
		if err != nil {
			return err
		}
		cur = cur.said(held, now)
		if err := cur.update(ctx, tx, household); err != nil {
			return err
		}
		if cur.standing != standingCurrent {
			alone = true
			return nil
		}
		if waiting, ok := standing(subs, standingPending); ok {
			gone, err := s.Processor.Abandon(ctx, waiting.id)
			if err != nil {
				return err
			}
			if !gone {
				kept = waiting.id
				return nil
			}
			waiting.standing, waiting.status, waiting.endedAt = standingEnded, StatusCanceled, &now
			if err := waiting.update(ctx, tx, household); err != nil {
				return err
			}
		}
		price := s.Prices.For(cur.currency).Base(cur.interval)
		if price.ID == "" {
			return ErrUnavailable
		}
		n := NewSubscription{
			Customer: intent.Customer, Price: price.ID, Household: household, Payer: intent.User,
			Monthly: cur.interval == Year, PaymentMethod: intent.PaymentMethod, AutomaticTax: s.AutomaticTax,
			IdempotencyID: "takeover:" + intent.ID,
		}
		// Paid up: the new one waits for the period's end. Its period uncollected, or about to renew, it
		// starts now. Past due says only that the processor could not collect the subscription's latest
		// invoice: one that bills no base fee, a yearly plan's month of storage (D-130), leaves the
		// period itself paid for, and a new payer charged at once would pay for its days again.
		paid := cur.paidUp()
		if cur.status == StatusPastDue && held.LatestInvoice != "" {
			owed, err := s.Processor.Invoice(ctx, held.LatestInvoice)
			if err != nil {
				return err
			}
			paid = !owed.BillsBase()
		}
		if paid && cur.periodEnd != nil && cur.periodEnd.After(now.Add(time.Hour)) {
			n.TrialEnd = *cur.periodEnd
		}
		sub, _, err := s.Processor.Subscribe(ctx, n)
		if err != nil {
			return err
		}
		made = sub.ID
		return newRow(sub, intent.User, cur.interval).insert(ctx, tx, household)
	})
	switch {
	case errors.Is(err, errGone):
		return nil
	case err != nil:
		return err
	case made != "":
		return s.sync(ctx, household, made)
	case kept != "":
		return s.sync(ctx, household, kept)
	case alone:
		// What a subscription that ended makes of the household first, which is a function of what is
		// recorded and changes nothing where its own event has settled it already. Then the payer: an
		// offer taken back since it was read, or an owner made a member, moves nothing.
		if err := s.settle(ctx, household); err != nil {
			return err
		}
		_, err := s.acceptAlone(ctx, household, intent.User)
		return err
	}
	return nil
}
