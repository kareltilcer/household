// Package push is the write half of sync (PRD 03 §2.4–§2.5, §2.8; D-93, ADR 0001, ADR 0014): the
// push, POST /households/{household_id}/sync/mutations, which takes the ordered batch a client's
// upload queue sends, and applies each mutation through the module that owns its entity, in its own
// transaction of the mutation spine, recording via sync.
//
// The push holds what every entity shares: the entity's declaration (its policy, its offline-write
// flag, its cross-row invariant), the caller's grant, the batch's order and its dependencies, the
// client's clock, and each mutation's answer kept for 7 days (FR-SY5). What a mutation writes, and
// how its policy merges it into the row in place, is the module's: a module whose entities a client
// writes offline implements Writer, and writes through the same service layer its REST routes do.
package push

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// Writer is what a module implements to take the mutations clients push to its entities. The push
// calls WriteSync inside mutation.Apply's transaction, tx, of the caller's household, once it has
// checked m against its entity's declaration, the caller's grant on the module and the entity's
// cross-row invariant, and locked the row an update, a delete or an action names (Mutation.Prior):
// the write is all that is left, and a strict_version writer's Admit before it. A refusal is a
// *Refusal, or the problem the module's service layer answers its REST routes with, which the push
// reads as one (asRefusal); a constraint the database enforces is refused as FromDatabase reads it;
// any other error, a problem of the server's own among them, fails the batch.
type Writer interface {
	WriteSync(ctx context.Context, tx pgx.Tx, m Mutation) (Written, error)
}

// Op is what a mutation does (the contract's SyncMutationOp).
type Op string

// The four ops.
const (
	Create Op = "create"
	Update Op = "update"
	Delete Op = "delete"
	Action Op = "action"
)

// Mutation is one pushed mutation, as the push hands it to the module that owns its entity.
type Mutation struct {
	// ID is the mutation's id, which the client generated: the key its answer is kept under.
	ID uuid.UUID
	// Entity is the declaration of the entity it writes, and EntityID the row.
	Entity   sync.Entity
	EntityID uuid.UUID
	Op       Op
	// BaseVersion is the row's version the client wrote against, nil on a create.
	BaseVersion *int64
	// Prior is the version of the row EntityID names as the push found it, locked FOR UPDATE until the
	// mutation's transaction ends, for an update, a delete or an action of an entity whose policy
	// compares a base version (lww_field, lww_row and strict_version); 0 when no row has the id, and on
	// anything else. Admit and Behind compare BaseVersion with it.
	Prior int64
	// Action is the action an Action names, "" for any other op.
	Action string
	// Fields are the fields the client changed, each as its JSON.
	Fields map[string]json.RawMessage
	// ClientTime is when the client made the mutation, held to ClockClamp of the server's clock,
	// and ClockFlagged says it had to be held (PRD 03 §2.8, D-26): a state_set resolved by the
	// latest client time orders by it, and a row that keeps it keeps the flag beside it.
	ClientTime   time.Time
	ClockFlagged bool
}

// Admit returns why m's merge policy refuses to write it over its row as it stands, at m.Prior, whose
// representation the module serialises as current; nil when it admits it (PRD 03 §2.5). A writer of a
// strict_version entity calls it once it has found the row and may show it to the caller, before it
// writes: an update, a delete or an action that names no base version is refused, and one made against
// another version than the row's is a conflict, which carries current so that the member's change can
// be re-presented beside it. A create, and every other policy, it admits; the push fails the batch at a
// strict_version write a writer let through over another version.
func (m Mutation) Admit(current any) error {
	if m.Entity.Policy != sync.StrictVersion || m.Op == Create {
		return nil
	}
	switch {
	case m.BaseVersion == nil:
		return Refuse(problem.CodeValidationFailed, "%s is strict_version: a write names the version it was made against", m.Entity.Name)
	case *m.BaseVersion != m.Prior:
		return &Refusal{
			Code:    problem.CodeVersionConflict,
			Message: fmt.Sprintf("it was made against version %d of the row, which is at version %d", *m.BaseVersion, m.Prior),
			Row:     current,
		}
	}
	return nil
}

// Behind reports whether m was made against an older version of its row than the one it lands on:
// another write reached the row since the client last saw it. An lww_field or lww_row write behind is
// answered merged, its row attached, since the row the server keeps differs from what the client
// expected; and a writer of an lww_row entity preserves the row its write replaces, the loser, which
// whole-row last-write-wins would otherwise drop (PRD 03 §2.5, D-122).
func (m Mutation) Behind() bool {
	return m.Op != Create && m.BaseVersion != nil && *m.BaseVersion < m.Prior
}

// Written is what a module's write of a mutation came to.
type Written struct {
	// Record is what it wrote, for mutation.Apply to record with its audit event and its sync
	// change; the zero Record when the state the mutation asks for is in place already and it
	// wrote nothing, which Apply rolls back.
	Record mutation.Record
	// Row is the entity as the API serialises it once written, or as it stands, and Version its
	// version: the applied answer carries both.
	Row     any
	Version int64
}

// Refusal is a mutation a module refuses: it is answered rejected, with Code and Message, and
// Row when the refusal names a row, such as the neighbour a reading breaks its series against. A
// refusal on the row's version, version_conflict, is answered conflict, with the row as it stands
// (the contract's SyncMutationResult).
type Refusal struct {
	Code    problem.Code
	Message string
	Row     any
}

func (r *Refusal) Error() string { return string(r.Code) + ": " + r.Message }

// Refuse returns the refusal of a mutation with code, and a message made from format.
func Refuse(code problem.Code, format string, args ...any) *Refusal {
	return &Refusal{Code: code, Message: fmt.Sprintf(format, args...)}
}

// FromDatabase returns the refusal a constraint the database enforces stands for, or nil for an
// error that is none: a reference to a row that is not the household's, an id or a key another row
// holds, and any other integrity violation or data exception (SQLSTATE classes 23 and 22), a value
// out of range, missing, of the wrong form or one text cannot hold, or too large for an index to
// hold (54000). It reads a class rather than a list of codes, since a mutation's values can raise
// any code of either, and one read as none fails the whole batch, and every retry of it, at that
// mutation, where a refusal lets the batch go on (FR-SY6).
func FromDatabase(err error) *Refusal {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return nil
	}
	switch {
	case pgErr.Code == "23503":
		return Refuse(problem.CodeNotFound, "it names a row that is not there")
	case pgErr.Code == "23505":
		return Refuse(problem.CodeValidationFailed, "its id or its key is another row's")
	case strings.HasPrefix(pgErr.Code, "22"), strings.HasPrefix(pgErr.Code, "23"), pgErr.Code == "54000":
		// A data exception names no constraint, and a constraint is named only when there is one.
		if pgErr.ConstraintName == "" {
			return Refuse(problem.CodeValidationFailed, "a field is out of range")
		}
		return Refuse(problem.CodeValidationFailed, "a field is out of range: %s", pgErr.ConstraintName)
	}
	return nil
}

// asRefusal returns err, what entity's writer answered, as the refusal it stands for when it is a
// problem the client is answered for, below 500, as the module's service layer answers its REST
// routes: the problem's code, the fields it names, and a conflict's representation of the row as it
// stands, which it answers the mutation with. Read as an error instead, it would fail the whole
// batch, and every retry of it, at that mutation, and each module would have to translate its
// service layer's answers itself. Any other error is returned as it is: one of the server's own, and
// the claim on the request's Idempotency-Key lost, which answers the batch.
func asRefusal(err error, entity string) error {
	var p *problem.Problem
	if !errors.As(err, &p) || p.Status >= http.StatusInternalServerError || errors.Is(err, idempotency.ErrClaimLost) {
		return err
	}
	message := entity + " refused it: " + string(p.Code)
	if len(p.Errors) > 0 {
		fields := make([]string, len(p.Errors))
		for i, f := range p.Errors {
			fields[i] = f.Field + " " + f.Code
		}
		message += " (" + strings.Join(fields, ", ") + ")"
	}
	return &Refusal{Code: p.Code, Message: message, Row: p.Extensions["current"]}
}

// Decode decodes fields into into, a pointer to a struct whose JSON names the fields an entity
// takes, and refuses a field allowed does not name, or one of the wrong type.
func Decode(fields map[string]json.RawMessage, allowed []string, into any) error {
	for name := range fields {
		if !slices.Contains(allowed, name) {
			return Refuse(problem.CodeValidationFailed, "%s is not a field this entity takes", name)
		}
	}
	raw, err := json.Marshal(fields)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, into); err != nil {
		return Refuse(problem.CodeValidationFailed, "a field has the wrong type: %v", err)
	}
	return nil
}
