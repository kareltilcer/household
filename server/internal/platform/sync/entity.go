// Package sync is the platform's half of offline-first replication (PRD 03 §2): the registry
// of the entities that replicate, each with the merge policy and the access it declares; the
// streams PowerSync replicates them through, generated from those declarations (Streams, D-93,
// ADR 0014, ADR 0018); the record of each row a mutation writes (Change), which the mutation spine
// checks against those declarations; the rewrite of the access a row carries, which is not an edit of
// it (RewriteAccess); and the hooks its metrics are reported through (Metrics). The push that applies
// a client's mutations is internal/platform/push.
package sync

import (
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Policy is how concurrent writes to an entity merge (PRD 03 §2.5, D-24). Every entity declares
// one; there is no default.
type Policy string

// The five merge policies.
const (
	// LWWField is field-level last-write-wins by server receipt: two members editing different
	// fields of one row both succeed.
	LWWField Policy = "lww_field"
	// Additive rows are created and never merged, so two replicas cannot disagree about one. A
	// correction is an online edit under If-Match, never queued offline.
	Additive Policy = "additive"
	// LWWRow is whole-row last-write-wins, with the loser's version preserved and surfaced.
	LWWRow Policy = "lww_row"
	// StrictVersion refuses a write whose base_version is not the row's: money and structure,
	// where a conflict is better than a silent merge.
	StrictVersion Policy = "strict_version"
	// StateSet writes carry the state they want, keyed and resolved as the entity declares
	// (StateSet), so applying one twice is applying it once.
	StateSet Policy = "state_set"
)

var policies = []Policy{LWWField, Additive, LWWRow, StrictVersion, StateSet}

// Resolution orders two state_set writes to one key.
type Resolution string

const (
	// LatestClientTime lets the later intent win, by client time clamped to 24 hours of the
	// server's (PRD 03 §2.8).
	LatestClientTime Resolution = "latest_client_time"
	// Monotonic lets the value only move forward: the merge is a maximum, as for a read marker.
	Monotonic Resolution = "monotonic"
)

// StateSetRule is what a state_set entity declares beside its policy (PRD 03 §2.5): the fields
// its state hangs off, such as (item_id, user_id) for a personal completion or (item_id) alone
// for the household's, and how two writes to one key are ordered.
type StateSetRule struct {
	Key        []string
	Resolution Resolution
}

// Rule names a cross-row invariant.
type Rule string

// NonDecreasing holds a value from falling between neighbours in its series: a meter reading
// against the readings either side of it (FR-UT1), an asset's usage log (FR-AS1).
const NonDecreasing Rule = "non_decreasing"

// Invariant is a cross-row rule an additive series carries, which only the server can decide
// for certain, since a replica may not hold the neighbour a row breaks it against. It is
// declared so that a client can check against the neighbours it does hold, and warn where the
// value is entered (PRD 03 §2.5, D-24).
type Invariant struct {
	Rule Rule
	// Series are the fields that group rows into one series, such as a reading's meter_id.
	Series []string
	// Order is the field that orders a series, such as a reading's read_at.
	Order string
	// Field is the value the rule holds, such as a reading's value.
	Field string
}

// Access is the access axes an entity's rows are held to in the streams generated from it (PRD 03
// §2.3, D-22), as a set. Grant or Members is every entity's; the others are what a row may carry
// beyond the grant, each in columns of its own row (ADR 0018): a stream reads the entity's own table,
// so a row a private item or an audience bounds carries the visibility, the owner or the readers it
// takes from them, rewritten when they change (RewriteAccess).
type Access uint8

const (
	// Grant holds a row to the members whose grant on its module is above none, while the household
	// enables it. Every module's entity declares it: a zero Access is an entity that declared
	// nothing.
	Grant Access = 1 << iota
	// Owner lets a row be private to one member, when its visibility column says private and its
	// owner_id names them; the entity's redacted projection, where it declares one, reaches everyone
	// with the grant, the owner too, whose client shows the full row over it (D-88, D-93).
	Owner
	// Audience holds a row to an enumerated member list, a chat conversation or a member_shared
	// calendar: it reaches only the members its readers column names, those whose floor it is at or
	// above (D-90, D-93). Every row of the entity is held to its readers (Streams): a row no audience
	// bounds reaches nobody, so an entity only some of whose rows an audience bounds, as a calendar's
	// events, of which only a member_shared calendar's have one, does not declare it as the generator
	// stands (ADR 0018; plan item 75 settles the calendar's).
	Audience
	// Members holds a row to every member of its household, whatever their grant on its module: what
	// every member's app works from, the household's settings, its memberships and which modules it
	// enables (PRD modules/17 Sync). It stands in place of Grant, never beside it, and a row it
	// holds is neither private nor an audience's. Only the platform's own entities declare it
	// (module.PlatformModule): its stream checks neither a grant nor the module's enablement, so a
	// module's rows held to it would reach a member the module is absent for, which the module
	// registry refuses.
	Members

	allAccess = Grant | Owner | Audience | Members
)

// The columns the access axes read on an entity's own rows, which its table has (architecture test
// 10): a row that may be private says whether it is, 'shared' or 'private', and whose; a row an
// audience bounds names its readers, an array of user ids. Neither the visibility nor the readers is
// ever NULL, which no stream matches: a row would reach nobody (test 10).
const (
	// VersionColumn is every entity's version (add_entity_columns), which every client table carries:
	// a replica's report hashes each row by it (D-125).
	VersionColumn    = "version"
	VisibilityColumn = "visibility"
	OwnerColumn      = "owner_id"
	ReadersColumn    = "readers"
)

// AccessColumns are the columns e's access reads on its rows, beside its household's.
func (e Entity) AccessColumns() []string {
	var out []string
	if e.Access&Owner != 0 {
		out = append(out, VisibilityColumn, OwnerColumn)
	}
	if e.Access&Audience != 0 {
		out = append(out, ReadersColumn)
	}
	return out
}

// Entity is an entity that replicates offline, as its module declares it (module.SyncSource).
type Entity struct {
	// Name is the module-qualified entity type: "<module>.<entity>", as "garden.planting".
	Name string
	// Table is the table its rows live in, which carries the base columns (add_entity_columns).
	Table string
	// Policy is its merge policy.
	Policy Policy
	// StateSet is its key and resolution, declared exactly when Policy is StateSet.
	StateSet *StateSetRule
	// Invariant is the cross-row rule of an additive series, nil for none.
	Invariant *Invariant
	// Access is the axes its rows are held to.
	Access Access
	// Columns are the columns of Table its stream sends a replica, id first, or nil for every
	// column: a row that holds what no member's replica may, an invitation's token or a household's
	// code, names the rest (Streams). A column the table does not have fails architecture test 10.
	Columns []string
	// Redacted is its redacted projection (D-88), for an entity whose private rows others may see in
	// part, as a busy block stands in for a private event: the columns of Table, id first, that a
	// private row shows everyone with the grant, in a client table of its own named for Table, without
	// its schema, with _redacted after it, which its owner holds as well (D-93). Nil for an entity that
	// has none; only an Owner entity may have one, and only columns Columns names when it names them.
	// What is safe to reveal is the entity's to say, so the platform has no generic field-stripper. A
	// column the table does not have fails architecture test 10.
	Redacted []string
	// OfflineWrites is its offline-write flag (D-84): false until its policy's phase lets a
	// client queue writes to it, and read-only offline until then.
	OfflineWrites bool
	// Creates are the operationIds of the REST operations that create it, each of which must
	// require the client-generated id in its body (D-23, D-91; architecture test 9).
	Creates []string
}

// Module returns the module the entity belongs to, the part of its name before the first dot.
func (e Entity) Module() string {
	m, _, _ := strings.Cut(e.Name, ".")
	return m
}

// Identifier returns the entity's table quoted for SQL, its schema quoted apart when it names one.
func (e Entity) Identifier() string {
	return pgx.Identifier(strings.Split(e.Table, ".")).Sanitize()
}

var (
	entityName = regexp.MustCompile(`^[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`)
	identifier = regexp.MustCompile(`^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$`)
	column     = regexp.MustCompile(`^[a-z_][a-z0-9_]*$`)
)

// Violations returns what is wrong with the entities module declares, one line each
// (architecture test 5): a name that is not module-qualified by module, or used twice; no
// table; no merge policy, or one that is not among the five; a state_set without its key and
// resolution, or a key and resolution on another policy; an invariant on an entity that is not
// additive, or one that names no rule or no fields; no access, one that includes neither the grant
// nor every member, or every member beside another axis; a redacted projection on an entity that is
// never private; columns, or a redacted projection's, that do not start with id, or name one that is
// not an identifier, or one twice; a redacted projection's column that the entity's columns leave
// out, or that leave out version; and a create operation named twice.
func Violations(module string, entities []Entity) []string {
	var out []string
	seen := map[string]bool{}
	for i, e := range entities {
		name := e.Name
		if name == "" {
			name = fmt.Sprintf("%s entity %d", module, i)
		}
		bad := func(format string, args ...any) {
			out = append(out, name+": "+fmt.Sprintf(format, args...))
		}
		switch {
		case !entityName.MatchString(e.Name):
			bad("the name is not <module>.<entity> in lowercase words joined by underscores")
		case e.Module() != module:
			bad("the name is not qualified by its module, %s", module)
		case seen[e.Name]:
			bad("the name is declared twice")
		}
		seen[e.Name] = true
		if !identifier.MatchString(e.Table) {
			bad("no table, or one that is not a lowercase identifier")
		}

		switch {
		case e.Policy == "":
			bad("no merge policy; every entity declares one of %s", policyList())
		case !slices.Contains(policies, e.Policy):
			bad("merge policy %q is not one of %s", e.Policy, policyList())
		}
		switch {
		case e.Policy == StateSet && e.StateSet == nil:
			bad("state_set without its key and resolution")
		case e.Policy == StateSet:
			if len(e.StateSet.Key) == 0 || slices.Contains(e.StateSet.Key, "") {
				bad("state_set without its key")
			}
			if e.StateSet.Resolution != LatestClientTime && e.StateSet.Resolution != Monotonic {
				bad("state_set resolution %q is not %s or %s", e.StateSet.Resolution, LatestClientTime, Monotonic)
			}
		case e.StateSet != nil:
			bad("a state_set key and resolution on merge policy %s", e.Policy)
		}
		if inv := e.Invariant; inv != nil {
			if e.Policy != Additive {
				bad("a cross-row invariant on merge policy %s; only an additive series declares one", e.Policy)
			}
			if inv.Rule != NonDecreasing {
				bad("invariant rule %q is not %s", inv.Rule, NonDecreasing)
			}
			if len(inv.Series) == 0 || slices.Contains(inv.Series, "") || inv.Order == "" || inv.Field == "" {
				bad("an invariant that does not name its series, its order and its field")
			}
		}

		switch {
		case e.Access == 0:
			bad("no access; every entity declares the axes its rows are held to")
		case e.Access&^allAccess != 0:
			bad("access holds an axis that is not grant, owner, audience or members")
		case e.Access&Members != 0 && e.Access != Members:
			bad("access to every member of the household beside another axis; members stands alone")
		case e.Access&(Grant|Members) == 0:
			bad("access without the module grant, which holds every entity not every member's")
		}
		if e.Redacted != nil && e.Access&Owner == 0 {
			bad("a redacted projection on an entity whose rows are never private")
		}
		for _, list := range []struct {
			what    string
			columns []string
		}{{"columns", e.Columns}, {"a redacted projection's columns", e.Redacted}} {
			if list.columns == nil {
				continue
			}
			switch {
			case len(list.columns) == 0 || list.columns[0] != "id":
				bad("%s that do not start with id, which a replica keys every row on", list.what)
			case slices.ContainsFunc(list.columns, func(c string) bool { return !column.MatchString(c) }):
				bad("%s naming one that is not a lowercase identifier", list.what)
			default:
				named := map[string]bool{}
				for _, c := range list.columns {
					if named[c] {
						bad("%s naming %s twice", list.what, c)
					}
					named[c] = true
				}
				// A replica's report hashes each row it holds by its id and its version (D-125), so every
				// client table an entity's streams write carries both.
				if !named[VersionColumn] {
					bad("%s that leave out %s, which a replica's report hashes each row by", list.what, VersionColumn)
				}
			}
		}
		// A column the full row withholds from every replica, a token or a code, is withheld from the
		// projection everyone with the grant holds as well.
		if e.Columns != nil {
			for _, c := range e.Redacted {
				if !slices.Contains(e.Columns, c) {
					bad("a redacted projection's column %s, which its columns withhold from every replica", c)
				}
			}
		}
		creates := map[string]bool{}
		for _, op := range e.Creates {
			if op == "" || creates[op] {
				bad("create operation %q is empty or named twice", op)
			}
			creates[op] = true
		}
	}
	return out
}

func policyList() string {
	names := make([]string, len(policies))
	for i, p := range policies {
		names[i] = string(p)
	}
	return strings.Join(names, ", ")
}
