package household

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// What the platform's staff do to a household (PRD 02 §8, plan item 21), which the staff API
// (internal/platform/staff) does through here, in a context that names them as the actor
// (mutation.AsService): everything the platform does to a household is in the household's own log,
// where its members see it (FR-AL7, D-75). Nothing here is reached by a household's own routes.

// The audit actions of what staff do, each rendered by the translation key of the same name. A
// suspension changes the household's row; the others change no entity's row, and are recorded
// through mutation.Note (SupportEvent).
const (
	actionSupportSuspend   = "support.suspend"
	actionSupportUnsuspend = "support.unsuspend"
	// SupportCredit is a credit applied at the payment processor, and SupportInvoice an invoice sent
	// to its payer again.
	SupportCredit  = "support.credit"
	SupportInvoice = "support.invoice"
	// SupportRedrive is a notification that failed, sent again.
	SupportRedrive = "support.redrive"
	// SupportLimit is a fair-use ceiling raised for the household, or put back, and SupportFlag a
	// feature flag set for it, or its setting taken away.
	SupportLimit = "support.limit"
	SupportFlag  = "support.flag"
)

// The emails that tell a household's owners it was suspended, with the notice that goes with it (PRD
// 04 §3: "always with notice"), and that the suspension was lifted.
const (
	emailSuspended   mail.Template = "email.household_suspended"
	emailUnsuspended mail.Template = "email.household_unsuspended"
)

// SupportEvent is the event of action, one of the Support actions, with the arguments its summary
// renders with: what the platform's staff did to a household that changed no entity's row
// (mutation.Note).
func SupportEvent(action string, args map[string]any) audit.Event {
	return audit.Event{Module: Name, Action: action, Level: audit.Notice, SummaryKey: Name + "." + action, SummaryArgs: args}
}

// Suspend suspends household, in tx, a mutation's transaction in its context (mutation.Apply), with
// notice, what the platform tells it of why, and returns the mutation's record: the zero Record for a
// household suspended already, which stands as it is. Every household-scoped request answers 404 from
// then on and its replicas are emptied (D-115); the lockout shows the notice, and each of its owners
// is emailed it. The caller nudges the transport once tx has committed.
func (s *Service) Suspend(ctx context.Context, tx pgx.Tx, household uuid.UUID, notice string) (mutation.Record, error) {
	if _, err := lockHousehold(ctx, tx, household); err != nil {
		return mutation.Record{}, err
	}
	status, err := readStatus(ctx, tx, household)
	if err != nil || status.SuspendedAt != nil {
		return mutation.Record{}, err
	}
	h, err := scanSettings(tx.QueryRow(ctx, `
		UPDATE households SET suspended_at = now(), suspension_notice = $2 WHERE id = $1
		RETURNING `+settingsColumns, household, notice))
	if err != nil {
		return mutation.Record{}, err
	}
	if err := s.tellOwners(ctx, tx, household, emailSuspended, i18n.Args{"notice": notice}); err != nil {
		return mutation.Record{}, err
	}
	return mutation.Record{
		Event: audit.Event{
			Module: Name, Action: actionSupportSuspend, EntityType: entitySettings, EntityID: h.id, Level: audit.Warn,
			SummaryKey: Name + "." + actionSupportSuspend, SummaryArgs: map[string]any{"notice": notice},
			Changes: []audit.Change{{Field: "suspended", Old: false, New: true}},
		},
		Changes: []sync.Change{settingsChange(h)},
	}, nil
}

// Unsuspend lifts household's suspension, in tx, a mutation's transaction in its context, and returns
// the mutation's record: the zero Record for a household that is not suspended. The household is in
// whatever state its subscription puts it in, its replicas fill again, and each of its owners is
// emailed. The caller nudges the transport once tx has committed.
func (s *Service) Unsuspend(ctx context.Context, tx pgx.Tx, household uuid.UUID) (mutation.Record, error) {
	if _, err := lockHousehold(ctx, tx, household); err != nil {
		return mutation.Record{}, err
	}
	status, err := readStatus(ctx, tx, household)
	if err != nil || status.SuspendedAt == nil {
		return mutation.Record{}, err
	}
	h, err := scanSettings(tx.QueryRow(ctx, `
		UPDATE households SET suspended_at = NULL, suspension_notice = NULL WHERE id = $1
		RETURNING `+settingsColumns, household))
	if err != nil {
		return mutation.Record{}, err
	}
	if err := s.tellOwners(ctx, tx, household, emailUnsuspended, nil); err != nil {
		return mutation.Record{}, err
	}
	return mutation.Record{
		Event: audit.Event{
			Module: Name, Action: actionSupportUnsuspend, EntityType: entitySettings, EntityID: h.id, Level: audit.Notice,
			SummaryKey: Name + "." + actionSupportUnsuspend,
			Changes:    []audit.Change{{Field: "suspended", Old: true, New: false}},
		},
		Changes: []sync.Change{settingsChange(h)},
	}, nil
}

// tellOwners queues, in tx, the email t with args to each of household's owners: billing and the
// household's standing are of the fixed email set (FR-NT1).
func (s *Service) tellOwners(ctx context.Context, tx pgx.Tx, household uuid.UUID, t mail.Template, args i18n.Args) error {
	owners, err := tenant.Owners(ctx, tx, household)
	if err != nil {
		return err
	}
	ns := make([]notify.Notification, 0, len(owners))
	for _, o := range owners {
		ns = append(ns, notify.Notification{To: o, Category: notify.Direct, Message: string(t), Email: true, Args: args})
	}
	return s.Notify.Queue(ctx, tx, ns...)
}
