package ratelimit_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
)

// units are the durations a limit's window is written in.
var units = map[string]time.Duration{
	"Nanosecond": time.Nanosecond, "Microsecond": time.Microsecond, "Millisecond": time.Millisecond,
	"Second": time.Second, "Minute": time.Minute, "Hour": time.Hour,
}

// duration reads a window as the package writes one, a unit of package time, a number, or a product of
// them, and reports false for any other form.
func duration(e ast.Expr) (time.Duration, bool) {
	switch e := e.(type) {
	case *ast.ParenExpr:
		return duration(e.X)
	case *ast.BasicLit:
		n, err := strconv.ParseInt(e.Value, 0, 64)
		return time.Duration(n), e.Kind == token.INT && err == nil
	case *ast.SelectorExpr:
		pkg, ok := e.X.(*ast.Ident)
		unit, known := units[e.Sel.Name]
		return unit, ok && pkg.Name == "time" && known
	case *ast.BinaryExpr:
		x, okX := duration(e.X)
		y, okY := duration(e.Y)
		return x * y, e.Op == token.MUL && okX && okY
	}
	return 0, false
}

// The expiry sweep deletes a throttle's row a day after its window and its block end (Sweep), which
// changes nothing only while no limit counts over a longer window: a limit with a longer one moves
// Forgotten with it. Every limit is found in the package's source, so that one added later is checked
// without anyone listing it here.
func TestNoLimitOutlivesWhatTheSweepForgets(t *testing.T) {
	sources, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	found := 0
	for _, name := range sources {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(file, func(n ast.Node) bool {
			lit, ok := n.(*ast.CompositeLit)
			if !ok {
				return true
			}
			if typ, ok := lit.Type.(*ast.Ident); !ok || typ.Name != "Limit" {
				return true
			}
			found++
			var window ast.Expr
			for _, elt := range lit.Elts {
				if kv, ok := elt.(*ast.KeyValueExpr); ok {
					if key, ok := kv.Key.(*ast.Ident); ok && key.Name == "Window" {
						window = kv.Value
					}
				}
			}
			at := fset.Position(lit.Pos())
			switch d, ok := duration(window); {
			case !ok:
				t.Errorf("%s: a limit whose window this test cannot read: name its fields, and write it as a number of time's units", at)
			case d > ratelimit.Forgotten:
				t.Errorf("%s: a limit counts over %s, longer than the %s the sweep keeps its rows past their window and block", at, d, ratelimit.Forgotten)
			}
			return true
		})
	}
	if found == 0 {
		t.Fatal("no limit found in the package's source")
	}
}
