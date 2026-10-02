#!/bin/sh
# PowerSync's compaction, nightly (plan item 17, ADR 0018): the service's own `compact` command, run
# in its image beside the service with the same configuration. Until it runs, bucket storage keeps
# every operation a later one superseded, a row's earlier data among them, so it runs each night
# after the API's nightly jobs: the expiry sweep at 03:00 UTC, and the erasure job item 20 schedules
# before it, so that a row erased leaves bucket storage the night it leaves the database (PRD 05 §4).
#
# HOUSEHOLD_COMPACT_AT is the time it runs, HH:MM in UTC, 04:00 by default. A compaction that fails
# is tried again the next night; the replication slot's runbook (docs/runbooks/compaction.md) says
# what to look at.
set -eu

at="${HOUSEHOLD_COMPACT_AT:-04:00}"
while :; do
  now=$(date -u +%s)
  next=$(date -u -d "today $at" +%s)
  if [ "$next" -le "$now" ]; then
    next=$(date -u -d "tomorrow $at" +%s)
  fi
  sleep $((next - now))
  if ! node /app/service/lib/entry.js compact; then
    echo "powersync-compact: the compaction failed; it runs again tomorrow at $at UTC" >&2
  fi
done
