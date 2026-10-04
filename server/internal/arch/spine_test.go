package arch_test

import (
	"fmt"
	"go/ast"
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

	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// Architecture test 4 (PRD 01 §3, §10, FR-AU1, FR-SY1): a mutation writes an audit event and a
// sync change, in its own transaction. The rule is held three times, and this test is the part
// a build can check without running a module's routes:
//
//   - tenant.InTx, through which a handler reads, is read-only, so PostgreSQL refuses a write
//     there (internal/app's probe tests prove it);
//   - mutation.Apply, the one entry point that may write, commits only what it records: it rolls
//     back a mutation that reports nothing and refuses one that reports half
//     (internal/platform/mutation's tests prove it);
//   - and no module opens a write transaction of its own: this test fails a module, its tests
//     and its testdata included, that names tenant.InWriteTx or tenant.AccountTx, which only the
//     platform may, or tenant.Assume, through which a module could make a scope of any household
//     and write there, or tenant.Outside, through which it would read outside the household the
//     tenant middleware resolved, in the transaction that writes there, or dot-imports the tenant
//     package, which would hide the names from it; nor names the setting that keeps an update from
//     moving a row's version, which only sync.RewriteAccess sets, for the access a row carries
//     (ADR 0018); nor names mutation.AsService, which records a mutation as the platform's staff's,
//     or mutation.Note, which records an event that changes no row, both the platform's alone (plan
//     item 21, ADR 0022), or dot-imports the mutation package.
func TestModulesWriteOnlyThroughTheSpine(t *testing.T) {
	// The server's internal directory, one up.
	for _, v := range spineViolations(t, os.DirFS("..")) {
		t.Error(v)
	}
}

// Test 4 against deliberate violations: testdata/spine is a small internal directory whose
// modules open write transactions in the ways the test must catch, and some that it must not,
// and want.txt is every violation it must report.
func TestModulesWriteOnlyThroughTheSpineCatchesEachViolation(t *testing.T) {
	root := os.DirFS(filepath.Join("testdata", "spine"))
	got := spineViolations(t, root)
	want := lines(t, root, "want.txt")
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

// tenantPath is the import path of the package whose write transaction only the platform opens, and
// mutationPath that of the spine, two of whose names are the platform's alone.
const (
	tenantPath   = internalPath + "platform/tenant"
	mutationPath = internalPath + "platform/mutation"
)

// spineViolations walks root, an internal directory, and returns each place a module's Go file
// names tenant.InWriteTx, tenant.AccountTx, tenant.Assume or tenant.Outside, mutation.AsService or
// mutation.Note, or dot-imports the tenant or the mutation package, as "path:line: message".
func spineViolations(t *testing.T, root fs.FS) []string {
	t.Helper()
	var out []string
	fset := token.NewFileSet()
	err := fs.WalkDir(root, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if p != "." && strings.HasPrefix(d.Name(), ".") {
				return fs.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") {
			return nil
		}
		mod, ok := owner(path.Dir(p))
		if !ok || mod == platform || mod == list {
			return nil
		}
		src, err := fs.ReadFile(root, p)
		if err != nil {
			return err
		}
		file, err := parser.ParseFile(fset, p, src, parser.SkipObjectResolution)
		if err != nil {
			return err
		}
		// The names each of the two packages is imported under.
		var names, spine []string
		for _, spec := range file.Imports {
			imported, err := strconv.Unquote(spec.Path.Value)
			if err != nil {
				return err
			}
			var (
				under *[]string
				base  string
			)
			switch imported {
			case tenantPath:
				under, base = &names, "tenant"
			case mutationPath:
				under, base = &spine, "mutation"
			default:
				continue
			}
			switch {
			case spec.Name == nil:
				*under = append(*under, base)
			case spec.Name.Name == "." && imported == tenantPath:
				out = append(out, fmt.Sprintf("%s:%d: module %s dot-imports the tenant package, which hides tenant.InWriteTx, tenant.AccountTx, tenant.Assume and tenant.Outside from this test",
					p, fset.Position(spec.Pos()).Line, mod))
			case spec.Name.Name == ".":
				out = append(out, fmt.Sprintf("%s:%d: module %s dot-imports the mutation package, which hides mutation.AsService and mutation.Note from this test",
					p, fset.Position(spec.Pos()).Line, mod))
			case spec.Name.Name != "_":
				*under = append(*under, spec.Name.Name)
			}
		}
		ast.Inspect(file, func(n ast.Node) bool {
			if lit, ok := n.(*ast.BasicLit); ok && lit.Kind == token.STRING && strings.Contains(lit.Value, sync.AccessRewrite) {
				out = append(out, fmt.Sprintf("%s:%d: module %s names the access rewrite; a module rewrites the access a row carries "+
					"through sync.RewriteAccess, which touch_entity holds to the access columns and leaves unversioned",
					p, fset.Position(lit.Pos()).Line, mod))
				return true
			}
			sel, ok := n.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			x, ok := sel.X.(*ast.Ident)
			if ok && slices.Contains(spine, x.Name) {
				switch sel.Sel.Name {
				case "AsService":
					out = append(out, fmt.Sprintf("%s:%d: module %s names a service as the actor of its mutations; "+
						"a module's mutation is its caller's, and only the platform acts for its staff",
						p, fset.Position(sel.Pos()).Line, mod))
				case "Note":
					out = append(out, fmt.Sprintf("%s:%d: module %s records an event that changes no row; "+
						"a module's every event is a mutation's, recorded through mutation.Apply with its sync change",
						p, fset.Position(sel.Pos()).Line, mod))
				}
				return true
			}
			if !slices.Contains([]string{"InWriteTx", "AccountTx", "Assume", "Outside"}, sel.Sel.Name) {
				return true
			}
			switch {
			case !ok || !slices.Contains(names, x.Name):
			case sel.Sel.Name == "Assume":
				out = append(out, fmt.Sprintf("%s:%d: module %s makes a tenant scope of its own; "+
					"a module reads and writes the household the tenant middleware resolved",
					p, fset.Position(sel.Pos()).Line, mod))
			case sel.Sel.Name == "Outside":
				out = append(out, fmt.Sprintf("%s:%d: module %s steps outside its household's context; "+
					"a module reads and writes the household the tenant middleware resolved",
					p, fset.Position(sel.Pos()).Line, mod))
			default:
				out = append(out, fmt.Sprintf("%s:%d: module %s opens a write transaction of its own; "+
					"a module writes through mutation.Apply, which records the audit event and the sync change",
					p, fset.Position(sel.Pos()).Line, mod))
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}
