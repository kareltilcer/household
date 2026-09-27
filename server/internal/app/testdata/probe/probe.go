// Package probe is a module that exists only for the tests. It stands in for a feature module
// to prove what the platform does to every one (plan item 3): the tenant middleware in front of
// its routes, the gate, the grant levels, and the row-level security under its table. Two of
// its handlers are wrong on purpose, as a module's handler could be: list reads with no WHERE
// clause, and create writes into whichever household its body names.
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
	"github.com/kareltilcer/household/server/internal/platform/grant"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Name is the probe's module id.
const Name = "probe"

//go:embed migrations/*.sql
var migrations embed.FS

//go:embed openapi.yaml
var contract []byte

// Contract returns the probe's contract: the health probes the router always serves, and the
// probe's own routes.
func Contract() []byte { return contract }

// Module is the probe.
type Module struct {
	// Log records an error a handler answers 500 for, when not nil.
	Log *slog.Logger
}

var (
	_ module.Module       = Module{}
	_ module.ExportSource = Module{}
	_ module.EraseSource  = Module{}
)

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

// AuditActions returns none: the audit spine is item 4's.
func (Module) AuditActions() []module.AuditAction { return nil }

// Export writes nothing: export is item 20's.
func (Module) Export(context.Context, uuid.UUID, io.Writer) error { return nil }

// Erase deletes nothing: erasure is item 20's.
func (Module) Erase(context.Context, uuid.UUID) error { return nil }

// RegisterRoutes registers the probe's routes.
func (m Module) RegisterRoutes(r chi.Router) {
	r.Get("/items", m.list)
	r.Post("/items", m.create)
	r.Delete("/items/{item_id}", m.remove)
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
// handler that trusts the body writes across tenants, and row-level security refuses it.
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
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "INSERT INTO probe_items (id, household_id) VALUES ($1, $2)", item.ID, item.HouseholdID)
		return err
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
	var deleted int64
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, "DELETE FROM probe_items WHERE id = $1", chi.URLParam(r, "item_id"))
		deleted = tag.RowsAffected()
		return err
	})
	switch {
	case err != nil:
		m.fail(w, r, err)
	case deleted == 0:
		m.fail(w, r, problem.NotFound())
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// fail answers err's problem, or 500 for an error that is not one, which it logs.
func (m Module) fail(w http.ResponseWriter, r *http.Request, err error) {
	var p *problem.Problem
	if !errors.As(err, &p) && m.Log != nil {
		m.Log.LogAttrs(r.Context(), slog.LevelError, "probe request failed", slog.Any("error", err))
	}
	problem.Write(w, reqctx.RequestID(r.Context()), err)
}
