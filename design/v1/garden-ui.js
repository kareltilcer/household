/* Garden, live in the prototype shell.
   Every figure is computed by garden.js (HH_GARDEN) at render time, and every write lands on
   the engine's own rows — plantings, task state, harvests, storage, dismissals, overrides,
   seasons, the climate — so the plan check, the task list, the frost warning and the yields
   recompute together the moment something is saved. Undo reverses the same mutation.
   Drawn through the Finance block vocabulary, like Utilities, so it shares the shell's panes. */
(function () {
  var KINDS = ["Hero", "Label", "Rows", "Note", "Bars", "Acts", "Field", "Chips", "Inputs", "Cards", "Steps", "Kv", "Empty"];
  var LV = ["none", "view", "contribute", "manage"];
  var MEN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MCS = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
  var ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
  function safe(fn, d) { try { var v = fn(); return v == null ? d : v; } catch (e) { return d; } }

  function view(self, seg, query, hash, wide) {
    var G = window.HH_GARDEN, F = window.HH_FIXTURES, N = window.HH_NAV;
    if (!G) return null;
    var s = self.state, L = self.chatL.bind(self), web = s.client === "web", cs = s.locale === "cs";
    var nav = N ? N.navFor(s.member, s.household) : {};
    var lvl = (nav.grants || {}).garden || "none";
    var ro = ["read_only", "canceled", "restricted"].indexOf(s.ent) >= 0 || s.screen === "readonly";
    var canC = LV.indexOf(lvl) >= 2 && !ro, canM = LV.indexOf(lvl) >= 3 && !ro;
    var me = s.member, TD = G.today, rev = s.gaRev || 0, isEmpty = s.screen === "empty";
    var tier = s.gaTier || "plot";
    if (G && !G.suggestions) {
      var c0 = G.crops[0] || {}, c1 = G.crops[1] || c0;
      G.suggestions = [
        { id: "sg-1", crop: c0.id, field: "dtm", value: (c0.dtm || 70) + 10, why: "Three seasons in a row it has needed about ten days longer here; the seed packet says the same.", by: "jana", on: "2026-06-14", status: "accepted" },
        { id: "sg-2", crop: c1.id, field: "spacing", value: 5, why: "Thinned to 5 cm it still sizes up.", by: "jana", on: "2026-07-02", status: "declined", reason: "Kept at the catalog value: 5 cm suits baby roots, and the catalog spaces for full-size ones. An override is the right tool for your garden." },
        { id: "sg-3", crop: null, name: "Pak choi", latin: "Brassica rapa subsp. chinensis", why: "Grown here every autumn and not in the catalog.", by: "jana", on: "2026-08-30", status: "waiting" }
      ];
    }
    var SGF = { dtm: [L("Days to maturity", "Dní do sklizně"), L("days", "dní")], spacing: [L("Spacing", "Spon"), "cm"], perM2: [L("Plants per m\u00b2", "Rostlin/m\u00b2"), ""], yieldM2: [L("Yield", "Výnos"), "kg/m\u00b2"], breakYears: [L("Rotation break", "Odstup"), L("years", "roky")] };
    var sugRow = function (x) {
      var cN = x.crop && G.byCrop[x.crop] ? G.byCrop[x.crop].cs : "";
      var st = x.status === "accepted" ? [L("accepted \u00b7 in v", "přijato \u00b7 ve v") + G.catalog.next.version, "accent"] : x.status === "declined" ? [L("not taken", "nepřijato"), ""] : [L("waiting for review", "čeká na posouzení"), ""];
      return row({ title: x.crop ? cN + " \u00b7 " + (SGF[x.field] ? SGF[x.field][0] : x.field) + " \u2192 " + x.value + "\u00a0" + (SGF[x.field] ? SGF[x.field][1] : "") : L("Missing crop: ", "Chybí: ") + x.name,
        sub: (x.status === "declined" && x.reason ? x.reason : "\u201c" + x.why + "\u201d") + " \u00b7 " + (x.by === me ? L("you", "vy") : x.by) + " \u00b7 " + x.on.slice(8, 10).replace(/^0/, "") + ". " + x.on.slice(5, 7).replace(/^0/, "") + ".",
        badge: st[0], badgeTone: st[1] });
    };
    var shown = {}; G.tierView(tier).shown.forEach(function (x) { shown[x[0]] = 1; });
    var name = function (id) { var m = F ? F.members.filter(function (x) { return x.id === id; })[0] : null; return m ? m.name : id; };
    var go = function (r) { return function () { self.setState({ gaSheet: null }); self.go(r); }; };

    /* ── words ── */
    var day = function (iso, y) {
      if (!iso) return "\u2013";
      var p = iso.split("-");
      return cs ? (+p[2]) + ". " + MCS[+p[1] - 1] + (y === false ? "" : " " + p[0]) : (+p[2]) + " " + MEN[+p[1] - 1] + (y === false ? "" : " " + p[0]);
    };
    var span = function (a, b) { return day(a, false) + " \u2013 " + day(b, false); };
    var KW = { sow_indoor: ["Sow indoors", "Předpěstovat"], prick_out: ["Prick out", "Přepikýrovat"], harden_off: ["Harden off", "Otužovat"],
      transplant: ["Transplant", "Vysadit"], direct_sow: ["Direct sow", "Vysít"], support: ["Put up supports", "Opory"], mulch: ["Mulch", "Mulčovat"],
      pest_check: ["Pest check", "Kontrola škůdců"], harvest: ["Harvest", "Sklizeň"] };
    var kindW = function (k) {
      var base = String(k).replace(/_autumn$/, ""), w = KW[base];
      return (w ? L(w[0], w[1]) : k) + (/_autumn$/.test(k) ? L(" (autumn)", " (podzim)") : "");
    };
    var hardW = function (h) { return h === "tender" ? L("tender", "choulostivá") : h === "half" ? L("half-hardy", "polomrazuvzdorná") : L("hardy", "mrazuvzdorná"); };
    var bedL = function (n) { return L("Bed ", "Záhon ") + n; };
    var zoneOfBed = function (n) { var b = G.bed(n); return b ? G.zones.filter(function (z) { return z.id === b.zone; })[0] : null; };
    var qtyW = function (p) { return p.plants != null ? p.plants + L(" plants", " rostlin") : String(p.area).replace(".", cs ? "," : ".") + "\u00a0m\u00b2"; };
    var kg = function (n) { return (Math.round(n * 10) / 10).toString().replace(".", cs ? "," : ".") + "\u00a0kg"; };
    var cropW = function (id) { return G.cropName(id); };
    var parseNum = function (v) {
      var t = String(v == null ? "" : v).replace(/[\s\u00a0]/g, "").replace(",", ".");
      return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
    };
    var srcW = function (k) { var S = G.sources[k]; return S ? S.label : k; };
    var clsW = function (c) { return c === "folklore" ? L("folklore", "lidová tradice") : c === "household" ? L("this household", "tato domácnost") : L("agronomy", "agronomie"); };
    var fromW = function (f) { return f === "variety" ? L("variety", "odrůda") : f === "override" ? L("your override", "vaše úprava") : L("catalog", "katalog"); };

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
        titleStyle: "font-size:0.9375em;line-height:1.35;overflow-wrap:anywhere;font-weight:" + (p.strong ? "600" : "500") + ";color:" + (p.muted ? "var(--text-muted)" : "var(--text-primary)") +
          (p.strike ? ";text-decoration:line-through" : ""),
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
          (tone === "box" || tone === "boxWarn" || tone === "boxDanger"
            ? "margin:10px 16px;padding:12px 14px;border-radius:10px;background:var(--surface-sunken);color:var(--text-primary)" +
              (tone === "boxWarn" ? ";box-shadow:inset 3px 0 0 var(--warning)" : tone === "boxDanger" ? ";box-shadow:inset 3px 0 0 var(--danger)" : "")
            : "padding:10px 16px;color:" + inkOf(tone || "muted")) });
    };
    var btn = function (lbl, kind, on, off) { return { label: lbl, style: self.docBtn(kind, off ? false : undefined), on: off ? function () {} : on, off: !!off }; };
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
    var cardStyle = function (on) {
      return "display:flex;flex-direction:column;gap:6px;align-items:flex-start;text-align:left;padding:14px;border-radius:12px;cursor:pointer;font-family:inherit;color:inherit;min-height:84px;" +
        "border:1px solid " + (on ? "var(--accent)" : "var(--border-strong)") + ";background:" + (on ? "var(--surface-sunken)" : "var(--surface-raised)") +
        ";box-shadow:" + (on ? "inset 0 0 0 1px var(--accent)" : "none");
    };
    var cards = function (items) { return blk("Cards", { items: items }); };
    var empty = function (t, body, action, on) { return blk("Empty", { title: t, body: body, action: action || "", on: on || function () {} }); };
    var stat = function (k, v, sub, tone) {
      return { k: k, v: v, sub: sub || "", vStyle: "font-family:'IBM Plex Mono',monospace;font-size:1.0625em;font-weight:500;font-variant-numeric:tabular-nums;color:" + inkOf(tone) };
    };
    var hero = function (p) {
      return blk("Hero", Object.assign({ kicker: "", big: "", sub: "", stats: [] }, p, {
        hasStats: !!(p.stats && p.stats.length), hasNav: false, onPrev: function () {}, onNext: function () {}, prevOff: true, nextOff: true,
        bigStyle: "font-size:2.125em;font-weight:600;letter-spacing:-0.02em;line-height:1.15;overflow-wrap:anywhere;color:" + inkOf(p.tone) }));
    };
    var steps = function (list, cur) {
      return blk("Steps", { items: list.map(function (x, i) {
        var on = i === cur, done = i < cur;
        return { label: (done ? "\u2713 " : (i + 1) + " \u00b7 ") + x, style: "display:inline-flex;align-items:center;min-height:28px;padding:0 10px;border-radius:14px;font-size:0.71875em;white-space:nowrap;" +
          "border:1px solid " + (on ? "var(--accent)" : "var(--border)") + ";color:" + (on ? "var(--text-on-accent)" : done ? "var(--text-primary)" : "var(--text-muted)") +
          ";background:" + (on ? "var(--accent)" : "transparent") };
      }) });
    };
    var bars = function (list) {
      var max = list.reduce(function (n, p) { return Math.max(n, p.v, p.target || 0); }, 0) || 1;
      return blk("Bars", { rows: list.map(function (p) {
        return { name: p.name, right: p.right, left: p.left || "", proj: p.proj || "",
          rightStyle: "font-family:'IBM Plex Mono',monospace;font-size:0.8125em;white-space:nowrap;color:var(--text-primary)",
          projStyle: "white-space:nowrap;color:" + (p.projTone ? inkOf(p.projTone) : "var(--text-muted)"),
          fill: "position:absolute;left:0;top:0;bottom:0;border-radius:4px;width:" + Math.max(p.v ? 2 : 0, Math.min(100, Math.round(p.v / max * 100))) + "%;background:" + (p.ink || "var(--accent)"),
          tick: p.target ? "position:absolute;top:-3px;bottom:-3px;width:2px;border-radius:1px;background:var(--text-primary);left:calc(" + Math.min(100, Math.round(p.target / max * 100)) + "% - 1px)" : "display:none",
          noOpen: !p.open, open: p.open || function () {}, cursor: p.open ? "pointer" : "default" };
      }) });
    };

    /* ── session writes ── */
    var bump = function (extra) { self.setState(Object.assign({ gaRev: (self.state.gaRev || 0) + 1 }, extra || {})); };
    var commit = function (doIt, undo, toast, extra) {
      doIt();
      bump(Object.assign({ gaSheet: null }, extra || {}));
      if (toast) self.docToastShow(toast + (s.online ? "" : L(" \u00b7 saved on this device", " \u00b7 uloženo v zařízení")), undo ? function () {
        undo(); bump({ docToast: null });
      } : null);
    };
    var open = function (d) { return function () { self.setState({ gaSheet: Object.assign({ at: self.state.route }, d) }); }; };

    /* ── the engine, read ── */
    var allT = safe(function () { return G.tasks({ withManual: true }); }, []);
    var openT = allT.filter(function (t) { return t.status === "open"; });
    var wk = G.weekKey(TD);
    var overdue = openT.filter(function (t) { return t.due < TD; });
    var thisWeek = openT.filter(function (t) { return t.due >= TD && G.weekKey(t.due) === wk; });
    var ps26 = G.plantingsOf(2026);
    var endOf = function (p) { return p.cleared || (p.actual && p.actual.harvest) || p.occupancy.to; };
    var inNow = function (p) { return !!p.occupancy.from && p.occupancy.from <= TD && TD <= endOf(p); };
    var frost = safe(function () { return G.frostWarning(TD); }, { published: false, plants: [] });
    var ready = safe(function () { return G.harvestReady(TD); }, []).filter(function (p) { return !(p.actual && p.actual.harvest); });
    var care = safe(function () { return G.careDue(TD); }, []).filter(function (x) { return tier !== "pots" || /^k-/.test(x.target); });
    var checkList = shown.full_check ? safe(function () { return G.planCheck(2026); }, []) : shown.reduced_check ? safe(function () { return G.planCheck(2026, { reduced: true }); }, []) : [];
    var csum = G.checkSummary(checkList);
    var y26 = safe(function () { return G.yieldRun(2026); }, { actual: 0, expected: 0, logged: 0, rows: [] });
    var S26 = G.season(2026);
    var clim26 = { lastFrost: S26.lastFrost, firstFrost: S26.firstFrost };
    var taskById = function (id) { return allT.filter(function (t) { return t.id === id; })[0] || null; };
    var careTarget = function (id) {
      var z = G.zones.filter(function (x) { return x.id === id; })[0];
      if (z) return z.name;
      var k = G.containers.filter(function (x) { return x.id === id; })[0];
      return k ? k.name : id;
    };

    /* ── task writes ── */
    var setTask = function (t, patch, toast) {
      if (t.is_generated) {
        var had = Object.prototype.hasOwnProperty.call(G.taskState, t.id), prev = had ? Object.assign({}, G.taskState[t.id]) : null;
        commit(function () { G.taskState[t.id] = Object.assign({}, prev || {}, patch); },
          function () { if (had) G.taskState[t.id] = prev; else delete G.taskState[t.id]; }, toast);
      } else {
        var m = G.manualTasks.filter(function (x) { return x.id === t.id; })[0];
        if (!m) return;
        var old = Object.assign({}, m);
        commit(function () { Object.assign(m, patch); if (patch.due) m.week = G.weekKey(patch.due); }, function () { Object.assign(m, old); }, toast);
      }
    };
    var doneTask = function (t) { return function () { setTask(t, { status: "done", doneOn: TD }, L("Done \u00b7 ", "Hotovo \u00b7 ") + taskTitle(t)); }; };
    var reopenTask = function (t) { return function () { setTask(t, { status: "open", doneOn: null }, L("Back on the list", "Zpět na seznamu")); }; };
    var taskTitle = function (t) {
      return t.is_generated ? kindW(t.kind) + " \u00b7 " + cropW(t.crop) + " \u00b7 " + bedL(t.bed) : t.title;
    };
    var taskRow = function (t, o) {
      o = o || {};
      var done = t.status === "done", skipped = t.status === "skipped", late = t.status === "open" && t.due < TD;
      var bits = [late ? G.diff(t.due, TD) + L(" days overdue", " dní po termínu") : day(t.due, false)];
      if (!t.is_generated) bits.push(L("your own", "vlastní"));
      if (done && t.doneOn) bits.push(L("done ", "hotovo ") + day(t.doneOn, false));
      if (skipped) bits.push(L("skipped", "přeskočeno"));
      return row({ title: taskTitle(t), sub: bits.join(" \u00b7 "), subTone: late ? "danger" : "", muted: done || skipped, strike: done,
        badge: t.edited ? L("moved by hand", "posunuto ručně") : (t.is_generated && t.manual) ? L("date set by hand", "datum ručně") : "",
        act: canC ? (t.status === "open" ? L("Done", "Hotovo") : done ? L("Reopen", "Vrátit") : "") : "",
        onAct: t.status === "open" ? doneTask(t) : reopenTask(t),
        open: o.noOpen ? null : open({ kind: "task", id: t.id, date: t.due }) });
    };

    /* ── planting helpers ── */
    var plantingRow = function (p, o) {
      o = o || {};
      var now = inNow(p), gone = endOf(p) < TD;
      var sub = [o.withBed ? bedL(p.bed) : "", qtyW(p), p.occupancy.from ? span(p.occupancy.from, endOf(p)) : ""].filter(Boolean).join(" \u00b7 ");
      return row({ title: p.label, sub: sub, muted: gone && !o.strong,
        badge: p.cleared && p.cleared <= TD ? L("cleared", "sklizeno") : (p.actual && p.actual.harvest) ? L("harvested", "sklizeno") : now ? "" : p.occupancy.from > TD ? L("to come", "přijde") : "",
        dot: true, dotInk: now ? "var(--accent)" : "var(--border-strong)", open: go("/garden/plantings/" + p.id) });
    };
    var harvestAct = function (p) { return canC ? open({ kind: "harvest", pid: p.id, qty: "", dest: (G.byCrop[p.crop].storage || [])[0] || "kitchen", on: TD, store: false }) : null; };
    var careRow = function (c) {
      var r = G.care.filter(function (x) { return x.id === c.id; })[0];
      return row({ title: c.label, sub: careTarget(c.target) + L(" \u00b7 every " + c.cadence + " days \u00b7 last ", " \u00b7 každé " + c.cadence + " dny \u00b7 naposledy ") + day(r.last, false),
        right: c.overdue ? G.diff(c.next, TD) + L(" d late", " d po") : c.next === TD ? L("today", "dnes") : day(c.next, false),
        tone: c.overdue ? "danger" : c.next === TD ? "accent" : "",
        act: canC && c.due ? (c.kind === "feed" ? L("Fed", "Pohnojeno") : L("Watered", "Zalito")) : "",
        onAct: function () { var old = r.last; commit(function () { r.last = TD; }, function () { r.last = old; }, c.label + L(" \u00b7 next in " + c.cadence + " days", " \u00b7 další za " + c.cadence + " dny")); } });
    };

    /* ── route ── */
    var a = seg[1] || "", b = seg[2] || "", c = seg[3] || "";
    var q = {}; String(query || "").split("&").forEach(function (kvp) { var p = kvp.split("="); if (p[0]) q[p[0]] = decodeURIComponent(p[1] || ""); });
    var page = "home", id = null;
    if (!a) page = "home";
    else if (a === "setup") { page = "setup"; id = Math.max(1, Math.min(4, parseInt(b, 10) || 1)); }
    else if (a === "beds") { page = b ? "bed" : "beds"; id = b ? Number(b) : null; }
    else if (a === "plantings") { if (b === "new") page = "home"; else { page = "planting"; id = b; } }
    else if (a === "containers") { page = "container"; id = b; }
    else if (a === "tasks") page = "tasks";
    else if (a === "catalog") { page = b === "overrides" ? "overrides" : b ? "crop" : "catalog"; id = b && b !== "overrides" ? b : null; }
    else if (a === "season") {
      if (b === "new") page = "dryrun";
      else if (!b) page = "seasons";
      else { id = Number(b); page = c === "checks" ? "checks" : c === "close" ? "close" : "seasons"; }
    }
    else if (a === "storage") page = "storage";
    else if (a === "print") page = b === "season" ? "printPlan" : "printWork";
    else if (a === "settings") page = "settings";
    else page = "missing";
    var NEED = { bed: "beds", beds: "beds", planting: "plantings", tasks: "tasks", checks: shown.full_check ? "full_check" : "reduced_check",
      dryrun: "seasons", seasons: "seasons", close: "close", storage: "storage", container: "containers", printPlan: "seasons", printWork: "tasks" };
    var absentAtTier = NEED[page] && !shown[NEED[page]];
    var cur = null;
    if (page === "bed" && !G.bed(id)) page = "missing";
    if (page === "planting") { cur = G.planting(id); if (!cur) page = "missing"; }
    if (page === "crop") { cur = G.byCrop[id]; if (!cur) page = "missing"; }
    if (page === "container") { cur = G.containers.filter(function (k) { return k.id === id; })[0]; if (!cur) page = "missing"; }
    if ((page === "checks" || page === "close") && !G.season(id)) page = "missing";

    /* route-owned sheets */
    var routeSheet = null;
    if (a === "plantings" && b === "new" && canC && shown.plantings) routeSheet = plantingDraft(null, q.bed ? Number(q.bed) : null, "/garden" + (q.bed ? "/beds/" + q.bed : ""));
    if (page === "planting" && c === "edit" && canC) routeSheet = Object.assign(plantingDraft(cur), { back: "/garden/plantings/" + cur.id });
    if (page === "planting" && hash === "drift") routeSheet = { kind: "drift", pid: cur.actual && Object.keys(cur.actual).length ? cur.id : "p26-04" };
    var sheetD = (s.gaSheet && s.gaSheet.at === s.route) ? s.gaSheet : routeSheet;
    var patch = function (p) { self.setState({ gaSheet: Object.assign({}, sheetD, { at: self.state.route }, p) }); };
    var closeSheet = function () {
      var back = sheetD && sheetD.back;
      self.setState(Object.assign({ gaSheet: null }, back ? { route: back } : hash ? { route: s.route.split("#")[0] } : {}));
    };

    function plantingDraft(p, bedNum, back) {
      if (p) return { kind: "planting", edit: p.id, bed: p.bed, crop: p.crop, variety: p.variety || "", measure: p.qty.count != null ? "count" : "area",
        amount: String(p.qty.count != null ? p.qty.count : p.qty.area), note: p.note || "", err: "" };
      return { kind: "planting", edit: null, bed: bedNum || null, crop: "", variety: "", measure: "area", amount: "", note: "", err: "", back: back || null };
    }

    var P = [], foot = [], headTitle = L("Garden", "Zahrada"), headSub = "";
    var push = function (x) { if (x) P.push(x); };
    var tierName = { pots: L("Pots", "Květináče"), beds: L("Beds", "Záhony"), plot: L("Plot", "Zahrada") };
    var readNote = ro ? L("Read-only while the subscription is past due. Everything recorded still reads, and the plan check keeps computing.", "Jen ke čtení, dokud není předplatné uhrazeno. Vše zapsané zůstává čitelné.")
      : lvl === "view" ? L("You can read the garden. Ticking a task off or logging a harvest needs contribute.", "Zahradu vidíte. Odškrtnout práci nebo zapsat sklizeň vyžaduje přispívání.") : "";
    if (readNote && page !== "setup") push(note(readNote, "box"));

    /* ═══ pages ═══ */
    if (absentAtTier) {
      headTitle = L("Garden", "Zahrada");
      push(empty(L("Not at the " + tier + " tier", "Na úrovni „" + tierName[tier] + "“ není"),
        L("This household grows at the " + tier + " tier, where this part of Garden isn't drawn. Moving up reveals it and migrates nothing.",
          "Tato domácnost je na úrovni „" + tierName[tier] + "“, kde tato část Zahrady není. Posun výš ji odhalí a nic nepřevádí."),
        canM ? L("Change the tier", "Změnit úroveň") : "", go("/garden/settings")));
      page = "absent";
    }

    if (page === "missing") {
      push(empty(L("Not in this garden", "V této zahradě není"), L("It was deleted, or it was never here.", "Bylo smazáno, nebo tu nikdy nebylo."), L("Back to the garden", "Zpět na zahradu"), go("/garden")));
    }

    if (page === "home") {
      if (tier === "pots") {
        headTitle = L("Pots", "Květináče"); headSub = L("Containers and what is in them", "Nádoby a co v nich roste");
        if (isEmpty) push(empty(L("Nothing planted yet.", "Zatím nic nezasazeno."), L("A pot of basil on the windowsill is a garden.", "Květináč bazalky na okně je taky zahrada."), canC ? L("Add a container", "Přidat nádobu") : "", open({ kind: "container", name: "", where: "", size: "" })));
        else {
          push(hero({ kicker: G.place.town + L(" \u00b7 containers", " \u00b7 nádoby"), big: G.containers.length + L(" containers", " nádoby"),
            sub: G.containerPlants.length + L(" plants growing. Care is a rhythm here, not a plan.", " rostliny. Péče je tu rytmus, ne plán.") }));
          var dueCare = care.filter(function (x) { return x.due; });
          push(label(L("Care today", "Péče dnes")));
          push(dueCare.length ? rows(dueCare.map(careRow)) : note(L("Nothing needs water today.", "Dnes nic nepotřebuje zalít.")));
          push(label(L("Containers", "Nádoby"), canC ? L("+ Container", "+ Nádoba") : "", open({ kind: "container", name: "", where: "", size: "" })));
          push(rows(G.containers.slice().sort(function (x, z) { return x.pos - z.pos; }).map(function (k) {
            var pl = G.containerPlants.filter(function (x) { return x.container === k.id; });
            return row({ title: k.name, sub: [k.where, k.size].concat(pl.map(function (x) { return cropW(x.crop) + (x.variety ? " \u2018" + G.varName(x.variety) + "\u2019" : ""); })).join(" \u00b7 "),
              right: pl.length ? String(pl.length) : "", rightSub: pl.length ? L("plants", "rostlin") : "", open: go("/garden/containers/" + k.id) });
          })));
          var later = care.filter(function (x) { return !x.due; });
          if (later.length) { push(label(L("Coming up", "Brzy"))); push(rows(later.map(careRow))); }
          push(note(L("No bed, no season, no rotation check — and nothing greyed out to suggest there could be.", "Žádný záhon, sezóna ani kontrola střídání — a nic zašedlého, co by naznačovalo, že by mohly být.")));
        }
      } else {
        var plot = tier === "plot";
        headTitle = plot ? L("Garden 2026", "Zahrada 2026") : L("Beds", "Záhony");
        headSub = G.climate.label;
        if (isEmpty) {
          push(plot ? empty(L("No season yet.", "Zatím žádná sezóna."), L("Start one from this year's frost dates; last year's plan can be copied into it later.", "Založte ji z letošních mrazových dat; loňský plán do ní jde zkopírovat později."), canM ? L("Start the 2026 season", "Založit sezónu 2026") : "", go("/garden/setup/1"))
            : empty(L("No beds yet.", "Zatím žádné záhony."), L("Name the first one and put it in the order it stands in — that order is how the checks know what is next to what.", "Pojmenujte první a zařaďte ho tam, kde stojí — podle pořadí kontroly vědí, co je vedle čeho."), canM ? L("Add a bed", "Přidat záhon") : "", open({ kind: "bed" })));
        } else {
          var left = G.diff(TD, G.climate.firstFrost);
          var stats = [stat(L("Growing now", "Roste teď"), String(ps26.filter(inNow).length), L("of " + ps26.length + " plantings in " + G.beds.length + " beds", "z " + ps26.length + " výsadeb ve " + G.beds.length + " záhonech")),
            stat(L("To do this week", "Tento týden"), String(thisWeek.length + overdue.length), overdue.length ? overdue.length + L(" overdue", " po termínu") : L("nothing overdue", "nic po termínu"), overdue.length ? "danger" : "")];
          if (shown.yields) stats.push(stat(L("Harvested", "Sklizeno"), kg(y26.actual), L("of " + kg(y26.expected) + " expected so far", "z očekávaných " + kg(y26.expected))));
          if (checkList.length) stats.push(stat(L("Plan check", "Kontrola plánu"), csum.warning ? csum.warning + L(" to look at", " k prohlédnutí") : L("clean", "v pořádku"), csum.findings + L(" findings, none blocking", " nálezů, nic neblokuje"), csum.warning ? "warn" : ""));
          push(hero({ kicker: (plot ? L("Season 2026 \u00b7 ", "Sezóna 2026 \u00b7 ") : "") + G.climate.label,
            big: left > 0 ? left + L(" days to the first frost", " dní do prvního mrazu") : L("Past the first frost", "Po prvním mrazu"),
            sub: L("Last frost was " + day(G.climate.lastFrost, false) + "; the first autumn frost is expected " + day(G.climate.firstFrost, false) + ", from the " + G.climate.source + ".",
              "Poslední mráz byl " + day(G.climate.lastFrost, false) + "; první podzimní se čeká " + day(G.climate.firstFrost, false) + "."),
            stats: stats }));
          if (frost.published) {
            push(note(L("Frost tonight, down to " + frost.min + " °C. " + frost.plants.length + " plantings in beds " + frost.beds.join(", ") + " are not hardy. Forecast measured at " + String(frost.measuredAt).slice(11, 16) + "; the greenhouse is covered and left out.",
              "Mrazík dnes v noci, až " + frost.min + " °C. " + frost.plants.length + " výsadeb v záhonech " + frost.beds.join(", ") + " není mrazuvzdorných. Předpověď z " + String(frost.measuredAt).slice(11, 16) + "; skleník je krytý."), "boxDanger"));
            push(rows(frost.plants.map(function (p) {
              return row({ title: p.label, sub: bedL(p.bed) + " \u00b7 " + hardW(p.hardiness) + " \u00b7 " + qtyW(p), badge: q.warning === "frost" ? L("tonight", "dnes") : "", badgeTone: "danger", open: go("/garden/plantings/" + p.id) });
            })));
          }
          var need = overdue.concat(thisWeek);
          push(label(L("To do this week", "Tento týden"), L("All tasks", "Všechny práce"), go("/garden/tasks")));
          push(need.length ? rows(need.slice(0, 8).map(function (t) { return taskRow(t); })) : note(L("Nothing due this week.", "Tento týden nic.")));
          if (need.length > 8) push(note(L((need.length - 8) + " more on the task list.", "Dalších " + (need.length - 8) + " na seznamu prací."), "", L("Open it", "Otevřít"), go("/garden/tasks")));
          if (ready.length) {
            push(label(L("Ready to pick", "K sklizni")));
            push(rows(ready.map(function (p) {
              var got = G.harvests.filter(function (h) { return h.planting === p.id; });
              return row({ title: p.label, sub: bedL(p.bed) + L(" \u00b7 window ", " \u00b7 okno ") + span(p.windows.harvest.from, p.windows.harvest.to) + (got.length ? L(" \u00b7 " + got.length + " picked", " \u00b7 sklizeno " + got.length + "\u00d7") : ""),
                act: canC ? L("Log harvest", "Zapsat sklizeň") : "", onAct: harvestAct(p), open: go("/garden/plantings/" + p.id) });
            })));
          }
          var dueCare2 = care.filter(function (x) { return x.due; });
          if (dueCare2.length) { push(label(L("Care", "Péče"))); push(rows(dueCare2.map(careRow))); }
          G.zones.forEach(function (z) {
            push(label(z.name + (z.covered ? L(" \u00b7 under glass", " \u00b7 pod sklem") : ""), canC && z.id === G.zones[0].id ? L("+ Planting", "+ Výsadba") : "", open(plantingDraft(null, null))));
            push(rows(G.bedsOfZone(z.id).map(function (bd) {
              var now = ps26.filter(function (p) { return p.bed === bd.num && inNow(p); });
              var next = ps26.filter(function (p) { return p.bed === bd.num && p.occupancy.from > TD; });
              var used = now.reduce(function (n, p) { return n + p.area; }, 0);
              return row({ lead: "B" + bd.num, title: now.length ? now.map(function (p) { return p.label; }).join(", ") : L("Nothing growing", "Nic neroste"), muted: !now.length,
                sub: [bd.area + "\u00a0m\u00b2", bd.sun === "part" ? L("part shade", "polostín") : bd.sun === "glass" ? L("glass", "sklo") : L("full sun", "slunce"),
                  next.length ? L("next: ", "potom: ") + next.map(function (p) { return p.label; }).join(", ") : ""].filter(Boolean).join(" \u00b7 "),
                right: now.length ? Math.round(used / bd.area * 100) + "\u00a0%" : "", rightSub: now.length ? L("in use", "využito") : "",
                tone: used > bd.area ? "warn" : "", open: go("/garden/beds/" + bd.num) });
            })));
          });
          if (!wide) {
            push(label(L("More in Garden", "Další v Zahradě")));
            push(rows(moreRows()));
          }
        }
      }
    }

    function moreRows() {
      var out = [];
      if (shown.tasks) out.push(row({ title: L("Tasks", "Práce"), sub: openT.length + L(" open, overdue first", " otevřených"), open: go("/garden/tasks") }));
      if (checkList.length) out.push(row({ title: shown.full_check ? L("Plan check", "Kontrola plánu") : L("Warnings", "Upozornění"), sub: csum.warning + L(" to look at", " k prohlédnutí"), open: go("/garden/season/2026/checks") }));
      if (shown.storage) out.push(row({ title: L("Storage", "Zásoby"), sub: G.storage.filter(function (x) { return x.remaining > 0; }).length + L(" in the cellar and freezer", " ve sklepě a mrazáku"), open: go("/garden/storage") }));
      if (shown.seasons) out.push(row({ title: L("Seasons", "Sezóny"), sub: L("2026 active \u00b7 plan 2027", "2026 běží \u00b7 plán 2027"), open: go("/garden/season") }));
      out.push(row({ title: L("Crop catalog", "Katalog plodin"), sub: G.crops.length + L(" crops, timed to your frost dates", " plodin podle vašich mrazů"), open: go("/garden/catalog") }));
      if (shown.tasks) out.push(row({ title: L("Print this month", "Vytisknout měsíc"), sub: L("One page with real boxes", "Jedna stránka se skutečnými políčky"), open: go("/garden/print/work?month=2026-09") }));
      out.push(row({ title: L("Garden settings", "Nastavení zahrady"), sub: tierName[tier] + " \u00b7 " + G.climate.label, open: go("/garden/settings") }));
      return out;
    }

    if (page === "beds") {
      headTitle = L("Beds", "Záhony");
      G.zones.forEach(function (z) {
        push(label(z.name));
        push(rows(G.bedsOfZone(z.id).map(function (bd) {
          return row({ lead: "B" + bd.num, title: bedL(bd.num), sub: bd.area + "\u00a0m\u00b2" + (bd.soil ? " \u00b7 " + bd.soil : ""), open: go("/garden/beds/" + bd.num) });
        })));
      });
    }

    if (page === "bed") {
      var bd = G.bed(id), z = zoneOfBed(id), mine = ps26.filter(function (p) { return p.bed === id; });
      var nb = G.neighbours(id);
      headTitle = bedL(id); headSub = z ? z.name : "";
      push(hero({ kicker: (z ? z.name : "") + " \u00b7 " + L("position ", "pozice ") + bd.pos, big: bedL(id), sub: bd.soil || "",
        stats: [stat(L("Area", "Plocha"), bd.area + "\u00a0m\u00b2"), stat(L("Light", "Světlo"), bd.sun === "part" ? L("part shade", "polostín") : bd.sun === "glass" ? L("under glass", "pod sklem") : L("full sun", "plné slunce")),
          stat(L("Next to", "Sousedí s"), nb.length ? nb.map(function (x) { return "B" + x.num; }).join(", ") : L("nothing", "nic"), L("the order in the zone is the adjacency", "sousedství je pořadí v zóně"))] }));
      var bfind = checkList.reduce(function (acc, ck) { return acc.concat(ck.findings.filter(function (f) { return f.entity === "B" + id; }).map(function (f) { return { key: ck.key, says: f.says }; })); }, []);
      bfind.forEach(function (f) { push(note(f.key + " \u00b7 " + f.says + ".", "boxWarn", L("Plan check", "Kontrola plánu"), go("/garden/season/2026/checks"))); });
      push(label(L("2026", "2026"), canC ? L("+ Planting", "+ Výsadba") : "", open(plantingDraft(null, id))));
      push(mine.length ? rows(mine.sort(function (x, y) { return (x.occupancy.from || "") < (y.occupancy.from || "") ? -1 : 1; }).map(function (p) { return plantingRow(p, { strong: true }); }))
        : empty(L("Nothing planted in this bed yet.", "V tomto záhonu zatím nic není."), L("Pick a crop and the dates fill themselves in from your frost dates.", "Vyberte plodinu a data se doplní podle vašich mrazů."), canC ? L("Add a planting", "Přidat výsadbu") : "", open(plantingDraft(null, id))));
      if (shown.rotation) {
        push(label(L("What grew here before", "Co tu rostlo dřív")));
        var hist = G.closedSeasons().slice().reverse().map(function (se) {
          var hp = G.plantingsOf(se.year).filter(function (p) { return p.bed === id; });
          return row({ lead: String(se.year).slice(2), title: hp.length ? hp.map(function (p) { return p.label; }).join(", ") : L("Nothing recorded", "Nic nezapsáno"), muted: !hp.length,
            sub: hp.map(function (p) { return p.family + " \u00b7 " + p.feeder; }).join(" \u00b7 ") });
        });
        push(rows(hist));
        push(note(L("Only closed seasons count as rotation history.", "Jako historie střídání se počítají jen uzavřené sezóny.")));
      }
    }

    if (page === "planting") {
      var p = cur, crop = G.byCrop[p.crop], z2 = zoneOfBed(p.bed);
      headTitle = p.label; headSub = bedL(p.bed);
      var exp = safe(function () { return G.pick(p.crop, p.variety, "yieldM2", { by: "yields" }).value * p.area; }, 0);
      var got = G.harvests.filter(function (h) { return h.planting === p.id; });
      var gotKg = got.reduce(function (n, h) { return n + h.qty; }, 0);
      push(hero({ kicker: bedL(p.bed) + (z2 ? " \u00b7 " + z2.name : "") + " \u00b7 " + p.season, big: p.label, sub: p.note || "",
        stats: [stat(L("How much", "Kolik"), qtyW(p), p.plants != null ? L("\u2248 " + p.area + " m\u00b2 at the catalog spacing", "\u2248 " + p.area + " m\u00b2 podle sponu") : ""),
          stat(L("Family", "Čeleď"), crop.family, crop.feeder + L(" feeder", "")), stat(L("Expected", "Očekáváno"), exp ? kg(exp) : "\u2013", gotKg ? kg(gotKg) + L(" picked", " sklizeno") : ""), stat(L("Hardiness", "Odolnost"), hardW(p.hardiness), p.covered ? L("under glass", "pod sklem") : "", p.hardiness === "tender" && !p.covered && frost.published && frost.plants.some(function (x) { return x.id === p.id; }) ? "danger" : "")] }));
      if (frost.published && frost.plants.some(function (x) { return x.id === p.id; })) push(note(L("On tonight's frost list: " + frost.min + " °C forecast, and this planting is " + hardW(p.hardiness) + ".", "Na dnešním seznamu mrazu: předpověď " + frost.min + " °C."), "boxDanger"));
      var drifted = G.dateKinds.filter(function (k) { return p.actual[k] && p.planned[k] && p.actual[k] !== p.planned[k] && k !== "harvest"; });
      drifted.forEach(function (k) {
        var dd = G.diff(p.planned[k], p.actual[k]);
        push(note(L(kindW(k) + " happened " + Math.abs(dd) + " days " + (dd > 0 ? "after" : "before") + " the plan. The plan has not moved.", kindW(k) + ": " + Math.abs(dd) + " dní " + (dd > 0 ? "po plánu" : "před plánem") + ". Plán se nepohnul."),
          "box", L("See the difference", "Rozdíl"), open({ kind: "drift", pid: p.id, k: k })));
      });
      push(label(L("Dates", "Termíny")));
      push(rows(G.dateKinds.filter(function (k) { return p.planned[k]; }).map(function (k) {
        var w = p.windows[k], act = p.actual[k];
        return row({ title: kindW(w ? w.kind : k), sub: w ? L("window ", "okno ") + span(w.from, w.to) + " \u00b7 " + fromW(w.source) : "",
          badge: p.manual[k] ? L("set by hand", "ručně") : "", right: act ? day(act, false) : day(p.planned[k], false),
          rightSub: act ? L("actual \u00b7 planned ", "skutečně \u00b7 plán ") + day(p.planned[k], false) : L("planned", "plán"), tone: act ? "accent" : "",
          act: canC && !act && p.planned[k] <= G.addDays(TD, 14) && p.planned[k] >= G.addDays(TD, -30) ? L("It happened", "Proběhlo") : "", onAct: open({ kind: "actual", pid: p.id, k: k, on: p.planned[k] < TD ? p.planned[k] : TD }) });
      })));
      if (shown.yields || shown.harvests) {
        push(label(L("Harvests", "Sklizně"), canC ? L("+ Log harvest", "+ Zapsat") : "", harvestAct(p) || function () {}));
        if (exp) push(bars([{ name: L("Picked so far", "Zatím sklizeno"), right: kg(gotKg) + " / " + kg(exp), v: gotKg, target: exp,
          left: got.length ? got.length + L(" pickings", " sklizní") : L("Nothing logged yet", "Zatím nic"), proj: exp ? Math.round(gotKg / exp * 100) + L(" % of expected", " % očekávaného") : "" }]));
        push(got.length ? rows(got.slice().sort(function (x, y) { return x.on < y.on ? 1 : -1; }).map(function (h) {
          return row({ title: day(h.on) + " \u00b7 " + h.dest, sub: name(h.by) + (h.note ? " \u00b7 " + h.note : ""), right: kg(h.qty),
            act: canC && h.session ? L("Remove", "Odebrat") : "", onAct: function () { var ix = G.harvests.indexOf(h); commit(function () { G.harvests.splice(ix, 1); }, function () { G.harvests.splice(ix, 0, h); }, L("Harvest removed", "Sklizeň odebrána")); } });
        })) : note(L("Nothing picked yet.", "Zatím nic sklizeno.")));
      }
      var ptasks = allT.filter(function (t) { return t.planting === p.id; });
      if (ptasks.length) { push(label(L("Tasks from this planting", "Práce z této výsadby"))); push(rows(ptasks.map(function (t) { return taskRow(t); }))); }
      push(acts([canC ? btn(L("Edit", "Upravit"), "", open(plantingDraft(p))) : null, canC ? btn(L("Delete", "Smazat"), "danger-ghost", open({ kind: "delPlanting", pid: p.id })) : null,
        btn(bedL(p.bed), "", go("/garden/beds/" + p.bed)), btn(L("In the catalog", "V katalogu"), "", go("/garden/catalog/" + p.crop))]));
    }

    if (page === "container") {
      var k = cur, kp = G.containerPlants.filter(function (x) { return x.container === k.id; });
      headTitle = k.name; headSub = k.where;
      push(hero({ kicker: k.where + " \u00b7 " + k.size, big: k.name, sub: k.photo ? L("Photo journal on", "Fotodeník zapnutý") : "" }));
      push(label(L("Growing in it", "Roste v ní")));
      push(kp.length ? rows(kp.map(function (x) {
        return row({ title: cropW(x.crop) + (x.variety ? " \u2018" + G.varName(x.variety) + "\u2019" : ""), sub: L("planted ", "zasazeno ") + day(x.planted, false) + (x.photos ? " \u00b7 " + x.photos + L(" photos", " fotek") : ""), open: go("/garden/catalog/" + x.crop) });
      })) : note(L("Empty for now.", "Zatím prázdná.")));
      push(rows([row({ title: L("Photo journal", "Fotodeník"), sub: k.photo ? kp.reduce(function (n, x) { return n + (x.photos || 0); }, 0) + L(" photos", " fotek") : L("Off", "Vypnutý"), open: go("/garden/containers/" + k.id + "/journal") })]));
      var kc = care.filter(function (x) { return x.target === k.id; });
      if (kc.length) { push(label(L("Care", "Péče"))); push(rows(kc.map(careRow))); }
    }

    if (page === "tasks") {
      headTitle = L("Garden tasks", "Práce na zahradě"); headSub = openT.length + L(" open", " otevřených");
      push(acts([canC ? btn(L("+ Task of your own", "+ Vlastní práce"), "primary", open({ kind: "newtask", title: "", date: G.addDays(TD, 3), bed: null, err: "" })) : null,
        btn(L("Print this month", "Vytisknout měsíc"), "", go("/garden/print/work?month=2026-09"))]));
      if (!openT.length) push(empty(L("Nothing to do this month.", "Tento měsíc nic."), L("That is a real answer in January. The list fills itself from the plantings.", "V lednu je to skutečná odpověď. Seznam se plní z výsadeb."), canC ? L("Add a task of your own", "Přidat vlastní práci") : "", open({ kind: "newtask", title: "", date: G.addDays(TD, 3), bed: null, err: "" })));
      if (overdue.length) { push(label(L("Overdue", "Po termínu"))); push(rows(overdue.map(function (t) { return taskRow(t); }))); }
      var wkMap = {};
      openT.filter(function (t) { return t.due >= TD; }).forEach(function (t) { (wkMap[t.week] = wkMap[t.week] || []).push(t); });
      Object.keys(wkMap).sort().slice(0, 8).forEach(function (w) {
        var mon = G.addDays(wkMap[w][0].due, -((new Date(wkMap[w][0].due + "T00:00:00Z").getUTCDay() + 6) % 7));
        push(label((w === wk ? L("This week \u00b7 ", "Tento týden \u00b7 ") : L("Week of ", "Týden od ")) + day(mon, false)));
        push(rows(wkMap[w].map(function (t) { return taskRow(t); })));
      });
      var doneRecent = allT.filter(function (t) { return t.status === "done" && t.doneOn && t.doneOn >= G.addDays(TD, -14); })
        .concat(allT.filter(function (t) { return t.status === "skipped"; }));
      if (doneRecent.length) {
        push(label(L("Done or skipped lately", "Nedávno hotovo nebo přeskočeno"), s.gaShowDone ? L("Hide", "Skrýt") : L("Show " + doneRecent.length, "Zobrazit " + doneRecent.length), function () { self.setState({ gaShowDone: !s.gaShowDone }); }));
        if (s.gaShowDone) push(rows(doneRecent.map(function (t) { return taskRow(t); })));
      }
      var stones = safe(function () { return G.tombstones(); }, []);
      if (stones.length) {
        push(label(L("Deleted, and not coming back", "Smazané a nevrátí se")));
        push(rows(stones.map(function (t) {
          return row({ title: kindW(t.kind) + " \u00b7 " + cropW(G.planting(t.planting) ? G.planting(t.planting).crop : "") + " \u00b7 " + bedL(G.planting(t.planting) ? G.planting(t.planting).bed : ""),
            sub: "\u201c" + t.why + "\u201d \u00b7 " + name(t.by) + " \u00b7 " + day(t.on, false), muted: true,
            act: canC ? L("Bring back", "Obnovit") : "", onAct: function () {
              var prev = G.taskState[t.generation_key];
              commit(function () { delete G.taskState[t.generation_key]; }, function () { G.taskState[t.generation_key] = prev; }, L("It will be generated again", "Bude se zase generovat"));
            } });
        })));
      }
      push(note(L("Watering and weeding are never generated — they're care reminders on a cadence instead. Moving a task by hand stops the generator from moving it again.",
        "Zalévání a pletí se nikdy negenerují — jsou to připomínky péče. Ručně posunutou práci už generátor neposune.")));
    }

    if (page === "checks") {
      var full = !!shown.full_check;
      headTitle = full ? L("Plan check", "Kontrola plánu") : L("Warnings", "Upozornění"); headSub = String(id);
      push(hero({ kicker: L("Season ", "Sezóna ") + id + " \u00b7 " + csum.total + L(" checks", " kontrol"), big: csum.warning ? csum.warning + L(" to look at", " k prohlédnutí") : L("Nothing to look at", "Nic k prohlédnutí"),
        tone: csum.warning ? "warn" : "", sub: L("Advisory, always — nothing here blocks a save.", "Vždy jen rada — nic tu neblokuje uložení."),
        stats: [stat(L("Clean", "V pořádku"), String(csum.pass)), stat(L("Dismissed", "Umlčeno"), String(csum.dismissed)), stat(L("Off or no history", "Vypnuto / bez historie"), String(csum.noHistory + csum.disabled))] }));
      var stW = { warning: [L("warning", "upozornění"), "warn"], pass: [L("clean", "v pořádku"), "accent"], dismissed: [L("dismissed", "umlčeno"), ""], disabled: [L("off", "vypnuto"), ""],
        no_history: [L("no history", "bez historie"), ""], not_at_this_tier: [L("not at this tier", "na této úrovni ne"), ""] };
      checkList.filter(function (ck) { return ck.state === "warning"; }).forEach(function (ck) {
        push(label(ck.key + " \u00b7 " + ck.title));
        push(rows(ck.findings.map(function (f) {
          var bn = /^B(\d+)$/.exec(f.entity);
          return row({ title: f.says, sub: ck.severity === "warning" ? L("warning", "upozornění") : L("info", "info"), subTone: ck.severity === "warning" ? "warn" : "",
            act: canC ? L("Dismiss", "Umlčet") : "", onAct: open({ kind: "dismiss", check: ck.key, entity: f.entity, says: f.says, note: "" }),
            open: bn ? go("/garden/beds/" + bn[1]) : null });
        })));
      });
      var dis = checkList.filter(function (ck) { return ck.dismissed.length; });
      if (dis.length) {
        push(label(L("Dismissed for this season", "Umlčeno pro tuto sezónu")));
        push(rows(dis.reduce(function (acc, ck) {
          return acc.concat(ck.dismissed.map(function (f) {
            var d = G.dismissals.filter(function (x) { return x.check === ck.key && x.entity === f.entity && x.season === id; })[0];
            return row({ title: ck.key + " \u00b7 " + f.says, muted: true, sub: d ? "\u201c" + d.note + "\u201d \u00b7 " + name(d.by) + " \u00b7 " + day(d.on, false) : "",
              act: canC && d ? L("Restore", "Obnovit") : "", onAct: function () { var ix = G.dismissals.indexOf(d); commit(function () { G.dismissals.splice(ix, 1); }, function () { G.dismissals.splice(ix, 0, d); }, L("Warning restored", "Upozornění obnoveno")); } });
          }));
        }, [])));
      }
      push(label(L("All checks", "Všechny kontroly")));
      push(rows(checkList.map(function (ck) {
        var w = stW[ck.state] || [ck.state, ""], cfg = G.checkConfig[ck.key];
        return row({ lead: ck.key, title: ck.title, sub: ck.state === "disabled" && cfg ? L("Off: ", "Vypnuto: ") + "\u201c" + cfg.why + "\u201d \u00b7 " + name(cfg.by) : ck.state === "no_history" ? L("Rotation can't be checked yet — no closed season behind it.", "Střídání zatím nejde zkontrolovat — chybí uzavřená sezóna.") : ck.detail,
          badge: w[0], badgeTone: w[1], muted: ck.state === "not_at_this_tier",
          act: canM && ck.state !== "not_at_this_tier" ? (ck.state === "disabled" ? L("Turn on", "Zapnout") : L("Turn off", "Vypnout")) : "",
          onAct: ck.state === "disabled" ? function () { var old = G.checkConfig[ck.key]; commit(function () { delete G.checkConfig[ck.key]; }, function () { G.checkConfig[ck.key] = old; }, ck.key + L(" is on again", " je znovu zapnutá")); }
            : open({ kind: "disable", check: ck.key, why: "" }) });
      })));
      push(note(L("C3 and C8 return no history rather than a pass, because a silent check reads like a clean plan.", "C3 a C8 bez historie nevrací „v pořádku“ — mlčící kontrola by vypadala jako čistý plán.")));
    }

    if (page === "seasons") {
      headTitle = L("Seasons", "Sezóny");
      push(rows(G.seasons.slice().reverse().map(function (se) {
        var n = G.plantingsOf(se.year).length;
        var st = se.status === "closed" ? L("closed ", "uzavřena ") + day(se.closedOn, false) : se.status === "active" ? L("active", "běží") : se.status === "planned" ? L("planned", "naplánována") : L("not created", "nezaložena");
        return row({ lead: String(se.year).slice(2), title: String(se.year), sub: (n ? n + L(" plantings \u00b7 ", " výsadeb \u00b7 ") : "") + L("frost ", "mrazy ") + day(se.lastFrost, false) + " \u2192 " + day(se.firstFrost, false),
          badge: st, badgeTone: se.status === "active" ? "accent" : "",
          act: se.status === "not created" && canM ? L("Plan it", "Naplánovat") : se.status === "active" && canM ? L("Close", "Uzavřít") : "",
          onAct: se.status === "not created" ? go("/garden/season/new?copy=2026") : go("/garden/season/" + se.year + "/close"),
          open: se.status === "closed" ? go("/garden/season/" + se.year + "/close") : se.status === "active" ? go("/garden/season/" + se.year + "/checks") : null });
      })));
      push(note(L("Closing a season is what turns it into rotation history. Reopening one needs manage and is audited.", "Uzavřením se sezóna stává historií střídání. Znovuotevření vyžaduje správu a zapisuje se.")));
      push(acts([btn(L("Print the season plan", "Vytisknout plán sezóny"), "", go("/garden/print/season?year=2026"))]));
    }

    if (page === "dryrun") {
      var shift = s.gaShift == null ? 1 : s.gaShift, S27 = G.season(2027);
      var cmp = safe(function () { return G.dryRunCompare(); }, null);
      headTitle = L("Copy 2026 into 2027", "Zkopírovat 2026 do 2027");
      if (S27.status !== "not created") {
        push(empty(L("2027 is already planned", "2027 už je naplánována"), L(G.plantingsOf(2027).length + " plantings were copied in. One year, one season.", "Zkopírováno " + G.plantingsOf(2027).length + " výsadeb. Jeden rok, jedna sezóna."), L("Seasons", "Sezóny"), go("/garden/season")));
      } else if (cmp) {
        var run = shift ? cmp.shifted : cmp.straight;
        push(steps([L("Copy", "Kopie"), L("Check", "Kontrola"), L("Create", "Založit")], 1));
        push(chips(L("How to copy", "Jak kopírovat"), [chip(L("Every bed as it was", "Každý záhon stejně"), !shift, function () { self.setState({ gaShift: 0 }); }),
          chip(L("Move every planting one bed along", "Posunout vše o záhon dál"), !!shift, function () { self.setState({ gaShift: 1 }); })],
          L("Dates re-anchor to 2027's frost dates. Hand-set dates and actuals are dropped.", "Data se přepočtou na mrazy 2027. Ruční data a skutečnosti se nekopírují.")));
        push(hero({ kicker: L("Dry run \u00b7 nothing saved yet", "Zkouška nanečisto \u00b7 nic se neuložilo"), big: run.summary.findings + L(" findings", " nálezů"), tone: run.summary.findings ? "warn" : "",
          stats: [stat(L("Plantings", "Výsadby"), String(run.plantings.length)), stat(L("Fixed by the move", "Opraveno posunem"), String(cmp.fixed.length), "", "accent"), stat(L("Broken by the move", "Rozbito posunem"), String(cmp.broke.length), "", cmp.broke.length ? "danger" : "")] }));
        if (shift && cmp.fixed.length) { push(label(L("Fixed by moving one bed along", "Posun opraví"))); push(rows(cmp.fixed.map(function (x) { return row({ title: x, subTone: "accent" }); }))); }
        if (shift && cmp.broke.length) { push(label(L("Broken by moving one bed along", "Posun rozbije"))); push(rows(cmp.broke.map(function (x) { return row({ title: x }); }))); }
        var found = run.check.reduce(function (acc, ck) { return acc.concat(ck.findings.map(function (f) { return ck.key + " " + f.says; })); }, []);
        if (!shift && found.length) { push(label(L("What the plan check finds", "Co kontrola najde"))); push(rows(found.map(function (x) { return row({ title: x }); }))); }
        push(label(L("The 2027 plan", "Plán 2027")));
        push(rows(run.plantings.slice().sort(function (x, y) { return x.bed - y.bed; }).map(function (pp) {
          return row({ lead: "B" + pp.bed, title: pp.label, sub: qtyW(pp) + (pp.occupancy.from ? " \u00b7 " + span(pp.occupancy.from, pp.occupancy.to) : "") });
        })));
        if (canM) foot = [btn(L("Cancel", "Zrušit"), "", go("/garden/season")), btn(L("Create 2027 from this", "Založit 2027"), "primary", function () {
          var added = [];
          commit(function () {
            run.plantings.forEach(function (pp, i) { added.push(G.addPlanting(["p27-" + String(i + 1).padStart(2, "0"), 2027, pp.bed, pp.crop, pp.variety, Object.assign({}, pp.qty), {}]).id); });
            S27.status = "planned";
          }, function () { added.forEach(function (x) { G.removePlanting(x); }); S27.status = "not created"; },
          L("2027 created with " + run.plantings.length + " plantings", "Sezóna 2027 založena, " + run.plantings.length + " výsadeb"), { route: "/garden/season" });
        })];
      }
    }

    if (page === "close") {
      var se2 = G.season(id), cl = safe(function () { return G.seasonClose(id); }, null), open2 = se2.status === "active";
      headTitle = open2 ? L("Close ", "Uzavřít ") + id : L("Season ", "Sezóna ") + id;
      if (cl) {
        var yr = cl.yields;
        push(hero({ kicker: open2 ? L("Still running \u00b7 closing makes it history", "Stále běží \u00b7 uzavřením se stane historií") : L("Closed ", "Uzavřena ") + day(se2.closedOn) + " \u00b7 " + name(se2.closedBy),
          big: kg(yr.actual) + L(" picked", " sklizeno"), sub: L("against " + kg(yr.expected) + " expected over " + yr.logged + " plantings with harvests.", "proti očekávaným " + kg(yr.expected) + " u " + yr.logged + " výsadeb se sklizní.") }));
        push(label(L("Frost dates", "Mrazy")));
        push(kv([[L("Last frost expected", "Poslední mráz očekáván"), day(cl.observed.expectedLast)], [L("Last frost seen", "Poslední mráz skutečně"), cl.observed.last ? day(cl.observed.last) + (cl.observed.lastDelta ? " (" + (cl.observed.lastDelta > 0 ? "+" : "") + cl.observed.lastDelta + L(" days", " dní") + ")" : "") : "\u2013"],
          [L("First frost expected", "První mráz očekáván"), day(cl.observed.expectedFirst)], [L("First frost seen", "První mráz skutečně"), cl.observed.first ? day(cl.observed.first) + " (" + (cl.observed.firstDelta > 0 ? "+" : "") + cl.observed.firstDelta + L(" days", " dní") + ")" : "\u2013"]]));
        if (open2 && canM) {
          var dft = s.gaClose || { first: "" };
          push(field({ label: L("First autumn frost, as it happened", "První podzimní mráz, jak skutečně přišel"), type: "date", value: dft.first, narrow: true, set: function (v) { self.setState({ gaClose: { first: v } }); },
            hint: L("Leave empty if it hasn't come yet; it can be added later.", "Nechte prázdné, pokud ještě nepřišel.") }));
        }
        var yrows = yr.rows.filter(function (r) { return r.rows > 0 || r.failed; });
        if (yrows.length) {
          push(label(L("Yields against expected", "Výnosy proti očekávání")));
          push(bars(yrows.map(function (r) {
            return { name: r.planting.label + " \u00b7 B" + r.planting.bed, right: kg(r.actual) + " / " + kg(r.expected), v: r.actual, target: r.expected,
              left: r.failed ? L("Failed: ", "Nezdar: ") + r.failed.why : r.rows + L(" pickings", " sklizní"), proj: r.ratio != null ? r.ratio + " %" : "", projTone: r.failed ? "danger" : "",
              ink: r.failed ? "var(--danger)" : "var(--accent)", open: go("/garden/plantings/" + r.planting.id) };
          })));
        }
        var fails = cl.failures.filter(function (f) { return f.planting && f.planting.season === id; });
        if (fails.length) { push(label(L("Failures, by name", "Nezdary jménem"))); push(rows(fails.map(function (f) { return row({ title: f.planting.label, sub: f.why + " \u00b7 " + name(f.by) }); }))); }
        var ce = safe(function () { return G.closeEffect(); }, null);
        if (open2 && ce) push(note(L("Closing 2026 takes the 2027 plan check from " + (ce.c3[0] + ce.c8[0]) + " to " + (ce.c3[1] + ce.c8[1]) + " rotation and feeder findings — that is the whole of what closing does.",
          "Uzavření 2026 změní nálezy střídání a výživy pro 2027 z " + (ce.c3[0] + ce.c8[0]) + " na " + (ce.c3[1] + ce.c8[1]) + "."), "box"));
        if (open2 && canM) foot = [btn(L("Cancel", "Zrušit"), "", go("/garden/season")), btn(L("Close " + id, "Uzavřít " + id), "primary", function () {
          var old = { status: se2.status, closedOn: se2.closedOn, closedBy: se2.closedBy, observedFirst: se2.observedFirst };
          var first = (s.gaClose || {}).first || null;
          commit(function () { Object.assign(se2, { status: "closed", closedOn: TD, closedBy: me, observedFirst: first || se2.observedFirst }); },
            function () { Object.assign(se2, old); }, id + L(" closed \u00b7 it now counts as rotation history", " uzavřena \u00b7 počítá se do historie střídání"), { route: "/garden/season", gaClose: null });
        })];
        if (!open2 && canM && se2.year === Math.max.apply(null, G.closedSeasons().map(function (x) { return x.year; })) && !G.seasons.some(function (x) { return x.status === "active"; }))
          push(acts([btn(L("Reopen", "Znovu otevřít"), "danger-ghost", function () { var old = se2.status; commit(function () { se2.status = "active"; }, function () { se2.status = old; }, L("Reopened \u00b7 audited", "Znovu otevřeno \u00b7 zapsáno")); })]));
      }
    }

    if (page === "storage") {
      headTitle = L("Storage", "Zásoby");
      var live = G.storage.filter(function (x) { return x.status !== "finished" && !(x.initial > 0 && x.remaining === 0); });
      var gone = G.storage.filter(function (x) { return live.indexOf(x) < 0; });
      push(acts([canC ? btn(L("+ Put something away", "+ Uložit"), "primary", open({ kind: "store", product: "", amount: "", unit: "kg", where: "", method: "", err: "" })) : null]));
      push(rows(live.map(function (x) {
        var low = x.initial > 0 && x.remaining / x.initial <= 0.25, past = x.best && x.best < TD;
        return row({ title: x.product, sub: [x.where, x.method, x.from && G.planting(x.from) ? L("from ", "z ") + G.planting(x.from).where : "", x.best ? L("best before ", "spotřebovat do ") + day(x.best, false) : "", x.pending || ""].filter(Boolean).join(" \u00b7 "),
          subTone: past ? "danger" : "", right: x.pending ? "\u2013" : x.remaining + " / " + x.initial + "\u00a0" + x.unit,
          badge: x.pending ? L("waiting", "čeká") : past ? L("past best-before", "po datu") : low ? L("low", "dochází") : "", badgeTone: past ? "danger" : low ? "warn" : "",
          act: canC && !x.pending && x.remaining > 0 ? L("Use some", "Ubrat") : "", onAct: open({ kind: "use", sid: x.id, amount: "1", err: "" }),
          open: x.from && G.planting(x.from) ? go("/garden/plantings/" + x.from) : null });
      })));
      if (gone.length) { push(label(L("Finished", "Spotřebováno"))); push(rows(gone.map(function (x) {
        var last = x.edits[x.edits.length - 1];
        return row({ title: x.product, muted: true, sub: last ? L("last used ", "naposledy ") + day(last[0]) : "", right: "0 / " + x.initial + "\u00a0" + x.unit });
      }))); }
      push(note(L("Using some is an edit in place. \u201cWhen did we eat the last jar\u201d is answered by the edit history, not a second ledger.", "Ubrání je úprava na místě. „Kdy jsme snědli poslední sklenici“ odpoví historie úprav.")));
    }

    if (page === "catalog") {
      headTitle = L("Crop catalog", "Katalog plodin"); headSub = L("v", "v") + G.catalog.version + " \u00b7 " + G.crops.length + L(" crops", " plodin");
      var qq = String(s.gaQ || "").trim().toLowerCase();
      push(field({ label: L("Search", "Hledat"), value: s.gaQ || "", placeholder: L("Czech, English or Latin", "česky, anglicky nebo latinsky"), set: function (v) { self.setState({ gaQ: v }); } }));
      var hits = G.crops.filter(function (x) { return !qq || [x.cs, x.en, x.latin, x.family].join(" ").toLowerCase().indexOf(qq) >= 0; });
      if (!hits.length) push(empty(L("Nothing matches that.", "Nic tomu neodpovídá."), L("Try the Czech or the Latin name — both are indexed.", "Zkuste český nebo latinský název."), L("Clear the search", "Vymazat"), function () { self.setState({ gaQ: "" }); }));
      else push(rows(hits.map(function (x) {
        var k1 = Object.keys(x.windows)[0], w = safe(function () { return G.resolveWindow(x.id, null, k1, G.climate, { by: "catalog" }); }, null);
        return row({ title: x.cs + " \u00b7 " + x.en, sub: x.latin + " \u00b7 " + x.family + " \u00b7 " + hardW(x.hardiness), right: w ? day(w.from, false) : "", rightSub: w ? kindW(k1).toLowerCase() : "",
          badge: G.overrides.some(function (o) { return o.crop === x.id; }) ? L("overridden", "upraveno") : "", open: go("/garden/catalog/" + x.id) });
      })));
      push(acts([btn(L("Your overrides", "Vaše úpravy"), "", go("/garden/catalog/overrides")),
        canC ? btn(L("Suggest a missing crop", "Navrhnout chybějící plodinu"), "", open({ kind: "suggest", crop: null, name: qq ? s.gaQ : "", latin: "", why: "", err: "" })) : null]));
      var sgAll = G.suggestions.filter(function (x) { return x.by === me || canM; });
      if (sgAll.length) { push(label(L("Suggestions to the catalog", "Návrhy do katalogu"))); push(rows(sgAll.map(sugRow))); }
      push(note(L("The catalog ships with the app and works offline at the bottom of the garden. Version " + G.catalog.next.version + " arrives " + day(G.catalog.next.on) + "; your overrides survive it.",
        "Katalog je součástí aplikace a funguje i bez signálu. Verze " + G.catalog.next.version + " přijde " + day(G.catalog.next.on) + "; vaše úpravy zůstanou.")));
    }

    if (page === "crop") {
      var cr = cur;
      headTitle = cr.cs; headSub = cr.en;
      push(hero({ kicker: cr.family + " \u00b7 " + hardW(cr.hardiness) + " \u00b7 " + cr.feeder + L(" feeder", ""), big: cr.cs, sub: cr.en + " \u00b7 " + cr.latin }));
      push(label(L("Timings for ", "Termíny pro ") + G.climate.label));
      push(rows(Object.keys(cr.windows).map(function (wk2) {
        var w = safe(function () { return G.resolveWindow(cr.id, null, wk2, G.climate, { by: "catalog" }); }, null);
        if (!w) return null;
        var off = w.offset.map(function (n) { return (n > 0 ? "+" : n < 0 ? "\u2212" : "") + Math.abs(n); }).join(L(" to ", " až "));
        return row({ title: kindW(wk2), sub: (w.anchor === "LF" ? L("last frost ", "poslední mráz ") : L("first frost ", "první mráz ")) + off + L(" days \u00b7 ", " dní \u00b7 ") + fromW(w.source), right: span(w.from, w.to) });
      })));
      push(label(L("Growing", "Pěstování"), canM ? L("Override a field", "Upravit hodnotu") : "", open({ kind: "override", crop: cr.id, field: "spacing", value: "", why: "", err: "" })));
      var fv = function (f, unit) { var pk = G.pick(cr.id, null, f, { by: "catalog" }); return pk.value == null ? "" : pk.value + (unit || "") + " \u00b7 " + (pk.from === "override" ? L("your override (catalog " + pk.catalog + ")", "vaše úprava (katalog " + pk.catalog + ")") : srcW(G.fieldSrc[f])); };
      push(kv([[L("Spacing", "Spon"), fv("spacing", " cm")], [L("Plants per m\u00b2", "Rostlin na m\u00b2"), fv("perM2")], [L("Days to maturity", "Dní do sklizně"), fv("dtm")],
        [L("Yield", "Výnos"), fv("yieldM2", " kg/m\u00b2")], [L("Rotation break", "Odstup střídání"), fv("breakYears", L(" years", " roky"))], [L("Stores as", "Uchování"), cr.storage.join(", ")], [L("Watch for", "Pozor na"), cr.pests.join(", ")]]));
      var rel = G.rules.filter(function (r) { return r.scope !== "succession" && (r.a === cr.id || r.b === cr.id || r.a === cr.family || r.b === cr.family); });
      if (rel.length) {
        push(label(L("Next to what", "Vedle čeho")));
        push(rows(rel.map(function (r) {
          var other = r.a === cr.id || r.a === cr.family ? r.b : r.a, cls = G.sources[r.src] ? G.sources[r.src].cls : "agronomy";
          return row({ title: (G.byCrop[other] ? G.byCrop[other].cs : other) + (r.scope === "family" ? L(" (family)", " (čeleď)") : ""), sub: r.why, muted: cls === "folklore",
            badge: r.verdict === "antagonist" ? L("keep apart", "odděleně") : L("companion", "společně"), badgeTone: r.verdict === "antagonist" ? "danger" : "accent",
            right: clsW(cls), rightSub: srcW(r.src) });
        })));
        push(note(L("Folklore is drawn quieter than agronomy on purpose. A companion claim should not look like a spacing table.", "Lidová tradice je záměrně tišší než agronomie.")));
      }
      var sgC = G.suggestions.filter(function (x) { return x.crop === cr.id; });
      push(label(L("Wrong for everyone?", "Chyba v katalogu?"), canC ? L("Suggest a correction", "Navrhnout opravu") : "", open({ kind: "suggest", crop: cr.id, field: "dtm", value: "", why: "", err: "" })));
      if (sgC.length) push(rows(sgC.map(sugRow)));
      push(note(L("An override changes this garden only. A suggestion goes to the people who keep the catalog, is checked against a source before any household sees it, and you are told the answer.", "Úprava mění jen tuto zahradu. Návrh jde správcům katalogu, ověří se podle zdroje a dozvíte se výsledek.")));
      var vars = G.varieties.filter(function (v) { return v.crop === cr.id; });
      if (vars.length) {
        push(label(L("Varieties", "Odrůdy")));
        push(rows(vars.map(function (v) {
          var diffs = ["dtm", "yieldM2", "spacing"].filter(function (f) { return v[f] != null; }).map(function (f) { return f + " " + v[f]; }).concat(v.windows ? Object.keys(v.windows).map(kindW) : []);
          return row({ title: v.name, sub: (diffs.length ? L("differs: ", "liší se: ") + diffs.join(", ") : L("inherits everything", "vše zdědí")) + (v.note ? " \u00b7 " + v.note : ""), badge: v.own ? L("yours", "vaše") : "", badgeTone: "accent" });
        })));
      }
    }

    if (page === "overrides") {
      headTitle = L("Your catalog changes", "Vaše úpravy katalogu");
      var orun = safe(function () { return G.overrideRun(); }, []);
      if (!orun.length) push(empty(L("Nothing overridden.", "Nic upraveno."), L("If the catalog is wrong about your garden, change it on the crop — the original stays visible underneath.", "Pokud se katalog ve vaší zahradě mýlí, upravte to u plodiny."), L("Open the catalog", "Otevřít katalog"), go("/garden/catalog")));
      else push(rows(orun.map(function (x) {
        var o = x.o;
        return row({ title: G.byCrop[o.crop].cs + " \u00b7 " + (G.byCrop[o.crop].windows[o.field] ? kindW(o.field) : o.field), sub: "\u201c" + o.why + "\u201d \u00b7 " + name(o.by) + " \u00b7 " + day(o.on, false),
          right: JSON.stringify(o.value).replace(/"/g, ""), rightSub: L("catalog ", "katalog ") + x.catalogNow.replace(/"/g, "") + (x.changed ? L(" \u2192 " + x.catalogNext.replace(/"/g, "") + " in v" + G.catalog.next.version, " \u2192 " + x.catalogNext.replace(/"/g, "")) : ""),
          badge: x.held ? L("survives v" + G.catalog.next.version, "přežije v" + G.catalog.next.version) : "",
          act: canM ? L("Remove", "Odebrat") : "", onAct: function () {
            var ix = G.overrides.indexOf(o);
            var rb = function () { G.plantingsOf(2026).filter(function (pp) { return pp.crop === o.crop; }).forEach(function (pp) { G.rebuildPlanting(pp.id); }); };
            commit(function () { G.overrides.splice(ix, 1); rb(); }, function () { G.overrides.splice(ix, 0, o); rb(); }, L("Back to the catalog value", "Zpět na hodnotu z katalogu"));
          }, open: go("/garden/catalog/" + o.crop) });
      })));
    }

    if (page === "printWork" || page === "printPlan") {
      var plan = page === "printPlan";
      headTitle = plan ? L("Season plan, printed", "Plán sezóny k tisku") : L("This month, printed", "Tento měsíc k tisku");
      push(acts([btn(L("Print", "Tisknout"), "primary", function () { try { window.print(); } catch (e) {} }),
        btn(plan ? L("This month instead", "Raději tento měsíc") : L("The season plan instead", "Raději plán sezóny"), "", go(plan ? "/garden/print/work?month=2026-09" : "/garden/print/season?year=2026"))]));
      var csvDl = function (fname, head, body) {
        var esc = function (v) { v = v == null ? "" : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var txt = "\ufeff" + [head].concat(body).map(function (r) { return r.map(esc).join(","); }).join("\r\n");
        try { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "text/csv;charset=utf-8" })); a.download = fname; document.body.appendChild(a); a.click(); a.remove(); } catch (e) {}
        if (self.docToastShow) self.docToastShow(fname + L(" \u00b7 " + body.length + " rows", " \u00b7 " + body.length + " řádků"));
      };
      push(label(L("Or as a spreadsheet", "Nebo jako tabulka")));
      push(acts([btn(L("Plantings (CSV)", "Výsadby (CSV)"), "", function () {
          csvDl("garden-plantings-2026.csv", ["season", "bed", "crop", "planting", "in_ground_from", "in_ground_to", "status"], ps26.map(function (p) {
            return [2026, p.bed == null ? "" : p.bed, G.byCrop[p.crop] ? G.byCrop[p.crop].cs : p.crop, p.label, p.occupancy.from || "", endOf(p) || "", p.status || ""];
          }));
        }),
        btn(L("Harvests (CSV)", "Sklizně (CSV)"), "", function () {
          csvDl("garden-harvests-2026.csv", ["date", "planting", "quantity", "unit", "destination", "by"], G.harvests.map(function (h) {
            var hp2 = G.planting(h.planting);
            return [h.on, hp2 ? hp2.label : h.planting, h.qty, h.unit || "kg", h.dest || "", h.by || ""];
          }));
        })]));
      push(note(L("Paper for the garden, a spreadsheet for the winter. Both work without a connection.", "Papír na zahradu, tabulka na zimu. Obojí funguje bez signálu.")));
      push(note(G.paper.name + " \u00b7 " + G.printMetrics.bodyPt + " pt \u00b7 " + L("ink on white, no theme, no accent, real boxes to tick with a pencil", "černá na bílé, bez motivu, skutečná políčka na tužku"), ""));
      if (!plan) {
        var wp = safe(function () { return G.workPaper(q.month || "2026-09"); }, null);
        if (wp) {
          push(hero({ kicker: F && F.household ? String(F.household.name || "") : "", big: cs ? wp.title : wp.en, sub: wp.boxes + L(" lines \u00b7 fits on one page", " řádků \u00b7 vejde se na stránku") }));
          wp.sections.forEach(function (sec) {
            push(label(cs ? sec.label : sec.en));
            push(rows(sec.items.map(function (it) { return row({ lead: "\u2610", title: it.text, sub: it.meta }); })));
          });
        }
      } else {
        push(hero({ kicker: L("Season 2026 \u00b7 14 beds \u00d7 12 months", "Sezóna 2026 \u00b7 14 záhonů \u00d7 12 měsíců"), big: L("Garden plan 2026", "Plán zahrady 2026") }));
        G.zones.forEach(function (zz) {
          push(label(zz.name));
          push(rows(G.bedsOfZone(zz.id).map(function (bd2) {
            var bp = ps26.filter(function (pp) { return pp.bed === bd2.num && pp.occupancy.from; });
            var mo = function (iso) { return ROMAN[+iso.slice(5, 7) - 1]; };
            return row({ lead: "B" + bd2.num, title: bp.length ? bp.map(function (pp) { return pp.label + " " + (pp.occupancy.from.slice(0, 4) < "2026" ? "X/25" : mo(pp.occupancy.from)) + "\u2013" + mo(endOf(pp)); }).join(" \u00b7 ") : "\u2013" });
          })));
        });
      }
    }

    if (page === "settings") {
      headTitle = L("Garden settings", "Nastavení zahrady");
      push(label(L("What you grow in", "V čem pěstujete")));
      push(cards(G.tiers.map(function (t) {
        var v = G.tierView(t.id);
        return { title: tierName[t.id] + (t.id === tier ? " \u2713" : ""), sub: t.has, meta: v.shown.length + L(" of " + G.surfaces.length + " surfaces", " z " + G.surfaces.length + " částí"), style: cardStyle(t.id === tier),
          pick: canM ? function () {
            if (t.id === tier) return;
            var was = tier, mv = safe(function () { return G.tierMoveRun(); }, { same: true });
            self.setState({ gaTier: t.id });
            self.docToastShow(L("Now " + tierName[t.id] + " \u00b7 " + (mv.same ? "no rows changed" : "rows changed"), "Nyní " + tierName[t.id] + " \u00b7 " + (mv.same ? "žádný řádek se nezměnil" : "změna")), function () { self.setState({ gaTier: was, docToast: null }); });
          } : function () {} };
      })));
      push(note(L("The tier is a filter over the same rows. Moving down hides; moving up reveals. Nothing is migrated either way.", "Úroveň je filtr nad stejnými řádky. Dolů skrývá, nahoru odhaluje. Nic se nepřevádí.")));
      push(label(L("Place and frost dates", "Místo a mrazy"), canM ? L("Correct", "Opravit") : "", open({ kind: "frost", last: G.climate.lastFrost, first: G.climate.firstFrost, err: "" })));
      var pr = safe(function () { return G.pinRun(); }, null);
      push(kv([[L("Place", "Místo"), G.place.town + (pr ? " \u00b7 " + pr.snapped[0].toFixed(2) + ", " + pr.snapped[1].toFixed(2) : "")], [L("Climate", "Klima"), G.climate.label],
        [L("Last spring frost", "Poslední jarní mráz"), day(G.climate.lastFrost)], [L("First autumn frost", "První podzimní mráz"), day(G.climate.firstFrost)], [L("Source", "Zdroj"), G.climate.source]]));
      push(note(L("Device location is never read. The pin is stored at two decimals — about a kilometre.", "Poloha zařízení se nikdy nečte. Špendlík se ukládá na dvě desetinná místa — asi kilometr.")));
      push(acts([canM ? btn(L("Run setup again", "Znovu spustit nastavení"), "", go("/garden/setup/1")) : null]));
    }

    if (page === "setup") {
      var sd = s.gaSetup || { tier: tier, town: G.place.town, last: G.climate.lastFrost, first: G.climate.firstFrost };
      var setSD = function (p2) { self.setState({ gaSetup: Object.assign({}, sd, p2) }); };
      headTitle = L("Set up the garden", "Nastavení zahrady");
      push(steps([L("What you grow in", "V čem"), L("Where", "Kde"), L("Frost dates", "Mrazy"), L("Growing space", "Prostor")], id - 1));
      if (id === 1) {
        push(label(L("What do you grow in?", "V čem pěstujete?")));
        push(cards(G.tiers.map(function (t) { return { title: t.cs, sub: t.has, meta: tierName[t.id], style: cardStyle(sd.tier === t.id), pick: function () { setSD({ tier: t.id }); } }; })));
        push(note(L("The answer sets the shape of the whole module. It can be changed later without losing anything.", "Odpověď určí podobu celého modulu. Lze ji později změnit bez ztráty.")));
      }
      if (id === 2) {
        var pr2 = safe(function () { return G.pinRun(); }, null);
        push(field({ label: L("Town or village", "Obec"), value: sd.town, set: function (v) { setSD({ town: v }); } }));
        if (pr2) push(kv([[L("Pin dropped", "Špendlík"), pr2.raw[0].toFixed(6) + ", " + pr2.raw[1].toFixed(6)], [L("Stored", "Uloženo"), pr2.snapped[0].toFixed(2) + ", " + pr2.snapped[1].toFixed(2)], [L("Moved", "Posunuto o"), pr2.moved + " m"]]));
        push(note(L("The pin snaps to two decimals in front of you, and device location is never read.", "Špendlík se před vámi zaokrouhlí na dvě desetinná místa a poloha zařízení se nečte.")));
      }
      if (id === 3) {
        push(note(L("From the " + G.climate.source + " for " + G.climate.label + ". Correct them if your garden knows better.", "Z " + G.climate.source + " pro " + G.climate.label + ". Opravte je, pokud to vaše zahrada ví lépe."), "box"));
        push(field({ label: L("Last spring frost", "Poslední jarní mráz"), type: "date", value: sd.last, narrow: true, set: function (v) { setSD({ last: v }); } }));
        push(field({ label: L("First autumn frost", "První podzimní mráz"), type: "date", value: sd.first, narrow: true, set: function (v) { setSD({ first: v }); } }));
      }
      if (id === 4) {
        if (sd.tier === "pots") push(kv([[L("Containers", "Nádoby"), G.containers.length], [L("Plants", "Rostliny"), G.containerPlants.length]]));
        else push(kv(G.zones.map(function (zz) { return [zz.name, G.bedsOfZone(zz.id).length + L(" beds", " záhonů")]; })));
        push(note(sd.tier === "pots" ? L("Name the containers; what is in them can come later.", "Pojmenujte nádoby; co v nich roste, doplníte později.")
          : L("Beds are listed in the order they stand in. That order is how the checks know what is next to what.", "Záhony jsou v pořadí, v jakém stojí. Podle toho kontroly vědí, co je vedle čeho.")));
      }
      foot = [id > 1 ? btn(L("Back", "Zpět"), "", go("/garden/setup/" + (id - 1))) : btn(L("Cancel", "Zrušit"), "", function () { self.setState({ gaSetup: null }); self.go("/garden"); }),
        id < 4 ? btn(L("Next", "Další"), "primary", go("/garden/setup/" + (id + 1))) : btn(L("Finish", "Dokončit"), "primary", function () {
          var old = { last: G.climate.lastFrost, first: G.climate.firstFrost, town: G.place.town, tier: tier };
          commit(function () { if (sd.last) G.climate.lastFrost = sd.last; if (sd.first) G.climate.firstFrost = sd.first; if (sd.town) G.place.town = sd.town; },
            function () { G.climate.lastFrost = old.last; G.climate.firstFrost = old.first; G.place.town = old.town; self.setState({ gaTier: old.tier }); },
            L("Garden set up \u00b7 ", "Zahrada nastavena \u00b7 ") + tierName[sd.tier], { gaTier: sd.tier, gaSetup: null, route: "/garden" });
          if (window.HH_OB) window.HH_OB.mark(self, "garden");
        }, !canM)];
    }

    /* A planting added mid-season starts in the present: the autumn window if the crop has
       one still ahead, otherwise the catalog schedule moved so its first step is today. */
    function planFor(cropId, varId) {
      var crop = G.byCrop[cropId], ws = {}, first = null, useAut = false;
      var get = function (k, aut) { return safe(function () { return G.resolveWindow(cropId, varId || null, aut && crop.windows[k + "_autumn"] ? k + "_autumn" : k, clim26, { by: "planting" }); }, null); };
      var start = function (aut) { var f = null; ["direct_sow", "transplant", "sow_indoor"].forEach(function (k) { var w = get(k, aut); if (w && (!f || w.from < f)) f = w.from; }); return f; };
      var sp = start(false);
      if (sp && sp < TD && Object.keys(crop.windows).some(function (k) { return /_autumn$/.test(k); }) && (start(true) || "") >= TD) useAut = true;
      G.dateKinds.forEach(function (k) { var w = get(k, useAut); if (w) ws[k] = w; });
      Object.keys(ws).forEach(function (k) { if (k !== "harvest" && (!first || ws[k].from < first)) first = ws[k].from; });
      var shift = first && first < TD ? G.diff(first, TD) : 0, manual = null, cleared = null;
      if (shift) { manual = {}; Object.keys(ws).forEach(function (k) { manual[k] = G.addDays(ws[k].from, shift); }); if (ws.harvest) cleared = G.addDays(ws.harvest.to, shift); }
      return { autumn: useAut, shift: shift, manual: manual, cleared: cleared,
        rows: G.dateKinds.filter(function (k) { return ws[k]; }).map(function (k) {
          var w = ws[k];
          return [kindW(w.kind), shift ? day(manual[k], false) + (k === "harvest" ? " – " + day(cleared, false) : "") : span(w.from, w.to) + (w.source !== "catalog" ? " · " + fromW(w.source) : "")];
        }) };
    }

    /* ═══ sheets ═══ */
    function sheetBody(d) {
      var out = { title: "", sub: "", blocks: [], foot: [], footNote: "" }, B = out.blocks;
      var cancel = btn(L("Cancel", "Zrušit"), "", closeSheet), closeB = btn(L("Close", "Zavřít"), "", closeSheet);

      if (d.kind === "planting") {
        var ex = d.edit ? G.planting(d.edit) : null;
        out.title = ex ? L("Edit planting", "Upravit výsadbu") : L("New planting", "Nová výsadba"); out.sub = ex ? ex.label : L("Season 2026", "Sezóna 2026");
        B.push(chips(L("Bed", "Záhon"), G.orderedActive().map(function (n) { return chip("B" + n, d.bed === n, function () { patch({ bed: n, err: "" }); }); }), d.bed ? (zoneOfBed(d.bed) || {}).name : ""));
        B.push(chips(L("Crop", "Plodina"), G.crops.map(function (x) { return chip(x.cs, d.crop === x.id, function () { patch({ crop: x.id, variety: "", err: "" }); }); })));
        if (d.crop) {
          var vs = G.varieties.filter(function (v) { return v.crop === d.crop; });
          if (vs.length) B.push(chips(L("Variety", "Odrůda"), [chip(L("Catalog default", "Z katalogu"), !d.variety, function () { patch({ variety: "" }); })].concat(vs.map(function (v) { return chip(v.name, d.variety === v.id, function () { patch({ variety: v.id }); }); }))));
          B.push(chips(L("Measured as", "Měří se"), [chip(L("Area", "Plocha"), d.measure === "area", function () { patch({ measure: "area", err: "" }); }), chip(L("Plant count", "Počet rostlin"), d.measure === "count", function () { patch({ measure: "count", err: "" }); })],
            L("One or the other, never both.", "Jedno nebo druhé, nikdy obojí.")));
          B.push(field({ label: d.measure === "area" ? L("Area", "Plocha") : L("Plants", "Rostlin"), mode: "decimal", value: d.amount, narrow: true, suffix: d.measure === "area" ? "m\u00b2" : L("plants", "ks"), set: function (v) { patch({ amount: v, err: "" }); },
            hint: d.bed ? L("Bed " + d.bed + " is " + G.bed(d.bed).area + " m\u00b2.", "Záhon " + d.bed + " má " + G.bed(d.bed).area + " m\u00b2.") : "" }));
          B.push(label(L("Planned dates, from your frost dates", "Plánovaná data podle mrazů")));
          var pf = planFor(d.crop, d.variety);
          if (!d.edit && pf.autumn) B.push(note(L("The spring window has passed, so this uses the crop's autumn window.", "Jarní okno už minulo, proto se použije podzimní."), "box"));
          if (!d.edit && pf.shift) B.push(note(L("This year's window passed " + pf.shift + " days ago. The schedule starts today instead, and each date is marked as set by hand.", "Letošní okno minulo před " + pf.shift + " dny. Plán začne dnes a data se označí jako ruční."), "boxWarn"));
          B.push(kv(d.edit ? G.dateKinds.map(function (k2) {
            var w = safe(function () { return G.resolveWindow(d.crop, d.variety || null, k2, clim26, { by: "planting" }); }, null);
            return w ? [kindW(k2), span(w.from, w.to) + (w.source !== "catalog" ? " \u00b7 " + fromW(w.source) : "")] : null;
          }) : pf.rows));
          var amt = parseNum(d.amount);
          if (d.bed && amt) {
            var area = d.measure === "area" ? amt : amt / (G.pick(d.crop, d.variety || null, "perM2", { by: "planting" }).value || 1);
            var others = ps26.filter(function (x) { return x.bed === d.bed && x.id !== d.edit && endOf(x) >= TD; });
            var adv = [];
            others.forEach(function (o) {
              var r = G.ruleFor(d.crop, o.crop);
              if (r.verdict === "antagonist") adv.push(L(o.label + " is in this bed, and the " + r.from + " says keep them apart: " + r.rule.why, o.label + " je v záhonu a " + r.from + " říká držet odděleně: " + r.rule.why));
              if (o.family === G.byCrop[d.crop].family) adv.push(L(o.label + " is the same family (" + o.family + ") in the same bed.", o.label + " je ze stejné čeledi (" + o.family + ")."));
            });
            var used = others.filter(inNow).reduce(function (n, o) { return n + o.area; }, 0) + area;
            if (used > G.bed(d.bed).area) adv.push(L("With what's growing now the bed would carry " + Math.round(used * 10) / 10 + " m\u00b2 in " + G.bed(d.bed).area + " m\u00b2.", "Se současnými výsadbami by záhon nesl " + Math.round(used * 10) / 10 + " m\u00b2 na " + G.bed(d.bed).area + " m\u00b2."));
            if (G.byCrop[d.crop].hardiness !== "hardy" && G.bed(d.bed).sun !== "glass" && frost.published) adv.push(L("Tender, and tonight's forecast is " + frost.min + " °C.", "Choulostivá a dnes v noci má být " + frost.min + " °C."));
            if (adv.length) { B.push(label(L("Worth knowing \u00b7 nothing here stops a save", "Dobré vědět \u00b7 nic neblokuje uložení"))); adv.forEach(function (t) { B.push(note(t, "boxWarn")); }); }
          }
        }
        B.push(field({ label: L("Note", "Poznámka"), value: d.note, placeholder: L("Optional", "Nepovinné"), set: function (v) { patch({ note: v }); } }));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(ex ? L("Save", "Uložit") : L("Add planting", "Přidat výsadbu"), "primary", function () {
          var n = parseNum(d.amount);
          if (!d.bed) return patch({ err: L("Pick the bed.", "Vyberte záhon.") });
          if (!d.crop) return patch({ err: L("Pick what's going in.", "Vyberte plodinu.") });
          if (!n) return patch({ err: d.measure === "area" ? L("How many square metres?", "Kolik metrů čtverečních?") : L("How many plants?", "Kolik rostlin?") });
          var qty = d.measure === "area" ? { area: n } : { count: Math.round(n) };
          if (ex) {
            var raw = G.rawOf(ex.id), old = raw.slice(); old[6] = Object.assign({}, raw[6] || {});
            commit(function () { raw[2] = d.bed; raw[3] = d.crop; raw[4] = d.variety || null; raw[5] = qty; raw[6] = Object.assign({}, raw[6] || {}, { note: d.note }); G.rebuildPlanting(ex.id); },
              function () { for (var i = 0; i < 7; i++) raw[i] = old[i]; G.rebuildPlanting(ex.id); }, L("Planting saved \u00b7 dates re-resolved", "Výsadba uložena \u00b7 data přepočtena"), { route: "/garden/plantings/" + ex.id });
          } else {
            var nid = "p26-s" + (Date.now() % 100000);
            var pf2 = planFor(d.crop, d.variety), xx = {};
            if (d.note) xx.note = d.note;
            if (pf2.autumn) xx.win = "autumn";
            if (pf2.manual) { xx.manual = pf2.manual; xx.cleared = pf2.cleared; }
            commit(function () { G.addPlanting([nid, 2026, d.bed, d.crop, d.variety || null, qty, xx]); },
              function () { G.removePlanting(nid); }, L("Added to bed " + d.bed + " \u00b7 its tasks are on the list", "Přidáno do záhonu " + d.bed + " \u00b7 práce jsou na seznamu"), { route: "/garden/plantings/" + nid });
          }
        })];
      }

      if (d.kind === "delPlanting") {
        var dp = G.planting(d.pid); if (!dp) return null;
        out.title = L("Delete this planting?", "Smazat výsadbu?"); out.sub = dp.label + " \u00b7 " + bedL(dp.bed);
        var nh = G.harvests.filter(function (h) { return h.planting === dp.id; }).length;
        B.push(note(L("Its generated tasks go with it" + (nh ? ", and its " + nh + " harvests stop counting toward yields" : "") + ". Undo is right after.", "Zmizí i její práce" + (nh ? " a " + nh + " sklizní se přestane počítat" : "") + ". Hned lze vrátit."), "box"));
        out.foot = [cancel, btn(L("Delete", "Smazat"), "danger", function () {
          var rec;
          commit(function () { rec = G.removePlanting(dp.id); }, function () { G.restorePlanting(rec); }, L("Planting deleted", "Výsadba smazána"), { route: "/garden/beds/" + dp.bed });
        })];
      }

      if (d.kind === "actual") {
        var ap = G.planting(d.pid); if (!ap) return null;
        out.title = kindW(d.k) + L(" happened", " proběhlo"); out.sub = ap.label + L(" \u00b7 planned ", " \u00b7 plán ") + day(ap.planned[d.k]);
        B.push(field({ label: L("On", "Dne"), type: "date", value: d.on, narrow: true, set: function (v) { patch({ on: v, err: "" }); } }));
        if (d.on && ap.planned[d.k] && d.on !== ap.planned[d.k]) {
          var dd2 = G.diff(ap.planned[d.k], d.on);
          B.push(note(L(Math.abs(dd2) + " days " + (dd2 > 0 ? "after" : "before") + " the plan. The planned date stays as it is — next year's comparison needs it.", Math.abs(dd2) + " dní " + (dd2 > 0 ? "po" : "před") + " plánem. Plánované datum zůstane.")));
        }
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          if (!d.on || d.on > TD) return patch({ err: L("An actual date is one that has happened.", "Skutečné datum už muselo nastat.") });
          var raw = G.rawOf(ap.id), prev = raw[6] ? Object.assign({}, raw[6].actual || {}) : {};
          var dd3 = ap.planned[d.k] ? G.diff(ap.planned[d.k], d.on) : 0;
          var later = allT.filter(function (t) { return t.planting === ap.id && t.status === "open" && t.due > d.on; });
          commit(function () { raw[6] = raw[6] || {}; var na = Object.assign({}, prev); na[d.k] = d.on; raw[6].actual = na; G.rebuildPlanting(ap.id); },
            function () { raw[6].actual = prev; G.rebuildPlanting(ap.id); }, kindW(d.k) + L(" recorded \u00b7 ", " zapsáno \u00b7 ") + day(d.on, false),
            dd3 && later.length ? { gaSheet: { at: s.route, kind: "drift", pid: ap.id, k: d.k } } : {});
        })];
      }

      if (d.kind === "drift") {
        var dpl = G.planting(d.pid); if (!dpl) return null;
        var k3 = d.k || G.dateKinds.filter(function (k4) { return dpl.actual[k4] && dpl.planned[k4] && k4 !== "harvest"; })[0];
        if (!k3) return null;
        var days = G.diff(dpl.planned[k3], dpl.actual[k3]);
        var rest = allT.filter(function (t) { return t.planting === dpl.id && t.status === "open" && t.due > dpl.actual[k3]; });
        out.title = L("Actual against plan", "Skutečnost proti plánu"); out.sub = dpl.label + " \u00b7 " + bedL(dpl.bed);
        B.push(note(L(kindW(k3) + " happened " + Math.abs(days) + " days " + (days > 0 ? "after" : "before") + " the plan. The plan has not moved.", kindW(k3) + ": " + Math.abs(days) + " dní " + (days > 0 ? "po plánu" : "před plánem") + ". Plán se nepohnul."), "box"));
        B.push(kv([[L("Planned", "Plán"), day(dpl.planned[k3])], [L("Actual", "Skutečně"), day(dpl.actual[k3])], [L("Difference", "Rozdíl"), (days > 0 ? "+" : "") + days + L(" days", " dní")]]));
        if (rest.length && days) {
          B.push(label(L("Shift what's left by " + days + " days?", "Posunout zbytek o " + days + " dní?")));
          B.push(rows(rest.map(function (t) { return row({ title: taskTitle(t), sub: day(t.due, false) + " \u2192 " + day(G.addDays(t.due, days), false) }); })));
          out.foot = [btn(L("Leave them", "Nechat"), "", closeSheet), canC ? btn(L("Shift " + rest.length + " tasks", "Posunout " + rest.length), "primary", function () {
            var prev = rest.map(function (t) { return [t, t.is_generated && Object.prototype.hasOwnProperty.call(G.taskState, t.id) ? Object.assign({}, G.taskState[t.id]) : null, t.due]; });
            commit(function () { rest.forEach(function (t) {
              if (t.is_generated) G.taskState[t.id] = Object.assign({}, G.taskState[t.id] || {}, { status: "open", due: G.addDays(t.due, days), edited: true, why: L("Shifted with the actual date", "Posunuto podle skutečnosti") });
              else { var m = G.manualTasks.filter(function (x) { return x.id === t.id; })[0]; if (m) { m.due = G.addDays(t.due, days); m.week = G.weekKey(m.due); } }
            }); }, function () { prev.forEach(function (x) {
              if (x[0].is_generated) { if (x[1]) G.taskState[x[0].id] = x[1]; else delete G.taskState[x[0].id]; }
              else { var m = G.manualTasks.filter(function (y) { return y.id === x[0].id; })[0]; if (m) { m.due = x[2]; m.week = G.weekKey(x[2]); } }
            }); }, rest.length + L(" tasks shifted \u00b7 no planned window changed", " prací posunuto \u00b7 plán beze změny"));
          }) : null].filter(Boolean);
        } else { B.push(note(L("Nothing open on this planting comes after it, so there is nothing to shift.", "Po něm už nic otevřeného není."))); out.foot = [closeB]; }
      }

      if (d.kind === "harvest") {
        var hp = G.planting(d.pid); if (!hp) return null;
        out.title = L("Log a harvest", "Zapsat sklizeň"); out.sub = hp.label + " \u00b7 " + bedL(hp.bed);
        B.push(field({ label: L("How much", "Kolik"), mode: "decimal", value: d.qty, suffix: "kg", narrow: true, set: function (v) { patch({ qty: v, err: "" }); } }));
        B.push(field({ label: L("Picked on", "Sklizeno dne"), type: "date", value: d.on, narrow: true, set: function (v) { patch({ on: v }); } }));
        var dests = ["kitchen"].concat(G.byCrop[hp.crop].storage || []);
        B.push(chips(L("Where it went", "Kam"), dests.map(function (x) { return chip(x, d.dest === x, function () { patch({ dest: x }); }); })));
        if (d.dest !== "kitchen" && shown.storage) B.push(chips("", [chip((d.store ? "\u2713 " : "") + L("Also add it to storage", "Přidat i do zásob"), !!d.store, function () { patch({ store: !d.store }); })]));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Log it", "Zapsat"), "primary", function () {
          var n = parseNum(d.qty);
          if (!n) return patch({ err: L("How much, in kilograms?", "Kolik kilogramů?") });
          if (!d.on || d.on > TD) return patch({ err: L("Pick the day it was picked.", "Vyberte den sklizně.") });
          var h = { id: "h-s" + (Date.now() % 100000), planting: hp.id, on: d.on, qty: n, unit: "kg", dest: d.dest, by: me, session: true };
          var st = d.store ? { id: "s-s" + (Date.now() % 100000), product: hp.label, method: d.dest, where: "", initial: n, remaining: n, unit: "kg", on: d.on, best: null, from: hp.id, edits: [[d.on, n]] } : null;
          commit(function () { G.harvests.push(h); if (st) G.storage.push(st); }, function () { G.harvests.splice(G.harvests.indexOf(h), 1); if (st) G.storage.splice(G.storage.indexOf(st), 1); },
            kg(n) + L(" of " + G.byCrop[hp.crop].cs + " logged", " zapsáno") + (st ? L(" \u00b7 and in storage", " \u00b7 i do zásob") : ""));
        })];
      }

      if (d.kind === "task") {
        var t = taskById(d.id); if (!t) return null;
        var tp = t.planting ? G.planting(t.planting) : null;
        out.title = taskTitle(t); out.sub = t.is_generated ? L("Generated from the planting", "Vygenerováno z výsadby") : L("Your own task", "Vlastní práce");
        B.push(kv([[L("Planting", "Výsadba"), tp ? tp.label : ""], [L("Bed", "Záhon"), t.bed ? bedL(t.bed) : ""], [L("Due", "Termín"), day(t.due)],
          [L("Window", "Okno"), tp && tp.windows[t.kind] ? span(tp.windows[t.kind].from, tp.windows[t.kind].to) : ""], [L("Status", "Stav"), t.status === "done" ? L("done ", "hotovo ") + day(t.doneOn, false) : t.status === "skipped" ? L("skipped", "přeskočeno") : L("open", "otevřená")],
          [L("Why", "Proč"), t.why || ""]]));
        if (canC && t.status === "open") B.push(field({ label: L("Move to", "Přesunout na"), type: "date", value: d.date, narrow: true, set: function (v) { patch({ date: v }); },
          hint: t.is_generated ? L("A task moved by hand is never moved by the generator again.", "Ručně posunutou práci generátor už neposune.") : "" }));
        if (canC && d.confirmDel) B.push(field({ label: L("Why delete it?", "Proč smazat?"), value: d.why || "", placeholder: L("There's no mulch for that bed this year", "Letos na ten záhon mulč není"), set: function (v) { patch({ why: v }); },
          hint: t.is_generated ? L("A deleted generated task leaves a note behind, so it can't come back on its own.", "Smazaná vygenerovaná práce zanechá poznámku, aby se sama nevrátila.") : "" }));
        if (!canC) { out.foot = [closeB]; return out; }
        if (d.confirmDel) {
          out.foot = [btn(L("Keep it", "Ponechat"), "", function () { patch({ confirmDel: false }); }), btn(L("Delete", "Smazat"), "danger", function () {
            if (t.is_generated) {
              var had = Object.prototype.hasOwnProperty.call(G.taskState, t.id), pv = had ? G.taskState[t.id] : null;
              commit(function () { G.taskState[t.id] = { deleted: true, by: me, on: TD, why: String(d.why || "").trim() || L("Not needed this year", "Letos netřeba") }; },
                function () { if (had) G.taskState[t.id] = pv; else delete G.taskState[t.id]; }, L("Deleted \u00b7 it won't be generated again", "Smazáno \u00b7 už se nevygeneruje"));
            } else {
              var ix = G.manualTasks.indexOf(G.manualTasks.filter(function (x) { return x.id === t.id; })[0]), mt = G.manualTasks[ix];
              commit(function () { G.manualTasks.splice(ix, 1); }, function () { G.manualTasks.splice(ix, 0, mt); }, L("Task deleted", "Práce smazána"));
            }
          })];
          return out;
        }
        out.foot = [btn(L("Delete", "Smazat"), "danger-ghost", function () { patch({ confirmDel: true }); }),
          t.status === "open" ? btn(L("Skip", "Přeskočit"), "", function () { setTask(t, { status: "skipped", by: me }, L("Skipped \u00b7 it stays in the history", "Přeskočeno")); }) : null,
          t.status === "open" && d.date && d.date !== t.due ? btn(L("Move", "Přesunout"), "", function () { setTask(t, { status: "open", due: d.date, edited: t.is_generated, why: L("Moved by ", "Posunul(a) ") + name(me) }, L("Moved to ", "Přesunuto na ") + day(d.date, false)); }) : null,
          t.status === "open" ? btn(L("Done", "Hotovo"), "primary", doneTask(t)) : btn(L("Reopen", "Vrátit"), "", reopenTask(t))].filter(Boolean);
      }

      if (d.kind === "newtask") {
        out.title = L("A task of your own", "Vlastní práce"); out.sub = L("The generator never touches it.", "Generátor na ni nesahá.");
        B.push(field({ label: L("What", "Co"), value: d.title, placeholder: L("Sow winter spinach", "Vysít ozimý špenát"), set: function (v) { patch({ title: v, err: "" }); } }));
        B.push(field({ label: L("When", "Kdy"), type: "date", value: d.date, narrow: true, set: function (v) { patch({ date: v }); } }));
        B.push(chips(L("Bed, if it's about one", "Záhon, pokud se týká"), [chip(L("None", "Žádný"), !d.bed, function () { patch({ bed: null }); })].concat(G.orderedActive().map(function (n) { return chip("B" + n, d.bed === n, function () { patch({ bed: n }); }); }))));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Add", "Přidat"), "primary", function () {
          var tt = String(d.title || "").trim();
          if (!tt) return patch({ err: L("Say what the task is.", "Napište, o jakou práci jde.") });
          if (!d.date) return patch({ err: L("Pick a day.", "Vyberte den.") });
          var nt = { id: "mt-s" + (Date.now() % 100000), generation_key: null, is_generated: false, planting: null, bed: d.bed, crop: null, kind: "own", title: tt,
            due: d.date, baseDue: d.date, manual: true, edited: false, status: "open", doneOn: null, why: "", week: G.weekKey(d.date), window: null, by: me };
          commit(function () { G.manualTasks.push(nt); }, function () { G.manualTasks.splice(G.manualTasks.indexOf(nt), 1); }, L("Added for ", "Přidáno na ") + day(d.date, false));
        })];
      }

      if (d.kind === "dismiss") {
        out.title = L("Dismiss for this season", "Umlčet pro tuto sezónu"); out.sub = d.check;
        B.push(note(d.says + ".", "boxWarn"));
        B.push(field({ label: L("Why it's fine", "Proč je to v pořádku"), value: d.note, placeholder: L("Checked by hand", "Zkontrolováno ručně"), set: function (v) { patch({ note: v, err: "" }); },
          hint: L("The check keeps running. The warning moves to Dismissed with your note, and next season it speaks again.", "Kontrola dál běží. Upozornění se přesune do Umlčených s poznámkou a příští sezónu se ozve znovu.") }));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Dismiss", "Umlčet"), "primary", function () {
          var nn = String(d.note || "").trim();
          if (!nn) return patch({ err: L("One line saying why — it's what makes a dismissal readable in April.", "Jedna věta proč.") });
          var ds = { check: d.check, entity: d.entity, season: 2026, by: me, on: TD, note: nn };
          commit(function () { G.dismissals.push(ds); }, function () { G.dismissals.splice(G.dismissals.indexOf(ds), 1); }, L("Dismissed for 2026", "Umlčeno pro 2026"));
        })];
      }

      if (d.kind === "disable") {
        out.title = L("Turn off ", "Vypnout ") + d.check; out.sub = (G.checkDefs.filter(function (x) { return x[0] === d.check; })[0] || [])[2] || "";
        B.push(note(L("Off means off for every bed and every season, until someone turns it back on. To quiet one warning, dismiss it instead.", "Vypnutí platí pro všechny záhony a sezóny. Pro jedno upozornění ho raději umlčte.")));
        B.push(field({ label: L("Why", "Proč"), value: d.why, placeholder: L("We grow tomatoes. That is the point of the garden.", "Pěstujeme rajčata. O to v zahradě jde."), set: function (v) { patch({ why: v, err: "" }); } }));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Turn off", "Vypnout"), "primary", function () {
          var w = String(d.why || "").trim();
          if (!w) return patch({ err: L("Say why — the next person to open this will want to know.", "Napište proč.") });
          var old = G.checkConfig[d.check];
          commit(function () { G.checkConfig[d.check] = { enabled: false, by: me, on: TD, why: w }; }, function () { if (old) G.checkConfig[d.check] = old; else delete G.checkConfig[d.check]; }, d.check + L(" is off", " vypnuta"));
        })];
      }

      if (d.kind === "use") {
        var it = G.storage.filter(function (x) { return x.id === d.sid; })[0]; if (!it) return null;
        out.title = L("Use some ", "Ubrat: ") + it.product; out.sub = it.remaining + " / " + it.initial + "\u00a0" + it.unit + " \u00b7 " + it.where;
        B.push(field({ label: L("How much", "Kolik"), mode: "decimal", value: d.amount, suffix: it.unit, narrow: true, set: function (v) { patch({ amount: v, err: "" }); } }));
        B.push(chips("", [chip(L("All of it", "Všechno"), false, function () { patch({ amount: String(it.remaining) }); })]));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          var n = parseNum(d.amount);
          if (!n) return patch({ err: L("How much was used?", "Kolik se spotřebovalo?") });
          if (n > it.remaining) return patch({ err: L("Only " + it.remaining + " " + it.unit + " left.", "Zbývá jen " + it.remaining + " " + it.unit + ".") });
          var old = { remaining: it.remaining, edits: it.edits.slice(), status: it.status };
          var nr = Math.round((it.remaining - n) * 10) / 10;
          commit(function () { it.remaining = nr; it.edits = it.edits.concat([[TD, nr]]); if (!nr) it.status = "finished"; }, function () { Object.assign(it, old); },
            nr ? nr + " " + it.unit + L(" left", " zbývá") : L("Finished \u00b7 the last one is dated today", "Spotřebováno \u00b7 poslední dnes"));
        })];
      }

      if (d.kind === "store") {
        out.title = L("Put something away", "Uložit do zásob");
        B.push(field({ label: L("What", "Co"), value: d.product, placeholder: L("Tomato passata", "Rajčatová passata"), set: function (v) { patch({ product: v, err: "" }); } }));
        B.push(field({ label: L("How much", "Kolik"), mode: "decimal", value: d.amount, narrow: true, set: function (v) { patch({ amount: v, err: "" }); } }));
        B.push(chips(L("Counted in", "Jednotka"), ["kg", "jars", "heads", "whole"].map(function (u) { return chip(u, d.unit === u, function () { patch({ unit: u }); }); })));
        B.push(field({ label: L("Where", "Kde"), value: d.where, placeholder: L("Cellar shelf 2", "Sklep, police 2"), set: function (v) { patch({ where: v }); } }));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          var n = parseNum(d.amount), pr = String(d.product || "").trim();
          if (!pr) return patch({ err: L("Say what it is.", "Napište co.") });
          if (!n) return patch({ err: L("How much?", "Kolik?") });
          var st = { id: "s-s" + (Date.now() % 100000), product: pr, method: d.method || "", where: String(d.where || "").trim(), initial: n, remaining: n, unit: d.unit, on: TD, best: null, from: null, edits: [[TD, n]] };
          commit(function () { G.storage.push(st); }, function () { G.storage.splice(G.storage.indexOf(st), 1); }, pr + L(" put away", " uloženo"));
        })];
      }

      if (d.kind === "override") {
        var oc = G.byCrop[d.crop];
        var FL = { spacing: [L("Spacing", "Spon"), "cm"], perM2: [L("Plants per m\u00b2", "Rostlin/m\u00b2"), ""], dtm: [L("Days to maturity", "Dní do sklizně"), L("days", "dní")], yieldM2: [L("Yield", "Výnos"), "kg/m\u00b2"], breakYears: [L("Rotation break", "Odstup"), L("years", "roky")] };
        out.title = L("Override for this household", "Úprava pro tuto domácnost"); out.sub = oc.cs;
        B.push(chips(L("Field", "Hodnota"), Object.keys(FL).map(function (f) { return chip(FL[f][0], d.field === f, function () { patch({ field: f, err: "" }); }); }),
          L("Catalog: ", "Katalog: ") + (oc[d.field] == null ? "\u2013" : oc[d.field] + " " + FL[d.field][1]) + " \u00b7 " + srcW(G.fieldSrc[d.field])));
        B.push(field({ label: L("Your value", "Vaše hodnota"), mode: "decimal", value: d.value, suffix: FL[d.field][1], narrow: true, set: function (v) { patch({ value: v, err: "" }); } }));
        B.push(field({ label: L("Why", "Proč"), value: d.why, placeholder: L("15 cm gives thin stems in this soil", "15 cm dává v této půdě tenké stonky"), set: function (v) { patch({ why: v, err: "" }); } }));
        B.push(note(L("The catalog value stays visible under yours, and a catalog update changes it without touching your override.", "Hodnota z katalogu zůstane vidět a aktualizace katalogu vaši úpravu nezmění.")));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save override", "Uložit úpravu"), "primary", function () {
          var n = parseNum(d.value);
          if (n == null) return patch({ err: L("Type the value this garden uses.", "Zapište hodnotu.") });
          if (!String(d.why || "").trim()) return patch({ err: L("Say why — an override without a reason reads like a typo.", "Napište proč.") });
          var prev = G.overrides.filter(function (o) { return o.crop === d.crop && o.field === d.field; })[0], pix = G.overrides.indexOf(prev);
          var no = { id: "o-s" + (Date.now() % 100000), crop: d.crop, field: d.field, value: n, by: me, on: TD, why: String(d.why).trim() };
          var rb = function () { G.plantingsOf(2026).filter(function (pp) { return pp.crop === d.crop; }).forEach(function (pp) { G.rebuildPlanting(pp.id); }); };
          commit(function () { if (prev) G.overrides.splice(pix, 1, no); else G.overrides.push(no); rb(); },
            function () { if (prev) G.overrides.splice(G.overrides.indexOf(no), 1, prev); else G.overrides.splice(G.overrides.indexOf(no), 1); rb(); }, L("Override saved \u00b7 this garden's plantings use it now", "Úprava uložena \u00b7 výsadby ji už používají"));
        })];
      }

      if (d.kind === "suggest") {
        var sc = d.crop ? G.byCrop[d.crop] : null, sf = d.field || "dtm";
        out.title = sc ? L("Suggest a correction", "Navrhnout opravu") : L("Suggest a missing crop", "Navrhnout chybějící plodinu");
        out.sub = sc ? sc.cs + L(" \u00b7 catalog v", " \u00b7 katalog v") + G.catalog.version : L("For every household that uses the catalog", "Pro všechny domácnosti");
        if (!s.online) B.push(note(L("Needs a connection. A suggestion goes to the catalog\u2019s maintainers, not to this household, so it can\u2019t wait on this phone.", "Potřebuje připojení. Návrh jde správcům katalogu, ne do této domácnosti."), "boxWarn"));
        if (sc) {
          B.push(chips(L("What is wrong", "Co nesedí"), Object.keys(SGF).map(function (f) { return chip(SGF[f][0], sf === f, function () { patch({ field: f, err: "" }); }); }),
            L("Catalog says ", "Katalog uvádí ") + (sc[sf] == null ? "\u2013" : sc[sf] + "\u00a0" + SGF[sf][1]) + " \u00b7 " + srcW(G.fieldSrc[sf])));
          B.push(field({ label: L("What it should be", "Jak by to mělo být"), mode: "decimal", value: d.value, suffix: SGF[sf][1], narrow: true, set: function (v) { patch({ value: v, err: "" }); } }));
        } else {
          B.push(field({ label: L("Name", "Název"), value: d.name, placeholder: L("Pak choi", "Pak choi"), set: function (v) { patch({ name: v, err: "" }); } }));
          B.push(field({ label: L("Latin name, if you know it", "Latinsky, pokud víte"), value: d.latin, set: function (v) { patch({ latin: v }); } }));
        }
        B.push(field({ label: L("How you know", "Odkud to víte"), value: d.why, placeholder: sc ? L("Seed packet, a book, or three seasons of your own", "Sáček semen, kniha nebo vlastní sezóny") : L("Where you grow it and why others might", "Kde ji pěstujete"), set: function (v) { patch({ why: v, err: "" }); } }));
        B.push(note(L("Nothing is published automatically. Someone checks it against a source first, and the answer comes back here and as a notification. Your garden is unchanged either way \u2014 an override does that.", "Nic se nezveřejní samo. Nejdřív se to ověří a odpověď přijde sem i jako upozornění. Vaše zahrada se nemění \u2014 to dělá úprava.")));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Send", "Odeslat"), "primary", function () {
          if (!s.online) return patch({ err: L("No connection. Try again when there is signal.", "Bez připojení. Zkuste to se signálem.") });
          var nv2 = sc ? parseNum(d.value) : null;
          if (sc && nv2 == null) return patch({ err: L("Type the value you think is right.", "Zapište správnou hodnotu.") });
          if (!sc && !String(d.name || "").trim()) return patch({ err: L("Name the crop.", "Napište název plodiny.") });
          if (!String(d.why || "").trim()) return patch({ err: L("Say how you know \u2014 it is what the reviewer checks.", "Napište, odkud to víte.") });
          var sg = sc ? { id: "sg-s" + (Date.now() % 100000), crop: sc.id, field: sf, value: nv2, why: String(d.why).trim(), by: me, on: TD, status: "waiting" }
            : { id: "sg-s" + (Date.now() % 100000), crop: null, name: String(d.name).trim(), latin: String(d.latin || "").trim(), why: String(d.why).trim(), by: me, on: TD, status: "waiting" };
          commit(function () { G.suggestions.push(sg); }, function () { G.suggestions.splice(G.suggestions.indexOf(sg), 1); }, L("Sent to the catalog\u2019s maintainers \u00b7 you\u2019ll hear what happens", "Odesláno správcům katalogu"));
        })];
      }

      if (d.kind === "frost") {
        out.title = L("Correct the frost dates", "Opravit mrazy"); out.sub = G.climate.label;
        B.push(field({ label: L("Last spring frost", "Poslední jarní mráz"), type: "date", value: d.last, narrow: true, set: function (v) { patch({ last: v, err: "" }); } }));
        B.push(field({ label: L("First autumn frost", "První podzimní mráz"), type: "date", value: d.first, narrow: true, set: function (v) { patch({ first: v, err: "" }); } }));
        var nc = Object.assign({}, G.climate, { lastFrost: d.last || G.climate.lastFrost, firstFrost: d.first || G.climate.firstFrost });
        var rg = (d.last !== G.climate.lastFrost || d.first !== G.climate.firstFrost) ? safe(function () { return G.regenerate(nc); }, null) : null;
        if (rg) B.push(note(L(rg.moved.length + " open tasks move. Held where they are: " + rg.held.done + " done, " + rg.held.skipped + " skipped, " + rg.held.edited + " moved by hand, " + rg.held.manual + " your own or hand-dated.",
          rg.moved.length + " otevřených prací se posune. Zůstanou: " + rg.held.done + " hotových, " + rg.held.skipped + " přeskočených, " + rg.held.edited + " ručně posunutých, " + rg.held.manual + " vlastních."), "box"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          if (!d.last || !d.first || d.first <= d.last) return patch({ err: L("The autumn frost comes after the spring one.", "Podzimní mráz přichází po jarním.") });
          var old = { l: G.climate.lastFrost, f: G.climate.firstFrost, sd: G.climate.seasonDays };
          commit(function () { G.climate.lastFrost = d.last; G.climate.firstFrost = d.first; G.climate.seasonDays = G.diff(d.last, d.first); },
            function () { G.climate.lastFrost = old.l; G.climate.firstFrost = old.f; G.climate.seasonDays = old.sd; }, L("Frost dates corrected", "Mrazy opraveny") + (rg ? L(" \u00b7 " + rg.moved.length + " tasks moved", " \u00b7 posunuto " + rg.moved.length) : ""));
        })];
      }

      if (d.kind === "container") {
        out.title = L("Add a container", "Přidat nádobu");
        B.push(field({ label: L("Name", "Název"), value: d.name, placeholder: L("Trough by the window", "Truhlík u okna"), set: function (v) { patch({ name: v, err: "" }); } }));
        B.push(chips(L("Where", "Kde"), ["windowsill", "terrace", "balcony"].map(function (w) { return chip(w, d.where === w, function () { patch({ where: w }); }); })));
        B.push(field({ label: L("Size", "Velikost"), value: d.size, placeholder: "30 l", narrow: true, set: function (v) { patch({ size: v }); } }));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Add", "Přidat"), "primary", function () {
          var nm = String(d.name || "").trim();
          if (!nm) return patch({ err: L("A container needs a name. Everything else about it is optional.", "Nádoba potřebuje název. Vše ostatní je nepovinné.") });
          var k = { id: "k-s" + (Date.now() % 100000), name: nm, where: d.where || "", size: d.size || "", pos: G.containers.length + 1, photo: false };
          commit(function () { G.containers.push(k); }, function () { G.containers.splice(G.containers.indexOf(k), 1); }, nm + L(" added", " přidána"));
        })];
      }

      if (d.kind === "bed") {
        out.title = L("Add a bed", "Přidat záhon");
        B.push(note(L("New beds join the end of their zone. The order in a zone is the adjacency the checks read.", "Nový záhon se zařadí na konec zóny. Pořadí v zóně je sousedství pro kontroly.")));
        out.foot = [closeB];
      }
      return out;
    }

    /* ── assemble ── */
    var footBar = function (bg) {
      return "position:sticky;bottom:0;margin-top:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--border);background:" + bg;
    };
    var panes = [];
    if (wide) {
      var navRows = [row({ title: tier === "pots" ? L("Pots", "Květináče") : tier === "beds" ? L("Beds", "Záhony") : L("Garden 2026", "Zahrada 2026"), sub: G.climate.label, on: page === "home", noChev: true, open: go("/garden") })];
      if (shown.tasks) navRows.push(row({ title: L("Tasks", "Práce"), sub: overdue.length ? overdue.length + L(" overdue", " po termínu") : thisWeek.length + L(" this week", " tento týden"), subTone: overdue.length ? "danger" : "",
        right: String(openT.length), on: page === "tasks", noChev: true, open: go("/garden/tasks") }));
      if (checkList.length) navRows.push(row({ title: shown.full_check ? L("Plan check", "Kontrola plánu") : L("Warnings", "Upozornění"), sub: csum.warning ? csum.warning + L(" to look at", " k prohlédnutí") : L("clean", "v pořádku"),
        subTone: csum.warning ? "warn" : "", on: page === "checks", noChev: true, open: go("/garden/season/2026/checks") }));
      if (shown.storage) navRows.push(row({ title: L("Storage", "Zásoby"), sub: G.storage.filter(function (x) { return x.remaining > 0; }).length + L(" in stock", " na skladě"), on: page === "storage", noChev: true, open: go("/garden/storage") }));
      if (shown.seasons) navRows.push(row({ title: L("Seasons", "Sezóny"), sub: L("close 2026 \u00b7 plan 2027", "uzavřít 2026 \u00b7 plán 2027"), on: page === "seasons" || page === "dryrun" || page === "close", noChev: true, open: go("/garden/season") }));
      var navRows2 = [row({ title: L("Crop catalog", "Katalog plodin"), sub: G.crops.length + L(" crops", " plodin"), on: page === "catalog" || page === "crop", noChev: true, open: go("/garden/catalog") }),
        row({ title: L("Your overrides", "Vaše úpravy"), sub: G.overrides.length + L(" fields", " hodnot"), on: page === "overrides", noChev: true, open: go("/garden/catalog/overrides") })];
      if (shown.tasks) navRows2.push(row({ title: L("Print", "Tisk"), sub: L("month \u00b7 season plan", "měsíc \u00b7 plán"), on: page === "printWork" || page === "printPlan", noChev: true, open: go("/garden/print/work?month=2026-09") }));
      navRows2.push(row({ title: L("Settings", "Nastavení"), sub: tierName[tier], on: page === "settings" || page === "setup", noChev: true, open: go("/garden/settings") }));
      var navTop = canC && shown.plantings ? [acts([btn(L("+ Planting", "+ Výsadba"), "primary", open(plantingDraft(null, page === "bed" ? id : null)))])] : canC && tier === "pots" ? [acts([btn(L("+ Container", "+ Nádoba"), "primary", open({ kind: "container", name: "", where: "", size: "" }))])] : [];
      panes.push({ key: "nav", role: "navigation", title: L("Garden", "Zahrada"),
        outer: "flex:0 0 " + (web ? "300px" : "36%") + ";min-width:0;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--border);background:var(--surface)",
        inner: "flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column", col: "display:flex;flex-direction:column;padding-bottom:24px",
        onOuter: function () {}, hasHead: false, sub: "", hasFoot: false, foot: [], footNote: "", footStyle: "",
        blocks: navTop.filter(Boolean).concat([label(L("Garden", "Zahrada")), rows(navRows), label(L("Reference", "Příručka")), rows(navRows2)]) });
    }
    panes.push({ key: "main", role: "region", title: headTitle,
      outer: "flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--surface)",
      inner: "flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column",
      col: "display:flex;flex-direction:column;flex:1 0 auto;width:100%;max-width:" + (wide ? "780px" : "none") + ";padding-bottom:" + (foot.length ? "0" : "32px"),
      onOuter: function () {}, hasHead: false, sub: "", blocks: P, hasFoot: foot.length > 0, foot: foot, footNote: "", footStyle: footBar("var(--surface-raised)") });

    if (sheetD) {
      var sh = safe(function () { return sheetBody(sheetD); }, null);
      if (sh) panes.push({ key: "sheet", role: "dialog", title: sh.title,
        outer: "position:absolute;inset:0;z-index:20;background:rgba(12,14,20,0.5);display:flex;justify-content:center;align-items:" + (web ? "center" : "flex-end"),
        onOuter: function (e) { if (e.target === e.currentTarget) closeSheet(); },
        inner: "width:100%;max-width:560px;max-height:" + (web ? "88%" : "92%") + ";overflow-y:auto;display:flex;flex-direction:column;background:var(--surface-overlay);box-shadow:var(--shadow-2);border-radius:" + (web ? "14px" : "16px 16px 0 0"),
        col: "display:flex;flex-direction:column;flex:1 0 auto;padding-top:4px", hasHead: true, grab: !web, sub: sh.sub || "", blocks: sh.blocks.filter(Boolean),
        hasFoot: !!(sh.foot && sh.foot.length), foot: (sh.foot || []).filter(Boolean), footNote: sh.footNote || "", footStyle: footBar("var(--surface-overlay)") });
    }

    var top = page === "home" || (wide && (page === "tasks" || page === "checks" || page === "storage" || page === "seasons" || page === "catalog" || page === "overrides" || page === "settings" || page === "printWork" || page === "printPlan"));
    var parent = page === "planting" ? "/garden/beds/" + cur.bed : page === "crop" || page === "overrides" ? "/garden/catalog" : page === "dryrun" || page === "close" ? "/garden/season"
      : page === "setup" ? "/garden/settings" : page === "printPlan" ? "/garden/season" : "/garden";
    return { panes: panes, headTitle: headTitle, headSub: headSub, sheetOpen: !!sheetD, showBack: !top,
      onBack: function () { self.setState({ gaSheet: null }); self.go(parent); } };
  }

  window.HH_GA_VIEW = view;
})();
