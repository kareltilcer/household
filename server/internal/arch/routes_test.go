package arch_test

import (
	"bufio"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/modules"
	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/health"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// Architecture test 6 (PRD 01 §10, PRD 07 §6): the routes the server serves and the
// operations openapi.yaml declares agree, except for the operations contract_pending.txt
// lists as not built yet. It fails on a route the contract does not declare, a route
// served while still pending, a pending entry the contract does not declare, and an
// operation that is neither served nor pending.
func TestRoutesMatchTheContract(t *testing.T) {
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	log := logging.New(io.Discard, slog.LevelError)
	pool := testsupport.Open(t).Pool(t, db.RoleApp)
	accounts, outbox := apptest.Accounts(t, pool, log, apptest.Options{})
	// The modules, as the server's composition passes them: the router adds the platform's own.
	mods, err := module.NewRegistry(modules.All()...)
	if err != nil {
		t.Fatal(err)
	}
	router, err := app.NewRouter(app.Deps{
		Logger: log, Contract: c, Health: health.New(log, time.Second),
		Pool: pool, Modules: mods, MaxBodyBytes: 1, Accounts: accounts,
		Households: apptest.Households(t, pool, log, accounts, outbox, apptest.Options{}),
	})
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}
	routes, err := contract.Routes(router)
	if err != nil {
		t.Fatal(err)
	}
	pending := readPending(t, os.DirFS("."), "contract_pending.txt")
	for _, v := range c.Diff(routes, pending) {
		t.Error(v)
	}
}

// Test 6 against deliberate violations: testdata/routes holds a small contract, a pending
// list and the routes of a router, and want.txt is every violation the test must report.
func TestRoutesMatchTheContractCatchesEachViolation(t *testing.T) {
	dir := os.DirFS(filepath.Join("testdata", "routes"))
	spec, err := fs.ReadFile(dir, "openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	c, err := contract.Parse(spec)
	if err != nil {
		t.Fatal(err)
	}

	// The router is built from routes.txt, so what is checked is what chi.Walk reports of a
	// real router: its parameter patterns and its mount points included.
	root, api := chi.NewRouter(), chi.NewRouter()
	noop := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	for _, line := range lines(t, dir, "routes.txt") {
		method, path, _ := strings.Cut(line, " ")
		if rest, ok := strings.CutPrefix(path, contract.BasePath); ok {
			api.Method(method, rest, noop)
		} else {
			root.Method(method, path, noop)
		}
	}
	root.Mount(contract.BasePath, api)
	routes, err := contract.Routes(root)
	if err != nil {
		t.Fatal(err)
	}

	var got []string
	for _, v := range c.Diff(routes, readPending(t, dir, "pending.txt")) {
		got = append(got, v.String())
	}
	want := lines(t, dir, "want.txt")
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

func readPending(t *testing.T, dir fs.FS, name string) []string {
	t.Helper()
	f, err := dir.Open(name)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	ids, err := contract.ReadPending(f)
	if err != nil {
		t.Fatal(err)
	}
	return ids
}

// lines returns the lines of a testdata file, less blank lines and # comments.
func lines(t *testing.T, dir fs.FS, name string) []string {
	t.Helper()
	f, err := dir.Open(name)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	var out []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		if line := strings.TrimSpace(scanner.Text()); line != "" && !strings.HasPrefix(line, "#") {
			out = append(out, line)
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}
