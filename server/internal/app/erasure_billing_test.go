package app_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/billing"
	"github.com/kareltilcer/household/server/internal/platform/billing/billingtest"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// The tests in this file prove what erasure and export owe billing (plan items 19 and 20): a
// household deleted is no longer charged, an erased account's customers at the payment processor go
// with it, and what billing keeps of a payer is in their exports. Stripe is billingtest's stand-in,
// asked by billing's own Stripe processor.

// paidPrivacySite is a privacy site whose billing asks stripe, the stand-in, on the site's clock.
func paidPrivacySite(t *testing.T) (*privacySite, *billingtest.Stripe) {
	t.Helper()
	var p *privacySite
	stripe := billingtest.New(t, func() time.Time { return p.clock.now() })
	p = privacySiteWith(t, apptest.Options{Processor: stripe.Processor(), Prices: billingtest.Prices()})
	return p, stripe
}

// customers counts the customers the platform keeps for user.
func (p *privacySite) customers(user uuid.UUID) int {
	p.t.Helper()
	return p.count("SELECT count(*) FROM billing_customers WHERE user_id = $1", user)
}

// A payer deletes their account once the household they pay for will charge nothing more (FR-PR3,
// D-137): while its subscription renews they are told to cancel first, and once they have cancelled
// it, however long the period it paid for still runs, nothing stands in the way. When the account is
// erased, the household that goes with it has its subscription ended at the processor, and the
// account's customer there is deleted with its row (ADR 0021).
func TestAPayersAccountGoesWithItsSubscriptionEndedAndItsCustomerDeleted(t *testing.T) {
	p, stripe := paidPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi")
	subscription, _ := p.paid(stripe, jana, h.ID, "year")
	if p.customers(janaID) != 1 {
		t.Fatalf("the platform keeps %d customers of hers", p.customers(janaID))
	}

	// The household is hers alone and goes with her account, but its subscription would renew.
	rec := jana.deleteAccount(passphrase)
	expect(t, rec, http.StatusConflict, problem.CodeAccountDeletionBlocked)
	var blocked struct {
		Sole  []json.RawMessage `json:"sole_owned_households"`
		Payer []uuid.UUID       `json:"billing_payer_for"`
	}
	decode(t, rec, &blocked)
	if len(blocked.Sole) != 0 || len(blocked.Payer) != 1 || blocked.Payer[0] != h.ID {
		t.Fatalf("with a subscription that renews, blocked by %+v", blocked)
	}
	// Cancelled, it runs to the end of the year it paid for and charges nothing more: she may go now.
	expect(t, jana.post(billingPath(h.ID, "/cancel"), ""), http.StatusOK, "")
	if state, _, _ := jana.entitlement(h.ID); state != "active" {
		t.Fatalf("cancelled at its period's end, the household is %s", state)
	}
	expect(t, jana.deleteAccount(passphrase), http.StatusAccepted, "")

	p.clock.advance(30*24*time.Hour + time.Minute)
	p.erase()
	if rows := p.rowsOf(h.ID); len(rows) != 0 {
		t.Fatalf("erased with her account, the household keeps %v", rows)
	}
	// Nothing charges for a household that is gone, and nothing is kept of her at the processor.
	if status, _, _ := stripe.Subscription(subscription); status != billing.StatusCanceled {
		t.Errorf("the subscription of the erased household is %s at the processor", status)
	}
	if deleted := stripe.Deleted(); len(deleted) != 1 || p.customers(janaID) != 0 {
		t.Errorf("the processor was asked to delete %v, and the platform keeps %d customers of hers", deleted, p.customers(janaID))
	}
	if n := p.count("SELECT count(*) FROM users WHERE id = $1 AND deleted_at IS NOT NULL", janaID); n != 1 {
		t.Error("her account was not erased")
	}
	// What the processor says of the subscription afterwards is about nothing, and is taken as said.
	p.told(stripe, "customer.subscription.deleted", subscription)
}

// A household its owner deleted is no longer charged (FR-PR6, ADR 0021): its subscription is ended
// at the processor as the household is erased, its payer's account and customer staying. While the
// processor cannot be asked, the household is not erased, and it is the next time the job runs.
func TestAHouseholdDeletedIsNoLongerCharged(t *testing.T) {
	p, stripe := paidPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi")
	subscription, _ := p.paid(stripe, jana, h.ID, "month")
	expect(t, jana.post(householdPath(h.ID, "/deletion"), `{"confirm_name":"Tilcerovi"}`), http.StatusAccepted, "")
	p.clock.advance(15 * 24 * time.Hour)
	jana.me()
	p.clock.advance(15*24*time.Hour + time.Minute)

	// The processor does not answer: nothing is erased, and the subscription is as it was.
	stripe.Down(true)
	if _, err := p.privacy.Erase(t.Context()); err == nil {
		t.Error("the job reported no failure with the processor down")
	}
	if p.count("SELECT count(*) FROM households WHERE id = $1", h.ID) != 1 {
		t.Fatal("the household was erased with its subscription still charging")
	}
	stripe.Down(false)
	if status, _, _ := stripe.Subscription(subscription); status != billing.StatusActive {
		t.Fatalf("before the erasure the subscription is %s", status)
	}

	p.erase()
	if rows := p.rowsOf(h.ID); len(rows) != 0 {
		t.Fatalf("erased, the household keeps %v", rows)
	}
	if status, _, _ := stripe.Subscription(subscription); status != billing.StatusCanceled {
		t.Errorf("the subscription of the erased household is %s at the processor", status)
	}
	if deleted := stripe.Deleted(); len(deleted) != 0 || p.customers(janaID) != 1 {
		t.Errorf("her account lives: the processor was asked to delete %v, and the platform keeps %d customers of hers", deleted, p.customers(janaID))
	}
}

// A lapsed household whose payer subscribes again is not deleted while the processor has the payment
// on its way (PRD 04 §3, D-32, D-131, D-140): a bank debit takes days to clear, the household is
// lapsed still until it has, and its retention may run out meanwhile. Resuming at any point of the
// window restores it, so the erasure waits for what the processor says: once the debit clears the
// household is active, with nothing left of its countdown, and a debit that fails ends the
// subscription, after which the household goes that night.
func TestALapsedHouseholdIsKeptWhileItsPaymentIsOnItsWay(t *testing.T) {
	// lapsed is a household whose retention ran out an hour ago with its three warnings sent, and
	// whose payer has just subscribed again by bank debit.
	lapsed := func(t *testing.T) (p *privacySite, stripe *billingtest.Stripe, h uuid.UUID, subscription, invoice string) {
		t.Helper()
		p, stripe = paidPrivacySite(t)
		jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
		h = jana.create("Tilcerovi").ID
		p.exec(`UPDATE households SET billing_state = 'read_only', lapsed_at = $2, retained_until = $3, retention_warnings = 3 WHERE id = $1`,
			h, p.clock.now().Add(-395*24*time.Hour), p.clock.now().Add(-time.Hour))
		subscription, invoice = stripe.ConfirmDebit(jana.startPaying(h, "year").ClientSecret)
		p.told(stripe, "customer.subscription.updated", subscription)

		p.erase()
		if p.count("SELECT count(*) FROM households WHERE id = $1", h) != 1 {
			t.Fatal("the household was erased with its payment on its way")
		}
		if status, _, _ := stripe.Subscription(subscription); status != billing.StatusActive {
			t.Fatalf("the subscription being paid is %s at the processor", status)
		}
		return p, stripe, h, subscription, invoice
	}

	t.Run("the debit clears", func(t *testing.T) {
		p, stripe, h, _, invoice := lapsed(t)
		stripe.ClearDebit(invoice)
		p.told(stripe, "invoice.paid", invoice)
		p.erase()
		if n := p.count("SELECT count(*) FROM households WHERE id = $1 AND billing_state = 'active' AND retained_until IS NULL", h); n != 1 {
			t.Fatal("paid for again, the household is not active with its countdown cleared")
		}
	})

	t.Run("the debit fails", func(t *testing.T) {
		p, stripe, h, subscription, invoice := lapsed(t)
		stripe.FailDebit(invoice)
		p.told(stripe, "invoice.voided", invoice)
		p.told(stripe, "customer.subscription.deleted", subscription)
		p.erase()
		if rows := p.rowsOf(h); len(rows) != 0 {
			t.Fatalf("its payment failed and its retention run out, the household keeps %v", rows)
		}
		if n := p.count("SELECT count(*) FROM erasures WHERE kind = 'household' AND id = $1 AND cause = 'lapsed'", h); n != 1 {
			t.Error("no tombstone of the lapsed household")
		}
	})
}

// A lapsed household whose payer has paid is kept though no event of the payment has arrived (PRD 04
// §3, D-32, D-140): the card went through at the processor and the server has no word of it yet, its
// webhook late or lost, so the household's rows say it is lapsed still, with a subscription that
// waits to be confirmed. The erasure ends a subscription that waits only while the processor says it
// still waits: one it says is paid for is left, the household with it, and the record is brought up
// to what the processor says, after which the household is active and no longer due.
func TestALapsedHouseholdPaidForIsKeptBeforeTheProcessorsWordArrives(t *testing.T) {
	p, stripe := paidPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi").ID
	p.exec(`UPDATE households SET billing_state = 'read_only', lapsed_at = $2, retained_until = $3, retention_warnings = 3 WHERE id = $1`,
		h, p.clock.now().Add(-395*24*time.Hour), p.clock.now().Add(-time.Hour))
	// She pays by card, and nothing tells the server: the row is as her request left it.
	subscription, _ := stripe.ConfirmPayment(jana.startPaying(h, "year").ClientSecret)
	if n := p.count("SELECT count(*) FROM billing_subscriptions WHERE household_id = $1 AND standing = 'pending' AND status = 'incomplete'", h); n != 1 {
		t.Fatalf("%d subscriptions of hers wait to be confirmed, want 1", n)
	}

	if _, err := p.privacy.Erase(t.Context()); !errors.Is(err, billing.ErrBehind) {
		t.Errorf("the job's failure is %v, want the payment its record has not", err)
	}
	if p.count("SELECT count(*) FROM households WHERE id = $1", h) != 1 {
		t.Fatal("the household was erased with its subscription paid for")
	}
	if status, _, _ := stripe.Subscription(subscription); status != billing.StatusActive {
		t.Fatalf("the subscription she paid for is %s at the processor", status)
	}
	// What the processor says is recorded as the job leaves it: active, with nothing left of its countdown.
	if n := p.count("SELECT count(*) FROM households WHERE id = $1 AND billing_state = 'active' AND retained_until IS NULL", h); n != 1 {
		t.Fatal("paid for again, the household is not active with its countdown cleared")
	}
	p.erase()
	if p.count("SELECT count(*) FROM households WHERE id = $1", h) != 1 {
		t.Fatal("the household was erased once its payment was recorded")
	}
}

// A lapsed household whose payment is recorded is kept though its own row does not say so yet (PRD 04
// §3, D-32, D-140). The event of a payment records the subscription as the household's in one
// transaction and settles the household's row from that record in the next: a household read between
// the two, or after a settling that failed and before its event is delivered again, is lapsed by its
// row and paid for by its subscription. The erasure reads it as paid for, and ends nothing; the event
// delivered again makes it active.
func TestALapsedHouseholdWhosePaymentIsRecordedIsKeptBeforeItsRowIsSettled(t *testing.T) {
	p, stripe := paidPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi").ID
	p.exec(`UPDATE households SET billing_state = 'read_only', lapsed_at = $2, retained_until = $3, retention_warnings = 3 WHERE id = $1`,
		h, p.clock.now().Add(-395*24*time.Hour), p.clock.now().Add(-time.Hour))
	subscription, _ := stripe.ConfirmPayment(jana.startPaying(h, "year").ClientSecret)
	// The record as the event's first transaction leaves it: the subscription is the household's, paid
	// up, and the household's row has not been settled from it.
	p.exec(`UPDATE billing_subscriptions SET standing = 'current', status = 'active', started_at = $2 WHERE household_id = $1`, h, p.clock.now())

	p.erase()
	if p.count("SELECT count(*) FROM households WHERE id = $1", h) != 1 {
		t.Fatal("the household was erased with its payment recorded and its row not yet settled")
	}
	if status, _, _ := stripe.Subscription(subscription); status != billing.StatusActive {
		t.Fatalf("the subscription she paid for is %s at the processor", status)
	}
	p.told(stripe, "customer.subscription.updated", subscription)
	if n := p.count("SELECT count(*) FROM households WHERE id = $1 AND billing_state = 'active' AND retained_until IS NULL", h); n != 1 {
		t.Fatal("settled, the household is not active with its countdown cleared")
	}
	p.erase()
	if p.count("SELECT count(*) FROM households WHERE id = $1", h) != 1 {
		t.Fatal("the household was erased once its payment was settled")
	}
}

// A lapsed household's own subscription, which the processor could not collect, is ended with the
// household only once the processor has given it up (PRD 04 §3, D-32, D-140). Where its payer has
// paid what was owed and no event of it has arrived, the rows say past due and the processor says
// paid: nothing is ended, the record is brought up to the processor's, and the household is active
// and no longer due. One the processor is still collecting, as it does only when set to leave a
// subscription past due once its retries end, may have a payment on its way that its status does not
// show: nothing is ended and the household is kept, the job reporting it each night, until the
// processor has given the subscription up.
func TestALapsedHouseholdsOwnSubscriptionIsEndedOnlyOnceTheProcessorHasGivenItUp(t *testing.T) {
	// owed is a household whose subscription went past due, whose retention then ran out with its three
	// warnings sent, and the invoice the processor could not collect.
	owed := func(t *testing.T) (p *privacySite, stripe *billingtest.Stripe, h uuid.UUID, subscription, invoice string) {
		t.Helper()
		p, stripe = paidPrivacySite(t)
		jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
		h = jana.create("Tilcerovi").ID
		subscription, _ = p.paid(stripe, jana, h, "month")
		invoice = stripe.FailPayment(subscription, false)
		p.told(stripe, "invoice.payment_failed", invoice)
		p.told(stripe, "customer.subscription.updated", subscription)
		if n := p.count("SELECT count(*) FROM billing_subscriptions WHERE household_id = $1 AND standing = 'current' AND status = 'past_due'", h); n != 1 {
			t.Fatalf("%d subscriptions of the household's are past due, want 1", n)
		}
		p.exec(`UPDATE households SET billing_state = 'read_only', dunning_ends_at = $2, grace_ends_at = NULL, lapsed_at = $2,
			retained_until = $3, retention_warnings = 3 WHERE id = $1`,
			h, p.clock.now().Add(-395*24*time.Hour), p.clock.now().Add(-time.Hour))
		return p, stripe, h, subscription, invoice
	}

	t.Run("paid since", func(t *testing.T) {
		p, stripe, h, subscription, invoice := owed(t)
		// She pays what was owed, and nothing tells the server.
		if err := stripe.Processor().Pay(t.Context(), invoice); err != nil {
			t.Fatal(err)
		}
		if _, err := p.privacy.Erase(t.Context()); !errors.Is(err, billing.ErrBehind) {
			t.Errorf("the job's failure is %v, want the payment its record has not", err)
		}
		if p.count("SELECT count(*) FROM households WHERE id = $1", h) != 1 {
			t.Fatal("the household was erased with its subscription paid for")
		}
		if status, _, _ := stripe.Subscription(subscription); status != billing.StatusActive {
			t.Fatalf("the subscription she paid for is %s at the processor", status)
		}
		if n := p.count("SELECT count(*) FROM households WHERE id = $1 AND billing_state = 'active' AND retained_until IS NULL", h); n != 1 {
			t.Fatal("paid for again, the household is not active with its countdown cleared")
		}
		p.erase()
		if p.count("SELECT count(*) FROM households WHERE id = $1", h) != 1 {
			t.Fatal("the household was erased once its payment was recorded")
		}
	})

	t.Run("still collected", func(t *testing.T) {
		p, stripe, h, subscription, _ := owed(t)
		// The processor has it past due still, and says so each night it is asked.
		for night := range 2 {
			if _, err := p.privacy.Erase(t.Context()); !errors.Is(err, billing.ErrCollecting) {
				t.Errorf("night %d: the job's failure is %v, want the subscription the processor still collects", night, err)
			}
			if p.count("SELECT count(*) FROM households WHERE id = $1 AND billing_state = 'read_only'", h) != 1 {
				t.Fatalf("night %d: the household was erased, or moved, with its subscription still collected", night)
			}
			if status, _, _ := stripe.Subscription(subscription); status != billing.StatusPastDue {
				t.Fatalf("night %d: the subscription still collected is %s at the processor", night, status)
			}
			if row := p.subscriptionRow(h, subscription); row != "current/past_due" {
				t.Fatalf("night %d: the subscription's row reads %q", night, row)
			}
		}
		// Given up, with no event of it: nothing is paid for or may yet be, and the household goes.
		stripe.GiveUp(subscription)
		p.erase()
		if rows := p.rowsOf(h); len(rows) != 0 {
			t.Fatalf("its retention run out and its subscription given up, the household keeps %v", rows)
		}
		if status, _, _ := stripe.Subscription(subscription); status != billing.StatusCanceled {
			t.Errorf("the subscription of the erased household is %s at the processor", status)
		}
	})

	// A deletion the household's owner scheduled waits for no payment: a subscription the processor is
	// still collecting is ended with it.
	t.Run("deleted by its owner", func(t *testing.T) {
		p, stripe, h, subscription, _ := owed(t)
		p.exec("UPDATE households SET deletion_id = $2, deletion_requested_at = $3, deletion_scheduled_at = $4 WHERE id = $1",
			h, uuid.Must(uuid.NewV7()), p.clock.now().Add(-30*24*time.Hour), p.clock.now().Add(-time.Minute))
		p.erase()
		if rows := p.rowsOf(h); len(rows) != 0 {
			t.Fatalf("its deletion come due, the household keeps %v", rows)
		}
		if status, _, _ := stripe.Subscription(subscription); status != billing.StatusCanceled {
			t.Errorf("the subscription of the deleted household is %s at the processor", status)
		}
	})
}

// subscriptionRow is what the platform keeps of household h's subscription id, its standing and its
// status as "standing/status", "" for none.
func (p *privacySite) subscriptionRow(h uuid.UUID, id string) string {
	p.t.Helper()
	var row string
	err := p.admin.QueryRow(p.t.Context(), `
		SELECT coalesce(max(standing || '/' || status), '') FROM billing_subscriptions
		WHERE household_id = $1 AND stripe_subscription_id = $2`, h, id).Scan(&row)
	if err != nil {
		p.t.Fatal(err)
	}
	return row
}

// A lapsed household whose payer subscribed again by bank debit is read from the processor where no
// event of the debit has arrived (PRD 04 §3, D-131, D-140): its rows say the subscription still waits
// to be confirmed, and the processor says it charges. Nothing is ended on those rows; what the
// processor says is recorded, and decides. A debit on its way keeps the household, which waits for
// it from then on, with no failure to report; one that has failed already ends the subscription, as
// the event of its failure would have, and the household goes on the job's next run.
func TestALapsedHouseholdsDebitTheServerHasNoWordOfIsReadFromTheProcessor(t *testing.T) {
	// debited is a household whose retention ran out an hour ago with its three warnings sent, whose
	// payer has just confirmed a bank debit that nothing has told the server of.
	debited := func(t *testing.T) (p *privacySite, stripe *billingtest.Stripe, h uuid.UUID, subscription, invoice string) {
		t.Helper()
		p, stripe = paidPrivacySite(t)
		jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
		h = jana.create("Tilcerovi").ID
		p.exec(`UPDATE households SET billing_state = 'read_only', lapsed_at = $2, retained_until = $3, retention_warnings = 3 WHERE id = $1`,
			h, p.clock.now().Add(-395*24*time.Hour), p.clock.now().Add(-time.Hour))
		subscription, invoice = stripe.ConfirmDebit(jana.startPaying(h, "year").ClientSecret)
		if row := p.subscriptionRow(h, subscription); row != "pending/incomplete" {
			t.Fatalf("with no event of the debit, the subscription's row reads %q", row)
		}
		return p, stripe, h, subscription, invoice
	}

	t.Run("on its way", func(t *testing.T) {
		p, stripe, h, subscription, invoice := debited(t)
		if _, err := p.privacy.Erase(t.Context()); !errors.Is(err, billing.ErrBehind) {
			t.Errorf("the job's failure is %v, want the payment its record has not", err)
		}
		if row := p.subscriptionRow(h, subscription); row != "pending/active" {
			t.Fatalf("read from the processor, the subscription's row reads %q", row)
		}
		// Recorded, the debit is waited for: the household is not due, and the job has nothing to report.
		p.erase()
		if p.count("SELECT count(*) FROM households WHERE id = $1 AND billing_state = 'read_only'", h) != 1 {
			t.Fatal("the household was erased, or made active, with its debit on its way")
		}
		if status, _, _ := stripe.Subscription(subscription); status != billing.StatusActive {
			t.Fatalf("the subscription being paid is %s at the processor", status)
		}
		stripe.ClearDebit(invoice)
		p.told(stripe, "invoice.paid", invoice)
		if n := p.count("SELECT count(*) FROM households WHERE id = $1 AND billing_state = 'active' AND retained_until IS NULL", h); n != 1 {
			t.Fatal("paid for again, the household is not active with its countdown cleared")
		}
	})

	t.Run("failed", func(t *testing.T) {
		p, stripe, h, subscription, invoice := debited(t)
		stripe.FailDebit(invoice)
		if _, err := p.privacy.Erase(t.Context()); !errors.Is(err, billing.ErrBehind) {
			t.Errorf("the job's failure is %v, want the payment its record has not", err)
		}
		// Read from the processor, the debit that failed ended the subscription, there and in its row.
		if row := p.subscriptionRow(h, subscription); row != "ended/canceled" {
			t.Fatalf("its debit failed, the subscription's row reads %q", row)
		}
		if status, _, _ := stripe.Subscription(subscription); status != billing.StatusCanceled {
			t.Fatalf("its debit failed, the subscription is %s at the processor", status)
		}
		if p.count("SELECT count(*) FROM households WHERE id = $1", h) != 1 {
			t.Fatal("the household was erased on the run that found its record behind")
		}
		p.erase()
		if rows := p.rowsOf(h); len(rows) != 0 {
			t.Fatalf("its payment failed and its retention run out, the household keeps %v", rows)
		}
	})
}

// A lapsed household whose subscription is over at the processor goes when its retention runs out,
// though no event of that end has arrived (D-119, D-140): its rows say the subscription is past due,
// or still waits to be confirmed, and the processor, asked before either is ended, says it gave up
// collecting it, left it unpaid, let it expire unconfirmed, or has it waiting unconfirmed still.
// Nothing there is paid for, so nothing is waited for: the household is erased on the first run, with
// no failure, and a subscription the processor still held is ended.
func TestALapsedHouseholdWhoseSubscriptionIsOverAtTheProcessorGoes(t *testing.T) {
	for name, tc := range map[string]struct {
		// over is what the processor made of the subscription on its own, of which no event arrives.
		over func(*billingtest.Stripe, string)
		// ends is the subscription's status at the processor once the household is erased.
		ends string
		// waits says the subscription was never confirmed, where the others went past due.
		waits bool
	}{
		"given up":    {over: (*billingtest.Stripe).GiveUp, ends: billing.StatusCanceled},
		"unpaid":      {over: (*billingtest.Stripe).LeaveUnpaid, ends: billing.StatusCanceled},
		"expired":     {over: (*billingtest.Stripe).Expire, ends: billing.StatusIncompleteExpired, waits: true},
		"unconfirmed": {over: func(*billingtest.Stripe, string) {}, ends: billing.StatusCanceled, waits: true},
	} {
		t.Run(name, func(t *testing.T) {
			p, stripe := paidPrivacySite(t)
			jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
			h := jana.create("Tilcerovi").ID
			lapsed := p.clock.now().Add(-395 * 24 * time.Hour)
			var (
				subscription, want string
				// dunned is the clock a lapse through dunning keeps, none for a trial that ran out unpaid.
				dunned *time.Time
			)
			if tc.waits {
				jana.startPaying(h, "month")
				ids := stripe.Subscriptions()
				subscription, want = ids[len(ids)-1], "pending/incomplete"
			} else {
				subscription, _ = p.paid(stripe, jana, h, "month")
				p.told(stripe, "invoice.payment_failed", stripe.FailPayment(subscription, false))
				p.told(stripe, "customer.subscription.updated", subscription)
				want, dunned = "current/past_due", &lapsed
			}
			p.exec(`UPDATE households SET billing_state = 'read_only', dunning_ends_at = $4, grace_ends_at = NULL, lapsed_at = $2,
				retained_until = $3, retention_warnings = 3 WHERE id = $1`, h, lapsed, p.clock.now().Add(-time.Hour), dunned)
			tc.over(stripe, subscription)
			if row := p.subscriptionRow(h, subscription); row != want {
				t.Fatalf("with no event of its end, the subscription's row reads %q, want %q", row, want)
			}

			p.erase()
			if rows := p.rowsOf(h); len(rows) != 0 {
				t.Fatalf("its retention run out and nothing paid for, the household keeps %v", rows)
			}
			if status, _, _ := stripe.Subscription(subscription); status != tc.ends {
				t.Errorf("the subscription of the erased household is %s at the processor, want %s", status, tc.ends)
			}
		})
	}
}

// A lapsed household is kept while a take-over's bank debit is on its way (PRD 04 §3, D-133, D-140):
// the payer's own subscription is past due, an owner took billing over with a debit that has not
// cleared, and the retention ran out meanwhile. The subscription that waits and charges is a payment
// on its way as any other is, so the household is not due, and neither subscription is ended; the
// debit cleared, billing is the new payer's and the household active.
func TestALapsedHouseholdIsKeptWhileATakeOversDebitIsOnItsWay(t *testing.T) {
	p, stripe := paidPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	eva, evaID := p.joined(jana, h.ID, "Eva", p.a("eva@tilcerovi.cz"), "owner", nil)
	old, _ := p.paid(stripe, jana, h.ID, "month")
	p.told(stripe, "invoice.payment_failed", stripe.FailPayment(old, true))
	p.told(stripe, "customer.subscription.updated", old)
	p.exec(`UPDATE households SET billing_state = 'read_only', dunning_ends_at = $2, grace_ends_at = NULL, lapsed_at = $2,
		retained_until = $3, retention_warnings = 3 WHERE id = $1`,
		h.ID, p.clock.now().Add(-395*24*time.Hour), p.clock.now().Add(-time.Hour))
	offers(t, jana, h.ID, evaID)
	stripe.DebitFrom("3000")
	p.told(stripe, "setup_intent.succeeded", stripe.ConfirmSetup(accepts(t, eva, h.ID).Confirmation.ClientSecret))
	ids := stripe.Subscriptions()
	taking := ids[len(ids)-1]
	if was, now := p.subscriptionRow(h.ID, old), p.subscriptionRow(h.ID, taking); was != "current/past_due" || now != "pending/active" {
		t.Fatalf("with the take-over's debit on its way, the rows read %q and %q", was, now)
	}

	p.erase()
	if p.count("SELECT count(*) FROM households WHERE id = $1", h.ID) != 1 {
		t.Fatal("the household was erased with a take-over's payment on its way")
	}
	if was, _, _ := stripe.Subscription(old); was != billing.StatusPastDue {
		t.Errorf("the payer's subscription is %s at the processor", was)
	}
	if now, _, _ := stripe.Subscription(taking); now != billing.StatusActive {
		t.Errorf("the subscription taking billing over is %s at the processor", now)
	}

	invoice := p.latestInvoice(stripe, taking)
	stripe.ClearDebit(invoice)
	p.told(stripe, "invoice.paid", invoice)
	if n := p.count("SELECT count(*) FROM households WHERE id = $1 AND billing_state = 'active' AND retained_until IS NULL AND billing_payer_id = $2",
		h.ID, evaID); n != 1 {
		t.Fatal("the debit cleared, the household is not active and its new payer's")
	}
}

// An account's erasure waits, with its household's, for a payment the household's record has not
// (FR-PR4, D-137, D-140). A payer whose subscription still waited to be confirmed asked for their
// account's deletion, which nothing blocked, and paid afterwards with no event of it arriving: the
// household that goes with the account is not erased on rows older than the payment, the account
// stays scheduled, and the job's next run, the payment recorded, ends the subscription with the
// household and erases the account, with its customer at the processor.
func TestAnAccountWaitsForAPaymentItsHouseholdsRecordHasNot(t *testing.T) {
	p, stripe := paidPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi").ID
	secret := jana.startPaying(h, "month").ClientSecret
	expect(t, jana.deleteAccount(passphrase), http.StatusAccepted, "")
	subscription, _ := stripe.ConfirmPayment(secret)
	p.clock.advance(30*24*time.Hour + time.Minute)

	if _, err := p.privacy.Erase(t.Context()); !errors.Is(err, billing.ErrBehind) {
		t.Errorf("the job's failure is %v, want the payment its record has not", err)
	}
	if p.count("SELECT count(*) FROM households WHERE id = $1", h) != 1 {
		t.Fatal("the household was erased on a reading older than its payment")
	}
	if n := p.count("SELECT count(*) FROM account_deletions d JOIN users u ON u.id = d.user_id WHERE u.id = $1 AND u.deleted_at IS NULL", janaID); n != 1 {
		t.Fatal("the account was erased, or is no longer scheduled, with its household left")
	}
	if status, _, _ := stripe.Subscription(subscription); status != billing.StatusActive {
		t.Fatalf("the subscription is %s at the processor before its payment is recorded", status)
	}

	p.erase()
	if rows := p.rowsOf(h); len(rows) != 0 {
		t.Fatalf("erased with her account, the household keeps %v", rows)
	}
	if status, _, _ := stripe.Subscription(subscription); status != billing.StatusCanceled {
		t.Errorf("the subscription of the erased household is %s at the processor", status)
	}
	if n := p.count("SELECT count(*) FROM users WHERE id = $1 AND deleted_at IS NOT NULL", janaID); n != 1 || p.customers(janaID) != 0 {
		t.Errorf("her account was not erased with its customer: %d customers kept", p.customers(janaID))
	}
}

// A deletion its owner scheduled waits for no payment (FR-PR6), and ends none the record has no word
// of either: where the processor says a subscription that waited is paid for, the erasure leaves the
// household for its next run, records what the processor says, and then ends the subscription the
// rows know charges, with the household.
func TestAHouseholdDeletedWithAPaymentItsRecordHasNotIsErasedOnceItIsRecorded(t *testing.T) {
	p, stripe := paidPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi").ID
	expect(t, jana.post(householdPath(h, "/deletion"), `{"confirm_name":"Tilcerovi"}`), http.StatusAccepted, "")
	p.clock.advance(15 * 24 * time.Hour)
	jana.me()
	p.clock.advance(15*24*time.Hour - time.Hour)
	subscription, _ := stripe.ConfirmPayment(jana.startPaying(h, "month").ClientSecret)
	p.clock.advance(time.Hour + time.Minute)

	if _, err := p.privacy.Erase(t.Context()); !errors.Is(err, billing.ErrBehind) {
		t.Errorf("the job's failure is %v, want the payment its record has not", err)
	}
	if p.count("SELECT count(*) FROM households WHERE id = $1", h) != 1 {
		t.Fatal("the household was erased on a reading older than its payment")
	}
	if status, _, _ := stripe.Subscription(subscription); status != billing.StatusActive {
		t.Fatalf("the subscription is %s at the processor before its payment is recorded", status)
	}
	p.erase()
	if rows := p.rowsOf(h); len(rows) != 0 {
		t.Fatalf("erased, the household keeps %v", rows)
	}
	if status, _, _ := stripe.Subscription(subscription); status != billing.StatusCanceled {
		t.Errorf("the subscription of the erased household is %s at the processor", status)
	}
}

// An owner taking billing over with a bank debit pays a subscription that will be the household's
// once the debit clears (FR-BI6, D-133, D-131), though billing is not theirs yet: their account is
// not deleted from under it either, disabled where nothing could hand billing on or cancel what then
// charges (FR-PR3, D-137). The request is blocked as a payer's is, naming the household, while the
// payment is on its way, and once it has cleared and billing is theirs.
func TestAnOwnerTakingBillingOverWaitsForTheirPaymentBeforeDeletingTheirAccount(t *testing.T) {
	p, stripe := paidPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	eva, evaID := p.joined(jana, h.ID, "Eva", p.a("eva@tilcerovi.cz"), "owner", nil)
	old, _ := p.paid(stripe, jana, h.ID, "month")
	p.told(stripe, "invoice.payment_failed", stripe.FailPayment(old, true))
	p.told(stripe, "customer.subscription.updated", old)
	offers(t, jana, h.ID, evaID)
	stripe.DebitFrom("3000")
	p.told(stripe, "setup_intent.succeeded", stripe.ConfirmSetup(accepts(t, eva, h.ID).Confirmation.ClientSecret))
	if sub := eva.subscription(h.ID); !sub.PaymentPending || sub.Payer.UserID == evaID {
		t.Fatalf("while her debit is on its way: %+v", sub)
	}

	blocked := func(when string) {
		t.Helper()
		rec := eva.deleteAccount(passphrase)
		expect(t, rec, http.StatusConflict, problem.CodeAccountDeletionBlocked)
		var doc struct {
			Payer []uuid.UUID `json:"billing_payer_for"`
		}
		decode(t, rec, &doc)
		if len(doc.Payer) != 1 || doc.Payer[0] != h.ID {
			t.Fatalf("%s, blocked by %+v", when, doc)
		}
	}
	blocked("with the payment that takes billing over on its way")

	ids := stripe.Subscriptions()
	invoice := p.latestInvoice(stripe, ids[len(ids)-1])
	stripe.ClearDebit(invoice)
	p.told(stripe, "invoice.paid", invoice)
	if sub := eva.subscription(h.ID); sub.Payer.UserID != evaID {
		t.Fatalf("once her debit cleared: %+v", sub)
	}
	blocked("as the household's payer")
}

// An owner whose account is scheduled for deletion counts as no owner, and billing is neither offered
// to them nor moved to them (FR-BI6, FR-PR3, D-137). One who accepted the payer's offer and asked for
// their account's deletion before their card was confirmed is no payer yet, and nothing blocks them.
// The card's confirmation that arrives afterwards, from the form they left open or late from the
// processor, moves nothing: no subscription is made for an account that signs nobody in, the payer
// goes on paying, and the household is not left without a subscription when that account's customer
// is deleted with it. Once they have cancelled the deletion they take billing over as any owner does.
func TestAnOwnerWhoseAccountIsBeingDeletedTakesNoBillingOver(t *testing.T) {
	p, stripe := paidPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi")
	address := p.a("eva@tilcerovi.cz")
	eva, evaID := p.joined(jana, h.ID, "Eva", address, "owner", nil)
	old, _ := p.paid(stripe, jana, h.ID, "month")
	offers(t, jana, h.ID, evaID)
	secret := accepts(t, eva, h.ID).Confirmation.ClientSecret

	// She has accepted and confirmed no card yet: billing is not hers, and nothing stands in her way.
	rec := eva.deleteAccount(passphrase)
	expect(t, rec, http.StatusAccepted, "")
	var d deletionDoc
	decode(t, rec, &d)

	p.told(stripe, "setup_intent.succeeded", stripe.ConfirmSetup(secret))
	if sub := jana.subscription(h.ID); sub.Payer == nil || sub.Payer.UserID != janaID {
		t.Fatalf("billing moved to an account that signs nobody in: %+v", sub.Payer)
	}
	if ids := stripe.Subscriptions(); len(ids) != 1 {
		t.Fatalf("the processor holds %v: a subscription was made for the account being deleted", ids)
	}
	if status, cancelled, _ := stripe.Subscription(old); status != billing.StatusActive || cancelled {
		t.Fatalf("the payer's subscription is %s at the processor, set to end with its period: %t", status, cancelled)
	}
	// Nor is billing offered to her while she is leaving.
	rec = jana.post(billingPath(h.ID, "/transfer"), fmt.Sprintf(`{"user_id":%q}`, evaID))
	if errs := fieldErrorsOf(t, rec); len(errs) != 1 || errs[0].Field != "/user_id" {
		t.Fatalf("offering billing to an owner whose account is being deleted answered %+v", errs)
	}

	// Her deletion cancelled, she is an owner as she was, and her card moves billing as any owner's does.
	expect(t, p.browser().post("/auth/deletion/cancel", jsonBody(t, map[string]string{"token": *d.CancelToken})), http.StatusNoContent, "")
	back := p.browser()
	back.login(address, passphrase)
	offers(t, jana, h.ID, evaID)
	p.told(stripe, "setup_intent.succeeded", stripe.ConfirmSetup(accepts(t, back, h.ID).Confirmation.ClientSecret))
	if sub := jana.subscription(h.ID); sub.Payer == nil || sub.Payer.UserID != evaID {
		t.Fatalf("her deletion cancelled and her card confirmed, the payer is %+v", sub.Payer)
	}
}

// A payer whose first payment is still on its way has a subscription that will charge (FR-PR3, D-137,
// D-131): a bank debit takes days to clear, and the subscription it pays for is the household's, and
// renews, once it has. Their account is not deleted from under it, disabled where nothing could
// cancel what then charges: the request is blocked as it is by a subscription that renews, until the
// processor says how the payment went and, where it went through, the payer has cancelled.
func TestAPayerWaitsForAPaymentOnItsWayBeforeDeletingTheirAccount(t *testing.T) {
	p, stripe := paidPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi")
	subscription, invoice := stripe.ConfirmDebit(jana.startPaying(h.ID, "month").ClientSecret)
	p.told(stripe, "customer.subscription.updated", subscription)

	blocked := func(when string) {
		t.Helper()
		rec := jana.deleteAccount(passphrase)
		expect(t, rec, http.StatusConflict, problem.CodeAccountDeletionBlocked)
		var doc struct {
			Payer []uuid.UUID `json:"billing_payer_for"`
		}
		decode(t, rec, &doc)
		if len(doc.Payer) != 1 || doc.Payer[0] != h.ID {
			t.Fatalf("%s, blocked by %+v", when, doc)
		}
	}
	blocked("with the payment on its way")

	// The debit clears: the subscription is the household's and renews, until its payer cancels it.
	stripe.ClearDebit(invoice)
	p.told(stripe, "invoice.paid", invoice)
	blocked("with the subscription paid for and renewing")
	expect(t, jana.post(billingPath(h.ID, "/cancel"), ""), http.StatusOK, "")
	expect(t, jana.deleteAccount(passphrase), http.StatusAccepted, "")

	// Erased with its household, so that nothing of either is left due for another test's job.
	p.clock.advance(30*24*time.Hour + time.Minute)
	p.erase()
	if n := p.count("SELECT count(*) FROM users WHERE id = $1 AND deleted_at IS NOT NULL", janaID); n != 1 || p.customers(janaID) != 0 {
		t.Errorf("her account was not erased with its customer: %d customers kept", p.customers(janaID))
	}
	if status, _, _ := stripe.Subscription(subscription); status != billing.StatusCanceled {
		t.Errorf("the subscription of the erased household is %s at the processor", status)
	}
}

// What billing keeps of a payer is theirs to take (FR-PR2): the payer's export of the household holds
// billing.json, their subscription with its payment method's summary and the invoices issued to
// them, without the processor's ids; another owner's holds none of it (FR-BI5), and neither does the
// export of a member who never paid.
func TestAnExportHoldsItsRequestersOwnBilling(t *testing.T) {
	p, stripe := paidPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	petr, petrID := p.joined(jana, h.ID, "Petr", p.a("petr@tilcerovi.cz"), "member", nil)
	expect(t, jana.post(householdPath(h.ID, "/ownership/transfer"), jsonBody(t, map[string]any{"user_id": petrID})), http.StatusOK, "")
	subscription, invoice := p.paid(stripe, jana, h.ID, "month")

	take := func(b *browser, path string) map[string]string {
		t.Helper()
		e := exportOf(t, b.post(path, ""), http.StatusAccepted)
		p.work()
		entries, _ := p.stored(e.ID)
		return entries
	}
	hers := take(jana, householdPath(h.ID, "/exports"))
	doc := hers["billing.json"]
	var kept struct {
		Subscriptions []struct {
			Status        string `json:"status"`
			Interval      string `json:"interval"`
			PaymentMethod struct {
				Last4 string `json:"last4"`
			} `json:"payment_method"`
		} `json:"subscriptions"`
		Invoices []struct {
			Status     string            `json:"status"`
			TotalMinor int64             `json:"total_minor"`
			Lines      []json.RawMessage `json:"lines"`
		} `json:"invoices"`
	}
	if err := json.Unmarshal([]byte(doc), &kept); err != nil || len(kept.Subscriptions) != 1 || kept.Subscriptions[0].Interval != "month" ||
		len(kept.Subscriptions[0].PaymentMethod.Last4) != 4 || len(kept.Invoices) != 1 || kept.Invoices[0].Status != "paid" ||
		kept.Invoices[0].TotalMinor == 0 || len(kept.Invoices[0].Lines) == 0 {
		t.Fatalf("her billing.json holds %s (%v)", doc, err)
	}
	if strings.Contains(doc, subscription) || strings.Contains(doc, invoice) || strings.Contains(doc, "cus_") {
		t.Errorf("her billing.json names the processor's ids: %s", doc)
	}
	if own := take(jana, "/me/exports"); own["households/"+h.ID.String()+"/billing.json"] == "" {
		t.Errorf("her own export holds %v, without her billing", names(own))
	}
	// Another owner reads none of the payer's invoices, and a household's export is no way round that.
	if his := take(petr, householdPath(h.ID, "/exports")); slices.Contains(names(his), "billing.json") {
		t.Errorf("another owner's export holds the payer's billing: %s", his["billing.json"])
	}
}
