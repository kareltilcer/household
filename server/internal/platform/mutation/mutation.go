// Package mutation is the mutation spine (PRD 01 §3, PRD 03 §1, §2.2): the one service-layer
// entry point every write goes through, from a REST handler, from the sync engine's push (item
// 13) and from any later front door alike (future/ai-assistant). Apply runs a mutation's own
// writes and, in the same transaction, records its audit event (FR-AU1) and writes its changes
// to the household's feed (FR-SY1), so that the three commit or roll back together.
//
// It is the only way to write. tenant.InTx, through which a handler reads, is read-only, so
// PostgreSQL refuses a write there; Apply's transaction may write, and refuses to commit one
// that wrote without an audit event and a change; and architecture test 4 fails a module that
// opens a write transaction of its own (tenant.InWriteTx).
package mutation

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Record is what a mutation did: the audit event it records and the changes it emits, one per
// entity row it created, changed or deleted.
type Record struct {
	Event   audit.Event
	Changes []sync.Change
}

// Result is what a committed mutation wrote.
type Result struct {
	// EventID is its audit event's id.
	EventID uuid.UUID
	// Seq is the feed seq of its last change.
	Seq int64
}

var (
	// ErrUnrecorded is Apply's answer to a mutation that wrote without reporting both an audit
	// event and a change, or reported one without the other. Its transaction is rolled back.
	ErrUnrecorded = errors.New("mutation: a mutation must record an audit event and at least one change")
	// ErrNoCatalog is Apply's answer outside a context that carries the module registry: a bug
	// in the caller, since the router carries it into every household-scoped request.
	ErrNoCatalog = errors.New("mutation: no module registry in this context")
	// ErrNoVia is Apply's answer outside a context that says how the change arrived: a bug in
	// the front door that let it in, which knows (WithVia).
	ErrNoVia = errors.New("mutation: no via in this context")
)

type (
	catalogKey struct{}
	viaKey     struct{}
	hookKey    struct{}
)

// WithCatalog returns ctx carrying reg, whose modules declare the audit actions and the sync
// entities a mutation may record.
func WithCatalog(ctx context.Context, reg *module.Registry) context.Context {
	return context.WithValue(ctx, catalogKey{}, reg)
}

// Catalog is the middleware that carries reg into every request it serves (WithCatalog).
func Catalog(reg *module.Registry) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(WithCatalog(r.Context(), reg)))
		})
	}
}

// WithVia returns ctx recording that its changes arrive via via: the front door that lets a
// request in says so, web or mobile from the credential (items 8 and 9), sync from the push
// (item 13), system from a job.
func WithVia(ctx context.Context, via audit.Via) context.Context {
	return context.WithValue(ctx, viaKey{}, via)
}

// Apply runs fn in a transaction of ctx's household that may write, then records the audit
// event and writes the changes fn reports, and commits: all of it or none of it. fn's error, a
// problem for instance, is returned as it is, after the rollback.
//
// The actor is the caller in ctx's tenant scope, the system when it has none, and the audit
// event records how the change arrived (WithVia) and the request it arrived in. The event's
// action must be one its module declares, and each change must name an entity of that module,
// consistent with the entity's declared access (sync.Change.Check).
//
// A mutation that wrote nothing and reports nothing commits nothing and returns a zero Result:
// a request that asked for a change already in place. One that wrote without reporting an
// event and a change, or reported one without the other, returns ErrUnrecorded. When ctx's
// request holds an Idempotency-Key, the key is marked committed in the same transaction
// (idempotency.Commit).
func Apply(ctx context.Context, fn func(tx pgx.Tx) (Record, error)) (Result, error) {
	reg, _ := ctx.Value(catalogKey{}).(*module.Registry)
	if reg == nil {
		return Result{}, ErrNoCatalog
	}
	via, _ := ctx.Value(viaKey{}).(audit.Via)
	if via == "" {
		return Result{}, ErrNoVia
	}
	scope := tenant.From(ctx)
	if scope == nil {
		return Result{}, tenant.ErrNoTenant
	}
	actor := audit.Actor{Type: audit.System}
	if user := scope.UserID(); user != uuid.Nil {
		actor = audit.Actor{Type: audit.User, ID: user}
	}

	var res Result
	err := tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		rec, err := fn(tx)
		if err != nil {
			return err
		}
		// PostgreSQL assigns a transaction an id at its first write, and never to one that only
		// read: this is whether fn wrote, whatever it wrote with.
		var wrote bool
		if err := tx.QueryRow(ctx, "SELECT pg_current_xact_id_if_assigned() IS NOT NULL").Scan(&wrote); err != nil {
			return err
		}
		if rec.Event.Module == "" && rec.Event.Action == "" && len(rec.Changes) == 0 {
			if wrote {
				return ErrUnrecorded
			}
			return nil
		}
		if err := check(reg, rec); err != nil {
			return err
		}
		household := scope.HouseholdID()
		if res.EventID, err = audit.Record(ctx, tx, household, actor, via, reqctx.RequestID(ctx), rec.Event); err != nil {
			return err
		}
		if res.Seq, err = sync.Emit(ctx, tx, household, actor.ID, rec.Changes); err != nil {
			return err
		}
		if err := idempotency.Commit(ctx, tx); err != nil {
			return err
		}
		if hook, ok := ctx.Value(hookKey{}).(func()); ok {
			hook()
		}
		return nil
	})
	if err != nil {
		return Result{}, err
	}
	return res, nil
}

// check returns what makes rec unrecordable: an incomplete record, an event its module does
// not declare, or a change of an entity the event's module does not declare or inconsistent
// with it.
func check(reg *module.Registry, rec Record) error {
	if rec.Event.Module == "" || len(rec.Changes) == 0 {
		return ErrUnrecorded
	}
	if err := rec.Event.Check(); err != nil {
		return err
	}
	key := rec.Event.Module + "." + rec.Event.Action
	if _, ok := reg.Action(key); !ok {
		return fmt.Errorf("mutation: audit action %s is not one its module declares", key)
	}
	for _, c := range rec.Changes {
		e, ok := reg.Entity(c.Entity)
		switch {
		case !ok:
			return fmt.Errorf("mutation: a change of %s, which no module declares as a sync entity", c.Entity)
		case e.Module() != rec.Event.Module:
			return fmt.Errorf("mutation: a change of %s in a mutation of module %s", c.Entity, rec.Event.Module)
		}
		if err := c.Check(e); err != nil {
			return err
		}
	}
	return nil
}
