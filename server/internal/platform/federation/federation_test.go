package federation_test

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"net/url"
	"strings"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/federation"
	"github.com/kareltilcer/household/server/internal/platform/federation/federationtest"
)

const redirect = "https://app.household.test/sign-in/google"

var verifier = strings.Repeat("v", 43)

func google(t *testing.T) (*federation.Provider, *federationtest.Provider) {
	t.Helper()
	idp := federationtest.New(t, "household-web", "the-secret")
	p, err := federation.New(federation.Google, federation.Config{Issuer: idp.Issuer(), ClientID: "household-web", ClientSecret: "the-secret"})
	if err != nil {
		t.Fatal(err)
	}
	return p, idp
}

func TestASignInIsVouchedFor(t *testing.T) {
	p, idp := google(t)
	authURL, err := p.AuthURL(t.Context(), redirect, "the-state", "the-nonce", federation.Challenge(verifier))
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(authURL)
	if q := u.Query(); q.Get("scope") != "openid email profile" || q.Get("nonce") != "the-nonce" || q.Get("response_mode") != "" {
		t.Fatalf("%s", authURL)
	}
	code, state := idp.Authorize(authURL, federationtest.Person{Subject: "g-1", Email: "jana@example.test", EmailVerified: true, Name: "Jana"})
	if state != "the-state" {
		t.Fatalf("state %q", state)
	}
	id, err := p.Exchange(t.Context(), code, redirect, verifier, "the-nonce")
	if err != nil {
		t.Fatal(err)
	}
	if id != (federation.Identity{Subject: "g-1", Email: "jana@example.test", EmailVerified: true, Name: "Jana"}) {
		t.Fatalf("%+v", id)
	}
	// A code is redeemed once.
	if _, err := p.Exchange(t.Context(), code, redirect, verifier, "the-nonce"); !errors.Is(err, federation.ErrRefused) {
		t.Fatalf("a code redeemed twice: %v", err)
	}
}

func TestASignInTheProviderDoesNotVouchForIsRefused(t *testing.T) {
	p, idp := google(t)
	begin := func() string {
		authURL, err := p.AuthURL(t.Context(), redirect, "s", "the-nonce", federation.Challenge(verifier))
		if err != nil {
			t.Fatal(err)
		}
		code, _ := idp.Authorize(authURL, federationtest.Person{Subject: "g-1"})
		return code
	}
	cases := map[string]func() error{
		"another verifier": func() error {
			_, err := p.Exchange(t.Context(), begin(), redirect, strings.Repeat("w", 43), "the-nonce")
			return err
		},
		"another redirect URI": func() error {
			_, err := p.Exchange(t.Context(), begin(), redirect+"/other", verifier, "the-nonce")
			return err
		},
		"another nonce": func() error {
			_, err := p.Exchange(t.Context(), begin(), redirect, verifier, "another-nonce")
			return err
		},
		"an unknown code": func() error {
			_, err := p.Exchange(t.Context(), "made-up", redirect, verifier, "the-nonce")
			return err
		},
	}
	for name, exchange := range cases {
		if err := exchange(); !errors.Is(err, federation.ErrRefused) {
			t.Errorf("%s: %v", name, err)
		}
	}
	// An ID token for another client is refused too.
	other, err := federation.New(federation.Google, federation.Config{Issuer: idp.Issuer(), ClientID: "someone-else", ClientSecret: "the-secret"})
	if err != nil {
		t.Fatal(err)
	}
	idp.ClientID = "someone-else"
	authURL, _ := other.AuthURL(t.Context(), redirect, "s", "n", federation.Challenge(verifier))
	code, _ := idp.Authorize(authURL, federationtest.Person{Subject: "g-1"})
	idp.ClientID = "household-web"
	if _, err := other.Exchange(t.Context(), code, redirect, verifier, "n"); err == nil {
		t.Fatal("a token for another client was taken")
	}
}

func TestAppleIsAskedForAFormPostAndSentASignedSecret(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := federation.ParseAppleKey(string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})))
	if err != nil {
		t.Fatal(err)
	}
	idp := federationtest.New(t, "com.household.web", "")
	p, err := federation.New(federation.Apple, federation.Config{Issuer: idp.Issuer(), ClientID: "com.household.web",
		Apple: &federation.AppleKey{TeamID: "TEAM", KeyID: "KEY", Key: parsed}})
	if err != nil {
		t.Fatal(err)
	}
	authURL, err := p.AuthURL(t.Context(), redirect, "s", "n", federation.Challenge(verifier))
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(authURL)
	if q := u.Query(); q.Get("response_mode") != "form_post" || q.Get("scope") != "openid email name" {
		t.Fatalf("%s", authURL)
	}
	code, _ := idp.Authorize(authURL, federationtest.Person{Subject: "a-1", Email: "x@privaterelay.appleid.com", EmailVerified: true})
	id, err := p.Exchange(t.Context(), code, redirect, verifier, "n")
	if err != nil || id.Subject != "a-1" || !id.EmailVerified {
		t.Fatalf("%+v %v", id, err)
	}
	if _, err := federation.ParseAppleKey("not a key"); err == nil {
		t.Fatal("a key that is not PEM was read")
	}
}

func TestVerifiers(t *testing.T) {
	for v, want := range map[string]bool{
		verifier:                      true,
		strings.Repeat("a", 128):      true,
		strings.Repeat("a", 42):       false,
		strings.Repeat("a", 129):      false,
		strings.Repeat("a", 42) + "!": false,
	} {
		if federation.ValidVerifier(v) != want {
			t.Errorf("%q: %v", v, !want)
		}
	}
	// RFC 7636 Appendix B's example.
	if got := federation.Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"); got != "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" {
		t.Fatalf("%s", got)
	}
}
