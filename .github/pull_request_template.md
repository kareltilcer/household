<!-- Title: [NN] <plan item title>. Branch: feat/NN-<slug>. -->

## What and why

<!-- The plan item this implements, what it changes, and what a reviewer should look at first. -->

Plan item NN · [docs/implementation-plan.md](https://github.com/kareltilcer/household/blob/main/docs/implementation-plan.md)

## Where sources disagreed

<!-- PRD > openapi.yaml > docs/design > design/v1. Each disagreement met, which source won,
and what was amended. Every change to openapi.yaml, with its reason. "None" is an answer. -->

## Verified

<!-- The exact commands run and their results. -->

## ⚠ Known gaps

<!-- Untested surfaces, checks that could not run, findings deliberately not fixed. -->

## Definition of done

- [ ] CI is green, including every check that exists at this point:
  - the architecture tests;
  - the contract diff and the tenant-isolation test;
  - the conformance suite;
  - unit, component and vector tests;
  - the strict type check and lint;
  - axe and the pseudolocalisation pass on touched routes;
  - bundle budgets.
- [ ] Operations this PR implements are removed from `contract_pending`. Any change to `openapi.yaml` is deliberate, and its reason is above.
- [ ] Every client screen covers its ledger row's required states (the preset minus its declared exclusions) and passes [07-delivery §3](https://github.com/kareltilcer/household/blob/main/docs/design/07-delivery.md):
  - both themes;
  - 200 % text;
  - colour, icon **and** word;
  - 44 pt targets;
  - absence, not disabling;
  - destructive copy that names the object.
- [ ] New strings are present in all five catalogs, with drafts flagged (PL-9). No user-visible string is a literal.
- [ ] If a decision was taken or behaviour changed, the PRD is updated in this PR ([07 §6](https://github.com/kareltilcer/household/blob/main/docs/prd/07-nonfunctional.md)).
- [ ] The plan is updated: this item's status set to `done`, its **PR** line, and any rewrites, each with a Change log line.

<details>
<summary>A module's server PR also</summary>

Follow the [module model](https://github.com/kareltilcer/household/blob/main/docs/prd/modules/00-module-model.md):

- [ ] **Identity and structure.** A stable module id; its own goose migration block; routes under the tenant and grant middleware.
- [ ] **Audit actions** with summary keys.
- [ ] **Sync entities**, each with a merge policy; the `state_set` key and resolution where the policy is `state_set`; any `additive` cross-row invariant; a redacted projection where one is needed.
- [ ] **Offline-write flags** set for the D-84 phase. A `strict_version` entity whose server item merges after item 67 ships with offline writes on; item 67 turns them on for every module merged before it.
- [ ] **Export and erase** implemented.
- [ ] **Catalog contributions**: widgets with their D-42 client projection, metrics, lists, reminder kinds, search scopes and storage.
- [ ] **Absence.** `404`, not `403`. The nine absence surfaces are tested for a member with `none`.
- [ ] **Ported data.** The module's `design/v1` fixture is in the seed with any drift fixed; its `checks()` are in `packages/test-vectors`.
- [ ] **After item 53:** help entries authored, and the setup re-entry point registered if the module has a setup.
- [ ] Any sync policy or key the PRD leaves unstated is decided, written into the module's PRD page, and listed above.

</details>
