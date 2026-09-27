// Package audit writes the audit spine (PRD 03 §1): an event for every mutation, in the
// mutation's own transaction, so that a change and its history commit or roll back together
// (FR-AU1). A module does not call it: the mutation spine (internal/platform/mutation) records
// the event a mutation reports, with the actor and the request's details taken from the
// context, where a handler cannot forge them.
package audit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/idgen"
)

// ActorType is who caused an event. It is extensible: the schema's enum takes a new value with
// ALTER TYPE, as an AI assistant's would (future/ai-assistant).
type ActorType string

const (
	// User is a member acting through a client.
	User ActorType = "user"
	// System is the platform acting on its own, a scheduled job for instance.
	System ActorType = "system"
	// Service is an integration acting on the household's behalf.
	Service ActorType = "service"
)

// Actor is who caused an event.
type Actor struct {
	Type ActorType
	// ID is the user, for a User actor; the zero UUID otherwise.
	ID uuid.UUID
	// Label is the actor's name as the event was written, so that the log reads after they
	// leave; "" until accounts have names (item 8).
	Label string
}

// Level is how much an event matters to the reader.
type Level string

const (
	Info   Level = "info"
	Notice Level = "notice"
	Warn   Level = "warn"
)

// Visibility is whether an event is about a private item, which is redacted on read for
// everyone but its owner (FR-AU4).
type Visibility string

const (
	// Shared is the zero value's meaning.
	Shared  Visibility = "shared"
	Private Visibility = "private"
)

// Via is how a change arrived (the contract's Via), recorded in the event's meta so that "did
// I do this on my phone, or did the importer?" has an answer. The set is open: meta is JSON,
// and a new front door adds a value without a migration (future/ai-assistant).
type Via string

const (
	ViaWeb       Via = "web"
	ViaMobile    Via = "mobile"
	ViaDashboard Via = "dashboard"
	ViaSync      Via = "sync"
	ViaImport    Via = "import"
	ViaSystem    Via = "system"
)

// Event is what a mutation records about itself.
type Event struct {
	// Module is the module the event belongs to, and Action what happened, unqualified: module
	// "garden" and action "planting.create" make the key "garden.planting.create", which the
	// module declares among its AuditActions.
	Module string
	Action string
	// EntityType and EntityID name the entity the event is about, for its timeline; both empty
	// for an event about none. EntityType is module-qualified, as a sync entity's name.
	EntityType string
	EntityID   uuid.UUID
	// Level is Info when empty.
	Level Level
	// SummaryKey is the translation key the log renders the event with, in the reader's
	// language, and SummaryArgs its arguments (FR-AU3). Never a rendered sentence.
	SummaryKey  string
	SummaryArgs map[string]any
	// Visibility is Shared when empty; a Private event names its Owner.
	Visibility Visibility
	Owner      uuid.UUID
	// Meta is module-specific context. The platform's keys, via and request_id, are added to
	// it and cannot be set here.
	Meta map[string]any
	// Changes are the field diffs of an entity whose history is the question the log answers
	// (FR-AU2): every money-bearing row, every tariff, every permission and membership change,
	// and the entities each module nominates.
	Changes []Change
}

// Change is one field's value before and after. Old or New is nil, or a nil pointer, where the
// field had no value, and is stored as NULL; any other value is stored as the JSON it
// serialises to.
type Change struct {
	Field string
	Old   any
	New   any
}

// The meta keys the platform writes.
const (
	MetaVia       = "via"
	MetaRequestID = "request_id"
)

var action = regexp.MustCompile(`^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$`)

// Check returns what is wrong with e as an event to record: no module; an action that is not
// lowercase words joined by dots; no summary key; a level that is not one of the three; an
// entity type without an id, or the reverse, or one another module's; a private event without
// its owner, or an owner on a shared one; a meta key the platform writes; a diff of no field,
// or of one field twice.
func (e Event) Check() error {
	var errs []error
	bad := func(format string, args ...any) { errs = append(errs, fmt.Errorf(format, args...)) }
	if e.Module == "" {
		bad("no module")
	}
	if !action.MatchString(e.Action) {
		bad("action %q is not lowercase words joined by dots", e.Action)
	}
	if e.SummaryKey == "" {
		bad("no summary key")
	}
	switch e.Level {
	case "", Info, Notice, Warn:
	default:
		bad("level %q is not info, notice or warn", e.Level)
	}
	switch {
	case (e.EntityType == "") != (e.EntityID == uuid.Nil):
		bad("an entity type without its id, or an id without its type")
	case e.EntityType != "" && !strings.HasPrefix(e.EntityType, e.Module+"."):
		bad("entity type %q is not module %s's", e.EntityType, e.Module)
	}
	switch e.Visibility {
	case "", Shared:
		if e.Owner != uuid.Nil {
			bad("an owner on a shared event")
		}
	case Private:
		if e.Owner == uuid.Nil {
			bad("a private event without its owner")
		}
	default:
		bad("visibility %q is not shared or private", e.Visibility)
	}
	for _, key := range []string{MetaVia, MetaRequestID} {
		if _, ok := e.Meta[key]; ok {
			bad("meta key %q is the platform's to write", key)
		}
	}
	fields := map[string]bool{}
	for _, c := range e.Changes {
		if c.Field == "" || fields[c.Field] {
			bad("a diff of field %q, which is empty or diffed twice", c.Field)
		}
		fields[c.Field] = true
	}
	if err := errors.Join(errs...); err != nil {
		return fmt.Errorf("audit: event %s.%s: %w", e.Module, e.Action, err)
	}
	return nil
}

// Record writes e, and its diffs, to household's audit log in tx, a transaction of that
// household, and returns the event's id. The caller has checked e (Check). actor is who caused
// it, via how it arrived, and requestID the request it arrived in, "" for none. A failure is
// returned as it is, so the caller's transaction rolls back: a change that commits with no
// history is the one thing the spine exists to prevent.
func Record(ctx context.Context, tx pgx.Tx, household uuid.UUID, actor Actor, via Via, requestID string, e Event) (uuid.UUID, error) {
	meta := make(map[string]any, len(e.Meta)+2)
	for k, v := range e.Meta {
		meta[k] = v
	}
	meta[MetaVia] = via
	if requestID != "" {
		meta[MetaRequestID] = requestID
	}
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		return uuid.Nil, fmt.Errorf("audit: serialise the meta of %s.%s: %w", e.Module, e.Action, err)
	}
	args := e.SummaryArgs
	if args == nil {
		args = map[string]any{}
	}
	argsJSON, err := json.Marshal(args)
	if err != nil {
		return uuid.Nil, fmt.Errorf("audit: serialise the summary arguments of %s.%s: %w", e.Module, e.Action, err)
	}
	level, visibility := e.Level, e.Visibility
	if level == "" {
		level = Info
	}
	if visibility == "" {
		visibility = Shared
	}
	var entityType any
	if e.EntityType != "" {
		entityType = e.EntityType
	}
	var label any
	if actor.Label != "" {
		label = actor.Label
	}

	id := idgen.New()
	batch := &pgx.Batch{}
	batch.Queue(`
		INSERT INTO audit_events
		  (id, household_id, actor_type, actor_id, actor_label, module, action, entity_type, entity_id,
		   level, summary_key, summary_args, visibility, owner_id, meta)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
		id, household, string(actor.Type), nullUUID(actor.ID), label, e.Module, e.Action, entityType, nullUUID(e.EntityID),
		string(level), e.SummaryKey, argsJSON, string(visibility), nullUUID(e.Owner), metaJSON)
	for _, c := range e.Changes {
		oldJSON, err := value(c.Old)
		if err != nil {
			return uuid.Nil, fmt.Errorf("audit: serialise the old %s of %s.%s: %w", c.Field, e.Module, e.Action, err)
		}
		newJSON, err := value(c.New)
		if err != nil {
			return uuid.Nil, fmt.Errorf("audit: serialise the new %s of %s.%s: %w", c.Field, e.Module, e.Action, err)
		}
		batch.Queue(`INSERT INTO audit_changes (household_id, event_id, field, old_value, new_value) VALUES ($1, $2, $3, $4, $5)`,
			household, id, c.Field, oldJSON, newJSON)
	}
	if err := tx.SendBatch(ctx, batch).Close(); err != nil {
		return uuid.Nil, fmt.Errorf("audit: write the event %s.%s: %w", e.Module, e.Action, err)
	}
	return id, nil
}

// value is v as JSON, or NULL for a value that serialises to null, a nil pointer as well as
// nil: a field with no value is NULL however the mutation spelled it.
func value(v any) (any, error) {
	if v == nil {
		return nil, nil
	}
	data, err := json.Marshal(v)
	if err != nil || string(data) == "null" {
		return nil, err
	}
	return data, nil
}

// nullUUID is id, or NULL for the zero UUID.
func nullUUID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}
