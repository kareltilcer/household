package identity

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kareltilcer/household/server/internal/platform/clientversion"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// A child profile (item 11) is an account whose one credential is a PIN, child_pin, which an owner
// sets: it has no address and no password, and the household surface (internal/platform/household)
// makes it, checks its PIN and graduates it, since each of those is its household's. What is the
// account's in them is here: the device sign-in its PIN admits, the password its graduation sets,
// and the account a graduation turns it into.

// SignInChild signs profile, a child profile whose PIN the household surface has checked, in on the
// device d in tx, as a mobile sign-in is (FR-ID3, attemptOf), with no second step, which a child is
// never asked for (FR-ID5): the device's row made or brought up to date, the sign-in it held ended,
// and a token pair issued. It returns the contract's LoginResult to answer with, which carries the
// pair: an answer no cache may keep (NoStore).
func (s *Service) SignInChild(ctx context.Context, tx pgx.Tx, r *http.Request, profile uuid.UUID, d DeviceSignIn) (LoginResult, error) {
	a, err := attemptOf(r, clientversion.Mobile, &d, "")
	if err != nil {
		return LoginResult{}, err
	}
	a.answered = true
	adm, err := s.admit(ctx, tx, r, profile, a)
	if err != nil {
		return LoginResult{}, err
	}
	return LoginResult{User: adm.me, Tokens: tokenPair(*adm.mobile)}, nil
}

// NoStore marks w's answer as one no cache may keep: a sign-in's, which carries a credential.
func NoStore(w http.ResponseWriter) { noStore(w) }

// NewPassword screens pw as registering does, naming field when it refuses it, and returns its hash
// as a credential keeps it: the password a child profile's graduation sets (FR-CH4).
func (s *Service) NewPassword(ctx context.Context, field, pw string) (string, error) {
	if err := s.screen(field, pw); err != nil {
		return "", err
	}
	return s.Hasher.Hash(ctx, pw)
}

// ErrEmailTaken is a graduation's answer for an address another account has: the sending's, and
// the confirmation's, for one taken since (Graduate).
var ErrEmailTaken = problem.New(http.StatusConflict, problem.CodeEmailTaken)

// Graduate turns child profile user into an account of its own in tx (FR-CH4): address becomes its
// address, verified, since the link that carried it was opened; secret, a password's hash
// (NewPassword), its credential in place of the PIN; and every device it was signed in on, every
// session and every trust ends, since each was the PIN's, to be signed in again with the address and
// the password. An address another account has is refused 409, email_taken. The caller holds the
// graduation's link, which it spends, and the profile's household, which turns its membership into a
// member's in the same transaction.
func (s *Service) Graduate(ctx context.Context, tx pgx.Tx, user uuid.UUID, address, secret string) error {
	var taken bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM users WHERE lower(email) = lower($1) AND id <> $2)", address, user).
		Scan(&taken); err != nil {
		return err
	}
	if taken {
		return ErrEmailTaken
	}
	tag, err := tx.Exec(ctx, "UPDATE users SET email = $2, email_verified_at = $3 WHERE id = $1", user, address, s.Sessions.Now())
	if err != nil {
		if uniqueViolation(err, "users_email") {
			return ErrEmailTaken
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return problem.NotFound()
	}
	if _, err := tx.Exec(ctx, "DELETE FROM credentials WHERE user_id = $1 AND type = 'child_pin'", user); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "INSERT INTO credentials (user_id, type, secret) VALUES ($1, 'password', $2)", user, secret); err != nil {
		return err
	}
	// The challenges first, then the sessions and the devices' sign-ins (endTrust).
	if err := s.endTrust(ctx, tx, user); err != nil {
		return err
	}
	if err := s.Sessions.RevokeAll(ctx, tx, user, uuid.Nil); err != nil {
		return err
	}
	return s.Devices.RevokeAll(ctx, tx, user, uuid.Nil)
}

// uniqueViolation reports whether err is PostgreSQL's refusal of a row that index, a unique index,
// already has: 23505, unique_violation.
func uniqueViolation(err error, index string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == index
}

// IsChild reports whether user is a child profile in tx: an account whose credential is a PIN.
func IsChild(ctx context.Context, tx pgx.Tx, user uuid.UUID) (bool, error) {
	var child bool
	err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM credentials WHERE user_id = $1 AND type = 'child_pin')", user).Scan(&child)
	return child, err
}

// errChild is the refusal of what a child profile may not do to its own account, which an owner
// manages (D-17, D-104).
var errChild = problem.New(http.StatusForbidden, problem.CodeForbidden)
