# 0020 — Billing asks Stripe through one interface, a webhook reads what it names rather than what it carries, the household's row is settled from what is recorded, billing moves once a card is confirmed, and storage is an invoice item a month

- **Status:** Accepted
- **Date:** 2026-10-03
- **Plan item:** 19
- **Decides for:** [PRD 04](../prd/04-billing-and-entitlements.md) §1, §4, §6 (FR-BI3–FR-BI6);
  [PRD 01](../prd/01-architecture.md) §2.4; D-31, D-33, D-34, D-130–D-135; plan Q1 and Q17

## Context

Plan item 19 puts money behind item 16's entitlement: a subscription a household, paid by one of
its owners, on Stripe Billing, and whole 10 GB blocks of storage above the 5 GB it includes. Item 16
left the household's state as columns of its own row, moved by an hourly job, with Stripe's webhooks
to come (ADR 0017); item 14 left the daily usage samples and a storage allowance with no blocks in
it; the contract described a hosted checkout and a hosted portal, which PRD 04 §6 contradicts (Q17).

What had to be settled:

1. **How a customer pays** without card data reaching the server.
2. **How Stripe's word reaches the household's row**, when webhooks arrive twice, late and out of
   order, and the row changes only through the mutation spine.
3. **Where the platform keeps what Stripe says**, and under which roles.
4. **How billing moves between owners** without a lapse and without charging twice (FR-BI6), when a
   Stripe subscription cannot change its customer.
5. **How extra storage is billed**: the plan said "reported as metered usage".
6. **How the code is held to Stripe's API**, when no test may charge anyone.

## Decision

**Billing asks the processor through one interface** (`billing.Processor`), which Stripe implements
through stripe-go (`billing.Stripe`), pinned to the API version the SDK is built for. Everything
else in `internal/platform/billing` knows subscriptions, invoices and setups as its own plain
types. A deployment with no keys has no processor: every route that would ask it answers
`503 billing_unavailable`, the reads still read what is kept, and nothing lapses for it.

**A customer confirms with Stripe, not with us** (Q17, D-131). `POST …/billing/subscription` makes
the subscription at Stripe unpaid (`payment_behavior=default_incomplete`) and answers the client
secret of its first invoice's payment, which the web client confirms in Stripe's Payment Element;
`POST …/billing/payment-method` and the take-over answer the secret of a setup the same way. The
contract's `checkout-session` and `portal-session` are gone. A route that answers a secret keeps no
`Idempotency-Key`: the secret is never kept to be answered with again, and the route is safe to
repeat of itself, since a subscription still waiting is answered again rather than made twice. One
that waits is ended, for another interval or for a take-over's later card, only while Stripe says
it still waits, asked as it is ended (`Processor.Abandon`): having nothing left to confirm is also
what a payment that has just gone through looks like, and a payment is never undone by a reading
older than it. For the same reason a subscription Stripe holds for a household that no row records,
its request having ended between Stripe's answer and its record, is the household's once it is paid for,
whatever waits there, and is ended as a second one waiting only while it waits itself. An invoice of
such a subscription whose event is handled before the subscription's own has it taken up first, and
is then recorded, rather than dropped for arriving first.

**Paid is the invoice's word, not the subscription's** (D-131). For a payment method that says late
how it went, a SEPA Direct Debit, Stripe makes the subscription `active` as the debit is asked for,
days before it clears, and leaves it `active` when the debit fails, voiding the invoice. A
subscription that waits is therefore the household's once it is `active` **and its latest invoice is
`paid`** (`Subscription.Paid`), or `trialing` with a payment method; `Processor.Subscription` reads
the invoice with it. Until then its row waits, the household is as it was, the contract's
`Subscription.payment_pending` says a payment is on its way, and subscribing again is refused. When
a debit clears Stripe changes nothing of the subscription and sends no event of its own, so an
invoice's event has its subscription read again while its row waits. One `active` over an invoice
that is `void` or `uncollectible` has failed (`Subscription.Failed`): it is cancelled at Stripe,
where it would otherwise charge its next period for a household it was never the subscription of,
and its payer is emailed, once, that it was not started.

**A webhook says what to look at; the handler reads it from Stripe** (D-134). `POST
/webhooks/stripe` verifies the signature and takes from the event only its type, its object's id and
the household its metadata names. Under the household's row lock (`SELECT … FOR NO KEY UPDATE`, as
the household surface's own changes take it) it reads the subscription, the invoice or the setup
from Stripe as it stands, and records that. Two deliveries therefore record their readings in the
order they were taken, a redelivery records the same thing again, and the API version an endpoint's
events are rendered at need not be the SDK's. Anything that fails answers `500`, and Stripe delivers
again, for three days.

**The household's row is settled from what is recorded**, in a second step, through the mutation
spine (`household.Bill`, which `billing.settle` calls inside `mutation.Apply`): a pure function of
the household's subscriptions as their rows have them (`billing.decide`). A subscription that is the
household's and is paid up makes it `active` with every clock cleared; one Stripe is retrying makes a
paid-up household `past_due`, with `dunning_ends_at` a day past the retries' seven, so that item 16's
hourly backstop does not take the household into grace minutes before a last retry that would have
succeeded; with none, a household that was `active` or `past_due` is `canceled`, with `lapsed_at` and
`retained_until`, when its payer cancelled, and in `grace` when Stripe gave up. Each is an
`admin.household.entitlement` event, as the clock's moves are. The record and the settlement are two
transactions, and each is a function of state: a crash between them is mended by the redelivery.

**What Stripe says is kept in tenant tables; a payer's customer is the account's** (`01023`).
`billing_subscriptions`, `billing_invoices`, `billing_storage_months` and `billing_transfers` are
isolated as every tenant table is and written through `tenant.InWriteTx` in the household's context:
they are the platform's record of what the processor said, no entity's history, and replicate to no
device. `billing_customers`, a user's Stripe customer in each currency they pay in, is a global
account table written through `tenant.AccountTx`. A subscription's `standing` says what it is to the
household: `pending` until its payment or its payer's card is confirmed, `current`, or `ended`; at
most one of each of the first two. No "billing service role" exists: the request role reads and
writes them in context, and the meter role lists the households that have a subscription.

**Billing moves once the new payer's card is confirmed** (FR-BI6, D-133). The payer offers
(`billing_transfers`, 14 days), the other owner accepts and is answered a setup's secret, and
nothing else happens until `setup_intent.succeeded` arrives. Then, while the offer stands and they
are an owner still, their own subscription is made on their own customer with the confirmed method:
with a trial that ends when the period the household is already paid up for ends, when it is paid
up, and charged at once when Stripe could not collect the old one. What it is paid up for is read
from Stripe then, under the lock, as a webhook's own object is, and recorded: the row is what the
last event to arrive said, and a renewal or a collection whose event is still on its way would
otherwise charge the new payer at once for a period the old one has just paid for. Paid up is a
subscription that is active, and one that is itself on such a trial: billing handed on twice inside
one paid period gives the third payer's subscription the same end to wait for, and the second's is
cancelled before it ever charges. So is one that is past due over an invoice that bills no base fee:
a yearly plan's month of storage, invoiced between its renewals, puts the subscription past due when
it cannot be collected, while the year itself is paid for, and a new payer charged at once would pay
for its days again; what could not be collected is read from Stripe then too, and only a period
Stripe could not collect, a renewal's, is charged at once. Recording it puts it in the old
one's place; the old one is cancelled at Stripe at its period's end, or at once with its open invoice
voided; and settling moves `billing_payer_id`, as an `admin.household.payer` event, drops the offer
and emails the former payer. A card Stripe declines at that charge leaves their subscription waiting
unpaid and billing where it was; a later card makes a subscription of its own, the one waiting
cancelled for it. A subscription is always made with its payment method, and never has one set while
it waits unpaid, which Stripe does not promise to take. A household with no subscription has no card
to hand over, and the payer moves at accept; so does one whose subscription Stripe says has ended by
the time the card is confirmed, once that end is settled. The payer moves alone only while the
household has none under its lock: one paid for since it was looked at has a card to confirm, and
is never left its former payer's to pay and its new payer's to cancel.

**Storage is an invoice item for each calendar month, in arrears** (D-130). `storage.Allowance.Blocks`
is PRD 04 §4's formula over the mean of the month's daily samples, UTC's as the samples are (D-109);
`packages/test-vectors/vectors/storage.json` holds the Go and TypeScript twins to it. Each night
after the sample, `billing.BillStorage` bills every subscribed household the month that ended, once:
the month's row (`billing_storage_months`) is written in the transaction that asks Stripe for the
item, and the adapter looks for the month's item by its metadata before it makes one, since an
idempotency key lasts a day and a month must be billed once however long after. The item is attached
to the subscription, so a monthly plan's renewal carries it beside the base fee, and a yearly
subscription is made with `pending_invoice_item_interval: month`, so that its storage is invoiced
monthly. The same arithmetic fills `UsageSummary`, `StorageReport.included_bytes` and
`EntitlementSummary`'s storage fields, and the sampler tells the owners as stored bytes cross 80 % and
the whole of the allowance (FR-BI3).

**The adapter is held to Stripe twice.** The tests run the server against `billingtest`, a stand-in
for Stripe's API whose objects are shaped as the pinned version's types: the real adapter, the real
signature check and the real router, with a test doing what a customer and Stripe do on their own.
And a CI job runs every request the adapter sends against `stripe/stripe-mock`, Stripe's own mock,
which validates each against Stripe's OpenAPI description, so that a parameter Stripe does not take
fails the build (`HOUSEHOLD_TEST_STRIPE_URL`).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Stripe's hosted Checkout and customer portal, as the contract had them | PRD 04 §6 names Elements, and the portal is Stripe's own screen, in its words and languages, where a payer changes a plan or cancels outside the product |
| Acting on the object a webhook carries | Events arrive out of order, and the object is rendered at the endpoint's API version: a late `incomplete` after `active` would undo a payment. Reading costs one request an event |
| A table of processed event ids for idempotency | The handlers are functions of what Stripe says now, so a repeat changes nothing; the emails are sent on a change of the recorded invoice, once. An events table would be a second thing to keep in step |
| The record and the settlement in one transaction | The spine rolls back a mutation that records nothing, which is most deliveries; the record would go with it |
| Usage reported to a Stripe meter | A metered price bills an aggregate of events on the subscription's own interval: a yearly plan's storage would arrive once a year, up to twelve months of blocks at once, past D-33's ceiling on any one invoice; mixing intervals on one subscription needs Stripe's flexible billing mode. The block count is also our figure, a ceiling of a mean, which the storage screen must show before it is billed (FR-BI4): an invoice item says exactly that number |
| Moving the subscription to the new payer's customer | Stripe does not move a subscription between customers |
| Moving the payer at accept, before a card is confirmed | A card that is then refused leaves a household whose payer of record pays nothing (design/v1 A-29: "the card was not accepted; billing has not moved") |
| A customer for each household and payer | A member who pays for two households would hold two customers and confirm a card twice; tax is the payer's. Keyed by currency too, since a customer's subscriptions share one |
| Live calls to Stripe's test mode in CI | A secret in CI for every fork's pull request, and a suite that fails when Stripe is slow. The mock validates the same requests offline; a deployment's first payment in test mode is the runbook's |

## Consequences

- A module still holds no billing logic. Billing is the platform's, and everything under `…/billing`
  is exempt from the `402` gate (FR-BI1), by `operationId` (ADR 0017).
- The contract gains `postBillingSubscription`, `patchBillingSubscription`,
  `postBillingPaymentMethod`, `deleteBillingTransfer`, `postWebhooksStripe`, `BillingIntent`,
  `BillingInterval`, `BillingTransferAcceptance`, the codes `already_subscribed`, `not_subscribed` and
  `billing_unavailable`, and loses `postBillingCheckoutSession` and `postBillingPortalSession`.
- Holding the household's row lock across one request to Stripe serialises a household's webhooks at
  the cost of a connection held for that request. Webhooks are a few a household a month. The
  adapter gives each request 20 seconds (`billing.DefaultTimeout`), where the SDK's own client waits
  80: a Stripe that answers slowly must not hold the pool's connections, a request at a time, until
  none is left for anyone. A request cut off is sent again under its idempotency key, and what
  Stripe did meanwhile arrives as an event.
- A payment method's summary keeps its last four only where they are digits, as a card's are. A SEPA
  Direct Debit's are the last four characters of an IBAN, letters in some countries, and such an
  account is known by its kind alone.
- A month's storage line rides the subscription's next invoice. A subscription set to cancel at its
  period's end has no next invoice, so the storage of its last month is not billed: the customer's
  favour, and at most twenty blocks. Revisit if it matters.
- What the stand-in proves is the adapter against objects shaped from the SDK's types, and what the
  mock proves is that Stripe accepts the requests. Neither is a payment: the first subscription in
  Stripe's test mode on staging is the check that the two were read right
  ([runbook](../runbooks/billing.md)).
- Stripe's retry schedule and what it does when retries are exhausted are settings of the Stripe
  account, not of this code: the runbook states them, and the hourly backstop holds a household to
  PRD 04 §6's seven days when they are wrong.
- Item 20 cancels a household's subscription when the household is deleted, and deletes a user's
  customers with their account. Item 21's staff API calls `ExtendTrial`, `Credit` and
  `ResendInvoice`. Item 27 builds the screens over these operations, with the Payment Element.
  Items 30 and 88 give each environment its keys, its prices and its webhook endpoint.
