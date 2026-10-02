// Package entitlement resolves a household's entitlement state (PRD 04 §3; plan item 16): one of
// eight, resolved once per request from the household's row, which says what the household may do.
// Every state reads but suspended; trialing, active, past_due and grace write; only the first three
// upload. The tenant middleware asks Gate of every household-scoped request (FR-BI1), so that a module
// holds no billing logic at all, and the files pipeline asks Uploads of an upload, which is how grace
// blocks uploads alone.
//
// The state is resolved from three sources, kept apart on the row: the subscription's own state,
// which money decides; an owner's restriction of processing (FR-BI7, D-87); and the platform's
// suspension. Precedence decides between them (D-114): a suspension over everything, a lapse over a
// restriction, since only a lapse runs a deletion countdown, which D-32 has the household told of
// from its first day, and a restriction over the states that still write.
package entitlement

import (
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// State is an entitlement state, as the contract's EntitlementState spells it.
type State string

// The eight states. The first six are the subscription's own, which billing_state holds; restricted
// is an owner's and suspended the platform's.
const (
	Trialing   State = "trialing"
	Active     State = "active"
	PastDue    State = "past_due"
	Grace      State = "grace"
	ReadOnly   State = "read_only"
	Canceled   State = "canceled"
	Restricted State = "restricted"
	Suspended  State = "suspended"
)

// States are the eight, in the contract's order.
var States = []State{Trialing, Active, PastDue, Grace, ReadOnly, Restricted, Canceled, Suspended}

// billing are the six states a subscription is in, which billing_state holds.
var billing = []State{Trialing, Active, PastDue, Grace, ReadOnly, Canceled}

// Reads reports whether a household in st may be read: in every state but suspended, which refuses
// reads outright, for abuse or legal reasons (PRD 04 §3, DD-15).
func (st State) Reads() bool { return st != Suspended }

// Writes reports whether a household in st may be written: until it lapses, is restricted or is
// suspended. past_due restricts nothing, and grace only uploads (PRD 04 §3).
func (st State) Writes() bool {
	switch st {
	case Trialing, Active, PastDue, Grace:
		return true
	case ReadOnly, Canceled, Restricted, Suspended:
	}
	return false
}

// Uploads reports whether a household in st may upload.
func (st State) Uploads() bool {
	switch st {
	case Trialing, Active, PastDue:
		return true
	case Grace, ReadOnly, Canceled, Restricted, Suspended:
	}
	return false
}

// lapsed reports whether st is one of the two a household's data is retained in, and then deleted.
func (st State) lapsed() bool { return st == ReadOnly || st == Canceled }

// Restriction is an owner's restriction of processing (FR-BI7): who restricted the household and when,
// with the reason they gave, if any.
type Restriction struct {
	At time.Time
	// By is the owner, nil once their account is gone; Label is their name as it was then.
	By     *uuid.UUID
	Label  string
	Reason *string
	// ByFormerMember reports whether By is no longer a member of the household.
	ByFormerMember bool
}

// Status is what a household's row records of its entitlement.
type Status struct {
	// Billing is the subscription's state: trialing, active, past_due, grace, read_only or canceled.
	// It is empty for a scope the tenant middleware did not resolve (tenant.Assume), and reads as
	// trialing.
	Billing State
	// TrialEndsAt is when the trial ends, TrialFor from the household's creation.
	TrialEndsAt time.Time
	// DunningEndsAt is when the retries of a failed payment end, set on entering past_due and kept
	// while the lapse it began goes on: a household that has it lapsed through dunning, one that has
	// not through its trial's end.
	DunningEndsAt *time.Time
	// GraceEndsAt is when grace ends.
	GraceEndsAt *time.Time
	// LapsedAt is when the household became read_only or canceled, and RetainedUntil when its data is
	// deleted (RetainedUntil); RetentionWarnings counts the warnings sent of the three (Warnings).
	LapsedAt          *time.Time
	RetainedUntil     *time.Time
	RetentionWarnings int
	// Restriction is the owner's restriction, nil for none.
	Restriction *Restriction
	// SuspendedAt is when the platform suspended the household, nil for never.
	SuspendedAt *time.Time
}

// State is the household's state, by D-114's precedence.
func (s Status) State() State {
	switch {
	case s.SuspendedAt != nil:
		return Suspended
	case s.Billing.lapsed():
		return s.Billing
	case s.Restriction != nil:
		return Restricted
	case s.Billing == "":
		return Trialing
	}
	return s.Billing
}

// The remedies a 402 names, as the contract's EntitlementProblem spells them.
const (
	RemedySubscribe           = "subscribe"
	RemedyUpdatePaymentMethod = "update_payment_method"
	RemedyFreeStorage         = "free_storage"
	RemedyContactOwner        = "contact_owner"
	RemedyLiftRestriction     = "lift_restriction"
)

// Refusal is the 402 that answers a write, or an upload, the household's state does not permit, for a
// caller whose role is role: entitlement_restricted when an owner restricted it, and
// entitlement_read_only otherwise, grace's refused upload among them, naming the state and what fixes
// it. Only an owner can fix any of them, so anyone else is told to ask one (FR-BI5: members and
// children never see billing).
func (s Status) Refusal(role access.Role) *problem.Problem {
	st := s.State()
	code := problem.CodeEntitlementReadOnly
	if st == Restricted {
		code = problem.CodeEntitlementRestricted
	}
	p := problem.New(http.StatusPaymentRequired, code)
	p.Extensions = map[string]any{"state": st, "remedy": s.remedy(role)}
	return p
}

func (s Status) remedy(role access.Role) string {
	switch {
	case role != access.Owner:
		return RemedyContactOwner
	case s.State() == Restricted:
		return RemedyLiftRestriction
	case s.Billing == Canceled, s.DunningEndsAt == nil:
		return RemedySubscribe
	}
	return RemedyUpdatePaymentMethod
}

// exempt is FR-BI1's closed list of the unsafe operations no state refuses with 402, by the
// contract's operationId, and D-117's one addition. Nothing else is exempt: the contract declares
// 402 on every other household-scoped unsafe operation, and on none of these, which an architecture
// test holds the two to.
var exempt = map[string]bool{
	// Everything under …/billing: it is the action that fixes the state.
	"postBillingCheckoutSession": true,
	"postBillingPortalSession":   true,
	"postBillingCancel":          true,
	"postBillingResume":          true,
	"postBillingTransfer":        true,
	"postBillingTransferAccept":  true,
	// Export works in every state, and generating one is a write (D-32, G5).
	"postExports": true,
	// A household must be able to leave in any state.
	"postDeletion":   true,
	"deleteDeletion": true,
	// A member is not held in a household by somebody else's billing.
	"postLeave": true,
	// A restriction you cannot lift is a household nobody can use (FR-BI7).
	"postHouseholdRestriction":   true,
	"deleteHouseholdRestriction": true,
	// The credential a replica pulls with: read_only, canceled and restricted pull (D-117).
	"postSyncCredentials": true,
}

// Exempt reports whether operation, an operationId, is one no state refuses with 402.
func Exempt(operation string) bool { return exempt[operation] }

// Exemptions are the operationIds Exempt admits.
func Exemptions() []string {
	out := make([]string, 0, len(exempt))
	for id := range exempt {
		out = append(out, id)
	}
	return out
}

// Gate is FR-BI1's gate, asked once per household-scoped request: nil to let it on, or the problem
// that answers it. A suspended household answers every request 404, its exemptions too, as a
// household its caller cannot see (D-115); otherwise a safe method always goes on, since no read is
// ever refused with 402, and so does an unsafe one in a state that writes or on an exempt operation,
// operation being its operationId, "" for a request no route matches. Every other is refused 402 for
// a caller whose role is role (Refusal).
func Gate(s Status, role access.Role, operation, method string) error {
	st := s.State()
	switch {
	case !st.Reads():
		return problem.NotFound()
	case safe(method), st.Writes(), Exempt(operation):
		return nil
	}
	return s.Refusal(role)
}

// safe reports whether method is safe (RFC 9110 §9.2.1), which reads and changes nothing.
func safe(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodTrace:
		return true
	}
	return false
}
