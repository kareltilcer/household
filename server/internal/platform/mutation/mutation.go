// Package mutation is the mutation spine (PRD 01 §3, PRD 03 §1): the one service-layer entry point
// every write goes through, from a REST handler, from the sync engine's push (item 13) and from any
// later front door alike (future/ai-assistant). Apply runs a mutation's own writes and, in the same
// transaction, records its audit event (FR-AU1) and checks the change it reports of each row it wrote
// against the row's entity (FR-SY1), so that the write and its history commit or roll back together.
// PowerSync replicates the rows themselves from the write-ahead log (D-93); the change feed the
// spine once wrote beside them has no reader, and is no longer written (D-121, ADR 0018).
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

// Record is what a mutation did: the audit event it records and its changes, one per entity row it
// created, changed or deleted.
type Record struct {
	Event   audit.Event
	Changes []sync.Change
}

// Result is what a committed mutation wrote: the zero Result for one that reported nothing, whose
// transaction Apply rolled back.
type Result struct {
	// EventID is its audit event's id.
	EventID uuid.UUID
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
	ceilingKey struct{}
	serviceKey struct{}
)

// Service is the platform acting on a household for someone who is no member of it: its staff (PRD
// 02 §8). What it does there is written in the household's own log, where the household sees it
// (FR-AL7, D-75), by a service actor named Label, and never by a member's name.
type Service struct {
	// Label names the actor in the household's log: "support" for the platform's staff, whichever of
	// them it was. Who it was is the platform's own log's to say.
	Label string
	// Witness, when not nil, runs in the transaction of each event the service records, with the
	// event's id, once the event is written: the platform's own record of the action (FR-PS2), which
	// commits with its effect or not at all. An error rolls the mutation back.
	Witness func(ctx context.Context, tx pgx.Tx, event uuid.UUID) error
}

// AsService returns ctx recording that its mutations are svc's. It names the actor only in a scope
// with no caller, the platform's own (tenant.Assume), where Apply would otherwise record the system:
// a member's mutation is the member's, whatever its context says. It is the platform's, as
// tenant.Assume is: architecture test 4 keeps it out of every module.
func AsService(ctx context.Context, svc Service) context.Context {
	return context.WithValue(ctx, serviceKey{}, svc)
}

// acting returns who ctx's mutations are recorded as, in scope: the caller, a service the context
// names where the scope has no caller, or the system. A user's label is read by label, in the
// mutation's own transaction.
func acting(ctx context.Context, scope *tenant.Scope) (audit.Actor, *Service) {
	if user := scope.UserID(); user != uuid.Nil {
		return audit.Actor{Type: audit.User, ID: user}, nil
	}
	if svc, ok := ctx.Value(serviceKey{}).(Service); ok && svc.Label != "" {
		return audit.Actor{Type: audit.Service, Label: svc.Label}, &svc
	}
	return audit.Actor{Type: audit.System}, nil
}

// label reads, in tx, the name a user actor has now, so that the log still reads after they leave or
// rename themselves (FR-AU3).
func label(ctx context.Context, tx pgx.Tx, actor *audit.Actor) error {
	if actor.Type != audit.User {
		return nil
	}
	if err := tx.QueryRow(ctx, "SELECT display_name FROM users WHERE id = $1", actor.ID).Scan(&actor.Label); err != nil {
		return fmt.Errorf("mutation: the actor's name: %w", err)
	}
	return nil
}

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

// Apply runs fn in a transaction of ctx's household that may write, then records the audit event
// and checks the changes fn reports, and commits: all of it or none of it. fn's error, a problem for
// instance, is returned as it is, after the rollback.
//
// The actor is the caller in ctx's tenant scope, labelled with their display name as it is when
// the event is written, or, when the scope has no caller, the service ctx names (AsService) or the
// system, and the audit event records how the change arrived (WithVia) and the request it arrived
// in. The event's
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
	actor, svc := acting(ctx, scope)

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
		if err := idempotency.Commit(ctx, tx); err != nil {
			return err
		}
		// The actor's name as it is now: read here, in the mutation's own transaction, whichever
		// front door let the request in.
		if err := label(ctx, tx, &actor); err != nil {
			return err
		}
		if res.EventID, err = audit.Record(ctx, tx, scope.HouseholdID(), actor, via, reqctx.RequestID(ctx), rec.Event); err != nil {
			return err
		}
		if svc != nil && svc.Witness != nil {
			return svc.Witness(ctx, tx, res.EventID)
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

// Note records e in the log of ctx's household, in tx, a transaction of that household that may
// write, and returns the event's id: something the platform did to a household that changed no
// entity's row, and so is no mutation Apply would record, a credit applied at the payment processor,
// an invoice sent again, a ceiling raised (FR-AL7, D-75). The event is held to what Apply holds one
// to: an action its module declares, recorded by the actor ctx's scope and service name, with how it
// arrived; and, as in Apply, the Idempotency-Key ctx's request holds is marked committed in tx, which
// commits what the event records, so that no caller of Note has it to remember. It is the
// platform's, as tenant.InWriteTx is, whose transaction it needs: architecture test 4 keeps both out
// of every module, whose every event is a mutation's.
func Note(ctx context.Context, tx pgx.Tx, e audit.Event) (uuid.UUID, error) {
	reg, _ := ctx.Value(catalogKey{}).(*module.Registry)
	if reg == nil {
		return uuid.Nil, ErrNoCatalog
	}
	via, _ := ctx.Value(viaKey{}).(audit.Via)
	if via == "" {
		return uuid.Nil, ErrNoVia
	}
	scope := tenant.From(ctx)
	if scope == nil {
		return uuid.Nil, tenant.ErrNoTenant
	}
	if err := e.Check(); err != nil {
		return uuid.Nil, err
	}
	if _, ok := reg.Action(e.Module + "." + e.Action); !ok {
		return uuid.Nil, fmt.Errorf("mutation: audit action %s.%s is not one its module declares", e.Module, e.Action)
	}
	if err := idempotency.Commit(ctx, tx); err != nil {
		return uuid.Nil, err
	}
	actor, svc := acting(ctx, scope)
	if err := label(ctx, tx, &actor); err != nil {
		return uuid.Nil, err
	}
	id, err := audit.Record(ctx, tx, scope.HouseholdID(), actor, via, reqctx.RequestID(ctx), e)
	if err != nil {
		return uuid.Nil, err
	}
	if svc != nil && svc.Witness != nil {
		if err := svc.Witness(ctx, tx, id); err != nil {
			return uuid.Nil, err
		}
	}
	return id, nil
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
