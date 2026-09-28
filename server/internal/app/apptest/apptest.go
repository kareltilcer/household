// Package apptest builds what a test's router needs beyond the platform's pool and contract: the
// account surfaces (app.Accounts), with password hashing cheap enough for a test, a
// breached-password corpus of the test's choosing, mail kept in memory, and every job the
// identity service defers run before the request that deferred it returns.
package apptest

import (
	"context"
	"log/slog"
	"net/url"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/platform/breach"
	"github.com/kareltilcer/household/server/internal/platform/clientip"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/password"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// WebURL is where the tests' web client is served; WebOrigin is its origin, which the router
// allows.
const (
	WebURL    = "https://app.household.test"
	WebOrigin = WebURL
)

// Outbox keeps the mail a test's server sends.
type Outbox struct {
	mu       sync.Mutex
	messages []mail.Message
}

// Send keeps m.
func (o *Outbox) Send(_ context.Context, m mail.Message) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.messages = append(o.messages, m)
	return nil
}

// To returns the messages sent to address, in the order they were sent.
func (o *Outbox) To(address string) []mail.Message {
	o.mu.Lock()
	defer o.mu.Unlock()
	var out []mail.Message
	for _, m := range o.messages {
		if m.To == address {
			out = append(out, m)
		}
	}
	return out
}

// Len is how many messages were sent.
func (o *Outbox) Len() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.messages)
}

// Options adjust the account surfaces.
type Options struct {
	// Breached are the passwords the breached-password corpus holds.
	Breached []string
	// Now is the clock of the sessions and the throttles; time.Now when nil.
	Now func() time.Time
	// TrustedProxies are the proxies whose X-Forwarded-For names the client.
	TrustedProxies []string
	// UserLimit and HouseholdLimit are the API's limits, no limit a test would meet when zero.
	UserLimit, HouseholdLimit ratelimit.Rate
}

// Cheap are password parameters cheap enough for a test to hash with often.
var Cheap = password.Params{Memory: 1024, Time: 1, Threads: 1, SaltLen: 16, KeyLen: 32}

// Accounts returns the account surfaces for a router over pool, logging to log, and the outbox
// their mail goes to.
func Accounts(t testing.TB, pool tenant.Beginner, log *slog.Logger, o Options) (app.Accounts, *Outbox) {
	t.Helper()
	hasher, err := password.New(Cheap, 4)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "breached.bin")
	w, err := breach.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	var prefixes []uint64
	for _, p := range o.Breached {
		prefixes = append(prefixes, breach.Prefix(p))
	}
	slices.Sort(prefixes)
	for _, p := range prefixes {
		if err := w.Add(p); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	corpus, err := breach.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = corpus.Close() })

	catalogs, err := i18n.Default()
	if err != nil {
		t.Fatal(err)
	}
	origins, err := session.NewOrigins(WebOrigin)
	if err != nil {
		t.Fatal(err)
	}
	proxies, err := clientip.ParsePrefixes(strings.Join(o.TrustedProxies, ","))
	if err != nil {
		t.Fatal(err)
	}
	web, err := url.Parse(WebURL)
	if err != nil {
		t.Fatal(err)
	}
	sessions := session.NewStore(pool, origins, log, o.Now)
	outbox := &Outbox{}
	id, err := identity.New(identity.Config{
		Pool: pool, Log: log, Hasher: hasher, Breached: corpus.Contains,
		Throttles: ratelimit.NewThrottles(pool, o.Now), Sessions: sessions, Mail: outbox, Catalogs: catalogs,
		WebURL: web, ClientIP: clientip.New(proxies),
		Later: func(ctx context.Context, fn func(context.Context)) { fn(context.WithoutCancel(ctx)) },
	})
	if err != nil {
		t.Fatal(err)
	}
	unlimited := ratelimit.Rate{PerMinute: 1e9, Burst: 1e9}
	userLimit, householdLimit := o.UserLimit, o.HouseholdLimit
	if userLimit == (ratelimit.Rate{}) {
		userLimit = unlimited
	}
	if householdLimit == (ratelimit.Rate{}) {
		householdLimit = unlimited
	}
	return app.Accounts{
		Identity: id, Sessions: sessions, Origins: origins,
		UserLimit:      ratelimit.NewBuckets(userLimit, o.Now),
		HouseholdLimit: ratelimit.NewBuckets(householdLimit, o.Now),
	}, outbox
}
