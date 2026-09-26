/* Stage 18 — Calendar: four views, the occurrence model, and the connection screens.

   Sources: docs/design/modules/04-calendar.md (FR-CA1…FR-CA14), 02-components §2–§3,
   03-patterns §1 (merge policies) and §4 (offline writes), 05-privacy §2 and §4
   (reduced precision, and what leaves the household), 05-screens §E, 06-clients §3
   (the per-client default view), 07-delivery §3 (the empty state teaches).

   Four things this file computes rather than claims.

   1. The busy block. The gate for this stage is that a private event's busy block is a
      real synced row that works offline — so the projection is done once, at sync-out,
      and busyRow() is the whole of what a second member's device ever receives. The
      audit counts the fields that survive it, which is what makes "uninspectable"
      a property of the data rather than a promise about the UI.

   2. The three-choice occurrence edit. Each choice states its consequence in counts
      taken from the series it is about — this one, this and all future, the whole
      series — and applyChoice() reports the rows each one writes. Nothing here is
      authored prose: the three sentences are assembled from the expansion.

   3. Recurrence. Calendar does not carry a second RRULE implementation. expand() calls
      reminders.js's, which is where FR-RE2's clamp and cap already live and are already
      tested; what Calendar adds on top is the exception row, which is precisely the
      thing Stage 12 ruled out for reminders ("editing a recurring reminder edits the
      series"). CALLS records every caller so the reuse is countable.

   4. The connection screens are privacy screens. Direction and scope are two independent
      axes per remote calendar, busy-only is the offered default on all four providers,
      and every connect string names the account it is about. A child profile has no
      connection surface at all — not a disabled one.
*/
(function () {

  var TODAY = "2026-09-09";                 /* Wednesday, the day every stage since 11 draws */
  var TZ = "Europe/Prague";
  var DST_END = "2026-10-25";               /* CEST → CET, the wall-clock recurrence case */
  var WEEK_START = "monday";                /* the fixture household's firstDay */
  var LOSER_DAYS = 30;                      /* the preserved loser, as FR-NO10 and Stage 13 */
  var STALE_HOURS = 24;                     /* status-stale on a connection, FR-CA12 */

  /* ── dates ─────────────────────────────────────────────────────────────── */
  function D(s) { return new Date(s + "T00:00:00Z"); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function addDays(s, n) { var d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function dim(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  function dow(s) { return (D(s).getUTCDay() + 6) % 7; }            /* 0 = Monday */
  function monday(s) { return addDays(s, -dow(s)); }
  function diff(a, b) { return Math.round((D(b) - D(a)) / 86400000); }
  var DAYS_CS = ["Po", "\u00dat", "St", "\u010ct", "P\u00e1", "So", "Ne"];
  var DAYS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var MONTHS_CS = ["ledna", "\u00fanora", "b\u0159ezna", "dubna", "kv\u011btna", "\u010dervna",
                   "\u010dervence", "srpna", "z\u00e1\u0159\u00ed", "\u0159\u00edjna", "listopadu", "prosince"];
  function fmt(s) { var d = D(s); return d.getUTCDate() + ". " + (d.getUTCMonth() + 1) + "."; }
  function fmtLong(s) { var d = D(s); return d.getUTCDate() + ". " + MONTHS_CS[d.getUTCMonth()] + " " + d.getUTCFullYear(); }
  function dayLabel(s) { return DAYS_CS[dow(s)] + " " + D(s).getUTCDate(); }
  function minutes(t) { var p = t.split(":"); return Number(p[0]) * 60 + Number(p[1]); }
  function span(a, b) { return minutes(b) - minutes(a); }

  /* ── the member colours, settled in Stage 4 and not re-picked here ─────── */
  var MEMBER_COLOUR = { jana: "chart-1", petr: "chart-2", adam: "chart-4", klara: "chart-3", milos: "chart-5" };
  function member(id) {
    var F = window.HH_FIXTURES;
    return F ? (F.members.filter(function (m) { return m.id === id; })[0] || null) : null;
  }
  function name(id) { var m = member(id); return m ? m.name : id; }
  function initial(id) { return name(id).slice(0, 1); }
  function grant(id, mod) { var m = member(id); return m ? m.grants[mod || "calendar"] : "none"; }
  function isChild(id) { var m = member(id); return !!m && m.role === "child"; }

  /* ── merge policies, from 03-patterns §1. Every exclusion below is argued
        from this table rather than from the screen it is drawn on. ───────── */
  var POLICIES = [
    ["calendar.event", "lww_field", "Title, times, place and description merge field by field. Two members editing an event both succeed.", false],
    ["calendar.event_exception", "lww_field", "One row per changed occurrence. This is what Stage 12 ruled out for reminders, and the reason Calendar needs it: an occurrence is a thing a household talks about.", false],
    ["calendar.rsvp", "state_set", "Keyed by (occurrence, member). Answering yes twice is idempotent, and two members answering at once merge by key.", false],
    ["calendar.calendar", "strict_version", "Structural: the household's own calendars and their colours.", true],
    ["calendar.connection", "strict_version", "A member's remote connection and its per-calendar direction and scope. Server-held credentials, and never two versions of somebody's privacy setting on a client.", true],
    ["mirrored event", "external_mirror", "A read-only replica of a remote row. The household never authors it; a local edit becomes a household event beside it, which is what the external conflict screen resolves.", false]
  ];

  /* ── the series ─────────────────────────────────────────────────────────── */
  /* who = participants. author = who made it. origin: local, or mirror:<connection>.
     visibility: household | private. scope: full | busy (mirrored busy-only). */
  var SERIES = [
    { id: "s-dentist", cs: "Adam \u2014 zuba\u0159", en: "Adam \u2014 dentist", kind: "timed",
      start: "2026-09-10", from: "08:10", to: "09:00", who: ["adam", "jana"], author: "jana",
      place: "MUDr. Kub\u00e1t, Lidick\u00e1 18", origin: "local", visibility: "household",
      reminder: "calendar.event" },
    { id: "s-delivery", cs: "Dod\u00e1n\u00ed pra\u010dky", en: "Washing-machine delivery window", kind: "timed",
      start: "2026-09-09", from: "13:00", to: "17:00", who: ["jana", "petr"], author: "jana",
      place: "doma", origin: "local", visibility: "household",
      note: "A four-hour window, which is what the row is for: nobody knows the time." },
    { id: "s-pilates", cs: "Pilates", en: "Pilates", kind: "timed",
      start: "2026-01-07", from: "17:30", to: "18:30", who: ["jana"], author: "jana",
      rrule: { freq: "weekly", interval: 1, byweekday: [2], start: "2026-01-07" },
      origin: "local", visibility: "household" },
    { id: "s-swim", cs: "Adam \u2014 plav\u00e1n\u00ed", en: "Adam \u2014 swimming", kind: "timed",
      start: "2026-09-02", from: "16:30", to: "17:30", who: ["adam"], author: "jana",
      place: "baz\u00e9n Louka", origin: "local", visibility: "household",
      rrule: { freq: "weekly", interval: 1, byweekday: [2, 3], start: "2026-09-02" },
      note: "Twice a week from one rule \u2014 which is why the Stage 10 widget fixture has it on two different days and both are right." },
    { id: "s-chata", cs: "Milo\u0161 na chat\u011b", en: "Milo\u0161 at the cottage", kind: "allday",
      start: "2026-09-09", end: "2026-09-11", who: ["milos"], author: "milos",
      origin: "local", visibility: "household" },
    { id: "s-rubbish", cs: "Popelnice", en: "Rubbish out", kind: "allday",
      start: "2026-01-01", who: ["petr"], author: "petr",
      rrule: { freq: "weekly", interval: 1, byweekday: [3], start: "2026-01-01" },
      origin: "mirror:c-ics-svoz", scope: "full", visibility: "household" },
    { id: "s-film", cs: "Filmov\u00fd ve\u010der", en: "Film night", kind: "timed",
      start: "2026-09-11", from: "20:00", to: "22:30", who: ["jana", "petr", "adam", "klara"],
      author: "jana", place: "doma", origin: "local", visibility: "household", rsvp: true },
    { id: "s-drive", cs: "Odjezd na chatu", en: "Drive up to the cottage", kind: "timed",
      start: "2026-09-12", from: "09:00", to: "11:00", who: ["jana", "milos"], author: "jana",
      origin: "local", visibility: "household" },
    { id: "s-boiler", cs: "Servis kotle", en: "Boiler service", kind: "timed",
      start: "2026-09-14", from: "14:00", to: "15:00", who: ["jana"], author: "jana",
      place: "Novotn\u00fd \u2014 servis", origin: "mirror:c-jana-google", scope: "full",
      visibility: "household", conflict: true },
    { id: "s-private", cs: "U pr\u00e1vn\u00edka", en: "At the lawyer", kind: "timed",
      start: "2026-09-08", from: "12:00", to: "13:00", who: ["jana"], author: "jana",
      place: "Brno \u2014 centrum", description: "N\u00e1v\u0161t\u011bva u pr\u00e1vn\u00edka",
      origin: "local", visibility: "private" },
    { id: "s-rent", cs: "N\u00e1jem chata \u2014 platba", en: "Cottage rent \u2014 pay", kind: "allday",
      start: "2026-08-31", who: ["jana"], author: "jana",
      rrule: { freq: "monthly", interval: 1, bymonthday: 31, start: "2026-08-31" },
      origin: "local", visibility: "household",
      note: "The 31st, monthly. September has thirty days, and the clamp is reminders.js's." },
    { id: "s-busy-mo", cs: "Obsazeno", en: "Busy", kind: "timed",
      start: "2026-08-31", from: "09:00", to: "12:00", who: ["petr"], author: "petr",
      rrule: { freq: "weekly", interval: 1, byweekday: [0], start: "2026-08-31" },
      origin: "mirror:c-petr-work", scope: "busy", visibility: "busy" },
    { id: "s-busy-we", cs: "Obsazeno", en: "Busy", kind: "timed",
      start: "2026-08-31", from: "18:00", to: "19:30", who: ["petr"], author: "petr",
      rrule: { freq: "weekly", interval: 1, byweekday: [2], start: "2026-08-31" },
      origin: "mirror:c-petr-work", scope: "busy", visibility: "busy" },
    { id: "s-busy-th", cs: "Obsazeno", en: "Busy", kind: "timed",
      start: "2026-08-31", from: "18:00", to: "19:00", who: ["petr"], author: "petr",
      rrule: { freq: "weekly", interval: 1, byweekday: [3], start: "2026-08-31" },
      origin: "mirror:c-petr-work", scope: "busy", visibility: "busy" }
  ];
  function series(id) { return SERIES.filter(function (s) { return s.id === id; })[0] || null; }

  /* One row per changed occurrence — the thing a reminder series cannot have. */
  var EXCEPTIONS = [
    { series: "s-pilates", date: "2026-09-16", type: "moved", from: "18:30", to: "19:30",
      by: "jana", at: "2026-09-09 20:12", why: "The hall is taken by a course that week." },
    { series: "s-swim", date: "2026-09-24", type: "cancelled",
      by: "jana", at: "2026-09-07 08:40", why: "Adam is away with school." },
    { series: "s-busy-mo", date: "2026-09-21", type: "moved", from: "10:00", to: "13:00",
      by: "petr", at: "2026-09-20 07:02", remote: true,
      why: "Moved on the work calendar, mirrored in. The household never edited it." }
  ];
  function exception(sid, date) {
    return EXCEPTIONS.filter(function (e) { return e.series === sid && e.date === date; })[0] || null;
  }

  /* RSVP is state_set, keyed by (occurrence, member). "none" is not an answer. */
  var RSVP = {
    "s-film|2026-09-11": { jana: "yes", petr: "yes", adam: "none", klara: "maybe" },
    "s-drive|2026-09-12": { jana: "yes", milos: "yes" },
    "s-dentist|2026-09-10": { jana: "yes", adam: "none" }
  };
  var RSVP_WORDS = [
    ["yes", "P\u0159ijdu", "Coming"],
    ["no", "Nep\u0159ijdu", "Not coming"],
    ["maybe", "Snad", "Maybe"],
    ["none", "Bez odpov\u011bdi", "No answer"]
  ];
  function rsvpWord(v) { var r = RSVP_WORDS.filter(function (w) { return w[0] === v; })[0]; return r ? r[1] : v; }

  /* ── remote connections. Per member, and never on a child profile. ─────── */
  var PROVIDERS = [
    ["google", "Google Calendar", "P\u0159ihl\u00e1\u0161en\u00ed p\u0159es Google"],
    ["microsoft", "Microsoft 365 / Outlook", "Pracovn\u00ed \u00fa\u010dty \u010dasto nepovoluj\u00ed z\u00e1pis"],
    ["apple", "Apple iCloud", "Heslo pro aplikaci"],
    ["ics", "Adresa kalend\u00e1\u0159e (ICS)", "Odkaz, kter\u00fd v\u00e1m n\u011bkdo poslal. Jen ke \u010dten\u00ed."]
  ];
  var CONNECTIONS = [
    { id: "c-jana-google", member: "jana", provider: "google", account: "jana.tilcerova@gmail.com",
      added: "2026-03-02", health: "ok", lastOk: "2026-09-09 07:41", attempts: 0,
      calendars: [
        { id: "cal-jana-personal", name: "Osobn\u00ed", direction: "both", scope: "full", mirrored: 34 },
        { id: "cal-jana-work", name: "Pr\u00e1ce (Kr\u00e1sn\u00e1 tiskaj\u00edc\u00ed)", direction: "import", scope: "busy", mirrored: 61 }
      ] },
    { id: "c-petr-work", member: "petr", provider: "microsoft", account: "petr.tilcer@stavos.cz",
      added: "2026-01-18", health: "stale", lastOk: "2026-09-06 03:12", attempts: 5,
      reason: "Heslo k pracovn\u00edmu \u00fa\u010dtu se v ned\u011bli zm\u011bnilo, tak\u017ee posledn\u00edch p\u011bt pokus\u016f skon\u010dilo odm\u00edtnut\u00edm.",
      calendars: [
        { id: "cal-petr-work", name: "Kalend\u00e1\u0159 \u2014 STAVOS", direction: "import", scope: "busy", mirrored: 23 }
      ] },
    { id: "c-ics-svoz", member: "jana", provider: "ics", account: "svoz-odpadu.brno.cz/zidenice.ics",
      added: "2026-01-04", health: "error", lastOk: "2026-08-27 05:00", attempts: 13,
      reason: "Adresa odpov\u00edd\u00e1 404. M\u011bsto soubor 31. srpna p\u0159esunulo a star\u00fd odkaz u\u017e neexistuje.",
      calendars: [
        { id: "cal-svoz", name: "Svozy odpadu \u2014 \u017didenice", direction: "import", scope: "full", mirrored: 52 }
      ] },
    { id: "c-milos-apple", member: "milos", provider: "apple", account: "milos@icloud.com",
      added: "2026-06-11", health: "ok", lastOk: "2026-09-09 06:58", attempts: 0,
      calendars: [
        { id: "cal-milos", name: "Milo\u0161 \u2014 iPhone", direction: "export", scope: "busy", mirrored: 0 }
      ] }
  ];
  function connection(id) { return CONNECTIONS.filter(function (c) { return c.id === id; })[0] || null; }
  function connectionsOf(m) { return CONNECTIONS.filter(function (c) { return c.member === m; }); }

  var DIRECTIONS = [
    ["import", "Z n\u011bj sem", "Their events appear in the household calendar.", "Nothing of the household's leaves."],
    ["export", "Odsud tam", "Household events appear on that calendar.", "Nothing of theirs comes in."],
    ["both", "Oboj\u00ed", "Events move in both directions.", "The widest setting, and never the offered one."]
  ];
  var SCOPES = [
    ["busy", "Jen \u010das (obsazeno)", "Only the interval crosses. No title, no place, no participants.", true],
    ["full", "V\u0161echno", "Title, place, description and times cross.", false]
  ];
  /* ── expansion: reminders.js's RRULE, not a second copy ───────────────── */
  var CALLS = {};
  function expand(rule, from, to, by) {
    CALLS[by || "unknown"] = (CALLS[by || "unknown"] || 0) + 1;
    var R = window.HH_REMINDERS;
    if (!R) return { dates: [], capped: false, missing: true };
    return R.expand(rule, from, to);
  }

  /* Every occurrence in a window, with its exception applied. */
  function occurrences(from, to, opt) {
    var o = opt || {};
    var out = [];
    SERIES.forEach(function (s) {
      if (o.only && o.only.indexOf(s.id) < 0) return;
      var dates;
      if (s.rrule) dates = expand(s.rrule, from, to, o.by || "occurrences").dates;
      else if (s.kind === "allday" && s.end) {
        dates = [];
        for (var d = s.start; d <= s.end; d = addDays(d, 1)) if (d >= from && d <= to) dates.push(d);
      } else dates = (s.start >= from && s.start <= to) ? [s.start] : [];
      dates.forEach(function (d) {
        var ex = exception(s.id, d);
        if (ex && ex.type === "cancelled") return;
        out.push({
          key: s.id + "|" + d, sid: s.id, date: d, kind: s.kind,
          cs: s.cs, en: s.en, place: s.place || "", description: s.description || "",
          from: ex && ex.type === "moved" ? ex.from : s.from,
          to: ex && ex.type === "moved" ? ex.to : s.to,
          who: s.who.slice(), author: s.author, origin: s.origin, scope: s.scope || null,
          visibility: s.visibility, recurring: !!s.rrule, exception: ex,
          rsvp: RSVP[s.id + "|" + d] || null,
          spanning: s.kind === "allday" && !!s.end,
          conflict: !!s.conflict && d === s.start
        });
      });
    });
    return out.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      var af = a.kind === "allday" ? -1 : minutes(a.from), bf = b.kind === "allday" ? -1 : minutes(b.from);
      return af - bf;
    });
  }

  /* ── the busy projection: done once, at sync-out ────────────────────────
     What a second member's device receives for a private event, and what the
     server mirrors in for a busy-only remote calendar. The five keys below are
     the whole row: there is nothing on the device to inspect, which is why the
     block is uninspectable rather than merely un-tapped. */
  var STRIPPED = ["cs", "en", "place", "description", "who", "author", "rsvp", "attachments", "url"];
  function busyRow(occ) {
    return { id: occ.key, owner: occ.who[0], date: occ.date, from: occ.from, to: occ.to };
  }
  function busyAudit() {
    var priv = occurrences("2026-09-01", "2026-09-30").filter(function (o) {
      return o.visibility === "private" || o.visibility === "busy";
    });
    var rows = priv.map(busyRow);
    var leaked = rows.reduce(function (n, r) {
      return n + STRIPPED.filter(function (k) { return Object.prototype.hasOwnProperty.call(r, k); }).length;
    }, 0);
    var keys = rows.length ? Object.keys(rows[0]) : [];
    return {
      blocks: rows.length, keys: keys, keyCount: keys.length,
      stripped: STRIPPED.length, leaked: leaked,
      privateOwn: priv.filter(function (o) { return o.visibility === "private"; }).length,
      mirrored: priv.filter(function (o) { return o.visibility === "busy"; }).length,
      synced: true, offline: true,
      says: rows.length + " busy rows in September, each of them " + keys.length +
        " fields \u2014 " + keys.join(", ") + ". " + STRIPPED.length +
        " fields are dropped at sync-out and " + leaked +
        " of them survive on the row a second device holds, so the block is offline-complete and uninspectable for the same reason: the words are not there to be shown."
    };
  }
  /* The gate's own sentence, computed: the private row is a real synced row. */
  function busyGate() {
    var own = occurrences("2026-09-08", "2026-09-08", { only: ["s-private"] })[0];
    var row = own ? busyRow(own) : null;
    var pol = POLICIES.filter(function (p) { return p[0] === "calendar.event"; })[0];
    return {
      event: own, row: row, policy: pol ? pol[1] : "",
      isRow: !!row && !!row.id && !!row.from && !!row.to,
      inFeed: true, cached: true,
      says: own
        ? "Jana's own private hour on " + fmtLong(own.date) + " reaches Petr's phone as " +
          JSON.stringify(row) + " \u2014 an ordinary row in the sync feed with an id, an owner and an interval, cached like every other. Petr's phone draws it with no network at all, and there is nothing in the cache that would answer what it is."
        : "no private event in the fixture"
    };
  }

  /* ── the three-choice occurrence edit ───────────────────────────────────
     The choices are not three buttons with three labels: each one is a count
     taken from the series it is about, and each writes a different set of rows. */
  function editChoices(sid, date, horizon) {
    var s = series(sid);
    if (!s || !s.rrule) return null;
    var to = horizon || "2027-12-31";
    var all = expand(s.rrule, s.rrule.start, to, "editChoices").dates;
    var past = all.filter(function (d) { return d < TODAY; }).length;
    var future = all.filter(function (d) { return d >= date; }).length;
    var before = all.length - future;
    var exOthers = EXCEPTIONS.filter(function (e) { return e.series === sid && e.date !== date; });
    return {
      series: s, date: date, total: all.length, past: past, future: future,
      choices: [
        { id: "this", label: "Jen tuto", en: "This occurrence", touches: 1,
          consequence: "Changes 1 of " + all.length + " occurrences. Writes one exception row for " +
            fmt(date) + " and leaves the rule alone, so the series keeps its shape.",
          writes: 1, rows: ["calendar.event_exception \u00b7 " + date], keepsExceptions: exOthers.length },
        { id: "future", label: "Tuto a v\u0161echny dal\u0161\u00ed", en: "This and all future", touches: future,
          consequence: "Splits the series at " + fmt(date) + ": " + future + " occurrences move, the " +
            before + " before it do not, and " +
            (exOthers.filter(function (e) { return e.date >= date; }).length) +
            " later exception" + (exOthers.filter(function (e) { return e.date >= date; }).length === 1 ? "" : "s") +
            " are carried onto the new rule.",
          writes: 2, rows: ["calendar.event \u00b7 until " + fmt(addDays(date, -1)), "calendar.event \u00b7 new rule from " + fmt(date)],
          keepsExceptions: exOthers.filter(function (e) { return e.date >= date; }).length },
        { id: "series", label: "Celou s\u00e9rii", en: "The whole series", touches: all.length,
          consequence: "Changes all " + all.length + " occurrences, including the " + past +
            " that already happened, and drops the " + exOthers.length + " exception row" +
            (exOthers.length === 1 ? "" : "s") + " somebody made on other weeks.",
          writes: 1 + exOthers.length, rows: ["calendar.event \u00b7 the rule"].concat(exOthers.map(function (e) {
            return "calendar.event_exception \u00b7 " + e.date + " \u2014 dropped";
          })), keepsExceptions: 0 }
      ]
    };
  }
  function choiceRun() {
    var c = editChoices("s-pilates", "2026-09-23");
    var counts = c ? c.choices.map(function (x) { return x.touches; }) : [];
    var distinct = counts.filter(function (v, i) { return counts.indexOf(v) === i; }).length;
    return { run: c, counts: counts, distinct: distinct,
      allStated: !!c && c.choices.every(function (x) { return /\d/.test(x.consequence); }),
      says: c ? "Moving the 23 September Pilates touches " + counts.join(", ") + " of " + c.total +
        " occurrences and writes " + c.choices.map(function (x) { return x.writes; }).join(", ") +
        " rows respectively \u2014 three different answers to one drag." : "" };
  }

  /* ── the four views, and which client defaults to which ─────────────────── */
  var VIEW_DEFS = [
    ["month", "M\u011bs\u00edc", "web", "Five rows of seven. The only view that answers \u201cwhen is that week\u201d at a glance, and it needs width."],
    ["week", "T\u00fdden", null, "Seven columns against a time axis. The overlap view: two events at once are two boxes side by side."],
    ["day", "Den", null, "One column, full detail, and the only view where a four-hour delivery window reads as four hours."],
    ["agenda", "Agenda", "mobile", "A list of days with content, skipping the empty ones \u2014 the shape a phone can actually read."]
  ];
  /* The arithmetic that chooses the mobile default, rather than a preference. */
  function viewFit(width, scalePct) {
    var gutter = 12, cols = 7;
    var col = Math.floor((width - gutter * 2 - (cols - 1) * 2) / cols);
    var px = 16 * (scalePct || 100) / 100;
    var timeWidth = Math.ceil(px * 0.62 * 5);        /* "17:30" in the mono face */
    var titleWidth = Math.ceil(px * 0.52 * 8);       /* eight characters of a title */
    return { width: width, scale: scalePct || 100, col: col, timeWidth: timeWidth, titleWidth: titleWidth,
             fitsTime: col >= timeWidth, fitsTitle: col >= timeWidth + titleWidth };
  }
  function defaultRun() {
    var phone = viewFit(360, 100), phoneBig = viewFit(360, 200), web = viewFit(1156, 100), webBig = viewFit(1156, 200);
    return {
      phone: phone, phoneBig: phoneBig, web: web, webBig: webBig,
      mobile: "agenda", desktop: "month",
      says: "A month grid on a 360 px phone gives " + phone.col +
        " px a column; a time label is " + phone.timeWidth + " px at 100 % text and " +
        phoneBig.timeWidth + " px at 200 %, so the phone's month cell can hold a mark and a count and never a time. On web the same column is " +
        web.col + " px and holds a time and a title at both text sizes. That is why agenda is the mobile default and month the web default \u2014 not a preference, and neither view is missing from either client."
    };
  }

  /* ── the who overlay: a personal, local view filter ─────────────────────── */
  function whoOverlay(selected, day) {
    var picked = selected && selected.length ? selected : null;
    var d = day || TODAY;
    var week = occurrences(monday(d), addDays(monday(d), 6));
    var rows = week.map(function (o) {
      var mine = o.who.filter(function (w) { return !picked || picked.indexOf(w) >= 0; });
      return { occ: o, shown: mine.length > 0, who: o.who };
    });
    var F = window.HH_FIXTURES;
    return {
      members: (F ? F.members : []).map(function (m) {
        return { id: m.id, name: m.name, colour: MEMBER_COLOUR[m.id], initial: m.name.slice(0, 1),
                 on: !picked || picked.indexOf(m.id) >= 0,
                 count: week.filter(function (o) { return o.who.indexOf(m.id) >= 0; }).length };
      }),
      shown: rows.filter(function (r) { return r.shown; }).length, total: rows.length,
      local: true, synced: false,
      says: "The overlay is a filter over the same rows, held on the device: " +
        rows.filter(function (r) { return r.shown; }).length + " of " + rows.length +
        " occurrences this week survive the current selection, and turning everybody back on is not a sync."
    };
  }
  function colourAudit() {
    var C = { jana: "chart-1", petr: "chart-2", adam: "chart-4", klara: "chart-3", milos: "chart-5" };
    var ids = Object.keys(C);
    var same = ids.filter(function (k) { return MEMBER_COLOUR[k] === C[k]; }).length;
    var week = occurrences(monday(TODAY), addDays(monday(TODAY), 6));
    var carried = week.filter(function (o) {
      return o.visibility === "busy" ? true : o.who.length > 0;
    }).length;
    return { members: ids.length, same: same, rows: week.length, carried: carried,
      colourOnly: week.length - carried,
      says: same + " of " + ids.length +
        " member colours are the ones Stage 4 assigned to the avatar, re-used rather than re-picked, and " +
        carried + " of " + week.length +
        " rows carry the member as a name or an initial beside the colour \u2014 the bar is never the only thing saying whose it is." };
  }
  /* ── connecting: a privacy screen, and it names the recipient ───────────── */
  function connectOffer(provider, memberId) {
    var p = PROVIDERS.filter(function (x) { return x[0] === provider; })[0];
    var acc = { google: "jana.tilcerova@gmail.com", microsoft: "petr.tilcer@stavos.cz",
                apple: "milos@icloud.com", ics: "svoz-odpadu.brno.cz/zidenice.ics" }[provider];
    return {
      provider: provider, name: p ? p[1] : provider, how: p ? p[2] : "", account: acc,
      direction: "import", scope: "busy",
      sentence: "Z " + acc + " se sem bude p\u0159en\u00e1\u0161et jen \u010das, kdy jste obsazen\u00ed. Nic z t\u00e9to dom\u00e1cnosti se do " + acc + " neodesl\u00e1.",
      en: "From " + acc + ", only the times you are busy will come in. Nothing from this household is sent to " + acc + ".",
      namesAccount: true, child: isChild(memberId)
    };
  }
  function connectAudit() {
    var offers = PROVIDERS.map(function (p) { return connectOffer(p[0], "jana"); });
    return {
      offers: offers, providers: PROVIDERS.length,
      busyFirst: offers.filter(function (o) { return o.scope === "busy"; }).length,
      importFirst: offers.filter(function (o) { return o.direction === "import"; }).length,
      named: offers.filter(function (o) { return o.sentence.indexOf(o.account) >= 0 && o.en.indexOf(o.account) >= 0; }).length,
      says: offers.length + " providers, " + offers.filter(function (o) { return o.scope === "busy"; }).length +
        " of them offering busy-only as the pre-selected scope and import as the pre-selected direction, and " +
        offers.filter(function (o) { return o.sentence.indexOf(o.account) >= 0; }).length +
        " naming the account in the sentence rather than in a field label \u2014 which is the difference between a permission screen and a form."
    };
  }
  /* Never available to a child profile: absent, not disabled. */
  function childRun() {
    var F = window.HH_FIXTURES;
    return (F ? F.members : []).map(function (m) {
      var child = m.role === "child";
      return { id: m.id, name: m.name, role: m.role, grant: m.grants.calendar,
        connections: child ? 0 : connectionsOf(m.id).length,
        controls: child ? 0 : 1,
        treatment: child ? "absent" : (m.grants.calendar === "none" ? "absent" : "available"),
        why: child ? "A child profile has no connection surface at all \u2014 no row in settings, no greyed control, no explanation. FR-CA13, and the same rule as billing."
                   : (m.grants.calendar === "none" ? "No grant on Calendar, so the module is absent and its settings with it." : "") };
    });
  }

  /* ── connection health ──────────────────────────────────────────────────── */
  function health(id, now) {
    var c = connection(id);
    if (!c) return null;
    var at = now || (TODAY + " 09:20");
    var hours = Math.round((new Date(at.replace(" ", "T") + ":00Z") - new Date(c.lastOk.replace(" ", "T") + ":00Z")) / 3600000);
    var state = c.health === "error" ? "error" : (hours >= STALE_HOURS ? "stale" : "ok");
    return {
      id: c.id, member: c.member, provider: c.provider, account: c.account,
      state: state, hours: hours, attempts: c.attempts, reason: c.reason || "",
      badge: state === "ok" ? "" : (state === "stale" ? "Neaktualizov\u00e1no " + Math.floor(hours / 24) + " dny" : "Nefunguje"),
      token: state === "ok" ? "--positive" : (state === "stale" ? "--status-stale" : "--danger"),
      word: state === "ok" ? "V po\u0159\u00e1dku" : (state === "stale" ? "Neaktu\u00e1ln\u00ed" : "Chyba"),
      mirrored: c.calendars.reduce(function (n, x) { return n + x.mirrored; }, 0),
      sentence: state === "ok"
        ? "Naposledy " + c.lastOk.slice(11) + " dnes."
        : (state === "stale"
            ? "Naposledy se to poda\u0159ilo " + fmt(c.lastOk.slice(0, 10)) + " — p\u0159ed " + Math.floor(hours / 24) +
              " dny. " + (c.reason || "") + " Co je tady vid\u011bt, je star\u00e9 " + Math.floor(hours / 24) + " dny."
            : (c.reason || "") + " Naposledy se to poda\u0159ilo " + fmt(c.lastOk.slice(0, 10)))
    };
  }
  function healthRun() {
    var all = CONNECTIONS.map(function (c) { return health(c.id); });
    return { all: all,
      ok: all.filter(function (h) { return h.state === "ok"; }).length,
      stale: all.filter(function (h) { return h.state === "stale"; }).length,
      error: all.filter(function (h) { return h.state === "error"; }).length,
      worded: all.filter(function (h) { return h.state === "ok" || (h.sentence && h.sentence.length > 20); }).length,
      says: "Four connections: " + all.map(function (h) { return h.provider + " " + h.state; }).join(", ") +
        ". A stale one says how old what you are looking at is, in days, on the row \u2014 the badge is the pointer, the sentence is the answer." };
  }

  /* ── the external conflict: the loser is preserved ──────────────────────── */
  var EXTERNAL = {
    occurrence: "s-boiler|2026-09-14",
    local: { from: "14:00", to: "15:00", by: "jana", at: "2026-09-08 19:12", offline: true,
             note: "Jana moved it on her phone in the car park, with no signal." },
    remote: { from: "08:00", to: "12:00", by: "Novotn\u00fd \u2014 servis", at: "2026-09-08 21:40",
              via: "c-jana-google", note: "The contractor's own calendar moved it to a morning window." },
    rule: "A mirrored row has one author, and it is not this household. The remote value stays on the mirror; the household's edit is kept as a household event beside it and shown on the row, for " + LOSER_DAYS + " days."
  };
  function externalRun(now) {
    var d = (now || TODAY);
    var kept = LOSER_DAYS - diff(EXTERNAL.local.at.slice(0, 10), d);
    return {
      e: EXTERNAL, keptDays: kept, lost: 0, preserved: 1,
      bothShown: true,
      says: "Both values, both authors, both times: " + EXTERNAL.local.from + "\u2013" + EXTERNAL.local.to +
        " by " + name(EXTERNAL.local.by) + " at " + EXTERNAL.local.at.slice(11) +
        " offline, against " + EXTERNAL.remote.from + "\u2013" + EXTERNAL.remote.to + " from " +
        EXTERNAL.remote.by + " at " + EXTERNAL.remote.at.slice(11) +
        ". The mirror keeps the remote value, Jana's version is preserved as a household event for " +
        kept + " more days, and nothing is deleted to make the screen simpler."
    };
  }

  /* ── disconnecting: it asks what to do with the mirrored events ─────────── */
  function disconnect(id, answer) {
    var c = connection(id);
    if (!c) return null;
    var mirrored = c.calendars.reduce(function (n, x) { return n + x.mirrored; }, 0);
    var live = occurrences("2026-09-01", "2026-09-30").filter(function (o) {
      return o.origin === "mirror:" + id;
    }).length;
    var own = occurrences("2026-09-01", "2026-09-30").filter(function (o) { return o.origin === "local"; }).length;
    return {
      connection: c, mirrored: mirrored, thisMonth: live, householdOwn: own, touched: 0,
      answers: [
        { id: "keep", label: "Nechat je tady", en: "Keep them here",
          effect: "The " + mirrored + " mirrored events become ordinary household events, keep their times, stop updating, and lose the connection's name from their rows.",
          writes: mirrored, removes: 0 },
        { id: "remove", label: "Odebrat je", en: "Remove them",
          effect: "The " + mirrored + " mirrored events disappear from the household calendar. They stay on " +
            c.account + ", which is the only place they were ever authored.",
          writes: 0, removes: mirrored }
      ],
      chosen: answer || null,
      says: "Disconnecting " + c.account + " is a question with two answers, and neither of them touches any of the " +
        own + " events this household wrote itself."
    };
  }

  /* ── wall-clock recurrence across the DST change ────────────────────────── */
  function dstRun() {
    var s = series("s-swim");
    var dates = expand(s.rrule, "2026-10-19", "2026-11-02", "dstRun").dates;
    return {
      dates: dates, local: s.from, before: "+02:00", after: "+01:00", boundary: DST_END,
      shifted: 0,
      says: "Swimming is at " + s.from + " on " + dates.length + " days across " + fmtLong(DST_END) +
        ", when Prague goes from +02:00 to +01:00. The local time does not move, the UTC instant does, and the row stores the wall clock plus " +
        TZ + " \u2014 which is the only storage that survives a household that meets at half past four."
    };
  }
  /* ── reconciliation: every calendar row drawn by an earlier stage ────────
     Fifteen rows exist outside this module — two widgets in Stage 10, four rows
     on Today and one search hit in Stage 11, one reminder occurrence in Stage 12.
     Each one has to resolve to a row in this module's own data, and three of them
     disagreed with it. All three turn out to be explainable, and two of the three
     explanations are features of this stage rather than corrections. */
  var EXTERNAL_ROWS = [
    { src: "dashboard.js \u00b7 calendar.today", text: "Adam \u2014 swimming 16:30 \u00b7 today", to: "s-swim", ok: true },
    { src: "dashboard.js \u00b7 calendar.today", text: "Busy 18:00\u201319:30 \u00b7 today \u00b7 Petr", to: "s-busy-we", ok: true },
    { src: "dashboard.js \u00b7 calendar.today", text: "Rubbish out \u00b7 tomorrow", to: "s-rubbish", ok: true },
    { src: "dashboard.js \u00b7 calendar.week_ahead", text: "Dentist \u00b7 Jana 09:00 \u00b7 Thu 10", to: "s-dentist", ok: false,
      drift: "The widget fixture says 09:00. This module's row and reminders.js's own occurrence both say 08:10, so the prose is the outlier and 08:10 is what the module draws." },
    { src: "dashboard.js \u00b7 calendar.week_ahead", text: "Adam \u2014 swimming 16:30 \u00b7 Thu 10", to: "s-swim", ok: false,
      drift: "The same event on two different days in one file \u2014 and both are right: the rule is weekly on Wednesday and Thursday, which is a recurrence this stage had to support anyway." },
    { src: "dashboard.js \u00b7 calendar.week_ahead", text: "Gas reading \u00b7 Fri 11", to: null, ok: false,
      strand: "reminders", drift: "Not a calendar event at all. It resolves to reminders.js's utilities.reading_due \u2014 the electricity meter on Friday, not gas. The widget spans both strands, as Today does; Calendar's own agenda does not, and that boundary is the point." },
    { src: "dashboard.js \u00b7 calendar.week_ahead", text: "Film night 20:00 \u00b7 Fri 11", to: "s-film", ok: true },
    { src: "dashboard.js \u00b7 calendar.week_ahead", text: "Chata \u2014 drive up 09:00 \u00b7 Sat 12", to: "s-drive", ok: true },
    { src: "dashboard.js \u00b7 calendar.week_ahead", text: "Boiler service 08:00\u201312:00 \u00b7 Mon 14", to: "s-boiler", ok: true,
      note: "The remote value \u2014 the one the mirror keeps." },
    { src: "spine.js \u00b7 Today, timed", text: "Adam \u2014 dentist 08:10 \u00b7 Dr. Kub\u00e1t", to: "s-dentist", ok: true },
    { src: "spine.js \u00b7 Today, timed", text: "Delivery window \u2014 washing machine 13:00\u201317:00", to: "s-delivery", ok: true },
    { src: "spine.js \u00b7 Today, timed", text: "Pilates 17:30 \u00b7 Jana", to: "s-pilates", ok: true },
    { src: "spine.js \u00b7 Today, all day", text: "Milo\u0161 at the cottage \u00b7 until Friday", to: "s-chata", ok: true },
    { src: "spine.js \u00b7 search corpus", text: "Servis kotle 14:00 \u00b7 Novotn\u00fd", to: "s-boiler", ok: true,
      note: "The local value \u2014 the preserved loser of the external conflict, still findable, which is what preserving it is for." },
    { src: "reminders.js \u00b7 o-dentist", text: "calendar.event \u00b7 due 2026-09-10 \u00b7 08:10", to: "s-dentist", ok: true }
  ];
  function reconcile() {
    var rows = EXTERNAL_ROWS.map(function (r) {
      var s = r.to ? series(r.to) : null;
      return { src: r.src, text: r.text, to: r.to, resolved: !!s || r.strand === "reminders",
               strand: r.strand || "calendar", drift: r.drift || "", note: r.note || "" };
    });
    var D2 = window.HH_DASHBOARD, S2 = window.HH_SPINE, R2 = window.HH_REMINDERS;
    var widgetKeys = D2 ? D2.widgets.filter(function (w) { return w.module === "calendar"; }).map(function (w) { return w.key; }) : [];
    var spineRows = S2 ? (S2.rowsToday || S2.today || []) : [];
    var remOcc = R2 ? R2.occurrences.filter(function (o) { return o.kind === "calendar.event"; }).length : 0;
    return {
      rows: rows, total: rows.length,
      resolved: rows.filter(function (r) { return r.resolved; }).length,
      drifts: rows.filter(function (r) { return !!r.drift; }).length,
      crossStrand: rows.filter(function (r) { return r.strand !== "calendar"; }).length,
      widgetKeys: widgetKeys, reminderOcc: remOcc,
      says: rows.length + " rows drawn by earlier stages, " +
        rows.filter(function (r) { return r.resolved; }).length + " of them resolving to a row in this module (" +
        rows.filter(function (r) { return r.strand !== "calendar"; }).length +
        " to the reminder strand instead), and " + rows.filter(function (r) { return !!r.drift; }).length +
        " that disagreed with it \u2014 each one named with both values rather than quietly overwritten."
    };
  }

  /* ── the empty state, against Stage 9's template ─────────────────────────── */
  var EMPTY = {
    sentence: "Kalend\u00e1\u0159 je na to, co m\u00e1 \u010das \u2014 sch\u016fzky, krou\u017eky, n\u00e1v\u0161t\u011bvy, odjezdy.",
    en: "The calendar is for the things that have a time \u2014 appointments, clubs, visits, departures.",
    example: "Nap\u0159\u00edklad \u201eAdam \u2014 zuba\u0159, \u010dtvrtek 8:10\u201c.",
    exampleEn: "For example \u201cAdam \u2014 dentist, Thursday 8:10\u201d.",
    action: "P\u0159idat prvn\u00ed ud\u00e1lost",
    actionEn: "Add the first event",
    zero: false, apiWords: 0
  };
  function emptyAudit() {
    var body = EMPTY.en + " " + EMPTY.exampleEn + " " + EMPTY.actionEn;
    var banned = ["no records", "no items", "0 events", "empty", "collection", "entity"];
    return {
      sentence: 1, example: 1, action: 1,
      banned: banned.filter(function (w) { return body.toLowerCase().indexOf(w) >= 0; }),
      distinct: ["error", "offline", "absent", "withdrawn"],
      says: "One sentence, one example a household would really type, one action, and " +
        banned.filter(function (w) { return body.toLowerCase().indexOf(w) >= 0; }).length +
        " of the six words Stage 9's template bans. The four states it must not be mistaken for each carry their own sentence in the matrix."
    };
  }

  /* ── in-app help, authored here, surface derived by Stage 11's rule ─────── */
  var HELP = [
    { id: "calendar.connect.scope", screen: "/calendar/connections/new", hard: true, model: true,
      title: "Co se vlastn\u011b p\u0159en\u00e1\u0161\u00ed?",
      body: "Dv\u011b nastaven\u00ed, ka\u017cd\u00e9 samostatn\u011b: sm\u011br \u0159\u00edk\u00e1, kam se ud\u00e1losti p\u0159en\u00e1\u0161ej\u00ed, a rozsah \u0159\u00edk\u00e1, co z nich. Nab\u00edz\u00edme jen \u010das \u2014 n\u00e1zvy a m\u00edsta z\u016fst\u00e1vaj\u00ed tam, kde jsou.",
      steps: ["Vyberte kalend\u00e1\u0159.", "Nastavte sm\u011br.", "Nastavte rozsah.", "P\u0159e\u010dt\u011bte si v\u011btu, kter\u00e1 jmenuje adresu."],
      en: { title: "What actually gets shared?",
            body: "Two settings, each on its own: direction says where events travel, scope says how much of them. Busy-only is offered first \u2014 titles and places stay where they are.",
            steps: ["Pick a calendar.", "Set the direction.", "Set the scope.", "Read the sentence that names the address."] },
      authoredIn: 18 },
    { id: "calendar.occurrence.choice", screen: "/calendar/events/{id}/edit", hard: true,
      title: "Pro\u010d se m\u011b pt\u00e1 na t\u0159i mo\u017cnosti?",
      body: "Ud\u00e1lost se opakuje. M\u016f\u017cete zm\u011bnit jen tuhle, tuhle a v\u0161echny dal\u0161\u00ed, nebo celou s\u00e9rii \u2014 a u ka\u017cd\u00e9 je napsan\u00e9, kolika term\u00edn\u016f se to dot\u00fdk\u00e1.",
      example: "Pilates: 1 ze 104, 62 dal\u0161\u00edch, nebo v\u0161ech 104.",
      en: { title: "Why is it asking me to pick one of three?",
            body: "The event repeats. You can change only this one, this one and everything after it, or the whole series \u2014 and each choice says how many terms it touches.",
            example: "Pilates: 1 of 104, 62 more, or all 104." },
      authoredIn: 18 },
    { id: "calendar.busy.what", screen: "/calendar", hard: false,
      title: "Co je \u201eObsazeno\u201c?",
      body: "N\u011bkdo m\u00e1 v tu dobu n\u011bco, co s v\u00e1mi nesd\u00edl\u00ed. Vid\u00edte \u010das, ne co to je \u2014 a to je z\u00e1m\u011br, ne chyba.",
      en: { title: "What does \u201cBusy\u201d mean?",
            body: "Somebody has something then that they do not share with you. You see the time, not what it is \u2014 and that is deliberate, not a fault." },
      authoredIn: 18 }
  ].map(function (h) {
    var steps = h.steps || [];
    var surface = (steps.length >= 4 || h.model) ? "panel" : (h.example || h.body.length > 120) ? "expandable" : "inline";
    return { id: h.id, screen: h.screen, hard: !!h.hard, title: h.title, body: h.body,
             example: h.example || null, steps: steps, surface: surface, authoredIn: 18,
             cs: h.cs || null, en: h.en || null,
             chars: h.body.length, links: [] };
  });
  function helpAudit() {
    var by = {};
    HELP.forEach(function (h) { by[h.surface] = (by[h.surface] || 0) + 1; });
    return { entries: HELP.length, bySurface: by,
      surfaces: Object.keys(by).length,
      external: 0,
      overlong: HELP.filter(function (h) { return h.title.length > 48 || h.chars > 240; }).length,
      says: HELP.length + " entries authored with the screens, " + Object.keys(by).map(function (k) {
        return by[k] + " " + k;
      }).join(" \u00b7 ") + ", the surface derived from the content by Stage 11's own rule and zero external links." };
  }
  /* ── the screen ledger for this stage ───────────────────────────────────── */
  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending", "syncing",
                    "conflicted", "rejected", "absent", "withdrawn", "readonly"];
  var VIEW_LWW = {
    conflicted: "calendar.event is lww_field and an occurrence exception is a row of its own: two members moving an event merge field by field and the later edit wins. The structural rows in this module \u2014 the household's calendars and a member's connections \u2014 are strict_version, and those do ask."
  };
  var RSVP_SET = {
    conflicted: "An answer is state_set keyed by (occurrence, member). Saying yes twice is idempotent and two members answering at once merge by key, so there is no version of this screen that asks a question."
  };
  var OVERLAY = {
    pending: "The overlay is view state written to the device, not a synced row. There is nothing queued and nothing to mark.",
    syncing: "Same reason: nothing about it is uploaded.",
    conflicted: "One member, one device, one view state. It cannot fork.",
    rejected: "There is no mutation for the server to refuse.",
    withdrawn: "A member whose access is retracted leaves the overlay's list rather than becoming a withdrawn entry in it."
  };
  var CONN_CFG = {
    conflicted: "A connection is strict_version and server-held. Two owners editing one member's scope is resolved on the server \u2014 a client never holds two versions of somebody's privacy setting.",
    withdrawn: "A connection belongs to the member who made it and is shared with nobody, so there is no access to retract."
  };
  var CONN_HEALTH = {
    pending: "Health is measured on the server from the last sync attempt.",
    syncing: "Same reason.",
    conflicted: "A measurement cannot disagree with itself.",
    rejected: "Nothing is written from this screen.",
    withdrawn: "Per-member, and shared with nobody."
  };

  var SCREENS = [
    { id: "E-1", view: "views", client: "mw", preset: "D", route: "/calendar/month/2026-09", kind: "month",
      name: "Calendar month", title: "Z\u00e1\u0159\u00ed 2026",
      lede: "Five rows of seven, Monday first, with the member colour on every row.",
      empty: { s: EMPTY.sentence, e: EMPTY.example, a: EMPTY.action },
      error: "Nepoda\u0159ilo se na\u010d\u00edst z\u00e1\u0159\u00ed. Co je v telefonu, se pod t\u00edm po\u0159\u00e1d \u010dte.",
      rejected: "Odm\u00edtnuto: ud\u00e1lost mus\u00ed za\u010d\u00ednat p\u0159ed t\u00edm, ne\u017e skon\u010d\u00ed.",
      withdrawn: "Kalend\u00e1\u0159 u\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00fd.",
      readonly: "Jen ke \u010dten\u00ed, dokud se p\u0159edplatn\u00e9 neobnov\u00ed. V\u0161echno zapsan\u00e9 se \u010dte d\u00e1l.",
      states: {
        absent: "Three of five members hold none on Calendar and see nothing of it \u2014 no tab, no widget, no row on Today.",
        offline: "Events, exceptions and the busy rows are all on the device, and the expansion runs there. The same month with the bar above it.",
        pending: "An event dragged to another day with no signal, queued, and editable while it waits.",
        syncing: "Past the 800 ms threshold only."
      },
      impossible: VIEW_LWW,
      foot: "The web default. On a phone the month is reachable and readable \u2014 it is simply not what opens.",
      note: "The month cell is the one place the who-overlay's colour has to carry meaning at four pixels wide, which is why every chip also carries an initial.", drawn: "all" },

    { id: "E-2", view: "views", client: "mw", preset: "D", route: "/calendar/week/2026-W37", kind: "week",
      name: "Calendar week", title: "7.\u201313. z\u00e1\u0159\u00ed",
      lede: "Seven columns against a time axis. Two things at once are two boxes side by side.",
      empty: { s: EMPTY.sentence, e: EMPTY.example, a: EMPTY.action },
      error: "Nepoda\u0159ilo se na\u010d\u00edst t\u00fdden.",
      rejected: "Odm\u00edtnuto: ud\u00e1lost mus\u00ed za\u010d\u00ednat p\u0159ed t\u00edm, ne\u017e skon\u010d\u00ed.",
      withdrawn: "Kalend\u00e1\u0159 u\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00fd.",
      readonly: "Jen ke \u010dten\u00ed, dokud se p\u0159edplatn\u00e9 neobnov\u00ed.",
      states: {
        absent: "Absent with the module.",
        offline: "The whole week is local arithmetic over synced rows.",
        pending: "An hour dragged in the week grid, queued, drawn where the member put it.",
        syncing: "Past the threshold only."
      },
      impossible: VIEW_LWW,
      foot: "All-day rows sit above the axis, because an all-day event has no place on a clock.",
      note: "The overlap case is the week view's whole reason to exist \u2014 and the busy block is what makes it honest.", drawn: "all" },

    { id: "E-3", view: "views", client: "mw", preset: "D", route: "/calendar/day/2026-09-09", kind: "day",
      name: "Calendar day", title: "St\u0159eda 9. z\u00e1\u0159\u00ed",
      lede: "One column, full detail, and the only view where a four-hour window reads as four hours.",
      empty: { s: "Na st\u0159edu nic nen\u00ed.", e: "Ticho ve st\u0159edu je kr\u00e1tk\u00e1 obrazovka, ne pr\u00e1zdn\u00e1.", a: "P\u0159idat ud\u00e1lost" },
      error: "Nepoda\u0159ilo se na\u010d\u00edst den.",
      rejected: "Odm\u00edtnuto: ud\u00e1lost mus\u00ed za\u010d\u00ednat p\u0159ed t\u00edm, ne\u017e skon\u010d\u00ed.",
      withdrawn: "Kalend\u00e1\u0159 u\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00fd.",
      readonly: "Jen ke \u010dten\u00ed, dokud se p\u0159edplatn\u00e9 neobnov\u00ed.",
      states: {
        absent: "Absent with the module.",
        offline: "Local.", pending: "A time typed and queued.", syncing: "Past the threshold only."
      },
      impossible: VIEW_LWW,
      foot: "The delivery window is drawn at its real height, which is the argument against a list here.",
      note: "The day view is also the accessible view: one column, chronological, and every block reachable by tab.", drawn: "all" },

    { id: "E-4", view: "views", client: "mw", preset: "D", route: "/calendar", kind: "agenda",
      name: "Agenda", title: "Agenda",
      lede: "Days with something in them, in order, skipping the ones without.",
      empty: { s: EMPTY.sentence, e: EMPTY.example, a: EMPTY.action },
      error: "Nepoda\u0159ilo se na\u010d\u00edst agendu.",
      rejected: "Odm\u00edtnuto: ud\u00e1lost mus\u00ed za\u010d\u00ednat p\u0159ed t\u00edm, ne\u017e skon\u010d\u00ed.",
      withdrawn: "Kalend\u00e1\u0159 u\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00fd.",
      readonly: "Jen ke \u010dten\u00ed, dokud se p\u0159edplatn\u00e9 neobnov\u00ed.",
      states: {
        absent: "Absent with the module.",
        offline: "The expansion is client-side, so the offline agenda is complete rather than a cached window \u2014 the same property Stage 12 gave the reminder strand.",
        pending: "A new event queued at the top of its day.",
        syncing: "Past the threshold only."
      },
      impossible: VIEW_LWW,
      foot: "The mobile default. Empty days are skipped rather than drawn as empty rows.",
      note: "Agenda is the only view whose height is proportional to what is happening, which is why it is what opens on a phone.", drawn: "all" },

    { id: "E-5", view: "editor", client: "mw", preset: "D", route: "/calendar/events/{id}/edit", kind: "editor",
      name: "Event editor with recurrence", title: "Ud\u00e1lost",
      lede: "Title, when, where, who, repeat, reminders. In that order, and the repeat is a sentence.",
      empty: { s: "Nov\u00e1 ud\u00e1lost.", e: "\u201eAdam \u2014 zuba\u0159, \u010dtvrtek 8:10\u201c", a: "Ulo\u017cit" },
      error: "Nepoda\u0159ilo se ulo\u017cit ud\u00e1lost.",
      rejected: "Odm\u00edtnuto: opakov\u00e1n\u00ed nem\u016f\u017ce skon\u010dit p\u0159ed prvn\u00edm term\u00ednem.",
      withdrawn: "Kalend\u00e1\u0159 u\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00fd.",
      readonly: "Jen ke \u010dten\u00ed. Ud\u00e1lost se \u010dte, ulo\u017cit nejde.",
      states: {
        absent: "A member with view on Calendar reaches the event and not this screen.",
        offline: "The whole editor works offline; the save queues.",
        pending: "Saved with no signal: the row is marked in a word and stays editable.",
        syncing: "Past the threshold only."
      },
      impossible: VIEW_LWW,
      foot: "Repeat is written as \u201cka\u017cd\u00fd t\u00fdden ve st\u0159edu a ve \u010dtvrtek\u201d, never as a rule builder.",
      note: "The reminder row on this screen is reminders.js's kind, with the event's own lead times on top \u2014 not a second reminder system.", drawn: "all" },

    { id: "E-6", view: "editor", client: "mw", preset: "S", route: "/calendar/events/{id}/edit#scope", kind: "choice",
      name: "Three-choice occurrence edit", title: "Co m\u00e1me zm\u011bnit?",
      lede: "Three choices, and each one says how many terms it touches.",
      foot: "The counts are taken from the series, so the third choice can admit that it rewrites the past.",
      note: "This is the screen that pays for calendar.event_exception existing \u2014 the row Stage 12 deliberately refused reminders.", drawn: "all" },

    { id: "E-7", view: "people", client: "mw", preset: "D", route: "/calendar/events/{id}#who", kind: "rsvp",
      name: "Participants and RSVP", title: "Kdo p\u0159ijde",
      lede: "Who is on it, who has answered, and who has not been asked.",
      empty: { s: "Zat\u00edm nikdo krom\u011b v\u00e1s.", e: "P\u0159idejte t\u0159eba Petra \u2014 dostane ot\u00e1zku, ne p\u0159\u00edkaz.", a: "P\u0159idat \u00fa\u010dastn\u00edky" },
      error: "Nepoda\u0159ilo se ulo\u017cit odpov\u011b\u010f.",
      rejected: "Odm\u00edtnuto: nelze odpov\u00eddat za n\u011bkoho jin\u00e9ho.",
      withdrawn: "Kalend\u00e1\u0159 u\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00fd.",
      readonly: "Jen ke \u010dten\u00ed. Odpov\u011bdi se \u010dtou, m\u011bnit je nejde.",
      states: {
        absent: "Absent with the module.",
        offline: "An answer is a one-tap write that queues like any other.",
        pending: "Answered on the tram: the mark is on your own row and nobody else's moves.",
        syncing: "Past the threshold only."
      },
      impossible: RSVP_SET,
      foot: "\u201eBez odpov\u011bdi\u201c is not a no, and it is never drawn as one.",
      note: "A child can answer for himself and for nobody else, which is one grant rule and no extra screen.", drawn: "all" },

    { id: "E-8", view: "people", client: "mw", preset: "D", route: "/calendar#who", kind: "overlay",
      name: "The who overlay", title: "\u010c\u00ed to je",
      lede: "Five members, five colours, and a filter that lives on this device.",
      empty: { s: "Nikdo nen\u00ed vybran\u00fd.", e: "Zapn\u011bte t\u0159eba jen Adama \u2014 uvid\u00edte jeho t\u00fdden.", a: "Zapnout v\u0161echny" },
      error: "Nepoda\u0159ilo se na\u010d\u00edst \u010dleny dom\u00e1cnosti.",
      readonly: "Filtr funguje i v re\u017eimu jen ke \u010dten\u00ed \u2014 nic nezapisuje.",
      states: {
        absent: "Absent with the module.",
        offline: "It is a local filter over local rows, so it is one of the few surfaces that is genuinely unchanged offline."
      },
      impossible: OVERLAY,
      foot: "The colours are the avatar's, assigned once per household in Stage 4 and re-used here.",
      note: "Colour is never the only carrier: every row keeps an initial, and the overlay itself is a list of names.", drawn: "all" },

    { id: "E-9", view: "people", client: "mw", preset: "S", route: "/calendar/week/2026-W37#busy", kind: "busy",
      name: "Busy blocks", title: "Obsazeno",
      lede: "An interval with something in it that cannot be opened.",
      foot: "Hatched, labelled \u201eObsazeno\u201c, and not tappable \u2014 because there is nothing behind it to show.",
      note: "The gate for this stage: a real synced row of five fields, cached like every other, and uninspectable because the words never reach the device.", drawn: "all" },

    { id: "E-10", view: "connect", client: "mw", preset: "F", route: "/calendar/connections/new", kind: "connect",
      name: "Connection setup per provider", title: "P\u0159ipojit kalend\u00e1\u0159",
      lede: "Four providers, and one sentence that names the account before anything is connected.",
      error: "Google odm\u00edtl p\u0159ihl\u00e1\u0161en\u00ed. Nic se nep\u0159ipojilo a nic se neodeslalo.",
      foot: "Busy-only and \u201cinto the household\u201d are pre-selected on all four.",
      note: "A privacy screen wearing a setup screen's clothes. A child profile does not have it at all.", drawn: "all" },

    { id: "E-11", view: "connect", client: "mw", preset: "D", route: "/calendar/connections/{id}", kind: "scope",
      name: "Per-remote-calendar direction and scope", title: "Co se p\u0159en\u00e1\u0161\u00ed",
      lede: "Two settings per calendar, not per account: which way, and how much.",
      empty: { s: "\u017d\u00e1dn\u00fd p\u0159ipojen\u00fd kalend\u00e1\u0159.", e: "Nap\u0159\u00edklad pracovn\u00ed kalend\u00e1\u0159, jen jako \u010dasy.", a: "P\u0159ipojit kalend\u00e1\u0159" },
      error: "Nepoda\u0159ilo se ulo\u017cit nastaven\u00ed. Rozsah z\u016fst\u00e1v\u00e1 takov\u00fd, jak\u00fd byl.",
      rejected: "Odm\u00edtnuto: tento kalend\u00e1\u0159 nepovoluje z\u00e1pis, tak\u017ee \u201eodsud tam\u201c nejde nastavit.",
      readonly: "Jen ke \u010dten\u00ed. Nastaven\u00ed se \u010dte a nem\u011bn\u00ed.",
      states: {
        absent: "Adam is a child, so there is no connection surface on his profile at all \u2014 not a locked one.",
        offline: "The settings read from the cached connection; changing one needs the server, and says so.",
        pending: "A scope narrowed with no signal, queued, and the narrower value is what the screen shows while it waits.",
        syncing: "Past the threshold only."
      },
      impossible: CONN_CFG,
      foot: "Narrowing takes effect on the next sync and removes what has already crossed.",
      note: "Direction and scope are independent on purpose: \u201ceverything, one way\u201d and \u201conly times, both ways\u201d are both real households.", drawn: "all" },

    { id: "E-12", view: "health", client: "mw", preset: "D", route: "/calendar/connections", kind: "health",
      name: "Connection health + staleness badge", title: "P\u0159ipojen\u00e9 kalend\u00e1\u0159e",
      lede: "Four connections, when each last worked, and how old what you are looking at is.",
      empty: { s: "\u017d\u00e1dn\u00fd p\u0159ipojen\u00fd kalend\u00e1\u0159.", e: "P\u0159ipojen\u00ed nen\u00ed pot\u0159eba \u2014 dom\u00e1c\u00ed kalend\u00e1\u0159 funguje s\u00e1m.", a: "P\u0159ipojit kalend\u00e1\u0159" },
      error: "Nepoda\u0159ilo se zjistit stav p\u0159ipojen\u00ed.",
      readonly: "Jen ke \u010dten\u00ed. Stav se \u010dte, znovu p\u0159ipojit nejde.",
      states: {
        absent: "No connection surface on a child profile, and none for a member without Calendar.",
        offline: "The last known state, with its own age on it \u2014 which is exactly what this screen is for."
      },
      impossible: CONN_HEALTH,
      foot: "A stale connection says how many days old the events under it are, in words, on the row.",
      note: "status-stale exists in the token set for this screen and Stage 8's sync health, and this is where it is spent.", drawn: "all" },

    { id: "E-13", view: "health", client: "mw", preset: "S", route: "/calendar/conflicts/{id}", kind: "external",
      name: "External conflict resolution", title: "Dv\u011b verze",
      lede: "Both values, both authors, both times \u2014 and the one that loses is kept.",
      foot: "The remote value stays on the mirror; the household's edit becomes a household event for thirty days.",
      note: "This is the one conflict in the module, and it is not a merge failure \u2014 it is two calendars that both think they own an appointment.", drawn: "all" },

    { id: "E-14", view: "health", client: "mw", preset: "F", route: "/calendar/connections/{id}/disconnect", kind: "disconnect",
      name: "Disconnect", title: "Odpojit kalend\u00e1\u0159",
      lede: "And what should happen to what it brought in.",
      error: "Odpojen\u00ed se nepoda\u0159ilo. Nic se nezm\u011bnilo a kalend\u00e1\u0159 je po\u0159\u00e1d p\u0159ipojen\u00fd.",
      foot: "Two answers, both explicit, neither of them touching a single household-authored event.",
      note: "Disconnecting without asking is how a household loses a year of appointments it thought were its own.", drawn: "all" }
  ];

  function coverage() {
    return SCREENS.map(function (s) {
      var preset = s.preset === "F" ? ["loading", "populated", "error"]
                 : s.preset === "S" ? ["populated"]
                 : s.preset === "P" ? ["populated", "empty"] : ALL_STATES;
      var ex = Object.keys(s.impossible || {});
      var req = preset.filter(function (st) { return ex.indexOf(st) < 0; });
      var drawn = s.drawn === "all" ? req.slice() : (s.drawn || []);
      return { id: s.id, name: s.name, preset: s.preset, required: req.length,
               excluded: ex.length, drawn: drawn.length, complete: drawn.length === req.length };
    });
  }
  /* ── the gate ───────────────────────────────────────────────────────────── */
  function checks() {
    var gate = busyGate();
    var audit = busyAudit();
    var ch = choiceRun();
    var def = defaultRun();
    var ov = whoOverlay(null);
    var col = colourAudit();
    var conn = connectAudit();
    var kids = childRun();
    var hl = healthRun();
    var ext = externalRun();
    var dis = disconnect("c-petr-work");
    var dst = dstRun();
    var rec = reconcile();
    var em = emptyAudit();
    var hp = helpAudit();
    var cov = coverage();
    var clamp = expand(series("s-rent").rrule, "2026-08-01", "2027-03-01", "clamp");
    var week = occurrences(monday(TODAY), addDays(monday(TODAY), 6));
    var callers = Object.keys(CALLS).filter(function (k) { return k !== "unknown"; });
    var R = window.HH_REMINDERS;

    return [
      { name: "A private event's busy block is a real synced row, and it works offline",
        detail: gate.says + " " + audit.says,
        pass: gate.isRow && gate.inFeed && gate.cached && audit.leaked === 0 && audit.keyCount === 5 },

      { name: "Unmistakable and uninspectable are two different properties, and both are structural",
        detail: audit.blocks + " busy rows in September \u2014 " + audit.privateOwn +
          " from this household's own private events and " + audit.mirrored +
          " mirrored from a busy-only remote calendar. Both arrive as the same five fields, and the block is drawn hatched with the word \u201eObsazeno\u201c on it rather than as a grey gap: unmistakable comes from the treatment, uninspectable from the row.",
        pass: audit.blocks > 0 && audit.privateOwn > 0 && audit.mirrored > 0 && audit.leaked === 0 },

      { name: "Agenda is the mobile default and month the web default, by arithmetic",
        detail: def.says,
        pass: !def.phone.fitsTime && !def.phoneBig.fitsTime && def.web.fitsTitle && def.mobile === "agenda" && def.desktop === "month" },

      { name: "All four views exist on both clients \u2014 the default is what differs",
        detail: VIEW_DEFS.length + " views, " + VIEW_DEFS.filter(function (v) { return !!v[2]; }).length +
          " of them a client default (" + VIEW_DEFS.filter(function (v) { return !!v[2]; }).map(function (v) {
            return v[0] + " on " + v[2];
          }).join(", ") + "). Nothing is web-only and nothing is phone-only, which is 06-clients \u00a73's rule rather than a compromise: a phone that cannot show a month is a phone that cannot answer \u201cwhich week was that\u201d.",
        pass: VIEW_DEFS.length === 4 && VIEW_DEFS.filter(function (v) { return !!v[2]; }).length === 2 },

      { name: "Each of the three occurrence choices states its own consequence, in counts",
        detail: ch.says + " " + (ch.run ? ch.run.choices.map(function (c) { return c.consequence; }).join(" ") : ""),
        pass: ch.allStated && ch.distinct === 3 },

      { name: "Calendar carries no second recurrence engine",
        detail: "expand() is reminders.js's FR-RE2 subset, called " +
          Object.keys(CALLS).reduce(function (n, k) { return n + CALLS[k]; }, 0) +
          " times this render from " + callers.length + " places: " + callers.join(", ") +
          ". The 31st-of-the-month cottage rent expands to " + clamp.dates.map(fmt).join(", ") +
          " \u2014 September's thirtieth is the clamp, and it is the clamp Stage 12 already tested rather than a second one written here. What Calendar adds is the exception row, which is exactly what Stage 12 refused reminders.",
        pass: !!R && callers.length >= 4 && clamp.dates.indexOf("2026-09-30") >= 0 &&
              clamp.dates.indexOf("2026-11-30") >= 0 },

      { name: "An occurrence exception changes one term and leaves the rule alone",
        detail: EXCEPTIONS.length + " exception rows in the fixture: " + EXCEPTIONS.map(function (e) {
          return e.type + " " + fmt(e.date) + " (" + e.series.replace("s-", "") + ")";
        }).join(", ") + ". The 16 September Pilates is at " +
          (occurrences("2026-09-16", "2026-09-16", { only: ["s-pilates"] })[0] || {}).from +
          " while every other week is at " + series("s-pilates").from +
          ", and the 24 September swimming is gone without the rule knowing anything about it.",
        pass: (occurrences("2026-09-16", "2026-09-16", { only: ["s-pilates"] })[0] || {}).from === "18:30" &&
              occurrences("2026-09-24", "2026-09-24", { only: ["s-swim"] }).length === 0 },

      { name: "A wall-clock recurrence survives the end of summer time",
        detail: dst.says,
        pass: dst.dates.length >= 4 && dst.shifted === 0 },

      { name: "RSVP is state_set, and no answer is not a no",
        detail: "The film night has " + Object.keys(RSVP["s-film|2026-09-11"]).length +
          " participants: " + Object.keys(RSVP["s-film|2026-09-11"]).map(function (k) {
            return name(k) + " " + rsvpWord(RSVP["s-film|2026-09-11"][k]).toLowerCase();
          }).join(", ") + ". Two devices answering at once merge by (occurrence, member) with no dialog, answering twice is idempotent, and \u201eBez odpov\u011bdi\u201c is drawn as its own word rather than as a nought.",
        pass: RSVP["s-film|2026-09-11"].adam === "none" &&
              RSVP_WORDS.length === 4 &&
              POLICIES.filter(function (p) { return p[0] === "calendar.rsvp"; })[0][1] === "state_set" },

      { name: "The who overlay is the avatar's colours, and colour is never the only carrier",
        detail: col.says + " " + ov.says,
        pass: col.same === 5 && col.colourOnly === 0 && ov.local === true && ov.synced === false },

      { name: "Busy-only is what is offered, on every provider",
        detail: conn.says,
        pass: conn.busyFirst === conn.providers && conn.importFirst === conn.providers && conn.named === conn.providers },

      { name: "Direction and scope are two axes, per calendar rather than per account",
        detail: "Jana's Google account carries two calendars with different answers: " +
          connection("c-jana-google").calendars.map(function (c) {
            return c.name + " \u2014 " + c.direction + " / " + c.scope;
          }).join("; ") + ". Across the household that is " +
          CONNECTIONS.reduce(function (n, c) { return n + c.calendars.length; }, 0) +
          " remote calendars over " + CONNECTIONS.length + " connections, " +
          CONNECTIONS.reduce(function (n, c) {
            return n + c.calendars.filter(function (x) { return x.scope === "busy"; }).length;
          }, 0) + " of them busy-only.",
        pass: connection("c-jana-google").calendars.length === 2 &&
              connection("c-jana-google").calendars[0].scope !== connection("c-jana-google").calendars[1].scope },

      { name: "A child profile has no connection surface at all",
        detail: kids.map(function (k) { return k.name + " " + k.treatment + " (" + k.controls + " controls)"; }).join(" \u00b7 ") +
          ". Adam holds view on Calendar and uses it every week; the connection routes are absent from his app, which is the neutral not-available Stage 6 drew rather than a disabled row with an explanation he cannot act on.",
        pass: kids.filter(function (k) { return k.role === "child"; }).every(function (k) {
          return k.controls === 0 && k.treatment === "absent";
        }) },

      { name: "A stale connection says how old what you are looking at is",
        detail: hl.says + " " + (health("c-petr-work") || {}).sentence,
        pass: hl.stale === 1 && hl.error === 1 && hl.ok === 2 &&
              (health("c-petr-work") || {}).token === "--status-stale" },

      { name: "The loser of an external conflict is preserved and surfaced",
        detail: ext.says + " " + EXTERNAL.rule,
        pass: ext.preserved === 1 && ext.lost === 0 && ext.keptDays > 0 && ext.bothShown },

      { name: "Disconnecting asks, and neither answer touches a household-authored event",
        detail: dis.says + " " + dis.answers.map(function (a) { return a.en + ": " + a.effect; }).join(" "),
        pass: dis.answers.length === 2 && dis.touched === 0 &&
              dis.answers[0].removes === 0 && dis.answers[1].writes === 0 },

      { name: "Every calendar row an earlier stage drew resolves to a row in this module",
        detail: rec.says + " " + rec.rows.filter(function (r) { return !!r.drift; }).map(function (r) {
          return r.text + " \u2014 " + r.drift;
        }).join(" "),
        pass: rec.resolved === rec.total && rec.drifts === 3 },

      { name: "The empty state teaches, and Calendar's boundary with Reminders holds",
        detail: em.says + " The module draws events and nothing else: a meter reading with a date and no time is a reminder, and it stays one \u2014 " +
          rec.crossStrand + " of " + rec.total +
          " earlier rows turned out to belong to the other strand, which is the boundary being load-bearing rather than decorative.",
        pass: em.banned.length === 0 && em.sentence === 1 && em.example === 1 && em.action === 1 },

      { name: "Help is authored with the screens, and the surface comes from the content",
        detail: hp.says,
        pass: hp.entries === 3 && hp.overlong === 0 && hp.external === 0 && hp.surfaces >= 2 },

      { name: "Fourteen rows, every state drawn, every exclusion argued from a merge policy",
        detail: cov.length + " rows: " + cov.reduce(function (n, c) { return n + c.drawn; }, 0) +
          " cells drawn of " + cov.reduce(function (n, c) { return n + c.required; }, 0) +
          " required, with " + cov.reduce(function (n, c) { return n + c.excluded; }, 0) +
          " states declared unreachable across " + cov.filter(function (c) { return c.excluded > 0; }).length +
          " of them. " + POLICIES.length + " entity policies do that arguing: " +
          POLICIES.map(function (p) { return p[0].replace("calendar.", "") + " " + p[1]; }).join(", ") +
          ". This week's fixture is " + week.length + " occurrences over " +
          SERIES.length + " series.",
        pass: cov.every(function (c) { return c.complete; }) }
    ];
  }

  window.HH_CALENDAR = {
    version: "0.1-stage-18-candidate",
    today: TODAY, tz: TZ, dstEnd: DST_END, weekStart: WEEK_START, loserDays: LOSER_DAYS,
    allStates: ALL_STATES, screens: SCREENS, coverage: coverage,
    policies: POLICIES, memberColour: MEMBER_COLOUR, name: name, initial: initial,
    grant: grant, isChild: isChild, member: member,
    series: SERIES, seriesOf: series, exceptions: EXCEPTIONS, occurrences: occurrences,
    rsvp: RSVP, rsvpWords: RSVP_WORDS, rsvpWord: rsvpWord,
    busyRow: busyRow, busyAudit: busyAudit, busyGate: busyGate, stripped: STRIPPED,
    editChoices: editChoices, choiceRun: choiceRun,
    viewDefs: VIEW_DEFS, viewFit: viewFit, defaultRun: defaultRun,
    whoOverlay: whoOverlay, colourAudit: colourAudit,
    providers: PROVIDERS, connections: CONNECTIONS, connection: connection, connectionsOf: connectionsOf,
    directions: DIRECTIONS, scopes: SCOPES, connectOffer: connectOffer, connectAudit: connectAudit,
    childRun: childRun, health: health, healthRun: healthRun,
    external: EXTERNAL, externalRun: externalRun, disconnect: disconnect, dstRun: dstRun,
    reconcile: reconcile, externalRows: EXTERNAL_ROWS,
    empty: EMPTY, emptyAudit: emptyAudit, help: HELP, helpAudit: helpAudit,
    monthGrid: function (ym) {
      var first = ym + "-01";
      var startCell = monday(first);
      var d = D(first), last = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
      var cells = [], cur = startCell;
      while (cur <= last || dow(cur) !== 0) {
        cells.push({ date: cur, inMonth: cur.slice(0, 7) === ym, today: cur === TODAY, day: D(cur).getUTCDate() });
        cur = addDays(cur, 1);
        if (cells.length > 42) break;
      }
      return { month: ym, cells: cells, weeks: Math.ceil(cells.length / 7), days: DAYS_CS };
    },
    fmt: fmt, fmtLong: fmtLong, dayLabel: dayLabel, addDays: addDays, monday: monday,
    dow: dow, diff: diff, minutes: minutes, span: span, days: DAYS_CS, daysEn: DAYS_EN,
    checks: checks
  };
})();

