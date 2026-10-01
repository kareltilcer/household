-- The scheduler (PRD 03 §5; plan item 15, ADR 0016): the platform's jobs and the time each next falls
-- due. Every instance runs the scheduler, and the one holding its advisory lock is the leader that
-- fires the jobs (internal/platform/scheduler). A job's slot is taken by moving next_run_at past it
-- in a statement that names the slot it moves, so that a slot is fired once even by two instances
-- that both believe they lead, as one whose connection the database has given up on may for a
-- moment. Global: a job is the platform's, and no household's.

-- +goose Up

-- One registered job. next_run_at is when it falls due; the leader that takes the slot moves it to
-- the job's next slot, or sooner after a failure, so that a failed run is tried again before the
-- next one falls due. The last_* columns say what the last run did, for an operator.
CREATE TABLE scheduler_jobs (
  name text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  next_run_at timestamptz NOT NULL,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_failed_at timestamptz
);
