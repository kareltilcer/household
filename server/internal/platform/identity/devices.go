package identity

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/clientversion"
	"github.com/kareltilcer/household/server/internal/platform/device"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// refresh is postAuthToken (FR-ID4): a refresh token exchanged for a new pair, the device's version
// as its Household-Client header names it recorded. A token that opens no live sign-in answers 401
// refresh_token_invalid, and so does a reuse, which revokes the family and sends the account's
// owner the takeover notice (D-14, A-11).
func (s *Service) refresh(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	var version string
	if c, ok := clientversion.From(ctx); ok && c.Type == clientversion.Mobile {
		version = c.Raw
	}
	res, err := s.Devices.Refresh(ctx, req.RefreshToken, version)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	switch res.Outcome {
	case device.Refreshed:
		noStore(w)
		httpx.WriteJSON(w, http.StatusOK, tokenPair(res.Tokens))
		return
	case device.Reused:
		// Someone holds a copy of the device's sign-in: no browser or device skips the second step
		// on the strength of a trust it may also hold (D-100).
		if err := tenant.AccountTx(ctx, s.Pool, res.User, func(tx pgx.Tx) error {
			return s.endTrust(ctx, tx, res.User)
		}); err != nil {
			s.Log.LogAttrs(ctx, slog.LevelError, "trusts not ended after a reuse", slog.Any("error", err))
		}
		s.notice(ctx, res.User, emailTokenReuse, deviceArgs(res.Device))
	case device.Invalid:
	}
	s.fail(w, r, problem.New(http.StatusUnauthorized, problem.CodeRefreshTokenInvalid))
}

// deviceArgs name d in an email: by its label, or failing that its platform, and as unnamed when
// it gave neither.
func deviceArgs(d device.Info) i18n.Args {
	name := d.Label
	if name == "" {
		name = map[string]string{"ios": "iOS", "android": "Android"}[d.Platform]
	}
	named := "yes"
	if name == "" {
		named = "no"
	}
	return i18n.Args{"device": name, "named": named}
}

// deviceJSONOut is the contract's Device.
type deviceJSONOut struct {
	ID          uuid.UUID `json:"id"`
	Label       string    `json:"label"`
	Platform    *string   `json:"platform,omitempty"`
	AppVersion  string    `json:"app_version"`
	LastSeenAt  time.Time `json:"last_seen_at"`
	PushEnabled bool      `json:"push_enabled"`
	SyncCursor  *int64    `json:"sync_cursor"`
	IsCurrent   bool      `json:"is_current"`
}

func deviceOut(d device.Device, current device.Current, fromDevice bool) deviceJSONOut {
	out := deviceJSONOut{ID: d.ID, Label: d.Label, AppVersion: d.AppVersion, LastSeenAt: d.LastSeenAt.UTC(),
		PushEnabled: d.PushEnabled, IsCurrent: fromDevice && current.Session == d.Session}
	if d.Platform != "" {
		out.Platform = &d.Platform
	}
	return out
}

// devices is getMeDevices (FR-ID7): the devices the account is signed in on, the most recently
// seen first, and which of them the request came from.
func (s *Service) devices(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	current, fromDevice := device.From(ctx)
	var list []device.Device
	err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		var err error
		list, err = s.Devices.List(ctx, tx, user)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	items := make([]deviceJSONOut, 0, len(list))
	for _, d := range list {
		items = append(items, deviceOut(d, current, fromDevice))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string][]deviceJSONOut{"items": items})
}

// renameDevice is patchMeDevicesByDeviceId: a device the account is signed in on gets a new label.
// Any other device, another user's included, is not found.
func (s *Service) renameDevice(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	id, err := uuid.Parse(chi.URLParam(r, "device_id"))
	if err != nil {
		s.fail(w, r, problem.NotFound())
		return
	}
	var members map[string]json.RawMessage
	if err := decode(r, &members); err != nil {
		s.fail(w, r, err)
		return
	}
	var label *string
	if raw, ok := members["label"]; ok {
		if err := json.Unmarshal(raw, &label); err != nil || label == nil {
			s.fail(w, r, invalid("/label", "type"))
			return
		}
	}
	current, fromDevice := device.From(ctx)
	var d device.Device
	err = tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		var (
			found bool
			err   error
		)
		if label != nil {
			d, found, err = s.Devices.Rename(ctx, tx, user, id, *label)
		} else {
			d, found, err = s.Devices.Get(ctx, tx, user, id)
		}
		if err != nil {
			return err
		}
		if !found {
			return problem.NotFound()
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, deviceOut(d, current, fromDevice))
}

// revokeDevice is deleteMeDevicesByDeviceId (FR-ID7): a device the account is signed in on is
// signed out, its refresh token and its access tokens opening nothing from now on, and its
// replica discarded when it next asks for a pair. Any other device is not found.
func (s *Service) revokeDevice(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	id, err := uuid.Parse(chi.URLParam(r, "device_id"))
	if err != nil {
		s.fail(w, r, problem.NotFound())
		return
	}
	err = tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		// A device signed out from the list may be lost, with a trust to skip the second step in
		// it: every trust ends (D-100), before its sign-in does, as endTrust's order asks.
		if err := s.endTrust(ctx, tx, user); err != nil {
			return err
		}
		revoked, err := s.Devices.Revoke(ctx, tx, user, id)
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
	w.WriteHeader(http.StatusNoContent)
}
