package staff

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/cursor"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// What is the platform's own, and no household's or account's: a member's diagnostic bundle, the
// platform's flags, its log and its staff.

// bundleDoc is the contract's DiagnosticBundle, as its member sent it.
type bundleDoc struct {
	ID              uuid.UUID       `json:"id"`
	Screen          string          `json:"screen"`
	HouseholdID     *uuid.UUID      `json:"household_id"`
	TicketReference *string         `json:"ticket_reference"`
	Payload         json.RawMessage `json:"payload"`
	RedactedFields  []string        `json:"redacted_fields"`
	CreatedAt       time.Time       `json:"created_at"`
	ExpiresAt       time.Time       `json:"expires_at"`
}

// getDiagnostics is getPlatformDiagnosticsByBundleId (FR-PS1, D-20): the bundle a member assembled,
// saw in full and chose to send, as they sent it, which is the only thing of a household that ever
// reaches staff. One past its thirty days is gone, whether or not the sweep has removed it yet.
func (s *Service) getDiagnostics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := pathUUID(r, "bundle_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var b bundleDoc
	err = s.read(ctx, func(tx pgx.Tx) error {
		return found(tx.QueryRow(ctx, `
			SELECT id, screen, household_id, ticket_reference, payload, redacted_fields, created_at, expires_at
			FROM diagnostic_bundles WHERE id = $1`, id).
			Scan(&b.ID, &b.Screen, &b.HouseholdID, &b.TicketReference, &b.Payload, &b.RedactedFields, &b.CreatedAt, &b.ExpiresAt))
	})
	switch {
	case err != nil:
		s.fail(w, r, err)
		return
	case !b.ExpiresAt.After(s.cfg.Now()):
		s.fail(w, r, problem.New(http.StatusGone, problem.CodeTokenExpired))
		return
	}
	if b.RedactedFields == nil {
		b.RedactedFields = []string{}
	}
	b.CreatedAt, b.ExpiresAt = b.CreatedAt.UTC(), b.ExpiresAt.UTC()
	httpx.WriteJSON(w, http.StatusOK, b)
}

// platformFlag is a feature flag as the platform has it: on or off for every household that has no
// setting of its own.
type platformFlag struct {
	Key       string    `json:"key"`
	Enabled   bool      `json:"enabled"`
	UpdatedAt time.Time `json:"updated_at"`
}

// listFlags is getPlatformFlags: every feature flag, in the order of their keys.
func (s *Service) listFlags(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	items := []platformFlag{}
	err := s.read(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT key, enabled, updated_at FROM platform.feature_flags ORDER BY key")
		if err != nil {
			return err
		}
		var f platformFlag
		_, err = pgx.ForEachRow(rows, []any{&f.Key, &f.Enabled, &f.UpdatedAt}, func() error {
			f.UpdatedAt = f.UpdatedAt.UTC()
			items = append(items, f)
			return nil
		})
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

// setFlag is putPlatformFlagsByKey: a feature flag made, or turned on or off, for the whole platform
// (PRD 06 §7). A household's own setting of it still comes first. A flag set as it stands already is
// answered as it is, and recorded nowhere.
func (s *Service) setFlag(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	m := caller(ctx)
	key := chi.URLParam(r, "key")
	var req struct {
		Enabled bool   `json:"enabled"`
		Reason  string `json:"reason"`
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
	out := platformFlag{Key: key, Enabled: req.Enabled}
	err = tenant.AccountTx(ctx, s.cfg.Pool, m.id, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			INSERT INTO platform.feature_flags AS f (key, enabled, updated_at, updated_by) VALUES ($1, $2, $3, $4)
			ON CONFLICT (key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by
			WHERE f.enabled IS DISTINCT FROM excluded.enabled
			RETURNING updated_at`, key, req.Enabled, s.cfg.Now(), m.id).Scan(&out.UpdatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			// As it stands already.
			return tx.QueryRow(ctx, "SELECT updated_at FROM platform.feature_flags WHERE key = $1", key).Scan(&out.UpdatedAt)
		}
		if err != nil {
			return err
		}
		if err := record(ctx, tx, m, entry{action: "flag.set", reason: reason, meta: map[string]any{"key": key, "enabled": req.Enabled}}); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out.UpdatedAt = out.UpdatedAt.UTC()
	httpx.WriteJSON(w, http.StatusOK, out)
}

// auditKeys is the platform log's listing order: the newest first, by when each entry was made and
// then by its id.
var auditKeys = cursor.NewKeyset("platform.audit", 2)

// auditDoc is one entry of the contract's PlatformAuditPage.
type auditDoc struct {
	ID           uuid.UUID       `json:"id"`
	OccurredAt   time.Time       `json:"occurred_at"`
	Actor        actorRef        `json:"actor"`
	ActorRole    *string         `json:"actor_role"`
	Action       string          `json:"action"`
	HouseholdID  *uuid.UUID      `json:"household_id"`
	TargetUserID *uuid.UUID      `json:"target_user_id"`
	Reason       *string         `json:"reason"`
	Meta         json.RawMessage `json:"meta"`
}

// listAudit is getPlatformAudit: the platform's log, every staff action, newest first, whole or
// those of one staff member, about one household, or within a time (FR-PS2).
func (s *Service) listAudit(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	before, last, err := auditKeys.Before(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	// The edge has held each to its form: an id, and an instant with its offset.
	q := r.URL.Query()
	var actor, household *uuid.UUID
	for name, into := range map[string]**uuid.UUID{"actor_id": &actor, "household_id": &household} {
		if v := q.Get(name); v != "" {
			id, err := uuid.Parse(v)
			if err != nil {
				s.fail(w, r, invalid("query:"+name, problem.FieldMalformed))
				return
			}
			*into = &id
		}
	}
	var from, to *time.Time
	for name, into := range map[string]**time.Time{"from": &from, "to": &to} {
		if v := q.Get(name); v != "" {
			t, err := time.Parse(time.RFC3339Nano, v)
			if err != nil {
				s.fail(w, r, invalid("query:"+name, problem.FieldMalformed))
				return
			}
			*into = &t
		}
	}
	limit := cursor.Limit(r)
	items := make([]auditDoc, 0, limit)
	more := false
	err = s.read(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, occurred_at, actor_id, actor_label, actor_role::text, action, household_id, target_user_id, reason, meta
			FROM platform.audit_log
			WHERE ($1::uuid IS NULL OR actor_id = $1) AND ($2::uuid IS NULL OR household_id = $2)
			  AND ($3::timestamptz IS NULL OR occurred_at >= $3) AND ($4::timestamptz IS NULL OR occurred_at < $4)
			  AND ($5::timestamptz IS NULL OR (occurred_at, id) < ($5, $6))
			ORDER BY occurred_at DESC, id DESC LIMIT $7`, actor, household, from, to, before, last, limit+1)
		if err != nil {
			return err
		}
		var a auditDoc
		_, err = pgx.ForEachRow(rows, []any{&a.ID, &a.OccurredAt, &a.Actor.UserID, &a.Actor.Label, &a.ActorRole, &a.Action, &a.HouseholdID,
			&a.TargetUserID, &a.Reason, &a.Meta}, func() error {
			if len(items) == limit {
				more = true
				return nil
			}
			a.OccurredAt = a.OccurredAt.UTC()
			items = append(items, a)
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
		meta = auditKeys.After(end.OccurredAt, end.ID)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "meta": meta})
}

// staffDoc is one of the platform's staff: an account, its role, and whether its second step is on,
// without which it is admitted to nothing.
type staffDoc struct {
	UserID     uuid.UUID `json:"user_id"`
	Email      *string   `json:"email"`
	Role       string    `json:"role"`
	GrantedAt  time.Time `json:"granted_at"`
	GrantedBy  *actorRef `json:"granted_by"`
	MFAEnabled bool      `json:"mfa_enabled"`
}

// listStaff is getPlatformStaff: the platform's staff, in the order they were made staff.
func (s *Service) listStaff(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	items := []staffDoc{}
	err := s.read(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT s.user_id, u.email, s.role::text, s.granted_at, s.granted_by, g.email,
			  EXISTS (SELECT FROM mfa_totp t WHERE t.user_id = s.user_id AND t.activated_at IS NOT NULL)
			FROM platform.staff s
			JOIN users u ON u.id = s.user_id
			LEFT JOIN users g ON g.id = s.granted_by
			ORDER BY s.granted_at, s.user_id`)
		if err != nil {
			return err
		}
		var (
			d     staffDoc
			by    *uuid.UUID
			label *string
		)
		_, err = pgx.ForEachRow(rows, []any{&d.UserID, &d.Email, &d.Role, &d.GrantedAt, &by, &label, &d.MFAEnabled}, func() error {
			d.GrantedAt, d.GrantedBy = d.GrantedAt.UTC(), nil
			if by != nil {
				d.GrantedBy = &actorRef{UserID: by}
				if label != nil {
					d.GrantedBy.Label = *label
				}
			}
			items = append(items, d)
			return nil
		})
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

// What Grant and Revoke refuse.
var (
	// ErrNotAnAccount is the refusal of a user who cannot be staff: no account, one that is erased or
	// scheduled to be, or one whose address is not verified, a child profile among them.
	ErrNotAnAccount = errors.New("staff: no account with a verified address")
	// ErrLastAdmin is the refusal to take the role from the last platform_admin: the platform would
	// have nobody left who could make another.
	ErrLastAdmin = errors.New("staff: the last platform_admin")
)

// staffLock is the statement that makes two changes of the staff at once take turns, so that each
// counts the platform_admins as the other left them: a lock on the staff table that lets it be read.
const staffLock = "LOCK TABLE platform.staff IN SHARE ROW EXCLUSIVE MODE"

// lockStaff takes the staff's lock in tx and refuses by unless they are a platform_admin still, once
// it is held. The admission read their role in a transaction before this one; a platform_admin taken
// out of the staff, or made support, while their request was on its way would otherwise finish it as
// one, and could make themself one again. Every change of the staff takes the same lock, so the role
// read under it is the one that change committed. They are answered as their next request would be:
// 404 for one who is staff no longer, 403 for one who is support. The operator, who acts through the
// command line and has no row, is not asked.
func lockStaff(ctx context.Context, tx pgx.Tx, by member) error {
	if _, err := tx.Exec(ctx, staffLock); err != nil {
		return err
	}
	if by.id == uuid.Nil {
		return nil
	}
	var held *string
	if err := tx.QueryRow(ctx, "SELECT (SELECT role::text FROM platform.staff WHERE user_id = $1)", by.id).Scan(&held); err != nil {
		return err
	}
	switch {
	case held == nil:
		return problem.NotFound()
	case Role(*held) != Admin:
		return problem.New(http.StatusForbidden, problem.CodeForbidden)
	}
	return nil
}

// grant makes user one of the platform's staff with role, or changes the role they have, in tx,
// recorded as by's action e; a role they hold already is left as it is and recorded nowhere. It
// returns whether it changed anything.
func grant(ctx context.Context, tx pgx.Tx, by member, user uuid.UUID, role Role, e entry, now time.Time) (bool, error) {
	if err := lockStaff(ctx, tx, by); err != nil {
		return false, err
	}
	var eligible bool
	err := tx.QueryRow(ctx, `
		SELECT u.email_verified_at IS NOT NULL AND NOT EXISTS (SELECT FROM account_deletions d WHERE d.user_id = u.id)
		FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL FOR KEY SHARE OF u`, user).Scan(&eligible)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !eligible) {
		return false, ErrNotAnAccount
	}
	if err != nil {
		return false, err
	}
	var held *string
	if err := tx.QueryRow(ctx, "SELECT (SELECT role::text FROM platform.staff WHERE user_id = $1)", user).Scan(&held); err != nil {
		return false, err
	}
	switch {
	case held != nil && Role(*held) == role:
		return false, nil
	case held != nil && Role(*held) == Admin:
		if err := anotherAdmin(ctx, tx, user); err != nil {
			return false, err
		}
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO platform.staff AS s (user_id, role, granted_at, granted_by) VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE SET role = excluded.role, granted_at = excluded.granted_at, granted_by = excluded.granted_by`,
		user, string(role), now, nullable(by.id)); err != nil {
		return false, err
	}
	e.action, e.user = "staff.grant", user
	e.meta = map[string]any{"role": string(role)}
	return true, record(ctx, tx, by, e)
}

// revoke takes user out of the platform's staff, in tx, recorded as by's action e; one who is not
// staff is left as they are and recorded nowhere. It returns whether it changed anything.
func revoke(ctx context.Context, tx pgx.Tx, by member, user uuid.UUID, e entry) (bool, error) {
	if err := lockStaff(ctx, tx, by); err != nil {
		return false, err
	}
	var held *string
	if err := tx.QueryRow(ctx, "SELECT (SELECT role::text FROM platform.staff WHERE user_id = $1)", user).Scan(&held); err != nil {
		return false, err
	}
	switch {
	case held == nil:
		return false, nil
	case Role(*held) == Admin:
		if err := anotherAdmin(ctx, tx, user); err != nil {
			return false, err
		}
	}
	if _, err := tx.Exec(ctx, "DELETE FROM platform.staff WHERE user_id = $1", user); err != nil {
		return false, err
	}
	e.action, e.user = "staff.revoke", user
	e.meta = map[string]any{"role": *held}
	return true, record(ctx, tx, by, e)
}

// anotherAdmin refuses, in tx under the staff's lock, when user is the only platform_admin.
func anotherAdmin(ctx context.Context, tx pgx.Tx, user uuid.UUID) error {
	var another bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM platform.staff WHERE role = 'platform_admin' AND user_id <> $1)", user).
		Scan(&another); err != nil {
		return err
	}
	if !another {
		return ErrLastAdmin
	}
	return nil
}

// setStaff is putPlatformStaffByUserId: an account made one of the platform's staff, its role
// changed, or, with a null role, taken out of them. The account is one with a verified address; it
// is admitted to nothing until its second step is on. The last platform_admin keeps the role.
func (s *Service) setStaff(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	m := caller(ctx)
	id, err := pathUUID(r, "user_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var req struct {
		Role   *string `json:"role"`
		Reason string  `json:"reason"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	reason, err := reasoned(req.Reason)
	var role Role
	if err == nil && req.Role != nil {
		if role, err = ParseRole(*req.Role); err != nil {
			err = invalid("/role", problem.FieldInvalid)
		}
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	err = tenant.AccountTx(ctx, s.cfg.Pool, m.id, func(tx pgx.Tx) error {
		var (
			changed bool
			err     error
		)
		if req.Role == nil {
			changed, err = revoke(ctx, tx, m, id, entry{reason: reason})
		} else {
			changed, err = grant(ctx, tx, m, id, role, entry{reason: reason}, s.cfg.Now())
		}
		if err != nil || !changed {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	switch {
	case errors.Is(err, ErrNotAnAccount):
		err = problem.NotFound()
	case errors.Is(err, ErrLastAdmin):
		err = inapplicable()
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Grant makes the account whose address is email one of the platform's staff with role, as the
// operator, through the command line (household-api staff grant): how the first platform_admin is
// made, when there is nobody yet who could make one through the API (runbooks/platform-staff.md). It
// is recorded in the platform's log as the operator's. It reports whether it changed anything: an
// account that holds the role already is left as it is.
func Grant(ctx context.Context, pool tenant.Beginner, email string, role Role, now time.Time) (bool, error) {
	var changed bool
	err := tenant.AccountTx(ctx, pool, uuid.Nil, func(tx pgx.Tx) error {
		user, err := byAddress(ctx, tx, email)
		if err != nil {
			return err
		}
		changed, err = grant(ctx, tx, member{}, user, role, entry{reason: "made staff through the command line"}, now)
		return err
	})
	return changed && err == nil, err
}

// Revoke takes the account whose address is email out of the platform's staff, as the operator,
// through the command line (household-api staff revoke). It reports whether it changed anything: an
// account that is not staff is left as it is.
func Revoke(ctx context.Context, pool tenant.Beginner, email string) (bool, error) {
	var changed bool
	err := tenant.AccountTx(ctx, pool, uuid.Nil, func(tx pgx.Tx) error {
		user, err := byAddress(ctx, tx, email)
		if err != nil {
			return err
		}
		changed, err = revoke(ctx, tx, member{}, user, entry{reason: "taken out of the staff through the command line"})
		return err
	})
	return changed && err == nil, err
}

// byAddress returns, in tx, the account whose address is email.
func byAddress(ctx context.Context, tx pgx.Tx, email string) (uuid.UUID, error) {
	var user uuid.UUID
	err := tx.QueryRow(ctx, "SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL", email).Scan(&user)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNotAnAccount
	}
	return user, err
}
