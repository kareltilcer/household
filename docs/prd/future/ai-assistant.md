# Future — AI assistant

**Not in 1.0** ([00-overview.md](../00-overview.md) §5). This page records the shape it would take,
so that 1.0 does not accidentally foreclose it and so that nobody has to rediscover the design.

## Why it is deferred

- It introduces an **LLM subprocessor**, which changes the DPA, the sub-processor list and the
  privacy notice — and does so for a product whose privacy posture is a selling point.
- It has **per-use marginal cost** in a product with a flat price, so it needs either a usage
  allowance or a tier, and [D-30](../09-decisions.md) says there are no tiers in 1.0.
- It works best over a **settled** data model. Building it against seventeen modules that are still
  being generalized means rebuilding it.
- **None of the 1.0 product depends on it.** Every module is complete without it.

## What already exists that it would use

`home` v11 built an MCP server over its eleven modules: a registered catalog through which each
module publishes machine-readable tools, with the caller's access axes applied identically to the
HTTP path. That design crosses over directly — the module contract in
[01-architecture.md](../01-architecture.md) §4 already has the catalog shape, and adding a
`ToolSource` interface alongside `WidgetSource` and `MetricSource` is an addition, not a rewrite.

## The three shapes, in order of value

### 1. Per-module smart helpers

Narrow, high-value, individually cheap, each with an obvious result:

| Helper | Input | Output |
|---|---|---|
| Receipt capture | A photo | A Finance expense with amount, date, merchant and suggested category, for confirmation |
| Bill capture | A photo of a utility invoice | Tariff values, period dates and meter readings, for confirmation |
| Recipe import | A URL or a photo | A structured recipe (needs the deferred Meals module) |
| Plant identification and diagnosis | A photo | A crop-catalog match, or a likely problem with a caution that it is not advice |
| Document classification | An upload | A suggested type and expiry date |

**Every one of these proposes; none of them commits.** A helper that silently creates a wrong
expense is worse than no helper.

### 2. An in-app assistant

A chat surface that reads across the modules a member may see and performs the same reversible
writes that member could, with:

- **The same access axes** — module grant, visibility, ownership, membership — resolved identically.
  The assistant *is* the member; it is never more.
- **Every write audited and marked** as agent-originated, so the activity log answers *"did I do
  this, or did the assistant?"* — the question that does not exist until the assistant does.
- **No destructive operations**, ever. No hard deletes, no permission changes, no billing actions.
- **A metered allowance**, visible to the household.

### 3. An outbound MCP endpoint

Letting a household connect their own AI client to their household. `home` deferred this pending
OAuth 2.1 with dynamic client registration; that remains the prerequisite.

## What 1.0 must not do to keep this open

1. Keep the module contract's catalog pattern intact — do not let any module reach around it.
2. Keep `meta.via` in the audit spine open to new values, and keep `actor_type` extensible. `home`
   learned this the hard way: it could not add an `agent` actor type because SQLite could not alter
   a `CHECK` on a table with a cascading child. **PostgreSQL enums can be extended; the schema
   should not paint itself into `home`'s corner.**
3. Keep every write path in a service layer that the HTTP handler is merely one caller of, so a
   second front door never needs a second write path.

That is the whole cost of keeping the option open, and it is close to zero.
