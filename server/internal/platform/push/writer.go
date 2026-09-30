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
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// Writer is what a module implements to take the mutations clients push to its entities. The push
// calls WriteSync inside mutation.Apply's transaction, tx, of the caller's household, once it has
// checked m against its entity's declaration, the caller's grant on the module and the entity's
// cross-row invariant: the write is all that is left. A refusal is a *Refusal, and a constraint the
// database enforces is refused as FromDatabase reads it; any other error fails the batch.
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
// Row when the refusal names a row, such as the neighbour a reading breaks its series against.
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
// error that is none: a value out of range, missing, or one text cannot hold, a reference to a row
// that is not the household's, or an id another row holds.
func FromDatabase(err error) *Refusal {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return nil
	}
	switch pgErr.Code {
	case "23514", "23502", "22P02", "22003", "22007", "22008", "22001", "22021":
		return Refuse(problem.CodeValidationFailed, "a field is out of range: %s", pgErr.ConstraintName)
	case "23503":
		return Refuse(problem.CodeNotFound, "it names a row that is not there")
	case "23505":
		return Refuse(problem.CodeValidationFailed, "its id or its key is another row's")
	}
	return nil
}

// Decode decodes fields into into, a pointer to a struct whose JSON names the fields an entity
// takes, and refuses a field allowed does not name, or one of the wrong type.
func Decode(fields map[string]json.RawMessage, allowed []string, into any) error {
	for name := range fields {
		found := false
		for _, a := range allowed {
			found = found || a == name
		}
		if !found {
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
