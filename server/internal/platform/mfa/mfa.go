// Package mfa is the second factor of FR-ID5: a TOTP authenticator (RFC 6238, six digits every
// thirty seconds, SHA-1, as every authenticator app reads it) and ten single-use recovery codes.
//
// A TOTP secret has to be kept in a form the server can read back, so it is sealed with
// AES-256-GCM under a key the database does not hold (Keys), bound to its owner's id: a copy of
// the database alone yields no second factor. A recovery code is kept as an HMAC under the same
// key, since a code of forty bits would fall to a fast unkeyed hash. The keys are a list, of
// which the first seals and every one opens, so that a key is rotated by putting its successor
// first; a sealed secret and a recovery code name the key they were made with.
package mfa

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

// keyIDLen is how many bytes of a key's SHA-256 name it in a sealed secret.
const keyIDLen = 4

// Keys are the keys secrets are sealed and recovery codes are hashed with.
type Keys struct {
	keys []key
}

type key struct {
	id     []byte
	secret []byte
	aead   cipher.AEAD
}

// NewKeys returns the keys whose 32-byte values are values: the first seals and hashes, and each
// opens and checks.
func NewKeys(values ...[]byte) (*Keys, error) {
	if len(values) == 0 {
		return nil, errors.New("mfa: no key")
	}
	k := &Keys{}
	seen := map[string]bool{}
	for i, v := range values {
		if len(v) != 32 {
			return nil, fmt.Errorf("mfa: key %d is %d bytes; want 32", i+1, len(v))
		}
		sum := sha256.Sum256(v)
		id := sum[:keyIDLen]
		if seen[string(id)] {
			return nil, fmt.Errorf("mfa: key %d is listed twice", i+1)
		}
		seen[string(id)] = true
		block, err := aes.NewCipher(v)
		if err != nil {
			return nil, fmt.Errorf("mfa: key %d: %w", i+1, err)
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, fmt.Errorf("mfa: key %d: %w", i+1, err)
		}
		k.keys = append(k.keys, key{id: id, secret: v, aead: aead})
	}
	return k, nil
}

// ParseKeys reads the keys from their configured form: a comma-separated list of 32-byte values,
// each in base64, standard or URL-safe, padded or not. An error never quotes a key.
func ParseKeys(list string) (*Keys, error) {
	var values [][]byte
	for i, item := range strings.Split(list, ",") {
		item = strings.TrimRight(strings.TrimSpace(item), "=")
		if item == "" {
			continue
		}
		v, err := base64.RawURLEncoding.DecodeString(strings.NewReplacer("+", "-", "/", "_").Replace(item))
		if err != nil {
			return nil, fmt.Errorf("mfa: key %d is not base64", i+1)
		}
		values = append(values, v)
	}
	return NewKeys(values...)
}

// ErrSealed is Open's answer for a sealed value no key opens: made with a key since dropped, or
// not made by Seal.
var ErrSealed = errors.New("mfa: a sealed secret no key opens")

// Seal returns plaintext sealed for owner under the first key: the key's id, a random nonce, and
// the ciphertext with its tag. It opens only for the same owner.
func (k *Keys) Seal(owner uuid.UUID, plaintext []byte) []byte {
	first := k.keys[0]
	nonce := make([]byte, first.aead.NonceSize())
	_, _ = rand.Read(nonce) // It never fails: the process ends first.
	out := append(append([]byte{}, first.id...), nonce...)
	return first.aead.Seal(out, nonce, plaintext, owner[:])
}

// Current reports whether sealed was sealed under the first key, which a secret sealed under an
// older one is sealed again with when it is next used.
func (k *Keys) Current(sealed []byte) bool {
	return len(sealed) >= keyIDLen && subtle.ConstantTimeCompare(sealed[:keyIDLen], k.keys[0].id) == 1
}

// Open returns what Seal sealed for owner.
func (k *Keys) Open(owner uuid.UUID, sealed []byte) ([]byte, error) {
	for _, key := range k.keys {
		n := keyIDLen + key.aead.NonceSize()
		if len(sealed) < n || subtle.ConstantTimeCompare(sealed[:keyIDLen], key.id) != 1 {
			continue
		}
		plaintext, err := key.aead.Open(nil, sealed[keyIDLen:n], sealed[n:], owner[:])
		if err != nil {
			return nil, ErrSealed
		}
		return plaintext, nil
	}
	return nil, ErrSealed
}

// The authenticator's parameters: those every app reads from an otpauth URI without asking.
const (
	// Period is how long a code lasts.
	Period = 30 * time.Second
	// Skew is how many periods either side of now a code is accepted from, for a clock that is
	// a little off and a code typed as it changed.
	Skew = 1
	// secretSize is the secret's length in bytes, RFC 4226's recommended 160 bits.
	secretSize = 20
)

var totpOptions = totp.ValidateOpts{Period: uint(Period / time.Second), Digits: otp.DigitsSix, Algorithm: otp.AlgorithmSHA1}

// Enrolment is a new authenticator's secret, in base32 as an app takes it typed, and its otpauth
// URI, which a QR code carries.
type Enrolment struct {
	Secret, URI string
}

// NewEnrolment returns a new secret for account, the name the app shows beside the issuer.
func NewEnrolment(issuer, account string) (Enrolment, error) {
	key, err := totp.Generate(totp.GenerateOpts{Issuer: issuer, AccountName: account, Period: totpOptions.Period,
		SecretSize: secretSize, Digits: totpOptions.Digits, Algorithm: totpOptions.Algorithm})
	if err != nil {
		return Enrolment{}, fmt.Errorf("mfa: a new secret: %w", err)
	}
	return Enrolment{Secret: key.Secret(), URI: key.URL()}, nil
}

// Step is the TOTP time step t falls in.
func Step(t time.Time) int64 { return t.Unix() / int64(Period/time.Second) }

// Code returns secret's code for step.
func Code(secret string, step int64) (string, error) {
	return totp.GenerateCodeCustom(secret, time.Unix(step*int64(Period/time.Second), 0), totpOptions)
}

// Match returns the step within Skew of now whose code for secret is code, and false for none. A
// step at or before after, the last one accepted, is not matched: a code is accepted once, and
// never an older one after a newer one (RFC 6238 §5.2).
func Match(secret, code string, now time.Time, after int64) (int64, bool) {
	code, ok := TOTPCode(code)
	if !ok {
		return 0, false
	}
	current := Step(now)
	for step := current - Skew; step <= current+Skew; step++ {
		if step <= after {
			continue
		}
		want, err := Code(secret, step)
		if err == nil && subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return step, true
		}
	}
	return 0, false
}

// TOTPCode returns code as six digits, with the spaces an app shows it with dropped, and false
// when it is not six digits.
func TOTPCode(code string) (string, bool) {
	code = strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	if len(code) != 6 {
		return "", false
	}
	for _, r := range code {
		if r < '0' || r > '9' {
			return "", false
		}
	}
	return code, true
}

// RecoveryCodes is how many recovery codes a set holds.
const RecoveryCodes = 10

// recoveryAlphabet is the characters a recovery code is written in: capitals and digits, less
// those read as another (0 and O, 1 and I), thirty-two of them, five bits each.
const recoveryAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

// recoveryLen is a code's length without its dash: forty bits.
const recoveryLen = 8

// NewRecoveryCodes returns a new set of codes, each as it is shown: XXXX-XXXX.
func NewRecoveryCodes() []string {
	codes := make([]string, RecoveryCodes)
	b := make([]byte, recoveryLen)
	for i := range codes {
		_, _ = rand.Read(b) // It never fails: the process ends first.
		var s strings.Builder
		for j, v := range b {
			if j == recoveryLen/2 {
				s.WriteByte('-')
			}
			s.WriteByte(recoveryAlphabet[v%byte(len(recoveryAlphabet))])
		}
		codes[i] = s.String()
	}
	return codes
}

// RecoveryCode returns code as a set holds it, in capitals without its dash or spaces, and false
// when it cannot be one: a code typed in lower case, or with its dash left out, is still the code.
func RecoveryCode(code string) (string, bool) {
	code = strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(strings.TrimSpace(code)))
	if len(code) != recoveryLen {
		return "", false
	}
	for _, r := range code {
		if !strings.ContainsRune(recoveryAlphabet, r) {
			return "", false
		}
	}
	return code, true
}

// HashRecovery returns owner's code's HMAC under the first key, which a set keeps.
func (k *Keys) HashRecovery(owner uuid.UUID, code string) []byte {
	return recoveryMAC(k.keys[0].secret, owner, code)
}

// RecoveryHashes returns owner's code's HMAC under every key, the first key's first: the values a
// code a set holds may be kept as, whichever key was first when the set was made.
func (k *Keys) RecoveryHashes(owner uuid.UUID, code string) [][]byte {
	out := make([][]byte, 0, len(k.keys))
	for _, key := range k.keys {
		out = append(out, recoveryMAC(key.secret, owner, code))
	}
	return out
}

func recoveryMAC(secret []byte, owner uuid.UUID, code string) []byte {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte("household recovery code\x00"))
	_, _ = mac.Write(owner[:])
	_, _ = mac.Write([]byte(code))
	return mac.Sum(nil)
}
