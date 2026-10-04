# 0022 — The crop catalog is a module's reference set of crops timed from the frost dates, read through a hook of the pipeline, with a climate dataset computed from NASA POWER

- **Status:** Accepted
- **Date:** 2026-10-04
- **Plan item:** 22
- **Decides for:** [11-garden](../prd/modules/11-garden.md) (the crop knowledge base, FR-GA1 to FR-GA3, FR-GA21); [01-architecture](../prd/01-architecture.md) §2.4; D-66, D-143, D-144; PL-10; [ADR 0008](0008-reference-data-pipeline.md)

## Context

Plan item 22 writes the first of Garden's reference data: the source format of the crop catalog,
its validator, a climate dataset for the five countries and the first hundred crops. It is the
first set of a module's to go through [ADR 0008](0008-reference-data-pipeline.md)'s pipeline, which
knew only the platform's two datasets and left the hook for a module's to whichever landed first.
Several choices outlive the PR:

- **Where a module's set is declared and checked.** Architecture test 1 keeps the platform from
  importing a module, and `reference.Read` read two hard-coded directories.
- **What a timing is.** D-66 and item 22 allow no calendar date: a window is counted from the
  household's frost dates (FR-GA3). The contract's `RelativeWindow` also carries a week of the year
  and a soil temperature as anchors, and has no way to say that garlic is planted in the autumn
  before the season it is harvested in (FR-GA17).
- **What a frost date is.** The PRD names a last spring and a first autumn frost and no
  definition, and the catalog's offsets mean nothing until there is one.
- **Where the climate numbers come from**, and under what licence. PL-10 has reference content
  drafted by Claude with a source for every field. A frost date drafted from memory is a guess a
  week or two wide, and nobody can re-run it.

## Decision

**A module's reference data is a `reference.Set`**: a directory of `reference-data` named for the
module, the schemas its files are held to, a `Read` that reads them through the platform's
`Reader` and checks what a schema cannot see, and a `Load` that writes what `Read` returned.
- A module declares its set through `module.ReferenceSource`. The registry refuses one not named
  for its module, and `household-api migrate` hands the registry's sets to `reference.Load`, which
  reads and checks every set with the platform's data before anything is written, and then runs
  each set's `Load` in the load's own transaction, after the platform's datasets.
- A set's fields cite the sources `<set>/sources.json` lists, held to the platform's schema for a
  source list. The sources of one set are not another's, so that the test of a set's sources
  being cited is the set's own.
- A set's `Read` is handed a `Reader` of its own: it reads the set's directory and nothing outside
  it, against the schemas the set names and no other set's, and a file of that directory which it
  does not read is a problem. The whole directory is embedded, so a record in a directory the
  set's `Read` does not list would otherwise ship unchecked and unloaded.
- A set's datasets are named `<set>_<dataset>` in `reference_datasets`, which `Load` holds them
  to. A set writes through `reference.Upsert` and `reference.Finish`, which are what the
  platform's own datasets are written with, so its rows and its datasets are versioned the same
  way and none of its rows is ever deleted.
- A set with no `Load` has no tables yet: it is checked and nothing of it is written. Garden's is
  one until plan item 68 makes its tables.

**Garden's set is `internal/modules/garden/catalog`**, the first package of the module, which
arrives with items 68 to 71. Until the module declares the set, the package's own tests are what
holds the shipped files to its `Read`: the validator of item 22. Its source is
`reference-data/garden`:

| Directory | One file per | Schema |
|---|---|---|
| `families/` | botanical family, which rotation and the family rules join on | `garden-family` |
| `pests/`, `diseases/` | pest, and disease or disorder, named once in every language | `garden-problem` |
| `crops/` | crop, with the catalog's varieties of it | `garden-crop` |
| `rules/` | scope: crop pairs, family pairs, successions | `garden-rules` |
| `climate/` | country, with the climate profile of each of its places | `garden-climate` |

**A crop's key is its identity in the catalog** and never changes once shipped, as every record's
key is under ADR 0008: the rules name a crop by it, and plan item 68 gives each crop the id the
contract's `CropId` serves, from it. The Latin name is what is the same in every language, and
`Read` holds it, and the name in each language, to one crop.

**A timing is a window of days from a frost date, and nothing else**: `{ anchor, from_days,
to_days }`, with `last_frost`, `first_frost` or `previous_first_frost` as its anchor. The last is
the first autumn frost of the year before the harvest, for what is sown or planted in autumn and
stands the winter. A crop has four windows, the contract's and `home`'s: `sow_indoor`,
`sow_direct`, `transplant` and `harvest`, its one main cropping. The contract's `week` and
`soil_temp` anchors are a household's to use in an override, never the catalog's; the soil a seed
waits for is the crop's `germination_temp_c`.

**A variety overrides only what differs** (FR-GA2): its timing, spacing, maturity, yield and
storage fields, each absent where it is its crop's. `Read` holds the crop with a variety's
differences to the rules it holds a crop to, since that is the record a household growing the
variety is served. **A rule is a claim about a pair**, a relation
with its basis, `agronomic` or `traditional`, and its severity, and a reason in every language. A
pair is written once, its lesser key first.

**A frost date is the one-year-in-ten date of a night at or below 2 °C** ([D-143](../prd/09-decisions.md)).
The last spring frost is the day after which such a night comes in one spring in ten, and the first
autumn frost the day before which one comes in one autumn in ten. 2 °C at two metres is the
temperature at which the ground frosts, and the threshold the frost warning holds a tender plant to
(plan item 71).

**The climate dataset is computed from NASA POWER** ([D-144](../prd/09-decisions.md)): daily minimum
temperature at 2 m from MERRA-2, 1991 to 2020, at 118 towns of the five countries, one request a
town. Its licence is recorded on its source: NASA's Earth science data are free and open to any
use, and POWER asks to be cited. `reference-data/README.md` gives the method and
`reference-data/tools/garden-climate.mjs` is it, so that the numbers can be computed again:
- A year's last spring frost is its last day from 1 January to 31 July at or below 2 °C, and its
  first autumn frost its first such day from 1 August.
- A place's dates are the 27th of the thirty years' last frosts in order, and the 3rd of their
  first frosts: the 90th and the 10th percentile by nearest rank.
- The hardiness zone is the USDA's, from the mean of each year's lowest minimum, and the season
  the days from the one date to the other, which `Read` holds it to.
- `altitude_m` is the grid cell's, which the values hold at. It is not the town's where the land
  around it rises: Kuřim's cell, the highlands to its west, stands at 512 m.
- A place in whose cell more than three of the thirty years have no such night on one side of
  the summer is left out: the cell is the sea's. Six are, all in the United Kingdom, and
  the dataset holds 112 places.

**Everything is drafted and flagged**, the computed climate values too: `drafted` is the review
ledger (ADR 0008), and a reviewer who has checked a value against its source removes its flag.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| The catalog's types and checks in `internal/platform/reference` | The platform would know every module's records: crops now, then tariffs, document types and vehicle schedules. ADR 0008 put a module's set with the module, and its hook is what item 22 was left to add |
| One `sources.json` for every set | The platform's test that no source goes uncited could not pass without reading every module's set, which the platform may not import |
| Waiting for the Garden module before any Go | The validator is item 22's Done-when, and items 54 and 68 build on the format. The package is the module's first, and nothing of it is thrown away |
| A week of the year or a soil temperature as a window's anchor | A week is a calendar date under another name, wrong in Córdoba (D-66). A soil temperature resolves to no date from a climate profile |
| A second set of windows for an autumn sowing | The contract and `home` give a crop four windows, and the planting editor one planned date of each kind. A second cropping is a note until a module item needs more |
| Each timing as a full date range per country | Five copies of every window, none right for a household that corrects its own frost date (FR-GA3) |
| The mean date of the last 0 °C night | It is the meteorological convention, and half the years frost after it. In Brno it is 17 April, four weeks before anybody plants a tomato out. A catalog offset would have to carry the safety margin a household cannot see |
| The one-in-ten date of a 0 °C night | The grid's minimum is the mean of a cell some fifty kilometres across and reads warmer than a garden's ground: 24 April in Brno, 4 May in London. At 2 °C the same statistic gives 13 May and 16 May, which is when the five countries' gardeners plant out |
| Frost dates drafted from memory (PL-10 as written) | A guess a week or two wide per town, and no method to re-run. The sourced, computed values are flagged for review all the same |
| ERA5-Land, on a grid of 9 km | Better, and CC BY 4.0, but it needs a Copernicus account that only the owner can open. Item 54 completes the coverage and may recompute from it: the format does not change |
| Open-Meteo's archive API, which serves ERA5-Land with no key | Its free API is for non-commercial use |
| Station records of the five national services | Five formats and five licences, and more than one item's work. They are what a reviewer checks the grid against |
| Correcting a town's values for its altitude | It needs the town's own altitude, which the source does not give, and a lapse rate that does not hold for a night's minimum. The cell's altitude is in the data for item 68 to use |
| A regular grid rather than towns | Some 500 cells for the five countries. A town is what a member searches for, and item 54 completes the coverage |

## Consequences

**What gets easier:**
- A module's reference set is a package with a `Set`, its schemas and its directory. It inherits
  the sources, the languages, the review flags, the checks and, with a `Load`, the versions.
- A crop is one reviewed file of JSON, and a new one is checked by `go test` against the families,
  pests and diseases it names.
- A climate profile can be computed again from its source by the method written beside it.

**What gets harder:**
- Every crop needs its names and its notes in five languages before it can merge, and a note may
  name no month and no date. The longest day it may name: a sowing that bolts in lengthening days
  and a harvest that ends with them answer to it, and it is the same day wherever the household
  is.
- A source is cited by the kind of field, and the documents of spacing, yield, germination, soil
  pH, rotation and feeding are written of vegetables: a herb's, a fruit's, a flower's or a green
  manure's value cites them for want of its own source, which each source's note says and the
  reviewer of the flag supplies.
- The catalog describes one cropping of a crop. A crop sown both in spring and in late summer has
  the second in its notes.
- The grid is coarse. Towns of one cell share their values, a town below its cell's altitude reads
  cold, and the mildest coasts are not covered at all.
- Plan item 68 inherits what this leaves: the tables and each dataset's `Load`, the module's
  `Reference()`, the id a crop's key becomes, how the contract's `RelativeWindow` says
  `previous_first_frost`, and `testsupport`'s template, which loads no module's set.

**Revisit this when** a household needs a second cropping as data, when a finer climate source is
at hand, or when a reviewer finds the 2 °C dates off against station records.
