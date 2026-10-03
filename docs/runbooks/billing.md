# Billing: Stripe's account, keys, prices and webhook

A household's subscription is a Stripe subscription, paid by one of its owners; the server keeps
Stripe's ids, a payment method's summary and the invoices, and moves the household's entitlement on
what Stripe's webhooks name ([ADR 0019](../adr/0019-billing-the-processor-webhooks-the-payer-and-storage-lines.md),
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

## Before the first deploy

Staging holds synthetic data and uses Stripe's **test mode**; production uses live mode. Do each
step in the mode the environment uses.

1. **The account** is the EU entity's, with EU data processing (PRD 04 §6). Turn on the payment
   methods PRD 04 §6 names: cards, SEPA Direct Debit, Apple Pay and Google Pay. Register the web
   client's domain for Apple Pay.
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
4. **Retries** (Billing → Revenue recovery → Retries): Smart Retries off, a custom schedule of four
   retries at **1, 2, 2 and 2 days after the previous attempt**, which is PRD 04 §6's days 1, 3, 5
   and 7 after the first failure. When all retries fail: **cancel the subscription**. Marking it
   `unpaid` instead ends in grace the same way; leaving it `past_due` still ends in grace, a day
   late, by the hourly job.
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

## A month's storage was not billed

`billing_storage_months` has no row for the household and the month.

1. Look for `billing: a month's storage was not billed` in the API's log. The job tries again the
   next night, and bills each month once: before it makes the invoice item it looks for the month's
   at Stripe.
2. No row and no error means the household was not billed on purpose: no subscription of its own
   before the month ended, or one that no longer charges.
3. A row with blocks and an invoice item is billed: the item is on the subscription's next invoice,
   or, for a yearly subscription, on the month's own.

## A key leaks or is rotated

Roll the key in Stripe, set the new one, and deploy: Stripe keeps the old key alive for the time you
choose while instances restart. Roll the webhook's signing secret the same way: Stripe signs with
both for up to a day. Nothing the server keeps is sealed under these keys.

## Support

Extending a trial, a credit and an invoice sent again are `billing.Service`'s `ExtendTrial`,
`Credit` and `ResendInvoice`, which the staff API calls (item 21). Anything else, a refund above
all, is done in Stripe's dashboard: the server reads what Stripe then says.
