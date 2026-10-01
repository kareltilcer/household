// Package probe is a module that exists only for the tests. It stands in for a feature module
// to prove what the platform does to every one (plan items 3 and 4): the tenant middleware in
// front of its routes, the gate, the grant levels, the row-level security under its table, and
// the mutation spine and the Idempotency-Key under its writes, and the files pipeline under its
// uploads (plan item 14). Two of its handlers are wrong on purpose, as a module's handler could be:
// list reads with no WHERE clause, and create writes into whichever household its body names.
package probe

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/files"
	"github.com/kareltilcer/household/server/internal/platform/grant"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Name is the probe's module id.
const Name = "probe"

// Entity is the probe's one sync entity.
const Entity = "probe.item"

//go:embed migrations/*.sql
var migrations embed.FS

//go:embed openapi.yaml
var contract []byte

// Contract returns the probe's contract: the health probes and the reference reads the router
// always serves, and the probe's own routes.
func Contract() []byte { return contract }

// Module is the probe.
type Module struct {
	// Log records an error a handler answers 500 for, when not nil.
	Log *slog.Logger
	// Files is the pipeline the probe keeps its items' files through, nil for a probe that keeps
	// none.
	Files *files.Service
}

var (
	_ module.Module        = Module{}
	_ module.SyncSource    = Module{}
	_ module.ExportSource  = Module{}
	_ module.EraseSource   = Module{}
	_ module.StorageSource = Module{}
)

// StorageTables returns the probe's table, whose rows the usage sample counts.
func (Module) StorageTables() []string { return []string{"probe_items"} }

// Label is the label the probe gives the item id in the storage picture.
func Label(id uuid.UUID) string { return "Probe item " + id.String() }

// StorageLabels labels each item the storage picture lists.
func (Module) StorageLabels(_ context.Context, _ pgx.Tx, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	out := make(map[uuid.UUID]string, len(ids))
	for _, id := range ids {
		out[id] = Label(id)
	}
	return out, nil
}

// Name returns the probe's module id.
func (Module) Name() string { return Name }

// Migrations returns the probe's block, 99.
func (Module) Migrations() fs.FS {
	sub, err := fs.Sub(migrations, "migrations")
	if err != nil {
		panic(err)
	}
	return sub
}

// AuditActions returns the actions the probe's mutations record.
func (Module) AuditActions() []module.AuditAction {
	return []module.AuditAction{
		{Key: "probe.item.create", SummaryKey: "probe.item.create"},
		{Key: "probe.item.delete", SummaryKey: "probe.item.delete"},
	}
}

// SyncEntities returns the probe's item.
func (Module) SyncEntities() []sync.Entity {
	return []sync.Entity{{
		Name: Entity, Table: "probe_items", Policy: sync.LWWField, Access: sync.Grant,
		Creates: []string{"postProbeItems"},
	}}
}

// Export writes nothing: export is item 20's.
func (Module) Export(context.Context, uuid.UUID, io.Writer) error { return nil }

// Erase deletes nothing: erasure is item 20's.
func (Module) Erase(context.Context, uuid.UUID) error { return nil }

// RegisterRoutes registers the probe's routes.
func (m Module) RegisterRoutes(r chi.Router) {
	r.Get("/items", m.list)
	r.Post("/items", m.create)
	r.Delete("/items/{item_id}", m.remove)
	r.Post("/files", m.upload)
	r.Get("/files/{item_id}", m.link)
	r.Delete("/files/{item_id}", m.removeFile)
}

// File is a probe item that keeps a file.
type File struct {
	ID          uuid.UUID `json:"id"`
	HouseholdID uuid.UUID `json:"household_id"`
	ContentType string    `json:"content_type"`
	ByteSize    int64     `json:"byte_size"`
}

// upload makes a probe item of the file its form carries, as a module keeps a document: the item's
// id is the form's id field, and its file is private to the caller when the form's private field is
// "true". The same file sent again makes the item once.
func (m Module) upload(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := grant.Require(ctx, Name, access.Contribute); err != nil {
		m.fail(w, r, err)
		return
	}
	u, err := m.Files.Receive(w, r, files.Rules{})
	if err != nil {
		m.fail(w, r, err)
		return
	}
	defer func() { _ = u.Close() }()
	id, err := uuid.Parse(u.Fields["id"])
	if err != nil {
		m.fail(w, r, problem.Validation(problem.FieldError{Field: "/id", Code: problem.FieldMalformed}))
		return
	}
	stored, err := m.Files.Put(ctx, u, files.Target{Module: Name, Entity: id, Field: "/id"})
	if err != nil {
		m.fail(w, r, err)
		return
	}
	scope := tenant.From(ctx)
	item := Item{ID: id, HouseholdID: scope.HouseholdID()}
	_, err = mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		var version int64
		err := tx.QueryRow(ctx, "INSERT INTO probe_items (id, household_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING version",
			item.ID, item.HouseholdID).Scan(&version)
		if errors.Is(err, pgx.ErrNoRows) {
			return mutation.Record{}, nil
		}
		if err != nil {
			return mutation.Record{}, err
		}
		if err := files.Record(ctx, tx, stored, files.Attribution{Owner: scope.UserID(), Private: u.Fields["private"] == "true"}); err != nil {
			return mutation.Record{}, err
		}
		return mutation.Record{
			Event:   audit.Event{Module: Name, Action: "item.create", EntityType: Entity, EntityID: item.ID, SummaryKey: "probe.item.create"},
			Changes: []sync.Change{{Entity: Entity, ID: item.ID, Op: sync.Upsert, Version: version, Row: item}},
		}, nil
	})
	if err != nil {
		m.fail(w, r, err)
		return
	}
	m.Files.Nudge()
	httpx.WriteJSON(w, http.StatusCreated, File{ID: id, HouseholdID: item.HouseholdID, ContentType: stored.Type().MIME, ByteSize: stored.Size()})
}

// link answers a link to an item's file, its original or the variant the query names.
func (m Module) link(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(chi.URLParam(r, "item_id"))
	if err != nil {
		m.fail(w, r, problem.NotFound())
		return
	}
	variant := r.URL.Query().Get("variant")
	if variant == "" {
		variant = files.Original
	}
	link, err := m.Files.Link(ctx, Name, id, variant)
	if err != nil {
		m.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, link)
}

// removeFile deletes an item and its file, which takes Manage.
func (m Module) removeFile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := grant.Require(ctx, Name, access.Manage); err != nil {
		m.fail(w, r, err)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "item_id"))
	if err != nil {
		m.fail(w, r, problem.NotFound())
		return
	}
	_, err = mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		var version int64
		err := tx.QueryRow(ctx, "DELETE FROM probe_items WHERE id = $1 RETURNING version", id).Scan(&version)
		if errors.Is(err, pgx.ErrNoRows) {
			return mutation.Record{}, problem.NotFound()
		}
		if err != nil {
			return mutation.Record{}, err
		}
		if err := files.Remove(ctx, tx, Name, id); err != nil {
			return mutation.Record{}, err
		}
		return mutation.Record{
			Event:   audit.Event{Module: Name, Action: "item.delete", EntityType: Entity, EntityID: id, SummaryKey: "probe.item.delete"},
			Changes: []sync.Change{{Entity: Entity, ID: id, Op: sync.Delete, Version: version + 1}},
		}, nil
	})
	if err != nil {
		m.fail(w, r, err)
		return
	}
	m.Files.Nudge()
	w.WriteHeader(http.StatusNoContent)
}

// Item is one probe item.
type Item struct {
	ID          uuid.UUID `json:"id"`
	HouseholdID uuid.UUID `json:"household_id"`
}

// list answers every item it can read, and reads with no WHERE clause: row-level security is
// all that holds it to the household.
func (m Module) list(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := grant.Require(ctx, Name, access.View); err != nil {
		m.fail(w, r, err)
		return
	}
	items := []Item{}
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT id, household_id FROM probe_items ORDER BY id")
		if err != nil {
			return err
		}
		items, err = pgx.CollectRows(rows, pgx.RowToStructByPos[Item])
		return err
	})
	if err != nil {
		m.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string][]Item{"items": items})
}

// create writes the item into the household its body names, not the one in the path: a
// handler that trusts the body writes across tenants, and row-level security refuses it, and
// with it the audit event and the change the spine would have written.
func (m Module) create(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := grant.Require(ctx, Name, access.Contribute); err != nil {
		m.fail(w, r, err)
		return
	}
	var item Item
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		m.fail(w, r, problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed}))
		return
	}
	_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		var version int64
		if err := tx.QueryRow(ctx, "INSERT INTO probe_items (id, household_id) VALUES ($1, $2) RETURNING version",
			item.ID, item.HouseholdID).Scan(&version); err != nil {
			return mutation.Record{}, err
		}
		return mutation.Record{
			Event:   audit.Event{Module: Name, Action: "item.create", EntityType: Entity, EntityID: item.ID, SummaryKey: "probe.item.create"},
			Changes: []sync.Change{{Entity: Entity, ID: item.ID, Op: sync.Upsert, Version: version, Row: item}},
		}, nil
	})
	if err != nil {
		m.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, item)
}

// remove hard-deletes an item, which takes Manage.
func (m Module) remove(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := grant.Require(ctx, Name, access.Manage); err != nil {
		m.fail(w, r, err)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "item_id"))
	if err != nil {
		m.fail(w, r, problem.NotFound())
		return
	}
	_, err = mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		var version int64
		err := tx.QueryRow(ctx, "DELETE FROM probe_items WHERE id = $1 RETURNING version", id).Scan(&version)
		if errors.Is(err, pgx.ErrNoRows) {
			return mutation.Record{}, problem.NotFound()
		}
		if err != nil {
			return mutation.Record{}, err
		}
		return mutation.Record{
			Event:   audit.Event{Module: Name, Action: "item.delete", EntityType: Entity, EntityID: id, SummaryKey: "probe.item.delete"},
			Changes: []sync.Change{{Entity: Entity, ID: id, Op: sync.Delete, Version: version + 1}},
		}, nil
	})
	if err != nil {
		m.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// fail answers err's problem, or 500 for an error that is not one, which it logs.
func (m Module) fail(w http.ResponseWriter, r *http.Request, err error) {
	var p *problem.Problem
	if !errors.As(err, &p) && m.Log != nil {
		m.Log.LogAttrs(r.Context(), slog.LevelError, "probe request failed", slog.Any("error", err))
	}
	problem.Write(w, reqctx.RequestID(r.Context()), err)
}
