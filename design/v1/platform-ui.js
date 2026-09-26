/* Platform screens, live in the prototype shell.
   Dashboard: add a widget, arrange, the owner's default and adopting it (C-2 … C-10).
   Sync: the conflict inbox, one conflict, refused changes (F-5 … F-7). Navigation: your
   households, arranging modules, opening a link, not available (A-36, F-15 … F-17). The
   cross-cutting three: the search result row, the Add sheet, in-app help (F-2, F-4, F-19).
   Household settings: the notification composer with per-language templates and a test send,
   the delivery log (C-52, C-53), the country, and a child's PIN and graduation. Chat: storage,
   search, attaching, one message, one conversation and the bin (E-40, E-42). */
(function () {
  function view(self, seg, query, hash, wide) {
    var a0 = seg[0] || "", path = "/" + seg.join("/");
    var K = window.HH_KIT(self);
    if (a0 === "dashboard" || (a0 === "home" && /^c-/.test(hash))) return dashboard(self, K, seg, hash);
    if (a0 === "sync") return sync(self, K, seg);
    if (path === "/refused") return sync(self, K, ["sync", "refused"]);
    if (path === "/households" || path === "/more/arrange" || path === "/link" || path === "/unavailable") return navs(self, K, path, query);
    if (path === "/result-row") return redirect(self, K, { route: "/search", query: "porek" });
    if (path === "/add") return redirect(self, K, { route: "/home", sheet: true });
    if (path === "/help") return help(self, K, query);
    if (path === "/screens/d-54") return redirect(self, K, { route: "/garden/print/work?month=2026-09" });
    if (path === "/settings/notifications" || path === "/settings/notifications/log") return notify(self, K, path, query);
    if (a0 === "households" && seg[2] === "settings" && (seg[3] === "country" || (seg[3] === "members" && seg[4] && (seg[5] === "pin" || seg[5] === "graduate")))) return admin(self, K, seg);
    if (a0 === "chat" && seg[1]) return chat(self, K, seg, hash);
    return null;
  }
  function redirect(self, K, patch) {
    var s = self.state;
    if (self._xRedir !== s.route) { self._xRedir = s.route; setTimeout(function () { self._xRedir = null; self.setState(patch); }, 0); }
    return K.page({ title: K.L("Opening\u2026", "Otev\u00edr\u00e1m\u2026"), blocks: [K.note(K.L("Opening\u2026", "Otev\u00edr\u00e1m\u2026"), "muted")] });
  }

  /* ═══ Dashboard ═══ */
  function dashboard(self, K, seg, hash) {
    var D = window.HH_DASHBOARD; if (!D) return null;
    var L = K.L, s = self.state, me = s.member, nav = K.nav;
    if (seg[0] === "home" && hash !== "c-5") return redirect(self, K, { route: "/home" });
    var owner = (K.memberOf(me) || {}).role === "owner", child = !!nav.locked;
    var cat = K.safe(function () { return D.catalogFor(me).entries; }, []);
    var dflt = K.get("db_default", D.layouts.household), all = K.get("db_layout", {});
    var mine = all[me] || (child ? K.get("db_child", D.layouts.child) : dflt);
    var save = function (list) { var o = Object.assign({}, all); o[me] = list; K.put({ db_layout: o }); };
    var W = function (k) { return D.byKey[k] || { title: k, module: "" }; };
    var SZ = { small: L("Small", "Mal\u00fd"), medium: L("Medium", "St\u0159edn\u00ed"), large: L("Large", "Velk\u00fd") };
    var P = { title: "", blocks: [], back: "/home" }, B = P.blocks, push = function (x) { if (x) B.push(x); };
    var a = seg[1] || "";

    if (a === "catalog") {
      var full = hash === "c-10";
      P.title = full ? L("All twenty-four", "V\u0161ech dvacet \u010dty\u0159i") : L("Add a widget", "P\u0159idat widget");
      if (child) { push(K.empty(L("Your Home is set by " + ((K.F.members.filter(function (m) { return m.role === "owner"; })[0] || {}).name || "an owner") + ".", "Tvou plochu nastavuje vlastn\u00edk."), "", L("Back to Home", "Dom\u016f"), K.go("/home"))); return K.page(P); }
      var list = full ? D.widgets : cat.map(function (e) { return e.widget || W(e.key || e); });
      var inL = function (k) { return mine.some(function (e) { return e.key === k && e.visible !== false; }); };
      push(K.chips("", [K.chip(L("Yours to add", "M\u016f\u017eete p\u0159idat") + " \u00b7 " + cat.length, !full, K.go("/dashboard/catalog")), K.chip(L("All twenty-four", "V\u0161ech 24"), full, K.go("/dashboard/catalog#c-10"))]));
      if (full) push(K.note(L("Widgets come from the modules you hold. The ones from modules you can\u2019t see are listed here only so an owner can plan; they can\u2019t be added.", "Widgety pocházej\u00ed z modul\u016f, kter\u00e9 m\u00e1te."), "muted"));
      var mods = []; list.forEach(function (w) { if (mods.indexOf(w.module) < 0) mods.push(w.module); });
      mods.forEach(function (m) {
        push(K.label(K.F.moduleName(m, s.locale)));
        push(K.rows(list.filter(function (w) { return w.module === m; }).map(function (w) {
          var mayAdd = cat.some(function (e) { return (e.key || (e.widget || {}).key) === w.key; });
          var on = inL(w.key);
          return K.row({ title: w.title, sub: w.says, right: SZ[w.size] || w.size, tone: "muted",
            act: !mayAdd ? "" : on ? L("On Home", "Na plo\u0161e") : L("Add", "P\u0159idat"), actOn: on,
            onAct: function () { if (on) save(mine.filter(function (e) { return e.key !== w.key; })); else save(mine.filter(function (e) { return e.key !== w.key; }).concat([{ key: w.key, size: w.size }])); } });
        })));
      });
      push(K.acts([K.btn(L("Arrange Home", "Uspo\u0159\u00e1dat plochu"), "primary", K.go("/dashboard/arrange"))]));
      return K.page(P);
    }

    if (a === "arrange" || a === "default") {
      var isDef = a === "default";
      if (isDef && !owner) { P.title = L("The household default", "V\u00fdchoz\u00ed plocha"); push(K.empty(L("Only owners set the default.", "V\u00fdchoz\u00ed plochu nastavuj\u00ed vlastn\u00edci."), "", L("Arrange yours", "Uspo\u0159\u00e1dat svou"), K.go("/dashboard/arrange"))); return K.page(P); }
      if (child && !isDef) { P.title = L("Arrange", "Uspo\u0159\u00e1dat"); push(K.empty(L("Your Home is set by an owner.", "Tvou plochu nastavuje vlastn\u00edk."), "", L("Back to Home", "Dom\u016f"), K.go("/home"))); return K.page(P); }
      var who = isDef ? K.get("db_target", "household") : "me";
      var cur = isDef ? (who === "child" ? K.get("db_child", D.layouts.child) : dflt) : mine;
      var put = function (list) { if (!isDef) return save(list); if (who === "child") K.put({ db_child: list }); else K.put({ db_default: list, db_defAt: new Date().toISOString().slice(0, 16).replace("T", " ") }); };
      P.title = isDef ? L("The household default", "V\u00fdchoz\u00ed plocha dom\u00e1cnosti") : L("Arrange", "Uspo\u0159\u00e1dat");
      if (isDef) {
        push(K.chips(L("Setting", "Nastavuji"), [K.chip(L("New members start with", "Nov\u00ed \u010dlenov\u00e9 za\u010dnou s"), who === "household", function () { K.put({ db_target: "household" }); }),
          K.chip(L("Adam\u2019s Home (locked)", "Adamova plocha (zam\u010den\u00e1)"), who === "child", function () { K.put({ db_target: "child" }); })]));
        push(K.note(who === "child" ? L("A child\u2019s Home is locked: they see this and can\u2019t rearrange it.", "D\u011btsk\u00e1 plocha je zam\u010den\u00e1.")
          : L("Changing this doesn\u2019t move anybody\u2019s own Home. Members who kept the default are offered the new one once.", "Zm\u011bna nep\u0159euspo\u0159\u00e1d\u00e1 ni\u010d\u00ed plochu. Kdo m\u011bl v\u00fdchoz\u00ed, dostane nab\u00eddku."), "box"));
      }
      push(K.rows(cur.map(function (e, i) {
        var w = W(e.key), vis = e.visible !== false;
        return K.row({ lead: String(i + 1), title: w.title, sub: K.F.moduleName(w.module, s.locale) + " \u00b7 " + (SZ[e.size] || e.size) + (vis ? "" : L(" \u00b7 hidden", " \u00b7 skryt\u00fd")), muted: !vis, noChev: true, on: K.get("db_pick", "") === e.key,
          open: function () { K.put({ db_pick: K.get("db_pick", "") === e.key ? "" : e.key }); } });
      })));
      var pk = K.get("db_pick", ""), pi = cur.map(function (e) { return e.key; }).indexOf(pk);
      if (pi >= 0) {
        var e0 = cur[pi], mv = function (d) { var l = cur.slice(); var x = l.splice(pi, 1)[0]; l.splice(pi + d, 0, x); put(l); };
        push(K.label(W(pk).title));
        push(K.chips(L("Size", "Velikost"), ["small", "medium", "large"].map(function (z) { return K.chip(SZ[z], e0.size === z, function () { put(cur.map(function (x) { return x.key === pk ? Object.assign({}, x, { size: z }) : x; })); }); }),
          L("Small is one cell, medium two, large four on a phone and three on a desktop.", "Mal\u00fd je jedna bu\u0148ka, st\u0159edn\u00ed dv\u011b, velk\u00fd \u010dty\u0159i.")));
        push(K.acts([pi > 0 ? K.btn(L("Move up", "Nahoru"), "", function () { mv(-1); }) : null, pi < cur.length - 1 ? K.btn(L("Move down", "Dol\u016f"), "", function () { mv(1); }) : null,
          K.btn(e0.visible === false ? L("Show", "Zobrazit") : L("Hide", "Skr\u00fdt"), "", function () { put(cur.map(function (x) { return x.key === pk ? Object.assign({}, x, { visible: x.visible === false }) : x; })); }),
          K.btn(L("Remove", "Odebrat"), "danger-ghost", function () { put(cur.filter(function (x) { return x.key !== pk; })); K.put({ db_pick: "" }); })]));
      } else push(K.note(L("Tap a widget to resize, move or hide it. The grid fills in this order and never jumps a later widget forward to fill a gap.", "Klepn\u011bte na widget. M\u0159\u00ed\u017eka se pln\u00ed v tomto po\u0159ad\u00ed."), "muted"));
      push(K.acts([K.btn(L("Add a widget", "P\u0159idat widget"), "", K.go("/dashboard/catalog")),
        !isDef && all[me] ? K.btn(L("Back to the household default", "Zp\u011bt na v\u00fdchoz\u00ed"), "", function () { var o = Object.assign({}, all); delete o[me]; K.put({ db_layout: o }); }) : null,
        !isDef && owner ? K.btn(L("Edit the household default", "Upravit v\u00fdchoz\u00ed"), "", K.go("/dashboard/default")) : null,
        K.btn(L("Done", "Hotovo"), "primary", K.go("/home"))]));
      return K.page(P);
    }

    /* C-5 the default changed */
    P.title = L("The household default changed", "V\u00fdchoz\u00ed plocha se zm\u011bnila");
    var ans = K.get("db_adopt", "");
    push(K.hero({ small: true, kicker: L("Home", "Dom\u016f"), big: L("Jana changed the household\u2019s Home", "Jana zm\u011bnila plochu dom\u00e1cnosti"), sub: L("Yours has been changed by you, so it wasn\u2019t touched. Take the new one, or keep yours.", "Va\u0161i plochu jste upravili, tak\u017ee z\u016fstala. Vezm\u011bte novou, nebo si nechte svou.") }));
    push(K.label(L("The new default", "Nov\u00e1 v\u00fdchoz\u00ed")));
    push(K.rows(dflt.map(function (e, i) { return K.row({ lead: String(i + 1), title: W(e.key).title, right: SZ[e.size] || e.size, tone: "muted" }); })));
    if (ans) push(K.note(ans === "take" ? L("Your Home is now the household default.", "Va\u0161e plocha je nyn\u00ed v\u00fdchoz\u00ed.") : L("Kept yours. You won\u2019t be asked about this change again.", "Ponech\u00e1no."), "boxOk", L("Undo", "Zp\u011bt"), function () { K.put({ db_adopt: "" }); }));
    else push(K.acts([K.btn(L("Use the new one", "Pou\u017e\u00edt novou"), "primary", function () { var o = Object.assign({}, all); delete o[me]; K.put({ db_layout: o, db_adopt: "take" }); }),
      K.btn(L("Keep mine", "Nechat svou"), "", function () { var o = Object.assign({}, all); o[me] = mine; K.put({ db_layout: o, db_adopt: "keep" }); })]));
    return K.page(P);
  }

  /* ═══ Sync ═══ */
  function sync(self, K, seg) {
    var S = window.HH_SYNC; if (!S) return null;
    var L = K.L, res = K.get("sy_res", {}), rej = K.get("sy_rej", {});
    var P = { title: "", blocks: [], back: "/sync" }, B = P.blocks, push = function (x) { if (x) B.push(x); };
    var MOD = { finance: "/finance/ledger", utilities: "/utilities", calendar: "/calendar", notes: "/notes", shopping: "/shopping" };
    var open = S.inbox.filter(function (c) { return !res[c.id]; });
    if (!seg[1]) {
      P.title = L("Conflicts", "Konflikty"); P.back = "/home";
      if (!open.length) push(K.empty(L("Nothing to decide.", "Nen\u00ed co rozhodovat."), L("Everything you and the others changed has been merged.", "V\u0161e je slou\u010deno."), L("Back to Home", "Dom\u016f"), K.go("/home")));
      else {
        push(K.note(L("Only a change two people made to the same amount or date lands here. Nothing ages out; each waits until somebody decides.", "Sem se dostane jen zm\u011bna, kterou dva lid\u00e9 ud\u011blali na stejn\u00e9 \u010d\u00e1stce. Nic nevypr\u0161\u00ed."), "muted"));
        push(K.rows(open.map(function (c) { return K.row({ title: c.title, sub: c.where + " \u00b7 " + K.F.moduleName(c.module, K.s.locale), right: c.mine.value, rightSub: c.theirs.who + ": " + c.theirs.value, open: K.go("/sync/" + c.id) }); })));
      }
      var done = S.inbox.filter(function (c) { return res[c.id]; });
      if (done.length) { push(K.label(L("Decided in this session", "Rozhodnuto"))); push(K.rows(done.map(function (c) { return K.row({ title: c.title, sub: L("kept ", "ponech\u00e1no ") + res[c.id], muted: true, act: L("Undo", "Zp\u011bt"), onAct: function () { var o = Object.assign({}, res); delete o[c.id]; K.put({ sy_res: o }); } }); }))); }
      push(K.acts([K.btn(L("Changes the server refused", "Odm\u00edtnut\u00e9 zm\u011bny") + " \u00b7 " + S.rejections.filter(function (r) { return !rej[r.code]; }).length, "", K.go("/sync/refused"))]));
      return K.page(P);
    }
    if (seg[1] === "refused") {
      P.title = L("Changes the server refused", "Zm\u011bny, kter\u00e9 server odm\u00edtl");
      var left = S.rejections.filter(function (r) { return !rej[r.code]; });
      if (!left.length) push(K.empty(L("Nothing is waiting.", "Nic ne\u010dek\u00e1."), L("Every refused change has been retried, edited or let go.", "V\u0161e bylo vy\u0159e\u0161eno."), "", null));
      left.forEach(function (r) {
        push(K.label(r.where));
        push(K.note(r.copy, "boxWarn"));
        if (r.note) push(K.note(r.note, "muted"));
        push(K.acts((r.actions || []).map(function (act, i) {
          return K.btn(act, i === 0 ? "primary" : /discard|zahodit/i.test(act) ? "danger-ghost" : "", function () {
            var o = Object.assign({}, rej); o[r.code] = act; K.put({ sy_rej: o });
            K.toast(/discard|zahodit/i.test(act) ? L("Let go. It\u2019s in the activity log as not accepted.", "Zahozeno.") : L(act + " \u2014 done", act + " \u2014 hotovo"), function () { var o2 = Object.assign({}, K.get("sy_rej", {})); delete o2[r.code]; K.put({ sy_rej: o2 }); });
          });
        })));
      });
      return K.page(P);
    }
    var c = S.inbox.filter(function (x) { return x.id === seg[1]; })[0]; if (!c) return null;
    P.title = c.title; P.sub = c.where;
    if (res[c.id]) {
      push(K.note(L("Decided: " + res[c.id] + ". Everyone\u2019s copy now says the same, and the activity log keeps both values.", "Rozhodnuto: " + res[c.id] + "."), "boxOk", L("Undo", "Zp\u011bt"), function () { var o = Object.assign({}, res); delete o[c.id]; K.put({ sy_res: o }); }));
      push(K.acts([K.btn(c.route, "", K.go(MOD[c.module] || "/" + c.module)), K.btn(L("Back to conflicts", "Zp\u011bt"), "primary", K.go("/sync"))]));
      return K.page(P);
    }
    push(K.hero({ small: true, kicker: K.F.moduleName(c.module, K.s.locale), big: c.question, sub: "" }));
    var decide = function (v) { var o = Object.assign({}, res); o[c.id] = v; K.put({ sy_res: o }); };
    push(K.rows([K.row({ title: c.mine.value, sub: c.mine.who + " \u00b7 " + c.mine.at, act: L("Keep this", "Ponechat"), onAct: function () { decide(c.mine.value); } }),
      K.row({ title: c.theirs.value, sub: c.theirs.who + " \u00b7 " + c.theirs.at, act: L("Keep this", "Ponechat"), onAct: function () { decide(c.theirs.value); } })]));
    push(K.bound("sy_third_" + c.id, { label: c.third, placeholder: "" }));
    var th = String(K.get("sy_third_" + c.id, "")).trim();
    push(K.acts([K.btn(L("Use this value", "Pou\u017e\u00edt tuto hodnotu"), "", function () { decide(th); }, !th), K.btn(c.route, "", K.go(MOD[c.module] || "/" + c.module))]));
    push(K.note(L("Nothing else in the row changed. Whichever you keep, the other value stays in the activity log with who set it.", "Nic jin\u00e9ho se nezm\u011bnilo. Druh\u00e1 hodnota z\u016fstane v z\u00e1znamu."), "muted"));
    return K.page(P);
  }

  /* ═══ Navigation ═══ */
  function navs(self, K, path, query) {
    var L = K.L, s = self.state, N = window.HH_NAV, F = K.F, me = s.member;
    var P = { title: "", blocks: [], back: "/more" }, B = P.blocks, push = function (x) { if (x) B.push(x); };
    var name = function (m) { return F.moduleName(m, s.locale); };
    if (path === "/households") {
      P.title = L("Your households", "Va\u0161e dom\u00e1cnosti");
      push(K.rows(F.households.map(function (h) {
        var n = N.navFor(me, h.id), on = h.id === s.household;
        return K.row({ title: h.name, sub: n.belongs === false ? L("not a member", "nejste \u010dlenem") : ((n.member || {}).role === "owner" ? L("Owner", "Vlastn\u00edk") : L("Member", "\u010clen")) + " \u00b7 " + (n.granted || []).length + L(" modules", " modul\u016f"),
          on: on, badge: on ? L("open", "otev\u0159en\u00e1") : "", badgeTone: "accent", open: n.belongs === false ? null : function () { self.setState({ household: h.id, route: "/home" }); } });
      })));
      push(K.note(L("Switching changes six things at once: the modules, the grants, Home, Today, search and the activity log. Nothing from one household is visible in another.", "P\u0159epnut\u00ed zm\u011bn\u00ed \u0161est v\u011bc\u00ed najednou."), "muted"));
      push(K.acts([K.btn(L("Start another household", "Zalo\u017eit dal\u0161\u00ed dom\u00e1cnost"), "", K.go("/households/new")), K.btn(L("Join one with a code", "P\u0159ipojit se k\u00f3dem"), "", K.go("/join"))]));
      return K.page(P);
    }
    if (path === "/more/arrange") {
      P.title = L("Arrange your modules", "Uspo\u0159\u00e1dat moduly");
      var nav = K.nav, list = (nav.granted || []).filter(function (m) { return m[0] !== "dashboard"; });
      var order = (K.get("nav_order", {})[me]) || [], hidden = (K.get("nav_hidden", {})[me]) || [];
      var shown = self.navArranged(list), hid = list.filter(function (m) { return hidden.indexOf(m[0]) >= 0; });
      var save = function (o, h) { var a = Object.assign({}, K.get("nav_order", {})); a[me] = o; var b = Object.assign({}, K.get("nav_hidden", {})); b[me] = h; K.put({ nav_order: a, nav_hidden: b }); };
      push(K.note(L("Your order, for you only. It sets the sidebar and the More list; the tab bar keeps its five places.", "Va\u0161e po\u0159ad\u00ed, jen pro v\u00e1s."), "muted"));
      push(K.label(L("In order", "V po\u0159ad\u00ed") + " \u00b7 " + shown.length));
      push(K.rows(shown.map(function (m, i) {
        var keys = shown.map(function (x) { return x[0]; });
        return K.row({ lead: String(i + 1), title: name(m[0]), noChev: true,
          act: i > 0 ? L("Up", "Nahoru") : L("Hide", "Skr\u00fdt"), onAct: function () {
            if (i > 0) { var k = keys.slice(); k.splice(i - 1, 0, k.splice(i, 1)[0]); save(k, hidden); }
            else save(keys, hidden.concat([m[0]]));
          }, open: function () { save(keys, hidden.concat([m[0]])); }, sub: i > 0 ? L("tap to hide", "klepnut\u00edm skr\u00fdt") : "" });
      })));
      push(K.label(L("Hidden", "Skryt\u00e9") + " \u00b7 " + hid.length));
      if (!hid.length) push(K.note(L("Nothing hidden. A hidden module is still yours \u2014 search, Today and reminders keep it.", "Nic skryt\u00e9ho."), "muted"));
      push(K.rows(hid.map(function (m) { return K.row({ title: name(m[0]), muted: true, act: L("Show", "Zobrazit"), onAct: function () { save(order, hidden.filter(function (x) { return x !== m[0]; })); } }); })));
      push(K.acts([K.btn(L("Reset to the default order", "V\u00fdchoz\u00ed po\u0159ad\u00ed"), "", function () { save([], []); }), K.btn(L("Done", "Hotovo"), "primary", K.go("/more"))]));
      return K.page(P);
    }
    if (path === "/link") {
      P.title = L("Opening a link", "Otev\u0159en\u00ed odkazu");
      push(K.note(L("Pick where the link came from. Each opens the way it would on a phone.", "Vyberte, odkud odkaz p\u0159i\u0161el."), "muted"));
      var T = [["/utilities/elec", L("A notification about an electricity reading", "Ozn\u00e1men\u00ed o ode\u010dtu elekt\u0159iny"), L("Opens the meter, in this household. Back returns here.", "Otev\u0159e m\u011b\u0159idlo.")],
        ["/households/chata/settings", L("A link from the other household", "Odkaz z druh\u00e9 dom\u00e1cnosti"), L("Switches to Chata Vysočina first, and says so.", "Nejd\u0159\u00edv p\u0159epne dom\u00e1cnost.")],
        ["/finance", L("A link to something you can\u2019t see", "Odkaz na n\u011bco, co nevid\u00edte"), L("Klára holds no Finance, so she lands on \u201cnot available\u201d \u2014 the same page as a link that never existed.", "Kl\u00e1ra Finance nem\u00e1.")],
        ["/notes/dum/malovani", L("An old link to a note that moved", "Star\u00fd odkaz na p\u0159esunutou pozn\u00e1mku"), L("The note\u2019s own 404 says where it went.", "404 ozn\u00e1m\u00ed novou adresu.")]];
      push(K.rows(T.map(function (x, i) {
        return K.row({ title: x[1], sub: x[2], open: function () {
          if (i === 1) self.setState({ household: "hh-chata", route: x[0] });
          else if (i === 2) self.setState({ member: "klara", route: x[0] });
          else self.go(x[0]);
          if (i === 1) K.toast(L("Switched to Chata Vysočina", "P\u0159epnuto na Chata Vysočina"));
        } });
      })));
      return K.page(P);
    }
    P.title = L("Not available", "Nen\u00ed k dispozici"); P.back = "/home";
    push(K.empty(L("There\u2019s nothing here for you.", "Tady pro v\u00e1s nic nen\u00ed."), L("It may have moved, or it belongs to a part of the household you don\u2019t use. Nothing was changed by opening it.", "Mohlo se to p\u0159esunout, nebo to pat\u0159\u00ed do \u010d\u00e1sti, kterou nepou\u017e\u00edv\u00e1te."),
      L("Go to Home", "Dom\u016f"), K.go("/home")));
    push(K.acts([K.btn(L("Search instead", "Hledat"), "", K.go("/search"))]));
    return K.page(P);
  }

  /* ═══ Help ═══ */
  function help(self, K, query) {
    var S = window.HH_SPINE; if (!S) return null;
    var L = K.L, id = K.get("hp_open", ""), q = String(K.get("hp_q", "")).toLowerCase();
    var P = { title: L("Help", "N\u00e1pov\u011bda"), blocks: [], back: "/more" }, B = P.blocks, push = function (x) { if (x) B.push(x); };
    push(K.bound("hp_q", { label: "", placeholder: L("What are you stuck on?", "S \u010d\u00edm si nev\u00edte rady?") }));
    var list = S.help.filter(function (h) { return !q || (h.title + " " + h.body).toLowerCase().indexOf(q) >= 0; });
    if (!list.length) push(K.empty(L("No help written for that yet.", "Na to zat\u00edm n\u00e1pov\u011bda nen\u00ed."), L("Help lives next to the screen it\u2019s about. Nothing here links out of the app.", "N\u00e1pov\u011bda je u obrazovky, ke kter\u00e9 pat\u0159\u00ed."), "", null));
    list.forEach(function (h) {
      var on = id === h.id;
      push(K.rows([K.row({ title: h.title, sub: on ? "" : h.body, on: on, open: function () { K.put({ hp_open: on ? "" : h.id }); } })]));
      if (on) {
        push(K.note(h.body, "box"));
        if (h.steps) push(K.rows(h.steps.map(function (t, i) { return K.row({ lead: String(i + 1), title: t }); })));
        if (h.example) push(K.note(L("For example: ", "Nap\u0159\u00edklad: ") + (h.example.text || h.example), "muted"));
        var r = String(h.screen || "").replace("{service}", "elec").replace(/\{[^}]+\}/g, "");
        if (r && r.charAt(0) === "/") push(K.acts([K.btn(L("Go to that screen", "P\u0159ej\u00edt na obrazovku"), "", K.go(r))]));
      }
    });
    return K.page(P);
  }

  /* ═══ Notifications (owner) ═══ */
  function notify(self, K, path, query) {
    var N = window.HH_NOTIFY; if (!N) return null;
    var L = K.L, s = self.state, me = s.member, lang = s.locale === "cs" ? "cs" : "en";
    var owner = (K.memberOf(me) || {}).role === "owner";
    var P = { title: "", blocks: [], back: "/households/" + (s.household === "hh-tilcer" ? "tilcerovi" : "chata") + "/settings" }, B = P.blocks, push = function (x) { if (x) B.push(x); };
    if (!owner) { P.title = L("What Household tells you", "Co v\u00e1m Household \u0159\u00edk\u00e1"); push(K.empty(L("Rules are set by an owner.", "Pravidla nastavuje vlastn\u00edk."), L("Your own notifications are in your account.", "Va\u0161e ozn\u00e1men\u00ed jsou v \u00fa\u010dtu."), L("My notifications", "Moje ozn\u00e1men\u00ed"), K.go("/account/notifications"))); return K.page(P); }

    if (path === "/settings/notifications/log") {
      P.title = L("What was sent", "Co bylo odesl\u00e1no"); P.back = "/settings/notifications";
      var rows0 = K.safe(function () { return N.logRows(); }, []), fo = K.get("nl_out", ""), fw = K.get("nl_who", "");
      var outs = []; rows0.forEach(function (r) { if (outs.indexOf(r.outcome) < 0) outs.push(r.outcome); });
      push(K.chips(L("Outcome", "V\u00fdsledek"), [K.chip(L("All", "V\u0161e"), !fo, function () { K.put({ nl_out: "" }); })].concat(outs.map(function (o) { return K.chip(o, fo === o, function () { K.put({ nl_out: fo === o ? "" : o }); }); }))));
      push(K.chips(L("To", "Komu"), [K.chip(L("Anyone", "Komukoli"), !fw, function () { K.put({ nl_who: "" }); })].concat(K.F.members.map(function (m) { return K.chip(m.name, fw === m.id, function () { K.put({ nl_who: fw === m.id ? "" : m.id }); }); }))));
      var list = rows0.filter(function (r) { return (!fo || r.outcome === fo) && (!fw || r.to === fw); });
      if (!list.length) push(K.empty(L("Nothing matches.", "Nic neodpov\u00edd\u00e1."), "", "", null));
      push(K.rows(list.map(function (r) {
        return K.row({ title: r.kept && r.body ? r.body : L("(text removed after " + N.bodyRetention + " days)", "(text odstran\u011bn po " + N.bodyRetention + " dnech)"), italic: !(r.kept && r.body),
          sub: [K.nameOf(r.to), r.transport, String(r.at).replace("T", " "), r.reason || ""].filter(Boolean).join(" \u00b7 "), right: r.outcome, tone: r.outcome === "delivered" ? "" : "warn" });
      })));
      push(K.note(L("The log shows whether each attempt arrived. What it said is kept for " + N.bodyRetention + " days, then only the fact that it was sent.", "Obsah se uchov\u00e1v\u00e1 " + N.bodyRetention + " dn\u00ed."), "muted"));
      return K.page(P);
    }

    P.title = L("What Household tells you", "Co Household \u0159\u00edk\u00e1");
    var rules = K.get("nr_rules", null) || N.rules.map(function (r) { return JSON.parse(JSON.stringify(r)); });
    var setRules = function (r) { K.put({ nr_rules: r }); };
    var ed = K.get("nr_ed", null);
    var offer = function (id) { return N.offers.filter(function (o) { return o.id === id; })[0] || { label: id, section: "" }; };
    var aud = function (id) { return (N.audiences.filter(function (a) { return a.id === id; })[0] || { label: id }).label; };
    push(K.note(L("Pick a thing that happens and who hears about it. Every rule still respects what each person can see and their quiet hours.", "Vyberte ud\u00e1lost a kdo se o n\u00ed dozv\u00ed. Pravidla respektuj\u00ed opr\u00e1vn\u011bn\u00ed i no\u010dn\u00ed klid."), "muted"));
    push(K.label(L("Rules", "Pravidla") + " \u00b7 " + rules.length, L("New rule", "Nov\u00e9 pravidlo"), function () {
      K.put({ nr_ed: { id: "", offer: N.offers[0].id, audience: "everyone", coalesce: 0, on: true, tpl: { en: { title: "", body: "" }, cs: { title: "", body: "" } } }, nr_lang: "en", nr_test: "" });
    }));
    push(K.rows(rules.map(function (r, i) {
      var o = offer(r.offer);
      return K.row({ title: o.label, sub: aud(r.audience) + (r.coalesce ? L(" \u00b7 grouped over " + r.coalesce + " min", " \u00b7 seskupeno " + r.coalesce + " min") : ""), muted: !r.on,
        act: r.on ? L("On", "Zapnuto") : L("Off", "Vypnuto"), actOn: r.on, onAct: function () { var n = rules.slice(); n[i] = Object.assign({}, r, { on: !r.on }); setRules(n); },
        open: function () { K.put({ nr_ed: JSON.parse(JSON.stringify(r)), nr_lang: "en", nr_test: "" }); } });
    })));
    push(K.label(L("Scheduled digests", "Pl\u00e1novan\u00e9 souhrny")));
    var dg = K.get("nr_dig", {});
    push(K.rows(N.digests.map(function (d) {
      var on = dg[d.id] !== false;
      return K.row({ title: d.name, sub: d.time + " \u00b7 " + (d.days ? d.days.join(", ") : L("day ", "den ") + d.dayOfMonth + L(" (or the last day of a shorter month)", " (nebo posledn\u00ed den krat\u0161\u00edho m\u011bs\u00edce)")) + " \u00b7 " + ((d.tpl || {})[lang] || ""),
        act: on ? L("On", "Zapnuto") : L("Off", "Vypnuto"), actOn: on, onAct: function () { var o = Object.assign({}, dg); o[d.id] = !on; K.put({ nr_dig: o }); }, muted: !on });
    })));
    push(K.acts([K.btn(L("What was sent", "Co bylo odesl\u00e1no"), "", K.go("/settings/notifications/log")), K.btn(L("My own notifications", "Moje ozn\u00e1men\u00ed"), "", K.go("/account/notifications"))]));

    if (ed) {
      var o = offer(ed.offer), lg = K.get("nr_lang", "en"), tp = (ed.tpl || {})[lg] || { title: "", body: "" };
      var setE = function (p) { K.put({ nr_ed: Object.assign({}, ed, p) }); };
      var setT = function (p) { var t = JSON.parse(JSON.stringify(ed.tpl || {})); t[lg] = Object.assign({}, t[lg] || { title: "", body: "" }, p); setE({ tpl: t }); };
      var check = K.safe(function () { return N.saveCheck(ed); }, null);
      var nobody = check && check.eligible && check.eligible.length === 0;
      var SB = [];
      SB.push(K.chips(L("When", "Kdy\u017e"), N.offers.map(function (x) { return K.chip(x.label, x.id === ed.offer, function () { setE({ offer: x.id }); }); }), o.says));
      SB.push(K.chips(L("Who hears", "Kdo se dozv\u00ed"), N.audiences.map(function (a) { return K.chip(a.label, a.id === ed.audience, function () { setE({ audience: a.id }); }); })));
      SB.push(K.chips(L("Group repeats", "Seskupit opakov\u00e1n\u00ed"), [0, 15, 60].map(function (m) { return K.chip(m ? m + " min" : L("Send each one", "Poslat ka\u017edou"), (ed.coalesce || 0) === m, function () { setE({ coalesce: m }); }); })));
      SB.push(K.chips(L("Wording", "Zn\u011bn\u00ed"), [["en", "English"], ["cs", "\u010ce\u0161tina"]].map(function (x) {
        var has = ((ed.tpl || {})[x[0]] || {}).title; return K.chip(x[1] + (has ? "" : L(" \u00b7 missing", " \u00b7 chyb\u00ed")), lg === x[0], function () { K.put({ nr_lang: x[0] }); });
      }), L("Each person gets their own language. A missing one falls back to English and the log says so.", "Ka\u017ed\u00fd dostane sv\u016fj jazyk.")));
      SB.push(K.field({ label: L("Title", "Nadpis"), value: tp.title, set: function (v) { setT({ title: v }); }, placeholder: "{actor} changed an amount" }));
      SB.push(K.field({ label: L("Text", "Text"), value: tp.body, set: function (v) { setT({ body: v }); }, placeholder: "{entry}: {old} \u2192 {new}", hint: L("Words in {braces} are filled in when it\u2019s sent.", "Slova ve {z\u00e1vork\u00e1ch} se dopln\u00ed p\u0159i odesl\u00e1n\u00ed.") }));
      if (nobody) SB.push(K.note(L("Nobody could receive this: " + aud(ed.audience).toLowerCase() + " can\u2019t see " + (check.module || "that module") + ". Widen who hears it, or share the module.", "Nikdo by to nedostal."), "boxWarn"));
      var tr = K.get("nr_test", "");
      if (tr) SB.push(K.note(tr, "boxOk"));
      var valid = ((ed.tpl || {}).en || {}).title && !nobody;
      K._sheet = { title: ed.id ? o.label : L("New rule", "Nov\u00e9 pravidlo"), sub: "", blocks: SB, foot: [
        K.btn(L("Send me a test", "Poslat mi zku\u0161ebn\u00ed"), "", function () {
          var r = K.safe(function () { return N.testSend(me); }, null);
          var t = ((ed.tpl || {})[lang] || (ed.tpl || {}).en || {}).title || o.label;
          K.put({ nr_test: r && r.ok === false ? r.says : L("Sent to you only: \u201c" + t + "\u201d. Nobody else was told.", "Odesl\u00e1no jen v\u00e1m: \u201e" + t + "\u201c.") });
        }),
        ed.id ? K.btn(L("Delete", "Smazat"), "danger-ghost", function () { setRules(rules.filter(function (r) { return r.id !== ed.id; })); K.put({ nr_ed: null }); }) : null,
        K.btn(L("Cancel", "Zru\u0161it"), "", function () { K.put({ nr_ed: null }); }),
        K.btn(L("Save", "Ulo\u017eit"), "primary", function () {
          var n = rules.slice(), i = n.map(function (r) { return r.id; }).indexOf(ed.id);
          var r = Object.assign({}, ed, { id: ed.id || "r-" + Date.now().toString(36), created: ed.created || "2026-09-26", by: ed.by || me });
          if (i >= 0) n[i] = r; else n.push(r);
          setRules(n); K.put({ nr_ed: null }); K.toast(L("Rule saved", "Pravidlo ulo\u017eeno"));
        }, !valid)].filter(Boolean) };
      P.sheet = K._sheet; P.onCloseSheet = function () { K.put({ nr_ed: null }); };
    }
    return K.page(P);
  }

  /* ═══ Household settings: country, child PIN, graduation ═══ */
  function admin(self, K, seg) {
    var L = K.L, s = self.state, F = K.F, H = window.HH_HOUSEHOLD;
    var hh = F.households.filter(function (h) { return h.id === s.household; })[0]; if (!hh) return null;
    var base = "/households/" + seg[1] + "/settings";
    var owner = (K.memberOf(s.member) || {}).role === "owner";
    var P = { title: "", blocks: [], back: base }, B = P.blocks, push = function (x) { if (x) B.push(x); };
    if (!owner) { P.title = L("Household settings", "Nastaven\u00ed"); push(K.empty(L("Only an owner can change this.", "M\u011bnit to m\u016f\u017ee jen vlastn\u00edk."), "", L("Back", "Zp\u011bt"), K.go(base))); return K.page(P); }

    if (seg[3] === "country") {
      var C = [["CZ", "Czechia", "\u010cesko"], ["SK", "Slovakia", "Slovensko"], ["DE", "Germany", "N\u011bmecko"], ["AT", "Austria", "Rakousko"], ["PL", "Poland", "Polsko"]];
      var nm = function (c) { var r = C.filter(function (x) { return x[0] === c; })[0]; return r ? L(r[1], r[2]) : c; };
      var to = K.get("hh_country", hh.country);
      P.title = L("Change the country", "Zm\u011bnit zemi");
      push(K.kv([[L("Now", "Nyn\u00ed"), nm(hh.country)]]));
      push(K.chips(L("Move to", "Zm\u011bnit na"), C.map(function (c) { return K.chip(L(c[1], c[2]), to === c[0], function () { K.put({ hh_country: c[0] }); }); })));
      if (to !== hh.country) {
        push(K.label(L("What this changes", "Co se zm\u011bn\u00ed")));
        push(K.rows([[L("Statutory dates for vehicles", "Z\u00e1konn\u00e9 term\u00edny vozidel"), L("New inspections follow " + nm(to) + "\u2019s rules. Dates already recorded stay as they are.", "Nov\u00e9 prohl\u00eddky podle pravidel zem\u011b " + nm(to) + ".")],
          [L("Document types", "Typy dokument\u016f"), L("The names and renewal lead times follow " + nm(to) + ".", "N\u00e1zvy a lh\u016fty podle zem\u011b " + nm(to) + ".")],
          [L("Public holidays in Calendar", "St\u00e1tn\u00ed sv\u00e1tky"), L("Switch to " + nm(to) + "\u2019s.", "P\u0159epnou se.")],
          [L("Property starter checklist", "Startovn\u00ed seznam"), L("Offered for " + nm(to) + " next time it\u2019s opened.", "Nab\u00eddne se pro " + nm(to) + ".")]].map(function (r) { return K.row({ title: r[0], sub: r[1] }); })));
        push(K.note(L("Nothing already written is changed: past bills, readings, expenses and dates stay exactly as entered. Currency is separate and doesn\u2019t move.", "Nic zapsan\u00e9ho se nem\u011bn\u00ed. M\u011bna je zvl\u00e1\u0161\u0165."), "box"));
        push(K.acts([K.btn(L("Change to " + nm(to), "Zm\u011bnit na " + nm(to)), "primary", function () {
          var prev = hh.country; hh.country = to; K.put({ hh_country: to }, { route: base });
          K.toast(L("Country is " + nm(to), "Zem\u011b: " + nm(to)), function () { hh.country = prev; K.put({ hh_country: prev }); });
        }, K.off), K.btn(L("Cancel", "Zru\u0161it"), "", K.go(base))]));
        if (K.off) push(K.note(L("This needs a connection.", "Pot\u0159ebuje p\u0159ipojen\u00ed."), "boxOff"));
      }
      return K.page(P);
    }

    var m = K.memberOf(seg[4]); if (!m || m.role !== "child") return null;
    P.back = base + "/members/" + m.id;
    if (seg[5] === "pin") {
      P.title = L("A new PIN for " + m.name, "Nov\u00fd PIN pro " + m.name);
      var done = K.get("ch_pinDone_" + m.id, "");
      if (done) {
        push(K.note(L("Done. " + m.name + "\u2019s PIN is " + done + " and the pause is lifted. Tell them in person \u2014 Household doesn\u2019t send it anywhere.", "Hotovo. PIN je " + done + "."), "boxOk"));
        push(K.acts([K.btn(L("Back to " + m.name, "Zp\u011bt"), "primary", K.go(P.back))]));
        return K.page(P);
      }
      if ((K.get("acc_pinTry", 0)) >= 5) push(K.note(L(m.name + "\u2019s profile is paused after five wrong tries. A new PIN lifts it.", "Profil je pozastaven. Nov\u00fd PIN ho odblokuje."), "boxWarn"));
      push(K.bound("ch_pin1", { label: L("New PIN", "Nov\u00fd PIN"), type: "password", mode: "numeric", narrow: true, placeholder: "\u2022\u2022\u2022\u2022", err: K.get("ch_pinErr", "") }));
      push(K.bound("ch_pin2", { label: L("Again", "Znovu"), type: "password", mode: "numeric", narrow: true, placeholder: "\u2022\u2022\u2022\u2022" }));
      push(K.acts([K.btn(L("Set the PIN", "Nastavit PIN"), "primary", function () {
        var a = String(K.get("ch_pin1", "")), b = String(K.get("ch_pin2", ""));
        if (!/^\d{4}$/.test(a)) return K.put({ ch_pinErr: L("Four digits.", "\u010cty\u0159i \u010d\u00edslice.") });
        if (/^(\d)\1{3}$|^1234$|^0000$/.test(a)) return K.put({ ch_pinErr: L("Too easy to guess. Try four different digits.", "P\u0159\u00edli\u0161 snadn\u00e9.") });
        if (a !== b) return K.put({ ch_pinErr: L("The two don\u2019t match.", "Neshoduj\u00ed se.") });
        var o = { ch_pin1: "", ch_pin2: "", ch_pinErr: "", acc_pinTry: 0 }; o["ch_pinDone_" + m.id] = a; K.put(o);
      }, K.off)]));
      push(K.note(L("You\u2019re signed in, so no code is sent. The old PIN stops working on every device at once.", "Star\u00fd PIN p\u0159estane fungovat v\u0161ude."), "muted"));
      return K.page(P);
    }
    /* graduation */
    P.title = L("Give " + m.name + " their own sign-in", "D\u00e1t " + m.name + " vlastn\u00ed p\u0159ihl\u00e1\u0161en\u00ed");
    var gd = K.get("ch_grad_" + m.id, "");
    if (gd) {
      push(K.note(L("An invitation is on its way to " + gd + ". When " + m.name + " accepts, the profile becomes a member with the same history, the same points and the same private notes \u2014 and the PIN stops working.",
        "Pozv\u00e1nka je na cest\u011b na " + gd + "."), "boxOk", L("Withdraw", "St\u00e1hnout"), function () { var o = {}; o["ch_grad_" + m.id] = ""; K.put(o); }));
      return K.page(P);
    }
    push(K.note(L("Nothing is lost or copied: it\u2019s the same person with an email and password instead of a PIN. What they can see stays as it is until you change it; the private-root exception for children ends.", "Nic se neztrat\u00ed. Je to stejn\u00fd \u010dlov\u011bk s e-mailem m\u00edsto PINu."), "box"));
    push(K.bound("ch_gmail", { label: L(m.name + "\u2019s email", "E-mail"), type: "email", placeholder: "name@example.com", err: K.get("ch_gErr", "") }));
    push(K.rows([K.row({ title: L("They become a member", "Stane se \u010dlenem"), sub: L("Home unlocks and becomes theirs to arrange.", "Plocha se odemkne.") }),
      K.row({ title: L("Their points and streaks stay", "Body a s\u00e9rie z\u016fstanou"), sub: L("The ledger keeps every entry.", "Z\u00e1znam z\u016fstane.") }),
      K.row({ title: L("You stop reading their private notes", "P\u0159estanete \u010d\u00edst soukrom\u00e9 pozn\u00e1mky"), sub: L("The owner exception is for children only.", "V\u00fdjimka plat\u00ed jen pro d\u011bti.") })]));
    push(K.acts([K.btn(L("Send the invitation", "Poslat pozv\u00e1nku"), "primary", function () {
      var e = String(K.get("ch_gmail", "")).trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return K.put({ ch_gErr: L("That email is missing something.", "V e-mailu n\u011bco chyb\u00ed.") });
      var o = { ch_gErr: "", ch_gmail: "" }; o["ch_grad_" + m.id] = e; K.put(o);
    }, K.off), K.btn(L("Cancel", "Zru\u0161it"), "", K.go(P.back))]));
    return K.page(P);
  }

  /* ═══ Chat ═══ */
  function chat(self, K, seg, hash) {
    var C = window.HH_CHAT; if (!C) return null;
    var L = K.L, s = self.state, me = s.member, lvl = C.grantOf(me);
    var P = { title: "", blocks: [], back: "/chat" }, B = P.blocks, push = function (x) { if (x) B.push(x); };
    var bin = K.get("ch_bin", {}), moved = K.get("ch_moved", {});
    var convName = function (id) { var c = C.conversation(id); return c ? c.cs : id; };
    var size = function (mb) { return self.chatSize ? self.chatSize(mb) : mb + " MB"; };
    if (lvl === "none") return null;

    if (seg[1] === "storage") {
      P.title = L("What Chat is using", "Co Zpr\u00e1vy zab\u00edraj\u00ed");
      var per = C.perConversation.map(function (p) {
        var mv = C.attachments.filter(function (a) { return a.conv === p.conv && moved[a.id]; }).reduce(function (n, a) { return n + a.mb; }, 0);
        return Object.assign({}, p, { gb: Math.max(0, p.gb - mv / 1024) });
      });
      var tot = per.reduce(function (n, p) { return n + p.gb; }, 0);
      push(K.hero({ kicker: L("Chat", "Zpr\u00e1vy"), big: tot.toFixed(2).replace(".", ",") + " GB", sub: L("across " + per.length + " conversations. A notice appears at 4 GB and a warning at 8 GB; nothing is ever deleted for you.", "Upozorn\u011bn\u00ed od 4 GB. Nic se nema\u017ee samo.") }));
      push(K.label(L("Per conversation", "Podle konverzace")));
      push(K.bars(per.map(function (p) { return { name: convName(p.conv), right: p.gb.toFixed(2).replace(".", ",") + " GB", left: p.files + L(" files \u00b7 oldest ", " soubor\u016f \u00b7 nejstar\u0161\u00ed ") + p.oldest, v: p.gb }; })));
      push(K.label(L("Largest files", "Nejv\u011bt\u0161\u00ed soubory")));
      var big = C.attachments.filter(function (a) { return !moved[a.id] && !(K.get("ch_attDel", {}))[a.id]; }).slice().sort(function (a, b) { return b.mb - a.mb; }).slice(0, 6);
      push(K.rows(big.map(function (a) {
        return K.row({ title: a.file, sub: convName(a.conv) + " \u00b7 " + C.name(a.by) + " \u00b7 " + String(a.at).slice(0, 10), right: size(a.mb),
          act: L("Move to Documents", "Do Dokument\u016f"), onAct: K.go("/chat/" + a.conv + "/msg/" + a.msg + "?att=" + a.id) });
      })));
      push(K.note(L("Moving a file to Documents takes it out of Chat\u2019s total and into Documents\u2019. The household total doesn\u2019t change, and the message keeps a link to it.", "P\u0159esun do Dokument\u016f nezm\u011bn\u00ed celkov\u00fd sou\u010det."), "muted"));
      return K.page(P);
    }
    if (seg[1] === "search") {
      P.title = L("Search messages", "Hledat ve zpr\u00e1v\u00e1ch");
      var q = String(K.get("ch_q", "")).trim();
      push(K.bound("ch_q", { label: "", placeholder: K.off ? L("Search needs a connection", "Hled\u00e1n\u00ed pot\u0159ebuje p\u0159ipojen\u00ed") : L("e.g. keys", "nap\u0159. kl\u00ed\u010de"), off: K.off }));
      if (q && !K.off) {
        var r = K.safe(function () { return C.search(me, q); }, { rows: [] });
        var f = function (t) { return String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); };
        var rows1 = r.rows && r.rows.length ? r.rows : [];
        if (!rows1.length) C.conversations.forEach(function (c) { if (!C.inConversation(c.id, me)) return; C.visibleTo(c.id, me).forEach(function (m) { if (f(m.text).indexOf(f(q)) >= 0) rows1.push({ conv: c.id, id: m.id, by: m.by, at: m.at, text: m.text }); }); });
        if (!rows1.length) push(K.empty(L("Nothing matches \u201c" + q + "\u201d.", "Nic neodpov\u00edd\u00e1."), L("Search reads the conversations you\u2019re in, from when you joined.", "Hled\u00e1 v konverzac\u00edch, kde jste, od va\u0161eho p\u0159ipojen\u00ed."), "", null));
        push(K.rows(rows1.slice(0, 20).map(function (m) { return K.row({ title: m.text, sub: convName(m.conv || m.convId) + " \u00b7 " + C.name(m.by) + " \u00b7 " + String(m.at).slice(0, 16), open: K.go("/chat/" + (m.conv || m.convId)) }); })));
      } else if (!K.off) push(K.note(L("Only conversations you\u2019re in, and only from the day you joined each.", "Jen konverzace, kde jste, a od dne p\u0159ipojen\u00ed."), "muted"));
      return K.page(P);
    }
    if (seg[1] === "bin") {
      P.title = L("Deleted conversations", "Smazan\u00e9 konverzace");
      var ids = Object.keys(bin);
      if (!ids.length) push(K.empty(L("Nothing deleted.", "Nic smazan\u00e9ho."), L("A deleted conversation waits here for 30 days and can be put back by anyone who was in it.", "Smazan\u00e1 konverzace tu \u010dek\u00e1 30 dn\u00ed."), "", null));
      push(K.rows(ids.map(function (id) {
        return K.row({ title: convName(id), sub: L("deleted " + bin[id] + " \u00b7 gone for good in 30 days", "smaz\u00e1no " + bin[id]), act: L("Put back", "Obnovit"), onAct: function () { var o = Object.assign({}, bin); delete o[id]; K.put({ ch_bin: o }); K.toast(L(convName(id) + " is back", convName(id) + " je zp\u011bt")); } });
      })));
      return K.page(P);
    }
    var conv = C.conversation(seg[1]); if (!conv || !C.inConversation(conv.id, me)) return null;
    P.back = "/chat/" + conv.id;

    if (seg[2] === "attach") {
      P.title = L("Attach to " + conv.cs, "P\u0159ilo\u017eit do " + conv.cs);
      var picks = [["IMG_2041.jpg", 3.4, "image/jpeg"], ["IMG_2042.jpg", 2.9, "image/jpeg"], ["video-kotel.mp4", 48.2, "video/mp4"], ["faktura-zari.pdf", 0.4, "application/pdf"]];
      var sel = K.get("ch_attSel", []);
      push(K.note(L("Photos, videos and files up to 100 MB each. Whatever is picked counts towards the household\u2019s storage, under Chat.", "Fotky, videa a soubory do 100 MB."), "muted"));
      push(K.rows(picks.map(function (p) {
        var on = sel.indexOf(p[0]) >= 0;
        return K.check({ title: p[0], sub: size(p[1]), done: on, noStrike: true, open: function () { K.put({ ch_attSel: on ? sel.filter(function (x) { return x !== p[0]; }) : sel.concat([p[0]]) }); } });
      })));
      push(K.bound("ch_attText", { label: L("Message", "Zpr\u00e1va"), placeholder: L("Say something about it (optional)", "Napi\u0161te k tomu n\u011bco (nepovinn\u00e9)") }));
      push(K.acts([K.btn(L("Send", "Odeslat") + (sel.length ? " \u00b7 " + sel.length : ""), "primary", function () {
        var sent = Object.assign({}, s.chatSent || {}), mine = (sent[conv.id] || []).slice(), mid = "local-" + conv.id + "-" + mine.length;
        var d = new Date(), hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
        mine.push({ id: mid, conv: conv.id, by: me, at: C.today + " " + hh, seq: 99000 + mine.length, text: String(K.get("ch_attText", "")).trim() || "", pending: !s.online,
          atts: picks.filter(function (p) { return sel.indexOf(p[0]) >= 0; }).map(function (p, i) { return { id: mid + "-a" + i, conv: conv.id, msg: mid, by: me, at: C.today + " " + hh, file: p[0], mb: p[1], ct: p[2], bytes: s.online ? "ready" : "pending", thumb: s.online ? "ready" : "none" }; }) });
        sent[conv.id] = mine; K.put({ ch_attSel: [], ch_attText: "" }, { chatSent: sent, route: "/chat/" + conv.id });
      }, !sel.length), K.btn(L("Cancel", "Zru\u0161it"), "", K.go("/chat/" + conv.id))]));
      if (K.off) push(K.note(L("You\u2019re offline. The message goes now and the files follow when there\u2019s signal; others see them as \u201cnot arrived yet\u201d.", "Jste offline. Soubory dojdou pozd\u011bji."), "boxOff"));
      return K.page(P);
    }

    if (seg[2] === "manage") {
      P.title = conv.cs; P.sub = L("Conversation", "Konverzace");
      var members = C.membersOf(conv.id);
      push(K.label(L("In it", "\u010clenov\u00e9") + " \u00b7 " + members.length));
      push(K.rows(members.map(function (m) { return K.row({ title: C.name(m.who), sub: m.floor ? L("joined " + m.joined + ", reads from there", "p\u0159idal(a) se " + m.joined) : L("here since the beginning", "od za\u010d\u00e1tku") }); })));
      if (conv.undeletable) push(K.note(L("This is the household\u2019s general conversation. It can\u2019t be deleted; everyone who can see Chat is in it.", "Obecnou konverzaci nelze smazat."), "muted"));
      else if (C.atLeast(lvl, "manage") || conv.by === me) push(K.acts([K.btn(L("Delete conversation", "Smazat konverzaci"), "danger-ghost", function () {
        var o = Object.assign({}, bin); o[conv.id] = L("today", "dnes"); K.put({ ch_bin: o }, { route: "/chat" });
        K.toast(L(conv.cs + " moved to deleted conversations", conv.cs + " p\u0159esunuto do smazan\u00fdch"), function () { var o2 = Object.assign({}, K.get("ch_bin", {})); delete o2[conv.id]; K.put({ ch_bin: o2 }); });
      })]));
      else push(K.note(L("Deleting a conversation needs \u201cCan set it up\u201d on Chat, or having started it.", "Smaz\u00e1n\u00ed vy\u017eaduje spr\u00e1vu Zpr\u00e1v."), "muted"));
      return K.page(P);
    }

    if (seg[2] === "msg" && seg[3]) {
      var q2 = {}; String((s.route.split("?")[1] || "").split("#")[0]).split("&").forEach(function (p) { var x = p.split("="); if (x[0]) q2[x[0]] = x[1] || ""; });
      var all = C.messagesOf(conv.id).concat(((s.chatSent || {})[conv.id] || []));
      var msg = all.filter(function (m) { return m.id === seg[3]; })[0]; if (!msg) return null;
      var edits = K.get("ch_edit", {}), dels = K.get("ch_del", {});
      var mine = msg.by === me, text = edits[msg.id] != null ? edits[msg.id] : msg.text;
      var ageMin = (Date.parse(C.today + "T23:59:00") - Date.parse(String(msg.at).replace(" ", "T"))) / 60000;
      var canEdit = mine && (String(msg.id).indexOf("local-") === 0 || ageMin <= C.editWindow);
      P.title = mine ? L("Your message", "Va\u0161e zpr\u00e1va") : C.name(msg.by); P.sub = String(msg.at).slice(0, 16);
      if (dels[msg.id]) {
        push(K.note(L("Deleted. Everyone now sees \u201cmessage deleted\u201d in its place.", "Smaz\u00e1no. Ostatn\u00ed vid\u00ed \u201ezpr\u00e1va smaz\u00e1na\u201c."), "boxOk", L("Undo", "Zp\u011bt"), function () { var o = Object.assign({}, dels); delete o[msg.id]; K.put({ ch_del: o }); }));
        return K.page(P);
      }
      push(K.note(text || L("(no text)", "(bez textu)"), "box"));
      if (canEdit) {
        push(K.bound("ch_ed_" + msg.id, { label: L("Edit", "Upravit"), def: text, hint: L("Edits are allowed for " + C.editWindow + " minutes and show \u201cedited\u201d.", "Upravit lze " + C.editWindow + " minut.") }));
        var nt = String(K.get("ch_ed_" + msg.id, text));
        push(K.acts([K.btn(L("Save edit", "Ulo\u017eit"), "primary", function () { var o = Object.assign({}, edits); o[msg.id] = nt; K.put({ ch_edit: o }, { route: "/chat/" + conv.id }); }, nt === text || !nt.trim()),
          K.btn(L("Delete message", "Smazat zpr\u00e1vu"), "danger-ghost", function () { var o = Object.assign({}, dels); o[msg.id] = true; K.put({ ch_del: o }); })]));
      } else if (mine) {
        push(K.note(L("The edit window has passed. You can still delete it.", "\u010cas na \u00fapravu vypr\u0161el. Smazat ji m\u016f\u017eete."), "muted"));
        push(K.acts([K.btn(L("Delete message", "Smazat zpr\u00e1vu"), "danger-ghost", function () { var o = Object.assign({}, dels); o[msg.id] = true; K.put({ ch_del: o }); })]));
      }
      var atts = C.attachments.filter(function (a) { return a.msg === msg.id; }).concat(msg.atts || []);
      if (atts.length) {
        push(K.label(L("Files", "Soubory")));
        push(K.rows(atts.map(function (a) {
          var mv = moved[a.id];
          return K.row({ title: a.file, sub: size(a.mb) + (mv ? L(" \u00b7 now in Documents \u00b7 " + mv, " \u00b7 v Dokumentech") : ""), on: q2.att === a.id,
            act: mv ? L("Undo", "Zp\u011bt") : K.at("documents", "contribute") ? L("Move to Documents", "Do Dokument\u016f") : "",
            onAct: function () { var o = Object.assign({}, moved); if (mv) delete o[a.id]; else o[a.id] = L("Shared \u00b7 Chat", "Sd\u00edlen\u00e9 \u00b7 Zpr\u00e1vy"); K.put({ ch_moved: o }); if (!mv) K.toast(L(a.file + " moved to Documents. The uploader stays " + C.name(a.by) + ".", a.file + " p\u0159esunuto do Dokument\u016f.")); } });
        })));
        push(K.note(L("A move, not a copy: the file leaves Chat\u2019s storage and the message shows a link to where it went.", "P\u0159esun, ne kopie."), "muted"));
      }
      return K.page(P);
    }
    return null;
  }

  window.HH_PLAT_VIEW = view;
})();
