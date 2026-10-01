// Package scheduler fires the platform's jobs on their cadence (PRD 03 §5): the nightly storage
// sample and the sweeps after it, the expiry sweep, the hourly expiry of tokens and invitations, and
// whatever a later item registers, such as item 16's hourly trial transitions and item 53's digests.
// Modules register jobs; the platform owns the timing.
//
// Every instance of the API runs a scheduler, and one leads: the one holding a PostgreSQL advisory
// lock, on a connection it takes out of the pool and keeps for as long as it leads, so that the pool
// makes another for the requests and the workers in its place. Only the leader fires jobs, and an
// instance that stops leading, whose process ended or whose connection the database gave up on,
// releases the lock with its session, for another to take at its next tick. A job's due time is kept in
// scheduler_jobs, not in the leader's memory, so that a leader taking over fires what the last one
// left due and nothing it fired already. Each slot is taken by moving its due time past it, in an
// UPDATE that matches only while the slot is still due: for the moment two instances may both
// believe they lead, one whose connection is gone without its noticing yet, PostgreSQL serialises the
// two UPDATEs on the row, and the second matches nothing. So a slot fires once.
//
// A job that fails is tried again after Config.Retry, or at its next slot when that comes first, and
// one that panics is recovered and counted as failed. Timing is a slot's, not an appointment's: a
// slot missed while no instance led fires once when one does, and the slots it missed are not made
// up. A job that runs past its next slot is not started again until it has ended.
package scheduler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/localtime"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// lockKey is the advisory lock the leader holds. An advisory lock is the database's, so each
// database has a leader of its own.
const lockKey int64 = 0x686f757365686f6c // "househol"

// recordWithin bounds what the scheduler writes past its context's end: how a job a shutdown stopped
// ended, and the lead it gives up. A database that does not answer then holds the process no longer.
const recordWithin = 10 * time.Second

// detached is ctx past its end, for recordWithin.
func detached(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), recordWithin)
}

// Cadence says when a job falls due.
type Cadence interface {
	// next returns the job's first slot after t.
	next(t time.Time) time.Time
	fmt.Stringer
}

type every time.Duration

// Every is a slot every d, counted in UTC from the zero time, so that every instance computes the
// same slots: for a d that divides an hour, every hour on the hour, every fifteen minutes at :00,
// :15, :30 and :45.
func Every(d time.Duration) Cadence { return every(d) }

func (e every) next(t time.Time) time.Time {
	d := time.Duration(e)
	return t.UTC().Truncate(d).Add(d)
}

func (e every) String() string { return "every " + time.Duration(e).String() }

type daily localtime.Clock

// Daily is a slot once a day, at c in UTC: a job that belongs to no household's day, such as the
// usage sample, whose day is UTC's (D-109). A job about a household's own day runs every minute or
// every hour and resolves each household's time itself (localtime).
func Daily(c localtime.Clock) Cadence { return daily(c) }

func (d daily) next(t time.Time) time.Time {
	return localtime.Next(t, localtime.Clock(d), time.UTC)
}

func (d daily) String() string { return "daily at " + localtime.Clock(d).String() + " UTC" }

// Job is a registered job.
type Job struct {
	// Name names it in scheduler_jobs and in the log: lowercase words joined by dots.
	Name    string
	Cadence Cadence
	// Run runs it, until ctx ends. An error is logged and makes the job's next try come sooner.
	Run func(ctx context.Context) error
}

var jobName = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`)

// Pool is what the scheduler needs of its database: transactions, as the request role, and a
// connection to hold the lock on, which a leader takes out of the pool (pgxpool.Conn.Hijack).
type Pool interface {
	tenant.Beginner
	Acquire(ctx context.Context) (*pgxpool.Conn, error)
}

// Config is what the scheduler needs.
type Config struct {
	// Pool is the database, connected as the request role.
	Pool Pool
	Log  *slog.Logger
	// Tick is how often an instance looks for a lead and for jobs due, 15 seconds when zero.
	Tick time.Duration
	// Retry is how soon a failed job is tried again, at the latest at its next slot: 15 minutes when
	// zero.
	Retry time.Duration
	// Now is the clock, time.Now when nil.
	Now func() time.Time
}

// Scheduler fires the jobs registered with it while its instance leads.
type Scheduler struct {
	cfg  Config
	jobs []Job
	// instance names this scheduler in the log.
	instance uuid.UUID

	// leading serialises taking, checking and giving up the lead, which talk to the database; mu
	// guards what the jobs and Leading read, and is never held while the database is waited for.
	leading sync.Mutex
	mu      sync.Mutex
	// conn is the leader's connection, its own and no longer the pool's, nil while it does not lead.
	conn    *pgx.Conn
	running map[string]bool
	// registered is whether every job was found registered in scheduler_jobs (due).
	registered bool
	wg         sync.WaitGroup
}

// New returns a scheduler of jobs, each named once.
func New(cfg Config, jobs ...Job) (*Scheduler, error) {
	if cfg.Pool == nil || cfg.Log == nil {
		return nil, errors.New("scheduler: a pool and a log are needed")
	}
	if cfg.Tick <= 0 {
		cfg.Tick = 15 * time.Second
	}
	if cfg.Retry <= 0 {
		cfg.Retry = 15 * time.Minute
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	seen := map[string]bool{}
	for _, j := range jobs {
		switch {
		case !jobName.MatchString(j.Name):
			return nil, fmt.Errorf("scheduler: job name %q is not lowercase words joined by dots", j.Name)
		case seen[j.Name]:
			return nil, fmt.Errorf("scheduler: job %s is registered twice", j.Name)
		case j.Cadence == nil || j.Run == nil:
			return nil, fmt.Errorf("scheduler: job %s has no cadence or nothing to run", j.Name)
		}
		if e, ok := j.Cadence.(every); ok && time.Duration(e) < time.Minute {
			return nil, fmt.Errorf("scheduler: job %s runs more often than once a minute", j.Name)
		}
		seen[j.Name] = true
	}
	return &Scheduler{cfg: cfg, jobs: jobs, instance: uuid.New(), running: map[string]bool{}}, nil
}

// Run ticks until ctx ends, then waits for the jobs it started to end, which ctx's end tells to, and
// gives up the lead.
func (s *Scheduler) Run(ctx context.Context) {
	ticker := time.NewTicker(s.cfg.Tick)
	defer ticker.Stop()
	for {
		s.Tick(ctx)
		select {
		case <-ctx.Done():
			s.wg.Wait()
			resigning, cancel := detached(ctx)
			s.Resign(resigning)
			cancel()
			return
		case <-ticker.C:
		}
	}
}

// Tick takes the lead if no instance holds it, and, leading, starts each job due that is not
// running already. It returns once the jobs are started, not ended (Wait).
func (s *Scheduler) Tick(ctx context.Context) {
	if ctx.Err() != nil || !s.lead(ctx) {
		return
	}
	now := s.cfg.Now()
	due, err := s.due(ctx, now)
	if err != nil {
		if ctx.Err() == nil {
			s.cfg.Log.LogAttrs(ctx, slog.LevelError, "scheduler: read the jobs due", slog.Any("error", err))
		}
		return
	}
	for _, j := range s.jobs {
		if !due[j.Name] || !s.start(j.Name) {
			continue
		}
		took, err := s.take(ctx, j, now)
		if err != nil || !took {
			if err != nil && ctx.Err() == nil {
				s.cfg.Log.LogAttrs(ctx, slog.LevelError, "scheduler: take a job's slot", slog.String("job", j.Name), slog.Any("error", err))
			}
			s.finish(j.Name)
			continue
		}
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			defer s.finish(j.Name)
			s.run(ctx, j)
		}()
	}
}

// Wait waits for the jobs started to end.
func (s *Scheduler) Wait() { s.wg.Wait() }

// Leading reports whether this instance holds the lead.
func (s *Scheduler) Leading() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.conn != nil
}

// Resign gives up the lead, when this instance holds it: it releases the lock, at once for another
// instance to take, and closes the connection, whose session's end releases it in any case.
func (s *Scheduler) Resign(ctx context.Context) {
	s.leading.Lock()
	defer s.leading.Unlock()
	s.mu.Lock()
	conn := s.conn
	s.conn = nil
	s.mu.Unlock()
	if conn == nil {
		return
	}
	_, _ = conn.Exec(ctx, "SELECT pg_advisory_unlock($1)", lockKey)
	_ = conn.Close(ctx)
	s.cfg.Log.LogAttrs(ctx, slog.LevelInfo, "scheduler: no longer leading", slog.String("instance", s.instance.String()))
}

// lead reports whether this instance leads, taking the lead when no instance holds it. A leader whose
// connection no longer answers has lost its session, and with it the lock: it drops the connection
// and tries for the lead again. An instance that takes the lead takes the connection it took it on out
// of the pool, which then counts it no longer: held for as long as the instance leads, it would be one
// fewer for the requests and the workers.
func (s *Scheduler) lead(ctx context.Context) bool {
	s.leading.Lock()
	defer s.leading.Unlock()
	s.mu.Lock()
	conn := s.conn
	s.mu.Unlock()
	if conn != nil {
		if err := conn.Ping(ctx); err == nil {
			return true
		}
		s.cfg.Log.LogAttrs(ctx, slog.LevelWarn, "scheduler: lost the lead with its connection", slog.String("instance", s.instance.String()))
		s.mu.Lock()
		s.conn = nil
		s.mu.Unlock()
		closing, cancel := detached(ctx)
		_ = conn.Close(closing)
		cancel()
	}
	pooled, err := s.cfg.Pool.Acquire(ctx)
	if err != nil {
		if ctx.Err() == nil {
			s.cfg.Log.LogAttrs(ctx, slog.LevelError, "scheduler: connect to take the lead", slog.Any("error", err))
		}
		return false
	}
	var took bool
	if err := pooled.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", lockKey).Scan(&took); err != nil || !took {
		pooled.Release()
		return false
	}
	conn = pooled.Hijack()
	s.mu.Lock()
	s.conn = conn
	s.mu.Unlock()
	s.cfg.Log.LogAttrs(ctx, slog.LevelInfo, "scheduler: leading", slog.String("instance", s.instance.String()))
	return true
}

// start marks job running, and reports false when it was already.
func (s *Scheduler) start(job string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running[job] {
		return false
	}
	s.running[job] = true
	return true
}

func (s *Scheduler) finish(job string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.running, job)
}

// due returns the jobs whose slot is due at now, in one read: a leader reads every tick, and writes
// only when it takes a slot. It registers first the jobs it has not found registered yet, each due at
// its first slot after now, which it does once, or again for a job whose row has gone.
func (s *Scheduler) due(ctx context.Context, now time.Time) (map[string]bool, error) {
	s.mu.Lock()
	registered := s.registered
	s.mu.Unlock()
	names := make([]string, len(s.jobs))
	for i, j := range s.jobs {
		names[i] = j.Name
	}
	due := make(map[string]bool, len(s.jobs))
	err := tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
		if !registered {
			for _, j := range s.jobs {
				if _, err := tx.Exec(ctx, "INSERT INTO scheduler_jobs (name, next_run_at) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
					j.Name, j.Cadence.next(now)); err != nil {
					return err
				}
			}
		}
		rows, err := tx.Query(ctx, "SELECT name, next_run_at <= $2 FROM scheduler_jobs WHERE name = ANY($1)", names, now)
		if err != nil {
			return err
		}
		var (
			name  string
			isDue bool
		)
		_, err = pgx.ForEachRow(rows, []any{&name, &isDue}, func() error {
			due[name] = isDue
			return nil
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.registered = len(due) == len(s.jobs)
	s.mu.Unlock()
	return due, nil
}

// take takes j's slot when one is due at now, moving its due time to its next slot, and reports
// whether it did. A job whose row is gone takes nothing, and due registers it again.
func (s *Scheduler) take(ctx context.Context, j Job, now time.Time) (bool, error) {
	took := false
	err := tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE scheduler_jobs SET next_run_at = $3, last_started_at = $2
			WHERE name = $1 AND next_run_at <= $2`, j.Name, now, j.Cadence.next(now))
		took = err == nil && tag.RowsAffected() == 1
		return err
	})
	return took, err
}

// run runs j, recovering a panic, and records how it ended: a failure makes its next try come after
// Retry, unless its next slot comes first.
func (s *Scheduler) run(ctx context.Context, j Job) {
	began := s.cfg.Now()
	err := s.guard(ctx, j)
	ended := s.cfg.Now()
	attrs := []slog.Attr{slog.String("job", j.Name), slog.Duration("took", ended.Sub(began))}
	if err != nil {
		s.cfg.Log.LogAttrs(ctx, slog.LevelError, "scheduler: a job failed", append(attrs, slog.Any("error", err))...)
	} else {
		s.cfg.Log.LogAttrs(ctx, slog.LevelInfo, "scheduler: a job ran", attrs...)
	}
	// Recorded past ctx's end, so that a job a shutdown stopped is tried again soon after.
	record, cancel := detached(ctx)
	defer cancel()
	if rerr := tenant.AccountTx(record, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
		_, err := tx.Exec(record, `
			UPDATE scheduler_jobs SET last_finished_at = $2,
			  last_failed_at = CASE WHEN $3 THEN $2 ELSE last_failed_at END,
			  next_run_at = CASE WHEN $3 THEN least(next_run_at, $4) ELSE next_run_at END
			WHERE name = $1`, j.Name, ended, err != nil, ended.Add(s.cfg.Retry))
		return err
	}); rerr != nil {
		s.cfg.Log.LogAttrs(record, slog.LevelError, "scheduler: record how a job ended", slog.String("job", j.Name), slog.Any("error", rerr))
	}
}

// guard runs j, and turns a panic into an error, logged by its value's type and the stack, never
// the value, which may quote what the job was working on.
func (s *Scheduler) guard(ctx context.Context, j Job) (err error) {
	defer func() {
		if v := recover(); v != nil {
			s.cfg.Log.LogAttrs(ctx, slog.LevelError, "scheduler: a job panicked", slog.String("job", j.Name),
				slog.String("panic", httpx.TypeName(v)), slog.String("stack", logging.Stack()))
			err = errors.New("scheduler: the job panicked")
		}
	}()
	return j.Run(ctx)
}
