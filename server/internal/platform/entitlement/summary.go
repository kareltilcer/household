package entitlement

import (
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
)

// Columns are the columns of a households row, aliased h, that Row scans, in its order: what the row
// records of the household's entitlement, and whether the owner who restricted it is a member still,
// which reads its memberships and so needs the household's context.
const Columns = `h.billing_state::text, h.trial_ends_at, h.dunning_ends_at, h.grace_ends_at, h.lapsed_at,
	h.retained_until, h.retention_warnings, h.restricted_at, h.restricted_by, h.restricted_by_label,
	h.restriction_reason, h.suspended_at,
	h.restricted_by IS NOT NULL AND NOT EXISTS (
	  SELECT FROM memberships rm WHERE rm.household_id = h.id AND rm.user_id = h.restricted_by)`

// Row receives Columns from a query, for Status.
type Row struct {
	billing                                     string
	trial                                       time.Time
	dunning, grace, lapsed, retained, suspended *time.Time
	warnings                                    int16
	restrictedAt                                *time.Time
	restrictedBy                                *uuid.UUID
	label, reason                               *string
	former                                      bool
}

// Dest are the destinations a query's Scan takes Columns into.
func (r *Row) Dest() []any {
	return []any{&r.billing, &r.trial, &r.dunning, &r.grace, &r.lapsed, &r.retained, &r.warnings,
		&r.restrictedAt, &r.restrictedBy, &r.label, &r.reason, &r.suspended, &r.former}
}

// Status is what r received.
func (r *Row) Status() (Status, error) {
	s := Status{
		Billing: State(r.billing), TrialEndsAt: r.trial, DunningEndsAt: r.dunning, GraceEndsAt: r.grace,
		LapsedAt: r.lapsed, RetainedUntil: r.retained, RetentionWarnings: int(r.warnings), SuspendedAt: r.suspended,
	}
	if !slices.Contains(billing, s.Billing) {
		return Status{}, fmt.Errorf("entitlement: %q is no subscription state", r.billing)
	}
	if r.restrictedAt != nil {
		s.Restriction = &Restriction{At: *r.restrictedAt, By: r.restrictedBy, Reason: r.reason, ByFormerMember: r.former}
		if r.label != nil {
			s.Restriction.Label = *r.label
		}
	}
	return s, nil
}

// Summary is the contract's EntitlementSummary: the state, what it permits, and what the banner of
// each state says (DD-9, FR-BI7, D-32), which every member reads on the household.
type Summary struct {
	State State `json:"state"`
	// TrialEndsAt is set while the subscription is trialing, and TrialNotice is DD-9's stage.
	TrialEndsAt *time.Time `json:"trial_ends_at"`
	TrialNotice string     `json:"trial_notice"`
	CanWrite    bool       `json:"can_write"`
	CanUpload   bool       `json:"can_upload"`
	// GraceEndsAt is set while the subscription is in grace.
	GraceEndsAt *time.Time `json:"grace_ends_at"`
	// DataRetainedUntil is set while it is read_only or canceled: the day its data is deleted.
	DataRetainedUntil *time.Time          `json:"data_retained_until"`
	Restriction       *RestrictionSummary `json:"restriction"`
	SuspendedAt       *time.Time          `json:"suspended_at"`
}

// RestrictionSummary is who restricted the household, when and why.
type RestrictionSummary struct {
	RestrictedBy ActorRef  `json:"restricted_by"`
	RestrictedAt time.Time `json:"restricted_at"`
	Reason       *string   `json:"reason"`
}

// ActorRef is the contract's ActorRef: a member by the label they had, which still reads once they
// have left.
type ActorRef struct {
	UserID         *uuid.UUID `json:"user_id"`
	Label          string     `json:"label"`
	IsFormerMember bool       `json:"is_former_member"`
}

// Summary is s as the household's members read it at now. The restriction is shown whatever the
// state, so that a household whose lapse outranks it is still told who restricted it, and may lift it
// (D-114).
func (s Status) Summary(now time.Time) Summary {
	st := s.State()
	out := Summary{State: st, TrialNotice: s.TrialNotice(now), CanWrite: st.Writes(), CanUpload: st.Uploads()}
	switch s.Billing {
	case Trialing:
		out.TrialEndsAt = utc(&s.TrialEndsAt)
	case Grace:
		out.GraceEndsAt = utc(s.GraceEndsAt)
	case ReadOnly, Canceled:
		out.DataRetainedUntil = utc(s.RetainedUntil)
	case Active, PastDue, Restricted, Suspended:
	}
	if r := s.Restriction; r != nil {
		out.Restriction = &RestrictionSummary{
			RestrictedBy: ActorRef{UserID: r.By, Label: r.Label, IsFormerMember: r.By == nil || r.ByFormerMember},
			RestrictedAt: r.At.UTC(), Reason: r.Reason,
		}
	}
	out.SuspendedAt = utc(s.SuspendedAt)
	return out
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}
