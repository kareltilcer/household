# Architecture decision records

An ADR records a technical choice that outlives the pull request that made it: a library, a
protocol, a vendor, a verdict from a spike. Product decisions do not belong here. They are
`D-n` entries in [the PRD's decision register](../prd/09-decisions.md), and a change in
behaviour updates the PRD in the same PR.

## Writing one

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-<slug>.md`, taking the next free
   number.
2. Fill in every section. **Name the alternative that was rejected, and why.** A decision
   without a rejected alternative is a note, not a decision
   ([07-nonfunctional §6](../prd/07-nonfunctional.md)).
3. Add it to the index below, in the same PR as the change it records.

An accepted ADR is not rewritten. A later decision that replaces it is a new ADR, and the
old one's status becomes *Superseded by NNNN*.

## Index

Number 0002 is reserved by the plan for item 34 (`0002-gate-g-c.md`).

| # | Decision | Status |
|---|---|---|
| [0001](0001-sync-engine.md) | PowerSync, self-hosted, replicates; the write path stays Household's | Accepted |
| [0003](0003-contract-enforcement-at-the-edge.md) | The server validates against the committed contract, and says what failed where | Accepted |
| [0004](0004-database-roles-migration-blocks-and-test-databases.md) | Database roles, migration blocks, and one database per test package | Accepted |
| [0005](0005-tenancy-registry-and-row-level-security.md) | A transaction per unit of work carries the tenant, and row-level security is one template | Accepted |
| [0006](0006-sync-ready-schema-and-the-mutation-spine.md) | The sync-ready schema is enforced, and every write goes through one spine | Accepted |
