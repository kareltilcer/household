/* Utilities, live in the prototype shell.
   Every figure is computed by utilities.js (HH_UTILITIES) at render time, and every write in
   this file lands on the engine's own arrays — readings, payments, schedules, tariff versions,
   periods, bills, meters — so the balance, the forecast, the block and the dashboard widget all
   move together the moment something is saved. Undo reverses the same mutation.
   The block vocabulary is the one the Finance screens draw with, so both render through the
   same panes in the shell template. */
(function () {
  var KINDS = ["Hero", "Label", "Rows", "Note", "Bars", "Acts", "Field", "Chips", "Inputs", "Cards", "Steps", "Kv", "Empty"];
  var LV = ["none", "view", "contribute", "manage"];
  var MEN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MCS = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
  function safe(fn, d) { try { var v = fn(); return v == null ? d : v; } catch (e) { return d; } }

  function view(self, seg, query, hash, wide) {
    var U = window.HH_UTILITIES, F = window.HH_FIXTURES, N = window.HH_NAV;
    if (!U) return null;
    var s = self.state, L = self.chatL.bind(self), cs = s.locale === "cs", web = s.client === "web";
    var nav = N ? N.navFor(s.member, s.household) : {};
    var lvl = (nav.grants || {}).utilities || "none";
    var ro = ["read_only", "canceled", "restricted"].indexOf(s.ent) >= 0 || s.screen === "readonly";
    var canC = LV.indexOf(lvl) >= 2 && !ro, canM = LV.indexOf(lvl) >= 3 && !ro, seePrices = lvl !== "contribute";
    var me = s.member, T = U.today, M = U.money, MR = U.moneyRound, rev = s.utRev || 0;
    var name = function (id) { var m = F ? F.members.filter(function (x) { return x.id === id; })[0] : null; return m ? m.name : id; };
    var go = function (r) { return function () { self.setState({ utSheet: null }); self.go(r); }; };

    /* ── words ── */
    var day = function (iso, y) {
      if (!iso) return "\u2013";
      var p = iso.split("-");
      return cs ? (+p[2]) + ". " + MCS[+p[1] - 1] + (y === false ? "" : " " + p[0]) : (+p[2]) + " " + MEN[+p[1] - 1] + (y === false ? "" : " " + p[0]);
    };
    var span = function (a, b) { return day(a, !b || a.slice(0, 4) !== b.slice(0, 4)) + " \u2013 " + day(b); };
    var mon = function (k) { return self.fiMonth(k); };
    var unitTxt = function (u) { return u === "m3" ? "m\u00b3" : u; };
    var meterById = function (id) { return U.meters.filter(function (m) { return m.id === id; })[0]; };
    var meterFor = function (r) { return (r.meter && meterById(r.meter)) || U.meterAt(r.service, r.on); };
    var qtyM = function (milli, m) { return U.dial(milli, m.decimals) + "\u00a0" + unitTxt(m.unit); };
    var valsTxt = function (r) {
      var m = meterFor(r);
      if (m.registers.length === 1) return qtyM(r.vals[m.registers[0].key] || 0, m);
      return m.registers.map(function (g) { return g.key.toUpperCase() + " " + U.dial(r.vals[g.key] || 0, m.decimals); }).join(" \u00b7 ") + "\u00a0" + unitTxt(m.unit);
    };
    var perDayTxt = function (milli, m) { return (milli / 1000).toFixed(m.decimals ? 1 : 0).replace(".", ",") + "\u00a0" + unitTxt(m.unit) + L("/day", "/den"); };
    var srcWord = function (r) {
      return r.source === "estimated" ? L("estimate \u00b7 not priced", "odhad \u00b7 neoceňuje se") : r.source === "supplier" ? L("supplier", "dodavatel") : "";
    };
    var modeWord = { bills_only: L("I just get a bill", "Dostávám jen fakturu"), readings: L("I read the meter", "Odečítám měřidlo"), full: L("I check the annual settlement", "Kontroluji vyúčtování") };
    var modeShort = { bills_only: L("bills", "faktury"), readings: L("readings", "odečty"), full: L("full", "vše") };
    var parseNum = function (v) {
      var t = String(v == null ? "" : v).replace(/[\s\u00a0]/g, "").replace(",", ".");
      return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
    };
    var parseMoney = function (v, neg) {
      var t = String(v == null ? "" : v).replace(/[\s\u00a0]/g, "").replace(/K\u010d$/i, "").replace(",", ".").replace("\u2212", "-");
      var sign = 1;
      if (neg && t.charAt(0) === "-") { sign = -1; t = t.slice(1); }
      if (!t || !/^\d*(\.\d{0,2})?$/.test(t) || t === ".") return null;
      return sign * Math.round(parseFloat(t) * 100);
    };
    var moneyIn = function (minor) { return minor == null ? "" : (minor / 100).toFixed(2).replace(".", ","); };
    var dialIn = function (milli, m) { return (milli / 1000).toFixed(m.decimals).replace(".", ","); };

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
        subStyle: "font-size:0.75em;line-height:1.45;overflow-wrap:anywhere;color:" + (p.subTone ? inkOf(p.subTone) : "var(--text-muted)"),
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
            ? "margin:10px 16px;padding:12px 14px;border-radius:10px;background:var(--surface-sunken);color:" + (tone === "boxDanger" ? "var(--danger)" : "var(--text-primary)") +
              (tone === "boxWarn" ? ";box-shadow:inset 3px 0 0 var(--warning)" : tone === "boxDanger" ? ";box-shadow:inset 3px 0 0 var(--danger)" : "")
            : "padding:10px 16px;color:" + inkOf(tone || "muted")) });
    };
    var btn = function (lbl, kind, on, off) { return { label: lbl, style: self.docBtn(kind, off ? false : undefined), on: off ? function () {} : on, off: !!off }; };
    var acts = function (list) { return blk("Acts", { btns: list.filter(Boolean) }); };
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
      return blk("Hero", Object.assign({ kicker: "", big: "", sub: "", stats: [], onPrev: null, prevOff: false, nextOff: false }, p, {
        hasStats: !!(p.stats && p.stats.length), hasNav: false, onPrev: function () {}, onNext: function () {},
        bigStyle: "font-size:2.125em;font-weight:600;letter-spacing:-0.02em;line-height:1.15;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;color:" + inkOf(p.tone) }));
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
      var max = list.reduce(function (n, p) { return Math.max(n, p.v); }, 0) || 1;
      return blk("Bars", { rows: list.map(function (p) {
        var ink = p.est ? "var(--warning)" : p.pending ? "var(--status-offline)" : "var(--accent)";
        return { name: p.name, right: p.right, left: p.left, proj: p.proj || "",
          rightStyle: "font-family:'IBM Plex Mono',monospace;font-size:0.8125em;white-space:nowrap;color:var(--text-primary)",
          projStyle: "white-space:nowrap;color:" + (p.est ? "var(--warning)" : "var(--text-muted)"),
          fill: "position:absolute;left:0;top:0;bottom:0;border-radius:4px;width:" + Math.max(2, Math.round(p.v / max * 100)) + "%;background:" + ink +
            (p.est ? ";background-image:repeating-linear-gradient(135deg,transparent 0 4px,rgba(255,255,255,0.45) 4px 7px)" : ""),
          tick: "display:none", noOpen: !p.open, open: p.open || function () {}, cursor: p.open ? "pointer" : "default" };
      }) });
    };

    /* ── session writes ── */
    var bump = function (extra) { self.setState(Object.assign({ utRev: (self.state.utRev || 0) + 1 }, extra || {})); };
    var commit = function (doIt, undo, toast, extra) {
      doIt();
      bump(Object.assign({ utSheet: null }, extra || {}));
      if (toast) self.docToastShow(toast + (s.online ? "" : L(" \u00b7 queued on this phone", " \u00b7 čeká v telefonu")), undo ? function () {
        undo(); bump({ docToast: null });
      } : null);
    };
    var open = function (d) { return function () { self.setState({ utSheet: Object.assign({ at: self.state.route }, d) }); }; };

    /* ── the engine, read per service ── */
    var replicaFor = function (id, m, excl) {
      return U.readingsOf(id).filter(function (r) { return r !== excl && meterFor(r).id === m.id; });
    };
    var points = function (id) {
      var rs = U.readingsOf(id), out = [];
      for (var i = 1; i < rs.length; i++) {
        var a = rs[i - 1], b = rs[i];
        if (a.final && b.initial) continue;
        if (a.on === b.on) continue;
        var m = meterFor(b), d = 0;
        m.registers.forEach(function (g) {
          var x = (b.vals[g.key] || 0) - (a.vals[g.key] || 0);
          if (b.rollover && x < 0) x += Math.pow(10, m.digits) * 1000;
          d += x;
        });
        var days = U.diff(a.on, b.on) || 1;
        out.push({ from: a.on, to: b.on, days: days, usage: d, perDay: d / days, m: m,
          est: a.source === "estimated" || b.source === "estimated", pending: !!(b.queued && !s.online), roll: !!b.rollover });
      }
      return out;
    };
    var cellarLive = function () { return !s.utCellar || s.utCellar === "refused"; };
    var dueOf = function (id) { return safe(function () { return U.readingDue(id); }, null); };
    var sumOf = function (id) { return safe(function () { return U.summary(id); }, null); };

    var needsFor = function (id, withName) {
      var sv = U.svc(id), sum = sumOf(id), out = [], pre = withName ? sv.name + " \u00b7 " : "";
      if (sv.mode === "full" && sum && sum.blocked) {
        var bd = sum.blocked.date;
        out.push(row({ title: pre + L("Needs a reading for ", "Chybí stav k ") + day(bd),
          sub: sum.blocked.boundaryOf === "end" ? L("The period ended and nothing is read for the day after. Its cost is absent, not zero.", "Období skončilo a na další den chybí stav. Náklad chybí, není nulový.")
            : L("The price changed that day and the year is cut there. Nothing after it is computed.", "Ten den se měnila cena i končí rok. Nic po něm se nepočítá."),
          badge: L("blocked", "blokováno"), badgeTone: "warn",
          act: canC ? L("Add it", "Doplnit") : "", onAct: open({ kind: "reading", svc: id, on: bd, locked: true, vals: {}, source: "manual", photo: false, note: "" }),
          open: go("/utilities/" + id + "/periods") }));
      }
      if (id === "elec" && cellarLive() && canC) {
        var C = U.cellarReading;
        out.push(row({ title: pre + (me === "petr" ? L("Your reading for ", "Váš stav k ") : L("Petr\u2019s reading for ", "Petrův stav k ")) + day(C.on) + L(" was refused", " byl odmítnut"),
          sub: L("Lower than the supplier reading for 6 September. One of the two is wrong.", "Je nižší než stav od dodavatele k 6. září. Jeden z nich je špatně."),
          badge: L("refused", "odmítnuto"), badgeTone: "danger", open: open({ kind: "cellar" }) }));
      }
      if (sv.mode === "full" && sum && sum.none && canM && !sum.blocked) {
        out.push(row({ title: pre + L("No billing period covers today", "Dnešek nepokrývá žádné období"),
          sub: L("Without one there is no forecast or balance. Headroom still works.", "Bez něj není předpověď ani bilance."),
          act: L("Start one", "Založit"), onAct: open(periodDraft(id)) }));
      }
      var due = sv.mode !== "bills_only" ? dueOf(id) : null;
      if (due && due.due && (due.lateBy > 0 || U.diff(T, due.due) <= 3)) {
        out.push(row({ title: pre + L("Meter reading due ", "Odečet ") + (due.due === T ? L("today", "dnes") : day(due.due, false)),
          sub: L("Every ", "Každých ") + due.cadence + L(" days \u00b7 last read ", " dní \u00b7 naposledy ") + day(due.last, false) + (due.lateBy ? L(" \u00b7 " + due.lateBy + " days past the cadence", " \u00b7 " + due.lateBy + " dní po termínu") : ""),
          subTone: due.lateBy ? "warn" : "", act: canC ? L("Add reading", "Zapsat") : "", onAct: open(readingDraft(id)) }));
      }
      if (sv.mode === "full" && sum && sum.recommended) {
        out.push(row({ title: pre + L("Advance is short by ", "Záloha chybí ") + MR(sum.shortfall),
          sub: L("At this rate. Recommended ", "Při tomto tempu. Doporučeno ") + MR(sum.recommended) + L(" a month over the last ", " měsíčně na posledních ") + sum.remainingMonths + L(" months", " měsíců"),
          subTone: "", badge: L("short", "chybí"), badgeTone: "danger",
          act: canM ? L("Change", "Změnit") : "", onAct: open(scheduleDraft(id, sum.recommended)), open: go("/utilities/" + id + "/advances") }));
      }
      if (sv.mode === "bills_only") {
        safe(function () { return U.spend(id).unpaid; }, []).forEach(function (b) {
          out.push(row({ title: pre + L("Bill due ", "Faktura splatná ") + day(b.due, false), sub: b.from ? span(b.from, b.to) : L("Period not printed", "Období neuvedeno"),
            right: M(b.amount), tone: b.due < T ? "danger" : "", act: canC ? L("Mark paid", "Zaplaceno") : "",
            onAct: function () { commit(function () { b.paid = T; }, function () { b.paid = null; }, L("Marked paid", "Označeno jako zaplacené")); },
            open: open(billDraft(id, b)) }));
        });
      }
      if (sv.contract_end && sv.notice_days) {
        var dl = U.addDays(sv.contract_end, -sv.notice_days), left = U.diff(T, dl);
        if (left >= 0 && left <= 60) out.push(row({ title: pre + L("Notice deadline ", "Výpověď nejpozději ") + day(dl),
          sub: L("The contract ends ", "Smlouva končí ") + day(sv.contract_end) + L(" \u00b7 " + sv.notice_days + " days\u2019 notice", " \u00b7 výpovědní lhůta " + sv.notice_days + " dní"),
          right: left + L(" days", " dní"), open: open(svcDraft(id)) }));
      }
      return out;
    };

    var answer = function (id) {
      var sv = U.svc(id), sum = sumOf(id);
      if (sv.mode === "bills_only") {
        var sp = safe(function () { return U.spend(id); }, { rows: [], unpaid: [] }), lb = sp.rows[0], up = sp.unpaid[0];
        return { sub: up ? L("Bill due ", "Faktura splatná ") + day(up.due, false) : lb ? L("Last bill ", "Poslední faktura ") + day(lb.issued, false) + L(" \u00b7 paid", " \u00b7 zaplaceno") : L("No bills yet", "Zatím bez faktur"),
          subTone: up ? "warn" : "", right: lb ? MR(lb.amount) : "\u2013", rightSub: lb && lb.from && lb.to && U.diff(lb.from, lb.to) > 40 ? L("a year", "ročně") : lb ? L("a month", "měsíčně") : "" };
      }
      var pts = points(id), lp = pts[pts.length - 1];
      if (sv.mode === "readings") {
        var rs = U.readingsOf(id), last = rs[rs.length - 1];
        return { sub: last ? L("Last read ", "Naposledy ") + day(last.on, false) : L("No readings yet", "Zatím bez odečtu"), right: lp ? perDayTxt(lp.perDay, lp.m) : "\u2013", rightSub: lp ? L("last stretch", "poslední úsek") : "" };
      }
      if (sum && sum.balance != null) return { sub: sum.balance < 0 ? L("Short at this rate", "Při tomto tempu chybí") : L("Ahead at this rate", "Při tomto tempu napřed"),
        right: (sum.balance > 0 ? "+" : "") + MR(sum.balance), tone: sum.balance < 0 ? "danger" : "", rightSub: L("this period", "toto období") };
      if (sum && sum.blocked) return { sub: L("Needs a reading for ", "Chybí stav k ") + day(sum.blocked.date), subTone: "warn",
        right: sum.headroom ? "\u2248\u00a0" + U.approxUnits(sum.headroom.atMix) + "\u00a0" + unitTxt(sum.headroom.unit) : "\u2013", rightSub: sum.headroom ? L("a month on the advance", "měsíčně za zálohu") : "" };
      if (!U.tariffsOf(id).length) return { sub: L("No prices yet", "Zatím bez cen"), right: lp ? perDayTxt(lp.perDay, lp.m) : "\u2013" };
      return { sub: sum && sum.forecast && !sum.forecast.ok ? L("Not enough readings to forecast", "Na předpověď chybí odečty") : "", right: "\u2013" };
    };

    /* ── drafts ── */
    function readingDraft(id, on) { return { kind: "reading", svc: id, on: on || T, locked: false, vals: {}, source: "manual", photo: false, note: "" }; }
    function scheduleDraft(id, amt) {
      var cur = U.scheduleAt(id, T), nk = U.monthKey(U.addDays(T.slice(0, 8) + "01", 32));
      return { kind: "schedule", svc: id, amount: moneyIn(amt || (cur ? cur.amount : 0)), dayOf: String(cur ? cur.day : 15), from: nk };
    }
    function periodDraft(id) {
      var ps = U.periodsOf(id), last = ps[ps.length - 1], from = last ? U.addDays(last.to, 1) : T;
      return { kind: "period", svc: id, from: from, to: U.addDays(String(+from.slice(0, 4) + 1) + from.slice(4), -1), estimated: !last || last.estimatedEnd };
    }
    function billDraft(id, b) {
      if (b) return { kind: "bill", svc: id, edit: b, amount: moneyIn(b.amount), from: b.from || "", to: b.to || "", issued: b.issued, due: b.due, paid: !!b.paid, paidOn: b.paid || T };
      var last = U.billsOf(id)[0], from = last && last.to ? U.addDays(last.to, 1) : T.slice(0, 8) + "01";
      var len = last && last.from && last.to ? U.diff(last.from, last.to) : 29;
      return { kind: "bill", svc: id, edit: null, amount: last ? moneyIn(last.amount) : "", from: from, to: U.addDays(from, len), issued: T, due: U.addDays(T, 14), paid: false, paidOn: T };
    }
    function svcDraft(id) {
      var sv = U.svc(id);
      return { kind: "svc", svc: id, supplier: sv.supplier || "", account: sv.account || "", end: sv.contract_end || "", notice: String(sv.notice_days || 0), cadence: sv.cadence ? String(sv.cadence) : "", rday: sv.readingDay ? String(sv.readingDay) : "" };
    }

    /* ── route ── */
    var a = seg[1] || "", b = seg[2] || "", c = seg[3] || "";
    var q = {}; String(query || "").split("&").forEach(function (kvp) { var p = kvp.split("="); if (p[0]) q[p[0]] = decodeURIComponent(p[1] || ""); });
    var page = "overview", id = null, sv = null;
    if (a === "setup") page = "setup";
    else if (a && U.svc(a)) { id = a; sv = U.svc(a); page = b || "detail"; }
    else if (a) page = "missing";
    var ALLOW = { full: ["detail", "readings", "consumption", "tariff", "advances", "periods", "meters", "mode"],
      readings: ["detail", "readings", "consumption", "meters", "mode"], bills_only: ["detail", "bills", "mode"] };
    var outOfMode = sv && ALLOW[sv.mode].indexOf(page) < 0 && ["readings", "consumption", "tariff", "advances", "periods", "meters", "mode", "bills", "detail"].indexOf(page) >= 0;
    if (sv && ["detail", "readings", "consumption", "tariff", "advances", "periods", "meters", "mode", "bills"].indexOf(page) < 0) page = "missing";
    var svcRoot = id ? "/utilities/" + id : "/utilities";

    /* route-owned sheets */
    var routeSheet = null;
    if (id && page === "readings" && c === "new" && canC && !outOfMode) {
      routeSheet = q.on ? { kind: "reading", svc: id, on: q.on, locked: true, vals: {}, source: "manual", photo: false, note: "", back: svcRoot }
        : Object.assign(readingDraft(id), { back: svcRoot + "/readings" });
    }
    if (id && page === "meters" && c === "replace" && canM && !outOfMode) routeSheet = { kind: "replace", svc: id, on: T, fin: {}, init: {}, serial: "", back: svcRoot + "/meters" };
    if (id && page === "detail" && hash === "headroom") routeSheet = { kind: "headroom", svc: id, back: svcRoot };
    var sheetD = (s.utSheet && s.utSheet.at === s.route) ? s.utSheet : routeSheet;
    var patch = function (p) { self.setState({ utSheet: Object.assign({}, sheetD, { at: self.state.route }, p) }); };
    var closeSheet = function () { var back = sheetD && sheetD.back; self.setState(Object.assign({ utSheet: null }, back ? { route: back } : {})); };

    var P = [], foot = [], headTitle = L("Utilities", "Energie a služby"), headSub = "";
    if (ro) P.push(note(L("Read-only while the subscription is past due. Every figure is here; adding a reading is not.", "Jen ke čtení, dokud není předplatné uhrazeno. Čísla tu jsou, zapisovat nelze."), "boxWarn"));
    else if (lvl === "view") P.push(note(L("You can see Utilities. Adding a reading needs contribute.", "Energie vidíte. Zapisovat stavy lze s oprávněním přispívat."), "box"));
    if (!s.online) P.push(note(L("Offline. Every figure here is worked out on this phone from synced readings and prices, so it is the same screen. Anything you record waits for signal.",
      "Offline. Všechna čísla se počítají v telefonu, takže obrazovka je stejná. Co zapíšete, odejde se signálem."), "offline"));

    var svcRows = function (sel) {
      return U.services.map(function (x) {
        var an = answer(x.id), nN = needsFor(x.id).length;
        return row({ title: x.name, sub: x.supplier + " \u00b7 " + (an.sub || modeShort[x.mode]), subTone: an.subTone || "",
          right: an.right, rightSub: an.rightSub || "", tone: an.tone || "", badge: nN ? String(nN) : "", badgeTone: nN ? "warn" : "",
          on: wide && sel === x.id, noChev: wide, open: go("/utilities/" + x.id) });
      });
    };
    var readingRow = function (r, withPrev) {
      var m = meterFor(r), badges = [];
      var flags = [srcWord(r), r.photo ? L("photo", "foto") : "", r.rollover ? L("rolled over", "přetočeno") : "", r.final ? L("final \u00b7 old meter", "konečný \u00b7 staré") : "", r.initial ? L("first \u00b7 new meter", "počáteční \u00b7 nové") : "", r.queued && !s.online ? L("queued", "čeká") : ""].filter(Boolean);
      return row({ title: day(r.on), sub: flags.join(" \u00b7 ") + (flags.length && r.by ? " \u00b7 " : "") + (r.by ? name(r.by) : ""),
        right: valsTxt(r), muted: r.source === "estimated", badge: r.queued && !s.online ? L("pending", "čeká") : "", badgeTone: "offline",
        open: open({ kind: "rview", svc: r.service, ref: r }) });
    };

    /* ── overview ── */
    if (page === "overview") {
      headSub = U.services.length + L(" services", " služeb");
      if (s.screen === "empty") {
        P.push(empty(L("No services yet.", "Zatím žádné služby."), L("Most households start with electricity: a supplier, an advance and one meter reading.", "Většina domácností začne elektřinou: dodavatel, záloha a jeden stav měřidla."),
          canM ? L("Add the first service", "Přidat první službu") : "", go("/utilities/setup/1")));
      } else {
        var needs = [];
        U.services.forEach(function (x) { needs = needs.concat(needsFor(x.id, true)); });
        P.push(label(L("Needs you", "Čeká na vás")));
        P.push(needs.length ? rows(needs) : note(L("Nothing is waiting for you.", "Nic na vás nečeká.")));
        if (!wide) { P.push(label(L("Services", "Služby"))); P.push(rows(svcRows(null))); }
        var coming = [];
        U.services.forEach(function (x) {
          if (x.mode !== "bills_only") { var d = dueOf(x.id); if (d && d.due) coming.push({ on: d.due, t: x.name + L(" \u00b7 meter reading", " \u00b7 odečet"), sub: d.from === "reading day" ? L("the household\u2019s reading day", "odečtový den domácnosti") : L("last reading + " + d.cadence + " days", "poslední odečet + " + d.cadence + " dní"), id: x.id }); }
          var p = safe(function () { return U.currentPeriod(x.id); }, null);
          if (x.mode === "full" && p) {
            var nx = U.advanceRows(p).filter(function (r) { return !r.paid && r.due >= T; })[0];
            if (nx) coming.push({ on: nx.due, t: x.name + L(" \u00b7 advance", " \u00b7 záloha"), sub: mon(nx.month), right: MR(nx.amount), id: x.id, adv: true });
          }
        });
        coming.sort(function (p1, p2) { return p1.on < p2.on ? -1 : 1; });
        if (coming.length) {
          P.push(label(L("Coming up", "Brzy")));
          P.push(rows(coming.slice(0, 6).map(function (x) { return row({ lead: "", title: x.t, sub: day(x.on, false) + " \u00b7 " + x.sub, right: x.right || "", open: go("/utilities/" + x.id + (x.adv ? "/advances" : "")) }); })));
        }
        if (!wide && canM) P.push(acts([btn(L("Set up another service", "Nastavit další službu"), "", go("/utilities/setup/1"))]));
      }
    }

    /* ── setup ── */
    if (page === "setup") {
      var st = s.utSetup || { i: Math.max(0, Math.min(3, (+b || 1) - 1)), picked: (U.setup[0].picked || []).slice(), modes: {}, preset: "cz-elec-2t", advance: "", reading: "" };
      var setSt = function (p) { self.setState({ utSetup: Object.assign({}, st, p) }); };
      var stepN = st.i, def = U.setup[stepN];
      headTitle = L("Set up Utilities", "Nastavení energií"); headSub = L("Step ", "Krok ") + (stepN + 1) + L(" of 4", " ze 4");
      P.push(steps([L("What you pay for", "Za co platíte"), L("How much detail", "Jak podrobně"), L("Your bill", "Vaše faktura"), L("What you know", "Co víte")], stepN));
      P.push(label(def.title));
      P.push(note(def.body));
      if (stepN === 0) {
        P.push(chips("", def.options.map(function (o) {
          var on = st.picked.indexOf(o) >= 0;
          return chip((on ? "\u2713 " : "") + o, on, function () { setSt({ picked: on ? st.picked.filter(function (y) { return y !== o; }) : st.picked.concat([o]) }); });
        }), L("Ordered by the household\u2019s country, Czechia.", "Seřazeno podle země domácnosti, Česko.")));
      }
      if (stepN === 1) {
        st.picked.forEach(function (o) {
          var ex = U.services.filter(function (x) { return x.name === o; })[0];
          var noMeter = /Internet|Odpad/.test(o);
          var cur = st.modes[o] || (ex ? ex.mode : noMeter ? "bills_only" : "readings");
          P.push(chips(o, U.modes.filter(function (m) { return !noMeter || m.key === "bills_only"; }).map(function (m) {
            return chip(m.plain, cur === m.key, function () { var mm = Object.assign({}, st.modes); mm[o] = m.key; setSt({ modes: mm }); });
          }), U.modeOf(cur).gets));
        });
      }
      if (stepN === 2) {
        P.push(cards(U.presets.filter(function (p) { return p.country === "CZ" || p.country === "*"; }).map(function (p) {
          return { title: p.label, sub: p.skeleton.length ? p.skeleton.length + L(" lines, in the order the bill prints them", " řádků v pořadí jako na faktuře") : L("Every line yours to add", "Všechny řádky přidáte sami"),
            meta: "v" + p.v + (p.conversion ? L(" \u00b7 with a unit conversion", " \u00b7 s přepočtem jednotek") : ""), style: cardStyle(st.preset === p.id), pick: function () { setSt({ preset: p.id }); } };
        })));
      }
      if (stepN === 3) {
        P.push(field({ label: L("Monthly advance", "Měsíční záloha"), mode: "decimal", value: st.advance, suffix: "K\u010d", narrow: true, placeholder: "3 300,00", set: function (v) { setSt({ advance: v }); },
          hint: L("With only this and the prices, the module can already say what the advance buys.", "Jen z toho a z cen modul spočítá, co záloha koupí.") }));
        P.push(field({ label: L("Today\u2019s meter reading", "Dnešní stav měřidla"), mode: "decimal", value: st.reading, suffix: "kWh", narrow: true, set: function (v) { setSt({ reading: v }); },
          hint: L("One reading is a starting point. Two are a consumption figure.", "Jeden stav je začátek. Dva jsou spotřeba.") }));
      }
      var finish = function () { self.setState({ utSetup: null, route: "/utilities" }); if (window.HH_OB) window.HH_OB.mark(self, "utilities"); self.docToastShow(L("Setup saved. Nothing already recorded was changed.", "Nastavení uloženo. Nic zapsaného se nezměnilo.")); };
      foot = [btn(L("Back", "Zpět"), "", stepN ? function () { setSt({ i: stepN - 1 }); } : go("/utilities")),
        stepN < 3 ? btn(L("Skip", "Přeskočit"), "", function () { setSt({ i: stepN + 1 }); }) : null,
        btn(stepN === 3 ? L("Finish", "Dokončit") : L("Next", "Další"), "primary", stepN === 3 ? finish : function () { setSt({ i: stepN + 1 }); }, stepN === 0 && !st.picked.length)].filter(Boolean);
      if (!canM) { P = [note(L("Setting up a service needs manage on Utilities.", "Nastavení služby vyžaduje správu energií."), "box")]; foot = []; }
    }

    /* ── one service ── */
    var sum = id ? sumOf(id) : null;
    var m0 = id && sv.mode !== "bills_only" ? U.meterAt(id, T) : null;
    var sectionRows = function () {
      var r = [];
      var add = function (key, t, sub, route) { if (ALLOW[sv.mode].indexOf(key) >= 0) r.push(row({ title: t, sub: sub, open: go(route) })); };
      var rsN = U.readingsOf(id).length;
      add("readings", L("Readings", "Stavy měřidla"), rsN + L(" readings", " stavů"), svcRoot + "/readings");
      add("consumption", L("Consumption", "Spotřeba"), L("Per stretch, estimates marked", "Po úsecích, odhady označené"), svcRoot + "/consumption");
      if (seePrices) add("tariff", L("Prices", "Ceny"), U.tariffsOf(id).length + L(" versions", " verzí"), svcRoot + "/tariff");
      if (sv.mode === "full") { var scA = U.scheduleAt(id, T); add("advances", L("Advances", "Zálohy"), scA ? MR(scA.amount) + L(" on the " + scA.day + "th", " k " + scA.day + ". dni") : L("No schedule", "Bez rozpisu"), svcRoot + "/advances"); }
      add("periods", L("Billing periods", "Zúčtovací období"), U.periodsOf(id).length + L(" periods", " období"), svcRoot + "/periods");
      add("bills", L("Bills", "Faktury"), U.billsOf(id).length + L(" bills", " faktur"), svcRoot + "/bills");
      add("meters", L("Meter", "Měřidlo"), m0 ? m0.serial + " \u00b7 " + m0.location : "", svcRoot + "/meters");
      add("mode", L("How much detail", "Jak podrobně"), modeWord[sv.mode], svcRoot + "/mode");
      r.push(row({ title: L("Contract and details", "Smlouva a údaje"), sub: sv.supplier + (sv.account ? " \u00b7 " + sv.account : ""), open: open(svcDraft(id)) }));
      return r;
    };

    if (id && outOfMode && page !== "detail") {
      headTitle = sv.name; headSub = sv.supplier;
      P.push(empty(L("Not part of how this service is kept.", "Tato služba se takto nevede."),
        L("It is kept as \u201c" + modeWord[sv.mode] + "\u201d. Changing that adds the screens and keeps everything recorded.", "Vede se jako „" + modeWord[sv.mode] + "“. Změna přidá obrazovky a nic neztratí."),
        L("How much detail", "Jak podrobně"), go(svcRoot + "/mode")));
    } else if (id && page === "detail") {
      headTitle = sv.name; headSub = sv.supplier + " \u00b7 " + sv.place;
      var needsS = needsFor(id);
      if (sv.mode === "full") {
        var hr = sum && sum.headroom;
        if (sum && sum.balance != null) {
          var f = sum.forecast;
          P.push(hero({ kicker: span(sum.period.from, sum.period.to) + L(" \u00b7 at this rate", " \u00b7 při tomto tempu"), big: (sum.balance > 0 ? "+" : "") + M(sum.balance), tone: sum.balance < 0 ? "danger" : "",
            sub: sum.balance < 0 ? L("Short: advances of ", "Chybí: zálohy ") + M(sum.advancesAll) + L(" against a forecast of ", " proti předpovědi ") + M(sum.cost) + "."
              : L("Ahead: advances of ", "Napřed: zálohy ") + M(sum.advancesAll) + L(" against a forecast of ", " proti předpovědi ") + M(sum.cost) + ".",
            stats: [stat(L("Priced so far", "Oceněno"), M(sum.run.priced), sum.run.intervals.length + L(" stretches to ", " úseků do ") + day(f.boundary, false)),
              stat(L("Projected", "Předpověď"), M(f.projected || 0), (f.future || 0) + L(" days after the last reading", " dní po posledním odečtu")),
              sum.recommended ? stat(L("Recommended advance", "Doporučená záloha"), MR(sum.recommended), L("now ", "nyní ") + MR(U.scheduleAt(id, T).amount), "warn")
                : stat(L("Advance", "Záloha"), MR(U.scheduleAt(id, T) ? U.scheduleAt(id, T).amount : 0), L("a month", "měsíčně"))] }));
        } else if (hr) {
          P.push(hero({ kicker: L("What your advance buys", "Co za zálohu koupíte"), big: "\u2248\u00a0" + U.approxUnits(hr.atMix) + "\u00a0" + unitTxt(hr.unit) + L(" a month", " měsíčně"),
            sub: L("Your advance is ", "Záloha je ") + M(hr.advance) + L(". " + M(hr.fixed) + " of it is fixed charges; " + M(hr.buys) + " is left for energy.", ". " + M(hr.fixed) + " jsou pevné platby; " + M(hr.buys) + " zbývá na energii."),
            stats: [stat(L("Advance", "Záloha"), MR(hr.advance)), stat(L("Fixed charges", "Pevné platby"), MR(hr.fixed)), stat(L("Left for energy", "Na energii"), MR(hr.buys))] }));
          P.push(acts([btn(L("How this is worked out", "Jak se to počítá"), "", open({ kind: "headroom", svc: id }))]));
          if (sum && sum.blocked) P.push(note(L("There is no balance or forecast for this period: ", "Pro toto období není bilance ani předpověď: ") + sum.blocked.why + L(" Headroom needs no readings, so it is shown instead.", " Kapacita zálohy odečty nepotřebuje, proto je tu místo nich."), "boxWarn"));
        } else if (!U.tariffsOf(id).length) {
          P.push(empty(L("No prices yet.", "Zatím bez cen."), L("Type them off your bill, one line per line, and this screen starts answering.", "Opište je z faktury, řádek po řádku, a obrazovka začne odpovídat."),
            canM ? L("Add prices", "Přidat ceny") : "", go(svcRoot + "/tariff")));
        }
        P.push(label(L("Needs you", "Čeká na vás")));
        P.push(needsS.length ? rows(needsS) : note(L("Nothing is waiting for you.", "Nic na vás nečeká.")));
      }
      if (sv.mode === "readings") {
        var rsG = U.readingsOf(id), lastG = rsG[rsG.length - 1], ptsG = points(id), lpG = ptsG[ptsG.length - 1];
        var yr = rsG.filter(function (r) { return r.on.slice(0, 4) === T.slice(0, 4); });
        var ytd = yr.length > 1 ? yr[yr.length - 1].vals.total - yr[0].vals.total : null;
        var dG = dueOf(id);
        P.push(hero({ kicker: lastG ? L("Last reading \u00b7 ", "Poslední stav \u00b7 ") + day(lastG.on) : L("No readings yet", "Zatím bez odečtu"), big: lastG ? valsTxt(lastG) : "\u2013",
          sub: lpG ? L("About ", "Zhruba ") + perDayTxt(lpG.perDay, lpG.m) + L(" since ", " od ") + day(lpG.from, false) + "." : L("One reading is a number; two are a consumption figure.", "Jeden stav je číslo; dva jsou spotřeba."),
          stats: [ytd != null ? stat(L("Used this year", "Letos"), qtyM(ytd, m0), L("since ", "od ") + day(yr[0].on, false)) : null,
            stat(L("Readings", "Stavů"), String(rsG.length)), dG ? stat(L("Next reading", "Další odečet"), day(dG.due, false), L("every ", "každých ") + dG.cadence + L(" days", " dní")) : null].filter(Boolean) }));
        if (needsS.length) { P.push(label(L("Needs you", "Čeká na vás"))); P.push(rows(needsS)); }
        if (canM) P.push(note(L("No prices here, because nobody bills this meter. If you want to know what it costs, add prices; the readings stay as they are.", "Bez cen, protože toto měřidlo nikdo nefakturuje. Chcete-li znát náklad, přidejte ceny; stavy zůstanou."), "box", L("Add prices", "Přidat ceny"), go(svcRoot + "/mode")));
      }
      if (sv.mode === "bills_only") {
        var sp = U.spend(id), lb = sp.rows[0], yNow = T.slice(0, 4), yPrev = String(+yNow - 1);
        P.push(hero({ kicker: lb ? L("Last bill \u00b7 ", "Poslední faktura \u00b7 ") + day(lb.issued) : L("No bills yet", "Zatím bez faktur"), big: lb ? M(lb.amount) : "\u2013",
          sub: lb ? (lb.from ? span(lb.from, lb.to) : L("Period not printed on it", "Období na ní není")) + " \u00b7 " + (lb.paid ? L("paid ", "zaplaceno ") + day(lb.paid, false) : L("due ", "splatná ") + day(lb.due, false)) : "",
          stats: [stat(yNow, MR(sp.byYear[yNow] || 0), L("so far", "zatím")), sp.byYear[yPrev] ? stat(yPrev, MR(sp.byYear[yPrev])) : null,
            sp.changes.length ? stat(L("Last price change", "Poslední změna ceny"), (sp.changes[sp.changes.length - 1].pct > 0 ? "+" : "") + String(sp.changes[sp.changes.length - 1].pct).replace(".", ",") + " %", day(sp.changes[sp.changes.length - 1].on), "warn") : null].filter(Boolean) }));
        if (needsS.length) { P.push(label(L("Needs you", "Čeká na vás"))); P.push(rows(needsS)); }
        if (sv.contract_end && sv.contract_end < T) P.push(note(L("The fixed term ended ", "Pevné období skončilo ") + day(sv.contract_end) + L(". The contract runs on at whatever the supplier charges now.", ". Smlouva běží dál za aktuální cenu dodavatele."), "boxWarn"));
        P.push(label(L("Bills", "Faktury"), L("All bills", "Všechny faktury"), go(svcRoot + "/bills")));
        P.push(rows(sp.rows.slice(0, 4).map(function (x) {
          return row({ title: x.from ? span(x.from, x.to) : day(x.issued), sub: x.paid ? L("paid ", "zaplaceno ") + day(x.paid, false) : L("due ", "splatná ") + day(x.due, false), subTone: x.paid ? "" : "warn", right: M(x.amount), open: open(billDraft(id, x)) });
        })));
        if (canC) P.push(acts([btn(L("+ Bill", "+ Faktura"), "primary", open(billDraft(id)))]));
      }
      if (sv.mode !== "bills_only") {
        var rsD = U.readingsOf(id).slice().reverse();
        P.push(label(L("Readings", "Stavy měřidla"), L("All readings", "Všechny stavy"), go(svcRoot + "/readings")));
        P.push(rows(rsD.slice(0, 3).map(function (r) { return readingRow(r); })));
        if (canC) P.push(acts([btn(L("+ Reading", "+ Stav"), "primary", open(readingDraft(id)))]));
        var ptsD = points(id).slice(-6);
        if (ptsD.length) {
          P.push(label(L("Consumption per day", "Spotřeba za den"), L("Chart", "Graf"), go(svcRoot + "/consumption")));
          P.push(bars(ptsD.map(function (p) { return { name: span(p.from, p.to), v: p.perDay, est: p.est, pending: p.pending, right: perDayTxt(p.perDay, p.m), left: qtyM(p.usage, p.m) + L(" over ", " za ") + p.days + L(" days", " dní"), proj: p.est ? L("estimate \u00b7 not priced", "odhad \u00b7 neoceňuje se") : "" }; })));
        }
      }
      if (sv.mode === "full" && sum && sum.period) {
        var fc = sum.forecast;
        P.push(label(L("This period", "Toto období"), L("All periods", "Všechna období"), go(svcRoot + "/periods")));
        P.push(kv([[L("Period", "Období"), span(sum.period.from, sum.period.to)],
          [L("Months counted", "Počítaných měsíců"), sum.months + L(" \u00b7 a month counts if the period holds its first day", " \u00b7 měsíc se počítá, když období obsahuje jeho první den")],
          [L("Priced so far", "Oceněno"), sum.blocked ? L("Absent \u2014 ", "Chybí \u2014 ") + sum.blocked.says : M(sum.run.priced)],
          [L("Forecast", "Předpověď"), fc && fc.ok ? M(fc.cost) + " \u00b7 " + L("facts to ", "fakta do ") + day(fc.boundary, false) : L("Not enough information", "Málo informací") + (fc && fc.missing ? " \u2014 " + fc.missing : "")],
          [L("Advances in the period", "Zálohy v období"), M(sum.advancesAll) + " \u00b7 " + M(sum.advances) + L(" due so far", " dosud splatných")],
          sum.run.estimatedRows ? [L("Estimated readings", "Odhadnuté stavy"), sum.run.estimatedRows + L(" \u00b7 used in money: ", " \u00b7 v penězích: ") + sum.run.estimatedInMoney] : null]));
      }
      P.push(label(L("More about ", "Více o ") + sv.name));
      P.push(rows(sectionRows()));
    }

    /* readings */
    if (id && page === "readings" && !outOfMode) {
      headTitle = L("Readings", "Stavy měřidla"); headSub = sv.name;
      if (canC) P.push(acts([btn(L("+ Reading", "+ Stav"), "primary", open(readingDraft(id)))]));
      if (id === "elec" && cellarLive() && canC) P.push(note(L("One reading was refused and is not in the list: 9 September, ", "Jeden stav byl odmítnut a v seznamu není: 9. září, ") + valsTxt(U.cellarReading) + L(". It is lower than the supplier row for 6 September.", ". Je nižší než řádek od dodavatele k 6. září."), "boxDanger", L("Resolve it", "Vyřešit"), open({ kind: "cellar" })));
      var rsAll = U.readingsOf(id).slice().reverse();
      if (!rsAll.length) P.push(empty(L("No readings yet.", "Zatím žádné stavy."), L("The first one is just a number off the dial.", "První je jen číslo z číselníku."), canC ? L("Add a reading", "Zapsat stav") : "", open(readingDraft(id))));
      var years = [];
      rsAll.forEach(function (r) { var y = r.on.slice(0, 4); if (years.indexOf(y) < 0) years.push(y); });
      years.forEach(function (y) {
        P.push(label(y));
        P.push(rows(rsAll.filter(function (r) { return r.on.slice(0, 4) === y; }).map(function (r) { return readingRow(r); })));
      });
      if (rsAll.some(function (r) { return r.source === "estimated"; })) P.push(note(L("Estimates are drawn on the chart and never priced. Money only uses readings someone actually took or the supplier sent.", "Odhady se kreslí do grafu, ale neoceňují se. Peníze používají jen skutečné odečty nebo stavy od dodavatele.")));
    }

    /* consumption */
    if (id && page === "consumption" && !outOfMode) {
      headTitle = L("Consumption", "Spotřeba"); headSub = sv.name;
      var ptsC = points(id);
      if (!ptsC.length) P.push(empty(L("Nothing to draw yet.", "Zatím není co kreslit."), L("Two readings make one bar.", "Dva stavy dají jeden sloupec."), canC ? L("Add a reading", "Zapsat stav") : "", open(readingDraft(id))));
      else {
        var avg = ptsC.filter(function (p) { return !p.est; }), tot = avg.reduce(function (n, p) { return n + p.usage; }, 0), dd = avg.reduce(function (n, p) { return n + p.days; }, 0);
        P.push(hero({ kicker: L("Average across measured stretches", "Průměr za měřené úseky"), big: dd ? perDayTxt(tot / dd, ptsC[0].m) : "\u2013",
          sub: avg.length + L(" stretches from ", " úseků od ") + day(ptsC[0].from) + (ptsC.length > avg.length ? L(" \u00b7 " + (ptsC.length - avg.length) + " touch an estimate and are left out of it", " \u00b7 " + (ptsC.length - avg.length) + " se dotýká odhadu a nepočítá se") : "") }));
        P.push(label(L("Per stretch, newest first", "Po úsecích, nejnovější nahoře")));
        P.push(bars(ptsC.slice().reverse().slice(0, 14).map(function (p) {
          return { name: span(p.from, p.to), v: p.perDay, est: p.est, pending: p.pending, right: perDayTxt(p.perDay, p.m),
            left: qtyM(p.usage, p.m) + L(" over ", " za ") + p.days + L(" days", " dní") + (p.roll ? L(" \u00b7 across a rollover", " \u00b7 přes přetočení") : ""), proj: p.est ? L("estimate \u00b7 drawn, never priced", "odhad \u00b7 kreslí se, neoceňuje") : p.pending ? L("queued", "čeká") : "" };
        })));
        if (sv.mode === "full") {
          var hist = safe(function () { return U.history(id); }, []);
          if (hist.length) {
            P.push(label(L("By month", "Po měsících")));
            P.push(rows(hist.slice().reverse().slice(0, 12).map(function (h) {
              return row({ title: mon(h.ym), sub: (h.approx ? "\u2248 " : "") + qtyM(h.total, m0) + (h.approx ? L(" \u00b7 approximate, a stretch crosses the month end", " \u00b7 přibližně, úsek přesahuje konec měsíce") : ""), right: (h.approx ? "\u2248 " : "") + MR(h.cost) });
            })));
          }
        }
      }
    }

    /* prices */
    if (id && page === "tariff" && !outOfMode) {
      headTitle = L("Prices", "Ceny"); headSub = sv.name + " \u00b7 " + L("type them off the bill", "opište z faktury");
      var vs = U.tariffSpans(id);
      if (!seePrices) P.push(note(L("Prices are kept by members who manage Utilities.", "Ceny spravují ti, kdo mají správu energií."), "box"));
      else if (!vs.length) {
        var pre = U.presets.filter(function (p) { return p.commodity === sv.commodity && (p.country === "CZ" || p.country === "*"); });
        P.push(empty(L("No prices yet.", "Zatím bez cen."), L("Pick the arrangement on your bill. It lays out the lines in the order the bill prints them, with empty amounts.", "Vyberte uspořádání z faktury. Vytvoří řádky v pořadí jako na faktuře, bez částek."), "", null));
        if (canM) P.push(cards(pre.map(function (p) {
          return { title: p.label, sub: p.skeleton.length + L(" lines", " řádků"), meta: "v" + p.v, style: cardStyle(false), pick: function () {
            var mU = U.meterAt(id, T), unitP = mU && mU.unit === "m3" ? "m3" : "MWh";
            var WORDS = { water: { standing_charge: "Pevná složka podle profilu vodoměru", unit_rate: ["Vodné", "Stočné"], tiered_rate: "Vodné po pásmech", tax: "DPH" },
              gas: { standing_charge: "Stálý měsíční plat", unit_rate: "Cena za dodaný plyn", per_unit_levy: "Daně a poplatky za dodaný plyn", discount: "Sleva" },
              heat: { standing_charge: "Základní složka", unit_rate: "Spotřební složka" },
              electricity: { standing_charge: "Měsíční plat za odběrné místo", capacity_charge: "Plat za jistič", unit_rate: ["Cena za elektřinu \u2014 VT", "Cena za elektřinu \u2014 NT"], per_unit_levy: "POZE", fixed_levy: "Systémové služby", tax: "DPH" } };
            var W = WORDS[sv.commodity] || {}, seen = {};
            var regs = mU ? mU.registers.map(function (g) { return g.key; }) : ["total"];
            var v = { id: id + "-s" + rev, service: id, from: T, vat: p.vat, by: me, note: L("From the preset ", "Z předvolby ") + p.label + " v" + p.v, session: true,
              components: p.skeleton.map(function (t, i) {
                var ty = U.types.filter(function (x) { return x.type === t; })[0], n = seen[t] || 0; seen[t] = n + 1;
                var w = W[t], bill = Array.isArray(w) ? (w[n] || w[w.length - 1]) : (w || (ty ? ty.plain : t));
                return { id: id + "-s" + rev + "-" + i, type: t, bill: bill, amount: 0, period: "month", per: unitP,
                  register: t === "per_unit_levy" ? "all" : (regs[n] || regs[0]), capacity: 1, capUnit: "A",
                  pct: t === "tax" ? (sv.commodity === "water" ? 1200 : 2100) : 0, applies_to: "all" };
              }) };
            v.components.forEach(function (cc) { if (cc.type === "tax") cc.bill = cc.bill + " " + String(cc.pct / 100) + " %"; });
            commit(function () { U.tariffs.push(v); }, function () { U.tariffs.splice(U.tariffs.indexOf(v), 1); }, L("Lines laid out. Fill the amounts in.", "Řádky připraveny. Doplňte částky."), { utVer: v.id });
          } };
        })));
      } else {
        var selV = vs.filter(function (x) { return x.v.id === s.utVer; })[0] || vs.filter(function (x) { return x.from <= T; }).slice(-1)[0] || vs[vs.length - 1];
        P.push(chips(L("Version", "Verze"), vs.map(function (x) { return chip(L("from ", "od ") + day(x.from), x === selV, function () { self.setState({ utVer: x.v.id }); }); })));
        var v = selV.v;
        if (id === "elec" && v.id === "e-2026" && !s.utConflict) {
          P.push(note(L("Two devices saved a different monthly charge from 1 January: 148,00 Kč from Petr\u2019s phone at 18:40, 162,00 Kč from Jana\u2019s at 18:52. A half-merged tariff is a wrong bill, so it waits for a person.",
            "Dvě zařízení uložila jiný měsíční plat od 1. ledna: 148,00 Kč z Petrova telefonu v 18:40, 162,00 Kč z Janina v 18:52. Napůl sloučený ceník je špatná faktura, proto čeká na člověka."), "boxWarn"));
          if (canM) {
            var stc = v.components.filter(function (x) { return x.type === "standing_charge"; })[0];
            P.push(acts([btn(L("Keep 162,00 Kč", "Nechat 162,00 Kč"), "primary", function () { var old = stc.amount; commit(function () { stc.amount = 16200; }, function () { stc.amount = old; }, L("Kept 162,00 Kč from 1 January", "Ponecháno 162,00 Kč od 1. ledna"), { utConflict: true }); }),
              btn(L("Use 148,00 Kč", "Použít 148,00 Kč"), "", function () { var old = stc.amount; commit(function () { stc.amount = 14800; }, function () { stc.amount = old; }, L("148,00 Kč from 1 January \u00b7 everything since recomputed", "148,00 Kč od 1. ledna \u00b7 vše přepočteno"), { utConflict: true }); }),
              btn(L("Another amount", "Jiná částka"), "", open({ kind: "line", svc: id, ver: v.id, cid: stc.id, amount: moneyIn(stc.amount), conflict: true }))]));
          }
        }
        P.push(kv([[L("In effect", "Platí"), selV.to ? span(selV.from, selV.to) : L("from ", "od ") + day(selV.from) + L(" \u00b7 until a newer version starts", " \u00b7 dokud nezačne novější")],
          [L("VAT", "DPH"), v.vat === "inclusive" ? L("included in the amounts", "v částkách") : L("added as its own line", "samostatný řádek")],
          [L("Entered by", "Zapsal(a)"), v.by ? name(v.by) : ""], [L("Note", "Poznámka"), v.note || ""]]));
        P.push(label(L("Lines, in the order on the bill", "Řádky v pořadí jako na faktuře")));
        P.push(rows(v.components.map(function (cp, i) {
          var ty = U.types.filter(function (x) { return x.type === cp.type; })[0];
          return row({ lead: String(i + 1), title: cp.bill, sub: ty ? ty.plain : cp.type, right: rateTxt(cp), tone: rateZero(cp) ? "warn" : "",
            rightSub: rateZero(cp) ? L("not filled in", "nevyplněno") : "", open: canM && editableType(cp.type) ? open({ kind: "line", svc: id, ver: v.id, cid: cp.id, amount: pctType(cp.type) ? String(Math.abs(cp.pct || 0) / 100).replace(".", ",") : moneyIn(cp.amount) }) : null });
        })));
        var st2 = stretchUnder(id, selV);
        if (st2 && !st2.blocked) {
          P.push(label(L("Priced on ", "Oceněno na ") + span(st2.from, st2.to)));
          P.push(rows(st2.lines.map(function (ln) { return row({ title: ln.bill, sub: ln.detail, right: M(ln.amount), tone: ln.amount < 0 ? "accent" : "" }); })
            .concat([row({ title: L("Total", "Celkem"), strong: true, right: M(st2.total) })])));
          P.push(note(L("Each line is rounded once, and the parts sum to the total by construction.", "Každý řádek se zaokrouhlí jednou a části dají součet.")));
        }
        if (canM) P.push(acts([btn(L("+ New price version", "+ Nová verze cen"), "primary", open({ kind: "version", svc: id, from: U.addDays(T, 1) }))]));
      }
    }

    /* advances */
    if (id && page === "advances" && !outOfMode) {
      headTitle = L("Advances", "Zálohy"); headSub = sv.name;
      var sch = U.scheduleAt(id, T), pr = U.currentPeriod(id);
      if (!sch) P.push(empty(L("No advance schedule.", "Bez rozpisu záloh."), L("Type the amount from your bill and the day it leaves your account.", "Zapište částku z faktury a den, kdy odchází z účtu."), canM ? L("Add the schedule", "Přidat rozpis") : "", open(scheduleDraft(id))));
      else {
        P.push(hero({ kicker: L("The schedule", "Rozpis"), big: M(sch.amount), sub: L("a month, due on the " + sch.day + "th \u00b7 since ", "měsíčně, splatné k " + sch.day + ". dni \u00b7 od ") + day(sch.from),
          stats: [sum && sum.balance != null ? stat(L("Balance at this rate", "Bilance při tomto tempu"), (sum.balance > 0 ? "+" : "") + MR(sum.balance), "", sum.balance < 0 ? "danger" : "") : null,
            sum && sum.recommended ? stat(L("Recommended", "Doporučeno"), MR(sum.recommended), L("over the " + sum.remainingMonths + " months still to come", "na " + sum.remainingMonths + " zbývajících měsíců"), "warn") : null].filter(Boolean) }));
        P.push(acts([canC ? btn(L("Record a payment", "Zapsat platbu"), "primary", open({ kind: "payment", svc: id, month: U.monthKey(T), amount: moneyIn(sch.amount), paidOn: T, note: "" })) : null,
          canM ? btn(L("Change the advance", "Změnit zálohu"), "", open(scheduleDraft(id, sum && sum.recommended))) : null]));
        if (pr) {
          P.push(label(span(pr.from, pr.to) + L(" \u00b7 month by month", " \u00b7 po měsících")));
          P.push(rows(U.advanceRows(pr).map(function (r) {
            var pay = U.payments.filter(function (x) { return x.service === id && x.month === r.month; })[0];
            return row({ title: mon(r.month), sub: r.paid ? L("paid ", "zaplaceno ") + day(r.paid_on, false) + (r.note ? " \u00b7 " + r.note : "") : r.elapsed ? L("scheduled \u00b7 due ", "podle rozpisu \u00b7 splatné ") + day(r.due, false) + L(" \u00b7 no payment recorded", " \u00b7 platba nezapsána") : L("due ", "splatné ") + day(r.due, false),
              subTone: !r.paid && r.elapsed ? "warn" : "", right: M(r.amount), muted: r.future && !r.paid, rightSub: r.paid && r.amount !== r.scheduled ? L("schedule ", "rozpis ") + MR(r.scheduled) : "",
              open: canC ? open(pay ? { kind: "payment", svc: id, edit: pay, month: pay.month, amount: moneyIn(pay.amount), paidOn: pay.paid_on, note: pay.note || "" } : { kind: "payment", svc: id, month: r.month, amount: moneyIn(r.scheduled), paidOn: r.due < T ? r.due : T, note: "" }) : null });
          })));
          P.push(note(L("A payment belongs to the month it is for, not the day it left. A recorded payment replaces the schedule for its month.", "Platba patří k měsíci, za který je, ne ke dni odeslání. Zapsaná platba nahrazuje rozpis pro svůj měsíc.")));
        } else P.push(note(L("No billing period covers today, so there is nothing to lay the months against.", "Dnešek nepokrývá žádné období, proto není k čemu měsíce přiřadit."), "box"));
      }
    }

    /* periods */
    if (id && page === "periods" && !outOfMode && !c) {
      headTitle = L("Billing periods", "Zúčtovací období"); headSub = sv.name;
      var ps = U.periodsOf(id).slice().reverse();
      if (!ps.length) P.push(empty(L("No billing period yet.", "Zatím žádné období."), L("A period is two dates. If the supplier has not said when it ends, a year is assumed and marked estimated.", "Období jsou dvě data. Pokud dodavatel konec neuvedl, počítá se rok a označí se jako odhad."), canM ? L("Add a period", "Přidat období") : "", open(periodDraft(id))));
      P.push(rows(ps.map(function (p) {
        var run = safe(function () { return U.periodRun(p.id); }, null), st = periodState(p, run);
        return row({ title: span(p.from, p.to), sub: st.sub, subTone: st.tone, badge: st.badge, badgeTone: st.tone, right: st.right, open: go(svcRoot + "/periods/" + p.id) });
      })));
      if (canM && ps.length) P.push(acts([btn(L("+ Period", "+ Období"), "", open(periodDraft(id)))]));
    }
    if (id && page === "periods" && !outOfMode && c) {
      var pp = U.periodOf(c) || U.periodsOf(id).filter(function (p) { return p.from.slice(0, 4) === c; })[0];
      if (!pp) P.push(empty(L("That period isn\u2019t here.", "To období tu není."), "", L("All periods", "Všechna období"), go(svcRoot + "/periods")));
      else {
        var runP = U.periodRun(pp.id), setl = U.settlement(pp.id), stP = periodState(pp, runP), mP = U.meterAt(id, pp.to);
        headTitle = pp.invoice ? L("Settlement ", "Vyúčtování ") + pp.from.slice(0, 4) : L("Period ", "Období ") + pp.from.slice(0, 4); headSub = sv.name + " \u00b7 " + span(pp.from, pp.to);
        P.push(hero({ kicker: L("Computed", "Spočteno"), big: runP.cost != null ? M(runP.cost) : "\u2013", sub: stP.sub, tone: runP.cost == null ? "muted" : "",
          stats: [stat(L("Advances", "Zálohy"), MR(runP.advancesAll), runP.months.length + L(" months counted", " počítaných měsíců")),
            pp.invoice ? stat(L("Invoiced", "Fakturováno"), M(pp.invoice.total), L("balance ", "doplatek ") + M(pp.invoice.balance)) : null,
            setl.ok && setl.moneyDelta != null ? stat(L("Apart", "Rozdíl"), M(Math.abs(setl.moneyDelta)), setl.moneyDelta > 0 ? L("they charged more", "účtovali víc") : L("they charged less", "účtovali méně"), "warn") : null].filter(Boolean) }));
        if (runP.blocked) {
          P.push(note(runP.blocked.why, "boxWarn"));
          if (canC) P.push(acts([btn(L("Add the reading for ", "Doplnit stav k ") + day(runP.blocked.date), "primary", open({ kind: "reading", svc: id, on: runP.blocked.date, locked: true, vals: {}, source: "manual", photo: false, note: "" }))]));
        }
        if (setl.ok) {
          P.push(label(L("Their meter values against ours", "Jejich stavy proti našim")));
          P.push(rows(setl.registers.map(function (r) {
            return row({ title: r.label, sub: L("theirs ", "jejich ") + qtyM(r.theirs, mP) + " \u00b7 " + L("ours ", "naše ") + (r.ours == null ? L("none for that day", "na ten den žádný") : qtyM(r.ours, mP)), right: r.delta == null ? "\u2013" : (r.delta > 0 ? "+" : "") + U.dial(r.delta, mP.decimals), tone: r.delta ? "warn" : "" });
          })));
          P.push(note(setl.says, "box"));
        } else if (pp.to < T && canC) {
          P.push(note(L("The period has ended. When the settlement arrives, type in their total, their balance and the meter values they used, so a difference can be put down to the meter or to money.", "Období skončilo. Až přijde vyúčtování, zapište celkovou částku, doplatek a jejich stavy, aby šel rozdíl přičíst měřidlu, nebo penězům."), "box"));
          P.push(acts([btn(L("Record the settlement", "Zapsat vyúčtování"), "primary", open({ kind: "invoice", pid: pp.id, svc: id, total: "", balance: "", vals: {} }))]));
        }
        if (runP.intervals.length) {
          P.push(label(L("Priced stretches", "Oceněné úseky")));
          P.push(rows(runP.intervals.map(function (iv) {
            return row({ title: span(iv.from, iv.to), sub: Object.keys(iv.usage).map(function (k) { return (Object.keys(iv.usage).length > 1 ? k.toUpperCase() + " " : "") + qtyM(iv.usage[k], iv.meter); }).join(" \u00b7 ") + " \u00b7 " + iv.version.id,
              right: M(iv.total), open: open({ kind: "stretch", svc: id, pid: pp.id, from: iv.from, to: iv.to }) });
          })));
        }
        if (runP.meterSwaps) P.push(note(L("A meter was replaced inside this period. The stretch across the swap is priced from the old meter\u2019s final reading and the new one\u2019s first.", "V tomto období se měnilo měřidlo. Úsek přes výměnu se počítá z konečného stavu starého a počátečního nového.")));
      }
    }

    /* bills */
    if (id && page === "bills" && !outOfMode) {
      headTitle = L("Bills", "Faktury"); headSub = sv.name;
      var spB = U.spend(id);
      if (canC) P.push(acts([btn(L("+ Bill", "+ Faktura"), "primary", open(billDraft(id)))]));
      if (!spB.rows.length) P.push(empty(L("No bills yet.", "Zatím žádné faktury."), L("Add the last one that arrived. Two make a comparison.", "Přidejte poslední, která přišla. Dvě už se dají porovnat."), "", null));
      else {
        P.push(label(L("By year", "Po letech")));
        P.push(rows(Object.keys(spB.byYear).sort().reverse().map(function (y) { return row({ title: y, sub: spB.rows.filter(function (x) { return (x.from || x.issued).slice(0, 4) === y; }).length + L(" bills", " faktur"), right: M(spB.byYear[y]) }); })));
        if (spB.changes.length) {
          P.push(label(L("Where the price changed", "Kde se měnila cena")));
          P.push(rows(spB.changes.map(function (ch) { return row({ title: day(ch.on), sub: M(ch.from) + " \u2192 " + M(ch.to), right: (ch.pct > 0 ? "+" : "") + String(ch.pct).replace(".", ",") + " %", tone: ch.pct > 0 ? "warn" : "" }); })));
        }
        P.push(label(L("Every bill", "Všechny faktury")));
        P.push(rows(spB.rows.map(function (x) {
          return row({ title: x.from ? span(x.from, x.to) : L("Issued ", "Vystaveno ") + day(x.issued), sub: (x.paid ? L("paid ", "zaplaceno ") + day(x.paid, false) : L("due ", "splatná ") + day(x.due, false)) + (x.note ? " \u00b7 " + x.note : ""),
            subTone: x.paid ? "" : "warn", right: M(x.amount), open: open(billDraft(id, x)) });
        })));
      }
    }

    /* meter */
    if (id && page === "meters" && !outOfMode) {
      headTitle = L("Meter", "Měřidlo"); headSub = sv.name;
      var ms = U.metersOf(id), cur = U.meterAt(id, T), conv = U.conversionAt(cur.id, T);
      P.push(kv([[L("Serial", "Výrobní číslo"), cur.serial], [L("Where it is", "Kde je"), cur.location], [L("Dial", "Číselník"), cur.digits + L(" digits, ", " míst, ") + cur.decimals + L(" decimals \u00b7 ", " desetinná \u00b7 ") + unitTxt(cur.unit)],
        [L("Registers", "Registry"), cur.registers.map(function (g) { return g.label; }).join(", ")], [L("Fitted", "Osazeno"), day(cur.from)],
        conv ? [L("Billed as", "Fakturuje se jako"), U.convSays(conv)] : null]));
      if (ms.length > 1) {
        P.push(label(L("Earlier meters", "Dřívější měřidla")));
        P.push(rows(ms.filter(function (x) { return x !== cur; }).map(function (x) { return row({ title: x.serial, sub: span(x.from, x.to || T), muted: true }); })));
        var rr = id === "gas" ? safe(function () { return U.replacementRun(); }, null) : null;
        if (rr) P.push(note(L("Across the swap the year still adds up: ", "Přes výměnu rok stále sedí: ") + rr.says + L(". Read naively as one meter it would be ", ". Jako jedno měřidlo by to bylo ") + qtyM(rr.naive, cur) + ".", "box"));
      }
      if (canM) P.push(acts([btn(L("Replace this meter", "Vyměnit měřidlo"), "", open({ kind: "replace", svc: id, on: T, fin: {}, init: {}, serial: "" }))]));
    }

    /* mode */
    if (id && page === "mode") {
      headTitle = L("How much detail", "Jak podrobně"); headSub = sv.name;
      var noMeter = sv.commodity === "internet" || sv.commodity === "waste";
      var pick = s.utMode && s.utMode.svc === id ? s.utMode.key : sv.mode;
      P.push(cards(U.modes.map(function (md) {
        var offM = noMeter && md.key !== "bills_only";
        return { title: md.plain + (md.key === sv.mode ? L(" \u00b7 now", " \u00b7 nyní") : ""), sub: offM ? L("There is no meter to read on this service.", "Tato služba nemá měřidlo.") : md.gets, meta: md.records,
          style: cardStyle(pick === md.key) + (offM ? ";opacity:0.5;cursor:not-allowed" : ""), pick: offM ? function () {} : function () { self.setState({ utMode: { svc: id, key: md.key } }); } };
      })));
      if (pick !== sv.mode) {
        var order = ["bills_only", "readings", "full"], up = order.indexOf(pick) > order.indexOf(sv.mode);
        var what = up ? (sv.mode === "bills_only" ? safe(function () { return U.upgradeRun(id).says; }, "") + " " : "") +
            L("Everything already recorded stays exactly as it is; ", "Vše zapsané zůstává, jak je; ") + (pick === "full" ? L("prices, advances and periods are added next to it.", "ceny, zálohy a období se přidají vedle.") : L("readings are added next to it.", "přidají se stavy."))
          : L("The deeper screens are hidden, not deleted. Switching back brings them back with every row.", "Hlubší obrazovky se skryjí, nesmažou. Po návratu jsou zpět se všemi řádky.");
        P.push(note(what, "box"));
        foot = [btn(L("Keep as it is", "Nechat"), "", function () { self.setState({ utMode: null }); }),
          btn(L("Switch to \u201c", "Přepnout na „") + modeWord[pick] + L("\u201d", "“"), "primary", function () {
            var old = sv.mode;
            commit(function () { sv.mode = pick; }, function () { sv.mode = old; }, sv.name + L(" is now \u201c", " je nyní „") + modeWord[pick] + L("\u201d", "“"), { utMode: null, route: svcRoot });
          }, !canM)];
        if (!canM) P.push(note(L("Changing the mode needs manage.", "Změna vyžaduje správu."), "muted"));
      }
    }

    if (page === "missing") P.push(empty(L("That page isn\u2019t in Utilities.", "Tato stránka v Energiích není."), L("It may have moved. Every service is reachable from the overview.", "Možná se přesunula. Všechny služby jsou v přehledu."), L("Open the overview", "Otevřít přehled"), go("/utilities")));

    /* ── helpers used above ── */
    function pctType(t) { return t === "tax" || t === "discount"; }
    function editableType(t) { return ["standing_charge", "capacity_charge", "unit_rate", "per_unit_levy", "fixed_levy", "feed_in", "self_consumption_credit", "tax", "discount"].indexOf(t) >= 0; }
    function rateZero(cp) { return pctType(cp.type) ? !cp.pct : editableType(cp.type) && !cp.amount; }
    function rateTxt(cp) {
      var per = { month: L("month", "měsíc"), year: L("year", "rok"), day: L("day", "den") }[cp.period] || cp.period;
      if (cp.type === "standing_charge" || cp.type === "fixed_levy") return M(cp.amount) + " / " + per;
      if (cp.type === "capacity_charge") return M(cp.amount) + " / " + cp.capUnit + " \u00d7 " + cp.capacity;
      if (cp.type === "unit_rate" || cp.type === "per_unit_levy" || cp.type === "feed_in" || cp.type === "self_consumption_credit") return M(cp.amount) + " / " + unitTxt(cp.per || "MWh");
      if (pctType(cp.type)) return (cp.type === "discount" ? "\u2212" : "") + String(Math.abs(cp.pct || 0) / 100).replace(".", ",") + " %";
      if (cp.type === "tiered_rate") return (cp.blocks || []).length + L(" blocks", " pásma");
      return L("mapping", "mapování");
    }
    function stretchUnder(sid, sp) {
      var rs = U.readingsOf(sid, { money: true }), best = null;
      for (var i = 1; i < rs.length; i++) {
        var x = rs[i - 1], y = rs[i];
        if (x.final && y.initial) continue;
        if (x.on === y.on) continue;
        if (x.on >= sp.from && (!sp.to || y.on <= U.addDays(sp.to, 1))) best = [x, y];
      }
      return best ? safe(function () { return U.priceInterval(sid, best[0], best[1], { meter: best[1].meter }); }, null) : null;
    }
    function periodState(p, run) {
      if (!run) return { sub: "", tone: "", badge: "", right: "" };
      if (run.blocked) return { sub: L("Needs a reading for ", "Chybí stav k ") + day(run.blocked.date), tone: "warn", badge: L("blocked", "blokováno"), right: "\u2013" };
      if (p.invoice) return { sub: L("Settled \u00b7 invoiced ", "Vyúčtováno \u00b7 ") + M(p.invoice.total), tone: "", badge: L("settled", "vyúčtováno"), right: run.cost != null ? M(run.cost) : "\u2013" };
      if (p.to < T) return { sub: L("Ended \u00b7 settlement not recorded", "Skončilo \u00b7 vyúčtování nezapsáno"), tone: "", badge: L("ended", "skončilo"), right: run.cost != null ? M(run.cost) : "\u2013" };
      return { sub: L("Open \u00b7 priced to ", "Běží \u00b7 oceněno do ") + (run.intervals.length ? day(run.intervals[run.intervals.length - 1].to, false) : "\u2013") + (p.estimatedEnd ? L(" \u00b7 end estimated", " \u00b7 konec odhadem") : ""), tone: "", badge: L("open", "běží"), right: M(run.priced) };
    }

    /* ── assemble ── */
    var footBar = function (bg) {
      return "position:sticky;bottom:0;margin-top:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--border);background:" + bg;
    };
    var panes = [];
    if (wide) {
      var navTop = canC ? [acts([btn(L("+ Reading", "+ Stav"), "primary", open(readingDraft(id && sv.mode !== "bills_only" ? id : "elec")))])] : [];
      panes.push({ key: "nav", role: "navigation", title: L("Services", "Služby"),
        outer: "flex:0 0 " + (web ? "320px" : "40%") + ";min-width:0;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--border);background:var(--surface)",
        inner: "flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column", col: "display:flex;flex-direction:column;padding-bottom:24px",
        onOuter: function () {}, hasHead: false, sub: "", hasFoot: false, foot: [], footNote: "", footStyle: "",
        blocks: navTop.concat([label(L("Services", "Služby"))], [rows([row({ title: L("Overview", "Přehled"), sub: L("What needs you, and what is coming up", "Co čeká a co přijde"), on: page === "overview", noChev: true, open: go("/utilities") })].concat(svcRows(id)))],
          canM ? [rows([row({ title: L("Set up another service", "Nastavit další službu"), sub: L("The four questions again", "Čtyři otázky znovu"), on: page === "setup", noChev: true, open: go("/utilities/setup/1") })])] : []) });
    }
    panes.push({ key: "main", role: "region", title: headTitle,
      outer: "flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--surface)",
      inner: "flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column",
      col: "display:flex;flex-direction:column;flex:1 0 auto;width:100%;max-width:" + (wide ? "780px" : "none") + ";padding-bottom:" + (foot.length ? "0" : "32px"),
      onOuter: function () {}, hasHead: false, sub: "", blocks: P, hasFoot: foot.length > 0, foot: foot, footNote: "", footStyle: footBar("var(--surface-raised)") });

    if (sheetD) {
      var sh = sheetBody(sheetD);
      if (sh) panes.push({ key: "sheet", role: "dialog", title: sh.title,
        outer: "position:absolute;inset:0;z-index:20;background:rgba(12,14,20,0.5);display:flex;justify-content:center;align-items:" + (web ? "center" : "flex-end"),
        onOuter: function (e) { if (e.target === e.currentTarget) closeSheet(); },
        inner: "width:100%;max-width:560px;max-height:" + (web ? "88%" : "92%") + ";overflow-y:auto;display:flex;flex-direction:column;background:var(--surface-overlay);box-shadow:var(--shadow-2);border-radius:" + (web ? "14px" : "16px 16px 0 0"),
        col: "display:flex;flex-direction:column;flex:1 0 auto;padding-top:4px", hasHead: true, grab: !web, sub: sh.sub || "", blocks: sh.blocks,
        hasFoot: !!(sh.foot && sh.foot.length), foot: sh.foot || [], footNote: sh.footNote || "", footStyle: footBar("var(--surface-overlay)") });
    }

    /* ── sheets ── */
    function sheetBody(d) {
      var out = { title: "", sub: "", blocks: [], foot: [], footNote: "" }, B = out.blocks;
      var cancel = btn(L("Cancel", "Zrušit"), "", closeSheet), closeB = btn(L("Close", "Zavřít"), "", closeSheet);
      var dsv = d.svc ? U.svc(d.svc) : null;

      if (d.kind === "reading") {
        var m = U.meterAt(d.svc, d.on && d.on >= "2000-01-01" ? d.on : T);
        out.title = d.locked ? L("A reading for ", "Stav k ") + day(d.on) : d.edit ? L("Edit the reading", "Upravit stav") : d.fromCellar ? L("Your cellar reading", "Váš stav ze sklepa") : L("Add a reading", "Zapsat stav");
        out.sub = dsv.name + " \u00b7 " + m.serial + " \u00b7 " + m.location;
        if (!canC) { B.push(note(ro ? L("Adding a reading is a write, and writes are held while the subscription is past due.", "Zápis stavu je změna a ty čekají, dokud není předplatné uhrazeno.") : L("Adding a reading needs contribute on Utilities.", "Zápis stavu vyžaduje oprávnění přispívat."), "box")); out.foot = [closeB]; return out; }
        if (d.locked) {
          var bl = safe(function () { return U.summary(d.svc).blocked; }, null);
          B.push(note((bl ? bl.why + " " : "") + L("The date is filled in. The values are not, and nothing here offers to estimate them.", "Datum je vyplněné. Hodnoty ne a nic tu nenabízí je odhadnout."), "boxWarn"));
        }
        if (d.correct) B.push(note(L("Correcting the supplier\u2019s row. It has to be at or below the cellar reading of ", "Opravujete řádek od dodavatele. Musí být nejvýš stav ze sklepa ") + valsTxt(U.cellarReading) + L(", or the two still disagree.", ", jinak se stále neshodují."), "box"));
        if (!s.online) B.push(note(L("No signal is fine. It is saved on this phone with its own id and goes up when there is signal.", "Bez signálu nevadí. Uloží se v telefonu a odejde se signálem."), "offline"));
        B.push(field({ label: L("Date", "Datum"), type: "date", value: d.on, off: !!d.locked || !!d.correct, narrow: true, set: function (v) { patch({ on: v, err: "", offer: "" }); } }));
        var nb = safe(function () { return U.neighbours(d.svc, d.on, replicaFor(d.svc, m, d.edit)); }, { before: null, after: null });
        m.registers.forEach(function (g) {
          B.push(field({ label: g.label, mode: "decimal", value: d.vals[g.key] || "", suffix: unitTxt(m.unit), narrow: true,
            placeholder: nb.before ? dialIn(nb.before.vals[g.key], m) : "",
            hint: nb.before ? L("Before: ", "Předtím: ") + qtyM(nb.before.vals[g.key], m) + L(" on ", " dne ") + day(nb.before.on, false) + (nb.after ? L(" \u00b7 after: ", " \u00b7 potom: ") + qtyM(nb.after.vals[g.key], m) + L(" on ", " dne ") + day(nb.after.on, false) : "")
              : L("First reading on this meter, so there is nothing to compare it with.", "První stav na tomto měřidle, není s čím porovnat."),
            set: function (v) { var o = Object.assign({}, d.vals); o[g.key] = v; patch({ vals: o, err: "", offer: "" }); } }));
        });
        if (!d.locked && !d.correct) B.push(chips(L("Where the number came from", "Odkud číslo je"), [["manual", L("I read the dial", "Odečetl(a) jsem")], ["supplier", L("Off a supplier letter", "Z dopisu dodavatele")], ["estimated", L("An estimate", "Odhad")]].map(function (o) {
          return chip(o[1], d.source === o[0], function () { patch({ source: o[0], err: "" }); });
        }), d.source === "estimated" ? L("An estimate is drawn on the chart and never priced.", "Odhad se kreslí do grafu a nikdy se neoceňuje.") : ""));
        B.push(chips("", [chip((d.photo ? "\u2713 " : "") + L("Photo of the dial", "Fotka číselníku"), !!d.photo, function () { patch({ photo: !d.photo }); })], d.photo ? L("Kept with the reading. It uploads separately and never holds the reading back.", "Uloží se ke stavu. Nahrává se zvlášť a stav nezdržuje.") : ""));
        B.push(field({ label: L("Note", "Poznámka"), value: d.note || "", placeholder: L("Optional", "Nepovinné"), set: function (v) { patch({ note: v }); } }));
        if (d.err) B.push(note(d.err, "boxDanger"));
        out.foot = d.offer === "rollover"
          ? [btn(L("No, let me fix it", "Ne, opravím"), "", function () { patch({ offer: "", err: "" }); }), btn(L("Yes, it went round", "Ano, přetočilo se"), "primary", function () { saveReading(d, true); })]
          : [cancel, btn(d.edit ? L("Save changes", "Uložit změny") : L("Save the reading", "Uložit stav"), "primary", function () { saveReading(d, false); })];
      }

      if (d.kind === "rview") {
        var r = d.ref, mv = meterFor(r), rsv = U.svc(r.service);
        var nbv = U.neighbours(r.service, r.on, replicaFor(r.service, mv, r));
        out.title = day(r.on); out.sub = rsv.name + " \u00b7 " + mv.serial;
        B.push(kv(mv.registers.map(function (g) { return [g.label, qtyM(r.vals[g.key] || 0, mv)]; }).concat([
          [L("Came from", "Zdroj"), r.source === "estimated" ? L("An estimate \u2014 drawn on the chart, never priced", "Odhad \u2014 kreslí se, neoceňuje") : r.source === "supplier" ? L("The supplier", "Dodavatel") : L("Read at the meter", "Odečteno na měřidle")],
          [L("Recorded by", "Zapsal(a)"), r.by ? name(r.by) : ""], [L("Photo", "Fotka"), r.photo ? L("attached", "přiložena") : ""],
          [L("Since the one before", "Od předchozího"), nbv.before && !r.initial ? mv.registers.map(function (g) { var x = r.vals[g.key] - nbv.before.vals[g.key]; if (r.rollover && x < 0) x += Math.pow(10, mv.digits) * 1000; return (mv.registers.length > 1 ? g.key.toUpperCase() + " " : "") + qtyM(x, mv); }).join(" \u00b7 ") + L(" in ", " za ") + U.diff(nbv.before.on, r.on) + L(" days", " dní") : ""],
          [L("Note", "Poznámka"), r.note || ""], r.queued && !s.online ? [L("Status", "Stav"), L("Queued on this phone", "Čeká v telefonu")] : null])));
        if (r.rollover) B.push(note(L("Confirmed as a rollover: the dial went past its last digit and started again, so the stretch adds the wrap.", "Potvrzeno přetočení: číselník přešel přes poslední číslici, úsek to započítá.")));
        var canEdit = canC && !r.final && !r.initial && (canM || r.by === me);
        out.foot = [canEdit ? btn(L("Delete", "Smazat"), "danger-ghost", function () {
          var ix = U.readings.indexOf(r);
          commit(function () { if (ix >= 0) U.readings.splice(ix, 1); }, function () { U.readings.splice(ix, 0, r); }, L("Reading for ", "Stav k ") + day(r.on) + L(" deleted \u00b7 everything recomputed", " smazán \u00b7 vše přepočteno"));
        }) : null, closeB, canEdit ? btn(L("Edit", "Upravit"), "primary", function () {
          var vals = {}; mv.registers.forEach(function (g) { vals[g.key] = dialIn(r.vals[g.key] || 0, mv); });
          patch({ kind: "reading", edit: r, on: r.on, vals: vals, source: r.source, photo: r.photo, note: r.note || "", locked: false });
        }) : null].filter(Boolean);
      }

      if (d.kind === "cellar") {
        var run = U.cellarRun(), C = U.cellarReading, back = run.backfill;
        out.title = run.resolver.title; out.sub = L("Electricity \u00b7 taken in the cellar, no signal", "Elektřina \u00b7 zapsáno ve sklepě bez signálu");
        B.push(note(run.resolver.body, "box"));
        B.push(kv([[L("Petr, at the meter", "Petr, na měřidle"), day(C.on) + " \u00b7 " + valsTxt(C)], [L("Jana, off ČEZ\u2019s letter", "Jana, z dopisu ČEZ"), day(back.on) + " \u00b7 " + valsTxt(back)]]));
        B.push(note(L("The phone held " + run.replicaRows + " rows and passed the value. The server holds " + run.allRows + ", including the supplier row, and refused it.", "Telefon měl " + run.replicaRows + " řádků a hodnotu pustil. Server jich má " + run.allRows + " včetně řádku od dodavatele a odmítl ji.")));
        if (!canC) { out.foot = [closeB]; return out; }
        var cv = {}; var cm = meterFor(C); cm.registers.forEach(function (g) { cv[g.key] = dialIn(C.vals[g.key], cm); });
        var bv = {}; cm.registers.forEach(function (g) { bv[g.key] = dialIn(back.vals[g.key], cm); });
        out.foot = [btn(L("Discard mine", "Zahodit můj"), "danger-ghost", function () {
          commit(function () {}, function () { self.setState({ utCellar: "refused" }); }, L("Cellar reading discarded", "Stav ze sklepa zahozen"), { utCellar: "discarded" });
        }), btn(L("Edit my reading", "Upravit můj"), "", function () {
          patch({ kind: "reading", on: C.on, vals: cv, source: "manual", photo: true, note: C.note, fromCellar: true, locked: false });
        }), btn(L("Keep mine, correct 6 September", "Nechat můj, opravit 6. září"), "primary", function () {
          patch({ kind: "reading", edit: back, on: back.on, vals: bv, source: "supplier", photo: false, note: back.note || "", correct: true, locked: false });
        })];
      }

      if (d.kind === "payment") {
        var pr2 = U.currentPeriod(d.svc), months = pr2 ? U.monthsOf(pr2) : [U.monthKey(T)];
        out.title = d.edit ? L("Advance payment", "Platba zálohy") : L("Record an advance payment", "Zapsat platbu zálohy"); out.sub = dsv.name;
        B.push(chips(L("For the month", "Za měsíc"), months.map(function (k) { return chip(mon(k), d.month === k, function () { patch({ month: k, err: "" }); }); }), L("The month it is for, not the day it left the account.", "Měsíc, za který je, ne den odeslání.")));
        B.push(field({ label: L("Amount", "Částka"), mode: "decimal", value: d.amount, suffix: "K\u010d", narrow: true, set: function (v) { patch({ amount: v, err: "" }); } }));
        B.push(field({ label: L("Paid on", "Zaplaceno"), type: "date", value: d.paidOn, narrow: true, set: function (v) { patch({ paidOn: v }); } }));
        B.push(field({ label: L("Note", "Poznámka"), value: d.note, placeholder: L("Optional", "Nepovinné"), set: function (v) { patch({ note: v }); } }));
        if (d.err) B.push(note(d.err, "boxDanger"));
        out.foot = [d.edit && canM ? btn(L("Delete", "Smazat"), "danger-ghost", function () {
          var ix = U.payments.indexOf(d.edit);
          commit(function () { U.payments.splice(ix, 1); }, function () { U.payments.splice(ix, 0, d.edit); }, mon(d.edit.month) + L(" payment removed \u00b7 the schedule applies again", " platba odebrána \u00b7 platí opět rozpis"));
        }) : null, cancel, btn(L("Save", "Uložit"), "primary", function () {
          var amt = parseMoney(d.amount);
          if (!amt) return patch({ err: L("Type the amount that was paid.", "Zapište zaplacenou částku.") });
          var other = U.payments.filter(function (x) { return x.service === d.svc && x.month === d.month && x !== d.edit; })[0];
          if (other) return patch({ err: mon(d.month) + L(" already has a recorded payment of " + M(other.amount) + ". A month has one \u2014 edit that one instead.", " už má zapsanou platbu " + M(other.amount) + ". Měsíc má jednu \u2014 upravte ji.") });
          if (d.edit) {
            var old = Object.assign({}, d.edit);
            commit(function () { Object.assign(d.edit, { month: d.month, amount: amt, paid_on: d.paidOn, note: d.note }); }, function () { Object.assign(d.edit, old); }, L("Payment saved \u00b7 balance recomputed", "Platba uložena \u00b7 bilance přepočtena"));
          } else {
            var p = { service: d.svc, month: d.month, paid_on: d.paidOn, amount: amt, by: me, note: d.note, session: true };
            commit(function () { U.payments.push(p); }, function () { U.payments.splice(U.payments.indexOf(p), 1); }, mon(d.month) + " \u00b7 " + M(amt) + L(" recorded", " zapsáno"));
          }
        })].filter(Boolean);
      }

      if (d.kind === "schedule") {
        out.title = L("Change the advance", "Změnit zálohu"); out.sub = dsv.name;
        var nextK = []; var k0 = U.monthKey(T); for (var i2 = 0; i2 < 4; i2++) { nextK.push(k0); k0 = U.monthKey(U.addDays(k0 + "-01", 32)); }
        B.push(field({ label: L("A month", "Měsíčně"), mode: "decimal", value: d.amount, suffix: "K\u010d", narrow: true, set: function (v) { patch({ amount: v, err: "" }); } }));
        B.push(field({ label: L("Due on day", "Splatné dne"), mode: "numeric", value: d.dayOf, narrow: true, set: function (v) { patch({ dayOf: v }); } }));
        B.push(chips(L("Starting with", "Od měsíce"), nextK.map(function (k) { return chip(mon(k), d.from === k, function () { patch({ from: k }); }); }), L("Months already recorded keep what was paid.", "Zapsané měsíce si nechají, co bylo zaplaceno.")));
        var pv = parseMoney(d.amount), sm = sumOf(d.svc);
        if (pv && sm && sm.balance != null && sm.remainingMonths) B.push(note(L("Roughly: it changes the balance at this rate from ", "Zhruba: bilance při tomto tempu se změní z ") + MR(sm.balance) + L(" to about ", " asi na ") + MR(sm.balance + (pv - U.scheduleAt(d.svc, T).amount) * sm.remainingMonths) + ".", "box"));
        if (d.err) B.push(note(d.err, "boxDanger"));
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          var amt = parseMoney(d.amount), dd2 = parseInt(d.dayOf, 10);
          if (!amt) return patch({ err: L("Type the new monthly amount.", "Zapište novou měsíční částku.") });
          if (!(dd2 >= 1 && dd2 <= 28)) return patch({ err: L("Pick a day from 1 to 28, so every month has it.", "Vyberte den 1 až 28, aby ho měl každý měsíc.") });
          var from = d.from + "-01", prev = U.schedules.filter(function (x) { return x.service === d.svc && x.from === from; })[0];
          var nw = { service: d.svc, from: from, amount: amt, day: dd2, session: true };
          commit(function () { if (prev) U.schedules.splice(U.schedules.indexOf(prev), 1); U.schedules.push(nw); U.schedules.sort(function (x, y) { return x.from < y.from ? -1 : x.from > y.from ? 1 : 0; }); },
            function () { U.schedules.splice(U.schedules.indexOf(nw), 1); if (prev) U.schedules.push(prev); U.schedules.sort(function (x, y) { return x.from < y.from ? -1 : 1; }); },
            L("Advance " + M(amt) + " from " + mon(d.from), "Záloha " + M(amt) + " od " + mon(d.from)));
        })];
      }

      if (d.kind === "line") {
        var ver = U.tariffs.filter(function (x) { return x.id === d.ver; })[0], cp = ver && ver.components.filter(function (x) { return x.id === d.cid; })[0];
        if (!cp) return null;
        var ty = U.types.filter(function (x) { return x.type === cp.type; })[0], isPct = pctType(cp.type);
        out.title = cp.bill; out.sub = (ty ? ty.plain : cp.type) + " \u00b7 " + L("from ", "od ") + day(ver.from);
        B.push(field({ label: isPct ? L("Percent", "Procento") : L("Amount", "Částka"), mode: "decimal", value: d.amount, narrow: true,
          suffix: isPct ? "%" : cp.type === "standing_charge" || cp.type === "fixed_levy" ? L("Kč per ", "Kč za ") + ({ month: L("month", "měsíc"), year: L("year", "rok"), day: L("day", "den") }[cp.period] || cp.period) : cp.type === "capacity_charge" ? L("Kč per ", "Kč za ") + cp.capUnit : "Kč/" + unitTxt(cp.per || "MWh"),
          set: function (v) { patch({ amount: v, err: "" }); }, hint: L("As printed on the bill.", "Jak je na faktuře.") }));
        if (cp.applies_to && cp.applies_to.only) B.push(note(L("Applies only to: ", "Jen na: ") + cp.applies_to.only.map(function (x) { var o = ver.components.filter(function (y) { return y.id === x; })[0]; return o ? o.bill : x; }).join(", ")));
        if (d.err) B.push(note(d.err, "boxDanger"));
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          var old = { amount: cp.amount, pct: cp.pct };
          if (isPct) {
            var pn = parseNum(d.amount); if (pn == null) return patch({ err: L("Type a percentage.", "Zapište procento.") });
            commit(function () { cp.pct = (cp.type === "discount" ? -1 : 1) * Math.round(pn * 100); }, function () { cp.pct = old.pct; }, cp.bill + L(" saved \u00b7 everything priced by it recomputed", " uloženo \u00b7 vše přepočteno"), d.conflict ? { utConflict: true } : null);
          } else {
            var mn = parseMoney(d.amount); if (mn == null) return patch({ err: L("Type the amount as printed.", "Zapište částku z faktury.") });
            commit(function () { cp.amount = mn; }, function () { cp.amount = old.amount; }, cp.bill + " \u00b7 " + M(mn) + L(" \u00b7 everything priced by it recomputed", " \u00b7 vše přepočteno"), d.conflict ? { utConflict: true } : null);
          }
        })];
      }

      if (d.kind === "version") {
        var lastV = U.tariffsOf(d.svc).slice(-1)[0];
        out.title = L("New price version", "Nová verze cen"); out.sub = dsv.name + L(" \u00b7 starts as a copy of the latest", " \u00b7 začne jako kopie poslední");
        B.push(field({ label: L("In effect from", "Platí od"), type: "date", value: d.from, narrow: true, set: function (v) { patch({ from: v, err: "" }); } }));
        var vatWas = lastV ? lastV.vat : "inclusive", vatNow = d.vat || vatWas;
        B.push(chips(L("The prices on the bill are", "Ceny na faktuře jsou"), [["inclusive", L("with VAT", "s DPH")], ["exclusive", L("without VAT", "bez DPH")]].map(function (o) {
          return chip(o[1], vatNow === o[0], function () { patch({ vat: o[0] }); });
        }), vatNow !== vatWas ? L("Changed from the last version. The lines are copied as they were typed, so check each price against the bill before saving them.", "Jinak než minulá verze. Řádky se kopírují, jak byly zapsané — zkontrolujte ceny podle faktury.")
          : vatNow === "inclusive" ? L("VAT is inside each amount, and the VAT line only reports it.", "DPH je v každé částce a řádek DPH ji jen ukazuje.") : L("VAT is added as its own line, in the order the bill applies it.", "DPH se přičte jako samostatný řádek v pořadí podle faktury.")));
        var rsV = U.readingsOf(d.svc, { money: true }), lastR = rsV[rsV.length - 1];
        if (d.from && lastR && d.from <= lastR.on && !rsV.some(function (x) { return x.on === d.from; }))
          B.push(note(L("There is no reading for that day. The stretch around it stops being priced until one is added \u2014 splitting it would mean inventing a meter value.", "Na ten den není stav. Úsek kolem přestane být oceněn, dokud se nedoplní \u2014 dělit ho by znamenalo vymýšlet stav."), "boxWarn"));
        else if (d.from > T) B.push(note(L("A future version changes the forecast the moment it is saved: every projected day is priced by the version in effect on it.", "Budoucí verze změní předpověď hned po uložení: každý předpovězený den se ocení verzí, která ten den platí."), "box"));
        B.push(note(L("A version\u2019s end is never typed. It ends the day before the next one starts.", "Konec verze se nezadává. Končí den před začátkem další.")));
        if (d.err) B.push(note(d.err, "boxDanger"));
        out.foot = [cancel, btn(L("Create and edit it", "Vytvořit a upravit"), "primary", function () {
          if (!d.from) return patch({ err: L("Pick the day it starts.", "Vyberte den začátku.") });
          if (U.tariffsOf(d.svc).some(function (x) { return x.from === d.from; })) return patch({ err: L("Another version already starts on " + day(d.from) + ". Edit that one instead.", "Jiná verze už začíná " + day(d.from) + ". Upravte ji.") });
          var nid = d.svc + "-v" + rev;
          var nv = { id: nid, service: d.svc, from: d.from, vat: vatNow, by: me, note: L("Copied from the version of ", "Kopie verze od ") + (lastV ? day(lastV.from) : ""), session: true,
            components: (lastV ? lastV.components : []).map(function (x, i) {
              var cc = JSON.parse(JSON.stringify(x)); cc.id = nid + "-" + i; return cc;
            }) };
          var idMap = {}; (lastV ? lastV.components : []).forEach(function (x, i) { idMap[x.id] = nid + "-" + i; });
          nv.components.forEach(function (cc) { if (cc.applies_to && cc.applies_to.only) cc.applies_to.only = cc.applies_to.only.map(function (x) { return idMap[x] || x; }); if (cc.applies_to && cc.applies_to.except) cc.applies_to.except = cc.applies_to.except.map(function (x) { return idMap[x] || x; }); });
          commit(function () { U.tariffs.push(nv); }, function () { U.tariffs.splice(U.tariffs.indexOf(nv), 1); }, L("Version from " + day(d.from) + " created \u00b7 change the lines that changed", "Verze od " + day(d.from) + " vytvořena \u00b7 upravte změněné řádky"), { utVer: nid });
        })];
      }

      if (d.kind === "invoice") {
        var pI = U.periodOf(d.pid), mI = U.meterAt(d.svc, pI.to);
        out.title = L("Record the settlement", "Zapsat vyúčtování"); out.sub = dsv.name + " \u00b7 " + span(pI.from, pI.to);
        B.push(field({ label: L("Their total for the period", "Celkem za období"), mode: "decimal", value: d.total, suffix: "K\u010d", narrow: true, set: function (v) { patch({ total: v, err: "" }); } }));
        B.push(field({ label: L("Balance", "Doplatek / přeplatek"), mode: "decimal", value: d.balance, suffix: "K\u010d", narrow: true, set: function (v) { patch({ balance: v, err: "" }); }, hint: L("Minus if you owe them, as printed.", "Mínus, pokud doplácíte.") }));
        mI.registers.forEach(function (g) {
          B.push(field({ label: L("Their final value \u00b7 ", "Jejich konečný stav \u00b7 ") + g.label, mode: "decimal", value: d.vals[g.key] || "", suffix: unitTxt(mI.unit), narrow: true,
            set: function (v) { var o = Object.assign({}, d.vals); o[g.key] = v; patch({ vals: o, err: "" }); } }));
        });
        B.push(note(L("Their meter values are what let a difference be put down to the meter rather than only to money.", "Jejich stavy umožní přičíst rozdíl měřidlu, ne jen penězům.")));
        if (d.err) B.push(note(d.err, "boxDanger"));
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          var tot = parseMoney(d.total), bal = parseMoney(d.balance, true), vv = {}, bad = false;
          mI.registers.forEach(function (g) { var n = parseNum(d.vals[g.key]); if (n == null) bad = true; else vv[g.key] = n; });
          if (!tot || bal == null || bad) return patch({ err: L("All three are on the settlement: the total, the balance and their meter values.", "Všechny tři jsou na vyúčtování: celkem, doplatek a jejich stavy.") });
          var inv = { on: T, total: tot, balance: bal, vals: vv, note: L("Typed in by ", "Zapsal(a) ") + name(me) };
          commit(function () { pI.invoice = inv; }, function () { pI.invoice = null; }, L("Settlement recorded \u00b7 compared with what was computed", "Vyúčtování zapsáno \u00b7 porovnáno s výpočtem"));
        })];
      }

      if (d.kind === "period") {
        out.title = L("Start a billing period", "Založit zúčtovací období"); out.sub = dsv.name;
        B.push(field({ label: L("From", "Od"), type: "date", value: d.from, narrow: true, set: function (v) { patch({ from: v, err: "" }); } }));
        B.push(field({ label: L("To", "Do"), type: "date", value: d.to, narrow: true, set: function (v) { patch({ to: v, err: "" }); } }));
        B.push(chips("", [chip((d.estimated ? "\u2713 " : "") + L("The end date is my guess", "Konec je můj odhad"), !!d.estimated, function () { patch({ estimated: !d.estimated }); })], L("Marked estimated until the supplier confirms it.", "Označí se jako odhad, dokud to dodavatel nepotvrdí.")));
        if (d.err) B.push(note(d.err, "boxDanger"));
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          if (!d.from || !d.to || d.to <= d.from) return patch({ err: L("The end has to come after the start.", "Konec musí být po začátku.") });
          var ov = U.periodsOf(d.svc).filter(function (p) { return p.from <= d.to && p.to >= d.from; })[0];
          if (ov) return patch({ err: L("That overlaps " + span(ov.from, ov.to) + ", and periods cannot overlap.", "Překrývá se s " + span(ov.from, ov.to) + " a období se překrývat nesmí.") });
          var np = { id: d.svc + "-p" + rev, service: d.svc, from: d.from, to: d.to, estimatedEnd: !!d.estimated, invoice: null, session: true };
          commit(function () { U.periods.push(np); }, function () { U.periods.splice(U.periods.indexOf(np), 1); }, L("Period " + span(d.from, d.to) + " started", "Období " + span(d.from, d.to) + " založeno"));
        })];
      }

      if (d.kind === "bill") {
        out.title = d.edit ? L("Bill", "Faktura") : L("Add a bill", "Přidat fakturu"); out.sub = dsv.name + " \u00b7 " + dsv.supplier;
        if (!canC) { B.push(kv([[L("Amount", "Částka"), d.amount + " Kč"], [L("Period", "Období"), d.from ? span(d.from, d.to) : "\u2013"], [L("Due", "Splatná"), day(d.due)], [L("Paid", "Zaplaceno"), d.paid ? day(d.paidOn) : "\u2013"]])); out.foot = [closeB]; return out; }
        B.push(field({ label: L("Amount", "Částka"), mode: "decimal", value: d.amount, suffix: "K\u010d", narrow: true, set: function (v) { patch({ amount: v, err: "" }); } }));
        B.push(field({ label: L("Covers from", "Období od"), type: "date", value: d.from, narrow: true, set: function (v) { patch({ from: v, err: "" }); } }));
        B.push(field({ label: L("Covers to", "Období do"), type: "date", value: d.to, narrow: true, set: function (v) { patch({ to: v, err: "" }); }, hint: L("Leave both empty if the bill doesn\u2019t print a period.", "Nechte prázdné, pokud faktura období neuvádí.") }));
        B.push(field({ label: L("Due", "Splatná"), type: "date", value: d.due, narrow: true, set: function (v) { patch({ due: v }); } }));
        B.push(chips("", [chip((d.paid ? "\u2713 " : "") + L("Already paid", "Už zaplaceno"), !!d.paid, function () { patch({ paid: !d.paid }); })]));
        if (d.paid) B.push(field({ label: L("Paid on", "Zaplaceno dne"), type: "date", value: d.paidOn, narrow: true, set: function (v) { patch({ paidOn: v }); } }));
        if (d.err) B.push(note(d.err, "boxDanger"));
        out.foot = [d.edit ? btn(L("Delete", "Smazat"), "danger-ghost", function () {
          var ix = U.bills.indexOf(d.edit);
          commit(function () { U.bills.splice(ix, 1); }, function () { U.bills.splice(ix, 0, d.edit); }, L("Bill deleted", "Faktura smazána"));
        }) : null, cancel, btn(L("Save", "Uložit"), "primary", function () {
          var amt = parseMoney(d.amount);
          if (!amt) return patch({ err: L("Type the amount on the bill.", "Zapište částku z faktury.") });
          if ((d.from && !d.to) || (!d.from && d.to) || (d.from && d.to < d.from)) return patch({ err: L("A period is two dates, the end after the start \u2014 or neither.", "Období jsou dvě data, konec po začátku \u2014 nebo žádné.") });
          var ov = d.from ? U.billsOf(d.svc).filter(function (x) { return x !== d.edit && x.from && x.from <= d.to && x.to >= d.from; })[0] : null;
          if (ov) return patch({ err: L("Another bill already covers " + span(ov.from, ov.to) + ". Two bills for one period would double the spend history.", "Jiná faktura už pokrývá " + span(ov.from, ov.to) + ". Dvě faktury za jedno období by zdvojily útratu.") });
          var fields = { amount: amt, from: d.from || null, to: d.to || null, due: d.due, paid: d.paid ? d.paidOn : null };
          if (d.edit) { var old = Object.assign({}, d.edit); commit(function () { Object.assign(d.edit, fields); }, function () { Object.assign(d.edit, old); }, L("Bill saved", "Faktura uložena")); }
          else {
            var nb2 = Object.assign({ service: d.svc, issued: T, session: true }, fields);
            commit(function () { U.bills.push(nb2); }, function () { U.bills.splice(U.bills.indexOf(nb2), 1); }, L("Bill added \u00b7 ", "Faktura přidána \u00b7 ") + M(amt));
          }
        })].filter(Boolean);
      }

      if (d.kind === "svc") {
        out.title = L("Contract and details", "Smlouva a údaje"); out.sub = dsv.name;
        if (!canM) {
          B.push(kv([[L("Supplier", "Dodavatel"), dsv.supplier], [L("Account", "Číslo"), dsv.account || ""], [L("Where", "Kde"), dsv.place], [L("Contract ends", "Smlouva do"), dsv.contract_end ? day(dsv.contract_end) : L("No end date", "Na dobu neurčitou")],
            [L("Notice", "Výpověď"), dsv.notice_days ? dsv.notice_days + L(" days", " dní") : ""], [L("Reading cadence", "Odečet každých"), dsv.cadence ? dsv.cadence + L(" days", " dní") : ""]]));
          out.foot = [closeB]; return out;
        }
        B.push(field({ label: L("Supplier", "Dodavatel"), value: d.supplier, set: function (v) { patch({ supplier: v }); } }));
        B.push(field({ label: L("Account or customer number", "Číslo zákazníka"), value: d.account, set: function (v) { patch({ account: v }); } }));
        B.push(field({ label: L("Contract ends", "Smlouva končí"), type: "date", value: d.end, narrow: true, set: function (v) { patch({ end: v }); }, hint: L("Empty for an open-ended contract.", "Prázdné u smlouvy na dobu neurčitou.") }));
        B.push(field({ label: L("Notice period", "Výpovědní lhůta"), mode: "numeric", value: d.notice, suffix: L("days", "dní"), narrow: true, set: function (v) { patch({ notice: v }); },
          hint: d.end && +d.notice ? L("The reminder comes on ", "Připomínka přijde ") + day(U.addDays(d.end, -(+d.notice))) + L(", the last day notice still works.", ", poslední den, kdy výpověď platí.") : "" }));
        if (dsv.mode !== "bills_only") {
          B.push(field({ label: L("Read the meter every", "Odečítat každých"), mode: "numeric", value: d.cadence, suffix: L("days", "dní"), narrow: true, set: function (v) { patch({ cadence: v }); } }));
          B.push(field({ label: L("Or on this day of the month", "Nebo tento den v měsíci"), mode: "numeric", value: d.rday, narrow: true, set: function (v) { patch({ rday: v }); }, hint: L("Whichever comes sooner is the next reading date.", "Další odečet je ten, který přijde dřív.") }));
        }
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          var old = { supplier: dsv.supplier, account: dsv.account, contract_end: dsv.contract_end, notice_days: dsv.notice_days, cadence: dsv.cadence, readingDay: dsv.readingDay };
          commit(function () {
            Object.assign(dsv, { supplier: d.supplier.trim() || dsv.supplier, account: d.account.trim() || null, contract_end: d.end || null, notice_days: parseInt(d.notice, 10) || 0 });
            if (dsv.mode !== "bills_only") Object.assign(dsv, { cadence: parseInt(d.cadence, 10) || null, readingDay: parseInt(d.rday, 10) || null });
          }, function () { Object.assign(dsv, old); }, L("Details saved", "Údaje uloženy"));
        })];
      }

      if (d.kind === "headroom") {
        var h = safe(function () { return U.headroom(d.svc); }, null);
        out.title = L("What your advance buys", "Co za zálohu koupíte"); out.sub = dsv.name;
        if (!h) { B.push(note(L("An advance and one price are enough for this figure, and one of them is missing.", "Stačí záloha a jedna cena, a jedno chybí."), "box")); out.foot = [closeB]; return out; }
        B.push(note(h.says, "box"));
        B.push(label(L("Fixed each month", "Pevně každý měsíc")));
        B.push(rows(h.fixedRows.map(function (x) { return row({ title: x.bill, right: M(x.amount) }); }).concat([row({ title: L("Left for energy", "Na energii"), strong: true, right: M(h.buys) })])));
        B.push(label(L("Per register", "Po registrech")));
        B.push(rows(h.registers.map(function (g) { return row({ title: g.label, sub: M(Math.round(g.perDial)) + " / " + unitTxt(h.unit) + L(" incl. levies", " vč. poplatků"), right: "\u2248\u00a0" + U.approxUnits(g.units) + "\u00a0" + unitTxt(h.unit) }); })));
        B.push(note(h.heuristic));
        out.foot = [closeB];
      }

      if (d.kind === "stretch") {
        var ivs = safe(function () { return U.periodRun(d.pid).intervals; }, []), iv = ivs.filter(function (x) { return x.from === d.from && x.to === d.to; })[0];
        if (!iv) return null;
        out.title = span(iv.from, iv.to); out.sub = dsv.name + " \u00b7 " + iv.days + L(" days \u00b7 version ", " dní \u00b7 verze ") + iv.version.id;
        B.push(rows(iv.lines.map(function (ln) { return row({ title: ln.bill, sub: ln.detail, right: M(ln.amount), tone: ln.amount < 0 ? "accent" : "" }); }).concat([row({ title: L("Total", "Celkem"), strong: true, right: M(iv.total) })])));
        if (iv.conv) B.push(note(L("Billed as: ", "Fakturace: ") + U.convSays(iv.conv)));
        out.foot = [closeB];
      }

      if (d.kind === "replace") {
        var old = U.meterAt(d.svc, d.on || T);
        out.title = L("Replace the meter", "Výměna měřidla"); out.sub = dsv.name + " \u00b7 " + old.serial;
        B.push(note(L("Close the old one with its final reading and open the new one with its first. The stretch across the swap is (final \u2212 previous) + (current \u2212 first).", "Uzavřete staré konečným stavem a otevřete nové počátečním. Úsek přes výměnu je (konečný \u2212 předchozí) + (další \u2212 počáteční)."), "box"));
        B.push(field({ label: L("Swapped on", "Vyměněno dne"), type: "date", value: d.on, narrow: true, set: function (v) { patch({ on: v, err: "" }); } }));
        old.registers.forEach(function (g) {
          B.push(field({ label: L("Old meter, final \u00b7 ", "Staré, konečný \u00b7 ") + g.label, mode: "decimal", value: d.fin[g.key] || "", suffix: unitTxt(old.unit), narrow: true,
            set: function (v) { var o = Object.assign({}, d.fin); o[g.key] = v; patch({ fin: o, err: "" }); } }));
        });
        B.push(field({ label: L("New meter serial", "Výrobní číslo nového"), value: d.serial, narrow: true, set: function (v) { patch({ serial: v, err: "" }); } }));
        old.registers.forEach(function (g) {
          B.push(field({ label: L("New meter, first \u00b7 ", "Nové, počáteční \u00b7 ") + g.label, mode: "decimal", value: d.init[g.key] == null ? "" : d.init[g.key], placeholder: "0", suffix: unitTxt(old.unit), narrow: true,
            set: function (v) { var o = Object.assign({}, d.init); o[g.key] = v; patch({ init: o, err: "" }); } }));
        });
        if (d.err) B.push(note(d.err, "boxDanger"));
        out.foot = [cancel, btn(L("Replace", "Vyměnit"), "primary", function () {
          var fin = {}, ini = {}, bad = false;
          old.registers.forEach(function (g) { var a1 = parseNum(d.fin[g.key]), b1 = parseNum(d.init[g.key] == null || d.init[g.key] === "" ? "0" : d.init[g.key]); if (a1 == null || b1 == null) bad = true; fin[g.key] = a1; ini[g.key] = b1; });
          if (!d.on || d.on > T) return patch({ err: L("Pick the day it was swapped.", "Vyberte den výměny.") });
          if (bad) return patch({ err: L("Type the old meter\u2019s last value and the new one\u2019s first.", "Zapište poslední stav starého a první nového.") });
          if (!d.serial.trim()) return patch({ err: L("Type the new meter\u2019s serial, off its label.", "Zapište výrobní číslo nového ze štítku.") });
          var ck = U.checkReading(d.svc, d.on, fin, { replica: replicaFor(d.svc, old, null) });
          if (!ck.ok) return patch({ err: ck.says });
          var nm = { id: old.id + "-n" + rev, service: d.svc, serial: d.serial.trim(), location: old.location, unit: old.unit, digits: old.digits, decimals: old.decimals, multiplier: old.multiplier, direction: old.direction, from: d.on, to: null, registers: JSON.parse(JSON.stringify(old.registers)) };
          var cv0 = U.conversionAt(old.id, d.on), ncv = cv0 ? Object.assign({}, cv0, { meter: nm.id, from: d.on }) : null;
          var mk = function (vals, o) { var r = { service: d.svc, on: d.on, vals: {}, source: "manual", photo: false, note: o.note, by: me, mark: null, rollover: false, meter: o.meter, initial: !!o.initial, final: !!o.final, session: true, queued: !s.online }; Object.keys(vals).forEach(function (k) { r.vals[k] = Math.round(vals[k] * 1000); }); return r; };
          var rf = mk(fin, { meter: old.id, final: true, note: L("Final reading \u2014 meter replaced", "Konečný stav \u2014 výměna") }), ri = mk(ini, { meter: nm.id, initial: true, note: L("First reading on the new meter", "Počáteční stav nového") });
          var oldTo = old.to;
          commit(function () {
            U.readings.forEach(function (r) { if (r.service === d.svc && !r.meter) r.meter = old.id; });
            old.to = d.on; U.meters.push(nm); if (ncv) U.conversions.push(ncv); U.readings.push(rf, ri);
          }, function () {
            old.to = oldTo; U.meters.splice(U.meters.indexOf(nm), 1); if (ncv) U.conversions.splice(U.conversions.indexOf(ncv), 1);
            U.readings.splice(U.readings.indexOf(rf), 1); U.readings.splice(U.readings.indexOf(ri), 1);
          }, L("Meter replaced \u00b7 the year still adds up", "Měřidlo vyměněno \u00b7 rok stále sedí"), { route: svcRoot + "/meters" });
        })];
      }
      return out;
    }

    function saveReading(d, rollover) {
      var m = U.meterAt(d.svc, d.on || T), vals = {}, bad = null;
      if (!d.on) return patch({ err: L("Pick the date on the dial.", "Vyberte datum.") });
      if (d.on > T) return patch({ err: L("A reading is what the dial said, so it can\u2019t be in the future.", "Stav je to, co ukázal číselník, nemůže být v budoucnu.") });
      if (m.from > d.on) return patch({ err: L("This meter was fitted on " + day(m.from) + ".", "Toto měřidlo bylo osazeno " + day(m.from) + ".") });
      m.registers.forEach(function (g) { var n = parseNum(d.vals[g.key]); if (n == null) bad = bad || g.label; else vals[g.key] = n; });
      if (bad) return patch({ err: L("Type what the dial says for ", "Zapište stav pro ") + bad + "." });
      var rep = replicaFor(d.svc, m, d.edit);
      var dup = rep.filter(function (r) { return r.on === d.on && !r.final && !r.initial; })[0];
      if (dup) return patch({ err: L("There is already a reading for " + day(d.on) + ". Edit that one instead \u2014 a day has one reading.", "Pro " + day(d.on) + " už stav je. Upravte ho \u2014 den má jeden stav.") });
      if (d.correct) {
        var C = U.cellarReading, over = m.registers.filter(function (g) { return Math.round(vals[g.key] * 1000) > C.vals[g.key]; })[0];
        if (over) return patch({ err: L("That is still above the cellar reading for " + over.label + ", so the two still disagree.", "Stále nad stavem ze sklepa pro " + over.label + ", takže se neshodují.") });
      }
      if (!rollover) {
        var ck = U.checkReading(d.svc, d.on, vals, { replica: rep });
        if (!ck.ok) return patch({ err: ck.says, offer: ck.offer === "rollover" ? "rollover" : "" });
      }
      var milli = {}; Object.keys(vals).forEach(function (k) { milli[k] = Math.round(vals[k] * 1000); });
      var multi = U.metersOf(d.svc).length > 1;
      var extra = {};
      var afterBlock = safe(function () { return U.summary(d.svc).blocked; }, null);
      if (d.edit) {
        var r = d.edit, old = { on: r.on, vals: r.vals, source: r.source, photo: r.photo, note: r.note, rollover: r.rollover, by: r.by };
        var cellarRow = d.correct ? Object.assign({}, U.cellarReading, { vals: Object.assign({}, U.cellarReading.vals), mark: null, session: true, queued: !s.online }) : null;
        if (d.correct) extra.utCellar = "accepted";
        commit(function () {
          Object.assign(r, { on: d.on, vals: milli, source: d.source || r.source, photo: !!d.photo, note: d.note || "", rollover: !!rollover || (r.rollover && !!rollover) });
          if (cellarRow) U.readings.push(cellarRow);
        }, function () {
          Object.assign(r, old);
          if (cellarRow) { U.readings.splice(U.readings.indexOf(cellarRow), 1); self.setState({ utCellar: "refused" }); }
        }, d.correct ? L("6 September corrected \u00b7 the cellar reading is in", "6. září opraveno \u00b7 stav ze sklepa je zapsán") : L("Reading for " + day(d.on) + " saved \u00b7 everything recomputed", "Stav k " + day(d.on) + " uložen \u00b7 vše přepočteno"), extra);
        return;
      }
      var row2 = { service: d.svc, on: d.on, vals: milli, source: d.locked ? "manual" : (d.source || "manual"), photo: !!d.photo, note: d.note || "", by: me,
        mark: null, rollover: !!rollover, meter: multi ? m.id : null, initial: false, final: false, session: true, queued: !s.online };
      if (d.fromCellar) extra.utCellar = "accepted";
      if (d.back) extra.route = d.back;
      var msg = L("Reading for " + day(d.on) + " saved", "Stav k " + day(d.on) + " uložen");
      commit(function () { U.readings.push(row2); }, function () {
        U.readings.splice(U.readings.indexOf(row2), 1);
        if (d.fromCellar) self.setState({ utCellar: "refused" });
      }, msg, extra);
      var nowBlock = safe(function () { return U.summary(d.svc).blocked; }, null);
      if (afterBlock && !nowBlock) self.docToastShow(msg + L(" \u00b7 the period can be priced again", " \u00b7 období lze znovu ocenit"), function () {
        U.readings.splice(U.readings.indexOf(row2), 1); bump({ docToast: null });
      });
    }

    var subPage = page !== "overview" && page !== "detail";
    return { panes: panes, headTitle: headTitle, headSub: headSub, sheetOpen: !!sheetD,
      showBack: !wide ? page !== "overview" : subPage && page !== "setup",
      onBack: function () {
        self.setState({ utSheet: null, utMode: null });
        if (page === "setup") return self.go("/utilities");
        if (page === "periods" && c) return self.go(svcRoot + "/periods");
        self.go(page === "detail" || !id ? "/utilities" : svcRoot);
      } };
  }

  window.HH_UT_VIEW = view;
})();
