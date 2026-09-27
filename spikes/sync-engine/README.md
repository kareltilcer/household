# Sync-engine spike (plan item 5)

Throwaway. This directory is deleted before the pull request merges; the verdict and what it rests
on are in [ADR 0001](../../docs/adr/0001-sync-engine.md), and the commit that deletes it points
back here.

It runs [PRD 10 §4](../../docs/prd/10-sync-risk.md) scenarios 3 (two offline checks of one
shopping item) and 7 (a grant revoked while offline) against PowerSync and Electric, both
self-hosted in docker, on item 4's schema. Writes go through the real tenant middleware and
mutation spine: `backend/` imports the server's internal packages.

| Path | What |
|---|---|
| `docker-compose.yml` | PostgreSQL 17 with logical replication, PowerSync 1.26.1, Electric 1.8.1 |
| `sql/spike.sql` | The spike's tables on top of item 4's migrations, and the engines' roles and publications |
| `powersync/` | PowerSync's service config and its sync streams |
| `backend/` | The API stand-in: tokens, the upload endpoint through `mutation.Apply`, Electric's proxy |
| `harness/` | The scenarios, as Node scripts over `@powersync/node` and `@electric-sql/client` |
| `probes/` | What each engine's access language accepts, per access axis, and the answers |
| `results.txt` | The last full run |

## Running it

```bash
docker compose -f spikes/sync-engine/docker-compose.yml up -d --wait pg
# item 4's schema, with the connection strings pointed at port 5442
cd server && HOUSEHOLD_ADMIN_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5442/household?sslmode=disable \
  HOUSEHOLD_DATABASE_URL=postgres://household_app:household_app@127.0.0.1:5442/household?sslmode=disable \
  HOUSEHOLD_MIGRATE_DATABASE_URL=postgres://household_migrate:household_migrate@127.0.0.1:5442/household?sslmode=disable \
  HOUSEHOLD_METER_DATABASE_URL=postgres://household_meter:household_meter@127.0.0.1:5442/household?sslmode=disable \
  sh -c 'go run ./cmd/household-api bootstrap && go run ./cmd/household-api migrate'
docker exec -i household-spike-pg-1 psql -U postgres -d household -v ON_ERROR_STOP=1 < spikes/sync-engine/sql/spike.sql
docker compose -f spikes/sync-engine/docker-compose.yml --profile engines up -d
(cd spikes/sync-engine/backend && go run .) &
cd spikes/sync-engine/harness && npm install
node run-powersync.mjs all
node run-electric.mjs all gate shape      # the proxy checks the grant; Electric's own Shape
node run-electric.mjs all subquery shape  # the grant as subqueries; Electric's own Shape
node run-electric.mjs all subquery tags   # the same, with a replica that applies move-outs
bash ../probes/powersync-axes.sh
bash ../probes/electric-axes.sh
```

Every credential here is a throwaway for a loopback-only container.
