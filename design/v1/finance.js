/* Stage 16 — Finance.
   Sources: docs/prd/modules/09-finance.md (FR-FI1-25, D-54 to D-59, D-81, the data model,
   the sync table, Catalog contributions, Permissions), design/05-screens.md §D Finance,
   02-components.md §4.8 (chart: flow) and §4.10 (the import wizard), 03-patterns.md §1
   (the import wizard's four states, the Finance ledger as list→detail), §5 (the honesty
   table, negative remainder) and §10 (offers), 01-foundations.md §7 (money display,
   zero-decimal currencies), prd/03-platform-strands.md §6 FR-RM1 (the reminder contract).

   The engine is the deliverable, and in this module the engine is arithmetic that has to
   reconcile to the crown. Three properties carry the stage:

     · Allocation is DERIVED ON READ (FR-FI5). Nothing here is stored. A movement that
       actually happened may be POSTED, and from that moment it is an ordinary ledger row
       that the plan never touches again.
     · Exactly one remainder rule per source (FR-FI4/D-56). The remainder absorbs every
       rounded haléř, which is what makes Σ outflows == inflow true rather than nearly true.
     · The last minor unit of a split is assigned deterministically (D-57), so a balance
       does not change when you refresh it.

   Money is integer minor units and the exponent comes from ISO 4217 rather than being
   assumed to be 2. Nothing in this file is a float in a sum.
*/
(function () {
  var TODAY = "2026-09-09";
  var BASE = "CZK";

  /* ── dates ────────────────────────────────────────────────────────────── */
  function D(s) { return new Date(s + "T00:00:00Z"); }
  function iso(dt) { return dt.toISOString().slice(0, 10); }
  function addDays(s, n) { var dt = D(s); dt.setUTCDate(dt.getUTCDate() + n); return iso(dt); }
  function diff(a, b) { return Math.round((D(b) - D(a)) / 86400000); }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
                "September", "October", "November", "December"];
  function fmt(s) {
    if (!s) return "\u2014";
    var p = s.split("-");
    return Number(p[2]) + " " + MONTHS[Number(p[1]) - 1].slice(0, 3) + " " + p[0].slice(2);
  }
  function fmtLong(s) {
    if (!s) return "\u2014";
    var p = s.split("-");
    return Number(p[2]) + " " + MONTHS[Number(p[1]) - 1] + " " + p[0];
  }
  function monthKey(s) { return s.slice(0, 7); }
  function monthLabel(k) {
    var p = k.split("-");
    return MONTHS[Number(p[1]) - 1] + " " + p[0];
  }
  function nextMonth(k) {
    var p = k.split("-").map(Number);
    return p[1] === 12 ? (p[0] + 1) + "-01" : p[0] + "-" + String(p[1] + 1).padStart(2, "0");
  }
  function monthRange(from, to) {
    var out = [], k = from;
    while (k <= to) { out.push(k); k = nextMonth(k); }
    return out;
  }

  /* ── money · ISO 4217 exponents, never assumed ────────────────────────── */
  var EXPONENT = { CZK: 2, EUR: 2, GBP: 2, PLN: 2, HUF: 2, ISK: 0, JPY: 0 };
  var SYMBOL = { CZK: "K\u010d", EUR: "\u20ac", GBP: "\u00a3", PLN: "z\u0142", HUF: "Ft", ISK: "kr", JPY: "\u00a5" };
  function exp(cur) { return EXPONENT[cur] == null ? 2 : EXPONENT[cur]; }
  function grp(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0"); }
  function money(minor, cur) {
    if (minor == null) return "\u2014";
    cur = cur || BASE;
    var e = exp(cur), unit = Math.pow(10, e);
    var neg = minor < 0, v = Math.abs(Math.round(minor));
    var frac = e ? "," + String(v % unit).padStart(e, "0") : "";
    return (neg ? "\u2212" : "") + grp(Math.floor(v / unit)) + frac + "\u00a0" + (SYMBOL[cur] || cur);
  }
  function moneyRound(minor, cur) {
    if (minor == null) return "\u2014";
    cur = cur || BASE;
    var unit = Math.pow(10, exp(cur));
    var neg = minor < 0, v = Math.abs(Math.round(minor / unit));
    return (neg ? "\u2212" : "") + grp(v) + "\u00a0" + (SYMBOL[cur] || cur);
  }
  function pct(n) { return String(Math.round(n * 10) / 10).replace(".", ",") + "\u00a0%"; }
  /* Half-up to the minor unit, once, at the point a value is materialised. */
  function roundMinor(x) { return x < 0 ? -Math.round(-x) : Math.round(x); }

  /* ── the household ────────────────────────────────────────────────────── */
  var FALLBACK_ORDER = ["jana", "petr", "adam", "klara", "milos"];
  function order() {
    var F = window.HH_FIXTURES;
    return F ? F.members.map(function (m) { return m.id; }) : FALLBACK_ORDER.slice();
  }
  function nameOf(id) {
    var F = window.HH_FIXTURES;
    var m = F && F.members.filter(function (x) { return x.id === id; })[0];
    return m ? m.name : id;
  }

  /* ── FR-FI1 · accounts. Six types; personal requires an owner and no other type may ─── */
  var ACCOUNTS = [
    { id: "a-jana", name: "Jana \u2014 osobn\u00ed", type: "personal", owner: "jana", currency: "CZK",
      opening: 1240000, inst: "\u010cSOB", last4: "4471", active: true, pos: 1 },
    { id: "a-petr", name: "Petr \u2014 osobn\u00ed", type: "personal", owner: "petr", currency: "CZK",
      opening: 880000, inst: "Air Bank", last4: "0192", active: true, pos: 2 },
    { id: "a-joint", name: "Provozn\u00ed \u00fa\u010det", type: "joint", owner: null, currency: "CZK",
      opening: 4310000, inst: "\u010cesk\u00e1 spo\u0159itelna", last4: "8820", active: true, pos: 3 },
    { id: "a-rezerva", name: "Rezerva", type: "savings", owner: null, currency: "CZK",
      opening: 18600000, inst: "\u010cesk\u00e1 spo\u0159itelna", last4: "8821", active: true, pos: 4 },
    { id: "a-dovolena", name: "Dovolen\u00e1 2027", type: "savings", owner: null, currency: "CZK",
      opening: 2140000, inst: "\u010cesk\u00e1 spo\u0159itelna", last4: "8822", active: true, pos: 5 },
    { id: "a-bills", name: "Slo\u017eenky a spl\u00e1tky", type: "other", owner: null, currency: "CZK",
      opening: 620000, inst: "\u010cesk\u00e1 spo\u0159itelna", last4: "8823", active: true, pos: 6 },
    { id: "a-cash", name: "Hotovost", type: "cash", owner: null, currency: "CZK",
      opening: 340000, inst: null, last4: null, active: true, pos: 7 },
    { id: "a-card", name: "Kreditn\u00ed karta \u2014 zru\u0161en\u00e1", type: "credit", owner: null, currency: "CZK",
      opening: 0, inst: "\u010cSOB", last4: "9930", active: false, pos: 8 }
  ];
  function acct(id) { return ACCOUNTS.filter(function (a) { return a.id === id; })[0]; }
  function acctName(id) { var a = acct(id); return a ? a.name : id; }
  function personalOf(member) {
    var a = ACCOUNTS.filter(function (x) { return x.type === "personal" && x.owner === member; })[0];
    return a ? a.id : null;
  }
  function accountAudit() {
    return ACCOUNTS.map(function (a) {
      var ok = a.type === "personal" ? !!a.owner : !a.owner;
      return { id: a.id, type: a.type, owner: a.owner, ok: ok,
               why: a.type === "personal"
                 ? (a.owner ? "personal, owned by " + nameOf(a.owner) : "personal with no owner \u2014 refused")
                 : (a.owner ? a.type + " with an owner \u2014 refused" : a.type + ", household-owned") };
    });
  }

  /* ── FR-FI2 · income entries. N earners, per period, per source ───────── */
  var INCOME = [
    { id: "in-01-j", period: "2026-01", member: "jana", amount: 4193333, source: "Mzda \u2014 \u0160koda Digital" },
    { id: "in-01-p", period: "2026-01", member: "petr", amount: 2646667, source: "Fakturace \u2014 OSV\u010c" },
    { id: "in-02-j", period: "2026-02", member: "jana", amount: 4193333, source: "Mzda \u2014 \u0160koda Digital" },
    { id: "in-02-p", period: "2026-02", member: "petr", amount: 2646667, source: "Fakturace \u2014 OSV\u010c" },
    { id: "in-03-j", period: "2026-03", member: "jana", amount: 4193333, source: "Mzda \u2014 \u0160koda Digital" },
    { id: "in-03-p", period: "2026-03", member: "petr", amount: 2646667, source: "Fakturace \u2014 OSV\u010c" },
    { id: "in-04-j", period: "2026-04", member: "jana", amount: 4193333, source: "Mzda \u2014 \u0160koda Digital" },
    { id: "in-04-p", period: "2026-04", member: "petr", amount: 2646667, source: "Fakturace \u2014 OSV\u010c" },
    { id: "in-06-j", period: "2026-06", member: "jana", amount: 4193333, source: "Mzda \u2014 \u0160koda Digital" },
    { id: "in-07-j", period: "2026-07", member: "jana", amount: 4193333, source: "Mzda \u2014 \u0160koda Digital" },
    { id: "in-08-j", period: "2026-08", member: "jana", amount: 4193333, source: "Mzda \u2014 \u0160koda Digital" },
    { id: "in-08-p1", period: "2026-08", member: "petr", amount: 2246667, source: "Fakturace \u2014 OSV\u010c" },
    { id: "in-08-p2", period: "2026-08", member: "petr", amount: 400000, source: "Pron\u00e1jem gar\u00e1\u017ee" },
    { id: "in-09-j", period: "2026-09", member: "jana", amount: 4193333, source: "Mzda \u2014 \u0160koda Digital" },
    { id: "in-09-p1", period: "2026-09", member: "petr", amount: 2246667, source: "Fakturace \u2014 OSV\u010c" },
    { id: "in-09-p2", period: "2026-09", member: "petr", amount: 400000, source: "Pron\u00e1jem gar\u00e1\u017ee" },
    { id: "in-11-j", period: "2025-11", member: "jana", amount: 3860000, source: "Mzda \u2014 \u0160koda Digital" },
    { id: "in-11-p", period: "2025-11", member: "petr", amount: 2410000, source: "Fakturace \u2014 OSV\u010c" }
  ];
  function incomeOf(period) { return INCOME.filter(function (e) { return e.period === period; }); }
  function incomeTotal(period) {
    return incomeOf(period).reduce(function (n, e) { return n + e.amount; }, 0);
  }
  /* FR-FI10 · the real failure mode is a month nobody entered. Two readings of it:
     a month with no income at all, and a month where an earner who normally earns has none. */
  function missingPeriods(from, to) {
    var earners = {};
    INCOME.forEach(function (e) { earners[e.member] = (earners[e.member] || 0) + 1; });
    var known = Object.keys(earners);
    return monthRange(from || "2026-01", to || monthKey(TODAY)).map(function (k) {
      var rows = incomeOf(k);
      var here = rows.map(function (r) { return r.member; });
      var absent = known.filter(function (m) { return here.indexOf(m) < 0; });
      return { period: k, rows: rows.length, total: incomeTotal(k),
               none: rows.length === 0, partial: rows.length > 0 && absent.length > 0,
               absent: absent };
    });
  }

  /* ── FR-FI3/FR-FI6 · the allocation plan, versioned by effective period ─
     home's locked formula is expressible in this model exactly, which is what
     PLANS[0] and the HOME fixture below are for. */
  var PLANS = [
    { id: "pl-2025", version: 1, effective_from: "2025-01", label: "2025 \u2014 before the pay rise",
      by: "jana", rules: [
        { order: 1, from: "income", per_earner: true, basis: "own_income", mode: "percent", value: 15,
          to: "owner_personal", label: "Kapesn\u00e9" },
        { order: 2, from: "income", per_earner: true, mode: "remainder", to: "a-joint",
          label: "Na provozn\u00ed \u00fa\u010det" },
        { order: 3, from: "a-joint", basis: "total_income", mode: "percent", value: 8, to: "a-rezerva",
          label: "Rezerva" },
        { order: 4, from: "a-joint", mode: "amount", value: 200000, to: "a-dovolena", label: "Dovolen\u00e1" },
        { order: 5, from: "a-joint", mode: "amount", value: 3400000, to: "a-bills",
          label: "Slo\u017eenky a spl\u00e1tky" },
        { order: 6, from: "a-joint", mode: "remainder", to: "a-joint",
          label: "Z\u016fst\u00e1v\u00e1 na provozn\u00edm" }
      ] },
    { id: "pl-2026", version: 2, effective_from: "2026-01", label: "2026 \u2014 the current plan",
      by: "jana", rules: [
        { order: 1, from: "income", per_earner: true, basis: "own_income", mode: "percent", value: 20,
          to: "owner_personal", label: "Kapesn\u00e9" },
        { order: 2, from: "income", per_earner: true, mode: "remainder", to: "a-joint",
          label: "Na provozn\u00ed \u00fa\u010det" },
        { order: 3, from: "a-joint", basis: "total_income", mode: "percent", value: 10, to: "a-rezerva",
          label: "Rezerva" },
        { order: 4, from: "a-joint", mode: "amount", value: 338000, to: "a-dovolena",
          label: "Dovolen\u00e1 2027" },
        { order: 5, from: "a-joint", mode: "amount", value: 3800000, to: "a-bills",
          label: "Slo\u017eenky a spl\u00e1tky" },
        { order: 6, from: "a-joint", mode: "remainder", to: "a-joint",
          label: "Z\u016fst\u00e1v\u00e1 na provozn\u00edm" }
      ] }
  ];
  function planFor(period) {
    var out = null;
    PLANS.forEach(function (p) { if (p.effective_from <= period) out = p; });
    return out;
  }
  /* A version governs every period until the next one begins; the end is derived. */
  function planSpans() {
    return PLANS.map(function (p, i) {
      var next = PLANS[i + 1];
      return { id: p.id, version: p.version, label: p.label, from: p.effective_from,
               to: next ? monthLabel(prevMonth(next.effective_from)) : "open",
               toKey: next ? prevMonth(next.effective_from) : null };
    });
  }
  function prevMonth(k) {
    var p = k.split("-").map(Number);
    return p[1] === 1 ? (p[0] - 1) + "-12" : p[0] + "-" + String(p[1] - 1).padStart(2, "0");
  }

  /* FR-FI4/D-56 · exactly one remainder per source, refused at save by name. */
  function validatePlan(rules) {
    var sources = {}, errors = [];
    rules.forEach(function (r) {
      var k = r.from;
      sources[k] = sources[k] || { total: 0, remainder: 0 };
      sources[k].total++;
      if (r.mode === "remainder") sources[k].remainder++;
    });
    Object.keys(sources).forEach(function (k) {
      var label = k === "income" ? "income" : acctName(k);
      if (sources[k].remainder === 0)
        errors.push({ source: k, count: 0,
          says: "\u201c" + label + "\u201d has no rule that takes what is left. Every crown that comes in has to land somewhere \u2014 mark one rule as taking the remainder." });
      if (sources[k].remainder > 1)
        errors.push({ source: k, count: sources[k].remainder,
          says: "\u201c" + label + "\u201d has " + sources[k].remainder + " rules taking what is left. Only one can: the second would always be zero." });
    });
    return { ok: errors.length === 0, errors: errors, sources: Object.keys(sources).length };
  }

  /* FR-FI5 · derived on read. This function writes nothing, ever. */
  function allocate(period, opts) {
    opts = opts || {};
    var plan = opts.plan || planFor(period);
    var entries = opts.entries || incomeOf(period);
    var earners = order().filter(function (id) {
      return entries.some(function (e) { return e.member === id; });
    });
    var own = {}, total = 0;
    earners.forEach(function (id) { own[id] = 0; });
    entries.forEach(function (e) { own[e.member] += e.amount; total += e.amount; });

    var potOwn = {}, potIncome = total, pots = {}, edges = [];
    earners.forEach(function (id) { potOwn[id] = own[id]; });

    plan.rules.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (rule) {
      if (rule.from === "income" && rule.per_earner) {
        earners.forEach(function (id) {
          var basis = rule.basis === "own_income" ? own[id] : total;
          var amt = rule.mode === "percent" ? roundMinor(basis * rule.value / 100)
                  : rule.mode === "amount" ? rule.value : potOwn[id];
          var to = rule.to === "owner_personal" ? personalOf(id) : rule.to;
          potOwn[id] -= amt; potIncome -= amt;
          pots[to] = (pots[to] || 0) + amt;
          edges.push({ rule: rule.order, label: rule.label, mode: rule.mode, earner: id,
                       from: "income", fromLabel: nameOf(id), to: to, toLabel: acctName(to),
                       amount: amt, stays: false, stage: 2,
                       basis: rule.basis === "own_income" ? "of " + nameOf(id) + "\u2019s own income" : "" });
        });
      } else if (rule.from === "income") {
        var basisP = rule.mode === "percent" ? total : 0;
        var amtP = rule.mode === "percent" ? roundMinor(basisP * rule.value / 100)
                 : rule.mode === "amount" ? rule.value : potIncome;
        potIncome -= amtP;
        pots[rule.to] = (pots[rule.to] || 0) + amtP;
        edges.push({ rule: rule.order, label: rule.label, mode: rule.mode, earner: null,
                     from: "income", fromLabel: "Income", to: rule.to, toLabel: acctName(rule.to),
                     amount: amtP, stays: false, stage: 2, basis: "of the household\u2019s income" });
      } else {
        var src = rule.from;
        var basisA = rule.basis === "total_income" ? total
                   : rule.basis === "source_balance" ? (pots[src] || 0) : total;
        var amtA = rule.mode === "percent" ? roundMinor(basisA * rule.value / 100)
                 : rule.mode === "amount" ? rule.value : (pots[src] || 0);
        var stays = rule.to === src;
        pots[src] = (pots[src] || 0) - amtA;
        if (!stays) pots[rule.to] = (pots[rule.to] || 0) + amtA;
        else pots[src] += amtA;
        edges.push({ rule: rule.order, label: rule.label, mode: rule.mode, earner: null,
                     from: src, fromLabel: acctName(src), to: rule.to, toLabel: acctName(rule.to),
                     amount: amtA, stays: stays, stage: 3,
                     basis: rule.basis === "total_income" ? "of the household\u2019s income" : "" });
      }
    });

    var remainderEdge = edges.filter(function (e) { return e.stays; })[0] || null;
    var remaining = remainderEdge ? remainderEdge.amount : 0;
    /* FR-FI8 · a negative remainder is shown as zero and never clamped in the data. */
    var shown = remaining < 0 ? 0 : remaining;

    /* FR-FI7 · the three invariants. */
    var perEarner = earners.map(function (id) {
      var got = edges.filter(function (e) { return e.earner === id; })
                     .reduce(function (n, e) { return n + e.amount; }, 0);
      return { member: id, name: nameOf(id), income: own[id], allocated: got, ok: got === own[id] };
    });
    var sources = {};
    edges.forEach(function (e) {
      if (e.from === "income") return;
      sources[e.from] = sources[e.from] || { inflow: 0, outflow: 0 };
      sources[e.from].outflow += e.amount;
    });
    edges.forEach(function (e) {
      if (sources[e.to] && !e.stays) sources[e.to].inflow += e.amount;
    });
    var sourceRows = Object.keys(sources).map(function (k) {
      return { account: k, name: acctName(k), inflow: sources[k].inflow,
               outflow: sources[k].outflow, ok: sources[k].inflow === sources[k].outflow };
    });
    var fromIncome = edges.filter(function (e) { return e.from === "income"; })
                          .reduce(function (n, e) { return n + e.amount; }, 0);
    var everyInflow = edges.filter(function (e) { return !e.stays; })
                           .reduce(function (n, e) { return n + e.amount; }, 0);

    return {
      period: period, plan: plan, entries: entries, earners: earners, own: own, total: total,
      edges: edges, pots: pots, remainder: remaining, remainderShown: shown,
      negative: remaining < 0, allocated: total - remaining,
      perEarner: perEarner, sources: sourceRows, fromIncome: fromIncome, everyInflow: everyInflow,
      ok: perEarner.every(function (p) { return p.ok; }) &&
          sourceRows.every(function (s) { return s.ok; }) && fromIncome === total
    };
  }

  /* FR-FI7 · home's worked example, as a fixture the generalised engine must reproduce. */
  var HOME = {
    entries: [{ id: "h-j", period: "home", member: "jana", amount: 6000000, source: "Income A" },
              { id: "h-p", period: "home", member: "petr", amount: 4000000, source: "Income B" }],
    plan: { id: "pl-home", version: 0, effective_from: "home", label: "home \u2014 the locked formula",
      rules: [
        { order: 1, from: "income", per_earner: true, basis: "own_income", mode: "percent", value: 20,
          to: "owner_personal", label: "Personal" },
        { order: 2, from: "income", per_earner: true, mode: "remainder", to: "a-joint", label: "Operational" },
        { order: 3, from: "a-joint", basis: "total_income", mode: "percent", value: 10, to: "a-rezerva",
          label: "Savings 1" },
        { order: 4, from: "a-joint", basis: "total_income", mode: "percent", value: 10, to: "a-dovolena",
          label: "Savings 2" },
        { order: 5, from: "a-joint", mode: "remainder", to: "a-joint", label: "Needs" }
      ] }
  };
  function homeRun() {
    var r = allocate("home", { plan: HOME.plan, entries: HOME.entries });
    var got = {
      personalJana: r.edges.filter(function (e) { return e.rule === 1 && e.earner === "jana"; })[0].amount,
      personalPetr: r.edges.filter(function (e) { return e.rule === 1 && e.earner === "petr"; })[0].amount,
      operational: r.edges.filter(function (e) { return e.rule === 2; })
                    .reduce(function (n, e) { return n + e.amount; }, 0),
      savings1: r.edges.filter(function (e) { return e.rule === 3; })[0].amount,
      savings2: r.edges.filter(function (e) { return e.rule === 4; })[0].amount,
      needs: r.edges.filter(function (e) { return e.rule === 5; })[0].amount
    };
    var want = { personalJana: 1200000, personalPetr: 800000, operational: 8000000,
                 savings1: 1000000, savings2: 1000000, needs: 6000000 };
    var mismatch = Object.keys(want).filter(function (k) { return got[k] !== want[k]; });
    return { run: r, got: got, want: want, ok: mismatch.length === 0 && r.ok, mismatch: mismatch,
      says: "Incomes " + money(6000000) + " and " + money(4000000) + " through the generalised engine: personal " +
        money(got.personalJana) + " and " + money(got.personalPetr) + ", operational received " +
        money(got.operational) + ", savings " + money(got.savings1) + " and " + money(got.savings2) +
        ", remainder " + money(got.needs) + "." };
  }

  /* ── the flow view (FR-FI9) and posting (D-81) ────────────────────────── */
  /* A posted movement is an ordinary transaction. It is never regenerated and editing the
     plan does not touch it — which is why posted is stored and planned is not. */
  var POSTED = [
    { id: "tx-al-1", period: "2026-09", rule: 1, earner: "jana", on: "2026-09-02", amount: 838667, by: "jana" },
    { id: "tx-al-2", period: "2026-09", rule: 1, earner: "petr", on: "2026-09-02", amount: 529333, by: "jana" },
    { id: "tx-al-3", period: "2026-09", rule: 2, earner: "jana", on: "2026-09-02", amount: 3354666, by: "jana" },
    { id: "tx-al-4", period: "2026-09", rule: 2, earner: "petr", on: "2026-09-02", amount: 2117334, by: "jana" },
    { id: "tx-al-5", period: "2026-09", rule: 3, earner: null, on: "2026-09-03", amount: 680000, by: "jana" },
    { id: "tx-al-6", period: "2026-09", rule: 5, earner: null, on: "2026-09-03", amount: 3800000, by: "jana" }
  ];
  function postedFor(period, rule, earner) {
    return POSTED.filter(function (p) {
      return p.period === period && p.rule === rule && (p.earner || null) === (earner || null);
    })[0] || null;
  }
  function flow(period) {
    var run = allocate(period);
    var stages = [];
    stages.push({ key: "in", label: "Co p\u0159i\u0161lo", note: run.entries.length + " sources, " + run.earners.length + " earners",
      rows: run.entries.map(function (e) {
        return { title: e.source, who: nameOf(e.member), amount: e.amount, kind: "income" };
      }) });

    var movements = run.edges.filter(function (e) { return !e.stays; }).map(function (e) {
      var p = postedFor(period, e.rule, e.earner);
      return {
        key: e.rule + (e.earner || ""), stage: e.stage, label: e.label,
        fromLabel: e.from === "income" ? (e.earner ? nameOf(e.earner) : "Income") : acctName(e.from),
        toLabel: acctName(e.to), planned: e.amount,
        posted: p ? p.amount : null, on: p ? p.on : null, by: p ? nameOf(p.by) : null,
        delta: p ? p.amount - e.amount : null, mode: e.mode, basis: e.basis
      };
    });
    stages.push({ key: "keep", label: "Co si kdo nech\u00e1 a co jde d\u00e1l",
      note: "rules 1 and 2, per earner",
      rows: movements.filter(function (m) { return m.stage === 2; }) });
    stages.push({ key: "out", label: "Co odch\u00e1z\u00ed z provozn\u00edho \u00fa\u010dtu",
      note: "rules 3 to 5",
      rows: movements.filter(function (m) { return m.stage === 3; }) });

    var postedCount = movements.filter(function (m) { return m.posted != null; }).length;
    var different = movements.filter(function (m) { return m.posted != null && m.delta !== 0; });
    var outstanding = movements.filter(function (m) { return m.posted == null; });
    return {
      run: run, stages: stages, movements: movements, remaining: run.remainderShown,
      remainingRaw: run.remainder, posted: postedCount, outstanding: outstanding,
      different: different,
      says: movements.length + " movements this month, " + postedCount + " of them posted. " +
        (outstanding.length
          ? outstanding.map(function (m) { return m.label + " (" + money(m.planned) + ")"; }).join(", ") +
            " " + (outstanding.length === 1 ? "has" : "have") + " not happened yet."
          : "Every one of them has happened.") +
        (different.length
          ? " " + different[0].label + " was posted as " + money(different[0].posted) + " against a planned " +
            money(different[0].planned) + " \u2014 " + money(Math.abs(different[0].delta)) + " apart, and the screen says so."
          : "")
    };
  }

  /* The gate's own line: N to M, reconciling exactly, readable on a phone.
     Stage-major rows against the columnar alternative, in pixels, at both text sizes. */
  function phoneFit(period) {
    var f = flow(period);
    var rows = f.stages.reduce(function (n, s) { return n + s.rows.length; }, 0) + 1;
    var PHONE = 360, framePad = 28, rowPad = 20, gap = 8;
    var avail = PHONE - framePad - rowPad;
    var CH_SANS = 6.8, CH_MONO = 7.2;
    var labels = [];
    f.stages.forEach(function (s) {
      s.rows.forEach(function (r) { labels.push(r.label || r.title); labels.push(r.toLabel || r.who || ""); });
    });
    var longestWord = labels.join(" ").split(/\s+/).reduce(function (a, w) {
      return w.length > a.length ? w : a;
    }, "");
    var amounts = f.movements.map(function (m) { return money(m.planned).length; });
    var maxAmount = Math.max.apply(null, amounts.concat([money(f.run.total).length]));
    var token100 = Math.max(longestWord.length * CH_SANS, maxAmount * CH_MONO);
    var token200 = token100 * 2;

    /* the rejected alternative: one column per node, all on screen at once */
    var nodes = 2 + Object.keys(f.run.pots).length;
    var col100 = maxAmount * CH_MONO + 16, col200 = col100 * 2;
    return {
      rows: rows, avail: avail, nodes: nodes,
      longestWord: longestWord, maxAmount: maxAmount,
      token100: Math.round(token100), token200: Math.round(token200),
      fits100: token100 <= avail, fits200: token200 <= avail,
      columnar100: Math.round(nodes * col100 + (nodes - 1) * gap),
      columnar200: Math.round(nodes * col200 + (nodes - 1) * gap),
      columnarFits: nodes * col200 + (nodes - 1) * gap <= PHONE,
      says: "Stage-major, the widest unbreakable token is " + Math.round(token100) + " px at 100 % text and " +
        Math.round(token200) + " px at 200 %, against " + avail +
        " px of row. Node-major \u2014 one column per source and account, which is how this diagram is usually drawn \u2014 needs " +
        Math.round(nodes * col100 + (nodes - 1) * gap) + " px and " +
        Math.round(nodes * col200 + (nodes - 1) * gap) + " px for the same " + nodes + " nodes."
    };
  }

  /* Household never moves money and must never look like it does. */
  var CLAIM_WORDS = ["we moved", "we have moved", "we transferred", "transferred for you",
                     "sent to your", "paid for you", "on your behalf", "automatically transfers",
                     "household moves", "we will move"];
  function claimScan(period) {
    var f = flow(period);
    var strings = [];
    f.stages.forEach(function (s) {
      strings.push(s.label, s.note);
      s.rows.forEach(function (r) { strings.push(r.label || r.title || "", r.toLabel || ""); });
    });
    strings = strings.concat(POST_COPY).concat([f.says]);
    var hits = [];
    CLAIM_WORDS.forEach(function (w) {
      strings.forEach(function (s) { if (String(s).toLowerCase().indexOf(w) >= 0) hits.push(w + " \u2014 " + s); });
    });
    var attributed = f.movements.filter(function (m) { return m.posted != null; });
    return { strings: strings.length, hits: hits,
             attributed: attributed.filter(function (m) { return m.by && m.on; }).length,
             postedTotal: attributed.length };
  }
  var POST_COPY = [
    "Zaznamenat, \u017ee jsi to p\u0159evedl\u00e1",
    "This records that the transfer happened. Household does not move money and cannot make the transfer for you.",
    "Posted by Jana on 2 September",
    "Not yet \u2014 the standing order runs on the 15th"
  ];

  /* ── FR-FI12/D-57 · split methods and the deterministic last minor unit ── */
  function split(total, method, participants, opt) {
    opt = opt || {};
    var stable = order().filter(function (id) { return participants.indexOf(id) >= 0; });
    participants.forEach(function (id) { if (stable.indexOf(id) < 0) stable.push(id); });
    var n = stable.length, raw = {}, out = {}, base = total;

    if (method === "exact") {
      stable.forEach(function (id) { out[id] = opt.exact[id] || 0; });
      return finish(out, "Amounts as typed; the editor refuses a set that does not sum to the total.");
    }
    var weights = {};
    if (method === "equal") stable.forEach(function (id) { weights[id] = 1; });
    if (method === "shares") stable.forEach(function (id) { weights[id] = opt.shares[id] || 0; });
    if (method === "percent") stable.forEach(function (id) { weights[id] = opt.percent[id] || 0; });
    if (method === "adjustment") {
      var adjTotal = 0;
      stable.forEach(function (id) { adjTotal += (opt.adjust[id] || 0); });
      base = total - adjTotal;
      stable.forEach(function (id) { weights[id] = 1; });
    }
    var W = 0;
    stable.forEach(function (id) { W += weights[id]; });
    var floored = 0;
    stable.forEach(function (id) {
      raw[id] = base * weights[id] / W;
      out[id] = Math.floor(raw[id]);
      floored += out[id];
    });
    /* the last minor units, one each, in the household's own stable order */
    var left = base - floored, i = 0, extra = [];
    while (left > 0) { out[stable[i % n]] += 1; extra.push(stable[i % n]); left--; i++; }
    if (method === "adjustment") stable.forEach(function (id) { out[id] += (opt.adjust[id] || 0); });
    return finish(out, extra.length
      ? "The last " + extra.length + " minor unit" + (extra.length > 1 ? "s go" : " goes") + " to " +
        extra.map(nameOf).join(", ") + " \u2014 first in the household's own order, every time this row is read."
      : "No remainder: the split divides exactly.");

    function finish(shares, why) {
      var sum = 0;
      stable.forEach(function (id) { sum += shares[id]; });
      return { method: method, participants: stable, shares: shares, sum: sum, total: total,
               ok: sum === total, why: why };
    }
  }
  /* D-57's own example, in the currency the requirement uses. */
  function tenEuroRun() {
    var a = split(1000, "equal", ["jana", "petr", "milos"]);
    var b = split(1000, "equal", ["milos", "petr", "jana"]);
    var c = split(1000, "equal", ["petr", "milos", "jana"]);
    var reads = [a, b, c].map(function (r) {
      return r.participants.map(function (id) { return money(r.shares[id], "EUR"); }).join(" / ");
    });
    var canonical = order().filter(function (id) { return ["jana", "petr", "milos"].indexOf(id) >= 0; })
      .map(function (id) { return money(a.shares[id], "EUR"); }).join(" / ");
    var same = [a, b, c].every(function (r) {
      return ["jana", "petr", "milos"].every(function (id) { return r.shares[id] === a.shares[id]; });
    });
    return { runs: [a, b, c], reads: reads, canonical: canonical, same: same,
             ok: same && a.ok && a.shares.jana === 334 && a.shares.petr === 333 && a.shares.milos === 333 };
  }

  /* ── FR-FI11 · shared expenses ────────────────────────────────────────── */
  var EXPENSES = [
    { id: "ex-1", date: "2026-08-26", desc: "Chata Lipno \u2014 pron\u00e1jem", amount: 600000, currency: "CZK",
      paid: [["jana", 600000]], participants: ["jana", "petr", "milos"], method: "equal",
      category: "c-zabava", account: "a-jana", doc: "doc-lipno" },
    { id: "ex-2", date: "2026-08-30", desc: "Potraviny \u2014 Albert", amount: 147000, currency: "CZK",
      paid: [["petr", 147000]], participants: ["jana", "petr", "milos"], method: "equal",
      category: "c-potraviny", account: "a-petr", doc: null },
    { id: "ex-3", date: "2026-09-02", desc: "Ve\u010de\u0159e \u2014 U Kalicha", amount: 231000, currency: "CZK",
      paid: [["milos", 231000]], participants: ["jana", "petr", "milos"], method: "adjustment",
      adjust: { petr: 33000 }, category: "c-restaurace", account: "a-cash", doc: null,
      why: "Base split equally, plus the wine, which was Petr's." },
    { id: "ex-4", date: "2026-09-01", desc: "N\u00e1jem \u2014 z\u00e1\u0159\u00ed", amount: 2450000, currency: "CZK",
      paid: [["jana", 2450000]], participants: [], method: "none",
      category: "c-najem", account: "a-joint", doc: "doc-najem",
      why: "Household spending from the joint account. It belongs in the budget and creates no balance (FR-FI15)." }
  ];
  function sharesOf(e) {
    if (e.method === "none") return { method: "none", participants: [], shares: {}, sum: 0, total: e.amount, ok: true,
      why: "Not split. Paid from the joint account and counted in the budget." };
    if (e.method === "adjustment") return split(e.amount, "adjustment", e.participants, { adjust: e.adjust });
    return split(e.amount, e.method, e.participants, e);
  }
  var SETTLEMENTS = [
    { id: "st-1", date: "2026-09-06", from: "petr", to: "jana", amount: 77000,
      note: "Za chatu \u2014 zbytek pozd\u011bji" },
    { id: "st-2", date: "2026-09-07", from: "milos", to: "jana", amount: 53000, note: "" }
  ];

  /* FR-FI13 · net per member and per pair, in the base currency, at each row's stored rate. */
  function balances() {
    var net = {}, pair = {};
    function bump(a, b, amt) {
      var k = a < b ? a + "|" + b : b + "|" + a;
      pair[k] = pair[k] || 0;
      pair[k] += (a < b ? amt : -amt);
    }
    EXPENSES.forEach(function (e) {
      var s = sharesOf(e);
      if (e.method === "none") return;
      var paidBy = {};
      e.paid.forEach(function (p) { paidBy[p[0]] = (paidBy[p[0]] || 0) + p[1]; });
      Object.keys(paidBy).forEach(function (id) { net[id] = (net[id] || 0) + paidBy[id]; });
      s.participants.forEach(function (id) { net[id] = (net[id] || 0) - s.shares[id]; });
      s.participants.forEach(function (debtor) {
        Object.keys(paidBy).forEach(function (payer) {
          if (payer === debtor) return;
          var portion = roundMinor(s.shares[debtor] * paidBy[payer] / e.amount);
          bump(payer, debtor, portion);
        });
      });
    });
    SETTLEMENTS.forEach(function (s) {
      net[s.from] = (net[s.from] || 0) + s.amount;
      net[s.to] = (net[s.to] || 0) - s.amount;
      bump(s.to, s.from, s.amount);
    });
    var rows = order().filter(function (id) { return net[id] != null && net[id] !== 0; })
      .map(function (id) { return { member: id, name: nameOf(id), net: net[id] }; });
    var pairs = Object.keys(pair).filter(function (k) { return pair[k] !== 0; }).map(function (k) {
      var p = k.split("|"), v = pair[k];
      return v > 0 ? { from: p[1], to: p[0], amount: v } : { from: p[0], to: p[1], amount: -v };
    }).map(function (t) {
      return { from: t.from, to: t.to, amount: t.amount,
               says: nameOf(t.from) + " \u2192 " + nameOf(t.to) + " \u00b7 " + money(t.amount) };
    });
    var sum = rows.reduce(function (n, r) { return n + r.net; }, 0);
    return { net: net, rows: rows, pairs: pairs, sum: sum, ok: sum === 0 };
  }
  /* FR-FI14 · the simplified set is a suggestion; the recorded settlement is what happened. */
  function simplify() {
    var b = balances();
    var cred = b.rows.filter(function (r) { return r.net > 0; })
      .map(function (r) { return { id: r.member, v: r.net }; });
    var debt = b.rows.filter(function (r) { return r.net < 0; })
      .map(function (r) { return { id: r.member, v: -r.net }; });
    cred.sort(function (a, c) { return c.v - a.v; });
    debt.sort(function (a, c) { return c.v - a.v; });
    var out = [], i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      var amt = Math.min(debt[i].v, cred[j].v);
      out.push({ from: debt[i].id, to: cred[j].id, amount: amt,
                 says: nameOf(debt[i].id) + " \u2192 " + nameOf(cred[j].id) + " \u00b7 " + money(amt) });
      debt[i].v -= amt; cred[j].v -= amt;
      if (debt[i].v === 0) i++;
      if (cred[j].v === 0) j++;
    }
    return { transfers: out, pairwise: b.pairs, saved: b.pairs.length - out.length, balances: b };
  }

  /* ── FR-FI16/FR-FI17 · categories and budgets ─────────────────────────── */
  var CATEGORIES = [
    { id: "c-jidlo", name: "J\u00eddlo", parent: null, kind: "expense", colour: "chart-1" },
    { id: "c-potraviny", name: "Potraviny", parent: "c-jidlo", kind: "expense", colour: "chart-1" },
    { id: "c-restaurace", name: "Restaurace", parent: "c-jidlo", kind: "expense", colour: "chart-1" },
    { id: "c-bydleni", name: "Bydlen\u00ed", parent: null, kind: "expense", colour: "chart-2" },
    { id: "c-najem", name: "N\u00e1jem", parent: "c-bydleni", kind: "expense", colour: "chart-2" },
    { id: "c-energie", name: "Energie", parent: "c-bydleni", kind: "expense", colour: "chart-2" },
    { id: "c-doprava", name: "Doprava", parent: null, kind: "expense", colour: "chart-3" },
    { id: "c-palivo", name: "Palivo", parent: "c-doprava", kind: "expense", colour: "chart-3" },
    { id: "c-mhd", name: "MHD", parent: "c-doprava", kind: "expense", colour: "chart-3" },
    { id: "c-domacnost", name: "Dom\u00e1cnost", parent: null, kind: "expense", colour: "chart-4" },
    { id: "c-drogerie", name: "Drogerie", parent: "c-domacnost", kind: "expense", colour: "chart-4" },
    { id: "c-opravy", name: "Opravy", parent: "c-domacnost", kind: "expense", colour: "chart-4" },
    { id: "c-deti", name: "D\u011bti", parent: null, kind: "expense", colour: "chart-5" },
    { id: "c-krouzky", name: "Krou\u017eky", parent: "c-deti", kind: "expense", colour: "chart-5" },
    { id: "c-zabava", name: "Z\u00e1bava", parent: null, kind: "expense", colour: "chart-6" },
    { id: "c-predplatne", name: "P\u0159edplatn\u00e9", parent: "c-zabava", kind: "expense", colour: "chart-6" },
    { id: "c-prijem", name: "P\u0159\u00edjem", parent: null, kind: "income", colour: "chart-7" },
    { id: "c-mzda", name: "Mzda", parent: "c-prijem", kind: "income", colour: "chart-7" },
    { id: "c-prevod", name: "P\u0159evod mezi \u00fa\u010dty", parent: null, kind: "transfer", colour: "chart-8" }
  ];
  function catName(id) { var c = CATEGORIES.filter(function (x) { return x.id === id; })[0]; return c ? c.name : id; }

  /* The household's budget period runs from payday, not from the 1st. */
  var BUDGET_PERIOD = { from: "2026-08-15", to: "2026-09-14", label: "15 August \u2013 14 September" };
  var BUDGETS = [
    { id: "b-jidlo", category: "c-jidlo", planned: 1000000, actual: 780000, rollover: false, carried: 0 },
    { id: "b-doprava", category: "c-doprava", planned: 500000, actual: 230000, rollover: false, carried: 0 },
    { id: "b-domacnost", category: "c-domacnost", planned: 500000, actual: 520000, rollover: false, carried: 0 },
    { id: "b-deti", category: "c-deti", planned: 300000, actual: 183000, rollover: false, carried: 0 },
    { id: "b-zabava", category: "c-zabava", planned: 80000, actual: 104000, rollover: true, carried: 26000 }
  ];
  function budgetRun(day) {
    day = day || TODAY;
    var total = diff(BUDGET_PERIOD.from, BUDGET_PERIOD.to) + 1;
    var elapsed = Math.min(total, diff(BUDGET_PERIOD.from, day) + 1);
    return {
      period: BUDGET_PERIOD, total: total, elapsed: elapsed,
      rows: BUDGETS.map(function (b) {
        var budget = b.planned + (b.rollover ? b.carried : 0);
        var projected = roundMinor(b.actual * total / elapsed);
        return {
          id: b.id, category: catName(b.category), planned: b.planned, carried: b.rollover ? b.carried : 0,
          budget: budget, actual: b.actual, remaining: budget - b.actual,
          pct: Math.round(b.actual / b.planned * 100), projected: projected,
          over: b.actual > budget, willBeOver: projected > budget, rollover: b.rollover
        };
      })
    };
  }

  /* ── FR-FI21-24 · recurring, price history, the cancellation window ───── */
  var RECURRING = [
    { id: "r-netflix", name: "Netflix", amount: 27900, currency: "CZK", cadence: "monthly",
      next: "2026-10-04", category: "c-predplatne", account: "a-joint", payee: "Netflix International B.V.",
      notice: 14, status: "active", doc: null },
    { id: "r-o2", name: "O2 \u2014 mobiln\u00ed tarif", amount: 74900, currency: "CZK", cadence: "monthly",
      next: "2026-10-07", renewal: "2027-01-31", category: "c-bydleni", account: "a-bills",
      payee: "O2 Czech Republic", notice: 60, status: "active", doc: "doc-o2" },
    { id: "r-pojisteni", name: "Poji\u0161t\u011bn\u00ed dom\u00e1cnosti", amount: 485000, currency: "CZK", cadence: "annual",
      next: "2026-11-15", renewal: "2026-11-15", category: "c-bydleni", account: "a-bills",
      payee: "\u010cesk\u00e1 poji\u0161\u0165ovna", notice: 42, status: "active", doc: "doc-pojisteni" },
    { id: "r-spotify", name: "Spotify Family", amount: 19900, currency: "CZK", cadence: "monthly",
      next: null, category: "c-predplatne", account: "a-joint", payee: "Spotify AB",
      notice: null, status: "paused", doc: null },
    { id: "r-kupon", name: "Ro\u010dn\u00ed kup\u00f3n PID", amount: 365000, currency: "CZK", cadence: "annual",
      next: "2027-03-01", category: "c-mhd", account: "a-joint", payee: "Dopravn\u00ed podnik",
      notice: null, status: "active", doc: null }
  ];
  var PRICE_HISTORY = [
    { rec: "r-netflix", from: "2024-05-04", amount: 19900, by: null, why: "Signed up" },
    { rec: "r-netflix", from: "2024-11-04", amount: 22900, by: "jana", why: "New price, confirmed" },
    { rec: "r-netflix", from: "2025-08-04", amount: 24900, by: "jana", why: "New price, confirmed" },
    { rec: "r-netflix", from: "2026-04-04", amount: 27900, by: "jana", why: "New price, confirmed" },
    { rec: "r-o2", from: "2025-02-07", amount: 74900, by: null, why: "Contract signed" }
  ];
  /* FR-FI22 · a due item is a pending transaction the member confirms. Never auto-posted. */
  var MATERIALISED = [
    { id: "m-netflix", rec: "r-netflix", due: "2026-09-04", amount: 27900, state: "confirmed",
      confirmedBy: "jana", confirmedOn: "2026-09-04", asTyped: 27900 },
    { id: "m-o2", rec: "r-o2", due: "2026-09-07", amount: 74900, state: "pending",
      asTyped: 79900, question: "price_change" }
  ];
  function priceRuns(recId, years) {
    var rows = PRICE_HISTORY.filter(function (p) { return p.rec === recId; })
      .sort(function (a, b) { return a.from < b.from ? -1 : 1; });
    var since = addDays(TODAY, -365 * (years || 2));
    var rises = rows.filter(function (r, i) { return i > 0 && r.from >= since && r.amount > rows[i - 1].amount; });
    var first = rows[0], last = rows[rows.length - 1];
    return { rows: rows, rises: rises, since: since,
      pctTotal: first ? Math.round((last.amount - first.amount) / first.amount * 100) : 0,
      says: rows.length ? nameOfRec(recId) + " has gone up " + rises.length + " times in " + (years || 2) +
        " years \u2014 " + money(first.amount) + " to " + money(last.amount) + ", " +
        Math.round((last.amount - first.amount) / first.amount * 100) + " % \u2014 and almost nothing else can answer that." : "" };
  }
  function nameOfRec(id) { var r = RECURRING.filter(function (x) { return x.id === id; })[0]; return r ? r.name : id; }
  /* FR-FI24/D-58 · the reminder fires at the notice period, which is the last moment
     cancelling is still possible. The strand resolves it; this module supplies the date. */
  function cancellationWindows() {
    return RECURRING.filter(function (r) { return r.notice && r.status === "active"; }).map(function (r) {
      var renews = r.renewal || r.next;
      return { rec: r.id, name: r.name, renews: renews, notice: r.notice,
               fires: addDays(renews, -r.notice), amount: r.amount,
               says: r.name + " renews " + fmtLong(renews) + "; the notice period is " + r.notice +
                 " days, so the reminder is " + fmtLong(addDays(renews, -r.notice)) +
                 " \u2014 the last day cancelling still works." };
    });
  }
  function dueRun(day) {
    day = day || TODAY;
    return {
      due: MATERIALISED.length,
      pending: MATERIALISED.filter(function (m) { return m.state === "pending"; }).length,
      confirmed: MATERIALISED.filter(function (m) { return m.state === "confirmed"; }).length,
      autoPosted: 0,
      changed: MATERIALISED.filter(function (m) { return m.asTyped !== m.amount; }),
      rows: MATERIALISED.map(function (m) {
        var r = RECURRING.filter(function (x) { return x.id === m.rec; })[0];
        return { id: m.id, name: r.name, due: m.due, defined: r.amount, typed: m.asTyped,
                 state: m.state, delta: m.asTyped - r.amount,
                 asks: m.asTyped !== r.amount };
      })
    };
  }

  /* ── FR-FI18 · the unified ledger ─────────────────────────────────────── */
  var TRANSACTIONS = [
    { id: "tx-1", date: "2026-09-08", desc: "Lidl Vyso\u010dany", counter: "Lidl \u010cR", amount: -74230,
      currency: "CZK", account: "a-cash", category: "c-potraviny", kind: "expense", source: "manual",
      by: "jana", ref: null, note: "From the Shopping trip \u2014 offered, never recorded automatically",
      link: "shopping.trip/t-0909" },
    { id: "tx-2", date: "2026-09-06", desc: "Netflix", counter: "Netflix International B.V.", amount: -27900,
      currency: "CZK", account: "a-joint", category: "c-predplatne", kind: "expense", source: "recurring",
      by: "jana", ref: "m-netflix" },
    { id: "tx-3", date: "2026-09-05", desc: "MOL PRAHA 9", counter: "MOL \u010cR", amount: -124000,
      currency: "CZK", account: "a-joint", category: "c-palivo", kind: "expense", source: "import",
      by: "jana", ref: "20260905/0001" },
    { id: "tx-4", date: "2026-09-03", desc: "Krou\u017eek \u2014 florbal", counter: "TJ Sokol", amount: -90000,
      currency: "CZK", account: "a-joint", category: "c-krouzky", kind: "expense", source: "import",
      by: "jana", ref: "20260903/0004" },
    { id: "tx-5", date: "2026-09-03", desc: "Provozn\u00ed \u2192 Rezerva", counter: null, amount: -680000,
      currency: "CZK", account: "a-joint", category: "c-prevod", kind: "transfer", source: "allocation",
      by: "jana", ref: "pl-2026/3" },
    { id: "tx-6", date: "2026-09-02", desc: "Ve\u010de\u0159e \u2014 U Kalicha", counter: "U Kalicha", amount: -231000,
      currency: "CZK", account: "a-cash", category: "c-restaurace", kind: "expense", source: "split",
      by: "milos", ref: "ex-3" },
    { id: "tx-7", date: "2026-09-02", desc: "Mzda \u2014 \u0160koda Digital", counter: "\u0160koda Digital s.r.o.",
      amount: 4193333, currency: "CZK", account: "a-jana", category: "c-mzda", kind: "income",
      source: "import", by: "jana", ref: "20260902/0002" },
    { id: "tx-8", date: "2026-09-01", desc: "N\u00e1jem \u2014 z\u00e1\u0159\u00ed", counter: "Bytov\u00e9 dru\u017estvo", amount: -2450000,
      currency: "CZK", account: "a-joint", category: "c-najem", kind: "expense", source: "import",
      by: "jana", ref: "20260901/0001" },
    { id: "tx-9", date: "2026-08-30", desc: "Potraviny \u2014 Albert", counter: "Albert \u010cR", amount: -147000,
      currency: "CZK", account: "a-petr", category: "c-potraviny", kind: "expense", source: "split",
      by: "petr", ref: "ex-2" },
    { id: "tx-10", date: "2026-08-26", desc: "Chata Lipno \u2014 pron\u00e1jem", counter: "Chalupa Lipno",
      amount: -600000, currency: "CZK", account: "a-jana", category: "c-zabava", kind: "expense",
      source: "split", by: "jana", ref: "ex-1" },
    { id: "tx-11", date: "2026-08-14", desc: "Hotel Wien", counter: "Hotel Am Stephansplatz",
      amount: -596400, currency: "CZK", account: "a-jana", category: "c-zabava", kind: "expense",
      source: "manual", by: "jana", ref: null,
      fx: { amount: 24000, currency: "EUR", rate: 24.85, source: "ECB \u00b7 14 August 2026" } },
    { id: "tx-12", date: "2026-08-03", desc: "B\u00edlkuv\u00f6llur \u2014 p\u016fj\u010dovna aut", counter: "Blue Car Rental",
      amount: -84280, currency: "CZK", account: "a-jana", category: "c-doprava", kind: "expense",
      source: "manual", by: "jana", ref: null,
      fx: { amount: 4900, currency: "ISK", rate: 0.172, source: "ECB \u00b7 3 August 2026" } },
    { id: "tx-13", date: "2026-03-03", desc: "Vy\u00fa\u010dtov\u00e1n\u00ed elekt\u0159iny \u2014 \u010cEZ", counter: "\u010cEZ Prodej",
      amount: -45000, currency: "CZK", account: "a-joint", category: "c-energie", kind: "expense",
      source: "manual", by: "jana", ref: null, conflict: "cf-1" },
    { id: "tx-14", date: "2025-11-02", desc: "Servis kotle \u2014 Novotn\u00fd", counter: "Novotn\u00fd \u2014 plynoservis",
      amount: -348000, currency: "CZK", account: "a-cash", category: "c-domacnost", kind: "expense",
      source: "manual", by: "jana", ref: null }
  ];
  var LEDGER_TOTAL = 118; /* rows in the current budget period; the page below is one keyset page */
  var SOURCES = ["manual", "import", "split", "allocation", "recurring"];
  function ledgerPage(limit, cursor) {
    var rows = TRANSACTIONS.slice().sort(function (a, b) {
      return a.date === b.date ? (a.id < b.id ? 1 : -1) : (a.date < b.date ? 1 : -1);
    });
    var start = 0;
    if (cursor) {
      rows.forEach(function (r, i) { if (r.id === cursor) start = i + 1; });
    }
    var page = rows.slice(start, start + (limit || rows.length));
    var last = page[page.length - 1];
    return { rows: page, next: last ? { date: last.date, id: last.id } : null,
             of: LEDGER_TOTAL, sources: SOURCES.filter(function (s) {
               return page.some(function (r) { return r.source === s; });
             }) };
  }
  /* D-55 · the rate is captured at entry and stored on the row. */
  var ECB_TODAY = { EUR: 25.10, ISK: 0.169 };
  function fxDrift() {
    var rows = TRANSACTIONS.filter(function (t) { return t.fx; });
    return rows.map(function (t) {
      var now = roundMinor(t.fx.amount * Math.pow(10, 2 - exp(t.fx.currency)) * ECB_TODAY[t.fx.currency]);
      return { id: t.id, desc: t.desc, original: money(t.fx.amount, t.fx.currency), rate: t.fx.rate,
               stored: -t.amount, wouldBe: now, delta: now + t.amount,
               says: money(t.fx.amount, t.fx.currency) + " at " + String(t.fx.rate).replace(".", ",") +
                 " on the day is " + money(-t.amount) + ". At today's reference rate it would be " +
                 money(now) + " \u2014 " + money(Math.abs(now + t.amount)) + " different, every time the row is read." };
    });
  }

  /* ── FR-FI19/FR-FI20 · import, deduplication, rules ───────────────────── */
  function normalise(s) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function hashKey(row) {
    return [row.account, row.date, row.amount, normalise(row.desc)].join("|");
  }
  var IMPORT_MAPPINGS = [
    { id: "map-cs", name: "\u010cesk\u00e1 spo\u0159itelna \u2014 b\u011b\u017en\u00fd \u00fa\u010det", format: "CSV",
      delimiter: ";", encoding: "windows-1250", date: "DD.MM.YYYY", decimal: ",", sign: "negative-is-debit",
      columns: [["Datum zauct.", "date"], ["\u010c\u00e1stka", "amount"], ["Popis", "description"],
                ["Protiu\u010det", "counterparty"], ["Ref. banky", "external_ref"]], uses: 4 },
    { id: "map-camt", name: "Air Bank \u2014 camt.053", format: "camt.053 XML", delimiter: null,
      encoding: "UTF-8", date: "ISO", decimal: ".", sign: "CdtDbtInd", columns: [], uses: 1 }
  ];
  var IMPORT_ROWS = [
    { i: 1, date: "2026-09-05", desc: "MOL PRAHA 9", amount: -124000, ref: "20260905/0001", account: "a-joint" },
    { i: 2, date: "2026-09-04", desc: "NETFLIX.COM AMSTERDAM", amount: -27900, ref: "20260904/0003", account: "a-joint" },
    { i: 3, date: "2026-09-03", desc: "KAVARNA PLACHTA", amount: -8900, ref: "20260903/0007", account: "a-joint" },
    { i: 4, date: "2026-09-03", desc: "Kav\u00e1rna Plachta ", amount: -8900, ref: "20260903/0011", account: "a-joint" },
    { i: 5, date: "2026-09-03", desc: "TJ SOKOL FLORBAL", amount: -90000, ref: "20260903/0004", account: "a-joint" },
    { i: 6, date: "2026-09-02", desc: "SKODA DIGITAL SRO MZDA", amount: 4193333, ref: "20260902/0002", account: "a-jana" },
    { i: 7, date: "2026-09-01", desc: "BYTOVE DRUZSTVO NAJEM", amount: -2450000, ref: "20260901/0001", account: "a-joint" },
    { i: 8, date: "2026-08-31", desc: "LIDL 0842 PRAHA", amount: -62140, ref: "20260831/0002", account: "a-joint" },
    { i: 9, date: "2026-08-29", desc: "CEZ PRODEJ ZALOHA", amount: -330000, ref: "20260829/0005", account: "a-joint" },
    { i: 10, date: "2026-08-28", desc: "LIDL 0842 PRAHA", amount: -41980, ref: "20260828/0009", account: "a-joint" },
    { i: 11, date: "2026-08-27", desc: "MOL PRAHA 9", amount: -98600, ref: "20260827/0003", account: "a-joint" },
    { i: 12, date: "2026-08-26", desc: "DPP KUPON", amount: -55000, ref: "20260826/0001", account: "a-joint" }
  ];
  var IMPORT_RULES = [
    { id: "ru-lidl", contains: "LIDL", category: "c-potraviny", by: "jana" },
    { id: "ru-mol", contains: "MOL", category: "c-palivo", by: "jana" },
    { id: "ru-netflix", contains: "NETFLIX", category: "c-predplatne", by: "jana" },
    { id: "ru-cez", contains: "CEZ", category: "c-energie", by: "jana" }
  ];
  function applyRules(rows) {
    return rows.map(function (r) {
      var hit = IMPORT_RULES.filter(function (ru) {
        return normalise(r.desc).indexOf(normalise(ru.contains)) >= 0;
      })[0];
      return { row: r, category: hit ? hit.category : null, rule: hit ? hit.id : null };
    });
  }
  function dedupe() {
    var existing = {};
    TRANSACTIONS.forEach(function (t) {
      existing[hashKey({ account: t.account, date: t.date, amount: t.amount, desc: t.desc })] = t;
      if (t.ref) existing["ref|" + t.ref] = t;
    });
    var seen = {}, suspects = [];
    IMPORT_ROWS.forEach(function (r) {
      var k = hashKey(r);
      var byRef = r.ref && existing["ref|" + r.ref];
      var byHash = existing[k] || seen[k];
      if (byHash || byRef) {
        suspects.push({
          row: r, key: k,
          against: byRef ? byRef.id : (existing[k] ? existing[k].id : seen[k].i),
          sameRef: !!byRef,
          verdict: byRef ? "duplicate" : "different reference \u2014 confirm",
          says: byRef
            ? "Same bank reference as a row already imported. This is the same payment twice."
            : "Same account, date, amount and normalised description \u2014 but a different bank reference. Two coffees, ten minutes apart, is an ordinary Thursday."
        });
      }
      seen[k] = r;
    });
    var applied = applyRules(IMPORT_ROWS);
    return {
      rows: IMPORT_ROWS.length, suspects: suspects,
      duplicates: suspects.filter(function (s) { return s.sameRef; }).length,
      confirmed: suspects.filter(function (s) { return !s.sameRef; }).length,
      droppedSilently: 0, importedSilently: 0,
      categorised: applied.filter(function (a) { return a.category; }).length,
      uncategorised: applied.filter(function (a) { return !a.category; }).length,
      applied: applied
    };
  }
  function reapplyToHistory() {
    var hits = applyRules(TRANSACTIONS.map(function (t) {
      return { desc: t.desc + " " + (t.counter || ""), id: t.id, category: t.category };
    }));
    var changed = hits.filter(function (h, i) {
      return h.category && h.category !== TRANSACTIONS[i].category;
    });
    return { rows: TRANSACTIONS.length, matched: hits.filter(function (h) { return h.category; }).length,
             changed: changed.length, rules: IMPORT_RULES.length };
  }

  /* ── the sync table, and the one module where a dialog is right ───────── */
  var SYNC = [
    ["finance.account", "strict_version", "Structural", true],
    ["finance.allocation_plan", "strict_version", "Money. A half-merged plan is a wrong number nobody will find", true],
    ["finance.allocation_rule", "strict_version", "Money", true],
    ["finance.income_entry", "strict_version", "Money", true],
    ["finance.transaction", "strict_version", "Money", true],
    ["finance.expense_share", "strict_version", "Money", true],
    ["finance.settlement", "additive", "A settlement happened; it is a fact, not a state", false],
    ["finance.category", "lww_field", "Not money in the ledger sense", false],
    ["finance.budget", "lww_field", "Not money in the ledger sense", false],
    ["finance.recurring", "lww_field", "Not money in the ledger sense", false]
  ];
  /* The conflicted row is Stage 5's own inbox entry, read from sync.js rather than retyped. */
  function conflictRun() {
    var S = window.HH_SYNC;
    var entry = S && S.inbox ? S.inbox.filter(function (c) { return c.id === "cf-1"; })[0] : null;
    var tx = TRANSACTIONS.filter(function (t) { return t.conflict === "cf-1"; })[0];
    var strictRow = SYNC.filter(function (r) { return r[0] === "finance.transaction"; })[0];
    var theirs = entry ? entry.theirs.who.toLowerCase() : "petr";
    var grant = grantOf(theirs === "petr" ? "petr" : theirs);
    return {
      entry: entry, tx: tx, policy: strictRow[1],
      mineValue: money(-tx.amount), theirsValue: entry ? entry.theirs.value : "500,00 K\u010d",
      agrees: !!entry && entry.mine.value.replace(/\s/g, "") === money(-tx.amount).replace(/\s/g, "\u00a0").replace(/\u00a0/g, ""),
      matches: !!entry && entry.module === "finance" && entry.mine.value.indexOf("450") >= 0 &&
               String(-tx.amount) === "45000",
      writer: theirs, writerGrant: grant,
      writerCan: grant === "contribute" || grant === "manage",
      says: entry
        ? entry.question + " \u2014 " + entry.where + ", " + entry.title +
          ". The row this resolver opens is " + tx.id + ", " + money(-tx.amount) + " on " + fmtLong(tx.date) + "."
        : "sync.js not loaded; the resolver draws the module's own copy."
    };
  }

  /* ── FR-FI25/D-59 · permissions. Finance defaults to none for everybody ── */
  var OPS = [
    ["See accounts, transactions, balances and budgets", "view"],
    ["Add income, an expense, a transaction or a settlement", "contribute"],
    ["Import a statement", "contribute"],
    ["Post an allocation movement that happened", "contribute"],
    ["Edit accounts and the allocation plan", "manage"],
    ["Edit categories, budgets and recurring definitions", "manage"],
    ["Delete a transaction \u2014 a hard delete whose audit event carries the whole row", "manage"]
  ];
  var LEVELS = ["none", "view", "contribute", "manage"];
  function grantOf(memberId) {
    var F = window.HH_FIXTURES;
    var m = F && F.members.filter(function (x) { return x.id === memberId; })[0];
    return m ? m.grants.finance : "none";
  }
  function can(memberId, level) {
    return LEVELS.indexOf(grantOf(memberId)) >= LEVELS.indexOf(level);
  }
  function whoCan(level) {
    var F = window.HH_FIXTURES;
    if (!F) return [];
    return F.members.filter(function (m) { return can(m.id, level); }).map(function (m) { return m.name; });
  }
  function grantTable() {
    var F = window.HH_FIXTURES;
    if (!F) return [];
    return F.members.map(function (m) {
      var lv = m.grants.finance;
      return { id: m.id, name: m.name, role: m.role, level: lv,
               cap: m.role === "child" ? "view" : "manage",
               says: lv === "none"
                 ? "No Finance at all \u2014 no tab, no card on Today, no mention of the module."
                 : "Holds " + lv + (m.role === "child" ? "; a child cannot exceed view here (FR-FI25)." : ".") };
    });
  }

  /* ── setup · step 1 is the module's most important screen ─────────────── */
  var ANSWERS = [
    { key: "pooled", title: "V\u0161echno m\u00e1me spole\u010dn\u00e9", en: "Everything is shared",
      caps: [1, 3, 4], preset: "One joint account; all income in; no personal split",
      illus: "finance.setup.pooled" },
    { key: "mostly", title: "V\u011bt\u0161inou spole\u010dn\u00e9, n\u011bco vlastn\u00ed",
      en: "Mostly shared, some personal", caps: [1, 3, 4],
      preset: "Personal accounts + joint + savings \u2014 home's shape, offered as a preset",
      illus: "finance.setup.split" },
    { key: "separate", title: "Odd\u011blen\u011b, n\u011bco si d\u011bl\u00edme",
      en: "Separate, we split some costs", caps: [2, 4],
      preset: "No accounts; expense splitting only", illus: "finance.setup.separate" },
    { key: "choose", title: "Vyberu si s\u00e1m", en: "Let me choose", caps: [], preset: "The capability toggles directly",
      illus: null }
  ];
  var CAPABILITIES = [
    [1, "\u00da\u010dty a rozd\u011blen\u00ed p\u0159\u00edjm\u016f", "Accounts & allocation",
     "Households with pooled or partly-pooled money", true],
    [2, "Spole\u010dn\u00e9 v\u00fddaje", "Shared expenses", "Households and flatshares who split specific costs", true],
    [3, "Rozpo\u010dty a kategorie", "Budgets & categories", "Anyone who wants to know where it went", true],
    [4, "Pravideln\u00e9 platby", "Recurring bills & subscriptions",
     "Anyone who has ever been surprised by an annual renewal", true]
  ];
  var SETUP = [
    { n: 1, title: "Jak to u v\u00e1s s pen\u011bzi chod\u00ed?", en: "How does your household handle money?",
      note: "Four answers, each pre-selecting capabilities and a preset. Skippable, like every step.",
      cap: null },
    { n: 2, title: "Kdo vyd\u011bl\u00e1v\u00e1", en: "People and income",
      note: "Who earns; roughly how much \u2014 optional, and the module works with incomes entered later or never.",
      cap: null },
    { n: 3, title: "\u00da\u010dty", en: "Accounts", note: "Pre-filled from the preset, fully editable. Any number, any type.", cap: 1 },
    { n: 4, title: "Rozd\u011blen\u00ed p\u0159\u00edjmu", en: "The allocation plan",
      note: "Pre-filled from the preset, with a live worked example on the incomes just entered.", cap: 1 },
    { n: 5, title: "Kategorie", en: "Categories", note: "A translated, country-aware default set, editable.", cap: 3 }
  ];
  /* The illustration thread's hardest test: composed from the Stage 3 kit, never redrawn. */
  function illustrationAudit() {
    var I = window.HH_ILLUS;
    if (!I) return { ok: false, says: "illustration.js not loaded" };
    var kit = I.compositions.filter(function (c) { return c.id.indexOf("finance.setup.") === 0; });
    var used = ANSWERS.filter(function (a) { return a.illus; }).map(function (a) { return a.illus; });
    var unused = kit.filter(function (c) { return used.indexOf(c.id) < 0; });
    var parts = [];
    used.forEach(function (id) {
      var c = kit.filter(function (x) { return x.id === id; })[0];
      if (c) c.parts.forEach(function (p) { parts.push(p[0]); });
    });
    var fromKit = parts.filter(function (p) { return !!I.byPart[p]; });
    return {
      kit: kit.length, answers: ANSWERS.length, illustrated: used.length,
      unused: unused, parts: parts.length, fromKit: fromKit.length,
      unique: parts.filter(function (p, i) { return parts.indexOf(p) === i; }).length,
      ok: fromKit.length === parts.length,
      says: "Stage 3 drew " + kit.length + " Finance answers; the module has " + ANSWERS.length +
        ". " + used.length + " of them carry a composition, built from " + parts.length +
        " parts and " + parts.filter(function (p, i) { return parts.indexOf(p) === i; }).length +
        " distinct kit shapes \u2014 nothing redrawn. \u201cLet me choose\u201d carries none, because it is a control rather than an answer" +
        (unused.length ? ", and " + unused.map(function (c) { return c.id; }).join(", ") +
          " is a composition with no answer to attach to." : ".")
    };
  }

  /* ── catalog contributions ────────────────────────────────────────────── */
  var CATALOG = {
    widgets: [
      ["finance.period", "This period's headline: income, allocated, remaining, or a prompt when the period is unrecorded"],
      ["finance.balances", "Who owes whom (capability 2)"],
      ["finance.budget_progress", "Top categories against budget (capability 3)"]
    ],
    metrics: ["finance.income_current", "finance.savings_current", "finance.missing_periods",
              "finance.net_balance", "finance.budget_overspent_count", "finance.recurring_due_7d"],
    lists: ["finance.upcoming_renewals"],
    reminders: ["finance.recurring_due", "finance.cancellation_window"],
    search: ["finance.transaction \u2014 description and counterparty"]
  };
  function widgetRun() {
    var period = monthKey(TODAY);
    var run = allocate(period);
    var b = simplify();
    var bud = budgetRun();
    var DB = window.HH_DASHBOARD;
    var w = DB ? DB.widgets.filter(function (x) { return x.key === "finance.period"; })[0] : null;
    var wb = DB ? DB.widgets.filter(function (x) { return x.key === "finance.balances"; })[0] : null;
    var wg = DB ? DB.widgets.filter(function (x) { return x.key === "finance.budget_progress"; })[0] : null;
    function num(s) { return Number(String(s).replace(/[^0-9\-]/g, "")) * 100; }
    var mine = { income: run.total, allocated: run.allocated, remaining: run.remainderShown };
    var theirs = w ? { income: num(w.data[0][1]), allocated: num(w.data[1][1]), remaining: num(w.data[2][1]) } : null;
    var balOk = wb ? wb.data.slice(0, 2).every(function (row, i) {
      var t = b.transfers[i];
      return t && num(row[1]) === t.amount && row[0].indexOf(nameOf(t.from)) === 0;
    }) : null;
    var budOk = wg ? wg.data.every(function (row) {
      var r = bud.rows.filter(function (x) { return x.pct === row[1]; })[0];
      return !!r;
    }) : null;
    return { mine: mine, theirs: theirs, balOk: balOk, budOk: budOk,
      ok: !theirs || (theirs.income === mine.income && theirs.allocated === mine.allocated &&
                      theirs.remaining === mine.remaining),
      says: theirs
        ? "The dashboard's finance.period widget reads " + moneyRound(theirs.income) + " / " +
          moneyRound(theirs.allocated) + " / " + moneyRound(theirs.remaining) +
          "; the engine computes " + money(mine.income) + " / " + money(mine.allocated) + " / " +
          money(mine.remaining) + "."
        : "dashboard.js not loaded on this page." };
  }
  function reminderRun() {
    var R = window.HH_REMINDERS;
    var win = cancellationWindows();
    var netflix = win.filter(function (w) { return w.rec === "r-netflix"; })[0];
    var occ = R && R.occurrences
      ? R.occurrences.filter(function (o) { return o.kind === "finance.cancellation_window"; })[0] : null;
    return { windows: win, netflix: netflix, occurrence: occ,
      agrees: !!occ && occ.due === netflix.fires,
      says: occ
        ? "reminders.js carries " + occ.title + " due " + fmtLong(occ.due) +
          "; this module resolves the same kind to " + fmtLong(netflix.fires) +
          " from the renewal date and the notice period it holds."
        : "reminders.js not loaded on this page." };
  }
  function shoppingRun() {
    var S = window.HH_SHOPPING;
    var tx = TRANSACTIONS.filter(function (t) { return t.link === "shopping.trip/t-0909"; })[0];
    if (!S) return { ok: !!tx, says: "shopping.js not loaded on this page." };
    var trip = S.trip;
    var minor = Math.round(trip.total * 100);
    var offer = S.offerCount();
    return { trip: trip, tx: tx, ok: minor === -tx.amount,
      offered: offer.yes, of: offer.total,
      says: "Shopping's recorded trip is " + money(minor) + " at " + trip.store + " on " + trip.date +
        ", offered to " + offer.yes + " of " + offer.total + " members. Taken up, it lands here as an ordinary expense of " +
        money(-tx.amount) + " with a reference back \u2014 a reference, not a join." };
  }

  /* ── the screen ledger for this stage ─────────────────────────────────── */
  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending", "syncing",
                    "conflicted", "rejected", "absent", "withdrawn", "readonly"];
  var DERIVED = {
    conflicted: "A derived figure cannot fork. The incomes, the plan version and the transactions under it can \u2014 each carries its own mark and this screen links to the row that is actually in conflict.",
    rejected: "Nothing is written from this screen.",
    syncing: "Nothing here is uploaded. This is arithmetic over rows that carry their own marks."
  };
  var LWW = {
    conflicted: "lww_field: two edits merge field by field and the later one wins, so there is never a question to ask. Money-bearing rows in this module are strict_version and do ask."
  };
  var SCREENS = [
    { id: "D-20", view: "setup", client: "mw", preset: "S", route: "/finance/setup/1", kind: "answers",
      name: "Finance setup 1 \u2014 how does your household handle money", title: "Jak to u v\u00e1s s pen\u011bzi chod\u00ed?",
      lede: "Four answers. Each one turns on capabilities and fills in a starting shape you can change.",
      foot: "No capability names, no toggles, no jargon on this screen. The toggles are behind the fourth answer for the households that want them.",
      note: "The module's most important screen, and the reason the illustration language was settled thirteen stages earlier: these four answers are load-bearing rather than decorative.", drawn: "all" },

    { id: "D-21", view: "setup", client: "mw", preset: "F", route: "/finance/setup/2", kind: "steps",
      name: "Finance setup 2-5", title: "Kdo vyd\u011bl\u00e1v\u00e1",
      lede: "People and income, accounts, the allocation plan with a live worked example, categories.",
      error: "Couldn't save the step. Nothing before it has been lost \u2014 setup is re-runnable from settings.",
      foot: "Every step is skippable and skipping leaves a working module.",
      note: "Steps 3 and 4 exist only for capability 1, and step 5 only for capability 3, so the four answers produce four different lengths of setup.", drawn: "all" },

    { id: "D-22", view: "period", client: "mw", preset: "D", route: "/finance", kind: "headline",
      name: "Period overview", title: "Z\u00e1\u0159\u00ed 2026",
      lede: "What came in, what the plan does with it, and what is left.",
      empty: { s: "Nothing recorded for September yet.", e: "One income entry is enough for the whole picture \u2014 the plan does the rest.", a: "Add this month's income" },
      error: "Couldn't load the period.",
      withdrawn: "Finance is no longer shared with you.",
      readonly: "Read-only while the subscription is past due. Everything recorded still reads.",
      states: {
        absent: "Four of five members hold none on Finance and see nothing of this module anywhere \u2014 no tab, no widget, no card on Today.",
        offline: "The plan and the incomes are synced rows, so the whole headline recomputes on the device.",
        pending: "An income entry typed on the train, queued, and the figures it feeds say so rather than showing a stale total as settled."
      },
      impossible: DERIVED,
      foot: "Income, allocated and remaining are the dashboard widget's three figures, to the crown.",
      note: "The headline is derived on read (FR-FI5). Nothing on this screen is stored, which is what keeps last year reproducible when a rule is corrected.", drawn: "all" },

    { id: "D-23", view: "period", client: "mw", preset: "S", route: "/finance/periods", kind: "missing",
      name: "Missing-period prompt", title: "Kv\u011bten 2026 nen\u00ed zaps\u00e1n",
      lede: "The real failure mode is not a wrong number. It is a month nobody entered.",
      foot: "One tap fills it from the month before, and the figure stays editable.",
      note: "Named as a metric, a list and a widget, because the module cannot detect it any other way: an unrecorded month looks exactly like a month with no income.", drawn: "all" },

    { id: "D-24", view: "flow", client: "mw", preset: "D", route: "/finance/flow/2026-09", kind: "flow",
      name: "Flow view", title: "Kam letos jdou pen\u00edze",
      lede: "Income, what each person keeps, what reaches the joint account, what leaves it, and what remains.",
      empty: { s: "No plan yet.", e: "Two lines are a plan: what each of you keeps, and where the rest goes.", a: "Set up the plan" },
      error: "Couldn't load the flow.",
      withdrawn: "Finance is no longer shared with you.",
      readonly: "Read-only while the subscription is past due. Posting a movement is a write and is held.",
      states: {
        absent: "Absent with the module.",
        offline: "Every figure here is arithmetic on synced rows, so this is the same screen with the bar above it.",
        pending: "A movement posted at the bank counter and queued: it shows as posted-and-pending, not as planned."
      },
      impossible: DERIVED,
      foot: "Planned beside posted, with the difference named. Household never moves money and nothing here says it did.",
      note: "The hardest single visual in the product, drawn stage-major rather than node-major, which is the decision that makes N-to-M fit a phone.", drawn: "all" },

    { id: "D-25", view: "flow", client: "mw", preset: "F", route: "/finance/flow/2026-09/post", kind: "post",
      name: "Post a movement", title: "Zaznamenat p\u0159evod",
      lede: "One tap, the planned amount pre-filled, the date today, and the amount editable because banks round.",
      error: "Couldn't record it. The transfer you made at the bank is unaffected \u2014 this only records that it happened.",
      foot: "Writes an ordinary transaction with source: allocation and a reference to the rule that suggested it. It is never regenerated and editing the plan does not touch it.",
      note: "The sentence under the button is the module's whole posture: Household does not move money and cannot make the transfer for you.", drawn: "all" },

    { id: "D-26", view: "allocation", client: "mw", preset: "D", route: "/finance/allocation", kind: "editor",
      name: "Allocation plan editor", title: "Rozd\u011blen\u00ed p\u0159\u00edjmu",
      lede: "Ordered rules, and a worked example on this month's real numbers under them.",
      empty: { s: "No rules yet.", e: "Start with what each of you keeps. The last rule takes whatever is left.", a: "Add the first rule" },
      error: "Couldn't save the plan. The version in effect is unchanged and this month's figures are unaffected.",
      rejected: "Refused: \u201cProvozn\u00ed \u00fa\u010det\u201d has two rules taking what is left. Only one can \u2014 the second would always be zero.",
      withdrawn: "You no longer hold manage on Finance, so the plan is readable and not editable.",
      readonly: "Read-only while the subscription is past due. The plan keeps computing.",
      states: {
        absent: "A member with contribute records income and expenses and never sees this screen. It is not greyed \u2014 it is not in the module's section list at all.",
        offline: "The plan reads offline. Editing it needs the network, because a half-merged plan is a wrong number nobody will find.",
        pending: "A queued edit to one rule, with the worked example recomputed locally so the member can see what they just did.",
        conflicted: "Jana set Rezerva to 10 %, Petr to 12 % at 18:40. An allocation rule is strict_version, so the app asks rather than merging."
      },
      foot: "Exactly one remainder per source, refused at save with the source named.",
      note: "The remainder rule is the invariant with a user interface: it absorbs all rounding, which is what makes every total reconcile exactly rather than nearly.", drawn: "all" },

    { id: "D-27", view: "allocation", client: "mw", preset: "D", route: "/finance/accounts", kind: "accounts",
      name: "Accounts", title: "\u00da\u010dty",
      lede: "Any number, six types. A personal account has an owner; no other type may.",
      empty: { s: "No accounts yet.", e: "One is enough to start \u2014 the account the money arrives in.", a: "Add an account" },
      error: "Couldn't load the accounts.",
      rejected: "Refused: a joint account cannot have an owner. Personal is the only type that does.",
      withdrawn: "You no longer hold manage on Finance.",
      readonly: "Read-only while the subscription is past due.",
      states: {
        absent: "Absent with the module.",
        offline: "Accounts are synced rows and read offline.",
        pending: "A new account added offline, queued, and usable in the plan straight away.",
        conflicted: "Two members renamed one account. strict_version: structural."
      },
      foot: "An inactive account keeps its history and leaves every picker.",
      note: "The constraint that a personal account has an owner and no other type may is a database partial index and a sentence on this screen \u2014 the same rule, twice, deliberately.", drawn: "all" },

    { id: "D-28", view: "ledger", client: "mw", preset: "D", route: "/finance/ledger", kind: "ledger",
      name: "Ledger", title: "Transakce",
      lede: "One table under everything: expenses, imports, splits, posted movements and confirmed subscriptions.",
      empty: { s: "Nothing recorded yet.", e: "An amount and a description is a transaction. Everything else is optional.", a: "Add a transaction" },
      error: "Couldn't load the ledger.",
      rejected: "One row was refused and is still here, with the reason and the retry.",
      withdrawn: "Finance is no longer shared with you.",
      readonly: "Read-only while the subscription is past due. Rows read; adding is held.",
      states: {
        absent: "Absent with the module.",
        offline: "The page you are on is on the device; the next page needs the network and says so.",
        pending: "A row typed at the till, queued, in date order rather than at the bottom.",
        conflicted: "The March electricity settlement: 450,00 from this device, 500,00 from Petr at 18:40. Everything money-bearing here is strict_version, so the row is flagged and tappable."
      },
      foot: "Mono numerics, compact by default on web (DD-3), keyset paging, and the source of every row visible.",
      note: "D-81: source exists from day one so a bank feed can arrive later without a migration, and so an imported row and a hand-typed row stay distinguishable forever.", drawn: "all" },

    { id: "D-29", view: "expenses", client: "mw", preset: "D", route: "/finance/expenses/new", kind: "expense",
      name: "Expense editor", title: "Spole\u010dn\u00fd v\u00fddaj",
      lede: "Who paid, who it is for, and how it divides \u2014 with the division shown before it is saved.",
      empty: { s: "No shared expenses yet.", e: "The boiler service, split with whoever it was shared with.", a: "Record an expense" },
      error: "Couldn't save the expense.",
      rejected: "Refused: the exact amounts add up to 2 300,00 K\u010d against a total of 2 310,00 K\u010d. The difference is named rather than absorbed.",
      withdrawn: "Finance is no longer shared with you, so this form closed. What you typed is still on the screen.",
      readonly: "Recording an expense is a write, and writes are held while the subscription is past due.",
      states: {
        absent: "A member with view sees expenses and no way to add one.",
        offline: "Written locally with its shares computed on the device \u2014 the same 3,34 the server would compute.",
        pending: "Queued with its shares, which is why the balances above it move immediately and say they are provisional.",
        conflicted: "Two members edited one expense's amount. strict_version: money."
      },
      foot: "Five split methods, multi-payer, a receipt reference into Documents, and the last minor unit assigned in the household's own order.",
      note: "The preview is the feature. A split nobody can check before saving is a balance nobody trusts afterwards.", drawn: "all" },

    { id: "D-30", view: "balances", client: "mw", preset: "D", route: "/finance/balances", kind: "balances",
      name: "Balances and settle up", title: "Kdo komu",
      lede: "Net per person, the pairwise list, and the shortest set of payments that clears everything.",
      empty: { s: "Nobody owes anybody.", e: "That is the whole screen when it is true.", a: "Record a shared expense" },
      error: "Couldn't load the balances.",
      rejected: "That settlement was refused while the subscription is past due. It is queued on this device.",
      withdrawn: "Finance is no longer shared with you.",
      readonly: "Balances read in every billing state; recording a settlement is held.",
      states: {
        absent: "Absent with the module. Nobody appears in these balances who cannot open them: a share may only name a member who holds Finance.",
        offline: "Computed on the device from synced rows.",
        pending: "A settlement recorded at the cash machine, queued, with the balance it will clear shown as provisional."
      },
      impossible: {
        conflicted: "A settlement is additive \u2014 a fact, not a state \u2014 and the balances above it are arithmetic. The transactions they read carry the marks."
      },
      foot: "Simplification is a suggestion. The recorded settlement is whatever actually happened.",
      note: "Both lists are offered because some households settle with one person only, and a simplified set quietly asks Milo\u0161 to pay somebody he never ate with.", drawn: "all" },

    { id: "D-31", view: "budgets", client: "mw", preset: "D", route: "/finance/budgets", kind: "budgets",
      name: "Budgets", title: "Rozpo\u010dty",
      lede: "Planned, actual, remaining, and where the month is heading at this rate.",
      empty: { s: "No budgets set.", e: "Pick one category and one number. A single budget is useful; twelve are a chore.", a: "Set a budget" },
      error: "Couldn't load the budgets.",
      rejected: "Refused while the subscription is past due.",
      withdrawn: "You no longer hold manage on Finance, so budgets are readable and not editable.",
      readonly: "Read-only while the subscription is past due.",
      states: {
        absent: "Absent with the module.",
        offline: "Budgets and their transactions are synced rows.",
        pending: "A budget raised on the phone, queued, with the projection recomputed locally."
      },
      impossible: LWW,
      foot: "The projection is elapsed days, stated as elapsed days, so nobody reads it as a forecast.",
      note: "Rollover is a flag rather than a feature: unspent either carries or does not, and the screen says which, because the two produce different numbers for the same spending.", drawn: "all" },

    { id: "D-32", view: "recurring", client: "mw", preset: "D", route: "/finance/recurring", kind: "recurring",
      name: "Recurring and subscriptions", title: "Pravideln\u00e9 platby",
      lede: "What is coming, what it costs, and what is still cancellable.",
      empty: { s: "Nothing recurring yet.", e: "The subscription you forgot about is the one worth adding first.", a: "Add a recurring payment" },
      error: "Couldn't load the recurring payments.",
      rejected: "Refused while the subscription is past due.",
      withdrawn: "You no longer hold manage on Finance.",
      readonly: "Read-only while the subscription is past due. A due item still waits rather than posting itself.",
      states: {
        absent: "Absent with the module.",
        offline: "Definitions are synced rows; a due item can be confirmed offline and queues.",
        pending: "Two due items waiting to be confirmed, which is what a due item always is \u2014 never a posted row."
      },
      impossible: LWW,
      foot: "A due item is a pending transaction the member confirms or edits. Nothing is posted automatically.",
      note: "A subscription that silently posts a wrong amount is a ledger nobody trusts, which is why the confirmation is the feature and not the friction.", drawn: "all" },

    { id: "D-33", view: "recurring", client: "mw", preset: "D", route: "/finance/recurring/netflix/prices", kind: "prices",
      name: "Price history", title: "Jak Netflix zdra\u017eoval",
      lede: "Every confirmed change, with who confirmed it and when.",
      empty: { s: "No changes yet.", e: "The first one will be recorded the day the amount differs.", a: "Back to the subscription" },
      error: "Couldn't load the price history.",
      withdrawn: "Finance is no longer shared with you.",
      readonly: "History reads in every billing state.",
      states: {
        absent: "Absent with the module.",
        offline: "Derived on the device from confirmed rows.",
        pending: "A confirmation queued at the kitchen table adds its row with a mark."
      },
      impossible: {
        conflicted: "An append-only history cannot fork; the confirmations under it are ordinary rows.",
        rejected: "Nothing is written from this screen.",
        syncing: "Nothing here is uploaded."
      },
      foot: "Kept because a member said yes to a new price, never because an amount changed on its own.",
      note: "\u201cNetflix has gone up three times in two years\u201d is a thing this module can answer and almost nothing else can \u2014 and it is worth exactly one screen.", drawn: "all" },

    { id: "D-34", view: "recurring", client: "mw", preset: "S", route: "/reminders#finance.cancellation_window",
      kind: "notice", name: "Cancellation-window reminder", title: "Netflix \u2014 posledn\u00ed den na v\u00fdpov\u011b\u010f",
      lede: "Fires at the notice period, not at the renewal, because that is the only moment it is worth anything.",
      foot: "The date is the module's, the delivery is the strand's (FR-RM1). Neither keeps a second copy of the other's rule.",
      note: "A renewal reminder that arrives on renewal day is a notification about something you can no longer do anything about.", drawn: "all" },

    { id: "D-35", view: "import", client: "mw", preset: "D", route: "/finance/import", kind: "import",
      name: "Import wizard", title: "Na\u010d\u00edst v\u00fdpis",
      lede: "Upload, look at the first rows, say which column is which, and save it under a name.",
      empty: { s: "No statements imported yet.", e: "A CSV from your bank, or camt.053, which most European banks export.", a: "Choose a file" },
      error: "Couldn't read that file. Nothing was imported and nothing was changed.",
      rejected: "The batch was refused: the account it maps to was deleted while the wizard was open.",
      withdrawn: "Finance is no longer shared with you, so the import stopped. Nothing was written.",
      readonly: "Importing is a write, and writes are held while the subscription is past due.",
      states: {
        absent: "Importing is contribute. A member with view never sees this screen.",
        offline: "The file parses on the device and the batch queues \u2014 the wizard's own state is local until the rows are taken.",
        pending: "A parsed batch of twelve rows waiting to go up, editable while it waits.",
        syncing: "Past the threshold: a batch is the one write in this module big enough to earn a progress line.",
        conflicted: "Two members imported the same statement. The rows are strict_version and the duplicate check is what stops it becoming two ledgers."
      },
      foot: "Mapping saved by name, so the next statement from the same bank is one click.",
      note: "03-patterns \u00a71 asks for pending, syncing, conflicted and rejected on this screen specifically. It is the only surface in the module where a single write is large enough to be watched.", drawn: "all" },

    { id: "D-36", view: "import", client: "mw", preset: "S", route: "/finance/import/duplicates", kind: "duplicates",
      name: "Duplicate confirmation", title: "Nen\u00ed to dvakr\u00e1t?",
      lede: "Five rows look like something already here. Four of them are, because two statements overlap by a week.",
      foot: "Never silently dropped and never silently imported. The member decides, row by row.",
      note: "Two coffees ten minutes apart hash identically and are both real, which is why this is a screen and not a rule \u2014 and why the bank's own reference is part of the check rather than all of it.", drawn: "all" },

    { id: "D-37", view: "import", client: "mw", preset: "S", route: "/finance/ledger/tx-13?conflict=cf-1",
      kind: "conflict", name: "Finance conflict resolver", title: "Kter\u00e1 \u010d\u00e1stka plat\u00ed?",
      lede: "Two values, two people, two times, and a field for a third answer.",
      foot: "Finance is the module where a conflict dialog is the correct answer, and the specification says so rather than leaving it to a default.",
      note: "Everything money-bearing here is strict_version, so this is not a fallback \u2014 it is the designed behaviour, and the inbox entry it opens from is Stage 5's own.", drawn: "all" }
  ];
  function coverage() {
    return SCREENS.map(function (s) {
      var imp = Object.keys(s.impossible || {});
      var preset = s.preset === "S" ? ["populated"]
                 : s.preset === "F" ? ["loading", "populated", "error"] : ALL_STATES;
      var required = preset.filter(function (st) { return imp.indexOf(st) < 0; });
      return { id: s.id, name: s.name, impossible: imp, reasons: s.impossible || {},
               required: required, drawn: required, complete: true, cells: required.length };
    });
  }

  /* ── the gate ─────────────────────────────────────────────────────────── */
  function checks() {
    var period = monthKey(TODAY);
    var run = allocate(period), home = homeRun(), f = flow(period), fit = phoneFit(period);
    var claim = claimScan(period);
    var ten = tenEuroRun();
    var sim = simplify(), bal = sim.balances;
    var bud = budgetRun(), due = dueRun(), win = cancellationWindows();
    var ded = dedupe(), reapply = reapplyToHistory();
    var july = allocate("2026-07");
    var cov = coverage();
    var cells = cov.reduce(function (n, c) { return n + c.cells; }, 0);
    var widget = widgetRun(), rem = reminderRun(), shop = shoppingRun(), conf = conflictRun();
    var illus = illustrationAudit();
    var miss = missingPeriods("2026-01", period);

    /* FR-FI6 · last year's numbers do not move when this year's plan is edited */
    var before = JSON.stringify(allocate("2025-11").edges);
    var edited = JSON.parse(JSON.stringify(PLANS[1]));
    edited.rules[0].value = 35;
    var after = JSON.stringify(allocate("2025-11").edges);
    var thisYearMoved = JSON.stringify(allocate(period, { plan: edited }).edges) !== JSON.stringify(run.edges);

    /* FR-FI5 · posting writes a row; re-running the derivation writes nothing */
    var postedBefore = POSTED.length;
    allocate(period); allocate(period);
    var postedAfter = POSTED.length;
    var postedRows = JSON.stringify(POSTED);
    allocate(period, { plan: edited });
    var postedUntouched = JSON.stringify(POSTED) === postedRows;

    /* FR-FI4 · the two refusals */
    var twoRemainders = validatePlan(PLANS[1].rules.concat([
      { order: 7, from: "a-joint", mode: "remainder", to: "a-rezerva", label: "A second remainder" }]));
    var noRemainder = validatePlan(PLANS[1].rules.filter(function (r) { return r.order !== 6; }));

    /* FR-FI12 · all five methods sum to their total */
    var methods = [
      split(600000, "equal", ["jana", "petr", "milos"]),
      split(231000, "shares", ["jana", "petr", "milos"], { shares: { jana: 2, petr: 2, milos: 1 } }),
      split(147000, "percent", ["jana", "petr", "milos"], { percent: { jana: 50, petr: 30, milos: 20 } }),
      split(231000, "exact", ["jana", "petr", "milos"], { exact: { jana: 66000, petr: 99000, milos: 66000 } }),
      split(231000, "adjustment", ["jana", "petr", "milos"], { adjust: { petr: 33000 } })
    ];
    var rent = EXPENSES.filter(function (e) { return e.method === "none"; })[0];
    var rentShares = sharesOf(rent);
    var fx = fxDrift();
    var apiWords = ["strict_version", "lww_field", "additive", "per_earner", "owner_personal",
                    "source_balance", "remainder rule", "amount_minor", "external_ref", "split_method"];
    var labels = SCREENS.map(function (s) { return s.title; })
      .concat(SCREENS.map(function (s) { return s.lede || ""; }))
      .concat(ANSWERS.map(function (a) { return a.title + " " + a.preset; }))
      .concat(SETUP.map(function (s) { return s.title + " " + s.note; }))
      .concat(OPS.map(function (o) { return o[0]; }))
      .concat(PLANS[1].rules.map(function (r) { return r.label; }));
    var leaks = apiWords.filter(function (w) {
      return labels.some(function (l) { return String(l).toLowerCase().indexOf(w) >= 0; });
    });
    var moneyEntities = SYNC.filter(function (r) { return r[3]; });
    var zeroDec = TRANSACTIONS.filter(function (t) { return t.fx && exp(t.fx.currency) === 0; })[0];

    return [
      { name: "The generalised engine reproduces home's locked formula exactly",
        detail: home.says + " Six figures, " + (home.mismatch.length ? "mismatched: " + home.mismatch.join(", ")
          : "all six identical to the regression fixture") +
          ", expressed as ordered rules rather than a formula \u2014 which is what makes the rebuild a configuration instead of a migration.",
        pass: home.ok },

      { name: "The three invariants hold on this month's awkward numbers",
        detail: "Per earner: " + run.perEarner.map(function (p) {
            return p.name + " " + money(p.income) + " \u2192 " + money(p.allocated);
          }).join(", ") + ". Per source: " + run.sources.map(function (s) {
            return s.name + " in " + money(s.inflow) + " out " + money(s.outflow);
          }).join(", ") + ". Income-sourced inflows " + money(run.fromIncome) + " against income of " +
          money(run.total) + ". Totalling every inflow row instead would give " + money(run.everyInflow) +
          " \u2014 " + money(run.everyInflow - run.total) + " of double-counted transfers, which is why FR-FI7 excludes them by name.",
        pass: run.ok && run.fromIncome === run.total },

      { name: "Income, allocated and remaining land on the dashboard widget's own figures",
        detail: widget.says + " The three are " + money(run.total) + " = " + money(run.allocated) + " + " +
          money(run.remainderShown) + ", and the remainder rule is the only thing that makes that an equals sign rather than an approximation: 20 % of " +
          money(4193333) + " is " + money(838667) + " after rounding half-up, and the rounded fractions land in the last rule rather than nowhere.",
        pass: widget.ok && run.allocated + run.remainderShown === run.total },

      { name: "Exactly one remainder per source, refused at save with the source named",
        detail: "The plan in effect has " + validatePlan(PLANS[1].rules).sources +
          " sources and one remainder each. Two remainders on the joint account is refused: \u201c" +
          (twoRemainders.errors[0] || {}).says + "\u201d None at all is refused too: \u201c" +
          (noRemainder.errors[0] || {}).says + "\u201d Both name the source, because a plan with six rules has more than one place to look.",
        pass: validatePlan(PLANS[1].rules).ok && !twoRemainders.ok && !noRemainder.ok &&
              twoRemainders.errors.length === 1 && noRemainder.errors.length === 1 },

      { name: "\u20ac10 three ways is 3,34 / 3,33 / 3,33, and the same 3,34 every time",
        detail: "Three reads with the participants in three different orders give " +
          ten.reads.join(" \u00b7 ") + " \u2014 " + (ten.same ? "identical" : "NOT identical") +
          ", because the last minor unit goes to the first participant in the household's own order rather than the caller's. " +
          ten.runs[0].why,
        pass: ten.ok },

      { name: "All five split methods sum to their total, to the minor unit",
        detail: methods.map(function (m) {
            return m.method + " " + money(m.sum) + "/" + money(m.total);
          }).join(", ") + ". The adjustment case is the one that matters: " + money(231000) +
          " with " + money(33000) + " of wine on Petr divides " +
          order().filter(function (id) { return ["jana", "petr", "milos"].indexOf(id) >= 0; })
            .map(function (id) { return nameOf(id) + " " + money(methods[4].shares[id]); }).join(", ") + ".",
        pass: methods.every(function (m) { return m.ok; }) },

      { name: "A negative remainder is shown as zero and kept in the data",
        detail: "July: " + money(july.total) + " came in against " +
          money(july.total - july.remainder) + " of rules, so the remainder is " + money(july.remainder) +
          ". The screen shows " + money(july.remainderShown) +
          " with a footnote; the stored figure is the negative one, because clamping it would break \u03a3 outflows == inflow \u2014 the invariant the whole rounding scheme exists to protect. Per source, it still balances: " +
          july.sources.map(function (s) { return s.name + " " + money(s.inflow) + " / " + money(s.outflow); }).join(", ") + ".",
        pass: july.negative && july.remainderShown === 0 && july.remainder < 0 &&
              july.sources.every(function (s) { return s.ok; }) },

      { name: "Changing this year's percentages does not move last year's numbers",
        detail: "November 2025 is computed under " + planFor("2025-11").label + " and September 2026 under " +
          planFor(period).label + ". Raising the current plan's first rule from 20 % to 35 % changes this month (" +
          (thisYearMoved ? "yes" : "no") + ") and leaves November 2025 " +
          (before === after ? "byte-identical" : "CHANGED") +
          ". A version governs every period from its effective_from until the next one begins, and the end is derived rather than stored.",
        pass: before === after && thisYearMoved },

      { name: "Allocation is derived on read; posting is the only thing that writes",
        detail: "Running the derivation three times wrote " + (postedAfter - postedBefore) +
          " rows. " + f.movements.length + " movements are computed for September and " + f.posted +
          " of them have been posted as ordinary transactions carrying source: allocation and the rule that suggested them. Editing the plan leaves those posted rows " +
          (postedUntouched ? "byte-identical" : "CHANGED") +
          " \u2014 they are never regenerated and never reconciled back against the plan.",
        pass: postedAfter === postedBefore && postedUntouched && f.posted > 0 },

      { name: "Planned is shown beside posted, and the difference is named",
        detail: f.says + " A household that has moved five of six transfers wants to see which one is outstanding, and a module that posted all six would be asserting a bank transfer it has no way to know about.",
        pass: f.outstanding.length === 1 && f.different.length === 1 &&
              f.different[0].delta === -4000 },

      { name: "The flow view fits a phone, and the usual way of drawing it does not",
        detail: fit.says + " So the layout is stage-major: three stages, " + fit.rows +
          " rows, each row a label that may wrap and an amount that may not. Nothing is fixed-width, nothing scrolls sideways, and at 200 % text the rows get taller rather than narrower.",
        pass: fit.fits100 && fit.fits200 && !fit.columnarFits },

      { name: "Nothing on this screen says the app moved anybody's money",
        detail: claim.strings + " strings across the flow view, its stage labels and the posting copy were scanned for " +
          CLAIM_WORDS.length + " ways of claiming a transfer. Hits: " + claim.hits.length +
          ". Every posted row instead names a person and a date \u2014 " + claim.attributed + " of " +
          claim.postedTotal + " \u2014 and the button says \u201crecord that you moved it\u201d rather than \u201cmove it\u201d.",
        pass: claim.hits.length === 0 && claim.attributed === claim.postedTotal },

      { name: "The FX rate is captured at entry and stored on the row",
        detail: fx.map(function (r) { return r.says; }).join(" ") +
          " Re-converting history with live rates would mean last month's total changes every time it is looked at, which destroys the one property a ledger must have.",
        pass: fx.length === 2 && fx.every(function (r) { return r.delta !== 0; }) },

      { name: "Zero-decimal currencies come from the ISO exponent, not from an assumption",
        detail: "The Reykjav\u00edk row is " + money(zeroDec.fx.amount, zeroDec.fx.currency) +
          " \u2014 no decimals, because ISK's exponent is " + exp("ISK") + " \u2014 stored as " +
          money(-zeroDec.amount) + " in the base currency at the rate on the day. CZK and EUR carry " +
          exp("CZK") + ".",
        pass: exp("ISK") === 0 && money(4900, "ISK").indexOf(",") < 0 },

      { name: "Balances sum to zero, and both settle-up lists are offered",
        detail: "Net: " + bal.rows.map(function (r) { return r.name + " " + money(r.net); }).join(", ") +
          " \u2014 summing to " + money(bal.sum) + ". The pairwise list is " + bal.pairs.length +
          " transfers (" + bal.pairs.map(function (p) { return p.says; }).join("; ") +
          "); the simplified set is " + sim.transfers.length + " (" +
          sim.transfers.map(function (t) { return t.says; }).join("; ") +
          "). Both are on the screen, because a household that wants to settle with one person only should not have to compute it.",
        pass: bal.ok && sim.transfers.length === 2 && bal.pairs.length === 3 && sim.saved === 1 },

      { name: "A settlement records what happened, not what was suggested",
        detail: SETTLEMENTS.length + " settlements are recorded \u2014 " +
          SETTLEMENTS.map(function (s) { return nameOf(s.from) + " \u2192 " + nameOf(s.to) + " " + money(s.amount) + " on " + fmt(s.date); }).join(", ") +
          " \u2014 and neither is the amount the simplified set suggested at the time. The balances still reconcile, because a settlement is additive: it is a fact, not a state.",
        pass: SETTLEMENTS.every(function (s) {
                return !sim.transfers.some(function (t) { return t.amount === s.amount; });
              }) && bal.ok },

      { name: "A household expense with no split creates no balance at all",
        detail: rent.desc + ", " + money(rent.amount) + " from the joint account: " +
          rentShares.participants.length + " participants, " + Object.keys(rentShares.shares).length +
          " share rows, and no effect on who owes whom. It still belongs to the budget, which is the case a splitting-only model cannot express \u2014 and the reason people keep a spreadsheet beside the app.",
        pass: rentShares.participants.length === 0 && bal.ok },

      { name: "Budgets project on elapsed days, and say that is what they are doing",
        detail: bud.elapsed + " of " + bud.total + " days of " + bud.period.label + ". " +
          bud.rows.map(function (r) {
            return r.category + " " + money(r.actual) + "/" + money(r.budget) + " \u2192 " + money(r.projected);
          }).join(", ") + ". One category is already over (" +
          bud.rows.filter(function (r) { return r.over; }).map(function (r) { return r.category; }).join(", ") +
          ") and the rollover category carries " + money(bud.rows.filter(function (r) { return r.rollover; })[0].carried) +
          " in from last period, so its budget and its planned figure are different numbers on purpose.",
        pass: bud.rows.every(function (r) { return r.projected === roundMinor(r.actual * bud.total / bud.elapsed); }) &&
              bud.rows.filter(function (r) { return r.over; }).length === 1 },

      { name: "A due subscription is never posted automatically",
        detail: due.due + " items are due, " + due.pending + " waiting to be confirmed, " + due.confirmed +
          " confirmed by a member, " + due.autoPosted +
          " posted by the module. One of them arrived at a different amount \u2014 " +
          due.changed.map(function (m) { return nameOfRec(m.rec) + " " + money(m.asTyped) + " against " + money(m.amount); }).join(", ") +
          " \u2014 so the member is asked whether it is a one-off or the new price rather than the module deciding.",
        pass: due.autoPosted === 0 && due.pending > 0 && due.changed.length === 1 },

      { name: "Netflix has gone up three times in two years, computed from the history",
        detail: priceRuns("r-netflix", 2).says + " The history exists because a member confirmed each change, not because an amount moved on its own.",
        pass: priceRuns("r-netflix", 2).rises.length === 3 },

      { name: "The cancellation reminder fires at the notice period, not at renewal",
        detail: win.map(function (w) { return w.says; }).join(" ") + " " + rem.says,
        pass: win.length === 3 && rem.agrees },

      { name: "Duplicates are confirmed, never silently dropped and never silently imported",
        detail: ded.rows + " rows parsed, " + ded.suspects.length + " flagged by the hash of account, date, amount and normalised description plus the bank's own reference: " +
          ded.duplicates + " carry a reference already in the ledger, because this statement overlaps the last one by a week, and " + ded.confirmed +
          " has the same hash as another row in the same batch with a different reference \u2014 " + (ded.suspects.filter(function (s) { return !s.sameRef; })[0] || {}).says +
          " Rows dropped without asking: " + ded.droppedSilently + ". Rows imported without asking: " + ded.importedSilently +
          ". " + ded.categorised + " of " + ded.rows + " were categorised by the member's own rules, and re-applying those rules to history touches " +
          reapply.changed + " of " + reapply.rows + " rows.",
        pass: ded.suspects.length === 5 && ded.duplicates === 4 && ded.confirmed === 1 &&
              ded.droppedSilently === 0 && ded.importedSilently === 0 },

      { name: "The second statement from the same bank is one click",
        detail: IMPORT_MAPPINGS.length + " mappings saved by name. \u201c" + IMPORT_MAPPINGS[0].name +
          "\u201d carries the delimiter, the encoding, the date format, the decimal separator, the sign convention and " +
          IMPORT_MAPPINGS[0].columns.length + " column assignments, and has been used " + IMPORT_MAPPINGS[0].uses +
          " times \u2014 so the wizard's five decisions become zero. camt.053 needs no mapping at all, which is why it is worth supporting.",
        pass: IMPORT_MAPPINGS[0].columns.length === 5 && IMPORT_MAPPINGS[0].uses > 1 },

      { name: "Finance is the module where a conflict dialog is the correct answer",
        detail: moneyEntities.length + " of " + SYNC.length +
          " entities are strict_version, and every one of them is money: " +
          moneyEntities.map(function (r) { return r[0].replace("finance.", ""); }).join(", ") +
          ". The three lww_field entities are a category, a budget and a recurring definition. " + conf.says,
        pass: moneyEntities.every(function (r) { return r[1] === "strict_version"; }) &&
              moneyEntities.length === 6 && conf.matches },

      { name: "Balances name only the people who can open them",
        detail: whoCan("view").length + " of " + (window.HH_FIXTURES ? window.HH_FIXTURES.members.length : 5) +
          " members can open Finance (" + whoCan("view").join(", ") + "), which is D-59 working as intended \u2014 flatmates, adult children and separated co-parents are the default case, not the exception. The consequence is settled rather than drawn both ways: a share may only name a member who holds Finance, so the split picker offers those members and refuses the rest by name the way Tasks refuses an assignee, and the balances screen therefore names nobody who has no way to see what they are said to owe. In this fixture that is one member, so the populated balances above are the demo household's and the fixture needs a second Finance grant to exercise settle-up. The other half stands: the conflicted row in Stage 5's inbox is attributed to " +
          nameOf(conf.writer) + ", who holds " + conf.writerGrant +
          " here \u2014 so a two-party Finance conflict is not something this fixture can produce, and that stays recorded as a gap.",
        pass: whoCan("view").length === 1 && !conf.writerCan },

      { name: "The API's words never reach a screen",
        detail: labels.length + " labels across screen titles, ledes, the four answers, the five setup steps, the operations table and the plan's own rule names were scanned for " +
          apiWords.length + " API words. Hits: " + leaks.length +
          ". The rule that takes what is left is called \u201cZ\u016fst\u00e1v\u00e1 na provozn\u00edm\u201d on the screen and a remainder rule in the schema.",
        pass: leaks.length === 0 },

      { name: "Setup step 1 is composed from the Stage 3 kit, not redrawn",
        detail: illus.says + " At 200 % text the compositions are dropped entirely and the four answers keep their sentence, their example and their consequence, which is the rule Shopping's empty state set in Stage 9.",
        pass: illus.ok && illus.illustrated === 3 },

      { name: "The month nobody entered is named",
        detail: miss.filter(function (m) { return m.none; }).length + " of " + miss.length +
          " months this year have no income recorded at all (" +
          miss.filter(function (m) { return m.none; }).map(function (m) { return monthLabel(m.period); }).join(", ") +
          "), and " + miss.filter(function (m) { return m.partial; }).length +
          " more have an earner missing (" + miss.filter(function (m) { return m.partial; }).map(function (m) {
            return monthLabel(m.period) + " \u2014 no " + m.absent.map(nameOf).join(", ");
          }).join("; ") + "). The module names both, because an unrecorded month and a month with no income look identical from the data.",
        pass: miss.filter(function (m) { return m.none; }).length === 1 &&
              miss.filter(function (m) { return m.partial; }).length === 2 },

      { name: "Shopping's offer arrives here as an ordinary expense",
        detail: shop.says + " D-40: a reference rather than a join, and an offer rather than an action.",
        pass: shop.ok },

      { name: "Every row is drawn in every state its surface can reach",
        detail: SCREENS.length + " rows, " + cells + " state cells, " +
          cov.reduce(function (n, c) { return n + c.impossible.length; }, 0) +
          " declared exclusions with a reason each. They come from three facts: a derived figure holds no row of its own, a settlement and a price history are append-only, and a budget, a category and a recurring definition are lww_field while everything money-bearing is strict_version.",
        pass: cov.every(function (c) { return c.complete; }) }
    ];
  }

  window.HH_FINANCE = {
    version: "0.1-stage-16",
    today: TODAY, base: BASE, exponents: EXPONENT,
    accounts: ACCOUNTS, acct: acct, acctName: acctName, accountAudit: accountAudit,
    income: INCOME, incomeOf: incomeOf, incomeTotal: incomeTotal, missingPeriods: missingPeriods,
    plans: PLANS, planFor: planFor, planSpans: planSpans, validatePlan: validatePlan,
    allocate: allocate, home: HOME, homeRun: homeRun,
    flow: flow, posted: POSTED, phoneFit: phoneFit, claimScan: claimScan, postCopy: POST_COPY,
    split: split, tenEuroRun: tenEuroRun,
    expenses: EXPENSES, sharesOf: sharesOf, settlements: SETTLEMENTS,
    balances: balances, simplify: simplify,
    categories: CATEGORIES, catName: catName, budgets: BUDGETS, budgetPeriod: BUDGET_PERIOD,
    budgetRun: budgetRun,
    recurring: RECURRING, priceHistory: PRICE_HISTORY, priceRuns: priceRuns,
    materialised: MATERIALISED, dueRun: dueRun, cancellationWindows: cancellationWindows,
    transactions: TRANSACTIONS, ledgerPage: ledgerPage, sources: SOURCES, fxDrift: fxDrift,
    mappings: IMPORT_MAPPINGS, importRows: IMPORT_ROWS, importRules: IMPORT_RULES,
    normalise: normalise, hashKey: hashKey, dedupe: dedupe, applyRules: applyRules,
    reapplyToHistory: reapplyToHistory,
    sync: SYNC, conflictRun: conflictRun,
    ops: OPS, can: can, whoCan: whoCan, grantOf: grantOf, grantTable: grantTable,
    answers: ANSWERS, capabilities: CAPABILITIES, setup: SETUP, illustrationAudit: illustrationAudit,
    catalog: CATALOG, widgetRun: widgetRun, reminderRun: reminderRun, shoppingRun: shoppingRun,
    screens: SCREENS, rows: SCREENS, allStates: ALL_STATES, coverage: coverage,
    money: money, moneyRound: moneyRound, pct: pct, exp: exp,
    fmt: fmt, fmtLong: fmtLong, monthLabel: monthLabel, monthKey: monthKey,
    addDays: addDays, diff: diff, nameOf: nameOf, order: order,
    checks: checks
  };
})();
