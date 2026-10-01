package files

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
)

// woken reports whether s's workers were woken, and takes the wake.
func woken(s *Service) bool {
	select {
	case <-s.wake:
		return true
	default:
		return false
	}
}

// A household found due while a worker drains it is looked at again once the worker lets it go: the
// job that made it due may have committed after the worker's last claim looked, and its commit's
// wake was spent finding the household held. A household nobody asked for again wakes nobody.
func TestAHouseholdFoundDueWhileHeldIsLookedAtAgain(t *testing.T) {
	s := &Service{wake: make(chan struct{}, 1), busy: map[uuid.UUID]bool{}}
	h := idgen.New()

	if !s.hold(h) {
		t.Fatal("a household nobody drains was not held")
	}
	s.release(h, false)
	if woken(s) {
		t.Fatal("letting go of a household nobody asked for again woke the workers")
	}

	if !s.hold(h) {
		t.Fatal("a household let go was not held again")
	}
	if s.hold(h) {
		t.Fatal("a household a worker drains was held twice")
	}
	s.release(h, false)
	if !woken(s) {
		t.Fatal("a household found due while it was held was left to the next poll")
	}
	if !s.hold(h) {
		t.Fatal("a household let go was not held again")
	}
	s.release(h, false)
	if woken(s) {
		t.Fatal("the second drain was asked for again too")
	}
}

// A household whose worker's turn ended with jobs perhaps left is looked at again once the others
// found due with it have had theirs: letting it go wakes the workers, though nothing found it due
// while it was held, rather than leaving the rest of its jobs to the next poll.
func TestAHouseholdWhoseTurnEndedIsLookedAtAgain(t *testing.T) {
	s := &Service{wake: make(chan struct{}, 1), busy: map[uuid.UUID]bool{}}
	h := idgen.New()
	if !s.hold(h) {
		t.Fatal("a household nobody drains was not held")
	}
	s.release(h, true)
	if !woken(s) {
		t.Fatal("a household whose turn ended was left to the next poll")
	}
	if !s.hold(h) {
		t.Fatal("a household let go was not held again")
	}
}

// A panic in what a job runs, a decoder's on a member's upload, fails the job for good rather than
// ending the process that runs it, and is logged by its type and the stack, never by its value,
// which may quote the file, and by the household whose job it was, which the workers, running in no
// request's scope, name themselves (FR-NF5).
func TestAJobThatPanicsFailsForGood(t *testing.T) {
	var logged bytes.Buffer
	s := &Service{log: logging.New(&logged, slog.LevelDebug)}
	household := idgen.New()
	err := s.guard(t.Context(), job{household: household, kind: "variants", module: "probe"}, func(context.Context, job) error {
		panic("Smlouva o dílo, strana 1")
	})
	if !errors.Is(err, errPermanent) {
		t.Fatalf("a job that panicked = %v, want a failure for good", err)
	}
	if out := logged.String(); !strings.Contains(out, "files: a job panicked") || strings.Contains(out, "Smlouva") ||
		!strings.Contains(out, `"household_id":"`+household.String()+`"`) {
		t.Fatalf("logged %s", out)
	}
	if err := s.guard(t.Context(), job{kind: "purge"}, func(context.Context, job) error { return errGone }); !errors.Is(err, errGone) {
		t.Fatalf("a job that did not panic = %v, want what it answered", err)
	}
}

// A job's time runs from before the claim that took it, never from once the claim has committed:
// its lease, past which another worker may take it, runs from the claim's now(), so a job timed from
// the commit would still be running when another worker could take it, and run twice at once.
func TestAJobEndsNoLaterThanItsLease(t *testing.T) {
	s := &Service{lease: 10 * time.Minute}
	claimed := time.Now().Add(-time.Minute)
	ctx, stop := s.leased(t.Context(), job{claimed: claimed})
	defer stop()
	if deadline, ok := ctx.Deadline(); !ok || !deadline.Equal(claimed.Add(s.lease)) {
		t.Fatalf("a job claimed at %s runs until %s, %t, with a lease of %s", claimed, deadline, ok, s.lease)
	}
}
