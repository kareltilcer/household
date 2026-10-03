package billing_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/billing"
	"github.com/kareltilcer/household/server/internal/platform/billing/billingtest"
)

// MockURLVar names Stripe's own mock server (stripe/stripe-mock), which answers every call with a
// fixture once it has validated the request against Stripe's OpenAPI description: a parameter Stripe
// does not take is refused there as Stripe refuses it. The test below runs only when it is set, as
// CI's stripe job sets it.
const MockURLVar = "HOUSEHOLD_TEST_STRIPE_URL"

// Every request the Stripe processor sends is one Stripe's API takes: each call is made against
// Stripe's mock server, which validates its parameters, and its answer is read without a failure.
// billingtest's stand-in proves what the server makes of the answers; this proves the stand-in is
// asked what Stripe would accept.
func TestStripeTakesWhatTheProcessorSends(t *testing.T) {
	url := os.Getenv(MockURLVar)
	if url == "" {
		t.Skipf("%s names no stripe-mock server", MockURLVar)
	}
	none := int64(0)
	p, err := billing.NewStripe(billing.StripeConfig{
		SecretKey: billingtest.SecretKey, WebhookSecret: billingtest.WebhookSecret, URL: url, MaxNetworkRetries: &none,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx := t.Context()
	household, user := uuid.New(), uuid.New()
	now := time.Now()

	customer, err := p.CreateCustomer(ctx, billing.NewCustomer{
		User: user, Email: "jana@example.test", Name: "Jana", Locale: "cs", Country: "CZ", IdempotencyID: "customer:" + user.String(),
	})
	if err != nil || customer == "" {
		t.Fatalf("CreateCustomer: %q, %v", customer, err)
	}
	for name, n := range map[string]billing.NewSubscription{
		"unpaid, for the client to confirm": {
			Customer: customer, Price: "price_base", Household: household, Payer: user, Monthly: true, AutomaticTax: true,
		},
		"charged with a method set up": {
			Customer: customer, Price: "price_base", Household: household, Payer: user, PaymentMethod: "pm_card_visa",
			IdempotencyID: "takeover:" + uuid.NewString(),
		},
		"waiting out a period another paid for": {
			Customer: customer, Price: "price_base", Household: household, Payer: user, PaymentMethod: "pm_card_visa",
			TrialEnd: now.Add(30 * 24 * time.Hour), Monthly: true,
		},
	} {
		sub, _, err := p.Subscribe(ctx, n)
		if err != nil || sub.ID == "" {
			t.Fatalf("Subscribe, %s: %+v, %v", name, sub, err)
		}
	}
	sub, err := p.Subscription(ctx, "sub_mock")
	if err != nil || sub.ID == "" || sub.Status == "" {
		t.Fatalf("Subscription: %+v, %v", sub, err)
	}
	if _, err := p.Confirmation(ctx, "sub_mock"); err != nil {
		t.Fatalf("Confirmation: %v", err)
	}
	for _, cancel := range []bool{true, false} {
		if _, err := p.CancelAtPeriodEnd(ctx, "sub_mock", cancel); err != nil {
			t.Fatalf("CancelAtPeriodEnd(%v): %v", cancel, err)
		}
	}
	for _, monthly := range []bool{true, false} {
		if _, err := p.ChangePrice(ctx, "sub_mock", "price_other", monthly); err != nil {
			t.Fatalf("ChangePrice(monthly %v): %v", monthly, err)
		}
	}
	if _, err := p.SetPaymentMethod(ctx, "sub_mock", "pm_card_visa"); err != nil {
		t.Fatalf("SetPaymentMethod: %v", err)
	}
	if err := p.Cancel(ctx, "sub_mock"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	confirmation, err := p.Setup(ctx, billing.NewSetup{
		Customer: customer, Household: household, User: user, Purpose: billing.PurposeTakeover, Subscription: "sub_mock",
	})
	if err != nil || confirmation == nil || confirmation.ClientSecret == "" || confirmation.Intent != billing.IntentSetup {
		t.Fatalf("Setup: %+v, %v", confirmation, err)
	}
	if intent, err := p.SetupIntent(ctx, "seti_mock"); err != nil || intent.ID == "" {
		t.Fatalf("SetupIntent: %+v, %v", intent, err)
	}
	invoice, err := p.Invoice(ctx, "in_mock")
	if err != nil || invoice.ID == "" || invoice.Currency == "" || invoice.IssuedAt.IsZero() {
		t.Fatalf("Invoice: %+v, %v", invoice, err)
	}
	if _, err := p.InvoicePDF(ctx, "in_mock"); err != nil {
		t.Fatalf("InvoicePDF: %v", err)
	}
	if err := p.Pay(ctx, "in_mock"); err != nil && errors.Is(err, billing.ErrUnavailable) {
		t.Fatalf("Pay: %v", err)
	}
	month := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	line, err := p.StorageLine(context.WithoutCancel(ctx), billing.StorageLine{
		Customer: customer, Subscription: "sub_mock", Price: "price_block", Blocks: 2, Household: household,
		Month: month.Format("2006-01-02"), From: month, To: month.AddDate(0, 1, 0), Description: "Extra storage",
	})
	if err != nil || line == "" {
		t.Fatalf("StorageLine: %q, %v", line, err)
	}
	if err := p.Credit(ctx, billing.NewCredit{Customer: customer, AmountMinor: 500, Currency: "EUR", Note: "An apology"}); err != nil {
		t.Fatalf("Credit: %v", err)
	}
}

// Cancel voids the invoice the cancellation left open, and no other: whether ending a subscription
// never paid voids its first invoice with it is Stripe's to decide, and an invoice it has voided is
// not voided again, which Stripe would refuse.
func TestCancelVoidsWhatTheCancellationLeftOpen(t *testing.T) {
	for name, tc := range map[string]struct {
		// after is the latest invoice's status once the subscription is cancelled; it was open before.
		after string
		voids int32
	}{
		"an invoice the cancellation voided":    {"void", 0},
		"an invoice the cancellation left open": {"open", 1},
	} {
		t.Run(name, func(t *testing.T) {
			var cancels, voids atomic.Int32
			answer := func(w http.ResponseWriter, body string) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, body)
			}
			subscription := func(status, invoice string) string {
				return `{"id":"sub_1","object":"subscription","status":"` + status +
					`","latest_invoice":{"id":"in_1","object":"invoice","status":"` + invoice + `"}}`
			}
			mux := http.NewServeMux()
			mux.HandleFunc("GET /v1/subscriptions/sub_1", func(w http.ResponseWriter, _ *http.Request) {
				answer(w, subscription("incomplete", "open"))
			})
			mux.HandleFunc("DELETE /v1/subscriptions/sub_1", func(w http.ResponseWriter, r *http.Request) {
				cancels.Add(1)
				if got := r.URL.Query()["expand[0]"]; len(got) != 1 || got[0] != "latest_invoice" {
					t.Errorf("the cancellation expands %v, want its latest invoice", got)
				}
				answer(w, subscription("incomplete_expired", tc.after))
			})
			mux.HandleFunc("POST /v1/invoices/in_1/void", func(w http.ResponseWriter, _ *http.Request) {
				voids.Add(1)
				if tc.after != "open" {
					w.WriteHeader(http.StatusBadRequest)
					answer(w, `{"error":{"type":"invalid_request_error","message":"This invoice is not open."}}`)
					return
				}
				answer(w, `{"id":"in_1","object":"invoice","status":"void"}`)
			})
			server := httptest.NewServer(mux)
			defer server.Close()
			none := int64(0)
			p, err := billing.NewStripe(billing.StripeConfig{
				SecretKey: billingtest.SecretKey, WebhookSecret: billingtest.WebhookSecret, URL: server.URL,
				HTTPClient: server.Client(), MaxNetworkRetries: &none,
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := p.Cancel(t.Context(), "sub_1"); err != nil {
				t.Fatalf("Cancel: %v", err)
			}
			if cancels.Load() != 1 || voids.Load() != tc.voids {
				t.Fatalf("%d cancellations and %d voids, want 1 and %d", cancels.Load(), voids.Load(), tc.voids)
			}
		})
	}
}

// A Stripe that does not answer is given up on once the processor's timeout has passed, as a failure
// of Stripe's own that may be asked again: billing asks Stripe inside a transaction, under the
// household's lock, and must not hold either for the 80 seconds the SDK's own client waits.
func TestARequestToStripeIsBounded(t *testing.T) {
	stop := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-stop:
		case <-r.Context().Done():
		}
	}))
	defer server.Close()
	defer close(stop)
	none := int64(0)
	p, err := billing.NewStripe(billing.StripeConfig{
		SecretKey: billingtest.SecretKey, WebhookSecret: billingtest.WebhookSecret, URL: server.URL,
		Timeout: 50 * time.Millisecond, MaxNetworkRetries: &none,
	})
	if err != nil {
		t.Fatal(err)
	}
	began := time.Now()
	if _, err := p.Subscription(t.Context(), "sub_1"); !errors.Is(err, billing.ErrUnavailable) {
		t.Fatalf("a Stripe that does not answer: %v, want it unavailable", err)
	}
	if waited := time.Since(began); waited > billing.DefaultTimeout/2 {
		t.Fatalf("waited %s for a Stripe given 50ms", waited)
	}
	if billing.DefaultTimeout <= 0 || billing.DefaultTimeout > 30*time.Second {
		t.Fatalf("a request with no timeout of its own waits %s", billing.DefaultTimeout)
	}
}

// A webhook's event is read from its payload once its signature verifies, whatever API version it
// was rendered at; the household is its object's metadata's, or its parent subscription's.
func TestAnEventIsReadOnceItsSignatureVerifies(t *testing.T) {
	p, err := billing.NewStripe(billing.StripeConfig{SecretKey: billingtest.SecretKey, WebhookSecret: billingtest.WebhookSecret})
	if err != nil {
		t.Fatal(err)
	}
	household := uuid.New()
	for name, tc := range map[string]struct {
		payload string
		want    billing.Event
	}{
		"a subscription's": {
			`{"id":"evt_1","object":"event","api_version":"2020-08-27","type":"customer.subscription.updated",
			  "data":{"object":{"id":"sub_1","object":"subscription","metadata":{"household_id":"` + household.String() + `"}}}}`,
			billing.Event{ID: "evt_1", Type: "customer.subscription.updated", Object: "sub_1", Household: household},
		},
		"an invoice's, whose subscription names the household": {
			`{"id":"evt_2","object":"event","type":"invoice.paid","data":{"object":{"id":"in_1","object":"invoice","metadata":{},
			  "parent":{"type":"subscription_details","subscription_details":{"subscription":"sub_1","metadata":{"household_id":"` + household.String() + `"}}}}}}`,
			billing.Event{ID: "evt_2", Type: "invoice.paid", Object: "in_1", Household: household},
		},
		"one about nothing of a household's": {
			`{"id":"evt_3","object":"event","type":"charge.succeeded","data":{"object":{"id":"ch_1","object":"charge","metadata":{"household_id":"none"}}}}`,
			billing.Event{ID: "evt_3", Type: "charge.succeeded", Object: "ch_1"},
		},
	} {
		got, err := p.Event([]byte(tc.payload), billingtest.Sign([]byte(tc.payload), billingtest.WebhookSecret, time.Now()))
		if err != nil || got != tc.want {
			t.Errorf("%s: %+v, %v; want %+v", name, got, err, tc.want)
		}
		for why, signature := range map[string]string{
			"no signature":   "",
			"another secret": billingtest.Sign([]byte(tc.payload), "whsec_another", time.Now()),
			"an old one":     billingtest.Sign([]byte(tc.payload), billingtest.WebhookSecret, time.Now().Add(-6*time.Minute)),
			"another body":   billingtest.Sign([]byte(tc.payload+" "), billingtest.WebhookSecret, time.Now()),
		} {
			if _, err := p.Event([]byte(tc.payload), signature); !errors.Is(err, billing.ErrSignature) {
				t.Errorf("%s, %s: %v, want a refusal", name, why, err)
			}
		}
	}
	if _, err := billing.NewStripe(billing.StripeConfig{SecretKey: billingtest.SecretKey}); err == nil {
		t.Error("a processor was made with no webhook secret")
	}
}
