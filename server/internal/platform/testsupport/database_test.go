package testsupport

import (
	"context"
	"testing"
)

// A template build that died leaves a *_build database behind. Builds run only under the
// lock sweep's caller holds, so sweep drops it rather than keep it for ever.
func TestSweepDropsABuildThatDied(t *testing.T) {
	admin := Connect(t)
	ctx := t.Context()
	unlock, err := lockCatalog(ctx, admin)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()

	keep, err := templateName()
	if err != nil {
		t.Fatal(err)
	}
	died := templatePrefix + "0000000000000000_build"
	if err := exec(ctx, admin, "CREATE DATABASE %I", died); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = exec(context.Background(), admin, "DROP DATABASE IF EXISTS %I", died) })

	sweep(ctx, admin, keep)
	var exists bool
	if err := admin.QueryRow(ctx, "SELECT EXISTS (SELECT FROM pg_database WHERE datname = $1)", died).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatalf("sweep kept %s", died)
	}
}
