// Package logging is the server's only logger: structured JSON through log/slog, with a
// field allowlist (FR-NF5, PRD 07 §4). The tenant is an identifier and the content is not,
// and a field whose key is not on the list is dropped before it is written, so a content
// value, a token or a password cannot reach the log by being passed to it.
//
// Three things the allowlist cannot see, and how each is closed:
//   - The message. golangci-lint's sloglint requires it to be a constant (static-msg).
//   - An allowlisted key given content as its value. Keys are chosen for values that are
//     identifiers or measurements, and a key is added to the list in review, not in passing.
//   - Error text, which can quote the input that caused it. A PostgreSQL error is reduced to
//     its SQLSTATE and the names of the objects involved (see errorText), and Stack drops the
//     argument words a goroutine dump prints.
//
// Groups are flattened: the allowlist names top-level keys, so WithGroup is a no-op and an
// attribute inside a slog.Group is dropped.
package logging

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"regexp"
	"runtime/debug"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kareltilcer/household/server/internal/platform/reqctx"
)

// The keys that may be logged, besides slog's own time, level and msg. Each value is an
// identifier or a measurement. Adding a key is a review decision: name what it holds.
var allowed = map[string]bool{
	// Correlation, on every line a request logs (FR-NF5).
	KeyRequestID:   true,
	KeyHouseholdID: true,
	"user_id":      true,

	// A request, by its route pattern. Never the path or the query: a path carries ids
	// the pattern does not need, and a query carries search terms.
	"method":      true,
	"route":       true,
	"status":      true,
	"duration_ms": true,
	"bytes":       true,

	// Failures. An error's text is reduced by errorText; a panic is logged by its type,
	// never its value.
	"error": true,
	"panic": true,
	"stack": true,

	// The process: its environment, listen address, lifecycle and dependencies.
	"env":       true,
	"addr":      true,
	"signal":    true,
	"check":     true,
	"migration": true,
	"role":      true,
}

// The correlation keys the logger adds from the request's scope.
const (
	KeyRequestID   = "request_id"
	KeyHouseholdID = "household_id"
)

// Allowed reports whether key may be logged.
func Allowed(key string) bool { return allowed[key] }

// New returns a JSON logger writing to w at level, which drops every attribute whose key
// is not allowlisted and adds the request id and household id from the context of each
// *Context call.
func New(w io.Writer, level slog.Leveler) *slog.Logger {
	json := slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level, ReplaceAttr: filter})
	return slog.New(handler{json})
}

// filter is the allowlist, applied by slog to every attribute before it is written: those
// of the record, those added with With, and slog's own.
func filter(groups []string, a slog.Attr) slog.Attr {
	if len(groups) > 0 {
		return slog.Attr{}
	}
	switch a.Key {
	case slog.TimeKey, slog.LevelKey, slog.MessageKey:
		return a
	}
	if !allowed[a.Key] {
		return slog.Attr{}
	}
	if err, ok := a.Value.Any().(error); ok && a.Value.Kind() == slog.KindAny {
		return slog.String(a.Key, errorText(err))
	}
	return a
}

// handler adds the request's correlation ids to each record.
type handler struct{ slog.Handler }

func (h handler) Handle(ctx context.Context, r slog.Record) error {
	if s := reqctx.From(ctx); s != nil {
		r.AddAttrs(slog.String(KeyRequestID, s.RequestID()))
		if id := s.HouseholdID(); id != "" {
			r.AddAttrs(slog.String(KeyHouseholdID, id))
		}
	}
	return h.Handler.Handle(ctx, r)
}

func (h handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return handler{h.Handler.WithAttrs(attrs)}
}

// WithGroup is a no-op: the allowlist is flat, so a grouped key would never be written.
func (h handler) WithGroup(string) slog.Handler { return h }

// errorText is err's message with any PostgreSQL error in it reduced to its SQLSTATE and
// the objects it names. PostgreSQL quotes the offending input in some messages (`invalid
// input syntax for type uuid: "…"`), and that input is a member's content.
func errorText(err error) string {
	text := err.Error()
	var pg *pgconn.PgError
	if !errors.As(err, &pg) {
		return text
	}
	safe := "SQLSTATE " + pg.Code
	for _, part := range []struct{ name, value string }{
		{"table", pg.TableName},
		{"column", pg.ColumnName},
		{"constraint", pg.ConstraintName},
	} {
		if part.value != "" {
			safe += " " + part.name + " " + part.value
		}
	}
	if raw := pg.Error(); strings.Contains(text, raw) {
		return strings.ReplaceAll(text, raw, safe)
	}
	// A wrapper that did not quote the PostgreSQL error verbatim may have paraphrased it.
	return safe
}

// frameArgs matches the argument list a goroutine dump prints at the end of each function
// line: hex words, `?` after an inexact one, `...` where it stopped, braces around a
// struct's words. A receiver such as `(*Server)` holds letters and `*`, so it never matches.
var frameArgs = regexp.MustCompile(`(?m)\([0-9a-fx?.,{} ]*\)$`)

// Stack returns the calling goroutine's stack with each frame's argument words elided.
// Those words are raw register and stack values, and one of them can be an amount or the
// bytes of a string.
func Stack() string {
	return frameArgs.ReplaceAllString(string(debug.Stack()), "(...)")
}
