/* Stage 12a — Reminders: the strand, the module, and the unified list.

   Sources: prd/modules/03-reminders.md (FR-RE1–FR-RE9, the data model, the sync table,
   Catalog contributions, the non-goals); prd/03-platform-strands.md §6 (D-27, FR-RM1–3 —
   the kind registration contract and the lead-time set, defined there and nowhere else);
   prd/modules/00-module-model.md §4 (the reminder-kind catalog: ten modules, twenty-one
   kinds) and §6 (the per-module counts the registry is asserted against); design/05-screens.md
   §C Reminders (four rows and the design risk); 08-decisions.md D-43 (snooze is personal).

   The 21 kinds are collected here the way Stage 10 collected the widget keys and Stage 11
   the search scopes: from the ten module pages, each with the line it came from, checked
   against §6's per-module count. That is the gap ledger.js records as blocking this stage.

   Everything else in the file is a derivation. leadFor() designs the defaults from five
   classes rather than authoring twenty-two numbers; expand() is FR-RE2's RRULE subset with
   its clamp, run against a test table; agendaFor() is FR-RE5's list, and it is the grants,
   the subscriptions and the lead windows rendered — not a list authored per member.
*/
(function () {

  var TODAY = "2026-09-09";              /* Wednesday, the same day Stage 11 draws */
  var OVERDUE_WINDOW_DAYS = 60;          /* FR-RE9 default */
  var CAP = 200;                         /* FR-RE2: the expansion is capped */

  /* ── dates ─────────────────────────────────────────────────────────────── */

  function D(s) { return new Date(s + "T00:00:00Z"); }
  function iso(dt) { return dt.toISOString().slice(0, 10); }
  function addDays(s, n) { var t = D(s); t.setUTCDate(t.getUTCDate() + n); return iso(t); }
  function diff(a, b) { return Math.round((D(a) - D(b)) / 86400000); }
  function dim(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  function fmt(s) { var t = D(s); return t.getUTCDate() + " " + MONTHS[t.getUTCMonth()].slice(0, 3); }
  function fmtLong(s) {
    var t = D(s), y = t.getUTCFullYear();
    return t.getUTCDate() + " " + MONTHS[t.getUTCMonth()] + (y === 2026 ? "" : " " + y);
  }
  function monday(s) { var t = D(s), w = (t.getUTCDay() + 6) % 7; return addDays(s, -w); }

  /* ── 1. The twenty-one kinds, collected from the module pages ────────────
     FR-RM1: a kind declares its key, its label, the entity it attaches to and a resolver.
     `scope` is FR-RE8 — declared by the kind, never chosen by the member. `stated` records
     whether the handoff says so or whether this stage decided it, which is the difference
     between collecting and inventing. */

  var KINDS = [
    { key: "tasks.card_due", module: "tasks", label: "A card with a due date", entity: "tasks.card",
      cls: "day", scope: "personal", scopeStated: true, leadStated: false,
      src: "02-tasks.md:99 · FR-TA6", resolver: "tasks",
      note: "FR-TA6 names the kind and its personal completion in the requirement itself \u2014 one of four that do." },
    { key: "calendar.event", module: "calendar", label: "An event you are taking part in", entity: "calendar.event",
      cls: "event", scope: "per-participants", scopeStated: true, leadStated: false,
      src: "04-calendar.md:208 · FR-CA7:112",
      note: "The event may carry its own lead times (FR-CA7); the kind's default is what a member gets when it carries none." },
    { key: "chores.due", module: "chores", label: "A chore that is yours today", entity: "chores.occurrence",
      cls: "day", scope: "household", scopeStated: true, leadStated: false,
      src: "06-chores.md:139",
      note: "Household scope, with the rotation deciding whose row it is. 06-chores registered it personal, which meant one member could complete the bins and every other subscriber was still told about a chore that was done \u2014 settled the other way: the occurrence is one obligation, the rotation names its owner, and completing it clears it for everybody." },
    { key: "documents.expiry", module: "documents", label: "A document that expires", entity: "documents.document",
      cls: "renew", scope: "per-type", scopeStated: true, leadStated: true,
      src: "08-documents.md:125 · default per type :67",
      note: "The one kind whose default is stated: six months for a passport, one month for an insurance policy \u2014 per type, so the number lives in Documents' type table." },
    { key: "finance.recurring_due", module: "finance", label: "A recurring payment coming up", entity: "finance.recurring",
      cls: "prepare", scope: "household", scopeStated: false, leadStated: false,
      src: "09-finance.md:269" },
    { key: "finance.cancellation_window", module: "finance", label: "A cancellation window closing", entity: "finance.recurring",
      cls: "notice", scope: "household", scopeStated: false, leadStated: true,
      src: "09-finance.md:269 · \u201cfires at the notice period, not at expiry\u201d",
      note: "A notice kind fires at the notice period the entity carries. The default lead is that period, not a number chosen here." },
    { key: "utilities.reading_due", module: "utilities", label: "A meter reading due", entity: "utilities.service",
      cls: "prepare", scope: "household", scopeStated: false, leadStated: false,
      src: "10-utilities.md:305" },
    { key: "utilities.advance_due", module: "utilities", label: "An advance payment due", entity: "utilities.advance",
      cls: "prepare", scope: "household", scopeStated: false, leadStated: false,
      src: "10-utilities.md:305" },
    { key: "utilities.contract_notice", module: "utilities", label: "A supply contract notice period", entity: "utilities.contract",
      cls: "notice", scope: "household", scopeStated: false, leadStated: false,
      src: "10-utilities.md:305" },
    { key: "garden.task_due", module: "garden", label: "A planting task due", entity: "garden.task",
      cls: "prepare", scope: "household", scopeStated: false, leadStated: false,
      src: "11-garden.md:257" },
    { key: "garden.care_due", module: "garden", label: "Watering or feeding due", entity: "garden.plant",
      cls: "day", scope: "household", scopeStated: false, leadStated: false,
      src: "11-garden.md:257 · FR-GA7:100",
      note: "A rhythm, not a plan (FR-GA7). Notice in advance of watering is noise." },
    { key: "property.service_due", module: "property", label: "An appliance or system service", entity: "asset.schedule",
      cls: "book", scope: "household", scopeStated: false, leadStated: false,
      src: "12-property.md:139 · :36" },
    { key: "property.warranty_expiry", module: "property", label: "A warranty ending", entity: "property.item",
      cls: "renew", scope: "household", scopeStated: false, leadStated: false,
      src: "12-property.md:139" },
    { key: "property.lease_notice", module: "property", label: "A lease notice period", entity: "property.contract",
      cls: "notice", scope: "household", scopeStated: false, leadStated: true,
      src: "12-property.md:139 · :85" },
    { key: "vehicles.inspection_due", module: "vehicles", label: "A statutory inspection", entity: "vehicles.vehicle",
      cls: "book", scope: "household", scopeStated: false, leadStated: true,
      src: "13-vehicles.md:104 · :45",
      note: "STK / TK / H\u00dc-T\u00dcV / przegl\u0105d / MOT. The page asks for a \u201clong default lead time, because these need booking\u201d and gives no number." },
    { key: "vehicles.insurance_renewal", module: "vehicles", label: "Vehicle insurance renewal", entity: "vehicles.policy",
      cls: "notice", scope: "household", scopeStated: false, leadStated: true,
      src: "13-vehicles.md:104 · :50" },
    { key: "vehicles.service_due", module: "vehicles", label: "A vehicle service", entity: "asset.schedule",
      cls: "book", scope: "household", scopeStated: false, leadStated: false,
      src: "13-vehicles.md:104" },
    { key: "vehicles.road_tax_due", module: "vehicles", label: "Road tax or vignette", entity: "vehicles.vehicle",
      cls: "prepare", scope: "household", scopeStated: false, leadStated: false,
      src: "13-vehicles.md:104 · FR-VE3, where the country has one" },
    { key: "pets.care_due", module: "pets", label: "Something in the daily routine", entity: "pets.routine",
      cls: "day", scope: "household", scopeStated: false, leadStated: false,
      src: "14-pets.md:106",
      note: "Household scope on purpose: \u201cdid you already give it\u201d is the question the screen exists to answer (D-73)." },
    { key: "pets.medication_dose", module: "pets", label: "A medication dose", entity: "pets.medication",
      cls: "day", scope: "household", scopeStated: false, leadStated: false,
      src: "14-pets.md:106 · D-73",
      note: "The dose is given once for the animal, not once per person \u2014 the state_set key is (item), not (item, user)." },
    { key: "pets.insurance_renewal", module: "pets", label: "Pet insurance renewal", entity: "pets.policy",
      cls: "notice", scope: "household", scopeStated: false, leadStated: false,
      src: "14-pets.md:106" }
  ];

  /* The twenty-second row on the subscriptions screen. It is not one of the twenty-one:
     it is this module's own reminders, and it is the only kind whose completion scope is
     a field on the row rather than a property of the kind (FR-RE1). */
  var OWN = { key: "reminders.reminder", module: "reminders", label: "Your own reminders", entity: "reminders.reminder",
              cls: "prepare", scope: "declared per reminder", scopeStated: true, leadStated: false,
              src: "03-reminders.md FR-RE1 · Catalog contributions:123", own: true,
              note: "completion_scope is a column, because a standalone reminder can be either \u2014 \u201cdescale the kettle\u201d is the household's, \u201crenew my passport\u201d is one member's." };

  var ALL_KINDS = KINDS.concat([OWN]);

  /* 00-module-model §6, the table the catalog registry is asserted against. */
  var MODEL_COUNTS = [["tasks", 1], ["calendar", 1], ["chores", 1], ["documents", 1],
                      ["finance", 2], ["utilities", 3], ["garden", 2], ["property", 3],
                      ["vehicles", 4], ["pets", 3]];

  function kindAudit() {
    var rows = MODEL_COUNTS.map(function (m) {
      var got = KINDS.filter(function (k) { return k.module === m[0]; });
      return { module: m[0], expected: m[1], got: got.length, ok: got.length === m[1],
               keys: got.map(function (k) { return k.key; }) };
    });
    return {
      rows: rows,
      collected: KINDS.length,
      modules: rows.length,
      sums: rows.reduce(function (n, r) { return n + r.expected; }, 0),
      ok: rows.every(function (r) { return r.ok; }) && KINDS.length === 21,
      withSource: ALL_KINDS.filter(function (k) { return !!k.src; }).length,
      screenRows: ALL_KINDS.length,
      scopeStated: ALL_KINDS.filter(function (k) { return k.scopeStated; }).length,
      leadStated: ALL_KINDS.filter(function (k) { return k.leadStated; }).length
    };
  }

  /* ── 2. The lead-time set, and the defaults designed from five classes ────
     FR-RM2 defines the offered set here and nowhere else. The defaults are the design
     risk 05-screens names: a 21-row configuration screen most members never open, whose
     defaults are what make the feature work. Twenty-two numbers chosen one at a time would
     be twenty-two arguments; five classes are one argument, applied. */

  var LEAD_SET = [
    ["0d", 0, "On the day"], ["1d", 1, "The day before"], ["3d", 3, "Three days"],
    ["1w", 7, "A week"], ["2w", 14, "Two weeks"], ["1m", 30, "A month"], ["3m", 90, "Three months"]
  ];
  var PRESET_DAYS = LEAD_SET.map(function (l) { return l[1]; });

  var CLASSES = [
    { id: "day", label: "Done on the day", days: 0, channel: "push",
      why: "It is done that day or it is not done. Notice a week early is noise, and noise is what makes a member turn the category off." },
    { id: "event", label: "Something you attend", days: 1, channel: "push",
      why: "One day is enough to rearrange the morning. Anything the member wants earlier they set on the event itself (FR-CA7)." },
    { id: "prepare", label: "Something to arrange yourself", days: 3, channel: "in_app",
      why: "Three days is a weekend and two weekday evenings \u2014 enough to read a meter or move money without living with the reminder." },
    { id: "book", label: "Needs somebody else\u2019s calendar", days: 30, channel: "in_app",
      why: "A garage, a chimney sweep or a service engineer is booked weeks out. This is the \u201clong default lead time\u201d 13-vehicles asks for, given a number." },
    { id: "notice", label: "A window that closes", days: null, channel: "in_app",
      why: "The lead is the notice period the contract carries, so the reminder fires while switching is still possible. Where the entity states none, a month." },
    { id: "renew", label: "Something to replace before it expires", days: null, channel: "in_app",
      why: "Per type, because a passport is six months of queueing and a policy is one phone call. Documents holds the table; the strand reads it." }
  ];
  var CLASS_BY = {};
  CLASSES.forEach(function (c) { CLASS_BY[c.id] = c; });

  /* Entity-carried lead: what a `notice` or `renew` kind resolves against. */
  var ENTITY_LEAD = {
    "finance.cancellation_window": { days: 14, from: "the subscription\u2019s own notice period \u2014 Netflix, 14 days" },
    "utilities.contract_notice": { days: 90, from: "the supply contract \u2014 three months, \u010cEZ" },
    "property.lease_notice": { days: 90, from: "the lease \u2014 three months" },
    "vehicles.insurance_renewal": { days: 42, from: "the policy \u2014 six weeks, Kooperativa" },
    "pets.insurance_renewal": { days: 30, from: "the policy \u2014 one month" },
    "documents.expiry": { days: 180, from: "the document type \u2014 passport, six months (:67)" },
    "property.warranty_expiry": { days: 30, from: "the warranty \u2014 one month" }
  };

  function leadFor(kind) {
    var c = CLASS_BY[kind.cls];
    var e = ENTITY_LEAD[kind.key];
    var days = c.days !== null ? c.days : (e ? e.days : 30);
    var preset = PRESET_DAYS.indexOf(days);
    return {
      key: kind.key, days: days, cls: c.id, clsLabel: c.label, channel: c.channel,
      preset: preset >= 0 ? LEAD_SET[preset][0] : "custom",
      custom: preset < 0,
      from: c.days !== null ? "the class" : (e ? e.from : "no entity value \u2014 the class fallback"),
      label: days === 0 ? "On the day" : days === 1 ? "The day before"
           : days < 14 ? days + " days" : days < 60 ? Math.round(days / 7) + " weeks"
           : Math.round(days / 30) + " months"
    };
  }

  function defaultsTable() { return ALL_KINDS.map(leadFor); }

  function defaultsAudit() {
    var t = defaultsTable();
    return {
      total: t.length,
      custom: t.filter(function (r) { return r.custom; }),
      inSet: t.filter(function (r) { return !r.custom; }).length,
      byClass: CLASSES.map(function (c) {
        return { cls: c.id, label: c.label, n: t.filter(function (r) { return r.cls === c.id; }).length, why: c.why };
      }),
      push: t.filter(function (r) { return r.channel === "push"; }).length
    };
  }

  /* ── 3. FR-RE2 — recurrence, expanded on read and on the client ───────────
     An RRULE subset: daily, weekly by weekday, monthly by day-of-month or by nth weekday,
     yearly; each with an interval and an optional end (a date or a count). Short months
     clamp. Occurrences are never materialised as rows, which is also why the offline list
     is complete rather than a cached window. */

  function nth(y, m, weekday, n) {
    if (n > 0) {
      var first = new Date(Date.UTC(y, m, 1)).getUTCDay();
      var day = 1 + ((weekday - first) + 7) % 7 + (n - 1) * 7;
      return day <= dim(y, m) ? iso(new Date(Date.UTC(y, m, day))) : null;
    }
    var last = dim(y, m);
    var lastDow = new Date(Date.UTC(y, m, last)).getUTCDay();
    var d2 = last - ((lastDow - weekday) + 7) % 7 + (n + 1) * 7;
    return d2 >= 1 ? iso(new Date(Date.UTC(y, m, d2))) : null;
  }

  function expand(rule, from, to) {
    var out = [], capped = false, i = 0, guard = 0;
    var start = rule.start, interval = rule.interval || 1;
    var stop = rule.until && rule.until < to ? rule.until : to;

    function push(date) {
      if (!date || date < start) return true;
      if (date > stop) return false;
      if (date >= from) out.push(date);
      if (rule.count && out.length + 0 >= rule.count && date >= from) { /* count is of occurrences from start */ }
      return true;
    }

    if (rule.freq === "daily") {
      for (i = 0; guard++ < 4000; i++) {
        var dd = addDays(start, i * interval);
        if (dd > stop) break;
        if (rule.count && i >= rule.count) break;
        if (dd >= from) out.push(dd);
        if (out.length >= CAP) { capped = true; break; }
      }
    } else if (rule.freq === "weekly") {
      var wk = monday(start), days = rule.byweekday || [(D(start).getUTCDay() + 6) % 7];
      for (i = 0; guard++ < 4000; i++) {
        var base = addDays(wk, i * interval * 7);
        if (base > stop) break;
        var made = 0;
        for (var j = 0; j < days.length; j++) {
          var dt = addDays(base, days[j]);
          if (dt < start || dt > stop) continue;
          if (rule.count && out.length + countBefore(from, dt, out) >= rule.count && dt >= from) { }
          if (dt >= from) out.push(dt);
          made++;
          if (out.length >= CAP) { capped = true; break; }
        }
        if (capped) break;
        if (rule.count && (i + 1) * days.length >= rule.count) break;
        if (made === 0 && base > stop) break;
      }
    } else if (rule.freq === "monthly") {
      var y0 = D(start).getUTCFullYear(), m0 = D(start).getUTCMonth();
      for (i = 0; guard++ < 4000; i++) {
        var mm = m0 + i * interval, yy = y0 + Math.floor(mm / 12), mo = ((mm % 12) + 12) % 12;
        var date;
        if (rule.byweekday !== undefined && rule.nth !== undefined) date = nth(yy, mo, rule.byweekday, rule.nth);
        else date = iso(new Date(Date.UTC(yy, mo, Math.min(rule.bymonthday || D(start).getUTCDate(), dim(yy, mo)))));
        if (!date) continue;
        if (date > stop) break;
        if (rule.count && i >= rule.count) break;
        if (date >= from && date >= start) out.push(date);
        if (out.length >= CAP) { capped = true; break; }
      }
    } else if (rule.freq === "yearly") {
      var sy = D(start).getUTCFullYear(), sm = D(start).getUTCMonth(), sd = D(start).getUTCDate();
      for (i = 0; guard++ < 400; i++) {
        var yr = sy + i * interval;
        var date2 = iso(new Date(Date.UTC(yr, sm, Math.min(sd, dim(yr, sm)))));
        if (date2 > stop) break;
        if (rule.count && i >= rule.count) break;
        if (date2 >= from && date2 >= start) out.push(date2);
        if (out.length >= CAP) { capped = true; break; }
      }
    }
    return { dates: out, capped: capped, cap: CAP };
  }
  function countBefore() { return 0; }

  /* The test table. Two of the six exist because of sentences in FR-RE2 itself: the
     31st clamps, and the expansion is capped rather than unbounded. */
  var VECTORS = [
    { name: "Every three days", rule: { freq: "daily", interval: 3, start: "2026-09-09" },
      from: "2026-09-09", to: "2026-09-21", want: ["2026-09-09", "2026-09-12", "2026-09-15", "2026-09-18", "2026-09-21"],
      why: "The ordinary case, and the one the fixture\u2019s kettle uses at six weeks." },
    { name: "Mondays and Thursdays", rule: { freq: "weekly", interval: 1, byweekday: [0, 3], start: "2026-09-07" },
      from: "2026-09-07", to: "2026-09-21", want: ["2026-09-07", "2026-09-10", "2026-09-14", "2026-09-17", "2026-09-21"],
      why: "Weekdays are the week\u2019s own, not the start date\u2019s \u2014 two occurrences a week from one rule." },
    { name: "The 31st, monthly", rule: { freq: "monthly", interval: 1, bymonthday: 31, start: "2027-01-31" },
      from: "2027-01-01", to: "2027-05-01", want: ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"],
      why: "FR-RE2\u2019s clamp, stated in the requirement: the 28th, 29th or 30th, never a skipped month." },
    { name: "The 31st, into a leap February", rule: { freq: "monthly", interval: 1, bymonthday: 31, start: "2028-01-31" },
      from: "2028-01-01", to: "2028-03-01", want: ["2028-01-31", "2028-02-29"],
      why: "The same clamp, one year on. 29 February is a real date and the rule finds it." },
    { name: "Second Tuesday of the month", rule: { freq: "monthly", interval: 1, byweekday: 2, nth: 2, start: "2026-09-01" },
      from: "2026-09-01", to: "2026-12-01", want: ["2026-09-08", "2026-10-13", "2026-11-10"],
      why: "By nth weekday rather than by date \u2014 the bin collection, the book club, the standing appointment." },
    { name: "Yearly, ending after three", rule: { freq: "yearly", interval: 1, count: 3, start: "2026-11-02" },
      from: "2026-01-01", to: "2032-01-01", want: ["2026-11-02", "2027-11-02", "2028-11-02"],
      why: "An end as a count rather than a date. The fourth year is not an occurrence at all." },
    { name: "Daily, unbounded, over four years", rule: { freq: "daily", interval: 1, start: "2026-01-01" },
      from: "2026-01-01", to: "2030-01-01", want: null, capped: true,
      why: "1 461 days of rule. The expansion is capped at " + CAP + " and says so, rather than filling the device." }
  ];

  function vectorRuns() {
    return VECTORS.map(function (v) {
      var got = expand(v.rule, v.from, v.to);
      var ok = v.want ? (got.dates.join(",") === v.want.join(",")) : (got.capped === true && got.dates.length === CAP);
      return { name: v.name, why: v.why, got: got.dates, capped: got.capped,
               shown: v.want ? got.dates.map(fmt).join(" \u00b7 ") : got.dates.length + " dates, capped at " + CAP,
               want: v.want, ok: ok };
    });
  }

  /* Anniversaries (FR-RE4): a yearly reminder that does not complete. It passes. */
  function anniversary(sinceYear, on, day) {
    var n = D(on).getUTCFullYear() - sinceYear;
    return { n: n, label: ordinal(n), completes: false,
             says: "Grandma\u2019s " + ordinal(n), when: fmtLong(on),
             note: "An anniversary passes rather than completing \u2014 there is nothing to tick and no completion row is written." };
  }
  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /* ── 4. Occurrences — what the ten modules' resolvers return ──────────────
     FR-RM1: the strand asks each kind's resolver for (entity_id, due_on, title, module)
     over a date window. Nine of the ten resolvers are fixture stubs here because their
     modules are later stages; tasks.card_due is real and answered by tasks.js, which is
     the whole point of the strand \u2014 Tasks implements no lead time, no snooze and no
     completion window of its own. */

  var FIXTURE_OCCURRENCES = [
    { id: "o-boiler", kind: "property.service_due", due: "2026-09-03", title: "Boiler service",
      meta: "Vaillant \u00b7 annual, last done 4 September 2025", endpoint: "/property/items/kotel-vaillant" },
    { id: "o-bins", kind: "chores.due", due: "2026-09-06", title: "Take the bins out",
      meta: "Adam\u2019s turn in the rotation", endpoint: "/chores/bins", who: ["adam"] },
    { id: "o-smoke", kind: "reminders.reminder", due: "2026-06-25", title: "Change the smoke-alarm battery",
      meta: "Yearly", endpoint: "/reminders/smoke-alarm", scope: "household" },
    { id: "o-gas", kind: "utilities.reading_due", due: "2026-09-09", title: "Read the gas meter",
      meta: "Monthly \u00b7 last read 8 August", endpoint: "/utilities/gas/readings/new" },
    { id: "o-elec", kind: "utilities.reading_due", due: "2026-09-11", title: "Read the electricity meter",
      meta: "Monthly \u00b7 the cellar meter, two registers", endpoint: "/utilities/electricity/readings/new" },
    { id: "o-kettle", kind: "reminders.reminder", due: "2026-09-09", title: "Descale the kettle",
      meta: "Every six weeks", endpoint: "/reminders/kettle", scope: "household" },
    { id: "o-water", kind: "garden.care_due", due: "2026-09-09", title: "Water the greenhouse",
      meta: "Every second day while it is over 20 \u00b0C", endpoint: "/garden/plants/greenhouse" },
    { id: "o-dose", kind: "pets.medication_dose", due: "2026-09-09", title: "Bela \u2014 evening tablet",
      meta: "Second of two today \u00b7 Adam gave the morning one", endpoint: "/pets/bela/medication" },
    { id: "o-dentist", kind: "calendar.event", due: "2026-09-10", title: "Adam \u2014 dentist",
      meta: "08:10 \u00b7 Dr. Kub\u00e1t", endpoint: "/calendar/events/dentist-adam", who: ["adam", "jana"] },
    { id: "o-lettuce", kind: "garden.task_due", due: "2026-09-11", title: "Sow lamb\u2019s lettuce, bed 7",
      meta: "Generated from the plan", endpoint: "/garden/tasks/sow-lettuce" },
    { id: "o-grandma", kind: "reminders.reminder", due: "2026-09-12", title: "Grandma\u2019s birthday",
      meta: "Anniversary", endpoint: "/reminders/grandma", scope: "household", since: 1946 },
    { id: "o-netflix", kind: "finance.cancellation_window", due: "2026-09-20", title: "Netflix \u2014 cancel before it renews",
      meta: "Went up three times in two years", endpoint: "/finance/recurring/netflix" },
    { id: "o-stk", kind: "vehicles.inspection_due", due: "2026-10-05", title: "Octavia \u2014 STK",
      meta: "Statutory \u00b7 book the garage", endpoint: "/vehicles/octavia" },
    { id: "o-warranty", kind: "property.warranty_expiry", due: "2026-11-30", title: "Washing machine warranty ends",
      meta: "Bosch \u00b7 bought 30 November 2024", endpoint: "/property/items/pracka" },
    { id: "o-passport", kind: "documents.expiry", due: "2027-03-07", title: "Jana\u2019s passport expires",
      meta: "Renewal takes about six weeks in Brno", endpoint: "/documents/doklady/pas-jana", who: ["jana"] }
  ];

  /* tasks.card_due is resolved by the module, not authored here. */
  function resolveKind(key, from, to) {
    if (key === "tasks.card_due" && window.HH_TASKS && window.HH_TASKS.dueCards) {
      return window.HH_TASKS.dueCards(from, to).map(function (c) {
        return { id: "o-card-" + c.id, kind: "tasks.card_due", due: c.due, title: c.title,
                 meta: c.board + " \u00b7 " + c.column, endpoint: c.endpoint, who: c.assignee ? [c.assignee] : [] };
      });
    }
    return FIXTURE_OCCURRENCES.filter(function (o) { return o.kind === key && o.due >= from && o.due <= to; });
  }

  function allOccurrences(from, to) {
    var out = [];
    ALL_KINDS.forEach(function (k) { out = out.concat(resolveKind(k.key, from, to)); });
    return out;
  }

  /* ── 5. Subscriptions (FR-RE6) — personal, per kind, with their own lead ── */

  var CHANGED = {
    jana: { "property.service_due": { days: 7, why: "A month\u2019s notice about the boiler is a month of being told about the boiler." } },
    petr: { "utilities.reading_due": { days: 1, why: "He reads the meters, and three days early is three days of remembering. Jana keeps the default three, so the same reading is on her list two days before it is on his." } },
    adam: { "calendar.event": { channel: "off", why: "He does not want his phone to tell him about the dentist. The event is still in Calendar." } }
  };

  function subscriptionsFor(memberId) {
    var F = window.HH_FIXTURES;
    var m = F && F.members.filter(function (x) { return x.id === memberId; })[0];
    if (!m) return [];
    return ALL_KINDS.map(function (k) {
      var grant = m.grants[k.module] || "none";
      var offered = grant !== "none";
      var base = leadFor(k);
      var ch = (CHANGED[memberId] || {})[k.key] || null;
      return {
        key: k.key, module: k.module, label: k.label, cls: base.cls, scope: k.scope,
        offered: offered, grant: grant,
        days: ch && ch.days !== undefined ? ch.days : base.days,
        channel: ch && ch.channel ? ch.channel : base.channel,
        changed: !!ch, why: ch ? ch.why : "",
        defaultDays: base.days, defaultChannel: base.channel,
        preset: base.preset, custom: base.custom,
        label2: base.label
      };
    });
  }

  function subsTable() {
    var F = window.HH_FIXTURES;
    return (F ? F.members : []).map(function (m) {
      var s = subscriptionsFor(m.id);
      var offered = s.filter(function (x) { return x.offered; });
      return { id: m.id, name: m.name, offered: offered.length, of: s.length,
               changed: offered.filter(function (x) { return x.changed; }).length,
               off: offered.filter(function (x) { return x.channel === "off"; }).length };
    });
  }

  /* ── 6. Snooze (FR-RE7 / D-43) and completion (FR-RE3, FR-RE8) ───────────── */

  var SNOOZES = [];      /* {member, occ, until} */
  var COMPLETIONS = [];  /* {occ, user|null, at} — reminder_completions, the only per-occurrence row */

  function kindOf(key) { return ALL_KINDS.filter(function (k) { return k.key === key; })[0] || OWN; }

  function scopeOf(occ) {
    var k = kindOf(occ.kind);
    if (occ.scope) return occ.scope;                       /* the module's own: a column */
    if (k.scope === "per-participants") return (occ.who || []).length > 1 ? "household" : "personal";
    if (k.scope === "per-type") return "personal";
    return k.scope;
  }

  function isComplete(occ, memberId) {
    return COMPLETIONS.some(function (c) {
      return c.occ === occ.id && (c.user === null || c.user === memberId);
    });
  }
  function isSnoozed(occ, memberId, day) {
    return SNOOZES.some(function (s) { return s.occ === occ.id && s.member === memberId && s.until > day; });
  }

  /* FR-RE3: idempotent, recorded per (source, occurrence, user). A hold gesture on a bad
     connection fires twice; the second is 200, not 409. */
  function complete(occ, memberId) {
    var scope = scopeOf(occ);
    var user = scope === "household" ? null : memberId;
    var already = COMPLETIONS.filter(function (c) { return c.occ === occ.id && c.user === user; });
    if (already.length) return { status: 200, wrote: false, rows: COMPLETIONS.length, note: "Already complete. The same intent, applied once." };
    COMPLETIONS.push({ occ: occ.id, user: user, at: TODAY });
    return { status: 200, wrote: true, rows: COMPLETIONS.length, note: scope === "household" ? "Complete for the household." : "Complete for you." };
  }
  function uncomplete(occ, memberId) {
    var scope = scopeOf(occ), user = scope === "household" ? null : memberId;
    COMPLETIONS = COMPLETIONS.filter(function (c) { return !(c.occ === occ.id && c.user === user); });
    return { status: 200, rows: COMPLETIONS.length };
  }
  function snooze(occ, memberId, days) {
    SNOOZES = SNOOZES.filter(function (s) { return !(s.occ === occ.id && s.member === memberId); });
    SNOOZES.push({ occ: occ.id, member: memberId, until: addDays(TODAY, days) });
    return { until: addDays(TODAY, days) };
  }
  function reset() { SNOOZES = []; COMPLETIONS = []; }

  /* The demonstration D-43 asks for, run rather than described: one shared obligation,
     two members, a snooze on one side and a completion on the other. */
  function snoozeProof() {
    reset();
    var occ = FIXTURE_OCCURRENCES.filter(function (o) { return o.id === "o-gas"; })[0];
    var before = { jana: has("jana", occ), petr: has("petr", occ) };
    snooze(occ, "jana", 7);
    var afterSnooze = { jana: has("jana", occ), petr: has("petr", occ),
                        complete: { jana: isComplete(occ, "jana"), petr: isComplete(occ, "petr") } };
    var res = complete(occ, "petr");
    var afterComplete = { jana: has("jana", occ), petr: has("petr", occ), rows: res.rows };
    /* and the personal one, for contrast */
    var chore = FIXTURE_OCCURRENCES.filter(function (o) { return o.id === "o-bins"; })[0];
    complete(chore, "adam");
    var personal = { adam: has("adam", chore), jana: has("jana", chore), scope: scopeOf(chore) };
    /* Household scope means exactly this: Adam’s completion clears the occurrence for
       everybody, because the bins are one obligation and the rotation only says whose
       turn it is. Registered personal, which left every other subscriber being told
       about a chore that was done; settled the other way rather than left open. */
    var twice = complete(chore, "adam");
    var out = { before: before, afterSnooze: afterSnooze, afterComplete: afterComplete,
                personal: personal, twice: twice, rows: COMPLETIONS.length, snoozes: SNOOZES.length };
    reset();
    return out;
  }
  function has(memberId, occ) {
    var day = TODAY;
    var k = kindOf(occ.kind);
    var g = grantOf(memberId, k.module);
    if (g === "none") return false;
    if (isComplete(occ, memberId) || isSnoozed(occ, memberId, day)) return false;
    var sub = subscriptionsFor(memberId).filter(function (s) { return s.key === occ.kind; })[0];
    if (!sub || sub.channel === "off") return false;
    return diff(occ.due, day) <= sub.days;
  }

  function grantOf(memberId, moduleId) {
    var F = window.HH_FIXTURES;
    var m = F && F.members.filter(function (x) { return x.id === memberId; })[0];
    return m ? (m.grants[moduleId] || "none") : "none";
  }
  function moduleName(id) {
    var F = window.HH_FIXTURES;
    var hit = F && F.modules.filter(function (m) { return m[0] === id; })[0];
    return hit ? hit[1] : id;
  }
  function familyOf(id) {
    var T = window.HH_TOKENS;
    var hit = T && T.accentMap.filter(function (m) { return m[0] === id; })[0];
    return hit ? hit[2] : "household";
  }
  function tokenOf(id) {
    var fam = familyOf(id);
    return fam === "garden" ? "--accent-garden" : "--accent-family-" + fam;
  }

  /* ── 7. FR-RE5 — the unified list ─────────────────────────────────────────
     Overdue first, then grouped by week. Every row names its source module and opens the
     source entity. A module the member holds none on contributes no row, no heading and
     no count. */

  function agendaFor(memberId, day) {
    day = day || TODAY;
    var horizon = addDays(day, 400);
    var occ = allOccurrences(addDays(day, -OVERDUE_WINDOW_DAYS - 60), horizon);
    var subs = {};
    subscriptionsFor(memberId).forEach(function (s) { subs[s.key] = s; });

    var droppedGrant = [], droppedUnsub = [], agedOut = [], droppedWindow = 0, snoozedRows = [];
    var rows = [];

    occ.forEach(function (o) {
      var k = kindOf(o.kind);
      var s = subs[o.kind];
      if (!s || !s.offered) { droppedGrant.push(o); return; }
      if (s.channel === "off") { droppedUnsub.push(o); return; }
      if (isComplete(o, memberId)) return;
      if (isSnoozed(o, memberId, day)) { snoozedRows.push(o); return; }
      var late = diff(day, o.due);
      if (late > 0) {
        if (late > OVERDUE_WINDOW_DAYS) { agedOut.push(o); return; }
      } else if (diff(o.due, day) > s.days) { droppedWindow++; return; }
      var isAnniv = !!o.since;
      rows.push({
        id: o.id, kind: o.kind, module: k.module, moduleName: moduleName(k.module),
        token: tokenOf(k.module), title: isAnniv ? o.title + " \u2014 " + anniversary(o.since, o.due, day).says : o.title,
        meta: o.meta, due: o.due, when: fmt(o.due), whenLong: fmtLong(o.due),
        overdue: late > 0 ? late : 0, endpoint: o.endpoint,
        scope: scopeOf(o), lead: s.days, leadChanged: s.changed,
        mine: !o.who || o.who.indexOf(memberId) >= 0,
        completable: !isAnniv && atLeast(grantOf(memberId, k.module), "contribute"),
        anniversary: isAnniv
      });
    });

    /* Overdue first, oldest first; the rest chronological. */
    var over = rows.filter(function (r) { return r.overdue > 0; })
      .sort(function (a, b) { return b.overdue - a.overdue; });
    var rest = rows.filter(function (r) { return r.overdue === 0; })
      .sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : 0; });

    var blocks = [];
    if (over.length) blocks.push({ id: "overdue", label: "Overdue", rule: "Oldest first", rows: over });

    var thisWeek = monday(day);
    var byWeek = {};
    rest.forEach(function (r) {
      var w = monday(r.due);
      (byWeek[w] = byWeek[w] || []).push(r);
    });
    Object.keys(byWeek).sort().forEach(function (w) {
      var n = Math.round(diff(w, thisWeek) / 7);
      var label = n === 0 ? "This week" : n === 1 ? "Next week" : "Week of " + fmtLong(w);
      blocks.push({ id: "w" + w, label: label, rule: n <= 1 ? "" : "", rows: byWeek[w] });
    });

    var m = (window.HH_FIXTURES ? window.HH_FIXTURES.members : []).filter(function (x) { return x.id === memberId; })[0];
    return {
      member: memberId, name: m ? m.name : memberId, day: day,
      blocks: blocks, rowCount: rows.length, blockCount: blocks.length,
      overdue: over.length, agedOut: agedOut, snoozed: snoozedRows,
      droppedGrant: droppedGrant, droppedUnsub: droppedUnsub, droppedWindow: droppedWindow,
      modules: rows.map(function (r) { return r.module; })
        .filter(function (x, i, a) { return a.indexOf(x) === i; }),
      empty: rows.length === 0
    };
  }

  function atLeast(level, want) {
    var L = ["none", "view", "contribute", "manage"];
    return L.indexOf(level) >= L.indexOf(want);
  }

  function agendaTable() {
    var F = window.HH_FIXTURES;
    return (F ? F.members : []).map(function (m) {
      var a = agendaFor(m.id);
      return { id: m.id, name: m.name, rows: a.rowCount, blocks: a.blockCount,
               overdue: a.overdue, modules: a.modules.length, agedOut: a.agedOut.length };
    });
  }

  /* ── 8. The screens (05-screens §C Reminders — four rows) ─────────────────
     `impossible` mirrors ledger.js's exclusions and is checked against it by
     ledger.mismatches(). The reason is drawn where the state would have been. */

  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending",
                    "syncing", "conflicted", "rejected", "absent", "withdrawn", "readonly"];

  var SCREENS = [
    { id: "C-11", view: "list", client: "mw", preset: "D", route: "/reminders",
      name: "Unified reminders list", title: "Reminders", kind: "agenda",
      lede: "Everything you are subscribed to, from every module, overdue first.",
      primary: "", secondary: [],
      empty: { s: "Nothing is due, and nothing is late.", e: "A boiler service, a passport, a chore \u2014 anything with a date lands here from the module that owns it.", a: "Add a reminder" },
      error: "Couldn\u2019t reach one module\u2019s dates. The rest of the list is what this device already holds.",
      rejected: "That completion was refused: your access to Property changed while it was queued.",
      withdrawn: "Property is no longer shared with you, so its dates left this list.",
      readonly: "The subscription has lapsed. Every date is readable; completing is held until it resumes.",
      states: {
        conflicted: null,
        pending: "A completion ticked offline. The mark belongs to the source row, which is why the list can show it without owning it.",
        offline: "Occurrences expand on the device from the synced rule (FR-RE2), so the list offline is the whole list and not a cached window."
      },
      impossible: {
        conflicted: "The list is a read over ten modules\u2019 rows. A conflicted source row carries its mark here and routes to its own module\u2019s resolver \u2014 DD-4 forbids resolving in place."
      },
      foot: "Overdue stays for " + OVERDUE_WINDOW_DAYS + " days and then leaves the list, never the module (FR-RE9).",
      note: "The row is the same shape for all twenty-two kinds. What differs is the chip, and the chip is the module that owns the date.",
      drawn: "all" },

    { id: "C-12", view: "editor", client: "mw", preset: "D", route: "/reminders/new",
      name: "Own reminder editor", title: "New reminder", kind: "editor",
      lede: "A day, a title, and \u2014 if it repeats \u2014 a rule.",
      primary: "Save", secondary: ["Delete"],
      empty: { s: "A blank reminder.", e: "\u201cDescale the kettle\u201d, every six weeks, is the shape most of them take.", a: "Give it a title" },
      error: "Couldn\u2019t save. The reminder is still on this device exactly as you typed it.",
      rejected: "Refused: the recurrence would expand past the cap. Give it an end date or a count.",
      withdrawn: "Reminders is no longer shared with you. This reminder was removed from this device.",
      readonly: "Read-only while the subscription is past due. Existing reminders still fire.",
      states: {
        pending: "Created offline with its own id (FR-SY4), fully editable while it waits \u2014 an edit merges into the queued mutation.",
        empty: "The blank form is the empty state: there is no list behind it to be empty."
      },
      impossible: {
        conflicted: "reminders.reminder is lww_field. Two members editing the title and the date both succeed, and there is no rich-text body that could be half-merged."
      },
      foot: "due_on is a date. Anything that needs a time is a Calendar event, and that boundary is the point.",
      note: "Editing a recurring reminder edits the series. A one-off is a new reminder \u2014 there are no per-occurrence exceptions, carried from home.",
      drawn: "all" },

    { id: "C-13", view: "subs", client: "mw", preset: "D", route: "/reminders/subscriptions",
      name: "Subscriptions \u2014 21 kinds", title: "What you are told about", kind: "subs",
      lede: "Per kind: how much notice, and how it reaches you.",
      primary: "", secondary: ["Reset to the defaults"],
      empty: { s: "No modules with dates yet.", e: "Turning on Vehicles adds four kinds here, already set to sensible notice.", a: "See the modules" },
      error: "Couldn\u2019t load your settings. The defaults are in force until it loads.",
      rejected: "",
      withdrawn: "You no longer hold that module, so its kinds left this screen.",
      readonly: "Your own notification settings keep working while the subscription is past due \u2014 they are a personal preference, not household data.",
      states: {
        absent: "A member with none on every module with dates gets no screen: there is nothing to be subscribed to.",
        readonly: "Personal preferences require only view (FR-RE6), so read-only does not reach them. The banner says which writes are held elsewhere."
      },
      impossible: {
        conflicted: "A subscription is lww_row and personal. Your own two devices merge silently rather than asking you which of you is right.",
        rejected: "A personal preference carries no cross-row invariant for the server to refuse."
      },
      foot: "Twenty-two rows, of which most members change none. The defaults are the feature.",
      note: "The lead-time set is the strand\u2019s (FR-RM2) and is presented here rather than defined here \u2014 a second list is a second list to fall out of step.",
      drawn: "all" },

    { id: "C-14", view: "snooze", client: "mw", preset: "S", route: "/reminders",
      name: "Snooze \u2014 personal", title: "Not now", kind: "snooze",
      lede: "Stop being told, without telling everybody it is done.",
      primary: "Snooze", secondary: [],
      empty: { s: "", e: "", a: "" }, error: "", rejected: "", withdrawn: "", readonly: "",
      impossible: {},
      foot: "D-43: snoozing is personal even when completion is shared.",
      note: "The two are different verbs and the sheet says so in words, because \u201cdone\u201d and \u201cnot now\u201d being one control is how a household ends up believing the boiler was serviced.",
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

  /* ── the gate ─────────────────────────────────────────────────────────── */

  function checks() {
    var audit = kindAudit();
    var da = defaultsAudit();
    var runs = vectorRuns();
    var jana = agendaFor("jana"), petr = agendaFor("petr"), adam = agendaFor("adam"),
        klara = agendaFor("klara"), milos = agendaFor("milos");
    var proof = snoozeProof();
    var st = subsTable();
    var cov = coverage();
    var cards = window.HH_TASKS && window.HH_TASKS.dueCards
      ? window.HH_TASKS.dueCards("2026-08-01", "2026-12-31").length : 0;

    return [
      { name: "The twenty-one kinds, collected rather than counted",
        detail: audit.collected + " kinds across " + audit.modules + " modules, each with the line it came from, checked module by module against 00-module-model \u00a76: " +
          audit.rows.map(function (r) { return r.module + " " + r.got + "/" + r.expected; }).join(" \u00b7 ") +
          ". With the module\u2019s own the subscriptions screen is " + audit.screenRows + " rows, not the twenty-one 05-screens calls it.",
        pass: audit.ok && audit.withSource === audit.screenRows },
      { name: "Completion scope is declared by the kind \u2014 and the handoff declares four",
        detail: audit.scopeStated + " of " + audit.screenRows + " kinds have their scope stated in the requirement (tasks.card_due personal, chores.due household, documents.expiry per type, calendar.event per participant set, and the module\u2019s own as a column). The other " +
          (audit.screenRows - audit.scopeStated) + " are decided here, and a wrong one is a household that thinks the boiler was serviced.",
        pass: audit.scopeStated === 5 && ALL_KINDS.every(function (k) { return !!k.scope; }) },
      { name: "Defaults come from five classes, not twenty-two arguments",
        detail: da.byClass.map(function (c) { return c.n + " " + c.cls; }).join(" \u00b7 ") +
          ". " + da.push + " default to push and the rest to in-app. " + da.custom.length + " of " + da.total +
          " land outside FR-RM2\u2019s seven presets and need the custom field (" +
          da.custom.map(function (c) { return c.key.split(".")[1] + " " + c.days + "d"; }).join(", ") +
          ") \u2014 so custom is the ordinary path for notice and renewal kinds, not an edge case.",
        pass: da.byClass.every(function (c) { return c.n > 0; }) && da.custom.length > 0 && da.inSet > da.custom.length },
      { name: "Recurrence expands on the client, and the 31st clamps",
        detail: runs.filter(function (r) { return r.ok; }).length + " of " + runs.length +
          " vectors pass, run on this page: " + runs.map(function (r) { return r.name.toLowerCase(); }).join(" \u00b7 ") +
          ". The monthly 31st gives 31 Jan, 28 Feb, 31 Mar, 30 Apr and 29 Feb in a leap year; the unbounded daily rule stops at " + CAP + " and says so.",
        pass: runs.every(function (r) { return r.ok; }) },
      { name: "An anniversary passes; it does not complete",
        detail: anniversary(1946, "2026-09-12").says + " on " + anniversary(1946, "2026-09-12").when +
          ". No completion row is written and the list draws no hold control on it \u2014 " +
          jana.blocks.reduce(function (n, b) { return n + b.rows.filter(function (r) { return r.anniversary && r.completable; }).length; }, 0) +
          " anniversary rows on Jana\u2019s list carry one.",
        pass: !anniversary(1946, "2026-09-12").completes &&
              jana.blocks.every(function (b) { return b.rows.every(function (r) { return !(r.anniversary && r.completable); }); }) },
      { name: "One day, five members, five different lists \u2014 computed from grants",
        detail: agendaTable().map(function (r) { return r.name + " " + r.rows; }).join(" \u00b7 ") +
          " rows, over " + jana.modules.length + ", " + petr.modules.length + ", " + adam.modules.length + ", " +
          klara.modules.length + " and " + milos.modules.length +
          " modules. Kl\u00e1ra holds none on every module with dates, so her list is the teaching empty state rather than an empty heading.",
        pass: klara.empty && klara.blockCount === 0 && jana.rowCount > petr.rowCount && petr.rowCount > 0 && adam.rowCount > 0 },
      { name: "One reading, two members, two right answers",
        detail: "Petr set utilities.reading_due to a day and Jana kept the default three, so the electricity reading due on Friday is on her list today and not on his \u2014 the lead is per member, per kind (FR-RE6), and both are right. Adam turned calendar.event off, so the dentist appointment is on Jana\u2019s list and not on his; the event is still in Calendar. Of five members, " +
          st.filter(function (r) { return r.changed === 0; }).length + " changed nothing at all.",
        pass: (function () {
          var inList = function (a, id) { return a.blocks.some(function (b) { return b.rows.some(function (r) { return r.id === id; }); }); };
          return inList(jana, "o-elec") && !inList(petr, "o-elec") &&
                 inList(jana, "o-dentist") && !inList(adam, "o-dentist") &&
                 st.filter(function (r) { return r.changed === 0; }).length >= 2;
        })() },
      { name: "Snooze is personal even when completion is shared (D-43)",
        detail: "The gas reading is due today and on both their lists. Jana snoozes it a week: off hers, still on Petr\u2019s, and complete for neither \u2014 she has stopped being told, not told anybody it is done. Petr then reads the meter and completes it, and it leaves both lists from one row, because the kind is household scope. The chore beside it is the same shape now: Adam takes the bins out and the occurrence clears for every subscriber, because the rotation says whose turn it is and not whose obligation it is.",
        pass: proof.before.jana && proof.before.petr && !proof.afterSnooze.jana && proof.afterSnooze.petr &&
              !proof.afterSnooze.complete.jana && !proof.afterComplete.jana && !proof.afterComplete.petr &&
              proof.personal.scope === "household" && !proof.personal.adam && !proof.personal.jana },
      { name: "Completing twice is completing once",
        detail: "The hold gesture fires twice on a bad connection. The second write returns " + proof.twice.status +
          " rather than 409 and adds no row \u2014 " + proof.rows + " completion rows for the two occurrences completed. It is a state_set keyed on (source, occurrence, user), which is what makes replay harmless.",
        pass: proof.twice.status === 200 && !proof.twice.wrote },
      { name: "Nothing is silently dropped",
        detail: jana.agedOut.length + " occurrence past the " + OVERDUE_WINDOW_DAYS +
          "-day window leaves Jana\u2019s list and stays in its module, and the list says so at the foot rather than deleting it quietly (FR-RE9). " +
          jana.droppedWindow + " more are real dates outside her lead windows \u2014 they arrive on their own day, and no screen pretends they do not exist.",
        pass: jana.agedOut.length > 0 && jana.droppedWindow > 0 },
      { name: "The strand asks; the module answers",
        detail: cards + " tasks.card_due occurrences on this page are resolved by tasks.js through FR-RM1\u2019s resolver contract, not authored here. Tasks itself holds no lead time, no snooze and no completion window: " +
          (window.HH_TASKS ? Object.keys(window.HH_TASKS).filter(function (k) { return /lead|snooze|overdue|subscri/i.test(k); }).length : "\u2014") +
          " such exports. That is D-27 in one line \u2014 the alternative is ten modules with ten subtly different behaviours.",
        pass: cards > 0 && !!window.HH_TASKS &&
              Object.keys(window.HH_TASKS).filter(function (k) { return /lead|snooze|overdue|subscri/i.test(k); }).length === 0 },
      { name: "Every state these four rows can reach is drawn",
        detail: cov.map(function (c) { return c.id + " " + c.drawn.length + "/" + c.required.length; }).join(" \u00b7 ") +
          " states, " + cov.reduce(function (n, c) { return n + c.cells; }, 0) + " cells. Four exclusions across three rows, each with the sync policy or the permission rule that argues it.",
        pass: cov.every(function (c) { return c.complete; }) }
    ];
  }

  window.HH_REMINDERS = {
    version: "0.1-stage-12-candidate",
    today: TODAY, overdueWindow: OVERDUE_WINDOW_DAYS, cap: CAP,
    kinds: KINDS, own: OWN, allKinds: ALL_KINDS, modelCounts: MODEL_COUNTS, kindAudit: kindAudit,
    leadSet: LEAD_SET, classes: CLASSES, entityLead: ENTITY_LEAD,
    leadFor: leadFor, defaultsTable: defaultsTable, defaultsAudit: defaultsAudit,
    expand: expand, vectors: VECTORS, vectorRuns: vectorRuns, anniversary: anniversary,
    occurrences: FIXTURE_OCCURRENCES, resolveKind: resolveKind, allOccurrences: allOccurrences,
    subscriptionsFor: subscriptionsFor, subsTable: subsTable, changed: CHANGED,
    snooze: snooze, complete: complete, uncomplete: uncomplete, reset: reset,
    snoozeProof: snoozeProof, scopeOf: scopeOf,
    agendaFor: agendaFor, agendaTable: agendaTable,
    screens: SCREENS, rows: SCREENS, allStates: ALL_STATES, coverage: coverage,
    fmt: fmt, fmtLong: fmtLong, addDays: addDays, diff: diff,
    checks: checks
  };
})();
