// Package conformance is the server half of the sync conformance suite (plan items 12 and 13,
// packages/sync/conformance, PRD 10 §4, ADR 0013, ADR 0014): a test module whose entities the
// suite's scenarios write, registered in the API the suite runs against (cmd/conformance-api) and in
// no other.
//
// The module, conformance, declares one entity for each shape a scenario needs, across all five
// merge policies (migrations/98001_conformance.sql), private rows with their redacted projection and
// the rows a private note bounds, and an audience whose messages keep their readers on the row
// (98003). It is never among the modules the server serves (internal/modules). Its entities' streams
// are generated with every other entity's (internal/syncconfig), and the push writes every one of
// them as it writes any module's, through this module's Writer (write.go, audience.go).
//
// The suite signs its members in through Around, which stands in for a device's sign-in (item 9):
// the suite's members have no address and no password, and a client needs only an access token.
// Around serves an attachment's upload too (upload.go), which no contract operation does for a module
// the contract does not name.
package conformance

import (
	"context"
	"embed"
	"io/fs"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

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
	// Budget is an amount of money: strict_version.
	Budget = "conformance.budget"
	// Note is a note, shared or private to its owner, with a redacted projection: lww_row, its loser
	// preserved.
	Note = "conformance.note"
	// NoteComment is a comment on a note, which reaches whom its note reaches: lww_field.
	NoteComment = "conformance.note_comment"
	// Chore is a rotating chore: strict_version, its rotation advanced by the server.
	Chore = "conformance.chore"
	// Completion is a chore's completion: state_set on (chore_id, occurrence), latest_client_time.
	Completion = "conformance.completion"
	// Attachment is a file's row, whose bytes are uploaded apart: lww_field.
	Attachment = "conformance.attachment"
	// Conversation is a conversation: strict_version.
	Conversation = "conformance.conversation"
	// ConversationMember is a member of a conversation, from the floor they joined at: strict_version.
	ConversationMember = "conformance.conversation_member"
	// Message is a message in a conversation, which its readers read: additive, with an audience.
	Message = "conformance.message"
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
	for _, a := range []string{
		"item.create", "item.update", "item.delete", "item_checked.set", "reading.create", "completion.set",
		"budget.create", "budget.update", "budget.delete", "note.create", "note.update", "note.delete",
		"note_comment.create", "note_comment.update", "note_comment.delete", "chore.create", "chore.update", "chore.delete",
		"attachment.create", "attachment.update", "attachment.delete", "attachment.upload",
		"conversation.create", "conversation.update", "conversation.delete",
		"conversation_member.create", "conversation_member.delete", "message.create",
	} {
		out = append(out, module.AuditAction{Key: Name + "." + a, SummaryKey: Name + "." + a})
	}
	return out
}

// SyncEntities returns the module's entities: every merge policy, with the key and resolution of
// each state_set, the invariant of an additive series, a private entity with its redacted
// projection and the comments it bounds, and an audience. Every one may be written offline, since
// the suite exercises each policy's offline path (D-84 gates the modules, not the engine).
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
		{Name: Budget, Table: "conformance_budgets", Policy: sync.StrictVersion, Access: sync.Grant, OfflineWrites: true},
		// What a private note shows everyone with the grant: that it exists, whose it is, and whether it
		// was deleted; never its title or its body (D-88).
		{
			Name: Note, Table: "conformance_notes", Policy: sync.LWWRow, Access: sync.Grant | sync.Owner,
			Redacted: []string{"id", "household_id", "owner_id", "version", "deleted_at"}, OfflineWrites: true,
		},
		{Name: NoteComment, Table: "conformance_note_comments", Policy: sync.LWWField, Access: sync.Grant | sync.Owner, OfflineWrites: true},
		{Name: Chore, Table: "conformance_chores", Policy: sync.StrictVersion, Access: sync.Grant, OfflineWrites: true},
		{
			Name: Completion, Table: "conformance_completions", Policy: sync.StateSet,
			StateSet: &sync.StateSetRule{Key: []string{"chore_id", "occurrence"}, Resolution: sync.LatestClientTime},
			Access:   sync.Grant, OfflineWrites: true,
		},
		{Name: Attachment, Table: "conformance_attachments", Policy: sync.LWWField, Access: sync.Grant, OfflineWrites: true},
		{Name: Conversation, Table: "conformance_conversations", Policy: sync.StrictVersion, Access: sync.Grant, OfflineWrites: true},
		{
			Name: ConversationMember, Table: "conformance_conversation_members", Policy: sync.StrictVersion,
			Access: sync.Grant, OfflineWrites: true,
		},
		{Name: Message, Table: "conformance_messages", Policy: sync.Additive, Access: sync.Grant | sync.Audience, OfflineWrites: true},
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

// Export writes nothing: the module holds only the suite's test rows.
func (Module) Export(context.Context, pgx.Tx, module.Export, module.Archive) error { return nil }

// Erase deletes nothing of its own: the suite's test rows go with their household's row, and no
// member holds a private root the suite does not delete itself.
func (Module) Erase(context.Context, pgx.Tx, module.Erasure) error { return nil }
