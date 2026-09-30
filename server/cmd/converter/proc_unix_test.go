//go:build unix

package main

import (
	"bytes"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"
)

// A command the system kills, as the kernel kills one for the memory it took, has not failed on the
// document: 503, which the pipeline tries again once the conversions beside it are done, never the
// 422 it takes for good. A kill of the converter's own, its timeout's, is still 504
// (TestTheConvertersRefusals).
func TestAConversionTheSystemKillsIsTriedAgain(t *testing.T) {
	c := newConverter(t, "killed", 10*time.Second)
	var log bytes.Buffer
	c.log = slog.New(slog.NewJSONHandler(&log, nil))
	for _, path := range []string{"/pdf?ext=docx", "/page?side=800"} {
		if rec := post(t, c, path, []byte("PK\x03\x04 a document")); rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s killed by the system: %d %s, want 503", path, rec.Code, rec.Body.String())
		}
	}
	if !strings.Contains(log.String(), "a conversion was killed") || strings.Contains(log.String(), "ran out of time") {
		t.Fatalf("logged %s", log.String())
	}
}
