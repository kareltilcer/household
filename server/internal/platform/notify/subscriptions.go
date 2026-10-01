package notify

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/device"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// DefaultPushHosts are the push services a browser's Web Push endpoint may name, the host itself or
// one of its subdomains, which Mozilla and Microsoft shard across. The endpoint is the one thing a
// subscription says about where the server sends, so a member who could name any https URL could
// have the server send to a host of their choosing for every notification they are sent: a browser
// names one of these and nothing else. A deployment adds a new browser's service through
// HOUSEHOLD_PUSH_HOSTS before this list learns it.
var DefaultPushHosts = []string{
	"fcm.googleapis.com",        // Chrome, Edge, Opera, Brave, Samsung Internet
	"android.googleapis.com",    // older Chrome on Android
	"push.services.mozilla.com", // Firefox
	"push.apple.com",            // Safari, and an installed web app on iOS (web.push.apple.com)
	"notify.windows.com",        // Edge before Chromium (WNS)
}

// expoToken is an Expo push token, as expo-notifications hands it to the app.
var expoToken = regexp.MustCompile(`^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{1,256}\]$`)

// AccountRoutes registers the routes about the caller's own notifications, on the API's router, behind
// the authentication, a check that there is a caller, and the account's Idempotency-Key: where their
// browsers and devices are reached, and what they want to be told.
func (s *Service) AccountRoutes(r chi.Router) {
	r.Get("/push/vapid-key", s.vapidKey)
	r.Post("/push/subscriptions", s.subscribe)
	r.Delete("/push/subscriptions", s.unsubscribe)
	r.Get("/me/notification-preferences", s.getPreferences)
	r.Patch("/me/notification-preferences", s.patchPreferences)
}

// fail answers err's problem, or 500 for an error that is not one, which it logs.
func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	var p *problem.Problem
	if !errors.As(err, &p) {
		s.cfg.Log.LogAttrs(r.Context(), slog.LevelError, "notify request failed", slog.Any("error", err))
	}
	problem.Write(w, reqctx.RequestID(r.Context()), err)
}

// vapidKey is getPushVapidKey: the key a browser subscribes with as its applicationServerKey, the
// public half of the server's VAPID key, which signs every Web Push it sends (RFC 8292).
func (s *Service) vapidKey(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"key": s.cfg.VAPIDKey})
}

// subscriptionJSON is the contract's PushSubscription.
type subscriptionJSON struct {
	ID         uuid.UUID `json:"id"`
	Transport  string    `json:"transport"`
	CreatedAt  time.Time `json:"created_at"`
	LastSeenAt time.Time `json:"last_seen_at"`
}

// subscriptionCreate is the contract's PushSubscriptionCreate.
type subscriptionCreate struct {
	Transport string `json:"transport"`
	Endpoint  string `json:"endpoint"`
	Keys      struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
	DeviceID *uuid.UUID `json:"device_id"`
}

// subscribe is postPushSubscriptions: a browser's Web Push subscription, registered from its web
// session, or the Expo push token of the device the request is signed in on. A browser's subscription
// reaches its user while that session lives; a token reaches its device while the device's sign-in
// does. Registering again clears what failures had marked: a target that went stale is tried again.
func (s *Service) subscribe(w http.ResponseWriter, r *http.Request) {
	var req subscriptionCreate
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.fail(w, r, problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed}))
		return
	}
	var (
		sub     subscriptionJSON
		created bool
		err     error
	)
	switch req.Transport {
	case "web_push":
		sub, created, err = s.subscribeBrowser(r, req)
	case "expo":
		sub, created, err = s.subscribeDevice(r, req)
	default:
		err = problem.Validation(problem.FieldError{Field: "/transport", Code: "enum"})
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	httpx.WriteJSON(w, status, sub)
}

// subscribeBrowser registers a Web Push subscription for the web session req came in on. A browser
// that another user subscribed is moved to this one, who is now who uses it.
func (s *Service) subscribeBrowser(r *http.Request, req subscriptionCreate) (subscriptionJSON, bool, error) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	sid, ok := session.Current(ctx)
	if !ok {
		// A device's sign-in is reached through its Expo token, not a browser's subscription.
		return subscriptionJSON{}, false, problem.Validation(problem.FieldError{Field: "/transport", Code: problem.FieldInvalid})
	}
	var errs []problem.FieldError
	if !s.pushEndpoint(req.Endpoint) {
		errs = append(errs, problem.FieldError{Field: "/endpoint", Code: problem.FieldInvalid})
	}
	p256dh, ok := key(req.Keys.P256dh, 65)
	if !ok || p256dh[0] != 4 {
		errs = append(errs, problem.FieldError{Field: "/keys/p256dh", Code: problem.FieldInvalid})
	}
	auth, ok := key(req.Keys.Auth, 16)
	if !ok {
		errs = append(errs, problem.FieldError{Field: "/keys/auth", Code: problem.FieldInvalid})
	}
	if len(errs) > 0 {
		return subscriptionJSON{}, false, problem.Validation(errs...)
	}
	sub := subscriptionJSON{Transport: "web_push"}
	var created bool
	err := tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (endpoint) DO UPDATE SET user_id = $2, session_id = $3, p256dh = $5, auth = $6,
			  last_seen_at = now(), failures = 0, stale_at = NULL
			RETURNING id, created_at, last_seen_at, xmax = 0`,
			idgen.New(), user, sid, req.Endpoint, base64.RawURLEncoding.EncodeToString(p256dh),
			base64.RawURLEncoding.EncodeToString(auth)).Scan(&sub.ID, &sub.CreatedAt, &sub.LastSeenAt, &created); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	return sub, created, err
}

// subscribeDevice registers the Expo push token of the device req is signed in on.
func (s *Service) subscribeDevice(r *http.Request, req subscriptionCreate) (subscriptionJSON, bool, error) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	current, ok := device.From(ctx)
	switch {
	case !ok:
		// A browser is reached through its Web Push subscription.
		return subscriptionJSON{}, false, problem.Validation(problem.FieldError{Field: "/transport", Code: problem.FieldInvalid})
	case req.DeviceID != nil && *req.DeviceID != current.Device:
		return subscriptionJSON{}, false, problem.Validation(problem.FieldError{Field: "/device_id", Code: problem.FieldInvalid})
	case !expoToken.MatchString(req.Endpoint):
		return subscriptionJSON{}, false, problem.Validation(problem.FieldError{Field: "/endpoint", Code: problem.FieldInvalid})
	}
	sub := subscriptionJSON{ID: current.Device, Transport: "expo"}
	var created bool
	err := tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			WITH before AS (SELECT push_token FROM devices WHERE user_id = $1 AND id = $2 FOR UPDATE)
			UPDATE devices d SET push_token = $3,
			  push_registered_at = CASE WHEN d.push_token IS DISTINCT FROM $3 THEN now() ELSE d.push_registered_at END,
			  push_failures = 0, push_stale_at = NULL
			FROM before
			WHERE d.user_id = $1 AND d.id = $2
			RETURNING d.push_registered_at, d.last_seen_at, before.push_token IS DISTINCT FROM $3`,
			user, current.Device, req.Endpoint).Scan(&sub.CreatedAt, &sub.LastSeenAt, &created); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	return sub, created, err
}

// unsubscribe is deletePushSubscriptions: the caller's browser subscription with the endpoint the
// query names, or their device's token. It answers 204 when there was none, as the app signing out
// may ask after the subscription is gone.
func (s *Service) unsubscribe(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	endpoint := r.URL.Query().Get("endpoint")
	err := tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2", user, endpoint); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE devices SET push_token = NULL, push_registered_at = NULL, push_failures = 0, push_stale_at = NULL
			WHERE user_id = $1 AND push_token = $2`, user, endpoint); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// pushEndpoint reports whether endpoint is a Web Push endpoint the server sends to: an https URL with
// no credentials, at a push service it knows (Config.PushHosts).
func (s *Service) pushEndpoint(endpoint string) bool {
	if len(endpoint) > 2048 {
		return false
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Hostname() == "" || u.Fragment != "" {
		return false
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	for _, allowed := range s.cfg.PushHosts {
		if host == allowed || strings.HasSuffix(host, "."+allowed) {
			return true
		}
	}
	return false
}

// key decodes a browser's key, base64url, padded or not, and reports whether it is n bytes long.
func key(s string, n int) ([]byte, bool) {
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
	return b, err == nil && len(b) == n
}
