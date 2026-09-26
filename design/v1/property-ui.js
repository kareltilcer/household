/* Property, live in the prototype shell.
   Every figure is computed by assets.js (HH_ASSETS) at render time: the due answers come from
   one due() call per schedule, costs from the records, the inventory from the insured flag.
   Every write lands on the engine's own arrays — entities, schedules, records, readings,
   contractors, meters — so the home screen, the item, the reminder row and the printout
   recompute together the moment something is saved, and undo reverses the same mutation.
   Drawn through the Finance block vocabulary, like Garden and Utilities. */
(function () {
  var KINDS = ["Hero", "Label", "Rows", "Note", "Bars", "Acts", "Field", "Chips", "Inputs", "Cards", "Steps", "Kv", "Empty"];
  var LV = ["none", "view", "contribute", "manage"];
  var MEN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MCS = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
  function safe(fn, d) { try { var v = fn(); return v == null ? d : v; } catch (e) { return d; } }

  /* English for the fixture's Czech-only strings; new rows carry both. */
  var EN = {
    cat: { "Rodinný dům": "Family house", "Plynový kotel": "Gas boiler", "Pračka": "Washing machine", "Kouřová hlásicka": "Smoke alarm",
      "Filtrace vody": "Water filtration", "Krytina": "Roofing", "Komín": "Chimney", "Žlaby a svody": "Gutters and downpipes" },
    loc: { "technická místnost": "utility room", "koupelna": "bathroom", "chodba, patro, sklep, kuchyň": "hall, upstairs, cellar, kitchen", "sklep": "cellar" },
    sch: { "sch-kotel": "Annual boiler service", "sch-hlasice": "Alarm test", "sch-filtr": "Cartridge change", "sch-zlaby": "Gutter check" },
    rec: { "r-kotel-25": "Annual service and cleaning", "r-kotel-24": "Annual service", "r-kotel-23": "Service + sensor replaced",
      "r-pracka": "Replaced the inlet hose", "r-filtr": "Cartridge replaced" },
    trade: { "Kotle a plyn": "Boilers and gas", "Autoservis": "Garage", "Elektrikář": "Electrician" },
    cnote: { novotny: "Has done our boiler since 2016. Only picks up in the mornings.", elektro: "Checked the alarms when the hallway was redone." },
    meter: [["Main water stopcock", "cellar, behind the shelf on the left", "The 24 spanner hangs next to it. Opens anticlockwise."],
      ["Electricity meter", "hallway, cupboard by the door", "One number, two registers — high and low tariff."],
      ["Gas meter", "outside, by the gate", "Neighbour Vlasák has the key to the box."],
      ["Fuse box", "hallway, same cupboard", "Labelled on the outside. The cellar is third from the top."]],
    starter: { CZ: [["Gas boiler", "Annual service — and in Czechia the appliance inspection too."], ["Chimney", "Checked once a year, more often for solid fuel."],
      ["Smoke alarms", "Test monthly, replace after ten years."], ["Water filter", "Per cartridge, usually six months."], ["Gutters and downpipes", "In autumn and spring."]],
      DE: [["Gas heating", "Serviced yearly · chimney sweep separately."], ["Chimney", "Swept under state law."], ["Smoke alarms", "DIN 14676: checked yearly."], ["Water filter", ""], ["Gutters", ""]] }
  };
  /* which starter lines this house already has, by the thing that answers them */
  var STARTER_HAS = { CZ: ["kotel-vaillant", null, "hlasice", "filtr-vody", "strecha"] };

  function view(self, seg, query, hash, wide) {
    var A = window.HH_ASSETS, F = window.HH_FIXTURES, N = window.HH_NAV;
    if (!A) return null;
    var s = self.state, L = self.chatL.bind(self), web = s.client === "web", cs = s.locale === "cs";
    var nav = N ? N.navFor(s.member, s.household) : {};
    var grants = nav.grants || {};
    var lvl = grants.property || "none";
    var ro = ["read_only", "canceled", "restricted"].indexOf(s.ent) >= 0 || s.screen === "readonly";
    var canC = LV.indexOf(lvl) >= 2 && !ro, canM = LV.indexOf(lvl) >= 3 && !ro;
    var me = s.member, TD = A.today, isEmpty = s.screen === "empty", off = !s.online;
    var name = function (id) { var m = F ? F.members.filter(function (x) { return x.id === id; })[0] : null; return m ? m.name : id; };
    var go = function (r) { return function () { self.setState({ prSheet: null }); self.go(r); }; };

    /* ── words ── */
    var day = function (iso, y) {
      if (!iso) return "\u2013";
      var p = iso.split("-");
      return cs ? (+p[2]) + ". " + MCS[+p[1] - 1] + (y === false ? "" : " " + p[0]) : (+p[2]) + " " + MEN[+p[1] - 1] + (y === false ? "" : " " + p[0]);
    };
    var czk = function (n) { return A.czk(n || 0); };
    var num = function (n) { return A.num(n); };
    var thingN = function (e) { return e ? (cs ? e.cs : (e.en || e.cs)) : ""; };
    var catN = function (c) { return c ? (cs ? c : (EN.cat[c] || c)) : ""; };
    var locN = function (l) { return l ? (cs ? l : (EN.loc[l] || l)) : ""; };
    var schN = function (sc) { return cs ? sc.cs : (sc.en || EN.sch[sc.id] || sc.cs); };
    var recN = function (r) { return cs ? r.what : (r.en || EN.rec[r.id] || r.what); };
    var tradeN = function (t) { return t ? (cs ? t : (EN.trade[t] || t)) : ""; };
    var months = function (n) { return n === 1 ? L("every month", "každý měsíc") : n === 12 ? L("every year", "každý rok") : L("every " + n + " months", "každých " + n + " měsíců"); };
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
        btnStyle: "flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:12px;min-height:56px;padding:10px 16px;border:none;font-family:inherit;text-align:left;color:inherit;background:" +
          (p.on ? "var(--surface-sunken)" : "transparent") + ";box-shadow:" + (p.on ? "inset 3px 0 0 var(--accent)" : "none") + ";cursor:" + (fn ? "pointer" : "default"),
        titleStyle: "font-size:0.9375em;line-height:1.35;overflow-wrap:anywhere;font-weight:" + (p.strong ? "600" : "500") + ";color:" + (p.muted ? "var(--text-muted)" : "var(--text-primary)"),
        subStyle: "font-size:0.75em;line-height:1.45;overflow-wrap:anywhere;text-wrap:pretty;color:" + (p.subTone ? inkOf(p.subTone) : "var(--text-muted)"),
        rightStyle: "font-family:'IBM Plex Mono',monospace;font-size:0.84375em;white-space:nowrap;font-variant-numeric:tabular-nums;color:" + inkOf(p.tone),
        badgeStyle: badgeStyle(p.badgeTone),
        dotStyle: "flex:0 0 10px;width:10px;height:10px;border-radius:3px;background:" + (p.dotInk || "var(--border-strong)"),
        actStyle: "flex:0 0 auto;align-self:center;margin-right:12px;min-height:36px;padding:0 12px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:0.78125em;font-weight:600;white-space:nowrap;border:1px solid var(--accent);background:transparent;color:var(--accent)"
      });
    };
    var label = function (t, link, on) { return blk("Label", { text: t, link: link || "", onLink: on || function () {} }); };
    var rows = function (r) { return blk("Rows", { rows: r.filter(Boolean) }); };
    var note = function (t, tone, link, on) {
      return blk("Note", { text: t, link: link || "", onLink: on || function () {},
        style: "display:flex;flex-direction:column;gap:6px;align-items:flex-start;font-size:0.8125em;line-height:1.6;text-wrap:pretty;max-width:68ch;" +
          (tone === "box" || tone === "boxWarn" || tone === "boxDanger" || tone === "boxOff"
            ? "margin:10px 16px;padding:12px 14px;border-radius:10px;background:var(--surface-sunken);color:var(--text-primary)" +
              (tone === "boxWarn" ? ";box-shadow:inset 3px 0 0 var(--warning)" : tone === "boxDanger" ? ";box-shadow:inset 3px 0 0 var(--danger)" : tone === "boxOff" ? ";box-shadow:inset 3px 0 0 var(--status-offline)" : "")
            : "padding:10px 16px;color:" + inkOf(tone || "muted")) });
    };
    var btn = function (lbl, kind, on, dis) { return { label: lbl, style: self.docBtn(kind, dis ? false : undefined), on: dis ? function () {} : on, off: !!dis }; };
    var acts = function (list) { list = list.filter(Boolean); return list.length ? blk("Acts", { btns: list }) : null; };
    var kv = function (pairs) {
      return blk("Kv", { pairs: pairs.filter(function (p) { return p && p[1] !== "" && p[1] != null; }).map(function (p) { return { k: p[0], v: String(p[1]) }; }) });
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
          rightStyle: "font-family:'IBM Plex Mono',monospace;font-size:0.8125em;white-space:nowrap;color:var(--text-primary)",
          projStyle: "white-space:nowrap;color:var(--text-muted)",
          fill: "position:absolute;left:0;top:0;bottom:0;border-radius:4px;width:" + Math.max(p.v ? 2 : 0, Math.min(100, Math.round(p.v / max * 100))) + "%;background:" + (p.ink || "var(--accent)"),
          tick: "display:none", noOpen: !p.open, open: p.open || function () {}, cursor: p.open ? "pointer" : "default" };
      }) });
    };

    /* ── session writes ── */
    var bump = function (extra) { self.setState(Object.assign({ prRev: (self.state.prRev || 0) + 1 }, extra || {})); };
    var commit = function (doIt, undo, toast, extra) {
      doIt();
      bump(Object.assign({ prSheet: null }, extra || {}));
      if (typeof toast === "function") toast = toast();
      if (toast) self.docToastShow(toast + (off ? L(" \u00b7 saved on this device", " \u00b7 uloženo v zařízení") : ""), undo ? function () {
        undo(); bump({ docToast: null });
      } : null);
    };
    var open = function (d) { return function () { self.setState({ prSheet: Object.assign({ at: self.state.route }, d) }); }; };
    var uid = function (p) { return p + "-s" + (Date.now() % 1000000); };
    var slug = function (t) {
      var m = { "á": "a", "č": "c", "ď": "d", "é": "e", "ě": "e", "í": "i", "ň": "n", "ó": "o", "ř": "r", "š": "s", "ť": "t", "ú": "u", "ů": "u", "ý": "y", "ž": "z" };
      var b = String(t).toLowerCase().replace(/[áčďéěíňóřšťúůýž]/g, function (c) { return m[c]; }).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vec";
      var id = b, n = 2;
      while (A.entity(id)) id = b + "-" + (n++);
      return id;
    };

    /* ── the engine, read ── */
    var house = A.entity("dum-brno");
    var things = A.entities.filter(function (e) { return e.module === "property" && e.kind !== "property" && e.status === "active"; });
    var retired = A.entities.filter(function (e) { return e.module === "property" && e.kind !== "property" && e.status !== "active"; });
    var live = A.schedules.filter(function (sc) { var e = A.entity(sc.entity); return e && e.module === "property" && e.status === "active"; });
    var dueOf = function (sc) { return safe(function () { return A.due(sc.id, TD); }, null); };
    var dues = live.map(function (sc) { return { sc: sc, d: dueOf(sc) }; }).filter(function (x) { return x.d && x.d.resolved; })
      .sort(function (a, b) { return a.d.resolved < b.d.resolved ? -1 : 1; });
    var overdue = dues.filter(function (x) { return x.d.overdue; });
    var soon = dues.filter(function (x) { return !x.d.overdue && x.d.inDays <= 30; });
    var propRecs = A.records.filter(function (r) { var e = A.entity(r.entity); return e && e.module === "property"; });
    var spentYear = propRecs.filter(function (r) { return r.date.slice(0, 4) === TD.slice(0, 4); }).reduce(function (n, r) { return n + (r.cost || 0); }, 0);
    var warranties = things.filter(function (e) { return e.warranty && e.warranty >= TD; }).sort(function (a, b) { return a.warranty < b.warranty ? -1 : 1; });
    var nextOf = function (e) { return dues.filter(function (x) { return x.sc.entity === e.id; })[0] || null; };
    var utilOK = grants.utilities && grants.utilities !== "none";
    var docsOK = grants.documents && grants.documents !== "none";

    var dueRight = function (d) {
      return d.overdue ? { right: A.diff(d.resolved, TD) + L(" d late", " d po"), tone: "danger" }
        : d.inDays === 0 ? { right: L("today", "dnes"), tone: "accent" } : { right: day(d.resolved, false), tone: d.inDays <= 30 ? "accent" : "" };
    };
    var dueSub = function (d) {
      if (d.noReading) return L("by date only \u2014 no reading yet", "jen podle data \u2014 zatím bez odpočtu");
      if (d.estimate) return L("estimate from usage, not a date", "odhad podle spotřeby, ne termín");
      return "";
    };
    var logDraft = function (e, sc) {
      return { kind: "log", entity: e.id, sch: sc ? sc.id : (A.schedulesOf(e.id)[0] || {}).id || "", date: TD,
        what: sc ? schN(sc) : "", by: "", cost: "", reading: "", err: "" };
    };
    var dueRow = function (x, o) {
      o = o || {};
      var e = A.entity(x.sc.entity), dr = dueRight(x.d);
      var sub = [o.withThing === false ? "" : thingN(e), basisW(x.sc), dueSub(x.d)].filter(Boolean).join(" \u00b7 ");
      return row({ title: schN(x.sc), sub: sub, right: dr.right, tone: dr.tone,
        rightSub: x.d.overdue ? L("was ", "bylo ") + day(x.d.resolved, false) : "",
        badge: x.d.overdue ? L("overdue", "po termínu") : "", badgeTone: "danger",
        act: canC ? L("Log service", "Zapsat servis") : "", onAct: canC ? open(logDraft(e, x.sc)) : null,
        open: o.open === false ? null : go("/property/items/" + e.id) });
    };
    var thingRow = function (e) {
      var nx = nextOf(e), dr = nx ? dueRight(nx.d) : null;
      var q = e.queued && off;
      return row({ title: thingN(e), sub: [catN(e.category), locN(e.location), e.insured ? L("insured", "pojištěno") : ""].filter(Boolean).join(" \u00b7 "),
        right: dr ? dr.right : "", tone: dr ? dr.tone : "", rightSub: nx ? schN(nx.sc) : L("no schedule", "bez intervalu"),
        badge: q ? L("pending", "čeká") : "", badgeTone: "offline", open: go("/property/items/" + e.id) });
    };
    var recRow = function (r, withThing) {
      var e = A.entity(r.entity);
      return row({ title: recN(r), sub: [withThing ? thingN(e) : "", r.by, r.value != null && r.unit ? num(r.value) + "\u00a0" + r.unit : "", r.docs ? r.docs + L(" doc", " dok.") : ""].filter(Boolean).join(" \u00b7 "),
        right: r.cost ? czk(r.cost) : "", rightSub: day(r.date), badge: r.queued && off ? L("pending", "čeká") : "", badgeTone: "offline",
        open: open({ kind: "record", id: r.id }) });
    };

    /* ── route ── */
    var q = {}; String(query || "").split("&").forEach(function (kvp) { var p = kvp.split("="); if (p[0]) q[p[0]] = decodeURIComponent(p[1] || ""); });
    var page = "home", cur = null, sub = "";
    var ALIAS = { pracka: "pracka-bosch", kotel: "kotel-vaillant", filtr: "filtr-vody" };
    var eng = seg[0] === "assets";
    var a = eng ? "items" : (seg[1] || ""), b = eng ? seg[2] : (seg[2] || ""), c = eng ? seg[3] : (seg[3] || "");
    if (!a) page = "home";
    else if (a === "items") {
      if (b === "new") page = "home";
      else if (!b) page = "home";
      else { cur = A.entity(ALIAS[b] || b); page = cur && cur.module === "property" ? (c === "schedules" ? "schedules" : c === "records" ? "records" : c === "readings" ? "readings" : "item") : "missing"; }
    }
    else if (a === "due") page = "due";
    else if (a === "retired") page = "retired";
    else if (a === "contractors") { page = b && b !== "new" ? "contractor" : "contractors"; if (page === "contractor") { cur = A.contractors.filter(function (x) { return x.id === b; })[0]; if (!cur) page = "missing"; } }
    else if (a === "costs") page = "costs";
    else if (a === "print") page = "print";
    else if (a === "setup") page = "setup";
    else if (b === "meters") page = "meters";
    else if (A.entity(a) && A.entity(a).kind === "property") { cur = A.entity(a); page = "item"; }
    else page = "missing";
    var itemRoot = cur && page !== "contractor" ? "/property/items/" + cur.id : "/property";

    /* route-owned sheets */
    var routeSheet = null;
    if (a === "items" && b === "new" && canC) routeSheet = thingDraft(null, "/property");
    if (page === "item" && c === "edit" && canC) routeSheet = Object.assign(thingDraft(cur), { back: itemRoot });
    if (page === "contractors" && b === "new" && canC) routeSheet = { kind: "contractor", edit: null, name: "", trade: "", phone: "", email: "", note: "", err: "", back: "/property/contractors" };
    var sheetD = (s.prSheet && s.prSheet.at === s.route) ? s.prSheet : routeSheet;
    var patch = function (p) { self.setState({ prSheet: Object.assign({}, sheetD, { at: self.state.route }, p) }); };
    var closeSheet = function () { var back = sheetD && sheetD.back; self.setState(Object.assign({ prSheet: null }, back ? { route: back } : {})); };

    function thingDraft(e, back) {
      if (e) return { kind: "thing", edit: e.id, name: thingN(e), category: e.category || "", location: e.location || "", acquired: e.acquired || "",
        price: e.price != null ? String(e.price) : "", serial: e.serial || "", brand: e.brand || "", model: e.model || "", warranty: e.warranty || "", insured: !!e.insured, months: "", err: "" };
      return { kind: "thing", edit: null, name: "", category: "", location: "", acquired: "", price: "", serial: "", brand: "", model: "", warranty: "", insured: false, months: "", err: "", back: back || null };
    }

    var P = [], headTitle = L("Property", "Dům a vybavení"), headSub = "";
    var push = function (x) { if (x) P.push(x); };
    var readNote = ro ? L("Read-only while the subscription is past due. Everything recorded still reads, and the due dates keep computing.", "Jen ke čtení, dokud se předplatné neobnoví. Vše zapsané zůstává čitelné.")
      : lvl === "view" ? L("You can see Property. Logging a service or adding a thing needs contribute.", "Dům a vybavení vidíte. Zapsat servis nebo přidat věc vyžaduje přispívání.") : "";
    if (readNote) push(note(readNote, "box"));
    if (off && page !== "print") push(note(L("Offline. Things, schedules, records and readings are on this device and the due dates are worked out here, so the screen is the same. What you write goes up with the signal.",
      "Offline. Věci, intervaly, záznamy i odpočty jsou v zařízení a termíny se počítají tady. Co zapíšete, odejde se signálem."), "boxOff"));

    /* ═══ pages ═══ */
    if (page === "missing") {
      push(empty(L("Not in this house", "V tomhle domě není"), L("It was removed, or it was never here.", "Bylo odebráno, nebo tu nikdy nebylo."), L("Back to Property", "Zpět na Dům"), go("/property")));
    }

    if (page === "home") {
      headTitle = L("Property", "Dům a vybavení"); headSub = house ? thingN(house) : "";
      if (isEmpty) {
        var EM = A.empty.property;
        push(empty(cs ? EM.s : L("This is for the things in the house that must not stop working.", EM.s),
          cs ? EM.e : "A boiler, for example \u2014 serviced every year, last done last September.",
          canM ? (cs ? EM.a : "Start with the list for Czechia") : canC ? L("Add a thing", "Přidat věc") : "",
          canM ? go("/property/setup/checklist") : open(thingDraft(null))));
      } else {
        var lead = overdue[0] || dues[0];
        var le = lead ? A.entity(lead.sc.entity) : null;
        push(hero({ kicker: house ? thingN(house) + " \u00b7 " + (cs ? house.meta : "158 m\u00b2 \u00b7 built 1994 \u00b7 owned") : "",
          big: !lead ? L("Nothing due", "Nic není na řadě") : lead.d.overdue ? schN(lead.sc) + L(" is " + A.diff(lead.d.resolved, TD) + " days overdue", " je " + A.diff(lead.d.resolved, TD) + " dní po termínu")
            : schN(lead.sc) + L(" on ", " ") + day(lead.d.resolved, false),
          tone: lead && lead.d.overdue ? "danger" : "",
          sub: lead ? thingN(le) + " \u00b7 " + basisW(lead.sc) + L(", last done ", ", naposledy ") + day(lead.sc.lastDone) : "",
          stats: [
            stat(L("Things", "Věcí"), String(things.length), live.length + L(" with a schedule", " s intervalem")),
            stat(L("Due in 30 days", "Do 30 dní"), String(overdue.length + soon.length), overdue.length ? overdue.length + L(" overdue", " po termínu") : L("nothing overdue", "nic po termínu"), overdue.length ? "danger" : ""),
            stat(L("Spent in " + TD.slice(0, 4), "Utraceno " + TD.slice(0, 4)), czk(spentYear), propRecs.filter(function (r) { return r.date.slice(0, 4) === TD.slice(0, 4); }).length + L(" services logged", " zapsaných servisů")),
            warranties.length ? stat(L("Next warranty ends", "Nejbližší konec záruky"), day(warranties[0].warranty, false), thingN(warranties[0]) + " \u00b7 " + A.diff(TD, warranties[0].warranty) + L(" days", " dní")) : null
          ].filter(Boolean) }));
        if (canC && !wide) push(acts([btn(L("+ Thing", "+ Věc"), "primary", open(thingDraft(null))), canC && lead ? btn(L("Log a service", "Zapsat servis"), "", open(logDraft(le, lead.sc))) : null]));
        push(label(L("Coming up", "Na řadě"), L("All dates", "Všechny termíny"), go("/property/due")));
        var near = overdue.concat(soon);
        push(near.length ? rows(near.map(function (x) { return dueRow(x); })) : note(L("Nothing due in the next 30 days. The next one is " + (dues[0] ? schN(dues[0].sc) + " on " + day(dues[0].d.resolved, false) : "not set") + ".",
          "Do 30 dní nic. Další je " + (dues[0] ? schN(dues[0].sc) + " " + day(dues[0].d.resolved, false) : "nenastaveno") + ".")));
        push(label(L("In the house", "V domě"), canC ? L("+ Thing", "+ Věc") : "", open(thingDraft(null))));
        push(things.length ? rows(things.map(thingRow)) : note(L("Nothing yet.", "Zatím nic.")));
        if (house) push(rows([row({ title: thingN(house), sub: catN(house.category) + " \u00b7 " + L("bought ", "koupeno ") + day(house.acquired) + " \u00b7 " + house.docs + L(" documents", " dokumentů"), open: go("/property/items/" + house.id) })]));
        if (!wide) { push(label(L("More in Property", "Další")));
          push(rows(moreRows())); }
      }
    }

    function moreRows() {
      return [
        row({ title: L("What it costs", "Kolik to stojí"), sub: L("services and purchases, per thing and per year", "servisy a nákupy, podle věci a roku"), open: go("/property/costs") }),
        row({ title: L("Contractors", "Živnostníci"), sub: A.contractors.length + L(" contacts \u00b7 who came last time", " kontaktů \u00b7 kdo tu byl minule"), open: go("/property/contractors") }),
        row({ title: L("Where the meters are", "Kde jsou měřiče"), sub: A.meters.length + L(" places, with how to get at them", " míst a jak se k nim dostat"), open: go("/property/dum-brno/meters") }),
        row({ title: L("Insurance inventory", "Inventura pro pojištění"), sub: things.filter(function (e) { return e.insured; }).length + L(" insured \u00b7 prints on paper", " pojištěno \u00b7 na papír"), open: go("/property/print/inventory") }),
        canM ? row({ title: L("Starter checklist", "Startovací seznam"), sub: L("common things for your country, one tap each", "běžné věci pro vaši zemi, jedním klepnutím"), open: go("/property/setup/checklist") }) : null,
        retired.length ? row({ title: L("Retired and sold", "Vyřazeno a prodáno"), sub: retired.length + L(" \u00b7 history kept", " \u00b7 historie zůstává"), open: go("/property/retired") }) : null
      ].filter(Boolean);
    }

    /* FR-PP7: service costs and purchases rolled up per thing, per year and for the house */
    if (page === "costs") {
      headTitle = L("What it costs", "Kolik to stojí"); headSub = house ? thingN(house) : "";
      var allT = things.concat(retired || []);
      var price = function (e) { return +(e.price || e.purchasePrice || e.cost || 0) || 0; };
      var perT = allT.map(function (e) { var rs = A.recordsOf(e.id) || []; return { e: e, svc: rs.reduce(function (n, r) { return n + (r.cost || 0); }, 0), n: rs.length, buy: price(e) }; })
        .filter(function (x) { return x.svc || x.buy; }).sort(function (x, y) { return (y.svc + y.buy) - (x.svc + x.buy); });
      var yr = {}; allT.forEach(function (e) { (A.recordsOf(e.id) || []).forEach(function (r) { var y = String(r.date).slice(0, 4); yr[y] = (yr[y] || 0) + (r.cost || 0); }); });
      var svcT = perT.reduce(function (n, x) { return n + x.svc; }, 0), buyT = perT.reduce(function (n, x) { return n + x.buy; }, 0);
      push(hero({ kicker: L("Since the first entry", "Od prvn\u00edho z\u00e1znamu"), big: czk(svcT + buyT),
        sub: L("services and purchases recorded in Property. Money kept in Finance isn’t counted twice.", "servisy a nákupy zapsané v Domě. Co je ve Financích, se nepočítá dvakrát."),
        stats: [stat(L("Services", "Servisy"), czk(svcT)), stat(L("Purchases", "Nákupy"), czk(buyT)), stat(L("This year", "Letos"), czk(yr[TD.slice(0, 4)] || 0))] }));
      var ys = Object.keys(yr).sort();
      if (ys.length) { push(label(L("Services by year", "Servisy podle roku"))); push(bars(ys.map(function (y) { return { name: y, right: czk(yr[y]), v: yr[y] }; }))); }
      push(label(L("By thing", "Podle věci")));
      if (!perT.length) push(empty(L("No costs recorded yet.", "Zatím žádné náklady."), L("Log a service with its price and it appears here.", "Zapište servis s cenou a objeví se tu."), "", null));
      push(rows(perT.map(function (x) {
        return row({ title: thingN(x.e), sub: (x.n ? x.n + L(" services", " servisů") : L("no services", "bez servisů")) + (x.buy ? L(" · bought for ", " · koupeno za ") + czk(x.buy) : "") + (x.e.status !== "active" ? L(" · retired", " · vyřazeno") : ""),
          right: czk(x.svc + x.buy), open: go("/property/items/" + x.e.id + "/records") });
      })));
    }

    if (page === "due") {
      headTitle = L("All dates", "Všechny termíny"); headSub = dues.length + L(" schedules", " intervalů");
      if (!dues.length) push(empty(L("No schedules yet.", "Zatím žádné intervaly."), L("Without one it's only a list. A boiler: every 12 months.", "Bez intervalu je to jen seznam. Kotel: každých 12 měsíců."), "", null));
      else {
        if (overdue.length) { push(label(L("Overdue", "Po termínu"))); push(rows(overdue.map(function (x) { return dueRow(x); }))); }
        var upcoming = dues.filter(function (x) { return !x.d.overdue; });
        if (upcoming.length) { push(label(L("Next", "Další"))); push(rows(upcoming.map(function (x) { return dueRow(x); }))); }
        push(note(L("Each date is one answer from the engine: by date, by usage, or whichever comes first. A usage answer is an estimate from how fast it is used, and is labelled one. Reminders are sent from these same dates.",
          "Každé datum je jedna odpověď: podle data, podle spotřeby, nebo co přijde dřív. Odpověď podle spotřeby je odhad a je tak označená. Připomínky jdou ze stejných dat.")));
      }
    }

    if (page === "item") {
      var e = cur, isHouse = e.kind === "property";
      headTitle = thingN(e); headSub = catN(e.category);
      var schs = A.schedulesOf(e.id), recs = A.recordsOf(e.id), cost = A.costOf(e.id);
      if (e.status !== "active") push(note(L("Retired " + day(e.ended) + (e.how === "sold" ? " \u00b7 sold" + (e.soldFor ? " for " + czk(e.soldFor) : "") : "") + ". The history stays with the house and nothing is scheduled.",
        "Vyřazeno " + day(e.ended) + (e.how === "sold" ? " \u00b7 prodáno" + (e.soldFor ? " za " + czk(e.soldFor) : "") : "") + ". Historie zůstává u domu a nic se neplánuje."), "box",
        canM ? L("Put it back", "Vrátit zpět") : "", canM ? function () {
          var old = { status: e.status, ended: e.ended, how: e.how, soldFor: e.soldFor };
          commit(function () { e.status = "active"; delete e.ended; delete e.how; delete e.soldFor; }, function () { Object.assign(e, old); }, thingN(e) + L(" is back in the house", " je zpět v domě"));
        } : null));
      if (e.queued && off) push(note(L("Added on this device. It is here, editable, and waits for the signal.", "Přidáno v zařízení. Je tu, dá se upravit a čeká na signál."), "boxOff"));
      if (!isHouse && e.status === "active") {
        var nx0 = nextOf(e);
        if (nx0) push(hero({ kicker: schN(nx0.sc), big: nx0.d.overdue ? A.diff(nx0.d.resolved, TD) + L(" days overdue", " dní po termínu") : nx0.d.inDays === 0 ? L("Due today", "Dnes") : L("Due ", "") + day(nx0.d.resolved),
          tone: nx0.d.overdue ? "danger" : "", sub: basisW(nx0.sc) + L(" \u00b7 last done ", " \u00b7 naposledy ") + day(nx0.sc.lastDone) + (dueSub(nx0.d) ? " \u00b7 " + dueSub(nx0.d) : "") }));
        push(acts([canC ? btn(L("Log a service", "Zapsat servis"), "primary", open(logDraft(e, nx0 ? nx0.sc : null))) : null,
          canC ? btn(L("Edit", "Upravit"), "", open(Object.assign(thingDraft(e)))) : null,
          canM ? btn(L("Retire or sell", "Vyřadit / prodat"), "danger-ghost", open({ kind: "retire", entity: e.id, how: "retired", date: TD, price: "", note: "", err: "" })) : null]));
      }
      push(label(isHouse ? L("The house", "Dům") : L("What it is", "Co to je")));
      push(kv([[L("Category", "Kategorie"), catN(e.category)], [L("Brand", "Značka"), e.brand], [L("Model", "Model"), e.model], [L("Serial number", "Výrobní číslo"), e.serial],
        [L("Where", "Kde"), locN(e.location)], [isHouse ? L("Bought", "Koupeno") : L("Installed or bought", "Instalováno / koupeno"), e.acquired ? day(e.acquired) : ""],
        [L("Price", "Cena"), e.price ? czk(e.price) : ""], isHouse ? [L("About", "O domě"), cs ? e.meta : "158 m\u00b2 \u00b7 built 1994 \u00b7 owned"] : null,
        e.warranty ? [L("Warranty", "Záruka"), (e.warranty < TD ? L("ended ", "skončila ") : L("until ", "do ")) + day(e.warranty) + (e.warranty >= TD ? " \u00b7 " + A.diff(TD, e.warranty) + L(" days left", " dní zbývá") : "")] : null,
        !isHouse ? [L("Insurance inventory", "Inventura pro pojištění"), e.insured ? L("on it", "ano") : L("not on it", "ne")] : null]));
      if (e.warranty && e.warranty >= TD && A.diff(TD, e.warranty) <= 90) push(note(L("The warranty ends in " + A.diff(TD, e.warranty) + " days. A reminder goes out 30 days before, so a fault found now can still be claimed.",
        "Záruka končí za " + A.diff(TD, e.warranty) + " dní. Připomínka přijde 30 dní předem, aby šla závada ještě reklamovat."), "boxWarn"));
      if (isHouse) {
        push(label(L("For the house", "Pro dům")));
        push(rows([row({ title: L("Where the meters are", "Kde jsou měřiče"), sub: A.meters.length + L(" places", " míst"), open: go("/property/" + e.id + "/meters") }),
          row({ title: L("Contractors", "Živnostníci"), sub: A.contractors.length + L(" contacts", " kontaktů"), open: go("/property/contractors") }),
          row({ title: L("Insurance inventory", "Inventura pro pojištění"), sub: czk(A.inventoryRun().total), open: go("/property/print/inventory") })]));
      }
      if (!isHouse) {
        push(label(L("Schedule", "Servisní interval"), L("Open", "Otevřít"), go("/assets/property_item/" + e.id + "/schedules")));
        push(schs.length ? rows(schs.map(function (sc) {
          var d = dueOf(sc); if (!d || e.status !== "active") return row({ title: schN(sc), sub: basisW(sc), muted: true });
          return dueRow({ sc: sc, d: d }, { withThing: false, open: false });
        })) : note(L("No schedule. Without one this is a row on a list, and nothing will remind anyone.", "Bez intervalu je to jen řádek v seznamu a nikdo nic nepřipomene."), "", canM ? L("Add a schedule", "Přidat interval") : "", canM ? open(schDraft(e, null)) : null));
        var usageSch = schs.filter(function (sc) { return sc.basis !== "interval"; })[0];
        if (usageSch) {
          var lr = A.latest(e.id, usageSch.unit);
          push(label(L("Usage", "Odpočet"), L("Log", "Záznamy"), go("/assets/property_item/" + e.id + "/readings")));
          push(rows([row({ title: lr ? num(lr.milli / 1000) + "\u00a0" + usageSch.unit : L("No reading yet", "Zatím bez odpočtu"),
            sub: lr ? day(lr.date) + " \u00b7 " + name(lr.by) : L("The date half of the schedule still answers; the " + usageSch.unit + " half waits for a number.", "Datum platí dál; polovina podle " + usageSch.unit + " čeká na číslo."),
            muted: !lr, act: canC && e.status === "active" ? L("Add reading", "Zapsat stav") : "", onAct: open({ kind: "reading", entity: e.id, sch: usageSch.id, date: TD, value: "", err: "" }),
            open: go("/assets/property_item/" + e.id + "/readings") })]));
        }
      }
      push(label(L("History", "Servisní historie") + (recs.length ? " \u00b7 " + czk(cost) : ""), recs.length > 4 ? L("All " + recs.length, "Vše (" + recs.length + ")") : "", go("/assets/property_item/" + e.id + "/records")));
      push(recs.length ? rows(recs.slice(0, 4).map(function (r) { return recRow(r); })) : note(L("History starts with the first service logged.", "Historie začíná prvním zápisem.")));
      if (e.docs) {
        push(label(L("Documents", "Dokumenty")));
        push(rows([row({ title: e.docs + L(e.docs === 1 ? " document" : " documents", " dokumentů"), sub: L("manual, invoices, warranty card \u00b7 fetched when opened", "návod, faktury, záruční list \u00b7 stáhne se při otevření"),
          open: docsOK ? go("/documents") : null })]));
      }
      if (!isHouse) push(note(L("Costs add up per thing and per year here. Finance keeps its own ledger and this is not a hidden copy of it.", "Náklady se sčítají po věcech a letech. Finance mají vlastní evidenci a tohle není její skrytá kopie.")));
    }

    function schDraft(e, sc) {
      if (sc) return { kind: "schedule", entity: e.id, edit: sc.id, name: schN(sc), months: sc.months ? String(sc.months) : "", every: sc.everyUnit ? String(sc.everyUnit) : "", unit: sc.unit || "l", lastDone: sc.lastDone, err: "" };
      return { kind: "schedule", entity: e.id, edit: null, name: "", months: "12", every: "", unit: "l", lastDone: e.acquired && e.acquired <= TD ? e.acquired : TD, err: "" };
    }

    if (page === "schedules") {
      var e2 = cur; headTitle = L("Schedule", "Servisní interval"); headSub = thingN(e2);
      var list = A.schedulesOf(e2.id);
      if (!list.length) push(empty(L("Without a schedule it's only a list of things.", "Bez intervalu je to jen seznam věcí."), L("Boiler: every 12 months.", "Kotel: každých 12 měsíců."),
        canM ? L("Add a schedule", "Přidat interval") : "", open(schDraft(e2, null))));
      list.forEach(function (sc) {
        var d = dueOf(sc);
        push(label(schN(sc), canM ? L("Edit", "Upravit") : "", open(schDraft(e2, sc))));
        if (!d) return;
        push(kv([[L("Rule", "Pravidlo"), basisW(sc)], [L("Last done", "Naposledy"), day(sc.lastDone) + (sc.lastValue != null && sc.unit ? " \u00b7 " + num(sc.lastValue) + "\u00a0" + sc.unit : "")],
          sc.months ? [L("By date", "Podle data"), day(d.intervalDue)] : null,
          sc.everyUnit ? [L("By " + sc.unit, "Podle " + sc.unit), d.noReading ? L("no reading yet", "zatím bez odpočtu") : d.usageDueOn ? L("about ", "odhadem ") + day(d.usageDueOn) + " \u00b7 " + L("at ", "při ") + num(d.usageDueAt) + "\u00a0" + sc.unit : L("not enough readings for a rate", "málo odpočtů na odhad")] : null,
          [L("Answer", "Odpověď"), day(d.resolved) + " \u00b7 " + (d.noReading ? L("by date, because there is no reading", "podle data, protože chybí odpočet") : d.reason === "usage" ? L("by usage \u2014 an estimate", "podle spotřeby \u2014 odhad") : sc.everyUnit ? L("by date, which comes first", "podle data, které přijde dřív") : L("by date", "podle data"))]]));
      });
      if (list.length && canM) push(acts([btn(L("+ Another schedule", "+ Další interval"), "", open(schDraft(e2, null)))]));
      if (!canM && list.length) push(note(L("Changing a schedule needs manage. Logging a service against it does not.", "Změna intervalu vyžaduje správu. Zapsat servis ne.")));
      var hp = (A.help || []).filter(function (h) { return h.id === "assets.schedule.dual"; })[0];
      if (hp) push(note((cs ? hp.title : hp.en.title) + " " + (cs ? hp.body.replace(/kilometr\u016f/g, "litrů") : "You can set both a date and a usage figure. Whichever comes first applies \u2014 and the usage one is an estimate from how fast it is used, not a date."), "box"));
    }

    if (page === "records") {
      var e3 = cur; headTitle = L("Service history", "Servisní historie"); headSub = thingN(e3);
      var rs = A.recordsOf(e3.id);
      if (!rs.length) push(empty(L("History starts with the first entry.", "Historie začíná prvním zápisem."), L("\u201cAnnual service and cleaning \u00b7 2 400 Kč\u201d.", "\u201eRoční servis a čištění \u00b7 2 400 Kč\u201c."), canC ? L("Log a service", "Zapsat servis") : "", open(logDraft(e3, null))));
      else {
        push(hero({ kicker: rs.length + L(" entries since ", " záznamů od ") + day(rs[rs.length - 1].date, true), big: czk(A.costOf(e3.id)), sub: L("in total, from the entries below", "celkem, ze záznamů níže") }));
        var byYear = {}; rs.forEach(function (r) { var y = r.date.slice(0, 4); byYear[y] = (byYear[y] || 0) + (r.cost || 0); });
        var yrs = Object.keys(byYear).sort();
        if (yrs.length > 1) push(bars(yrs.map(function (y) { return { name: y, v: byYear[y], right: czk(byYear[y]) }; })));
        if (canC && e3.status === "active") push(acts([btn(L("Log a service", "Zapsat servis"), "primary", open(logDraft(e3, null)))]));
        push(label(L("Newest first", "Od nejnovějšího")));
        push(rows(rs.map(function (r) { return recRow(r); })));
        push(note(L("Entries are appended, never merged, so they can be written offline. Correcting one happens online.", "Záznamy se jen přidávají, takže jdou psát offline. Opravuje se online.")));
      }
    }

    if (page === "readings") {
      var e4 = cur, usc = A.schedulesOf(e4.id).filter(function (sc) { return sc.basis !== "interval"; })[0];
      var unit = usc ? usc.unit : A.vocab.property.unit;
      headTitle = L("Usage", "Odpočet"); headSub = thingN(e4);
      var rd = A.readingsOf(e4.id, unit).slice().reverse();
      if (!rd.length) push(empty(L("No reading yet.", "Zatím bez odpočtu."), L("Without one the schedule counts by date only. The first number becomes the starting point.", "Bez něj se počítá jen podle data. První číslo bude výchozí bod."),
        canC && usc ? L("Add a reading", "Zapsat stav") : "", open({ kind: "reading", entity: e4.id, sch: usc ? usc.id : "", date: TD, value: "", err: "" })));
      else {
        var rt = A.rate(e4.id, unit);
        push(hero({ kicker: L("Latest", "Poslední"), big: num(rd[0].milli / 1000) + "\u00a0" + unit, sub: day(rd[0].date) + " \u00b7 " + name(rd[0].by) + (rt ? " \u00b7 " + L("about ", "zhruba ") + num(Math.round(rt.perDay)) + "\u00a0" + unit + L(" a day", " denně") : "") }));
        if (canC) push(acts([btn(L("Add a reading", "Zapsat stav"), "primary", open({ kind: "reading", entity: e4.id, sch: usc ? usc.id : "", date: TD, value: "", err: "" }))]));
        push(rows(rd.map(function (r, i) {
          var prev = rd[i + 1];
          return row({ title: num(r.milli / 1000) + "\u00a0" + unit, sub: day(r.date) + " \u00b7 " + name(r.by) + (prev ? " \u00b7 +" + num((r.milli - prev.milli) / 1000) + "\u00a0" + unit : L(" \u00b7 starting point", " \u00b7 výchozí bod")),
            badge: r.queued && off ? L("pending", "čeká") : "", badgeTone: "offline" });
        })));
      }
      push(note(L("Stored in thousandths of the unit and never allowed to go down \u2014 the same rule as a Utilities meter. What the filter has used lives here; what the house uses lives in Utilities.",
        "Ukládá se v tisícinách jednotky a nesmí klesnout \u2014 stejné pravidlo jako u měřičů v Energiích.")));
    }

    if (page === "retired") {
      headTitle = L("Retired and sold", "Vyřazeno a prodáno");
      if (!retired.length) push(empty(L("Nothing retired.", "Nic vyřazeno."), L("When a thing leaves the house, its history stays here.", "Když věc z domu odejde, její historie zůstane tady."), "", null));
      else push(rows(retired.map(function (e) {
        return row({ title: thingN(e), sub: (e.how === "sold" ? L("sold ", "prodáno ") : L("retired ", "vyřazeno ")) + day(e.ended) + " \u00b7 " + A.recordsOf(e.id).length + L(" entries kept", " záznamů zůstává"), muted: true, open: go("/property/items/" + e.id) });
      })));
      push(note(L("Retired or sold. The service history stays with the house.", A.disposal.property.copy)));
    }

    if (page === "contractors") {
      headTitle = L("Contractors", "Živnostníci"); headSub = L("A name, a number, and what they did", "Jméno, číslo a co u nás dělal");
      if (!A.contractors.length || isEmpty) push(empty(L("Who services your boiler?", "Kdo vám dělá kotel?"), "Novotný \u2014 servis, +420 604 118 220.", canC ? L("Add a contact", "Přidat kontakt") : "", open({ kind: "contractor", edit: null, name: "", trade: "", phone: "", email: "", note: "", err: "" })));
      else {
        if (canC) push(acts([btn(L("+ Contact", "+ Kontakt"), "primary", open({ kind: "contractor", edit: null, name: "", trade: "", phone: "", email: "", note: "", err: "" }))]));
        push(rows(A.contractors.map(function (k) {
          var jobs = jobsOf(k);
          return row({ title: k.name, sub: [tradeN(k.trade), k.phone].filter(Boolean).join(" \u00b7 "), right: jobs.length ? String(jobs.length) : "", rightSub: jobs.length ? L(jobs.length === 1 ? "job" : "jobs", "zakázek") : "",
            badge: k.queued && off ? L("pending", "čeká") : "", badgeTone: "offline", open: go("/property/contractors/" + k.id) });
        })));
        push(note(L("Five fields and no sixth. No rating, no quote, no pipeline \u2014 just who came last time and how to reach them.", "Pět polí a žádné šesté. Žádné hodnocení ani nabídky \u2014 jen kdo tu byl a jak ho sehnat.")));
      }
    }
    function jobsOf(k) { return A.records.filter(function (r) { return r.by === k.name || (k.did || []).indexOf(r.id) >= 0; }).sort(function (x, y) { return x.date < y.date ? 1 : -1; }); }

    if (page === "contractor") {
      var k = cur; headTitle = k.name; headSub = tradeN(k.trade);
      var jobs = jobsOf(k);
      push(acts([k.phone ? btn(L("Call ", "Volat ") + k.phone, "primary", function () { self.docToastShow(L("Opens the phone app with ", "Otevře telefon s číslem ") + k.phone); }) : null,
        k.email ? btn(L("Email", "E-mail"), "", function () { self.docToastShow(L("Opens mail to ", "Otevře poštu na ") + k.email); }) : null,
        canC ? btn(L("Edit", "Upravit"), "", open({ kind: "contractor", edit: k.id, name: k.name, trade: k.trade || "", phone: k.phone || "", email: k.email || "", note: k.note || "", err: "" })) : null]));
      push(kv([[L("Trade", "Obor"), tradeN(k.trade)], [L("Phone", "Telefon"), k.phone], [L("Email", "E-mail"), k.email], [L("Note", "Poznámka"), cs ? k.note : (EN.cnote[k.id] || k.note)]]));
      push(label(L("What they did here", "Co u nás dělal")));
      push(jobs.length ? rows(jobs.map(function (r) { return recRow(r, true); })) : note(L("Nothing logged against them yet. Pick them as \u201cwho did it\u201d when you log a service.", "Zatím nic. Vyberte je jako „kdo to dělal“ při zápisu servisu.")));
      if (k.id === "novotny") push(note(L("The boiler appointment in the calendar carries the same name as its place, because it is the same appointment.", "Schůzka v kalendáři nese stejné jméno, protože je to stejná schůzka."), "", L("Calendar", "Kalendář"), go("/calendar")));
      if (canM) push(acts([btn(L("Remove contact", "Odebrat kontakt"), "danger-ghost", function () {
        var ix = A.contractors.indexOf(k);
        commit(function () { A.contractors.splice(ix, 1); }, function () { A.contractors.splice(ix, 0, k); }, k.name + L(" removed \u00b7 their past jobs keep the name", " odebráno \u00b7 minulé zakázky jméno drží"), { route: "/property/contractors" });
      })]));
    }

    if (page === "meters") {
      headTitle = L("Where the meters are", "Kde jsou měřiče"); headSub = house ? thingN(house) : "";
      var hm = (A.help || []).filter(function (h) { return h.id === "property.meters.where"; })[0];
      if (!A.meters.length || isEmpty) push(empty(L("Where is your main water stopcock?", "Kde máte hlavní uzávěr vody?"), L("\u201cCellar, behind the shelf on the left. The 24 spanner hangs next to it.\u201d", "„Sklep, za regálem vlevo. Klíč na 24 visí vedle.“"), canC ? L("Add a place", "Přidat místo") : "", open({ kind: "meter", edit: null, name: "", where: "", note: "", link: "", err: "" })));
      else {
        if (canC) push(acts([btn(L("+ Place", "+ Místo"), "primary", open({ kind: "meter", edit: null, name: "", where: "", note: "", link: "", err: "" }))]));
        push(rows(A.meters.map(function (m, i) {
          var en = EN.meter[i] && !m.session ? EN.meter[i] : null;
          return row({ title: cs || !en ? m.cs : en[0], sub: (cs || !en ? m.where : en[1]) + (m.photo ? L(" \u00b7 photo", " \u00b7 foto") : ""),
            badge: m.link ? L("in Utilities", "v Energiích") : "", open: open({ kind: "meterView", ix: i }) });
        })));
        if (hm) push(note((cs ? hm.title : hm.en.title) + " " + (cs ? hm.body : hm.en.body), "box"));
        push(note(L("This screen is on the device on purpose: the moment somebody needs it, the water is already on the floor. Hand it to a house-sitter with the contractors.", "Obrazovka je v zařízení schválně: když ji někdo potřebuje, voda už teče. Dejte ji hlídači domu spolu s kontakty.")));
      }
    }

    if (page === "print") {
      var inv = A.inventoryRun();
      headTitle = L("Insurance inventory", "Inventura pro pojištění"); headSub = inv.count + L(" things \u00b7 ", " věcí \u00b7 ") + czk(inv.total);
      if (!inv.count) push(empty(L("Nothing is marked as insured yet.", "Nic ještě není označené jako pojištěné."), L("Mark the boiler and the washing machine \u2014 two ticks.", "Označte kotel a pračku \u2014 dvě zaškrtnutí."), "", null));
      else {
        push(hero({ kicker: (house ? thingN(house) : "") + L(" \u00b7 printed ", " \u00b7 vytištěno ") + day(TD), big: czk(inv.total), sub: inv.serials + L(" with a serial number, ", " s výrobním číslem, ") + inv.dated + L(" with a date, ", " s datem, ") + inv.docs + L(" documents attached", " přiložených dokumentů") }));
        push(acts([btn(L("Print or save as PDF", "Tisk / PDF"), "primary", function () { try { window.print(); } catch (x) {} })]));
        push(rows(inv.items.map(function (e) {
          return row({ title: thingN(e), sub: [e.brand && e.model ? e.brand + " " + e.model : catN(e.category), e.serial ? L("s/n ", "v. č. ") + e.serial : L("no serial", "bez v. č."), e.acquired ? day(e.acquired) : "", e.docs ? e.docs + L(" docs", " dok.") : ""].filter(Boolean).join(" \u00b7 "),
            right: czk(e.value || e.price), open: go("/property/items/" + e.id) });
        })));
      }
      var notIns = things.filter(function (e) { return !e.insured; });
      if (notIns.length && canC) {
        push(label(L("Not on it", "Není v inventuře")));
        push(rows(notIns.map(function (e) {
          return row({ title: thingN(e), sub: catN(e.category) + (e.price ? " \u00b7 " + czk(e.price) : ""), muted: true, act: L("Add", "Přidat"), onAct: function () {
            commit(function () { e.insured = true; e.value = e.value || e.price || 0; }, function () { e.insured = false; }, thingN(e) + L(" is on the inventory", " je v inventuře"));
          } });
        })));
      }
      push(note(L("It prints light, with no accent colour and nothing heavier than eight per cent ink, because the day it is needed it is read on paper by somebody else.",
        "Tiskne se světle, bez barevného akcentu a s minimem inkoustu, protože v den, kdy je potřeba, ji čte někdo jiný na papíře.")));
    }

    if (page === "setup") {
      var ctry = s.prCountry || "CZ";
      headTitle = L("Start with what almost every house has", "Začneme tím, co má skoro každý dům"); headSub = L("One tap adds the thing with its usual interval", "Jedno klepnutí přidá věc i s intervalem");
      push(chips(L("Country", "Země"), [["CZ", L("Czechia", "Česko")], ["DE", L("Germany", "Německo")], ["AT", L("Austria", "Rakousko")]].map(function (x) {
        return chip(x[1], ctry === x[0], function () { self.setState({ prCountry: x[0] }); });
      })));
      var st = A.starter[ctry];
      if (!st) push(empty(L("No list for this country yet.", "Pro tuhle zemi ještě seznam nemáme."), L("Add the boiler by hand \u2014 the category suggests an interval.", "Přidejte kotel ručně \u2014 interval napovíme podle kategorie."),
        canC ? L("Add by hand", "Přidat ručně") : "", open(thingDraft(null))));
      else {
        var addedIds = s.prStarter || {};
        push(rows(st.map(function (it, i) {
          var en = (EN.starter[ctry] || [])[i] || [it.cs, it.note];
          var hasId = (STARTER_HAS[ctry] || [])[i] || addedIds[ctry + i];
          var has = hasId && A.entity(hasId) && A.entity(hasId).status === "active";
          return row({ title: cs ? it.cs : en[0], sub: [months(it.months), cs ? it.note : en[1]].filter(Boolean).join(" \u00b7 "),
            badge: has ? L("in the house", "v domě") : "", badgeTone: "accent",
            act: !has && canM ? L("Add", "Přidat") : "", onAct: function () {
              var nm = cs ? it.cs : en[0];
              var ne = { id: slug(it.cs), type: "property_item", module: "property", cs: it.cs, en: en[0], category: it.cs, acquired: TD, status: "active", insured: false, docs: 0, session: true, queued: off };
              var ns = { id: uid("sch"), entity: ne.id, cs: it.cs, en: en[0], basis: "interval", months: it.months, lastDone: TD, session: true };
              var prev = Object.assign({}, self.state.prStarter || {}); var nx = Object.assign({}, prev); nx[ctry + i] = ne.id;
              commit(function () { A.entities.push(ne); A.schedules.push(ns); }, function () {
                A.entities.splice(A.entities.indexOf(ne), 1); A.schedules.splice(A.schedules.indexOf(ns), 1); self.setState({ prStarter: prev });
              }, nm + L(" added \u00b7 " + months(it.months), " přidáno \u00b7 " + months(it.months)), { prStarter: nx });
            }, open: has ? go("/property/items/" + hasId) : null });
        })));
        push(note(L("The interval is the point. A thing without one is a row, and a row is not why anybody opens this. The first date counts from today; log the last real service to correct it.",
          "Interval je to hlavní. Věc bez něj je jen řádek. První termín se počítá od dneška; zapište poslední skutečný servis a opraví se.")));
        if (!canM) push(note(L("Adding from the list needs manage.", "Přidávat ze seznamu může správce."), "box"));
        else push(acts([btn(L("Done", "Hotovo"), "primary", function () { self.go("/property"); if (window.HH_OB) window.HH_OB.mark(self, "property"); })]));
      }
    }

    /* ═══ sheets ═══ */
    function sheetBody(d) {
      var out = { title: "", sub: "", blocks: [], foot: [], footNote: "" }, B = out.blocks;
      var cancel = btn(L("Cancel", "Zrušit"), "", closeSheet), closeB = btn(L("Close", "Zavřít"), "", closeSheet);
      var e = d.entity ? A.entity(d.entity) : null;

      if (d.kind === "thing") {
        out.title = d.edit ? L("Edit ", "Upravit ") + d.name : L("Add a thing", "Přidat věc");
        out.sub = d.edit ? "" : L("Only the name is required. The category suggests how often it needs looking at.", "Povinný je jen název. Kategorie napoví, jak často potřebuje péči.");
        B.push(field({ label: L("Name", "Název"), value: d.name, placeholder: L("Dishwasher Miele", "Myčka Miele"), set: function (v) { patch({ name: v, err: "" }); } }));
        var cats = (A.starter.CZ || []).map(function (x, i) { return [x.cs, x.months, (EN.starter.CZ[i] || [])[0]]; }).concat([["Pračka", 0, "Washing machine"], ["Krytina", 0, "Roofing"]]);
        B.push(chips(L("Category", "Kategorie"), cats.map(function (x) {
          return chip(cs ? x[0] : (x[2] || x[0]), d.category === x[0], function () { patch({ category: d.category === x[0] ? "" : x[0], months: !d.edit && x[1] ? String(x[1]) : d.months }); });
        }), d.category && !d.edit && d.months ? L("Suggests ", "Navrhuje ") + months(+d.months) : ""));
        B.push(field({ label: L("Where", "Kde"), value: d.location, placeholder: L("kitchen", "kuchyň"), set: function (v) { patch({ location: v }); } }));
        B.push(field({ label: L("Brand", "Značka"), value: d.brand, narrow: true, set: function (v) { patch({ brand: v }); } }));
        B.push(field({ label: L("Model", "Model"), value: d.model, narrow: true, set: function (v) { patch({ model: v }); } }));
        B.push(field({ label: L("Serial number", "Výrobní číslo"), value: d.serial, narrow: true, set: function (v) { patch({ serial: v, err: "" }); } }));
        B.push(field({ label: L("Installed or bought", "Instalováno / koupeno"), type: "date", value: d.acquired, narrow: true, set: function (v) { patch({ acquired: v, err: "" }); } }));
        B.push(field({ label: L("Price", "Cena"), mode: "decimal", value: d.price, suffix: "Kč", narrow: true, set: function (v) { patch({ price: v, err: "" }); } }));
        B.push(field({ label: L("Warranty until", "Záruka do"), type: "date", value: d.warranty, narrow: true, set: function (v) { patch({ warranty: v }); } }));
        if (!d.edit) B.push(field({ label: L("Service every", "Servis každých"), mode: "numeric", value: d.months, suffix: L("months", "měsíců"), narrow: true, hint: L("Leave empty for no schedule.", "Nechte prázdné, pokud interval nechcete."), set: function (v) { patch({ months: v, err: "" }); } }));
        B.push(chips(L("Insurance inventory", "Inventura pro pojištění"), [chip(L("On it", "Ano"), d.insured, function () { patch({ insured: true }); }), chip(L("Not on it", "Ne"), !d.insured, function () { patch({ insured: false }); })]));
        if (off) B.push(note(L("No signal is fine. It saves on this device and is editable while it waits.", "Bez signálu nevadí. Uloží se v zařízení a dá se upravovat."), "offline"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(d.edit ? L("Save", "Uložit") : L("Add", "Přidat"), "primary", function () {
          var nm = String(d.name || "").trim();
          if (!nm) return patch({ err: L("A thing needs a name. Everything else is optional.", "Věc potřebuje název. Vše ostatní je nepovinné.") });
          var ser = String(d.serial || "").trim();
          if (ser && A.entities.some(function (x) { return x.serial === ser && x.id !== d.edit; })) return patch({ err: L("Rejected: two things can't share a serial number. " + ser + " is already on another one.", "Odmítnuto: dvě zařízení nemůžou mít stejné výrobní číslo.") });
          if (d.acquired && d.acquired > TD) return patch({ err: L("Rejected: the install date can't be after today.", "Odmítnuto: datum instalace nemůže být po dnešku.") });
          var pr = d.price === "" ? null : parseNum(d.price);
          if (d.price !== "" && pr == null) return patch({ err: L("Type the price as a number.", "Zapište cenu číslem.") });
          var mo = d.months === "" ? null : parseNum(d.months);
          if (!d.edit && d.months !== "" && (!mo || mo < 1 || mo % 1)) return patch({ err: L("The interval is whole months, at least one.", "Interval je v celých měsících, aspoň jeden.") });
          var vals = { category: d.category || "", location: String(d.location || "").trim(), brand: String(d.brand || "").trim(), model: String(d.model || "").trim(), serial: ser,
            acquired: d.acquired || "", price: pr, warranty: d.warranty || null, insured: !!d.insured };
          if (vals.insured) vals.value = pr || 0;
          if (d.edit) {
            var ex = A.entity(d.edit), old = {}; Object.keys(vals).concat(["cs", "en", "value"]).forEach(function (k2) { old[k2] = ex[k2]; });
            commit(function () { Object.assign(ex, vals); if (nm !== thingN(ex)) { ex.cs = nm; ex.en = nm; } }, function () { Object.assign(ex, old); }, L("Saved", "Uloženo"), d.back ? { route: d.back } : {});
          } else {
            var ne = Object.assign({ id: slug(nm), type: "property_item", module: "property", cs: nm, en: nm, status: "active", docs: 0, session: true, queued: off }, vals);
            var ns = mo ? { id: uid("sch"), entity: ne.id, cs: L("Service", "Servis"), en: "Service", basis: "interval", months: mo, lastDone: vals.acquired || TD, session: true } : null;
            commit(function () { A.entities.push(ne); if (ns) A.schedules.push(ns); }, function () { A.entities.splice(A.entities.indexOf(ne), 1); if (ns) A.schedules.splice(A.schedules.indexOf(ns), 1); },
              nm + L(" added", " přidáno") + (ns ? " \u00b7 " + months(mo) : ""), { route: "/property/items/" + ne.id });
          }
        })];
      }

      if (d.kind === "log" && e) {
        out.title = L("Log a service", "Zapsat servis"); out.sub = thingN(e);
        var schs = A.schedulesOf(e.id);
        if (schs.length) B.push(chips(L("Which schedule it resets", "Který interval se tím obnoví"), schs.map(function (sc) {
          return chip(schN(sc), d.sch === sc.id, function () { patch({ sch: sc.id, what: d.what || schN(sc) }); });
        }).concat([chip(L("None \u2014 a repair", "Žádný \u2014 oprava"), !d.sch, function () { patch({ sch: "" }); })]),
          d.sch ? L("The next date counts from this one.", "Další termín se počítá od tohoto.") : L("Kept in the history; no date moves.", "Zůstane v historii; žádný termín se neposune.")));
        B.push(field({ label: L("What was done", "Co se dělalo"), value: d.what, placeholder: L("Annual service and cleaning", "Roční servis a čištění"), set: function (v) { patch({ what: v, err: "" }); } }));
        B.push(field({ label: L("When", "Kdy"), type: "date", value: d.date, narrow: true, set: function (v) { patch({ date: v, err: "" }); } }));
        B.push(chips(L("Who did it", "Kdo to dělal"), A.contractors.map(function (k) { return chip(k.name, d.by === k.name, function () { patch({ by: k.name }); }); })
          .concat([chip(name(me), d.by === name(me), function () { patch({ by: name(me) }); })])));
        B.push(field({ label: L("Or someone else", "Nebo někdo jiný"), value: A.contractors.some(function (k) { return k.name === d.by; }) || d.by === name(me) ? "" : d.by, placeholder: L("Name", "Jméno"), set: function (v) { patch({ by: v }); } }));
        B.push(field({ label: L("What it cost", "Co to stálo"), mode: "decimal", value: d.cost, suffix: "Kč", narrow: true, set: function (v) { patch({ cost: v, err: "" }); } }));
        var usc2 = schs.filter(function (sc) { return sc.id === d.sch && sc.basis !== "interval"; })[0];
        if (usc2) B.push(field({ label: L("Reading at the time", "Stav v tu chvíli"), mode: "decimal", value: d.reading, suffix: usc2.unit, narrow: true, hint: L("Optional. It makes the next usage threshold reproducible.", "Nepovinné. Další hranice podle spotřeby pak sedí."), set: function (v) { patch({ reading: v, err: "" }); } }));
        if (off) B.push(note(L("No signal is fine \u2014 an entry is appended, never merged. An invoice photo follows when the bytes can go.", "Bez signálu nevadí \u2014 záznam se jen přidá. Fotka faktury odejde se signálem."), "offline"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          var what = String(d.what || "").trim();
          if (!what) return patch({ err: L("Say what was done, in a few words.", "Napište pár slovy, co se dělalo.") });
          if (!d.date || d.date > TD) return patch({ err: L("A service is logged on the day it happened, not ahead.", "Servis se zapisuje ke dni, kdy proběhl, ne dopředu.") });
          if (e.acquired && d.date < e.acquired) return patch({ err: L("Rejected: an entry can't be older than the thing.", "Odmítnuto: záznam nemůže být starší než věc.") });
          var cost = d.cost === "" ? 0 : parseNum(d.cost);
          if (cost == null) return patch({ err: L("Type the cost as a number.", "Zapište cenu číslem.") });
          var rv = usc2 && d.reading !== "" ? parseNum(d.reading) : null;
          var r = { id: uid("r"), entity: e.id, date: d.date, what: what, en: what, by: String(d.by || "").trim() || name(me), cost: cost, docs: 0, actor: me, session: true, queued: off };
          if (rv != null) { r.value = rv; r.unit = usc2.unit; }
          var sc = d.sch ? A.schedule(d.sch) : null, oldS = sc ? { lastDone: sc.lastDone, lastValue: sc.lastValue } : null;
          var before = sc ? dueOf(sc) : null;
          commit(function () { A.records.push(r); if (sc && d.date >= sc.lastDone) { sc.lastDone = d.date; if (rv != null) sc.lastValue = rv; } },
            function () { A.records.splice(A.records.indexOf(r), 1); if (sc) Object.assign(sc, oldS); },
            function () {
              var after = sc ? dueOf(sc) : null;
              return L("Logged", "Zapsáno") + (after && d.date >= oldS.lastDone ? L(" \u00b7 next ", " \u00b7 další ") + day(after.resolved) : "") +
                (before && before.overdue && after && !after.overdue ? L(" \u00b7 no longer overdue", " \u00b7 už ne po termínu") : "");
            });
        })];
      }

      if (d.kind === "schedule" && e) {
        out.title = d.edit ? L("Edit the schedule", "Upravit interval") : L("Add a schedule", "Přidat interval"); out.sub = thingN(e);
        B.push(field({ label: L("Name", "Název"), value: d.name, placeholder: L("Annual service", "Roční servis"), set: function (v) { patch({ name: v, err: "" }); } }));
        B.push(field({ label: L("Every", "Každých"), mode: "numeric", value: d.months, suffix: L("months", "měsíců"), narrow: true, set: function (v) { patch({ months: v, err: "" }); } }));
        B.push(field({ label: L("Or every", "Nebo každých"), mode: "decimal", value: d.every, suffix: d.unit, narrow: true, hint: L("By usage \u2014 litres through a filter. Fill both and whichever comes first applies.", "Podle spotřeby \u2014 litry přes filtr. Vyplňte obojí a platí, co přijde dřív."), set: function (v) { patch({ every: v, err: "" }); } }));
        B.push(field({ label: L("Last done", "Naposledy"), type: "date", value: d.lastDone, narrow: true, set: function (v) { patch({ lastDone: v, err: "" }); } }));
        var mo = d.months === "" ? null : parseNum(d.months), ev = d.every === "" ? null : parseNum(d.every);
        if ((mo || ev) && d.lastDone) {
          var tmp = { id: "__pr_preview", entity: e.id, cs: "", basis: mo && ev ? "both" : mo ? "interval" : "usage", months: mo || null, everyUnit: ev || null, unit: d.unit, lastDone: d.lastDone, lastValue: null };
          var prevS = d.edit ? A.schedule(d.edit) : null; if (prevS && prevS.lastValue != null) tmp.lastValue = prevS.lastValue;
          A.schedules.push(tmp); var pv = safe(function () { return A.due(tmp.id, TD); }, null); A.schedules.splice(A.schedules.indexOf(tmp), 1);
          if (pv && pv.resolved) B.push(note(L("Next: ", "Další: ") + day(pv.resolved) + " \u00b7 " + (pv.noReading ? L("by date, because nobody has logged a reading yet", "podle data, protože zatím není odpočet") : pv.reason === "usage" ? L("by usage, an estimate", "podle spotřeby, odhad") : L("by date", "podle data")), "box"));
          else if (pv && tmp.basis === "usage") B.push(note(L("By usage alone this needs two readings before it can say a date.", "Jen podle spotřeby potřebuje dva odpočty, než řekne datum."), "boxWarn"));
        }
        if (off) B.push(note(L("A schedule needs a connection to save. Two offline versions of \u201cevery 12 months\u201d would be two different plans, so this one asks rather than queues. Logging a service works offline.",
          "Interval se ukládá jen online. Dvě offline verze by byly dva různé plány. Zapsat servis offline jde."), "boxOff"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, d.edit ? btn(L("Remove", "Odebrat"), "danger-ghost", function () {
          var sc = A.schedule(d.edit), ix = A.schedules.indexOf(sc);
          commit(function () { A.schedules.splice(ix, 1); }, function () { A.schedules.splice(ix, 0, sc); }, L("Schedule removed \u00b7 the history stays", "Interval odebrán \u00b7 historie zůstává"));
        }, off) : null, btn(L("Save", "Uložit"), "primary", function () {
          if (!mo && !ev) return patch({ err: L("Rejected: a schedule needs at least one interval \u2014 months, usage, or both.", "Odmítnuto: interval musí být aspoň jeden \u2014 měsíce, spotřeba, nebo obojí.") });
          if ((mo && mo % 1) || (d.months !== "" && !mo) || (d.every !== "" && !ev)) return patch({ err: L("Whole months, and a positive usage figure.", "Celé měsíce a kladná spotřeba.") });
          if (!d.lastDone || d.lastDone > TD) return patch({ err: L("Last done is a day that has happened.", "Naposledy je den, který už byl.") });
          var nm = String(d.name || "").trim() || L("Service", "Servis");
          var vals = { cs: nm, en: nm, basis: mo && ev ? "both" : mo ? "interval" : "usage", months: mo || null, everyUnit: ev || null, unit: ev ? d.unit : undefined, lastDone: d.lastDone };
          if (d.edit) {
            var sc = A.schedule(d.edit), old = {}; Object.keys(vals).forEach(function (k2) { old[k2] = sc[k2]; });
            commit(function () { Object.assign(sc, vals); }, function () { Object.assign(sc, old); }, function () { var nd = dueOf(sc); return L("Schedule saved", "Interval uložen") + (nd && nd.resolved ? L(" \u00b7 next ", " \u00b7 další ") + day(nd.resolved) : ""); });
          } else {
            var ns = Object.assign({ id: uid("sch"), entity: e.id, lastValue: null, session: true }, vals);
            commit(function () { A.schedules.push(ns); }, function () { A.schedules.splice(A.schedules.indexOf(ns), 1); }, L("Schedule added", "Interval přidán"));
          }
        }, off)].filter(Boolean);
      }

      if (d.kind === "reading" && e) {
        var sc3 = A.schedule(d.sch), unit3 = sc3 ? sc3.unit : "l", lr3 = A.latest(e.id, unit3);
        out.title = L("Add a reading", "Zapsat stav"); out.sub = thingN(e) + (lr3 ? L(" \u00b7 last ", " \u00b7 posledně ") + num(lr3.milli / 1000) + "\u00a0" + unit3 + " (" + day(lr3.date, false) + ")" : "");
        B.push(field({ label: L("Reading", "Stav"), mode: "decimal", value: d.value, suffix: unit3, narrow: true, err: d.err, set: function (v) { patch({ value: v, err: "" }); } }));
        B.push(field({ label: L("Date", "Datum"), type: "date", value: d.date, narrow: true, set: function (v) { patch({ date: v, err: "" }); } }));
        if (!lr3) B.push(note(L("This is the first reading, so it becomes the starting point: the " + unit3 + " half of the schedule counts from here.", "Je to první odpočet, takže bude výchozím bodem."), "box"));
        if (off) B.push(note(L("Checked against the readings this device holds, then queued. The server has the final word \u2014 a reading can still come back rejected against one this device never saw.",
          "Zkontroluje se proti odpočtům v zařízení a zařadí do fronty. Poslední slovo má server."), "offline"));
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          var v = parseNum(d.value);
          if (v == null) return patch({ err: L("Type the number on the counter.", "Zapište číslo z počítadla.") });
          if (!d.date || d.date > TD) return patch({ err: L("A reading is for a day that has happened.", "Odpočet je ke dni, který už byl.") });
          var milli = Math.round(v * 1000);
          var before3 = A.readingsOf(e.id, unit3).filter(function (r) { return r.date <= d.date; }).pop();
          var after3 = A.readingsOf(e.id, unit3).filter(function (r) { return r.date > d.date; })[0];
          if (before3 && milli < before3.milli) return patch({ err: L("Rejected: " + num(v) + " " + unit3 + " is less than " + num(before3.milli / 1000) + " " + unit3 + " on " + day(before3.date, false) + ". A counter doesn't go back.", "Odmítnuto: " + num(v) + " " + unit3 + " je míň než " + num(before3.milli / 1000) + " " + unit3 + " z " + day(before3.date, false) + ". Počítadlo nejde zpátky.") });
          if (after3 && milli > after3.milli) return patch({ err: L("Rejected: that is more than the later reading of " + num(after3.milli / 1000) + " " + unit3 + " on " + day(after3.date, false) + ".", "Odmítnuto: je to víc než pozdější odpočet " + num(after3.milli / 1000) + " " + unit3 + ".") });
          var r = { entity: e.id, date: d.date, milli: milli, unit: unit3, by: me, src: "manual", session: true, queued: off };
          var setBase = sc3 && sc3.lastValue == null && !lr3;
          commit(function () { A.readings.push(r); if (setBase) sc3.lastValue = v; }, function () { A.readings.splice(A.readings.indexOf(r), 1); if (setBase) sc3.lastValue = null; },
            num(v) + "\u00a0" + unit3 + L(" recorded", " zapsáno") + (setBase ? L(" \u00b7 starting point set", " \u00b7 výchozí bod") : ""));
        })];
      }

      if (d.kind === "retire" && e) {
        out.title = L("Retire or sell " + thingN(e), "Vyřadit nebo prodat: " + thingN(e));
        out.sub = L("Nothing is deleted. The history, the documents and the costs stay with the house.", "Nic se nesmaže. Historie, dokumenty i náklady zůstávají u domu.");
        B.push(chips(L("What happened", "Co se stalo"), [chip(L("Retired", "Vyřazeno"), d.how === "retired", function () { patch({ how: "retired" }); }), chip(L("Sold", "Prodáno"), d.how === "sold", function () { patch({ how: "sold" }); })]));
        B.push(field({ label: L("When", "Kdy"), type: "date", value: d.date, narrow: true, set: function (v) { patch({ date: v, err: "" }); } }));
        if (d.how === "sold") B.push(field({ label: L("Sold for", "Prodáno za"), mode: "decimal", value: d.price, suffix: "Kč", narrow: true, set: function (v) { patch({ price: v, err: "" }); } }));
        var sn = A.schedulesOf(e.id).length;
        if (sn) B.push(note(L(sn + (sn === 1 ? " schedule stops" : " schedules stop") + " and no more reminders go out for it.", "Zastaví se " + sn + " interval(y) a připomínky přestanou."), "box"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(d.how === "sold" ? L("Mark as sold", "Označit jako prodané") : L("Retire it", "Vyřadit"), "danger", function () {
          if (!d.date || d.date > TD) return patch({ err: L("Pick the day it left.", "Vyberte den, kdy odešlo.") });
          var sp = d.how === "sold" && d.price !== "" ? parseNum(d.price) : null;
          var old = { status: e.status, ended: e.ended, how: e.how, soldFor: e.soldFor };
          commit(function () { e.status = "retired"; e.ended = d.date; e.how = d.how; e.soldFor = sp; }, function () { Object.assign(e, old); },
            thingN(e) + (d.how === "sold" ? L(" sold", " prodáno") : L(" retired", " vyřazeno")) + L(" \u00b7 history kept", " \u00b7 historie zůstává"), { route: "/property" });
        })];
      }

      if (d.kind === "record") {
        var r = A.records.filter(function (x) { return x.id === d.id; })[0];
        if (!r) return null;
        var re = A.entity(r.entity);
        out.title = recN(r); out.sub = thingN(re) + " \u00b7 " + day(r.date);
        B.push(kv([[L("Who did it", "Kdo to dělal"), r.by], [L("Cost", "Cena"), r.cost ? czk(r.cost) : L("nothing", "nic")], r.value != null && r.unit ? [L("Reading then", "Stav tehdy"), num(r.value) + "\u00a0" + r.unit] : null,
          [L("Invoice", "Faktura"), r.docs ? r.docs + L(" attached", " přiloženo") : L("none attached", "nepřiložena")], [L("Recorded by", "Zapsal(a)"), name(r.actor)],
          r.queued && off ? [L("Status", "Stav"), L("Queued on this device", "Čeká v zařízení")] : null]));
        var k2 = A.contractors.filter(function (x) { return x.name === r.by; })[0];
        if (k2) B.push(rows([row({ title: k2.name, sub: [tradeN(k2.trade), k2.phone].filter(Boolean).join(" \u00b7 "), open: go("/property/contractors/" + k2.id) })]));
        out.foot = [closeB, canM ? btn(L("Delete entry", "Smazat záznam"), "danger-ghost", function () {
          var ix = A.records.indexOf(r);
          commit(function () { A.records.splice(ix, 1); }, function () { A.records.splice(ix, 0, r); }, L("Entry deleted", "Záznam smazán"));
        }, off) : null].filter(Boolean);
        if (off && canM) out.footNote = L("Corrections happen online. Adding works offline.", "Opravy jen online. Přidávat jde offline.");
      }

      if (d.kind === "contractor") {
        out.title = d.edit ? L("Edit contact", "Upravit kontakt") : L("Add a contact", "Přidat kontakt");
        out.sub = L("A name, and a phone or an email.", "Jméno a telefon nebo e-mail.");
        B.push(field({ label: L("Name", "Jméno"), value: d.name, placeholder: "Novotný \u2014 servis", set: function (v) { patch({ name: v, err: "" }); } }));
        B.push(field({ label: L("Trade", "Obor"), value: d.trade, placeholder: L("Boilers and gas", "Kotle a plyn"), set: function (v) { patch({ trade: v }); } }));
        B.push(field({ label: L("Phone", "Telefon"), type: "tel", mode: "tel", value: d.phone, placeholder: "+420 604 118 220", narrow: true, set: function (v) { patch({ phone: v, err: "" }); } }));
        B.push(field({ label: L("Email", "E-mail"), type: "email", mode: "email", value: d.email, set: function (v) { patch({ email: v, err: "" }); } }));
        B.push(field({ label: L("Note", "Poznámka"), value: d.note, placeholder: L("Only picks up in the mornings", "Bere jen dopoledne"), set: function (v) { patch({ note: v }); } }));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          var nm = String(d.name || "").trim(), ph = String(d.phone || "").trim(), em = String(d.email || "").trim();
          if (!nm) return patch({ err: L("A contact needs a name.", "Kontakt potřebuje jméno.") });
          if (!ph && !em) return patch({ err: L("Rejected: a phone or an email, at least one.", "Odmítnuto: telefon nebo e-mail, aspoň jedno.") });
          if (ph && !/^\+?[\d\s()-]{6,}$/.test(ph)) return patch({ err: L("That phone number isn't in a shape a phone can dial.", "Telefon není ve správném tvaru.") });
          if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return patch({ err: L("That email is missing something.", "E-mailu něco chybí.") });
          var vals = { name: nm, trade: String(d.trade || "").trim(), phone: ph, email: em, note: String(d.note || "").trim() };
          if (d.edit) {
            var k3 = A.contractors.filter(function (x) { return x.id === d.edit; })[0], old = {}; Object.keys(vals).forEach(function (x) { old[x] = k3[x]; });
            var renamed = A.records.filter(function (x) { return x.by === old.name; });
            commit(function () { Object.assign(k3, vals); renamed.forEach(function (x) { x.by = nm; }); }, function () { Object.assign(k3, old); renamed.forEach(function (x) { x.by = old.name; }); }, L("Saved", "Uloženo"));
          } else {
            var nk = Object.assign({ id: uid("k"), did: [], session: true, queued: off }, vals);
            commit(function () { A.contractors.push(nk); }, function () { A.contractors.splice(A.contractors.indexOf(nk), 1); }, nm + L(" added", " přidán"), d.back ? { route: d.back } : {});
          }
        })];
      }

      if (d.kind === "meterView") {
        var m = A.meters[d.ix]; if (!m) return null;
        var en = EN.meter[d.ix] && !m.session ? EN.meter[d.ix] : null;
        out.title = cs || !en ? m.cs : en[0]; out.sub = cs || !en ? m.where : en[1];
        B.push(note((cs || !en ? m.note : en[2]) || L("No note.", "Bez poznámky."), "box"));
        B.push(kv([[L("Photo", "Fotka"), m.photo ? L("attached \u00b7 on this device", "přiložena \u00b7 v zařízení") : L("none yet", "zatím není")]]));
        var svc = m.link ? m.link.split(".")[1] : "";
        if (m.link) B.push(note(L("What it reads belongs in Utilities.", "Kolik na něm je, patří do Energií."), "", utilOK ? L("Open in Utilities", "Otevřít v Energiích") : "", utilOK ? go("/utilities/" + svc) : null));
        out.foot = [closeB, canC ? btn(L("Edit", "Upravit"), "", function () { patch({ kind: "meter", edit: d.ix, name: out.title, where: out.sub, note: (cs || !en ? m.note : en[2]) || "", link: m.link || "", err: "" }); }) : null].filter(Boolean);
      }

      if (d.kind === "meter") {
        out.title = d.edit != null ? L("Edit place", "Upravit místo") : L("Add a place", "Přidat místo");
        out.sub = L("Where it is and how to get at it \u2014 not what it reads.", "Kde to je a jak se k tomu dostat \u2014 ne kolik na tom je.");
        B.push(field({ label: L("What", "Co"), value: d.name, placeholder: L("Main water stopcock", "Hlavní uzávěr vody"), set: function (v) { patch({ name: v, err: "" }); } }));
        B.push(field({ label: L("Where", "Kde"), value: d.where, placeholder: L("cellar, behind the shelf on the left", "sklep, za regálem vlevo"), set: function (v) { patch({ where: v, err: "" }); } }));
        B.push(field({ label: L("How to get at it", "Jak se k tomu dostat"), value: d.note, placeholder: L("The 24 spanner hangs next to it", "Klíč na 24 visí vedle"), set: function (v) { patch({ note: v }); } }));
        B.push(chips(L("Linked meter in Utilities", "Propojený měřič v Energiích"), [["", L("None", "Žádný")], ["utilities.electricity", L("Electricity", "Elektřina")], ["utilities.gas", L("Gas", "Plyn")], ["utilities.water", L("Water", "Voda")]].map(function (x) {
          return chip(x[1], (d.link || "") === x[0], function () { patch({ link: x[0] }); });
        })));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          var nm = String(d.name || "").trim(), wh = String(d.where || "").trim();
          if (!nm || !wh) return patch({ err: L("Say what it is and where.", "Napište co to je a kde.") });
          var vals = { cs: nm, where: wh, note: String(d.note || "").trim(), link: d.link || null, session: true };
          if (d.edit != null) {
            var m2 = A.meters[d.edit], old = Object.assign({}, m2);
            commit(function () { Object.assign(m2, vals); }, function () { Object.keys(m2).forEach(function (x) { delete m2[x]; }); Object.assign(m2, old); }, L("Saved", "Uloženo"));
          } else {
            var nm2 = Object.assign({ photo: false }, vals);
            commit(function () { A.meters.push(nm2); }, function () { A.meters.splice(A.meters.indexOf(nm2), 1); }, nm + L(" added", " přidáno"));
          }
        })];
      }
      return out;
    }

    /* ── assemble ── */
    var footBar = function (bg) {
      return "position:sticky;bottom:0;margin-top:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--border);background:" + bg;
    };
    var panes = [];
    if (wide) {
      var navRows = [row({ title: L("In the house", "V domě"), sub: things.length + L(" things", " věcí"), on: page === "home" || (page === "item" && cur && cur.status === "active") || page === "schedules" || page === "records" || page === "readings", noChev: true, open: go("/property") }),
        row({ title: L("All dates", "Všechny termíny"), sub: overdue.length ? overdue.length + L(" overdue", " po termínu") : soon.length + L(" in 30 days", " do 30 dní"), subTone: overdue.length ? "danger" : "", right: String(dues.length), on: page === "due", noChev: true, open: go("/property/due") }),
        row({ title: L("Contractors", "Živnostníci"), sub: A.contractors.length + L(" contacts", " kontaktů"), on: page === "contractors" || page === "contractor", noChev: true, open: go("/property/contractors") }),
        row({ title: L("Where the meters are", "Kde jsou měřiče"), sub: A.meters.length + L(" places", " míst"), on: page === "meters", noChev: true, open: go("/property/dum-brno/meters") })];
      var navRows2 = [row({ title: L("What it costs", "Kolik to stoj\u00ed"), sub: L("per thing, per year", "podle v\u011bci a roku"), on: page === "costs", noChev: true, open: go("/property/costs") }), row({ title: L("Insurance inventory", "Inventura pro pojištění"), sub: czk(A.inventoryRun().total), on: page === "print", noChev: true, open: go("/property/print/inventory") })];
      if (canM) navRows2.push(row({ title: L("Starter checklist", "Startovací seznam"), sub: L("by country", "podle země"), on: page === "setup", noChev: true, open: go("/property/setup/checklist") }));
      if (retired.length) navRows2.push(row({ title: L("Retired and sold", "Vyřazeno a prodáno"), sub: String(retired.length), on: page === "retired" || (page === "item" && cur && cur.status !== "active"), noChev: true, open: go("/property/retired") }));
      var navTop = canC ? [acts([btn(L("+ Thing", "+ Věc"), "primary", open(thingDraft(null)))])] : [];
      panes.push({ key: "nav", role: "navigation", title: L("Property", "Dům a vybavení"),
        outer: "flex:0 0 " + (web ? "300px" : "36%") + ";min-width:0;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--border);background:var(--surface)",
        inner: "flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column", col: "display:flex;flex-direction:column;padding-bottom:24px",
        onOuter: function () {}, hasHead: false, sub: "", hasFoot: false, foot: [], footNote: "", footStyle: "",
        blocks: navTop.filter(Boolean).concat([label(house ? thingN(house) : L("Property", "Dům")), rows(navRows), label(L("For the day it's needed", "Pro den, kdy je to potřeba")), rows(navRows2)]) });
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

    var top = page === "home" || (wide && ["due", "contractors", "meters", "print", "setup", "retired"].indexOf(page) >= 0);
    var parent = page === "item" ? (cur && cur.status !== "active" ? "/property/retired" : "/property")
      : page === "schedules" || page === "records" || page === "readings" ? itemRoot
      : page === "contractor" ? "/property/contractors" : "/property";
    return { panes: panes, headTitle: headTitle, headSub: headSub, sheetOpen: !!sheetD, showBack: !top,
      onBack: function () { self.setState({ prSheet: null }); self.go(parent); } };
  }

  window.HH_PR_VIEW = view;
})();
