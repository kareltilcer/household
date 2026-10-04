// Package module is the contract every feature module implements (PRD 01 §4, PRD modules/00),
// and the registry of the modules compiled into the server.
//
// A module is a package under internal/modules/<name>. It imports no other module and the
// platform imports none of them (architecture test 1): what a module needs from another it
// gets through a catalog the platform owns, and what it offers the platform it declares by
// implementing the optional interfaces below. internal/modules lists the modules, and the
// server builds its Registry from that list.
package module

import (
	"context"
	"io"
	"io/fs"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/reference"
	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// Module is what every feature module implements.
type Module interface {
	// Name is the module's stable id (PRD modules/00 §1): lowercase, English, never renamed.
	// It is the path segment its routes are mounted under, the key of its enablement and its
	// grants, and the prefix of its audit actions, sync entities and translation keys.
	Name() string
	// Migrations returns the module's goose migrations, one numbered block at its root
	// (db.Block): nnSSS_description.sql, nn the block's number, which no other block uses.
	// A module that owns no tables returns nil.
	Migrations() fs.FS
	// RegisterRoutes registers the module's routes on r, with patterns relative to it. The
	// platform mounts r at /households/{household_id}/<name>, behind the tenant middleware and
	// a gate that answers 404 to a member who cannot see the module (grant.Gate). A handler
	// asks grant.Require for more than seeing, reads the database through tenant.InTx, whose
	// transactions are read-only, and writes it through the mutation spine, mutation.Apply.
	RegisterRoutes(r chi.Router)
	// AuditActions lists the actions the module's mutations record (FR-AU1). The mutation
	// spine refuses to record an action its module does not list.
	AuditActions() []AuditAction
}

// AuditAction is an action a module's mutations record in the audit spine, which the activity
// log renders and the notification composer offers.
type AuditAction struct {
	// Key names the action, qualified by its module: "<module>.<action>", as
	// "garden.planting.create", whose event records module "garden" and action
	// "planting.create".
	Key string
	// SummaryKey is the translation key the activity log renders one event of it with.
	SummaryKey string
}

// The registered catalogs (PRD 01 §4): each is how a platform capability reaches data in
// every module while importing none. A module implements the interfaces for what it has, all
// of them optional except ExportSource and EraseSource. The item that builds a catalog gives
// its descriptor what the catalog needs; until then a descriptor names its entry and nothing
// is collected.

// WidgetSource contributes dashboard widgets (item 36).
type WidgetSource interface{ Widgets() []Widget }

// MetricSource contributes named scalar values that summaries and conditions reference (item 36).
type MetricSource interface{ Metrics() []Metric }

// ListSource contributes the itemised forms of metrics (item 36).
type ListSource interface{ Lists() []List }

// StorageSource declares what a module keeps (FR-ST1, item 14): the tables it owns, whose rows the
// daily sample counts per household for fair use (FR-ST2, PRD 04 §5), each a tenant table of its own
// block, and the label the storage picture shows for each entity it keeps files for (FR-ST4), read
// in the caller's household, which may be an entity's title rather than its file's name. Its objects
// live under h/{household}/{module}/, and each is attributed to a member as the module declares when
// it records the upload and keeps current as the entity moves (files.Record, files.Attribute): only
// the module knows whose its entity is.
type StorageSource interface {
	StorageTables() []string
	StorageLabels(ctx context.Context, tx pgx.Tx, entities []uuid.UUID) (map[uuid.UUID]string, error)
}

// SyncSource declares the entities that replicate offline, each with its merge policy and its
// access (PRD 03 §2.5, D-24). The registry refuses an entity that declares either wrongly
// (architecture test 5), and the mutation spine a change of an entity no module declares.
type SyncSource interface{ SyncEntities() []sync.Entity }

// ReferenceSource declares the module's reference data (PRD 01 §2.4, ADR 0008, ADR 0023): a set of
// its own, the directory of reference-data named for the module, whose records are the module's
// and whose pipeline is the platform's. The server checks it and loads it with the platform's own
// reference data as it migrates (reference.Load), and the registry refuses a set that is not named
// for its module.
type ReferenceSource interface{ Reference() reference.Set }

// ReminderSource declares the date-bearing things a member may be reminded about (item 35).
type ReminderSource interface{ ReminderKinds() []ReminderKind }

// SearchSource declares what the module contributes to global search (item 36).
type SearchSource interface{ SearchScopes() []SearchScope }

// ExportSource writes what the module keeps of a household into an export's archive (FR-PR2, item
// 20). Every module implements it (D-6), and architecture test 3 fails one that does not. tx is a
// read-only transaction of the household, with no caller: the module reads its rows there and decides
// by e which of them the requester takes.
type ExportSource interface {
	Export(ctx context.Context, tx pgx.Tx, e Export, a Archive) error
}

// ExportScope is how much of a household an export takes.
type ExportScope string

const (
	// ExportHousehold is an owner's export of the household (FR-HA15): everything the module keeps
	// there that its requester may read, which is every shared row, their own private items and a
	// child profile's (D-19), and never another adult's private items.
	ExportHousehold ExportScope = "household"
	// ExportPersonal is a member's export of what is theirs (PRD 05 §3): what they made, and their
	// private items. The platform leaves out a module the member cannot see (PRD modules/00, absence
	// 8).
	ExportPersonal ExportScope = "personal"
	// ExportDeparted is a former member's, in the window their private data is kept for (FR-PR7):
	// their private items alone.
	ExportDeparted ExportScope = "departed"
)

// Export is one household's part of an export, as a module is asked for it.
type Export struct {
	Household uuid.UUID
	// Requester is whose export it is, and Role their role in the household, "" for one who left.
	Requester uuid.UUID
	Role      access.Role
	Scope     ExportScope
}

// Archive is where a module writes its part of an export: the household's place in the ZIP (FR-PR2).
// Every name is a slash-separated path the archive cleans, and gives a suffix when it is taken.
type Archive interface {
	// JSON writes v as the module's structured data, <module>.json, matching the API's schemas so
	// that the contract documents it. Once per export.
	JSON(v any) error
	// Create starts a human-readable derivative where a standard exists, named as PRD 05 §3 names
	// it: calendar.ics, finance-transactions.csv, notes/<title>.md. The writer is good until the next
	// call on the archive.
	Create(name string) (io.Writer, error)
	// File adds the original of the module's entity, as the files pipeline keeps it, at
	// files/<module>/<name>: the folder structure is the module's, mirroring its app's.
	File(entity uuid.UUID, name string) error
}

// EraseSource deletes what the module keeps (item 20). Every module implements it (D-6), and
// architecture test 3 fails one that does not. tx is a transaction of the household that may write,
// the platform's own, which records no audit event: erasure is no entity's history (FR-AU5).
type EraseSource interface {
	Erase(ctx context.Context, tx pgx.Tx, e Erasure) error
}

// Erasure is what a module is asked to delete.
type Erasure struct {
	Household uuid.UUID
	// Member, when set, is the member whose private data in the household goes, their private root
	// (FR-PR7, FR-PR3), with the files it keeps (files.Remove): what they made that the household
	// shares stays. When it is uuid.Nil the whole household goes: its rows leave with the household's
	// own row, which every tenant table hangs from, so a module deletes here only what that cascade
	// does not reach.
	Member uuid.UUID
}

// Widget is a dashboard widget a module contributes.
type Widget struct{ Key string }

// Metric is a named scalar value.
type Metric struct{ Key string }

// List is the itemised form of a metric.
type List struct{ Key string }

// ReminderKind is a kind of date-bearing thing a member may be reminded about.
type ReminderKind struct{ Key string }

// SearchScope is what a module contributes to global search.
type SearchScope struct{ Key string }
