package ratelimit_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
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

// subjects are the tests' subjects, each made the first time its test asks for it.
var subjects sync.Map

// subject is a subject no other test counts under, nor an earlier run of this one: the runs of a
// process share its database, and the rows a run leaves behind stay there.
func subject(t *testing.T) string {
	s, _ := subjects.LoadOrStore(t, t.Name()+" "+idgen.New().String())
	name, _ := s.(string)
	return name
}

// count is subject as l counts it.
func count(l ratelimit.Limit, subject string) ratelimit.Count {
	return ratelimit.Count{Limit: l, Subject: subject}
}

func TestTakeAdmitsMaxAttemptsAWindow(t *testing.T) {
	c := newClock()
	th := throttles(t, c)
	limit := ratelimit.Limit{Name: "test.take", Max: 3, Window: time.Hour}
	for i := range 3 {
		if wait, err := th.Take(t.Context(), count(limit, subject(t))); err != nil || wait != 0 {
			t.Fatalf("attempt %d: %v, %v", i+1, wait, err)
		}
		c.advance(time.Minute)
	}
	wait, err := th.Take(t.Context(), count(limit, subject(t)))
	if err != nil || wait != 57*time.Minute {
		t.Fatalf("the fourth attempt waits %v, %v; want the 57 minutes left of the window", wait, err)
	}
	if wait, err := th.Blocked(t.Context(), limit, subject(t)); err != nil || wait != 57*time.Minute {
		t.Fatalf("blocked for %v, %v", wait, err)
	}
	// Another subject, and another limit, count apart.
	if wait, err := th.Take(t.Context(), count(limit, subject(t)+" else")); err != nil || wait != 0 {
		t.Fatalf("another subject: %v, %v", wait, err)
	}
	if wait, err := th.Take(t.Context(), count(ratelimit.Limit{Name: "test.other", Max: 1, Window: time.Hour}, subject(t))); err != nil || wait != 0 {
		t.Fatalf("another limit: %v, %v", wait, err)
	}
	c.advance(57 * time.Minute)
	if wait, err := th.Take(t.Context(), count(limit, subject(t))); err != nil || wait != 0 {
		t.Fatalf("a new window: %v, %v", wait, err)
	}
}

// A take one of its limits refuses is counted by none of them, and the wait is the longest: a
// resend the hour refuses leaves the minute's count as it was.
func TestATakeIsCountedByAllItsLimitsOrNone(t *testing.T) {
	c := newClock()
	th := throttles(t, c)
	minute := ratelimit.Limit{Name: "test.take_minute", Max: 1, Window: time.Minute}
	hour := ratelimit.Limit{Name: "test.take_hour", Max: 2, Window: time.Hour}
	take := func() time.Duration {
		t.Helper()
		wait, err := th.Take(t.Context(), count(minute, subject(t)), count(hour, subject(t)))
		if err != nil {
			t.Fatal(err)
		}
		return wait
	}
	for range hour.Max {
		if wait := take(); wait != 0 {
			t.Fatalf("refused within both limits: %v", wait)
		}
		c.advance(time.Minute)
	}
	if wait := take(); wait != 58*time.Minute {
		t.Fatalf("waits %v; want the 58 minutes left of the hour", wait)
	}
	if wait, _ := th.Blocked(t.Context(), minute, subject(t)); wait != 0 {
		t.Fatalf("the refused take was counted by the minute: blocked for %v", wait)
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
			wait, err := th.Take(t.Context(), count(limit, subject(t)))
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

// However long the failures go on, each past the Max blocks, for no longer than MaxBackoff: a
// minute doubled 28 times overflowed, and the 38th failure in a row blocked for nothing.
func TestFailuresLongPastTheMaxStillBlock(t *testing.T) {
	c := newClock()
	th := throttles(t, c)
	limit := ratelimit.LoginAccount
	for i := range limit.Max + 70 {
		attempt(t, th, limit, subject(t))
		wait, err := th.Blocked(t.Context(), limit, subject(t))
		if err != nil {
			t.Fatal(err)
		}
		if i+1 >= limit.Max && (wait <= 0 || wait > limit.MaxBackoff) {
			t.Fatalf("failure %d blocks for %v", i+1, wait)
		}
		// The next failure comes the moment the block ends, never quiet for long enough to restart.
		c.advance(wait)
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

// An attempt a limit already refuses writes nothing: a client past its network's limit adds no row
// for each new address it names, whether its surface takes or counts failures.
func TestARefusedAttemptKeepsNoNewSubject(t *testing.T) {
	th := throttles(t, newClock())
	full := ratelimit.Limit{Name: "test.full_network", Max: 1, Window: time.Hour}
	open := ratelimit.Limit{Name: "test.open_address", Max: 10, Window: time.Hour}
	attempt(t, th, full, subject(t))
	for name, try := range map[string]func(...ratelimit.Count) (time.Duration, error){
		"attempt": func(c ...ratelimit.Count) (time.Duration, error) { return th.Attempt(t.Context(), c...) },
		"take":    func(c ...ratelimit.Count) (time.Duration, error) { return th.Take(t.Context(), c...) },
	} {
		for i := range 3 {
			fresh := fmt.Sprintf("%s %s %d", subject(t), name, i)
			if wait, err := try(count(full, subject(t)), count(open, fresh)); err != nil || wait != time.Hour {
				t.Fatalf("%s %d: waits %v, %v; want the hour of the full limit", name, i, wait, err)
			}
			if kept, err := th.Kept(t.Context(), open, fresh); err != nil || kept {
				t.Fatalf("%s %d: the refused attempt kept a row for its new subject (%v)", name, i, err)
			}
		}
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

// hooked is a pool whose transactions call after once the statement that claims a subject's row
// has run: the moment between an attempt's claim of its row and its read of it.
type hooked struct {
	ratelimit.Beginner
	after func()
}

func (h hooked) BeginTx(ctx context.Context, options pgx.TxOptions) (pgx.Tx, error) {
	tx, err := h.Beginner.BeginTx(ctx, options)
	if err != nil {
		return nil, err
	}
	return hookedTx{Tx: tx, after: h.after}, nil
}

type hookedTx struct {
	pgx.Tx
	after func()
}

// claims reports whether sql is the statement that claims a subject's row.
func claims(sql string) bool { return strings.Contains(sql, "INSERT INTO auth_throttles") }

func (t hookedTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	tag, err := t.Tx.Exec(ctx, sql, args...)
	if claims(sql) {
		t.after()
	}
	return tag, err
}

func (t hookedTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	row := t.Tx.QueryRow(ctx, sql, args...)
	if !claims(sql) {
		return row
	}
	return hookedRow{Row: row, after: t.after}
}

type hookedRow struct {
	pgx.Row
	after func()
}

func (r hookedRow) Scan(dest ...any) error {
	err := r.Row.Scan(dest...)
	r.after()
	return err
}

// A success that clears a subject's count while another attempt at it is claiming its row, a
// sign-in submitted twice for instance, fails neither: the attempt counts on a row of its own. A
// row made with one statement and read with another could be gone by the read, and the attempt
// answered 500.
func TestAClearDuringAnAttemptFailsNeither(t *testing.T) {
	c := newClock()
	pool := testsupport.Open(t).Pool(t, db.RoleApp)
	plain := ratelimit.NewThrottles(pool, c.now)
	limit := ratelimit.Limit{Name: "test.cleared", Max: 5, Window: time.Hour, Backoff: time.Minute, MaxBackoff: time.Hour}
	attempt(t, plain, limit, subject(t))

	cleared := make(chan error, 1)
	var once sync.Once
	th := ratelimit.NewThrottles(hooked{Beginner: pool, after: func() {
		once.Do(func() {
			go func() { cleared <- plain.Clear(context.WithoutCancel(t.Context()), limit, subject(t)) }()
			// A clear that nothing holds back lands at once; one the claimed row's lock holds waits
			// for the attempt to commit.
			select {
			case err := <-cleared:
				cleared <- err
			case <-time.After(200 * time.Millisecond):
			}
		})
	}}, c.now)
	if wait, err := th.Attempt(t.Context(), count(limit, subject(t))); err != nil || wait != 0 {
		t.Fatalf("an attempt beside a clear: %v, %v", wait, err)
	}
	if err := <-cleared; err != nil {
		t.Fatal(err)
	}
	if kept, err := plain.Kept(t.Context(), limit, subject(t)); err != nil || kept {
		t.Fatalf("the clear did not land after the attempt (%v)", err)
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

// A bucket a nanosecond short of its next token has none to give: at 600 a minute its wait comes
// to a fraction of a nanosecond, which is still a wait, not a token taken.
func TestABucketJustShortOfATokenWaits(t *testing.T) {
	c := newClock()
	b := ratelimit.NewBuckets(ratelimit.PerUser, c.now)
	for range int(ratelimit.PerUser.Burst) {
		if wait := b.Take("jana"); wait != 0 {
			t.Fatalf("within the burst: waits %v", wait)
		}
	}
	c.advance(100*time.Millisecond - time.Nanosecond)
	if wait := b.Take("jana"); wait <= 0 {
		t.Fatalf("a token taken a nanosecond before the bucket had one: waits %v", wait)
	}
	c.advance(time.Microsecond)
	if wait := b.Take("jana"); wait != 0 {
		t.Fatalf("the token that arrived: waits %v", wait)
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

// The expiry sweep deletes a throttle's row a day after its block ended (Sweep), which changes nothing
// only while no limit counts over a longer window: a limit with a longer one moves Forgotten with it.
func TestNoLimitOutlivesWhatTheSweepForgets(t *testing.T) {
	for _, l := range []ratelimit.Limit{
		ratelimit.LoginAccount, ratelimit.LoginNetwork, ratelimit.RegisterNetwork, ratelimit.RegisterNote,
		ratelimit.ResetAccount, ratelimit.ResendMinute, ratelimit.ResendHour, ratelimit.ResetNetwork,
		ratelimit.ResendNetwork, ratelimit.MFAAccount, ratelimit.OAuthStartNetwork, ratelimit.InvitationHousehold,
		ratelimit.ChildCodeNetwork,
	} {
		if l.Window > ratelimit.Forgotten {
			t.Errorf("%s counts over %s, longer than the %s the sweep keeps its rows past their block", l.Name, l.Window, ratelimit.Forgotten)
		}
	}
}
