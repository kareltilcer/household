-- Two households, A and B, each with a row in every tenant table, for the tenant isolation test
-- (FR-NF4). Household A's rows are the ones read; household B's owner is who reads them, and is a
-- member of household A as well, so that household A holds rows of theirs. The PR that adds a
-- tenant table adds its rows here: a tenant table with no row of household A fails the test,
-- since a table the test cannot read from proves nothing. Item 30's seed may take this over.
INSERT INTO users (id, email, email_verified_at) VALUES
  ('01900000-0000-7000-8000-0000000000a1', 'a@example.test', now()),
  ('01900000-0000-7000-8000-0000000000b1', 'b@example.test', now());

INSERT INTO households (id, name, country, timezone, base_currency, locale, units, first_day_of_week, join_code, billing_payer_id) VALUES
  ('01900000-0000-7000-8000-00000000000a', 'A', 'CZ', 'Europe/Prague', 'CZK', 'cs', 'metric', 1, 'AAAAAAAA',
   '01900000-0000-7000-8000-0000000000a1'),
  ('01900000-0000-7000-8000-00000000000b', 'B', 'GB', 'Europe/London', 'GBP', 'en', 'metric', 1, 'BBBBBBBB',
   '01900000-0000-7000-8000-0000000000b1');

INSERT INTO memberships (id, household_id, user_id, role) VALUES
  ('01900000-0000-7000-8000-0000000000f1', '01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000a1', 'owner'),
  ('01900000-0000-7000-8000-0000000000f2', '01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000b1', 'member'),
  ('01900000-0000-7000-8000-0000000000f3', '01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000b1', 'owner');

INSERT INTO module_enablement (id, household_id, module, enabled) VALUES
  ('01900000-0000-7000-8000-0000000000f4', '01900000-0000-7000-8000-00000000000a', 'tasks', true),
  ('01900000-0000-7000-8000-0000000000f5', '01900000-0000-7000-8000-00000000000b', 'tasks', true);

-- An invitation in each household, household A's to household B's owner's address: a row the
-- invitation's own policy would show its addressee outside any household's context, and not in
-- household B's.
INSERT INTO invitations (id, household_id, kind, email, role, grants, token_hash, invited_by, expires_at, max_uses) VALUES
  ('01900000-0000-7000-8000-0000000000f6', '01900000-0000-7000-8000-00000000000a', 'email', 'b@example.test', 'member', '{}',
   decode(repeat('a1', 32), 'hex'), '01900000-0000-7000-8000-0000000000a1', now() + interval '14 days', 1),
  ('01900000-0000-7000-8000-0000000000f7', '01900000-0000-7000-8000-00000000000b', 'link', NULL, 'member', '{}',
   decode(repeat('b1', 32), 'hex'), '01900000-0000-7000-8000-0000000000b1', now() + interval '3 days', 1);

INSERT INTO module_grants (household_id, user_id, module, level) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000a1', 'tasks', 'manage'),
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000b1', 'tasks', 'view'),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000b1', 'tasks', 'manage');

-- An event in each household by household B's owner, who is a member of both, one of them about
-- a private item of theirs.
INSERT INTO audit_events (id, household_id, actor_type, actor_id, module, action, entity_type, entity_id, summary_key, visibility, owner_id) VALUES
  ('01900000-0000-7000-8000-0000000000e1', '01900000-0000-7000-8000-00000000000a', 'user', '01900000-0000-7000-8000-0000000000b1',
   'tasks', 'card.create', 'tasks.card', '01900000-0000-7000-8000-0000000000c1', 'tasks.card.create', 'private', '01900000-0000-7000-8000-0000000000b1'),
  ('01900000-0000-7000-8000-0000000000e2', '01900000-0000-7000-8000-00000000000b', 'user', '01900000-0000-7000-8000-0000000000b1',
   'tasks', 'card.create', 'tasks.card', '01900000-0000-7000-8000-0000000000c2', 'tasks.card.create', 'shared', NULL);

INSERT INTO audit_changes (household_id, event_id, field, old_value, new_value) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000e1', 'title', NULL, '"Milk"'),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000e2', 'title', NULL, '"Bread"');

-- A change in each household, and a retraction in household A addressed to household B's owner.
INSERT INTO sync_changes (household_id, entity_type, entity_id, op, row_version, module, visibility, owner_id, for_user_id, payload) VALUES
  ('01900000-0000-7000-8000-00000000000a', 'tasks.card', '01900000-0000-7000-8000-0000000000c1', 'upsert', 1, 'tasks', 'private',
   '01900000-0000-7000-8000-0000000000b1', NULL, '{"title": "Milk"}'),
  ('01900000-0000-7000-8000-00000000000a', 'tasks.card', '01900000-0000-7000-8000-0000000000c1', 'retract', NULL, 'tasks', 'shared',
   NULL, '01900000-0000-7000-8000-0000000000b1', NULL),
  ('01900000-0000-7000-8000-00000000000b', 'tasks.card', '01900000-0000-7000-8000-0000000000c2', 'upsert', 1, 'tasks', 'shared',
   NULL, NULL, '{"title": "Bread"}');

-- Household B's owner holds a key in each household, and household A's owner one in theirs.
INSERT INTO idempotency_keys (household_id, user_id, key, fingerprint, state, claim, claimed_at) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000a1', 'k1', '\x01', 'in_flight', '01900000-0000-7000-8000-0000000000d1', now()),
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000b1', 'k1', '\x02', 'in_flight', '01900000-0000-7000-8000-0000000000d2', now()),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000b1', 'k1', '\x03', 'in_flight', '01900000-0000-7000-8000-0000000000d3', now());


-- Household B's owner's answer to a mutation they pushed in each household, and household A's owner's in
-- theirs.
INSERT INTO sync_mutations (household_id, user_id, mutation_id, fingerprint, outcome, version, row) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-0000000000d4', decode(repeat('a1', 32), 'hex'), 'applied', 1, '{"title": "Milk"}'),
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-0000000000d5', decode(repeat('a2', 32), 'hex'), 'applied', 1, '{"title": "Eggs"}'),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-0000000000d6', decode(repeat('b1', 32), 'hex'), 'applied', 1, '{"title": "Bread"}');
