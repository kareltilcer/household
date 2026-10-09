-- What the household's own screens of plan item 27 read that nothing kept (ADR 0028): the client a
-- replica reported as, for the household's clients and their versions (FR-HA18), and each country's
-- supervisory authority for personal data, which the privacy centre links to (PRD 05 §3).
--
-- Both are added to tables that hold rows already, so every column is nullable: an instance of the
-- release before this one, which names none of them, goes on writing a replica's report as it did,
-- and a country's profile has no authority only until the load that follows this migration, in the
-- same `household-api migrate`, gives it the one its file holds.

-- +goose Up

-- The client a replica's last report named in Household-Client (PRD 06 §7): its type, and its
-- version as the client wrote it, a pre-release or a build suffix included, which is how one build of
-- the web app is told from another. A web session keeps its client's version nowhere else, and a
-- device's (devices.app_version) is the account's, whatever household it opened: this is the one
-- record of which clients synced this household, and at which version (GET …/clients). Both are null
-- for a replica that last reported before this migration, and for a report that named no client.
ALTER TABLE sync_replicas
  ADD COLUMN client_type text CHECK (client_type IN ('web', 'mobile')),
  ADD COLUMN client_version text CHECK (client_version <> '' AND char_length(client_version) <= 160),
  ADD CONSTRAINT sync_replicas_client CHECK ((client_type IS NULL) = (client_version IS NULL));

-- The authority a person in the country complains to about how their personal data is handled (GDPR
-- Art. 77): its name, a text per shipped language as a profile's own name is, and the address of
-- its own page where a complaint is lodged, or which says how. Reference data, from the country's
-- file as every other column of the profile is (ADR 0008): the loader writes them, and a change to
-- either is a change to the profile, which increments its version.
ALTER TABLE country_profiles
  ADD COLUMN supervisory_authority_name jsonb CHECK (jsonb_typeof(supervisory_authority_name) = 'object'
    AND jsonb_typeof(supervisory_authority_name -> 'en') = 'string'),
  ADD COLUMN supervisory_authority_url text CHECK (supervisory_authority_url ~ '^https://[^[:space:]]+$'),
  ADD CONSTRAINT country_profiles_supervisory_authority
    CHECK ((supervisory_authority_name IS NULL) = (supervisory_authority_url IS NULL));
