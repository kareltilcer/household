/* Stage 21 — the declared screens, wired into the shell.

   Every module file already carries its own screen rows: id, route, title, lede,
   kind, fields, notice, primary and secondary actions, the foot and note, and the
   copy for each state the screen can reach. The stage artifacts render those rows
   as measured cells. This file collects all of them into one registry so the
   application can route to every one of them, render it from the same declaration,
   and take its state copy from the module rather than from the shell.

   What this does NOT do: reproduce the bespoke body each stage artifact draws for
   its own screen — the flow view's stage-major row, the weekly grid, the tariff
   composer's eleven component types. Those bodies live in their stage artifact and
   are linked from the screen. The shell draws the screen's own chrome, its declared
   fields, its live body where the module exposes one, and its own state copy.
*/
(function () {
  "use strict";

  var SRC = [
    ["auth", "HH_AUTH"], ["household", "HH_HOUSEHOLD"], ["shopping", "HH_SHOPPING"],
    ["dashboard", "HH_DASHBOARD"], ["spine", "HH_SPINE"], ["reminders", "HH_REMINDERS"],
    ["tasks", "HH_TASKS"], ["notes", "HH_NOTES"], ["documents", "HH_DOCS"],
    ["chores", "HH_CHORES"], ["activity", "HH_ACTIVITY"], ["notify", "HH_NOTIFY"],
    ["utilities", "HH_UTILITIES"], ["finance", "HH_FINANCE"], ["garden", "HH_GARDEN"],
    ["calendar", "HH_CALENDAR"], ["assets", "HH_ASSETS"], ["chat", "HH_CHAT"],
    ["conformance", "HH_CONFORM"], ["sync", "HH_SYNC"], ["nav", "HH_NAV"]
  ];

  /* Which module owns a screen. The route's first segment answers it for most of
     them; the rest are named here, because a screen that lives at /sign-in belongs
     to no module and a screen at /assets/vehicle/... belongs to Vehicles. */
  var BY_SEGMENT = {
    shopping: "shopping", tasks: "tasks", reminders: "reminders", calendar: "calendar",
    chores: "chores", notes: "notes", documents: "documents", finance: "finance",
    utilities: "utilities", garden: "garden", property: "property", vehicles: "vehicles",
    pets: "pets", chat: "chat", activity: "activity", dashboard: "dashboard",
    settings: "admin", households: "admin", invitations: "admin", support: "admin",
    household: "admin",
    home: "dashboard"
  };
  /* Five screens whose declared route is prose rather than a path. They are the
     cross-cutting surfaces the shell already draws — Today, search, the Add sheet —
     so they get the route the shell answers on rather than a generated stub. */
  var ROUTE_FIX = {
    "F-1": "/search", "F-2": "/result-row", "F-3": "/today", "F-4": "/add", "F-19": "/help"
  };

  var BY_ID = {
    "E-17": "vehicles", "E-18": "vehicles", "E-19": "vehicles",
    "F-1": "platform", "F-2": "platform", "F-3": "platform", "F-4": "platform",
    "F-13": "platform", "F-19": "platform", "F-18": "notes", "F-20": "admin",
    /* the two cross-cutting sets that now have their own routes: Stage 5's sync
       vocabulary and Stage 6's navigation screens */
    "F-5": "sync", "F-6": "sync", "F-7": "sync",
    "A-36": "nav", "F-15": "nav", "F-16": "nav", "F-17": "nav"
  };

  /* Artifact per stage — the file that draws this screen's own body and argues it. */
  var ARTIFACT = {
    5: "Sync and Honesty.dc.html", 6: "Shells and Navigation.dc.html",
    7: "Auth and Account.dc.html", 8: "Household and Billing.dc.html",
    9: "Shopping.dc.html", 10: "Dashboard and Widgets.dc.html",
    11: "Today and Cross-cutting Screens.dc.html", 12: "Reminders and Tasks.dc.html",
    13: "Notes and Documents.dc.html", 14: "Chores, Activity and Notifications.dc.html",
    15: "Utilities.dc.html", 16: "Finance.dc.html", 17: "Garden.dc.html",
    18: "Calendar.dc.html", 19: "Property, Vehicles, Pets and Chat.dc.html",
    20: "Conformance and Walkthroughs.dc.html"
  };

  var ALL = [], BY_ROUTE = {}, seen = {};

  /* A declared route with an {id} or {service} hole is addressed at a real entity from
     the fixture household rather than at an empty segment: /calendar/events//edit is a
     route nothing can be reached at, and reads as a bug rather than as a screen. */
  var SAMPLE = [
    ["/calendar/events/", "s-pilates"], ["/calendar/connections/", "c-jana-google"],
    ["/calendar/conflicts/", "c-boiler"], ["/garden/plantings/", "p26-01"],
    ["/utilities/", "elec"], ["/tasks/", "dum"], ["/notes/", "shared"],
    ["/documents/", "d-14"], ["/finance/expenses/", "e-118"], ["/chat/", "c-dum"],
    ["/assets/", "a-1"], ["/chores/", "ch-1"], ["/shopping/", "l-shop"]
  ];

  function fillHole(route) {
    return route.replace(/\{[a-z_]+\}/gi, function (hole, at) {
      var head = route.slice(0, at);
      for (var i = 0; i < SAMPLE.length; i++) {
        if (head.indexOf(SAMPLE[i][0]) === 0) return SAMPLE[i][1];
      }
      return "one";
    });
  }

  function normalise(route, id) {
    if (ROUTE_FIX[id]) return ROUTE_FIX[id];
    if (!route || route.charAt(0) !== "/") return "/screens/" + id.toLowerCase();
    if (route === "/") return "/home";
    if (route.indexOf(" ") >= 0) return "/screens/" + id.toLowerCase();
    return fillHole(route).replace(/\/\//g, "/").replace(/\/(#|$)/, "$1");
  }

  /* The per-state words a module row carries, in whichever shape it carries them:
     a flat string, a { tone, title, body } notice, or an entry in the row's own
     states map. A screen that authored the words is not a screen with none. */
  function flat(v) {
    if (!v) return "";
    if (typeof v === "string") return v;
    if (v.s || v.e || v.a) return [v.s, v.e, v.a].filter(Boolean).join(" \u00b7 ");
    return [v.title, v.body].filter(Boolean).join(" \u2014 ");
  }
  function wordsFor(sc, state) {
    return flat(sc[state]) || flat(sc.states && sc.states[state]) || "";
  }
  function emptyFor(sc) {
    var e = sc.empty || (sc.states && sc.states.empty);
    if (!e) return null;
    if (typeof e === "string") return { s: e, e: "", a: "" };
    if (e.s || e.e || e.a) return e;
    return { s: e.title || "", e: e.body || "", a: e.action || "" };
  }

  function stageOf(id) {
    var L = window.HH_LEDGER;
    if (!L) return 0;
    var key = String(id);
    var hit = L.rows.filter(function (r) { return r.group + "-" + r.n === key; })[0];
    return hit ? hit.stage : 0;
  }

  function moduleOf(sc, path) {
    if (BY_ID[sc.id]) return BY_ID[sc.id];
    /* a hash or a query belongs to the route, not to the segment: /activity#diff is
       Activity's screen, and /home#c-5 is the dashboard's */
    var seg = (path.split("/").filter(Boolean)[0] || "").split("#")[0].split("?")[0];
    if (seg && BY_SEGMENT[seg]) return BY_SEGMENT[seg];
    if (seg === "assets") {
      var second = path.split("/").filter(Boolean)[1];
      return second === "vehicle" ? "vehicles" : second === "pet" ? "pets" : "property";
    }
    return "account";
  }

  SRC.forEach(function (s) {
    var m = window[s[1]];
    if (!m || !m.screens) return;
    m.screens.forEach(function (sc) {
      if (!sc || !sc.id) return;
      var path = normalise(sc.route, sc.id);
      var key = path + (seen[path] ? "#" + sc.id.toLowerCase() : "");
      seen[path] = (seen[path] || 0) + 1;
      var stage = stageOf(sc.id);
      var row = {
        id: sc.id, path: key, declared: sc.route || "", source: s[0],
        module: moduleOf(sc, path), name: sc.name || sc.title || sc.id,
        title: sc.title || sc.name || sc.id, lede: sc.lede || "",
        kind: sc.kind || "", client: sc.client || "mw", preset: sc.preset || "D",
        fields: sc.fields || [], notice: sc.notice || null,
        primary: sc.primary || "", secondary: sc.secondary || [],
        error: wordsFor(sc, "error"), empty: emptyFor(sc),
        rejected: wordsFor(sc, "rejected"), withdrawn: wordsFor(sc, "withdrawn"),
        readonly: wordsFor(sc, "readonly"), absent: wordsFor(sc, "absent"),
        conflicted: wordsFor(sc, "conflicted"), pending: wordsFor(sc, "pending"),
        foot: sc.foot || "", note: sc.note || "",
        stage: stage, artifact: ARTIFACT[stage] || ""
      };
      /* Stage 23 — the words the module file left to the shell. A state the screen
         can reach and has no sentence for used to fall through to the shell's
         generic wording; the copy deck authors it against this screen. */
      var CP = window.HH_COPY;
      if (CP) {
        ["error", "rejected", "withdrawn", "readonly", "absent", "conflicted", "pending"].forEach(function (k) {
          if (!row[k]) { var w = CP.state(row.id, k, "en"); if (w) row[k] = w; }
        });
        if (!row.empty) { var e = CP.state(row.id, "empty", "en"); if (e) row.empty = e; }
      }
      ALL.push(row);
      BY_ROUTE[key] = row;
    });
  });

  ALL.sort(function (a, b) {
    var ga = a.id.split("-")[0], gb = b.id.split("-")[0];
    if (ga !== gb) return ga < gb ? -1 : 1;
    return Number(a.id.split("-")[1]) - Number(b.id.split("-")[1]);
  });

  function get(path) {
    if (!path) return null;
    return BY_ROUTE[path] || BY_ROUTE[path.replace(/\/$/, "")] || null;
  }

  function forModule(mod) {
    return ALL.filter(function (r) { return r.module === mod; });
  }

  /* The state copy a screen declares for itself. The shell's own wording is the
     fallback for a screen that declares none, never the other way round. */
  function stateCopy(row, state) {
    if (!row) return null;
    if (state === "error" && row.error) return { title: "This did not load", body: row.error };
    if (state === "conflicted" && row.conflicted) return { strip: row.conflicted };
    if (state === "pending" && row.pending) return { strip: row.pending };
    if (state === "empty" && row.empty) {
      return { title: row.empty.s || "Nothing here yet",
               body: [row.empty.e, ""].filter(Boolean).join(" "),
               action: row.empty.a || "" };
    }
    if (state === "rejected" && row.rejected) return { title: "The change was refused", body: row.rejected };
    if (state === "withdrawn" && row.withdrawn) return { title: "No longer shared with you", body: row.withdrawn };
    if (state === "readonly" && row.readonly) return { strip: row.readonly };
    if (state === "absent" && row.absent) return { title: "Not available", body: row.absent };
    return null;
  }

  /* The same row in the language the rail is set to. Title and lede come from the
     copy deck; a state sentence is Czech where Czech is authored and English where
     it is not — never the shell's wording, which is the fallback for a screen that
     has none at all. */
  var LOC_KEYS = ["error", "rejected", "withdrawn", "readonly", "absent", "conflicted", "pending"];
  function loc(row, locale) {
    var CP = window.HH_COPY;
    if (!row || !CP || !locale || locale === "en") return row;
    var out = {}, k;
    for (k in row) if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
    out.title = CP.title(row, locale) || row.title;
    out.lede = CP.lede(row, locale) || row.lede;
    LOC_KEYS.forEach(function (key) {
      var w = CP.state(row.id, key, locale);
      if (w) out[key] = w;
    });
    var e = CP.state(row.id, "empty", locale);
    if (e) out.empty = e;
    return out;
  }

  window.HH_SCREENS = {
    version: "0.3-stage-23",
    all: ALL, byRoute: BY_ROUTE, count: ALL.length,
    get: get, forModule: forModule, stateCopy: stateCopy, loc: loc,
    copyCoverage: function () { return window.HH_COPY ? window.HH_COPY.coverage(ALL) : null; },
    modules: ALL.reduce(function (a, r) { if (a.indexOf(r.module) < 0) a.push(r.module); return a; }, [])
  };
})();
