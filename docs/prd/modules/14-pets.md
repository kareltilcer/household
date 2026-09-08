# 14 — Pets (Mazlíčci)

> **New.** The third module on the shared asset engine ([12-property.md](12-property.md)) — with
> one important difference: a pet is not an asset, and the module's language, defaults and privacy
> posture reflect that even where the underlying tables are shared.

## What it is

The household's animals: their health record, their routine, and who is responsible for what today.

Two distinct jobs, and both matter:

1. **The record** — vaccinations, treatments, weight, microchip, insurance, vet. The thing you
   cannot find when the vet asks.
2. **The routine** — feeding, medication, walks, litter. The thing that gets missed when two people
   each assume the other did it.

## Setup

Light. Add a pet: species, name, photo, date of birth or adoption. Species then pre-fills a
**translated, species-appropriate care schedule** — core vaccinations with their real cadences, worm
and flea treatment intervals, typical feeding frequency — all editable. As with Property's starter
checklist (**D-69**), this is what makes the module useful the same evening rather than after an
hour of typing.

## Functional requirements

**FR-PE1 — Pets.** Species, breed, name, sex, neutered flag, date of birth or adoption, colour and
markings, microchip number, passport or registration number, photo, current weight, status
(`active`, `rehomed`, `deceased` — with a date and, deliberately, a gentle flow: a pet that has died
is archived with its history intact and never silently deleted). **D-72.**

**FR-PE2 — Health record.** Dated entries with a type:

| Type | Fields |
|---|---|
| `vaccination` | Vaccine, batch, administered on, next due, vet |
| `treatment` | Parasite treatment, medication, dose, course start and end |
| `condition` | Diagnosis, ongoing flag, notes |
| `procedure` | What, when, outcome, cost |
| `weight` | Value and unit — an `additive` series with a chart |
| `note` | Free text with photos |

Every entry may carry documents and a cost.

**FR-PE3 — Recurring care schedules.** Per FR-AS1, though almost always time-based: vaccinations,
parasite treatments, grooming, dental, check-ups. Each generates a reminder; a completed entry
advances the next due date from the completion, not from a grid (**D-49**, the same rule Chores
uses, for the same reason).

**FR-PE4 — Medication courses.** A medication with a dose, a frequency and a course length produces
**per-dose occurrences** that a member ticks. This is the one place in the module where per-occurrence
tracking is worth the weight: a twice-daily antibiotic for ten days is exactly the situation where
"did you already give it" is a real question with a bad answer.

Completion is **shared** — anyone in the household can record a dose, and everyone sees it
immediately. **D-73.**

**FR-PE5 — Daily routine.** Feeding, walks, litter, medication: a lightweight per-day checklist,
optionally assignable, resetting daily, showing **who did it and when**. It is deliberately not
Chores — a chore has a rotation, points and a schedule; a pet's daily routine is a shared checklist
that resets, and modelling it as chores makes it heavier than it deserves.

Where a household *wants* pet care in the rotation, a chore can reference a pet, and the routine
stays for the parts that reset daily.

**FR-PE6 — Vet and contacts.** Practice name, phone, address, out-of-hours number, and the pet's
insurance policy with its renewal reminder. The out-of-hours number is on the pet's screen, one tap
from the top, because that is the moment it is needed.

**FR-PE7 — Feeding details.** Food brand and type, amount per meal, meals per day, allergies and
intolerances, and things they must not have. Together with FR-PE6 this makes the pet screen the
thing you hand to whoever is looking after them.

**FR-PE8 — Costs.** Food, insurance, vet, grooming, per year — with the same optional hand-off to
Finance as the other asset modules.

**FR-PE9 — Weight tracking.** An `additive` series with a chart and an optional target range from
species and breed. Small feature, high engagement, and genuinely useful.

## Data model

`pets`, `pet_health_entries`, `pet_medications`, `pet_medication_doses`, `pet_routine_items`,
`pet_routine_completions`, `pet_vets`, `pet_insurance_policies`, plus the shared
`asset_service_schedules` and `asset_service_records`, and document references. Species care
templates are global reference data in `pet_care_presets`.

## Sync

| Entity | Policy | Notes |
|---|---|---|
| `pets.pet` | `lww_field` | |
| `pets.health_entry` | `additive` | A record of something that happened |
| `pets.medication` | `strict_version` | A dose schedule is not a thing to merge |
| `pets.medication_dose` | **`state_set`** | Key **`(dose_occurrence)`** — not `(occurrence, user)`. A dose is given once to the animal, not once per person, so two members recording the same dose resolve to one dose rather than two. This is **D-73** expressed as a merge key, and it is why [03](../03-platform-strands.md) §2.5 makes the key a declaration rather than an assumption. Resolution `latest_client_time`; the *fact* is the dose, the recorded actor is whoever the server received first |
| `pets.routine_completion` | `state_set` | Key `(routine_item, date)`, same reasoning, daily. Who ticked it is shown (FR-PE5) and is not part of the key |
| `pets.vet`, `pets.insurance_policy` | `lww_field` | |

## Catalog contributions

| Kind | Key |
|---|---|
| Widget | `pets.today` — today's routine and any doses due, per pet, with who has done what |
| Metric | `pets.routine_open_today`, `pets.doses_due_today`, `pets.health_due_30d`, `pets.overdue_care` |
| List | Mirrors of each |
| Reminder kind | `pets.care_due`, `pets.medication_dose`, `pets.insurance_renewal` |
| Search scope | `pets.pet`, `pets.health_entry` |
| Storage | Document and photo references |

## Permissions

Standard gate, with one deliberate default:

**FR-PE10 — Pets defaults to `contribute` for every member including children.** Feeding the cat is
the archetypal thing a child does and should be able to tick off, and a module they cannot touch is
a module they will not open. Editing the health record and the medication schedule still requires
`manage`.

## Non-goals

- **No veterinary advice, no symptom checker, no diagnosis.** Household is not a medical device and
  will not imply that it is.
- No breed or health prediction, no genetic anything.
- No vet booking, no pharmacy, no marketplace, no affiliate links.
- No GPS tracker integration, no activity-monitor integration.
- No pet social features of any kind.
