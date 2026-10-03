package billing

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/money"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// subscriptionDoc is the contract's Subscription.
type subscriptionDoc struct {
	HouseholdID       uuid.UUID         `json:"household_id"`
	State             entitlement.State `json:"state"`
	Interval          *string           `json:"interval"`
	CurrentPeriodEnd  *time.Time        `json:"current_period_end"`
	CancelAtPeriodEnd bool              `json:"cancel_at_period_end"`
	TrialEndsAt       *time.Time        `json:"trial_ends_at"`
	GraceEndsAt       *time.Time        `json:"grace_ends_at"`
	DataRetainedUntil *time.Time        `json:"data_retained_until"`
	Payer             *actorRef         `json:"payer"`
	PaymentMethod     *methodDoc        `json:"payment_method"`
	BasePrice         *money.Money      `json:"base_price"`
	Plans             []planDoc         `json:"plans"`
	IncludedStorage   int64             `json:"included_storage_bytes"`
	StorageBlock      int64             `json:"storage_block_bytes"`
	PricePerBlock     money.Money       `json:"price_per_storage_block"`
	MaxStorageBlocks  int               `json:"max_storage_blocks"`
	Transfer          *transferDoc      `json:"transfer"`
}

// actorRef is the contract's ActorRef.
type actorRef struct {
	UserID         *uuid.UUID `json:"user_id"`
	Label          string     `json:"label"`
	IsFormerMember bool       `json:"is_former_member"`
}

// methodDoc is a payment method's summary, which only its payer reads.
type methodDoc struct {
	Brand    string  `json:"brand"`
	Last4    *string `json:"last4"`
	ExpMonth *int16  `json:"exp_month"`
	ExpYear  *int16  `json:"exp_year"`
}

// planDoc is the base fee at one interval.
type planDoc struct {
	Interval string      `json:"interval"`
	Price    money.Money `json:"price"`
}

// transferDoc is the payer's offer of billing still open.
type transferDoc struct {
	OfferedBy actorRef  `json:"offered_by"`
	OfferedTo actorRef  `json:"offered_to"`
	OfferedAt time.Time `json:"offered_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

// intentDoc is the contract's BillingIntent: what the client confirms with the processor.
type intentDoc struct {
	ClientSecret   string `json:"client_secret"`
	Intent         string `json:"intent"`
	PublishableKey string `json:"publishable_key"`
}

func (s *Service) intent(c *Confirmation) intentDoc {
	return intentDoc{ClientSecret: c.ClientSecret, Intent: c.Intent, PublishableKey: s.PublishableKey}
}

// document is household's subscription as user, one of its owners, reads it, in tx in its context:
// its state as status has it, what it pays or would, and the offer of billing open. The payment
// method's summary is its payer's alone to read (FR-BI5).
func (s *Service) document(ctx context.Context, tx pgx.Tx, household, user uuid.UUID, status entitlement.Status) (subscriptionDoc, error) {
	f, err := readFacts(ctx, tx, household)
	if err != nil {
		return subscriptionDoc{}, err
	}
	subs, err := readSubscriptions(ctx, tx, household)
	if err != nil {
		return subscriptionDoc{}, err
	}
	now := s.Now()
	summary := status.Summary(now)
	doc := subscriptionDoc{
		HouseholdID: household, State: summary.State, TrialEndsAt: summary.TrialEndsAt, GraceEndsAt: summary.GraceEndsAt,
		DataRetainedUntil: summary.DataRetainedUntil,
		IncludedStorage:   s.Allowance.Base, StorageBlock: s.Allowance.Block, MaxStorageBlocks: s.Allowance.MaxBlocks,
	}
	if f.payer != nil {
		doc.Payer = &actorRef{UserID: f.payer, IsFormerMember: !f.member}
		if f.label != nil {
			doc.Payer.Label = *f.label
		}
	}
	// What it pays is its subscription's currency's plan; what it would, its base currency's.
	plan := s.Prices.For(f.currency)
	if cur, ok := standing(subs, standingCurrent); ok {
		plan = s.Prices.For(cur.currency)
		interval := cur.interval
		doc.Interval, doc.CancelAtPeriodEnd = &interval, cur.cancelAtPeriodEnd
		doc.CurrentPeriodEnd = utc(cur.periodEnd)
		doc.BasePrice = &money.Money{AmountMinor: plan.Base(interval).AmountMinor, Currency: plan.Currency}
		if f.pays(user) && cur.payer == user && cur.brand != nil {
			doc.PaymentMethod = &methodDoc{Brand: *cur.brand, Last4: cur.last4, ExpMonth: cur.expMonth, ExpYear: cur.expYear}
		}
	}
	doc.Plans = []planDoc{
		{Interval: Year, Price: money.Money{AmountMinor: plan.Year.AmountMinor, Currency: plan.Currency}},
		{Interval: Month, Price: money.Money{AmountMinor: plan.Month.AmountMinor, Currency: plan.Currency}},
	}
	doc.PricePerBlock = money.Money{AmountMinor: plan.Block.AmountMinor, Currency: plan.Currency}
	offer, ok, err := readOffer(ctx, tx, household, now)
	if err != nil {
		return subscriptionDoc{}, err
	}
	if ok {
		doc.Transfer = &transferDoc{
			OfferedBy: actorRef{UserID: &offer.by, Label: offer.byLabel}, OfferedTo: actorRef{UserID: &offer.to, Label: offer.toLabel},
			OfferedAt: offer.offeredAt.UTC(), ExpiresAt: offer.expiry.UTC(),
		}
	}
	return doc, nil
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// answer writes household's subscription as the caller reads it now, read again: the state a change
// made left it in, which the request's own scope does not have.
func (s *Service) answer(w http.ResponseWriter, r *http.Request, scope *tenant.Scope) {
	ctx := r.Context()
	var doc subscriptionDoc
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		status, err := readStatus(ctx, tx, scope.HouseholdID())
		if err != nil {
			return err
		}
		doc, err = s.document(ctx, tx, scope.HouseholdID(), scope.UserID(), status)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, doc)
}

// getSubscription is getBillingSubscription: the subscription and the household's state, an owner's
// to read; the payer also reads the payment method's summary.
func (s *Service) getSubscription(w http.ResponseWriter, r *http.Request) {
	scope, err := owner(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.answer(w, r, scope)
}

// intervalRequest is the body that names a billing interval.
type intervalRequest struct {
	Interval string `json:"interval"`
}

// payer returns ctx's scope for the household's payer, read in tx: 404 for a caller who is no owner,
// and 403 for an owner who does not pay, who sees billing and may not change it (FR-BI5).
func payer(ctx context.Context, tx pgx.Tx) (*tenant.Scope, facts, error) {
	scope, err := owner(ctx)
	if err != nil {
		return nil, facts{}, err
	}
	f, err := readFacts(ctx, tx, scope.HouseholdID())
	if err != nil {
		return nil, facts{}, err
	}
	if !f.pays(scope.UserID()) {
		return nil, facts{}, forbidden()
	}
	return scope, f, nil
}

// subscribe is postBillingSubscription: the payer subscribes the household, at the interval they
// choose, in its base currency's plan. It makes the subscription at the processor, incomplete, and
// answers the secret its first payment is confirmed with there (Q17): nothing about the household
// changes until the processor says it was paid, and one that is never paid expires. Asked again
// while one waits at the same interval, it answers that one's secret; at another, the one waiting
// is cancelled for the new. One waiting that the processor says was paid meanwhile is the
// household's by then, and is never cancelled: it is recorded first, and the request answered 409.
// Only a payer whose address is verified subscribes (PRD 02 §3).
func (s *Service) subscribe(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope, err := owner(ctx)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var req intervalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.fail(w, r, problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed}))
		return
	}
	p, err := s.processor()
	if err != nil {
		s.fail(w, r, err)
		return
	}
	household, user := scope.HouseholdID(), scope.UserID()
	// The customer first, outside the household's lock: it is the account's, and is made once.
	var (
		f       facts
		waiting string
	)
	err = tenant.InTx(ctx, func(tx pgx.Tx) error {
		var err error
		if _, f, err = payer(ctx, tx); err != nil {
			return err
		}
		ok, err := verified(ctx, tx, user)
		if err != nil {
			return err
		}
		if !ok {
			return problem.New(http.StatusForbidden, problem.CodeAccountUnverified)
		}
		subs, err := readSubscriptions(ctx, tx, household)
		if w, ok := standing(subs, standingPending); ok {
			waiting = w.id
		}
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	// What the processor says of one waiting is recorded before anything is decided of it: paid since
	// its secret was handed out, it is the household's, whether or not its event has arrived.
	if waiting != "" {
		if err := s.sync(ctx, household, waiting); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	plan := s.Prices.For(f.currency)
	price := plan.Base(req.Interval)
	if price.ID == "" {
		s.fail(w, r, errUnavailable)
		return
	}
	customer, err := s.customer(ctx, p, user, plan.Currency, f.country)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var confirmation *Confirmation
	err = tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		if err := lock(ctx, tx, household); err != nil {
			return err
		}
		if _, _, err := payer(ctx, tx); err != nil {
			return err
		}
		subs, err := readSubscriptions(ctx, tx, household)
		if err != nil {
			return err
		}
		if _, ok := standing(subs, standingCurrent); ok {
			return errSubscribed
		}
		if waiting, ok := standing(subs, standingPending); ok {
			said, err := p.Subscription(ctx, waiting.id)
			if err != nil {
				return err
			}
			switch {
			case said.Live():
				// Paid this moment: its event is on its way, and makes it the household's.
				return errSubscribed
			case said.Status == StatusIncomplete && waiting.payer == user && waiting.interval == req.Interval &&
				waiting.currency == plan.Currency:
				if confirmation, err = p.Confirmation(ctx, waiting.id); err != nil || confirmation != nil {
					return err
				}
			}
			// Another plan, or one with nothing left to confirm: it is over, and a new one is made.
			if err := p.Cancel(ctx, waiting.id); err != nil {
				return err
			}
			now := s.Now()
			waiting.standing, waiting.status, waiting.endedAt = standingEnded, StatusCanceled, &now
			if err := waiting.update(ctx, tx, household); err != nil {
				return err
			}
		}
		sub, c, err := p.Subscribe(ctx, NewSubscription{
			Customer: customer, Price: price.ID, Household: household, Payer: user,
			Monthly: req.Interval == Year, AutomaticTax: s.AutomaticTax,
		})
		if err != nil {
			return err
		}
		if c == nil {
			return ErrUnavailable
		}
		confirmation = c
		return newRow(sub, user, req.Interval).insert(ctx, tx, household)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s.intent(confirmation))
}

// current returns the household's subscription for its payer, the caller, read in a transaction of
// its own: 404 or 403 for anyone else (payer), and 409 not_subscribed when it has none.
func (s *Service) current(ctx context.Context) (*tenant.Scope, subscription, error) {
	var (
		scope *tenant.Scope
		cur   subscription
	)
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		var err error
		if scope, _, err = payer(ctx, tx); err != nil {
			return err
		}
		subs, err := readSubscriptions(ctx, tx, scope.HouseholdID())
		if err != nil {
			return err
		}
		var ok bool
		if cur, ok = standing(subs, standingCurrent); !ok {
			return errNotSubscribed
		}
		return nil
	})
	return scope, cur, err
}

// changeInterval is patchBillingSubscription: the payer moves the subscription between paying
// yearly and monthly. The processor prorates what was paid against what is now owed (PRD 04 §6), and
// a yearly plan's storage lines are invoiced monthly (D-128).
func (s *Service) changeInterval(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req intervalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.fail(w, r, problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed}))
		return
	}
	scope, cur, err := s.current(ctx)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if cur.interval != req.Interval {
		p, err := s.processor()
		if err != nil {
			s.fail(w, r, err)
			return
		}
		price := s.Prices.For(cur.currency).Base(req.Interval)
		if price.ID == "" {
			s.fail(w, r, errUnavailable)
			return
		}
		if _, err := p.ChangePrice(ctx, cur.id, price.ID, req.Interval == Year); err != nil {
			s.fail(w, r, err)
			return
		}
		if err := s.sync(ctx, scope.HouseholdID(), cur.id); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	s.answer(w, r, scope)
}

// paymentMethod is postBillingPaymentMethod: the payer begins replacing the payment method the
// subscription is charged with, and is answered the secret the new one is confirmed with at the
// processor. The subscription changes once the processor says it was (methodConfirmed).
func (s *Service) paymentMethod(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope, cur, err := s.current(ctx)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	p, err := s.processor()
	if err != nil {
		s.fail(w, r, err)
		return
	}
	confirmation, err := p.Setup(ctx, NewSetup{
		Customer: cur.customer, Household: scope.HouseholdID(), User: scope.UserID(),
		Purpose: PurposePaymentMethod, Subscription: cur.id,
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s.intent(confirmation))
}

// cancel is postBillingCancel: the payer cancels the subscription at the end of the period it is
// paid up for. Until then nothing changes, and it may be resumed; then the household is canceled,
// read-only with its data retained for 12 months (D-32).
func (s *Service) cancel(w http.ResponseWriter, r *http.Request) { s.atPeriodEnd(w, r, true) }

// resume is postBillingResume: the payer takes a cancellation back while the period paid for still
// runs. A subscription that has ended is subscribed to again (subscribe).
func (s *Service) resume(w http.ResponseWriter, r *http.Request) { s.atPeriodEnd(w, r, false) }

func (s *Service) atPeriodEnd(w http.ResponseWriter, r *http.Request, cancel bool) {
	ctx := r.Context()
	scope, cur, err := s.current(ctx)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if cur.cancelAtPeriodEnd != cancel {
		p, err := s.processor()
		if err != nil {
			s.fail(w, r, err)
			return
		}
		if _, err := p.CancelAtPeriodEnd(ctx, cur.id, cancel); err != nil {
			s.fail(w, r, err)
			return
		}
		if err := s.sync(ctx, scope.HouseholdID(), cur.id); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	s.answer(w, r, scope)
}
