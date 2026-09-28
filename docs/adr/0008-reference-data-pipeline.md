# 0008 — Reference data is sourced JSON the server embeds, validates and loads as it migrates, and serves in every language

- **Status:** Accepted
- **Date:** 2026-09-28
- **Plan item:** 7
- **Decides for:** [01-architecture](../prd/01-architecture.md) §2.4; [03-platform-strands](../prd/03-platform-strands.md) §9; [17-household-admin](../prd/modules/17-household-admin.md) FR-HA1; D-11, D-61, D-70; PL-10

## Context

Plan item 7 builds the pipeline every global reference set goes through: the country profiles and
the units now, then the crop catalog (items 22, 54, 68), tariff presets (56), document types (46),
statutory vehicle schedules (81) and each module's categories and templates. Several choices it
makes outlive the PR:

- **The source format.** PL-10 asks for a source on every field and a value per language, drafted
  by Claude and flagged for expert review, and schema-validated in CI.
- **How data reaches the database.** D-61 and D-70 say a change to reference data must not need a
  change to the code. PRD 01 §2.4 says the tables are global, curated by the platform, read-only to
  tenants and versioned. D-11 says an app in the field keeps working against the new release.
- **What "versioned" means.** A client caches reference data (a region's crop bundle is not synced
  at all, 11-garden), and a household's record keeps what it was made from (FR-HA1).
- **How it is served.** The contract had no read path for it (Q11).

## Decision

**The source is JSON under `reference-data/`, one record per file, with JSON Schemas.**
- A field is `{ value, source, drafted?, note? }`. `source` names an entry of `sources.json`, a
  published document by URL or a document in the repository by path. A record's key, which names
  its file, is the one field without a source.
- A text people read is an object with one member per shipped language; the schemas require
  `en`, `cs`, `sk`, `de` and `pl`, and a test holds that list to the server's `i18n.Locales`.
- `drafted: true` marks a value drafted without an expert. The flags are the review ledger: a
  reviewer who has checked a value against its source removes its flag.
- `reference-data/` is a Go module, as `docs/api` and `packages/i18n` are, so the server embeds
  these very files.

**`reference.Read` checks everything before anything loads.** Each file against its schema, with
`santhosh-tekuri/jsonschema` (already in the build through kin-openapi), then what a schema cannot
see: sources exist, languages match `i18n.Locales`, files are named for their keys, currencies are
ISO 4217's, unit keys and CLDR identifiers are unique, base units convert to themselves, and
counterparts are the same dimension in the other system. It reports every problem at once, as
`<file>#<JSON pointer>: <what>`. `go test` runs it on the shipped data, so CI refuses a record
missing a language or a source.

**`reference.Load` runs at the end of `household-api migrate`,** as the migrate role, which owns the
tables, in one transaction under an advisory lock. The test template is built the same way.
- Each row is an `INSERT … ON CONFLICT DO UPDATE … WHERE` the row differs. A row is inserted at
  version 1 and updated, its version incremented, only when a value changed: loading the same files
  again writes nothing.
- `reference_datasets` holds each dataset's version, incremented by a load that changed any of its
  rows.
- **A row is never deleted.** One the files no longer hold is kept and logged, since an app in the
  field may still name it (D-11). A record renamed is a new row beside the old one, so a table
  holds only its key unique; what else is unique among the records the files hold, such as a
  unit's CLDR identifier, `Read` checks.

**The tables are typed and global**: `country_profiles`, `unit_dimensions`, `units` and
`reference_datasets`, in the platform's migration block. They have no `household_id` and no
row-level security, and the request role only reads them. A text is `jsonb` holding every language.
Rates and conversion factors are `numeric`, as written, and a conversion is `(value + offset) ×
numerator ÷ denominator`, so that °F's 5/9 is exact.

**The reads are `/api/v1/reference/…`**, a fourth scope in the contract beside `/auth` and `/me`,
`/households/{id}` and `/platform`: global, read-only, for any authenticated user (`auth.Required`).
A name carries every language rather than the caller's, so a client renders it in its member's
language offline and after a language switch without asking again. A list carries its dataset's
`version`; one country carries its own as its `ETag`.

**The content** is five country profiles, CZ, SK, DE, PL and GB, and five dimensions (length,
area, mass, temperature, volume) with 25 units. It is all drafted and flagged. The United Kingdom is
`GB`, its ISO 3166-1 code, not `UK`, which ISO only reserves. Every profile, GB's too, defaults to
metric units, as PRD 03 §9 makes metric every household's default; imperial, which PRD 05 §11
counts among what already serves the UK, is a household's choice. Starting GB in imperial, for the
miles a UK odometer reads at the cost of °F, would take a decision that amends PRD 03 §9.
`first_day_of_week` is 0 for Sunday, as JavaScript's `Date#getDay` and Go's `time.Weekday` count,
which the contract now says of the household's field too. A household created without units or a
first day takes its country's, so the contract's household states no default of its own.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| YAML sources | YAML 1.1 reads `NO`, Norway, as false, the first of docs/api/README's hazards, and the Go side would need a YAML parser it does not have. JSON loses comments, which `note` replaces |
| Sources as a map per record, apart from the values | A value and its citation would drift apart in a long record. Side by side, a reviewer checks both at once |
| A separate review ledger, as `packages/i18n/review` is | A translation's ledger records the English it was drafted from, which changes under it. A reference value has no such source text, and a flag beside the value is where its reviewer is |
| Loading at run time from a directory, so data ships without a build | The files must pass CI before they load, and a build is minutes. Changing data without a deploy is item 21's admin editing (D-61) |
| A separate `household-api` command for the load | A migration that adds a field and the data that fills it must land together, and a deploy that forgot the second command would serve the old data |
| Versions authored in the files | Nothing can check an author bumped one: CI sees only the new files. A version the loader counts cannot be forgotten |
| Deleting rows the files no longer hold | A household, a tariff or an app in the field may still name them (D-11). A later item that must withdraw a record adds a field for it |
| One generic table of JSON records | Foreign keys (a household's country, a unit's dimension) and typed columns need typed tables, as PRD 01 §2.4 names them |
| A name in the caller's language only, from `Accept-Language` | A client caches reference data and works offline; a language switch would need a refetch, and the member's language is not the browser's |
| A `locales` table, as PRD 01 §2.4 listed | The languages ship with the catalogs, in `i18n.Locales` and `@household/i18n`. A table would be a third copy; the PRD's table is amended |

## Consequences

**What gets easier:**
- A module's reference set is a schema, a directory, a table in its migration block and a load
  function, and inherits the sources, the languages, the review flags, the versions and the checks.
- A change to reference data is a reviewed diff of JSON that CI validates and the next deploy
  loads, and a load that changes nothing writes nothing.

**What gets harder:**
- Every text needs all five languages before it can merge, and a sixth language fails every record
  until it is translated. That is the point.
- A record cannot be withdrawn by deleting its file.
- Item 21's admin editing writes the same tables the loader writes, so it must decide what the next
  load does to an edit: keep it, or overwrite it from the files.
- The loader's module datasets need a registry hook, which the first module with a reference set
  adds: until then `Load` knows only the platform's.

**Revisit this when** reference data must change faster than a deploy, when a dataset outgrows
loading in one transaction (the crop catalog is the likely one), or when a record must be withdrawn.
