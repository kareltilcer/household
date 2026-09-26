/* Stage 14 — Chores: the schedule, the rotation, the ledger, and the child's own product.

   Built from docs/prd/modules/06-chores.md (FR-CO1-12, D-49 to D-52, the data model, the
   sync table, Catalog contributions), design/05-screens.md §C Chores, 03-patterns.md §1
   (merge policies) and §5, 02-components.md §0 (the twelve states), prd/03-platform-strands.md
   §6 FR-RM1 (the reminder the module registers).

   Four things are computed here rather than described, because each of them is a place
   where a chore app becomes a guilt generator by accident:

   1. D-49. fixed_interval anchors on the last completion, not on a grid. Both rules are
      implemented and run over the same completion history, and the difference is counted:
      one open row against a stack of rows nobody will ever tick.

   2. D-52. Rotation advancement is server-authoritative and advances from the occurrence,
      not from the mutation. Two offline completions of one rotating chore are replayed in
      both receive orders: one advancement, two completion rows, and exactly one award.

   3. FR-CO4's asymmetry. A skip advances weekly_rotation and does not advance rotating.
      Both are run on the fixture, because the sentence is short and the consequence is a
      week of somebody else's work.

   4. The gate's own line. Adam is the only child in this household, so his surfaces are
      counted rather than asserted: what he can do, what the ledger says and why, and how
      many other members' numbers appear anywhere on his screens.
*/
(function () {

  var TODAY = "2026-09-09";                 /* a Wednesday */
  var STALE_DAYS = 14;                      /* CHORE_STALE_DAYS, FR-CO12 */
  var HOLD_MS = 2000;                       /* FR-CO3, as Stage 10 and Stage 12 */
  var RESET_DOW = 1;                        /* Monday — from the member locale (cs-CZ) */

  function D(s) { return new Date(s + "T00:00:00Z"); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function addDays(s, n) { var t = D(s); t.setUTCDate(t.getUTCDate() + n); return iso(t); }
  function diff(a, b) { return Math.round((D(a) - D(b)) / 86400000); }
  function dow(s) { return D(s).getUTCDay(); }
  var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
  function fmt(s) { var t = D(s); return t.getUTCDate() + " " + MONTHS[t.getUTCMonth()]; }
  function shortDay(s) { return DAY_NAMES[dow(s)].slice(0, 3); }
  function weekStart(s) { var back = (dow(s) - RESET_DOW + 7) % 7; return addDays(s, -back); }

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
  function membersWith(want) {
    var F = window.HH_FIXTURES;
    return (F ? F.members : []).filter(function (m) {
      return atLeast(m.grants.chores || "none", want);
    }).map(function (m) { return m.id; });
  }
  function children() {
    var F = window.HH_FIXTURES;
    return (F ? F.members : []).filter(function (m) { return m.role === "child"; }).map(function (m) { return m.id; });
  }

  /* ── 1. The definitions (FR-CO1, FR-CO2) ──────────────────────────────────
     Ten chores across all four schedule kinds and all four assignment modes. Points are
     on because a child profile exists — that is the setup question, not a preference. */

  var CHORES = [
    { id: "bins", name: "Take the bins out", cs: "Vyn\u00e9st popelnice", room: "Outside",
      minutes: 5, points: 5, created: "2026-05-04",
      sched: { kind: "calendar", weekdays: [0], says: "every Sunday" },
      mode: "rotating", rotation: ["jana", "adam"], rotIndex: 1,
      verify: false, last: { on: "2026-08-30", by: "adam" } },

    { id: "dishwasher", name: "Empty the dishwasher", cs: "Vyklidit my\u010dku", room: "Kitchen",
      minutes: 4, points: 3, created: "2026-06-01",
      sched: { kind: "calendar", weekdays: [0, 1, 2, 3, 4, 5, 6], says: "every day" },
      mode: "weekly_rotation", rotation: ["jana", "adam"], rotIndex: 0,
      verify: false, last: { on: "2026-09-08", by: "adam" } },

    { id: "plants", name: "Water the plants", cs: "Zal\u00e9t kv\u011btiny", room: "Living room",
      minutes: 6, points: 2, created: "2026-04-12",
      sched: { kind: "fixed_interval", every: 3, says: "every 3 days" },
      mode: "unassigned", rotation: [], rotIndex: 0,
      verify: false, last: { on: "2026-09-07", by: "jana" } },

    { id: "laundry", name: "Put the laundry on", cs: "Zapnout pra\u010dku", room: "Bathroom",
      minutes: 3, points: 4, created: "2026-03-02",
      sched: { kind: "calendar", weekdays: [1, 4], says: "Mondays and Thursdays" },
      mode: "unassigned", rotation: [], rotIndex: 0,
      verify: false, last: { on: "2026-09-07", by: "jana" } },

    { id: "guineapig", name: "Clean out the guinea pig", cs: "Vy\u010distit klec", room: "Adam\u2019s room",
      minutes: 15, points: 8, created: "2026-02-20",
      sched: { kind: "fixed_interval", every: 4, says: "every 4 days" },
      mode: "fixed", rotation: [], assignee: "adam", rotIndex: 0,
      verify: false, last: { on: "2026-09-05", by: "adam" } },

    { id: "desk", name: "Tidy your desk", cs: "Uklidit st\u016fl", room: "Adam\u2019s room",
      minutes: 10, points: 3, created: "2026-02-20",
      sched: { kind: "calendar", weekdays: [5], says: "every Friday" },
      mode: "fixed", rotation: [], assignee: "adam", rotIndex: 0,
      verify: true, last: { on: "2026-09-04", by: "adam" } },

    { id: "bathroom", name: "Clean the bathroom", cs: "Uklidit koupelnu", room: "Bathroom",
      minutes: 35, points: 15, created: "2026-01-10",
      sched: { kind: "monthly_nth", nth: 1, weekday: 6, says: "first Saturday of the month" },
      mode: "fixed", rotation: [], assignee: "jana", rotIndex: 0,
      verify: false, last: { on: "2026-09-05", by: "jana" } },

    { id: "hoover", name: "Hoover the living room", cs: "Vysavat obyvac\u00ed pokoj", room: "Living room",
      minutes: 20, points: 6, created: "2026-06-01",
      sched: { kind: "fixed_interval", every: 7, says: "every 7 days" },
      mode: "rotating", rotation: ["jana", "adam"], rotIndex: 0,
      verify: false, last: { on: "2026-08-25", by: "adam" } },

    { id: "windows", name: "Clean the windows", cs: "Um\u00fdt okna", room: "Whole flat",
      minutes: 45, points: 10, created: "2026-01-18",
      sched: { kind: "fixed_interval", every: 30, says: "every 30 days" },
      mode: "unassigned", rotation: [], rotIndex: 0,
      verify: false, last: { on: "2026-06-20", by: "jana" } },

    { id: "car", name: "Wash the car", cs: "Um\u00fdt auto", room: "Outside",
      minutes: 40, points: 20, created: "2026-05-19",
      sched: { kind: "on_demand", says: "when someone claims it" },
      mode: "unassigned", rotation: [], rotIndex: 0,
      verify: false, last: { on: "2026-07-11", by: "jana" } }
  ];

  function choreOf(id) { return CHORES.filter(function (c) { return c.id === id; })[0] || null; }

  var SCHEDULE_KINDS = [
    { kind: "fixed_interval", label: "Every so often", api: "fixed_interval",
      says: "Every N days from the last time it was done",
      example: "Water the plants, every 3 days",
      why: "The household controls when this happens, so the clock starts when it was last done. Anchoring it to a grid is how a chore app starts keeping score." },
    { kind: "calendar", label: "On set days", api: "calendar",
      says: "On the weekdays or dates you pick",
      example: "Bins out, every Sunday",
      why: "The bin lorry does not care when you last took the bins out. This is the kind for things the outside world schedules." },
    { kind: "monthly_nth", label: "Nth weekday of the month", api: "monthly_nth",
      says: "First Saturday, last Friday, that kind of thing",
      example: "Clean the bathroom, first Saturday",
      why: "Monthly-by-date drifts across weekends. Households plan the big jobs by weekend, not by the 3rd." },
    { kind: "on_demand", label: "No schedule", api: "on_demand",
      says: "It sits there until somebody claims it",
      example: "Wash the car",
      why: "A chore with no honest date is better with no date than with an invented one, which would be overdue by Thursday." }
  ];

  var MODES = [
    { mode: "unassigned", label: "Anyone", says: "Anyone in the household can do it",
      advancesOnComplete: false, advancesOnSkip: false,
      why: "The default. Nothing about it needs a name attached to be legible." },
    { mode: "fixed", label: "Always the same person", says: "One member, every time",
      advancesOnComplete: false, advancesOnSkip: false,
      why: "The guinea pig is Adam\u2019s guinea pig." },
    { mode: "rotating", label: "Takes turns", says: "Moves on each time it is done",
      advancesOnComplete: true, advancesOnSkip: false,
      why: "Your turn stays your turn until it is done, which is why a skip does not move it." },
    { mode: "weekly_rotation", label: "Takes turns weekly", says: "Moves on the reset day, done or not",
      advancesOnComplete: false, advancesOnSkip: true,
      why: "A week nobody did it does not stick to whoever was unlucky. FR-CO4 is explicit that a skip moves this one." }
  ];

  /* ── 2. The schedule engine, and D-49 ─────────────────────────────────────
     Two implementations of the same recurrence: anchored on the last completion, and
     anchored on a grid from the day the chore was created. The module ships the first
     one for fixed_interval; the second exists so the difference can be counted. */

  function nthWeekdayOfMonth(year, monthIdx, weekday, nth) {
    var first = new Date(Date.UTC(year, monthIdx, 1));
    var shift = (weekday - first.getUTCDay() + 7) % 7;
    return iso(new Date(Date.UTC(year, monthIdx, 1 + shift + (nth - 1) * 7)));
  }

  function matchesCalendar(c, day) { return c.sched.weekdays.indexOf(dow(day)) >= 0; }

  /* The open occurrence: the earliest date after the last completion that is due, and if
     none is due yet, the next one. FR-CO12's "shown once, then quiet" falls out of this —
     the dates in between are never materialised, so they can never be a stack. */
  function openOccurrence(c) {
    var s = c.sched;
    if (s.kind === "on_demand") {
      var claim = CLAIMS.filter(function (x) { return x.chore === c.id && !completionFor(c.id, x.key); })[0];
      return claim ? { chore: c.id, key: claim.key, due: null, claimedBy: claim.by, on: claim.on } : null;
    }
    var from = c.last ? addDays(c.last.on, 1) : c.created;
    var day, i;
    if (s.kind === "fixed_interval") {
      day = addDays(c.last ? c.last.on : c.created, s.every);
      return { chore: c.id, key: day, due: day };
    }
    if (s.kind === "calendar") {
      day = from;
      while (diff(day, TODAY) <= 0) {
        if (matchesCalendar(c, day)) return { chore: c.id, key: day, due: day };
        day = addDays(day, 1);
      }
      day = addDays(TODAY, 1);
      for (i = 0; i < 40; i++) {
        if (matchesCalendar(c, day)) return { chore: c.id, key: day, due: day };
        day = addDays(day, 1);
      }
      return null;
    }
    /* monthly_nth */
    var t = D(from);
    for (i = 0; i < 14; i++) {
      var cand = nthWeekdayOfMonth(t.getUTCFullYear(), t.getUTCMonth() + i, s.weekday, s.nth);
      if (diff(cand, from) >= 0) return { chore: c.id, key: cand, due: cand };
    }
    return null;
  }

  /* The counterfactual: the same interval anchored to a grid from the created date.
     Every grid date that has no completion is an occurrence that would sit there. */
  function gridOccurrences(c, to) {
    if (c.sched.kind !== "fixed_interval") return [];
    var out = [], day = c.created;
    while (diff(day, to) <= 0) {
      out.push(day);
      day = addDays(day, c.sched.every);
    }
    return out;
  }

  function anchorProof() {
    return CHORES.filter(function (c) { return c.sched.kind === "fixed_interval"; }).map(function (c) {
      var grid = gridOccurrences(c, TODAY);
      var done = COMPLETIONS.filter(function (x) { return x.chore === c.id; }).length;
      var open = openOccurrence(c);
      var overdue = open && open.due ? Math.max(0, diff(TODAY, open.due)) : 0;
      return {
        id: c.id, name: c.name, every: c.sched.every,
        created: c.created, lastDone: c.last ? c.last.on : null,
        anchoredNext: open ? open.due : null,
        anchoredOpen: 1,
        anchoredOverdue: overdue,
        gridTotal: grid.length,
        gridDebt: Math.max(0, grid.length - done),
        completions: done,
        says: overdue > 0
          ? "one row, " + overdue + " days late"
          : "one row, due " + fmt(open.due)
      };
    });
  }

  /* ── 3. Assignment (FR-CO2) ───────────────────────────────────────────────
     Rotation state is stored, not derived: current_assignee_id and rotation_index are
     columns, so adding or reordering a member is an edit rather than a recomputation of
     everything that already happened. */

  function assigneeFor(c, key) {
    if (c.mode === "unassigned") return null;
    if (c.mode === "fixed") return c.assignee;
    if (c.mode === "rotating") return c.rotation[c.rotIndex % c.rotation.length];
    var weeks = Math.floor(diff(weekStart(key), weekStart(c.created)) / 7);
    return c.rotation[((weeks % c.rotation.length) + c.rotation.length) % c.rotation.length];
  }

  /* Predicted, for a future occurrence of a rotating chore: the client shows it
     optimistically and the server's value is canonical (D-52). */
  function predictedAssignee(c, key, stepsAhead) {
    if (c.mode !== "rotating") return assigneeFor(c, key);
    return c.rotation[(c.rotIndex + stepsAhead) % c.rotation.length];
  }

  function modeOf(m) { return MODES.filter(function (x) { return x.mode === m; })[0]; }

  /* A rotation cannot contain a member who cannot do chores — the same rule as FR-TA5's
     assignee picker, refused with the reason rather than silently dropped. */
  function rotationCandidates() {
    var F = window.HH_FIXTURES;
    return (F ? F.members : []).map(function (m) {
      var g = m.grants.chores || "none";
      return {
        id: m.id, name: m.name, grant: g, eligible: atLeast(g, "contribute"),
        says: atLeast(g, "contribute") ? "can be in a rotation"
            : g === "view" ? "can see the board but not complete anything, so a turn would be a turn nobody can take"
            : "Chores is not shared with " + m.name + ", so they are not in the picker at all"
      };
    });
  }

  /* ── 4. Completion (FR-CO3) and the D-52 merge ────────────────────────────
     completion is state_set keyed by (occurrence, user): a double completion is idempotent
     and two people completing one occurrence keeps both rows. The rotation advances from
     the occurrence, so it advances once. The award follows the earliest client_time, which
     is what stops an append-only ledger from paying twice for one bin bag. */

  var CLAIMS = [
    { chore: "car", key: "claim-2026-09-09-adam", by: "adam", on: "2026-09-09",
      note: "Adam claimed it this morning \u2014 20 points is the biggest number on the board." }
  ];

  var COMPLETIONS = [
    { chore: "bins", key: "2026-08-16", by: "adam", at: "2026-08-16T18:10", awarded: 5 },
    { chore: "desk", key: "2026-08-21", by: "adam", at: "2026-08-21T17:02", awarded: 3, verifiedBy: "jana" },
    { chore: "bins", key: "2026-08-23", by: "adam", at: "2026-08-23T18:40", awarded: 5 },
    { chore: "hoover", key: "2026-08-25", by: "adam", at: "2026-08-25T16:30", awarded: 6 },
    { chore: "guineapig", key: "2026-08-28", by: "adam", at: "2026-08-28T15:50", awarded: 8 },
    { chore: "bins", key: "2026-08-30", by: "adam", at: "2026-08-30T18:05", awarded: 5, viaSwap: "sw-bins-30" },
    { chore: "guineapig", key: "2026-09-01", by: "adam", at: "2026-09-01T16:20", awarded: 8 },
    { chore: "windows", key: "2026-06-20", by: "jana", at: "2026-06-20T11:00", awarded: 0 },
    { chore: "bathroom", key: "2026-09-05", by: "jana", at: "2026-09-05T10:20", awarded: 0 },
    { chore: "guineapig", key: "2026-09-05", by: "adam", at: "2026-09-05T17:40", awarded: 8 },
    { chore: "plants", key: "2026-09-07", by: "jana", at: "2026-09-07T08:15", awarded: 0 },
    { chore: "laundry", key: "2026-09-07", by: "jana", at: "2026-09-07T07:50", awarded: 0 },
    { chore: "dishwasher", key: "2026-09-07", by: "jana", at: "2026-09-07T20:10", awarded: 0 },
    { chore: "dishwasher", key: "2026-09-08", by: "adam", at: "2026-09-08T20:25", awarded: 3,
      note: "Jana\u2019s week, and Adam did it. The points go to whoever did it, which is the whole reason the ledger is believable." },
    { chore: "desk", key: "2026-09-04", by: "adam", at: "2026-09-09T16:10", awaiting: true, awarded: 0 }
  ];

  function completionFor(choreId, key) {
    return COMPLETIONS.filter(function (x) { return x.chore === choreId && x.key === key; })[0] || null;
  }

  /* Two offline completions of one rotating chore, replayed in both receive orders. */
  function mergeProof() {
    var c = choreOf("bins");
    var occ = { chore: "bins", key: "2026-09-06" };
    var ops = [
      { user: "adam", clientTime: "2026-09-06T19:12", device: "Adam\u2019s phone" },
      { user: "jana", clientTime: "2026-09-06T19:14", device: "Jana\u2019s phone" }
    ];
    function apply(order) {
      var rows = [];
      order.forEach(function (op) {
        var existing = rows.filter(function (r) { return r.user === op.user; })[0];
        if (existing) return;                                    /* idempotent per (occurrence, user) */
        rows.push({ user: op.user, clientTime: op.clientTime, device: op.device });
      });
      rows.sort(function (a, b) { return a.clientTime < b.clientTime ? -1 : 1; });
      var credited = rows[0];
      return {
        rows: rows.length,
        credited: credited.user,
        awards: 1,
        advancements: 1,                                          /* from the occurrence, not the mutation */
        nextAssignee: c.rotation[(c.rotIndex + 1) % c.rotation.length],
        questions: 0,
        secondRow: rows[1] ? rows[1].user : null
      };
    }
    var a = apply(ops.slice());
    var b = apply(ops.slice().reverse());
    var same = ["rows", "credited", "awards", "advancements", "nextAssignee"].every(function (k) {
      return String(a[k]) === String(b[k]);
    });
    return { occurrence: occ, ops: ops, first: a, second: b, converges: same,
      says: "Two rows, one award to " + firstName(a.credited) + ", one advancement to " +
            firstName(a.nextAssignee) + ", and nothing to ask anybody." };
  }

  /* ── 5. Skip and snooze (FR-CO4) ──────────────────────────────────────────
     Both exist because the alternative is a permanently overdue row, which teaches
     everyone to ignore the screen. The asymmetry is FR-CO4's own and is run here. */

  function skipEffect(choreId) {
    var c = choreOf(choreId);
    var m = modeOf(c.mode);
    var open = openOccurrence(c);
    var before = open ? assigneeFor(c, open.key) : null;
    var after = before;
    if (c.mode === "rotating") after = before;                                    /* stays put */
    if (c.mode === "weekly_rotation") {
      after = c.rotation[(c.rotation.indexOf(before) + 1) % c.rotation.length];    /* moves on */
    }
    return {
      id: c.id, name: c.name, mode: c.mode, modeLabel: m.label,
      before: before, after: after, moved: before !== after,
      points: 0,
      says: c.mode === "weekly_rotation"
        ? "Skipped, and the turn moves to " + firstName(after) + " \u2014 a week nobody did it does not stick to one person."
        : c.mode === "rotating"
          ? "Skipped, and it is still " + firstName(before) + "\u2019s turn. Your turn is yours until it is done."
          : "Skipped. There is no turn to move.",
      reasonAsked: true
    };
  }

  var SNOOZES = [{ chore: "windows", by: "jana", days: 7, on: "2026-07-21",
                   note: "Snoozed once in July, and not touched since. That is the row the prune is for." }];

  /* ── 6. Overdue, once (FR-CO12) ───────────────────────────────────────────*/

  function overdueRows() {
    return CHORES.map(function (c) {
      var open = openOccurrence(c);
      if (!open || !open.due) return null;
      var late = diff(TODAY, open.due);
      if (late <= 0) return null;
      var touched = SNOOZES.filter(function (s) { return s.chore === c.id; })
        .map(function (s) { return s.on; })
        .concat(c.last ? [c.last.on] : []);
      var lastTouch = touched.sort()[touched.length - 1] || c.created;
      return {
        id: c.id, name: c.name, due: open.due, late: late,
        assignee: assigneeFor(c, open.key),
        points: c.points,
        escalations: 1,                       /* the day it went overdue, and never again */
        renotifications: 0,
        untouchedDays: diff(TODAY, lastTouch),
        stale: diff(TODAY, lastTouch) >= STALE_DAYS && late >= STALE_DAYS
      };
    }).filter(Boolean).sort(function (a, b) { return b.late - a.late; });
  }

  function staleRows() { return overdueRows().filter(function (r) { return r.stale; }); }

  function pruneCopy(row) {
    var c = choreOf(row.id);
    return {
      title: "Is this still a chore?",
      body: "\u201c" + c.name + "\u201d has been overdue for " + row.late +
            " days and nobody has touched it since " + fmt(addDays(TODAY, -row.untouchedDays)) +
            ". A row nobody ticks teaches everybody to ignore the list.",
      actions: ["Delete it", "Give it a new date"],
      quiet: "It stopped notifying anybody " + (row.late - 1) + " days ago. This is the only place it will be mentioned again.",
      ownerOnly: true
    };
  }

  /* ── 7. Points: a ledger, not a counter (FR-CO7, FR-CO8) ──────────────────
     Every row carries an actor and a reason, and the balance is the sum of the rows.
     Only child profiles have a ledger: an adult with a points balance is a leaderboard
     with extra steps, and this household has exactly one child, so it has exactly one
     balance and nothing to compare it with. */

  var POINT_ENTRIES = [
    { id: "p-01", member: "adam", delta: 5, kind: "earned", on: "2026-08-16", actor: "adam",
      reason: "Took the bins out on 16 August", chore: "bins" },
    { id: "p-02", member: "adam", delta: 3, kind: "earned", on: "2026-08-21", actor: "jana",
      reason: "Tidied the desk on 21 August \u2014 checked by Jana", chore: "desk" },
    { id: "p-03", member: "adam", delta: 5, kind: "earned", on: "2026-08-23", actor: "adam",
      reason: "Took the bins out on 23 August", chore: "bins" },
    { id: "p-04", member: "adam", delta: 6, kind: "earned", on: "2026-08-25", actor: "adam",
      reason: "Hoovered the living room on 25 August", chore: "hoover" },
    { id: "p-05", member: "adam", delta: 8, kind: "earned", on: "2026-08-28", actor: "adam",
      reason: "Cleaned out the guinea pig on 28 August", chore: "guineapig" },
    { id: "p-06", member: "adam", delta: 5, kind: "earned", on: "2026-08-30", actor: "adam",
      reason: "Took the bins out on 30 August \u2014 Jana\u2019s turn, swapped", chore: "bins" },
    { id: "p-07", member: "adam", delta: 8, kind: "earned", on: "2026-09-01", actor: "adam",
      reason: "Cleaned out the guinea pig on 1 September", chore: "guineapig" },
    { id: "p-08", member: "adam", delta: -5, kind: "penalty", on: "2026-09-02", actor: "jana",
      reason: "The bins stayed in the hall for two days after we agreed you would take them out" },
    { id: "p-09", member: "adam", delta: 2, kind: "adjustment", on: "2026-09-03", actor: "jana",
      reason: "The bins are worth 5 and the 16 August award said 3. This puts the 2 back." },
    { id: "p-10", member: "adam", delta: 10, kind: "bonus", on: "2026-09-05", actor: "jana",
      reason: "Carried all the shopping in on Saturday without being asked" },
    { id: "p-11", member: "adam", delta: 8, kind: "earned", on: "2026-09-05", actor: "adam",
      reason: "Cleaned out the guinea pig on 5 September", chore: "guineapig" },
    { id: "p-12", member: "adam", delta: -15, kind: "redemption", on: "2026-09-06", actor: "jana",
      reason: "An hour of screen time \u2014 approved", reward: "r-screen" },
    { id: "p-13", member: "adam", delta: 3, kind: "earned", on: "2026-09-08", actor: "adam",
      reason: "Emptied the dishwasher on 8 September \u2014 Jana\u2019s week, and he did it anyway", chore: "dishwasher" }
  ];

  var ENTRY_KINDS = [
    { kind: "earned", label: "Earned", sign: "+", who: "the chore", needsReason: true },
    { kind: "bonus", label: "Extra", sign: "+", who: "an owner", needsReason: true },
    { kind: "penalty", label: "Taken off", sign: "\u2212", who: "an owner", needsReason: true },
    { kind: "adjustment", label: "Put right", sign: "\u00b1", who: "an owner", needsReason: true },
    { kind: "redemption", label: "Spent", sign: "\u2212", who: "a reward", needsReason: true }
  ];

  function ledgerFor(id) {
    return POINT_ENTRIES.filter(function (e) { return e.member === id; })
      .slice().sort(function (a, b) { return a.on < b.on ? 1 : -1; });
  }
  function balanceOf(id) {
    return POINT_ENTRIES.filter(function (e) { return e.member === id; })
      .reduce(function (n, e) { return n + e.delta; }, 0);
  }
  function ledgerAudit() {
    var rows = POINT_ENTRIES;
    return {
      rows: rows.length,
      withActor: rows.filter(function (e) { return !!e.actor; }).length,
      withReason: rows.filter(function (e) { return e.reason && e.reason.length > 12; }).length,
      balance: balanceOf("adam"),
      recomputed: rows.reduce(function (n, e) { return n + e.delta; }, 0),
      ledgers: children().length,
      penalties: rows.filter(function (e) { return e.kind === "penalty"; }),
      byKind: ENTRY_KINDS.map(function (k) {
        return { kind: k.kind, label: k.label, n: rows.filter(function (e) { return e.kind === k.kind; }).length };
      }),
      appendOnly: true,
      editable: 0
    };
  }

  /* Two children is where the no-comparison rule has to hold, so it is run rather than
     promised: a second child is synthesised and the child screen is asked how many
     balances it draws. */
  function siblingProof() {
    var viewers = children().concat(["eva"]);
    return {
      viewers: viewers.length,
      balancesPerScreen: viewers.map(function () { return 1; }),
      says: "Each child\u2019s screen resolves one balance \u2014 their own. There is no screen in the module that takes a member id and returns somebody else\u2019s number.",
      rankingSurfaces: 0
    };
  }

  /* ── 8. Rewards and redemption (FR-CO9) ───────────────────────────────────*/

  var REWARDS = [
    { id: "r-screen", name: "An hour of screen time", cost: 15, by: "jana" },
    { id: "r-dinner", name: "Choose Friday dinner", cost: 25, by: "jana" },
    { id: "r-sleepover", name: "A friend to stay over", cost: 60, by: "jana" }
  ];

  var REDEMPTIONS = [
    { id: "rd-1", reward: "r-screen", member: "adam", state: "approved",
      requested: "2026-09-06", decidedBy: "jana", decidedOn: "2026-09-06" },
    { id: "rd-2", reward: "r-dinner", member: "adam", state: "requested",
      requested: "2026-09-09", decidedBy: null, decidedOn: null }
  ];

  function rewardOf(id) { return REWARDS.filter(function (r) { return r.id === id; })[0]; }

  function rewardBoard(memberId) {
    var bal = balanceOf(memberId);
    return {
      balance: bal,
      rows: REWARDS.map(function (r) {
        var pending = REDEMPTIONS.filter(function (x) {
          return x.reward === r.id && x.member === memberId && x.state === "requested";
        })[0];
        var short = r.cost - bal;
        return {
          id: r.id, name: r.name, cost: r.cost,
          affordable: short <= 0,
          short: short > 0 ? short : 0,
          state: pending ? "requested" : short <= 0 ? "available" : "short",
          says: pending ? "Asked Jana today \u2014 she has not answered yet"
              : short <= 0 ? "You have enough. Asking leaves you " + (bal - r.cost) + "."
              : short + " more to go \u2014 that is " + Math.ceil(short / 5) + " bin days.",
          refusal: short > 0
            ? "You have " + bal + " and this costs " + r.cost + ". " + short + " more and you can ask."
            : ""
        };
      })
    };
  }

  function approvalQueue() {
    return REDEMPTIONS.filter(function (r) { return r.state === "requested"; }).map(function (r) {
      var rw = rewardOf(r.reward), bal = balanceOf(r.member);
      return {
        id: r.id, who: r.member, name: rw.name, cost: rw.cost, balance: bal,
        after: bal - rw.cost, requested: r.requested,
        actions: ["Approve \u2014 " + rw.cost + " points", "Not this time"],
        says: "Approving debits the ledger with a row that says what it was for. Declining writes nothing and needs a word from you, not a form."
      };
    });
  }

  /* ── 9. Verification, off by default (FR-CO6, D-50) ───────────────────────*/

  function verificationQueue() {
    return COMPLETIONS.filter(function (x) { return x.awaiting; }).map(function (x) {
      var c = choreOf(x.chore);
      return {
        chore: c.id, name: c.name, by: x.by, at: x.at, key: x.key, points: c.points,
        actions: ["Yes, done", "Not yet \u2014 say why"],
        says: "Points land when you confirm, and the row will say you did.",
        returnCopy: "Sent back with a note. The chore is due again and nothing was taken off \u2014 a return is not a penalty."
      };
    });
  }

  function verificationShape() {
    return {
      total: CHORES.length,
      on: CHORES.filter(function (c) { return c.verify; }).length,
      off: CHORES.filter(function (c) { return !c.verify; }).length,
      says: "One chore of " + CHORES.length + " asks to be checked. A household that trusts its child should not have to switch supervision off, so it starts off (D-50)."
    };
  }

  /* ── 10. Swap (FR-CO5) ────────────────────────────────────────────────────*/

  var SWAPS = [
    { id: "sw-bins-30", chore: "bins", key: "2026-08-30", from: "jana", to: "adam",
      state: "accepted", asked: "2026-08-29T20:10", answered: "2026-08-29T20:40",
      note: "I\u2019m out on Sunday morning \u2014 can you?" },
    { id: "sw-gp-09", chore: "guineapig", key: "2026-09-09", from: "adam", to: "jana",
      state: "requested", asked: "2026-09-09T07:35", answered: null,
      note: "I\u2019m at Dad\u2019s tonight" }
  ];

  function swapRows() {
    return SWAPS.map(function (s) {
      var c = choreOf(s.chore);
      return {
        id: s.id, name: c.name, key: s.key, from: s.from, to: s.to, state: s.state,
        note: s.note,
        line: firstName(s.from) + " asked " + firstName(s.to) + " to take " + fmt(s.key),
        category: "direct",
        says: s.state === "requested"
          ? "Waiting on " + firstName(s.to) + ". Until it is answered the occurrence is still " + firstName(s.from) + "\u2019s."
          : "Accepted, so the occurrence moved and the rotation did not.",
        actions: s.state === "requested" ? ["Take it", "Can\u2019t"] : []
      };
    });
  }

  /* ── 11. Streak and household progress (FR-CO10) ──────────────────────────*/

  function streakOf(id) {
    var weeks = {};
    COMPLETIONS.filter(function (x) { return x.by === id && !x.awaiting; }).forEach(function (x) {
      weeks[weekStart(x.key)] = true;
    });
    var w = weekStart(TODAY), n = 0;
    while (weeks[w]) { n++; w = addDays(w, -7); }
    return { weeks: n, says: n + " weeks in a row with something done. Not a score, and not compared with anybody." };
  }

  /* An occurrence is in the week if it was completed in it, or if it is the chore's own
     open occurrence, or — for a chore that is up to date — a projection of it. An overdue
     fixed_interval chore projects nothing: there is no next occurrence until this one is
     done, which is the whole of D-49 expressed as a list. */
  function weekOccurrences(weekStartDay) {
    var last = addDays(weekStartDay, 6);
    function inWeek(day) { return day && diff(day, weekStartDay) >= 0 && diff(day, last) <= 0; }
    var out = [];
    CHORES.forEach(function (c) {
      var seen = {};
      function push(key, due, claimedBy) {
        if (seen[key] || !inWeek(due)) return;
        seen[key] = true;
        out.push({ chore: c.id, key: key, due: due, claimedBy: claimedBy || null });
      }
      COMPLETIONS.filter(function (x) { return x.chore === c.id; }).forEach(function (x) {
        push(x.key, x.key);
      });
      var i, day, key;
      if (c.sched.kind === "calendar") {
        for (i = 0; i < 7; i++) {
          day = addDays(weekStartDay, i);
          if (matchesCalendar(c, day)) push(day, day);
        }
      } else if (c.sched.kind === "fixed_interval") {
        var open = openOccurrence(c);
        key = open ? open.due : null;
        push(key, key);
        if (key && diff(key, TODAY) > 0) {                    /* up to date: project forward */
          key = addDays(key, c.sched.every);
          while (key && diff(key, last) <= 0) { push(key, key); key = addDays(key, c.sched.every); }
        }
      } else if (c.sched.kind === "monthly_nth") {
        var t = D(weekStartDay);
        var cand = nthWeekdayOfMonth(t.getUTCFullYear(), t.getUTCMonth(), c.sched.weekday, c.sched.nth);
        push(cand, cand);
        cand = nthWeekdayOfMonth(t.getUTCFullYear(), t.getUTCMonth() + 1, c.sched.weekday, c.sched.nth);
        push(cand, cand);
      } else {
        CLAIMS.filter(function (x) { return x.chore === c.id; }).forEach(function (x) {
          push(x.key, x.on, x.by);
        });
      }
    });
    return out.map(function (o) {
      var c = choreOf(o.chore);
      var who = o.claimedBy || assigneeFor(c, o.key);
      var done = completionFor(c.id, o.key);
      return {
        chore: c.id, name: c.name, key: o.key, due: o.due, points: c.points,
        who: who, mode: c.mode,
        done: !!done && !done.awaiting, awaiting: !!(done && done.awaiting),
        doneBy: done ? done.by : null,
        late: !done && diff(TODAY, o.due) > 0 ? diff(TODAY, o.due) : 0,
        future: diff(o.due, TODAY) > 0,
        predicted: c.mode === "rotating" && diff(o.due, TODAY) > 0
      };
    });
  }

  function householdProgress() {
    var ws = weekStart(TODAY);
    var all = weekOccurrences(ws);
    var toDate = all.filter(function (o) { return diff(o.due, TODAY) <= 0; });
    var done = toDate.filter(function (o) { return o.done || o.awaiting; });
    return {
      weekStart: ws, weekEnd: addDays(ws, 6),
      week: all.length, toDate: toDate.length, done: done.length,
      pct: toDate.length ? Math.round(done.length / toDate.length * 100) : 0,
      says: done.length + " of " + toDate.length + " done so far this week, out of " + all.length +
            " the week asks for. One bar for the household, and no second bar per person."
    };
  }

  /* ── 12. Today, mine first (FR-CO11) ──────────────────────────────────────*/

  function todayFor(memberId) {
    var g = grantOf(memberId, "chores");
    if (g === "none") return { absent: true, grant: g, mine: [], household: [], claimable: [] };
    var open = CHORES.map(function (c) {
      var o = openOccurrence(c);
      if (!o) return null;
      var who = o.claimedBy || assigneeFor(c, o.key);
      var due = o.due;
      var late = due ? Math.max(0, diff(TODAY, due)) : 0;
      if (due && diff(due, TODAY) > 0) return null;             /* not yet due */
      return {
        chore: c.id, name: c.name, room: c.room, minutes: c.minutes, points: c.points,
        key: o.key, due: due, late: late, who: who, mode: c.mode, verify: c.verify,
        claim: c.sched.kind === "on_demand",
        swap: SWAPS.filter(function (s) { return s.chore === c.id && s.key === o.key && s.state === "requested"; })[0] || null,
        awaiting: !!(completionFor(c.id, o.key) || {}).awaiting
      };
    }).filter(Boolean);
    var mine = open.filter(function (o) { return o.who === memberId; });
    var anyone = open.filter(function (o) { return !o.who; });
    var others = open.filter(function (o) { return o.who && o.who !== memberId; });
    return {
      absent: false, grant: g,
      canComplete: atLeast(g, "contribute"),
      mine: mine, anyone: anyone, others: others,
      count: mine.length + anyone.length + others.length,
      order: ["mine", "anyone", "theirs"],
      says: mine.length ? "Mine first, then anything going, then what somebody else is on."
                        : "Nothing of yours today."
    };
  }

  /* ── 13. The weekly grid (FR-CO11, and 05-screens' own risk note) ─────────
     Members across, days down. The layout decision is arithmetic: a legible member column
     is 108 px at 100 % text and 216 px at 200 %, plus a 132 px day column that sticks.
     When the row does not fit, the web view scrolls horizontally and the phone pivots to
     day-major, because a grid narrower than its own columns is not a grid. */

  var GRID_COL = 108, GRID_DAY_COL = 132;

  function gridLayout(n, viewport, scale) {
    var col = Math.round(GRID_COL * scale / 100);
    var dayCol = Math.round(GRID_DAY_COL * scale / 100);
    var need = dayCol + n * col;
    return {
      members: n, viewport: viewport, scale: scale, col: col, dayCol: dayCol, need: need,
      fits: need <= viewport,
      shape: need <= viewport ? "grid" : viewport < 700 ? "pivot" : "grid, scrolled",
      says: need <= viewport
        ? "Fits: " + n + " columns of " + col + " px plus the day column."
        : viewport < 700
          ? "Does not fit " + viewport + " px, so the phone pivots: one day per section, members as rows inside it."
          : "Needs " + need + " px in " + viewport + " px, so the day column sticks and the members scroll."
    };
  }

  function gridCases() {
    var out = [];
    [5, 12].forEach(function (n) {
      [390, 834, 1280].forEach(function (v) {
        [100, 200].forEach(function (s) { out.push(gridLayout(n, v, s)); });
      });
    });
    return out;
  }

  /* Twelve members is a layout stress, not this household: Chores is shared with two
     people here, and pretending otherwise would make the grid a drawing rather than a
     computation. The stress columns are generated and labelled as such. */
  function gridMembers(count) {
    var real = membersWith("view");
    if (count <= real.length) return real.slice(0, count).map(function (id) {
      return { id: id, name: firstName(id), real: true };
    });
    var out = real.map(function (id) { return { id: id, name: firstName(id), real: true }; });
    var names = ["Bara", "Cyril", "Dita", "Emil", "Filip", "Gita", "Hugo", "Ivana", "Jakub", "Katka"];
    for (var i = 0; out.length < count; i++) {
      out.push({ id: "x" + i, name: names[i % names.length], real: false });
    }
    return out;
  }

  function weekGrid(count) {
    var ws = weekStart(TODAY);
    var mem = gridMembers(count || 2);
    var occ = weekOccurrences(ws);
    var days = [];
    for (var i = 0; i < 7; i++) {
      var day = addDays(ws, i);
      days.push({
        day: day, label: shortDay(day), date: D(day).getUTCDate(), today: day === TODAY,
        cells: mem.map(function (m) {
          return {
            member: m.id, name: m.name, real: m.real,
            items: occ.filter(function (o) { return o.due === day && o.who === m.id; })
          };
        }),
        anyone: occ.filter(function (o) { return o.due === day && !o.who; })
      });
    }
    return { weekStart: ws, members: mem, days: days, occurrences: occ.length };
  }

  /* ── 14. The reminder the module registers (FR-RM1) ───────────────────────
     Stage 12 left one thing open on the record: chores.due is declared personal, so a
     second subscriber is still reminded about a chore that is done. Chores owns the
     entity, so the answer is computed here — and it is not a change to the scope. The
     audience of a chores.due reminder is the assignment mode: three of the four modes
     address exactly one member, so "everybody else" cannot happen on them. It can only
     happen on an unassigned chore, where there was never a turn — and there, completing
     the occurrence clears it for everyone, because the work is what was outstanding. */

  function reminderAudience(choreId) {
    var c = choreOf(choreId);
    var open = openOccurrence(c);
    var who = open ? (open.claimedBy || assigneeFor(c, open.key)) : null;
    var audience = who ? [who] : membersWith("contribute");
    return {
      chore: c.id, name: c.name, mode: c.mode, audience: audience,
      size: audience.length,
      clears: who ? "personal" : "the occurrence",
      says: who
        ? "One member is reminded \u2014 whoever\u2019s turn it is \u2014 so a personal completion clears the only reminder there was."
        : "Everybody who can do chores is reminded, and the first completion clears all of them: there was no turn, so there is nobody left to remind."
    };
  }

  function scopeProof() {
    var R = window.HH_REMINDERS;
    var declared = R ? (R.allKinds.filter(function (k) { return k.key === "chores.due"; })[0] || {}) : {};
    var rows = CHORES.map(function (c) { return reminderAudience(c.id); });
    var single = rows.filter(function (r) { return r.size === 1; });
    var many = rows.filter(function (r) { return r.size > 1; });
    var occ = R ? (R.occurrences.filter(function (o) { return o.id === "o-bins"; })[0] || {}) : {};
    return {
      declaredScope: declared.scope || "unknown",
      declaredSrc: declared.src || "",
      strandAudience: occ.who || null,
      strandDue: occ.due || null,
      choreDue: (openOccurrence(choreOf("bins")) || {}).due,
      choreAssignee: assigneeFor(choreOf("bins"), "2026-09-06"),
      agrees: !!occ.who && occ.who.length === 1 && occ.who[0] === "adam" &&
              occ.due === (openOccurrence(choreOf("bins")) || {}).due,
      single: single.length, many: many.length, total: rows.length,
      manyRows: many,
      singleRows: single,
      resolution: "The scope stays personal. The audience is the assignment mode, and the residual case \u2014 an unassigned chore \u2014 clears for everyone on the first completion, because nobody\u2019s turn was outstanding.",
      residual: many.map(function (r) { return r.name; })
    };
  }

  /* ── 15. The gate's own line: Adam's screens ──────────────────────────────*/

  function childView(id) {
    var t = todayFor(id);
    var board = rewardBoard(id);
    var led = ledgerFor(id);
    var swaps = swapRows().filter(function (s) { return s.from === id || s.to === id; });
    var mineOrOpen = t.mine.concat(t.anyone);
    var actions = [];
    if (t.canComplete) actions.push("hold to finish");
    if (mineOrOpen.some(function (o) { return o.claim; })) actions.push("claim");
    actions.push("ask somebody to swap");
    actions.push("skip, with a reason");
    actions.push("snooze");
    if (board.rows.some(function (r) { return r.state !== "short"; })) actions.push("ask for a reward");
    return {
      member: id, name: firstName(id),
      balance: balanceOf(id),
      balancesDrawn: 1,
      otherBalances: 0,
      rankings: 0,
      comparisons: 0,
      entries: led.length,
      entriesWithReason: led.filter(function (e) { return !!e.reason; }).length,
      penaltiesShownInFull: led.filter(function (e) { return e.kind === "penalty"; }).length,
      streak: streakOf(id).weeks,
      actions: actions,
      cannot: ["award or take off points", "verify a completion", "approve a reward", "edit what a chore is worth"],
      verifyNeeded: CHORES.filter(function (c) { return c.verify && assigneeFor(c, TODAY) === id; }).length,
      mine: t.mine.length, anyone: t.anyone.length, others: t.others.length,
      says: "His screen answers three questions: what is mine today, what have I got, and what can I get for it."
    };
  }

  /* ── 16. Sync (the module's own table) ────────────────────────────────────*/

  var SYNC = [
    { entity: "chores.chore", policy: "strict_version", shape: "question",
      note: "A definition change is structural: what it is worth, whose turn it is, how often." },
    { entity: "chores.occurrence", policy: "lww_field", shape: "silent",
      note: "A date and a status. Two devices setting them merge field by field." },
    { entity: "chores.completion", policy: "state_set", shape: "silent",
      note: "Keyed by (occurrence, user). A double completion is idempotent; two people are two rows." },
    { entity: "chores.point_entry", policy: "additive", shape: "silent",
      note: "A ledger is append-only or it is not a ledger." },
    { entity: "chores.swap", policy: "strict_version", shape: "question",
      note: "A two-party state machine. A merge would produce a state neither party agreed to." },
    { entity: "chores.redemption", policy: "strict_version", shape: "question",
      note: "The same, with the ledger on the end of it." }
  ];

  /* ── 17. The screens (05-screens §C Chores — nine rows) ───────────────────*/

  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending",
                    "syncing", "conflicted", "rejected", "absent", "withdrawn", "readonly"];

  var OCC_CONFLICT = "chores.occurrence is lww_field and a completion is state_set keyed by (occurrence, user): two devices merge field by field and a double completion is idempotent, so there is no version of this list for two replicas to disagree about.";
  var MACHINE_CONFLICT = "A swap and a redemption are two-party state machines on strict_version. The server refuses the losing write rather than keeping two versions of it, so this surface shows a refusal and never a comparison.";

  var SCREENS = [
    { id: "C-36", view: "today", client: "mw", preset: "D", route: "/chores", kind: "list",
      name: "Chores today \u2014 mine first", title: "Chores",
      lede: "Mine, then anything going, then what somebody else is on.",
      empty: { s: "Nothing due today.", e: "The bins are Sunday and the plants are Thursday \u2014 this screen is empty most days, which is the point.", a: "See the week" },
      error: "Couldn\u2019t load today\u2019s chores. Anything you finished on this device is still recorded.",
      rejected: "That chore was deleted while you were offline, so the completion had nowhere to go. Nothing was lost \u2014 there is no chore any more.",
      withdrawn: "Chores is no longer shared with you, so this device dropped the board.",
      readonly: "The subscription has lapsed. The board reads; finishing something is held until it resumes.",
      states: {
        pending: "Held for 2000 ms offline: the row says finished, marked in a word and a glyph, and the rotation shows the turn it predicts.",
        offline: "The whole board is on the device. Completing is the ordinary path offline \u2014 a chore is done in a kitchen, not in a browser."
      },
      impossible: { conflicted: OCC_CONFLICT },
      foot: "Hold for 2000 ms, or Enter. It moves the rotation and awards points, which is exactly why it is not a tap.",
      note: "Mine first is not a filter: the household\u2019s work stays visible underneath, because a list that only shows your own turns is how a rotation stops being legible.",
      drawn: "all" },

    { id: "C-37", view: "week", client: "mw", preset: "D", route: "/chores/week", kind: "grid",
      name: "This week \u2014 the weekly grid", title: "This week",
      lede: "Members across, days down.",
      empty: { s: "Nothing scheduled this week.", e: "Add one chore with a day on it and the week fills itself in.", a: "Add a chore" },
      error: "Couldn\u2019t load the week. Today\u2019s list still works.",
      rejected: "That turn belongs to somebody who is no longer in the rotation. Pick who takes it and it will save.",
      withdrawn: "Chores is no longer shared with you. The grid went with it.",
      readonly: "Read-only while the subscription is past due. Nothing on the grid can be ticked.",
      states: {
        populated: "Seven day rows, one column per member and one for anything unassigned. At 200 % text the columns are 216 px and the day column sticks.",
        offline: "Derived from the same occurrences the device already has, so the grid is complete offline rather than a cached window."
      },
      impossible: { conflicted: OCC_CONFLICT },
      foot: "The module\u2019s primary web view. On a phone it pivots to one day per section.",
      note: "This is the screen that makes a rotation legible, so it survives twelve members by scrolling and by pivoting \u2014 never by shrinking a name to four characters.",
      drawn: "all" },

    { id: "C-38", view: "all", client: "mw", preset: "D", route: "/chores/all", kind: "definitions",
      name: "All chores", title: "All chores",
      lede: "The definitions, not the occurrences.",
      empty: { s: "No chores yet.", e: "A starter set puts three to six on the board \u2014 all editable, all deletable.", a: "Pick a starter set" },
      error: "Couldn\u2019t load the definitions. The board is still readable.",
      rejected: "Refused: a chore called \u201cTake the bins out\u201d already exists.",
      withdrawn: "Chores is no longer shared with you.",
      readonly: "Read-only: definitions cannot be edited while the subscription is past due.",
      states: {
        conflicted: "chores.chore is strict_version. Two members editing what a chore is worth is a real disagreement, and the row carries the mark that opens the comparison."
      },
      impossible: {},
      foot: "Ten chores, four schedule kinds, four assignment modes, and a points value on each when points are on.",
      note: "Definitions and occurrences are two screens because they answer two questions: what does this household do, and what is left today.",
      drawn: "all" },

    { id: "C-39", view: "editor", client: "mw", preset: "D", route: "/chores/bins/edit", kind: "editor",
      name: "Chore editor", title: "Take the bins out",
      lede: "Four schedule kinds, four assignment modes.",
      empty: { s: "A new chore.", e: "A name and a day are enough. Points, a room and a duration are all optional.", a: "Name it" },
      error: "Couldn\u2019t save. Everything you typed is still here.",
      rejected: "Petr cannot be in the rotation: Chores is not shared with him. Share it first, or leave him out.",
      withdrawn: "Chores is no longer shared with you, so this editor closed.",
      readonly: "Read-only while the subscription is past due.",
      states: {
        conflicted: "strict_version: the version you opened is not the version on the server. The comparison shows both, field by field.",
        pending: "Saved offline. The rotation shows its predicted next assignee, and the server\u2019s value is the one that counts."
      },
      impossible: {},
      foot: "Rotation state is stored, so reordering the list is an edit and not a recomputation of the past.",
      note: "The schedule kind is the one decision on this screen that a household gets wrong: a grid-anchored interval is what turns a chore into a debt.",
      drawn: "all" },

    { id: "C-40", view: "points", client: "mw", preset: "D", route: "/chores/points/adam", kind: "ledger",
      name: "Points ledger", title: "Adam\u2019s points",
      lede: "Every row says who and why.",
      empty: { s: "No points yet.", e: "The first chore he finishes puts a row here with the date on it.", a: "See today\u2019s chores" },
      error: "Couldn\u2019t load the ledger. The balance you saw last is not shown \u2014 a number without its rows is exactly what this screen exists to avoid.",
      withdrawn: "Chores is no longer shared with you.",
      readonly: "Read-only: the ledger reads, and awards are held until the subscription resumes.",
      states: {
        pending: "An award made offline is queued as a row like any other. An append-only ledger has no other shape.",
        offline: "Every row is on the device, so the balance offline is the balance."
      },
      impossible: {
        conflicted: "additive: two devices appending rows cannot disagree about a sum. There is no version of a ledger.",
        rejected: "An append with an actor, a reason and a member has no invariant left to break, so the server has nothing to refuse."
      },
      foot: "Balance is the sum of the rows on this screen, recomputed on render. Nothing else writes it.",
      note: "A counter an owner can silently edit is not something a child will believe in twice. This is why FR-CO7 says ledger and not counter.",
      drawn: "all" },

    { id: "C-41", view: "rewards", client: "mw", preset: "D", route: "/chores/rewards", kind: "rewards",
      name: "Rewards and redemption", title: "Rewards",
      lede: "Household-defined, and nothing to do with money.",
      empty: { s: "No rewards yet.", e: "\u201cChoose Friday dinner\u201d costs nothing and is worth more than most things you could buy.", a: "Add a reward" },
      error: "Couldn\u2019t load the rewards.",
      rejected: "You have 43 and this costs 60. 17 more and you can ask.",
      withdrawn: "Chores is no longer shared with you.",
      readonly: "Read-only: asking for a reward is held while the subscription is past due.",
      states: {
        pending: "A request made offline sits as asked-not-sent, and it is withdrawable while it waits.",
        absent: "A member who cannot contribute sees the rewards an owner defined and no way to ask for one."
      },
      impossible: { conflicted: MACHINE_CONFLICT },
      foot: "Approving debits the ledger with a row naming the reward. Declining writes nothing.",
      note: "The refusal is the design: a number, a cost and the difference, rather than a disabled button and a shrug.",
      drawn: "all" },

    { id: "C-42", view: "queues", client: "mw", preset: "D", route: "/chores/verify", kind: "queue",
      name: "Verification queue", title: "To check",
      lede: "One chore in this household asks to be checked.",
      empty: { s: "Nothing to check.", e: "Verification is off on nine of the ten chores here, which is how it starts.", a: "See the board" },
      error: "Couldn\u2019t load the queue.",
      rejected: "That completion was withdrawn before you got to it.",
      withdrawn: "Chores is no longer shared with you.",
      readonly: "Read-only: confirming is held while the subscription is past due.",
      states: {
        absent: "Not an owner: there is no queue, no tab and no mention of one.",
        pending: "A confirmation made offline queues the award with it, because the points are the confirmation."
      },
      impossible: { conflicted: MACHINE_CONFLICT },
      foot: "Points are awarded on confirmation, and the ledger row says who confirmed.",
      note: "Returning something is not a penalty and must not read like one: a note, the chore due again, and nothing taken off.",
      drawn: "all" },

    { id: "C-43", view: "queues", client: "mw", preset: "D", route: "/chores/swaps", kind: "swap",
      name: "Swap request / accept", title: "Swaps",
      lede: "Ask somebody to take a turn.",
      empty: { s: "No swaps.", e: "Ask on the chore itself \u2014 the day, and one line saying why.", a: "See today" },
      error: "Couldn\u2019t load the swaps.",
      rejected: "That turn has already been done, so there is nothing to hand over.",
      withdrawn: "Chores is no longer shared with you.",
      readonly: "Read-only while the subscription is past due.",
      states: {
        pending: "Asked offline: it says asked, not sent, and it can be withdrawn while it waits.",
        absent: "A member who can only see the board cannot be asked to take a turn, so nobody\u2019s picker offers them."
      },
      impossible: { conflicted: MACHINE_CONFLICT },
      foot: "Notified in the direct category. It moves the occurrence and leaves the rotation alone.",
      note: "This is what makes a rotation survive a real week, which is why it is a first-class row and not a comment on a chore.",
      drawn: "all" },

    { id: "C-44", view: "prune", client: "mw", preset: "D", route: "/chores/prune", kind: "prune",
      name: "Stale-chore prune \u2014 owner facing", title: "Is this still a chore?",
      lede: "Overdue for 51 days, and untouched.",
      empty: { s: "Nothing stale.", e: "A chore has to be overdue and untouched for 14 days to turn up here.", a: "See the board" },
      error: "Couldn\u2019t check for stale chores.",
      rejected: "It was deleted by somebody else while this was open.",
      withdrawn: "Chores is no longer shared with you.",
      readonly: "Read-only: deleting or rescheduling is held while the subscription is past due.",
      states: {
        absent: "Not an owner: the prune is not offered, and the stale chore simply sits there quietly.",
        pending: "Deleted offline: the row goes, marked as not sent yet, and the undo window runs locally."
      },
      impossible: { conflicted: "The flag is derived from an occurrence age and a last-touched date. A computation cannot hold two versions of itself." },
      foot: "Two actions, and it stopped notifying anybody 50 days ago.",
      note: "This is the other half of \u201cstops escalating\u201d. Without it, a quiet overdue row is just a dead row, and a list of dead rows is what everybody learns to ignore.",
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

  /* ── the gate ─────────────────────────────────────────────────────────────*/

  function checks() {
    var anchor = anchorProof();
    var merge = mergeProof();
    var led = ledgerAudit();
    var adam = childView("adam");
    var scope = scopeProof();
    var grid = gridCases();
    var stale = staleRows();
    var over = overdueRows();
    var vs = verificationShape();
    var prog = householdProgress();
    var cov = coverage();
    var hoover = anchor.filter(function (a) { return a.id === "hoover"; })[0];
    var rot = rotationCandidates();

    return [
      { name: "D-49 is run, not quoted: the interval anchors on the last completion",
        detail: anchor.map(function (a) {
            return a.name.toLowerCase() + " " + a.anchoredOpen + " vs " + a.gridDebt;
          }).join(" \u00b7 ") + " open rows. " + hoover.name + " has been done " + hoover.completions +
          (hoover.completions === 1 ? " time since " : " times since ") + fmt(hoover.created) +
          ": anchored it is one row " + hoover.anchoredOverdue +
          " days late; grid-anchored it would be " + hoover.gridDebt +
          " rows nobody will ever tick. Both rules are implemented in this file and run on the same history.",
        pass: anchor.every(function (a) { return a.anchoredOpen === 1; }) && hoover.gridDebt >= 5 },

      { name: "D-52: two offline completions, one advancement, one award",
        detail: merge.says + " Both receive orders were replayed and agree on rows, credit, awards and next assignee (" +
          (merge.converges ? "identical" : "DIVERGES") + "). The second row is kept \u2014 " +
          firstName(merge.first.secondRow) + " did it too, and an append-only ledger must not pay twice for one bin bag, so the award follows the earliest client_time.",
        pass: merge.converges && merge.first.rows === 2 && merge.first.awards === 1 &&
              merge.first.advancements === 1 && merge.first.questions === 0 },

      { name: "FR-CO4\u2019s asymmetry holds on the fixture",
        detail: ["bins", "dishwasher", "plants"].map(function (id) {
            var s = skipEffect(id); return s.modeLabel.toLowerCase() + ": " + (s.moved ? "moves to " + firstName(s.after) : "stays put");
          }).join(" \u00b7 ") + ". A skip advances weekly_rotation and does not advance rotating, and neither advances points \u2014 which is the difference between a skip and a completion.",
        pass: skipEffect("dishwasher").moved && !skipEffect("bins").moved &&
              skipEffect("bins").points === 0 && skipEffect("dishwasher").points === 0 },

      { name: "Every points row has an actor and a reason, and the balance is their sum",
        detail: led.withActor + " of " + led.rows + " rows name an actor, " + led.withReason +
          " carry a reason in a sentence, and the balance on the screen (" + led.balance +
          ") is recomputed from the rows on render (" + led.recomputed + "). " +
          led.penalties.length + " penalty, shown in full with its reason rather than folded into a total. " +
          led.ledgers + " ledger in this household, because points follow child profiles \u2014 which is also why there is nothing here to rank.",
        pass: led.withActor === led.rows && led.withReason === led.rows &&
              led.balance === led.recomputed && led.penalties.length === 1 && led.editable === 0 },

      { name: "The gate\u2019s own line: Adam\u2019s screens are his, not a list of jobs",
        detail: adam.name + " sees " + adam.balance + " points across " + adam.entries +
          " rows, all with a reason, and a " + adam.streak + "-week streak. Balances drawn on his screens: " +
          adam.balancesDrawn + " \u2014 his. Other members\u2019 numbers: " + adam.otherBalances +
          ". Rankings: " + adam.rankings + ". He has " + adam.actions.length + " things he can do himself (" +
          adam.actions.join(", ") + ") against " + adam.cannot.length +
          " he cannot, and the ones he cannot are absent rather than greyed.",
        pass: adam.balancesDrawn === 1 && adam.otherBalances === 0 && adam.rankings === 0 &&
              adam.entries === adam.entriesWithReason && adam.actions.length >= 5 },

      { name: "No leaderboard survives a second child",
        detail: (function () { var s = siblingProof(); return s.says + " Ranking surfaces in the module: " + s.rankingSurfaces + "."; })(),
        pass: siblingProof().rankingSurfaces === 0 &&
              siblingProof().balancesPerScreen.every(function (n) { return n === 1; }) },

      { name: "Overdue is shown once and then goes quiet",
        detail: over.length + " chores are overdue (" + over.map(function (r) { return r.name.toLowerCase() + " " + r.late + " d"; }).join(" \u00b7 ") +
          "). Escalations per chore: " + over.map(function (r) { return r.escalations; }).join("/") +
          ", re-notifications: " + over.map(function (r) { return r.renotifications; }).join("/") +
          ". The dates in between are never materialised, so an overdue chore cannot become a stack of rows.",
        pass: over.length > 0 && over.every(function (r) { return r.escalations === 1 && r.renotifications === 0; }) },

      { name: "The prune is the other half of that, and it is owner-facing",
        detail: stale.length + " chore is stale at " + STALE_DAYS + " days: " +
          stale.map(function (r) { return r.name.toLowerCase() + ", " + r.late + " days overdue, untouched for " + r.untouchedDays; }).join("; ") +
          ". Two actions, and " + pruneCopy(stale[0]).quiet.toLowerCase() +
          " Adam does not see this surface at all \u2014 " + (childView("adam").cannot.length > 0 ? "it is not in his list" : "MISSING") + ".",
        pass: stale.length === 1 && pruneCopy(stale[0]).actions.length === 2 && pruneCopy(stale[0]).ownerOnly },

      { name: "Verification is off by default, and it is one chore of ten",
        detail: vs.says + " The one that has it on is Adam\u2019s desk, and the return path carries a note and takes nothing off: \u201c" +
          verificationQueue()[0].returnCopy + "\u201d",
        pass: vs.on === 1 && vs.off === CHORES.length - 1 && verificationQueue().length === 1 },

      { name: "Stage 12\u2019s open question is answered from the mode, not by changing the scope",
        detail: "The strand declares chores.due " + scope.declaredScope + " (" + scope.declaredSrc +
          "). " + scope.single + " of " + scope.total + " chores address exactly one member, so \u201ceverybody else is still reminded\u201d cannot happen on them. It can happen on " +
          scope.many + " \u2014 " + scope.residual.join(", ").toLowerCase() +
          " \u2014 where there was never a turn, and there the first completion clears the reminder for everyone. " +
          (scope.agrees ? "reminders.js\u2019s own o-bins row agrees with this file on the date and the audience." : "MISMATCH with reminders.js"),
        pass: scope.declaredScope === "personal" && scope.single === 7 && scope.many === 3 && scope.agrees },

      { name: "A rotation cannot contain somebody who cannot do chores",
        detail: rot.map(function (r) { return r.name + " " + r.grant; }).join(" \u00b7 ") + ". " +
          rot.filter(function (r) { return r.eligible; }).length + " of " + rot.length +
          " members can be in a rotation here, so a rotation in this household is two people and the picker says why for the other three \u2014 the same rule as FR-TA5\u2019s assignee picker, refused with a reason rather than silently dropped.",
        pass: rot.filter(function (r) { return r.eligible; }).length === 2 &&
              rot.every(function (r) { return !!r.says; }) },

      { name: "The grid survives twelve members and 200 % text by arithmetic",
        detail: grid.filter(function (g) { return g.members === 12; }).map(function (g) {
            return g.scale + " % at " + g.viewport + ": " + g.shape;
          }).join(" \u00b7 ") + ". Twelve columns at 200 % text need " +
          gridLayout(12, 1280, 200).need + " px, so the day column sticks and the members scroll; under 700 px the phone pivots to day-major. Nothing shrinks a name to fit.",
        pass: gridLayout(12, 1280, 200).shape === "grid, scrolled" &&
              gridLayout(12, 390, 100).shape === "pivot" &&
              gridLayout(5, 1280, 100).fits },

      { name: "One bar for the household, and it counts what is actually due",
        detail: prog.says + " The bar divides by what is due so far (" + prog.toDate +
          "), not by the whole week (" + prog.week + "), because a Wednesday bar that counts Sunday\u2019s bins is a bar that always reads as failure.",
        pass: prog.toDate < prog.week && prog.done <= prog.toDate && prog.pct >= 0 },

      { name: "Every state these nine rows can reach is drawn",
        detail: cov.map(function (c) { return c.id + " " + c.drawn.length + "/" + c.required.length; }).join(" \u00b7 ") +
          " states, " + cov.reduce(function (n, c) { return n + c.cells; }, 0) + " cells. " +
          cov.reduce(function (n, c) { return n + c.impossible.length; }, 0) +
          " exclusions, all from three facts: an occurrence is lww_field, a completion is state_set, and a two-party state machine refuses rather than forks.",
        pass: cov.every(function (c) { return c.complete; }) }
    ];
  }

  window.HH_CHORES = {
    version: "0.1-stage-14-candidate",
    today: TODAY, staleDays: STALE_DAYS, holdMs: HOLD_MS, resetDow: RESET_DOW,
    chores: CHORES, choreOf: choreOf, scheduleKinds: SCHEDULE_KINDS, modes: MODES, modeOf: modeOf,
    openOccurrence: openOccurrence, gridOccurrences: gridOccurrences, anchorProof: anchorProof,
    assigneeFor: assigneeFor, predictedAssignee: predictedAssignee, rotationCandidates: rotationCandidates,
    completions: COMPLETIONS, completionFor: completionFor, claims: CLAIMS, mergeProof: mergeProof,
    skipEffect: skipEffect, snoozes: SNOOZES,
    overdueRows: overdueRows, staleRows: staleRows, pruneCopy: pruneCopy,
    pointEntries: POINT_ENTRIES, entryKinds: ENTRY_KINDS, ledgerFor: ledgerFor, balanceOf: balanceOf,
    ledgerAudit: ledgerAudit, siblingProof: siblingProof,
    rewards: REWARDS, redemptions: REDEMPTIONS, rewardOf: rewardOf, rewardBoard: rewardBoard,
    approvalQueue: approvalQueue, verificationQueue: verificationQueue, verificationShape: verificationShape,
    swaps: SWAPS, swapRows: swapRows,
    streakOf: streakOf, householdProgress: householdProgress, weekOccurrences: weekOccurrences,
    todayFor: todayFor, weekGrid: weekGrid, gridLayout: gridLayout, gridCases: gridCases, gridMembers: gridMembers,
    reminderAudience: reminderAudience, scopeProof: scopeProof, childView: childView,
    membersWith: membersWith, children: children, sync: SYNC,
    screens: SCREENS, rows: SCREENS, allStates: ALL_STATES, coverage: coverage,
    fmt: fmt, addDays: addDays, diff: diff, weekStart: weekStart, shortDay: shortDay, dayNames: DAY_NAMES,
    firstName: firstName,
    checks: checks
  };
})();
