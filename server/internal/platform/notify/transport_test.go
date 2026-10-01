package notify_test

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/notify"
)

// vapidKey is a test's VAPID key, a P-256 private key in base64url.
var vapidKey = base64.RawURLEncoding.EncodeToString([]byte("a test vapid key of 32 bytes ok!"))

// browserTarget is a browser's subscription at endpoint, with keys a browser would make.
func browserTarget(t *testing.T, endpoint string) notify.Target {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	secret := make([]byte, 16)
	_, _ = rand.Read(secret)
	return notify.Target{
		Transport: "web_push", ID: idgen.New(), Endpoint: endpoint,
		P256dh: base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()), Auth: base64.RawURLEncoding.EncodeToString(secret),
	}
}

// A Web Push is encrypted to the browser's keys and signed with the VAPID key, which names its
// public half, with a day to live, the urgency of who it is for and its tag as the topic; a push
// service's 404 and 410 say the subscription is gone, and any other failure is a failure.
func TestAWebPushIsEncryptedAndSigned(t *testing.T) {
	var (
		mu     sync.Mutex
		status = http.StatusCreated
		seen   *http.Request
		body   []byte
	)
	service := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		seen, body = r.Clone(r.Context()), nil
		body, _ = io.ReadAll(r.Body)
		w.WriteHeader(status)
	}))
	defer service.Close()
	push, err := notify.NewWebPush(vapidKey, "no-reply@household.example", service.Client())
	if err != nil {
		t.Fatal(err)
	}
	public, err := notify.VAPIDPublicKey(vapidKey)
	if err != nil || push.PublicKey() != public {
		t.Fatalf("the public key: %q, %v", push.PublicKey(), err)
	}
	target := browserTarget(t, service.URL+"/send/1")
	m := notify.Push{
		Notification: idgen.New(), Household: idgen.New(), Title: "Your access changed", Body: strings.Repeat("é", 400),
		Link: "/households", Tag: strings.Repeat("a", 32), Urgent: true,
	}
	if o := push.Push(t.Context(), target, m); o.Status != notify.Accepted {
		t.Fatalf("a 201: %+v", o)
	}
	mu.Lock()
	h := seen.Header
	if h.Get("Content-Encoding") != "aes128gcm" || h.Get("TTL") != "86400" || h.Get("Urgency") != "high" ||
		h.Get("Topic") != m.Tag || !strings.HasPrefix(h.Get("Authorization"), "vapid t=") ||
		!strings.HasSuffix(h.Get("Authorization"), ", k="+public) || len(body) == 0 || strings.Contains(string(body), "access") {
		t.Fatalf("the request: %v, %d bytes", h, len(body))
	}
	mu.Unlock()

	for code, want := range map[int]notify.Status{
		http.StatusNotFound: notify.Gone, http.StatusGone: notify.Gone, http.StatusTooManyRequests: notify.Failed,
		http.StatusInternalServerError: notify.Failed, http.StatusMovedPermanently: notify.Failed,
	} {
		mu.Lock()
		status = code
		mu.Unlock()
		if o := push.Push(t.Context(), target, m); o.Status != want {
			t.Errorf("a %d: %v; want %v", code, o.Status, want)
		}
	}
}

// An Expo push is the device's token, what it says and where it leads, with the access token the
// project requires; Expo's ticket is kept for its receipt, its DeviceNotRegistered is a gone token,
// and its receipts are read for the tickets it has them for.
func TestAnExpoPushIsTicketedAndItsReceiptsRead(t *testing.T) {
	var (
		mu      sync.Mutex
		sent    []map[string]any
		answer  = `{"data": [{"status": "ok", "id": "ticket-1"}]}`
		bearer  string
		receipt []string
	)
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		bearer = r.Header.Get("Authorization")
		switch r.URL.Path {
		case "/--/api/v2/push/send":
			var batch []map[string]any
			_ = json.NewDecoder(r.Body).Decode(&batch)
			sent = append(sent, batch...)
			_, _ = io.WriteString(w, answer)
		case "/--/api/v2/push/getReceipts":
			var ids struct {
				IDs []string `json:"ids"`
			}
			_ = json.NewDecoder(r.Body).Decode(&ids)
			receipt = ids.IDs
			_, _ = io.WriteString(w, `{"data": {"a": {"status": "ok"}, "b": {"status": "error", "details": {"error": "DeviceNotRegistered"}},
				"c": {"status": "error", "message": "MessageRateExceeded", "details": {"error": "MessageRateExceeded"}}}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer service.Close()
	expo, err := notify.NewExpo(service.URL+"/--/api/v2/push/", "expo-access", nil)
	if err != nil {
		t.Fatal(err)
	}
	household := uuid.New()
	target := notify.Target{Transport: "expo", ID: idgen.New(), Token: "ExponentPushToken[abc]"} //nolint:gosec // G101: a made-up device's token.
	o := expo.Push(t.Context(), target, notify.Push{Household: household, Title: "T", Body: "B", Link: "/households", Tag: "tag", Urgent: true})
	if o.Status != notify.Accepted || o.Ticket != "ticket-1" {
		t.Fatalf("an ok ticket: %+v", o)
	}
	mu.Lock()
	//nolint:gosec // G101: a made-up access token and a made-up device's token.
	if bearer != "Bearer expo-access" || len(sent) != 1 || sent[0]["to"] != "ExponentPushToken[abc]" || sent[0]["priority"] != "high" ||
		sent[0]["data"].(map[string]any)["url"] != "/households" || sent[0]["data"].(map[string]any)["household_id"] != household.String() {
		t.Fatalf("sent %q: %+v", bearer, sent)
	}
	answer = `{"data": [{"status": "error", "message": "gone", "details": {"error": "DeviceNotRegistered"}}]}`
	mu.Unlock()
	if o := expo.Push(t.Context(), target, notify.Push{}); o.Status != notify.Gone {
		t.Fatalf("DeviceNotRegistered: %+v", o)
	}
	mu.Lock()
	answer = `{"errors": [{"code": "INTERNAL"}]}`
	mu.Unlock()
	if o := expo.Push(t.Context(), target, notify.Push{}); o.Status != notify.Failed {
		t.Fatalf("no ticket: %+v", o)
	}

	got, err := expo.Receipts(t.Context(), []string{"a", "b", "c", "d"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got["a"] != notify.Accepted || got["b"] != notify.Gone || got["c"] != notify.Failed || len(receipt) != 4 {
		t.Fatalf("receipts: %v for %v", got, receipt)
	}
}
