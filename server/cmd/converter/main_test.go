package main

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// The tests run the converter with this test binary standing in for LibreOffice and pdftoppm: run
// with CONVERTER_FAKE set, it does what the command it stands for would, as CONVERTER_FAKE says.
func TestMain(m *testing.M) {
	if mode := os.Getenv("CONVERTER_FAKE"); mode != "" {
		os.Exit(fake(mode, os.Args[1:]))
	}
	os.Exit(m.Run())
}

// fake stands in for soffice or pdftoppm with args: "ok" writes what the command writes, "slow" does
// so after half a second, "nothing" writes nothing and fails, "quoting" fails as nothing does,
// printing what it read of the document as poppler's diagnostics do, "hang" never ends, and "killed"
// is killed, as the kernel kills a command for the memory it took: by SIGKILL where there are signals.
func fake(mode string, args []string) int {
	switch mode {
	case "hang":
		time.Sleep(time.Minute)
		return 0
	case "killed":
		if self, err := os.FindProcess(os.Getpid()); err == nil {
			_ = self.Kill()
		}
		time.Sleep(time.Minute)
		return 1
	case "slow":
		time.Sleep(500 * time.Millisecond)
	case "nothing":
		return 1
	case "quoting":
		_, _ = fmt.Fprintln(os.Stdout, "convert "+args[len(args)-1])
		_, _ = fmt.Fprintln(os.Stderr, "Syntax Error (412): Unknown operator 'Smlouva'")
		return 1
	}
	if i := slices.Index(args, "--outdir"); i >= 0 {
		in := args[len(args)-1]
		out := filepath.Join(args[i+1], strings.TrimSuffix(filepath.Base(in), filepath.Ext(in))+".pdf")
		if err := os.MkdirAll(args[i+1], 0o700); err != nil { //nolint:gosec // G703: the converter's own arguments, in a test.
			return 1
		}
		if err := os.WriteFile(out, []byte("%PDF-1.4 converted\n"), 0o600); err != nil { //nolint:gosec // G703: as above.
			return 1
		}
		return 0
	}
	f, err := os.Create(args[len(args)-1] + ".png") //nolint:gosec // G703: the converter's own arguments, in a test.
	if err != nil {
		return 1
	}
	defer func() { _ = f.Close() }()
	if err := png.Encode(f, image.NewGray(image.Rect(0, 0, 3, 4))); err != nil {
		return 1
	}
	return 0
}

// newConverter is a converter whose commands are this test binary, faking as mode, with a
// conversion's timeout of timeout.
func newConverter(t *testing.T, mode string, timeout time.Duration) *converter {
	t.Helper()
	t.Setenv("CONVERTER_FAKE", mode)
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return &converter{
		soffice: []string{self}, pdftoppm: []string{self}, office: timeout, page: timeout,
		slots: make(chan struct{}, 1), dir: t.TempDir(), log: slog.New(slog.DiscardHandler),
	}
}

func post(t *testing.T, c *converter, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, bytes.NewReader(body))
	rec := httptest.NewRecorder()
	c.routes().ServeHTTP(rec, req)
	return rec
}

func TestAnOfficeDocumentBecomesAPDF(t *testing.T) {
	c := newConverter(t, "ok", 10*time.Second)
	rec := post(t, c, "/pdf?ext=docx", []byte("PK\x03\x04 a document"))
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/pdf" ||
		!strings.HasPrefix(rec.Body.String(), "%PDF-") {
		t.Fatalf("%d %s %q", rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
	}
	// Each conversion's directory goes with it.
	if entries, _ := os.ReadDir(c.dir); len(entries) != 0 {
		t.Fatalf("left %v", entries)
	}
}

func TestAPDFsFirstPageIsDrawn(t *testing.T) {
	c := newConverter(t, "ok", 10*time.Second)
	rec := post(t, c, "/page?side=1600", []byte("%PDF-1.4 a document"))
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("%d %s", rec.Code, rec.Header().Get("Content-Type"))
	}
	if _, err := png.Decode(rec.Body); err != nil {
		t.Fatal(err)
	}
}

// What the converter cannot convert is 422, which the pipeline takes for good; what it may not be
// asked is 422 or 413 before any command runs; and a conversion that runs out of time is 504.
func TestTheConvertersRefusals(t *testing.T) {
	for name, tc := range map[string]struct {
		mode, path string
		body       []byte
		status     int
	}{
		"a document no command converts": {"nothing", "/pdf?ext=docx", []byte("junk"), http.StatusUnprocessableEntity},
		"a page no command draws":        {"nothing", "/page?side=800", []byte("junk"), http.StatusUnprocessableEntity},
		"a type it does not read":        {"ok", "/pdf?ext=exe", []byte("MZ"), http.StatusUnprocessableEntity},
		"no type":                        {"ok", "/pdf", []byte("PK"), http.StatusUnprocessableEntity},
		"a path in place of a type":      {"ok", "/pdf?ext=..%2F..%2Fetc%2Fdocx", []byte("PK"), http.StatusUnprocessableEntity},
		"a type and a path":              {"ok", "/pdf?ext=docx%2F..%2F..%2Fx", []byte("PK"), http.StatusUnprocessableEntity},
		"a side too large":               {"ok", "/page?side=100000", []byte("%PDF"), http.StatusUnprocessableEntity},
		"an empty document":              {"ok", "/pdf?ext=docx", nil, http.StatusUnprocessableEntity},
		"a conversion out of time":       {"hang", "/pdf?ext=docx", []byte("PK"), http.StatusGatewayTimeout},
	} {
		t.Run(name, func(t *testing.T) {
			c := newConverter(t, tc.mode, 300*time.Millisecond)
			if rec := post(t, c, tc.path, tc.body); rec.Code != tc.status {
				t.Fatalf("%d %s, want %d", rec.Code, rec.Body.String(), tc.status)
			}
		})
	}
}

// A command the converter cannot start, not where its configuration says or refused a process by the
// system, is the converter's failure and not the document's: 500, which the pipeline tries again
// later, never the 422 it takes for a document that cannot be converted and leaves download-only for
// good. It is logged, and the document's directory goes with it all the same.
func TestACommandThatCannotStartIsNoDocumentsFault(t *testing.T) {
	c := newConverter(t, "ok", 10*time.Second)
	missing := filepath.Join(t.TempDir(), "no-such-command")
	c.soffice, c.pdftoppm = []string{missing}, []string{missing}
	var log bytes.Buffer
	c.log = slog.New(slog.NewJSONHandler(&log, nil))
	for _, path := range []string{"/pdf?ext=docx", "/page?side=800"} {
		if rec := post(t, c, path, []byte("PK\x03\x04 a document")); rec.Code != http.StatusInternalServerError {
			t.Fatalf("%s with a command that cannot start: %d %s, want 500", path, rec.Code, rec.Body.String())
		}
	}
	if !strings.Contains(log.String(), "conversion failed") {
		t.Fatalf("logged %s", log.String())
	}
	if entries, _ := os.ReadDir(c.dir); len(entries) != 0 {
		t.Fatalf("left %v", entries)
	}
}

// A conversion's time is its own, counted once it has a slot: a document that waited its turn behind
// another is given the whole of its timeout, not what the wait left of it, and one that waits longer
// than a conversion may take finds the converter busy, 503, which the pipeline tries again later.
func TestAConversionsTimeStartsWithItsSlot(t *testing.T) {
	c := newConverter(t, "slow", 1500*time.Millisecond)
	c.slots <- struct{}{}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- post(t, c, "/pdf?ext=docx", []byte("PK\x03\x04 a document")) }()
	time.Sleep(1200 * time.Millisecond)
	<-c.slots
	if rec := <-done; rec.Code != http.StatusOK {
		t.Fatalf("a document that waited for its slot: %d %s", rec.Code, rec.Body.String())
	}

	c.slots <- struct{}{}
	defer func() { <-c.slots }()
	if rec := post(t, c, "/pdf?ext=docx", []byte("PK\x03\x04 a document")); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("a document that waited longer than a conversion may take: %d %s", rec.Code, rec.Body.String())
	}
}

// A conversion that fails is logged by its command and how it ended, never by what the command
// printed, which quotes the document (FR-NF5).
func TestAFailedConversionLogsNoContent(t *testing.T) {
	c := newConverter(t, "quoting", 10*time.Second)
	var log bytes.Buffer
	c.log = slog.New(slog.NewJSONHandler(&log, nil))
	if rec := post(t, c, "/page?side=800", []byte("%PDF-1.4 Smlouva")); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(log.String(), "a conversion failed") || strings.Contains(log.String(), "Smlouva") {
		t.Fatalf("logged %s", log.String())
	}
}

// A conversion its client stops waiting for, the pipeline's job past its lease or its process ending,
// is killed with the request, and is logged as abandoned: it did not run out of time, which the log
// would otherwise send an operator to look into.
func TestAConversionItsClientAbandonsIsNoTimeout(t *testing.T) {
	c := newConverter(t, "hang", 10*time.Second)
	var log bytes.Buffer
	c.log = slog.New(slog.NewJSONHandler(&log, nil))
	ctx, cancel := context.WithTimeout(t.Context(), 300*time.Millisecond)
	defer cancel()
	req := httptest.NewRequestWithContext(ctx, http.MethodPost, "/pdf?ext=docx", bytes.NewReader([]byte("PK\x03\x04 a document")))
	start := time.Now()
	c.routes().ServeHTTP(httptest.NewRecorder(), req)
	if took := time.Since(start); took > 8*time.Second {
		t.Fatalf("the conversion ran on for %s after its client left", took)
	}
	if !strings.Contains(log.String(), "a conversion was abandoned by its client") || strings.Contains(log.String(), "ran out of time") {
		t.Fatalf("logged %s", log.String())
	}
}

func TestADocumentTooLargeIsRefused(t *testing.T) {
	c := newConverter(t, "ok", 10*time.Second)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/pdf?ext=docx", io.LimitReader(zeros{}, maxBytes+1))
	rec := httptest.NewRecorder()
	c.routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("%d", rec.Code)
	}
}

type zeros struct{}

func (zeros) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}
