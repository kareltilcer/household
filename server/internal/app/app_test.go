package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/health"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// TestMain gives the package's database the probe module's table, which tenancy_test.go's
// tests serve.
func TestMain(m *testing.M) { testsupport.Main(m, probeBlocks()...) }

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
	pool := testsupport.Open(t).Pool(t, db.RoleApp)
	accounts, outbox := apptest.Accounts(t, pool, log, apptest.Options{})
	r, err := app.NewRouter(app.Deps{
		Logger: log, Contract: c, Health: health.New(log, time.Second, checks...),
		Pool: pool, MaxBodyBytes: 1 << 10, Accounts: accounts,
		Households: apptest.Households(t, pool, log, accounts, outbox, apptest.Options{}),
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

// The API's own mount point is no route either, although chi's lookup reports it as one:
// testsupport.Serve, which finds the route as the edge does, would otherwise hold its 404
// against an operation GET /api/v1 that the contract does not have.
func TestAnUnknownPathIsANotFoundProblem(t *testing.T) {
	r, _ := router(t)
	for _, path := range []string{"/api/v1/no-such-thing", "/elsewhere", "/", "/api/v1", "/api/v1/"} {
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

	// chi hands a method it does not know to the 405 handler before routing: on a path that
	// is served it is a 405 like any other, and on one that is not, the 404 a GET would get.
	// The mount point is one of those, although chi reports every method as serving it.
	rec = testsupport.Serve(t, r, httptest.NewRequestWithContext(t.Context(), "PROPFIND", "/api/v1/healthz", nil))
	if rec.Code != http.StatusMethodNotAllowed || rec.Header().Get("Allow") != "GET" {
		t.Fatalf("PROPFIND on a served path: %d, Allow %q", rec.Code, rec.Header().Get("Allow"))
	}
	for _, path := range []string{"/api/v1/nowhere", "/elsewhere", "/api/v1", "/api/v1/"} {
		rec = testsupport.Serve(t, r, httptest.NewRequestWithContext(t.Context(), "PROPFIND", path, nil))
		if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"code":"not_found"`) || rec.Header().Get("Allow") != "" {
			t.Fatalf("PROPFIND %s: %d, Allow %q, %s", path, rec.Code, rec.Header().Get("Allow"), rec.Body.String())
		}
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

// A response that cannot be encoded is a bug: it becomes the 500 problem, carrying the
// request's id, and the failure is logged by its type, as a panic is.
func TestAResponseThatCannotBeEncodedIsA500Problem(t *testing.T) {
	r, logs := router(t)
	r.Get("/unencodable", func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]float64{"ratio": math.Inf(1)})
	})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, get(t, "/unencodable"))
	id := rec.Header().Get("X-Request-Id")
	if rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), `"request_id":"`+id+`"`) {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(logs.String(), `"panic":"*json.UnsupportedValueError"`) {
		t.Fatalf("the failure was not logged:\n%s", logs)
	}
}

// A request that declares a body and never sends it is disconnected once the body is
// overdue, whatever it asked for. net/http reads a body nobody read before it answers, so a
// refusal, a 404 or a 405 would otherwise wait on the client for as long as it likes.
func TestABodyThatNeverArrivesDoesNotHoldTheConnection(t *testing.T) {
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	const timeout = 300 * time.Millisecond
	log := logging.New(io.Discard, slog.LevelError)
	pool := testsupport.Open(t).Pool(t, db.RoleApp)
	accounts, outbox := apptest.Accounts(t, pool, log, apptest.Options{})
	r, err := app.NewRouter(app.Deps{
		Logger: log, Contract: c, Health: health.New(log, time.Second),
		Pool: pool, MaxBodyBytes: 1 << 10, BodyTimeout: timeout, Accounts: accounts,
		Households: apptest.Households(t, pool, log, accounts, outbox, apptest.Options{}),
	})
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}
	srv := httptest.NewServer(r)
	defer srv.Close()

	for name, tc := range map[string]struct{ request, status string }{
		"an operation that takes none": {"GET /api/v1/healthz", "422"},
		"no route":                     {"POST /api/v1/nowhere", "404"},
		"no such method":               {"DELETE /api/v1/healthz", "405"},
	} {
		t.Run(name, func(t *testing.T) {
			request, status := tc.request, tc.status
			conn, err := (&net.Dialer{}).DialContext(t.Context(), "tcp", srv.Listener.Addr().String())
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = conn.Close() }()
			if _, err := io.WriteString(conn, request+" HTTP/1.1\r\nHost: test\r\nContent-Length: 64\r\n\r\n"); err != nil {
				t.Fatal(err)
			}
			_ = conn.SetReadDeadline(time.Now().Add(10 * timeout))
			got, err := io.ReadAll(conn)
			if err != nil {
				t.Fatalf("the connection was held: %v", err)
			}
			if !strings.HasPrefix(string(got), "HTTP/1.1 "+status+" ") {
				t.Fatalf("answered %q, want %s", got, status)
			}
		})
	}
}

// A request cut off before anything was written, as the edge cuts off a body that arrives
// too slowly, went out with no status, and is not logged as a 200. An abort wrapped in
// another error reaches net/http as http.ErrAbortHandler itself: net/http compares the
// value, and logs any other with the client's address and an unelided stack.
func TestARequestAbortedBeforeAnswerIsLoggedWithoutAStatus(t *testing.T) {
	for name, abort := range map[string]error{
		"bare":    http.ErrAbortHandler,
		"wrapped": fmt.Errorf("stream cut: %w", http.ErrAbortHandler),
	} {
		t.Run(name, func(t *testing.T) {
			r, logs := router(t)
			r.Get("/cut", func(http.ResponseWriter, *http.Request) { panic(abort) })
			func() {
				defer func() {
					if v := recover(); v != any(http.ErrAbortHandler) {
						t.Fatalf("recovered %v, want http.ErrAbortHandler itself", v)
					}
				}()
				r.ServeHTTP(httptest.NewRecorder(), get(t, "/cut"))
			}()
			if !strings.Contains(logs.String(), `"level":"ERROR","msg":"request","method":"GET","status":0`) {
				t.Fatalf("access log:\n%s", logs)
			}
		})
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
