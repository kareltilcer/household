package db_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strconv"
	"testing"

	"github.com/pressly/goose/v3/lock"
)

// Every advisory lock key the server declares differs from every other of its form, and from the one
// goose's migrations take: two alike would be one lock, and each holder would wait on the other.
func TestAdvisoryLocksDiffer(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "locks.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]map[int64]string{"int64": {lock.DefaultLockID: "goose's migration lock"}, "int32": {}}
	declared := 0
	for _, d := range file.Decls {
		decl, ok := d.(*ast.GenDecl)
		if !ok || decl.Tok != token.CONST {
			continue
		}
		for _, spec := range decl.Specs {
			v, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			form, ok := v.Type.(*ast.Ident)
			if !ok || seen[form.Name] == nil || len(v.Names) != 1 || len(v.Values) != 1 {
				t.Fatalf("%s is not one int64 or int32 key", v.Names[0].Name)
			}
			lit, ok := v.Values[0].(*ast.BasicLit)
			if !ok || lit.Kind != token.INT {
				t.Fatalf("%s is not an integer literal", v.Names[0].Name)
			}
			key, err := strconv.ParseInt(lit.Value, 0, 64)
			if err != nil {
				t.Fatal(err)
			}
			name := v.Names[0].Name
			if other, taken := seen[form.Name][key]; taken {
				t.Errorf("%s is %s's key", name, other)
			}
			seen[form.Name][key] = name
			declared++
		}
	}
	if declared < 7 {
		t.Fatalf("%d keys found in locks.go; it declares 7 at least", declared)
	}
}
