package files

import (
	"testing"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/idgen"
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
	s.release(h)
	if woken(s) {
		t.Fatal("letting go of a household nobody asked for again woke the workers")
	}

	if !s.hold(h) {
		t.Fatal("a household let go was not held again")
	}
	if s.hold(h) {
		t.Fatal("a household a worker drains was held twice")
	}
	s.release(h)
	if !woken(s) {
		t.Fatal("a household found due while it was held was left to the next poll")
	}
	if !s.hold(h) {
		t.Fatal("a household let go was not held again")
	}
	s.release(h)
	if woken(s) {
		t.Fatal("the second drain was asked for again too")
	}
}
