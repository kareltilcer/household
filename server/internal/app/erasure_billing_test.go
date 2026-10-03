package app_test

import (
	"encoding/json"
	"errors"
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
