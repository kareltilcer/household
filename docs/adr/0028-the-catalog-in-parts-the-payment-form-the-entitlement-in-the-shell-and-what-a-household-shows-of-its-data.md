# 0028 — A language is fetched in parts, the payment form is the processor's own under a policy widened for it alone, the entitlement is said in the shell from the household's own answer, and a household's clients are its replicas' reports

- **Status:** Accepted
- **Date:** 2026-10-09
- **Plan item:** 27
- **Decides for:** [04-billing](../prd/04-billing-and-entitlements.md) §3, §6, FR-BI1 to FR-BI7; [05-privacy](../prd/05-privacy-and-compliance.md) §3, §4, §9; [06-clients](../prd/06-clients.md) §7, §8; [17-household-admin](../prd/modules/17-household-admin.md) §5 to §8 and Permissions; [10-sync-risk](../prd/10-sync-risk.md) §6; [02-identity](../prd/02-identity-and-access.md) FR-HH4, FR-PS1; design [03-patterns](../design/03-patterns.md) §3, DD-9, DD-15; D-114, D-125, D-128, D-131 to D-135, D-138 to D-142, D-153, D-159, D-167, D-170, D-174 to D-182; plan Q11; the consequences of [ADR 0008](0008-reference-data-pipeline.md), [ADR 0019](0019-the-sync-client-library.md), [ADR 0020](0020-billing-the-processor-webhooks-the-payer-and-storage-lines.md), [ADR 0021](0021-export-erasure-and-the-tombstones.md), [ADR 0025](0025-the-web-foundation-policy-harness-budget-and-build-id.md), [ADR 0026](0026-the-web-shell-the-session-the-replica-in-a-browser-and-one-language-at-a-time.md) and [ADR 0027](0027-the-households-web-screens-routes-of-the-apps-own-the-grant-matrix-and-settings-asked-at-once.md) for item 27

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
every part needed, a part that becomes needed is fetched in every language the page has held
whole or is fetching, and a language is shown once every needed part of it is held, so that a language
switched to while a screen is on its way ends, in either order, with the screen's words in the
language then shown. A language whose fetch
failed part-way is held in part and shown to nobody, and is asked for nothing more until it is
fetched whole: asked for a route's parts too, a switch that failed without a word (the
account's language, as it is read) would fail every screen that names the part it lacked, in the
language that is shown and whole. The provider reads the store through `useSyncExternalStore`,
and a translator asked for a key it was not given throws, naming the key and its part.

**No screen reads a word its route does not fetch, and a test holds that statically**
(`i18n/words.test.ts`). It reads every source file of `apps/web/src` with TypeScript's parser for
the catalog keys it names, a template whose holes a key matches among them, walks the static
imports from each root, and fails a file the first download or a shell reaches that reads a word
outside `app`, a screen that reads a part its route does not name, a route that names a part its
screen does not read, and a route with words and no file of its own to fetch them with.

**The first download counts the app's own words**, in the largest language, with the scripts the
page names (`build/budget.ts`): it stood at 179 kB of 200 once the catalog was split, from 194,
and stands at 182 with this item's screens. A part is a file named
`assets/catalog-<language>.<part>-<hash>.js`, and any part but the app's own is held to the
budget of a script loaded later; a build that holds no file of the app's own words by that name
fails its check, since it would be counted without them.

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
screen asks `postBillingSubscription` again: the server reads the processor itself there and
settles the household where it is paid. Its `409 already_subscribed` does not say which it
found, a payment taken or a bank debit still on its way, both being a household that may not
subscribe again, so the screen then reads the subscription and says *subscribed* only where
that names a plan, and otherwise that the payment was sent and billing shows how it stands
(the browser showed the first version telling a debit's payer that it had gone through). The
same `409` on the first ask is a household subscribed already, by a credit or in another tab,
or one whose payment is on its way, and is no error. A card confirmed for a method's replacement or for taking billing over has no such
question to ask: the screen reads the subscription again a bounded number of times
(`billing/cadence.ts`) and says that the processor has confirmed it once the read shows it, and
otherwise that it has not said yet.

**What nobody has said is not said either way.** A confirmation that Stripe's script resolves with
an error that is neither the form's own nor the method's, or that throws, is one whose outcome
nobody has given: its answer may have been lost on the way back from a processor that took it,
and a second press of one it took is refused in that same kind (the browser showed a payer who
had been charged told twice that nothing was). The form then says that it cannot tell yet,
never that nothing was charged or that the household is as it was, and reads the household
again, by which its screen draws: once the processor has told the server, the form gives way to
what is so. Subscribing and taking billing over are drawn by the subscription, and give way as it
is read. A method's replacement is drawn by nothing that says a method is being confirmed, so it
keeps how the subscription stood when its form was asked for, and where a confirmation came to
such an end it gives way, saying that the new method is in use, once what is read since names
another method, or a payment that was owed then as gone through (the browser showed the summary
naming the new method above a form that said at every press that it could not tell). Those two
are what says a new method is in use, and nothing else that moves under the page is. A
confirmation on its way holds whatever would put the form away, the choice of how often to pay
among it. `503 billing_unavailable` is answered too once the processor has taken a
change that could not then be read back, and the contract says of it only that the request may
be sent again: its sentence claims nothing of what was charged or changed, and billing is read
again after it. A question that stays open over such an answer keeps what it was asked for:
drawn from the subscription read again behind it, the question of how often to pay asked for the
opposite change once the server had taken the first, and the press that tried again changed the
plan back and was charged for it (seen in a browser). An offer taken back is answered `204` as one that was no longer open is, an
accepted one among them, so who pays is read before a payer is told that they go on paying.
An offer declined is answered the same, and one accepted is answered `404` where the reader's
own acceptance has landed and its answer was lost on the way: a decline reads who pays before
it says that anybody goes on paying, and an offer that is open no longer is said to be that and
no more, never that nothing has changed.
And the day a new payer's own subscription starts is named, with *nobody pays twice*, only in a
household that is `active`: where the period's own payment is owed the server starts it at once
and charges their method (D-133), and a restriction's state does not say whether one is. So is
the day a cancelled subscription ends on, with *nothing changes until then*: with a payment owed
the household loses its uploads, and then its writes, by the server's own clock, whatever day
the period ends on, and the question, its toast and the sentence that stands afterwards say
that the last payment is owed and name no day. A member's two consents are held to the same
(`privacy/Consents.tsx`): *Not saved* is said of a change the server refused, or asked while
the browser said it had no connection, which sends nothing, and of any other that got no answer
only that the server was not reached; and where the change made last is refused
the switches are put back to what the server last said it holds, never to what a change still
on its way had only chosen, which two refused one after the other left drawn as saved.

**The entitlement is said in the shell, from the household's own answer** (D-180).
`shell/EntitlementBanner.tsx` draws one banner under the offline bar's place
(`shell/HouseholdBars.tsx`) for the state `useHousehold().entitlement` resolves, to the reader
it is drawn for: the payer, another owner, or a member, who is who being read off the members
(`useReader`, `household/data.ts`). It reads no billing and names no price. The day a lapse
keeps a household's data until is not said where the household's own deletion is scheduled for a
day no later, here, on billing, or where a restriction is lifted: the erasure takes whichever of
the two is due first and neither holds the other back, so a deletion scheduled in the last
thirty days of a lapse comes after the lapse's day, which then stands as the day the data goes
(`keptUntil`, `household/households.ts`; the first reading, that a deletion always comes first,
hid the earlier day from every member). The day a household in grace becomes read-only is held
to the same, here and on billing: it is no day of a household that is gone by then (`deletedBy`;
billing's sentence named it under a banner that had stopped naming it). The deletion's own notice names the deletion's day, as
the server gives it, under a banner that then names the earlier one; and an export's row names
the earlier of its own last moment and the moment its household goes. A payment takes no
scheduled deletion back. The settings'
frame, which said that a household takes no writes, says only whose changing what is there is.
In a household that takes no writes the offline bar promises nothing of a change, the conflict
panel draws no answer, and the refused-change panel keeps *Discard*.

**A suspended household is the lockout, decided by a list read since** (`shell/Lockout.tsx`,
`shell/HouseholdShell.tsx`). Where a household's address answers `404`, the member's list of
households is read again, and only that answer decides between the lockout, where the list
names the household suspended, and *not available*: what this browser kept of the list is not
gone by. The `404` stands while the household is asked for again with nothing kept of it, as it
is each time the page is looked at: the lockout is not taken down and built again around a
skeleton, the focus on it lost, nor replaced by *could not be read* where the asking waits for a
connection.

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
has caught up, holds nothing queued and the household takes writes. Caught up is a checkpoint
applied since the replica's stream came up (`Replica.caughtUp`, `@household/sync`), and not one
from the visit before: reported as the stream came up, a copy that had yet to receive what
changed while it was closed read to the server as one that does not match, and its row said so
with *Download again* beside it (seen in a browser, at every visit after a change). Nor does
this browser's row say *In sync* before its stream has said anything: until then it draws no
standing, unless something else is so, a change waiting or a copy that does not match. The diagnostic bundle
(`health/bundle.ts`) is composed from that state and the last outcomes projected to their id,
entity type, operation, outcome, code and time; it is drawn part by part and as the very text
that is sent, and its id is made anew whenever a part is taken out or put back, so that a
bundle sent again is the one last read.

**FR-HH4 follows the server** (D-174): the payer's refusal on the screens that leave a
household, remove a member and change a role leads to the hand-over of billing, and says that
cancelling does not stand in for it. The last owner's refusal on the leave screen leads, beside
making somebody an owner, to where the household is deleted, which is their one way out of a
household that takes no writes. And the name an owner types to delete a household is compared
with its runs of spaces folded (D-182), a page drawing two in a row as one.

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
| One hook for where the focus goes once the control that held it has left | They are two rules. A settings screen has one place for its whole page and controls that leave together, with its member's standing: it watches the page, a notice above that place and a dialog beside it among it. A billing screen has several parts, each with a place and controls of its own that come and go: watched as a page, a control that left one part would send the focus to another's. Both are kept, where every screen may import them (`account/common.ts`: `useFocusKept` for a page, `usePartFocusKept` for a part of one, which billing's sections and the privacy centre's bodies are) |
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
| A payment form's unknown failure settled by asking `postBillingSubscription` again, as a confirmation that was taken is | The second ask answers a secret again where nothing was taken, which after a confirmation means *on its way* and after an unknown one means *not sent*: one answer read two ways, by a flag. The household read again says what the server knows, and the form's own sentence stands until it does |
| A part of the catalog that failed to fetch forgotten as needed, so that the language it failed in can be switched back to | Kept as needed, every language shown is whole with every part a screen has asked for, or is not shown, which is what the translator's throw rests on. What it costs is that the language cannot be switched back to until the page is loaded again, and the screen whose words failed already says to load it again (ADR 0026) |
| The on-open report asked again at a later status where the library answered none | It is sent once for each visit (D-181). A second ask at every status that moves is a loop on whatever refused the first, and the library reports by itself a quarter of an hour on |
| The wait for the processor's word counted from each read's answer, so that *has not said yet* is never said of a read on its way | A read that hangs would keep the screen confirming for as long as it does, which is the wait without bound this record declines above. The sentence is true of the moment it is said, and gives way to what the last read brings |
| One helper for leaving the app for a file, the export's link held to `https` as an invoice's is | An invoice's file is the processor's, over TLS wherever it is asked. An archive's link is the object store's, which a development stack serves over `http`: held to `https` it downloads nowhere but in a deployment. It is the API's own answer, and the policy refuses a script as a navigation's address |
| The restriction said once on the data screen, by the shell's banner alone; and the frame's *read-only* strip left off the inbox, billing, sync health and the clients under that banner | D-177 has the data screen say that a household is restricted, by whom and why, to every member, with what lifting comes to beside the control; the banner says it above every screen. The strip is the twelve states' own, and says what its screen does in that state, which the banner does not. One sentence of the screen's did claim more than the banner under a lapse, and is left out there |
| A sentence of its own where a restriction is asked for in a household another owner restricted a moment before, whose reason the server then drops | The answer is the household as it stands, and the notice drawn at once names who restricted it and with what reason: the second owner reads there that it is the other's. It takes two owners restricting within one stale page |
| The banner's announcement held back until the members are read, so that the line naming the owners does not change under a region that was just said | The state is what is announced, and holding it for a second read delays it for a line that only a member reads. Whether a screen reader says the whole again was not heard, the suite running none |
| The entitlement's banner inside the page's landmark; a notice put away in one tab followed in another; one *Sign out* on the lockout | The offline bar stands where the banner does, above the landmark, and both are read on the way to it. A dismissal is this browser's and is read as the shell opens (D-180). The lockout's own way out is its content, and the navigation's is every screen's |
| A `404` to keeping a household told apart, by its code, from one that says its member is in the household no longer | Both are `not_found`. The household read again says which: the notice gone, or the household's place taken by *not available* or the lockout |
| One download at a time, on the invoices as on the exports; the download begun from `mutate`'s own callback | Each row's download reads its own file, and one that is answered while another is on its way is a second file saved. A download leads to no other screen: begun wherever its member is by then, it saves the file they pressed for |
| A table or a list behind the storage trend's columns, a value a column | The plot draws no figure a sighted reader could take from it, no axis and no value, and what it shows, the first day, the last and the fullest, is said in words. Ninety rows of sizes would be a second screen |
| *In sync* held back on this browser's row while its replica is still downloading | A replica holds four of the household's own entities today and is whole before the row is drawn. It is the first module of size's to settle (Consequences) |
| The mismatch's sentence not promising that downloading again puts it right; the row of a replica already told to download again saying that it has | A type the server does not sync is listed for a client newer than its server, which the web, served with its API, is not; and the contract answers one word for a replica marked and one told (plan Q11). The row says that it says so until the report after |
| A read-only strip over an empty list of replicas | This browser's own row is drawn from the replica itself, so the list is empty only in a tab that holds none, where the sentence that nothing has reported is true as it stands. The clients' list is the server's alone, and is drawn under the strip where it is empty too: its teaching sentence promised a listing that no report makes true in a household that takes none |
| *Download again* withheld from the rows of this browser's earlier sign-ins | Nothing says which replica will never report again: each is its member's, listed for ninety days after its last report (D-128), and marking one asks nothing of a browser that is gone |
| *Card* never said of a method the catalog cannot name | A card of a brand this build has no word for is a card, and is said to be one; only a kind with no expiry, which no card is, is said to be another method |
| The take-over's screen holding, across a reload, that a method is being confirmed | The contract has no word for a setup on its way (Consequences): the offer is drawn again with its presses, and a second setup is inert |
| A size under fifty bytes written as a tenth of a kilobyte, so that something is never written as nothing | Every size is rounded to a tenth of its unit, and a floor would write more than is stored. What rounds to a thousand of one unit is written as one of the next |
| One word for a subscription in German, the six older messages moved to *Abo*; one verb for making an owner in Czech, Slovak and Polish | Both words are right in each, and every one of them is a draft in its ledger: which of two a language keeps is its reviewer's pass, with the rest of the catalog before them |
| The focus kept by `StateFrame` itself, in one place for every frame, where *Try again* leaves with its sentence | The frame draws a skeleton, an empty state or a body in the banner's place, and has no element of its own to hand the focus to: a wrapper in the primitive is another element round every body of the app, items 24 to 26's among them, and round the one locator the suite finds a screen's place by. Each body of this item is given its place, as storage, sync health and the clients had theirs (`useFocusKept`); the older screens' are handed on (Consequences) |
| The name typed to delete a household compared in one normal form, with the characters no page draws taken out of it | D-182 folds what a page folds, a run of white space, so that the name as it is read is the name as it is typed. A name saved with a decomposed letter or a zero-width character is drawn as it was saved, and is typed by copying it from the sheet that shows it: folding more is a rule of which two names are the same, which is a name's own to have (`text.Name`) and no comparison's. The contract says *the number of spaces*, and the server folds every white space: more than it promises, and nothing a client leans on |
| A promise that holds only without a second condition hedged in each sentence that makes it: *until a subscription is paid for* beside a restriction, *until an owner lifts the restriction* over a grace, *brings writing back* under a lapse that is also restricted, *the subscription is not affected* where there is none, *stays downloadable for seven days* where the household goes sooner | Each stands beside the sentence of the other condition, in the same banner or on the next line, and the control that would act says what it comes to before it is pressed (`data.lift.after.*`, `billing.means.restricted`). A sentence for each pair of conditions is four variants of four messages in five languages, for a household that is restricted and lapsed at once. Where a sentence was false by itself it was changed: the lift's, a trial that ran out being no subscription that lapsed, and an export's own row, which names the earlier moment |
| The cancel's question, a trial's notice and the day of the next charge, varied where the household's deletion is scheduled, each speaking of a time the household may not reach | The deletion's own notice says its day on the settings' first screen and on the data screen, and whoever scheduled it knows. The banner's two dated promises, a lapse's day and a grace's, are held against the deletion's; a variant of each sentence that carries no date is declined |
| *Is told* taken out of what declining an offer comes to, as it was taken out of the toast; *until they accept* written out as *until they accept and confirm a payment method* | The toast followed a `204` that does not say a decline happened. The sentence before the press is of a decline that does, which the server tells the payer of by a push, to a browser or a device that registered for one: the same gap as an email to an unverified address (Consequences). The shorter phrase stands on screens whose next sentence says the two steps |
| What a lifted suspension draws for the moment between two answers held as it was | The list may answer before the household does, and *not available* is then drawn until the household's own answer takes its place, a moment later. Holding what was last drawn is a second memory beside the one that keeps the lockout standing, for a flash nobody has met |
| A state or a status this build does not know drawn as none wherever a screen switches on one | The contract's states are a closed list, and a build that lacks one fails its own type check. A page loaded before a deployment that adds one is the case: the banner, which stands above every screen's boundary, draws none for it, and a screen that meets it fails inside its own boundary, which says to reload, and the reload is the build that knows it |
| The status under a card confirmed for a take-over drawn as a region that is in the page before its words; the bundle built again once the connection is known; the consents sent with the version they were read at | A screen reader that passes over a region arriving with its words was not heard, the suite running none, and the focus is put on the screen's place as the form leaves, where the sentence is. The bundle is its member's to read before it is sent, and one that changed under them is not the one they read: it says *not known yet* of a connection that was not. The contract takes both consents and no version (D-142): the page sends what it shows |
| A download begun in a new tab, or said only once the browser has it | A tab opened after the job was read again is a pop-up to the browser, and the policy admits no frame of the object store's. A navigation to a link that answers an attachment keeps the page; one to a store that cannot be reached draws the browser's own error in the app's tab, from which *Back* returns (Consequences). Nothing tells a page that a download began, so the toast says what the page did |
| A confirmation the bank's own challenge refused told apart from one whose answer was lost, by the processor's code | The app is handed the kind of a refusal and no more (`billing/stripe.ts`), and a challenge that failed and an answer that was lost are one kind. That the page cannot tell yet is true of both, and its way on, to try again, is the right one for the first |
| What the storage screen says of *the month's bill* left out of a household with no subscription | The month's own section there says that nothing is billed without one, beside the figures; billing's own projected charge is left out where there is none. Nothing is stored anywhere until a module writes files |
| Several *Try again*s of one page given names of their own; *Go to billing* left out of the banner on billing itself; an entry of the settings' navigation marked on the exports' screen; a restriction's reason and a suspension's notice drawn as data; `billing.refused.already_subscribed` taken out | Each *Try again* stands inside a section that is named. The others are differences no member is misled by, and each is a branch or a property for it |
| The web job's time limit raised for the larger suite | main's web job took six and a half minutes on 2026-10-09 under a limit of thirty, and this item's suite is a fifth larger, not three times |
| The consents' changes sent one at a time, each after the one before was answered, so that two sent side by side cannot land in the other order | A switch that saves as it is changed takes another change while one is on its way (ADR 0027), and what the server came to hold is read once every one of them is answered, and drawn: a switch that went back is seen to have. Sending them in turn is a queue behind a switch, and telling the server their order is a version the contract does not take (D-142) |
| *Not now* beside the subscribe screen's payment form, as the other two forms have, for a form that cannot be loaded for its secret | A secret is answered by a server that has just asked the processor whether its subscription still waits, so the one a form is drawn with is good as the form is drawn; and a press that asks again at the same way of paying is answered the same one's. A form put away would be drawn again as it was. Choosing the other way of paying asks for another, and the way back to billing stands under the form |
| An export's row naming its job's own last moment once the moment its household goes has passed | The night's job erases the household after that moment, and its archives with it: for those hours the row names a moment that has passed beside a download that still works, which promises nothing. The job's own moment would be days the household does not reach |
| A `focusout` listened for in every place, to tell a focus its member put on the page from one a control dropped as it left; the data screen forgetting a question that was closed unanswered | `refocus` moves a focus only from the page itself, and only to the place of the part whose control left: to be moved against its member's wish it takes a click on bare text between a press and the answer that takes the pressed control away. A second listener in each of a dozen places for that |
| The authority's section reading its member's households' countries otherwise than from each household's own answer; a household that could not be read said beside one that could | The household is read as every screen of it reads it and is kept under its own key, so the one last opened asks nothing new, and most members are in one; the list of households carries no country, and adding one is the contract's. One that could not be read is passed over, as a suspended one is, where another names a country, and the section says *could not be read* where none does |
| A language taken out of those a route's words are asked in, once a part failed in it while another language was shown | The route whose part failed says to load the page again, whichever language failed (ADR 0026), and a page loaded again holds one language. It takes a language switched from in this page, and one file of two asked together failing |
| The method's *in use* not said of a payment that was owed going through, where the confirmation before it came to an end nobody gave | It is one of the two things that say a new method is in use (Decision), and the only one for a method replaced by the same card. Said wrongly, the processor's own retry of the old method has succeeded while the page that lost the answer was still open |
| The conformance test of `caughtUp` moving a device's clock back; this browser's row drawing no standing until its own queue and inbox are read; the note under the clients' list left out where the strip stands over none; one job under way in the exports' fixture; `useData` given the pseudo-locale's letters and not its bracketed message; one list of what the processor adds to an address; one `ActorRef` on the server | Each is a difference no member is misled by, and a branch, an export or a harness for it. The comparison in `caughtUp` is one operator. The queue and the inbox are read from the replica's own database as the row is drawn, and no standing is announced. The note says how a row comes to be listed, which is so again once the household takes changes, and the strip above it says that none reports now. A test holds what `useData` draws (`account/common.test.ts`), and another that the address held across a sign-in carries no secret: the two lists are of two things, what says somebody came back and which of it is secret |

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
  nothing a client could open; and no address of support exists for the lockout to lead to. Nor
  does it say that a method is being confirmed for a hand-over, so a reload meanwhile draws the
  offer again; whether a restricted household's payment is owed; or that an email it promises,
  of an offer or of billing having moved, reaches only a verified address.
- Items 25's and 26's screens were not held to what this item's now are, and each is its own
  item's to mend: *Try again* drops the focus to the page on the leave screen, the devices and
  the account's deletion, and *Dismiss* on the notifications' refused strip and on the *switched
  household* banner (D-166); the notifications' refused strip is titled *Not saved* over a
  change that got no answer, which the consents' no longer is; the account's deletion still
  tells a payer to *cancel the subscription*, which the server does not take from the payer of a household that goes on (the
  sibling of D-174); and the leave screen says *nothing has changed* after a request that got no
  answer.
- The server's `deletion_scheduled_at`, the `executes_at` its request is answered with and its
  email name the deletion's own day where a lapse's earlier day is the one the data goes on. The
  banner names the earlier day; the deletion's notice and its sheet's *thirty days* do not.
- A download from an object store that cannot be reached draws the browser's own error page in
  the app's tab, and *Back* returns to the app.
- Taking billing over in a household whose first payment is a bank debit still on its way moves
  the payer while the debit clears into a subscription that is the former payer's.
- What an owner reads of a member's client, its label or its User-Agent, its version and its
  last report, is in no export of that member: `sync_replicas` has no `ExportSource`.
- `postSyncDigest`'s description in the contract speaks of a re-download *an owner asked for*;
  any member asks it of their own replicas (D-177). And no test holds the plural categories each
  language needs: one of the server's emails lacks Czech's and Slovak's *many*.
- A browser's own row says *In sync* from its connection alone. A replica holds four of the
  household's own entities today and is whole at once: the first module of size makes the row
  wait for the download (**item 28** on).
- The authorities of Germany and of the United Kingdom are named as their pages named them in
  October 2026, each a draft: whoever reviews the reference data opens the two pages first.
- **What would make this worth revisiting**: a module whose words are needed by a screen outside
  its own routes (a dashboard's widgets), which would ask for a part named by a component and
  not a route; a processor's test mode reachable from CI without a secret; an operation that
  says what a member dismissed.
