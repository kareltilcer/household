-- Grants to the staff role that break architecture test 12's rule, and some that keep it. The test
-- runs this as the migrate role, in a transaction it rolls back.

CREATE SCHEMA arch_testdata;

-- Keeps it: a tenant table the staff role reads nothing of.
CREATE TABLE arch_testdata.unread (id uuid PRIMARY KEY, household_id uuid NOT NULL, note text);
SELECT enable_tenant_isolation('arch_testdata.unread');

-- Keeps it: a name the test is told the staff role may read, and the household it is of.
CREATE TABLE arch_testdata.named (id uuid PRIMARY KEY, household_id uuid NOT NULL, name text, body text);
SELECT enable_tenant_isolation('arch_testdata.named');
SELECT enable_staff_read('arch_testdata.named');
GRANT SELECT (household_id, name) ON arch_testdata.named TO household_staff;

-- What a row says, which the staff role may not read.
CREATE TABLE arch_testdata.noted (id uuid PRIMARY KEY, household_id uuid NOT NULL, note text);
SELECT enable_tenant_isolation('arch_testdata.noted');
SELECT enable_staff_read('arch_testdata.noted');
GRANT SELECT (note) ON arch_testdata.noted TO household_staff;

-- A household's column on a table the test is not told of: the role reads nothing it is not granted
-- by name, the column that names a household included.
CREATE TABLE arch_testdata.counted (id uuid PRIMARY KEY, household_id uuid NOT NULL);
SELECT enable_tenant_isolation('arch_testdata.counted');
GRANT SELECT (household_id) ON arch_testdata.counted TO household_staff;

-- The whole table, which reaches every column, one added later included.
CREATE TABLE arch_testdata.whole (id uuid PRIMARY KEY, household_id uuid NOT NULL);
SELECT enable_tenant_isolation('arch_testdata.whole');
GRANT SELECT ON arch_testdata.whole TO household_staff;

-- A write, on a column it may read.
CREATE TABLE arch_testdata.written (id uuid PRIMARY KEY, household_id uuid NOT NULL);
SELECT enable_tenant_isolation('arch_testdata.written');
GRANT UPDATE (household_id) ON arch_testdata.written TO household_staff;

-- A sequence it may draw from: nextval is a write.
CREATE SEQUENCE arch_testdata.drawn;
GRANT USAGE ON SEQUENCE arch_testdata.drawn TO household_staff;
