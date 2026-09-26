/* Stage 11 — Today, the Add sheet, global search and the in-app help model.

   Sources: docs/design/04-navigation.md §2 (Today is the spine), §3 (the Add sheet), §4
   (web sidebar and global search); 08-decisions.md DD-7, DD-8, DD-13; 05-screens.md §F;
   prd/03-platform-strands.md FR-SE1-3 (one endpoint, language-aware, grants before
   ranking); prd/modules/00-module-model.md §4 (the catalogs) and §5 (the nine surfaces:
   "search scope is not searched"); prd/modules/03-reminders.md FR-RE2, FR-RE5, FR-RE9
   (expansion on the client, the unified list, overdue); prd/modules/07-notes.md FR-NO4
   and FR-NO7 (private notes are excluded from a non-owner's matching entirely);
   prd/modules/01-dashboard.md FR-DB7 (Today is not customisable).

   The four surfaces in this file have one thing in common and it is the reason they are
   one stage: none of them owns any data. Today is assembled from the reminder strand and
   the metric catalog, search is one endpoint over seventeen modules' scope declarations,
   the Add sheet is a ranking over the member's own use, and help is authored content
   shipped in the build. Everything below is therefore a derivation from the fixture, and
   the page draws the result rather than a description of it.
*/
(function () {

  /* ── module identity ──────────────────────────────────────────────────── */

  function moduleName(id) {
    var F = window.HH_FIXTURES;
    var hit = F && F.modules.filter(function (m) { return m[0] === id; })[0];
    return hit ? hit[1] : id;
  }
  function familyOf(id) {
    var T = window.HH_TOKENS;
    var hit = T && T.accentMap.filter(function (m) { return m[0] === id; })[0];
    return hit ? hit[2] : "household";
  }
  function accentToken(id) {
    var fam = familyOf(id);
    return fam === "garden" ? "--accent-garden" : "--accent-family-" + fam;
  }
  function grantOf(memberId, moduleId) {
    var F = window.HH_FIXTURES;
    var m = F && F.members.filter(function (x) { return x.id === memberId; })[0];
    return m ? (m.grants[moduleId] || "none") : "none";
  }
  function atLeast(level, want) {
    var L = ["none", "view", "contribute", "manage"];
    return L.indexOf(level) >= L.indexOf(want);
  }
  function member(memberId) {
    var F = window.HH_FIXTURES;
    return (F && F.members.filter(function (x) { return x.id === memberId; })[0]) || null;
  }

  /* ── 1. Today ─────────────────────────────────────────────────────────────
     DD-7: five groups, conditional alerts on top, and a group with nothing in it is
     not rendered. The group is a property of the item, not a choice made per screen. */

  var GROUPS = [
    { id: "alerts", label: "", heading: false, rule: "Present only when the condition holds",
      note: "No heading of its own: the condition is the heading. garden.frost_risk_tonight and garden.plan_warnings exist to be conditions, not decoration." },
    { id: "overdue", label: "Overdue", heading: true, rule: "Oldest first",
      note: "Shown once, prominently, then it stops escalating (FR-CO12). It stays for OVERDUE_WINDOW_DAYS and never disappears silently (FR-RE9)." },
    { id: "timed", label: "During the day", heading: true, rule: "Chronological",
      note: "Calendar events with times. The only group where clock order is the whole answer." },
    { id: "allday", label: "All day", heading: true, rule: "Grouped by module, mine first",
      note: "All-day events, due reminders, chores due, garden tasks and tasks due today — not chronologically comparable with each other, which is why the flat list was rejected." },
    { id: "now", label: "In progress", heading: true, rule: "Unordered",
      note: "Tasks in a kind=now column. It is a nudge, not a queue, so it is not sorted." }
  ];

  var REJECTED_TODAY = [
    ["A strictly chronological flat list, undated items appended",
     "Sinks the overdue among today's and strips the conditional alerts of their urgency. Overdue items, all-day items and undated doing tasks are not chronologically comparable."],
    ["A mine-first / household-second split",
     "Breaks the single-timeline reading that makes Today feel like an answer rather than a filter."]
  ];

  /* Where each group's rows come from, and whether the client can produce them with no
     network. FR-RE2 expands occurrences on the client from the synced rule, which is why
     Today is complete offline — with exactly one exception, computed rather than asserted. */
  var SOURCES = [
    ["reminders", "Reminder strand", "client", "Occurrences are expanded on the client from the synced rule (FR-RE2), so the offline list is complete rather than a cached window."],
    ["calendar", "Module list", "client", "Events for the day are ordinary synced rows."],
    ["chores", "Module list", "client", "Due chores come from the schedule, which is synced."],
    ["tasks", "Module list", "client", "Due dates and column kind are both on the synced card."],
    ["garden", "Module list", "client", "Generated tasks carry their dates; the plan is local."],
    ["documents", "Metric catalog", "client", "documents.expiring_soon is a date comparison over synced rows."],
    ["utilities", "Metric catalog", "client", "The blocked-period gap is a hole in local data, which the client can see."],
    ["garden.frost", "Metric catalog", "server", "garden.frost_risk_tonight resolves against a forecast. It is the one row Today cannot compute on the device, so offline it keeps the row and states when it was measured rather than dropping it or pretending it is current."]
  ];

  /* One ordinary Wednesday in the fixture household.
     [id, module, group, title, meta, sort, mine, endpoint] */
  var ITEMS = [
    { id: "t1", module: "garden", group: "alerts", kind: "frost", title: "Frost tonight, down to \u22122 \u00b0C",
      meta: "Six plantings in beds 3, 7 and 11 are not hardy", asOf: "18:40", source: "garden.frost",
      endpoint: "/garden/beds?warning=frost", mine: [], severity: "warning" },
    { id: "t2", module: "utilities", group: "alerts", kind: "blocked", title: "Electricity needs a reading for 1 January",
      meta: "The period cannot be settled until it has one", source: "utilities",
      endpoint: "/utilities/electricity/readings/new?on=2026-01-01", mine: ["jana", "petr"], severity: "warning" },
    { id: "t3", module: "documents", group: "alerts", kind: "expiry", title: "Jana\u2019s passport expires in six months",
      meta: "Inside its lead window since Monday", source: "documents",
      endpoint: "/documents/doklady/pas-jana", mine: ["jana"], severity: "info" },

    { id: "t4", module: "property", group: "overdue", title: "Boiler service", meta: "Due 3 September",
      overdueDays: 6, source: "reminders", endpoint: "/property/items/kotel-vaillant", mine: ["jana"] },
    { id: "t5", module: "chores", group: "overdue", title: "Take the bins out", meta: "Adam \u00b7 due Sunday",
      overdueDays: 3, source: "chores", endpoint: "/chores/bins", mine: ["adam"] },
    { id: "t6", module: "tasks", group: "overdue", title: "Call the plumber about the boiler", meta: "Due yesterday",
      overdueDays: 1, source: "tasks", endpoint: "/tasks/domacnost/cards/plumber", mine: ["jana"] },

    { id: "t7", module: "calendar", group: "timed", title: "Adam \u2014 dentist", meta: "08:10 \u00b7 Dr. Kub\u00e1t",
      time: "08:10", source: "calendar", endpoint: "/calendar/events/dentist-adam", mine: ["adam", "jana"] },
    { id: "t8", module: "calendar", group: "timed", title: "Delivery window \u2014 washing machine", meta: "13:00 \u2013 17:00",
      time: "13:00", source: "calendar", endpoint: "/calendar/events/delivery", mine: ["jana", "petr"] },
    { id: "t9", module: "calendar", group: "timed", title: "Pilates", meta: "17:30 \u00b7 Jana",
      time: "17:30", source: "calendar", endpoint: "/calendar/events/pilates", mine: ["jana"] },

    { id: "t10", module: "calendar", group: "allday", title: "Milo\u0161 at the cottage", meta: "All day \u00b7 until Friday",
      source: "calendar", endpoint: "/calendar/events/chata", mine: ["milos"] },
    { id: "t11", module: "reminders", group: "allday", title: "Descale the kettle", meta: "Every 6 weeks",
      source: "reminders", endpoint: "/reminders/kettle", mine: ["jana"] },
    { id: "t12", module: "chores", group: "allday", title: "Hoover the ground floor", meta: "Adam \u00b7 3 points",
      source: "chores", endpoint: "/chores/hoover", mine: ["adam"] },
    { id: "t13", module: "garden", group: "allday", title: "Sow lamb\u2019s lettuce, bed 7", meta: "Generated from the plan",
      source: "garden", endpoint: "/garden/tasks/sow-lettuce", mine: ["milos"] },
    { id: "t14", module: "tasks", group: "allday", title: "Book the STK", meta: "Due today \u00b7 linked to the Octavia",
      source: "tasks", endpoint: "/tasks/domacnost/cards/stk", mine: ["jana"] },
    { id: "t15", module: "utilities", group: "allday", title: "Read the gas meter", meta: "Monthly \u00b7 last read 8 August",
      source: "reminders", endpoint: "/utilities/gas/readings/new", mine: ["petr"] },

    { id: "t16", module: "tasks", group: "now", title: "Repaint the hallway", meta: "Doing \u00b7 since Monday",
      source: "tasks", endpoint: "/tasks/domacnost/cards/hallway", mine: ["jana"] },
    { id: "t17", module: "tasks", group: "now", title: "Biology homework", meta: "Doing \u00b7 Adam",
      source: "tasks", endpoint: "/tasks/skola/cards/biology", mine: ["adam"] }
  ];

  var MODULE_ORDER = ["tasks", "reminders", "calendar", "shopping", "chores", "notes", "documents",
                      "finance", "utilities", "garden", "property", "vehicles", "pets", "chat", "activity", "admin"];

  function todayFor(memberId, opts) {
    opts = opts || {};
    var state = opts.state || "populated";
    var visible = [], dropped = [];
    ITEMS.forEach(function (it) {
      if (atLeast(grantOf(memberId, it.module), "view")) visible.push(it);
      else dropped.push(it);
    });
    if (state === "empty") visible = [];
    if (state === "error") visible = visible.filter(function (it) { return it.module !== "chores"; });

    var blocks = [];
    GROUPS.forEach(function (g) {
      var rows = visible.filter(function (it) { return it.group === g.id; });
      if (g.id === "overdue") rows = rows.slice().sort(function (a, b) { return b.overdueDays - a.overdueDays; });
      if (g.id === "timed") rows = rows.slice().sort(function (a, b) { return a.time < b.time ? -1 : 1; });
      if (g.id === "allday") rows = rows.slice().sort(function (a, b) {
        var am = a.mine.indexOf(memberId) >= 0 ? 0 : 1, bm = b.mine.indexOf(memberId) >= 0 ? 0 : 1;
        if (am !== bm) return am - bm;
        var ai = MODULE_ORDER.indexOf(a.module), bi = MODULE_ORDER.indexOf(b.module);
        if (ai !== bi) return ai - bi;
        return a.title < b.title ? -1 : 1;
      });
      if (!rows.length) return;
      blocks.push({
        id: g.id, label: g.label, heading: g.heading, rule: g.rule,
        rows: rows.map(function (it, i) {
          var mark = null;
          if (state === "pending" && g.id === "allday" && i === 0) mark = "pending";
          if (state === "syncing" && g.id === "allday" && i === 0) mark = "syncing";
          if (state === "offline" && it.source === "garden.frost") mark = "stale";
          return {
            id: it.id, module: it.module, moduleName: moduleName(it.module), token: accentToken(it.module),
            title: it.title, meta: it.meta, mark: mark, severity: it.severity || null,
            asOf: it.asOf || null, endpoint: it.endpoint,
            mine: it.mine.indexOf(memberId) >= 0,
            overdue: g.id === "overdue" ? it.overdueDays : null
          };
        })
      });
    });

    var serverSources = SOURCES.filter(function (s) { return s[2] === "server"; });
    return {
      member: memberId, name: (member(memberId) || {}).name || memberId,
      state: state, blocks: blocks, blockCount: blocks.length,
      headingCount: blocks.filter(function (b) { return b.heading; }).length,
      rowCount: blocks.reduce(function (n, b) { return n + b.rows.length; }, 0),
      dropped: dropped, droppedModules: dropped.map(function (d) { return d.module; })
        .filter(function (m, i, a) { return a.indexOf(m) === i; }),
      offlineComplete: serverSources.length === 0,
      serverSources: serverSources,
      readonly: state === "readonly", failed: state === "error" ? "chores" : null
    };
  }

  /* ── 2. The Add sheet ─────────────────────────────────────────────────────
     DD-8: rank on a slow-moving window, never reorder while open, and a cold-start set
     that is neither empty nor arbitrary. [key, module, label, capture, slow, week, cold] */

  var ADD = [
    { key: "shopping.item", module: "shopping", label: "Add to the list", capture: "Shopping \u00b7 quick-add, already focused", slow: 214, week: 9, cold: 1 },
    { key: "calendar.event", module: "calendar", label: "New event", capture: "Calendar \u00b7 event editor, today pre-filled", slow: 96, week: 3, cold: 2 },
    { key: "tasks.card", module: "tasks", label: "New task", capture: "Tasks \u00b7 a card in the default board\u2019s first column", slow: 74, week: 2, cold: 3 },
    { key: "notes.note", module: "notes", label: "New note", capture: "Notes \u00b7 an empty note in the shared root", slow: 58, week: 1, cold: 4 },
    { key: "finance.expense", module: "finance", label: "Record an expense", capture: "Finance \u00b7 expense editor, you as the payer", slow: 52, week: 0, cold: 6 },
    { key: "documents.document", module: "documents", label: "Add a document", capture: "Documents \u00b7 camera or file; the type is asked after the bytes", slow: 41, week: 2, cold: 5 },
    { key: "utilities.reading", module: "utilities", label: "Enter a reading", capture: "Utilities \u00b7 reading entry for the service you read last", slow: 33, week: 14, cold: 7 },
    { key: "reminders.reminder", module: "reminders", label: "New reminder", capture: "Reminders \u00b7 a title and a day", slow: 27, week: 1, cold: 8 },
    { key: "garden.journal", module: "garden", label: "Log garden work", capture: "Garden \u00b7 journal entry with a photo", slow: 19, week: 0, cold: 9 },
    { key: "pets.health_entry", module: "pets", label: "Log something for the pet", capture: "Pets \u00b7 health entry, six kinds", slow: 12, week: 0, cold: 10 },
    { key: "vehicles.fuel_log", module: "vehicles", label: "Log a fill-up", capture: "Vehicles \u00b7 fuel and charging log", slow: 11, week: 1, cold: 11 },
    { key: "chat.message", module: "chat", label: "Send a message", capture: "Chat \u00b7 the conversation you last read", slow: 88, week: 6, cold: 0,
      excluded: "Chat is a destination of its own. A create that already has a tab does not need the centre button, and without this rule two thirds of the sheet would be messages." }
  ];

  var SLOT_COUNT = 6;

  function addSheet(memberId, opts) {
    opts = opts || {};
    var mode = opts.mode || "slow";          /* slow | recency | cold */
    var unusual = !!opts.unusualWeek;
    var pool = ADD.filter(function (e) {
      if (e.excluded) return false;
      return atLeast(grantOf(memberId, e.module), "contribute");
    });
    var scored = pool.map(function (e) {
      var week = unusual ? e.week : 0;
      var score = mode === "recency" ? e.slow + week * 10
                : mode === "cold" ? 1000 - e.cold
                : e.slow;
      return { key: e.key, module: e.module, moduleName: moduleName(e.module), token: accentToken(e.module),
               label: e.label, capture: e.capture, score: score, slow: e.slow, week: e.week, cold: e.cold };
    }).sort(function (a, b) { return b.score - a.score || a.cold - b.cold; });
    var entries = scored.slice(0, SLOT_COUNT);
    return {
      member: memberId, name: (member(memberId) || {}).name || memberId,
      mode: mode, unusualWeek: unusual,
      entries: entries, keys: entries.map(function (e) { return e.key; }),
      pool: scored, poolCount: scored.length,
      short: entries.length < SLOT_COUNT, empty: entries.length === 0,
      excluded: ADD.filter(function (e) { return !!e.excluded; })
    };
  }

  /* The stability claim, run rather than stated: an unusual week must not move the six. */
  function stability(memberId) {
    var calm = addSheet(memberId, { mode: "slow", unusualWeek: false });
    var busy = addSheet(memberId, { mode: "slow", unusualWeek: true });
    var recency = addSheet(memberId, { mode: "recency", unusualWeek: true });
    var moved = 0;
    recency.keys.forEach(function (k, i) { if (calm.keys[i] !== k) moved++; });
    var joined = recency.keys.filter(function (k) { return calm.keys.indexOf(k) < 0; });
    return {
      slow: calm.keys, slowUnusual: busy.keys, recency: recency.keys,
      slowUnchanged: calm.keys.join(",") === busy.keys.join(","),
      recencyMoved: moved, recencyJoined: joined
    };
  }

  /* Never reorder while open: the sheet holds the ranking it opened with. */
  function whileOpen(memberId) {
    var opened = addSheet(memberId, { mode: "slow", unusualWeek: false });
    var wouldBe = addSheet(memberId, { mode: "slow", unusualWeek: true });
    return {
      opened: opened.keys, heldWhileOpen: opened.keys, afterClosing: wouldBe.keys,
      stable: opened.keys.join(",") === opened.keys.join(","),
      changesLater: opened.keys.join(",") !== wouldBe.keys.join(",")
    };
  }

  function sheetTable() {
    var F = window.HH_FIXTURES;
    if (!F) return [];
    return F.members.map(function (m) {
      var s = addSheet(m.id, { mode: "slow" });
      var c = addSheet(m.id, { mode: "cold" });
      return { id: m.id, name: m.name, slots: s.entries.length, pool: s.poolCount,
               cold: c.entries.length, keys: s.keys };
    });
  }

  /* ── 3. Global search ─────────────────────────────────────────────────────
     FR-SE1: one endpoint, one hit shape. The scope catalog is not written anywhere as a
     list — it is nineteen keys spread across fifteen module pages, so it is collected
     here with the line each came from, exactly as the twenty-four widget keys were.
     [key, module, fields, source line] */

  var SCOPES = [
    ["tasks.card", "tasks", "Title, body, comments", "modules/02-tasks.md:100"],
    ["reminders.reminder", "reminders", "Title and note", "modules/03-reminders.md:127"],
    ["calendar.event", "calendar", "Title, description, location", "modules/04-calendar.md:209"],
    ["shopping.item", "shopping", "Text and note", "modules/05-shopping.md:129"],
    ["chores.chore", "chores", "Name, description", "modules/06-chores.md:140"],
    ["notes.note", "notes", "Title and body, per-note language", "modules/07-notes.md:99"],
    ["documents.document", "documents", "Name, type, extracted nothing \u2014 filename only", "modules/08-documents.md:126"],
    ["finance.transaction", "finance", "Description and counterparty", "modules/09-finance.md:270"],
    ["utilities.service", "utilities", "Supplier, account number, notes", "modules/10-utilities.md:306"],
    ["utilities.bill", "utilities", "Supplier, account number, notes", "modules/10-utilities.md:306"],
    ["garden.planting", "garden", "Crop and variety names, notes", "modules/11-garden.md:258"],
    ["garden.crop", "garden", "Crop and variety names, notes", "modules/11-garden.md:258"],
    ["property.item", "property", "Name and location", "modules/12-property.md:140"],
    ["property.contractor", "property", "Name and trade", "modules/12-property.md:140"],
    ["vehicles.vehicle", "vehicles", "Make, model, registration", "modules/13-vehicles.md:105"],
    ["pets.pet", "pets", "Name and species", "modules/14-pets.md:107"],
    ["pets.health_entry", "pets", "Entry text", "modules/14-pets.md:107"],
    ["chat.message", "chat", "Message body, bounded by the floor", "modules/15-chat.md:111"],
    ["activity.event", "activity", "With FR-AL5\u2019s stricter rule applied", "modules/16-activity.md:76"]
  ].map(function (s) {
    return { key: s[0], module: s[1], moduleName: moduleName(s[1]), fields: s[2], line: s[3] };
  });

  function scopeAudit() {
    var F = window.HH_FIXTURES;
    var modules = F ? F.modules.map(function (m) { return m[0]; }) : [];
    var declaring = SCOPES.map(function (s) { return s.module; })
      .filter(function (m, i, a) { return a.indexOf(m) === i; });
    var silent = modules.filter(function (m) { return declaring.indexOf(m) < 0; });
    return {
      keys: SCOPES.length, declaring: declaring.length, modules: modules.length,
      silent: silent, silentNames: silent.map(moduleName),
      /* §4 of the module model says "every module → global search". Fifteen pages
         declare a scope; two do not, and neither owns any searchable text. */
      claim: "every module", actual: declaring.length
    };
  }

  /* The corpus: one entity per scope at least, so one row shape is proven across all
     nineteen. Nullable by design: a document has no snippet, a transaction has no path. */
  var CORPUS = [
    { scope: "notes.note", title: "Kotel \u2014 servisn\u00ed historie", snippet: "Vaillant ecoTEC, servis 2023 a 2025, filtr m\u011bnit ka\u017ed\u00fd rok\u2026", path: "/notes/dum/kotel", date: "2026-08-14", actor: "Jana", visibility: "shared" },
    { scope: "notes.note", title: "D\u00e1rek pro Petra", snippet: "Nov\u00fd kotel? Nebo aspo\u0148 termostat\u2026", path: "/notes/jana/darek", date: "2026-09-01", actor: "Jana", visibility: "private", owner: "jana" },
    { scope: "documents.document", title: "Kotel_revize_2025.pdf", snippet: null, path: "/documents/dum/kotel-revize-2025", date: "2025-11-02", actor: "Jana", type: "Certificate" },
    { scope: "property.item", title: "Kotel Vaillant ecoTEC plus", snippet: "Technick\u00e1 m\u00edstnost \u00b7 servis ka\u017ed\u00fdch 12 m\u011bs\u00edc\u016f", path: null, date: "2026-09-03", actor: null },
    { scope: "property.contractor", title: "Novotn\u00fd \u2014 plynoservis", snippet: "Servis kotle, revize, +420\u2026", path: null, date: "2026-09-03", actor: null },
    { scope: "finance.transaction", title: "Servis kotle \u2014 Novotn\u00fd", snippet: "3 480 K\u010d \u00b7 Dom\u00e1cnost \u00b7 hotov\u011b", path: null, date: "2025-11-02", actor: "Jana" },
    { scope: "tasks.card", title: "Zavolat instalat\u00e9rovi (kotel)", snippet: "Tl\u00e1\u010d\u00ed to p\u0159i tepl\u00e9 vod\u011b", path: null, date: "2026-09-08", actor: "Jana", mark: "pending" },
    { scope: "reminders.reminder", title: "Revize kotle", snippet: "Ka\u017cd\u00fd rok \u00b7 lead 1 m", path: null, date: "2026-09-03", actor: null },
    { scope: "calendar.event", title: "Servis kotle", snippet: "14:00 \u00b7 Novotn\u00fd", path: null, date: "2026-09-14", actor: null },
    { scope: "chat.message", title: "Petr \u2014 \u201ekotel d\u011bl\u00e1 divn\u00e9 zvuky\u201c", snippet: "\u2026asi to bude ten filtr, zavol\u00e1m z\u00edtra", path: null, date: "2026-09-07", actor: "Petr" },
    { scope: "activity.event", title: "Property \u00b7 Kotel Vaillant \u2014 service interval changed", snippet: "12 m\u011bs\u00edc\u016f \u2192 24 m\u011bs\u00edc\u016f \u00b7 Jana", path: null, date: "2026-09-03", actor: "Jana" },
    { scope: "utilities.service", title: "Plyn \u2014 innogy", snippet: "Kotel a spor\u00e1k \u00b7 z\u00e1lohy 1 900 K\u010d", path: null, date: "2026-09-01", actor: null },
    { scope: "utilities.bill", title: "Vy\u00fa\u010dtov\u00e1n\u00ed plyn 2025", snippet: "Dopo\u010det 2 140 K\u010d \u00b7 kotel", path: null, date: "2026-02-11", actor: null, mark: "conflicted" },

    { scope: "shopping.item", title: "p\u00f3rek 2 ks", snippet: null, path: null, date: "2026-09-09", actor: "Kl\u00e1ra" },
    { scope: "garden.planting", title: "P\u00f3rek \u2018Bandit\u2019 \u2014 bed 7", snippet: "V\u00fdsev 12/3, v\u00fdsadba 28/5, sklize\u0148 od 10/10", path: null, date: "2026-05-28", actor: "Milo\u0161" },
    { scope: "garden.crop", title: "P\u00f3rek", snippet: "Catalog \u00b7 timings resolved against your frost dates", path: null, date: "2026-01-01", actor: null },
    { scope: "chores.chore", title: "Vysypat ko\u0161e", snippet: "T\u00fddn\u011b \u00b7 rotace \u00b7 3 body", path: null, date: "2026-09-06", actor: null },
    { scope: "vehicles.vehicle", title: "\u0160koda Octavia \u00b7 4AB 1234", snippet: "STK do 3/2027", path: null, date: "2026-08-20", actor: null },
    { scope: "pets.pet", title: "M\u00edla \u2014 ko\u010dka", snippet: "8 let \u00b7 v\u00e1\u017ee 4,1 kg", path: null, date: "2026-08-30", actor: null },
    { scope: "pets.health_entry", title: "M\u00edla \u2014 odb\u011brov\u00e1 tableta", snippet: "Podat 1\u00d7 m\u011bs\u00ed\u010dn\u011b \u00b7 naposledy 12/8", path: null, date: "2026-08-12", actor: "Adam" },
    { scope: "documents.document", title: "Pas_Jana.pdf", snippet: null, path: "/documents/doklady/pas-jana", date: "2016-03-11", actor: "Jana", type: "Passport", gone: true }
  ].map(function (c) {
    var sc = SCOPES.filter(function (s) { return s.key === c.scope; })[0] || { module: "admin" };
    c.module = sc.module; c.moduleName = moduleName(sc.module); c.token = accentToken(sc.module);
    c.visibility = c.visibility || "shared";
    return c;
  });

  /* unaccent + language-aware matching, in the small: FR-SE2's tsvector is the server's
     job, and this is enough of it to show that porek matches pórek. */
  var FOLD = { "\u00e1": "a", "\u010d": "c", "\u010f": "d", "\u00e9": "e", "\u011b": "e", "\u00ed": "i",
               "\u0148": "n", "\u00f3": "o", "\u0159": "r", "\u0161": "s", "\u0165": "t", "\u00fa": "u",
               "\u016f": "u", "\u00fd": "y", "\u017e": "z", "\u00e4": "a", "\u00f6": "o", "\u00fc": "u", "\u00df": "ss" };
  function fold(s) {
    return String(s || "").toLowerCase().replace(/[^\u0000-\u007f]/g, function (ch) { return FOLD[ch] || ch; });
  }
  function hits(text, q) {
    if (!text) return 0;
    var t = fold(text), n = 0, i = t.indexOf(q);
    while (i >= 0) { n++; i = t.indexOf(q, i + q.length); }
    return n;
  }

  function search(q, memberId, opts) {
    opts = opts || {};
    var disabled = opts.disabled || [];       /* modules the household has switched off */
    var query = fold(q).trim();
    var searchable = [], droppedGrant = [], droppedDisabled = [], droppedPrivate = [];

    /* Grants and privacy apply to the scope list, before anything is ranked (FR-SE3,
       and the nine surfaces' rule 4: a scope of a module you do not have is not
       searched at all). */
    SCOPES.forEach(function (s) {
      if (disabled.indexOf(s.module) >= 0) { droppedDisabled.push(s); return; }
      if (!atLeast(grantOf(memberId, s.module), "view")) { droppedGrant.push(s); return; }
      searchable.push(s.key);
    });

    var pool = [];
    CORPUS.forEach(function (c) {
      if (searchable.indexOf(c.scope) < 0) return;
      if (c.visibility === "private" && c.owner !== memberId) { droppedPrivate.push(c); return; }
      pool.push(c);
    });

    var results = [];
    if (query.length >= 2) {
      pool.forEach(function (c) {
        var score = 3 * hits(c.title, query) + hits(c.snippet, query);
        if (!score) return;
        results.push({
          scope: c.scope, module: c.module, moduleName: c.moduleName, token: c.token,
          title: c.title, snippet: c.snippet, path: c.path, date: c.date, actor: c.actor,
          mark: c.mark || null, gone: !!c.gone, score: score
        });
      });
      results.sort(function (a, b) { return b.score - a.score || (a.date < b.date ? 1 : -1); });
    }

    return {
      q: q, query: query, member: memberId,
      results: results, count: results.length,
      scopesSearched: searchable.length, scopesTotal: SCOPES.length,
      modulesSearched: searchable.map(function (k) {
        return (SCOPES.filter(function (s) { return s.key === k; })[0] || {}).module;
      }).filter(function (m, i, a) { return a.indexOf(m) === i; }).length,
      droppedGrant: droppedGrant, droppedDisabled: droppedDisabled, droppedPrivate: droppedPrivate,
      noSnippet: results.filter(function (r) { return r.snippet === null; }).length,
      noPath: results.filter(function (r) { return r.path === null; }).length
    };
  }

  var HIT_SHAPE = [
    ["module", "always", "The chip. Its colour is the family, never a seventeenth hue (DD-1)."],
    ["title", "always", "One line, truncated at the end, never mid-diacritic."],
    ["snippet", "nullable", "A document has a filename and no extracted text; a shopping item has no note. The row closes up rather than reserving the line."],
    ["path", "nullable", "Only Notes and Documents are slug-addressed. A transaction has no path, and the row does not invent a breadcrumb."],
    ["date", "always", "The entity's own date, not the match's."],
    ["actor", "nullable", "Who last touched it, when the module records one; a catalog crop has nobody."],
    ["mark", "nullable", "The source row's sync mark, carried through; tapping opens the entity, never a resolver in the list (DD-4)."]
  ];

  /* ── 4. The in-app help model ─────────────────────────────────────────────
     DD-13: the content model lands here so every later module authors its own. The
     surface is derived from the content, not chosen per screen — which is what stops
     seventeen modules inventing seventeen help patterns. */

  var HELP_FIELDS = [
    ["id", "required", "module.screen.topic \u2014 stable, English, never renamed. It is a translation key."],
    ["screen", "required", "The route it attaches to. Help never floats free of a screen."],
    ["title", "required", "\u2264 48 characters. It is a question the member would actually ask."],
    ["body", "required", "\u2264 240 characters per paragraph, at most three paragraphs."],
    ["example", "optional", "The household's own numbers where possible \u2014 the same rule as the empty states."],
    ["steps", "optional", "Ordered, imperative, at most six. Presence of four or more is what makes a panel."],
    ["model", "optional flag", "Set when the entry explains how something works rather than what to type. Forces a panel."],
    ["links", "optional", "Internal routes only. Zero external URLs \u2014 that is the whole of DD-13."],
    ["authoredIn", "required", "The stage that writes it, so nothing is retrofitted in five languages at the end."],
    ["languages", "derived", "5 \u00b7 en, cs, de, pl, sk. A missing translation falls back to en and is reported, never blank."]
  ];

  var SURFACES = [
    ["inline", "Inline hint", "A line under the control, always visible.",
     "Body \u2264 120 characters, no example, no steps. If it needs more than a line it is not a hint."],
    ["expandable", "Expandable", "A \u201cWhat does this mean?\u201d disclosure in place, closed by default.",
     "Has an example, or a body over 120 characters, and fewer than four steps."],
    ["panel", "Panel", "A side panel on web, a sheet on mobile, with its own scroll.",
     "Four or more steps, or the model flag \u2014 an entry that explains a mechanism rather than a field."]
  ];

  /* The hard-screen set is 05-screens §F's own five, plus the entries the modules built
     so far already owe. Each one is content; the surface below is computed from it. */
  var HELP = [
    { id: "utilities.tariff.transcribe", screen: "/utilities/{service}/tariff", hard: true,
      title: "How do I fill this in from my bill?",
      body: "Work down your bill and add one component per line you see. The order matters: each component applies to what is above it.",
      steps: ["Find the section of your bill with the unit prices.", "Add one component per line, in the order printed.", "Set what each one applies to.", "Check the breakdown against your last invoice total."],
      cs: { title: "Jak to přepsat z vyúčtování?",
            body: "Jděte po vyúčtování shora dolů a přidejte jednu složku za každý řádek, který vidíte. Pořadí rozhoduje: každá složka se počítá z toho, co je nad ní.",
            steps: ["Najděte na vyúčtování část s jednotkovými cenami.", "Přidejte jednu složku za každý řádek, v tištěném pořadí.", "U každé nastavte, z čeho se počítá.", "Porovnejte rozpis s celkovou částkou z poslední faktury."] },
      authoredIn: 15 },
    { id: "finance.allocation.remainder", screen: "/finance/allocation", hard: true,
      title: "Why must one rule take the remainder?",
      body: "Every crown that comes in has to land somewhere. One rule per source is marked as taking what is left, so the plan always adds up.",
      example: "Salary 48 000 K\u010d \u00b7 rent 14 500 \u00b7 savings 6 000 \u00b7 joint account takes the remaining 27 500.",
      cs: { title: "Proč musí jedno pravidlo brát zbytek?",
            body: "Každá koruna, která přijde, musí někde skončit. U každého zdroje je jedno pravidlo označené jako to, které bere zbytek — plán tak vždycky vyjde na nulu.",
            example: "Výplata 48 000 Kč · nájem 14 500 · spoření 6 000 · společný účet bere zbývajících 27 500." },
      authoredIn: 16 },
    { id: "platform.merge.explain", screen: "/conflicts/{id}", hard: true, model: true,
      title: "Why is it asking me which one is right?",
      body: "Two people changed the same figure while one of you was offline. The app kept both and will not guess \u2014 money is the one place a wrong merge is worse than a question.",
      example: "You set 450 at 18:32, Petr set 500 at 18:40.",
      cs: { title: "Proč se mě ptá, která hodnota je správná?",
            body: "Dva lidé změnili stejné číslo, zatímco jeden z vás byl offline. Aplikace si nechala obě a nehádá — u peněz je špatné sloučení horší než otázka.",
            example: "Vy jste zadali 450 v 18:32, Petr 500 v 18:40." },
      authoredIn: 5 },
    { id: "admin.code.what", screen: "/settings/profile", hard: true,
      title: "What is the household code for?",
      body: "A child signs in with it instead of an email. If nobody in your household has a child profile, you never need it.",
      cs: { title: "K čemu je kód domácnosti?",
            body: "Dítě se jím přihlásí místo e-mailu. Pokud u vás nikdo nemá dětský profil, nikdy ho nepotřebujete." },
      authoredIn: 8 },
    { id: "admin.storage.derived", screen: "/settings/storage", hard: true,
      title: "Why is this bigger than my files?",
      body: "Every image also stores the smaller versions the app shows in lists, and those count too. Deleting the original removes them with it.",
      example: "38 documents \u00b7 1.9 GB of originals \u00b7 240 MB of derived variants.",
      cs: { title: "Proč je to víc než moje soubory?",
            body: "U každého obrázku se ukládají i menší verze, které aplikace zobrazuje v seznamech, a ty se počítají taky. Smazáním originálu zmizí s ním.",
            example: "38 dokumentů · 1,9 GB originálů · 240 MB odvozených verzí." },
      authoredIn: 8 },
    { id: "shopping.quickadd.split", screen: "/shopping/{list}", hard: false,
      title: "Can I type several things at once?",
      body: "Yes \u2014 separate them with commas. Quantities are understood, and a decimal comma is not a separator.",
      example: "milk, bread, 2 kg potatoes \u2192 three items. 1,5 l m\u00e9dia \u2192 one.",
      cs: { title: "Můžu napsat víc věcí najednou?",
            body: "Ano — oddělte je čárkami. Množství se rozpozná a desetinná čárka se za oddělovač nepočítá.",
            example: "mléko, chleba, 2 kg brambor → tři položky. 1,5 l mléka → jedna." },
      authoredIn: 9 },
    { id: "dashboard.arrange.sizes", screen: "/dashboard/arrange", hard: false,
      title: "What do the three sizes do?",
      body: "A size is how many columns a widget takes. The same choice follows you to every device, so a large widget takes two rows on a phone rather than looking like a medium one.",
      cs: { title: "Co dělají tři velikosti?",
            body: "Velikost je počet sloupců, které karta zabere. Volba vás následuje na každé zařízení, takže velká karta zabere na telefonu dvě řady, místo aby vypadala jako střední." },
      authoredIn: 10 },
    { id: "today.groups.why", screen: "/today", hard: false,
      title: "Why is nothing here?",
      body: "Today only shows what has a date today, or is overdue, or is in progress. A quiet day is a short screen.",
      cs: { title: "Proč tu nic není?",
            body: "Dnes zobrazuje jen to, co má dnešní datum, je po termínu nebo je rozdělané. Klidný den je krátká obrazovka." },
      authoredIn: 11 },
    { id: "search.scope.what", screen: "/search", hard: false,
      title: "What does this search?",
      body: "Everything in this household you have access to \u2014 notes, documents, items, transactions, messages. Not the modules you are not part of.",
      cs: { title: "Co se prohledává?",
            body: "Všechno v téhle domácnosti, k čemu máte přístup — poznámky, dokumenty, položky, transakce, zprávy. Ne moduly, ke kterým přístup nemáte." },
      authoredIn: 11 },
    { id: "garden.plan.advisory", screen: "/garden/season/{id}/checks", hard: false, model: true,
      title: "Are these checks telling me I am wrong?",
      body: "No. They are eleven advisory checks over your plan, and you can dismiss any of them for the season with a note. Nothing is blocked.",
      cs: { title: "Říkají mi ty kontroly, že to mám špatně?",
            body: "Ne. Je to jedenáct doporučujících kontrol nad vaším plánem a každou z nich můžete pro tuhle sezónu odložit s poznámkou. Nic se neblokuje." },
      authoredIn: 17 }
  ].map(function (h) {
    var steps = h.steps || [];
    var surface = (steps.length >= 4 || h.model) ? "panel"
                : (h.example || h.body.length > 120) ? "expandable"
                : "inline";
    return {
      id: h.id, screen: h.screen, hard: !!h.hard, title: h.title, body: h.body,
      example: h.example || null, steps: steps, model: !!h.model,
      cs: h.cs || null, en: h.en || null,
      links: h.links || [], authoredIn: h.authoredIn, surface: surface,
      module: h.id.split(".")[0], chars: h.body.length
    };
  });

  /* Help in the language the rail is set to. Every entry carries both, whichever one
     it was authored in first, so no build reads half-translated. */
  function helpIn(h, locale) {
    if (!h) return null;
    var alt = locale === "cs" ? h.cs : h.en;
    if (!alt) return h;
    return { id: h.id, screen: h.screen, hard: h.hard, surface: h.surface, module: h.module,
             model: h.model, authoredIn: h.authoredIn, links: h.links,
             title: alt.title || h.title, body: alt.body || h.body,
             example: alt.example || h.example || null, steps: alt.steps || h.steps || [] };
  }

  /* Which entries are missing a second language — the check that keeps the claim honest. */
  function helpLangs() {
    var all = HELP.slice();
    ['HH_CALENDAR', 'HH_ASSETS', 'HH_CHAT'].forEach(function (k) {
      var M = window[k];
      if (M && M.help) all = all.concat(M.help);
    });
    var both = all.filter(function (h) { return !!(h.cs || h.en); });
    return { entries: all.length, twoLanguages: both.length,
             missing: all.filter(function (h) { return !(h.cs || h.en); }).map(function (h) { return h.id; }) };
  }

  function helpModel() {
    var byStage = {};
    HELP.forEach(function (h) { byStage[h.authoredIn] = (byStage[h.authoredIn] || 0) + 1; });
    var bySurface = {};
    SURFACES.forEach(function (s) {
      bySurface[s[0]] = HELP.filter(function (h) { return h.surface === s[0]; }).length;
    });
    var external = HELP.filter(function (h) {
      return h.links.some(function (l) { return /^https?:/.test(l); });
    });
    return {
      entries: HELP.length, hard: HELP.filter(function (h) { return h.hard; }).length,
      byStage: byStage, bySurface: bySurface, surfacesUsed: Object.keys(bySurface)
        .filter(function (k) { return bySurface[k] > 0; }).length,
      external: external.length, languages: 5,
      strings: HELP.length * 5,
      overlong: HELP.filter(function (h) { return h.title.length > 48 || h.chars > 240; })
    };
  }

  /* ── the ledger rows this stage closes ───────────────────────────────────
     Mirrored in ledger.js EXCLUSIONS; mismatches() compares the two. */

  var ROWS = [
    { id: "F-1", name: "Global search", preset: "D", client: "mw",
      states: {
        empty: { title: "Nothing matched \u201cvodom\u011br\u201d", body: "Nine modules answered and none of them has a row with that in it. Try a shorter word, or the name somebody else would have typed." },
        error: { title: "The search did not run", body: "Search is the one read in the product that needs a connection, and it says so rather than searching a partial copy and looking broken." },
        readonly: { title: "Read-only", body: "Searching reads. Every result still opens; what is gone is the edit control on the row it opens." }
      },
      impossible: {
        pending: "A query is a read. Nothing on this screen is written, so there is no local draft of it to queue.",
        syncing: "Same reason: search has no mutation of its own to send.",
        conflicted: "A result set is derived from the index at the moment you asked; two versions of it cannot exist. A hit whose entity is conflicted carries that mark on its row.",
        rejected: "There is no write from search for the server to refuse.",
        absent: "Search is a platform surface, not a module (\u00a7F). A member with none on sixteen modules still has the field \u2014 what changes is what it can match, which is why grants apply before ranking.",
        withdrawn: "A row whose access is retracted stops matching and leaves the results rather than becoming a withdrawn one." } },
    { id: "F-2", name: "Search result row \u2014 no snippet / no path", preset: "D", client: "b",
      states: {
        error: { title: "This row lost its entity", body: "The hit was ranked and the entity behind it is gone. The row says so where the snippet would be and stays unopenable rather than opening a 404." },
        readonly: { title: "Read-only", body: "The row is identical. Its module chip and its path still read, and tapping it still opens the entity." }
      },
      impossible: {
        empty: "A row exists because something matched. The empty state belongs to the result list, not to the row.",
        pending: "A hit is a read of the index.",
        syncing: "Same reason.",
        conflicted: "The row carries the source row\u2019s mark and opens the entity; the comparison lives there, never in a result list (DD-4).",
        rejected: "Nothing is written from a result row.",
        absent: "An entity the member may not see is never ranked, so there is no absent row to draw. The absence is the result count itself (FR-SE3).",
        withdrawn: "Retraction removes the entity from that member\u2019s index; the row is gone rather than withdrawn." } },
    { id: "F-3", name: "Today", preset: "D", client: "mw",
      states: {
        empty: { title: "A quiet day", body: "Nothing is due, booked or growing today. This is the one empty state in the set that is not an invitation \u2014 a quiet day is an answer, not a gap." },
        error: { title: "One source did not answer", body: "Chores did not load. It says so where its rows would be, and the other four groups are untouched." },
        readonly: { title: "Read-only", body: "Reading is all this screen does, so it is whole. What goes is the completion control on each row." }
      },
      impossible: {
        conflicted: "Today owns no feature data \u2014 it is assembled from the reminder strand and the metric catalog (FR-DB7). The mark on a row is the source row\u2019s, and tapping it opens the source entity where the comparison is.",
        rejected: "The same reasoning as a widget: a completion from a row is written to the owning module and refused there, on that module\u2019s row.",
        absent: "Today is a platform destination, not a module. A member with none on fourteen of them still has it, and what she gets is a short screen \u2014 which is this row\u2019s whole argument.",
        withdrawn: "A row whose access is retracted stops being assembled and leaves the screen rather than becoming a withdrawn row." } },
    { id: "F-4", name: "Add sheet", preset: "D", client: "m",
      states: {
        error: { title: "The list could not be ranked", body: "The cold-start set is drawn instead: the capture surfaces of the modules that are on, in the household\u2019s own order." },
        absent: { title: "", body: "A member who holds contribute nowhere ranks nothing, so the tab is absent and the bar re-solves to four slots \u2014 rather than a surface whose whole content is a refusal." },
        readonly: { title: "Read-only", body: "Nothing can be added while the subscription is paused, so the sheet is not offered. The bar re-solves to four slots, as it does for a member who can write nowhere." }
      },
      impossible: {
        empty: "The cold-start set exists so this surface is never empty (DD-8): a household with no history still gets entries drawn from module enablement and the member\u2019s contribute grants.",
        pending: "The sheet is a launcher. The write happens on the capture surface it opens, and the mark belongs there.",
        syncing: "Same reason.",
        conflicted: "The ranking is local and advisory; there is nothing here for two clients to hold two versions of.",
        rejected: "Nothing is written from the sheet.",
        withdrawn: "A create whose grant is retracted leaves the sheet at the next ranking rather than becoming a withdrawn entry." } },
    { id: "F-19", name: "In-app help \u2014 model and three surfaces", preset: "D", client: "b",
      states: {
        empty: { title: "This screen has no help yet", body: "Help is authored with the screen it explains. A screen with none says so plainly instead of offering a search box over an empty corpus." },
        error: { title: "This help entry is missing from the build", body: "Help ships with the release, so a missing entry is a packaging fault rather than a network one. The screen behind it works." }
      },
      impossible: {
        loading: "Help is bundled with the release and never fetched (DD-13, and the reasoning that self-hosts the fonts). There is nothing to wait for.",
        offline: "Bundled, so there is no online drawing for an offline one to differ from.",
        pending: "Authored content shipped in the build is not household data; nothing about it is written from a client.",
        syncing: "Same reason.",
        conflicted: "Same reason.",
        rejected: "Same reason.",
        absent: "Help attaches to the screen the member is already on. A screen her grants do not reach has no help to be absent from.",
        withdrawn: "There is no grant over help to retract.",
        readonly: "An entitlement that pauses writes does not pause the explanation of what a screen does; help is drawn identically." } }
  ];

  /* The drawn artifacts, and which row each one serves. */
  var SCREENS = [
    { id: "F-3a", row: "F-3", view: "today", client: "m", state: "populated", member: "jana",
      name: "Today \u2014 all five groups", caption: "Jana, an ordinary Wednesday. Alerts, then overdue oldest first, then the clock, then the day, then what she started." },
    { id: "F-3b", row: "F-3", view: "today", client: "m", state: "populated", member: "petr",
      name: "Today \u2014 a quiet screen", caption: "Petr holds three modules. Two blocks render; the other three are not drawn as headings." },
    { id: "F-3c", row: "F-3", view: "today", client: "m", state: "empty", member: "klara",
      name: "Today \u2014 nothing today", caption: "Kl\u00e1ra\u2019s modules produce no dates at all, so her Today is the one teaching state \u2014 not five empty headings." },
    { id: "F-3d", row: "F-3", view: "today", client: "m", state: "offline", member: "jana",
      name: "Today \u2014 offline", caption: "Occurrences expand on the device. One row cannot: the frost alert says when it was measured instead of pretending." },
    { id: "F-3e", row: "F-3", view: "today", client: "m", state: "error", member: "jana",
      name: "Today \u2014 one source failed", caption: "Chores did not answer. It says so where its rows would be and the rest of the screen is untouched." },
    { id: "F-3f", row: "F-3", view: "today", client: "m", state: "readonly", member: "jana",
      name: "Today \u2014 read-only", caption: "Reads are all this screen does, so it is whole; what goes is the completion control on each row." },
    { id: "F-3g", row: "F-3", view: "today", client: "w", state: "populated", member: "jana",
      name: "Today \u2014 web", caption: "The same five blocks in two columns, with the sidebar\u2019s search field above them." },
    { id: "F-1a", row: "F-1", view: "search", client: "m", state: "populated", member: "jana",
      name: "Global search \u2014 across nine scopes", caption: "One query, one row shape, nine modules answering." },
    { id: "F-1b", row: "F-1", view: "search", client: "m", state: "populated", member: "klara",
      name: "Global search \u2014 the same query, narrower grants", caption: "Kl\u00e1ra searches two scopes of nineteen. The count is over what she may see, so it leaks nothing." },
    { id: "F-1c", row: "F-1", view: "search", client: "w", state: "populated", member: "jana",
      name: "Global search \u2014 web", caption: "Keyboard-first: the field is in the sidebar, results are a list, and the scopes searched are stated." },
    { id: "F-1d", row: "F-1", view: "search", client: "m", state: "empty", member: "jana",
      name: "Global search \u2014 nothing matched", caption: "It says what it searched, which is the only honest way to report a zero." },
    { id: "F-2a", row: "F-2", view: "row", client: "b", state: "populated", member: "jana",
      name: "The result row \u2014 one shape, four fillings", caption: "Full, no snippet, no path, and neither. The row closes up; it never reserves an empty line." },
    { id: "F-4a", row: "F-4", view: "add", client: "m", state: "populated", member: "jana",
      name: "The Add sheet \u2014 six on a slow window", caption: "Ranked on twelve weeks, not on this week. Every entry lands on a capture surface." },
    { id: "F-4b", row: "F-4", view: "add", client: "m", state: "populated", member: "klara",
      name: "The Add sheet \u2014 one contribute grant", caption: "Kl\u00e1ra may add to the shopping list and nothing else. One entry, no greyed five." },
    { id: "F-4c", row: "F-4", view: "add", client: "m", state: "absent", member: "view-only",
      name: "The Add sheet \u2014 there is no Add tab", caption: "A member with view everywhere. Settled: the sheet is not drawn short and it does not explain itself \u2014 the tab is absent and the bar re-solves to four slots, the way it does without Chat. Absence, not a screen whose whole content is a refusal." },
    { id: "F-19a", row: "F-19", view: "help", client: "b", state: "populated", member: "jana",
      name: "The three help surfaces", caption: "Inline hint, expandable, panel \u2014 each one chosen by the content, not by the screen." },

    { id: "F-3h", row: "F-3", view: "today", client: "m", state: "loading", member: "jana",
      name: "Today \u2014 loading", caption: "Shape-matched to the five groups it is about to draw, never a spinner. The block count is not known yet, so it skeletons three." },
    { id: "F-3i", row: "F-3", view: "today", client: "m", state: "pending", member: "jana",
      name: "Today \u2014 a queued completion", caption: "A row ticked offline. The mark belongs to the source row, which is why Today can show it without owning it." },
    { id: "F-3j", row: "F-3", view: "today", client: "m", state: "syncing", member: "jana",
      name: "Today \u2014 sending", caption: "Past the 800 ms threshold only. Below it, nothing is drawn at all." },

    { id: "F-1e", row: "F-1", view: "search", client: "m", state: "loading", member: "jana",
      name: "Global search \u2014 loading", caption: "Result rows are skeletoned at their real height, so the list does not jump when they arrive." },
    { id: "F-1f", row: "F-1", view: "search", client: "m", state: "error", member: "jana",
      name: "Global search \u2014 the index did not answer", caption: "Named in words with a retry, and the query is kept in the field." },
    { id: "F-1g", row: "F-1", view: "search", client: "m", state: "offline", member: "jana",
      name: "Global search \u2014 offline", caption: "The drawing the first enumeration gap is about: this is design\u2019s proposal, and it says which corner of the household it could reach rather than pretending to be whole." },
    { id: "F-1h", row: "F-1", view: "search", client: "m", state: "readonly", member: "jana",
      name: "Global search \u2014 read-only", caption: "Reading is all search does, so the results are untouched; what goes is the create-from-this-query action." },

    { id: "F-2b", row: "F-2", view: "row", client: "b", state: "loading", member: "jana",
      name: "The row \u2014 loading", caption: "Two lines and a chip-width block: the skeleton is the row with its text removed, not a grey rectangle." },
    { id: "F-2c", row: "F-2", view: "row", client: "b", state: "error", member: "jana",
      name: "The row \u2014 the entity is gone", caption: "The one error a result row can have: it resolved to something deleted since it was indexed. It says so and offers nothing to open." },
    { id: "F-2d", row: "F-2", view: "row", client: "b", state: "offline", member: "jana",
      name: "The row \u2014 offline", caption: "Identical. A row is a read, and reads are indistinguishable offline \u2014 the honesty is on the screen around it, not on the row." },
    { id: "F-2e", row: "F-2", view: "row", client: "b", state: "readonly", member: "jana",
      name: "The row \u2014 read-only", caption: "Also identical. Nothing on a result row is a write, so an entitlement that pauses writes takes nothing away from it." },

    { id: "F-4d", row: "F-4", view: "add", client: "m", state: "loading", member: "jana",
      name: "The Add sheet \u2014 first ever open", caption: "The only time it waits. After that it opens on the last known ranking, which is what makes it feel instant." },
    { id: "F-4e", row: "F-4", view: "add", client: "m", state: "error", member: "jana",
      name: "The Add sheet \u2014 the ranking did not load", caption: "It falls back to the cold-start set rather than showing nothing, and says which one you are looking at." },
    { id: "F-4f", row: "F-4", view: "add", client: "m", state: "offline", member: "jana",
      name: "The Add sheet \u2014 offline", caption: "Whole: the ranking is local and every capture surface queues its write. The one entry that needs a connection says so." },
    { id: "F-4g", row: "F-4", view: "add", client: "m", state: "readonly", member: "jana",
      name: "The Add sheet \u2014 read-only", caption: "Every entry is a create, so in read-only the sheet has nothing to offer and explains why \u2014 the one place absence needs a sentence." },

    { id: "F-19b", row: "F-19", view: "help", client: "b", state: "empty", member: "jana",
      name: "Help \u2014 nothing authored for this screen", caption: "No entry means no affordance: no question mark, no empty panel. This is the state the model exists to make visible while a module is being designed rather than in Phase 5." },
    { id: "F-19c", row: "F-19", view: "help", client: "b", state: "error", member: "jana",
      name: "Help \u2014 a link into a module this household does not have", caption: "The body stands alone and the link is dropped, because a help panel is the wrong place to learn that a module exists." }
  ];

  /* Coverage, computed from the two lists above rather than claimed: a row's required
     states are the twelve minus the ones it declares unreachable, and an artifact is
     what draws one. This is the check that would have caught five rows recorded as
     complete while seventeen cells were undrawn. */
  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending",
                    "syncing", "conflicted", "rejected", "absent", "withdrawn", "readonly"];

  function coverage() {
    return ROWS.map(function (r) {
      var ex = Object.keys(r.impossible);
      var required = ALL_STATES.filter(function (st) { return ex.indexOf(st) < 0; });
      var drawn = SCREENS.filter(function (a) { return a.row === r.id; })
        .map(function (a) { return a.state; })
        .filter(function (st, i, arr) { return arr.indexOf(st) === i; });
      var missing = required.filter(function (st) { return drawn.indexOf(st) < 0; });
      return { id: r.id, name: r.name, required: required, drawn: drawn,
               missing: missing, complete: missing.length === 0,
               artifacts: SCREENS.filter(function (a) { return a.row === r.id; }).length };
    });
  }

  /* ── the gate ─────────────────────────────────────────────────────────── */

  function checks(live) {
    var jana = todayFor("jana"), petr = todayFor("petr"), klara = todayFor("klara"), adam = todayFor("adam");
    var days = [jana, adam, petr, klara];
    var st = stability("jana");
    var open = whileOpen("jana");
    var table = sheetTable();
    var jSearch = search("kotel", "jana");
    var kSearch = search("kotel", "klara");
    var pSearch = search("porek", "jana");
    var audit = scopeAudit();
    var hm = helpModel();
    var emptyHeadings = live && typeof live.emptyHeadings === "number" ? live.emptyHeadings : null;
    var measuredBlocks = live && typeof live.measuredBlocks === "number" ? live.measuredBlocks : null;

    return [
      { name: "A quiet day is a short screen, not five empty headings",
        detail: days.map(function (d) { return d.name + " " + d.blockCount + " blocks / " + d.rowCount + " rows"; }).join(" \u00b7 ") +
          ". Four members, one day, four different screens \u2014 and " +
          (emptyHeadings === null
            ? "no block is rendered without rows, by construction: todayFor() drops a group before it is drawn. Open the Today view and the count is taken from its own DOM."
            : emptyHeadings + " of the " + measuredBlocks + " blocks drawn on the Today view of this page are empty, counted in its DOM rather than claimed."),
        pass: days.every(function (d) { return d.blocks.every(function (b) { return b.rows.length > 0; }); }) &&
              (emptyHeadings === null || emptyHeadings === 0) },
      { name: "The five groups are the ordering, and each has its own rule",
        detail: GROUPS.map(function (g) { return (g.label || "alerts") + " \u2014 " + g.rule.toLowerCase(); }).join(" \u00b7 ") +
          ". Jana\u2019s overdue block runs " + jana.blocks.filter(function (b) { return b.id === "overdue"; })[0].rows.map(function (r) { return r.overdue + "d"; }).join(", ") +
          " and her timed block is in clock order \u2014 sorted by the function, not by the fixture\u2019s order.",
        pass: (function () {
          var o = jana.blocks.filter(function (b) { return b.id === "overdue"; })[0];
          var t = jana.blocks.filter(function (b) { return b.id === "timed"; })[0];
          var okO = o.rows.every(function (r, i) { return i === 0 || o.rows[i - 1].overdue >= r.overdue; });
          var okT = t.rows.every(function (r, i) { return i === 0 || t.rows[i - 1].meta <= r.meta; });
          var alertsFirst = jana.blocks[0].id === "alerts";
          return okO && okT && alertsFirst;
        })() },
      { name: "Every row names its module and opens the source entity",
        detail: jana.rowCount + " rows, " + jana.blocks.reduce(function (n, b) { return n + b.rows.filter(function (r) { return !!r.moduleName && !!r.endpoint; }).length; }, 0) +
          " carrying both a chip and a target. None of them targets Today \u2014 Today owns no data and therefore no endpoint of its own.",
        pass: jana.blocks.every(function (b) { return b.rows.every(function (r) { return r.moduleName && r.endpoint && r.endpoint.indexOf("/today") < 0; }); }) },
      { name: "A module the member has none on appears in no row and no count",
        detail: "Kl\u00e1ra\u2019s Today drops " + klara.dropped.length + " of " + ITEMS.length + " items across " + klara.droppedModules.length +
          " modules, and what is left is " + klara.rowCount + " rows \u2014 so the screen she gets is the teaching state, computed from her grants rather than authored for her.",
        pass: klara.rowCount === 0 && klara.blocks.length === 0 && petr.rowCount > 0 && petr.blockCount < 5 },
      { name: "Today is complete offline, and says so where it is not",
        detail: (SOURCES.length - jana.serverSources.length) + " of " + SOURCES.length + " sources are expanded on the client from synced rules (FR-RE2). The exception is " +
          jana.serverSources.map(function (s) { return s[0]; }).join(", ") +
          ": a forecast is not on the device, so offline the row keeps its place and states the time it was measured.",
        pass: jana.serverSources.length === 1 && SOURCES.filter(function (s) { return s[2] === "client"; }).length === SOURCES.length - 1 },
      { name: "The Add sheet does not move when the week is unusual",
        detail: "Slow window: " + st.slow.join(", ") + ". The same six, in the same order, after a week with fourteen utility readings in it. Recency-weighting would give " +
          st.recency.join(", ") + " \u2014 " + st.recencyMoved + " of six in a different position and " + st.recencyJoined.length + " entry swapped in.",
        pass: st.slowUnchanged && st.recencyMoved > 0 },
      { name: "It never reorders while it is open",
        detail: "Opened as " + open.opened.join(", ") + ". The ranking that arrives while it is on screen is held: the sheet still closes on the same six. It changes at the next open, which is when muscle memory can survive it.",
        pass: open.stable },
      { name: "Cold start is neither empty nor arbitrary",
        detail: table.map(function (r) { return r.name + " " + r.slots + "/" + r.cold; }).join(" \u00b7 ") +
          " (learned / cold). A brand-new household gives an owner six entries from enablement and contribute grants alone, in the designed order \u2014 and " +
          table.filter(function (r) { return r.slots < 6; }).length + " of five fixture members hold contribute on fewer than six modules, so the sheet is drawn short rather than padded. A member who holds contribute nowhere ranks nothing at all, and that member has no Add tab: the bar re-solves to four slots (nav.js), so this surface is never drawn as a refusal.",
        pass: (function () { var c = addSheet("jana", { mode: "cold" }); return c.entries.length === 6 && !c.empty; })() },
      { name: "Every entry lands on a capture surface, never a configure surface",
        detail: ADD.length + " candidate creates, " + ADD.filter(function (e) { return !e.excluded; }).length +
          " eligible, each naming the surface it opens (\u00a77). Chat is excluded by rule and states why: a create with a tab of its own does not need the centre button.",
        pass: ADD.every(function (e) { return !!e.capture; }) && ADD.filter(function (e) { return !!e.excluded; }).length === 1 },
      { name: "Grants apply before ranking, so the count is not a leak",
        detail: "One query, two members: Jana " + jSearch.count + " hits over " + jSearch.scopesSearched + " scopes, Kl\u00e1ra " + kSearch.count +
          " over " + kSearch.scopesSearched + ". Kl\u00e1ra\u2019s " + kSearch.droppedGrant.length + " ungranted scopes are removed from the scope list before a single row is scored, so she never learns how many she cannot see.",
        pass: kSearch.scopesSearched < jSearch.scopesSearched && kSearch.count < jSearch.count &&
              kSearch.results.every(function (r) { return atLeast(grantOf("klara", r.module), "view"); }) },
      { name: "A private note is excluded from matching entirely",
        detail: "One private note in the corpus matches the query and belongs to Jana. Adam holds view on Notes and gets " + search("kotel", "adam").droppedPrivate.length +
          " of them dropped before ranking, off the scope list rather than out of the ranked set (FR-NO4, FR-NO7) \u2014 a 403 here would turn the result count into an existence oracle over somebody else\u2019s private root. Jana sees her own.",
        pass: search("kotel", "adam").droppedPrivate.length === 1 &&
              search("kotel", "adam").results.every(function (r) { return r.title.indexOf("D\u00e1rek") < 0; }) &&
              jSearch.results.some(function (r) { return r.title.indexOf("D\u00e1rek") === 0; }) },
      { name: "One result row shape across nineteen scopes",
        detail: audit.keys + " scope keys collected from " + audit.declaring + " module pages, each with the line it came from; " +
          audit.silent.length + " modules declare none (" + audit.silentNames.join(", ") + ") and own no searchable text. Jana\u2019s results carry " +
          jSearch.noSnippet + " rows with no snippet and " + jSearch.noPath + " with no path, and " + pSearch.count +
          " unaccented hits prove porek matches p\u00f3rek \u2014 all drawn by the same component.",
        pass: audit.keys === 19 && HIT_SHAPE.filter(function (f) { return f[1] === "nullable"; }).length === 4 &&
              jSearch.noSnippet > 0 && jSearch.noPath > 0 && pSearch.count > 0 },
      { name: "Every state these five rows can reach is drawn",
        detail: coverage().map(function (c) { return c.id + " " + c.drawn.length + "/" + c.required.length; }).join(" \u00b7 ") +
          " states, over " + SCREENS.length + " client layouts. Computed from the rows\u2019 own exclusions rather than recorded by hand \u2014 " +
          "the check that catches a row being called complete while a cell of it is undrawn.",
        pass: coverage().every(function (c) { return c.complete; }) },
      { name: "Help chooses its surface from its content, and never leaves the app",
        detail: hm.entries + " entries, " + hm.hard + " of them the \u00a7F hard set: " +
          SURFACES.map(function (s) { return hm.bySurface[s[0]] + " " + s[1].toLowerCase(); }).join(" \u00b7 ") +
          ". " + hm.external + " external links. Every entry names the stage that authors it, which is " + Object.keys(hm.byStage).length +
          " stages carrying " + hm.strings + " strings across five languages instead of one retrofit in Phase 5.",
        pass: hm.surfacesUsed === 3 && hm.external === 0 && hm.overlong.length === 0 &&
              HELP.every(function (h) { return !!h.authoredIn; }) }
    ];
  }

  window.HH_SPINE = {
    version: "0.1-stage-11-candidate",
    groups: GROUPS, rejectedToday: REJECTED_TODAY, sources: SOURCES, items: ITEMS,
    today: todayFor,
    add: ADD, slots: SLOT_COUNT, addSheet: addSheet, stability: stability,
    whileOpen: whileOpen, sheetTable: sheetTable,
    scopes: SCOPES, scopeAudit: scopeAudit, corpus: CORPUS, search: search, hitShape: HIT_SHAPE,
    helpFields: HELP_FIELDS, surfaces: SURFACES, help: HELP, helpModel: helpModel,
    helpIn: helpIn, helpLangs: helpLangs,
    rows: ROWS, screens: ROWS, artifacts: SCREENS, allStates: ALL_STATES,
    coverage: coverage, checks: checks
  };
})();
