-- Child profiles (PRD 02 §6, FR-CH1–FR-CH5; plan item 11): a managed profile an owner makes in their
-- household, with no address, which signs in with the household's code, its profile and a PIN. A
-- profile is a user, whose one credential is a child_pin, and a membership whose role is child
-- (ADR 0012). This block adds what the PIN's lockout counts, what the member list shows of a
-- profile, the link a graduation sends and who sent it, and the read of a household by its code
-- that a child's sign-in makes before any household's context.

-- +goose Up

-- The wrong PINs a child profile has been given since its last right one (FR-CH5): the tenth locks
-- the profile until an owner unlocks it or sets a new PIN (D-104). Only a PIN counts any: a
-- password's failures are the sign-in throttle's (ratelimit.LoginAccount), which cools an address
-- down rather than locking it.
--
-- A child_pin's updated_at, which a sign-in holds the PIN it checked to as a password's (01008),
-- also moves when an owner unlocks its profile or removes it from its household, with no new secret,
-- so that a sign-in checking the PIN meanwhile signs nobody in, nor takes a count of ten made after
-- the unlock for the one it made before it (ADR 0012): for a PIN, it is when an owner last set it,
-- unlocked it or removed its profile, and the count of wrong ones is the count since then or since
-- the last right one.
ALTER TABLE credentials
  ADD COLUMN failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  ADD CHECK (type = 'child_pin' OR failures = 0);

-- What a child's membership says of the profile beyond its role (FR-CH1, FR-CH2): the birth year an
-- owner may give, a year and never a date, used only for age-appropriate defaults and birthday
-- reminders; and whether the child's dashboard is locked against their rearranging it, which plan
-- item 36 applies. Neither says anything of a member who is not a child.
ALTER TABLE memberships
  ADD COLUMN year_of_birth smallint CHECK (year_of_birth BETWEEN 1900 AND 9999),
  ADD COLUMN dashboard_locked boolean NOT NULL DEFAULT false,
  ADD CHECK (role = 'child' OR (year_of_birth IS NULL AND NOT dashboard_locked));

-- The link an owner's graduation of a child profile sends to the address the profile will have
-- (FR-CH4): its row keeps the address, which becomes the account's only once the link sets a
-- password with it, and the owner who sent it, sent_by, whose ownership it lapses with, as an
-- invitation does (D-103): its confirmation checks that they are still an owner of the profile's
-- household. No other token has a sender. The value is compared as text, since a value added to an
-- enum cannot be used in the transaction that adds it.
ALTER TYPE email_token_purpose ADD VALUE 'graduate';
ALTER TABLE email_tokens
  ADD COLUMN sent_by uuid REFERENCES users (id),
  ADD CHECK ((purpose::text = 'graduate') = (sent_by IS NOT NULL));

-- The household code a child's sign-in presents (FR-CH1), which the server sets with SET LOCAL to
-- find its household before any household's context exists; NULL when unset, as the tenant
-- settings read.
CREATE FUNCTION app_join_code() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.join_code', true), '') $$;

-- Outside any household's context, a household is read by its members, as before, and by whoever
-- presents its code, which identifies it and authenticates nobody (FR-CH1): the code is how a child
-- profile, with no address, says which household it signs in to.
DROP POLICY household_read ON households;
CREATE POLICY household_read ON households FOR SELECT
  USING (
    id = app_household_id()
    OR (app_household_id() IS NULL AND (
      EXISTS (SELECT FROM memberships m WHERE m.household_id = households.id AND m.user_id = app_user_id())
      OR join_code = app_join_code()))
  );
