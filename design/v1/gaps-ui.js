/* PRD gap closure, live in the prototype shell. Each screen reads and writes the module's own
   arrays, so the other screens see the change.
   FR-CA1  calendars: several per household, four scopes, create / edit / delete, the member list
           of a member_shared calendar. A personal calendar is a private root (D-44): 404 to others.
   FR-FI16 the two-level category tree, editable, with re-homing of rows on delete.
   FR-FI20 member-authored rules: if the description contains X, set category Y — and apply to history.
   FR-FI2  the income period: month, fortnight or week, from the next period on.
   FR-GA9  the photo journal per container: dated entries, add and remove.
   FR-PE8  pet costs per year: food, insurance, vet, other — with the optional hand-off to Finance.
   FR-TA1  archived boards: the list, and putting one back. */
(function () {
  var ST = { cals: null, journal: {}, petCosts: null, foodMonthly: { bela: 1290, mour: 640, kiki: 210 }, sent: {} };
  var CHART = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"];

  function view(self, seg, query, hash, wide) {
    var a0 = seg[0] || "", path = "/" + seg.join("/");
    var K = window.HH_KIT(self);
    if (path === "/calendar/calendars" || (a0 === "calendar" && seg[1] === "calendars" && seg[2])) return calendars(self, K, seg);
    if (path === "/finance/categories") return categories(self, K);
    if (path === "/finance/rules") return rules(self, K);
    if (path === "/finance/income-period") return incomePeriod(self, K);
    if (a0 === "garden" && seg[1] === "containers" && seg[2] && seg[3] === "journal") return journal(self, K, seg[2]);
    if (a0 === "pets" && seg[1] && seg[2] === "costs") return petCosts(self, K, seg[1]);
    if (path === "/tasks/archived") return archived(self, K);
    return null;
  }

  var tick = function (K) { K.put({ gx_tick: Date.now() }, { docToast: null }); };
  var sheetOf = function (K, s) { var sh = K.get("gx_sheet", null); return sh && sh.at === s.route ? sh : null; };
  var openSheet = function (K, s, p) { return function () { K.put({ gx_sheet: Object.assign({ at: s.route }, p) }); }; };
  var closeSheet = function (K) { K.put({ gx_sheet: null }); };
  var patchSheet = function (K, p) { K.put({ gx_sheet: Object.assign({}, K.get("gx_sheet", {}), p) }); };
  var gone = function (K, back) {
    return K.page({ title: K.L("Not here", "Tady nic není"), back: back,
      blocks: [K.empty(K.L("There\u2019s nothing at this address", "Na t\u00e9to adrese nic nen\u00ed"), K.L("It may have been moved or deleted.", "Mo\u017en\u00e1 to n\u011bkdo p\u0159esunul nebo smazal."), K.L("Back", "Zp\u011bt"), K.go(back))] });
  };
  var memberGrant = function (id, mod) {
    var N = window.HH_NAV; if (!N) return "none";
    var n = N.navFor(id, "hh-tilcer"); return n && n.belongs ? ((n.grants || {})[mod] || "none") : "none";
  };
  var inkVar = function (c) { return "var(--" + c + ")"; };

  /* ═══ FR-CA1 · calendars ═══ */
  function seedCals(K) {
    if (ST.cals) return ST.cals;
    var C = window.HH_CALENDAR, F = K.F;
    var holders = F.members.filter(function (m) { return memberGrant(m.id, "calendar") !== "none"; });
    var pair = holders.slice(0, 2);
    var ser = (C && C.series) || [];
    ST.cals = [
      { id: "cal-household", name: "Tilcerovi", colour: "chart-1", owner: "jana", scope: "household", dflt: true, events: ser.filter(function (x) { return x.visibility !== "private"; }).length }
    ];
    if (pair.length === 2) ST.cals.push({ id: "cal-shared", name: pair[0].name + " a " + pair[1].name, colour: "chart-5", owner: pair[0].id, scope: "member_shared", members: pair.map(function (m) { return m.id; }), events: 3 });
    ST.cals = ST.cals.concat([
      { id: "cal-jana", name: "Jana \u2014 osobn\u00ed", colour: "chart-2", owner: "jana", scope: "personal", events: ser.filter(function (x) { return x.visibility === "private" && x.author === "jana"; }).length || 2 },
      { id: "cal-adam", name: "Adam \u2014 moje", colour: "chart-4", owner: "adam", scope: "personal", events: 1 }
    ]);
    ((C && C.connections) || []).forEach(function (cn) {
      (cn.calendars || []).forEach(function (rc) {
        if (rc.direction === "off") return;
        ST.cals.push({ id: rc.id, name: rc.name, colour: C.memberColour ? (C.memberColour[cn.member] || "chart-3") : "chart-3", owner: cn.member, scope: "external",
          provider: cn.provider, direction: rc.direction, detail: rc.scope, events: rc.mirrored || 0, conn: cn.id });
      });
    });
    return ST.cals;
  }
  function calendars(self, K, seg) {
    var s = self.state, L = K.L, me = s.member;
    var lvl = (K.nav.grants || {}).calendar || "none";
    if (lvl === "none") return null;
    var canM = K.at("calendar", "manage") && !K.ro, canC = K.at("calendar", "contribute") && !K.ro;
    var child = (K.memberOf(me) || {}).role === "child";
    var all = seedCals(K);
    var sees = function (c) {
      if (c.scope === "personal") return c.owner === me;
      if (c.scope === "member_shared") return (c.members || []).indexOf(me) >= 0 || c.owner === me;
      return true;
    };
    var mine = all.filter(sees);
    var scopeWord = function (c) {
      return c.scope === "household" ? L("Everyone with Calendar", "V\u0161ichni s Kalend\u00e1\u0159em")
        : c.scope === "personal" ? L("Only you", "Jen vy")
        : c.scope === "member_shared" ? (c.members || []).map(K.nameOf).join(", ")
        : (c.owner === me ? L("Yours", "Va\u0161e") : K.nameOf(c.owner) + L("\u2019s", "")) + " \u00b7 " + (c.provider === "ics" ? L("address", "adresa") : c.provider) + " \u00b7 " +
          (c.direction === "both" ? L("two-way", "oboustrann\u011b") : L("read-only", "jen \u010dten\u00ed")) + (c.detail === "busy" ? L(" \u00b7 busy only", " \u00b7 jen obsazeno") : "");
    };
    var canEdit = function (c) {
      if (K.ro || c.scope === "external") return false;
      if (c.scope === "personal") return c.owner === me;
      if (c.scope === "member_shared") return canM || c.owner === me;
      return canM;
    };
    var sh = sheetOf(K, s);
    var P = { title: L("Calendars", "Kalend\u00e1\u0159e"), sub: mine.length + L(" you can see", " vid\u00edte"), back: "/calendar", blocks: [] };
    var push = function (b) { if (b) P.blocks.push(b); };
    var calRow = function (c) {
      return K.row({ dot: true, dotInk: inkVar(c.colour), title: c.name, sub: scopeWord(c), right: String(c.events), rightSub: L("events", "ud\u00e1lost\u00ed"),
        badge: c.dflt ? L("default", "v\u00fdchoz\u00ed") : c.scope === "personal" ? L("private", "soukrom\u00fd") : "", open: K.go("/calendar/calendars/" + c.id) });
    };
    var draftFor = function (c) {
      return { kind: "cal", id: c ? c.id : null, name: c ? c.name : "", colour: c ? c.colour : "chart-3", scope: c ? c.scope : (canM ? "household" : "personal"),
        members: c && c.members ? c.members.slice() : [me], err: "" };
    };
    var holders = K.F.members.filter(function (m) { return memberGrant(m.id, "calendar") !== "none"; });

    if (seg[2]) {
      var c = all.filter(function (x) { return x.id === seg[2]; })[0];
      if (!c || !sees(c)) return gone(K, "/calendar/calendars");
      P.title = c.name; P.sub = scopeWord(c); P.back = "/calendar/calendars";
      push(K.hero({ kicker: c.scope === "household" ? L("Household calendar", "Kalend\u00e1\u0159 dom\u00e1cnosti") : c.scope === "personal" ? L("Personal calendar", "Osobn\u00ed kalend\u00e1\u0159") : c.scope === "member_shared" ? L("Shared with some of you", "Sd\u00edlen\u00fd s n\u011bkter\u00fdmi") : L("Mirrored calendar", "Zrcadlen\u00fd kalend\u00e1\u0159"),
        big: c.name, sub: c.events + L(" events", " ud\u00e1lost\u00ed"), small: true }));
      push(K.kv([[L("Owner", "Vlastn\u00edk"), K.nameOf(c.owner)], [L("Colour", "Barva"), c.colour.replace("chart-", L("Colour ", "Barva "))],
        [L("Who sees it", "Kdo ho vid\u00ed"), c.scope === "personal" ? L("Only " + K.nameOf(c.owner) + ". Nobody else learns it exists.", "Jen " + K.nameOf(c.owner) + ". Nikdo jin\u00fd nev\u00ed, \u017ee existuje.") : scopeWord(c)],
        [L("Who adds to it", "Kdo do n\u011bj p\u00ed\u0161e"), c.scope === "household" ? L("Anyone who can add and edit in Calendar", "Kdo m\u016f\u017ee v Kalend\u00e1\u0159i p\u0159id\u00e1vat") : c.scope === "external" ? (c.direction === "both" ? L("Both sides", "Ob\u011b strany") : L("Only the other side", "Jen druh\u00e1 strana")) : c.scope === "personal" ? K.nameOf(c.owner) : L("The people on it", "Lid\u00e9 v n\u011bm")]]));
      if (c.scope === "member_shared") {
        push(K.label(L("People on it", "Kdo v n\u011bm je"), canEdit(c) ? L("Change", "Zm\u011bnit") : "", openSheet(K, s, draftFor(c))));
        push(K.rows(c.members.map(function (id) { return K.row({ title: K.nameOf(id), sub: id === c.owner ? L("owner of this calendar", "vlastn\u00edk kalend\u00e1\u0159e") : "" }); })));
        push(K.note(L("Its events reach only these people, on every device, offline too. Adding someone gives them the whole calendar, not just what comes next.", "Ud\u00e1losti dostanou jen tito lid\u00e9, i offline. Kdo p\u0159ibude, uvid\u00ed cel\u00fd kalend\u00e1\u0159, ne jen to, co p\u0159ijde."), "muted"));
      }
      if (c.scope === "external") push(K.note(L("Settings for a mirrored calendar live on its connection.", "Nastaven\u00ed zrcadlen\u00e9ho kalend\u00e1\u0159e je u jeho p\u0159ipojen\u00ed."), "box", c.owner === me ? L("Open the connection", "Otev\u0159\u00edt p\u0159ipojen\u00ed") : "", K.go("/calendar/connections/" + c.conn)));
      var delOK = canEdit(c) && !c.dflt && (c.scope === "personal" ? c.owner === me : canM);
      push(K.acts([canEdit(c) ? K.btn(L("Edit", "Upravit"), "", openSheet(K, s, draftFor(c))) : null,
        delOK ? K.btn(L("Delete calendar", "Smazat kalend\u00e1\u0159"), "danger-ghost", openSheet(K, s, { kind: "calDel", id: c.id })) : null]));
      if (c.dflt) push(K.note(L("The household calendar is where events go when nobody picks another. It can be renamed, not deleted.", "Kalend\u00e1\u0159 dom\u00e1cnosti je tam, kam jdou ud\u00e1losti, kdy\u017e nikdo nevybere jin\u00fd. Jde p\u0159ejmenovat, ne smazat."), "muted"));
    } else {
      var groups = [["household", L("For the household", "Pro dom\u00e1cnost")], ["member_shared", L("Shared with some of you", "Pro n\u011bkoho z v\u00e1s")], ["personal", L("Just yours", "Jen va\u0161e")], ["external", L("From other calendars", "Z jin\u00fdch kalend\u00e1\u0159\u016f")]];
      groups.forEach(function (g) {
        var r = mine.filter(function (c) { return c.scope === g[0]; });
        if (!r.length) return;
        push(K.label(g[1])); push(K.rows(r.map(calRow)));
      });
      push(K.note(L("A personal calendar is private: nobody else sees it, and it doesn\u2019t appear in their lists or counts. On shared views its events show only as Busy.", "Osobn\u00ed kalend\u00e1\u0159 je soukrom\u00fd: nikdo jin\u00fd ho nevid\u00ed ani v seznamech a po\u010dtech. Ve sd\u00edlen\u00fdch pohledech se jeho ud\u00e1losti uk\u00e1\u017eou jen jako Obsazeno."), "muted"));
      P.foot = canC || !child ? [K.btn(L("New calendar", "Nov\u00fd kalend\u00e1\u0159"), "primary", openSheet(K, s, draftFor(null)), K.ro)] : [];
    }

    if (sh && sh.kind === "cal") {
      var isNew = !sh.id, B = [];
      B.push(K.field({ label: L("Name", "N\u00e1zev"), value: sh.name, placeholder: L("e.g. School", "nap\u0159. \u0160kola"), err: sh.err, set: function (v) { patchSheet(K, { name: v, err: "" }); } }));
      B.push(K.chips(L("Colour", "Barva"), CHART.map(function (c, i) { return K.chip(L("Colour ", "Barva ") + (i + 1), sh.colour === c, function () { patchSheet(K, { colour: c }); }); }), L("The name is always shown beside the colour.", "Vedle barvy je v\u017edy vid\u011bt n\u00e1zev.")));
      if (isNew) {
        B.push(K.chips(L("Who sees it", "Kdo ho uvid\u00ed"), [
          canM ? K.chip(L("Everyone with Calendar", "V\u0161ichni s Kalend\u00e1\u0159em"), sh.scope === "household", function () { patchSheet(K, { scope: "household" }); }) : null,
          canM ? K.chip(L("Some of us", "N\u011bkdo z n\u00e1s"), sh.scope === "member_shared", function () { patchSheet(K, { scope: "member_shared" }); }) : null,
          K.chip(L("Only me", "Jen j\u00e1"), sh.scope === "personal", function () { patchSheet(K, { scope: "personal" }); })
        ], canM ? "" : L("A calendar for everyone needs \u201cCan set it up\u201d on Calendar. A personal one is always yours to make.", "Kalend\u00e1\u0159 pro v\u0161echny vy\u017eaduje \u201eM\u016f\u017ee nastavovat\u201c. Osobn\u00ed si m\u016f\u017eete zalo\u017eit v\u017edy.")));
      }
      if (sh.scope === "member_shared") {
        B.push(K.chips(L("People on it", "Kdo v n\u011bm bude"), holders.map(function (m) {
          var on = sh.members.indexOf(m.id) >= 0;
          return K.chip(m.name, on, function () { var ms = sh.members.slice(); if (on) ms.splice(ms.indexOf(m.id), 1); else ms.push(m.id); patchSheet(K, { members: ms }); });
        }), L("Only people who have Calendar can be on it.", "Jen lid\u00e9, kte\u0159\u00ed maj\u00ed Kalend\u00e1\u0159.")));
      }
      var save = function () {
        var nm = (sh.name || "").trim();
        if (!nm) { patchSheet(K, { err: L("Give it a name.", "Dejte mu n\u00e1zev.") }); return; }
        if (sh.scope === "member_shared" && sh.members.length < 2) { patchSheet(K, { err: L("A shared calendar needs at least two people.", "Sd\u00edlen\u00fd kalend\u00e1\u0159 pot\u0159ebuje aspo\u0148 dva lidi.") }); return; }
        if (isNew) {
          var id = "cal-" + Date.now().toString(36);
          all.push({ id: id, name: nm, colour: sh.colour, owner: me, scope: sh.scope, members: sh.scope === "member_shared" ? sh.members.slice() : null, events: 0 });
          K.put({ gx_sheet: null }); self.go("/calendar/calendars/" + id);
          K.toast(L(nm + " created", nm + " zalo\u017een"));
        } else {
          var c0 = all.filter(function (x) { return x.id === sh.id; })[0], prev = Object.assign({}, c0);
          c0.name = nm; c0.colour = sh.colour; if (c0.scope === "member_shared") c0.members = sh.members.slice();
          closeSheet(K);
          K.toast(L("Saved", "Ulo\u017eeno"), function () { Object.assign(c0, prev); tick(K); });
        }
      };
      P.sheet = { title: isNew ? L("New calendar", "Nov\u00fd kalend\u00e1\u0159") : L("Edit calendar", "Upravit kalend\u00e1\u0159"), blocks: B,
        foot: [K.btn(L("Cancel", "Zru\u0161it"), "", function () { closeSheet(K); }), K.btn(isNew ? L("Create", "Zalo\u017eit") : L("Save", "Ulo\u017eit"), "primary", save)] };
    }
    if (sh && sh.kind === "calDel") {
      var cd = all.filter(function (x) { return x.id === sh.id; })[0];
      if (cd) P.sheet = { title: L("Delete \u201c" + cd.name + "\u201d?", "Smazat \u201e" + cd.name + "\u201c?"),
        blocks: [K.note(cd.events ? L("Its " + cd.events + " events are deleted with it, for everyone who could see them.", "Spolu s n\u00edm zmiz\u00ed jeho ud\u00e1losti (" + cd.events + ") pro v\u0161echny, kdo je vid\u011bli.") : L("It has no events.", "Nem\u00e1 \u017e\u00e1dn\u00e9 ud\u00e1losti."), "boxDanger")],
        foot: [K.btn(L("Keep it", "Nechat"), "", function () { closeSheet(K); }), K.btn(L("Delete", "Smazat"), "danger", function () {
          var at = all.indexOf(cd); all.splice(at, 1); K.put({ gx_sheet: null }); self.go("/calendar/calendars");
          K.toast(L(cd.name + " deleted", cd.name + " smaz\u00e1n"), function () { all.splice(at, 0, cd); tick(K); });
        })] };
    }
    P.onCloseSheet = function () { closeSheet(K); };
    return K.page(P);
  }

  /* ═══ Finance: shared nav ═══ */
  function finNav(K, on) {
    var L = K.L;
    return [K.label(L("Finance", "Finance")), K.rows([
      K.row({ title: L("Overview", "P\u0159ehled"), open: K.go("/finance") }),
      K.row({ title: L("Categories", "Kategorie"), on: on === "cat", open: K.go("/finance/categories") }),
      K.row({ title: L("Category rules", "Pravidla kategori\u00ed"), on: on === "rules", open: K.go("/finance/rules") }),
      K.row({ title: L("Income period", "Obdob\u00ed p\u0159\u00edjmu"), on: on === "period", open: K.go("/finance/income-period") }),
      K.row({ title: L("Transactions", "Transakce"), open: K.go("/finance/ledger") })
    ])];
  }
  var finGate = function (K) { return (K.nav.grants || {}).finance && K.nav.grants.finance !== "none" && window.HH_FINANCE; };
  var usesOf = function (F, id) {
    var n = 0;
    (F.transactions || []).forEach(function (t) { if (t.category === id) n++; });
    (F.expenses || []).forEach(function (t) { if (t.category === id) n++; });
    return n;
  };

  /* ═══ FR-FI16 · categories ═══ */
  function categories(self, K) {
    if (!finGate(K)) return null;
    var F = window.HH_FINANCE, s = self.state, L = K.L, canM = K.at("finance", "manage") && !K.ro;
    var cats = F.categories, tops = cats.filter(function (c) { return !c.parent; });
    var kids = function (id) { return cats.filter(function (c) { return c.parent === id; }); };
    var sh = sheetOf(K, s);
    var P = { title: L("Categories", "Kategorie"), sub: tops.length + L(" groups \u00b7 ", " skupin \u00b7 ") + (cats.length - tops.length) + L(" categories", " kategori\u00ed"), back: "/finance", nav: finNav(K, "cat"), blocks: [] };
    var push = function (b) { if (b) P.blocks.push(b); };
    var draft = function (c, parent) { return { kind: "cat", id: c ? c.id : null, name: c ? c.name : "", parent: c ? c.parent : (parent || null), kindOf: c ? c.kind : "expense", err: "" }; };
    ["expense", "income"].forEach(function (kd) {
      var t = tops.filter(function (c) { return (c.kind || "expense") === kd; });
      if (!t.length && kd === "income") return;
      push(K.label(kd === "expense" ? L("Spending", "V\u00fddaje") : L("Income", "P\u0159\u00edjmy"), canM ? L("+ Group", "+ Skupina") : "", openSheet(K, s, Object.assign(draft(null, null), { kindOf: kd }))));
      t.forEach(function (top) {
        var ks = kids(top.id);
        push(K.rows([K.row({ dot: true, dotInk: inkVar(top.colour || "chart-1"), title: top.name, strong: true, sub: ks.length + L(" categories", " kategori\u00ed") + " \u00b7 " + usesOf(F, top.id) + L(" rows directly", " \u0159\u00e1dk\u016f p\u0159\u00edmo"),
          open: canM ? openSheet(K, s, draft(top)) : null, act: canM ? L("+ Add", "+ P\u0159idat") : "", onAct: canM ? openSheet(K, s, draft(null, top.id)) : null })].concat(ks.map(function (c) {
          return K.row({ lead: "\u2003", title: c.name, sub: usesOf(F, c.id) + L(" rows", " \u0159\u00e1dk\u016f"), open: canM ? openSheet(K, s, draft(c)) : null, noChev: !canM });
        }))));
      });
    });
    push(K.note(L("Two levels: a group and its categories. Budgets and reports can use either. The starting set was translated from the household\u2019s language; every name here can change.", "Dv\u011b \u00farovn\u011b: skupina a jej\u00ed kategorie. Rozpo\u010dty i p\u0159ehledy mohou pou\u017e\u00edt kteroukoli. V\u00fdchoz\u00ed sada je p\u0159elo\u017een\u00e1 a ka\u017ed\u00fd n\u00e1zev jde zm\u011bnit."), "muted"));
    if (!canM) push(K.note(L("Changing categories needs \u201cCan set it up\u201d on Finance.", "Zm\u011bna kategori\u00ed vy\u017eaduje \u201eM\u016f\u017ee nastavovat\u201c."), "muted"));

    if (sh && sh.kind === "cat") {
      var isNew = !sh.id, cur = isNew ? null : cats.filter(function (c) { return c.id === sh.id; })[0];
      var hasKids = cur && kids(cur.id).length > 0;
      var B = [K.field({ label: L("Name", "N\u00e1zev"), value: sh.name, err: sh.err, set: function (v) { patchSheet(K, { name: v, err: "" }); } })];
      if (!hasKids) B.push(K.chips(L("Belongs to", "Pat\u0159\u00ed pod"), [K.chip(L("Nothing \u2014 it\u2019s a group", "Nic \u2014 je to skupina"), !sh.parent, function () { patchSheet(K, { parent: null }); })].concat(
        tops.filter(function (t) { return t.id !== sh.id && (t.kind || "expense") === sh.kindOf; }).map(function (t) { return K.chip(t.name, sh.parent === t.id, function () { patchSheet(K, { parent: t.id }); }); }))));
      else B.push(K.note(L("A group with categories in it stays a group.", "Skupina, kter\u00e1 m\u00e1 kategorie, z\u016fst\u00e1v\u00e1 skupinou."), "muted"));
      var foot = [K.btn(L("Cancel", "Zru\u0161it"), "", function () { closeSheet(K); })];
      if (cur) foot.push(K.btn(L("Delete", "Smazat"), "danger-ghost", function () { patchSheet(K, { kind: "catDel", to: null }); }));
      foot.push(K.btn(isNew ? L("Add", "P\u0159idat") : L("Save", "Ulo\u017eit"), "primary", function () {
        var nm = (sh.name || "").trim();
        if (!nm) { patchSheet(K, { err: L("Give it a name.", "Dejte j\u00ed n\u00e1zev.") }); return; }
        if (cats.some(function (c) { return c.id !== sh.id && c.parent === sh.parent && c.name.toLowerCase() === nm.toLowerCase(); })) { patchSheet(K, { err: L("There\u2019s already one called that here.", "Tak u\u017e se tu jedna jmenuje.") }); return; }
        if (isNew) {
          var par = sh.parent ? cats.filter(function (c) { return c.id === sh.parent; })[0] : null;
          var nc = { id: "c-" + Date.now().toString(36), name: nm, parent: sh.parent, kind: sh.kindOf, colour: par ? par.colour : CHART[tops.length % 5] };
          cats.push(nc); closeSheet(K); K.toast(L(nm + " added", nm + " p\u0159id\u00e1na"), function () { cats.splice(cats.indexOf(nc), 1); tick(K); });
        } else {
          var prev = { name: cur.name, parent: cur.parent };
          cur.name = nm; cur.parent = sh.parent; closeSheet(K); K.toast(L("Saved", "Ulo\u017eeno"), function () { cur.name = prev.name; cur.parent = prev.parent; tick(K); });
        }
      }));
      P.sheet = { title: isNew ? (sh.parent ? L("New category", "Nov\u00e1 kategorie") : L("New group", "Nov\u00e1 skupina")) : L("Edit \u201c" + cur.name + "\u201d", "Upravit \u201e" + cur.name + "\u201c"), blocks: B, foot: foot };
    }
    if (sh && sh.kind === "catDel") {
      var cd = cats.filter(function (c) { return c.id === sh.id; })[0];
      if (cd) {
        var ks2 = kids(cd.id), rowsN = usesOf(F, cd.id) + ks2.reduce(function (n, k) { return n + usesOf(F, k.id); }, 0);
        var targets = cats.filter(function (c) { return c.id !== cd.id && c.parent !== cd.id && (c.kind || "expense") === (cd.kind || "expense"); });
        var B2 = [K.note(rowsN ? L(rowsN + " rows use " + (ks2.length ? "this group or its categories" : "it") + ". Nothing is deleted with it \u2014 pick where they move.", rowsN + " \u0159\u00e1dk\u016f ji pou\u017e\u00edv\u00e1. Nic se nesma\u017ee \u2014 vyberte, kam se p\u0159esunou.")
          : L("No rows use it.", "\u017d\u00e1dn\u00fd \u0159\u00e1dek ji nepou\u017e\u00edv\u00e1."), rowsN ? "boxWarn" : "box")];
        if (ks2.length) B2.push(K.note(L("Its " + ks2.length + " categories go with it.", "Spolu s n\u00ed zmiz\u00ed jej\u00ed kategorie (" + ks2.length + ")."), "muted"));
        if (rowsN) B2.push(K.chips(L("Move them to", "P\u0159esunout do"), targets.map(function (t) { return K.chip(t.name, sh.to === t.id, function () { patchSheet(K, { to: t.id }); }); })));
        P.sheet = { title: L("Delete \u201c" + cd.name + "\u201d?", "Smazat \u201e" + cd.name + "\u201c?"), blocks: B2,
          foot: [K.btn(L("Keep it", "Nechat"), "", function () { closeSheet(K); }), K.btn(L("Delete", "Smazat"), "danger", function () {
            var gone_ = [cd].concat(ks2), ids = gone_.map(function (c) { return c.id; }), moved = [];
            [].concat(F.transactions || [], F.expenses || []).forEach(function (t) { if (ids.indexOf(t.category) >= 0) { moved.push([t, t.category]); t.category = sh.to; } });
            gone_.forEach(function (c) { cats.splice(cats.indexOf(c), 1); });
            closeSheet(K);
            K.toast(L(cd.name + " deleted" + (moved.length ? " \u00b7 " + moved.length + " rows moved" : ""), cd.name + " smaz\u00e1na"), function () { gone_.forEach(function (c) { cats.push(c); }); moved.forEach(function (m) { m[0].category = m[1]; }); tick(K); });
          }, rowsN > 0 && !sh.to)] };
      }
    }
    P.onCloseSheet = function () { closeSheet(K); };
    return K.page(P);
  }

  /* ═══ FR-FI20 · rules ═══ */
  function rules(self, K) {
    if (!finGate(K)) return null;
    var F = window.HH_FINANCE, s = self.state, L = K.L, canC = K.at("finance", "contribute") && !K.ro;
    var R = F.importRules, tx = F.transactions || [];
    var catName = function (id) { var c = F.categories.filter(function (x) { return x.id === id; })[0]; return c ? c.name : L("no category", "bez kategorie"); };
    var hits = function (r) { var q = (r.contains || "").toUpperCase(); return q ? tx.filter(function (t) { return (t.desc + " " + (t.counter || "")).toUpperCase().indexOf(q) >= 0; }) : []; };
    var sh = sheetOf(K, s);
    var P = { title: L("Category rules", "Pravidla kategori\u00ed"), sub: R.length + L(" rules", " pravidel"), back: "/finance", nav: finNav(K, "rules"), blocks: [] };
    var push = function (b) { if (b) P.blocks.push(b); };
    push(K.note(L("A rule sets the category on imported and new rows whose description contains the words. The first matching rule wins, top to bottom. A category you set by hand is never overwritten.", "Pravidlo nastav\u00ed kategorii na\u010dten\u00fdm a nov\u00fdm \u0159\u00e1dk\u016fm, jejich\u017e popis obsahuje dan\u00e1 slova. Plat\u00ed prvn\u00ed shoda shora. Kategorii nastavenou ru\u010dn\u011b pravidlo nep\u0159ep\u00ed\u0161e."), "muted"));
    push(R.length ? K.rows(R.map(function (r, i) {
      var h = hits(r), off = h.filter(function (t) { return t.category !== r.category; }).length;
      return K.row({ lead: String(i + 1), title: L("Contains \u201c", "Obsahuje \u201e") + r.contains + L("\u201d \u2192 ", "\u201c \u2192 ") + catName(r.category),
        sub: h.length + L(" rows match", " \u0159\u00e1dk\u016f odpov\u00edd\u00e1") + (off ? L(" \u00b7 " + off + " in another category", " \u00b7 " + off + " v jin\u00e9 kategorii") : "") + " \u00b7 " + K.nameOf(r.by),
        open: canC ? openSheet(K, s, { kind: "rule", id: r.id, contains: r.contains, category: r.category, err: "" }) : null });
    })) : K.empty(L("No rules yet", "Zat\u00edm \u017e\u00e1dn\u00e1 pravidla"), L("For example: contains LIDL \u2192 Groceries.", "Nap\u0159\u00edklad: obsahuje LIDL \u2192 Potraviny."), canC ? L("Add a rule", "P\u0159idat pravidlo") : "", openSheet(K, s, { kind: "rule", id: null, contains: "", category: null, err: "" })));
    if (canC) P.foot = [K.btn(L("New rule", "Nov\u00e9 pravidlo"), "primary", openSheet(K, s, { kind: "rule", id: null, contains: "", category: null, err: "" }))];

    if (sh && sh.kind === "rule") {
      var isNew = !sh.id, cur = isNew ? null : R.filter(function (r) { return r.id === sh.id; })[0];
      var probe = hits({ contains: sh.contains }), change = probe.filter(function (t) { return sh.category && t.category !== sh.category; });
      var subs = F.categories.filter(function (c) { return c.parent; });
      var B = [K.field({ label: L("If the description contains", "Kdy\u017e popis obsahuje"), value: sh.contains, placeholder: "LIDL", err: sh.err, hint: L("Not case-sensitive.", "Nez\u00e1le\u017e\u00ed na velikosti p\u00edsmen."), set: function (v) { patchSheet(K, { contains: v, err: "" }); } }),
        K.chips(L("Set the category to", "Nastavit kategorii"), subs.map(function (c) { return K.chip(c.name, sh.category === c.id, function () { patchSheet(K, { category: c.id }); }); }))];
      if ((sh.contains || "").trim()) B.push(K.note(probe.length ? L(probe.length + " rows already here match" + (change.length ? "; " + change.length + " of them are in another category now." : ", and all are in it already.") , probe.length + " \u0159\u00e1dk\u016f u\u017e odpov\u00edd\u00e1" + (change.length ? "; " + change.length + " z nich je te\u010f v jin\u00e9 kategorii." : ".")) : L("Nothing here matches yet. It will apply to the next import.", "Zat\u00edm nic neodpov\u00edd\u00e1. Pou\u017eije se p\u0159i p\u0159\u00ed\u0161t\u00edm na\u010dten\u00ed."), "muted"));
      var saveRule = function (apply) {
        var q = (sh.contains || "").trim();
        if (!q) { patchSheet(K, { err: L("Type the words to look for.", "Napi\u0161te, co hledat.") }); return; }
        if (!sh.category) { patchSheet(K, { err: L("Pick a category.", "Vyberte kategorii.") }); return; }
        var r;
        if (isNew) { r = { id: "ru-" + Date.now().toString(36), contains: q.toUpperCase(), category: sh.category, by: s.member }; R.push(r); }
        else { r = cur; r.contains = q.toUpperCase(); r.category = sh.category; }
        var moved = [];
        if (apply) change.forEach(function (t) { moved.push([t, t.category]); t.category = sh.category; });
        closeSheet(K);
        K.toast(apply && moved.length ? L("Rule saved \u00b7 " + moved.length + " rows re-categorised", "Pravidlo ulo\u017eeno \u00b7 " + moved.length + " \u0159\u00e1dk\u016f p\u0159e\u0159azeno") : L("Rule saved", "Pravidlo ulo\u017eeno"),
          function () { moved.forEach(function (m) { m[0].category = m[1]; }); if (isNew) R.splice(R.indexOf(r), 1); tick(K); });
      };
      var foot = [K.btn(L("Cancel", "Zru\u0161it"), "", function () { closeSheet(K); })];
      if (cur) foot.push(K.btn(L("Delete", "Smazat"), "danger-ghost", function () { var at = R.indexOf(cur); R.splice(at, 1); closeSheet(K); K.toast(L("Rule deleted", "Pravidlo smaz\u00e1no"), function () { R.splice(at, 0, cur); tick(K); }); }));
      foot.push(K.btn(L("Save", "Ulo\u017eit"), change.length ? "" : "primary", function () { saveRule(false); }));
      if (change.length) foot.push(K.btn(L("Save and apply to " + change.length, "Ulo\u017eit a pou\u017e\u00edt na " + change.length), "primary", function () { saveRule(true); }));
      P.sheet = { title: isNew ? L("New rule", "Nov\u00e9 pravidlo") : L("Edit rule", "Upravit pravidlo"), blocks: B, foot: foot,
        footNote: change.length ? L("Applying changes past rows. The log keeps both values.", "Pou\u017eit\u00ed zm\u011bn\u00ed star\u00e9 \u0159\u00e1dky. Historie zm\u011bn zachov\u00e1 ob\u011b hodnoty.") : "" };
    }
    P.onCloseSheet = function () { closeSheet(K); };
    return K.page(P);
  }

  /* ═══ FR-FI2 · income period ═══ */
  function incomePeriod(self, K) {
    if (!finGate(K)) return null;
    var F = window.HH_FINANCE, L = K.L, canM = K.at("finance", "manage") && !K.ro;
    var cur = F.incomePeriod || "month", pend = F.incomePeriodNext || null;
    var OPT = [["month", L("Monthly", "M\u011bs\u00ed\u010dn\u011b"), L("One income entry per earner per month", "Jeden z\u00e1pis p\u0159\u00edjmu na \u010dlov\u011bka za m\u011bs\u00edc")],
      ["fortnight", L("Every two weeks", "Ka\u017ed\u00e9 dva t\u00fddny"), L("For pay that arrives every other Friday", "Pro v\u00fdplatu ka\u017ed\u00fd druh\u00fd p\u00e1tek")],
      ["week", L("Weekly", "T\u00fddn\u011b"), L("For weekly pay", "Pro t\u00fddenn\u00ed v\u00fdplatu")]];
    var word = function (k) { return OPT.filter(function (o) { return o[0] === k; })[0][1]; };
    var P = { title: L("Income period", "Obdob\u00ed p\u0159\u00edjmu"), sub: word(cur), back: "/finance", nav: finNav(K, "period"), blocks: [] };
    var push = function (b) { if (b) P.blocks.push(b); };
    push(K.note(L("The period decides how often income is entered and how often the allocation plan runs. Budgets keep their own period.", "Obdob\u00ed ur\u010duje, jak \u010dasto se zapisuje p\u0159\u00edjem a jak \u010dasto se po\u010d\u00edt\u00e1 rozd\u011blen\u00ed. Rozpo\u010dty maj\u00ed sv\u00e9 vlastn\u00ed obdob\u00ed."), "muted"));
    push(K.rows(OPT.map(function (o) {
      var on = (pend || cur) === o[0];
      return K.row({ lead: on ? "\u25c9" : "\u25cb", title: o[1], sub: o[2], on: on, noChev: true,
        badge: o[0] === cur ? L("now", "te\u010f") : o[0] === pend ? L("from 1 Oct", "od 1. 10.") : "",
        open: canM ? function () {
          var was = F.incomePeriodNext; F.incomePeriodNext = o[0] === cur ? null : o[0]; tick(K);
          if (o[0] !== cur) K.toast(L(o[1] + " from 1 October", o[1] + " od 1. \u0159\u00edjna"), function () { F.incomePeriodNext = was; tick(K); });
        } : null });
    })));
    if (pend) push(K.note(L("Starts with the next period, on 1 October 2026. September and everything before it stay months, with the numbers they have now.", "Za\u010dne dal\u0161\u00edm obdob\u00edm, 1. \u0159\u00edjna 2026. Z\u00e1\u0159\u00ed a v\u0161e p\u0159ed n\u00edm z\u016fstane po m\u011bs\u00edc\u00edch, se stejn\u00fdmi \u010d\u00edsly."), "boxOk"));
    push(K.note(L("A fixed amount in the plan is per period, so 12 000 Kč a month becomes 12 000 Kč a fortnight unless you change it. Percentages carry over as they are.", "Pevn\u00e1 \u010d\u00e1stka v pl\u00e1nu plat\u00ed za obdob\u00ed, tak\u017ee z 12 000 K\u010d m\u011bs\u00ed\u010dn\u011b se stane 12 000 K\u010d za dva t\u00fddny, pokud ji nezm\u011bn\u00edte. Procenta z\u016fst\u00e1vaj\u00ed."), pend ? "boxWarn" : "muted", pend ? L("Open the plan", "Otev\u0159\u00edt pl\u00e1n") : "", K.go("/finance/allocation")));
    if (!canM) push(K.note(L("Changing the period needs \u201cCan set it up\u201d on Finance.", "Zm\u011bna obdob\u00ed vy\u017eaduje \u201eM\u016f\u017ee nastavovat\u201c."), "muted"));
    return K.page(P);
  }

  /* ═══ FR-GA9 · photo journal ═══ */
  function journal(self, K, kid) {
    var G = window.HH_GARDEN, s = self.state, L = K.L;
    if (!G || !(K.nav.grants || {}).garden || K.nav.grants.garden === "none") return null;
    var k = G.containers.filter(function (x) { return x.id === kid; })[0];
    if (!k) return gone(K, "/garden");
    var canC = K.at("garden", "contribute") && !K.ro;
    var plants = G.containerPlants.filter(function (x) { return x.container === k.id; });
    var cropW = function (id) { return G.cropName ? G.cropName(id) : id; };
    var today = G.today || "2026-09-09";
    if (!ST.journal[k.id]) {
      var list = [];
      plants.forEach(function (p) {
        for (var i = 0; i < (p.photos || 0); i++) {
          var d = G.addDays(p.planted, i * 14); if (d > today) break;
          list.push({ id: p.id + "-" + i, date: d, plant: p.id, note: i === 0 ? L("Planted", "Zasazeno") : "", by: i % 2 ? "petr" : "jana" });
        }
      });
      ST.journal[k.id] = list;
    }
    var J = ST.journal[k.id].slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var day = function (iso) { return G.fmtShort ? G.fmtShort(iso) : iso; };
    var sh = sheetOf(K, s);
    var P = { title: L("Photo journal", "Fotoden\u00edk"), sub: k.name, back: "/garden/containers/" + k.id, blocks: [] };
    var push = function (b) { if (b) P.blocks.push(b); };
    if (!k.photo) {
      push(K.empty(L("The journal is off for " + k.name, "Fotoden\u00edk je pro " + k.name + " vypnut\u00fd"), L("A dated photo every week or two shows what a plant is doing better than any note.", "Fotka s datem jednou za t\u00fdden dva uk\u00e1\u017ee v\u00edc ne\u017e pozn\u00e1mka."),
        canC ? L("Turn it on", "Zapnout") : "", function () { k.photo = true; tick(K); }));
      return K.page(P);
    }
    push(K.hero({ kicker: k.where + " \u00b7 " + k.size, big: J.length + L(" photos", " fotek"), sub: J.length ? L("latest ", "posledn\u00ed ") + day(J[0].date) : "", small: true }));
    if (J.length) {
      push(K.cards(J.map(function (e) {
        var p = plants.filter(function (x) { return x.id === e.plant; })[0];
        return { title: day(e.date), sub: (p ? cropW(p.crop) : "") + (e.note ? " \u00b7 " + e.note : ""), meta: L("PHOTO \u00b7 ", "FOTKA \u00b7 ") + K.nameOf(e.by).toUpperCase(),
          pick: openSheet(K, s, { kind: "jview", id: e.id }) };
      })));
    } else push(K.empty(L("No photos yet", "Zat\u00edm \u017e\u00e1dn\u00e9 fotky"), L("The first one is usually the day it was planted.", "Prvn\u00ed b\u00fdv\u00e1 z\u00a0dne, kdy se sadilo."), "", null));
    push(K.note(L("Photos count toward the household\u2019s storage, like any file.", "Fotky se po\u010d\u00edtaj\u00ed do \u00falo\u017ei\u0161t\u011b dom\u00e1cnosti jako ka\u017ed\u00fd soubor."), "muted"));
    if (canC) P.foot = [K.btn(L("Add a photo", "P\u0159idat fotku"), "primary", openSheet(K, s, { kind: "jadd", date: today, plant: plants[0] ? plants[0].id : null, note: "" }))];
    if (sh && sh.kind === "jadd") {
      P.sheet = { title: L("Add a photo", "P\u0159idat fotku"), sub: k.name, blocks: [
        K.note(L("On a phone this opens the camera. The prototype records the entry without the picture.", "V telefonu se otev\u0159e fotoapar\u00e1t. Prototyp ulo\u017e\u00ed z\u00e1znam bez obr\u00e1zku."), "box"),
        K.field({ label: L("Date", "Datum"), type: "date", value: sh.date, narrow: true, set: function (v) { patchSheet(K, { date: v }); }, err: sh.date > today ? L("Not in the future.", "Ne do budoucna.") : "" }),
        plants.length > 1 ? K.chips(L("Which plant", "Kter\u00e1 rostlina"), plants.map(function (p) { return K.chip(cropW(p.crop), sh.plant === p.id, function () { patchSheet(K, { plant: p.id }); }); })) : null,
        K.field({ label: L("Note", "Pozn\u00e1mka"), value: sh.note, placeholder: L("First flowers", "Prvn\u00ed kv\u011bty"), set: function (v) { patchSheet(K, { note: v }); } })],
        foot: [K.btn(L("Cancel", "Zru\u0161it"), "", function () { closeSheet(K); }), K.btn(L("Add", "P\u0159idat"), "primary", function () {
          if (sh.date > today) return;
          var e = { id: "j-" + Date.now().toString(36), date: sh.date, plant: sh.plant, note: (sh.note || "").trim(), by: s.member };
          ST.journal[k.id].push(e); closeSheet(K);
          K.toast(L("Photo added", "Fotka p\u0159id\u00e1na"), function () { var a = ST.journal[k.id]; a.splice(a.indexOf(e), 1); tick(K); });
        }, sh.date > today)] };
    }
    if (sh && sh.kind === "jview") {
      var e = ST.journal[k.id].filter(function (x) { return x.id === sh.id; })[0];
      if (e) {
        var p = plants.filter(function (x) { return x.id === e.plant; })[0];
        P.sheet = { title: day(e.date), sub: p ? cropW(p.crop) : "", blocks: [K.kv([[L("Taken", "Po\u0159\u00edzeno"), day(e.date)], [L("By", "Kdo"), K.nameOf(e.by)], [L("Note", "Pozn\u00e1mka"), e.note || "\u2013"],
          [L("Days since planting", "Dn\u016f od zasazen\u00ed"), p ? String(G.diff(p.planted, e.date)) : ""]])],
          foot: [canC ? K.btn(L("Delete", "Smazat"), "danger-ghost", function () { var a = ST.journal[k.id], at = a.indexOf(e); a.splice(at, 1); closeSheet(K); K.toast(L("Photo deleted", "Fotka smaz\u00e1na"), function () { a.splice(at, 0, e); tick(K); }); }) : null,
            K.btn(L("Close", "Zav\u0159\u00edt"), "", function () { closeSheet(K); })].filter(Boolean) };
      }
    }
    P.onCloseSheet = function () { closeSheet(K); };
    return K.page(P);
  }

  /* ═══ FR-PE8 · pet costs ═══ */
  function petCosts(self, K, pid) {
    var A = window.HH_ASSETS, s = self.state, L = K.L;
    if (!A || !(K.nav.grants || {}).pets || K.nav.grants.pets === "none") return null;
    var e = A.entities.filter(function (x) { return x.id === pid && x.module === "pets"; })[0];
    if (!e) return gone(K, "/pets");
    var canC = K.at("pets", "contribute") && !K.ro, finOK = K.at("finance", "contribute") && !K.ro;
    if (!ST.petCosts) ST.petCosts = [
      { id: "pc-1", pet: "bela", date: "2026-04-18", cat: "grooming", what: "St\u0159\u00edh\u00e1n\u00ed \u2014 Psí salon Hafík", amount: 650, by: "jana" },
      { id: "pc-2", pet: "bela", date: "2026-02-03", cat: "other", what: "Nov\u00fd postroj", amount: 890, by: "jana" },
      { id: "pc-3", pet: "mour", date: "2026-05-21", cat: "other", what: "\u0160krabadlo", amount: 1490, by: "jana" },
      { id: "pc-4", pet: "bela", date: "2025-10-11", cat: "grooming", what: "St\u0159\u00edh\u00e1n\u00ed", amount: 600, by: "jana" }
    ];
    var today = A.today || "2026-09-09", Y = +K.get("pc_year", today.slice(0, 4));
    var monthsIn = function (y) { var ty = +today.slice(0, 4); if (y < ty) return 12; if (y > ty) return 0; return +today.slice(5, 7); };
    var since = (e.acquired || "2000-01-01");
    var foodM = ST.foodMonthly[e.id] || 0, months = Math.max(0, monthsIn(Y) - (since.slice(0, 4) == String(Y) ? +since.slice(5, 7) - 1 : 0));
    var inY = function (d) { return d && d.slice(0, 4) === String(Y); };
    var vet = (A.healthOf ? A.healthOf(e.id) : A.health.filter(function (h) { return h.entity === e.id; })).filter(function (h) { return inY(h.date) && h.cost; });
    var pol = (A.insurance || []).filter(function (p) { return p.entity === e.id; })[0];
    var polY = pol && (inY(pol.start) || (pol.start.slice(0, 4) < String(Y) && pol.end.slice(0, 4) >= String(Y))) ? pol.premium : 0;
    var own = ST.petCosts.filter(function (c) { return c.pet === e.id && inY(c.date); });
    var sum = function (a, f) { return a.reduce(function (n, x) { return n + (f ? f(x) : x.amount); }, 0); };
    var lines = [
      { k: "food", label: L("Food", "Krmivo"), v: foodM * months, sub: foodM ? A.czk(foodM) + L(" a month \u00d7 ", " m\u011bs\u00ed\u010dn\u011b \u00d7 ") + months : L("No monthly amount set", "M\u011bs\u00ed\u010dn\u00ed \u010d\u00e1stka nezad\u00e1na") },
      { k: "ins", label: L("Insurance", "Poji\u0161t\u011bn\u00ed"), v: polY, sub: pol ? pol.insurer + L(" \u00b7 a year", " \u00b7 ro\u010dn\u011b") : L("No policy", "Bez pojistky") },
      { k: "vet", label: L("Vet", "Veterin\u00e1\u0159"), v: sum(vet, function (h) { return h.cost; }), sub: vet.length + L(" visits and treatments", " n\u00e1v\u0161t\u011bv a o\u0161et\u0159en\u00ed") },
      { k: "grooming", label: L("Grooming", "\u00dadr\u017eba srsti"), v: sum(own.filter(function (c) { return c.cat === "grooming"; })), sub: "" },
      { k: "other", label: L("Other", "Ostatn\u00ed"), v: sum(own.filter(function (c) { return c.cat === "other"; })), sub: "" }
    ];
    var total = sum(lines, function (l) { return l.v; }), mN = monthsIn(Y) || 12;
    var nm = e[K.cs ? "cs" : "en"] || e.cs;
    var sh = sheetOf(K, s);
    var P = { title: L("What " + nm + " costs", "Co n\u00e1s stoj\u00ed " + nm), sub: String(Y), back: "/pets/" + e.id, blocks: [] };
    var push = function (b) { if (b) P.blocks.push(b); };
    var years = [+today.slice(0, 4), +today.slice(0, 4) - 1];
    push(K.chips("", years.map(function (y) { return K.chip(String(y), y === Y, function () { K.put({ pc_year: y }); }); })));
    push(K.hero({ kicker: Y === +today.slice(0, 4) ? L("So far this year", "Letos zat\u00edm") : String(Y), big: A.czk(total), sub: L("about ", "zhruba ") + A.czk(Math.round(total / mN)) + L(" a month", " m\u011bs\u00ed\u010dn\u011b") }));
    push(K.bars(lines.map(function (l) { return { name: l.label, right: A.czk(l.v), v: l.v, left: l.sub }; })));
    push(K.label(L("Entered here", "Zapsan\u00e9 tady"), canC ? L("+ Add", "+ P\u0159idat") : "", openSheet(K, s, { kind: "pcadd", date: today, cat: "grooming", what: "", amount: "", err: "" })));
    push(own.length ? K.rows(own.map(function (c) {
      var sent = ST.sent[c.id];
      return K.row({ title: c.what, sub: (c.cat === "grooming" ? L("Grooming", "\u00dadr\u017eba srsti") : L("Other", "Ostatn\u00ed")) + " \u00b7 " + c.date.split("-").reverse().join(". ").replace(/^0/, "") + (sent ? L(" \u00b7 in Finance", " \u00b7 ve Financ\u00edch") : ""),
        right: A.czk(c.amount), act: finOK && !sent ? L("To Finance", "Do Financ\u00ed") : "", onAct: finOK && !sent ? function () { ST.sent[c.id] = true; tick(K); K.toast(L("Recorded as an expense in Finance", "Zaps\u00e1no jako v\u00fddaj ve Financ\u00edch"), function () { delete ST.sent[c.id]; tick(K); }); } : null });
    })) : K.note(L("Nothing entered for " + Y + ".", "Za rok " + Y + " nic zapsan\u00e9ho."), "muted"));
    push(K.note(L("Vet costs come from the health record and insurance from the policy, so nothing is typed twice.", "N\u00e1klady na veterin\u00e1\u0159e jsou ze zdravotn\u00edho z\u00e1znamu a poji\u0161t\u011bn\u00ed ze smlouvy, tak\u017ee se nic nezapisuje dvakr\u00e1t."), "muted"));
    if (sh && sh.kind === "pcadd") {
      var amt = parseInt(String(sh.amount).replace(/\s/g, ""), 10);
      P.sheet = { title: L("Add a cost", "P\u0159idat n\u00e1klad"), sub: nm, blocks: [
        K.chips(L("What kind", "Druh"), [K.chip(L("Grooming", "\u00dadr\u017eba srsti"), sh.cat === "grooming", function () { patchSheet(K, { cat: "grooming" }); }), K.chip(L("Other", "Ostatn\u00ed"), sh.cat === "other", function () { patchSheet(K, { cat: "other" }); })],
          L("Vet visits go in the health record. Food is set once as a monthly amount.", "N\u00e1v\u0161t\u011bvy veterin\u00e1\u0159e pat\u0159\u00ed do zdravotn\u00edho z\u00e1znamu. Krmivo se zad\u00e1 jednou m\u011bs\u00ed\u010dn\u011b.")),
        K.field({ label: L("What", "Co"), value: sh.what, err: sh.err, set: function (v) { patchSheet(K, { what: v, err: "" }); } }),
        K.field({ label: L("Amount", "\u010c\u00e1stka"), value: sh.amount, suffix: "K\u010d", narrow: true, set: function (v) { patchSheet(K, { amount: v, err: "" }); } }),
        K.field({ label: L("Date", "Datum"), type: "date", value: sh.date, narrow: true, set: function (v) { patchSheet(K, { date: v }); } })],
        foot: [K.btn(L("Cancel", "Zru\u0161it"), "", function () { closeSheet(K); }), K.btn(L("Add", "P\u0159idat"), "primary", function () {
          if (!(sh.what || "").trim() || !(amt > 0)) { patchSheet(K, { err: L("A name and an amount, please.", "Vypl\u0148te co a \u010d\u00e1stku.") }); return; }
          var c = { id: "pc-" + Date.now().toString(36), pet: e.id, date: sh.date, cat: sh.cat, what: sh.what.trim(), amount: amt, by: s.member };
          ST.petCosts.push(c); closeSheet(K); K.toast(L("Cost added", "N\u00e1klad p\u0159id\u00e1n"), function () { ST.petCosts.splice(ST.petCosts.indexOf(c), 1); tick(K); });
        })] };
    }
    P.onCloseSheet = function () { closeSheet(K); };
    return K.page(P);
  }

  /* ═══ FR-TA1 · archived boards ═══ */
  function archived(self, K) {
    var T = window.HH_TASKS, L = K.L;
    if (!T || !(K.nav.grants || {}).tasks || K.nav.grants.tasks === "none") return null;
    var canM = K.at("tasks", "manage") && !K.ro;
    var arch = T.boards.filter(function (b) { return b.archived; });
    var n = function (b) { return T.cards.filter(function (c) { return c.board === b.id; }).length; };
    var P = { title: L("Archived boards", "Archivovan\u00e9 n\u00e1st\u011bnky"), sub: String(arch.length), back: "/tasks", blocks: [] };
    P.blocks.push(arch.length ? K.rows(arch.map(function (b) {
      return K.row({ title: b.name, sub: n(b) + L(" cards, kept as they were", " karet, beze zm\u011bny"), act: canM ? L("Put back", "Vr\u00e1tit") : "",
        onAct: canM ? function () { b.archived = false; self.setState({ taskBoard: b.id, route: "/tasks/" + b.id }); K.toast(L(b.name + " is back", b.name + " je zp\u011bt")); } : null });
    })) : K.empty(L("Nothing archived", "Nic archivovan\u00e9ho"), L("An archived board keeps its cards and leaves the board list and the Doing widget.", "Archivovan\u00e1 n\u00e1st\u011bnka si nech\u00e1 karty a zmiz\u00ed ze seznamu i z widgetu Rozd\u011blan\u00e9."), L("Back to boards", "Zp\u011bt na n\u00e1st\u011bnky"), K.go("/tasks")));
    return K.page(P);
  }

  window.HH_GAPS_VIEW = view;
})();
