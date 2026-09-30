package sync

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

// TenantRoot is the table of the households themselves, whose rows name their household by their
// own id: its household_id is a generated column, which PostgreSQL 17 leaves out of the changes it
// streams, so that a stream filtering on it would lose each row at its first update.
const TenantRoot = "households"

// The tables a generated stream looks a caller's access up in, every one of them replicated as the
// streams' own are (replicate): a member's role, their grants, and which modules their household
// enables.
const (
	membershipsTable = "memberships"
	grantsTable      = "module_grants"
	enablementTable  = "module_enablement"
)

// Stream is one stream of PowerSync's sync configuration (edition 3), generated from an entity's
// declared access (ADR 0001, D-93): a client subscribes to it with its household as the
// subscription's parameter, one replica per household (D-4).
type Stream struct {
	// Name is the stream's name, which a client subscribes by.
	Name string
	// Entity is the entity whose rows it sends, and Table the table they come from.
	Entity, Table string
	// Reads are the tables it reads, Table first: each is in the powersync publication, at REPLICA
	// IDENTITY FULL, and readable by the replication role (architecture test 10).
	Reads []string
	// Query is its definition.
	Query string
}

// Streams returns the streams that hold the rows of entities to the access each declares
// (PRD 03 §2.3), in the entities' order:
//
//   - Grant is two streams, since the stream compiler takes inner joins only and no OR across the
//     joined tables: an owner of the household while it enables the module, and a member whose grant
//     on the module is above none while it does. A row both reach is held once by the client. A child's
//     ceiling is never below view, so a stored grant above none is always one the member holds.
//   - Members is one stream: every member of the household.
//
// Every table a stream's subquery reads is looked up by the caller or by the subscribed household,
// never by constants alone: PowerSync caps one connection's parameter results at 1000 (PSYNC_S2305),
// and a lookup of every household that enables a module grows with the database until every
// connection is refused. A soft-deleted row stays in its streams, a tombstone, so that a client tells
// a row another member deleted from one it lost access to, which leaves its buckets.
//
// An entity whose rows may be private to their owner or bounded by an audience is not replicated
// yet: plan item 14 generates its visibility and audience streams, and until then it reaches no
// replica, which withholds it rather than leaking it.
func Streams(entities []Entity) ([]Stream, error) {
	var out []Stream
	names := map[string]bool{}
	for _, e := range entities {
		if e.Access&(Owner|Audience) != 0 {
			continue
		}
		columns := "*"
		if e.Columns != nil {
			columns = strings.Join(e.Columns, ", ")
		}
		key := "household_id"
		if e.Table == TenantRoot {
			key = "id"
		}
		base := strings.ReplaceAll(e.Name, ".", "_")
		head := fmt.Sprintf("SELECT %s FROM %s\nWHERE %s = subscription.parameter('household_id')\n  AND %s IN (\n", columns, e.Table, key, key)
		add := func(name, lookup string, reads ...string) error {
			if names[name] {
				return fmt.Errorf("sync: two streams are named %s; rename an entity", name)
			}
			names[name] = true
			all := []string{e.Table}
			for _, r := range reads {
				if !slices.Contains(all, r) {
					all = append(all, r)
				}
			}
			out = append(out, Stream{Name: name, Entity: e.Name, Table: e.Table, Reads: all, Query: head + lookup + "  )\n"})
			return nil
		}
		var err error
		//nolint:exhaustive // Owner and Audience were passed over above, and any other set is refused below.
		switch e.Access {
		case Members:
			err = add(base, `    SELECT m.household_id FROM memberships m
    WHERE m.user_id = auth.user_id() AND m.household_id = subscription.parameter('household_id')
`, membershipsTable)
		case Grant:
			module := e.Module()
			err = add(base+"_owner", fmt.Sprintf(`    SELECT m.household_id FROM memberships m
      JOIN module_enablement e ON e.household_id = m.household_id
    WHERE m.user_id = auth.user_id() AND m.role = 'owner'
      AND e.household_id = subscription.parameter('household_id')
      AND e.module = '%s' AND e.enabled
`, module), membershipsTable, enablementTable)
			if err == nil {
				err = add(base+"_granted", fmt.Sprintf(`    SELECT g.household_id FROM module_grants g
      JOIN module_enablement e ON e.household_id = g.household_id AND e.module = g.module
    WHERE g.user_id = auth.user_id() AND g.module = '%s' AND g.level <> 'none'
      AND e.household_id = subscription.parameter('household_id') AND e.enabled
`, module), grantsTable, enablementTable)
			}
		default:
			err = fmt.Errorf("sync: %s declares access %d, which no stream is generated for", e.Name, e.Access)
		}
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

// Tables returns every table streams read, each once, in the order they are first read.
func Tables(streams []Stream) []string {
	var out []string
	for _, s := range streams {
		for _, t := range s.Reads {
			if !slices.Contains(out, t) {
				out = append(out, t)
			}
		}
	}
	return out
}

// Config returns PowerSync's sync configuration holding streams, each query indented under its
// name, after header, a comment saying where it comes from.
func Config(header string, streams []Stream) []byte {
	var b bytes.Buffer
	for _, line := range strings.Split(strings.TrimRight(header, "\n"), "\n") {
		b.WriteString(strings.TrimRight("# "+line, " ") + "\n")
	}
	b.WriteString("config:\n  edition: 3\n\nstreams:\n")
	for i, s := range streams {
		if i > 0 {
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "  %s:\n    query: |\n", s.Name)
		for _, line := range strings.Split(strings.TrimRight(s.Query, "\n"), "\n") {
			b.WriteString("      " + line + "\n")
		}
	}
	return b.Bytes()
}

// Manifest returns streams as JSON, one object for each with its name, its entity and its table:
// what the conformance suite's clients subscribe to, and the tables they compare.
func Manifest(streams []Stream) ([]byte, error) {
	type entry struct {
		Stream string `json:"stream"`
		Entity string `json:"entity"`
		Table  string `json:"table"`
	}
	entries := make([]entry, 0, len(streams))
	for _, s := range streams {
		entries = append(entries, entry{Stream: s.Name, Entity: s.Entity, Table: s.Table})
	}
	out, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(out, '\n'), nil
}
