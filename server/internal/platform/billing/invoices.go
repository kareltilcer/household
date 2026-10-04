package billing

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/cursor"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/money"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// invoiceKeys is the invoices' listing order: the newest first, by when each was issued and then by
// its id.
var invoiceKeys = cursor.NewKeyset("billing.invoices", 2)

// linkWait bounds the read of an invoice's link from the processor: an invoice is answered without
// its link rather than as late as the processor's own timeout and retries would have it, which a
// request to change something waits out and a read of what is already kept need not.
const linkWait = 5 * time.Second

// invoiceDoc is the contract's Invoice. Its days are UTC's, as the storage month it may bill is
// (D-109).
type invoiceDoc struct {
	ID         uuid.UUID   `json:"id"`
	Number     *string     `json:"number"`
	IssuedOn   string      `json:"issued_on"`
	PeriodFrom string      `json:"period_from"`
	PeriodTo   string      `json:"period_to"`
	Status     string      `json:"status"`
	Total      money.Money `json:"total"`
	Tax        money.Money `json:"tax"`
	Lines      []lineDoc   `json:"lines"`
	PDFURL     *string     `json:"pdf_url"`
}

// lineDoc is one line of an invoice: the base fee and the storage blocks are lines of their own
// (PRD 04 §6), so that what it came to is answerable without opening the PDF.
type lineDoc struct {
	Kind        string      `json:"kind"`
	Description string      `json:"description"`
	Quantity    *string     `json:"quantity"`
	Amount      money.Money `json:"amount"`
}

// invoiceRow is an invoice as the platform keeps it.
type invoiceRow struct {
	id       uuid.UUID
	stripe   string
	number   *string
	status   string
	currency string
	total    int64
	tax      int64
	issued   time.Time
	from, to time.Time
	lines    []byte
}

const invoiceColumns = `id, stripe_invoice_id, number, status, currency, total_minor, tax_minor, issued_at, period_start,
	period_end, lines`

func scanInvoice(row pgx.CollectableRow) (invoiceRow, error) {
	var i invoiceRow
	err := row.Scan(&i.id, &i.stripe, &i.number, &i.status, &i.currency, &i.total, &i.tax, &i.issued, &i.from, &i.to, &i.lines)
	return i, err
}

const day = "2006-01-02"

// doc is i as the contract has it. The period's last day is the day before the instant it ends at.
func (i invoiceRow) doc() (invoiceDoc, error) {
	var lines []InvoiceLine
	if err := json.Unmarshal(i.lines, &lines); err != nil {
		return invoiceDoc{}, err
	}
	out := invoiceDoc{
		ID: i.id, Number: i.number, Status: i.status,
		IssuedOn: i.issued.UTC().Format(day), PeriodFrom: i.from.UTC().Format(day),
		PeriodTo: i.to.UTC().Add(-time.Second).Format(day),
		Total:    money.Money{AmountMinor: i.total, Currency: i.currency},
		Tax:      money.Money{AmountMinor: i.tax, Currency: i.currency},
		Lines:    make([]lineDoc, 0, len(lines)),
	}
	if !i.to.After(i.from) {
		out.PeriodTo = out.PeriodFrom
	}
	for _, l := range lines {
		out.Lines = append(out.Lines, lineDoc{
			Kind: l.Kind, Description: l.Description, Quantity: l.Quantity,
			Amount: money.Money{AmountMinor: l.AmountMinor, Currency: i.currency},
		})
	}
	return out, nil
}

// reads refuses user the invoices of household, read in tx, unless they are its payer or paid some of
// them before handing billing on: an invoice is its payer's, and another owner sees billing's state
// and none of them (FR-BI5).
func reads(ctx context.Context, tx pgx.Tx, household, user uuid.UUID) error {
	f, err := readFacts(ctx, tx, household)
	if err != nil || f.pays(user) {
		return err
	}
	var paid bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM billing_invoices WHERE household_id = $1 AND payer_id = $2)",
		household, user).Scan(&paid); err != nil {
		return err
	}
	if !paid {
		return forbidden()
	}
	return nil
}

// listInvoices is getBillingInvoices: the invoices the caller paid, the newest first.
func (s *Service) listInvoices(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope, err := owner(ctx)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	before, last, err := invoiceKeys.Before(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	limit := cursor.Limit(r)
	var rows []invoiceRow
	err = tenant.InTx(ctx, func(tx pgx.Tx) error {
		if err := reads(ctx, tx, scope.HouseholdID(), scope.UserID()); err != nil {
			return err
		}
		found, err := tx.Query(ctx, "SELECT "+invoiceColumns+` FROM billing_invoices
			WHERE household_id = $1 AND payer_id = $2 AND ($3::timestamptz IS NULL OR (issued_at, id) < ($3, $4))
			ORDER BY issued_at DESC, id DESC LIMIT $5`,
			scope.HouseholdID(), scope.UserID(), before, last, limit+1)
		if err != nil {
			return err
		}
		rows, err = pgx.CollectRows(found, scanInvoice)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	meta := cursor.PageMeta{}
	if len(rows) > limit {
		rows = rows[:limit]
		meta = invoiceKeys.After(rows[limit-1].issued, rows[limit-1].id)
	}
	items := make([]invoiceDoc, 0, len(rows))
	for _, row := range rows {
		doc, err := row.doc()
		if err != nil {
			s.fail(w, r, err)
			return
		}
		items = append(items, doc)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "meta": meta})
}

// getInvoice is getBillingInvoicesByInvoiceId: one invoice the caller paid, with where its PDF is
// downloaded, which the processor hands out as it is asked: the link is not kept. An invoice that
// is someone else's is not found, and one whose link the processor cannot give now, or within
// linkWait, is answered without it.
func (s *Service) getInvoice(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope, err := owner(ctx)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "invoice_id"))
	if err != nil {
		s.fail(w, r, problem.NotFound())
		return
	}
	var row invoiceRow
	err = tenant.InTx(ctx, func(tx pgx.Tx) error {
		found, err := tx.Query(ctx, "SELECT "+invoiceColumns+` FROM billing_invoices
			WHERE household_id = $1 AND id = $2 AND payer_id = $3`, scope.HouseholdID(), id, scope.UserID())
		if err != nil {
			return err
		}
		row, err = pgx.CollectExactlyOneRow(found, scanInvoice)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.NotFound()
		}
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	doc, err := row.doc()
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if s.Processor != nil {
		bounded, cancel := context.WithTimeout(ctx, linkWait)
		pdf, err := s.Processor.InvoicePDF(bounded, row.stripe)
		cancel()
		switch {
		case err != nil:
			s.Log.LogAttrs(ctx, slog.LevelWarn, "billing: an invoice's link was not read", slog.Any("error", err))
		case pdf != "":
			doc.PDFURL = &pdf
		}
	}
	httpx.WriteJSON(w, http.StatusOK, doc)
}
