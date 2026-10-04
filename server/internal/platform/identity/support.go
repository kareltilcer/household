package identity

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// The support actions of PRD 02 §8 that are the account's: sending a verification or a reset link
// again, unblocking a rate-limited account, and unlocking or turning off a second step whose owner
// is locked out of it (D-100). They are what item 21's staff API calls, once it has checked who
// calls; nothing here is reached by an account's own routes. Each takes a Witness, which it runs in
// the transaction of its effect: the platform's own record of the action (FR-PS2), which commits
// with it or not at all.

// Witness records a support action in the transaction of its effect. A nil one records nothing.
type Witness func(ctx context.Context, tx pgx.Tx) error

func (w Witness) record(ctx context.Context, tx pgx.Tx) error {
	if w == nil {
		return nil
	}
	return w(ctx, tx)
}

// What a support action refuses.
var (
	// ErrNoAccount is every support action's refusal of a user that is no account support can act
	// on: none with that id, one that is erased, or one with no address, a child profile.
	ErrNoAccount = errors.New("identity: no such account")
	// ErrVerified is ResendVerification's refusal of an account whose address is verified already.
	ErrVerified = errors.New("identity: the account's address is verified")
	// ErrNoSecondStep is UnlockSecondStep's and DisableSecondStep's refusal of an account whose
	// second step is not on.
	ErrNoSecondStep = errors.New("identity: the account has no second step")
	// ErrNotLocked is UnlockSecondStep's refusal of a second step that is not locked.
	ErrNotLocked = errors.New("identity: the second step is not locked")
	// ErrNoWayBack is SendPasswordReset's refusal of an account scheduled for deletion that no link
	// cancels any more, used, past its time or ended as the deletion's execution began: there is
	// nothing to send it, and an action that sent nothing is recorded nowhere (D-145).
	ErrNoWayBack = errors.New("identity: no link cancels the account's deletion any more")
)

// supported is an account a support action reaches.
type supported struct {
	address, language string
	verified, leaving bool
}

// supportable reads user's account in tx, under a lock that keeps its erasure from running beside
// the action, or returns ErrNoAccount.
func supportable(ctx context.Context, tx pgx.Tx, user uuid.UUID) (supported, error) {
	var (
		a       supported
		address *string
	)
	err := tx.QueryRow(ctx, `
		SELECT u.email, u.locale, u.email_verified_at IS NOT NULL,
		  EXISTS (SELECT FROM account_deletions d WHERE d.user_id = u.id)
		FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL FOR KEY SHARE OF u`, user).
		Scan(&address, &a.language, &a.verified, &a.leaving)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && address == nil) {
		return supported{}, ErrNoAccount
	}
	if err != nil {
		return supported{}, err
	}
	a.address = *address
	return a, nil
}

// ResendVerification sends user's address a new verification link, as asking for one does
// (postAuthVerifyEmailResend), whatever the resend's own limits say: support sends it for someone
// those limits stopped.
func (s *Service) ResendVerification(ctx context.Context, user uuid.UUID, witness Witness) error {
	var (
		a     supported
		token string
	)
	err := tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		var err error
		if a, err = supportable(ctx, tx, user); err != nil {
			return err
		}
		if a.verified {
			return ErrVerified
		}
		if token, err = issueToken(ctx, tx, user, verifyLink.purpose, a.address, verifyLink.ttl, s.Sessions.Now()); err != nil {
			return err
		}
		return witness.record(ctx, tx)
	})
	if err != nil {
		return err
	}
	s.email(ctx, a.address, a.language, verifyLink.template, s.link(verifyLink.route, token))
	return nil
}

// SendPasswordReset sends user's address a link that sets a new password, as asking for one does
// (postAuthPasswordReset): an account scheduled for deletion, which no password signs in to, is sent
// the link that cancels the deletion in its place (D-136). Once no link cancels it, it is refused,
// ErrNoWayBack, where asking for one answers as ever and sends nothing: whoever asks for a reset is
// told nothing of the account, and support, who reads it, is told that nothing went.
func (s *Service) SendPasswordReset(ctx context.Context, user uuid.UUID, witness Witness) error {
	var (
		a     supported
		token string
		days  int
	)
	err := tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		var err error
		if a, err = supportable(ctx, tx, user); err != nil {
			return err
		}
		if a.leaving {
			if token, days, err = s.renewCancelLink(ctx, tx, user); err == nil && token == "" {
				err = ErrNoWayBack
			}
		} else {
			token, err = issueToken(ctx, tx, user, resetLink.purpose, a.address, resetLink.ttl, s.Sessions.Now())
		}
		if err != nil {
			return err
		}
		return witness.record(ctx, tx)
	})
	switch {
	case err != nil:
		return err
	case a.leaving:
		s.email(ctx, a.address, a.language, emailAccountDeletion, s.link(routeCancelDeletion, token), i18n.Args{"days": days})
	default:
		s.email(ctx, a.address, a.language, resetLink.template, s.link(resetLink.route, token))
	}
	return nil
}

// accountLimits are the limits counted against an account by its address (PRD 02 §9), which
// ClearRateLimits forgets: the sign-in's, with its backoff, the reset's, the resend's two and the
// registration note's.
var accountLimits = []ratelimit.Limit{
	ratelimit.LoginAccount, ratelimit.ResetAccount, ratelimit.ResendMinute, ratelimit.ResendHour, ratelimit.RegisterNote,
}

// ClearRateLimits forgets what is counted against user's account on the sign-in surfaces (PRD 02
// §9): the attempts at its address, and the wrong second-step codes at its id. The limits a network
// is held to are not an account's, and the API's own budget refills in seconds, in each instance's
// memory.
func (s *Service) ClearRateLimits(ctx context.Context, user uuid.UUID, witness Witness) error {
	return tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		a, err := supportable(ctx, tx, user)
		if err != nil {
			return err
		}
		for _, l := range accountLimits {
			if err := ratelimit.ClearIn(ctx, tx, l, subject(a.address)); err != nil {
				return err
			}
		}
		if err := ratelimit.ClearIn(ctx, tx, ratelimit.MFAAccount, user.String()); err != nil {
			return err
		}
		return witness.record(ctx, tx)
	})
}

// UnlockSecondStep unlocks user's authenticator, which ten wrong codes locked (FR-ID5, D-100), as a
// recovery code does: the count of wrong codes starts again, and the codes' limit with it.
func (s *Service) UnlockSecondStep(ctx context.Context, user uuid.UUID, witness Witness) error {
	return tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		if _, err := supportable(ctx, tx, user); err != nil {
			return err
		}
		var locked bool
		err := tx.QueryRow(ctx, "SELECT locked_at IS NOT NULL FROM mfa_totp WHERE user_id = $1 AND activated_at IS NOT NULL FOR UPDATE", user).
			Scan(&locked)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return ErrNoSecondStep
		case err != nil:
			return err
		case !locked:
			return ErrNotLocked
		}
		if _, err := tx.Exec(ctx, "UPDATE mfa_totp SET failures = 0, locked_at = NULL WHERE user_id = $1", user); err != nil {
			return err
		}
		if err := ratelimit.ClearIn(ctx, tx, ratelimit.MFAAccount, user.String()); err != nil {
			return err
		}
		return witness.record(ctx, tx)
	})
}

// DisableSecondStep turns user's second step off, for an owner who has lost both the authenticator
// and the recovery codes (D-100): the authenticator and the codes go, no browser or device stays
// trusted, and the account's address is told, as it is when its owner turns the step off.
func (s *Service) DisableSecondStep(ctx context.Context, user uuid.UUID, witness Witness) error {
	var a supported
	err := tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		var err error
		if a, err = supportable(ctx, tx, user); err != nil {
			return err
		}
		var on bool
		err = tx.QueryRow(ctx, "SELECT activated_at IS NOT NULL FROM mfa_totp WHERE user_id = $1 FOR UPDATE", user).Scan(&on)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !on) {
			return ErrNoSecondStep
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "DELETE FROM mfa_totp WHERE user_id = $1", user); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "DELETE FROM mfa_recovery_codes WHERE user_id = $1", user); err != nil {
			return err
		}
		if err := s.endTrust(ctx, tx, user); err != nil {
			return err
		}
		if err := ratelimit.ClearIn(ctx, tx, ratelimit.MFAAccount, user.String()); err != nil {
			return err
		}
		return witness.record(ctx, tx)
	})
	if err != nil {
		return err
	}
	s.email(ctx, a.address, a.language, emailMFADisabled, s.link(routeReset, ""))
	return nil
}

// SecondStepOn reports, in tx, whether user's second step is on: an authenticator that is activated,
// locked or not. The platform's staff are held to it (PRD 02 §8, D-144).
func SecondStepOn(ctx context.Context, tx pgx.Tx, user uuid.UUID) (bool, error) {
	on, _, err := secondStep(ctx, tx, user)
	return on, err
}
