# PowerSync's replication slot

PowerSync replicates from PostgreSQL's write-ahead log through a logical replication slot
([ADR 0001](../adr/0001-sync-engine.md), [ADR 0014](../adr/0014-powersync-deployment-generated-streams-credentials-and-the-push.md)).
A slot keeps every change PowerSync has not yet read, so while PowerSync is down or behind, the log
grows on the database's disk. `max_slot_wal_keep_size` bounds how much it may keep: past it,
PostgreSQL invalidates the slot to save the disk, and PowerSync must replicate again from the start.

Read this when replication lag alerts, when the database's disk fills with write-ahead log, after a
restore or a failover, and when PowerSync logs that its slot is missing or invalidated.

## What is where

| | |
|---|---|
| The slot | Named by PowerSync, `powersync_<n>_<id>`; one per sync configuration it runs |
| Its bound | `max_slot_wal_keep_size` on the database server: `2GB` in `docker-compose.yml` and the suite's stack. Item 88 sets production's from the write rate and the outage PowerSync must survive |
| The publication | `powersync`, owned by the migrate role; a migration adds each table with `replicate` |
| The role | `household_powersync`, `REPLICATION` and `BYPASSRLS`, made by `household-api bootstrap` |
| The buckets | PowerSync's storage database, `powersync_storage` in development |

## Is the slot keeping up?

As the database's administrator:

```sql
SELECT slot_name, active, wal_status, safe_wal_size,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS behind
FROM pg_replication_slots
WHERE slot_type = 'logical';
```

- `active` is true while PowerSync is connected.
- `behind` is the log PowerSync has not confirmed. It should stay near zero; it grows while
  PowerSync is down, and a steady climb while it is up means it cannot keep up.
- `wal_status` is `reserved` or `extended` while the slot is healthy, `unreserved` once it is past
  `max_slot_wal_keep_size` and about to be invalidated, and `lost` once it has been.
- `safe_wal_size` is how much more log may be written before the slot is lost.

PowerSync reports its own lag at `GET /probes/liveness` and in its logs (`Replicating op …`).

## PowerSync is down

Clients keep working (D-105): each replica stays readable, every local write is kept, and queued
writes still reach the API's push, which answers them. What stops is other members' changes arriving.

1. Bring PowerSync back. Its container restarts on failure; if it does not stay up, its log names why:
   the replication role's password, the storage database, the configuration, or the JWKS URL.
2. Watch `behind` fall. A slot that was not lost resumes where PowerSync left it, and clients catch
   up from the checkpoint each last applied.
3. If `safe_wal_size` is small and falling, the slot will be lost before PowerSync catches up: raise
   `max_slot_wal_keep_size` if the disk allows, or accept the loss below.

## The slot is lost

After a restore, a failover to a server that did not carry the slot, or `wal_status = lost`:

1. PowerSync notices when it next reads the slot and replicates again from the start: it takes a new
   snapshot of every published table into new buckets, logging each table as `Replicating … not
   resumable`. Nothing needs to be done for it to start, and nothing on the API side changes.
2. While it snapshots, clients stay on their last checkpoint. When it is done, each client finds its
   buckets' checksums changed and downloads them again. No queued mutation is lost: the queue is on
   the device, and the push is the API's.
3. If PowerSync does not recover on its own, stop it, drop the invalidated slot
   (`SELECT pg_drop_replication_slot('<slot_name>')`), and start it again: it makes a new slot and
   snapshots.
4. Record the time the slot was lost and the snapshot's duration; item 89's drills keep the figures.

## After a restore

A restore brings back the tables but not PowerSync's buckets as of the same moment, and not the
slot. Treat it as a lost slot: PowerSync snapshots the restored tables, and every client, finding
its buckets' checksums changed, downloads them again. A write a client made after the restore point
and before the restore is lost with the server's copy of it; its device already dropped it from its
queue once the push answered it.

## Development

`pnpm run up:sync` starts PowerSync once `pnpm run db:setup` has made its role, its publication and
its storage. `pnpm run down` keeps the volumes, and with them the slot and the buckets; a stale slot
from an old database is dropped with the statement above, or by removing the volume
(`docker compose down --volumes`), which removes every development row as well.
