// Package conformance is the server half of the sync conformance suite (plan item 12,
// packages/sync/conformance, PRD 10 §4): a test module whose entities the suite's scenarios
// write, and the stand-ins the suite runs against until items 13 and 14 build the real ones.
//
// The module, conformance, declares one entity for each shape a scenario needs, across all five
// merge policies (migrations/98001_conformance.sql). It is never among the modules the server
// serves (internal/modules); the stand-in registers it, and so will the API the suite runs
// against once item 13 replaces the stand-in's push.
//
// The stand-ins (StandIn) are what the spike's harness ran against (ADR 0001): a token PowerSync
// verifies with a test key, a sign-in that names the caller, and a push at the contract's path
// that writes the module's items and their checks through the real tenant middleware, grant
// check, Idempotency-Key middleware and mutation spine. Setup gives PowerSync its replication
// role, its publication and its bucket storage. Each is replaced by the real one: the token and
// the push by item 13's, the streams by item 13's generated configuration and item 14's.
package conformance

import (
	"context"
	"embed"
	"errors"
	"io"
	"io/fs"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// Name is the module's id.
const Name = "conformance"

// The entities the stand-in's push writes.
const (
	// Item is a shopping item: lww_field.
	Item = "conformance.item"
	// ItemChecked is an item's checked state: state_set on (item_id), latest_client_time.
	ItemChecked = "conformance.item_checked"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Module is the conformance module.
type Module struct{}

var (
	_ module.Module       = Module{}
	_ module.SyncSource   = Module{}
	_ module.ExportSource = Module{}
	_ module.EraseSource  = Module{}
)

// Name returns the module's id.
func (Module) Name() string { return Name }

// Migrations returns the module's block, 98.
func (Module) Migrations() fs.FS {
	sub, err := fs.Sub(migrations, "migrations")
	if err != nil {
		panic(err)
	}
	return sub
}

// Block returns the module's migrations as the block db.Migrate applies.
func Block() (db.Block, error) {
	reg, err := module.NewRegistry(Module{})
	if err != nil {
		return db.Block{}, err
	}
	return reg.Blocks()[0], nil
}

// RegisterRoutes registers nothing: the suite writes through the push, as a client does.
func (Module) RegisterRoutes(chi.Router) {}

// AuditActions returns the actions the stand-in's push records.
func (Module) AuditActions() []module.AuditAction {
	return []module.AuditAction{
		{Key: "conformance.item.create", SummaryKey: "conformance.item.create"},
		{Key: "conformance.item.update", SummaryKey: "conformance.item.update"},
		{Key: "conformance.item.delete", SummaryKey: "conformance.item.delete"},
		{Key: "conformance.item_checked.set", SummaryKey: "conformance.item_checked.set"},
	}
}

// SyncEntities returns the module's entities: every merge policy, with the key and resolution of
// each state_set, the invariant of an additive series, a private entity with its redacted
// projection, and an audience. Every one may be written offline, since the suite exercises each
// policy's offline path (D-84 gates the modules, not the engine).
func (Module) SyncEntities() []sync.Entity {
	return []sync.Entity{
		{Name: Item, Table: "conformance_items", Policy: sync.LWWField, Access: sync.Grant, OfflineWrites: true},
		{
			Name: ItemChecked, Table: "conformance_item_checks", Policy: sync.StateSet,
			StateSet: &sync.StateSetRule{Key: []string{"item_id"}, Resolution: sync.LatestClientTime},
			Access:   sync.Grant, OfflineWrites: true,
		},
		{
			Name: "conformance.reading", Table: "conformance_readings", Policy: sync.Additive,
			Invariant: &sync.Invariant{Rule: sync.NonDecreasing, Series: []string{"meter_id"}, Order: "read_at", Field: "value"},
			Access:    sync.Grant, OfflineWrites: true,
		},
		{Name: "conformance.budget", Table: "conformance_budgets", Policy: sync.StrictVersion, Access: sync.Grant, OfflineWrites: true},
		{
			Name: "conformance.note", Table: "conformance_notes", Policy: sync.LWWRow, Access: sync.Grant | sync.Owner,
			Redact: redactNote, OfflineWrites: true,
		},
		{Name: "conformance.chore", Table: "conformance_chores", Policy: sync.StrictVersion, Access: sync.Grant, OfflineWrites: true},
		{
			Name: "conformance.completion", Table: "conformance_completions", Policy: sync.StateSet,
			StateSet: &sync.StateSetRule{Key: []string{"chore_id", "occurrence"}, Resolution: sync.LatestClientTime},
			Access:   sync.Grant, OfflineWrites: true,
		},
		{Name: "conformance.attachment", Table: "conformance_attachments", Policy: sync.LWWField, Access: sync.Grant, OfflineWrites: true},
		{Name: "conformance.conversation", Table: "conformance_conversations", Policy: sync.StrictVersion, Access: sync.Grant, OfflineWrites: true},
		{
			Name: "conformance.conversation_member", Table: "conformance_conversation_members", Policy: sync.StrictVersion,
			Access: sync.Grant, OfflineWrites: true,
		},
		{Name: "conformance.message", Table: "conformance_messages", Policy: sync.Additive, Access: sync.Grant | sync.Audience, OfflineWrites: true},
	}
}

// Note is a conformance note as the API would serialise it.
type Note struct {
	ID         uuid.UUID  `json:"id"`
	Visibility string     `json:"visibility"`
	OwnerID    *uuid.UUID `json:"owner_id"`
	Title      string     `json:"title"`
	Body       string     `json:"body"`
	Version    int64      `json:"version"`
}

// RedactedNote is what a private note shows everyone with the grant: that it exists, and whose it
// is. Under D-93 it reaches the owner as well, whose client shows the full note over it (ADR 0001).
type RedactedNote struct {
	ID      uuid.UUID  `json:"id"`
	OwnerID *uuid.UUID `json:"owner_id"`
	Version int64      `json:"version"`
}

var errNotANote = errors.New("conformance: the note's projection takes a Note")

// redactNote is the note's redacted projection.
func redactNote(row any) (any, error) {
	n, ok := row.(Note)
	if !ok {
		return nil, errNotANote
	}
	return RedactedNote{ID: n.ID, OwnerID: n.OwnerID, Version: n.Version}, nil
}

// Export writes nothing: the module holds only the suite's test rows.
func (Module) Export(context.Context, uuid.UUID, io.Writer) error { return nil }

// Erase deletes nothing: the module holds only the suite's test rows.
func (Module) Erase(context.Context, uuid.UUID) error { return nil }
