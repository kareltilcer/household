/* Household settings, live in the prototype shell.
   Every route under /admin, /households/<slug>/settings, invitations, billing, leave, exports and
   /support/diagnostics is drawn here from HH_HOUSEHOLD, HH_FIXTURES and HH_NAV. Writes land on the
   fixture's own objects — a member's grants, their role, the household's name and its disabled
   modules — so the tab bar, the More list and every module screen recompute the moment an owner
   saves. The entitlement state is the rail's own `ent`, so cancelling, resuming, restricting and
   lifting move the banner the whole app draws. Drawn through the Finance block vocabulary. */
(function () {
  var KINDS = ["Hero", "Label", "Rows", "Note", "Bars", "Acts", "Field", "Chips", "Inputs", "Cards", "Steps", "Kv", "Empty"];
  var LV = ["none", "view", "contribute", "manage"];
  function safe(fn, d) { try { var v = fn(); return v == null ? d : v; } catch (e) { return d; } }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* the session's own household-admin state, seeded once from the fixture */
  function store() {
    if (window.HH_HS) return window.HH_HS;
    var H = window.HH_HOUSEHOLD;
    var dflt = {}; (H ? H.modules : []).forEach(function (m) { dflt[m[0]] = m[2]; });
    window.HH_HS = {
      code: "K7M2-4PQX", units: "Metric", lang: "\u010ce\u0161tina", mine: {},
      invites: [{ id: "inv-petr", code: "P3TR-9XQA", name: "Petr", email: "petr@tilcer.cz", role: "member", by: "jana",
        status: "declined", when: "9 September at 18:20", grants: dflt, fixture: true }],
      offer: null, deletion: null, under: null, restrictedBy: null, plan: "yearly",
      exp: { status: "none" }, bundleOff: {}, sent: null, profilePending: false,
      devices: H ? clone(H.devices) : []
    };
    return window.HH_HS;
  }

  function view(self, seg, query, hash, wide) {
    var H = window.HH_HOUSEHOLD, F = window.HH_FIXTURES, N = window.HH_NAV;
    if (!H || !F || !N) return null;
    var S = store();
    var s = self.state, L = self.chatL.bind(self), web = s.client === "web", cs = s.locale === "cs";
    var hh = F.households.filter(function (x) { return x.id === s.household; })[0];
    if (!hh) return null;
    var nav = N.navFor(s.member, s.household) || {};
    if (!nav.belongs) return null;
    var me = nav.member, grants = nav.grants || {}, lvl = grants.admin || "none";
    var slug = hh.id === "hh-tilcer" ? "tilcerovi" : "chata";
    var base = "/households/" + slug;
    var hhName = hh.name, off = !s.online, ent = s.ent;
    var ro = ["read_only", "canceled", "restricted"].indexOf(ent) >= 0 || s.screen === "readonly";
    var roleOf = function (id) { var n = N.navFor(id, hh.id); return n && n.belongs ? n.role : null; };
    var isOwner = nav.role === "owner";
    var tilcer = hh.id === "hh-tilcer";
    var members = F.members.filter(function (m) { return !m.removed && (hh.members || []).indexOf(m.id) >= 0; });
    var owners = members.filter(function (m) { return roleOf(m.id) === "owner"; });
    var payer = members.filter(function (m) { return m.billing; })[0] || null;
    var isPayer = !!(payer && payer.id === me.id);
    var name = function (id) { var m = F.members.filter(function (x) { return x.id === id; })[0]; return m ? m.name : id; };
    var modName = function (k) { return F.moduleName ? F.moduleName(k, s.locale) : k; };
    var phrase = function (lv) { return cs ? { none: "Vypnuto", view: "Vid\u00ed", contribute: "P\u0159id\u00e1v\u00e1 a upravuje", manage: "Nastavuje" }[lv] : H.phrase[lv]; };
    var roleW = function (r) { return r === "owner" ? L("Owner", "Vlastn\u00edk") : r === "child" ? L("Child", "D\u00edt\u011b") : L("Member", "\u010clen"); };
    var disabled = hh.disabled || (hh.disabled = []);
    var go = function (r) { return function () { self.setState({ hsSheet: null }); self.go(r); }; };
    var now = function () { var d = new Date(); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); };

    /* ── blocks (the Finance vocabulary) ── */
    var blk = function (t, p) { var o = {}; KINDS.forEach(function (x) { o["is" + x] = x === t; }); return Object.assign(o, p); };
    var inkOf = function (t) {
      return t === "danger" ? "var(--danger)" : t === "warn" ? "var(--warning)" : t === "accent" ? "var(--accent)"
        : t === "offline" ? "var(--status-offline)" : t === "muted" ? "var(--text-muted)" : t === "ok" ? "var(--success, var(--accent))" : "var(--text-primary)";
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
        titleStyle: "font-size:0.9375em;line-height:1.35;overflow-wrap:anywhere;font-weight:" + (p.strong ? "600" : "500") + ";color:" + (p.muted ? "var(--text-muted)" : p.tone === "danger" && !p.right ? "var(--danger)" : "var(--text-primary)"),
        subStyle: "font-size:0.75em;line-height:1.45;overflow-wrap:anywhere;text-wrap:pretty;color:" + (p.subTone ? inkOf(p.subTone) : "var(--text-muted)"),
        rightStyle: "font-family:'IBM Plex Mono',monospace;font-size:0.84375em;white-space:nowrap;font-variant-numeric:tabular-nums;color:" + inkOf(p.tone),
        badgeStyle: badgeStyle(p.badgeTone),
        dotStyle: "flex:0 0 10px;width:10px;height:10px;border-radius:3px;background:" + (p.dotInk || "var(--border-strong)"),
        actStyle: "flex:0 0 auto;align-self:center;margin-right:12px;min-height:36px;padding:0 12px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:0.78125em;font-weight:600;white-space:nowrap;border:1px solid " +
          (p.actTone === "danger" ? "var(--danger)" : "var(--accent)") + ";background:transparent;color:" + (p.actTone === "danger" ? "var(--danger)" : "var(--accent)")
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
    var bars = function (list, ink) {
      var max = list.reduce(function (n, p) { return Math.max(n, p.v); }, 0) || 1;
      return blk("Bars", { rows: list.map(function (p) {
        return { name: p.name, right: p.right, left: p.left || "", proj: p.proj || "",
          rightStyle: "font-family:'IBM Plex Mono',monospace;font-size:0.8125em;white-space:nowrap;color:var(--text-primary)",
          projStyle: "white-space:nowrap;color:var(--text-muted)",
          fill: "position:absolute;left:0;top:0;bottom:0;border-radius:4px;width:" + Math.max(p.v ? 2 : 0, Math.min(100, Math.round(p.v / max * 100))) + "%;background:" + (ink || "var(--accent)"),
          tick: "display:none", noOpen: !p.open, open: p.open || function () {}, cursor: p.open ? "pointer" : "default" };
      }) });
    };

    /* ── session writes ── */
    var bump = function (extra) { self.setState(Object.assign({ hsRev: (self.state.hsRev || 0) + 1 }, extra || {})); };
    var commit = function (doIt, undo, toast, extra) {
      doIt();
      bump(Object.assign({ hsSheet: null }, extra || {}));
      if (typeof toast === "function") toast = toast();
      if (toast) self.docToastShow(toast, undo ? function () { undo(); bump({ docToast: null }); } : null);
    };
    var open = function (d) { return function () { self.setState({ hsSheet: Object.assign({ at: self.state.route }, d) }); }; };
    var sheetD = (s.hsSheet && s.hsSheet.at === s.route) ? s.hsSheet : null;
    var patch = function (p) { self.setState({ hsSheet: Object.assign({}, sheetD, { at: self.state.route }, p) }); };
    var closeSheet = function () { self.setState({ hsSheet: null }); };
    var newCode = function () {
      var A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", o = "";
      for (var i = 0; i < 8; i++) o += A.charAt(Math.floor(Math.random() * A.length)) + (i === 3 ? "-" : "");
      return o;
    };

    /* ── what each person holds ── */
    var rawGrant = function (m, k) {
      if (!tilcer) return (N.grantsFor(m.id, hh.id) || {})[k] || "none";
      return (m.grants || {})[k] || "none";
    };
    var heldLine = function (m) {
      var c = { manage: 0, contribute: 0, view: 0, none: 0 };
      H.modules.forEach(function (x) { c[disabled.indexOf(x[0]) >= 0 ? "none" : rawGrant(m, x[0])]++; });
      return [c.manage ? phrase("manage") + " \u00b7 " + c.manage : "", c.contribute ? phrase("contribute") + " \u00b7 " + c.contribute : "",
        c.view ? phrase("view") + " \u00b7 " + c.view : "", c.none ? phrase("none") + " \u00b7 " + c.none : ""].filter(Boolean).join("   ");
    };
    var capFor = function (role, k) {
      if (role === "owner") return "manage";
      if (role === "child") { var mm = H.modules.filter(function (x) { return x[0] === k; })[0]; return mm ? mm[4] : "view"; }
      return "manage";
    };
    var defaultsFor = function (role) {
      var g = {}; H.modules.forEach(function (x) { g[x[0]] = role === "owner" ? "manage" : role === "child" ? x[3] : x[2]; }); return g;
    };
    var countLine = function (g) {
      var c = { manage: 0, contribute: 0, view: 0, none: 0 };
      Object.keys(g).forEach(function (k) { c[g[k]]++; });
      return LV.slice().reverse().filter(function (l) { return c[l]; }).map(function (l) { return c[l] + " " + phrase(l).toLowerCase(); }).join(" \u00b7 ");
    };

    /* ── route ── */
    var page = "home", sub = seg[3] || "", cur = null;
    if (seg[0] === "admin") page = "home";
    else if (seg[0] === "households") {
      var a = seg[2] || "";
      if (a === "settings") {
        page = !sub ? "home" : ({ members: "members", modules: "modules", storage: "storage", billing: "billing", data: "data", sync: "sync", advanced: "advanced" })[sub] || "missing";
        if (page === "members" && seg[4]) { cur = members.filter(function (m) { return m.id === seg[4]; })[0]; page = cur ? "member" : "missing"; }
      } else if (a === "invitations") page = seg[3] === "new" ? "compose" : "invites";
      else if (a === "leave") page = "leave";
      else if (a === "billing") page = seg[3] === "takeover" ? "takeover" : "subscribe";
      else if (a === "exports") page = "exports";
      else if (!a) page = "home";
      else page = "missing";
    }
    else if (seg[0] === "invitations") page = "accept";
    else if (seg[0] === "support" && seg[1] === "diagnostics") page = "bundle";
    else return null;

    /* a member without Household settings still leaves, and still answers an invitation */
    if (lvl === "none" && ["leave", "accept"].indexOf(page) < 0) return null;
    var canW = isOwner && !ro;
    var P = [], headTitle = L("Household settings", "Nastaven\u00ed dom\u00e1cnosti"), headSub = hhName;
    var push = function (x) { if (x) P.push(x); };
    var ownerNote = function () {
      if (isOwner) return null;
      return note(L("You can read everything here. Changing it is for an owner \u2014 " + owners.map(function (o) { return o.name; }).join(" or ") + ".",
        "V\u0161e tady si m\u016f\u017eete p\u0159e\u010d\u00edst. M\u011bnit to m\u016f\u017ee vlastn\u00edk \u2014 " + owners.map(function (o) { return o.name; }).join(" nebo ") + "."), "box");
    };
    var roNote = function (exempt) {
      if (!ro) return null;
      if (exempt) return note(L("The household is " + (ent === "restricted" ? "restricted" : "read-only") + ", and this screen still works: it is exempt from the gate on purpose.",
        "Dom\u00e1cnost je jen ke \u010dten\u00ed a tahle obrazovka p\u0159esto funguje."), "boxWarn");
      return note(ent === "restricted" ? L("Restricted \u2014 nothing can be changed until an owner lifts it. Everything here still reads.", "Omezeno \u2014 nic nejde m\u011bnit, dokud to vlastn\u00edk nezru\u0161\u00ed.")
        : L("Read-only \u2014 settings cannot be changed until the subscription resumes. Everything here still reads.", "Jen ke \u010dten\u00ed \u2014 nastaven\u00ed nejde m\u011bnit, dokud se p\u0159edplatn\u00e9 neobnov\u00ed."), "boxWarn");
    };
    var offNote = function (what) {
      return off ? note(what || L("Offline. This screen reads from the last time the phone was online.", "Offline. Obrazovka ukazuje stav z posledn\u00edho p\u0159ipojen\u00ed."), "boxOff") : null;
    };
    if (S.deletion && ["home", "data"].indexOf(page) >= 0) push(note(L(hhName + " will be deleted on " + S.deletion.until + ". " + name(S.deletion.by) + " asked for it today at " + S.deletion.at + ", and everybody was told.",
      hhName + " bude smaz\u00e1na " + S.deletion.until + "."), "boxDanger", isOwner ? L("Keep " + hhName, "Ponechat " + hhName) : "", isOwner ? function () {
        var d0 = S.deletion; commit(function () { S.deletion = null; }, function () { S.deletion = d0; }, L("Deletion cancelled \u00b7 nothing was lost", "Smaz\u00e1n\u00ed zru\u0161eno"));
      } : null));

    /* ═══ pages ═══ */
    if (page === "missing") push(empty(L("Not in these settings", "Tohle v nastaven\u00ed nen\u00ed"), L("The address may be from an older version of the app.", "Adresa m\u016f\u017ee b\u00fdt ze star\u0161\u00ed verze aplikace."), L("Household settings", "Nastaven\u00ed dom\u00e1cnosti"), go(base + "/settings")));

    function sectionRows(activeKey) {
      var list = [
        ["home", L("Household", "Dom\u00e1cnost"), hh.country === "CZ" ? L("Czechia", "\u010cesko") + " \u00b7 " + hh.tz + " \u00b7 " + hh.currency : hh.tz, base + "/settings"],
        ["members", L("Members", "\u010clenov\u00e9"), members.length + L(" people", " lid\u00ed") + (S.invites.filter(function (i) { return i.status === "sent"; }).length ? " \u00b7 " + S.invites.filter(function (i) { return i.status === "sent"; }).length + L(" invited", " pozv\u00e1no") : ""), base + "/settings/members"],
        ["modules", L("Modules", "Moduly"), (16 - disabled.length) + L(" of 16 on", " z 16 zapnuto"), base + "/settings/modules"],
        ["notif", L("Notifications", "Ozn\u00e1men\u00ed"), L("what the household tells people, and when", "co dom\u00e1cnost komu \u0159\u00edk\u00e1 a kdy"), "/settings/notifications"],
        ["storage", L("Storage", "\u00dalo\u017ei\u0161t\u011b"), H.storage.current + " GB \u00b7 " + H.blocksFor(H.storage.mtdAverage) + L(" blocks this month", " bloky tento m\u011bs\u00edc"), base + "/settings/storage"],
        isOwner ? ["billing", L("Billing", "Platby"), isPayer ? entWord(ent) + " \u00b7 " + L("you pay", "plat\u00edte vy") : entWord(ent) + " \u00b7 " + (payer ? name(payer.id) + L(" pays", " plat\u00ed") : ""), base + "/settings/billing"] : null,
        ["data", L("Data", "Data"), L("export, restrict, hand over, delete", "export, omezen\u00ed, p\u0159ed\u00e1n\u00ed, smaz\u00e1n\u00ed"), base + "/settings/data"],
        ["sync", L("Sync health", "Stav synchronizace"), S.devices.length + L(" devices", " za\u0159\u00edzen\u00ed") + (S.devices.some(function (d) { return d.tone === "conflict" || d.tone === "digest"; }) ? L(" \u00b7 1 needs you", " \u00b7 1 \u010dek\u00e1 na v\u00e1s") : ""), base + "/settings/sync"],
        ["advanced", L("Clients and versions", "Klienti a verze"), L("who is on which build", "kdo m\u00e1 jakou verzi"), base + "/settings/advanced"]
      ].filter(Boolean);
      return list.map(function (x) {
        return row({ title: x[1], sub: x[2], on: activeKey === x[0], noChev: wide, open: go(x[3]),
          subTone: x[0] === "sync" && /needs|\u010dek\u00e1/.test(x[2]) ? "warn" : "" });
      });
    }
    function entWord(e) {
      return ({ trialing: L("Trial", "Zku\u0161ebn\u00ed doba"), active: L("Active", "Aktivn\u00ed"), past_due: L("Payment failed", "Platba selhala"), grace: L("Uploads paused", "Nahr\u00e1v\u00e1n\u00ed pozastaveno"),
        read_only: L("Read-only", "Jen ke \u010dten\u00ed"), canceled: L("Cancelled", "Zru\u0161eno"), restricted: L("Restricted", "Omezeno"), suspended: L("Suspended", "Pozastaveno") })[e] || e;
    }

    if (page === "home") {
      headTitle = L("Household", "Dom\u00e1cnost"); headSub = L("Household settings", "Nastaven\u00ed dom\u00e1cnosti");
      push(roNote(false)); push(ownerNote());
      if (s.screen === "conflicted" && canW) {
        push(note(L("Two versions of the household name. Jana renamed it to \u201cTilcerovi\u201d at 18:40 and Milo\u0161 to \u201cTilcerovi \u2014 chata\u201d at 18:41. Household settings are strict-version, so this is a question, not a merge.",
          "Dv\u011b verze n\u00e1zvu dom\u00e1cnosti. Vyberte, kter\u00e1 plat\u00ed."), "boxWarn"));
        push(acts([btn(L("Keep \u201cTilcerovi\u201d", "Ponechat \u201eTilcerovi\u201c"), "primary", function () { commit(function () { hh.name = "Tilcerovi"; }, null, L("Kept \u201cTilcerovi\u201d \u00b7 Milo\u0161 is told", "Ponech\u00e1no"), { screen: "populated" }); }),
          btn(L("Use \u201cTilcerovi \u2014 chata\u201d", "Pou\u017e\u00edt \u201eTilcerovi \u2014 chata\u201c"), "", function () { var o = hh.name; commit(function () { hh.name = "Tilcerovi \u2014 chata"; }, function () { hh.name = o; }, L("Renamed \u00b7 Jana is told", "P\u0159ejmenov\u00e1no"), { screen: "populated" }); })]));
      }
      if (S.profilePending && !off) S.profilePending = false;
      push(label(L("The household", "Dom\u00e1cnost"), canW ? L("Edit", "Upravit") : "", open({ kind: "profile", name: hhName, tz: hh.tz, lang: S.lang, units: S.units, firstDay: hh.firstDay || "monday", err: "" })));
      push(kv([[L("Name", "N\u00e1zev"), hhName + (S.profilePending ? L(" \u00b7 saved on this phone, not sent yet", " \u00b7 ulo\u017eeno v telefonu") : "")],
        [L("Country", "Zem\u011b"), hh.country === "CZ" ? L("Czechia", "\u010cesko") : hh.country], [L("Time zone", "\u010casov\u00e9 p\u00e1smo"), hh.tz],
        [L("Language", "Jazyk"), S.lang], [L("Units", "Jednotky"), S.units]]));
      if (canW) push(acts([btn(L("Change the country", "Zm\u011bnit zemi"), "", go(base + "/settings/country"), off)]));
      push(label(L("Money", "Pen\u00edze"), canW ? L("Change", "Zm\u011bnit") : "", open({ kind: "currency", to: hh.currency === "CZK" ? "EUR" : "CZK", err: "" })));
      push(kv([[L("Counted in", "Po\u010d\u00edt\u00e1 se v"), hh.currency === "CZK" ? L("CZK \u2014 Czech koruna", "CZK \u2014 \u010desk\u00e1 koruna") : hh.currency === "EUR" ? "EUR \u2014 euro" : hh.currency]]));
      push(note(L("Changing it converts nothing. It sets what new amounts default to, and the sheet says what that touches before anything happens.", "Zm\u011bna nic nep\u0159epo\u010d\u00edt\u00e1v\u00e1; nastav\u00ed jen v\u00fdchoz\u00ed m\u011bnu nov\u00fdch \u010d\u00e1stek.")));
      var fd = function (d) { return ({ monday: L("Monday", "pond\u011bl\u00ed"), sunday: L("Sunday", "ned\u011ble"), saturday: L("Saturday", "sobota") })[d] || d; };
      var mine = S.mine[me.id] || "";
      push(label(L("The week starts on", "T\u00fdden za\u010d\u00edn\u00e1")));
      push(kv([[L("For the household", "Pro dom\u00e1cnost"), fd(hh.firstDay || "monday")]]));
      push(chips(L("For you", "Pro v\u00e1s"), [["", L("Same as the household", "Jako dom\u00e1cnost")], ["monday", fd("monday")], ["sunday", fd("sunday")]].map(function (x) {
        return chip(x[1], mine === x[0], function () { var o = S.mine[me.id]; commit(function () { S.mine[me.id] = x[0]; }, function () { S.mine[me.id] = o; },
          x[0] ? L("Your weeks start on " + fd(x[0]) + " \u00b7 only on your screens", "V\u00e1\u0161 t\u00fdden za\u010d\u00edn\u00e1 " + fd(x[0])) : L("Your weeks follow the household", "V\u00e1\u0161 t\u00fdden podle dom\u00e1cnosti")); });
      }), L("Your own setting wins on your screens. It is yours, so it works in every state and offline.", "Va\u0161e volba plat\u00ed na va\u0161ich obrazovk\u00e1ch.")));
      var kids = members.filter(function (m) { return m.role === "child"; });
      push(label(L("The household code", "K\u00f3d dom\u00e1cnosti")));
      push(kv([[L("Code", "K\u00f3d"), S.code], [L("Who needs it", "Kdo ho pot\u0159ebuje"), kids.length ? kids.map(function (k) { return k.name; }).join(", ") + L(", on their own phone", ", na vlastn\u00edm telefonu") : L("Nobody here \u2014 it is only for a child profile signing in", "Nikdo \u2014 slou\u017e\u00ed jen d\u011btsk\u00e9mu profilu")]]));
      push(acts([btn(L("Copy", "Kop\u00edrovat"), "", function () { try { navigator.clipboard.writeText(S.code).catch(function () {}); } catch (e) {} self.docToastShow(L("Copied " + S.code, "Zkop\u00edrov\u00e1no " + S.code)); }),
        isOwner ? btn(L("Make a new one", "Vytvo\u0159it nov\u00fd"), "", open({ kind: "code" }), ro || off) : null]));
      if (!wide) { push(label(L("More settings", "Dal\u0161\u00ed nastaven\u00ed"))); push(rows(sectionRows("").slice(1))); }
      push(label(L("You", "Vy")));
      push(rows([row({ title: L("Leave " + hhName, "Opustit " + hhName), sub: L("What has to be settled first, and what stays", "Co je t\u0159eba vy\u0159e\u0161it p\u0159edem a co z\u016fstane"), tone: "danger", open: go(base + "/leave") })]));
    }

    if (page === "members") {
      headTitle = L("Members", "\u010clenov\u00e9"); headSub = L("Everybody\u2019s access, visible to everybody", "P\u0159\u00edstup v\u0161ech, viditeln\u00fd pro v\u0161echny");
      push(roNote(false)); push(ownerNote());
      push(acts([canW ? btn(L("Invite somebody", "Pozvat n\u011bkoho"), "primary", go(base + "/invitations/new")) : null]));
      push(rows(members.map(function (m) {
        return row({ title: m.name + (m.id === me.id ? L(" \u00b7 you", " \u00b7 vy") : ""), sub: heldLine(m), right: roleW(roleOf(m.id)), rightSub: m.billing ? L("pays", "plat\u00ed") : "",
          badge: m.session ? L("new", "nov\u00fd") : "", badgeTone: "accent", open: go(base + "/settings/members/" + m.id) });
      })));
      var inv = S.invites.filter(function (i) { return i.status === "sent" || i.status === "draft" || i.status === "declined"; });
      if (inv.length) {
        push(label(L("Invitations", "Pozv\u00e1nky"), L("All", "V\u0161echny"), go(base + "/invitations")));
        push(rows(inv.map(inviteRow)));
      }
      push(note(L("Any member may read this screen. Every change on it is for an owner, whatever the grant says.", "Tuto obrazovku m\u016f\u017ee \u010d\u00edst ka\u017ed\u00fd \u010dlen. M\u011bnit ji m\u016f\u017ee jen vlastn\u00edk.")));
    }
    function inviteRow(i) {
      var st = { sent: L("waiting", "\u010dek\u00e1"), draft: L("not sent", "neodesl\u00e1no"), declined: L("declined", "odm\u00edtnuto"), revoked: L("withdrawn", "sta\u017eeno"), accepted: L("joined", "p\u0159ipojen") }[i.status];
      return row({ title: i.name, sub: roleW(i.role) + " \u00b7 " + (i.email || L("by link", "odkazem")) + " \u00b7 " + i.when, right: st,
        tone: i.status === "declined" ? "muted" : i.status === "sent" ? "accent" : "", open: open({ kind: "invite", id: i.id }) });
    }

    if (page === "member") {
      var m = cur, mRole = roleOf(m.id), self_ = m.id === me.id;
      headTitle = m.name; headSub = roleW(mRole) + (m.billing ? L(" \u00b7 pays for the household", " \u00b7 plat\u00ed za dom\u00e1cnost") : "");
      push(roNote(false));
      if (off && isOwner) push(note(L("Access is changed on the server or not at all, so this needs a connection. Reading it does not.", "P\u0159\u00edstup se m\u011bn\u00ed jen online."), "boxOff"));
      var gw = canW && !off && tilcer && mRole !== "owner";
      push(acts([
        canW && tilcer && !self_ && mRole === "member" ? btn(L("Make " + m.name + " an owner", "Ud\u011blat z " + m.name + " vlastn\u00edka"), "", open({ kind: "owner", id: m.id }), off) : null,
        canW && tilcer && !self_ && mRole === "owner" ? btn(L("Make " + m.name + " a member", "Ud\u011blat z " + m.name + " \u010dlena"), "", function () {
          var o = { role: m.role, grants: clone(m.grants) };
          commit(function () { m.role = "member"; }, function () { m.role = o.role; }, m.name + L(" is a member \u00b7 their access is unchanged until you lower it", " je \u010dlen \u00b7 p\u0159\u00edstup z\u016fst\u00e1v\u00e1"));
        }, off) : null,
        canW && tilcer && !self_ ? btn(L("Remove " + m.name, "Odebrat " + m.name), "danger-ghost", open({ kind: "remove", id: m.id }), off || m.billing) : null
      ]));
      if (canW && m.billing && !self_) push(note(L(m.name + " pays for the household, so billing moves before they can be removed.", m.name + " plat\u00ed, tak\u017ee nejd\u0159\u00edv se mus\u00ed p\u0159edat platby."), "muted"));
      if (mRole === "owner") push(note(L("Owners can set up every module by construction. To narrow what " + m.name + " holds, make them a member first.", "Vlastn\u00edk nastavuje v\u0161echny moduly. Pro z\u00fa\u017een\u00ed ho nejd\u0159\u00edv ud\u011blejte \u010dlenem."), "box"));
      if (mRole === "child" && canW && tilcer) push(acts([btn(L("Reset the PIN", "Obnovit PIN"), "", go(base + "/settings/members/" + m.id + "/pin"), off),
        btn(L("Give " + m.name + " their own sign-in", "Dát " + m.name + " vlastn\u00ed p\u0159ihl\u00e1\u0161en\u00ed"), "", go(base + "/settings/members/" + m.id + "/graduate"), off)]));
      if (mRole === "child") push(note(L("A child profile can\u2019t set anything up, and can at most see Finance. Their choices stop there.", "D\u011btsk\u00fd profil nic nenastavuje a Finance nejv\u00fd\u0161 vid\u00ed."), "box"));
      push(label(L("What " + m.name + " holds", "Co m\u00e1 " + m.name)));
      push(rows(H.modules.map(function (x) {
        var k = x[0], lv = rawGrant(m, k), offMod = disabled.indexOf(k) >= 0;
        return row({ title: modName(k), sub: offMod ? L("Off for the whole household", "Vypnuto pro celou dom\u00e1cnost") : "", subTone: offMod ? "warn" : "",
          right: phrase(offMod ? "none" : lv), tone: lv === "none" || offMod ? "muted" : "",
          act: gw && !offMod ? L("Change", "Zm\u011bnit") : "", onAct: open({ kind: "grant", id: m.id, key: k, level: lv }) });
      })));
      push(note(L("Lowering somebody\u2019s access tells them at the moment it happens. Off means the module is not in their app at all \u2014 no screen, no widget, no search result, no reminder.",
        "Sn\u00ed\u017een\u00ed p\u0159\u00edstupu se \u010dlov\u011bku ozn\u00e1m\u00ed hned. Vypnuto znamen\u00e1, \u017ee modul v jeho aplikaci v\u016fbec nen\u00ed.")));
    }

    if (page === "invites") {
      headTitle = L("Invitations", "Pozv\u00e1nky"); headSub = hhName;
      push(acts([canW ? btn(L("Invite somebody", "Pozvat n\u011bkoho"), "primary", go(base + "/invitations/new")) : null]));
      var dec = S.invites.filter(function (i) { return i.status === "declined" && i.fixture; })[0];
      if (dec && isOwner) {
        push(note(dec.name + L(" declined the invitation \u00b7 " + dec.when + ". Nothing was shared with him and the invitation is closed. If it was the access that gave him pause, you can invite him again with different modules.",
          " odm\u00edtl pozv\u00e1nku \u00b7 " + dec.when + ". Nic se s n\u00edm nesd\u00edlelo."), "box", canW ? L("Invite " + dec.name + " again", "Pozvat znovu") : "", canW ? function () { self.setState({ hsInvite: { name: dec.name, email: dec.email, how: "email", role: dec.role, grants: clone(dec.grants), err: "" } }); self.go(base + "/invitations/new"); } : null));
      }
      if (!S.invites.length) push(empty(L("No invitations yet.", "Zat\u00edm \u017e\u00e1dn\u00e9 pozv\u00e1nky."), L("Invite somebody and the whole matrix is answered before you open it.", "Pozv\u011bte n\u011bkoho \u2014 p\u0159\u00edstupy jsou p\u0159edvypln\u011bn\u00e9."), "", null));
      else push(rows(S.invites.slice().reverse().map(inviteRow)));
      push(note(L("Recorded in the activity log, where the household can see it.", "Zaznamen\u00e1no v protokolu aktivit.")));
    }

    if (page === "compose") {
      var d = s.hsInvite || { name: "", email: "", how: "email", role: "member", grants: defaultsFor("member"), err: "" };
      var setD = function (p) { self.setState({ hsInvite: Object.assign({}, d, p) }); };
      headTitle = d.name ? L("Invite " + d.name, "Pozvat " + d.name) : L("Invite somebody", "Pozvat n\u011bkoho"); headSub = L("Seventeen decisions, already answered", "Sedmn\u00e1ct rozhodnut\u00ed, u\u017e zodpov\u011bzen\u00fdch");
      if (!isOwner) push(empty(L("Inviting is for an owner.", "Zvat m\u016f\u017ee vlastn\u00edk."), owners.map(function (o) { return o.name; }).join(", "), "", null));
      else {
        push(roNote(false));
        if (off) push(note(L("An invitation cannot be sent offline. It carries your name to somebody else\u2019s phone, so it goes when there is signal. What you set here is kept.", "Pozv\u00e1nku nejde poslat offline. Co tu nastav\u00edte, z\u016fstane."), "boxOff"));
        push(field({ label: L("Their name", "Jm\u00e9no"), value: d.name, placeholder: "Petr", err: d.err && !String(d.name).trim() ? d.err : "", set: function (v) { setD({ name: v, err: "" }); } }));
        push(chips(L("How they get it", "Jak ji dostanou"), [chip(L("Email", "E-mailem"), d.how === "email", function () { setD({ how: "email" }); }), chip(L("A link I send myself", "Odkaz, kter\u00fd po\u0161lu s\u00e1m"), d.how === "link", function () { setD({ how: "link" }); })],
          d.how === "email" ? L("Expires in 14 days.", "Plat\u00ed 14 dn\u00ed.") : L("Anyone with the link can use it once. Expires in 14 days.", "Odkaz jde pou\u017e\u00edt jednou. Plat\u00ed 14 dn\u00ed.")));
        if (d.how === "email") push(field({ label: L("Email", "E-mail"), type: "email", mode: "email", value: d.email, placeholder: "petr@\u2026", set: function (v) { setD({ email: v, err: "" }); } }));
        push(chips(L("Role", "Role"), ["member", "owner", "child"].map(function (r) {
          return chip(roleW(r), d.role === r, function () { setD({ role: r, grants: defaultsFor(r) }); });
        }), d.role === "owner" ? L("Owners can set up everything, invite and remove people, and delete the household.", "Vlastn\u00edk nastavuje v\u0161e a m\u016f\u017ee zvat i odeb\u00edrat.") : d.role === "child" ? L("Signs in with the household code on their own phone. Some modules are capped.", "P\u0159ihla\u0161uje se k\u00f3dem dom\u00e1cnosti.") : ""));
        push(label(L("What they get", "Co dostanou") + " \u00b7 " + countLine(d.grants), L("Reset to defaults", "V\u00fdchoz\u00ed"), function () { setD({ grants: defaultsFor(d.role) }); }));
        push(rows(H.modules.map(function (x) {
          var k = x[0], lv = d.grants[k] || "none", offMod = disabled.indexOf(k) >= 0, dflt = defaultsFor(d.role)[k];
          return row({ title: modName(k), sub: offMod ? L("Off for the household \u2014 applies when it is turned on", "Pro dom\u00e1cnost vypnuto") : lv !== dflt ? L("changed from ", "zm\u011bn\u011bno z ") + phrase(dflt).toLowerCase() : "",
            subTone: offMod ? "warn" : lv !== dflt ? "accent" : "", right: phrase(lv), tone: lv === "none" ? "muted" : "",
            act: d.role !== "owner" ? L("Change", "Zm\u011bnit") : "", onAct: open({ kind: "invGrant", key: k, level: lv }) });
        })));
        push(note(L("The defaults draw one line: what the household does together is open, what it owns and spends is closed until somebody opens it. They see this whole list before they answer.",
          "V\u00fdchoz\u00ed nastaven\u00ed: co dom\u00e1cnost d\u011bl\u00e1 spole\u010dn\u011b, je otev\u0159en\u00e9; co vlastn\u00ed a utr\u00e1c\u00ed, je zav\u0159en\u00e9.")));
        if (d.err) push(note(d.err, "danger"));
        var mkInv = function (status) {
          var nm = String(d.name || "").trim(), em = String(d.email || "").trim();
          if (!nm) return setD({ err: L("Say who it is for \u2014 their name is what they see first.", "Napi\u0161te, pro koho pozv\u00e1nka je.") });
          if (d.how === "email" && status === "sent" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return setD({ err: L("That email is missing something. Or send a link instead.", "E-mailu n\u011bco chyb\u00ed.") });
          if (status === "sent" && members.some(function (x) { return x.name.toLowerCase() === nm.toLowerCase(); }) && d.how === "email" && S.invites.some(function (i) { return i.email === em && i.status === "sent"; }))
            return setD({ err: L("Rejected: an invitation to " + em + " is already waiting.", "Odm\u00edtnuto: pozv\u00e1nka u\u017e \u010dek\u00e1.") });
          var iv = { id: "inv-" + Date.now() % 1000000, code: newCode(), name: nm, email: d.how === "email" ? em : "", role: d.role, grants: clone(d.grants), by: me.id,
            status: status, when: L("today at ", "dnes v ") + now(), session: true };
          commit(function () { S.invites.push(iv); }, function () { S.invites.splice(S.invites.indexOf(iv), 1); },
            status === "sent" ? (d.how === "email" ? L("Sent to " + em + " \u00b7 expires in 14 days", "Odesl\u00e1no na " + em) : L("Link ready \u00b7 " + iv.code, "Odkaz p\u0159ipraven \u00b7 " + iv.code)) : L("Saved \u00b7 not sent", "Ulo\u017eeno \u00b7 neodesl\u00e1no"),
            { hsInvite: null, route: base + "/settings/members" });
        };
        push(acts([btn(L("Send the invitation", "Odeslat pozv\u00e1nku"), "primary", function () { mkInv("sent"); }, off || ro),
          btn(L("Save and send later", "Ulo\u017eit a poslat pozd\u011bji"), "", function () { mkInv("draft"); }, ro)]));
      }
    }

    if (page === "accept") {
      var code = seg[1] || "";
      var iv0 = S.invites.filter(function (i) { return i.code === code; })[0];
      var preview = !iv0;
      var ivG = iv0 ? iv0.grants : defaultsFor("member");
      var from = iv0 ? name(iv0.by) : (owners[0] || me).name;
      headTitle = L(from + " has invited you to " + hhName, from + " v\u00e1s zve do " + hhName); headSub = L("Here is exactly what that gives you", "P\u0159esn\u011b tohle dostanete");
      if (iv0 && iv0.status !== "sent") {
        push(empty(iv0.status === "accepted" ? L(iv0.name + " has joined.", iv0.name + " se p\u0159ipojil(a).") : iv0.status === "declined" ? L("This invitation was declined.", "Pozv\u00e1nka byla odm\u00edtnuta.") : iv0.status === "revoked" ? L("This invitation was withdrawn.", "Pozv\u00e1nka byla sta\u017eena.") : L("This invitation was not sent yet.", "Pozv\u00e1nka je\u0161t\u011b neode\u0161la."),
          L("Nothing about anybody\u2019s account changed.", "Nic se na \u017e\u00e1dn\u00e9m \u00fa\u010dtu nezm\u011bnilo."), L("Back", "Zp\u011bt"), go(base + "/invitations")));
      } else {
        if (preview) push(note(L("This is the default invitation as an invitee reads it. Open one you sent from Invitations to answer it as them.", "Takto pozv\u00e1nku \u010dte pozvan\u00fd."), "box"));
        var grp = LV.slice().reverse().map(function (lv) {
          return { lv: lv, mods: H.modules.filter(function (x) { return (ivG[x[0]] || "none") === lv; }).map(function (x) { return modName(x[0]); }) };
        }).filter(function (g) { return g.mods.length; });
        grp.forEach(function (g) {
          push(label(phrase(g.lv) + " \u00b7 " + g.mods.length));
          push(note((g.lv === "none" ? L("Not in your app at all: ", "V aplikaci v\u016fbec nebude: ") : "") + g.mods.join(", ") + ".", g.lv === "none" ? "muted" : ""));
        });
        push(note(L("This can change later, and you will be told. " + from + " can raise or lower any of it.", "Tohle se m\u016f\u017ee zm\u011bnit a dozv\u00edte se to."), "box"));
        if (off) push(note(L("Joining needs a connection.", "P\u0159ipojen\u00ed vy\u017eaduje signal."), "boxOff"));
        push(acts([btn(L("Join " + hhName, "P\u0159ipojit se k " + hhName), "primary", function () {
          if (preview) return self.docToastShow(L("A preview \u2014 nobody joined. Invite somebody to answer a real one.", "N\u00e1hled \u2014 nikdo se nep\u0159ipojil."));
          var id = "m-" + iv0.id.slice(4), g = {};
          F.modules.forEach(function (x) { g[x[0]] = "none"; }); Object.keys(iv0.grants).forEach(function (k) { g[k] = iv0.grants[k]; });
          var nm = { id: id, name: iv0.name, role: iv0.role, device: "phone", note: "Joined in this session.", grants: g, session: true, locked: iv0.role === "child" };
          var prev = s.member;
          commit(function () { F.members.push(nm); hh.members.push(id); iv0.status = "accepted"; },
            function () { F.members.splice(F.members.indexOf(nm), 1); hh.members.splice(hh.members.indexOf(id), 1); iv0.status = "sent"; self.setState({ member: prev }); },
            L("You joined " + hhName + " \u00b7 " + from + " is told", "P\u0159ipojeno"), { member: id, route: "/home" });
        }, off), btn(L("Decline", "Odm\u00edtnout"), "", function () {
          if (preview) return self.docToastShow(L("A preview \u2014 nothing was declined.", "N\u00e1hled."));
          commit(function () { iv0.status = "declined"; iv0.when = L("today at ", "dnes v ") + now(); }, function () { iv0.status = "sent"; }, L("Declined \u00b7 " + from + " is told", "Odm\u00edtnuto"), { route: base + "/invitations" });
        }, off)]));
        push(note(L("Declining is recorded and " + from + " is told. Nothing is added to your account either way.", "Odm\u00edtnut\u00ed se zaznamen\u00e1.")));
      }
    }

    if (page === "modules") {
      headTitle = L("Modules", "Moduly"); headSub = L("On or off for the whole household", "Zapnuto nebo vypnuto pro celou dom\u00e1cnost");
      push(roNote(false)); push(ownerNote());
      push(note(L("Turning a module off keeps its data. Its screens, widgets and reminders go for everybody; turning it back on restores all of it.",
        "Vypnut\u00ed modulu zachov\u00e1 data. Zmiz\u00ed obrazovky, widgety a p\u0159ipom\u00ednky; op\u011btovn\u00e9 zapnut\u00ed v\u0161e vr\u00e1t\u00ed."), "box"));
      if (off && canW) push(note(L("Offline. A switch saves on this phone and is sent when there is signal.", "Offline. Zm\u011bna se ulo\u017e\u00ed v telefonu."), "boxOff"));
      var hints = {}; ((H.screens.filter(function (x) { return x.id === "C-51"; })[0] || {}).toggles || []).forEach(function (t) { hints[t[0]] = t[2]; });
      push(rows(H.modules.filter(function (x) { return x[0] !== "admin"; }).map(function (x) {
        var k = x[0], isOff = disabled.indexOf(k) >= 0;
        var holders = members.filter(function (mm) { return rawGrant(mm, k) !== "none"; }).length;
        return row({ title: modName(k), sub: (isOff ? L("Off \u00b7 its data is kept", "Vypnuto \u00b7 data z\u016fst\u00e1vaj\u00ed") : holders + L(" of " + members.length + " people hold it", " z " + members.length + " lid\u00ed m\u00e1 p\u0159\u00edstup")) + (hints[x[1]] ? " \u00b7 " + hints[x[1]] : ""),
          right: isOff ? L("Off", "Vyp.") : L("On", "Zap."), tone: isOff ? "muted" : "accent", muted: isOff,
          badge: S.pendingMod === k && off ? L("pending", "\u010dek\u00e1") : "", badgeTone: "offline",
          act: canW ? (isOff ? L("Turn on", "Zapnout") : L("Turn off", "Vypnout")) : "", actTone: isOff ? "" : "danger",
          onAct: isOff ? function () { commit(function () { disabled.splice(disabled.indexOf(k), 1); S.pendingMod = k; }, function () { disabled.push(k); }, modName(k) + L(" is on for everyone \u00b7 everything in it is back", " je zapnuto pro v\u0161echny") + (off ? L(" \u00b7 saved on this phone", " \u00b7 ulo\u017eeno v telefonu") : ""));
            /* a module with a first-open setup goes straight into it; every step there is skippable */
            if (window.HH_OB && window.HH_OB.setupOf(k) && window.HH_OB.stateOf(self, k) !== "done") window.HH_OB.start(self, k, self.state.route); }
            : open({ kind: "modOff", key: k }) });
      })));
      if (window.HH_OB) push(rows([row({ title: L("Set up again", "Nastavit znovu"), sub: L("Chores, Finance, Utilities, Garden and Property each have a setup. Re-running one keeps its answers.", "Pr\u00e1ce, Finance, Energie, Zahrada a Nemovitost maj\u00ed nastaven\u00ed. Znovuspu\u0161t\u011bn\u00ed zachov\u00e1 odpov\u011bdi."), open: go("/settings/modules/setup") })]));
      push(note(L("Sixteen here, seventeen in the grant matrix: Household settings is granted, never turned off.", "\u0160estn\u00e1ct tady, sedmn\u00e1ct v p\u0159\u00edstupech: nastaven\u00ed dom\u00e1cnosti nejde vypnout.")));
    }

    if (page === "storage") {
      var st = H.storage;
      headTitle = L("Storage", "\u00dalo\u017ei\u0161t\u011b"); headSub = hhName;
      push(roNote(false));
      var blocks = H.blocksFor(st.mtdAverage), proj = H.blocksFor(st.projectedAverage);
      push(hero({ kicker: L("Right now", "Pr\u00e1v\u011b te\u010f"), big: st.current + " GB", sub: st.allowance + L(" GB included \u00b7 then whole " + st.block + " GB blocks at " + st.currency + st.price.toFixed(2) + " a month", " GB v cen\u011b \u00b7 pak bloky po " + st.block + " GB za " + st.currency + st.price.toFixed(2)),
        stats: [stat(L("This month so far", "Tento m\u011bs\u00edc"), st.mtdAverage + " GB", L("daily average \u2192 ", "denn\u00ed pr\u016fm\u011br \u2192 ") + blocks + L(" blocks", " bloky")),
          stat(L("Storage this month", "Za \u00falo\u017ei\u0161t\u011b"), st.currency + H.chargeFor(st.mtdAverage).toFixed(2), L("projected ", "odhad ") + st.projectedAverage + " GB \u2192 " + st.currency + H.chargeFor(st.projectedAverage).toFixed(2)),
          stat(L("Derived copies", "Odvozen\u00e9 kopie"), st.derived + " GB", L("previews and thumbnails", "n\u00e1hledy a miniatury"))] }));
      push(label(L("By module", "Podle modulu")));
      push(bars(st.byModule.map(function (x) { return { name: cs ? x[0] : x[0], v: x[1], right: x[1].toFixed(1) + " GB" }; })));
      push(label(L("By who uploaded it", "Podle toho, kdo nahr\u00e1l")));
      push(bars(st.byMember.map(function (x) { return { name: x[0], v: x[1], right: x[1].toFixed(1) + " GB" }; }), "var(--border-strong)"));
      push(label(L("The largest files", "Nejv\u011bt\u0161\u00ed soubory")));
      push(rows(st.largest.map(function (x) { return row({ title: x[0], sub: x[1], right: x[2].toFixed(1) + " GB" }); })));
      push(acts([grants.documents && grants.documents !== "none" ? btn(L("Documents clean-up", "\u00daklid dokument\u016f"), "", go("/documents")) : null,
        grants.chat && grants.chat !== "none" ? btn(L("Chat clean-up", "\u00daklid chatu"), "", go("/chat")) : null]));
      push(note(L("Blocks are worked out from the month\u2019s daily average, so a big upload deleted the same afternoon costs nothing. Derived copies are counted and named here rather than hidden in a file\u2019s size.",
        "Bloky se po\u010d\u00edtaj\u00ed z denn\u00edho pr\u016fm\u011bru za m\u011bs\u00edc.")));
    }

    if (page === "billing") {
      headTitle = L("Billing", "Platby"); headSub = entWord(ent);
      if (!isOwner) push(empty(L("Not available", "Nen\u00ed k dispozici"), L("Billing is not part of your app.", "Platby nejsou sou\u010d\u00e1st\u00ed va\u0161\u00ed aplikace."), "", null));
      else if (off) push(note(L("Billing needs a connection. It is not in the sync feed, so this screen is unavailable offline rather than guessing.", "Platby vy\u017eaduj\u00ed p\u0159ipojen\u00ed."), "boxOff"));
      else {
        push(roNote(true));
        var er = H.entBy[ent] || [];
        var planW = S.plan === "yearly" ? L("\u20ac4.99 a month, billed yearly \u00b7 \u20ac59.88", "\u20ac4.99 m\u011bs\u00ed\u010dn\u011b, ro\u010dn\u011b \u00b7 \u20ac59.88") : L("\u20ac5.99 month to month", "\u20ac5.99 m\u011bs\u00ed\u010dn\u011b");
        var storageCh = H.chargeFor(H.storage.projectedAverage);
        var monthly = (S.plan === "yearly" ? 4.99 : 5.99) + storageCh;
        push(hero({ kicker: L("Subscription", "P\u0159edplatn\u00e9"), big: entWord(ent), tone: ["read_only", "canceled"].indexOf(ent) >= 0 ? "danger" : ["past_due", "grace", "restricted"].indexOf(ent) >= 0 ? "warn" : "",
          sub: er[8] || "", stats: isPayer ? [stat(L("Plan", "Tarif"), S.plan === "yearly" ? L("Yearly", "Ro\u010dn\u011b") : L("Monthly", "M\u011bs\u00ed\u010dn\u011b"), planW),
            stat(L("This month", "Tento m\u011bs\u00edc"), "\u20ac" + monthly.toFixed(2), L("plan + ", "tarif + ") + H.blocksFor(H.storage.projectedAverage) + L(" storage blocks", " bloky \u00falo\u017ei\u0161t\u011b")),
            stat(L("Paid by", "Plat\u00ed"), L("you", "vy"), L("card ending 4417", "karta kon\u010d\u00edc\u00ed 4417"))] : [stat(L("Paid by", "Plat\u00ed"), payer ? payer.name : "\u2013", "")] }));
        if (isPayer) {
          var fix = [];
          if (ent === "trialing") fix.push(btn(L("Subscribe", "P\u0159edplatit"), "primary", go(base + "/billing/subscribe")));
          if (ent === "past_due") fix.push(btn(L("Update the card", "Zm\u011bnit kartu"), "primary", open({ kind: "card", then: "active", err: "", num: "" })));
          if (["grace", "read_only", "canceled"].indexOf(ent) >= 0) fix.push(btn(L("Resume the subscription", "Obnovit p\u0159edplatn\u00e9"), "primary", function () {
            var o = ent; commit(function () {}, function () { self.setState({ ent: o }); }, L("Resumed \u00b7 writing is back and the deletion date is cleared", "Obnoveno \u00b7 z\u00e1pis je zp\u011bt"), { ent: "active" });
          }));
          push(acts(fix));
          push(label(L("What this month is made of", "Z \u010deho se tento m\u011bs\u00edc skl\u00e1d\u00e1")));
          push(rows([row({ title: L("The household", "Dom\u00e1cnost"), sub: planW, right: "\u20ac" + (S.plan === "yearly" ? 4.99 : 5.99).toFixed(2) }),
            row({ title: L("Storage", "\u00dalo\u017ei\u0161t\u011b"), sub: H.storage.projectedAverage + L(" GB projected average \u2192 ", " GB odhad \u2192 ") + H.blocksFor(H.storage.projectedAverage) + L(" blocks of 10 GB", " bloky po 10 GB"), right: "\u20ac" + storageCh.toFixed(2), open: go(base + "/settings/storage") }),
            row({ title: L("Total", "Celkem"), strong: true, right: "\u20ac" + monthly.toFixed(2) })]));
          push(label(L("The plan", "Tarif")));
          push(chips("", [chip(L("Yearly \u00b7 \u20ac59.88", "Ro\u010dn\u011b \u00b7 \u20ac59.88"), S.plan === "yearly", function () { if (S.plan !== "yearly") commit(function () { S.plan = "yearly"; }, function () { S.plan = "monthly"; }, L("Yearly from the next renewal", "Ro\u010dn\u011b od dal\u0161\u00edho obdob\u00ed")); }),
            chip(L("Monthly \u00b7 \u20ac5.99", "M\u011bs\u00ed\u010dn\u011b \u00b7 \u20ac5.99"), S.plan === "monthly", function () { if (S.plan !== "monthly") commit(function () { S.plan = "monthly"; }, function () { S.plan = "yearly"; }, L("Monthly from the next renewal", "M\u011bs\u00ed\u010dn\u011b od dal\u0161\u00edho obdob\u00ed")); })],
            L("A change takes effect at the next renewal. Nothing is charged today.", "Zm\u011bna plat\u00ed od dal\u0161\u00edho obdob\u00ed.")));
          push(label(L("Card", "Karta")));
          push(rows([row({ title: L("Card ending 4417", "Karta kon\u010d\u00edc\u00ed 4417"), sub: L("Stripe \u00b7 the card never touches our servers", "Stripe \u00b7 karta nikdy nejde p\u0159es n\u00e1s"), act: L("Update", "Zm\u011bnit"), onAct: open({ kind: "card", then: "", err: "", num: "" }) })]));
          if (S.offer) push(note(L("You offered billing to " + name(S.offer.to) + " " + S.offer.at + ". You keep paying until they accept.", "Nab\u00eddli jste platby " + name(S.offer.to) + "."), "box", L("Withdraw the offer", "St\u00e1hnout nab\u00eddku"), function () {
            var o = S.offer; commit(function () { S.offer = null; }, function () { S.offer = o; }, L("Offer withdrawn", "Nab\u00eddka sta\u017eena"));
          }));
          push(acts([["canceled", "read_only"].indexOf(ent) < 0 ? btn(L("Cancel the subscription", "Zru\u0161it p\u0159edplatn\u00e9"), "danger-ghost", open({ kind: "cancel" })) : null,
            !S.offer ? btn(L("Hand billing to another owner", "P\u0159edat platby jin\u00e9mu vlastn\u00edkovi"), "", open({ kind: "offer", to: "" })) : null]));
        } else {
          if (S.offer && S.offer.to === me.id) push(note(name(S.offer.from) + L(" has offered you billing.", " v\u00e1m nab\u00eddl(a) platby."), "box", L("See the offer", "Zobrazit nab\u00eddku"), go(base + "/billing/takeover")));
          push(note(L(payer ? payer.name + " pays for the household and sees the invoices. Owners see the state, and can take billing over when " + payer.name + " offers it." : "Nobody pays yet.",
            payer ? payer.name + " plat\u00ed a vid\u00ed faktury." : "Zat\u00edm nikdo neplat\u00ed.")));
        }
        push(note(L("Everything under billing is exempt from the read-only gate on purpose: a subscription you cannot resume because you did not pay is a trap.", "V\u0161e pod platbami funguje i v re\u017eimu jen ke \u010dten\u00ed.")));
      }
    }

    if (page === "subscribe") {
      headTitle = L("Keep " + hhName, "Ponechat " + hhName); headSub = L("One price for the whole household", "Jedna cena pro celou dom\u00e1cnost");
      if (!isOwner) push(empty(L("Not available", "Nen\u00ed k dispozici"), L("Billing is not part of your app.", "Platby nejsou sou\u010d\u00e1st\u00ed va\u0161\u00ed aplikace."), "", null));
      else if (ent === "active") push(empty(L("Already subscribed.", "U\u017e p\u0159edplaceno."), L("Billing shows the plan and this month\u2019s lines.", "Tarif najdete v Platb\u00e1ch."), L("Billing", "Platby"), go(base + "/settings/billing")));
      else {
        var pick = s.hsPlan || "yearly";
        push(chips(L("How often", "Jak \u010dasto"), [chip(L("Yearly \u2014 \u20ac59.88", "Ro\u010dn\u011b \u2014 \u20ac59.88"), pick === "yearly", function () { self.setState({ hsPlan: "yearly" }); }),
          chip(L("Monthly \u2014 \u20ac5.99", "M\u011bs\u00ed\u010dn\u011b \u2014 \u20ac5.99"), pick === "monthly", function () { self.setState({ hsPlan: "monthly" }); })],
          pick === "yearly" ? L("\u20ac4.99 a month, billed once a year.", "\u20ac4.99 m\u011bs\u00ed\u010dn\u011b, jednou ro\u010dn\u011b.") : L("Cancel any month.", "Zru\u0161it jde kter\u00fdkoli m\u011bs\u00edc.")));
        push(note(L("Storage is the only thing that varies. 5 GB is included; above that, whole 10 GB blocks at \u20ac1 a month each, worked out from the month\u2019s daily average \u2014 today that is " + H.blocksFor(H.storage.projectedAverage) + " blocks.",
          "\u00dalo\u017ei\u0161t\u011b je jedin\u00e9, co se m\u011bn\u00ed: 5 GB v cen\u011b, pak bloky po 10 GB za \u20ac1."), "box"));
        push(field({ label: L("Card number", "\u010c\u00edslo karty"), mode: "numeric", value: s.hsCard || "", placeholder: "4242 4242 4242 4242", err: s.hsCardErr || "", set: function (v) { self.setState({ hsCard: v, hsCardErr: "" }); } }));
        if (off) push(note(L("Paying needs a connection.", "Platba vy\u017eaduje p\u0159ipojen\u00ed."), "boxOff"));
        push(acts([btn(pick === "yearly" ? L("Pay yearly \u2014 \u20ac59.88", "Zaplatit ro\u010dn\u011b \u2014 \u20ac59.88") : L("Pay monthly \u2014 \u20ac5.99", "Zaplatit m\u011bs\u00ed\u010dn\u011b \u2014 \u20ac5.99"), "primary", function () {
          var n = String(s.hsCard || "").replace(/\s/g, "");
          if (!/^\d{12,19}$/.test(n)) return self.setState({ hsCardErr: L("The card was not accepted, and it was not charged. Check the number.", "Karta nebyla p\u0159ijata a nic se nestrhlo.") });
          var o = ent; commit(function () { S.plan = pick; }, function () { self.setState({ ent: o }); }, L("Subscribed \u00b7 " + hhName + " is kept", "P\u0159edplaceno"), { ent: "active", hsCard: "", route: base + "/settings/billing" });
        }, off), btn(L("Not yet", "Zat\u00edm ne"), "", go(base + "/settings"))]));
        push(note(L("Card, SEPA, Apple Pay or Google Pay. The card never touches our servers.", "Karta nikdy nejde p\u0159es na\u0161e servery.")));
      }
    }

    if (page === "takeover") {
      headTitle = L("Take over billing", "P\u0159evz\u00edt platby"); headSub = hhName;
      var of = S.offer;
      if (!of || of.to !== me.id) push(empty(L("No offer is waiting for you.", "\u017d\u00e1dn\u00e1 nab\u00eddka na v\u00e1s ne\u010dek\u00e1."), payer ? L(payer.name + " pays for the household.", payer.name + " plat\u00ed za dom\u00e1cnost.") : "", L("Household settings", "Nastaven\u00ed"), go(base + "/settings")));
      else {
        headTitle = L(name(of.from) + " has offered you billing", name(of.from) + " v\u00e1m nab\u00edz\u00ed platby"); headSub = hhName + " \u00b7 " + of.at;
        push(kv([[L("What you would pay", "Co byste platil(a)"), S.plan === "yearly" ? L("\u20ac59.88 a year, next on 1 October", "\u20ac59.88 ro\u010dn\u011b, dal\u0161\u00ed 1. \u0159\u00edjna") : L("\u20ac5.99 a month", "\u20ac5.99 m\u011bs\u00ed\u010dn\u011b")]]));
        push(field({ label: L("Your card", "Va\u0161e karta"), mode: "numeric", value: s.hsCard || "", placeholder: "4242 4242 4242 4242", err: s.hsCardErr || "", set: function (v) { self.setState({ hsCard: v, hsCardErr: "" }); } }));
        push(note(L("Nothing lapses in between. " + name(of.from) + " keeps paying until you accept; if you decline, the subscription carries on exactly as it is and they are told.", "Mezit\u00edm nic nevypr\u0161\u00ed."), "box"));
        push(acts([btn(L("Take over billing", "P\u0159evz\u00edt platby"), "primary", function () {
          var n = String(s.hsCard || "").replace(/\s/g, "");
          if (!/^\d{12,19}$/.test(n)) return self.setState({ hsCardErr: L("The card was not accepted. Billing has not moved and " + name(of.from) + " is still the payer.", "Karta nebyla p\u0159ijata.") });
          var fm = F.members.filter(function (x) { return x.id === of.from; })[0];
          commit(function () { if (fm) fm.billing = false; me.billing = true; S.offer = null; }, function () { if (fm) fm.billing = true; me.billing = false; S.offer = of; },
            L("You pay for " + hhName + " now \u00b7 " + name(of.from) + " is told", "Te\u010f plat\u00edte vy"), { hsCard: "", route: base + "/settings/billing" });
        }, off), btn(L("Decline", "Odm\u00edtnout"), "", function () { commit(function () { S.offer = null; }, function () { S.offer = of; }, L("Declined \u00b7 " + name(of.from) + " keeps paying and is told", "Odm\u00edtnuto"), { route: base + "/settings" }); })]));
      }
    }

    if (page === "data") {
      headTitle = L("Data", "Data"); headSub = L("Export, restrict, hand over, delete \u2014 in that order", "Export, omezen\u00ed, p\u0159ed\u00e1n\u00ed, smaz\u00e1n\u00ed");
      push(roNote(true)); push(ownerNote());
      if (off && isOwner) push(note(L("None of these four is done offline.", "Nic z toho nejde offline."), "boxOff"));
      var dis = !isOwner || off;
      var under = S.under || "active";
      var lift = (H.lift.filter(function (x) { return x[0] === under; })[0] || [])[2] || L("Lift the restriction", "Zru\u0161it omezen\u00ed");
      push(label(L("Export", "Export")));
      push(rows([row({ title: L("Take a copy of everything", "Vz\u00edt si kopii v\u0161eho"), sub: L("A ZIP of every module, files with their real names, and readable versions where a standard exists. Works in every state the household can be in.", "ZIP v\u0161ech modul\u016f a soubor\u016f."), open: go(base + "/exports"), right: S.exp.status === "ready" ? L("ready", "p\u0159ipraveno") : S.exp.status === "packing" ? L("packing", "bal\u00ed se") : "", tone: "accent" })]));
      push(label(L("Restrict", "Omezit")));
      if (ent === "restricted") {
        push(note((S.restrictedBy ? name(S.restrictedBy.by) + L(" restricted this household today at " + S.restrictedBy.at + ".", " omezil(a) dom\u00e1cnost dnes v " + S.restrictedBy.at + ".") : L("This household is restricted.", "Dom\u00e1cnost je omezena.")) + L(" Nothing can be added or changed by anyone until an owner lifts it.", " Nic nejde m\u011bnit, dokud to vlastn\u00edk nezru\u0161\u00ed."), "boxWarn"));
        push(acts([btn(lift, "primary", function () {
          var o = { r: S.restrictedBy, u: S.under };
          commit(function () { S.restrictedBy = null; S.under = null; }, function () { S.restrictedBy = o.r; S.under = o.u; self.setState({ ent: "restricted" }); }, L("Restriction lifted \u00b7 everybody is told", "Omezen\u00ed zru\u0161eno"), { ent: under });
        }, dis)]));
      } else {
        push(rows([row({ title: L("Stop all changes for now", "Zastavit v\u0161echny zm\u011bny"), sub: L("Every write, upload and queued offline change stops for everybody. Reading, downloading, exporting and the subscription carry on. Any owner lifts it.", "V\u0161echny z\u00e1pisy se zastav\u00ed pro v\u0161echny."),
          act: isOwner ? L("Restrict", "Omezit") : "", actTone: "danger", onAct: dis ? function () {} : open({ kind: "restrict" }) })]));
      }
      push(label(L("Transfer", "P\u0159edat")));
      push(rows([row({ title: L("Make somebody else an owner", "Ud\u011blat vlastn\u00edkem n\u011bkoho jin\u00e9ho"), sub: L("Owners: ", "Vlastn\u00edci: ") + owners.map(function (o) { return o.name; }).join(", ") + L(". There can be several, and this does not move billing.", ". M\u016f\u017ee jich b\u00fdt v\u00edc; platby se t\u00edm nep\u0159ed\u00e1vaj\u00ed."),
        act: isOwner && tilcer ? L("Choose", "Vybrat") : "", onAct: dis ? function () {} : open({ kind: "transfer", to: "" }) })]));
      push(label(L("Delete", "Smazat")));
      push(rows([row({ title: L("Delete the household", "Smazat dom\u00e1cnost"), tone: "danger", sub: L("Type the name to confirm. Everybody is told immediately. Thirty days to change your mind, then it is gone.", "Potvr\u010fte n\u00e1zvem. T\u0159icet dn\u00ed na rozmy\u0161lenou."),
        act: isOwner && !S.deletion ? L("Delete", "Smazat") : "", actTone: "danger", onAct: dis ? function () {} : open({ kind: "delete", typed: "", err: "" }) })]));
      push(note(L("The order is the argument: what costs a household nothing comes first, and the irreversible one is last. All four work in read-only, on purpose.", "Po\u0159ad\u00ed je z\u00e1m\u011brn\u00e9: nejd\u0159\u00edv to, co nic nestoj\u00ed, nakonec nevratn\u00e9.")));
    }

    if (page === "exports") {
      headTitle = L("Export the household", "Export dom\u00e1cnosti"); headSub = L("Everything, as files that work without us", "V\u0161e jako soubory, kter\u00e9 funguj\u00ed i bez n\u00e1s");
      push(roNote(true));
      if (!isOwner) push(note(L("An export of the whole household is for an owner. Your own data is in the privacy centre.", "Export cel\u00e9 dom\u00e1cnosti je pro vlastn\u00edka."), "box", L("Your data", "Va\u0161e data"), go("/account/privacy")));
      var E = S.exp;
      if (E.status === "none") {
        push(empty(L("No export yet.", "Zat\u00edm \u017e\u00e1dn\u00fd export."), L("It takes about twenty minutes. You can close the app \u2014 we email you when it is ready, and it stays downloadable for seven days.", "Trv\u00e1 asi dvacet minut. P\u0159ijde e-mail."),
          isOwner && !off ? L("Start the export", "Spustit export") : "", function () {
            commit(function () { S.exp = { status: "packing", at: now(), by: me.id }; }, null, L("Packing \u00b7 we email you when it is ready", "Bal\u00ed se \u00b7 p\u0159ijde e-mail"));
            setTimeout(function () { if (S.exp.status === "packing") { S.exp.status = "ready"; S.exp.done = now(); bump(); } }, 4000);
          }));
        if (off) push(note(L("Starting an export needs a connection.", "Spu\u0161t\u011bn\u00ed exportu vy\u017eaduje p\u0159ipojen\u00ed."), "boxOff"));
      } else if (E.status === "packing") {
        push(hero({ kicker: L("Started " + E.at + " by " + name(E.by), "Spu\u0161t\u011bno " + E.at), big: L("Packing", "Bal\u00ed se"), sub: L("About 20 minutes left. You can close the app.", "Zb\u00fdv\u00e1 asi 20 minut.") }));
      } else {
        push(hero({ kicker: L("Ready " + (E.done || E.at) + " \u00b7 available for 7 days", "P\u0159ipraveno " + (E.done || E.at)), big: "1.6 GB", sub: L("One ZIP", "Jeden ZIP") }));
        push(acts([btn(L("Download the ZIP \u00b7 1.6 GB", "St\u00e1hnout ZIP \u00b7 1.6 GB"), "primary", function () { self.docToastShow(L("Downloading tilcerovi-export.zip", "Stahuje se tilcerovi-export.zip")); }, off),
          isOwner ? btn(L("Start another export", "Spustit dal\u0161\u00ed export"), "", function () { var o = S.exp; commit(function () { S.exp = { status: "none" }; }, function () { S.exp = o; }, ""); }) : null]));
      }
      push(label(L("What is in it", "Co v n\u011bm je")));
      push(rows([["calendar.ics", L("opens in any calendar", "otev\u0159e se v kalend\u00e1\u0159i")], ["finance-transactions.csv \u00b7 utilities-readings.csv", L("open in a spreadsheet", "otev\u0159ou se v tabulce")],
        ["notes/*.md", L("your notes as Markdown", "pozn\u00e1mky jako Markdown")], ["files/", L("documents and photos with their real names", "dokumenty a fotky s p\u016fvodn\u00edmi n\u00e1zvy")], ["data/*.json", L("every module, complete", "v\u0161echny moduly, kompletn\u011b")]].map(function (x) {
        return row({ title: x[0], sub: x[1] });
      })));
      push(note(L("Works in every state except suspended, which is not a billing state.", "Funguje ve v\u0161ech stavech krom\u011b pozastaven\u00ed.")));
    }

    if (page === "leave") {
      headTitle = L("Leave " + hhName, "Opustit " + hhName); headSub = "";
      var blockers = [];
      var myRole = nav.role;
      if (myRole === "owner" && owners.length < 2 && members.length > 1) blockers.push(H.leave[0]);
      if (me.billing) blockers.push(H.leave[1]);
      if (blockers.length) push(note(blockers.length === 2 ? L("Two things have to be settled first, and here they both are.", "Nejd\u0159\u00edv je t\u0159eba vy\u0159e\u0161it dv\u011b v\u011bci.") : L("One thing has to be settled first.", "Nejd\u0159\u00edv je t\u0159eba vy\u0159e\u0161it jednu v\u011bc."), "box"));
      blockers.forEach(function (b) {
        push(label(b[1]));
        push(note(b[3].replace(/Tilcerovi/g, hhName).replace("Four other people", (members.length - 1) + L(" other people", " dal\u0161\u00edch lid\u00ed")), "boxDanger",
          b[0] === "last_owner" ? L("Make someone an owner", "Ud\u011blat n\u011bkoho vlastn\u00edkem") : L("Hand billing over", "P\u0159edat platby"),
          b[0] === "last_owner" ? go(base + "/settings/data") : go(base + "/settings/billing")));
      });
      push(label(H.leave[2][1]));
      push(note(H.leave[2][3], "box"));
      if (off) push(note(L("Leaving needs a connection.", "Odchod vy\u017eaduje p\u0159ipojen\u00ed."), "boxOff"));
      push(acts([btn(L("Leave " + hhName, "Opustit " + hhName), "danger", open({ kind: "leave" }), blockers.length > 0 || off)]));
      if (blockers.length) push(note(L("Both refusals are shown at once, each naming what unblocks it.", "Ob\u011b p\u0159ek\u00e1\u017eky najednou, ka\u017ed\u00e1 s cestou ven.")));
    }

    if (page === "sync") {
      headTitle = L("Sync health", "Stav synchronizace"); headSub = S.devices.length + L(" devices, and what each has actually got", " za\u0159\u00edzen\u00ed a co kter\u00e9 opravdu m\u00e1");
      push(offNote(L("Offline \u2014 this device only. Your own cursor and queue are read from this phone; the other rows are as of the last time it was online.", "Offline \u2014 jen toto za\u0159\u00edzen\u00ed.")));
      push(rows(S.devices.map(function (dv, i) {
        var t = dv.tone;
        return row({ title: dv.name, sub: dv.meta, subTone: t === "conflict" || t === "digest" ? "warn" : "",
          badge: t === "ok" ? L("synced", "synchronizov\u00e1no") : t === "pending" ? L("queued", "ve front\u011b") : t === "conflict" ? L("conflict", "konflikt") : t === "digest" ? L("disagrees", "nesouhlas\u00ed") : t === "resnap" ? L("re-snapshot", "obnova") : "",
          badgeTone: t === "ok" ? "accent" : t === "pending" || t === "resnap" ? "offline" : "warn",
          act: t === "conflict" ? L("Open the conflict", "Otev\u0159\u00edt konflikt") : t === "digest" && !off ? L("Force a re-snapshot", "Vynutit obnovu") : "",
          onAct: t === "conflict" ? go("/sync") : function () {
            var o = clone(dv);
            commit(function () { dv.tone = "resnap"; dv.meta = L("Re-snapshot running for utilities.reading \u00b7 started " + now(), "Obnova b\u011b\u017e\u00ed"); }, null, L("Re-snapshot started \u00b7 nothing on the device is lost", "Obnova spu\u0161t\u011bna"));
            setTimeout(function () { if (dv.tone === "resnap") { dv.tone = "ok"; dv.meta = L("Synced " + now() + " \u00b7 seq 184 402 \u00b7 re-snapshot finished \u00b7 digest agreed", "Synchronizov\u00e1no " + now()); bump(); } }, 3000);
            void o; void i;
          } });
      })));
      push(acts([btn(L("Send a diagnostic bundle", "Poslat diagnostiku"), "", go("/support/diagnostics"))]));
      push(note(L("Nobody at the platform can look at a household\u2019s data, so this is the only view anyone gets of a sync failure. The digest row matters: a device that disagreed with the server about one entity type, named, with the one action that fixes it.",
        "Nikdo na platform\u011b data dom\u00e1cnosti nevid\u00ed, tohle je jedin\u00fd pohled na chyby synchronizace.")));
    }

    if (page === "advanced") {
      headTitle = L("Clients and versions", "Klienti a verze"); headSub = L("When one person sees something the others do not", "Kdy\u017e jeden vid\u00ed n\u011bco, co ostatn\u00ed ne");
      var dev = (H.screens.filter(function (x) { return x.id === "C-57"; })[0] || {}).devices || [];
      push(rows(dev.map(function (dv) { return row({ title: dv.name, sub: dv.meta, badge: dv.tone === "pending" ? L("behind", "star\u0161\u00ed") : "", badgeTone: "warn" }); })));
      push(note(L("A client two versions behind is a fact, not a warning. The update wall is a different screen and a different threshold.", "Klient o dv\u011b verze pozadu je fakt, ne varov\u00e1n\u00ed.")));
      push(acts([btn(L("Sync health", "Stav synchronizace"), "", go(base + "/settings/sync"))]));
    }

    if (page === "bundle") {
      headTitle = L("This is what would be sent", "Tohle by se odeslalo"); headSub = L("Nothing leaves until you press send", "Nic neode\u0161le, dokud nestisknete Odeslat");
      if (S.sent) push(note(L("Sent " + S.sent.at + " \u00b7 reference " + S.sent.ref + " \u00b7 expires in 30 days.", "Odesl\u00e1no " + S.sent.at + " \u00b7 " + S.sent.ref), "box"));
      push(rows(H.bundle.map(function (b, i) {
        var out = !b[2] || S.bundleOff[i];
        return row({ title: b[0], sub: b[1], muted: out, right: out ? L("not sent", "neode\u0161le se") : "", tone: "muted",
          act: b[3] ? (S.bundleOff[i] ? L("Put back", "Vr\u00e1tit") : L("Take out", "Vyjmout")) : "", actTone: S.bundleOff[i] ? "" : "danger",
          onAct: function () { S.bundleOff[i] = !S.bundleOff[i]; bump(); } });
      })));
      if (off) push(note(L("Sending needs a connection. The bundle is built when you press send, not before.", "Odesl\u00e1n\u00ed vy\u017eaduje p\u0159ipojen\u00ed."), "boxOff"));
      push(acts([btn(L("Send this to support", "Poslat na podporu"), "primary", function () {
        var ref = "D-" + (4000 + Math.floor(Math.random() * 999)) + "-" + now().replace(":", "");
        commit(function () { S.sent = { ref: ref, at: now() }; }, null, L("Sent \u00b7 reference " + ref, "Odesl\u00e1no \u00b7 " + ref), { route: base + "/settings/sync" });
      }, off), btn(L("Cancel", "Zru\u0161it"), "", go(base + "/settings/sync"))]));
      push(note(L("It expires in 30 days. Files and attachments are never in a bundle.", "Vypr\u0161\u00ed za 30 dn\u00ed. Soubory nejsou nikdy sou\u010d\u00e1st\u00ed.")));
    }

    /* ═══ sheets ═══ */
    function sheetBody(d) {
      var out = { title: "", sub: "", blocks: [], foot: [], footNote: "" }, B = out.blocks;
      var cancel = btn(L("Cancel", "Zru\u0161it"), "", closeSheet);
      var mem = d.id ? F.members.filter(function (x) { return x.id === d.id; })[0] : null;

      if (d.kind === "profile") {
        out.title = L("Edit the household", "Upravit dom\u00e1cnost");
        B.push(field({ label: L("Name", "N\u00e1zev"), value: d.name, err: d.err, set: function (v) { patch({ name: v, err: "" }); } }));
        B.push(chips(L("Time zone", "\u010casov\u00e9 p\u00e1smo"), ["Europe/Prague", "Europe/Berlin", "Europe/London"].map(function (z) { return chip(z, d.tz === z, function () { patch({ tz: z }); }); })));
        B.push(chips(L("Language", "Jazyk"), ["\u010ce\u0161tina", "English", "Deutsch"].map(function (z) { return chip(z, d.lang === z, function () { patch({ lang: z }); }); }), L("What the household\u2019s shared words are in. Everybody\u2019s own app language is theirs.", "Jazyk spole\u010dn\u00fdch text\u016f dom\u00e1cnosti.")));
        B.push(chips(L("Units", "Jednotky"), [["Metric", L("Metric", "Metrick\u00e9")], ["Imperial", L("Imperial", "Imperi\u00e1ln\u00ed")]].map(function (z) { return chip(z[1], d.units === z[0], function () { patch({ units: z[0] }); }); })));
        B.push(chips(L("The household\u2019s week starts on", "T\u00fdden dom\u00e1cnosti za\u010d\u00edn\u00e1"), [["monday", L("Monday", "Pond\u011bl\u00ed")], ["sunday", L("Sunday", "Ned\u011ble")], ["saturday", L("Saturday", "Sobota")]].map(function (z) { return chip(z[1], d.firstDay === z[0], function () { patch({ firstDay: z[0] }); }); })));
        if (off) B.push(note(L("Saved on this phone and sent when there is signal. If somebody changes the same thing meanwhile, you are asked which one stands.", "Ulo\u017e\u00ed se v telefonu."), "offline"));
        out.foot = [cancel, btn(L("Save", "Ulo\u017eit"), "primary", function () {
          var nm = String(d.name || "").trim();
          if (!nm) return patch({ err: L("A household needs a name.", "Dom\u00e1cnost pot\u0159ebuje n\u00e1zev.") });
          if (nm.length > 40) return patch({ err: L("Forty characters at most \u2014 it has to fit a tab bar.", "Nejv\u00fd\u0161 40 znak\u016f.") });
          var o = { name: hh.name, tz: hh.tz, firstDay: hh.firstDay, lang: S.lang, units: S.units };
          commit(function () { hh.name = nm; hh.tz = d.tz; hh.firstDay = d.firstDay; S.lang = d.lang; S.units = d.units; S.profilePending = off; },
            function () { hh.name = o.name; hh.tz = o.tz; hh.firstDay = o.firstDay; S.lang = o.lang; S.units = o.units; S.profilePending = false; },
            L("Saved for everyone", "Ulo\u017eeno pro v\u0161echny") + (off ? L(" \u00b7 on this phone until there is signal", " \u00b7 v telefonu do p\u0159ipojen\u00ed") : ""));
        })];
      }

      if (d.kind === "currency") {
        out.title = L("Count new money in " + d.to + "?", "Po\u010d\u00edtat nov\u00e9 \u010d\u00e1stky v " + d.to + "?");
        out.sub = L("This is what would change first.", "Tohle by se zm\u011bnilo.");
        B.push(chips(L("Currency", "M\u011bna"), ["CZK", "EUR"].filter(function (c) { return c !== hh.currency; }).map(function (c) { return chip(c, d.to === c, function () { patch({ to: c }); }); })));
        B.push(rows([row({ title: L("Nothing already recorded is converted", "Nic zapsan\u00e9ho se nep\u0159epo\u010d\u00edt\u00e1"), sub: L("Every expense, reading, price and service keeps the currency it was entered in.", "Ka\u017ed\u00e1 \u010d\u00e1stka si nech\u00e1 svou m\u011bnu.") }),
          row({ title: L("New amounts default to " + d.to, "Nov\u00e9 \u010d\u00e1stky v " + d.to), sub: L("Finance, Utilities, Property and Shopping", "Finance, Energie, D\u016fm a N\u00e1kupy") }),
          row({ title: L("Tariffs stay as they are", "Tarify z\u016fst\u00e1vaj\u00ed"), sub: L("A tariff is priced in what the supplier bills in. Change those in Utilities.", "Tarif je v m\u011bn\u011b dodavatele.") }),
          row({ title: L("The subscription is not affected", "P\u0159edplatn\u00e9 se nem\u011bn\u00ed"), sub: L("It is billed in EUR everywhere.", "Plat\u00ed se v EUR.") })]));
        out.foot = [cancel, btn(L("Count new money in " + d.to, "Po\u010d\u00edtat v " + d.to), "primary", function () {
          var o = hh.currency; commit(function () { hh.currency = d.to; }, function () { hh.currency = o; }, L("New amounts are in " + d.to + " \u00b7 nothing was converted", "Nov\u00e9 \u010d\u00e1stky v " + d.to));
        }, off)];
        if (off) out.footNote = L("Changing the currency needs a connection.", "Vy\u017eaduje p\u0159ipojen\u00ed.");
      }

      if (d.kind === "code") {
        out.title = L("Make a new household code?", "Vytvo\u0159it nov\u00fd k\u00f3d?");
        B.push(note(L(S.code + " stops working for new sign-ins. Phones already signed in stay signed in \u2014 existing sessions are untouched.", S.code + " p\u0159estane platit pro nov\u00e1 p\u0159ihl\u00e1\u0161en\u00ed."), "box"));
        out.foot = [cancel, btn(L("Make a new code", "Vytvo\u0159it nov\u00fd k\u00f3d"), "danger", function () {
          var o = S.code, n = newCode(); commit(function () { S.code = n; }, function () { S.code = o; }, L("New code " + n + " \u00b7 " + o + " no longer works", "Nov\u00fd k\u00f3d " + n));
        })];
      }

      if (d.kind === "grant" && mem) {
        var role = roleOf(mem.id), cap = capFor(role, d.key);
        out.title = modName(d.key) + L(" for " + mem.name, " pro " + mem.name);
        out.sub = L("Now: ", "Te\u010f: ") + phrase(d.was || rawGrant(mem, d.key));
        B.push(rows(H.levels.map(function (l) {
          var allowed = LV.indexOf(l[0]) <= LV.indexOf(cap);
          return row({ title: phrase(l[0]), sub: allowed ? (cs ? "" : l[2]) : L("Not for a child profile", "Ne pro d\u011btsk\u00fd profil"), muted: !allowed, on: d.level === l[0], noChev: true,
            open: allowed ? function () { patch({ level: l[0], was: d.was || rawGrant(mem, d.key) }); } : null });
        })));
        var was = d.was || rawGrant(mem, d.key);
        if (LV.indexOf(d.level) < LV.indexOf(was)) B.push(note(d.level === "none" ? L(modName(d.key) + " leaves " + mem.name + "\u2019s app entirely, and their phone drops its copy. Nothing they added is deleted.", modName(d.key) + " zmiz\u00ed z aplikace.") : L(mem.name + " is told, at the moment it happens.", mem.name + " se to dozv\u00ed hned."), "boxWarn"));
        out.foot = [cancel, btn(L("Save", "Ulo\u017eit"), "primary", function () {
          if (d.level === was) return closeSheet();
          var down = LV.indexOf(d.level) < LV.indexOf(was);
          commit(function () { mem.grants[d.key] = d.level; }, function () { mem.grants[d.key] = was; },
            modName(d.key) + ": " + phrase(d.level).toLowerCase() + (down ? L(" \u00b7 " + mem.name + " is told", " \u00b7 " + mem.name + " se to dozv\u00ed") : ""));
        }, off)];
      }

      if (d.kind === "invGrant") {
        var dd = s.hsInvite || { role: "member", grants: defaultsFor("member") };
        var cap2 = capFor(dd.role, d.key);
        out.title = modName(d.key);
        B.push(rows(H.levels.map(function (l) {
          var allowed = LV.indexOf(l[0]) <= LV.indexOf(cap2);
          return row({ title: phrase(l[0]), sub: allowed ? (cs ? "" : l[2]) : L("Not for a child profile", "Ne pro d\u011btsk\u00fd profil"), muted: !allowed, on: d.level === l[0], noChev: true,
            open: allowed ? function () { var g = Object.assign({}, dd.grants); g[d.key] = l[0]; self.setState({ hsInvite: Object.assign({}, dd, { grants: g }), hsSheet: null }); } : null });
        })));
        out.foot = [btn(L("Close", "Zav\u0159\u00edt"), "", closeSheet)];
      }

      if (d.kind === "invite") {
        var iv = S.invites.filter(function (x) { return x.id === d.id; })[0]; if (!iv) return null;
        out.title = iv.name; out.sub = roleW(iv.role) + " \u00b7 " + iv.when;
        B.push(kv([[L("Sent to", "Komu"), iv.email || L("a link \u00b7 " + iv.code, "odkaz \u00b7 " + iv.code)], [L("From", "Od"), name(iv.by)], [L("What they get", "Co dostanou"), countLine(iv.grants)],
          [L("Status", "Stav"), { sent: L("Waiting \u00b7 expires in 14 days", "\u010cek\u00e1 \u00b7 plat\u00ed 14 dn\u00ed"), draft: L("Saved, not sent", "Ulo\u017eeno, neodesl\u00e1no"), declined: L("Declined", "Odm\u00edtnuto"), revoked: L("Withdrawn", "Sta\u017eeno"), accepted: L("Joined", "P\u0159ipojen") }[iv.status]]]));
        var reinvite = function () { self.setState({ hsSheet: null, hsInvite: { name: iv.name, email: iv.email, how: iv.email ? "email" : "link", role: iv.role, grants: clone(iv.grants), err: "" } }); self.go(base + "/invitations/new"); };
        out.foot = [
          iv.status === "sent" ? btn(L("Answer as " + iv.name, "Odpov\u011bd\u011bt jako " + iv.name), "", go("/invitations/" + iv.code)) : null,
          iv.status === "draft" && isOwner ? btn(L("Send it now", "Odeslat"), "primary", function () { commit(function () { iv.status = "sent"; iv.when = L("today at ", "dnes v ") + now(); }, function () { iv.status = "draft"; }, L("Sent to " + (iv.email || iv.name), "Odesl\u00e1no")); }, off || ro) : null,
          (iv.status === "sent" || iv.status === "draft") && isOwner ? btn(L("Withdraw", "St\u00e1hnout"), "danger-ghost", function () { var o = iv.status; commit(function () { iv.status = "revoked"; }, function () { iv.status = o; }, L("Withdrawn \u00b7 the link no longer works", "Sta\u017eeno")); }, off) : null,
          (iv.status === "declined" || iv.status === "revoked") && isOwner ? btn(L("Invite " + iv.name + " again", "Pozvat znovu"), "primary", reinvite, ro) : null,
          btn(L("Close", "Zav\u0159\u00edt"), "", closeSheet)].filter(Boolean);
      }

      if (d.kind === "owner" && mem) {
        out.title = L("Make " + mem.name + " an owner?", "Ud\u011blat z " + mem.name + " vlastn\u00edka?");
        B.push(note(L("Owners invite, remove, re-grant, enable modules and delete the household. There can be several, and this does not move billing.", "Vlastn\u00edci zvou, odeb\u00edraj\u00ed, m\u011bn\u00ed p\u0159\u00edstupy a mohou smazat dom\u00e1cnost. Platby se nep\u0159ed\u00e1vaj\u00ed."), "box"));
        out.foot = [cancel, btn(L("Make " + mem.name + " an owner", "Ud\u011blat z " + mem.name + " vlastn\u00edka"), "primary", function () {
          var o = { role: mem.role, grants: clone(mem.grants) };
          commit(function () { mem.role = "owner"; Object.keys(mem.grants).forEach(function (k) { mem.grants[k] = "manage"; }); }, function () { mem.role = o.role; mem.grants = o.grants; }, mem.name + L(" is an owner \u00b7 they are told", " je vlastn\u00edk"));
        }, off)];
      }

      if (d.kind === "transfer") {
        out.title = L("Make somebody an owner", "Ud\u011blat n\u011bkoho vlastn\u00edkem");
        var cands = members.filter(function (x) { return roleOf(x.id) === "member"; });
        if (!cands.length) B.push(note(L("Everybody who could be an owner already is. A child profile can\u2019t be one.", "Kdo m\u016f\u017ee b\u00fdt vlastn\u00edkem, u\u017e je."), "box"));
        else B.push(chips(L("Who", "Kdo"), cands.map(function (x) { return chip(x.name, d.to === x.id, function () { patch({ to: x.id }); }); })));
        B.push(note(L("There can be several owners, and this does not move billing \u2014 that is its own two-step hand-off.", "Vlastn\u00edk\u016f m\u016f\u017ee b\u00fdt v\u00edc; platby se p\u0159ed\u00e1vaj\u00ed zvl\u00e1\u0161\u0165.")));
        var tm = F.members.filter(function (x) { return x.id === d.to; })[0];
        out.foot = [cancel, btn(tm ? L("Make " + tm.name + " an owner", "Ud\u011blat z " + tm.name + " vlastn\u00edka") : L("Choose somebody", "Vyberte"), "primary", function () {
          if (!tm) return;
          var o = { role: tm.role, grants: clone(tm.grants) };
          commit(function () { tm.role = "owner"; Object.keys(tm.grants).forEach(function (k) { tm.grants[k] = "manage"; }); }, function () { tm.role = o.role; tm.grants = o.grants; }, tm.name + L(" is an owner \u00b7 they are told", " je vlastn\u00edk"));
        }, !tm || off)];
      }

      if (d.kind === "remove" && mem) {
        out.title = L("Remove " + mem.name + " from " + hhName + "?", "Odebrat " + mem.name + " z " + hhName + "?");
        B.push(note(L("What " + mem.name + " added stays \u2014 it is the household\u2019s record, with their name on it. Their private notes and documents are deleted after thirty days, and they can export them until then. They are told.",
          "Co " + mem.name + " p\u0159idal(a), z\u016fst\u00e1v\u00e1. Soukrom\u00e9 pozn\u00e1mky se sma\u017eou po 30 dnech."), "boxDanger"));
        out.foot = [cancel, btn(L("Remove " + mem.name + " from " + hhName, "Odebrat " + mem.name + " z " + hhName), "danger", function () {
          commit(function () { mem.removed = true; }, function () { mem.removed = false; }, mem.name + L(" was removed \u00b7 they are told", " byl(a) odebr\u00e1n(a)"), { route: base + "/settings/members" });
        }, off)];
      }

      if (d.kind === "modOff") {
        var holders = members.filter(function (mm) { return rawGrant(mm, d.key) !== "none"; });
        out.title = L("Turn " + modName(d.key) + " off for everyone?", "Vypnout " + modName(d.key) + " pro v\u0161echny?");
        B.push(note(L("Its screens, widgets and reminders go for " + (holders.length === 1 ? "the one person" : "all " + holders.length + " people") + " who hold it. Nothing is deleted: everything in it stays exactly where it is and comes back if " + modName(d.key) + " is turned on again.",
          "Zmiz\u00ed obrazovky, widgety i p\u0159ipom\u00ednky. Nic se nesma\u017ee a po zapnut\u00ed se v\u0161e vr\u00e1t\u00ed."), "box"));
        if (holders.length) B.push(note(holders.map(function (x) { return x.name; }).join(", ")));
        out.foot = [cancel, btn(L("Turn " + modName(d.key) + " off for everyone", "Vypnout " + modName(d.key) + " pro v\u0161echny"), "danger", function () {
          commit(function () { disabled.push(d.key); S.pendingMod = d.key; }, function () { disabled.splice(disabled.indexOf(d.key), 1); },
            modName(d.key) + L(" is off \u00b7 its data is kept", " je vypnuto \u00b7 data z\u016fst\u00e1vaj\u00ed") + (off ? L(" \u00b7 saved on this phone", " \u00b7 v telefonu") : ""));
        })];
      }

      if (d.kind === "cancel") {
        out.title = L("Cancel the subscription?", "Zru\u0161it p\u0159edplatn\u00e9?");
        B.push(note(L("Everything stays readable and exportable. Nothing new can be added. Data is kept until " + H.deletionDate + ", and resuming at any point before then brings writing back and clears the date.",
          "V\u0161e z\u016fstane \u010diteln\u00e9 a exportovateln\u00e9. Data se dr\u017e\u00ed do " + H.deletionDate + "."), "boxDanger"));
        out.foot = [btn(L("Keep it", "Ponechat"), "", closeSheet), btn(L("Cancel the subscription for " + hhName, "Zru\u0161it p\u0159edplatn\u00e9 " + hhName), "danger", function () {
          var o = ent; commit(function () {}, function () { self.setState({ ent: o }); }, L("Cancelled \u00b7 everything is still here to read and export", "Zru\u0161eno"), { ent: "canceled" });
        })];
      }

      if (d.kind === "card") {
        out.title = L("Update the card", "Zm\u011bnit kartu");
        B.push(field({ label: L("Card number", "\u010c\u00edslo karty"), mode: "numeric", value: d.num, placeholder: "4242 4242 4242 4242", err: d.err, set: function (v) { patch({ num: v, err: "" }); } }));
        if (d.then) B.push(note(L("The outstanding payment is retried as soon as the card is saved.", "Dlu\u017en\u00e1 platba se zkus\u00ed znovu hned."), "box"));
        out.foot = [cancel, btn(L("Save the card", "Ulo\u017eit kartu"), "primary", function () {
          var n = String(d.num || "").replace(/\s/g, "");
          if (!/^\d{12,19}$/.test(n)) return patch({ err: L("The card was not accepted, and it was not charged.", "Karta nebyla p\u0159ijata.") });
          var o = ent; commit(function () {}, d.then ? function () { self.setState({ ent: o }); } : null, d.then ? L("Card saved \u00b7 the payment went through", "Karta ulo\u017eena \u00b7 platba pro\u0161la") : L("Card saved", "Karta ulo\u017eena"), d.then ? { ent: d.then } : {});
        })];
      }

      if (d.kind === "offer") {
        out.title = L("Hand billing to another owner", "P\u0159edat platby");
        var others = owners.filter(function (x) { return x.id !== me.id; });
        if (!others.length) B.push(note(L("Nobody else is an owner. Make somebody an owner first \u2014 billing only moves between owners.", "Nikdo jin\u00fd nen\u00ed vlastn\u00edk."), "box", L("Make someone an owner", "Ud\u011blat n\u011bkoho vlastn\u00edkem"), go(base + "/settings/data")));
        else B.push(chips(L("To", "Komu"), others.map(function (x) { return chip(x.name, d.to === x.id, function () { patch({ to: x.id }); }); })));
        B.push(note(L("Two steps: you offer, they accept and add a card. You keep paying until then, so nothing lapses in between.", "Dva kroky: nab\u00eddnete, druh\u00fd p\u0159ijme a zad\u00e1 kartu.")));
        out.foot = [cancel, btn(L("Offer billing", "Nab\u00eddnout platby") + (d.to ? " \u2014 " + name(d.to) : ""), "primary", function () {
          commit(function () { S.offer = { from: me.id, to: d.to, at: L("today at ", "dnes v ") + now() }; }, function () { S.offer = null; }, L("Offered to " + name(d.to) + " \u00b7 they are told", "Nab\u00eddnuto " + name(d.to)));
        }, !d.to)];
      }

      if (d.kind === "restrict") {
        out.title = L("Restrict " + hhName + "?", "Omezit " + hhName + "?");
        B.push(note(L("Every write, every upload and every queued offline change stops, for everybody. Reading, downloading, exporting and the subscription carry on. Any owner lifts it at any time.",
          "Zastav\u00ed se v\u0161echny z\u00e1pisy pro v\u0161echny. \u010cten\u00ed, export a p\u0159edplatn\u00e9 pokra\u010duj\u00ed."), "boxWarn"));
        out.foot = [cancel, btn(L("Restrict " + hhName + " \u2014 nobody can write until it is lifted", "Omezit " + hhName), "danger", function () {
          var o = ent, at = now();
          commit(function () {
            S.under = o; S.restrictedBy = { by: me.id, at: at };
            var b = (H.banners || []).filter(function (x) { return x.key === "restricted"; })[0];
            if (b) b.title = L(me.name + " restricted this household today at " + at, me.name + " omezil(a) dom\u00e1cnost dnes v " + at);
          }, function () { S.under = null; S.restrictedBy = null; self.setState({ ent: o }); }, L("Restricted \u00b7 everybody is told", "Omezeno \u00b7 v\u0161ichni se to dozv\u011bd\u00ed"), { ent: "restricted" });
        })];
      }

      if (d.kind === "delete") {
        out.title = L("Delete " + hhName + "?", "Smazat " + hhName + "?");
        B.push(note(H.destructive[0][3].replace(/Tilcerovi/g, hhName).replace("all five", "all " + members.length), "boxDanger"));
        B.push(field({ label: L("Type " + hhName + " to confirm", "Pro potvrzen\u00ed napi\u0161te " + hhName), value: d.typed, err: d.err, set: function (v) { patch({ typed: v, err: "" }); } }));
        var ok = String(d.typed || "").trim() === hhName;
        out.foot = [cancel, btn(L("Delete " + hhName + " and everything in it", "Smazat " + hhName + " i s obsahem"), "danger", function () {
          if (!ok) return patch({ err: L("The name doesn\u2019t match.", "N\u00e1zev nesouhlas\u00ed.") });
          commit(function () { S.deletion = { by: me.id, at: now(), until: L("9 October", "9. \u0159\u00edjna") }; }, function () { S.deletion = null; }, L("Deletion scheduled for 9 October \u00b7 everybody is told", "Smaz\u00e1n\u00ed napl\u00e1nov\u00e1no"));
        }, !ok || off)];
      }

      if (d.kind === "leave") {
        out.title = L("Leave " + hhName + "?", "Opustit " + hhName + "?");
        B.push(note(H.leave[2][3], "box"));
        out.foot = [cancel, btn(L("Leave " + hhName, "Opustit " + hhName), "danger", function () {
          var others = members.filter(function (x) { return x.id !== me.id; });
          commit(function () { me.removed = true; }, function () { me.removed = false; self.setState({ member: me.id }); },
            L("You left " + hhName, "Opustili jste " + hhName), { route: "/home", member: others.length ? others[0].id : me.id });
        }, off)];
      }
      return out;
    }

    /* ── assemble ── */
    var footBar = function (bg) {
      return "position:sticky;bottom:0;margin-top:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--border);background:" + bg;
    };
    var panes = [];
    var navKey = { home: "home", members: "members", member: "members", compose: "members", invites: "members", modules: "modules", storage: "storage", billing: "billing", subscribe: "billing", takeover: "billing", data: "data", exports: "data", sync: "sync", bundle: "sync", advanced: "advanced" }[page] || "";
    if (wide && lvl !== "none") {
      panes.push({ key: "nav", role: "navigation", title: L("Household settings", "Nastaven\u00ed dom\u00e1cnosti"),
        outer: "flex:0 0 " + (web ? "300px" : "36%") + ";min-width:0;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--border);background:var(--surface)",
        inner: "flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column", col: "display:flex;flex-direction:column;padding-bottom:24px",
        onOuter: function () {}, hasHead: false, sub: "", hasFoot: false, foot: [], footNote: "", footStyle: "",
        blocks: [label(hhName), rows(sectionRows(navKey)), label(L("You", "Vy")), rows([row({ title: L("Leave " + hhName, "Opustit " + hhName), on: page === "leave", noChev: true, open: go(base + "/leave") })])] });
    }
    panes.push({ key: "main", role: "region", title: headTitle,
      outer: "flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--surface)",
      inner: "flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column",
      col: "display:flex;flex-direction:column;flex:1 0 auto;width:100%;max-width:" + (wide ? "780px" : "none") + ";padding-bottom:32px",
      onOuter: function () {}, hasHead: false, sub: "", blocks: P.filter(Boolean), hasFoot: false, foot: [], footNote: "", footStyle: "" });

    if (sheetD) {
      var sh = safe(function () { return sheetBody(sheetD); }, null);
      if (sh) panes.push({ key: "sheet", role: "dialog", title: sh.title,
        outer: "position:absolute;inset:0;z-index:20;background:rgba(12,14,20,0.5);display:flex;justify-content:center;align-items:" + (web ? "center" : "flex-end"),
        onOuter: function (ev) { if (ev.target === ev.currentTarget) closeSheet(); },
        inner: "width:100%;max-width:560px;max-height:" + (web ? "88%" : "92%") + ";overflow-y:auto;display:flex;flex-direction:column;background:var(--surface-overlay);box-shadow:var(--shadow-2);border-radius:" + (web ? "14px" : "16px 16px 0 0"),
        col: "display:flex;flex-direction:column;flex:1 0 auto;padding-top:4px", hasHead: true, grab: !web, sub: sh.sub || "", blocks: sh.blocks.filter(Boolean),
        hasFoot: !!(sh.foot && sh.foot.length), foot: (sh.foot || []).filter(Boolean), footNote: sh.footNote || "", footStyle: footBar("var(--surface-overlay)") });
    }

    var top = page === "home" || page === "accept" || (wide && ["members", "modules", "storage", "billing", "data", "sync", "advanced", "leave"].indexOf(page) >= 0);
    var parent = page === "member" || page === "compose" || page === "invites" ? base + "/settings/members"
      : page === "subscribe" || page === "takeover" ? base + "/settings/billing"
      : page === "exports" ? base + "/settings/data" : page === "bundle" ? base + "/settings/sync" : base + "/settings";
    return { panes: panes, headTitle: headTitle, headSub: headSub, sheetOpen: !!sheetD, showBack: !top,
      onBack: function () { self.setState({ hsSheet: null }); self.go(parent); } };
  }

  window.HH_HS_VIEW = view;
})();
