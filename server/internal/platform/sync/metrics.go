package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
)

// Metrics is where sync reports what its alerting reads (PRD 07 §5, PRD 10 §5): how much the push is
// sent, how it answers, how far PowerSync's replication lags, and the divergence replicas report.
// Item 89 alerts on them through the observability baseline; until it does, LogMetrics logs them.
type Metrics interface {
	// Batch reports a batch of mutations the push received, in ctx's household: its size, the part of
	// a device's queue it carried.
	Batch(ctx context.Context, mutations int)
	// Answered reports one mutation's outcome, and its code when it was not applied: conflict, merged
	// and rejected over all are the conflict rate.
	Answered(ctx context.Context, entity, outcome, code string)
	// Diverged reports a replica that disagreed with the server for entity: a bucket whose checksum
	// failed, or a digest that did not match (D-85), as the replica's report says (item 18).
	Diverged(ctx context.Context, entity, kind string)
	// Queue reports the mutations a replica says it holds queued (item 18).
	Queue(ctx context.Context, pending int)
	// Lag reports a replication slot of PowerSync's: whether it is active, and how many bytes of
	// write-ahead log it holds that PowerSync has not confirmed, which max_slot_wal_keep_size bounds
	// (docs/runbooks/replication-slot.md).
	Lag(ctx context.Context, slot string, active bool, bytes int64)
}

// LogMetrics reports to a log: each answer and batch at debug, a slot's lag at info, and an inactive
// slot, a divergence, at warn.
type LogMetrics struct {
	Log *slog.Logger
}

var _ Metrics = LogMetrics{}

func (m LogMetrics) Batch(ctx context.Context, mutations int) {
	m.Log.LogAttrs(ctx, slog.LevelDebug, "sync: a batch", slog.Int("mutations", mutations))
}

func (m LogMetrics) Answered(ctx context.Context, entity, outcome, code string) {
	m.Log.LogAttrs(ctx, slog.LevelDebug, "sync: a mutation answered",
		slog.String("entity", entity), slog.String("outcome", outcome), slog.String("code", code))
}

func (m LogMetrics) Diverged(ctx context.Context, entity, kind string) {
	m.Log.LogAttrs(ctx, slog.LevelWarn, "sync: a replica diverged", slog.String("entity", entity), slog.String("kind", kind))
}

func (m LogMetrics) Queue(ctx context.Context, pending int) {
	m.Log.LogAttrs(ctx, slog.LevelDebug, "sync: a replica's queue", slog.Int("pending", pending))
}

func (m LogMetrics) Lag(ctx context.Context, slot string, active bool, bytes int64) {
	level := slog.LevelInfo
	if !active {
		level = slog.LevelWarn
	}
	m.Log.LogAttrs(ctx, level, "sync: replication lag", slog.String("slot", slot), slog.Bool("active", active), slog.Int64("bytes", bytes))
}

// Querier runs a query: a pool, or a transaction.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// SampleLag reports to m, read through q, the lag of each logical replication slot PowerSync holds on
// the database: the write-ahead log it retains past what PowerSync confirmed, and whether PowerSync is
// connected to it. A database without one, as the tests' are, reports nothing. It reads no table, and
// any role may read the slots.
func SampleLag(ctx context.Context, q Querier, m Metrics) error {
	rows, err := q.Query(ctx, `
		SELECT slot_name::text, active, coalesce(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn), 0)::bigint
		FROM pg_replication_slots WHERE slot_type = 'logical' AND slot_name LIKE 'powersync%' ORDER BY slot_name`)
	if err != nil {
		return fmt.Errorf("sync: read the replication slots: %w", err)
	}
	var (
		slot   string
		active bool
		bytes  int64
	)
	if _, err := pgx.ForEachRow(rows, []any{&slot, &active, &bytes}, func() error {
		m.Lag(ctx, slot, active, bytes)
		return nil
	}); err != nil {
		return fmt.Errorf("sync: read the replication slots: %w", err)
	}
	return nil
}
