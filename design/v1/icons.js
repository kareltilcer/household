/* Household — @household/icons, stage 3 candidate.
   DD-10: a licensed open set is the base; the seventeen module icons and the
   thirteen status icons are drawn in-house. All of it bundled, never fetched.

   Every glyph in this file is path data on one 24-unit grid, stroked in
   currentColor, no fills, no second colour — so a glyph is legible in
   greyscale (N2) and inherits its module accent or status token from the
   surface it sits on. Nothing here is a screen. */
(function () {

  var GRID = {
    box: 24,
    live: "3 → 21 (a 3-unit keyline all round, so a 24 px glyph never touches its 44 pt target's edge)",
    strokeStatus: 2,
    strokeModule: 1.75,
    cap: "round",
    join: "round",
    rules: [
      ["One grid", "24 units, integer or half-unit terminals. A glyph that needs a third decimal is a drawing, not an icon."],
      ["One weight per set", "Status 2.0, module 1.75. The status set is drawn heavier because it renders at 16–20 px on rows; the module set renders at 20–28 px."],
      ["No fills, no second colour", "Colour is never the carrier (N2). Every glyph is one stroke in currentColor, so greyscale is the design case rather than a fallback."],
      ["Silhouette before detail", "The distinguishing feature is the outline at 16 px. Interior detail may only confirm what the silhouette already says."],
      ["Optical size, not scaled art", "20 px sidebar and 28 px tab bar are the two module sizes reviewed; 16 px and 20 px are the two status sizes."],
      ["No glyph carries text", "Nothing containing a letter or a digit — five launch languages, and a letterform in an icon is an untranslated string."]
    ]
  };

  /* ── the thirteen status icons ────────────────────────────────────────
     [id, word, token, labelKey, silhouette, note, paths] */

  var STATUS = [
    ["synced", "In sync", "status-synced", "a11y.status.synced", "closed ring, check inside",
      "The one exception to where it is drawn, never to whether: no row carries it, so it appears only where sync is stated in words — the mark's on-tap form, the conflict inbox, sync health.",
      ["M12 3.6a8.4 8.4 0 1 0 0 16.8a8.4 8.4 0 1 0 0-16.8", "M8.1 12.1l2.7 2.7 5.1-5.5"]],

    ["pending", "Not sent yet", "status-pending", "a11y.status.pending", "arrow under a ceiling",
      "Quiet by design: the row stays fully editable. The ceiling is what it has not passed yet — deliberately not an error shape.",
      ["M4.6 4.8h14.8", "M12 20.2V8.4", "M7.8 12.6L12 8.4l4.2 4.2"]],

    ["syncing", "Sending", "status-syncing", "a11y.status.syncing", "two arcs, opposed",
      "Only past the 800 ms threshold. Also carries re-snapshot needed, which adds no fourteenth state.",
      ["M4.8 12a7.2 7.2 0 0 1 12.4-5", "M17.6 3.4v3.9h-3.9", "M19.2 12a7.2 7.2 0 0 1-12.4 5", "M6.4 20.6v-3.9h3.9"]],

    ["conflict", "Two versions", "status-conflict", "a11y.status.conflict", "two offset squares",
      "Two of the same thing, offset — a shape with no severity in it. Row flag plus a conflict-inbox entry, never a modal at reconnect.",
      ["M4.6 4.6h9.8v9.8H4.6z", "M9.6 9.6h9.8v9.8H9.6z"]],

    ["rejected", "Not accepted", "status-rejected", "a11y.status.rejected", "return hook",
      "A different category of event from conflict, not a worse severity of it — so it is drawn as coming back, not as a cross.",
      ["M6.4 8.6h9.1a4.6 4.6 0 0 1 0 9.2H9.2", "M9.8 5L6.2 8.6l3.6 3.6"]],

    ["offline", "Offline", "status-offline", "a11y.status.offline", "arcs with a slash",
      "The offline bar. Neither a problem nor a success, which is the whole reason info exists as a fourth status.",
      ["M4.6 9.6a11.4 11.4 0 0 1 14.8 0", "M7.6 13.2a7.2 7.2 0 0 1 8.8 0", "M12 16.9a1.3 1.3 0 1 0 0 2.6a1.3 1.3 0 1 0 0-2.6", "M4.8 19.6L19.6 4.8"]],

    ["overdue", "Overdue", "status-overdue", "a11y.status.overdue", "closed clock",
      "Shown once and then quiet. The closed ring with a mark at twelve is the pair to stale's open one: this clock has a time on it and a time in it.",
      ["M12 4.4a7.8 7.8 0 1 0 0 15.6a7.8 7.8 0 1 0 0-15.6", "M12 8.4v4.2l3.4 2", "M12 2v2.4"]],

    ["blocked", "Blocked", "status-blocked", "a11y.status.blocked", "wide barrier",
      "A settlement with no closing reading; a task whose dependency is unmet. The only wide horizontal silhouette in the set.",
      ["M3.6 9.8h16.8v4.6H3.6z", "M9.3 9.8L5.9 14.4", "M14.9 9.8L11.5 14.4"]],

    ["estimated", "Estimated", "status-estimated", "a11y.status.estimated", "double tilde",
      "The approximation sign itself. Informational, never alarming — and an estimated reading never enters a money figure.",
      ["M4.6 10c1.85-2.6 3.85-2.6 5.7 0s3.85 2.6 5.7 0", "M4.6 15.4c1.85-2.6 3.85-2.6 5.7 0s3.85 2.6 5.7 0"]],

    ["private", "Private", "status-private", "a11y.status.private", "hatched block",
      "Calendar's busy block, drawn as what it is: an area with something in it that cannot be opened. Unmistakable and uninspectable.",
      ["M4.6 5.4h14.8v13.2H4.6z", "M5.6 11.4L10.6 6.4", "M5.6 16.4L15.6 6.4", "M10.6 17.4L18.4 9.6"]],

    ["locked", "Locked", "status-locked", "a11y.status.locked", "padlock",
      "A child's locked dashboard layout. Absence beats disabling wherever it is possible, so this glyph is rarer than it looks.",
      ["M6.8 10.6h10.4v8.2H6.8z", "M9.4 10.6V8.4a2.6 2.6 0 0 1 5.2 0v2.2"]],

    ["stale", "Not updated recently", "status-stale", "a11y.status.stale", "open clock",
      "Calendar connection health and sync health. The gap in the ring is the point: time has passed and nothing came in.",
      ["M19.4 12A7.4 7.4 0 1 0 12 19.4", "M16.6 9.6L19.4 12l-2.8 2.4", "M12 9.6v2.8l2.3 1.4"]],

    ["no_history", "No history yet", "status-no-history", "a11y.status.noHistory", "empty axes",
      "Garden's eleven-check panel and every derived figure with nothing behind it. The dash is where a series would be — a shape a genuine zero never takes.",
      ["M5.4 4.8v14h14", "M8.6 13.6h7.4"]]
  ];

  /* ── the seventeen module icons, plus Today and Add ───────────────────
     [id, name, family, labelKey, note, paths] */

  var MODULES = [
    ["dashboard", "Dashboard", "household", "nav.module.dashboard",
      "The widget list itself, at its 2-column reading.",
      ["M4.6 4.6h6v6h-6z", "M13.4 4.6h6v6h-6z", "M4.6 13.4h6v6h-6z", "M13.4 13.4h6v6h-6z"]],

    ["chat", "Chat", "household", "nav.module.chat",
      "One bubble, not two: threads are the module, a conversation is not.",
      ["M4.8 6.2h14.4v9.4H10.6L6.2 19v-3.4H4.8z"]],

    ["activity", "Activity", "household", "nav.module.activity",
      "A trace across time. Deliberately not a list — the log is a feature, not a log file.",
      ["M4.6 15.4L7.4 15.4 10 8.4 13 18.2 15.8 6.2 18 15.4 19.4 15.4"]],

    ["admin", "Household settings", "household", "nav.module.admin",
      "The house with its own controls inside it. Not a gear: a gear is every settings screen in every product.",
      ["M4.8 10.8L12 5.2l7.2 5.6v8.4H4.8z", "M8.4 14h7.2", "M8.4 17h4.4"]],

    ["tasks", "Tasks", "time", "nav.module.tasks",
      "Three columns at three heights — the board, which is what the module is.",
      ["M5 5.4h3.6v13.2H5z", "M10.2 5.4h3.6v9.2h-3.6z", "M15.4 5.4h3.6v11h-3.6z"]],

    ["reminders", "Reminders", "time", "nav.module.reminders",
      "The one conventional glyph kept deliberately: a bell is understood everywhere and a reminder is a day, not an instant, so a clock would lie.",
      ["M8 16.6V11a4 4 0 0 1 8 0v5.6", "M6.2 16.6h11.6", "M10.3 19a1.9 1.9 0 0 0 3.4 0"]],

    ["calendar", "Calendar", "time", "nav.module.calendar",
      "Frame, head rule, two pegs, one day marked. The marked day is what separates it from Today.",
      ["M4.8 6.4h14.4v12.8H4.8z", "M4.8 10.2h14.4", "M9 4.4v3.4", "M15 4.4v3.4", "M11.2 13.4h1.8v1.8h-1.8z"]],

    ["chores", "Chores", "time", "nav.module.chores",
      "Recurring, and done: the arc is the schedule, the check is the completion. No trophy, no leaderboard.",
      ["M19.2 12a7.2 7.2 0 1 1-2.7-5.6", "M19.8 4.4v3.8h-3.8", "M8.6 12.2l2.4 2.4 4.6-4.8"]],

    ["finance", "Finance", "money", "nav.module.finance",
      "N sources to M accounts — the flow view in miniature, which is the module's own hard screen.",
      ["M6.6 6.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6", "M6.6 14.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6", "M17.4 10.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6", "M8.4 8.6C12 9.6 12.8 10.6 15.6 11.5", "M8.4 15.4C12 14.4 12.8 13.4 15.6 12.5"]],

    ["utilities", "Utilities", "money", "nav.module.utilities",
      "A register with a needle on a plinth. The meter, because the module's centre of gravity is a cellar.",
      ["M5.4 15.6a6.6 6.6 0 1 1 13.2 0", "M12 15.6L15.4 11.4", "M4.6 18.6h14.8"]],

    ["property", "Property", "things", "nav.module.property",
      "The house with a door: the thing you go into, as against the house that means the household.",
      ["M4.8 10.8L12 5.2l7.2 5.6v8.4H4.8z", "M10.2 19.2v-4.6h3.6v4.6"]],

    ["vehicles", "Vehicles", "things", "nav.module.vehicles",
      "People look for their car under car. A bike variant of the module never asks for a plate, but the icon stays the car.",
      ["M5 14.4L6.9 9.4h10.2l1.9 5", "M4.6 14.4h14.8v3.6H4.6z", "M8.4 17.1a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3", "M15.6 17.1a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3"]],

    ["pets", "Pets", "things", "nav.module.pets",
      "A paw, and the only module glyph with no straight line in it — Pets must not read like asset management even in the tab bar.",
      ["M7.6 8.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3", "M10.7 6.3a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3", "M14 6.3a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3", "M16.6 8.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3", "M12 12.4c3.3 0 5.1 2.3 5.1 4.3s-2 3.1-5.1 3.1-5.1-1.1-5.1-3.1 1.8-4.3 5.1-4.3z"]],

    ["notes", "Notes", "keeping", "nav.module.notes",
      "A written page. Documents is a folder because the distinction the tree browser makes is a thing you wrote against a thing you were given.",
      ["M6.4 4.6h11.2v14.8H6.4z", "M9.2 9h5.6", "M9.2 12.4h5.6", "M9.2 15.8h3.4"]],

    ["documents", "Documents", "keeping", "nav.module.documents",
      "The folder, because the module is custody: what is filed, where, and who may see it.",
      ["M4.6 7.6h5.6l1.8 2.2h7.4v9.2H4.6z"]],

    ["shopping", "Shopping", "keeping", "nav.module.shopping",
      "A basket, not a cart: the module is used in the aisle with one hand, not at a checkout.",
      ["M4.6 9.6h14.8l-1.8 9H6.4z", "M9 9.6a3 3 0 0 1 6 0"]],

    ["garden", "Garden", "garden", "nav.module.garden",
      "A sprout with two leaves and one stem — legible at 20 px, which a plant with three is not. Garden's own hue sits outside the five families.",
      ["M12 19.4v-6.6", "M12 12.8c-3.4 0-5.6-2-5.6-5 3.6 0 5.6 2 5.6 5z", "M12 12.8c3.4 0 5.6-2 5.6-5-3.6 0-5.6 2-5.6 5z"]],

    ["today", "Today", "household", "nav.today",
      "Not a module and not in the accent map: a platform screen. Drawn as one day rather than a calendar, so it never reads as Calendar.",
      ["M4.6 17.6h14.8", "M7.8 17.6a4.2 4.2 0 0 1 8.4 0", "M12 6.4v2.4", "M6.8 8.6l1.7 1.7", "M17.2 8.6l-1.7 1.7"]],

    ["add", "Add", "household", "nav.add",
      "A tab that opens a sheet. The plus is the one glyph in the product that must never mean anything else.",
      ["M12 5.6v12.8", "M5.6 12h12.8"]]
  ];

  /* ── the licensed base set: what is NOT drawn in-house ───────────────── */

  var BASE = {
    license: "Lucide · ISC. Vendored into @household/icons at build, tree-shaken to the manifest below, never fetched at runtime (N8).",
    rule: "A base glyph may never be used for a status or a module. If a base glyph starts carrying meaning, it moves in-house and joins one of the two sets above.",
    groups: [
      ["Navigation", ["chevron-left", "chevron-right", "chevron-up", "chevron-down", "chevrons-up-down", "arrow-left", "arrow-right", "external-link", "x"]],
      ["Actions", ["plus", "minus", "check", "pencil", "trash-2", "copy", "share-2", "download", "upload", "printer", "archive", "rotate-ccw", "more-horizontal", "more-vertical", "grip-vertical"]],
      ["Input & find", ["search", "filter", "arrow-up-down", "calendar-days", "clock", "camera", "image", "paperclip", "qr-code", "map-pin"]],
      ["Meaning", ["info", "alert-triangle", "alert-circle", "help-circle", "eye", "eye-off", "star", "pin", "link"]],
      ["Identity & account", ["user", "users", "key", "shield", "log-out", "smartphone", "monitor", "credit-card", "bell", "bell-off", "sun", "moon"]]
    ],
    count: 0
  };
  BASE.groups.forEach(function (g) { BASE.count += g[1].length; });

  /* ── the icon-only control register ──────────────────────────────────
     07-delivery §3: every icon-only control has a label, no exception for
     obvious ones. This is the list, and it is the gate's second half.
     [control, glyph, source set, labelKey, English] */

  var LABELS = [
    ["Back", "arrow-left", "base", "a11y.control.back", "Back"],
    ["Close sheet", "x", "base", "a11y.control.closeSheet", "Close"],
    ["More actions", "more-horizontal", "base", "a11y.control.moreActions", "More actions for {name}"],
    ["Edit", "pencil", "base", "a11y.control.edit", "Edit {name}"],
    ["Delete", "trash-2", "base", "a11y.control.delete", "Delete {name}"],
    ["Share", "share-2", "base", "a11y.control.share", "Share {name}"],
    ["Download", "download", "base", "a11y.control.download", "Download {name}"],
    ["Attach file", "paperclip", "base", "a11y.control.attach", "Attach a file"],
    ["Take a photo", "camera", "base", "a11y.control.camera", "Take a photo"],
    ["Search", "search", "base", "a11y.control.search", "Search this household"],
    ["Filter", "filter", "base", "a11y.control.filter", "Filter {list}"],
    ["Sort", "arrow-up-down", "base", "a11y.control.sort", "Sort {list}"],
    ["Reorder handle", "grip-vertical", "base", "a11y.control.reorder", "Reorder {name}. Use arrow keys to move it"],
    ["Add", "add", "module", "nav.add", "Add"],
    ["Today", "today", "module", "nav.today", "Today"],
    ["Household switcher", "chevrons-up-down", "base", "a11y.control.switchHousehold", "Switch household. Currently {household}"],
    ["Theme", "sun", "base", "a11y.control.theme", "Appearance: {theme}"],
    ["Sync state mark", "syncing", "status", "a11y.status.syncing", "{state}. Tap for detail"],
    ["Conflict flag", "conflict", "status", "a11y.status.conflict", "Two versions of {name}. Open to resolve"],
    ["Print", "printer", "base", "a11y.control.print", "Print {name}"]
  ];

  /* ── lookups ─────────────────────────────────────────────────────────── */

  var BY_ID = {};
  STATUS.forEach(function (s) {
    BY_ID[s[0]] = { id: s[0], set: "status", word: s[1], token: s[2], labelKey: s[3], silhouette: s[4], note: s[5], paths: s[6], stroke: GRID.strokeStatus };
  });
  MODULES.forEach(function (m) {
    BY_ID[m[0]] = { id: m[0], set: "module", name: m[1], family: m[2], labelKey: m[3], note: m[4], paths: m[5], stroke: GRID.strokeModule };
  });

  /* every glyph is one stroke in currentColor: nothing in the data may
     declare a colour, and nothing may be filled. Checked, not asserted. */
  function colourIndependent() {
    var bad = [];
    Object.keys(BY_ID).forEach(function (k) {
      var i = BY_ID[k];
      if (i.fill || i.colour) bad.push(k);
      i.paths.forEach(function (d) { if (/#|rgb|url\(/.test(d)) bad.push(k); });
    });
    return bad;
  }

  window.HH_ICONS = {
    version: "0.1-stage-3-candidate",
    grid: GRID, status: STATUS, modules: MODULES, base: BASE, labels: LABELS,
    byId: BY_ID, colourIssues: colourIndependent()
  };
})();
