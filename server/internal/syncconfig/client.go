package syncconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// The client registries ClientRegistries generates, by their paths from the repository's root: what
// @household/sync builds a replica's schema from, subscribes to and reads each entity's merge policy
// and offline-write flag in (plan item 18, ADR 0019).
const (
	// ServedRegistry is the server's, which the clients ship.
	ServedRegistry = "packages/sync/src/generated/registry.json"
	// SuiteRegistry is the conformance suite's: the server's entities and the conformance module's.
	SuiteRegistry = "packages/sync/conformance/stack/powersync/registry.json"
)

// Kind is how a client holds a column, which its PostgreSQL type decides: what a replica stores it
// as, and what a mutation sends it as. A boolean is stored as 0 or 1 and sent as a boolean; an array
// and a JSON value are stored as their JSON text and sent as the value; the rest are sent as stored.
type Kind string

// The kinds a replicated column may have.
const (
	KindText      Kind = "text"
	KindUUID      Kind = "uuid"
	KindInteger   Kind = "integer"
	KindReal      Kind = "real"
	KindBoolean   Kind = "boolean"
	KindTimestamp Kind = "timestamp"
	KindDate      Kind = "date"
	KindJSON      Kind = "json"
	KindUUIDArray Kind = "uuid[]"
	KindTextArray Kind = "text[]"
)

// ClientStream is a stream a client subscribes to, with its household as the parameter, and the
// entity and client table its rows replicate into.
type ClientStream struct {
	Stream string `json:"stream"`
	Entity string `json:"entity"`
	Table  string `json:"table"`
}

// ClientEntity is what a client needs to know of an entity: the module it belongs to, whose
// enablement tells a row withdrawn by the module's being turned off from one withdrawn by access
// (design 03-patterns, When access is withdrawn); its client table, and its redacted projection's
// when it has one; its merge policy, which decides how an answer is surfaced; and whether it may be
// written offline (D-84).
type ClientEntity struct {
	Module        string      `json:"module"`
	Table         string      `json:"table"`
	Redacted      string      `json:"redacted,omitempty"`
	Policy        sync.Policy `json:"policy"`
	OfflineWrites bool        `json:"offline_writes"`
}

// ClientTable is a client table: the entity whose rows it holds, whether it holds them as their
// redacted projection, and every column a stream sends into it, but id, with its kind.
type ClientTable struct {
	Entity   string          `json:"entity"`
	Redacted bool            `json:"redacted"`
	Columns  map[string]Kind `json:"columns"`
}

// ClientRegistry is a client registry.
type ClientRegistry struct {
	Description string                  `json:"description"`
	Streams     []ClientStream          `json:"streams"`
	Entities    map[string]ClientEntity `json:"entities"`
	Tables      map[string]ClientTable  `json:"tables"`
}

const clientDescription = "Generated from the entity registry and the schema its migrations make, by " +
	"server/internal/syncconfig (plan item 18, ADR 0019). Do not edit it: `pnpm run gen` writes it, and a " +
	"test fails it when it is not what the registry generates."

// ClientRegistries returns every client registry by its path from the repository's root, reading the
// columns' types in q, a database every module's block and the conformance module's have migrated.
func ClientRegistries(ctx context.Context, q pgx.Tx) (map[string][]byte, error) {
	out := map[string][]byte{}
	for path, streams := range map[string]func() ([]sync.Stream, error){ServedRegistry: ServedStreams, SuiteRegistry: SuiteStreams} {
		s, err := streams()
		if err != nil {
			return nil, err
		}
		entities, err := entitiesOf(s)
		if err != nil {
			return nil, err
		}
		r, err := NewClientRegistry(ctx, q, s, entities)
		if err != nil {
			return nil, err
		}
		b, err := json.MarshalIndent(r, "", "  ")
		if err != nil {
			return nil, err
		}
		out[path] = append(b, '\n')
	}
	return out, nil
}

// entitiesOf returns the entities streams send, from the registries the streams were generated from.
func entitiesOf(streams []sync.Stream) ([]sync.Entity, error) {
	all, err := suiteEntities()
	if err != nil {
		return nil, err
	}
	var out []sync.Entity
	for _, e := range all {
		if slices.ContainsFunc(streams, func(s sync.Stream) bool { return s.Entity == e.Name }) {
			out = append(out, e)
		}
	}
	return out, nil
}

// NewClientRegistry returns the client registry of streams, which send the rows of entities, with
// each client table's columns and their kinds read in q.
func NewClientRegistry(ctx context.Context, q pgx.Tx, streams []sync.Stream, entities []sync.Entity) (ClientRegistry, error) {
	r := ClientRegistry{Description: clientDescription, Entities: map[string]ClientEntity{}, Tables: map[string]ClientTable{}}
	types, err := columnTypes(ctx, q)
	if err != nil {
		return r, err
	}
	byName := map[string]sync.Entity{}
	for _, e := range entities {
		byName[e.Name] = e
	}
	for _, s := range streams {
		e, ok := byName[s.Entity]
		if !ok {
			return r, fmt.Errorf("syncconfig: stream %s sends %s, which no registry declares", s.Name, s.Entity)
		}
		r.Streams = append(r.Streams, ClientStream{Stream: s.Name, Entity: s.Entity, Table: s.Output})
		redacted := s.Output != clientTable(e.Table)
		if _, done := r.Tables[s.Output]; !done {
			names := e.Columns
			if redacted {
				names = e.Redacted
			}
			columns, err := clientColumns(types, e.Table, names)
			if err != nil {
				return r, fmt.Errorf("syncconfig: %s: %w", s.Name, err)
			}
			r.Tables[s.Output] = ClientTable{Entity: e.Name, Redacted: redacted, Columns: columns}
		}
		ce := ClientEntity{Module: e.Module(), Table: clientTable(e.Table), Policy: e.Policy, OfflineWrites: e.OfflineWrites}
		if e.Redacted != nil {
			ce.Redacted = clientTable(e.Table) + sync.RedactedSuffix
		}
		r.Entities[e.Name] = ce
	}
	return r, nil
}

// clientTable is the name of the client table an entity's table replicates into: its own, without
// its schema, which no client table names.
func clientTable(table string) string {
	if _, bare, qualified := strings.Cut(table, "."); qualified {
		return bare
	}
	return table
}

// column is a column's type as PostgreSQL names it: its own, and for an array its element's.
type column struct {
	name, typ, element string
	enum               bool
}

// columnTypes returns every column of every table, by the table's name as streams name it: bare in
// the public schema, with its schema elsewhere.
func columnTypes(ctx context.Context, q pgx.Tx) (map[string][]column, error) {
	rows, err := q.Query(ctx, `
		SELECT CASE WHEN n.nspname = 'public' THEN c.relname::text ELSE n.nspname || '.' || c.relname END,
		  a.attname::text, t.typname::text, coalesce(et.typname::text, ''),
		  t.typtype = 'e' OR coalesce(et.typtype = 'e', false)
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
		JOIN pg_type t ON t.oid = a.atttypid
		LEFT JOIN pg_type et ON et.oid = t.typelem AND t.typcategory = 'A'
		WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
		ORDER BY 1, a.attnum`)
	if err != nil {
		return nil, fmt.Errorf("syncconfig: read the columns: %w", err)
	}
	out := map[string][]column{}
	var (
		table string
		c     column
	)
	if _, err := pgx.ForEachRow(rows, []any{&table, &c.name, &c.typ, &c.element, &c.enum}, func() error {
		out[table] = append(out[table], c)
		return nil
	}); err != nil {
		return nil, fmt.Errorf("syncconfig: read the columns: %w", err)
	}
	return out, nil
}

// clientColumns returns the columns of table named, or every one when names is nil, but id, which
// every client table keys its rows on, each with its kind.
func clientColumns(types map[string][]column, table string, names []string) (map[string]Kind, error) {
	all, ok := types[table]
	if !ok {
		return nil, fmt.Errorf("the table %s does not exist", table)
	}
	out := map[string]Kind{}
	for _, c := range all {
		if c.name == "id" || (names != nil && !slices.Contains(names, c.name)) {
			continue
		}
		k, err := kindOf(c)
		if err != nil {
			return nil, fmt.Errorf("%s.%s: %w", table, c.name, err)
		}
		out[c.name] = k
	}
	for _, n := range names {
		if _, ok := out[n]; !ok && n != "id" {
			return nil, fmt.Errorf("%s has no column %s", table, n)
		}
	}
	return out, nil
}

// kindOf is the kind a client holds a column of c's type as.
func kindOf(c column) (Kind, error) {
	if c.enum && c.element == "" {
		return KindText, nil
	}
	switch c.typ {
	case "uuid":
		return KindUUID, nil
	case "text", "varchar", "bpchar", "citext":
		return KindText, nil
	case "int2", "int4", "int8":
		return KindInteger, nil
	case "float4", "float8":
		return KindReal, nil
	case "bool":
		return KindBoolean, nil
	case "timestamptz", "timestamp":
		return KindTimestamp, nil
	case "date":
		return KindDate, nil
	case "json", "jsonb":
		return KindJSON, nil
	case "_uuid":
		return KindUUIDArray, nil
	case "_text", "_varchar":
		return KindTextArray, nil
	}
	if c.enum {
		return KindTextArray, nil
	}
	return "", fmt.Errorf("type %s, which no client kind holds", c.typ)
}
