#!/usr/bin/env bash
# Validates candidate stream definitions for each access axis against the running PowerSync
# (plan item 5). Throwaway.
# The admin API's token is the one powersync.yaml declares.
ADMIN_TOKEN=$(grep -o 'tokens: \[.*\]' "$(dirname "$0")/../powersync/powersync.yaml" | tr -d '[]' | cut -d' ' -f2)
GRANT="household_id IN (SELECT g.household_id FROM module_grants g JOIN module_enablement e ON e.household_id = g.household_id AND e.module = g.module WHERE g.user_id = auth.user_id() AND g.module = 'spike' AND g.level <> 'none' AND e.enabled)"
probe() {
  local name="$1" query="$2"
  local yaml
  yaml=$(printf 'config:\n  edition: 3\nstreams:\n  probe:\n    auto_subscribe: true\n    query: |\n      %s\n' "$query")
  local out
  out=$(curl -s -X POST http://127.0.0.1:8090/api/sync-rules/v1/validate \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" -H 'Content-Type: application/json' \
    --data "$(node -e 'process.stdout.write(JSON.stringify({content: process.argv[1]}))' "$yaml")")
  local errs
  errs=$(node -e 'const o=JSON.parse(process.argv[1]); const e=(o.errors||[]).map(x=>typeof x==="string"?x:x.message).filter(Boolean); console.log(o.valid!==false && !e.length ? "accepted" : e.length? "REFUSED: "+[...new Set(e)].join(" | ") : "REFUSED")' "$out")
  printf '%-44s %s\n' "$name" "$errs"
}
probe "shared rows, grant" "SELECT * FROM spike_notes WHERE visibility = 'shared' AND $GRANT"
probe "private rows to their owner" "SELECT * FROM spike_notes WHERE visibility = 'private' AND owner_id = auth.user_id() AND $GRANT"
probe "redacted form to all but the owner" "SELECT id, household_id, owner_id FROM spike_notes AS spike_notes_redacted WHERE visibility = 'private' AND owner_id <> auth.user_id() AND $GRANT"
probe "redacted form to all, owner included" "SELECT id, household_id, owner_id FROM spike_notes AS spike_notes_redacted WHERE visibility = 'private' AND $GRANT"
probe "audience, no floor" "SELECT * FROM spike_messages WHERE conversation_id IN (SELECT conversation_id FROM spike_conversation_members WHERE user_id = auth.user_id())"
probe "audience + floor, join" "SELECT spike_messages.* FROM spike_messages JOIN spike_conversation_members c ON c.conversation_id = spike_messages.conversation_id WHERE c.user_id = auth.user_id() AND spike_messages.seq >= c.floor_seq"
probe "audience + floor, scalar subquery" "SELECT * FROM spike_messages WHERE seq >= (SELECT floor_seq FROM spike_conversation_members c WHERE c.user_id = auth.user_id() AND c.conversation_id = spike_messages.conversation_id)"
probe "audience + floor, JWT parameter" "SELECT * FROM spike_messages WHERE conversation_id IN (SELECT conversation_id FROM spike_conversation_members WHERE user_id = auth.user_id()) AND seq >= auth.parameter('floor')"
probe "audience + grant + owner-or-shared" "SELECT * FROM spike_notes WHERE (visibility = 'shared' OR owner_id = auth.user_id()) AND $GRANT"
probe "retraction: NOT IN" "SELECT * FROM spike_notes WHERE id NOT IN (SELECT entity_id FROM sync_changes WHERE for_user_id = auth.user_id())"
# The workarounds: a reader set the server maintains, as a table or as an array on the row.
probe "floor via a reader table (fan-out)" "SELECT * FROM spike_messages WHERE id IN (SELECT message_id FROM spike_message_readers WHERE user_id = auth.user_id())"
probe "floor via a reader array on the row" "SELECT * FROM spike_messages WHERE auth.user_id() IN readers"
# One replica per household (D-4): the client names the household, and the grant still decides.
probe "one household per replica (subscription)" "SELECT * FROM shopping_items WHERE household_id = subscription.parameter('household_id') AND household_id IN (SELECT g.household_id FROM module_grants g WHERE g.user_id = auth.user_id() AND g.module = 'shopping' AND g.level <> 'none')"
probe "one household per replica (connection)" "SELECT * FROM shopping_items WHERE household_id = connection.parameter('household_id') AND household_id IN (SELECT g.household_id FROM module_grants g WHERE g.user_id = auth.user_id() AND g.module = 'shopping' AND g.level <> 'none')"
