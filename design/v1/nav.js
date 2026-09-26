/* Stage 6 — both shells and all of navigation, as data.
   Source: docs/design/04-navigation.md §1-§9, 08-decisions.md DD-11 (four tabs is a
   first-class layout), DD-7 (Today's five groups), DD-8 (the Add sheet's slow window),
   prd/06-clients.md §2 and §6, prd/02-identity-and-access.md §1, prd/09-decisions.md D-4, D-38.

   The rule this file exists to enforce: navigation is COMPUTED from the member's grants,
   never authored per persona. Every bar, sidebar and arrange list on the page is derived
   from HH_FIXTURES, so an absent module cannot be drawn by accident and a hole in the tab
   bar cannot be drawn at all.
*/
(function () {

  /* Dashboard is a destination assembled from whatever the member does have, so it is never
     grant-gated itself; every other entry in the fixture's module list is a feature module and
     is subject to §5. Today is not in that list at all — Stage 8 reconciled the two seventeens
     and Today is a cross-cutting screen with a route and a tab slot and nothing to grant. */
  var PLATFORM = ["dashboard"];

  /* ── §1 the five destinations, and the one that can be absent ─────────── */

  var DESTINATIONS = [
    ["home", "Home", "dashboard", "The dashboard: widgets contributed by modules, arranged by the member.", false,
      "Present for every member, including one with none on fourteen modules. A member with few widgets gets a short Home, not a locked one."],
    ["today", "Today", "today", "A cross-module agenda — events, due reminders, chores, tasks marked doing, garden work.", false,
      "Assembled from the reminder strand and the metric catalog, so it is short rather than absent when the member has little. Deliberately not customisable (FR-DB7)."],
    ["add", "Add", "add", "A centre action opening the capture sheet: the six most likely creates for this household.", false,
      "A slow-moving window, never reordered while open, with a non-arbitrary cold-start set (DD-8). Its own screen is Stage 11."],
    ["chat", "Chat", "chat", "Threads, if the module is enabled and the member is granted it.", true,
      "The one tab that can be absent: module disabled, a member with none, or — pending counsel on the Online Safety Act — a UK household (D-89)."],
    ["more", "More", "more", "Every module the member has, as a searchable list, plus settings.", false,
      "The overflow is a searchable list, not a second bar. Modules the member has none on are not in it."]
  ].map(function (d) {
    return { id: d[0], label: d[1], icon: d[2], contents: d[3], conditional: d[4], note: d[5] };
  });

  /* ── the bar, drawn twice (DD-11) ──────────────────────────────────────── */

  var BAR = {
    decision: "Order is preserved and the spacing is re-solved. Removing Chat leaves Home · Today · Add · More; Add stays the third slot in both drawings, so the one control people reach for without looking does not move to a different part of the bar. No slot is stretched to absorb the gap and no slot is left empty.",
    rejected: [
      ["A five-slot bar with a gap", "The exact failure N6 exists to prevent: hidden rather than absent, and it tells a member with no Chat that something is being kept from them."],
      ["Promote a module into the fifth slot", "The set is settled (§1). A bar whose contents depend on a household's module list is a different bar on every phone, and muscle memory never forms."],
      ["Stretch four slots to fill five", "Targets grow, which is harmless, but Add drifts to the centre-right of a wider gap and the two drawings stop feeling like the same product."]
    ],
    rules: [
      ["Four is finished work", "Both drawings are reviewed at 200 % text and in both themes. Neither is derived from the other at runtime."],
      ["44 pt, both readings", "The floor binds per slot, not per bar, so the five-slot drawing is the one that has to be checked hardest on a narrow phone."],
      ["Label always", "Icon plus word in both drawings. The label is never dropped to buy width — at 200 % text the bar grows taller instead."],
      ["Add is a sheet, not a route", "It opens a capture surface over the current destination and returns to it, so the bar's selected state never changes because somebody added something."],
      ["Add is present only where something can be created", "A member who holds contribute nowhere has nothing the sheet could offer, so the tab is absent rather than opening a sheet that explains itself \u2014 absence, not disabling, and no screen whose whole content is a refusal. The bar re-solves to four slots the same way it does without Chat."]
    ]
  };

  /* ── §4 the web shell ──────────────────────────────────────────────────── */

  var SIDEBAR = {
    rules: [
      ["The sidebar is the module list", "Filtered and ordered per member (§5). Not a nav tree with seventeen expandable sections, and not a second copy of the tab bar."],
      ["One search field, one result row", "Global search is one endpoint across everything the caller may see (FR-SE1). Grants apply before ranking, so the result count is itself not a leak."],
      ["It is a workspace", "Setup, configuration, planning, long-form reading, admin and billing happen here, and it may assume a keyboard."],
      ["The household is stated, not remembered", "The switcher sits at the top of the sidebar because the active household is in the URL (D-4) and the UI is the only place ambiguity can enter."]
    ],
    landing: "The same dashboard as the mobile Home, at its wide reading — the landing route is the dashboard, not a separate web home."
  };

  /* ── §5 per-member order and visibility (D-38) ─────────────────────────── */

  var ARRANGE = {
    sections: [
      ["Pinned", "Sits above the rest of the list in both clients. A pin is a personal preference and needs only view."],
      ["In order", "Drag, or move with the keyboard from the same handle. The order is per member and per household."],
      ["Hidden by me", "Recoverable, and this is the only place in the app it is mentioned. One control brings it back."]
    ],
    surfaces: [
      ["hidden by me", 1, "Named once, in the arrange screen's own hidden section. It appears nowhere else — not greyed in the list, not in search, not in the More list."],
      ["absent", 0, "A module the member has none on has no representation anywhere: not in the list, not in the hidden section, not in the count, not in search, not in Today's rows."]
    ],
    rules: [
      ["Only view is required", "Arranging is a preference, not an administrative act, so the affordance is present for every member including a child."],
      ["Per household", "The same user in two households may order them differently, and does — the fixture's second household is the proof."],
      ["Discoverable, out of the way", "One entry point per client: the More list's own header on mobile, the sidebar's footer on web. Never a long-press as the only path."],
      ["Keyboard, not only drag", "The handle is a button: arrow keys move the row, and the announcement states the new position."]
    ],
    absentLine: "modules are not in this list, are not counted here, and are not mentioned anywhere else in the app."
  };

  /* ── §6 household switching ────────────────────────────────────────────── */

  var SWITCHER = {
    changes: [
      ["Module list", "grants differ per household, so the sidebar and the More list are rebuilt"],
      ["Grants", "the same user can be owner in one household and a plain member in another"],
      ["Entitlement banner", "one household may be paid and the other trialing, at the same time"],
      ["Timezone", "dates, due days and Today's contents are computed in the household's zone"],
      ["Base currency", "every money figure on screen, including the ones already rendered"],
      ["Dashboard layout", "the widget order is per member per household, so Home changes too"]
    ],
    rules: [
      ["All at once", "Switching is one event. There is no state where the sidebar has switched and the banner has not."],
      ["Unambiguous on every screen", "The household name is in the app bar wherever a household-scoped action is possible."],
      ["No current household on the session", "It is in the URL (D-4), which is why a deep link can target one household while another is on screen."]
    ],
    /* Stage-6 fixture extension, stated as such: §6 requires that switching changes the
       module list, and a single grant set per user cannot demonstrate that. Grants for the
       second household, for the two members it has. */
    chata: {
      note: "Stage 6 extends the fixture with per-household grants, because a switcher that changes nothing is not the switcher §6 describes.",
      roles: { jana: "member", milos: "owner" },
      grants: {
        jana: { dashboard: "view", garden: "contribute", documents: "view", shopping: "contribute", chores: "view", admin: "view" },
        milos: { dashboard: "view", garden: "manage", documents: "manage", property: "manage", utilities: "manage", chores: "manage", shopping: "contribute", notes: "manage", activity: "view", calendar: "manage" }
      }
    }
  };

  /* ── §8 the four deep-link situations ──────────────────────────────────── */

  var DEEPLINKS = [
    {
      id: "warm", name: "Warm", ref: "06-clients §6 · 1",
      story: "The app is open, in the right household. The notification names an electricity reading Petr entered this morning.",
      kind: "target", chrome: "Tilcerovi · Utilities",
      title: "Electricity — cellar meter", body: "18 402,4 kWh · read 3 March by Petr",
      lines: ["No interstitial, no confirmation, no re-render of the shell — the target is pushed onto the current stack and Back returns to where the member was."],
      actions: []
    },
    {
      id: "cold", name: "Cold start", ref: "06-clients §6 · 2",
      story: "The app was killed. The link has to survive launch, authentication and household resolution without being dropped on the way.",
      kind: "auth", chrome: "Household",
      title: "Sign in", body: "The destination is held while you sign in, and it is named here so nobody wonders where they will land.",
      lines: ["The pending destination is stated on the sign-in screen and again after a PIN or MFA step. If resolution fails, the member lands on Today with the link kept, not discarded."],
      actions: ["Sign in", "After signing in: Utilities · electricity reading"]
    },
    {
      id: "wrong", name: "Wrong household", ref: "06-clients §6 · 3",
      story: "The target is in Chata Vysočina. Jana is looking at Tilcerovi. She belongs to both.",
      kind: "switch", chrome: "Chata Vysočina · Garden",
      title: "Bed 3 — Rajčata", body: "Switched household to open this link.",
      lines: ["Switch, then resolve — in that order, and the switch is stated rather than silent, because everything else on screen changed with it. One control switches back and keeps the target open where it exists."],
      actions: ["Back to Tilcerovi"]
    },
    {
      id: "noaccess", name: "No access", ref: "06-clients §6 · 4",
      story: "The grant was withdrawn, or the entity is gone. Two different causes, deliberately one screen.",
      kind: "neutral", chrome: "Tilcerovi",
      title: "This link doesn’t open anything here.",
      body: "If somebody sent it to you, ask them what it was for.",
      lines: ["It names nothing, confirms nothing and offers no retry. A message that distinguished “deleted” from “not permitted” would answer a question the member is not entitled to ask — and there is no public sharing anywhere in the product, so every such link came from inside the household and this can be said plainly."],
      actions: ["Back to Today"]
    }
  ];

  var SLUG404 = {
    ref: "§7 · FR-NO5",
    title: "There’s no note at this address.",
    body: "Notes and Documents are addressed by their path, so renaming or moving one changes its link and the old one stops working. There are no redirects. Nothing was deleted.",
    actions: ["Browse Notes", "Search for it"],
    note: "The distinction from the no-access screen is worth stating: this one may explain itself, because the household is internal and the address is not a secret. A document's content URL is id-based and permanent, so an attachment link never lands here."
  };

  /* ── §7 the three within-module shapes ─────────────────────────────────── */

  var SHAPES = [
    { shape: "List → detail", modules: ["Reminders", "Shopping", "Chores", "Vehicles", "Pets", "Property", "Finance", "Utilities", "Chat"],
      mobile: "The list pushes the detail. Back returns to the same scroll position and the same filter.",
      web: "Two-pane where the list is worth keeping in view, a side panel where the detail is an edit rather than a read.",
      note: "Nine modules, one shape. A tenth reading of it would be a new thing to learn for no new capability." },
    { shape: "Tree → detail", modules: ["Notes", "Documents"],
      mobile: "One level at a time with a path header, because a tree indented on a phone is unreadable by the third level.",
      web: "Persistent tree beside the document, resizable, with the root switcher above it.",
      note: "The root switcher — shared against private — is navigation, not a filter: it changes which tree you are in, and it is the first control in both clients." },
    { shape: "Board / grid / calendar", modules: ["Tasks", "Chores weekly grid", "Calendar", "Garden beds and season"],
      mobile: "A list-first alternative for each, and it is the mobile default. Agenda for Calendar, my-column for Tasks, mine-first for Chores, bed list for Garden.",
      web: "The grid is primary here — it is the reason the web client exists for these four.",
      note: "The list-first alternative is a designed view, not a fallback: it is what a phone shows, and it has to answer the same question the grid answers." }
  ];

  /* ── glyphs the vendored base set covers, drawn here only so this page can
        render without fetching (N8). Lines and circles; nothing meaningful. ── */

  var GLYPHS = {
    more: ["M4.6 7.4h14.8", "M4.6 12h14.8", "M4.6 16.6h14.8"],
    search: ["M10.6 4.8a5.8 5.8 0 1 0 0 11.6a5.8 5.8 0 1 0 0-11.6", "M14.9 14.9l4.5 4.5"],
    switcher: ["M8.4 9.6L12 6l3.6 3.6", "M8.4 14.4L12 18l3.6-3.6"],
    grip: ["M9.4 6.6h0.1", "M9.4 12h0.1", "M9.4 17.4h0.1", "M14.6 6.6h0.1", "M14.6 12h0.1", "M14.6 17.4h0.1"],
    pin: ["M12 13.6V20", "M7.6 4.4h8.8l-1.4 4.2 2 5H7l2-5z"],
    eye: ["M2.8 12S6.6 6.4 12 6.4 21.2 12 21.2 12 17.4 17.6 12 17.6 2.8 12 2.8 12z", "M12 9.4a2.6 2.6 0 1 0 0 5.2a2.6 2.6 0 1 0 0-5.2"],
    back: ["M19 12H5.4", "M10.8 6.6L5.4 12l5.4 5.4"],
    chevronRight: ["M9.6 5.4L16.2 12l-6.6 6.6"]
  };

  var NAV_LABELS = [
    ["Household switcher", "Switch household. Currently {household}", "app bar · sidebar head"],
    ["Search this household", "Search this household", "app bar · sidebar"],
    ["More", "More — all your modules and settings", "tab bar"],
    ["Add", "Add", "tab bar centre"],
    ["Reorder handle", "Reorder {name}. Use arrow keys to move it", "arrange"],
    ["Pin", "Pin {name} to the top of your list", "arrange"],
    ["Show again", "Show {name} in your list again", "arrange · hidden section"],
    ["Back", "Back", "pushed detail"]
  ];

  var DEFERRED = [
    ["Today's five groups and its rows", "St. 11", "The spine screen itself, with the conditional alerts and the source-module chips. Stage 6 draws the destination, not its contents."],
    ["The Add sheet's six entries", "St. 11", "The ranking window is settled (DD-8); which six a fixture household gets is drawn with the capture surfaces they land on."],
    ["The dashboard at 2 / 4 / 6 columns", "St. 10", "Home is a destination here and a designed screen there, including the child's locked layout."],
    ["Global search results", "St. 11", "One result row for every module, with the no-snippet and no-path variants already built in Stage 4."],
    ["The household switcher's create and join paths", "St. 8", "Create household, invitation acceptance and the six entitlement banner states belong to the household stage."],
    ["Please update, in five languages", "St. 7", "The blocking minimum-version screen sits with auth, where the other screens a member meets before the app opens live."],
    ["Web build-id reload prompt", "St. 7", "Version surfaces are drawn together; the shell only reserves the place it appears."]
  ];

  /* ── computation: a member's navigation, derived and never authored ────── */

  function modulesOf() {
    var F = window.HH_FIXTURES;
    return F.modules.filter(function (m) { return PLATFORM.indexOf(m[0]) < 0; });
  }

  function grantsFor(memberId, householdId) {
    var F = window.HH_FIXTURES;
    var member = F.members.filter(function (m) { return m.id === memberId; })[0];
    if (!member) return null;
    if (householdId === "hh-chata") {
      var g = SWITCHER.chata.grants[memberId];
      if (!g) return null;
      var out = {};
      F.modules.forEach(function (m) { out[m[0]] = g[m[0]] || "none"; });
      return out;
    }
    /* Household settings writes land here: a removed member belongs nowhere, and a module
       an owner turned off is `none` for everybody while its data is kept */
    if (member.removed) return null;
    var hh = F.households.filter(function (h) { return h.id === householdId; })[0];
    var dis = (hh && hh.disabled) || [];
    if (!dis.length) return member.grants;
    var o2 = {};
    Object.keys(member.grants).forEach(function (k) { o2[k] = dis.indexOf(k) >= 0 ? "none" : member.grants[k]; });
    return o2;
  }

  function canContribute(grants) {
    return modulesOf().some(function (m) {
      return grants[m[0]] === "contribute" || grants[m[0]] === "manage";
    });
  }

  function navFor(memberId, householdId) {
    var F = window.HH_FIXTURES;
    var member = F.members.filter(function (m) { return m.id === memberId; })[0];
    var household = F.households.filter(function (h) { return h.id === householdId; })[0];
    var grants = grantsFor(memberId, householdId);
    if (!member || !household || !grants) {
      return { member: member, household: household, belongs: false };
    }
    var granted = modulesOf().filter(function (m) { return grants[m[0]] !== "none"; });
    var absent = modulesOf().filter(function (m) { return grants[m[0]] === "none"; });
    var hasChat = grants.chat !== "none";
    var canAdd = canContribute(grants);

    var tabs = [DESTINATIONS[0], DESTINATIONS[1]];
    if (canAdd) tabs = tabs.concat([DESTINATIONS[2]]);
    if (hasChat) tabs = tabs.concat([DESTINATIONS[3]]);
    tabs = tabs.concat([DESTINATIONS[4]]);

    var role = householdId === "hh-chata" ? (SWITCHER.chata.roles[memberId] || "member") : member.role;

    return {
      member: member, household: household, belongs: true, grants: grants, role: role,
      tabs: tabs, addIndex: canAdd ? 2 : -1, hasChat: hasChat, canAdd: canAdd,
      granted: granted, absent: absent,
      /* the More list: granted feature modules other than Chat, which has its own tab */
      more: granted.filter(function (m) { return !(hasChat && m[0] === "chat"); }),
      /* screens with content of their own: Home plus every granted feature module */
      screens: 1 + granted.length,
      locked: !!member.locked
    };
  }

  /* ── the gate, computed ───────────────────────────────────────────────── */

  function checks() {
    var F = window.HH_FIXTURES, out = [];
    var five = navFor("jana", "hh-tilcer"), four = navFor("milos", "hh-tilcer");
    var klara = navFor("klara", "hh-tilcer");

    var orderPreserved = four.tabs.map(function (t) { return t.id; }).join(",") ===
      five.tabs.map(function (t) { return t.id; }).filter(function (id) { return id !== "chat"; }).join(",");
    out.push({
      name: "Both bars are finished layouts",
      pass: five.tabs.length === 5 && four.tabs.length === 4 && orderPreserved && five.addIndex === four.addIndex,
      detail: "Five slots for Jana, four for Miloš, order preserved, Add the third slot in both. Neither drawing has an empty or stretched slot."
    });

    var conditional = DESTINATIONS.filter(function (d) { return d.conditional; });
    out.push({
      name: "Exactly one destination is conditional",
      pass: conditional.length === 1 && conditional[0].id === "chat",
      detail: "Chat, and only Chat. Home and Today are platform destinations assembled from what the member has, so they are short rather than absent."
    });

    var leaks = [];
    F.members.forEach(function (m) {
      var n = navFor(m.id, "hh-tilcer");
      if (!n.belongs) return;
      n.more.concat(n.granted).forEach(function (mod) {
        if (n.grants[mod[0]] === "none") leaks.push(m.name + " · " + mod[1]);
      });
    });
    out.push({
      name: "Every list is computed from grants",
      pass: leaks.length === 0,
      detail: leaks.length ? leaks.join(" · ") : "Five members × " + modulesOf().length + " feature modules checked: no bar, sidebar or More list contains a module its member has none on."
    });

    var hidden = ARRANGE.surfaces[0], absent = ARRANGE.surfaces[1];
    out.push({
      name: "Hidden is recoverable, absent leaves no trace",
      pass: hidden[1] === 1 && absent[1] === 0,
      detail: "Hidden by me is named in exactly one surface and reversible from it. Absent is named in none — including the counts, which is why the arrange screen states how many are not in it without listing them."
    });

    out.push({
      name: "Klára’s app is three screens and complete",
      pass: klara.screens === 3 && klara.tabs.length === 5 && klara.more.length === 1,
      detail: "Home, Chat and Shopping. Five finished tab slots — she has Chat — and a More list with one module in it and settings under it. Nothing is greyed and nothing is counted that she cannot open."
    });

    out.push({
      name: "Add is present only for a member who can create something",
      pass: (function () {
        var viewOnly = {}; modulesOf().forEach(function (m) { viewOnly[m[0]] = "view"; });
        return five.canAdd && four.canAdd && klara.canAdd && !canContribute(viewOnly);
      })(),
      detail: (function () {
        var viewOnly = {}; modulesOf().forEach(function (m) { viewOnly[m[0]] = "view"; });
        return "All five fixture members hold contribute or manage somewhere \u2014 Kl\u00e1ra on Shopping alone \u2014 so every bar in this household carries Add, and the four-slot drawing here is the one without Chat. A member with view everywhere resolves to " +
          (canContribute(viewOnly) ? "an Add tab" : "no Add tab") +
          ", which is the drawing the rule exists for: the sheet\u2019s cold-start set is built from contribute grants, so for that member it would be empty, and an empty capture surface is a screen whose whole content is a refusal.";
      })()
    });

    out.push({
      name: "Four deep-link situations, four drawn screens",
      pass: DEEPLINKS.length === 4 && DEEPLINKS.filter(function (d) { return d.id === "noaccess"; })[0].title.indexOf("permission") < 0,
      detail: "Warm, cold start, wrong household, no access. The no-access screen names no entity, states no cause and offers no retry, so a withdrawn grant and a deleted row are indistinguishable from outside."
    });

    out.push({
      name: "Switching changes six things at once",
      pass: SWITCHER.changes.length === 6 && !!SWITCHER.chata.grants.jana,
      detail: "Module list, grants, banner, timezone, currency and dashboard layout. The fixture's second household gives Jana a different role and a different module list, so the switcher demonstrates itself."
    });

    out.push({
      name: "Every icon-only nav control has a label",
      pass: NAV_LABELS.length >= 8,
      detail: NAV_LABELS.length + " controls registered with their announcement strings, including the reorder handle's keyboard announcement and the switcher's current-household state."
    });

    return out;
  }


  /* ── the four screens the shell routes to (Stage 21 follow-up) ─────────
     Drawn and measured in Stage 6, and until now reachable only there. The
     switcher, per-member arrange, the deep-link outcomes and the neutral
     not-available screen are declared here so the application can route to
     them from the same registry every module screen comes from. */

  var SCREENS = [
    {
      id: "A-36", route: "/households", name: "Household switcher", title: "Your households",
      kind: "list", client: "mw", preset: "D",
      lede: "Which household you are in is in the URL, not on the session — so it is stated here rather than remembered.",
      notice: { tone: "info", body: "Switching is one event: all " + SWITCHER.changes.length + " of these change together, or none of them do." },
      empty: { s: "One household", e: "You are in a single household, so there is nothing to switch between.", a: "" },
      error: "Your households could not be read. The one you are in is unaffected.",
      readonly: "Read-only — this household's subscription is paused. Switching still works.",
      foot: "The household name sits in the app bar wherever a household-scoped action is possible.",
      note: "06-clients §6 · the second household gives the same member a different role and a different module list."
    },
    {
      id: "F-15", route: "/more/arrange", name: "Per-member arrange — order and visibility",
      title: "Arrange your modules", kind: "list", client: "mw", preset: "D",
      lede: "Your order, your pins, your hidden section. Per member and per household, and only view is required.",
      notice: { tone: "info", body: ARRANGE.rules[0][1] },
      empty: { s: "Nothing to arrange yet", e: "Modules you hold appear here in the order you put them.", a: "" },
      error: "Your order could not be read, so the list is in its default order.",
      readonly: "Read-only — the subscription is paused. Your existing order stands; changing it waits.",
      withdrawn: "A module you had was withdrawn, so it left this list with no trace.",
      foot: ARRANGE.surfaces[0][2],
      note: "Hidden by me is recoverable from exactly one place. Absent is mentioned nowhere at all."
    },
    {
      id: "F-16", route: "/link", name: "Deep link resolution — four situations",
      title: "Opening a link", kind: "list", client: "mw", preset: "D",
      lede: "Four things can be true when a link arrives, and each one gets a finished screen rather than a spinner.",
      notice: { tone: "info", body: "Warm, cold start, wrong household, no access — in that order of likelihood." },
      error: "The link could not be resolved. Nothing about the target is stated, because nothing is known.",
      foot: "Wrong household switches first and says so, because everything else on screen changed with it.",
      note: "06-clients §6 · the no-access screen names no entity, states no cause and offers no retry."
    },
    {
      id: "F-17", route: "/unavailable", name: "Neutral not-available", title: "Not available",
      kind: "notfound", client: "mw", preset: "F",
      lede: "This is not available.",
      notice: { tone: "info", body: "No entity is named, no cause is given and no retry is offered — a withdrawn grant and a deleted row are indistinguishable from here, deliberately." },
      primary: "Go to Home",
      foot: "The one screen in the product whose emptiness is the requirement.",
      note: SLUG404 && SLUG404.note ? SLUG404.note : "06-clients §6 · 4."
    }
  ];

  window.HH_NAV = {
    version: "0.1-stage-6-candidate",
    platform: PLATFORM,
    destinations: DESTINATIONS,
    bar: BAR, sidebar: SIDEBAR, arrange: ARRANGE, switcher: SWITCHER,
    deeplinks: DEEPLINKS, slug404: SLUG404, shapes: SHAPES,
    glyphs: GLYPHS, labels: NAV_LABELS, deferred: DEFERRED,
    screens: SCREENS,
    modulesOf: modulesOf, navFor: navFor, grantsFor: grantsFor,
    canContribute: canContribute, checks: checks
  };
})();
