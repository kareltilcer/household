-- Tables for the streams and entities of testdata/replication: some replicated as architecture test
-- 10 requires, and some not. The test runs this as the migrate role, in a transaction it rolls back.

CREATE SCHEMA arch_testdata;

-- Keeps it: published as replicate publishes a table.
CREATE TABLE arch_testdata.published_items (id uuid PRIMARY KEY, household_id uuid NOT NULL, title text, visibility text);
SELECT replicate('arch_testdata.published_items');

-- A stream reads it, and nothing published it.
CREATE TABLE arch_testdata.unpublished_items (id uuid PRIMARY KEY, household_id uuid NOT NULL);

-- Added to the publication by hand: at the default replica identity, and not readable.
CREATE TABLE arch_testdata.halfway_items (id uuid PRIMARY KEY, household_id uuid NOT NULL);
ALTER PUBLICATION powersync ADD TABLE arch_testdata.halfway_items;

-- Readable by the replication role, and no stream reads it.
CREATE TABLE arch_testdata.exposed_items (id uuid PRIMARY KEY, household_id uuid NOT NULL);
GRANT SELECT ON arch_testdata.exposed_items TO household_powersync;

-- Published, and no stream reads it: an entity's, which the role reads past row-level security
-- whatever keeps it.
CREATE TABLE arch_testdata.withheld_items (id uuid PRIMARY KEY, household_id uuid NOT NULL);
SELECT replicate('arch_testdata.withheld_items');
