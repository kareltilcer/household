package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// What export and erasure ask of billing (plan item 20, ADR 0021): a household deleted is no longer
// charged, an erased account's customers go with it, and what billing keeps of a payer is theirs to
// take.

// Close ends, at the processor, every subscription of household's that is not over there: the one
// it has, one that waits, and one another took the place of that still runs to its period's end. tx
// is the transaction that erases the household, in its context, which holds its row: the
// subscriptions are ended once nothing can cancel the erasure any more, and before their rows go,
// since afterwards nothing names them, and a subscription nobody ends charges its payer for a
// household that is gone. They end now, with no final invoice and nothing prorated
// (Processor.Cancel). Ending one twice is ending it once, so an erasure that failed after this runs
// it again. A household with a subscription and no processor configured to end it at is refused
// (ErrUnavailable), and is not erased.
func (s *Service) Close(ctx context.Context, tx pgx.Tx, household uuid.UUID) error {
	subs, err := readSubscriptions(ctx, tx, household)
	if err != nil {
		return err
	}
	for _, sub := range subs {
		if sub.status == StatusCanceled || sub.status == StatusIncompleteExpired {
			continue
		}
		if s.Processor == nil {
			return fmt.Errorf("%w: no processor to end a deleted household's subscription at", ErrUnavailable)
		}
		if err := s.Processor.Cancel(ctx, sub.id); err != nil {
			return err
		}
	}
	return nil
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
	Standing          string         `json:"standing"`
	Status            string         `json:"status"`
	Interval          string         `json:"interval"`
	Currency          string         `json:"currency"`
	CurrentPeriodFrom *time.Time     `json:"current_period_start"`
	CurrentPeriodTo   *time.Time     `json:"current_period_end"`
	CancelAtPeriodEnd bool           `json:"cancel_at_period_end"`
	PaymentMethod     map[string]any `json:"payment_method"`
	StartedAt         *time.Time     `json:"started_at"`
	EndedAt           *time.Time     `json:"ended_at"`
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
			out.PaymentMethod = map[string]any{"brand": *sub.brand, "last4": sub.last4, "exp_month": sub.expMonth, "exp_year": sub.expYear}
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
