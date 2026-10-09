package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/billing"
	"github.com/kareltilcer/household/server/internal/platform/billing/billingtest"
	"github.com/kareltilcer/household/server/internal/platform/logging"
)

// What drives the stand-in, beside Stripe's API: JSON in, JSON out, with no key asked for, since it
// is on the loopback and holds nothing real, and no CORS headers, since the suite calls it from
// Node and never from a page.
//
//	GET  /_standin/health
//	    200 {"status": "ok"}, once it serves.
//
//	POST /_standin/confirm    {"client_secret": "…", "with": "card" | "declined_card" | "debit"}
//	    What a customer does in the payment form, with the secret the API handed their client, a
//	    payment's or a setup's alike; with is card when it is left out. The answer is what Stripe.js
//	    resolves confirmPayment or confirmSetup with, and intent says which of the two the secret was
//	    for:
//	    200 {"intent": "payment", "status": "succeeded"}    a card that was taken
//	    200 {"intent": "payment", "status": "processing"}   a bank debit, which is then on its way
//	    200 {"intent": "setup", "status": "succeeded"}      a payment method set up, a card's or a debit's
//	    200 {"error": {"type": "card_error", "code": "card_declined", "message": "…"}}
//	        a declined card: nothing changed, and the secret may be confirmed again
//	    200 {"error": {"type": "invalid_request_error", "code": "payment_intent_unexpected_state", "message": "…"}}
//	        a secret confirmed already, or whose subscription is over; setup_intent_unexpected_state for a setup's
//	    404 a secret the stand-in never answered
//
//	POST /_standin/households/{household_id}/fail-payment    {"again": true | false}
//	    Stripe fails to collect the renewal of the household's subscription, which is then past due;
//	    asked again of one past due, a retry fails. again, true when the body is left out, says whether
//	    Stripe will try once more.
//	POST /_standin/households/{household_id}/give-up
//	    Stripe ends the subscription that is past due, its last retry having failed.
//	POST /_standin/households/{household_id}/end-period
//	    The period ends of each subscription the household is paid up by: one set to cancel ends, as
//	    its customer asked, and any other renews, its invoice paid.
//	POST /_standin/households/{household_id}/clear-debit
//	POST /_standin/households/{household_id}/fail-debit
//	    The bank debit on its way for the household's subscription clears, or fails.
//	    Each answers what the stand-in then holds of the household, as the read below does:
//	    200 {"household_id": "…", "subscriptions": […]}
//	    404 a household the stand-in holds no subscription of
//	    409 a household none of whose subscriptions is in the state the act is about
//
//	GET  /_standin/households/{household_id}
//	    200 {"household_id": "…", "subscriptions": [{"id", "status", "cancel_at_period_end", "interval",
//	         "currency", "current_period_end", "payer_id", "payment_method", "latest_invoice": {"id",
//	         "status", "attempts"}}]}, in the order they were made, none for a household it knows nothing of.
//
// A request the stand-in refuses itself is answered {"error": {"code": "…", "message": "…"}}: 400
// bad_request, 404 unknown_secret or unknown_household, 409 not_applicable, and 502 webhook_failed
// when the API did not take an event, by when the act has happened at the stand-in all the same.
//
// An act is answered once the API has been told of it: the stand-in posts the events Stripe sends
// of what the act changed to the API's webhook, in the order Stripe sends them, waits for each to
// be taken, and then does the same for whatever the API changed at the stand-in on hearing them,
// an invoice it collected with a new payment method or a subscription it ended, until nothing more
// changes. So the household's row is settled by the time the answer arrives, and what is read next
// is true. Events are sent of an act and of what follows from it, and of nothing else: what the
// API asks of Stripe on its own, making a subscription or setting one to cancel, it records from
// Stripe's answer, and Stripe's events of those it is never sent.

// prefix is where what drives the stand-in is answered. Stripe's API is all under /v1.
const prefix = "/_standin"

// deliverWithin bounds one delivery of an event: the API asks the stand-in back while it handles
// one, each request of its own bounded by billing.DefaultTimeout.
const deliverWithin = 60 * time.Second

// redeliveries are how long the stand-in waits before it sends an event again that the API failed
// to take, a 5xx or no answer at all, each time it does: three more times, where Stripe goes on for
// three days.
var redeliveries = []time.Duration{200 * time.Millisecond, time.Second, 3 * time.Second}

// rounds is how many times over the API may change something at the stand-in on hearing of a change
// before the stand-in stops telling it of what it changed. A take-over is two: the new payer's
// subscription made and the old one ended, and nothing on hearing of those.
const rounds = 8

// control is what drives a stand-in.
type control struct {
	stripe     *billingtest.Stripe
	webhookURL string
	client     *http.Client
	log        *slog.Logger
	now        func() time.Time
	pauses     []time.Duration

	// acting has one act happen at a time, its deliveries with it: the events of one are then the
	// events of nothing else, and the modes an act puts the stand-in in for its own length are no
	// other act's.
	acting sync.Mutex
}

// routes has the stand-in answer what drives it.
func (c *control) routes() {
	c.stripe.Handle("GET "+prefix+"/health", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		answer(w, http.StatusOK, map[string]string{"status": "ok"})
	}))
	c.stripe.Handle("POST "+prefix+"/confirm", c.acted(c.confirm))
	c.stripe.Handle("GET "+prefix+"/households/{household_id}", http.HandlerFunc(c.read))
	for name, a := range map[string]func(*http.Request) (act, *refusal){
		"fail-payment": c.failPayment, "give-up": c.giveUp, "end-period": c.endPeriod,
		"clear-debit": c.clearDebit, "fail-debit": c.failDebit,
	} {
		c.stripe.Handle("POST "+prefix+"/households/{household_id}/"+name, c.acted(a))
	}
}

// refusal is the stand-in refusing what it was asked itself, as opposed to answering as Stripe
// would.
type refusal struct {
	status        int
	code, message string
}

func refused(status int, code, format string, args ...any) *refusal {
	return &refusal{status: status, code: code, message: fmt.Sprintf(format, args...)}
}

func answer(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func refuse(w http.ResponseWriter, r *refusal) {
	answer(w, r.status, map[string]any{"error": map[string]string{"code": r.code, "message": r.message}})
}

// decode reads r's body, a JSON object with no member into does not have, into into. A body left
// out is an object with nothing in it, where optional says it may be.
func decode(r *http.Request, into any, optional bool) *refusal {
	body, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, 1<<16))
	if err != nil {
		return refused(http.StatusBadRequest, "bad_request", "the body could not be read")
	}
	if len(bytes.TrimSpace(body)) == 0 && optional {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil || dec.More() {
		return refused(http.StatusBadRequest, "bad_request", "the body is not the JSON object this takes")
	}
	return nil
}

// act is one thing a customer or Stripe does at the stand-in.
type act struct {
	// household is whose it is: the events it is told of are those about it.
	household string
	// do does it, and answer is what its caller is told, once the API has heard of it.
	do     func()
	answer func() any
}

// acted answers a request with the act it asks for (a), done and delivered: the events Stripe sends
// of it, and of whatever the API changed at the stand-in on hearing them.
func (c *control) acted(a func(*http.Request) (act, *refusal)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.acting.Lock()
		defer c.acting.Unlock()
		// The stand-in asked for what it cannot do (process.Fatalf): the act checks what it is about
		// before it does it, so this is a request the API made in between, or a mistake here.
		defer func() {
			v := recover()
			if v == nil {
				return
			}
			message, ok := v.(unable)
			if !ok {
				panic(v)
			}
			refuse(w, refused(http.StatusInternalServerError, "internal", "%s", string(message)))
		}()
		// Delivered whether or not whoever asked is still waiting: the act has happened by then, and an
		// API that never heard of it would hold a household the stand-in no longer agrees with.
		ctx := context.WithoutCancel(r.Context())
		it, no := a(r)
		if no != nil {
			refuse(w, no)
			return
		}
		// What the API asked of Stripe before now is not this act's to tell it of.
		c.stripe.Changes(it.household)
		it.do()
		if err := c.deliver(ctx, it.household); err != nil {
			c.log.LogAttrs(ctx, slog.LevelError, "the API was not told of what changed at the stand-in",
				slog.String(logging.KeyHouseholdID, it.household), slog.Any("error", err))
			refuse(w, refused(http.StatusBadGateway, "webhook_failed", "%v", err))
			return
		}
		answer(w, http.StatusOK, it.answer())
	})
}

// deliver tells the API of everything that has changed at the stand-in for household and that it
// has not been told of, and then of what it changed on hearing that, until nothing changes.
func (c *control) deliver(ctx context.Context, household string) error {
	for range rounds {
		changes := c.stripe.Changes(household)
		if len(changes) == 0 {
			return nil
		}
		for _, change := range changes {
			if err := c.send(ctx, change); err != nil {
				return err
			}
		}
	}
	return errors.New("the API went on changing what the stand-in holds each time it heard of a change")
}

// send posts Stripe's event of change to the API's webhook, signed as Stripe signs it, and waits
// for the 204 that takes it. One the API fails, with a 5xx or no answer, is sent again, as Stripe
// delivers again, signed afresh; one it refuses is not.
func (c *control) send(ctx context.Context, change billingtest.Change) error {
	payload, _ := c.stripe.Event(change.Kind, change.Object, c.now())
	for attempt := 0; ; attempt++ {
		status, err := c.post(ctx, payload)
		switch {
		case err == nil && status == http.StatusNoContent:
			c.log.LogAttrs(ctx, slog.LevelInfo, "the API took an event", slog.String("kind", change.Kind), slog.Int("attempts", attempt+1))
			return nil
		case err == nil && status < http.StatusInternalServerError:
			return fmt.Errorf("the API answered %s with %d, not the 204 that takes it", change.Kind, status)
		case err == nil:
			err = fmt.Errorf("the API answered %s with %d", change.Kind, status)
		default:
			err = fmt.Errorf("the API could not be told of %s: %w", change.Kind, err)
		}
		if attempt == len(c.pauses) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(c.pauses[attempt]):
		}
	}
}

// post posts payload to the API's webhook once, and returns the status it answered.
func (c *control) post(ctx context.Context, payload []byte) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.webhookURL, bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set(billing.SignatureHeader, billingtest.Sign(payload, billingtest.WebhookSecret, c.now()))
	resp, err := c.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode, nil
}

// How a customer pays in the payment form.
const (
	withCard         = "card"
	withDeclinedCard = "declined_card"
	withDebit        = "debit"
)

// debitLast4 is how the account a bank debit is taken from ends.
const debitLast4 = "3000"

// confirmed is what Stripe.js resolves a confirmation that went through with, and which of the
// two it was: the status of the payment or of the setup.
type confirmed struct {
	Intent string `json:"intent"`
	Status string `json:"status"`
}

// stripeError is what Stripe.js resolves a confirmation that did not go through with: it resolves,
// and does not throw.
func stripeError(kind, code, message string) map[string]any {
	return map[string]any{"error": map[string]string{"type": kind, "code": code, "message": message}}
}

// confirm is the customer confirming, in the payment form, what the secret they were handed names.
func (c *control) confirm(r *http.Request) (act, *refusal) {
	var req struct {
		ClientSecret string `json:"client_secret"`
		With         string `json:"with"`
	}
	if no := decode(r, &req, false); no != nil {
		return act{}, no
	}
	switch req.With {
	case "":
		req.With = withCard
	case withCard, withDeclinedCard, withDebit:
	default:
		return act{}, refused(http.StatusBadRequest, "bad_request", "with is %q; want %s, %s or %s", req.With, withCard, withDeclinedCard, withDebit)
	}
	intent, ok := c.stripe.Intent(req.ClientSecret)
	if !ok {
		return act{}, refused(http.StatusNotFound, "unknown_secret", "the stand-in answered no such client secret")
	}
	var out any
	return act{household: intent.Household, answer: func() any { return out }, do: func() {
		switch {
		case !intent.Waits:
			out = stripeError("invalid_request_error", intent.Kind+"_intent_unexpected_state",
				"This "+intent.Kind+" was confirmed already, or is no longer waited for.")
		case req.With == withDeclinedCard:
			out = stripeError("card_error", "card_declined", "Your card was declined.")
		case intent.Kind == billing.IntentSetup:
			if req.With == withDebit {
				c.stripe.DebitFrom(debitLast4)
				defer c.stripe.DebitFrom("")
			}
			c.stripe.ConfirmSetup(req.ClientSecret)
			out = confirmed{Intent: intent.Kind, Status: "succeeded"}
		case req.With == withDebit:
			c.stripe.ConfirmDebit(req.ClientSecret)
			out = confirmed{Intent: intent.Kind, Status: "processing"}
		default:
			c.stripe.ConfirmPayment(req.ClientSecret)
			out = confirmed{Intent: intent.Kind, Status: "succeeded"}
		}
	}}, nil
}

// The statuses of Stripe's that the acts tell subscriptions and invoices apart by.
const (
	subActive   = "active"
	subTrialing = "trialing"
	subPastDue  = "past_due"
	invoiceOpen = "open"
	invoicePaid = "paid"
)

// paidUp reports whether h is a subscription its household is paid up by: active with its invoice
// paid, or waiting out a period another paid for.
func paidUp(h billingtest.Holding) bool {
	return h.Status == subTrialing || (h.Status == subActive && h.InvoiceStatus == invoicePaid)
}

// debited reports whether h is a subscription whose payment, a bank debit, is on its way: active,
// as Stripe has it from the moment the debit is asked for, over an invoice open still.
func debited(h billingtest.Holding) bool {
	return h.Status == subActive && h.InvoiceStatus == invoiceOpen
}

// pastDue reports whether h is a subscription Stripe is retrying a payment of.
func pastDue(h billingtest.Holding) bool { return h.Status == subPastDue }

// held reads the household r names and what the stand-in holds of it, which is something.
func (c *control) held(r *http.Request) (string, []billingtest.Holding, *refusal) {
	id, err := uuid.Parse(r.PathValue("household_id"))
	if err != nil {
		return "", nil, refused(http.StatusBadRequest, "bad_request", "the household's id is not a UUID")
	}
	holds := c.stripe.Holds(id.String())
	if len(holds) == 0 {
		return "", nil, refused(http.StatusNotFound, "unknown_household", "the stand-in holds no subscription of that household's")
	}
	return id.String(), holds, nil
}

// every are the subscriptions among holds that are as is says, and last the one of them made last.
func every(holds []billingtest.Holding, is func(billingtest.Holding) bool) []billingtest.Holding {
	var out []billingtest.Holding
	for _, h := range holds {
		if is(h) {
			out = append(out, h)
		}
	}
	return out
}

func last(holds []billingtest.Holding, is func(billingtest.Holding) bool) []billingtest.Holding {
	if all := every(holds, is); len(all) > 0 {
		return all[len(all)-1:]
	}
	return nil
}

// about is an act on those of the subscriptions of the household r names that pick picks: it is
// refused, saying none, where it picks none, and answers what the stand-in then holds of the
// household.
func (c *control) about(r *http.Request, pick func([]billingtest.Holding) []billingtest.Holding, none string,
	do func(billingtest.Holding),
) (act, *refusal) {
	household, holds, no := c.held(r)
	if no != nil {
		return act{}, no
	}
	on := pick(holds)
	if len(on) == 0 {
		return act{}, refused(http.StatusConflict, "not_applicable", "%s", none)
	}
	return act{household: household, answer: func() any { return c.holding(household) }, do: func() {
		for _, h := range on {
			do(h)
		}
	}}, nil
}

// failPayment is Stripe failing to collect the renewal of the household's subscription, or, of one
// past due already, a retry of it.
func (c *control) failPayment(r *http.Request) (act, *refusal) {
	var req struct {
		Again *bool `json:"again"`
	}
	if no := decode(r, &req, true); no != nil {
		return act{}, no
	}
	again := req.Again == nil || *req.Again
	// The one Stripe is retrying, where it is retrying one, and the one paid up otherwise: never one
	// whose first payment, a bank debit, is on its way still, which clears or fails.
	pick := func(holds []billingtest.Holding) []billingtest.Holding {
		if retried := last(holds, pastDue); len(retried) > 0 {
			return retried
		}
		return last(holds, func(h billingtest.Holding) bool { return h.Status == subActive && h.InvoiceStatus == invoicePaid })
	}
	return c.about(r, pick, "no subscription of the household's is paid up or past due, for a payment of it to fail",
		func(h billingtest.Holding) { c.stripe.FailPayment(h.ID, again) })
}

// giveUp is Stripe ending the household's subscription after its last retry failed.
func (c *control) giveUp(r *http.Request) (act, *refusal) {
	return c.about(r, func(holds []billingtest.Holding) []billingtest.Holding { return last(holds, pastDue) },
		"no subscription of the household's is past due, for Stripe to give up on: fail a payment first",
		func(h billingtest.Holding) { c.stripe.GiveUp(h.ID) })
}

// endPeriod is the period ending of every subscription the household is paid up by: its own, and
// beside it the one a take-over made, which waits for that period's end.
func (c *control) endPeriod(r *http.Request) (act, *refusal) {
	return c.about(r, func(holds []billingtest.Holding) []billingtest.Holding { return every(holds, paidUp) },
		"no subscription of the household's is paid up, for its period to end",
		func(h billingtest.Holding) { c.stripe.EndPeriod(h.ID) })
}

// clearDebit is the bank debit on its way for the household's subscription going through.
func (c *control) clearDebit(r *http.Request) (act, *refusal) {
	return c.about(r, func(holds []billingtest.Holding) []billingtest.Holding { return last(holds, debited) },
		"no bank debit is on its way for a subscription of the household's",
		func(h billingtest.Holding) { c.stripe.ClearDebit(h.Invoice) })
}

// failDebit is the bank debit on its way for the household's subscription failing.
func (c *control) failDebit(r *http.Request) (act, *refusal) {
	return c.about(r, func(holds []billingtest.Holding) []billingtest.Holding { return last(holds, debited) },
		"no bank debit is on its way for a subscription of the household's",
		func(h billingtest.Holding) { c.stripe.FailDebit(h.Invoice) })
}

// read answers what the stand-in holds of the household r names, for a spec to assert on.
func (c *control) read(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("household_id"))
	if err != nil {
		refuse(w, refused(http.StatusBadRequest, "bad_request", "the household's id is not a UUID"))
		return
	}
	answer(w, http.StatusOK, c.holding(id.String()))
}

// holdingDoc is what the stand-in holds of a household, as it answers it.
type holdingDoc struct {
	HouseholdID   string            `json:"household_id"`
	Subscriptions []subscriptionDoc `json:"subscriptions"`
}

// subscriptionDoc is a subscription as the stand-in holds it: Stripe's own words for its status and
// its invoice's, its interval and its payment method's type, and the currency as the API writes one.
type subscriptionDoc struct {
	ID                string      `json:"id"`
	Status            string      `json:"status"`
	CancelAtPeriodEnd bool        `json:"cancel_at_period_end"`
	Interval          string      `json:"interval"`
	Currency          string      `json:"currency"`
	CurrentPeriodEnd  time.Time   `json:"current_period_end"`
	PayerID           string      `json:"payer_id"`
	PaymentMethod     *string     `json:"payment_method"`
	LatestInvoice     *invoiceDoc `json:"latest_invoice"`
}

// invoiceDoc is a subscription's latest invoice: its status, and how many times Stripe has tried to
// collect it.
type invoiceDoc struct {
	ID       string `json:"id"`
	Status   string `json:"status"`
	Attempts int    `json:"attempts"`
}

// holding is what the stand-in holds of household now.
func (c *control) holding(household string) holdingDoc {
	doc := holdingDoc{HouseholdID: household, Subscriptions: []subscriptionDoc{}}
	for _, h := range c.stripe.Holds(household) {
		sub := subscriptionDoc{
			ID: h.ID, Status: h.Status, CancelAtPeriodEnd: h.CancelAtPeriodEnd, Interval: h.Interval,
			Currency: strings.ToUpper(h.Currency), CurrentPeriodEnd: h.PeriodEnd, PayerID: h.Payer,
		}
		if h.PaymentMethod != "" {
			sub.PaymentMethod = &h.PaymentMethod
		}
		if h.Invoice != "" {
			sub.LatestInvoice = &invoiceDoc{ID: h.Invoice, Status: h.InvoiceStatus, Attempts: h.Attempts}
		}
		doc.Subscriptions = append(doc.Subscriptions, sub)
	}
	return doc
}
