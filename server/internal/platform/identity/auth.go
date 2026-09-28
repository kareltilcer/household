package identity

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// register is postAuthRegister (FR-ID1). A new address gets an account, unverified, and a link
// to verify it; an address that has one already gets a note saying so, and the account is left
// as it is. Both answer 202 alike, after the same work: the password is hashed either way.
func (s *Service) register(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		Email       string  `json:"email"`
		Password    string  `json:"password"`
		DisplayName string  `json:"display_name"`
		Locale      *string `json:"locale"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	var errs []problem.FieldError
	if !mail.ValidAddress(req.Email) {
		errs = append(errs, problem.FieldError{Field: "/email", Code: "format"})
	}
	name, ok := displayName(req.DisplayName)
	if !ok {
		errs = append(errs, problem.FieldError{Field: "/display_name", Code: problem.FieldInvalid})
	}
	lang := preferredLocale(r)
	if req.Locale != nil {
		if lang, ok = locale(*req.Locale); !ok {
			errs = append(errs, problem.FieldError{Field: "/locale", Code: problem.FieldMalformed})
		}
	}
	if len(errs) > 0 {
		s.fail(w, r, problem.Validation(errs...))
		return
	}
	if wait, err := s.Throttles.Take(ctx, ratelimit.RegisterNetwork, s.network(r)); err != nil || wait > 0 {
		s.fail(w, r, refusal(wait, err))
		return
	}
	if err := s.screen("/password", req.Password); err != nil {
		s.fail(w, r, err)
		return
	}
	secret, err := s.Hasher.Hash(ctx, req.Password)
	if err != nil {
		s.fail(w, r, err)
		return
	}

	var (
		created                  bool
		token, address, language string
	)
	err = tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		now := s.Sessions.Now()
		id := idgen.New()
		err := tx.QueryRow(ctx, `
			INSERT INTO users (id, email, display_name, locale, created_at) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT ((lower(email))) DO NOTHING RETURNING true`,
			id, req.Email, name, lang, now).Scan(&created)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			// The address has an account: the note goes to it, in its owner's language.
			return tx.QueryRow(ctx, "SELECT email, locale FROM users WHERE lower(email) = lower($1)", req.Email).
				Scan(&address, &language)
		case err != nil:
			return err
		}
		if _, err := tx.Exec(ctx, "INSERT INTO credentials (user_id, type, secret) VALUES ($1, 'password', $2)", id, secret); err != nil {
			return err
		}
		address, language = req.Email, lang
		token, err = issueToken(ctx, tx, id, "verify_email", req.Email, VerifyFor, now)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if created {
		s.email(ctx, address, language, emailVerify, s.link(routeVerify, token))
	} else {
		s.email(ctx, address, language, emailRegisterExisting, s.link(routeSignIn, ""))
	}
	w.WriteHeader(http.StatusAccepted)
}

// refusal is the answer to a throttle's verdict: err as it is, or the 429 for a wait.
func refusal(wait time.Duration, err error) error {
	if err != nil {
		return err
	}
	return ratelimit.Refusal(wait)
}

// linkToken is a token an email's link carries, as its row holds it.
type linkToken struct {
	id, user        uuid.UUID
	email           string
	expires         time.Time
	used            *time.Time
	account         *string
	accountVerified bool
}

// findToken returns the token for purpose, locked for tx, and false for none.
func findToken(ctx context.Context, tx pgx.Tx, token, purpose string) (linkToken, bool, error) {
	var t linkToken
	err := tx.QueryRow(ctx, `
		SELECT t.id, t.user_id, t.email, t.expires_at, t.used_at, u.email, u.email_verified_at IS NOT NULL
		FROM email_tokens t JOIN users u ON u.id = t.user_id
		WHERE t.token_hash = $1 AND t.purpose = $2
		FOR UPDATE OF t`, hashToken(token), purpose).
		Scan(&t.id, &t.user, &t.email, &t.expires, &t.used, &t.account, &t.accountVerified)
	if errors.Is(err, pgx.ErrNoRows) {
		return linkToken{}, false, nil
	}
	return t, err == nil, err
}

// sameAddress reports whether the account still has the address t was sent to.
func (t linkToken) sameAddress() bool {
	return t.account != nil && strings.EqualFold(*t.account, t.email)
}

var (
	errTokenExpired = problem.New(http.StatusGone, problem.CodeTokenExpired)
	errTokenUsed    = problem.New(http.StatusGone, problem.CodeTokenAlreadyUsed)
)

// verifyEmail is postAuthVerifyEmail (FR-ID1): a link, once, within its 24 hours, verifies the
// address it was sent to. Opened again, it answers 204 while the account still has that address
// verified, so that a retry whose first answer was lost is not told the link is dead.
func (s *Service) verifyEmail(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		Token string `json:"token"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	err := tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		t, ok, err := findToken(ctx, tx, req.Token, "verify_email")
		switch {
		case err != nil:
			return err
		case !ok:
			return problem.NotFound()
		case t.used != nil:
			if t.sameAddress() && t.accountVerified {
				return nil
			}
			return errTokenUsed
		case !s.Sessions.Now().Before(t.expires), !t.sameAddress():
			return errTokenExpired
		}
		now := s.Sessions.Now()
		if _, err := tx.Exec(ctx, "UPDATE email_tokens SET used_at = $2 WHERE id = $1", t.id, now); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, "UPDATE users SET email_verified_at = coalesce(email_verified_at, $2) WHERE id = $1", t.user, now)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// resendVerification is postAuthVerifyEmailResend: a new link to an address whose account has
// not verified it, and nothing to any other. Which it was is decided after the response.
func (s *Service) resendVerification(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		Email string `json:"email"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	for _, limit := range []ratelimit.Limit{ratelimit.ResendMinute, ratelimit.ResendHour} {
		if wait, err := s.Throttles.Take(ctx, limit, subject(req.Email)); err != nil || wait > 0 {
			s.fail(w, r, refusal(wait, err))
			return
		}
	}
	s.Later(ctx, func(ctx context.Context) {
		var token, address, language string
		err := tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
			var (
				id       uuid.UUID
				verified bool
			)
			err := tx.QueryRow(ctx, `
				SELECT id, email, locale, email_verified_at IS NOT NULL FROM users WHERE lower(email) = lower($1)`,
				req.Email).Scan(&id, &address, &language, &verified)
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && verified) {
				return nil
			}
			if err != nil {
				return err
			}
			token, err = issueToken(ctx, tx, id, "verify_email", address, VerifyFor, s.Sessions.Now())
			return err
		})
		if err != nil {
			s.Log.LogAttrs(ctx, slog.LevelError, "verification not resent", slog.Any("error", err))
			return
		}
		if token != "" {
			s.deliver(ctx, address, language, emailVerify, s.link(routeVerify, token))
		}
	})
	w.WriteHeader(http.StatusAccepted)
}

// login is postAuthLogin (FR-ID3), for the web client: a session, in two cookies. Every failure
// is one 401, and an address with no account costs the same hash as a wrong password. The mobile
// client's token pair is item 9's.
func (s *Service) login(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		Email      string `json:"email"`
		Password   string `json:"password"`
		ClientType string `json:"client_type"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	if req.ClientType != "web" {
		s.fail(w, r, invalid("/client_type", problem.FieldInvalid))
		return
	}
	network, account := s.network(r), subject(req.Email)
	var wait time.Duration
	for _, c := range []struct {
		limit   ratelimit.Limit
		subject string
	}{{ratelimit.LoginNetwork, network}, {ratelimit.LoginAccount, account}} {
		blocked, err := s.Throttles.Blocked(ctx, c.limit, c.subject)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		wait = max(wait, blocked)
	}
	if wait > 0 {
		s.fail(w, r, ratelimit.Refusal(wait))
		return
	}

	var (
		user   uuid.UUID
		secret *string
	)
	err := tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT u.id, c.secret FROM users u
			LEFT JOIN credentials c ON c.user_id = u.id AND c.type = 'password'
			WHERE lower(u.email) = lower($1)`, req.Email).Scan(&user, &secret)
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.fail(w, r, err)
		return
	}
	var ok, rehash bool
	if secret == nil {
		err = s.Hasher.Burn(ctx, req.Password)
	} else {
		ok, rehash, err = s.Hasher.Verify(ctx, req.Password, *secret)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if !ok {
		for _, c := range []struct {
			limit   ratelimit.Limit
			subject string
		}{{ratelimit.LoginNetwork, network}, {ratelimit.LoginAccount, account}} {
			if err := s.Throttles.Fail(ctx, c.limit, c.subject); err != nil {
				s.fail(w, r, err)
				return
			}
		}
		s.fail(w, r, invalidCredentials())
		return
	}
	if err := s.Throttles.Clear(ctx, ratelimit.LoginAccount, account); err != nil {
		s.fail(w, r, err)
		return
	}

	var newSecret string
	if rehash {
		if newSecret, err = s.Hasher.Hash(ctx, req.Password); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	var (
		tokens session.Tokens
		me     meJSON
	)
	err = tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		if newSecret != "" {
			if _, err := tx.Exec(ctx, "UPDATE credentials SET secret = $2, updated_at = now() WHERE user_id = $1 AND type = 'password'",
				user, newSecret); err != nil {
				return err
			}
		}
		// The session this browser held, if any, ends: the cookie that named it is replaced.
		if c, err := r.Cookie(session.Cookie); err == nil && c.Value != "" {
			if _, err := s.Sessions.RevokeToken(ctx, tx, c.Value); err != nil {
				return err
			}
		}
		var err error
		if _, tokens, err = s.Sessions.Create(ctx, tx, user, r.UserAgent()); err != nil {
			return err
		}
		me, err = loadMe(ctx, tx, user)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	session.SetCookies(w, tokens)
	httpx.WriteJSON(w, http.StatusOK, loginResult{User: me})
}

// loginResult is the contract's LoginResult: the web client's has no tokens.
type loginResult struct {
	User   meJSON `json:"user"`
	Tokens *struct {
		AccessToken  string `json:"access_token"`
		ExpiresIn    int    `json:"expires_in"`
		RefreshToken string `json:"refresh_token"`
	} `json:"tokens"`
}

// logout is postAuthLogout: the session the request came with ends, and its cookies go.
func (s *Service) logout(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	current, ok := session.Current(ctx)
	err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		if ok {
			if _, err := s.Sessions.Revoke(ctx, tx, user, current); err != nil {
				return err
			}
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if ok {
		session.ClearCookies(w)
	}
	w.WriteHeader(http.StatusNoContent)
}

// requestReset is postAuthPasswordReset (FR-ID6): a link, valid for an hour, to an address that
// has an account, and nothing to one that has none. Which it was is decided after the response.
func (s *Service) requestReset(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		Email string `json:"email"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	if wait, err := s.Throttles.Take(ctx, ratelimit.ResetAccount, subject(req.Email)); err != nil || wait > 0 {
		s.fail(w, r, refusal(wait, err))
		return
	}
	s.Later(ctx, func(ctx context.Context) {
		var token, address, language string
		err := tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
			var id uuid.UUID
			err := tx.QueryRow(ctx, "SELECT id, email, locale FROM users WHERE lower(email) = lower($1)", req.Email).
				Scan(&id, &address, &language)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			if err != nil {
				return err
			}
			token, err = issueToken(ctx, tx, id, "reset_password", address, ResetFor, s.Sessions.Now())
			return err
		})
		if err != nil {
			s.Log.LogAttrs(ctx, slog.LevelError, "password reset not sent", slog.Any("error", err))
			return
		}
		if token != "" {
			s.deliver(ctx, address, language, emailReset, s.link(routeSetPassword, token))
		}
	})
	w.WriteHeader(http.StatusAccepted)
}

// confirmReset is postAuthPasswordResetConfirm (FR-ID6): a link, once, within its hour, sets the
// password, ends every session and every other link to reset it, verifies the address it was sent
// to, and says so by email.
func (s *Service) confirmReset(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	// The link first: a dead one makes the password moot, and hashing is the costly part.
	check := func(ctx context.Context, tx pgx.Tx) (linkToken, error) {
		t, ok, err := findToken(ctx, tx, req.Token, "reset_password")
		switch {
		case err != nil:
			return t, err
		case !ok:
			return t, problem.NotFound()
		case t.used != nil:
			return t, errTokenUsed
		case !s.Sessions.Now().Before(t.expires), !t.sameAddress():
			return t, errTokenExpired
		}
		return t, nil
	}
	if err := tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		_, err := check(ctx, tx)
		return err
	}); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.screen("/password", req.Password); err != nil {
		s.fail(w, r, err)
		return
	}
	secret, err := s.Hasher.Hash(ctx, req.Password)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var t linkToken
	var language string
	err = tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		var err error
		// Again, under the row's lock: two confirmations of one link set one password.
		if t, err = check(ctx, tx); err != nil {
			return err
		}
		now := s.Sessions.Now()
		if _, err := tx.Exec(ctx, `
			INSERT INTO credentials (user_id, type, secret) VALUES ($1, 'password', $2)
			ON CONFLICT (user_id, type) DO UPDATE SET secret = excluded.secret, updated_at = now()`, t.user, secret); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE email_tokens SET used_at = $2 WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NULL`,
			t.user, now); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			UPDATE users SET email_verified_at = coalesce(email_verified_at, $2) WHERE id = $1 RETURNING locale`,
			t.user, now).Scan(&language); err != nil {
			return err
		}
		return s.Sessions.RevokeAll(ctx, tx, t.user, uuid.Nil)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	// The address proved itself, and its owner is back in: the sign-in cooldown ends.
	if err := s.Throttles.Clear(ctx, ratelimit.LoginAccount, subject(t.email)); err != nil {
		s.Log.LogAttrs(ctx, slog.LevelWarn, "sign-in throttle not cleared", slog.Any("error", err))
	}
	s.email(ctx, t.email, language, emailPasswordChanged, s.link(routeReset, ""))
	w.WriteHeader(http.StatusNoContent)
}

// changePassword is postAuthPassword: the current password, checked as a sign-in checks it and
// counted against the account as a failed sign-in is, sets a new one and ends every other session.
func (s *Service) changePassword(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	var req struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	var (
		address, language string
		email             *string
		secret            *string
	)
	err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT u.email, u.locale, c.secret FROM users u
			LEFT JOIN credentials c ON c.user_id = u.id AND c.type = 'password'
			WHERE u.id = $1`, user).Scan(&email, &language, &secret)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if email == nil || secret == nil {
		// An account without a password has none to change: a child's PIN (item 11), or an
		// identity provider's (item 9).
		s.fail(w, r, invalidCredentials())
		return
	}
	address = *email
	if wait, err := s.Throttles.Blocked(ctx, ratelimit.LoginAccount, subject(address)); err != nil || wait > 0 {
		s.fail(w, r, refusal(wait, err))
		return
	}
	ok, _, err := s.Hasher.Verify(ctx, req.Current, *secret)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if !ok {
		if err := s.Throttles.Fail(ctx, ratelimit.LoginAccount, subject(address)); err != nil {
			s.fail(w, r, err)
			return
		}
		s.fail(w, r, invalidCredentials())
		return
	}
	if err := s.screen("/new_password", req.New); err != nil {
		s.fail(w, r, err)
		return
	}
	newSecret, err := s.Hasher.Hash(ctx, req.New)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	current, _ := session.Current(ctx)
	err = tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "UPDATE credentials SET secret = $2, updated_at = now() WHERE user_id = $1 AND type = 'password'",
			user, newSecret); err != nil {
			return err
		}
		if err := s.Sessions.RevokeAll(ctx, tx, user, current); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.Throttles.Clear(ctx, ratelimit.LoginAccount, subject(address)); err != nil {
		s.Log.LogAttrs(ctx, slog.LevelWarn, "sign-in throttle not cleared", slog.Any("error", err))
	}
	s.email(ctx, address, language, emailPasswordChanged, s.link(routeReset, ""))
	w.WriteHeader(http.StatusNoContent)
}
