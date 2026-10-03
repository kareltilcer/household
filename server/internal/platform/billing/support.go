package billing

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	households "github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/money"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// The support actions of PRD 02 §8 that are billing's: extending a trial, applying a credit and
// re-issuing an invoice. They are what item 21's staff API calls, once it has checked who calls and
// logged it; nothing here is reached by a household's own routes.

// What a support action refuses.
var (
	// ErrNoTrial is ExtendTrial's refusal of a household that has subscribed: it has no trial to
	// extend, and its lapse is its subscription's.
	ErrNoTrial = errors.New("billing: the household has no trial to extend")
	// ErrNoSubscription is Credit's refusal of a household nobody pays for at the processor.
	ErrNoSubscription = errors.New("billing: the household has no subscription")
	// ErrCurrency is Credit's refusal of an amount in another currency than the household is charged in.
	ErrCurrency = errors.New("billing: the household is charged in another currency")
	// ErrNoInvoice is ResendInvoice's refusal of an invoice the household does not have.
	ErrNoInvoice = errors.New("billing: no such invoice")
	// ErrInvoiceUnpaid is ResendInvoice's refusal of an invoice that is not paid: its email says the
	// payment went through.
	ErrInvoiceUnpaid = errors.New("billing: the invoice is not paid")
)

// ExtendTrial gives household a trial that ends at until, which must lie ahead: a trial still running
// runs on to it, and a household whose trial ended unpaid, in grace or read-only since, is back on
// trial, its lapse and its countdown cleared. It is a mutation of the system's, recorded on the
// household's row as the clock's moves are.
func (s *Service) ExtendTrial(ctx context.Context, household uuid.UUID, until time.Time) error {
	if !until.After(s.Now()) {
		return errors.New("billing: a trial is extended to a time ahead")
	}
	return s.bill(s.system(ctx, household), household, func(_ pgx.Tx, b households.Billing) (households.Billing, error) {
		st := b.Status
		switch st.Billing {
		case entitlement.Trialing:
		case entitlement.Grace, entitlement.ReadOnly:
			// A lapse through dunning keeps the clock that says so (01020): it is no trial's.
			if st.DunningEndsAt != nil {
				return b, ErrNoTrial
			}
		case entitlement.Active, entitlement.PastDue, entitlement.Canceled, entitlement.Restricted, entitlement.Suspended:
			return b, ErrNoTrial
		}
		st.Billing, st.TrialEndsAt = entitlement.Trialing, until
		st.GraceEndsAt, st.LapsedAt, st.RetainedUntil, st.RetentionWarnings = nil, nil, nil, 0
		b.Status = st
		return b, nil
	})
}

// Credit credits amount to the customer who pays household's subscription, at the processor, whose
// next invoices draw on it; note says why, on the processor's record.
func (s *Service) Credit(ctx context.Context, household uuid.UUID, amount money.Money, note string) error {
	p, err := s.processor()
	if err != nil {
		return ErrUnavailable
	}
	if amount.AmountMinor <= 0 {
		return errors.New("billing: a credit is a positive amount")
	}
	var cur subscription
	err = tenant.InTx(s.system(ctx, household), func(tx pgx.Tx) error {
		subs, err := readSubscriptions(ctx, tx, household)
		if err != nil {
			return err
		}
		var ok bool
		if cur, ok = standing(subs, standingCurrent); !ok {
			return ErrNoSubscription
		}
		return nil
	})
	if err != nil {
		return err
	}
	if cur.currency != amount.Currency {
		return ErrCurrency
	}
	return p.Credit(ctx, NewCredit{Customer: cur.customer, AmountMinor: amount.AmountMinor, Currency: amount.Currency, Note: note})
}

// ResendInvoice emails household's invoice to its payer again, as it was when it was paid. Only a
// paid one is sent: the email is the one that says the payment went through, and one still open,
// voided or written off is read on the billing screen.
func (s *Service) ResendInvoice(ctx context.Context, household, invoice uuid.UUID) error {
	scoped := s.system(ctx, household)
	err := tenant.InWriteTx(scoped, func(tx pgx.Tx) error {
		var (
			payer  uuid.UUID
			number *string
			status string
		)
		err := tx.QueryRow(ctx, "SELECT payer_id, number, status FROM billing_invoices WHERE household_id = $1 AND id = $2", household, invoice).
			Scan(&payer, &number, &status)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNoInvoice
		}
		if err != nil {
			return err
		}
		if status != "paid" {
			return ErrInvoiceUnpaid
		}
		args := i18n.Args{"number": ""}
		if number != nil {
			args["number"] = *number
		}
		return s.Notify.Queue(scoped, tx, notify.Notification{
			To: payer, Category: notify.Direct, Message: emailInvoice, Email: true, Args: args, Route: billingRoute(household),
		})
	})
	if err != nil {
		return err
	}
	s.Notify.Nudge(ctx, household)
	return nil
}
