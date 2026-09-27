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
// aborted request is logged as an error, whatever status went out before it was cut off.
func AccessLog(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			returned := false
			defer func() {
				status := ww.Status()
				if status == 0 {
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

// Recover answers a handler's panic with a 500 problem, and logs it by the panic value's
// type and the stack: the value itself can hold anything, content included.
// http.ErrAbortHandler, the deliberate abort, is left to net/http.
//
// A panic after the status line was written can no longer become a problem, and finishing
// the response would pass a truncated body off as complete: net/http would end a chunked
// stream cleanly. Recover aborts it instead, with http.ErrAbortHandler, so the client sees
// the transfer fail.
func Recover(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ww, ok := w.(middleware.WrapResponseWriter)
			if !ok {
				ww = middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			}
			defer func() {
				v := recover()
				if v == nil {
					return
				}
				if err, ok := v.(error); ok && errors.Is(err, http.ErrAbortHandler) {
					panic(v)
				}
				log.LogAttrs(r.Context(), slog.LevelError, "panic",
					slog.String("panic", typeName(v)),
					slog.String("stack", logging.Stack()),
				)
				if ww.Status() != 0 {
					panic(http.ErrAbortHandler)
				}
				// Headers the handler set for the response it meant to send do not describe
				// the problem that replaces it.
				for _, key := range representationHeaders {
					ww.Header().Del(key)
				}
				problem.Write(ww, reqctx.RequestID(r.Context()), problem.Internal())
			}()
			next.ServeHTTP(ww, r)
		})
	}
}

// representationHeaders describe a response body and how to cache or find it, and are
// dropped when a panic replaces that response with a problem.
var representationHeaders = []string{
	"Cache-Control", "Content-Disposition", "Content-Encoding", "Content-Language",
	"Content-Location", "Content-Range", "ETag", "Expires", "Last-Modified", "Location",
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
func MethodNotAllowed(router chi.Routes) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := RoutePath(r)
		var allowed []string
		for _, method := range methods {
			if router.Match(chi.NewRouteContext(), method, path) {
				allowed = append(allowed, method)
			}
		}
		if len(allowed) > 0 {
			w.Header().Set("Allow", strings.Join(allowed, ", "))
		}
		problem.Write(w, reqctx.RequestID(r.Context()), problem.New(http.StatusMethodNotAllowed, problem.CodeMethodNotAllowed))
	}
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

// WriteJSON writes v as a JSON response with status.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		problem.Write(w, "", problem.Internal())
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/json")
	h.Set("Content-Length", strconv.Itoa(len(body)))
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}
