package identity

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// The account's half of its own deletion (FR-PR3, FR-PR4; plan item 20), which the privacy service
// drives: who may ask for it, what disabling the account ends, the link that cancels it, and what
// erasing it deletes of the tables that are the account's.

// purposeCancelDeletion is the purpose of the link a scheduled deletion's email carries.
const purposeCancelDeletion = "cancel_deletion"

// disabled reports whether user's account is scheduled for deletion, and so signs nobody in
// (FR-PR4): read in tx, the transaction that would admit them, once it holds the user's row against
// a deletion being scheduled meanwhile. Scheduling one takes the row FOR UPDATE (LockAccount) before
// it ends the account's sessions, so either this waits for it and finds the account disabled, or it
// waits for this and ends the session this made. The two are statements of their own: one that
// waited for the row would still read the deletions as they were before it waited.
func disabled(ctx context.Context, tx pgx.Tx, user uuid.UUID) (bool, error) {
	if _, err := tx.Exec(ctx, "SELECT FROM users WHERE id = $1 FOR KEY SHARE", user); err != nil {
		return false, err
	}
	var is bool
	err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM account_deletions WHERE user_id = $1)", user).Scan(&is)
	return is, err
}

// LockAccount locks user's row in tx against every sign-in to the account until tx ends (disabled):
// what schedules the account's deletion takes it first.
func LockAccount(ctx context.Context, tx pgx.Tx, user uuid.UUID) error {
	_, err := tx.Exec(ctx, "SELECT FROM users WHERE id = $1 FOR UPDATE", user)
	return err
}

// Owner is the account a deletion is confirmed for: where its email goes, and in which language.
type Owner struct {
	Address, Locale string
}

// ConfirmDeletion checks that proof authorises the deletion of user's account, which a stolen
// session alone must not (FR-PR3): the account's password, checked and counted as a sign-in's is
// (reauthenticate), or, for an account that signs in only with a provider and has none, its own
// address typed out. A child profile, which is nothing outside its household and which an owner
// removes instead, is refused 403 (D-104). A wrong proof is answered as a wrong password is.
func (s *Service) ConfirmDeletion(ctx context.Context, user uuid.UUID, proof string) (Owner, error) {
	var (
		address     *string
		language    string
		credentials []string
	)
	err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT u.email, u.locale, array(SELECT c.type::text FROM credentials c WHERE c.user_id = u.id)
			FROM users u WHERE u.id = $1`, user).Scan(&address, &language, &credentials)
	})
	if err != nil {
		return Owner{}, err
	}
	hasPassword := false
	for _, c := range credentials {
		switch c {
		case "child_pin":
			return Owner{}, problem.New(http.StatusForbidden, problem.CodeForbidden)
		case "password":
			hasPassword = true
		}
	}
	if address == nil {
		return Owner{}, InvalidCredentials()
	}
	if hasPassword {
		c, err := s.reauthenticate(ctx, user, proof)
		return Owner{Address: c.address, Locale: c.language}, err
	}
	if !strings.EqualFold(strings.TrimSpace(proof), *address) {
		return Owner{}, InvalidCredentials()
	}
	return Owner{Address: *address, Locale: language}, nil
}

// Disable ends everything that signs user in, in tx (FR-PR4): every web session and every device's
// sign-in, every trust to skip the second step and every challenge waiting for one. The row that
// schedules the deletion, which the caller writes in tx too, keeps anything from signing them in
// again (disabled).
func (s *Service) Disable(ctx context.Context, tx pgx.Tx, user uuid.UUID) error {
	// The trusts and the challenges first, then the sessions and the devices' sign-ins (endTrust).
	if err := s.endTrust(ctx, tx, user); err != nil {
		return err
	}
	if err := s.Sessions.RevokeAll(ctx, tx, user, uuid.Nil); err != nil {
		return err
	}
	return s.Devices.RevokeAll(ctx, tx, user, uuid.Nil)
}

// IssueCancelLink writes, in tx, the token of the link that cancels user's deletion, sent to address
// and good for ttl, and returns it. A token issued for an earlier deletion of theirs is spent.
func (s *Service) IssueCancelLink(ctx context.Context, tx pgx.Tx, user uuid.UUID, address string, ttl time.Duration) (string, error) {
	now := s.Sessions.Now()
	if _, err := tx.Exec(ctx, "UPDATE email_tokens SET used_at = $2 WHERE user_id = $1 AND purpose::text = $3 AND used_at IS NULL",
		user, now, purposeCancelDeletion); err != nil {
		return "", err
	}
	return issueToken(ctx, tx, user, purposeCancelDeletion, address, ttl, now)
}

// SpendCancelLink spends token, the link that cancels a deletion, in tx, and returns whose it is. A
// token nobody issued is not found; one spent, or past its time, is answered 410, as every link is.
func (s *Service) SpendCancelLink(ctx context.Context, tx pgx.Tx, token string) (uuid.UUID, error) {
	t, ok, err := findToken(ctx, tx, token, purposeCancelDeletion)
	switch {
	case err != nil:
		return uuid.Nil, err
	case !ok:
		return uuid.Nil, problem.NotFound()
	case t.used != nil:
		return uuid.Nil, errTokenUsed
	case !s.Sessions.Now().Before(t.expires):
		return uuid.Nil, errTokenExpired
	}
	_, err = tx.Exec(ctx, "UPDATE email_tokens SET used_at = $2 WHERE id = $1", t.id, s.Sessions.Now())
	return t.user, err
}

// SendLink sends template to address after the response, in the language of locale, with the link
// that opens the web client's route carrying token in its fragment.
func (s *Service) SendLink(ctx context.Context, address, locale string, template mail.Template, route, token string, args ...i18n.Args) {
	s.email(ctx, address, locale, template, s.link(route, token), args...)
}

// Now is the service's clock.
func (s *Service) Now() time.Time { return s.Sessions.Now() }

// Erase deletes what identity keeps of user's account, in tx, and leaves its users row as the
// tombstone FR-PR4 asks for: its id and when it was deleted, and nothing else. Every way it signed
// in goes, with its sessions, its devices and their sign-ins, its second step and its links; its
// picture's row goes, and its bytes with the account's prefix, which the caller removes once tx has
// committed. What still names the user, who made a row and who an event's actor was, names the
// tombstone, which reads as a former member.
func (s *Service) Erase(ctx context.Context, tx pgx.Tx, user uuid.UUID) error {
	for _, table := range []string{
		"credentials", "sessions", "email_tokens", "account_idempotency_keys", "devices", "mfa_totp", "mfa_recovery_codes",
		"mfa_challenges", "mfa_trusts", "oauth_states", "avatars",
	} {
		if _, err := tx.Exec(ctx, "DELETE FROM "+table+" WHERE user_id = $1", user); err != nil {
			return err
		}
	}
	// A graduation's link the user sent names them as its sender.
	if _, err := tx.Exec(ctx, "DELETE FROM email_tokens WHERE sent_by = $1", user); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `
		UPDATE users SET email = NULL, email_verified_at = NULL, display_name = '', locale = 'en', timezone = NULL,
		  first_day_of_week = NULL, deleted_at = $2
		WHERE id = $1 AND deleted_at IS NULL`, user, s.Sessions.Now())
	if err == nil && tag.RowsAffected() == 0 {
		err = errors.New("identity: no account to erase")
	}
	return err
}

// Export is what identity keeps of user's account as their export carries it (FR-PR2), read in tx:
// their profile, the ways they sign in, never a secret, and where they are signed in, their web
// sessions and their devices, without a token or a network address.
func (s *Service) Export(ctx context.Context, tx pgx.Tx, user uuid.UUID) (map[string]any, error) {
	me, err := s.loadMe(ctx, tx, user)
	if err != nil {
		return nil, err
	}
	// The picture is in no archive: its link lasts minutes, and it is the one file the account keeps
	// that the account itself uploaded as it is.
	me.AvatarURL = nil
	var created time.Time
	if err := tx.QueryRow(ctx, "SELECT created_at FROM users WHERE id = $1", user).Scan(&created); err != nil {
		return nil, err
	}
	var sessions, devices []byte
	if err := tx.QueryRow(ctx, `
		SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'user_agent', s.user_agent, 'created_at', s.created_at,
		  'last_seen_at', s.last_seen_at) ORDER BY s.created_at), '[]')
		FROM sessions s WHERE s.user_id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, user).Scan(&sessions); err != nil {
		return nil, err
	}
	if err := tx.QueryRow(ctx, `
		SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'platform', d.platform,
		  'app_version', d.app_version, 'created_at', d.created_at, 'last_seen_at', d.last_seen_at) ORDER BY d.created_at), '[]')
		FROM devices d WHERE d.user_id = $1`, user).Scan(&devices); err != nil {
		return nil, err
	}
	return map[string]any{
		"profile": me, "created_at": created.UTC(), "sessions": json.RawMessage(sessions), "devices": json.RawMessage(devices),
	}, nil
}
