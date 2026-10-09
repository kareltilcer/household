# 0028 — A language is fetched in parts, the payment form is the processor's own under a policy widened for it alone, the entitlement is said in the shell from the household's own answer, and a household's clients are its replicas' reports

- **Status:** Accepted
- **Date:** 2026-10-09
- **Plan item:** 27
- **Decides for:** [04-billing](../prd/04-billing-and-entitlements.md) §3, §6, FR-BI1 to FR-BI7; [05-privacy](../prd/05-privacy-and-compliance.md) §3, §4, §9; [06-clients](../prd/06-clients.md) §7, §8; [17-household-admin](../prd/modules/17-household-admin.md) §5 to §8 and Permissions; [10-sync-risk](../prd/10-sync-risk.md) §6; [02-identity](../prd/02-identity-and-access.md) FR-HH4, FR-PS1; design [03-patterns](../design/03-patterns.md) §3, DD-9, DD-15; D-114, D-125, D-128, D-131 to D-135, D-138 to D-142, D-153, D-159, D-167, D-170, D-174 to D-181; plan Q11; the consequences of [ADR 0008](0008-reference-data-pipeline.md), [ADR 0019](0019-the-sync-client-library.md), [ADR 0020](0020-billing-the-processor-webhooks-the-payer-and-storage-lines.md), [ADR 0021](0021-export-erasure-and-the-tombstones.md), [ADR 0025](0025-the-web-foundation-policy-harness-budget-and-build-id.md), [ADR 0026](0026-the-web-shell-the-session-the-replica-in-a-browser-and-one-language-at-a-time.md) and [ADR 0027](0027-the-households-web-screens-routes-of-the-apps-own-the-grant-matrix-and-settings-asked-at-once.md) for item 27

## Context

Item 27 builds the rest of a household's settings on the web, billing, storage, the household's
data, sync health and its clients, and with them the privacy centre of a member's own account
and the entitlement's banner above every screen of a household. Items 16, 19, 20, 24, 25 and 26
each left it a hand-over, and these questions came with them:

1. **How the first download stays under its budget.** It stood at 194 kB of its 200 kB (D-153),
   30 of them a language's whole catalog, and this item adds some six hundred messages.
2. **How a card is taken under a policy that admits nothing but the app's own origin**, where
   the PRD has the processor's own payment form take it (04 §6, D-131).
3. **How the app learns that a payment went through**, where the server moves a household only
   on the processor's word, which arrives by a webhook the page cannot see.
4. **How critical path 3 is run end to end**, subscribe → lapse → read-only → export
   (06-clients §8), where the served API could be pointed at no Stripe but Stripe's, and at no
   clock but the wall's.
5. **Where the entitlement's banner is drawn and what it reads**, where billing answers a member
   `404` and the banner is every member's.
6. **Whose each of the new sections is**, where PRD 17's permissions name storage and billing
   and say nothing of the data screen, sync health or the clients.
7. **What a household's clients and their versions are** (FR-HA18, plan Q11), where no operation
   served them and a web session keeps no version.
8. **Where the supervisory authority of "the member's own country" comes from** (05 §3), where
   no data named an authority and an account has no country.
9. **Where the server's emails open the app**, two of which linked outside the household's
   settings.
10. **What FR-HH4's *or cancel the subscription* comes to**, which ADR 0027 left to this item.

## Decision

**A language's catalog is fetched in parts** (D-175). A part is a set of first segments of a key,
one table in `packages/i18n/src/parts.ts`: `app`, the shell's words, signing in, a member's own
account, sync, the entitlement's banner, is fetched before the app draws a word; `household`,
`billing`, `storage`, `privacy` (a household's data and a member's own, whose screens share the
export) and `health` (sync health and the clients) are each fetched with the screens that read
them. The catalogs stay one file a language, which the server embeds whole: `scripts/gen.ts`
writes each language's parts from them, and the table of their imports, one written-out import a
language and part, into `src/generated/`, which is never committed. The words the server alone
renders (`activity`, `admin`, `email`, `notification`) are in no part.

A route names the parts its screen reads beside the app's own, `words` on its line of
`app/paths.ts`, and `routes.tsx` fetches them beside the screen's file: either failing is the
screen's file failing, which the route's boundary already says to reload for. The web's store of
what has arrived (`i18n/catalogs.ts`) keeps, for each language, the merged messages and which
parts they are, and the parts this page has needed so far: a language asked for is fetched in
every part needed, a part that becomes needed is fetched in every language the page holds or is
fetching, and a language is shown once every needed part of it is held, so that a language
switched to while a screen is on its way ends, in either order, with the screen's words in the
language then shown. The provider reads the store through `useSyncExternalStore`, and a
translator asked for a key it was not given throws, naming the key and its part.

**No screen reads a word its route does not fetch, and a test holds that statically**
(`i18n/words.test.ts`). It reads every source file of `apps/web/src` with TypeScript's parser for
the catalog keys it names, a template whose holes a key matches among them, walks the static
imports from each root, and fails a file the first download or a shell reaches that reads a word
outside `app`, a screen that reads a part its route does not name, a route that names a part its
screen does not read, and a route with words and no file of its own to fetch them with.

**The first download counts the app's own words**, in the largest language, with the scripts the
page names (`build/budget.ts`): it stands at 179 kB of 200 with the catalog split, from 194. A
part is a file named `assets/catalog-<language>.<part>-<hash>.js`, and any part but the app's own
is held to the budget of a script loaded later.

**The server's two emails that opened the app outside a household's settings open it inside**:
the offer of billing at `settings/billing/takeover`, a household's export at `settings/exports`,
as item 26 moved two notifications (ADR 0027). Every screen of this item but the privacy centre
is a line of `paths.ts` under `/households/{id}/settings`, so the sidebar draws household
settings as open on all of them and the offline bar says on all of them that a change needs a
connection (`changesAtOnce`).

**Whose each section is** (D-177). The settings' navigation lists storage for whoever holds
`view` on household settings, billing and the clients for owners, and the data screen and sync
health for every member. A control of an operation the gate exempts (FR-BI1: billing, an export,
a deletion, a restriction) is drawn for an owner whatever the household's state
(`useStanding().owner`), and every other control that writes where the household writes too
(`useStanding().changes`).

**A household's clients are its replicas' last reports** (D-178). A report (`postSyncDigest`)
keeps the type and the version its request named in `Household-Client`, in two nullable columns
of `sync_replicas` (migration `01026`), each report replacing the one before; and
`GET /households/{household_id}/clients` (`getClients`) answers an owner every replica of the
household with its member, that type and version, a device's platform, its label, and when it
last reported, beside the deployment's minimum versions, which the handler is handed as the
middleware holds them. Anyone else is answered `404`, as billing answers them.

**The supervisory authority is reference data of a country's profile** (D-179, ADR 0008): its
name in the five languages and the `https` address of its complaints page, each with its source
and drafted, in two nullable columns of `country_profiles` that the loader fills, and
`Country.supervisory_authority` in the contract.

**The end-to-end suite pays at stand-ins** (D-176). `HOUSEHOLD_STRIPE_API_URL` says where
Stripe's API is: a setting only a development environment may hold, over `http` on the loopback
alone and with test-mode keys alone, which stops any other deployment from starting.
`billingtest`, the stand-in the server's own tests ask, no longer needs a test to run in, keeps a
journal of the events Stripe would send for each change, and is served as a process by
`cmd/stripe-standin`, the suite's alone and never deployed: Stripe's API at `/v1`, and beside it
what drives it, a payment form's confirmation by its secret and what Stripe does on its own to a
household's subscription (a renewal failed, given up on, a period ended, a debit cleared or
failed). It delivers its own webhooks, signed, and answers an act once the API has taken every
event the act causes, so the household's row is settled by the time a spec reads it. The suite's
API is the deployed adapter, stripe-go and the signature check with it.

**The payment form is the processor's own, and one file of the app calls it**
(`billing/stripe.ts`, `billing/PaymentForm.tsx`). The policy (`build/csp.ts`) admits Stripe's
script (`script-src`), its frames (a new `frame-src`) and its API (`connect-src`), which is what
Stripe states its script needs, and nothing of Stripe's in any other directive. The script is
fetched by `@stripe/stripe-js`'s loader when a payment form is first drawn, and by no other
page; the form is Stripe's Payment Element, mounted into a node the component owns and
destroyed with it, its look given from the computed values of the app's semantic tokens where
it stands, and its language the app's. It is drawn in the page, where its control stood, and
never in a dialog or a sheet: Stripe draws a bank's challenge over the page from its own
script, and a modal `<dialog>` would stand above that and hold it inert. A refusal Stripe
resolves with is said in the app's words by its type, never by Stripe's own message.

**A secret is asked for by a press and kept in the screen's state alone.** Subscribing,
replacing the method and accepting billing each make something at the processor, so none is
asked as a screen opens; what is answered is no query, is kept by no cache (`gcTime: 0` on the
three mutations) and is in no storage. What Stripe adds to the address on a return from a
bank's page is taken out of the address before anything is drawn, and nothing is believed from
it: the screen reads the subscription.

**A payment is believed when the server says so.** The server moves a household on the
processor's word alone (D-131, D-134). After Stripe resolves a payment with no error, the
screen asks `postBillingSubscription` again: the server reads the processor itself there, and
its `409 already_subscribed` is the payment taken and the household settled, where a secret
answered again is a payment not yet made, a bank debit on its way among them. The same `409`
on the first ask is a household subscribed already, by a credit or in another tab, and is no
error. A card confirmed for a method's replacement or for taking billing over has no such
question to ask: the screen reads the subscription again a bounded number of times
(`billing/cadence.ts`) and says that the processor has confirmed it once the read shows it, and
otherwise that it has not said yet.

**The entitlement is said in the shell, from the household's own answer** (D-180).
`shell/EntitlementBanner.tsx` draws one banner under the offline bar's place
(`shell/HouseholdBars.tsx`) for the state `useHousehold().entitlement` resolves, to the reader
it is drawn for: the payer, another owner, or a member, who is who being read off the members
(`useReader`, `household/data.ts`). It reads no billing and names no price. The settings'
frame, which said that a household takes no writes, says only whose changing what is there is.
In a household that takes no writes the offline bar promises nothing of a change, the conflict
panel draws no answer, and the refused-change panel keeps *Discard*.

**A suspended household is the lockout, decided by a list read since** (`shell/Lockout.tsx`,
`shell/HouseholdShell.tsx`). Where a household's address answers `404`, the member's list of
households is read again, and only that answer decides between the lockout, where the list
names the household suspended, and *not available*: what this browser kept of the list is not
gone by.

**An export is downloaded by a navigation, after its job is read again** (`privacy/ExportList.tsx`).
A job's link is good for minutes and each read renews it, and the policy's `connect-src` does
not admit the object store: *Download* reads the job and then leaves for its `download_url`,
which answers an attachment, so the page stays. While a job waits or is being made its list is
read again on an interval that stops once nothing is on its way. The household's exports and
the account's own are one list drawn over two sources, and the privacy centre, which is the
account's, reads no word of the household's part.

**Sync health is the reader's own replicas, and reports its own browser as it opens** (D-177,
D-181; `health/SyncHealth.tsx`). This browser's row is drawn from the replica itself, live, and
every other from its last report; the screen has this browser report once as it opens, where it
has caught up, holds nothing queued and the household takes writes. The diagnostic bundle
(`health/bundle.ts`) is composed from that state and the last outcomes projected to their id,
entity type, operation, outcome, code and time; it is drawn part by part and as the very text
that is sent, and its id is made anew whenever a part is taken out or put back, so that a
bundle sent again is the one last read.

**FR-HH4 follows the server** (D-174): the payer's refusal on the screens that leave a
household, remove a member and change a role leads to the hand-over of billing, and says that
cancelling does not stand in for it.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| The budget raised for a whole catalog in the first download | D-175 |
| The committed catalogs split into files by screen | The server embeds them whole, for its emails, notifications and summaries, and a translator and the review ledgers work a language at a time: a second layout of the same words, kept for one client's bundler. The parts are a function of the catalogs and one table, generated as the message keys are |
| A word fetched when a component first asks for it | A screen that draws twice, or a `Suspense` boundary round every sentence, and a failure to fetch in the middle of a screen with no boundary that names it. Fetched with the route, the words are there when the screen is, and a failure is the screen's own |
| A missing word drawn as its key, or in English | It ships. A translator that throws is found by the first test that draws the screen, and the static guard finds it before that |
| The parts each screen reads listed by hand beside its tests, with no walk of the imports | The list nothing fails when a component moves: the account's screens read two of the household's words through a helper, and the second step's screen a third through an import of an import, which the walk found and a hand-kept list had not |
| A part fetched in the language shown alone, and again at a switch | A switch made while a screen is on its way would show the new language under a screen whose words in it had not come: a thrown render, for a member who pressed two things. Fetched in every language the page holds, the cost is one small file more for a member who changed language in this page |
| The entitlement's words in a part of their own, fetched with the household's shell | The shell is no route's screen: it is around every screen of a household, and the guard holds what is around a screen to the app's own words. The banner's sentences are few, and are counted |
| The two emails left at the addresses they had, with routes beside the settings for them | ADR 0027 rejected the same for the invitations and a member's page: the sidebar draws a module as open on the screens under its home, and the offline bar says what holds there. Two constants on the server, before anything is deployed |
| The data screen and sync health absent for everybody but an owner | D-177 |
| The clients read from the accounts' devices and sessions | D-178 |
| A device replica's version read from `devices.app_version` where its report named none | Two sources for one column of one list, the second an account's and not the household's. A client that names itself is the rule (06-clients §7), and the mobile replica is given a `fetch` that does (item 28) |
| The authorities written into the clients' catalogs | D-179 |
| The suite paying in Stripe's test mode | D-176 |
| Stripe's own mock (`stripe-mock`) behind the suite's API | It keeps nothing between requests and takes no payment: a subscription it made is not one it then knows. It proves the shapes of what the server sends, which is what CI's `stripe` job uses it for |
| A subscribed household seeded as rows, and the payment form left untested | Neither the adapter nor a webhook runs, and the path's first step is the one a customer pays through |
| A build of the API that is the suite's alone, with the processor handed to it | A second binary that is not the one deployed, to avoid one setting that the deployed one refuses everywhere but in development |
| The stand-in's events sent by the spec, as the server's tests post them | Every spec would sign and order Stripe's events by hand, and get the order wrong in its own way. The stand-in knows what it changed, and an act that answers once the household is settled leaves a spec nothing to wait for |
| FR-HH4 as written, the server changed to let a payer whose subscription will not charge again leave | D-174 |
| Billing told who pays by its reader's own row among the members, as the banner is (`useReader`) | The banner reads no billing, and the members are what every member may read. Billing draws the subscription, which names its payer, and reads it again by itself while it waits for the processor's word: told by the members beside it, the page would say two things of one payer for as long as the two reads differ. The two share how two ids are compared, and nothing else |
| One hook for where the focus goes once the control that held it has left | They are two rules. A settings screen has one place for its whole page and controls that leave together, with its member's standing: it watches the page, a notice above that place and a dialog beside it among it. A billing screen has several parts, each with a place and controls of its own that come and go: watched as a page, a control that left one part would send the focus to another's. Both are kept, the first where every screen may import it (`account/common.ts`) |
| The billing screen's word for a state read from the switcher's, which every page has fetched | They are not the same words: the switcher's stand after a role in the middle of a line and are written small, and in Polish they agree with the household where billing's agree with the subscription. A capital put on by code is a word no translator wrote |
| A word that is no catalog's bracketed and padded under the pseudo-locale, as a message is | To be so it was read as a message, and what the server gave, an archive's own name for an entry, may hold a brace. Data is accented letter for letter and nothing more (`useData`), which is all the pass asks of it: it tells data from a word nobody translated. A day's name and a language's lose their padding there |
| A size under a thousand bytes said in bytes, and billing's sizes in gigabytes whatever they hold | `Intl` writes a byte as an English word in whichever language is shown. Sizes are said by one formatter (`format.bytes`), in the largest unit of those storage is sold in that the size fills, so that the storage screen and the billing screen say one figure in one way |
| The refused-change panel with no control at all in a household that takes no writes | A change that was not accepted is this browser's own, and giving it up asks nothing of the server. FR-BI2 has held changes offered for replay, and an offer that cannot be declined is none: the replica sends a held change by itself once the household writes again, which may be months on, and its member must be able to say no before then. So *Retry* and *Edit* are absent there, being writes, and *Discard* stays, with a sentence that says which is which. The conflict's panel draws neither answer: choosing either version is a write |
| A card taken in the app's own fields, as the prototype draws it | Card data never reaches Household (04 §6, D-131): the processor's form is the requirement, and the policy is widened for it and for nothing else |
| `@stripe/react-stripe-js` round the payment form | A provider and a context for one element mounted in one component. The loader alone is what is needed, and it fetches Stripe's script when a form is first drawn |
| The payment form in a sheet or a dialog, the method's replacement among them | Stripe draws a bank's 3-D Secure challenge over the page from its own script, and the platform's modal `<dialog>` is above everything outside it and holds it inert (ADR 0025): the challenge could not be answered. The form is drawn where its control stood |
| A payment said to have gone through once Stripe's script resolves it | The household is moved by the processor's word to the server (D-134), which the page cannot see: said earlier, a member is told they are subscribed in a household that still reads as on trial. The second ask of `postBillingSubscription` is the server's own reading of the processor, and its answer is what is said |
| A secret asked for as the screen opens, so that the form is there at once | Each ask makes an unpaid subscription or a setup intent at the processor, for a member who only came to read the price |
| A return from a bank's page read from what Stripe put in the address, or subscribing asked again there | The address is whoever opened it's to write, and it holds a secret: it is taken out and nothing of it is believed. Asking again with no press would make a subscription and a secret nobody pressed for. The subscription is read |
| The subscription read again without bound after a card is confirmed | A webhook that never comes (the runbook has the case) would keep a screen asking for as long as it is open. A bounded while, then the sentence that the processor has not said yet, and the screen as the server has it |
| Stripe's own message shown for a refusal | It is the processor's sentence in the processor's wording, and a client switches on a refusal's kind, never on its text. The Payment Element shows a field's own error itself |
| The banner's price read from billing, or one banner for every reader | D-180 |
| The lockout drawn from the list of households this browser kept | A kept list that names a household suspended would lock a member out of one whose suspension was lifted, and one that does not would say *not available* of a suspended one: the `404` is read against a list asked for since |
| An export downloaded by `fetch` and saved by the page | The policy's `connect-src` does not admit the object store, and need not: the link answers an attachment, which a navigation saves and the page survives |
| An export's link kept from the list's read and used when *Download* is pressed | It is good for minutes, and a list read an hour ago has one that has run out: each read renews it, so the job is read as the press is made |
| One job read again while it is made, and not the list | Two reads to keep in step where one covers every row, and a job asked for in another tab is then seen too |
| The bundle's id kept for the visit whatever is taken out of it | The server keeps a bundle once by its id: a bundle sent, then sent again with a part taken out, would be kept as first sent, with the part its member took out |
| Sync health reporting again after a re-download is asked of this browser, so that it begins at once | One more report for a wait of minutes that every other device has too, and a second rule for one row |

## Consequences

- A screen's item adds its words under a first segment that is a line of `parts.ts`, and names
  the part on its route. The first download grows only by what the app's own words and the
  entry's script grow by.
- `pnpm run gen` (turbo's `gen`) must run before the web is built, type-checked or tested: the
  parts are generated files, as the typed client is. CI already runs it first.
- A member whose language differs from the one the page started in fetches a part twice the
  first time a screen needs it, once in each language held.
- `HOUSEHOLD_STRIPE_API_URL` is refused outside development; the first payment in Stripe's test
  mode, with Stripe's own script and frame in a browser, is **item 30**'s, on staging.
- The policy admits Stripe's script, frames and API and no other origin of a payment method's:
  Link, which the Payment Element draws in frames of `link.com` where the processor's dashboard
  has it among the payment methods, is refused. It is kept off there (the billing runbook), or
  the policy is widened for it in a pull request that says so. Once a payment form has been
  drawn, Stripe's script stays in the page for as long as the tab lives. Stripe states that its
  script does not support a cross-origin isolated page: whoever serves the app sends no
  `Cross-Origin-Embedder-Policy` that would make it one (the replica's SQLite does not ask for
  one).
- A client is listed among a household's once it has reported: the mobile replica's `fetch` must
  name the app in `Household-Client` (**item 28**), or its clients read with no type and no
  version.
- A country profile an administrator edited before migration `01026` would be held by the
  loader without its authority, and the countries' read fails on such a row; nothing edits a
  profile today. A later migration makes the two columns `NOT NULL`.
- The contract keeps nothing of these, and the screens say only what it keeps (plan Q11):
  making an owner, a replica's report and its forced re-download are refused in a household that
  takes no writes, so a lapsed household's only owner cannot make the second owner billing would
  be handed to, and sync health goes stale there; an export has a status and no progress; a
  failed payment has no date its retries end on; nothing every member reads says who cancelled
  a subscription or when; nothing counts what a household's deletion takes; a storage item names
  nothing a client could open; and no address of support exists for the lockout to lead to.
- **What would make this worth revisiting**: a module whose words are needed by a screen outside
  its own routes (a dashboard's widgets), which would ask for a part named by a component and
  not a route; a processor's test mode reachable from CI without a secret; an operation that
  says what a member dismissed.
