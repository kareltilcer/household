# 09 — Finance

> **Rebuilt.** `home`'s Finance module records two named incomes and applies one locked formula
> with four percentage rates. It is correct, well-tested, and useful to exactly one household.
> Household keeps its arithmetic as a *configuration* and builds three more capabilities beside it.

## What it is

One module, **four capabilities**, each independently enabled. A household turns on what matches
how they actually handle money — which is frequently more than one.

| # | Capability | For |
|---|---|---|
| **1** | **Accounts & allocation** | Households with pooled or partly-pooled money: incomes arrive, rules distribute them across personal, joint and savings accounts |
| **2** | **Shared expenses** | Households and flatshares who keep money separate and split specific costs — the Splitwise shape |
| **3** | **Budgets & categories** | Anyone who wants to know where it went and whether that was the plan |
| **4** | **Recurring bills & subscriptions** | Anyone who has ever been surprised by an annual renewal |

**They compose.** A couple with a joint account (1) who split a holiday (2) and watch groceries
(3) is one household with three capabilities on, one ledger, and no contradiction. **D-54: one
module, one ledger, four capabilities — not two modules and not two exclusive modes.** Two
ledgers describing the same money is a product that disagrees with itself, and "switch mode" is a
data migration a consumer must not be asked to perform.

## Money, once

| | |
|---|---|
| **Storage** | `amount_minor bigint` + `currency char(3)`. Never a float, never `numeric`. Enforced by an architecture test |
| **Household base currency** | Set at household creation. Every total, balance and budget is expressed in it |
| **Multi-currency entries** | Any transaction may be in another currency. It carries `original_amount_minor`, `original_currency`, `fx_rate` and `fx_source` |
| **The rate is captured at entry and stored on the row** | **D-55.** Re-converting history with live rates means last month's total changes every time it is looked at, which destroys the one property a ledger must have. The member may correct a rate; correcting it is an audited edit of that row |
| **Rate source** | The member enters it, or accepts a suggested reference rate fetched daily from the European Central Bank reference set (EUR-based, cross-computed). No live per-transaction lookup, no paid FX provider |
| **Rounding** | Half-up to the currency's minor unit, once, at the point a value is materialised — never on intermediates |
| **Zero-decimal currencies** | Handled from ISO 4217 exponent data, not assumed to be 2 |

## Setup

**Substantial, and it is the module's most important screen.** An owner runs it; it is skippable
and re-runnable.

**Step 1 — "How does your household handle money?"** Four illustrated answers, each pre-selecting
capabilities and a preset:

| Answer | Enables | Preset |
|---|---|---|
| "Everything is shared" | 1, 3, 4 | One joint account; all income in; no personal split |
| "Mostly shared, some personal" | 1, 3, 4 | Personal accounts + joint + savings — **`home`'s shape**, offered as a preset |
| "Separate, we split some costs" | 2, 4 | No accounts; expense splitting only |
| "Let me choose" | — | The capability toggles directly |

**Step 2 — People and income.** Who earns; roughly how much (optional, and skippable — the module
works with incomes entered later or never).

**Step 3 — Accounts** (capability 1 only). Pre-filled from the preset, fully editable. A household
can have any number of accounts of any type.

**Step 4 — The allocation plan** (capability 1 only). Pre-filled from the preset, with a **live
worked example** using the entered incomes so the household sees real numbers before saving.

**Step 5 — Categories** (capability 3 only). A translated, country-aware default set, editable.

Every step is skippable, and skipping leaves a working module.

## Capability 1 — Accounts & allocation

**FR-FI1 — Accounts.** Any number, each with `name`, `type ∈ {personal, joint, savings, cash,
credit, other}`, an `owner_id` (required for `personal`, null otherwise), `currency`, an optional
opening balance, an optional institution name and last-four, an `is_active` flag and a position.

**FR-FI2 — Income entries.** Per period (a month by default; a household may choose fortnightly or
weekly), per earner, per source: `member_id`, `period`, `amount`, `source_label`, optional `note`.
**N earners, not two.** A household with one earner, or three, or a member with two jobs, is
ordinary.

**FR-FI3 — The allocation plan.** An ordered list of rules. This is the generalisation of `home`'s
locked formula, and the formula is expressible in it exactly.

A rule declares:

| Field | Values | Meaning |
|---|---|---|
| `order` | integer | Rules apply in order |
| `from` | `income` \| an account id | Where the money comes from |
| `per_earner` | bool | When true and `from = income`, the rule runs once per earner against **their own** income and targets **their own** account |
| `basis` | `own_income` \| `total_income` \| `source_balance` \| `fixed` | What the percentage is a percentage *of* |
| `mode` | `percent` \| `amount` \| `remainder` | |
| `value` | decimal percent, or minor units | Unused when `mode = remainder` |
| `to` | account id, or `owner_personal` | `owner_personal` resolves per earner under `per_earner` |
| `label` | translation-keyed | What the household calls this movement |

**FR-FI4 — Exactly one `remainder` rule per source.** The remainder rule absorbs **all** rounding,
which is what makes every total reconcile exactly. A plan without one, or with two, is refused at
save time with a message naming the source. This is `home`'s `needs` behaviour, promoted from an
implementation detail to an invariant of the model. **D-56.**

**FR-FI5 — Derived on read, never stored.** The allocation result for a period is computed from the
stored inputs — incomes, the plan version in effect for that period — and never persisted. Carried
from `home` unchanged, for the same reason: storing only the inputs is what guarantees the plan
stays the single source of truth and that history stays reproducible when a rule is corrected.

**FR-FI6 — Plans are versioned by effective period.** A plan version governs every period from its
`effective_from` until the next version begins; the end is derived, never stored. Changing this
year's percentages does not move last year's numbers. This is the same versioning shape Utilities
uses for tariffs, deliberately.

**FR-FI7 — The invariants, checked by the engine and asserted by tests.** For any period:

- Per earner, under `per_earner` rules: `Σ allocated == income`.
- Per source account: `Σ outflows == inflow`, the remainder rule closing the gap.
- Overall: `Σ inflows whose ultimate source is income == Σ all income`. Account-to-account
  movements are excluded from that sum — a rule with `from = <account id>` moves money that has
  already been counted, so totalling every inflow row would double-count every transfer.

`home`'s worked example is a fixture: incomes 60 000 and 40 000, rates 20/60/10/10, producing
personal 12 000 and 8 000, operational received 80 000, savings 10 000 and 10 000, remainder 60 000.
**The generalised engine must reproduce it exactly**, expressed as the "mostly shared" preset. It is
the regression test that the rebuild did not change anybody's numbers.

**FR-FI8 — A negative remainder is shown as zero with a footnote, never clamped in the data.**
Carried from `home`: clamping would break `Σ outflows == inflow`, the invariant the whole rounding
scheme exists to protect.

**FR-FI9 — The flow view.** The visualisation is the reason the capability exists: income → what
each person keeps → what reaches the joint account → what leaves it for savings → what remains.
`home`'s three-stage layout, generalised to N sources and M accounts, with the reconciliation note.

**FR-FI10 — Missing periods.** The module names periods with no income recorded, because the actual
failure mode is not a wrong number, it is a month nobody entered. Metric, list and widget.

## Capability 2 — Shared expenses

**FR-FI11 — Expenses.** `date`, `description`, `amount`, `currency`, `paid_by` (one or several
members with amounts), `participants[]`, a `split_method`, an optional `category_id`, an optional
`document_ref` (the receipt), an optional `account_id`.

**FR-FI12 — Split methods.**

| Method | Input | Notes |
|---|---|---|
| `equal` | Participant list | The default |
| `shares` | Integer shares per participant | "2 shares for us, 1 for the kid" |
| `percent` | Percentages summing to 100 | |
| `exact` | Amounts summing to the total | |
| `adjustment` | A base equal split plus per-person adjustments | For "and Petr also had the wine" |

**The last minor unit is assigned deterministically** — to participants in a stable order, one unit
each until the remainder is exhausted — so a three-way split of €10.00 is 3.34 / 3.33 / 3.33 and is
the *same* 3.34 every time the row is read. A non-deterministic rounding assignment is a balance
that changes when you refresh it. **D-57.**

**FR-FI13 — Balances.** A running net balance per member pair, and a net position per member, in
the household base currency, converted at each transaction's stored rate.

**FR-FI14 — Settle up.** A settlement is a recorded transfer between two members with a date, an
amount and an optional note. The screen offers a **simplified set of transfers** that clears all
balances in the fewest payments, and also the un-simplified pairwise list, because some households
want to settle only with one person. Simplification is a suggestion; the recorded settlement is
whatever actually happened.

**FR-FI15 — Household expenses without splitting.** An expense may be marked as paid from a joint
account and not split at all — it is household spending, it belongs in the budget, and it creates no
balance. Households running capability 1 use this constantly, and a splitting model that cannot
express it is the reason people keep a spreadsheet beside the app.

## Capability 3 — Budgets & categories

**FR-FI16 — Categories.** A two-level tree, seeded from a translated default set and fully
editable. Each has an icon and a colour. A category may be marked `income`, `expense` or `transfer`.

**FR-FI17 — Budgets.** Per category per period: an amount, and a `rollover` flag (unspent carries
forward or does not). A period shows planned, actual, remaining, and a projection based on elapsed
days.

**FR-FI18 — Transactions.** The unified ledger row underlying everything: `date`, `amount`,
`currency`, `account_id`, `category_id`, `description`, `counterparty`, `kind ∈ {income, expense,
transfer}`, `source ∈ {manual, import, split, allocation, recurring}`, `external_ref`, and the FX
fields. Expenses (capability 2) write into this table directly, which is what makes one ledger true
rather than three.

**Allocation is the one that is not a row until somebody makes it one**, and the distinction matters
because FR-FI5 turns on it:

- **The allocation plan's output is derived**, always, from the incomes and the plan version in
  effect. Nothing is written. The flow view, the balances and the period summary are all computed on
  read, which is what keeps history reproducible when a rule is corrected (FR-FI5, FR-FI6).
- **An allocation movement that actually happened may be posted.** When a member really does move
  the money — the standing order ran, they made the transfer — they post it from the flow view in
  one tap. That writes an ordinary transaction carrying `source: allocation` and a reference to the
  rule that suggested it, and from that moment it is an ordinary ledger row: it is never
  regenerated, never reconciled back against the plan, and editing the plan does not touch it.

So `source: allocation` marks *"this row came from the plan"*, not *"this row is the plan"*. The
screen shows planned beside posted and names the difference, because a household that has moved four
of five transfers wants to see which one is outstanding — and a module that silently posted all five
would be asserting a bank transfer it has no way to know about.

**D-81: `source` exists from day one so that a bank feed can be added later without a
migration**, and so that an imported row and a hand-typed row are distinguishable forever.

**FR-FI19 — CSV and statement import.** A mapping wizard: upload, preview the first rows, map
columns to fields, choose a date format and a decimal separator, choose the sign convention, and
save the mapping under a name so the next statement from the same bank takes one click. Supports
CSV in any delimiter and encoding, and **camt.053** XML, which most European banks export.

**Deduplication** is by a hash of `(account, date, amount, normalised description)` plus the bank's
own reference where present. Suspected duplicates are shown for confirmation, never silently
dropped and never silently imported.

**FR-FI20 — Rules.** Simple, member-authored: *if the description contains X, set category Y*.
Applied at import and re-appliable to history. Deliberately not machine learning.

## Capability 4 — Recurring bills & subscriptions

**FR-FI21 — Recurring definitions.** `name`, `amount`, `currency`, `cadence` (monthly, quarterly,
annual, custom), `next_due_on`, `category`, `account`, `payee`, an optional `document_ref` (the
contract), an optional `cancellation_notice_days`, and a `status ∈ {active, cancelled, paused}`.

**FR-FI22 — Materialisation.** A due recurring item appears as a **pending transaction** the member
confirms or edits — it is never posted automatically, because a subscription that silently posts a
wrong amount is a ledger nobody trusts.

**FR-FI23 — Price-change detection.** When a confirmed amount differs from the definition, the
member is asked whether this is a one-off or the new price, and a **price history** is kept. "Netflix
has gone up three times in two years" is a thing the module can answer and almost nothing else can.

**FR-FI24 — Renewal and cancellation reminders.** A recurring item with `cancellation_notice_days`
registers a reminder that far ahead of the renewal — the moment at which cancelling is still
possible, which is the only moment the reminder is worth anything. **D-58.**

## Data model

`finance_accounts`, `finance_income_entries`, `finance_allocation_plans`,
`finance_allocation_rules`, `finance_transactions`, `finance_expense_shares`,
`finance_settlements`, `finance_categories`, `finance_budgets`, `finance_recurring`,
`finance_recurring_price_history`, `finance_import_mappings`, `finance_import_batches`,
`finance_rules`.

Constraints that carry meaning: exactly one `remainder` rule per `(plan_version, from)`, enforced by
a partial unique index; `finance_expense_shares` amounts must sum to the parent transaction; a
`personal` account must have an `owner_id` and no other type may; `currency` valid against ISO 4217
reference data.

## Sync

| Entity | Policy | Reasoning |
|---|---|---|
| `finance.account` | `strict_version` | Structural |
| `finance.allocation_plan`, `finance.allocation_rule` | **`strict_version`** | Money. A half-merged allocation plan is a wrong number nobody will find |
| `finance.income_entry` | `strict_version` | Money |
| `finance.transaction` | `strict_version` | Money |
| `finance.expense_share` | `strict_version` | Money |
| `finance.settlement` | `additive` | A settlement happened; it is a fact, not a state |
| `finance.category`, `finance.budget` | `lww_field` | Not money in the ledger sense |
| `finance.recurring` | `lww_field` | |

**Finance is the module where a conflict dialog is the correct answer**, and the specification says
so explicitly rather than leaving it to a default. Everything money-bearing is `strict_version`.

## Catalog contributions

| Kind | Key |
|---|---|
| Widget | `finance.period` — this period's headline: income, allocated, remaining, or a prompt when the period is unrecorded |
| Widget | `finance.balances` — who owes whom (capability 2) |
| Widget | `finance.budget_progress` — top categories against budget (capability 3) |
| Metric | `finance.income_current`, `finance.savings_current`, `finance.missing_periods`, `finance.net_balance` (per recipient), `finance.budget_overspent_count`, `finance.recurring_due_7d` |
| List | Mirrors, plus `finance.upcoming_renewals` |
| Reminder kind | `finance.recurring_due`, `finance.cancellation_window` |
| Search scope | `finance.transaction` — description and counterparty |
| Storage | Tables plus receipt document references (files live in Documents) |

## Permissions

Standard gate, with one deviation that matters:

**FR-FI25 — Finance defaults to `none` for new members**, including new owners' invitees, and an
owner must grant it deliberately. In `home` a `reader` could see both household incomes and that was
an accepted consequence in a two-person household. In a commercial product with flatmates, adult
children and separated co-parents, the default must be closed. **D-59.**

| Operation | Level |
|---|---|
| See accounts, transactions, balances, budgets | `view` |
| Add income, expenses, transactions, settlements; import | `contribute` |
| Edit accounts, the allocation plan, categories, budgets, recurring definitions | `manage` |
| Delete a transaction | `manage` — and it is a hard delete whose audit event carries the whole row |

A `child` cannot be granted Finance above `view`, and is `none` by default.

## Non-goals

- **No bank connections, no PSD2, no aggregator** in 1.0.
- **No investment tracking, no net worth, no portfolio.**
- **No forecasting or advice.** Household is not a financial adviser and will not present
  projections as recommendations.
- **No payments.** Household never moves money. Settle-up records that a transfer happened; it does
  not perform one.
- **No tax reporting.**
- **No debt or loan amortisation** in 1.0.
- **No shared access to a member's personal account statements** — an imported statement belongs to
  the account, and a personal account's transactions are visible per the account's own visibility.
