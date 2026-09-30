-- What the request role may do with what the migrate role creates (PRD 01 §2.3). The
-- migrate role owns the database, and so the public schema, whose owner is
-- pg_database_owner. The request role reads and writes rows and creates nothing; row-level
-- security, which every tenant table enables and forces, decides which rows. The meter
-- role gets its columns one grant at a time, from item 14.

-- +goose Up
GRANT USAGE ON SCHEMA public TO household_app, household_meter;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO household_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO household_app;
