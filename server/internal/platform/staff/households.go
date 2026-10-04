package staff

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/billing"
	"github.com/kareltilcer/household/server/internal/platform/cursor"
	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	"github.com/kareltilcer/household/server/internal/platform/fairuse"
	"github.com/kareltilcer/household/server/internal/platform/files"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/money"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/text"
)

// householdKeys is the households' listing order: the newest first, by when each was made and then
// by its id.
var householdKeys = cursor.NewKeyset("platform.households", 2)

// stateSQL is a household's state, as entitlement.Status.State resolves it (D-114), of a households
// row aliased h: a suspension first, then a lapse, then a restriction, then the subscription's own. A
// test holds the two to each other.
const stateSQL = `CASE WHEN h.suspended_at IS NOT NULL THEN 'suspended'
	WHEN h.billing_state IN ('read_only', 'canceled') THEN h.billing_state::text
	WHEN h.restricted_at IS NOT NULL THEN 'restricted'
	ELSE h.billing_state::text END`

// householdItem is the contract's PlatformHousehold as a search answers it: metadata only.
type householdItem struct {
	ID          uuid.UUID         `json:"id"`
	Name        string            `json:"name"`
	Country     string            `json:"country"`
	CreatedAt   time.Time         `json:"created_at"`
	State       entitlement.State `json:"state"`
	MemberCount int               `json:"member_count"`
}

const householdColumns = `h.id, h.name, h.country, h.created_at, ` + stateSQL + `,
	(SELECT count(*) FROM memberships m WHERE m.household_id = h.id)`

// householdDetail is the contract's PlatformHousehold as one household's read answers it: who is in
// it and with what role, what it enables and stores, how its subscription and its deliveries stand,
// which actions its log records, by their keys alone, and what staff set for it. No field carries
// anything a member wrote there but the household's name.
type householdDetail struct {
	householdItem
	TrialEndsAt         *time.Time        `json:"trial_ends_at"`
	GraceEndsAt         *time.Time        `json:"grace_ends_at"`
	DataRetainedUntil   *time.Time        `json:"data_retained_until"`
	SuspendedAt         *time.Time        `json:"suspended_at"`
	SuspensionNotice    *string           `json:"suspension_notice"`
	DeletionScheduledAt *time.Time        `json:"deletion_scheduled_at"`
	Members             []memberDoc       `json:"members"`
	ModulesEnabled      []string          `json:"modules_enabled"`
	StorageBytes        int64             `json:"storage_bytes"`
	StorageByModule     map[string]int64  `json:"storage_by_module"`
	RecentActionKeys    []actionCount     `json:"recent_action_keys"`
	LimitOverrides      []limitDoc        `json:"limit_overrides"`
	Flags               []flagDoc         `json:"flags"`
	Subscription        *subscriptionDoc  `json:"subscription"`
	Invoices            []invoiceDoc      `json:"invoices"`
	Notifications       []notificationDoc `json:"notifications"`
}

type memberDoc struct {
	UserID  uuid.UUID `json:"user_id"`
	Email   *string   `json:"email"`
	Role    string    `json:"role"`
	IsChild bool      `json:"is_child"`
}

// actionCount is how often an action was recorded in the household's log in the last thirty days:
// the action's key, and no summary, no diff, no entity and no actor (PRD 05 §6).
type actionCount struct {
	Action string `json:"action"`
	Count  int    `json:"count"`
}

// limitDoc is the contract's PlatformLimitOverride.
type limitDoc struct {
	Key    string     `json:"key"`
	Value  *int64     `json:"value"`
	Reason *string    `json:"reason,omitempty"`
	SetBy  *actorRef  `json:"set_by,omitempty"`
	SetAt  *time.Time `json:"set_at,omitempty"`
}

// flagDoc is a feature flag as it stands for a household: whether it is on, and whether that is the
// household's own setting rather than the platform's.
type flagDoc struct {
	Key        string `json:"key"`
	Enabled    bool   `json:"enabled"`
	Overridden bool   `json:"overridden"`
}

// subscriptionDoc is the household's plan: what it pays by, in which currency, and how it stands at
// the payment processor.
type subscriptionDoc struct {
	Interval          string     `json:"interval"`
	Status            string     `json:"status"`
	Currency          string     `json:"currency"`
	CurrentPeriodEnd  *time.Time `json:"current_period_end"`
	CancelAtPeriodEnd bool       `json:"cancel_at_period_end"`
}

// invoiceDoc is one invoice of the household's history: its number, its state and what it came to.
type invoiceDoc struct {
	ID       uuid.UUID   `json:"id"`
	Number   *string     `json:"number"`
	Status   string      `json:"status"`
	Total    money.Money `json:"total"`
	IssuedAt time.Time   `json:"issued_at"`
}

// notificationDoc is how one notification went: which message, by its catalog key, and with what
// outcome, never what it said or to which address. Redrivable says whether support can send it again.
type notificationDoc struct {
	ID         uuid.UUID  `json:"id"`
	Category   string     `json:"category"`
	Message    string     `json:"message"`
	Status     string     `json:"status"`
	Reason     *string    `json:"reason"`
	CreatedAt  time.Time  `json:"created_at"`
	SettledAt  *time.Time `json:"settled_at"`
	Redrivable bool       `json:"redrivable"`
}

// What a household's read shows of its history: its invoices and its notifications, the latest of
// each, and the actions of its last month.
const (
	shownInvoices      = 12
	shownNotifications = 20
	shownActions       = 50
	actionsWindow      = 30 * 24 * time.Hour
)

// searchHouseholds is getPlatformHouseholds: the households whose id q is, whose name holds it, or
// one of whose members has it as their address, in the state the request names, newest first.
func (s *Service) searchHouseholds(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	after, err := householdKeys.FromRequest(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var (
		before time.Time
		last   uuid.UUID
	)
	if after != nil {
		if before, err = time.Parse(time.RFC3339Nano, after[0]); err == nil {
			last, err = uuid.Parse(after[1])
		}
		if err != nil {
			s.fail(w, r, cursor.Malformed())
			return
		}
	}
	q, state, limit := trimmed(r, "q"), trimmed(r, "state"), limitOf(r)
	items := make([]householdItem, 0, limit)
	more := false
	err = s.read(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT `+householdColumns+` FROM households h
			WHERE ($1 = '' OR h.id::text = lower($1) OR `+contains("h.name", "$1")+`
			    OR EXISTS (SELECT FROM memberships m JOIN users u ON u.id = m.user_id
			               WHERE m.household_id = h.id AND lower(u.email) = lower($1)))
			  AND ($2 = '' OR `+stateSQL+` = $2)
			  AND ($3::timestamptz IS NULL OR (h.created_at, h.id) < ($3, $4))
			ORDER BY h.created_at DESC, h.id DESC LIMIT $5`,
			q, state, nullTime(before), last, limit+1)
		if err != nil {
			return err
		}
		var h householdItem
		_, err = pgx.ForEachRow(rows, []any{&h.ID, &h.Name, &h.Country, &h.CreatedAt, &h.State, &h.MemberCount}, func() error {
			if len(items) == limit {
				more = true
				return nil
			}
			h.CreatedAt = h.CreatedAt.UTC()
			items = append(items, h)
			return nil
		})
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	meta := pageMeta{HasMore: more}
	if more {
		end := items[len(items)-1]
		next := householdKeys.Encode(end.CreatedAt.Format(time.RFC3339Nano), end.ID.String())
		meta.NextCursor = &next
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "meta": meta})
}

// nullTime is t, or NULL for the zero time.
func nullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}

// getHousehold is getPlatformHouseholdsByHouseholdId.
func (s *Service) getHousehold(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "household_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.answerHousehold(w, r, id)
}

// answerHousehold writes household id's metadata as it stands now: what a read answers, and what an
// action on it answers once it is done.
func (s *Service) answerHousehold(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	d, err := s.household(r.Context(), id)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, d)
}

// household reads household id's metadata, as the staff role, in one transaction.
func (s *Service) household(ctx context.Context, id uuid.UUID) (householdDetail, error) {
	d := householdDetail{
		Members: []memberDoc{}, ModulesEnabled: []string{}, StorageByModule: map[string]int64{},
		RecentActionKeys: []actionCount{}, LimitOverrides: []limitDoc{}, Flags: []flagDoc{},
		Invoices: []invoiceDoc{}, Notifications: []notificationDoc{},
	}
	err := s.read(ctx, func(tx pgx.Tx) error {
		var billingState string
		err := tx.QueryRow(ctx, `
			SELECT `+householdColumns+`, h.billing_state::text, h.trial_ends_at, h.grace_ends_at, h.retained_until,
			  h.suspended_at, h.suspension_notice, h.deletion_scheduled_at
			FROM households h WHERE h.id = $1`, id).
			Scan(&d.ID, &d.Name, &d.Country, &d.CreatedAt, &d.State, &d.MemberCount, &billingState, &d.TrialEndsAt, &d.GraceEndsAt,
				&d.DataRetainedUntil, &d.SuspendedAt, &d.SuspensionNotice, &d.DeletionScheduledAt)
		if err != nil {
			return found(err)
		}
		d.CreatedAt = d.CreatedAt.UTC()
		// Each clock is shown while the subscription is in the state it times, as a member's summary
		// shows it (entitlement.Status.Summary).
		if entitlement.State(billingState) != entitlement.Trialing {
			d.TrialEndsAt = nil
		}
		if entitlement.State(billingState) != entitlement.Grace {
			d.GraceEndsAt = nil
		}
		if b := entitlement.State(billingState); b != entitlement.ReadOnly && b != entitlement.Canceled {
			d.DataRetainedUntil = nil
		}
		for _, t := range []**time.Time{&d.TrialEndsAt, &d.GraceEndsAt, &d.DataRetainedUntil, &d.SuspendedAt, &d.DeletionScheduledAt} {
			*t = utc(*t)
		}
		return s.details(ctx, tx, &d)
	})
	return d, err
}

// details reads, in tx, what d's household holds beside its own row.
func (s *Service) details(ctx context.Context, tx pgx.Tx, d *householdDetail) error {
	rows, err := tx.Query(ctx, `
		SELECT m.user_id, u.email, m.role::text FROM memberships m JOIN users u ON u.id = m.user_id
		WHERE m.household_id = $1 ORDER BY m.created_at, m.user_id`, d.ID)
	if err != nil {
		return err
	}
	var m memberDoc
	if _, err := pgx.ForEachRow(rows, []any{&m.UserID, &m.Email, &m.Role}, func() error {
		m.IsChild = m.Role == "child"
		d.Members = append(d.Members, m)
		return nil
	}); err != nil {
		return err
	}

	// The modules the contract names: a module a test adds to the database is none of the API's.
	rows, err = tx.Query(ctx, "SELECT module FROM module_enablement WHERE household_id = $1 AND enabled AND module = ANY($2) ORDER BY module",
		d.ID, household.Modules)
	if err != nil {
		return err
	}
	if d.ModulesEnabled, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
		return err
	}

	rows, err = tx.Query(ctx, "SELECT module, sum(byte_size)::bigint FROM files WHERE household_id = $1 GROUP BY module", d.ID)
	if err != nil {
		return err
	}
	var (
		name  string
		bytes int64
	)
	if _, err := pgx.ForEachRow(rows, []any{&name, &bytes}, func() error {
		d.StorageByModule[name] = bytes
		d.StorageBytes += bytes
		return nil
	}); err != nil {
		return err
	}

	rows, err = tx.Query(ctx, `
		SELECT module || '.' || action, count(*)::int FROM audit_events
		WHERE household_id = $1 AND occurred_at > $2
		GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT $3`, d.ID, s.cfg.Now().Add(-actionsWindow), shownActions)
	if err != nil {
		return err
	}
	var a actionCount
	if _, err := pgx.ForEachRow(rows, []any{&a.Action, &a.Count}, func() error {
		d.RecentActionKeys = append(d.RecentActionKeys, a)
		return nil
	}); err != nil {
		return err
	}

	if d.LimitOverrides, err = limits(ctx, tx, d.ID); err != nil {
		return err
	}
	if d.Flags, err = householdFlags(ctx, tx, d.ID); err != nil {
		return err
	}

	var sub subscriptionDoc
	err = tx.QueryRow(ctx, `
		SELECT billing_interval, status, currency, current_period_end, cancel_at_period_end FROM billing_subscriptions
		WHERE household_id = $1 AND standing = 'current' ORDER BY started_at DESC NULLS LAST LIMIT 1`, d.ID).
		Scan(&sub.Interval, &sub.Status, &sub.Currency, &sub.CurrentPeriodEnd, &sub.CancelAtPeriodEnd)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return err
	default:
		sub.CurrentPeriodEnd = utc(sub.CurrentPeriodEnd)
		d.Subscription = &sub
	}

	rows, err = tx.Query(ctx, `
		SELECT id, number, status, total_minor, currency, issued_at FROM billing_invoices
		WHERE household_id = $1 ORDER BY issued_at DESC, id DESC LIMIT $2`, d.ID, shownInvoices)
	if err != nil {
		return err
	}
	var i invoiceDoc
	if _, err := pgx.ForEachRow(rows, []any{&i.ID, &i.Number, &i.Status, &i.Total.AmountMinor, &i.Total.Currency, &i.IssuedAt}, func() error {
		i.IssuedAt = i.IssuedAt.UTC()
		d.Invoices = append(d.Invoices, i)
		return nil
	}); err != nil {
		return err
	}

	rows, err = tx.Query(ctx, `
		SELECT id, category::text, message, status::text, reason, created_at, settled_at,
		  status = 'failed' AND NOT sealed AND user_id IS NOT NULL AND args_expires_at > now()
		FROM notifications WHERE household_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, d.ID, shownNotifications)
	if err != nil {
		return err
	}
	var n notificationDoc
	_, err = pgx.ForEachRow(rows, []any{&n.ID, &n.Category, &n.Message, &n.Status, &n.Reason, &n.CreatedAt, &n.SettledAt, &n.Redrivable}, func() error {
		n.CreatedAt, n.SettledAt = n.CreatedAt.UTC(), utc(n.SettledAt)
		d.Notifications = append(d.Notifications, n)
		return nil
	})
	return err
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// limits reads, in tx, the fair-use ceilings raised for household, in the order of their keys.
func limits(ctx context.Context, tx pgx.Tx, household uuid.UUID) ([]limitDoc, error) {
	rows, err := tx.Query(ctx, `
		SELECT key, value, reason, set_by, set_by_label, set_at FROM household_limits WHERE household_id = $1 ORDER BY key`, household)
	if err != nil {
		return nil, err
	}
	out := []limitDoc{}
	var (
		key, reason, label string
		value              int64
		by                 *uuid.UUID
		at                 time.Time
	)
	_, err = pgx.ForEachRow(rows, []any{&key, &value, &reason, &by, &label, &at}, func() error {
		out = append(out, overridden(key, value, reason, by, label, at))
		return nil
	})
	return out, err
}

// overridden is a ceiling raised to value, as the contract's PlatformLimitOverride says it.
func overridden(key string, value int64, reason string, by *uuid.UUID, label string, at time.Time) limitDoc {
	at = at.UTC()
	return limitDoc{Key: key, Value: &value, Reason: &reason, SetBy: &actorRef{UserID: by, Label: label}, SetAt: &at}
}

// householdFlags reads, in tx, every feature flag as it stands for household, in the order of their
// keys: its own setting of each, before the platform's.
func householdFlags(ctx context.Context, tx pgx.Tx, household uuid.UUID) ([]flagDoc, error) {
	rows, err := tx.Query(ctx, `
		SELECT f.key, coalesce(hf.enabled, f.enabled), hf.enabled IS NOT NULL
		FROM platform.feature_flags f
		LEFT JOIN household_flags hf ON hf.household_id = $1 AND hf.key = f.key
		ORDER BY f.key`, household)
	if err != nil {
		return nil, err
	}
	out := []flagDoc{}
	var f flagDoc
	_, err = pgx.ForEachRow(rows, []any{&f.Key, &f.Enabled, &f.Overridden}, func() error {
		out = append(out, f)
		return nil
	})
	return out, err
}

// known answers 404 for a household that is not there, as the staff role reads it: what an action
// asks before it opens the household's context, in which a household that does not exist would fail
// rather than be not found.
func (s *Service) known(ctx context.Context, id uuid.UUID) error {
	var there bool
	err := s.read(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM households WHERE id = $1)", id).Scan(&there)
	})
	if err == nil && !there {
		err = problem.NotFound()
	}
	return err
}

// extendTrial is postPlatformHouseholdsByHouseholdIdTrial: days more of trial, from the end of one
// still running, or from now for a household whose trial ended unpaid, which is back on trial
// (billing.ExtendTrial). A household that has subscribed has no trial to extend.
func (s *Service) extendTrial(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := pathUUID(r, "household_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var req struct {
		Days   int    `json:"days"`
		Reason string `json:"reason"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	reason, err := reasoned(req.Reason)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var (
		state string
		ends  time.Time
	)
	err = s.read(ctx, func(tx pgx.Tx) error {
		return found(tx.QueryRow(ctx, "SELECT billing_state::text, trial_ends_at FROM households WHERE id = $1", id).Scan(&state, &ends))
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	from := s.cfg.Now()
	if entitlement.State(state) == entitlement.Trialing && ends.After(from) {
		from = ends
	}
	until := from.AddDate(0, 0, req.Days)
	scoped := s.acting(ctx, caller(ctx), entry{
		action: "household.trial", household: id, reason: reason, meta: map[string]any{"days": req.Days, "until": until.UTC()},
	})
	switch err := s.cfg.Billing.ExtendTrial(scoped, id, until); {
	case errors.Is(err, billing.ErrNoTrial):
		s.fail(w, r, inapplicable())
		return
	case err != nil:
		s.fail(w, r, found(err))
		return
	}
	s.answerHousehold(w, r, id)
}

// balanceNote is what a credit says on the payment processor's record, which its customer may read:
// never the reason staff gave, which is the platform's log's alone.
const balanceNote = "Credit from Household support"

// credit is postPlatformHouseholdsByHouseholdIdCredit: a credit to the balance of the customer who
// pays the household's subscription, at the payment processor, in the currency it is charged in,
// which its next invoices draw on.
func (s *Service) credit(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := pathUUID(r, "household_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var req struct {
		Amount money.Money `json:"amount"`
		Reason string      `json:"reason"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	reason, err := reasoned(req.Reason)
	switch {
	case err != nil:
	case req.Amount.AmountMinor <= 0 || req.Amount.AmountMinor > money.MaxMinor:
		err = invalid("/amount/amount_minor", problem.FieldInvalid)
	default:
		err = s.known(ctx, id)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	scoped := s.acting(ctx, caller(ctx), entry{
		action: "household.credit", household: id, reason: reason,
		meta: map[string]any{"amount_minor": req.Amount.AmountMinor, "currency": req.Amount.Currency},
	})
	err = tenant.InWriteTx(scoped, func(tx pgx.Tx) error {
		if _, err := mutation.Note(scoped, tx, household.SupportEvent(household.SupportCredit, nil)); err != nil {
			return err
		}
		if err := idempotency.Commit(ctx, tx); err != nil {
			return err
		}
		// Last, so that the processor is asked only once everything that records the credit is
		// written, and none of it is kept when the processor refuses.
		return s.cfg.Billing.Credit(ctx, id, req.Amount, balanceNote)
	})
	switch {
	case errors.Is(err, billing.ErrNoSubscription):
		err = problem.New(http.StatusConflict, problem.CodeNotSubscribed)
	case errors.Is(err, billing.ErrCurrency):
		err = invalid("/amount/currency", problem.FieldInvalid)
	case errors.Is(err, billing.ErrUnavailable):
		s.cfg.Log.LogAttrs(ctx, slog.LevelWarn, "staff: the payment processor failed", slog.Any("error", err))
		err = problem.New(http.StatusServiceUnavailable, problem.CodeBillingUnavailable)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// resendInvoice is postPlatformHouseholdsByHouseholdIdInvoicesByInvoiceIdResend: the household's
// paid invoice, emailed to its payer again.
func (s *Service) resendInvoice(w http.ResponseWriter, r *http.Request) {
	s.send(w, r, "invoice_id", "household.invoice", household.SupportInvoice,
		func(ctx context.Context, tx pgx.Tx, id, invoice uuid.UUID) error {
			err := s.cfg.Billing.ResendInvoice(ctx, tx, id, invoice)
			switch {
			case errors.Is(err, billing.ErrNoInvoice):
				return problem.NotFound()
			case errors.Is(err, billing.ErrInvoiceUnpaid):
				return inapplicable()
			}
			return err
		})
}

// redrive is postPlatformHouseholdsByHouseholdIdNotificationsByNotificationIdRedrive: a notification
// of the household's that failed, sent again as it was queued (notify.Redrive).
func (s *Service) redrive(w http.ResponseWriter, r *http.Request) {
	s.send(w, r, "notification_id", "household.redrive", household.SupportRedrive,
		func(ctx context.Context, tx pgx.Tx, id, notification uuid.UUID) error {
			err := s.cfg.Notify.Redrive(ctx, tx, id, notification)
			switch {
			case errors.Is(err, notify.ErrNoNotification):
				return problem.NotFound()
			case errors.Is(err, notify.ErrNotRedrivable):
				return inapplicable()
			}
			return err
		})
}

// send serves an action that sends something of a household's again, the thing its path names in
// param: do queues it in a transaction of the household's, which records it in the household's log
// as event and in the platform's as action, naming the thing under param, and the transport is
// nudged once that has committed.
func (s *Service) send(w http.ResponseWriter, r *http.Request, param, action, event string,
	do func(ctx context.Context, tx pgx.Tx, household, thing uuid.UUID) error,
) {
	ctx := r.Context()
	id, err := pathUUID(r, "household_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	thing, err := pathUUID(r, param)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	reason, err := reasoned(req.Reason)
	if err == nil {
		err = s.known(ctx, id)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	scoped := s.acting(ctx, caller(ctx), entry{action: action, household: id, reason: reason, meta: map[string]any{param: thing}})
	err = tenant.InWriteTx(scoped, func(tx pgx.Tx) error {
		if err := do(scoped, tx, id, thing); err != nil {
			return err
		}
		if _, err := mutation.Note(scoped, tx, household.SupportEvent(event, nil)); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.cfg.Notify.Nudge(ctx, id)
	w.WriteHeader(http.StatusAccepted)
}

// ceilings are the fair-use ceilings every household is held to (PRD 04 §5), by the key the
// contract's PlatformLimitOverride names each with: what a household's own is raised from.
var ceilings = map[string]int64{
	fairuse.KeyMembers:       fairuse.Members,
	fairuse.KeyRows:          fairuse.Rows,
	fairuse.KeyChatMessages:  fairuse.ChatMessages,
	fairuse.KeySyncMutations: fairuse.SyncMutations,
	fairuse.KeyAPIRate:       int64(ratelimit.PerHousehold.PerMinute),
	fairuse.KeyObjects:       fairuse.Objects,
	fairuse.KeyFileBytes:     files.MaxBytes,
}

// setLimit is patchPlatformHouseholdsByHouseholdIdLimits: one fair-use ceiling raised for the
// household, to a value at or above the one every household is held to, or, with a null value, put
// back to it (PRD 04 §5). The ceiling holds from the household's next request.
func (s *Service) setLimit(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	m := caller(ctx)
	id, err := pathUUID(r, "household_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var req struct {
		Key    string `json:"key"`
		Value  *int64 `json:"value"`
		Reason string `json:"reason"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	reason, err := reasoned(req.Reason)
	ceiling, named := ceilings[req.Key]
	switch {
	case err != nil:
	case !named:
		err = invalid("/key", problem.FieldInvalid)
	case req.Value != nil && *req.Value < ceiling:
		// A ceiling is raised: below the one every household is held to, it would be a penalty.
		err = invalid("/value", problem.FieldInvalid)
	default:
		err = s.known(ctx, id)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	meta := map[string]any{"key": req.Key}
	args := map[string]any{"limit": req.Key, "change": "cleared"}
	if req.Value != nil {
		meta["value"] = *req.Value
		args["change"] = "raised"
	}
	scoped := s.acting(ctx, m, entry{action: "household.limit", household: id, reason: reason, meta: meta})
	out := limitDoc{Key: req.Key}
	err = tenant.InWriteTx(scoped, func(tx pgx.Tx) error {
		if req.Value == nil {
			tag, err := tx.Exec(ctx, "DELETE FROM household_limits WHERE household_id = $1 AND key = $2", id, req.Key)
			if err != nil || tag.RowsAffected() == 0 {
				return err
			}
		} else {
			var at time.Time
			err := tx.QueryRow(ctx, `
				INSERT INTO household_limits AS l (household_id, key, value, reason, set_by, set_by_label, set_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
				ON CONFLICT (household_id, key) DO UPDATE SET value = excluded.value, reason = excluded.reason,
				  set_by = excluded.set_by, set_by_label = excluded.set_by_label, set_at = excluded.set_at
				RETURNING set_at`, id, req.Key, *req.Value, reason, m.id, m.email, s.cfg.Now()).Scan(&at)
			if err != nil {
				return err
			}
			out = overridden(req.Key, *req.Value, reason, &m.id, m.email, at)
		}
		if _, err := mutation.Note(scoped, tx, household.SupportEvent(household.SupportLimit, args)); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// maxNotice is the longest notice a suspension carries, in characters.
const maxNotice = 500

// setSuspension is putPlatformHouseholdsByHouseholdIdSuspension: the household suspended, with the
// notice that goes with it, or its suspension lifted (PRD 04 §3, D-115). Either way its owners are
// emailed, and the household's log says what the platform did. A household that stands as asked
// already is answered as it is.
func (s *Service) setSuspension(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := pathUUID(r, "household_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var req struct {
		Suspended bool    `json:"suspended"`
		Notice    *string `json:"notice"`
		Reason    string  `json:"reason"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	reason, err := reasoned(req.Reason)
	notice := ""
	if err == nil && req.Suspended {
		// A suspension always carries its notice: what the household is told of why.
		var ok bool
		if req.Notice != nil {
			notice, ok = text.Message(*req.Notice)
		}
		if !ok || notice == "" || len([]rune(notice)) > maxNotice {
			err = invalid("/notice", problem.FieldInvalid)
		}
	}
	if err == nil {
		err = s.known(ctx, id)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	e := entry{action: "household.unsuspend", household: id, reason: reason}
	if req.Suspended {
		e.action, e.meta = "household.suspend", map[string]any{"notice": notice}
	}
	scoped := s.acting(ctx, caller(ctx), e)
	res, err := mutation.Apply(scoped, func(tx pgx.Tx) (mutation.Record, error) {
		if req.Suspended {
			return s.cfg.Households.Suspend(scoped, tx, id, notice)
		}
		return s.cfg.Households.Unsuspend(scoped, tx, id)
	})
	if err != nil {
		s.fail(w, r, found(err))
		return
	}
	if res.EventID != uuid.Nil {
		s.cfg.Notify.Nudge(ctx, id)
	}
	s.answerHousehold(w, r, id)
}

// setHouseholdFlag is putPlatformHouseholdsByHouseholdIdFlagsByKey: the household's own setting of a
// feature flag, which comes before the platform's, or, with a null enabled, that setting taken away.
func (s *Service) setHouseholdFlag(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := pathUUID(r, "household_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	key := chi.URLParam(r, "key")
	var req struct {
		Enabled *bool  `json:"enabled"`
		Reason  string `json:"reason"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	reason, err := reasoned(req.Reason)
	if err == nil {
		err = s.known(ctx, id)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	meta := map[string]any{"key": key}
	args := map[string]any{"flag": key, "change": "cleared"}
	if req.Enabled != nil {
		meta["enabled"] = *req.Enabled
		args["change"] = "off"
		if *req.Enabled {
			args["change"] = "on"
		}
	}
	scoped := s.acting(ctx, caller(ctx), entry{action: "household.flag", household: id, reason: reason, meta: meta})
	err = tenant.InWriteTx(scoped, func(tx pgx.Tx) error {
		// The flag is one the platform has: a household's setting of a flag nobody made says nothing.
		var there bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM platform.feature_flags WHERE key = $1)", key).Scan(&there); err != nil {
			return err
		}
		if !there {
			return problem.NotFound()
		}
		var changed bool
		if req.Enabled == nil {
			tag, err := tx.Exec(ctx, "DELETE FROM household_flags WHERE household_id = $1 AND key = $2", id, key)
			if err != nil {
				return err
			}
			changed = tag.RowsAffected() > 0
		} else {
			tag, err := tx.Exec(ctx, `
				INSERT INTO household_flags AS f (household_id, key, enabled, set_at) VALUES ($1, $2, $3, $4)
				ON CONFLICT (household_id, key) DO UPDATE SET enabled = excluded.enabled, set_at = excluded.set_at
				WHERE f.enabled IS DISTINCT FROM excluded.enabled`, id, key, *req.Enabled, s.cfg.Now())
			if err != nil {
				return err
			}
			changed = tag.RowsAffected() > 0
		}
		if !changed {
			return nil
		}
		if _, err := mutation.Note(scoped, tx, household.SupportEvent(household.SupportFlag, args)); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var flags []flagDoc
	if err := s.read(ctx, func(tx pgx.Tx) error {
		var err error
		flags, err = householdFlags(ctx, tx, id)
		return err
	}); err != nil {
		s.fail(w, r, err)
		return
	}
	i := slices.IndexFunc(flags, func(f flagDoc) bool { return f.Key == key })
	if i < 0 {
		s.fail(w, r, problem.NotFound())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, flags[i])
}
