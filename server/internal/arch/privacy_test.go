package arch_test

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/kareltilcer/household/server/internal/arch/testdata/privacy"
	"github.com/kareltilcer/household/server/internal/platform/module"
)

// Architecture test 3 (PRD 01 §4, §10, D-6): every registered module implements ExportSource
// and EraseSource. A module that cannot export its data cannot ship (G5, GDPR Article 20), and
// one that cannot erase it leaves a deleted household's rows behind.
func TestModulesExportAndErase(t *testing.T) {
	for _, v := range privacyViolations(registry(t).All()) {
		t.Error(v)
	}
}

// Test 3 against deliberate violations: testdata/privacy holds a module that implements both
// and three that do not, and want.txt is every violation the test must report.
func TestModulesExportAndEraseCatchesEachViolation(t *testing.T) {
	got := privacyViolations(privacy.Modules())
	want := lines(t, os.DirFS(filepath.Join("testdata", "privacy")), "want.txt")
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

func privacyViolations(mods []module.Module) []string {
	var out []string
	for _, m := range mods {
		if _, ok := m.(module.ExportSource); !ok {
			out = append(out, "module "+m.Name()+" does not implement module.ExportSource")
		}
		if _, ok := m.(module.EraseSource); !ok {
			out = append(out, "module "+m.Name()+" does not implement module.EraseSource")
		}
	}
	return out
}
