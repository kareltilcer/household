package sync

import (
	"bytes"
	"fmt"
	"slices"
	"strings"
)

// TenantRoot is the table of the households themselves, whose rows name their household by their
// own id: its household_id is a generated column, which PostgreSQL 17 leaves out of the changes it
// streams, so that a stream filtering on it would lose each row at its first update.
const TenantRoot = "households"

// RedactedSuffix follows the name of an entity's table, without its schema, in the name of the client
// table its redacted projection replicates into (Entity.Redacted).
const RedactedSuffix = "_redacted"

// The tables a generated stream looks a caller's access up in, every one of them replicated as the
// streams' own are (replicate): a member's role, their grants, which modules their household
// enables. Each lookup also reads the tenant root, whether the household is suspended (unsuspended).
const (
	membershipsTable = "memberships"
	grantsTable      = "module_grants"
	enablementTable  = "module_enablement"
)

// unsuspended returns the join every stream's lookup joins the subscribed household by, h, from the
// lookup's table aliased alias, and the terms it holds h to: a suspended household replicates nothing
// to any member's device, a new one included, and every row of it leaves the replicas that connect
// (PRD 04 §3, D-115). The credentials a client connects with name no household, and another
// household's route hands them out, so the streams alone hold a suspension on the replicated path.
func unsuspended(alias string) (join, where string) {
	return "      JOIN households h ON h.id = " + alias + ".household_id\n",
		"      AND h.id = subscription.parameter('household_id') AND h.suspended_at IS NULL\n"
}

// Stream is one stream of PowerSync's sync configuration (edition 3), generated from an entity's
// declared access (ADR 0001, D-93): a client subscribes to it with its household as the
// subscription's parameter, one replica per household (D-4).
type Stream struct {
	// Name is the stream's name, which a client subscribes by.
	Name string
	// Entity is the entity whose rows it sends, and Table the table they come from.
	Entity, Table string
	// Output is the client table the rows replicate into: Table, or for a redacted projection Table
	// without its schema, with RedactedSuffix after it.
	Output string
	// Reads are the tables it reads, Table first: each is in the powersync publication, at REPLICA
	// IDENTITY FULL, and readable by the replication role (architecture test 10).
	Reads []string
	// Query is its definition.
	Query string
}

// arm is one way a member reaches a module's rows, the lookup a stream holds its household to.
type arm struct {
	suffix, lookup string
	reads          []string
}

// arms returns the ways a member reaches e's rows: every member of the household for Members; for
// Grant, an owner of the household while it enables the module, and a member whose grant on the module
// is above none while it does.
func arms(e Entity) ([]arm, error) {
	switch {
	case e.Access == Members:
		join, where := unsuspended("m")
		return []arm{{"", `    SELECT m.household_id FROM memberships m
` + join + `    WHERE m.user_id = auth.user_id() AND m.household_id = subscription.parameter('household_id')
` + where, []string{membershipsTable, TenantRoot}}}, nil
	case e.Access&Grant != 0 && e.Access&Members == 0:
		module := e.Module()
		ownerJoin, ownerWhere := unsuspended("m")
		grantJoin, grantWhere := unsuspended("g")
		return []arm{
			{"_owner", fmt.Sprintf(`    SELECT m.household_id FROM memberships m
      JOIN module_enablement e ON e.household_id = m.household_id
%s    WHERE m.user_id = auth.user_id() AND m.role = 'owner'
      AND e.household_id = subscription.parameter('household_id')
      AND e.module = '%s' AND e.enabled
%s`, ownerJoin, module, ownerWhere), []string{membershipsTable, enablementTable, TenantRoot}},
			{"_granted", fmt.Sprintf(`    SELECT g.household_id FROM module_grants g
      JOIN module_enablement e ON e.household_id = g.household_id AND e.module = g.module
%s    WHERE g.user_id = auth.user_id() AND g.module = '%s' AND g.level <> 'none'
      AND e.household_id = subscription.parameter('household_id') AND e.enabled
%s`, grantJoin, module, grantWhere), []string{grantsTable, enablementTable, TenantRoot}},
		}, nil
	}
	return nil, fmt.Errorf("sync: %s declares access %d, which no stream is generated for", e.Name, e.Access)
}

// variant is one part of an entity's rows a stream sends: those a term on the row picks.
type variant struct {
	suffix string
	terms  []string
}

// The terms on a row of an entity that declares Owner and Audience: a shared row, a private row of
// the caller's, a private row whatever its owner, and a row the caller reads.
const (
	sharedTerm    = VisibilityColumn + " = 'shared'"
	privateTerm   = VisibilityColumn + " = 'private'"
	ownedTerm     = OwnerColumn + " = auth.user_id()"
	readerTerm    = "auth.user_id() IN " + ReadersColumn
	sharedSuffix  = "_shared"
	privateSuffix = "_private"
)

// Streams returns the streams that hold the rows of entities to the access each declares
// (PRD 03 §2.3), in the entities' order:
//
//   - Grant is two streams, since the stream compiler takes inner joins only and no OR across the
//     joined tables: an owner of the household while it enables the module, and a member whose grant
//     on the module is above none while it does. A row both reach is held once by the client. A child's
//     ceiling is never below view, so a stored grant above none is always one the member holds.
//   - Members is one stream: every member of the household.
//   - Owner doubles the grant's: its shared rows, and its private rows of the caller's own, by their
//     visibility and owner_id (D-88). Its redacted projection, where it declares one, is the grant's
//     two streams again, of its private rows whoever they belong to, sending the projection's columns
//     into a client table of its own, which reaches the owner as well, whose client shows the full row
//     over it (ADR 0001): a stream compares a row with the caller by equality alone.
//   - Audience holds every stream of the entity, its projection's too, to the rows whose readers name
//     the caller (D-90): the members whose floor the row is at or above, which the server keeps on
//     each row, since a stream cannot compare a row with a member's floor.
//
// Each holds the household to not being suspended (unsuspended).
//
// Every table a stream's subquery reads is looked up by the caller or by the subscribed household,
// never by constants alone: PowerSync caps one connection's parameter results at 1000 (PSYNC_S2305),
// and a lookup of every household that enables a module grows with the database until every
// connection is refused. A soft-deleted row stays in its streams, a tombstone, so that a client tells
// a row another member deleted from one it lost access to, which leaves its buckets.
func Streams(entities []Entity) ([]Stream, error) {
	var out []Stream
	names := map[string]bool{}
	for _, e := range entities {
		ways, err := arms(e)
		if err != nil {
			return nil, err
		}
		key := "household_id"
		if e.Table == TenantRoot {
			key = "id"
		}
		base := strings.ReplaceAll(e.Name, ".", "_")
		var always []string
		if e.Access&Audience != 0 {
			always = append(always, readerTerm)
		}
		add := func(name, columns, from, output string, terms []string, a arm) error {
			if names[name] {
				return fmt.Errorf("sync: two streams are named %s; rename an entity", name)
			}
			names[name] = true
			reads := []string{e.Table}
			for _, r := range a.reads {
				if !slices.Contains(reads, r) {
					reads = append(reads, r)
				}
			}
			var q strings.Builder
			fmt.Fprintf(&q, "SELECT %s FROM %s\nWHERE %s = subscription.parameter('household_id')\n", columns, from, key)
			for _, t := range terms {
				q.WriteString("  AND " + t + "\n")
			}
			q.WriteString("  AND " + key + " IN (\n" + a.lookup + "  )\n")
			out = append(out, Stream{Name: name, Entity: e.Name, Table: e.Table, Output: output, Reads: reads, Query: q.String()})
			return nil
		}
		columns := "*"
		if e.Columns != nil {
			columns = strings.Join(e.Columns, ", ")
		}
		variants := []variant{{"", nil}}
		if e.Access&Owner != 0 {
			variants = []variant{{sharedSuffix, []string{sharedTerm}}, {privateSuffix, []string{privateTerm, ownedTerm}}}
		}
		for _, v := range variants {
			for _, a := range ways {
				if err := add(base+v.suffix+a.suffix, columns, e.Table, e.Table, append(slices.Clone(v.terms), always...), a); err != nil {
					return nil, err
				}
			}
		}
		if e.Redacted != nil {
			// The client table is an alias, which names no schema.
			bare := e.Table
			if _, table, qualified := strings.Cut(e.Table, "."); qualified {
				bare = table
			}
			output := bare + RedactedSuffix
			for _, a := range ways {
				if err := add(base+RedactedSuffix+a.suffix, strings.Join(e.Redacted, ", "), e.Table+" AS "+output, output,
					append([]string{privateTerm}, always...), a); err != nil {
					return nil, err
				}
			}
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
