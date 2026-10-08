# 0027 — A household's web screens are routes of the app's own, a role's levels are the rule both sides compute, and household settings is every member's to open and is changed on the server or not at all

- **Status:** Accepted
- **Date:** 2026-10-08
- **Plan item:** 26
- **Decides for:** [02-identity](../prd/02-identity-and-access.md) §3 to §6; [06-clients](../prd/06-clients.md) §2; [17-household-admin](../prd/modules/17-household-admin.md) §1 to §3, Sync and Permissions; design [03-patterns](../design/03-patterns.md) §2, §6 and §9, [02-components](../design/02-components.md) §4.5, DD-6; D-78, D-80, D-103, D-104, D-153, D-159, D-160, D-164 to D-171; the consequences of [ADR 0011](0011-households-as-the-platforms-own-module.md), [ADR 0012](0012-child-profiles-pins-and-graduation.md) and [ADR 0026](0026-the-web-shell-the-session-the-replica-in-a-browser-and-one-language-at-a-time.md) for item 26

## Context

Item 26 builds the first screens of a household on the web: making one, inviting into it, its
members with what each holds, its child profiles, its modules, its profile, and leaving it. Items
10, 11 and 25 each left it a hand-over, and these questions came with them:

1. **How a module's screens are routed and held to the gates.** Item 25 gave the registry a
   `load` for a module's screens, "everything under its address, routed by the module itself",
   and the end-to-end suite walks `paths.ts`, where such screens would not be.
2. **Where the settings stand in the address space.** The server's notifications already link
   into them: `/households/{id}/invitations`, `/households/{id}/members/{user_id}`, and
   storage's `/households/{id}/settings/storage`.
3. **Who household settings is listed for.** The sidebar lists a module the member holds above
   `none` (D-160); PRD 17's Permissions give every member the member list, the profile and the
   modules, and the prototype's own build draws none of them for a member at `none`.
4. **Where a client learns a role's defaults and what a role may hold.** The composer shows
   seventeen levels "already answered" before the server is asked, and a level a child may not
   hold is to be unavailable by construction (design 03-patterns §9). No operation answers
   either.
5. **How seventeen modules by four levels read on a phone without a legend**, which is this
   item's second Done-when.
6. **Whether a change to the settings waits for a connection.** The web queues a household's
   writes (D-164); PRD 17's sync table says these entities are never written offline, and the
   prototype draws a module switched off as *pending*.
7. **How an invitation's token outlives the sign-in of whoever opened its link**, and what a
   visitor is shown before they sign in.
8. **What the first run does** where DD-6's third step leads to a module's capture surface and
   no module has a screen, and where the app opens for a member who is in no household.
9. **How the screen that leaves a household knows what stands in the way before it asks**,
   which FR-HH4 has it say at once.
10. **What the inviter's notice of a decline (A-25) is** on a client with no list of
    notifications.
11. **Whether this item's words take the first download past its budget** (D-153), which
    ADR 0026 left it to answer.

## Decision

**A module's screens are routes of the app's own.** Each is a line of `app/paths.ts`, drawn by
the router in the household's shell, so that the walk of the routes holds it to axe in both
themes, its title, the pseudo-locale and a phone's width at 200 % text with no further word
(06-clients §8). The registry (`modules/registry.ts`) says of a module only where it opens,
`home`, and where it takes a first record, `capture`; `/households/{id}/modules/<module>` leads
to the first for a module the member holds and this build has screens for, and opens nothing
for any other. The sidebar links straight to a module's home, so that it is drawn as open on
every screen under that address.

**Household settings are under `/households/{id}/settings`**: the profile at the address
itself, then `members`, `members/{user_id}`, `invitations`, `invitations/new` and `modules`.
Leaving is beside them, at `/households/{id}/leave`, being no setting and every member's. The
server's two notifications that link into these screens name them so (`invitations.go`,
`children.go`), as storage's already did. The screens share one frame
(`household/settings/Page.tsx`): the way between them above the title, and under it the one
sentence that says where the member stands, that the household takes no writes, or that changing
what is here is an owner's, or that a change needs a connection.

**Household settings is listed for every member** (D-167). `shell/navigation.ts` holds it among
the modules a member holds whatever the household's answer gives them on it; what a level on it
decides is whether the invitations are theirs to read (`useStanding().invitations`), whose way
in and whose two screens are absent at `none`. A control that changes something is drawn where
`useStanding().changes`: an owner's, in a household that takes writes.

**A role's defaults and its ceiling are a rule both sides compute, held to one vector file**
(D-37). `@household/domain` has `grantDefaults` and `grantCeiling`; the server's twins are
`household.Defaults` and `access.Ceiling`; `vectors/grants.json` is run by both. The web's
matrix offers each row the levels its role may hold and no other, so a child profile is never
shown *Can set it up*, nor more than *Can see* on Finance, and the composer starts from the
defaults the server would write.

**The matrix is drawn two ways, and each says what its levels mean where it draws them**
(`household/GrantMatrix.tsx`). An owner fills in `GrantMatrix`: a row a module, in the order of
FR-AC3's own table, each the platform's own select named for its module, with the chosen level's
sentence under it, and what it was changed from. Everybody else reads `GrantSummary`: the
modules gathered under each level, highest first, each level with its sentence; in a list of
members it is a line a level, with what is off counted and not named, since the comparison there
is across rows. A level is never shown by the contract's word for it: *Off*, *Can see*, *Can add
and edit*, *Can set it up*. Neither has a legend, a second column or a width of its own, so
both are one column at a phone's width.

**Household settings is the one row whose levels have sentences of their own**, since D-167
makes it the one module that *Off* does not take out of a member's app: held at *Off* it keeps
its profile, its members and its modules, and not its invitations; *Can see* adds the
invitations; and nothing above that adds anything for a member, every change in the settings
being an owner's whatever the level says (FR-AC3). The matrix says so on its row. Where levels
are gathered for a member or a child, household settings is drawn as a group of its own and not
under a level whose sentence would be untrue of it; for an owner, who holds and changes
everything, it is one module among the seventeen. And a change that lowers it to *Off* is not
counted among the modules that leave a member's app and their devices.

**Every write of these screens is asked at once** (D-170): each mutation spreads `askedNow`
(ADR 0026), a test holds them to it, and a write pressed with no connection says the server
could not be reached and that nothing was changed. The shell's offline bar says the same on
these screens, in place of its promise that changes are kept and sent, which is a module's
(`shell/HouseholdBars.tsx`). A write on its way keeps its control busy until it is answered: the
form of a member's levels does not put a save away while it is being made, and each row of the
invitations is busy for its own sending, whichever row was pressed since. Reads are TanStack
queries filed under the
household's own key (`household/data.ts`), so that what the browser kept is drawn offline, and a
write that was answered reads the household, its members, its modules, its invitations and the
member's list of households again (`useReread`). A refusal that is about where the member
stands and not about what they sent, an owner no longer (`403`), a household that takes no writes
now (`402`) or what was to be changed gone (`404`), is one list for every screen of the settings
(`isStandingRefusal`, `settings/profile.ts`): each says it and reads the household again, and the
controls that are theirs no longer leave with what it then says. The screens read the API and not
the replica:
admin's entities reach a replica without a member's name or address, and no screen here is
written offline, so there is nothing a replica would add.

**An invitation is answered on a public page, and its token is kept in the page's memory**
(`household/Invitation.tsx`, `invitationToken.ts`). The link is `/invitation#token=…`, as the
server's email writes it; the token is read from the fragment and taken out of the address
(`auth/fragment.ts`), and the page shows the whole of what is given to whoever holds the link,
since the contract's preview asks for no session: the household, the inviter, the role and every
module with its level, with what is off named aloud this once. A visitor is sent to sign in with
this page as the address held for them, and the token waits in a variable and in no storage, as
a challenged sign-in's does (ADR 0026); a reload, or an account made in another tab, loses it,
and the person opens their link again, an email invitation being listed on their account
meanwhile (`getMeInvitations`). A link opened in a tab that is on the page already loads nothing
and only changes the fragment under it, so the page is begun again for a token that arrives
while it is drawn: opening the link again is then the same thing wherever it is opened. The
query that reads it is kept out of the stored cache.

**A member in no household is opened at making one** (D-168), and **the first run's question is
asked where it leads somewhere** (D-169): `household/Start.tsx` offers the modules whose registry
entry has a `capture`, of those the member holds, and passes on to Home while none has. Where the
app opens does not take this browser's word that a member is in none: a list it kept that names
no household is read again first (`app/Home.tsx`), or somebody who joined one since, by an
invitation answered on another device, would be sent to make a household beside the one they are
in. With no connection there is nothing to wait for, and what was kept is what there is to go by.

**The screen that leaves says what stands in the way before it asks, from the members it reads,
and takes the server's word over its own.** A member who is the household's only owner, and one
who is its payer of record, are told so as the screen opens, both at once where both hold, each
with what unblocks it, and the control that leaves is absent meanwhile; the server's `409`, which
names the same reasons in `blocked_by`, is drawn the same way where it disagrees with what was
read.

**The inviter's notice of a decline stands on the invitations** (D-171), drawn from each
invitation's own status: one for each address whose newest invitation stands declined
(`declinedNotices`), until it is withdrawn or the address is asked again, whatever becomes of
the asking. A link names nobody, and each declined link has its own. An address that is a
member's by now is told of no longer, and its invitations are not sent again, which the server
would refuse; whose address is a member's is read off the members, and not off an invitation
that was accepted, which says who came and not who is here: somebody who joined once, left and
was asked back is told of, and sent to again, as anybody is (`settledAddresses`).

**A create whose answer was lost is read as made.** Every create sends an id the client made
(D-23), once for each visit of its screen, so a press repeated after an answer that never came
names the same household, invitation or profile; the server answers that `422` for the id, and
the screen reads what it made, or says that it may have been made and where to look, in place of
asking for it again for ever. A household and a child profile are looked for by their id where
the repeat is refused for a ceiling too (`403`): the server counts what an account owns, and a
household's members, before it looks at the id, so the thing that reached the ceiling is refused
as one too many of itself. A profile read so is said to be made by the name it holds.

**The catalog is not split yet.** This item's words are keys under `household.*`, some four
hundred of them, and with them the first download is 194 kB of its 200 kB, 30 of them the
largest catalog; the split ADR 0026 describes, a module's words fetched with its screens, is
left to the item that would pass the budget, and is by key prefix when it comes (Consequences).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| A module's screens as one file the module routes itself, as item 25's registry had it (`load`), with a list of their addresses beside `paths.ts` for the suite to walk | Two lists of the app's routes to keep in step, and the second is the one nothing fails when a screen is added: the walk's worth is that a route in the router is a route it checks. A module's own `<Routes>` also loads every screen of the module with the first, where each is fetched when its address is opened (D-153) |
| The settings at the addresses the server's notifications already named, `/households/{id}/invitations` and `/households/{id}/members/{user_id}`, beside `/settings` | The sidebar draws a module as open on the screens under its home: two of the settings' screens would stand outside it. Storage's notification already linked under `/settings`; the two that did not are two constants |
| Household settings absent for a member who holds `none` on it | D-167: the member list is written for exactly that member, the server answers it to them, and nothing is kept by hiding that a household has settings |
| The three screens every member reads kept open by their addresses and out of the list at `none` | A screen nobody can find. The sidebar is the product's navigation (D-160) |
| The defaults and the ceilings written out in the web app, from the PRD's tables | A second statement of a rule the server enforces, which drifts with the first change to either: the composer would show levels the server does not write, or offer one it refuses. One vector file is how every rule both sides compute is held (D-37) |
| An operation that answers a role's defaults | A round trip, and a loading state, in front of a form that is to open "already answered"; and the ceiling would still be the client's to know, to leave a level out before a save |
| The matrix as a grid, modules down and levels across, a radio a cell | Sixty-eight targets of 44 px do not fit four across at a phone's width with 200 % text, and a column's heading is a legend: what *Can see* means would be read once at the top and not where it is chosen |
| A row that opens a sheet to change its level, as the prototype has it | Seventeen sheets to fill in one invitation. The platform's select is one control a row, which a phone and a screen reader already know, and the sentence under it says what was chosen |
| A change to a member's levels saved a row at a time, as each is chosen | Lowering a level is told to the member as it happens (D-78): five rows changed would be five notifications' worth of change made one press at a time, with no moment at which the owner sees what the whole comes to. The form says it, and one write carries it |
| The settings' writes held in the page until a connection returns | D-170 |
| The settings read from the household's replica | The replica's membership rows carry neither a member's name nor their address, which the list is made of, and an invitation's reaches only members who hold `view`: every screen would join the replica to the API. Nothing here is written offline, which is what a replica is for |
| An invitation's token kept in the tab's storage across the sign-in, or left in the address | A link invitation's token admits whoever holds it, once: in storage it is read by any script of the origin for as long as the tab lives, and in the address it is in the history and in whatever the address is copied to (ADR 0009). What a reload costs is opening the link again |
| The invitation shown only after its reader has signed in | The contract's preview asks for no session (ADR 0011), and "see exactly what you are being given" is what decides whether to make an account at all (FR-HH3). A wall first asks for an address before it has said what for |
| A visitor's account made on the invitation's own page | A second registration form, with its own screening of passwords and its own verification, beside the one item 25 built |
| A member in no household opened at their account | D-168 |
| The first run's question asked now over every module the member holds | D-169 |
| The leave screen asking the server first, with a request that changes nothing, to learn what stands in the way | No such operation exists, and a `POST` that might succeed is not a question. The members the screen reads say who the owners are and who pays; the one thing they do not say, an owner whose account is scheduled for deletion and counts as none (D-137), is what the server's `409` is drawn for |
| The control that leaves drawn and disabled while something stands in the way | Absence, not disabling (design 03-patterns §2): a disabled control says a thing can be done and not why it cannot. The two refusals are the screen's content, each with what unblocks it |
| A notice of a decline with the time it was declined, or one a control puts away | D-171: the contract keeps no such time, and a dismissal kept in one browser is true in that browser alone |
| The one sentence for *Off* on every row, household settings among them, as the matrix first had it | A member who holds *Off* on household settings read, on a screen of household settings, that it was not in their app at all, and an owner lowering it was told that it would leave the member's devices. It is the one row D-167 makes untrue of that sentence, so it is the one row with its own |
| Household settings offered only *Off* and *Can see* in the matrix, the two levels that differ for a member | The server takes all four, and a level the matrix would not offer is one a member may already hold: the row would show a choice that is not among its choices. A rule the client alone applies is not built (as a child's PIN is not judged here); the sentence says that the higher two give no more |
| The settings' own note that a change needs a connection, under the shell's bar that says changes are saved and will sync | Two sentences, one over the other, that say opposite things, and the announced one was the untrue one. The bar is what is said as the connection goes, so the bar says what holds on the screen it stands over |
| The household's replica closed before leaving is asked, so that it asks nothing of a household its member is about to be out of | A leave that is refused leaves a member in a household whose replica would have to be opened again, by a second way of closing one beside the household leaving the screen (ADR 0026). What it costs to leave it open is one request for the replica's credentials answered `404` in the moment between the answer and the navigation, which the SDK notes on the console and nobody is shown |
| A household's replica removed from the browser as its member leaves it | What it holds is what the member read while they were in the household, kept where only their own session reaches and removed with that session (D-161). Nothing opens it again and nothing reads it, and a removal by household is a second one to keep in step with the session's (Consequences). It keeps nothing from the member that they did not have the day before they left |
| The modules list, the matrix and an invitation's levels left without a module whose flag is off for the household (`flags`, D-146) | Sixteen modules are listed and granted today that no client opens, their screens not being built: what these screens list is what the household enables and what a member is given, which the server keeps whatever the flag says and holds for when the module opens. An owner who could not set a level on a module while it is dark would find it open one day at whatever each member happened to hold. Where a dark module must not be is the navigation, and there the household's own answer already holds it to no level (D-160) |
| A flag on each route's line of `paths.ts` saying its changes are asked at once, read by the offline bar in place of the two addresses it knows | Every screen of a household whose writes are asked at once is under `/settings` or is `/leave`, and item 27's sections are added under `/settings`: the flag would be set on seven lines to say what two addresses say, and a route's line would hold what its screen decides. The first such screen outside the two adds its address to `changesAtOnce`, whose sentence the shell's tests hold |
| Household settings kept out of `heldModules`, and listed by a notion of its own in the navigation and the module's address | Three callers ask which modules a member's app has, the navigation, a module's address and the first run's question, and D-167's answer is the same for each: household settings is in every member's app. Two lists would be one for a caller to choose wrongly between. What a level on it decides is asked where it decides something (`useStanding().invitations`) |
| The members read under the settings' note only for the reader it names the owners to, and not for an owner | The read is also what keeps the list fresh behind a member's own page: a change of what a member holds, or of their role, reads the household's members again while that page is open, so the list it leads back to is drawn as the change left it and not as it was for the moment before it is read again. It is one request after a write, for the list that the other screens of the settings read |
| A profile whose answer was lost given the PIN that was typed last, where it was typed anew before the profile was asked for again | It takes three answers lost and a PIN changed between two presses, and what is wrong then is a PIN the owner sets again from the profile's page, where a new one is two fields. Setting it for them would be a second write hidden inside the first |
| A member's version kept in step by the page once a child profile's PIN is set or its lock lifted, counted on by one, or the sheet held open until the member is read again | Both answer `204`, and the version they moved is the server's to say: counted here it is a guess at how the server counts. The member is read again as the answer arrives, so what is left is the moment before that read lands, or a read that failed: a save of levels pressed then is refused, said, and saved on the next press. Holding the sheet open for the read makes every PIN wait for a request that does not concern it |
| The PIN's two fields marked as something other than a new password (`one-time-code`, or `off`), so that no password manager offers to keep what was typed | A PIN is a secret being set, which is what `new-password` says and what keeps a browser from filling the owner's own password into it. `off` is ignored for a password by every browser that would offer, and `one-time-code` says something untrue of the field, on which a phone offers the codes its messages carry. What a password manager offers once the sheet has closed is the browser's own, and is declined there |
| The invitation's token forgotten when a session ends | What a session's end removes is removed too as a page finds its session gone, which is how somebody whose session lapsed arrives at their invitation, the page already drawn and holding its token: forgotten there, the token is gone before they come back from signing in, which is what it is held for. A token left in the page's memory opens what the page was already showing to whoever sits at it, an email invitation answers to its addressee alone, and a link admits whoever holds it, which is what a link is (FR-HH2) |
| A sentence of its own for a member who declines an invitation into the household they are in | The server answers that as it answers an invitation that is not the account's or is over, `404`, and what the page is shown of an invitation names no household it could hold against the member's own. The page says that it cannot tell which, which is so, and nothing was to be declined: accepting it answers the membership they have |
| A create whose id the server has answered with what the first one made, in place of the screen reading it | The server answers a repeated id `422`, a profile's by ADR 0012 and a household's and an invitation's as it does, and the two ceilings are counted before the id is looked at; changing either is the server's item, for every client, and is not what a web screen settles. What the screens do with the answer they are given is above |
| One hook for the banner a refusal is said in, across the settings | Four small ones, each holding what its screen's banner needs and no more: a count where a second refusal has the first one's words, a key where the mutation gives one. One hook would take each screen's wording and placement as arguments to save a line of state apiece. What they had two names for is one now: which refusals are about where the member stands (`isStandingRefusal`) |
| The read of what a create made, after a ceiling's refusal, failing the create with its own problem where it is refused | The read follows, in the same function, a request the same session was answered a moment before, and the one refusal it is asked for is that nothing is there, which leaves the ceiling's refusal standing. An answer about the session would be the next request's to hear as well, and is told then |
| The leave screen's refusal dropped once the members are read again, so that a blocker settled in another tab gives the control back | The server's word says what the members do not, an owner who counts as none (D-137), and is what the screen says of it: dropped at every read, it would go each time the page was looked at again, and come back with the next press. The screen's own way to settle a blocker leads to the members and back, which begins it again |
| The catalog split in this item, a module's words fetched with its screens | The first download is under its budget with this item's words in it. The split is a second way for a screen to be without its words, a failure to say for each route, and a guard that no screen outside a module reads the module's keys: machinery the budget does not yet ask for (D-159) |

## Consequences

- A module's web item adds its screens as lines of `paths.ts` and its line of the registry, and
  the walk checks them with no further word. **Item 32** is the first to register a `capture`,
  with which the first run's question is first asked, and brings the offer to invite somebody
  once a first record exists (DD-6's fifth step).
- A screen of household settings is set in `HouseholdSettingsPage`, asks `useStanding()` whether
  to draw a control that changes something, reads through `household/data.ts` and writes with
  `askedNow`. **Item 27** adds its sections to the settings' navigation (storage, billing, data,
  sync health, clients), draws the entitlement's banner where this item's frame says only that
  the household takes no writes, and gives the payer's refusal on the leave screen, and on a
  member's page, its way to hand billing over (A-29), which this item can only name.
- The contract keeps nothing of these, and the screens say only what it keeps (plan Q11):
  whether a child profile's Home is locked is chosen when the profile is made and changed by
  no operation, nor is its name or its year of birth by an owner; an invitation has no time of
  its answer, its message is not read back, and what an invitee is shown names neither its kind
  nor the address it was sent to, so an account that is not the addressee learns of it from the
  `404` to its answer; no operation sets a household's picture; a module's `needs_setup` and
  `entity_count` are never set, so a module turned off says only that its data is kept, and no
  setup is offered again (FR-HA9); the base currency changes with item 62; and an invitation's
  starting dashboard layout comes with the dashboard (item 36).
- FR-HH4 has the payer unblocked by handing billing over *or cancelling the subscription*; the
  server refuses a payer of record whatever the subscription's state. The leave screen says what
  the server does. Which of the two is meant is the PRD's to settle with item 27.
- The first download is 194 kB of its 200 kB. **Item 27**'s words pass it, so it splits a
  language's catalog first, by key prefix, `household.*` and its own each fetched with the
  screens that read them (D-159).
- A token kept in the page's memory does not outlive a page load: a visitor who signs in with a
  provider, whose pages take the tab away and bring it back, returns to the invitation's page
  with no token, and opens their link again, as after a reload. The page says of both where an
  invitation sent by email waits meanwhile.
- A household a member has left keeps its replica in the browser until the session ends
  (D-161, ADR 0026): nothing opens it again, and a second removal by household is one more to
  keep in step with the first.
- The sheet that makes a child profile says that the child is told, the first time they sign
  in, that a parent can see what they keep in their private space (FR-CH3). The child signs in
  on a phone: **item 29** tells them.
- **Item 29** builds the same screens on mobile from the same rule (`@household/domain`'s
  grants) and the same decisions (D-167 to D-171).
- **What would make this worth revisiting**: a module whose screens cannot each be a route (a
  wizard that must not be entered half-way); a member's name on the replica, which would let the
  member list be drawn from it; or an operation that lists what a member was notified of.
