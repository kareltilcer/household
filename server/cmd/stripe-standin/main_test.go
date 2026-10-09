package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/modules"
	"github.com/kareltilcer/household/server/internal/platform/billing"
	"github.com/kareltilcer/household/server/internal/platform/billing/billingtest"
	"github.com/kareltilcer/household/server/internal/platform/config"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

func TestMain(m *testing.M) { testsupport.Main(m) }

// vars is an environment of vars and nothing else.
func vars(vars map[string]string) config.Getenv {
	return func(key string) (string, bool) {
		v, ok := vars[key]
		return v, ok
	}
}

// output keeps what a process under test logs, and shows it when the test fails.
type output struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (o *output) Write(p []byte) (int, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.b.Write(p)
}

func (o *output) String() string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.b.String()
}

func logged(t *testing.T, name string) *output {
	t.Helper()
	o := &output{}
	t.Cleanup(func() {
		if said := o.String(); t.Failed() && said != "" {
			t.Logf("%s logged:\n%s", name, said)
		}
	})
	return o
}

// standIn is a stand-in served by this command, as the suite's is, and what a test asks of it.
type standIn struct {
	t   *testing.T
	url string
	// log is what it logged.
	log *output
}

// uncomplaining fails the test if the stand-in was asked anything Stripe would not have taken, which
// a test of the server's run against billingtest fails on, and a process logs (process.Errorf).
func (s *standIn) uncomplaining() {
	s.t.Helper()
	if said := s.log.String(); strings.Contains(said, complaint) {
		s.t.Errorf("the stand-in was asked what Stripe would not have taken:\n%s", said)
	}
}

// listen takes a loopback port for a stand-in, whose address is known before it serves: the API it
// stands in for is told that address, and the stand-in the API's.
func listen(t *testing.T) net.Listener {
	t.Helper()
	ln, err := (&net.ListenConfig{}).Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	return ln
}

// started serves the stand-in on ln, delivering to webhookURL, until the test ends.
func started(t *testing.T, ln net.Listener, webhookURL string) *standIn {
	t.Helper()
	said := logged(t, "the stand-in")
	log := logging.New(said, slog.LevelInfo)
	done := make(chan struct{})
	go func() {
		defer close(done)
		serve(t.Context(), ln, webhookURL, log)
	}()
	// The test's context has ended by the time what it left to clean up is.
	t.Cleanup(func() { <-done })
	return &standIn{t: t, url: "http://" + ln.Addr().String(), log: said}
}

// ask asks the stand-in what drives it, and returns the status and the JSON object it answered.
func (s *standIn) ask(method, path, body string) (int, map[string]any) {
	s.t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(s.t.Context(), method, s.url+prefix+path, reader)
	if err != nil {
		s.t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		s.t.Fatalf("%s %s answered %d with no JSON object: %v", method, path, resp.StatusCode, err)
	}
	return resp.StatusCode, out
}

// confirm confirms secret in the payment form, with a card, a declined card or a bank debit.
func (s *standIn) confirm(secret, with string) (int, map[string]any) {
	s.t.Helper()
	return s.ask(http.MethodPost, "/confirm", `{"client_secret":"`+secret+`","with":"`+with+`"}`)
}

// done is an act on household h that the stand-in took, and the subscriptions it then holds of it.
func (s *standIn) done(h uuid.UUID, act, body string) []map[string]any {
	s.t.Helper()
	status, out := s.ask(http.MethodPost, "/households/"+h.String()+"/"+act, body)
	if status != http.StatusOK {
		s.t.Fatalf("%s answered %d %v", act, status, out)
	}
	return subscriptions(s.t, out)
}

// holds are the subscriptions the stand-in holds of household h, read back.
func (s *standIn) holds(h uuid.UUID) []map[string]any {
	s.t.Helper()
	status, out := s.ask(http.MethodGet, "/households/"+h.String(), "")
	if status != http.StatusOK || out["household_id"] != h.String() {
		s.t.Fatalf("reading back what the stand-in holds answered %d %v", status, out)
	}
	return subscriptions(s.t, out)
}

// refusedWith expects the stand-in's own refusal, by its status and its code.
func refusedWith(t *testing.T, status int, out map[string]any, want int, code string) {
	t.Helper()
	failure, _ := out["error"].(map[string]any)
	if status != want || failure["code"] != code || failure["message"] == "" {
		t.Fatalf("answered %d %v; want %d %s", status, out, want, code)
	}
}

// subscriptions are the subscriptions of what the stand-in answered it holds of a household.
func subscriptions(t *testing.T, held map[string]any) []map[string]any {
	t.Helper()
	list, ok := held["subscriptions"].([]any)
	if !ok {
		t.Fatalf("what the stand-in holds: %v", held)
	}
	out := make([]map[string]any, len(list))
	for i, sub := range list {
		out[i], _ = sub.(map[string]any)
	}
	return out
}

// hook is an API's webhook, for a stand-in with no API behind it: it keeps the kinds of the events
// it was sent whose signature verifies as Stripe's, and answers as answer says, 204 when nil.
type hook struct {
	t         *testing.T
	processor *billing.Stripe

	mu     sync.Mutex
	kinds  []string
	answer func(kind string) int
}

func (h *hook) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	payload, _ := io.ReadAll(r.Body)
	event, err := h.processor.Event(payload, r.Header.Get(billing.SignatureHeader))
	if err != nil || r.Header.Get("Origin") != "" {
		h.t.Errorf("an event the API would not take as Stripe's: %v, from the origin %q", err, r.Header.Get("Origin"))
		w.WriteHeader(http.StatusUnprocessableEntity)
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.kinds = append(h.kinds, event.Type)
	status := http.StatusNoContent
	if h.answer != nil {
		status = h.answer(event.Type)
	}
	w.WriteHeader(status)
}

// sent are the kinds of the events sent since it was last asked.
func (h *hook) sent() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := h.kinds
	h.kinds = nil
	return out
}

// answering has the hook answer each event as answer says from now on, 204 when nil.
func (h *hook) answering(answer func(kind string) int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.answer = answer
}

// The stand-in serves Stripe's API over the network as billing's own processor asks it, at the
// address the processor is given (StripeConfig.URL), and delivers Stripe's events itself: each act
// is followed by the events Stripe sends of it, signed as Stripe signs them, in order, and by those
// of what the server then did at the stand-in. An event the API fails is sent again, and one it
// refuses fails the act's request.
func TestTheStandInDeliversWhatStripeSends(t *testing.T) {
	ctx := t.Context()
	ln := listen(t)
	processor, err := billing.NewStripe(billing.StripeConfig{
		SecretKey: billingtest.SecretKey, WebhookSecret: billingtest.WebhookSecret, URL: "http://" + ln.Addr().String(),
	})
	if err != nil {
		t.Fatal(err)
	}
	received := &hook{t: t, processor: processor}
	api := httptest.NewServer(received)
	t.Cleanup(api.Close)
	s := started(t, ln, api.URL+"/api/v1/webhooks/stripe")

	if status, out := s.ask(http.MethodGet, "/health", ""); status != http.StatusOK || out["status"] != "ok" {
		t.Fatalf("health: %d %v", status, out)
	}

	household, payer := uuid.New(), uuid.New()
	customer, err := processor.CreateCustomer(ctx, billing.NewCustomer{User: payer, Email: "jana@standin.test"})
	if err != nil {
		t.Fatal(err)
	}
	price := billingtest.Prices()[billing.Fallback].Month.ID
	sub, confirmation, err := processor.Subscribe(ctx, billing.NewSubscription{Customer: customer, Price: price, Household: household, Payer: payer})
	if err != nil || confirmation == nil || confirmation.Intent != billing.IntentPayment {
		t.Fatalf("subscribing through the processor: %+v, %v", confirmation, err)
	}
	// What the server asked of Stripe itself is not an act: nothing is sent of it.
	if held := s.holds(household); len(held) != 1 ||
		held[0]["id"] != sub.ID || held[0]["status"] != billing.StatusIncomplete || held[0]["interval"] != billing.Month ||
		held[0]["currency"] != "EUR" || held[0]["payer_id"] != payer.String() || held[0]["payment_method"] != nil {
		t.Fatalf("the subscription waiting to be paid for: %v", held)
	}

	// A declined card: the error Stripe.js resolves with, nothing changed, and nothing to tell.
	status, out := s.confirm(confirmation.ClientSecret, "declined_card")
	declined, _ := out["error"].(map[string]any)
	if status != http.StatusOK || declined["type"] != "card_error" || declined["code"] != "card_declined" || declined["message"] == "" {
		t.Fatalf("a declined card: %d %v", status, out)
	}
	if kinds := received.sent(); len(kinds) != 0 {
		t.Fatalf("a declined card sent %v", kinds)
	}

	// The API fails the first delivery, and is sent the event again.
	failures := 1
	received.answering(func(string) int {
		if failures > 0 {
			failures--
			return http.StatusInternalServerError
		}
		return http.StatusNoContent
	})
	if status, out := s.confirm(confirmation.ClientSecret, "card"); status != http.StatusOK || out["intent"] != "payment" || out["status"] != "succeeded" {
		t.Fatalf("a card: %d %v", status, out)
	}
	if kinds, want := received.sent(), []string{"customer.subscription.updated", "customer.subscription.updated", "invoice.paid"}; !slices.Equal(kinds, want) {
		t.Fatalf("a payment confirmed sent %v, want %v", kinds, want)
	}
	received.answering(nil)

	// Confirmed already: Stripe.js's answer for it, and nothing sent.
	status, out = s.confirm(confirmation.ClientSecret, "card")
	unexpected, _ := out["error"].(map[string]any)
	if status != http.StatusOK || unexpected["type"] != "invalid_request_error" || unexpected["code"] != "payment_intent_unexpected_state" {
		t.Fatalf("a secret confirmed twice: %d %v", status, out)
	}

	// What Stripe does on its own, each with its events in the order Stripe sends them.
	for _, step := range []struct {
		act, body string
		status    string
		sent      []string
	}{
		{"end-period", "", billing.StatusActive, []string{"customer.subscription.updated", "invoice.finalized", "invoice.paid"}},
		{"fail-payment", "", billing.StatusPastDue, []string{"invoice.finalized", "customer.subscription.updated", "invoice.payment_failed"}},
		{"fail-payment", `{"again":false}`, billing.StatusPastDue, []string{"invoice.payment_failed"}},
		{"give-up", "", billing.StatusCanceled, []string{"customer.subscription.deleted"}},
	} {
		held := s.done(household, step.act, step.body)
		if len(held) != 1 || held[0]["status"] != step.status {
			t.Fatalf("after %s the stand-in holds %v, want one %s", step.act, held, step.status)
		}
		if kinds := received.sent(); !slices.Equal(kinds, step.sent) {
			t.Fatalf("%s sent %v, want %v", step.act, kinds, step.sent)
		}
	}
	// Nothing is past due any more, nor paid up: there is nothing for either act to be about.
	for _, act := range []string{"give-up", "end-period", "fail-payment", "clear-debit", "fail-debit"} {
		status, out := s.ask(http.MethodPost, "/households/"+household.String()+"/"+act, "")
		refusedWith(t, status, out, http.StatusConflict, "not_applicable")
	}

	// A setup's secret is confirmed by the same request, and what the server does at the stand-in on
	// hearing of a change is told too: here it ends a subscription whose debit failed.
	sub, confirmation, err = processor.Subscribe(ctx, billing.NewSubscription{Customer: customer, Price: price, Household: household, Payer: payer})
	if err != nil {
		t.Fatal(err)
	}
	if status, out := s.confirm(confirmation.ClientSecret, "debit"); status != http.StatusOK || out["intent"] != "payment" || out["status"] != "processing" {
		t.Fatalf("a bank debit: %d %v", status, out)
	}
	if kinds, want := received.sent(), []string{"customer.subscription.updated"}; !slices.Equal(kinds, want) {
		t.Fatalf("a debit on its way sent %v, want %v", kinds, want)
	}
	received.answering(func(kind string) int {
		if kind == "invoice.voided" {
			// As the server does on hearing that a first payment's debit failed.
			if err := processor.Cancel(ctx, sub.ID); err != nil {
				t.Error(err)
			}
		}
		return http.StatusNoContent
	})
	if held := s.done(household, "fail-debit", ""); len(held) != 2 || held[1]["status"] != billing.StatusCanceled {
		t.Fatalf("after the debit failed the stand-in holds %v", held)
	}
	if kinds, want := received.sent(), []string{"invoice.voided", "customer.subscription.deleted"}; !slices.Equal(kinds, want) {
		t.Fatalf("a debit that failed sent %v, want %v", kinds, want)
	}
	received.answering(nil)
	setup, err := processor.Setup(ctx, billing.NewSetup{Customer: customer, Household: household, User: payer, Purpose: billing.PurposePaymentMethod, Subscription: sub.ID})
	if err != nil {
		t.Fatal(err)
	}
	if status, out := s.confirm(setup.ClientSecret, "card"); status != http.StatusOK || out["intent"] != "setup" || out["status"] != "succeeded" {
		t.Fatalf("a setup: %d %v", status, out)
	}
	if kinds, want := received.sent(), []string{"setup_intent.succeeded"}; !slices.Equal(kinds, want) {
		t.Fatalf("a setup confirmed sent %v, want %v", kinds, want)
	}
	status, out = s.confirm(setup.ClientSecret, "card")
	if unexpected, _ := out["error"].(map[string]any); status != http.StatusOK || unexpected["code"] != "setup_intent_unexpected_state" {
		t.Fatalf("a setup confirmed twice: %d %v", status, out)
	}

	// An event the API refuses is not sent again: the act's request fails, saying so.
	sub, confirmation, err = processor.Subscribe(ctx, billing.NewSubscription{Customer: customer, Price: price, Household: household, Payer: payer})
	if err != nil {
		t.Fatal(err)
	}
	received.answering(func(string) int { return http.StatusUnprocessableEntity })
	status, out = s.confirm(confirmation.ClientSecret, "card")
	refusedWith(t, status, out, http.StatusBadGateway, "webhook_failed")
	if kinds := received.sent(); len(kinds) != 1 {
		t.Fatalf("an event the API refused was sent %d times, want once", len(kinds))
	}
	received.answering(nil)

	// What the stand-in refuses itself.
	status, out = s.confirm("in_nobody_1_secret", "card")
	refusedWith(t, status, out, http.StatusNotFound, "unknown_secret")
	status, out = s.confirm(confirmation.ClientSecret, "cheque")
	refusedWith(t, status, out, http.StatusBadRequest, "bad_request")
	status, out = s.ask(http.MethodPost, "/confirm", `{"secret":"x"}`)
	refusedWith(t, status, out, http.StatusBadRequest, "bad_request")
	status, out = s.ask(http.MethodPost, "/households/"+uuid.NewString()+"/fail-payment", "")
	refusedWith(t, status, out, http.StatusNotFound, "unknown_household")
	status, out = s.ask(http.MethodPost, "/households/tilcerovi/give-up", "")
	refusedWith(t, status, out, http.StatusBadRequest, "bad_request")
	if held := s.holds(uuid.New()); len(held) != 0 {
		t.Fatalf("a household the stand-in knows nothing of: %v", held)
	}
	s.uncomplaining()

	// A path under the prefix that drives nothing is Stripe's to answer, which has nothing there: the
	// stand-in says so as Stripe does, and says in its log that it was asked.
	if status, out := s.ask(http.MethodPost, "/households/"+household.String()+"/refund", ""); status != http.StatusNotFound || out["error"] == nil {
		t.Fatalf("a path that drives nothing: %d %v", status, out)
	}
	if said := s.log.String(); !strings.Contains(said, complaint) {
		t.Fatalf("the stand-in said nothing of a request it does not answer:\n%s", said)
	}
}

// webOrigin is where the web client of the API under test is served: the origin its requests come
// from.
const webOrigin = "http://127.0.0.1:4173"

// passphrase is every test person's password.
const passphrase = "correct horse battery"

// served is the API itself, serving as the suite's does: in development, on this package's database,
// told where Stripe is through the setting that says so, with the stand-in's keys and its plans as
// the command prints them. It returns the API's address.
func served(t *testing.T, standInURL string) string {
	t.Helper()
	d := testsupport.Open(t)
	var prices bytes.Buffer
	if code := run(t.Context(), []string{"prices"}, vars(nil), &prices, io.Discard); code != 0 {
		t.Fatalf("prices: exit %d", code)
	}
	cfg, err := config.Load(config.Serve, vars(map[string]string{
		config.EnvVar:              string(config.Development),
		config.HTTPAddrVar:         "127.0.0.1:0",
		config.DatabaseURLVar:      d.URL(db.RoleApp),
		config.MeterDatabaseURLVar: d.URL(db.RoleMeter),
		config.StaffDatabaseURLVar: d.URL(db.RoleStaff),
		config.WebURLVar:           webOrigin,
		// Each of the test's people is a network of its own, to the limits on registering.
		config.TrustedProxiesVar:  "127.0.0.1/32",
		config.ShutdownTimeoutVar: "5s",
		// A mail server, an object store and a converter nothing answers at: the test verifies an
		// address in the database, and uploads nothing.
		config.SMTPURLVar:        "smtp://127.0.0.1:1",
		config.ObjectStoreURLVar: "http://tester:" + "not-published" + "@127.0.0.1:1/household",
		config.ConverterURLVar:   "http://127.0.0.1:1",
		config.UploadDirVar:      t.TempDir(),
		// What the suite's configuration gives its API (apps/web/playwright.config.ts).
		config.StripeAPIURLVar:         standInURL,
		config.StripeSecretKeyVar:      billingtest.SecretKey,
		config.StripePublishableKeyVar: billingtest.PublishableKey,
		config.StripeWebhookSecretVar:  billingtest.WebhookSecret,
		config.BillingPricesVar:        prices.String(),
	}))
	if err != nil {
		t.Fatal(err)
	}
	registry, err := module.NewRegistry(modules.All()...)
	if err != nil {
		t.Fatal(err)
	}
	log := logging.New(logged(t, "the API"), slog.LevelWarn)
	listening := make(chan net.Addr, 1)
	ended := make(chan error, 2)
	go func() { ended <- app.Run(t.Context(), cfg, log, registry, "stripe-standin-test", nil, listening) }()
	// The test's context has ended by the time what it left to clean up is, and the API with it.
	t.Cleanup(func() {
		select {
		case err := <-ended:
			if err != nil {
				t.Errorf("the API: %v", err)
			}
		case <-time.After(30 * time.Second):
			t.Error("the API did not stop")
		}
	})
	select {
	case addr := <-listening:
		return addr.String()
	case err := <-ended:
		ended <- err
		t.Fatalf("the API: %v", err)
	case <-time.After(30 * time.Second):
		t.Fatal("the API did not start listening")
	}
	return ""
}

// member is somebody's browser at the API: the cookies it holds, and the network it is on.
type member struct {
	t       *testing.T
	api     string
	network string
	cookies map[string]string
}

// send sends a request as the web client does, from its origin, with the cookies the browser holds
// and the CSRF token among them, and returns the status and the body answered.
func (m *member) send(method, path, body string) (int, []byte) {
	m.t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(m.t.Context(), method, "http://"+m.api+"/api/v1"+path, reader)
	if err != nil {
		m.t.Fatal(err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Origin", webOrigin)
	req.Header.Set("X-Forwarded-For", m.network)
	for name, value := range m.cookies {
		req.AddCookie(&http.Cookie{Name: name, Value: value}) //nolint:gosec // G124: a request's cookie is a name and a value; attributes are the response's.
	}
	if csrf, ok := m.cookies[session.CSRFCookie]; ok {
		req.Header.Set(session.CSRFHeader, csrf)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		m.t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	for _, c := range resp.Cookies() {
		if c.MaxAge < 0 {
			delete(m.cookies, c.Name)
		} else {
			m.cookies[c.Name] = c.Value
		}
	}
	answered, err := io.ReadAll(resp.Body)
	if err != nil {
		m.t.Fatal(err)
	}
	return resp.StatusCode, answered
}

// took sends a request, expects status, and reads the JSON it answered into into, when not nil.
func (m *member) took(method, path, body string, status int, into any) {
	m.t.Helper()
	got, answered := m.send(method, path, body)
	if got != status {
		m.t.Fatalf("%s %s answered %d %s, want %d", method, path, got, answered, status)
	}
	if into != nil {
		if err := json.Unmarshal(answered, into); err != nil {
			m.t.Fatalf("%s %s answered %s: %v", method, path, answered, err)
		}
	}
}

// site is an API and the stand-in it asks, and the database behind the API, as one test sees them.
type site struct {
	t       *testing.T
	api     string
	standIn *standIn
	admin   *pgx.Conn
	// people counts the people of every test of the site, each a network of their own.
	people *int
}

// in is the site as a test of its own sees it.
func (s *site) in(t *testing.T) *site {
	return &site{t: t, api: s.api, standIn: &standIn{t: t, url: s.standIn.url, log: s.standIn.log}, admin: s.admin, people: s.people}
}

// owner registers somebody, verifies their address, signs them in and has them make a household,
// which they own and pay for.
func (s *site) owner(name string) (*member, uuid.UUID) {
	s.t.Helper()
	*s.people++
	m := &member{t: s.t, api: s.api, network: "198.51.100." + strconv.Itoa(*s.people), cookies: map[string]string{}}
	address := strings.ToLower(name) + "@standin.test"
	m.took(http.MethodPost, "/auth/register", `{"email":"`+address+`","password":"`+passphrase+`","display_name":"`+name+`"}`, http.StatusAccepted, nil)
	// The mail server is nobody's: the address is verified where the link would have.
	if tag, err := s.admin.Exec(s.t.Context(), "UPDATE users SET email_verified_at = now() WHERE email = $1", address); err != nil || tag.RowsAffected() != 1 {
		s.t.Fatalf("verifying %s: %v, %d rows", address, err, tag.RowsAffected())
	}
	m.took(http.MethodPost, "/auth/login", `{"email":"`+address+`","password":"`+passphrase+`","client_type":"web"}`, http.StatusOK, nil)
	household := idgen.New()
	m.took(http.MethodPost, "/households", `{"id":"`+household.String()+`","name":"`+name+`ovi","country":"CZ","timezone":"Europe/Prague","base_currency":"CZK","locale":"cs"}`,
		http.StatusCreated, nil)
	return m, household
}

// billingDoc is what the test reads of the contract's Subscription.
type billingDoc struct {
	State             string  `json:"state"`
	Interval          *string `json:"interval"`
	CancelAtPeriodEnd bool    `json:"cancel_at_period_end"`
	PaymentPending    bool    `json:"payment_pending"`
	PaymentMethod     *struct {
		Brand string `json:"brand"`
	} `json:"payment_method"`
}

// billing reads household h's subscription.
func (m *member) billing(h uuid.UUID) billingDoc {
	m.t.Helper()
	var doc billingDoc
	m.took(http.MethodGet, "/households/"+h.String()+"/billing/subscription", "", http.StatusOK, &doc)
	return doc
}

// state is household h's entitlement state, as its own read says it.
func (m *member) state(h uuid.UUID) string {
	m.t.Helper()
	var doc struct {
		Entitlement struct {
			State string `json:"state"`
		} `json:"entitlement"`
	}
	m.took(http.MethodGet, "/households/"+h.String(), "", http.StatusOK, &doc)
	return doc.Entitlement.State
}

// intent begins something the payment form confirms, at path, and returns its secret.
func (m *member) intent(h uuid.UUID, path, body, kind string) string {
	m.t.Helper()
	var doc struct {
		ClientSecret   string `json:"client_secret"`
		Intent         string `json:"intent"`
		PublishableKey string `json:"publishable_key"`
	}
	m.took(http.MethodPost, "/households/"+h.String()+"/billing"+path, body, http.StatusOK, &doc)
	if doc.ClientSecret == "" || doc.Intent != kind || doc.PublishableKey != billingtest.PublishableKey {
		m.t.Fatalf("the intent of %s: %+v", path, doc)
	}
	return doc.ClientSecret
}

// paid takes household h through subscribing at interval and paying with a card in the payment
// form, with nobody posting a webhook: the stand-in tells the API itself.
func (s *site) paid(m *member, h uuid.UUID, interval string) {
	s.t.Helper()
	secret := m.intent(h, "/subscription", `{"interval":"`+interval+`"}`, billing.IntentPayment)
	if status, out := s.standIn.confirm(secret, "card"); status != http.StatusOK || out["status"] != "succeeded" {
		s.t.Fatalf("paying with a card: %d %v", status, out)
	}
	if state := m.state(h); state != "active" {
		s.t.Fatalf("after paying, the household is %s", state)
	}
}

// The API as the suite starts it, told where Stripe is by the development setting, asks the stand-in
// this command serves, and hears from it what Stripe would have told it: a household subscribes and
// is active once its payer has confirmed the payment in the form, lapses into grace when Stripe
// gives up on a renewal, is read-only when a cancelled subscription's period ends, and is as it was
// after a declined card. No test posts a webhook: when an act's request has been answered, what the
// API reads next is settled.
func TestTheSuitesAPIPaysAgainstTheStandIn(t *testing.T) {
	ln := listen(t)
	api := served(t, "http://"+ln.Addr().String())
	admin, err := pgx.Connect(t.Context(), testsupport.Open(t).URL(""))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Close(context.Background()) })
	all := &site{t: t, api: api, admin: admin, standIn: started(t, ln, "http://"+api+"/api/v1/webhooks/stripe"), people: new(int)}

	t.Run("subscribe, then lapse", func(t *testing.T) {
		s := all.in(t)
		jana, h := s.owner("Jana")
		if sub := jana.billing(h); sub.State != "trialing" || sub.Interval != nil {
			t.Fatalf("on trial: %+v", sub)
		}
		secret := jana.intent(h, "/subscription", `{"interval":"year"}`, billing.IntentPayment)
		if state := jana.state(h); state != "trialing" {
			t.Fatalf("before the payment is confirmed the household is %s", state)
		}
		if status, out := s.standIn.confirm(secret, "card"); status != http.StatusOK || out["intent"] != "payment" || out["status"] != "succeeded" {
			t.Fatalf("a card: %d %v", status, out)
		}
		sub := jana.billing(h)
		if sub.State != "active" || sub.Interval == nil || *sub.Interval != "year" || sub.PaymentMethod == nil || sub.PaymentMethod.Brand != "visa" {
			t.Fatalf("once the payment was confirmed: %+v", sub)
		}
		// The invoice's own event arrived too: it is kept, paid.
		var invoices struct {
			Items []struct {
				Status string `json:"status"`
			} `json:"items"`
		}
		jana.took(http.MethodGet, "/households/"+h.String()+"/billing/invoices", "", http.StatusOK, &invoices)
		if len(invoices.Items) != 1 || invoices.Items[0].Status != "paid" {
			t.Fatalf("the invoices: %+v", invoices)
		}

		// A renewal fails, and is retried: past due, nothing restricted.
		if held := s.standIn.done(h, "fail-payment", ""); len(held) != 1 || held[0]["status"] != "past_due" {
			t.Fatalf("the stand-in after a failed payment: %v", held)
		}
		if state := jana.state(h); state != "past_due" {
			t.Fatalf("after a failed payment the household is %s", state)
		}
		// The last retry fails, and Stripe gives up: grace.
		s.standIn.done(h, "fail-payment", `{"again":false}`)
		if held := s.standIn.done(h, "give-up", ""); held[0]["status"] != "canceled" {
			t.Fatalf("the stand-in after Stripe gave up: %v", held)
		}
		if sub := jana.billing(h); sub.State != "grace" || sub.Interval != nil {
			t.Fatalf("after Stripe gave up: %+v", sub)
		}
	})

	t.Run("a declined card changes nothing", func(t *testing.T) {
		s := all.in(t)
		eva, h := s.owner("Eva")
		secret := eva.intent(h, "/subscription", `{"interval":"month"}`, billing.IntentPayment)
		status, out := s.standIn.confirm(secret, "declined_card")
		declined, _ := out["error"].(map[string]any)
		if status != http.StatusOK || declined["type"] != "card_error" || declined["code"] != "card_declined" || declined["message"] == "" {
			t.Fatalf("a declined card: %d %v", status, out)
		}
		if sub := eva.billing(h); sub.State != "trialing" || sub.Interval != nil || sub.PaymentPending {
			t.Fatalf("after a declined card: %+v", sub)
		}
		if held := s.standIn.holds(h); len(held) != 1 || held[0]["status"] != "incomplete" {
			t.Fatalf("the stand-in after a declined card: %v", held)
		}
		// The same secret takes another card.
		if status, out := s.standIn.confirm(secret, "card"); status != http.StatusOK || out["status"] != "succeeded" {
			t.Fatalf("another card: %d %v", status, out)
		}
		if state := eva.state(h); state != "active" {
			t.Fatalf("after another card the household is %s", state)
		}
		// And a secret nobody was handed is no payment's.
		status, out = s.standIn.confirm(secret+"_of_nobodys", "card")
		refusedWith(t, status, out, http.StatusNotFound, "unknown_secret")
	})

	t.Run("a bank debit is on its way, then clears or fails", func(t *testing.T) {
		s := all.in(t)
		petr, h := s.owner("Petr")
		secret := petr.intent(h, "/subscription", `{"interval":"year"}`, billing.IntentPayment)
		if status, out := s.standIn.confirm(secret, "debit"); status != http.StatusOK || out["status"] != "processing" {
			t.Fatalf("a bank debit: %d %v", status, out)
		}
		if sub := petr.billing(h); sub.State != "trialing" || !sub.PaymentPending {
			t.Fatalf("while the debit is on its way: %+v", sub)
		}
		s.standIn.done(h, "clear-debit", "")
		if sub := petr.billing(h); sub.State != "active" || sub.PaymentPending || sub.PaymentMethod == nil || sub.PaymentMethod.Brand != "sepa_debit" {
			t.Fatalf("once the debit cleared: %+v", sub)
		}

		mila, h := s.owner("Mila")
		secret = mila.intent(h, "/subscription", `{"interval":"year"}`, billing.IntentPayment)
		s.standIn.confirm(secret, "debit")
		// The API ends the subscription at the stand-in on hearing that its debit failed, and hears of
		// that too before the act is answered.
		if held := s.standIn.done(h, "fail-debit", ""); len(held) != 1 || held[0]["status"] != "canceled" {
			t.Fatalf("the stand-in after the debit failed: %v", held)
		}
		if sub := mila.billing(h); sub.State != "trialing" || sub.PaymentPending || sub.Interval != nil {
			t.Fatalf("once the debit failed: %+v", sub)
		}
	})

	t.Run("a new payment method pays what is owed", func(t *testing.T) {
		s := all.in(t)
		olga, h := s.owner("Olga")
		s.paid(olga, h, "month")
		s.standIn.done(h, "fail-payment", "")
		if state := olga.state(h); state != "past_due" {
			t.Fatalf("after a failed payment the household is %s", state)
		}
		secret := olga.intent(h, "/payment-method", "", billing.IntentSetup)
		if status, out := s.standIn.confirm(secret, "card"); status != http.StatusOK || out["intent"] != "setup" || out["status"] != "succeeded" {
			t.Fatalf("a setup: %d %v", status, out)
		}
		// The API collected the open invoice with the new card as it heard of the setup, and has heard
		// of that payment too.
		if sub := olga.billing(h); sub.State != "active" || sub.PaymentMethod == nil {
			t.Fatalf("once the new card was confirmed: %+v", sub)
		}
	})

	t.Run("a cancelled subscription ends with its period", func(t *testing.T) {
		s := all.in(t)
		ivan, h := s.owner("Ivan")
		s.paid(ivan, h, "year")
		// A period that ends renews one that is not set to cancel.
		if held := s.standIn.done(h, "end-period", ""); held[0]["status"] != "active" {
			t.Fatalf("the stand-in after a renewal: %v", held)
		}
		if state := ivan.state(h); state != "active" {
			t.Fatalf("after a renewal the household is %s", state)
		}
		ivan.took(http.MethodPost, "/households/"+h.String()+"/billing/cancel", "", http.StatusOK, nil)
		if sub := ivan.billing(h); sub.State != "active" || !sub.CancelAtPeriodEnd {
			t.Fatalf("set to cancel: %+v", sub)
		}
		if held := s.standIn.done(h, "end-period", ""); held[0]["status"] != "canceled" {
			t.Fatalf("the stand-in after the period ended: %v", held)
		}
		// Read-only: nothing is written, and the export still is.
		if sub := ivan.billing(h); sub.State != "canceled" || sub.Interval != nil {
			t.Fatalf("once the period ended: %+v", sub)
		}
		if status, body := ivan.send(http.MethodPatch, "/households/"+h.String(), `{"name":"Ivanovi doma"}`); status != http.StatusPaymentRequired {
			t.Fatalf("a write to a household that lapsed answered %d %s", status, body)
		}
	})

	// Through all of it the API asked the stand-in only what Stripe takes, at the API version the SDK
	// is pinned to, as it does in the server's own tests.
	all.standIn.uncomplaining()
}

// The stand-in answers anyone who reaches it and posts where it is told to, so it listens on the
// loopback alone and delivers to it alone, and does not start otherwise; nor on plans that are not
// its own, which it prints as HOUSEHOLD_BILLING_PRICES takes them.
func TestTheStandInStartsOnTheLoopbackAndItsOwnPlansAlone(t *testing.T) {
	var prices bytes.Buffer
	if code := run(t.Context(), []string{"prices"}, vars(nil), &prices, io.Discard); code != 0 {
		t.Fatalf("prices: exit %d", code)
	}
	if plans, err := billing.ParsePrices(prices.String()); err != nil || len(plans) != len(billingtest.Prices()) ||
		plans["EUR"] != billingtest.Prices()["EUR"] || plans["GBP"] != billingtest.Prices()["GBP"] || len(plans.Unpriced()) != 0 {
		t.Fatalf("the plans printed: %s (%v)", prices.String(), err)
	}
	if _, err := read(func(name string) string {
		if name == config.BillingPricesVar {
			return prices.String()
		}
		return defaults[name]
	}); err != nil {
		t.Fatalf("the stand-in's own plans: %v", err)
	}

	for _, tc := range []struct {
		name string
		args []string
		vars map[string]string
		want string
	}{
		{"no command", nil, nil, "usage"},
		{"a command it does not have", []string{"migrate"}, nil, "usage"},
		{"an argument too many", []string{"serve", "now"}, nil, "usage"},
		{"every interface", []string{"serve"}, map[string]string{addrVar: "0.0.0.0:12112"}, addrVar},
		{"a port alone", []string{"serve"}, map[string]string{addrVar: ":12112"}, addrVar},
		{"another machine's address", []string{"serve"}, map[string]string{addrVar: "192.0.2.10:12112"}, addrVar},
		{"a name that is not this machine's", []string{"serve"}, map[string]string{addrVar: "standin.household.test:12112"}, addrVar},
		{"no port", []string{"serve"}, map[string]string{addrVar: "127.0.0.1"}, addrVar},
		{"a webhook on another machine", []string{"serve"}, map[string]string{webhookURLVar: "https://api.household.test/api/v1/webhooks/stripe"}, webhookURLVar},
		{"a webhook that is no URL", []string{"serve"}, map[string]string{webhookURLVar: "127.0.0.1:8080"}, webhookURLVar},
		{"plans whose price is another", []string{"serve"}, map[string]string{
			config.BillingPricesVar: strings.Replace(prices.String(), "price_eur_year", "price_eur_yearly", 1),
		}, config.BillingPricesVar},
		{"plans whose amount is another", []string{"serve"}, map[string]string{
			config.BillingPricesVar: strings.Replace(prices.String(), "5988", "5999", 1),
		}, config.BillingPricesVar},
		{"plans that are not JSON", []string{"serve"}, map[string]string{config.BillingPricesVar: "EUR=5988"}, config.BillingPricesVar},
	} {
		var stderr bytes.Buffer
		if code := run(t.Context(), tc.args, vars(tc.vars), io.Discard, &stderr); code != 2 || !strings.Contains(stderr.String(), tc.want) {
			t.Errorf("%s: exit %d, %s; want 2 and a word about %s", tc.name, code, stderr.String(), tc.want)
		}
	}
}
