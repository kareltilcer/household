/* The pane vocabulary the live module views share (Finance, Utilities, Activity …),
   packaged once so the account, work and platform views draw with the same blocks.
   HH_KIT(self) returns the block builders plus a small session store under state.xs. */
(function () {
  var KINDS = ["Hero", "Label", "Rows", "Note", "Bars", "Acts", "Field", "Chips", "Inputs", "Cards", "Steps", "Kv", "Empty"];
  window.HH_KIT = function (self) {
    var s = self.state, web = s.client === "web", cs = s.locale === "cs";
    var L = function (en, c) { return cs ? (c || en) : en; };
    var xs = s.xs || {};
    var get = function (k, d) { return xs[k] === undefined ? d : xs[k]; };
    var put = function (patch, extra) {
      var cur = Object.assign({}, self.state.xs || {}, patch);
      self.setState(Object.assign({ xs: cur }, extra || {}));
    };
    var go = function (r) { return function () { self.go(r); }; };
    var toast = function (t, undo) { if (self.docToastShow) self.docToastShow(t, undo); };
    var blk = function (t, p) { var o = {}; KINDS.forEach(function (x) { o["is" + x] = x === t; }); return Object.assign(o, p); };
    var inkOf = function (t) {
      return t === "danger" ? "var(--danger)" : t === "warn" ? "var(--warning)" : t === "accent" ? "var(--accent)" : t === "ok" ? "var(--success, var(--accent))"
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
        titleStyle: "font-size:0.9375em;line-height:1.35;overflow-wrap:anywhere;text-wrap:pretty;font-weight:" + (p.strong ? "600" : "500") + ";color:" + (p.muted ? "var(--text-muted)" : "var(--text-primary)") +
          (p.italic ? ";font-style:italic" : "") + (p.strike ? ";text-decoration:line-through" : ""),
        subStyle: "font-size:0.75em;line-height:1.45;overflow-wrap:anywhere;text-wrap:pretty;color:" + (p.subTone ? inkOf(p.subTone) : "var(--text-muted)"),
        rightStyle: "font-family:'IBM Plex Mono',monospace;font-size:0.84375em;white-space:nowrap;font-variant-numeric:tabular-nums;color:" + inkOf(p.tone),
        badgeStyle: badgeStyle(p.badgeTone),
        dotStyle: "flex:0 0 10px;width:10px;height:10px;border-radius:3px;background:" + (p.dotInk || "var(--border-strong)"),
        actStyle: "flex:0 0 auto;align-self:center;margin-right:12px;min-height:36px;padding:0 12px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:0.78125em;font-weight:600;white-space:nowrap;border:1px solid " +
          (p.actTone === "danger" ? "var(--danger)" : "var(--accent)") + ";background:" + (p.actOn ? "var(--accent)" : "transparent") + ";color:" + (p.actOn ? "var(--text-on-accent)" : p.actTone === "danger" ? "var(--danger)" : "var(--accent)")
      });
    };
    /* a check row: the box is the lead, the whole row toggles */
    var check = function (p) {
      return row(Object.assign({}, p, { lead: p.done ? "\u2611" : "\u2610", strike: !!p.done && !p.noStrike, muted: !!p.done && !p.noStrike, noChev: true }));
    };
    /* a switch row: on/off in words beside a button, never colour alone */
    var toggle = function (p) {
      return row(Object.assign({}, p, { right: "", act: p.value ? L("On", "Zapnuto") : L("Off", "Vypnuto"), actOn: !!p.value,
        onAct: p.off ? function () {} : p.flip, noChev: true, open: p.off ? null : p.flip }));
    };
    var label = function (t, link, on) { return blk("Label", { text: t, link: link || "", onLink: on || function () {} }); };
    var rows = function (r) { r = (r || []).filter(Boolean); return r.length ? blk("Rows", { rows: r }) : null; };
    var note = function (t, tone, link, on) {
      return blk("Note", { text: t, link: link || "", onLink: on || function () {},
        style: "display:flex;flex-direction:column;gap:6px;align-items:flex-start;font-size:0.8125em;line-height:1.6;text-wrap:pretty;max-width:68ch;" +
          (/^box/.test(tone || "")
            ? "margin:10px 16px;padding:12px 14px;border-radius:10px;background:var(--surface-sunken);color:var(--text-primary)" +
              (tone === "boxWarn" ? ";box-shadow:inset 3px 0 0 var(--warning)" : tone === "boxDanger" ? ";box-shadow:inset 3px 0 0 var(--danger)" : tone === "boxOff" ? ";box-shadow:inset 3px 0 0 var(--status-offline)" : tone === "boxOk" ? ";box-shadow:inset 3px 0 0 var(--accent)" : "")
            : "padding:10px 16px;color:" + inkOf(tone || "muted")) });
    };
    var btn = function (lbl, kind, on, dis) { return { label: lbl, style: self.docBtn(kind, dis ? false : undefined), on: dis ? function () {} : on, off: !!dis }; };
    var acts = function (list) { list = (list || []).filter(Boolean); return list.length ? blk("Acts", { btns: list }) : null; };
    var kv = function (pairs) {
      return blk("Kv", { pairs: pairs.filter(function (p) { return p && p[1] !== "" && p[1] != null; }).map(function (p) { return { k: p[0], v: String(p[1]) }; }) });
    };
    var chip = function (nm, on, pick) { return { name: nm, style: self.docChip(on), pick: pick }; };
    var chips = function (lbl, items, hint) { return blk("Chips", { label: lbl || "", hint: hint || "", chips: items.filter(Boolean) }); };
    var field = function (p) {
      return blk("Field", Object.assign({ label: "", value: "", placeholder: "", mode: "text", type: "text", suffix: "", err: "", hint: "", off: false }, p, {
        value: p.value == null ? "" : String(p.value),
        onChange: function (e) { if (!p.off) p.set(e.target.value); },
        boxStyle: "display:flex;align-items:center;gap:8px;border:1px solid " + (p.err ? "var(--danger)" : "var(--border-strong)") +
          ";border-radius:8px;background:var(--input-bg);padding:0 12px;max-width:" + (p.narrow ? "260px" : "520px") + (p.off ? ";opacity:0.6" : "") }));
    };
    /* a field bound to the session store under one key */
    var bound = function (k, p) {
      return field(Object.assign({}, p, { value: get(k, p.def != null ? p.def : ""), set: function (v) { var o = {}; o[k] = v; put(o); } }));
    };
    var empty = function (t, body, action, on) { return blk("Empty", { title: t, body: body || "", action: action || "", on: on || function () {} }); };
    var stat = function (k, v, sub, tone) {
      return { k: k, v: v, sub: sub || "", vStyle: "font-family:'IBM Plex Mono',monospace;font-size:1.0625em;font-weight:500;font-variant-numeric:tabular-nums;color:" + inkOf(tone) };
    };
    var hero = function (p) {
      return blk("Hero", Object.assign({ kicker: "", big: "", sub: "", stats: [] }, p, {
        hasStats: !!(p.stats && p.stats.length), hasNav: false, onPrev: function () {}, onNext: function () {}, prevOff: true, nextOff: true,
        bigStyle: "font-size:" + (p.small ? "1.5em" : "2.125em") + ";font-weight:600;letter-spacing:-0.02em;line-height:1.2;overflow-wrap:anywhere;text-wrap:pretty;color:" + inkOf(p.tone) }));
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
    var steps = function (list, cur) {
      return blk("Steps", { items: list.map(function (t, i) {
        var on = i === cur, done = i < cur;
        return { label: (done ? "\u2713 " : (i + 1) + " ") + t,
          style: "flex:0 0 auto;padding:6px 10px;border-radius:14px;font-size:0.71875em;white-space:nowrap;border:1px solid " + (on ? "var(--accent)" : "var(--border)") +
            ";color:" + (on ? "var(--text-on-accent)" : done ? "var(--text-primary)" : "var(--text-muted)") + ";background:" + (on ? "var(--accent)" : "var(--surface-raised)") };
      }) });
    };
    var cards = function (list) {
      return blk("Cards", { items: list.map(function (c) {
        return { title: c.title, sub: c.sub || "", meta: c.meta || "", pick: c.pick || function () {},
          style: "display:flex;flex-direction:column;gap:6px;min-height:96px;padding:12px 14px;text-align:left;font-family:inherit;border-radius:10px;cursor:pointer;border:1px solid " +
            (c.on ? "var(--accent)" : "var(--border)") + ";background:" + (c.on ? "var(--surface-sunken)" : "var(--surface-raised)") + ";box-shadow:" + (c.on ? "inset 0 0 0 1px var(--accent)" : "none") };
      }) });
    };
    var footBar = function (bg) {
      return "position:sticky;bottom:0;margin-top:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--border);background:" + bg;
    };
    /* one page: an optional navigation pane on wide clients, the main column, an optional sheet */
    var page = function (o) {
      var wide = s.client !== "mobile";
      var panes = [];
      if (wide && o.nav && o.nav.length) panes.push({ key: "nav", role: "navigation", title: o.navTitle || o.title,
        outer: "flex:0 0 " + (web ? "280px" : "34%") + ";min-width:0;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--border);background:var(--surface)",
        inner: "flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column", col: "display:flex;flex-direction:column;padding-bottom:24px",
        onOuter: function () {}, hasHead: false, sub: "", hasFoot: false, foot: [], footNote: "", footStyle: "", blocks: o.nav.filter(Boolean) });
      var narrow = o.narrow ? "520px" : wide ? "780px" : "none";
      panes.push({ key: "main", role: "region", title: o.title,
        outer: "flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--surface)" + (o.center ? ";align-items:center" : ""),
        inner: "flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column" + (o.center ? ";width:100%;align-items:center" : ""),
        col: "display:flex;flex-direction:column;flex:1 0 auto;width:100%;max-width:" + narrow + ";padding-bottom:32px" + (o.center ? ";padding-top:" + (wide ? "40px" : "8px") : ""),
        onOuter: function () {}, hasHead: !!o.bodyHead, grab: false, sub: o.bodySub || "", blocks: (o.blocks || []).filter(Boolean),
        hasFoot: !!(o.foot && o.foot.length), foot: o.foot || [], footNote: o.footNote || "", footStyle: footBar("var(--surface)") });
      var sh = o.sheet;
      if (sh) {
        var close = o.onCloseSheet || function () {};
        panes.push({ key: "sheet", role: "dialog", title: sh.title,
          outer: "position:absolute;inset:0;z-index:20;background:rgba(12,14,20,0.5);display:flex;justify-content:center;align-items:" + (web ? "center" : "flex-end"),
          onOuter: function (ev) { if (ev.target === ev.currentTarget) close(); },
          inner: "width:100%;max-width:560px;max-height:" + (web ? "88%" : "92%") + ";overflow-y:auto;display:flex;flex-direction:column;background:var(--surface-overlay);box-shadow:var(--shadow-2);border-radius:" + (web ? "14px" : "16px 16px 0 0"),
          col: "display:flex;flex-direction:column;flex:1 0 auto;padding-top:4px", hasHead: true, grab: !web, sub: sh.sub || "", blocks: (sh.blocks || []).filter(Boolean),
          hasFoot: !!(sh.foot && sh.foot.length), foot: sh.foot || [], footNote: sh.footNote || "", footStyle: footBar("var(--surface-overlay)") });
      }
      return { panes: panes, headTitle: o.title, headSub: o.sub || "", sheetOpen: !!sh, showBack: o.showBack !== false,
        onBack: o.onBack || function () { self.go(o.back || "/home"); }, bare: !!o.bare };
    };
    var ro = ["read_only", "canceled", "restricted"].indexOf(s.ent) >= 0 || s.screen === "readonly";
    var nav = window.HH_NAV ? window.HH_NAV.navFor(s.member, s.household) : {};
    var LV = ["none", "view", "contribute", "manage"];
    var at = function (m, want) { return LV.indexOf((nav.grants || {})[m] || "none") >= LV.indexOf(want); };
    var F = window.HH_FIXTURES;
    var memberOf = function (id) { return F ? F.members.filter(function (m) { return m.id === id; })[0] : null; };
    var nameOf = function (id) { var m = memberOf(id); return m ? m.name : id; };
    var safe = function (fn, d) { try { var v = fn(); return v == null ? d : v; } catch (e) { return d; } };
    return { s: s, L: L, cs: cs, web: web, wide: s.client !== "mobile", off: !s.online, ro: ro, nav: nav, at: at, F: F, memberOf: memberOf, nameOf: nameOf, safe: safe,
      get: get, put: put, go: go, toast: toast, blk: blk, inkOf: inkOf, row: row, check: check, toggle: toggle, label: label, rows: rows, note: note, btn: btn,
      acts: acts, kv: kv, chip: chip, chips: chips, field: field, bound: bound, empty: empty, stat: stat, hero: hero, bars: bars, steps: steps, cards: cards, page: page };
  };
})();
