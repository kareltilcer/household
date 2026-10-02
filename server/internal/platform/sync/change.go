package sync

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

// Op is what a change did to an entity's row.
type Op string

const (
	// Upsert wrote the row the change carries. A soft delete, which keeps a tombstone, is an Upsert
	// of the row with its deleted_at set.
	Upsert Op = "upsert"
	// Delete removed the row.
	Delete Op = "delete"
)

// Visibility is who a row reaches, beside its module's grant.
type Visibility string

const (
	// Shared reaches every member granted the module. It is the zero value's meaning.
	Shared Visibility = "shared"
	// Private reaches the owner alone, and the entity's redacted projection everyone with the grant
	// (D-88).
	Private Visibility = "private"
)

// Change is one row a mutation created, changed or deleted, as it reports it to the mutation spine
// (mutation.Record), which checks it against its entity's declaration and the audit event beside it.
//
// It is the record of the write, not a row of a feed: under D-93 PowerSync replicates the row itself
// from the write-ahead log, and the spine no longer writes the change feed (D-121, ADR 0018). Row is
// kept all the same, the row as the API serialises it, so that the record stays what a restored feed
// would carry, should gate G-C's fallback build PRD 03 §2's engine on it.
type Change struct {
	// Entity is the entity's registered, module-qualified name.
	Entity string
	// ID is the entity's id.
	ID uuid.UUID
	Op Op
	// Version is the row's version after the change: the version column, which touch_entity
	// increments on every update, and one past the last version of a row a Delete removed.
	Version int64
	// Row is the entity as the API serialises it, set on an Upsert and on nothing else.
	Row any
	// Visibility is Shared when empty. A Private row is its owner's.
	Visibility Visibility
	// Owner is the member a private row belongs to, and is set exactly when it is private.
	Owner uuid.UUID
}

// Check returns what is wrong with c for entity e, the entity it names: an op that is neither an
// upsert nor a delete; no version; a row on anything but an upsert, or none on one, or one that does
// not serialise, or serialises to null; a visibility that is not shared or private, a private row
// without its owner, or on an entity whose rows are never private; and an owner on a shared row.
func (c Change) Check(e Entity) error {
	var errs []error
	bad := func(format string, args ...any) { errs = append(errs, fmt.Errorf(format, args...)) }
	switch c.Op {
	case Upsert, Delete:
	default:
		bad("op %q is not upsert or delete", c.Op)
	}
	if c.ID == uuid.Nil {
		bad("no entity id")
	}
	if c.Version < 1 {
		bad("version %d is below 1", c.Version)
	}
	if (c.Op == Upsert) != (c.Row != nil) {
		bad("an upsert carries its row, and nothing else carries one")
	}
	if c.Row != nil {
		// A nil pointer passes the test above, a value, and would serialise to the JSON null.
		switch row, err := json.Marshal(c.Row); {
		case err != nil:
			bad("its row does not serialise: %v", err)
		case string(row) == "null":
			bad("its row serialises to null; an upsert carries its row")
		}
	}
	switch c.Visibility {
	case "", Shared:
		if c.Owner != uuid.Nil {
			bad("an owner on a shared row")
		}
	case Private:
		if e.Access&Owner == 0 {
			bad("a private row of %s, whose rows are never private", e.Name)
		}
		if c.Owner == uuid.Nil {
			bad("a private row without its owner")
		}
	default:
		bad("visibility %q is not shared or private", c.Visibility)
	}
	if err := errors.Join(errs...); err != nil {
		return fmt.Errorf("sync: change of %s %s: %w", c.Entity, c.ID, err)
	}
	return nil
}
