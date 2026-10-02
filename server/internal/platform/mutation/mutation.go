// Package mutation is the mutation spine (PRD 01 §3, PRD 03 §1, §2.2): the one service-layer
// entry point every write goes through, from a REST handler, from the sync engine's push (item
// 13) and from any later front door alike (future/ai-assistant). Apply runs a mutation's own
// writes and, in the same transaction, records its audit event (FR-AU1) and writes its changes
// to the household's feed (FR-SY1), so that the three commit or roll back together.
//
// It is the only way to write. tenant.InTx, through which a handler reads, is read-only, so
// PostgreSQL refuses a write there; Apply's transaction may write, and commits only what it
// records, rolling back a mutation that reports nothing; and architecture test 4 fails a module
// that opens a write transaction of its own (tenant.InWriteTx).
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
	// ErrUnrecorded is Apply's answer to a mutation that reports an audit event without a
	// change, or a change without an event. Its transaction is rolled back.
	ErrUnrecorded = errors.New("mutation: a mutation must record an audit event and at least one change")
	// ErrNoCatalog is Apply's answer outside a context that carries the module registry: a bug
	// in the caller, since the router carries it into every household-scoped request.
	ErrNoCatalog = errors.New("mutation: no module registry in this context")
	// ErrNoVia is Apply's answer outside a context that says how the change arrived: a bug in
	// the front door that let it in, which knows (WithVia).
	ErrNoVia = errors.New("mutation: no via in this context")
)

// errNothing rolls back the transaction of a mutation that reports nothing.
var errNothing = errors.New("mutation: nothing to record")

type (
	catalogKey struct{}
	viaKey     struct{}
	hookKey    struct{}
	ceilingKey struct{}
)

// Ceiling refuses a mutation of module that creates creates rows in household, read in tx, when they
// would take the module past the rows it may hold (fair use, PRD 04 §5), with the problem that
// answers it, and returns nil otherwise.
type Ceiling func(ctx context.Context, tx pgx.Tx, household uuid.UUID, module string, creates int64) error

// WithCeiling returns ctx carrying c, which Apply asks of every mutation that creates rows.
func WithCeiling(ctx context.Context, c Ceiling) context.Context {
	return context.WithValue(ctx, ceilingKey{}, c)
}

// Ceilings is the middleware that carries c into every request it serves (WithCeiling): the front
// doors members write through, REST and the push alike. The system's own writes, a job's, carry
// none, and are held to no ceiling.
func Ceilings(c Ceiling) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(WithCeiling(r.Context(), c)))
		})
	}
}

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
// The actor is the caller in ctx's tenant scope, labelled with their display name as it is when
// the event is written, or the system when the scope has no caller, and the audit event records
// how the change arrived (WithVia) and the request it arrived in. The event's
// action must be one its module declares, and each change must name an entity of that module,
// consistent with the entity's declared access (sync.Change.Check); an event with a private
// change is private to that change's owner.
//
// A mutation that creates rows, each an upsert of a row at its first version, is checked against the
// ceiling ctx carries (WithCeiling), and refused with its problem, rolled back.
//
// A mutation that reports nothing, a request for a change already in place, is rolled back,
// whatever it did, and Apply returns a zero Result: Apply commits only what it records. So a
// write a mutation forgot to report is undone rather than committed without its history, and a
// mutation that found its state in place is never taken for one that wrote, however it looked:
// by a read, a row lock, an upsert whose update did not apply or that lost a race for its key,
// or an insert its savepoint undid. One that reports an event without a change, or a change
// without an event, returns ErrUnrecorded. When ctx's request holds an Idempotency-Key, the key
// is marked committed in the same transaction as the effect (idempotency.Commit).
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
		if rec.Event.Module == "" && rec.Event.Action == "" && len(rec.Changes) == 0 {
			return errNothing
		}
		if err := check(reg, rec); err != nil {
			return err
		}
		if ceiling, ok := ctx.Value(ceilingKey{}).(Ceiling); ok {
			if n := creates(rec); n > 0 {
				if err := ceiling(ctx, tx, scope.HouseholdID(), rec.Event.Module, n); err != nil {
					return err
				}
			}
		}
		// The key first, before the feed lock: a row lock taken under the feed lock could be one
		// another mutation of the household holds while it waits for the feed lock, a member's
		// removal taking their keys with their membership, and the two would deadlock.
		if err := idempotency.Commit(ctx, tx); err != nil {
			return err
		}
		// The actor's name as it is now, so that the log still reads after they leave or rename
		// themselves (FR-AU3): read here, in the mutation's own transaction, whichever front door
		// let the request in.
		if actor.Type == audit.User {
			if err := tx.QueryRow(ctx, "SELECT display_name FROM users WHERE id = $1", actor.ID).Scan(&actor.Label); err != nil {
				return fmt.Errorf("mutation: the actor's name: %w", err)
			}
		}
		household := scope.HouseholdID()
		// The event before the changes, for the same reason: its foreign keys take the locks on
		// the household's row and the module's that the feed's inserts need under the feed lock.
		if res.EventID, err = audit.Record(ctx, tx, household, actor, via, reqctx.RequestID(ctx), rec.Event); err != nil {
			return err
		}
		if res.Seq, err = sync.Emit(ctx, tx, household, actor.ID, rec.Changes); err != nil {
			return err
		}
		if hook, ok := ctx.Value(hookKey{}).(func()); ok {
			hook()
		}
		return nil
	})
	switch {
	case errors.Is(err, errNothing):
		return Result{}, nil
	case err != nil:
		return Result{}, err
	}
	return res, nil
}

// creates is how many rows rec creates: its upserts of a row at its first version, which
// add_entity_columns gives every row as it is inserted, and every update moves past.
func creates(rec Record) int64 {
	var n int64
	for _, c := range rec.Changes {
		if c.Op == sync.Upsert && c.Version == 1 {
			n++
		}
	}
	return n
}

// check returns what makes rec unrecordable: an incomplete record, an event its module does
// not declare, a change of an entity the event's module does not declare or inconsistent with
// it, or a private change in an event that is not private to the same owner. The activity log
// redacts a private event for everyone but its owner (FR-AU4); a shared event about a private
// row would show its summary and its diff to every member.
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
		if c.Visibility == sync.Private && (rec.Event.Visibility != audit.Private || rec.Event.Owner != c.Owner) {
			return fmt.Errorf("mutation: a private change of %s %s in an event that is not private to its owner", c.Entity, c.ID)
		}
	}
	return nil
}
