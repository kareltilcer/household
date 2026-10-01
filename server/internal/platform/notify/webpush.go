package notify

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// The longest title and body a push carries, in characters: a Web Push message is encrypted into a
// record of 4 KB at most, and a device shows a few lines anyway. A longer one is cut, never dropped.
const (
	maxTitle = 80
	maxBody  = 300
)

// pushTTL is how long a push service holds a push for a device that is offline: a day, after which
// it is old news.
const pushTTL = 24 * time.Hour

// WebPush delivers to browsers (FR-NT1): RFC 8030 messages, encrypted to the subscription's keys (RFC
// 8291) and signed with the server's VAPID key (RFC 8292).
type WebPush struct {
	private, public string
	// subject is who the push services may contact about the pushes: the server's sender address.
	subject string
	client  *http.Client
}

// NewWebPush returns the Web Push transport signing with private, a P-256 private key as 32 bytes of
// base64url, as subject, an email address, over client: nil for one of its own, which waits 15 seconds
// for a push service and follows no redirect, since a push service is only ever an endpoint's own host.
func NewWebPush(private, subject string, client *http.Client) (*WebPush, error) {
	public, err := VAPIDPublicKey(private)
	if err != nil {
		return nil, err
	}
	if subject == "" {
		return nil, errors.New("notify: Web Push needs a VAPID subject")
	}
	if client == nil {
		client = &http.Client{
			Timeout:       15 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		}
	}
	return &WebPush{private: strings.TrimRight(private, "="), public: public, subject: subject, client: client}, nil
}

// VAPIDPublicKey returns the public key of private, a P-256 private key as 32 bytes of base64url: the
// uncompressed point, in base64url, as a browser takes its applicationServerKey.
func VAPIDPublicKey(private string) (string, error) {
	scalar, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(private, "="))
	if err != nil || len(scalar) != 32 {
		return "", errors.New("notify: the VAPID key is not 32 bytes of base64url")
	}
	key, err := ecdh.P256().NewPrivateKey(scalar)
	if err != nil {
		return "", errors.New("notify: the VAPID key is not a P-256 private key")
	}
	return base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()), nil
}

// PublicKey is the key browsers subscribe with.
func (w *WebPush) PublicKey() string { return w.public }

// webPushMessage is what the web client's service worker receives: what it shows, and where a tap on
// it goes.
type webPushMessage struct {
	Title          string `json:"title"`
	Body           string `json:"body"`
	URL            string `json:"url,omitempty"`
	Tag            string `json:"tag,omitempty"`
	HouseholdID    string `json:"household_id"`
	NotificationID string `json:"notification_id"`
}

// Push sends m to t's browser. A 404 or a 410 says the subscription is gone (RFC 8030 §7.3), and another
// refusal of the push, a 400 or a 403 for a subscription made with another VAPID key, that it failed
// there. No answer, a 429, a 5xx or a redirect says nothing of the subscription: the push service, or
// the way to it, is what failed (Unavailable); nor does a refusal of the server's own VAPID signature,
// as a clock gone wrong or a subject a push service will not take would refuse every push it signed:
// a 401 (RFC 8292 §4), or Apple's or Google's 403 saying so (refusesSignature).
func (w *WebPush) Push(ctx context.Context, t Target, m Push) Outcome {
	payload, err := json.Marshal(webPushMessage{
		Title: cut(m.Title, maxTitle), Body: cut(m.Body, maxBody), URL: m.Link, Tag: m.Tag,
		HouseholdID: m.Household.String(), NotificationID: m.Notification.String(),
	})
	if err != nil {
		return Outcome{Status: Failed}
	}
	urgency := webpush.UrgencyNormal
	if m.Urgent {
		urgency = webpush.UrgencyHigh
	}
	resp, err := webpush.SendNotificationWithContext(ctx, payload,
		&webpush.Subscription{Endpoint: t.Endpoint, Keys: webpush.Keys{P256dh: t.P256dh, Auth: t.Auth}},
		&webpush.Options{
			HTTPClient: w.client, Subscriber: w.subject, VAPIDPublicKey: w.public, VAPIDPrivateKey: w.private,
			TTL: int(pushTTL.Seconds()), Urgency: urgency, Topic: m.Tag,
		})
	if err != nil {
		return Outcome{Status: Unavailable}
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	switch code := resp.StatusCode; {
	case code >= 200 && code < 300:
		return Outcome{Status: Accepted}
	case code == http.StatusNotFound || code == http.StatusGone:
		return Outcome{Status: Gone}
	case code == http.StatusUnauthorized || code == http.StatusTooManyRequests || code >= 500 || code < 400:
		return Outcome{Status: Unavailable}
	case code == http.StatusForbidden && refusesSignature(body):
		return Outcome{Status: Unavailable}
	default:
		return Outcome{Status: Failed}
	}
}

// refusesSignature reports whether body, a push service's 403, refuses the server's VAPID token rather
// than the subscription: Apple's, which answers a token it does not take, its subject neither an https
// URL nor a mailto: address, or its expiry past or more than a day off, with the reason BadJwtToken,
// and Google's, which answers one it cannot verify, or whose expiry it will not take, saying "invalid
// JWT provided", in plain text or within a JSON error. Another 403, Google's for a subscription made
// with another key, is the subscription's.
func refusesSignature(body []byte) bool {
	var answer struct {
		Reason string `json:"reason"`
	}
	if json.Unmarshal(body, &answer) == nil && answer.Reason == "BadJwtToken" {
		return true
	}
	return bytes.Contains(bytes.ToLower(body), []byte("invalid jwt"))
}

// cut returns s cut to at most n characters, an ellipsis ending one it cut.
func cut(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n-1])) + "…"
}
