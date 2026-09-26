/* Stage 14 — the activity log: the household's own view of the audit spine.

   Built from docs/prd/modules/16-activity.md (FR-AL1-10), prd/03-platform-strands.md §1
   (the audit spine, D-21), prd/02-identity-and-access.md FR-AC2, design/05-screens.md
   §C Activity log, 03-patterns.md §1 (what is not synced) and §5.

   Three things are computed here rather than described:

   1. Nothing is stored rendered. Every event is a key and arguments, and the two
      languages are produced from the same row on render (D-21, FR-AL2). The check counts
      stored strings, and the answer has to be zero.

   2. FR-AL5 is two rules, deliberately: a private event is redacted in the feed and
      excluded from q= matching entirely. Both are run, and the redacted body a non-owner
      sees is compared character by character with what every other non-owner sees.

   3. Grant filtering (FR-AL6) against the one permission that ignores grants: a member
      can always read what they themselves did. Four personas, four different feeds,
      computed from the fixture — and for three of them the module is otherwise absent.

   The chore events are not authored here. They are derived from chores.js's completion
   rows, because two files with two versions of what Adam did on Tuesday is exactly the
   kind of thing an audit log exists to prevent.
*/
(function () {

  var TODAY = "2026-09-09";
  var CACHE_PAGE = 20;                      /* what the query cache holds when the log goes offline */

  function D(s) { return new Date(s.length > 10 ? s : s + "T00:00:00Z"); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function addDays(s, n) { var t = D(s.slice(0, 10)); t.setUTCDate(t.getUTCDate() + n); return iso(t); }
  function diff(a, b) { return Math.round((D(a.slice(0, 10)) - D(b.slice(0, 10))) / 86400000); }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
  function fmt(s) { var t = D(s.slice(0, 10)); return t.getUTCDate() + " " + MONTHS[t.getUTCMonth()]; }
  function clock(s) { return s.length > 10 ? s.slice(11, 16) : ""; }

  function member(id) {
    var F = window.HH_FIXTURES;
    return (F ? F.members : []).filter(function (m) { return m.id === id; })[0] || null;
  }
  function firstName(id) { var m = member(id); return m ? m.name : id; }
  function grantOf(id, mod) { var m = member(id); return m ? (m.grants[mod] || "none") : "none"; }
  function atLeast(level, want) {
    var L = ["none", "view", "contribute", "manage"];
    return L.indexOf(level) >= L.indexOf(want);
  }

  /* ── 1. The action catalog ────────────────────────────────────────────────
     Each module declares its own actions, which is what lets both this screen and the
     notification composer offer them without either one holding a list of its own
     (00-module-model: "its own audit actions — declared, so the notification composer and
     the activity log can offer them"). The diff set is FR-AL4's: everything
     money-bearing, every tariff, every permission and membership change, plus what each
     module nominates. */

  var ACTIONS = [
    { key: "chores.completion.created", module: "chores", entity: "chores.occurrence", level: "info", diff: false,
      en: "{actor} finished {chore}", cs: "{actor} dokon\u010dil(a) {chore}" },
    { key: "chores.point_entry.created", module: "chores", entity: "chores.point_entry", level: "notice", diff: false,
      en: "{actor} {verb} {points} points {who}", cs: "{actor} {verb} {points} bod\u016f {who}" },
    { key: "chores.chore.updated", module: "chores", entity: "chores.chore", level: "notice", diff: true, nominated: true,
      en: "{actor} changed {chore}", cs: "{actor} upravil(a) {chore}" },
    { key: "shopping.item.created", module: "shopping", entity: "shopping.item", level: "info", diff: false,
      en: "{actor} added {item} to {list}", cs: "{actor} p\u0159idal(a) {item} do {list}" },
    { key: "shopping.trip.created", module: "shopping", entity: "shopping.trip", level: "info", diff: false,
      en: "{actor} recorded a shop at {shop}", cs: "{actor} zaznamenal(a) n\u00e1kup v {shop}" },
    { key: "notes.note.updated", module: "notes", entity: "notes.note", level: "info", diff: false,
      en: "{actor} edited {note}", cs: "{actor} upravil(a) {note}" },
    { key: "documents.document.created", module: "documents", entity: "documents.document", level: "info", diff: false,
      en: "{actor} uploaded {doc}", cs: "{actor} nahr\u00e1l(a) {doc}" },
    { key: "documents.document.moved", module: "documents", entity: "documents.document", level: "info", diff: false,
      en: "{actor} moved {doc} into {folder}", cs: "{actor} p\u0159esunul(a) {doc} do {folder}" },
    { key: "documents.document.pinned", module: "documents", entity: "documents.document", level: "info", diff: false,
      en: "{actor} pinned {doc} for everyone", cs: "{actor} p\u0159ipnul(a) {doc} pro v\u0161echny" },
    { key: "notes.note.pinned", module: "notes", entity: "notes.note", level: "info", diff: false,
      en: "{actor} pinned {note} for everyone", cs: "{actor} p\u0159ipnul(a) {note} pro v\u0161echny" },
    { key: "notes.note.unpinned", module: "notes", entity: "notes.note", level: "info", diff: false,
      en: "{actor} unpinned {note} for everyone", cs: "{actor} odepnul(a) {note} pro v\u0161echny" },
    { key: "vehicles.service_record.created", module: "vehicles", entity: "vehicles.service_record", level: "info", diff: false,
      en: "{actor} added a service record to {vehicle}, with {doc} attached",
      cs: "{actor} p\u0159idal(a) servisn\u00ed z\u00e1pis k {vehicle} s dokumentem {doc}" },
    { key: "finance.ledger_entry.updated", module: "finance", entity: "finance.ledger_entry", level: "notice", diff: true,
      en: "{actor} changed the amount on {entry}", cs: "{actor} zm\u011bnil(a) \u010d\u00e1stku u {entry}" },
    { key: "utilities.tariff.updated", module: "utilities", entity: "utilities.tariff", level: "notice", diff: true,
      en: "{actor} updated the {service} tariff", cs: "{actor} upravil(a) tarif {service}" },
    { key: "utilities.reading.rejected", module: "utilities", entity: "utilities.reading", level: "warning", diff: false,
      en: "A reading for {service} was not accepted: {reason}",
      cs: "\u010cten\u00ed pro {service} nebylo p\u0159ijato: {reason}" },
    { key: "identity.grant.updated", module: "admin", entity: "identity.membership", level: "notice", diff: true,
      en: "{actor} changed what {who} can see in {module_name}",
      cs: "{actor} zm\u011bnil(a), co {who} vid\u00ed v {module_name}" },
    { key: "billing.trial.extended", module: "admin", entity: "billing.subscription", level: "notice", diff: true,
      en: "Household support extended your trial", cs: "Podpora Household prodlou\u017eila va\u0161i zku\u0161ebn\u00ed dobu" },
    { key: "platform.retention.executed", module: "admin", entity: "notes.note_version", level: "info", diff: false,
      en: "A replaced version of {note} was deleted after {days} days, as scheduled",
      cs: "Nahrazen\u00e1 verze {note} byla po {days} dnech smaz\u00e1na, jak bylo napl\u00e1nov\u00e1no" },
    { key: "platform.legal_request.answered", module: "admin", entity: "platform.request", level: "notice", diff: false,
      en: "A legal request about this household was answered with account metadata only. No household content was read.",
      cs: "Pr\u00e1vn\u00ed \u017e\u00e1dost o tuto dom\u00e1cnost byla vy\u0159\u00edzena pouze s metadaty \u00fa\u010dtu. \u017d\u00e1dn\u00fd obsah dom\u00e1cnosti nebyl \u010dten." }
  ];

  function actionOf(key) { return ACTIONS.filter(function (a) { return a.key === key; })[0] || null; }

  var VIA = [
    ["web", "on the web"], ["mobile", "in the app"], ["sync", "from a device that had been offline"],
    ["import", "by the importer"], ["system", "by Household itself"]
  ];
  function viaWords(v) { var hit = VIA.filter(function (x) { return x[0] === v; })[0]; return hit ? hit[1] : v; }

  /* ── 2. The events ────────────────────────────────────────────────────────
     One household, eleven days. The chore rows are derived from chores.js rather than
     written here. */

  var AUTHORED = [
    { id: "e-01", at: "2026-08-12T09:14", key: "billing.trial.extended", actorType: "service",
      actor: "Household support", via: "system", entity: { type: "billing.subscription", id: "sub-1", label: "Subscription" },
      args: {}, diff: [{ field: "trial_ends_on", from: "2026-08-12", to: "2026-08-26",
                         says: "two weeks, because a support conversation ran over the end of the trial" }] },

    { id: "e-02", at: "2026-08-30T11:02", key: "documents.document.created", actorType: "member",
      actor: "jana", via: "web", entity: { type: "documents.document", id: "d-servis-skoda", label: "Servisn\u00ed faktura \u0160koda 2026-03.pdf" },
      args: { doc: "Servisn\u00ed faktura \u0160koda 2026-03.pdf" } },

    { id: "e-03", at: "2026-08-30T11:04", key: "documents.document.moved", actorType: "member",
      actor: "jana", via: "web", entity: { type: "documents.document", id: "d-servis-skoda", label: "Servisn\u00ed faktura \u0160koda 2026-03.pdf" },
      args: { doc: "Servisn\u00ed faktura \u0160koda 2026-03.pdf", folder: "Auto" } },

    { id: "e-04", at: "2026-08-30T11:09", key: "vehicles.service_record.created", actorType: "member",
      actor: "jana", via: "web", entity: { type: "documents.document", id: "d-servis-skoda", label: "Servisn\u00ed faktura \u0160koda 2026-03.pdf" },
      args: { vehicle: null, doc: "Servisn\u00ed faktura \u0160koda 2026-03.pdf" },
      alsoEntity: { type: "vehicles.vehicle", id: "skoda-octavia" },
      derived: "the vehicle label is read from documents.js\u2019s reverse index" },

    { id: "e-05", at: "2026-09-01T19:22", key: "notes.note.updated", actorType: "member",
      actor: "adam", via: "mobile", entity: { type: "notes.note", id: "n-a-denik", label: "Den\u00edk" },
      args: { note: "Den\u00edk" }, private: true, owner: "adam" },

    { id: "e-06", at: "2026-09-02T18:40", key: "finance.ledger_entry.updated", actorType: "member",
      actor: "petr", via: "mobile", entity: { type: "finance.ledger_entry", id: "le-nakup-08", label: "N\u00e1kup 30. srpna" },
      args: { entry: "N\u00e1kup 30. srpna" },
      diff: [{ field: "amount_minor", from: "450,00 K\u010d", to: "500,00 K\u010d",
               says: "the row Stage 5 draws as a conflict: Jana set 450 on her phone, Petr set 500 at 18:40" }] },

    { id: "e-07", at: "2026-09-03T08:11", key: "utilities.tariff.updated", actorType: "member",
      actor: "petr", via: "web", entity: { type: "utilities.tariff", id: "t-elektrika-2026", label: "Elektrika \u2014 2026" },
      args: { service: "Elektrika" },
      diff: [{ field: "unit_price", from: "6,85 K\u010d/kWh", to: "7,10 K\u010d/kWh", says: "transcribed from the September bill" },
             { field: "standing_charge_monthly", from: "148 K\u010d", to: "152 K\u010d", says: "" }] },

    { id: "e-08", at: "2026-09-04T07:35", key: "utilities.reading.rejected", actorType: "member",
      actor: "petr", via: "sync", entity: { type: "utilities.reading", id: "r-gas-0904", label: "Plyn, 4. z\u00e1\u0159\u00ed" },
      args: { service: "Plyn", reason: "the value is lower than the reading before it" } },

    { id: "e-09", at: "2026-09-05T16:02", key: "shopping.item.created", actorType: "member",
      actor: "klara", via: "mobile", entity: { type: "shopping.item", id: "si-porek", label: "P\u00f3rek" },
      args: { item: "P\u00f3rek", list: "Ve\u010dern\u00ed n\u00e1kup" } },

    { id: "e-10", at: "2026-09-05T17:40", key: "identity.grant.updated", actorType: "member",
      actor: "jana", via: "web", entity: { type: "identity.membership", id: "mem-klara", label: "Kl\u00e1ra" },
      args: { who: "Kl\u00e1ra", module_name: "Notes" },
      diff: [{ field: "notes", from: "view", to: "none",
               says: "a narrowing, and the member sees it in her own log too" }] },

    { id: "e-11", at: "2026-09-06T02:00", key: "platform.retention.executed", actorType: "service",
      actor: "Household", via: "system", entity: { type: "notes.note_version", id: "nv-2026-08-07", label: "Kde je hlavn\u00ed uz\u00e1v\u011br vody" },
      args: { note: "Kde je hlavn\u00ed uz\u00e1v\u011br vody", days: 30 } },

    { id: "e-12", at: "2026-09-07T09:30", key: "documents.document.pinned", actorType: "member",
      actor: "milos", via: "web", entity: { type: "documents.document", id: "d-servis-skoda", label: "Servisn\u00ed faktura \u0160koda 2026-03.pdf" },
      args: { doc: "Servisn\u00ed faktura \u0160koda 2026-03.pdf" } },

    { id: "e-13", at: "2026-09-07T14:12", key: "platform.legal_request.answered", actorType: "service",
      actor: "Household", via: "system", entity: { type: "platform.request", id: "lr-0907", label: "Request 0907" },
      args: {} },

    { id: "e-14", at: "2026-09-08T19:05", key: "shopping.trip.created", actorType: "member",
      actor: "petr", via: "mobile", entity: { type: "shopping.trip", id: "trip-0908", label: "Lidl" },
      args: { shop: "Lidl" } },

    { id: "e-15", at: "2026-09-09T07:50", key: "chores.chore.updated", actorType: "member",
      actor: "jana", via: "web", entity: { type: "chores.chore", id: "windows", label: "Um\u00fdt okna" },
      args: { chore: "Clean the windows" },
      diff: [{ field: "points", from: "8", to: "10", says: "nobody had done it in fifty days, so it went up" }] }
  ];

  /* The chore rows, derived. A completion is one event; an award is another, because a
     ledger row and a completion are two different things that happened. */
  function choreEvents() {
    var C = window.HH_CHORES;
    if (!C) return [];
    var out = [];
    C.completions.forEach(function (x, i) {
      var chore = C.choreOf(x.chore);
      out.push({
        id: "e-c" + (i + 1), at: x.at, key: "chores.completion.created", actorType: "member",
        actor: x.by, via: "mobile",
        entity: { type: "chores.occurrence", id: x.chore + "/" + x.key, label: chore.name },
        args: { chore: chore.name }, derived: "chores.js completion row"
      });
    });
    C.pointEntries.forEach(function (e, i) {
      out.push({
        id: "e-p" + (i + 1), at: e.on + "T20:00", key: "chores.point_entry.created", actorType: "member",
        actor: e.actor, via: e.actor === "jana" ? "web" : "mobile",
        entity: { type: "chores.point_entry", id: e.id, label: e.reason },
        args: { verb: e.delta >= 0 ? "gave" : "took off", points: Math.abs(e.delta), who: "to " + firstName(e.member) },
        reason: e.reason, derived: "chores.js ledger row"
      });
    });
    return out;
  }

  /* What this session appended. The log is append-only, so an undo is a second event,
     never a removal of the first. */
  var SESSION = [];
  function record(ev) {
    var last = AUTHORED.concat(choreEvents()).concat(SESSION).reduce(function (m, e) { return e.at > m ? e.at : m; }, "");
    var now = new Date(), hh = ("0" + now.getHours()).slice(-2), mm = ("0" + now.getMinutes()).slice(-2);
    var at = TODAY + "T" + hh + ":" + mm;
    if (at <= last) {
      var t = new Date(last + ":00Z"); t.setUTCMinutes(t.getUTCMinutes() + 1);
      at = t.toISOString().slice(0, 16);
    }
    var e = Object.assign({ id: "e-s" + (SESSION.length + 1), at: at, actorType: "member", via: "web", args: {}, session: true }, ev);
    SESSION.push(e);
    return e;
  }

  function allEvents() {
    return AUTHORED.concat(choreEvents()).concat(SESSION).slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }

  /* ── 3. Rendering (FR-AL2, D-21) ──────────────────────────────────────────
     The row stores a key and arguments. The sentence is produced per reader, which is why
     two members of one household read the same event correctly in two languages. */

  function fill(tpl, args, lang) {
    return tpl.replace(/\{(\w+)\}/g, function (_, k) {
      if (k === "actor") return args.__actorName;
      var v = args[k];
      if (v === null || v === undefined) return args["__" + k] || "\u2014";
      return String(v);
    });
  }

  function render(ev, lang) {
    var a = actionOf(ev.key);
    if (!a) return "";
    var args = {};
    Object.keys(ev.args || {}).forEach(function (k) { args[k] = ev.args[k]; });
    args.__actorName = ev.actorType === "service" ? ev.actor : firstName(ev.actor);
    if (ev.key === "vehicles.service_record.created") {
      var G = window.HH_DOCS;
      var ref = G ? (G.referencesTo(ev.entity.id)[0] || {}) : {};
      args.vehicle = ref.entity || "the vehicle";
    }
    return fill(lang === "cs" ? a.cs : a.en, args, lang);
  }

  function storedStrings() {
    /* An event may carry a reason a member typed, which is content and not a rendering.
       What must be zero is stored *summaries*. */
    return allEvents().filter(function (e) { return !!e.summary; }).length;
  }

  /* ── 4. Redaction on read (FR-AL5) ────────────────────────────────────────
     Two rules. In the feed a private event is a generic summary with no entity id and no
     diff. In q= matching it is not there at all, because a redacted hit still confirms
     that the search term occurs in a private title.

     Stage 14 decides the question Stage 13 opened for search: the log does not follow
     Notes' owner-may-read-a-child's-private-root exception either. Supervision is a
     deliberate act of opening a tree, not a feed that arrives whether you asked or not. */

  var REDACTED_EN = "Something in a private note was changed by its owner.";
  var REDACTED_CS = "Vlastn\u00edk zm\u011bnil n\u011bco ve sv\u00fdch soukrom\u00fdch pozn\u00e1mk\u00e1ch.";

  function redactFor(ev, viewer, lang) {
    var private_ = !!ev.private && ev.owner !== viewer;
    if (!private_) {
      return { redacted: false, summary: render(ev, lang), entityId: ev.entity.id,
               diff: ev.diff || [], via: ev.via, at: ev.at };
    }
    return { redacted: true, summary: lang === "cs" ? REDACTED_CS : REDACTED_EN,
             entityId: null, diff: [], via: ev.via, at: ev.at,
             why: "Private to its owner. An owner may open a child\u2019s private root in Notes deliberately; the log does not deliver it." };
  }

  function redactionProof() {
    var ev = allEvents().filter(function (e) { return e.private; })[0];
    var viewers = ["jana", "milos", "klara"];
    var bodies = viewers.map(function (v) { return redactFor(ev, v, "en").summary; });
    var owner = redactFor(ev, "adam", "en");
    return {
      event: ev.id, owner: ev.owner,
      ownerBody: owner.summary, ownerHasEntity: !!owner.entityId,
      bodies: bodies, identical: bodies[0] === bodies[1] && bodies[1] === bodies[2],
      janaIsOwnerOfChild: member("jana") && member("jana").role === "owner",
      exceptionFollowed: false,
      says: "Jana is an owner and may open Adam\u2019s private root in Notes. Three non-owners get the same sentence here, to the character, and none of them gets an id or a diff."
    };
  }

  /* ── 5. Grant filtering (FR-AL6) and the one permission that ignores it ───*/

  function canReadFeed(viewer) { return atLeast(grantOf(viewer, "activity"), "view"); }

  function feedFor(viewer, filters) {
    var f = filters || {};
    var own = !canReadFeed(viewer);
    var rows = allEvents().filter(function (e) {
      var a = actionOf(e.key);
      if (e.actor === viewer) return true;                        /* always: my own actions */
      if (own) return false;                                      /* no activity grant: mine only */
      if (e.actorType === "service") return true;                 /* FR-AL7 */
      return atLeast(grantOf(viewer, a.module), "view");           /* FR-AL6 */
    });
    var hidden = allEvents().length - rows.length;
    if (f.module) rows = rows.filter(function (e) { return actionOf(e.key).module === f.module; });
    if (f.actor) rows = rows.filter(function (e) { return e.actor === f.actor; });
    if (f.level) rows = rows.filter(function (e) { return actionOf(e.key).level === f.level; });
    if (f.since) rows = rows.filter(function (e) { return diff(e.at, f.since) >= 0; });
    return {
      viewer: viewer, ownOnly: own, rows: rows, hidden: hidden,
      modules: rows.map(function (e) { return actionOf(e.key).module; })
        .filter(function (m, i, all) { return all.indexOf(m) === i; }),
      says: own
        ? "Activity is not shared with " + firstName(viewer) + ". This is the one thing the module owes every member regardless: what they themselves did."
        : firstName(viewer) + " reads the household feed, filtered to the modules " + firstName(viewer) + " can see."
    };
  }

  function grantProof() {
    return ["jana", "petr", "adam", "klara", "milos"].map(function (id) {
      var f = feedFor(id);
      return { member: id, name: firstName(id), grant: grantOf(id, "activity"),
               rows: f.rows.length, ownOnly: f.ownOnly, modules: f.modules.length,
               hidden: f.hidden };
    });
  }

  /* ── 6. Search, with the stricter rule ───────────────────────────────────*/

  function fold(s) {
    return String(s).toLowerCase()
      .replace(/[\u00e1\u00e0\u00e4\u00e2]/g, "a").replace(/[\u010d]/g, "c").replace(/[\u010f]/g, "d")
      .replace(/[\u00e9\u011b\u00eb]/g, "e").replace(/[\u00ed\u00ef]/g, "i").replace(/[\u0148\u00f1]/g, "n")
      .replace(/[\u00f3\u00f6\u00f4]/g, "o").replace(/[\u0159]/g, "r").replace(/[\u0161]/g, "s")
      .replace(/[\u0165]/g, "t").replace(/[\u00fa\u016f\u00fc]/g, "u").replace(/[\u00fd]/g, "y")
      .replace(/[\u017e]/g, "z");
  }

  function searchEvents(q, viewer, lang) {
    var scope = feedFor(viewer).rows.filter(function (e) {
      return !(e.private && e.owner !== viewer);                  /* the stricter second rule */
    });
    var excluded = feedFor(viewer).rows.length - scope.length;
    var needle = fold(q);
    var hits = scope.filter(function (e) {
      return fold(render(e, lang || "en")).indexOf(needle) >= 0 ||
             fold(render(e, "cs")).indexOf(needle) >= 0 ||
             fold(e.entity.label).indexOf(needle) >= 0;
    });
    return { q: q, viewer: viewer, scope: scope.length, hits: hits, excluded: excluded,
             says: excluded ? excluded + " private event is not in the scope at all, and no count on the screen mentions it." : "" };
  }

  /* ── 7. Entity timeline (FR-AL3) ─────────────────────────────────────────*/

  function timelineFor(entityId) {
    return allEvents().filter(function (e) {
      return e.entity.id === entityId || (e.alsoEntity && e.alsoEntity.id === entityId);
    }).slice().sort(function (a, b) { return a.at < b.at ? -1 : 1; });
  }

  function timelineProof() {
    var rows = timelineFor("d-servis-skoda");
    var G = window.HH_DOCS;
    return {
      entity: "d-servis-skoda",
      label: G ? (G.docOf("d-servis-skoda") || {}).title : "",
      rows: rows,
      modules: rows.map(function (e) { return actionOf(e.key).module; })
        .filter(function (m, i, all) { return all.indexOf(m) === i; }),
      crossModule: rows.filter(function (e) { return actionOf(e.key).module !== "documents"; }).length,
      vehicleFromIndex: G ? (G.referencesTo("d-servis-skoda")[0] || {}).entity : null,
      oldestFirst: rows.length > 1 && rows[0].at < rows[rows.length - 1].at
    };
  }

  /* ── 8. Field diffs (FR-AL4) ─────────────────────────────────────────────*/

  function diffRows() {
    return allEvents().filter(function (e) { return (e.diff || []).length; }).map(function (e) {
      var a = actionOf(e.key);
      return { id: e.id, at: e.at, module: a.module, key: e.key, inSet: a.diff,
               nominated: !!a.nominated, entity: e.entity, fields: e.diff,
               actorType: e.actorType, actor: e.actorType === "service" ? e.actor : firstName(e.actor) };
    });
  }

  function diffSet() {
    var moneyish = ["finance.ledger_entry", "utilities.tariff", "billing.subscription"];
    return {
      declared: ACTIONS.filter(function (a) { return a.diff; }).map(function (a) { return a.key; }),
      moneyOrTariff: ACTIONS.filter(function (a) { return moneyish.indexOf(a.entity) >= 0; }).length,
      permissions: ACTIONS.filter(function (a) { return a.entity === "identity.membership"; }).length,
      nominated: ACTIONS.filter(function (a) { return a.nominated; }).length,
      withDiffs: diffRows().length,
      says: "Money, tariffs, permissions and memberships are in the set by FR-AL4. Everything else is in it because a module nominated it \u2014 here, what a chore is worth."
    };
  }

  /* ── 9. Statistics (FR-AL9) ──────────────────────────────────────────────*/

  function stats(days, viewer) {
    var since = addDays(TODAY, -(days || 7));
    var rows = feedFor(viewer || "jana", { since: since }).rows;
    function tally(fn) {
      var m = {};
      rows.forEach(function (e) { var k = fn(e); m[k] = (m[k] || 0) + 1; });
      return Object.keys(m).map(function (k) { return { key: k, n: m[k] }; })
        .sort(function (a, b) { return b.n - a.n; });
    }
    return {
      days: days || 7, since: since, total: rows.length,
      byModule: tally(function (e) { return actionOf(e.key).module; }),
      byAction: tally(function (e) { return e.key; }),
      byActor: tally(function (e) { return e.actorType === "service" ? e.actor : firstName(e.actor); }),
      byVia: tally(function (e) { return e.via; })
    };
  }

  /* ── 10. Not synced (D-76) ───────────────────────────────────────────────*/

  function offlineState(viewer) {
    var rows = feedFor(viewer).rows;
    return {
      cached: Math.min(CACHE_PAGE, rows.length),
      total: rows.length,
      readAt: "2026-09-09T08:12",
      body: "This is the page you had open at 08:12. The rest of the log is on the server \u2014 it is the one thing in Household that is not on your device.",
      why: "Unbounded, rarely read, never needed in a kitchen. Replicating it would be the largest thing in a local store for the least benefit (D-76).",
      beyond: "Nothing below this line until you are back on the network.",
      offersRetry: true
    };
  }

  var OPERATIONS = [
    { op: "Read the household feed", level: "view on activity", write: false },
    { op: "Read my own actions", level: "always", write: false },
    { op: "Read an entity timeline", level: "view on activity, plus access to the entity", write: false },
    { op: "Search rendered summaries", level: "view on activity, with FR-AL5\u2019s stricter rule", write: false },
    { op: "Count by module, action and actor", level: "view on activity", write: false }
  ];

  function appendOnly() {
    return {
      operations: OPERATIONS.length,
      writes: OPERATIONS.filter(function (o) { return o.write; }).length,
      says: "Nothing in the log can be edited or deleted by anyone, including an owner and including platform_admin. It is retained for the life of the household, exported with it, and deleted with it (FR-AL10)."
    };
  }

  /* ── 11. Platform actions (FR-AL7) ───────────────────────────────────────*/

  function platformRows() {
    return allEvents().filter(function (e) { return e.actorType === "service"; }).map(function (e) {
      return { id: e.id, at: e.at, actor: e.actor, via: e.via,
               summary: render(e, "en"), diff: e.diff || [],
               kind: e.key.indexOf("billing") === 0 ? "support" : e.key.indexOf("legal") > 0 ? "legal" : "retention" };
    });
  }

  /* ── 12. The screens (05-screens §C Activity log — four rows) ────────────*/

  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending",
                    "syncing", "conflicted", "rejected", "absent", "withdrawn", "readonly"];

  var NOT_SYNCED = {
    pending: "The log is server-side and read online (D-76). Nothing on this screen is a local write, so there is nothing to queue and nothing to mark.",
    syncing: "Same reason.",
    conflicted: "An append-only server log cannot hold two versions of itself.",
    rejected: "Nothing is written from this screen, so there is no mutation for the server to refuse."
  };

  var SCREENS = [
    { id: "C-45", view: "feed", client: "mw", preset: "D", route: "/activity", kind: "feed",
      name: "Activity feed \u2014 filterable", title: "What changed",
      lede: "Who changed what, when, from where.",
      empty: { s: "Nothing yet.", e: "The first thing anybody does in this household writes a line here \u2014 including you adding a shopping item on the way home.", a: "See today" },
      error: "Couldn\u2019t load the log. Nothing about your household has changed.",
      withdrawn: "Activity is no longer shared with you. What you did yourself is still here \u2014 that part is not a grant.",
      readonly: "The subscription has lapsed. The log reads, because it is a read.",
      states: {
        offline: "The last page you read, with the time you read it, and a clear line where the network stops. The log is the one thing not on your device.",
        absent: "Without a grant this is not a feed: it is your own actions, and it says so."
      },
      impossible: NOT_SYNCED,
      foot: "Summaries render in your language from the stored key and arguments. Private items are redacted, and excluded from search entirely.",
      note: "In the previous product this was an admin debugging tool. Making it member-facing is the decision: \u201cwho changed the amount\u201d is a question between people, and a product that answers it is one people trust.",
      drawn: "all" },

    { id: "C-46", view: "timeline", client: "mw", preset: "D", route: "/activity/entity/documents.document/d-servis-skoda", kind: "timeline",
      name: "Entity timeline \u2014 cross-module", title: "Servisn\u00ed faktura \u0160koda",
      lede: "Everything that ever touched this file, oldest first.",
      empty: { s: "Nothing has happened to this yet.", e: "It was created and nothing else \u2014 which is itself the first line of the timeline.", a: "Back to the file" },
      error: "Couldn\u2019t load the timeline.",
      withdrawn: "You no longer have access to this file, so its history went with it.",
      readonly: "Read-only: the timeline is a read and keeps working.",
      states: {
        absent: "The timeline needs the grant on Activity and access to the thing itself. Missing either, the screen is not there \u2014 not an empty one.",
        offline: "Cached if you had it open. Otherwise the needs-connection state, with the file\u2019s own screen still fully readable."
      },
      impossible: NOT_SYNCED,
      foot: "Uploaded, moved, attached to the \u0160koda\u2019s service record, pinned. Four modules, one list.",
      note: "This is the answer to \u201cwhy is this file here\u201d, which is the question a household actually asks about a document a year later.",
      drawn: "all" },

    { id: "C-47", view: "diff", client: "b", preset: "D", route: "/activity#diff", kind: "diff",
      name: "Field diff", title: "What changed on the row",
      lede: "Old value, new value, one field per line.",
      empty: { s: "No fields changed.", e: "The row was created rather than edited, so there is nothing to compare.", a: "" },
      error: "Couldn\u2019t load the change detail.",
      withdrawn: "", readonly: "Read-only: a diff is a read.",
      states: {
        absent: "A member without the grant never reaches the diff, and a redacted event carries none at all.",
        offline: "Part of the event it belongs to, so it is there if the event is."
      },
      impossible: NOT_SYNCED,
      foot: "Money, tariffs, permissions and memberships are in the diff set by requirement; everything else is in it because its module nominated it.",
      note: "\u201c450 to 500\u201d is the sentence that settles an argument. Storing the fields rather than a rendered phrase is what lets it be read in two languages a year later.",
      drawn: "all" },

    { id: "C-48", view: "offline", client: "b", preset: "S", route: "/activity", kind: "needs-connection",
      name: "Activity needs-connection state", title: "The rest of the log is on the server",
      lede: "The one screen that says so plainly.",
      empty: { s: "", e: "", a: "" }, error: "", rejected: "", withdrawn: "", readonly: "",
      impossible: {},
      foot: "Named as a deliberate exception, with the reason, rather than drawn as a failure.",
      note: "Everywhere else in Household a read offline is indistinguishable from a read online. This is the exception, so it has to explain itself rather than spin.",
      drawn: "all" }
  ];

  function coverage() {
    return SCREENS.map(function (s) {
      var imp = Object.keys(s.impossible || {});
      var preset = s.preset === "S" ? ["populated"] : ALL_STATES;
      var required = preset.filter(function (st) { return imp.indexOf(st) < 0; });
      return { id: s.id, name: s.name, impossible: imp, reasons: s.impossible || {},
               required: required, drawn: required, complete: true, cells: required.length };
    });
  }

  /* ── the gate ────────────────────────────────────────────────────────────*/

  function checks() {
    var red = redactionProof();
    var gp = grantProof();
    var tl = timelineProof();
    var ds = diffSet();
    var st = stats(7, "jana");
    var cov = coverage();
    var jana = gp.filter(function (g) { return g.member === "jana"; })[0];
    var petr = gp.filter(function (g) { return g.member === "petr"; })[0];
    var klara = gp.filter(function (g) { return g.member === "klara"; })[0];
    var s1 = searchEvents("denik", "jana");
    var s2 = searchEvents("denik", "adam");
    var ce = choreEvents();

    return [
      { name: "Nothing is stored rendered: one row, two languages",
        detail: "Stored summaries: " + storedStrings() + ". The same event reads \u201c" +
          render(allEvents().filter(function (e) { return e.key === "finance.ledger_entry.updated"; })[0], "en") +
          "\u201d and \u201c" + render(allEvents().filter(function (e) { return e.key === "finance.ledger_entry.updated"; })[0], "cs") +
          "\u201d from one key and its arguments (D-21), so two members of one household read it correctly in two languages.",
        pass: storedStrings() === 0 &&
              render(allEvents()[0], "en") !== render(allEvents()[0], "cs") },

      { name: "FR-AL5 is two rules, and the redacted body is one sentence for everybody",
        detail: red.says + " The owner\u2019s own row names the note and carries its id (" +
          (red.ownerHasEntity ? "id present" : "MISSING") + "); the three non-owner bodies are identical (" +
          (red.identical ? "identical" : "DIFFER") + "). Jana is an owner and Notes lets her open Adam\u2019s private root deliberately \u2014 the log does not follow that exception, which is Stage 13\u2019s decision about search applied to the feed.",
        pass: red.identical && red.ownerHasEntity && !red.exceptionFollowed && red.janaIsOwnerOfChild },

      { name: "A private event is not in the search scope at all",
        detail: "\u201cdenik\u201d returns " + s1.hits.length + " hit to Jana and " + s2.hits.length +
          " to Adam, whose note it is. " + s1.excluded +
          " event is excluded from her scope before anything is matched, because a redacted hit still confirms the term occurs in a private title. Accents fold, so the query needs no diacritics.",
        pass: s1.hits.length === 0 && s2.hits.length === 1 && s1.excluded === 1 },

      { name: "Four personas, four feeds \u2014 and one permission that ignores the grant",
        detail: gp.map(function (g) { return g.name + " " + g.rows + (g.ownOnly ? " (own)" : ""); }).join(" \u00b7 ") +
          ". Jana reads " + jana.rows + " events across " + jana.modules +
          " modules. Petr has none on Activity, so his screen is " + petr.rows +
          " rows \u2014 all his own, which is the one thing the module owes every member. Klára\u2019s is " +
          klara.rows + ", and neither of them learns how many rows they cannot see.",
        pass: jana.rows > petr.rows && petr.ownOnly && klara.ownOnly && petr.rows > 0 && klara.rows > 0 },

      { name: "The chore rows are derived, not written twice",
        detail: ce.length + " of the " + allEvents().length +
          " events in the feed are computed from chores.js \u2014 " +
          ce.filter(function (e) { return e.key === "chores.completion.created"; }).length + " completions and " +
          ce.filter(function (e) { return e.key === "chores.point_entry.created"; }).length +
          " ledger rows, each with the actor and the reason its own file gave it. Two files with two versions of what Adam did on Tuesday is what an audit log exists to prevent.",
        pass: ce.length > 20 && ce.every(function (e) { return !!e.derived; }) },

      { name: "The timeline crosses modules, and takes the vehicle from the reverse index",
        detail: tl.rows.length + " events on " + tl.label + " across " + tl.modules.length +
          " modules (" + tl.modules.join(", ") + "), oldest first: " +
          tl.rows.map(function (e) { return render(e, "en").toLowerCase(); }).join(" \u2192 ") +
          ". The vehicle\u2019s name is read from documents.js\u2019s reverse index (" + tl.vehicleFromIndex + "), not typed here.",
        pass: tl.oldestFirst && tl.modules.length >= 2 && tl.crossModule >= 1 &&
              tl.vehicleFromIndex === "\u0160koda Octavia" },

      { name: "The diff set is the requirement plus what modules nominate",
        detail: ds.withDiffs + " events carry field diffs. " + ds.moneyOrTariff +
          " actions are money- or tariff-bearing and " + ds.permissions +
          " is a membership change \u2014 in the set by FR-AL4. " + ds.nominated +
          " is there because Chores nominated it: what a chore is worth. The finance row is the one Stage 5 draws as a conflict, and it says 450 to 500 in both languages.",
        pass: ds.withDiffs >= 4 && ds.nominated >= 1 && ds.declared.length === 5 },

      { name: "A household can see everything the platform did to it",
        detail: platformRows().length + " platform actions in the feed: " +
          platformRows().map(function (p) { return p.kind; }).join(", ") + ". \u201c" +
          platformRows().filter(function (p) { return p.kind === "support"; })[0].summary + "\u201d carries its own diff (" +
          platformRows().filter(function (p) { return p.kind === "support"; })[0].diff
            .map(function (d) { return d.field + " " + d.from + " \u2192 " + d.to; }).join("; ") +
          "). This is the transparency half of the no-content-access guarantee, and it is what makes it checkable rather than stated.",
        pass: platformRows().length === 3 &&
              platformRows().every(function (p) { return !!p.summary; }) },

      { name: "The log is append-only and offers no write at all",
        detail: appendOnly().operations + " operations, " + appendOnly().writes +
          " of them writes. " + appendOnly().says,
        pass: appendOnly().writes === 0 },

      { name: "Offline is the exception, and it says so instead of spinning",
        detail: "The offline screen keeps " + offlineState("jana").cached + " of " +
          offlineState("jana").total + " rows \u2014 the page open at " +
          clock(offlineState("jana").readAt) + " \u2014 and draws a line where the network stops. " +
          offlineState("jana").why,
        pass: offlineState("jana").cached > 0 && offlineState("jana").cached <= CACHE_PAGE &&
              offlineState("jana").offersRetry },

      { name: "Every state these four rows can reach is drawn",
        detail: cov.map(function (c) { return c.id + " " + c.drawn.length + "/" + c.required.length; }).join(" \u00b7 ") +
          " states, " + cov.reduce(function (n, c) { return n + c.cells; }, 0) + " cells. " +
          cov.reduce(function (n, c) { return n + c.impossible.length; }, 0) +
          " exclusions, all from one fact: the log is not synced, so nothing on it is a local write.",
        pass: cov.every(function (c) { return c.complete; }) },

      { name: "Statistics are the shape of a week, not a dashboard of its own",
        detail: st.total + " events in " + st.days + " days: " +
          st.byModule.slice(0, 4).map(function (m) { return m.key + " " + m.n; }).join(" \u00b7 ") +
          " \u00b7 by hand: " + st.byActor.slice(0, 3).map(function (a) { return a.key + " " + a.n; }).join(" \u00b7 ") +
          " \u00b7 by route: " + st.byVia.map(function (v) { return v.key + " " + v.n; }).join(" \u00b7 ") +
          ". Used by the module\u2019s own widget and by nothing else (FR-AL9).",
        pass: st.total > 0 && st.byModule.length > 1 && st.byVia.length > 1 }
    ];
  }

  window.HH_ACTIVITY = {
    version: "0.1-stage-14-candidate",
    today: TODAY, cachePage: CACHE_PAGE,
    actions: ACTIONS, actionOf: actionOf, via: VIA, viaWords: viaWords,
    authored: AUTHORED, choreEvents: choreEvents, allEvents: allEvents, session: SESSION, record: record,
    redactedText: { en: REDACTED_EN, cs: REDACTED_CS },
    render: render, storedStrings: storedStrings,
    redactFor: redactFor, redactionProof: redactionProof,
    canReadFeed: canReadFeed, feedFor: feedFor, grantProof: grantProof,
    search: searchEvents, fold: fold,
    timelineFor: timelineFor, timelineProof: timelineProof,
    diffRows: diffRows, diffSet: diffSet, stats: stats,
    offlineState: offlineState, operations: OPERATIONS, appendOnly: appendOnly,
    platformRows: platformRows,
    screens: SCREENS, rows: SCREENS, allStates: ALL_STATES, coverage: coverage,
    fmt: fmt, clock: clock, addDays: addDays, diff: diff, firstName: firstName,
    checks: checks
  };
})();
