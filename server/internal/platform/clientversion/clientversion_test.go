package clientversion_test

import (
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/clientversion"
)

func TestVersionsAreReadAndCompared(t *testing.T) {
	for raw, want := range map[string]clientversion.Version{
		"1.4.2":                 {1, 4, 2},
		"0.0.0":                 {0, 0, 0},
		"10.20.30-rc.1+build.5": {10, 20, 30},
		"2.0.0+exp.sha.5114f85": {2, 0, 0},
	} {
		got, ok := clientversion.ParseVersion(raw)
		if !ok || got != want {
			t.Errorf("%q: %v %v", raw, got, ok)
		}
	}
	for _, bad := range []string{"", "1", "1.4", "1.4.2.1", "v1.4.2", "01.4.2", "1.4.2-", "1.4.2 ", "1234567890.0.0"} {
		if _, ok := clientversion.ParseVersion(bad); ok {
			t.Errorf("%q: read as a version", bad)
		}
	}
	older := [][2]string{{"1.4.2", "1.6.0"}, {"1.6.0", "2.0.0"}, {"1.6.0", "1.6.1"}, {"1.9.9", "1.10.0"}}
	for _, pair := range older {
		a, _ := clientversion.ParseVersion(pair[0])
		b, _ := clientversion.ParseVersion(pair[1])
		if !a.Less(b) || b.Less(a) {
			t.Errorf("%s is not older than %s", pair[0], pair[1])
		}
	}
	// A pre-release counts as its release.
	beta, _ := clientversion.ParseVersion("1.6.0-beta.1")
	release, _ := clientversion.ParseVersion("1.6.0")
	if beta.Less(release) || release.Less(beta) {
		t.Error("a beta is not its release")
	}
}

func TestAHeaderNamesAClient(t *testing.T) {
	c, ok := clientversion.Parse("mobile/1.4.2-beta")
	if !ok || c.Type != clientversion.Mobile || c.Version != (clientversion.Version{Major: 1, Minor: 4, Patch: 2}) || c.Raw != "1.4.2-beta" {
		t.Fatalf("%+v %v", c, ok)
	}
	for _, bad := range []string{"mobile", "mobile/", "tablet/1.0.0", "Mobile/1.0.0", " web/1.0.0"} {
		if _, ok := clientversion.Parse(bad); ok {
			t.Errorf("%q: read as a client", bad)
		}
	}
}
