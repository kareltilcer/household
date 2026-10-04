package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/stripe/stripe-go/v87"
	"github.com/stripe/stripe-go/v87/webhook"
)

// The metadata billing puts on what it makes at Stripe, which the webhooks carry back: the household
// and the member a subscription or a setup is for, what a setup is for, and which month's storage an
// invoice item bills.
const (
	metaHousehold    = "household_id"
	metaUser         = "user_id"
	metaPurpose      = "purpose"
	metaSubscription = "subscription"
	metaKind         = "kind"
	metaMonth        = "month"
)

// Stripe is the Processor over Stripe Billing (PRD 04 §6), through stripe-go, whose pinned API
// version every request is sent at.
type Stripe struct {
	client *stripe.Client
	secret string
}

// DefaultTimeout bounds a request to Stripe. The SDK's own client waits 80 seconds, and billing asks
// Stripe inside a transaction that holds a pooled connection and the household's row lock (ADR 0020):
// a Stripe that answers slowly would otherwise hold both for minutes, a request at a time, until the
// pool had none left for anyone. A request cut off is sent again by the SDK under the idempotency key
// it gave it, and what Stripe did meanwhile arrives as an event.
const DefaultTimeout = 20 * time.Second

// StripeConfig is what the Stripe processor needs.
type StripeConfig struct {
	// SecretKey is the API key, a restricted or secret key; WebhookSecret signs the webhooks.
	SecretKey, WebhookSecret string
	// URL is where the API is reached, Stripe's own when "": a test's stand-in.
	URL string
	// HTTPClient makes the requests, one that gives each Timeout when nil.
	HTTPClient *http.Client
	// Timeout bounds each request the client made for a nil HTTPClient sends, DefaultTimeout when zero.
	Timeout time.Duration
	// MaxNetworkRetries is how many times a request that failed on Stripe's side or on the way is
	// sent again, the SDK's two when nil.
	MaxNetworkRetries *int64
}

// NewStripe returns the processor cfg describes.
func NewStripe(cfg StripeConfig) (*Stripe, error) {
	if cfg.SecretKey == "" || cfg.WebhookSecret == "" {
		return nil, errors.New("billing: Stripe needs its API key and its webhook secret")
	}
	client := cfg.HTTPClient
	if client == nil {
		timeout := cfg.Timeout
		if timeout <= 0 {
			timeout = DefaultTimeout
		}
		client = &http.Client{Timeout: timeout}
	}
	backend := &stripe.BackendConfig{
		HTTPClient: client, MaxNetworkRetries: cfg.MaxNetworkRetries,
		// The SDK logs each request's failure with its parameters; the server logs what it answers.
		LeveledLogger: &stripe.LeveledLogger{Level: stripe.LevelNull},
	}
	if cfg.URL != "" {
		backend.URL = stripe.String(cfg.URL)
	}
	return &Stripe{
		client: stripe.NewClient(cfg.SecretKey, stripe.WithBackends(stripe.NewBackendsWithConfig(backend))),
		secret: cfg.WebhookSecret,
	}, nil
}

// fault is err as billing reads it: ErrUnavailable for a failure that is Stripe's own or the
// network's, and err itself for a refusal of the request.
func fault(err error) error {
	if err == nil {
		return nil
	}
	var se *stripe.Error
	if !errors.As(err, &se) {
		return errors.Join(ErrUnavailable, err)
	}
	if se.Type == stripe.ErrorTypeAPI || se.HTTPStatusCode >= http.StatusInternalServerError ||
		se.HTTPStatusCode == http.StatusTooManyRequests {
		return errors.Join(ErrUnavailable, err)
	}
	return err
}

// missing reports whether err is Stripe's refusal of an id it does not have.
func missing(err error) bool {
	var se *stripe.Error
	return errors.As(err, &se) && se.Code == stripe.ErrorCodeResourceMissing
}

func (s *Stripe) CreateCustomer(ctx context.Context, c NewCustomer) (string, error) {
	params := &stripe.CustomerCreateParams{Metadata: map[string]string{metaUser: c.User.String()}}
	// An empty value is sent as one, which is Stripe's way of unsetting a parameter: an account with no
	// name, as one a provider made may have none, is a customer without one.
	if c.Email != "" {
		params.Email = stripe.String(c.Email)
	}
	if c.Name != "" {
		params.Name = stripe.String(c.Name)
	}
	if c.Locale != "" {
		params.PreferredLocales = []*string{stripe.String(c.Locale)}
	}
	if c.Country != "" {
		// Where the payer is taxed from until their payment method says otherwise (PRD 04 §1).
		params.Address = &stripe.AddressParams{Country: stripe.String(c.Country)}
	}
	if c.IdempotencyID != "" {
		params.SetIdempotencyKey(c.IdempotencyID)
	}
	customer, err := s.client.V1Customers.Create(ctx, params)
	if err != nil {
		return "", fault(err)
	}
	return customer.ID, nil
}

func (s *Stripe) DeleteCustomer(ctx context.Context, id string) error {
	if _, err := s.client.V1Customers.Delete(ctx, id, &stripe.CustomerDeleteParams{}); err != nil && !missing(err) {
		return fault(err)
	}
	return nil
}

func (s *Stripe) Subscribe(ctx context.Context, n NewSubscription) (Subscription, *Confirmation, error) {
	params := &stripe.SubscriptionCreateParams{
		Customer: stripe.String(n.Customer),
		Items:    []*stripe.SubscriptionCreateItemParams{{Price: stripe.String(n.Price)}},
		Metadata: map[string]string{metaHousehold: n.Household.String(), metaUser: n.Payer.String()},
		PaymentSettings: &stripe.SubscriptionCreatePaymentSettingsParams{
			SaveDefaultPaymentMethod: stripe.String("on_subscription"),
		},
	}
	params.AddExpand("latest_invoice.confirmation_secret")
	params.AddExpand("default_payment_method")
	if n.Monthly {
		params.PendingInvoiceItemInterval = &stripe.SubscriptionCreatePendingInvoiceItemIntervalParams{Interval: stripe.String(Month)}
	}
	if n.AutomaticTax {
		params.AutomaticTax = &stripe.SubscriptionCreateAutomaticTaxParams{Enabled: stripe.Bool(true)}
	}
	if n.PaymentMethod == "" {
		// Incomplete until the client confirms its first payment with the processor (SCA included).
		params.PaymentBehavior = stripe.String("default_incomplete")
	} else {
		params.DefaultPaymentMethod = stripe.String(n.PaymentMethod)
		params.OffSession = stripe.Bool(true)
		params.PaymentBehavior = stripe.String("allow_incomplete")
		if !n.TrialEnd.IsZero() {
			params.TrialEnd = stripe.Int64(n.TrialEnd.Unix())
		}
	}
	if n.IdempotencyID != "" {
		params.SetIdempotencyKey(n.IdempotencyID)
	}
	sub, err := s.client.V1Subscriptions.Create(ctx, params)
	if err != nil {
		return Subscription{}, nil, fault(err)
	}
	return subscriptionOf(sub), confirmationOf(sub), nil
}

func (s *Stripe) Subscription(ctx context.Context, id string) (Subscription, error) {
	sub, err := s.retrieve(ctx, id, "default_payment_method", "latest_invoice")
	if err != nil {
		return Subscription{}, err
	}
	return subscriptionOf(sub), nil
}

func (s *Stripe) retrieve(ctx context.Context, id string, expand ...string) (*stripe.Subscription, error) {
	params := &stripe.SubscriptionRetrieveParams{}
	for _, e := range expand {
		params.AddExpand(e)
	}
	sub, err := s.client.V1Subscriptions.Retrieve(ctx, id, params)
	return sub, fault(err)
}

func (s *Stripe) Confirmation(ctx context.Context, id string) (*Confirmation, error) {
	sub, err := s.retrieve(ctx, id, "latest_invoice.confirmation_secret")
	if err != nil {
		return nil, err
	}
	if sub.Status != stripe.SubscriptionStatusIncomplete {
		return nil, nil
	}
	return confirmationOf(sub), nil
}

func (s *Stripe) CancelAtPeriodEnd(ctx context.Context, id string, cancel bool) (Subscription, error) {
	params := &stripe.SubscriptionUpdateParams{CancelAtPeriodEnd: stripe.Bool(cancel)}
	params.AddExpand("default_payment_method")
	sub, err := s.client.V1Subscriptions.Update(ctx, id, params)
	if err != nil {
		return Subscription{}, fault(err)
	}
	return subscriptionOf(sub), nil
}

func (s *Stripe) Cancel(ctx context.Context, id string) error {
	_, err := s.end(ctx, id, false)
	return err
}

func (s *Stripe) Abandon(ctx context.Context, id string) (bool, error) {
	return s.end(ctx, id, true)
}

// end cancels the subscription id now, voids the invoice the cancellation left open, and reports
// whether it is over. With waiting, one that charges as it is read here is left as it is: the
// request that ends it follows that reading at once, so that a payment which arrived since its
// caller's own reading, a request or more ago, is not cancelled with what it paid for.
func (s *Stripe) end(ctx context.Context, id string, waiting bool) (bool, error) {
	sub, err := s.retrieve(ctx, id, "latest_invoice")
	switch {
	case missing(err):
		return true, nil
	case err != nil:
		return false, err
	}
	if waiting && subscriptionOf(sub).Live() {
		return false, nil
	}
	if sub.Status != stripe.SubscriptionStatusCanceled && sub.Status != stripe.SubscriptionStatusIncompleteExpired {
		params := &stripe.SubscriptionCancelParams{InvoiceNow: stripe.Bool(false), Prorate: stripe.Bool(false)}
		params.AddExpand("latest_invoice")
		cancelled, err := s.client.V1Subscriptions.Cancel(ctx, id, params)
		switch {
		case missing(err):
		case err != nil:
			return false, fault(err)
		default:
			// Its invoice as the cancellation left it, not as it was read before: where ending a
			// subscription never paid voided its first invoice with it, nothing is left to void.
			sub = cancelled
		}
	}
	// What it could not collect is owed by nobody once it is cancelled: an open invoice would be tried
	// again, against a payer who has handed billing on.
	if inv := sub.LatestInvoice; inv != nil && inv.Status == stripe.InvoiceStatusOpen {
		if _, err := s.client.V1Invoices.VoidInvoice(ctx, inv.ID, &stripe.InvoiceVoidInvoiceParams{}); err != nil && !missing(err) {
			return false, fault(err)
		}
	}
	return true, nil
}

func (s *Stripe) ChangePrice(ctx context.Context, id, price string, monthly bool) (Subscription, error) {
	sub, err := s.retrieve(ctx, id)
	if err != nil {
		return Subscription{}, err
	}
	if sub.Items == nil || len(sub.Items.Data) != 1 {
		return Subscription{}, fmt.Errorf("billing: subscription %s does not have the one item a plan is", id)
	}
	params := &stripe.SubscriptionUpdateParams{
		Items:             []*stripe.SubscriptionUpdateItemParams{{ID: stripe.String(sub.Items.Data[0].ID), Price: stripe.String(price)}},
		ProrationBehavior: stripe.String("create_prorations"),
	}
	if monthly {
		params.PendingInvoiceItemInterval = &stripe.SubscriptionUpdatePendingInvoiceItemIntervalParams{Interval: stripe.String(Month)}
	} else {
		params.AddUnsetField(stripe.SubscriptionUpdateParamsUnsetFieldPendingInvoiceItemInterval)
	}
	params.AddExpand("default_payment_method")
	updated, err := s.client.V1Subscriptions.Update(ctx, id, params)
	if err != nil {
		return Subscription{}, fault(err)
	}
	return subscriptionOf(updated), nil
}

func (s *Stripe) SetPaymentMethod(ctx context.Context, id, paymentMethod string) (Subscription, error) {
	params := &stripe.SubscriptionUpdateParams{DefaultPaymentMethod: stripe.String(paymentMethod)}
	params.AddExpand("default_payment_method")
	sub, err := s.client.V1Subscriptions.Update(ctx, id, params)
	if err != nil {
		return Subscription{}, fault(err)
	}
	return subscriptionOf(sub), nil
}

func (s *Stripe) Setup(ctx context.Context, n NewSetup) (*Confirmation, error) {
	params := &stripe.SetupIntentCreateParams{
		Customer: stripe.String(n.Customer),
		Usage:    stripe.String("off_session"),
		AutomaticPaymentMethods: &stripe.SetupIntentCreateAutomaticPaymentMethodsParams{
			Enabled: stripe.Bool(true),
		},
		Metadata: map[string]string{
			metaHousehold: n.Household.String(), metaUser: n.User.String(), metaPurpose: n.Purpose,
		},
	}
	if n.Subscription != "" {
		params.Metadata[metaSubscription] = n.Subscription
	}
	intent, err := s.client.V1SetupIntents.Create(ctx, params)
	if err != nil {
		return nil, fault(err)
	}
	return &Confirmation{ClientSecret: intent.ClientSecret, Intent: IntentSetup}, nil
}

func (s *Stripe) SetupIntent(ctx context.Context, id string) (SetupIntent, error) {
	intent, err := s.client.V1SetupIntents.Retrieve(ctx, id, &stripe.SetupIntentRetrieveParams{})
	if err != nil {
		return SetupIntent{}, fault(err)
	}
	out := SetupIntent{
		ID: intent.ID, Status: string(intent.Status), Purpose: intent.Metadata[metaPurpose],
		Subscription: intent.Metadata[metaSubscription],
		Household:    parseID(intent.Metadata[metaHousehold]), User: parseID(intent.Metadata[metaUser]),
	}
	if intent.Customer != nil {
		out.Customer = intent.Customer.ID
	}
	if intent.PaymentMethod != nil {
		out.PaymentMethod = intent.PaymentMethod.ID
	}
	return out, nil
}

func (s *Stripe) Invoice(ctx context.Context, id string) (Invoice, error) {
	inv, err := s.client.V1Invoices.Retrieve(ctx, id, &stripe.InvoiceRetrieveParams{})
	if err != nil {
		return Invoice{}, fault(err)
	}
	out := Invoice{
		ID: inv.ID, Number: inv.Number, Status: string(inv.Status), Currency: strings.ToUpper(string(inv.Currency)),
		TotalMinor: inv.Total, Attempts: int(inv.AttemptCount),
		IssuedAt: unix(inv.Created), PeriodStart: unix(inv.PeriodStart), PeriodEnd: unix(inv.PeriodEnd),
	}
	if inv.Customer != nil {
		out.Customer = inv.Customer.ID
	}
	if t := inv.StatusTransitions; t != nil && t.FinalizedAt != 0 {
		out.IssuedAt = unix(t.FinalizedAt)
	}
	if inv.NextPaymentAttempt != 0 {
		out.NextAttempt = unix(inv.NextPaymentAttempt)
	}
	for _, tax := range inv.TotalTaxes {
		out.TaxMinor += tax.Amount
	}
	if p := inv.Parent; p != nil && p.SubscriptionDetails != nil {
		out.Household = parseID(p.SubscriptionDetails.Metadata[metaHousehold])
		if p.SubscriptionDetails.Subscription != nil {
			out.Subscription = p.SubscriptionDetails.Subscription.ID
		}
	}
	// Every line, not the first page the invoice carries.
	lines := s.client.V1Invoices.ListLines(ctx, &stripe.InvoiceListLinesParams{Invoice: stripe.String(id)})
	var from, to int64
	for line, err := range lines.All(ctx) {
		if err != nil {
			return Invoice{}, fault(err)
		}
		l := lineOf(line)
		out.Lines = append(out.Lines, l)
		if out.Household == uuid.Nil {
			out.Household = parseID(line.Metadata[metaHousehold])
		}
		if out.Subscription == "" && line.Parent != nil {
			switch {
			case line.Parent.SubscriptionItemDetails != nil:
				out.Subscription = line.Parent.SubscriptionItemDetails.Subscription
			case line.Parent.InvoiceItemDetails != nil:
				out.Subscription = line.Parent.InvoiceItemDetails.Subscription
			}
		}
		// The period billed is its base fee's, and a storage-only invoice's the month its line bills.
		if p := line.Period; p != nil && (l.Kind == LineBase || (from == 0 && l.Kind == LineStorage)) {
			from, to = p.Start, p.End
		}
	}
	if from != 0 {
		out.PeriodStart, out.PeriodEnd = unix(from), unix(to)
	}
	return out, nil
}

func (s *Stripe) InvoicePDF(ctx context.Context, id string) (string, error) {
	inv, err := s.client.V1Invoices.Retrieve(ctx, id, &stripe.InvoiceRetrieveParams{})
	if err != nil {
		return "", fault(err)
	}
	return inv.InvoicePDF, nil
}

// lineOf is an invoice's line as the contract's Invoice has it: the base fee, the storage blocks, a
// credit, or an adjustment, which a proration is.
func lineOf(line *stripe.InvoiceLineItem) InvoiceLine {
	out := InvoiceLine{Kind: LineAdjustment, Description: line.Description, AmountMinor: line.Amount}
	proration := false
	if p := line.Parent; p != nil {
		switch {
		case p.SubscriptionItemDetails != nil:
			proration = p.SubscriptionItemDetails.Proration
			if !proration {
				out.Kind = LineBase
			}
		case p.InvoiceItemDetails != nil:
			proration = p.InvoiceItemDetails.Proration
		}
	}
	switch {
	case line.Metadata[metaKind] == LineStorage:
		out.Kind = LineStorage
		quantity := strconv.FormatInt(line.Quantity, 10)
		out.Quantity = &quantity
	case out.Kind == LineAdjustment && !proration && line.Amount < 0:
		out.Kind = LineCredit
	}
	return out
}

func (s *Stripe) Pay(ctx context.Context, invoice string) error {
	_, err := s.client.V1Invoices.Pay(ctx, invoice, &stripe.InvoicePayParams{OffSession: stripe.Bool(true)})
	return fault(err)
}

func (s *Stripe) StorageLine(ctx context.Context, l StorageLine) (string, error) {
	// The month's line, if it was added already: an idempotency key lasts a day, and a month is billed
	// once however long after its first attempt the next one comes.
	items := s.client.V1InvoiceItems.List(ctx, &stripe.InvoiceItemListParams{
		Customer:     stripe.String(l.Customer),
		CreatedRange: &stripe.RangeQueryParams{GreaterThanOrEqual: l.To.Unix()},
	})
	for item, err := range items.All(ctx) {
		if err != nil {
			return "", fault(err)
		}
		if item.Metadata[metaKind] == LineStorage && item.Metadata[metaHousehold] == l.Household.String() &&
			item.Metadata[metaMonth] == l.Month {
			return item.ID, nil
		}
	}
	params := &stripe.InvoiceItemCreateParams{
		Customer:     stripe.String(l.Customer),
		Subscription: stripe.String(l.Subscription),
		Pricing:      &stripe.InvoiceItemCreatePricingParams{Price: stripe.String(l.Price)},
		Quantity:     stripe.Int64(int64(l.Blocks)),
		Period:       &stripe.InvoiceItemCreatePeriodParams{Start: stripe.Int64(l.From.Unix()), End: stripe.Int64(l.To.Unix())},
		Metadata:     map[string]string{metaKind: LineStorage, metaHousehold: l.Household.String(), metaMonth: l.Month},
	}
	if l.Description != "" {
		params.Description = stripe.String(l.Description)
	}
	params.SetIdempotencyKey("storage:" + l.Household.String() + ":" + l.Month)
	item, err := s.client.V1InvoiceItems.Create(ctx, params)
	if err != nil {
		return "", fault(err)
	}
	return item.ID, nil
}

func (s *Stripe) Credit(ctx context.Context, c NewCredit) error {
	// A customer's balance is what they owe: a credit lowers it.
	params := &stripe.CustomerBalanceTransactionCreateParams{
		Customer: stripe.String(c.Customer),
		Amount:   stripe.Int64(-c.AmountMinor),
		Currency: stripe.String(strings.ToLower(c.Currency)),
	}
	if c.Note != "" {
		params.Description = stripe.String(c.Note)
	}
	if c.IdempotencyID != "" {
		params.SetIdempotencyKey(c.IdempotencyID)
	}
	_, err := s.client.V1CustomerBalanceTransactions.Create(ctx, params)
	return fault(err)
}

// Event verifies payload against signature, Stripe's Stripe-Signature header, within the SDK's
// tolerance of five minutes. It reads only what the event is about: the handlers read the object
// itself from Stripe, as it stands, so the version an endpoint's events are rendered at need not be
// the one the SDK is pinned to.
func (s *Stripe) Event(payload []byte, signature string) (Event, error) {
	event, err := webhook.ConstructEventWithOptions(payload, signature, s.secret,
		webhook.ConstructEventOptions{IgnoreAPIVersionMismatch: true})
	if err != nil {
		return Event{}, errors.Join(ErrSignature, err)
	}
	out := Event{ID: event.ID, Type: string(event.Type)}
	if event.Data == nil {
		return out, nil
	}
	var object struct {
		ID       string            `json:"id"`
		Metadata map[string]string `json:"metadata"`
		Parent   *struct {
			SubscriptionDetails *struct {
				Metadata map[string]string `json:"metadata"`
			} `json:"subscription_details"`
		} `json:"parent"`
	}
	if err := json.Unmarshal(event.Data.Raw, &object); err != nil {
		return Event{}, fmt.Errorf("billing: the event's object: %w", err)
	}
	out.Object = object.ID
	out.Household = parseID(object.Metadata[metaHousehold])
	if out.Household == uuid.Nil && object.Parent != nil && object.Parent.SubscriptionDetails != nil {
		out.Household = parseID(object.Parent.SubscriptionDetails.Metadata[metaHousehold])
	}
	return out, nil
}

// subscriptionOf is sub as billing reads it. A plan is one item, whose price and period are the
// subscription's.
func subscriptionOf(sub *stripe.Subscription) Subscription {
	out := Subscription{
		ID: sub.ID, Status: string(sub.Status), CancelAtPeriodEnd: sub.CancelAtPeriodEnd,
		Currency:  strings.ToUpper(string(sub.Currency)),
		Household: parseID(sub.Metadata[metaHousehold]), Payer: parseID(sub.Metadata[metaUser]),
	}
	if sub.Customer != nil {
		out.Customer = sub.Customer.ID
	}
	if sub.Items != nil && len(sub.Items.Data) > 0 {
		item := sub.Items.Data[0]
		out.PeriodStart, out.PeriodEnd = unix(item.CurrentPeriodStart), unix(item.CurrentPeriodEnd)
		if item.Price != nil && item.Price.Recurring != nil {
			out.Interval = string(item.Price.Recurring.Interval)
		}
	}
	if d := sub.CancellationDetails; d != nil {
		out.CancellationReason = string(d.Reason)
	}
	if sub.LatestInvoice != nil {
		// An invoice the answer did not expand is known by its id alone, and has no status here.
		out.LatestInvoice, out.InvoiceStatus = sub.LatestInvoice.ID, string(sub.LatestInvoice.Status)
	}
	out.PaymentMethod = paymentMethodOf(sub.DefaultPaymentMethod)
	return out
}

// paymentMethodOf is pm's summary, nil for none: a card's brand, last four digits and expiry, and for
// any other method its type and the last four digits it has, if any. An unexpanded method is known
// by its id alone.
func paymentMethodOf(pm *stripe.PaymentMethod) *PaymentMethod {
	if pm == nil || pm.ID == "" {
		return nil
	}
	out := &PaymentMethod{ID: pm.ID, Brand: string(pm.Type)}
	switch {
	case pm.Card != nil:
		out.Brand, out.Last4 = string(pm.Card.Brand), pm.Card.Last4
		out.ExpMonth, out.ExpYear = int(pm.Card.ExpMonth), int(pm.Card.ExpYear)
	case pm.SEPADebit != nil:
		out.Last4 = pm.SEPADebit.Last4
	}
	return out
}

// confirmationOf is what sub's first payment is confirmed with, nil when its latest invoice has
// nothing to confirm.
func confirmationOf(sub *stripe.Subscription) *Confirmation {
	if sub.LatestInvoice == nil || sub.LatestInvoice.ConfirmationSecret == nil ||
		sub.LatestInvoice.ConfirmationSecret.ClientSecret == "" {
		return nil
	}
	return &Confirmation{ClientSecret: sub.LatestInvoice.ConfirmationSecret.ClientSecret, Intent: IntentPayment}
}

// parseID is raw as a UUID, the zero UUID when it is not one.
func parseID(raw string) uuid.UUID {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil
	}
	return id
}

// unix is seconds as an instant, the zero time for none.
func unix(seconds int64) time.Time {
	if seconds == 0 {
		return time.Time{}
	}
	return time.Unix(seconds, 0).UTC()
}
