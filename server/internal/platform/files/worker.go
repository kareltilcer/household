package files

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// The jobs' timing: a worker that takes a job holds it for lease (Config.Lease), after which another
// may take it as one whose worker died, and the job is stopped then as one that failed; a job that
// failed waits backoff[attempts-1] before it is tried again, and one that failed maxAttempts times is
// given up, its file left download-only.
const (
	lease       = 10 * time.Minute
	maxAttempts = 5
)

var backoff = []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute, 2 * time.Hour}

// job is a file job a worker holds.
type job struct {
	household uuid.UUID
	kind      string
	module    string
	entity    uuid.UUID
	attempts  int
	claim     uuid.UUID
}

// errPermanent marks a failure a retry will not mend: a file that cannot be decoded or converted.
var errPermanent = errors.New("files: the variants cannot be derived")

// errGone is a job's answer when the entity it was for is no longer there: it is done.
var errGone = errors.New("files: the entity is gone")

// Run runs the workers until ctx ends, then waits for the jobs they hold to be released. It looks
// for households with work due when a commit of this instance wakes it (Nudge), and every Poll for
// the rest; each household's jobs are run by one worker at a time, and at most Workers at once.
func (s *Service) Run(ctx context.Context) {
	var running sync.WaitGroup
	slots := make(chan struct{}, s.workers)
	ticker := time.NewTicker(s.poll)
	defer ticker.Stop()
	for {
		households, err := s.due(ctx)
		if err != nil && ctx.Err() == nil {
			s.log.LogAttrs(ctx, slog.LevelError, "files: find the jobs due", slog.Any("error", err))
		}
		for _, h := range households {
			if !s.hold(h) {
				continue
			}
			select {
			case slots <- struct{}{}:
			case <-ctx.Done():
				s.release(h)
				running.Wait()
				return
			}
			running.Add(1)
			go func() {
				defer func() {
					<-slots
					s.release(h)
					running.Done()
				}()
				s.drain(ctx, h)
			}()
		}
		select {
		case <-ctx.Done():
			running.Wait()
			return
		case <-ticker.C:
		case <-s.wake:
		}
	}
}

// hold marks household as one a worker of this instance is draining, and reports false when one
// already is. That worker then looks again once it lets the household go (release): what found the
// household due may be a job committed after the worker's last claim looked, which a worker about to
// stop would otherwise leave to the next poll, however soon its commit woke the workers.
func (s *Service) hold(household uuid.UUID) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, held := s.busy[household]; held {
		s.busy[household] = true
		return false
	}
	s.busy[household] = false
	return true
}

// release lets household go, and wakes the workers when it was found due while it was held.
func (s *Service) release(household uuid.UUID) {
	s.mu.Lock()
	again := s.busy[household]
	delete(s.busy, household)
	s.mu.Unlock()
	if again {
		s.Nudge()
	}
}

// due returns the households with a job due, as the meter role reads them: no one household's
// context can see another's jobs.
func (s *Service) due(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := s.meter.Query(ctx, "SELECT DISTINCT household_id FROM file_jobs WHERE run_at <= now() LIMIT 1000")
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

// drain runs household's jobs due until none is left or ctx ends.
func (s *Service) drain(ctx context.Context, household uuid.UUID) {
	for ctx.Err() == nil {
		j, ok, err := s.claim(ctx, household)
		if err != nil {
			if ctx.Err() == nil {
				s.log.LogAttrs(ctx, slog.LevelError, "files: claim a job", slog.Any("error", err))
			}
			return
		}
		if !ok {
			return
		}
		s.run(ctx, j)
	}
}

// Drain runs household's jobs due now, in the caller's goroutine: what the workers would, for a test
// that waits for it.
func (s *Service) Drain(ctx context.Context, household uuid.UUID) {
	s.drain(ctx, household)
}

// claim takes household's next job due, moving it past its lease.
func (s *Service) claim(ctx context.Context, household uuid.UUID) (job, bool, error) {
	j := job{household: household, claim: idgen.New()}
	found := false
	err := tenant.InWriteTx(s.system(ctx, household), func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			UPDATE file_jobs j SET run_at = now() + make_interval(secs => $2), attempts = j.attempts + 1, claim = $3
			FROM (SELECT kind, module, entity_id FROM file_jobs
			      WHERE household_id = $1 AND run_at <= now()
			      ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED) d
			WHERE j.household_id = $1 AND j.kind = d.kind AND j.module = d.module AND j.entity_id = d.entity_id
			RETURNING j.kind, j.module, j.entity_id, j.attempts`,
			household, s.lease.Seconds(), j.claim).Scan(&j.kind, &j.module, &j.entity, &j.attempts)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		found = err == nil
		return err
	})
	return j, found, err
}

// run runs j and settles it: done, tried again later, or given up.
//
// The job runs for its lease at most, and past it fails as any job does, to be tried again: another
// worker may take it then, and a store that stops answering would otherwise hold this worker for as
// long as the process lives, since the store's client gives up on nothing by itself.
func (s *Service) run(ctx context.Context, j job) {
	running, stop := context.WithTimeout(ctx, s.lease)
	defer stop()
	var err error
	switch j.kind {
	case "variants":
		err = s.derive(running, j)
	case "purge":
		err = s.purge(running, j)
	}
	// The job is settled even when ctx has ended: a job left claimed waits out its lease.
	settle := context.WithoutCancel(ctx)
	switch {
	case err == nil, errors.Is(err, errGone):
		err = s.settle(settle, j, "", 0)
	case ctx.Err() != nil:
		// Stopped by a shutdown, not failed: it runs again at once, its attempt not counted.
		err = s.settle(settle, j, "", -1)
	case errors.Is(err, errPermanent) || j.attempts >= maxAttempts:
		s.log.LogAttrs(ctx, slog.LevelWarn, "files: a job failed for good", slog.String("kind", j.kind),
			slog.String("module", j.module), slog.Any("error", err))
		err = s.settle(settle, j, "failed", 0)
	default:
		s.log.LogAttrs(ctx, slog.LevelWarn, "files: a job failed; it runs again later", slog.String("kind", j.kind),
			slog.String("module", j.module), slog.Int("attempts", j.attempts), slog.Any("error", err))
		err = s.settle(settle, j, "", backoff[min(j.attempts, len(backoff))-1])
	}
	if err != nil {
		s.log.LogAttrs(ctx, slog.LevelError, "files: settle a job", slog.Any("error", err))
	}
}

// settle ends j: with its original's variants marked failed when status says so, and the job
// deleted, when retry is zero; put back at once with its attempt uncounted when retry is negative;
// otherwise run again after retry. A job another worker took meanwhile, once its lease had passed,
// is that worker's to settle.
//
// A job that marks its original takes the original's row before the job's, the order the entity's
// delete takes them in (Remove): the other way round, a job failing for good beside the delete would
// hold the job the delete removes while it waited for the original the delete holds, and PostgreSQL
// would break the deadlock by aborting one of the two, which may be the member's delete.
func (s *Service) settle(ctx context.Context, j job, status string, retry time.Duration) error {
	return tenant.InWriteTx(s.system(ctx, j.household), func(tx pgx.Tx) error {
		if status != "" {
			if _, err := tx.Exec(ctx, `
				SELECT FROM files WHERE household_id = $1 AND module = $2 AND entity_id = $3 AND variant = 'original' FOR UPDATE`,
				j.household, j.module, j.entity); err != nil {
				return err
			}
		}
		switch {
		case retry < 0:
			_, err := tx.Exec(ctx, `
				UPDATE file_jobs SET run_at = now(), attempts = attempts - 1, claim = NULL
				WHERE household_id = $1 AND kind = $2 AND module = $3 AND entity_id = $4 AND claim = $5`,
				j.household, j.kind, j.module, j.entity, j.claim)
			return err
		case retry > 0:
			_, err := tx.Exec(ctx, `
				UPDATE file_jobs SET run_at = now() + make_interval(secs => $6), claim = NULL
				WHERE household_id = $1 AND kind = $2 AND module = $3 AND entity_id = $4 AND claim = $5`,
				j.household, j.kind, j.module, j.entity, j.claim, retry.Seconds())
			return err
		}
		tag, err := tx.Exec(ctx, `
			DELETE FROM file_jobs WHERE household_id = $1 AND kind = $2 AND module = $3 AND entity_id = $4 AND claim = $5`,
			j.household, j.kind, j.module, j.entity, j.claim)
		if err != nil || tag.RowsAffected() == 0 || status == "" {
			return err
		}
		_, err = tx.Exec(ctx, `
			UPDATE files SET variants = $4 WHERE household_id = $1 AND module = $2 AND entity_id = $3 AND variant = 'original'`,
			j.household, j.module, j.entity, status)
		return err
	})
}

// purge deletes the objects of j's entity that no row records: every one, once the mutation that
// deleted the entity has committed.
func (s *Service) purge(ctx context.Context, j job) error {
	recorded := map[string]bool{}
	err := tenant.InTx(s.system(ctx, j.household), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT variant FROM files WHERE household_id = $1 AND module = $2 AND entity_id = $3",
			j.household, j.module, j.entity)
		if err != nil {
			return err
		}
		variants, err := pgx.CollectRows(rows, pgx.RowTo[string])
		for _, v := range variants {
			recorded[v] = true
		}
		return err
	})
	if err != nil {
		return err
	}
	prefix := Key(j.household, j.module, j.entity, "")
	var keys []string
	if err := s.store.List(ctx, prefix, func(o objectstore.Info) error {
		if variant := strings.TrimPrefix(o.Key, prefix); !recorded[variant] {
			keys = append(keys, o.Key)
		}
		return nil
	}); err != nil {
		return err
	}
	return s.store.Delete(ctx, keys...)
}
