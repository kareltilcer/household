package identity

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/avatar"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// meJSON is the contract's Me.
type meJSON struct {
	ID                   uuid.UUID  `json:"id"`
	Email                *string    `json:"email"`
	EmailVerified        bool       `json:"email_verified"`
	DisplayName          string     `json:"display_name"`
	AvatarURL            *string    `json:"avatar_url"`
	Locale               string     `json:"locale"`
	Timezone             *string    `json:"timezone"`
	FirstDayOfWeek       *int       `json:"first_day_of_week"`
	IsChild              bool       `json:"is_child"`
	MFAEnabled           bool       `json:"mfa_enabled"`
	MFARecoveryCodesLeft *int       `json:"mfa_recovery_codes_left"`
	Credentials          []string   `json:"credentials"`
	DeletionScheduledAt  *time.Time `json:"deletion_scheduled_at"`
}

// loadMe reads user as the contract's Me, their picture's link among it (avatar.Service.URL). A
// scheduled deletion is item 20's; until then it reads as absent.
func (s *Service) loadMe(ctx context.Context, tx pgx.Tx, user uuid.UUID) (meJSON, error) {
	me := meJSON{ID: user}
	var (
		left    int
		picture avatar.Ref
	)
	err := tx.QueryRow(ctx, `
		SELECT u.email, u.email_verified_at IS NOT NULL, u.display_name, u.locale, u.timezone, u.first_day_of_week,
		  array(SELECT c.type::text FROM credentials c WHERE c.user_id = u.id ORDER BY c.type),
		  EXISTS (SELECT FROM mfa_totp t WHERE t.user_id = u.id AND t.activated_at IS NOT NULL),
		  (SELECT count(*) FROM mfa_recovery_codes r WHERE r.user_id = u.id AND r.used_at IS NULL),
		  `+avatar.Columns("u.id")+`
		FROM users u WHERE u.id = $1`, user).
		Scan(&me.Email, &me.EmailVerified, &me.DisplayName, &me.Locale, &me.Timezone, &me.FirstDayOfWeek, &me.Credentials,
			&me.MFAEnabled, &left, &picture.ID, &picture.ContentType)
	if err != nil {
		return me, err
	}
	me.IsChild = slices.Contains(me.Credentials, "child_pin")
	if me.MFAEnabled {
		me.MFARecoveryCodesLeft = &left
	}
	me.AvatarURL = s.Avatars.URL(ctx, user, picture)
	return me, nil
}

// me is getMe.
func (s *Service) me(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	var me meJSON
	err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		var err error
		me, err = s.loadMe(ctx, tx, user)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, me)
}

// profileUpdate is what a PATCH /me changes: each field that is set, to its value, a nil value
// clearing a field that may be empty.
type profileUpdate struct {
	displayName, locale      *string
	setTimezone, setFirstDay bool
	timezone                 *string
	firstDayOfWeek           *int
	clearAvatar              bool
}

// readUpdate reads a MeUpdate, a JSON merge: a member left out is unchanged, and null clears one
// that may be null. The edge has checked each member's type and range; what it cannot, a name of
// nothing but white space, a tag that is no language, a zone the binary does not know, is refused
// here, naming each.
func readUpdate(r *http.Request) (profileUpdate, error) {
	var (
		members map[string]json.RawMessage
		u       profileUpdate
		errs    []problem.FieldError
	)
	if err := decode(r, &members); err != nil {
		return u, err
	}
	null := func(raw json.RawMessage) bool { return string(raw) == "null" }
	if raw, ok := members["display_name"]; ok {
		var name string
		if err := json.Unmarshal(raw, &name); err != nil {
			return u, invalid("/display_name", problem.FieldMalformed)
		}
		if name, ok = displayName(name); !ok {
			errs = append(errs, problem.FieldError{Field: "/display_name", Code: problem.FieldInvalid})
		}
		u.displayName = &name
	}
	if raw, ok := members["locale"]; ok {
		var tag string
		if err := json.Unmarshal(raw, &tag); err != nil {
			return u, invalid("/locale", problem.FieldMalformed)
		}
		if tag, ok = locale(tag); !ok {
			errs = append(errs, problem.FieldError{Field: "/locale", Code: problem.FieldMalformed})
		}
		u.locale = &tag
	}
	if raw, ok := members["timezone"]; ok {
		u.setTimezone = true
		if !null(raw) {
			var zone string
			if err := json.Unmarshal(raw, &zone); err != nil {
				return u, invalid("/timezone", problem.FieldMalformed)
			}
			if !timezone(zone) {
				errs = append(errs, problem.FieldError{Field: "/timezone", Code: problem.FieldInvalid})
			}
			u.timezone = &zone
		}
	}
	if raw, ok := members["first_day_of_week"]; ok {
		u.setFirstDay = true
		if !null(raw) {
			var day int
			if err := json.Unmarshal(raw, &day); err != nil || day < 0 || day > 6 {
				return u, invalid("/first_day_of_week", problem.FieldMalformed)
			}
			u.firstDayOfWeek = &day
		}
	}
	// A picture is uploaded as a file (putMeAvatar), never named by a URL: null clears it, and any
	// other value is refused.
	if raw, ok := members["avatar_url"]; ok {
		if !null(raw) {
			errs = append(errs, problem.FieldError{Field: "/avatar_url", Code: problem.FieldInvalid})
		}
		u.clearAvatar = true
	}
	if len(errs) > 0 {
		return u, problem.Validation(errs...)
	}
	return u, nil
}

// updateMe is patchMe.
func (s *Service) updateMe(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	u, err := readUpdate(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var (
		me      meJSON
		cleared uuid.UUID
	)
	err = tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			UPDATE users SET
			  display_name = coalesce($2, display_name),
			  locale = coalesce($3, locale),
			  timezone = CASE WHEN $4 THEN $5 ELSE timezone END,
			  first_day_of_week = CASE WHEN $6 THEN $7::smallint ELSE first_day_of_week END
			WHERE id = $1`,
			user, u.displayName, u.locale, u.setTimezone, u.timezone, u.setFirstDay, u.firstDayOfWeek); err != nil {
			return err
		}
		var err error
		if u.clearAvatar {
			if cleared, err = avatar.Clear(ctx, tx, user); err != nil {
				return err
			}
		}
		if me, err = s.loadMe(ctx, tx, user); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.Avatars.Purge(ctx, user, cleared)
	httpx.WriteJSON(w, http.StatusOK, me)
}

// putAvatar is putMeAvatar: the caller's picture, made from an image they upload (avatar.Upload), in
// place of any they had, which goes once the new one is recorded. It is the account's, and counts
// against no household's storage (D-107).
func (s *Service) putAvatar(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	picture, err := s.Avatars.Upload(w, r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.Avatars.Put(ctx, user, picture); err != nil {
		s.fail(w, r, err)
		return
	}
	var (
		me       meJSON
		replaced uuid.UUID
	)
	err = tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		var err error
		if replaced, err = avatar.Set(ctx, tx, user, picture); err != nil {
			return err
		}
		if me, err = s.loadMe(ctx, tx, user); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.Avatars.Purge(ctx, user, replaced)
	httpx.WriteJSON(w, http.StatusOK, me)
}

// sessionJSON is the contract's Session. Where a session is, roughly, needs an IP-to-place source
// the platform does not have yet, so approximate_location is null.
type sessionJSON struct {
	ID                  uuid.UUID `json:"id"`
	CreatedAt           time.Time `json:"created_at"`
	LastSeenAt          time.Time `json:"last_seen_at"`
	ApproximateLocation *string   `json:"approximate_location"`
	UserAgent           string    `json:"user_agent"`
	IsCurrent           bool      `json:"is_current"`
}

// sessions is getMeSessions (FR-ID7): the live web sessions, the most recently used first, and
// which of them the request came with.
func (s *Service) sessions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	current, _ := session.Current(ctx)
	var list []session.Session
	err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		var err error
		list, err = s.Sessions.List(ctx, tx, user)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	items := make([]sessionJSON, 0, len(list))
	for _, sess := range list {
		items = append(items, sessionJSON{
			ID: sess.ID, CreatedAt: sess.CreatedAt.UTC(), LastSeenAt: sess.LastSeenAt.UTC(),
			UserAgent: sess.UserAgent, IsCurrent: sess.ID == current,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string][]sessionJSON{"items": items})
}

// signOutEverywhere is deleteMeSessions (FR-ID7): every session ends, the one the request came
// with too, whose cookies go, and every device's sign-in, and no browser or device stays trusted to
// skip the second step.
func (s *Service) signOutEverywhere(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		// The trusts and the challenges first, then the sessions and the devices' sign-ins
		// (endTrust).
		if err := s.endTrust(ctx, tx, user); err != nil {
			return err
		}
		if err := s.Sessions.RevokeAll(ctx, tx, user, uuid.Nil); err != nil {
			return err
		}
		if err := s.Devices.RevokeAll(ctx, tx, user, uuid.Nil); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if _, ok := session.Current(ctx); ok {
		session.ClearCookies(w)
	}
	w.WriteHeader(http.StatusNoContent)
}

// revokeSession is deleteMeSessionsBySessionId: one of the caller's live sessions ends. Any other
// session, another user's included, is not found.
func (s *Service) revokeSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	id, err := uuid.Parse(chi.URLParam(r, "session_id"))
	if err != nil {
		s.fail(w, r, problem.NotFound())
		return
	}
	err = tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		// A browser signed out from the list may be lost, with a trust to skip the second step in
		// it: every trust ends (D-100), before its session does, as endTrust's order asks.
		if err := s.endTrust(ctx, tx, user); err != nil {
			return err
		}
		revoked, err := s.Sessions.Revoke(ctx, tx, user, id)
		if err != nil {
			return err
		}
		if !revoked {
			return problem.NotFound()
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if current, ok := session.Current(ctx); ok && current == id {
		session.ClearCookies(w)
	}
	w.WriteHeader(http.StatusNoContent)
}
