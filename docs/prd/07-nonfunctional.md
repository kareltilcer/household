# 07 — Non-functional requirements

## 1. Scale targets

Sized for the first three years. Every number here is a design assumption that the load tests
assert, not an aspiration.

| Dimension | Year 1 | Year 3 | Design headroom |
|---|---|---|---|
| Households | 5 000 | 100 000 | 500 000 on one cluster before sharding by tenant |
| Users | 12 000 | 280 000 | — |
| Members per household | 2–4 typical, 12 ceiling | same | — |
| Devices per user | 2 | 3 | — |
| Rows in the largest table (`sync_changes`) | ~200 M/yr before compaction | ~4 B/yr | Compacted at 90 days; partitioned monthly |
| Object storage | 30 TB | 700 TB | Prefix-sharded by household |
| Peak API rate | 200 rps | 4 000 rps | Horizontal; the workload shards perfectly by tenant |
| WebSocket connections | 2 000 concurrent | 40 000 | Multiple instances; connections are stateless past auth |

**The workload is unusually friendly.** Every request belongs to exactly one household, no query
crosses tenants, and households are independent. The scaling path is therefore: more API
instances → read replicas for reporting → **partition the largest tables by `household_id` hash**
→ separate clusters by tenant range. None of that requires a data-model change, which is the
point of putting `household_id` on every row.

## 2. Performance

Budgets, measured at the stated percentile in production, per environment region.

| Operation | p50 | p95 | p99 |
|---|---|---|---|
| Authenticated read, single entity | 40 ms | 120 ms | 300 ms |
| List with cursor, page of 50 | 60 ms | 180 ms | 400 ms |
| Dashboard fan-out (all visible widgets) | 150 ms | 400 ms | 800 ms |
| Write with audit + sync change | 60 ms | 180 ms | 400 ms |
| Sync pull, 500 changes | 120 ms | 350 ms | 700 ms |
| Sync push, batch of 100 mutations | 250 ms | 700 ms | 1 500 ms |
| Snapshot bootstrap, median household | 1.5 s | 4 s | 8 s |
| Global search | 150 ms | 400 ms | 900 ms |
| Utilities period summary (computed, uncached) | 200 ms | 500 ms | 1 200 ms |
| Garden plan check, full season | 300 ms | 800 ms | 2 000 ms |
| Pre-signed URL issue | 20 ms | 60 ms | 150 ms |

Under D-93 the pull and the bootstrap are PowerSync's: the pull's budget applies to a checkpoint of
500 changes reaching a connected client, and the bootstrap's to a replica's initial sync.

Client-side:

| | Target |
|---|---|
| Mobile cold start to interactive dashboard **from cache** | < 1.2 s |
| Mobile navigation between cached screens | < 100 ms, no spinner |
| Web first contentful paint | < 1.5 s on a 4G profile |
| Web Largest Contentful Paint | < 2.5 s |
| Interaction to Next Paint | < 200 ms |
| **Any offline read** | Indistinguishable from online |

**FR-NF1 — No N+1 anywhere.** The dashboard fan-out, the sync pull, the tree reads and the
search are all single-query-set operations. A test asserts the query count per endpoint against a
recorded budget and fails when it grows.

**FR-NF2 — Computed views are computed, not cached, unless proven otherwise.** `home` established
this for the Utilities summary and the Garden check, and it was right: a cache of a derived figure
is a second source of truth that eventually disagrees. Where a computation exceeds its budget, the
first response is to fix the query; a cache requires an explicit decision recorded in
[09-decisions.md](09-decisions.md), with an invalidation rule.

## 3. Availability and resilience

| | |
|---|---|
| **Target** | 99.9 % monthly for the API (≈ 43 min/month), measured externally |
| **Planned maintenance** | Zero-downtime deploys; expand/contract migrations; no maintenance window |
| **Database** | Multi-AZ primary with automated failover, one read replica for analytics and exports |
| **RPO** | ≤ 5 minutes (continuous WAL archiving) |
| **RTO** | ≤ 1 hour |
| **Backups** | Nightly full plus continuous WAL, 35-day retention, encrypted, EU-resident. **Restore tested monthly, automatically, into an isolated environment** — an untested backup is not a backup |
| **Object storage** | Versioning enabled plus cross-account replication within the EU |
| **Degradation** | The mobile apps stay fully usable offline during an outage; a queued mutation is not lost by a server being down |

**FR-NF3 — Every dependency has a defined failure behaviour.** Object storage unavailable ⇒
uploads fail with a clear, retryable message; existing metadata still reads. Push provider
unavailable ⇒ delivery is retried, never lost, and never blocks the mutation. Payment processor
unavailable ⇒ entitlement state is held at its last value, never downgraded on a timeout. Weather
provider unavailable ⇒ Garden renders from cache with no error the member can act on.

## 4. Security

| Control | Requirement |
|---|---|
| Transport | TLS 1.3, HSTS preloaded, no mixed content, certificate transparency monitoring |
| At rest | Database and object-store encryption; separately managed backup keys |
| Passwords | Argon2id with tuned parameters; breached-password screening at set time |
| Tokens | Access JWT 15 min, EdDSA; refresh tokens rotating and single-use with family reuse detection |
| Session | `__Host-` prefixed, `HttpOnly`, `Secure`, `SameSite=Lax`; double-submit CSRF plus an Origin allowlist |
| Authorization | Resolved server-side from the membership on every request. **Never from a client-supplied field, never from a JWT claim** |
| Tenant isolation | Application scoping **and** RLS with `FORCE`. Tested in CI. Under D-93 the replicated path has the generated stream definitions alone, held by a read-path isolation test ([01](01-architecture.md) §2.3) |
| Input | Every request body validated against the OpenAPI schema at the edge |
| Uploads | Type sniffed from bytes; size capped; active types download-only; `nosniff` everywhere |
| Output | The web app sets a strict CSP with no `unsafe-inline`; user content is rendered through sanitising renderers only |
| Rate limiting | Per user **and** per household, so one tenant cannot degrade another |
| Secrets | Managed secret store; none in images, none in the repository; rotation documented |
| Dependencies | SBOM per release; automated alerts; a published patch SLA (critical ≤ 72 h) |
| Logging | Structured, with a **field allowlist**. Content values, tokens, passwords and file bytes are never loggable — enforced by a redacting logger, not by discipline |
| Testing | SAST and dependency scanning in CI; external penetration test before GA and annually |

**FR-NF4 — The tenant isolation test runs on every commit.** It connects as the application role
with a household context set, attempts to read every content table for a different household by
primary key, and asserts zero rows for every one. A new table without a policy fails it, which is
the point.

## 5. Observability

**FR-NF5 — Every log line, metric and trace carries `household_id` and `request_id`, and no log
line carries content.** These two requirements are in tension and the resolution is the field
allowlist: the tenant is an identifier, the content is not, and the logger cannot emit what is
not on the list.

| Signal | What |
|---|---|
| **Logs** | Structured JSON; allowlisted fields; 12-month retention; EU-hosted |
| **Metrics** | RED per endpoint; per-module error rates; sync queue depth and conflict rate; push delivery outcomes; storage per household; entitlement state distribution; job success and lag |
| **Traces** | Sampled distributed traces across the request, the database and object storage |
| **Errors** | Crash and exception aggregation with content scrubbed before send |
| **Business** | Trial conversion by first-configured module; module activation and 28-day retention; export and deletion request volume and SLA |

**Alerting** on: error rate above budget, p99 latency above budget, sync conflict rate anomaly,
job failure or lag, dunning failure rate, backup or restore-test failure, storage growth anomaly,
and any tenant-isolation assertion failure — the last paging immediately, at any hour.

## 6. Maintainability

| | |
|---|---|
| **Test coverage** | Meaningful coverage on domain logic and every access-control path. Coverage percentage is not itself a target; an untested authorization branch is a blocker |
| **The architecture tests** | [01-architecture.md](01-architecture.md) §10, all nine, in CI |
| **The contract** | `openapi.yaml` is the source of truth. Routes and schemas are diffed against it in CI; drift fails the build |
| **Migrations** | Forward-only, expand/contract, reversible-by-compensation, tested against a production-shaped dataset |
| **Documentation** | This PRD is maintained with the code, in the same repository, and a change to behaviour that does not update it is an incomplete change |
| **Decisions** | Recorded in [09-decisions.md](09-decisions.md) with the alternative that was rejected and why. A decision without a rejected alternative is a note, not a decision |

## 7. Cost

| Line | Driver | Control |
|---|---|---|
| Compute | Households, not members | Horizontal; the binary is one process |
| Database | Rows and IOPS | Compaction, partitioning, fair-use ceilings |
| Object storage | Uploads | **Passed through to the customer above the allowance** — the only line that scales with individual behaviour |
| Egress | Downloads and image variants | Right-sized variants; long cache lifetimes on immutable bytes |
| Push and email | Members and rules | Coalescing windows; category mutes |
| Support | Bugs and confusion | Self-service export and deletion; the diagnostic bundle |

**FR-NF6 — Cost per household is measured monthly and reported alongside revenue per household**,
so the price in [04](04-billing-and-entitlements.md) is set from data rather than from a guess
that nobody revisits.
