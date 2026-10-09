// Command stripe-standin stands in for Stripe for the web's end-to-end suite (plan item 27,
// apps/web/playwright.config.ts): the stand-in the server's own tests ask
// (internal/platform/billing/billingtest), served as a process, which the API the suite starts is
// told to ask in Stripe's place (HOUSEHOLD_STRIPE_API_URL, development's alone). It is the suite's
// alone, never deployed: it takes no payment, holds nothing real and keeps what it holds in memory,
// its keys are the published ones of billingtest, and it listens on the loopback and nowhere else.
//
//	stripe-standin serve    serve Stripe's API as billingtest stands in for it, and what drives it
//	stripe-standin prices   print the plans of the stand-in's account, as HOUSEHOLD_BILLING_PRICES takes them
//
// Beside Stripe's API, under /v1, serve answers what drives the stand-in, under /_standin (control.go):
// what a customer does in the payment form, what Stripe does on its own, and what the stand-in
// holds of a household. Nobody posts a webhook for a process, so the stand-in delivers Stripe's
// events itself, signed as Stripe signs them, before the request that caused them is answered.
//
// Configuration comes from the environment, each default a loopback development value:
//
//	STRIPE_STANDIN_ADDR         where serve listens (127.0.0.1:12112; 12111 is stripe-mock's)
//	STRIPE_STANDIN_WEBHOOK_URL  the API's webhook, which the events are delivered to
//	                            (http://127.0.0.1:8080/api/v1/webhooks/stripe)
//	HOUSEHOLD_BILLING_PRICES    the plans the API beside it is given, when set: serve does not start
//	                            on plans that are not the stand-in's own, which prices prints
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"slices"
	"sync"
	"syscall"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/billing"
	"github.com/kareltilcer/household/server/internal/platform/billing/billingtest"
	"github.com/kareltilcer/household/server/internal/platform/config"
	"github.com/kareltilcer/household/server/internal/platform/logging"
)

// The variables the stand-in reads, beside config.BillingPricesVar.
const (
	addrVar       = "STRIPE_STANDIN_ADDR"
	webhookURLVar = "STRIPE_STANDIN_WEBHOOK_URL"
)

// defaults are where the stand-in listens and where the API the suite starts does
// (apps/web/build/preview.ts).
var defaults = map[string]string{
	addrVar:       "127.0.0.1:12112",
	webhookURLVar: "http://127.0.0.1:8080/api/v1/webhooks/stripe",
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	context.AfterFunc(ctx, stop)
	code := run(ctx, os.Args[1:], os.LookupEnv, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

// run runs the command args name and returns the process's exit status: 0, 1 when the command
// failed, 2 when it could not start.
func run(ctx context.Context, args []string, lookup config.Getenv, stdout, stderr io.Writer) int {
	env := func(name string) string {
		if v, ok := lookup(name); ok && v != "" {
			return v
		}
		return defaults[name]
	}
	switch {
	case len(args) == 1 && args[0] == "prices":
		if err := json.NewEncoder(stdout).Encode(billingtest.Prices()); err != nil {
			_, _ = fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	case len(args) == 1 && args[0] == "serve":
	default:
		_, _ = fmt.Fprintln(stderr, "usage: stripe-standin serve|prices")
		return 2
	}
	cfg, err := read(env)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, err)
		return 2
	}
	log := logging.New(stdout, slog.LevelInfo)
	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", cfg.addr)
	if err != nil {
		log.LogAttrs(ctx, slog.LevelError, "command failed", slog.Any("error", fmt.Errorf("listen on %s: %w", cfg.addr, err)))
		return 1
	}
	serve(ctx, ln, cfg.webhookURL, log)
	return 0
}

// settings are what serve is told.
type settings struct {
	// addr is where it listens, and webhookURL where it delivers Stripe's events: both on the loopback.
	addr, webhookURL string
}

// read reads the settings, and names everything wrong with them at once, as the server's own
// configuration does. The stand-in answers anyone who reaches it, with no key asked for, and posts
// what it is told to wherever it is told to: so it listens on this machine alone, and delivers to
// this machine alone.
func read(env func(string) string) (settings, error) {
	var errs []error
	cfg := settings{addr: env(addrVar), webhookURL: env(webhookURLVar)}
	if host, _, err := net.SplitHostPort(cfg.addr); err != nil || !loopback(host) {
		errs = append(errs, fmt.Errorf("%s is %q; the stand-in listens on the loopback alone, at a host and a port such as %s",
			addrVar, cfg.addr, defaults[addrVar]))
	}
	if u, err := url.Parse(cfg.webhookURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil ||
		u.RawQuery != "" || u.Fragment != "" || !loopback(u.Hostname()) {
		errs = append(errs, fmt.Errorf("%s is not the http(s) URL of a webhook on this machine, such as %s", webhookURLVar, defaults[webhookURLVar]))
	}
	// What the API shows a customer and what the stand-in charges are one set of figures only while
	// the API is given the stand-in's own plans: told what the API was given, the stand-in holds the
	// two together, and a suite whose configuration has drifted from it stops here, not at a payment.
	if raw := env(config.BillingPricesVar); raw != "" {
		given, err := billing.ParsePrices(raw)
		switch {
		case err != nil:
			errs = append(errs, fmt.Errorf("%s: %w", config.BillingPricesVar, err))
		case !maps.Equal(given, billingtest.Prices()):
			errs = append(errs, fmt.Errorf("%s names plans that are not the stand-in's own, for %v; `stripe-standin prices` prints those it charges",
				config.BillingPricesVar, slices.Sorted(maps.Keys(given))))
		}
	}
	if len(errs) > 0 {
		return settings{}, fmt.Errorf("stripe-standin: %w", errors.Join(errs...))
	}
	return cfg, nil
}

// loopback reports whether host is this machine's: localhost, or a loopback address.
func loopback(host string) bool {
	ip := net.ParseIP(host)
	return host == "localhost" || (ip != nil && ip.IsLoopback())
}

// serve serves the stand-in on ln, delivering Stripe's events to webhookURL, until ctx ends. Its
// clock is the wall clock: the periods it gives a subscription begin when they are asked for.
func serve(ctx context.Context, ln net.Listener, webhookURL string, log *slog.Logger) {
	p := &process{log: log}
	defer p.stop()
	billingtest.Serve(p, ln, time.Now, func(stripe *billingtest.Stripe) {
		c := &control{
			stripe: stripe, webhookURL: webhookURL, log: log, now: time.Now,
			client: &http.Client{Timeout: deliverWithin}, pauses: redeliveries,
		}
		c.routes()
	})
	log.LogAttrs(ctx, slog.LevelInfo, "standing in for Stripe", slog.String("addr", ln.Addr().String()))
	<-ctx.Done()
}

// process is who runs the stand-in when no test does (billingtest.TB).
type process struct {
	log *slog.Logger

	mu    sync.Mutex
	stops []func()
}

// Helper is a test's, to name the line that failed: a process has none to name.
func (*process) Helper() {}

// complaint is what the stand-in logs of a request Stripe would not have taken.
const complaint = "the stand-in was asked what Stripe would not have taken"

// Errorf logs what the API asked of the stand-in that Stripe would not have taken, which fails a
// test of the server's: a route the stand-in does not answer, or a request at another API version.
// The request is answered all the same, as the stand-in answers it.
func (p *process) Errorf(format string, args ...any) {
	p.log.LogAttrs(context.Background(), slog.LevelError, complaint, slog.String("error", fmt.Sprintf(format, args...)))
}

// unable is what the stand-in was asked that it cannot do: what Fatalf is told.
type unable string

// Fatalf ends the request that asked the stand-in for what it cannot do, which the handler it ends
// answers (control.acted): where a test would end there, a process goes on serving.
func (*process) Fatalf(format string, args ...any) {
	panic(unable(fmt.Sprintf(format, args...)))
}

// Cleanup keeps fn for when the process stops.
func (p *process) Cleanup(fn func()) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.stops = append(p.stops, fn)
}

// stop runs what Cleanup kept, the last first.
func (p *process) stop() {
	p.mu.Lock()
	stops := p.stops
	p.stops = nil
	p.mu.Unlock()
	for _, fn := range slices.Backward(stops) {
		fn()
	}
}
