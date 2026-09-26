# Household

A multi-tenant, offline-first household-management platform for European families —
mobile (iOS + Android, React Native/Expo) and web, in five languages at launch.

Household is the commercial successor to **`home`** (`home.tilcer.cz`), a single-tenant,
Czech-only, self-hosted household app built for one family. Home proved the architecture:
a compile-time modular monolith where every module owns its routes, migrations, audit
actions and catalog contributions, all sitting on a single audit spine that records every
mutation in the same transaction as the change itself.

Household keeps that architecture and changes four things Home could never support
commercially:

| | `home` | Household |
|---|---|---|
| **Tenancy** | one household per deployment | many households in one PostgreSQL cluster, isolated by RLS |
| **Identity** | external `auth` service, `admin`/`editor`/`reader` | own identity service; `owner`/`member`/`child`, per-module grants, one user in many households |
| **Storage** | embedded SQLite + Litestream | PostgreSQL 17 + S3-compatible object storage, both EU-resident |
| **Clients** | one Czech web SPA + PWA | React Native/Expo apps + a web SPA, five languages, **offline-first** |

## Documentation

| Document | What it covers |
|---|---|
| [`docs/prd/README.md`](docs/prd/README.md) | PRD index and reading order |
| [`docs/api/openapi.yaml`](docs/api/openapi.yaml) | The complete HTTP contract (OpenAPI 3.1) |
| [`docs/design/README.md`](docs/design/README.md) | Design handoff — the brief, foundations, components, patterns and screen inventory derived from the PRD |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | The build plan — every pull request from an empty repository to general availability |

Start with [`docs/prd/00-overview.md`](docs/prd/00-overview.md).

## Development

Needs [Docker](https://docs.docker.com/get-docker/), [pnpm](https://pnpm.io/installation) and
[Go](https://go.dev/dl/). Everything else is pinned in the repository, Node included: pnpm
downloads the version `devEngines.runtime` names and runs every script on it.

```bash
pnpm install
pnpm run up      # Postgres 17, RustFS (S3) and Mailpit on 127.0.0.1
pnpm test
pnpm run lint
```

[`CLAUDE.md`](CLAUDE.md) lists the rest of the commands and the conventions every change follows.

## Status

**Building, Phase 0.** The specification above is complete, and the build follows
[`docs/implementation-plan.md`](docs/implementation-plan.md): 96 numbered items, one pull
request each. Progress is the item statuses there.
