# 09 — Decision register

Every decision that shaped this specification, with the alternative that was rejected and why.
**A decision without a rejected alternative is a note, not a decision** — entries here always name
what was not chosen.

Referenced throughout as **D-n**.

## Architecture and tenancy

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| **D-1** | Shared database, `household_id` on every tenant row | Schema-per-tenant; database-per-tenant | Migrations across tens of thousands of schemas become the operational bottleneck; per-database is unrealistic at consumer price points |
| **D-2** | PostgreSQL RLS with `FORCE`, under application scoping | Application scoping alone | A missing `WHERE` clause returns nothing instead of another family's data. The failure mode is the whole point |
| **D-3** | **No database role bypasses RLS for content.** No impersonation, no support session, no "view as" | A consented, time-boxed, audited impersonation flow | Makes the no-content-access guarantee a property of the system rather than a policy. Cost: some bugs are slower to diagnose — accepted, mitigated by D-20 |
| **D-4** | Household in the URL path; no "current household" on the session | A header, or session-selected active household | Explicit, visible in logs and traces, cache-friendly, and unambiguous for offline clients holding several households |
| **D-5** | Single EU region, EU subprocessors, no non-EU transfer in the request path | Multi-region from launch | Cleanest GDPR posture for a European consumer product; multi-region doubles the ops surface for no early benefit |
| **D-6** | Export and erase are **mandatory** module interfaces | Optional, added when needed | Retrofitting export across seventeen modules is how it never gets done. Art. 17 and 20 are not negotiable |
| **D-7** | Two credential presentations (web cookie, mobile token pair), one authorization path | Tokens everywhere; cookies everywhere | Cookies are XSS-safe on web and wrong on native; one authorization path means one place to get right |
| **D-8** | The WebSocket carries a **nudge**, not a payload | Per-user payload fan-out (`home` v10's design) | If the payload never rides the socket, the socket never needs to know who may see it. Chat is the single exception |
| **D-9** | Pre-signed URLs per object, minutes-long, never per prefix | Direct bucket access; long-lived URLs | The URL carries the authorization decision, not the authorization |
| **D-10** | Staging never holds production data, anonymised or not | An anonymised production copy | The debugging value is exactly the privacy exposure D-3 exists to prevent |
| **D-11** | Expand/contract migrations, forward-only | In-place breaking migrations | Mobile clients cannot be force-updated; a migration that breaks the previous minor is a broken product |

## Sync

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| **D-22** | The change-feed row carries `module`, `visibility`, `owner_id`, `audience_id` — the last being any enumerated member list, a chat conversation or a `member_shared` calendar alike | Joining to module tables to authorise a feed pull | One indexed scan with one `WHERE`, whose correctness lives in one place, instead of seventeen joins re-established per module |
| **D-23** | **Client-generated UUIDv7 ids**, mandatory | Server-assigned ids with local-to-real remapping | An offline create must have a stable identity immediately. Remapping across every table is where offline systems go to die |
| **D-24** | Every entity declares one of five merge policies; **no global default**. A `state_set` entity additionally declares its key and its resolution rule; an `additive` entity declares any cross-row invariant it carries | Last-write-wins everywhere; or a policy set broad enough that declaring one says nothing | A shopping item that flickers is a nuisance; a finance rule silently half-merged is a wrong number nobody finds. The two sub-declarations exist because four entities were using `state_set` for things the one-line definition did not cover |
| **D-25** | Attachments upload out of band with a `pending` status on the row | Blocking the mutation on the upload | A receipt photographed in a car park should appear on every device before the bytes have moved |
| **D-26** | Client timestamps are advisory; ordering is by server receipt; skew beyond 24 h is clamped | Trusting client clocks for ordering | A skewed device must not reorder a household's history |
| **D-39** | Conflicts are surfaced for `strict_version` entities and invisible for `lww_field` ones | Always ask; never ask | The dividing line is whether a wrong answer costs anything |
| **D-76** | The activity log is **not** synced offline | Replicating it like everything else | Unbounded, rarely read, never needed offline — the largest local store for the least benefit |
| **D-80** | Permissions are never client-authoritative; cached grants are rendering hints | Trusting the cached grant offline | A client must never believe it can change its own permissions |
| **D-82** | Mandate the **sync-ready schema** in Phase 0 week 1, before choosing an engine | Building the engine first and adding the columns as they are needed | The schema half is catastrophic to change later and cheap to get right; the engine half is contained and replaceable. Separating them is what makes the risk manageable |
| **D-83** | **Spike two off-the-shelf sync engines before building one**, timeboxed to a week with a written verdict | Building from scratch by default | The design is close enough to existing systems that building it should be a decision. Even if the build proceeds, it proceeds having learnt which requirement forced it |
| **D-84** | Offline **writes** ship per merge policy behind a per-entity flag — `additive` and `state_set` everywhere first, plus `lww_field` **for Shopping only**, which is the module the engine is proved on | Shipping offline writes for every entity at once; or holding all `lww_field` to Phase 2 | The two policies that cannot conflict by construction cover the three offline scenarios that sell the product. Shopping is the exception because gate G-C tests it on real phones and a list you cannot add to offline proves nothing. Everywhere else a Phase 1 bug still degrades to "you need signal for that edit" rather than "your data is wrong". This argument only holds while `state_set` genuinely means idempotent, which is why lexorank positions were moved out of it to `lww_field` rather than riding the Phase 1 flag on a technicality |
| **D-85** | Clients send a **rolling digest** of local state; the server forces a resnapshot on mismatch | Trusting the tests and waiting for user reports | Divergence is the bug class unit tests miss and users never report clearly. This turns it into an alerting metric |
| **D-88** | A partly-visible entity emits **two feed rows** — full to the owner, `redacted` to everyone else. A redacted projection carries whatever the busy form needs to be *correct*, including a recurrence rule | One row filtered or re-rendered per recipient on the way out; or a projection so minimal that a recurring private event renders as a single block | Per-recipient rendering on the pull hot path is the mistake D-8 avoided on the socket. Two rows keep the pull a single indexed scan, and what is safe to reveal stays the entity's decision. A busy block that is wrong about *when* somebody is busy fails at the one job it has, so the cadence travels and the content does not |
| **D-90** | The **audience floor** is a term in the sync pull predicate; the audience membership row stores `floor_seq` | Filtering chat out of the generic feed into a chat-specific pull that already understands floors | A second delivery path is a second place for the four access axes to be re-implemented. Without the term, the REST path honours FR-CT2's floor and the feed hands a newly added member the conversation's back catalogue |
| **D-91** | Client-generated ids are required on the **REST create path** too, not only in sync mutations, and an architecture test enforces it | Requiring them only where the sync protocol already carries them, and letting REST creates mint server ids | An entity that gets a server id online and a client id offline is exactly the dual identity D-23 exists to prevent. The requirement was already stated; what was missing was the thing that fails the build |
| **D-92** | An `Idempotency-Key` stores only a `2xx` response: a request refused before it took effect stores nothing, and a repeat runs it again. A repeat while the first request runs, or of one that took effect without its response being kept, answers `409 idempotency_in_progress` and is never run again. A first request that has not taken effect five minutes after it arrived is taken to have died: a repeat then runs it, and the first can no longer take effect | Storing every response, refusals included, for the key's seven days; or storing the response only after the handler, with no marker committed beside the effect | A stored refusal would answer a retry after its reason had gone: a `402` after the payment, a `404` after the grant came back. Without the marker, a process that dies between the effect and the store leaves a claim a repeat takes over, and the effect happens twice ([ADR 0006](../adr/0006-sync-ready-schema-and-the-mutation-spine.md)) |

## Identity and access

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| **D-12** | Breached-password screening against a local dataset | A third-party API check | No password material, hashed or prefixed, leaves the platform |
| **D-13** | Enumeration-resistant sign-up and reset (always `202`) | Telling the user the email is taken | Account enumeration is the first step of every credential-stuffing campaign |
| **D-14** | Rotating single-use refresh tokens with family reuse detection | Long-lived refresh tokens | Standard detection for a stolen token, and cheap |
| **D-15** | Access tokens carry **no** roles or grants | Embedding grants in the JWT | Revoking access takes effect on the next request, not in fifteen minutes |
| **D-16** | Refusals are `404`, never `403`, for grants and privacy alike | `403` for "exists but forbidden" | A `403` is an existence oracle — over private items, over conversations, and over which modules a household uses |
| **D-17** | A child is a **managed sub-profile**, not a self-registering user | A real account with verifiable parental consent | Age of digital consent varies 13–16 across the EU; the parent is present, is the customer, and is already administering the account |
| **D-18** | Child profiles are **excluded** from analytics, not anonymised within it | Anonymised inclusion | Exclusion is checkable; anonymisation is a claim |
| **D-19** | Adults' private roots are readable by nobody; a child's is readable by an owner, and the child is told | Symmetric privacy; or silent parental access | A private space a parent can *silently* read is worse than no private space |
| **D-20** | Member-initiated diagnostic bundles, shown in full before sending | Support-initiated data pulls | The member decides, and sees what they shared |
| **D-59** | Finance defaults to `none` for new members | `home`'s posture, where a reader saw both incomes | Flatmates, adult children and separated co-parents all exist. The default must be closed |
| **D-78** | A member is notified when their access changes | Silent grant changes | An access change discovered by finding something missing is a bug |

## Business

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| **D-30** | One paid plan; no feature tiers in 1.0 | A tiered pricing matrix | No evidence yet about what people pay more for. A tier cannot be removed once sold |
| **D-31** | Overage on the monthly **daily average**, not the peak | Peak-based metering | A 40 GB upload deleted the same day must not become a 40 GB bill |
| **D-32** | Lapsed households become read-only, retained 12 months, never locked out of export | Deletion, or blocking reads | Deleting a lapsed customer's three seasons of garden history is both a betrayal and, in the EU, a fight you lose |
| **D-33** | A hard ceiling on extra storage, expressed as a multiple of the base fee (≈4×, so 20 blocks = 205 GB = €20) | Unbounded metered billing; a ceiling stated in gigabytes | Unbounded consumer metering ends in a €900 invoice and a chargeback. Tying the ceiling to the base fee means it stays correct when either price moves |
| **D-34** | **5 GB included, then 10 GB blocks at €1/month** (≈€0.10/GB), sized so the large majority never see a variable line | Continuous per-GB metering; fixed 10/50/200 GB plan tiers; and an earlier 1 GB-at-€1/GB configuration | Blocks keep the invoice predictable and explainable while still recovering cost from heavy households. €0.10/GB is 6–8× cost and ~5× the consumer anchor, which does not matter at absolute figures of €1–€2. The rejected 1 GB/€1 configuration would have put most paying households on €8–25 against an advertised €4.99 |
| **D-74** | Chat is household-scoped only | Cross-household messaging | Keeps Household out of DSA "online platform" obligations and removes any route by which a stranger contacts a child |
| **D-89** | The **UK is a launch market**, the only one outside the EU | An EU-only launch, adding the UK once the EU markets are proved | It needs no translation, its utility and vehicle regimes are already presets, and it is the largest single-language market available. The cost is bounded and known: a UK Art. 27 representative, a UK VAT registration, ICO routing, and one open question on the Online Safety Act ([05](05-privacy-and-compliance.md) §11) |
| **D-87** | GDPR Art. 18 restriction is a `restricted` **entitlement state**, owner-set and owner-reversible | An independent `frozen` flag beside the entitlement state | One gate, one source of `402`, one exemption list. Two gates is two chances to forget one |

## Platform

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| **D-21** | Audit summaries stored as **translation keys plus arguments** | Rendered sentences, as in `home` | Two members read the same event in different languages; adding a language does not require re-rendering history |
| **D-27** | Reminders are a platform **strand**; the module is its interface | Each module implementing lead times | Ten modules register reminder kinds; ten implementations of lead time, snooze and completion is how ten subtly different behaviours ship |
| **D-28** | Storage quota blocks **uploads**, never reads, and never deletes | Blocking access, or automatic deletion | The failure mode must be "I can't add more", which is comprehensible |
| **D-29** | English is the source language; no user-visible literal in client code | Czech source, as in `home` | Enforced by an architecture test rather than by discipline |
| **D-35** | Data-subject rights are self-service in-app | Handling them by support ticket | A right that requires emailing support is a right most people never exercise |
| **D-40** | Cross-module links are **platform-resolved references**, never joins | Modules joining to each other's tables | The referring module does not know about the referenced module's grants and privacy. The platform does |
| **D-75** | Platform actions on a household are written into that household's own log | Platform-side logging only | It is what makes the no-content-access guarantee checkable rather than merely stated |
| **D-86** | The EEA guarantee covers Household's own processing; a **member-initiated** calendar connection may transfer their events to a named recipient under their own consent | Import-only external calendars, keeping the guarantee absolute | A family calendar that cannot write back quietly stops matching the one on the member's work phone, which is the problem the module exists to solve. Bounded to one feature, off by default, per member, busy-only offered first |

## Clients

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| **D-36** | Two codebases; share the contract, tokens and strings, not components | React Native Web, one codebase | RN Web desktop layouts are worse for exactly the screens Household needs most |
| **D-37** | Shared **test vectors**, not shared implementations, for anything computed on both sides | One shared implementation; or trusting two | CI is the only thing that keeps two implementations honest over time |
| **D-38** | Module order and visibility are per member | A fixed household-wide order | A member who uses only Garden should not scroll past Finance |
| **D-41** | A child's dashboard layout can be **locked** by an owner | Always freely arrangeable | Requested capability; the affordances are absent rather than disabled |
| **D-42** | Widgets declare a server resolver **and** a client projection, cross-checked | Server-only widget data | Otherwise the offline dashboard is a stale cache rather than a dashboard |

## Finance

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| **D-54** | One module, one ledger, four toggleable capabilities | Two exclusive modes; or two modules | Two ledgers describing the same money is a product that disagrees with itself; "switch mode" is a migration a consumer must not perform |
| **D-55** | FX rate captured at entry and stored on the row | Live re-conversion of history | Otherwise last month's total changes every time it is looked at |
| **D-56** | Exactly one `remainder` rule per allocation source, enforced at save | Distributing rounding proportionally | `home`'s `needs` behaviour, promoted from an implementation detail to an invariant. It is what makes every total reconcile exactly |
| **D-57** | Deterministic assignment of the last minor unit in a split | Random or floating assignment | A balance that changes when you refresh it is not a balance |
| **D-58** | Renewal reminders fire at the **notice period**, not at expiry | Reminding on the renewal date | The moment cancelling is still possible is the only moment the reminder is worth anything. Applied identically in Finance, Utilities and Vehicles |
| **D-81** | Transactions carry a `source` discriminator from day one | Adding it with bank import | Lets open banking arrive later without a migration, and keeps imported and typed rows distinguishable forever |

## Utilities

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| **D-60** | Three modes per service; a household may mix them | One depth for everyone | A renter with an invoice and an owner reconciling a settlement are the same module |
| **D-61** | Tariff presets are versioned reference **data** | Presets in code | A billing arrangement changing must not require a deploy, and a missing preset must be addable by an admin |
| **D-62** | Registers are data; a meter has 1..n | `home`'s hardcoded VT/NT pair | Single-rate, two-rate, three-rate and solar export are all ordinary and only one of them fits a fixed pair |
| **D-63** | Unit conversions (gas m³→kWh, heat GJ→kWh) are versioned objects | Constants in code | Volume correction and calorific value change, appear on the invoice, and differ by country |
| **D-64** | A typed, ordered component list; **no formula language** | A user-writable expression DSL | Covers every arrangement in the target markets, is validatable, renders as a human-readable breakdown, and is not a code-injection surface |

## Garden

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| **D-65** | Three progressive tiers on **one** data model | Simple/advanced pair; separate lightweight module | Raised-bed gardeners are the largest group and sit exactly in the gap a two-tier split leaves. Nobody outgrows it and nobody is buried on day one |
| **D-66** | A curated, versioned, multi-language crop catalog owned by the platform | `home`'s per-install LLM import; community-only content | Per-install data is wrong invisibly, different everywhere, unmaintainable, and Czech-climate-only. The catalog is a product asset and a moat |

## Other modules

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| **D-43** | Snoozing a reminder is **personal** even when completion is shared | Snooze implies complete | You can stop being told about the boiler service without marking it done for everybody |
| **D-44** | A personal calendar is a private root, not a hidden flag | A `private` boolean on events | Same model as Notes and Documents; refusals are `404` |
| **D-45** | An event stores its own IANA timezone | UTC plus the household timezone | A recurring 08:00 school run must stay 08:00 across a DST boundary and across a holiday abroad |
| **D-46** | Per-occurrence exceptions with the three-way edit choice | `home`'s series-only edits | A family calendar without "just this Tuesday" is not a family calendar |
| **D-47** | External calendars can be imported **as busy only** | Details or nothing | It is what makes a member willing to connect a work calendar at all |
| **D-48** | Calendar conflicts resolve by **ownership**, never field-by-field | Field-level merge | A meeting that took its time from one system and its date from another is a meeting nobody attends |
| **D-49** | `fixed_interval` chores anchor on the **last completion** | A fixed grid | Grid anchoring accumulates a debt of missed occurrences and turns the app into a guilt generator. `calendar` exists for genuinely grid-based chores |
| **D-50** | Chore verification is **off** by default | On by default for children | A household that wants trust-based chores should not have to switch supervision off |
| **D-51** | Streaks and household progress; **no leaderboards** | Ranking members against each other | Ranking siblings or partners produces exactly one outcome and it is not more clean dishes |
| **D-52** | Rotation advancement is server-authoritative, driven by the occurrence | Client-predicted advancement as truth | Two offline completions of one rotating chore must advance it once |
| **D-53** | Document expiry lead times default **per document type** | One global default | Six months for a passport and one month for an insurance policy is the difference between used and configured-once-then-abandoned |
| **D-67** | One asset engine, three modules with their own vocabulary | A single "Possessions" module | People look for their car under "car" |
| **D-68** | Usage-based schedules need usage readings and degrade honestly without them | Silently never becoming due | A schedule that never fires is worse than no schedule |
| **D-69** | Starter checklists with real default intervals for Property and Pets | An empty list and a plus button | It is what makes the module useful the same evening rather than after an hour of typing |
| **D-70** | Statutory vehicle schedules are country reference data | Hardcoded per country | Rules change; a missing country must be addable without a release |
| **D-71** | Fuel consumption computed between consecutive **full** fills | Naive per-fill division | Getting this wrong produces nonsense numbers, which is why every fuel-log app that gets it wrong is abandoned |
| **D-72** | A deceased pet is archived with its history, never deleted | Deletion, or a plain status change | The history matters and the flow should be gentle |
| **D-73** | Medication doses complete for the whole household | Per-member completion | "Did you already give it" must have one answer |
| **D-77** | Changing the base currency recomputes totals from stored rates, warned and audited | Silent redenomination; or forbidding the change | Silently redenominating a household's history would be the worst bug the product could ship |
| **D-79** | A member-facing sync-health screen | Hiding sync internals | When offline-first goes wrong, its absence is why sync bugs become support tickets |

## Carried unchanged from `home`

Recorded so nobody re-litigates them. Each is `home`'s decision, still correct, and adopted here:
the audit spine writing in the mutation's transaction · lexorank for hand-ordering · soft delete by
default with a `manage`-gated hard delete · derived-on-read computation with no cache · money as
integer minor units · slug paths with no redirects · immutable document bytes · two-scope pinning ·
`404`-not-`403` for private items · the 2000 ms hold gesture with a mandatory keyboard path ·
"the module never shows a number it hasn't earned" · money never interpolated, pictures may be ·
generated tasks never overwriting edited ones, with tombstones · bed order as the adjacency model ·
occupancy windows defining what "shares a bed" means · advisory checks that never block a save.
