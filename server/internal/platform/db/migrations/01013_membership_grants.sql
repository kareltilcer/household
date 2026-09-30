-- A member's grants on their membership's row (PRD modules/17 Sync; plan item 13): the levels the
-- member list shows, which travel to every member's replica with the membership as derived
-- capability state, never as an editable entity; and beside them, for a child profile, whether its
-- PIN has locked it, which the member list shows and its credential counts (FR-CH5). module_grants
-- stays what a grant is written to and what the tenant middleware resolves a request from; grants is
-- what the membership's stream carries, rewritten by the mutation that changes a role or a grant,
-- which moves the membership's version (internal/platform/household). Each module's level as the member list shows it: an
-- owner's manage on every module, and a member's or a child's stored level capped at their
-- ceiling, none where nothing is stored (access.Ceiling).

-- +goose Up

ALTER TABLE memberships
  ADD COLUMN grants jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(grants) = 'object'),
  ADD COLUMN pin_locked boolean NOT NULL DEFAULT false,
  ADD CHECK (role = 'child' OR NOT pin_locked);

UPDATE memberships m SET grants = (
  SELECT coalesce(jsonb_object_agg(md.id,
    CASE WHEN m.role = 'owner' THEN 'manage'
    ELSE least(coalesce(g.level, 'none'),
      CASE WHEN m.role = 'child' AND md.id = 'finance' THEN 'view'
           WHEN m.role = 'child' THEN 'contribute'
           ELSE 'manage' END::access_level)::text
    END), '{}')
  FROM modules md
  LEFT JOIN module_grants g ON g.household_id = m.household_id AND g.user_id = m.user_id AND g.module = md.id
);

-- A profile is locked from its tenth wrong PIN since its last right one (household.LockAfter) until an
-- owner unlocks it or sets a new PIN; the lock and its end rewrite the row.
UPDATE memberships m SET pin_locked = true
WHERE m.role = 'child'
  AND (SELECT c.failures FROM credentials c WHERE c.user_id = m.user_id AND c.type = 'child_pin') >= 10;
