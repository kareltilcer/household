package identity

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/clientversion"
	"github.com/kareltilcer/household/server/internal/platform/device"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/token"
)

// Every sign-in, with a password or with a provider, ends in admit once its first factor has
// proved who it is for: the second step when the account has one on and neither the browser nor
// the device is trusted, and otherwise the credential its client holds, a web session in cookies
// or a device's token pair (D-7).

// How long a challenge waits for its second step, and how long a browser or a device a second step
// trusted signs in without one (A-7).
const (
	ChallengeFor = 10 * time.Minute
	TrustFor     = 30 * 24 * time.Hour
)

// TrustCookie is the cookie a browser trusted to skip the second step holds: HttpOnly, and
// __Host- as the session's are.
const TrustCookie = "__Host-hh_trust"

// attempt is a sign-in whose first factor has passed: who its credential is for.
type attempt struct {
	// client is clientversion.Web or clientversion.Mobile.
	client string
	// device is a mobile sign-in's device.
	device device.Info
	// trust is the trust token a device presents; a browser's is its cookie.
	trust string
	// answered is a sign-in whose second step has been answered, which is asked for none.
	answered bool
	// remember trusts the browser or the device to skip the second step for TrustFor.
	remember bool
}

// deviceJSON is the contract's DeviceSignIn.
type deviceJSON struct {
	ID         uuid.UUID `json:"id"`
	Label      string    `json:"label"`
	Platform   string    `json:"platform"`
	AppVersion string    `json:"app_version"`
}

// attemptOf is the attempt a sign-in's request makes for clientType: a mobile sign-in needs its
// device, and records the version its Household-Client header names over the one its body does.
func attemptOf(r *http.Request, clientType string, d *deviceJSON, trust string) (attempt, error) {
	switch clientType {
	case clientversion.Web:
		return attempt{client: clientversion.Web}, nil
	case clientversion.Mobile:
		if d == nil || d.ID == uuid.Nil {
			return attempt{}, invalid("/device", "required")
		}
		version := d.AppVersion
		if c, ok := clientversion.From(r.Context()); ok && c.Type == clientversion.Mobile {
			version = c.Raw
		}
		return attempt{client: clientversion.Mobile, trust: trust,
			device: device.Info{ID: d.ID, Label: d.Label, Platform: d.Platform, AppVersion: version}}, nil
	}
	return attempt{}, invalid("/client_type", problem.FieldInvalid)
}

// admission is what a sign-in is given: a challenge, or a credential, the account, and a new trust
// token when the second step was answered to trust the browser or the device.
type admission struct {
	challenge *challengeJSON
	web       *session.Tokens
	mobile    *device.Tokens
	trust     string
	me        meJSON
}

// challengeJSON is the contract's MfaChallenge.
type challengeJSON struct {
	Error             string   `json:"error"`
	ChallengeToken    string   `json:"challenge_token"`
	Methods           []string `json:"methods"`
	RecoveryCodesLeft int      `json:"recovery_codes_left"`
}

// admit admits a to user's account in tx, as r asked: a challenge for the second step when the
// account has one on, a has not answered it, and neither the browser nor the device is trusted;
// otherwise a web session, which replaces the one the browser held, or the device's sign-in.
func (s *Service) admit(ctx context.Context, tx pgx.Tx, r *http.Request, user uuid.UUID, a attempt) (admission, error) {
	var adm admission
	if !a.answered {
		on, locked, err := secondStep(ctx, tx, user)
		if err != nil {
			return adm, err
		}
		if on {
			trusted, err := s.trusted(ctx, tx, r, user, a)
			if err != nil {
				return adm, err
			}
			if !trusted {
				ch, err := s.challenge(ctx, tx, user, a, locked)
				adm.challenge = &ch
				return adm, err
			}
		}
	}
	switch a.client {
	case clientversion.Mobile:
		_, tokens, err := s.Devices.SignIn(ctx, tx, user, a.device)
		if err != nil {
			return adm, err
		}
		adm.mobile = &tokens
	default:
		// The session this browser held, if any, ends: the cookie that named it is replaced.
		if c, err := r.Cookie(session.Cookie); err == nil && c.Value != "" {
			if _, err := s.Sessions.RevokeToken(ctx, tx, c.Value); err != nil {
				return adm, err
			}
		}
		_, tokens, err := s.Sessions.Create(ctx, tx, user, r.UserAgent())
		if err != nil {
			return adm, err
		}
		adm.web = &tokens
	}
	if a.remember {
		adm.trust = session.NewToken()
		now := s.Sessions.Now()
		if _, err := tx.Exec(ctx, "INSERT INTO mfa_trusts (id, user_id, token_hash, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)",
			idgen.New(), user, session.Hash(adm.trust), now, now.Add(TrustFor)); err != nil {
			return adm, err
		}
	}
	var err error
	adm.me, err = loadMe(ctx, tx, user)
	return adm, err
}

// secondStep reports whether user has the second step on, and whether its authenticator is
// locked.
func secondStep(ctx context.Context, tx pgx.Tx, user uuid.UUID) (on, locked bool, err error) {
	err = tx.QueryRow(ctx, "SELECT activated_at IS NOT NULL, locked_at IS NOT NULL FROM mfa_totp WHERE user_id = $1", user).
		Scan(&on, &locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, false, nil
	}
	return on, locked, err
}

// trusted reports whether a's browser, by its cookie, or its device, by its trust token, is trusted
// to sign in to user's account without the second step.
func (s *Service) trusted(ctx context.Context, tx pgx.Tx, r *http.Request, user uuid.UUID, a attempt) (bool, error) {
	presented := a.trust
	if a.client != clientversion.Mobile {
		if c, err := r.Cookie(TrustCookie); err == nil {
			presented = c.Value
		}
	}
	if presented == "" {
		return false, nil
	}
	var trusted bool
	err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM mfa_trusts WHERE token_hash = $1 AND user_id = $2 AND expires_at > $3)",
		session.Hash(presented), user, s.Sessions.Now()).Scan(&trusted)
	return trusted, err
}

// challenge writes a challenge for user's second step, for a, in tx: a locked authenticator is left
// out of its methods, and recovery codes when none is left.
func (s *Service) challenge(ctx context.Context, tx pgx.Tx, user uuid.UUID, a attempt, locked bool) (challengeJSON, error) {
	ch := challengeJSON{Error: string(problem.CodeMfaRequired), ChallengeToken: session.NewToken(), Methods: []string{}}
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL", user).
		Scan(&ch.RecoveryCodesLeft); err != nil {
		return ch, err
	}
	if !locked {
		ch.Methods = append(ch.Methods, "totp")
	}
	if ch.RecoveryCodesLeft > 0 {
		ch.Methods = append(ch.Methods, "recovery_code")
	}
	var (
		deviceID                    *uuid.UUID
		platform, appVersion, label *string
	)
	if a.client == clientversion.Mobile {
		d := a.device.Clean()
		deviceID, label, platform, appVersion = &d.ID, &d.Label, nullable(d.Platform), nullable(d.AppVersion)
	}
	now := s.Sessions.Now()
	_, err := tx.Exec(ctx, `
		INSERT INTO mfa_challenges (id, user_id, token_hash, client_type, device_id, device_label, device_platform,
		  device_app_version, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, coalesce($6, ''), $7, $8, $9, $10)`,
		idgen.New(), user, session.Hash(ch.ChallengeToken), a.client, deviceID, label, platform, appVersion, now, now.Add(ChallengeFor))
	return ch, err
}

// nullable is s, or NULL for "".
func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// tokenPairJSON is the contract's TokenPair.
type tokenPairJSON struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
}

func tokenPair(t device.Tokens) *tokenPairJSON {
	return &tokenPairJSON{AccessToken: t.Access, ExpiresIn: int(token.Lifetime.Seconds()), RefreshToken: t.Refresh, TokenType: "Bearer"}
}

// loginResult is the contract's LoginResult: the web client's has no tokens.
type loginResult struct {
	User       meJSON         `json:"user"`
	Tokens     *tokenPairJSON `json:"tokens"`
	TrustToken *string        `json:"trust_token"`
}

// noStore marks w's answer as one no cache may keep, since it carries a credential or a secret: a
// token pair, a challenge or trust token, a TOTP secret or recovery codes (RFC 6749 §5.1).
func noStore(w http.ResponseWriter) { w.Header().Set("Cache-Control", "no-store") }

// admitted answers a sign-in with its admission: 409 and the challenge, or 200 and the credential,
// in cookies for a browser and in the body for a device.
func admitted(w http.ResponseWriter, adm admission) {
	noStore(w)
	if adm.challenge != nil {
		httpx.WriteJSON(w, http.StatusConflict, adm.challenge)
		return
	}
	result := loginResult{User: adm.me}
	if adm.web != nil {
		session.SetCookies(w, *adm.web)
		if adm.trust != "" {
			http.SetCookie(w, &http.Cookie{Name: TrustCookie, Value: adm.trust, Path: "/", MaxAge: int(TrustFor.Seconds()),
				HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode})
		}
	}
	if adm.mobile != nil {
		result.Tokens = tokenPair(*adm.mobile)
		if adm.trust != "" {
			result.TrustToken = &adm.trust
		}
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}

// endTrust ends every trust and every challenge of user's in tx: the second step was turned off or
// on again, the password was reset, the account signed out everywhere or signed a device or a
// session out from its list, or a device's refresh token was reused.
//
// A transaction that ends challenges and sessions or devices' sign-ins alike ends the challenges
// first. A second step's answer holds its challenge's row while admit replaces the session its
// browser held or the sign-in its device held, so one that locked those first and then waited on
// the challenge would deadlock with it.
func (s *Service) endTrust(ctx context.Context, tx pgx.Tx, user uuid.UUID) error {
	if _, err := tx.Exec(ctx, "DELETE FROM mfa_trusts WHERE user_id = $1", user); err != nil {
		return err
	}
	return s.endChallenges(ctx, tx, user)
}

// endChallenges ends every live challenge of user's in tx.
func (s *Service) endChallenges(ctx context.Context, tx pgx.Tx, user uuid.UUID) error {
	_, err := tx.Exec(ctx, "UPDATE mfa_challenges SET ended_at = $2 WHERE user_id = $1 AND ended_at IS NULL",
		user, s.Sessions.Now())
	return err
}
