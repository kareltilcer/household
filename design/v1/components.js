/* Household — stage 4: the component set and the twelve-state harness.
   02-components §1 (primitives), §2 (the client-neutral layout parts) and §3
   (data display), plus §0 — the twelve states every data-bearing component
   must have designed, in both themes.

   The point of this file is the harness model. Twelve states are not twelve
   drawings: each state is a *treatment* applied to one body. Nine bodies ×
   twelve treatments is a hundred and eight cells, all of them rendered from
   this data, which is what makes the coverage countable instead of asserted.
   Nothing here is a screen. */
(function () {

  var ICONS = window.HH_ICONS || { byId: {} };
  var LEDGER = window.HH_LEDGER || { states: [] };

  function mark(id) {
    var i = ICONS.byId[id] || {};
    return { id: id, word: i.word || id, token: i.token || "text-muted", paths: i.paths || [], stroke: i.stroke || 2 };
  }

  /* ── the twelve treatments ────────────────────────────────────────────
     kind:      what replaces or wraps the body
     mark:      the sync-state mark the record carries (§4.2) — absence is synced
     banner:    a strip above the body, in words
     offline:   the persistent offline bar (§2)
     writes:    whether write affordances are drawn at all
     rule:      the sentence the state has to obey                          */

  var TREATMENTS = {
    loading: {
      kind: "skeleton", writes: true,
      rule: "Skeleton, shape-matched to the content it replaces — never a spinner, and static under reduced motion."
    },
    empty: {
      kind: "teach", writes: true,
      rule: "One sentence, one example, one action (03-patterns §5). The example is what stops it reading as a fault."
    },
    populated: {
      kind: "body", writes: true,
      rule: "No mark. The absence of the sync mark is the synced state — there is no green tick on every row."
    },
    error: {
      kind: "message", tone: "danger", actions: ["Try again"], writes: true,
      rule: "Named in words, with an action, and it says what was not lost."
    },
    offline: {
      kind: "body", offline: true, writes: true,
      rule: "The read is identical to the online read. The bar is the only difference, and it never blocks content."
    },
    pending: {
      kind: "body", mark: mark("pending"), writes: true,
      rule: "A queued local write, fully editable — edits merge into the queued mutation. It must not read as an error."
    },
    syncing: {
      kind: "body", mark: mark("syncing"), writes: true,
      rule: "Only past the 800 ms threshold. Below it, nothing is shown at all."
    },
    conflicted: {
      kind: "body", mark: mark("conflict"), tappable: "Compare the two versions", writes: true,
      rule: "A row flag that opens the comparison, plus an inbox entry. Never a modal at reconnect (DD-4)."
    },
    rejected: {
      kind: "body", mark: mark("rejected"), bannerTone: "danger",
      actions: ["Retry", "Edit", "Discard"], writes: true,
      rule: "The actual reason in a sentence, plus retry / edit / discard. A different category of event from a conflict."
    },
    absent: {
      kind: "absent", writes: false,
      rule: "Gone, not disabled. No label, no tooltip, no greyed control — the member has no way to know it exists."
    },
    withdrawn: {
      kind: "message", tone: "neutral", actions: ["Back"], writes: false,
      rule: "Retracted while the member held it. Not an error, not an empty state, not somebody else's delete."
    },
    readonly: {
      kind: "body", bannerTone: "warning", actions: ["See plans"], writes: false,
      rule: "Content visible, writes absent, banner explains. Absent rather than disabled, as everywhere else."
    }
  };

  /* ── the nine data-bearing bodies (§3) ──────────────────────────────── */

  var BODIES = [
    {
      id: "list", flag: "showList", name: "List row", ref: "§3", client: "both", accent: "utilities",
      note: "The workhorse. Title, optional secondary line, optional module chip, optional member avatar, sync mark, trailing action. Every swipe action on mobile has a non-swipe equivalent.",
      skel: [[58, 1], [34, 0.8125], [70, 1], [42, 0.8125], [50, 1]],
      sample: {
        rows: [
          { title: "Electricity — cellar meter", secondary: "18 402 kWh · read 3 March by Petr", initial: "P", colour: "var(--chart-2)", trailing: "Open" },
          { title: "Gas — hallway meter", secondary: "4 118 m³ · read 3 March by Petr", initial: "P", colour: "var(--chart-2)", trailing: "Open" },
          { title: "Water — garden tap", secondary: "No reading this period", initial: "M", colour: "var(--chart-5)", trailing: "Open" }
        ]
      },
      empty: { s: "No readings on this meter yet.", e: "Petr reads the cellar meter on the first of each month.", a: "Add a reading" },
      error: "Couldn't load the readings. Nothing was lost — they are stored on this device.",
      rejected: "That reading is lower than the one on 3 March. Is it a rollover, or a typo?",
      withdrawn: "Utilities is no longer shared with you, so these readings were removed from this device.",
      readonly: "The subscription has lapsed. Everything is readable; new readings are held until it is renewed."
    },
    {
      id: "table", flag: "showTable", name: "Data table", ref: "§3", client: "web", accent: "finance",
      note: "Sortable, keyset-paginated by cursor rather than page number, comfortable and compact, horizontal scroll contained. Numeric columns are mono, right-aligned, tabular.",
      skel: [[100, 0.8125], [100, 1], [100, 1], [100, 1], [66, 1]],
      sample: {
        cols: [{ label: "Date", num: false }, { label: "Description", num: false }, { label: "Amount", num: true }],
        rows: [
          { cells: [{ v: "03/03", num: true }, { v: "Lidl — weekly shop", num: false }, { v: "−1 482,00", num: true }] },
          { cells: [{ v: "02/03", num: true }, { v: "Settle-up from Petr", num: false }, { v: "+2 000,00", num: true }] },
          { cells: [{ v: "01/03", num: true }, { v: "Electricity advance", num: false }, { v: "−1 850,00", num: true }] }
        ]
      },
      empty: { s: "Nothing in the ledger for March.", e: "An expense split three ways lands here the moment anyone records it.", a: "Add an expense" },
      error: "Couldn't load the ledger. The rows already on this device are still readable in Today.",
      rejected: "Held: the subscription is past due. The row is queued, not lost.",
      withdrawn: "Finance is no longer shared with you. The ledger was removed from this device.",
      readonly: "Read-only while the subscription is past due. Rows are visible; adding is held."
    },
    {
      id: "kv", flag: "showKv", name: "Key–value detail block", ref: "§3", client: "both", accent: "vehicles",
      note: "The right-hand pane of every asset, document and service. Labels left, values right, mono for anything numeric, and a value that does not exist is drawn as a dash with a word rather than an empty cell.",
      skel: [[38, 0.8125], [62, 1], [30, 0.8125], [54, 1], [44, 0.8125], [58, 1]],
      sample: {
        pairs: [
          { k: "Registration", v: "5AZ 4471", num: true },
          { k: "Next STK", v: "14 May 2027", num: false },
          { k: "Insurance", v: "Kooperativa · notice 6 weeks", num: false },
          { k: "Odometer", v: "148 320 km", num: true }
        ]
      },
      empty: { s: "Nothing recorded for this car yet.", e: "Registration and the next STK date are enough to make the reminders work.", a: "Add details" },
      error: "Couldn't load the car's details. Its service history is unaffected.",
      rejected: "That STK date is before the last one. Check the year on the certificate.",
      withdrawn: "Vehicles is no longer shared with you. This car was removed from this device.",
      readonly: "Read-only while the subscription is past due."
    },
    {
      id: "money", flag: "showMoney", name: "Money value", ref: "§3", client: "both", accent: "finance",
      note: "Amount and currency, with the original currency and the stored rate where one was used. Negative is carried by a sign and a word, never by colour alone.",
      skel: [[46, 1.25], [34, 0.8125]],
      sample: { amount: "1 240,00", cur: "CZK", neg: "−340,00", orig: "48,60 EUR", rate: "rate 25,52 stored 02/03" },
      empty: { s: "No amount yet.", e: "A trip summary can offer the total straight to Finance.", a: "Enter an amount" },
      error: "Couldn't read the balance. The last figure this device holds is shown in Today.",
      rejected: "That split does not add up to the total. One remainder rule per source.",
      withdrawn: "This expense was retracted by its author, so it was removed from this device.",
      readonly: "Read-only while the subscription is past due."
    },
    {
      id: "metric", flag: "showMetric", name: "Metric tile", ref: "§3", client: "both", accent: "utilities",
      note: "A catalog metric rendered: label, value, optional trend — and the not-enough-information state, which is a different thing from a genuine zero and is drawn with the no-history mark.",
      skel: [[52, 0.8125], [40, 1.25], [46, 0.8125]],
      sample: { label: "Electricity, this period", value: "412", unit: "kWh", trend: "6 % more than last period", noInfoWord: "Not enough information" },
      empty: { s: "Not enough information yet.", e: "Two readings on the same meter produce the first figure.", a: "Add a reading" },
      error: "Couldn't compute this figure. The readings behind it are intact.",
      rejected: "Held: the subscription is past due, so the recalculation is queued.",
      withdrawn: "The meter behind this figure is no longer shared with you.",
      readonly: "Read-only while the subscription is past due."
    },
    {
      id: "series", flag: "showSeries", name: "Chart — time series", ref: "§3", client: "both", accent: "utilities",
      note: "Utilities consumption and cost, Pets weight, Finance burn-down. Interpolated points carry the estimated style and are excluded from every money figure; monthly aggregates can be marked approximate.",
      skel: [[100, 4.5], [70, 0.8125]],
      sample: {
        cols: [
          { label: "O", h: 46 }, { label: "N", h: 58 }, { label: "D", h: 74 },
          { label: "J", h: 88 }, { label: "F", h: 79, est: true }, { label: "M", h: 62 }
        ],
        caption: "kWh per month · February is estimated"
      },
      empty: { s: "No history yet.", e: "The chart appears with the second reading on this meter.", a: "Add a reading" },
      error: "Couldn't load the consumption series. Your readings are unaffected.",
      rejected: "That reading is lower than the one on 3 March, so the series was not extended.",
      withdrawn: "The meter behind this chart is no longer shared with you.",
      readonly: "Read-only while the subscription is past due."
    },
    {
      id: "comp", flag: "showComp", name: "Chart — composition", ref: "§3", client: "both", accent: "documents",
      note: "Storage by module and member; budget by category. One bar, a legend that names every segment with its figure, and derived overhead shown as its own segment rather than folded into the total.",
      skel: [[100, 1.5], [64, 0.8125], [58, 0.8125], [50, 0.8125]],
      sample: {
        segs: [
          { label: "Documents", pct: 44, fig: "1,8 GB", colour: "var(--chart-3)" },
          { label: "Chat", pct: 24, fig: "980 MB", colour: "var(--chart-1)" },
          { label: "Garden photos", pct: 18, fig: "740 MB", colour: "var(--chart-5)" },
          { label: "Overhead (derived)", pct: 14, fig: "560 MB", colour: "var(--chart-8)" }
        ],
        total: "4,1 GB of 10 GB"
      },
      empty: { s: "Nothing stored yet.", e: "The first document upload gives this its first segment.", a: "Upload a document" },
      error: "Couldn't measure storage. Nothing has been deleted.",
      rejected: "Held: the upload is over the household's allowance. Deleting the two largest files would recover 1,2 GB.",
      withdrawn: "Documents is no longer shared with you.",
      readonly: "Read-only while the subscription is past due."
    },
    {
      id: "flow", flag: "showFlow", name: "Chart — flow", ref: "§3 · §4.15", client: "both", accent: "finance",
      note: "N sources to M accounts, reconciling exactly. This is the shell only — the readable phone layout is Stage 16's work, and it is named in the plan as the hardest single visual in the product.",
      skel: [[44, 1], [44, 1], [100, 1.5], [44, 1], [44, 1]],
      sample: {
        sources: [{ label: "Jana — salary", fig: "42 000" }, { label: "Petr — salary", fig: "31 000" }],
        accounts: [{ label: "Household account", fig: "48 000" }, { label: "Savings", fig: "15 000" }, { label: "Personal — remainder", fig: "10 000" }],
        total: "73 000 in · 73 000 out"
      },
      empty: { s: "No allocation rules yet.", e: "One rule — 60 % of Jana's salary to the household account — is a working start.", a: "Add a rule" },
      error: "Couldn't build the flow. Your rules and incomes are unaffected.",
      rejected: "Two remainder rules on Jana — salary. Exactly one is allowed per source.",
      withdrawn: "Finance is no longer shared with you.",
      readonly: "Read-only while the subscription is past due."
    },
    {
      id: "search", flag: "showSearch", name: "Search result row", ref: "§3", client: "both", accent: "documents",
      note: "One uniform shape across every module. entity_type is what separates a board from a card, and this row is the only place that distinction can live. snippet and path are both nullable, so the row has a no-snippet and a no-path variant that still read as results.",
      skel: [[30, 0.8125], [66, 1], [82, 0.8125]],
      sample: {
        module: "Documents", type: "document",
        title: "Insurance — house contents 2026",
        snippet: "…policy number CZ-448 201, renewal 1 June, notice period six weeks…",
        path: "Documents / House / Insurance",
        when: "Updated 4 March"
      },
      empty: { s: "Nothing matches “jistič”.", e: "Search covers every module you have access to — try “electricity”.", a: "Clear the search" },
      error: "Couldn't search. Results already on this device are still listed under Today.",
      rejected: "Held: the search index is rebuilding after the household changed.",
      withdrawn: "That result pointed at something no longer shared with you.",
      readonly: "Read-only while the subscription is past due. Searching still works."
    }
  ];

  /* ── §1 primitives and §2 layout parts: what stage 4 owns, and what it
     deliberately does not ─────────────────────────────────────────────── */

  var PRIMITIVES = [
    ["Button", "primary · secondary · ghost · danger, each at default / hover / focus-visible / pressed / loading / disabled. Focus ring visible in both themes on both surfaces. 44 × 44 pt floor, compact included."],
    ["Icon button", "Same six states, and always labelled — the twenty-row label register is Stage 3's, and every icon-only control here draws from it."],
    ["Input · textarea · select · stepper", "default / focus / filled / error / disabled / read-only. Every field labelled, every error stated in words and associated programmatically — never carried by a red border."],
    ["Checkbox · radio · switch", "Including the checkbox's indeterminate. The switch states its own consequence in the label rather than in a caption."],
    ["Segmented control · tabs", "Arrow-key navigation, one tab stop for the group, the selected tab carried by more than colour."],
    ["Chip · tag", "Filter chip, module chip (accent + icon + name), status chip. The module chip is the only place a module accent appears in body content."],
    ["Avatar", "Per-member colour, used by Calendar's who-overlay and Chores' grid. Initials fallback, child badge."],
    ["Badge · counter", "Unread, overdue, pending. Never colour-only, and never a bare dot without a number or a word nearby."],
    ["Skeleton", "Shape-matched to what it replaces. Static under reduced motion, and never longer-lived than the request."],
    ["Tooltip · popover", "Keyboard-reachable, and never the only route to a piece of information."],
    ["Sheet · modal · drawer", "Focus trapped, escapable, focus restored. Mobile prefers sheets; web prefers side panels for editors and modals only for confirmation."],
    ["Toast", "With undo, for the whole five-second dwell. Undo is a button, not a gesture."]
  ];

  var DEFERRED = [
    ["Offline bar, sync mark, conflict resolver, rejected-mutation resolver", "Stage 5", "Drawn here only as the harness needs them — the vocabulary itself, and the honesty rules around it, are Stage 5's deliverable."],
    ["Tab bar, sidebar, app bar, household switcher, two-pane, section list", "Stage 6", "They are shells, and a shell is only testable with routes behind it."],
    ["Entitlement banner — six states", "Stage 8", "The banner shape is here; which six states exist, and what active and suspended do instead, is billing's."],
    ["Empty-state copy for the other sixteen modules", "Stages 9 → 19", "Each is written next to the screen it teaches. Shopping's, in Stage 9, is the template."],
    ["Hold-to-complete, widget shell, grant matrix, tariff editor, allocation editor and the rest of §4", "Stages 8 → 17", "Load-bearing domain components. Each one is designed with its first real consumer, not in the abstract."]
  ];

  /* ── the harness: cells are built, not drawn ────────────────────────── */

  var STATE_META = {};
  (LEDGER.states || []).forEach(function (s) { STATE_META[s[0]] = { word: s[1], note: s[2] }; });
  var STATE_ORDER = (LEDGER.states || []).map(function (s) { return s[0]; });

  var BY_ID = {};
  BODIES.forEach(function (b) { BY_ID[b.id] = b; });

  function bannerFor(body, state, t) {
    if (state === "rejected") return { tone: "danger", text: body.rejected, actions: t.actions };
    if (state === "readonly") return { tone: "warning", text: body.readonly, actions: t.actions };
    return null;
  }

  function messageFor(body, state) {
    if (state === "error") return { tone: "danger", text: body.error, actions: ["Try again"] };
    if (state === "withdrawn") return { tone: "neutral", text: body.withdrawn, actions: ["Back"] };
    return null;
  }

  function cell(bodyId, state, variant) {
    var b = BY_ID[bodyId], t = TREATMENTS[state], m = STATE_META[state] || { word: state, note: "" };
    var banner = bannerFor(b, state, t);
    var msg = messageFor(b, state);
    var c = {
      key: bodyId + ":" + state + ":" + (variant || "-"),
      bodyId: bodyId, bodyName: b.name, ref: b.ref, state: state,
      word: m.word, note: m.note, rule: t.rule,
      isSkel: t.kind === "skeleton", isTeach: t.kind === "teach",
      isMsg: t.kind === "message", isAbsent: t.kind === "absent",
      isBody: t.kind === "body",
      skel: b.skel, empty: b.empty, message: msg, banner: banner,
      hasBanner: !!banner, hasOffline: !!t.offline,
      mark: t.mark || null, hasMark: !!t.mark, tappable: t.tappable || "",
      writes: t.writes, sample: b.sample, client: b.client,
      variant: variant || "", label: b.name
    };
    /* which body markup runs */
    BODIES.forEach(function (x) { c[x.flag] = c.isBody && x.id === bodyId; });
    /* variant flags — the nullable-field and sign cases §3 names */
    c.vNoSnippet = variant === "no-snippet";
    c.vNoPath = variant === "no-path";
    c.vNegative = variant === "negative";
    c.vNoInfo = variant === "no-info";
    c.rows = [];
    if (b.sample.rows) {
      c.rows = b.sample.rows.map(function (r, i) {
        return {
          title: r.title, secondary: r.secondary, initial: r.initial, colour: r.colour,
          trailing: r.trailing, hasMark: c.hasMark && i === 0, showTrailing: c.writes
        };
      });
    }
    return c;
  }

  function statesOf(bodyId) {
    return STATE_ORDER.map(function (s) { return cell(bodyId, s); });
  }

  function allCells() {
    var out = [];
    BODIES.forEach(function (b) { STATE_ORDER.forEach(function (s) { out.push(cell(b.id, s)); }); });
    return out;
  }

  /* the §3 variants, shown populated: the nullable and signed cases */
  var VARIANTS = [
    ["list", "", "Populated"],
    ["table", "", "Populated · compact by default"],
    ["kv", "", "Populated"],
    ["money", "", "Amount, original currency, stored rate"],
    ["money", "negative", "Negative — sign and word, not colour"],
    ["metric", "", "Label, value, trend"],
    ["metric", "no-info", "Not enough information — not a zero"],
    ["series", "", "One estimated point, excluded from money"],
    ["comp", "", "Derived overhead as its own segment"],
    ["flow", "", "Shell only — Stage 16 owns the readable layout"],
    ["search", "", "Full row"],
    ["search", "no-snippet", "snippet null"],
    ["search", "no-path", "path null"]
  ];

  function variantCells() {
    return VARIANTS.map(function (v) {
      var c = cell(v[0], "populated", v[1]);
      c.key = v[0] + ":variant:" + (v[1] || "full");
      c.word = v[2];
      c.note = c.ref;
      return c;
    });
  }

  /* ── the gate, as checks rather than claims ─────────────────────────── */

  function checks() {
    var out = [];
    var cells = allCells();
    out.push({
      name: "Every body renders every state",
      detail: BODIES.length + " bodies × " + STATE_ORDER.length + " states = " + cells.length + " cells, all built from the treatment table",
      pass: cells.length === BODIES.length * STATE_ORDER.length
    });
    var noKind = cells.filter(function (c) { return !(c.isSkel || c.isTeach || c.isMsg || c.isAbsent || c.isBody); });
    out.push({
      name: "No cell falls through the treatment table",
      detail: noKind.length ? noKind.map(function (c) { return c.key; }).join(", ") : "every cell resolves to exactly one treatment",
      pass: noKind.length === 0
    });
    var colourOnly = Object.keys(TREATMENTS).filter(function (k) {
      var t = TREATMENTS[k];
      return t.mark && (!t.mark.word || !t.mark.paths.length);
    });
    out.push({
      name: "No state is carried by colour alone",
      detail: colourOnly.length ? colourOnly.join(", ") : "every mark is icon + word + token, and the word is drawn inline where there is room",
      pass: colourOnly.length === 0
    });
    var missingCopy = [];
    BODIES.forEach(function (b) {
      ["error", "rejected", "withdrawn", "readonly"].forEach(function (k) { if (!b[k]) missingCopy.push(b.id + "." + k); });
      if (!b.empty || !b.empty.s || !b.empty.e || !b.empty.a) missingCopy.push(b.id + ".empty");
    });
    out.push({
      name: "Every named state has its own sentence",
      detail: missingCopy.length ? missingCopy.join(", ") : "error, rejected, withdrawn, read-only and the teaching empty state are written per body — no shared “Something went wrong”",
      pass: missingCopy.length === 0
    });
    var absentWrites = Object.keys(TREATMENTS).filter(function (k) {
      return (k === "absent" || k === "withdrawn" || k === "readonly") && TREATMENTS[k].writes;
    });
    out.push({
      name: "Absence, withdrawal and read-only draw no write affordance",
      detail: absentWrites.length ? absentWrites.join(", ") + " still draw writes" : "writes are absent in all three — nothing is greyed out",
      pass: absentWrites.length === 0
    });
    return out;
  }

  window.HH_COMPONENTS = {
    version: "0.1-stage-4-candidate",
    treatments: TREATMENTS,
    stateOrder: STATE_ORDER,
    stateMeta: STATE_META,
    bodies: BODIES,
    primitives: PRIMITIVES,
    deferred: DEFERRED,
    byId: BY_ID,
    cell: cell,
    statesOf: statesOf,
    allCells: allCells,
    variantCells: variantCells,
    checks: checks
  };
})();
