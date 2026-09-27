#!/usr/bin/env bash
# Asks the running Electric for a shape per access axis (plan item 5). The proxy writes these
# where clauses, so the caller's ids are constants in them. Throwaway.
U=01920000-0000-7000-8000-00000000000b
H=01920000-0000-7000-8000-000000000001
C=01920000-0000-7000-8000-0000000000c1
GRANT="household_id IN (SELECT household_id FROM module_grants WHERE user_id = '$U' AND module = 'spike' AND level::text <> 'none') AND household_id IN (SELECT household_id FROM module_enablement WHERE module = 'spike' AND enabled)"
probe() {
  local name="$1" table="$2" where="$3" columns="${4:-}"
  local args=(--data-urlencode "table=$table" --data-urlencode "offset=-1" --data-urlencode "where=$where")
  [ -n "$columns" ] && args+=(--data-urlencode "columns=$columns")
  local code body
  body=$(curl -s -G "http://127.0.0.1:3010/v1/shape" "${args[@]}" -w '\n%{http_code}')
  code=$(tail -n1 <<<"$body")
  if [ "$code" = 200 ]; then printf '%-44s accepted\n' "$name"; else printf '%-44s REFUSED: %s\n' "$name" "$(head -n1 <<<"$body" | head -c 200)"; fi
}
probe "shared rows, grant" spike_notes "household_id = '$H' AND visibility = 'shared' AND $GRANT"
probe "private rows to their owner" spike_notes "household_id = '$H' AND visibility = 'private' AND owner_id = '$U' AND $GRANT"
probe "redacted form to all but the owner" spike_notes "household_id = '$H' AND visibility = 'private' AND owner_id <> '$U' AND $GRANT" "id,household_id,owner_id"
probe "audience, no floor" spike_messages "conversation_id IN (SELECT conversation_id FROM spike_conversation_members WHERE user_id = '$U')"
probe "audience + floor as a constant" spike_messages "conversation_id = '$C' AND seq >= 42 AND conversation_id IN (SELECT conversation_id FROM spike_conversation_members WHERE user_id = '$U')"
probe "audience + floor, scalar subquery" spike_messages "seq >= (SELECT floor_seq FROM spike_conversation_members WHERE user_id = '$U' AND conversation_id = '$C')"
probe "retraction: NOT IN" spike_notes "household_id = '$H' AND id NOT IN (SELECT entity_id FROM sync_changes WHERE for_user_id = '$U')"
