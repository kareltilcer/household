# 05 — Privacy & compliance

Household is a European consumer product holding a family's finances, documents, location,
children's data and private messages. Privacy is not a section of the marketing site; it is a
set of requirements with tests.

## 1. Posture

| | |
|---|---|
| **Controller** | The operating entity is the **controller** for account, billing and telemetry data, and the **processor-like custodian** for household content. In law it is a controller throughout — Household decides the means — but the product is built so that its access to content is nil |
| **Legal bases** | *Contract* for everything needed to deliver the service; *legitimate interest* for security, abuse prevention and aggregate service improvement; *consent* for optional analytics and marketing email — never for the service itself |
| **Residency** | All personal data stored and processed in the EU, **including UK customers' data**, which is lawful because the UK recognises the EEA as adequate for transfers out of the UK. No transfer outside the EEA in **Household's own** request path. The single exception is a member-initiated third-party calendar connection — see §10 |
| **Retention** | Content for the life of the household plus the lapse window; account data 30 days after deletion; billing records 10 years (statutory); security logs 12 months; platform audit 7 years |
| **Sub-processors** | Published list, notified 30 days before any addition, with a right to object |
| **DPA** | Available to any customer on request, with the sub-processor list annexed |
| **DPO / representative** | Named on the website. No **EU** Art. 27 representative is required while the entity is EU-established — but a **UK** one **is**, because the UK is a launch market and UK GDPR reaches an EU controller offering services to people in the UK. See §11 |

## 2. Data minimisation, by design

Things Household deliberately does **not** collect:

- **No precise device location, ever.** The Garden module needs a *location for climate data*;
  it asks for a place (town, or a map pin the member drops), stores it on the **household**, and
  never reads device GPS. No module requests location permission.

  **"Reduced precision" is a number, not an adjective: coordinates are rounded to two decimal
  places** — about 1.1 km — at the moment they are stored, and the rounded value is the only one
  that is ever persisted, logged, exported or sent anywhere. Two decimals is more than enough for a
  frost date, a hardiness zone and a forecast grid cell, and it is not enough to identify a house.
  The API schema constrains it (`multipleOf: 0.01`) so that the rule is enforced by the contract
  rather than remembered by a handler, and a member who drops a pin sees the map snap to the
  rounded point rather than being told afterwards that it was blurred.
- **No contacts access.** Invitations are typed or shared as a link. The apps never request the
  contacts permission.
- **No advertising identifiers, no ad SDKs, no third-party trackers in the apps or the web app.**
- **No behavioural profiling and no automated decision-making** with legal or similarly
  significant effects.
- **No email or calendar mailbox scraping.** Calendar sync is explicit, per-calendar, and
  scoped ([modules/04-calendar.md](modules/04-calendar.md)).
- **Nothing about children beyond the minimum** ([02](02-identity-and-access.md) FR-CH2).
- **No photo library access beyond the single-file picker** the OS mediates.

**FR-PR1 — Every OS permission the apps request is justified in a table in the release notes,**
and a permission with no module using it is removed. Permission creep is how privacy claims stop
being true without anyone deciding.

## 3. Data-subject rights

All self-service, all in-app, none requiring a support ticket. **D-35: a right that requires
emailing support is a right most people never exercise**, and building the automation is cheaper
than handling the requests.

| Right | Implementation | SLA |
|---|---|---|
| **Access / portability** (Art. 15, 20) | `POST /api/v1/me/exports` — a personal export of everything about the requesting user across every household they are in. `POST …/households/{id}/exports` — a full household export, owners only | Generated async, ready within 24 h, downloadable for 7 days |
| **Rectification** (Art. 16) | Ordinary editing. Profile and household settings are directly editable | Immediate |
| **Erasure** (Art. 17) | Account deletion (§4) and household deletion (§5) | 30 days |
| **Restriction** (Art. 18) | An owner puts the household into the `restricted` entitlement state — everything readable and exportable, nothing writable, reversible by the same owner ([04](04-billing-and-entitlements.md) FR-BI7) | Immediate |
| **Objection** (Art. 21) | Analytics consent is withdrawable in settings; marketing email has one-click unsubscribe | Immediate |
| **Complaint** | Link to the supervisory authority for the member's own country — their lead EU authority, or the **ICO** for UK residents — in the privacy centre | — |

### Export format

**FR-PR2 — The export is useful outside Household, or it does not satisfy Art. 20.** A ZIP
containing:

- `manifest.json` — what is inside, when it was taken, the schema version.
- One `<module>.json` per module — complete structured data, matching the API schemas so that the
  OpenAPI document *is* the export documentation.
- `files/` — every document, attachment and photo with original filenames, in a folder structure
  mirroring the app's.
- **Human-readable derivatives where a standard exists**: `calendar.ics` for Calendar,
  `finance-transactions.csv` and `finance-accounts.csv` for Finance, `notes/*.md` for Notes,
  `utilities-readings.csv` for Utilities, `chat.html` for Chat.
- `activity-log.csv` — the audit history, redacted as it would be on screen for the requester.

Every module implements `ExportSource` or it does not ship
([01-architecture.md](01-architecture.md) §4).

**An export is its requester's (D-139).** `manifest.json` names every other entry with its length
and its SHA-256, the archive's own schema version and the API's, so that whoever holds the archive
can check it is whole. A household's export holds every shared row, its requester's own private
items and a child profile's ([02](02-identity-and-access.md) FR-CH3), and never another adult's,
which is why nobody else lists it or is handed its link, an owner included, and why its requester
is handed it only while they are still an owner of the household. A member's own export
holds `account.json`, what the account keeps outside any household, and under
`households/{household_id}/` each household's part: what they made and what they keep privately,
from the modules they can see, and the events they caused. A household they left gives what they
kept privately there while §5's window lasts, and a `suspended` household gives nothing
([04](04-billing-and-entitlements.md) §3). A user asks for five exports of a kind in a day; while
one waits or runs, asking again answers it; one that fails three times has failed, with nothing
partial kept; and its row is kept 30 days after it ended, for the list to say what became of it.

## 4. Account deletion

**FR-PR3 — Deleting an account is available in-app on iOS, Android and web**, as both stores
require, and it never silently destroys other people's data.

The flow resolves each of the user's households first, and states plainly what will happen:

| Situation | Outcome |
|---|---|
| Sole owner of a household with **no other members** | The household and all its data are deleted with the account |
| Sole owner of a household with other members | Deletion is **blocked** until the user promotes another owner or explicitly chooses to delete the household. Both options are offered in the flow |
| Non-sole owner, or a member | The membership ends. Household content the user created **stays** — it is the household's record, not the individual's — with authorship shown as a former member. Their **private root** is deleted |
| Billing payer | Must transfer billing or cancel first |

**D-137** settles what the table leaves open. An owner whose own account is scheduled for deletion
counts as no owner, so that nobody leaves a household to an owner who is leaving it too. The payer
blocks while the household goes on without them, and while one that goes with the account has a
subscription that will charge again: its own, live at the payment processor, and not cancelled at
its period's end, or one whose first payment is still on its way there, a bank debit's, which is
the household's own and renews once that goes through (D-131): its payer waits for the processor to
say how the payment went, and cancels what it then pays for. An owner taking billing over whose own
payment for it is still on its way, a bank debit's (D-133), blocks as its payer does: billing is
theirs once it clears. One who accepted the offer and has confirmed no card yet is not blocked, and
takes nothing over once they have asked: billing is not offered to an owner whose account is
scheduled for deletion, and a card of theirs confirmed afterwards moves nothing
([04](04-billing-and-entitlements.md) FR-BI6). One its payer has cancelled charges nothing more
however long the period it paid for still runs, and a household with no subscription, in its
trial, in `grace` or lapsed, charges nothing at all ([04](04-billing-and-entitlements.md) §3), so
whoever let a trial run out has nothing to cancel first. A household erased is no longer charged:
its subscriptions are ended at the processor as it goes, at once and with nothing refunded for the
days not used (D-140), and an erased account's customers there are deleted with it
([ADR 0021](../adr/0021-export-erasure-and-the-tombstones.md)); the invoices the processor issued
are its own record, kept as the statute asks (§1). A household chosen for deletion is scheduled
then, with the account's, and its members are told; cancelling the account's deletion cancels it,
as an owner the household has by then does, and nothing else. The request is refused with every
blocking household at once, never one at a time. A `suspended` household answers nobody (D-115),
so a client cannot read who else is in one before it asks: the web says so of one the user owns,
offers to delete it with the account all the same, and the server's resolution stands (**D-163**).
Nor can it read whose account is scheduled for deletion: such an owner is listed as an owner
still, so the other owner of their household is told the membership ends and is then refused. The
web draws a household the refusal names as the user's alone to own as that from then on, with the
box that deletes it with the account, whatever its members say when they are read again
(**D-173**).

**FR-PR4 — Deletion is a 30-day soft window then irreversible.** The account is disabled
immediately, sessions and tokens are revoked (under D-93 a sync token already issued runs until it
expires, as [02](02-identity-and-access.md) FR-ID7 says), and the user is emailed a cancellation
link. After 30 days a nightly job executes: `EraseSource` on every module for the affected scope,
object-store prefix deletion, and replacement of the identity row with a tombstone carrying only
the id and the deletion timestamp. **Authorship references become an opaque id with a translated
label** ("Former member") — dangling foreign keys and rewritten history are both worse than a
tombstone.

The account signs nobody in during the 30 days, whatever proved who was asking, and each attempt
fails as a wrong password does ([02](02-identity-and-access.md) FR-ID3). **The link cancels it,
signed out (D-136)**: its token is the email's and the answer's to the request that scheduled the
deletion, and nothing else brings the account back. The email is sent once, so a password reset
asked for at the account's address sends the link again, with a new token in place of the one
before: a new password would sign nobody in. At execution each household is resolved again
as it then stands (D-137): where the account is by then the only owner, of a household it did not
choose to delete, the adult who has been a member longest becomes its owner, and a household left
with nobody who could own it, child profiles alone, goes with the account. An adult whose own
account is scheduled for deletion may still come back, so a household is never erased from under
one for want of an owner: an owner in that state stays its owner, a member in that state succeeds
where nobody is staying, and the household is resolved again when their account is erased in its
turn. **What the household recorded of the person in
its own events stays (D-141)**: who did a thing loses their name, and *Removed Petr* keeps Petr's,
as a note that names him does.

**FR-PR5 — Backups are excluded from the 30-day guarantee and the policy says so.** Encrypted
backups are retained 35 days and are not selectively editable. Deleted data ages out of backups
within that window and backups are never restored selectively into production.

## 5. Household deletion and departure

**FR-PR6 — Household deletion** is owner-only, requires typing the household name, warns that it
affects every member, and notifies all members immediately. Same 30-day window, same irreversible
execution.

**The household works as it did for the 30 days (D-138)**: the window is its members' time to take
what is theirs, each by their own export. Every member is emailed when it is scheduled and when it
is cancelled, whatever they muted, and the members other than the one who did it are sent a push;
the household's row says when it goes, and any owner cancels. Since no member can stop those emails,
a household's deletion is scheduled five times a day and no more
([02](02-identity-and-access.md) §9). Its erasure deletes every row of it,
by deleting its own, which every tenant table hangs from, and every object under its prefix; its
child profiles, which are nothing outside it, are erased with it (D-140).

**FR-PR7 — When a member leaves or is removed**, their **private root** in Notes and Documents is
deleted after a 30-day window in which they can export it. An owner may hard-delete a departed
member's private items sooner to reclaim storage — the one asymmetry `home` v9 established,
carried over — and doing so is logged in the household's own activity log where everyone sees it.

The window is the platform's: it starts in the transaction that ends the membership, and the nightly
job asks each module to delete what the member kept privately once it has passed. A member who is
back in the household by then keeps what they had. A child profile removed from its household is an
account nobody can sign in to: it is erased when the same 30 days have passed (D-140). The owner's
hard-delete lands with the first module that has a private root (plan item 43).

## 6. The no-content-access guarantee

**D-3, restated here because it is a compliance commitment and not only an architecture choice.**

> **No Household employee, contractor or automated support system can read the content of a
> household's data. There is no impersonation feature, no support session, no "view as", no
> content-reading endpoint, and no database credential that bypasses row-level security for
> content tables.**

What that means concretely:

| | |
|---|---|
| **Enforced by** | The absence of a bypass role in PostgreSQL, plus RLS `FORCE` on every content table, plus a role of the staff's own that holds the columns that are metadata and no others (**D-143**). Not by policy, not by an access-request workflow |
| **Staff see** | Account and billing metadata, entitlement state, storage totals, delivery outcomes, crash reports, audit **action keys** without summaries or diffs, feature flags |
| **Staff never see** | Any field of any content row, any file, any message, any rendered audit summary, any search term |
| **The debugging path** | The member-initiated diagnostic bundle ([02](02-identity-and-access.md) FR-PS1): the member chooses to send, sees exactly what is in it before sending, can redact, and it expires in 30 days |
| **The cost, stated** | Some bugs will be slower to diagnose. That is the trade, and it is made deliberately |
| **The test** | An integration test connects as each role the server runs as, `household_app`, `household_migrate`, `household_meter` and `household_staff`, and finds none a superuser or one that bypasses row-level security. As the first two it reads another household's rows in every content table, with no household in context and in a household of its own, and gets zero rows; as the last two, which read across households, it selects every column that is not one the role is granted, a count or a size for the meter and metadata for the staff, and is refused each. It runs in CI on every commit |

> **Under D-93 one database credential does bypass row-level security: PowerSync's replication
> role** ([01](01-architecture.md) §2.3, [ADR 0001](../adr/0001-sync-engine.md)). The sync
> service replicates from the write-ahead log, which row-level security does not filter, and sets
> no tenant, so it could read no table's initial snapshot otherwise. The credential is the service's
> own; no staff member, staff tool or support system connects with it, so it is not a staff-facing
> role and the test above leaves it out. What it reads reaches a member only through the stream
> definitions generated from the entity registry, and a read-path isolation test holds them to one
> household. PowerSync's bucket storage holds the replicated rows outside row-level security, so it
> is household content under this section, kept in the EU and encrypted at rest like the database,
> and the credential to its database is the service's own as well. For these two credentials the
> guarantee rests on who holds them rather than on their absence, and the privacy policy says so.

**FR-PR8 — Lawful access requests** are handled by `platform_admin` and can compel disclosure that
the architecture makes technically difficult. The honest statement — which belongs in the privacy
policy — is that Household holds the encryption keys to object storage and could be compelled to
produce data by a competent authority; what it cannot do is browse it casually. Requests are
logged, the customer is notified unless legally prohibited, and a transparency report is published
annually.

**Not claimed:** end-to-end encryption. Household does not have it, and saying otherwise would be
false. Content is encrypted in transit (TLS 1.3) and at rest (storage-level and database-level),
with keys managed by the platform. E2EE is incompatible with server-side search, notification
rendering, digest metrics and export generation — all of which the product depends on. This is
written down so nobody later believes it was an oversight.

## 7. Children

Beyond [02](02-identity-and-access.md) §6:

- Child profiles are **excluded from analytics collection entirely** — not anonymised, excluded.
  A child profile is an account whose credential is a PIN: its client reads `is_child` on the
  account and starts no analytics for it, and nothing the server counts names it.
- No marketing communication is ever sent to or about a child profile.
- No child data is used for any purpose other than delivering the household's own service.
- The privacy notice has a **plain-language section addressed to children**, in each supported
  language, explaining what the app records and that a parent can see it.
- A child profile has no email, so there is no channel through which anyone could contact them.

## 8. Security commitments that are privacy commitments

| | |
|---|---|
| **Transport** | TLS 1.3, HSTS with preload, certificate transparency monitoring |
| **At rest** | Database and object-store encryption; backups encrypted with separately managed keys |
| **Secrets** | A managed secret store; no secret in an environment variable in production images, no secret in the repository |
| **Passwords** | Argon2id; breached-password screening at set time |
| **Dependencies** | SBOM per release, automated vulnerability alerts, a published patch SLA |
| **Testing** | Automated security scanning in CI; an external penetration test before general availability and annually thereafter |
| **Breach** | A documented response plan, 72-hour supervisory-authority notification, and direct notification to affected households |
| **Vulnerability disclosure** | A published `security.txt` and a disclosure policy with a commitment not to pursue good-faith researchers |

## 9. Analytics and telemetry

**FR-PR9 — Product analytics are opt-in, EU-hosted, and never include content.**

| Collected | Never collected |
|---|---|
| Screen views, feature activation, module enablement, funnel steps | Any field value, title, name, message, amount or filename |
| Crash reports with stack traces | Any user-entered text in a crash report, which is scrubbed before send |
| Performance timings | Precise location, advertising id, device fingerprint |
| Aggregate counts per household | Anything at all from a child profile |

Consent is the account's, kept beside it, off until its user turns it on, and given by saying so:
setting the consents replaces both, so one a request leaves out is withdrawn (D-142). A child profile
is asked nothing and consents to nothing (§7).

Consent is asked once, plainly, with a genuine decline that is as easy as accept, and it is
withdrawable in settings. **The product works identically either way** — no feature is degraded
for declining, because that is what makes consent freely given and therefore valid.

## 10. Member-initiated third-party connections

**D-86.** §1's residency guarantee covers what Household does with a household's data. It cannot
and does not cover what a member chooses to do with their own accounts elsewhere, and pretending
otherwise would make the guarantee false rather than strong.

There is exactly one such connection in 1.0: **external calendar sync**
([modules/04-calendar.md](modules/04-calendar.md) FR-CA8–FR-CA13), which reads from and — if the
member chooses two-way — writes to Google Calendar, iCloud or a CalDAV server. Google and Apple are
**recipients under the member's own instruction**, not Household sub-processors: Household holds no
contract with them on the household's behalf and cannot connect anything without the member
completing the provider's own consent flow.

The constraints, all of them requirements:

| | |
|---|---|
| **Off by default** | Nothing is connected until a member connects it. The setup flow offers it and skipping is a normal outcome |
| **Per member, not per household** | The connection uses that member's credentials and consent, belongs to them, and is removed when they leave (FR-CA8) |
| **Per remote calendar** | Direction (`off` / `import` / `two-way`) and detail level are chosen per calendar, not per account (FR-CA9) |
| **Busy-only is offered first** | D-47's "import as busy only" mirrors times without titles, and it is the default offer for a work calendar. The narrowest useful transfer is the one the UI leads with |
| **Named at the moment of connecting** | The consent screen names the provider, what will leave Household, in which direction, and that the provider's own terms then apply. Not a line in a policy nobody opens |
| **Listed in the privacy notice** | As a member-controlled integration with a named recipient and a stated legal basis — the member's own consent, withdrawable by disconnecting |
| **Revocable with a choice** | Disconnecting asks whether to keep or remove the mirrored events (FR-CA13). Revocation stops future transfer; it cannot recall what the provider already holds, and the copy says so |
| **Never for children** | A managed profile cannot give OAuth consent to a third party (FR-CA8 permissions) |
| **Credentials are excluded** | Connection credentials are encrypted with a key from the managed secret store and appear in no export and no log (04-calendar Data model) |

**The rejected alternative was import-only**, which would have kept §1 absolute. It was rejected
because a family calendar that cannot write back is a family calendar that quietly stops matching
the one on the member's work phone, and the feature exists precisely to stop the household keeping
two calendars. **No other member-initiated connection exists in 1.0**, and adding one is a change to
this section, not a detail of a module.

### The outbound calls Household makes on its own account

A member-initiated connection is not the only way data leaves the process, and a section that named
only those would be true and misleading. Household itself makes exactly **two** outbound calls that
carry anything derived from a household, and both are **sub-processors under §1** — Household's own
contracted providers, not recipients under a member's instruction — so both are on the published
list and both are bound by the EU-residency rule in [01-architecture.md](01-architecture.md) §1.

| Call | What leaves | Requirement |
|---|---|---|
| **Weather forecast** — twice daily per household with Garden enabled ([03-platform-strands.md](03-platform-strands.md) §5, [modules/11-garden.md](modules/11-garden.md) FR-GA22) | The household's **rounded** coordinates (§2 — two decimals, ~1.1 km) and nothing else. No household id, no member id, no content, no crop or planting data | **The provider must be EU-established and EU-hosted**, contracted as a sub-processor with a DPA. A provider that is neither is not usable, whatever its data quality — the forecast is a convenience and the residency rule is not |
| **FX reference rates** — daily ([modules/09-finance.md](modules/09-finance.md)) | **Nothing.** It is a pull of the European Central Bank's public reference set; no request carries anything about any household | None beyond availability. It is a public dataset, not a disclosure, and it is listed here only so that the absence of an outbound payload is recorded rather than assumed |

Push delivery (APNs and FCM via Expo, FR-NT1) and payment processing (Stripe, §6 of
[04](04-billing-and-entitlements.md)) are sub-processors on the same published list and are governed
by §1 like every other; they are not listed above because they are infrastructure the whole product
runs on rather than a module reaching outward.

**The invariant, stated so it can be checked:** *content* — any field a member typed — leaves the
EEA only through the calendar connection above. Everything else that leaves is either a rounded
coordinate, a delivery token, or billing metadata, and every recipient of any of it is a contracted
EU sub-processor.

## 11. The United Kingdom

**D-89: the UK is a launch market.** It is the only one outside the EU, and this specification is
written for an EU-established controller throughout, so the differences are collected here rather
than left implicit across five other documents.

**What does not change.** Data stays in the EU: the UK recognises the EEA as adequate for transfers
out of the UK, so an EU-hosted service is lawful for UK customers and needs no IDTA or UK Addendum
for its own storage. The product needs no translation — English is the source language
([03-platform-strands.md](03-platform-strands.md) §9). The Utilities presets (standing charge plus
unit rate, Economy 7), the MOT statutory schedule, imperial units and mpg all exist already.

**What does change:**

| | |
|---|---|
| **Data protection law** | **UK GDPR and the Data Protection Act 2018** apply alongside the EU GDPR, extraterritorially, because the service is offered to people in the UK. The substantive obligations are close enough that the product's posture satisfies both; it is the formalities that differ |
| **Representative** | An **Art. 27 UK representative** is appointed and named in the privacy notice. A requirement, not a judgement call, and a cheap one |
| **Supervisory authority** | The **ICO**. UK residents are shown the ICO in the privacy centre; EU residents see their own lead authority. The annual transparency report covers requests from both |
| **Breach notification** | 72 hours to the ICO for UK-affected breaches, in parallel with the EU lead authority. One incident, two notifications |
| **Tax** | A **UK VAT registration** separate from EU OSS, with no small-supplier threshold for a non-established supplier ([04](04-billing-and-entitlements.md) §1) |
| **Currency** | GBP is a supported base and charging currency, priced locally rather than converted |
| **Accessibility** | The European Accessibility Act does not apply; the Equality Act 2010 does, and WCAG 2.1 AA is the standard both are measured against — so [06-clients.md](06-clients.md) §4's release gate is unchanged |
| **Age of digital consent** | 13 in the UK, against 13–16 across the EU. This changes nothing, because **D-17** makes a child a managed profile under an adult's account rather than a data subject contracting with Household directly |

**One question is open, and it belongs to a lawyer rather than to this document.** The **Online
Safety Act 2023** attaches duties to "user-to-user services" with UK links, and Chat is a
user-to-user service. The design removes the risk the Act exists to address — a conversation is
confined to one household, there is no discovery, no stranger contact, no public content and no
route by which anyone outside the household can reach a child (**D-74**) — and Schedule 1 exempts
several categories of limited service. **Whether one of those exemptions covers a closed household
chat is a question to settle before UK launch, not one to assume.** It is on the Phase 5 legal
checklist ([08-roadmap.md](08-roadmap.md)). If the answer is no, the honest options are to carry the
duties or to ship Chat disabled in UK households, and that is a decision to take with advice.
