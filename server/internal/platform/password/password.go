// Package password hashes and checks the secrets people sign in with (PRD 02 §2, PRD 07 §4):
// Argon2id, stored in the PHC string format, so that the parameters a hash was made with travel
// with it, and a hash made with weaker ones is replaced the next time its owner signs in.
//
// Argon2id is memory-hard by design, and each hash holds Params.Memory for as long as it runs, so
// a Hasher runs a bounded number at once: a burst of sign-ins waits its turn rather than taking
// the process's memory with it.
package password

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

// MinLength is the shortest password accepted, in characters (FR-ID1). There are no composition
// rules: length and the breached-password screen are the whole policy, per NIST SP 800-63B.
const MinLength = 12

// Params are Argon2id's parameters.
type Params struct {
	// Memory is in KiB.
	Memory  uint32
	Time    uint32
	Threads uint8
	SaltLen uint32
	KeyLen  uint32
}

// Default is RFC 9106 §4's second recommended option, for memory that is not abundant: 64 MiB,
// three passes, four lanes, a 128-bit salt and a 256-bit tag.
var Default = Params{Memory: 64 * 1024, Time: 3, Threads: 4, SaltLen: 16, KeyLen: 32}

// Bounds a stored hash's parameters are held to before it is checked, so that a row whose
// parameters are out of all proportion fails rather than taking the process's memory.
const (
	maxMemory  = 1 << 20 // 1 GiB
	maxTime    = 16
	maxKeyLen  = 64
	maxSaltLen = 64
)

// ErrMalformed is a stored hash that is not an Argon2id PHC string this package can check.
var ErrMalformed = errors.New("password: not an Argon2id hash")

// Hasher hashes and checks passwords with its parameters, running at most a fixed number at once.
type Hasher struct {
	params Params
	slots  chan struct{}
	// dummy is a hash of a password nobody has, made with params, which Burn checks against.
	dummy string
}

// New returns a Hasher that makes hashes with params and runs at most concurrency at once.
func New(params Params, concurrency int) (*Hasher, error) {
	if params.Memory == 0 || params.Time == 0 || params.Threads == 0 || params.SaltLen < 8 || params.KeyLen < 16 {
		return nil, errors.New("password: parameters too weak to hash with")
	}
	if concurrency < 1 {
		concurrency = 1
	}
	h := &Hasher{params: params, slots: make(chan struct{}, concurrency)}
	dummy, err := h.Hash(context.Background(), "a password nobody has, checked when the account does not exist")
	if err != nil {
		return nil, err
	}
	h.dummy = dummy
	return h, nil
}

// acquire waits for a slot, or for ctx to end. A caller whose context has already ended does not
// take one, even where one is free.
func (h *Hasher) acquire(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case h.slots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (h *Hasher) release() { <-h.slots }

// Hash returns password's Argon2id hash, with a fresh salt, as a PHC string:
// $argon2id$v=19$m=65536,t=3,p=4$<salt>$<tag>.
func (h *Hasher) Hash(ctx context.Context, password string) (string, error) {
	salt := make([]byte, h.params.SaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("password: salt: %w", err)
	}
	if err := h.acquire(ctx); err != nil {
		return "", err
	}
	defer h.release()
	p := h.params
	tag := argon2.IDKey([]byte(password), salt, p.Time, p.Memory, p.Threads, p.KeyLen)
	return encode(p, salt, tag), nil
}

// Verify reports whether password is the one encoded hashes, and whether the hash should be
// replaced by one made with the Hasher's parameters: it was made with others. The comparison
// takes the same time wherever the two differ.
func (h *Hasher) Verify(ctx context.Context, password, encoded string) (ok, rehash bool, err error) {
	p, salt, tag, err := decode(encoded)
	if err != nil {
		return false, false, err
	}
	if err := h.acquire(ctx); err != nil {
		return false, false, err
	}
	defer h.release()
	got := argon2.IDKey([]byte(password), salt, p.Time, p.Memory, p.Threads, p.KeyLen)
	ok = subtle.ConstantTimeCompare(got, tag) == 1
	return ok, ok && p != h.params, nil
}

// Burn checks password against a hash nobody's password matches, and so takes as long as Verify
// does: a sign-in for an address with no account costs what one with a wrong password does, and
// the time it answers in does not tell the two apart.
func (h *Hasher) Burn(ctx context.Context, password string) error {
	_, _, err := h.Verify(ctx, password, h.dummy)
	return err
}

var b64 = base64.RawStdEncoding

func encode(p Params, salt, tag []byte) string {
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, p.Memory, p.Time, p.Threads, b64.EncodeToString(salt), b64.EncodeToString(tag))
}

// decode reads a PHC string back into its parameters, salt and tag.
func decode(encoded string) (Params, []byte, []byte, error) {
	var p Params
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v="+strconv.Itoa(argon2.Version) {
		return p, nil, nil, ErrMalformed
	}
	for _, kv := range strings.Split(parts[3], ",") {
		name, value, found := strings.Cut(kv, "=")
		n, err := strconv.ParseUint(value, 10, 32)
		if !found || err != nil {
			return p, nil, nil, ErrMalformed
		}
		switch name {
		case "m":
			p.Memory = uint32(n)
		case "t":
			p.Time = uint32(n)
		case "p":
			if n > 255 {
				return p, nil, nil, ErrMalformed
			}
			p.Threads = uint8(n)
		default:
			return p, nil, nil, ErrMalformed
		}
	}
	salt, err := b64.DecodeString(parts[4])
	if err != nil {
		return p, nil, nil, ErrMalformed
	}
	tag, err := b64.DecodeString(parts[5])
	if err != nil {
		return p, nil, nil, ErrMalformed
	}
	switch {
	case p.Memory == 0 || p.Memory > maxMemory, p.Time == 0 || p.Time > maxTime, p.Threads == 0,
		len(salt) < 8 || len(salt) > maxSaltLen, len(tag) < 16 || len(tag) > maxKeyLen:
		return p, nil, nil, ErrMalformed
	}
	p.SaltLen, p.KeyLen = uint32(len(salt)), uint32(len(tag)) //nolint:gosec // G115: both are at most 64, checked above.
	return p, salt, tag, nil
}
