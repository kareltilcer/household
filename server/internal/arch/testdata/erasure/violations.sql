-- A tenant table the erasure test must fail, beside the fixture's. The test runs this after the
-- fixture, in a transaction it rolls back. The table is the migrate role's, as a migration's would
-- be; the rows are the administrator's.
SET LOCAL ROLE household_migrate;

-- Isolated, and naming its household without hanging from it: no foreign key takes its rows when the
-- household's row goes.
CREATE TABLE erasure_orphans (id uuid PRIMARY KEY, household_id uuid NOT NULL);
SELECT enable_tenant_isolation('erasure_orphans');

-- Hanging from its household, as every tenant table must: its rows go with it.
CREATE TABLE erasure_kept (id uuid PRIMARY KEY, household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE);
SELECT enable_tenant_isolation('erasure_kept');

RESET ROLE;

INSERT INTO erasure_orphans VALUES
  ('01900000-0000-7000-8000-000000000011', '01900000-0000-7000-8000-00000000000a'),
  ('01900000-0000-7000-8000-000000000012', '01900000-0000-7000-8000-00000000000b');
INSERT INTO erasure_kept VALUES
  ('01900000-0000-7000-8000-000000000013', '01900000-0000-7000-8000-00000000000a'),
  ('01900000-0000-7000-8000-000000000014', '01900000-0000-7000-8000-00000000000b');
