// Package conformance is the server half of the sync conformance suite (plan items 12 and 13,
// packages/sync/conformance, PRD 10 §4, ADR 0013, ADR 0014): a test module whose entities the
// suite's scenarios write, registered in the API the suite runs against (cmd/conformance-api) and in
// no other.
//
// The module, conformance, declares one entity for each shape a scenario needs, across all five
// merge policies (migrations/98001_conformance.sql). It is never among the modules the server
// serves (internal/modules). Its entities' streams are generated with every other entity's
// (internal/syncconfig), and the push writes them as it writes any module's, through this module's
// Writer: the entities whose policies item 13 builds, an item's fields (lww_field), its checked
// state and a chore's completion (state_set) and a meter's readings (additive, with their
// invariant). The others are item 17's.
//
// The suite signs its members in through Around, which stands in for a device's sign-in (item 9):
// the suite's members have no address and no password, and a client needs only an access token.
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
	"github.com/kareltilcer/household/server/internal/platform/push"
	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// Name is the module's id.
const Name = "conformance"

// The entities the push writes.
const (
	// Item is a shopping item: lww_field.
	Item = "conformance.item"
	// ItemChecked is an item's checked state: state_set on (item_id), latest_client_time.
	ItemChecked = "conformance.item_checked"
	// Reading is a meter reading: additive, non_decreasing over its meter.
	Reading = "conformance.reading"
	// Completion is a chore's completion: state_set on (chore_id, occurrence), latest_client_time.
	Completion = "conformance.completion"
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
	_ push.Writer         = Module{}
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

// AuditActions returns the actions the module's writes record.
func (Module) AuditActions() []module.AuditAction {
	var out []module.AuditAction
	for _, a := range []string{"item.create", "item.update", "item.delete", "item_checked.set", "reading.create", "completion.set"} {
		out = append(out, module.AuditAction{Key: Name + "." + a, SummaryKey: Name + "." + a})
	}
	return out
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
			Name: Reading, Table: "conformance_readings", Policy: sync.Additive,
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
			Name: Completion, Table: "conformance_completions", Policy: sync.StateSet,
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

// LeakyStream is a stream broken on purpose, for the suite's negative control
// (packages/sync/conformance/suite/harness.test.ts): it holds a member to the households they belong
// to but not to the one they subscribed with, and checks no grant, so a member of two households
// replicates the other's items into this one's replica. No client but the negative control's
// subscribes to it, and the suite must fail it.
func LeakyStream() sync.Stream {
	return sync.Stream{
		Name: "negative_control_leaky_items", Entity: Item, Table: "conformance_items",
		Reads: []string{"conformance_items", "memberships"},
		Query: "SELECT * FROM conformance_items\n" +
			"WHERE household_id IN (SELECT m.household_id FROM memberships m WHERE m.user_id = auth.user_id())\n",
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
