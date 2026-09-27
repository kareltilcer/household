package idgen_test

import (
	"testing"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/idgen"
)

func TestNewMintsVersion7(t *testing.T) {
	id := idgen.New()
	if id.Version() != 7 || id.Variant() != uuid.RFC4122 {
		t.Fatalf("%s is version %d variant %s, want 7 and RFC 4122", id, id.Version(), id.Variant())
	}
}

// v7 ids sort by the time they were minted, which is what lets them serve as a keyset.
func TestIDsSortInTheOrderTheyWereMinted(t *testing.T) {
	prev := idgen.String()
	for range 1000 {
		next := idgen.String()
		if next <= prev {
			t.Fatalf("%s minted after %s sorts before it", next, prev)
		}
		prev = next
	}
}
