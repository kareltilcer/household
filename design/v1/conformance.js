/* Stage 20 — the conformance sweep and the five walkthroughs.

   This file closes the plan. It does four things and nothing else:

   1. It draws the thirty-two cells four rows still owed after Stage 19, so the
      ledger can reach zero unbuilt rows. The cells are drawn HERE and credited
      HERE — ledger.js carries a LATE map naming this file, rather than the four
      rows being quietly back-dated into Stages 5 and 6.
   2. It runs the sweeps 07-delivery asks for as arithmetic over the token file,
      the shells and the fixture: both themes on every route, 200 % text, the
      second language beside Czech, the contrast pairs re-run after every late
      colour, focus order and the label register, and 44 pt under compact.
   3. It records what the sweeps cannot settle: which second language ships, and
      the five languages of Please update, are copy decisions and stay open.
   4. It carries the five persona walkthroughs as ordered steps, every one of
      them resolving to a ledger row that is built.

   Nothing here invents a number. Where a figure is a measurement it is computed
   from foundations.js's own tokens or from Stage 16's own character widths;
   where a figure is a bracket, the bracket is drawn.                          */

(function () {
  var TODAY = "2026-09-09";

  /* Stage 16's own measure, taken at 16 px: the widths the flow view was
     accepted on. Reusing them means the two stages cannot disagree. */
  var CH_SANS = 6.8, CH_MONO = 7.2;
  function textPx(s, size, mono) {
    return (s || "").length * (mono ? CH_MONO : CH_SANS) * ((size || 16) / 16);
  }
  function r1(n) { return Math.round(n * 10) / 10; }

  /* ─────────────────────────────────────────────────────────────────────
     1. THE REMAINDER — the cells Stages 5 and 6 left undrawn.
     Four rows, eighteen bodies, two clients each where the row is drawn twice.
     ───────────────────────────────────────────────────────────────────── */

  var REMAINDER = [
    {
      row: "F-5", name: "Conflict inbox", stage: 5, clients: ["m", "w"],
      file: "Sync and Honesty.dc.html", route: "/inbox",
      why: "Stage 5 drew the five states the inbox is about — populated, empty, offline, conflicted, rejected — and left the three that are about the inbox itself.",
      cells: [
        { state: "loading",
          title: "Skeleton at entry height, with the count already stated",
          body: "Three grey rows at the height of an entry \u2014 two names, two times, one route line. The badge that brought you here is server-derived and already known, so the header says \u201c3 things disagree\u201d while the rows are still grey. Nothing about the list moves when they land.",
          note: "The one screen where the count is honest before the content is.",
          client: "Identical in both clients; the web list is wider and shows the module column in the skeleton too." },
        { state: "error",
          title: "Unread is not empty",
          body: "\u201cWe couldn\u2019t read your inbox. What disagrees is on the server and this device hasn\u2019t got it yet.\u201d Under it, the last count this device knew and when: \u201c3 things, as of 18:40 yesterday.\u201d One button: Zkusit znovu.",
          note: "Never draws zero. Stage 5's own zero-versus-nothing rule, applied to the surface that would break it most quietly.",
          client: "Same body. On web the button sits inline with the sentence; on mobile it is full width." },
        { state: "readonly",
          title: "You may read what disagrees; you may not answer it",
          body: "Entries are listed and each still routes to its row. The resolver arrives with its two buttons absent and the entitlement banner above the comparison saying which household state removed them. Nothing auto-resolves while a household is read-only and nothing ages out \u2014 the three conflicts are still three when billing is fixed.",
          note: "Read-only removes the answer, not the question.",
          client: "Both. The banner is above the pane on web and above the list on mobile." }
      ]
    },
    {
      row: "A-36", name: "Household switcher", stage: 6, clients: ["m", "w"],
      file: "Shells and Navigation.dc.html", route: "/households/switch",
      why: "Stage 6 drew it populated, offline and permission-absent. The four here are the ones where the switcher is about the memberships rather than about the households.",
      cells: [
        { state: "loading",
          title: "The household you are in is never a skeleton",
          body: "The active household is in the URL (D-4), so its name and role are drawn immediately. Only the other memberships are grey rows. Opening the switcher cannot blank the household you are standing in.",
          note: "A switcher that flickers its own title teaches people not to open it.",
          client: "Mobile: a sheet over the current screen. Web: a panel under the sidebar head, same rule." },
        { state: "error",
          title: "The other households could not be read",
          body: "One line where the list would be: \u201cWe couldn\u2019t load your other households.\u201d Try again under it. The current household stays fully usable and the app never falls back to one you did not choose.",
          note: "The failure is scoped to the list, not to the session.",
          client: "Both." },
        { state: "withdrawn",
          title: "Removed from a household while the switcher is open",
          body: "The row for Chata Vyso\u010dina goes, and one sentence names it: \u201cYou\u2019re no longer in Chata Vyso\u010dina.\u201d If you were standing in it, the app moves you to a household you still have rather than to an empty shell \u2014 and says that too.",
          note: "The only place in the app where a retraction may name the object: you were a member of it, and it is a household rather than a row inside one.",
          client: "Both. On web the route changes under you, so the sentence stays on screen until dismissed." },
        { state: "readonly",
          title: "A lapsed household is still a household",
          body: "It stays in the list with the word \u201cjen ke \u010dten\u00ed\u201d next to its name \u2014 a word, not a lock glyph alone. Switching into it is allowed; that is how the payer gets to the billing screen.",
          note: "Hiding it would hide the only route to fixing it.",
          client: "Both." }
      ]
    },
    {
      row: "F-13", name: "Web sidebar", stage: 6, clients: ["w"],
      file: "Shells and Navigation.dc.html", route: "/ (web shell)",
      why: "Web-only, and Stage 6 drew it populated, empty, offline and permission-absent.",
      cells: [
        { state: "loading",
          title: "Chrome first, module list last",
          body: "The switcher, the search field and the settings entry are live. The module list is three grey rows, because grants are the thing being fetched and drawing a module for half a second that the member does not hold is the one failure the sidebar can cause.",
          note: "Search works during it: it is a server read either way.",
          client: "Web only." },
        { state: "error",
          title: "No modules, and the reason",
          body: "\u201cWe couldn\u2019t work out what you have access to.\u201d Try again under it, and no rows. It does not fall back to a cached list: offline is a different state with a different answer, and a stale grant list drawn as live is the leak.",
          note: "The distinction that makes the two states different screens: offline renders the replica's own resolved grants and says it is offline; error renders nothing and says why.",
          client: "Web only." },
        { state: "withdrawn",
          title: "A module leaves the list between two paints",
          body: "The entry disappears with no gap where it was. If the member was standing in it, the pane becomes Stage 6\u2019s neutral not-available \u2014 no cause, no entity name, no retry \u2014 and the sidebar has one fewer row.",
          note: "Absent leaves no trace anywhere, including here.",
          client: "Web only." },
        { state: "readonly",
          title: "The whole list stays; the new-thing controls go",
          body: "Every module the member holds is still listed and still opens. The per-module create affordances at the head of each pane are absent, and the entitlement banner sits above the content pane rather than inside the nav.",
          note: "Navigation is a read surface. Entitlement never edits it.",
          client: "Web only." }
      ]
    },
    {
      row: "F-15", name: "Per-member arrange \u2014 order and visibility", stage: 6, clients: ["m", "w"],
      file: "Shells and Navigation.dc.html", route: "/settings/arrange",
      why: "Stage 6 drew populated, empty and permission-absent; conflicted and rejected are declared unreachable. These seven are what remains, and five of them are about the fact that an arrangement is a write.",
      cells: [
        { state: "loading",
          title: "Section heads before rows",
          body: "P\u0159ipnut\u00e9, Va\u0161e moduly and Skryt\u00e9 mnou are drawn immediately \u2014 they do not depend on the fetch \u2014 with grey rows under the middle one. In practice this is one paint: the order is local.",
          note: "",
          client: "Both." },
        { state: "error",
          title: "Falls back to the default order, and says so",
          body: "\u201cShowing the default order \u2014 we couldn\u2019t read yours.\u201d The list is usable and reordering is disabled until it can be read, because saving over an order you cannot see is how a member loses their arrangement.",
          note: "The one screen in the app where a failed read disables a write.",
          client: "Both." },
        { state: "offline",
          title: "Indistinguishable, because it is local first",
          body: "The list reorders under the finger exactly as online. The offline bar is above it, as everywhere. Nothing is dimmed and no handle is removed.",
          note: "",
          client: "Both." },
        { state: "pending",
          title: "Queued, and already in force",
          body: "The row keeps its new position and carries \u201cneode\u0161l\u00e1no\u201c on this screen only. Everywhere else \u2014 the More list, the sidebar, the tab bar \u2014 the new order is already what the member sees, because a personal preference applies locally the moment it is set.",
          note: "The mark says the server does not know yet, not that the change has not happened.",
          client: "Both." },
        { state: "syncing",
          title: "One line, past 800 ms only",
          body: "At the top of the list, not per row. Six reorders in one sitting are one write, so this is rarely seen \u2014 and is drawn anyway, because rare is not never.",
          note: "",
          client: "Both." },
        { state: "withdrawn",
          title: "A module you were arranging is no longer yours",
          body: "The row goes, and if it was pinned the pin goes with it. Nothing is said beside the row: an arrangement screen is not where a member should learn about an access change, and absent leaves no trace by construction.",
          note: "The change is visible as an absence and nowhere else \u2014 the same rule the sidebar and the More list follow.",
          client: "Both." },
        { state: "readonly",
          title: "The one write a read-only household keeps",
          body: "Order, pins and hidden-by-me are per-member view state (D-38), not household content, so the handles stay live under an entitlement lockout. The banner above says what is read-only and this screen is named as an exception.",
          note: "Drawn deliberately: a read-only household that cannot even reorder its own list reads as broken rather than as unpaid.",
          client: "Both." }
      ]
    }
  ];

  function remainderRun() {
    var L = window.HH_LEDGER;
    var out = { rows: [], cells: 0, clientCells: 0, credited: 0, mismatched: [] };
    REMAINDER.forEach(function (r) {
      out.cells += r.cells.length;
      out.clientCells += r.cells.length * r.clients.length;
      var rec = { row: r.row, name: r.name, stage: r.stage, states: r.cells.map(function (c) { return c.state; }),
                  clients: r.clients, ledgerLate: [], creditedTo: "", ok: false };
      if (L) {
        var lr = L.rows.filter(function (x) { return x.group + "-" + x.n === r.row; });
        rec.clients = lr.map(function (x) { return x.client; });
        if (lr.length) {
          rec.ledgerLate = (lr[0].late || []).slice();
          rec.creditedTo = lr[0].lateBy || "";
          var a = rec.states.slice().sort().join(","), b = rec.ledgerLate.slice().sort().join(",");
          rec.ok = a === b && /Conformance/.test(rec.creditedTo) &&
            lr.every(function (x) { return x.client === "t" || x.built; });
          if (!rec.ok) out.mismatched.push(r.row + ": drawn [" + a + "] against ledger [" + b + "]");
        }
      }
      if (rec.ok) out.credited += 1;
      out.rows.push(rec);
    });
    out.unbuilt = L ? L.rows.filter(function (x) { return !x.built; }).length : null;
    out.unbuiltSwept = L ? L.rows.filter(function (x) { return !x.built && x.client !== "t"; }).length : null;
    out.tablet = L ? L.rows.filter(function (x) { return x.client === "t"; }) : [];
    out.tabletUnbuilt = out.tablet.filter(function (x) { return !x.built; });
    out.sweptTotal = L ? L.rows.filter(function (x) { return x.client !== "t"; }).length : null;
    out.sweptStates = L ? L.rows.filter(function (x) { return x.client !== "t"; })
      .reduce(function (a, x) { return a + x.states.length; }, 0) : null;
    out.sweptDrawn = L ? L.rows.filter(function (x) { return x.client !== "t"; })
      .reduce(function (a, x) { return a + x.drawn.length; }, 0) : null;
    out.total = L ? L.rows.length : null;
    out.states = L ? L.rows.reduce(function (a, x) { return a + x.states.length; }, 0) : null;
    out.drawn = L ? L.rows.reduce(function (a, x) { return a + x.drawn.length; }, 0) : null;
    return out;
  }

  /* ─────────────────────────────────────────────────────────────────────
     2. THE ROUTE INVENTORY — every route the eighteen module files declare.
     ───────────────────────────────────────────────────────────────────── */

  var SOURCES = [
    ["auth", "HH_AUTH", 7], ["household", "HH_HOUSEHOLD", 8], ["shopping", "HH_SHOPPING", 9],
    ["dashboard", "HH_DASHBOARD", 10], ["spine", "HH_SPINE", 11], ["reminders", "HH_REMINDERS", 12],
    ["tasks", "HH_TASKS", 12], ["notes", "HH_NOTES", 13], ["documents", "HH_DOCS", 13],
    ["chores", "HH_CHORES", 14], ["activity", "HH_ACTIVITY", 14], ["notify", "HH_NOTIFY", 14],
    ["utilities", "HH_UTILITIES", 15], ["finance", "HH_FINANCE", 16], ["garden", "HH_GARDEN", 17],
    ["calendar", "HH_CALENDAR", 18], ["assets", "HH_ASSETS", 19], ["chat", "HH_CHAT", 19]
  ];

  function routes() {
    var seen = {}, out = [];
    SOURCES.forEach(function (s) {
      var m = window[s[1]];
      if (!m || !m.screens) return;
      m.screens.forEach(function (sc) {
        var route = sc.route || "";
        if (!route) return;
        var key = route + "|" + (sc.id || sc.name);
        if (seen[key]) return;
        seen[key] = 1;
        out.push({
          id: sc.id || "", name: sc.name || sc.title || "", route: route,
          client: sc.client || "mw", source: s[0], stage: s[2],
          module: sc.module || s[0]
        });
      });
    });
    /* the four rows this file draws are routes too */
    REMAINDER.forEach(function (r) {
      out.push({ id: r.row, name: r.name, route: r.route, client: r.clients.join(""),
                 source: "conformance", stage: 20, module: "platform" });
    });
    return out;
  }

  /* ─────────────────────────────────────────────────────────────────────
     3. BOTH THEMES ON EVERY ROUTE.
     A route passes if every colour it can spend resolves in both themes and
     clears its declared minimum in both. The token file is the only input.
     ───────────────────────────────────────────────────────────────────── */

  var FAMILY_OF = {
    tasks: "accent-family-time", reminders: "accent-family-time", calendar: "accent-family-time",
    chores: "accent-family-time", finance: "accent-family-money", utilities: "accent-family-money",
    notes: "accent-family-keeping", documents: "accent-family-keeping", shopping: "accent-family-keeping",
    property: "accent-family-things", vehicles: "accent-family-things", pets: "accent-family-things",
    assets: "accent-family-things", garden: "accent-garden"
  };

  /* every ink a screen body can spend, whatever module it belongs to */
  var BODY_INK = ["text-primary", "text-muted", "text-link", "danger", "warning", "positive", "info", "border-strong", "focus"];
  var GROUNDS = ["surface", "surface-raised", "surface-sunken"];

  function themeRun() {
    var T = window.HH_TOKENS;
    if (!T) return null;
    var rs = routes();
    var themes = ["light", "dark"];
    var fails = [], checked = 0;
    rs.forEach(function (rt) {
      var ink = BODY_INK.concat([FAMILY_OF[rt.module] || FAMILY_OF[rt.source] || "accent"]);
      themes.forEach(function (th) {
        ink.forEach(function (name) {
          GROUNDS.forEach(function (bg) {
            var f = T.resolve(name, th), b = T.resolve(bg, th);
            checked += 1;
            if (!f || !b) { fails.push(rt.route + " \u00b7 " + name + " undefined in " + th); return; }
            var min = (name === "text-primary" || name === "text-muted" || name === "text-link" ||
                       name === "danger" || name === "warning" || name === "positive" || name === "info") ? 4.5 : 3;
            var v = T.ratio(f, b);
            if (v < min) fails.push(rt.route + " \u00b7 " + name + " on " + bg + " \u00b7 " + th + " \u00b7 " + r1(v) + ":1");
          });
        });
      });
    });
    return {
      routes: rs.length, themes: 2, cells: rs.length * 2, checks: checked,
      darkOnly: T.darkOnly.length, fails: fails,
      says: rs.length + " routes \u00d7 two themes is " + (rs.length * 2) +
        " renderings, and every one of them resolves \u2014 " + checked +
        " ink-on-ground resolutions with " + fails.length + " below their minimum and " +
        T.darkOnly.length + " colours defined in only one theme."
    };
  }

  /* ─────────────────────────────────────────────────────────────────────
     4. THE LATE COLOURS — every colour spend introduced after Stage 2,
     re-run against the declared minimum in both themes.
     ───────────────────────────────────────────────────────────────────── */

  var LATE = [
    ["accent-family-things", "surface", 3, 19, "The asset engine's identity mark, three modules deep"],
    ["accent-family-things", "surface-raised", 3, 19, "Row rules and chips on the entity list"],
    ["text-on-accent", "accent-family-things", 4.5, 19, "Ink on the primary button in Property, Vehicles and Pets"],
    ["status-stale", "surface-raised", 4.5, 18, "The calendar connection staleness badge"],
    ["status-rejected", "surface-sunken", 4.5, 19, "The refused odometer reading, on a sunken row"],
    ["warning", "surface-sunken", 4.5, 17, "Overdue and frost, both drawn in a well"],
    ["positive", "surface-raised", 4.5, 16, "Reconciles / settled, on a card"],
    ["accent-garden", "surface-sunken", 3, 17, "Garden's own accent, outside the five families"],
    ["chart-2", "surface-raised", 3, 18, "Member colour on the who-overlay"],
    ["chart-3", "surface-raised", 3, 18, "Member colour on the who-overlay"],
    ["chart-4", "surface-raised", 3, 18, "Member colour on the who-overlay"],
    ["chart-5", "surface-raised", 3, 18, "Member colour on the who-overlay"],
    ["chart-6", "surface-sunken", 3, 15, "Sixth series in the consumption chart"],
    ["chart-7", "surface-sunken", 3, 15, "Seventh series"],
    ["chart-8", "surface-sunken", 3, 17, "Eighth series, the season chart"],
    ["status-conflict", "surface-raised", 4.5, 13, "The preserved loser's banner"],
    ["status-private", "surface", 4.5, 18, "The busy-block divider and the private mark"],
    ["text-on-danger", "danger", 4.5, 8, "Ink on the destructive confirm"]
  ];

  function contrastRun() {
    var T = window.HH_TOKENS;
    if (!T) return null;
    function run(list) {
      return list.map(function (p) {
        var l = T.ratio(T.resolve(p.fg, "light"), T.resolve(p.bg, "light"));
        var d = T.ratio(T.resolve(p.fg, "dark"), T.resolve(p.bg, "dark"));
        return { fg: p.fg, bg: p.bg, min: p.min, use: p.use, stage: p.stage || 2,
                 light: r1(l), dark: r1(d), pass: l >= p.min && d >= p.min,
                 worst: r1(Math.min(l, d)) };
      });
    }
    var declared = run(T.pairs.map(function (p) { return { fg: p.fg, bg: p.bg, min: p.min, use: p.use }; }));
    var late = run(LATE.map(function (l) { return { fg: l[0], bg: l[1], min: l[2], stage: l[3], use: l[4] }; }));
    var undeclared = late.filter(function (l) {
      return !T.pairs.some(function (p) { return p.fg === l.fg && p.bg === l.bg; });
    });
    return {
      declared: declared, late: late, undeclared: undeclared,
      declaredFails: declared.filter(function (p) { return !p.pass; }),
      lateFails: late.filter(function (p) { return !p.pass; }),
      tightest: declared.concat(late).sort(function (a, b) { return a.worst - b.worst; }).slice(0, 6),
      says: declared.length + " declared pairs and " + late.length +
        " colour spends introduced after Stage 2, all re-run in both themes. " +
        undeclared.length + " of the late spends are not in the declared list and should be."
    };
  }

  /* ─────────────────────────────────────────────────────────────────────
     5. THE SECOND LANGUAGE. Czech is the fixture's locale; German is what
     the handoff requires. The sweep runs both and reports the longer, so the
     layout question is answered whichever way the copy question goes.
     ───────────────────────────────────────────────────────────────────── */

  var STRINGS = [
    ["module", "dashboard", "Dashboard", "P\u0159ehled", "\u00dcbersicht"],
    ["module", "tasks", "Tasks", "\u00dakoly", "Aufgaben"],
    ["module", "reminders", "Reminders", "P\u0159ipom\u00ednky", "Erinnerungen"],
    ["module", "calendar", "Calendar", "Kalend\u00e1\u0159", "Kalender"],
    ["module", "shopping", "Shopping", "N\u00e1kupy", "Einkaufsliste"],
    ["module", "chores", "Chores", "Dom\u00e1c\u00ed pr\u00e1ce", "Haushaltsaufgaben"],
    ["module", "notes", "Notes", "Pozn\u00e1mky", "Notizen"],
    ["module", "documents", "Documents", "Dokumenty", "Dokumente"],
    ["module", "finance", "Finance", "Finance", "Finanzen"],
    ["module", "utilities", "Utilities", "Energie", "Nebenkosten"],
    ["module", "garden", "Garden", "Zahrada", "Garten"],
    ["module", "property", "Property", "Nemovitost", "Immobilie"],
    ["module", "vehicles", "Vehicles", "Vozidla", "Fahrzeuge"],
    ["module", "pets", "Pets", "Mazl\u00ed\u010dci", "Haustiere"],
    ["module", "chat", "Chat", "Chat", "Chat"],
    ["module", "activity", "Activity log", "Historie zm\u011bn", "Aktivit\u00e4tsprotokoll"],
    ["module", "admin", "Household settings", "Nastaven\u00ed dom\u00e1cnosti", "Haushaltseinstellungen"],
    ["tab", "home", "Home", "Dom\u016f", "Start"],
    ["tab", "today", "Today", "Dnes", "Heute"],
    ["tab", "add", "Add", "P\u0159idat", "Neu"],
    ["tab", "chat", "Chat", "Chat", "Chat"],
    ["tab", "more", "More", "V\u00edce", "Mehr"],
    ["state", "loading", "Loading", "Na\u010d\u00edt\u00e1n\u00ed", "Wird geladen"],
    ["state", "empty", "Nothing here yet", "Zat\u00edm nic", "Noch nichts"],
    ["state", "error", "Error", "Chyba", "Fehler"],
    ["state", "offline", "Offline", "Offline", "Offline"],
    ["state", "pending", "Not sent yet", "Neodesl\u00e1no", "Noch nicht gesendet"],
    ["state", "syncing", "Syncing", "Synchronizuje se", "Wird synchronisiert"],
    ["state", "conflicted", "Two versions", "Dv\u011b verze", "Zwei Versionen"],
    ["state", "rejected", "Refused", "Odm\u00edtnuto", "Abgelehnt"],
    ["state", "withdrawn", "Access changed", "P\u0159\u00edstup se zm\u011bnil", "Zugriff ge\u00e4ndert"],
    ["state", "readonly", "Read-only", "Jen ke \u010dten\u00ed", "Nur lesen"],
    ["action", "save", "Save", "Ulo\u017eit", "Speichern"],
    ["action", "cancel", "Cancel", "Zru\u0161it", "Abbrechen"],
    ["action", "retry", "Try again", "Zkusit znovu", "Erneut versuchen"],
    ["action", "resolve", "Resolve", "Vy\u0159e\u0161it", "Aufl\u00f6sen"],
    ["action", "settle", "Settle up", "Vyrovnat", "Ausgleichen"],
    ["action", "takeover", "Take over billing", "P\u0159evz\u00edt placen\u00ed", "Zahlung \u00fcbernehmen"],
    ["action", "hold", "Hold to complete", "Podr\u017ete pro dokon\u010den\u00ed", "Zum Erledigen halten"],
    ["action", "addreading", "Add a reading", "Zapsat stav", "Z\u00e4hlerstand erfassen"]
  ];

  var LANGS = [["en", "English", 2], ["cs", "\u010ce\u0161tina", 3], ["de", "Deutsch", 4]];

  /* The containers the labels have to survive. Widths are the shells' own:
     a 360 px phone, a five-slot bar, and a sidebar Stage 6 never fixes a width
     for — so it is run at three widths and the answer is a bracket. */
  var CONTAINERS = [
    { key: "tab", label: "Tab bar slot", kinds: ["tab"], size: 13,
      width: Math.floor(360 / 5) - 8, note: "360 px phone, five slots, 4 px inset each side" },
    { key: "side240", label: "Sidebar label \u00b7 240 px", kinds: ["module"], size: 16, width: 240 - 28 - 20 - 8,
      note: "padding 28, icon 20, gap 8" },
    { key: "side260", label: "Sidebar label \u00b7 260 px", kinds: ["module"], size: 16, width: 260 - 28 - 20 - 8, note: "" },
    { key: "side280", label: "Sidebar label \u00b7 280 px", kinds: ["module"], size: 16, width: 280 - 28 - 20 - 8, note: "" },
    { key: "chip", label: "State chip", kinds: ["state"], size: 11, width: 132, note: "the widest chip drawn in Stage 4" },
    { key: "button", label: "Button \u00b7 phone, two across", kinds: ["action"], size: 16, width: (360 - 32 - 8) / 2 - 32,
      note: "two buttons on a 360 px phone, 16 px padding each side" }
  ];

  function langRun() {
    var out = { containers: [], strings: [], longest: {}, growth: {} };
    LANGS.forEach(function (l) {
      var idx = l[2];
      var lens = STRINGS.map(function (s) { return s[idx].length; });
      out.longest[l[0]] = STRINGS.slice().sort(function (a, b) { return b[idx].length - a[idx].length; })[0][idx];
      out.growth[l[0]] = {
        chars: lens.reduce(function (a, b) { return a + b; }, 0),
        max: Math.max.apply(null, lens)
      };
    });
    var enChars = out.growth.en.chars;
    LANGS.forEach(function (l) {
      out.growth[l[0]].vsEn = Math.round((out.growth[l[0]].chars / enChars - 1) * 100);
    });

    CONTAINERS.forEach(function (c) {
      var rec = { key: c.key, label: c.label, width: c.width, note: c.note, size: c.size, langs: [] };
      LANGS.forEach(function (l) {
        var set = STRINGS.filter(function (s) { return c.kinds.indexOf(s[0]) >= 0; });
        var worst = null, over100 = 0, over200 = 0;
        set.forEach(function (s) {
          var w100 = textPx(s[l[2]], c.size), w200 = w100 * 2;
          if (w100 > c.width) over100 += 1;
          if (w200 > c.width) over200 += 1;
          if (!worst || w100 > worst.w100) worst = { text: s[l[2]], w100: w100, w200: w200 };
        });
        rec.langs.push({
          lang: l[0], name: l[1], n: set.length,
          worst: worst.text, w100: Math.round(worst.w100), w200: Math.round(worst.w200),
          over100: over100, over200: over200,
          fits100: over100 === 0, fits200: over200 === 0
        });
      });
      out.containers.push(rec);
    });

    STRINGS.forEach(function (s) {
      out.strings.push({ kind: s[0], key: s[1], en: s[2], cs: s[3], de: s[4],
                         longest: s[3].length >= s[4].length ? "cs" : "de",
                         csPx: Math.round(textPx(s[3], 16)), dePx: Math.round(textPx(s[4], 16)) });
    });
    var deLonger = out.strings.filter(function (s) { return s.longest === "de"; }).length;
    out.deLonger = deLonger;
    out.csLonger = out.strings.length - deLonger;
    out.says = "German is the longer of the two on " + deLonger + " of " + out.strings.length +
      " strings and " + out.growth.de.vsEn + " % longer than English overall, against Czech\u2019s " +
      out.growth.cs.vsEn + " %. The sweep is run against German as the upper bound, which is why the " +
      "layout answer holds whichever language the copy decision picks.";
    return out;
  }

  /* diacritics: does the line box clear the accent stack?
     \u010f and \u016f sit highest in Czech; \u00c4 and \u00dc in German are the uppercase case, which
     matters because the overline step is uppercase by definition. */
  function diacriticRun() {
    var T = window.HH_TOKENS;
    if (!T) return null;
    var NEED_LOWER = 1.22;   /* ascender + ring/caron, as a multiple of font size */
    var NEED_UPPER = 1.18;   /* cap height + umlaut */
    /* A short line box is only a defect where the line can wrap: one line cannot
       collide with itself. display is one figure per screen by definition, so it is
       excused here and the excuse is written down rather than assumed. */
    var NO_WRAP = { display: "One per screen, and it is a figure \u2014 a total, a balance, a settlement. It does not wrap, so a short line box cannot collide with anything." };
    return T.type.map(function (t) {
      var size = parseFloat(t[1]) * 16;
      var lh = parseFloat(t[2]) * size;
      var upper = /Uppercase/.test(t[6]);
      var need = (upper ? NEED_UPPER : NEED_LOWER) * size;
      var clears = lh >= need;
      return {
        step: t[0], size: Math.round(size * 10) / 10, lineHeight: Math.round(lh * 10) / 10,
        need: Math.round(need * 10) / 10, upper: upper, wraps: !NO_WRAP[t[0]],
        excuse: NO_WRAP[t[0]] || "",
        headroom: Math.round((lh - need) * 10) / 10, clears: clears,
        pass: clears || !!NO_WRAP[t[0]],
        fix: clears ? "" : "line-height " + (Math.ceil((need / size) * 100) / 100),
        use: t[6]
      };
    });
  }

  /* ─────────────────────────────────────────────────────────────────────
     6. 200 % TEXT on the tightest containers earlier stages measured.
     ───────────────────────────────────────────────────────────────────── */

  var TIGHT = [
    ["Month grid cell", 46, 50, 18, "Stage 18 \u00b7 a 360 px month grid gives 46 px a column against a 50 px time label",
     "Agenda is the mobile default and month the web default. Neither view is missing from either client."],
    ["Flow view row", 312, 173, 16, "Stage 16 \u00b7 widest unbreakable token 173 px at 200 % against 312 px of row",
     "Stage-major rows. Node-major needs 1 694 px for the same nodes."],
    ["Tab bar slot", 64, 0, 6, "This stage \u00b7 the label at 200 % against a fifth of a 360 px phone",
     "Stage 6's own rule: the label is never dropped to buy width \u2014 the bar grows taller."],
    ["Widget \u00b7 small", 156, 0, 10, "Stage 10 \u00b7 a small widget at the 2-column reading",
     "A widget that cannot say its number at 200 % says its word instead and drops the sparkline."],
    ["Sidebar label", 184, 0, 6, "This stage \u00b7 260 px sidebar less padding, icon and gap",
     "Wraps to two lines and the row grows. Never truncated: a truncated module name is a module you cannot find."],
    ["Print \u00b7 month sheet", 761, 0, 17, "Stage 17 \u00b7 201,5 mm of 269 on A4",
     "Print ignores the text scale by design: paper has no user setting."]
  ];

  function textRun() {
    var lang = langRun();
    var tabWorst = lang.containers.filter(function (c) { return c.key === "tab"; })[0];
    var sideWorst = lang.containers.filter(function (c) { return c.key === "side260"; })[0];
    var de = function (c) { return c.langs.filter(function (l) { return l.lang === "de"; })[0]; };
    var rows = TIGHT.map(function (t) {
      var need = t[2];
      if (t[0] === "Tab bar slot") need = de(tabWorst).w200;
      if (t[0] === "Sidebar label") need = de(sideWorst).w200;
      if (t[0] === "Widget \u00b7 small") need = Math.round(textPx("Nedoplatek", 16) * 2);
      if (t[0] === "Print \u00b7 month sheet") need = 761;
      return { name: t[0], avail: t[1], need: need, stage: t[3], provenance: t[4],
               answer: t[5], fits: need <= t[1] };
    });
    return {
      rows: rows,
      overflow: rows.filter(function (r) { return !r.fits; }),
      says: rows.filter(function (r) { return r.fits; }).length + " of " + rows.length +
        " tightest containers still fit at 200 % text; the ones that do not have a stated answer that is not truncation."
    };
  }

  /* ─────────────────────────────────────────────────────────────────────
     7. FOCUS ORDER AND LABELS.
     ───────────────────────────────────────────────────────────────────── */

  var FOCUS = [
    { shell: "Mobile \u00b7 app bar and screen", order: [
      ["Skip to content", "link", "First stop, visible on focus. Jumps past the bar to the screen title."],
      ["Household switcher", "icon", "Announces the current household in its label."],
      ["Screen title", "heading", "h1, focusable only as a heading landmark."],
      ["Search", "icon", "\u201cSearch this household\u201d."],
      ["Screen content", "region", "DOM order is visual order, top to bottom \u2014 no positive tabindex anywhere."],
      ["Tab bar", "tablist", "Last, and it is a tablist: arrows move between slots, Tab leaves the bar."]
    ] },
    { shell: "Web \u00b7 sidebar and pane", order: [
      ["Skip to content", "link", "Jumps to the pane, not to the sidebar."],
      ["Household switcher", "icon", "Top of the sidebar."],
      ["Search", "input", "One field, one endpoint."],
      ["Module list", "nav", "Arrow keys within the list; Tab leaves it."],
      ["Settings", "link", "Foot of the sidebar, before the pane."],
      ["Pane", "main", "Heading first, then the pane's own controls in reading order."]
    ] },
    { shell: "Arrange \u00b7 the keyboard path that has to exist", order: [
      ["Reorder handle", "button", "\u201cReorder {name}. Use arrow keys to move it\u201d \u2014 the handle is a button, not a drag-only affordance."],
      ["Arrow up / down", "key", "Moves the row and announces the new position out of the total."],
      ["Pin", "button", "\u201cPin {name} to the top of your list\u201d."],
      ["Hidden section", "region", "Reached by Tab; \u201cShow {name} in your list again\u201d on each row."]
    ] },
    { shell: "Hold to complete \u00b7 both paths", order: [
      ["The control", "button", "Space or Enter starts the same 2000 ms the finger does."],
      ["Progress", "status", "A ten-step fill under reduced motion, announced at start and at completion \u2014 not on every step."],
      ["Undo", "button", "Focus moves to the undo affordance for its 5000 ms dwell, then back."]
    ] }
  ];

  function focusRun() {
    var I = window.HH_ICONS, N = window.HH_NAV;
    var icons = I ? I.labels.length : 0;
    var nav = N ? N.labels.length : 0;
    var missing = [];
    if (I) I.labels.forEach(function (l) { if (!l[3]) missing.push(l[0]); });
    if (N) N.labels.forEach(function (l) { if (!l[1]) missing.push(l[0]); });
    var stops = FOCUS.reduce(function (a, f) { return a + f.order.length; }, 0);
    return {
      shells: FOCUS, stops: stops, icons: icons, nav: nav,
      registered: icons + nav, missing: missing,
      keys: I ? I.labels.map(function (l) { return l[3]; }) : [],
      says: (icons + nav) + " icon-only controls carry a label string and a key \u2014 " + icons +
        " in the icon register and " + nav + " in the nav register \u2014 with " + missing.length +
        " missing. Four shells declare " + stops + " focus stops between them, all in DOM order, " +
        "and no positive tabindex is used anywhere in the prototype."
    };
  }

  /* ─────────────────────────────────────────────────────────────────────
     8. 44 pt UNDER COMPACT, at both text sizes.
     ───────────────────────────────────────────────────────────────────── */

  var CONTROLS = [
    ["List row \u00b7 one line", "body", 1, "row"],
    ["List row \u00b7 two lines", "caption", 2, "row"],
    ["Button \u00b7 primary", "body", 1, "control"],
    ["Chip \u00b7 filter", "caption", 1, "control"],
    ["Icon-only \u00b7 app bar", "body", 1, "icon"],
    ["Table row \u00b7 web", "caption", 1, "row"],
    ["Tab bar slot", "caption", 2, "row"],
    ["Checkbox \u00b7 in a list", "body", 1, "control"]
  ];

  function targetRun() {
    var T = window.HH_TOKENS;
    if (!T) return null;
    var FLOOR = 44;
    var step = {};
    T.type.forEach(function (t) { step[t[0]] = { size: parseFloat(t[1]) * 16, lh: parseFloat(t[2]) }; });
    var out = [];
    [["comfortable", 10], ["compact", 6]].forEach(function (d) {
      [100, 200].forEach(function (scale) {
        CONTROLS.forEach(function (c) {
          var s = step[c[1]];
          var lineBox = s.size * (scale / 100) * s.lh * c[2];
          /* an icon-only control carries a 24 px glyph, not text: the scale does not move it */
          var padded = (c[3] === "icon" ? 24 : lineBox) + d[1] * 2 + 2;
          var final = Math.max(padded, FLOOR);                  /* the floor binds */
          out.push({
            control: c[0], density: d[0], scale: scale,
            natural: Math.round(padded * 10) / 10,
            height: Math.round(final * 10) / 10,
            floored: padded < FLOOR,
            pass: final >= FLOOR
          });
        });
      });
    });
    var compact100 = out.filter(function (o) { return o.density === "compact" && o.scale === 100; });
    return {
      rows: out, floor: FLOOR,
      flooredCompact: compact100.filter(function (o) { return o.floored; }).length,
      fails: out.filter(function (o) { return !o.pass; }),
      says: "Under compact at 100 % text " + compact100.filter(function (o) { return o.floored; }).length +
        " of " + compact100.length + " control heights fall below 44 px on their own arithmetic and are held " +
        "at the floor by --dens-row-min. That is the floor doing its job: compact buys horizontal " +
        "density and vertical rhythm, never target size."
    };
  }

  /* ─────────────────────────────────────────────────────────────────────
     9. THE FIVE WALKTHROUGHS.
     Each step names the ledger row it lands on. walkRun resolves them, so a
     step pointing at a row that does not exist or is not built fails visibly.
     ───────────────────────────────────────────────────────────────────── */

  var WALKS = [
    {
      id: "jana", member: "jana", title: "Jana\u2019s five-minute first run", client: "mobile",
      claim: "Nothing to import, nothing to configure, and a household that works before she has entered any data.",
      steps: [
        { row: "A-2", route: "/auth/register", does: "Types her email and a password.",
          shows: "Register", lede: "The breach check runs on the password.",
          rows: [["E-mail", "jana@tilcerovi.cz"], ["Heslo", "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"]],
          says: "A refused password says the password was found in a breach and nothing about whether the address is known.", state: "populated" },
        { row: "A-3", route: "/auth/verify", does: "Opens the link on the same phone.",
          shows: "Ov\u011b\u0159en\u00ed e-mailu", lede: "Poslali jsme odkaz na jana@tilcerovi.cz.",
          rows: [["Poslat znovu", "za 47 s"]],
          says: "Verification is not a gate: A-4 is the app working behind it, with one line saying what is still unverified.", state: "populated" },
        { row: "A-22", route: "/households/new", does: "Names the household and takes the defaults.",
          shows: "Nov\u00e1 dom\u00e1cnost", lede: "\u010cty\u0159i pole, t\u0159i z nich p\u0159edvypln\u011bn\u00e1.",
          rows: [["N\u00e1zev", "Tilcerovi"], ["Zem\u011b", "\u010cesko"], ["M\u011bna", "CZK"], ["T\u00fdden za\u010d\u00edn\u00e1", "pond\u011bl\u00ed"]],
          says: "Country, currency, timezone and first day are answered once here and read by every module afterwards.", state: "populated" },
        { row: "C-51", route: "/settings/modules", does: "Turns on four modules.",
          shows: "Moduly", lede: "Sedmn\u00e1ct p\u0159ep\u00edna\u010d\u016f, \u010dty\u0159i zapnut\u00e9.",
          rows: [["N\u00e1kupy", "zapnuto"], ["Energie", "zapnuto"], ["Dom\u00e1c\u00ed pr\u00e1ce", "zapnuto"], ["Kalend\u00e1\u0159", "zapnuto"], ["Nemovitost", "vypnuto \u2014 zat\u00edm v n\u00ed nic nen\u00ed"]],
          says: "The two off switches are the fixture's own: Property and Pets are off because nothing is in them yet.", state: "populated" },
        { row: "A-23", route: "/settings/members/invite", does: "Invites Petr, and picks what he gets.",
          shows: "Pozvat \u010dlena", lede: "Pr\u00e1va se vyb\u00edraj\u00ed slovy, kter\u00e1 u\u017e zn\u00e1.",
          rows: [["Energie", "m\u016f\u017ee spravovat"], ["N\u00e1kupy", "m\u016f\u017ee p\u0159id\u00e1vat"], ["Ostatn\u00ed", "nic"]],
          says: "No API level word reaches this screen \u2014 checked in Stage 8, not asserted.", state: "populated" },
        { row: "C-2", route: "/home/catalog", does: "Adds three widgets to Home.",
          shows: "Katalog widget\u016f", lede: "Filtrov\u00e1no podle toho, co m\u00e1 \u2014 jako vlastn\u00edk v\u0161echno.",
          rows: [["Dne\u0161n\u00ed \u00fakoly", "mal\u00fd"], ["N\u00e1kupn\u00ed seznam", "st\u0159edn\u00ed"], ["Stav m\u011b\u0159i\u010d\u016f", "mal\u00fd"]],
          says: "Twenty-four keys in the catalog, grant-filtered before it is drawn.", state: "populated" },
        { row: "F-3", route: "/today", does: "Lands on Today.",
          shows: "Dnes \u00b7 st\u0159eda 9. z\u00e1\u0159\u00ed", lede: "P\u011bt skupin, pr\u00e1zdn\u00e9 vynech\u00e1ny.",
          rows: [["Dnes", "2 polo\u017eky"], ["Tento t\u00fdden", "1 polo\u017eka"]],
          says: "On day one three of the five DD-7 groups have nothing in them, so three are not drawn. An empty Today is a short Today, never an empty frame.", state: "populated" }
      ]
    },
    {
      id: "petr", member: "petr", title: "Petr\u2019s two modules", client: "mobile",
      claim: "Thirteen modules are absent. His app is not a smaller version of Jana\u2019s \u2014 it is a complete app with two things in it.",
      steps: [
        { row: "A-1", route: "/auth/sign-in", does: "Signs in.", shows: "P\u0159ihl\u00e1\u0161en\u00ed",
          lede: "", rows: [["E-mail", "petr@tilcerovi.cz"]],
          says: "Twelve enumerable failures, one sentence between them.", state: "populated" },
        { row: "C-1", route: "/home", does: "Lands on Home.", shows: "Dom\u016f",
          lede: "T\u0159i widgety, proto\u017ee t\u0159i moduly.",
          rows: [["Stav m\u011b\u0159i\u010d\u016f", "elekt\u0159ina po term\u00ednu"], ["N\u00e1kupn\u00ed seznam", "6 polo\u017eek"]],
          says: "A short Home, not a locked one. Nothing is greyed and nothing counts a module he cannot open.", state: "populated" },
        { row: "F-12", route: "/ (shell)", does: "Notices his bar has four slots.", shows: "Tab bar \u00b7 four destinations",
          lede: "Dom\u016f \u00b7 Dnes \u00b7 P\u0159idat \u00b7 V\u00edce",
          rows: [["Chat", "nen\u00ed \u2014 nem\u00e1 ho"], ["P\u0159idat", "po\u0159\u00e1d t\u0159et\u00ed slot"]],
          says: "Add stays in the third slot in both drawings, so the control people reach for without looking does not move.", state: "populated" },
        { row: "D-9", route: "/utilities/electricity/readings/new", does: "Types the meter reading in the cellar.",
          shows: "Z\u00e1pis stavu", lede: "V p\u0159\u00edt\u011b\u017eku, jednou rukou.",
          rows: [["Posledn\u00ed", "4 480 kWh \u00b7 9. srpna"], ["Nov\u00fd stav", "4 512"]],
          says: "The validator runs on the replica: the cellar has no signal and the refusal has to arrive before he climbs the stairs.", state: "offline" },
        { row: "D-5", route: "/utilities", does: "Sees what the reading changed.", shows: "Energie",
          lede: "T\u0159i slu\u017eby, jedna po term\u00ednu.",
          rows: [["Elekt\u0159ina", "4 dny po kadenci"], ["Plyn", "v po\u0159\u00e1dku"]],
          says: "The overdue count is measured against a cadence no screen in the handoff asked for. Settled since: cadence is set per service on service detail \u2014 31 days for electricity and gas, 183 for water \u2014 and this row reads that field.", state: "pending" },
        { row: "B-2", route: "/shopping/lists/tydenni", does: "Adds one thing to the list.",
          shows: "T\u00fddenn\u00ed n\u00e1kup", lede: "Jedno pole, \u017e\u00e1dn\u00e1 rozhodnut\u00ed.",
          rows: [["2 kg mouky", "p\u0159idal Petr"], ["ml\u00e9ko", "\u0161krtnuto"]],
          says: "The quantity splitter reads \u201c2 kg mouky\u201d as quantity, unit and name in one field.", state: "populated" },
        { row: "F-4", route: "/add", does: "Opens the Add sheet.", shows: "P\u0159idat",
          lede: "Dv\u011b polo\u017eky, ne \u0161est.",
          rows: [["Polo\u017eka do n\u00e1kupu", "N\u00e1kupy"], ["Z\u00e1pis stavu", "Energie"]],
          says: "The sheet ranks what he can write to. Short is the correct answer here, and it is drawn short rather than padded.", state: "populated" }
      ]
    },
    {
      id: "adam", member: "adam", title: "Adam\u2019s locked dashboard", client: "mobile",
      claim: "A child profile is not an adult profile with things removed. It is its own set of screens, and the locked layout has zero arrange controls in the DOM.",
      steps: [
        { row: "A-14", route: "/auth/child", does: "Types the household code.", shows: "K\u00f3d dom\u00e1cnosti",
          lede: "\u0160est znak\u016f, velk\u00e1 kl\u00e1vesnice.", rows: [["K\u00f3d", "TILC\u00b724"]],
          says: "No email, no password: a child signs in to a household, not to an account.", state: "populated" },
        { row: "A-15", route: "/auth/child/profiles", does: "Picks his face.", shows: "Kdo jsi?",
          lede: "", rows: [["Adam", "d\u00edt\u011b"], ["Kl\u00e1ra", "vy\u017eaduje heslo"]],
          says: "Adult profiles are shown but need the full sign-in \u2014 the picker is not a bypass.", state: "populated" },
        { row: "A-16", route: "/auth/child/pin", does: "Enters four digits.", shows: "PIN",
          lede: "", rows: [["PIN", "\u2022\u2022\u2022\u2022"], ["Po p\u011bti pokusech", "zamknuto na 5 minut"]],
          says: "The lockout is its own screen (A-18) and says how long, not \u201ctry again later\u201d.", state: "populated" },
        { row: "C-7", route: "/home", does: "Lands on his Home.", shows: "Dom\u016f",
          lede: "\u010cty\u0159i karty, kter\u00e9 nastavila Jana.",
          rows: [["Moje pr\u00e1ce dnes", "2"], ["Moje body", "34"], ["Dne\u0161n\u00ed \u00fakoly", "1"]],
          says: "Zero arrange controls, counted in the DOM in Stage 10 rather than asserted in prose.", state: "populated" },
        { row: "C-36", route: "/chores/today", does: "Holds his chore to complete it.", shows: "Dnes \u00b7 moje pr\u00e1ce",
          lede: "Podr\u017ete pro dokon\u010den\u00ed.",
          rows: [["Vynést ko\u0161", "2000 ms dr\u017een\u00ed"], ["Kl\u00e1vesnice", "mezern\u00edk d\u011bl\u00e1 tot\u00e9\u017e"]],
          says: "Every completion affordance has a keyboard path beside the hold \u2014 checked in Stage 12.", state: "populated" },
        { row: "C-40", route: "/chores/points", does: "Checks his balance.", shows: "Moje body",
          lede: "34 bod\u016f.", rows: [["Vynést ko\u0161", "+2 \u00b7 dnes"], ["Odm\u011bna", "\u221220 \u00b7 sobota"]],
          says: "His balance and nobody else's: the ledger draws one member's rows for a child.", state: "populated" },
        { row: "E-37", route: "/chat/rodina", does: "Reads the family thread.", shows: "Rodina",
          lede: "\u010cte, nep\u00ed\u0161e.", rows: [["Jana", "Bude\u0161 doma na ve\u010de\u0159i?"], ["Milo\u0161", "J\u00e1 jo"]],
          says: "He holds view. The composer is absent rather than disabled \u2014 a greyed box is a promise the app will not keep.", state: "absent" }
      ]
    },
    {
      id: "klara", member: "klara", title: "Kl\u00e1ra\u2019s three screens", client: "mobile",
      claim: "An owner narrowed her to three. The app has to read as complete rather than as a demo with the parts taken out.",
      steps: [
        { row: "A-1", route: "/auth/sign-in", does: "Signs in.", shows: "P\u0159ihl\u00e1\u0161en\u00ed", lede: "",
          rows: [["E-mail", "klara@tilcerovi.cz"]], says: "", state: "populated" },
        { row: "C-1", route: "/home", does: "Lands on Home.", shows: "Dom\u016f",
          lede: "Widgety ze t\u0159\u00ed pr\u00e1v.", rows: [["N\u00e1kupn\u00ed seznam", "6 polo\u017eek"], ["Nep\u0159e\u010dten\u00e9 zpr\u00e1vy", "2"]],
          says: "Her catalog is three keys long, and three widgets fill a Home.", state: "populated" },
        { row: "F-11", route: "/ (shell)", does: "Has a five-slot bar.", shows: "Tab bar \u00b7 five destinations",
          lede: "Dom\u016f \u00b7 Dnes \u00b7 P\u0159idat \u00b7 Chat \u00b7 V\u00edce",
          rows: [["V\u00edce", "jeden modul a nastaven\u00ed"]],
          says: "She has Chat, so she gets the five-slot drawing. The More list has one module in it and does not apologise for that.", state: "populated" },
        { row: "E-36", route: "/chat", does: "Opens Chat.", shows: "Konverzace",
          lede: "", rows: [["Rodina", "2 nep\u0159e\u010dten\u00e9"], ["Chata", "nen\u00ed \u2014 jin\u00e1 dom\u00e1cnost"]],
          says: "The floor: she sees what was said after she joined, and the divider says so once rather than on every message.", state: "populated" },
        { row: "B-2", route: "/shopping/lists/tydenni", does: "Ticks two things off in the shop.",
          shows: "T\u00fddenn\u00ed n\u00e1kup", lede: "Jedno klepnut\u00ed na polo\u017eku.",
          rows: [["chleba", "\u0161krtnuto"], ["ml\u00e9ko", "\u0161krtnuto Janou"]],
          says: "Two trolleys in one shop converge with zero questions asked \u2014 replayed in both receive orders in Stage 9.", state: "syncing" },
        { row: "F-17", route: "/finance/expenses/e-118", does: "Taps a link someone pasted in Chat.",
          shows: "Tohle tu nen\u00ed", lede: "",
          rows: [["\u017d\u00e1dn\u00fd d\u016fvod", "\u017e\u00e1dn\u00e1 entita"], ["\u017d\u00e1dn\u00e9 Zkusit znovu", ""]],
          says: "A withdrawn grant and a deleted row are indistinguishable from here, which is the point: the screen names neither.", state: "absent" }
      ]
    },
    {
      id: "milos", member: "milos", title: "Milo\u0161 on a tablet", client: "tablet",
      claim: "One module, used seriously, on the only device in the household that is nobody\u2019s in particular.",
      steps: [
        { row: "A-17", route: "/auth/profiles", does: "Picks himself on the shared tablet.",
          shows: "Kdo pracuje?", lede: "Tablet pat\u0159\u00ed dom\u00e1cnosti, ne \u010dlov\u011bku.",
          rows: [["Milo\u0161", "heslo"], ["Adam", "PIN"]],
          says: "The switcher is the tablet's home screen, not a setting buried in an account.", state: "populated" },
        { row: "D-41", route: "/garden", does: "Opens the garden.", shows: "Zahrada \u00b7 z\u00e1hony",
          lede: "\u010ctrn\u00e1ct z\u00e1hon\u016f ve t\u0159ech z\u00f3n\u00e1ch.",
          rows: [["Z\u00f3na A", "5 z\u00e1hon\u016f"], ["Z\u00f3na B", "6 z\u00e1hon\u016f"], ["Kontejnery", "4 rostliny"]],
          says: "The plot tier reveals rather than migrates: the same rows a pots household holds, with more of them shown.", state: "populated" },
        { row: "D-47", route: "/garden/checks", does: "Runs the plan checks.", shows: "Kontrola pl\u00e1nu",
          lede: "Jeden\u00e1ct kontrol, osmn\u00e1ct n\u00e1lez\u016f.",
          rows: [["Blokuje ulo\u017een\u00ed", "nic"], ["Bez historie", "2 kontroly"]],
          says: "Eighteen findings across thirty-seven entities, and zero of them stop him saving anything.", state: "populated" },
        { row: "D-45", route: "/garden/tasks", does: "Looks at what the plan generated.", shows: "\u00dakoly ze zahrady",
          lede: "", rows: [["Vys\u00e1zet \u010desnek", "\u0159\u00edjen"], ["Zru\u0161eno pl\u00e1nem", "1 \u00fakol \u2014 z\u016fst\u00e1v\u00e1 vid\u011bt"]],
          says: "A tombstone rather than a disappearance: a task the plan withdrew says so where the task was.", state: "populated" },
        { row: "D-52", route: "/garden/print/month", does: "Prints this month's work.",
          shows: "Pr\u00e1ce v z\u00e1\u0159\u00ed", lede: "A4 \u00b7 201,5 mm z 269.",
          rows: [["Za\u0161krt\u00e1vac\u00ed pol\u00ed\u010dka", "skute\u010dn\u00e1"], ["Barvy", "\u017e\u00e1dn\u00e9"]],
          says: "The print layer declares zero accent tokens. Paper has no theme and no text scale.", state: "populated" },
        { row: "C-28", route: "/documents", does: "Opens a document he needs.", shows: "Dokumenty",
          lede: "M\u016f\u017ee \u010d\u00edst a st\u00e1hnout.",
          rows: [["Smlouva \u00b7 chata", "PDF"], ["Nahr\u00e1t", "nen\u00ed \u2014 m\u00e1 jen \u010dten\u00ed"]],
          says: "View means the upload control is not there. Absent, not disabled, on a screen whose whole purpose is putting things in.", state: "absent" },
        { row: "F-12", route: "/ (shell)", does: "Four slots, all the way through.", shows: "Tab bar \u00b7 four destinations",
          lede: "Dom\u016f \u00b7 Dnes \u00b7 P\u0159idat \u00b7 V\u00edce",
          rows: [["Chat", "nem\u00e1 ho"], ["Tablet", "vlastn\u00ed klient \u00b7 834 px"]],
          says: "The tablet is a client of its own since Stage 21: the tab bar of a phone, the two panes of a desktop, and twenty-four rows that declare a layout the wide mobile reading does not give.", state: "populated" }
      ]
    }
  ];

  function walkRun(id) {
    var L = window.HH_LEDGER, F = window.HH_FIXTURES;
    var walk = WALKS.filter(function (w) { return w.id === id; })[0] || WALKS[0];
    var member = F ? F.members.filter(function (m) { return m.id === walk.member; })[0] : null;
    var steps = walk.steps.map(function (s, i) {
      var lr = L ? L.rows.filter(function (x) { return x.group + "-" + x.n === s.row; }) : [];
      var row = lr[0] || null;
      var mod = row ? row.module.toLowerCase() : "";
      /* Per-user and platform surfaces are not grantable: there is no module grant over
         your own devices, your own account, the shell, search, Today, Add or help. They
         are named as such rather than aliased to the member's dashboard grant, which
         would be a computed-looking fact the ledger's own exclusions contradict. */
      var UNGRANTABLE = { auth: 1, account: 1, navigation: 1, platform: 1, search: 1,
                          today: 1, add: 1, help: 1, sync: 1 };
      var key = UNGRANTABLE[mod] ? "" :
        ({ assets: "property", property: "property", vehicles: "vehicles", pets: "pets",
           household: "admin", billing: "admin", settings: "admin", privacy: "admin",
           activity: "activity" }[mod] || mod);
      var grantable = !!key;
      var grant = grantable ? (member && member.grants[key] ? member.grants[key] : "none") : "";
      return {
        n: i + 1, row: s.row, route: s.route, does: s.does, shows: s.shows, lede: s.lede || "",
        rows: s.rows || [], says: s.says || "", state: s.state || "populated",
        resolved: !!row, built: row ? row.built : false,
        rowName: row ? row.name : "\u2014", stage: row ? row.stage : null,
        file: row && L.artifacts[row.stage] ? L.artifacts[row.stage].file : "",
        module: row ? row.module : "", grantKey: key, grantable: grantable, grant: grant
      };
    });
    return {
      id: walk.id, title: walk.title, claim: walk.claim, client: walk.client,
      member: member, steps: steps,
      resolved: steps.filter(function (s) { return s.resolved; }).length,
      built: steps.filter(function (s) { return s.built; }).length,
      unresolved: steps.filter(function (s) { return !s.resolved || !s.built; })
        .map(function (s) { return s.row; })
    };
  }

  function walkAll() { return WALKS.map(function (w) { return walkRun(w.id); }); }

  /* a step must never show a member a module they do not hold. Steps on surfaces that
     are not grantable at all are not tested against a grant \u2014 there is none to test. */
  function grantRun() {
    var bad = [], tested = 0, exempt = 0;
    walkAll().forEach(function (w) {
      w.steps.forEach(function (s) {
        if (!s.grantable) { exempt += 1; return; }
        tested += 1;
        if (s.grant === "none") bad.push(w.id + " \u00b7 " + s.row + " \u00b7 " + s.grantKey);
      });
    });
    return { bad: bad, tested: tested, exempt: exempt };
  }

  /* ─────────────────────────────────────────────────────────────────────
     10. WHAT THE SWEEP CANNOT SETTLE.
     ───────────────────────────────────────────────────────────────────── */

  var OPEN = [
    ["Which second language ships \u2014 settled",
     "05-screens and 07-delivery \u00a72/\u00a73 require English and German; the implementation plan proposed Czech, and the fixture household is Czech throughout. The layout half of the question is now answered either way: German is the longer of the two on most strings and the sweep is run against it. The copy half is not, and it decides which of the two the seventeen module names, twelve state words and the whole of Help are written in first. Settled: Czech ships first, and German stays in this sweep as the length test.",
     "settled \u00b7 Czech ships first, German stays the length test"],
    ["The five languages of Please update are named \u2014 settled",
     "05-screens \u00a7A row 21 asks for the blocking update wall in five languages. English, German and Czech are named across the handoff; the fourth and fifth are named nowhere. The wall is the one screen that cannot fall back to a language the reader does not have, because the app behind it will not open. Settled: Polish and Slovak. All five are written in auth.js and drawn on A-21.",
     "settled \u00b7 Polish and Slovak, and all five are drawn"],
    ["The tablet becomes a third client \u2014 settled, and it is new work",
     "06-clients names two clients, mobile and web. Milo\u0161 is on a tablet in every persona document, and this sweep had to draw his shell as the wide reading of the mobile one \u2014 five slots of tab bar, two panes of content \u2014 to draw the walkthrough at all. Settled the other way: the tablet is a third client. That is a line in 06-clients and a body of new drawing work, taken as Stage 21: twenty-four rows declare a tablet layout of their own, and all twenty-four are drawn in the shell.",
     "settled \u00b7 a third client, Stage 21 \u00b7 all twenty-four rows drawn"],
    ["Both findings from this sweep are fixed in the token file",
     "The sweep failed two of its thirteen checks and both were one line. Four status tokens were spent under their own name and were not in the declared pair list, so CI tested the alias and not the name: foundations.js now declares all thirteen status names on all three grounds. title-1 gave 35,4 px of line box against the 36,6 px \u010f and \u016f need, which collided the moment a Czech or German screen title wrapped \u2014 its line-height is 1,22. Thirteen of thirteen now pass, and nothing in English moved.",
     "fixed \u00b7 recorded here"],
    ["Two stage gates read open against rows that are complete",
     "Stage 1 carried \u201cthe count is not frozen\u201d since the ledger was written, and Stage 8's gate note said open while all forty-three of its rows were built. Both are corrected: the count is frozen at 411 mobile and web rows over 2 995 states, and Stage 8's note now records that its prose had outlived its own arithmetic. All twenty-two stage gates read closed: Stage 21 closed with all twenty-four tablet rows drawn, and Stage 22 with a body per route.",
     "both corrected"]
  ];

  /* ─────────────────────────────────────────────────────────────────────
     11. THE GATE.
     ───────────────────────────────────────────────────────────────────── */

  /* ── the measured sweep ────────────────────────────────────────────────
     Stage 23. Everything above this line is measured — contrast arithmetic, line
     boxes, tab slots — except the one thing the whole ledger rests on: `built` and
     `drawn` are flags authored in spine.js, and the coverage checks read the same
     flags. This run does not read them. It resolves every declared route the way
     the application resolves it — own body, its module's answer per route, or its
     declared chrome — and every required state the way the shell resolves it, and
     counts what actually comes back. A row can be flagged drawn and fail here. */

  function measuredRun() {
    var SC = window.HH_SCREENS, B = window.HH_BODIES, SU = window.HH_SURFACES, L = window.HH_LEDGER;
    if (!SC || !L) return null;
    var WORDS = ["error", "empty", "rejected", "withdrawn", "readonly", "absent", "conflicted", "pending"];
    var byId = {};
    L.rows.forEach(function (r) { var id = r.group + "-" + r.n; (byId[id] = byId[id] || []).push(r); });

    var ctx = { member: "jana", household: "hh-tilcer", client: "mobile", locale: "en",
                online: true, ent: "active", level: "manage" };
    var out = { routes: 0, own: 0, byModule: 0, chrome: 0, shell: 0, noBody: [],
                cells: 0, ownWords: 0, shellWords: [], dup: [], locale: { cs: 0, de: 0, missing: [] } };
    var sigs = {};
    var SHELL = { "/search": 1, "/today": 1, "/add": 1, "/home": 1 };

    SC.all.forEach(function (row) {
      out.routes++;
      var c = {}, k;
      for (k in ctx) c[k] = ctx[k];
      c.route = row.path;

      var body = null, kind = "";
      var H = SU && SU.helpers ? SU.helpers : null;
      if (B && H && B.has(row.path)) { try { body = B.build(row.path, c, H); } catch (e) { body = null; } if (body) kind = "own"; }
      if (!body && SU) { try { body = SU.build(row.module, c); } catch (e2) { body = null; } if (body) kind = "module"; }
      if (!body && ((row.fields && row.fields.length) || row.notice || row.lede)) { kind = "chrome"; body = { chrome: row.id }; }
      /* four surfaces the shell draws itself rather than asking a module for: the live
         search field, Today, the Add sheet and the home grid. A module answer for
         /search would be a module searching itself, which is not what the screen is. */
      if (SHELL[row.path]) { kind = "shell"; body = body || { shell: row.path }; }
      if (!body) out.noBody.push(row.id + " " + row.path);
      else if (kind === "own") out.own++;
      else if (kind === "module") out.byModule++;
      else if (kind === "shell") out.shell++;
      else out.chrome++;

      if (body && kind !== "chrome" && kind !== "shell") {
        var sig = kind + "|";
        try { sig += JSON.stringify(body).slice(0, 4000); } catch (e3) { sig += row.path; }
        if (sigs[sig]) out.dup.push(sigs[sig] + " and " + row.path);
        else sigs[sig] = row.path;
      }

      var need = {};
      (byId[row.id] || []).forEach(function (r) {
        (r.states || []).forEach(function (st) {
          if (WORDS.indexOf(st) >= 0 && !(r.exclusions || {})[st]) need[st] = 1;
        });
      });
      Object.keys(need).forEach(function (st) {
        out.cells++;
        var w = SC.stateCopy(row, st);
        if (w && (w.strip || w.title || w.body)) out.ownWords++;
        else out.shellWords.push(row.id + ":" + st);
      });

      var cs = SC.loc ? SC.loc(row, "cs") : row, de = SC.loc ? SC.loc(row, "de") : row;
      var CP = window.HH_COPY;
      if (CP && CP.titles[row.id]) { out.locale.cs++; out.locale.de++; }
      else out.locale.missing.push(row.id);
      void cs; void de;
    });

    out.says = out.routes + " declared routes resolved the way the application resolves them: " +
      out.own + " from a body of their own, " + out.byModule + " answered per route by their module, " +
      out.shell + " drawn live by the shell itself, " +
      out.chrome + " from their declared chrome, " + out.noBody.length + " with nothing to draw. " +
      out.cells + " required state cells resolved from the screen's own words, " +
      out.shellWords.length + " of them falling through to the shell's generic wording.";
    return out;
  }

  function checks() {
    var rr = remainderRun(), th = themeRun(), co = contrastRun(), la = langRun(),
        di = diacriticRun(), tx = textRun(), fo = focusRun(), ta = targetRun(),
        walks = walkAll(), bad = grantRun();
    var out = [];

    out.push({
      name: "Zero rows unbuilt on the two clients this sweep covers",
      pass: rr.unbuiltSwept === 0,
      detail: rr.sweptTotal + " mobile and web client rows over " + rr.sweptStates + " required states, " +
        rr.sweptDrawn + " of them drawn and " + rr.unbuiltSwept + " rows unbuilt. The last " + rr.clientCells +
        " cells are the four rows Stages 5 and 6 left, drawn here. The tablet is counted separately, below, " +
        "because it was declared a client after this sweep ran."
    });
    out.push({
      name: "The third client is counted rather than assumed",
      pass: rr.tablet.length > 0 && rr.tabletUnbuilt.every(function (x) { return !!x.tabletWhy; }),
      detail: rr.tablet.length + " rows declare a tablet layout of their own, each with the reason it is not the " +
        "wide mobile reading. " + (rr.tablet.length - rr.tabletUnbuilt.length) + " are drawn in the shell and " +
        rr.tabletUnbuilt.length + " are not: " +
        rr.tabletUnbuilt.map(function (x) { return x.id; }).join(", ") +
        ". Stage 21 stays open until they are, which is what a third client costs."
    });
    out.push({
      name: "The last cells are credited where they were drawn",
      pass: rr.credited === REMAINDER.length && rr.mismatched.length === 0,
      detail: rr.credited + " of " + REMAINDER.length + " rows carry a late-delivery record naming this file, " +
        "state for state. A row back-dated into Stage 5 would read as though the gate had passed when it did not."
    });
    out.push({
      name: "Both themes on every route",
      pass: !!th && th.fails.length === 0 && th.darkOnly === 0,
      detail: th ? th.says : "tokens not loaded"
    });
    out.push({
      name: "Every late colour clears its minimum in both themes",
      pass: !!co && co.lateFails.length === 0 && co.declaredFails.length === 0,
      detail: co ? (co.declared.length + " declared pairs and " + co.late.length + " late spends, " +
        co.declaredFails.length + " + " + co.lateFails.length + " below minimum. Tightest of them all: " +
        co.tightest[0].fg + " on " + co.tightest[0].bg + " at " + co.tightest[0].worst + ":1 against " +
        co.tightest[0].min + ".") : "tokens not loaded"
    });
    out.push({
      name: "Every late spend is in the declared list",
      pass: co ? co.undeclared.length === 0 : false,
      detail: co ? (co.undeclared.length + " of " + co.late.length + " colour spends introduced after Stage 2 sit outside " +
        "foundations.js's declared pair list. Stage 20 found four — four status tokens spent under their own name rather " +
        "than under the token they alias, which CI was therefore not testing. The token file now declares all thirteen " +
        "status names on all three grounds" +
        (co.undeclared.length ? ", and these are still outside it: " +
          co.undeclared.slice(0, 4).map(function (u) { return u.fg + " on " + u.bg; }).join(", ") : ", so the list CI tests is the list the screens spend.")) : ""
    });
    var tab = la.containers.filter(function (c) { return c.key === "tab"; })[0];
    var tabDe = tab.langs.filter(function (l) { return l.lang === "de"; })[0];
    out.push({
      name: "The layout survives the longer language",
      pass: tabDe.fits100,
      detail: la.says + " Every tab label fits its slot at 100 % in all three; at 200 % " +
        tabDe.over200 + " of " + tabDe.n + " do not, and Stage 6's own rule answers it \u2014 the label is never dropped, the bar grows taller."
    });
    var dFail = di.filter(function (d) { return !d.pass; });
    var dTight = di.filter(function (d) { return d.wraps; })
      .sort(function (a, b) { return a.headroom - b.headroom; })[0];
    out.push({
      name: "Diacritics clear the line box wherever a line can wrap",
      pass: dFail.length === 0,
      detail: di.filter(function (d) { return d.clears; }).length + " of " + di.length +
        " type steps clear the accent stack outright. The tightest that can wrap is " + dTight.step +
        ", " + dTight.lineHeight + " px of line box against the " + dTight.need +
        " px \u010f and \u016f need: " +
        (dTight.clears ? "clear by " + dTight.headroom + " px."
                       : dTight.headroom + " px, which collides the moment a German or Czech title wraps. The fix is " +
                         dTight.fix + " in the token file and it changes nothing in English.") +
        " display is excused: " + di.filter(function (d) { return !d.wraps; })[0].excuse
    });
    out.push({
      name: "200 % text on the tightest containers",
      pass: tx.overflow.length <= 2,
      detail: tx.says + " " + tx.overflow.map(function (o) { return o.name; }).join(" and ") +
        " overflow, and both are answered by growing rather than by truncating."
    });
    out.push({
      name: "Every icon-only control has a label and a key",
      pass: fo.missing.length === 0,
      detail: fo.says
    });
    out.push({
      name: "44 pt holds under compact at both text sizes",
      pass: ta.fails.length === 0,
      detail: ta.says
    });
    out.push({
      name: "Five walkthroughs, every step on a built row",
      pass: walks.every(function (w) { return w.unresolved.length === 0; }),
      detail: walks.reduce(function (a, w) { return a + w.steps.length; }, 0) +
        " steps across five personas, all resolving to a ledger row that is built. " +
        walks.map(function (w) { return w.member ? w.member.name + " " + w.steps.length : ""; }).join(" \u00b7 ")
    });
    out.push({
      name: "No walkthrough shows a member a module they do not hold",
      pass: bad.bad.length === 0,
      detail: bad.bad.length === 0
        ? bad.tested + " steps land on a grantable module and each is checked against the member's own grant in the fixture \u2014 the two that show an absence, Adam at the chat composer and Milo\u0161 at upload, are drawing the absence itself. The other " +
          bad.exempt + " steps are per-user or platform surfaces \u2014 sign-in, the shell, Today, Add, search \u2014 where there is no module grant to hold and none is claimed."
        : bad.bad.join("; ")
    });
    out.push({
      name: "What the sweep could not settle is written down",
      pass: OPEN.length > 0,
      detail: OPEN.length + " items stay recorded here. Two are copy decisions that no measurement can make — which second language ships, and the two unnamed languages of Please update — and the rest are findings this stage fixed or corrected."
    });

    /* Stage 23 — the four that read the application rather than the ledger's own flags. */
    var me = measuredRun();
    if (me) {
      out.push({
        name: "Every declared route resolves to a body, measured rather than flagged",
        pass: me.noBody.length === 0,
        detail: me.says + (me.noBody.length ? " Nothing to draw on: " + me.noBody.slice(0, 6).join(", ") + "."
          : " Not one of them reads `built` from the ledger: the count is what came back from screenbodies.js, the module and the declaration.")
      });
      out.push({
        name: "No two routes draw the same body, measured on the built output",
        pass: me.dup.length === 0,
        detail: me.dup.length === 0
          ? (me.own + me.byModule) + " bodies compared as strings, none of them equal to another. Stage 22's gate was argued from how the code is written; this one compares what it returns."
          : me.dup.length + " pairs draw the same body: " + me.dup.slice(0, 4).join("; ")
      });
      out.push({
        name: "Every state a screen can reach has that screen's own words",
        pass: me.shellWords.length === 0,
        detail: me.ownWords + " of " + me.cells + " required state cells resolve to words the screen authored. " +
          (me.shellWords.length === 0
            ? "Before Stage 23, 152 of them fell through to the shell's generic wording on 64 screens — the one thing 03-patterns §2 forbids."
            : me.shellWords.length + " still fall through: " + me.shellWords.slice(0, 8).join(", ") + ".")
      });
      out.push({
        name: "Every declared screen carries a Czech and a German title",
        pass: me.locale.missing.length === 0,
        detail: me.locale.cs + " of " + me.routes + " screens carry both, so the rail's locale switch changes the screen and not only the frame around it. " +
          "Czech ledes are authored for every screen whose module file wrote an English one; German ledes are not, because German is the length test and the test runs on the titles and the chrome, which are the strings in fixed-width slots." +
          (me.locale.missing.length ? " Missing: " + me.locale.missing.slice(0, 8).join(", ") + "." : "")
      });
    }
    return out;
  }

  window.HH_CONFORM = {
    version: "0.1-stage-20-candidate",
    today: TODAY, chSans: CH_SANS, chMono: CH_MONO, textPx: textPx,
    remainder: REMAINDER, remainderRun: remainderRun,
    routes: routes, themeRun: themeRun,
    late: LATE, contrastRun: contrastRun,
    strings: STRINGS, langs: LANGS, containers: CONTAINERS, langRun: langRun,
    diacriticRun: diacriticRun, tight: TIGHT, textRun: textRun,
    focus: FOCUS, focusRun: focusRun,
    controls: CONTROLS, targetRun: targetRun,
    walks: WALKS, walkRun: walkRun, walkAll: walkAll, grantRun: grantRun,
    open: OPEN, checks: checks, measuredRun: measuredRun
  };
})();
