/* Stage 1 — the screen ledger.
   Enumerated from docs/design/05-screens.md (+ 02-components, 04-navigation, 07-delivery).
   Row tuple: [name, stage, clients, statePreset, module, risk, kind]
     clients: "mw" | "m" | "w" | "b" (b = one client-neutral deliverable)
     statePreset: D = all twelve · F = loading/populated/error · S = populated · P = print
     kind: omitted = screen · component · state-set · widget-set · print
*/
(function () {
  /* The twelve state words, in the two shipping languages. Czech is written first —
     these words appear on the rail, in Help and in the coverage view, so a single
     English-only list would make the Czech build read half-translated. */
  var STATES = [
    ["loading", "Loading", "Skeleton, shape-matched — not a spinner", "Načítání"],
    ["empty", "Empty", "Teaching: one sentence, one example, one action", "Prázdné"],
    ["populated", "Populated", "", "Naplněné"],
    ["error", "Error", "Named in words, with an action", "Chyba"],
    ["offline", "Offline", "Reads indistinguishable from online", "Offline"],
    ["pending", "Pending", "Queued local write, fully editable", "Čeká"],
    ["syncing", "Syncing", "Only past a designed threshold", "Synchronizuje se"],
    ["conflicted", "Conflicted", "Tappable, opens the comparison", "Konflikt"],
    ["rejected", "Rejected", "The reason in a sentence + retry / edit / discard", "Odmítnuto"],
    ["absent", "Permission-absent", "Gone, not disabled", "Bez oprávnění"],
    ["withdrawn", "Withdrawn", "Retracted while the member held it", "Odebráno"],
    ["readonly", "Read-only (entitlement)", "Content visible, writes absent, banner explains", "Jen pro čtení"]
  ];
  /* One place the shell and the coverage view ask for a state word. */
  function stateWord(key, locale) {
    var hit = STATES.filter(function (s) { return s[0] === key; })[0];
    if (!hit) return key;
    return (locale === "cs" && hit[3]) || hit[1];
  }
  var ALL = STATES.map(function (s) { return s[0]; });
  var PRESETS = {
    D: ALL,
    F: ["loading", "populated", "error"],
    S: ["populated"],
    P: ["populated", "empty"]
  };

  /* ── declared exclusions ────────────────────────────────────────────────
     Settled in Stage 8: there is one D preset, and a row may declare the states that
     cannot occur on its own surface, each with the reason. The exclusions live next to
     the screen that argues them — household.js carries them per screen and draws the
     reason where the state would have been, auth.js the same — and they are mirrored here
     because this file is what computes coverage. `mismatches()` compares the two whenever
     a stage's data file is loaded, so the mirror cannot drift silently.

     A row's required states are its preset minus its exclusions. An excluded state is not
     an undrawn state: it is a state the surface cannot reach. */

  var EXCLUSIONS = {
    /* Stage 5 — sync.js */
    "F-5": { pending: "An inbox entry is derived on the server from a conflicted row; there is no local draft of it to queue.",
             syncing: "Same reason.",
             absent: "The inbox is a platform surface, not a module. A member with none on everything still has one, and it is empty.",
             withdrawn: "Entries route to the row they belong to; if access to that row is withdrawn the entry goes with it rather than becoming a withdrawn inbox." },

    /* Stage 6 — nav.js */
    "A-36": { empty: "A member is always in at least the household they are looking at, so the switcher never has nothing in it.",
              pending: "The switcher lists memberships resolved by the server. Nothing on it is a local write.",
              syncing: "Same reason.",
              conflicted: "Two clients cannot hold two versions of which households you are in.",
              rejected: "Switching household is a client-side route change, not a mutation that can be refused." },
    "F-13": { pending: "The sidebar is derived from resolved grants, which are a rendering hint and never a queued write (D-80).",
              syncing: "Same reason.",
              conflicted: "A derived list cannot disagree with itself.",
              rejected: "Nothing is written from the sidebar." },
    "F-15": { conflicted: "Arrange order is per member and last-write-wins; two of your own devices merge silently rather than asking.",
              rejected: "A personal view preference is never refused on a cross-row invariant." },

    /* Stage 7 — auth.js */
    "A-12": { absent: "Per-user, not per-household: there is no module grant over your own devices.",
              withdrawn: "Nothing here is retracted by an access change.",
              conflicted: "Sessions are server state; the client never holds two versions of them.",
              rejected: "Revocation is online-only — a refusal is an error on the screen with its reason, not a mutation held for later." },
    "A-19": { absent: "Per-user. Your own account settings are not grantable.",
              withdrawn: "Same reason: there is no grant to lose.",
              conflicted: "One person edits their own account, from one place at a time.",
              rejected: "A refused change is an error with a reason, not a held mutation." },

    /* Stage 8 — household.js */
    "A-23": { pending: "Grants reach the client as derived capability state, not an editable synced entity (D-80).",
              syncing: "Same reason.",
              conflicted: "Two owners cannot hold conflicting drafts of an invitation that does not exist yet.",
              rejected: "A refused invitation is an error with its reason, not a rejected mutation." },
    "A-28": { pending: "Billing is not in the sync feed.", syncing: "Same reason.",
              conflicted: "The processor holds the subscription's state; there is only ever one.",
              rejected: "A failed charge is the past-due banner, not a rejected mutation.",
              withdrawn: "Losing the payer role switches this screen to the state-only view, which is a drawing rather than a retraction." },
    "A-32": { conflicted: "This is the screen that reports conflicts; it does not have them.",
              rejected: "Same: it reports rejections.",
              withdrawn: "Device rows are the household's own and are not retracted by a grant change." },
    "A-34": { empty: "Six rights, always all six.",
              pending: "Nothing here is written offline.", syncing: "Same reason.",
              conflicted: "There is nothing two people can edit into conflict.",
              rejected: "A refused request is an error with a reason.",
              withdrawn: "Account-scoped, so there is no grant to lose." },
    "A-35": { pending: "An export is server work.",
              conflicted: "An export is a snapshot; two of them cannot disagree.",
              rejected: "A refused export is an error with a reason.",
              withdrawn: "A completed export belongs to whoever asked for it." },
    "C-49": { empty: "A household always has a name, a country and a code.",
              absent: "Any member may read the household profile whatever their grant; the writes are owner-gated instead." },
    "C-50": { pending: "Permissions are never client-authoritative (D-80).", syncing: "Same reason.",
              conflicted: "Two owners editing one member's grants is resolved on the server; the client never holds two versions of somebody's access.",
              rejected: "A refused grant change is an error with its reason." },
    "C-51": { empty: "Sixteen modules, always all sixteen.",
              conflicted: "Enablement is one household-wide switch per module, strict-version on the server.",
              absent: "A member without the settings grant never reaches the route — that is the neutral not-available Stage 6 drew." },
    "C-54": { pending: "Usage is measured on the server from daily samples.", syncing: "Same reason.",
              conflicted: "A measurement cannot conflict with itself.",
              rejected: "Nothing is written from this screen.",
              withdrawn: "Reading the totals needs the settings grant, which is the absent state." },
    "C-55": { pending: "Billing is not in the sync feed.", syncing: "Same reason.",
              conflicted: "One subscription, one state.", rejected: "A failed charge is a banner.",
              withdrawn: "Losing the payer role is the state-only view." },
    "C-56": { empty: "Four actions, always all four.",
              pending: "None of the four is written offline.", syncing: "Same reason.",
              conflicted: "The server holds one deletion request.",
              rejected: "A refusal is stated on the screen with its reason." },
    "C-57": { empty: "There is always at least the client you are reading it on.",
              pending: "Nothing here is written from a client.", syncing: "Same reason.",
              conflicted: "A version number is reported, not edited.", rejected: "Nothing is written.",
              withdrawn: "Reading it needs the settings grant, which is the absent state." },
    /* Stage 9 — shopping.js */
    "B-3": { conflicted: "An item is lww_field. Two people editing different fields both succeed; the same field twice resolves to the later client time and says nothing." },
    "B-4": { conflicted: "Order is a position, and positions merge silently — a conflict dialog for a drag would be absurd." },
    "B-5": { conflicted: "A staple flag and a recurring cadence are both fields on an item; two people marking the same staple is not a disagreement." },
    "B-6": { conflicted: "A trip is additive. Nothing merges into it, so there are never two versions of one — what it has instead is a rejection." },

    /* Stage 10 — dashboard.js */
    "C-1": { conflicted: "A layout is lww_row and personal: one row per member, and whole-row last-write-wins is correct because a layout is one artefact. Two of your own devices merge silently rather than asking which home screen you meant." },
    "C-2": { conflicted: "Adding from the catalog writes the layout, which is lww_row and personal. There is no version of this screen that asks a question." },
    "C-3": { conflicted: "Per member and last-write-wins, as with the sidebar's arrange: two of your own devices converge without being asked." },
    "C-6": { conflicted: "Still lww_row and still personal: once it is suggested, it is the child's own layout." },
    "C-7": { pending: "A locked layout is never written from this device, so there is nothing of it to queue.",
             syncing: "Same reason.",
             conflicted: "Nothing here is editable, so there are never two versions of it.",
             rejected: "There is no write from this screen for the server to refuse." },
    "C-9": { conflicted: "A widget owns no entity: its data is a projection over other modules' rows (D-42). Two versions of it cannot exist, and the rows inside it carry their own marks.",
             rejected: "Nothing is written to a widget. An action inside one is written to the owning module and refused there, on that module's row." },
    "C-10": { conflicted: "Same as the shell: a widget is a projection, and a projection cannot disagree with itself.",
              rejected: "Same as the shell: the write belongs to the owning module." },

    /* Stage 11 — spine.js. Four of these five surfaces own no data, which is why so
       many of the twelve cannot occur on them. */
    "F-1": { pending: "A query is a read. Nothing on this screen is written, so there is no local draft of it to queue.",
             syncing: "Same reason: search has no mutation of its own to send.",
             conflicted: "A result set is derived from the index at the moment you asked; two versions of it cannot exist. A hit whose entity is conflicted carries that mark on its row.",
             rejected: "There is no write from search for the server to refuse.",
             absent: "Search is a platform surface, not a module (\u00a7F). A member with none on sixteen modules still has the field \u2014 what changes is what it can match, which is why grants apply before ranking.",
             withdrawn: "A row whose access is retracted stops matching and leaves the results rather than becoming a withdrawn one." },
    "F-2": { empty: "A row exists because something matched. The empty state belongs to the result list, not to the row.",
             pending: "A hit is a read of the index.",
             syncing: "Same reason.",
             conflicted: "The row carries the source row\u2019s mark and opens the entity; the comparison lives there, never in a result list (DD-4).",
             rejected: "Nothing is written from a result row.",
             absent: "An entity the member may not see is never ranked, so there is no absent row to draw. The absence is the result count itself (FR-SE3).",
             withdrawn: "Retraction removes the entity from that member\u2019s index; the row is gone rather than withdrawn." },
    "F-3": { conflicted: "Today owns no feature data \u2014 it is assembled from the reminder strand and the metric catalog (FR-DB7). The mark on a row is the source row\u2019s, and tapping it opens the source entity where the comparison is.",
             rejected: "The same reasoning as a widget: a completion from a row is written to the owning module and refused there, on that module\u2019s row.",
             absent: "Today is a platform destination, not a module. A member with none on fourteen of them still has it, and what she gets is a short screen \u2014 which is this row\u2019s whole argument.",
             withdrawn: "A row whose access is retracted stops being assembled and leaves the screen rather than becoming a withdrawn row." },
    "F-4": { empty: "The cold-start set exists so this surface is never empty (DD-8): a household with no history still gets entries drawn from module enablement and the member\u2019s contribute grants.",
             pending: "The sheet is a launcher. The write happens on the capture surface it opens, and the mark belongs there.",
             syncing: "Same reason.",
             conflicted: "The ranking is local and advisory; there is nothing here for two clients to hold two versions of.",
             rejected: "Nothing is written from the sheet.",
             withdrawn: "A create whose grant is retracted leaves the sheet at the next ranking rather than becoming a withdrawn entry." },
    "F-19": { loading: "Help is bundled with the release and never fetched (DD-13, and the reasoning that self-hosts the fonts). There is nothing to wait for.",
              offline: "Bundled, so there is no online drawing for an offline one to differ from.",
              pending: "Authored content shipped in the build is not household data; nothing about it is written from a client.",
              syncing: "Same reason.",
              conflicted: "Same reason.",
              rejected: "Same reason.",
              absent: "Help attaches to the screen the member is already on. A screen her grants do not reach has no help to be absent from.",
              withdrawn: "There is no grant over help to retract.",
              readonly: "An entitlement that pauses writes does not pause the explanation of what a screen does; help is drawn identically." },

    /* Stage 12 — reminders.js and tasks.js. Every exclusion here is argued from the
       entity's own merge policy (\u00a72.5) or from a permission rule, not from the screen. */
    "C-11": { conflicted: "The list is a read over ten modules\u2019 rows. A conflicted source row carries its mark here and routes to its own module\u2019s resolver \u2014 DD-4 forbids resolving in place." },
    "C-12": { conflicted: "reminders.reminder is lww_field. Two members editing the title and the date both succeed, and there is no rich-text body that could be half-merged." },
    "C-13": { conflicted: "A subscription is lww_row and personal. Your own two devices merge silently rather than asking you which of you is right.",
              rejected: "A personal preference carries no cross-row invariant for the server to refuse (FR-RE6 permissions)." },
    "C-16": { conflicted: "tasks.card is lww_field. Two members editing different fields of one card both succeed, and the body is Markdown rather than rich text." },
    "C-17": { empty: "Four templates are reference data shipped in the build. The list cannot be empty.",
              conflicted: "Nothing exists yet to conflict with: this screen is what creates the board.",
              withdrawn: "There is nothing to retract before the board exists." },
    "C-18": { withdrawn: "A label is board-scoped. Losing Tasks retracts the board, and the board\u2019s own withdrawn state is where that is drawn." },
    "C-19": { absent: "The grant is checked at the card. Anyone who can see the card can see its checklist \u2014 there are no per-card or per-item permissions.",
              withdrawn: "Same: an item goes with its card.",
              conflicted: "tasks.checklist_item is lww_field, and ticking the same item twice is the same result." },
    "C-20": { conflicted: "additive: comments are created and never edited into conflict.",
              rejected: "An additive row is refused only on a cross-row invariant, and a comment carries none.",
              withdrawn: "A comment goes with its card; the card\u2019s withdrawn state is where that is drawn." },
    "C-22": { withdrawn: "Board-scoped, as labels are." },

    /* Stage 13 — notes.js */
    "C-26": { pending: "A query is not a write. There is nothing to queue and nothing to mark.",
              syncing: "Same reason.",
              conflicted: "A result list is derived from a query; two replicas cannot hold two versions of it.",
              rejected: "Nothing is written from this screen, so there is no mutation for the server to refuse." },

    /* Stage 13 — documents.js */
    "C-29": { conflicted: "Bytes are write-once and an upload is additive. Two uploads are two documents, never two versions of one." },
    "C-30": { conflicted: "Metadata is lww_field and the bytes are immutable. Two members editing different fields both succeed; the same field twice resolves to the later client time." },
    "C-32": { conflicted: "Type and expiry are fields on the document row: lww_field, and two people setting the same expiry are not disagreeing." },
    "C-33": { conflicted: "A selection is not an entity. Each row merges on its own policy, and a bulk operation cannot hold two versions of itself." },
    "C-34": { pending: "Usage is measured on the server from daily samples, not written by a client.",
              syncing: "Same reason.",
              conflicted: "A measurement cannot conflict with itself.",
              rejected: "Nothing is written from this screen. Deleting happens on the document row and is marked there." },

    /* Stage 14 — chores.js */
    "C-36": { conflicted: "chores.occurrence is lww_field and a completion is state_set keyed by (occurrence, user): two devices merge field by field and a double completion is idempotent." },
    "C-37": { conflicted: "The grid is derived from the same occurrences. Same policies, same reason." },
    "C-40": { conflicted: "additive: two devices appending rows cannot disagree about a sum.",
              rejected: "An append with an actor, a reason and a member has no invariant left to break." },
    "C-41": { conflicted: "A redemption is a two-party state machine on strict_version: the server refuses the losing write rather than keeping two versions of it." },
    "C-42": { conflicted: "Same: a verification decision refuses rather than forks." },
    "C-43": { conflicted: "Same: a swap is a two-party state machine." },
    "C-44": { conflicted: "The stale flag is derived from an occurrence age and a last-touched date. A computation cannot hold two versions of itself." },

    /* Stage 14 — activity.js */
    "C-45": { pending: "The log is server-side and read online (D-76). Nothing here is a local write.",
              syncing: "Same reason.",
              conflicted: "An append-only server log cannot hold two versions of itself.",
              rejected: "Nothing is written from this screen." },
    "C-46": { pending: "Same: a timeline is a read of the server log.",
              syncing: "Same reason.",
              conflicted: "Append-only, server-side.",
              rejected: "Nothing is written from this screen." },
    "C-47": { pending: "A diff is part of the event it belongs to.",
              syncing: "Same reason.",
              conflicted: "Append-only, server-side.",
              rejected: "Nothing is written from this screen." },

    /* Stage 14 — notify.js */
    "C-52": { pending: "A rule is server configuration, not a synced entity, so there is nothing to queue.",
              syncing: "Same reason.",
              conflicted: "Rules are not in the sync feed. Two devices cannot hold two versions of one." },
    "C-53": { pending: "A delivery attempt is a server record.",
              syncing: "Same reason.",
              conflicted: "An append-only record of attempts cannot fork." },
    "C-58": { pending: "Opening a setup is navigation. The writes belong to the setup screens themselves.",
              syncing: "Same reason.",
              conflicted: "A derived list of modules cannot hold two versions of itself.",
              rejected: "Nothing is written from this screen." },

    /* Stage 15 — utilities.js */
    "D-5": { conflicted: "A derived figure cannot fork. Two devices can hold two tariffs or two advances \u2014 this is arithmetic over them, and it links to the row that is actually in conflict.",
             rejected: "Nothing is written from this screen.",
             syncing: "Nothing here is uploaded. The readings and prices it reads from carry their own marks." },
    "D-9": { conflicted: "A reading is an observation of a moment, created with a client id and never merged. Nobody else recorded the same observation \u2014 which is exactly why it can be written in a cellar." },
    "D-10": { conflicted: "Additive: a reading is an observation of a moment and cannot hold two versions of itself." },
    "D-11": { conflicted: "A derived chart cannot fork; the readings under it carry the marks.",
              rejected: "Nothing is written from this screen.",
              syncing: "Nothing here is uploaded." },
    "D-16": { conflicted: "Headroom is arithmetic on a price and an advance.",
              rejected: "Nothing is written from this screen.",
              syncing: "Nothing here is uploaded.",
              pending: "Headroom holds no row of its own. A queued price edit shows its mark on the price; this figure simply recomputes." },

    /* Stage 16 — finance.js */
    "D-22": { conflicted: "A derived figure cannot fork. The incomes, the plan version and the transactions under it can — each carries its own mark and this screen links to the row that is actually in conflict.",
              rejected: "Nothing is written from this screen.",
              syncing: "Nothing here is uploaded. This is arithmetic over rows that carry their own marks." },
    "D-24": { conflicted: "A derived figure cannot fork. The plan and the incomes can; the picture over them cannot.",
              rejected: "Nothing is written from this screen — posting a movement is its own row (D-25).",
              syncing: "Nothing here is uploaded." },
    "D-30": { conflicted: "A settlement is additive — a fact, not a state — and the balances above it are arithmetic. The transactions they read carry the marks." },
    "D-31": { conflicted: "A budget is lww_field: two edits merge field by field and the later one wins, so there is never a question to ask." },
    "D-32": { conflicted: "A recurring definition is lww_field, for the same reason." },
    "D-33": { conflicted: "An append-only price history cannot fork; the confirmations under it are ordinary rows.",
              rejected: "Nothing is written from this screen.",
              syncing: "Nothing here is uploaded." },

    /* Stage 17 — garden.js */
    "D-42": { pending: "Nothing is written from the catalog. A household's own crop, a variety and an override are different rows on a different screen.",
              syncing: "The catalog is a versioned reference bundle the client downloads and caches, not household rows in the sync feed — a new version replaces the file.",
              conflicted: "Reference data has one author. Two households cannot fork it, and an override is a row of their own beside it.",
              rejected: "Nothing is written from here, so there is no mutation for the server to refuse.",
              withdrawn: "The catalog is not shared with a member. It ships with the client, so there is nothing to retract." },
    "D-43": { conflicted: "An override is lww_field: two edits merge field by field and the later one wins, so there is nothing to ask." },
    "D-44": { conflicted: "garden.planting is lww_field — dates and quantities merge, and two members rarely edit the same planting." },
    "D-45": { conflicted: "garden.task is lww_field and a completion is state_set. Neither can ask a question, which is the far-end-of-the-garden case." },
    "D-48": { pending: "A dry run persists nothing, so there is no local mutation to queue. The season is written from the confirmation that follows it.",
              syncing: "Same reason: nothing is uploaded from this screen.",
              conflicted: "The season it describes does not exist yet, so there is nothing for a second member to have forked." },
    "D-50": { conflicted: "garden.storage_item is lww_field: the remaining quantity is edited in place, and two people eating from the same jar is a merge the household can live with." },

    /* Stage 18 — calendar.js. Every exclusion here is argued from the entity's own
       merge policy: an event is lww_field with an exception row per occurrence, an
       RSVP is state_set, the overlay is local view state, and a connection is
       strict_version, server-held and shared with nobody. */
    "E-1": { conflicted: "calendar.event is lww_field and an occurrence exception is a row of its own: two members moving an event merge field by field. The structural rows — the household's calendars and a member's connections — are strict_version and do ask." },
    "E-2": { conflicted: "Same policy, same reason: the week is the same rows against a time axis." },
    "E-3": { conflicted: "Same policy, same reason." },
    "E-4": { conflicted: "Same policy, same reason. The agenda is the expansion read as a list." },
    "E-5": { conflicted: "lww_field, field by field. What the editor adds is the exception row, which is the thing Stage 12 refused reminders — and an exception is a new row, never a fork of one." },
    "E-7": { conflicted: "An answer is state_set keyed by (occurrence, member): answering twice is idempotent and two members answering at once merge by key." },
    "E-8": { pending: "The overlay is view state written to the device, not a synced row.",
             syncing: "Same reason: nothing about it is uploaded.",
             conflicted: "One member, one device, one view state.",
             rejected: "There is no mutation for the server to refuse.",
             withdrawn: "A member whose access is retracted leaves the overlay's list rather than becoming a withdrawn entry in it." },
    "E-11": { conflicted: "A connection is strict_version and server-held. Two owners editing one member's scope is resolved on the server; a client never holds two versions of somebody's privacy setting.",
              withdrawn: "A connection belongs to the member who made it and is shared with nobody, so there is no access to retract." },
    "E-12": { pending: "Health is measured on the server from the last sync attempt.",
              syncing: "Same reason.",
              conflicted: "A measurement cannot disagree with itself.",
              rejected: "Nothing is written from this screen.",
              withdrawn: "Per-member, and shared with nobody." },

    /* Stage 19 — assets.js and chat.js. Five facts do the arguing: a thing is
       lww_field, a schedule is strict_version (so the editor will not queue one),
       a record/reading/health entry/message envelope is additive, a dose is
       state_set keyed on the dose rather than the person, and a read marker is
       state_set resolved as a maximum. */
    "E-15": { conflicted: "Things and their fields are lww_field: two members editing the location and the serial number both succeed, and the same field twice resolves to the later client time and says nothing." },
    "E-16": { conflicted: "Things and their fields are lww_field: two members editing the location and the serial number both succeed, and the same field twice resolves to the later client time and says nothing." },
    "E-17": { pending: "asset.service_schedule is strict_version: the editor requires a version and will not queue one offline. What it does queue is a service record, which is additive.",
              syncing: "Same reason — there is nothing queued to be past a threshold." },
    "E-18": { conflicted: "A record, a reading, a health entry and a message envelope are additive — appended, never merged. Two devices writing at once produce two rows rather than two versions of one; what they can produce is a rejection." },
    "E-19": { conflicted: "A record, a reading, a health entry and a message envelope are additive — appended, never merged. Two devices writing at once produce two rows rather than two versions of one; what they can produce is a rejection." },
    "E-20": { conflicted: "Reference data on one side, new rows on the other. Nothing here is edited by two people at once." },
    "E-21": { conflicted: "Things and their fields are lww_field: two members editing the location and the serial number both succeed, and the same field twice resolves to the later client time and says nothing." },
    "E-22": { conflicted: "Things and their fields are lww_field: two members editing the location and the serial number both succeed, and the same field twice resolves to the later client time and says nothing." },
    "E-24": { conflicted: "vehicles.statutory_date is strict_version and both money- and law-bearing. Two owners editing one date is the case where a dialog is the correct answer, and it asks." },
    "E-25": { conflicted: "strict_version, like a Finance subscription and a Utilities contract, and for the same reason: this is money with a date on it." },
    "E-26": { conflicted: "A record, a reading, a health entry and a message envelope are additive — appended, never merged. Two devices writing at once produce two rows rather than two versions of one; what they can produce is a rejection." },
    "E-27": { syncing: "Nothing is uploaded from this screen; it is a read over rows other screens wrote.",
              conflicted: "A sum cannot disagree with itself. The rows it sums can, and they say so where they are.",
              rejected: "Nothing is written here." },
    "E-28": { conflicted: "Things and their fields are lww_field: two members editing the location and the serial number both succeed, and the same field twice resolves to the later client time and says nothing." },
    "E-29": { conflicted: "A record, a reading, a health entry and a message envelope are additive — appended, never merged. Two devices writing at once produce two rows rather than two versions of one; what they can produce is a rejection." },
    "E-30": { conflicted: "state_set keyed on (dose_occurrence). Two members recording the same dose resolve to one dose, which is the whole point of the key — there is no version of this screen that asks." },
    "E-31": { conflicted: "state_set keyed on (routine_item, date). Two people ticking the evening feed is one tick with one name on it." },
    "E-32": { conflicted: "Things and their fields are lww_field: two members editing the location and the serial number both succeed, and the same field twice resolves to the later client time and says nothing." },
    "E-33": { conflicted: "Things and their fields are lww_field: two members editing the location and the serial number both succeed, and the same field twice resolves to the later client time and says nothing." },
    "E-34": { conflicted: "A record, a reading, a health entry and a message envelope are additive — appended, never merged. Two devices writing at once produce two rows rather than two versions of one; what they can produce is a rejection." },
    "E-36": { conflicted: "A conversation row is strict_version and resolved on the server; the list itself is a read over messages, which are additive." },
    "E-37": { conflicted: "A record, a reading, a health entry and a message envelope are additive — appended, never merged. Two devices writing at once produce two rows rather than two versions of one; what they can produce is a rejection." },
    "E-38": { conflicted: "A record, a reading, a health entry and a message envelope are additive — appended, never merged. Two devices writing at once produce two rows rather than two versions of one; what they can produce is a rejection." },
    "E-40": { conflicted: "Two members cleaning up at once delete different files; the second delete of one file is a no-op, not a conflict." },
    "E-42": { syncing: "Nothing is written from this screen.",
              conflicted: "A query cannot disagree with itself." },

    "F-20": { empty: "Four categories, always all four.",
              conflicted: "Personal preferences; nobody else edits them.",
              withdrawn: "Personal, not household-scoped." }
  };

  /* The stage files that carry their own copy, so the mirror can be checked. */
  function mismatches() {
    var out = [];
    var H = window.HH_HOUSEHOLD;
    if (H) {
      H.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs household.js [" + there + "]");
      });
    }
    var A = window.HH_AUTH;
    if (A) {
      A.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.excludes || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs auth.js [" + there + "]");
      });
    }
    var D = window.HH_DASHBOARD;
    if (D) {
      D.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs dashboard.js [" + there + "]");
      });
    }
    var P = window.HH_SPINE;
    if (P) {
      P.rows.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs spine.js [" + there + "]");
      });
    }
    var RM = window.HH_REMINDERS;
    if (RM) {
      RM.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs reminders.js [" + there + "]");
      });
    }
    var TK = window.HH_TASKS;
    if (TK) {
      TK.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs tasks.js [" + there + "]");
      });
    }
    var NT = window.HH_NOTES;
    if (NT) {
      NT.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs notes.js [" + there + "]");
      });
    }
    var DC = window.HH_DOCS;
    if (DC) {
      DC.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs documents.js [" + there + "]");
      });
    }
    var CH = window.HH_CHORES;
    if (CH) {
      CH.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs chores.js [" + there + "]");
      });
    }
    var AL = window.HH_ACTIVITY;
    if (AL) {
      AL.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs activity.js [" + there + "]");
      });
    }
    var NF = window.HH_NOTIFY;
    if (NF) {
      NF.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs notify.js [" + there + "]");
      });
    }
    var FI = window.HH_FINANCE;
    if (FI) {
      FI.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs finance.js [" + there + "]");
      });
    }
    var UT = window.HH_UTILITIES;
    if (UT) {
      UT.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs utilities.js [" + there + "]");
      });
    }
    var S = window.HH_SHOPPING;
    if (S) {
      S.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs shopping.js [" + there + "]");
      });
    }
    var GA = window.HH_GARDEN;
    if (GA) {
      GA.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs garden.js [" + there + "]");
      });
    }
    var AS = window.HH_ASSETS;
    if (AS) {
      AS.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs assets.js [" + there + "]");
      });
    }
    var CH = window.HH_CHAT;
    if (CH) {
      CH.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs chat.js [" + there + "]");
      });
    }
    var CA = window.HH_CALENDAR;
    if (CA) {
      CA.screens.forEach(function (s) {
        if (s.preset !== "D") return;
        var here = Object.keys(EXCLUSIONS[s.id] || {}).sort().join(",");
        var there = Object.keys(s.impossible || {}).sort().join(",");
        if (here !== there) out.push(s.id + ": ledger [" + here + "] vs calendar.js [" + there + "]");
      });
    }
    return out;
  }

  var STAGES = [
    [1, "The screen ledger and the prototype skeleton", "instrument"],
    [2, "Foundations — tokens, type, space, motion, density", "vocabulary"],
    [3, "Icons and the illustration system", "vocabulary"],
    [4, "Primitives, layout components, twelve-state harness", "vocabulary"],
    [5, "The sync, conflict and honesty vocabulary", "vocabulary"],
    [6, "Both shells and all of navigation", "vocabulary"],
    [7, "Auth, child sign-in, account", "screens"],
    [8, "Household, invitation, grants, billing, privacy", "screens"],
    [9, "Shopping, end to end", "screens"],
    [10, "Dashboard, widget shell, all twenty-four widgets", "screens"],
    [11, "Today, Add sheet, global search, help model", "screens"],
    [12, "Reminders and Tasks", "screens"],
    [13, "Notes and Documents", "screens"],
    [14, "Chores, activity log, notification composer", "screens"],
    [15, "Utilities", "screens"],
    [16, "Finance", "screens"],
    [17, "Garden, and the print stylesheet", "screens"],
    [18, "Calendar", "screens"],
    [19, "Property, Vehicles, Pets — and Chat", "screens"],
    [20, "Conformance sweep and the walkthroughs", "sweep"],
    [21, "The tablet as a third client", "screens"],
    [22, "The per-screen bodies", "application"],
    [23, "The words, the second language, and a measured sweep", "words"]
  ];

  /* ── Stage 21 — the third client ──────────────────────────────────────
     06-clients named two clients and Stage 20 drew Miloš's tablet as the wide
     reading of the mobile shell. That reading was a decision nobody had taken, and
     the answer settled after the sweep is that the tablet is a client of its own.
     It does not add a row to every screen: it adds a client row to the screens whose
     tablet layout is not the wide mobile one. Those are enumerated here with the
     reason, so the count is arguable rather than asserted, and each says whether the
     layout is drawn yet. Print targets are deliberately absent — a sheet of paper is
     client-neutral, as the ledger already records — and so are the two client-neutral
     components the tablet touches: the app bar, which carries a two-pane title pair,
     and the widget shell, whose three sizes resolve against four columns. Both stay
     one deliverable and are redrawn in place rather than gaining a client row.

     drawn: true  → the layout exists in Household Prototype.dc.html, in every state
                    the row requires (the rail switches them; the shell is one tree).
     drawn: false → declared and not yet drawn. There are none left: the last six
                    were drawn in the application, each as a layout of its own. */

  var TABLET = {
    "F-11": { drawn: true,  why: "Five destinations on a 834 px bar: the slots are wider than a phone's and narrower than a sidebar's, so the bar is its own layout rather than a stretched one." },
    "F-12": { drawn: true,  why: "The four-slot reading on the same bar. Miloš holds four modules, so this is the bar the fixture actually draws." },
    "F-15": { drawn: true,  why: "Per-member arrange for a tab bar with more room: the hidden-by-me list and the absent set need a two-column reading." },
    "A-36": { drawn: true,  why: "The household switcher opens beside the content rather than over it, because there is room for both." },
    "C-1":  { drawn: true,  why: "DD-2's ladder resolves to four columns at 834 px and to two at 200 % text — a third outcome the two-client ladder never produced." },
    "B-1":  { drawn: true,  why: "Lists and the open list sit side by side; picking a list does not leave the overview." },
    "B-2":  { drawn: true,  why: "The list is the detail pane, with quick-add still the focused control." },
    "C-11": { drawn: true,  why: "The unified reminder list keeps the week groups while a reminder opens beside them." },
    "C-15": { drawn: true,  why: "The board is the list pane at four columns; a card opens beside it instead of over it." },
    "C-16": { drawn: true,  why: "Card detail as a pane, so the column the card is in stays visible while it is read." },
    "C-23": { drawn: true,  why: "The tree and the note, side by side — the two-pane case the notes browser was designed for." },
    "C-28": { drawn: true,  why: "Same shape for the documents tree." },
    "C-30": { drawn: true,  why: "Document detail as the second pane, with the preview sized to the pane rather than the phone." },
    "E-15": { drawn: true,  why: "One entity list, three vocabularies, and the thing open beside its siblings." },
    "E-16": { drawn: true,  why: "Entity detail as a pane: schedule and history without leaving the list." },
    "E-36": { drawn: true,  why: "Conversation list beside the thread, which is the layout chat has on a tablet and never on a phone." },
    "E-37": { drawn: true,  why: "The thread as the second pane, with the floor unchanged." },
    "D-8":  { drawn: true,  why: "Service detail beside the service list, so a reading is entered without losing the balance." },
    "D-10": { drawn: true,  why: "The readings list is the list pane; a reading opens beside it." },
    "C-3":  { drawn: true,  why: "Arrange on a four-column grid is a different drag target set from the phone's single column, and the drop affordances have to be redrawn." },
    "C-37": { drawn: true,  why: "The weekly grid is the row that pivots on mobile and does not need to on a tablet — which means a third layout, not a choice between the two." },
    "E-1":  { drawn: true,  why: "The month grid fits a tablet without the phone's compromises and without the web's density control. It is its own cell size." },
    "E-2":  { drawn: true,  why: "Week view at 834 px: seven columns fit, so the phone's three-day scroll is wrong here." },
    "D-24": { drawn: true,  why: "The flow view's stage-major row was designed to fit 360 px. At 834 px the node-major reading fits, so the tablet takes it — columns are the accounts, each row one movement named on both sides — and the phone keeps the stage-major row." }
  };

  var GROUPS = {
    A: ["Platform — identity, household, billing", "P0", "05-screens §A"],
    B: ["Shopping", "P1", "05-screens §B"],
    C: ["The daily core", "P2", "05-screens §C"],
    D: ["The differentiators", "P3", "05-screens §D"],
    E: ["Breadth", "P4", "05-screens §E"],
    F: ["Cross-cutting screens", "mixed", "05-screens §F"]
  };

  var A = [
    ["Sign in", 7, "mw", "F", "Auth", 0],
    ["Register", 7, "mw", "F", "Auth", "The breached-password refusal is the hardest sentence on the screen"],
    ["Verify email", 7, "mw", "F", "Auth", 0],
    ["Unverified but working", 7, "mw", "S", "Auth", "The block must explain itself at the moment it blocks"],
    ["MFA enrol (TOTP)", 7, "mw", "F", "Auth", 0],
    ["Recovery codes", 7, "mw", "S", "Auth", 0],
    ["MFA challenge on a new device", 7, "mw", "F", "Auth", 0],
    ["Recovery-code use", 7, "mw", "F", "Auth", 0],
    ["Password reset — request", 7, "mw", "F", "Auth", 0],
    ["Password reset — set", 7, "mw", "F", "Auth", "Every session and refresh-token family invalidated — say so"],
    ["Account-takeover notice", 7, "mw", "S", "Auth", "Rare, alarming, must be written calmly"],
    ["Sessions and devices", 7, "mw", "D", "Account", 0],
    ["Revoke device — discards its replica", 7, "mw", "S", "Account", 0],
    ["Child sign-in — household code", 7, "m", "F", "Auth", 0],
    ["Child sign-in — profile picker", 7, "m", "F", "Auth", 0],
    ["Child sign-in — PIN", 7, "m", "F", "Auth", 0],
    ["Shared-tablet profile switcher", 7, "m", "F", "Auth", 0],
    ["PIN lockout", 7, "m", "S", "Auth", "A child meets this alone; must not read as punishment"],
    ["Account settings", 7, "mw", "D", "Account", 0],
    ["Account deletion", 7, "mw", "F", "Account", "Four situations resolved and stated up front"],
    ["Please update", 7, "m", "S", "Platform", "Five languages; the last thing some members see"],
    ["Create household", 8, "mw", "F", "Household", 0],
    ["Invitation composer", 8, "mw", "D", "Household", "Carries a seventeen-row grant matrix before the person exists"],
    ["Invitation acceptance", 8, "mw", "F", "Household", "Highest-value Phase 0 screen; gets the most iteration"],
    ["Invitation declined — inviter notice", 8, "mw", "S", "Household", 0],
    ["Leave household", 8, "mw", "F", "Household", "last_owner / billing_payer refusals stated together"],
    ["Subscribe", 8, "mw", "F", "Billing", 0],
    ["Manage billing", 8, "mw", "D", "Billing", 0],
    ["Take over billing", 8, "mw", "F", "Billing", 0],
    ["Entitlement banners — six states", 8, "b", "S", "Billing", "active shows nothing; suspended is not a banner", "state-set"],
    ["Suspended lockout", 8, "mw", "S", "Billing", "No household content, no export affordance (DD-15)"],
    ["Sync health", 8, "mw", "D", "Platform", 0],
    ["Diagnostic bundle", 8, "mw", "S", "Privacy", "Rendered, with per-field redaction, before sending"],
    ["Privacy centre", 8, "mw", "D", "Privacy", 0],
    ["Export — request, progress, download", 8, "mw", "D", "Privacy", 0],
    ["Household switcher", 6, "mw", "D", "Navigation", 0],
    ["Offline bar", 5, "b", "S", "Sync", "Designed once, globally", "component"]
  ];

  var B = [
    ["Lists overview", 9, "mw", "D", "Shopping", 0],
    ["List", 9, "mw", "D", "Shopping", "One-handed, bad light, no signal; check-off is one tap"],
    ["Item detail", 9, "mw", "D", "Shopping", 0],
    ["Store layout editor", 9, "mw", "D", "Shopping", 0],
    ["Staples", 9, "mw", "D", "Shopping", 0],
    ["Trip summary", 9, "mw", "D", "Shopping", "First screen to draw an edit affordance unavailable offline"],
    ["Teaching empty state", 9, "mw", "S", "Shopping", "The template for the other sixteen"],
    ["Two-trolley concurrent check-off", 9, "mw", "S", "Shopping", "No conflict dialog shown to anyone"]
  ];

  var C = [
    ["Dashboard — ordered list at 2 / 4 / 6", 10, "mw", "D", "Dashboard", 0],
    ["Widget catalog", 10, "mw", "D", "Dashboard", 0],
    ["Arrange mode", 10, "mw", "D", "Dashboard", 0],
    ["Owner default layout editor", 10, "mw", "D", "Dashboard", 0],
    ["Adopt-new-default notice", 10, "mw", "S", "Dashboard", 0],
    ["Child layout — suggested", 10, "mw", "D", "Dashboard", 0],
    ["Child layout — locked", 10, "mw", "D", "Dashboard", "Arrange affordances absent, not disabled"],
    ["Widget unavailable", 10, "b", "S", "Dashboard", "One slow module never blanks the screen", "state-set"],
    ["Widget shell — small / medium / large", 10, "b", "D", "Dashboard", 0, "component"],
    ["The widget set — 24 widgets", 10, "b", "D", "Dashboard", "Keys not enumerated in the handoff — see gaps", "widget-set"],

    ["Unified reminders list", 12, "mw", "D", "Reminders", 0],
    ["Own reminder editor", 12, "mw", "D", "Reminders", "due_on is a day, not an instant"],
    ["Subscriptions — 21 kinds", 12, "mw", "D", "Reminders", "Design the defaults, then the screen for the minority"],
    ["Snooze — personal", 12, "mw", "S", "Reminders", 0],

    ["Tasks board", 12, "mw", "D", "Tasks", 0],
    ["Card detail", 12, "mw", "D", "Tasks", 0],
    ["Template picker — four starters", 12, "mw", "D", "Tasks", 0],
    ["Label management", 12, "mw", "D", "Tasks", 0],
    ["Checklist", 12, "mw", "D", "Tasks", 0],
    ["Comments with mentions", 12, "mw", "D", "Tasks", 0],
    ["Cross-board move", 12, "mw", "F", "Tasks", 0],
    ["Column editor — kind without jargon", 12, "mw", "D", "Tasks", 0],

    ["Notes tree browser + root switcher", 13, "mw", "D", "Notes", 0],
    ["Note editor — WYSIWYG + raw Markdown", 13, "mw", "D", "Notes", 0],
    ["Pinning at two scopes", 13, "mw", "S", "Notes", 0],
    ["Language-aware note search", 13, "mw", "D", "Notes", 0],
    ["Conflict banner — preserved body, 30 days", 13, "mw", "S", "Notes", "A 'here it is' affordance, not a question"],

    ["Documents tree", 13, "mw", "D", "Documents", 0],
    ["Upload, including from the camera", 13, "mw", "D", "Documents", 0],
    ["Document detail — preview / raw / download", 13, "mw", "D", "Documents", 0],
    ["Document detail — active type, download-only", 13, "mw", "S", "Documents", 0],
    ["Document type + expiry", 13, "mw", "D", "Documents", 0],
    ["Bulk move / archive / zip / delete", 13, "mw", "D", "Documents", 0],
    ["Documents storage screen", 13, "mw", "D", "Documents", 0],
    ["Reference warning before delete", 13, "mw", "S", "Documents", "Names what points at the file rather than blocking"],

    ["Chores today — mine first", 14, "mw", "D", "Chores", 0],
    ["This week — the weekly grid", 14, "mw", "D", "Chores", "Twelve members at 200 % text; pivots on mobile"],
    ["All chores", 14, "mw", "D", "Chores", 0],
    ["Chore editor", 14, "mw", "D", "Chores", "Four schedule kinds, four assignment modes"],
    ["Points ledger", 14, "mw", "D", "Chores", "Every award has a reason and an actor"],
    ["Rewards and redemption", 14, "mw", "D", "Chores", 0],
    ["Verification queue", 14, "mw", "D", "Chores", 0],
    ["Swap request / accept", 14, "mw", "D", "Chores", 0],
    ["Stale-chore prune — owner facing", 14, "mw", "D", "Chores", "Pruning the list is a feature"],

    ["Activity feed — filterable", 14, "mw", "D", "Activity", 0],
    ["Entity timeline — cross-module", 14, "mw", "D", "Activity", 0],
    ["Field diff", 14, "b", "D", "Activity", 0, "component"],
    ["Activity needs-connection state", 14, "b", "S", "Activity", "The log is deliberately not synced", "state-set"],

    ["Settings §1 Profile", 8, "mw", "D", "Settings", "Changing base currency shows what will change first"],
    ["Settings §2 Members and grants", 8, "mw", "D", "Settings", "Every member's matrix visible to every member"],
    ["Settings §3 Modules", 8, "mw", "D", "Settings", 0],
    ["Settings §4 Notification composer", 14, "mw", "D", "Settings", "Must not become business software; picking beats composing"],
    ["Settings §4 Delivery log and test send", 14, "mw", "D", "Settings", 0],
    ["Settings §5 Storage", 8, "mw", "D", "Settings", "Derived overhead named, not hidden"],
    ["Settings §6 Billing", 8, "mw", "D", "Settings", 0],
    ["Settings §7 Data — export, delete, transfer, restrict", 8, "mw", "D", "Settings", "Restrict sits here, not under billing"],
    ["Settings §8 Advanced — clients and versions", 8, "mw", "D", "Settings", 0],
    ["Per-module setup re-entry points", 14, "mw", "D", "Settings", 0]
  ];

  var D = [
    ["Utilities setup 1 — what do you pay for", 15, "mw", "F", "Utilities", 0],
    ["Utilities setup 2 — detail per service", 15, "mw", "F", "Utilities", 0],
    ["Utilities setup 3 — country + commodity preset", 15, "mw", "F", "Utilities", 0],
    ["Utilities setup 4 — enter what you know", 15, "mw", "F", "Utilities", 0],
    ["Services overview", 15, "mw", "D", "Utilities", 0],
    ["Service detail — bills_only", 15, "mw", "D", "Utilities", 0],
    ["Service detail — readings", 15, "mw", "D", "Utilities", 0],
    ["Service detail — full", 15, "mw", "D", "Utilities", 0],
    ["Reading entry — the cellar screen", 15, "mw", "D", "Utilities", "Standing in a cellar with no signal; the module's most important layout"],
    ["Readings list", 15, "mw", "D", "Utilities", 0],
    ["Consumption chart", 15, "mw", "D", "Utilities", "Estimated points styled distinctly and excluded from money"],
    ["Tariff composer", 15, "mw", "D", "Utilities", "Eleven component types, no formula language; transcribing a bill"],
    ["Advances schedule", 15, "mw", "D", "Utilities", "Attributed by month key, not payment date"],
    ["Billing period and settlement", 15, "mw", "D", "Utilities", "Computed vs invoiced in both money and units"],
    ["Blocked state", 15, "mw", "S", "Utilities", "Form pre-filled to the date, with no estimated value"],
    ["Headroom", 15, "mw", "D", "Utilities", "Computable with zero consumption data"],
    ["Bills-only — invoices and spend history", 15, "mw", "D", "Utilities", 0],
    ["Meter replacement", 15, "mw", "F", "Utilities", 0],
    ["Mode upgrade — nothing lost", 15, "mw", "F", "Utilities", 0],

    ["Finance setup 1 — how does your household handle money", 16, "mw", "S", "Finance", "Four illustrated answers; the module's most important screen"],
    ["Finance setup 2-5", 16, "mw", "F", "Finance", 0],
    ["Period overview", 16, "mw", "D", "Finance", 0],
    ["Missing-period prompt", 16, "mw", "S", "Finance", "The real failure mode is a month nobody entered"],
    ["Flow view", 16, "mw", "D", "Finance", "N to M, reconciles exactly, phone-readable, never implies the app moved money"],
    ["Post a movement", 16, "mw", "F", "Finance", 0],
    ["Allocation plan editor", 16, "mw", "D", "Finance", "Exactly one remainder per source, refused at save by name"],
    ["Accounts", 16, "mw", "D", "Finance", 0],
    ["Ledger", 16, "mw", "D", "Finance", 0],
    ["Expense editor", 16, "mw", "D", "Finance", "Five split methods, deterministic last minor unit"],
    ["Balances and settle up", 16, "mw", "D", "Finance", "Simplified set and the pairwise list"],
    ["Budgets", 16, "mw", "D", "Finance", 0],
    ["Recurring and subscriptions", 16, "mw", "D", "Finance", 0],
    ["Price history", 16, "mw", "D", "Finance", 0],
    ["Cancellation-window reminder", 16, "mw", "S", "Finance", "Fires at the notice period, not at expiry"],
    ["Import wizard", 16, "mw", "D", "Finance", 0],
    ["Duplicate confirmation", 16, "mw", "S", "Finance", "Never silently dropped, never silently imported"],
    ["Finance conflict resolver", 16, "mw", "S", "Finance", "The one module where a conflict dialog is the right answer"],

    ["Garden setup — four questions", 17, "mw", "F", "Garden", "The pin snaps visibly to two decimals"],
    ["pots home", 17, "mw", "D", "Garden", 0],
    ["beds home", 17, "mw", "D", "Garden", "Designed first: the median European garden"],
    ["plot home", 17, "mw", "D", "Garden", 0],
    ["Crop catalog browser", 17, "mw", "D", "Garden", "Per-field provenance, folklore and agronomy distinguishable"],
    ["Household overrides", 17, "mw", "D", "Garden", "Shown as an override, never merged silently"],
    ["Planting editor", 17, "mw", "D", "Garden", 0],
    ["Generated task list with tombstones", 17, "mw", "D", "Garden", 0],
    ["Drift detail", 17, "mw", "S", "Garden", "An actual date changes no planned window"],
    ["Plan-check panel", 17, "mw", "D", "Garden", "Eleven checks, dismissible, explicit no_history state"],
    ["Season copy — dry run", 17, "mw", "D", "Garden", "The whole prospective season shown before it exists"],
    ["Season close", 17, "mw", "F", "Garden", 0],
    ["Storage log", 17, "mw", "D", "Garden", "Edited in place; no movements table"],
    ["Frost warning", 17, "mw", "S", "Garden", "The single most valuable thing for a balcony gardener"],
    ["Print — this month's work", 17, "b", "P", "Garden", "Real checkboxes; legible from a garden pocket", "print"],
    ["Print — the season plan", 17, "b", "P", "Garden", "One page", "print"],
    ["The print stylesheet", 17, "b", "S", "Garden", "No dark theme, no accents, ink-cheap", "component"]
  ];

  var E = [
    ["Calendar month", 18, "mw", "D", "Calendar", 0],
    ["Calendar week", 18, "mw", "D", "Calendar", 0],
    ["Calendar day", 18, "mw", "D", "Calendar", 0],
    ["Agenda", 18, "mw", "D", "Calendar", "The mobile default"],
    ["Event editor with recurrence", 18, "mw", "D", "Calendar", 0],
    ["Three-choice occurrence edit", 18, "mw", "S", "Calendar", "Each choice states its own consequence"],
    ["Participants and RSVP", 18, "mw", "D", "Calendar", 0],
    ["The who overlay", 18, "mw", "D", "Calendar", 0],
    ["Busy blocks", 18, "mw", "S", "Calendar", "Unmistakable and uninspectable"],
    ["Connection setup per provider", 18, "mw", "F", "Calendar", "A privacy screen; never available to a child"],
    ["Per-remote-calendar direction and scope", 18, "mw", "D", "Calendar", "Busy-only offered first"],
    ["Connection health + staleness badge", 18, "mw", "D", "Calendar", 0],
    ["External conflict resolution", 18, "mw", "S", "Calendar", "The loser is preserved and surfaced"],
    ["Disconnect", 18, "mw", "F", "Calendar", "Asks what to do with the mirrored events"],

    ["Asset entity list", 19, "mw", "D", "Assets", "Rendered three times in three vocabularies"],
    ["Asset entity detail", 19, "mw", "D", "Assets", 0],
    ["Service schedule editor", 19, "mw", "D", "Assets", "Interval, usage, or whichever comes first"],
    ["Service history", 19, "mw", "D", "Assets", 0],
    ["Usage log", 19, "mw", "D", "Assets", 0],

    ["Property starter checklist by country", 19, "mw", "D", "Property", 0],
    ["Contractors", 19, "mw", "D", "Property", 0],
    ["Meter locations", 19, "mw", "D", "Property", "Where is the stopcock"],
    ["Print — insurance inventory", 19, "b", "P", "Property", "The most valuable thing in the app on one very bad day", "print"],

    ["Vehicle statutory dates", 19, "mw", "D", "Vehicles", "STK / TK / HU-TUV / przeglad / MOT"],
    ["Vehicle insurance with notice period", 19, "mw", "D", "Vehicles", 0],
    ["Fuel and charging log", 19, "mw", "D", "Vehicles", "Correct partial fills"],
    ["Total cost of ownership", 19, "mw", "D", "Vehicles", 0],
    ["Bike variant", 19, "mw", "D", "Vehicles", "Never asks for a plate"],

    ["Pet health record", 19, "mw", "D", "Pets", "Six entry types"],
    ["Medication doses", 19, "mw", "D", "Pets", "Ticked per dose, shared across the household"],
    ["Daily routine", 19, "mw", "D", "Pets", "Resets and shows who did it"],
    ["Vet card", 19, "mw", "D", "Pets", "Out-of-hours number one tap from the top"],
    ["Feeding details and allergies", 19, "mw", "D", "Pets", "The thing you hand to whoever is looking after them"],
    ["Weight chart", 19, "mw", "D", "Pets", 0],
    ["Deceased / rehomed flow", 19, "mw", "F", "Pets", "Gentle"],

    ["Conversation list", 19, "mw", "D", "Chat", 0],
    ["Thread", 19, "mw", "D", "Chat", "Reactions are desired-state, not toggle"],
    ["Attachments with async thumbnails", 19, "mw", "D", "Chat", "The row exists before the bytes"],
    ["Unread and the floor", 19, "mw", "S", "Chat", "A member added today sees nothing before joining"],
    ["Chat storage clean-up", 19, "mw", "D", "Chat", "Move to Documents as a custody transfer"],
    ["Mute per conversation", 19, "mw", "S", "Chat", 0],
    ["Search bounded by the floor", 19, "mw", "D", "Chat", 0]
  ];

  var F = [
    ["Global search", 11, "mw", "D", "Search", "One result row shape; grants applied before ranking"],
    ["Search result row — no snippet / no path", 11, "b", "D", "Search", "Nullable fields still have to read as a result", "component"],
    ["Today", 11, "mw", "D", "Today", "Five groups, conditional alerts on top; a quiet day is a short screen"],
    ["Add sheet", 11, "m", "D", "Add", "Slow-moving window; never reorders while open"],
    ["Conflict inbox", 5, "mw", "D", "Sync", "Routes to the row, never resolves in place"],
    ["Conflict resolver", 5, "mw", "S", "Sync", "Both values, both authors, both times, no jargon"],
    ["Rejected-mutation resolver", 5, "mw", "S", "Sync", "Four real reasons; retry / edit / discard"],
    ["Sync state mark", 5, "b", "S", "Sync", "Absence is the synced state", "component"],
    ["Withdrawn / retracted treatment", 5, "b", "S", "Sync", "Not an error, not an empty state", "state-set"],
    ["Not-enough-information state", 5, "b", "S", "Sync", "Distinguishable from a genuine zero", "state-set"],
    ["Tab bar at five destinations", 6, "m", "S", "Navigation", 0, "component"],
    ["Tab bar at four destinations", 6, "m", "S", "Navigation", "A first-class layout, not a bar with a hole", "component"],
    ["Web sidebar", 6, "w", "D", "Navigation", "Per-member ordered module list plus global search", "component"],
    ["App bar / page header", 6, "b", "S", "Navigation", 0, "component"],
    ["Per-member arrange — order and visibility", 6, "mw", "D", "Navigation", "Hidden by me is recoverable; absent leaves no trace"],
    ["Deep link resolution — four situations", 6, "mw", "S", "Navigation", "Warm, cold start, wrong household, no access"],
    ["Neutral not-available", 6, "mw", "S", "Navigation", "Never a 403-flavoured leak"],
    ["404 for a moved slug path", 13, "mw", "S", "Navigation", "Explains itself; every link is household-internal"],
    ["In-app help — model and three surfaces", 11, "b", "D", "Help", "Inline hint, expandable, panel", "component"],
    ["Notification permission + categories", 8, "mw", "D", "Platform", "Designed as one screen"]
  ];

  /* ── what has actually been delivered ────────────────────────────────
     One entry per stage that has produced an artifact. A stage with no
     ledger rows (1-4) still records its artifact and its gate, because the
     coverage view is the only place the two are read together. */

  var ARTIFACTS = {
    1: { file: "Prototype Skeleton.dc.html", short: "skeleton",
         delivered: "ledger.js, fixtures.js, the dev rail, the routing stub and this coverage view",
         gate: "closed",
         gateNote: "Every row carries an id, a client, its states and a stage. Frozen in Stage 20 at 411 client rows over 2 995 required states, with zero unbuilt — the enumeration questions that could still move the count were answered or recorded as gaps, and the version here reads 1.0-frozen rather than a candidate. The freeze held: Stage 21 did not reopen it but added a third client alongside it, 24 rows counted apart." },
    2: { file: "Foundations.dc.html", short: "foundations",
         delivered: "foundations.js — three token layers in both themes, the thirteen status tokens, the seventeen-key accent map, the type and mono scales, space, radius, motion, density, and the declared contrast pairs computed live",
         gate: "closed",
         gateNote: "Every declared pair is computed from the token file in both themes; no colour is defined only in the dark block." },
    3: { file: "Icons and Illustration.dc.html", short: "icons",
         delivered: "icons.js — the thirteen status icons drawn and measured in greyscale at 16 px, the seventeen module icons plus Today and Add on one grid, the label register; illustration.js — the construction language and its parts kit",
         gate: "closed",
         gateNote: "The status set is distinguishable in greyscale at 16 px by measurement, and every icon-only control draws its label from the register." },
    4: { file: "Components and States.dc.html", short: "components",
         delivered: "components.js — the §1 primitives and §2 layout parts, the nine data-bearing bodies, and the twelve-state harness as 108 built cells",
         gate: "closed",
         gateNote: "Nine bodies by twelve states, every cell resolving to exactly one treatment, in both themes at 200 % text." },
    5: { file: "Sync and Honesty.dc.html", short: "sync",
         delivered: "sync.js — the seven-step ladder, the five merge policies on four visible shapes, the conflict inbox and resolver, the four rejection reasons, retraction, and the seven honesty situations",
         gate: "closed",
         gateNote: "The vocabulary gate passes. The conflict inbox declares four states its surface cannot reach and was drawn in five of the eight that remain; the last three — loading, error and read-only — were drawn in Stage 20 and are recorded against that file rather than this one." },
    7: { file: "Auth and Account.dc.html", short: "auth",
         delivered: "auth.js \u2014 the twelve-message failure register with an enumeration verdict on each, twenty-one screens drawn from it: sign in, register with the breached refusal, verification, the second step and its recovery codes, the takeover notice, sessions and devices, the five child screens, account settings, deletion\u2019s four situations and Please update",
         gate: "closed",
         gateNote: "Every enumerable failure resolves to one generic sentence, computed from the register rather than asserted. Sessions and devices and account settings declare the four states a per-user surface cannot reach, each with its reason, and are drawn in all eight that remain." },
    8: { file: "Household and Billing.dc.html", short: "household",
         delivered: "household.js \u2014 the eight entitlement states as one table with every banner, lockout and lift control derived from it; the seventeen-row grant matrix in words a member already knows; twenty-one screens: create household, the invitation composer and the acceptance screen, leave, subscribe, manage and take over billing, the suspended lockout, sync health, the rendered diagnostic bundle, the privacy centre, export, and seven of household settings\u2019 eight sections",
         gate: "closed",
         gateNote: "Seven checks pass, all computed: no API level word reaches a screen, six of eight states are banners, only read-only and cancelled carry a deletion date, every lift control names its landing state, export reaches seven of eight states and the lockout offers no button, every destructive control names its object, and the storage charge is arithmetic on the samples. Thirteen rows carry the twelve-state preset and four of the twelve cannot occur on some of them \u2014 each with its reason on the screen. The gate read open until Stage 20 audited it: all forty-three rows were built and the prose had outlived its own arithmetic." },
    9: { file: "Shopping.dc.html", short: "shopping",
         delivered: "shopping.js \u2014 the quick-add splitter and quantity parser as one function with its test table, the two-trolley op log with the merge that resolves it in both receive orders, the staple ranking over nine weeks of the household's own history, and the eight \u00a7B screens; Shopping.dc.html draws them, with a live list you can type into and tick off",
         gate: "closed",
         gateNote: "Ten checks pass, all computed or measured: adding is one field and no decisions, six parser cases including the decimal comma and the percentage guard, check-off is a single tap with the hold gesture absent from the module, both receive orders of the two-trolley log converge with zero questions asked, the Finance offer follows the grant for one of five members and leaves no trace for the other four, and the recorded trip draws its correction as unavailable offline in words." },
    10: { file: "Dashboard and Widgets.dc.html", short: "dashboard",
         delivered: "dashboard.js \u2014 the twenty-four widget keys collected from the seventeen module pages and checked against 00-module-model \u00a76's count, the DD-2 span table, reflow() as a function run at 2 / 4 / 6 columns, the four layout scopes and the grant-filtered catalog; Dashboard and Widgets.dc.html draws all ten \u00a7C rows with a live dashboard you can arrange, hold to complete inside, and break one widget of",
         gate: "closed",
         gateNote: "Twelve checks pass, computed or measured: reflow is stable and order-preserving at all three widths, three sizes have three distinct footprints at each of them, all twenty-four keys agree with the module model module by module, the catalog is grant-filtered to 24 / 3 / 9 / 2 / 4 across five members, five widgets carry a write and none of them calls a dashboard endpoint, one failing widget leaves the rest untouched, the locked child layout renders zero arrange controls by measurement, and the stale key in the stored layout is dropped in silence." },
    11: { file: "Today and Cross-cutting Screens.dc.html", short: "spine",
         delivered: "spine.js \u2014 Today as todayFor(member, day) over the five DD-7 groups with a group dropped before it is drawn, the eight sources with the one that cannot be computed on the device, the Add sheet as a slow-window ranking with its rejected recency alternative run beside it, the nineteen search scopes collected from fifteen module pages with the line each came from, search() with grants and privacy applied to the scope list before anything is scored, and the help content model with its surface derived from the entry; Today and Cross-cutting Screens.dc.html draws thirty-three client layouts with a live search field \u2014 every state the five rows can reach, including the three the ledger records as unreachable nowhere else: search offline, the Add sheet in read-only, and a screen with no help authored for it",
         gate: "closed",
         gateNote: "Fifteen checks pass, computed or measured: four members give four different Today screens from one Wednesday and no block is ever drawn empty (counted in the DOM on the page), the five groups sort by function rather than by fixture order, every row names its module and targets it, seven of eight sources are client-expanded and the eighth admits its age, the slow window does not move on an unusual week while recency reorders four of six, cold start gives an owner six entries, one query searches nineteen scopes for Jana and two for Kl\u00e1ra \u2014 nine hits against one \u2014 with the ungranted scopes removed from the list before anything is scored, a private note is dropped for a non-owner off the scope list, and the help set uses all three surfaces with zero external links. The page loads this file too, so the exclusion mirror is compared where it is drawn rather than asserted \u2014 and coverage() diffs the drawn artifacts against each row's preset minus its own exclusions, which is the check that stops a row being recorded complete while a cell of it is undrawn: 6/6, 5/5, 8/8, 6/6, 3/3." },
    17: { file: "Garden.dc.html", short: "garden",
         delivered: "garden.js \u2014 D-65's three tiers as a read filter over one data model with the row counts walked in both directions, the pin snapped to two decimals with the metres it moves, FR-GA1's resolution order as one function with four consumers, the ~300-crop catalog's timings as offsets from the household's own frost dates with per-field provenance, household overrides run against a catalog version bump, the compatibility rules in three scopes with the crop-pair-beats-family-pair precedence, fourteen beds whose zone order is the adjacency model, 41 bed plantings across three seasons with occupancy windows, the task generator with its four hold-backs and a tombstone, drift that moves no planned window, the eleven checks computed on read with dismissal, disabling and the explicit no_history state, the season copy as a dry run that persists nothing, season close as the thing that creates rotation history, the storage log with no movements table, the frost warning as a condition, and the print stylesheet with Garden's two layouts measured in millimetres; seventeen screens drawn across eleven views",
         gate: "closed",
         gateNote: "Thirty-eight checks pass, computed: walking plot \u2192 beds \u2192 pots \u2192 beds \u2192 plot leaves the same seven row counts and changes only which of sixteen surfaces are revealed, the eleven checks return eighteen findings pointing at thirty-seven entities and block zero saves, C3 and C8 come back no_history against a household with no closed seasons, the 2027 dry run writes zero rows, closing 2026 takes the same dry run from two rotation findings to seven, the frost warning names six plantings in beds 3, 7 and 11 at \u22122 \u00b0C and draws nothing at all at six degrees, this month's work prints at 201,5 mm of 269 on A4 and fits US Letter too, and the print layer declares zero accent tokens and no non-grey colour. 237 states across 31 client rows, with twelve exclusions argued from two facts: the catalog is not household data, and everything a member touches in the garden is lww_field, state_set or additive." },
    18: { file: "Calendar.dc.html", short: "calendar",
         delivered: "calendar.js \u2014 the occurrence model as reminders.js's own RRULE plus the one row Stage 12 refused it (an exception per occurrence), the busy projection done once at sync-out with the nine fields it drops counted on the row a second device holds, the three-choice occurrence edit whose consequences are counts taken from the series, the client-default arithmetic that makes agenda the phone's view and month the web's, the who-overlay as a local filter over Stage 4's avatar colours, four remote connections over six remote calendars with direction and scope as independent axes and busy-only pre-selected on all four providers, the child profile with no connection surface at all, connection health with the staleness badge spending foundations.js's status-stale token, the external conflict that keeps the loser for thirty days, the disconnect question with both answers costed, the wall-clock recurrence across the end of summer time, and the fifteen calendar rows earlier stages had already drawn reconciled row by row; fourteen screens drawn across seven views",
         gate: "closed",
         gateNote: "Twenty checks pass, computed: Jana's private hour reaches Petr's phone as a five-field row with an id, an owner and an interval and none of the nine fields that would answer what it is \u2014 uninspectable from the data rather than from the UI, and offline-complete because the expansion runs on the device. A month grid on a 360 px phone gives 46 px a column against a 50 px time label at 100 % text and 100 px at 200 %, which is why agenda is the mobile default and month the web default and neither view is missing from either client. The three occurrence choices touch 1, 67 and 104 terms of one Pilates series and each says so. The 31st-of-the-month rent clamps to 30 September on reminders.js's own clamp rather than a second copy. Fifteen rows drawn by Stages 10, 11 and 12 all resolve here, three of them disagreeing \u2014 one prose fixture corrected, one twice-weekly recurrence that was right twice, and one row that belongs to the reminder strand, which is the Calendar-Reminders boundary being load-bearing. 99 cells across fourteen rows, with eighteen exclusions argued from four merge policies." },

    19: { file: "Property, Vehicles, Pets and Chat.dc.html", short: "assets",
         delivered: "assets.js \u2014 one asset engine keyed by (entity_type, entity_id) with three vocabularies over it and no word shared between them, FR-AS1's dual trigger as one function resolving interval, usage and whichever-comes-first with the estimate labelled and \u201cno reading yet\u201d as a state rather than a silent never, value_milli and Utilities' own monotonicity rejection reused verbatim, the grant resolved from entity_type in one place with every refusal a 404, D-71's partial fills computed between consecutive full fills against the naive answer, five country statutory presets from one first registration, the notice-period renewal, TCO with the window named per line, the bike field set with none of the three plate-shaped fields, and Pets as a tone audit that comes back at zero; chat.js \u2014 FR-CT2's floor and D-90's floor_seq counted on both delivery paths, desired-state reactions replayed against a toggle, the read marker merged as a maximum, three attachment states, and FR-CT7's custody transfer costed against the copy",
         gate: "closed",
         gateNote: "Thirty-nine checks pass, computed: fifteen labels over five engine screens with no two vocabularies sharing one and twenty-two asset words absent from every Pets string, the Octavia resolving on its date against an estimated crossing and Adam's bike on its distance from the same function, two full-to-full fuel intervals agreeing to 0.00 l/100 km against a naive answer 4.8 % out, two members ticking one dose resolving to one dose where (occurrence, member) would have said the dog had two tablets, Kl\u00e1ra's four visible messages identical on the API path and the sync predicate, and 1.11 GB moving out of the chat prefix with the household total unmoved. Three earlier-stage rows disagree with this module's arithmetic and are named rather than fixed." },

    12: { file: "Reminders and Tasks.dc.html", short: "reminders",
         delivered: "reminders.js \u2014 the twenty-one reminder kinds collected from the ten module pages with the line each came from and checked against 00-module-model \u00a76, the lead-time defaults derived from five classes, FR-RE2's recurrence expansion with its clamp and its cap run against a seven-case table, agendaFor() as the unified list, and the snooze/completion proof for D-43; tasks.js \u2014 the four starter templates, the column-kind vocabulary scanned for API words, the lexorank position merge replayed in both receive orders, the assignment refusal, and the resolver that hands due cards to the strand",
         gate: "closed",
         gateNote: "Twenty-one checks pass, computed or measured: six offline reorders converge in both receive orders with no dialog and one deterministic rebalance, every completion affordance has a keyboard path beside the 2000 ms hold, the twenty-one keys reconcile module by module, and 108 cells are drawn across twelve rows with sixteen exclusions each carrying its policy." },
    14: { file: "Chores, Activity and Notifications.dc.html", short: "chores",
         delivered: "chores.js \u2014 both recurrence rules implemented and run over one completion history so D-49 is counted rather than quoted, D-52 replayed in both receive orders, FR-CO4\u2019s skip asymmetry run on the fixture, the points ledger with an actor and a reason on every row, the grid\u2019s column arithmetic at 2 and 12 members and both text sizes, and Stage 12\u2019s open scope question answered from the assignment mode; activity.js \u2014 the module-declared action catalog rendered per reader in two languages from stored keys, FR-AL5\u2019s two redaction rules, five members\u2019 feeds computed from grants with the own-actions permission that ignores them, and the chore events derived from chores.js rather than authored twice; notify.js \u2014 twelve offers against the predicate space they replace, delivery resolved per recipient with a reason on every drop, digests whose bodies resolve per member, and the delivery log with its seven-day body retention",
         gate: "closed",
         gateNote: "Thirty-eight checks pass, computed: the hoover anchored on its last completion is one row against the stack a grid anchor would owe, two offline completions of one rotating chore converge on two rows, one award and one advancement in both receive orders, Adam\u2019s screens draw one balance and zero belonging to anybody else, one rule renders once and reaches its audience member by member with grant, mute, quiet hours and a live subscription each recorded as the reason it did not, and the month-end clamp is reminders.js\u2019s rather than a second copy. 151 cells across sixteen rows, with every exclusion argued from three facts \u2014 an occurrence is lww_field and a completion state_set, a two-party state machine refuses rather than forks, and neither the log nor a rule is a synced entity." },
    15: { file: "Utilities.dc.html", short: "utilities",
         delivered: "utilities.js \u2014 the eleven component types with a worked stretch each and a parameter audit that finds no expression field, the ordered engine (one rounding per component, time components pro-rata per calendar month \u00d7 version, taxes and discounts against a declared applies_to, the largest part taking the remainder), the three modes over six services, the cellar validator run against two different replicas, the rollover and the meter swap, advances attributed by month key, the period and its two boundary readings, the forecast whose facts stop at the last reading, headroom with zero consumption data, the settlement in money and units, bills-only with price-change detection, and the reading-due resolver reconciled with reminders.js and the dashboard widget; nineteen screens drawn across ten views",
         gate: "closed",
         gateNote: "Twenty-four checks pass, computed: eleven of eleven types priced with zero free-text parameters, a compounding tax expressed by ordering and applies_to alone, one estimated reading that reaches no money figure and one chart bar, a boundary with no reading that blocks with a date rather than a zero, a whole month that costs the monthly figure exactly and a year that costs twelve of them, a breakdown whose parts sum to the whole, and the balance landing on the dashboard widget\u2019s own figure." },
    16: { file: "Finance.dc.html", short: "finance",
         delivered: "finance.js — the allocation engine as ordered rules with home's locked formula reproduced to the crown, the three FR-FI7 invariants computed per earner and per source, the remainder rule that absorbs every rounded haléř with both refusals run, plan versions by effective period, the flow view as N-to-M with planned beside posted and the phone-fit arithmetic that chooses stage-major over node-major, the five split methods with the deterministic last minor unit and D-57's own €10 case read three ways, balances with the simplified set and the pairwise list, budgets projected on elapsed days, recurring with price history and the cancellation window reconciled with reminders.js, the import wizard with its dedup hash and member-authored rules, and the conflict resolver read from sync.js's own inbox entry; eighteen screens drawn across ten views",
         gate: "closed",
         gateNote: "Thirty checks pass, computed: home's six figures reproduced exactly by the generalised engine, income 68 400 = allocated 61 900 + remaining 6 500 landing on the dashboard widget's own figures, €10 three ways giving 3,34 / 3,33 / 3,33 in three different participant orders, a negative remainder shown as zero and kept in the data, last year unchanged when this year's percentages move, the flow view's widest unbreakable token 173 px at 200 % against 312 px of row while node-major needs 1 694, zero strings claiming the app moved money, balances netting to zero across three expenses and two settlements, no due subscription posted automatically, and the cancellation reminder landing on reminders.js's own date. 131 cells across eighteen rows with twelve exclusions." },
    13: { file: "Notes and Documents.dc.html", short: "notes",
         delivered: "notes.js \u2014 the 1 + N root scopes with the child exception computed from role and grant, both sibling-uniqueness indexes run on one tree, the resolver with its two 404 bodies compared as strings, language-aware search with the scope applied before matching, the two pin scopes de-duplicated, and the preserved loser with the days it has left; documents.js \u2014 eleven types with a derived lead and completion scope each, 38 documents, the four serving endpoints as a computed matrix, the offline upload across two devices, the reverse reference index, bulk operations and the meter reconciled with Settings \u00a75",
         gate: "closed",
         gateNote: "Twenty-five checks pass, computed: a renamed slug lands on a 404 that names the new address while the hidden-row body and the never-existed body are identical to the character, and the attachment row exists on the second device with the bytes still in a car park \u2014 preview answering 409 in words. 101 cells across fourteen rows, twelve exclusions argued from write-once bytes, a query being a read, and a measurement taken on the server." },
    6: { file: "Shells and Navigation.dc.html", short: "shells",
         delivered: "nav.js — both bars as finished layouts, the web sidebar, the app bar, per-member arrange, the household switcher, the four deep-link situations and the three within-module shapes, all derived from the fixture's grants",
         gate: "closed",
         gateNote: "Klára's app computes to three screens and reads as complete. The switcher, the sidebar and arrange declare the states their surfaces cannot reach; the fifteen cells they were short of — loading, error, withdrawn and read-only on all three, plus offline, pending and syncing on arrange — were drawn in Stage 20 and are recorded against that file." },

    20: { file: "Conformance and Walkthroughs.dc.html", short: "conformance",
         delivered: "conformance.js — the thirty-two cells four rows still owed drawn and credited to this file rather than back-dated, the route inventory collected from all eighteen module files and rendered in both themes as token arithmetic, the eighteen colour spends introduced after Stage 2 re-run against their minimum in both themes with the ones CI does not test named, forty strings in English, Czech and German measured against the tab slot, three sidebar widths, the state chip and the two-up button at both text sizes, the accent stack checked against every type step's line box, the tightest containers earlier stages measured re-run at 200 %, four shells' focus order with the twenty-eight registered icon labels, the 44 pt floor computed at two densities × two text sizes over eight control shapes, and the five persona walkthroughs as thirty-four steps each resolving to a built ledger row with the member's own grant checked against it",
         gate: "closed",
         gateNote: "Zero rows unbuilt, zero states undrawn, five walkthroughs clickable end to end. All thirteen checks pass. Two failed on the first run and both were one line in the token file, applied: four post-Stage-2 colour spends were status tokens used under their own name and were outside foundations.js's declared pair list, so CI tested the alias and not the name — all thirteen status names are now declared on all three grounds; and title-1's line box was 1,2 px short of the accent stack ď and ů need, which collided the moment a Czech or German screen title wrapped — its line-height is 1,22. The eleven decisions the sweep could not make are now taken and recorded row by row: Czech ships first, Please update is English, German, Czech, Polish and Slovak, search says it needs a connection, the reading cadence is per service and its date is whichever anchor falls sooner, the lead-time set stays with the two long defaults as custom, chores.due is household scope, the first-run dashboard is the proposed six, the subscription is priced in EUR everywhere, Finance balances name only members who hold Finance, and the tablet becomes a third client \u2014 which is the one answer that adds work rather than closing it." },
    21: { file: "Household Prototype.dc.html", short: "tablet",
         delivered: "surfaces.js, screens.js and the shell they feed \u2014 all 210 screens the eighteen module files declare collected into one registry and routed to inside a single application, each rendering its own declared title, lede, fields, notice, actions and per-state copy; the fifteen modules with a live body drawing their real rows under that chrome; the twelve states switched from the rail on every surface rather than redrawn; the entitlement table and three locales driving the same element tree; and the tablet drawn as its own client at 834 px with the tab bar of a phone and the two panes of a desktop",
         gate: "closed",
         gateNote: "All 210 declared screens are reachable by clicking, each from the module file that declares it, and each screen's own words are what the rail's twelve states switch between. All twenty-four tablet rows are drawn: eighteen are the shell itself, and the six that are layouts of their own \u2014 dashboard arrange on four columns, per-member arrange in two, the weekly grid without its pivot, month, week and the flow view read node-major \u2014 are built in the application from the same fixtures their stage artifacts measure, each stating what the tablet reading changes and what it costs at 200 % text. What still lives only in a stage artifact is the bespoke body of a screen no client argues about \u2014 the eleven tariff component types among them; every such screen links to the artifact that draws and measures it. Print targets and the two client-neutral components the tablet touches are excluded by the rule the ledger already uses." },
    22: { file: "Household Prototype.dc.html", short: "bodies",
         delivered: "screenbodies.js — a body per route rather than a body per module. Stage 21 routed all 210 declared screens but answered 146 of them with their module's default list, so a module replied the same way on every one of its routes. 146 of the 210 now have a body written against their own module file, and the other 64 are answered per route by the four route-aware modules — Shopping, the dashboard, the account path and the platform surfaces — by nav and sync through surfaces.js, or are a module's own root list, which is the body it should have.",
         gate: "closed",
         gateNote: "No module answers the same way on two of its routes. The bodies read the same HH_TASKS, HH_GARDEN and HH_ASSETS the stage artifacts are measured with, so the flow view, the tariff composer and the weekly grid are in the application rather than only in their artifact. This stage adds no ledger row: it redraws bodies for rows Stage 21 already counted, which is why its row count is nil and its gate is the drawing rather than the count." },
    23: { file: "Conformance and Walkthroughs.dc.html", short: "words",
         delivered: "screencopy.js and four measured checks. 64 screens could reach a state they had no sentence for, so 152 cells fell through to the shell's generic wording: all 152 are authored against their own screen, in English and Czech. All 210 declared screens gain a Czech and a German title, and every screen whose module file wrote an English lede gains a Czech one, so the rail's locale switch changes the screen rather than the frame around it. The fourteen requirement gaps are settled — eleven sentences, two enumerated catalogs, one number — each recorded next to the screen that raised it.",
         gate: "closed",
         gateNote: "The four new checks read the application rather than the ledger's own flags, which is the point of them: built and drawn are authored data, and a coverage check that reads them proves only that the file agrees with itself. Measured on what the code returns: 210 of 210 routes resolve to a body, none of them equal to another's, and 903 of 903 required state cells resolve to words the screen authored. Eighteen checks, all passing." }
  };

  /* Per source row: which of its required states are drawn today.
     "all" means the row's whole preset. Anything less keeps its stage open. */
  var DELIVERED = {
    "A-1": "all", "A-2": "all", "A-3": "all", "A-4": "all", "A-5": "all", "A-6": "all",
    "A-7": "all", "A-8": "all", "A-9": "all", "A-10": "all", "A-11": "all",
    "A-12": ["loading", "empty", "populated", "error", "offline", "pending", "syncing", "readonly"],
    "A-13": "all", "A-14": "all", "A-15": "all", "A-16": "all", "A-17": "all", "A-18": "all",
    "A-19": ["loading", "empty", "populated", "error", "offline", "pending", "syncing", "readonly"],
    "A-20": "all", "A-21": "all",
    "A-22": "all",
    "A-23": ["loading", "empty", "populated", "error", "offline", "absent", "withdrawn", "readonly"],
    "A-24": "all", "A-25": "all", "A-26": "all", "A-27": "all",
    "A-28": ["loading", "empty", "populated", "error", "offline", "absent", "readonly"],
    "A-29": "all", "A-30": "all", "A-31": "all",
    "A-32": ["loading", "empty", "populated", "error", "offline", "pending", "syncing", "absent", "readonly"],
    "A-33": "all",
    "A-34": ["loading", "populated", "error", "offline", "absent", "readonly"],
    "A-35": ["loading", "empty", "populated", "error", "offline", "syncing", "absent", "readonly"],
    "A-36": ["populated", "offline", "absent"],
    "A-37": "all",
    "B-1": "all", "B-2": "all", "B-3": "all", "B-4": "all",
    "B-5": "all", "B-6": "all", "B-7": "all", "B-8": "all",
    "C-1": "all", "C-2": "all", "C-3": "all", "C-4": "all", "C-5": "all",
    "C-6": "all", "C-7": "all", "C-8": "all", "C-9": "all", "C-10": "all",
    "C-11": "all", "C-12": "all", "C-13": "all", "C-14": "all", "C-15": "all",
    "C-16": "all", "C-17": "all", "C-18": "all", "C-19": "all", "C-20": "all",
    "C-21": "all", "C-22": "all",
    "C-23": "all", "C-24": "all", "C-25": "all", "C-26": "all", "C-27": "all",
    "C-28": "all", "C-29": "all", "C-30": "all", "C-31": "all", "C-32": "all",
    "C-33": "all", "C-34": "all", "C-35": "all",
    "C-36": "all", "C-37": "all", "C-38": "all", "C-39": "all", "C-40": "all",
    "C-41": "all", "C-42": "all", "C-43": "all", "C-44": "all",
    "C-45": "all", "C-46": "all", "C-47": "all", "C-48": "all",
    "C-52": "all", "C-53": "all", "C-58": "all",
    "D-1": "all", "D-2": "all", "D-3": "all", "D-4": "all", "D-5": "all",
    "D-6": "all", "D-7": "all", "D-8": "all", "D-9": "all", "D-10": "all",
    "D-11": "all", "D-12": "all", "D-13": "all", "D-14": "all", "D-15": "all",
    "D-16": "all", "D-17": "all", "D-18": "all", "D-19": "all",
    "D-20": "all", "D-21": "all", "D-22": "all", "D-23": "all", "D-24": "all",
    "D-25": "all", "D-26": "all", "D-27": "all", "D-28": "all", "D-29": "all",
    "D-30": "all", "D-31": "all", "D-32": "all", "D-33": "all", "D-34": "all",
    "D-35": "all", "D-36": "all", "D-37": "all",
    "D-38": "all", "D-39": "all", "D-40": "all", "D-41": "all", "D-42": "all",
    "D-43": "all", "D-44": "all", "D-45": "all", "D-46": "all", "D-47": "all",
    "D-48": "all", "D-49": "all", "D-50": "all", "D-51": "all", "D-52": "all",
    "D-53": "all", "D-54": "all",
    "E-1": "all", "E-2": "all", "E-3": "all", "E-4": "all", "E-5": "all",
    "E-6": "all", "E-7": "all", "E-8": "all", "E-9": "all", "E-10": "all",
    "E-11": "all", "E-12": "all", "E-13": "all", "E-14": "all",
    "E-15": "all", "E-16": "all", "E-17": "all", "E-18": "all", "E-19": "all",
    "E-20": "all", "E-21": "all", "E-22": "all", "E-23": "all", "E-24": "all",
    "E-25": "all", "E-26": "all", "E-27": "all", "E-28": "all", "E-29": "all",
    "E-30": "all", "E-31": "all", "E-32": "all", "E-33": "all", "E-34": "all",
    "E-35": "all", "E-36": "all", "E-37": "all", "E-38": "all", "E-39": "all",
    "E-40": "all", "E-41": "all", "E-42": "all",
    "F-1": "all", "F-2": "all", "F-3": "all", "F-4": "all", "F-19": "all",
    "F-5": ["populated", "empty", "offline", "conflicted", "rejected"],
    "F-6": "all", "F-7": "all", "F-8": "all", "F-9": "all", "F-10": "all",
    "F-11": "all", "F-12": "all",
    "F-13": ["populated", "empty", "offline", "absent"],
    "F-14": "all",
    "F-15": ["populated", "empty", "absent"],
    "F-16": "all", "F-17": "all", "F-18": "all",
    "F-20": ["loading", "populated", "error", "offline", "pending", "syncing", "rejected", "absent", "readonly"],
    "C-49": ["loading", "populated", "error", "offline", "pending", "syncing", "conflicted", "rejected", "withdrawn", "readonly"],
    "C-50": ["loading", "empty", "populated", "error", "offline", "absent", "withdrawn", "readonly"],
    "C-51": ["loading", "populated", "error", "offline", "pending", "syncing", "rejected", "withdrawn", "readonly"],
    "C-54": ["loading", "empty", "populated", "error", "offline", "absent", "readonly"],
    "C-55": ["loading", "empty", "populated", "error", "offline", "absent", "readonly"],
    "C-56": ["loading", "populated", "error", "offline", "absent", "withdrawn", "readonly"],
    "C-57": ["loading", "populated", "error", "offline", "absent", "readonly"]
  };

  /* Stage 20's late delivery. Four rows were still short when Stage 19 closed, and
     the cells were drawn in the conformance stage rather than back-dated into the
     stages that owed them. A row records BOTH: the states its own stage drew, and
     the states this file's Stage 20 artifact drew, with the file named. Without
     this the ledger would report Stage 5 closed on work Stage 5 never did. */
  var LATE = {
    "F-5": { states: ["loading", "error", "readonly"], stage: 20 },
    "A-36": { states: ["loading", "error", "withdrawn", "readonly"], stage: 20 },
    "F-13": { states: ["loading", "error", "withdrawn", "readonly"], stage: 20 },
    "F-15": { states: ["loading", "error", "offline", "pending", "syncing", "withdrawn", "readonly"], stage: 20 }
  };

  /* ── aliases ───────────────────────────────────────────────────────────
     05-screens enumerates two rows that are one surface, so the ledger carries
     both ids and neither is unrouted: the row names the route it is reached on
     and the row it duplicates. Counting stays as it is — an alias is a second
     reading of a screen, not a second screen — and the application declares the
     route once, in the file that owns it. */
  var ALIAS = {
    "C-55": { of: "A-28", route: "/households/tilcerovi/settings/billing",
              why: "§C §6 Billing and §A row 28 Manage billing are the same screen reached two ways. household.js declares it once, as A-28, on this route; the settings section links into it." }
  };

  var SRC = { A: A, B: B, C: C, D: D, E: E, F: F };
  var rows = [];
  Object.keys(SRC).forEach(function (g) {
    SRC[g].forEach(function (t, i) {
      var n = i + 1;
      var clients = t[2] === "b" ? ["b"] : t[2].split("");
      var ex = EXCLUSIONS[g + "-" + n] || {};
      var exKeys = Object.keys(ex);
      var states = PRESETS[t[3]].filter(function (s) { return exKeys.indexOf(s) < 0; });
      var d = DELIVERED[g + "-" + n];
      var drawn = d === "all" ? states.slice() : (d || []).filter(function (s) { return states.indexOf(s) >= 0; });
      var lt = LATE[g + "-" + n];
      var late = lt ? lt.states.filter(function (s) { return states.indexOf(s) >= 0 && drawn.indexOf(s) < 0; }) : [];
      drawn = drawn.concat(late);
      var art = ARTIFACTS[t[1]];
      var lateArt = lt ? ARTIFACTS[lt.stage] : null;
      var tab = TABLET[g + "-" + n];
      var alias = ALIAS[g + "-" + n] || null;
      if (tab && clients.indexOf("t") < 0 && clients.indexOf("b") < 0) clients = clients.concat(["t"]);
      clients.forEach(function (c) {
        var isTab = c === "t";
        var tabDrawn = isTab ? (tab && tab.drawn ? states.slice() : []) : null;
        rows.push({
          id: g + "-" + n + "-" + c,
          group: g,
          n: n,
          client: c,
          name: t[0] + (isTab ? " — tablet" : ""),
          stage: isTab ? 21 : t[1],
          tabletWhy: isTab && tab ? tab.why : "",
          alias: alias ? alias.of : "",
          aliasRoute: alias ? alias.route : "",
          aliasWhy: alias ? alias.why : "",
          states: states,
          preset: t[3],
          excluded: exKeys,
          exclusions: ex,
          module: t[4],
          risk: t[5] || "",
          kind: t[6] || "screen",
          priority: GROUPS[g][1],
          src: GROUPS[g][2],
          built: (isTab ? tabDrawn.length : drawn.length) === states.length,
          partial: isTab
            ? (tabDrawn.length > 0 && tabDrawn.length < states.length)
            : (drawn.length > 0 && drawn.length < states.length),
          drawn: isTab ? tabDrawn : drawn,
          late: isTab ? [] : late,
          lateStage: !isTab && late.length && lt ? lt.stage : null,
          lateBy: !isTab && late.length && lateArt ? lateArt.file : "",
          by: isTab
            ? (tabDrawn.length ? (ARTIFACTS[21] ? ARTIFACTS[21].file : "") : "")
            : (drawn.length ? (art ? art.file : "") : "")
        });
      });
    });
  });

  /* ── stage status, computed from the rows and the artifacts ─────────── */

  function stageStatus() {
    return STAGES.map(function (st) {
      var rs = rows.filter(function (r) { return r.stage === st[0]; });
      var built = rs.filter(function (r) { return r.built; }).length;
      var partial = rs.filter(function (r) { return r.partial; }).length;
      var req = rs.reduce(function (a, r) { return a + r.states.length; }, 0);
      var drawn = rs.reduce(function (a, r) { return a + r.drawn.length; }, 0);
      var lateCells = rs.reduce(function (a, r) { return a + (r.late ? r.late.length : 0); }, 0);
      var art = ARTIFACTS[st[0]] || null;
      var remainder = rs.filter(function (r) { return !r.built; }).map(function (r) {
        return r.id + " — " + r.name + " · " + r.drawn.length + " of " + r.states.length + " states";
      });
      var status = !art ? "not started"
        : (rs.length === 0 ? "delivered" : (built === rs.length ? "closed" : "open"));
      return {
        num: st[0], name: st[1], sort: st[2],
        rows: rs.length, built: built, partial: partial,
        reqStates: req, drawnStates: drawn, lateCells: lateCells,
        lateBy: lateCells ? (rs.filter(function (r) { return r.lateBy; })[0] || {}).lateBy : "",
        pct: req ? Math.round((drawn / req) * 100) : (art ? 100 : 0),
        artifact: art, status: status, remainder: remainder
      };
    });
  }

  var GAPS = [
    ["The tablet is drawn as the wide reading of the mobile shell, and nothing says it is",
     "06-clients names two clients, mobile and web. Miloš is on a tablet in every persona document and in Stage 20's own walkthrough, where his shell is drawn as the mobile one at a wide reading — four tab slots, two panes of content. That is a decision Stage 20 had to make to draw the walkthrough at all, and it is the last undocumented client shape in the set. It belongs in 06-clients or in a decision record; a tablet that resolves to the web shell instead would change his tab bar, his arrange screen and his Garden layout.",
     "settled · Stage 21 · 24 rows declared, 24 drawn"],
    ["Finance's balances name people who cannot see them, and the module's own conflict cannot happen here",
     "FR-FI25 closes Finance by default and D-59 argues it well, so in this household exactly one member of five holds the module. Two consequences fall out and neither is stated anywhere: the balances screen names three people and two of them cannot open it, so a settle-up is a debt the debtor is never shown; and Stage 5's conflict inbox attributes a Finance edit to Petr, who holds none here, so a two-party Finance conflict — the case the module exists to demonstrate — is not something this fixture can produce. Stage 16 draws the resolver as Stage 5 wrote it and records the contradiction rather than quietly regranting Petr or rewriting the inbox.",
     "settled · a share may only name a member who holds Finance"],
    ["Two different things are called a period",
     "FR-FI2's income period is a month by default and may be fortnightly or weekly; FR-FI17's budget period is whatever the household sets, and this household's runs from payday, 15 August to 14 September. The finance.period widget says ‘this period’ and the module has two. Stage 16 uses the income month for the headline and the budget period for the budgets, and draws both with their dates on the screen, because the projection is meaningless without them.",
     "settled · the income month heads the screen, the budget period runs the budgets, and neither is ever called ‘this period’ without its dates"],
    ["‘Normalised description’ is the whole of the dedup check and is defined nowhere",
     "FR-FI19 dedupes on a hash of (account, date, amount, normalised description) plus the bank's own reference. Stage 16 implements normalisation as fold diacritics, lowercase, strip punctuation, collapse whitespace — which makes KAVARNA PLACHTA and ‘Kavárna Plachta ’ the same key, correctly. But two banks export the same payment with different merchant strings, and a stricter or looser rule changes how many rows a member is asked about. It needs a sentence, and probably a test fixture.",
     "settled · fold diacritics, lowercase, strip punctuation, collapse whitespace — and nothing further: a differing bank reference always asks"],
    ["The adjustment split does not say when the last minor unit is assigned",
     "FR-FI12 defines adjustment as a base equal split plus per-person adjustments, and D-57 makes the last minor unit deterministic. Whether the remainder is distributed before or after the adjustments changes who pays the extra haléř. Stage 16 subtracts the adjustments first, splits what is left, then adds them back — so the odd unit follows the equal part — and states it on the preview.",
     "settled · adjustments out first, the remainder falls on the equal part, and the preview says so"],
    ["FR-UT9 blocks on a price change inside a stretch and says nothing about a conversion change",
     "A meter conversion is a first-class versioned object (D-63) with an effective date, exactly like a tariff \u2014 and gas conversions do change, twice in this fixture. FR-UT9 refuses to price a stretch containing a tariff effective_from, but no requirement says what to do when the volume correction or the calorific value changes mid-stretch. Stage 15 prices it with the conversion effective at the stretch\u2019s end and computes what the alternative costs: over the current gas period a single hard-coded factor is out by 55 kWh. Either conversions block like tariffs or the rule is stated.",
     "settled \u00b7 a conversion change blocks a stretch exactly as a tariff change does"],
    ["utilities.reading_due has two possible anchors and the handoff quietly uses both",
     "The dashboard\u2019s readings_due widget is specified as \u201coverdue relative to the household\u2019s chosen cadence\u201d \u2014 last reading plus a cadence \u2014 while the reminder kind resolves through FR-RM1 to a date the module supplies, and reminders.js carries the two dates a monthly rule would produce. Stage 15 implements both, because they answer different questions, and draws both: electricity is 4 days over its cadence and due on the 11th by the rule. If the two must agree, one of them has to change.",
     "settled \u00b7 whichever of the two falls sooner, and the row says which"],
    ["Nowhere in the handoff does the household choose its reading cadence",
     "The widget measures against \u201cthe household\u2019s chosen cadence\u201d and no screen offers the choice, no field carries it, and 10-utilities\u2019 data model has no column for it. Stage 15 puts a cadence on the service (31 days for both meters, 61 for the garden sub-meter, 183 for water) because the overdue count cannot exist without one, and setup step 4 is where it would be asked. It needs a field and a sentence.",
     "settled \u00b7 per service, set next to the meter on service detail"],
    ["The 24 widget keys — resolved, and where they were",
     "They are enumerated, just not in one place: each of the seventeen module pages names its own in Catalog contributions, and 00-module-model \u00a76 carries the per-module count that sums to 24 and that the catalog registry is asserted against. dashboard.js collects all twenty-four with the line each came from, and keyAudit() checks the collection against that table module by module. What the handoff lacks is one page listing them \u2014 a filing job, not a decision.",
     "resolved in Stage 10"],
    ["default_size and the minimum grant are stated for none of the 24 widgets",
     "FR-DB1 requires every catalog entry to carry a default_size and the minimum grant it requires, and no module page states either. Stage 10 assigns sizes on one rule \u2014 small for a count, medium for a short list, large for a grid or a comparison that needs the width, which comes out eight / twelve / four \u2014 and takes the grant from the standard gate: view on the owning module to see a widget, contribute to use its action, so under view the action is absent rather than greyed. Both need a line per module before the registry can assert anything.",
     "settled · size from the shape of the content (8 small / 12 medium / 4 large), grant from the standard gate: view to see it, contribute to act in it"],
    ["What the household default layout contains is unspecified",
     "FR-DB4 exists because a first run is otherwise seventeen widgets nobody chose, but no document says which widgets a new household starts with. Stage 10 proposes six, all from modules with no substantial setup so that none is empty on day two. The child default's contents and the age threshold below which locked is the default (FR-DB5) are unstated for the same reason.",
     "settled · the six proposed, all from modules with no setup of their own"],
    ["Second language: German in the handoff, Czech in the plan",
     "05-screens and 07-delivery §2/§3 both require \"English and German\". The implementation plan proposed Czech spot-checks. One of the two is wrong and every Stage 20 sweep depends on which. Stage 20 answered the half a measurement can answer: German is the longer of the two on most of the forty strings swept, so the layout is run against German as the upper bound and holds either way. Which language the copy is written in is still a decision.",
     "settled · Czech ships first; German stays the length test"],
    ["The 21 reminder kinds \u2014 resolved, and where they were",
     "Collected in Stage 12 the way Stage 10 collected the widget keys: ten module pages name their own under Catalog contributions \u2014 tasks 1, calendar 1, chores 1, documents 1, finance 2, utilities 3, garden 2, property 3, vehicles 4, pets 3 \u2014 and 00-module-model \u00a76 carries the per-module count that sums to 21 and that the registry is asserted against. reminders.js holds all twenty-one with the line each came from and kindAudit() reconciles them module by module. One correction falls out of the collection: with the module\u2019s own standalone reminders the subscriptions screen is 22 rows, not the 21 \u00a7C names.",
     "resolved in Stage 12"],
    ["Completion scope is stated for five kinds of twenty-two",
     "FR-RE8 makes completion scope a property of the kind, declared by the module that registers it \u2014 and four module pages do (tasks.card_due personal, chores.due personal, documents.expiry per type, calendar.event per participant set), plus the Reminders module\u2019s own as a column. The other seventeen are decided in Stage 12 from what the obligation is, and a wrong one is a household that believes the boiler was serviced. Each needs a word on its own module page.",
     "settled · scope follows the obligation: household where finishing it finishes it for everybody, personal where it is each member's own"],
    ["The offered lead-time set stops at three months; two stated defaults are longer",
     "FR-RM2 defines the set as 0d / 1d / 3d / 1w / 2w / 1m / 3m or a custom number of days, and 08-documents defaults a passport to six months while a supply contract runs to three. Stage 12 derives the defaults from five classes and finds that the notice and renewal kinds land outside the presets as a matter of course, so \u201ccustom\u201d is the ordinary path on that screen rather than an edge case. Either the set gains a longer preset or the control is designed around the custom field.",
     "settled \u00b7 the set stays and the two long defaults show as custom"],
    ["A personal-completion chore still reminds everybody else",
     "06-chores registers chores.due with personal completion, and FR-RE8 makes that the kind\u2019s property. So when Adam completes the bins, Adam\u2019s reminder clears and every other subscriber is still told about a chore that is done. Either the kind is household scope with the rotation deciding whose row it is, or the strand has to read the source entity\u2019s own completion. Stage 12 draws what the kind declares and records the question rather than quietly picking.",
     "settled \u00b7 chores.due is household scope, the rotation names the owner"],
    ["Is a child\u2019s private root searchable by the owner who may read it?",
     "FR-NO4 lets an owner read a child\u2019s private root and requires the child to be told at profile creation. FR-NO7 says private notes are excluded from a non-owner\u2019s q= matching entirely. The two sentences do not meet: nobody says whether the exception reaches search. Stage 13 decides it does not \u2014 the root is navigable, deliberately and visibly, and never folded into a query \u2014 because a search box that mixes a child\u2019s diary into a recipe search is supervision turning into surveillance. It is a design decision standing in for a requirement.",
     "settled \u00b7 it does not: the root is navigable, deliberately and visibly, and never folded into a query"],
    ["An inline image the preserved loser still references",
     "FR-NO9 deletes a note\u2019s images when the note is hard-deleted and counts them on the meter meanwhile. FR-NO10 keeps the overwritten body for thirty days. Nothing says what happens to an image that only the preserved loser references: it is billed for thirty days and then, on the nightly prune, either collected or orphaned. Stage 13 counts it on the meter and flags the prune as unspecified.",
     "settled · counted on the meter for the thirty days, then collected by the prune when the preserved body expires"],
    ["The document type catalog is country-aware and enumerated nowhere",
     "FR-DO7 names eleven types, calls the catalog translated and country-aware, and states two lead times \u2014 six months for a passport, one for an insurance policy. The other nine leads, all eleven completion scopes and every per-country vocabulary are unstated, and the reminder the feature exists for cannot fire without them. documents.js derives the nine from one question (how long does replacing it take) and takes the scopes from whether the thing belongs to a member or to the household; both need a line per type, and the CZ column needs a translator rather than a designer.",
     "settled \u00b7 one table, a column per country \u2014 the printed word and an optional lead override; CZ and DE are written in documents.js"],
    ["FR-DO11 does not say what a zip does with bytes that have not arrived",
     "A member selects two hundred files the morning after uploading them and one is still pending (\u00a72.7). Download-as-zip either waits, fails, or quietly produces an archive with one fewer file in it. Stage 13 leaves it out by name and offers the wait, because a silently short archive is discovered a year later \u2014 but the requirement should say so, and the same question applies to a derived-variant failure.",
     "settled · the pending file is left out by name and the wait is offered; an archive is never silently short"],
    ["FR-TA9 does not say who can be mentioned",
     "FR-TA5 excludes a member with none on Tasks from the assignee picker and refuses the assignment with a named reason. FR-TA9 says a mention notifies in the direct category and says nothing about the same case \u2014 a notification about a card the recipient cannot open. Stage 12 applies FR-TA5\u2019s rule to the mention picker, which is a design decision standing in for a requirement.",
     "settled · FR-TA5's rule reaches the mention picker: only a member who can open the card can be mentioned"],
    ["The five accent families are named but not listed",
     "Resolved in Stage 2. foundations.js now holds both halves as data: FAMILIES (time, money, things, keeping, household, plus Garden outside the five, DD-1) and ACCENT_MAP, seventeen module keys resolving to those six values. Every module-to-family assignment is read from there rather than restated.",
     "resolved in Stage 2"],
    ["The twelve-state preset — settled, and what it leaves",
     "Settled in Stage 8: one D preset stays, and a row declares the states its own surface cannot reach, each with the reason, next to the screen that argues them — EXCLUSIONS above mirrors them for coverage and mismatches() checks the mirror against the stage files. With that applied, Stage 7 closes and Stage 8 is drawn in full. What remains is not an argument but eighteen undrawn cells on four rows: F-5 (loading, error, read-only), A-36 (loading, empty is excluded, error, withdrawn, read-only), F-13 (loading, error, withdrawn, read-only) and F-15 (loading, error, offline, pending, syncing, withdrawn, read-only). All eighteen were drawn in Stage 20 and are recorded against that file, which closes Stages 5 and 6.",
     "resolved in Stage 20 · 18 cells drawn"],
    ["FR-SH3's comma split divides FR-SH2's own example item",
     "FR-SH3 splits a quick-add line on commas; FR-SH2 illustrates a single item's text as \u201c2 % milk, the big carton\u201d. Stage 9 guards the cs-CZ half in the parser \u2014 a comma directly followed by a digit is a decimal comma, so 1,5 l stays one item, and a number followed by % is not a quantity \u2014 and resolves the rest in the interface: three items are added with no decision, and the undo toast offers \u201ckeep as one\u201d for the length of the window. Which of the two examples wins still needs a sentence in the requirement.",
     "settled · FR-SH3 wins; FR-SH2's illustration is the line that changes, and undo offers ‘keep as one’"],
    ["The Shopping category catalog is not enumerated",
     "FR-SH2 assigns a category from \u201ca translated catalog of common items\u201d and FR-SH6 orders the household's shop by it, but no document lists the categories or the keyword mapping. shopping.js seeds eight to draw the walking order; the real list is content work in five languages with the same lead time as the empty-state copy. FR-SH7's staple thresholds and the set of recurring cadences are unstated for the same reason.",
     "settled · fourteen categories with cs and de aisle words and a keyword list per language, in shopping.js"],
    ["The CZK and PLN subscription prices are never stated",
     "04-billing \u00a71 names the EUR and GBP figures and says CZK and PLN are set on the same basis \u2014 local anchors, not FX conversion \u2014 without giving them. The fixture household counts in CZK, so subscribe, manage billing and take-over all show a figure the handoff does not contain. Stage 8 draws the EUR figures and marks the CZK row unnamed rather than inventing one.",
     "settled · the subscription is priced and billed in EUR in every market"],
    ["Two different seventeens — settled",
     "FR-AC3 wins. The seventeen grantable modules are its seventeen, with Household settings under the key admin that foundations.js and icons.js already used; Today is not one of them but a cross-cutting screen with a route, a tab slot and nothing to grant. fixtures.js was corrected, nav.js treats Dashboard alone as the platform destination inside the module list, and every count on every screen is computed from the corrected list: sixteen modules can be enabled, seventeen can be granted, nineteen have a navigation icon.",
     "resolved in Stage 8"],
    ["Account-scoped surfaces carry the household twelve-state preset — settled",
     "Sessions and devices (A-12) and Account settings (A-19) are per-user: absent, withdrawn, conflicted and rejected cannot occur on either. Both rows now declare those four in auth.js with a reason each, and both are drawn in all eight states that remain, so Stage 7 closes.",
     "resolved in Stage 8"],
    ["The five languages of Please update are never named",
     "05-screens §A row 21 asks for the update wall in five languages. Across the whole handoff three are named — English, German, and the plan's Czech — and the fourth and fifth never are. Stage 7 drew the three and left two placeholders rather than inventing markets. Every later module's string work inherits the answer.",
     "settled \u00b7 Polish and Slovak; all five drawn in auth.js"],
    ["Household settings §6 Billing is enumerated twice",
     "C-55 (Settings §6) and A-27 to A-29 (Subscribe / Manage / Take over) are the same surface reached two ways. Both ids stay in the ledger and C-55 carries an alias to A-28's route, so the duplicate is visible rather than silent and neither id reads as an unrouted screen; the application declares the route once, in household.js, and Stage 8 draws A-28 as the settings §6 screen.",
     "resolved by convention"],
    ["Nothing says whether global search works offline",
     "FR-SE2 builds the index as a PostgreSQL tsvector, so search is a server read \u2014 but 03-patterns \u00a71 requires reads to be indistinguishable offline. Either the client searches its own replica, with an honesty line about what it can reach, or the field states plainly that search needs a connection. Stage 11 draws the second and marks it as a proposal: F-1's offline drawing is guessing until this is answered.",
     "settled \u00b7 the field says search needs a connection"],
    ["\u201cEvery module\u201d contributes a search scope; fifteen module pages do",
     "00-module-model \u00a74 lists global search as an integration for every module, and \u00a76's counts are what the catalog registry is asserted against. Fifteen pages declare a scope, nineteen keys between them; Dashboard and Household settings declare none and own no searchable text, so the claim is probably loose rather than wrong \u2014 but the registry assertion needs the real number. spine.js collects all nineteen with the line each came from.",
     "settled · nineteen keys across fifteen of seventeen modules; scopeAudit() is the assertion and the two silent ones own no searchable text"],
    ["What the Add sheet shows a member who holds contribute nowhere",
     "DD-8's cold-start set is drawn from module enablement and the member's contribute grants, so a member with view everywhere ranks nothing at all \u2014 and \u00a71 settles the five mobile destinations, which is what made the tab look unremovable. Of the five fixture members only Jana can fill six slots. Stage 11 drew the sheet short rather than padded and drew the nothing-to-add case as F-4's permission-absent state. Settled: there is no sheet to draw. A member who can create nothing has no Add tab, and the bar re-solves to four slots the way it does without Chat \u2014 absence rather than a surface whose whole content is a refusal. nav.js computes the tab from the member's contribute grants, and all five fixture members hold contribute somewhere, so the four-slot bar in this household is still the one without Chat.",
     "settled \u00b7 no Add tab for that member, and the bar drops to four"],
    ["Print targets are client-neutral",
     "The three print layouts and the print stylesheet are one deliverable each, not one per client, so they do not double in the count.",
     "resolved by convention"]
  ];

  window.HH_LEDGER = {
    version: "1.0-frozen",
    late: LATE,
    aliases: ALIAS,
    states: STATES,
    stateWord: stateWord,
    stages: STAGES,
    groups: GROUPS,
    rows: rows,
    exclusions: EXCLUSIONS,
    mismatches: mismatches,
    gaps: GAPS,
    artifacts: ARTIFACTS,
    stageStatus: stageStatus,
    estimate: 330
  };
})();
