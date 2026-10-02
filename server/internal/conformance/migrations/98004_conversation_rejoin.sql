-- A member who left a conversation may join it again (plan item 17): leaving keeps the membership as
-- a tombstone (writeMember), which 98001's constraint, one membership of a member in a conversation,
-- would hold against every later one. A member is in a conversation once at a time instead, by a
-- membership that is not deleted, and joins again by a membership of their own, from the
-- conversation's next message on.

-- +goose Up
ALTER TABLE conformance_conversation_members
  DROP CONSTRAINT conformance_conversation_memb_household_id_conversation_id__key;
CREATE UNIQUE INDEX conformance_conversation_members_live
  ON conformance_conversation_members (household_id, conversation_id, user_id) WHERE deleted_at IS NULL;
