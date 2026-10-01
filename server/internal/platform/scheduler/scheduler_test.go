package scheduler_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/localtime"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/scheduler"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

func TestMain(m *testing.M) { testsupport.Main(m) }

// The tests share the package's database, and with it the one lead: none runs in parallel, and each
// gives the lead up before it ends.

// clock is a time a test moves by hand.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

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

// name is a job name no other test, nor an earlier run of this one, has used.
func name() string { return "test.job_" + strings.ReplaceAll(idgen.New().String(), "-", "_") }

func instance(t *testing.T, c *clock, jobs ...scheduler.Job) *scheduler.Scheduler {
	t.Helper()
	s, err := scheduler.New(scheduler.Config{
		Pool: testsupport.Open(t).Pool(t, db.RoleApp), Log: logging.New(io.Discard, slog.LevelDebug), Now: c.now, Retry: time.Minute,
	}, jobs...)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		s.Wait()
		s.Resign(context.Background())
	})
	return s
}

func tick(s ...*scheduler.Scheduler) {
	for _, one := range s {
		one.Tick(context.Background())
		one.Wait()
	}
}

func TestTwoInstancesFireAJobOnce(t *testing.T) {
	c := &clock{t: time.Date(2026, 10, 1, 12, 0, 30, 0, time.UTC)}
	var runs atomic.Int32
	job := scheduler.Job{Name: name(), Cadence: scheduler.Every(time.Hour), Run: func(context.Context) error {
		runs.Add(1)
		return nil
	}}
	a, b := instance(t, c, job), instance(t, c, job)

	tick(a, b)
	if !a.Leading() || b.Leading() {
		t.Fatalf("leading: a %v, b %v; want a alone", a.Leading(), b.Leading())
	}
	if n := runs.Load(); n != 0 {
		t.Fatalf("a job seen for the first time ran before its first slot: %d", n)
	}

	c.advance(time.Hour)
	tick(a, b, a, b)
	if n := runs.Load(); n != 1 {
		t.Fatalf("the slot fired %d times; want once", n)
	}

	// The leader goes; the other takes the lead, and does not fire the slot again.
	a.Resign(context.Background())
	tick(b, a)
	if !b.Leading() || a.Leading() {
		t.Fatalf("leading after a resigned: a %v, b %v; want b alone", a.Leading(), b.Leading())
	}
	if n := runs.Load(); n != 1 {
		t.Fatalf("the new leader fired the old slot: %d runs", n)
	}
	c.advance(time.Hour)
	tick(a, b, a, b)
	if n := runs.Load(); n != 2 {
		t.Fatalf("the next slot fired %d times in all; want 2", n)
	}
}

// The leader's connection is no longer the pool's: held for as long as it leads, it leaves the pool
// every connection it may make for the requests and the workers.
func TestTheLeadersConnectionIsNotThePools(t *testing.T) {
	c := &clock{t: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)}
	pool := testsupport.Open(t).Pool(t, db.RoleApp)
	s, err := scheduler.New(scheduler.Config{Pool: pool, Log: logging.New(io.Discard, slog.LevelDebug), Now: c.now})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Resign(context.Background()) })
	tick(s)
	if !s.Leading() {
		t.Fatal("it does not lead")
	}
	if n := pool.Stat().AcquiredConns(); n != 0 {
		t.Fatalf("the pool counts %d connections taken while it leads", n)
	}
}

// Two instances that both believe they lead, as one whose connection the database gave up on may for
// a moment, still fire a slot once.
func TestTwoLeadersStillFireASlotOnce(t *testing.T) {
	c := &clock{t: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)}
	job := scheduler.Job{Name: name(), Cadence: scheduler.Every(time.Hour), Run: func(context.Context) error { return nil }}
	s := instance(t, c, job)
	// The first tick registers the job, due at its first slot after now.
	tick(s)
	if took, err := s.Take(t.Context(), job, c.now()); err != nil || took {
		t.Fatalf("a slot was taken before it was due: %v, %v", took, err)
	}
	due := c.now().Add(time.Hour)
	var (
		wg    sync.WaitGroup
		taken atomic.Int32
	)
	for range 8 {
		wg.Go(func() {
			took, err := s.Take(context.Background(), job, due)
			if err != nil {
				t.Error(err)
			}
			if took {
				taken.Add(1)
			}
		})
	}
	wg.Wait()
	if n := taken.Load(); n != 1 {
		t.Fatalf("the slot was taken %d times; want once", n)
	}
}

// A leader whose connection is gone has lost its lock with its session: the other instance takes the
// lead, and the old leader, finding its connection dead, does not believe it still leads.
func TestALeaderWhoseConnectionDiesLosesTheLead(t *testing.T) {
	c := &clock{t: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)}
	a, b := instance(t, c), instance(t, c)
	tick(a)
	if !a.Leading() {
		t.Fatal("a does not lead")
	}
	admin := testsupport.Open(t).Pool(t, "")
	if _, err := admin.Exec(t.Context(), `
		SELECT pg_terminate_backend(l.pid) FROM pg_locks l
		WHERE l.locktype = 'advisory' AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`); err != nil {
		t.Fatal(err)
	}
	// The server ends the session as it can: wait for the lock to go with it.
	for deadline := time.Now().Add(5 * time.Second); ; {
		var held bool
		if err := admin.QueryRow(t.Context(), `
			SELECT EXISTS (SELECT FROM pg_locks WHERE locktype = 'advisory'
			  AND database = (SELECT oid FROM pg_database WHERE datname = current_database()))`).Scan(&held); err != nil {
			t.Fatal(err)
		}
		if !held {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the lock outlived its session")
		}
		time.Sleep(10 * time.Millisecond)
	}
	tick(b, a)
	if !b.Leading() || a.Leading() {
		t.Fatalf("leading: a %v, b %v; want b alone", a.Leading(), b.Leading())
	}
}

func TestAFailedJobIsTriedAgainBeforeItsNextSlot(t *testing.T) {
	c := &clock{t: time.Date(2026, 10, 1, 0, 30, 0, 0, time.UTC)}
	var runs atomic.Int32
	job := scheduler.Job{Name: name(), Cadence: scheduler.Daily(mustClock(t, "01:00")), Run: func(context.Context) error {
		if runs.Add(1) == 1 {
			return errors.New("the first run fails")
		}
		return nil
	}}
	s := instance(t, c, job)
	tick(s)
	c.advance(time.Hour) // 01:30: the 01:00 slot is due.
	tick(s)
	if n := runs.Load(); n != 1 {
		t.Fatalf("runs: %d; want 1", n)
	}
	c.advance(30 * time.Second)
	tick(s)
	if n := runs.Load(); n != 1 {
		t.Fatalf("the failed job ran again before its retry: %d runs", n)
	}
	c.advance(time.Minute) // Past Retry, a day before its next slot.
	tick(s)
	if n := runs.Load(); n != 2 {
		t.Fatalf("the failed job was not tried again: %d runs", n)
	}
	c.advance(time.Hour)
	tick(s)
	if n := runs.Load(); n != 2 {
		t.Fatalf("a job that ran after its retry ran again before its next slot: %d runs", n)
	}
}

func TestAPanickingJobFailsAndTheOthersRun(t *testing.T) {
	c := &clock{t: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)}
	var ran atomic.Bool
	panics := scheduler.Job{Name: name(), Cadence: scheduler.Every(time.Hour), Run: func(context.Context) error { panic("boom") }}
	fine := scheduler.Job{Name: name(), Cadence: scheduler.Every(time.Hour), Run: func(context.Context) error {
		ran.Store(true)
		return nil
	}}
	s := instance(t, c, panics, fine)
	tick(s)
	c.advance(time.Hour)
	tick(s)
	if !ran.Load() {
		t.Fatal("the job beside a panicking one did not run")
	}
	var failed bool
	if err := testsupport.Open(t).Pool(t, "").QueryRow(t.Context(),
		"SELECT last_failed_at IS NOT NULL FROM scheduler_jobs WHERE name = $1", panics.Name).Scan(&failed); err != nil {
		t.Fatal(err)
	}
	if !failed {
		t.Fatal("the panic was not recorded as a failure")
	}
}

func TestAJobStillRunningIsNotStartedAgain(t *testing.T) {
	c := &clock{t: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)}
	var runs atomic.Int32
	release := make(chan struct{})
	job := scheduler.Job{Name: name(), Cadence: scheduler.Every(time.Minute), Run: func(context.Context) error {
		runs.Add(1)
		<-release
		return nil
	}}
	s := instance(t, c, job)
	s.Tick(t.Context())
	c.advance(time.Minute)
	s.Tick(t.Context())
	c.advance(time.Minute)
	s.Tick(t.Context())
	close(release)
	s.Wait()
	if n := runs.Load(); n != 1 {
		t.Fatalf("runs: %d; want 1 while the first was running", n)
	}
	c.advance(time.Minute)
	tick(s)
	if n := runs.Load(); n != 2 {
		t.Fatalf("runs: %d; want 2 once the first had ended", n)
	}
}

func TestCadences(t *testing.T) {
	at := func(s string) time.Time {
		v, err := time.Parse(time.RFC3339, s)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	for _, tc := range []struct {
		c        scheduler.Cadence
		from, to string
	}{
		{scheduler.Every(15 * time.Minute), "2026-10-01T12:07:00Z", "2026-10-01T12:15:00Z"},
		{scheduler.Every(15 * time.Minute), "2026-10-01T12:15:00Z", "2026-10-01T12:30:00Z"},
		{scheduler.Every(time.Hour), "2026-10-01T23:59:59Z", "2026-10-02T00:00:00Z"},
		// UTC's clock, which no DST moves, from wherever the instance runs.
		{scheduler.Daily(mustClock(t, "01:00")), "2026-10-01T00:59:00Z", "2026-10-01T01:00:00Z"},
		{scheduler.Daily(mustClock(t, "01:00")), "2026-10-01T01:00:00Z", "2026-10-02T01:00:00Z"},
		{scheduler.Daily(mustClock(t, "01:00")), "2026-10-25T02:30:00+02:00", "2026-10-25T01:00:00Z"},
		{scheduler.Daily(mustClock(t, "01:00")), "2026-10-25T03:30:00+02:00", "2026-10-26T01:00:00Z"},
	} {
		if got := scheduler.Next(tc.c, at(tc.from)); !got.Equal(at(tc.to)) {
			t.Errorf("%s after %s: %s; want %s", tc.c, tc.from, got.UTC().Format(time.RFC3339), tc.to)
		}
	}
}

func TestAJobIsNamedAndRegisteredOnce(t *testing.T) {
	ok := func(context.Context) error { return nil }
	pool := testsupport.Open(t).Pool(t, db.RoleApp)
	log := logging.New(io.Discard, slog.LevelDebug)
	for _, jobs := range [][]scheduler.Job{
		{{Name: "Expiry", Cadence: scheduler.Every(time.Hour), Run: ok}},
		{{Name: "a.b", Cadence: scheduler.Every(time.Hour), Run: ok}, {Name: "a.b", Cadence: scheduler.Every(time.Hour), Run: ok}},
		{{Name: "a.b", Run: ok}},
		{{Name: "a.b", Cadence: scheduler.Every(time.Second), Run: ok}},
	} {
		if _, err := scheduler.New(scheduler.Config{Pool: pool, Log: log}, jobs...); err == nil {
			t.Errorf("New took %+v", jobs)
		}
	}
}

func mustClock(t *testing.T, s string) localtime.Clock {
	t.Helper()
	c, err := localtime.ParseClock(s)
	if err != nil {
		t.Fatal(err)
	}
	return c
}
