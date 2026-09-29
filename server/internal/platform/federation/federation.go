// Package federation signs a person in with an identity provider, Google or Apple (FR-ID2): the
// OpenID Connect authorization-code flow with PKCE, the client holding the verifier and the server
// the client's secret, which a mobile or a web client cannot keep.
//
// The client begins: it names the redirect URI and its PKCE challenge, and the server returns the
// provider's authorization URL, carrying a state and a nonce of the server's own. The provider
// sends the person back to the redirect URI with a code, which the client hands the server with
// its verifier; the server checks the verifier against the challenge it was given, redeems the
// code at the provider's token endpoint, and verifies the ID token that comes back: its signature
// against the provider's published keys, its issuer, its audience, its expiry and the nonce. What
// it vouches for is the provider's subject, `sub`, the stable identifier of the person there, and
// the address the provider holds for them, with whether it verified it.
//
// A provider's endpoints and keys come from its discovery document, fetched on first use and kept,
// so that the server starts without reaching the provider and a failed fetch is tried again by the
// next sign-in.
package federation

import (
	"context"
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/oauth2"
)

// The providers, as the contract's path names them.
const (
	Google = "google"
	Apple  = "apple"
)

// The providers' issuers, whose discovery documents name their endpoints.
const (
	GoogleIssuer = "https://accounts.google.com"
	AppleIssuer  = "https://appleid.apple.com"
)

// Config is how the server is known to a provider.
type Config struct {
	// Issuer is the provider's issuer URL; GoogleIssuer or AppleIssuer when empty.
	Issuer   string
	ClientID string
	// ClientSecret is Google's client secret.
	ClientSecret string
	// Apple, for Apple, signs the client secret Apple takes in its place: a short-lived JWT.
	Apple *AppleKey
	// HTTP makes the requests to the provider; a client with a ten-second timeout when nil.
	HTTP *http.Client
	// Now is the clock the ID token is checked against; time.Now when nil.
	Now func() time.Time
}

// AppleKey is the key Apple issued the team to sign its client secrets with.
type AppleKey struct {
	TeamID, KeyID string
	Key           *ecdsa.PrivateKey
}

// ParseAppleKey reads the .p8 key Apple issues, a PKCS #8 P-256 key in PEM.
func ParseAppleKey(data string) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(data))
	if block == nil {
		return nil, errors.New("federation: the Apple key is not PEM")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("federation: the Apple key is not a PKCS #8 key")
	}
	ec, ok := key.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("federation: the Apple key is not an ECDSA key")
	}
	return ec, nil
}

// Provider is one identity provider.
type Provider struct {
	name string
	cfg  Config

	mu       sync.Mutex
	endpoint oauth2.Endpoint
	verifier *oidc.IDTokenVerifier
}

// New returns the provider name, google or apple, as cfg configures it.
func New(name string, cfg Config) (*Provider, error) {
	switch name {
	case Google:
		if cfg.ClientSecret == "" {
			return nil, errors.New("federation: Google needs a client secret")
		}
		if cfg.Issuer == "" {
			cfg.Issuer = GoogleIssuer
		}
	case Apple:
		if cfg.Apple == nil || cfg.Apple.Key == nil || cfg.Apple.TeamID == "" || cfg.Apple.KeyID == "" {
			return nil, errors.New("federation: Apple needs a team id, a key id and a key")
		}
		if cfg.Issuer == "" {
			cfg.Issuer = AppleIssuer
		}
	default:
		return nil, fmt.Errorf("federation: no provider %q", name)
	}
	if cfg.ClientID == "" {
		return nil, fmt.Errorf("federation: %s needs a client id", name)
	}
	if cfg.HTTP == nil {
		cfg.HTTP = &http.Client{Timeout: 10 * time.Second}
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Provider{name: name, cfg: cfg}, nil
}

// Name is the provider's name.
func (p *Provider) Name() string { return p.name }

// discover returns the provider's endpoints and its ID token verifier, fetching its discovery
// document the first time it is asked, and again after a failure. The fetch is made outside the
// lock, so that sign-ins begun while the provider is slow or down each wait for their own fetch,
// not for one another's in turn; the first to finish is kept.
func (p *Provider) discover(ctx context.Context) (oauth2.Endpoint, *oidc.IDTokenVerifier, error) {
	p.mu.Lock()
	endpoint, verifier := p.endpoint, p.verifier
	p.mu.Unlock()
	if verifier != nil {
		return endpoint, verifier, nil
	}
	provider, err := oidc.NewProvider(oidc.ClientContext(ctx, p.cfg.HTTP), p.cfg.Issuer)
	if err != nil {
		return oauth2.Endpoint{}, nil, fmt.Errorf("federation: discover %s: %w", p.name, err)
	}
	endpoint = provider.Endpoint()
	// The client secret goes in the body: Apple takes it nowhere else.
	endpoint.AuthStyle = oauth2.AuthStyleInParams
	verifier = provider.Verifier(&oidc.Config{ClientID: p.cfg.ClientID, Now: p.cfg.Now})
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.verifier == nil {
		p.endpoint, p.verifier = endpoint, verifier
	}
	return p.endpoint, p.verifier, nil
}

// scopes are what the server asks the provider for: who the person is, their address, and for
// Google their name. Apple gives a name only to the client, once, on the first sign-in.
func (p *Provider) scopes() []string {
	if p.name == Apple {
		return []string{oidc.ScopeOpenID, "email", "name"}
	}
	return []string{oidc.ScopeOpenID, oidc.ScopeEmail, oidc.ScopeProfile}
}

func (p *Provider) oauth(ctx context.Context, redirectURI string) (*oauth2.Config, *oidc.IDTokenVerifier, error) {
	endpoint, verifier, err := p.discover(ctx)
	if err != nil {
		return nil, nil, err
	}
	return &oauth2.Config{ClientID: p.cfg.ClientID, ClientSecret: p.cfg.ClientSecret, Endpoint: endpoint,
		RedirectURL: redirectURI, Scopes: p.scopes()}, verifier, nil
}

// AuthURL returns the provider's authorization URL for a sign-in the client began with challenge,
// its S256 PKCE challenge, returning to redirectURI, which the provider sends back with state and
// whose ID token must carry nonce.
func (p *Provider) AuthURL(ctx context.Context, redirectURI, state, nonce, challenge string) (string, error) {
	cfg, _, err := p.oauth(ctx, redirectURI)
	if err != nil {
		return "", err
	}
	options := []oauth2.AuthCodeOption{
		oidc.Nonce(nonce),
		oauth2.SetAuthURLParam("code_challenge", challenge),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
	}
	if p.name == Apple {
		// Apple answers a request for the email or name scope only as a form posted to the
		// redirect URI.
		options = append(options, oauth2.SetAuthURLParam("response_mode", "form_post"))
	}
	return cfg.AuthCodeURL(state, options...), nil
}

// Identity is what a provider vouches for.
type Identity struct {
	// Subject is the person's stable identifier at the provider.
	Subject string
	// Email is the address the provider holds for them, "" for none, and EmailVerified whether
	// the provider verified it.
	Email         string
	EmailVerified bool
	// Name is their name as the provider gives it, "" for none.
	Name string
}

// ErrRefused is Exchange's answer when the provider does not vouch for the sign-in: it refused the
// code, or its ID token is another sign-in's, carrying another nonce. Anything else that stops an
// exchange is about the server, not the person, and is another error, the server's: the provider
// refusing the server's credentials or its request, or turning it away, and an ID token the server
// cannot verify.
var ErrRefused = errors.New("federation: the provider did not vouch for the sign-in")

// Exchange redeems code, which the provider sent to redirectURI, with verifier, and returns what
// the ID token that comes back vouches for, once it has verified it and found nonce in it.
func (p *Provider) Exchange(ctx context.Context, code, redirectURI, verifier, nonce string) (Identity, error) {
	cfg, idVerifier, err := p.oauth(ctx, redirectURI)
	if err != nil {
		return Identity{}, err
	}
	if p.cfg.Apple != nil {
		if cfg.ClientSecret, err = p.appleSecret(); err != nil {
			return Identity{}, err
		}
	}
	ctx = oidc.ClientContext(ctx, p.cfg.HTTP)
	tok, err := cfg.Exchange(ctx, code, oauth2.VerifierOption(verifier))
	if err != nil {
		// invalid_grant is the provider refusing the code, which refuses the sign-in: unknown,
		// spent or expired, or redeemed with another verifier or redirect URI (RFC 6749 §5.2).
		// Every other answer is about the server's request, not the person's: its client id or its
		// secret, Apple's signed one included, a parameter it sent, or the provider turning it
		// away, 429 among them. No one signs in past it until it is mended or passes, and it is
		// the server's error, logged.
		var refused *oauth2.RetrieveError
		if errors.As(err, &refused) && refused.ErrorCode == "invalid_grant" {
			return Identity{}, ErrRefused
		}
		return Identity{}, fmt.Errorf("federation: redeem a %s code: %w", p.name, err)
	}
	// The ID token comes from the provider itself, in the answer to the server's own request, so one
	// that is missing or does not verify is the server's to look into, not the person's doing: the
	// provider's keys unreachable, the server's clock wrong, or its configuration. Only one carrying
	// another nonce is a refusal, a code from another sign-in than the one this state began.
	raw, _ := tok.Extra("id_token").(string)
	if raw == "" {
		return Identity{}, fmt.Errorf("federation: %s answered no ID token", p.name)
	}
	idToken, err := idVerifier.Verify(ctx, raw)
	if err != nil {
		return Identity{}, fmt.Errorf("federation: verify a %s ID token: %w", p.name, err)
	}
	if subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(nonce)) != 1 {
		return Identity{}, ErrRefused
	}
	if idToken.Subject == "" {
		return Identity{}, fmt.Errorf("federation: a %s ID token names no subject", p.name)
	}
	var claims struct {
		Email string `json:"email"`
		// Apple writes it as a string, "true", and Google as a boolean.
		EmailVerified json.RawMessage `json:"email_verified"`
		Name          string          `json:"name"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return Identity{}, fmt.Errorf("federation: read a %s ID token's claims: %w", p.name, err)
	}
	verified := string(claims.EmailVerified) == "true" || string(claims.EmailVerified) == `"true"`
	return Identity{Subject: idToken.Subject, Email: claims.Email, EmailVerified: verified, Name: claims.Name}, nil
}

// appleSecret is the client secret Apple takes: a JWT the team's key signs, naming the team and the
// client, for Apple, valid five minutes.
func (p *Provider) appleSecret() (string, error) {
	now := p.cfg.Now()
	t := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.RegisteredClaims{
		Issuer:    p.cfg.Apple.TeamID,
		Subject:   p.cfg.ClientID,
		Audience:  jwt.ClaimStrings{p.cfg.Issuer},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
	})
	t.Header["kid"] = p.cfg.Apple.KeyID
	secret, err := t.SignedString(p.cfg.Apple.Key)
	if err != nil {
		return "", fmt.Errorf("federation: sign Apple's client secret: %w", err)
	}
	return secret, nil
}

// verifierPattern is an RFC 7636 code verifier: 43 to 128 unreserved characters.
var verifierPattern = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)

// ValidVerifier reports whether verifier is an RFC 7636 code verifier.
func ValidVerifier(verifier string) bool { return verifierPattern.MatchString(verifier) }

// Challenge is verifier's S256 challenge (RFC 7636 §4.2).
func Challenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
