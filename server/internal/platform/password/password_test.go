package password_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/password"
)

// cheap are parameters small enough for tests to hash with quickly.
var cheap = password.Params{Memory: 8 * 1024, Time: 1, Threads: 1, SaltLen: 16, KeyLen: 32}

func hasher(t *testing.T, p password.Params, concurrency int) *password.Hasher {
	t.Helper()
	h, err := password.New(p, concurrency)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func TestAHashVerifiesItsPasswordAndNoOther(t *testing.T) {
	h := hasher(t, cheap, 2)
	encoded, err := h.Hash(t.Context(), "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(encoded, "$argon2id$v=19$m=8192,t=1,p=1$") {
		t.Fatalf("not a PHC string with its parameters: %s", encoded)
	}
	if ok, rehash, err := h.Verify(t.Context(), "correct horse battery staple", encoded); err != nil || !ok || rehash {
		t.Fatalf("the right password: ok %v, rehash %v, %v", ok, rehash, err)
	}
	for _, wrong := range []string{"correct horse battery stapl", "Correct horse battery staple", ""} {
		if ok, _, err := h.Verify(t.Context(), wrong, encoded); err != nil || ok {
			t.Fatalf("%q verified: %v %v", wrong, ok, err)
		}
	}
	other, err := h.Hash(t.Context(), "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if other == encoded {
		t.Fatal("two hashes of one password share a salt")
	}
}

// A password is one password however its accents are encoded: composed, as most keyboards type
// them, or decomposed, as text pasted from a macOS file name arrives (NIST SP 800-63B §5.1.1.2).
// Its length is counted as it is then hashed.
func TestAPasswordIsCheckedInItsNormalForm(t *testing.T) {
	h := hasher(t, cheap, 1)
	composed := "Příliš žluťoučký kůň"
	decomposed := "Příliš žluťoučký kůň"
	if composed == decomposed || password.Normalize(decomposed) != composed {
		t.Fatalf("the two forms: %q, %q", composed, password.Normalize(decomposed))
	}
	for _, pair := range [][2]string{{composed, decomposed}, {decomposed, composed}} {
		encoded, err := h.Hash(t.Context(), pair[0])
		if err != nil {
			t.Fatal(err)
		}
		if ok, _, err := h.Verify(t.Context(), pair[1], encoded); err != nil || !ok {
			t.Fatalf("set as %q, typed as %q: ok %v, %v", pair[0], pair[1], ok, err)
		}
	}
}

// A hash made with other parameters still verifies, and asks to be replaced with one made with
// the current ones; a wrong password never does.
func TestAHashFromOtherParametersAsksToBeReplaced(t *testing.T) {
	old := hasher(t, password.Params{Memory: 4 * 1024, Time: 1, Threads: 1, SaltLen: 16, KeyLen: 32}, 1)
	encoded, err := old.Hash(t.Context(), "an older password hash")
	if err != nil {
		t.Fatal(err)
	}
	current := hasher(t, cheap, 1)
	if ok, rehash, err := current.Verify(t.Context(), "an older password hash", encoded); err != nil || !ok || !rehash {
		t.Fatalf("ok %v, rehash %v, %v", ok, rehash, err)
	}
	if ok, rehash, err := current.Verify(t.Context(), "not the password", encoded); err != nil || ok || rehash {
		t.Fatalf("a wrong password: ok %v, rehash %v, %v", ok, rehash, err)
	}
}

func TestAMalformedHashIsRefused(t *testing.T) {
	h := hasher(t, cheap, 1)
	good, err := h.Hash(t.Context(), "a password to mangle")
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{
		"", "plaintext", strings.Replace(good, "argon2id", "argon2i", 1), strings.Replace(good, "v=19", "v=16", 1),
		strings.Replace(good, "m=8192", "m=0", 1), strings.Replace(good, "m=8192", "m=99999999", 1),
		strings.Replace(good, "t=1", "t=x", 1), strings.Replace(good, ",p=1", ",p=1,q=2", 1),
		good[:strings.LastIndex(good, "$")] + "$!!",
	} {
		if _, _, err := h.Verify(t.Context(), "a password to mangle", bad); !errors.Is(err, password.ErrMalformed) {
			t.Errorf("%q: %v", bad, err)
		}
	}
}

// Burn costs a check against a hash nobody's password matches: it succeeds, and it takes the time
// a check does.
func TestBurnChecksAgainstAHashNobodyMatches(t *testing.T) {
	h := hasher(t, cheap, 1)
	if err := h.Burn(t.Context(), "any password at all"); err != nil {
		t.Fatal(err)
	}
}

// At most concurrency hashes run at once; a caller waiting for a slot gives up when its context
// ends, and one whose context has ended does not start.
func TestHashingWaitsForASlotAndGivesUpWithItsContext(t *testing.T) {
	h := hasher(t, cheap, 2)
	release := h.HoldSlots()
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	if _, err := h.Hash(ctx, "waits for a slot"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("a hash waiting past its context: %v", err)
	}
	if _, _, err := h.Verify(ctx, "waits for a slot", "$argon2id$v=19$m=8192,t=1,p=1$c2FsdHNhbHRzYWx0c2FsdA$dGFndGFndGFndGFndGFndGFndGFndGFndGFndGFndGE"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("a check waiting past its context: %v", err)
	}
	release()

	done, stop := context.WithCancel(t.Context())
	stop()
	if _, err := h.Hash(done, "never starts"); !errors.Is(err, context.Canceled) {
		t.Fatalf("a hash whose context had ended: %v", err)
	}
	if _, err := h.Hash(t.Context(), "a slot is free again"); err != nil {
		t.Fatal(err)
	}
}

func TestParametersTooWeakAreRefused(t *testing.T) {
	for _, p := range []password.Params{
		{Memory: 0, Time: 1, Threads: 1, SaltLen: 16, KeyLen: 32},
		{Memory: 8, Time: 0, Threads: 1, SaltLen: 16, KeyLen: 32},
		{Memory: 8, Time: 1, Threads: 1, SaltLen: 4, KeyLen: 32},
		{Memory: 8, Time: 1, Threads: 1, SaltLen: 16, KeyLen: 8},
	} {
		if _, err := password.New(p, 1); err == nil {
			t.Errorf("%+v accepted", p)
		}
	}
}
