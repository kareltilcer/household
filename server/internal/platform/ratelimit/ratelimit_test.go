package ratelimit_test

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

func TestMain(m *testing.M) { testsupport.Main(m) }

// clock is a time a test moves by hand.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func newClock() *clock { return &clock{t: time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)} }

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func throttles(t *testing.T, c *clock) *ratelimit.Throttles {
	t.Helper()
	return ratelimit.NewThrottles(testsupport.Open(t).Pool(t, db.RoleApp), c.now)
}

// subject is a subject no other test counts under.
func subject(t *testing.T) string { return t.Name() }

func TestTakeAdmitsMaxAttemptsAWindow(t *testing.T) {
	c := newClock()
	th := throttles(t, c)
	limit := ratelimit.Limit{Name: "test.take", Max: 3, Window: time.Hour}
	for i := range 3 {
		if wait, err := th.Take(t.Context(), limit, subject(t)); err != nil || wait != 0 {
			t.Fatalf("attempt %d: %v, %v", i+1, wait, err)
		}
		c.advance(time.Minute)
	}
	wait, err := th.Take(t.Context(), limit, subject(t))
	if err != nil || wait != 57*time.Minute {
		t.Fatalf("the fourth attempt waits %v, %v; want the 57 minutes left of the window", wait, err)
	}
	if wait, err := th.Blocked(t.Context(), limit, subject(t)); err != nil || wait != 57*time.Minute {
		t.Fatalf("blocked for %v, %v", wait, err)
	}
	// Another subject, and another limit, count apart.
	if wait, err := th.Take(t.Context(), limit, subject(t)+" else"); err != nil || wait != 0 {
		t.Fatalf("another subject: %v, %v", wait, err)
	}
	if wait, err := th.Take(t.Context(), ratelimit.Limit{Name: "test.other", Max: 1, Window: time.Hour}, subject(t)); err != nil || wait != 0 {
		t.Fatalf("another limit: %v, %v", wait, err)
	}
	c.advance(57 * time.Minute)
	if wait, err := th.Take(t.Context(), limit, subject(t)); err != nil || wait != 0 {
		t.Fatalf("a new window: %v, %v", wait, err)
	}
}

// Concurrent attempts are counted one at a time: exactly Max are admitted.
func TestTakeCountsConcurrentAttemptsOnce(t *testing.T) {
	th := throttles(t, newClock())
	limit := ratelimit.Limit{Name: "test.concurrent", Max: 5, Window: time.Hour}
	var admitted atomic.Int32
	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() {
			wait, err := th.Take(t.Context(), limit, subject(t))
			if err != nil {
				t.Error(err)
				return
			}
			if wait == 0 {
				admitted.Add(1)
			}
		})
	}
	wg.Wait()
	if admitted.Load() != 5 {
		t.Fatalf("%d admitted, want 5", admitted.Load())
	}
}

// attempt counts an attempt by subject under l, and expects it admitted.
func attempt(t *testing.T, th *ratelimit.Throttles, l ratelimit.Limit, subject string) {
	t.Helper()
	if wait, err := th.Attempt(t.Context(), ratelimit.Count{Limit: l, Subject: subject}); err != nil || wait != 0 {
		t.Fatalf("an attempt was refused: %v, %v", wait, err)
	}
}

// A limit that does not back off blocks while its window's failures are used up.
func TestFailuresBlockForTheRestOfTheWindow(t *testing.T) {
	c := newClock()
	th := throttles(t, c)
	limit := ratelimit.LoginNetwork
	for range limit.Max - 1 {
		attempt(t, th, limit, subject(t))
	}
	if wait, _ := th.Blocked(t.Context(), limit, subject(t)); wait != 0 {
		t.Fatalf("blocked after %d of %d failures", limit.Max-1, limit.Max)
	}
	c.advance(5 * time.Minute)
	attempt(t, th, limit, subject(t))
	if wait, err := th.Attempt(t.Context(), ratelimit.Count{Limit: limit, Subject: subject(t)}); err != nil || wait != 10*time.Minute {
		t.Fatalf("an attempt past the limit waits %v, %v; want the 10 minutes left of the window", wait, err)
	}
	if wait, _ := th.Blocked(t.Context(), limit, subject(t)); wait != 10*time.Minute {
		t.Fatalf("blocked for %v, want the 10 minutes left of the window", wait)
	}
	c.advance(10 * time.Minute)
	if wait, _ := th.Blocked(t.Context(), limit, subject(t)); wait != 0 {
		t.Fatalf("still blocked once the window ended: %v", wait)
	}
}

// Sign-in failures on an account cool it down rather than lock it (FR-ID3): the tenth failure in
// fifteen minutes blocks for a minute, each one after it for twice as long, up to an hour, and
// the count starts again once the account has been quiet for fifteen minutes past its block.
func TestAccountFailuresBackOff(t *testing.T) {
	c := newClock()
	th := throttles(t, c)
	limit := ratelimit.LoginAccount
	blocked := func() time.Duration {
		t.Helper()
		wait, err := th.Blocked(t.Context(), limit, subject(t))
		if err != nil {
			t.Fatal(err)
		}
		return wait
	}
	fail := func() {
		t.Helper()
		attempt(t, th, limit, subject(t))
	}
	for range 9 {
		fail()
		c.advance(time.Minute)
	}
	if wait := blocked(); wait != 0 {
		t.Fatalf("blocked after nine failures: %v", wait)
	}
	for _, want := range []time.Duration{1, 2, 4, 8, 16, 32, 60, 60} {
		fail()
		if wait := blocked(); wait != want*time.Minute {
			t.Fatalf("blocked for %v, want %v", wait, want*time.Minute)
		}
		c.advance(want * time.Minute)
	}
	// Quiet for the window after the last block: the count starts again.
	c.advance(15 * time.Minute)
	fail()
	if wait := blocked(); wait != 0 {
		t.Fatalf("blocked by one failure after a quiet window: %v", wait)
	}
	// A success clears the count.
	for range 8 {
		fail()
	}
	if err := th.Clear(t.Context(), limit, subject(t)); err != nil {
		t.Fatal(err)
	}
	fail()
	if wait := blocked(); wait != 0 {
		t.Fatalf("blocked after a clear and one failure: %v", wait)
	}
}

// Attempts sent at once are counted as they arrive, before any is checked: exactly Max are let
// through, whether or not the limit backs off.
func TestConcurrentAttemptsAreCountedBeforeTheyAreChecked(t *testing.T) {
	th := throttles(t, newClock())
	for _, limit := range []ratelimit.Limit{
		{Name: "test.attempt", Max: 5, Window: time.Hour},
		{Name: "test.attempt_backoff", Max: 5, Window: time.Hour, Backoff: time.Minute, MaxBackoff: time.Hour},
	} {
		var admitted atomic.Int32
		var wg sync.WaitGroup
		for range 20 {
			wg.Go(func() {
				wait, err := th.Attempt(t.Context(), ratelimit.Count{Limit: limit, Subject: subject(t)})
				if err != nil {
					t.Error(err)
					return
				}
				if wait == 0 {
					admitted.Add(1)
				}
			})
		}
		wg.Wait()
		if admitted.Load() != 5 {
			t.Fatalf("%s: %d admitted, want 5", limit.Name, admitted.Load())
		}
	}
}

// An attempt one of its limits refuses is counted by none of them, and the wait is the longest.
func TestAnAttemptIsCountedByAllItsLimitsOrNone(t *testing.T) {
	th := throttles(t, newClock())
	open := ratelimit.Limit{Name: "test.open", Max: 3, Window: time.Hour}
	full := ratelimit.Limit{Name: "test.full", Max: 1, Window: 30 * time.Minute}
	attempt(t, th, full, subject(t))
	wait, err := th.Attempt(t.Context(), ratelimit.Count{Limit: open, Subject: subject(t)}, ratelimit.Count{Limit: full, Subject: subject(t)})
	if err != nil || wait != 30*time.Minute {
		t.Fatalf("waits %v, %v; want the 30 minutes left of the full limit's window", wait, err)
	}
	for range open.Max {
		attempt(t, th, open, subject(t))
	}
	if wait, _ := th.Blocked(t.Context(), open, subject(t)); wait != time.Hour {
		t.Fatalf("the refused attempt was counted: blocked for %v after %d more", wait, open.Max)
	}
}

// A refund takes back an attempt that succeeded, and never counts below none.
func TestARefundTakesAnAttemptBack(t *testing.T) {
	th := throttles(t, newClock())
	limit := ratelimit.Limit{Name: "test.refund", Max: 2, Window: time.Hour}
	for range limit.Max {
		attempt(t, th, limit, subject(t))
	}
	if err := th.Refund(t.Context(), limit, subject(t)); err != nil {
		t.Fatal(err)
	}
	attempt(t, th, limit, subject(t))
	if wait, _ := th.Blocked(t.Context(), limit, subject(t)); wait != time.Hour {
		t.Fatalf("blocked for %v, want an hour", wait)
	}
	for range limit.Max + 1 {
		if err := th.Refund(t.Context(), limit, subject(t)); err != nil {
			t.Fatal(err)
		}
	}
	for range limit.Max {
		attempt(t, th, limit, subject(t))
	}
}

func TestABucketAllowsItsBurstThenRefills(t *testing.T) {
	c := newClock()
	b := ratelimit.NewBuckets(ratelimit.Rate{PerMinute: 60, Burst: 3}, c.now)
	for i := range 3 {
		if wait := b.Take("jana"); wait != 0 {
			t.Fatalf("request %d waits %v", i+1, wait)
		}
	}
	if wait := b.Take("jana"); wait != time.Second {
		t.Fatalf("the fourth request waits %v, want a second", wait)
	}
	if wait := b.Take("petr"); wait != 0 {
		t.Fatalf("another key waits %v", wait)
	}
	c.advance(500 * time.Millisecond)
	if wait := b.Take("jana"); wait != 500*time.Millisecond {
		t.Fatalf("half a second later: %v", wait)
	}
	c.advance(500 * time.Millisecond)
	if wait := b.Take("jana"); wait != 0 {
		t.Fatalf("a second later: %v", wait)
	}
	// Long idle, the bucket is full again, and no fuller.
	c.advance(time.Hour)
	for range 3 {
		if wait := b.Take("jana"); wait != 0 {
			t.Fatal("an idle bucket did not refill")
		}
	}
	if wait := b.Take("jana"); wait == 0 {
		t.Fatal("an idle bucket filled past its burst")
	}
}

func TestTheMiddlewareRefusesWithRetryAfter(t *testing.T) {
	c := newClock()
	b := ratelimit.NewBuckets(ratelimit.Rate{PerMinute: 6, Burst: 1}, c.now)
	h := ratelimit.Middleware(b, func(r *http.Request) (string, bool) {
		k := r.Header.Get("X-Key")
		return k, k != ""
	})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	serve := func(key string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
		if key != "" {
			req.Header.Set("X-Key", key)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := serve("a"); rec.Code != http.StatusNoContent {
		t.Fatal(rec.Code)
	}
	rec := serve("a")
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "10" ||
		rec.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("%d %v %s", rec.Code, rec.Header(), rec.Body)
	}
	for range 3 {
		if rec := serve(""); rec.Code != http.StatusNoContent {
			t.Fatal("a request the limit does not count was refused")
		}
	}
}

func TestARefusalWaitsAtLeastASecond(t *testing.T) {
	for wait, want := range map[time.Duration]string{0: "1", 10 * time.Millisecond: "1", 1500 * time.Millisecond: "2", time.Hour: "3600"} {
		if got := ratelimit.Refusal(wait).Header.Get("Retry-After"); got != want {
			t.Errorf("%v: Retry-After %s, want %s", wait, got, want)
		}
	}
}
