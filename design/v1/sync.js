/* Household — stage 5: the sync, conflict and honesty vocabulary.
   03-patterns §1 (offline and sync, and which changes ask), §2 (retraction),
   §12 (honesty about computed numbers); 02-components §4.2 (sync state mark),
   §4.3 (conflict resolver, DD-4), §4.4 (rejected-mutation resolver).

   The stage gate is one sentence: the five merge policies must read as
   different categories of event, not five severities of one. That is checkable
   rather than felt, so the shapes are data here and the checks below count
   them: five policies collapse onto four visible shapes, and a policy's shape
   is a category (silent · admission · preserved loser · question), never a
   position on a severity ladder. Nothing in this file is a screen. */
(function () {

  var ICONS = window.HH_ICONS || { byId: {} };

  function mark(id, note) {
    var i = ICONS.byId[id] || {};
    return { id: id, word: i.word || id, token: i.token || "text-muted", paths: i.paths || [], stroke: i.stroke || 2, note: note || "" };
  }

  /* ── 1. the ladder: what the member sees, in order of how loud it is ─── */

  var LADDER = [
    {
      key: "synced", name: "Online, synced", ref: "03-patterns §1",
      sees: "Nothing. The absence of an indicator is the indicator.",
      rule: "There is no green tick on every row. A mark that appears on everything says nothing about anything.",
      bar: false, mark: null, editable: true
    },
    {
      key: "offline", name: "Offline", ref: "02-components §2",
      sees: "A persistent, unobtrusive bar. The read below it is identical to the online read.",
      rule: "It never blocks content and it never covers an action. Offline is not an error state, so it is not drawn as one.",
      bar: true, mark: null, editable: true
    },
    {
      key: "pending", name: "Pending", ref: "03-patterns §1",
      sees: "The row carries a quiet mark and stays fully editable — an edit merges into the queued mutation.",
      rule: "It must not read as a fault. The write is safe; it is simply still here.",
      bar: false, mark: mark("pending", "still editable"), editable: true, affordance: "Edit"
    },
    {
      key: "syncing", name: "Syncing", ref: "06-clients §5",
      sees: "A progress indication, and only past 800 ms. Below the threshold nothing is shown at all.",
      rule: "Most writes never reach this state. Drawing it for every write would make the app look slower than it is.",
      bar: false, mark: mark("syncing", "since 18:41"), editable: true, threshold: "800 ms"
    },
    {
      key: "resnapshot", name: "Re-snapshot needed", ref: "01-foundations §8",
      sees: "Handled silently. When it takes long enough to notice, it is shown as syncing.",
      rule: "No token, no icon, no word of its own — it adds no fourteenth status. This row is here to record that it was considered and deliberately not drawn.",
      bar: false, mark: mark("syncing", "same mark, same word"), editable: true, borrows: "syncing"
    },
    {
      key: "conflict", name: "Conflict", ref: "02-components §4.3 · DD-4",
      sees: "The row is flagged and tappable. It opens a plain comparison: both values, both authors, both times.",
      rule: "A flag plus an inbox entry, never a modal at reconnect. Nothing auto-resolves and nothing ages out.",
      bar: false, mark: mark("conflict", "two authors"), editable: true, tap: "Compare the two versions"
    },
    {
      key: "rejected", name: "Rejected", ref: "02-components §4.4",
      sees: "Flagged with the actual reason in a sentence, and three actions: retry, edit, discard.",
      rule: "A rejected write is a different category of event from a conflict — the server declined it, nobody disagreed with anybody.",
      bar: false, mark: mark("rejected", "not accepted"), editable: true,
      sentence: "That reading is lower than the one on 3 March. Is it a rollover, or a typo?",
      actions: ["Retry", "Edit", "Discard"]
    }
  ];

  /* ── 2. the five merge policies, as four visible shapes ───────────────
     shape: silent · admission · loser · question
     ask:   whether the member is asked anything at all                    */

  var POLICIES = [
    {
      id: "lww_field", shape: "silent", ask: false, category: "Two people edited different things and both succeeded",
      sees: "Nothing.",
      why: "Nothing was lost, so there is nothing to ask. A dialog here would teach members that reconnecting is dangerous.",
      entities: ["Task cards", "note metadata", "plantings", "shopping items", "contacts", "vehicles", "pets", "properties"],
      caption: "Jana renamed the bed while Petr changed its zone. Both writes are in the row."
    },
    {
      id: "state_set", shape: "silent", ask: false, category: "A check and an uncheck raced, and the later intent won",
      sees: "Nothing.",
      why: "The two-trolley case. Milk is checked once, and neither member is shown a conflict for having agreed.",
      entities: ["Shopping checked state", "chore completions", "medication doses", "reactions", "read markers"],
      caption: "Both phones checked milk offline. One checked item, no dialog, identical within two seconds."
    },
    {
      id: "additive", shape: "admission", ask: false, category: "Appended, but admission is not guaranteed",
      sees: "Nothing on merge — and a rejection later if a cross-row invariant fails. The edit affordance on an already-synced row is unavailable offline, in words.",
      why: "An additive row has no offline update path (D-24). Creating one offline is the whole point; correcting one offline is not possible, so the affordance says so rather than queueing a change the platform cannot carry.",
      entities: ["Meter readings", "usage readings", "chat messages", "harvests", "fuel entries", "service records", "settlements", "point ledger", "shopping trips", "task comments", "pet health entries"],
      caption: "Recorded offline, admitted on reconnect — or refused an hour later by a neighbour the phone did not hold.",
      offlineEdit: "unavailable"
    },
    {
      id: "lww_row", shape: "loser", ask: false, category: "One body replaced another, and the loser was kept",
      sees: "A banner offering the preserved version. “Here it is”, not a question.",
      why: "The two cases are not the same size, and the banner must not promise the larger one where only the smaller exists.",
      entities: ["Note bodies", "chat message bodies"],
      caption: "Notes: preserved for a stated thirty days, recoverable offline. Chat: preserved with no stated window and no offline path.",
      variants: [
        { who: "Note body", ref: "FR-NO10", window: "30 days", offline: "recoverable offline", copy: "Petr saved a different version of this note at 18:40. Yours is kept until 2 April." },
        { who: "Chat message body", ref: "FR-CT3", window: "no stated window", offline: "online only", copy: "Your earlier wording was replaced. It is still here while you are online." }
      ]
    },
    {
      id: "strict_version", shape: "question", ask: true, category: "A wrong answer costs money, so a human is asked",
      sees: "Always a question. The conflict resolver, one row at a time.",
      why: "A silent merge of an allocation rule is a wrong number nobody will ever find. This is the only policy that interrupts, and it interrupts on the member's own schedule.",
      entities: ["Money", "tariffs", "allocation rules", "transactions", "expense shares", "calendar events", "chore definitions", "season close", "permission changes"],
      caption: "You set the amount to 450. Petr set it to 500 at 18:40. Which is right?"
    }
  ];

  var SHAPES = {
    silent: { label: "Nothing is shown", note: "The merge is invisible because nothing was lost. Two policies share this shape on purpose — visibly they are one category." },
    admission: { label: "Appended, then admitted", note: "The mark is about admission, not disagreement, and the correction path is honest about being online-only." },
    loser: { label: "Here is the version you wrote", note: "A statement with a recovery affordance. No question is asked, because the app already knows what happened." },
    question: { label: "Which is right?", note: "The only shape that asks. Two values, two authors, two times, and a way to enter a third." }
  };

  /* ── 3. the conflict inbox and the resolver (DD-4) ────────────────────
     Entries route to the row. They never resolve in place, because “which
     amount is right” is only answerable next to what the amount is for.   */

  var INBOX = [
    {
      id: "cf-1", module: "finance", title: "March electricity settlement", where: "Ledger · 3 March",
      mine: { who: "You", value: "450,00 Kč", at: "18:12, offline" },
      theirs: { who: "Petr", value: "500,00 Kč", at: "18:40" },
      question: "You set the amount to 450. Petr set it to 500 at 18:40. Which is right?",
      third: "Enter a different amount", route: "Open in Finance", resolveAt: null
    },
    {
      id: "cf-2", module: "utilities", title: "Electricity tariff — standing charge", where: "Tariff · from 1 January",
      mine: { who: "You", value: "148,00 Kč / month", at: "yesterday, 20:05" },
      theirs: { who: "Jana", value: "162,00 Kč / month", at: "today, 07:30" },
      question: "You set the standing charge to 148. Jana set it to 162 this morning. Which is on the bill?",
      third: "Enter a different charge", route: "Open in Utilities", resolveAt: null
    },
    {
      id: "cf-3", module: "calendar", title: "Dentist — Adam", where: "Calendar · Thursday 09:00",
      mine: { who: "You", value: "Thursday 09:00", at: "Tuesday, offline" },
      theirs: { who: "Jana", value: "Thursday 14:30", at: "Tuesday, 21:15" },
      question: "You moved this to 09:00. Jana moved it to 14:30 on Tuesday evening. Which one stands?",
      third: "Pick another time", route: "Open in Calendar", resolveAt: null
    }
  ];

  var INBOX_RULES = [
    ["A persistent badge, wherever unresolved conflicts exist", "Not a modal at reconnect. Six modals is a reconnect people learn to avoid."],
    ["One inbox across every module", "A member who reconnects after a week gets a list, in one place, in their own time."],
    ["Resolution happens from the row", "The inbox routes; it does not resolve in place. The amount is only answerable beside what the amount is for."],
    ["Nothing auto-resolves and nothing ages out", "An unresolved conflict stays flagged until a person answers it."],
    ["No jargon in the question", "No versions, no vectors, no “remote”. Two names, two numbers, two times."]
  ];

  /* ── 4. the rejected-mutation resolver — the four reasons that occur ── */

  var REJECTIONS = [
    {
      code: "monotonicity_violation", ref: "FR-UT3", where: "Utilities · cellar meter",
      copy: "That reading is lower than the one on 3 March. Is it a rollover, or a typo?",
      extra: "The meter rolled over past 99 999", actions: ["Retry", "Edit the reading", "Discard"],
      note: "The form pre-checks against the neighbour the replica holds and questions a low value at the meter. This screen is what happens when the neighbour was on another device."
    },
    {
      code: "entitlement", ref: "FR-BI2", where: "Finance · new expense",
      copy: "The subscription is past due, so this change is held rather than saved. It is not lost — it will be offered for replay when the subscription resumes.",
      extra: null, actions: ["Retry", "Edit", "Discard"],
      note: "Held, never lost, and the sentence says which. Nothing is retracted for lapsing and the local replica stays where it is."
    },
    {
      code: "attachment_quota", ref: "FR-FL4", where: "Documents · receipt photo",
      copy: "This photo is 28 MB and the limit for one file is 25 MB. Retaking it at a smaller size will fit.",
      extra: "Reduce and retry", actions: ["Retry", "Replace the file", "Discard"],
      note: "Quota, size and type all state the limit and what to do about it. The metadata row already exists on every device; only the bytes were refused."
    },
    {
      code: "reference_gone", ref: "D-40", where: "Vehicles · service record",
      copy: "The document this pointed at was deleted while you were offline: “Škoda — service invoice, March”. The record is here; its attachment is not.",
      extra: null, actions: ["Retry without it", "Attach another", "Discard"],
      note: "It names what it pointed at. A rejection that will not say what is missing is a rejection the member cannot act on."
    }
  ];

  /* ── 5. retraction and the withdrawn state (§2) ───────────────────────── */

  var RETRACTION = {
    causes: [
      ["A grant lowered to none", "The commonest of the five, and the one D-78 says must be announced."],
      ["Removal from a conversation or a member_shared calendar", "The entity stays; this member's copy does not."],
      ["An item moved from shared to a private root", "Nobody deleted anything. It simply stopped being theirs to see."],
      ["Removal from the household", "Everything household-scoped goes, on receipt."],
      ["A module disabled household-wide", "Everyone's copy, and the data is retained on the server — the sentence says so."]
    ],
    sentences: [
      { cause: "access", copy: "Your access to this changed, so it was removed from this device.", note: "Says which of the two it was, without naming what was withdrawn." },
      { cause: "module", copy: "This module was turned off for the household. Nothing was deleted — it comes back if it is turned on again.", note: "The question is “will I lose my garden plan”, and the answer is no." }
    ],
    rules: [
      ["It can land while the member is looking at the row", "So withdrawn is a designed state on every data-bearing component, not a refresh that comes back empty."],
      ["Not an error, not an empty state, not somebody else's delete", "Three states it is routinely mistaken for, all of which say the wrong thing about what happened."],
      ["A member sitting inside a withdrawn entity is moved out", "To the nearest surface they still have, carrying the same sentence. Never a dead screen, never a 403-flavoured explanation."],
      ["No write affordance is drawn at all", "Absence, not disabling — the same rule as the none grant, because this is the transition into it."],
      ["Retraction is best-effort (FR-SY8)", "A device that never reconnects keeps its copy, so the UI never implies the data has been recalled everywhere."]
    ]
  };

  /* ── 6. honesty about computed numbers (§12) ──────────────────────────── */

  var HONESTY = [
    { id: "cannot", situation: "Cannot compute", ref: "FR-UT12", shows: "The field is absent, not zero, and the screen names exactly what is missing.",
      example: "Consumption needs two readings on the same register. There is one." },
    { id: "blocked", situation: "Blocked by a gap", ref: "FR-UT9", icon: "blocked", shows: "The gap is named, the form is pre-filled to the date, and no value is estimated into it.",
      example: "A reading is needed for 1 January before this period can be settled." },
    { id: "estimated", situation: "Estimated input", ref: "FR-UT4", icon: "estimated", shows: "A distinct style, and excluded from every money figure.",
      example: "3 February · 18 116,0 kWh · estimated. Used in the chart, never in the bill." },
    { id: "approximate", situation: "Approximate aggregate", ref: "FR-UT15", icon: "estimated", shows: "The chart says so, because an interval crossing a month boundary is approximate by construction.",
      example: "February ≈ 286 kWh — the interval spans 28 January to 3 March." },
    { id: "projected", situation: "Projected", ref: "FR-AS2", shows: "“Due in about six weeks”, never a date the household committed to.",
      example: "Service due in about six weeks, on current mileage." },
    { id: "nohistory", situation: "No history yet", ref: "FR-GA18", icon: "no_history", shows: "Garden's no_history — neither a pass nor a warning, and it must not look like either.",
      example: "Rotation can't be checked yet — this bed has no recorded season." },
    { id: "remainder", situation: "Negative remainder", ref: "FR-FI8", shows: "Shown as zero with a footnote, never clamped in the data.",
      example: "Left to allocate: 0 — the plan is 1 200 Kč over this month's income." }
  ];

  var ZERO_VS_NOTHING = {
    zero: { label: "Water · garden tap", value: "0", unit: "m³", foot: "Read 3 March by Miloš. The tap was off all month.", note: "A genuine zero is a measurement. It has a date, an author and a unit." },
    nothing: { label: "Water · garden tap", unit: "m³", missing: "Two readings on this register produce the first figure. There is one.",
      action: "Add a reading", note: "Not enough information is an absence. It names what is missing and offers the action that supplies it." }
  };

  /* ── 7. the three named offline write cases, and attachments ─────────── */

  var CASES = [
    { name: "The two trolleys", ref: "05-shopping", policy: "state_set",
      story: "Two members offline in the same shop, both checking milk.",
      expected: "Milk checked once. No conflict dialog shown to anyone. Both devices identical within two seconds of the second reconnecting." },
    { name: "The cellar", ref: "10-utilities", policy: "additive",
      story: "A reading taken with no signal, uploaded on reconnect — and possibly rejected an hour later against a neighbour the phone did not hold.",
      expected: "The form pre-checks what it holds and questions a low value at the meter. The pending state stays visible until the server has actually taken it." },
    { name: "The far end of the garden", ref: "11-garden", policy: "additive",
      story: "A task completed and a harvest logged with no signal.",
      expected: "Both queue. The crop catalog is a cached versioned bundle, so “how deep do I sow these” is answerable out there." }
  ];

  var ATTACHMENTS = {
    ref: "D-25",
    line: "Files are not in the change feed. The metadata row syncs immediately with attachment_status: pending, and every client renders a placeholder.",
    consequence: "A member who photographs a receipt in a car park sees the row on every device before the bytes have moved."
  };

  var DEFERRED = [
    ["Sync health — per device: last sync, cursor, pending count, conflicts, replica digest, force re-snapshot", "St. 8", "It is a household-settings screen (FR-HA19), and it ships in Phase 0 with the rest of admin. The vocabulary it renders is settled here."],
    ["The six entitlement banner states", "St. 8", "read_only and canceled reuse this stage's held-not-lost sentence, but the banner set belongs with billing."],
    ["The offline bar in both shells, with the tab bar and the sidebar around it", "St. 6", "Drawn here as the component. Where it sits, and what it must never cover, is a navigation decision."],
    ["The conflict badge's home in each client", "St. 6", "The badge is specified here; the sidebar and tab-bar slots it lives in are Stage 6."],
    ["Notes' thirty-day recovery flow, and Chat's online-only edit", "St. 13 / 19", "The two lww_row variants are distinguished here so neither module inherits the other's promise."]
  ];

  /* ── 8. the gate, computed ────────────────────────────────────────────── */

  function checks() {
    var shapes = {};
    POLICIES.forEach(function (p) { shapes[p.shape] = (shapes[p.shape] || 0) + 1; });
    var shapeCount = Object.keys(shapes).length;
    var silent = POLICIES.filter(function (p) { return p.shape === "silent"; });
    var asking = POLICIES.filter(function (p) { return p.ask; });

    var marked = LADDER.filter(function (l) { return l.mark; });
    var colourOnly = marked.filter(function (l) { return !l.mark.word || !l.mark.paths.length; });

    var resnap = LADDER.filter(function (l) { return l.borrows; });
    var ownTokens = {};
    marked.forEach(function (l) { ownTokens[l.mark.token] = 1; });

    var additive = POLICIES.filter(function (p) { return p.shape === "admission"; });
    var honest = additive.filter(function (p) { return p.offlineEdit === "unavailable"; });

    var ageing = INBOX.filter(function (e) { return e.resolveAt !== null; });
    var routed = INBOX.filter(function (e) { return !!e.route; });

    var reasons = REJECTIONS.filter(function (r) { return r.copy && r.actions.length === 3; });
    var generic = REJECTIONS.filter(function (r) { return /something went wrong/i.test(r.copy); });

    return [
      {
        name: "Four shapes, not five severities",
        detail: shapeCount + " visible shapes across five policies — " + silent.length + " silent, one admission, one preserved loser, " + asking.length + " that asks. The two silent policies share a shape on purpose; no shape is a louder version of another.",
        pass: shapeCount === 4 && silent.length === 2 && asking.length === 1
      },
      {
        name: "Only strict_version interrupts",
        detail: asking.length === 1 ? "One policy asks a question, and it asks from a row on the member's own schedule (DD-4)." : "More than one policy asks — a severity ladder has formed.",
        pass: asking.length === 1
      },
      {
        name: "No mark carries its meaning in colour",
        detail: marked.length + " marks drawn, each with a word and a drawn glyph; " + colourOnly.length + " colour-only.",
        pass: colourOnly.length === 0
      },
      {
        name: "Re-snapshot adds no fourteenth status",
        detail: resnap.length === 1 && resnap[0].borrows === "syncing"
          ? "It borrows syncing's token, glyph and word, and appears at all only past the same threshold."
          : "Re-snapshot has acquired a presentation of its own.",
        pass: resnap.length === 1 && resnap[0].borrows === "syncing" && Object.keys(ownTokens).length === 4
      },
      {
        name: "Additive corrections are unavailable offline, in words",
        detail: honest.length + " of " + additive.length + " additive shapes draw the edit affordance as unavailable rather than queueing a change the platform cannot carry (D-24).",
        pass: additive.length > 0 && honest.length === additive.length
      },
      {
        name: "Nothing auto-resolves, nothing ages out, everything routes",
        detail: ageing.length + " entries with a deadline; " + routed.length + " of " + INBOX.length + " route to their own row rather than resolving in the inbox.",
        pass: ageing.length === 0 && routed.length === INBOX.length
      },
      {
        name: "Every rejection names its reason and offers three actions",
        detail: reasons.length + " of " + REJECTIONS.length + " reasons carry a written sentence with retry / edit / discard; " + generic.length + " generic.",
        pass: reasons.length === REJECTIONS.length && generic.length === 0
      }
    ];
  }


  /* ── 9. the three screens the shell routes to (Stage 21 follow-up) ─────
     Stage 5 drew these as measured cells in its own artifact and the ledger
     recorded them as built, but the application had no route to any of them —
     so the whole sync vocabulary was unreachable by clicking. These rows put
     the inbox, the resolver and the refusal screen in the registry the shell
     routes from, with the copy read from INBOX and REJECTIONS above rather
     than restated here. */

  var SCREENS = [
    {
      id: "F-5", route: "/sync", name: "Conflict inbox", title: "Conflicts",
      kind: "list", client: "mw", preset: "D",
      lede: "Everything waiting for an answer, in one place and in your own time. Nothing here resolves itself and nothing ages out.",
      notice: { tone: "warning", body: INBOX.length + " conflicts and " + REJECTIONS.length +
        " refused changes. The badge stays until a person answers them — this is never a modal at reconnect." },
      empty: { s: "Nothing is waiting", e: "Conflicts appear here when two people answered the same question while one of them was offline.", a: "" },
      error: "The inbox could not be read. Your conflicts are still flagged on their own rows.",
      readonly: "Read-only — the subscription is paused. Both values are readable; neither can be chosen until it resumes.",
      withdrawn: "Your access to one of these changed, so it was removed from this device.",
      rejected: "The answer was refused. It is held, not lost, and offered again below.",
      foot: "Resolution happens from the row, never in the inbox: which amount is right is only answerable beside what the amount is for.",
      note: "DD-4 · one inbox across every module, a persistent badge, and no auto-resolution."
    },
    {
      id: "F-6", route: "/sync/cf-1", name: "Conflict resolver", title: INBOX[0].title,
      kind: "detail", client: "mw", preset: "D",
      lede: INBOX[0].question,
      fields: [
        { label: INBOX[0].mine.who, value: INBOX[0].mine.value + " · " + INBOX[0].mine.at, type: "text" },
        { label: INBOX[0].theirs.who, value: INBOX[0].theirs.value + " · " + INBOX[0].theirs.at, type: "text" },
        { label: "Where", value: INBOX[0].where, type: "text" }
      ],
      notice: { tone: "warning", body: "One row at a time. Two names, two numbers, two times — no versions, no vectors, no “remote”." },
      primary: "Keep " + INBOX[0].theirs.value + " (" + INBOX[0].theirs.who + ")",
      secondary: ["Keep " + INBOX[0].mine.value, INBOX[0].third],
      error: "The answer did not reach the server. The conflict is still flagged and nothing was chosen.",
      readonly: "Read-only — the subscription is paused. Both values stay; choosing waits until it resumes.",
      withdrawn: "Your access to this changed, so it was removed from this device.",
      foot: "strict_version is the one policy that interrupts, and it interrupts here rather than at reconnect.",
      note: "The other two conflicts open the same resolver from their own rows."
    },
    {
      id: "F-7", route: "/refused", name: "Rejected-mutation resolver", title: "Changes the server refused",
      kind: "list", client: "mw", preset: "D",
      lede: "Four reasons occur in practice. Each names what happened, and each offers retry, edit and discard.",
      notice: { tone: "danger", body: "Refused is not lost: the change stays on this device until you retry it, edit it or discard it." },
      empty: { s: "Nothing was refused", e: "A change the server cannot accept is held here with the reason it gave.", a: "" },
      error: "The refused changes could not be read. They are still held on this device.",
      readonly: "Read-only — the subscription is paused. Held changes are offered for replay when it resumes.",
      foot: "No rejection says “something went wrong”. A rejection that will not say what is missing is one the member cannot act on.",
      note: "FR-UT3, FR-BI2, FR-FL4 and D-40 — the four that occur."
    }
  ];

  window.HH_SYNC = {
    version: "0.1-stage-5-candidate",
    ladder: LADDER, policies: POLICIES, shapes: SHAPES,
    inbox: INBOX, inboxRules: INBOX_RULES,
    rejections: REJECTIONS, retraction: RETRACTION,
    honesty: HONESTY, zeroVsNothing: ZERO_VS_NOTHING,
    cases: CASES, attachments: ATTACHMENTS, deferred: DEFERRED,
    screens: SCREENS,
    checks: checks
  };
})();
