# Billing: Stripe's account, keys, prices and webhook

A household's subscription is a Stripe subscription, paid by one of its owners; the server keeps
Stripe's ids, a payment method's summary and the invoices, and moves the household's entitlement on
what Stripe's webhooks name ([ADR 0020](../adr/0020-billing-the-processor-webhooks-the-payer-and-storage-lines.md),
PRD 04). Read this before an environment's first deploy, when a price changes or a currency is
added, when a key is rotated or leaks, when a payment went through and the household is not
`active`, and when a month's storage was not billed.

## What is where

| | |
|---|---|
| The keys | `HOUSEHOLD_STRIPE_SECRET_KEY` (`sk_…`, or a restricted `rk_…`), `HOUSEHOLD_STRIPE_PUBLISHABLE_KEY` (`pk_…`, which a client's payment form is made with) and `HOUSEHOLD_STRIPE_WEBHOOK_SECRET` (`whsec_…`). All three outside development; in development all three or none. A live key is production's alone, and a test key never production's: the server refuses to start otherwise |
| The prices | `HOUSEHOLD_BILLING_PRICES`, JSON: each currency's `year`, `month` and `block`, each an `amount_minor` and the Stripe `price` that charges it. Unset, the server shows PRD 04 §1's EUR and GBP figures and takes no payment. A household whose base currency has no entry is charged EUR's |
| Tax | `HOUSEHOLD_STRIPE_AUTOMATIC_TAX=true` has Stripe Tax compute each invoice's VAT |
| The webhook | `POST /api/v1/webhooks/stripe`, which Stripe signs |
| A household's state | Its own row: `billing_state` and its clocks. Moved by the webhooks through the mutation spine, and by the hourly `entitlement.transitions` job when a webhook never comes |
| What Stripe said | `billing_subscriptions` (`standing`: `pending`, `current` or `ended`), `billing_invoices`, `billing_transfers`, in the household; `billing_customers`, a payer's customer in each currency, on the account |
| A month's storage | `billing_storage_months`: the average, the blocks and the invoice item. The `billing.storage` job adds the month that ended, nightly at 01:30 UTC, after the usage sample |
| The request check | `pnpm run up:stripe`, then `HOUSEHOLD_TEST_STRIPE_URL=http://127.0.0.1:12111 go test ./internal/platform/billing/` from `server/`: Stripe's own mock validates every request the server sends. CI's `stripe` job runs it |
| Where Stripe is asked | Stripe's own API, in every deployment. `HOUSEHOLD_STRIPE_API_URL` names a stand-in for it in development alone, over http on the same machine only and with test-mode keys only; set in staging or production it stops the server from starting, since a deployment that could be pointed at another "Stripe" is one whose payments could be |
| The stand-in | `server/cmd/stripe-standin`: the stand-in the server's tests ask (`billingtest`), served as a process on `127.0.0.1:12112`, which the web's end-to-end suite starts beside its API and pays against ([below](#the-stand-in-the-end-to-end-suite-pays-against)). The suite's alone, never deployed |

## Before the first deploy

Staging holds synthetic data and uses Stripe's **test mode**; production uses live mode. Do each
step in the mode the environment uses.

1. **The account** is the EU entity's, with EU data processing (PRD 04 §6). Turn on the payment
   methods PRD 04 §6 names: cards, SEPA Direct Debit, Apple Pay and Google Pay. Register the web
   client's domain for Apple Pay. Turn **Link** off among the payment methods: the web's policy
   admits Stripe's own script, frames and API and nothing of `link.com`, so with Link on the
   payment form asks for a frame the page refuses
   ([ADR 0028](../adr/0028-the-catalog-in-parts-the-payment-form-the-entitlement-in-the-shell-and-what-a-household-shows-of-its-data.md)).
2. **Two products**: the plan, and a storage block. For each currency in PRD 04 §1 make three prices,
   tax-inclusive:
   - the plan, recurring yearly (EUR 59.88, GBP 53.88);
   - the plan, recurring monthly (EUR 5.99, GBP 5.49);
   - the block, **one-time** (EUR 1.00, GBP 1.00). It is billed as an invoice item with a quantity, and
     Stripe takes only a one-time price there.
3. **`HOUSEHOLD_BILLING_PRICES`** names them, with the amounts exactly as Stripe has them: the server
   shows the amount from this setting and Stripe charges the price, so a difference is a customer
   shown one figure and charged another.

   ```json
   {
     "EUR": {
       "year": { "amount_minor": 5988, "price": "price_…" },
       "month": { "amount_minor": 599, "price": "price_…" },
       "block": { "amount_minor": 100, "price": "price_…" }
     }
   }
   ```

   CZK and PLN have no figures yet (plan Q1): leave them out, and those households are charged in
   EUR. Adding a currency later is adding its three prices at Stripe and its entry here; households
   already subscribed keep the currency they subscribed in.
4. **Retries** (Billing → Revenue recovery → Retries). PRD 04 §6 retries at 1, 3, 5 and 7 days after
   the first failure, which Stripe's settings cannot say exactly: a custom schedule takes at most
   three retries, and Smart Retries picks its own days. Choose one: **Smart Retries, 4 retries
   within 1 week**, which keeps the PRD's four retries inside its seven days, on days Stripe picks;
   or Smart Retries off and a custom schedule of three, **1, 3 and 3 days after the previous
   attempt**, which are days 1, 4 and 7. Which of the two stands for the PRD's schedule is the
   product owner's to say. The server takes either: it emails the payer as each retry fails,
   whichever days they fall on, and its own clock ends a day after the seventh. Set retries here and
   **not through an automation**: with one, Stripe sets an invoice's next attempt only after it has
   sent `invoice.payment_failed`, and each retry's email would say it was the last. When all retries
   fail: **cancel the subscription**. Marking it `unpaid` instead ends in grace the same way. **Never
   leave it `past_due`.** The household would still end in grace, a day late, by the hourly job, but
   Stripe goes on issuing an invoice each period for a subscription it has not given up on, and the
   server knows such a subscription to be paid for by its status alone, which Stripe makes `active`
   only once a payment has succeeded. A payer who paid what was owed by bank debit in the last days
   of a lapsed household's retention would be past due still while the debit cleared, which the
   server cannot tell from nobody paying: so the nightly erasure ends no subscription of a lapsed
   household that Stripe is still collecting, and with this setting a household that lapsed on a
   failed payment would never be erased (below, step 7). With the subscription cancelled or
   unpaid, the payer of a lapsed household subscribes again, and a debit on its way is waited for.
   The invoice may be left open or marked
   uncollectible: the last retry is emailed either way.
   Turn Stripe's own customer emails for failed payments and invoices **off**: the server sends its
   own, in the payer's language.
5. **The webhook endpoint**: `https://<api>/api/v1/webhooks/stripe`, at the API version stripe-go is
   pinned to (`server/go.mod`; the server reads each object from Stripe itself, so another version
   still works), sending:
   `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`,
   `invoice.marked_uncollectible`, `setup_intent.succeeded`.
   Its signing secret is `HOUSEHOLD_STRIPE_WEBHOOK_SECRET`.
6. **A restricted key** for the server is enough: write on Customers, Subscriptions, Invoices,
   Invoice items, Setup Intents and Customer balance transactions, read on Prices and Payment methods.
7. **Subscribe a household in test mode on staging**, with Stripe's test card `4242 4242 4242 4242`,
   and watch it become `active`; then fail a renewal with a test clock and watch it become
   `past_due`. The tests prove the server against a stand-in and Stripe's mock; this is the first
   real payment.

## A payment went through and the household is not `active`

1. In Stripe, open the webhook endpoint's deliveries. A `500` is in the API's log as
   `billing: a webhook failed`, with the event's id and type; a `422` is a signature that did not
   verify: the endpoint's secret is not the one in `HOUSEHOLD_STRIPE_WEBHOOK_SECRET`, or the request
   was not Stripe's.
2. **Resend the event from Stripe.** The handler reads the subscription from Stripe as it stands, so
   any `customer.subscription.updated` for it puts the household right, however old the event.
3. If no event names the subscription at all, its metadata is missing `household_id`: it was not
   made by the server. A subscription made by hand in the dashboard is none of any household's.
4. A household whose payer starts subscribing again while one waits unpaid is also read from Stripe
   first, which records a payment whose event never arrived.
5. **A SEPA Direct Debit is not paid yet.** Stripe shows the subscription `active` from the moment
   the debit is asked for, and its invoice `open` for the days the debit takes. The household stays
   as it was until `invoice.paid` arrives, its billing screen saying a payment is on its way, and
   that is as intended. A debit that fails has its invoice voided: the server then cancels the
   subscription at Stripe and emails the payer that it was not started. A household stuck with a
   payment pending is one whose `invoice.paid` or `invoice.voided` never arrived: resend it.

The same holds the other way round. A subscription that ended at Stripe, cancelled at its period's
end or given up on, while the household still reads `active` is one whose events never arrived in the
three days Stripe delivers them for. No job makes up for that: the hourly one runs the clock of a
failed payment only. Resend its `customer.subscription.deleted`, or any event of it.

## A month's storage was not billed

`billing_storage_months` has no row for the household and the month.

1. Look for `billing: a month's storage was not billed` in the API's log. The job tries again the
   next night, and bills each month once: before it makes the invoice item it looks for the month's
   at Stripe.
2. No row and no error means the household was not billed on purpose: no subscription of its own
   before the month ended, or one that no longer charges.
3. A row with blocks and an invoice item is billed: the item is on the subscription's next invoice,
   or, for a yearly subscription, on the month's own.

## A household or an account is erased

The nightly erasure (02:30 UTC, [ADR 0021](../adr/0021-export-erasure-and-the-tombstones.md)) ends a
deleted household's subscriptions at Stripe before its rows go, and deletes an erased account's
customers there with their rows.

1. `privacy: an erasure failed` in the API's log, with Stripe's error beside it, means Stripe could
   not be asked: that household was not erased, or that account's own rows and customers were not,
   whatever of its households the run had already been through, and the job tries again fifteen
   minutes later and the next night. A household or an account keeps being due until it is erased.
2. A subscription ended this way is cancelled at once, with no final invoice and nothing prorated.
   Stripe then sends `customer.subscription.deleted` for a household the server no longer has, which
   it answers `204` and makes nothing of.
3. Stripe keeps the invoices of a deleted customer. They are the statutory record (PRD 05 §1), and
   the server keeps none of them once the household is gone.
4. A deleted household that is still charged was erased while Stripe held a subscription the server
   had no row for. Cancel it in Stripe's dashboard, by the household's id in its metadata.
5. A lapsed household past its `retained_until`, its three warnings sent, that the job leaves alone
   is being paid for again: `billing_subscriptions` has a row of its with `standing = 'pending'` and a
   `status` that charges, a bank debit on its way (above). It is `active` once `invoice.paid`
   arrives, and erased the night after the debit failed. One that stays so for weeks is one whose
   `invoice.paid` or `invoice.voided` never arrived: resend it. Or it is paid for already: a row
   with `standing = 'current'` and the `status` `active` or `trialing`, in a household that still
   reads lapsed, is a payment recorded whose event failed before the household's own row was
   settled from it (`billing: a webhook failed`). Stripe delivers that event again, which settles
   it; if it has given up, resend any event of the subscription.
6. `privacy: an erasure failed` with `billing: the processor has a payment the household's record
   has not` means Stripe says a subscription is paid for, or being paid, that the server had
   recorded as still waiting to be confirmed, or as its household's own and past due: its events
   are late or were never delivered. Nothing was ended or erased. The line before it,
   `privacy: a household is not erased on a record older than a payment for it`, names the
   household. The job has recorded what Stripe says by the time it logs this, and tries
   again fifteen minutes later: a lapsed household that was paid for is `active` by then and no
   longer due, and one whose owner scheduled its deletion is erased, its subscription ended. Seen
   more than once a night, look at the webhook endpoint's deliveries in Stripe's dashboard: events
   are not arriving.
7. `privacy: an erasure failed` with `billing: the processor is still collecting a lapsed
   household's subscription` means a household's retention ran out, its three warnings sent, while
   Stripe has its subscription `past_due` still, a year and more after the payment failed. Nothing
   was ended or erased, and the line repeats each night: the household is kept past its retention
   until Stripe says the subscription is over, or paid for. Stripe gives a subscription up when its
   retries end unless it is set to leave it past due, which "Before the first deploy", step 4,
   rules out: put the setting right, then look at the subscription's latest invoice in Stripe's
   dashboard. With a payment on its way, leave it: paid, the household is `active`. With none,
   cancel the subscription there, and the household is erased the next night.

## The stand-in the end-to-end suite pays against

The web's end-to-end suite (`apps/web/playwright.config.ts`) takes a household through subscribing,
lapsing and reading on (06-clients §8) with no account at Stripe, no secret and no network to it.
It starts `go run ./cmd/stripe-standin serve` beside its API, and gives the API five settings:
`HOUSEHOLD_STRIPE_API_URL=http://127.0.0.1:12112`, the stand-in's three keys (`sk_test_standin`,
`pk_test_standin`, `whsec_standin`: `billingtest`'s published ones, which open nothing), and
`HOUSEHOLD_BILLING_PRICES` with the stand-in's plans. What then runs is the server's own Stripe
adapter, stripe-go and its signature check included, asking the stand-in where it would ask Stripe.
Stripe.js is no part of it: the payment form's side is the suite's to stand in for, by confirming
through the stand-in what the page was handed. A payment in Stripe's test mode itself is still
staging's ("Before the first deploy", step 7).

One check does fetch Stripe's own script, and is no part of a run: with `HOUSEHOLD_E2E_STRIPE_JS=1`
set, `pnpm exec playwright test e2e/stripe.spec.ts` from `apps/web` holds the page's policy
(`build/csp.ts`) against Stripe.js as Stripe serves it, the script fetched, its frame drawn, and
nothing asked of an origin the policy does not name. Run it where the policy's three directives
for the processor are changed, and before the first payment on staging.

| | |
|---|---|
| Stripe's API | Under `/v1`, the routes stripe-go asks, as the server's tests have them. A request Stripe would not take, a route the stand-in does not answer or another API version, is answered and logged as `the stand-in was asked what Stripe would not have taken`: a test in `server/` fails on the same |
| What drives it | Under `/_standin`, JSON in and out, with no key asked for (`server/cmd/stripe-standin/control.go` lists every path and answer). `POST /_standin/confirm` is the customer in the payment form, with the secret the API handed out and `with`: a `card`, a `declined_card` or a `debit`; it answers what Stripe.js resolves with. `POST /_standin/households/{id}/fail-payment`, `give-up`, `end-period`, `clear-debit` and `fail-debit` are what Stripe does on its own. `GET /_standin/households/{id}` reads back the household's subscriptions. `GET /_standin/health` says it serves |
| The webhooks | The stand-in posts them itself, to `STRIPE_STANDIN_WEBHOOK_URL` (the suite's API, `http://127.0.0.1:8080/api/v1/webhooks/stripe`), signed with its webhook secret: the events Stripe sends of an act, in order, each waited for, a `5xx` sent again three times, and then the events of whatever the API changed at the stand-in on hearing them. The act's request is answered after that, so the household's row is settled by then and the next read is true |
| What it leaves out | Events of what the API asks of Stripe on its own, a subscription made or set to cancel: the API records those from Stripe's answer, and is sent no event of them, so an invoice is first kept when it is paid or fails, where Stripe's `invoice.finalized` has it kept, `open`, from the moment the payer is shown the form. Stripe being down, a credit that covers a first invoice, a card declined at a charge made off-session, an unpaid or written-off ending, tax: the server's own tests cover those against the same stand-in |
| Its clock | The wall clock. A period begins when it is asked for; `end-period` ends it now |

**The plans drifted.** The stand-in is given the API's `HOUSEHOLD_BILLING_PRICES` too, and does not
start on plans that are not its own: the suite then fails before its first test, with
`names plans that are not the stand-in's own`. Run `go run ./cmd/stripe-standin prices` from
`server/` and put what it prints in `apps/web/playwright.config.ts`.

**By hand.** From `server/`: `go run ./cmd/stripe-standin serve`, and the API with the five
settings above (`go run ./cmd/stripe-standin prices` prints the fifth). Subscribe as an owner with
a verified address, then
`curl -d '{"client_secret":"…","with":"card"}' http://127.0.0.1:12112/_standin/confirm`
with the secret `POST …/billing/subscription` answered. It keeps what it holds in memory:
restarted, it knows none of the subscriptions the database still names, and the API fails where it
asks for one. A household made after the restart is not touched by that.

### Making time pass in a spec

The stand-in moves what Stripe moves: `active`, `past_due`, `grace` when Stripe gives up, and
`canceled` when a cancelled subscription's period ends. What the clock moves, a trial that ends and
a grace that runs out, is the hourly `entitlement.transitions` job's, and the served API reads the
wall clock, which no setting moves. A household's state is read from its row and never derived on
a read, so a date moved alone changes nothing a member sees but the trial's notice. A spec moves
the household's own dates in PostgreSQL and brings the job forward, as the development superuser
(`HOUSEHOLD_ADMIN_DATABASE_URL`, or `docker compose exec -T postgres psql --username=postgres
--dbname=household`), which is who passes the tables' row-level security:

```sql
-- A household in grace, whose grace has run out: read_only once the job has run.
UPDATE households SET grace_ends_at = now() - interval '1 minute' WHERE id = '…';
-- Or a trial that ended fifteen days ago: grace, and read_only, in one run.
UPDATE households SET trial_ends_at = now() - interval '15 days' WHERE id = '…';
UPDATE scheduler_jobs SET next_run_at = now() WHERE name = 'entitlement.transitions';
```

Then it waits for the state to change, which takes a tick of the scheduler, fifteen seconds at
most, and the run. Three things to mind:

- **Bring the job forward again each time the state is looked at and has not moved.** A run that
  was already under way, another test's, did not read this household's new date, and records its
  next slot, an hour on, over the time just set as it ends. Setting it again is harmless: the job
  does nothing for a household that is not due.
- **The suite's API leads the scheduler** only when no other API runs on the same database
  (`pnpm run dev:api` stopped, as the suite asks). With another leading, the job runs there, on
  that process's code.
- **The job moves every household that is due**, not the spec's alone, which changes nothing for
  another test: none is due unless its own spec made it so.

Where a state is only what a test starts from, and the move into it is not what it proves, write
the row itself, as the server's tests do, keeping its checks: `billing_state = 'read_only'` with
`lapsed_at` and `retained_until` both set, `'grace'` with `grace_ends_at`, `'past_due'` with
`dunning_ends_at`. The next request reads it. A household that still has a subscription at the
stand-in is `active` again on the next event of it, so end that first (`give-up`, or cancel and
`end-period`).

## A key leaks or is rotated

Roll the key in Stripe, set the new one, and deploy: Stripe keeps the old key alive for the time you
choose while instances restart. Roll the webhook's signing secret the same way: Stripe signs with
both for up to a day. Nothing the server keeps is sealed under these keys.

## Support

Extending a trial, a credit and a paid invoice sent again are `billing.Service`'s `ExtendTrial`,
`Credit` and `ResendInvoice`, which the staff API calls (item 21); an invoice that is not paid is
not sent again, since the email says the payment went through. Anything else, a refund above
all, is done in Stripe's dashboard: the server reads what Stripe then says.

A credit is the payer's customer's at Stripe, not the household's: what is left of one, or of a
proration after a change from yearly to monthly, pays the next invoice of any subscription they
pay in that currency. A first invoice it covers whole starts the subscription with no payment to
confirm: the household is `active` as the payer subscribes, and has no payment method until they
add one (`postBillingPaymentMethod`).
