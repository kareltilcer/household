package breach_test

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/breach"
)

// write builds a corpus of passwords at a new path and returns the path.
func write(t *testing.T, passwords ...string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "corpus.bin")
	w, err := breach.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	var prefixes []uint64
	for _, p := range passwords {
		prefixes = append(prefixes, breach.Prefix(p))
	}
	slices.Sort(prefixes)
	for _, p := range prefixes {
		if err := w.Add(p); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestACorpusHoldsItsPasswordsOnce(t *testing.T) {
	breached := []string{"password123456", "sunshinesunshine", "letmeinletmein", "iloveyou123456", "password123456"}
	c, err := breach.Open(write(t, breached...))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = c.Close() }()
	if c.Len() != 4 {
		t.Fatalf("%d records for four passwords, one given twice", c.Len())
	}
	for _, p := range breached {
		if ok, err := c.Contains(p); err != nil || !ok {
			t.Errorf("%s: %v %v", p, ok, err)
		}
	}
	for _, p := range []string{"correct horse battery staple", "", "Password123456"} {
		if ok, err := c.Contains(p); err != nil || ok {
			t.Errorf("%q: %v %v", p, ok, err)
		}
	}
}

func TestAnEmptyCorpusHoldsNothing(t *testing.T) {
	c, err := breach.Open(write(t))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = c.Close() }()
	if ok, err := c.Contains("anything"); err != nil || ok {
		t.Fatal(ok, err)
	}
}

func TestAFileThatIsNotACorpusIsRefused(t *testing.T) {
	good, err := os.ReadFile(write(t, "password123456", "sunshinesunshine"))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	for name, data := range map[string][]byte{
		"short":     good[:10],
		"magic":     append([]byte("NOTMAGIC"), good[8:]...),
		"truncated": good[:len(good)-3],
		"longer":    append(append([]byte{}, good...), 0, 0, 0, 0, 0, 0, 0, 0),
	} {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
		if c, err := breach.Open(path); err == nil {
			_ = c.Close()
			t.Errorf("%s opened", name)
		}
	}
	if _, err := breach.Open(filepath.Join(dir, "missing")); err == nil {
		t.Error("a missing file opened")
	}
}

func TestPrefixesOutOfOrderAreRefused(t *testing.T) {
	w, err := breach.Create(filepath.Join(t.TempDir(), "corpus.bin"))
	if err != nil {
		t.Fatal(err)
	}
	defer w.Abort()
	if err := w.Add(10); err != nil {
		t.Fatal(err)
	}
	if err := w.Add(9); !errors.Is(err, breach.ErrUnsorted) {
		t.Fatalf("a prefix below the last: %v", err)
	}
}
