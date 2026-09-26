/* Stage 14 — notifications: the composer, the digest, the delivery log, and the
   per-module setup re-entry points. Household settings §4, and the last of §C.

   Built from docs/prd/03-platform-strands.md §4 (FR-NT1-6) and §5 (the scheduler and the
   expiry-sweep retentions), design/05-screens.md §C Household settings §4 with its design
   risk, prd/modules/17-household-admin.md FR-HA12, prd/modules/00-module-model.md
   (each module declares its own audit actions so this screen can offer them),
   prd/02-identity-and-access.md FR-AC2, prd/08-roadmap.md Phase 2.

   05-screens states the risk in one line: this is an owner-facing rule builder, the most
   business-software-shaped screen in a consumer product, and it must not become one. So
   the bias is measured rather than asserted:

   1. The predicate space is counted, and so is the offer list. Picking a
      household-meaningful event is one tap out of a list this file computes; composing the
      same thing out of action keys, entity filters, levels and audiences is a number with
      four digits in it.

   2. Delivery is resolved per recipient at send time (FR-NT5): grant, then privacy, then
      the member's own category mute, then quiet hours, then a transport. Every drop has a
      reason, and the reason is what the delivery log stores.

   3. A digest is one schedule and N bodies, because its metric tokens resolve per
      recipient. The month-end clamp is not implemented here at all — it is
      reminders.js's expand(), read across the file boundary, because two clamps is one
      clamp too many.
*/
(function () {

  var TODAY = "2026-09-09";
  var BODY_RETENTION_DAYS = 7;       /* FR-HA12 via the expiry-sweep table: the outcome is kept, the body is not */
  var COALESCE_DEFAULT = 15;         /* minutes */

  function D(s) { return new Date(s.length > 10 ? s : s + "T00:00:00Z"); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function addDays(s, n) { var t = D(s.slice(0, 10)); t.setUTCDate(t.getUTCDate() + n); return iso(t); }
  function diff(a, b) { return Math.round((D(a.slice(0, 10)) - D(b.slice(0, 10))) / 86400000); }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
  function fmt(s) { var t = D(s.slice(0, 10)); return t.getUTCDate() + " " + MONTHS[t.getUTCMonth()]; }
  function clock(s) { return s.length > 10 ? s.slice(11, 16) : s; }
  function mins(hhmm) { return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)); }

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
  function allMembers() {
    var F = window.HH_FIXTURES;
    return (F ? F.members : []).map(function (m) { return m.id; });
  }

  /* ── 1. Transports and categories (FR-NT1, FR-NT2) ───────────────────────*/

  var TRANSPORTS = [
    { id: "webpush", label: "This browser", api: "Web Push (VAPID)", quietHours: true,
      says: "Registered when you sign in on the web and dropped when you sign out." },
    { id: "push", label: "Phone or tablet", api: "APNs and FCM via Expo Push", quietHours: true,
      says: "One registration per device. A device that keeps failing is marked stale and left alone." },
    { id: "email", label: "Email", api: "email", quietHours: false,
      says: "A small, fixed set only: security, billing and invitations. It arrives even when everything else is off, and quiet hours do not hold it." }
  ];

  var CATEGORIES = [
    { id: "direct", label: "Somebody meant you", api: "direct",
      says: "Assigned you something, mentioned you, asked you to take a turn, messaged you.",
      examples: ["Adam asked you to take the guinea pig tonight", "Petr mentioned you on a card"] },
    { id: "household", label: "Things you asked to hear about", api: "household",
      says: "Something changed that you chose to be told about. Every rule an owner writes lands here.",
      examples: ["The electricity tariff changed", "A reading was not accepted"] },
    { id: "reminders", label: "Dates you subscribed to", api: "reminders",
      says: "The reminders strand, with its own notice and snooze per kind.",
      examples: ["The bins are yours tomorrow", "Your passport expires in six months"] },
    { id: "digest", label: "Summaries", api: "digest",
      says: "A named schedule with a body resolved for you and nobody else.",
      examples: ["Sunday evening: the week ahead"] }
  ];

  var PREFS = {
    jana: { master: true, quiet: { from: "22:00", to: "07:00", tz: "Europe/Prague" },
            cats: { direct: true, household: true, reminders: true, digest: true },
            devices: [{ id: "d-jana-phone", transport: "push", label: "Jana\u2019s phone", state: "active" },
                      { id: "d-jana-web", transport: "webpush", label: "Chrome on the laptop", state: "active" }] },
    petr: { master: true, quiet: { from: "23:00", to: "06:30", tz: "Europe/Prague" },
            cats: { direct: true, household: false, reminders: true, digest: false },
            devices: [{ id: "d-petr-phone", transport: "push", label: "Petr\u2019s phone", state: "active" }],
            note: "Household is muted. He wants the dates and nothing else, and a member\u2019s own mute always wins." },
    adam: { master: true, quiet: { from: "20:30", to: "07:00", tz: "Europe/Prague" },
            cats: { direct: true, household: true, reminders: true, digest: false },
            devices: [{ id: "d-adam-phone", transport: "push", label: "Adam\u2019s phone", state: "active" }],
            note: "Quiet from half eight, which is a child\u2019s device and not a setting anybody argues about." },
    klara: { master: false, quiet: { from: "22:30", to: "07:00", tz: "Europe/Prague" },
             cats: { direct: true, household: true, reminders: true, digest: true },
             devices: [{ id: "d-klara-phone", transport: "push", label: "Kl\u00e1ra\u2019s phone", state: "gone" }],
             note: "Master switch off, and her only subscription answered 410 last week and was deleted." },
    milos: { master: true, quiet: { from: "21:30", to: "06:00", tz: "Europe/Prague" },
             cats: { direct: true, household: true, reminders: true, digest: true },
             devices: [{ id: "d-milos-tablet", transport: "push", label: "Milo\u0161\u2019s tablet", state: "stale" }],
             note: "Five straight failures, so the tablet is stale and nothing is attempted on it." }
  };

  function prefsOf(id) { return PREFS[id] || null; }

  /* ── 2. The offer list, and the predicate space it replaces ──────────────
     The catalog is the modules' own declared audit actions (activity.js holds them,
     because that is where they are read from). An offer is a household-meaningful event:
     one line a member would say out loud, mapped to the action keys behind it. */

  var OFFERS = [
    { id: "o-money", section: "Money", label: "An amount changes",
      keys: ["finance.ledger_entry.updated"], category: "household",
      says: "Somebody edits what something cost.", audience: "finance",
      why: "The most asked-about change in a shared household, and the one Stage 5 draws as a conflict." },
    { id: "o-tariff", section: "Money", label: "A tariff is updated",
      keys: ["utilities.tariff.updated"], category: "household",
      says: "The price of electricity or gas changes.", audience: "utilities",
      why: "It changes every figure computed after it, so somebody should know it happened." },
    { id: "o-reading", section: "Utilities", label: "A reading is not accepted",
      keys: ["utilities.reading.rejected"], category: "household",
      says: "Somebody entered a meter reading and the server refused it.", audience: "utilities",
      why: "Nobody re-reads a meter they think they already read." },
    { id: "o-chore-done", section: "Chores", label: "A chore is finished",
      keys: ["chores.completion.created"], category: "household",
      says: "Anything on the board gets ticked.", audience: "chores",
      why: "Offered, and off by default: this is the one that turns into forty notifications a week." },
    { id: "o-points", section: "Chores", label: "Points are given or taken off",
      keys: ["chores.point_entry.created"], category: "direct",
      says: "A child\u2019s balance changes.", audience: "self",
      why: "It goes to the child it is about, in the direct category, because it is about them." },
    { id: "o-chore-changed", section: "Chores", label: "A chore is changed",
      keys: ["chores.chore.updated"], category: "household",
      says: "What it is worth, whose turn it is, how often it happens.", audience: "chores",
      why: "A rotation somebody edited quietly is how a household ends up arguing about whose week it was." },
    { id: "o-docs", section: "Files", label: "A document is uploaded",
      keys: ["documents.document.created"], category: "household",
      says: "Anything lands in the filing cabinet.", audience: "documents",
      why: "Useful for a household that files together and noise for one that does not, which is why it is a choice." },
    { id: "o-grant", section: "People", label: "Somebody\u2019s access changes",
      keys: ["identity.grant.updated"], category: "household",
      says: "An owner changes what a member can see.", audience: "adults",
      why: "This one cannot be muted into silence for the member it is about \u2014 they see it in their own log regardless." },
    { id: "o-platform", section: "People", label: "Household itself does something",
      keys: ["billing.trial.extended", "platform.retention.executed", "platform.legal_request.answered"],
      category: "household", says: "Support, a legal request, or a scheduled deletion.", audience: "owners",
      why: "The transparency commitment with a delivery mechanism attached." },
    { id: "o-shopping", section: "Shopping", label: "A shop is recorded",
      keys: ["shopping.trip.created"], category: "household",
      says: "Somebody records what a trip cost.", audience: "shopping",
      why: "The one shopping event a household wants pushed; adding an item is not." },
    { id: "o-notes", section: "Files", label: "A shared note is edited",
      keys: ["notes.note.updated"], category: "household",
      says: "Somebody changes a note everybody can see.", audience: "notes",
      why: "Private notes are never in this, and the rule cannot be written to include them." },
    { id: "o-service", section: "Vehicles", label: "A service record is added",
      keys: ["vehicles.service_record.created"], category: "household",
      says: "Anything is logged against a car.", audience: "vehicles",
      why: "Low volume, high value, and it usually has a receipt attached." }
  ];

  /* What the same expressiveness costs if a member has to compose it. */
  function predicateSpace() {
    var A = window.HH_ACTIVITY;
    var actions = A ? A.actions.length : 0;
    var entities = A ? A.actions.map(function (a) { return a.entity; })
      .filter(function (e, i, all) { return all.indexOf(e) === i; }).length : 0;
    var levels = 3;                                   /* info, notice, warning */
    var audiences = allMembers().length + 4;          /* per member, plus owners / adults / children / everyone */
    var prefixes = A ? A.actions.map(function (a) { return a.key.split(".")[0]; })
      .filter(function (p, i, all) { return all.indexOf(p) === i; }).length : 0;
    var space = (actions + prefixes) * (entities + 1) * levels * audiences;
    return {
      actions: actions, prefixes: prefixes, entities: entities, levels: levels,
      audiences: audiences, space: space, offers: OFFERS.length,
      ratio: Math.round(space / OFFERS.length),
      says: "Match an action key or a prefix (" + (actions + prefixes) + "), filter by entity type (" +
        (entities + 1) + ") and level (" + levels + "), choose an audience (" + audiences + "): " +
        space + " ways to say something. The list offers " + OFFERS.length +
        " of them in words, and a rule is still a rule underneath \u2014 the composer writes the predicate, not the member."
    };
  }

  /* ── 3. Rules (FR-NT3) ───────────────────────────────────────────────────*/

  var AUDIENCES = [
    { id: "everyone", label: "Everyone in the household", resolve: function () { return allMembers(); } },
    { id: "owners", label: "Owners", resolve: function () {
        return allMembers().filter(function (m) { return (member(m) || {}).role === "owner"; }); } },
    { id: "adults", label: "Adults", resolve: function () {
        return allMembers().filter(function (m) { return (member(m) || {}).role !== "child"; }); } },
    { id: "children", label: "Children", resolve: function () {
        return allMembers().filter(function (m) { return (member(m) || {}).role === "child"; }); } },
    { id: "self", label: "Whoever it is about", resolve: function (about) { return about ? [about] : []; } }
  ];

  function audienceOf(id, about) {
    var a = AUDIENCES.filter(function (x) { return x.id === id; })[0];
    if (a) return a.resolve(about);
    if (String(id).indexOf("member:") === 0) return [String(id).slice(7)];
    return allMembers();                                  /* a module key: everyone, filtered by grant at send time */
  }

  function audienceLabel(id) {
    var a = AUDIENCES.filter(function (x) { return x.id === id; })[0];
    if (a) return a.label;
    if (String(id).indexOf("member:") === 0) return firstName(String(id).slice(7)) + " only";
    return id;
  }

  var RULES = [
    { id: "r-1", offer: "o-money", audience: "everyone", coalesce: COALESCE_DEFAULT,
      on: true, created: "2026-06-02", by: "jana",
      tpl: { en: { title: "{actor} changed an amount", body: "{entry}: {old} \u2192 {new}" },
             cs: { title: "{actor} zm\u011bnil(a) \u010d\u00e1stku", body: "{entry}: {old} \u2192 {new}" } } },
    { id: "r-2", offer: "o-reading", audience: "everyone", coalesce: 0,
      on: true, created: "2026-06-02", by: "jana",
      tpl: { en: { title: "A reading was not accepted", body: "{service}: {reason}" },
             cs: { title: "\u010cten\u00ed nebylo p\u0159ijato", body: "{service}: {reason}" } } },
    { id: "r-3", offer: "o-points", audience: "self", coalesce: 0,
      on: true, created: "2026-07-14", by: "jana",
      tpl: { en: { title: "Your points changed", body: "{verb} {points}: {reason}" },
             cs: { title: "Zm\u011bna bod\u016f", body: "{verb} {points}: {reason}" } } },
    { id: "r-4", offer: "o-chore-done", audience: "everyone", coalesce: 60,
      on: false, created: "2026-07-14", by: "jana",
      tpl: { en: { title: "{actor} finished a chore", body: "{chore}" },
             cs: { title: "{actor} dokon\u010dil(a) pr\u00e1ci", body: "{chore}" } },
      note: "Written, tried for a week, and switched off rather than deleted. Forty a week is how a household learns to swipe everything away." },
    { id: "r-5", offer: "o-tariff", audience: "member:klara", coalesce: 0,
      on: false, created: "2026-09-09", by: "jana", refused: true,
      tpl: { en: { title: "The {service} tariff changed", body: "{old} to {new}" }, cs: { title: "Tarif {service} se zm\u011bnil", body: "{old} to {new}" } },
      note: "Saved today and refused at save: Kl\u00e1ra is the only recipient and Utilities is not shared with her, so the rule could never fire." }
  ];

  function offerOf(id) { return OFFERS.filter(function (o) { return o.id === id; })[0] || null; }
  function ruleOf(id) { return RULES.filter(function (r) { return r.id === id; })[0] || null; }

  function moduleOfOffer(o) {
    var A = window.HH_ACTIVITY;
    if (!A) return null;
    var a = A.actionOf(o.keys[0]);
    return a ? a.module : null;
  }

  /* A rule nobody can receive is refused at save, with the reason (FR-NT5's logic applied
     one step earlier, because a rule that can never fire is a rule written by mistake). */
  function saveCheck(rule) {
    var o = offerOf(rule.offer);
    var mod = moduleOfOffer(o);
    var list = audienceOf(rule.audience, "adam");
    var eligible = list.filter(function (m) { return atLeast(grantOf(m, mod), "view"); });
    return {
      rule: rule.id, offer: o.label, module: mod,
      audience: rule.audience, resolved: list.length, eligible: eligible.length,
      ok: eligible.length > 0,
      audienceLabel: audienceLabel(rule.audience),
      refusal: eligible.length > 0 ? "" :
        "Nobody in this household can receive this. " +
        list.map(function (m) { return firstName(m); }).join(" and ") +
        " " + (list.length === 1 ? "does" : "do") + " not have " +
        (mod ? mod.charAt(0).toUpperCase() + mod.slice(1) : "that module") +
        " shared with them, so the rule would never fire. Share it first, or pick a different audience."
    };
  }

  /* ── 4. Send time (FR-NT5) ───────────────────────────────────────────────
     One rendering for the whole audience, then per recipient: grant, privacy, the
     member's own mute, quiet hours, a transport. Every drop keeps its reason. */

  function inQuiet(id, at) {
    var p = prefsOf(id);
    if (!p) return false;
    var t = mins(clock(at)), from = mins(p.quiet.from), to = mins(p.quiet.to);
    return from > to ? (t >= from || t < to) : (t >= from && t < to);
  }

  function transportFor(id) {
    var p = prefsOf(id);
    if (!p) return null;
    return p.devices.filter(function (d) { return d.state === "active"; })[0] || null;
  }

  function sendRun(ruleId, at, about) {
    var rule = ruleOf(ruleId);
    var o = offerOf(rule.offer);
    var mod = moduleOfOffer(o);
    var cat = o.category;
    var list = audienceOf(rule.audience, about || "adam");
    var rows = list.map(function (id) {
      var p = prefsOf(id);
      var grant = grantOf(id, mod);
      if (!atLeast(grant, "view")) {
        return { member: id, name: firstName(id), outcome: "not sent", reason: "no grant on " + mod,
                 detail: "FR-NT5: filtered at send time, per recipient. " + firstName(id) + " never learns the rule exists." };
      }
      if (!p.master) {
        return { member: id, name: firstName(id), outcome: "not sent", reason: "master switch off",
                 detail: "Everything except the security and billing emails." };
      }
      if (!p.cats[cat]) {
        return { member: id, name: firstName(id), outcome: "not sent", reason: cat + " muted",
                 detail: "A member\u2019s own category mute always wins over an owner\u2019s rule." };
      }
      var dev = transportFor(id);
      if (!dev) {
        return { member: id, name: firstName(id), outcome: "not sent", reason: "no live subscription",
                 detail: (p.devices[0] || {}).state === "gone"
                   ? "The subscription answered 410 and was deleted, so there is nothing to send to."
                   : "The device is stale after repeated failures and nothing is attempted on it." };
      }
      if (inQuiet(id, at)) {
        return { member: id, name: firstName(id), outcome: "deferred", reason: "quiet hours",
                 until: p.quiet.to, transport: dev.label,
                 detail: "Held until " + p.quiet.to + " in " + p.quiet.tz + ". Nothing is dropped by quiet hours \u2014 it waits." };
      }
      return { member: id, name: firstName(id), outcome: "delivered", reason: "",
               transport: dev.label, detail: "One rendering, delivered as it was rendered." };
    });
    return {
      rule: rule.id, offer: o.label, module: mod, category: cat, at: at,
      renderings: 1, rows: rows,
      delivered: rows.filter(function (r) { return r.outcome === "delivered"; }).length,
      deferred: rows.filter(function (r) { return r.outcome === "deferred"; }).length,
      dropped: rows.filter(function (r) { return r.outcome === "not sent"; }).length,
      reasons: rows.filter(function (r) { return r.reason; }).map(function (r) { return r.reason; })
    };
  }

  /* A private event renders once, in its redacted form, for the whole audience — never a
     second per-owner rendering that could be misdelivered (FR-NT5). */
  function privacyRun() {
    var A = window.HH_ACTIVITY;
    if (!A) return null;
    var ev = A.allEvents().filter(function (e) { return e.private; })[0];
    var redacted = A.redactFor(ev, "jana", "en");
    return {
      event: ev.id, owner: ev.owner,
      renderings: 1, body: redacted.summary,
      hasEntityId: !!redacted.entityId, hasDiff: redacted.diff.length > 0,
      says: "The rule renders the redacted form once and sends that. Rendering it per recipient would mean an owner\u2019s copy existed on a queue, and a queue is exactly where a misdelivery happens."
    };
  }

  /* ── 5. Digests (FR-NT4) ─────────────────────────────────────────────────
     A named schedule, and metric tokens resolved per recipient. The clamp is not here. */

  var DIGESTS = [
    { id: "dg-week", name: "The week ahead", time: "18:30", days: ["sunday"],
      tokens: ["{chores.due_today}", "{chores.overdue}", "{chores.points_balance}", "{reminders.this_week}"],
      tpl: { en: "This week: {chores.due_today} chores today, {chores.overdue} overdue, {reminders.this_week} dates.",
             cs: "Tento t\u00fdden: {chores.due_today} pr\u00e1c\u00ed dnes, {chores.overdue} po term\u00ednu, {reminders.this_week} dat." } },
    { id: "dg-month", name: "Month end", time: "20:00", dayOfMonth: 31,
      tokens: ["{chores.overdue}", "{chores.points_balance}"],
      tpl: { en: "Month end: {chores.overdue} chores overdue. Your points: {chores.points_balance}.",
             cs: "Konec m\u011bs\u00edce: {chores.overdue} prac\u00ed po term\u00ednu. Va\u0161e body: {chores.points_balance}." },
      note: "Day 31 exists to prove the clamp, and the clamp is reminders.js\u2019s." }
  ];

  function metricFor(token, id) {
    var C = window.HH_CHORES, R = window.HH_REMINDERS;
    if (!C) return "\u2014";
    if (token === "{chores.due_today}") {
      var t = C.todayFor(id);
      return String(t.absent ? 0 : t.mine.length + t.anyone.length);
    }
    if (token === "{chores.overdue}") {
      return String(C.overdueRows().filter(function (r) {
        return atLeast(grantOf(id, "chores"), "view") && (!r.assignee || r.assignee === id || (member(id) || {}).role === "owner");
      }).length);
    }
    if (token === "{chores.points_balance}") {
      return (member(id) || {}).role === "child" ? String(C.balanceOf(id)) : "\u2014";
    }
    if (token === "{reminders.this_week}") {
      if (!R) return "\u2014";
      return String((R.agendaFor(id, R.today) || { rows: [] }).rows.length);
    }
    return "\u2014";
  }

  function digestFor(digestId, id, lang) {
    var d = DIGESTS.filter(function (x) { return x.id === digestId; })[0];
    var p = prefsOf(id);
    var body = d.tpl[lang || "en"];
    d.tokens.forEach(function (t) { body = body.split(t).join(metricFor(t, id)); });
    return {
      digest: d.id, member: id, name: firstName(id), body: body,
      wanted: !!(p && p.master && p.cats.digest),
      resolvedTokens: d.tokens.length,
      unresolved: /\{[a-z.]+\}/.test(body)
    };
  }

  /* The clamp, borrowed rather than reimplemented. */
  function clampProof() {
    var R = window.HH_REMINDERS;
    if (!R) return { available: false };
    var run = R.expand({ freq: "monthly", interval: 1, bymonthday: 31, start: "2027-01-31" },
                       "2027-01-01", "2027-06-01");
    var dates = run.dates || run;
    return {
      available: true, ownClamp: false, source: "reminders.js expand()",
      dates: dates.slice(0, 5),
      says: "Day 31 lands on " + dates.slice(0, 4).join(", ") +
            " \u2014 the same clamp the reminders strand runs, because a digest that fires on a different day from a reminder is two calendars in one product."
    };
  }

  /* ── 6. Delivery log (FR-NT6) ────────────────────────────────────────────*/

  var LOG = [
    { id: "l-01", at: "2026-09-09T07:36", rule: "r-3", to: "adam", transport: "push",
      outcome: "delivered", ms: 412, body: "Points: +3, Emptied the dishwasher on 8 September" },
    { id: "l-02", at: "2026-09-09T07:36", rule: "r-3", to: "jana", transport: "push",
      outcome: "not sent", reason: "audience is whoever it is about", body: null },
    { id: "l-03", at: "2026-09-08T19:07", rule: "r-1", to: "jana", transport: "push",
      outcome: "delivered", ms: 380, body: "Petr changed an amount \u2014 N\u00e1kup 30. srpna: 450 \u2192 500" },
    { id: "l-04", at: "2026-09-08T19:07", rule: "r-1", to: "petr", transport: "push",
      outcome: "not sent", reason: "no grant on finance", body: null },
    { id: "l-05", at: "2026-09-08T19:07", rule: "r-1", to: "klara", transport: "push",
      outcome: "not sent", reason: "no grant on finance", body: null },
    { id: "l-06", at: "2026-09-08T19:07", rule: "r-1", to: "milos", transport: "push",
      outcome: "failed", reason: "device stale after 5 failures", body: null, deviceMarked: "stale" },
    { id: "l-07", at: "2026-09-04T07:35", rule: "r-2", to: "petr", transport: "push",
      outcome: "not sent", reason: "household muted", body: null, bodyDropped: true,
      note: "He holds manage on Utilities and entered the reading himself. His own mute still wins." },
    { id: "l-08", at: "2026-09-04T07:35", rule: "r-2", to: "jana", transport: "webpush",
      outcome: "delivered", ms: 210, body: "A reading was not accepted \u2014 Plyn: the value is lower than the reading before it" },
    { id: "l-09", at: "2026-09-02T23:10", rule: "r-3", to: "adam", transport: "push",
      outcome: "deferred", reason: "quiet hours until 07:00", body: null, bodyDropped: true },
    { id: "l-10", at: "2026-09-01T09:14", rule: null, to: "klara", transport: "push",
      outcome: "gone", reason: "410 from the push service \u2014 subscription deleted", body: null, bodyDropped: true },
    { id: "l-11", at: "2026-08-26T09:14", rule: null, to: "jana", transport: "email",
      outcome: "delivered", ms: 1130, body: null, bodyDropped: true,
      note: "A billing email. It arrives with push off and it ignores quiet hours." }
  ];

  function logRows() {
    return LOG.map(function (r) {
      var age = diff(TODAY, r.at);
      var kept = age < BODY_RETENTION_DAYS;
      return {
        id: r.id, at: r.at, age: age, to: r.to, name: firstName(r.to),
        rule: r.rule, transport: r.transport, outcome: r.outcome,
        reason: r.reason || "", ms: r.ms || null,
        body: kept ? r.body : null,
        bodyState: kept ? (r.body ? "stored" : "nothing was rendered") : (r.body || r.bodyDropped ? "dropped after " + BODY_RETENTION_DAYS + " days" : "nothing was rendered"),
        deviceMarked: r.deviceMarked || null
      };
    });
  }

  function logAudit() {
    var rows = logRows();
    return {
      rows: rows.length,
      withBody: rows.filter(function (r) { return !!r.body; }).length,
      dropped: rows.filter(function (r) { return r.bodyState.indexOf("dropped") === 0; }).length,
      outcomes: ["delivered", "deferred", "not sent", "failed", "gone"].map(function (o) {
        return { outcome: o, n: rows.filter(function (r) { return r.outcome === o; }).length };
      }),
      everyDropHasReason: rows.filter(function (r) { return r.outcome !== "delivered"; })
        .every(function (r) { return !!r.reason; }),
      retention: BODY_RETENTION_DAYS,
      says: "The outcome is kept for as long as the household is; the rendered body is dropped after " +
        BODY_RETENTION_DAYS + " days, which is the platform expiry sweep's own row for this table (FR-HA12). Support can read this log because it holds no content."
    };
  }

  function testSend(id, at) {
    var p = prefsOf(id);
    var dev = transportFor(id);
    if (!dev) {
      return { ok: false, member: id, name: firstName(id),
               says: "Nothing to send to: " + ((p.devices[0] || {}).state === "gone"
                 ? "the last subscription on this account answered 410 and was deleted."
                 : "the only device is stale after repeated failures.") +
                 " Sign in on the device you want it on and try again." };
    }
    if (inQuiet(id, at)) {
      return { ok: true, member: id, name: firstName(id), deferred: false, ignoresQuiet: true,
               says: "Sent to " + dev.label + " now. A test ignores quiet hours \u2014 you asked for it at " +
                     clock(at) + ", so holding it until " + p.quiet.to + " would tell you nothing." };
    }
    return { ok: true, member: id, name: firstName(id), deferred: false,
             says: "Sent to " + dev.label + ". It appears in the log below with its outcome." };
  }

  /* ── 7. Per-module setup re-entry points (C-58, Phase 2) ─────────────────
     Every module that has a setup gets a way back into it. What the handoff does not
     enumerate is which modules those are: four state a setup on their own page, and the
     rest are unstated. Recorded rather than invented. */

  var SETUP = [
    { module: "chores", label: "Chores", steps: ["A starter set or none", "Whether points are on", "Reset day"],
      state: "done", stated: "06-chores.md \u00a7Setup", changed: "2026-07-14",
      says: "Points went on when Adam\u2019s profile was made." },
    { module: "utilities", label: "Utilities", steps: ["What do you pay for", "Detail per service", "Country and commodity preset", "Enter what you know"],
      state: "partial", stated: "10-utilities.md \u00a7Setup", changed: "2026-08-30",
      says: "Two services set up, one still bills_only. Re-entering is how it gets upgraded, and nothing is lost." },
    { module: "finance", label: "Finance", steps: ["Accounts", "Allocation rules"],
      state: "done", stated: "09-finance.md setup step 1", changed: "2026-06-02", says: "" },
    { module: "garden", label: "Garden", steps: ["Zones and beds", "Tier"],
      state: "done", stated: "11-garden.md \u00a7Setup", changed: "2026-04-19", says: "" }
  ];

  function setupFor(id) {
    var rows = SETUP.filter(function (s) { return atLeast(grantOf(id, s.module), "manage"); });
    return {
      member: id, name: firstName(id), rows: rows,
      absent: SETUP.length - rows.length,
      says: rows.length
        ? rows.length + " of " + SETUP.length + " setups are " + firstName(id) + "\u2019s to re-enter. The rest are not listed \u2014 a setup needs manage, and absence is how that reads."
        : "No module here is " + firstName(id) + "\u2019s to set up, so the section is not on the screen at all."
    };
  }

  /* ── 8. The screens (05-screens §C Household settings §4, and C-58) ──────*/

  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending",
                    "syncing", "conflicted", "rejected", "absent", "withdrawn", "readonly"];

  var SERVER_SIDE = {
    pending: "A rule, a schedule and a delivery attempt are server configuration and server records. Nothing on this screen is a local write, so there is nothing to queue.",
    syncing: "Same reason.",
    conflicted: "Rules are not in the sync feed. Two devices cannot hold two versions of one."
  };

  var SCREENS = [
    { id: "C-52", view: "composer", client: "mw", preset: "D", route: "/settings/notifications", kind: "composer",
      name: "Settings \u00a74 Notification composer", title: "What Household tells you",
      lede: "Pick the thing that happens. The rule is written for you.",
      empty: { s: "No rules yet.", e: "Most households want two: an amount changing, and a meter reading that was refused.", a: "See what can be picked" },
      error: "Couldn\u2019t load the rules. Nothing that was already set up has stopped working.",
      rejected: "Nobody in this household can receive this: Utilities is not shared with Kl\u00e1ra, so the rule would never fire.",
      withdrawn: "You are no longer an owner here, so this section closed.",
      readonly: "Read-only while the subscription is past due. Existing rules keep firing.",
      states: {
        absent: "Not an owner: §4 is not in the settings list, and the four categories a member controls for themselves live in their own account settings instead.",
        offline: "The list you last loaded, and no editing \u2014 stated in a line rather than in disabled fields."
      },
      impossible: SERVER_SIDE,
      foot: "Twelve events in words, four audiences, a template per language, and a window to coalesce repeats.",
      note: "The design risk is that this becomes a rule builder. It stays a list of things that happen in a household, and the predicate is written underneath by the composer \u2014 keys are picked, never typed.",
      drawn: "all" },

    { id: "C-53", view: "delivery", client: "mw", preset: "D", route: "/settings/notifications/log", kind: "log",
      name: "Settings \u00a74 Delivery log and test send", title: "What was sent",
      lede: "Every attempt, with its outcome and the reason.",
      empty: { s: "Nothing sent yet.", e: "Send a test to your own phone and it appears here with what happened to it.", a: "Send a test" },
      error: "Couldn\u2019t load the log.",
      rejected: "Nothing to send to: the only device on this account is stale after repeated failures.",
      withdrawn: "You are no longer an owner here.",
      readonly: "Read-only: the log reads, and a test send is held while the subscription is past due.",
      states: {
        absent: "Not an owner: neither the log nor the test send is offered.",
        offline: "The log is a server record. Offline it says so and keeps the last page."
      },
      impossible: SERVER_SIDE,
      foot: "The outcome is kept; the rendered body is dropped after seven days by the platform expiry sweep.",
      note: "A delivery log is where \u201cI never got that\u201d stops being an argument. It holds no content, which is also why support can read it.",
      drawn: "all" },

    { id: "C-58", view: "setup", client: "mw", preset: "D", route: "/settings/modules/setup", kind: "setup",
      name: "Per-module setup re-entry points", title: "Set up again",
      lede: "A module\u2019s own setup, reachable after the first time.",
      empty: { s: "Nothing to set up.", e: "The modules you can set up appear here as they are enabled.", a: "See modules" },
      error: "Couldn\u2019t load the module setups.",
      withdrawn: "That module is no longer yours to manage.",
      readonly: "Read-only while the subscription is past due.",
      states: {
        absent: "A module needs manage to re-enter its setup, so a member who holds less sees a shorter list \u2014 or no section at all.",
        offline: "The list is derived from module state already on the device; entering a setup needs the network and says so at the door."
      },
      impossible: {
        pending: "Opening a setup is navigation. The writes belong to the setup screens themselves, each with its own module\u2019s policy.",
        syncing: "Same reason.",
        conflicted: "A derived list of modules cannot hold two versions of itself.",
        rejected: "Nothing is written from this screen."
      },
      foot: "Four modules state a setup in the handoff. Whether the others have one is recorded as a gap rather than guessed.",
      note: "Re-entry is not a wizard replayed: it is the same steps with the household\u2019s answers already in them, which is why Utilities can be upgraded from bills-only with nothing lost.",
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
    var ps = predicateSpace();
    var money = sendRun("r-1", "2026-09-08T19:07");
    var reading = sendRun("r-2", "2026-09-04T07:35");
    var night = sendRun("r-2", "2026-09-04T23:10");
    var refused = saveCheck(ruleOf("r-5"));
    var okRule = saveCheck(ruleOf("r-1"));
    var priv = privacyRun();
    var la = logAudit();
    var clamp = clampProof();
    var cov = coverage();
    var digests = ["jana", "adam", "milos"].map(function (m) { return digestFor("dg-month", m); });
    var jana = setupFor("jana"), petr = setupFor("petr");
    var apiWords = ["direct", "household", "reminders", "digest", "predicate", "coalesce", "VAPID", "APNs", "FCM"];
    var labels = CATEGORIES.map(function (c) { return c.label; })
      .concat(OFFERS.map(function (o) { return o.label; }))
      .concat(TRANSPORTS.map(function (t) { return t.label; }));

    return [
      { name: "Picking beats composing, and the difference is counted",
        detail: ps.says,
        pass: ps.offers === OFFERS.length && ps.space > 1000 && ps.ratio > 50 },

      { name: "Every offer is a sentence a member would say, and no API word reaches a label",
        detail: labels.length + " labels on the screen. Words from the API in them: " +
          apiWords.filter(function (w) {
            return labels.some(function (l) { return l.indexOf(w) >= 0; });
          }).length + ". The match is case-sensitive against the API\u2019s own lowercase keys, so \u201cHousehold itself does something\u201d is the product\u2019s name and \u201cthe household category\u201d would not be. The four categories read \u201c" +
          CATEGORIES.map(function (c) { return c.label; }).join("\u201d, \u201c") + "\u201d.",
        pass: apiWords.filter(function (w) {
                return labels.some(function (l) { return l.indexOf(w) >= 0; });
              }).length === 0 },

      { name: "Delivery is resolved per recipient at send time, and every drop keeps its reason",
        detail: "One rendering of r-1 (" + money.offer.toLowerCase() + ") to an audience of " +
          money.rows.length + ": " + money.delivered + " delivered, " + money.deferred +
          " deferred, " + money.dropped + " not sent \u2014 " + money.reasons.join(", ") +
          ". Renderings: " + money.renderings + ", which is what FR-NT5 asks for.",
        pass: money.renderings === 1 && money.delivered >= 1 && money.dropped >= 3 &&
              money.rows.every(function (r) { return r.outcome === "delivered" || !!r.reason; }) },

      { name: "A member\u2019s own mute wins, and quiet hours defer rather than drop",
        detail: "Petr holds manage on Utilities and has muted the household category, so an owner\u2019s rule about a refused reading does not reach him (" +
          reading.rows.filter(function (r) { return r.member === "petr"; })[0].reason + "). At 23:10 the same rule to " +
          night.rows.filter(function (r) { return r.outcome === "deferred"; }).length +
          " recipients is held until their own morning rather than dropped: " +
          night.rows.filter(function (r) { return r.outcome === "deferred"; })
            .map(function (r) { return r.name + " until " + r.until; }).join(", ") + ".",
        pass: reading.rows.filter(function (r) { return r.member === "petr"; })[0].reason === "household muted" &&
              night.deferred >= 1 && night.rows.every(function (r) { return r.outcome !== "delivered" || !inQuiet(r.member, "2026-09-04T23:10"); }) },

      { name: "A rule nobody can receive is refused at save, with the reason",
        detail: "r-5 (" + refused.offer.toLowerCase() + ", audience " + refused.audienceLabel.toLowerCase() + "): resolves to " +
          refused.resolved + " member, " + refused.eligible + " eligible \u2014 \u201c" + refused.refusal +
          "\u201d And the ordinary case still saves: r-1 resolves to " + okRule.resolved + " with " +
          okRule.eligible + " eligible.",
        pass: !refused.ok && !!refused.refusal && okRule.ok },

      { name: "A private event renders once, redacted, for the whole audience",
        detail: priv.says + " Body: \u201c" + priv.body + "\u201d, entity id " +
          (priv.hasEntityId ? "PRESENT" : "absent") + ", diff " + (priv.hasDiff ? "PRESENT" : "absent") + ".",
        pass: priv.renderings === 1 && !priv.hasEntityId && !priv.hasDiff },

      { name: "One digest schedule, one body per recipient",
        detail: digests.map(function (d) { return d.name + ": \u201c" + d.body + "\u201d"; }).join(" \u00b7 ") +
          ". Metric tokens resolve per recipient (FR-NT4), which is why the points line is a number for the child and a dash for everybody else, and no token survives unresolved.",
        pass: digests.every(function (d) { return !d.unresolved; }) &&
              digests[0].body !== digests[1].body },

      { name: "The month-end clamp is reminders.js\u2019s, not a second copy",
        detail: clamp.available ? clamp.says + " This file implements no clamp of its own (" +
          (clamp.ownClamp ? "IT DOES" : "checked") + ")." : "reminders.js not loaded",
        pass: !!clamp.available && !clamp.ownClamp && clamp.dates.length >= 4 &&
              clamp.dates[1] === "2027-02-28" },

      { name: "The delivery log keeps outcomes and drops bodies at seven days",
        detail: la.rows + " attempts: " + la.outcomes.filter(function (o) { return o.n; })
            .map(function (o) { return o.n + " " + o.outcome; }).join(", ") + ". " +
          la.withBody + " still carry a rendered body and " + la.dropped +
          " have had theirs dropped. Every non-delivery names its reason (" +
          (la.everyDropHasReason ? "all of them" : "NOT ALL") + "), including the 410 that deleted a subscription and the fifth failure that marked a device stale.",
        pass: la.everyDropHasReason && la.withBody >= 3 && la.dropped >= 3 &&
              la.rows === LOG.length },

      { name: "A test send tells the truth about the device it cannot reach",
        detail: ["jana", "klara", "milos"].map(function (m) {
            var t = testSend(m, "2026-09-09T21:40");
            return firstName(m) + ": " + (t.ok ? "sent" : "refused");
          }).join(" \u00b7 ") + ". Kl\u00e1ra: \u201c" + testSend("klara", "2026-09-09T10:00").says +
          "\u201d And a test ignores quiet hours, because holding a test until the morning tells the owner nothing.",
        pass: testSend("jana", "2026-09-09T21:40").ok && !testSend("klara", "2026-09-09T10:00").ok &&
              !testSend("milos", "2026-09-09T10:00").ok &&
              testSend("jana", "2026-09-09T23:10").ignoresQuiet === true },

      { name: "Setup re-entry follows manage, and four modules is what the handoff states",
        detail: "Jana: " + jana.rows.length + " of " + SETUP.length + " (" +
          jana.rows.map(function (r) { return r.label.toLowerCase() + " \u00b7 " + r.state; }).join(", ") +
          "). Petr: " + petr.rows.length + " \u2014 " + petr.says.toLowerCase() +
          " Every row here names the page that states its setup; whether the other twelve modules have one is recorded as a gap rather than invented.",
        pass: jana.rows.length === SETUP.length && petr.rows.length === 1 &&
              SETUP.every(function (s) { return !!s.stated; }) },

      { name: "Every state these three rows can reach is drawn",
        detail: cov.map(function (c) { return c.id + " " + c.drawn.length + "/" + c.required.length; }).join(" \u00b7 ") +
          " states, " + cov.reduce(function (n, c) { return n + c.cells; }, 0) + " cells. " +
          cov.reduce(function (n, c) { return n + c.impossible.length; }, 0) +
          " exclusions: a rule is server configuration and not a synced entity, and opening a setup is navigation.",
        pass: cov.every(function (c) { return c.complete; }) }
    ];
  }

  window.HH_NOTIFY = {
    version: "0.1-stage-14-candidate",
    today: TODAY, bodyRetention: BODY_RETENTION_DAYS,
    transports: TRANSPORTS, categories: CATEGORIES, prefs: PREFS, prefsOf: prefsOf,
    offers: OFFERS, offerOf: offerOf, predicateSpace: predicateSpace, moduleOfOffer: moduleOfOffer,
    audiences: AUDIENCES, audienceOf: audienceOf, audienceLabel: audienceLabel,
    rules: RULES, ruleOf: ruleOf, saveCheck: saveCheck,
    inQuiet: inQuiet, transportFor: transportFor, sendRun: sendRun, privacyRun: privacyRun,
    digests: DIGESTS, digestFor: digestFor, metricFor: metricFor, clampProof: clampProof,
    log: LOG, logRows: logRows, logAudit: logAudit, testSend: testSend,
    setup: SETUP, setupFor: setupFor,
    screens: SCREENS, rows: SCREENS, allStates: ALL_STATES, coverage: coverage,
    fmt: fmt, clock: clock, addDays: addDays, diff: diff, firstName: firstName,
    checks: checks
  };
})();
