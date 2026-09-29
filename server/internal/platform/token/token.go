// Package token is the mobile client's access token (FR-ID4, D-15): a JWT signed with Ed25519
// (EdDSA), valid 15 minutes, carrying only sub, sid, iat, exp and client. It names who the caller
// is and which of their device sign-ins it came from, and nothing about what they may do: every
// grant is resolved from the membership on each request, so revoking one takes effect on the
// next request rather than when the token expires.
//
// The keys are a list, of which the first signs and every one verifies, so that a key is rotated
// by adding its successor in front of it and dropping it once no token it signed can still be
// live, fifteen minutes later. A key is named in each token's header by its RFC 7638 thumbprint.
// The public halves are published as a JWKS (JWKS), which PowerSync verifies its own tokens with
// (plan item 13); a token minted for PowerSync carries an audience, and this package refuses any
// token that does.
package token

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Lifetime is how long an access token is valid (D-15).
const Lifetime = 15 * time.Minute

// Type is the JOSE header's typ of an access token (RFC 9068 §2.1), which a token minted for
// anything else does not carry.
const Type = "at+jwt"

// ClientMobile is the client claim of every access token: only the mobile client holds one (D-7).
const ClientMobile = "mobile"

// ErrInvalid is Verify's answer for a token that does not authenticate anyone: malformed, signed
// by no key the server holds, of another type or audience, or expired.
var ErrInvalid = errors.New("token: not a valid access token")

// Keys are the Ed25519 keys access tokens are signed and verified with.
type Keys struct {
	signer   ed25519.PrivateKey
	signerID string
	public   map[string]ed25519.PublicKey
	order    []string
}

// NewKeys returns the keys whose 32-byte seeds are seeds: the first signs, and each verifies.
func NewKeys(seeds ...[]byte) (*Keys, error) {
	if len(seeds) == 0 {
		return nil, errors.New("token: no signing key")
	}
	k := &Keys{public: map[string]ed25519.PublicKey{}}
	for i, seed := range seeds {
		if len(seed) != ed25519.SeedSize {
			return nil, fmt.Errorf("token: key %d is %d bytes; an Ed25519 seed is %d", i+1, len(seed), ed25519.SeedSize)
		}
		private := ed25519.NewKeyFromSeed(seed)
		public, _ := private.Public().(ed25519.PublicKey)
		id := thumbprint(public)
		if _, dup := k.public[id]; dup {
			return nil, fmt.Errorf("token: key %d is listed twice", i+1)
		}
		if i == 0 {
			k.signer, k.signerID = private, id
		}
		k.public[id] = public
		k.order = append(k.order, id)
	}
	return k, nil
}

// ParseKeys reads the keys from their configured form: a comma-separated list of 32-byte seeds,
// each in base64, standard or URL-safe, padded or not. An error never quotes a key.
func ParseKeys(list string) (*Keys, error) {
	var seeds [][]byte
	for i, item := range strings.Split(list, ",") {
		item = strings.TrimRight(strings.TrimSpace(item), "=")
		if item == "" {
			continue
		}
		seed, err := base64.RawURLEncoding.DecodeString(strings.NewReplacer("+", "-", "/", "_").Replace(item))
		if err != nil {
			return nil, fmt.Errorf("token: key %d is not base64", i+1)
		}
		seeds = append(seeds, seed)
	}
	return NewKeys(seeds...)
}

// thumbprint is key's RFC 7638 JWK thumbprint: the SHA-256 of its required members in
// lexicographic order, without white space, in base64url.
func thumbprint(key ed25519.PublicKey) string {
	sum := sha256.Sum256([]byte(`{"crv":"Ed25519","kty":"OKP","x":"` + base64.RawURLEncoding.EncodeToString(key) + `"}`))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// Claims are what an access token says.
type Claims struct {
	// Subject is the user.
	Subject uuid.UUID
	// Session is the device sign-in the token was issued to (internal/platform/device).
	Session   uuid.UUID
	IssuedAt  time.Time
	ExpiresAt time.Time
}

// claims is an access token's payload: sub, sid, iat, exp and client, and nothing else. Audience
// and issuer are read only to refuse a token that carries them.
type claims struct {
	jwt.RegisteredClaims
	Session string `json:"sid"`
	Client  string `json:"client"`
}

// Issue returns an access token for user's device sign-in session, issued at now.
func (k *Keys) Issue(user, session uuid.UUID, now time.Time) (string, error) {
	now = now.Truncate(time.Second)
	t := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(Lifetime)),
		},
		Session: session.String(),
		Client:  ClientMobile,
	})
	t.Header["typ"] = Type
	t.Header["kid"] = k.signerID
	signed, err := t.SignedString(k.signer)
	if err != nil {
		return "", fmt.Errorf("token: sign: %w", err)
	}
	return signed, nil
}

// Verify returns what raw says, when it is an access token one of the keys signed, still valid at
// now; otherwise ErrInvalid.
func (k *Keys) Verify(raw string, now time.Time) (Claims, error) {
	var c claims
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}),
		jwt.WithExpirationRequired(),
		jwt.WithTimeFunc(func() time.Time { return now }),
	)
	_, err := parser.ParseWithClaims(raw, &c, func(t *jwt.Token) (any, error) {
		if typ, _ := t.Header["typ"].(string); typ != Type {
			return nil, ErrInvalid
		}
		id, _ := t.Header["kid"].(string)
		key, ok := k.public[id]
		if !ok {
			return nil, ErrInvalid
		}
		return key, nil
	})
	if err != nil {
		return Claims{}, ErrInvalid
	}
	// A token for another service, PowerSync's among them, names its audience; an access token
	// names none, and no issuer either.
	if len(c.Audience) > 0 || c.Issuer != "" || c.Client != ClientMobile || c.IssuedAt == nil {
		return Claims{}, ErrInvalid
	}
	user, err := uuid.Parse(c.Subject)
	if err != nil || user == uuid.Nil {
		return Claims{}, ErrInvalid
	}
	session, err := uuid.Parse(c.Session)
	if err != nil || session == uuid.Nil {
		return Claims{}, ErrInvalid
	}
	return Claims{Subject: user, Session: session, IssuedAt: c.IssuedAt.Time, ExpiresAt: c.ExpiresAt.Time}, nil
}

// JWKS returns the public keys as a JSON Web Key Set (RFC 7517), the signing key first.
func (k *Keys) JWKS() ([]byte, error) {
	type jwk struct {
		Kty string `json:"kty"`
		Crv string `json:"crv"`
		X   string `json:"x"`
		Kid string `json:"kid"`
		Alg string `json:"alg"`
		Use string `json:"use"`
	}
	set := struct {
		Keys []jwk `json:"keys"`
	}{}
	for _, id := range k.order {
		set.Keys = append(set.Keys, jwk{Kty: "OKP", Crv: "Ed25519", X: base64.RawURLEncoding.EncodeToString(k.public[id]),
			Kid: id, Alg: jwt.SigningMethodEdDSA.Alg(), Use: "sig"})
	}
	return json.Marshal(set)
}
