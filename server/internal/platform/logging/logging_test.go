package logging_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"runtime/debug"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
)

// lines decodes every JSON line written to buf.
func lines(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var out []map[string]any
	for line := range strings.SplitSeq(strings.TrimSpace(buf.String()), "\n") {
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("line %q is not JSON: %v", line, err)
		}
		out = append(out, m)
	}
	return out
}

// The item's Done-when: a field not on the allowlist is dropped from the logs.
func TestAFieldNotOnTheAllowlistIsDropped(t *testing.T) {
	var buf bytes.Buffer
	log := logging.New(&buf, slog.LevelDebug)

	log.Info("request handled",
		slog.String("route", "/households/{household_id}/notes"),
		slog.String("email", "jana@example.com"),
		slog.String("note_body", "the safe code is 4711"),
		slog.Group("http", slog.String("route", "/grouped")),
	)
	log.With(slog.String("password", "hunter2"), slog.Int("status", 200)).Info("with attrs")
	log.WithGroup("request").Info("grouped logger", slog.String("token", "eyJhbGciOi"), slog.Int("bytes", 12))

	out := buf.String()
	for _, secret := range []string{"jana@example.com", "4711", "hunter2", "eyJhbGciOi", "/grouped"} {
		if strings.Contains(out, secret) {
			t.Errorf("the log contains %q:\n%s", secret, out)
		}
	}
	got := lines(t, &buf)
	if len(got) != 3 {
		t.Fatalf("%d lines, want 3:\n%s", len(got), out)
	}
	if got[0]["route"] != "/households/{household_id}/notes" || got[0]["msg"] != "request handled" {
		t.Errorf("allowlisted fields were dropped: %v", got[0])
	}
	for _, key := range []string{"email", "note_body", "http"} {
		if _, ok := got[0][key]; ok {
			t.Errorf("line 1 carries %q: %v", key, got[0])
		}
	}
	if got[1]["status"] != float64(200) {
		t.Errorf("With dropped an allowlisted field: %v", got[1])
	}
	if got[2]["bytes"] != float64(12) {
		t.Errorf("a grouped logger dropped an allowlisted field: %v", got[2])
	}
}

func TestEveryRequestLineCarriesItsIDs(t *testing.T) {
	var buf bytes.Buffer
	log := logging.New(&buf, slog.LevelInfo)

	ctx, scope := reqctx.New(context.Background(), "0190f3a2-4c1b-7c3e-9a5f-2b6d8e4f1a90")
	log.InfoContext(ctx, "before the tenant is known")
	scope.SetHouseholdID("0190f3a2-4c1b-7c3e-9a5f-000000000001")
	log.InfoContext(ctx, "after")
	log.InfoContext(context.Background(), "outside a request")

	got := lines(t, &buf)
	if got[0]["request_id"] != "0190f3a2-4c1b-7c3e-9a5f-2b6d8e4f1a90" {
		t.Errorf("line 1: %v", got[0])
	}
	if _, ok := got[0]["household_id"]; ok {
		t.Errorf("line 1 has a household before one was resolved: %v", got[0])
	}
	if got[1]["household_id"] != "0190f3a2-4c1b-7c3e-9a5f-000000000001" || got[1]["request_id"] == nil {
		t.Errorf("line 2: %v", got[1])
	}
	if _, ok := got[2]["request_id"]; ok {
		t.Errorf("line 3 invented a request id: %v", got[2])
	}
}

func TestAPostgresErrorIsReducedToWhatItNames(t *testing.T) {
	pg := &pgconn.PgError{
		Severity:       "ERROR",
		Code:           "22P02",
		Message:        `invalid input syntax for type uuid: "Jana's diary"`,
		TableName:      "notes",
		ConstraintName: "",
	}
	for name, err := range map[string]error{
		"bare":        pg,
		"wrapped":     fmt.Errorf("load note: %w", pg),
		"paraphrased": &paraphrase{pg},
		// errors.As finds only the first of two joined errors; each is reduced.
		"joined second": errors.Join(&pgconn.PgError{Severity: "ERROR", Code: "23505", TableName: "notes"}, pg),
		"joined twice":  fmt.Errorf("save: %w", errors.Join(pg, errors.New("rollback: conn closed"), &paraphrase{pg})),
	} {
		t.Run(name, func(t *testing.T) {
			var buf bytes.Buffer
			logging.New(&buf, slog.LevelInfo).Error("query failed", slog.Any("error", err))
			out := buf.String()
			if strings.Contains(out, "diary") {
				t.Fatalf("the log quotes the input: %s", out)
			}
			if !strings.Contains(out, "SQLSTATE 22P02 table notes") {
				t.Fatalf("the SQLSTATE and table are gone: %s", out)
			}
		})
	}

	var buf bytes.Buffer
	logging.New(&buf, slog.LevelInfo).Error("dial failed", slog.Any("error", errors.New("connection refused")))
	if !strings.Contains(buf.String(), `"error":"connection refused"`) {
		t.Fatalf("an ordinary error lost its text: %s", buf.String())
	}
}

// pgx prints a value it could not encode, and the cause of a failed scan quotes the column's
// content. The encode error is pgx's own, built as a query would build it.
func TestAPgxValueErrorIsReducedToWhereItFailed(t *testing.T) {
	encodeErr := (&pgx.ExtendedQueryBuilder{}).Build(pgtype.NewMap(),
		&pgconn.StatementDescription{ParamOIDs: []uint32{pgtype.UUIDOID, pgtype.Int4OID}},
		[]any{"0190f3a2-4c1b-7c3e-9a5f-2b6d8e4f1a90", int64(4711000000)})
	if encodeErr == nil || !strings.Contains(encodeErr.Error(), "4711000000") {
		t.Fatalf("pgx no longer prints the value, so this test proves nothing: %v", encodeErr)
	}
	_, parseErr := strconv.ParseInt("Jana's diary", 10, 64)
	scanErr := pgx.ScanArgError{ColumnIndex: 2, FieldName: "amount_minor", Err: parseErr}

	for name, tc := range map[string]struct {
		err  error
		want string
	}{
		"encode": {fmt.Errorf("insert expense: %w", encodeErr),
			"insert expense: failed to encode args[1]: unable to encode a value into binary format for int4 (OID 23)"},
		"scan": {fmt.Errorf("load expense: %w", scanErr), "load expense: can't scan into dest[2] (col: amount_minor)"},
	} {
		t.Run(name, func(t *testing.T) {
			var buf bytes.Buffer
			logging.New(&buf, slog.LevelInfo).Error("query failed", slog.Any("error", tc.err))
			var line map[string]any
			if err := json.Unmarshal(buf.Bytes(), &line); err != nil {
				t.Fatal(err)
			}
			if line["error"] != tc.want {
				t.Fatalf("error %q, want %q", line["error"], tc.want)
			}
		})
	}
}

// paraphrase wraps a PostgreSQL error without quoting its message verbatim.
type paraphrase struct{ err *pgconn.PgError }

func (p *paraphrase) Error() string { return "query said " + p.err.Message }
func (p *paraphrase) Unwrap() error { return p.err }

// The words a dump prints are whatever the argument registers and stack slots held, which
// under the register ABI need not be the argument at all; the test looks for any word.
func TestStackElidesArgumentWords(t *testing.T) {
	raw, stack := secretFrame(0x4711)
	if !strings.Contains(raw, "secretFrame(0x") {
		t.Fatalf("the unfiltered dump shows no argument word, so this test proves nothing:\n%s", raw)
	}
	if strings.Contains(stack, "(0x") {
		t.Fatalf("the stack carries an argument word:\n%s", stack)
	}
	if !strings.Contains(stack, "logging_test.secretFrame(...)") {
		t.Fatalf("the frame itself is gone:\n%s", stack)
	}
}

//go:noinline
func secretFrame(amount int) (raw, elided string) {
	if amount < 0 {
		return "", ""
	}
	return string(debug.Stack()), logging.Stack()
}

func TestAllowed(t *testing.T) {
	for key, want := range map[string]bool{"request_id": true, "route": true, "mutation_id": true, "email": false, "path": false, "query": false} {
		if logging.Allowed(key) != want {
			t.Errorf("Allowed(%q) = %t, want %t", key, !want, want)
		}
	}
}
