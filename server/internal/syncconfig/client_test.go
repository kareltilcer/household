package syncconfig_test

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/conformance"
	"github.com/kareltilcer/household/server/internal/modules"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
	"github.com/kareltilcer/household/server/internal/syncconfig"
)

// write rewrites the committed client registries instead of comparing them: `pnpm run gen` runs
// TestTheClientRegistriesAreTheGeneratedOnes with it.
var write = flag.Bool("write", false, "write the client registries rather than compare them")

// TestMain migrates the package's database with every module's block and the conformance module's,
// whose tables the suite's registry reads the columns of.
func TestMain(m *testing.M) {
	registry, err := module.NewRegistry(append(modules.All(), conformance.Module{})...)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	testsupport.Main(m, registry.Blocks()...)
}

func tx(t *testing.T) pgx.Tx {
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

// The client registries @household/sync builds a replica from are what the entity registry and the
// schema generate (plan item 18), as architecture test 10 holds PowerSync's configurations: an
// entity a module adds, a column it migrates or an offline-write flag it turns on reaches a client
// only through `pnpm run gen`.
func TestTheClientRegistriesAreTheGeneratedOnes(t *testing.T) {
	files, err := syncconfig.ClientRegistries(t.Context(), tx(t))
	if err != nil {
		t.Fatal(err)
	}
	for path, want := range files {
		// The repository's root, three up.
		if *write {
			if err := os.WriteFile(filepath.Join("..", "..", "..", filepath.FromSlash(path)), want, 0o644); err != nil { //nolint:gosec // G306: a committed registry, no secret.
				t.Fatal(err)
			}
			continue
		}
		got, err := os.ReadFile(filepath.Join("..", "..", "..", filepath.FromSlash(path)))
		if err != nil {
			t.Errorf("%s: %v", path, err)
			continue
		}
		if string(got) != string(want) {
			t.Errorf("%s is not what the entity registry generates; run `pnpm run gen`", path)
		}
	}
}

// The suite's registry names every stream its configuration holds but the negative control's, each
// with its entity and the client table it replicates into; each client table names its columns with
// their kinds, the redacted projection's only its own; and each entity its policy and flag.
func TestTheSuitesRegistry(t *testing.T) {
	files, err := syncconfig.ClientRegistries(t.Context(), tx(t))
	if err != nil {
		t.Fatal(err)
	}
	var r syncconfig.ClientRegistry
	if err := json.Unmarshal(files[syncconfig.SuiteRegistry], &r); err != nil {
		t.Fatal(err)
	}
	streams, err := syncconfig.SuiteStreams()
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Streams) != len(streams) {
		t.Errorf("%d streams in the registry, %d in the configuration", len(r.Streams), len(streams))
	}
	note := r.Entities[conformance.Note]
	if note.Table != "conformance_notes" || note.Redacted != "conformance_notes_redacted" || note.Policy != sync.LWWRow ||
		!note.OfflineWrites || note.Module != conformance.Name {
		t.Errorf("the note: %+v", note)
	}
	redacted := r.Tables["conformance_notes_redacted"]
	if !redacted.Redacted || redacted.Entity != conformance.Note || len(redacted.Columns) != 4 ||
		redacted.Columns["owner_id"] != syncconfig.KindUUID || redacted.Columns["version"] != syncconfig.KindInteger {
		t.Errorf("the note's redacted projection: %+v", redacted)
	}
	checks := r.Tables["conformance_item_checks"].Columns
	for column, kind := range map[string]syncconfig.Kind{
		"household_id": syncconfig.KindUUID, "checked": syncconfig.KindBoolean, "checked_at": syncconfig.KindTimestamp,
		"version": syncconfig.KindInteger, "deleted_at": syncconfig.KindTimestamp,
	} {
		if checks[column] != kind {
			t.Errorf("conformance_item_checks.%s is %q, want %q", column, checks[column], kind)
		}
	}
	if _, ok := checks["id"]; ok {
		t.Error("a client table names id among its columns, which every client table keys its rows on")
	}
	if r.Tables["conformance_messages"].Columns["readers"] != syncconfig.KindUUIDArray ||
		r.Tables["conformance_completions"].Columns["occurrence"] != syncconfig.KindDate ||
		r.Tables["memberships"].Columns["grants"] != syncconfig.KindJSON ||
		r.Tables["memberships"].Columns["role"] != syncconfig.KindText {
		t.Errorf("the kinds of an array, a date, a JSON value and an enum: %+v, %+v, %+v",
			r.Tables["conformance_messages"].Columns, r.Tables["conformance_completions"].Columns, r.Tables["memberships"].Columns)
	}
	// The household's settings send only the columns the entity names: never its code.
	if _, ok := r.Tables["households"].Columns["code"]; ok || len(r.Tables["households"].Columns) == 0 {
		t.Errorf("the household's settings: %+v", r.Tables["households"].Columns)
	}
	served, err := syncconfig.ServedStreams()
	if err != nil {
		t.Fatal(err)
	}
	var s syncconfig.ClientRegistry
	if err := json.Unmarshal(files[syncconfig.ServedRegistry], &s); err != nil {
		t.Fatal(err)
	}
	if len(s.Streams) != len(served) || slices.ContainsFunc(s.Streams, func(c syncconfig.ClientStream) bool {
		return c.Entity == conformance.Item
	}) {
		t.Errorf("the served registry holds %d streams of %d, or the conformance module's", len(s.Streams), len(served))
	}
}
