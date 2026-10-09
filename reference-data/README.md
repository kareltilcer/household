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
| [`garden/`](garden/) | Garden's set: the crop catalog and the climate profiles, [below](#gardens-set-the-crop-catalog) | `garden-*.schema.json` |
| [`schemas/`](schemas/) | The JSON Schemas (draft 2020-12), with what they share in [`defs.schema.json`](schemas/defs.schema.json) | |
| [`tools/`](tools/) | What computes a dataset from its source, run by hand and never by the server | |

The country profiles and the units are the platform's own. A module's reference data is a **set**:
a directory named for the module, with a `sources.json` of its own that its fields cite, read and
checked by the module's own code through the same pipeline
([ADR 0023](../docs/adr/0023-the-crop-catalogs-source-the-reference-set-hook-and-the-climate-dataset.md)).

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

- **`source`** names an entry of `sources.json`: the one at the root for the platform's data, a
  set's own for the set's. A source whose data is computed from, rather than read and restated,
  records the `licence` it is used under.
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
- a country's supervisory authority whose address is not an `https` one with a host;
- a unit whose key or CLDR identifier another unit has;
- a dimension whose base unit is not its own, or does not convert to itself;
- a counterpart that is not a unit of the same dimension in the other system.

Another test checks each conversion against the relations that define its unit, so that a
mistyped digit fails. An editor that reads `$schema` validates a file as it is written.

A set is checked by its module's tests, with the same `reference.Read`, until its module is
registered; from then a deploy checks it too. A set's own checks read its directory and no other,
against the schemas the set names, and a file there that they do not read is refused: a record in
a directory the set does not have is one nothing would check.

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

A set is loaded by its own module's `Load`, in the same transaction, once it has tables. Garden's
has none yet: its files are checked, and plan item 68 loads them.

## Garden's set: the crop catalog

`garden/` is the curated crop catalog (PRD 11, D-66) and the climate profiles a household's place
resolves to. Plan item 22 wrote its format and its first hundred crops; item 54 adds the rest.

| Path | One file per | Holds |
|---|---|---|
| [`garden/families/`](garden/families/) | botanical family | Its name in each language and in Latin. Rotation and the family rules join on it |
| [`garden/pests/`](garden/pests/), [`garden/diseases/`](garden/diseases/) | pest; disease or disorder | Its name in each language, and the organism's. A crop lists keys, not five translations |
| [`garden/crops/`](garden/crops/) | crop | Everything below, and the catalog's varieties of it |
| [`garden/rules/`](garden/rules/) | scope | The crop pairs, the family pairs and the successions |
| [`garden/climate/`](garden/climate/) | country | The climate profile of each of its places |

**A crop** carries its names and its Latin name, its family, what it is grown as and for how long,
how it is started, its hardiness, feeder class, root depth, sun, water and soil pH, its rotation
break, its sowing depth, spacing and plants per square metre, its germination temperature and
days, its days to maturity, its four timing windows, the care tasks it calls for, its harvest unit
and expected yield, how its harvest keeps and for how long, its common pests and diseases, and its
care notes. Every measure is metric. Its key is its identity: it names the file, the rules name
the crop by it, and it never changes once shipped.

**A timing is a window of days from a frost date, never a calendar date:**

```json
"transplant": {
  "value": { "anchor": "last_frost", "from_days": 0, "to_days": 14 },
  "source": "rhs-grow-your-own",
  "drafted": true
}
```

- `last_frost` and `first_frost` are the household's two frost dates (FR-GA3).
  `previous_first_frost` is the first autumn frost of the year before the harvest, for what is
  sown or planted in autumn and stands the winter (FR-GA17): garlic, a strawberry bed.
- A crop has a `harvest` window and at least one of `sow_indoor`, `sow_direct` and `transplant`:
  its one main cropping. A second sowing season is said in its notes.
- A note, and a rule's reason, names no date, no month and no year, in any language: "after the
  last frost" is true wherever the household is. The one day it may name is the longest of the
  year, midsummer: a sowing that bolts in lengthening days and a harvest that ends with them
  answer to it and not to the frost, and it is the same day wherever the household is.

**A variety** belongs to one crop and overrides only what differs (FR-GA2): a field it does not
name is its crop's. **A rule** is the pair it is about and what is claimed of it: a relation, its
basis, `agronomic` where a mechanism is documented and `traditional` where it is long practice
with weak or contested evidence, its severity, and a reason in each language. A pair is written
once, its lesser key first, and matched both ways; a succession names what was grown and then
what follows.

### The climate profiles

`garden/climate/<country>.json` holds, for each place, the last spring frost, the first autumn
frost, the hardiness zone and the length of the season, with the altitude they hold at.
[`tools/garden-climate.mjs`](tools/garden-climate.mjs) computes them from NASA POWER's daily
minimum temperature at 2 metres, 1991 to 2020, and states the method in full:

- **A frost date is the one-year-in-ten date of a night at or below 2 °C**
  ([D-149](../docs/prd/09-decisions.md)): the last spring frost is the day after which such a night
  comes in one spring in ten, and the first autumn frost the day before which one comes in one
  autumn in ten. The catalog's windows are counted from these dates, so a tender crop goes out
  from day 0.
- The hardiness zone is the USDA's, from the mean of each year's lowest minimum.
- The source's grid is 0.5° by 0.625°, some fifty kilometres. Places in one cell share their
  values, and `altitude_m` is the cell's, not the town's: Kuřim's cell stands at 512 m.
- **Six places are not covered**: Aberdeen, Aberystwyth, Belfast, Exeter, Penzance and Plymouth,
  whose cells are the sea's. Plan item 54 completes the coverage.

To compute them again, with the answers kept in a directory of your choosing:

```bash
node reference-data/tools/garden-climate.mjs <cache directory>
```

```bash
pnpm exec prettier --write "reference-data/garden/climate/*.json"
```

### What checks the catalog

`go test ./internal/modules/garden/catalog` in `server/` runs the catalog's `Read`, which refuses,
beyond what the schemas do:

- a crop whose family, pest or disease the catalog does not hold, or whose Latin name or name in
  a language is another crop's;
- a crop with no sowing or planting window beside the harvest window its schema requires, one
  sown under cover and never planted out, and a window or a range that runs backwards;
- a crop started from seed with no sowing window, germination temperature or days to germinate,
  one with a sowing window and no depth or a depth and no sowing window, and an annual with no
  days to maturity;
- a variety whose key another of its crop has, one that makes of its crop a crop refused above
  (sown under cover and never planted out, sown with no depth, a perennial with days to maturity,
  a green manure with a yield), and one that overrides the spacing and not the plants per square
  metre its crop gives;
- a rule that names a record the catalog does not hold, a pair written twice or with its greater
  key first, and a succession between a crop and a family;
- a place whose key does not carry its country or is another place's, whose frost dates are not
  days of the year in order, or whose season is not the days between them.

The tests hold the shipped catalog to its hundred crops, the climate to the countries that have a
profile, and every note and reason to naming no month and no date.

### Reviewing it

Everything in the set was drafted, and is flagged: `"drafted": true` on a field is its line in the
review ledger. `rg -c '"drafted": true' reference-data/garden` counts what is left, file by file.
A source is the document to check a value against, not a claim that it was copied from there:
the names against EPPO's and Wikidata's, the timings against the growing guides restated as days
from the frost dates, and the climate values against station records. A source's `note` in
[`garden/sources.json`](garden/sources.json) says what it does not cover: the spacing, yield,
germination, soil pH, rotation break and feeder class of a herb, a fruit, a flower or a green
manure cite documents written of vegetables, for want of that crop's own, and the reviewer who
checks such a value gives it the source it was checked against.
