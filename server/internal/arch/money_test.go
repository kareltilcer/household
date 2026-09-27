package arch_test

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
	"unicode"
)

// Architecture test 8 (PRD 01 §3, §10): money is amount_minor, an integer in the
// currency's minor unit, plus a currency code. A float cannot hold 0.10 exactly, and
// numeric is exact but invites arithmetic in the database that the domain packages own;
// both are refused wherever the name says money, in Go types and in migrations.
//
// Without type information the test goes by names: an identifier whose words include a
// money word and no unit word. It reads struct fields and their JSON tags, named types,
// function parameters and results, and variables with a declared type; in SQL, column
// definitions, column type changes and casts. PostgreSQL's money type is refused whatever
// the column is called.
func TestMoneyIsNeverFloatOrNumeric(t *testing.T) {
	// The server module, two directories up.
	for _, v := range moneyViolations(t, os.DirFS(filepath.Join("..", ".."))) {
		t.Error(v)
	}
}

// Test 8 against deliberate violations: testdata/money holds Go and SQL that break the
// rule, and some that keeps it, and want.txt is every violation the test must report.
func TestMoneyIsNeverFloatOrNumericCatchesEachViolation(t *testing.T) {
	root := os.DirFS(filepath.Join("testdata", "money"))
	got := moneyViolations(t, root)
	want := lines(t, root, "want.txt")
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

// moneyWords name money; unitWords name a quantity, which may be a float or numeric where
// a fraction is real data (PRD 01 §3, "Quantities").
var (
	moneyWords = set("amount", "amounts", "price", "prices", "cost", "costs", "fee", "fees",
		"balance", "balances", "money", "salary", "wage", "wages", "payment", "payments",
		"charge", "charges", "refund", "refunds", "tax", "vat", "budget", "budgets", "income",
		"expense", "expenses", "deposit", "deposits", "discount", "rent", "debt", "loan",
		"minor", "payout", "spend", "spending", "tariff")
	unitWords = set("kg", "g", "grams", "kwh", "dkwh", "wh", "kw", "mm", "cm", "m", "km",
		"m2", "m3", "l", "ml", "pct", "percent", "ratio", "rate", "rates", "count", "qty",
		"quantity", "seconds", "minutes", "hours", "days")
)

func set(words ...string) map[string]bool {
	m := make(map[string]bool, len(words))
	for _, w := range words {
		m[w] = true
	}
	return m
}

// words splits an identifier at underscores and case changes: AmountMinor and
// amount_minor are both [amount minor].
func words(name string) []string {
	var out []string
	var cur strings.Builder
	runes := []rune(name)
	for i, r := range runes {
		boundary := r == '_' || r == '-' ||
			(unicode.IsUpper(r) && i > 0 && (unicode.IsLower(runes[i-1]) ||
				(i+1 < len(runes) && unicode.IsLower(runes[i+1]))))
		if boundary && cur.Len() > 0 {
			out = append(out, strings.ToLower(cur.String()))
			cur.Reset()
		}
		if r != '_' && r != '-' {
			cur.WriteRune(r)
		}
	}
	if cur.Len() > 0 {
		out = append(out, strings.ToLower(cur.String()))
	}
	return out
}

func isMoney(name string) bool {
	money := false
	for _, w := range words(name) {
		if unitWords[w] {
			return false
		}
		money = money || moneyWords[w]
	}
	return money
}

// moneyViolations walks root for Go files and SQL, skipping testdata directories below
// it, and returns each violation as "path:line: message", path relative to root.
func moneyViolations(t *testing.T, root fs.FS) []string {
	t.Helper()
	var out []string
	err := fs.WalkDir(root, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			name := d.Name()
			if path != "." && (name == "testdata" || name == "vendor" || name == "node_modules" || strings.HasPrefix(name, ".")) {
				return fs.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") && !strings.HasSuffix(path, ".sql") {
			return nil
		}
		src, err := fs.ReadFile(root, path)
		if err != nil {
			return err
		}
		if strings.HasSuffix(path, ".go") {
			out = append(out, goMoney(t, path, src)...)
		} else {
			out = append(out, sqlMoney(path, string(src))...)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// floatTypes are the Go types that are not an integer minor unit: binary floats and the
// arbitrary-precision decimals.
var floatTypes = set("float32", "float64", "big.Float", "big.Rat", "decimal.Decimal", "pgtype.Numeric", "apd.Decimal")

// goType renders a type expression's element type: *[]float64 is float64.
func goType(expr ast.Expr) string {
	switch e := expr.(type) {
	case *ast.Ident:
		return e.Name
	case *ast.SelectorExpr:
		return goType(e.X) + "." + e.Sel.Name
	case *ast.StarExpr:
		return goType(e.X)
	case *ast.ArrayType:
		return goType(e.Elt)
	case *ast.MapType:
		return goType(e.Value)
	}
	return ""
}

func goMoney(t *testing.T, rel string, src []byte) []string {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, rel, src, parser.SkipObjectResolution)
	if err != nil {
		t.Fatalf("parse %s: %v", rel, err)
	}
	var out []string
	report := func(pos token.Pos, name string, typ ast.Expr) {
		if kind := goType(typ); floatTypes[kind] && isMoney(name) {
			out = append(out, fmt.Sprintf("%s:%d: %s is money held as %s; use an int64 amount_minor and a currency",
				rel, fset.Position(pos).Line, name, kind))
		}
	}
	fields := func(list *ast.FieldList) {
		if list == nil {
			return
		}
		for _, f := range list.List {
			for _, n := range f.Names {
				report(n.Pos(), n.Name, f.Type)
			}
			if f.Tag == nil {
				continue
			}
			tag, err := strconv.Unquote(f.Tag.Value)
			if err != nil {
				continue
			}
			for _, key := range []string{"json", "db"} {
				name, _, _ := strings.Cut(reflect.StructTag(tag).Get(key), ",")
				if name != "" && name != "-" && (len(f.Names) == 0 || !isMoney(f.Names[0].Name)) {
					report(f.Pos(), name, f.Type)
				}
			}
		}
	}
	ast.Inspect(file, func(n ast.Node) bool {
		switch n := n.(type) {
		case *ast.StructType:
			fields(n.Fields)
		case *ast.FuncType:
			fields(n.Params)
			fields(n.Results)
		case *ast.TypeSpec:
			report(n.Name.Pos(), n.Name.Name, n.Type)
		case *ast.ValueSpec:
			if n.Type != nil {
				for _, name := range n.Names {
					report(name.Pos(), name.Name, n.Type)
				}
			}
		}
		return true
	})
	return out
}

var (
	sqlComment = regexp.MustCompile(`--[^\n]*|/\*[\s\S]*?\*/`)
	sqlString  = regexp.MustCompile(`'(?:[^']|'')*'`)
	sqlDecimal = `(numeric|decimal|real|double\s+precision|float4|float8|float|money)\b`
	// A column definition or type change, "amount numeric(12,2)" or "ALTER COLUMN amount
	// TYPE real", or a cast, "amount_minor::numeric".
	sqlColumn = regexp.MustCompile(`(?i)\b([a-z_][a-z0-9_]*)\s+(?:set\s+data\s+)?(?:type\s+)?` + sqlDecimal)
	sqlCast   = regexp.MustCompile(`(?i)\b([a-z_][a-z0-9_]*)\s*::\s*` + sqlDecimal)
)

// blank replaces every character of s but line breaks with a space, so that text removed
// from a migration leaves every offset on its line.
func blank(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '\n' {
			return r
		}
		return ' '
	}, s)
}

func sqlMoney(rel, sql string) []string {
	src := sqlString.ReplaceAllStringFunc(sqlComment.ReplaceAllStringFunc(sql, blank), blank)

	type hit struct {
		offset int
		msg    string
	}
	var hits []hit
	seen := map[int]bool{}
	for _, re := range []*regexp.Regexp{sqlColumn, sqlCast} {
		for _, m := range re.FindAllStringSubmatchIndex(src, -1) {
			if seen[m[0]] {
				continue
			}
			name := src[m[2]:m[3]]
			kind := strings.Join(strings.Fields(strings.ToLower(src[m[4]:m[5]])), " ")
			switch {
			case kind == "money":
				hits = append(hits, hit{m[0], "PostgreSQL's money type rounds to the server locale's currency; use amount_minor bigint and currency char(3)"})
			case isMoney(name):
				hits = append(hits, hit{m[0], fmt.Sprintf("%s is money stored as %s; use amount_minor bigint and currency char(3)", name, kind)})
			default:
				continue
			}
			seen[m[0]] = true
		}
	}
	slices.SortFunc(hits, func(a, b hit) int { return a.offset - b.offset })

	var out []string
	for _, h := range hits {
		out = append(out, fmt.Sprintf("%s:%d: %s", rel, strings.Count(src[:h.offset], "\n")+1, h.msg))
	}
	return out
}
