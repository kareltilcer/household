package arch_test

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/arch/testdata/privacy"
	"github.com/kareltilcer/household/server/internal/platform/module"
)

// Architecture test 3 (PRD 01 §4, §10, D-6): every registered module implements ExportSource
// and EraseSource, and every module the platform serves itself names both (module.PlatformModule).
// A module that cannot export its data cannot ship (G5, GDPR Article 20), and one that cannot erase
// it leaves a deleted household's rows behind.
func TestModulesExportAndErase(t *testing.T) {
	reg := registry(t)
	for _, v := range append(privacyViolations(reg.All()), platformPrivacyViolations(reg.Platform())...) {
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

// Test 3 against the platform's own modules: one that names both, and one that names neither.
func TestPlatformModulesExportAndEraseCatchesEachViolation(t *testing.T) {
	export := func(context.Context, pgx.Tx, module.Export, module.Archive) error { return nil }
	erase := func(context.Context, pgx.Tx, module.Erasure) error { return nil }
	got := platformPrivacyViolations([]module.PlatformModule{{Name: "whole", Export: export, Erase: erase}, {Name: "bare"}})
	want := []string{"module bare names no Export", "module bare names no Erase"}
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

func platformPrivacyViolations(mods []module.PlatformModule) []string {
	var out []string
	for _, p := range mods {
		if p.Export == nil {
			out = append(out, "module "+p.Name+" names no Export")
		}
		if p.Erase == nil {
			out = append(out, "module "+p.Name+" names no Erase")
		}
	}
	return out
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
