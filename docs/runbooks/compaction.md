# PowerSync's compaction

PowerSync keeps each bucket as the operations that wrote it. A row written a hundred times is a
hundred operations until compaction supersedes all but its last, and a row erased from PostgreSQL
leaves its earlier data in bucket storage until then ([ADR 0018](../adr/0018-sync-engine-ii-versions-visibility-audiences-and-the-feed.md)).
Compaction is PowerSync's own command, run nightly beside the service; this runbook is for when it
did not run, or fails.

Read this when bucket storage grows night after night, when a client back from weeks offline takes
long to catch up, after an erasure that must leave bucket storage the same night (PRD 05 §4), and
when `powersync-compact` logs that the compaction failed.

## What runs it

| | |
|---|---|
| The command | `node /app/service/lib/entry.js compact` in the PowerSync image, with the service's own configuration (`POWERSYNC_CONFIG_PATH`). It reads only bucket storage and writes only there |
| The schedule | `deploy/powersync/compact.sh`, at `HOUSEHOLD_COMPACT_AT` (04:00 UTC by default), every night |
| Why then | After the API's nightly jobs: the expiry sweep at 03:00 UTC and the erasure job item 20 schedules before compaction, so that a row erased leaves bucket storage the night it leaves the database |
| Development | The `powersync-compact` service in `docker-compose.yml`, under the `sync` profile (`pnpm run up:sync` starts PowerSync; `docker compose --profile sync up -d powersync-compact` its compaction) |
| Staging and production | Items 30 and 88 run the same script beside their PowerSync, with the same image and configuration |

## Run it now

On the host running PowerSync, in its compose project:

```bash
docker compose --profile sync run --rm --entrypoint node powersync-compact /app/service/lib/entry.js compact
```

The conformance suite runs it the same way in its own stack (`docker compose exec powersync node
service/lib/entry.js compact`), which scenario 6 needs. A compaction while clients sync is safe: a
client whose buckets' checksums no longer match what it holds downloads those buckets again, and
keeps its queue.

## It failed

The script logs `powersync-compact: the compaction failed` and tries again the next night. Read the
lines before it:

- **It could not reach bucket storage**: the storage database's URL in `powersync.yaml`, and whether
  that database is up. Nothing else is touched.
- **It ran out of time or memory**: bucket storage is larger than one night's run can compact. Run it
  by hand for the buckets that grew, `compact --buckets <name>`, and raise the container's memory.
- **An erasure must leave bucket storage today** (PRD 05 §4) and tonight's run failed: run it now,
  after the erasure job has committed, and check with PowerSync's logs that it finished.

Compaction never touches PostgreSQL or the replication slot; the slot's own runbook is
[replication-slot.md](replication-slot.md).
