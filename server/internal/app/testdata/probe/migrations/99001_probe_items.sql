-- The probe module's one table, a tenant table like any module's (plan item 3). Block 99 is the
-- probe's: no module the server serves numbers its block 99.

-- +goose Up
INSERT INTO modules (id) VALUES ('probe');

CREATE TABLE probe_items (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE
);

SELECT enable_tenant_isolation('probe_items');
