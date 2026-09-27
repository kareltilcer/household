package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/health"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

func TestMain(m *testing.M) { testsupport.Main(m) }

// syncBuffer is a log destination the server's goroutines may write to concurrently.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func router(t *testing.T, checks ...health.Check) (*chi.Mux, *syncBuffer) {
	t.Helper()
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	logs := &syncBuffer{}
	log := logging.New(logs, slog.LevelDebug)
	r, err := app.NewRouter(app.Deps{
		Logger: log, Contract: c, Health: health.New(log, time.Second, checks...), MaxBodyBytes: 1 << 10,
	})
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}
	return r, logs
}

func get(t *testing.T, path string) *http.Request {
	return httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
}

func TestLiveness(t *testing.T) {
	r, _ := router(t)
	rec := testsupport.Serve(t, r, get(t, "/api/v1/healthz"))
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"status":"ok"}` {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Error("a probe response may be cached")
	}
}

func TestReadinessChecksTheDatabase(t *testing.T) {
	pool := testsupport.Open(t).Pool(t, db.RoleApp)
	r, _ := router(t, health.Database(pool))
	rec := testsupport.Serve(t, r, get(t, "/api/v1/readyz"))
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"status":"ok","checks":{"database":"ok"}}` {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
}

func TestReadinessFailsWhenACheckDoes(t *testing.T) {
	down := health.Check{Name: "database", Probe: func(context.Context) error {
		return errors.New("dial tcp 127.0.0.1:5432: connection refused")
	}}
	slow := health.Check{Name: "object_store", Probe: func(ctx context.Context) error {
		<-ctx.Done() // Answers only when the probe's timeout ends it.
		return ctx.Err()
	}}
	up := health.Check{Name: "cache", Probe: func(context.Context) error { return nil }}
	r, logs := router(t, down, slow, up)
	rec := testsupport.Serve(t, r, get(t, "/api/v1/readyz"))
	var body health.Readiness
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusServiceUnavailable || body.Status != "down" ||
		body.Checks["database"] != "down" || body.Checks["object_store"] != "down" || body.Checks["cache"] != "ok" {
		t.Fatalf("%d %+v", rec.Code, body)
	}
	if !strings.Contains(logs.String(), `"check":"database"`) || !strings.Contains(logs.String(), "connection refused") {
		t.Errorf("the failed check was not logged:\n%s", logs)
	}
}

func TestAnUnknownPathIsANotFoundProblem(t *testing.T) {
	r, _ := router(t)
	for _, path := range []string{"/api/v1/no-such-thing", "/elsewhere", "/"} {
		rec := testsupport.Serve(t, r, get(t, path))
		if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"code":"not_found"`) {
			t.Fatalf("%s: %d %s", path, rec.Code, rec.Body.String())
		}
		if rec.Header().Get("Content-Type") != "application/problem+json" {
			t.Fatalf("%s: Content-Type %q", path, rec.Header().Get("Content-Type"))
		}
	}
}

func TestAnUnservedMethodIs405WithAllow(t *testing.T) {
	r, _ := router(t)
	rec := testsupport.Serve(t, r, httptest.NewRequestWithContext(t.Context(), http.MethodDelete, "/api/v1/healthz", nil))
	if rec.Code != http.StatusMethodNotAllowed || !strings.Contains(rec.Body.String(), `"code":"method_not_allowed"`) {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	if allow := rec.Header().Get("Allow"); allow != "GET" {
		t.Fatalf("Allow %q, want GET", allow)
	}
}

func TestEveryResponseCarriesItsRequestID(t *testing.T) {
	r, logs := router(t)
	rec := testsupport.Serve(t, r, get(t, "/api/v1/nowhere"))
	id := rec.Header().Get("X-Request-Id")
	if len(id) != 36 {
		t.Fatalf("X-Request-Id %q", id)
	}
	if !strings.Contains(rec.Body.String(), `"request_id":"`+id+`"`) {
		t.Errorf("the problem does not carry %s: %s", id, rec.Body.String())
	}
	if !strings.Contains(logs.String(), `"request_id":"`+id+`"`) {
		t.Errorf("the access log does not carry %s:\n%s", id, logs)
	}

	req := get(t, "/api/v1/healthz")
	req.Header.Set("X-Request-Id", "chosen-by-the-client")
	if got := testsupport.Serve(t, r, req).Header().Get("X-Request-Id"); got == "chosen-by-the-client" {
		t.Error("the server took the client's request id")
	}
}

// The access log names the route pattern, never the path: a path carries ids, and a query
// carries search terms.
func TestTheAccessLogNamesTheRouteNotThePath(t *testing.T) {
	r, logs := router(t)
	testsupport.Serve(t, r, get(t, "/api/v1/healthz?q=the+secret+recipe"))
	var line map[string]any
	for l := range strings.SplitSeq(strings.TrimSpace(logs.String()), "\n") {
		if err := json.Unmarshal([]byte(l), &line); err != nil {
			t.Fatal(err)
		}
	}
	if line["msg"] != "request" || line["route"] != "/api/v1/healthz" || line["method"] != "GET" || line["status"] != float64(200) {
		t.Fatalf("access log line %v", line)
	}
	if strings.Contains(logs.String(), "secret") {
		t.Fatalf("the log carries the query:\n%s", logs)
	}
}

// A request the edge refuses is never routed, and is logged under the route it was refused
// for all the same, not under the mount point.
func TestTheAccessLogNamesTheRouteOfARefusedRequest(t *testing.T) {
	r, logs := router(t)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/healthz", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	if rec := testsupport.Serve(t, r, req); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("a body on getHealthz: %d %s", rec.Code, rec.Body.String())
	}
	var line map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(logs.String())), &line); err != nil {
		t.Fatal(err)
	}
	if line["route"] != "/api/v1/healthz" || line["status"] != float64(422) {
		t.Fatalf("access log line %v", line)
	}
}

// A panic becomes a 500 problem, logged by its type and stack and never its value, and
// without the headers the handler set for the response it meant to send.
func TestAPanicIsA500Problem(t *testing.T) {
	r, logs := router(t)
	r.Get("/panics", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("ETag", `"7"`)
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Cache-Control", "max-age=3600")
		http.SetCookie(w, &http.Cookie{
			Name: "__Host-hh_session", Value: "minted", Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode,
		})
		panic("the member's diary says: meet at noon")
	})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, get(t, "/panics"))
	if rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), `"code":"internal"`) {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "diary") || strings.Contains(logs.String(), "diary") {
		t.Fatalf("the panic value escaped:\nresponse %s\nlog %s", rec.Body.String(), logs)
	}
	if !strings.Contains(logs.String(), `"panic":"string"`) || !strings.Contains(logs.String(), `"stack":"goroutine`) {
		t.Fatalf("the panic was not logged:\n%s", logs)
	}
	if !strings.Contains(logs.String(), `"status":500`) {
		t.Fatalf("the access log missed the 500:\n%s", logs)
	}
	for _, key := range []string{"ETag", "Content-Encoding", "Cache-Control", "Set-Cookie"} {
		if v := rec.Header().Get(key); v != "" {
			t.Errorf("the problem carries the handler's %s: %q", key, v)
		}
	}
}

// A stream that panics halfway cannot become a problem, and must not end as if it were
// complete: the client sees the transfer fail, and the access log records an error with the
// status that went out. A Flush sends the status line as surely as a write does, so a
// stream that has only flushed its headers is past saving too.
func TestAPanicAfterTheResponseStartedAbortsIt(t *testing.T) {
	for name, start := range map[string]func(http.ResponseWriter){
		"written": func(w http.ResponseWriter) {
			_, _ = io.WriteString(w, "{\"line\":1}\n")
			_ = http.NewResponseController(w).Flush()
		},
		"flushed": func(w http.ResponseWriter) { _ = http.NewResponseController(w).Flush() },
		"flushed directly": func(w http.ResponseWriter) {
			f, ok := w.(http.Flusher)
			if !ok {
				panic("the writer cannot flush")
			}
			f.Flush()
		},
	} {
		t.Run(name, func(t *testing.T) {
			r, logs := router(t)
			r.Get("/half", func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/x-ndjson")
				start(w)
				panic("late")
			})
			srv := httptest.NewServer(r)
			defer srv.Close()
			req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/half", nil)
			if err != nil {
				t.Fatal(err)
			}
			resp, err := srv.Client().Do(req)
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if err == nil {
				t.Fatalf("a truncated stream read as complete: %d %q", resp.StatusCode, body)
			}
			if !strings.Contains(logs.String(), `"level":"ERROR","msg":"request","method":"GET","status":200`) {
				t.Fatalf("the access log did not record the aborted request as an error:\n%s", logs)
			}
		})
	}
}

// A request cut off before anything was written, as the edge cuts off a body that arrives
// too slowly, went out with no status, and is not logged as a 200.
func TestARequestAbortedBeforeAnswerIsLoggedWithoutAStatus(t *testing.T) {
	r, logs := router(t)
	r.Get("/cut", func(http.ResponseWriter, *http.Request) { panic(http.ErrAbortHandler) })
	func() {
		defer func() {
			if err, ok := recover().(error); !ok || !errors.Is(err, http.ErrAbortHandler) {
				t.Fatalf("recovered %v, want http.ErrAbortHandler", err)
			}
		}()
		r.ServeHTTP(httptest.NewRecorder(), get(t, "/cut"))
	}()
	if !strings.Contains(logs.String(), `"level":"ERROR","msg":"request","method":"GET","status":0`) {
		t.Fatalf("access log:\n%s", logs)
	}
}

func TestServeFinishesRequestsInFlightThenStops(t *testing.T) {
	log := logging.New(io.Discard, slog.LevelInfo)
	started, release := make(chan struct{}), make(chan struct{})
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
		_, _ = io.WriteString(w, "finished")
	})
	ln, err := (&net.ListenConfig{}).Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	served := make(chan error, 1)
	go func() { served <- app.Serve(ctx, log, app.NewServer(handler, log), ln, 5*time.Second) }()

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "http://"+ln.Addr().String()+"/", nil)
	if err != nil {
		t.Fatal(err)
	}
	answered := make(chan string, 1)
	go func() {
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			answered <- "error: " + err.Error()
			return
		}
		defer func() { _ = resp.Body.Close() }()
		body, _ := io.ReadAll(resp.Body)
		answered <- string(body)
	}()
	<-started
	cancel()
	// Shutdown has begun: the listener closes while the request is still running.
	time.Sleep(100 * time.Millisecond)
	close(release)

	if got := <-answered; got != "finished" {
		t.Fatalf("the request in flight got %q", got)
	}
	if err := <-served; err != nil {
		t.Fatalf("Serve: %v", err)
	}
	if _, err := (&net.Dialer{Timeout: time.Second}).DialContext(t.Context(), "tcp", ln.Addr().String()); err == nil {
		t.Fatal("the server still accepts connections")
	}
}
