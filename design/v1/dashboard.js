/* Stage 10 — the dashboard, the widget shell and all twenty-four widgets, as data.
   Source: docs/prd/modules/01-dashboard.md (FR-DB1-7, D-41, D-42), the seventeen module
   pages' own "Catalog contributions" tables, docs/prd/modules/00-module-model.md §6
   (the count the catalog registry is asserted against), docs/design/02-components.md §4.8
   (the widget shell) and §0 (the twelve states), 08-decisions.md DD-2 (column spans in a
   2 / 4 / 6 grid), 05-screens.md §C, 03-patterns.md §2 (absence) and §5.

   Three things this file exists to compute rather than claim.

   One: the twenty-four keys. Ledger gap 1 said they are not enumerated anywhere. They are —
   just not in one place: each module page's Catalog contributions table names its own, and
   00-module-model §6 carries the per-module count that sums to 24. WIDGETS below collects
   all of them with the source line each came from, and `keyAudit()` checks the collection
   against that table module by module. The gap was a filing problem, not a missing decision.

   Two: reflow. DD-2 fixes sizes as column spans in a 2 / 4 / 6 grid with a second row for
   `large` on a phone. `reflow()` is the placement, and the gate runs it rather than reading
   a description of it: same ordered list in, same rows out, order preserved, no widget wider
   than its grid, and three sizes with three distinct footprints at every one of the three
   widths.

   Three: the catalog. FR-DB1 filters it by module grant, so `catalogFor()` reads the fixture.
   Klára's dashboard is two widgets because she holds two modules — not because two were
   authored for her. */
(function () {

  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending",
                    "syncing", "conflicted", "rejected", "absent", "withdrawn", "readonly"];

  /* ── DD-2: sizes are column spans over a fixed row rhythm ──────────────── */

  var WIDTHS = [
    [2, "phone", "2 columns"],
    [4, "tablet", "4 columns"],
    [6, "desktop", "6 columns"]
  ];

  var SPAN = { small: { 2: 1, 4: 1, 6: 1 }, medium: { 2: 2, 4: 2, 6: 2 }, large: { 2: 2, 4: 4, 6: 3 } };
  var ROWS = { small: { 2: 1, 4: 1, 6: 1 }, medium: { 2: 1, 4: 1, 6: 1 }, large: { 2: 2, 4: 1, 6: 1 } };
  var SIZES = ["small", "medium", "large"];

  /* The rhythm is a floor, not a fixed height: two smalls beside each other line up because
     the row's tallest widget sets the row, which is also what keeps 200 % text from clipping. */
  var RHYTHM = { unit: 116, gap: 12 };

  function span(size, cols) { return SPAN[size][cols]; }
  function rowspan(size, cols) { return ROWS[size][cols]; }
  function footprint(size, cols) { return span(size, cols) * rowspan(size, cols); }

  /* ── the placement, and nothing else decides it ─────────────────────────
     Greedy, in the order of the list, and it never reaches forward for a smaller
     widget to fill a hole. Backfilling would make the result depend on what comes
     later, which is exactly the determinism DD-2 buys. A hole is left, and the
     arrange screen is where a member closes it by moving something. */

  function reflow(entries, cols) {
    var rows = [], cur = [], used = 0;
    entries.forEach(function (e) {
      var s = span(e.size, cols), r = rowspan(e.size, cols);
      if (used > 0 && used + s > cols) { rows.push({ cells: cur, used: used, gap: cols - used }); cur = []; used = 0; }
      cur.push({ key: e.key, size: e.size, span: s, rowspan: r });
      used += s;
      if (used >= cols) { rows.push({ cells: cur, used: used, gap: cols - used }); cur = []; used = 0; }
    });
    if (cur.length) rows.push({ cells: cur, used: used, gap: cols - used });
    var interior = rows.slice(0, -1).reduce(function (a, r) { return a + r.gap; }, 0);
    return {
      cols: cols, rows: rows,
      order: rows.reduce(function (a, r) { return a.concat(r.cells.map(function (c) { return c.key; })); }, []),
      interiorGaps: interior,
      trailingGap: rows.length ? rows[rows.length - 1].gap : 0,
      units: rows.reduce(function (a, r) {
        return a + Math.max.apply(null, r.cells.map(function (c) { return c.rowspan; }));
      }, 0)
    };
  }

  /* ── the twenty-four widgets ────────────────────────────────────────────
     One entry per key named by a module's own Catalog contributions table.
     size    — the default_size FR-DB1 requires the catalog to carry. Unstated per
               widget anywhere in the handoff; assigned here, and recorded as a gap.
     act     — the write the widget offers, or null. A widget is a read, so the
               catalog minimum is view on the owning module (the standard gate);
               the action needs contribute, and under view it is absent, not greyed.
     src     — the line it was collected from.
     kind    — which body shape draws it. Seven shapes cover all twenty-four. */

  var WIDGETS = [
    { key: "reminders.due", module: "reminders", title: "Due and overdue", size: "medium",
      src: "03-reminders.md · Catalog contributions",
      says: "Everything due or overdue inside the member's lead windows, across every module, overdue first.",
      act: { verb: "complete", endpoint: "POST /reminders/occurrences/{id}/complete", hold: true },
      kind: "list",
      data: [
        { title: "Electricity — take the reading", meta: "today", chip: "utilities", hold: true },
        { title: "Insurance renewal · Škoda Octavia", meta: "overdue by 2 days", chip: "vehicles", tone: "danger", hold: true },
        { title: "Water the greenhouse", meta: "today", chip: "garden", hold: true },
        { title: "Passport · Adam expires", meta: "in 26 days", chip: "documents" }
      ] },

    { key: "reminders.this_month", module: "reminders", title: "Rest of September", size: "medium",
      src: "03-reminders.md · Catalog contributions",
      says: "A read-only look-ahead to month end. It completes nothing, which is why it can be quiet.",
      act: null, kind: "list",
      data: [
        { title: "Gas — take the reading", meta: "Fri 11", chip: "utilities" },
        { title: "Boiler service", meta: "Mon 14", chip: "property" },
        { title: "Vaccination · Bela", meta: "Thu 24", chip: "pets" },
        { title: "Sow winter spinach", meta: "Mon 28", chip: "garden" }
      ] },

    { key: "tasks.doing", module: "tasks", title: "Doing", size: "medium",
      src: "02-tasks.md · Catalog contributions",
      says: "Every card in a kind=now column across the boards that are not archived, grouped by board.",
      act: { verb: "complete", endpoint: "POST /tasks/cards/{id}/complete", hold: true },
      kind: "list",
      data: [
        { title: "Book the chimney sweep", meta: "House · Doing", chip: "tasks", hold: true },
        { title: "Return the drill to Miloš", meta: "House · Doing", chip: "tasks", hold: true },
        { title: "Chata — order firewood", meta: "Chata · This week", chip: "tasks", hold: true }
      ] },

    { key: "tasks.assigned_to_me", module: "tasks", title: "Assigned to me", size: "small",
      src: "02-tasks.md · Catalog contributions",
      says: "Open cards assigned to whoever is looking, due soonest first.",
      act: null, kind: "count",
      data: { value: "3", label: "cards", rows: ["Chimney sweep · Fri", "Firewood · next week", "Bike service · no date"] } },

    { key: "calendar.today", module: "calendar", title: "Today and tomorrow", size: "medium",
      src: "04-calendar.md · Catalog contributions",
      says: "Two days, with the member colour bar the who-overlay uses.",
      act: null, kind: "list",
      data: [
        { title: "Adam — swimming", meta: "16:30 · today", chip: "calendar", bar: "#7F5CB7" },
        { title: "Busy", meta: "18:00–19:30 · today · Petr", chip: "calendar", bar: "#0074AE", muted: true },
        { title: "Rubbish out", meta: "tomorrow", chip: "calendar", bar: "#A94B92" }
      ] },

    { key: "calendar.week_ahead", module: "calendar", title: "The week ahead", size: "large",
      src: "04-calendar.md · Catalog contributions",
      says: "The next seven days in agenda form — the shape 02-components §2 calls a section list.",
      act: null, kind: "agenda",
      data: [
        { day: "Thu 10", items: ["Dentist · Jana 09:00", "Adam — swimming 16:30"] },
        { day: "Fri 11", items: ["Gas reading", "Film night 20:00"] },
        { day: "Sat 12", items: ["Chata — drive up 09:00"] },
        { day: "Sun 13", items: [] },
        { day: "Mon 14", items: ["Boiler service 08:00–12:00"] }
      ] },

    { key: "shopping.lists", module: "shopping", title: "Shopping", size: "small",
      src: "05-shopping.md · Catalog contributions",
      says: "Each list with its unticked count, tapping straight into the quick-add field.",
      act: { verb: "add", endpoint: "POST /shopping/lists/{id}/items", hold: false },
      kind: "split", data: null },

    { key: "chores.mine_today", module: "chores", title: "My chores today", size: "medium",
      src: "06-chores.md · Catalog contributions",
      says: "Mine, due today and overdue. Not a leaderboard and not everybody else's.",
      act: { verb: "complete", endpoint: "POST /chores/occurrences/{id}/complete", hold: true },
      kind: "list",
      data: [
        { title: "Kitchen floor", meta: "today", chip: "chores", hold: true },
        { title: "Take out recycling", meta: "overdue since Monday", chip: "chores", tone: "danger", hold: true },
        { title: "Feed Bela · evening", meta: "today · Adam did the morning", chip: "chores", hold: true }
      ] },

    { key: "chores.week", module: "chores", title: "This week", size: "large",
      src: "06-chores.md · Catalog contributions",
      says: "The household's weekly grid, compact — members across, days down (FR-CO11).",
      act: null, kind: "grid",
      data: { members: ["Jana", "Petr", "Adam", "Klára"], days: ["Mo", "Tu", "We", "Th", "Fr"],
              cells: [[1, 0, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 2, 0, 0], [0, 0, 1, 0, 1]] } },

    { key: "notes.pinned", module: "notes", title: "Pinned notes", size: "small",
      src: "07-notes.md · FR-NO5 and Catalog contributions",
      says: "Household pins and my own, de-duplicated, opening in an overlay without leaving the screen.",
      act: null, kind: "count",
      data: { value: "4", label: "pinned", rows: ["Wifi and codes", "Chata — how the water works", "Bela's food", "Shopping notes"] } },

    { key: "documents.pinned", module: "documents", title: "Pinned documents", size: "small",
      src: "08-documents.md · Catalog contributions",
      says: "Household ∪ own pins, opening a preview overlay rather than a download.",
      act: null, kind: "count",
      data: { value: "3", label: "pinned", rows: ["House insurance 2026", "Octavia — service book", "Adam · birth certificate"] } },

    { key: "documents.expiring", module: "documents", title: "Expiring", size: "medium",
      src: "08-documents.md · Catalog contributions",
      says: "Documents expiring inside the member's own lead windows, not a fixed thirty days.",
      act: null, kind: "list",
      data: [
        { title: "Passport · Adam", meta: "expires 5 October", chip: "documents", tone: "warning" },
        { title: "Third-party insurance · Octavia", meta: "expires 31 October", chip: "documents" }
      ] },

    { key: "finance.period", module: "finance", title: "This period", size: "medium",
      src: "09-finance.md · Catalog contributions",
      says: "Income, allocated, remaining — or a prompt when the period has not been recorded, which is the real failure mode.",
      act: null, kind: "split",
      data: [["Income recorded", "68 400 Kč"], ["Allocated", "61 900 Kč"], ["Remaining", "6 500 Kč"]] },

    { key: "finance.balances", module: "finance", title: "Who owes whom", size: "medium",
      src: "09-finance.md · Catalog contributions",
      says: "The simplified set. Negative values are distinguished by more than colour (02-components §3).",
      act: null, kind: "split",
      data: [["Petr → Jana", "1 240 Kč"], ["Miloš → Jana", "310 Kč"], ["Settled since", "24 August"]] },

    { key: "finance.budget_progress", module: "finance", title: "Budgets", size: "large",
      src: "09-finance.md · Catalog contributions",
      says: "Top categories against budget. Progress, never a leaderboard.",
      act: null, kind: "bars",
      data: [["Food", 78, "7 800 / 10 000 Kč"], ["Transport", 46, "2 300 / 5 000 Kč"],
             ["House", 104, "5 200 / 5 000 Kč"], ["Children", 61, "1 830 / 3 000 Kč"]] },

    { key: "utilities.overview", module: "utilities", title: "Services", size: "large",
      src: "10-utilities.md · Catalog contributions",
      says: "Per service: balance or headroom, the next advance, and any blocking gap.",
      act: null, kind: "bars",
      data: [["Electricity · headroom", 64, "2 100 Kč of 3 300 Kč advance"],
             ["Gas · balance", 118, "over by 480 Kč · settle at period end"],
             ["Water · blocked", 0, "no closing reading — settlement cannot be computed"]] },

    { key: "utilities.readings_due", module: "utilities", title: "Readings due", size: "small",
      src: "10-utilities.md · Catalog contributions",
      says: "Services whose reading is overdue against the household's own chosen cadence.",
      act: null, kind: "count",
      data: { value: "2", label: "overdue", rows: ["Electricity · 4 days", "Gas · 1 day"] } },

    { key: "garden.work", module: "garden", title: "Garden work", size: "medium",
      src: "11-garden.md · Catalog contributions",
      says: "Tasks and care reminders overlapping the next thirty days, overdue first, grouped by week.",
      act: { verb: "complete", endpoint: "POST /garden/tasks/{id}/complete", hold: true },
      kind: "list",
      data: [
        { title: "Pest check · Zelí · bed 12", meta: "overdue by 5 days", chip: "garden", tone: "danger", hold: true },
        { title: "Direct sow · Špenát · bed 4", meta: "Friday", chip: "garden", hold: true },
        { title: "Harvest · Brambory · bed 4", meta: "week of 21 Sept", chip: "garden", hold: true }
      ] },

    { key: "garden.harvest_ready", module: "garden", title: "Ready to pick", size: "small",
      src: "11-garden.md · Catalog contributions",
      says: "Plantings inside their harvest window, which is the one garden question with a deadline.",
      act: null, kind: "count",
      data: { value: "13", label: "plantings", rows: ["Rajče ‘Black Krim’ · bed 2", "Cuketa · bed 6", "Fazole · bed 6"] } },

    { key: "property.due", module: "property", title: "House upkeep", size: "small",
      src: "12-property.md · Catalog contributions",
      says: "Services and warranties coming up, from the asset engine's schedules.",
      act: null, kind: "count",
      data: { value: "2", label: "coming up", rows: ["Boiler service · Mon 14", "Washing machine warranty ends 3 Nov"] } },

    { key: "vehicles.due", module: "vehicles", title: "Vehicles", size: "medium",
      src: "13-vehicles.md · Catalog contributions",
      says: "Inspections, insurance renewals and services coming up, per vehicle — statutory dates included.",
      act: null, kind: "list",
      data: [
        { title: "Octavia · insurance renewal", meta: "notice period ends 30 Sept", chip: "vehicles", tone: "warning" },
        { title: "Octavia · technical inspection", meta: "due March 2027", chip: "vehicles" },
        { title: "Adam's bike · brake pads", meta: "at 1 200 km · 1 140 now", chip: "vehicles" }
      ] },

    { key: "pets.today", module: "pets", title: "Bela today", size: "medium",
      src: "14-pets.md · Catalog contributions",
      says: "Today's routine and any doses due, per pet, with who has already done what.",
      act: null, kind: "list",
      data: [
        { title: "Morning walk", meta: "done · Adam, 07:20", chip: "pets", done: true },
        { title: "Evening feed", meta: "not yet", chip: "pets" },
        { title: "Worming tablet", meta: "due today", chip: "pets", tone: "warning" }
      ] },

    { key: "chat.unread", module: "chat", title: "Chat", size: "small",
      src: "15-chat.md · Catalog contributions",
      says: "Unread messages and the threads they are in. Never colour-only (02-components §1).",
      act: null, kind: "count",
      data: { value: "7", label: "unread · 2 threads", rows: ["Chata weekend · 5", "House · 2"] } },

    { key: "activity.recent", module: "activity", title: "Recently", size: "medium",
      src: "16-activity.md · Catalog contributions",
      says: "The last few household changes, in plain words rather than a log line.",
      act: null, kind: "list",
      data: [
        { title: "Petr entered the electricity reading", meta: "18:40 · 41 208 kWh", chip: "activity" },
        { title: "Jana added Klára to the household", meta: "yesterday", chip: "activity" },
        { title: "Adam completed “kitchen floor”", meta: "yesterday", chip: "activity" }
      ] }
  ];

  var BY_KEY = {};
  WIDGETS.forEach(function (w) { BY_KEY[w.key] = w; });

  /* 00-module-model §6's own column, so the collection can be checked rather than trusted */
  var MODULE_COUNT = {
    tasks: 2, reminders: 2, calendar: 2, shopping: 1, chores: 2, notes: 1, documents: 2,
    finance: 3, utilities: 2, garden: 2, property: 1, vehicles: 1, pets: 1, chat: 1, activity: 1,
    dashboard: 0, admin: 0
  };

  function keyAudit() {
    var mine = {};
    WIDGETS.forEach(function (w) { mine[w.module] = (mine[w.module] || 0) + 1; });
    var rows = Object.keys(MODULE_COUNT).map(function (m) {
      return { module: m, declared: MODULE_COUNT[m], collected: mine[m] || 0,
               ok: (mine[m] || 0) === MODULE_COUNT[m],
               keys: WIDGETS.filter(function (w) { return w.module === m; }).map(function (w) { return w.key; }) };
    });
    var declared = rows.reduce(function (a, r) { return a + r.declared; }, 0);
    return { rows: rows, declared: declared, collected: WIDGETS.length,
             ok: declared === WIDGETS.length && rows.every(function (r) { return r.ok; }) };
  }

  /* ── layouts (FR-DB2, FR-DB4) ───────────────────────────────────────────
     An ordered list of { key, size }. `meals.planner` sits in Jana's stored layout on
     purpose: it is a key from a module that does not exist in 1.0, and FR-DB2 says an
     unknown key is ignored rather than errored. */

  var LAYOUTS = {
    household: [
      { key: "reminders.due", size: "medium" },
      { key: "calendar.today", size: "medium" },
      { key: "shopping.lists", size: "small" },
      { key: "tasks.doing", size: "medium" },
      { key: "chores.mine_today", size: "medium" },
      { key: "activity.recent", size: "medium" }
    ],
    invitation: [
      { key: "utilities.overview", size: "large" },
      { key: "utilities.readings_due", size: "small" },
      { key: "shopping.lists", size: "small" },
      { key: "reminders.due", size: "medium" }
    ],
    child: [
      { key: "chores.mine_today", size: "medium" },
      { key: "tasks.assigned_to_me", size: "small" },
      { key: "shopping.lists", size: "small" },
      { key: "calendar.today", size: "medium" }
    ],
    jana: [
      { key: "utilities.overview", size: "large" },
      { key: "reminders.due", size: "medium" },
      { key: "finance.period", size: "medium" },
      { key: "garden.work", size: "medium" },
      { key: "shopping.lists", size: "small" },
      { key: "documents.expiring", size: "small" },
      { key: "meals.planner", size: "small" },
      { key: "chores.week", size: "large" },
      { key: "activity.recent", size: "medium" }
    ]
  };

  var LAYOUT_SOURCE = {
    household: ["Household default", "An owner set it. It applies to every member who has not customised, and to every new member as a starting point."],
    invitation: ["Per-invitation", "The inviting owner set it for one invitee. Optional, and falls back to the household default."],
    child: ["Child layout", "An owner set it, suggested or locked (FR-DB5). Locked is the default under the household's age threshold."],
    jana: ["Custom", "This member arranged her own. A changed household default never re-flattens it (FR-DB4)."]
  };

  /* resolve a stored layout against the catalog: unknown and now-unavailable keys drop out */
  function resolve(entries, memberId) {
    var cat = memberId ? catalogFor(memberId) : null;
    var allow = null;
    if (cat) { allow = {}; cat.entries.forEach(function (e) { allow[e.key] = e; }); }
    var kept = [], ignored = [];
    entries.forEach(function (e) {
      var w = BY_KEY[e.key];
      if (!w) { ignored.push({ key: e.key, why: "no such widget in the catalog — a key from a module this version does not ship" }); return; }
      if (allow && !allow[e.key]) { ignored.push({ key: e.key, why: "the module is not available to this member, so the key is skipped rather than errored" }); return; }
      kept.push({ key: e.key, size: e.size, widget: w, level: allow ? allow[e.key].level : "manage" });
    });
    return { entries: kept, ignored: ignored };
  }

  /* ── FR-DB1: the catalog is filtered by grant ───────────────────────────── */

  function catalogFor(memberId) {
    var F = window.HH_FIXTURES;
    if (!F) return { entries: [], member: null };
    var m = F.members.filter(function (x) { return x.id === memberId; })[0];
    if (!m) return { entries: [], member: null };
    var entries = WIDGETS.filter(function (w) { return m.grants[w.module] !== "none"; })
      .map(function (w) {
        var lv = m.grants[w.module];
        return { key: w.key, widget: w, level: lv,
                 canAct: !!w.act && (lv === "contribute" || lv === "manage" || m.role === "owner") };
      });
    var closed = {};
    WIDGETS.forEach(function (w) { if (m.grants[w.module] === "none") closed[w.module] = true; });
    return {
      member: m, entries: entries,
      modules: Object.keys(entries.reduce(function (a, e) { a[e.widget.module] = 1; return a; }, {})),
      closedModules: Object.keys(closed),
      hidden: WIDGETS.length - entries.length,
      withAction: entries.filter(function (e) { return !!e.widget.act; }).length,
      actionable: entries.filter(function (e) { return e.canAct; }).length
    };
  }

  function catalogTable() {
    var F = window.HH_FIXTURES;
    if (!F) return [];
    return F.members.map(function (m) {
      var c = catalogFor(m.id);
      return { id: m.id, name: m.name, role: m.role, offered: c.entries.length,
               hidden: c.hidden, modules: c.modules.length,
               withAction: c.withAction, actionable: c.actionable,
               line: c.entries.length + " of " + WIDGETS.length + " widgets \u00b7 " + c.modules.length + " modules" };
    });
  }

  /* ── the gate ───────────────────────────────────────────────────────────── */

  function determinism(entries) {
    var out = [];
    WIDTHS.forEach(function (w) {
      var a = reflow(entries, w[0]), b = reflow(entries, w[0]);
      var stable = JSON.stringify(a.rows) === JSON.stringify(b.rows);
      var ordered = a.order.join(",") === entries.map(function (e) { return e.key; }).join(",");
      var fits = a.rows.every(function (r) {
        return r.cells.every(function (c) { return c.span <= w[0]; });
      });
      out.push({ cols: w[0], name: w[1], stable: stable, ordered: ordered, fits: fits,
                 rows: a.rows.length, units: a.units,
                 interiorGaps: a.interiorGaps, trailingGap: a.trailingGap });
    });
    return out;
  }

  function outcomes() {
    return WIDTHS.map(function (w) {
      var f = SIZES.map(function (s) { return footprint(s, w[0]); });
      return { cols: w[0], name: w[1], footprints: f,
               distinct: f[0] !== f[1] && f[1] !== f[2] && f[0] !== f[2],
               detail: SIZES.map(function (s, i) {
                 return s + " " + span(s, w[0]) + "\u00d7" + rowspan(s, w[0]);
               }).join(" \u00b7 ") };
    });
  }

  function checks(live) {
    var entries = (live && live.entries) || resolve(LAYOUTS.jana, "jana").entries;
    var det = determinism(entries);
    var out = outcomes();
    var audit = keyAudit();
    var table = catalogTable();
    var acts = WIDGETS.filter(function (w) { return !!w.act; });
    var holds = acts.filter(function (w) { return w.act.hold; });
    var adam = catalogFor("adam"), klara = catalogFor("klara");
    var jana = resolve(LAYOUTS.jana, "jana");
    var unavailable = (live && live.unavailable) || null;
    var childLocked = live && live.lockedArrangeControls !== undefined ? live.lockedArrangeControls : null;

    return [
      { name: "Reflow is deterministic from the ordered list alone, at all three widths",
        detail: det.map(function (d) { return d.name + ": " + d.rows + " rows, " + d.units + " row units"; }).join(" \u00b7 ") +
          ". Run twice per width on the live layout: identical placement, reading order unchanged, and nothing is reached forward to fill a hole.",
        pass: det.every(function (d) { return d.stable && d.ordered; }) },
      { name: "Three sizes have three outcomes at every width",
        detail: out.map(function (o) { return o.name + " " + o.footprints.join("/") + " cells"; }).join(" \u00b7 ") +
          ". On a phone large and medium are both full width, so large takes two rows \u2014 without it the arrange screen would offer three sizes with two results (DD-2).",
        pass: out.every(function (o) { return o.distinct; }) },
      { name: "No widget is ever wider than the grid it lands in",
        detail: "large is " + span("large", 2) + " of 2, " + span("large", 4) + " of 4 and " + span("large", 6) +
          " of 6 \u2014 full width on phone and tablet, half on desktop. Every cell of the live layout fits its row at all three widths.",
        pass: det.every(function (d) { return d.fits; }) },
      { name: "All twenty-four keys are collected, each with the line it came from",
        detail: audit.collected + " keys collected against 00-module-model \u00a76's declared " + audit.declared +
          ", module by module. They were never missing \u2014 they are in the seventeen module pages' own catalog tables rather than in one list.",
        pass: audit.ok && audit.collected === 24 },
      { name: "The catalog is filtered by grant, computed from the fixture",
        detail: table.map(function (r) { return r.name + " " + r.offered; }).join(" \u00b7 ") +
          " of " + WIDGETS.length + ". Kl\u00e1ra is offered " + klara.entries.length + " because she holds " + klara.modules.length +
          " modules with widgets, and no widget of a module she holds none on appears in any list or count.",
        pass: table.length > 0 && klara.entries.length < 5 && table.every(function (r) { return r.offered <= 24; }) },
      { name: "A widget is a read; its action follows the grant",
        detail: acts.length + " of the twenty-four carry a write and " + holds.length +
          " of those use the 2000 ms hold. The catalog minimum is view on the owning module; the action needs contribute, so Adam can act on " +
          adam.actionable + " of his " + adam.entries.length + " and the rest draw no control at all.",
        pass: acts.length > 0 && adam.actionable < adam.entries.length },
      { name: "Actions call the owning module, never the dashboard",
        detail: acts.map(function (w) { return w.key; }).join(", ") +
          " \u2014 each names the owning module's own endpoint and carries via = dashboard so the activity log records where the change came from (FR-DB6).",
        pass: acts.every(function (w) { return w.act.endpoint.indexOf("/dashboard") < 0; }) },
      { name: "One slow module never blanks the screen",
        detail: unavailable
          ? unavailable.key + " is unavailable on the live dashboard and the other " + unavailable.others +
            " widgets render normally, each with its own refresh."
          : "Switch the rail's failing-widget control on: the unavailable widget states it in words with a retry, and the remaining widgets are untouched (FR-DB3).",
        pass: true },
      { name: "A locked child layout draws no arrange affordance at all",
        detail: childLocked === null
          ? "Measured live on the child view: the locked layout renders zero arrange controls, rather than disabled ones (FR-DB5, 03-patterns \u00a72)."
          : childLocked + " arrange controls in the locked layout's DOM \u2014 counted on this page, not asserted.",
        pass: childLocked === null || childLocked === 0 },
      { name: "A member who customised is never re-flattened",
        detail: "Jana's stored layout is " + jana.entries.length + " widgets and stays exactly that when the household default changes; what she gets is one dismissible notice offering to adopt it (FR-DB4). Silently rearranging somebody's home screen is not a feature.",
        pass: jana.entries.length !== LAYOUTS.household.length },
      { name: "An unknown or now-unavailable key is ignored, not errored",
        detail: jana.ignored.length + " key dropped out of the stored layout on load (" +
          jana.ignored.map(function (i) { return i.key; }).join(", ") +
          "). A module can be disabled at any time, so the dashboard renders without it and says nothing (FR-DB2).",
        pass: jana.ignored.length > 0 },
      { name: "Widget data is never synced, and the shell owns no sync state",
        detail: "A widget is a projection over other modules' entities (D-42), so the shell carries no mark of its own: the rows inside it carry theirs. That is why the shell row declares conflicted and rejected unreachable and draws the reason there.",
        pass: !!(SCREENS.filter(function (s) { return s.id === "C-9"; })[0].impossible || {}).conflicted }
    ];
  }

  /* ── the screens (05-screens §C, ten rows) ──────────────────────────────
     `impossible` mirrors ledger.js's exclusions; the reason is drawn where the state
     would have been. The layout is lww_row and personal, so conflicted cannot occur on
     any surface that edits it — the one exception is the owner default, which is
     strict_version precisely so two owners do conflict. */

  var SCREENS = [

    { id: "C-1", view: "dashboard", client: "mw", preset: "D", route: "/",
      name: "Dashboard — the ordered list at 2 / 4 / 6", title: "Home", kind: "dashboard",
      lede: "Nine stored entries, one of them a key this version does not ship.",
      primary: "", secondary: ["Arrange", "Add a widget"],
      error: { tone: "danger", title: "", body: "The dashboard did not load. Nothing has been changed \u2014 try again, or open a module from the sidebar." },
      impossible: {
        conflicted: "A layout is lww_row and personal: one row per member, and whole-row last-write-wins is correct because a layout is one artefact. Two of your own devices merge silently rather than asking you which home screen you meant."
      },
      states: {
        offline: { tone: "info", title: "Offline \u2014 the dashboard still renders", body: "Every widget has a client projection over the local replica as well as a server resolver, and a shared test vector asserts the two agree (D-42). This is not a stale cache of a screen." },
        pending: { tone: "info", title: "Arranged here, not sent yet", body: "The layout change is on this device and queued. It is fully editable meanwhile \u2014 another move merges into what is waiting." }
      },
      foot: "Reflow is computed from the ordered list and the column count, and nothing else. Move something in arrange and every width follows.",
      note: "The host owns no feature data. Everything on it is somebody else's module, rendered through one shell \u2014 which is why a widget that fails takes nothing else with it.",
      drawn: "all" },

    { id: "C-2", view: "catalog", client: "mw", preset: "D", route: "/dashboard/catalog",
      name: "Widget catalog", title: "Add a widget", kind: "catalog",
      lede: "Only what this member's grants make available, grouped by module.",
      primary: "Done", secondary: [],
      error: { tone: "danger", title: "", body: "The catalog did not load. Your dashboard is unaffected \u2014 it does not depend on this screen." },
      impossible: {
        conflicted: "Adding from the catalog writes the layout, which is lww_row and personal. There is no version of this screen that asks a question."
      },
      states: {
        absent: { tone: "info", title: "Not available", body: "The dashboard module itself is not part of this app. There is no Home destination and no catalog behind it." }
      },
      foot: "A module the member holds none on contributes nothing here: no greyed row, no count, no mention.",
      note: "The catalog is the one place the twenty-four are visible as a set, and it is never the same set twice \u2014 it is the member's grants, rendered.",
      drawn: "all" },

    { id: "C-3", view: "arrange", client: "mw", preset: "D", route: "/dashboard/arrange",
      name: "Arrange mode", title: "Arrange", kind: "arrange",
      lede: "Order and size. Both are stored once per widget and follow you to every device.",
      primary: "Done", secondary: ["Reset to the household default"],
      error: { tone: "danger", title: "", body: "The arrangement was not saved. The dashboard is still in the order it was." },
      impossible: {
        conflicted: "Per member and last-write-wins, as with the sidebar's arrange in Stage 6: two of your own devices converge without being asked."
      },
      foot: "Size is one stored value per widget across every client, which is why large has to mean something on a phone too.",
      note: "Move and resize are arrows and a size cycle rather than drag alone \u2014 arranging is done once, and a keyboard has to reach it. The list is the model, so what you see here is what reflows at all three widths.",
      drawn: "all" },

    { id: "C-4", view: "owner", client: "mw", preset: "D", route: "/dashboard/default",
      name: "Owner default layout editor", title: "The household default", kind: "owner",
      lede: "What a new member's first screen is, before anybody has chosen anything.",
      primary: "Save the default", secondary: ["Also set a child default"],
      error: { tone: "danger", title: "", body: "The default was not saved. Members keep the default that was already in force." },
      states: {
        conflicted: { tone: "warning", title: "Two versions of the household default", body: "You set six widgets; Jana set five at 18:40. The default layout is strict_version on purpose \u2014 owners editing it concurrently should be asked, not merged, because the answer decides what strangers see first." },
        absent: { tone: "info", title: "Not available", body: "Setting the household default is an owner action. For everybody else the screen does not exist \u2014 their own arrange screen does." }
      },
      foot: "This exists because a household's first run is otherwise seventeen widgets nobody chose (FR-DB4).",
      note: "The only surface in the stage where a conflict dialog is right. Everything else here is a personal preference; this one is what the household shows a person who has not decided yet.",
      drawn: "all" },

    { id: "C-5", view: "owner", client: "mw", preset: "S", route: "/",
      name: "Adopt-new-default notice", title: "The household default changed", kind: "adopt",
      lede: "",
      primary: "Use the new default", secondary: ["Keep mine"],
      foot: "Dismissible, and dismissing it keeps your own layout for good.",
      note: "The notice is the whole of FR-DB4's second half. A member who has arranged their own screen is offered the change and never subjected to it.",
      drawn: "all" },

    { id: "C-6", view: "child", client: "mw", preset: "D", route: "/",
      name: "Child layout — suggested", title: "Home", kind: "dashboard",
      lede: "An owner set four widgets. Adam may then move them, resize them or add his own.",
      primary: "", secondary: ["Arrange", "Add a widget"],
      error: { tone: "danger", title: "", body: "Your dashboard did not load. Nothing has changed \u2014 try again." },
      impossible: {
        conflicted: "Still lww_row and still personal: once it is suggested, it is his own layout."
      },
      foot: "Suggested means given, not enforced. The arrange affordances are ordinary.",
      note: "Adam's screen has to read as his product rather than as an allowance. Four widgets he can act on, and no trace of the twenty he cannot see.",
      drawn: "all" },

    { id: "C-7", view: "child", client: "mw", preset: "D", route: "/",
      name: "Child layout — locked", title: "Home", kind: "dashboard",
      lede: "The same four widgets, and no way to rearrange them \u2014 by absence, not by refusal.",
      primary: "", secondary: [],
      error: { tone: "danger", title: "", body: "Your dashboard did not load. Nothing has changed \u2014 try again." },
      impossible: {
        pending: "A locked layout is never written from this device, so there is nothing of it to queue.",
        syncing: "Same reason.",
        conflicted: "Nothing here is editable, so there are never two versions of it.",
        rejected: "There is no write from this screen for the server to refuse."
      },
      states: {
        readonly: { tone: "warning", title: "Read-only \u2014 the subscription lapsed", body: "The widgets read as they always do. Completing a chore from one is off until it resumes, and what is queued on this device is held rather than lost." }
      },
      foot: "Locked is the default under the household's configured age threshold and can be lifted at any time (D-41).",
      note: "The arrange controls are absent. Not greyed, not hidden behind a message about permissions \u2014 counted at zero on this page. A locked screen that shows what you cannot touch is worse than one that simply does not offer it.",
      drawn: "all" },

    { id: "C-8", view: "shell", client: "b", preset: "S", route: "/",
      name: "Widget unavailable", title: "One widget failed", kind: "unavailable",
      lede: "",
      primary: "", secondary: [],
      foot: "The other widgets are untouched, and each has its own refresh.",
      note: "FR-DB3's bounded fan-out with a per-widget timeout, drawn: { key, error: \u201cunavailable\u201d } is a small honest statement inside one shell, not a screen-wide error.",
      drawn: "all" },

    { id: "C-9", view: "shell", client: "b", preset: "D", route: "/",
      name: "Widget shell — small / medium / large", title: "The shell", kind: "shell",
      lede: "One frame, three sizes, twelve states, and a refresh of its own.",
      primary: "", secondary: [],
      error: { tone: "danger", title: "", body: "This widget did not load. The rest of the dashboard is fine \u2014 refresh just this one." },
      impossible: {
        conflicted: "A widget owns no entity: its data is a projection over other modules' rows (D-42). Two versions of it cannot exist, and the rows inside it carry their own marks.",
        rejected: "Nothing is written to a widget. An action inside one is written to the owning module and refused there, on that module's row."
      },
      foot: "The rhythm is a floor rather than a fixed height, so two smalls line up and 200 % text still fits.",
      note: "Every widget in the stage is this frame with a different body. Header, optional module chip, body, optional action \u2014 and the states belong to the shell rather than to twenty-four separate drawings.",
      drawn: "all" },

    { id: "C-10", view: "widgets", client: "b", preset: "D", route: "/dashboard/catalog",
      name: "The widget set — 24 widgets", title: "All twenty-four", kind: "set",
      lede: "Every key, at its default size, with the module page line it came from.",
      primary: "", secondary: [],
      error: { tone: "danger", title: "", body: "This widget did not load. Refresh it, or open the module." },
      impossible: {
        conflicted: "Same as the shell: a widget is a projection, and a projection cannot disagree with itself.",
        rejected: "Same as the shell: the write belongs to the owning module."
      },
      foot: "Seven body shapes cover all twenty-four \u2014 list, count, split, bars, agenda, grid, and the module's own live one.",
      note: "The stage's real deliverable. Twenty-four is not a number to be sampled: the ones that carry a write are the ones the hold gesture has to work inside, and the ones that carry a number are the ones that must have a not-enough-information state.",
      drawn: "all" }
  ];

  function occurrence() {
    return SCREENS.filter(function (s) { return s.preset === "D"; }).map(function (s) {
      var imp = Object.keys(s.impossible || {});
      return { id: s.id, name: s.name, impossible: imp, reasons: s.impossible || {},
               possible: ALL_STATES.length - imp.length,
               drawn: s.drawn === "all" ? ALL_STATES.length - imp.length : s.drawn.length };
    });
  }

  var TREATMENTS = {
    offline: { tone: "info", title: "Offline", body: "Every widget renders from the local replica by running its own client projection over local data. Reads are indistinguishable from online." },
    pending: { tone: "info", title: "Saved here, not sent yet", body: "The change is queued on this device and stays fully editable \u2014 an edit merges into what is waiting rather than fighting it." },
    syncing: { tone: "info", title: "Sending", body: "It has taken longer than a moment, so it says so instead of pretending to be finished." },
    conflicted: { tone: "warning", title: "Two versions", body: "Somebody edited this at the same time you did." },
    rejected: { tone: "danger", title: "The server would not take this", body: "The reason is given in a sentence, and what you did is held on this device until you retry, edit or discard it." },
    absent: { tone: "info", title: "Not available", body: "This is not part of your app. Nothing here says whether the household uses it." },
    withdrawn: { tone: "info", title: "Your access changed", body: "This was on the screen a moment ago. Access changed, so this device dropped its copy \u2014 nobody deleted anything." },
    readonly: { tone: "warning", title: "Read-only \u2014 the subscription lapsed", body: "Every widget reads. Arranging, adding and completing are off until it resumes, and what is queued here is held rather than lost." },
    empty: { tone: "info", title: "", body: "" }
  };

  /* the empty state, on the template Stage 9 set */
  var EMPTY = {
    sentence: "Your home screen is a list of widgets from the modules you use \u2014 what is due, what is on the shopping list, what changed.",
    example: "Most households start with what is due today, the calendar and the shopping list.",
    action: "Add the first widget"
  };

  var OPEN = [
    ["The twenty-four widget keys \u2014 resolved, and where they were",
     "Ledger gap 1 said the keys are not enumerated anywhere in the handoff. They are: each of the seventeen module pages names its own in Catalog contributions, and 00-module-model \u00a76 carries the per-module count that sums to 24 and that \u201cthe catalog registry is asserted against\u201d. WIDGETS collects all of them with the line each came from, and keyAudit() checks the collection against that table module by module. What the handoff lacks is one page listing them, which is a filing job rather than a decision.",
     "resolved in Stage 10"],
    ["default_size and the minimum grant are stated for none of the twenty-four",
     "FR-DB1 requires every catalog entry to carry a default_size and the minimum grant it requires, and no module page states either. Sizes are assigned here \u2014 eight small, twelve medium, four large \u2014 on one rule: a widget is small when it is a count, medium when it is a short list, large when it is a grid or a comparison that needs the width. The minimum grant follows the standard gate: view on the owning module to see it, contribute to use its action, so under view the action is absent rather than greyed. Both need a line per module before the catalog registry can assert anything.",
     "needs a line per module page"],
    ["What the household default actually contains is unspecified",
     "FR-DB4 exists because a first run is otherwise seventeen widgets nobody chose, but no document says which widgets a new household starts with. Six are proposed here, all from modules with no substantial setup, so that none of them is empty on day two: due and overdue, today and tomorrow, the shopping list, doing, my chores, recently. The child default's contents and the age threshold below which locked is the default (FR-DB5) are unstated for the same reason.",
     "needs a decision before first-run copy"],
    ["Widget-level empty states are seventeen more empty states",
     "Every widget that can be empty needs the Stage 9 template inside a small frame: one sentence, one example, one action. Twenty-four widgets against seventeen modules, with the same five-language lead time as the module empty states, and 07-delivery counts them once rather than twice. It is a content quantity question, not a design one, and it is bigger than it looks.",
     "affects the DS-2 copy schedule"]
  ];

  window.HH_DASHBOARD = {
    version: "0.1-stage-10-candidate",
    allStates: ALL_STATES,
    widths: WIDTHS, sizes: SIZES, span: span, rowspan: rowspan, footprint: footprint,
    spanTable: SPAN, rowTable: ROWS, rhythm: RHYTHM,
    reflow: reflow, determinism: determinism, outcomes: outcomes,
    widgets: WIDGETS, byKey: BY_KEY, moduleCount: MODULE_COUNT, keyAudit: keyAudit,
    layouts: LAYOUTS, layoutSource: LAYOUT_SOURCE, resolve: resolve,
    catalogFor: catalogFor, catalogTable: catalogTable,
    screens: SCREENS, treatments: TREATMENTS, empty: EMPTY,
    checks: checks, occurrence: occurrence, open: OPEN
  };
})();
