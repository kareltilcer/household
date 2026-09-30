package token_test

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/token"
)

func seed(b byte) []byte { return bytes.Repeat([]byte{b}, ed25519.SeedSize) }

func keys(t *testing.T, seeds ...[]byte) *token.Keys {
	t.Helper()
	k, err := token.NewKeys(seeds...)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

var now = time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)

func TestAnIssuedTokenVerifies(t *testing.T) {
	k := keys(t, seed(1))
	user, session := uuid.New(), uuid.New()
	raw, err := k.Issue(user, session, now)
	if err != nil {
		t.Fatal(err)
	}
	c, err := k.Verify(raw, now.Add(token.Lifetime-time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if c.Subject != user || c.Session != session || !c.ExpiresAt.Equal(now.Add(token.Lifetime)) || !c.IssuedAt.Equal(now) {
		t.Fatalf("%+v", c)
	}
	// The payload carries only the five claims D-15 names.
	payload, err := base64.RawURLEncoding.DecodeString(strings.Split(raw, ".")[1])
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(payload, &fields); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"sub", "sid", "iat", "exp", "client"} {
		if _, ok := fields[name]; !ok {
			t.Errorf("no %s", name)
		}
		delete(fields, name)
	}
	if len(fields) > 0 {
		t.Errorf("further claims: %v", fields)
	}
}

func TestAnExpiredTokenIsRefused(t *testing.T) {
	k := keys(t, seed(1))
	raw, err := k.Issue(uuid.New(), uuid.New(), now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := k.Verify(raw, now.Add(token.Lifetime)); !errors.Is(err, token.ErrInvalid) {
		t.Fatalf("%v", err)
	}
}

// A rotation lists the new key first: it signs, and a token the old one signed still verifies
// until the old one is dropped.
func TestARotatedKeyStillVerifiesWhatItSigned(t *testing.T) {
	old := keys(t, seed(1))
	raw, err := old.Issue(uuid.New(), uuid.New(), now)
	if err != nil {
		t.Fatal(err)
	}
	rotated := keys(t, seed(2), seed(1))
	if _, err := rotated.Verify(raw, now); err != nil {
		t.Fatalf("a token the old key signed: %v", err)
	}
	fresh, err := rotated.Issue(uuid.New(), uuid.New(), now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := old.Verify(fresh, now); !errors.Is(err, token.ErrInvalid) {
		t.Fatalf("the new key signs: the old set verified its token (%v)", err)
	}
	if _, err := keys(t, seed(2)).Verify(raw, now); !errors.Is(err, token.ErrInvalid) {
		t.Fatalf("a dropped key's token verified: %v", err)
	}
}

// Every token that is not an access token one of the keys signed is refused, however close it
// comes: another algorithm, another type, an audience (PowerSync's), an issuer, a subject or a
// session that is not an id, another client.
func TestAForgedOrForeignTokenIsRefused(t *testing.T) {
	k := keys(t, seed(1))
	private := ed25519.NewKeyFromSeed(seed(1))
	public, _ := private.Public().(ed25519.PublicKey)
	jwks, err := k.JWKS()
	if err != nil {
		t.Fatal(err)
	}
	var set struct {
		Keys []struct {
			Kid string `json:"kid"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(jwks, &set); err != nil || len(set.Keys) != 1 {
		t.Fatalf("%s: %v", jwks, err)
	}
	kid := set.Keys[0].Kid
	base := func() jwt.MapClaims {
		return jwt.MapClaims{"sub": uuid.NewString(), "sid": uuid.NewString(), "iat": now.Unix(),
			"exp": now.Add(time.Minute).Unix(), "client": "mobile"}
	}
	sign := func(method jwt.SigningMethod, key any, header map[string]any, claims jwt.MapClaims) string {
		t.Helper()
		tok := jwt.NewWithClaims(method, claims)
		for name, v := range header {
			if v == nil {
				delete(tok.Header, name)
			} else {
				tok.Header[name] = v
			}
		}
		raw, err := tok.SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	header := map[string]any{"typ": token.Type, "kid": kid}
	with := func(name string, v any) jwt.MapClaims {
		c := base()
		if v == nil {
			delete(c, name)
		} else {
			c[name] = v
		}
		return c
	}
	// The control: signed as Issue signs, it verifies.
	if _, err := k.Verify(sign(jwt.SigningMethodEdDSA, private, header, base()), now); err != nil {
		t.Fatalf("the control: %v", err)
	}
	cases := map[string]string{
		"HS256 keyed with the public key": sign(jwt.SigningMethodHS256, []byte(public), header, base()),
		"no type":                         sign(jwt.SigningMethodEdDSA, private, map[string]any{"typ": nil, "kid": kid}, base()),
		"type JWT":                        sign(jwt.SigningMethodEdDSA, private, map[string]any{"typ": "JWT", "kid": kid}, base()),
		"an unknown key id":               sign(jwt.SigningMethodEdDSA, private, map[string]any{"typ": token.Type, "kid": "other"}, base()),
		"another key":                     sign(jwt.SigningMethodEdDSA, ed25519.NewKeyFromSeed(seed(9)), header, base()),
		"an audience":                     sign(jwt.SigningMethodEdDSA, private, header, with("aud", "powersync")),
		"an issuer":                       sign(jwt.SigningMethodEdDSA, private, header, with("iss", "https://household.example")),
		"a web client":                    sign(jwt.SigningMethodEdDSA, private, header, with("client", "web")),
		"no subject":                      sign(jwt.SigningMethodEdDSA, private, header, with("sub", nil)),
		"a subject that is no id":         sign(jwt.SigningMethodEdDSA, private, header, with("sub", "jana")),
		"no session":                      sign(jwt.SigningMethodEdDSA, private, header, with("sid", nil)),
		"no expiry":                       sign(jwt.SigningMethodEdDSA, private, header, with("exp", nil)),
		"no issue time":                   sign(jwt.SigningMethodEdDSA, private, header, with("iat", nil)),
		"not a token":                     "not.a.token",
	}
	for name, raw := range cases {
		if _, err := k.Verify(raw, now); !errors.Is(err, token.ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

// A replica's token is PowerSync's (plan item 13): sub, aud, iat and exp, and nothing else, signed
// EdDSA by the signing key its JWKS names, which the public key published verifies; and the API's
// own authentication refuses it, as it refuses every token with an audience.
func TestAReplicaTokenIsPowerSyncsAndNotTheAPIs(t *testing.T) {
	k := keys(t, seed(2), seed(1))
	user := uuid.New()
	raw, expires, err := k.Replica(user, "powersync", now, 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !expires.Equal(now.Add(5 * time.Minute)) {
		t.Errorf("expires %s", expires)
	}
	if _, err := k.Verify(raw, now); !errors.Is(err, token.ErrInvalid) {
		t.Errorf("the API took PowerSync's token: %v", err)
	}
	jwks, err := k.JWKS()
	if err != nil {
		t.Fatal(err)
	}
	var set struct {
		Keys []struct {
			Kid string `json:"kid"`
			X   string `json:"x"`
			Alg string `json:"alg"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(jwks, &set); err != nil || len(set.Keys) != 2 {
		t.Fatalf("%s: %v", jwks, err)
	}
	claims := jwt.MapClaims{}
	parsed, err := jwt.NewParser(jwt.WithValidMethods([]string{"EdDSA"}), jwt.WithAudience("powersync"),
		jwt.WithTimeFunc(func() time.Time { return now })).
		ParseWithClaims(raw, claims, func(tok *jwt.Token) (any, error) {
			// As PowerSync reads the set: the key its kid names.
			for _, key := range set.Keys {
				if key.Kid == tok.Header["kid"] {
					x, err := base64.RawURLEncoding.DecodeString(key.X)
					return ed25519.PublicKey(x), err
				}
			}
			return nil, errors.New("no key names the token's kid")
		})
	if err != nil || !parsed.Valid {
		t.Fatalf("the JWKS does not verify the token: %v", err)
	}
	if parsed.Header["kid"] != set.Keys[0].Kid || parsed.Header["typ"] != token.ReplicaType {
		t.Errorf("header %v; want the signing key's kid, %s, and typ %s", parsed.Header, set.Keys[0].Kid, token.ReplicaType)
	}
	if claims["sub"] != user.String() {
		t.Errorf("sub %v", claims["sub"])
	}
	for _, name := range []string{"sub", "aud", "iat", "exp"} {
		if _, ok := claims[name]; !ok {
			t.Errorf("no %s", name)
		}
		delete(claims, name)
	}
	if len(claims) > 0 {
		t.Errorf("further claims: %v", claims)
	}
	if _, _, err := k.Replica(user, "", now, time.Minute); err == nil {
		t.Error("a replica's token without an audience")
	}
}

func TestKeysAreReadFromBase64Seeds(t *testing.T) {
	a, b := seed(3), seed(4)
	k, err := token.ParseKeys(" " + base64.StdEncoding.EncodeToString(a) + ", " + base64.RawURLEncoding.EncodeToString(b) + ",")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := keys(t, b).Issue(uuid.New(), uuid.New(), now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := k.Verify(raw, now); err != nil {
		t.Fatalf("the second key: %v", err)
	}
	secret := base64.StdEncoding.EncodeToString(a[:20])
	for _, bad := range []string{"", ",", "not base64!", secret, base64.StdEncoding.EncodeToString(a) + "," + base64.StdEncoding.EncodeToString(a)} {
		_, err := token.ParseKeys(bad)
		if err == nil {
			t.Errorf("%q: no error", bad)
			continue
		}
		if quoted := strings.Split(bad, ",")[0]; quoted != "" && strings.Contains(err.Error(), quoted) {
			t.Errorf("the error quotes the key: %v", err)
		}
	}
}
