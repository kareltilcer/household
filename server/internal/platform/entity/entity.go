// Package entity is the Go side of the base columns every household entity carries (PRD 01
// §3, D-23, D-82), which a module's migration adds with add_entity_columns: the
// client-generated UUIDv7 id, the tenant key, the version the sync engine and If-Match compare,
// who created and last changed the row and when, and the soft-delete tombstone.
package entity

import (
	"time"

	"github.com/google/uuid"
)

// Columns are the base columns, in the order Base.Targets scans them, for a module's SELECT
// list: "SELECT " + entity.Columns + ", title FROM tasks_cards".
const Columns = "id, household_id, version, created_by, created_at, updated_by, updated_at, deleted_at"

// Base is the base columns of one row.
type Base struct {
	ID          uuid.UUID
	HouseholdID uuid.UUID
	// Version starts at 1 and grows by one on every update (touch_entity): the row's ETag, and
	// the row_version of its change in the feed.
	Version int64
	// CreatedBy and UpdatedBy are the member in the writing transaction's context, nil for the
	// system.
	CreatedBy *uuid.UUID
	CreatedAt time.Time
	UpdatedBy *uuid.UUID
	UpdatedAt time.Time
	// DeletedAt is set on a row that is soft-deleted: a tombstone the feed carries to every
	// replica.
	DeletedAt *time.Time
}

// Targets returns pointers to b's fields in the order of Columns, for a row's Scan:
// row.Scan(append(b.Targets(), &title)...).
func (b *Base) Targets() []any {
	return []any{&b.ID, &b.HouseholdID, &b.Version, &b.CreatedBy, &b.CreatedAt, &b.UpdatedBy, &b.UpdatedAt, &b.DeletedAt}
}

// Deleted reports whether the row is soft-deleted.
func (b Base) Deleted() bool { return b.DeletedAt != nil }
