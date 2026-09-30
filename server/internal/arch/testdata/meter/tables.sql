-- Grants to the meter role that break architecture test 11's rule, and some that keep it. The test
-- runs this as the migrate role, in a transaction it rolls back.

CREATE SCHEMA arch_testdata;

-- Keeps it: the template, which grants the meter role the household's column.
CREATE TABLE arch_testdata.compliant (id uuid PRIMARY KEY, household_id uuid NOT NULL, note text);
SELECT enable_tenant_isolation('arch_testdata.compliant');

-- Keeps it: a size the test is told the meter role may read.
CREATE TABLE arch_testdata.sized (id uuid PRIMARY KEY, household_id uuid NOT NULL, byte_size bigint NOT NULL, name text);
SELECT enable_tenant_isolation('arch_testdata.sized');
GRANT SELECT (byte_size) ON arch_testdata.sized TO household_meter;

-- What a row says, which the meter role may not read.
CREATE TABLE arch_testdata.noted (id uuid PRIMARY KEY, household_id uuid NOT NULL, note text);
SELECT enable_tenant_isolation('arch_testdata.noted');
GRANT SELECT (note) ON arch_testdata.noted TO household_meter;

-- The whole table, which reaches every column, one added later included.
CREATE TABLE arch_testdata.whole (id uuid PRIMARY KEY, household_id uuid NOT NULL);
SELECT enable_tenant_isolation('arch_testdata.whole');
GRANT SELECT ON arch_testdata.whole TO household_meter;

-- A write, on a column it may read.
CREATE TABLE arch_testdata.written (id uuid PRIMARY KEY, household_id uuid NOT NULL);
SELECT enable_tenant_isolation('arch_testdata.written');
GRANT UPDATE (household_id) ON arch_testdata.written TO household_meter;

-- A sequence it may read and draw from.
CREATE SEQUENCE arch_testdata.counter;
GRANT USAGE, SELECT ON SEQUENCE arch_testdata.counter TO household_meter;

-- A sequence it may only draw from: nextval is a write, whatever it reads.
CREATE SEQUENCE arch_testdata.drawn;
GRANT USAGE ON SEQUENCE arch_testdata.drawn TO household_meter;
