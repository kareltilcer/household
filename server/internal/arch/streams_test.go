package arch_test

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/kareltilcer/household/server/internal/arch/testdata/replication"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/syncconfig"
)

// Architecture test 10 (plan item 13, ADR 0014): PowerSync runs the streams the entity registry
// generates, and replicates what they read and nothing else. The committed configurations are the
// generated ones, so an entity a module adds, or an access it changes, reaches a replica only through
// `pnpm run gen`; and every table a served stream reads is in the powersync publication, at REPLICA
// IDENTITY FULL and readable by the replication role, while the role, which reads past row-level
// security, may SELECT no table no stream reads, so that a later module's table cannot be left out of
// replication or let into it by hand. It holds the role's queries; its REPLICATION decodes the log
// past any grant, which is why its credential is the sync service's alone (db.RolePowerSync).
func TestSyncConfigurationIsTheGeneratedOne(t *testing.T) {
	files, err := syncconfig.Files()
	if err != nil {
		t.Fatal(err)
	}
	for path, want := range files {
		// The repository's root, three up.
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

func TestTheStreamsReadWhatIsReplicated(t *testing.T) {
	streams, err := syncconfig.ServedStreams()
	if err != nil {
		t.Fatal(err)
	}
	violations, err := syncconfig.Replication(t.Context(), adminTx(t), streams, registry(t).Entities())
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range violations {
		t.Error(v)
	}
}

// Test 10 against deliberate violations: testdata/replication/tables.sql makes, as the migrate role
// in a transaction that is rolled back, tables published as replicate publishes them and tables that
// are not, for streams and entities of testdata/replication that read them; want.txt is every
// violation the test must report of them.
func TestTheStreamsReadWhatIsReplicatedCatchesEachViolation(t *testing.T) {
	tx := adminTx(t)
	if _, err := tx.Exec(t.Context(), "SET LOCAL ROLE "+db.RoleMigrate); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join("testdata", "replication")
	execFile(t, tx, dir, "tables.sql")
	all, err := syncconfig.Replication(t.Context(), tx, replication.Streams(), replication.Entities())
	if err != nil {
		t.Fatal(err)
	}
	// The platform's tables are the other test's.
	var got []string
	for _, v := range all {
		if strings.HasPrefix(v, "arch_testdata.") {
			got = append(got, v)
		}
	}
	want := lines(t, os.DirFS(dir), "want.txt")
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}
