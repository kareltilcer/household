package identity

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

// Background runs work after a response has gone, on a fixed number of goroutines, each job with
// a deadline of its own: sending an email, which should not hold a request open while an SMTP
// server answers, and the lookups whose timing would tell an address with an account from one
// without (D-13). A job is not durable: one queued when the process stops is lost, and its
// email with it, which the person asks for again.
type Background struct {
	log     *slog.Logger
	timeout time.Duration
	jobs    chan job
	wg      sync.WaitGroup

	mu     sync.RWMutex
	closed bool
}

type job struct {
	ctx context.Context
	fn  func(context.Context)
}

// NewBackground starts workers goroutines taking jobs from a queue queue long; a job runs for at
// most timeout.
func NewBackground(log *slog.Logger, workers, queue int, timeout time.Duration) *Background {
	b := &Background{log: log, timeout: timeout, jobs: make(chan job, queue)}
	for range max(workers, 1) {
		b.wg.Go(b.work)
	}
	return b
}

func (b *Background) work() {
	for j := range b.jobs {
		b.run(j)
	}
}

func (b *Background) run(j job) {
	ctx, cancel := context.WithTimeout(j.ctx, b.timeout)
	defer cancel()
	defer func() {
		if v := recover(); v != nil {
			b.log.LogAttrs(ctx, slog.LevelError, "background job panicked", slog.String("panic", typeName(v)))
		}
	}()
	j.fn(ctx)
}

// Run queues fn, to run with ctx's values but not its cancellation: the request that queued it
// has usually ended by then. A job that finds the queue full, or the runner closed, is dropped
// and logged.
func (b *Background) Run(ctx context.Context, fn func(context.Context)) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.closed {
		b.log.LogAttrs(ctx, slog.LevelError, "background job dropped: shutting down")
		return
	}
	select {
	case b.jobs <- job{ctx: context.WithoutCancel(ctx), fn: fn}:
	default:
		b.log.LogAttrs(ctx, slog.LevelError, "background job dropped: queue full")
	}
}

// Close takes no more jobs and waits for those queued to finish, or for ctx to end.
func (b *Background) Close(ctx context.Context) error {
	b.mu.Lock()
	if !b.closed {
		b.closed = true
		close(b.jobs)
	}
	b.mu.Unlock()
	done := make(chan struct{})
	go func() {
		b.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return errors.Join(errors.New("identity: background jobs still running"), ctx.Err())
	}
}
