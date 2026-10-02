package entitlement

import (
	"time"
)

// The clocks a household's subscription runs on (PRD 04 §1, §3, §6; D-32).
const (
	// TrialFor is the trial, from the household's creation (FR-HH1).
	TrialFor = 30 * 24 * time.Hour
	// DunningFor is how long the retries of a failed payment go on, at 1, 3, 5 and 7 days (PRD 04
	// §6), before the household enters grace. Stripe's webhooks (item 19) say so as it happens; the
	// hourly job holds a household to it when they do not.
	DunningFor = 7 * 24 * time.Hour
	// GraceFor is grace, after the trial ends unpaid or dunning is exhausted.
	GraceFor = 14 * 24 * time.Hour
	// WarnFor is how long a lapsed household is warned before its data is deleted, after the 12
	// months it is retained (D-119).
	WarnFor = 30 * 24 * time.Hour
)

// Warnings are the three warnings a lapsed household's owners are sent, each this long before its
// data is deleted: a month, a week and a day (D-119).
var Warnings = [...]time.Duration{30 * 24 * time.Hour, 7 * 24 * time.Hour, 24 * time.Hour}

// RetainedUntil is when the data of a household that lapsed at lapsed is deleted: 12 months after,
// then WarnFor in which it is warned (D-32, D-119). It is the date the household is shown from the
// day it lapses, so that nobody is deleted by surprise.
func RetainedUntil(lapsed time.Time) time.Time {
	return lapsed.UTC().AddDate(1, 0, 0).Add(WarnFor)
}

// Advance returns s as the clock at now leaves it, and whether that changed anything: a trial that
// ended unpaid, and dunning that was exhausted, enter grace, and grace that ended enters read_only,
// whose countdown starts then. Each step is timed from the deadline that ends the last, never from
// now, so a household the hourly job reaches late lapses when it would have: a trial that ended a
// month ago is read_only by now, with a fortnight of its countdown gone. A restriction and a
// suspension leave the clocks running beneath them (FR-BI7: billing is unaffected).
func (s Status) Advance(now time.Time) (Status, bool) {
	next, changed := s, false
	for {
		switch {
		case next.Billing == Trialing && !now.Before(next.TrialEndsAt):
			next.Billing, next.GraceEndsAt = Grace, at(next.TrialEndsAt.Add(GraceFor))
		case next.Billing == PastDue && next.DunningEndsAt != nil && !now.Before(*next.DunningEndsAt):
			next.Billing, next.GraceEndsAt = Grace, at(next.DunningEndsAt.Add(GraceFor))
		case next.Billing == Grace && next.GraceEndsAt != nil && !now.Before(*next.GraceEndsAt):
			lapsed := *next.GraceEndsAt
			next.Billing, next.LapsedAt, next.RetainedUntil, next.RetentionWarnings = ReadOnly, at(lapsed), at(RetainedUntil(lapsed)), 0
		default:
			return next, changed
		}
		changed = true
	}
}

func at(t time.Time) *time.Time { return &t }

// WarningsDue is how many of the three warnings are due at now for s: none until a month before its
// data is deleted, and none for a household that has not lapsed.
func (s Status) WarningsDue(now time.Time) int {
	if !s.Billing.lapsed() || s.RetainedUntil == nil {
		return 0
	}
	due := 0
	for _, before := range Warnings {
		if !now.Before(s.RetainedUntil.Add(-before)) {
			due++
		}
	}
	return due
}

// DaysLeft is how many days, rounded up, are left at now before s's data is deleted, which a
// warning says: 30, 7 and 1 when each goes out on time.
func (s Status) DaysLeft(now time.Time) int {
	if s.RetainedUntil == nil {
		return 0
	}
	left := s.RetainedUntil.Sub(now)
	if left <= 0 {
		return 0
	}
	return int((left + 24*time.Hour - 1) / (24 * time.Hour))
}

// The trial's notices (DD-9): silent for twenty days, a dismissible notice on days 21 to 25, then a
// persistent, non-blocking banner for the last five.
const (
	NoticeNone   = "none"
	NoticeNotice = "notice"
	NoticeBanner = "banner"
)

// TrialNotice is which of DD-9's stages s's trial is in at now: none outside the trial.
func (s Status) TrialNotice(now time.Time) string {
	if s.State() != Trialing || s.TrialEndsAt.IsZero() {
		return NoticeNone
	}
	switch left := s.TrialEndsAt.Sub(now); {
	case left <= 5*24*time.Hour:
		return NoticeBanner
	case left <= 10*24*time.Hour:
		return NoticeNotice
	}
	return NoticeNone
}
