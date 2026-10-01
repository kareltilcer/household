package sync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/db"
)

// Op is what a change does to an entity on a replica.
type Op string

const (
	// Upsert writes the row the change carries.
	Upsert Op = "upsert"
	// Delete removes the row. A soft delete, which keeps a tombstone, is an Upsert of the row
	// with its deleted_at set.
	Delete Op = "delete"
	// Retract tells one member to drop a row they may no longer see (FR-SY7).
	Retract Op = "retract"
)

// Visibility is who a change reaches, beside its module's grant.
type Visibility string

const (
	// Shared reaches every member granted the module. It is the zero value's meaning.
	Shared Visibility = "shared"
	// Private reaches the owner alone.
	Private Visibility = "private"
)

// Change is one row of the change feed, as a mutation reports it: one entity it created,
// changed or deleted, or, for a retraction, one member who may no longer see it.
type Change struct {
	// Entity is the entity's registered, module-qualified name.
	Entity string
	// ID is the entity's id.
	ID uuid.UUID
	Op Op
	// Version is the row's version after the change: the version column, which touch_entity
	// increments on every update, and one past the last version of a row a Delete removed, so
	// that the delete orders after every write a replica holds. Zero only on a retraction.
	Version int64
	// Row is the entity as the API serialises it, set on an Upsert and on nothing else.
	Row any
	// Visibility is Shared when empty. A Private change is the owner's; the redacted rows that
	// stand in for it for everyone else are the platform's to write, from the entity's own
	// projection (item 17).
	Visibility Visibility
	// Owner is the member a private row belongs to, and is set exactly when it is private.
	Owner uuid.UUID
	// Audience is the member list the row belongs to, for an entity that declares Audience; the
	// zero UUID for none.
	Audience uuid.UUID
	// ForUser is the member a retraction is addressed to, and is set exactly on one.
	ForUser uuid.UUID
}

// Check returns what is wrong with c for entity e, the entity it names: an op that is not one
// of the three; a version on a retraction, or none on anything else; a row on anything but an
// upsert, or none on one; a visibility that is not shared or private, a private row without its
// owner, or on an entity whose rows are never private; an owner on a shared row; an audience on
// an entity that has none; and a recipient on anything but a retraction, or none on one.
func (c Change) Check(e Entity) error {
	var errs []error
	bad := func(format string, args ...any) { errs = append(errs, fmt.Errorf(format, args...)) }
	switch c.Op {
	case Upsert, Delete, Retract:
	default:
		bad("op %q is not upsert, delete or retract", c.Op)
	}
	if c.ID == uuid.Nil {
		bad("no entity id")
	}
	if (c.Op == Retract) != (c.Version == 0) {
		bad("a retraction carries no version, and every other change the row's")
	}
	if c.Version < 0 {
		bad("version %d is below 1", c.Version)
	}
	if (c.Op == Upsert) != (c.Row != nil) {
		bad("an upsert carries its row, and nothing else carries one")
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
	if c.Audience != uuid.Nil && e.Access&Audience == 0 {
		bad("an audience on a row of %s, which declares none", e.Name)
	}
	if (c.Op == Retract) != (c.ForUser != uuid.Nil) {
		bad("a retraction is addressed to one member, and nothing else is")
	}
	if err := errors.Join(errs...); err != nil {
		return fmt.Errorf("sync: change of %s %s: %w", c.Entity, c.ID, err)
	}
	return nil
}

// feedLock is the namespace of the household feed locks, the first key of the two-key advisory
// lock whose second is the household's hash.
const feedLock = db.FeedLock

// Emit writes changes to household's feed in tx, a transaction of that household, and returns
// the seq of the last. The caller has checked each against its entity (Check). actor is who
// caused them, the zero UUID for the system.
//
// It first takes the household's feed lock, which it holds until tx ends. seq is drawn from a
// sequence when a row is inserted and becomes visible when its transaction commits, and those
// two orders differ between concurrent transactions: without the lock a pull could read seq 101
// before seq 100 committed, advance its cursor past 100, and never see it. Under the lock a
// household's transactions draw their seqs and commit one at a time, so the household's rows
// become visible in seq order. The lock is taken as late as it can be, after everything else the
// transaction writes, and is held only for the feed's inserts and the commit: the caller takes
// no row lock after Emit, since another transaction of the household may hold that row while it
// waits for this lock. Emit's own inserts take the key-share locks their foreign keys need on the
// household's row and the module's, and must not wait for them under the lock either, since a
// mutation may hold the household's row FOR UPDATE while it waits for the lock: the caller holds
// them already. The mutation spine does, through the audit event it writes first, whose
// foreign keys name the same two rows; a caller that emits without one locks both rows FOR KEY
// SHARE before it calls Emit. Two households whose hashes collide share a lock, which serialises
// them and costs nothing else.
func Emit(ctx context.Context, tx pgx.Tx, household, actor uuid.UUID, changes []Change) (int64, error) {
	if len(changes) == 0 {
		return 0, errors.New("sync: no changes to emit")
	}
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1, hashtext($2::text))", feedLock, household); err != nil {
		return 0, fmt.Errorf("sync: take the feed lock: %w", err)
	}
	batch := &pgx.Batch{}
	for _, c := range changes {
		var payload []byte
		if c.Row != nil {
			var err error
			if payload, err = json.Marshal(c.Row); err != nil {
				return 0, fmt.Errorf("sync: serialise %s %s: %w", c.Entity, c.ID, err)
			}
			// A nil pointer in Row passes Check, which sees a value, and serialises to the JSON
			// null, which the feed's check takes for a payload: a replica would upsert nothing.
			if string(payload) == "null" {
				return 0, fmt.Errorf("sync: the row of %s %s serialises to null; an upsert carries its row", c.Entity, c.ID)
			}
		}
		visibility := c.Visibility
		if visibility == "" {
			visibility = Shared
		}
		module, _, _ := strings.Cut(c.Entity, ".")
		batch.Queue(`
			INSERT INTO sync_changes
			  (household_id, entity_type, entity_id, op, row_version, actor_id, module, visibility, owner_id, audience_id, for_user_id, payload)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			RETURNING seq`,
			household, c.Entity, c.ID, string(c.Op), nullVersion(c.Version), nullUUID(actor), module, string(visibility),
			nullUUID(c.Owner), nullUUID(c.Audience), nullUUID(c.ForUser), payload)
	}
	results := tx.SendBatch(ctx, batch)
	var seq int64
	for _, c := range changes {
		if err := results.QueryRow().Scan(&seq); err != nil {
			_ = results.Close()
			return 0, fmt.Errorf("sync: write the change of %s %s: %w", c.Entity, c.ID, err)
		}
	}
	if err := results.Close(); err != nil {
		return 0, fmt.Errorf("sync: write the changes: %w", err)
	}
	return seq, nil
}

// nullUUID is id, or NULL for the zero UUID.
func nullUUID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

// nullVersion is v, or NULL for a retraction's zero.
func nullVersion(v int64) any {
	if v == 0 {
		return nil
	}
	return v
}
