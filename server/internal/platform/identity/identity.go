// Package identity is the account half of PRD 02 (plan item 8): registering with an address and a
// password, verifying the address, signing in on the web and out again, resetting and changing a
// password, and the signed-in user's own profile and sessions, under /auth and /me.
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
	"net/http"
	"net/url"
	"strings"
	"time"
	_ "time/tzdata" // An IANA name is checked against the zones the binary carries, wherever it runs.
	"unicode"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/text/language"

	"github.com/kareltilcer/household/server/internal/platform/clientip"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/password"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
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
}

// Service serves the routes.
type Service struct{ Config }

// New returns the service.
func New(cfg Config) (*Service, error) {
	if cfg.Pool == nil || cfg.Log == nil || cfg.Hasher == nil || cfg.Throttles == nil || cfg.Sessions == nil ||
		cfg.Mail == nil || cfg.Catalogs == nil || cfg.WebURL == nil || cfg.ClientIP == nil || cfg.Later == nil {
		return nil, errors.New("identity: the service is missing a dependency")
	}
	return &Service{cfg}, nil
}

// PublicRoutes registers the routes a person reaches before signing in, on the API's router. None
// reads a session, and none keeps an Idempotency-Key (ADR 0009).
func (s *Service) PublicRoutes(r chi.Router) {
	r.Post("/auth/register", s.register)
	r.Post("/auth/verify-email", s.verifyEmail)
	r.Post("/auth/verify-email/resend", s.resendVerification)
	r.Post("/auth/login", s.login)
	r.Post("/auth/password-reset", s.requestReset)
	r.Post("/auth/password-reset/confirm", s.confirmReset)
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
}

// PasswordRoutes registers the account routes whose body carries a password, on the API's router,
// behind the authentication and a check that there is a caller, but not the account's
// Idempotency-Key: a key's fingerprint is a fast hash of the body, and so of the password, which
// is kept for no request (D-97).
func (s *Service) PasswordRoutes(r chi.Router) {
	r.Post("/auth/password", s.changePassword)
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

// invalidCredentials is every sign-in's one failure (FR-ID3).
func invalidCredentials() *problem.Problem {
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

// deliver renders t in the language of locale, with its link, and sends it to to. A failure is
// logged: the person asks again.
func (s *Service) deliver(ctx context.Context, to, locale string, t mail.Template, link string) {
	m, err := mail.Render(s.Catalogs, i18n.Match(locale), t, i18n.Args{"link": link}, to)
	if err == nil {
		err = s.Mail.Send(ctx, m)
	}
	if err != nil {
		s.Log.LogAttrs(ctx, slog.LevelError, "email not sent", slog.String("template", string(t)), slog.Any("error", err))
	}
}

// email sends t after the response.
func (s *Service) email(ctx context.Context, to, locale string, t mail.Template, link string) {
	s.Later(ctx, func(ctx context.Context) { s.deliver(ctx, to, locale, t, link) })
}

// screen refuses a password found in the breached-password corpus, naming field.
func (s *Service) screen(field, pw string) error {
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

// displayName is name as an account keeps it, trimmed, and false when nothing is left or it
// holds a control character or a line break, U+2028 and U+2029 among them.
func displayName(name string) (string, bool) {
	name = strings.TrimSpace(name)
	return name, name != "" && strings.IndexFunc(name, func(r rune) bool {
		return unicode.IsControl(r) || unicode.In(r, unicode.Zl, unicode.Zp)
	}) < 0
}

// maxLocale is the longest language tag kept, in characters.
const maxLocale = 64

// locale is tag in its canonical form, and false when it is not a BCP 47 tag or does not name its
// language: und, a private-use tag such as x-home, and one whose language is only guessed from its
// region or script, und-CZ.
func locale(tag string) (string, bool) {
	if len(tag) > maxLocale {
		return "", false
	}
	t, err := language.Parse(tag)
	if err != nil {
		return "", false
	}
	if _, confidence := t.Base(); confidence != language.Exact {
		return "", false
	}
	return t.String(), true
}

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

// timezone reports whether name is an IANA timezone the binary knows.
func timezone(name string) bool {
	if name == "" || name == "Local" {
		return false
	}
	_, err := time.LoadLocation(name)
	return err == nil
}

// typeName is a panic value's type, which is safe to log where the value is not.
func typeName(v any) string { return fmt.Sprintf("%T", v) }
