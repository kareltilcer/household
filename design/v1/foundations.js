/* Household — @household/tokens, stage 2 candidate.
   The token file is the contract (01-foundations §1). This file is the emitter:
   it holds every primitive, semantic and component token in both themes, the
   declared contrast pairs CI tests, the seventeen-key accent map, the type,
   space, radius, elevation, density and motion primitives — and it injects the
   CSS custom properties it declares, so the prototype consumes the same values
   the tables show. Nothing here is a screen. */
(function () {

  /* ── primitives ─────────────────────────────────────────────────────── */

  var NEUTRAL = [
    ["neutral-50", "#F9FAFD"], ["neutral-100", "#F1F2F7"], ["neutral-200", "#E6E8EC"],
    ["neutral-300", "#D6D7DF"], ["neutral-400", "#BFC1CA"], ["neutral-500", "#A2A5AF"],
    ["neutral-600", "#888A94"], ["neutral-700", "#6A6E7A"], ["neutral-800", "#4E5057"],
    ["neutral-850", "#3B3D42"], ["neutral-900", "#2C2E38"], ["neutral-950", "#1A1B22"],
    ["neutral-990", "#12131A"]
  ];

  /* ten hues, two steps each: 600 is light-theme ink, 400 is dark-theme ink.
     Solved, not eyeballed: every 600 clears 4.5:1 on surface-sunken (the
     darkest light surface) and every 400 clears 4.5:1 on surface-overlay
     (the lightest dark surface). */
  var HUES = [
    ["indigo", 264, "#476CBA", "#6F97E9"],
    ["violet", 300, "#7F5CB7", "#AA86E5"],
    ["plum", 338, "#A94B92", "#D876BD"],
    ["teal", 196, "#007B7C", "#34A7A8"],
    ["tan", 55, "#916444", "#BE8E6D"],
    ["moss", 124, "#5D7719", "#86A249"],
    ["red", 25, "#C43F3E", "#F66C66"],
    ["amber", 72, "#A05E00", "#CE8A1A"],
    ["emerald", 162, "#007E54", "#3EAA7C"],
    ["azure", 238, "#0074AE", "#35A1DC"]
  ];

  var SPACE = [
    ["space-05", "4px", "half-step — permitted at the two smallest sizes only"],
    ["space-1", "8px", "the base unit"],
    ["space-15", "12px", "half-step — permitted at the two smallest sizes only"],
    ["space-2", "16px", "control padding, list row inset"],
    ["space-3", "24px", "block separation"],
    ["space-4", "32px", "section separation"],
    ["space-5", "40px", ""],
    ["space-6", "48px", "page gutter, web"],
    ["space-8", "64px", ""],
    ["space-10", "80px", "page top on web at wide widths"]
  ];

  var RADII = [
    ["radius-control", "8px", "buttons, inputs, chips"],
    ["radius-card", "12px", "cards, panels, list wells"],
    ["radius-sheet", "20px", "bottom sheets, dialogs — top corners only on mobile"],
    ["radius-pill", "999px", "status pills, segmented controls"],
    ["radius-full", "50%", "avatars, the hold-progress ring"]
  ];

  var TYPE = [
    ["display", "2.5rem", "1.12", "500", "-0.02em", "sans", "One per screen at most. Finance flow total, Utilities settlement figure"],
    ["title-1", "1.875rem", "1.22", "500", "-0.015em", "sans", "Screen title on web"],
    ["title-2", "1.5rem", "1.24", "500", "-0.01em", "sans", "Screen title on mobile, section head on web"],
    ["title-3", "1.25rem", "1.3", "600", "-0.005em", "sans", "Card and sheet titles, group heads"],
    ["body-lg", "1.125rem", "1.55", "400", "0", "sans", "Lead paragraph, empty-state sentence"],
    ["body", "1rem", "1.55", "400", "0", "sans", "Everything. Compact density never goes below this"],
    ["caption", "0.8125rem", "1.45", "400", "0", "sans", "Secondary row line, metadata, help text"],
    ["overline", "0.6875rem", "1.3", "600", "0.1em", "sans", "Column heads, eyebrow labels. Uppercase"],
    ["num-lg", "1.25rem", "1.3", "500", "0", "mono", "Meter reading entry, balance figure — shares title-3's baseline"],
    ["num", "1rem", "1.55", "400", "0", "mono", "Money and unit columns — shares body's baseline"],
    ["num-sm", "0.8125rem", "1.45", "400", "0", "mono", "Tariff component breakdown — shares caption's baseline"]
  ];

  var MOTION = {
    durations: [
      ["dur-fast", "120ms", "State change on a control already under the finger"],
      ["dur-base", "200ms", "Sheet, panel, route transition"],
      ["dur-slow", "320ms", "Full-screen push, first paint of a two-pane change"]
    ],
    easings: [
      ["ease-entrance", "cubic-bezier(0.16, 0.84, 0.44, 1)", "Anything arriving"],
      ["ease-exit", "cubic-bezier(0.4, 0, 1, 1)", "Anything leaving"]
    ],
    reduced: [
      ["Transitions", "Become instant state changes at 0 ms — not slower animations"],
      ["The 2000 ms hold", "Cannot be removed: it is the only feedback the gesture is working. Becomes a ten-step fill instead of a smooth sweep"],
      ["Sync indication", "Unchanged: it is threshold-driven, not decorative"],
      ["Skeletons", "Static shapes, no shimmer"]
    ],
    thresholds: [
      ["sync-indicate-after", "800ms", "Below this a sync shows nothing at all — a progress indication only when it takes longer than a moment (06-clients §5)"],
      ["hold-to-complete", "2000ms", "Fixed by 02-components. Both the pointer and the keyboard path show the same progress"],
      ["toast-dwell", "5000ms", "Undo affordance stays for the whole dwell"]
    ]
  };

  /* ── semantic and component tokens ──────────────────────────────────── */
  /* [name, light, dark, group, purpose, primitive trail] */

  var T = [
    ["surface", "#F9FAFD", "#1A1B22", "surface", "The page ground. Level 0 of the elevation ramp. A module's screen is this, never its accent.", "neutral-50 / neutral-950"],
    ["surface-raised", "#FFFFFF", "#23252D", "surface", "Level 1. Cards, list wells, the web sidebar.", "white / neutral-900+"],
    ["surface-overlay", "#FFFFFF", "#2D2F37", "surface", "Level 2, and the ramp stops here. A third level would have no dark surface to land on.", "white / neutral-850+"],
    ["surface-sunken", "#F1F2F7", "#12131A", "surface", "Below the ground, for grouped-list wells. Not on the elevation ramp at all.", "neutral-100 / neutral-990"],
    ["surface-inverse", "#262831", "#E6E8EC", "surface", "Tooltips and the one-off inverse chip.", "neutral-900− / neutral-200"],

    ["text-primary", "#2C2E38", "#E6E8EC", "text", "Body and headings. 12:1 on the darkest surface of its own theme.", "neutral-900 / neutral-200"],
    ["text-muted", "#6A6E7A", "#9498A5", "text", "The secondary row line. Tested at 4.5:1, not 3:1 — it carries real content.", "neutral-700 / neutral-500−"],
    ["text-disabled", "#A2A5AF", "#63656F", "text", "Not a declared pair. Never the sole carrier of anything, and absence is preferred to disabling.", "neutral-500 / neutral-800+"],
    ["text-on-accent", "#FFFFFF", "#1A1B22", "text", "Ink on an accent fill. Dark theme puts dark ink on a light accent — the fill flips, the pair holds.", "white / neutral-950"],
    ["text-on-danger", "#FFFFFF", "#1A1B22", "text", "Ink on a danger fill. Tested separately because danger is the darkest status in light.", "white / neutral-950"],
    ["text-inverse", "#F9FAFD", "#1A1B22", "text", "Ink on surface-inverse.", "neutral-50 / neutral-950"],
    ["text-link", "#476CBA", "#6F97E9", "text", "Inline link. The household accent at text contrast, never at 3:1.", "indigo-600 / indigo-400"],

    ["border-strong", "#888A94", "#767982", "border", "Input and table boundaries — the ones that must clear 3:1 as UI components.", "neutral-600 / neutral-700+"],
    ["border", "#BFC1CA", "#4E5057", "border", "Card and row edges. Decorative; not a declared pair.", "neutral-400 / neutral-800"],
    ["border-subtle", "#D6D7DF", "#3F4146", "border", "Nested edges inside a well.", "neutral-300 / neutral-850+"],
    ["divider", "#DCDEE6", "#3B3D42", "border", "Row separators, and what border becomes under compact density.", "neutral-300− / neutral-850"],
    ["focus", "#5A85E4", "#4F79D6", "border", "The focus ring. 3:1 against every surface in both themes.", "indigo-500 / indigo-600"],
    ["focus-ring-offset", "#FFFFFF", "#1A1B22", "border", "The gap between ring and control, so the ring reads on raised surfaces too.", "white / neutral-950"],

    ["accent", "#476CBA", "#6F97E9", "accent", "The product's own accent, and the Household family's hue.", "indigo-600 / indigo-400"],
    ["accent-family-household", "#476CBA", "#6F97E9", "accent", "Dashboard, Chat, Activity, Household settings. Today and Add render here too, with no key of their own.", "indigo-600 / indigo-400"],
    ["accent-family-time", "#7F5CB7", "#AA86E5", "accent", "Tasks, Reminders, Calendar, Chores — the things that ask something of you today.", "violet-600 / violet-400"],
    ["accent-family-money", "#007B7C", "#34A7A8", "accent", "Finance, Utilities — the things with a number that must be right.", "teal-600 / teal-400"],
    ["accent-family-things", "#916444", "#BE8E6D", "accent", "Property, Vehicles, Pets — the asset engine's three faces.", "tan-600 / tan-400"],
    ["accent-family-keeping", "#A94B92", "#D876BD", "accent", "Notes, Documents, Shopping — capture and retrieval.", "plum-600 / plum-400"],
    ["accent-garden", "#5D7719", "#86A249", "accent", "Garden alone, outside the five families (DD-1).", "moss-600 / moss-400"],

    ["danger", "#C43F3E", "#F66C66", "status", "Destructive and failed. Reserved: never a module accent, in either theme.", "red-600 / red-400"],
    ["warning", "#A05E00", "#CE8A1A", "status", "Needs attention, still works. Reserved.", "amber-600 / amber-400"],
    ["positive", "#007E54", "#3EAA7C", "status", "Done, settled, in sync. Reserved.", "emerald-600 / emerald-400"],
    ["info", "#0074AE", "#35A1DC", "status", "The fourth status: neither problem nor success. The offline bar and staleness badges live here. Reserved.", "azure-600 / azure-400"],

    ["chart-1", "#6389DB", "#5378C7", "chart", "Categorical ramp, shared by Utilities, Finance, Pets and Garden.", "indigo"],
    ["chart-2", "#209A9B", "#008889", "chart", "", "teal"],
    ["chart-3", "#C969B0", "#B7589E", "chart", "", "plum"],
    ["chart-4", "#BC7E1A", "#AA6D00", "chart", "", "amber"],
    ["chart-5", "#7A943C", "#698328", "chart", "", "moss"],
    ["chart-6", "#9D79D7", "#8C68C4", "chart", "", "violet"],
    ["chart-7", "#E2625D", "#CE514C", "chart", "", "red"],
    ["chart-8", "#B08160", "#9E7050", "chart", "", "tan"],
    ["chart-grid", "#D4D5DD", "#424349", "chart", "Grid lines. Decorative; not a declared pair.", "neutral-300 / neutral-850+"],
    ["chart-axis", "#888A94", "#767982", "chart", "Axis lines and tick labels — a UI boundary, so 3:1 binds.", "= border-strong"],

    ["button-primary-bg", "#476CBA", "#6F97E9", "component", "= accent. The only component token for the primary button's fill.", "accent"],
    ["button-primary-fg", "#FFFFFF", "#1A1B22", "component", "= text-on-accent.", "text-on-accent"],
    ["button-danger-bg", "#C43F3E", "#F66C66", "component", "= danger.", "danger"],
    ["input-bg", "#FFFFFF", "#12131A", "component", "The one place dark deliberately inverts the ramp: a field reads as a well, not a raise.", "white / neutral-990"],
    ["table-header-bg", "#F1F2F7", "#23252D", "component", "Sticky column heads. Sunken in light, raised in dark, so the head separates either way.", "surface-sunken / surface-raised"],
    ["skeleton-bg", "#E6E8EC", "#2D2F37", "component", "Loading shapes. Not a declared pair; static under reduced motion.", "neutral-200 / neutral-850+"],
    ["hold-track", "#D6D7DF", "#3F4146", "component", "The 2000 ms hold's unfilled track.", "border-subtle"],
    ["hold-fill", "#476CBA", "#6F97E9", "component", "Its fill. Stepped, not swept, under reduced motion.", "accent"]
  ];

  /* ── the seventeen-key accent map: 17 names, 6 values ───────────────── */

  var ACCENT_MAP = [
    ["dashboard", "Dashboard", "household"], ["chat", "Chat", "household"],
    ["activity", "Activity", "household"], ["admin", "Household settings", "household"],
    ["tasks", "Tasks", "time"], ["reminders", "Reminders", "time"],
    ["calendar", "Calendar", "time"], ["chores", "Chores", "time"],
    ["finance", "Finance", "money"], ["utilities", "Utilities", "money"],
    ["property", "Property", "things"], ["vehicles", "Vehicles", "things"],
    ["pets", "Pets", "things"],
    ["notes", "Notes", "keeping"], ["documents", "Documents", "keeping"],
    ["shopping", "Shopping", "keeping"],
    ["garden", "Garden", "garden"]
  ];

  var FAMILIES = [
    ["time", "Time & work", "accent-family-time", "The things that ask something of you today"],
    ["money", "Money", "accent-family-money", "The things with a number that must be right"],
    ["things", "Things we own", "accent-family-things", "The asset engine's three faces"],
    ["keeping", "Keeping", "accent-family-keeping", "Capture and retrieval"],
    ["household", "Household", "accent-family-household", "The platform itself"],
    ["garden", "Garden", "accent-garden", "Outside the five: the module a member may use exclusively"]
  ];

  /* ── the thirteen status tokens ──────────────────────────────────────── */
  /* [token, alias, word, where it is drawn] */

  var STATUS = [
    ["status-synced", "positive", "In sync", "No row carries it — absence is the synced state. Drawn only where sync is stated in words: the mark's on-tap form, the conflict inbox, sync health."],
    ["status-pending", "text-muted", "Not sent yet", "Quiet by design. The row stays fully editable, so it must not read as an error."],
    ["status-syncing", "info", "Sending", "Only past the 800 ms threshold. Also carries re-snapshot needed, which adds no fourteenth state."],
    ["status-conflict", "warning", "Two versions", "Row flag plus a conflict-inbox entry. Never a modal at reconnect."],
    ["status-rejected", "danger", "Not accepted", "A different category of event from conflict, not a worse severity of it."],
    ["status-offline", "info", "Offline", "The offline bar. Neither a problem nor a success — which is why info exists."],
    ["status-overdue", "danger", "Overdue", "Shown once, then quiet. Chores and Reminders."],
    ["status-blocked", "warning", "Blocked", "Utilities settlement without a closing reading; a task whose dependency is unmet."],
    ["status-estimated", "info", "Estimated", "Informational, never alarming — and an estimated reading never enters a money figure."],
    ["status-private", "text-muted", "Private", "Calendar busy blocks: unmistakable and uninspectable."],
    ["status-locked", "text-muted", "Locked", "A child's suggested-or-locked dashboard layout. Absence, not disabling, wherever possible."],
    ["status-stale", "warning", "Not updated recently", "Calendar connection health, sync health."],
    ["status-no-history", "text-muted", "No history yet", "Garden's eleven-check panel and every derived figure with nothing behind it. Distinguishable from a genuine zero."]
  ];

  /* ── density ─────────────────────────────────────────────────────────── */

  var DENSITY = {
    scale: [
      ["--dens-pad-x", "16px", "8px", "Horizontal cell padding drops one space step"],
      ["--dens-pad-y", "10px", "6px", "Vertical padding shrinks until the row hits 44 pt and stops"],
      ["--dens-row-min", "44px", "44px", "The floor. Compact cannot buy row height on an interactive row"],
      ["--dens-rule", "border", "divider", "Borders become divider rather than border"],
      ["--dens-secondary", "shown", "suppressed", "The optional secondary line moves to a column or the detail pane"]
    ],
    defaults: [
      ["Finance ledger", "compact"], ["Chores weekly grid", "compact"], ["Garden season plan", "compact"],
      ["Utilities tariff breakdown", "compact"], ["Activity log", "compact"],
      ["Everything else on web", "comfortable"], ["Mobile, everywhere", "comfortable — the only mode"]
    ]
  };

  /* ── declared contrast pairs: the list CI tests ──────────────────────── */

  var PAIRS = [];
  function pair(fg, bg, min, use) { PAIRS.push({ fg: fg, bg: bg, min: min, use: use }); }

  var GROUNDS = ["surface", "surface-raised", "surface-sunken"];
  ["surface", "surface-raised", "surface-sunken", "surface-overlay"].forEach(function (bg) {
    pair("text-primary", bg, 4.5, "Body and heading text");
    pair("text-muted", bg, 4.5, "Secondary line, captions, metadata");
  });
  GROUNDS.forEach(function (bg) {
    pair("text-link", bg, 4.5, "Inline link");
    ["accent", "accent-family-time", "accent-family-money", "accent-family-things", "accent-family-keeping", "accent-garden"]
      .forEach(function (a) { pair(a, bg, 3, "Module identity mark and emphasis"); });
    ["danger", "warning", "positive", "info"].forEach(function (s) { pair(s, bg, 4.5, "Status word beside its icon"); });
    pair("border-strong", bg, 3, "Input and table boundary");
    pair("focus", bg, 3, "Focus ring");
  });
  ["accent", "accent-family-time", "accent-family-money", "accent-family-things", "accent-family-keeping", "accent-garden"]
    .forEach(function (a) { pair("text-on-accent", a, 4.5, "Ink on an accent fill"); });
  pair("text-on-danger", "danger", 4.5, "Ink on a danger fill");
  pair("text-inverse", "surface-inverse", 4.5, "Tooltip and inverse chip");
  ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6", "chart-7", "chart-8"].forEach(function (c) {
    pair(c, "surface-raised", 3, "Series against the chart's own surface");
    pair(c, "surface-sunken", 3, "Series in a sunken well");
  });
  pair("chart-axis", "surface-raised", 3, "Axis and ticks");
  /* Both names, on all three grounds. A status is spent under its own name as often
     as under the token it aliases — Stage 20 found four such spends outside this list,
     which meant CI was not testing the name the screens actually use. */
  STATUS.forEach(function (s) {
    GROUNDS.forEach(function (bg) {
      pair(s[1], bg, 4.5, s[0] + " — " + s[2]);
      pair(s[0], bg, 4.5, s[0] + ", under its own name — " + s[2]);
    });
  });

  var EXEMPT = [
    ["text-disabled", "2.2:1 by intent. Never the sole carrier; absence is preferred to disabling, so this token appears rarely and never alone."],
    ["border, border-subtle, divider", "Decorative separators. The boundary that must be seen is border-strong, which is tested."],
    ["chart-grid", "Grid lines behind data. Series colours and axis carry the meaning and are tested."],
    ["focus-ring-offset", "The gap, not the ink. It is tested implicitly by the focus pair on each surface."],
    ["skeleton-bg", "A loading shape with no text on it."]
  ];

  /* ── contrast maths ─────────────────────────────────────────────────── */

  function rgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
  function lum(h) {
    var c = rgb(h).map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function ratio(a, b) {
    var A = lum(a), B = lum(b);
    return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
  }

  var BY_NAME = {};
  T.forEach(function (t) { BY_NAME[t[0]] = { light: t[1], dark: t[2], group: t[3], purpose: t[4], prim: t[5] }; });
  STATUS.forEach(function (s) {
    var a = BY_NAME[s[1]];
    BY_NAME[s[0]] = { light: a.light, dark: a.dark, group: "status13", purpose: s[3], prim: "= " + s[1], alias: s[1], word: s[2] };
  });

  function resolve(name, theme) { var t = BY_NAME[name]; return t ? t[theme] : null; }

  /* dark-only definitions: the thing the gate refuses */
  var DARK_ONLY = Object.keys(BY_NAME).filter(function (k) { return !BY_NAME[k].light; });

  /* ── emit the CSS custom properties ─────────────────────────────────── */

  function css() {
    var lines = [":root {"];
    T.forEach(function (t) { lines.push("  --" + t[0] + ": " + t[1] + ";"); });
    STATUS.forEach(function (s) { lines.push("  --" + s[0] + ": var(--" + s[1] + ");"); });
    SPACE.forEach(function (s) { lines.push("  --" + s[0] + ": " + s[1] + ";"); });
    RADII.forEach(function (r) { lines.push("  --" + r[0] + ": " + r[1] + ";"); });
    MOTION.durations.forEach(function (d) { lines.push("  --" + d[0] + ": " + d[1] + ";"); });
    MOTION.easings.forEach(function (e) { lines.push("  --" + e[0] + ": " + e[1] + ";"); });
    lines.push("  --dens-pad-x: 16px; --dens-pad-y: 10px; --dens-row-min: 44px; --dens-rule: var(--border);");
    lines.push("  --shadow-1: 0 1px 2px rgba(20,22,30,0.06), 0 1px 1px rgba(20,22,30,0.04);");
    lines.push("  --shadow-2: 0 8px 24px rgba(20,22,30,0.10), 0 2px 6px rgba(20,22,30,0.06);");
    lines.push("}");
    lines.push('[data-theme="dark"] {');
    T.forEach(function (t) { if (t[2] !== t[1]) lines.push("  --" + t[0] + ": " + t[2] + ";"); });
    lines.push("  --shadow-1: 0 1px 2px rgba(0,0,0,0.5);");
    lines.push("  --shadow-2: 0 8px 24px rgba(0,0,0,0.55);");
    lines.push("}");
    lines.push('[data-density="compact"] { --dens-pad-x: 8px; --dens-pad-y: 6px; --dens-rule: var(--divider); }');
    lines.push('[data-scale="200"] .fx-scale { font-size: 200%; }');
    lines.push('[data-motion="reduced"] * { transition-duration: 0ms !important; animation-duration: 0ms !important; }');
    return lines.join("\n");
  }

  var el = document.createElement("style");
  el.id = "household-tokens";
  el.textContent = css();
  document.head.appendChild(el);

  window.HH_TOKENS = {
    version: "0.2-stage-2-candidate",
    neutral: NEUTRAL, hues: HUES, space: SPACE, radii: RADII, type: TYPE, motion: MOTION,
    tokens: T, status: STATUS, accentMap: ACCENT_MAP, families: FAMILIES,
    density: DENSITY, pairs: PAIRS, exempt: EXEMPT, byName: BY_NAME, darkOnly: DARK_ONLY,
    ratio: ratio, resolve: resolve, cssText: css()
  };
})();
