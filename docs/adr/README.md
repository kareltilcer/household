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

| # | Decision | Status |
|---|---|---|
| — | None yet. Plan item 5 writes `0001-sync-engine.md` | |
