package staff

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/cursor"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// userKeys is the accounts' listing order: the newest first, by when each was made and then by its
// id.
var userKeys = cursor.NewKeyset("platform.users", 2)

// userItem is one account of the contract's PlatformUserPage: account metadata only, never its
// name.
type userItem struct {
	ID                  uuid.UUID  `json:"id"`
	Email               *string    `json:"email"`
	EmailVerified       bool       `json:"email_verified"`
	Locale              string     `json:"locale"`
	CreatedAt           time.Time  `json:"created_at"`
	LastSignInAt        *time.Time `json:"last_sign_in_at"`
	HouseholdCount      int        `json:"household_count"`
	IsChild             bool       `json:"is_child"`
	DeletionScheduledAt *time.Time `json:"deletion_scheduled_at"`
}

// userColumns are the columns of a users row, aliased u, that a userItem scans, in its order. The
// last sign-in is the latest of the browser sessions and the device sign-ins the account still has:
// an ended session is swept (PRD 03 §5), so it is the latest that is known, not the latest ever.
const userColumns = `u.id, u.email, u.email_verified_at IS NOT NULL, u.locale, u.created_at,
	(SELECT max(at) FROM (
	   SELECT max(s.created_at) AS at FROM sessions s WHERE s.user_id = u.id
	   UNION ALL
	   SELECT max(d.created_at) FROM device_sessions d WHERE d.user_id = u.id) signed),
	(SELECT count(*) FROM memberships m WHERE m.user_id = u.id),
	EXISTS (SELECT FROM memberships m WHERE m.user_id = u.id AND m.role = 'child'),
	(SELECT d.executes_at FROM account_deletions d WHERE d.user_id = u.id)`

func (u *userItem) dest() []any {
	return []any{&u.ID, &u.Email, &u.EmailVerified, &u.Locale, &u.CreatedAt, &u.LastSignInAt, &u.HouseholdCount, &u.IsChild,
		&u.DeletionScheduledAt}
}

func (u *userItem) settle() {
	u.CreatedAt, u.LastSignInAt, u.DeletionScheduledAt = u.CreatedAt.UTC(), utc(u.LastSignInAt), utc(u.DeletionScheduledAt)
}

// userDetail is the contract's PlatformUser: an account's metadata, with its second step's state,
// the browsers and the devices it is signed in on, and the households it is in.
type userDetail struct {
	userItem
	MFAEnabled bool            `json:"mfa_enabled"`
	MFALocked  bool            `json:"mfa_locked"`
	StaffRole  *string         `json:"staff_role"`
	Sessions   []sessionDoc    `json:"sessions"`
	Devices    []deviceDoc     `json:"devices"`
	Households []membershipDoc `json:"households"`
}

type sessionDoc struct {
	CreatedAt  time.Time `json:"created_at"`
	LastSeenAt time.Time `json:"last_seen_at"`
}

type deviceDoc struct {
	ID         uuid.UUID `json:"id"`
	Platform   *string   `json:"platform"`
	AppVersion *string   `json:"app_version"`
	LastSeenAt time.Time `json:"last_seen_at"`
	SignedIn   bool      `json:"signed_in"`
}

type membershipDoc struct {
	HouseholdID uuid.UUID `json:"household_id"`
	Name        string    `json:"name"`
	Role        string    `json:"role"`
}

// searchUsers is getPlatformUsers: the accounts whose id q is, or whose address holds it, newest
// first. An erased account, which keeps nothing but its id, is not among them.
func (s *Service) searchUsers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	before, last, err := userKeys.Before(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	q, limit := trimmed(r, "q"), cursor.Limit(r)
	items := make([]userItem, 0, limit)
	more := false
	err = s.read(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT `+userColumns+` FROM users u
			WHERE u.deleted_at IS NULL
			  AND ($1 = '' OR u.id::text = lower($1) OR `+contains("coalesce(u.email, '')", "$1")+`)
			  AND ($2::timestamptz IS NULL OR (u.created_at, u.id) < ($2, $3))
			ORDER BY u.created_at DESC, u.id DESC LIMIT $4`, q, before, last, limit+1)
		if err != nil {
			return err
		}
		var u userItem
		_, err = pgx.ForEachRow(rows, u.dest(), func() error {
			if len(items) == limit {
				more = true
				return nil
			}
			u.settle()
			items = append(items, u)
			return nil
		})
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	meta := cursor.PageMeta{}
	if more {
		end := items[len(items)-1]
		meta = userKeys.After(end.CreatedAt, end.ID)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "meta": meta})
}

// getUser is getPlatformUsersByUserId: one account's metadata.
func (s *Service) getUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := pathUUID(r, "user_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	d := userDetail{Sessions: []sessionDoc{}, Devices: []deviceDoc{}, Households: []membershipDoc{}}
	err = s.read(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, "SELECT "+userColumns+" FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL", id).
			Scan(d.dest()...); err != nil {
			return found(err)
		}
		d.settle()
		err := tx.QueryRow(ctx, "SELECT activated_at IS NOT NULL, locked_at IS NOT NULL FROM mfa_totp WHERE user_id = $1", id).
			Scan(&d.MFAEnabled, &d.MFALocked)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err := tx.QueryRow(ctx, "SELECT role::text FROM platform.staff WHERE user_id = $1", id).Scan(&d.StaffRole); err != nil &&
			!errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		rows, err := tx.Query(ctx, `
			SELECT created_at, last_seen_at FROM sessions
			WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY last_seen_at DESC, id`, id, s.cfg.Now())
		if err != nil {
			return err
		}
		var session sessionDoc
		if _, err := pgx.ForEachRow(rows, []any{&session.CreatedAt, &session.LastSeenAt}, func() error {
			session.CreatedAt, session.LastSeenAt = session.CreatedAt.UTC(), session.LastSeenAt.UTC()
			d.Sessions = append(d.Sessions, session)
			return nil
		}); err != nil {
			return err
		}

		rows, err = tx.Query(ctx, `
			SELECT d.id, d.platform, d.app_version, d.last_seen_at,
			  EXISTS (SELECT FROM device_sessions ds WHERE ds.user_id = d.user_id AND ds.device_id = d.id AND ds.revoked_at IS NULL)
			FROM devices d WHERE d.user_id = $1 ORDER BY d.last_seen_at DESC, d.id`, id)
		if err != nil {
			return err
		}
		var device deviceDoc
		if _, err := pgx.ForEachRow(rows, []any{&device.ID, &device.Platform, &device.AppVersion, &device.LastSeenAt, &device.SignedIn}, func() error {
			device.LastSeenAt = device.LastSeenAt.UTC()
			d.Devices = append(d.Devices, device)
			return nil
		}); err != nil {
			return err
		}

		rows, err = tx.Query(ctx, `
			SELECT h.id, h.name, m.role::text FROM memberships m JOIN households h ON h.id = m.household_id
			WHERE m.user_id = $1 ORDER BY m.created_at, h.id`, id)
		if err != nil {
			return err
		}
		var in membershipDoc
		_, err = pgx.ForEachRow(rows, []any{&in.HouseholdID, &in.Name, &in.Role}, func() error {
			d.Households = append(d.Households, in)
			return nil
		})
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, d)
}

// The actions support takes on an account (PRD 02 §8), as the contract's body names them.
const (
	actionResendVerification = "resend_verification"
	actionSendPasswordReset  = "send_password_reset"
	actionClearRateLimit     = "clear_rate_limit"
	actionUnlock             = "unlock"
	actionDisableMFA         = "disable_mfa"
)

// actOnUser is postPlatformUsersByUserIdActions: a verification or a reset link sent again, what is
// counted against the account on the sign-in surfaces forgotten, a locked second step unlocked, or
// one turned off for an owner who has lost both the authenticator and the recovery codes (D-100).
// Each is recorded in the platform's log in the transaction of its effect. An action touches no
// household, so no household's log says anything of it.
func (s *Service) actOnUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := pathUUID(r, "user_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var req struct {
		Action string `json:"action"`
		Reason string `json:"reason"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	reason, err := reasoned(req.Reason)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	logged := witness(caller(ctx), entry{action: "user." + req.Action, user: id, reason: reason})
	// The key is the request's, marked in the transaction of the action's effect as the spine marks
	// a mutation's.
	witnessed := func(ctx context.Context, tx pgx.Tx) error {
		if err := logged(ctx, tx); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	}
	accounts := s.cfg.Accounts
	switch req.Action {
	case actionResendVerification:
		err = accounts.ResendVerification(ctx, id, witnessed)
	case actionSendPasswordReset:
		err = accounts.SendPasswordReset(ctx, id, witnessed)
	case actionClearRateLimit:
		err = accounts.ClearRateLimits(ctx, id, witnessed)
	case actionUnlock:
		err = accounts.UnlockSecondStep(ctx, id, witnessed)
	case actionDisableMFA:
		err = accounts.DisableSecondStep(ctx, id, witnessed)
	default:
		err = invalid("/action", problem.FieldInvalid)
	}
	switch {
	case errors.Is(err, identity.ErrNoAccount):
		err = problem.NotFound()
	case errors.Is(err, identity.ErrVerified), errors.Is(err, identity.ErrNoSecondStep), errors.Is(err, identity.ErrNotLocked),
		errors.Is(err, identity.ErrNoWayBack):
		err = inapplicable()
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}
