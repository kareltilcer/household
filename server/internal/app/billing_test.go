package app_test

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/billing"
	"github.com/kareltilcer/household/server/internal/platform/billing/billingtest"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/money"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/storage"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// The tests in this file take a household through its subscription (plan item 19, PRD 04 §1, §4,
// §6), through the whole router and the committed contract, with billingtest's stand-in for Stripe
// behind billing's own Stripe processor: what the server asks of Stripe, and what it makes of
// Stripe's answers and its signed webhooks, is the code that ships.

// billingSite is a site whose billing asks stripe, the stand-in, on the site's clock.
func billingSite(t *testing.T) (*site, *billingtest.Stripe) {
	t.Helper()
	var s *site
	stripe := billingtest.New(t, func() time.Time { return s.clock.now() })
	s = newSite(t, apptest.Options{Processor: stripe.Processor(), Prices: billingtest.Prices()})
	return s, stripe
}

// moneyDoc is the contract's Money.
type moneyDoc = money.Money

// partyDoc is the contract's ActorRef.
type partyDoc struct {
	UserID uuid.UUID `json:"user_id"`
	Label  string    `json:"label"`
}

// subscriptionDoc is the contract's Subscription, as a client reads it.
type subscriptionDoc struct {
	State             string     `json:"state"`
	Interval          *string    `json:"interval"`
	CurrentPeriodEnd  *time.Time `json:"current_period_end"`
	CancelAtPeriodEnd bool       `json:"cancel_at_period_end"`
	GraceEndsAt       *time.Time `json:"grace_ends_at"`
	DataRetainedUntil *time.Time `json:"data_retained_until"`
	Payer             *partyDoc  `json:"payer"`
	PaymentMethod     *struct {
		Brand string  `json:"brand"`
		Last4 *string `json:"last4"`
	} `json:"payment_method"`
	BasePrice *moneyDoc `json:"base_price"`
	Plans     []struct {
		Interval string   `json:"interval"`
		Price    moneyDoc `json:"price"`
	} `json:"plans"`
	PricePerBlock moneyDoc `json:"price_per_storage_block"`
	Transfer      *struct {
		OfferedBy partyDoc `json:"offered_by"`
		OfferedTo partyDoc `json:"offered_to"`
	} `json:"transfer"`
}

// intentDoc is the contract's BillingIntent.
type intentDoc struct {
	ClientSecret   string `json:"client_secret"`
	Intent         string `json:"intent"`
	PublishableKey string `json:"publishable_key"`
}

// invoiceDoc is the contract's Invoice.
type invoiceDoc struct {
	ID         uuid.UUID `json:"id"`
	Number     *string   `json:"number"`
	Status     string    `json:"status"`
	Total      moneyDoc  `json:"total"`
	PeriodFrom string    `json:"period_from"`
	PeriodTo   string    `json:"period_to"`
	Lines      []struct {
		Kind     string   `json:"kind"`
		Quantity *string  `json:"quantity"`
		Amount   moneyDoc `json:"amount"`
	} `json:"lines"`
	PDFURL *string `json:"pdf_url"`
}

func billingPath(h uuid.UUID, rest string) string { return householdPath(h, "/billing"+rest) }

// subscription reads household h's subscription as b, and expects 200.
func (b *browser) subscription(h uuid.UUID) subscriptionDoc {
	b.s.t.Helper()
	rec := b.get(billingPath(h, "/subscription"))
	expect(b.s.t, rec, http.StatusOK, "")
	var doc subscriptionDoc
	decode(b.s.t, rec, &doc)
	return doc
}

// state is household h's entitlement state as b's household read says it, with its storage.
func (b *browser) entitlement(h uuid.UUID) (state string, blocks int, included int64) {
	b.s.t.Helper()
	rec := b.get(householdPath(h, ""))
	expect(b.s.t, rec, http.StatusOK, "")
	var doc struct {
		Entitlement struct {
			State    string `json:"state"`
			Blocks   int    `json:"storage_blocks"`
			Included int64  `json:"storage_included_bytes"`
		} `json:"entitlement"`
	}
	decode(b.s.t, rec, &doc)
	return doc.Entitlement.State, doc.Entitlement.Blocks, doc.Entitlement.Included
}

// startPaying begins b's subscription of h at interval, and expects the secret of a payment.
func (b *browser) startPaying(h uuid.UUID, interval string) intentDoc {
	b.s.t.Helper()
	rec := b.post(billingPath(h, "/subscription"), `{"interval":"`+interval+`"}`)
	expect(b.s.t, rec, http.StatusOK, "")
	var doc intentDoc
	decode(b.s.t, rec, &doc)
	if doc.Intent != billing.IntentPayment || doc.ClientSecret == "" || doc.PublishableKey != apptest.PublishableKey {
		b.s.t.Fatalf("the intent: %+v", doc)
	}
	return doc
}

// webhook delivers Stripe's event of kind about the object id, signed as Stripe signs it.
func (s *site) webhook(stripe *billingtest.Stripe, kind, id string) *httptest.ResponseRecorder {
	s.t.Helper()
	payload, signature := stripe.Event(kind, id, time.Now())
	return s.browser().send(request{
		method: http.MethodPost, path: "/webhooks/stripe", body: string(payload), noOrigin: true,
		header: http.Header{billing.SignatureHeader: {signature}},
	})
}

// told delivers Stripe's event and expects it taken.
func (s *site) told(stripe *billingtest.Stripe, kind, id string) {
	s.t.Helper()
	expect(s.t, s.webhook(stripe, kind, id), http.StatusNoContent, "")
}

// paid takes household h, whose payer is b, through subscribing at interval and paying, and returns
// the subscription's id at Stripe and its first invoice's.
func (s *site) paid(stripe *billingtest.Stripe, b *browser, h uuid.UUID, interval string) (subscription, invoice string) {
	s.t.Helper()
	intent := b.startPaying(h, interval)
	subscription, invoice = stripe.ConfirmPayment(intent.ClientSecret)
	s.told(stripe, "customer.subscription.updated", subscription)
	s.told(stripe, "invoice.paid", invoice)
	if state, _, _ := b.entitlement(h); state != string(entitlement.Active) {
		s.t.Fatalf("after paying, the household is %s", state)
	}
	return subscription, invoice
}

// mailed are the subjects of the mail sent to address since the last call, in order.
func (s *site) subjects(address string) []string {
	s.t.Helper()
	var out []string
	for _, m := range s.outbox.To(address) {
		out = append(out, m.Subject)
	}
	return out
}

// has reports whether any of subjects contains part.
func has(subjects []string, part string) int {
	n := 0
	for _, s := range subjects {
		if strings.Contains(s, part) {
			n++
		}
	}
	return n
}

// The payer subscribes by confirming a payment with the processor (Q17): the household changes only
// once Stripe says it was paid, an event delivered twice changes nothing more, the invoice is kept
// with its lines and emailed to the payer, who alone reads it and the payment method's summary; other
// owners see the state, and members and children see nothing of billing at all (FR-BI5). A household
// whose base currency has no prices of its own is charged in EUR (D-130).
func TestSubscribing(t *testing.T) {
	s, stripe := billingSite(t)
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	eva, evaID := s.joined(jana, h.ID, "Eva", s.a("eva@example"), "owner", nil)
	petr, _ := s.joined(jana, h.ID, "Petr", s.a("petr@example"), "member", nil)

	// On trial: no subscription, the plans it would pay, in EUR since CZK has none.
	sub := jana.subscription(h.ID)
	if sub.State != "trialing" || sub.Interval != nil || sub.BasePrice != nil || sub.Payer == nil || sub.Payer.Label != "Jana" ||
		len(sub.Plans) != 2 || sub.Plans[0] != (struct {
		Interval string   `json:"interval"`
		Price    moneyDoc `json:"price"`
	}{"year", moneyDoc{AmountMinor: 5988, Currency: "EUR"}}) || sub.Plans[1].Price != (moneyDoc{AmountMinor: 599, Currency: "EUR"}) ||
		sub.PricePerBlock != (moneyDoc{AmountMinor: 100, Currency: "EUR"}) {
		t.Fatalf("on trial: %+v", sub)
	}
	// Billing is no part of a member's app; another owner sees it and may not subscribe.
	for _, path := range []string{"/subscription", "/invoices", "/usage"} {
		expect(t, petr.get(billingPath(h.ID, path)), http.StatusNotFound, problem.CodeNotFound)
	}
	expect(t, petr.post(billingPath(h.ID, "/subscription"), `{"interval":"year"}`), http.StatusNotFound, problem.CodeNotFound)
	expect(t, eva.post(billingPath(h.ID, "/subscription"), `{"interval":"year"}`), http.StatusForbidden, problem.CodeForbidden)
	expect(t, jana.post(billingPath(h.ID, "/subscription"), `{"interval":"week"}`), http.StatusUnprocessableEntity, problem.CodeValidationFailed)
	expect(t, jana.post(billingPath(h.ID, "/cancel"), ""), http.StatusConflict, problem.CodeNotSubscribed)
	if len(stripe.Requests()) != 0 {
		t.Fatal("Stripe was asked something before anyone subscribed")
	}

	// The subscription is made unpaid, and the household is as it was.
	first := jana.startPaying(h.ID, "year")
	if state, _, _ := jana.entitlement(h.ID); state != "trialing" {
		t.Fatalf("before the payment is confirmed the household is %s", state)
	}
	// Asked again it answers the same secret; at the other interval the first is cancelled for a new one.
	if again := jana.startPaying(h.ID, "year"); again.ClientSecret != first.ClientSecret {
		t.Fatalf("asked again: %q, want %q", again.ClientSecret, first.ClientSecret)
	}
	monthly := jana.startPaying(h.ID, "month")
	ids := stripe.Subscriptions()
	if len(ids) != 2 || monthly.ClientSecret == first.ClientSecret {
		t.Fatalf("subscriptions at Stripe: %v", ids)
	}
	if status, _, pending := stripe.Subscription(ids[0]); status != "canceled" || pending != "month" {
		t.Fatalf("the yearly one waiting: %s, storage invoiced each %q", status, pending)
	}
	if _, _, pending := stripe.Subscription(ids[1]); pending != "" {
		t.Fatalf("the monthly one's storage is invoiced each %q, want with its renewal", pending)
	}

	// Stripe says it was paid: the household is active, once, however often it says so.
	subscription, invoice := stripe.ConfirmPayment(monthly.ClientSecret)
	for range 2 {
		s.told(stripe, "customer.subscription.updated", subscription)
		s.told(stripe, "invoice.paid", invoice)
	}
	if state, _, _ := petr.entitlement(h.ID); state != "active" {
		t.Fatalf("after the payment the household is %s", state)
	}
	if n := s.count("SELECT count(*) FROM audit_events WHERE household_id = $1 AND module = 'admin' AND action = 'household.entitlement'", h.ID); n != 1 {
		t.Fatalf("%d entitlement events, want 1", n)
	}
	sub = jana.subscription(h.ID)
	if sub.State != "active" || sub.Interval == nil || *sub.Interval != "month" || sub.CurrentPeriodEnd == nil ||
		sub.BasePrice == nil || *sub.BasePrice != (moneyDoc{AmountMinor: 599, Currency: "EUR"}) ||
		sub.PaymentMethod == nil || sub.PaymentMethod.Brand != "visa" || sub.PaymentMethod.Last4 == nil || *sub.PaymentMethod.Last4 != "4242" {
		t.Fatalf("the payer's subscription: %+v", sub)
	}
	if other := eva.subscription(h.ID); other.State != "active" || other.PaymentMethod != nil || other.Payer.UserID == evaID {
		t.Fatalf("another owner's view: %+v", other)
	}
	expect(t, jana.post(billingPath(h.ID, "/subscription"), `{"interval":"year"}`), http.StatusConflict, problem.CodeAlreadySubscribed)

	// The invoice: the payer's, emailed once, with its base fee as a line and its PDF's link on demand.
	if n := has(s.subjects(s.a("jana@example")), "invoice"); n != 1 {
		t.Fatalf("%d invoice emails, want 1", n)
	}
	var page struct {
		Items []invoiceDoc `json:"items"`
		Meta  struct {
			HasMore bool `json:"has_more"`
		} `json:"meta"`
	}
	rec := jana.get(billingPath(h.ID, "/invoices"))
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &page)
	if len(page.Items) != 1 || page.Meta.HasMore || page.Items[0].Status != "paid" || page.Items[0].Total != (moneyDoc{AmountMinor: 599, Currency: "EUR"}) ||
		len(page.Items[0].Lines) != 1 || page.Items[0].Lines[0].Kind != billing.LineBase || page.Items[0].PDFURL != nil {
		t.Fatalf("the invoices: %+v", page)
	}
	var one invoiceDoc
	rec = jana.get(billingPath(h.ID, "/invoices/"+page.Items[0].ID.String()))
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &one)
	if one.PDFURL == nil || !strings.Contains(*one.PDFURL, invoice) {
		t.Fatalf("the invoice's link: %+v", one)
	}
	expect(t, eva.get(billingPath(h.ID, "/invoices")), http.StatusForbidden, problem.CodeForbidden)
	expect(t, eva.get(billingPath(h.ID, "/invoices/"+one.ID.String())), http.StatusNotFound, problem.CodeNotFound)
	expect(t, jana.get(billingPath(h.ID, "/invoices?cursor=nonsense")), http.StatusUnprocessableEntity, problem.CodeValidationFailed)
}

// A webhook is taken on its signature alone: one signed with another secret, one whose signature is
// old, and one with none are refused, and an event about nothing of a household's is taken and
// ignored. With no processor configured, billing answers 503 where it would ask one, and still reads.
func TestTheWebhookIsProvedByItsSignature(t *testing.T) {
	s, stripe := billingSite(t)
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	intent := jana.startPaying(h.ID, "year")
	subscription, _ := stripe.ConfirmPayment(intent.ClientSecret)

	payload, _ := stripe.Event("customer.subscription.updated", subscription, time.Now())
	send := func(signature string) *httptest.ResponseRecorder {
		header := http.Header{}
		if signature != "" {
			header.Set(billing.SignatureHeader, signature)
		}
		return s.browser().send(request{method: http.MethodPost, path: "/webhooks/stripe", body: string(payload), noOrigin: true, header: header})
	}
	expect(t, send(""), http.StatusUnprocessableEntity, problem.CodeValidationFailed)
	expect(t, send(billingtest.Sign(payload, "whsec_another", time.Now())), http.StatusUnprocessableEntity, problem.CodeValidationFailed)
	expect(t, send(billingtest.Sign(payload, billingtest.WebhookSecret, time.Now().Add(-10*time.Minute))), http.StatusUnprocessableEntity, problem.CodeValidationFailed)
	if state, _, _ := jana.entitlement(h.ID); state != "trialing" {
		t.Fatalf("a webhook nobody proved made the household %s", state)
	}
	expect(t, send(billingtest.Sign(payload, billingtest.WebhookSecret, time.Now())), http.StatusNoContent, "")
	if state, _, _ := jana.entitlement(h.ID); state != "active" {
		t.Fatalf("the proved webhook left the household %s", state)
	}

	// Stripe failing on its own side is a 503 for the caller and a 500 for Stripe, which delivers again.
	stripe.Down(true)
	expect(t, jana.post(billingPath(h.ID, "/cancel"), ""), http.StatusServiceUnavailable, problem.CodeBillingUnavailable)
	expect(t, send(billingtest.Sign(payload, billingtest.WebhookSecret, time.Now())), http.StatusInternalServerError, problem.CodeInternal)
	stripe.Down(false)

	// No processor at all, as a development server may have none.
	bare := newSite(t, apptest.Options{})
	mila := bare.person("Mila", bare.a("mila@example"))
	hb := mila.create("Novakovi")
	if sub := mila.subscription(hb.ID); sub.State != "trialing" || len(sub.Plans) != 2 {
		t.Fatalf("with no processor: %+v", sub)
	}
	expect(t, mila.post(billingPath(hb.ID, "/subscription"), `{"interval":"year"}`), http.StatusServiceUnavailable, problem.CodeBillingUnavailable)
	expect(t, bare.browser().send(request{method: http.MethodPost, path: "/webhooks/stripe", body: `{}`, noOrigin: true,
		header: http.Header{billing.SignatureHeader: {"t=1,v1=00"}}}), http.StatusServiceUnavailable, problem.CodeBillingUnavailable)
}

// Only a payer whose address is verified subscribes (PRD 02 §3).
func TestAnUnverifiedPayerDoesNotSubscribe(t *testing.T) {
	s, stripe := billingSite(t)
	jana := s.unverified("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	expect(t, jana.post(billingPath(h.ID, "/subscription"), `{"interval":"year"}`), http.StatusForbidden, problem.CodeAccountUnverified)
	if len(stripe.Subscriptions()) != 0 {
		t.Fatal("a subscription was made for an unverified payer")
	}
}

// A payment that fails restricts nothing (PRD 04 §3): the household is past_due, with the clock the
// hourly backstop reads a day past the retries' end. The first failure is the banner's alone, and
// each retry that fails after it is emailed to the payer, once. When Stripe gives up, the household
// is in grace, uploads blocked; a new payment method tried at once brings a past_due household back.
func TestAFailedPaymentIsRetriedThenGivenUp(t *testing.T) {
	s, stripe := billingSite(t)
	address := s.a("jana@example")
	jana := s.person("Jana", address)
	h := jana.create("Tilcerovi")
	subscription, _ := s.paid(stripe, jana, h.ID, "month")
	failed := func() int { return has(s.subjects(address), "couldn") }

	invoice := stripe.FailPayment(subscription, true)
	s.told(stripe, "customer.subscription.updated", subscription)
	s.told(stripe, "invoice.payment_failed", invoice)
	if state, _, _ := jana.entitlement(h.ID); state != "past_due" {
		t.Fatalf("after a failed payment the household is %s", state)
	}
	var ends time.Time
	if err := s.admin.QueryRow(t.Context(), "SELECT dunning_ends_at FROM households WHERE id = $1", h.ID).Scan(&ends); err != nil {
		t.Fatal(err)
	}
	if want := s.clock.now().Add(8 * 24 * time.Hour); !ends.Equal(want) {
		t.Fatalf("the backstop's clock ends %s, want %s", ends, want)
	}
	if failed() != 0 {
		t.Fatal("the first failure was emailed, which is the banner's alone")
	}
	// Nothing is restricted: the household still writes.
	expect(t, jana.patch(householdPath(h.ID, ""), `{"name":"Tilcerovi doma"}`, nil), http.StatusOK, "")

	// The retry at one day fails, and is emailed once however often Stripe says so.
	stripe.FailPayment(subscription, true)
	s.told(stripe, "invoice.payment_failed", invoice)
	s.told(stripe, "invoice.payment_failed", invoice)
	if n := failed(); n != 1 {
		t.Fatalf("%d emails after the first retry, want 1", n)
	}
	mail := s.outbox.To(address)
	if body := mail[len(mail)-1].Body; !strings.Contains(body, "try again") || !strings.Contains(body, "/settings/billing") {
		t.Fatalf("the retry's email: %s", body)
	}
	// The clock does not start again with each failure.
	s.told(stripe, "customer.subscription.updated", subscription)
	var still time.Time
	if err := s.admin.QueryRow(t.Context(), "SELECT dunning_ends_at FROM households WHERE id = $1", h.ID).Scan(&still); err != nil || !still.Equal(ends) {
		t.Fatalf("the clock moved to %s (%v)", still, err)
	}

	// A new payment method is confirmed, and the open invoice collected with it at once.
	rec := jana.post(billingPath(h.ID, "/payment-method"), "")
	expect(t, rec, http.StatusOK, "")
	var setup intentDoc
	decode(t, rec, &setup)
	if setup.Intent != billing.IntentSetup {
		t.Fatalf("the setup: %+v", setup)
	}
	s.told(stripe, "setup_intent.succeeded", stripe.ConfirmSetup(setup.ClientSecret))
	if stripe.InvoiceStatus(invoice) != "paid" {
		t.Fatalf("the open invoice is %s after the new method", stripe.InvoiceStatus(invoice))
	}
	s.told(stripe, "customer.subscription.updated", subscription)
	s.told(stripe, "invoice.paid", invoice)
	if state, _, _ := jana.entitlement(h.ID); state != "active" {
		t.Fatalf("after the payment went through the household is %s", state)
	}
	if n := s.count("SELECT count(*) FROM households WHERE id = $1 AND dunning_ends_at IS NULL", h.ID); n != 1 {
		t.Fatal("the dunning clock was not cleared")
	}

	// It fails again, to the end: the last retry's email says so, and Stripe ends the subscription.
	invoice = stripe.FailPayment(subscription, true)
	s.told(stripe, "customer.subscription.updated", subscription)
	stripe.FailPayment(subscription, false)
	s.told(stripe, "invoice.payment_failed", invoice)
	mail = s.outbox.To(address)
	if body := mail[len(mail)-1].Body; !strings.Contains(body, "last attempt") {
		t.Fatalf("the last retry's email: %s", body)
	}
	stripe.GiveUp(subscription)
	s.told(stripe, "customer.subscription.deleted", subscription)
	sub := jana.subscription(h.ID)
	if sub.State != "grace" || sub.Interval != nil || sub.GraceEndsAt == nil || !sub.GraceEndsAt.Equal(s.clock.now().Add(14*24*time.Hour)) {
		t.Fatalf("after Stripe gave up: %+v", sub)
	}
	// Grace writes and does not upload, and what fixes it for an owner is a payment method.
	var doc struct {
		Entitlement entitlementDoc `json:"entitlement"`
	}
	rec = jana.get(householdPath(h.ID, ""))
	decode(t, rec, &doc)
	if !doc.Entitlement.CanWrite || doc.Entitlement.CanUpload {
		t.Fatalf("grace: %+v", doc.Entitlement)
	}
	// Subscribing again restores it.
	s.paid(stripe, jana, h.ID, "year")
	if n := s.count("SELECT count(*) FROM households WHERE id = $1 AND grace_ends_at IS NULL AND dunning_ends_at IS NULL", h.ID); n != 1 {
		t.Fatal("the lapse's clocks were not cleared")
	}
}

// The payer cancels at the period's end and may take it back until then; once the period ends the
// household is canceled, read-only with its deletion date, and subscribing again restores it at any
// point of its retention (D-32). Another owner may do neither.
func TestCancellingAndResuming(t *testing.T) {
	s, stripe := billingSite(t)
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	eva, _ := s.joined(jana, h.ID, "Eva", s.a("eva@example"), "owner", nil)
	subscription, _ := s.paid(stripe, jana, h.ID, "year")

	expect(t, eva.post(billingPath(h.ID, "/cancel"), ""), http.StatusForbidden, problem.CodeForbidden)
	var sub subscriptionDoc
	rec := jana.post(billingPath(h.ID, "/cancel"), "")
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &sub)
	if !sub.CancelAtPeriodEnd || sub.State != "active" {
		t.Fatalf("cancelled: %+v", sub)
	}
	if _, cancel, _ := stripe.Subscription(subscription); !cancel {
		t.Fatal("Stripe was not told to cancel at the period's end")
	}
	rec = jana.post(billingPath(h.ID, "/resume"), "")
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &sub)
	if _, cancel, _ := stripe.Subscription(subscription); cancel || sub.CancelAtPeriodEnd {
		t.Fatalf("resumed: %+v", sub)
	}

	// Cancelled again, and the period ends.
	expect(t, jana.post(billingPath(h.ID, "/cancel"), ""), http.StatusOK, "")
	stripe.EndPeriod(subscription)
	s.told(stripe, "customer.subscription.deleted", subscription)
	sub = jana.subscription(h.ID)
	lapsed := s.clock.now()
	if sub.State != "canceled" || sub.DataRetainedUntil == nil || !sub.DataRetainedUntil.Equal(entitlement.RetainedUntil(lapsed)) {
		t.Fatalf("after the period ended: %+v, want retained until %s", sub, entitlement.RetainedUntil(lapsed))
	}
	// It does not write, and billing is exempt: the payer subscribes again, which restores it.
	rec = jana.patch(householdPath(h.ID, ""), `{"name":"Jinak"}`, nil)
	expect(t, rec, http.StatusPaymentRequired, problem.CodeEntitlementReadOnly)
	if r := refusalOf(t, rec); r.Remedy != entitlement.RemedySubscribe {
		t.Fatalf("the remedy: %+v", r)
	}
	expect(t, jana.post(billingPath(h.ID, "/resume"), ""), http.StatusConflict, problem.CodeNotSubscribed)
	s.paid(stripe, jana, h.ID, "month")
	if n := s.count("SELECT count(*) FROM households WHERE id = $1 AND lapsed_at IS NULL AND retained_until IS NULL", h.ID); n != 1 {
		t.Fatal("the countdown was not cleared")
	}
}

// Billing moves in two steps (FR-BI6): the payer offers it to another owner, who accepts and
// confirms a card. Until the card is confirmed the payer goes on paying; then the new payer's
// subscription starts when the paid period ends, the old one is cancelled at that end, and the old
// payer is told. Nobody pays twice, and nothing lapses in between.
func TestTakingOverBilling(t *testing.T) {
	s, stripe := billingSite(t)
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	eva, evaID := s.joined(jana, h.ID, "Eva", s.a("eva@example"), "owner", nil)
	petr, petrID := s.joined(jana, h.ID, "Petr", s.a("petr@example"), "member", nil)
	janaID := jana.me().ID
	old, _ := s.paid(stripe, jana, h.ID, "year")
	offer := func(b *browser, to uuid.UUID) *httptest.ResponseRecorder {
		return b.post(billingPath(h.ID, "/transfer"), fmt.Sprintf(`{"user_id":%q}`, to))
	}

	// Only the payer offers, and only to another owner.
	expect(t, offer(eva, janaID), http.StatusForbidden, problem.CodeForbidden)
	expect(t, offer(petr, evaID), http.StatusNotFound, problem.CodeNotFound)
	expect(t, offer(jana, petrID), http.StatusUnprocessableEntity, problem.CodeValidationFailed)
	expect(t, offer(jana, janaID), http.StatusUnprocessableEntity, problem.CodeValidationFailed)
	expect(t, eva.post(billingPath(h.ID, "/transfer/accept"), ""), http.StatusNotFound, problem.CodeNotFound)

	expect(t, offer(jana, evaID), http.StatusAccepted, "")
	if n := has(s.subjects(s.a("eva@example")), "offered you billing"); n != 1 {
		t.Fatalf("%d offers emailed, want 1", n)
	}
	if sub := eva.subscription(h.ID); sub.Transfer == nil || sub.Transfer.OfferedTo.UserID != evaID || sub.Transfer.OfferedBy.Label != "Jana" {
		t.Fatalf("the offer: %+v", sub.Transfer)
	}
	// The offer is hers alone to accept.
	expect(t, jana.post(billingPath(h.ID, "/transfer/accept"), ""), http.StatusNotFound, problem.CodeNotFound)

	// She accepts: a card to confirm, and Jana is the payer still.
	var accepted struct {
		Subscription subscriptionDoc `json:"subscription"`
		Confirmation *intentDoc      `json:"confirmation"`
	}
	rec := eva.post(billingPath(h.ID, "/transfer/accept"), "")
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &accepted)
	if accepted.Confirmation == nil || accepted.Confirmation.Intent != billing.IntentSetup || accepted.Subscription.Payer.UserID != janaID {
		t.Fatalf("accepted: %+v", accepted)
	}
	if len(stripe.Subscriptions()) != 1 {
		t.Fatal("a subscription was made before the card was confirmed")
	}

	// The card is confirmed, twice told: one subscription, from the end of the period paid for.
	setup := stripe.ConfirmSetup(accepted.Confirmation.ClientSecret)
	s.told(stripe, "setup_intent.succeeded", setup)
	s.told(stripe, "setup_intent.succeeded", setup)
	ids := stripe.Subscriptions()
	if len(ids) != 2 {
		t.Fatalf("subscriptions at Stripe: %v", ids)
	}
	if status, cancel, _ := stripe.Subscription(old); status != "active" || !cancel {
		t.Fatalf("the old subscription: %s, cancels at its period's end: %v", status, cancel)
	}
	if status, _, pending := stripe.Subscription(ids[1]); status != "trialing" || pending != "month" {
		t.Fatalf("the new subscription: %s, storage invoiced each %q", status, pending)
	}
	sub := eva.subscription(h.ID)
	if sub.State != "active" || sub.Payer.UserID != evaID || sub.PaymentMethod == nil || sub.Transfer != nil || sub.Interval == nil || *sub.Interval != "year" {
		t.Fatalf("the new payer's view: %+v", sub)
	}
	if was := jana.subscription(h.ID); was.PaymentMethod != nil || was.Payer.UserID != evaID {
		t.Fatalf("the old payer's view: %+v", was)
	}
	if n := has(s.subjects(s.a("jana@example")), "now pays"); n != 1 {
		t.Fatalf("the old payer was told %d times, want 1", n)
	}
	if n := s.count("SELECT count(*) FROM audit_events WHERE household_id = $1 AND module = 'admin' AND action = 'household.payer'", h.ID); n != 1 {
		t.Fatalf("%d payer events, want 1", n)
	}
	// The payer who handed billing on may now leave ownership behind; the new one may not.
	rec = jana.get(householdPath(h.ID, "/members/"+evaID.String()))
	expect(t, rec, http.StatusOK, "")
	var member memberDoc
	decode(t, rec, &member)
	if !member.IsBillingPayer {
		t.Fatalf("the member list's payer: %+v", member)
	}

	// The old period ends: its subscription is over, and the household stays paid for by the new one.
	stripe.EndPeriod(old)
	s.told(stripe, "customer.subscription.deleted", old)
	invoice := stripe.EndPeriod(ids[1])
	s.told(stripe, "customer.subscription.updated", ids[1])
	s.told(stripe, "invoice.paid", invoice)
	if state, _, _ := petr.entitlement(h.ID); state != "active" {
		t.Fatalf("after the hand-over the household is %s", state)
	}
	// Each reads the invoices they paid.
	for who, b := range map[string]*browser{"the old payer": jana, "the new payer": eva} {
		var page struct {
			Items []invoiceDoc `json:"items"`
		}
		rec := b.get(billingPath(h.ID, "/invoices"))
		expect(t, rec, http.StatusOK, "")
		decode(t, rec, &page)
		if len(page.Items) != 1 {
			t.Fatalf("%s reads %d invoices, want their own one", who, len(page.Items))
		}
	}

	// An offer declined changes nothing, and one withdrawn is gone.
	expect(t, offer(eva, janaID), http.StatusAccepted, "")
	expect(t, petr.delete(billingPath(h.ID, "/transfer")), http.StatusNotFound, problem.CodeNotFound)
	expect(t, jana.delete(billingPath(h.ID, "/transfer")), http.StatusNoContent, "")
	if sub := eva.subscription(h.ID); sub.Transfer != nil || sub.Payer.UserID != evaID {
		t.Fatalf("after the decline: %+v", sub)
	}
	expect(t, jana.post(billingPath(h.ID, "/transfer/accept"), ""), http.StatusNotFound, problem.CodeNotFound)
	expect(t, eva.delete(billingPath(h.ID, "/transfer")), http.StatusNoContent, "")
}

// A household with no subscription has no card to hand over: the owner who accepts is its payer at
// once. One whose payment is being retried is taken over at once too, with the new card, and the
// subscription that could not be collected is ended with its invoice voided.
func TestTakingOverWithNothingPaidUp(t *testing.T) {
	s, stripe := billingSite(t)
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	eva, evaID := s.joined(jana, h.ID, "Eva", s.a("eva@example"), "owner", nil)
	offer := fmt.Sprintf(`{"user_id":%q}`, evaID)
	var accepted struct {
		Subscription subscriptionDoc `json:"subscription"`
		Confirmation *intentDoc      `json:"confirmation"`
	}

	// On trial.
	expect(t, jana.post(billingPath(h.ID, "/transfer"), offer), http.StatusAccepted, "")
	rec := eva.post(billingPath(h.ID, "/transfer/accept"), "")
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &accepted)
	if accepted.Confirmation != nil || accepted.Subscription.Payer.UserID != evaID || accepted.Subscription.Transfer != nil {
		t.Fatalf("accepted on trial: %+v", accepted)
	}
	if len(stripe.Requests()) != 0 {
		t.Fatal("Stripe was asked something for a household with no subscription")
	}

	// Past due: Eva pays, fails, and offers it back to Jana, whose card is charged at once.
	subscription, _ := s.paid(stripe, eva, h.ID, "month")
	invoice := stripe.FailPayment(subscription, true)
	s.told(stripe, "customer.subscription.updated", subscription)
	janaID := jana.me().ID
	expect(t, eva.post(billingPath(h.ID, "/transfer"), fmt.Sprintf(`{"user_id":%q}`, janaID)), http.StatusAccepted, "")
	rec = jana.post(billingPath(h.ID, "/transfer/accept"), "")
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &accepted)
	s.told(stripe, "setup_intent.succeeded", stripe.ConfirmSetup(accepted.Confirmation.ClientSecret))
	ids := stripe.Subscriptions()
	if status, _, _ := stripe.Subscription(ids[len(ids)-1]); status != "active" {
		t.Fatalf("the new subscription is %s, want charged at once", status)
	}
	if status, _, _ := stripe.Subscription(subscription); status != "canceled" || stripe.InvoiceStatus(invoice) != "void" {
		t.Fatalf("the subscription that could not be collected: %s, its invoice %s", status, stripe.InvoiceStatus(invoice))
	}
	if sub := jana.subscription(h.ID); sub.State != "active" || sub.Payer.UserID != janaID {
		t.Fatalf("after the take-over: %+v", sub)
	}
	// What Stripe then says of the old one changes nothing.
	s.told(stripe, "customer.subscription.deleted", subscription)
	if state, _, _ := jana.entitlement(h.ID); state != "active" {
		t.Fatalf("the old subscription's end made the household %s", state)
	}
}

// acceptedDoc is postBillingTransferAccept's answer, as a client reads it.
type acceptedDoc struct {
	Subscription subscriptionDoc `json:"subscription"`
	Confirmation *intentDoc      `json:"confirmation"`
}

// offers has from, the payer of h, offer its billing to the owner to, and expects it taken.
func offers(t *testing.T, from *browser, h, to uuid.UUID) {
	t.Helper()
	expect(t, from.post(billingPath(h, "/transfer"), fmt.Sprintf(`{"user_id":%q}`, to)), http.StatusAccepted, "")
}

// accepts has b accept the billing of h offered them, and returns the answer.
func accepts(t *testing.T, b *browser, h uuid.UUID) acceptedDoc {
	t.Helper()
	var out acceptedDoc
	rec := b.post(billingPath(h, "/transfer/accept"), "")
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &out)
	return out
}

// Billing handed on a second time before the period the first payer paid for has ended is paid for
// by that period still (FR-BI6, D-131): the next payer's subscription waits for its end, as the one
// it takes over from does, which is then never charged, and nobody pays for days already paid for.
// A card's confirmation delivered again once the subscription it made is the household's makes no
// other.
func TestTakingOverAgainWithinThePaidPeriod(t *testing.T) {
	s, stripe := billingSite(t)
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	eva, evaID := s.joined(jana, h.ID, "Eva", s.a("eva@example"), "owner", nil)
	janaID := jana.me().ID
	first, _ := s.paid(stripe, jana, h.ID, "year")
	// take hands billing from the payer to the other owner, and returns the setup they confirmed.
	take := func(from, to *browser, toID uuid.UUID) string {
		t.Helper()
		offers(t, from, h.ID, toID)
		answer := accepts(t, to, h.ID)
		if answer.Confirmation == nil {
			t.Fatal("no card to confirm")
		}
		setup := stripe.ConfirmSetup(answer.Confirmation.ClientSecret)
		s.told(stripe, "setup_intent.succeeded", setup)
		return setup
	}

	take(jana, eva, evaID)
	setup := take(eva, jana, janaID)
	ids := stripe.Subscriptions()
	if len(ids) != 3 {
		t.Fatalf("subscriptions at Stripe: %v", ids)
	}
	if status, cancel, _ := stripe.Subscription(ids[2]); status != "trialing" || cancel {
		t.Fatalf("the third subscription is %s, want waiting for the end of the period already paid for", status)
	}
	if status, cancel, _ := stripe.Subscription(ids[1]); status != "trialing" || !cancel {
		t.Fatalf("the second subscription: %s, cancels at its period's end: %v; want ended before it charges", status, cancel)
	}
	if status, cancel, _ := stripe.Subscription(first); status != "active" || !cancel {
		t.Fatalf("the first subscription: %s, cancels at its period's end: %v", status, cancel)
	}
	if sub := jana.subscription(h.ID); sub.State != "active" || sub.Payer.UserID != janaID || sub.PaymentMethod == nil {
		t.Fatalf("after the second take-over: %+v", sub)
	}

	// The confirmation is delivered again while an offer to her is open, as when its first delivery
	// stopped short of settling: the subscription is hers already, and Stripe is asked for no other.
	now := s.clock.now()
	if _, err := s.admin.Exec(t.Context(), `
		INSERT INTO billing_transfers (household_id, offered_by, offered_to, offered_at, expires_at) VALUES ($1, $2, $3, $4, $5)`,
		h.ID, evaID, janaID, now, now.Add(billing.OfferFor)); err != nil {
		t.Fatal(err)
	}
	stripe.Requests()
	s.told(stripe, "setup_intent.succeeded", setup)
	for _, r := range stripe.Requests() {
		if r.Method == http.MethodPost && r.Path == "/v1/subscriptions" {
			t.Fatal("a subscription was asked for again for a payer whose subscription is the household's")
		}
	}
	if sub := jana.subscription(h.ID); sub.State != "active" || sub.Payer.UserID != janaID {
		t.Fatalf("after the second delivery: %+v", sub)
	}
}

// A card declined as billing is taken over moves nothing: the taker's subscription waits unpaid, and
// the payer of record stays. A second card is tried on the subscription that waits, rather than
// another made, and billing moves once it is paid (FR-BI6).
func TestATakeOverWhoseCardIsDeclinedIsTriedAgain(t *testing.T) {
	s, stripe := billingSite(t)
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	eva, evaID := s.joined(jana, h.ID, "Eva", s.a("eva@example"), "owner", nil)
	janaID := jana.me().ID
	old, _ := s.paid(stripe, jana, h.ID, "month")
	invoice := stripe.FailPayment(old, true)
	s.told(stripe, "customer.subscription.updated", old)
	offers(t, jana, h.ID, evaID)
	confirm := func() {
		t.Helper()
		s.told(stripe, "setup_intent.succeeded", stripe.ConfirmSetup(accepts(t, eva, h.ID).Confirmation.ClientSecret))
	}

	stripe.Decline(true)
	confirm()
	ids := stripe.Subscriptions()
	if len(ids) != 2 {
		t.Fatalf("subscriptions at Stripe: %v", ids)
	}
	if status, _, _ := stripe.Subscription(ids[1]); status != "incomplete" {
		t.Fatalf("the subscription whose card was declined is %s", status)
	}
	if status, _, _ := stripe.Subscription(old); status != "past_due" {
		t.Fatalf("the payer's subscription is %s before billing has moved", status)
	}
	if sub := eva.subscription(h.ID); sub.State != "past_due" || sub.Payer.UserID != janaID || sub.Transfer == nil {
		t.Fatalf("after the declined card: %+v", sub)
	}

	stripe.Decline(false)
	confirm()
	if ids := stripe.Subscriptions(); len(ids) != 2 {
		t.Fatalf("a second card made another subscription: %v", ids)
	}
	if status, _, _ := stripe.Subscription(ids[1]); status != "active" {
		t.Fatalf("the subscription tried again is %s", status)
	}
	if status, _, _ := stripe.Subscription(old); status != "canceled" || stripe.InvoiceStatus(invoice) != "void" {
		t.Fatalf("the subscription that could not be collected: %s, its invoice %s", status, stripe.InvoiceStatus(invoice))
	}
	if sub := eva.subscription(h.ID); sub.State != "active" || sub.Payer.UserID != evaID || sub.Transfer != nil || sub.PaymentMethod == nil {
		t.Fatalf("after the second card: %+v", sub)
	}
}

// A card confirmed after the subscription it was to take over has ended moves the payer alone, as
// accepting with no subscription does, while the offer made its owner still stands (FR-BI6).
func TestACardConfirmedAfterTheSubscriptionEndedMovesThePayerAlone(t *testing.T) {
	s, stripe := billingSite(t)
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	eva, evaID := s.joined(jana, h.ID, "Eva", s.a("eva@example"), "owner", nil)
	subscription, _ := s.paid(stripe, jana, h.ID, "month")
	offers(t, jana, h.ID, evaID)
	answer := accepts(t, eva, h.ID)
	if answer.Confirmation == nil {
		t.Fatal("no card to confirm")
	}

	expect(t, jana.post(billingPath(h.ID, "/cancel"), ""), http.StatusOK, "")
	stripe.EndPeriod(subscription)
	s.told(stripe, "customer.subscription.deleted", subscription)
	if sub := eva.subscription(h.ID); sub.State != "canceled" || sub.Payer.UserID == evaID || sub.Transfer == nil {
		t.Fatalf("once the subscription ended: %+v", sub)
	}

	s.told(stripe, "setup_intent.succeeded", stripe.ConfirmSetup(answer.Confirmation.ClientSecret))
	if n := len(stripe.Subscriptions()); n != 1 {
		t.Fatalf("%d subscriptions at Stripe, want none made for a household that has none to take over", n)
	}
	if sub := eva.subscription(h.ID); sub.State != "canceled" || sub.Payer.UserID != evaID || sub.Transfer != nil {
		t.Fatalf("after the card was confirmed: %+v", sub)
	}
}

// An offer's email that waits for the mail server goes with the offer: once billing has moved,
// nothing offers it again when the mail server takes mail again.
func TestAnOffersWaitingEmailGoesOnceBillingMoves(t *testing.T) {
	s, _ := billingSite(t)
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	eva, evaID := s.joined(jana, h.ID, "Eva", s.a("eva@example"), "owner", nil)
	offered := func() int { return has(s.subjects(s.a("eva@example")), "offered you billing") }

	s.outbox.Refuse(1)
	offers(t, jana, h.ID, evaID)
	if n := offered(); n != 0 {
		t.Fatalf("%d offers emailed while the mail server refused them", n)
	}
	// On trial there is no card to confirm: she is the payer at once, and the offer is spent.
	if answer := accepts(t, eva, h.ID); answer.Confirmation != nil || answer.Subscription.Payer.UserID != evaID {
		t.Fatalf("accepted: %+v", answer)
	}
	if _, err := s.admin.Exec(t.Context(), "UPDATE notifications SET run_at = now() WHERE household_id = $1 AND status = 'queued'", h.ID); err != nil {
		t.Fatal(err)
	}
	s.notifier.Drain(t.Context(), h.ID)
	if n := offered(); n != 0 {
		t.Fatalf("the offer was emailed %d times after billing had moved", n)
	}
}

// A subscription never paid expires and changes nothing (D-129): the household is as it was. One
// Stripe holds for the household that no row records, its request having ended between Stripe's
// answer and its record, is taken up as the one waiting, so that asking again answers its secret
// rather than making another, and paying it makes it the household's; a second such is cancelled.
func TestASubscriptionNeverPaidOrNeverRecorded(t *testing.T) {
	s, stripe := billingSite(t)
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	janaID := jana.me().ID

	first := jana.startPaying(h.ID, "year")
	expired := stripe.Subscriptions()[0]
	stripe.Expire(expired)
	s.told(stripe, "customer.subscription.updated", expired)
	if state, _, _ := jana.entitlement(h.ID); state != "trialing" {
		t.Fatalf("a subscription that expired unpaid made the household %s", state)
	}
	if n := s.count("SELECT count(*) FROM billing_subscriptions WHERE household_id = $1 AND standing = 'ended' AND started_at IS NULL", h.ID); n != 1 {
		t.Fatalf("%d subscriptions over without having been the household's, want 1", n)
	}

	p := stripe.Processor()
	customer, err := p.CreateCustomer(t.Context(), billing.NewCustomer{User: janaID, Email: s.a("jana@example"), Name: "Jana"})
	if err != nil {
		t.Fatal(err)
	}
	unrecorded := func() (string, string) {
		t.Helper()
		sub, confirmation, err := p.Subscribe(t.Context(), billing.NewSubscription{
			Customer: customer, Price: billingtest.Prices()[billing.Fallback].Year.ID, Household: h.ID, Payer: janaID, Monthly: true,
		})
		if err != nil || confirmation == nil {
			t.Fatalf("a subscription made at Stripe alone: %+v, %v", confirmation, err)
		}
		return sub.ID, confirmation.ClientSecret
	}
	lost, secret := unrecorded()
	s.told(stripe, "customer.subscription.created", lost)
	if again := jana.startPaying(h.ID, "year"); again.ClientSecret != secret || again.ClientSecret == first.ClientSecret {
		t.Fatalf("asked again: %q, want the unrecorded one's %q", again.ClientSecret, secret)
	}
	second, _ := unrecorded()
	s.told(stripe, "customer.subscription.created", second)
	if status, _, _ := stripe.Subscription(second); status != "canceled" {
		t.Fatalf("a second unrecorded subscription is %s, want cancelled", status)
	}
	if status, _, _ := stripe.Subscription(lost); status != "incomplete" {
		t.Fatalf("the one taken up is %s, want waiting still", status)
	}

	subscription, _ := stripe.ConfirmPayment(secret)
	s.told(stripe, "customer.subscription.updated", subscription)
	if sub := jana.subscription(h.ID); sub.State != "active" || sub.Interval == nil || *sub.Interval != "year" || sub.Payer.UserID != janaID {
		t.Fatalf("after the one taken up was paid: %+v", sub)
	}
}

// usage sets household h's daily samples of the month day falls in, bytes for each day from its
// first, and what it stores now.
func (s *site) usage(h uuid.UUID, month time.Time, current int64, bytes ...int64) {
	s.t.Helper()
	from, _ := storage.Month(month)
	for i, b := range bytes {
		day := from.AddDate(0, 0, i)
		if _, err := s.admin.Exec(s.t.Context(), `
			INSERT INTO usage_samples (household_id, sampled_on, sampled_at, stored_bytes, derived_bytes, object_count)
			VALUES ($1, $2::date, $2::timestamptz, $3, 0, 1)`, h, day, b); err != nil {
			s.t.Fatal(err)
		}
	}
	if current > 0 {
		if _, err := s.admin.Exec(s.t.Context(), `
			INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size, sha256, variants)
			VALUES ($1, 'documents', $2, 'original', 'application/pdf', $3, decode(repeat('ab', 32), 'hex'), 'ready')`,
			h, uuid.New(), current); err != nil {
			s.t.Fatal(err)
		}
	}
}

func repeat(bytes int64, days int) []int64 {
	out := make([]int64, days)
	for i := range out {
		out[i] = bytes
	}
	return out
}

// A month's storage is billed once it has ended, from the mean of its daily samples (D-31, D-128):
// an average of 18 GB is 2 blocks, one line on the subscription, once however many nights find it;
// a household that averaged within its allowance, one still on trial and one that subscribed after
// the month ended are billed nothing. The line then rides the renewal's invoice beside the base fee.
func TestAMonthOfStorageIsBilledOnce(t *testing.T) {
	s, stripe := billingSite(t)
	jana := s.person("Jana", s.a("jana@example"))
	now := s.clock.now()
	this, _ := storage.Month(now)
	last := this.AddDate(0, -1, 0)
	days := int(this.Sub(last) / (24 * time.Hour))
	began := last.AddDate(0, 0, 10)

	heavy, light, late, trial := jana.create("Heavy"), jana.create("Light"), jana.create("Late"), jana.create("Trial")
	subscription, _ := s.paid(stripe, jana, heavy.ID, "month")
	s.paid(stripe, jana, light.ID, "year")
	s.paid(stripe, jana, late.ID, "year")
	for _, h := range []uuid.UUID{heavy.ID, light.ID} {
		if _, err := s.admin.Exec(t.Context(), "UPDATE billing_subscriptions SET started_at = $2 WHERE household_id = $1", h, began); err != nil {
			t.Fatal(err)
		}
	}
	s.usage(heavy.ID, last, 0, repeat(18*storage.GB, days)...)
	s.usage(light.ID, last, 0, repeat(4*storage.GB, days)...)
	s.usage(late.ID, last, 0, repeat(40*storage.GB, days)...)
	s.usage(trial.ID, last, 0, repeat(40*storage.GB, days)...)

	for night := range 2 {
		billed, err := s.billing.BillStorage(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		if want := 1 - night; billed != want {
			t.Fatalf("night %d billed %d lines, want %d", night+1, billed, want)
		}
	}
	items := stripe.Items()
	if len(items) != 1 {
		t.Fatalf("%d invoice items, want 1: %v", len(items), items)
	}
	meta, _ := items[0]["metadata"].(map[string]any)
	if items[0]["subscription"] != subscription || items[0]["quantity"] != int64(2) || meta["kind"] != billing.LineStorage ||
		meta["household_id"] != heavy.ID.String() || meta["month"] != last.Format("2006-01-02") ||
		!strings.Contains(fmt.Sprint(items[0]["description"]), last.Format("2006-01")) {
		t.Fatalf("the invoice item: %v", items[0])
	}
	var blocks, sampled int
	var average int64
	if err := s.admin.QueryRow(t.Context(), `
		SELECT blocks, sampled_days, average_bytes FROM billing_storage_months WHERE household_id = $1 AND month = $2`,
		heavy.ID, last).Scan(&blocks, &sampled, &average); err != nil || blocks != 2 || sampled != days || average != 18*storage.GB {
		t.Fatalf("the month's row: %d blocks over %d days at %d (%v)", blocks, sampled, average, err)
	}
	if n := s.count("SELECT count(*) FROM billing_storage_months WHERE household_id = $1 AND blocks = 0 AND stripe_invoice_item_id IS NULL", light.ID); n != 1 {
		t.Fatal("the month within the allowance was not recorded as billed nothing")
	}
	if n := s.count("SELECT count(*) FROM billing_storage_months WHERE household_id IN ($1, $2)", late.ID, trial.ID); n != 0 {
		t.Fatal("a month was billed to a household that was not subscribed in it")
	}

	// The renewal: the base fee and the storage blocks, as lines of their own.
	invoice := stripe.EndPeriod(subscription)
	s.told(stripe, "invoice.paid", invoice)
	var page struct {
		Items []invoiceDoc `json:"items"`
	}
	rec := jana.get(billingPath(heavy.ID, "/invoices?limit=1"))
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &page)
	if len(page.Items) != 1 || page.Items[0].Total != (moneyDoc{AmountMinor: 799, Currency: "EUR"}) || len(page.Items[0].Lines) != 2 {
		t.Fatalf("the renewal's invoice: %+v", page.Items)
	}
	lines := page.Items[0].Lines
	if lines[0].Kind != billing.LineBase || lines[1].Kind != billing.LineStorage || lines[1].Quantity == nil || *lines[1].Quantity != "2" ||
		lines[1].Amount != (moneyDoc{AmountMinor: 200, Currency: "EUR"}) {
		t.Fatalf("the invoice's lines: %+v", lines)
	}
}

// The storage screen's figures are the invoice's arithmetic (FR-BI4): the month-to-date average, the
// projection, the blocks each needs and the projected charge, with the blocks in effect on the
// household's entitlement and its storage picture.
func TestTheUsageIsShownBeforeItIsBilled(t *testing.T) {
	s, _ := billingSite(t)
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	now := s.clock.now()
	from, to := storage.Month(now)
	sampled := now.UTC().Day()
	s.usage(h.ID, now, 30*storage.GB, repeat(18*storage.GB, sampled)...)

	var usage struct {
		PeriodFrom       string   `json:"period_from"`
		PeriodTo         string   `json:"period_to"`
		Current          int64    `json:"current_bytes"`
		Average          int64    `json:"mtd_average_bytes"`
		Projected        int64    `json:"projected_average_bytes"`
		Included         int64    `json:"included_bytes"`
		Base             int64    `json:"included_bytes_base"`
		BlocksNow        int      `json:"blocks_now"`
		BlocksProjected  int      `json:"blocks_projected"`
		Charge           moneyDoc `json:"projected_charge"`
		ToNextBlock      int64    `json:"bytes_to_next_block"`
		ToDropABlock     *int64   `json:"bytes_to_drop_a_block"`
		UploadBlocked    bool     `json:"upload_blocked"`
		HardCeilingBytes int64    `json:"hard_ceiling_bytes"`
	}
	rec := jana.get(billingPath(h.ID, "/usage"))
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &usage)
	days := int(to.Sub(from) / (24 * time.Hour))
	projected := (int64(sampled)*18*storage.GB + int64(days-sampled)*30*storage.GB) / int64(days)
	blocks := storage.Default.Blocks(projected)
	if usage.PeriodFrom != from.Format("2006-01-02") || usage.PeriodTo != to.AddDate(0, 0, -1).Format("2006-01-02") ||
		usage.Current != 30*storage.GB || usage.Average != 18*storage.GB || usage.Projected != projected ||
		usage.BlocksNow != 2 || usage.BlocksProjected != blocks || usage.Charge != (moneyDoc{AmountMinor: int64(blocks) * 100, Currency: "EUR"}) ||
		usage.Included != 25*storage.GB || usage.Base != 5*storage.GB || usage.ToNextBlock != 7*storage.GB ||
		usage.ToDropABlock == nil || *usage.ToDropABlock != 3*storage.GB || usage.UploadBlocked || usage.HardCeilingBytes != 205*storage.GB {
		t.Fatalf("the usage: %+v, want projected %d, %d blocks", usage, projected, blocks)
	}
	if state, blocks, included := jana.entitlement(h.ID); state != "trialing" || blocks != 2 || included != 25*storage.GB {
		t.Fatalf("the entitlement's storage: %d blocks, %d included", blocks, included)
	}
	if report := jana.storage(h.ID); report.IncludedBytes != 25*storage.GB {
		t.Fatalf("the storage picture's allowance: %d", report.IncludedBytes)
	}
}

// The support actions billing gives item 21's staff: a trial extended, on trial or after it lapsed
// unpaid, a credit to the payer's balance at the processor, and an invoice emailed again.
func TestTheSupportActions(t *testing.T) {
	s, stripe := billingSite(t)
	address := s.a("jana@example")
	jana := s.person("Jana", address)
	h := jana.create("Tilcerovi")
	ctx := t.Context()
	until := s.clock.now().Add(45 * 24 * time.Hour)

	if err := s.billing.ExtendTrial(ctx, h.ID, s.clock.now()); err == nil {
		t.Fatal("a trial was extended to now")
	}
	if err := s.billing.ExtendTrial(ctx, h.ID, until); err != nil {
		t.Fatal(err)
	}
	// A trial that ended unpaid, read-only since, is back on trial.
	if _, err := s.admin.Exec(ctx, `UPDATE households SET billing_state = 'read_only', lapsed_at = now(), retained_until = now() + interval '395 days',
		retention_warnings = 1 WHERE id = $1`, h.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.billing.ExtendTrial(ctx, h.ID, until); err != nil {
		t.Fatal(err)
	}
	if n := s.count(`SELECT count(*) FROM households WHERE id = $1 AND billing_state = 'trialing' AND trial_ends_at = $2
		AND lapsed_at IS NULL AND retained_until IS NULL AND retention_warnings = 0`, h.ID, until); n != 1 {
		t.Fatal("the lapsed trial was not put back on trial")
	}
	if err := s.billing.Credit(ctx, h.ID, money.Money{AmountMinor: 500, Currency: "EUR"}, "an apology"); !errors.Is(err, billing.ErrNoSubscription) {
		t.Fatalf("a credit with no subscription: %v", err)
	}

	// Subscribed, it has no trial to extend, and its payer can be credited in the currency it pays in.
	s.paid(stripe, jana, h.ID, "year")
	if err := s.billing.ExtendTrial(ctx, h.ID, until); !errors.Is(err, billing.ErrNoTrial) {
		t.Fatalf("a trial extended for a subscribed household: %v", err)
	}
	if err := s.billing.Credit(ctx, h.ID, money.Money{AmountMinor: 500, Currency: "CZK"}, ""); !errors.Is(err, billing.ErrCurrency) {
		t.Fatalf("a credit in another currency: %v", err)
	}
	if err := s.billing.Credit(ctx, h.ID, money.Money{AmountMinor: 500, Currency: "EUR"}, "an apology"); err != nil {
		t.Fatal(err)
	}
	if credits := stripe.Credits(); len(credits) != 1 || credits[0].Get("amount") != "-500" || credits[0].Get("currency") != "eur" {
		t.Fatalf("the credits at Stripe: %v", credits)
	}
	var invoice uuid.UUID
	if err := s.admin.QueryRow(ctx, "SELECT id FROM billing_invoices WHERE household_id = $1", h.ID).Scan(&invoice); err != nil {
		t.Fatal(err)
	}
	if err := s.billing.ResendInvoice(ctx, h.ID, invoice); err != nil {
		t.Fatal(err)
	}
	if n := has(s.subjects(address), "invoice"); n != 2 {
		t.Fatalf("%d invoice emails, want the first and the one sent again", n)
	}
	if err := s.billing.ResendInvoice(ctx, h.ID, uuid.New()); !errors.Is(err, billing.ErrNoInvoice) {
		t.Fatalf("an invoice nobody has, sent again: %v", err)
	}
}

// The owners are told where the household's storage stands against its allowance as the nightly
// sample finds it (FR-BI3): once as it crosses 80 %, once as it uses the whole of it, where the next
// block will be added, and again against the allowance a block brings. In the app, never by email,
// and nobody but the owners (FR-BI5).
func TestTheOwnersAreToldAsStorageNearsItsAllowance(t *testing.T) {
	s, _ := billingSite(t)
	// From the fifth of a month, so that the nights below are one month's, whose average they move.
	_, next := storage.Month(s.clock.now())
	s.clock.advance(next.AddDate(0, 0, 4).Sub(s.clock.now()))
	jana := s.person("Jana", s.a("jana@example"))
	h := jana.create("Tilcerovi")
	s.joined(jana, h.ID, "Petr", s.a("petr@example"), "member", nil)
	janaID := jana.me().ID
	d := testsupport.Open(t)
	registry, err := module.NewRegistry()
	if err != nil {
		t.Fatal(err)
	}
	sampler := &storage.Sampler{
		Meter: d.Pool(t, db.RoleMeter), Pool: d.Pool(t, db.RoleApp), Modules: registry,
		Log: logging.New(io.Discard, slog.LevelDebug), Now: s.clock.now, Notify: s.notifier,
	}
	file := uuid.New()
	// night stores bytes in the household, moves to the next day, takes its sample, and returns the
	// notices the household's members have been sent so far.
	night := func(bytes int64) []string {
		t.Helper()
		if _, err := s.admin.Exec(t.Context(), `
			INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size, sha256, variants)
			VALUES ($1, 'documents', $2, 'original', 'application/pdf', $3, decode(repeat('ab', 32), 'hex'), 'ready')
			ON CONFLICT (household_id, module, entity_id, variant) DO UPDATE SET byte_size = excluded.byte_size`, h.ID, file, bytes); err != nil {
			t.Fatal(err)
		}
		s.clock.advance(24 * time.Hour)
		if _, err := sampler.Sample(t.Context()); err != nil {
			t.Fatal(err)
		}
		rows, err := s.admin.Query(t.Context(), `
			SELECT message || ' ' || (args->>'included_gb') || ' ' || (args->>'last') FROM notifications
			WHERE household_id = $1 AND message LIKE 'notification.storage%' AND user_id = $2 ORDER BY created_at, id`, h.ID, janaID)
		if err != nil {
			t.Fatal(err)
		}
		notices, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatal(err)
		}
		return notices
	}
	want := []string{}
	check := func(what string, got []string) {
		t.Helper()
		if !slices.Equal(got, want) {
			t.Fatalf("%s: the notices are %v, want %v", what, got, want)
		}
	}
	check("3 GB of 5", night(3*storage.GB))
	want = append(want, "notification.storage_nearing 5 no")
	check("4.5 GB of 5", night(4500*storage.GB/1000))
	check("still 4.5 GB", night(4500*storage.GB/1000))
	want = append(want, "notification.storage_reached 5 no")
	check("6 GB of 5", night(6*storage.GB))
	// At 14 GB the month's average is past 5 GB: a block is in effect, and 14 GB is over 80 % of the
	// 15 GB it brings.
	want = append(want, "notification.storage_nearing 15 no")
	check("14 GB of 15", night(14*storage.GB))
	check("still 14 GB", night(14*storage.GB))
	if n := s.count("SELECT count(*) FROM notifications WHERE household_id = $1 AND message LIKE 'notification.storage%' AND (user_id <> $2 OR email)", h.ID, janaID); n != 0 {
		t.Fatalf("%d notices went to someone who is no owner, or by email", n)
	}
}
