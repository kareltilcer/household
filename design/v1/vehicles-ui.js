/* Vehicles, live in the prototype shell.
   Reads and writes the shared asset engine (HH_ASSETS): vehicles are entities, the odometer is
   the engine's reading series, services are records, the service interval is a schedule. The
   module's own five — statutory dates, insurance with its notice period, the fuel log, what it
   costs, and the bike variant — are computed here per vehicle from the same arrays, so a fill-up
   moves the odometer, the service estimate, consumption and the cost per km in one commit.
   Drawn through the Finance block vocabulary, like Property. */
(function () {
  var KINDS = ["Hero", "Label", "Rows", "Note", "Bars", "Acts", "Field", "Chips", "Inputs", "Cards", "Steps", "Kv", "Empty"];
  var LV = ["none", "view", "contribute", "manage"];
  var MEN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MCS = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
  function safe(fn, d) { try { var v = fn(); return v == null ? d : v; } catch (e) { return d; } }

  var TYPES = [["car", "Car", "Osobní auto"], ["motorbike", "Motorbike", "Motorka"], ["bike", "Bicycle", "Kolo"], ["ebike", "E-bike", "Elektrokolo"], ["trailer", "Trailer", "Přívěs"]];
  var PLATED = { car: 1, motorbike: 1, trailer: 1 };
  var ENGINE = { car: 1, motorbike: 1 };
  var FUELS = [["diesel", "Diesel", "Nafta"], ["petrol", "Petrol", "Benzín"], ["hybrid", "Hybrid", "Hybrid"], ["electric", "Electric", "Elektřina"], ["lpg", "LPG", "LPG"]];
  var COUNTRIES = [["CZ", "Czechia", "Česko"], ["SK", "Slovakia", "Slovensko"], ["DE", "Germany", "Německo"], ["PL", "Poland", "Polsko"], ["UK", "United Kingdom", "Spojené království"], ["AT", "Austria", "Rakousko"]];
  var EN = {
    cat: { "Osobní automobil": "Passenger car", "Horské kolo": "Mountain bike" },
    rec: { "r-oct-serv": "120 000 service — oil, filters, brakes", "r-oct-stk": "STK + emissions", "r-oct-prask": "Broken spring, front right", "r-kolo": "Tune-up and a new cable" },
    sch: { "sch-octavia": "Service interval", "sch-kolo": "Brake pads" },
    ptype: { "Povinné ručení + havarijní": "Third-party liability + comprehensive" },
    preset: { "STK + emise": "STK + emissions", "TK + EK": "TK + emissions" }
  };

  function view(self, seg, query, hash, wide) {
    var A = window.HH_ASSETS, F = window.HH_FIXTURES, N = window.HH_NAV;
    if (!A) return null;
    var s = self.state, L = self.chatL.bind(self), web = s.client === "web", cs = s.locale === "cs";
    var nav = N ? N.navFor(s.member, s.household) : {};
    var grants = nav.grants || {};
    var lvl = grants.vehicles || "none";
    var ro = ["read_only", "canceled", "restricted"].indexOf(s.ent) >= 0 || s.screen === "readonly";
    var canC = LV.indexOf(lvl) >= 2 && !ro, canM = LV.indexOf(lvl) >= 3 && !ro;
    var me = s.member, TD = A.today, isEmpty = s.screen === "empty", off = !s.online;
    var members = F ? F.members : [];
    var name = function (id) { var m = members.filter(function (x) { return x.id === id; })[0]; return m ? m.name : id; };
    var go = function (r) { return function () { self.setState({ veSheet: null }); self.go(r); }; };

    /* ── words ── */
    var day = function (iso, y) {
      if (!iso) return "\u2013";
      var p = iso.split("-");
      return cs ? (+p[2]) + ". " + MCS[+p[1] - 1] + (y === false ? "" : " " + p[0]) : (+p[2]) + " " + MEN[+p[1] - 1] + (y === false ? "" : " " + p[0]);
    };
    var czk = function (n) { return A.czk(n || 0); };
    var num = function (n, d) { return A.num(n, d); };
    var km = function (n) { return num(n) + "\u00a0km"; };
    var kindOf = function (e) { return e.variant || "car"; };
    var plated = function (e) { return !!PLATED[kindOf(e)]; };
    var engined = function (e) { return !!ENGINE[kindOf(e)]; };
    var vN = function (e) { return e ? (cs ? e.cs : (e.en || e.cs)) : ""; };
    var catN = function (c) { return c ? (cs ? c : (EN.cat[c] || c)) : ""; };
    var typeN = function (k) { var t = TYPES.filter(function (x) { return x[0] === k; })[0]; return t ? (cs ? t[2] : t[1]) : k; };
    var fuelN = function (k) { var t = FUELS.filter(function (x) { return x[0] === k; })[0]; return t ? (cs ? t[2] : t[1]) : ""; };
    var ctryN = function (k) { var t = COUNTRIES.filter(function (x) { return x[0] === k; })[0]; return t ? (cs ? t[2] : t[1]) : k; };
    var schN = function (sc) { return cs ? sc.cs : (sc.en || EN.sch[sc.id] || sc.cs); };
    var recN = function (r) { return cs ? r.what : (r.en || EN.rec[r.id] || r.what); };
    var presetN = function (p) { return cs ? p : (EN.preset[p] || p); };
    var ptypeN = function (t) { return cs ? t : (EN.ptype[t] || t); };
    var months = function (n) { return n === 12 ? L("every year", "každý rok") : n === 24 ? L("every 2 years", "každé 2 roky") : n % 12 === 0 ? L("every " + n / 12 + " years", "každých " + n / 12 + " let") : L("every " + n + " months", "každých " + n + " měsíců"); };
    var basisW = function (sc) {
      var parts = [];
      if (sc.months) parts.push(months(sc.months));
      if (sc.everyUnit) parts.push(L("every ", "každých ") + num(sc.everyUnit) + "\u00a0" + sc.unit);
      return parts.join(L(" or ", " nebo ")) + (parts.length > 1 ? L(", whichever first", ", co přijde dřív") : "");
    };
    var parseNum = function (v) {
      var t = String(v == null ? "" : v).replace(/[\s\u00a0]/g, "").replace(",", ".");
      return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
    };
    var inW = function (n) { return n === 0 ? L("today", "dnes") : n === 1 ? L("tomorrow", "zítra") : L("in " + n + " days", "za " + n + " dní"); };

    /* ── blocks ── */
    var blk = function (t, p) { var o = {}; KINDS.forEach(function (x) { o["is" + x] = x === t; }); return Object.assign(o, p); };
    var inkOf = function (t) {
      return t === "danger" ? "var(--danger)" : t === "warn" ? "var(--warning)" : t === "accent" ? "var(--accent)"
        : t === "offline" ? "var(--status-offline)" : t === "muted" ? "var(--text-muted)" : t === "ok" ? "var(--positive)" : "var(--text-primary)";
    };
    var badgeStyle = function (t) {
      var ink = t ? inkOf(t) : "var(--text-muted)";
      return "font-family:'IBM Plex Mono',monospace;font-size:0.625em;letter-spacing:0.06em;text-transform:uppercase;padding:2px 6px;border-radius:4px;white-space:nowrap;border:1px solid " + ink + ";color:" + ink;
    };
    var row = function (p) {
      var fn = p.open || null;
      return Object.assign({ lead: "", dot: false, title: "", sub: "", badge: "", right: "", rightSub: "", act: "", onAct: null }, p, {
        chev: !!fn && !p.noChev, noOpen: !fn, open: fn || function () {},
        btnStyle: "flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:12px;min-height:56px;padding:10px 16px;border:none;font-family:inherit;text-align:left;color:inherit;background:" +
          (p.on ? "var(--surface-sunken)" : p.bg || "transparent") + ";box-shadow:" + (p.on ? "inset 3px 0 0 var(--accent)" : p.rule ? "inset 3px 0 0 " + inkOf(p.rule) : "none") + ";cursor:" + (fn ? "pointer" : "default"),
        titleStyle: "font-size:0.9375em;line-height:1.35;overflow-wrap:anywhere;font-weight:" + (p.strong ? "600" : "500") + ";color:" + (p.muted ? "var(--text-muted)" : "var(--text-primary)"),
        subStyle: "font-size:0.75em;line-height:1.45;overflow-wrap:anywhere;text-wrap:pretty;color:" + (p.subTone ? inkOf(p.subTone) : "var(--text-muted)"),
        rightStyle: "font-family:'IBM Plex Mono',monospace;font-size:0.84375em;white-space:nowrap;font-variant-numeric:tabular-nums;color:" + inkOf(p.tone),
        badgeStyle: badgeStyle(p.badgeTone),
        dotStyle: "flex:0 0 10px;width:10px;height:10px;border-radius:3px;background:" + (p.dotInk || "var(--border-strong)"),
        actStyle: "flex:0 0 auto;align-self:center;margin-right:12px;min-height:36px;padding:0 12px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:0.78125em;font-weight:600;white-space:nowrap;border:1px solid var(--accent);background:transparent;color:var(--accent)"
      });
    };
    var label = function (t, link, on) { return blk("Label", { text: t, link: link || "", onLink: on || function () {} }); };
    var rows = function (r) { r = r.filter(Boolean); return r.length ? blk("Rows", { rows: r }) : null; };
    var note = function (t, tone, link, on) {
      return blk("Note", { text: t, link: link || "", onLink: on || function () {},
        style: "display:flex;flex-direction:column;gap:6px;align-items:flex-start;font-size:0.8125em;line-height:1.6;text-wrap:pretty;max-width:68ch;" +
          (tone === "box" || tone === "boxWarn" || tone === "boxDanger" || tone === "boxOff" || tone === "boxOk"
            ? "margin:10px 16px;padding:12px 14px;border-radius:10px;background:var(--surface-sunken);color:var(--text-primary)" +
              (tone === "boxWarn" ? ";box-shadow:inset 3px 0 0 var(--warning)" : tone === "boxDanger" ? ";box-shadow:inset 3px 0 0 var(--danger)" : tone === "boxOff" ? ";box-shadow:inset 3px 0 0 var(--status-offline)" : tone === "boxOk" ? ";box-shadow:inset 3px 0 0 var(--positive)" : "")
            : "padding:10px 16px;color:" + inkOf(tone || "muted")) });
    };
    var btn = function (lbl, kind, on, dis) { return { label: lbl, style: self.docBtn(kind, dis ? false : undefined), on: dis ? function () {} : on, off: !!dis }; };
    var acts = function (list) { list = list.filter(Boolean); return list.length ? blk("Acts", { btns: list }) : null; };
    var kv = function (pairs) {
      pairs = pairs.filter(function (p) { return p && p[1] !== "" && p[1] != null; });
      return pairs.length ? blk("Kv", { pairs: pairs.map(function (p) { return { k: p[0], v: String(p[1]) }; }) }) : null;
    };
    var chip = function (nm, on, pick) { return { name: nm, style: self.docChip(on), pick: pick }; };
    var chips = function (lbl, items, hint) { return blk("Chips", { label: lbl || "", hint: hint || "", chips: items }); };
    var field = function (p) {
      return blk("Field", Object.assign({ label: "", value: "", placeholder: "", mode: "text", type: "text", suffix: "", err: "", hint: "", off: false }, p, {
        onChange: function (e) { p.set(e.target.value); },
        boxStyle: "display:flex;align-items:center;gap:8px;border:1px solid " + (p.err ? "var(--danger)" : "var(--border-strong)") +
          ";border-radius:8px;background:var(--input-bg);padding:0 12px;max-width:" + (p.narrow ? "260px" : "520px") + (p.off ? ";opacity:0.7" : "") }));
    };
    var empty = function (t, body, action, on) { return blk("Empty", { title: t, body: body, action: action || "", on: on || function () {} }); };
    var stat = function (k, v, sub, tone) {
      return { k: k, v: v, sub: sub || "", vStyle: "font-family:'IBM Plex Mono',monospace;font-size:1.0625em;font-weight:500;font-variant-numeric:tabular-nums;color:" + inkOf(tone) };
    };
    var hero = function (p) {
      return blk("Hero", Object.assign({ kicker: "", big: "", sub: "", stats: [] }, p, {
        hasStats: !!(p.stats && p.stats.length), hasNav: false, onPrev: function () {}, onNext: function () {}, prevOff: true, nextOff: true,
        bigStyle: "font-size:2.125em;font-weight:600;letter-spacing:-0.02em;line-height:1.15;overflow-wrap:anywhere;color:" + inkOf(p.tone) }));
    };
    var bars = function (list) {
      var max = list.reduce(function (n, p) { return Math.max(n, p.v); }, 0) || 1;
      return blk("Bars", { rows: list.map(function (p) {
        return { name: p.name, right: p.right, left: p.left || "", proj: p.proj || "",
          rightStyle: "font-family:'IBM Plex Mono',monospace;font-size:0.8125em;white-space:nowrap;color:" + (p.rightInk || "var(--text-primary)"),
          projStyle: "white-space:nowrap;color:var(--text-muted)",
          fill: "position:absolute;left:0;top:0;bottom:0;border-radius:4px;width:" + Math.max(p.v ? 2 : 0, Math.min(100, Math.round(p.v / max * 100))) + "%;background:" + (p.ink || "var(--accent)"),
          tick: "display:none", noOpen: !p.open, open: p.open || function () {}, cursor: p.open ? "pointer" : "default" };
      }) });
    };

    /* ── session writes ── */
    var bump = function (extra) { self.setState(Object.assign({ veRev: (self.state.veRev || 0) + 1 }, extra || {})); };
    var commit = function (doIt, undo, toast, extra) {
      doIt();
      bump(Object.assign({ veSheet: null }, extra || {}));
      if (typeof toast === "function") toast = toast();
      if (toast) self.docToastShow(toast + (off ? L(" \u00b7 saved on this device", " \u00b7 uloženo v zařízení") : ""), undo ? function () {
        undo(); bump({ docToast: null });
      } : null);
    };
    var open = function (d) { return function () { self.setState({ veSheet: Object.assign({ at: self.state.route }, d) }); }; };
    var uid = function (p) { return p + "-v" + (Date.now() % 1000000); };
    var slug = function (t) {
      var m = { "á": "a", "č": "c", "ď": "d", "é": "e", "ě": "e", "í": "i", "ň": "n", "ó": "o", "ř": "r", "š": "s", "ť": "t", "ú": "u", "ů": "u", "ý": "y", "ž": "z" };
      var b = String(t).toLowerCase().replace(/[áčďéěíňóřšťúůýž]/g, function (c) { return m[c]; }).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vozidlo";
      var id = b, n = 2;
      while (A.entity(id)) id = b + "-" + (n++);
      return id;
    };

    /* ── the engine, read ── */
    var fleet = A.entities.filter(function (e) { return e.module === "vehicles" && e.status === "active"; });
    var gone = A.entities.filter(function (e) { return e.module === "vehicles" && e.status !== "active"; });
    var dueOf = function (sc) { return safe(function () { return A.due(sc.id, TD); }, null); };
    var fuelUnit = function (e) { return e.fuel === "electric" ? "kWh" : "l"; };
    var fuelRows = function (id) {
      return A.fuel.filter(function (f) { return (f.entity || "octavia") === id; }).slice().sort(function (a, b) { return a.odo - b.odo || (a.date < b.date ? -1 : 1); });
    };
    var fuelLogOn = function (e) { return engined(e) && (e.fuelLog || fuelRows(e.id).length > 0); };
    /* consumption between consecutive full fills, partials accumulated — the same arithmetic as fuelRun, per vehicle */
    function fuelOf(id) {
      var F2 = fuelRows(id), fulls = [];
      F2.forEach(function (f, i) { if (f.full) fulls.push(i); });
      var iv = [];
      for (var k = 0; k < fulls.length - 1; k++) {
        var a = fulls[k], b = fulls[k + 1], lit = 0, cost = 0;
        for (var i = a + 1; i <= b; i++) { lit += F2[i].litres; cost += F2[i].cost; }
        var d = F2[b].odo - F2[a].odo;
        if (d > 0) iv.push({ from: F2[a], to: F2[b], km: d, litres: lit, cost: cost, per100: lit / d * 100, partials: b - a - 1 });
      }
      var closedKm = iv.reduce(function (n, x) { return n + x.km; }, 0), closedL = iv.reduce(function (n, x) { return n + x.litres; }, 0);
      var lastFull = fulls.length ? fulls[fulls.length - 1] : -1, openL = 0;
      for (var j = lastFull + 1; j < F2.length; j++) if (lastFull >= 0) openL += F2[j].litres;
      var allKm = F2.length > 1 ? F2[F2.length - 1].odo - F2[0].odo : 0;
      var allL = F2.slice(1).reduce(function (n, f) { return n + f.litres; }, 0);
      var cost = F2.reduce(function (n, f) { return n + f.cost; }, 0);
      return { rows: F2, fulls: fulls.length, partials: F2.length - fulls.length, intervals: iv,
        correct: closedKm ? closedL / closedKm * 100 : null, naive: allKm ? allL / allKm * 100 : null,
        openL: openL, openKm: lastFull >= 0 && F2.length ? F2[F2.length - 1].odo - F2[lastFull].odo : 0, openFrom: lastFull >= 0 ? F2[lastFull] : null,
        cost: cost, km: allKm, first: F2[0] || null, last: F2[F2.length - 1] || null };
    }
    var polOf = function (e) { return A.insurance.filter(function (p) { return p.entity === e.id; })[0] || null; };
    var noticeOf = function (p) { var fires = A.addDays(p.end, -p.noticeDays); return { fires: fires, inDays: A.diff(TD, fires), toEnd: A.diff(TD, p.end), passed: fires < TD, lapsed: p.end < TD }; };
    var isStk = function (r) { return !!r.stk || /^(STK|TK|MOT|HU|Przegl)/.test(r.what); };
    var isRepair = function (r) { return !!r.repair || /prask|pru|oprav/i.test(r.what); };
    function statOf(e) {
      if (!plated(e) || !e.firstReg) return null;
      var c = e.country || "CZ", p = A.statutory[c];
      if (!p) return { none: true, country: c };
      var then = e.statThen || p.then;
      var base = safe(function () { return A.statutoryFor(c, e.firstReg, TD); }, null);
      var next = e.statNext || (base ? base.next : null);
      var last = A.recordsOf(e.id).filter(isStk)[0] || null;
      var fut = next ? [next, A.addMonths(next, then), A.addMonths(next, then * 2)] : [];
      return { country: c, preset: p.inspection, then: then, first: p.first, next: next, inDays: next ? A.diff(TD, next) : null, overdue: next ? next < TD : false,
        future: fut, last: last, tax: p.tax, taxNote: p.taxNote || "", overridden: !!e.statNext || !!e.statThen, base: base };
    }
    var svcOf = function (e) {
      return A.schedulesOf(e.id).map(function (sc) { return { sc: sc, d: dueOf(sc) }; }).filter(function (x) { return x.d && x.d.resolved; })
        .sort(function (a, b) { return a.d.resolved < b.d.resolved ? -1 : 1; });
    };
    function datesOf(e) {
      var out = [], st = statOf(e), pol = polOf(e);
      if (st && st.next) out.push({ e: e, kind: "stk", date: st.next, title: presetN(st.preset), sub: vN(e) + " \u00b7 " + L("book the station", "objednejte se"), route: "/vehicles/" + e.id + "/statutory", overdue: st.overdue });
      if (pol) {
        var n = noticeOf(pol);
        if (!n.lapsed) out.push({ e: e, kind: "ins", date: n.passed ? pol.end : n.fires, title: n.passed ? L("Insurance renews", "Obnova pojištění") : L("Insurance notice period ends", "Končí výpovědní lhůta"),
          sub: vN(e) + " \u00b7 " + pol.insurer + " \u00b7 " + (n.passed ? L("switching now takes effect next year", "přejít jinam už jde až za rok") : L("renews ", "obnova ") + day(pol.end, false)), route: "/vehicles/" + e.id + "/insurance", overdue: false });
      }
      svcOf(e).forEach(function (x) {
        out.push({ e: e, kind: "svc", date: x.d.resolved, title: schN(x.sc), sub: vN(e) + " \u00b7 " + basisW(x.sc) + (x.d.estimate ? L(" \u00b7 estimate from usage", " \u00b7 odhad podle nájezdu") : ""), route: "/vehicles/" + e.id, overdue: x.d.overdue, x: x });
      });
      return out;
    }
    var allDates = fleet.reduce(function (a, e) { return a.concat(datesOf(e)); }, []).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var overdue = allDates.filter(function (x) { return x.overdue; });
    var soon = allDates.filter(function (x) { return !x.overdue && A.diff(TD, x.date) <= 30; });
    var REJ = A.rejectedReading;
    var rejOpen = REJ && !REJ.fixed && A.entity(REJ.entity) && A.entity(REJ.entity).status === "active";
    var docsOK = grants.documents && grants.documents !== "none";

    function tcoOf(e) {
      var fu = fuelOf(e.id), pol = polOf(e), recs = A.recordsOf(e.id), st = statOf(e);
      var svc = recs.filter(function (r) { return !isRepair(r); }).reduce(function (n, r) { return n + (r.cost || 0); }, 0);
      var rep = recs.filter(isRepair).reduce(function (n, r) { return n + (r.cost || 0); }, 0);
      var oldest = recs.length ? recs[recs.length - 1].date : null;
      var lines = [];
      if (fuelLogOn(e)) lines.push({ label: L("Fuel", "Palivo"), value: fu.cost, window: fu.first ? L("since ", "od ") + day(fu.first.date) : L("nothing logged", "nic zapsáno"), measured: true });
      if (plated(e)) lines.push({ label: L("Insurance", "Pojištění"), value: pol ? pol.premium : 0, window: pol ? L("a year", "ročně") : L("no policy", "bez smlouvy"), measured: !!pol });
      lines.push({ label: L("Service", "Servis"), value: svc, window: oldest ? L("since ", "od ") + day(oldest) : L("nothing logged", "nic zapsáno"), measured: true });
      lines.push({ label: L("Repairs", "Opravy"), value: rep, window: oldest ? L("since ", "od ") + day(oldest) : L("nothing logged", "nic zapsáno"), measured: true });
      if (plated(e) && st && !st.none) lines.push(st.tax ? { label: L("Road tax", "Silniční daň"), value: e.roadTax || 0, window: e.roadTax ? L("a year", "ročně") : L("not entered", "nezadáno"), measured: !!e.roadTax }
        : { label: L("Road tax", "Silniční daň"), value: 0, window: ctryN(st.country) + L(": none", ": není"), measured: false, absent: true });
      if (e.price && e.currentValue != null) lines.push({ label: L("Loss of value", "Ztráta hodnoty"), value: e.price - e.currentValue, window: L("since ", "od ") + day(e.acquired), measured: true });
      var total = lines.reduce(function (n, l) { return n + (l.measured ? l.value : 0); }, 0);
      return { lines: lines, total: total, fu: fu, perKm: fu.km ? fu.cost / fu.km : null };
    }

    var dueRight = function (date, od) {
      var n = A.diff(TD, date);
      return od ? { right: -n + L(" d late", " d po"), tone: "danger" } : n === 0 ? { right: L("today", "dnes"), tone: "accent" } : { right: day(date, false), tone: n <= 30 ? "accent" : "" };
    };
    var dateRow = function (x, withV) {
      var dr = dueRight(x.date, x.overdue);
      return row({ title: x.title, sub: withV === false ? x.sub.replace(vN(x.e) + " \u00b7 ", "") : x.sub, right: dr.right, tone: dr.tone,
        rightSub: x.overdue ? L("was ", "bylo ") + day(x.date, false) : inW(A.diff(TD, x.date)),
        badge: x.overdue ? L("overdue", "po termínu") : x.kind === "svc" && x.x && x.x.d.estimate ? L("estimate", "odhad") : "", badgeTone: x.overdue ? "danger" : "muted",
        act: canC && x.kind === "svc" ? L("Log service", "Zapsat servis") : canC && x.kind === "stk" ? L("Passed", "Prošlo") : "",
        onAct: canC && x.kind === "svc" ? open(logDraft(x.e, x.x.sc)) : canC && x.kind === "stk" ? open(passDraft(x.e)) : null,
        open: go(x.route) });
    };
    var vehRow = function (e) {
      var ds = datesOf(e)[0], dr = ds ? dueRight(ds.date, ds.overdue) : null, lr = A.latest(e.id, "km");
      return row({ title: vN(e), sub: [e.plate || (e.frame ? L("frame ", "rám ") + e.frame : typeN(kindOf(e))), lr ? km(lr.milli / 1000) : "", (e.drivers || []).map(name).join(", ")].filter(Boolean).join(" \u00b7 "),
        right: dr ? dr.right : "", tone: dr ? dr.tone : "", rightSub: ds ? ds.title : L("nothing scheduled", "nic naplánováno"),
        badge: e.queued && off ? L("pending", "čeká") : "", badgeTone: "offline", open: go("/vehicles/" + e.id) });
    };
    var recRow = function (r, withV) {
      var e = A.entity(r.entity);
      return row({ title: recN(r), sub: [withV ? vN(e) : "", r.by, r.value != null && r.unit ? num(r.value) + "\u00a0" + r.unit : "", r.docs ? r.docs + L(" doc", " dok.") : ""].filter(Boolean).join(" \u00b7 "),
        right: r.cost ? czk(r.cost) : "", rightSub: day(r.date), badge: r.queued && off ? L("pending", "čeká") : isRepair(r) ? L("repair", "oprava") : isStk(r) ? L("inspection", "kontrola") : "", badgeTone: r.queued && off ? "offline" : "muted",
        open: open({ kind: "record", id: r.id }) });
    };
    function logDraft(e, sc) {
      var lr = A.latest(e.id, "km");
      return { kind: "log", entity: e.id, sch: sc ? sc.id : "", date: TD, what: sc ? schN(sc) : "", by: "", cost: "", reading: lr && lr.date === TD ? String(lr.milli / 1000) : "", repair: false, err: "" };
    }
    function passDraft(e) { return { kind: "pass", entity: e.id, date: TD, cost: "", by: "", reading: "", err: "" }; }
    function fuelDraft(e) { return { kind: "fuel", entity: e.id, date: TD, odo: "", litres: "", cost: "", full: true, station: "", err: "" }; }
    function readDraft(e) { return { kind: "reading", entity: e.id, date: TD, value: "", err: "" }; }

    /* ── route ── */
    var page = "home", cur = null, sub = "";
    var eng = seg[0] === "assets";
    var a = eng ? (seg[2] || "") : (seg[1] || ""), b = eng ? (seg[3] || "") : (seg[2] || ""), c = eng ? "" : (seg[3] || "");
    var SUBS = { statutory: 1, insurance: 1, fuel: 1, costs: 1, readings: 1, records: 1, schedules: 1 };
    if (!a || a === "new") page = "home";
    else if (a === "due") page = "due";
    else if (a === "retired") page = "retired";
    else {
      cur = A.entity(a);
      if (!cur || cur.module !== "vehicles") page = "missing";
      else if (!b || b === "edit") page = "item";
      else if (SUBS[b]) page = b;
      else page = "missing";
      if (page === "statutory" && !plated(cur)) page = "item";
      if (page === "insurance" && !plated(cur)) page = "item";
      if (page === "fuel" && !engined(cur)) page = "item";
    }
    var itemRoot = cur ? "/vehicles/" + cur.id : "/vehicles";

    var routeSheet = null;
    if (a === "new" && canC) routeSheet = vehDraft(null, "/vehicles");
    if (page === "item" && b === "edit" && canC) routeSheet = Object.assign(vehDraft(cur), { back: itemRoot });
    if (page === "fuel" && c === "new" && canC) routeSheet = Object.assign(fuelDraft(cur), { back: itemRoot + "/fuel" });
    var sheetD = (s.veSheet && s.veSheet.at === s.route) ? s.veSheet : routeSheet;
    var patch = function (p) { self.setState({ veSheet: Object.assign({}, sheetD, { at: self.state.route }, p) }); };
    var closeSheet = function () { var back = sheetD && sheetD.back; self.setState(Object.assign({ veSheet: null }, back ? { route: back } : {})); };

    function vehDraft(e, back) {
      if (e) return { kind: "vehicle", edit: e.id, type: kindOf(e), name: vN(e), brand: e.brand || "", model: e.model || "", year: e.year ? String(e.year) : "", plate: e.plate || "", vin: e.vin || "",
        frame: e.frame || "", battery: e.battery || "", fuel: e.fuel || "", firstReg: e.firstReg || "", acquired: e.acquired || "", price: e.price != null ? String(e.price) : "",
        value: e.currentValue != null ? String(e.currentValue) : "", drivers: (e.drivers || []).slice(), months: "", every: "", err: "" };
      return { kind: "vehicle", edit: null, type: "car", name: "", brand: "", model: "", year: "", plate: "", vin: "", frame: "", battery: "", fuel: "petrol", firstReg: "", acquired: "", price: "", value: "",
        drivers: [me], months: "12", every: "15000", err: "", back: back || null };
    }

    var P = [], headTitle = L("Vehicles", "Vozidla"), headSub = "";
    var push = function (x) { if (x) P.push(x); };
    var readNote = ro ? L("Read-only while the subscription is past due. Everything recorded still reads, and the dates keep computing.", "Jen ke čtení, dokud se předplatné neobnoví. Vše zapsané zůstává čitelné a termíny se počítají dál.")
      : lvl === "view" ? L("You can see Vehicles. Logging a fill-up or a service needs contribute.", "Vozidla vidíte. Zapsat tankování nebo servis vyžaduje přispívání.") : "";
    if (readNote) push(note(readNote, "box"));
    if (off) push(note(L("Offline. The vehicles, the odometer, the fuel log and the dates are on this device and worked out here. Fill-ups and readings queue and go up with the signal; the inspection date and the insurance policy wait for a connection.",
      "Offline. Vozidla, tachometr, tankování i termíny jsou v zařízení a počítají se tady. Tankování a stavy se řadí do fronty; datum STK a pojistka počkají na připojení."), "boxOff"));

    /* ═══ pages ═══ */
    if (page === "missing") {
      headTitle = L("Vehicles", "Vozidla");
      push(empty(L("Not in this household", "V téhle domácnosti není"), L("It was removed, or it was never here.", "Bylo odebráno, nebo tu nikdy nebylo."), L("Back to Vehicles", "Zpět na Vozidla"), go("/vehicles")));
    }

    if (page === "home") {
      headTitle = L("Vehicles", "Vozidla"); headSub = fleet.length ? fleet.length + L(fleet.length === 1 ? " vehicle" : " vehicles", " vozidla") : "";
      if (isEmpty || !fleet.length) {
        var EM = A.empty.vehicles;
        push(empty(cs ? EM.s : "A car, a motorbike, a bike, a trailer \u2014 anything with dates and costs.",
          cs ? EM.e : "The Octavia, for example \u2014 STK on 5 October, insurance until November.",
          canC ? (cs ? EM.a : "Add a vehicle") : "", open(vehDraft(null))));
      } else {
        var lead = overdue[0] || allDates[0];
        var yr = TD.slice(0, 4);
        var spent = A.records.filter(function (r) { var e = A.entity(r.entity); return e && e.module === "vehicles" && r.date.slice(0, 4) === yr; }).reduce(function (n, r) { return n + (r.cost || 0); }, 0) +
          A.fuel.filter(function (f) { var e = A.entity(f.entity || "octavia"); return e && e.status === "active" && f.date.slice(0, 4) === yr; }).reduce(function (n, f) { return n + f.cost; }, 0);
        push(hero({ kicker: lead ? vN(lead.e) : "",
          big: !lead ? L("Nothing due", "Nic není na řadě") : lead.overdue ? lead.title + L(" is overdue", " je po termínu") : lead.title + " " + inW(A.diff(TD, lead.date)),
          tone: lead && lead.overdue ? "danger" : "",
          sub: lead ? day(lead.date) + " \u00b7 " + lead.sub.replace(vN(lead.e) + " \u00b7 ", "") : "",
          stats: [
            stat(L("Vehicles", "Vozidel"), String(fleet.length), fleet.map(function (e) { return typeN(kindOf(e)).toLowerCase(); }).join(", ")),
            stat(L("Due in 30 days", "Do 30 dní"), String(overdue.length + soon.length), overdue.length ? overdue.length + L(" overdue", " po termínu") : L("nothing overdue", "nic po termínu"), overdue.length ? "danger" : ""),
            stat(L("Spent in " + yr, "Utraceno " + yr), czk(spent), L("fuel, services and repairs", "palivo, servis a opravy"))
          ] }));
        var fuelCar = fleet.filter(fuelLogOn)[0];
        if (canC && !wide) push(acts([fuelCar ? btn(L("Log a fill-up", "Zapsat tankování"), "primary", open(fuelDraft(fuelCar))) : null, btn(L("+ Vehicle", "+ Vozidlo"), fuelCar ? "" : "primary", open(vehDraft(null)))]));
        if (rejOpen) push(note(L("One odometer reading came back rejected: " + km(REJ.milli / 1000) + " on " + day(REJ.date, false) + " is less than the " + km(REJ.againstMilli / 1000) + " already recorded on " + day(REJ.against, false) + ". The value is kept until somebody fixes it.",
          "Jeden stav tachometru se vrátil odmítnutý: " + km(REJ.milli / 1000) + " z " + day(REJ.date, false) + " je míň než " + km(REJ.againstMilli / 1000) + " z " + day(REJ.against, false) + ". Hodnota zůstává, dokud ji někdo neopraví."), "boxDanger",
          canC ? L("Fix it", "Opravit") : L("See it", "Zobrazit"), canC ? open({ kind: "fix", entity: REJ.entity, value: String(REJ.milli / 1000), err: "" }) : go("/assets/vehicle/" + REJ.entity + "/readings")));
        push(label(L("Coming up", "Na řadě"), L("All dates", "Všechny termíny"), go("/vehicles/due")));
        var near = overdue.concat(soon);
        push(near.length ? rows(near.map(function (x) { return dateRow(x); })) : note(L("Nothing in the next 30 days. The next is " + (allDates[0] ? allDates[0].title + " on " + day(allDates[0].date, false) : "not set") + ".",
          "Do 30 dní nic. Další je " + (allDates[0] ? allDates[0].title + " " + day(allDates[0].date, false) : "nenastaveno") + ".")));
        push(label(L("Ours", "Naše vozidla"), canC ? L("+ Vehicle", "+ Vozidlo") : "", open(vehDraft(null))));
        push(rows(fleet.map(vehRow)));
        if (gone.length && !wide) push(rows([row({ title: L("Sold and scrapped", "Prodané a vyřazené"), sub: gone.length + L(" \u00b7 history kept", " \u00b7 historie zůstává"), open: go("/vehicles/retired") })]));
      }
    }

    if (page === "due") {
      headTitle = L("All dates", "Všechny termíny"); headSub = allDates.length + L(" across " + fleet.length + " vehicles", " u " + fleet.length + " vozidel");
      if (!allDates.length) push(empty(L("Nothing dated yet.", "Zatím nic s datem."), L("A car gets its inspection date from the first registration; a bike from a service interval.", "Auto dostane datum STK z první registrace, kolo z intervalu servisu."), "", null));
      else {
        if (overdue.length) { push(label(L("Overdue", "Po termínu"))); push(rows(overdue.map(function (x) { return dateRow(x); }))); }
        var up = allDates.filter(function (x) { return !x.overdue; });
        [["stk", L("Statutory inspections", "Zákonné kontroly")], ["ins", L("Insurance", "Pojištění")], ["svc", L("Services", "Servis")]].forEach(function (g) {
          var rs = up.filter(function (x) { return x.kind === g[0]; });
          if (rs.length) { push(label(g[1])); push(rows(rs.map(function (x) { return dateRow(x); }))); }
        });
        push(note(L("An inspection date comes from the first registration and the country's rule. An insurance date is the end of the notice period, not the renewal, so there is still time to switch. A service date is by months or by km, whichever comes first \u2014 the km one is an estimate from how much the vehicle is driven.",
          "Datum STK vychází z první registrace a pravidla země. U pojištění je to konec výpovědní lhůty, ne den obnovy, aby šlo ještě přejít jinam. Servis je podle měsíců nebo km, co přijde dřív \u2014 km je odhad podle nájezdu.")));
      }
    }

    if (page === "item") {
      var e = cur, k0 = kindOf(e), live = e.status === "active";
      headTitle = vN(e); headSub = [typeN(k0), e.plate || e.frame || ""].filter(Boolean).join(" \u00b7 ");
      if (!live) push(note(L((e.how === "sold" ? "Sold " : "Scrapped ") + day(e.ended) + (e.soldFor ? " for " + czk(e.soldFor) : "") + ". Nothing is scheduled and no reminders go out; the history stays.",
        (e.how === "sold" ? "Prodáno " : "Vyřazeno ") + day(e.ended) + (e.soldFor ? " za " + czk(e.soldFor) : "") + ". Nic se neplánuje a připomínky nechodí; historie zůstává."), "box",
        canM ? L("Put it back", "Vrátit zpět") : "", canM ? function () {
          var old = { status: e.status, ended: e.ended, how: e.how, soldFor: e.soldFor };
          commit(function () { e.status = "active"; delete e.ended; delete e.how; delete e.soldFor; }, function () { Object.assign(e, old); }, vN(e) + L(" is back", " je zpět"));
        } : null));
      if (e.queued && off) push(note(L("Added on this device. It is here, editable, and waits for the signal.", "Přidáno v zařízení. Je tu, dá se upravit a čeká na signál."), "boxOff"));
      var ds0 = live ? datesOf(e) : [], lead0 = ds0.filter(function (x) { return x.overdue; })[0] || ds0[0];
      var lr0 = A.latest(e.id, "km");
      if (live) {
        push(hero({ kicker: [e.brand, e.model, e.year].filter(Boolean).join(" "),
          big: lead0 ? (lead0.overdue ? lead0.title + L(" is overdue", " je po termínu") : lead0.title + " " + inW(A.diff(TD, lead0.date))) : L("Nothing due", "Nic není na řadě"),
          tone: lead0 && lead0.overdue ? "danger" : "", sub: lead0 ? day(lead0.date) + " \u00b7 " + lead0.sub.replace(vN(e) + " \u00b7 ", "") : "",
          stats: [lr0 ? stat(L("Odometer", "Tachometr"), km(lr0.milli / 1000), day(lr0.date, false) + " \u00b7 " + name(lr0.by)) : stat(L("Odometer", "Tachometr"), "\u2013", L("no reading yet", "zatím bez stavu"), "muted"),
            fuelLogOn(e) && fuelOf(e.id).correct != null ? stat(L("Consumption", "Spotřeba"), num(fuelOf(e.id).correct, 2) + "\u00a0" + fuelUnit(e) + "/100", L("between full tanks", "mezi plnými nádržemi")) : null,
            stat(L("Costs logged", "Zapsané náklady"), czk(tcoOf(e).total), L("everything with a window", "vše s obdobím"))].filter(Boolean) }));
        push(acts([canC && fuelLogOn(e) ? btn(L("Log a fill-up", "Zapsat tankování"), "primary", open(fuelDraft(e))) : null,
          canC ? btn(L("Log a service", "Zapsat servis"), fuelLogOn(e) ? "" : "primary", open(logDraft(e, (svcOf(e)[0] || {}).sc))) : null,
          canC ? btn(L("Odometer", "Stav tachometru"), "", open(readDraft(e))) : null,
          canC ? btn(L("Edit", "Upravit"), "", open(vehDraft(e))) : null]));
        if (rejOpen && REJ.entity === e.id) push(note(L("A reading of " + km(REJ.milli / 1000) + " from " + day(REJ.date, false) + " was rejected. It is kept and marked; nothing else waits for it.", "Stav " + km(REJ.milli / 1000) + " z " + day(REJ.date, false) + " byl odmítnut. Zůstává označený; nic jiného na něj nečeká."), "boxDanger",
          canC ? L("Fix it", "Opravit") : "", canC ? open({ kind: "fix", entity: e.id, value: String(REJ.milli / 1000), err: "" }) : null));
      }
      if (live && ds0.length) { push(label(L("Coming up", "Na řadě"))); push(rows(ds0.map(function (x) { return dateRow(x, false); }))); }
      if (live) {
        var st0 = statOf(e), pol0 = polOf(e), tc0 = tcoOf(e);
        var mods = [];
        if (plated(e)) mods.push(st0 && st0.none
          ? row({ title: L("Statutory inspection", "Zákonná kontrola"), sub: L("No preset for " + ctryN(st0.country) + " \u2014 enter the date by hand", "Pro " + ctryN(st0.country) + " nemáme předvolbu \u2014 zadejte ručně"), subTone: "warn", open: go(itemRoot + "/statutory") })
          : !st0 ? row({ title: L("Statutory inspection", "Zákonná kontrola"), sub: L("Needs the first registration date", "Potřebuje datum první registrace"), subTone: "warn", open: go(itemRoot + "/statutory") })
          : row({ title: presetN(st0.preset), sub: months(st0.then) + " \u00b7 " + ctryN(st0.country) + (st0.overridden ? L(" \u00b7 date set by hand", " \u00b7 datum ručně") : ""), right: day(st0.next, false), tone: st0.overdue ? "danger" : st0.inDays <= 30 ? "accent" : "", rightSub: inW(st0.inDays), open: go(itemRoot + "/statutory") }));
        if (plated(e)) mods.push(pol0 ? (function () { var n0 = noticeOf(pol0); return row({ title: L("Insurance", "Pojištění"), sub: pol0.insurer + " \u00b7 " + L("renews ", "obnova ") + day(pol0.end, false) + " \u00b7 " + czk(pol0.premium) + L(" a year", " ročně"),
          right: n0.passed ? L("renews ", "obnova ") + day(pol0.end, false) : day(n0.fires, false), tone: !n0.passed && n0.inDays <= 30 ? "warn" : "", rightSub: n0.passed ? L("notice passed", "lhůta uplynula") : L("notice by", "výpověď do"), open: go(itemRoot + "/insurance") }); })()
          : row({ title: L("Insurance", "Pojištění"), sub: L("Not entered", "Nezadáno"), muted: true, act: canC ? L("Add", "Zadat") : "", onAct: canC ? open(polDraft(e, null)) : null, open: go(itemRoot + "/insurance") }));
        if (engined(e)) { var fu0 = fuelOf(e.id); mods.push(row({ title: e.fuel === "electric" ? L("Charging log", "Nabíjení") : L("Fuel log", "Tankování"),
          sub: fuelLogOn(e) ? fu0.rows.length + L(" entries", " záznamů") + (fu0.correct != null ? " \u00b7 " + num(fu0.correct, 2) + "\u00a0" + fuelUnit(e) + "/100\u00a0km" : "") : L("Off until you turn it on", "Vypnuté, dokud ho nezapnete"), muted: !fuelLogOn(e), open: go(itemRoot + "/fuel") })); }
        mods.push(row({ title: L("What it costs", "Co nás to stojí"), sub: tc0.lines.length + L(" lines, each with its window", " řádků, každý se svým obdobím"), right: czk(tc0.total), open: go(itemRoot + "/costs") }));
        push(label(L("For this vehicle", "K tomuto vozidlu")));
        push(rows(mods));
        var schs0 = A.schedulesOf(e.id);
        push(label(L("Service interval", "Servisní interval"), schs0.length ? L("Open", "Otevřít") : "", go("/assets/vehicle/" + e.id + "/schedules")));
        push(schs0.length ? rows(schs0.map(function (sc) {
          var d = dueOf(sc); if (!d) return row({ title: schN(sc), sub: basisW(sc), muted: true });
          return row({ title: schN(sc), sub: basisW(sc) + (d.usageDueAt ? L(" \u00b7 at ", " \u00b7 při ") + km(d.usageDueAt) : ""), right: day(d.resolved, false), tone: d.overdue ? "danger" : d.inDays <= 30 ? "accent" : "",
            rightSub: d.estimate ? L("estimate", "odhad") : L("by date", "podle data"), open: go("/assets/vehicle/" + e.id + "/schedules") });
        })) : note(L("No service interval. Nothing will remind anyone to change the oil.", "Bez intervalu nikdo nepřipomene výměnu oleje."), "", canM ? L("Add one", "Přidat") : "", canM ? open(schDraft(e, null)) : null));
        push(label(L("Odometer", "Tachometr"), L("Log", "Záznamy"), go("/assets/vehicle/" + e.id + "/readings")));
        push(rows([row({ title: lr0 ? km(lr0.milli / 1000) : L("No reading yet", "Zatím bez stavu"), sub: lr0 ? day(lr0.date) + " \u00b7 " + name(lr0.by) + (lr0.src === "fuel" ? L(" \u00b7 from a fill-up", " \u00b7 z tankování") : "") : L("The service interval counts by date until there is one.", "Interval se do té doby počítá jen podle data."),
          muted: !lr0, act: canC ? L("Add", "Zapsat") : "", onAct: canC ? open(readDraft(e)) : null, open: go("/assets/vehicle/" + e.id + "/readings") })]));
      }
      var recs0 = A.recordsOf(e.id);
      push(label(L("History", "Historie") + (recs0.length ? " \u00b7 " + czk(A.costOf(e.id)) : ""), recs0.length > 3 ? L("All " + recs0.length, "Vše (" + recs0.length + ")") : recs0.length ? L("Open", "Otevřít") : "", go("/assets/vehicle/" + e.id + "/records")));
      push(recs0.length ? rows(recs0.slice(0, 3).map(function (r) { return recRow(r); })) : note(L("History starts with the first service logged.", "Historie začíná prvním zápisem servisu.")));
      push(label(L("What it is", "Co to je")));
      push(kv([[L("Type", "Druh"), typeN(k0) + (e.category ? " \u00b7 " + catN(e.category) : "")], [L("Make and model", "Značka a model"), [e.brand, e.model].filter(Boolean).join(" ")], [L("Year", "Rok výroby"), e.year],
        plated(e) ? [L("Registration", "SPZ"), e.plate] : null, plated(e) ? ["VIN", e.vin] : null, !plated(e) ? [L("Frame number", "Číslo rámu"), e.frame] : null,
        engined(e) ? [L("Fuel", "Palivo"), fuelN(e.fuel)] : null, k0 === "ebike" ? [L("Battery health", "Stav baterie"), e.battery] : null,
        plated(e) ? [L("First registration", "První registrace"), e.firstReg ? day(e.firstReg) : ""] : null, plated(e) ? [L("Registered in", "Registrováno v"), ctryN(e.country || "CZ")] : null,
        [L("Bought", "Koupeno"), e.acquired ? day(e.acquired) + (e.price ? " \u00b7 " + czk(e.price) : "") : ""], [L("Worth now", "Hodnota teď"), e.currentValue != null ? czk(e.currentValue) + L(" \u00b7 your estimate", " \u00b7 váš odhad") : ""],
        [L("Who drives it", "Kdo jezdí"), (e.drivers || []).map(name).join(", ")]]));
      if (!plated(e)) push(note(L("A bicycle has no plate, no VIN and no statutory inspection, so none of them are asked for. The frame number is what the police ask for if it is stolen.", "Kolo nemá SPZ, VIN ani STK, takže se na ně neptáme. Číslo rámu je to, co chce policie, když ho někdo ukradne.")));
      if (e.docs) { push(label(L("Documents", "Dokumenty"))); push(rows([row({ title: e.docs + L(e.docs === 1 ? " document" : " documents", " dokumentů"), sub: plated(e) ? L("technical licence, insurance card, service invoices", "technický průkaz, zelená karta, faktury ze servisu") : L("receipt and warranty", "účtenka a záruka"), open: docsOK ? go("/documents") : null })])); }
      if (live && canM) push(acts([btn(L("Sell or scrap", "Prodat / vyřadit"), "danger-ghost", open({ kind: "retire", entity: e.id, how: "sold", date: TD, price: "", err: "" }))]));
    }

    function polDraft(e, p) {
      if (p) return { kind: "policy", entity: e.id, edit: p.id, insurer: p.insurer, type: p.type, number: p.number || "", premium: String(p.premium), start: p.start, end: p.end, notice: String(p.noticeDays), err: "" };
      return { kind: "policy", entity: e.id, edit: null, insurer: "", type: L("Third-party liability", "Povinné ručení"), number: "", premium: "", start: TD, end: A.addDays(A.addMonths(TD, 12), -1), notice: "42", err: "" };
    }
    function schDraft(e, sc) {
      if (sc) return { kind: "schedule", entity: e.id, edit: sc.id, name: schN(sc), months: sc.months ? String(sc.months) : "", every: sc.everyUnit ? String(sc.everyUnit) : "", lastDone: sc.lastDone, lastValue: sc.lastValue != null ? String(sc.lastValue) : "", err: "" };
      var lr = A.latest(e.id, "km");
      return { kind: "schedule", entity: e.id, edit: null, name: "", months: "12", every: plated(e) ? "15000" : "1500", lastDone: TD, lastValue: lr ? String(lr.milli / 1000) : "", err: "" };
    }

    if (page === "statutory") {
      var e5 = cur, st5 = statOf(e5);
      headTitle = L("Statutory inspection", "Zákonné termíny"); headSub = vN(e5);
      if (!st5) push(empty(L("It needs the first registration date.", "Potřebuje datum první registrace."), L("It is on the technical licence, field B. From it and the country, the date follows.", "Je v technickém průkazu, pole B. Z něj a ze země vyjde datum."),
        canC ? L("Add the date", "Doplnit datum") : "", open(vehDraft(e5))));
      else if (st5.none) {
        var SE = A.screens.filter(function (x) { return x.id === "E-24"; })[0];
        push(empty(L("We don't have a preset for " + ctryN(st5.country) + " yet.", SE ? SE.empty.s : ""), L("Enter the date and how often \u2014 two fields.", SE ? SE.empty.e : ""), canM ? L("Enter by hand", SE ? SE.empty.a : "") : "", canM ? open({ kind: "statdate", entity: e5.id, next: e5.statNext || "", then: e5.statThen ? String(e5.statThen) : "24", err: "" }) : null));
      } else {
        push(hero({ kicker: presetN(st5.preset) + " \u00b7 " + ctryN(st5.country), big: st5.overdue ? L("Overdue since ", "Po termínu od ") + day(st5.next, false) : day(st5.next), tone: st5.overdue ? "danger" : st5.inDays <= 30 ? "accent" : "",
          sub: (st5.overdue ? L("Driving without a valid inspection is a fine, and the insurer can refuse a claim.", "Jízda bez platné STK je pokuta a pojišťovna může odmítnout plnění.") : inW(st5.inDays) + " \u00b7 " + (st5.overridden ? L("set by hand", "nastaveno ručně") : L((st5.first / 12) + " years from new, then ", (st5.first / 12) + " roky od nového, pak ") + months(st5.then).replace(/^every/, "every"))) }));
        if (canC) push(acts([btn(L("Record a pass", "Zapsat, že prošlo"), "primary", open(passDraft(e5))), canM ? btn(L("Change the date", "Změnit datum"), "", open({ kind: "statdate", entity: e5.id, next: st5.next, then: String(st5.then), err: "" }), off) : null]));
        if (!st5.overdue && st5.inDays <= 42) push(note(L("Stations book up two to three weeks ahead in autumn. The reminder went out six weeks before for this reason.", "Stanice mají na podzim plno dva až tři týdny dopředu. Proto připomínka chodí šest týdnů předem."), "boxWarn"));
        push(label(L("Next dates", "Další termíny")));
        push(rows(st5.future.map(function (d, i) { return row({ title: day(d), sub: i === 0 ? L("next", "nejbližší") : L("if it passes on time", "když projde včas"), dot: true, dotInk: i === 0 ? "var(--accent)" : "var(--border-strong)", right: i === 0 ? inW(A.diff(TD, d)) : "", tone: i === 0 ? "accent" : "muted" }); })));
        push(label(L("Last passed", "Naposledy prošlo")));
        push(st5.last ? rows([recRow(st5.last)]) : note(L("No inspection logged yet. The date comes from the first registration alone.", "Zatím žádná zapsaná STK. Datum vychází jen z první registrace.")));
        push(label(L("Registered in", "Registrováno v")));
        push(chips("", COUNTRIES.map(function (x) {
          return chip(cs ? x[2] : x[1], (e5.country || "CZ") === x[0], canM && !off ? function () {
            if ((e5.country || "CZ") === x[0]) return;
            var old = { country: e5.country, statNext: e5.statNext, statThen: e5.statThen };
            commit(function () { e5.country = x[0]; delete e5.statNext; delete e5.statThen; }, function () { Object.assign(e5, old); },
              function () { var n = statOf(e5); return ctryN(x[0]) + (n && !n.none ? " \u00b7 " + presetN(n.preset) + " " + day(n.next) : L(" \u00b7 no preset, enter the date by hand", " \u00b7 bez předvolby, zadejte ručně")); });
          } : function () {});
        }), canM ? L("The country decides the name and the rule. Changing it recomputes the date.", "Země určuje název i pravidlo. Změna přepočítá datum.") : ""));
        push(note(st5.tax ? (cs ? st5.taxNote : "Road tax is due here yearly. Enter it on the costs screen and it becomes a reminder.") : (cs ? st5.taxNote : "Passenger cars in Czechia have no road tax, so there is no reminder for it on this vehicle at all."), "box"));
        push(note(L("The rules are reference data kept per country and versioned, not built into the app. The date and the cadence can both be overwritten.", "Pravidla jsou referenční data po zemích, verzovaná, ne zadrátovaná v aplikaci. Datum i periodu jde přepsat.")));
      }
    }

    if (page === "insurance") {
      var e6 = cur, p6 = polOf(e6);
      headTitle = L("Insurance", "Pojištění"); headSub = vN(e6);
      if (!p6 || isEmpty) push(empty(L("No insurance entered.", "Pojištění není zadané."), L("Kooperativa, until 11 November, six weeks' notice.", "Kooperativa, do 11. 11., výpověď 6 týdnů předem."), canC ? L("Enter the policy", "Zadat pojištění") : "", open(polDraft(e6, null))));
      else {
        var n6 = noticeOf(p6);
        push(hero({ kicker: p6.insurer + " \u00b7 " + ptypeN(p6.type), big: n6.lapsed ? L("Ended ", "Skončilo ") + day(p6.end, false) : n6.passed ? L("Renews ", "Obnova ") + day(p6.end, false) : L("Notice by ", "Výpověď do ") + day(n6.fires, false),
          tone: n6.lapsed ? "danger" : !n6.passed && n6.inDays <= 30 ? "warn" : "",
          sub: n6.lapsed ? L("There is no cover on record from " + day(A.addDays(p6.end, 1), false) + ". Driving uninsured is not allowed.", "Od " + day(A.addDays(p6.end, 1), false) + " není zapsané krytí. Bez ručení se jezdit nesmí.")
            : n6.passed ? L("The notice period has passed. It renews with " + p6.insurer + "; switching now takes effect from the next renewal.", "Výpovědní lhůta uplynula. Pojistka se obnoví u " + p6.insurer + "; přejít jinam jde až k další obnově.")
            : inW(n6.inDays) + L(" \u00b7 the policy renews on ", " \u00b7 obnova ") + day(p6.end) + L(". After the notice date it renews on its own.", ". Po tomhle dni se obnoví sama.") }));
        push(acts([canC ? btn(L("Renewed as it is", "Obnoveno beze změny"), "primary", function () {
          var old = { start: p6.start, end: p6.end };
          commit(function () { p6.start = A.addDays(p6.end, 1); p6.end = A.addMonths(p6.end, 12); }, function () { Object.assign(p6, old); }, function () { return L("Renewed to ", "Obnoveno do ") + day(p6.end) + L(" \u00b7 notice by ", " \u00b7 výpověď do ") + day(noticeOf(p6).fires, false); });
        }, off) : null, canC ? btn(L("Switching insurer", "Měníme pojišťovnu"), "", open(Object.assign(polDraft(e6, null), { switchFrom: p6.id, start: A.addDays(p6.end, 1), end: A.addMonths(p6.end, 12), notice: String(p6.noticeDays) })), off) : null,
          canC ? btn(L("Edit", "Upravit"), "", open(polDraft(e6, p6)), off) : null]));
        push(kv([[L("Insurer", "Pojišťovna"), p6.insurer], [L("Cover", "Krytí"), ptypeN(p6.type)], [L("Policy number", "Číslo smlouvy"), p6.number], [L("Premium", "Pojistné"), czk(p6.premium) + L(" a year", " ročně")],
          [L("Runs", "Platí"), day(p6.start) + " \u2013 " + day(p6.end)], [L("Notice period", "Výpovědní lhůta"), p6.noticeDays + L(" days before renewal", " dní před obnovou")], [L("We remind you", "Připomeneme"), day(A.addDays(n6.fires, -14)) + L(", two weeks before the notice date", ", dva týdny před koncem lhůty")],
          [L("Policy document", "Smlouva"), p6.docs ? L("in Documents \u00b7 fetched when opened", "v Dokumentech \u00b7 stáhne se při otevření") : L("not attached", "nepřiložena")]]));
        push(note(L("The reminder is set from the notice date, not the renewal. On the renewal day it is already too late to switch.", "Připomínka se řídí koncem výpovědní lhůty, ne dnem obnovy. V den obnovy už se přejít nikam nedá."), "box"));
        if (off) push(note(L("The policy is money with a date on it, so changes to it wait for a connection rather than queue. Two offline versions would be two different contracts.", "Pojistka jsou peníze s datem, takže změny počkají na připojení. Dvě offline verze by byly dvě různé smlouvy."), "offline"));
        push(note(L("The same rule as a Finance subscription and a Utilities contract.", "Stejné pravidlo jako u předplatného ve Financích a smlouvy v Energiích.")));
      }
    }

    if (page === "fuel") {
      var e7 = cur, fu7 = fuelOf(e7.id), u7 = fuelUnit(e7);
      headTitle = e7.fuel === "electric" ? L("Charging log", "Nabíjení") : L("Fuel log", "Tankování"); headSub = vN(e7);
      if (!fuelLogOn(e7) || isEmpty) {
        var FE = A.screens.filter(function (x) { return x.id === "E-26"; })[0];
        push(empty(L("The fuel log is off until you turn it on.", FE ? FE.empty.s : ""), L("The first full tank is the zero point everything counts from.", FE ? FE.empty.e : ""), canC ? L("Turn on and log the first", FE ? FE.empty.a : "") : "",
          canC ? function () { e7.fuelLog = true; self.setState({ veRev: (self.state.veRev || 0) + 1, veSheet: Object.assign({ at: self.state.route }, fuelDraft(e7)) }); } : null));
      } else {
        var hp7 = (A.help || []).filter(function (h) { return h.id === "vehicles.fuel.partial"; })[0];
        push(hero({ kicker: L("Between full tanks", "Mezi plnými nádržemi"), big: fu7.correct != null ? num(fu7.correct, 2) + "\u00a0" + u7 + "/100\u00a0km" : L("Needs two full tanks", "Potřebuje dvě plné nádrže"),
          sub: fu7.correct != null ? L("over ", "za ") + km(fu7.intervals.reduce(function (n, x) { return n + x.km; }, 0)) + L(" in ", " v ") + fu7.intervals.length + L(fu7.intervals.length === 1 ? " interval" : " intervals", " intervalech") : L("Consumption appears after the second full fill. Partial fills before then are kept and added in.", "Spotřeba se ukáže po druhé plné nádrži. Dolévání mezi tím se sečte."),
          stats: [stat(L("Entries", "Záznamů"), String(fu7.rows.length), fu7.fulls + L(" full, ", " plných, ") + fu7.partials + L(" partial", " dolitých")),
            stat(L("Spent on fuel", "Za palivo"), czk(fu7.cost), fu7.first ? L("since ", "od ") + day(fu7.first.date, false) : ""),
            fu7.km ? stat(L("Per km", "Na km"), num(fu7.cost / fu7.km, 2) + "\u00a0Kč", km(fu7.km) + L(" logged", " zapsáno")) : null].filter(Boolean) }));
        if (canC) push(acts([btn(L("Log a fill-up", "Zapsat tankování"), "primary", open(fuelDraft(e7)))]));
        if (fu7.intervals.length) {
          push(label(L("Consumption, " + u7 + "/100 km", "Spotřeba " + u7 + "/100 km")));
          push(bars(fu7.intervals.map(function (x, i) { return { name: day(x.from.date, false) + " \u2192 " + day(x.to.date, false), v: x.per100, right: num(x.per100, 2), proj: km(x.km) + (x.partials ? " \u00b7 " + x.partials + L(" partial", " dolito") : ""), ink: "var(--positive)" }; })
            .concat(fu7.naive != null && Math.abs(fu7.naive - fu7.correct) > 0.05 ? [{ name: L("every litre \u00f7 every km", "všechny litry \u00f7 všechny km"), v: fu7.naive, right: num(fu7.naive, 2), proj: L("the wrong way", "špatně"), ink: "var(--danger)", rightInk: "var(--danger)" }] : [])));
          if (fu7.openL) push(note(L("The last " + km(fu7.openKm) + " haven't used up the " + num(fu7.openL, 1) + " " + u7 + " put in since the last full tank, so they are not in the figure yet. They will be at the next full fill.",
            "Posledních " + km(fu7.openKm) + " ještě nespotřebovalo " + num(fu7.openL, 1) + " " + u7 + " od poslední plné nádrže, proto nejsou v čísle. Budou po další plné.")));
        }
        push(label(L("Newest first", "Od nejnovějšího")));
        push(rows(fu7.rows.slice().reverse().map(function (f) {
          return row({ title: num(f.litres, 1) + "\u00a0" + u7 + " \u00b7 " + czk(f.cost), sub: [day(f.date), km(f.odo), f.station, f.by ? name(f.by) : ""].filter(Boolean).join(" \u00b7 "),
            badge: f.queued && off ? L("pending", "čeká") : f.full ? L("full", "plná") : L("partial", "dolito"), badgeTone: f.queued && off ? "offline" : f.full ? "ok" : "muted",
            rule: f.full ? "ok" : "", open: open({ kind: "fuelView", ix: A.fuel.indexOf(f) }) });
        })));
        if (hp7) push(note((cs ? hp7.title : hp7.en.title) + " " + (cs ? hp7.body : hp7.en.body), "box"));
        push(note(L("The odometer on a fill-up is a reading in the same series as the odometer screen, so the two can't disagree and the service estimate moves with every fill.", "Tachometr u tankování je stav ve stejné řadě jako obrazovka tachometru, takže si nemůžou odporovat a odhad servisu se hýbe s každým tankováním.")));
      }
    }

    if (page === "costs") {
      var e8 = cur, t8 = tcoOf(e8);
      headTitle = L("What it costs", "Co nás to stojí"); headSub = vN(e8);
      if (!t8.lines.some(function (l) { return l.measured && l.value; }) || isEmpty) push(empty(L("Nothing to count from yet.", "Ještě není z čeho počítat."), plated(e8) ? L("Start with the insurance \u2014 one number and it already says something.", "Začněte pojištěním \u2014 jedno číslo a hned něco říká.") : L("Log the last service and what it cost.", "Zapište poslední servis a co stál."),
        canC ? (plated(e8) ? L("Enter the insurance", "Zadat pojištění") : L("Log a service", "Zapsat servis")) : "", plated(e8) ? go(itemRoot + "/insurance") : open(logDraft(e8, null))));
      else {
        push(hero({ kicker: L("Everything logged", "Vše zapsané"), big: czk(t8.total), sub: t8.perKm != null ? L("Fuel alone is ", "Samotné palivo je ") + num(t8.perKm, 2) + L(" Kč per km over the " + km(t8.fu.km) + " the log covers.", " Kč na km za " + km(t8.fu.km) + ", které kniha pokrývá.") : L("Each line is measured over its own window; they are not a year each.", "Každý řádek má své období; nejde o rok u každého.") }));
        push(bars(t8.lines.map(function (l) { return { name: l.label, v: l.measured ? l.value : 0, right: l.absent ? L("none", "není") : l.measured ? czk(l.value) : "\u2013", proj: l.window, ink: "var(--accent-family-things, var(--accent))", rightInk: l.measured ? "" : "var(--text-muted)" }; })));
        var tax8 = t8.lines.filter(function (l) { return l.absent; })[0];
        if (tax8) push(note(L("Road tax is a line that says none rather than a zero, because a zero would look like data somebody entered.", "Silniční daň je řádek s „není“ místo nuly, protože nula by vypadala jako zadaný údaj.")));
        var noPol = plated(e8) && !polOf(e8);
        if (noPol) push(note(L("No insurance entered, so it isn't in the total.", "Pojištění není zadané, takže není v součtu."), "boxWarn", canC ? L("Enter it", "Zadat") : "", go(itemRoot + "/insurance")));
        if (e8.price && e8.currentValue == null && canC) push(note(L("Bought for " + czk(e8.price) + ". Add what it's worth now and the loss of value becomes a line.", "Koupeno za " + czk(e8.price) + ". Doplňte současnou hodnotu a ztráta hodnoty bude řádek."), "", L("Add value", "Doplnit hodnotu"), open(vehDraft(e8))));
        push(note(L("Costs are added up here per vehicle. Finance keeps its own ledger and this is not a hidden copy of it.", "Náklady se tady sčítají po vozidlech. Finance mají vlastní evidenci a tohle není její skrytá kopie.")));
      }
    }

    if (page === "readings") {
      var e9 = cur; headTitle = L("Odometer", "Tachometr"); headSub = vN(e9);
      var rd9 = A.readingsOf(e9.id, "km").slice().reverse();
      if (rejOpen && REJ.entity === e9.id) {
        push(label(L("Rejected", "Odmítnuto")));
        push(rows([row({ title: km(REJ.milli / 1000) + " \u00b7 " + day(REJ.date, false), sub: cs ? REJ.says : REJ.en, subTone: "danger", badge: L("rejected", "odmítnuto"), badgeTone: "danger", rule: "danger", bg: "var(--surface-sunken)",
          act: canC ? L("Fix", "Opravit") : "", onAct: canC ? open({ kind: "fix", entity: e9.id, value: String(REJ.milli / 1000), err: "" }) : null })]));
      }
      if (!rd9.length) push(empty(L("No reading yet.", "Zatím bez stavu."), L("Without one the service interval counts by date only. The first number becomes the starting point.", "Bez něj se interval počítá jen podle data. První číslo bude výchozí bod."), canC ? L("Add a reading", "Zapsat stav") : "", open(readDraft(e9))));
      else {
        var rt9 = A.rate(e9.id, "km");
        push(hero({ kicker: L("Latest", "Poslední"), big: km(rd9[0].milli / 1000), sub: day(rd9[0].date) + " \u00b7 " + name(rd9[0].by) + (rt9 ? L(" \u00b7 about ", " \u00b7 zhruba ") + km(Math.round(rt9.perDay * 30)) + L(" a month lately", " měsíčně") : "") }));
        if (canC) push(acts([btn(L("Add a reading", "Zapsat stav"), "primary", open(readDraft(e9)))]));
        push(label(L("Newest first", "Od nejnovějšího")));
        push(rows(rd9.map(function (r, i) {
          var prev = rd9[i + 1];
          return row({ title: km(r.milli / 1000), sub: day(r.date) + " \u00b7 " + name(r.by) + (r.src === "fuel" ? L(" \u00b7 fill-up", " \u00b7 tankování") : r.src === "service" ? L(" \u00b7 service", " \u00b7 servis") : "") + (prev ? " \u00b7 +" + km((r.milli - prev.milli) / 1000) : L(" \u00b7 starting point", " \u00b7 výchozí bod")),
            badge: r.queued && off ? L("pending", "čeká") : "", badgeTone: "offline" });
        })));
      }
      push(note(L("One series that only goes up. A reading typed offline is checked against what this device holds; the server checks it against everything and can still send it back.", "Jedna řada, která jen roste. Stav zapsaný offline se zkontroluje proti tomu, co má zařízení; server proti všemu a může ho ještě vrátit.")));
    }

    if (page === "records") {
      var e10 = cur; headTitle = L("History", "Historie"); headSub = vN(e10);
      var rs10 = A.recordsOf(e10.id);
      if (!rs10.length) push(empty(L("History starts with the first entry.", "Historie začíná prvním zápisem."), L("\u201cOil, filters, brakes \u00b7 8 940 Kč \u00b7 121 400 km\u201d.", "„Olej, filtry, brzdy \u00b7 8 940 Kč \u00b7 121 400 km“."), canC ? L("Log a service", "Zapsat servis") : "", open(logDraft(e10, null))));
      else {
        push(hero({ kicker: rs10.length + L(" entries since ", " záznamů od ") + day(rs10[rs10.length - 1].date), big: czk(A.costOf(e10.id)), sub: L("services, repairs and inspections, from the entries below", "servis, opravy a kontroly ze záznamů níže") }));
        var by10 = {}; rs10.forEach(function (r) { var y = r.date.slice(0, 4); by10[y] = (by10[y] || 0) + (r.cost || 0); });
        var yrs10 = Object.keys(by10).sort();
        if (yrs10.length > 1) push(bars(yrs10.map(function (y) { return { name: y, v: by10[y], right: czk(by10[y]) }; })));
        if (canC && e10.status === "active") push(acts([btn(L("Log a service", "Zapsat servis"), "primary", open(logDraft(e10, null))), btn(L("Log a repair", "Zapsat opravu"), "", open(Object.assign(logDraft(e10, null), { repair: true })))]));
        push(label(L("Newest first", "Od nejnovějšího")));
        push(rows(rs10.map(function (r) { return recRow(r); })));
        push(note(L("Entries are appended, never merged, so they can be written on the garage forecourt with no signal. Correcting one happens online.", "Záznamy se jen přidávají, takže jdou psát i v servisu bez signálu. Opravuje se online.")));
      }
    }

    if (page === "schedules") {
      var e11 = cur; headTitle = L("Service interval", "Servisní interval"); headSub = vN(e11);
      var l11 = A.schedulesOf(e11.id);
      if (!l11.length) push(empty(L("No service interval yet.", "Zatím bez intervalu."), plated(e11) ? L("Octavia: every 12 months or 15 000 km.", "Octavia: každých 12 měsíců nebo 15 000 km.") : L("Brake pads: every 1 200 km.", "Brzdové destičky: každých 1 200 km."), canM ? L("Add an interval", "Přidat interval") : "", open(schDraft(e11, null))));
      l11.forEach(function (sc) {
        var d = dueOf(sc);
        push(label(schN(sc), canM ? L("Edit", "Upravit") : "", open(schDraft(e11, sc))));
        if (!d) return;
        push(kv([[L("Rule", "Pravidlo"), basisW(sc)], [L("Last done", "Naposledy"), day(sc.lastDone) + (sc.lastValue != null ? " \u00b7 " + km(sc.lastValue) : "")],
          sc.months ? [L("By date", "Podle data"), day(d.intervalDue)] : null,
          sc.everyUnit ? [L("By km", "Podle km"), d.noReading ? L("no reading yet", "zatím bez stavu") : L("at ", "při ") + km(d.usageDueAt) + (d.left != null ? " \u00b7 " + km(Math.max(0, Math.round(d.left))) + L(" to go", " zbývá") : "") + (d.usageDueOn ? L(" \u00b7 about ", " \u00b7 odhadem ") + day(d.usageDueOn) : "")] : null,
          [L("Answer", "Odpověď"), day(d.resolved) + " \u00b7 " + (d.noReading ? L("by date, because there is no reading", "podle data, protože chybí stav") : d.reason === "usage" ? L("by km \u2014 an estimate", "podle km \u2014 odhad") : sc.everyUnit ? L("by date, which comes first", "podle data, které přijde dřív") : L("by date", "podle data"))]]));
        if (canC) push(acts([btn(L("Log this service", "Zapsat tento servis"), "", open(logDraft(e11, sc)))]));
      });
      if (l11.length && canM) push(acts([btn(L("+ Another interval", "+ Další interval"), "", open(schDraft(e11, null)))]));
      var hp11 = (A.help || []).filter(function (h) { return h.id === "assets.schedule.dual"; })[0];
      if (hp11) push(note((cs ? hp11.title : hp11.en.title) + " " + (cs ? hp11.body : hp11.en.body), "box"));
    }

    if (page === "retired") {
      headTitle = L("Sold and scrapped", "Prodané a vyřazené");
      if (!gone.length) push(empty(L("Nothing sold or scrapped.", "Nic prodaného ani vyřazeného."), L("When a vehicle goes, its history stays here \u2014 useful when the buyer calls about the timing belt.", "Když vozidlo odejde, historie zůstane tady \u2014 hodí se, až kupec zavolá kvůli rozvodům."), "", null));
      else push(rows(gone.map(function (e) {
        return row({ title: vN(e), sub: (e.how === "sold" ? L("sold ", "prodáno ") : L("scrapped ", "vyřazeno ")) + day(e.ended) + (e.soldFor ? " \u00b7 " + czk(e.soldFor) : "") + " \u00b7 " + A.recordsOf(e.id).length + L(" entries kept", " záznamů zůstává"), muted: true, open: go("/vehicles/" + e.id) });
      })));
    }

    /* ═══ sheets ═══ */
    function oddCheck(e, date, v) {
      var rs = A.readingsOf(e.id, "km"), milli = Math.round(v * 1000);
      var before = rs.filter(function (r) { return r.date <= date; }).pop(), after = rs.filter(function (r) { return r.date > date; })[0];
      if (before && milli < before.milli) return L("Rejected: " + km(v) + " is less than " + km(before.milli / 1000) + " on " + day(before.date, false) + ". An odometer doesn't go back.", "Odmítnuto: " + km(v) + " je míň než " + km(before.milli / 1000) + " z " + day(before.date, false) + ". Tacho nejde zpátky.");
      if (after && milli > after.milli) return L("Rejected: that is more than the later " + km(after.milli / 1000) + " on " + day(after.date, false) + ".", "Odmítnuto: je to víc než pozdější " + km(after.milli / 1000) + " z " + day(after.date, false) + ".");
      return "";
    }
    function sheetBody(d) {
      var out = { title: "", sub: "", blocks: [], foot: [], footNote: "" }, B = out.blocks;
      var cancel = btn(L("Cancel", "Zrušit"), "", closeSheet), closeB = btn(L("Close", "Zavřít"), "", closeSheet);
      var e = d.entity ? A.entity(d.entity) : null;
      var lr = e ? A.latest(e.id, "km") : null;

      if (d.kind === "vehicle") {
        var t = d.type, isPl = !!PLATED[t], isEn = !!ENGINE[t];
        out.title = d.edit ? L("Edit ", "Upravit ") + d.name : L("Add a vehicle", "Přidat vozidlo");
        out.sub = d.edit ? "" : L("Pick what it is first \u2014 a bike is never asked for a plate.", "Nejdřív vyberte, co to je \u2014 kolo se na SPZ nikdy neptá.");
        if (!d.edit) B.push(chips(L("What it is", "Co to je"), TYPES.map(function (x) { return chip(cs ? x[2] : x[1], t === x[0], function () { patch({ type: x[0], every: PLATED[x[0]] ? "15000" : "1500", fuel: ENGINE[x[0]] ? (d.fuel || "petrol") : "" }); }); })));
        B.push(field({ label: L("Make", "Značka"), value: d.brand, placeholder: isPl ? "Škoda" : "Author", narrow: true, set: function (v) { patch({ brand: v, err: "" }); } }));
        B.push(field({ label: L("Model", "Model"), value: d.model, placeholder: isPl ? "Octavia Combi" : "Solution 29", narrow: true, set: function (v) { patch({ model: v, err: "" }); } }));
        B.push(field({ label: L("What you call it", "Jak mu říkáte"), value: d.name, placeholder: isPl ? L("The Octavia", "Octavia") : L("Adam's bike", "Adamovo kolo"), hint: L("Optional. Make and model otherwise.", "Nepovinné. Jinak značka a model."), set: function (v) { patch({ name: v, err: "" }); } }));
        B.push(field({ label: L("Year", "Rok výroby"), mode: "numeric", value: d.year, narrow: true, set: function (v) { patch({ year: v, err: "" }); } }));
        if (isPl) {
          B.push(field({ label: L("Registration", "SPZ"), value: d.plate, placeholder: "7B2 4413", narrow: true, set: function (v) { patch({ plate: v.toUpperCase(), err: "" }); } }));
          B.push(field({ label: "VIN", value: d.vin, placeholder: "TMBJJ7NE0J0123456", set: function (v) { patch({ vin: v.toUpperCase(), err: "" }); } }));
          B.push(field({ label: L("First registration", "První registrace"), type: "date", value: d.firstReg, narrow: true, hint: L("On the technical licence. The inspection date is worked out from it.", "V technickém průkazu. Z něj se spočítá datum STK."), set: function (v) { patch({ firstReg: v, err: "" }); } }));
        } else {
          B.push(field({ label: L("Frame number", "Číslo rámu"), value: d.frame, placeholder: "AU24-77 1902", narrow: true, hint: L("Stamped under the bottom bracket.", "Vyražené pod středovým složením."), set: function (v) { patch({ frame: v.toUpperCase(), err: "" }); } }));
          if (t === "ebike") B.push(field({ label: L("Battery health", "Stav baterie"), value: d.battery, placeholder: L("92 % \u00b7 checked at the shop", "92 % \u00b7 měřeno v servisu"), set: function (v) { patch({ battery: v }); } }));
        }
        if (isEn) B.push(chips(L("Fuel", "Palivo"), FUELS.map(function (x) { return chip(cs ? x[2] : x[1], d.fuel === x[0], function () { patch({ fuel: x[0] }); }); })));
        B.push(field({ label: L("Bought", "Koupeno"), type: "date", value: d.acquired, narrow: true, set: function (v) { patch({ acquired: v, err: "" }); } }));
        B.push(field({ label: L("Price", "Cena"), mode: "decimal", value: d.price, suffix: "Kč", narrow: true, set: function (v) { patch({ price: v, err: "" }); } }));
        if (d.edit) B.push(field({ label: L("Worth now", "Hodnota teď"), mode: "decimal", value: d.value, suffix: "Kč", narrow: true, hint: L("Your own estimate. It makes loss of value a line in the costs.", "Váš odhad. Ztráta hodnoty pak bude řádek v nákladech."), set: function (v) { patch({ value: v, err: "" }); } }));
        B.push(chips(L("Who drives it", "Kdo jezdí"), members.map(function (m) {
          var on = d.drivers.indexOf(m.id) >= 0;
          return chip(m.name, on, function () { patch({ drivers: on ? d.drivers.filter(function (x) { return x !== m.id; }) : d.drivers.concat([m.id]) }); });
        })));
        if (!d.edit) {
          B.push(field({ label: L("Service every", "Servis každých"), mode: "numeric", value: d.months, suffix: L("months", "měsíců"), narrow: true, set: function (v) { patch({ months: v, err: "" }); } }));
          B.push(field({ label: L("or every", "nebo každých"), mode: "numeric", value: d.every, suffix: "km", narrow: true, hint: L("Whichever comes first. Leave both empty for no interval.", "Co přijde dřív. Obojí prázdné = bez intervalu."), set: function (v) { patch({ every: v, err: "" }); } }));
        }
        if (off) B.push(note(L("No signal is fine. It saves on this device and is editable while it waits.", "Bez signálu nevadí. Uloží se v zařízení a dá se upravovat."), "offline"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(d.edit ? L("Save", "Uložit") : L("Add", "Přidat"), "primary", function () {
          var br = String(d.brand || "").trim(), mo = String(d.model || "").trim(), nm = String(d.name || "").trim() || [br, mo].filter(Boolean).join(" ");
          if (!nm) return patch({ err: L("A make and model, or a name. Everything else is optional.", "Značka a model, nebo název. Vše ostatní je nepovinné.") });
          var yr = d.year === "" ? null : parseNum(d.year);
          if (d.year !== "" && (!yr || yr < 1900 || yr > +TD.slice(0, 4) + 1 || yr % 1)) return patch({ err: L("The year is four digits, and not in the future.", "Rok jsou čtyři číslice a ne v budoucnu.") });
          var pl = isPl ? String(d.plate || "").trim() : "", vin = isPl ? String(d.vin || "").replace(/\s/g, "") : "", fr = !isPl ? String(d.frame || "").trim() : "";
          var others = A.entities.filter(function (x) { return x.module === "vehicles" && x.id !== d.edit; });
          if (pl && others.some(function (x) { return x.plate === pl; })) return patch({ err: L("Rejected: " + pl + " is already on another vehicle.", "Odmítnuto: " + pl + " už má jiné vozidlo.") });
          if (vin && vin.length !== 17) return patch({ err: L("A VIN is 17 characters. This one is " + vin.length + ".", "VIN má 17 znaků. Tenhle má " + vin.length + ".") });
          if (vin && others.some(function (x) { return x.vin === vin; })) return patch({ err: L("Rejected: that VIN is already on another vehicle.", "Odmítnuto: tohle VIN už má jiné vozidlo.") });
          if (fr && others.some(function (x) { return x.frame === fr; })) return patch({ err: L("Rejected: we already have a bike with that frame number.", "Odmítnuto: číslo rámu už u jednoho kola máme.") });
          if (d.firstReg && d.firstReg > TD) return patch({ err: L("The first registration is a day that has happened.", "První registrace je den, který už byl.") });
          if (d.acquired && d.acquired > TD) return patch({ err: L("The purchase date can't be after today.", "Datum koupě nemůže být po dnešku.") });
          if (d.acquired && d.firstReg && d.acquired < d.firstReg && isPl) return patch({ err: L("Rejected: it can't have been bought before it was first registered.", "Odmítnuto: nemohlo být koupeno před první registrací.") });
          var pr = d.price === "" ? null : parseNum(d.price), cv = d.value === "" || d.value == null ? null : parseNum(d.value);
          if (d.price !== "" && pr == null) return patch({ err: L("Type the price as a number.", "Zapište cenu číslem.") });
          if (d.value && cv == null) return patch({ err: L("Type the value as a number.", "Zapište hodnotu číslem.") });
          var mths = d.months === "" ? null : parseNum(d.months), evk = d.every === "" ? null : parseNum(d.every);
          if (!d.edit && ((d.months !== "" && (!mths || mths % 1)) || (d.every !== "" && !evk))) return patch({ err: L("Whole months, and a positive number of km.", "Celé měsíce a kladný počet km.") });
          var vals = { brand: br, model: mo, year: yr, acquired: d.acquired || "", price: pr, drivers: d.drivers.slice(), currentValue: cv };
          if (isPl) Object.assign(vals, { plate: pl, vin: vin, firstReg: d.firstReg || "" }); else vals.frame = fr;
          if (isEn) vals.fuel = d.fuel || "petrol";
          if (t === "ebike") vals.battery = String(d.battery || "").trim();
          if (d.edit) {
            var ex = A.entity(d.edit), old = {}; Object.keys(vals).concat(["cs", "en"]).forEach(function (k2) { old[k2] = ex[k2]; });
            commit(function () { Object.assign(ex, vals); if (nm !== vN(ex)) { ex.cs = nm; ex.en = nm; } }, function () { Object.assign(ex, old); }, L("Saved", "Uloženo"), d.back ? { route: d.back } : {});
          } else {
            var ne = Object.assign({ id: slug(nm), type: "vehicle", module: "vehicles", cs: nm, en: nm, status: "active", docs: 0, country: "CZ", insured: false, session: true, queued: off }, vals);
            if (t !== "car") ne.variant = t;
            var ns = mths || evk ? { id: uid("sch"), entity: ne.id, cs: "Servis", en: "Service", basis: mths && evk ? "both" : mths ? "interval" : "usage", months: mths || null, everyUnit: evk || null, unit: evk ? "km" : undefined, lastDone: vals.acquired || TD, lastValue: null, session: true } : null;
            commit(function () { A.entities.push(ne); if (ns) A.schedules.push(ns); }, function () { A.entities.splice(A.entities.indexOf(ne), 1); if (ns) A.schedules.splice(A.schedules.indexOf(ns), 1); },
              function () { var st = statOf(ne); return nm + L(" added", " přidáno") + (st && !st.none && st.next ? " \u00b7 " + presetN(st.preset) + " " + day(st.next) : ""); }, { route: "/vehicles/" + ne.id });
          }
        })];
      }

      if (d.kind === "fuel" && e) {
        var u = fuelUnit(e), fr0 = fuelRows(e.id), lastF = fr0[fr0.length - 1];
        out.title = e.fuel === "electric" ? L("Log a charge", "Zapsat nabíjení") : L("Log a fill-up", "Zapsat tankování"); out.sub = vN(e) + (lr ? L(" \u00b7 odometer ", " \u00b7 tacho ") + km(lr.milli / 1000) : "");
        B.push(field({ label: L("Odometer", "Tachometr"), mode: "numeric", value: d.odo, suffix: "km", narrow: true, placeholder: lr ? String(Math.round(lr.milli / 1000)) : "", err: d.err && /odometer|Tacho|km/.test(d.err) ? d.err : "", set: function (v) { patch({ odo: v, err: "" }); } }));
        B.push(field({ label: e.fuel === "electric" ? L("Energy", "Energie") : L("Litres", "Litrů"), mode: "decimal", value: d.litres, suffix: u, narrow: true, set: function (v) { patch({ litres: v, err: "" }); } }));
        B.push(field({ label: L("Paid", "Zaplaceno"), mode: "decimal", value: d.cost, suffix: "Kč", narrow: true, set: function (v) { patch({ cost: v, err: "" }); } }));
        var li = parseNum(d.litres), co = parseNum(d.cost);
        if (li && co) B.push(note(num(co / li, 2) + L(" Kč per " + u, " Kč za " + u), "muted"));
        B.push(chips(e.fuel === "electric" ? L("Charged to full?", "Nabito do plna?") : L("Filled to the top?", "Do plna?"), [chip(L("Full", "Plná"), d.full, function () { patch({ full: true }); }), chip(L("Partial", "Dolito"), !d.full, function () { patch({ full: false }); })],
          d.full ? L("Closes an interval and updates consumption.", "Uzavře interval a přepočítá spotřebu.") : L("Added to the open interval until the next full fill.", "Přičte se k otevřenému intervalu do příští plné.")));
        var stations = fr0.map(function (f) { return f.station; }).filter(function (x, i, arr) { return x && arr.indexOf(x) === i; }).slice(-4);
        if (stations.length) B.push(chips(L("Where", "Kde"), stations.map(function (x) { return chip(x, d.station === x, function () { patch({ station: d.station === x ? "" : x }); }); })));
        B.push(field({ label: stations.length ? L("Or somewhere else", "Nebo jinde") : L("Where", "Kde"), value: stations.indexOf(d.station) >= 0 ? "" : d.station, placeholder: "MOL Brno-Bystrc", set: function (v) { patch({ station: v }); } }));
        B.push(field({ label: L("When", "Kdy"), type: "date", value: d.date, narrow: true, set: function (v) { patch({ date: v, err: "" }); } }));
        if (off) B.push(note(L("No signal on the forecourt is the normal case. The fill-up is appended on this device; the odometer is checked against what the phone holds, and the server has the last word.", "Bez signálu u pumpy je normální. Tankování se přidá v zařízení; tacho se zkontroluje proti tomu, co má telefon, poslední slovo má server."), "offline"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          var o = parseNum(d.odo), l = parseNum(d.litres), cst = d.cost === "" ? 0 : parseNum(d.cost);
          if (o == null) return patch({ err: L("Type the odometer \u2014 consumption is worked out from it.", "Zapište stav tachometru \u2014 spotřeba se počítá z něj.") });
          if (!l) return patch({ err: L("How much went in, in " + u + ".", "Kolik se natankovalo, v " + u + ".") });
          if (cst == null) return patch({ err: L("Type what it cost as a number.", "Zapište cenu číslem.") });
          if (!d.date || d.date > TD) return patch({ err: L("A fill-up is logged on the day it happened.", "Tankování se zapisuje ke dni, kdy proběhlo.") });
          var bad = oddCheck(e, d.date, o); if (bad) return patch({ err: bad });
          var f = { entity: e.id, date: d.date, odo: o, litres: l, cost: cst, full: !!d.full, station: String(d.station || "").trim(), by: me, session: true, queued: off };
          var r = { entity: e.id, date: d.date, milli: Math.round(o * 1000), unit: "km", by: me, src: "fuel", session: true, queued: off };
          var dup = A.readingsOf(e.id, "km").some(function (x) { return x.date === d.date && x.milli === r.milli; });
          var before = fuelOf(e.id).correct;
          commit(function () { A.fuel.push(f); if (!dup) A.readings.push(r); e.fuelLog = true; }, function () { A.fuel.splice(A.fuel.indexOf(f), 1); if (!dup) A.readings.splice(A.readings.indexOf(r), 1); },
            function () { var now = fuelOf(e.id).correct; return num(l, 1) + "\u00a0" + u + L(" logged", " zapsáno") + (d.full && now != null ? " \u00b7 " + num(now, 2) + "\u00a0" + u + "/100\u00a0km" + (before != null && Math.abs(now - before) >= 0.01 ? L(" (was ", " (bylo ") + num(before, 2) + ")" : "") : L(" \u00b7 added to the open interval", " \u00b7 přičteno k otevřenému intervalu")); },
            d.back ? { route: d.back } : {});
        })];
      }

      if (d.kind === "fuelView") {
        var f0 = A.fuel[d.ix]; if (!f0) return null;
        var e0 = A.entity(f0.entity || "octavia");
        out.title = num(f0.litres, 1) + "\u00a0" + fuelUnit(e0) + " \u00b7 " + czk(f0.cost); out.sub = vN(e0) + " \u00b7 " + day(f0.date);
        B.push(kv([[L("Odometer", "Tachometr"), km(f0.odo)], [L("Tank", "Nádrž"), f0.full ? L("filled to the top", "do plna") : L("partial", "dolito")], [L("Where", "Kde"), f0.station], [L("Price per " + fuelUnit(e0), "Cena za " + fuelUnit(e0)), num(f0.cost / f0.litres, 2) + " Kč"], f0.by ? [L("Logged by", "Zapsal(a)"), name(f0.by)] : null]));
        out.foot = [closeB, canM ? btn(L("Delete entry", "Smazat záznam"), "danger-ghost", function () {
          var ix = A.fuel.indexOf(f0);
          commit(function () { A.fuel.splice(ix, 1); }, function () { A.fuel.splice(ix, 0, f0); }, L("Entry deleted \u00b7 the odometer reading stays", "Záznam smazán \u00b7 stav tachometru zůstává"));
        }, off) : null].filter(Boolean);
        if (off && canM) out.footNote = L("Corrections happen online. Adding works offline.", "Opravy jen online. Přidávat jde offline.");
      }

      if (d.kind === "reading" && e) {
        out.title = L("Odometer reading", "Stav tachometru"); out.sub = vN(e) + (lr ? L(" \u00b7 last ", " \u00b7 posledně ") + km(lr.milli / 1000) + " (" + day(lr.date, false) + ")" : "");
        B.push(field({ label: L("Reading", "Stav"), mode: "numeric", value: d.value, suffix: "km", narrow: true, err: d.err, set: function (v) { patch({ value: v, err: "" }); } }));
        B.push(field({ label: L("Date", "Datum"), type: "date", value: d.date, narrow: true, set: function (v) { patch({ date: v, err: "" }); } }));
        if (!lr) B.push(note(L("This is the first reading, so it becomes the starting point for the km half of the service interval.", "Je to první stav, takže bude výchozím bodem pro km část intervalu."), "box"));
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          var v = parseNum(d.value);
          if (v == null) return patch({ err: L("Type the number on the odometer.", "Zapište číslo z tachometru.") });
          if (!d.date || d.date > TD) return patch({ err: L("A reading is for a day that has happened.", "Stav je ke dni, který už byl.") });
          var bad = oddCheck(e, d.date, v); if (bad) return patch({ err: bad });
          var r = { entity: e.id, date: d.date, milli: Math.round(v * 1000), unit: "km", by: me, src: "manual", session: true, queued: off };
          var base = A.schedulesOf(e.id).filter(function (sc) { return sc.everyUnit && sc.lastValue == null; });
          commit(function () { A.readings.push(r); base.forEach(function (sc) { sc.lastValue = v; }); }, function () { A.readings.splice(A.readings.indexOf(r), 1); base.forEach(function (sc) { sc.lastValue = null; }); },
            km(v) + L(" recorded", " zapsáno") + (base.length ? L(" \u00b7 starting point set", " \u00b7 výchozí bod") : ""));
        })];
      }

      if (d.kind === "fix" && e) {
        var rsF = A.readingsOf(e.id, "km"), bF = rsF.filter(function (r) { return r.date <= REJ.date; }).pop(), aF = rsF.filter(function (r) { return r.date > REJ.date; })[0];
        out.title = L("Fix the rejected reading", "Opravit odmítnutý stav"); out.sub = vN(e) + " \u00b7 " + day(REJ.date) + " \u00b7 " + name(REJ.by);
        B.push(note(cs ? REJ.says : REJ.en, "boxDanger"));
        B.push(field({ label: L("What the odometer said", "Co ukazoval tachometr"), mode: "numeric", value: d.value, suffix: "km", narrow: true, err: d.err,
          hint: L("Between ", "Mezi ") + (bF ? km(bF.milli / 1000) : "0") + L(" and ", " a ") + (aF ? km(aF.milli / 1000) : "\u221e") + L(" for that day.", " pro ten den."), set: function (v) { patch({ value: v, err: "" }); } }));
        out.foot = [cancel, btn(L("Discard it", "Zahodit"), "danger-ghost", function () {
          commit(function () { REJ.fixed = "discarded"; }, function () { delete REJ.fixed; }, L("Rejected reading discarded", "Odmítnutý stav zahozen"));
        }), btn(L("Save the correction", "Uložit opravu"), "primary", function () {
          var v = parseNum(d.value);
          if (v == null) return patch({ err: L("Type the number on the odometer.", "Zapište číslo z tachometru.") });
          var bad = oddCheck(e, REJ.date, v); if (bad) return patch({ err: bad });
          var r = { entity: e.id, date: REJ.date, milli: Math.round(v * 1000), unit: "km", by: REJ.by, src: "manual", fixedBy: me, session: true, queued: off };
          commit(function () { A.readings.push(r); REJ.fixed = "corrected"; }, function () { A.readings.splice(A.readings.indexOf(r), 1); delete REJ.fixed; }, km(v) + L(" saved for ", " uloženo k ") + day(REJ.date, false));
        })];
      }

      if (d.kind === "log" && e) {
        out.title = d.repair ? L("Log a repair", "Zapsat opravu") : L("Log a service", "Zapsat servis"); out.sub = vN(e);
        var schs = A.schedulesOf(e.id);
        B.push(chips(L("What kind", "Druh"), [chip(L("Service", "Servis"), !d.repair, function () { patch({ repair: false }); }), chip(L("Repair", "Oprava"), d.repair, function () { patch({ repair: true, sch: "" }); })]));
        if (schs.length && !d.repair) B.push(chips(L("Which interval it resets", "Který interval tím začíná znovu"), schs.map(function (sc) {
          return chip(schN(sc), d.sch === sc.id, function () { patch({ sch: sc.id, what: d.what || schN(sc) }); });
        }).concat([chip(L("None", "Žádný"), !d.sch, function () { patch({ sch: "" }); })]), d.sch ? L("The next date and km count from this one.", "Další datum a km se počítají od tohoto.") : L("Kept in the history; no date moves.", "Zůstane v historii; žádný termín se neposune.")));
        B.push(field({ label: L("What was done", "Co se dělalo"), value: d.what, placeholder: d.repair ? L("Broken spring, front right", "Prasklá pružina vpravo vpředu") : L("Oil, filters, brakes", "Olej, filtry, brzdy"), set: function (v) { patch({ what: v, err: "" }); } }));
        B.push(field({ label: L("When", "Kdy"), type: "date", value: d.date, narrow: true, set: function (v) { patch({ date: v, err: "" }); } }));
        B.push(field({ label: L("Odometer then", "Tachometr tehdy"), mode: "numeric", value: d.reading, suffix: "km", narrow: true, hint: L("It makes the next km threshold reproducible.", "Další hranice v km pak sedí."), set: function (v) { patch({ reading: v, err: "" }); } }));
        var garages = A.records.filter(function (r) { var x = A.entity(r.entity); return x && x.module === "vehicles" && r.by; }).map(function (r) { return r.by; }).filter(function (x, i, arr) { return arr.indexOf(x) === i; }).slice(0, 4);
        if (garages.length) B.push(chips(L("Where", "Kde"), garages.map(function (g) { return chip(g, d.by === g, function () { patch({ by: d.by === g ? "" : g }); }); })));
        B.push(field({ label: garages.length ? L("Or somewhere else", "Nebo jinde") : L("Where", "Kde"), value: garages.indexOf(d.by) >= 0 ? "" : d.by, placeholder: "Auto Dvořák", set: function (v) { patch({ by: v }); } }));
        B.push(field({ label: L("What it cost", "Co to stálo"), mode: "decimal", value: d.cost, suffix: "Kč", narrow: true, set: function (v) { patch({ cost: v, err: "" }); } }));
        if (off) B.push(note(L("No signal is fine \u2014 an entry is appended, never merged. The invoice photo follows when the bytes can go.", "Bez signálu nevadí \u2014 záznam se jen přidá. Fotka faktury odejde se signálem."), "offline"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          var what = String(d.what || "").trim();
          if (!what) return patch({ err: L("Say what was done, in a few words.", "Napište pár slovy, co se dělalo.") });
          if (!d.date || d.date > TD) return patch({ err: L("It's logged on the day it happened, not ahead.", "Zapisuje se ke dni, kdy proběhlo, ne dopředu.") });
          if (e.acquired && d.date < e.acquired) return patch({ err: L("Rejected: an entry can't be older than the day it was bought.", "Odmítnuto: záznam nemůže být starší než koupě.") });
          var cost = d.cost === "" ? 0 : parseNum(d.cost);
          if (cost == null) return patch({ err: L("Type the cost as a number.", "Zapište cenu číslem.") });
          var rv = d.reading === "" ? null : parseNum(d.reading);
          if (d.reading !== "" && rv == null) return patch({ err: L("Type the odometer as a number.", "Zapište tachometr číslem.") });
          if (rv != null) { var bad = oddCheck(e, d.date, rv); if (bad) return patch({ err: bad }); }
          var r = { id: uid("r"), entity: e.id, date: d.date, what: what, en: what, by: String(d.by || "").trim() || name(me), cost: cost, docs: 0, actor: me, repair: !!d.repair, session: true, queued: off };
          if (rv != null) { r.value = rv; r.unit = "km"; }
          var rd = rv != null && !A.readingsOf(e.id, "km").some(function (x) { return x.date === d.date && x.milli === Math.round(rv * 1000); }) ? { entity: e.id, date: d.date, milli: Math.round(rv * 1000), unit: "km", by: me, src: "service", session: true, queued: off } : null;
          var sc = d.sch ? A.schedule(d.sch) : null, oldS = sc ? { lastDone: sc.lastDone, lastValue: sc.lastValue } : null, before = sc ? dueOf(sc) : null;
          commit(function () { A.records.push(r); if (rd) A.readings.push(rd); if (sc && d.date >= sc.lastDone) { sc.lastDone = d.date; if (rv != null) sc.lastValue = rv; } },
            function () { A.records.splice(A.records.indexOf(r), 1); if (rd) A.readings.splice(A.readings.indexOf(rd), 1); if (sc) Object.assign(sc, oldS); },
            function () { var after = sc ? dueOf(sc) : null; return L("Logged", "Zapsáno") + (after && d.date >= oldS.lastDone ? L(" \u00b7 next ", " \u00b7 další ") + day(after.resolved) + (after.usageDueAt ? L(" or ", " nebo ") + km(after.usageDueAt) : "") : "") + (before && before.overdue && after && !after.overdue ? L(" \u00b7 no longer overdue", " \u00b7 už ne po termínu") : ""); });
        })];
      }

      if (d.kind === "pass" && e) {
        var stP = statOf(e);
        out.title = L("Record a pass", "Zapsat, že prošlo"); out.sub = vN(e) + (stP && !stP.none ? " \u00b7 " + presetN(stP.preset) : "");
        B.push(field({ label: L("When", "Kdy"), type: "date", value: d.date, narrow: true, set: function (v) { patch({ date: v, err: "" }); } }));
        B.push(field({ label: L("Station", "Stanice"), value: d.by, placeholder: "STK Brno-jih", set: function (v) { patch({ by: v }); } }));
        B.push(field({ label: L("Fee", "Poplatek"), mode: "decimal", value: d.cost, suffix: "Kč", narrow: true, set: function (v) { patch({ cost: v, err: "" }); } }));
        B.push(field({ label: L("Odometer then", "Tachometr tehdy"), mode: "numeric", value: d.reading, suffix: "km", narrow: true, hint: L("It is on the protocol.", "Je v protokolu."), set: function (v) { patch({ reading: v, err: "" }); } }));
        if (stP && !stP.none && d.date) B.push(note(L("Next: ", "Další: ") + day(A.addMonths(d.date, stP.then)) + " \u00b7 " + months(stP.then), "box"));
        if (off) B.push(note(L("The inspection date carries legal weight, so moving it waits for a connection. The protocol itself can be logged later.", "Datum STK má právní váhu, takže jeho posun počká na připojení. Protokol jde zapsat později."), "boxOff"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          if (!d.date || d.date > TD) return patch({ err: L("A pass is logged on the day it happened.", "Zapisuje se ke dni, kdy prošlo.") });
          if (e.firstReg && d.date < e.firstReg) return patch({ err: L("Rejected: an inspection can't be before the first registration.", "Odmítnuto: termín nemůže být před první registrací.") });
          var cost = d.cost === "" ? 0 : parseNum(d.cost); if (cost == null) return patch({ err: L("Type the fee as a number.", "Zapište poplatek číslem.") });
          var rv = d.reading === "" ? null : parseNum(d.reading);
          if (rv != null) { var bad = oddCheck(e, d.date, rv); if (bad) return patch({ err: bad }); }
          var r = { id: uid("r"), entity: e.id, date: d.date, what: stP && !stP.none ? stP.preset : "STK", en: stP && !stP.none ? presetN(stP.preset) : "Inspection", stk: true, by: String(d.by || "").trim() || L("Inspection station", "Stanice STK"), cost: cost, docs: 0, actor: me, session: true, queued: off };
          if (rv != null) { r.value = rv; r.unit = "km"; }
          var old = { statNext: e.statNext };
          commit(function () { A.records.push(r); if (stP && !stP.none) e.statNext = A.addMonths(d.date, stP.then); }, function () { A.records.splice(A.records.indexOf(r), 1); if (old.statNext) e.statNext = old.statNext; else delete e.statNext; },
            function () { return L("Passed", "Prošlo") + (e.statNext ? L(" \u00b7 next ", " \u00b7 další ") + day(e.statNext) : ""); });
        }, off)];
      }

      if (d.kind === "statdate" && e) {
        out.title = L("Change the inspection date", "Změnit datum STK"); out.sub = vN(e);
        B.push(field({ label: L("Next inspection", "Příští kontrola"), type: "date", value: d.next, narrow: true, set: function (v) { patch({ next: v, err: "" }); } }));
        B.push(field({ label: L("Then every", "Pak každých"), mode: "numeric", value: d.then, suffix: L("months", "měsíců"), narrow: true, set: function (v) { patch({ then: v, err: "" }); } }));
        var stD = statOf(e);
        if (stD && !stD.none && stD.base) B.push(note(L("The rule for " + ctryN(stD.country) + " gives ", "Pravidlo pro " + ctryN(stD.country) + " dává ") + day(stD.base.next) + L(". Override it if the protocol says otherwise.", ". Přepište, pokud protokol říká jinak."), "box",
          e.statNext || e.statThen ? L("Back to the rule", "Zpět na pravidlo") : "", function () {
            var old = { statNext: e.statNext, statThen: e.statThen };
            commit(function () { delete e.statNext; delete e.statThen; }, function () { Object.assign(e, old); }, L("Back to the rule \u00b7 ", "Zpět na pravidlo \u00b7 ") + day(stD.base.next));
          }));
        if (off) B.push(note(L("Needs a connection. Two owners changing one legal date offline is the case where the app asks rather than guesses.", "Potřebuje připojení. Dva lidé měnící jedno zákonné datum offline je případ, kdy se aplikace ptá, ne hádá."), "boxOff"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          if (!d.next) return patch({ err: L("Pick the date.", "Vyberte datum.") });
          if (e.firstReg && d.next < e.firstReg) return patch({ err: L("Rejected: the date can't be before the first registration.", "Odmítnuto: termín nemůže být před první registrací.") });
          var th = parseNum(d.then); if (!th || th % 1) return patch({ err: L("Whole months.", "Celé měsíce.") });
          var old = { statNext: e.statNext, statThen: e.statThen };
          commit(function () { e.statNext = d.next; e.statThen = th; }, function () { Object.assign(e, old); }, L("Inspection on ", "STK ") + day(d.next));
        }, off)];
      }

      if (d.kind === "policy" && e) {
        out.title = d.switchFrom ? L("The new policy", "Nová pojistka") : d.edit ? L("Edit the policy", "Upravit pojistku") : L("Enter the policy", "Zadat pojištění"); out.sub = vN(e);
        if (d.switchFrom) B.push(note(L("It starts the day after the old one ends. The old one is replaced, and the reminder moves to this one's notice date.", "Začíná den po konci staré. Stará se nahradí a připomínka se přesune na lhůtu nové."), "box"));
        B.push(field({ label: L("Insurer", "Pojišťovna"), value: d.insurer, placeholder: "Kooperativa", set: function (v) { patch({ insurer: v, err: "" }); } }));
        B.push(chips(L("Cover", "Krytí"), [[L("Third-party liability", "Povinné ručení")], ["Povinné ručení + havarijní"]].map(function (x) { var v = x[0]; return chip(ptypeN(v), d.type === v, function () { patch({ type: v }); }); })));
        B.push(field({ label: L("Policy number", "Číslo smlouvy"), value: d.number, narrow: true, set: function (v) { patch({ number: v }); } }));
        B.push(field({ label: L("Premium a year", "Pojistné ročně"), mode: "decimal", value: d.premium, suffix: "Kč", narrow: true, set: function (v) { patch({ premium: v, err: "" }); } }));
        B.push(field({ label: L("From", "Od"), type: "date", value: d.start, narrow: true, set: function (v) { patch({ start: v, err: "" }); } }));
        B.push(field({ label: L("Until", "Do"), type: "date", value: d.end, narrow: true, set: function (v) { patch({ end: v, err: "" }); } }));
        B.push(field({ label: L("Notice period", "Výpovědní lhůta"), mode: "numeric", value: d.notice, suffix: L("days", "dní"), narrow: true, hint: L("In the policy terms. Czech motor policies are usually six weeks.", "V pojistných podmínkách. U ručení bývá šest týdnů."), set: function (v) { patch({ notice: v, err: "" }); } }));
        var nd = parseNum(d.notice);
        if (d.end && nd) B.push(note(L("Notice by ", "Výpověď do ") + day(A.addDays(d.end, -nd)) + L(". The reminder goes out two weeks before that.", ". Připomínka přijde dva týdny předtím."), "box"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, d.edit && canM ? btn(L("Remove", "Odebrat"), "danger-ghost", function () {
          var p = A.insurance.filter(function (x) { return x.id === d.edit; })[0], ix = A.insurance.indexOf(p);
          commit(function () { A.insurance.splice(ix, 1); }, function () { A.insurance.splice(ix, 0, p); }, L("Policy removed", "Pojistka odebrána"));
        }, off) : null, btn(L("Save", "Uložit"), "primary", function () {
          var ins = String(d.insurer || "").trim();
          if (!ins) return patch({ err: L("Which insurer?", "Která pojišťovna?") });
          var pm = parseNum(d.premium); if (pm == null) return patch({ err: L("Type the premium as a number.", "Zapište pojistné číslem.") });
          if (!d.start || !d.end) return patch({ err: L("Both dates, from and until.", "Obě data, od a do.") });
          if (d.end <= d.start) return patch({ err: L("Rejected: the end can't be before the start.", "Odmítnuto: konec nemůže být před začátkem.") });
          if (!nd && d.notice !== "0") return patch({ err: L("The notice period in days \u2014 0 if there is none.", "Výpovědní lhůta ve dnech \u2014 0, pokud žádná není.") });
          var vals = { insurer: ins, type: d.type, number: String(d.number || "").trim(), premium: pm, cadence: "ročně", start: d.start, end: d.end, noticeDays: nd || 0 };
          if (d.edit) {
            var p = A.insurance.filter(function (x) { return x.id === d.edit; })[0], old = {}; Object.keys(vals).forEach(function (k2) { old[k2] = p[k2]; });
            commit(function () { Object.assign(p, vals); }, function () { Object.assign(p, old); }, L("Saved \u00b7 notice by ", "Uloženo \u00b7 výpověď do ") + day(A.addDays(vals.end, -vals.noticeDays)));
          } else {
            var oldP = d.switchFrom ? A.insurance.filter(function (x) { return x.id === d.switchFrom; })[0] : null, oix = oldP ? A.insurance.indexOf(oldP) : -1;
            var np = Object.assign({ id: uid("pol"), entity: e.id, docs: 0, session: true }, vals);
            commit(function () { if (oldP) A.insurance.splice(oix, 1); A.insurance.push(np); e.insured = true; }, function () { A.insurance.splice(A.insurance.indexOf(np), 1); if (oldP) A.insurance.splice(oix, 0, oldP); },
              (oldP ? L("Switched to ", "Přechod k ") + ins : ins + L(" saved", " uloženo")) + L(" \u00b7 notice by ", " \u00b7 výpověď do ") + day(A.addDays(vals.end, -vals.noticeDays)));
          }
        }, off)].filter(Boolean);
      }

      if (d.kind === "schedule" && e) {
        out.title = d.edit ? L("Edit the interval", "Upravit interval") : L("Add an interval", "Přidat interval"); out.sub = vN(e);
        B.push(field({ label: L("Name", "Název"), value: d.name, placeholder: plated(e) ? L("Service", "Servis") : L("Brake pads", "Brzdové destičky"), set: function (v) { patch({ name: v, err: "" }); } }));
        B.push(field({ label: L("Every", "Každých"), mode: "numeric", value: d.months, suffix: L("months", "měsíců"), narrow: true, set: function (v) { patch({ months: v, err: "" }); } }));
        B.push(field({ label: L("Or every", "Nebo každých"), mode: "numeric", value: d.every, suffix: "km", narrow: true, hint: L("Fill both and whichever comes first applies.", "Vyplňte obojí a platí, co přijde dřív."), set: function (v) { patch({ every: v, err: "" }); } }));
        B.push(field({ label: L("Last done", "Naposledy"), type: "date", value: d.lastDone, narrow: true, set: function (v) { patch({ lastDone: v, err: "" }); } }));
        B.push(field({ label: L("At", "Při"), mode: "numeric", value: d.lastValue, suffix: "km", narrow: true, set: function (v) { patch({ lastValue: v, err: "" }); } }));
        var mo = d.months === "" ? null : parseNum(d.months), ev = d.every === "" ? null : parseNum(d.every), lv = d.lastValue === "" ? null : parseNum(d.lastValue);
        if ((mo || ev) && d.lastDone) {
          var tmp = { id: "__ve_preview", entity: e.id, cs: "", basis: mo && ev ? "both" : mo ? "interval" : "usage", months: mo || null, everyUnit: ev || null, unit: "km", lastDone: d.lastDone, lastValue: lv };
          A.schedules.push(tmp); var pv = safe(function () { return A.due(tmp.id, TD); }, null); A.schedules.splice(A.schedules.indexOf(tmp), 1);
          if (pv && pv.resolved) B.push(note(L("Next: ", "Další: ") + day(pv.resolved) + " \u00b7 " + (pv.noReading ? L("by date, because there is no odometer reading yet", "podle data, protože chybí stav tachometru") : pv.reason === "usage" ? L("by km, an estimate", "podle km, odhad") : L("by date", "podle data")), "box"));
          else if (pv && tmp.basis === "usage") B.push(note(L("By km alone it needs two readings before it can say a date.", "Jen podle km potřebuje dva stavy, než řekne datum."), "boxWarn"));
        }
        if (off) B.push(note(L("An interval needs a connection to save. Logging a service works offline.", "Interval se ukládá jen online. Zapsat servis offline jde."), "boxOff"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, d.edit ? btn(L("Remove", "Odebrat"), "danger-ghost", function () {
          var sc = A.schedule(d.edit), ix = A.schedules.indexOf(sc);
          commit(function () { A.schedules.splice(ix, 1); }, function () { A.schedules.splice(ix, 0, sc); }, L("Interval removed \u00b7 the history stays", "Interval odebrán \u00b7 historie zůstává"));
        }, off) : null, btn(L("Save", "Uložit"), "primary", function () {
          if (!mo && !ev) return patch({ err: L("Rejected: an interval needs months, km, or both.", "Odmítnuto: interval potřebuje měsíce, km, nebo obojí.") });
          if ((mo && mo % 1) || (d.months !== "" && !mo) || (d.every !== "" && !ev)) return patch({ err: L("Whole months, and a positive number of km.", "Celé měsíce a kladný počet km.") });
          if (!d.lastDone || d.lastDone > TD) return patch({ err: L("Last done is a day that has happened.", "Naposledy je den, který už byl.") });
          var nm = String(d.name || "").trim() || L("Service", "Servis");
          var vals = { cs: nm, en: nm, basis: mo && ev ? "both" : mo ? "interval" : "usage", months: mo || null, everyUnit: ev || null, unit: ev ? "km" : undefined, lastDone: d.lastDone, lastValue: lv };
          if (d.edit) {
            var sc = A.schedule(d.edit), old = {}; Object.keys(vals).forEach(function (k2) { old[k2] = sc[k2]; });
            commit(function () { Object.assign(sc, vals); }, function () { Object.assign(sc, old); }, function () { var nd2 = dueOf(sc); return L("Interval saved", "Interval uložen") + (nd2 && nd2.resolved ? L(" \u00b7 next ", " \u00b7 další ") + day(nd2.resolved) : ""); });
          } else {
            var ns = Object.assign({ id: uid("sch"), entity: e.id, session: true }, vals);
            commit(function () { A.schedules.push(ns); }, function () { A.schedules.splice(A.schedules.indexOf(ns), 1); }, L("Interval added", "Interval přidán"));
          }
        }, off)].filter(Boolean);
      }

      if (d.kind === "retire" && e) {
        out.title = L("Sell or scrap " + vN(e), "Prodat nebo vyřadit: " + vN(e));
        out.sub = L("Nothing is deleted. The history, the fuel log and the costs stay.", "Nic se nesmaže. Historie, tankování i náklady zůstávají.");
        B.push(chips(L("What happened", "Co se stalo"), [chip(L("Sold", "Prodáno"), d.how === "sold", function () { patch({ how: "sold" }); }), chip(L("Scrapped", "Vyřazeno"), d.how === "scrapped", function () { patch({ how: "scrapped" }); })]));
        B.push(field({ label: L("When", "Kdy"), type: "date", value: d.date, narrow: true, set: function (v) { patch({ date: v, err: "" }); } }));
        if (d.how === "sold") B.push(field({ label: L("Sold for", "Prodáno za"), mode: "decimal", value: d.price, suffix: "Kč", narrow: true, set: function (v) { patch({ price: v, err: "" }); } }));
        var stops = [A.schedulesOf(e.id).length ? L("the service interval", "servisní interval") : "", statOf(e) && !statOf(e).none ? L("the inspection reminder", "připomínka STK") : "", polOf(e) ? L("the insurance reminder \u2014 cancel the policy with " + polOf(e).insurer + " yourself", "připomínka pojištění \u2014 pojistku u " + polOf(e).insurer + " zrušte sami") : ""].filter(Boolean);
        if (stops.length) B.push(note(L("Stops: ", "Zastaví se: ") + stops.join(", ") + ".", "box"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(d.how === "sold" ? L("Mark as sold", "Označit jako prodané") : L("Scrap it", "Vyřadit"), "danger", function () {
          if (!d.date || d.date > TD) return patch({ err: L("Pick the day it went.", "Vyberte den, kdy odešlo.") });
          var sp = d.how === "sold" && d.price !== "" ? parseNum(d.price) : null;
          if (d.how === "sold" && d.price !== "" && sp == null) return patch({ err: L("Type the price as a number.", "Zapište cenu číslem.") });
          var old = { status: e.status, ended: e.ended, how: e.how, soldFor: e.soldFor };
          commit(function () { e.status = "retired"; e.ended = d.date; e.how = d.how; e.soldFor = sp; }, function () { Object.assign(e, old); },
            vN(e) + (d.how === "sold" ? L(" sold", " prodáno") : L(" scrapped", " vyřazeno")) + L(" \u00b7 history kept", " \u00b7 historie zůstává"), { route: "/vehicles" });
        })];
      }

      if (d.kind === "record") {
        var r = A.records.filter(function (x) { return x.id === d.id; })[0];
        if (!r) return null;
        var re = A.entity(r.entity);
        out.title = recN(r); out.sub = vN(re) + " \u00b7 " + day(r.date);
        B.push(kv([[L("Where", "Kde"), r.by], [L("Cost", "Cena"), r.cost ? czk(r.cost) : L("nothing", "nic")], r.value != null && r.unit ? [L("Odometer then", "Tachometr tehdy"), num(r.value) + "\u00a0" + r.unit] : null,
          [L("Kind", "Druh"), isStk(r) ? L("inspection", "kontrola") : isRepair(r) ? L("repair", "oprava") : L("service", "servis")],
          [L("Invoice", "Faktura"), r.docs ? r.docs + L(" attached", " přiloženo") : L("none attached", "nepřiložena")], [L("Logged by", "Zapsal(a)"), name(r.actor)],
          r.queued && off ? [L("Status", "Stav"), L("Queued on this device", "Čeká v zařízení")] : null]));
        out.foot = [closeB, canM ? btn(L("Delete entry", "Smazat záznam"), "danger-ghost", function () {
          var ix = A.records.indexOf(r);
          commit(function () { A.records.splice(ix, 1); }, function () { A.records.splice(ix, 0, r); }, L("Entry deleted", "Záznam smazán"));
        }, off) : null].filter(Boolean);
        if (off && canM) out.footNote = L("Corrections happen online. Adding works offline.", "Opravy jen online. Přidávat jde offline.");
      }
      return out;
    }

    /* ── assemble ── */
    var footBar = function (bg) {
      return "position:sticky;bottom:0;margin-top:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--border);background:" + bg;
    };
    var panes = [];
    if (wide) {
      var navV = fleet.map(function (e) {
        var ds = datesOf(e)[0];
        return row({ title: vN(e), sub: ds ? ds.title + " \u00b7 " + day(ds.date, false) : typeN(kindOf(e)), subTone: ds && ds.overdue ? "danger" : "", on: cur && cur.id === e.id, noChev: true, open: go("/vehicles/" + e.id) });
      });
      var navO = [row({ title: L("All dates", "Všechny termíny"), sub: overdue.length ? overdue.length + L(" overdue", " po termínu") : soon.length + L(" in 30 days", " do 30 dní"), subTone: overdue.length ? "danger" : "", right: String(allDates.length), on: page === "due" || page === "home", noChev: true, open: go("/vehicles/due") })];
      if (gone.length) navO.push(row({ title: L("Sold and scrapped", "Prodané a vyřazené"), sub: String(gone.length), on: page === "retired" || (cur && cur.status !== "active"), noChev: true, open: go("/vehicles/retired") }));
      var navTop = canC ? [acts([btn(L("+ Vehicle", "+ Vozidlo"), "primary", open(vehDraft(null)))])] : [];
      panes.push({ key: "nav", role: "navigation", title: L("Vehicles", "Vozidla"),
        outer: "flex:0 0 " + (web ? "300px" : "36%") + ";min-width:0;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--border);background:var(--surface)",
        inner: "flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column", col: "display:flex;flex-direction:column;padding-bottom:24px",
        onOuter: function () {}, hasHead: false, sub: "", hasFoot: false, foot: [], footNote: "", footStyle: "",
        blocks: navTop.filter(Boolean).concat([label(L("Ours", "Naše vozidla")), rows(navV) || note(L("None yet.", "Zatím žádné.")), rows(navO)]).filter(Boolean) });
    }
    panes.push({ key: "main", role: "region", title: headTitle,
      outer: "flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--surface)",
      inner: "flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column",
      col: "display:flex;flex-direction:column;flex:1 0 auto;width:100%;max-width:" + (wide ? "780px" : "none") + ";padding-bottom:32px",
      onOuter: function () {}, hasHead: false, sub: "", blocks: P, hasFoot: false, foot: [], footNote: "", footStyle: "" });

    if (sheetD) {
      var sh = safe(function () { return sheetBody(sheetD); }, null);
      if (sh) panes.push({ key: "sheet", role: "dialog", title: sh.title,
        outer: "position:absolute;inset:0;z-index:20;background:rgba(12,14,20,0.5);display:flex;justify-content:center;align-items:" + (web ? "center" : "flex-end"),
        onOuter: function (ev) { if (ev.target === ev.currentTarget) closeSheet(); },
        inner: "width:100%;max-width:560px;max-height:" + (web ? "88%" : "92%") + ";overflow-y:auto;display:flex;flex-direction:column;background:var(--surface-overlay);box-shadow:var(--shadow-2);border-radius:" + (web ? "14px" : "16px 16px 0 0"),
        col: "display:flex;flex-direction:column;flex:1 0 auto;padding-top:4px", hasHead: true, grab: !web, sub: sh.sub || "", blocks: sh.blocks.filter(Boolean),
        hasFoot: !!(sh.foot && sh.foot.length), foot: (sh.foot || []).filter(Boolean), footNote: sh.footNote || "", footStyle: footBar("var(--surface-overlay)") });
    }

    var top = page === "home" || (wide && ["due", "retired"].indexOf(page) >= 0) || (wide && page === "item");
    var parent = page === "item" ? (cur && cur.status !== "active" ? "/vehicles/retired" : "/vehicles") : SUBS[page] ? itemRoot : "/vehicles";
    return { panes: panes, headTitle: headTitle, headSub: headSub, sheetOpen: !!sheetD, showBack: !top,
      onBack: function () { self.setState({ veSheet: null }); self.go(parent); } };
  }

  window.HH_VE_VIEW = view;
})();
