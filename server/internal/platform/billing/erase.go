package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// What export and erasure ask of billing (plan item 20, ADR 0021): a household deleted is no longer
// charged, one being paid for again is not deleted for having lapsed, an erased account's customers
// go with it, and what billing keeps of a payer is theirs to take.

// ErrBehind is Close's refusal to end a subscription the household's rows say is not paid for where
// the processor says it is, or is being paid: a payment made, or on its way, whose event has not
// been handled. Nothing of the household's was ended. Whoever was erasing it leaves it, has the
// record brought up to what the processor says (Refresh), and decides again from that.
var ErrBehind = errors.New("billing: the processor has a payment the household's record has not")

// owing reports whether s is one the rows say is not paid for: one that waits and charges nothing
// yet, its first payment not confirmed, or the household's own with a payment the processor could
// not collect. The rows are what the processor's events said so far, so these are the ones a payment
// made since would change, and the ones the processor is asked of before they are ended (Close).
func (s subscription) owing() bool {
	switch s.standing {
	case standingPending:
		return !s.live()
	case standingCurrent:
		return !s.paidUp()
	}
	return false
}

// Close ends, at the processor, every subscription of household's that is not over there: the one
// it has, one that waits, and one another took the place of that still runs to its period's end. tx
// is the transaction that erases the household, in its context, which holds its row: the
// subscriptions are ended once nothing can cancel the erasure any more, and before their rows go,
// since afterwards nothing names them, and a subscription nobody ends charges its payer for a
// household that is gone. They end now, with no final invoice and nothing prorated
// (Processor.Cancel). Ending one twice is ending it once, so an erasure that failed after this runs
// it again. A household with a subscription and no processor configured to end it at is refused
// (ErrUnavailable), and is not erased.
//
// One the rows say is not paid for (owing) is ended only while the processor says so too, and before
// any other is: whoever decided the household is to be erased read those rows, and a payment that
// went through since, or whose event is late or lost, is never undone by a reading older than it.
// The household's own, which the rows say the processor could not collect, is read from the
// processor first, and one that waits is ended only while it still waits (Processor.Abandon). Where
// the processor says either is paid for, or one that waits charges, nothing is ended and the answer
// is ErrBehind: a lapsed household would otherwise be erased, and the subscription just paid for it
// ended unrefunded, where paying restores it at any point of its retention (PRD 04 §3, D-32).
func (s *Service) Close(ctx context.Context, tx pgx.Tx, household uuid.UUID) error {
	subs, err := readSubscriptions(ctx, tx, household)
	if err != nil {
		return err
	}
	now := s.Now()
	var waiting, open []subscription
	for _, sub := range subs {
		switch {
		case sub.status == StatusCanceled || sub.status == StatusIncompleteExpired:
			continue
		case s.Processor == nil:
			return fmt.Errorf("%w: no processor to end a deleted household's subscription at", ErrUnavailable)
		case !sub.owing():
			// One the rows know charges, or that another took the place of: ended with the rest, below.
		case sub.standing == standingPending:
			waiting = append(waiting, sub)
			continue
		default:
			// The household's own, as the processor has it now: one it no longer has is over already,
			// and one it says is over, or still could not collect, is ended with the rest.
			said, err := s.Processor.Subscription(ctx, sub.id)
			switch {
			case missing(err):
			case err != nil:
				return err
			default:
				if next := sub.said(said, now); next.standing == standingCurrent && next.paidUp() {
					return ErrBehind
				}
			}
		}
		open = append(open, sub)
	}
	for _, sub := range waiting {
		gone, err := s.Processor.Abandon(ctx, sub.id)
		switch {
		case err != nil:
			return err
		case !gone:
			return ErrBehind
		}
	}
	for _, sub := range open {
		if err := s.Processor.Cancel(ctx, sub.id); err != nil {
			return err
		}
	}
	return nil
}

// Refresh records what the processor says of household's subscription that waits, and of its own
// where the rows say that one is not paid for, and settles the household's row from it, as the event
// that says it does (sync): what an erasure Close refused (ErrBehind) asks for, so that the household
// is decided again from what the processor has, a payment that made it active or one on its way that
// it waits for (Awaited), rather than left until an event that may never come. A household with
// neither is left as it is.
func (s *Service) Refresh(ctx context.Context, household uuid.UUID) error {
	scoped := s.system(ctx, household)
	var behind []string
	err := tenant.InTx(scoped, func(tx pgx.Tx) error {
		subs, err := readSubscriptions(ctx, tx, household)
		if err != nil {
			return err
		}
		if sub, ok := standing(subs, standingPending); ok {
			behind = append(behind, sub.id)
		}
		if sub, ok := standing(subs, standingCurrent); ok && sub.owing() {
			behind = append(behind, sub.id)
		}
		return nil
	})
	if err != nil || len(behind) == 0 {
		return err
	}
	if s.Processor == nil {
		return fmt.Errorf("%w: no processor to read a subscription from", ErrUnavailable)
	}
	for _, id := range behind {
		if err := s.sync(scoped, household, id); err != nil {
			return err
		}
	}
	return nil
}

// Awaited reports whether household is being paid for again, by what billing has recorded of its
// subscriptions, where its own row may still say it is lapsed. A lapsed household in that state is
// restored, at any point of its retention (PRD 04 §3, D-32), so its erasure waits. tx is a
// transaction of the household's. It is so in two cases:
//
//   - A subscription waits on a payment the processor has on its way (D-131): one that is not the
//     household's yet and charges there all the same, as one paid for by a bank debit does for the
//     days the debit takes. The erasure waits for what the processor says of the payment: gone
//     through, the household is active and no longer due, and failed, the subscription is ended and
//     nothing waits any more.
//   - Its own subscription is recorded as paid up. A payment is recorded in one transaction and the
//     household's row settled from the record in the next (sync, settle), so a household read between
//     the two, or after a settling that failed and before its event is delivered again, is lapsed
//     by its row and paid for by its subscription. Settled, it is active and no longer due.
func Awaited(ctx context.Context, tx pgx.Tx, household uuid.UUID) (bool, error) {
	subs, err := readSubscriptions(ctx, tx, household)
	if err != nil {
		return false, err
	}
	if cur, ok := standing(subs, standingCurrent); ok && cur.paidUp() {
		return true, nil
	}
	waiting, ok := standing(subs, standingPending)
	return ok && waiting.live(), nil
}

// Forget deletes user's customers at the processor, each with whatever subscription it still has
// there, which the processor ends with it: an erased account's (FR-PR4). The caller deletes their
// rows with the account's own (ForgetRows), once every one is gone there. A customer the processor
// no longer has is deleted already. The invoices it issued are the processor's record, which it
// keeps of a deleted customer as the statute asks (PRD 05 §1).
func (s *Service) Forget(ctx context.Context, user uuid.UUID) error {
	var customers []string
	err := tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT stripe_customer_id FROM billing_customers WHERE user_id = $1 ORDER BY currency", user)
		if err != nil {
			return err
		}
		customers, err = pgx.CollectRows(rows, pgx.RowTo[string])
		return err
	})
	if err != nil || len(customers) == 0 {
		return err
	}
	if s.Processor == nil {
		return fmt.Errorf("%w: no processor to delete an erased account's customer at", ErrUnavailable)
	}
	for _, customer := range customers {
		if err := s.Processor.DeleteCustomer(ctx, customer); err != nil {
			return err
		}
	}
	return nil
}

// ForgetRows deletes, in tx, the rows that name user's customers at the processor, once Forget has
// deleted the customers themselves: the account's own, which go with it.
func ForgetRows(ctx context.Context, tx pgx.Tx, user uuid.UUID) error {
	_, err := tx.Exec(ctx, "DELETE FROM billing_customers WHERE user_id = $1", user)
	return err
}

// exportedSubscription and exportedInvoice are what an export carries of each: what the payer reads
// of them in the app, without the processor's ids.
type exportedSubscription struct {
	Standing          string     `json:"standing"`
	Status            string     `json:"status"`
	Interval          string     `json:"interval"`
	Currency          string     `json:"currency"`
	CurrentPeriodFrom *time.Time `json:"current_period_start"`
	CurrentPeriodTo   *time.Time `json:"current_period_end"`
	CancelAtPeriodEnd bool       `json:"cancel_at_period_end"`
	// PaymentMethod is its summary as the payer reads it in the app (methodDoc), null for none.
	PaymentMethod *methodDoc `json:"payment_method"`
	StartedAt     *time.Time `json:"started_at"`
	EndedAt       *time.Time `json:"ended_at"`
}

type exportedInvoice struct {
	ID          uuid.UUID `json:"id"`
	Number      *string   `json:"number"`
	Status      string    `json:"status"`
	Currency    string    `json:"currency"`
	TotalMinor  int64     `json:"total_minor"`
	TaxMinor    int64     `json:"tax_minor"`
	IssuedAt    time.Time `json:"issued_at"`
	PeriodStart time.Time `json:"period_start"`
	PeriodEnd   time.Time `json:"period_end"`
	// Lines are the invoice's lines as they are kept, embedded as they are.
	Lines json.RawMessage `json:"lines"`
}

// Export writes what billing keeps of a household for an export's requester (FR-PR2, plan item 20):
// the subscriptions they pay or paid for there, each with its payment method's summary, and the
// invoices issued to them. Both are their payer's alone to read (FR-BI5, D-135), so an owner's export
// of the household carries none of another payer's, and a member who never paid has no billing.json
// at all. tx is a transaction of the household, as a module's export is handed one.
func Export(ctx context.Context, tx pgx.Tx, e module.Export, a module.Archive) error {
	if e.Scope == module.ExportDeparted {
		return nil
	}
	subs, err := readSubscriptions(ctx, tx, e.Household)
	if err != nil {
		return err
	}
	subscriptions := []exportedSubscription{}
	for _, sub := range subs {
		if sub.payer != e.Requester {
			continue
		}
		out := exportedSubscription{
			Standing: sub.standing, Status: sub.status, Interval: sub.interval, Currency: sub.currency,
			CurrentPeriodFrom: utc(sub.periodStart), CurrentPeriodTo: utc(sub.periodEnd), CancelAtPeriodEnd: sub.cancelAtPeriodEnd,
			StartedAt: utc(sub.startedAt), EndedAt: utc(sub.endedAt),
		}
		if sub.brand != nil {
			out.PaymentMethod = &methodDoc{Brand: *sub.brand, Last4: sub.last4, ExpMonth: sub.expMonth, ExpYear: sub.expYear}
		}
		subscriptions = append(subscriptions, out)
	}
	rows, err := tx.Query(ctx, `
		SELECT id, number, status, currency, total_minor, tax_minor, issued_at, period_start, period_end, lines
		FROM billing_invoices WHERE household_id = $1 AND payer_id = $2 ORDER BY issued_at, id`, e.Household, e.Requester)
	if err != nil {
		return err
	}
	invoices, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (exportedInvoice, error) {
		var (
			inv   exportedInvoice
			lines []byte
		)
		err := row.Scan(&inv.ID, &inv.Number, &inv.Status, &inv.Currency, &inv.TotalMinor, &inv.TaxMinor, &inv.IssuedAt,
			&inv.PeriodStart, &inv.PeriodEnd, &lines)
		inv.IssuedAt, inv.PeriodStart, inv.PeriodEnd = inv.IssuedAt.UTC(), inv.PeriodStart.UTC(), inv.PeriodEnd.UTC()
		inv.Lines = lines
		return inv, err
	})
	if err != nil {
		return err
	}
	if len(subscriptions) == 0 && len(invoices) == 0 {
		return nil
	}
	return a.JSON(map[string]any{"subscriptions": subscriptions, "invoices": invoices})
}
