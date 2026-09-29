// Package identity is the account half of PRD 02 (plan items 8 and 9): registering with an address
// and a password, verifying the address, signing in on the web or on a device and out again,
// refreshing a device's tokens, resetting and changing a password, the second step, signing in
// with Google or Apple, and the signed-in user's own profile, sessions and devices, under /auth
// and /me.
//
// Every surface a person reaches before signing in answers alike whether or not an account has
// the address it names (D-13): registering and the two email requests always answer 202, a
// sign-in's every failure is one 401 in one time, and the throttles that refuse them count the
// address asked for, not an account. What differs is only what arrives in the mailbox, and the
// work that decides it runs after the response (Background).
//
// These tables are global (PRD 01 §2.4), so this package writes them through tenant.AccountTx
// rather than the mutation spine, which records a household's history: an account's changes are
// no household's to read.
package identity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/text/language"

	"github.com/kareltilcer/household/server/internal/platform/clientip"
	"github.com/kareltilcer/household/server/internal/platform/device"
	"github.com/kareltilcer/household/server/internal/platform/federation"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/mfa"
	"github.com/kareltilcer/household/server/internal/platform/password"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/text"
)

// How long an email's link works (FR-ID1, FR-ID6).
const (
	VerifyFor = 24 * time.Hour
	ResetFor  = time.Hour
)

// The emails, and the web client's routes their links open (docs/design A-1, A-9, A-10).
const (
	emailVerify           mail.Template = "email.verify_email"
	emailRegisterExisting mail.Template = "email.register_existing"
	emailReset            mail.Template = "email.password_reset"
	emailPasswordChanged  mail.Template = "email.password_changed"
	emailTokenReuse       mail.Template = "email.token_reuse" //nolint:gosec // G101: a template's name, not a credential.
	emailRecoveryCodeUsed mail.Template = "email.recovery_code_used"
	emailMFADisabled      mail.Template = "email.mfa_disabled"
	emailIdentityLinked   mail.Template = "email.identity_linked"

	routeVerify      = "verify-email"
	routeSignIn      = "sign-in"
	routeReset       = "reset"
	routeSetPassword = "reset/set"
)

// Config is what the service needs.
type Config struct {
	Pool tenant.Beginner
	Log  *slog.Logger
	// Hasher hashes and checks passwords.
	Hasher *password.Hasher
	// Breached reports whether a password is in the breached-password corpus. Nil screens
	// nothing, which only development may run with (config).
	Breached  func(string) (bool, error)
	Throttles *ratelimit.Throttles
	Sessions  *session.Store
	Mail      mail.Sender
	Catalogs  *i18n.Catalogs
	// WebURL is where the web client is served, which an email's links open.
	WebURL   *url.URL
	ClientIP *clientip.Resolver
	// Later runs fn after the response, with ctx's values: Background.Run.
	Later func(ctx context.Context, fn func(context.Context))
	// Devices are the mobile devices' sign-ins (item 9).
	Devices *device.Store
	// MFA seals the second step's secrets and hashes its recovery codes.
	MFA *mfa.Keys
	// Providers are the identity providers the server is configured for, by name; one left out
	// answers 404.
	Providers map[string]*federation.Provider
	// RedirectURIs are the URIs a provider may send a person back to, each matched exactly.
	RedirectURIs []string
}

// Service serves the routes.
type Service struct {
	Config
	// confirming are the reset links a confirmation is at work on in this process.
	confirming turns
}

// New returns the service.
func New(cfg Config) (*Service, error) {
	if cfg.Pool == nil || cfg.Log == nil || cfg.Hasher == nil || cfg.Throttles == nil || cfg.Sessions == nil ||
		cfg.Mail == nil || cfg.Catalogs == nil || cfg.WebURL == nil || cfg.ClientIP == nil || cfg.Later == nil ||
		cfg.Devices == nil || cfg.MFA == nil {
		return nil, errors.New("identity: the service is missing a dependency")
	}
	return &Service{Config: cfg}, nil
}

// PublicRoutes registers the routes a person reaches before signing in, on the API's router. None
// reads a session or an access token, and none keeps an Idempotency-Key (ADR 0009).
func (s *Service) PublicRoutes(r chi.Router) {
	r.Post("/auth/register", s.register)
	r.Post("/auth/verify-email", s.verifyEmail)
	r.Post("/auth/verify-email/resend", s.resendVerification)
	r.Post("/auth/login", s.login)
	r.Post("/auth/token", s.refresh)
	r.Post("/auth/password-reset", s.requestReset)
	r.Post("/auth/password-reset/confirm", s.confirmReset)
	r.Post("/auth/mfa/verify", s.verifyMFA)
	r.Post("/auth/oauth/{provider}/callback", s.oauthCallback)
}

// OptionalRoutes registers the routes a person reaches signed in or not, on the API's router, behind
// the authentication but no check that there is a caller, and keeping no Idempotency-Key: beginning
// a sign-in with a provider, which a signed-in user begins in order to link one.
func (s *Service) OptionalRoutes(r chi.Router) {
	r.Post("/auth/oauth/{provider}/start", s.oauthStart)
}

// AccountRoutes registers the routes a signed-in user calls about their own account, on the API's
// router, behind the authentication, a check that there is a caller, and the account's
// Idempotency-Key.
func (s *Service) AccountRoutes(r chi.Router) {
	r.Post("/auth/logout", s.logout)
	r.Get("/me", s.me)
	r.Patch("/me", s.updateMe)
	r.Get("/me/sessions", s.sessions)
	r.Delete("/me/sessions", s.signOutEverywhere)
	r.Delete("/me/sessions/{session_id}", s.revokeSession)
	r.Get("/me/devices", s.devices)
	r.Patch("/me/devices/{device_id}", s.renameDevice)
	r.Delete("/me/devices/{device_id}", s.revokeDevice)
	r.Post("/auth/mfa/activate", s.activateMFA)
	r.Post("/auth/oauth/{provider}/link", s.oauthLink)
	r.Delete("/auth/oauth/{provider}", s.oauthUnlink)
}

// PasswordRoutes registers the account routes whose body carries a password, on the API's router,
// behind the authentication and a check that there is a caller, but not the account's
// Idempotency-Key: a key's fingerprint is a fast hash of the body, and so of the password, which
// is kept for no request (D-97).
func (s *Service) PasswordRoutes(r chi.Router) {
	r.Post("/auth/password", s.changePassword)
	r.Post("/auth/mfa/enroll", s.enrollMFA)
	r.Post("/auth/mfa/disable", s.disableMFA)
	r.Post("/auth/mfa/recovery-codes", s.newRecoveryCodes)
}

// fail answers err's problem, or 500 for an error that is not one, which it logs.
func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	var p *problem.Problem
	if !errors.As(err, &p) {
		s.Log.LogAttrs(r.Context(), slog.LevelError, "identity request failed", slog.Any("error", err))
	}
	problem.Write(w, reqctx.RequestID(r.Context()), err)
}

// decode reads r's JSON body into v. The edge has held it to the contract already, so a body that
// does not decode is refused as the edge refuses one.
func decode(r *http.Request, v any) error {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed})
	}
	return nil
}

// invalid is the 422 naming field with code.
func invalid(field, code string) *problem.Problem {
	return problem.Validation(problem.FieldError{Field: field, Code: code})
}

// InvalidCredentials is every sign-in's one failure (FR-ID3), a child profile's PIN's among them
// (internal/platform/household).
func InvalidCredentials() *problem.Problem {
	return problem.New(http.StatusUnauthorized, problem.CodeInvalidCredentials)
}

// subject is an address as a throttle counts it: the same however it is cased.
func subject(email string) string { return strings.ToLower(email) }

// network is the client's network, as a throttle counts it.
func (s *Service) network(r *http.Request) string { return clientip.Network(s.ClientIP.Addr(r)) }

// link is the web client's route, with token in its fragment, which a browser sends to no
// server, so that it stays out of every access log and Referer on the way.
func (s *Service) link(route, token string) string {
	u := *s.WebURL
	u.Path = strings.TrimSuffix(u.Path, "/") + "/" + route
	u.RawQuery = ""
	u.Fragment = ""
	if token != "" {
		u.Fragment = "token=" + token
	}
	return u.String()
}

// deliver renders t in the language of locale, with its link and any further args, and sends it to
// to. A failure is logged: the person asks again.
func (s *Service) deliver(ctx context.Context, to, locale string, t mail.Template, link string, args ...i18n.Args) {
	all := i18n.Args{"link": link}
	for _, a := range args {
		maps.Copy(all, a)
	}
	m, err := mail.Render(s.Catalogs, i18n.Match(locale), t, all, to)
	if err == nil {
		err = s.Mail.Send(ctx, m)
	}
	if err != nil {
		s.Log.LogAttrs(ctx, slog.LevelError, "email not sent", slog.String("template", string(t)), slog.Any("error", err))
	}
}

// email sends t after the response.
func (s *Service) email(ctx context.Context, to, locale string, t mail.Template, link string, args ...i18n.Args) {
	s.Later(ctx, func(ctx context.Context) { s.deliver(ctx, to, locale, t, link, args...) })
}

// notice sends user t after the response, at their address and in their language as they stand
// then; an account with no address, a child's, is sent nothing. Each is a notice that something
// was done to the account, whose link asks for a password reset: the way back for an owner who did
// not do it.
func (s *Service) notice(ctx context.Context, user uuid.UUID, t mail.Template, args ...i18n.Args) {
	s.Later(ctx, func(ctx context.Context) {
		var (
			address  *string
			language string
		)
		err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, "SELECT email, locale FROM users WHERE id = $1", user).Scan(&address, &language)
		})
		if err != nil {
			s.Log.LogAttrs(ctx, slog.LevelError, "email not sent", slog.String("template", string(t)), slog.Any("error", err))
			return
		}
		if address != nil {
			s.deliver(ctx, *address, language, t, s.link(routeReset, ""), args...)
		}
	})
}

// screen refuses a password shorter than password.MinLength characters, which the edge refuses
// already, and one found in the breached-password corpus, naming field. Both see the password as
// it is hashed, normalised.
func (s *Service) screen(field, pw string) error {
	pw = password.Normalize(pw)
	if utf8.RuneCountInString(pw) < password.MinLength {
		return invalid(field, "min_length")
	}
	if s.Breached == nil {
		return nil
	}
	breached, err := s.Breached(pw)
	if err != nil {
		return fmt.Errorf("identity: screen a password: %w", err)
	}
	if breached {
		return invalid(field, problem.FieldInvalid)
	}
	return nil
}

// issueToken writes a token for purpose to user's address email, valid for ttl, and returns it: a
// session's kind of token, kept as a session's is, by its hash.
func issueToken(ctx context.Context, tx pgx.Tx, user uuid.UUID, purpose, email string, ttl time.Duration, now time.Time) (string, error) {
	token := session.NewToken()
	_, err := tx.Exec(ctx, `
		INSERT INTO email_tokens (id, user_id, purpose, token_hash, email, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		idgen.New(), user, purpose, session.Hash(token), email, now, now.Add(ttl))
	return token, err
}

// displayName is name as an account keeps it, and false when it is not one (text.Name).
func displayName(name string) (string, bool) { return text.Name(name) }

// maxDisplayName is the longest name an account keeps, in characters: the contract's maxLength.
const maxDisplayName = 80

// cut is s cut to at most n characters, and trimmed again where it was cut.
func cut(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return strings.TrimSpace(string([]rune(s)[:n]))
}

// locale is tag in its canonical form, and false when it is not one (i18n.Canonical).
func locale(tag string) (string, bool) { return i18n.Canonical(tag) }

// preferredLocale is the language of r's Accept-Language that Household ships, else English: a
// new account's, when the request names none.
func preferredLocale(r *http.Request) string {
	tags, _, _ := language.ParseAcceptLanguage(r.Header.Get("Accept-Language"))
	preferences := make([]string, 0, len(tags))
	for _, t := range tags {
		preferences = append(preferences, t.String())
	}
	return string(i18n.Match(preferences...))
}

// turns lets the requests that name one key act on it one at a time, in this process, a waiting
// request holding nothing else meanwhile. The zero value is ready to use.
type turns struct {
	mu   sync.Mutex
	keys map[string]*turn
}

// turn is one key's: a slot its holder fills, and how many requests hold or wait for it.
type turn struct {
	slot    chan struct{}
	waiting int
}

// take waits for key's turn, or for ctx to end, and returns what ends the turn. A request whose
// context has already ended takes no turn, even one that is free.
func (t *turns) take(ctx context.Context, key string) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	t.mu.Lock()
	if t.keys == nil {
		t.keys = map[string]*turn{}
	}
	k := t.keys[key]
	if k == nil {
		k = &turn{slot: make(chan struct{}, 1)}
		t.keys[key] = k
	}
	k.waiting++
	t.mu.Unlock()
	leave := func() {
		t.mu.Lock()
		if k.waiting--; k.waiting == 0 {
			delete(t.keys, key)
		}
		t.mu.Unlock()
	}
	select {
	case k.slot <- struct{}{}:
		return func() {
			<-k.slot
			leave()
		}, nil
	case <-ctx.Done():
		leave()
		return nil, ctx.Err()
	}
}

// timezone reports whether name is an IANA timezone the binary knows (i18n.Timezone).
func timezone(name string) bool { return i18n.Timezone(name) }
