-- The global reference data (PRD 01 §2.4, PRD 03 §9): the country profiles, and the units a
-- household measures in. Curated by the platform and the same for every household, so these
-- tables have no household_id and no row-level security; the request role reads them and writes
-- nothing. Their rows come from the reference-data directory, which the loader
-- (internal/platform/reference) writes as the migrate role once the migrations have run (D-61,
-- D-70). The loader never deletes a row: an app in the field may still name one (D-11).

-- +goose Up

-- Each dataset's version, which the loader increments when a load changes any of its rows, for a
-- client that caches a dataset whole, and when that load ran. A load that changes nothing writes
-- neither.
CREATE TABLE reference_datasets (
  name text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9_]*$'),
  version bigint NOT NULL CHECK (version > 0),
  changed_at timestamptz NOT NULL
);

-- PRD 03 §9: metric by default, imperial available. A household's own setting is item 10's.
CREATE TYPE unit_system AS ENUM ('metric', 'imperial');

-- A name is a text per shipped language, an object with one member per language: reference data
-- is translated as data (PRD 03 §9). The reference-data schemas and the loader hold it to every
-- language the server ships; a table holds it to English, the source.

-- What a household in the country is offered (FR-HA1). A row's version is incremented by the
-- loader each time it changes the row.
CREATE TABLE country_profiles (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  name jsonb NOT NULL CHECK (jsonb_typeof(name) = 'object' AND jsonb_typeof(name -> 'en') = 'string'),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  -- A decimal percent: numeric keeps the rate as written, 21 or 5.5.
  vat_standard_percent numeric NOT NULL CHECK (vat_standard_percent >= 0 AND vat_standard_percent < 100),
  default_units unit_system NOT NULL,
  -- 0 is Sunday, as JavaScript's Date#getDay and Go's time.Weekday count.
  first_day_of_week smallint NOT NULL CHECK (first_day_of_week BETWEEN 0 AND 6),
  -- The country's sets of public holidays and document types, which Calendar and Documents define.
  holiday_set text NOT NULL CHECK (holiday_set ~ '^[a-z][a-z0-9_]*$'),
  inspection_label text NOT NULL CHECK (inspection_label <> ''),
  document_type_set text NOT NULL CHECK (document_type_set ~ '^[a-z][a-z0-9_]*$')
);

-- A kind of quantity, and the unit its units convert to. The keys that tie a dimension and its
-- units to one another are checked when the loader's transaction commits, so that it may write
-- them in any order.
CREATE TABLE unit_dimensions (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  name jsonb NOT NULL CHECK (jsonb_typeof(name) = 'object' AND jsonb_typeof(name -> 'en') = 'string'),
  base_unit text NOT NULL
);

-- A unit, and its exact conversion to its dimension's base unit: base = (value + offset) ×
-- numerator ÷ denominator. numeric holds each factor as written, 0.45359237, or as a fraction
-- where it has no finite decimal, 5/9 for °F. A CLDR identifier is unique among the units the
-- files hold, which the loader checks, but not here: a unit the files rename is kept under its
-- old key beside its successor, and both name the same CLDR unit.
CREATE TABLE units (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  dimension text NOT NULL REFERENCES unit_dimensions (key) DEFERRABLE INITIALLY DEFERRED,
  system unit_system NOT NULL,
  symbol text NOT NULL CHECK (symbol <> ''),
  cldr text NOT NULL CHECK (cldr ~ '^[a-z]+(-[a-z]+)*$'),
  name jsonb NOT NULL CHECK (jsonb_typeof(name) = 'object' AND jsonb_typeof(name -> 'en') = 'string'),
  to_base_offset numeric NOT NULL,
  to_base_numerator numeric NOT NULL CHECK (to_base_numerator > 0),
  to_base_denominator numeric NOT NULL CHECK (to_base_denominator > 0),
  counterpart text REFERENCES units (key) DEFERRABLE INITIALLY DEFERRED,
  CHECK (counterpart <> key)
);

ALTER TABLE unit_dimensions
  ADD FOREIGN KEY (base_unit) REFERENCES units (key) DEFERRABLE INITIALLY DEFERRED;

-- Read-only to the request role, as the modules table is.
REVOKE INSERT, UPDATE, DELETE ON reference_datasets, country_profiles, unit_dimensions, units
  FROM household_app;
