package household

import (
	"context"
	"errors"
	"net/http"
	"slices"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// enablement is whether a household enables one module (PRD 01 §5), its admin.module_enablement row.
type enablement struct {
	id      uuid.UUID
	module  string
	enabled bool
	version int64
}

// enablementRow is an enablement as its sync row carries it.
type enablementRow struct {
	ID      uuid.UUID `json:"id"`
	Module  string    `json:"module"`
	Enabled bool      `json:"enabled"`
	Version int64     `json:"version"`
}

// insert writes e in household and returns its version.
func (e enablement) insert(ctx context.Context, tx pgx.Tx, household uuid.UUID) (int64, error) {
	var version int64
	err := tx.QueryRow(ctx, `
		INSERT INTO module_enablement (id, household_id, module, enabled) VALUES ($1, $2, $3, $4) RETURNING version`,
		e.id, household, e.module, e.enabled).Scan(&version)
	return version, err
}

// change is the sync change of e, as it stands after a mutation.
func (e enablement) change() sync.Change {
	return sync.Change{
		Entity: entityModule, ID: e.id, Op: sync.Upsert, Version: e.version,
		Row: enablementRow{ID: e.id, Module: e.module, Enabled: e.enabled, Version: e.version},
	}
}

// moduleState is the contract's ModuleState. No module's setup (FR-HA9) is known here yet, nor what
// it counts.
type moduleState struct {
	Module      string       `json:"module"`
	Enabled     bool         `json:"enabled"`
	MyLevel     access.Level `json:"my_level"`
	NeedsSetup  bool         `json:"needs_setup"`
	EntityCount *int64       `json:"entity_count"`
}

// listModules lists every module, whether the household enables it and the caller's level on it,
// which every member reads: it is what their app is made of.
func (s *Service) listModules(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	var items []moduleState
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		modules := Modules
		enabled, err := enabledModules(ctx, tx, scope.HouseholdID())
		if err != nil {
			return err
		}
		items = make([]moduleState, 0, len(modules))
		for _, m := range modules {
			items = append(items, moduleState{Module: m, Enabled: enabled[m], MyLevel: scope.Level(m)})
		}
		return nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

// moduleUpdate is the body of a module's enablement.
type moduleUpdate struct {
	Enabled bool `json:"enabled"`
}

// updateModule enables or disables a module for the whole household (FR-HA8), an owner's to do.
// Disabling answers its routes 404 from the next request and retracts it from every replica that held
// it (Hooks.Lost), and keeps its data, which enabling it again restores. Household settings is
// granted and never disabled, since an owner who disabled it could not enable it again; enabling it,
// which it is, changes nothing.
func (s *Service) updateModule(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if err := owner(ctx); err != nil {
		s.fail(w, r, err)
		return
	}
	module := chi.URLParam(r, "module")
	var req moduleUpdate
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	if module == Name && !req.Enabled {
		s.fail(w, r, forbidden())
		return
	}
	household := scope.HouseholdID()
	var e enablement
	if !slices.Contains(Modules, module) {
		s.fail(w, r, problem.NotFound())
		return
	}
	_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		// Under the household's lock, as a change of a member's grants is: who loses access depends
		// on both the grants and the modules, and under one lock the second of two such changes reads
		// the first once it has committed, so that a module enabled while a grant on it is lowered
		// cannot leave each change reading the other's old state and neither retracting.
		if _, err := lockAsOwner(ctx, tx); err != nil {
			return mutation.Record{}, err
		}
		err := tx.QueryRow(ctx, `
			SELECT id, module, enabled, version FROM module_enablement WHERE household_id = $1 AND module = $2 FOR UPDATE`,
			household, module).Scan(&e.id, &e.module, &e.enabled, &e.version)
		was := e.enabled
		switch {
		case errors.Is(err, pgx.ErrNoRows) && !req.Enabled:
			// A module the household has no row for is disabled (PRD 01 §5) already.
			e = enablement{module: module}
			return mutation.Record{}, nil
		case errors.Is(err, pgx.ErrNoRows):
			// It gets its row once it is enabled.
			e = enablement{id: idgen.New(), module: module, enabled: true}
			if e.version, err = e.insert(ctx, tx, household); err != nil {
				return mutation.Record{}, err
			}
		case err != nil:
			return mutation.Record{}, err
		case e.enabled == req.Enabled:
			return mutation.Record{}, nil
		default:
			e.enabled = req.Enabled
			if err := tx.QueryRow(ctx, "UPDATE module_enablement SET enabled = $2 WHERE id = $1 RETURNING version",
				e.id, e.enabled).Scan(&e.version); err != nil {
				return mutation.Record{}, err
			}
		}
		if was && !e.enabled {
			if err := s.disabled(ctx, tx, household, module); err != nil {
				return mutation.Record{}, err
			}
		}
		action := actionModuleEnable
		if !e.enabled {
			action = actionModuleDisable
		}
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: action, EntityType: entityModule, EntityID: e.id,
				SummaryKey: Name + "." + action, SummaryArgs: map[string]any{"module": module},
				Changes: []audit.Change{{Field: "enabled", Old: was, New: e.enabled}},
			},
			Changes: []sync.Change{e.change()},
		}, nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	// The owner's level as their next request finds it: Manage on a module the household enables, and
	// none on one whose flag is off for it, which enabling does not serve (D-146).
	level := access.None
	if e.enabled && !scope.Dark(module) {
		level = access.Manage
	}
	httpx.WriteJSON(w, http.StatusOK, moduleState{Module: module, Enabled: e.enabled, MyLevel: level})
}

// disabled runs the Lost hook for module, which household no longer enables, for every member who
// could see it.
func (s *Service) disabled(ctx context.Context, tx pgx.Tx, household uuid.UUID, module string) error {
	members, err := readMemberships(ctx, tx, household, nil, false)
	if err != nil {
		return err
	}
	loss := Loss{Household: household, Cause: CauseModule, Members: map[uuid.UUID][]string{}}
	for _, m := range members {
		if tenant.Effective(m.role, module, true, m.grants[module]) >= access.View {
			loss.Members[m.user] = []string{module}
		}
	}
	return s.Hooks.lost(ctx, tx, loss)
}
