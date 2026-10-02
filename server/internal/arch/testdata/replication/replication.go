// Package replication holds streams and entities for architecture test 10 to check against the
// tables testdata/replication/tables.sql makes: some that it replicates as it should, and some that
// it does not.
package replication

import "github.com/kareltilcer/household/server/internal/platform/sync"

// Streams read the testdata's tables.
func Streams() []sync.Stream {
	stream := func(name, table string) sync.Stream {
		return sync.Stream{Name: name, Entity: "probe." + name, Table: table, Reads: []string{table}}
	}
	return []sync.Stream{
		stream("published", "arch_testdata.published_items"),
		stream("unpublished", "arch_testdata.unpublished_items"),
		stream("halfway", "arch_testdata.halfway_items"),
		stream("gone", "arch_testdata.gone_items"),
	}
}

// Entities are kept in the testdata's tables: one replicating a column its table does not have; one
// whose table no stream reads, which keeps it from no violation; a private one whose table has no
// owner, lets its visibility be NULL, and whose redacted projection names a column its table does not
// have; and an audience's, whose table keeps no readers.
func Entities() []sync.Entity {
	return []sync.Entity{
		{Name: "probe.published", Table: "arch_testdata.published_items", Columns: []string{"id", "title", "colour"}},
		{Name: "probe.withheld", Table: "arch_testdata.withheld_items"},
		{Name: "probe.private", Table: "arch_testdata.published_items", Access: sync.Grant | sync.Owner,
			Redacted: []string{"id", "secret"}},
		{Name: "probe.heard", Table: "arch_testdata.published_items", Access: sync.Grant | sync.Audience},
	}
}
