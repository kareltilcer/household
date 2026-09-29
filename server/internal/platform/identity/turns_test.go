package identity_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/identity"
)

// A key's turn is held by one request at a time: the next waits for it, one whose context ends
// while it waits gives up, other keys are not held up, and a key nobody holds or waits for is
// forgotten.
func TestTurnsAreTakenOneAtATime(t *testing.T) {
	var turns identity.Turns
	first, err := turns.Take(t.Context(), "link")
	if err != nil {
		t.Fatal(err)
	}

	taken := make(chan func())
	go func() {
		next, err := turns.Take(context.Background(), "link")
		if err != nil {
			t.Error(err)
		}
		taken <- next
	}()
	waitFor := func(want int) {
		t.Helper()
		for deadline := time.Now().Add(5 * time.Second); ; {
			if n, _ := turns.Waiting("link"); n == want {
				return
			}
			if time.Now().After(deadline) {
				t.Fatalf("never %d at the key", want)
			}
			time.Sleep(time.Millisecond)
		}
	}
	waitFor(2)
	select {
	case <-taken:
		t.Fatal("a second request took the key's turn while the first held it")
	default:
	}

	other, err := turns.Take(t.Context(), "another link")
	if err != nil {
		t.Fatal(err)
	}
	other()

	gone, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := turns.Take(gone, "link"); !errors.Is(err, context.Canceled) {
		t.Fatalf("a request whose context ended: %v", err)
	}
	waitFor(2)

	first()
	second := <-taken
	waitFor(1)
	second()
	if _, kept := turns.Waiting("link"); kept {
		t.Fatal("the key is kept with nobody at it")
	}
	if _, kept := turns.Waiting("another link"); kept {
		t.Fatal("another key is kept with nobody at it")
	}
}
