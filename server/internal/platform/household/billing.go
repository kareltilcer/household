package household

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// Billing is what billing decides of a household's row (plan item 19): its subscription's state with
// the clocks that time it, and the member who pays. The restriction and the suspension, which the
// status carries too, are an owner's and the platform's, and Bill writes neither.
type Billing struct {
	Status entitlement.Status
	// Payer is the household's payer of record, nil for none.
	Payer *uuid.UUID
}

// ErrPayerNotOwner is Bill's refusal to move billing to someone who is not one of the household's
// owners: billing moves only between owners (FR-HH6, D-103).
var ErrPayerNotOwner = errors.New("household: the payer must be one of the household's owners")

// Bill writes, in tx, what decide makes of household's subscription and payer as they stand under
// the household's lock, and returns the mutation's record: the zero Record when decide leaves both as
// they are, which mutation.Apply rolls back, so that decide must write nothing of its own that it
// means to keep then. It is how billing (internal/platform/billing) moves a household along from
// what the payment processor says, entering past_due with its dunning_ends_at, canceled with its
// lapsed_at and retained_until, and active with every clock cleared, and how billing moves between
// owners, each through the mutation spine as the hourly job's moves are (Transition), which stays the
// backstop (ADR 0017, ADR 0019). tx is a mutation's transaction in household's context
// (mutation.Apply), the system's or a caller's.
//
// A move of the subscription records admin.household.entitlement, as the clock's does, and a move of
// the payer admin.household.payer, with the subscription's change beside it when both move at once.
func Bill(ctx context.Context, tx pgx.Tx, household uuid.UUID, decide func(Billing) (Billing, error)) (mutation.Record, error) {
	payer, err := lockHousehold(ctx, tx, household)
	if err != nil {
		return mutation.Record{}, err
	}
	old, err := readStatus(ctx, tx, household)
	if err != nil {
		return mutation.Record{}, err
	}
	next, err := decide(Billing{Status: old, Payer: payer})
	if err != nil {
		return mutation.Record{}, err
	}
	moved, paid := !sameSubscription(old, next.Status), !sameID(payer, next.Payer)
	if !moved && !paid {
		return mutation.Record{}, nil
	}
	label := ""
	if paid && next.Payer != nil {
		var role string
		err := tx.QueryRow(ctx, `
			SELECT m.role::text, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id
			WHERE m.household_id = $1 AND m.user_id = $2`, household, *next.Payer).Scan(&role, &label)
		switch {
		case errors.Is(err, pgx.ErrNoRows) || (err == nil && access.Role(role) != access.Owner):
			return mutation.Record{}, ErrPayerNotOwner
		case err != nil:
			return mutation.Record{}, err
		}
	}
	st := next.Status
	h, err := scanSettings(tx.QueryRow(ctx, `
		UPDATE households SET billing_state = $2, trial_ends_at = $3, dunning_ends_at = $4, grace_ends_at = $5, lapsed_at = $6,
		  retained_until = $7, retention_warnings = $8, billing_payer_id = $9
		WHERE id = $1
		RETURNING `+settingsColumns,
		household, string(st.Billing), st.TrialEndsAt, st.DunningEndsAt, st.GraceEndsAt, st.LapsedAt, st.RetainedUntil,
		st.RetentionWarnings, next.Payer))
	if err != nil {
		return mutation.Record{}, err
	}
	event := audit.Event{
		Module: Name, Action: actionEntitlement, EntityType: entitySettings, EntityID: h.id,
		SummaryKey:  Name + "." + actionEntitlement,
		SummaryArgs: map[string]any{"state": string(st.Billing), "from": string(old.Billing)},
	}
	if paid {
		event.Action, event.SummaryKey = actionPayer, Name+"."+actionPayer
		event.SummaryArgs = map[string]any{"member": label}
		event.Changes = append(event.Changes, audit.Change{Field: "billing_payer_id", Old: idOf(payer), New: idOf(next.Payer)})
	}
	if old.Billing != st.Billing {
		event.Changes = append(event.Changes, audit.Change{Field: "billing_state", Old: string(old.Billing), New: string(st.Billing)})
	}
	if !old.TrialEndsAt.Equal(st.TrialEndsAt) {
		event.Changes = append(event.Changes, audit.Change{Field: "trial_ends_at", Old: old.TrialEndsAt.UTC(), New: st.TrialEndsAt.UTC()})
	}
	return mutation.Record{Event: event, Changes: []sync.Change{settingsChange(h)}}, nil
}

// sameSubscription reports whether a and b hold one subscription's state and clocks.
func sameSubscription(a, b entitlement.Status) bool {
	return a.Billing == b.Billing && a.TrialEndsAt.Equal(b.TrialEndsAt) && sameTime(a.DunningEndsAt, b.DunningEndsAt) &&
		sameTime(a.GraceEndsAt, b.GraceEndsAt) && sameTime(a.LapsedAt, b.LapsedAt) && sameTime(a.RetainedUntil, b.RetainedUntil) &&
		a.RetentionWarnings == b.RetentionWarnings
}

// sameTime reports whether a and b are one instant, or both none.
func sameTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}

// sameID reports whether a and b name one member, or both none.
func sameID(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// idOf is id as an audit diff carries it: nil for none.
func idOf(id *uuid.UUID) any {
	if id == nil {
		return nil
	}
	return id.String()
}
