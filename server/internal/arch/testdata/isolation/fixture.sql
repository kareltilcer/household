-- Two households, A and B, each with a row in every tenant table, for the tenant isolation test
-- (FR-NF4). Household A's rows are the ones read; household B's owner is who reads them. The PR
-- that adds a tenant table adds its rows here: a tenant table with no row of household A fails
-- the test, since a table the test cannot read from proves nothing. Item 30's seed may take
-- this over.
INSERT INTO users (id) VALUES
  ('01900000-0000-7000-8000-0000000000a1'),
  ('01900000-0000-7000-8000-0000000000b1');

INSERT INTO households (id) VALUES
  ('01900000-0000-7000-8000-00000000000a'),
  ('01900000-0000-7000-8000-00000000000b');

INSERT INTO memberships (household_id, user_id, role) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000a1', 'owner'),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000b1', 'owner');

INSERT INTO module_enablement (household_id, module, enabled) VALUES
  ('01900000-0000-7000-8000-00000000000a', 'tasks', true),
  ('01900000-0000-7000-8000-00000000000b', 'tasks', true);

INSERT INTO module_grants (household_id, user_id, module, level) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000a1', 'tasks', 'manage'),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000b1', 'tasks', 'manage');
