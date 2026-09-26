/* Stage 1 — the fixture household. Module list reconciled in Stage 8: the seventeen
   grantable modules are FR-AC3's seventeen, so Household settings (key "admin", as in
   foundations.js and icons.js) is in the list and Today is not — Today is a cross-cutting
   platform screen with a route and a tab slot and nothing to grant.
   Five personas in one dataset, plus a second household so the switcher and the
   wrong-household deep link are real. Grants are the demo: absence and the matrix
   demonstrate themselves.
*/
(function () {
  /* The seventeen module names, in the three languages the rail switches between.
     Czech is written first (it is the shipping language) and German is here as the
     length test 07-delivery §3 asks for, not as a market. */
  var MODULES = [
    ["dashboard", "Dashboard", "Přehled", "Übersicht"],
    ["tasks", "Tasks", "Úkoly", "Aufgaben"],
    ["reminders", "Reminders", "Připomínky", "Erinnerungen"],
    ["calendar", "Calendar", "Kalendář", "Kalender"],
    ["shopping", "Shopping", "Nákupy", "Einkaufen"],
    ["chores", "Chores", "Domácí práce", "Hausarbeiten"],
    ["notes", "Notes", "Poznámky", "Notizen"],
    ["documents", "Documents", "Dokumenty", "Dokumente"],
    ["finance", "Finance", "Finance", "Finanzen"],
    ["utilities", "Utilities", "Energie a služby", "Energie und Dienste"],
    ["garden", "Garden", "Zahrada", "Garten"],
    ["property", "Property", "Nemovitost", "Immobilie"],
    ["vehicles", "Vehicles", "Vozidla", "Fahrzeuge"],
    ["pets", "Pets", "Zvířata", "Haustiere"],
    ["chat", "Chat", "Konverzace", "Unterhaltungen"],
    ["activity", "Activity log", "Historie změn", "Aktivitätsprotokoll"],
    ["admin", "Household settings", "Nastavení domácnosti", "Haushaltseinstellungen"]
  ];

  /* One place the shell asks for a module's label, so no screen has to hold three. */
  function moduleName(id, locale) {
    var hit = MODULES.filter(function (m) { return m[0] === id; })[0];
    if (!hit) return id;
    return (locale === "cs" && hit[2]) || (locale === "de" && hit[3]) || hit[1];
  }

  function grants(spec, fallback) {
    var out = {};
    MODULES.forEach(function (m) { out[m[0]] = spec[m[0]] || fallback; });
    return out;
  }

  var MEMBERS = [
    {
      id: "jana", name: "Jana", role: "owner", device: "phone", billing: true,
      note: "Owner and billing payer. manage everywhere by construction.",
      grants: grants({}, "manage")
    },
    {
      id: "petr", name: "Petr", role: "member", device: "phone",
      note: "Three modules. Thirteen are absent — not hidden, not greyed.",
      grants: grants({ dashboard: "view", utilities: "manage", shopping: "contribute", admin: "view" }, "none")
    },
    {
      id: "adam", name: "Adam", role: "child", device: "phone", locked: true,
      note: "Child. Locked dashboard, cannot hold manage anywhere, cannot exceed view on Finance.",
      grants: grants({
        dashboard: "view", chores: "contribute", tasks: "contribute",
        shopping: "contribute", calendar: "view", chat: "view", notes: "view"
      }, "none")
    },
    {
      id: "klara", name: "Klára", role: "member", device: "phone",
      note: "none on fourteen, Household settings among them — an owner narrowed it. Her app is three screens and must read as complete.",
      grants: grants({ dashboard: "view", shopping: "contribute", chat: "view" }, "none")
    },
    {
      id: "milos", name: "Miloš", role: "member", device: "tablet",
      note: "Tablet, Garden. No Chat — so his tab bar is four slots.",
      grants: grants({ dashboard: "view", garden: "manage", documents: "view", admin: "view" }, "none")
    }
  ];

  var HOUSEHOLDS = [
    {
      id: "hh-tilcer", name: "Tilcerovi", country: "CZ", tz: "Europe/Prague",
      locale: "cs-CZ", currency: "CZK", firstDay: "monday", entitlement: "active",
      members: MEMBERS.map(function (m) { return m.id; })
    },
    {
      id: "hh-chata", name: "Chata Vysočina", country: "CZ", tz: "Europe/Prague",
      locale: "cs-CZ", currency: "CZK", firstDay: "monday", entitlement: "trialing",
      members: ["jana", "milos"],
      note: "Jana is a plain member here — different role, same user. Makes the switcher and the wrong-household deep link real."
    }
  ];

  var DATA = [
    ["Garden", "plot tier, three seasons, 14 beds in 3 zones, 41 bed plantings and 4 container plants"],
    ["Utilities", "Two billing periods of readings on electricity + gas, one estimated reading, one blocked gap"],
    ["Finance", "One ledger with a settle-up, four accounts, two allocation rules with one remainder each"],
    ["Shopping", "Four lists, one recorded trip, staples learned from 9 weeks"],
    ["Documents", "38 documents, 2 expiring inside their lead window, one active-type SVG"],
    ["Sync", "One conflicted amount (Jana 450 / Petr 500 at 18:40), one rejected reading (monotonicity), one withdrawn row"]
  ];

  window.HH_FIXTURES = {
    modules: MODULES,
    moduleName: moduleName,
    members: MEMBERS,
    households: HOUSEHOLDS,
    data: DATA,
    levels: ["none", "view", "contribute", "manage"]
  };
})();
