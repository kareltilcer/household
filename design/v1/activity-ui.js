/* Activity, live in the prototype shell.
   Every row is an event from activity.js (HH_ACTIVITY), rendered per reader from its key and
   arguments. Grants come from the shell's nav for the current household, so switching member
   or household changes the feed. Nothing here writes: the log is append-only and read online.
   Drawn through the Finance block vocabulary, like Property and Utilities. */
(function () {
  var KINDS = ["Hero", "Label", "Rows", "Note", "Bars", "Acts", "Field", "Chips", "Inputs", "Cards", "Steps", "Kv", "Empty"];
  var LV = ["none", "view", "contribute", "manage"];
  var MEN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MCS = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
  var WEN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var WCS = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
  var PAGE = 30;
  function safe(fn, d) { try { var v = fn(); return v == null ? d : v; } catch (e) { return d; } }
  function at(lv, want) { return LV.indexOf(lv || "none") >= LV.indexOf(want); }

  var FIELD = {
    amount_minor: ["Amount", "Částka"], unit_price: ["Price per kWh", "Cena za kWh"],
    standing_charge_monthly: ["Monthly standing charge", "Měsíční stálý plat"], trial_ends_on: ["Trial ends", "Konec zkušební doby"],
    notes: ["Access to Notes", "Přístup k Poznámkám"], points: ["Points", "Body"]
  };
  var GRANT = { none: ["no access", "bez přístupu"], view: ["can see", "vidí"], contribute: ["can add", "přispívá"], manage: ["manages", "spravuje"] };
  var VIA = { web: ["on the web", "na webu"], mobile: ["in the app", "v aplikaci"], sync: ["from a device that had been offline", "ze zařízení, které bylo offline"],
    import: ["by the importer", "importem"], system: ["by Household itself", "samotným Householdem"] };
  var SAYS_CS = {
    "e-01": "o dva týdny, protože rozhovor s podporou přesáhl konec zkušební doby",
    "e-06": "Jana zadala 450 v telefonu, Petr 500 v 18:40",
    "e-07": "přepsáno ze zářijového vyúčtování",
    "e-10": "zúžení přístupu — Klára ho vidí i ve svém záznamu",
    "e-15": "padesát dní to nikdo neudělal, tak to stouplo"
  };
  var SAYS_EN = {
    "e-06": "Jana set 450 on her phone, Petr set 500 at 18:40",
    "e-10": "a narrowing, and Klára sees it in her own log too"
  };
  /* the thing an event touched, and where in the app it lives */
  var OWNER = { chores: "chores", shopping: "shopping", notes: "notes", documents: "documents", vehicles: "vehicles",
    finance: "finance", utilities: "utilities", identity: "admin", billing: "admin", platform: "admin" };

  function view(self, seg, query, hash, wide) {
    var A = window.HH_ACTIVITY, F = window.HH_FIXTURES, N = window.HH_NAV;
    if (!A) return null;
    var s = self.state, L = self.chatL.bind(self), web = s.client === "web", cs = s.locale === "cs", lang = cs ? "cs" : "en";
    var nav = N ? N.navFor(s.member, s.household) : {};
    var grants = nav.grants || {};
    var me = s.member, TD = A.today, off = !s.online;
    var ro = ["read_only", "canceled", "restricted"].indexOf(s.ent) >= 0 || s.screen === "readonly";
    var feedOK = at(grants.activity, "view");
    var W = function (pair) { return pair ? (cs ? pair[1] : pair[0]) : ""; };
    var modName = function (m) { return F && F.moduleName ? F.moduleName(m, s.locale) : m; };
    var actorName = function (e) {
      if (e.actorType === "service") return e.actor === "Household support" ? L("Household support", "Podpora Household") : "Household";
      return e.actor === me ? L("You", "Vy") : A.firstName(e.actor);
    };
    var go = function (r) { return function () { self.setState({ acSheet: null }); self.go(r); }; };

    /* ── words ── */
    var day = function (iso, y) {
      if (!iso) return "\u2013";
      var p = iso.slice(0, 10).split("-");
      return cs ? (+p[2]) + ". " + MCS[+p[1] - 1] + (y ? " " + p[0] : "") : (+p[2]) + " " + MEN[+p[1] - 1] + (y ? " " + p[0] : "");
    };
    var dayHead = function (iso) {
      var d = A.diff(TD, iso);
      if (d === 0) return L("Today", "Dnes");
      if (d === 1) return L("Yesterday", "Včera");
      var wd = new Date(iso.slice(0, 10) + "T00:00:00Z").getUTCDay();
      return (cs ? WCS[wd] : WEN[wd]) + " " + day(iso);
    };
    var clock = function (e) { return A.clock(e.at); };
    var viaW = function (v) { return W(VIA[v]) || v; };
    var fieldW = function (f) { return W(FIELD[f]) || f.replace(/_/g, " "); };
    var valW = function (f, v) {
      if (f.field === "notes" && GRANT[v]) return W(GRANT[v]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return day(v, true);
      return String(v);
    };
    var saysW = function (e, f, i) {
      if (i > 0 && !f.says) return "";
      if (cs) return SAYS_CS[e.id] || "";
      return SAYS_EN[e.id] || f.says || "";
    };
    var moduleOf = function (e) { var a = A.actionOf(e.key); return a ? a.module : "admin"; };
    var levelOf = function (e) { var a = A.actionOf(e.key); return a ? a.level : "info"; };
    var sentence = function (e) {
      var t = safe(function () { return A.render(e, lang); }, e.key);
      if (e.actor === me && e.actorType === "member") {
        var nm = A.firstName(me);
        if (t.indexOf(nm + " ") === 0) t = L("You", "Vy") + t.slice(nm.length);
      }
      return t;
    };

    /* ── the reader's feed (FR-AL5, FR-AL6, FR-AL7) ── */
    var all = A.allEvents();
    var visible = all.filter(function (e) {
      if (e.actorType === "member" && e.actor === me) return true;
      if (!feedOK) return false;
      if (e.actorType === "service") return true;
      return at(grants[moduleOf(e)], "view");
    });
    var isPriv = function (e) { return !!e.private && e.owner !== me; };
    var entModule = function (e) { return OWNER[e.entity.type.split(".")[0]] || moduleOf(e); };
    var canReach = function (e) { return !isPriv(e) && at(grants[entModule(e)], "view"); };
    var timelineOf = function (id) { return visible.filter(function (x) { return !isPriv(x) && (x.entity.id === id || (x.alsoEntity && x.alsoEntity.id === id)); }); };
    var hrefOf = function (e) {
      if (isPriv(e)) return "";
      var t = e.entity.type, m = entModule(e);
      if (!at(grants[m], "view")) return "";
      if (t === "documents.document") return "/documents/" + e.entity.id;
      if (t === "notes.note") {
        var D = safe(function () { return self.nD(); }, null);
        var n = D ? D.notes.filter(function (x) { return x.id === e.entity.id; })[0] : null;
        return n ? safe(function () { return self.nHref(n, D); }, "/notes") : "/notes";
      }
      if (t === "finance.ledger_entry") return "/finance/ledger";
      if (m === "admin") return "";
      return "/" + m;
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
        titleStyle: "font-size:0.9375em;line-height:1.35;overflow-wrap:anywhere;text-wrap:pretty;font-weight:" + (p.strong ? "600" : "500") + ";color:" + (p.muted ? "var(--text-muted)" : "var(--text-primary)") + (p.italic ? ";font-style:italic" : ""),
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
        onChange: function (e) { if (!p.off) p.set(e.target.value); },
        boxStyle: "display:flex;align-items:center;gap:8px;border:1px solid " + (p.err ? "var(--danger)" : "var(--border-strong)") +
          ";border-radius:8px;background:var(--input-bg);padding:0 12px;max-width:" + (p.narrow ? "260px" : "520px") + (p.off ? ";opacity:0.6" : "") }));
    };
    var empty = function (t, body, action, on) { return blk("Empty", { title: t, body: body, action: action || "", on: on || function () {} }); };
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

    /* ── route ── */
    var q = {}; String(query || "").split("&").forEach(function (kvp) { var p = kvp.split("="); if (p[0]) q[p[0]] = decodeURIComponent(p[1] || ""); });
    var a = seg[1] || "";
    var page = "feed", entId = "", entType = "";
    if (hash === "diff") page = "changes";
    else if (hash === "c-48") page = "offlineWhy";
    else if (!a) page = "feed";
    else if (a === "changes") page = "changes";
    else if (a === "household") page = "platform";
    else if (a === "week") page = "week";
    else if (a === "entity") { page = "timeline"; entType = seg[2] || ""; entId = decodeURIComponent(seg[3] || ""); }
    else page = "missing";
    if (!feedOK && ["changes", "platform", "week", "timeline"].indexOf(page) >= 0) page = "absent";

    var fMod = q.m || "", fWho = q.who || "", fImp = q.imp === "1", fDays = q.days || "all";
    var qs = function (patch) {
      var o = { m: fMod, who: fWho, imp: fImp ? "1" : "", days: fDays === "all" ? "" : fDays };
      Object.keys(patch || {}).forEach(function (k) { o[k] = patch[k]; });
      var parts = Object.keys(o).filter(function (k) { return o[k]; }).map(function (k) { return k + "=" + encodeURIComponent(o[k]); });
      return "/activity" + (parts.length ? "?" + parts.join("&") : "");
    };
    var setF = function (patch) { return function () { self.setState({ acSheet: null, acLimit: PAGE }); self.go(qs(patch)); }; };
    var qText = s.acQ || "";

    var sheetD = s.acSheet && s.acSheet.at === s.route ? s.acSheet : null;
    var openEv = function (e) { return isPriv(e) ? null : function () { self.setState({ acSheet: { at: self.state.route, kind: "event", id: e.id } }); }; };
    var closeSheet = function () { self.setState({ acSheet: null }); };

    /* one line in any list */
    var evRow = function (e, o) {
      o = o || {};
      if (isPriv(e)) return row({ title: A.redactedText[lang], italic: true, muted: true,
        sub: clock(e) + " \u00b7 " + L("private to its owner", "soukromé vlastníka"), badge: L("private", "soukromé") });
      var lv = levelOf(e), n = (e.diff || []).length;
      var meta = [o.withDay ? day(e.at) : "", clock(e), o.noModule ? "" : modName(moduleOf(e)), e.via === "sync" ? L("arrived after being offline", "dorazilo po výpadku") : ""].filter(Boolean);
      return row({ title: sentence(e), sub: meta.join(" \u00b7 "),
        badge: lv === "warning" ? L("not accepted", "nepřijato") : e.session ? L("just now", "právě teď") : "",
        badgeTone: lv === "warning" ? "warn" : "accent",
        right: n ? n + (n === 1 ? L(" field", " pole") : L(" fields", " pole")) : "", tone: "muted",
        open: openEv(e) });
    };
    var byDay = function (list, o) {
      var out = [], cur = "", bucket = [];
      var flush = function () { if (bucket.length) { out.push(label(dayHead(cur))); out.push(rows(bucket)); } bucket = []; };
      list.forEach(function (e) { var d = e.at.slice(0, 10); if (d !== cur) { flush(); cur = d; } bucket.push(evRow(e, o)); });
      flush();
      return out;
    };

    var P = [], headTitle = feedOK ? L("Activity", "Aktivita") : L("What you did", "Co jste udělali"), headSub = "";
    var push = function (x) { if (x) P.push(x); };
    if (ro) push(note(L("The subscription has lapsed. The log still reads, because reading it isn't a change.", "Předplatné vypršelo. Záznam se dál čte, protože čtení nic nemění."), "box"));

    /* the phone's section switch */
    var sections = feedOK ? [
      ["feed", L("Everything", "Vše"), "/activity"], ["changes", L("Old and new values", "Staré a nové hodnoty"), "/activity/changes"],
      ["platform", L("Done by Household", "Udělal Household"), "/activity/household"], ["week", L("The week", "Týden"), "/activity/week"]
    ] : [];
    if (!wide && sections.length && page !== "timeline") push(chips("", sections.map(function (x) { return chip(x[1], page === x[0], go(x[2])); })));

    if (page === "feed") {
      headSub = feedOK ? L("Who changed what, when, from where", "Kdo co změnil, kdy a odkud") : L("Only your own actions", "Jen to, co jste udělali vy");
      if (!feedOK) push(note(L("Activity isn't shared with you, so this is only what you did yourself. Everyone can always see that part.",
        "Aktivita s vámi sdílená není, takže tu je jen to, co jste udělali vy. Tu část vidí každý vždycky."), "box"));
      if (s.screen === "empty") {
        push(empty(L("Nothing yet.", "Zatím nic."), L("The first thing anybody does in this household writes a line here, including you adding a shopping item on the way home.",
          "První věc, kterou kdokoli v domácnosti udělá, se tu objeví. Třeba i položka na nákup cestou domů."), L("See today", "Na dnešek"), go("/today")));
      } else {
        /* filters */
        if (off) push(note(L("This is the page you had open at 08:12. The rest of the log is on the server. It's the one thing in Household that isn't kept on your device.",
          "Tohle je stránka, kterou jste měli otevřenou v 8:12. Zbytek záznamu je na serveru. Je to jediná věc v Householdu, která není ve vašem zařízení."), "boxOff",
          L("Why the log isn't on this device", "Proč záznam není v zařízení"), go("/activity#c-48")));
        push(field({ label: "", value: qText, placeholder: off ? L("Search needs a connection", "Hledání potřebuje připojení") : L("Search what happened, e.g. tariff or Lidl", "Hledat, co se stalo, např. tarif nebo Lidl"),
          off: off, set: function (v) { self.setState({ acQ: v, acLimit: PAGE }); } }));
        var list = visible;
        if (fMod) list = list.filter(function (e) { return moduleOf(e) === fMod; });
        if (fWho) list = list.filter(function (e) { return fWho === "household" ? e.actorType === "service" : e.actor === fWho; });
        if (fImp) list = list.filter(function (e) { return levelOf(e) !== "info"; });
        if (fDays !== "all") list = list.filter(function (e) { return A.diff(e.at, A.addDays(TD, -(+fDays))) > 0; });
        var searching = !!qText.trim() && !off;
        if (searching) {
          var needle = A.fold(qText.trim());
          /* FR-AL5's second rule: a private event is out of scope before anything matches */
          list = list.filter(function (e) {
            return !isPriv(e) && (A.fold(sentence(e)).indexOf(needle) >= 0 || A.fold(safe(function () { return A.render(e, lang === "cs" ? "en" : "cs"); }, "")).indexOf(needle) >= 0 || A.fold(e.entity.label).indexOf(needle) >= 0);
          });
        }
        var showF = wide || (s.acFilters != null ? !!s.acFilters : false);
        if (feedOK && !wide) {
          var nAct = [fMod, fWho, fImp ? "1" : "", fDays !== "all" ? "1" : ""].filter(Boolean).length;
          push(acts([btn((showF ? L("Hide filters", "Skrýt filtry") : L("Filters", "Filtry")) + (nAct ? " \u00b7 " + nAct : ""), "", function () { self.setState({ acFilters: !showF }); })]));
        }
        if (feedOK && showF) {
          push(chips(L("When", "Kdy"), [["all", L("All time", "Celou dobu")], ["7", L("7 days", "7 dní")], ["30", L("30 days", "30 dní")]].map(function (x) {
            return chip(x[1], fDays === x[0], setF({ days: x[0] === "all" ? "" : x[0] }));
          }).concat([chip((fImp ? "\u2713 " : "") + L("Important only", "Jen důležité"), fImp, setF({ imp: fImp ? "" : "1" }))])));
          var people = [];
          visible.forEach(function (e) { var k = e.actorType === "service" ? "household" : e.actor; if (people.indexOf(k) < 0) people.push(k); });
          people.sort(function (x, y) { return x === me ? -1 : y === me ? 1 : x === "household" ? 1 : y === "household" ? -1 : 0; });
          push(chips(L("Who", "Kdo"), [chip(L("Anyone", "Kdokoli"), !fWho, setF({ who: "" }))].concat(people.map(function (p) {
            return chip(p === "household" ? "Household" : p === me ? L("You", "Vy") : A.firstName(p), fWho === p, setF({ who: fWho === p ? "" : p }));
          }))));
          if (!wide) {
            var mods = [];
            visible.forEach(function (e) { var m = moduleOf(e); if (mods.indexOf(m) < 0) mods.push(m); });
            push(chips(L("Module", "Modul"), [chip(L("All", "Vše"), !fMod, setF({ m: "" }))].concat(mods.map(function (m) { return chip(modName(m), fMod === m, setF({ m: fMod === m ? "" : m })); }))));
          }
        }
        var filtered = !!(fMod || fWho || fImp || fDays !== "all" || searching);
        if (filtered && list.length) push(note(list.length + (list.length === 1 ? L(" event", " událost") : L(" events", " událostí")) + (searching ? L(" match", " odpovídá") : ""), "", L("Clear filters", "Zrušit filtry"), function () { self.setState({ acQ: "", acLimit: PAGE }); self.go("/activity"); }));
        if (!list.length) {
          push(empty(searching ? L("Nothing matches \u201c" + qText.trim() + "\u201d.", "Nic neodpovídá \u201e" + qText.trim() + "\u201c.") : L("Nothing in this view.", "V tomto výběru nic není."),
            searching ? L("Search reads the sentences as they're written in either language, and the names of the things they're about. Accents don't matter.", "Hledá se ve větách v obou jazycích a v názvech věcí. Na diakritice nezáleží.")
              : L("The filters leave nothing out of the log. Nothing has been removed from it.", "Filtry nenechaly nic. Ze záznamu se nic neodstranilo."),
            L("Clear filters", "Zrušit filtry"), function () { self.setState({ acQ: "", acLimit: PAGE }); self.go("/activity"); }));
        } else {
          var cap = off ? Math.min(A.cachePage, list.length) : Math.min(s.acLimit || PAGE, list.length);
          byDay(list.slice(0, cap)).forEach(push);
          if (off && list.length > cap) {
            push(note(L("Nothing below this line until you're back on the network.", "Pod touto čarou nic, dokud nebudete zase online."), "boxOff"));
            push(acts([btn(L("Try again", "Zkusit znovu"), "", function () { self.docToastShow(L("Still no connection. The page above is what you had.", "Pořád bez připojení. Nahoře je to, co jste měli.")); })]));
          } else if (list.length > cap) {
            push(acts([btn(L("Show older", "Zobrazit starší") + " \u00b7 " + (list.length - cap), "", function () { self.setState({ acLimit: cap + PAGE }); })]));
          } else if (!filtered) {
            push(note(L("That's the beginning of this household's log. Nothing in it can be edited or deleted, by anyone.", "Tady záznam domácnosti začíná. Nikdo v něm nic nemůže upravit ani smazat."), "muted"));
          }
        }
      }
    }

    if (page === "changes") {
      headTitle = L("Old and new values", "Staré a nové hodnoty");
      headSub = L("Money, tariffs, access, and what a chore is worth", "Peníze, tarify, přístupy a hodnota úkolů");
      var dr = visible.filter(function (e) { return !isPriv(e) && (e.diff || []).length; });
      push(note(L("Every change to money, a tariff or someone's access records the old value next to the new one. Other modules choose what else is worth keeping, like Chores does for points.",
        "Každá změna peněz, tarifu nebo přístupu uloží starou hodnotu vedle nové. Ostatní moduly si samy řeknou, co dalšího stojí za to, třeba Úkoly body."), "muted"));
      if (!dr.length) push(empty(L("No fields changed.", "Žádná pole se nezměnila."), L("Nothing you can see has been edited in a way that keeps its old value.", "Nic, co vidíte, nebylo upraveno tak, aby se uložila stará hodnota."), "", null));
      dr.forEach(function (e) {
        push(label(sentence(e) + " \u00b7 " + day(e.at) + " " + clock(e)));
        push(rows(e.diff.map(function (f, i) {
          return row({ title: fieldW(f.field), sub: saysW(e, f, i), right: valW(f, f.to), rightSub: L("was ", "bylo ") + valW(f, f.from), open: openEv(e) });
        })));
      });
    }

    if (page === "platform") {
      headTitle = L("Done by Household", "Udělal Household");
      headSub = L("Everything the platform did to this household", "Vše, co platforma s domácností udělala");
      push(note(L("Household's staff can't read your notes, documents or money. What they and the system did do is listed here, so that promise is something you can check.",
        "Lidé z Householdu nečtou vaše poznámky, dokumenty ani peníze. Co udělali oni nebo systém, je tady, takže ten slib si můžete ověřit."), "box"));
      var pr = visible.filter(function (e) { return e.actorType === "service"; });
      if (!pr.length) push(empty(L("Nothing yet.", "Zatím nic."), L("Household hasn't done anything to this household.", "Household s touto domácností zatím nic neudělal."), "", null));
      byDay(pr, { noModule: true }).forEach(push);
    }

    if (page === "week") {
      var days = q.days === "30" ? 30 : 7;
      var since = A.addDays(TD, -days);
      var wk = visible.filter(function (e) { return A.diff(e.at, since) > 0; });
      headTitle = L("The week", "Týden"); headSub = days === 7 ? L("Last 7 days", "Posledních 7 dní") : L("Last 30 days", "Posledních 30 dní");
      push(chips("", [chip(L("7 days", "7 dní"), days === 7, go("/activity/week")), chip(L("30 days", "30 dní"), days === 30, go("/activity/week?days=30"))]));
      var tally = function (fn) {
        var m = {}, order = [];
        wk.forEach(function (e) { var k = fn(e); if (!(k in m)) { m[k] = 0; order.push(k); } m[k]++; });
        return order.map(function (k) { return { k: k, n: m[k] }; }).sort(function (x, y) { return y.n - x.n; });
      };
      var bm = tally(moduleOf), ba = tally(function (e) { return e.actorType === "service" ? "household" : e.actor; }), bv = tally(function (e) { return e.via; });
      push(hero({ kicker: day(A.addDays(TD, -days + 1)) + " \u2013 " + day(TD), big: String(wk.length), sub: L("things happened that you can see", "věcí se stalo, které vidíte"),
        stats: [stat(L("Busiest", "Nejvíc"), bm[0] ? modName(bm[0].k) : "\u2013"), stat(L("Most active", "Nejaktivnější"), ba[0] ? (ba[0].k === "household" ? "Household" : A.firstName(ba[0].k)) : "\u2013"),
          stat(L("Important", "Důležité"), String(wk.filter(function (e) { return levelOf(e) !== "info"; }).length))] }));
      if (wk.length) {
        push(label(L("By module", "Podle modulu")));
        push(bars(bm.map(function (x) { return { name: modName(x.k), right: String(x.n), v: x.n, open: go(qs({ m: x.k, who: "", imp: "", days: String(days) })) }; })));
        push(label(L("By person", "Podle lidí")));
        push(bars(ba.map(function (x) { return { name: x.k === "household" ? "Household" : x.k === me ? L("You", "Vy") : A.firstName(x.k), right: String(x.n), v: x.n, ink: "var(--text-muted)", open: go(qs({ who: x.k, m: "", imp: "", days: String(days) })) }; })));
        push(label(L("From where", "Odkud")));
        push(bars(bv.map(function (x) { return { name: viaW(x.k), right: String(x.n), v: x.n, ink: "var(--border-strong)" }; })));
      } else push(empty(L("A quiet week.", "Klidný týden."), L("Nothing you can see happened in these days.", "V těchto dnech se nic, co vidíte, nestalo."), "", null));
    }

    if (page === "timeline") {
      var tl = timelineOf(entId).slice().sort(function (x, y) { return x.at < y.at ? -1 : 1; });
      var first = tl[0];
      if (!first || !canReach(first)) {
        page = "missing";
      } else {
        var lbl = first.entity.label, mods = [];
        tl.forEach(function (e) { var m = moduleOf(e); if (mods.indexOf(m) < 0) mods.push(m); });
        headTitle = lbl; headSub = L("History, oldest first", "Historie, od nejstaršího");
        push(hero({ small: true, kicker: modName(entModule(first)), big: lbl,
          sub: tl.length + (tl.length === 1 ? L(" event", " událost") : L(" events", " událostí")) + (mods.length > 1 ? L(" across ", " v modulech ") + mods.map(modName).join(", ") : "") }));
        var href = hrefOf(first);
        if (href) push(acts([btn(L("Open it", "Otevřít"), "", go(href))]));
        push(rows(tl.map(function (e) { return evRow(e, { withDay: true }); })));
        if (tl.length === 1) push(note(L("It was created and nothing else has happened to it yet.", "Vzniklo to a zatím se s tím nic dalšího nestalo."), "muted"));
      }
    }

    if (page === "offlineWhy") {
      var os = A.offlineState(me);
      headTitle = L("The log is on the server", "Záznam je na serveru"); headSub = "";
      push(hero({ small: true, kicker: L("Activity", "Aktivita"), big: L("The rest of the log is on the server", "Zbytek záznamu je na serveru"),
        sub: off ? L("You're offline. The page you last had open is still here.", "Jste offline. Poslední otevřená stránka tu zůstává.") : L("You're online, so the whole log reads.", "Jste online, takže se čte celý záznam.") }));
      push(kv([[L("Kept on this device", "V zařízení"), L("the last page you read, up to ", "poslední přečtená stránka, nejvýš ") + A.cachePage + L(" events", " událostí")],
        [L("Last read", "Naposledy čteno"), day(os.readAt) + " " + A.clock(os.readAt)], [L("Everything else", "Vše ostatní"), L("on the server", "na serveru")]]));
      push(note(L("The log grows for as long as the household exists and is read rarely. Keeping all of it on every phone would make it the largest thing on the device for the least use, so it's read online. Everything else in Household works the same offline.",
        "Záznam roste po celou dobu domácnosti a čte se málokdy. Mít ho celý v každém telefonu by z něj udělalo největší věc v zařízení pro nejmenší užitek, proto se čte online. Všechno ostatní v Householdu funguje offline stejně."), "muted"));
      push(acts([btn(L("Back to Activity", "Zpět na Aktivitu"), "", go("/activity"))]));
    }

    if (page === "absent") {
      push(empty(L("Activity isn't shared with you.", "Aktivita s vámi sdílená není."), L("What you did yourself is still there, because that part isn't a grant.", "To, co jste udělali vy, tam zůstává, protože na to oprávnění není potřeba."),
        L("See what you did", "Co jste udělali"), go("/activity")));
    }
    if (page === "missing") {
      headTitle = L("Activity", "Aktivita");
      push(empty(L("No history here for you.", "Tady pro vás žádná historie není."), L("It may belong to a module you can't see, or it's private to someone. Nothing was changed by opening this link.",
        "Může patřit do modulu, který nevidíte, nebo je něčí soukromé. Otevřením odkazu se nic nezměnilo."), L("Back to Activity", "Zpět na Aktivitu"), go("/activity")));
    }

    /* ── one event ── */
    function sheetBody(d) {
      var e = all.filter(function (x) { return x.id === d.id; })[0];
      if (!e || isPriv(e)) return null;
      var closeB = btn(L("Close", "Zavřít"), "", closeSheet);
      var B = [], out = { title: sentence(e), sub: dayHead(e.at) + " \u00b7 " + clock(e), blocks: B, foot: [] };
      B.push(kv([[L("Who", "Kdo"), actorName(e) + (e.actorType === "service" ? L(" \u00b7 not a member", " \u00b7 není člen") : "")],
        [L("When", "Kdy"), day(e.at, true) + ", " + clock(e)], [L("From", "Odkud"), viaW(e.via)],
        [L("Module", "Modul"), modName(moduleOf(e))], [L("About", "Týká se"), e.entity.label]]));
      if ((e.diff || []).length) {
        B.push(label(L("What changed", "Co se změnilo")));
        B.push(rows(e.diff.map(function (f, i) { return row({ title: fieldW(f.field), sub: saysW(e, f, i), right: valW(f, f.to), rightSub: L("was ", "bylo ") + valW(f, f.from) }); })));
      }
      if (e.reason && e.key === "chores.point_entry.created") B.push(note(L("Reason given: ", "Uvedený důvod: ") + e.reason, "box"));
      if (e.via === "sync") B.push(note(L("Written on a device that had been offline, and logged when it reconnected. The time is when it was done, not when it arrived.",
        "Zapsáno v zařízení, které bylo offline, a zalogováno po připojení. Čas je, kdy se to stalo, ne kdy to dorazilo."), "boxOff"));
      if (levelOf(e) === "warning") B.push(note(L("Nothing was saved. It's here so whoever entered it can see why it didn't go through.", "Nic se neuložilo. Je to tu, aby ten, kdo to zadal, viděl proč."), "boxWarn"));
      if (e.key === "platform.legal_request.answered") B.push(note(L("Only account metadata was handed over: who is a member and when the household was created. Nobody at Household can read what's in it.",
        "Předána byla jen metadata účtu: kdo je členem a kdy domácnost vznikla. Nikdo z Householdu nemůže číst, co v ní je."), "box"));
      if (e.key === "identity.grant.updated") B.push(note(L("A change to what someone can see is in their own log too, whatever they're allowed to see.", "Změna toho, co někdo vidí, je i v jeho vlastním záznamu, ať vidí cokoli."), "muted"));
      var tl = feedOK ? timelineOf(e.entity.id) : [];
      var href = hrefOf(e);
      var ent = e.entity.type + "/" + encodeURIComponent(e.entity.id);
      out.foot = [closeB,
        feedOK && canReach(e) && tl.length > 1 ? btn(L("Its history", "Jeho historie") + " \u00b7 " + tl.length, "", function () { self.setState({ acSheet: null, acFrom: self.state.route }); self.go("/activity/entity/" + ent); }) : null,
        href ? btn(L("Open it", "Otevřít"), "primary", go(href)) : null].filter(Boolean);
      B.push(note(L("The log can't be edited. To change this, change the thing itself.", "Záznam nejde upravit. Chcete-li to změnit, změňte samotnou věc."), "muted"));
      return out;
    }

    /* ── assemble ── */
    var footBar = function (bg) {
      return "position:sticky;bottom:0;margin-top:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--border);background:" + bg;
    };
    var panes = [];
    if (wide) {
      var nb = [];
      if (feedOK) {
        var dN = visible.filter(function (e) { return !isPriv(e) && (e.diff || []).length; }).length;
        var pN = visible.filter(function (e) { return e.actorType === "service"; }).length;
        var wN = visible.filter(function (e) { return A.diff(e.at, A.addDays(TD, -7)) > 0; }).length;
        nb.push(label(L("Log", "Záznam")));
        nb.push(rows([row({ title: L("Everything", "Vše"), right: String(visible.length), on: page === "feed" && !fMod, noChev: true, open: go("/activity") }),
          row({ title: L("Old and new values", "Staré a nové hodnoty"), right: String(dN), on: page === "changes", noChev: true, open: go("/activity/changes") }),
          row({ title: L("Done by Household", "Udělal Household"), right: String(pN), on: page === "platform", noChev: true, open: go("/activity/household") }),
          row({ title: L("The week", "Týden"), sub: wN + L(" in 7 days", " za 7 dní"), on: page === "week", noChev: true, open: go("/activity/week") })]));
        var mc = {}, mo = [];
        visible.forEach(function (e) { var m = moduleOf(e); if (!(m in mc)) { mc[m] = 0; mo.push(m); } mc[m]++; });
        mo.sort(function (x, y) { return mc[y] - mc[x]; });
        nb.push(label(L("By module", "Podle modulu")));
        nb.push(rows(mo.map(function (m) { return row({ title: modName(m), right: String(mc[m]), on: page === "feed" && fMod === m, noChev: true, open: setF({ m: fMod === m ? "" : m }) }); })));
      } else {
        nb.push(rows([row({ title: L("What you did", "Co jste udělali"), right: String(visible.length), on: true, noChev: true, open: go("/activity") })]));
        nb.push(note(L("Activity isn't shared with you. Your own actions always are.", "Aktivita s vámi sdílená není. Vaše vlastní akce vždycky."), "muted"));
      }
      panes.push({ key: "nav", role: "navigation", title: L("Activity", "Aktivita"),
        outer: "flex:0 0 " + (web ? "280px" : "34%") + ";min-width:0;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--border);background:var(--surface)",
        inner: "flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column", col: "display:flex;flex-direction:column;padding-bottom:24px",
        onOuter: function () {}, hasHead: false, sub: "", hasFoot: false, foot: [], footNote: "", footStyle: "", blocks: nb.filter(Boolean) });
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
        hasFoot: !!(sh.foot && sh.foot.length), foot: sh.foot, footNote: sh.footNote || "", footStyle: footBar("var(--surface-overlay)") });
    }

    var top = page === "feed" || (wide && ["changes", "platform", "week"].indexOf(page) >= 0);
    return { panes: panes, headTitle: headTitle, headSub: headSub, sheetOpen: !!sheetD, showBack: !top,
      onBack: function () { self.setState({ acSheet: null }); if (page === "timeline" && self.state.acFrom) self.go(self.state.acFrom); else self.go("/activity"); } };
  }

  window.HH_AC_VIEW = view;
})();
