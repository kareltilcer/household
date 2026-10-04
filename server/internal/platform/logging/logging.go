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
//     its SQLSTATE and the names of the objects involved, and pgx's own errors for a value it
//     could not encode or scan to the type or column (see errorText); Stack drops the
//     argument words a goroutine dump prints.
//
// Groups are flattened: the allowlist names top-level keys, so WithGroup is a no-op and an
// attribute inside a slog.Group is dropped.
package logging

import (
	"context"
	"io"
	"log/slog"
	"regexp"
	"runtime/debug"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
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

	// A reference-data load (internal/platform/reference): the dataset's name, its version, and
	// how many of its records the load inserted, updated, and kept that the files no longer hold;
	// and how many an administrator edited that it held to their edit, or released to the files.
	"dataset":  true,
	"version":  true,
	"inserted": true,
	"updated":  true,
	"kept":     true,
	"held":     true,
	"released": true,

	// An email that was not sent (internal/platform/identity), or a notification that failed
	// (internal/platform/notify): the catalog key of its template, never the address or anything
	// rendered into it.
	"template": true,

	// A notification's transport (internal/platform/notify): web_push, expo or email; and how many
	// of Expo's receipts said a device's token was gone, or a push failed on it.
	"transport": true,
	"gone":      true,
	"failed":    true,

	// A scheduled job (internal/platform/scheduler): its registered name, and the instance leading,
	// a UUID the process drew when it started.
	"job":      true,
	"instance": true,

	// A retention of the expiry sweep (internal/platform/expiry): its name in the sweep's table, and
	// how many rows it deleted.
	"retention": true,
	"rows":      true,

	// A mutation the push could not answer (internal/platform/push): the UUID its device drew for
	// it, which names it in the device's queue and carries none of its fields.
	"mutation_id": true,

	// A file job (internal/platform/files): its kind, variants or purge, the module id whose
	// objects it derives or purges, and how many times it was tried; and how many objects a sweep
	// removed. Never a file's name, its type or its key.
	"kind":     true,
	"module":   true,
	"attempts": true,
	"objects":  true,

	// Sync's metrics (internal/platform/sync, LogMetrics): an entity's registered type, a mutation's
	// outcome and its problem code, how many mutations a batch carried and a replica holds queued, and
	// a replication slot of PowerSync's by its name, whether it is connected, and its lag in bytes. A
	// divergence names its kind and its entity, never a row.
	"entity":    true,
	"outcome":   true,
	"code":      true,
	"mutations": true,
	"pending":   true,
	"slot":      true,
	"active":    true,
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

// errorText is err's message with each part that can quote a member's content reduced to
// where the failure happened:
//   - a PostgreSQL error, which quotes the offending input in some messages (`invalid input
//     syntax for type uuid: "…"`), to its SQLSTATE and the objects it names;
//   - a value pgx could not scan, whose cause quotes the column's content (`strconv.ParseInt:
//     parsing "…"`), to the column;
//   - a value pgx could not encode, which it prints whole and its cause quotes again
//     (`unable to encode 5000000000 into binary format for int4 (OID 23): 5000000000 is
//     greater than maximum value for int4`), to the type it was meant for.
//
// Every such error in the chain is reduced, those joined beside another (errors.Join)
// included. A wrapper that did not quote one verbatim may have paraphrased it, so the
// message is then dropped, and only the reduced forms are kept.
func errorText(err error) string {
	text := err.Error()
	var reduced []string
	verbatim := true
	for _, q := range quoting(err) {
		reduced = append(reduced, q.safe)
		if strings.Contains(text, q.raw) {
			text = strings.ReplaceAll(text, q.raw, q.safe)
		} else {
			verbatim = false
		}
	}
	if !verbatim {
		return strings.Join(reduced, "; ")
	}
	if i := strings.Index(text, encodePrefix); i >= 0 {
		safe := encodePrefix + "a value"
		if m := encodeFailure.FindStringSubmatch(text[i:]); m != nil {
			safe += " into " + m[1] + " format for " + m[2] + " (OID " + m[3] + ")"
		}
		// Everything after is the value's causes, which quote it again.
		return text[:i] + safe
	}
	return text
}

// quote is an error whose message can quote a member's content, and what is logged in its
// place.
type quote struct{ raw, safe string }

// quoting returns every PostgreSQL error and failed pgx scan in err's tree. errors.As would
// stop at the first.
func quoting(err error) []quote {
	var out []quote
	//nolint:errorlint // A type switch on purpose: each layer is unwrapped here, one at a time.
	switch e := err.(type) {
	case nil:
	case *pgconn.PgError:
		safe := "SQLSTATE " + e.Code
		for _, part := range []struct{ name, value string }{
			{"table", e.TableName},
			{"column", e.ColumnName},
			{"constraint", e.ConstraintName},
		} {
			if part.value != "" {
				safe += " " + part.name + " " + part.value
			}
		}
		out = append(out, quote{raw: e.Error(), safe: safe})
	case pgx.ScanArgError:
		// Its cause, which quotes the column's content, is part of its message.
		safe := "can't scan into dest[" + strconv.Itoa(e.ColumnIndex) + "]"
		if e.FieldName != "" && e.FieldName != "?column?" {
			safe += " (col: " + e.FieldName + ")"
		}
		out = append(out, quote{raw: e.Error(), safe: safe})
	case interface{ Unwrap() []error }:
		for _, inner := range e.Unwrap() {
			out = append(out, quoting(inner)...)
		}
	case interface{ Unwrap() error }:
		out = append(out, quoting(e.Unwrap())...)
	}
	return out
}

// encodePrefix starts pgx's message for an argument it could not encode, which then prints
// the argument with %#v; encodeFailure reads the target type from what follows it.
const encodePrefix = "unable to encode "

var encodeFailure = regexp.MustCompile(`(?s)^unable to encode .*? into (.+?) format for (.+?) \(OID (\d+)\)`)

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
