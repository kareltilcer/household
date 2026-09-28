# Reference data

Global reference content, versioned with the code and loaded by the server without a code
change ([D-61](../docs/prd/09-decisions.md), [D-70](../docs/prd/09-decisions.md)): country
profiles, units, and later each module's categories, templates, presets and catalogs. It is the
same for every household, and read-only to them ([PRD 01 §2.4](../docs/prd/01-architecture.md)).
[ADR 0008](../docs/adr/0008-reference-data-pipeline.md) records how the pipeline works and why.

| Path | Holds | Schema |
|---|---|---|
| [`sources.json`](sources.json) | Every source a field cites: a published document by its URL, or a document in this repository by its path | [`sources.schema.json`](schemas/sources.schema.json) |
| [`countries/<code>.json`](countries/) | One country profile per file, named by its ISO 3166-1 code (the United Kingdom is `GB`) | [`country.schema.json`](schemas/country.schema.json) |
| [`units/<dimension>.json`](units/) | One dimension per file, with its units in both systems and their exact conversions | [`dimension.schema.json`](schemas/dimension.schema.json) |
| [`schemas/`](schemas/) | The JSON Schemas (draft 2020-12), with what they share in [`defs.schema.json`](schemas/defs.schema.json) | |

## A field

Every field of a record, except the key that names the record, is a value with its source (PL-10):

```json
"vat_standard_percent": {
  "value": "21",
  "source": "ec-vat-rates",
  "drafted": true,
  "note": "Anything the reviewer should know that the source does not say."
}
```

- **`source`** names an entry of `sources.json`.
- **A text people read carries every language Household ships**: `en`, `cs`, `sk`, `de` and `pl`,
  the server's `i18n.Locales`. Reference data is translated as data, not as strings
  ([PRD 03 §9](../docs/prd/03-platform-strands.md)).
- **`drafted: true`** marks a value drafted without an expert. The drafted flags are the review
  ledger: a reviewer who has checked a value against its source removes its flag. Everything here
  was drafted, and is flagged.
- **`note`** is optional.

## What checks it

`go test` in `server/` runs `reference.Read` over these files, as CI does on every change. It
refuses:

- a file that fails its schema, such as a field without a source or a text missing a language;
- a source that `sources.json` does not list, and, in the test of these files, a source nothing cites;
- a file not named for its record;
- a currency that is not ISO 4217's;
- a unit whose key or CLDR identifier another unit has;
- a dimension whose base unit is not its own, or does not convert to itself;
- a counterpart that is not a unit of the same dimension in the other system.

Another test checks each conversion against the relations that define its unit, so that a
mistyped digit fails. An editor that reads `$schema` validates a file as it is written.

## How it loads

`household-api migrate` applies the migrations, then loads these files, embedded in the binary,
in one transaction:

- A record is inserted at version 1, and updated only when a value differs, which increments its
  version. Loading the same files again writes nothing.
- A dataset's version is incremented by a load that changes any of its records. The read
  endpoints (`/api/v1/reference/…`) return it, so that a client can cache a dataset whole.
- **A record is never deleted.** One the files no longer hold stays in the database, since an app
  in the field may still name it (D-11), and the load logs it as kept. A record renamed is a new
  record, and the old one stays beside it.

The crop catalog (plan items 22 and 54) and each module's own sets follow, each with its schema,
its directory and its tables.
