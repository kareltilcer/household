// Package apptest builds what a test's router needs beyond the platform's pool and contract: the
// account surfaces (app.Accounts), with password hashing cheap enough for a test, a
// breached-password corpus of the test's choosing, mail kept in memory, keys of the test's own for
// access tokens and the second step, every job the identity service defers run before the request
// that deferred it returns, and the files pipeline the users' pictures go through.
package apptest

import (
	"bytes"
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
	"github.com/kareltilcer/household/server/internal/platform/avatar"
	"github.com/kareltilcer/household/server/internal/platform/breach"
	"github.com/kareltilcer/household/server/internal/platform/clientip"
	"github.com/kareltilcer/household/server/internal/platform/clientversion"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/device"
	"github.com/kareltilcer/household/server/internal/platform/federation"
	"github.com/kareltilcer/household/server/internal/platform/files"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/mfa"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/password"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/replica"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
	"github.com/kareltilcer/household/server/internal/platform/token"
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
	// Screening, when set, is called with each password the server screens, before the corpus is
	// read: the moment between a current password's check and the new one's write.
	Screening func(password string)
	// Providers are the identity providers configured, by name, and RedirectURIs the redirect
	// URIs registered for them.
	Providers    map[string]*federation.Provider
	RedirectURIs []string
	// MinClients are the oldest clients served.
	MinClients clientversion.Minimums
	// Hooks are the household surface's (Households).
	Hooks household.Hooks
	// PushLimit is the push's limit per device, no limit a test would meet when zero.
	PushLimit ratelimit.Rate
	// Files is the files pipeline, which the users' pictures go through (Files). When nil, a
	// pipeline over a bucket nobody made stands in: a link to a picture is signed without asking the
	// store, and an upload fails 502.
	Files *files.Service
}

// Files returns the files pipeline over pool, with a bucket of t's own on the test object store,
// on the clock of o, whose workers a test runs with its Drain; limits adjusts its configuration.
func Files(t testing.TB, pool session.Pool, log *slog.Logger, o Options, limits ...func(*files.Config)) *files.Service {
	t.Helper()
	return pipeline(t, pool, log, o, testsupport.ObjectStore(t), limits...)
}

// pipeline returns the files pipeline over pool, store and the meter role's pool.
func pipeline(t testing.TB, pool session.Pool, log *slog.Logger, o Options, store *objectstore.Store, limits ...func(*files.Config)) *files.Service {
	t.Helper()
	beginner, ok := pool.(tenant.Beginner)
	if !ok {
		t.Fatalf("apptest: %T opens no transactions", pool)
	}
	cfg := files.Config{
		Pool: beginner, Meter: testsupport.Open(t).Pool(t, db.RoleMeter), Store: store, Log: log,
		Dir: t.TempDir(), Now: o.Now,
	}
	for _, limit := range limits {
		limit(&cfg)
	}
	s, err := files.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// unmade is a store over a bucket nobody made, which signs links without asking it anything.
func unmade(t testing.TB) *objectstore.Store {
	t.Helper()
	store, err := objectstore.New(objectstore.Config{Location: testsupport.ObjectStoreLocation(t, "unmade-bucket")})
	if err != nil {
		t.Fatal(err)
	}
	return store
}

// PowerSyncURL is where the tests' replicas reach PowerSync, which the sync credentials name.
const PowerSyncURL = "https://powersync.household.test"

// Sync returns the sync surfaces for a router logging to log, on the clock of o: credentials for
// PowerSyncURL signed with TokenKeys, and the push's limit.
func Sync(t testing.TB, log *slog.Logger, o Options) app.Sync {
	t.Helper()
	replicas, err := replica.New(replica.Config{URL: PowerSyncURL, Keys: TokenKeys, Logger: log, Now: o.Now})
	if err != nil {
		t.Fatal(err)
	}
	limit := o.PushLimit
	if limit == (ratelimit.Rate{}) {
		limit = ratelimit.Rate{PerMinute: 1e9, Burst: 1e9}
	}
	return app.Sync{Replica: replicas, PushLimit: ratelimit.NewBuckets(limit, o.Now)}
}

// TokenKeys and MFAKeys are the tests' keys: fixed, so that a token one router issued verifies at
// another.
var (
	TokenKeys = mustTokenKeys()
	MFAKeys   = mustMFAKeys()
)

func mustTokenKeys() *token.Keys {
	k, err := token.NewKeys(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		panic(err)
	}
	return k
}

func mustMFAKeys() *mfa.Keys {
	k, err := mfa.NewKeys(bytes.Repeat([]byte{9}, 32))
	if err != nil {
		panic(err)
	}
	return k
}

// Cheap are password parameters cheap enough for a test to hash with often.
var Cheap = password.Params{Memory: 1024, Time: 1, Threads: 1, SaltLen: 16, KeyLen: 32}

// Accounts returns the account surfaces for a router over pool, logging to log, and the outbox
// their mail goes to.
func Accounts(t testing.TB, pool session.Pool, log *slog.Logger, o Options) (app.Accounts, *Outbox) {
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
	devices := device.NewStore(pool, TokenKeys, log, o.Now)
	outbox := &Outbox{}
	fs := o.Files
	if fs == nil {
		fs = pipeline(t, pool, log, o, unmade(t))
	}
	avatars, err := avatar.New(fs, log, o.Now)
	if err != nil {
		t.Fatal(err)
	}
	breached := func(pw string) (bool, error) {
		if o.Screening != nil {
			o.Screening(pw)
		}
		return corpus.Contains(pw)
	}
	id, err := identity.New(identity.Config{
		Pool: pool, Log: log, Hasher: hasher, Breached: breached,
		Throttles: ratelimit.NewThrottles(pool, o.Now), Sessions: sessions, Mail: outbox, Catalogs: catalogs,
		WebURL: web, ClientIP: clientip.New(proxies),
		Later:   func(ctx context.Context, fn func(context.Context)) { fn(context.WithoutCancel(ctx)) },
		Devices: devices, MFA: MFAKeys, Providers: o.Providers, RedirectURIs: o.RedirectURIs, Avatars: avatars,
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
		Identity: id, Sessions: sessions, Devices: devices, Origins: origins, MinClients: o.MinClients,
		UserLimit:      ratelimit.NewBuckets(userLimit, o.Now),
		HouseholdLimit: ratelimit.NewBuckets(householdLimit, o.Now),
	}, outbox
}

// Households returns the household surface for a router over pool, logging to log, on the clock
// and with the hooks of o, with accounts' identity service as its account half, sending its mail to
// outbox and running what it defers before the request that deferred it returns.
func Households(t testing.TB, pool session.Pool, log *slog.Logger, accounts app.Accounts, outbox *Outbox, o Options) *household.Service {
	t.Helper()
	catalogs, err := i18n.Default()
	if err != nil {
		t.Fatal(err)
	}
	web, err := url.Parse(WebURL)
	if err != nil {
		t.Fatal(err)
	}
	s, err := household.New(household.Config{
		Pool: pool, Log: log, Throttles: ratelimit.NewThrottles(pool, o.Now), Mail: outbox, Catalogs: catalogs,
		WebURL: web, Later: func(ctx context.Context, fn func(context.Context)) { fn(context.WithoutCancel(ctx)) },
		Now: o.Now, Hooks: o.Hooks, Accounts: accounts.Identity,
	})
	if err != nil {
		t.Fatal(err)
	}
	return s
}
