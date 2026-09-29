// Package federationtest is an OpenID Connect identity provider for tests: a discovery document,
// its signing keys, and a token endpoint that redeems a code once, for the client it was issued
// to, at the redirect URI it was issued for, with the verifier its PKCE challenge names, and
// answers with an ID token carrying the nonce the authorization asked for. The authorization
// step, a person signing in at the provider, is Authorize: the test names who signs in.
package federationtest

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Person is who signs in at the provider.
type Person struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
}

// Provider is the test's identity provider.
type Provider struct {
	*httptest.Server
	t   testing.TB
	key *rsa.PrivateKey
	// ClientID and ClientSecret are what the provider knows the server by; a secret of "" takes
	// any, as Apple's signed secrets are taken here.
	ClientID, ClientSecret string
	// Now is the provider's clock, for the ID token's times; time.Now when nil.
	Now func() time.Time

	mu     sync.Mutex
	grants map[string]grant
	// Redeemed counts the codes redeemed.
	Redeemed int
}

type grant struct {
	person                            Person
	clientID, redirect, nonce, method string
	challenge                         string
}

// New starts a provider for clientID and clientSecret, which stops when t ends.
func New(t testing.TB, clientID, clientSecret string) *Provider {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	p := &Provider{t: t, key: key, ClientID: clientID, ClientSecret: clientSecret, grants: map[string]grant{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/openid-configuration", p.discovery)
	mux.HandleFunc("GET /keys", p.keys)
	mux.HandleFunc("POST /token", p.token)
	p.Server = httptest.NewServer(mux)
	t.Cleanup(p.Close)
	return p
}

// Issuer is the provider's issuer URL.
func (p *Provider) Issuer() string { return p.URL }

func (p *Provider) now() time.Time {
	if p.Now != nil {
		return p.Now()
	}
	return time.Now()
}

func (p *Provider) discovery(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"issuer":                                p.URL,
		"authorization_endpoint":                p.URL + "/authorize",
		"token_endpoint":                        p.URL + "/token",
		"jwks_uri":                              p.URL + "/keys",
		"id_token_signing_alg_values_supported": []string{"RS256"},
		"response_types_supported":              []string{"code"},
		"subject_types_supported":               []string{"public"},
	})
}

func (p *Provider) keys(w http.ResponseWriter, _ *http.Request) {
	pub := p.key.PublicKey
	writeJSON(w, http.StatusOK, map[string]any{"keys": []map[string]string{{
		"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "test",
		"n": base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
		"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
	}}})
}

// Authorize is person signing in at the authorization URL the server gave: it returns the code
// and the state the provider sends back to the redirect URI.
func (p *Provider) Authorize(authURL string, person Person) (code, state string) {
	p.t.Helper()
	u, err := url.Parse(authURL)
	if err != nil {
		p.t.Fatal(err)
	}
	if u.Scheme+"://"+u.Host != p.URL || u.Path != "/authorize" {
		p.t.Fatalf("the authorization URL %s is not this provider's", authURL)
	}
	q := u.Query()
	if q.Get("response_type") != "code" || q.Get("client_id") != p.ClientID {
		p.t.Fatalf("the authorization URL asks for %q for %q", q.Get("response_type"), q.Get("client_id"))
	}
	code = rand.Text()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.grants[code] = grant{person: person, clientID: q.Get("client_id"), redirect: q.Get("redirect_uri"), nonce: q.Get("nonce"),
		challenge: q.Get("code_challenge"), method: q.Get("code_challenge_method")}
	return code, q.Get("state")
}

func (p *Provider) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	f := r.PostForm
	p.mu.Lock()
	g, ok := p.grants[f.Get("code")]
	delete(p.grants, f.Get("code"))
	p.mu.Unlock()
	sum := sha256.Sum256([]byte(f.Get("code_verifier")))
	switch {
	case f.Get("grant_type") != "authorization_code" || f.Get("client_id") != p.ClientID ||
		(p.ClientSecret != "" && f.Get("client_secret") != p.ClientSecret) || f.Get("client_secret") == "":
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_client"})
		return
	case !ok || g.redirect != f.Get("redirect_uri") || g.method != "S256" ||
		g.challenge != base64.RawURLEncoding.EncodeToString(sum[:]):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
		return
	}
	now := p.now()
	claims := jwt.MapClaims{"iss": p.URL, "aud": g.clientID, "sub": g.person.Subject, "iat": now.Unix(),
		"exp": now.Add(time.Hour).Unix(), "nonce": g.nonce, "email_verified": g.person.EmailVerified}
	if g.person.Email != "" {
		claims["email"] = g.person.Email
	}
	if g.person.Name != "" {
		claims["name"] = g.person.Name
	}
	t := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	t.Header["kid"] = "test"
	idToken, err := t.SignedString(p.key)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	p.mu.Lock()
	p.Redeemed++
	p.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"access_token": rand.Text(), "token_type": "Bearer", "expires_in": 3600, "id_token": idToken})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
