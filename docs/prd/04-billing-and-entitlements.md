# 04 — Billing & entitlements

## 1. The model

> **A household has one subscription, paid by one member, for a flat fee that includes a
> storage allowance, plus whole 10 GB blocks of object storage above it.**

| | |
|---|---|
| **Trial** | 30 days from household creation. Full product. **No card required** |
| **Plan** | One paid plan. No tiers, no feature gating between paying customers |
| **Base price** | **€4.99 per household per month when paid annually** (€59.88/year), **€5.99 month-to-month** |
| **Included storage** | **5 GB** of object storage |
| **Extra storage** | **10 GB blocks at €1.00/month each** (≈ €0.10/GB), added automatically as needed, computed from the **daily-average** of the month, not the peak |
| **Metered ceiling** | 20 blocks — 205 GB total. See §4 |
| **Members** | Unlimited, up to a fair-use ceiling of 12 |
| **Currency** | Charged in the household's base currency where it has prices of its own, else EUR. **EUR and GBP** have them at launch; **CZK and PLN** are charged in EUR until their figures are set (**D-130**) |
| **Tax** | VAT per the customer's country: **EU OSS** for EU customers, and a **separate UK VAT registration** for UK customers, which has no small-supplier threshold for a non-established supplier |

**D-30: one paid plan, no tiers.** Feature-gated tiers require an entitlement matrix, upgrade
prompts in seventeen modules, and a permanent product tax on every future feature ("which tier
is this in?"). At launch there is no evidence about what people would pay more for, and
inventing a matrix before that evidence exists is guessing with compound interest. When the
data exists, tiers can be added; a tier cannot be *removed* once sold.

**Prices are set per currency, never converted.** A GBP customer sees a round GBP figure that does
not move when the exchange rate does, because a subscription whose price changes every month is a
subscription people cancel. The launch figures are **£4.49/month billed annually, £5.49
month-to-month, and £1.00 per storage block** — set at the same position relative to local
consumer anchors as the EUR figures, not FX-converted from them, and validated by the same
instrumentation in §8. CZK and PLN figures are set on the same basis, once they are set: until then
a CZK or a PLN household is charged the EUR figures, in EUR. The prices are a deployment's
configuration, each currency's three figures beside the processor's prices that charge them, so a
currency is added with no release, and a household that has subscribed keeps the currency it
subscribed in (**D-130**).

**D-31: overage is billed on the monthly daily-average, not the peak.** A member who uploads
40 GB of video, realises the mistake and deletes it the same day should not receive a bill for
40 GB. Averaging over daily samples is also the only figure the storage screen can honestly
show a customer mid-month.

## 2. Why per-household, plus storage blocks

The decision was between per-seat, storage tiers and this. The reasoning, recorded because it
will be revisited:

- **Per-seat is actively harmful here.** The product only works when the household actually
  joins — a shopping list with one member is a notepad. Charging per member prices the exact
  behaviour that produces retention. Every household app that has tried per-seat has ended up
  with a "family" bundle, which is per-household with extra steps.
- **Storage is the only cost that varies by household behaviour.** Compute and database load
  scale with headcount and are roughly flat per household; object storage varies by two orders
  of magnitude between a household that never uploads and one that puts every receipt, every
  garden photo and every chat video in. Metering it is the honest way to serve both.
- **Blocks, not continuous metering.** A 10 GB block at €1 is coarse enough that the invoice is
  predictable and explainable — *"you are using 18 GB, that is one extra block, €1"* — while
  still scaling with the households that genuinely cost money. Continuous per-GB metering
  produces a different number every month for no benefit at these amounts.
- **Fixed plan tiers were the near-miss.** 10/50/200 GB plans produce no variable invoice at all.
  They were rejected because they force a customer sitting at 11 GB to buy 50, which reads as a
  penalty. Blocks are tiers at a granularity small enough that nobody feels the jump.

## 3. Entitlement states

A household is always in exactly one state, and the state is resolved once per request.

| State | Read | Write | Upload | Sync | Notes |
|---|---|---|---|---|---|
| `trialing` | ✓ | ✓ | ✓ | ✓ | Days 1–30. Everything works |
| `active` | ✓ | ✓ | ✓ | ✓ | Paid and current |
| `past_due` | ✓ | ✓ | ✓ | ✓ | Payment failed; dunning in progress. **Nothing is restricted** |
| `grace` | ✓ | ✓ | ✗ | ✓ | Dunning exhausted or trial ended without payment. 14 days |
| `read_only` | ✓ | ✗ | ✗ | pull only | After grace. Data intact and fully exportable throughout the **12-month** retention window, then warned and deleted — D-32 |
| `canceled` | ✓ | ✗ | ✗ | pull only | Customer cancelled. Same as `read_only`, same retention window, different messaging |
| `restricted` | ✓ | ✗ | ✗ | pull only | **Owner-initiated**, not billing-related. GDPR Art. 18. Reversible by any owner at any time — see FR-BI7 |
| `suspended` | ✗ | ✗ | ✗ | ✗ | Abuse or legal. Rare, staff-initiated, always with notice. Every household route answers `404`; the household list still names it, for the lockout; its replicas are emptied (**D-115**) |

The states are resolved by a precedence (**D-114**): a suspension outranks everything; a lapse
(`read_only`, `canceled`) outranks a restriction, since only a lapse carries a deletion date; and a
restriction outranks the states that still write.

**D-32: lapsed households become read-only, never deleted and never locked out of their own
data.** Export works in every state including `read_only` and `canceled`. Deleting a paying-
then-lapsed customer's three seasons of garden history because a card expired is both a
betrayal and, in the EU, a fight you lose. Data is retained for **12 months** after entering
`read_only` or `canceled`, then the household is warned three times over 30 days and only then
deleted. **"Never deleted" means never deleted *for lapsing*, not kept forever** — the window is
long enough that a household which comes back within a year finds everything, and short enough that
the platform is not storing abandoned data indefinitely at its own cost. Resuming the subscription
at any point in the window restores `active` and clears the countdown; the household is told the
date on the banner from the day it enters the state, so nobody is deleted by surprise. The date is
the day the data is deleted, 12 months and 30 days after the lapse, and the three warnings are
emailed to every owner a month, a week and a day before it (**D-119**).

**FR-BI1 — `read_only` is enforced in one place.** The tenant middleware resolves the
entitlement state and, in a non-writing state, refuses every unsafe method with `402 Payment
Required` and a problem document naming the state and the action to fix it. Modules contain no
billing logic whatsoever, and `402` is declared on every household-scoped unsafe operation in
`openapi.yaml`, so a generated client is forced to handle it.

**The exemptions are a closed list:**

| Exempt | Why |
|---|---|
| Everything under `…/billing` | It is the action that fixes the state. A subscription you cannot resume because you did not pay is a trap |
| `POST …/exports` | [D-32](09-decisions.md) and [G5](00-overview.md): export works in every state, and generating one is a write |
| `POST` / `DELETE …/deletion` | A household must be able to leave in any state |
| `POST …/leave` | A member is not held in a household by somebody else's billing |
| `POST` / `DELETE …/restriction` | A restriction you cannot lift is a household nobody can use (FR-BI7) |
| `POST …/sync/credentials` | It writes nothing: it hands out the credential a replica pulls with, and a household that does not write still pulls (**D-117**) |

Nothing else is exempt, and **no read is ever refused with `402` in any state**. A `suspended`
household answers every household route `404`, these too (**D-115**). The writes into a household
that are not its routes, accepting an invitation, declining one and confirming a child profile's
graduation, are held to the same: a household that does not write is joined, declined and graduated
in by nobody (`402`), and a `suspended` one is not found, nor is an invitation into it previewed or
listed (**D-120**), nor does its household code list its child profiles or sign one in (**D-115**).

**FR-BI2 — Entering `read_only` emits sync retractions for nothing.** The client keeps its
replica and switches to read-only UI. A member's queued offline mutations are refused by the push's
`402`, whose code, `entitlement_read_only` or `entitlement_restricted`, each is recorded `rejected`
with (**D-118**), held locally, and offered for replay if the subscription resumes within the
retention window.

**FR-BI7 — `restricted` is the owner's own switch, and it is the only state that is not about
money.** It exists because [05-privacy-and-compliance.md](05-privacy-and-compliance.md) §3 offers
GDPR Article 18 restriction of processing as a self-service right, and a right that requires
emailing support is a right nobody exercises (**D-35**).

| | |
|---|---|
| **Who** | Any `owner`, from household settings. Not the payer specifically, and no staff involvement |
| **Effect** | Identical to `read_only` at the gate — the same middleware, the same `402`, the same exemptions — with its own problem `code`, its own messaging and its own audit event |
| **Reversal** | Any owner lifts it at any time, immediately. It is not a cooling-off period and there is no minimum duration |
| **Billing** | Unaffected. A restricted household keeps paying and keeps its subscription; restriction is not cancellation and must not be sold as one |
| **Precedence** | It is *not* a seventh billing state in disguise. If the subscription independently lapses while restricted, the household ends up in whichever state is more restrictive, and lifting restriction reveals that |
| **Visible** | Every member sees a banner naming who restricted the household and when, because a household that has silently stopped accepting writes is a support ticket |

**D-87.** The rejected alternative was an independent `frozen` boolean beside the entitlement
state, which is cleaner in principle and worse in practice: it means two gates to keep in step, two
sources of `402`, and two chances for one of them to be forgotten in a handler. Reusing the state
machine costs one enum value and inherits FR-BI1's exemption list for free.

## 4. Storage quota and overage

**FR-BI3 — The quota is soft, and it is never enforced by deletion.**

| Usage | Behaviour |
|---|---|
| < 80 % of the current allowance | Nothing |
| 80 % | One in-app notice to owners. No email |
| 100 % | Owners notified that the next block will be added. Uploads still succeed |
| Each further block | Added automatically; the storage screen shows the projected block count and charge, updated daily |
| **20 blocks** (`MAX_BLOCKS`) — 205 GB total | Uploads blocked with `402`. Reads, downloads and exports unaffected, permanently |

**How blocks are computed.** One figure, once per billing period, from the daily samples:

```
avg_bytes = mean(daily stored_bytes over the billing period)
blocks    = ceil( max(0, avg_bytes - 5 GB) / 10 GB )
charge    = blocks x €1.00
```

Worked: an average of 18 GB is 13 GB over, which is **2 blocks, €2.00**. An average of 4 GB is
**0 blocks**. Forty gigabytes uploaded and deleted on the same day moves a monthly average by
about 1.3 GB, so it costs nothing — which is the whole point of averaging (D-31).

**The period is the calendar month, UTC's, billed in arrears (D-128).** The daily samples are dated
by the UTC day (D-109), and a month's blocks are the ones its samples' mean needs. The night after a
month ends, its line is added to the subscription's next invoice: a monthly plan's renewal carries
it beside the base fee, and a yearly plan's storage is invoiced each month there is any, so that no
invoice carries more than one month of blocks (D-33). A month is billed to a household whose
subscription was its own before the month ended and still charges: a month spent on trial costs
nothing, and neither does the last month of a subscription that then ends. The line is never
prorated: a household that subscribes late in a month is billed that month's blocks whole. The
blocks **in effect**, which a household's allowance and its storage screen show, are the ones the
month's average so far needs.

**D-33: there is a hard ceiling on extra storage.** Unbounded metered billing on a consumer
product is how a customer receives a €900 invoice and a chargeback. The ceiling caps the
household's exposure and the platform's bad debt at the same time, and blocking *uploads* rather
than *access* means the failure mode is "I can't add more", which is comprehensible.

**The ceiling is set from the base fee, not from a storage figure.** The rule is that *the storage
line may not exceed roughly four times the base fee*; at €1 per block that is **20 blocks —
205 GB, €20/month**, so the worst invoice a household can receive is about €25. The ratio is the
decision; the block count is arithmetic, and it moves if either price does.

**FR-BI4 — Overage is shown before it is charged.** The storage screen shows current usage,
month-to-date average, projected month-end average, and the projected charge in the
household's currency. An invoice is never the first time a customer learns the number.

## 5. Fair use on rows

Database rows are not billed, so they need a ceiling. These are generous, exist to catch
automation and abuse rather than enthusiastic families, and are enforced with a warning to the
owners at 80 %, then a refusal at the limit: `403` for a count, which falls only when something is
removed, and `429` for a rate (**D-116**).

| Resource | Ceiling |
|---|---|
| Members | 12 |
| Households a user may own | 5 |
| Rows per module | 250 000 |
| Chat messages | 500 000 |
| Sync mutations | 100 000 / UTC day / household (**D-127**) |
| API requests | 600 / min / user, 3 000 / min / household |
| Individual file | 100 MB |
| Object count | 100 000 |

The sync mutations are counted per UTC day, D-109's metering bucket, each once, as the push first
answers it, so that a batch sent again counts nothing more: a batch received once the day's count has
reached the ceiling is refused whole, `429` with `Retry-After` the end of the day, and is not counted,
and the owners were told once as the day passed 80 % (**D-127**).

Exceeding a ceiling is a support conversation, not an automatic charge. `platform_admin` can
raise any of them per household. A module's rows are the rows the database holds: a row a member
deletes stays, a tombstone, and counts until it is erased, so deleting does not bring a household
back below the ceiling (**D-116**).

## 6. Payments

| | |
|---|---|
| **Processor** | Stripe Billing (EU entity, EU data processing) |
| **Card data** | Never touches Household's servers. Stripe Elements / PaymentSheet only. Household stores a customer id, a payment-method *summary* (brand, last four, expiry) and the subscription state |
| **SCA** | Handled by the processor; off-session charges use saved mandates and fall back to an on-session confirmation email when 3DS is demanded |
| **Methods** | Card, SEPA Direct Debit, Apple Pay, Google Pay. Bank transfer for annual plans on request |
| **In-app purchase** | **Not used.** Household is a "multiplatform service" and the subscription is sold on the web. The apps do not offer, and must not link to, an alternative purchase flow inside the binary where store rules forbid it. See §7 |
| **Invoices** | Issued per billing period with the base fee and metered overage as separate lines; downloadable from the app; emailed to the payer, who alone reads them (**D-133**) |
| **Dunning** | Retried for seven days after the first failure, at 1, 3, 5 and 7 days as nearly as the processor's settings allow: the schedule is the processor's, which takes either four retries on days of its own choosing within the week or three at days 1, 4 and 7. Email to the payer at each retry that fails; in-app banner to owners from the first failure, which is not emailed (**D-132**) |
| **Proration** | Plan changes and cancellations prorate. Metered overage is never prorated — it is measured over actual days |

**FR-BI5 — The payer is a member, not an abstraction.** Billing screens are visible only to the
payer and to other owners (who see state and can take over billing, not the payment method).
Members and children never see billing at all.

**FR-BI6 — Taking over billing** is a two-step handshake: an owner offers, another owner
accepts and supplies a payment method. The subscription does not lapse in between. The payer is
the owner who offers, and billing moves once the other owner's card is confirmed: their own
subscription then starts when the period already paid for ends, so that nobody pays for the same
days twice (**D-131**).

**Subscribing** is the payer's, once their address is verified
([02](02-identity-and-access.md) §3), in the processor's own payment form on the web: the household
is `active` once the processor says the payment went through, and the paid period starts then, on
trial too (**D-129**). The household's state then follows the processor's word, read from the
processor each time it sends any (**D-132**).

## 7. App-store considerations

Recorded because they constrain the product, not just the finance page.

- **The subscription is sold on the web.** Signup, plan selection and payment happen in a browser.
  The apps read the entitlement state.
- **The apps must not link out to the web purchase flow** in jurisdictions and store versions
  where anti-steering rules forbid it. Where an external-purchase link entitlement is available
  and taken, it is used; otherwise the app shows the state and says the subscription is managed
  at the website, without a link. This is checked per store at release time, not assumed once.
- **A "reader" posture is the fallback.** If the apps cannot mention purchase at all, they behave
  as readers of an account created elsewhere, which is a supported app-store category and is
  exactly what Household is.
- **Sign in with Apple is mandatory** because other third-party sign-in is offered
  ([02](02-identity-and-access.md) FR-ID2).
- **Account deletion must be available in-app** on both stores. It is
  ([05](05-privacy-and-compliance.md) §4).

## 8. Instrumentation the price depends on

The base price and per-GB price are placeholders until these exist. They are specified here so
that they are built in 1.0 rather than added when the first invoice looks wrong.

| Metric | Granularity | Used for |
|---|---|---|
| Object-storage bytes and requests | Per household per day | Confirming the block price stays comfortably above true cost |
| Database size and IOPS | Per household (estimated by row counts and query attribution) | Validating that rows can stay unbilled |
| Egress bytes | Per household per day | Whether download-heavy households need their own line |
| Push and email volume | Per household per month | Marginal cost per member |
| Trial-to-paid conversion | Segmented by **the first module the household configured** | [G7](00-overview.md) — knowing which module sells |
| Module activation and 28-day retention | Per module | What to build next, and what to cut |
| Storage distribution | Percentile across households | Confirming that 5 GB keeps the large majority at zero blocks (D-34). Track **share of paying households buying ≥ 1 block** and **churn split by whether the household has ever paid for a block** |

**D-34: 5 GB included, then 10 GB blocks at €1 — sized so the large majority of households never
see a variable line at all.**

Extra storage exists to recover the cost of the minority whose usage genuinely costs money. It is
not a revenue line, and the numbers are chosen so that it does not become one by accident: **a
household has to exceed 5 GB before it sees a variable line at all, and the whole of the first
block — everything from 5 GB to 15 GB — costs €1**, which is a fifth of the base fee. Reaching even
€2 takes 15 GB, three times the allowance.

**The market anchor, recorded because it is what settles arguments about this number.** Consumer
cloud storage retails at roughly €0.02/GB-month (iCloud+ 50 GB at €0.99, Google One 100 GB at
€1.99) and EU object storage costs roughly €0.012–0.015/GB-month. At €0.10/GB the block price
carries a **6–8× margin over cost** while sitting about 5× the retail anchor — a multiple that
would matter if Household were selling storage, and does not here, because the absolute figures
are €1 or €2 and nobody comparison-shops those.

**An earlier configuration of 1 GB included at €1/GB was specified and rejected.** It priced
storage at roughly fifty times both the cost and the customer's anchor, and would have put a large
share of paying households on an €8–25 invoice against an advertised €4.99. Recorded so the
reasoning is not rediscovered.

Two things remain requirements rather than niceties, because they are what makes any variable
component fair:

1. **The charge is visible before it is charged.** FR-BI4's storage screen shows the projected
   block count and cost daily; sign-up states the allowance and the block price beside the base
   fee. An invoice is never the first time a customer learns the number.
2. **The clean-up tools are load-bearing.** Chat's storage page, `move-to-Documents` custody
   transfer, the largest-items list and the derived-variant breakdown are what let a household
   drop back under a block boundary if they want to.
