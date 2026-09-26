/* Pets, live in the prototype shell.
   Reads and writes the shared asset engine (HH_ASSETS): a pet is an entity, weight is the
   engine's reading series, the health record is its record log, regular care is a schedule.
   The module's own screens — the daily routine, medication doses, the vet card, feeding and
   allergies, weight, insurance, and the gentle status flow — are computed here from the same
   arrays, with session overlays for the two state_sets (routine ticks keyed (item, date) and
   dose ticks keyed (dose_occurrence)). Drawn through the same block vocabulary as Vehicles.
   Nothing on these screens uses an asset-management word (D-72). */
(function () {
  var KINDS = ["Hero", "Label", "Rows", "Note", "Bars", "Acts", "Field", "Chips", "Inputs", "Cards", "Steps", "Kv", "Empty"];
  var LV = ["none", "view", "contribute", "manage"];
  var MEN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MCS = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
  var DEN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], DCS = ["ne", "po", "út", "st", "čt", "pá", "so"];
  var NOW = "18:40";
  function safe(fn, d) { try { var v = fn(); return v == null ? d : v; } catch (e) { return d; } }

  var SPECIES = [["dog", "Dog", "Pes"], ["cat", "Cat", "Kočka"], ["rabbit", "Rabbit", "Králík"], ["guinea", "Guinea pig", "Morče"], ["bird", "Bird", "Pták"], ["other", "Other", "Jiné"]];
  var HT = { vaccination: ["Vaccination", "Očkování"], treatment: ["Treatment", "Léčba"], condition: ["Condition", "Diagnóza"],
    procedure: ["Procedure", "Zákrok"], weight: ["Weighing", "Vážení"], note: ["Note", "Poznámka"] };
  var HT_ORDER = ["vaccination", "treatment", "condition", "procedure", "weight", "note"];
  /* D-69 for animals: one tap adds the usual care with its interval */
  var STARTER = {
    dog: { care: [["Očkování", "Vaccination", 12], ["Odčervení", "Worming", 3]],
      routine: [["Ranní venčení", "Morning walk", "07:00"], ["Ranní krmení", "Morning feed", "07:15"], ["Čerstvá voda", "Fresh water", ""], ["Večerní krmení", "Evening feed", "18:00"], ["Večerní venčení", "Evening walk", "20:00"]] },
    cat: { care: [["Očkování", "Vaccination", 12], ["Odčervení", "Worming", 3]],
      routine: [["Krmení", "Feeding", "07:30"], ["Kočkolit", "Litter tray", ""], ["Čerstvá voda", "Fresh water", ""]] },
    rabbit: { care: [["Očkování", "Vaccination", 12]], routine: [["Seno a krmení", "Hay and food", "08:00"], ["Čerstvá voda", "Fresh water", ""]] },
    guinea: { care: [], routine: [["Krmení", "Feeding", "08:00"], ["Čerstvá voda", "Fresh water", ""]] },
    bird: { care: [], routine: [["Krmení", "Feeding", "08:00"], ["Čerstvá voda", "Fresh water", ""]] },
    other: { care: [], routine: [] }
  };
  var EN = {
    cat: { "Pes · kříženec": "Dog · mixed breed", "Kočka · evropská krátkosrstá": "Cat · European shorthair", "Kočka": "Cat" },
    rt: { "rt-walk-am": "Morning walk", "rt-feed-am": "Morning feed", "rt-water": "Fresh water", "rt-feed-pm": "Evening feed", "rt-walk-pm": "Evening walk", "rt-litter": "Litter tray", "rt-mour-feed": "Feed Mour" },
    h: { "h-worm": "Milbemax — worming", "h-hip": "Mild hip dysplasia", "h-spay": "Spayed", "h-note": "Cut paw after the Svratka" },
    hm: { "h-vac": "batch A241-77 · next 4 Mar 2027", "h-worm": "1 tablet · next 9 Sep 2026", "h-hip": "ongoing · no treatment, keep her weight steady", "h-spay": "no complications",
      "h-weight": "at home · five weighings a year", "h-note": "healed within a week · 2 photos", "h-mour-vac": "next 21 May 2027" },
    sch: { "Očkování": "Vaccination", "Odčervení": "Worming" },
    txt: { "po šití tlapky": "after stitches on the paw", "1 tableta": "1 tablet", "Pojištění léčebných výloh": "Vet fees cover",
      "Sušené kuřecí ne — sušená ryba ano": "No dried chicken — dried fish is fine", "Kuřecí maso — svědění a otlaky": "Chicken — itching and sore spots",
      "Hrozny a rozinky": "Grapes and raisins", "Xylitol (žvýkačky)": "Xylitol (chewing gum)", "Čokoláda": "Chocolate", "Buvolí kůže": "Rawhide",
      "Tabletky bere v tvarohu, ne v masu.": "Takes tablets in quark, not in meat.", "Po–Pá 8:00–18:00, So 9:00–12:00": "Mon–Fri 8:00–18:00, Sat 9:00–12:00",
      "Non-stop klinika Žabovřesky — Korálová 12": "24-hour clinic Žabovřesky — Korálová 12" }
  };

  /* session overlays — the two state_sets, per-pet details the fixture only has for Bela */
  var PS = { given: {}, routine: {}, meds: [], feeding: {}, target: { bela: { min: 17, max: 20 } }, seeded: false };

  function view(self, seg, query, hash, wide) {
    var A = window.HH_ASSETS, F = window.HH_FIXTURES, N = window.HH_NAV;
    if (!A) return null;
    if (!PS.seeded) { PS.seeded = true; PS.feeding.bela = A.feeding; }
    var s = self.state, L = self.chatL.bind(self), web = s.client === "web", cs = s.locale === "cs";
    var nav = N ? N.navFor(s.member, s.household) : {};
    var grants = nav.grants || {};
    var lvl = grants.pets || "none";
    var ro = ["read_only", "canceled", "restricted"].indexOf(s.ent) >= 0 || s.screen === "readonly";
    var canC = LV.indexOf(lvl) >= 2 && !ro, canM = LV.indexOf(lvl) >= 3 && !ro;
    var me = s.member, TD = A.today, isEmpty = s.screen === "empty", off = !s.online;
    var members = F ? F.members : [];
    var name = function (id) { var m = members.filter(function (x) { return x.id === id; })[0]; return m ? m.name : id; };
    var go = function (r) { return function () { self.setState({ peSheet: null }); self.go(r); }; };
    var YD = A.addDays(TD, -1);

    /* ── words ── */
    var tr = function (t) { return !t ? "" : cs ? t : (EN.txt[t] || t); };
    var day = function (iso, y) {
      if (!iso) return "\u2013";
      var p = iso.split("-");
      return cs ? (+p[2]) + ". " + MCS[+p[1] - 1] + (y === false ? "" : " " + p[0]) : (+p[2]) + " " + MEN[+p[1] - 1] + (y === false ? "" : " " + p[0]);
    };
    var wday = function (iso) {
      var dt = new Date(iso + "T12:00:00"), w = dt.getDay();
      return iso === TD ? L("Today", "Dnes") : iso === YD ? L("Yesterday", "Včera") : (cs ? DCS[w] + " " : DEN[w] + " ") + day(iso, false);
    };
    var czk = function (n) { return A.czk(n || 0); };
    var kg = function (m) { return A.num(m / 1000, 1) + "\u00a0kg"; };
    var pN = function (e) { return e ? (cs ? e.cs : (e.en || e.cs)) : ""; };
    var catN = function (c) { return c ? (cs ? c : (EN.cat[c] || c)) : ""; };
    var spN = function (k) { var t = SPECIES.filter(function (x) { return x[0] === k; })[0]; return t ? (cs ? t[2] : t[1]) : ""; };
    var sexOf = function (e) { return e.sex === "fena" || e.sex === "kočka" || e.sex === "f" ? "f" : e.sex ? "m" : ""; };
    var sexN = function (e) {
      var f = sexOf(e) === "f"; if (!sexOf(e)) return "";
      if (e.species === "dog") return f ? L("female", "fena") : L("male", "pes");
      if (e.species === "cat") return f ? L("female", "kočka") : L("male", "kocour");
      return f ? L("female", "samice") : L("male", "samec");
    };
    var schN = function (sc) { return cs ? sc.cs : (sc.en || EN.sch[sc.cs] || sc.cs); };
    var hN = function (h) { return cs ? h.cs : (h.en || EN.h[h.id] || h.cs); };
    var hMeta = function (h) { return cs ? (h.meta || "") : (h.metaEn || EN.hm[h.id] || h.meta || ""); };
    var htN = function (t) { return HT[t] ? (cs ? HT[t][1] : HT[t][0]) : t; };
    var rtN = function (r) { return cs ? r.cs : (r.en || EN.rt[r.id] || r.cs); };
    var months = function (n) { return n === 12 ? L("every year", "každý rok") : n === 1 ? L("every month", "každý měsíc") : n % 12 === 0 ? L("every " + n / 12 + " years", "každé " + n / 12 + " roky") : L("every " + n + " months", "každé " + n + " měsíce"); };
    var parseNum = function (v) {
      var t = String(v == null ? "" : v).replace(/[\s\u00a0]/g, "").replace(",", ".");
      return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
    };
    var inW = function (n) { return n === 0 ? L("today", "dnes") : n === 1 ? L("tomorrow", "zítra") : n < 0 ? L(-n + " days late", -n + " dní po") : L("in " + n + " days", "za " + n + " dní"); };
    var ageOf = function (e) {
      if (!e.born) return "";
      var end = e.ended || TD, y = +end.slice(0, 4) - +e.born.slice(0, 4), m = +end.slice(5, 7) - +e.born.slice(5, 7);
      if (+end.slice(8, 10) < +e.born.slice(8, 10)) m--;
      if (m < 0) { y--; m += 12; }
      return y >= 1 ? y + L(y === 1 ? " year" : " years", y === 1 ? " rok" : y < 5 ? " roky" : " let") : Math.max(0, m) + L(" months", " měs.");
    };
    var partOf = function (t) { return !t ? "" : t < "11:00" ? L("Morning", "Ráno") : t < "16:00" ? L("Midday", "V poledne") : L("Evening", "Večer"); };

    /* ── blocks (the Vehicles vocabulary) ── */
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
        titleStyle: "font-size:0.9375em;line-height:1.35;overflow-wrap:anywhere;font-weight:" + (p.strong ? "600" : "500") + ";color:" + (p.muted ? "var(--text-muted)" : "var(--text-primary)") + (p.strike ? ";text-decoration:line-through;text-decoration-color:var(--text-muted)" : ""),
        subStyle: "font-size:0.75em;line-height:1.45;overflow-wrap:anywhere;text-wrap:pretty;color:" + (p.subTone ? inkOf(p.subTone) : "var(--text-muted)"),
        rightStyle: "font-family:'IBM Plex Mono',monospace;font-size:0.84375em;white-space:nowrap;font-variant-numeric:tabular-nums;color:" + inkOf(p.tone),
        badgeStyle: badgeStyle(p.badgeTone),
        dotStyle: "flex:0 0 " + (p.check ? "20px" : "10px") + ";width:" + (p.check ? "20px" : "10px") + ";height:" + (p.check ? "20px" : "10px") + ";box-sizing:border-box;border-radius:" + (p.check ? "6px" : "3px") + ";" +
          (p.check ? (p.checked ? "background:var(--positive);border:2px solid var(--positive)" : "background:transparent;border:2px solid " + (p.dotInk || "var(--border-strong)")) : "background:" + (p.dotInk || "var(--border-strong)")),
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
        stats: (p.stats || []).filter(Boolean), hasStats: !!(p.stats && p.stats.filter(Boolean).length), hasNav: false, onPrev: function () {}, onNext: function () {}, prevOff: true, nextOff: true,
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
    var bump = function (extra) { self.setState(Object.assign({ peRev: (self.state.peRev || 0) + 1 }, extra || {})); };
    var commit = function (doIt, undo, toast, extra) {
      doIt();
      bump(Object.assign({ peSheet: null }, extra || {}));
      if (typeof toast === "function") toast = toast();
      if (toast) self.docToastShow(toast + (off ? L(" \u00b7 saved on this device", " \u00b7 uloženo v zařízení") : ""), undo ? function () {
        undo(); bump({ docToast: null });
      } : null);
    };
    var open = function (d) { return function () { self.setState({ peSheet: Object.assign({ at: self.state.route }, d) }); }; };
    var uid = function (p) { return p + "-p" + (Date.now() % 1000000) + Math.floor(Math.random() * 90 + 10); };
    var slug = function (t) {
      var m = { "á": "a", "č": "c", "ď": "d", "é": "e", "ě": "e", "í": "i", "ň": "n", "ó": "o", "ř": "r", "š": "s", "ť": "t", "ú": "u", "ů": "u", "ý": "y", "ž": "z" };
      var b = String(t).toLowerCase().replace(/[áčďéěíňóřšťúůýž]/g, function (c) { return m[c]; }).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mazlicek";
      var id = b, n = 2;
      while (A.entity(id) || ["new", "routine", "remembered"].indexOf(id) >= 0) id = b + "-" + (n++);
      return id;
    };
    var call = function (num) { return function () { self.docToastShow(L("Calling ", "Volám ") + num, null); }; };

    /* ── the engine, read ── */
    var pets = A.entities.filter(function (e) { return e.module === "pets" && e.status === "active"; });
    var gone = A.entities.filter(function (e) { return e.module === "pets" && e.status !== "active"; });
    var liveIds = pets.map(function (e) { return e.id; });
    var dueOf = function (sc) { return safe(function () { return A.due(sc.id, TD); }, null); };
    var careOf = function (e) {
      return A.schedulesOf(e.id).map(function (sc) { return { sc: sc, d: dueOf(sc) }; }).filter(function (x) { return x.d && x.d.resolved; })
        .sort(function (a, b) { return a.d.resolved < b.d.resolved ? -1 : 1; });
    };
    var polOf = function (e) { return A.insurance.filter(function (p) { return p.entity === e.id; })[0] || null; };
    var noticeOf = function (p) { var fires = A.addDays(p.end, -p.noticeDays); return { fires: fires, inDays: A.diff(TD, fires), passed: fires < TD, lapsed: p.end < TD }; };
    var feedOf = function (e) { return PS.feeding[e.id] || null; };
    var targetOf = function (e) { return PS.target[e.id] || null; };
    var weights = function (e) { return A.readingsOf(e.id, "kg"); };

    /* medication courses, and their doses keyed (dose_occurrence) */
    var meds = function () { return [A.medication].concat(PS.meds); };
    var medsOf = function (e) { return meds().filter(function (m) { return m.entity === e.id; }); };
    var lastDay = function (m) { return A.addDays(m.start, m.days - 1); };
    var medLive = function (m) { return !m.stopped && lastDay(m) >= TD && m.start <= TD; };
    var medPlanned = function (m) { return !m.stopped && m.start > TD; };
    var baseGiven = null;
    function dosesOf(m) {
      if (m.id === A.medication.id && !baseGiven) {
        baseGiven = {};
        safe(function () { return A.doses(TD); }, []).forEach(function (d) { baseGiven[d.date + "|" + d.time] = d.given ? [d.by, d.at] : null; });
      }
      var out = [];
      for (var i = 0; i < m.days; i++) {
        var date = A.addDays(m.start, i);
        m.times.forEach(function (t, j) {
          if (m.stopped && (date > m.stopped || (date === m.stopped && t > (m.stoppedAt || NOW)))) return;
          var key = m.id + "|" + date + "|" + t;
          var g = key in PS.given ? PS.given[key] : (m.id === A.medication.id ? baseGiven[date + "|" + t] : null);
          out.push({ key: key, med: m, date: date, time: t, nth: i * m.times.length + j + 1, given: !!g, by: g ? g[0] : null, at: g ? g[1] : null,
            future: date > TD, late: !g && (date < TD || (date === TD && t < NOW)), today: date === TD });
        });
      }
      return out;
    }
    function toggleDose(d) {
      if (!canC) return;
      if (d.future) { self.docToastShow(L("Rejected: a dose can't be ticked ahead.", "Odmítnuto: dávku nelze zaškrtnout dopředu."), null); return; }
      var had = d.key in PS.given, prev = PS.given[d.key];
      if (d.given) {
        if (!canM && d.by !== me) { self.docToastShow(name(d.by) + L(" recorded it. Only they or an owner can take it back.", " ji zapsal(a). Vrátit ji může jen on(a) nebo správce."), null); return; }
        commit(function () { PS.given[d.key] = null; }, function () { if (had) PS.given[d.key] = prev; else delete PS.given[d.key]; },
          L("Not given after all \u00b7 ", "Nakonec nepodáno \u00b7 ") + day(d.date, false) + " " + d.time);
      } else {
        var other = dosesOf(d.med).filter(function (x) { return x.date === d.date && x.key !== d.key && x.given; })[0];
        commit(function () { PS.given[d.key] = [me, d.date === TD ? NOW : d.time]; }, function () { if (had) PS.given[d.key] = prev; else delete PS.given[d.key]; },
          L("Given \u00b7 ", "Podáno \u00b7 ") + tr(d.med.dose) + (other ? L(" \u00b7 " + name(other.by) + " gave the " + partOf(other.time).toLowerCase() + " one", " \u00b7 " + partOf(other.time).toLowerCase() + " dal(a) " + name(other.by)) : ""));
      }
    }

    /* the daily routine, keyed (routine_item, date) */
    function routineOn(dayIso, e) {
      var base = {};
      safe(function () { return A.routineFor(dayIso); }, []).forEach(function (r) { base[r.id] = r.byId ? [r.byId, r.time] : null; });
      return A.routine.filter(function (r) { return liveIds.indexOf(r.entity) >= 0 && (!e || r.entity === e.id); }).map(function (r) {
        var key = r.id + "|" + dayIso, g = key in PS.routine ? PS.routine[key] : base[r.id];
        return { key: key, item: r, pet: A.entity(r.entity), day: dayIso, done: !!g, by: g ? g[0] : null, time: g ? g[1] : null,
          late: !g && dayIso === TD && r.at && r.at < NOW };
      }).sort(function (a, b) { return (a.item.at || "99") < (b.item.at || "99") ? -1 : (a.item.at || "99") > (b.item.at || "99") ? 1 : 0; });
    }
    function toggleRoutine(x) {
      if (!canC) return;
      var had = x.key in PS.routine, prev = PS.routine[x.key];
      if (x.done) commit(function () { PS.routine[x.key] = null; }, function () { if (had) PS.routine[x.key] = prev; else delete PS.routine[x.key]; }, rtN(x.item) + L(" \u00b7 not done", " \u00b7 neudělané"));
      else commit(function () { PS.routine[x.key] = [me, x.day === TD ? NOW : (x.item.at || "20:00")]; }, function () { if (had) PS.routine[x.key] = prev; else delete PS.routine[x.key]; },
        rtN(x.item) + L(" \u00b7 done", " \u00b7 hotovo") + (x.day !== TD ? L(" yesterday", " včera") : ""));
    }
    var rtRow = function (x, withPet) {
      return row({ check: true, checked: x.done, dot: true, dotInk: x.late ? "var(--warning)" : "", title: rtN(x.item), strike: x.done, muted: x.done,
        sub: [withPet ? pN(x.pet) : "", x.done ? name(x.by) + " \u00b7 " + x.time : x.item.at ? (x.late ? L("since ", "od ") : L("at ", "v ")) + x.item.at : L("any time", "kdykoli")].filter(Boolean).join(" \u00b7 "),
        subTone: !x.done && x.late ? "warn" : "", noChev: true, open: canC ? function () { toggleRoutine(x); } : null,
        badge: off && PS.routine.hasOwnProperty(x.key) ? L("pending", "čeká") : "", badgeTone: "offline" });
    };
    var doseRow = function (d, withPet) {
      return row({ check: true, checked: d.given, dot: true, dotInk: d.late ? "var(--warning)" : "", strike: d.given, muted: d.given || d.future,
        title: (withPet ? pN(A.entity(d.med.entity)) + " \u00b7 " : "") + d.med.cs + " \u00b7 " + partOf(d.time).toLowerCase(),
        sub: d.given ? L("given by ", "podal(a) ") + name(d.by) + " \u00b7 " + d.at : d.future ? L("can't be ticked ahead", "dopředu zaškrtnout nejde") : (d.late ? L("since ", "od ") : L("at ", "v ")) + d.time + " \u00b7 " + tr(d.med.dose),
        subTone: !d.given && d.late ? "warn" : "", right: "#" + d.nth, tone: "muted", noChev: true, open: canC && !d.future ? function () { toggleDose(d); } : null,
        badge: off && PS.given.hasOwnProperty(d.key) ? L("pending", "čeká") : "", badgeTone: "offline" });
    };

    /* dates: regular care and the insurance notice */
    function datesOf(e) {
      var out = [];
      careOf(e).forEach(function (x) {
        out.push({ e: e, kind: "care", date: x.d.resolved, overdue: x.d.resolved < TD, title: schN(x.sc) + " \u00b7 " + pN(e), sub: months(x.sc.months) + L(" \u00b7 last ", " \u00b7 naposledy ") + day(x.sc.lastDone), x: x, route: "/pets/" + e.id + "/care" });
      });
      var pol = polOf(e);
      if (pol) {
        var n = noticeOf(pol);
        if (!n.lapsed && !n.passed) out.push({ e: e, kind: "ins", date: n.fires, overdue: false, title: L("Insurance notice ends \u00b7 ", "Končí výpovědní lhůta \u00b7 ") + pN(e), sub: pol.insurer + L(" \u00b7 renews ", " \u00b7 obnova ") + day(pol.end, false), route: "/pets/" + e.id + "/insurance" });
      }
      return out;
    }
    var allDates = pets.reduce(function (a, e) { return a.concat(datesOf(e)); }, []).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var dateRow = function (x, withPet) {
      var n = A.diff(TD, x.date);
      return row({ title: withPet === false ? x.title.replace(" \u00b7 " + pN(x.e), "") : x.title, sub: x.sub, right: x.overdue ? -n + L(" d late", " d po") : n === 0 ? L("today", "dnes") : day(x.date, false),
        tone: x.overdue ? "danger" : n <= 14 ? "accent" : "", rightSub: x.overdue ? L("was ", "bylo ") + day(x.date, false) : inW(n),
        badge: x.overdue ? L("overdue", "po termínu") : "", badgeTone: "danger",
        act: canC && x.kind === "care" ? L("Done", "Hotovo") : "", onAct: canC && x.kind === "care" ? open(healthDraft(x.e, x.x.sc)) : null, open: go(x.route) });
    };
    var hRow = function (h, withPet) {
      return row({ title: hN(h), sub: [htN(h.type), withPet ? pN(A.entity(h.entity)) : "", hMeta(h), h.vet || "", h.docs ? h.docs + L(" doc", " dok.") : ""].filter(Boolean).join(" \u00b7 "),
        right: h.cost ? czk(h.cost) : "", rightSub: day(h.date), dot: true, dotInk: h.type === "condition" ? "var(--warning)" : h.type === "vaccination" ? "var(--positive)" : "var(--border-strong)",
        badge: h.queued && off ? L("pending", "čeká") : "", badgeTone: "offline", open: open({ kind: "healthView", id: h.id }) });
    };
    var docsOK = grants.documents && grants.documents !== "none";

    /* drafts */
    function healthDraft(e, sc, type) {
      var t = type || (sc ? (/kování/.test(sc.cs) ? "vaccination" : "treatment") : "vaccination");
      return { kind: "health", entity: e.id, type: t, sch: sc ? sc.id : "", what: sc ? schN(sc) : "", date: TD, vet: "", cost: "", meta: "", kg: "", err: "" };
    }
    function weightDraft(e) { return { kind: "weight", entity: e.id, value: "", date: TD, where: "home", err: "" }; }
    function petDraft(e) {
      if (e) return { kind: "pet", edit: e.id, name: pN(e), species: e.species || "other", breed: e.breed || "", sex: sexOf(e), neutered: !!e.neutered, born: e.born || "", chip: e.chip || "", acquired: e.acquired || "", starter: false, err: "" };
      return { kind: "pet", edit: null, name: "", species: "dog", breed: "", sex: "", neutered: false, born: "", chip: "", acquired: TD, starter: true, err: "" };
    }
    function medDraft(e) { return { kind: "med", entity: e.id, name: "", reason: "", dose: "", times: ["07:00", "19:00"], days: "10", start: TD, err: "" }; }
    function careDraft(e, sc) {
      if (sc) return { kind: "care", entity: e.id, edit: sc.id, name: schN(sc), months: String(sc.months || ""), lastDone: sc.lastDone, err: "" };
      return { kind: "care", entity: e.id, edit: null, name: "", months: "12", lastDone: TD, err: "" };
    }
    function rtDraft(e, r) {
      if (r) return { kind: "routine", edit: r.id, entity: r.entity, name: rtN(r), at: r.at || "", err: "" };
      return { kind: "routine", edit: null, entity: e ? e.id : (pets[0] ? pets[0].id : ""), name: "", at: "", err: "" };
    }
    function polDraft(e, p) {
      if (p) return { kind: "policy", entity: e.id, edit: p.id, insurer: p.insurer, type: tr(p.type), number: p.number || "", premium: String(p.premium), start: p.start, end: p.end, notice: String(p.noticeDays), err: "" };
      return { kind: "policy", entity: e.id, edit: null, insurer: "", type: L("Vet fees cover", "Pojištění léčebných výloh"), number: "", premium: "", start: TD, end: A.addDays(A.addMonths(TD, 12), -1), notice: "30", err: "" };
    }
    function feedDraft(e) {
      var f = feedOf(e) || {};
      return { kind: "feeding", entity: e.id, food: f.food || "", amount: f.amount || "", times: (f.times || []).join(", "), treats: tr(f.treats || ""), note: tr(f.note || ""), err: "" };
    }

    /* ── route ── */
    var page = "home", cur = null;
    var eng = seg[0] === "assets";
    var a = eng ? (seg[2] || "") : (seg[1] || ""), b = eng ? (seg[3] || "") : (seg[2] || ""), c = eng ? "" : (seg[3] || "");
    if (eng) b = { records: "health", readings: "weight", schedules: "care" }[b] || b;
    var SUBS = { health: 1, medication: 1, vet: 1, feeding: 1, weight: 1, insurance: 1, care: 1, status: 1 };
    if (!a || a === "new") page = "home";
    else if (a === "routine") page = "routine";
    else if (a === "remembered") page = "remembered";
    else {
      cur = A.entity(a);
      if (!cur || cur.module !== "pets") page = "missing";
      else if (!b || b === "edit") page = "item";
      else if (SUBS[b]) page = b;
      else page = "missing";
    }
    var itemRoot = cur ? "/pets/" + cur.id : "/pets";

    var routeSheet = null;
    if (a === "new" && canC) routeSheet = Object.assign(petDraft(null), { back: "/pets" });
    if (page === "item" && b === "edit" && canC) routeSheet = Object.assign(petDraft(cur), { back: itemRoot });
    if (page === "health" && c === "new" && canC && cur.status === "active") routeSheet = Object.assign(healthDraft(cur, null), { back: itemRoot + "/health" });
    if (page === "weight" && c === "new" && canC && cur.status === "active") routeSheet = Object.assign(weightDraft(cur), { back: itemRoot + "/weight" });
    if (page === "medication" && c === "new" && canM && cur.status === "active") routeSheet = Object.assign(medDraft(cur), { back: itemRoot + "/medication" });
    var sheetD = (s.peSheet && s.peSheet.at === s.route) ? s.peSheet : routeSheet;
    var patch = function (p) { self.setState({ peSheet: Object.assign({}, sheetD, { at: self.state.route }, p) }); };
    var closeSheet = function () { var back = sheetD && sheetD.back; self.setState(Object.assign({ peSheet: null }, back ? { route: back } : {})); };

    var P = [], headTitle = L("Pets", "Mazlíčci"), headSub = "";
    var push = function (x) { if (x) P.push(x); };
    var readNote = ro ? L("Read-only while the subscription is past due. Everything recorded still reads, and the vet's number still calls.", "Jen ke čtení, dokud se předplatné neobnoví. Vše zapsané zůstává čitelné a na veterináře se dá dovolat.")
      : lvl === "view" ? L("You can see Pets. Ticking the routine or a dose needs contribute.", "Mazlíčky vidíte. Odškrtnout režim nebo dávku vyžaduje přispívání.") : "";
    if (readNote) push(note(readNote, "box"));
    if (off) push(note(L("Offline. The routine, the doses, the vet card and the health record are all on this device. Ticks and new entries queue and go up with the signal.",
      "Offline. Režim, dávky, kartička k veterináři i zdravotní záznam jsou v zařízení. Odškrtnutí a nové zápisy se řadí do fronty a odejdou se signálem."), "boxOff"));

    var vetRow = function () {
      var V = A.vet;
      return row({ title: L("Out of hours", "Pohotovost"), sub: V.outOfHours + " \u00b7 " + tr(V.outOfHoursNote), dot: true, dotInk: "var(--danger)", act: L("Call", "Volat"), onAct: call(V.outOfHours), open: cur ? go(itemRoot + "/vet") : go("/pets/" + (pets[0] ? pets[0].id : "") + "/vet") });
    };

    /* ═══ pages ═══ */
    if (page === "missing") {
      push(empty(L("Not in this household", "V téhle domácnosti není"), L("The address is wrong, or it was never here.", "Adresa nesedí, nebo tu nikdy nebyl(a)."), L("Back to Pets", "Zpět na Mazlíčky"), go("/pets")));
    }

    if (page === "home") {
      headTitle = L("Pets", "Mazlíčci"); headSub = pets.length ? pets.map(pN).join(", ") : "";
      if (isEmpty || !pets.length) {
        var EM = A.empty.pets;
        push(empty(cs ? EM.s : "Who lives with you, and what you do for them every day.",
          cs ? EM.e : "Bela, for example \u2014 walks morning and evening, a tablet twice a day.",
          canC ? (cs ? EM.a : "Add a pet") : "", open(petDraft(null))));
        if (gone.length) push(rows([row({ title: L("Remembered", "Bylo nám spolu dobře"), sub: gone.map(pN).join(", "), open: go("/pets/remembered") })]));
      } else {
        var rtT = routineOn(TD), dT = [];
        pets.forEach(function (e) { medsOf(e).filter(medLive).forEach(function (m) { dT = dT.concat(dosesOf(m).filter(function (d) { return d.today; })); }); });
        var openT = rtT.filter(function (x) { return !x.done; }).map(function (x) { return { at: x.item.at || "99", title: rtN(x.item), late: x.late, pet: x.pet }; })
          .concat(dT.filter(function (d) { return !d.given; }).map(function (d) { return { at: d.time, title: partOf(d.time) + L(" tablet", " tabletka") + " \u00b7 " + d.med.cs, late: d.late, pet: A.entity(d.med.entity) }; }))
          .sort(function (x, y) { return x.at < y.at ? -1 : 1; });
        var lateT = openT.filter(function (x) { return x.late; }), nextT = openT.filter(function (x) { return !x.late && x.at !== "99"; })[0];
        var careD = allDates.filter(function (x) { return x.kind === "care" && A.diff(TD, x.date) <= 0; });
        push(hero({ kicker: wday(TD) + " \u00b7 " + day(TD, false),
          big: !openT.length ? L("All done for today", "Na dnes je hotovo") : lateT.length ? pN(lateT[0].pet) + ": " + lateT[0].title.toLowerCase() + L(" is waiting", " čeká") : nextT ? nextT.title + " " + L("at ", "v ") + nextT.at : openT.length + L(" things left today", " věcí zbývá"),
          tone: lateT.length ? "warn" : !openT.length ? "ok" : "",
          sub: lateT.length > 1 ? L("and " + (lateT.length - 1) + " more past their time", "a " + (lateT.length - 1) + " další po čase") : nextT && lateT.length ? L("Next: ", "Pak: ") + nextT.title.toLowerCase() + " " + nextT.at : "",
          stats: [stat(L("Routine", "Režim"), rtT.filter(function (x) { return x.done; }).length + "/" + rtT.length, L("done today", "dnes hotovo")),
            dT.length ? stat(L("Doses", "Dávky"), dT.filter(function (d) { return d.given; }).length + "/" + dT.length, L("today", "dnes"), dT.some(function (d) { return d.late; }) ? "warn" : "") : null,
            careD.length ? stat(L("Care due", "Péče na řadě"), String(careD.length), careD.map(function (x) { return schN(x.x.sc).toLowerCase(); }).join(", "), "accent") : allDates[0] ? stat(L("Next care", "Další péče"), day(allDates[0].date, false), schN((allDates[0].x || {}).sc || { cs: "" }) || allDates[0].title) : null] }));
        if (canC && !wide) push(acts([btn(L("Log something", "Zapsat"), "primary", open(healthDraft(pets[0], null, "note"))), btn(L("+ Pet", "+ Mazlíček"), "", open(petDraft(null)))]));
        push(label(L("Today", "Dnes"), L("Daily routine", "Denní režim"), go("/pets/routine")));
        var todayRows = dT.map(function (d) { return { at: d.time, done: d.given, r: doseRow(d, pets.length > 1) }; })
          .concat(rtT.map(function (x) { return { at: x.item.at || "99", done: x.done, r: rtRow(x, pets.length > 1) }; }));
        var openRows = todayRows.filter(function (x) { return !x.done; }).sort(function (x, y) { return x.at < y.at ? -1 : 1; });
        var doneRows = todayRows.filter(function (x) { return x.done; });
        push(rows(openRows.map(function (x) { return x.r; }).concat(doneRows.length ? [row({ title: doneRows.length + L(" done", " hotovo"), muted: true,
          sub: rtT.filter(function (x) { return x.done; }).map(function (x) { return name(x.by); }).concat(dT.filter(function (d) { return d.given; }).map(function (d) { return name(d.by); })).filter(function (v, i, arr) { return arr.indexOf(v) === i; }).join(", "),
          open: go("/pets/routine") })] : [])));
        if (!openRows.length) push(note(L("Everything on today's list is ticked. It starts again at midnight.", "Všechno na dnešním seznamu je odškrtnuté. Od půlnoci začne znovu.")));
        var near = allDates.filter(function (x) { return A.diff(TD, x.date) <= 45; });
        push(label(L("Coming up", "Na řadě")));
        push(near.length ? rows(near.map(function (x) { return dateRow(x); })) : note(L("Nothing in the next six weeks. Next: ", "Šest týdnů nic. Pak: ") + (allDates[0] ? allDates[0].title + " " + day(allDates[0].date, false) : L("nothing set", "nic nenastaveno")) + "."));
        push(label(L("Who lives here", "Kdo u nás žije"), canC ? L("+ Pet", "+ Mazlíček") : "", open(petDraft(null))));
        push(rows(pets.map(function (e) {
          var ds = datesOf(e)[0], left = routineOn(TD, e).filter(function (x) { return !x.done; }).length;
          return row({ title: pN(e), sub: [catN(e.category), ageOf(e), left ? left + L(" left today", " zbývá dnes") : L("all done today", "dnes hotovo")].filter(Boolean).join(" \u00b7 "),
            right: ds ? (ds.overdue ? L("overdue", "po termínu") : A.diff(TD, ds.date) === 0 ? L("today", "dnes") : day(ds.date, false)) : "", tone: ds && ds.overdue ? "danger" : ds && A.diff(TD, ds.date) <= 14 ? "accent" : "",
            rightSub: ds ? (ds.kind === "care" ? schN(ds.x.sc) : L("insurance", "pojištění")) : "", badge: e.queued && off ? L("pending", "čeká") : "", badgeTone: "offline", open: go("/pets/" + e.id) });
        })));
        push(rows([vetRow()]));
        if (gone.length && !wide) push(rows([row({ title: L("Remembered", "Bylo nám spolu dobře"), sub: gone.map(pN).join(", ") + L(" \u00b7 every record kept", " \u00b7 záznamy zůstávají celé"), muted: true, open: go("/pets/remembered") })]));
      }
    }

    if (page === "routine") {
      var showY = s.peDay === "y", dIso = showY ? YD : TD, list = routineOn(dIso);
      headTitle = L("Daily routine", "Denní režim"); headSub = list.filter(function (x) { return x.done; }).length + L(" of ", " z ") + list.length + (showY ? L(" yesterday", " včera") : L(" today", " dnes"));
      push(chips("", [chip(L("Today", "Dnes"), !showY, function () { self.setState({ peDay: "t" }); }), chip(L("Yesterday", "Včera"), showY, function () { self.setState({ peDay: "y" }); })],
        showY ? L("Yesterday can still be ticked if somebody forgot. Earlier days can't.", "Včerejšek jde ještě dodatečně odškrtnout. Dřívější dny ne.") : ""));
      if (!list.length || isEmpty) {
        var RE = A.screens.filter(function (x) { return x.id === "E-31"; })[0];
        push(empty(cs && RE ? RE.empty.s : "What do you do for them every day?", cs && RE ? RE.empty.e : "A walk in the morning, food morning and evening, fresh water.", canM ? (cs && RE ? RE.empty.a : "Add to the routine") : "", open(rtDraft(null, null))));
      } else {
        pets.forEach(function (e) {
          var mine = list.filter(function (x) { return x.pet.id === e.id; });
          if (!mine.length) return;
          push(label(pN(e) + " \u00b7 " + mine.filter(function (x) { return x.done; }).length + "/" + mine.length, canM ? L("+ Add", "+ Přidat") : "", open(rtDraft(e, null))));
          push(rows(mine.map(function (x) { var r0 = rtRow(x, false); if (canM) { r0.act = L("Edit", "Upravit"); r0.onAct = open(rtDraft(e, x.item)); } return r0; })));
        });
        var noRt = pets.filter(function (e) { return !list.some(function (x) { return x.pet.id === e.id; }); });
        if (noRt.length && canM) push(rows(noRt.map(function (e) { return row({ title: pN(e), sub: L("Nothing in the routine yet", "V režimu zatím nic"), muted: true, act: L("Add", "Přidat"), onAct: open(rtDraft(e, null)) }); })));
        push(note(L("Anyone can tick, and the name and time go on it. Two people ticking the evening feed is one tick. It resets at midnight \u2014 there is no rotation, no points and no swapping; that's what Chores is for.",
          "Odškrtnout může kdokoli a u položky zůstane jméno a čas. Když večerní krmení odškrtnou dva, je to jedno odškrtnutí. O půlnoci se vynuluje \u2014 žádné střídání, body ani výměny; na to jsou Úkoly v domácnosti.")));
      }
    }

    if (page === "remembered") {
      headTitle = L("Remembered", "Bylo nám spolu dobře");
      if (!gone.length) push(empty(L("Nobody here.", "Nikdo tu není."), L("When a pet is no longer with you, their whole record stays and opens from here.", "Když už mazlíček není s vámi, celý záznam zůstane a otevře se odsud."), "", null));
      else push(rows(gone.map(function (e) {
        return row({ title: pN(e), sub: [e.status === "rehomed" ? L("went to live with ", "žije u ") + (e.rehomedTo || L("someone else", "někoho jiného")) : (e.born ? e.born.slice(0, 4) + "\u2013" : "") + (e.ended ? e.ended.slice(0, 4) : ""),
          A.healthOf(e.id).length + L(" health entries kept", " zdravotních záznamů zůstává")].join(" \u00b7 "), muted: true, open: go("/pets/" + e.id) });
      })));
    }

    if (page === "item") {
      var e = cur, live = e.status === "active", f0 = feedOf(e), w0 = weights(e), lw = w0[w0.length - 1], tg0 = targetOf(e);
      headTitle = pN(e); headSub = [catN(e.category), ageOf(e)].filter(Boolean).join(" \u00b7 ");
      if (!live) push(note(e.status === "rehomed" ? L("Went to live with " + (e.rehomedTo || "someone else") + " on " + day(e.ended) + ". The record stays here and isn't sent anywhere.", "Od " + day(e.ended) + " žije u " + (e.rehomedTo || "někoho jiného") + ". Záznam zůstává u vás a nikam se neposílá.")
        : L("Died " + day(e.ended) + ". No routine, no reminders; everything else is kept.", "Zemřel(a) " + day(e.ended) + ". Žádný režim ani připomínky; všechno ostatní zůstává.") + (e.endNote ? " " + e.endNote : ""), "box",
        canM ? L("That was a mistake", "To byl omyl") : "", canM ? function () {
          var old = { status: e.status, ended: e.ended, endNote: e.endNote, rehomedTo: e.rehomedTo };
          commit(function () { e.status = "active"; delete e.ended; delete e.endNote; delete e.rehomedTo; }, function () { Object.assign(e, old); }, pN(e) + L(" is back in the list", " je zpět v seznamu"));
        } : null));
      if (e.queued && off) push(note(L("Added on this device. Everything works; it goes up with the signal.", "Přidáno v zařízení. Všechno funguje; odejde se signálem."), "boxOff"));
      if (live) {
        var rt0 = routineOn(TD, e), dm0 = medsOf(e).filter(medLive), dd0 = [];
        dm0.forEach(function (m) { dd0 = dd0.concat(dosesOf(m).filter(function (d) { return d.today; })); });
        var open0 = rt0.filter(function (x) { return !x.done; }).length + dd0.filter(function (d) { return !d.given; }).length;
        var ds0 = datesOf(e), lead0 = ds0[0];
        push(hero({ kicker: [catN(e.category), sexN(e), ageOf(e)].filter(Boolean).join(" \u00b7 "),
          big: open0 ? open0 + L(open0 === 1 ? " thing left today" : " things left today", open0 === 1 ? " věc zbývá dnes" : " věci zbývají dnes") : L("All done for today", "Na dnes hotovo"), tone: open0 ? "" : "ok",
          sub: lead0 ? schN((lead0.x || {}).sc || { cs: lead0.title }) + " " + (lead0.overdue ? L("is overdue", "je po termínu") : inW(A.diff(TD, lead0.date))) : "",
          stats: [lw ? stat(L("Weight", "Váha"), kg(lw.milli), day(lw.date, false) + (tg0 ? " \u00b7 " + (lw.milli / 1000 < tg0.min || lw.milli / 1000 > tg0.max ? L("outside range", "mimo rozmezí") : L("in range", "v rozmezí")) : ""), tg0 && (lw.milli / 1000 < tg0.min || lw.milli / 1000 > tg0.max) ? "warn" : "") : stat(L("Weight", "Váha"), "\u2013", L("not weighed yet", "zatím nevážen(a)"), "muted"),
            dm0.length ? stat(L("Medication", "Léky"), dm0[0].cs, L("until ", "do ") + day(lastDay(dm0[0]), false)) : null,
            stat(L("Health record", "Zdravotní záznam"), String(A.healthOf(e.id).length), L("entries", "záznamů"))] }));
        push(rows([vetRow()]));
        push(acts([canC ? btn(L("Log something", "Zapsat"), "primary", open(healthDraft(e, null, "note"))) : null, canC ? btn(L("Weigh", "Zvážit"), "", open(weightDraft(e))) : null, canC ? btn(L("Edit", "Upravit"), "", open(petDraft(e))) : null]));
        push(label(L("Today", "Dnes"), L("Routine", "Režim"), go("/pets/routine")));
        push(rt0.length || dd0.length ? rows(dd0.map(function (d) { return doseRow(d, false); }).concat(rt0.map(function (x) { return rtRow(x, false); })))
          : note(L("Nothing in the daily routine.", "V denním režimu nic není."), "", canM ? L("Add to the routine", "Přidat do režimu") : "", open(rtDraft(e, null))));
        if (ds0.length) { push(label(L("Coming up", "Na řadě"))); push(rows(ds0.map(function (x) { return dateRow(x, false); }))); }
      }
      var pol0 = polOf(e), md0 = medsOf(e), hs0 = A.healthOf(e.id), cr0 = careOf(e);
      push(label(L("For ", "Pro ") + pN(e)));
      push(rows([
        row({ title: L("Health record", "Zdravotní záznam"), sub: hs0.length ? hs0.length + L(" entries \u00b7 latest ", " záznamů \u00b7 poslední ") + hN(hs0[0]) : L("Nothing yet", "Zatím nic"), muted: !hs0.length, open: go(itemRoot + "/health") }),
        row({ title: L("Medication", "Léky po dávkách"), sub: md0.filter(medLive).length ? md0.filter(medLive).map(function (m) { var dd = dosesOf(m); return m.cs + " \u00b7 " + dd.filter(function (d) { return d.given; }).length + "/" + dd.length + L(" given", " podáno"); }).join(", ") : L("Nothing right now", "Teď nic"), muted: !md0.filter(medLive).length, open: go(itemRoot + "/medication") }),
        row({ title: L("Regular care", "Pravidelná péče"), sub: cr0.length ? cr0.map(function (x) { return schN(x.sc).toLowerCase(); }).join(", ") : L("None set", "Nic nenastaveno"), muted: !cr0.length, open: go(itemRoot + "/care") }),
        row({ title: L("Vet card", "Kartička k veterináři"), sub: A.vet.practice + " \u00b7 " + A.vet.phone, open: go(itemRoot + "/vet") }),
        row({ title: L("Feeding and allergies", "Krmení a alergie"), sub: f0 ? f0.food + " \u00b7 " + f0.amount + " \u00d7 " + f0.meals + (f0.never && f0.never.length ? L(" \u00b7 " + f0.never.length + " things never", " \u00b7 " + f0.never.length + " věci nesmí") : "") : L("Not filled in", "Nevyplněno"), muted: !f0, subTone: "", open: go(itemRoot + "/feeding") }),
        row({ title: L("Weight", "Váha"), sub: lw ? kg(lw.milli) + " \u00b7 " + w0.length + L(" weighings", " vážení") + (tg0 ? " \u00b7 " + L("target ", "cíl ") + tg0.min + "\u2013" + tg0.max + " kg" : "") : L("Not weighed yet", "Zatím nevážen(a)"), muted: !lw, open: go(itemRoot + "/weight") }),
        row({ title: L("Insurance", "Pojištění"), sub: pol0 ? pol0.insurer + L(" \u00b7 renews ", " \u00b7 obnova ") + day(pol0.end, false) : L("Not entered", "Nezadáno"), muted: !pol0, open: go(itemRoot + "/insurance") }),
        row({ title: L("Costs", "Náklady"), sub: L("Food, insurance, vet and the rest, per year", "Krmivo, pojištění, veterinář a ostatní, po letech"), open: go(itemRoot + "/costs") })
      ]));
      push(label(e.species === "dog" || e.species === "cat" ? L("About ", "O ") + pN(e) : L("Details", "Údaje")));
      push(kv([[L("Species", "Druh"), catN(e.category) || spN(e.species)], [L("Sex", "Pohlaví"), sexN(e) + (e.neutered ? L(" \u00b7 neutered", " \u00b7 kastrovaný(á)") : "")],
        [L("Born", "Narozen(a)"), e.born ? day(e.born) : ""], [L("With us since", "U nás od"), e.acquired ? day(e.acquired) : ""],
        [L("Microchip", "Čip"), e.chip || ""], e.ended ? [e.status === "rehomed" ? L("Rehomed", "Předán(a)") : L("Died", "Zemřel(a)"), day(e.ended)] : null]));
      if (e.docs) { push(label(L("Documents", "Dokumenty"))); push(rows([row({ title: e.docs + L(e.docs === 1 ? " document" : " documents", " dokumenty"), sub: L("pet passport, vaccination card, vet reports", "pas, očkovací průkaz, zprávy od veterináře"), open: docsOK ? go("/documents") : null })])); }
      if (live && canM) push(acts([btn(L(pN(e) + " is no longer with us", pN(e) + " u nás už není"), "", go(itemRoot + "/status"))]));
    }

    if (page === "health") {
      var e2 = cur, all2 = A.healthOf(e2.id), ft = s.peType && HT[s.peType] ? s.peType : "";
      var hs2 = all2.filter(function (h) { return !ft || h.type === ft; });
      headTitle = L("Health record", "Zdravotní záznam"); headSub = pN(e2);
      if (!all2.length || isEmpty) {
        var HE = A.screens.filter(function (x) { return x.id === "E-29"; })[0];
        push(empty(cs && HE ? HE.empty.s : "Nothing here yet.", cs && HE ? HE.empty.e : "Start with the last vaccination \u2014 the date and what it was.", canC ? (cs && HE ? HE.empty.a : "Add an entry") : "", open(healthDraft(e2, null))));
      } else {
        var spent2 = all2.reduce(function (n, h) { return n + (h.cost || 0); }, 0);
        push(hero({ kicker: all2.length + L(" entries since ", " záznamů od ") + day(all2[all2.length - 1].date), big: czk(spent2), sub: L("at the vet, from the entries that carry a cost", "u veterináře, ze záznamů s cenou"),
          stats: [stat(L("Ongoing", "Trvá"), String(all2.filter(function (h) { return h.type === "condition"; }).length), all2.filter(function (h) { return h.type === "condition"; }).map(hN).join(", ") || L("nothing", "nic")),
            stat(L("Last vaccination", "Poslední očkování"), (all2.filter(function (h) { return h.type === "vaccination"; })[0] || {}).date ? day(all2.filter(function (h) { return h.type === "vaccination"; })[0].date, false) : "\u2013")] }));
        if (canC && e2.status === "active") push(acts([btn(L("Add an entry", "Přidat záznam"), "primary", open(healthDraft(e2, null)))]));
        push(chips("", [chip(L("All", "Vše") + " " + all2.length, !ft, function () { self.setState({ peType: "" }); })].concat(HT_ORDER.filter(function (t) { return all2.some(function (h) { return h.type === t; }); }).map(function (t) {
          return chip(htN(t) + " " + all2.filter(function (h) { return h.type === t; }).length, ft === t, function () { self.setState({ peType: ft === t ? "" : t }); });
        }))));
        var byY = {}; hs2.forEach(function (h) { var y = h.date.slice(0, 4); (byY[y] = byY[y] || []).push(h); });
        Object.keys(byY).sort().reverse().forEach(function (y) { push(label(y)); push(rows(byY[y].map(function (h) { return hRow(h); }))); });
        push(note(L("One dated timeline for everything \u2014 what you're asked for at the vet. Adding works offline; changing an entry needs manage.", "Jedna časová osa pro všechno \u2014 to, na co se ptá veterinář. Přidat jde i offline; upravit záznam vyžaduje správu.")));
      }
    }

    if (page === "medication") {
      var e3 = cur, ms3 = medsOf(e3), live3 = ms3.filter(medLive), plan3 = ms3.filter(medPlanned), past3 = ms3.filter(function (m) { return !medLive(m) && !medPlanned(m); });
      headTitle = L("Medication", "Léky po dávkách"); headSub = pN(e3);
      if (!live3.length && !plan3.length || isEmpty) {
        var ME = A.screens.filter(function (x) { return x.id === "E-30"; })[0];
        push(empty(cs && ME ? ME.empty.s : "No medication right now.", cs && ME ? ME.empty.e : "Antibiotics twice a day for ten days \u2014 twenty boxes to tick.", canM && e3.status === "active" ? (cs && ME ? ME.empty.a : "Add medication") : "", open(medDraft(e3))));
      }
      live3.concat(plan3).forEach(function (m) {
        var dd = dosesOf(m), gv = dd.filter(function (d) { return d.given; }), dT3 = dd.filter(function (d) { return d.today; });
        var byDay = {}; dd.forEach(function (d) { (byDay[d.date] = byDay[d.date] || []).push(d); });
        var missed = dd.filter(function (d) { return d.late && !d.today; });
        push(hero({ kicker: m.cs + " \u00b7 " + tr(m.dose) + " \u00b7 " + m.times.length + L("\u00d7 a day", "\u00d7 denně"), big: gv.length + L(" of ", " z ") + dd.length + L(" given", " podáno"),
          tone: missed.length ? "warn" : "",
          sub: (medPlanned(m) ? L("Starts ", "Začíná ") + day(m.start) : day(m.start, false) + " \u2013 " + day(lastDay(m))) + (m.reason ? " \u00b7 " + tr(m.reason) : "") + (m.vet ? " \u00b7 " + m.vet : ""),
          stats: [stat(L("Days left", "Zbývá dní"), String(Math.max(0, A.diff(TD, lastDay(m)) + (medPlanned(m) ? 0 : 1))), L("including today", "včetně dneška")),
            stat(L("Given by", "Podávali"), String(gv.map(function (d) { return d.by; }).filter(function (v, i, arr) { return arr.indexOf(v) === i; }).length), gv.map(function (d) { return name(d.by); }).filter(function (v, i, arr) { return arr.indexOf(v) === i; }).join(", ") || "\u2013"),
            missed.length ? stat(L("Not recorded", "Nezapsáno"), String(missed.length), L("earlier doses", "dřívějších dávek"), "warn") : null] }));
        if (dT3.length) { push(label(L("Today", "Dnes"))); push(rows(dT3.map(function (d) { return doseRow(d, false); }))); }
        var pastDays = Object.keys(byDay).filter(function (x) { return x < TD; }).sort().reverse(), nextDays = Object.keys(byDay).filter(function (x) { return x > TD; }).sort();
        if (pastDays.length) {
          push(label(L("Earlier", "Dříve")));
          push(rows(pastDays.map(function (x) {
            var ds = byDay[x], g = ds.filter(function (d) { return d.given; });
            return row({ title: wday(x), sub: g.length === ds.length ? g.map(function (d) { return partOf(d.time).toLowerCase() + " " + name(d.by); }).join(" \u00b7 ") : ds.filter(function (d) { return !d.given; }).map(function (d) { return partOf(d.time).toLowerCase(); }).join(", ") + L(" not recorded", " nezapsáno"),
              subTone: g.length === ds.length ? "" : "warn", right: g.length + "/" + ds.length, tone: g.length === ds.length ? "ok" : "warn", open: open({ kind: "doseDay", med: m.id, date: x }) });
          })));
        }
        if (nextDays.length) {
          push(label(L("Still to come", "Ještě přijde")));
          push(rows([row({ title: nextDays.length + L(nextDays.length === 1 ? " day" : " days", " dní") + " \u00b7 " + byDay[nextDays[0]].length * nextDays.length + L(" doses", " dávek"), sub: day(nextDays[0], false) + " \u2013 " + day(nextDays[nextDays.length - 1], false) + L(" \u00b7 they can be ticked on the day", " \u00b7 zaškrtnout jdou až v ten den"), muted: true })]));
        }
        if (canM) push(acts([btn(L("Stop the course early", "Ukončit dřív"), "danger-ghost", function () {
          commit(function () { m.stopped = TD; m.stoppedAt = NOW; }, function () { delete m.stopped; delete m.stoppedAt; }, m.cs + L(" stopped \u00b7 the doses given stay recorded", " ukončeno \u00b7 podané dávky zůstávají zapsané"));
        }, off)]));
      });
      var hp3 = (A.help || []).filter(function (h) { return h.id === "pets.dose.shared"; })[0];
      if (live3.length && hp3) push(note((cs ? hp3.title : hp3.en.title) + " " + (cs ? hp3.body : hp3.en.body), "box"));
      if ((live3.length || plan3.length) && canM && e3.status === "active") push(acts([btn(L("+ Another medication", "+ Další lék"), "", open(medDraft(e3)), off)]));
      if (off && canM) push(note(L("A dose schedule needs a connection to add or stop \u2014 two offline versions of one course would be two different treatments. Ticking doses works offline.", "Přidat nebo ukončit lék jde jen online \u2014 dvě offline verze jedné léčby by byly dvě různé léčby. Odškrtávat dávky jde offline."), "offline"));
      if (past3.length) {
        push(label(L("Finished", "Dokončené")));
        push(rows(past3.map(function (m) { var dd = dosesOf(m); return row({ title: m.cs, sub: day(m.start, false) + " \u2013 " + day(m.stopped || lastDay(m), false) + " \u00b7 " + dd.filter(function (d) { return d.given; }).length + "/" + dd.length + L(" given", " podáno") + (m.stopped ? L(" \u00b7 stopped early", " \u00b7 ukončeno dřív") : ""), muted: true }); })));
      }
    }

    if (page === "care") {
      var e4 = cur, l4 = A.schedulesOf(e4.id);
      headTitle = L("Regular care", "Pravidelná péče"); headSub = pN(e4);
      if (!l4.length) push(empty(L("Nothing regular yet.", "Zatím nic pravidelného."), L("Vaccination every year, worming every three months.", "Očkování každý rok, odčervení každé tři měsíce."), canM ? L("Add regular care", "Přidat péči") : "", open(careDraft(e4, null))));
      l4.forEach(function (sc) {
        var d = dueOf(sc); if (!d) return;
        var od = d.resolved < TD, n = A.diff(TD, d.resolved);
        push(label(schN(sc), canM ? L("Edit", "Upravit") : "", open(careDraft(e4, sc))));
        push(kv([[L("How often", "Jak často"), months(sc.months)], [L("Last done", "Naposledy"), day(sc.lastDone)], [L("Next", "Příště"), day(d.resolved) + " \u00b7 " + inW(n)], sc.fromSpecies ? [L("Interval from", "Interval podle"), L("the species \u2014 change it if your vet says otherwise", "druhu \u2014 změňte, pokud veterinář říká jinak")] : null]));
        if (od || n <= 14) push(note(od ? L("Overdue since " + day(d.resolved, false) + ".", "Po termínu od " + day(d.resolved, false) + ".") : L("Due " + inW(n) + ".", "Na řadě " + inW(n) + "."), od ? "boxDanger" : "boxWarn"));
        if (canC && e4.status === "active") push(acts([btn(L("Log it as done", "Zapsat jako hotové"), od || n <= 14 ? "primary" : "", open(healthDraft(e4, sc)))]));
      });
      if (l4.length && canM) push(acts([btn(L("+ Other regular care", "+ Další péče"), "", open(careDraft(e4, null)), off)]));
      push(note(L("Logging a vaccination or a worming tablet in the health record starts the interval again from that day.", "Zápis očkování nebo odčervení do zdravotního záznamu spustí interval znovu od toho dne.")));
    }

    if (page === "vet") {
      var e5 = cur, V = A.vet;
      headTitle = L("Vet card", "Kartička k veterináři"); headSub = pN(e5);
      if (!V.practice || isEmpty) {
        var VE = A.screens.filter(function (x) { return x.id === "E-32"; })[0];
        push(empty(cs && VE ? VE.empty.s : "Who do you take them to?", cs && VE ? VE.empty.e : "Veterina Kohoutovice, MVDr. Sýkorová.", canC ? (cs && VE ? VE.empty.a : "Add the vet") : "", open({ kind: "vet", practice: "", vet: "", phone: "", hours: "", outOfHours: "", outOfHoursNote: "", address: "", err: "" })));
      } else {
        push(rows([
          row({ title: L("Out of hours", "Pohotovost"), strong: true, sub: V.outOfHours + " \u00b7 " + tr(V.outOfHoursNote), dot: true, dotInk: "var(--danger)", act: L("Call", "Volat"), onAct: call(V.outOfHours), rule: "danger" }),
          row({ title: V.practice, sub: V.vet + " \u00b7 " + V.phone + " \u00b7 " + tr(V.hours), act: L("Call", "Volat"), onAct: call(V.phone) })
        ]));
        var f5 = feedOf(e5), p5 = polOf(e5);
        push(label(L("What they'll ask", "Na co se zeptají")));
        push(kv([[L("Address", "Adresa"), V.address], [L("Microchip", "Čip"), e5.chip ? "Petnet \u00b7 " + e5.chip : L("not entered", "nezadán")],
          [L("Insurance", "Pojištění"), p5 ? p5.insurer + " " + p5.number : L("none", "žádné")], [L("Born", "Narozen(a)"), e5.born ? day(e5.born) + " \u00b7 " + ageOf(e5) : ""],
          [L("Weight", "Váha"), weights(e5).length ? kg(weights(e5)[weights(e5).length - 1].milli) : ""],
          [L("Allergies", "Alergie"), f5 && f5.allergies && f5.allergies.length ? f5.allergies.map(tr).join("; ") : L("none known", "žádné známé")],
          [L("Ongoing", "Trvá"), A.healthOf(e5.id).filter(function (h) { return h.type === "condition"; }).map(hN).join(", ")]]));
        if (canC) push(acts([btn(L("Edit the vet", "Upravit veterináře"), "", open(Object.assign({ kind: "vet", err: "" }, V)))]));
        push(note(pets.length > 1 ? L("The same vet for " + pets.map(pN).join(" and ") + ". Everything on this card is on the device, because a waiting room is often a basement with no signal.", "Stejný veterinář pro " + pets.map(pN).join(" a ") + ". Vše na kartičce je v zařízení, protože čekárna bývá sklep bez signálu.")
          : L("Everything on this card is on the device, because a waiting room is often a basement with no signal.", "Vše na kartičce je v zařízení, protože čekárna bývá sklep bez signálu.")));
      }
    }

    if (page === "feeding") {
      var e6 = cur, f6 = feedOf(e6);
      headTitle = L("Feeding and allergies", "Krmení a alergie"); headSub = pN(e6);
      if (!f6 || isEmpty) {
        var FE = A.screens.filter(function (x) { return x.id === "E-33"; })[0];
        push(empty(cs && FE ? FE.empty.s : "What do they eat, and how much?", cs && FE ? FE.empty.e : "Brit Care Adult Salmon, 170 g twice a day.", canC ? (cs && FE ? FE.empty.a : "Fill in feeding") : "", open(feedDraft(e6))));
      } else {
        push(hero({ kicker: L("Food", "Krmivo"), big: f6.food, sub: f6.amount + " \u00d7 " + f6.meals + (f6.total ? " = " + f6.total.replace("den", cs ? "den" : "day") : "") + (f6.times && f6.times.length ? " \u00b7 " + f6.times.join(", ") : "") }));
        push(label(L("Never", "Nesmí"), canC ? L("+ Add", "+ Přidat") : "", open({ kind: "listAdd", entity: e6.id, list: "never", value: "", err: "" })));
        push((f6.never || []).length ? rows(f6.never.map(function (t, i) {
          return row({ title: tr(t), dot: true, dotInk: "var(--danger)", rule: "danger", act: canC ? L("Take off", "Odebrat") : "", onAct: canC ? function () {
            commit(function () { f6.never.splice(i, 1); }, function () { f6.never.splice(i, 0, t); }, tr(t) + L(" taken off the list", " odebráno ze seznamu"));
          } : null });
        })) : note(L("Nothing listed. Grapes, xylitol and chocolate are the usual three for a dog.", "Nic zapsáno. U psa to bývají hrozny, xylitol a čokoláda.")));
        push(label(L("Allergies", "Alergie"), canC ? L("+ Add", "+ Přidat") : "", open({ kind: "listAdd", entity: e6.id, list: "allergies", value: "", err: "" })));
        push((f6.allergies || []).length ? rows(f6.allergies.map(function (t, i) {
          return row({ title: tr(t), dot: true, dotInk: "var(--warning)", act: canC ? L("Take off", "Odebrat") : "", onAct: canC ? function () {
            commit(function () { f6.allergies.splice(i, 1); }, function () { f6.allergies.splice(i, 0, t); }, tr(t) + L(" taken off", " odebráno"));
          } : null });
        })) : note(L("None known.", "Žádné známé.")));
        push(kv([[L("Treats", "Pamlsky"), tr(f6.treats)], [L("Good to know", "Dobré vědět"), tr(f6.note)]]));
        if (canC) push(acts([btn(L("Edit feeding", "Upravit krmení"), "", open(feedDraft(e6)))]));
        push(note(L("Together with the vet card, this is the screen you hand to whoever is looking after them.", "Spolu s kartičkou k veterináři je to obrazovka, kterou dáte tomu, kdo se o ně bude starat.")));
      }
    }

    if (page === "weight") {
      var e7 = cur, w7 = weights(e7), t7 = targetOf(e7);
      headTitle = L("Weight", "Váha"); headSub = pN(e7);
      if (!w7.length || isEmpty) {
        var WE = A.screens.filter(function (x) { return x.id === "E-34"; })[0];
        push(empty(cs && WE ? WE.empty.s : "One number and the chart begins.", cs && WE ? WE.empty.e : "18,4 kg \u2014 at home, on the bathroom scale.", canC ? (cs && WE ? WE.empty.a : "Record a weight") : "", open(weightDraft(e7))));
      } else {
        var lst = w7[w7.length - 1], fst = w7[0], dlt = (lst.milli - fst.milli) / 1000, outR = t7 && (lst.milli / 1000 < t7.min || lst.milli / 1000 > t7.max);
        push(hero({ kicker: L("Latest", "Poslední") + " \u00b7 " + day(lst.date, false) + " \u00b7 " + name(lst.by), big: kg(lst.milli), tone: outR ? "warn" : "",
          sub: w7.length > 1 ? (dlt === 0 ? L("Unchanged", "Beze změny") : (dlt > 0 ? "+" : "\u2212") + A.num(Math.abs(dlt), 1) + L(" kg since ", " kg od ") + day(fst.date)) + (t7 ? L(" \u00b7 target ", " \u00b7 cíl ") + t7.min + "\u2013" + t7.max + " kg" : "") : L("The first weighing. The chart starts with the second.", "První vážení. Graf začne druhým."),
          stats: [stat(L("Weighings", "Vážení"), String(w7.length), L("since ", "od ") + day(fst.date, false)), t7 ? stat(L("Target", "Cíl"), t7.min + "\u2013" + t7.max + " kg", outR ? L("outside the range", "mimo rozmezí") : L("inside the range", "v rozmezí"), outR ? "warn" : "ok") : null] }));
        if (canC && e7.status === "active") push(acts([btn(L("Record a weight", "Zapsat váhu"), "primary", open(weightDraft(e7))), canM ? btn(t7 ? L("Change the target", "Změnit cíl") : L("Set a target", "Nastavit cíl"), "", open({ kind: "range", entity: e7.id, min: t7 ? String(t7.min) : "", max: t7 ? String(t7.max) : "", err: "" })) : null]));
        var base7 = Math.floor(Math.min.apply(null, w7.map(function (r) { return r.milli / 1000; }).concat(t7 ? [t7.min] : [])) - 1);
        push(label(L("Over time", "V čase")));
        push(bars(w7.map(function (r) {
          var v = r.milli / 1000, o = t7 && (v < t7.min || v > t7.max);
          return { name: day(r.date, true), v: v - base7, right: A.num(v, 1) + " kg", proj: (r.src === "vet" ? L("at the vet", "u veterináře") : L("at home", "doma")) + " \u00b7 " + name(r.by), ink: o ? "var(--warning)" : "var(--positive)" };
        }).reverse()));
        if (!t7) push(note(L("No target range. The vet can give one for the breed and the size.", "Bez cílového rozmezí. Veterinář ho určí podle plemene a velikosti."), "", canM ? L("Set a target", "Nastavit cíl") : "", open({ kind: "range", entity: e7.id, min: "", max: "", err: "" })));
        if (A.healthOf(e7.id).some(function (h) { return h.id === "h-hip"; })) push(note(L("Bela has mild hip dysplasia, and the vet's advice is to keep her weight steady. That's why this chart is here.", "Bela má mírnou dysplazii kyčlí a veterinářka radí držet váhu. Proto je tu ten graf."), "box"));
        push(note(L("Weighings only add up, so they work offline and never conflict.", "Vážení se jen přidávají, takže fungují offline a nikdy si neodporují.")));
      }
    }

    if (page === "insurance") {
      var e8 = cur, p8 = polOf(e8);
      headTitle = L("Insurance", "Pojištění"); headSub = pN(e8);
      if (!p8 || isEmpty) push(empty(L("No insurance entered.", "Pojištění není zadané."), L("Pet Expert, vet fees, renews in January.", "Pet Expert, léčebné výlohy, obnova v lednu."), canC ? L("Enter the policy", "Zadat pojištění") : "", open(polDraft(e8, null))));
      else {
        var n8 = noticeOf(p8);
        push(hero({ kicker: p8.insurer + " \u00b7 " + tr(p8.type), big: n8.lapsed ? L("Ended ", "Skončilo ") + day(p8.end, false) : n8.passed ? L("Renews ", "Obnova ") + day(p8.end, false) : L("Notice by ", "Výpověď do ") + day(n8.fires, false),
          tone: n8.lapsed ? "danger" : !n8.passed && n8.inDays <= 30 ? "warn" : "",
          sub: n8.lapsed ? L("No cover on record since " + day(A.addDays(p8.end, 1), false) + ".", "Od " + day(A.addDays(p8.end, 1), false) + " není zapsané krytí.")
            : n8.passed ? L("The notice period has passed; it renews with " + p8.insurer + ".", "Výpovědní lhůta uplynula; obnoví se u " + p8.insurer + ".")
            : inW(n8.inDays) + L(" \u00b7 renews on ", " \u00b7 obnova ") + day(p8.end) + L(" by itself after that", ", pak se obnoví sama"),
          stats: [stat(L("Premium", "Pojistné"), czk(p8.premium), L("a year", "ročně"))] }));
        push(acts([canC ? btn(L("Renewed as it is", "Obnoveno beze změny"), "primary", function () {
          var old = { start: p8.start, end: p8.end };
          commit(function () { p8.start = A.addDays(p8.end, 1); p8.end = A.addMonths(p8.end, 12); }, function () { Object.assign(p8, old); }, function () { return L("Renewed to ", "Obnoveno do ") + day(p8.end); });
        }, off) : null, canC ? btn(L("Edit", "Upravit"), "", open(polDraft(e8, p8)), off) : null]));
        push(kv([[L("Insurer", "Pojišťovna"), p8.insurer], [L("Cover", "Krytí"), tr(p8.type)], [L("Policy number", "Číslo smlouvy"), p8.number], [L("Runs", "Platí"), day(p8.start) + " \u2013 " + day(p8.end)],
          [L("Notice period", "Výpovědní lhůta"), p8.noticeDays + L(" days before renewal", " dní před obnovou")], [L("We remind you", "Připomeneme"), day(A.addDays(n8.fires, -14)) + L(", two weeks before the notice date", ", dva týdny před koncem lhůty")]]));
        if (off) push(note(L("A policy is money with a date on it, so changes wait for a connection.", "Pojistka jsou peníze s datem, takže změny počkají na připojení."), "offline"));
      }
    }

    if (page === "status") {
      var e9 = cur;
      headTitle = cs ? pN(e9) + " u nás už není?" : "Is " + pN(e9) + " no longer with you?"; headSub = "";
      if (e9.status !== "active") push(note(L(pN(e9) + " is already in Remembered.", pN(e9) + " už je v části Bylo nám spolu dobře."), "box", L("Open", "Otevřít"), go(itemRoot)));
      else if (!canM) push(note(L("Only someone who manages Pets can record this.", "Tohle může zapsat jen ten, kdo spravuje Mazlíčky."), "box"));
      else {
        push(note(L("Choose what happened. Nothing is deleted \u2014 the record stays whole, it just stops asking about the daily routine.", "Vyberte, co se stalo. Nic se nesmaže \u2014 záznam zůstane celý, jen se přestane ptát na denní režim.")));
        push(rows([
          row({ title: L("Died", sexOf(e9) === "f" ? "Zemřela" : "Zemřel"), sub: L("The date, and a note if you want one. The health record, photos and weight stay.", "Datum, a jestli chcete, poznámka. Zdravotní záznam, fotky i váha zůstanou."), open: open({ kind: "status", entity: e9.id, how: "deceased", date: TD, text: "", err: "" }) }),
          row({ title: L("Went to live with someone else", sexOf(e9) === "f" ? "Odstěhovala se k někomu jinému" : "Odstěhoval se k někomu jinému"), sub: L("The date and who. The record stays with you; nothing is sent anywhere.", "Datum a ke komu. Záznam zůstane u vás; nikam se neposílá."), open: open({ kind: "status", entity: e9.id, how: "rehomed", date: TD, text: "", err: "" }) })
        ]));
      }
    }

    /* ═══ sheets ═══ */
    function sheetBody(d) {
      var out = { title: "", sub: "", blocks: [], foot: [], footNote: "" }, B = out.blocks;
      var cancel = btn(L("Cancel", "Zrušit"), "", closeSheet), closeB = btn(L("Close", "Zavřít"), "", closeSheet);
      var e = d.entity ? A.entity(d.entity) : null;

      if (d.kind === "pet") {
        out.title = d.edit ? L("Edit ", "Upravit ") + d.name : L("Add a pet", "Přidat mazlíčka");
        B.push(field({ label: L("Name", "Jméno"), value: d.name, placeholder: "Bela", set: function (v) { patch({ name: v, err: "" }); } }));
        B.push(chips(L("Species", "Druh"), SPECIES.map(function (x) { return chip(cs ? x[2] : x[1], d.species === x[0], function () { patch({ species: x[0] }); }); })));
        B.push(field({ label: L("Breed", "Plemeno"), value: d.breed, placeholder: L("mixed breed", "kříženec"), hint: L("Optional.", "Nepovinné."), set: function (v) { patch({ breed: v }); } }));
        B.push(chips(L("Sex", "Pohlaví"), [chip(L("Female", "Samice"), d.sex === "f", function () { patch({ sex: d.sex === "f" ? "" : "f" }); }), chip(L("Male", "Samec"), d.sex === "m", function () { patch({ sex: d.sex === "m" ? "" : "m" }); }),
          chip(L("Neutered", "Kastrovaný(á)"), d.neutered, function () { patch({ neutered: !d.neutered }); })]));
        B.push(field({ label: L("Born", "Narozen(a)"), type: "date", value: d.born, narrow: true, hint: L("Roughly is fine.", "Stačí přibližně."), set: function (v) { patch({ born: v, err: "" }); } }));
        B.push(field({ label: L("With us since", "U nás od"), type: "date", value: d.acquired, narrow: true, set: function (v) { patch({ acquired: v, err: "" }); } }));
        B.push(field({ label: L("Microchip", "Číslo čipu"), mode: "numeric", value: d.chip, placeholder: "900 032 000 471 205", hint: L("15 digits, on the pet passport.", "15 číslic, v pasu."), set: function (v) { patch({ chip: v, err: "" }); } }));
        var st = STARTER[d.species] || STARTER.other;
        if (!d.edit && (st.care.length || st.routine.length)) {
          B.push(chips(L("Start with the usual for a " + spN(d.species).toLowerCase(), "Začít obvyklým pro: " + spN(d.species).toLowerCase()), [chip(L("Yes", "Ano"), d.starter, function () { patch({ starter: true }); }), chip(L("No, empty", "Ne, prázdné"), !d.starter, function () { patch({ starter: false }); })]));
          if (d.starter) B.push(note([st.care.map(function (x) { return (cs ? x[0] : x[1]) + " " + months(x[2]); }).join(", "), st.routine.map(function (x) { return cs ? x[0] : x[1]; }).join(", ")].filter(Boolean).join(" \u00b7 "), "box"));
        }
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(d.edit ? L("Save", "Uložit") : L("Add", "Přidat"), "primary", function () {
          var nm = String(d.name || "").trim();
          if (!nm) return patch({ err: L("A name is all it needs.", "Stačí jméno.") });
          if (d.born && d.born > TD) return patch({ err: L("Rejected: born can't be in the future.", "Odmítnuto: narození nemůže být v budoucnu.") });
          if (d.acquired && d.acquired > TD) return patch({ err: L("Rejected: that day hasn't happened yet.", "Odmítnuto: ten den ještě nebyl.") });
          if (d.born && d.acquired && d.acquired < d.born) return patch({ err: L("Rejected: they can't have come to you before they were born.", "Odmítnuto: nemohl(a) k vám přijít dřív, než se narodil(a).") });
          var chipN = String(d.chip || "").replace(/\s/g, "");
          if (chipN && !/^\d{15}$/.test(chipN)) return patch({ err: L("A microchip number is 15 digits. This one is " + chipN.length + ".", "Číslo čipu má 15 číslic. Tohle má " + chipN.length + ".") });
          var chipF = chipN ? chipN.replace(/(\d{3})(\d{3})(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4 $5") : "";
          if (chipF && A.entities.some(function (x) { return x.module === "pets" && x.id !== d.edit && x.chip === chipF; })) return patch({ err: L("Rejected: another pet already has that chip.", "Odmítnuto: tenhle čip už má jiný mazlíček.") });
          var cat = spN(d.species) + (String(d.breed || "").trim() ? " \u00b7 " + String(d.breed).trim() : "");
          var sexV = d.sex ? (d.species === "dog" ? (d.sex === "f" ? "fena" : "pes") : d.species === "cat" ? (d.sex === "f" ? "kočka" : "kocour") : d.sex) : "";
          var vals = { species: d.species, breed: String(d.breed || "").trim(), sex: sexV, neutered: !!d.neutered, born: d.born || "", acquired: d.acquired || "", chip: chipF };
          if (d.edit) {
            var ex = A.entity(d.edit), old = {}; Object.keys(vals).concat(["cs", "en", "category"]).forEach(function (k) { old[k] = ex[k]; });
            var catChanged = ex.species !== d.species || (ex.breed || "") !== vals.breed;
            commit(function () { Object.assign(ex, vals); ex.cs = nm; ex.en = nm; if (catChanged) ex.category = cat; }, function () { Object.assign(ex, old); }, L("Saved", "Uloženo"), d.back ? { route: d.back } : {});
          } else {
            var ne = Object.assign({ id: slug(nm), type: "pet", module: "pets", cs: nm, en: nm, category: cat, status: "active", docs: 0, session: true, queued: off }, vals);
            var add = { sch: [], rt: [] };
            if (d.starter) {
              st.care.forEach(function (x) { add.sch.push({ id: uid("sch"), entity: ne.id, cs: x[0], en: x[1], basis: "interval", months: x[2], lastDone: d.acquired || TD, fromSpecies: true, session: true }); });
              st.routine.forEach(function (x) { add.rt.push({ id: uid("rt"), entity: ne.id, cs: x[0], en: x[1], at: x[2] }); });
            }
            commit(function () { A.entities.push(ne); add.sch.forEach(function (x) { A.schedules.push(x); }); add.rt.forEach(function (x) { A.routine.push(x); }); },
              function () { A.entities.splice(A.entities.indexOf(ne), 1); add.sch.forEach(function (x) { A.schedules.splice(A.schedules.indexOf(x), 1); }); add.rt.forEach(function (x) { A.routine.splice(A.routine.indexOf(x), 1); }); },
              nm + L(" added", " přidán(a)") + (add.rt.length ? L(" \u00b7 " + add.rt.length + " things in the routine", " \u00b7 " + add.rt.length + " věci v režimu") : ""), { route: "/pets/" + ne.id });
          }
        })];
      }

      if (d.kind === "health" && e) {
        out.title = L("Add to the health record", "Přidat do zdravotního záznamu"); out.sub = pN(e);
        var schs = A.schedulesOf(e.id);
        B.push(chips(L("What kind", "Druh"), HT_ORDER.map(function (t) { return chip(htN(t), d.type === t, function () {
          var auto = t === "vaccination" ? schs.filter(function (x) { return /kování/.test(x.cs); })[0] : t === "treatment" ? schs.filter(function (x) { return /červ/.test(x.cs); })[0] : null;
          patch({ type: t, sch: auto ? auto.id : "", what: auto && !d.what ? schN(auto) : d.what, err: "" });
        }); })));
        if (d.type === "weight") {
          B.push(field({ label: L("Weight", "Váha"), mode: "decimal", value: d.kg, suffix: "kg", narrow: true, set: function (v) { patch({ kg: v, err: "" }); } }));
        } else {
          B.push(field({ label: L("What it was", "Co to bylo"), value: d.what, placeholder: d.type === "vaccination" ? "Nobivac DHPPi + L4" : d.type === "treatment" ? L("Milbemax \u2014 worming", "Milbemax \u2014 odčervení") : d.type === "condition" ? L("Mild hip dysplasia", "Mírná dysplazie kyčlí") : d.type === "procedure" ? L("Dental clean", "Čištění zubů") : L("Cut paw after the walk", "Říznutá tlapka po procházce"), set: function (v) { patch({ what: v, err: "" }); } }));
        }
        if ((d.type === "vaccination" || d.type === "treatment") && schs.length) B.push(chips(L("Starts the interval again", "Spustí znovu interval"), schs.map(function (sc) {
          return chip(schN(sc), d.sch === sc.id, function () { patch({ sch: d.sch === sc.id ? "" : sc.id }); });
        }), d.sch ? L("Next: ", "Příště: ") + day(A.addMonths(d.date || TD, (A.schedule(d.sch) || {}).months || 12)) : L("Kept in the record; no date moves.", "Zůstane v záznamu; žádný termín se neposune.")));
        B.push(field({ label: L("When", "Kdy"), type: "date", value: d.date, narrow: true, set: function (v) { patch({ date: v, err: "" }); } }));
        if (d.type !== "weight" && d.type !== "note") B.push(chips(L("Where", "Kde"), [chip(A.vet.vet.replace(/^MVDr\. (Eva )?/, "MVDr. "), d.vet === "MVDr. Sýkorová", function () { patch({ vet: d.vet === "MVDr. Sýkorová" ? "" : "MVDr. Sýkorová" }); }), chip(L("At home", "Doma"), d.vet === "home", function () { patch({ vet: d.vet === "home" ? "" : "home" }); })]));
        B.push(field({ label: L("Note", "Poznámka"), value: d.meta, placeholder: d.type === "vaccination" ? L("batch A241-77", "šarže A241-77") : "", hint: L("Optional.", "Nepovinné."), set: function (v) { patch({ meta: v }); } }));
        if (d.type !== "weight" && d.type !== "note") B.push(field({ label: L("What it cost", "Co to stálo"), mode: "decimal", value: d.cost, suffix: "Kč", narrow: true, set: function (v) { patch({ cost: v, err: "" }); } }));
        if (off) B.push(note(L("No signal at the vet's is normal. The entry is added on this device and goes up later.", "Bez signálu u veterináře je normální. Záznam se přidá v zařízení a odejde později."), "offline"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          if (!d.date || d.date > TD) return patch({ err: L("Rejected: it's logged on the day it happened, not ahead.", "Odmítnuto: zapisuje se ke dni, kdy se to stalo, ne dopředu.") });
          if (e.born && d.date < e.born) return patch({ err: L("Rejected: the date can't be before " + pN(e) + " was born.", "Odmítnuto: datum nemůže být před narozením.") });
          var cost = d.cost === "" || d.cost == null ? 0 : parseNum(d.cost);
          if (cost == null) return patch({ err: L("Type the cost as a number.", "Zapište cenu číslem.") });
          var vetN = d.vet === "home" ? "" : d.vet || "";
          if (d.type === "weight") {
            var k = parseNum(d.kg);
            if (!k || k <= 0) return patch({ err: L("Rejected: a weight is a positive number.", "Odmítnuto: váha musí být kladná.") });
            var hw = { id: uid("h"), entity: e.id, type: "weight", date: d.date, cs: A.num(k, 1) + " kg", en: A.num(k, 1) + " kg", meta: String(d.meta || "").trim() || "doma", metaEn: String(d.meta || "").trim() || "at home", docs: 0, session: true, queued: off };
            var rw = { entity: e.id, date: d.date, milli: Math.round(k * 1000), unit: "kg", by: me, src: "home", session: true, queued: off };
            return commit(function () { A.health.push(hw); A.readings.push(rw); }, function () { A.health.splice(A.health.indexOf(hw), 1); A.readings.splice(A.readings.indexOf(rw), 1); }, A.num(k, 1) + L(" kg recorded", " kg zapsáno"), d.back ? { route: d.back } : {});
          }
          var what = String(d.what || "").trim();
          if (!what) return patch({ err: L("Say what it was, in a few words.", "Napište pár slovy, co to bylo.") });
          var h = { id: uid("h"), entity: e.id, type: d.type, date: d.date, cs: what, en: what, meta: String(d.meta || "").trim(), metaEn: String(d.meta || "").trim(), vet: vetN, cost: cost || 0, docs: 0, actor: me, session: true, queued: off };
          var sc = d.sch ? A.schedule(d.sch) : null, oldS = sc ? sc.lastDone : null;
          commit(function () { A.health.push(h); if (sc && d.date >= sc.lastDone) sc.lastDone = d.date; }, function () { A.health.splice(A.health.indexOf(h), 1); if (sc) sc.lastDone = oldS; },
            function () { return L("Added to the record", "Přidáno do záznamu") + (sc && d.date >= oldS ? L(" \u00b7 next ", " \u00b7 příště ") + day(A.addMonths(sc.lastDone, sc.months)) : ""); }, d.back ? { route: d.back } : {});
        })];
      }

      if (d.kind === "healthView") {
        var h0 = A.health.filter(function (x) { return x.id === d.id; })[0]; if (!h0) return null;
        var he = A.entity(h0.entity);
        out.title = hN(h0); out.sub = pN(he) + " \u00b7 " + htN(h0.type) + " \u00b7 " + day(h0.date);
        B.push(kv([[L("Note", "Poznámka"), hMeta(h0)], [L("Vet", "Veterinář"), h0.vet || ""], [L("Cost", "Cena"), h0.cost ? czk(h0.cost) : ""], [L("Documents", "Dokumenty"), h0.docs ? h0.docs + L(" attached", " přiloženo") : L("none attached", "nic přiloženo")],
          h0.actor ? [L("Logged by", "Zapsal(a)"), name(h0.actor)] : null, h0.queued && off ? [L("Status", "Stav"), L("Queued on this device", "Čeká v zařízení")] : null]));
        out.foot = [closeB, canM ? btn(L("Delete entry", "Smazat záznam"), "danger-ghost", function () {
          var ix = A.health.indexOf(h0);
          commit(function () { A.health.splice(ix, 1); }, function () { A.health.splice(ix, 0, h0); }, L("Entry deleted", "Záznam smazán"));
        }, off) : null].filter(Boolean);
        if (canM && off) out.footNote = L("Corrections happen online. Adding works offline.", "Opravy jen online. Přidávat jde offline.");
      }

      if (d.kind === "weight" && e) {
        var lw1 = A.latest(e.id, "kg");
        out.title = L("Record a weight", "Zapsat váhu"); out.sub = pN(e) + (lw1 ? L(" \u00b7 last ", " \u00b7 posledně ") + kg(lw1.milli) + " (" + day(lw1.date, false) + ")" : "");
        B.push(field({ label: L("Weight", "Váha"), mode: "decimal", value: d.value, suffix: "kg", narrow: true, err: d.err, set: function (v) { patch({ value: v, err: "" }); } }));
        B.push(chips(L("Where", "Kde"), [chip(L("At home", "Doma"), d.where === "home", function () { patch({ where: "home" }); }), chip(L("At the vet", "U veterináře"), d.where === "vet", function () { patch({ where: "vet" }); })]));
        B.push(field({ label: L("When", "Kdy"), type: "date", value: d.date, narrow: true, set: function (v) { patch({ date: v, err: "" }); } }));
        var kv1 = parseNum(d.value);
        if (kv1 && lw1 && Math.abs(kv1 - lw1.milli / 1000) / (lw1.milli / 1000) > 0.25) B.push(note(L("That's more than a quarter away from the last weighing. Check the decimal comma.", "To je o víc než čtvrtinu jinak než posledně. Zkontrolujte desetinnou čárku."), "boxWarn"));
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          var k = parseNum(d.value);
          if (!k || k <= 0) return patch({ err: L("Rejected: a weight is a positive number.", "Odmítnuto: váha musí být kladná.") });
          if (!d.date || d.date > TD) return patch({ err: L("A weighing is for a day that has happened.", "Vážení je ke dni, který už byl.") });
          if (e.born && d.date < e.born) return patch({ err: L("Rejected: before " + pN(e) + " was born.", "Odmítnuto: před narozením.") });
          var r = { entity: e.id, date: d.date, milli: Math.round(k * 1000), unit: "kg", by: me, src: d.where, session: true, queued: off };
          var hw = { id: uid("h"), entity: e.id, type: "weight", date: d.date, cs: A.num(k, 1) + " kg", en: A.num(k, 1) + " kg", meta: d.where === "vet" ? "u veterináře" : "doma", metaEn: d.where === "vet" ? "at the vet" : "at home", docs: 0, session: true, queued: off };
          var t = targetOf(e);
          commit(function () { A.readings.push(r); A.health.push(hw); }, function () { A.readings.splice(A.readings.indexOf(r), 1); A.health.splice(A.health.indexOf(hw), 1); },
            A.num(k, 1) + L(" kg recorded", " kg zapsáno") + (t ? (k < t.min || k > t.max ? L(" \u00b7 outside " + t.min + "\u2013" + t.max + " kg", " \u00b7 mimo " + t.min + "\u2013" + t.max + " kg") : L(" \u00b7 in range", " \u00b7 v rozmezí")) : ""), d.back ? { route: d.back } : {});
        })];
      }

      if (d.kind === "range" && e) {
        out.title = L("Target weight", "Cílová váha"); out.sub = pN(e);
        B.push(field({ label: L("From", "Od"), mode: "decimal", value: d.min, suffix: "kg", narrow: true, set: function (v) { patch({ min: v, err: "" }); } }));
        B.push(field({ label: L("To", "Do"), mode: "decimal", value: d.max, suffix: "kg", narrow: true, set: function (v) { patch({ max: v, err: "" }); } }));
        B.push(note(L("From the breed and the vet. It colours the chart; it doesn't send any reminders.", "Podle plemene a veterináře. Obarví graf; žádné připomínky neposílá.")));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, targetOf(e) ? btn(L("No target", "Bez cíle"), "danger-ghost", function () {
          var old = PS.target[e.id]; commit(function () { delete PS.target[e.id]; }, function () { PS.target[e.id] = old; }, L("Target cleared", "Cíl zrušen"));
        }) : null, btn(L("Save", "Uložit"), "primary", function () {
          var mn = parseNum(d.min), mx = parseNum(d.max);
          if (!mn || !mx) return patch({ err: L("Both numbers, in kg.", "Obě čísla, v kg.") });
          if (mx <= mn) return patch({ err: L("Rejected: the top of the range has to be above the bottom.", "Odmítnuto: horní hranice musí být nad dolní.") });
          var old = PS.target[e.id];
          commit(function () { PS.target[e.id] = { min: mn, max: mx }; }, function () { if (old) PS.target[e.id] = old; else delete PS.target[e.id]; }, L("Target ", "Cíl ") + A.num(mn, 1) + "\u2013" + A.num(mx, 1) + " kg");
        })].filter(Boolean);
      }

      if (d.kind === "med" && e) {
        out.title = L("Add medication", "Přidat lék"); out.sub = pN(e);
        B.push(field({ label: L("Medicine", "Lék"), value: d.name, placeholder: "Synulox 250 mg", set: function (v) { patch({ name: v, err: "" }); } }));
        B.push(field({ label: L("Dose", "Dávka"), value: d.dose, placeholder: L("1 tablet", "1 tableta"), narrow: true, set: function (v) { patch({ dose: v, err: "" }); } }));
        var PRE = [["07:00"], ["07:00", "19:00"], ["07:00", "13:00", "19:00"]];
        B.push(chips(L("How often", "Jak často"), PRE.map(function (t) { return chip(t.length + L("\u00d7 a day", "\u00d7 denně"), d.times.join() === t.join(), function () { patch({ times: t }); }); }), d.times.join(" \u00b7 ")));
        B.push(field({ label: L("For", "Po dobu"), mode: "numeric", value: d.days, suffix: L("days", "dní"), narrow: true, set: function (v) { patch({ days: v, err: "" }); } }));
        B.push(field({ label: L("First dose", "První dávka"), type: "date", value: d.start, narrow: true, set: function (v) { patch({ start: v, err: "" }); } }));
        B.push(field({ label: L("Why", "Proč"), value: d.reason, placeholder: L("after stitches on the paw", "po šití tlapky"), hint: L("Optional.", "Nepovinné."), set: function (v) { patch({ reason: v }); } }));
        var dn = parseNum(d.days);
        if (dn && dn % 1 === 0 && d.start) B.push(note(dn * d.times.length + L(" doses, ", " dávek, ") + L("the last on ", "poslední ") + day(A.addDays(d.start, dn - 1)) + " " + d.times[d.times.length - 1] + L(". Anyone can tick one, and it's one dose however many of you tick it.", ". Odškrtnout může kdokoli a je to jedna dávka, ať ji odškrtne kolik lidí chce."), "box"));
        if (off) B.push(note(L("Needs a connection. A dose schedule is not something two phones should each have their own version of.", "Potřebuje připojení. Rozpis dávek nemá mít každý telefon vlastní verzi."), "boxOff"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Add", "Přidat"), "primary", function () {
          var nm = String(d.name || "").trim();
          if (!nm) return patch({ err: L("Which medicine?", "Jaký lék?") });
          if (!dn || dn % 1 || dn > 90) return patch({ err: L("Whole days, up to 90. For longer, add it again when the course is renewed.", "Celé dny, nejvýš 90. Delší léčbu přidejte znovu při obnovení.") });
          if (!d.start) return patch({ err: L("When is the first dose?", "Kdy je první dávka?") });
          if (d.start < A.addDays(TD, -7)) return patch({ err: L("Rejected: a course can start at most a week back.", "Odmítnuto: léčba může začít nejvýš týden zpátky.") });
          var m = { id: uid("med"), entity: e.id, cs: nm, dose: String(d.dose || "").trim() || L("1 dose", "1 dávka"), reason: String(d.reason || "").trim(), perDay: d.times.length, times: d.times.slice(), start: d.start, days: dn, session: true };
          commit(function () { PS.meds.push(m); }, function () { PS.meds.splice(PS.meds.indexOf(m), 1); }, nm + L(" added \u00b7 ", " přidáno \u00b7 ") + dn * d.times.length + L(" doses", " dávek"), d.back ? { route: d.back } : {});
        }, off)];
      }

      if (d.kind === "doseDay") {
        var m0 = meds().filter(function (x) { return x.id === d.med; })[0]; if (!m0) return null;
        var dd0 = dosesOf(m0).filter(function (x) { return x.date === d.date; });
        out.title = m0.cs + " \u00b7 " + wday(d.date); out.sub = pN(A.entity(m0.entity));
        B.push(rows(dd0.map(function (x) { return doseRow(x, false); })));
        B.push(note(L("A dose that was given but not ticked can still be recorded. It says who recorded it and when.", "Dávku, která se dala, ale neodškrtla, jde zapsat dodatečně. Bude u ní, kdo to zapsal."), "muted"));
        out.foot = [closeB];
      }

      if (d.kind === "routine") {
        out.title = d.edit ? L("Edit routine item", "Upravit položku režimu") : L("Add to the routine", "Přidat do režimu");
        if (!d.edit && pets.length > 1) B.push(chips(L("For", "Pro"), pets.map(function (p) { return chip(pN(p), d.entity === p.id, function () { patch({ entity: p.id }); }); })));
        else out.sub = pN(A.entity(d.entity));
        B.push(field({ label: L("What", "Co"), value: d.name, placeholder: L("Evening walk", "Večerní venčení"), set: function (v) { patch({ name: v, err: "" }); } }));
        B.push(field({ label: L("Around", "Kolem"), type: "time", value: d.at, narrow: true, hint: L("Optional. Leave empty for any time of day.", "Nepovinné. Prázdné = kdykoli během dne."), set: function (v) { patch({ at: v, err: "" }); } }));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, d.edit ? btn(L("Take off the routine", "Vyřadit z režimu"), "danger-ghost", function () {
          var r = A.routine.filter(function (x) { return x.id === d.edit; })[0], ix = A.routine.indexOf(r);
          commit(function () { A.routine.splice(ix, 1); }, function () { A.routine.splice(ix, 0, r); }, rtN(r) + L(" is off the routine \u00b7 past ticks stay", " už v režimu není \u00b7 dřívější odškrtnutí zůstávají"));
        }) : null, btn(L("Save", "Uložit"), "primary", function () {
          var nm = String(d.name || "").trim();
          if (!nm) return patch({ err: L("What needs doing?", "Co je potřeba udělat?") });
          if (d.edit) {
            var r = A.routine.filter(function (x) { return x.id === d.edit; })[0], old = { cs: r.cs, en: r.en, at: r.at };
            commit(function () { r.cs = nm; r.en = nm; r.at = d.at || ""; }, function () { Object.assign(r, old); }, L("Saved", "Uloženo"));
          } else {
            var nr = { id: uid("rt"), entity: d.entity, cs: nm, en: nm, at: d.at || "" };
            commit(function () { A.routine.push(nr); }, function () { A.routine.splice(A.routine.indexOf(nr), 1); }, nm + L(" added to the routine", " přidáno do režimu"));
          }
        })].filter(Boolean);
      }

      if (d.kind === "care" && e) {
        out.title = d.edit ? L("Edit regular care", "Upravit péči") : L("Add regular care", "Přidat pravidelnou péči"); out.sub = pN(e);
        B.push(field({ label: L("What", "Co"), value: d.name, placeholder: L("Worming", "Odčervení"), set: function (v) { patch({ name: v, err: "" }); } }));
        B.push(chips(L("How often", "Jak často"), [1, 3, 6, 12].map(function (n) { return chip(months(n), String(n) === d.months, function () { patch({ months: String(n) }); }); })));
        B.push(field({ label: L("Or every", "Nebo každé"), mode: "numeric", value: d.months, suffix: L("months", "měsíce"), narrow: true, set: function (v) { patch({ months: v, err: "" }); } }));
        B.push(field({ label: L("Last done", "Naposledy"), type: "date", value: d.lastDone, narrow: true, set: function (v) { patch({ lastDone: v, err: "" }); } }));
        var mo = parseNum(d.months);
        if (mo && d.lastDone) B.push(note(L("Next: ", "Příště: ") + day(A.addMonths(d.lastDone, mo)), "box"));
        if (off) B.push(note(L("Changing an interval needs a connection. Logging that it was done works offline.", "Změna intervalu jen online. Zapsat, že je hotovo, jde offline."), "boxOff"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, d.edit && canM ? btn(L("Stop reminding", "Přestat připomínat"), "danger-ghost", function () {
          var sc = A.schedule(d.edit), ix = A.schedules.indexOf(sc);
          commit(function () { A.schedules.splice(ix, 1); }, function () { A.schedules.splice(ix, 0, sc); }, schN(sc) + L(" won't be reminded \u00b7 the record stays", " se nebude připomínat \u00b7 záznam zůstává"));
        }, off) : null, btn(L("Save", "Uložit"), "primary", function () {
          var nm = String(d.name || "").trim();
          if (!nm) return patch({ err: L("What is it?", "Co to je?") });
          if (!mo || mo % 1) return patch({ err: L("Whole months.", "Celé měsíce.") });
          if (!d.lastDone || d.lastDone > TD) return patch({ err: L("Last done is a day that has happened.", "Naposledy je den, který už byl.") });
          if (d.edit) {
            var sc = A.schedule(d.edit), old = { cs: sc.cs, en: sc.en, months: sc.months, lastDone: sc.lastDone };
            commit(function () { sc.cs = nm; sc.en = nm; sc.months = mo; sc.lastDone = d.lastDone; }, function () { Object.assign(sc, old); }, L("Saved \u00b7 next ", "Uloženo \u00b7 příště ") + day(A.addMonths(d.lastDone, mo)));
          } else {
            var ns = { id: uid("sch"), entity: e.id, cs: nm, en: nm, basis: "interval", months: mo, lastDone: d.lastDone, session: true };
            commit(function () { A.schedules.push(ns); }, function () { A.schedules.splice(A.schedules.indexOf(ns), 1); }, nm + L(" \u00b7 next ", " \u00b7 příště ") + day(A.addMonths(d.lastDone, mo)));
          }
        }, off)].filter(Boolean);
      }

      if (d.kind === "vet") {
        out.title = L("The vet", "Veterinář");
        B.push(field({ label: L("Practice", "Ordinace"), value: d.practice, placeholder: "Veterina Kohoutovice", set: function (v) { patch({ practice: v, err: "" }); } }));
        B.push(field({ label: L("Vet", "Veterinář"), value: d.vet, placeholder: "MVDr. Eva Sýkorová", set: function (v) { patch({ vet: v }); } }));
        B.push(field({ label: L("Phone", "Telefon"), mode: "tel", value: d.phone, narrow: true, placeholder: "+420 546 221 118", set: function (v) { patch({ phone: v, err: "" }); } }));
        B.push(field({ label: L("Opening hours", "Ordinační hodiny"), value: cs ? d.hours : tr(d.hours), set: function (v) { patch({ hours: v }); } }));
        B.push(field({ label: L("Out-of-hours number", "Číslo na pohotovost"), mode: "tel", value: d.outOfHours, narrow: true, placeholder: "+420 606 771 002", set: function (v) { patch({ outOfHours: v, err: "" }); } }));
        B.push(field({ label: L("Where the out-of-hours clinic is", "Kde je pohotovost"), value: cs ? d.outOfHoursNote : tr(d.outOfHoursNote), set: function (v) { patch({ outOfHoursNote: v }); } }));
        B.push(field({ label: L("Address", "Adresa"), value: d.address, set: function (v) { patch({ address: v }); } }));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          var ok = function (p) { return !p || /^\+?[\d\s]{9,16}$/.test(String(p).trim()); };
          if (!String(d.practice || "").trim()) return patch({ err: L("The practice name at least.", "Aspoň název ordinace.") });
          if (!ok(d.phone) || !ok(d.outOfHours)) return patch({ err: L("Rejected: that phone number isn't in the right shape.", "Odmítnuto: telefon není ve správném tvaru.") });
          var V = A.vet, keys = ["practice", "vet", "phone", "hours", "outOfHours", "outOfHoursNote", "address"], old = {};
          keys.forEach(function (k) { old[k] = V[k]; });
          commit(function () { keys.forEach(function (k) { V[k] = String(d[k] || "").trim(); }); }, function () { Object.assign(V, old); }, L("Vet card saved", "Kartička uložena"));
        })];
      }

      if (d.kind === "feeding" && e) {
        out.title = L("Feeding", "Krmení"); out.sub = pN(e);
        B.push(field({ label: L("Food", "Krmivo"), value: d.food, placeholder: "Brit Care Adult Salmon", set: function (v) { patch({ food: v, err: "" }); } }));
        B.push(field({ label: L("Per meal", "Na jedno krmení"), value: d.amount, placeholder: "170 g", narrow: true, set: function (v) { patch({ amount: v, err: "" }); } }));
        B.push(field({ label: L("At", "V"), value: d.times, placeholder: "07:15, 18:00", narrow: true, hint: L("Separate with commas.", "Oddělte čárkou."), set: function (v) { patch({ times: v, err: "" }); } }));
        B.push(field({ label: L("Treats", "Pamlsky"), value: d.treats, set: function (v) { patch({ treats: v }); } }));
        B.push(field({ label: L("Good to know", "Dobré vědět"), value: d.note, placeholder: L("Takes tablets in quark.", "Tabletky bere v tvarohu."), set: function (v) { patch({ note: v }); } }));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          if (!String(d.food || "").trim()) return patch({ err: L("What do they eat?", "Co jí?") });
          var amt = String(d.amount || "").trim(), g = parseNum(amt.replace(/\s*(g|kg|ml)\s*$/i, ""));
          if (amt && (g == null || g <= 0)) return patch({ err: L("Rejected: the amount has to be positive \u2014 170 g, for example.", "Odmítnuto: dávka musí být kladná \u2014 třeba 170 g.") });
          var ts = String(d.times || "").split(/[,;]/).map(function (x) { return x.trim(); }).filter(Boolean);
          if (ts.some(function (t) { return !/^\d{1,2}:\d{2}$/.test(t); })) return patch({ err: L("Times as 07:15, 18:00.", "Časy jako 07:15, 18:00.") });
          var cur0 = feedOf(e), had = !!cur0, old = had ? Object.assign({}, cur0) : null;
          var unit = (amt.match(/(g|kg|ml)\s*$/i) || [, "g"])[1];
          var vals = { food: String(d.food).trim(), amount: amt, meals: ts.length || 1, times: ts, total: g ? A.num(g * (ts.length || 1), 0) + " " + unit + " / den" : "", treats: String(d.treats || "").trim(), note: String(d.note || "").trim() };
          commit(function () { if (had) Object.assign(cur0, vals); else PS.feeding[e.id] = Object.assign({ allergies: [], never: [] }, vals); }, function () { if (had) Object.assign(cur0, old); else delete PS.feeding[e.id]; }, L("Feeding saved", "Krmení uloženo"));
        })];
      }

      if (d.kind === "listAdd" && e) {
        var isNever = d.list === "never";
        out.title = isNever ? L("Something " + pN(e) + " must never have", "Co " + pN(e) + " nesmí") : L("An allergy", "Alergie"); out.sub = pN(e);
        B.push(field({ label: isNever ? L("What", "Co") : L("What, and what it does", "Na co a co to dělá"), value: d.value, placeholder: isNever ? L("Onions", "Cibule") : L("Chicken \u2014 itching", "Kuřecí \u2014 svědění"), err: d.err, set: function (v) { patch({ value: v, err: "" }); } }));
        out.foot = [cancel, btn(L("Add", "Přidat"), "primary", function () {
          var v = String(d.value || "").trim(); if (!v) return patch({ err: L("Type what it is.", "Napište, co to je.") });
          var fd = feedOf(e); var created = !fd;
          if (created) fd = { food: "", amount: "", meals: 0, times: [], allergies: [], never: [] };
          var arr = fd[d.list] = fd[d.list] || [];
          if (arr.some(function (x) { return x.toLowerCase() === v.toLowerCase(); })) return patch({ err: L("It's already on the list.", "Už je na seznamu.") });
          commit(function () { if (created) PS.feeding[e.id] = fd; arr.push(v); }, function () { arr.splice(arr.indexOf(v), 1); if (created) delete PS.feeding[e.id]; }, v + L(" added", " přidáno"));
        })];
      }

      if (d.kind === "policy" && e) {
        out.title = d.edit ? L("Edit the policy", "Upravit pojistku") : L("Enter the policy", "Zadat pojištění"); out.sub = pN(e);
        B.push(field({ label: L("Insurer", "Pojišťovna"), value: d.insurer, placeholder: "Pet Expert", set: function (v) { patch({ insurer: v, err: "" }); } }));
        B.push(field({ label: L("Cover", "Krytí"), value: d.type, set: function (v) { patch({ type: v }); } }));
        B.push(field({ label: L("Policy number", "Číslo smlouvy"), value: d.number, narrow: true, set: function (v) { patch({ number: v }); } }));
        B.push(field({ label: L("Premium a year", "Pojistné ročně"), mode: "decimal", value: d.premium, suffix: "Kč", narrow: true, set: function (v) { patch({ premium: v, err: "" }); } }));
        B.push(field({ label: L("From", "Od"), type: "date", value: d.start, narrow: true, set: function (v) { patch({ start: v, err: "" }); } }));
        B.push(field({ label: L("Until", "Do"), type: "date", value: d.end, narrow: true, set: function (v) { patch({ end: v, err: "" }); } }));
        B.push(field({ label: L("Notice period", "Výpovědní lhůta"), mode: "numeric", value: d.notice, suffix: L("days", "dní"), narrow: true, set: function (v) { patch({ notice: v, err: "" }); } }));
        var nd = parseNum(d.notice);
        if (d.end && nd != null) B.push(note(L("Notice by ", "Výpověď do ") + day(A.addDays(d.end, -nd)) + L(". The reminder goes out two weeks before that.", ". Připomínka přijde dva týdny předtím."), "box"));
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
          if (nd == null) return patch({ err: L("The notice period in days \u2014 0 if there is none.", "Výpovědní lhůta ve dnech \u2014 0, pokud žádná není.") });
          var vals = { insurer: ins, type: String(d.type || "").trim(), number: String(d.number || "").trim(), premium: pm, cadence: "ročně", start: d.start, end: d.end, noticeDays: nd };
          if (d.edit) {
            var p = A.insurance.filter(function (x) { return x.id === d.edit; })[0], old = {}; Object.keys(vals).forEach(function (k) { old[k] = p[k]; });
            commit(function () { Object.assign(p, vals); }, function () { Object.assign(p, old); }, L("Saved \u00b7 notice by ", "Uloženo \u00b7 výpověď do ") + day(A.addDays(vals.end, -nd)));
          } else {
            var np = Object.assign({ id: uid("pol"), entity: e.id, docs: 0, session: true }, vals);
            commit(function () { A.insurance.push(np); }, function () { A.insurance.splice(A.insurance.indexOf(np), 1); }, ins + L(" saved \u00b7 notice by ", " uloženo \u00b7 výpověď do ") + day(A.addDays(vals.end, -nd)));
          }
        }, off)].filter(Boolean);
      }

      if (d.kind === "status" && e) {
        var f = sexOf(e) === "f", dead = d.how === "deceased";
        out.title = dead ? L(pN(e) + " died", pN(e) + (f ? " zemřela" : " zemřel")) : L(pN(e) + " went to live with someone else", pN(e) + (f ? " se odstěhovala" : " se odstěhoval"));
        B.push(field({ label: L("When", "Kdy"), type: "date", value: d.date, narrow: true, set: function (v) { patch({ date: v, err: "" }); } }));
        B.push(field({ label: dead ? L("A note, if you want one", "Poznámka, jestli chcete") : L("With whom", "Ke komu"), value: d.text, placeholder: dead ? "" : L("the Novák family, Tišnov", "Novákovi, Tišnov"), set: function (v) { patch({ text: v, err: "" }); } }));
        var stops = [], rtN0 = A.routine.filter(function (r) { return r.entity === e.id; }).length, cr = A.schedulesOf(e.id).length, lm = medsOf(e).filter(function (m) { return medLive(m) || medPlanned(m); }), pol = polOf(e);
        if (rtN0) stops.push(L("the daily routine (" + rtN0 + ")", "denní režim (" + rtN0 + ")"));
        if (cr) stops.push(L("reminders for regular care", "připomínky pravidelné péče"));
        if (lm.length) stops.push(L("the remaining doses of ", "zbylé dávky ") + lm.map(function (m) { return m.cs; }).join(", "));
        var stays = [L("the health record (" + A.healthOf(e.id).length + ")", "zdravotní záznam (" + A.healthOf(e.id).length + ")"), L("the weight chart", "graf váhy"), L("photos and documents", "fotky a dokumenty")];
        B.push(note((stops.length ? L("Stops quietly: ", "Tiše se zastaví: ") + stops.join(", ") + ". " : "") + L("Stays: ", "Zůstává: ") + stays.join(", ") + ". " + L(pN(e) + " moves to Remembered and opens any time.", pN(e) + " bude v části Bylo nám spolu dobře a dá se kdykoli otevřít."), "box"));
        if (pol) B.push(note(L("The policy with " + pol.insurer + " doesn't end by itself. Let them know when you're ready.", "Pojistka u " + pol.insurer + " sama neskončí. Dejte jim vědět, až budete chtít."), "muted"));
        if (d.err) out.footNote = d.err;
        out.foot = [cancel, btn(L("Save", "Uložit"), "primary", function () {
          if (!d.date || d.date > TD) return patch({ err: L("Pick the day.", "Vyberte den.") });
          if (e.born && d.date < e.born) return patch({ err: L("Rejected: that's before " + pN(e) + " was born.", "Odmítnuto: to je před narozením.") });
          if (!dead && !String(d.text || "").trim()) return patch({ err: L("Who is looking after them now?", "Kdo se o ně teď stará?") });
          var old = { status: e.status, ended: e.ended, endNote: e.endNote, rehomedTo: e.rehomedTo }, oldM = lm.map(function (m) { return [m, m.stopped, m.stoppedAt]; });
          commit(function () { e.status = d.how; e.ended = d.date; if (dead) e.endNote = String(d.text || "").trim(); else e.rehomedTo = String(d.text).trim(); lm.forEach(function (m) { m.stopped = TD; m.stoppedAt = NOW; }); },
            function () { Object.assign(e, old); oldM.forEach(function (x) { if (x[1]) x[0].stopped = x[1]; else delete x[0].stopped; if (x[2]) x[0].stoppedAt = x[2]; else delete x[0].stoppedAt; }); },
            L("Saved. " + pN(e) + "'s record is kept whole.", "Uloženo. Záznam zůstává celý."), { route: "/pets/remembered" });
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
      var rtAll = routineOn(TD);
      var navP = pets.map(function (e) {
        var left = routineOn(TD, e).filter(function (x) { return !x.done; }).length, ds = datesOf(e)[0];
        return row({ title: pN(e), sub: left ? left + L(" left today", " zbývá dnes") : ds ? schN((ds.x || {}).sc || { cs: ds.title }) + " \u00b7 " + day(ds.date, false) : L("all done today", "dnes hotovo"), subTone: ds && ds.overdue ? "danger" : "",
          on: cur && cur.id === e.id, noChev: true, open: go("/pets/" + e.id) });
      });
      var navO = [row({ title: L("Daily routine", "Denní režim"), sub: rtAll.filter(function (x) { return x.done; }).length + L(" of ", " z ") + rtAll.length + L(" today", " dnes"), on: page === "routine", noChev: true, open: go("/pets/routine") })];
      if (gone.length) navO.push(row({ title: L("Remembered", "Bylo nám spolu dobře"), sub: gone.map(pN).join(", "), muted: true, on: page === "remembered" || (cur && cur.status !== "active"), noChev: true, open: go("/pets/remembered") }));
      var navTop = canC ? [acts([btn(L("+ Pet", "+ Mazlíček"), "primary", open(petDraft(null)))])] : [];
      panes.push({ key: "nav", role: "navigation", title: L("Pets", "Mazlíčci"),
        outer: "flex:0 0 " + (web ? "300px" : "36%") + ";min-width:0;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--border);background:var(--surface)",
        inner: "flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column", col: "display:flex;flex-direction:column;padding-bottom:24px",
        onOuter: function () {}, hasHead: false, sub: "", hasFoot: false, foot: [], footNote: "", footStyle: "",
        blocks: navTop.concat([label(L("Who lives here", "Kdo u nás žije")), rows(navP) || note(L("Nobody yet.", "Zatím nikdo.")), rows(navO), pets.length ? rows([vetRow()]) : null]).filter(Boolean) });
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

    var top = page === "home" || (wide && ["routine", "remembered"].indexOf(page) >= 0) || (wide && page === "item");
    var parent = page === "item" ? (cur && cur.status !== "active" ? "/pets/remembered" : "/pets") : SUBS[page] ? itemRoot : "/pets";
    return { panes: panes, headTitle: headTitle, headSub: headSub, sheetOpen: !!sheetD, showBack: !top,
      onBack: function () { self.setState({ peSheet: null }); self.go(parent); } };
  }

  window.HH_PE_VIEW = view;
})();
