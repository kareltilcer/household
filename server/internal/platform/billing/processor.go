package billing

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Processor is what billing asks of the payment processor, Stripe (PRD 04 §6): the customers,
// subscriptions, payment methods and invoices it keeps, which Household keeps only the ids and a
// summary of. Card data never reaches it: a client confirms a payment or a card with the processor
// itself, by the client secret a Confirmation carries. Stripe implements it (NewStripe); a test's
// stands in for it.
type Processor interface {
	// CreateCustomer makes the payer's customer.
	CreateCustomer(ctx context.Context, c NewCustomer) (string, error)
	// Subscribe makes a subscription. One with no payment method is made incomplete, and the
	// confirmation is what its first payment is confirmed with; one with a payment method is charged
	// with it, or starts once its trial ends, and has no confirmation.
	Subscribe(ctx context.Context, s NewSubscription) (Subscription, *Confirmation, error)
	// Subscription reads a subscription as it stands now.
	Subscription(ctx context.Context, id string) (Subscription, error)
	// Confirmation reads again what an incomplete subscription's first payment is confirmed with, nil
	// once nothing is left to confirm.
	Confirmation(ctx context.Context, subscription string) (*Confirmation, error)
	// CancelAtPeriodEnd cancels a subscription once the period paid for ends, or takes that back.
	CancelAtPeriodEnd(ctx context.Context, subscription string, cancel bool) (Subscription, error)
	// Cancel ends a subscription now, with no final invoice and no proration, and voids the invoice
	// it could not collect.
	Cancel(ctx context.Context, subscription string) error
	// ChangePrice moves a subscription to another base price, prorating (PRD 04 §6); monthly says
	// whether its storage lines are invoiced monthly, as a yearly plan's are.
	ChangePrice(ctx context.Context, subscription, price string, monthly bool) (Subscription, error)
	// SetPaymentMethod makes a payment method the one a subscription is charged with.
	SetPaymentMethod(ctx context.Context, subscription, paymentMethod string) (Subscription, error)
	// Setup begins confirming a payment method for later charges.
	Setup(ctx context.Context, s NewSetup) (*Confirmation, error)
	// SetupIntent reads a setup as it stands now.
	SetupIntent(ctx context.Context, id string) (SetupIntent, error)
	// Invoice reads an invoice as it stands now, with its lines.
	Invoice(ctx context.Context, id string) (Invoice, error)
	// InvoicePDF reads where an invoice is downloaded now, "" while it has no PDF: the link is the
	// processor's, handed out as it is asked for and never kept (D-133).
	InvoicePDF(ctx context.Context, id string) (string, error)
	// Pay tries to collect an open invoice now.
	Pay(ctx context.Context, invoice string) error
	// StorageLine adds a month's storage blocks to the subscription's next invoice, once: asked again
	// for the same household and month, it answers the line it added.
	StorageLine(ctx context.Context, l StorageLine) (string, error)
	// Credit credits a customer's balance, which their next invoices draw on.
	Credit(ctx context.Context, c NewCredit) error
	// Event verifies a webhook's payload against its signature and reads what it is about.
	Event(payload []byte, signature string) (Event, error)
}

// The ways a client confirms with the processor (BillingIntent.intent): a payment, charged now, or a
// payment method set up for later charges.
const (
	IntentPayment = "payment"
	IntentSetup   = "setup"
)

// The processor's states of a subscription that billing reads.
const (
	StatusActive            = "active"
	StatusTrialing          = "trialing"
	StatusPastDue           = "past_due"
	StatusUnpaid            = "unpaid"
	StatusCanceled          = "canceled"
	StatusIncomplete        = "incomplete"
	StatusIncompleteExpired = "incomplete_expired"
)

// ReasonRequested is why the processor says a subscription was cancelled when its payer cancelled it;
// any other reason, a payment that failed for one, is the processor's own.
const ReasonRequested = "cancellation_requested"

// The purposes a setup is begun for, which its metadata carries back.
const (
	PurposePaymentMethod = "payment_method"
	PurposeTakeover      = "takeover"
)

// ErrSignature is Event's refusal of a payload its signature does not verify.
var ErrSignature = errors.New("billing: the webhook's signature does not verify")

// ErrUnavailable is a Processor's failure that is the processor's own or the network's, rather than
// a refusal of what it was asked: the request is answered 503 and may be sent again.
var ErrUnavailable = errors.New("billing: the payment processor is unavailable")

// NewCustomer is a payer's customer to make.
type NewCustomer struct {
	User          uuid.UUID
	Email, Name   string
	Locale        string
	Country       string
	IdempotencyID string
}

// NewSubscription is a subscription to make.
type NewSubscription struct {
	Customer  string
	Price     string
	Household uuid.UUID
	Payer     uuid.UUID
	// Monthly invoices the storage lines monthly, as a yearly plan's are (D-128).
	Monthly bool
	// PaymentMethod, when set, is charged, off session; with none the subscription is made incomplete
	// for the client to confirm.
	PaymentMethod string
	// TrialEnd, when set, is when the first charge falls due: the end of the period another
	// subscription has paid for, which this one takes over from (FR-BI6).
	TrialEnd      time.Time
	AutomaticTax  bool
	IdempotencyID string
}

// NewSetup is a payment method to set up for household's subscription, for user.
type NewSetup struct {
	Customer     string
	Household    uuid.UUID
	User         uuid.UUID
	Purpose      string
	Subscription string
}

// NewCredit is a credit to a customer's balance.
type NewCredit struct {
	Customer    string
	AmountMinor int64
	Currency    string
	Note        string
}

// StorageLine is a month's storage blocks to bill (PRD 04 §4).
type StorageLine struct {
	Customer, Subscription string
	Price                  string
	Blocks                 int
	Household              uuid.UUID
	// Month is the month's first day, and From and To the month, To excluded.
	Month       string
	From, To    time.Time
	Description string
}

// Confirmation is what a client confirms with the processor: the secret of a payment or of a setup.
type Confirmation struct {
	ClientSecret string
	Intent       string
}

// PaymentMethod is a payment method's summary (PRD 04 §6): what Household keeps of a card.
type PaymentMethod struct {
	ID       string
	Brand    string
	Last4    string
	ExpMonth int
	ExpYear  int
}

// Subscription is a subscription as the processor has it.
type Subscription struct {
	ID, Customer string
	Status       string
	// Household and Payer are what its metadata names.
	Household, Payer       uuid.UUID
	Interval               string
	Currency               string
	PeriodStart, PeriodEnd time.Time
	CancelAtPeriodEnd      bool
	CancellationReason     string
	PaymentMethod          *PaymentMethod
	LatestInvoice          string
}

// Live reports whether the subscription is one a household is paid up by: active, past due while the
// processor still tries, or waiting out a period another has paid for with a payment method to
// charge at its end.
func (s Subscription) Live() bool {
	switch s.Status {
	case StatusActive, StatusPastDue:
		return true
	case StatusTrialing:
		return s.PaymentMethod != nil
	}
	return false
}

// Over reports whether the subscription has ended, or never began.
func (s Subscription) Over() bool {
	return s.Status == StatusCanceled || s.Status == StatusUnpaid || s.Status == StatusIncompleteExpired
}

// SetupIntent is a setup as the processor has it.
type SetupIntent struct {
	ID, Status    string
	Customer      string
	PaymentMethod string
	Household     uuid.UUID
	User          uuid.UUID
	Purpose       string
	Subscription  string
}

// The kinds of an invoice's line, as the contract's Invoice spells them.
const (
	LineBase       = "base"
	LineStorage    = "storage_blocks"
	LineCredit     = "credit"
	LineAdjustment = "adjustment"
)

// InvoiceLine is one line of an invoice.
type InvoiceLine struct {
	Kind        string  `json:"kind"`
	Description string  `json:"description"`
	Quantity    *string `json:"quantity"`
	AmountMinor int64   `json:"amount_minor"`
}

// Invoice is an invoice as the processor has it.
type Invoice struct {
	ID, Number, Status     string
	Customer, Subscription string
	Household              uuid.UUID
	Currency               string
	TotalMinor, TaxMinor   int64
	IssuedAt               time.Time
	PeriodStart, PeriodEnd time.Time
	Lines                  []InvoiceLine
	// Attempts is how many times the processor has tried to collect it, and NextAttempt when it tries
	// again, the zero time when it will not.
	Attempts    int
	NextAttempt time.Time
}

// Event is what a webhook says happened: its type, the object it is about, and the household that
// object's metadata names, the zero UUID when it names none.
type Event struct {
	ID, Type  string
	Object    string
	Household uuid.UUID
}
