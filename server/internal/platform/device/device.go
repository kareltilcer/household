// Package device is the mobile client's credential (FR-ID3, FR-ID4, FR-ID7, D-7, D-14, D-15): a
// device signs in and is given a token pair, a 15-minute access token (internal/platform/token)
// and a refresh token, single use and rotating, which belongs to the device's sign-in, its family.
//
// A sign-in lasts until it is revoked (D-99): a refresh token has no expiry of its own, and each
// one is exchanged for the next. A refresh token presented after it was used revokes its family,
// the device's sign-in, whose access tokens then authenticate nobody either: someone else holds a
// copy of it (D-14). The one exception is a token presented again within a minute of its use while
// the one it was exchanged for is still unused, which is a retry whose answer was lost, and is
// answered with a new pair, the unused one retired (D-98): a thief who beat the device to it is
// found out at the device's next refresh, when the token it holds has been retired.
//
// An access token authenticates a request only while its sign-in is live, which each request
// reads, one row by its key, as a web session is read: a revoked device, a password reset or
// signing out everywhere ends the device's requests at once, not when its token expires.
package device

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/token"
)

// RetryGrace is how long after its use a refresh token presented again is taken for a retry whose
// answer was lost, while the token it was exchanged for is unused (D-98).
const RetryGrace = time.Minute

// The longest label and app version a device keeps, in characters.
const (
	MaxLabel      = 80
	maxAppVersion = 64
)

// Platforms are the mobile platforms a device may name.
var Platforms = []string{"ios", "android"}

// Info is what a device says about itself as it signs in. Its id is the installation's, which the
// client keeps.
type Info struct {
	ID         uuid.UUID
	Label      string
	Platform   string
	AppVersion string
}

// Clean returns i as a row keeps it: its label and version without control characters and cut to
// their lengths, and a platform that is not one of Platforms dropped.
func (i Info) Clean() Info {
	i.Label = clean(i.Label, MaxLabel)
	i.AppVersion = clean(i.AppVersion, maxAppVersion)
	if !slices.Contains(Platforms, i.Platform) {
		i.Platform = ""
	}
	return i
}

// clean is s as a row keeps it: valid UTF-8 without control or bidirectional control characters,
// trimmed, and at most n characters.
func clean(s string, n int) string {
	s = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.In(r, unicode.Zl, unicode.Zp, unicode.Bidi_Control) {
			return -1
		}
		return r
	}, strings.ToValidUTF8(s, "")))
	if utf8.RuneCountInString(s) > n {
		s = strings.TrimSpace(string([]rune(s)[:n]))
	}
	return s
}

// Tokens are a token pair.
type Tokens struct {
	Access  string
	Refresh string
}

// Pool is the database a Store keeps devices in, connected as the request role.
type Pool = session.Pool

// Store reads and writes devices and their sign-ins.
type Store struct {
	pool Pool
	keys *token.Keys
	log  *slog.Logger
	now  func() time.Time
}

// NewStore returns the devices in pool's database, whose access tokens keys sign; log records a
// sign-in that could not be read; now is the clock, time.Now when nil.
func NewStore(pool Pool, keys *token.Keys, log *slog.Logger, now func() time.Time) *Store {
	if now == nil {
		now = time.Now
	}
	return &Store{pool: pool, keys: keys, log: log, now: now}
}

// SignIn signs d in for user in tx: the device's row made, or brought up to date, whatever sign-in
// it held ended, and a new one begun, with its first token pair. It returns the new sign-in's id.
func (s *Store) SignIn(ctx context.Context, tx pgx.Tx, user uuid.UUID, d Info) (uuid.UUID, Tokens, error) {
	d, now := d.Clean(), s.now()
	// The sign-in the device holds is locked before the device's row, as a refresh takes them
	// (Refresh), so that signing in again while the device refreshes waits its turn rather than
	// deadlocking with it. A device with none has nothing to lock yet: two first sign-ins meet at
	// its row instead, and the second then ends the first's sign-in below.
	if _, err := tx.Exec(ctx, `
		SELECT FROM device_sessions WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL FOR UPDATE`,
		user, d.ID); err != nil {
		return uuid.Nil, Tokens{}, fmt.Errorf("device: hold the device's sign-in: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO devices (user_id, id, label, platform, app_version, created_at, last_seen_at)
		VALUES ($1, $2, $3, $4, $5, $6, $6)
		ON CONFLICT (user_id, id) DO UPDATE SET
		  label = CASE WHEN excluded.label <> '' THEN excluded.label ELSE devices.label END,
		  platform = coalesce(excluded.platform, devices.platform),
		  app_version = coalesce(excluded.app_version, devices.app_version),
		  last_seen_at = excluded.last_seen_at`,
		user, d.ID, d.Label, nullable(d.Platform), nullable(d.AppVersion), now); err != nil {
		return uuid.Nil, Tokens{}, fmt.Errorf("device: register: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE device_sessions SET revoked_at = $3 WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL`,
		user, d.ID, now); err != nil {
		return uuid.Nil, Tokens{}, fmt.Errorf("device: end the device's sign-in: %w", err)
	}
	sid := idgen.New()
	if _, err := tx.Exec(ctx, `
		INSERT INTO device_sessions (id, user_id, device_id, created_at, refreshed_at) VALUES ($1, $2, $3, $4, $4)`,
		sid, user, d.ID, now); err != nil {
		return uuid.Nil, Tokens{}, fmt.Errorf("device: sign in: %w", err)
	}
	tokens, err := s.issue(ctx, tx, user, sid, uuid.Nil, now)
	return sid, tokens, err
}

// nullable is s, or NULL for "".
func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// issue writes a new refresh token for sid, replacing the used token replaces unless it is
// uuid.Nil, and returns it with an access token.
func (s *Store) issue(ctx context.Context, tx pgx.Tx, user, sid, replaces uuid.UUID, now time.Time) (Tokens, error) {
	refresh, id := session.NewToken(), idgen.New()
	if _, err := tx.Exec(ctx, "INSERT INTO refresh_tokens (id, session_id, token_hash, created_at) VALUES ($1, $2, $3, $4)",
		id, sid, session.Hash(refresh), now); err != nil {
		return Tokens{}, fmt.Errorf("device: a refresh token: %w", err)
	}
	if replaces != uuid.Nil {
		if _, err := tx.Exec(ctx, "UPDATE refresh_tokens SET used_at = coalesce(used_at, $2), replaced_by = $3 WHERE id = $1",
			replaces, now, id); err != nil {
			return Tokens{}, fmt.Errorf("device: spend a refresh token: %w", err)
		}
	}
	access, err := s.keys.Issue(user, sid, now)
	if err != nil {
		return Tokens{}, err
	}
	return Tokens{Access: access, Refresh: refresh}, nil
}

// Outcome is what a refresh came to.
type Outcome int

// The outcomes.
const (
	// Refreshed: the token was exchanged for a new pair.
	Refreshed Outcome = iota + 1
	// Invalid: the token opens no live sign-in, and nothing changed.
	Invalid
	// Reused: the token had been used, so its family was revoked, which the account's owner is
	// told of.
	Reused
)

// Refresh is the result of a refresh: its outcome, the new pair when Refreshed, and the account and
// the device when Refreshed or Reused.
type Refresh struct {
	Outcome Outcome
	Tokens  Tokens
	User    uuid.UUID
	Device  Info
}

// Refresh exchanges refresh for a new pair, recording appVersion, when it is not "", as the
// device's. A reuse revokes the family and commits; only an error rolls anything back.
func (s *Store) Refresh(ctx context.Context, refresh, appVersion string) (Refresh, error) {
	var out Refresh
	err := tenant.AccountTx(ctx, s.pool, uuid.Nil, func(tx pgx.Tx) error {
		out = Refresh{Outcome: Invalid}
		now := s.now()
		var (
			tokenID, sid uuid.UUID
			usedAt       *time.Time
			replacedBy   *uuid.UUID
			revoked      *time.Time
			platform     *string
		)
		// The sign-in's row is locked first, so that every refresh of one family takes its turn,
		// and a token presented twice at once is exchanged once and then found used.
		err := tx.QueryRow(ctx, `
			SELECT t.id, s.id, s.user_id, s.revoked_at, d.id, d.label, d.platform
			FROM refresh_tokens t
			JOIN device_sessions s ON s.id = t.session_id
			JOIN devices d ON d.user_id = s.user_id AND d.id = s.device_id
			WHERE t.token_hash = $1
			FOR UPDATE OF s`, session.Hash(refresh)).
			Scan(&tokenID, &sid, &out.User, &revoked, &out.Device.ID, &out.Device.Label, &platform)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return nil
		case err != nil:
			return err
		case revoked != nil:
			return nil
		}
		// The token itself is read once the lock is held, in a statement of its own. The one that
		// waited for the lock reads the sign-in's row as the refresh it waited for left it, but
		// every other row as it was when it began: the token would still read as unused, and be
		// exchanged a second time beside the first, two live pairs that no reuse ever finds.
		err = tx.QueryRow(ctx, "SELECT used_at, replaced_by FROM refresh_tokens WHERE id = $1", tokenID).Scan(&usedAt, &replacedBy)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return nil
		case err != nil:
			return err
		}
		if platform != nil {
			out.Device.Platform = *platform
		}
		// The token the used one was exchanged for, when a retry may still stand for it.
		var retired uuid.UUID
		if usedAt != nil {
			var successorUsed *time.Time
			retry := now.Sub(*usedAt) < RetryGrace && replacedBy != nil
			if retry {
				if err := tx.QueryRow(ctx, "SELECT used_at FROM refresh_tokens WHERE id = $1", *replacedBy).
					Scan(&successorUsed); err != nil && !errors.Is(err, pgx.ErrNoRows) {
					return err
				}
			}
			if !retry || successorUsed != nil {
				// A reuse: someone else holds a copy of the family's token.
				if _, err := tx.Exec(ctx, "UPDATE device_sessions SET revoked_at = $2 WHERE id = $1", sid, now); err != nil {
					return err
				}
				out.Outcome = Reused
				return nil
			}
			retired = *replacedBy
		}
		tokens, err := s.issue(ctx, tx, out.User, sid, tokenID, now)
		if err != nil {
			return err
		}
		if retired != uuid.Nil {
			// The pair the lost answer carried is retired, as if it had been used: presented later,
			// however soon, it is a reuse (D-98). It names itself as the token it was exchanged
			// for, which is used, so that it never passes for a retry of its own.
			if _, err := tx.Exec(ctx, "UPDATE refresh_tokens SET used_at = $2, replaced_by = id WHERE id = $1", retired, now); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, "UPDATE device_sessions SET refreshed_at = $2 WHERE id = $1", sid, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE devices SET last_seen_at = $3, app_version = coalesce($4, app_version) WHERE user_id = $1 AND id = $2`,
			out.User, out.Device.ID, now, nullable(clean(appVersion, maxAppVersion))); err != nil {
			return err
		}
		out.Outcome, out.Tokens = Refreshed, tokens
		return nil
	})
	if err != nil {
		return Refresh{}, fmt.Errorf("device: refresh: %w", err)
	}
	return out, nil
}

// End ends user's live sign-in sid in tx, and reports whether there was one.
func (s *Store) End(ctx context.Context, tx pgx.Tx, user, sid uuid.UUID) (bool, error) {
	tag, err := tx.Exec(ctx, "UPDATE device_sessions SET revoked_at = $3 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
		sid, user, s.now())
	return tag.RowsAffected() > 0, err
}

// Live reports whether user's sign-in sid is still live in tx: a request its access token
// authenticated before a reset or signing out everywhere ended it may still be running.
func (s *Store) Live(ctx context.Context, tx pgx.Tx, user, sid uuid.UUID) (bool, error) {
	var live bool
	err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM device_sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL)",
		sid, user).Scan(&live)
	return live, err
}

// Revoke ends the live sign-in of user's device id in tx, and reports whether it had one.
func (s *Store) Revoke(ctx context.Context, tx pgx.Tx, user, id uuid.UUID) (bool, error) {
	tag, err := tx.Exec(ctx, `
		UPDATE device_sessions SET revoked_at = $3 WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL`,
		user, id, s.now())
	return tag.RowsAffected() > 0, err
}

// RevokeAll ends every live sign-in of user's devices but except, uuid.Nil for none, in tx.
func (s *Store) RevokeAll(ctx context.Context, tx pgx.Tx, user, except uuid.UUID) error {
	_, err := tx.Exec(ctx, "UPDATE device_sessions SET revoked_at = $3 WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
		user, except, s.now())
	return err
}

// Device is a device a user is signed in on.
type Device struct {
	ID          uuid.UUID
	Label       string
	Platform    string
	AppVersion  string
	LastSeenAt  time.Time
	PushEnabled bool
	// Session is its live sign-in.
	Session uuid.UUID
}

// List returns user's devices with a live sign-in in tx, the most recently seen first.
func (s *Store) List(ctx context.Context, tx pgx.Tx, user uuid.UUID) ([]Device, error) {
	rows, err := tx.Query(ctx, deviceQuery+" ORDER BY d.last_seen_at DESC, d.id DESC", user)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanDevice)
}

// deviceQuery reads user's devices with a live sign-in.
const deviceQuery = `
	SELECT d.id, d.label, coalesce(d.platform, ''), coalesce(d.app_version, ''), d.last_seen_at, d.push_token IS NOT NULL, s.id
	FROM devices d JOIN device_sessions s ON s.user_id = d.user_id AND s.device_id = d.id AND s.revoked_at IS NULL
	WHERE d.user_id = $1`

func scanDevice(row pgx.CollectableRow) (Device, error) {
	var d Device
	err := row.Scan(&d.ID, &d.Label, &d.Platform, &d.AppVersion, &d.LastSeenAt, &d.PushEnabled, &d.Session)
	return d, err
}

// Get returns user's signed-in device id in tx, or false when user has no such device signed in.
func (s *Store) Get(ctx context.Context, tx pgx.Tx, user, id uuid.UUID) (Device, bool, error) {
	rows, err := tx.Query(ctx, deviceQuery+" AND d.id = $2", user, id)
	if err != nil {
		return Device{}, false, err
	}
	d, err := pgx.CollectExactlyOneRow(rows, scanDevice)
	if errors.Is(err, pgx.ErrNoRows) {
		return Device{}, false, nil
	}
	return d, err == nil, err
}

// Rename gives user's signed-in device id the label label in tx, and returns it, or false when
// user has no such device signed in.
func (s *Store) Rename(ctx context.Context, tx pgx.Tx, user, id uuid.UUID, label string) (Device, bool, error) {
	rows, err := tx.Query(ctx, `
		WITH renamed AS (
		  UPDATE devices d SET label = $3 WHERE d.user_id = $1 AND d.id = $2
		    AND EXISTS (SELECT FROM device_sessions s WHERE s.user_id = d.user_id AND s.device_id = d.id AND s.revoked_at IS NULL)
		  RETURNING d.*
		)
		SELECT d.id, d.label, coalesce(d.platform, ''), coalesce(d.app_version, ''), d.last_seen_at, d.push_token IS NOT NULL, s.id
		FROM renamed d JOIN device_sessions s ON s.user_id = d.user_id AND s.device_id = d.id AND s.revoked_at IS NULL`,
		user, id, clean(label, MaxLabel))
	if err != nil {
		return Device{}, false, err
	}
	d, err := pgx.CollectExactlyOneRow(rows, scanDevice)
	if errors.Is(err, pgx.ErrNoRows) {
		return Device{}, false, nil
	}
	return d, err == nil, err
}

// Current is the device sign-in that authenticated a request.
type Current struct {
	Session, Device uuid.UUID
}

type currentKey struct{}

// From returns the device sign-in that authenticated ctx's request, and false when none did.
func From(ctx context.Context) (Current, bool) {
	c, ok := ctx.Value(currentKey{}).(Current)
	return c, ok
}

// Authenticate is the middleware that signs a request in with its access token, Authorization:
// Bearer: the caller is the token's subject, and the request's changes arrive via mobile. A token
// that does not verify, or whose sign-in has ended, passes on with no caller, for a route that
// needs one to answer 401. A request with no bearer token passes on untouched.
func (s *Store) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, ok := Bearer(r)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		ctx := r.Context()
		claims, err := s.keys.Verify(raw, s.now())
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}
		// One statement on the pool, as a web session's lookup is: the sign-in's row, which no
		// row-level security guards.
		var device uuid.UUID
		err = s.pool.QueryRow(ctx, `
			SELECT device_id FROM device_sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
			claims.Session, claims.Subject).Scan(&device)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			next.ServeHTTP(w, r)
			return
		case err != nil:
			s.log.LogAttrs(ctx, slog.LevelError, "device sign-in lookup failed", slog.Any("error", err))
			problem.Write(w, reqctx.RequestID(ctx), problem.Internal())
			return
		}
		ctx = auth.WithUser(ctx, claims.Subject)
		ctx = mutation.WithVia(ctx, audit.ViaMobile)
		ctx = context.WithValue(ctx, currentKey{}, Current{Session: claims.Session, Device: device})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Bearer returns the token r's Authorization header carries in the Bearer scheme (RFC 6750 §2.1),
// and false when it carries none.
func Bearer(r *http.Request) (string, bool) {
	scheme, raw, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return "", false
	}
	raw = strings.TrimSpace(raw)
	return raw, raw != ""
}
