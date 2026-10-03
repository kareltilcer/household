package billing

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stripe/stripe-go/v87"

	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	households "github.com/kareltilcer/household/server/internal/platform/household"
)

// What a household's subscriptions make of its state (PRD 04 §3), state by state: the processor's
// word moves a household only where it has something to say of it.
func TestWhatASubscriptionMakesOfAHousehold(t *testing.T) {
	now := time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)
	earlier := now.Add(-48 * time.Hour)
	at := func(t time.Time) *time.Time { return &t }
	requested, failed := ReasonRequested, "payment_failed"
	current := func(status string) []subscription {
		return []subscription{{id: "sub_1", standing: standingCurrent, status: status, startedAt: &earlier}}
	}
	ended := func(reason *string) []subscription {
		return []subscription{{id: "sub_1", standing: standingEnded, status: StatusCanceled, reason: reason, startedAt: &earlier, endedAt: &now}}
	}
	lapsed := entitlement.Status{
		Billing: entitlement.ReadOnly, DunningEndsAt: &earlier, LapsedAt: &earlier, RetainedUntil: at(entitlement.RetainedUntil(earlier)),
		RetentionWarnings: 2,
	}
	for name, tc := range map[string]struct {
		old  entitlement.Status
		subs []subscription
		want entitlement.Status
	}{
		"a first payment ends the trial": {
			old: entitlement.Status{Billing: entitlement.Trialing}, subs: current(StatusActive),
			want: entitlement.Status{Billing: entitlement.Active},
		},
		"a payment restores a lapsed household and clears its countdown": {
			old: lapsed, subs: current(StatusActive), want: entitlement.Status{Billing: entitlement.Active},
		},
		"one waiting out another's period is paid up": {
			old: entitlement.Status{Billing: entitlement.PastDue, DunningEndsAt: &earlier}, subs: current(StatusTrialing),
			want: entitlement.Status{Billing: entitlement.Active},
		},
		"a failed renewal starts the backstop's clock, a day past the retries": {
			old: entitlement.Status{Billing: entitlement.Active}, subs: current(StatusPastDue),
			want: entitlement.Status{Billing: entitlement.PastDue, DunningEndsAt: at(now.Add(8 * 24 * time.Hour))},
		},
		"a second failure leaves the clock where it was": {
			old: entitlement.Status{Billing: entitlement.PastDue, DunningEndsAt: &earlier}, subs: current(StatusPastDue),
			want: entitlement.Status{Billing: entitlement.PastDue, DunningEndsAt: &earlier},
		},
		"a household the backstop took into grace stays there while the retries go on": {
			old:  entitlement.Status{Billing: entitlement.Grace, DunningEndsAt: &earlier, GraceEndsAt: at(now.Add(time.Hour))},
			subs: current(StatusPastDue),
			want: entitlement.Status{Billing: entitlement.Grace, DunningEndsAt: &earlier, GraceEndsAt: at(now.Add(time.Hour))},
		},
		"the processor giving up is grace": {
			old: entitlement.Status{Billing: entitlement.PastDue, DunningEndsAt: &earlier}, subs: ended(&failed),
			want: entitlement.Status{Billing: entitlement.Grace, DunningEndsAt: &earlier, GraceEndsAt: at(now.Add(14 * 24 * time.Hour))},
		},
		"one that ended with no reason given is grace, with the clock that says it lapsed through dunning": {
			old: entitlement.Status{Billing: entitlement.Active}, subs: ended(nil),
			want: entitlement.Status{Billing: entitlement.Grace, DunningEndsAt: &now, GraceEndsAt: at(now.Add(14 * 24 * time.Hour))},
		},
		"a cancellation's period ending is canceled, with its countdown": {
			old: entitlement.Status{Billing: entitlement.Active}, subs: ended(&requested),
			want: entitlement.Status{Billing: entitlement.Canceled, LapsedAt: &now, RetainedUntil: at(entitlement.RetainedUntil(now))},
		},
		"a subscription that ended long ago says nothing of a lapse the clock is timing": {
			old: lapsed, subs: ended(&requested), want: lapsed,
		},
		"a trial with nothing subscribed is the clock's": {
			old: entitlement.Status{Billing: entitlement.Trialing}, subs: nil, want: entitlement.Status{Billing: entitlement.Trialing},
		},
		"one still waiting for its payment changes nothing": {
			old:  entitlement.Status{Billing: entitlement.Grace, GraceEndsAt: at(now.Add(time.Hour))},
			subs: []subscription{{id: "sub_2", standing: standingPending, status: StatusIncomplete}},
			want: entitlement.Status{Billing: entitlement.Grace, GraceEndsAt: at(now.Add(time.Hour))},
		},
	} {
		payer := uuid.New()
		got := decide(households.Billing{Status: tc.old, Payer: &payer}, tc.subs, now)
		if !same(got.Status, tc.want) || got.Payer == nil || *got.Payer != payer {
			t.Errorf("%s: %+v, want %+v", name, got.Status, tc.want)
		}
	}
}

// same reports whether a and b are one subscription's state and clocks.
func same(a, b entitlement.Status) bool {
	eq := func(x, y *time.Time) bool {
		if x == nil || y == nil {
			return x == y
		}
		return x.Equal(*y)
	}
	return a.Billing == b.Billing && eq(a.DunningEndsAt, b.DunningEndsAt) && eq(a.GraceEndsAt, b.GraceEndsAt) &&
		eq(a.LapsedAt, b.LapsedAt) && eq(a.RetainedUntil, b.RetainedUntil) && a.RetentionWarnings == b.RetentionWarnings
}

// What the processor says of a subscription moves its standing: one waiting is the household's once
// its invoice is paid, or, when it waits out another's period, once it has a payment method, and over
// once it expired; the household's is over once it is cancelled or given up; and one that is over
// stays over. One the processor has active while its payment, a bank debit, is still on its way waits
// on, as does one whose debit failed, which is then ended (D-131).
func TestWhatTheProcessorSaysMovesASubscriptionsStanding(t *testing.T) {
	now := time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)
	card := &PaymentMethod{ID: "pm_1", Brand: "visa", Last4: "4242", ExpMonth: 12, ExpYear: 2030}
	for name, tc := range map[string]struct {
		standing string
		said     Subscription
		want     string
	}{
		"waiting, paid":                          {standingPending, Subscription{Status: StatusActive, PaymentMethod: card, InvoiceStatus: InvoicePaid}, standingCurrent},
		"waiting, a debit on its way":            {standingPending, Subscription{Status: StatusActive, PaymentMethod: card, InvoiceStatus: InvoiceOpen}, standingPending},
		"waiting, a debit that failed":           {standingPending, Subscription{Status: StatusActive, PaymentMethod: card, InvoiceStatus: InvoiceVoid}, standingPending},
		"waiting, its invoice not read":          {standingPending, Subscription{Status: StatusActive, PaymentMethod: card}, standingPending},
		"waiting, still unpaid":                  {standingPending, Subscription{Status: StatusIncomplete}, standingPending},
		"waiting, never paid":                    {standingPending, Subscription{Status: StatusIncompleteExpired}, standingEnded},
		"waiting out a period, card confirmed":   {standingPending, Subscription{Status: StatusTrialing, PaymentMethod: card}, standingCurrent},
		"waiting out a period, no card":          {standingPending, Subscription{Status: StatusTrialing}, standingPending},
		"the household's, a payment failing":     {standingCurrent, Subscription{Status: StatusPastDue, PaymentMethod: card}, standingCurrent},
		"the household's, cancelled":             {standingCurrent, Subscription{Status: StatusCanceled}, standingEnded},
		"the household's, given up as unpaid":    {standingCurrent, Subscription{Status: StatusUnpaid}, standingEnded},
		"over, whatever the processor then says": {standingEnded, Subscription{Status: StatusActive, PaymentMethod: card}, standingEnded},
	} {
		got := subscription{standing: tc.standing, interval: Year}.said(tc.said, now)
		if got.standing != tc.want || got.status != tc.said.Status || got.interval != Year {
			t.Errorf("%s: %s (%s), want %s", name, got.standing, got.status, tc.want)
		}
		if (got.standing == standingCurrent && tc.standing == standingPending) != (got.startedAt != nil) {
			t.Errorf("%s: started at %v", name, got.startedAt)
		}
		if (tc.said.PaymentMethod != nil) != (got.brand != nil && got.last4 != nil && got.expMonth != nil) {
			t.Errorf("%s: the payment method's summary: %v", name, got.brand)
		}
	}

	// A first payment has failed only where the subscription is active over an invoice that is void or
	// written off: one still open is on its way, and one past due is the processor's to retry.
	for said, want := range map[Subscription]bool{
		{Status: StatusActive, InvoiceStatus: InvoiceVoid}:          true,
		{Status: StatusActive, InvoiceStatus: InvoiceUncollectible}: true,
		{Status: StatusActive, InvoiceStatus: InvoiceOpen}:          false,
		{Status: StatusActive, InvoiceStatus: InvoicePaid}:          false,
		{Status: StatusActive}:                                      false,
		{Status: StatusPastDue, InvoiceStatus: InvoiceVoid}:         false,
		{Status: StatusIncomplete, InvoiceStatus: InvoiceVoid}:      false,
	} {
		if got := said.Failed(); got != want {
			t.Errorf("%s over an invoice %q: failed %v, want %v", said.Status, said.InvoiceStatus, got, want)
		}
	}
}

// What is kept of a subscription is what the processor says of it now. Why it was cancelled goes once
// the cancellation is taken back, so that one the processor later leaves unpaid, saying no more, is a
// lapse into grace and not its payer's cancellation; and a payment method's last four are kept only
// where they are the four digits the row holds, which the last four characters of an IBAN are not
// in every country.
func TestWhatIsKeptOfWhatTheProcessorSays(t *testing.T) {
	now := time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)
	earlier := now.Add(-48 * time.Hour)
	requested := ReasonRequested
	row := subscription{id: "sub_1", standing: standingCurrent, interval: Month, reason: &requested, startedAt: &earlier}

	if resumed := row.said(Subscription{Status: StatusActive}, now); resumed.reason != nil {
		t.Errorf("a cancellation taken back is still kept as %q", *resumed.reason)
	}
	unpaid := row.said(Subscription{Status: StatusActive}, now).said(Subscription{Status: StatusUnpaid}, now)
	lapsed := decide(households.Billing{Status: entitlement.Status{Billing: entitlement.PastDue, DunningEndsAt: &earlier}},
		[]subscription{unpaid}, now)
	if unpaid.standing != standingEnded || lapsed.Status.Billing != entitlement.Grace {
		t.Errorf("one left unpaid after a cancellation taken back is %s and makes the household %s, want grace",
			unpaid.standing, lapsed.Status.Billing)
	}
	if failed := row.said(Subscription{Status: StatusCanceled, CancellationReason: "payment_failed"}, now); failed.reason == nil ||
		*failed.reason != "payment_failed" {
		t.Errorf("the reason the processor gives is kept as %v", failed.reason)
	}

	for last4, kept := range map[string]bool{"4242": true, "3000": true, "13AA": false, "12a4": false, "424": false, "42424": false, "": false} {
		got := row.said(Subscription{Status: StatusActive, PaymentMethod: &PaymentMethod{ID: "pm_1", Brand: "sepa_debit", Last4: last4}}, now)
		if (got.last4 != nil) != kept {
			t.Errorf("the last four %q: kept %v, want %v", last4, got.last4 != nil, kept)
		}
		if got.brand == nil || *got.brand != "sepa_debit" {
			t.Errorf("the last four %q: the method's kind is not kept", last4)
		}
	}
}

// An invoice's lines are told apart as the contract's Invoice names them: the plan's fee, a month's
// storage blocks with their count, a proration, and a credit.
func TestAnInvoicesLinesAreToldApart(t *testing.T) {
	plan := &stripe.InvoiceLineItemParent{SubscriptionItemDetails: &stripe.InvoiceLineItemParentSubscriptionItemDetails{}}
	prorated := &stripe.InvoiceLineItemParent{SubscriptionItemDetails: &stripe.InvoiceLineItemParentSubscriptionItemDetails{Proration: true}}
	item := &stripe.InvoiceLineItemParent{InvoiceItemDetails: &stripe.InvoiceLineItemParentInvoiceItemDetails{}}
	for name, tc := range map[string]struct {
		line     *stripe.InvoiceLineItem
		kind     string
		quantity string
	}{
		"the plan's fee":     {&stripe.InvoiceLineItem{Amount: 5988, Quantity: 1, Parent: plan}, LineBase, ""},
		"a proration":        {&stripe.InvoiceLineItem{Amount: -1200, Parent: prorated}, LineAdjustment, ""},
		"a month's blocks":   {&stripe.InvoiceLineItem{Amount: 200, Quantity: 2, Parent: item, Metadata: map[string]string{metaKind: LineStorage}}, LineStorage, "2"},
		"a credit":           {&stripe.InvoiceLineItem{Amount: -500, Parent: item}, LineCredit, ""},
		"any other item":     {&stripe.InvoiceLineItem{Amount: 300, Parent: item}, LineAdjustment, ""},
		"a line of no known": {&stripe.InvoiceLineItem{Amount: 100}, LineAdjustment, ""},
	} {
		got := lineOf(tc.line)
		quantity := ""
		if got.Quantity != nil {
			quantity = *got.Quantity
		}
		if got.Kind != tc.kind || quantity != tc.quantity || got.AmountMinor != tc.line.Amount {
			t.Errorf("%s: %+v (quantity %q), want %s", name, got, quantity, tc.kind)
		}
	}
}

// The plans: PRD 04 §1's figures by default, a household's own currency's where it has one and
// EUR's otherwise, and every price named that takes no payment for want of the processor's.
func TestThePlans(t *testing.T) {
	prices := DefaultPrices()
	if eur := prices.For("CZK"); eur.Currency != "EUR" || eur.Base(Year).AmountMinor != 5988 || eur.Base(Month).AmountMinor != 599 {
		t.Fatalf("a currency with no plan pays %+v", eur)
	}
	if gbp := prices.For("GBP"); gbp.Currency != "GBP" || gbp.Year.AmountMinor != 5388 || gbp.Block.AmountMinor != 100 {
		t.Fatalf("GBP pays %+v", gbp)
	}
	if got := prices.Unpriced(); len(got) != 6 || got[0] != "EUR year" || got[5] != "GBP block" {
		t.Fatalf("the default prices' missing processor prices: %v", got)
	}
	parsed, err := ParsePrices(`{"EUR": {"year": {"amount_minor": 5988, "price": "a"}, "month": {"amount_minor": 599, "price": "b"},
		"block": {"amount_minor": 100, "price": "c"}}}`)
	if err != nil || len(parsed.Unpriced()) != 0 || parsed.For("EUR").Block.ID != "c" {
		t.Fatalf("parsed: %+v, %v", parsed, err)
	}
	if _, err := ParsePrices(`{"EUR": {}} {}`); err == nil {
		t.Fatal("prices followed by something else were taken")
	}
}
