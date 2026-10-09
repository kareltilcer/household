// Package billingtest stands in for Stripe in tests: an HTTP server that answers the calls billing's
// Stripe processor makes as Stripe's API does, in test mode, from the objects in testdata, and signs
// the webhooks a test delivers as Stripe signs its own. The server's code runs against it unchanged,
// stripe-go included, so what a test proves is the requests billing really sends and what it really
// makes of the answers. What a customer and Stripe do on their own, confirming a payment, a renewal
// failing, a period ending, a test does through the methods here.
//
// The objects are shaped as the API version stripe-go is pinned to renders them. They were written
// from that version's types, not captured from a Stripe account.
//
// It stands in for Stripe for the web's end-to-end suite too, as a process the suite starts
// (cmd/stripe-standin), which is why it asks no more of whoever runs it than TB: served on a listener
// of the process's own (Serve), at an address a development server is told (URL), with what drives
// it answered beside Stripe's API (Handle). Nobody posts a webhook for a process, so the stand-in
// keeps the events Stripe would send of everything that changes in it (Changes), for the process to
// deliver.
package billingtest

import (
	"embed"
	"encoding/json"
	"fmt"
	"maps"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/stripe/stripe-go/v87"
	"github.com/stripe/stripe-go/v87/webhook"

	"github.com/kareltilcer/household/server/internal/platform/billing"
)

//go:embed testdata/*.json
var fixtures embed.FS

// The keys of the stand-in's account: test-mode keys in form, as a staging deployment's are, and
// too short to be anyone's.
//
//nolint:gosec // G101: the stand-in's own, which open nothing.
const (
	SecretKey      = "sk_test_standin"
	PublishableKey = "pk_test_standin"
	WebhookSecret  = "whsec_standin"
)

// object is one of Stripe's objects, as its JSON.
type object = map[string]any

// Request is a request the server made of Stripe.
type Request struct {
	Method, Path   string
	Form           url.Values
	IdempotencyKey string
}

// TB is what the stand-in asks of whoever runs it, the part of testing.TB it uses: a test, whose
// *testing.T it is, or a process, which has none. Errorf is told what the server asked that Stripe
// would not have taken, and Fatalf what was asked of the stand-in that it cannot do, which does not
// return: a test ends there, and a process ends the request that asked. Cleanup is given what stops
// the stand-in.
type TB interface {
	Helper()
	Errorf(format string, args ...any)
	Fatalf(format string, args ...any)
	Cleanup(func())
}

// Stripe is the stand-in.
type Stripe struct {
	t   TB
	mux *http.ServeMux
	// url is where the stand-in answers, and client what a processor asks it with, the default when
	// nil.
	url    string
	client *http.Client
	now    func() time.Time

	// account marks every id the stand-in mints as its own: the tests of a package share one
	// database, where two stand-ins' first customers would otherwise be one.
	account string

	mu            sync.Mutex
	n             int
	subscriptions map[string]object
	invoices      map[string]object
	lines         map[string][]object
	setups        map[string]object
	methods       map[string]object
	items         []object
	credits       []url.Values
	keyed         map[string]string
	// deleted are the customers the server deleted (Deleted).
	deleted       map[string]bool
	requests      []Request
	down, decline bool
	// covered has a customer's credit pay the first invoice of every subscription made unpaid from now
	// on (Covered).
	covered bool
	// iban is the last four characters of the account every payment method made from now on debits,
	// "" for a card.
	iban string
	// payAfter is, by subscription, how many more of the server's reads of it pass before its
	// customer's payment goes through (PayAfter).
	payAfter map[string]int
	// changes are, by household, the events Stripe would send of what changed and nobody has asked
	// for yet (Changes).
	changes map[string][]Change
}

// New starts a stand-in that reads the time from now, and stops it when t ends.
func New(t TB, now func() time.Time) *Stripe {
	t.Helper()
	s := unserved(t, now)
	server := httptest.NewServer(s.mux)
	t.Cleanup(server.Close)
	s.url, s.client = server.URL, server.Client()
	return s
}

// Serve starts a stand-in on ln, a listener of the caller's own, that reads the time from now, and
// stops it, closing ln, when t ends: the stand-in as a process serves it, at an address chosen for
// it (cmd/stripe-standin). drive, when not nil, is given the stand-in before it answers anything, to
// have it answer what drives it too (Handle).
func Serve(t TB, ln net.Listener, now func() time.Time, drive func(*Stripe)) *Stripe {
	t.Helper()
	s := unserved(t, now)
	s.url = "http://" + ln.Addr().String()
	if drive != nil {
		drive(s)
	}
	server := &http.Server{Handler: s.mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = server.Serve(ln) }()
	t.Cleanup(func() { _ = server.Close() })
	return s
}

// URL is where the stand-in answers: what billing.StripeConfig's URL is given.
func (s *Stripe) URL() string { return s.url }

// Handle has the stand-in answer pattern with handler, beside Stripe's API: what drives a stand-in
// that runs as a process, at paths Stripe's API has nothing at.
func (s *Stripe) Handle(pattern string, handler http.Handler) { s.mux.Handle(pattern, handler) }

// unserved is a stand-in that reads the time from now, which nothing serves yet.
func unserved(t TB, now func() time.Time) *Stripe {
	s := &Stripe{
		t: t, now: now, account: strings.ReplaceAll(uuid.NewString(), "-", "")[:12], subscriptions: map[string]object{}, invoices: map[string]object{}, lines: map[string][]object{},
		setups: map[string]object{}, methods: map[string]object{}, keyed: map[string]string{}, payAfter: map[string]int{},
		deleted: map[string]bool{}, changes: map[string][]Change{},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/customers", s.handle(s.createCustomer))
	mux.HandleFunc("DELETE /v1/customers/{id}", s.handle(s.deleteCustomer))
	mux.HandleFunc("POST /v1/customers/{id}/balance_transactions", s.handle(s.credit))
	mux.HandleFunc("POST /v1/subscriptions", s.handle(s.createSubscription))
	mux.HandleFunc("GET /v1/subscriptions/{id}", s.handle(s.getSubscription))
	mux.HandleFunc("POST /v1/subscriptions/{id}", s.handle(s.updateSubscription))
	mux.HandleFunc("DELETE /v1/subscriptions/{id}", s.handle(s.cancelSubscription))
	mux.HandleFunc("POST /v1/setup_intents", s.handle(s.createSetup))
	mux.HandleFunc("GET /v1/setup_intents/{id}", s.handle(s.getSetup))
	mux.HandleFunc("GET /v1/invoices/{id}", s.handle(s.getInvoice))
	mux.HandleFunc("GET /v1/invoices/{id}/lines", s.handle(s.getLines))
	mux.HandleFunc("POST /v1/invoices/{id}/pay", s.handle(s.payInvoice))
	mux.HandleFunc("POST /v1/invoices/{id}/void", s.handle(s.voidInvoice))
	mux.HandleFunc("GET /v1/invoiceitems", s.handle(s.listItems))
	mux.HandleFunc("POST /v1/invoiceitems", s.handle(s.createItem))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("billingtest: the server asked Stripe for %s %s, which the stand-in does not answer", r.Method, r.URL.Path)
		fail(w, http.StatusNotFound, "invalid_request_error", "", "no such route")
	})
	s.mux = mux
	return s
}

// Prices are the plans of the stand-in's account: PRD 04 §1's figures, each with a price of its.
func Prices() billing.Prices {
	prices := billing.DefaultPrices()
	for currency, plan := range prices {
		plan.Year.ID, plan.Month.ID, plan.Block.ID = priceID(currency, billing.Year), priceID(currency, billing.Month), priceID(currency, "block")
		prices[currency] = plan
	}
	return prices
}

func priceID(currency, name string) string { return "price_" + strings.ToLower(currency) + "_" + name }

// Processor is billing's Stripe processor, asking the stand-in.
func (s *Stripe) Processor() billing.Processor {
	s.t.Helper()
	none := int64(0)
	p, err := billing.NewStripe(billing.StripeConfig{
		SecretKey: SecretKey, WebhookSecret: WebhookSecret, URL: s.url, HTTPClient: s.client, MaxNetworkRetries: &none,
	})
	if err != nil {
		s.t.Fatalf("billingtest: %v", err)
	}
	return p
}

// handle answers a request with what fn makes of it: Stripe's own failure while the stand-in is
// down, and otherwise fn's object, or its error.
func (s *Stripe) handle(fn func(r *http.Request, form url.Values) (any, *apiError)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			fail(w, http.StatusBadRequest, "invalid_request_error", "", err.Error())
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		s.requests = append(s.requests, Request{Method: r.Method, Path: r.URL.Path, Form: r.Form, IdempotencyKey: r.Header.Get("Idempotency-Key")})
		if got := r.Header.Get("Stripe-Version"); got != stripe.APIVersion {
			s.t.Errorf("billingtest: the request is sent at API version %q, want %s", got, stripe.APIVersion)
		}
		if s.down {
			fail(w, http.StatusInternalServerError, "api_error", "", "the stand-in is down")
			return
		}
		out, apiErr := fn(r, r.Form)
		if apiErr != nil {
			fail(w, apiErr.status, apiErr.kind, apiErr.code, apiErr.message)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
}

type apiError struct {
	status              int
	kind, code, message string
}

func notFound(what, id string) *apiError {
	return &apiError{http.StatusNotFound, "invalid_request_error", "resource_missing", "No such " + what + ": " + id}
}

func fail(w http.ResponseWriter, status int, kind, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(object{"error": object{"type": kind, "code": code, "message": message}})
}

// fixture is testdata's object name, decoded afresh.
func (s *Stripe) fixture(name string) object {
	raw, err := fixtures.ReadFile("testdata/" + name + ".json")
	if err != nil {
		s.t.Fatalf("billingtest: %v", err)
	}
	var out object
	if err := json.Unmarshal(raw, &out); err != nil {
		s.t.Fatalf("billingtest: %v", err)
	}
	return out
}

// Change is an event Stripe sends of something that changed in its account: its type, and the id of
// the subscription, the invoice or the setup it is about, which Event makes its payload from.
type Change struct{ Kind, Object string }

// told keeps the event of kind that Stripe sends about obj, for the household obj is for (Changes).
// One that is for none is nobody's to be told of.
func (s *Stripe) told(kind string, obj object) {
	h := householdOf(obj)
	if h == "" {
		return
	}
	id, _ := obj["id"].(string)
	s.changes[h] = append(s.changes[h], Change{Kind: kind, Object: id})
}

// householdOf is the household obj is for, as the server's metadata names it: a subscription's own
// or a setup's, and for an invoice its subscription's. "" when it names none.
func householdOf(obj object) string {
	if m, ok := obj["metadata"].(object); ok {
		if h, _ := m["household_id"].(string); h != "" {
			return h
		}
	}
	parent, _ := obj["parent"].(object)
	details, _ := parent["subscription_details"].(object)
	m, _ := details["metadata"].(object)
	h, _ := m["household_id"].(string)
	return h
}

// Changes are the events Stripe sends about household's subscriptions, invoices and setups for what
// has changed at the stand-in since they were last asked for, whoever changed it, a customer, Stripe
// on its own or the server through the API, in the order Stripe sends them; asked for, they are
// forgotten. A test delivers the events it means to itself (Event) and never asks.
func (s *Stripe) Changes(household string) []Change {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.changes[household]
	delete(s.changes, household)
	return out
}

// id is the next id with prefix.
func (s *Stripe) id(prefix string) string {
	s.n++
	return fmt.Sprintf("%s_%s_%d", prefix, s.account, s.n)
}

// once answers the id a request under r's Idempotency-Key made before, as Stripe replays a keyed
// request, or records the one made now.
func (s *Stripe) once(r *http.Request, made func() string) string {
	key := r.Header.Get("Idempotency-Key")
	if id, ok := s.keyed[key]; ok && key != "" {
		return id
	}
	id := made()
	if key != "" {
		s.keyed[key] = id
	}
	return id
}

// metadata is form's metadata[…] members.
func metadata(form url.Values) object {
	out := object{}
	for key, values := range form {
		if name, ok := strings.CutPrefix(key, "metadata["); ok && len(values) > 0 {
			out[strings.TrimSuffix(name, "]")] = values[0]
		}
	}
	return out
}

func (s *Stripe) createCustomer(r *http.Request, form url.Values) (any, *apiError) {
	id := s.once(r, func() string { return s.id("cus") })
	return object{"id": id, "object": "customer", "email": form.Get("email"), "name": form.Get("name"), "metadata": metadata(form)}, nil
}

// deleteCustomer deletes the customer, as Stripe does: every subscription it still has is cancelled
// with it, and one deleted already is not found.
func (s *Stripe) deleteCustomer(r *http.Request, _ url.Values) (any, *apiError) {
	id := r.PathValue("id")
	if s.deleted[id] {
		return nil, notFound("customer", id)
	}
	s.deleted[id] = true
	for _, sub := range s.subscriptions {
		if sub["customer"] == id && sub["status"] != "canceled" && sub["status"] != "incomplete_expired" {
			sub["status"] = "canceled"
			s.told("customer.subscription.deleted", sub)
		}
	}
	return object{"id": id, "object": "customer", "deleted": true}, nil
}

// credit credits the customer's balance. A keyed request sent again is the credit it made, as Stripe
// replays it, and no second one.
func (s *Stripe) credit(r *http.Request, form url.Values) (any, *apiError) {
	form.Set("customer", r.PathValue("id"))
	id := s.once(r, func() string {
		s.credits = append(s.credits, form)
		return s.id("cbtxn")
	})
	amount, _ := strconv.ParseInt(form.Get("amount"), 10, 64)
	return object{"id": id, "object": "customer_balance_transaction", "amount": amount, "currency": form.Get("currency")}, nil
}

// price is what one of the account's prices charges: its currency, its interval, "" for a block's,
// and its amount.
func price(id string) (currency, interval string, amount int64, ok bool) {
	for code, plan := range Prices() {
		for name, p := range map[string]billing.Price{billing.Year: plan.Year, billing.Month: plan.Month, "": plan.Block} {
			if p.ID == id {
				return strings.ToLower(code), name, p.AmountMinor, true
			}
		}
	}
	return "", "", 0, false
}

// item is sub's one item.
func item(sub object) object {
	return sub["items"].(object)["data"].([]any)[0].(object) //nolint:forcetypeassert // The fixture's shape.
}

// setPrice puts sub on the price id, for a period that begins at from.
func setPrice(sub object, id string, from time.Time) *apiError {
	currency, interval, amount, ok := price(id)
	if !ok || interval == "" {
		return &apiError{http.StatusBadRequest, "invalid_request_error", "resource_missing", "No such price: " + id}
	}
	to := from.AddDate(0, 1, 0)
	if interval == billing.Year {
		to = from.AddDate(1, 0, 0)
	}
	it := item(sub)
	it["current_period_start"], it["current_period_end"] = from.Unix(), to.Unix()
	it["price"] = object{
		"id": id, "object": "price", "active": true, "currency": currency, "type": "recurring", "unit_amount": amount,
		"recurring": object{"interval": interval, "interval_count": 1},
	}
	sub["currency"] = currency
	return nil
}

// invoice makes an invoice of sub for amount, with one line for its base fee over its period.
func (s *Stripe) invoice(sub object, amount int64, status string) object {
	it := item(sub)
	inv := s.fixture("invoice")
	id := s.id("in")
	now := s.now().Unix()
	inv["id"], inv["number"], inv["status"] = id, "HH-"+strconv.Itoa(s.n), status
	inv["customer"], inv["currency"], inv["total"], inv["amount_due"] = sub["customer"], sub["currency"], amount, amount
	inv["created"], inv["period_start"], inv["period_end"] = now, now, now
	inv["invoice_pdf"] = "https://pay.stripe.test/invoice/" + id + "/pdf"
	inv["status_transitions"].(object)["finalized_at"] = now           //nolint:forcetypeassert // The fixture's shape.
	details := inv["parent"].(object)["subscription_details"].(object) //nolint:forcetypeassert // The fixture's shape.
	details["subscription"], details["metadata"] = sub["id"], sub["metadata"]
	s.invoices[id] = inv
	if amount != 0 {
		line := s.fixture("line")
		line["id"], line["invoice"], line["amount"], line["currency"] = s.id("il"), id, amount, sub["currency"]
		line["period"] = object{"start": it["current_period_start"], "end": it["current_period_end"]}
		line["parent"].(object)["subscription_item_details"].(object)["subscription"] = sub["id"] //nolint:forcetypeassert // The fixture's shape.
		s.lines[id] = []object{line}
	}
	sub["latest_invoice"] = id
	s.told("invoice.finalized", inv)
	if status == "paid" {
		s.told("invoice.paid", inv)
	}
	return inv
}

func (s *Stripe) createSubscription(r *http.Request, form url.Values) (any, *apiError) {
	var failed *apiError
	id := s.once(r, func() string {
		sub := s.fixture("subscription")
		id := s.id("sub")
		now := s.now()
		sub["id"], sub["customer"], sub["metadata"] = id, form.Get("customer"), metadata(form)
		item(sub)["id"], item(sub)["subscription"] = s.id("si"), id
		if failed = setPrice(sub, form.Get("items[0][price]"), now); failed != nil {
			return ""
		}
		if interval := form.Get("pending_invoice_item_interval[interval]"); interval != "" {
			sub["pending_invoice_item_interval"] = object{"interval": interval, "interval_count": 1}
		}
		amount := item(sub)["price"].(object)["unit_amount"].(int64) //nolint:forcetypeassert // setPrice's.
		s.subscriptions[id] = sub
		s.told("customer.subscription.created", sub)
		method := form.Get("default_payment_method")
		switch {
		case method == "":
			// default_incomplete: the client confirms its first payment.
			if form.Get("payment_behavior") != "default_incomplete" {
				s.t.Errorf("billingtest: a subscription with no payment method is made %q", form.Get("payment_behavior"))
			}
			if s.covered {
				// Its first invoice needs no payment: Stripe makes it active at once, the invoice paid from the
				// customer's balance, with no payment to confirm and no payment method.
				sub["status"] = "active"
				s.invoice(sub, amount, "paid")["amount_due"] = int64(0)
				break
			}
			inv := s.invoice(sub, amount, "open")
			inv["confirmation_secret"] = object{"client_secret": inv["id"].(string) + "_secret", "type": "payment_intent"} //nolint:forcetypeassert // An id.
		case form.Get("trial_end") != "":
			end, _ := strconv.ParseInt(form.Get("trial_end"), 10, 64)
			sub["status"], sub["trial_end"], sub["default_payment_method"] = "trialing", end, s.method(method)
			item(sub)["current_period_end"] = end
			s.invoice(sub, 0, "paid")
		case s.decline:
			sub["default_payment_method"] = s.method(method)
			s.invoice(sub, amount, "open")["attempt_count"] = 1
		case s.method(method)["type"] == "sepa_debit":
			// A bank debit takes days: the subscription is active at once, its invoice open until the debit
			// clears (ClearDebit) or fails (FailDebit).
			sub["status"], sub["default_payment_method"] = "active", s.method(method)
			s.invoice(sub, amount, "open")["attempt_count"] = 1
		default:
			sub["status"], sub["default_payment_method"] = "active", s.method(method)
			s.invoice(sub, amount, "paid")["attempt_count"] = 1
		}
		return id
	})
	if failed != nil {
		return nil, failed
	}
	return s.render(s.subscriptions[id], form), nil
}

// method is the payment method id, which the stand-in keeps: a card, or a SEPA Direct Debit while
// DebitFrom names an account.
func (s *Stripe) method(id string) object {
	if m, ok := s.methods[id]; ok {
		return m
	}
	m := s.fixture("payment_method")
	m["id"] = id
	if s.iban != "" {
		delete(m, "card")
		m["type"] = "sepa_debit"
		m["sepa_debit"] = object{"bank_code": "08810", "branch_code": "", "country": "LI", "fingerprint": "fp_" + id, "last4": s.iban}
	}
	s.methods[id] = m
	return m
}

// render is sub as Stripe answers the request whose form is form: with its latest invoice and its
// payment method as objects where the request asks for them expanded, and as their ids otherwise.
func (s *Stripe) render(sub object, form url.Values) object {
	out := object{}
	for k, v := range sub {
		out[k] = v
	}
	if id, ok := sub["latest_invoice"].(string); ok && (expands(form, "latest_invoice") || expands(form, "latest_invoice.confirmation_secret")) {
		out["latest_invoice"] = s.invoices[id]
	}
	if method, ok := sub["default_payment_method"].(object); ok && !expands(form, "default_payment_method") {
		out["default_payment_method"] = method["id"]
	}
	return out
}

// expands reports whether form asks for field expanded.
func expands(form url.Values, field string) bool {
	for key, values := range form {
		if strings.HasPrefix(key, "expand[") && slices.Contains(values, field) {
			return true
		}
	}
	return false
}

func (s *Stripe) getSubscription(r *http.Request, _ url.Values) (any, *apiError) {
	id := r.PathValue("id")
	sub, ok := s.subscriptions[id]
	if !ok {
		return nil, notFound("subscription", id)
	}
	if left, waits := s.payAfter[id]; waits {
		if left > 0 {
			s.payAfter[id] = left - 1
		} else {
			delete(s.payAfter, id)
			s.confirm(sub)
		}
	}
	return s.render(sub, r.Form), nil
}

func (s *Stripe) updateSubscription(r *http.Request, form url.Values) (any, *apiError) {
	sub, ok := s.subscriptions[r.PathValue("id")]
	if !ok {
		return nil, notFound("subscription", r.PathValue("id"))
	}
	if v := form.Get("cancel_at_period_end"); v != "" {
		// Stripe says why from the day the cancellation is asked for, and no longer once it is taken back.
		sub["cancel_at_period_end"] = v == "true"
		sub["cancellation_details"] = object{"comment": nil, "feedback": nil, "reason": nil}
		if v == "true" {
			sub["cancellation_details"] = object{"comment": nil, "feedback": nil, "reason": "cancellation_requested"}
		}
	}
	if v := form.Get("default_payment_method"); v != "" {
		sub["default_payment_method"] = s.method(v)
	}
	if v := form.Get("items[0][price]"); v != "" {
		if form.Get("items[0][id]") != item(sub)["id"] {
			return nil, &apiError{http.StatusBadRequest, "invalid_request_error", "", "the item is not the subscription's"}
		}
		if err := setPrice(sub, v, s.now()); err != nil {
			return nil, err
		}
	}
	if v, ok := form["pending_invoice_item_interval[interval]"]; ok {
		sub["pending_invoice_item_interval"] = object{"interval": v[0], "interval_count": 1}
	} else if v, ok := form["pending_invoice_item_interval"]; ok && v[0] == "" {
		sub["pending_invoice_item_interval"] = nil
	}
	s.told("customer.subscription.updated", sub)
	return s.render(sub, form), nil
}

func (s *Stripe) cancelSubscription(r *http.Request, _ url.Values) (any, *apiError) {
	sub, ok := s.subscriptions[r.PathValue("id")]
	if !ok {
		return nil, notFound("subscription", r.PathValue("id"))
	}
	sub["status"] = "canceled"
	sub["cancellation_details"] = object{"reason": "cancellation_requested"}
	s.told("customer.subscription.deleted", sub)
	return s.render(sub, r.Form), nil
}

func (s *Stripe) createSetup(_ *http.Request, form url.Values) (any, *apiError) {
	setup := s.fixture("setup_intent")
	id := s.id("seti")
	setup["id"], setup["client_secret"], setup["customer"], setup["metadata"] = id, id+"_secret", form.Get("customer"), metadata(form)
	if form.Get("usage") != "off_session" {
		s.t.Errorf("billingtest: a payment method is set up for %q, want off_session", form.Get("usage"))
	}
	s.setups[id] = setup
	return setup, nil
}

func (s *Stripe) getSetup(r *http.Request, _ url.Values) (any, *apiError) {
	setup, ok := s.setups[r.PathValue("id")]
	if !ok {
		return nil, notFound("setup_intent", r.PathValue("id"))
	}
	return setup, nil
}

func (s *Stripe) getInvoice(r *http.Request, _ url.Values) (any, *apiError) {
	inv, ok := s.invoices[r.PathValue("id")]
	if !ok {
		return nil, notFound("invoice", r.PathValue("id"))
	}
	return inv, nil
}

func (s *Stripe) getLines(r *http.Request, _ url.Values) (any, *apiError) {
	id := r.PathValue("id")
	if _, ok := s.invoices[id]; !ok {
		return nil, notFound("invoice", id)
	}
	lines := s.lines[id]
	if lines == nil {
		lines = []object{}
	}
	return object{"object": "list", "data": lines, "has_more": false, "url": "/v1/invoices/" + id + "/lines"}, nil
}

func (s *Stripe) payInvoice(r *http.Request, _ url.Values) (any, *apiError) {
	inv, ok := s.invoices[r.PathValue("id")]
	if !ok {
		return nil, notFound("invoice", r.PathValue("id"))
	}
	if s.decline {
		return nil, &apiError{http.StatusPaymentRequired, "card_error", "card_declined", "Your card was declined."}
	}
	s.paid(inv)
	return inv, nil
}

// paid marks inv paid, and its subscription active. Stripe says so of the subscription only where
// that changes it: a bank debit that clears leaves it as it was.
func (s *Stripe) paid(inv object) {
	inv["status"], inv["next_payment_attempt"] = "paid", nil
	inv["status_transitions"].(object)["paid_at"] = s.now().Unix() //nolint:forcetypeassert // The fixture's shape.
	if attempts, _ := inv["attempt_count"].(int); attempts == 0 {
		inv["attempt_count"] = 1
	}
	for _, sub := range s.subscriptions {
		if sub["latest_invoice"] == inv["id"] && sub["status"] != "canceled" {
			if sub["status"] != "active" {
				s.told("customer.subscription.updated", sub)
			}
			sub["status"] = "active"
		}
	}
	s.told("invoice.paid", inv)
}

func (s *Stripe) voidInvoice(r *http.Request, _ url.Values) (any, *apiError) {
	inv, ok := s.invoices[r.PathValue("id")]
	if !ok {
		return nil, notFound("invoice", r.PathValue("id"))
	}
	inv["status"] = "void"
	s.told("invoice.voided", inv)
	return inv, nil
}

func (s *Stripe) listItems(_ *http.Request, form url.Values) (any, *apiError) {
	since, _ := strconv.ParseInt(form.Get("created[gte]"), 10, 64)
	found := []object{}
	for _, it := range s.items {
		if it["customer"] == form.Get("customer") && it["date"].(int64) >= since { //nolint:forcetypeassert // createItem's.
			found = append(found, it)
		}
	}
	return object{"object": "list", "data": found, "has_more": false, "url": "/v1/invoiceitems"}, nil
}

func (s *Stripe) createItem(r *http.Request, form url.Values) (any, *apiError) {
	id := s.once(r, func() string {
		quantity, _ := strconv.ParseInt(form.Get("quantity"), 10, 64)
		start, _ := strconv.ParseInt(form.Get("period[start]"), 10, 64)
		end, _ := strconv.ParseInt(form.Get("period[end]"), 10, 64)
		currency, _, amount, _ := price(form.Get("pricing[price]"))
		it := object{
			"id": s.id("ii"), "object": "invoiceitem", "customer": form.Get("customer"), "subscription": form.Get("subscription"),
			"quantity": quantity, "amount": quantity * amount, "currency": currency, "description": form.Get("description"),
			"metadata": metadata(form), "period": object{"start": start, "end": end}, "date": s.now().Unix(), "invoice": nil,
			"pricing": object{"price_details": object{"price": form.Get("pricing[price]")}},
		}
		s.items = append(s.items, it)
		return it["id"].(string) //nolint:forcetypeassert // An id.
	})
	for _, it := range s.items {
		if it["id"] == id {
			return it, nil
		}
	}
	return nil, notFound("invoiceitem", id)
}

// The rest is what a customer, and Stripe on its own, do.

// subscription is the subscription id, which a test names.
func (s *Stripe) subscription(id string) object {
	s.t.Helper()
	sub, ok := s.subscriptions[id]
	if !ok {
		s.t.Fatalf("billingtest: no subscription %s", id)
	}
	return sub
}

// ConfirmPayment is the customer confirming the first payment of the subscription whose secret they
// were handed, in the payment form: its invoice is paid, with a card, and it is active. It returns
// the subscription's id and its invoice's.
func (s *Stripe) ConfirmPayment(secret string) (subscription, invoice string) {
	s.t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	subscription, invoice = s.waiting(secret)
	s.confirm(s.subscriptions[subscription])
	return subscription, invoice
}

// PayAfter is the customer confirming the first payment of the subscription whose secret they were
// handed, as ConfirmPayment is, at a moment of the server's own work: the payment goes through once
// the server has read the subscription reads more times, so that its next reading finds it paid.
func (s *Stripe) PayAfter(secret string, reads int) {
	s.t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	subscription, _ := s.waiting(secret)
	s.payAfter[subscription] = reads
}

// waiting is the subscription whose first payment is confirmed with secret, and its invoice.
func (s *Stripe) waiting(secret string) (subscription, invoice string) {
	s.t.Helper()
	for id, inv := range s.invoices {
		if c, _ := inv["confirmation_secret"].(object); c == nil || c["client_secret"] != secret {
			continue
		}
		for sid, sub := range s.subscriptions {
			if sub["latest_invoice"] == id {
				return sid, id
			}
		}
	}
	s.t.Fatalf("billingtest: no payment waits to be confirmed with %s", secret)
	return "", ""
}

// confirm is sub's first payment going through, with a payment method of the customer's: its invoice
// is paid, and it is active.
func (s *Stripe) confirm(sub object) {
	sub["default_payment_method"] = s.method(s.id("pm"))
	s.paid(s.invoices[sub["latest_invoice"].(string)]) //nolint:forcetypeassert // An id.
}

// ConfirmDebit is the customer confirming the first payment of the subscription whose secret they
// were handed with a SEPA Direct Debit, which takes days to clear: the subscription is active at
// once, as Stripe makes one paid for by a payment method that says late how it went, and its invoice
// is open still, the payment on its way, until ClearDebit or FailDebit. It returns the subscription's
// id and its invoice's.
func (s *Stripe) ConfirmDebit(secret string) (subscription, invoice string) {
	s.t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	subscription, invoice = s.waiting(secret)
	card := s.iban
	if s.iban == "" {
		s.iban = "3000"
	}
	sub := s.subscriptions[subscription]
	sub["status"], sub["default_payment_method"] = "active", s.method(s.id("pm"))
	s.iban = card
	s.invoices[invoice]["attempt_count"] = 1
	s.told("customer.subscription.updated", sub)
	return subscription, invoice
}

// ClearDebit is the bank debit the invoice id waits on going through: it is paid.
func (s *Stripe) ClearDebit(id string) {
	s.t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	inv, ok := s.invoices[id]
	if !ok || inv["status"] != "open" {
		s.t.Fatalf("billingtest: no debit is on its way for invoice %s", id)
	}
	s.paid(inv)
}

// FailDebit is the bank debit the invoice id waits on failing: Stripe voids the invoice, and leaves
// its subscription active, charging nothing until its next period.
func (s *Stripe) FailDebit(id string) {
	s.t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	inv, ok := s.invoices[id]
	if !ok || inv["status"] != "open" {
		s.t.Fatalf("billingtest: no debit is on its way for invoice %s", id)
	}
	inv["status"], inv["next_payment_attempt"] = "void", nil
	s.told("invoice.voided", inv)
}

// ConfirmSetup is the customer confirming the payment method whose setup's secret they were handed:
// the setup succeeded, with a card. It returns the setup's id.
func (s *Stripe) ConfirmSetup(secret string) string {
	s.t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, setup := range s.setups {
		if setup["client_secret"] == secret {
			method := s.method(s.id("pm"))
			setup["status"], setup["payment_method"] = "succeeded", method["id"]
			s.told("setup_intent.succeeded", setup)
			return id
		}
	}
	s.t.Fatalf("billingtest: no setup waits to be confirmed with %s", secret)
	return ""
}

// FailPayment is Stripe failing to collect the subscription id's renewal: at the first failure a new
// invoice is open and the subscription past due, and each one after is one more attempt. again says
// whether Stripe will try once more. It returns the invoice's id.
func (s *Stripe) FailPayment(id string, again bool) string {
	s.t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	sub := s.subscription(id)
	inv := s.invoices[sub["latest_invoice"].(string)] //nolint:forcetypeassert // An id.
	if inv["status"] != "open" {
		inv = s.invoice(sub, item(sub)["price"].(object)["unit_amount"].(int64), "open") //nolint:forcetypeassert // setPrice's.
		inv["billing_reason"] = "subscription_cycle"
	}
	attempts, _ := inv["attempt_count"].(int)
	inv["attempt_count"], inv["next_payment_attempt"] = attempts+1, nil
	if again {
		inv["next_payment_attempt"] = s.now().Add(24 * time.Hour).Unix()
	}
	if sub["status"] != "past_due" {
		s.told("customer.subscription.updated", sub)
	}
	sub["status"] = "past_due"
	s.told("invoice.payment_failed", inv)
	return inv["id"].(string) //nolint:forcetypeassert // An id.
}

// GiveUp is Stripe ending the subscription id after its last retry failed.
func (s *Stripe) GiveUp(id string) {
	s.t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	sub := s.subscription(id)
	sub["status"], sub["cancellation_details"] = "canceled", object{"reason": "payment_failed"}
	s.told("customer.subscription.deleted", sub)
}

// LeaveUnpaid is Stripe giving up on the subscription id as an account set to mark it unpaid does:
// it is unpaid, with no word on why it ended.
func (s *Stripe) LeaveUnpaid(id string) {
	s.t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	sub := s.subscription(id)
	sub["status"] = "unpaid"
	s.told("customer.subscription.updated", sub)
}

// WriteOff is Stripe marking the invoice id uncollectible, as an account set to write off what its
// last retry could not collect does.
func (s *Stripe) WriteOff(id string) {
	s.t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	inv, ok := s.invoices[id]
	if !ok {
		s.t.Fatalf("billingtest: no invoice %s", id)
	}
	inv["status"], inv["next_payment_attempt"] = "uncollectible", nil
	s.told("invoice.marked_uncollectible", inv)
}

// Expire is Stripe ending the subscription id, whose first payment was never confirmed.
func (s *Stripe) Expire(id string) {
	s.t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	sub := s.subscription(id)
	sub["status"] = "incomplete_expired"
	s.told("customer.subscription.updated", sub)
}

// EndPeriod is the subscription id's period ending: one set to cancel then is cancelled, as its
// customer asked; any other is renewed, its invoice paid, with the invoice items waiting on it as
// lines of their own, and one that waited out a trial is active. It returns the renewal's invoice, ""
// for one cancelled.
func (s *Stripe) EndPeriod(id string) string {
	s.t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	sub := s.subscription(id)
	if sub["cancel_at_period_end"] == true {
		sub["status"], sub["cancellation_details"] = "canceled", object{"reason": "cancellation_requested"}
		s.told("customer.subscription.deleted", sub)
		return ""
	}
	it := item(sub)
	if err := setPrice(sub, it["price"].(object)["id"].(string), s.now()); err != nil { //nolint:forcetypeassert // setPrice's.
		s.t.Fatalf("billingtest: %s", err.message)
	}
	s.told("customer.subscription.updated", sub)
	amount := it["price"].(object)["unit_amount"].(int64) //nolint:forcetypeassert // setPrice's.
	inv := s.invoice(sub, amount, "open")
	inv["billing_reason"] = "subscription_cycle"
	total := amount + s.take(inv, id)
	inv["total"], inv["amount_due"] = total, total
	sub["status"], sub["trial_end"] = "active", nil
	s.paid(inv)
	return inv["id"].(string) //nolint:forcetypeassert // An id.
}

// take puts the invoice items waiting on the subscription id on inv, as lines of their own, and
// returns what they come to.
func (s *Stripe) take(inv object, id string) int64 {
	var total int64
	for _, pending := range s.items {
		if pending["subscription"] != id || pending["invoice"] != nil {
			continue
		}
		pending["invoice"] = inv["id"]
		line := s.fixture("line")
		line["id"], line["invoice"], line["amount"], line["currency"] = s.id("il"), inv["id"], pending["amount"], pending["currency"]
		line["description"], line["quantity"], line["metadata"], line["period"] = pending["description"], pending["quantity"], pending["metadata"], pending["period"]
		line["parent"] = object{
			"type": "invoice_item_details", "subscription_item_details": nil,
			"invoice_item_details": object{"invoice_item": pending["id"], "proration": false, "subscription": id},
		}
		s.lines[inv["id"].(string)] = append(s.lines[inv["id"].(string)], line) //nolint:forcetypeassert // An id.
		total += pending["amount"].(int64)                                      //nolint:forcetypeassert // createItem's.
	}
	return total
}

// FailItems is Stripe failing to collect the invoice of the items waiting on the subscription id
// alone, as a yearly plan's month of storage is invoiced between its renewals
// (pending_invoice_item_interval): the invoice is open, with those items as its lines and no base
// fee, and the subscription past due, its period as it was. It returns the invoice's id.
func (s *Stripe) FailItems(id string) string {
	s.t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	sub := s.subscription(id)
	inv := s.invoice(sub, 0, "open")
	total := s.take(inv, id)
	if total == 0 {
		s.t.Fatalf("billingtest: no invoice item waits on subscription %s", id)
	}
	inv["billing_reason"], inv["total"], inv["amount_due"] = "automatic_pending_invoice_item_invoice", total, total
	inv["attempt_count"], inv["next_payment_attempt"] = 1, s.now().Add(24*time.Hour).Unix()
	if sub["status"] != "past_due" {
		s.told("customer.subscription.updated", sub)
	}
	sub["status"] = "past_due"
	s.told("invoice.payment_failed", inv)
	return inv["id"].(string) //nolint:forcetypeassert // An id.
}

// Down has the stand-in fail every request as Stripe's own failure, or answer again.
func (s *Stripe) Down(down bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.down = down
}

// Decline has the stand-in refuse every charge made with a payment method already set up, or take it
// again.
func (s *Stripe) Decline(decline bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.decline = decline
}

// Covered has the first invoice of every subscription made unpaid from now on need no payment, as
// one whose customer holds a credit at Stripe that covers it: Stripe makes such a subscription active
// at once, its invoice paid from the balance, with nothing for the customer to confirm. false has a
// first invoice wait to be paid again.
func (s *Stripe) Covered(covered bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.covered = covered
}

// DebitFrom has every payment method confirmed from now on be a SEPA Direct Debit from an account
// whose IBAN ends in last4, its last four characters, which are not digits in every country; "" has
// them be cards again.
func (s *Stripe) DebitFrom(last4 string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.iban = last4
}

// Subscription is what the stand-in holds of the subscription id: its status, whether it is set to
// cancel at its period's end, and its pending invoice items' interval, "" for none.
func (s *Stripe) Subscription(id string) (status string, cancelAtPeriodEnd bool, pendingInterval string) {
	s.t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	sub := s.subscription(id)
	if p, ok := sub["pending_invoice_item_interval"].(object); ok {
		pendingInterval, _ = p["interval"].(string)
	}
	status, _ = sub["status"].(string)
	cancelAtPeriodEnd, _ = sub["cancel_at_period_end"].(bool)
	return status, cancelAtPeriodEnd, pendingInterval
}

// Intent is what a client secret the stand-in answered names, for whoever confirms it without
// knowing which it was handed, as the payment form does.
type Intent struct {
	// Kind is billing.IntentPayment for a subscription's first payment, which ConfirmPayment and
	// ConfirmDebit take, and billing.IntentSetup for a payment method's setup, which ConfirmSetup takes.
	Kind string
	// Household is the household it is for.
	Household string
	// Waits reports whether it is still to be confirmed: a payment whose subscription is unpaid still,
	// and a setup that has not succeeded.
	Waits bool
}

// Intent is what secret names, and whether the stand-in answered it at all.
func (s *Stripe) Intent(secret string) (Intent, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if secret == "" {
		return Intent{}, false
	}
	for id, inv := range s.invoices {
		if c, _ := inv["confirmation_secret"].(object); c == nil || c["client_secret"] != secret {
			continue
		}
		out := Intent{Kind: billing.IntentPayment, Household: householdOf(inv)}
		for _, sub := range s.subscriptions {
			if sub["latest_invoice"] == id {
				out.Waits = sub["status"] == "incomplete" && inv["status"] == "open"
			}
		}
		return out, true
	}
	for _, setup := range s.setups {
		if setup["client_secret"] == secret {
			return Intent{Kind: billing.IntentSetup, Household: householdOf(setup), Waits: setup["status"] != "succeeded"}, true
		}
	}
	return Intent{}, false
}

// Holding is a subscription as the stand-in holds it, for whoever reads the stand-in back.
type Holding struct {
	ID, Status        string
	CancelAtPeriodEnd bool
	// Interval is what its price is billed each, year or month, and Currency what it charges in, in
	// lower case as Stripe writes it.
	Interval, Currency string
	// Payer is the member its metadata names.
	Payer string
	// PaymentMethod is the type of the method it is charged with, card or sepa_debit, "" while it has
	// none.
	PaymentMethod string
	PeriodEnd     time.Time
	// Invoice is its latest invoice, InvoiceStatus that invoice's status, and Attempts how many times
	// Stripe has tried to collect it.
	Invoice, InvoiceStatus string
	Attempts               int
}

// Holds are the subscriptions the stand-in holds for household, in the order they were made.
func (s *Stripe) Holds(household string) []Holding {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Holding
	for id, sub := range s.subscriptions {
		if household == "" || householdOf(sub) != household {
			continue
		}
		h := Holding{ID: id}
		h.Status, _ = sub["status"].(string)
		h.CancelAtPeriodEnd, _ = sub["cancel_at_period_end"].(bool)
		h.Currency, _ = sub["currency"].(string)
		if m, ok := sub["metadata"].(object); ok {
			h.Payer, _ = m["user_id"].(string)
		}
		if method, ok := sub["default_payment_method"].(object); ok {
			h.PaymentMethod, _ = method["type"].(string)
		}
		it := item(sub)
		if price, ok := it["price"].(object); ok {
			recurring, _ := price["recurring"].(object)
			h.Interval, _ = recurring["interval"].(string)
		}
		if end, ok := it["current_period_end"].(int64); ok {
			h.PeriodEnd = time.Unix(end, 0).UTC()
		}
		if h.Invoice, _ = sub["latest_invoice"].(string); h.Invoice != "" {
			inv := s.invoices[h.Invoice]
			h.InvoiceStatus, _ = inv["status"].(string)
			h.Attempts, _ = inv["attempt_count"].(int)
		}
		out = append(out, h)
	}
	slices.SortFunc(out, func(a, b Holding) int { return number(a.ID) - number(b.ID) })
	return out
}

// Deleted are the customers the server deleted, sorted.
func (s *Stripe) Deleted() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Sorted(maps.Keys(s.deleted))
}

// Subscriptions are the ids of the subscriptions made, in the order they were.
func (s *Stripe) Subscriptions() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	ids := make([]string, 0, len(s.subscriptions))
	for id := range s.subscriptions {
		ids = append(ids, id)
	}
	slices.SortFunc(ids, func(a, b string) int { return number(a) - number(b) })
	return ids
}

// number is the count an id ends in.
func number(id string) int {
	v, _ := strconv.Atoi(id[strings.LastIndex(id, "_")+1:])
	return v
}

// InvoiceStatus is the status of the invoice id.
func (s *Stripe) InvoiceStatus(id string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	status, _ := s.invoices[id]["status"].(string)
	return status
}

// Items are the invoice items made: each one's subscription, quantity, price and metadata.
func (s *Stripe) Items() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.items)
}

// Credits are the credits applied to customers' balances, as the forms that made them.
func (s *Stripe) Credits() []url.Values {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.credits)
}

// Requests are the requests the server made of Stripe, and forgets them.
func (s *Stripe) Requests() []Request {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.requests
	s.requests = nil
	return out
}

// Event is the webhook Stripe sends of kind about the object id, a subscription's, an invoice's or a
// setup's as the stand-in holds it now: its payload, and the signature of it under WebhookSecret,
// timed at at.
func (s *Stripe) Event(kind, id string, at time.Time) (payload []byte, signature string) {
	s.t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	var about any
	switch {
	case s.subscriptions[id] != nil:
		about = s.subscriptions[id]
	case s.invoices[id] != nil:
		about = s.invoices[id]
	case s.setups[id] != nil:
		about = s.setups[id]
	default:
		s.t.Fatalf("billingtest: no object %s to send an event about", id)
	}
	payload, err := json.Marshal(object{
		"id": s.id("evt"), "object": "event", "api_version": stripe.APIVersion, "created": at.Unix(), "livemode": false,
		"type": kind, "data": object{"object": about}, "pending_webhooks": 1, "request": nil,
	})
	if err != nil {
		s.t.Fatalf("billingtest: %v", err)
	}
	return payload, Sign(payload, WebhookSecret, at)
}

// Sign is the Stripe-Signature of payload under secret, timed at at.
func Sign(payload []byte, secret string, at time.Time) string {
	signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: payload, Secret: secret, Timestamp: at})
	return signed.Header
}
