-- Architecture test 8's fixture: SQL that breaks the money rule, beside SQL that keeps it.
-- A comment about amount numeric is not a column, and neither is 'price real' in a string.

-- +goose Up
CREATE TABLE expenses (
  id uuid PRIMARY KEY,
  amount numeric(12, 2) NOT NULL,
  unit_price real,
  fee double precision,
  refund money,
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  quantity_kg numeric,
  fx_rate text,
  note text DEFAULT 'price numeric'
);

ALTER TABLE expenses ALTER COLUMN amount_minor TYPE decimal;
ALTER TABLE expenses ALTER COLUMN quantity_kg SET DATA TYPE float8;

CREATE VIEW expense_totals AS
  SELECT id, amount_minor::numeric / 100 AS euros, quantity_kg::float8 AS kg
  FROM expenses;

CREATE DOMAIN amount_eur AS numeric(12, 2);
CREATE DOMAIN weight_kg AS numeric(8, 3);

ALTER TABLE expenses ADD COLUMN "price" numeric;

CREATE VIEW expense_euros AS
  SELECT id, CAST(amount_minor AS numeric) / 100 AS euros, CAST(quantity_kg AS float8) AS kg
  FROM expenses;
