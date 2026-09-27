// Package httpx is the HTTP plumbing every request passes through before any module sees
// it: the request id, the access log, panic recovery, and the problem documents for a
// path or method no route serves.
package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
)

// RequestIDHeader carries the request id back to the client, which quotes it when
// reporting a problem; problem documents carry it as request_id too.
const RequestIDHeader = "X-Request-Id"

// RequestScope mints the request's id and opens the scope the logger reads it from. The
// id is always minted here, never taken from the request: a client-chosen id is a string
// the log would carry verbatim.
func RequestScope(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := idgen.String()
		ctx, _ := reqctx.New(r.Context(), id)
		w.Header().Set(RequestIDHeader, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// AccessLog writes one line per request as it finishes: its method, the route pattern it
// matched, its status, its duration and the bytes written. Never the path or the query,
// which carry ids the pattern does not need and search terms (logging's allowlist would
// drop them anyway).
//
// The line is written on the way out whether the handler returned or was aborted with
// http.ErrAbortHandler, which Recover raises for a response it can no longer replace; an
// aborted request is logged as an error, with the status that went out before it was cut
// off, or 0 when none did.
func AccessLog(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := wrap(w, r.ProtoMajor)
			returned := false
			defer func() {
				status := ww.sent()
				if status == 0 && returned {
					// A handler that wrote nothing answered 200.
					status = http.StatusOK
				}
				attrs := []slog.Attr{
					slog.String("method", r.Method),
					slog.Int("status", status),
					slog.Int64("duration_ms", time.Since(start).Milliseconds()),
					slog.Int("bytes", ww.BytesWritten()),
				}
				if rctx := chi.RouteContext(r.Context()); rctx != nil {
					if pattern := rctx.RoutePattern(); pattern != "" {
						attrs = append(attrs, slog.String("route", pattern))
					}
				}
				level := slog.LevelInfo
				if status >= http.StatusInternalServerError || !returned {
					level = slog.LevelError
				}
				log.LogAttrs(r.Context(), level, "request", attrs...)
			}()
			next.ServeHTTP(ww, r)
			returned = true
		})
	}
}

// BodyDeadline bounds how long a request's body may take to arrive, zero for no bound: a
// client still sending when timeout passes is disconnected. The server bounds only the
// reading of headers (NewServer in internal/app says why), and net/http reads whatever body
// a handler leaves unread before it answers, so without this a request that declares a body
// and never sends it holds its connection for as long as the client likes, whatever it
// asks for: a 404, a 405, a refusal at the edge.
//
// A request without a body gets no deadline: net/http is already reading its connection to
// notice the client leaving, and a deadline reaching that read would cancel the request's
// context mid-handler when it passed. A body read to its end takes its deadline with it:
// net/http clears it as it starts that read, so a handler that runs longer keeps its
// context. A handler that streams an upload for longer than the deadline extends it through
// http.ResponseController.
func BodyDeadline(timeout time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if timeout <= 0 {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.ContentLength != 0 {
				// A writer that cannot set a deadline, a test's recorder, reads without one.
				_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(timeout))
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Recover answers a handler's panic with a 500 problem, and logs it by the panic value's
// type and the stack: the value itself can hold anything, content included.
// http.ErrAbortHandler, the deliberate abort, is left to net/http, and so is an error that
// wraps it, raised again as http.ErrAbortHandler itself: net/http lets only that value pass
// in silence, and logs any other panic with the client's address, the value and a stack
// whose argument words are not elided, as the message of a line the allowlist cannot see
// into (NewServer in internal/app sends net/http's log to the logger).
//
// A panic after the status line was written or flushed can no longer become a problem, and
// finishing the response would pass a truncated body off as complete: net/http would end a
// chunked stream cleanly. Recover aborts it instead, with http.ErrAbortHandler, so the
// client sees the transfer fail.
func Recover(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ww := wrap(w, r.ProtoMajor)
			defer func() {
				v := recover()
				if v == nil {
					return
				}
				if err, ok := v.(error); ok && errors.Is(err, http.ErrAbortHandler) {
					panic(http.ErrAbortHandler)
				}
				log.LogAttrs(r.Context(), slog.LevelError, "panic",
					slog.String("panic", typeName(v)),
					slog.String("stack", logging.Stack()),
				)
				if ww.sent() != 0 {
					panic(http.ErrAbortHandler)
				}
				// Headers the handler set for the response it meant to send do not describe
				// the problem that replaces it.
				for _, key := range handlerHeaders {
					ww.Header().Del(key)
				}
				problem.Write(ww, reqctx.RequestID(r.Context()), problem.Internal())
			}()
			next.ServeHTTP(ww, r)
		})
	}
}

// handlerHeaders describe the response a handler meant to send: its body, how to cache or
// find it, and the cookies that came with it. They are dropped when a panic replaces that
// response with a problem; a cookie for a session whose transaction the panic rolled back
// would otherwise reach the client with the 500.
var handlerHeaders = []string{
	"Cache-Control", "Content-Disposition", "Content-Encoding", "Content-Language",
	"Content-Location", "Content-Range", "ETag", "Expires", "Last-Modified", "Location",
	"Set-Cookie",
}

// responseWriter is the writer the plumbing hands on: chi's, which records the status and
// the bytes written, and a note of a Flush, which sends the status line (200, when none was
// written) as surely as WriteHeader does, but which chi's writer does not record as one.
// Handlers reach what it wraps, to hijack the connection or set a deadline, through
// http.NewResponseController.
type responseWriter struct {
	middleware.WrapResponseWriter
	flushed bool
}

// wrap returns w as a responseWriter, wrapping it unless it already is one.
func wrap(w http.ResponseWriter, protoMajor int) *responseWriter {
	if rw, ok := w.(*responseWriter); ok {
		return rw
	}
	return &responseWriter{WrapResponseWriter: middleware.NewWrapResponseWriter(w, protoMajor)}
}

// Flush sends what has been written, and the status line with it if it has not gone yet.
func (w *responseWriter) Flush() {
	w.flushed = true
	_ = http.NewResponseController(w.WrapResponseWriter).Flush()
}

// Unwrap returns chi's writer, for http.NewResponseController.
func (w *responseWriter) Unwrap() http.ResponseWriter { return w.WrapResponseWriter }

// sent returns the status that went out, or 0 while none has.
func (w *responseWriter) sent() int {
	if status := w.Status(); status != 0 {
		return status
	}
	if w.flushed {
		return http.StatusOK
	}
	return 0
}

// typeName is the panic value's type, which is safe to log where the value is not.
func typeName(v any) string { return fmt.Sprintf("%T", v) }

// NotFound answers a request no route matches with the not_found problem.
func NotFound(w http.ResponseWriter, r *http.Request) {
	problem.Write(w, reqctx.RequestID(r.Context()), problem.NotFound())
}

// MethodNotAllowed returns the handler for a path router serves but not with the request's
// method: 405 method_not_allowed, with the Allow header RFC 9110 §15.5.6 requires. chi
// passes a custom handler no list of methods, so it asks router for each.
//
// chi also sends here, before it routes at all, a request whose method it does not know
// (PROPFIND, QUERY), whatever its path. A path no method serves is answered 404 not_found,
// as a known method on it is: there is no resource there, and no Allow a 405 could carry. So
// is a mount point, which chi reports as served by every method (see MountPoint), and whose
// every known method is routed below it and answered 404.
func MethodNotAllowed(router chi.Routes) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := RoutePath(r)
		var allowed []string
		if !MountPoint(router, path) {
			for _, method := range methods {
				if router.Match(chi.NewRouteContext(), method, path) {
					allowed = append(allowed, method)
				}
			}
		}
		if len(allowed) == 0 {
			NotFound(w, r)
			return
		}
		w.Header().Set("Allow", strings.Join(allowed, ", "))
		problem.Write(w, reqctx.RequestID(r.Context()), problem.New(http.StatusMethodNotAllowed, problem.CodeMethodNotAllowed))
	}
}

// MountPoint reports whether path is where router mounts another router, the mounted
// router's own path: /api/v1 itself, say, below which the API is mounted. chi's Mount
// registers it for every method, to hand the request on to the mounted router as "/", and
// chi's Find and Match report that registration as a route of every method, CONNECT
// included. No route of this server takes CONNECT, since the contract declares no CONNECT
// operation and the router refuses to serve an undeclared one, so a path that matches
// CONNECT is a mount point and not a route.
func MountPoint(router chi.Routes, path string) bool {
	return router.Find(chi.NewRouteContext(), http.MethodConnect, path) != ""
}

// methods are the methods an Allow header can name, in the order it names them.
var methods = []string{
	http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch,
	http.MethodDelete, http.MethodOptions, http.MethodTrace, http.MethodConnect,
}

// RoutePath is the path a router routes the request by: what remains below the mount
// point when the router is mounted, the whole path otherwise.
func RoutePath(r *http.Request) string {
	if rctx := chi.RouteContext(r.Context()); rctx != nil && rctx.RoutePath != "" {
		return rctx.RoutePath
	}
	if r.URL.RawPath != "" {
		return r.URL.RawPath
	}
	return r.URL.Path
}

// WriteJSON writes v as a JSON response with status. A value that cannot be encoded, a NaN
// or a channel, is a bug and not a request error: WriteJSON panics with the encoder's error
// before anything is written, so Recover answers the 500 problem with the request's id and
// logs the failure by its type and stack, as it does any other.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	h := w.Header()
	h.Set("Content-Type", "application/json")
	h.Set("Content-Length", strconv.Itoa(len(body)))
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}
