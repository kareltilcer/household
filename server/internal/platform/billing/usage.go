package billing

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/money"
	"github.com/kareltilcer/household/server/internal/platform/storage"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// usageDoc is the contract's UsageSummary.
type usageDoc struct {
	PeriodFrom        string      `json:"period_from"`
	PeriodTo          string      `json:"period_to"`
	CurrentBytes      int64       `json:"current_bytes"`
	MTDAverageBytes   int64       `json:"mtd_average_bytes"`
	ProjectedAverage  int64       `json:"projected_average_bytes"`
	IncludedBytes     int64       `json:"included_bytes"`
	IncludedBytesBase int64       `json:"included_bytes_base"`
	BlocksNow         int         `json:"blocks_now"`
	BlocksProjected   int         `json:"blocks_projected"`
	ProjectedCharge   money.Money `json:"projected_charge"`
	BytesToNextBlock  int64       `json:"bytes_to_next_block"`
	BytesToDropABlock *int64      `json:"bytes_to_drop_a_block"`
	UploadBlocked     bool        `json:"upload_blocked"`
	HardCeilingBytes  int64       `json:"hard_ceiling_bytes"`
}

// getUsage is getBillingUsage: the month's storage as it will be billed (FR-BI4), an owner's to read:
// what is stored now, the average of the month's daily samples so far, the average the month is
// projected to end on, the blocks each needs and what the projected ones cost, in the currency the
// household is charged in. The month is the calendar month, UTC's (D-128). An invoice is never the
// first place the number appears.
func (s *Service) getUsage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope, err := owner(ctx)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	household := scope.HouseholdID()
	var (
		usage storage.Usage
		plan  Plan
	)
	err = tenant.InTx(ctx, func(tx pgx.Tx) error {
		var err error
		if usage, err = storage.ReadUsage(ctx, tx, household, s.Now()); err != nil {
			return err
		}
		f, err := readFacts(ctx, tx, household)
		if err != nil {
			return err
		}
		plan = s.Prices.For(f.currency)
		subs, err := readSubscriptions(ctx, tx, household)
		if cur, ok := standing(subs, standingCurrent); ok {
			plan = s.Prices.For(cur.currency)
		}
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	a := s.Allowance
	now, projected := a.Blocks(usage.Average), a.Blocks(usage.Projected)
	included := a.Included(now)
	doc := usageDoc{
		PeriodFrom: usage.From.Format(day), PeriodTo: usage.To.AddDate(0, 0, -1).Format(day),
		CurrentBytes: usage.Current, MTDAverageBytes: usage.Average, ProjectedAverage: usage.Projected,
		IncludedBytes: included, IncludedBytesBase: a.Base, BlocksNow: now, BlocksProjected: projected,
		ProjectedCharge:  money.Money{AmountMinor: int64(projected) * plan.Block.AmountMinor, Currency: plan.Currency},
		BytesToNextBlock: max(0, included-usage.Average), HardCeilingBytes: a.Ceiling(),
		UploadBlocked: usage.Current >= a.Ceiling() || !scope.Entitlement().State().Uploads(),
	}
	if now > 0 {
		drop := usage.Average - a.Included(now-1)
		doc.BytesToDropABlock = &drop
	}
	httpx.WriteJSON(w, http.StatusOK, doc)
}

// storageLineKey is the catalog key of a storage line's description on an invoice.
const storageLineKey = "billing.storage_line"

// BillStorage bills every subscribed household the storage blocks of the calendar month that ended
// before now (PRD 04 §4, D-31, D-128): one line, added to the subscription's next invoice, for the
// blocks the mean of the month's daily samples came to, and none for a month that needs none. The
// scheduler runs it nightly, after the usage sample; a month is billed once, however many nights
// find it, and a night that failed is made up by the next. It returns how many lines it added; a
// household that fails is logged and the rest go on, and every failure is returned.
func (s *Service) BillStorage(ctx context.Context) (int, error) {
	if s.Processor == nil {
		return 0, nil
	}
	this, _ := storage.Month(s.Now())
	month := this.AddDate(0, -1, 0)
	rows, err := s.Meter.Query(ctx, "SELECT DISTINCT household_id FROM billing_subscriptions ORDER BY 1")
	if err != nil {
		return 0, err
	}
	households, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return 0, err
	}
	var (
		billed int
		failed error
	)
	for _, household := range households {
		added, err := s.billMonth(s.system(ctx, household), household, month)
		if added {
			billed++
		}
		if err != nil {
			s.Log.LogAttrs(ctx, slog.LevelError, "billing: a month's storage was not billed",
				slog.String(logging.KeyHouseholdID, household.String()), slog.String("month", month.Format(day)), slog.Any("error", err))
			failed = errors.Join(failed, err)
		}
		if ctx.Err() != nil {
			return billed, ctx.Err()
		}
	}
	return billed, failed
}

// billMonth bills household the storage of the month that began at month, once, and reports whether
// it added a line. Only a household whose subscription was its own before the month ended is billed
// it, and only while that subscription still charges: a month spent on trial, or before a
// subscription that has since ended, costs nothing. The month's row is written in the transaction
// that asks the processor for the line, under the household's lock, and names the line once the
// processor has answered: a failure writes neither, and the next night asks again, the processor
// answering the line it added if it had (Processor.StorageLine).
func (s *Service) billMonth(ctx context.Context, household uuid.UUID, month time.Time) (bool, error) {
	from, to := storage.Month(month)
	added := false
	err := tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		if err := lock(ctx, tx, household); err != nil {
			return err
		}
		var done bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM billing_storage_months WHERE household_id = $1 AND month = $2)",
			household, from).Scan(&done); err != nil || done {
			return err
		}
		subs, err := readSubscriptions(ctx, tx, household)
		if err != nil {
			return err
		}
		cur, ok := standing(subs, standingCurrent)
		if !ok || !cur.live() || cur.startedAt == nil || !cur.startedAt.Before(to) {
			return nil
		}
		usage, err := storage.MonthUsage(ctx, tx, household, from)
		if err != nil {
			return err
		}
		blocks := s.Allowance.Blocks(usage.Average)
		var item *string
		if blocks > 0 {
			price := s.Prices.For(cur.currency).Block
			if price.ID == "" {
				return ErrUnavailable
			}
			f, err := readFacts(ctx, tx, household)
			if err != nil {
				return err
			}
			description, err := s.Catalogs.Render(i18n.Match(f.locale), storageLineKey, i18n.Args{
				"month": from.Format("2006-01"), "blocks": int64(blocks), "gb": s.Allowance.Block / storage.GB,
			})
			if err != nil {
				return err
			}
			id, err := s.Processor.StorageLine(ctx, StorageLine{
				Customer: cur.customer, Subscription: cur.id, Price: price.ID, Blocks: blocks, Household: household,
				Month: from.Format(day), From: from, To: to, Description: description,
			})
			if err != nil {
				return err
			}
			item, added = &id, true
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO billing_storage_months (household_id, month, sampled_days, average_bytes, blocks, stripe_invoice_item_id)
			VALUES ($1, $2, $3, $4, $5, $6)`, household, from, len(usage.Samples), usage.Average, blocks, item)
		return err
	})
	if errors.Is(err, errGone) {
		return false, nil
	}
	return added && err == nil, err
}
