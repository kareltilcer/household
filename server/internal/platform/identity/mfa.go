package identity

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/mfa"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// The second step (FR-ID5, D-100): a TOTP authenticator, enrolled with the current password and
// turned on by its first code, and ten recovery codes, each spent once in its place. A sign-in to
// an account with it on asks for it (admit), unless the browser or the device was trusted when it
// was last answered.

// issuer is the name an authenticator app shows beside the account.
const issuer = "Household"

// LockAfter is how many wrong codes since the last right one lock the authenticator, until a
// recovery code or support unlocks it (D-100).
const LockAfter = 10

// recoveryCodesJSON is the contract's MfaRecoveryCodes.
type recoveryCodesJSON struct {
	RecoveryCodes []string `json:"recovery_codes"`
}

// enrollMFA is postAuthMfaEnroll: with the current password, a new secret, which waits for its
// first code. An authenticator already on stays on until then, and a later enrolment replaces one
// not yet activated. It keeps no Idempotency-Key: the body carries a password (D-97).
func (s *Service) enrollMFA(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	var req struct {
		Password string `json:"password"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	// A second step is bound only to an account whose address is proven (D-100): one bound before
	// would outlive the reset that proves the address, and lock its owner out of the account the
	// reset hands them.
	var verified bool
	if err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, "SELECT email_verified_at IS NOT NULL FROM users WHERE id = $1", user).Scan(&verified)
	}); err != nil {
		s.fail(w, r, err)
		return
	}
	if !verified {
		s.fail(w, r, problem.New(http.StatusForbidden, problem.CodeAccountUnverified))
		return
	}
	acct, err := s.reauthenticate(ctx, user, req.Password)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	e, err := mfa.NewEnrolment(issuer, acct.address)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	err = tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		if err := unchanged(ctx, tx, user, acct.set); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO mfa_totp (user_id, pending_secret, pending_at) VALUES ($1, $2, $3)
			ON CONFLICT (user_id) DO UPDATE SET pending_secret = excluded.pending_secret, pending_at = excluded.pending_at`,
			user, s.MFA.Seal(user, []byte(e.Secret)), s.Sessions.Now())
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	noStore(w)
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"secret": e.Secret, "otpauth_uri": e.URI})
}

// activateMFA is postAuthMfaActivate: the enrolled secret's code turns it on, in place of any
// authenticator on before, with ten new recovery codes. No browser or device stays trusted, since
// the factor they skipped is not this one. The codes are in the answer, which the account's
// Idempotency-Key never keeps: a repeat answers 409.
//
// Wrong codes count against the account as a second step's do, five in five minutes (D-101):
// the answer carries the recovery codes, and a session alone, which cannot enrol without the
// password, must not guess its way to them through an enrolment its owner left waiting.
func (s *Service) activateMFA(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	var req struct {
		Code string `json:"code"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	account := user.String()
	if wait, err := s.Throttles.Attempt(ctx, ratelimit.Count{Limit: ratelimit.MFAAccount, Subject: account}); err != nil || wait > 0 {
		s.fail(w, r, refusal(wait, err))
		return
	}
	var codes []string
	err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		var pending []byte
		err := tx.QueryRow(ctx, "SELECT pending_secret FROM mfa_totp WHERE user_id = $1 FOR UPDATE", user).Scan(&pending)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && pending == nil) {
			return invalid("/code", problem.FieldInvalid)
		}
		if err != nil {
			return err
		}
		secret, err := s.MFA.Open(user, pending)
		if err != nil {
			return err
		}
		step, ok := mfa.Match(string(secret), req.Code, s.Sessions.Now(), -1)
		if !ok {
			return invalid("/code", problem.FieldInvalid)
		}
		if _, err := tx.Exec(ctx, `
			UPDATE mfa_totp SET secret = pending_secret, activated_at = $2, pending_secret = NULL, pending_at = NULL,
			  last_step = $3, failures = 0, locked_at = NULL
			WHERE user_id = $1`, user, s.Sessions.Now(), step); err != nil {
			return err
		}
		if codes, err = s.replaceRecoveryCodes(ctx, tx, user); err != nil {
			return err
		}
		if err := s.endTrust(ctx, tx, user); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	// The right code: the account's count of wrong ones starts again. The second step is on, so a
	// failure here is logged, not answered.
	if err := s.Throttles.Clear(ctx, ratelimit.MFAAccount, account); err != nil {
		s.Log.LogAttrs(ctx, slog.LevelWarn, "second-step throttle not cleared", slog.Any("error", err))
	}
	idempotency.Unstorable(ctx)
	noStore(w)
	httpx.WriteJSON(w, http.StatusOK, recoveryCodesJSON{RecoveryCodes: codes})
}

// replaceRecoveryCodes makes user a new set of recovery codes in tx, retiring every earlier one,
// and returns them as they are shown.
func (s *Service) replaceRecoveryCodes(ctx context.Context, tx pgx.Tx, user uuid.UUID) ([]string, error) {
	if _, err := tx.Exec(ctx, "DELETE FROM mfa_recovery_codes WHERE user_id = $1", user); err != nil {
		return nil, err
	}
	codes := mfa.NewRecoveryCodes()
	hashes := make([][]byte, 0, len(codes))
	for _, c := range codes {
		norm, _ := mfa.RecoveryCode(c)
		hashes = append(hashes, s.MFA.HashRecovery(user, norm))
	}
	if _, err := tx.Exec(ctx, "INSERT INTO mfa_recovery_codes (user_id, code_hash, created_at) SELECT $1, h, $3 FROM unnest($2::bytea[]) AS h",
		user, hashes, s.Sessions.Now()); err != nil {
		return nil, err
	}
	return codes, nil
}

// verification is how a second step's answer came out.
type verification int

const (
	// dead: no live challenge was presented.
	dead verification = iota + 1
	// wrong: the code was not right; the challenge stays.
	wrong
	// locked: the authenticator is locked, and the account's challenges have ended.
	locked
	// right: the account is signed in.
	right
)

// verifyMFA is postAuthMfaVerify (FR-ID5): a challenge answered with the authenticator's code, or
// with a recovery code, which is spent, told of by email, and unlocks a locked authenticator. The
// answer signs in as the sign-in that raised the challenge asked. Wrong codes are counted against
// the account before the code is checked, five in five minutes, which bounds every challenge it
// has; ten since the last right one lock the authenticator and end every challenge (D-100).
func (s *Service) verifyMFA(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		ChallengeToken string `json:"challenge_token"`
		Code           string `json:"code"`
		RememberDevice bool   `json:"remember_device"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	hash := session.Hash(req.ChallengeToken)
	var user uuid.UUID
	err := tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, "SELECT user_id FROM mfa_challenges WHERE token_hash = $1 AND ended_at IS NULL AND expires_at > $2",
			hash, s.Sessions.Now()).Scan(&user)
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		s.fail(w, r, problem.New(http.StatusUnauthorized, problem.CodeUnauthenticated))
		return
	case err != nil:
		s.fail(w, r, err)
		return
	}
	account := user.String()
	if wait, err := s.Throttles.Attempt(ctx, ratelimit.Count{Limit: ratelimit.MFAAccount, Subject: account}); err != nil || wait > 0 {
		s.fail(w, r, refusal(wait, err))
		return
	}

	var (
		outcome      verification
		adm          admission
		recoveryLeft = -1
	)
	err = tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		outcome, adm, recoveryLeft = dead, admission{}, -1
		now := s.Sessions.Now()
		// The authenticator's row first, then the challenge's, as every verification takes them.
		var (
			secret   []byte
			lastStep *int64
			failures int
			lockedAt *time.Time
		)
		err := tx.QueryRow(ctx, `
			SELECT secret, last_step, failures, locked_at FROM mfa_totp WHERE user_id = $1 AND activated_at IS NOT NULL FOR UPDATE`,
			user).Scan(&secret, &lastStep, &failures, &lockedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			// The second step was turned off since the challenge was made: it answers nothing now.
			return s.endChallenges(ctx, tx, user)
		}
		if err != nil {
			return err
		}
		var (
			challenge uuid.UUID
			a         attempt
			deviceID  *uuid.UUID
			platform  *string
			version   *string
		)
		err = tx.QueryRow(ctx, `
			SELECT id, client_type, device_id, device_label, device_platform, device_app_version FROM mfa_challenges
			WHERE token_hash = $1 AND user_id = $2 AND ended_at IS NULL AND expires_at > $3 FOR UPDATE`, hash, user, now).
			Scan(&challenge, &a.client, &deviceID, &a.device.Label, &platform, &version)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}

		matched := false
		if code, ok := mfa.TOTPCode(req.Code); ok {
			if lockedAt != nil {
				outcome = locked
				return s.endChallenges(ctx, tx, user)
			}
			key, err := s.MFA.Open(user, secret)
			if err != nil {
				return err
			}
			after := int64(-1)
			if lastStep != nil {
				after = *lastStep
			}
			if step, ok := mfa.Match(string(key), code, now, after); ok {
				matched = true
				// A secret sealed under a key since rotated is sealed again under the first.
				resealed := secret
				if !s.MFA.Current(secret) {
					resealed = s.MFA.Seal(user, key)
				}
				if _, err := tx.Exec(ctx, "UPDATE mfa_totp SET last_step = $2, failures = 0, secret = $3 WHERE user_id = $1",
					user, step, resealed); err != nil {
					return err
				}
			}
		} else if code, ok := mfa.RecoveryCode(req.Code); ok {
			tag, err := tx.Exec(ctx, `
				UPDATE mfa_recovery_codes SET used_at = $3 WHERE user_id = $1 AND code_hash = ANY($2) AND used_at IS NULL`,
				user, s.MFA.RecoveryHashes(user, code), now)
			if err != nil {
				return err
			}
			if tag.RowsAffected() > 0 {
				matched = true
				if _, err := tx.Exec(ctx, "UPDATE mfa_totp SET failures = 0, locked_at = NULL WHERE user_id = $1", user); err != nil {
					return err
				}
				if err := tx.QueryRow(ctx, "SELECT count(*) FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL", user).
					Scan(&recoveryLeft); err != nil {
					return err
				}
			}
		}
		if !matched {
			failures++
			if failures < LockAfter {
				outcome = wrong
				_, err := tx.Exec(ctx, "UPDATE mfa_totp SET failures = $2 WHERE user_id = $1", user, failures)
				return err
			}
			outcome = locked
			if _, err := tx.Exec(ctx, "UPDATE mfa_totp SET failures = $2, locked_at = coalesce(locked_at, $3) WHERE user_id = $1",
				user, failures, now); err != nil {
				return err
			}
			return s.endChallenges(ctx, tx, user)
		}
		if _, err := tx.Exec(ctx, "UPDATE mfa_challenges SET ended_at = $2 WHERE id = $1", challenge, now); err != nil {
			return err
		}
		if deviceID != nil {
			a.device.ID = *deviceID
		}
		if platform != nil {
			a.device.Platform = *platform
		}
		if version != nil {
			a.device.AppVersion = *version
		}
		a.answered, a.remember = true, req.RememberDevice
		outcome = right
		adm, err = s.admit(ctx, tx, r, user, a)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	switch outcome {
	case dead:
		s.fail(w, r, problem.New(http.StatusUnauthorized, problem.CodeUnauthenticated))
		return
	case wrong:
		s.fail(w, r, invalidCredentials())
		return
	case locked:
		s.fail(w, r, problem.New(http.StatusLocked, problem.CodeMfaLocked))
		return
	case right:
	}
	// The right code: the account's count of wrong ones starts again. The sign-in has committed,
	// its challenge ended and any recovery code spent, so a failure here is logged, not answered:
	// the client still gets the credential that was made for it.
	if err := s.Throttles.Clear(ctx, ratelimit.MFAAccount, account); err != nil {
		s.Log.LogAttrs(ctx, slog.LevelWarn, "second-step throttle not cleared", slog.Any("error", err))
	}
	if recoveryLeft >= 0 {
		s.notice(ctx, user, emailRecoveryCodeUsed, i18n.Args{"left": recoveryLeft})
	}
	admitted(w, adm)
}

// disableMFA is postAuthMfaDisable: with the current password, the authenticator and the recovery
// codes go, no browser or device stays trusted, and the account's address is told. It keeps no
// Idempotency-Key: the body carries a password (D-97).
func (s *Service) disableMFA(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	var req struct {
		Password string `json:"password"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	acct, err := s.reauthenticate(ctx, user, req.Password)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var was bool
	err = tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		if err := unchanged(ctx, tx, user, acct.set); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, "SELECT activated_at IS NOT NULL FROM mfa_totp WHERE user_id = $1 FOR UPDATE", user).
			Scan(&was); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if _, err := tx.Exec(ctx, "DELETE FROM mfa_totp WHERE user_id = $1", user); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "DELETE FROM mfa_recovery_codes WHERE user_id = $1", user); err != nil {
			return err
		}
		return s.endTrust(ctx, tx, user)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if was {
		s.email(ctx, acct.address, acct.language, emailMFADisabled, s.link(routeReset, ""))
	}
	w.WriteHeader(http.StatusNoContent)
}

// newRecoveryCodes is postAuthMfaRecoveryCodes: with the current password, ten new recovery codes,
// which retire every earlier one (A-6). It keeps no Idempotency-Key: the body carries a password
// (D-97).
func (s *Service) newRecoveryCodes(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	var req struct {
		Password string `json:"password"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	acct, err := s.reauthenticate(ctx, user, req.Password)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var codes []string
	err = tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		if err := unchanged(ctx, tx, user, acct.set); err != nil {
			return err
		}
		var on bool
		err := tx.QueryRow(ctx, "SELECT activated_at IS NOT NULL FROM mfa_totp WHERE user_id = $1 FOR UPDATE", user).Scan(&on)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !on) {
			return problem.NotFound()
		}
		if err != nil {
			return err
		}
		codes, err = s.replaceRecoveryCodes(ctx, tx, user)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	noStore(w)
	httpx.WriteJSON(w, http.StatusOK, recoveryCodesJSON{RecoveryCodes: codes})
}
