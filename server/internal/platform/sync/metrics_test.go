package sync_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

func TestMain(m *testing.M) { testsupport.Main(m) }

// slot is what SampleLag reported of a replication slot.
type slot struct {
	active bool
	bytes  int64
}

// lags is a sync.Metrics that keeps the slots SampleLag reports, by name, and ignores the rest.
type lags map[string]slot

func (lags) Batch(context.Context, int)                       {}
func (lags) Answered(context.Context, string, string, string) {}
func (lags) Diverged(context.Context, string, string)         {}
func (lags) Queue(context.Context, int)                       {}

func (l lags) Lag(_ context.Context, name string, active bool, bytes int64) {
	l[name] = slot{active: active, bytes: bytes}
}

// SampleLag reports each of PowerSync's logical replication slots, read as the meter role the
// scheduler samples them as: its name, whether a session holds it, and the write-ahead log written
// since the position its consumer confirmed. A slot that is not PowerSync's it leaves out.
func TestSampleLagReportsPowerSyncsSlots(t *testing.T) {
	d := testsupport.Open(t)
	// Temporary slots, held by the session that made them and dropped as it ends, however the test
	// ends: a slot left behind would keep the cluster's write-ahead log for good.
	conn, err := pgx.Connect(t.Context(), d.URL(""))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	suffix := strings.ReplaceAll(idgen.New().String(), "-", "")
	powersync, other := "powersync_test_"+suffix, "other_test_"+suffix
	for _, name := range []string{powersync, other} {
		if _, err := conn.Exec(t.Context(), "SELECT pg_create_logical_replication_slot($1, 'pgoutput', true)", name); err != nil {
			t.Fatal(err)
		}
	}
	// Write-ahead log past the slot's confirmed position, which nothing consumes.
	if _, err := d.Pool(t, "").Exec(t.Context(), "SELECT pg_logical_emit_message(true, 'household-test', 'lag')"); err != nil {
		t.Fatal(err)
	}

	got := lags{}
	if err := sync.SampleLag(t.Context(), d.Pool(t, db.RoleMeter), got); err != nil {
		t.Fatal(err)
	}
	if s, ok := got[powersync]; !ok || !s.active || s.bytes <= 0 {
		t.Errorf("PowerSync's slot: %+v, reported %v; want it active, lagging", s, ok)
	}
	if _, ok := got[other]; ok {
		t.Error("a slot that is not PowerSync's was reported")
	}
}
