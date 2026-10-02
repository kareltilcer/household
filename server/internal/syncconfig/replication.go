package syncconfig

import (
	"context"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// Publication is the publication PowerSync replicates from, by the name it reads by default.
const Publication = "powersync"

// Replication returns what is wrong, in the database tx reads, with what streams and entities need
// of it (architecture test 10), one line each: a table a stream reads that is not in the powersync
// publication, that is not at REPLICA IDENTITY FULL, or that the replication role may not read; a
// table the replication role may SELECT that no stream reads, since the role queries past row-level
// security and must query nothing it does not replicate; a column an entity replicates, in full or in
// its redacted projection, that its table does not have; and a column its access holds its rows to,
// their visibility and owner or their readers (sync.Entity.AccessColumns), that its table does not
// have. A table is named bare in the public schema, and with its schema elsewhere. It holds the role's
// queries, not its REPLICATION, which decodes every table's changes whatever the role is granted
// (db.RolePowerSync).
func Replication(ctx context.Context, tx pgx.Tx, streams []sync.Stream, entities []sync.Entity) ([]string, error) {
	type table struct {
		published, full, readable bool
		columns                   []string
	}
	rows, err := tx.Query(ctx, `
		SELECT CASE WHEN n.nspname = 'public' THEN c.relname::text ELSE n.nspname || '.' || c.relname END,
		  EXISTS (SELECT FROM pg_publication_rel r JOIN pg_publication p ON p.oid = r.prpubid
		          WHERE p.pubname = $1 AND r.prrelid = c.oid),
		  c.relreplident = 'f',
		  has_table_privilege($2, c.oid, 'SELECT'),
		  coalesce((SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_attribute a
		            WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped), '{}')
		FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')`,
		Publication, db.RolePowerSync)
	if err != nil {
		return nil, fmt.Errorf("syncconfig: read the tables: %w", err)
	}
	tables := map[string]table{}
	var (
		name string
		t    table
	)
	if _, err := pgx.ForEachRow(rows, []any{&name, &t.published, &t.full, &t.readable, &t.columns}, func() error {
		tables[name] = t
		return nil
	}); err != nil {
		return nil, fmt.Errorf("syncconfig: read the tables: %w", err)
	}

	var out []string
	read := sync.Tables(streams)
	for _, name := range read {
		t, ok := tables[name]
		switch {
		case !ok:
			out = append(out, name+": a stream reads it, and it does not exist")
			continue
		case !t.published:
			out = append(out, name+": a stream reads it, and it is not in the "+Publication+" publication; publish it with replicate")
		}
		if !t.full {
			out = append(out, name+": a stream reads it, and its REPLICA IDENTITY is not FULL; publish it with replicate")
		}
		if !t.readable {
			out = append(out, name+": a stream reads it, and "+db.RolePowerSync+" may not read it; publish it with replicate")
		}
	}
	for _, e := range entities {
		t, ok := tables[e.Table]
		if !ok {
			continue
		}
		for _, c := range append(slices.Clone(e.Columns), e.Redacted...) {
			if !slices.Contains(t.columns, c) {
				out = append(out, fmt.Sprintf("%s: %s replicates its column %s, which it does not have", e.Table, e.Name, c))
			}
		}
		for _, c := range e.AccessColumns() {
			if !slices.Contains(t.columns, c) {
				out = append(out, fmt.Sprintf("%s: %s holds its rows to their column %s, which it does not have", e.Table, e.Name, c))
			}
		}
	}
	names := make([]string, 0, len(tables))
	for name := range tables {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		if tables[name].readable && !slices.Contains(read, name) {
			out = append(out, name+": "+db.RolePowerSync+" may read it, and no stream reads it: the role reads past row-level security, and only what it replicates")
		}
	}
	return out, nil
}
