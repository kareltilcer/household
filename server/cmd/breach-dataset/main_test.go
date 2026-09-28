package main

import (
	"bytes"
	"crypto/sha1" //nolint:gosec // G505: the corpus is keyed by SHA-1.
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/breach"
)

// sha1Hex is password's SHA-1 in upper-case hex, as the corpus spells it.
func sha1Hex(password string) string {
	sum := sha1.Sum([]byte(password)) //nolint:gosec // G401: see the import.
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

// low returns n passwords whose SHA-1 falls in the first 16 ranges, 00000 to 0000F, so that a
// download of 16 ranges holds them.
func low(n int) []string {
	var out []string
	for i := 0; len(out) < n; i++ {
		p := fmt.Sprintf("breached-%d", i)
		if strings.HasPrefix(sha1Hex(p), "0000") {
			out = append(out, p)
		}
	}
	return out
}

// corpusServer serves the range API for passwords, each seen count times, and counts what it
// was asked; fail makes the first request for each range answer 503 instead.
func corpusServer(t *testing.T, passwords []string, count int, fail bool) (*httptest.Server, *atomic.Int64) {
	t.Helper()
	byRange := map[string][]string{}
	for _, p := range passwords {
		h := sha1Hex(p)
		byRange[h[:5]] = append(byRange[h[:5]], fmt.Sprintf("%s:%d", h[5:], count))
	}
	var asked atomic.Int64
	failed := map[string]bool{}
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked.Add(1)
		prefix := strings.TrimPrefix(r.URL.Path, "/range/")
		if r.Header.Get("User-Agent") == "" {
			t.Error("a request with no User-Agent, which the API asks for")
		}
		mu.Lock()
		retry := fail && !failed[prefix]
		failed[prefix] = true
		mu.Unlock()
		if retry {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		lines := byRange[prefix]
		sort.Strings(lines)
		// Padding lines, which the API adds on request and a reader must take in its stride.
		_, _ = fmt.Fprintf(w, "%s\r\n\r\n", strings.Join(append(lines, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0"), "\r\n"))
	}))
	t.Cleanup(srv.Close)
	return srv, &asked
}

func open(t *testing.T, path string) *breach.Corpus {
	t.Helper()
	c, err := breach.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func contains(t *testing.T, c *breach.Corpus, password string) bool {
	t.Helper()
	ok, err := c.Contains(password)
	if err != nil {
		t.Fatal(err)
	}
	return ok
}

func TestADownloadHoldsEveryBreachedPasswordAndNoOther(t *testing.T) {
	passwords := low(5)
	srv, asked := corpusServer(t, passwords, 3, true)
	out := filepath.Join(t.TempDir(), "corpus.bin")
	var progress bytes.Buffer
	count, err := build(t.Context(), options{out: out, api: srv.URL + "/range/", minCount: 1, workers: 3, ranges: 16}, &progress)
	if err != nil {
		t.Fatal(err)
	}
	if count != uint64(len(passwords)) {
		t.Fatalf("%d prefixes, want %d", count, len(passwords))
	}
	if asked.Load() != 32 {
		t.Errorf("%d requests for 16 ranges that each failed once", asked.Load())
	}
	c := open(t, out)
	for _, p := range passwords {
		if !contains(t, c, p) {
			t.Errorf("%s is breached and not in the corpus", p)
		}
	}
	if contains(t, c, "a password nobody has breached") {
		t.Error("a password nobody breached is in the corpus")
	}
}

func TestMinCountDropsTheRarelySeen(t *testing.T) {
	srv, _ := corpusServer(t, low(3), 1, false)
	out := filepath.Join(t.TempDir(), "corpus.bin")
	count, err := build(t.Context(), options{out: out, api: srv.URL + "/range/", minCount: 2, workers: 2, ranges: 16}, &bytes.Buffer{})
	if err != nil || count != 0 {
		t.Fatalf("%d, %v", count, err)
	}
	if open(t, out).Len() != 0 {
		t.Fatal("the corpus is not empty")
	}
}

// A range the API refuses for good fails the build, and leaves no file for the server to take
// for a whole corpus.
func TestAFailedDownloadLeavesNoCorpus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	out := filepath.Join(t.TempDir(), "corpus.bin")
	if _, err := build(t.Context(), options{out: out, api: srv.URL + "/range/", minCount: 1, workers: 2, ranges: 16}, &bytes.Buffer{}); err == nil {
		t.Fatal("a download of ranges the API refuses succeeded")
	}
	if _, err := os.Stat(out); !os.IsNotExist(err) {
		t.Fatalf("a failed build left %s: %v", out, err)
	}
}

func TestACorpusBuildsFromAFileInOrder(t *testing.T) {
	passwords := []string{"password123456", "correct horse battery staple", "hunter2hunter2"}
	var lines []string
	for i, p := range passwords {
		lines = append(lines, fmt.Sprintf("%s:%d", sha1Hex(p), i+1))
	}
	sort.Strings(lines)
	dir := t.TempDir()
	from := filepath.Join(dir, "pwned.txt")
	// With Windows line ends and a blank line at the end, as a file an editor saved may have.
	if err := os.WriteFile(from, []byte(strings.Join(lines, "\r\n")+"\r\n\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "corpus.bin")
	count, err := build(t.Context(), options{out: out, from: from, minCount: 2}, &bytes.Buffer{})
	if err != nil || count != 2 {
		t.Fatalf("%d, %v", count, err)
	}
	c := open(t, out)
	if contains(t, c, passwords[0]) || !contains(t, c, passwords[1]) || !contains(t, c, passwords[2]) {
		t.Fatal("the corpus does not hold exactly the passwords seen at least twice")
	}

	// Out of order, the file is refused.
	sort.Sort(sort.Reverse(sort.StringSlice(lines)))
	if err := os.WriteFile(from, []byte(strings.Join(lines, "\n")), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := build(t.Context(), options{out: out, from: from, minCount: 1}, &bytes.Buffer{}); err == nil {
		t.Fatal("a corpus out of order was built")
	}
}

func TestTheCommandLineIsChecked(t *testing.T) {
	for _, args := range [][]string{{}, {"-out"}, {"-out", "x", "extra"}, {"-out", "x", "-workers", "0"}, {"-out", "x", "-min-count", "0"}} {
		if code := run(t.Context(), args, &bytes.Buffer{}); code != 2 {
			t.Errorf("%q: exit %d", args, code)
		}
	}
}
