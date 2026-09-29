package mfa_test

import (
	"bytes"
	"encoding/base64"
	"errors"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/mfa"
)

func keys(t *testing.T, values ...[]byte) *mfa.Keys {
	t.Helper()
	k, err := mfa.NewKeys(values...)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func value(b byte) []byte { return bytes.Repeat([]byte{b}, 32) }

func TestASealedSecretOpensForItsOwnerOnly(t *testing.T) {
	k := keys(t, value(1))
	owner := uuid.New()
	sealed := k.Seal(owner, []byte("JBSWY3DPEHPK3PXP"))
	if bytes.Contains(sealed, []byte("JBSWY3DPEHPK3PXP")) {
		t.Fatal("the secret is in the clear")
	}
	got, err := k.Open(owner, sealed)
	if err != nil || string(got) != "JBSWY3DPEHPK3PXP" {
		t.Fatalf("%q %v", got, err)
	}
	if _, err := k.Open(uuid.New(), sealed); !errors.Is(err, mfa.ErrSealed) {
		t.Fatalf("another owner opened it: %v", err)
	}
	tampered := slices.Clone(sealed)
	tampered[len(tampered)-1] ^= 1
	if _, err := k.Open(owner, tampered); !errors.Is(err, mfa.ErrSealed) {
		t.Fatalf("a tampered secret opened: %v", err)
	}
	// Rotated: the new key seals, the old still opens what it sealed, and once dropped, nothing.
	rotated := keys(t, value(2), value(1))
	if got, err := rotated.Open(owner, sealed); err != nil || string(got) != "JBSWY3DPEHPK3PXP" {
		t.Fatalf("after a rotation: %q %v", got, err)
	}
	if !k.Current(sealed) || rotated.Current(sealed) || !rotated.Current(rotated.Seal(owner, []byte("x"))) {
		t.Fatal("Current does not tell the first key's secrets from an older one's")
	}
	if _, err := keys(t, value(2)).Open(owner, sealed); !errors.Is(err, mfa.ErrSealed) {
		t.Fatalf("a dropped key's secret opened: %v", err)
	}
}

func TestACodeIsAcceptedOnceAndWithinItsWindow(t *testing.T) {
	e, err := mfa.NewEnrolment("Household", "jana@example.test")
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(e.URI)
	if err != nil || u.Scheme != "otpauth" || u.Query().Get("secret") != e.Secret || u.Query().Get("issuer") != "Household" {
		t.Fatalf("%s: %v", e.URI, err)
	}
	now := time.Date(2026, 9, 29, 12, 0, 10, 0, time.UTC)
	step := mfa.Step(now)
	for _, offset := range []int64{-1, 0, 1} {
		code, err := mfa.Code(e.Secret, step+offset)
		if err != nil {
			t.Fatal(err)
		}
		got, ok := mfa.Match(e.Secret, code[:3]+" "+code[3:], now, 0)
		if !ok || got != step+offset {
			t.Errorf("offset %d: %d %v", offset, got, ok)
		}
		// Once accepted, a code, and any older one, is not accepted again.
		if _, ok := mfa.Match(e.Secret, code, now, step+offset); ok {
			t.Errorf("offset %d: accepted twice", offset)
		}
	}
	for _, offset := range []int64{-2, 2} {
		code, _ := mfa.Code(e.Secret, step+offset)
		if _, ok := mfa.Match(e.Secret, code, now, 0); ok {
			t.Errorf("offset %d: accepted", offset)
		}
	}
	for _, bad := range []string{"", "12345", "1234567", "12a456"} {
		if _, ok := mfa.Match(e.Secret, bad, now, 0); ok {
			t.Errorf("%q: accepted", bad)
		}
	}
}

func TestRecoveryCodes(t *testing.T) {
	codes := mfa.NewRecoveryCodes()
	if len(codes) != mfa.RecoveryCodes {
		t.Fatalf("%d codes", len(codes))
	}
	seen := map[string]bool{}
	for _, c := range codes {
		if len(c) != 9 || c[4] != '-' || strings.ContainsAny(c, "01IO") {
			t.Errorf("%q", c)
		}
		norm, ok := mfa.RecoveryCode(strings.ToLower(strings.Replace(c, "-", " ", 1)))
		if !ok || norm != strings.Replace(c, "-", "", 1) {
			t.Errorf("%q read back as %q %v", c, norm, ok)
		}
		if seen[norm] {
			t.Errorf("%q twice", c)
		}
		seen[norm] = true
	}
	for _, bad := range []string{"", "ABCD-EFG", "ABCD-EFGHJ", "ABCD-EFG0", "ABCD-EFGI"} {
		if _, ok := mfa.RecoveryCode(bad); ok {
			t.Errorf("%q: read as a code", bad)
		}
	}

	owner := uuid.New()
	old := keys(t, value(1))
	kept := old.HashRecovery(owner, "ABCDEFGH")
	rotated := keys(t, value(2), value(1))
	hashes := rotated.RecoveryHashes(owner, "ABCDEFGH")
	if len(hashes) != 2 || !bytes.Equal(hashes[1], kept) || bytes.Equal(hashes[0], kept) {
		t.Fatal("a code kept under the old key is not among the hashes after a rotation")
	}
	if bytes.Equal(old.HashRecovery(uuid.New(), "ABCDEFGH"), kept) {
		t.Fatal("another owner's code hashes alike")
	}
}

func TestKeysAreReadFromBase64(t *testing.T) {
	if _, err := mfa.ParseKeys(base64.StdEncoding.EncodeToString(value(1)) + "," + base64.RawURLEncoding.EncodeToString(value(2))); err != nil {
		t.Fatal(err)
	}
	short := base64.StdEncoding.EncodeToString(value(1)[:16])
	for _, bad := range []string{"", "not base64!", short} {
		_, err := mfa.ParseKeys(bad)
		if err == nil {
			t.Errorf("%q: no error", bad)
		} else if bad != "" && strings.Contains(err.Error(), bad) {
			t.Errorf("the error quotes the key: %v", err)
		}
	}
}
