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
| [0007](0007-shared-packages-client-catalogs-and-vectors.md) | The client is generated on every build, the server reads the clients' catalogs, and one vector format holds both sides | Accepted |
| [0008](0008-reference-data-pipeline.md) | Reference data is sourced JSON the server embeds, validates and loads as it migrates, and serves in every language | Accepted |
| [0009](0009-accounts-sessions-throttles-and-the-breach-corpus.md) | Web sessions are bound to their CSRF token, sign-in throttles live in PostgreSQL, and the breach corpus is a sorted file on the server's disk | Accepted |
| [0010](0010-mobile-tokens-second-step-providers-and-client-versions.md) | A device's access token is checked against its live sign-in, second-step secrets are sealed under a key the database does not hold, the provider flow is checked end to end on the server, and please-update comes before the contract | Accepted |
| [0011](0011-households-as-the-platforms-own-module.md) | The household surface is admin, a module the platform serves itself, whose every write goes through the spine | Accepted |
| [0012](0012-child-profiles-pins-and-graduation.md) | A child profile is an account with a PIN and a child's membership, its lockout counts on the credential, and the household surface serves its sign-in | Accepted |
| [0013](0013-conformance-suite-stand-ins-and-the-oracle.md) | The conformance suite drives PowerSync clients against stand-ins of its own, judges every replica against its own statement of the access predicate, and waits for each engine item to switch its scenarios on | Accepted |
| [0014](0014-powersync-deployment-generated-streams-credentials-and-the-push.md) | PowerSync replicates what migrations publish through streams the registry generates, a replica connects with a short EdDSA token the API hands out, and the push writes each mutation through its module's writer, answering it once | Accepted |
| [0015](0015-files-object-storage-the-meter-and-pictures.md) | Files go through one pipeline into a write-once bucket, their variants are derived after the commit by workers the meter role dispatches, the meter reads every household's counting columns and nothing else, and pictures are the account's | Accepted |
| [0016](0016-scheduler-and-notification-transports.md) | One instance leads the scheduler through an advisory lock and takes each slot by a guarded update; notifications are queued in the transaction of their cause, filtered and rendered when they go out, and delivered by workers in every instance | Accepted |
| [0017](0017-entitlements-on-the-households-row-the-gate-and-fair-use.md) | A household's entitlement lives on its own row and is resolved once per request, the gate names its exemptions by operationId, the streams hold a suspension, and fair use is counted where it is near | Accepted |
| [0018](0018-sync-engine-ii-versions-visibility-audiences-and-the-feed.md) | The push compares a base version against the row it locks, the streams carry visibility and audiences on each row, a rewrite of a row's access is not an edit, and the change feed is written no longer | Accepted |
| [0019](0019-the-sync-client-library.md) | The sync client library builds its replica from a registry generated with the server's, keeps what a mutation needs beside each write, and reports itself at rest | Accepted |
| [0020](0020-billing-the-processor-webhooks-the-payer-and-storage-lines.md) | Billing asks Stripe through one interface, a webhook reads what it names rather than what it carries, the household's row is settled from what is recorded, billing moves once a card is confirmed, and storage is an invoice item a month | Accepted |
| [0021](0021-export-erasure-and-the-tombstones.md) | An export is its requester's archive, built by a worker and streamed to the store; erasure deletes a household by its row, an account table by table, and leaves a tombstone | Accepted |
| [0022](0022-the-crop-catalogs-source-the-reference-set-hook-and-the-climate-dataset.md) | The crop catalog is a module's reference set of crops timed from the frost dates, read through a hook of the pipeline, with a climate dataset computed from NASA POWER | Accepted |
