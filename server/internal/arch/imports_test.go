package arch_test

import (
	"fmt"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// Architecture test 1 (PRD 01 §4, §10): a module imports no other module, and the platform
// imports none. What a module needs from another it gets through a catalog the platform owns,
// and the platform reaches the modules only through the registry the server builds from
// internal/modules, the list of them, which only the server's composition may import. Test
// files are held to it too: a module whose tests import another has coupled the two just the
// same.
func TestModulesImportNoOtherModule(t *testing.T) {
	// The server's internal directory, one up.
	for _, v := range importViolations(t, os.DirFS("..")) {
		t.Error(v)
	}
}

// Test 1 against deliberate violations: testdata/imports is a small internal directory whose
// modules and platform import what they may not, and some of what they may, and want.txt is
// every violation the test must report.
func TestModulesImportNoOtherModuleCatchesEachViolation(t *testing.T) {
	root := os.DirFS(filepath.Join("testdata", "imports"))
	got := importViolations(t, root)
	want := lines(t, root, "want.txt")
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

// internalPath is the import path of the server's internal directory.
const internalPath = "github.com/kareltilcer/household/server/internal/"

// importViolations walks root, an internal directory, skipping testdata directories below it,
// and returns each forbidden import as "path:line: message", path relative to root.
func importViolations(t *testing.T, root fs.FS) []string {
	t.Helper()
	var out []string
	fset := token.NewFileSet()
	err := fs.WalkDir(root, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if p != "." && (d.Name() == "testdata" || strings.HasPrefix(d.Name(), ".")) {
				return fs.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") {
			return nil
		}
		importer, ok := owner(path.Dir(p))
		if !ok {
			return nil
		}
		src, err := fs.ReadFile(root, p)
		if err != nil {
			return err
		}
		file, err := parser.ParseFile(fset, p, src, parser.ImportsOnly)
		if err != nil {
			return err
		}
		for _, spec := range file.Imports {
			imported, err := strconv.Unquote(spec.Path.Value)
			if err != nil {
				return err
			}
			rel, ok := strings.CutPrefix(imported, internalPath)
			if !ok {
				continue
			}
			target, ok := owner(rel)
			if !ok || target == importer || target == platform {
				continue
			}
			line := fset.Position(spec.Pos()).Line
			switch {
			case importer == platform:
				out = append(out, fmt.Sprintf("%s:%d: the platform imports %s; it reaches modules only through the registry", p, line, describe(target)))
			case target == list:
				out = append(out, fmt.Sprintf("%s:%d: module %s imports %s, and through it every module", p, line, importer, describe(target)))
			case importer != list:
				out = append(out, fmt.Sprintf("%s:%d: module %s imports %s; a module imports no other module", p, line, importer, describe(target)))
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// The owners of a directory that are not a module's name.
const (
	platform = "platform"
	// list is internal/modules itself, the package that lists the modules.
	list = "modules"
)

// owner returns what dir, a path relative to the internal directory, belongs to: the platform,
// the module list, or a module by its name. It reports false for anything else, the server's
// composition among it.
func owner(dir string) (string, bool) {
	switch first, rest, _ := strings.Cut(dir, "/"); first {
	case platform:
		return platform, true
	case list:
		if rest == "" {
			return list, true
		}
		name, _, _ := strings.Cut(rest, "/")
		return name, true
	}
	return "", false
}

func describe(target string) string {
	switch target {
	case list:
		return "the module list, internal/modules"
	case platform:
		return "the platform"
	}
	return "module " + target
}
