-- The tables of the spine's test modules: an entity's table as any module's is, with the base
-- columns and the tenant isolation. Block 95 is theirs.

-- +goose Up
INSERT INTO modules (id) VALUES ('spine'), ('other');

CREATE TABLE spine_items (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  title text NOT NULL
);

SELECT add_entity_columns('spine_items');
SELECT enable_tenant_isolation('spine_items');
