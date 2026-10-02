package entitlement_test

import (
	"errors"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

var (
	t0      = time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	day     = 24 * time.Hour
	restrct = &entitlement.Restriction{At: t0, Label: "Jana"}
)

func at(t time.Time) *time.Time { return &t }

// status is a household whose subscription is in billing, with what that state needs set.
func status(billing entitlement.State) entitlement.Status {
	s := entitlement.Status{Billing: billing, TrialEndsAt: t0.Add(entitlement.TrialFor)}
	switch billing {
	case entitlement.PastDue:
		s.DunningEndsAt = at(t0.Add(entitlement.DunningFor))
	case entitlement.Grace:
		s.GraceEndsAt = at(t0.Add(entitlement.GraceFor))
	case entitlement.ReadOnly, entitlement.Canceled:
		s.LapsedAt, s.RetainedUntil = at(t0), at(entitlement.RetainedUntil(t0))
	case entitlement.Trialing, entitlement.Active, entitlement.Restricted, entitlement.Suspended:
	}
	return s
}

// The eight states, and what each permits (PRD 04 §3): every state reads but suspended, the four
// before a lapse write, and the three before grace upload.
func TestWhatEachStatePermits(t *testing.T) {
	for st, want := range map[entitlement.State][3]bool{
		entitlement.Trialing:   {true, true, true},
		entitlement.Active:     {true, true, true},
		entitlement.PastDue:    {true, true, true},
		entitlement.Grace:      {true, true, false},
		entitlement.ReadOnly:   {true, false, false},
		entitlement.Canceled:   {true, false, false},
		entitlement.Restricted: {true, false, false},
		entitlement.Suspended:  {false, false, false},
	} {
		if got := [3]bool{st.Reads(), st.Writes(), st.Uploads()}; got != want {
			t.Errorf("%s reads, writes, uploads: %v, want %v", st, got, want)
		}
	}
	if len(entitlement.States) != 8 {
		t.Fatalf("%d states", len(entitlement.States))
	}
}

// D-114: a suspension outranks everything, a lapse outranks a restriction, and a restriction the
// states that still write; a scope the middleware did not resolve reads as trialing.
func TestPrecedence(t *testing.T) {
	for _, billing := range []entitlement.State{
		entitlement.Trialing, entitlement.Active, entitlement.PastDue, entitlement.Grace, entitlement.ReadOnly, entitlement.Canceled,
	} {
		plain := status(billing)
		if got := plain.State(); got != billing {
			t.Errorf("%s alone is %s", billing, got)
		}
		restricted := plain
		restricted.Restriction = restrct
		want := entitlement.Restricted
		if billing == entitlement.ReadOnly || billing == entitlement.Canceled {
			want = billing
		}
		if got := restricted.State(); got != want {
			t.Errorf("%s restricted is %s, want %s", billing, got, want)
		}
		suspended := restricted
		suspended.SuspendedAt = at(t0)
		if got := suspended.State(); got != entitlement.Suspended {
			t.Errorf("%s restricted and suspended is %s", billing, got)
		}
	}
	if got := (entitlement.Status{}).State(); got != entitlement.Trialing {
		t.Errorf("an unresolved scope is %s", got)
	}
}

// The 402 names the state and what fixes it for the caller: an owner is told to subscribe, to update
// the payment method after a failed payment, or to lift the restriction; anyone else to ask an owner.
func TestARefusalNamesTheStateAndTheRemedy(t *testing.T) {
	lapsedByDunning := status(entitlement.ReadOnly)
	lapsedByDunning.DunningEndsAt = at(t0.Add(-entitlement.GraceFor))
	graceByDunning := status(entitlement.Grace)
	graceByDunning.DunningEndsAt = at(t0)
	restrictedLapse := status(entitlement.ReadOnly)
	restrictedLapse.Restriction = restrct
	restricted := status(entitlement.Active)
	restricted.Restriction = restrct
	for name, tc := range map[string]struct {
		status entitlement.Status
		role   access.Role
		code   problem.Code
		state  entitlement.State
		remedy string
	}{
		"a trial that lapsed":           {status(entitlement.ReadOnly), access.Owner, problem.CodeEntitlementReadOnly, entitlement.ReadOnly, entitlement.RemedySubscribe},
		"a payment that lapsed":         {lapsedByDunning, access.Owner, problem.CodeEntitlementReadOnly, entitlement.ReadOnly, entitlement.RemedyUpdatePaymentMethod},
		"grace after a failed payment":  {graceByDunning, access.Owner, problem.CodeEntitlementReadOnly, entitlement.Grace, entitlement.RemedyUpdatePaymentMethod},
		"a cancellation":                {status(entitlement.Canceled), access.Owner, problem.CodeEntitlementReadOnly, entitlement.Canceled, entitlement.RemedySubscribe},
		"a restriction":                 {restricted, access.Owner, problem.CodeEntitlementRestricted, entitlement.Restricted, entitlement.RemedyLiftRestriction},
		"a lapse beneath a restriction": {restrictedLapse, access.Owner, problem.CodeEntitlementReadOnly, entitlement.ReadOnly, entitlement.RemedySubscribe},
		"a member's":                    {status(entitlement.ReadOnly), access.Member, problem.CodeEntitlementReadOnly, entitlement.ReadOnly, entitlement.RemedyContactOwner},
		"a child's restriction":         {restricted, access.Child, problem.CodeEntitlementRestricted, entitlement.Restricted, entitlement.RemedyContactOwner},
	} {
		p := tc.status.Refusal(tc.role)
		if p.Status != http.StatusPaymentRequired || p.Code != tc.code || p.Extensions["state"] != tc.state || p.Extensions["remedy"] != tc.remedy {
			t.Errorf("%s: %d %s %v", name, p.Status, p.Code, p.Extensions)
		}
	}
}

// The trial ends into grace, dunning ends into grace, and grace into read_only, each timed from the
// deadline before it, so that a household the hourly job reaches late lapses when it would have; a
// restriction and a suspension leave the clocks running.
func TestTheClockMovesASubscriptionAlong(t *testing.T) {
	trial := status(entitlement.Trialing)
	if _, changed := trial.Advance(trial.TrialEndsAt.Add(-time.Second)); changed {
		t.Fatal("a trial moved before it ended")
	}
	grace, changed := trial.Advance(trial.TrialEndsAt)
	if !changed || grace.Billing != entitlement.Grace || !grace.GraceEndsAt.Equal(trial.TrialEndsAt.Add(entitlement.GraceFor)) {
		t.Fatalf("a trial that ended: %+v", grace)
	}
	lapsed, changed := grace.Advance(*grace.GraceEndsAt)
	if !changed || lapsed.Billing != entitlement.ReadOnly || !lapsed.LapsedAt.Equal(*grace.GraceEndsAt) ||
		!lapsed.RetainedUntil.Equal(entitlement.RetainedUntil(*grace.GraceEndsAt)) || lapsed.RetentionWarnings != 0 {
		t.Fatalf("grace that ended: %+v", lapsed)
	}
	// A month late, the trial is read_only by now, its countdown begun when grace would have ended.
	late, _ := trial.Advance(trial.TrialEndsAt.Add(30 * day))
	if late.Billing != entitlement.ReadOnly || !late.LapsedAt.Equal(trial.TrialEndsAt.Add(entitlement.GraceFor)) {
		t.Fatalf("a trial a month past: %+v", late)
	}
	dunning := status(entitlement.PastDue)
	if got, _ := dunning.Advance(*dunning.DunningEndsAt); got.Billing != entitlement.Grace ||
		!got.GraceEndsAt.Equal(dunning.DunningEndsAt.Add(entitlement.GraceFor)) || got.DunningEndsAt == nil {
		t.Fatalf("dunning that ended: %+v", got)
	}
	for _, s := range []entitlement.Status{status(entitlement.Active), status(entitlement.ReadOnly), status(entitlement.Canceled)} {
		if _, changed := s.Advance(t0.Add(10 * 365 * day)); changed {
			t.Errorf("%s moved on its own", s.Billing)
		}
	}
	held := trial
	held.Restriction, held.SuspendedAt = restrct, at(t0)
	if got, _ := held.Advance(trial.TrialEndsAt); got.Billing != entitlement.Grace || got.State() != entitlement.Suspended {
		t.Fatalf("a suspended, restricted trial that ended: %+v", got)
	}
}

// A lapsed household's data is deleted 12 months and 30 days after it lapsed (D-119), and its owners
// are warned a month, a week and a day before; a warning says how many days are left, rounded up.
func TestTheRetentionCountdown(t *testing.T) {
	lapse := time.Date(2026, 9, 9, 14, 2, 0, 0, time.UTC)
	until := entitlement.RetainedUntil(lapse)
	if want := time.Date(2027, 10, 9, 14, 2, 0, 0, time.UTC); !until.Equal(want) {
		t.Fatalf("retained until %s, want %s", until, want)
	}
	s := entitlement.Status{Billing: entitlement.Canceled, LapsedAt: &lapse, RetainedUntil: &until}
	for _, tc := range []struct {
		at        time.Time
		due, left int
	}{
		{lapse, 0, 395},
		{until.Add(-30*day - time.Second), 0, 31},
		{until.Add(-30 * day), 1, 30},
		{until.Add(-7 * day), 2, 7},
		{until.Add(-day), 3, 1},
		{until.Add(-time.Hour), 3, 1},
		{until, 3, 0},
	} {
		if due, left := s.WarningsDue(tc.at), s.DaysLeft(tc.at); due != tc.due || left != tc.left {
			t.Errorf("at %s: %d warnings due, %d days left; want %d, %d", tc.at, due, left, tc.due, tc.left)
		}
	}
	if due := status(entitlement.Active).WarningsDue(until); due != 0 {
		t.Errorf("an active household is warned %d times", due)
	}
}

// DD-9: the trial is silent for twenty days, a dismissible notice on days 21 to 25, then a banner.
func TestTheTrialsNotices(t *testing.T) {
	s := status(entitlement.Trialing)
	start := s.TrialEndsAt.Add(-entitlement.TrialFor)
	for _, tc := range []struct {
		at   time.Time
		want string
	}{
		{start, entitlement.NoticeNone},
		{start.Add(20*day - time.Second), entitlement.NoticeNone},
		{start.Add(20 * day), entitlement.NoticeNotice},
		{start.Add(25*day - time.Second), entitlement.NoticeNotice},
		{start.Add(25 * day), entitlement.NoticeBanner},
		{s.TrialEndsAt.Add(-time.Second), entitlement.NoticeBanner},
	} {
		if got := s.TrialNotice(tc.at); got != tc.want {
			t.Errorf("at day %.2f: %s, want %s", tc.at.Sub(start).Hours()/24, got, tc.want)
		}
	}
	if got := status(entitlement.Active).TrialNotice(start.Add(27 * day)); got != entitlement.NoticeNone {
		t.Errorf("an active household's notice: %s", got)
	}
}

// The banner's data: each state's clock while it runs, the restriction whatever the state, and the
// suspension.
func TestTheBanner(t *testing.T) {
	by := uuid.New()
	reason := "We are moving house"
	restricted := status(entitlement.ReadOnly)
	restricted.Restriction = &entitlement.Restriction{At: t0, By: &by, Label: "Jana", Reason: &reason}
	got := restricted.Summary(t0)
	if got.State != entitlement.ReadOnly || got.CanWrite || got.CanUpload || got.DataRetainedUntil == nil ||
		got.TrialEndsAt != nil || got.GraceEndsAt != nil || got.Restriction == nil ||
		*got.Restriction.RestrictedBy.UserID != by || got.Restriction.RestrictedBy.Label != "Jana" ||
		got.Restriction.RestrictedBy.IsFormerMember || *got.Restriction.Reason != reason {
		t.Fatalf("a restricted lapse: %+v", got)
	}
	gone := status(entitlement.Active)
	gone.Restriction = &entitlement.Restriction{At: t0, Label: "Jana"}
	if got := gone.Summary(t0); got.State != entitlement.Restricted || !got.Restriction.RestrictedBy.IsFormerMember {
		t.Fatalf("a restriction by an account that is gone: %+v", got)
	}
	if got := status(entitlement.Grace).Summary(t0); got.GraceEndsAt == nil || !got.CanWrite || got.CanUpload {
		t.Fatalf("grace: %+v", got)
	}
	if got := status(entitlement.Trialing).Summary(t0); got.TrialEndsAt == nil || got.TrialNotice != entitlement.NoticeNone {
		t.Fatalf("a trial: %+v", got)
	}
	suspended := status(entitlement.Active)
	suspended.SuspendedAt = at(t0)
	if got := suspended.Summary(t0); got.State != entitlement.Suspended || got.SuspendedAt == nil || got.CanWrite {
		t.Fatalf("a suspension: %+v", got)
	}
}

// FR-BI1's gate, over every household-scoped operation of the contract in every state: a suspended
// household answers each 404; otherwise a read always goes on, and so does an unsafe operation in a
// state that writes or on one of the closed list of exemptions, which are exactly the operations that
// declare no 402; every other is refused 402, with entitlement_restricted in a restriction.
func TestTheGateOverEveryStateMethodAndPath(t *testing.T) {
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	statuses := map[entitlement.State]entitlement.Status{}
	for _, billing := range []entitlement.State{
		entitlement.Trialing, entitlement.Active, entitlement.PastDue, entitlement.Grace, entitlement.ReadOnly, entitlement.Canceled,
	} {
		statuses[billing] = status(billing)
	}
	restricted := status(entitlement.Active)
	restricted.Restriction = restrct
	statuses[entitlement.Restricted] = restricted
	suspended := status(entitlement.Active)
	suspended.SuspendedAt = at(t0)
	statuses[entitlement.Suspended] = suspended

	checked := 0
	for _, op := range c.Operations() {
		if !strings.HasPrefix(op.Path, "/households/{household_id}") {
			continue
		}
		unsafe := op.Method != http.MethodGet && op.Method != http.MethodHead
		for st, s := range statuses {
			err := entitlement.Gate(s, access.Owner, op.ID, op.Method)
			var p *problem.Problem
			switch {
			case st == entitlement.Suspended:
				if !errors.As(err, &p) || p.Status != http.StatusNotFound {
					t.Errorf("%s %s, suspended: %v", op.Method, op.Path, err)
				}
			case !unsafe, st.Writes(), !op.Declares(http.StatusPaymentRequired):
				if err != nil {
					t.Errorf("%s %s (%s), %s: refused %v", op.Method, op.Path, op.ID, st, err)
				}
			default:
				want := problem.CodeEntitlementReadOnly
				if st == entitlement.Restricted {
					want = problem.CodeEntitlementRestricted
				}
				if !errors.As(err, &p) || p.Status != http.StatusPaymentRequired || p.Code != want {
					t.Errorf("%s %s (%s), %s: %v, want 402 %s", op.Method, op.Path, op.ID, st, err, want)
				}
			}
			checked++
		}
	}
	if checked < 8*400 {
		t.Fatalf("only %d operations × states checked", checked)
	}
	// A request no route matches is refused as an unsafe one is, never let through.
	if err := entitlement.Gate(status(entitlement.ReadOnly), access.Owner, "", http.MethodPost); err == nil {
		t.Fatal("an unrouted write went on in a household that does not write")
	}
}

// The exemptions are a closed list (FR-BI1, D-117): exactly the household-scoped unsafe operations
// the contract declares no 402 on, and each one of them.
func TestTheExemptionsAreTheOperationsThatDeclareNo402(t *testing.T) {
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	var undeclared []string
	for _, op := range c.Operations() {
		if strings.HasPrefix(op.Path, "/households/{household_id}") && op.Method != http.MethodGet &&
			!op.Declares(http.StatusPaymentRequired) {
			undeclared = append(undeclared, op.ID)
		}
	}
	exempt := entitlement.Exemptions()
	slices.Sort(undeclared)
	slices.Sort(exempt)
	if !slices.Equal(undeclared, exempt) {
		t.Fatalf("the contract declares no 402 on\n  %v\nand the gate exempts\n  %v", undeclared, exempt)
	}
}
