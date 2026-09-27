-- The probe module's one table, a tenant table and a sync entity's like any module's (plan
-- items 3 and 4). Block 99 is the probe's: no module the server serves numbers its block 99.

-- +goose Up
INSERT INTO modules (id) VALUES ('probe');

CREATE TABLE probe_items (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE
);

SELECT add_entity_columns('probe_items');
SELECT enable_tenant_isolation('probe_items');
