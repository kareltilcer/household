package identity_test

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/logging"
)

type buffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *buffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}

func (b *buffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.String()
}

// A job runs after the request that queued it has ended, with the request's values but not its
// cancellation, and Close waits for the queue to empty.
func TestAJobOutlivesItsRequest(t *testing.T) {
	b := identity.NewBackground(slog.New(slog.DiscardHandler), 2, 8, time.Second)
	var ran atomic.Int32
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	for range 5 {
		b.Run(ctx, func(ctx context.Context) {
			if ctx.Err() == nil {
				ran.Add(1)
			}
		})
	}
	if err := b.Close(t.Context()); err != nil {
		t.Fatal(err)
	}
	if ran.Load() != 5 {
		t.Fatalf("%d of 5 jobs ran live", ran.Load())
	}
}

// A job that finds the queue full, or the runner closed, is dropped and logged; a job that panics
// is logged and the runner goes on.
func TestADroppedOrPanickingJobIsLogged(t *testing.T) {
	logs := &buffer{}
	b := identity.NewBackground(logging.New(logs, slog.LevelDebug), 1, 1, time.Second)
	release := make(chan struct{})
	started := make(chan struct{})
	b.Run(t.Context(), func(context.Context) { close(started); <-release })
	<-started
	b.Run(t.Context(), func(context.Context) { panic("a job's failure") })
	b.Run(t.Context(), func(context.Context) {})
	close(release)
	if err := b.Close(t.Context()); err != nil {
		t.Fatal(err)
	}
	b.Run(t.Context(), func(context.Context) {})
	out := logs.String()
	for _, want := range []string{"background job dropped: queue full", "background job panicked", "background job dropped: shutting down"} {
		if !strings.Contains(out, want) {
			t.Errorf("no %q in %s", want, out)
		}
	}
	if strings.Contains(out, "a job's failure") {
		t.Errorf("a panic's value was logged: %s", out)
	}
}

// Close gives up waiting when its context ends.
func TestCloseGivesUpWithItsContext(t *testing.T) {
	b := identity.NewBackground(slog.New(slog.DiscardHandler), 1, 1, time.Minute)
	release := make(chan struct{})
	defer close(release)
	b.Run(t.Context(), func(context.Context) { <-release })
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	if err := b.Close(ctx); err == nil {
		t.Fatal("Close returned while a job ran")
	}
}
