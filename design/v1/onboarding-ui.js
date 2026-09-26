/* First run, live in the prototype shell.
   /households/new and its three follow-on steps (name → modules → people → ready), the Chores
   setup the handoff states but never drew (starter set · points · reset day), and C-58's
   "Set up again" list as a working screen. The module setups themselves stay in their own
   files; this file only knows which modules have one, where it starts, and whether it has run.
   Drawn through the Finance block vocabulary, like Garden, Utilities and Property. */
(function () {
  var KINDS = ["Hero", "Label", "Rows", "Note", "Bars", "Acts", "Field", "Chips", "Inputs", "Cards", "Steps", "Kv", "Empty"];
  var LV = ["none", "view", "contribute", "manage"];

  /* The five modules with a first-open setup. Everything else opens on its teaching empty
     state: one sentence, one example, one action — that is its onboarding. */
  var SETUPS = [
    { k: "chores", route: "/chores/setup/1", en: "Starter set, points, reset day", cs: "Startovn\u00ed sada, body, den resetu", n: 3 },
    { k: "finance", route: "/finance/setup/1", en: "How your household handles money", cs: "Jak u v\u00e1s chod\u00ed pen\u00edze", n: 5 },
    { k: "utilities", route: "/utilities/setup/1", en: "What you pay for and how closely", cs: "Za co plat\u00edte a jak podrobn\u011b", n: 4 },
    { k: "garden", route: "/garden/setup/1", en: "What you grow in, where, frost dates", cs: "V \u010dem p\u011bstujete, kde, mrazy", n: 4 },
    { k: "property", route: "/property/setup/checklist", en: "Five things almost every house has", cs: "P\u011bt v\u011bc\u00ed, kter\u00e9 m\u00e1 skoro ka\u017ed\u00fd d\u016fm", n: 1 }
  ];
  var FIXTURE_DONE = { chores: "done", finance: "done", utilities: "partial", garden: "done", property: "done" };
  var GROUPS = [
    ["Every day", "Ka\u017ed\u00fd den", ["shopping", "chores", "tasks", "reminders", "calendar", "notes"]],
    ["Money and paperwork", "Pen\u00edze a pap\u00edry", ["finance", "utilities", "documents"]],
    ["The house and the rest", "D\u016fm a ostatn\u00ed", ["property", "vehicles", "pets", "garden", "chat"]]
  ];
  var DEFAULT_ON = ["shopping", "chores", "tasks", "reminders", "calendar", "notes", "documents", "utilities"];
  var BLURB = {
    shopping: ["Shared lists that learn your staples", "Sd\u00edlen\u00e9 seznamy, kter\u00e9 si pamatuj\u00ed, co kupujete"],
    chores: ["Who does what, and whose turn it is", "Kdo co d\u011bl\u00e1 a kdo je na \u0159ad\u011b"],
    tasks: ["One-off jobs with a board", "Jednor\u00e1zov\u00e9 \u00fakoly na tabuli"],
    reminders: ["Dates the household must not miss", "Term\u00edny, kter\u00e9 nesm\u00ed ut\u00e9ct"],
    calendar: ["Everyone's week in one place", "T\u00fdden v\u0161ech na jednom m\u00edst\u011b"],
    notes: ["Shared and private notes", "Sd\u00edlen\u00e9 i soukrom\u00e9 pozn\u00e1mky"],
    finance: ["Budgets, shared costs, settling up", "Rozpo\u010dty, sd\u00edlen\u00e9 v\u00fddaje, vyrovn\u00e1n\u00ed"],
    utilities: ["Bills, advances and meter readings", "Faktury, z\u00e1lohy a odpo\u010dty"],
    documents: ["Contracts, warranties, IDs", "Smlouvy, z\u00e1ruky, doklady"],
    property: ["Services and things that wear out", "Servisy a v\u011bci, kter\u00e9 se opot\u0159ebuj\u00ed"],
    vehicles: ["MOT, insurance, tyres, fuel", "STK, poji\u0161t\u011bn\u00ed, pneumatiky, palivo"],
    pets: ["Vaccinations, doses, the vet", "O\u010dkov\u00e1n\u00ed, l\u00e9ky, veterin\u00e1\u0159"],
    garden: ["Beds, sowing dates, frost", "Z\u00e1hony, v\u00fdsevy, mrazy"],
    chat: ["Household conversations", "Konverzace dom\u00e1cnosti"]
  };
  var COUNTRIES = [["CZ", "Czechia", "\u010cesko", "CZK", "Europe/Prague"], ["SK", "Slovakia", "Slovensko", "EUR", "Europe/Bratislava"],
    ["DE", "Germany", "N\u011bmecko", "EUR", "Europe/Berlin"], ["AT", "Austria", "Rakousko", "EUR", "Europe/Vienna"]];
  var DAYS = [["monday", "Monday", "pond\u011bl\u00ed"], ["tuesday", "Tuesday", "\u00fater\u00fd"], ["wednesday", "Wednesday", "st\u0159eda"], ["thursday", "Thursday", "\u010dtvrtek"],
    ["friday", "Friday", "p\u00e1tek"], ["saturday", "Saturday", "sobota"], ["sunday", "Sunday", "ned\u011ble"]];

  function setupOf(k) { return SETUPS.filter(function (x) { return x.k === k; })[0] || null; }
  function stateOf(self, k) {
    var s = self.state, d = s.obDone || {};
    if (d[k]) return "done";
    return s.obNew ? "none" : (FIXTURE_DONE[k] || "none");
  }
  /* A module setup calls this on Finish. If the setup was opened from the first-run list or
     from turning a module on, it goes back there; otherwise the module's own finish stands. */
  function mark(self, k) {
    var d = Object.assign({}, self.state.obDone || {}); d[k] = true;
    var back = self.state.obReturn;
    self.setState(back ? { obDone: d, obReturn: null, route: back } : { obDone: d });
  }
  function start(self, k, back) {
    var su = setupOf(k); if (!su) return false;
    self.setState({ obReturn: back || null, sheet: false });
    self.go(su.route);
    return true;
  }

  function view(self, seg, query, hash, wide) {
    var F = window.HH_FIXTURES, N = window.HH_NAV;
    if (!F || !N) return null;
    var s = self.state, L = self.chatL.bind(self), web = s.client === "web", cs = s.locale === "cs";
    var a = seg[0], b = seg[1], c = seg[2];
    var page = null;
    if (a === "households" && b === "new") page = c === "modules" ? "modules" : c === "people" ? "people" : c === "ready" ? "ready" : "name";
    else if (a === "chores" && b === "setup") page = "chores";
    else if (a === "settings" && b === "modules" && c === "setup") page = "again";
    if (!page) return null;

    var nav = N.navFor(s.member, s.household) || {};
    if (!nav.belongs) return null;
    var grants = nav.grants || {};
    var hh = F.households.filter(function (x) { return x.id === s.household; })[0];
    if (!hh) return null;
    var disabled = hh.disabled || (hh.disabled = []);
    var ro = ["read_only", "canceled", "restricted"].indexOf(s.ent) >= 0 || s.screen === "readonly";
    var canM = function (k) { return LV.indexOf(grants[k] || "none") >= 3 && !ro && disabled.indexOf(k) < 0; };
    var modName = function (k) { return F.moduleName ? F.moduleName(k, s.locale) : k; };
    var go = function (r) { return function () { self.go(r); }; };
    var ob = s.ob || { name: "", country: hh.country || "CZ", lang: cs ? "cs" : "en", first: hh.firstDay || "monday",
      on: DEFAULT_ON.slice(), adults: [], kids: [], adultName: "", adultEmail: "", kidName: "", err: "" };
    var setOb = function (p) { self.setState({ ob: Object.assign({}, ob, p) }); };
    var ctry = COUNTRIES.filter(function (x) { return x[0] === ob.country; })[0] || COUNTRIES[0];
    var hName = ob.name || hh.name;

    /* ── blocks (the Finance vocabulary) ── */
    var blk = function (t, p) { var o = {}; KINDS.forEach(function (x) { o["is" + x] = x === t; }); return Object.assign(o, p); };
    var inkOf = function (t) {
      return t === "danger" ? "var(--danger)" : t === "warn" ? "var(--warning)" : t === "accent" ? "var(--accent)"
        : t === "offline" ? "var(--status-offline)" : t === "muted" ? "var(--text-muted)" : "var(--text-primary)";
    };
    var badgeStyle = function (t) {
      var ink = t ? inkOf(t) : "var(--text-muted)";
      return "font-family:'IBM Plex Mono',monospace;font-size:0.625em;letter-spacing:0.06em;text-transform:uppercase;padding:2px 6px;border-radius:4px;white-space:nowrap;border:1px solid " + ink + ";color:" + ink;
    };
    var row = function (p) {
      var fn = p.open || null;
      return Object.assign({ lead: "", dot: false, title: "", sub: "", badge: "", right: "", rightSub: "", act: "", onAct: null }, p, {
        chev: !!fn && !p.noChev, noOpen: !fn, open: fn || function () {},
        btnStyle: "flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:12px;min-height:56px;padding:10px 16px;border:none;font-family:inherit;text-align:left;color:inherit;background:transparent;cursor:" + (fn ? "pointer" : "default"),
        titleStyle: "font-size:0.9375em;line-height:1.35;overflow-wrap:anywhere;font-weight:" + (p.strong ? "600" : "500") + ";color:" + (p.muted ? "var(--text-muted)" : "var(--text-primary)"),
        subStyle: "font-size:0.75em;line-height:1.45;overflow-wrap:anywhere;text-wrap:pretty;color:" + (p.subTone ? inkOf(p.subTone) : "var(--text-muted)"),
        rightStyle: "font-family:'IBM Plex Mono',monospace;font-size:0.8125em;white-space:nowrap;color:" + inkOf(p.tone),
        badgeStyle: badgeStyle(p.badgeTone),
        dotStyle: "flex:0 0 10px;width:10px;height:10px;border-radius:3px;background:" + (p.dotInk || "var(--border-strong)"),
        actStyle: "flex:0 0 auto;align-self:center;margin-right:12px;min-height:36px;padding:0 12px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:0.78125em;font-weight:600;white-space:nowrap;border:1px solid var(--accent);" +
          (p.actFill ? "background:var(--accent);color:var(--text-on-accent)" : "background:transparent;color:var(--accent)")
      });
    };
    var label = function (t) { return blk("Label", { text: t, link: "", onLink: function () {} }); };
    var rows = function (r) { return blk("Rows", { rows: r.filter(Boolean) }); };
    var note = function (t, tone) {
      return blk("Note", { text: t, link: "", onLink: function () {},
        style: "display:flex;flex-direction:column;gap:6px;align-items:flex-start;font-size:0.8125em;line-height:1.6;text-wrap:pretty;max-width:68ch;" +
          (tone === "box" ? "margin:10px 16px;padding:12px 14px;border-radius:10px;background:var(--surface-sunken);color:var(--text-primary)"
            : tone === "body" ? "padding:12px 16px 4px;font-size:0.9375em;color:var(--text-primary)"
            : "padding:10px 16px;color:var(--text-muted)") });
    };
    var btn = function (lbl, kind, on, dis) { return { label: lbl, style: self.docBtn(kind, dis ? false : undefined), on: dis ? function () {} : on, off: !!dis }; };
    var acts = function (list) { list = list.filter(Boolean); return list.length ? blk("Acts", { btns: list }) : null; };
    var kv = function (pairs) { return blk("Kv", { pairs: pairs.map(function (p) { return { k: p[0], v: String(p[1]) }; }) }); };
    var chip = function (nm, on, pick) { return { name: nm, style: self.docChip(on), pick: pick }; };
    var chips = function (lbl, items, hint) { return blk("Chips", { label: lbl || "", hint: hint || "", chips: items }); };
    var field = function (p) {
      return blk("Field", Object.assign({ label: "", value: "", placeholder: "", mode: "text", type: "text", suffix: "", err: "", hint: "", off: false }, p, {
        onChange: function (e) { p.set(e.target.value); },
        boxStyle: "display:flex;align-items:center;gap:8px;border:1px solid " + (p.err ? "var(--danger)" : "var(--border-strong)") +
          ";border-radius:8px;background:var(--input-bg);padding:0 12px;max-width:520px" }));
    };
    var cardStyle = function (on) {
      return "display:flex;flex-direction:column;gap:6px;align-items:flex-start;text-align:left;padding:14px;border-radius:12px;cursor:pointer;font-family:inherit;color:inherit;min-height:84px;" +
        "border:1px solid " + (on ? "var(--accent)" : "var(--border-strong)") + ";background:" + (on ? "var(--surface-sunken)" : "var(--surface-raised)") +
        ";box-shadow:" + (on ? "inset 0 0 0 1px var(--accent)" : "none");
    };
    var cards = function (items) { return blk("Cards", { items: items }); };
    var steps = function (list, cur) {
      return blk("Steps", { items: list.map(function (x, i) {
        var on = i === cur, done = i < cur;
        return { label: (done ? "\u2713 " : (i + 1) + " \u00b7 ") + x, style: "display:inline-flex;align-items:center;min-height:28px;padding:0 10px;border-radius:14px;font-size:0.71875em;white-space:nowrap;" +
          "border:1px solid " + (on ? "var(--accent)" : "var(--border)") + ";color:" + (on ? "var(--text-on-accent)" : done ? "var(--text-primary)" : "var(--text-muted)") +
          ";background:" + (on ? "var(--accent)" : "transparent") };
      }) });
    };
    var hero = function (p) {
      return blk("Hero", Object.assign({ kicker: "", big: "", sub: "", stats: [] }, p, {
        hasStats: false, hasNav: false, onPrev: function () {}, onNext: function () {}, prevOff: true, nextOff: true,
        bigStyle: "font-size:2.125em;font-weight:600;letter-spacing:-0.02em;line-height:1.15;overflow-wrap:anywhere;color:var(--text-primary)" }));
    };
    var empty = function (t, body, action, on) { return blk("Empty", { title: t, body: body, action: action || "", on: on || function () {} }); };

    var P = [], foot = [], footNote = "", headTitle = "", headSub = "", back = null, bare = false;
    var push = function (x) { if (x) P.push(x); };
    var OB_STEPS = [L("Household", "Dom\u00e1cnost"), L("Modules", "Moduly"), L("People", "Lid\u00e9"), L("Ready", "Hotovo")];

    /* ═══ 1 · name the household (A-22, live) ═══ */
    if (page === "name") {
      bare = true;
      headTitle = L("Set up your household", "Nastaven\u00ed dom\u00e1cnosti"); headSub = L("Step 1 of 4", "Krok 1 ze 4");
      push(steps(OB_STEPS, 0));
      push(note(L("Four of these five are read from this phone. Change any of them.", "\u010cty\u0159i z t\u011bchto p\u011bti jsou p\u0159e\u010dten\u00e9 z telefonu. Kter\u00e9koli jde zm\u011bnit."), "body"));
      push(field({ label: L("Name", "N\u00e1zev"), value: ob.name, placeholder: hh.name, err: ob.err, hint: L("What the household is called on every screen and invitation.", "Tak se dom\u00e1cnost jmenuje na v\u0161ech obrazovk\u00e1ch a v pozv\u00e1nk\u00e1ch."),
        set: function (v) { setOb({ name: v, err: "" }); } }));
      push(chips(L("Country \u00b7 from this phone", "Zem\u011b \u00b7 z telefonu"), COUNTRIES.map(function (x) {
        return chip(cs ? x[2] : x[1], ob.country === x[0], function () { setOb({ country: x[0] }); });
      }), L("Decides which tariff presets, document types and statutory dates are offered.", "Podle zem\u011b se nab\u00edzej\u00ed tarify, typy doklad\u016f a z\u00e1konn\u00e9 term\u00edny.")));
      push(chips(L("Language \u00b7 from this phone", "Jazyk \u00b7 z telefonu"), [["cs", "\u010ce\u0161tina"], ["en", "English"], ["de", "Deutsch"]].map(function (x) {
        return chip(x[1], ob.lang === x[0], function () { setOb({ lang: x[0] }); });
      })));
      push(chips(L("Week starts on", "T\u00fdden za\u010d\u00edn\u00e1"), [DAYS[0], DAYS[6]].map(function (x) {
        return chip(cs ? x[2] : x[1], ob.first === x[0], function () { setOb({ first: x[0] }); });
      })));
      push(kv([[L("Time zone \u00b7 from this phone", "\u010casov\u00e9 p\u00e1smo \u00b7 z telefonu"), ctry[4]], [L("Money is counted in", "M\u011bna"), ctry[3]]]));
      push(note(L("Thirty days, no card. The trial starts now; if you do nothing at the end, the household keeps reading and exporting everything in it.",
        "T\u0159icet dn\u00ed bez karty. Zku\u0161ebn\u00ed doba za\u010d\u00edn\u00e1 te\u010f; kdy\u017e na konci nic neud\u011bl\u00e1te, v\u0161e zapsan\u00e9 z\u016fstane \u010diteln\u00e9 a jde exportovat."), "box"));
      foot = [btn(L("I was invited to one instead", "M\u00e1m pozv\u00e1nku do jin\u00e9"), "", go("/join")),
        btn(L("Create ", "Zalo\u017eit ") + hName, "primary", function () {
          if (!String(hName).trim()) return setOb({ err: L("A household needs a name.", "Dom\u00e1cnost pot\u0159ebuje n\u00e1zev.") });
          hh.name = String(hName).trim(); hh.country = ctry[0]; hh.currency = ctry[3]; hh.tz = ctry[4]; hh.firstDay = ob.first;
          self.setState({ ob: Object.assign({}, ob, { name: hh.name }), obNew: true, obDone: {}, locale: ob.lang === "en" ? "en" : ob.lang === "de" ? "de" : "cs" });
          self.go("/households/new/modules");
        })];
    }

    /* ═══ 2 · modules ═══ */
    if (page === "modules") {
      bare = true; back = "/households/new";
      headTitle = L("What will you use first?", "Co budete pou\u017e\u00edvat jako prvn\u00ed?"); headSub = L("Step 2 of 4", "Krok 2 ze 4");
      push(steps(OB_STEPS, 1));
      push(note(L("Pick what you need now. Anything can be turned on later, and turning a module off keeps its data.",
        "Vyberte, co pot\u0159ebujete te\u010f. Cokoli jde zapnout pozd\u011bji a vypnut\u00ed modulu data zachov\u00e1."), "body"));
      GROUPS.forEach(function (g) {
        push(label(cs ? g[1] : g[0]));
        push(cards(g[2].map(function (k) {
          var on = ob.on.indexOf(k) >= 0, su = setupOf(k), bl = BLURB[k] || ["", ""];
          return { title: (on ? "\u2713 " : "") + modName(k), sub: cs ? bl[1] : bl[0],
            meta: su ? (su.n === 1 ? L("one short list when you open it", "kr\u00e1tk\u00fd seznam p\u0159i otev\u0159en\u00ed") : su.n + L(" short questions when you open it", " kr\u00e1tk\u00e9 ot\u00e1zky p\u0159i otev\u0159en\u00ed")) : "",
            style: cardStyle(on),
            pick: function () { setOb({ on: on ? ob.on.filter(function (x) { return x !== k; }) : ob.on.concat([k]) }); } };
        })));
      });
      footNote = ob.on.length + L(" on", " zapnuto");
      foot = [btn(L("Back", "Zp\u011bt"), "", go("/households/new")),
        btn(L("Continue", "Pokra\u010dovat"), "primary", function () {
          GROUPS.forEach(function (g) { g[2].forEach(function (k) {
            var i = disabled.indexOf(k), on = ob.on.indexOf(k) >= 0;
            if (on && i >= 0) disabled.splice(i, 1);
            if (!on && i < 0) disabled.push(k);
          }); });
          self.go("/households/new/people");
        }, !ob.on.length)];
    }

    /* ═══ 3 · people ═══ */
    if (page === "people") {
      bare = true; back = "/households/new/modules";
      headTitle = L("Who else lives here?", "Kdo tu je\u0161t\u011b bydl\u00ed?"); headSub = L("Step 3 of 4", "Krok 3 ze 4");
      push(steps(OB_STEPS, 2));
      push(note(L("Optional. Invitations go out when you finish, and each person's access can be changed in Members afterwards.",
        "Nepovinn\u00e9. Pozv\u00e1nky odejdou po dokon\u010den\u00ed a p\u0159\u00edstup ka\u017ed\u00e9ho jde pozd\u011bji zm\u011bnit ve \u010clenech."), "body"));
      push(label(L("An adult, by email", "Dosp\u011bl\u00fd, e-mailem")));
      push(field({ label: L("Their name", "Jm\u00e9no"), value: ob.adultName, placeholder: "Petr", set: function (v) { setOb({ adultName: v }); } }));
      push(field({ label: L("Email", "E-mail"), value: ob.adultEmail, type: "email", placeholder: "petr@\u2026", set: function (v) { setOb({ adultEmail: v }); },
        hint: L("They get the modules you turned on at the everyday level. Finance stays closed until you open it for them.", "Dostanou zapnut\u00e9 moduly na b\u011b\u017en\u00e9 \u00farovni. Finance z\u016fstanou zav\u0159en\u00e9, dokud je neotev\u0159ete.") }));
      push(acts([btn(L("Add", "P\u0159idat"), "", function () {
        if (!ob.adultName.trim() || ob.adultEmail.indexOf("@") < 1) return;
        setOb({ adults: ob.adults.concat([{ name: ob.adultName.trim(), email: ob.adultEmail.trim() }]), adultName: "", adultEmail: "" });
      }, !ob.adultName.trim() || ob.adultEmail.indexOf("@") < 1)]));
      push(label(L("A child, without email", "D\u00edt\u011b, bez e-mailu")));
      push(field({ label: L("Their name", "Jm\u00e9no"), value: ob.kidName, placeholder: "Adam", set: function (v) { setOb({ kidName: v }); },
        hint: L("They sign in with the household code and a PIN you choose. A child can never hold manage, or more than view on Finance.", "P\u0159ihl\u00e1s\u00ed se k\u00f3dem dom\u00e1cnosti a PINem. D\u00edt\u011b nikdy nem\u016f\u017ee spravovat a ve Financ\u00edch jen vid\u00ed.") }));
      push(acts([btn(L("Add", "P\u0159idat"), "", function () {
        if (!ob.kidName.trim()) return;
        setOb({ kids: ob.kids.concat([{ name: ob.kidName.trim() }]), kidName: "" });
      }, !ob.kidName.trim())]));
      var ppl = ob.adults.map(function (p, i) { return row({ title: p.name, sub: p.email + L(" \u00b7 invitation, 14 days", " \u00b7 pozv\u00e1nka na 14 dn\u00ed"), act: L("Remove", "Odebrat"), onAct: function () { setOb({ adults: ob.adults.filter(function (_, j) { return j !== i; }) }); } }); })
        .concat(ob.kids.map(function (p, i) { return row({ title: p.name, sub: L("child profile \u00b7 household code + PIN", "d\u011btsk\u00fd profil \u00b7 k\u00f3d + PIN"), act: L("Remove", "Odebrat"), onAct: function () { setOb({ kids: ob.kids.filter(function (_, j) { return j !== i; }) }); } }); }));
      if (ppl.length) { push(label(L("Adding", "P\u0159id\u00e1te"))); push(rows(ppl)); }
      foot = [btn(L("Back", "Zp\u011bt"), "", go("/households/new/modules")),
        btn(ppl.length ? L("Continue", "Pokra\u010dovat") : L("Just me for now", "Zat\u00edm jen j\u00e1"), "primary", go("/households/new/ready"))];
    }

    /* ═══ 4 · ready — the first-run list ═══ */
    if (page === "ready" || page === "again") {
      var enabled = SETUPS.filter(function (x) { return disabled.indexOf(x.k) < 0; });
      var mine = enabled.filter(function (x) { return canM(x.k); });
      var here = page === "ready" ? "/households/new/ready" : "/settings/modules/setup";
      var setupRow = function (x) {
        var st = stateOf(self, x.k);
        return row({ title: modName(x.k), sub: (cs ? x.cs : x.en) + (st === "partial" ? L(" \u00b7 part-way, answers kept", " \u00b7 rozpracov\u00e1no, odpov\u011bdi z\u016fst\u00e1vaj\u00ed") : ""),
          right: st === "done" ? L("done", "hotovo") : st === "partial" ? L("part-way", "\u010d\u00e1ste\u010dn\u011b") : "", tone: st === "done" ? "muted" : "warn",
          act: st === "done" ? (page === "again" ? L("Set up again", "Znovu") : "") : st === "partial" ? L("Continue", "Pokra\u010dovat") : L("Set up", "Nastavit"),
          actFill: st === "none", onAct: function () { start(self, x.k, here); },
          open: function () { start(self, x.k, here); }, noChev: true });
      };
      if (page === "ready") {
        bare = true; back = "/households/new/people";
        headTitle = hh.name + L(" is ready", " je p\u0159ipraven\u00e1"); headSub = L("Step 4 of 4", "Krok 4 ze 4");
        push(steps(OB_STEPS, 3));
        var ppl2 = ob.adults.length + ob.kids.length;
        push(hero({ kicker: L("Trial \u00b7 30 days", "Zku\u0161ebn\u00ed doba \u00b7 30 dn\u00ed"), big: hh.name,
          sub: (ob.on.length + L(" modules on", " modul\u016f zapnuto")) + (ppl2 ? " \u00b7 " + ppl2 + L(ppl2 === 1 ? " person added" : " people added", " lid\u00ed p\u0159id\u00e1no") : "") }));
        var todo = mine.filter(function (x) { return stateOf(self, x.k) !== "done"; });
        if (mine.length) {
          push(label(L("Worth two minutes now", "Stoj\u00ed za dv\u011b minuty te\u010f")));
          push(rows(mine.map(setupRow)));
          push(note(L("Each one is skippable. A module you don't set up still works, and asks again on its own empty screen. All of these stay in Settings \u2192 Modules \u2192 Set up again.",
            "Ka\u017ed\u00fd jde p\u0159esko\u010dit. Nenastaven\u00fd modul funguje a zept\u00e1 se znovu na sv\u00e9 pr\u00e1zdn\u00e9 obrazovce. V\u0161e z\u016fst\u00e1v\u00e1 v Nastaven\u00ed \u2192 Moduly \u2192 Nastavit znovu.")));
        }
        push(label(L("Everything else", "V\u0161e ostatn\u00ed")));
        push(rows([row({ title: L("Add widgets to Home", "P\u0159idat widgety na P\u0159ehled"), sub: L("Filtered to what you turned on", "Jen z toho, co je zapnut\u00e9"), open: go("/home/catalog") }),
          row({ title: L("The other modules", "Ostatn\u00ed moduly"), sub: L("Open on a one-sentence empty state with a single first action", "Otev\u0159ou se s jednou v\u011btou a jednou prvn\u00ed akc\u00ed"), open: null })]));
        footNote = todo.length ? todo.length + L(" setups not run", " nastaven\u00ed nespu\u0161t\u011bno") : "";
        foot = [btn(L("Go to Today", "P\u0159ej\u00edt na Dnes"), "primary", function () { self.setState({ obReturn: null }); self.go("/today"); })];
      } else {
        headTitle = L("Set up again", "Nastavit znovu"); headSub = L("A module's own setup, after the first time", "Nastaven\u00ed modulu i po prvn\u00edm spu\u0161t\u011bn\u00ed");
        back = "/households/tilcerovi/settings/modules";
        if (!mine.length) push(empty(L("Nothing to set up.", "Nen\u00ed co nastavovat."), enabled.length ? L("A setup needs manage on its module, and you hold it on none of these.", "Nastaven\u00ed vy\u017eaduje spr\u00e1vu modulu.") : L("The modules you can set up appear here as they are turned on.", "Moduly se objev\u00ed, a\u017e se zapnou."), L("See modules", "Zobrazit moduly"), go("/households/tilcerovi/settings/modules")));
        else {
          push(rows(mine.map(setupRow)));
          push(note(L("Re-running a setup does not reset the module: it reopens the questions with the household's answers already in them.",
            "Znovuspu\u0161t\u011bn\u00ed nic nesma\u017ee: otev\u0159e ot\u00e1zky s odpov\u011b\u010fmi, kter\u00e9 u\u017e dom\u00e1cnost dala.")));
        }
        if (!s.online) push(note(L("Offline. The list is read from this device; opening a setup needs the network.", "Offline. Seznam je z tohoto za\u0159\u00edzen\u00ed; nastaven\u00ed pot\u0159ebuje s\u00ed\u0165."), "box"));
      }
    }

    /* ═══ Chores setup — the three steps 06-chores §Setup states ═══ */
    if (page === "chores") {
      var C = window.HH_CHORES;
      if (!C) return null;
      var n = Math.max(1, Math.min(3, parseInt(c, 10) || 1));
      var kids = F.members.filter(function (m) { return m.role === "child" && (hh.members || []).indexOf(m.id) >= 0; });
      var cs0 = s.choSetup || {};
      var cst = s.choSu || { starter: cs0.starter || "starter", points: cs0.points != null ? cs0.points : (kids.length > 0 && !s.choPointsOff), reset: cs0.reset || hh.firstDay || "monday" };
      var setC = function (p) { self.setState({ choSu: Object.assign({}, cst, p) }); };
      var have = (self.cho().chores || []).filter(function (x) { return !x.deleted && (s.screen !== "empty" || x.session || x.fresh); }).length;
      back = "/chores"; bare = true;
      headTitle = L("Set up Chores", "Nastaven\u00ed dom\u00e1c\u00edch prac\u00ed"); headSub = L("Step ", "Krok ") + n + L(" of 3", " ze 3");
      if (!canM("chores")) {
        push(empty(L("Setting up Chores needs manage.", "Nastaven\u00ed vy\u017eaduje spr\u00e1vu."), L("The chores themselves still read and tick off as usual.", "Pr\u00e1ce samotn\u00e9 jdou d\u00e1l \u010d\u00edst a od\u0161krt\u00e1vat."), L("Open Chores", "Otev\u0159\u00edt pr\u00e1ce"), go("/chores")));
      } else {
        push(steps([L("Starter set", "Startovn\u00ed sada"), L("Points", "Body"), L("Reset day", "Den resetu")], n - 1));
        if (n === 1) {
          push(note(L("Start with four common chores, or with none. Every one is editable and deletable afterwards.", "Za\u010dn\u011bte \u010dty\u0159mi b\u011b\u017en\u00fdmi pracemi, nebo \u017e\u00e1dnou. Ka\u017edou jde pak upravit i smazat."), "body"));
          var starter = ["bins", "dishwasher", "plants", "laundry"].map(function (k) { var x = C.choreOf(k); return x ? x.name : k; }).join(", ");
          push(cards([
            { title: L("The starter set", "Startovn\u00ed sada"), sub: starter, meta: have ? L("adds to the " + have + " already here", "p\u0159id\u00e1 k " + have + " existuj\u00edc\u00edm") : L("4 chores, rotating", "4 pr\u00e1ce, st\u0159\u00eddav\u011b"), style: cardStyle(cst.starter === "starter"), pick: function () { setC({ starter: "starter" }); } },
            { title: L("Start empty", "Za\u010d\u00edt od nuly"), sub: L("Add your own from the Chores screen, one at a time.", "P\u0159id\u00e1te vlastn\u00ed jednu po druh\u00e9."), meta: have ? have + L(" already here are kept", " existuj\u00edc\u00edch z\u016fstane") : "", style: cardStyle(cst.starter === "none"), pick: function () { setC({ starter: "none" }); } }]));
        }
        if (n === 2) {
          push(note(L("Points turn finished chores into something to spend on rewards you set. They are for children; adults never earn them.", "Body m\u011bn\u00ed hotov\u00e9 pr\u00e1ce na odm\u011bny, kter\u00e9 nastav\u00edte. Jsou pro d\u011bti; dosp\u011bl\u00ed je nez\u00edsk\u00e1vaj\u00ed."), "body"));
          push(cards([
            { title: L("Points on", "Body zapnut\u00e9"), sub: kids.length ? L("For " + kids.map(function (k) { return k.name; }).join(", ") + ". Rewards and the points ledger appear in Chores.", "Pro " + kids.map(function (k) { return k.name; }).join(", ") + ". V pracech p\u0159ibudou odm\u011bny a p\u0159ehled bod\u016f.") : L("No child profile yet, so nobody earns anything until one is added.", "Zat\u00edm tu nen\u00ed d\u011btsk\u00fd profil, tak\u017ee body nikdo nez\u00edsk\u00e1."),
              meta: L("changeable any time", "jde kdykoli zm\u011bnit"), style: cardStyle(cst.points), pick: function () { setC({ points: true }); } },
            { title: L("Points off", "Bez bod\u016f"), sub: L("Chores are just who does what, and whose turn it is.", "Pr\u00e1ce jsou jen kdo co d\u011bl\u00e1 a kdo je na \u0159ad\u011b."), meta: "", style: cardStyle(!cst.points), pick: function () { setC({ points: false }); } }]));
        }
        if (n === 3) {
          push(note(L("The day the week's chores start over: rotations move to the next person and weekly chores come due again.", "Den, kdy t\u00fdden za\u010d\u00edn\u00e1 znovu: rotace se posune na dal\u0161\u00edho a t\u00fddenn\u00ed pr\u00e1ce jsou zase na \u0159ad\u011b."), "body"));
          push(chips(L("Reset day", "Den resetu"), DAYS.map(function (d) { return chip(cs ? d[2] : d[1], cst.reset === d[0], function () { setC({ reset: d[0] }); }); }),
            L("Defaults to the day the household's week starts.", "V\u00fdchoz\u00ed je den, kdy za\u010d\u00edn\u00e1 t\u00fdden dom\u00e1cnosti.")));
          var dayW = (DAYS.filter(function (d) { return d[0] === cst.reset; })[0] || DAYS[0]);
          push(kv([[L("Starter set", "Startovn\u00ed sada"), cst.starter === "starter" ? L("4 chores", "4 pr\u00e1ce") : L("none", "\u017e\u00e1dn\u00e1")], [L("Points", "Body"), cst.points ? L("on", "zapnuto") : L("off", "vypnuto")], [L("Resets", "Reset"), L("every ", "ka\u017ed\u00fd ") + (cs ? dayW[2] : dayW[1])]]));
        }
        foot = [n > 1 ? btn(L("Back", "Zp\u011bt"), "", go("/chores/setup/" + (n - 1))) : btn(L("Skip for now", "Te\u010f p\u0159esko\u010dit"), "", function () { self.setState({ choSu: null }); self.go(s.obReturn || "/chores"); if (s.obReturn) self.setState({ obReturn: null }); }),
          n < 3 ? btn(L("Next", "Dal\u0161\u00ed"), "primary", go("/chores/setup/" + (n + 1))) : btn(L("Finish", "Dokon\u010dit"), "primary", function () {
            var addStarter = cst.starter === "starter" && !(s.choSetup && s.choSetup.starterAdded);
            self.setState({ choSetup: { starter: cst.starter, points: cst.points, reset: cst.reset, starterAdded: addStarter || (s.choSetup && s.choSetup.starterAdded) }, choPointsOff: !cst.points, choSu: null });
            if (addStarter) self.choStarter();
            else self.docToastShow(L("Chores set up. Nothing already recorded was changed.", "Pr\u00e1ce nastaveny. Nic zapsan\u00e9ho se nezm\u011bnilo."));
            mark(self, "chores");
            if (!s.obReturn) self.go(addStarter ? "/chores/all" : "/chores");
          })];
      }
    }

    /* ── assemble ── */
    var footBar = function (bg) {
      return "position:sticky;bottom:0;margin-top:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--border);background:" + bg;
    };
    var panes = [{ key: "main", role: "region", title: headTitle,
      outer: "flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--surface)",
      inner: "flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column" + (wide ? ";align-items:center" : ""),
      col: "display:flex;flex-direction:column;flex:1 0 auto;width:100%;max-width:" + (wide ? "720px" : "none") + ";padding-bottom:" + (foot.length ? "0" : "32px"),
      onOuter: function () {}, hasHead: false, sub: "", blocks: P.filter(Boolean), hasFoot: foot.length > 0, foot: foot, footNote: footNote, footStyle: footBar("var(--surface-raised)") }];
    return { panes: panes, headTitle: headTitle, headSub: headSub, sheetOpen: false, bare: bare,
      showBack: !!back, onBack: function () { if (back) self.go(back); } };
  }

  window.HH_OB_VIEW = view;
  window.HH_OB = { setups: SETUPS, setupOf: setupOf, stateOf: stateOf, mark: mark, start: start };
})();
