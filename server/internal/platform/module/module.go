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

// StorageSource declares the tables and object prefixes a module owns, and how its blob bytes
// are attributed (item 16).
type StorageSource interface {
	Tables() []string
	Blobs(ctx context.Context, householdID uuid.UUID) ([]BlobUsage, error)
}

// SyncSource declares the entities that replicate offline, each with its merge policy and its
// access (PRD 03 §2.5, D-24). The registry refuses an entity that declares either wrongly
// (architecture test 5), and the mutation spine a change of an entity no module declares.
type SyncSource interface{ SyncEntities() []sync.Entity }

// ReminderSource declares the date-bearing things a member may be reminded about (item 35).
type ReminderSource interface{ ReminderKinds() []ReminderKind }

// SearchSource declares what the module contributes to global search (item 36).
type SearchSource interface{ SearchScopes() []SearchScope }

// ExportSource serialises a household's data in the module (item 20). Every module
// implements it (D-6), and architecture test 3 fails one that does not.
type ExportSource interface {
	Export(ctx context.Context, householdID uuid.UUID, w io.Writer) error
}

// EraseSource deletes a household's data in the module (item 20). Every module implements it
// (D-6), and architecture test 3 fails one that does not.
type EraseSource interface {
	Erase(ctx context.Context, householdID uuid.UUID) error
}

// Widget is a dashboard widget a module contributes.
type Widget struct{ Key string }

// Metric is a named scalar value.
type Metric struct{ Key string }

// List is the itemised form of a metric.
type List struct{ Key string }

// BlobUsage is the bytes a module holds under one object prefix.
type BlobUsage struct {
	Prefix string
	Bytes  int64
}

// ReminderKind is a kind of date-bearing thing a member may be reminded about.
type ReminderKind struct{ Key string }

// SearchScope is what a module contributes to global search.
type SearchScope struct{ Key string }
