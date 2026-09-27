package arch_test

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/modules"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// TestMain migrates the package's database with every module's block, so that the tests of the
// schema read the schema the server runs.
func TestMain(m *testing.M) {
	registry, err := module.NewRegistry(modules.All()...)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	testsupport.Main(m, registry.Blocks()...)
}

// registry returns the server's module registry.
func registry(t *testing.T) *module.Registry {
	t.Helper()
	r, err := module.NewRegistry(modules.All()...)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// adminTx opens a transaction on the package's database as the cluster's administrator, which
// passes every policy, and rolls it back when t finishes: what a test changes in it is never
// seen by another.
func adminTx(t *testing.T) pgx.Tx {
	t.Helper()
	conn, err := pgx.Connect(t.Context(), testsupport.Open(t).URL(""))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	tx, err := conn.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	return tx
}

// execFile runs the SQL in the file name in dir on tx.
func execFile(t *testing.T, tx pgx.Tx, dir, name string) {
	t.Helper()
	sql, err := fs.ReadFile(os.DirFS(dir), name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(t.Context(), string(sql)); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}
