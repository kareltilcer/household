/* Stage 19 — the shared asset engine, and its three vocabularies: Property, Vehicles, Pets.

   Sources: docs/prd/modules/12-property.md (the engine, D-67 to D-69, FR-AS1-2, FR-PP1-7),
   13-vehicles.md (D-70, D-71, FR-VE1-9), 14-pets.md (D-72, D-73, FR-PE1-10),
   design/05-screens.md §E "Property · Vehicles · Pets", 02-components §0 (the twelve states),
   03-patterns §1 (merge policies) and §5, 10-utilities.md (the integer and the monotonicity
   rejection this engine reuses verbatim), 07-delivery §3 (the empty state teaches).

   Five things this file computes rather than claims.

   1. The dual trigger. FR-AS1 says interval, usage, or both whichever comes first. due()
      resolves all three shapes over the same reading series: a definite date from the
      interval, an estimated date from the observed daily rate, and the earlier of the two
      as the answer — with the estimate labelled an estimate everywhere it is drawn. A
      usage-based schedule with no readings resolves to no_reading rather than to never.

   2. The integer. Every usage value is value_milli, thousandths of the named unit, because
      a monotonicity check is being run on these numbers and because "15 000 km since the
      last service" has to be reproducible to the unit by two people on two devices. The
      same suffix, the same convention and the same rejection path as Utilities' meters.

   3. The grant is resolved from entity_type, not from the path prefix. resolve() is the one
      place it happens, and grantRun() walks five members × three entity types × the engine's
      five routes so that D-16's 404-not-403 is counted rather than promised.

   4. Partial fills. FR-VE6 / D-71: consumption is computed between consecutive *full* fills
      with the partials in between accumulated. fuelRun() computes it that way and also
      computes the naive answer, so the difference is a number on the screen rather than a
      warning in a comment.

   5. Pets must not read like asset management. toneAudit() runs the twenty-two asset words
      over every string this file gives the Pets vocabulary, and the deceased flow over the
      words a disposal screen would have used. Both come back at zero, or the gate fails.
*/
(function () {

  var TODAY = "2026-09-09";
  var LEVELS = ["none", "view", "contribute", "manage"];

  function D(s) { return new Date(s + "T00:00:00Z"); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function addDays(s, n) { var d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function addMonths(s, n) {
    var d = D(s), day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
    var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return iso(d);
  }
  function diff(a, b) { return Math.round((D(b) - D(a)) / 86400000); }
  var MONTHS_CS = ["ledna", "\u00fanora", "b\u0159ezna", "dubna", "kv\u011btna", "\u010dervna",
                   "\u010dervence", "srpna", "z\u00e1\u0159\u00ed", "\u0159\u00edjna", "listopadu", "prosince"];
  var MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July",
                   "August", "September", "October", "November", "December"];
  function fmt(s) { var d = D(s); return d.getUTCDate() + ". " + (d.getUTCMonth() + 1) + ". " + d.getUTCFullYear(); }
  function fmtCs(s) { var d = D(s); return d.getUTCDate() + ". " + MONTHS_CS[d.getUTCMonth()] + " " + d.getUTCFullYear(); }
  function fmtEn(s) { var d = D(s); return d.getUTCDate() + " " + MONTHS_EN[d.getUTCMonth()] + " " + d.getUTCFullYear(); }
  function num(n, dec) {
    var s = (Math.abs(n)).toFixed(dec || 0);
    var p = s.split("."), whole = p[0], out = "";
    for (var i = 0; i < whole.length; i++) {
      out += whole[i];
      var left = whole.length - 1 - i;
      if (left > 0 && left % 3 === 0) out += "\u202f";
    }
    return (n < 0 ? "\u2212" : "") + out + (p[1] ? "," + p[1] : "");
  }
  function czk(n) { return num(Math.round(n)) + " K\u010d"; }

  function member(id) {
    var F = window.HH_FIXTURES;
    return (F ? F.members : []).filter(function (m) { return m.id === id; })[0] || null;
  }
  function name(id) { var m = member(id); return m ? m.name : id; }
  function grantOf(id, mod) { var m = member(id); return m ? (m.grants[mod] || "none") : "none"; }
  function atLeast(level, want) { return LEVELS.indexOf(level) >= LEVELS.indexOf(want); }

  /* ── 1. One engine, three vocabularies ───────────────────────────────────
     D-67: not one "Possessions" module. Every word a member reads is this table's,
     and the three columns are deliberately not synonyms of one another. */

  var VOCAB = {
    property: {
      module: "property", entityType: "property_item", accent: "--accent-family-things",
      cs: "D\u016fm a vybaven\u00ed", en: "Property", route: "/property",
      thing: "za\u0159\u00edzen\u00ed", things: "Za\u0159\u00edzen\u00ed a instalace",
      list: "Co je v dom\u011b", detail: "Za\u0159\u00edzen\u00ed",
      schedule: "Servisn\u00ed interval", history: "Servisn\u00ed historie",
      usage: "Odpo\u010det", usageWord: "spot\u0159eba filtru", unit: "l",
      did: "servis", didBy: "kdo to d\u011blal", cost: "co to st\u00e1lo",
      own: ["Startovac\u00ed seznam", "\u017divnostn\u00edci", "Kde jsou m\u011b\u0159i\u010de", "Inventura pro poji\u0161t\u011bn\u00ed"] },
    vehicles: {
      module: "vehicles", entityType: "vehicle", accent: "--accent-family-things",
      cs: "Vozidla", en: "Vehicles", route: "/vehicles",
      thing: "vozidlo", things: "Vozidla",
      list: "Na\u0161e vozidla", detail: "Vozidlo",
      schedule: "Servisn\u00ed pl\u00e1n", history: "Co u\u017e se d\u011blalo",
      usage: "Stav tacho", usageWord: "kilometry", unit: "km",
      did: "servis", didBy: "kde", cost: "cena",
      own: ["Z\u00e1konn\u00e9 term\u00edny", "Poji\u0161t\u011bn\u00ed a v\u00fdpov\u011b\u010fn\u00ed lh\u016fta", "Tankov\u00e1n\u00ed a dob\u00edjen\u00ed", "Co n\u00e1s to stoj\u00ed", "Kolo"] },
    pets: {
      module: "pets", entityType: "pet", accent: "--accent-family-things",
      cs: "Mazl\u00ed\u010dci", en: "Pets", route: "/pets",
      thing: "zv\u00ed\u0159e", things: "Na\u0161i mazl\u00ed\u010dci",
      list: "Kdo u n\u00e1s \u017eije", detail: "Bela",
      schedule: "Pravideln\u00e1 p\u00e9\u010de", history: "Zdravotn\u00ed z\u00e1znam",
      usage: "V\u00e1ha", usageWord: "v\u00e1\u017een\u00ed", unit: "kg",
      did: "n\u00e1v\u0161t\u011bva", didBy: "u koho", cost: "cena",
      own: ["Denn\u00ed re\u017eim", "L\u00e9ky po d\u00e1vk\u00e1ch", "Kartička k veterin\u00e1\u0159i", "Krmen\u00ed a alergie", "V\u00e1ha"] }
  };
  var MODULES = ["property", "vehicles", "pets"];

  /* The twenty-two words a shared asset engine leaks if nobody stops it. */
  var ASSET_WORDS = ["asset", "entity", "entity_type", "item", "inventory", "unit", "record",
                     "maintenance", "service interval", "disposal", "dispose", "depreciation",
                     "utilization", "utilisation", "fleet", "resource", "lifecycle", "retire",
                     "decommission", "write-off", "asset management", "possession"];

  function vocabRun() {
    /* the five engine screens, worded three times, and no word reused across modules */
    var keys = ["list", "detail", "schedule", "history", "usage"];
    var rows = keys.map(function (k) {
      var words = MODULES.map(function (m) { return VOCAB[m][k]; });
      return { key: k, words: words,
               distinct: words.filter(function (w, i) { return words.indexOf(w) === i; }).length };
    });
    return {
      screens: keys.length, modules: MODULES.length,
      cells: keys.length * MODULES.length,
      rows: rows,
      allDistinct: rows.every(function (r) { return r.distinct === MODULES.length; }),
      says: keys.length + " engine screens \u00d7 " + MODULES.length + " vocabularies = " +
        (keys.length * MODULES.length) + " labels, and no two modules share one: the same five rows are drawn as " +
        rows.map(function (r) { return r.words.join(" / "); }).join("; ") + "."
    };
  }

  function toneAudit() {
    /* every string this file hands the Pets vocabulary, run over the asset words */
    var v = VOCAB.pets;
    var petStrings = [v.cs, v.thing, v.things, v.list, v.detail, v.schedule, v.history,
                      v.usage, v.usageWord, v.did, v.didBy, v.cost].concat(v.own)
      .concat(PET_COPY).concat(STATUS_FLOW.map(function (s) { return s.body + " " + s.title; }));
    var hits = [];
    petStrings.forEach(function (s) {
      ASSET_WORDS.forEach(function (w) {
        if (s.toLowerCase().indexOf(w) >= 0) hits.push(w + " in \u201c" + s.slice(0, 40) + "\u201d");
      });
    });
    var vehStrings = [VOCAB.vehicles.thing].concat(VOCAB.vehicles.own);
    return {
      strings: petStrings.length, words: ASSET_WORDS.length, hits: hits,
      vehicleUsesDisposal: DISPOSAL.vehicles.words.length,
      says: petStrings.length + " strings the Pets vocabulary shows a member, run over " +
        ASSET_WORDS.length + " asset-management words: " + hits.length +
        " hits. Vehicles keeps " + DISPOSAL.vehicles.words.length +
        " of them on purpose \u2014 a car really is sold, scrapped or written off \u2014 and Pets keeps none, which is the whole of D-72's difference expressed as vocabulary rather than as tone of voice." +
        (vehStrings.length ? "" : "")
    };
  }

  /* ── 2. The entities ─────────────────────────────────────────────────────
     One table, three entity_types, because the engine is keyed by
     (entity_type, entity_id) and so is every schedule, record and reading. */

  var ENTITIES = [
    /* Property — one house, six things fixed in it */
    { id: "dum-brno", type: "property_item", module: "property", kind: "property",
      cs: "D\u016fm \u2014 Kohoutovice", en: "House \u2014 Kohoutovice", category: "Rodinn\u00fd d\u016fm",
      acquired: "2016-06-30", price: 5850000, status: "active",
      meta: "158 m\u00b2 \u00b7 postaveno 1994 \u00b7 vlastn\u00ed", docs: 4 },
    { id: "kotel-vaillant", type: "property_item", module: "property",
      cs: "Kotel Vaillant ecoTEC", en: "Vaillant ecoTEC boiler", category: "Plynov\u00fd kotel",
      brand: "Vaillant", model: "ecoTEC plus VU 246", serial: "21-VU246-88412",
      location: "technick\u00e1 m\u00edstnost", acquired: "2016-08-14", price: 62400,
      status: "active", insured: true, value: 62400, warranty: null, docs: 3,
      meta: "instalov\u00e1no 14. 8. 2016 \u00b7 servis ka\u017cd\u00fd rok" },
    { id: "pracka-bosch", type: "property_item", module: "property",
      cs: "Pra\u010dka Bosch", en: "Bosch washing machine", category: "Pra\u010dka",
      brand: "Bosch", model: "WAU28T64CS", serial: "FD9912-004518",
      location: "koupelna", acquired: "2024-11-30", price: 14990,
      status: "active", insured: true, value: 14990, warranty: "2026-11-30", docs: 2,
      meta: "koupeno 30. 11. 2024 \u00b7 z\u00e1ruka 2 roky" },
    { id: "hlasice", type: "property_item", module: "property",
      cs: "Kou\u0159ov\u00e1 hl\u00e1sicka \u00d7 4", en: "Smoke alarms \u00d7 4", category: "Kou\u0159ov\u00e1 hl\u00e1sicka",
      location: "chodba, patro, sklep, kuchy\u0148", acquired: "2019-02-02", price: 2360,
      status: "active", insured: false, docs: 1,
      meta: "test ka\u017cd\u00fd m\u011bs\u00edc \u00b7 v\u00fdm\u011bna po 10 letech" },
    { id: "filtr-vody", type: "property_item", module: "property",
      cs: "Filtr na vodu", en: "Water filter", category: "Filtrace vody",
      location: "sklep", acquired: "2023-05-06", price: 8400,
      status: "active", insured: false, docs: 1,
      meta: "v\u00fdm\u011bna vlo\u017eky po 6 m\u011bs\u00edc\u00edch nebo po 30 000 l" },
    { id: "strecha", type: "property_item", module: "property",
      cs: "St\u0159echa \u2014 krytina", en: "Roof", category: "Krytina",
      acquired: "2021-08-20", price: 318000, status: "active", insured: true, value: 318000, docs: 2,
      meta: "kontrola \u017elab\u016f 2\u00d7 ro\u010dn\u011b" },

    /* Vehicles */
    { id: "octavia", type: "vehicle", module: "vehicles",
      cs: "\u0160koda Octavia 2.0 TDI", en: "\u0160koda Octavia", category: "Osobn\u00ed automobil",
      brand: "\u0160koda", model: "Octavia III Combi", year: 2018, plate: "7B2 4413",
      vin: "TMBJJ7NE0J0123456", fuel: "diesel", firstReg: "2018-10-05",
      acquired: "2021-05-18", price: 385000, currentValue: 260000,
      status: "active", insured: true, value: 260000, docs: 5,
      drivers: ["jana", "petr"], country: "CZ",
      meta: "koupeno 18. 5. 2021 \u00b7 prvn\u00ed registrace 5. 10. 2018" },
    { id: "kolo-adam", type: "vehicle", module: "vehicles", variant: "bike",
      cs: "Adamovo kolo", en: "Adam's bike", category: "Horsk\u00e9 kolo",
      brand: "Author", model: "Solution 29", year: 2024, frame: "AU24-77 1902",
      fuel: "human", acquired: "2024-04-12", price: 12900,
      status: "active", insured: false, docs: 1,
      drivers: ["adam"], country: "CZ",
      meta: "r\u00e1m AU24-77 1902 \u00b7 bez zna\u010dky, bez STK" },

    /* Pets */
    { id: "bela", type: "pet", module: "pets",
      cs: "Bela", en: "Bela", category: "Pes \u00b7 k\u0159\u00ed\u017eenec",
      species: "dog", sex: "fena", neutered: true, born: "2019-05-12",
      chip: "900 032 000 471 205", acquired: "2019-07-20", status: "active", docs: 3,
      meta: "narozena 12. 5. 2019 \u00b7 k n\u00e1m 20. 7. 2019" },
    { id: "mour", type: "pet", module: "pets",
      cs: "Mour", en: "Mour", category: "Ko\u010dka \u00b7 evropsk\u00e1 krátkosrst\u00e1",
      species: "cat", sex: "kocour", neutered: true, born: "2022-03-30",
      chip: "900 032 000 618 774", acquired: "2022-06-11", status: "active", docs: 2,
      meta: "narozen 30. 3. 2022 \u00b7 z \u00fatulku" },
    { id: "kiki", type: "pet", module: "pets",
      cs: "Kiki", en: "Kiki", category: "Ko\u010dka",
      species: "cat", sex: "ko\u010dka", born: "2009-04-02", status: "deceased",
      ended: "2024-11-02", docs: 1,
      meta: "2009\u20132024 \u00b7 z\u00e1znam z\u016fst\u00e1v\u00e1 cel\u00fd" }
  ];
  function entity(id) { return ENTITIES.filter(function (e) { return e.id === id; })[0] || null; }
  function entitiesOf(mod, opt) {
    var o = opt || {};
    return ENTITIES.filter(function (e) {
      return e.module === mod && (o.archived ? true : e.status === "active");
    });
  }

  /* ── 3. The usage log — value_milli, non-decreasing, additive ───────────── */

  var READINGS = [
    /* Octavia odometer, km. Six of these are the odometer field on a fuel entry
       (FR-VE2): one series, so consumption and the service threshold cannot disagree. */
    { entity: "octavia", date: "2026-06-14", milli: 130100000, unit: "km", by: "jana", src: "fuel" },
    { entity: "octavia", date: "2026-06-27", milli: 130420000, unit: "km", by: "petr", src: "fuel" },
    { entity: "octavia", date: "2026-07-11", milli: 130810000, unit: "km", by: "jana", src: "fuel" },
    { entity: "octavia", date: "2026-07-25", milli: 131060000, unit: "km", by: "jana", src: "fuel" },
    { entity: "octavia", date: "2026-08-15", milli: 131790000, unit: "km", by: "petr", src: "fuel" },
    { entity: "octavia", date: "2026-09-05", milli: 132340000, unit: "km", by: "jana", src: "fuel" },
    { entity: "octavia", date: "2026-09-08", milli: 132500000, unit: "km", by: "petr", src: "fuel" },
    { entity: "octavia", date: "2026-09-09", milli: 132560000, unit: "km", by: "jana", src: "manual" },
    /* Adam's bike, km */
    { entity: "kolo-adam", date: "2026-06-01", milli: 620000, unit: "km", by: "adam", src: "manual" },
    { entity: "kolo-adam", date: "2026-07-19", milli: 878000, unit: "km", by: "adam", src: "manual" },
    { entity: "kolo-adam", date: "2026-09-09", milli: 1140000, unit: "km", by: "adam", src: "manual" },
    /* Bela's weight, kg — the same additive series shape, drawn as a chart (FR-PE9) */
    { entity: "bela", date: "2025-09-14", milli: 19200, unit: "kg", by: "jana", src: "vet" },
    { entity: "bela", date: "2025-12-20", milli: 19000, unit: "kg", by: "jana", src: "home" },
    { entity: "bela", date: "2026-03-04", milli: 18800, unit: "kg", by: "jana", src: "vet" },
    { entity: "bela", date: "2026-06-16", milli: 18600, unit: "kg", by: "adam", src: "home" },
    { entity: "bela", date: "2026-09-06", milli: 18400, unit: "kg", by: "jana", src: "home" }
  ];
  /* The one rejected write, kept as data so the state is drawn from a real row.
     Non-decreasing is a cross-row invariant, so an additive reading made offline can
     come back rejected against a neighbour the replica never held (03 §2.5). */
  var REJECTED_READING = {
    entity: "octavia", date: "2026-09-07", milli: 131900000, unit: "km", by: "petr",
    against: "2026-09-05", againstMilli: 132340000, reason: "monotonicity_violation",
    says: "Petr zapsal 131\u202f900 km 7. 9. Telefon tehdy nem\u011bl z\u00e1pis z 5. 9. \u2014 132\u202f340 km \u2014 a tacho nem\u016f\u017ee j\u00edt zp\u00e1tky.",
    en: "Recorded offline on 7 September against a neighbour the phone did not hold. The value is kept, the row is marked rejected, and the fix is one field."
  };

  function readingsOf(id, unit) {
    return READINGS.filter(function (r) { return r.entity === id && (!unit || r.unit === unit); })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }
  function latest(id, unit) {
    var rs = readingsOf(id, unit);
    return rs.length ? rs[rs.length - 1] : null;
  }
  function monotonic(id, unit) {
    var rs = readingsOf(id, unit), bad = 0;
    for (var i = 1; i < rs.length; i++) if (rs[i].milli < rs[i - 1].milli) bad++;
    return { rows: rs.length, violations: bad };
  }
  /* FR-AS2: a daily rate from the last few readings, and nothing more than an estimate. */
  function rate(id, unit, window) {
    var rs = readingsOf(id, unit);
    if (rs.length < 2) return null;
    var from = rs[Math.max(0, rs.length - (window || 4))], to = rs[rs.length - 1];
    var days = diff(from.date, to.date);
    if (days <= 0) return null;
    return { perDay: (to.milli - from.milli) / 1000 / days, from: from, to: to, days: days,
             span: rs.length };
  }

  /* ── 4. Service schedules — interval, usage, or whichever comes first ───── */

  var SCHEDULES = [
    { id: "sch-kotel", entity: "kotel-vaillant", cs: "Ro\u010dn\u00ed servis kotle",
      basis: "interval", months: 12, lastDone: "2025-09-04", fromCategory: true },
    { id: "sch-hlasice", entity: "hlasice", cs: "Test hl\u00e1si\u010dek",
      basis: "interval", months: 1, lastDone: "2026-08-31", fromCategory: true },
    { id: "sch-filtr", entity: "filtr-vody", cs: "V\u00fdm\u011bna vlo\u017eky",
      basis: "both", months: 6, everyUnit: 30000, unit: "l", lastDone: "2026-04-06",
      lastValue: null, fromCategory: true },
    { id: "sch-zlaby", entity: "strecha", cs: "Kontrola \u017elab\u016f",
      basis: "interval", months: 6, lastDone: "2026-04-18" },
    { id: "sch-octavia", entity: "octavia", cs: "Servisn\u00ed interval",
      basis: "both", months: 12, everyUnit: 15000, unit: "km",
      lastDone: "2025-11-20", lastValue: 121400 },
    { id: "sch-kolo", entity: "kolo-adam", cs: "Brzdov\u00e9 desti\u010dky",
      basis: "both", months: 12, everyUnit: 1200, unit: "km",
      lastDone: "2026-02-14", lastValue: 0 },
    { id: "sch-bela-vakcina", entity: "bela", cs: "O\u010dkov\u00e1n\u00ed",
      basis: "interval", months: 12, lastDone: "2026-03-04", fromSpecies: true },
    { id: "sch-bela-odcerveni", entity: "bela", cs: "Odčerven\u00ed",
      basis: "interval", months: 3, lastDone: "2026-06-09", fromSpecies: true },
    { id: "sch-mour-vakcina", entity: "mour", cs: "O\u010dkov\u00e1n\u00ed",
      basis: "interval", months: 12, lastDone: "2026-05-21", fromSpecies: true }
  ];
  function schedule(id) { return SCHEDULES.filter(function (s) { return s.id === id; })[0] || null; }
  function schedulesOf(entityId) {
    return SCHEDULES.filter(function (s) { return s.entity === entityId; });
  }

  /* The whole of FR-AS1 in one function. Three shapes, one answer, and the
     estimate never presented as a date the household committed to. */
  function due(id, today) {
    var s = schedule(id), now = today || TODAY;
    var out = { id: id, basis: s.basis, entity: s.entity, cs: s.cs,
                intervalDue: null, usageDueAt: null, usageDueOn: null,
                estimate: false, resolved: null, reason: "", says: "", noReading: false };
    if (s.months) out.intervalDue = addMonths(s.lastDone, s.months);
    if (s.basis !== "interval") {
      var r = latest(s.entity, s.unit);
      var base = s.lastValue === null || s.lastValue === undefined
        ? (r ? r.milli / 1000 : null) : s.lastValue;
      if (!r) {
        out.noReading = true;
        out.resolved = out.intervalDue;
        out.reason = "no_reading";
        out.says = "Bez z\u00e1pisu (" + s.unit + ") se po\u010d\u00edt\u00e1 jen datum. " +
          "\u017d\u00e1dn\u00fd \u201enikdy\u201c \u2014 " + (out.intervalDue ? fmtCs(out.intervalDue) : "");
      } else {
        out.usageDueAt = base + s.everyUnit;
        out.reading = r;
        var rt = rate(s.entity, s.unit);
        if (rt && rt.perDay > 0) {
          var left = out.usageDueAt - r.milli / 1000;
          var days = Math.round(left / rt.perDay);
          out.perDay = rt.perDay;
          out.left = left;
          out.usageDueOn = addDays(now, Math.max(0, days));
          out.days = days;
        }
      }
    }
    if (out.reason !== "no_reading") {
      if (s.basis === "interval") { out.resolved = out.intervalDue; out.reason = "interval"; }
      else if (s.basis === "usage") { out.resolved = out.usageDueOn; out.reason = "usage"; out.estimate = true; }
      else {
        if (out.usageDueOn && out.usageDueOn < out.intervalDue) {
          out.resolved = out.usageDueOn; out.reason = "usage"; out.estimate = true;
        } else { out.resolved = out.intervalDue; out.reason = "interval"; }
      }
    }
    out.overdue = out.resolved ? out.resolved < now : false;
    out.inDays = out.resolved ? diff(now, out.resolved) : null;
    if (!out.says) {
      out.says = out.reason === "interval"
        ? "Podle data: " + fmtCs(out.intervalDue) +
          (out.usageDueOn ? " \u2014 dřív ne\u017e odhadovan\u00fdch " + fmtCs(out.usageDueOn) + " podle " + s.unit : "")
        : "Podle " + s.unit + ": p\u0159i " + num(out.usageDueAt) + " " + s.unit +
          ", te\u010f " + num(out.reading.milli / 1000) + " " + s.unit +
          " \u00b7 odhadem " + fmtCs(out.usageDueOn) + " (ne term\u00edn, odhad)";
    }
    return out;
  }
  function dueRun() {
    var rows = SCHEDULES.map(function (s) { return due(s.id); });
    var both = rows.filter(function (r) { return r.basis === "both"; });
    return {
      total: rows.length, rows: rows,
      both: both.length,
      byInterval: rows.filter(function (r) { return r.reason === "interval"; }).length,
      byUsage: rows.filter(function (r) { return r.reason === "usage"; }).length,
      noReading: rows.filter(function (r) { return r.noReading; }).length,
      estimates: rows.filter(function (r) { return r.estimate; }).length,
      overdue: rows.filter(function (r) { return r.overdue; }).length,
      neverDue: rows.filter(function (r) { return r.resolved === null; }).length,
      says: rows.length + " schedules over " + MODULES.length + " vocabularies: " +
        both.length + " dual-trigger, " +
        rows.filter(function (r) { return r.reason === "usage"; }).length +
        " resolved by usage and therefore drawn as an estimate, " +
        rows.filter(function (r) { return r.reason === "interval"; }).length +
        " by a definite date, " + rows.filter(function (r) { return r.noReading; }).length +
        " degraded to \u201cno reading yet\u201d, and " +
        rows.filter(function (r) { return r.resolved === null; }).length + " that resolve to never."
    };
  }

  /* ── 5. Service history ─────────────────────────────────────────────────── */

  var RECORDS = [
    { id: "r-kotel-25", entity: "kotel-vaillant", date: "2025-09-04", what: "Ro\u010dn\u00ed servis a \u010di\u0161t\u011bn\u00ed",
      by: "Novotn\u00fd \u2014 servis", cost: 2400, docs: 1, actor: "jana" },
    { id: "r-kotel-24", entity: "kotel-vaillant", date: "2024-09-06", what: "Ro\u010dn\u00ed servis",
      by: "Novotn\u00fd \u2014 servis", cost: 2300, docs: 1, actor: "jana" },
    { id: "r-kotel-23", entity: "kotel-vaillant", date: "2023-09-11", what: "Servis + v\u00fdm\u011bna \u010didla",
      by: "Novotn\u00fd \u2014 servis", cost: 4150, docs: 2, actor: "jana" },
    { id: "r-pracka", entity: "pracka-bosch", date: "2026-02-19", what: "V\u00fdm\u011bna p\u0159\u00edvodn\u00ed hadice",
      by: "Petr", cost: 340, docs: 0, actor: "petr" },
    { id: "r-filtr", entity: "filtr-vody", date: "2026-04-06", what: "V\u00fdm\u011bna vlo\u017eky",
      by: "Jana", cost: 690, docs: 0, actor: "jana" },
    { id: "r-oct-serv", entity: "octavia", date: "2025-11-20", what: "Servis 120 000 \u2014 olej, filtry, brzdy",
      by: "Auto Dvo\u0159\u00e1k", cost: 8940, value: 121400, unit: "km", docs: 2, actor: "jana" },
    { id: "r-oct-stk", entity: "octavia", date: "2024-10-02", what: "STK + emise",
      by: "STK Brno-jih", cost: 1450, value: 112060, unit: "km", docs: 1, actor: "petr" },
    { id: "r-oct-prask", entity: "octavia", date: "2026-03-11", what: "Praskl\u00e1 pruzina vpravo vp\u0159edu",
      by: "Auto Dvo\u0159\u00e1k", cost: 4200, value: 127310, unit: "km", docs: 1, actor: "jana" },
    { id: "r-kolo", entity: "kolo-adam", date: "2026-02-14", what: "Se\u0159\u00edzen\u00ed a nov\u00e9 lanko",
      by: "Kola Vondr\u00e1k", cost: 450, value: 0, unit: "km", docs: 0, actor: "jana" }
  ];
  function recordsOf(id) {
    return RECORDS.filter(function (r) { return r.entity === id; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }
  function costOf(id) {
    return RECORDS.filter(function (r) { return r.entity === id; })
      .reduce(function (n, r) { return n + r.cost; }, 0);
  }

  /* ── 6. The grant is resolved from entity_type, not the path prefix ──────
     D-16 and the engine's own paragraph: one place for it to be right, and a
     none grant answers 404 rather than 403 so a guessed id is not an oracle. */

  var ENGINE_ROUTES = [
    ["/assets/{entity_type}/{id}/schedules", "view", "The schedules on one thing"],
    ["/assets/{entity_type}/{id}/schedules", "manage", "Editing one"],
    ["/assets/{entity_type}/{id}/records", "contribute", "Logging what was done"],
    ["/assets/{entity_type}/{id}/readings", "contribute", "Adding a reading"],
    ["/assets/{entity_type}/{id}", "view", "The thing itself"]
  ];
  function resolve(memberId, entityType, want) {
    var mod = MODULES.filter(function (m) { return VOCAB[m].entityType === entityType; })[0];
    var level = grantOf(memberId, mod);
    if (level === "none") {
      return { status: 404, level: level, module: mod, ok: false,
               says: "404 \u2014 not 403. A none grant makes the row not exist, so a guessed id answers nothing." };
    }
    if (!atLeast(level, want)) {
      return { status: 403, level: level, module: mod, ok: false,
               says: "403 \u2014 the thing exists and is readable; this particular write is not this member's." };
    }
    return { status: 200, level: level, module: mod, ok: true, says: "" };
  }
  function grantRun() {
    var F = window.HH_FIXTURES;
    var members = (F ? F.members : []).map(function (m) { return m.id; });
    var rows = [];
    members.forEach(function (id) {
      MODULES.forEach(function (mod) {
        var t = VOCAB[mod].entityType;
        var per = ENGINE_ROUTES.map(function (r) { return resolve(id, t, r[1]); });
        rows.push({
          member: id, name: name(id), module: mod, entityType: t,
          level: grantOf(id, mod),
          statuses: per.map(function (p) { return p.status; }),
          n404: per.filter(function (p) { return p.status === 404; }).length,
          n403: per.filter(function (p) { return p.status === 403; }).length,
          n200: per.filter(function (p) { return p.status === 200; }).length
        });
      });
    });
    /* The same walk against FR-PE10's default, which is where the 403 lives:
       a member at contribute on Pets may log a dose and may not edit the schedule. */
    var intended = [];
    (F ? F.members : []).forEach(function (m) {
      MODULES.forEach(function (mod) {
        var level = grantOf(m.id, mod);
        if (mod === "pets" && level === "none") level = "contribute";
        var per = ENGINE_ROUTES.map(function (r) {
          if (level === "none") return 404;
          return atLeast(level, r[1]) ? 200 : 403;
        });
        intended.push({ member: m.id, name: m.name, module: mod, level: level,
                        statuses: per,
                        n404: per.filter(function (s) { return s === 404; }).length,
                        n403: per.filter(function (s) { return s === 403; }).length,
                        n200: per.filter(function (s) { return s === 200; }).length });
      });
    });
    return {
      rows: rows, routes: ENGINE_ROUTES, intendedRows: intended,
      cells: rows.length * ENGINE_ROUTES.length,
      denied404: rows.reduce(function (n, r) { return n + r.n404; }, 0),
      denied403: rows.reduce(function (n, r) { return n + r.n403; }, 0),
      allowed: rows.reduce(function (n, r) { return n + r.n200; }, 0),
      intended403: intended.reduce(function (n, r) { return n + r.n403; }, 0),
      intended404: intended.reduce(function (n, r) { return n + r.n404; }, 0),
      no403OnNone: rows.filter(function (r) { return r.level === "none" && r.n403 > 0; }).length === 0,
      says: rows.length + " (member, entity_type) pairs \u00d7 " + ENGINE_ROUTES.length +
        " engine routes = " + (rows.length * ENGINE_ROUTES.length) + " answers, resolved from entity_type in one place rather than from the path prefix: " +
        rows.reduce(function (n, r) { return n + r.n200; }, 0) + " served and " +
        rows.reduce(function (n, r) { return n + r.n404; }, 0) +
        " refused, every refusal a 404 and not one a 403. Petr holds manage on Utilities and none on all three of these, so /assets/property_item/\u2026/schedules answers him exactly what /property/\u2026 would \u2014 nothing, and no evidence the row exists. In this fixture only Jana holds any of the three, so the too-low refusal is unreachable; run the same walk with FR-PE10's default of contribute on Pets and it appears immediately: " +
        intended.reduce(function (n, r) { return n + r.n403; }, 0) +
        " answers become 403 (log a dose yes, edit the schedule no) and " +
        (rows.reduce(function (n, r) { return n + r.n404; }, 0) - intended.reduce(function (n, r) { return n + r.n404; }, 0)) +
        " stop being 404 at all."
    };
  }

  /* ── 7. Property's own four screens ─────────────────────────────────────── */

  /* D-69: one tap adds the item *with its typical service interval*, which is the
     part that makes the module useful on day one. Country profile = reference data. */
  var STARTER = {
    CZ: [
      { cs: "Plynov\u00fd kotel", months: 12, note: "Ro\u010dn\u00ed servis \u2014 a v \u010cesku i revize spot\u0159ebi\u010de." },
      { cs: "Komín", months: 12, note: "Kontrola 1\u00d7 ro\u010dn\u011b, u pevn\u00fdch paliv \u010dast\u011bji." },
      { cs: "Kou\u0159ov\u00e9 hl\u00e1si\u010dky", months: 1, note: "Test m\u011bs\u00ed\u010dn\u011b, v\u00fdm\u011bna po deseti letech." },
      { cs: "Filtr na vodu", months: 6, note: "Podle vlo\u017eky, obvykle p\u016fl roku." },
      { cs: "\u017dlaby a svody", months: 6, note: "Na podzim a na ja\u0159e." }
    ],
    DE: [
      { cs: "Gasheizung", months: 12, note: "Wartung j\u00e4hrlich \u00b7 Schornsteinfeger separat." },
      { cs: "Schornstein", months: 12, note: "Kehrung nach Landesrecht." },
      { cs: "Rauchmelder", months: 12, note: "DIN 14676: Pr\u00fcfung j\u00e4hrlich." },
      { cs: "Wasserfilter", months: 6, note: "" },
      { cs: "Dachrinnen", months: 6, note: "" }
    ]
  };
  function starterRun(country) {
    var list = STARTER[country || "CZ"];
    return {
      country: country || "CZ", items: list,
      withInterval: list.filter(function (i) { return !!i.months; }).length,
      countries: Object.keys(STARTER).length,
      taps: 1,
      says: list.length + " items in the " + (country || "CZ") + " profile, " +
        list.filter(function (i) { return !!i.months; }).length +
        " of them carrying a typical interval, added in one tap each. The interval is the whole of D-69: an item with no schedule is a row, and a row is not why anybody opens this module."
    };
  }

  var CONTRACTORS = [
    { id: "novotny", name: "Novotn\u00fd \u2014 servis", trade: "Kotle a plyn", phone: "+420 604 118 220",
      email: "servis@novotny-kotle.cz", note: "D\u011bl\u00e1 n\u00e1m kotel od 2016. Ber\u011b jen dopoledne.",
      did: ["r-kotel-25", "r-kotel-24", "r-kotel-23"] },
    { id: "dvorak", name: "Auto Dvo\u0159\u00e1k", trade: "Autoservis", phone: "+420 545 221 907",
      email: "", note: "", did: ["r-oct-serv", "r-oct-prask"] },
    { id: "elektro", name: "Kub\u00e1t \u2014 elektro", trade: "Elektrik\u00e1\u0159", phone: "+420 776 330 118",
      email: "", note: "Dohled na hl\u00e1si\u010dky, kdy\u017e se d\u011blala chodba.", did: [] }
  ];
  function contractorRun() {
    return {
      total: CONTRACTORS.length,
      withWork: CONTRACTORS.filter(function (c) { return c.did.length > 0; }).length,
      fields: ["name", "trade", "phone", "email", "note"],
      crmFields: 0,
      services: CONTRACTORS.reduce(function (n, c) { return n + c.did.length; }, 0),
      says: CONTRACTORS.length + " contractors, five fields each and no sixth: " +
        CONTRACTORS.reduce(function (n, c) { return n + c.did.length; }, 0) +
        " recorded jobs attach a name and a number to the boiler so nobody searches their messages for who came last time. Not a CRM \u2014 there is no pipeline, no rating and no quote."
    };
  }

  var METERS = [
    { cs: "Hlavn\u00ed uz\u00e1v\u011br vody", where: "sklep, za regálem vlevo",
      note: "Kl\u00ed\u010d na 24 vis\u00ed vedle. Otev\u00edr\u00e1 se proti sm\u011bru hodin.", photo: true, link: null },
    { cs: "Elektrom\u011br", where: "chodba, sk\u0159\u00ed\u0148 u dve\u0159\u00ed",
      note: "Jedno \u010d\u00edslo, dva registry \u2014 VT a NT.", photo: true, link: "utilities.electricity" },
    { cs: "Plynom\u011br", where: "venku, u branky",
      note: "Kl\u00ed\u010d od sk\u0159\u00ed\u0148ky m\u00e1 soused Vlas\u00e1k.", photo: true, link: "utilities.gas" },
    { cs: "Jisti\u010de", where: "chodba, tat\u00e1\u017e sk\u0159\u00ed\u0148",
      note: "Popsan\u00e9 zvenku. Sklep je t\u0159et\u00ed odshora.", photo: true, link: null }
  ];
  function meterRun() {
    return {
      total: METERS.length, photos: METERS.filter(function (m) { return m.photo; }).length,
      linked: METERS.filter(function (m) { return !!m.link; }).length,
      readings: 0, values: 0,
      says: METERS.length + " locations, " + METERS.filter(function (m) { return m.photo; }).length +
        " with a photo and " + METERS.filter(function (m) { return !!m.link; }).length +
        " linking straight into Utilities. Zero readings and zero values live here: FR-PP6 is a document reference and a note, not a second copy of the meter \u2014 but \u201cwhere is the stopcock\u201d is a question a house-sitter asks and this is where the answer is."
    };
  }

  function inventoryRun() {
    /* the home inventory is the house’s, so the car’s own insured value is not on it */
    var ins = ENTITIES.filter(function (e) { return e.insured && e.module === "property"; });
    return {
      items: ins, count: ins.length,
      total: ins.reduce(function (n, e) { return n + (e.value || 0); }, 0),
      serials: ins.filter(function (e) { return !!e.serial; }).length,
      dated: ins.filter(function (e) { return !!e.acquired; }).length,
      docs: ins.reduce(function (n, e) { return n + (e.docs || 0); }, 0),
      print: { theme: "light only", accents: 0, ink: "no fills over 8 %", checkboxes: false },
      says: ins.length + " flagged items totalling " + czk(ins.reduce(function (n, e) { return n + (e.value || 0); }, 0)) +
        ", " + ins.filter(function (e) { return !!e.serial; }).length + " with a serial number, " +
        ins.filter(function (e) { return !!e.acquired; }).length + " with a purchase date and " +
        ins.reduce(function (n, e) { return n + (e.docs || 0); }, 0) +
        " documents attached. It prints on Stage 17's stylesheet \u2014 light theme only, no accent colour, nothing over eight per cent ink \u2014 because the day this is needed is the day it is being read on paper by somebody else."
    };
  }

  /* ── 8. Vehicles' own five screens ──────────────────────────────────────── */

  /* D-70: country reference data, versioned, not code. A country with no preset
     must be addable without a release, and every date is overridable. */
  var STATUTORY = {
    CZ: { inspection: "STK + emise", first: 48, then: 24, tax: false,
          taxNote: "Osobn\u00ed automobily v \u010cR silni\u010dn\u00ed dan\u011b nemaj\u00ed \u2014 kind vehicles.road_tax_due se pro tohle vozidlo neregistruje v\u016fbec." },
    SK: { inspection: "TK + EK", first: 48, then: 24, tax: false },
    DE: { inspection: "HU/AU (T\u00dcV)", first: 36, then: 24, tax: true, taxNote: "Kfz-Steuer, ro\u010dn\u011b." },
    PL: { inspection: "Przegl\u0105d techniczny", first: 36, then: 24, thenAfter: 12, tax: false },
    UK: { inspection: "MOT", first: 36, then: 12, tax: true, taxNote: "Vehicle tax, ro\u010dn\u011b nebo m\u011bs\u00ed\u010dn\u011b." }
  };
  function statutoryFor(country, firstReg, today) {
    var p = STATUTORY[country], now = today || TODAY, dates = [];
    var d = addMonths(firstReg, p.first);
    dates.push(d);
    var guard = 0;
    while (d < addMonths(now, 60) && guard++ < 40) {
      var step = p.thenAfter && dates.length >= 3 ? p.thenAfter : p.then;
      d = addMonths(d, step);
      dates.push(d);
    }
    var next = dates.filter(function (x) { return x >= now; })[0] || null;
    var past = dates.filter(function (x) { return x < now; });
    return { country: country, preset: p.inspection, dates: dates, next: next,
             last: past.length ? past[past.length - 1] : null,
             inDays: next ? diff(now, next) : null,
             tax: p.tax, taxNote: p.taxNote || "",
             cadence: (p.first / 12) + " roky od nov\u00e9ho, " +
               (p.then === 12 ? "pak ka\u017ed\u00fd rok" : "pak ka\u017ed\u00e9 " + p.then / 12 + " roky") +
               (p.thenAfter ? " a od t\u0159et\u00ed ka\u017ed\u00fd rok" : ""),
             says: p.inspection + " \u00b7 " + (p.first / 12) + " roky od nov\u00e9ho, " +
               (p.then === 12 ? "pak ka\u017ed\u00fd rok" : "pak ka\u017ed\u00e9 " + p.then / 12 + " roky") +
               (p.thenAfter ? " a od t\u0159et\u00ed ka\u017ed\u00fd rok" : "") };
  }
  function statutoryRun() {
    var v = entity("octavia");
    var per = Object.keys(STATUTORY).map(function (c) {
      var r = statutoryFor(c, v.firstReg);
      return { country: c, preset: r.preset, next: r.next, inDays: r.inDays, tax: r.tax,
               cadence: r.cadence, says: r.says };
    });
    var bike = entitiesOf("vehicles").filter(function (e) { return e.variant === "bike"; })[0];
    var uniq = function (arr) { return arr.filter(function (x, i, s) { return s.indexOf(x) === i; }); };
    return {
      countries: per.length, rows: per,
      here: statutoryFor(v.country, v.firstReg),
      distinct: uniq(per.map(function (p) { return p.preset; })).length,
      cadences: uniq(per.map(function (p) { return p.cadence; })).length,
      nextDistinct: uniq(per.map(function (p) { return p.next; })).length,
      bikeHas: 0, bikeName: bike.cs,
      versioned: true, overridable: true,
      says: per.length + " country presets over one first registration (" + fmt(v.firstReg) + "), " +
        uniq(per.map(function (p) { return p.preset; })).length + " names and " +
        uniq(per.map(function (p) { return p.cadence; })).length + " distinct cadences: " +
        per.map(function (p) { return p.country + " " + p.preset + " \u2192 " + fmt(p.next); }).join(", ") +
        ". Four of the five land on the same October date by three different rules and Germany lands a year later, which is exactly why D-70 makes these versioned reference data rather than code \u2014 a rule that changes, or a country whose preset does not exist yet, must be addable without a release, and the member can override the date and the cadence in either case. " +
        bike.cs + " gets none of them: a bicycle has no statutory inspection and is never asked for one."
    };
  }

  var POLICIES_INS = [
    { id: "pol-octavia", entity: "octavia", type: "Povinn\u00e9 ru\u010den\u00ed + havarijn\u00ed",
      insurer: "Kooperativa", number: "7721-448-119", premium: 8400, cadence: "ro\u010dn\u011b",
      start: "2025-11-12", end: "2026-11-11", noticeDays: 42, docs: 1 },
    { id: "pol-bela", entity: "bela", type: "Poji\u0161t\u011bn\u00ed l\u00e9\u010deb\u00fdch v\u00fdloh",
      insurer: "Pet Expert", number: "PE-2026-30188", premium: 2280, cadence: "ro\u010dn\u011b",
      start: "2026-01-15", end: "2027-01-14", noticeDays: 30, docs: 1 }
  ];
  function noticeRun(id) {
    var p = POLICIES_INS.filter(function (x) { return x.id === id; })[0];
    var fires = addDays(p.end, -p.noticeDays);
    return { policy: p, fires: fires, atExpiry: p.end,
             days: diff(TODAY, fires), late: diff(fires, p.end),
             says: "Obnova " + fmtCs(p.end) + ", v\u00fdpov\u011b\u010fn\u00ed lh\u016fta " + p.noticeDays +
               " dn\u00ed \u2014 upozorn\u011bn\u00ed p\u0159ijde " + fmtCs(fires) +
               ", ne v den obnovy, aby se je\u0161t\u011b dalo p\u0159ej\u00edt jinam." };
  }

  /* FR-VE6 / D-71 — the arithmetic that decides whether the module is used twice. */
  var FUEL = [
    { date: "2026-06-14", odo: 130100, litres: 47.8, cost: 1625, full: true, station: "MOL Brno-Bystrc" },
    { date: "2026-06-27", odo: 130420, litres: 18.0, cost: 612, full: false, station: "Shell D1" },
    { date: "2026-07-11", odo: 130810, litres: 22.0, cost: 748, full: false, station: "Benzina Kohoutovice" },
    { date: "2026-07-25", odo: 131060, litres: 12.5, cost: 425, full: true, station: "MOL Brno-Bystrc" },
    { date: "2026-08-15", odo: 131790, litres: 40.0, cost: 1360, full: false, station: "OMV Vysočina" },
    { date: "2026-09-05", odo: 132340, litres: 30.0, cost: 1020, full: true, station: "MOL Brno-Bystrc" },
    { date: "2026-09-08", odo: 132500, litres: 15.0, cost: 510, full: false, station: "Shell D1" }
  ];
  function fuelRun() {
    var fulls = [];
    FUEL.forEach(function (f, i) { if (f.full) fulls.push(i); });
    var intervals = [];
    for (var k = 0; k < fulls.length - 1; k++) {
      var a = fulls[k], b = fulls[k + 1];
      var litres = 0, cost = 0;
      for (var i = a + 1; i <= b; i++) { litres += FUEL[i].litres; cost += FUEL[i].cost; }
      var km = FUEL[b].odo - FUEL[a].odo;
      intervals.push({ from: FUEL[a].date, to: FUEL[b].date, km: km, litres: litres, cost: cost,
                       per100: litres / km * 100, perKm: cost / km,
                       partials: b - a - 1 });
    }
    var openLitres = 0, openCost = 0, openFrom = fulls[fulls.length - 1];
    for (var j = openFrom + 1; j < FUEL.length; j++) { openLitres += FUEL[j].litres; openCost += FUEL[j].cost; }
    var closedKm = FUEL[fulls[fulls.length - 1]].odo - FUEL[fulls[0]].odo;
    var closedLitres = intervals.reduce(function (n, x) { return n + x.litres; }, 0);
    var allKm = FUEL[FUEL.length - 1].odo - FUEL[0].odo;
    var allLitres = FUEL.slice(1).reduce(function (n, f) { return n + f.litres; }, 0);
    var correct = closedLitres / closedKm * 100;
    var naive = allLitres / allKm * 100;
    return {
      entries: FUEL.length, fills: FUEL.length, fulls: fulls.length,
      partials: FUEL.length - fulls.length,
      intervals: intervals, closedKm: closedKm, closedLitres: closedLitres,
      openLitres: openLitres, openCost: openCost, openKm: FUEL[FUEL.length - 1].odo - FUEL[fulls[fulls.length - 1]].odo,
      correct: correct, naive: naive, error: naive - correct,
      errorPct: (naive - correct) / correct * 100,
      consistent: Math.max.apply(null, intervals.map(function (x) { return x.per100; })) -
                  Math.min.apply(null, intervals.map(function (x) { return x.per100; })),
      cost: FUEL.reduce(function (n, f) { return n + f.cost; }, 0),
      says: FUEL.length + " entries, " + fulls.length + " of them full fills and " +
        (FUEL.length - fulls.length) + " partial. Consumption is computed between consecutive full fills with the partials accumulated: " +
        intervals.map(function (x) { return x.per100.toFixed(2); }).join(" and ") +
        " l/100 km over " + closedKm + " km. Dividing every litre logged by every kilometre driven gives " +
        naive.toFixed(2) + " \u2014 " + ((naive - correct) / correct * 100).toFixed(1) +
        " % out, because the last " + (FUEL[FUEL.length - 1].odo - FUEL[fulls[fulls.length - 1]].odo) +
        " km have not burned the " + openLitres.toFixed(1) + " l in the tank yet. That is the number that gets fuel apps abandoned."
    };
  }

  function tco(id) {
    var e = entity(id), f = fuelRun();
    var pol = POLICIES_INS.filter(function (p) { return p.entity === id; })[0];
    var serviceCost = RECORDS.filter(function (r) { return r.entity === id && !/prask|pru/i.test(r.what); })
      .reduce(function (n, r) { return n + r.cost; }, 0);
    var repairs = RECORDS.filter(function (r) { return r.entity === id && /prask|pru/i.test(r.what); })
      .reduce(function (n, r) { return n + r.cost; }, 0);
    var days = diff(FUEL[0].date, TODAY);
    var km = FUEL[FUEL.length - 1].odo - FUEL[0].odo;
    var lines = [
      { label: "Palivo", value: f.cost, window: "od 14. 6. 2026", measured: true },
      { label: "Poji\u0161t\u011bn\u00ed", value: pol ? pol.premium : 0, window: "ro\u010dn\u011b", measured: true },
      { label: "Servis", value: serviceCost, window: "cel\u00e1 historie", measured: true },
      { label: "Opravy", value: repairs, window: "cel\u00e1 historie", measured: true },
      { label: "Silni\u010dn\u00ed da\u0148", value: 0, window: "\u010cR: nen\u00ed", measured: false },
      { label: "Ztr\u00e1ta hodnoty", value: e.price - e.currentValue, window: "od 18. 5. 2021", measured: true }
    ];
    var total = lines.reduce(function (n, l) { return n + l.value; }, 0);
    return {
      entity: e, lines: lines, total: total,
      fuelPerKm: f.cost / km, kmWindow: km, days: days,
      runningPerKm: (f.cost + (pol ? pol.premium * days / 365 : 0)) / km,
      says: "Six lines, " + lines.filter(function (l) { return l.measured; }).length +
        " of them from rows the household actually entered and one \u2014 silni\u010dn\u00ed da\u0148 \u2014 absent rather than zero, because Czech passenger cars have none and the reminder kind is not registered for this vehicle at all. Fuel is " +
        (f.cost / km).toFixed(2) + " K\u010d/km over the " + km + " km the log covers, and the screen says which window each line is measured over instead of implying a year of data it does not have."
    };
  }

  /* FR-VE9 — type-aware fields. A household with three bikes and no car should
     find this useful, which it will not if every screen asks for a plate. */
  var VEHICLE_FIELDS = [
    ["type", ["car", "bike"]], ["make", ["car", "bike"]], ["model", ["car", "bike"]],
    ["year", ["car", "bike"]], ["registration", ["car"]], ["VIN", ["car"]],
    ["frame number", ["bike"]], ["fuel or drivetrain", ["car"]],
    ["battery health", ["bike"]], ["purchase date and price", ["car", "bike"]],
    ["current owner", ["car", "bike"]], ["photo", ["car", "bike"]],
    ["statutory inspection", ["car"]], ["insurance policy", ["car"]],
    ["service interval in km or months", ["car", "bike"]]
  ];
  function bikeAudit() {
    var car = VEHICLE_FIELDS.filter(function (f) { return f[1].indexOf("car") >= 0; });
    var bike = VEHICLE_FIELDS.filter(function (f) { return f[1].indexOf("bike") >= 0; });
    var plateWords = ["registration", "VIN", "statutory inspection"];
    return {
      car: car.length, bike: bike.length, total: VEHICLE_FIELDS.length,
      bikeAsksPlate: bike.filter(function (f) { return plateWords.indexOf(f[0]) >= 0; }).length,
      bikeOnly: bike.filter(function (f) { return f[1].indexOf("car") < 0; }).map(function (f) { return f[0]; }),
      carOnly: car.filter(function (f) { return f[1].indexOf("bike") < 0; }).map(function (f) { return f[0]; }),
      says: VEHICLE_FIELDS.length + " fields in the editor, " + car.length + " of them for a car and " +
        bike.length + " for a bicycle. The bike form asks for " +
        bike.filter(function (f) { return plateWords.indexOf(f[0]) >= 0; }).length +
        " of the three plate-shaped fields and adds " +
        bike.filter(function (f) { return f[1].indexOf("car") < 0; }).map(function (f) { return f[0]; }).join(" and ") +
        " instead \u2014 the same editor, a different set, and no greyed-out registration box."
    };
  }

  /* ── 9. Pets ────────────────────────────────────────────────────────────── */

  var HEALTH_TYPES = ["vaccination", "treatment", "condition", "procedure", "weight", "note"];
  var HEALTH = [
    { id: "h-vac", entity: "bela", type: "vaccination", date: "2026-03-04",
      cs: "Nobivac DHPPi + L4", meta: "\u0161ar\u017ee A241-77 \u00b7 dal\u0161\u00ed 4. 3. 2027",
      vet: "MVDr. S\u00fdkorov\u00e1", cost: 890, docs: 1 },
    { id: "h-worm", entity: "bela", type: "treatment", date: "2026-06-09",
      cs: "Milbemax \u2014 odčerven\u00ed", meta: "1 tableta \u00b7 dal\u0161\u00ed 9. 9. 2026", cost: 180, docs: 0 },
    { id: "h-hip", entity: "bela", type: "condition", date: "2025-11-18",
      cs: "M\u00edrn\u00e1 dysplazie kyčl\u00ed", meta: "trv\u00e1 \u00b7 bez l\u00e9\u010dby, dr\u017eet v\u00e1hu",
      vet: "MVDr. S\u00fdkorov\u00e1", docs: 1 },
    { id: "h-spay", entity: "bela", type: "procedure", date: "2020-06-11",
      cs: "Kastrace", meta: "bez komplikac\u00ed", vet: "MVDr. S\u00fdkorov\u00e1", cost: 4800, docs: 1 },
    { id: "h-weight", entity: "bela", type: "weight", date: "2026-09-06",
      cs: "18,4 kg", meta: "doma \u00b7 pět z\u00e1pis\u016f za rok", docs: 0 },
    { id: "h-note", entity: "bela", type: "note", date: "2026-08-02",
      cs: "\u0158\u00edznut\u00e1 tlapka po Svratce", meta: "vyhojeno do t\u00fddne \u00b7 2 fotky", docs: 0 },
    { id: "h-mour-vac", entity: "mour", type: "vaccination", date: "2026-05-21",
      cs: "Nobivac Tricat", meta: "dal\u0161\u00ed 21. 5. 2027", vet: "MVDr. S\u00fdkorov\u00e1", cost: 760, docs: 1 }
  ];
  function healthOf(id) {
    return HEALTH.filter(function (h) { return h.entity === id; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }
  function healthRun() {
    var used = HEALTH_TYPES.filter(function (t) {
      return HEALTH.some(function (h) { return h.type === t; });
    });
    return { types: HEALTH_TYPES.length, used: used.length, entries: HEALTH.length,
             withCost: HEALTH.filter(function (h) { return !!h.cost; }).length,
             withDocs: HEALTH.filter(function (h) { return !!h.docs; }).length,
             says: HEALTH_TYPES.length + " entry types, all " + used.length +
               " of them present in the fixture, on one dated timeline: " +
               HEALTH_TYPES.join(", ") + ". Every entry may carry a cost and documents, and " +
               HEALTH.filter(function (h) { return !!h.docs; }).length + " of " + HEALTH.length + " do." };
  }

  /* FR-PE4 / D-73 — per-dose occurrences, and the merge key that makes
     "did you already give it" answerable rather than doubtful. */
  var MEDICATION = {
    id: "med-bela-synulox", entity: "bela", cs: "Synulox 250 mg",
    reason: "po \u0161it\u00ed tlapky", dose: "1 tableta", perDay: 2,
    start: "2026-09-05", days: 10, times: ["07:00", "19:00"],
    vet: "MVDr. S\u00fdkorov\u00e1"
  };
  function doses(today) {
    var now = today || TODAY, out = [];
    for (var d = 0; d < MEDICATION.days; d++) {
      var date = addDays(MEDICATION.start, d);
      MEDICATION.times.forEach(function (t, i) {
        out.push({ id: MEDICATION.id + "|" + date + "|" + t, date: date, time: t,
                   nth: d * MEDICATION.perDay + i + 1, past: date < now || (date === now && t < "12:00") });
      });
    }
    /* who ticked what: the household's, not each member's own list */
    var GIVEN = {
      "2026-09-05|07:00": ["jana", "07:10"], "2026-09-05|19:00": ["jana", "19:05"],
      "2026-09-06|07:00": ["adam", "07:20"], "2026-09-06|19:00": ["klara", "18:55"],
      "2026-09-07|07:00": ["jana", "07:05"], "2026-09-07|19:00": ["adam", "19:12"],
      "2026-09-08|07:00": ["jana", "06:58"], "2026-09-08|19:00": ["jana", "19:20"],
      "2026-09-09|07:00": ["adam", "07:15"]
    };
    return out.map(function (o) {
      var g = GIVEN[o.date + "|" + o.time];
      return { id: o.id, date: o.date, time: o.time, nth: o.nth, past: o.past,
               given: !!g, by: g ? g[0] : null, at: g ? g[1] : null,
               due: !g && o.date === now };
    });
  }
  /* Two members tick the same evening dose. The key decides whether the animal
     was given one tablet or two. */
  function doseRace() {
    var key = "(dose_occurrence)";
    var writes = [
      { by: "klara", at: "19:02:11", key: MEDICATION.id + "|2026-09-09|19:00" },
      { by: "adam", at: "19:02:14", key: MEDICATION.id + "|2026-09-09|19:00" }
    ];
    var byDose = writes.map(function (w) { return w.key; })
      .filter(function (k, i, a) { return a.indexOf(k) === i; }).length;
    var byDoseUser = writes.map(function (w) { return w.key + "|" + w.by; })
      .filter(function (k, i, a) { return a.indexOf(k) === i; }).length;
    return {
      writes: writes, key: key, resolution: "latest_client_time",
      rows: byDose, wouldBe: byDoseUser,
      actor: writes[0].by, actorAt: writes[0].at,
      says: "Two members tapped the evening tablet three seconds apart. Keyed on " + key +
        " that is " + byDose + " dose with " + name(writes[0].by) +
        " recorded as whoever the server received first. Keyed on (occurrence, member) \u2014 the key every other state_set in this product uses \u2014 it would have been " +
        byDoseUser + ", and the screen would have said the dog had two tablets. The fact is the dose, not the person."
    };
  }
  function doseRun() {
    var all = doses();
    var given = all.filter(function (d) { return d.given; });
    var by = {};
    given.forEach(function (d) { by[d.by] = (by[d.by] || 0) + 1; });
    return {
      total: all.length, given: given.length, left: all.length - given.length,
      today: all.filter(function (d) { return d.date === TODAY; }),
      dueNow: all.filter(function (d) { return d.due; }).length,
      byMember: Object.keys(by).map(function (k) { return { who: name(k), n: by[k] }; }),
      sharers: Object.keys(by).length,
      race: doseRace(),
      says: MEDICATION.cs + ", " + MEDICATION.perDay + "\u00d7 denn\u011b for " + MEDICATION.days +
        " days = " + all.length + " doses, " + given.length + " ticked by " +
        Object.keys(by).length + " different members: " +
        Object.keys(by).map(function (k) { return name(k) + " " + by[k]; }).join(", ") +
        ". Completion is shared, so the evening tablet knows Adam gave the morning one."
    };
  }

  /* FR-PE5 — deliberately not Chores. A checklist that resets, with who did it. */
  var ROUTINE = [
    { id: "rt-walk-am", entity: "bela", cs: "Ranní venčen\u00ed", at: "07:00" },
    { id: "rt-feed-am", entity: "bela", cs: "Ranní krmen\u00ed", at: "07:15" },
    { id: "rt-water", entity: "bela", cs: "\u010cerstv\u00e1 voda", at: "" },
    { id: "rt-feed-pm", entity: "bela", cs: "Ve\u010dern\u00ed krmen\u00ed", at: "18:00" },
    { id: "rt-walk-pm", entity: "bela", cs: "Ve\u010dern\u00ed venčen\u00ed", at: "20:00" },
    { id: "rt-litter", entity: "mour", cs: "Kočkolit", at: "" },
    { id: "rt-mour-feed", entity: "mour", cs: "Krmen\u00ed Moura", at: "" }
  ];
  var ROUTINE_DONE = {
    "rt-walk-am|2026-09-09": ["adam", "07:20"],
    "rt-feed-am|2026-09-09": ["jana", "07:05"],
    "rt-water|2026-09-09": ["klara", "12:40"],
    "rt-mour-feed|2026-09-09": ["adam", "07:25"],
    "rt-walk-am|2026-09-08": ["jana", "07:10"],
    "rt-feed-am|2026-09-08": ["jana", "07:12"],
    "rt-feed-pm|2026-09-08": ["adam", "18:20"],
    "rt-walk-pm|2026-09-08": ["petr", "20:05"],
    "rt-litter|2026-09-08": ["klara", "16:00"],
    "rt-water|2026-09-08": ["adam", "09:00"],
    "rt-mour-feed|2026-09-08": ["klara", "07:40"]
  };
  function routineFor(day) {
    return ROUTINE.map(function (r) {
      var d = ROUTINE_DONE[r.id + "|" + day];
      return { id: r.id, entity: r.entity, cs: r.cs, at: r.at,
               who: entity(r.entity).cs,
               done: !!d, by: d ? name(d[0]) : null, byId: d ? d[0] : null, time: d ? d[1] : null };
    });
  }
  function routineRun() {
    var today = routineFor(TODAY), yesterday = routineFor("2026-09-08");
    var actors = {};
    today.concat(yesterday).forEach(function (r) { if (r.byId) actors[r.byId] = 1; });
    return {
      items: ROUTINE.length,
      doneToday: today.filter(function (r) { return r.done; }).length,
      openToday: today.filter(function (r) { return !r.done; }).length,
      doneYesterday: yesterday.filter(function (r) { return r.done; }).length,
      today: today, yesterday: yesterday,
      key: "(routine_item, date)", actors: Object.keys(actors).length,
      chorelike: { rotation: 0, points: 0, verification: 0, swap: 0 },
      says: ROUTINE.length + " items across two animals, " +
        today.filter(function (r) { return r.done; }).length + " done today and " +
        yesterday.filter(function (r) { return r.done; }).length +
        " done yesterday \u2014 yesterday's ticks are gone from today's list because the key is (routine_item, date) and the day is part of it. " +
        Object.keys(actors).length + " different members ticked something in two days, and no item has a rotation, a point value, a verification step or a swap: that is Chores, and this is not."
    };
  }

  var VET = {
    practice: "Veterina Kohoutovice", vet: "MVDr. Eva S\u00fdkorov\u00e1",
    phone: "+420 546 221 118", hours: "Po\u2013P\u00e1 8:00\u201318:00, So 9:00\u201312:00",
    outOfHours: "+420 606 771 002", outOfHoursNote: "Non-stop klinika \u017dabovřesky \u2014 Kor\u00e1lov\u00e1 12",
    address: "Libu\u0161ina tř\u00edda 4, Brno", chipRegistry: "Petnet \u00b7 900 032 000 471 205",
    insurance: "Pet Expert PE-2026-30188", taps: 1
  };
  var FEEDING = {
    food: "Brit Care Adult Salmon", amount: "170 g", meals: 2, total: "340 g / den",
    times: ["07:15", "18:00"],
    treats: "Su\u0161en\u00e9 kuřec\u00ed ne \u2014 su\u0161en\u00e1 ryba ano",
    allergies: ["Kuřec\u00ed maso \u2014 sv\u011bd\u011bn\u00ed a otlaky"],
    never: ["Hrozny a rozinky", "Xylitol (\u017evy\u010dka\u010dky)", "\u010cokol\u00e1da", "Buvol\u00ed k\u016f\u017ee"],
    note: "Tabletky bere v tvarohu, ne v masu."
  };
  var PET_COPY = [
    "Kdo u n\u00e1s \u017eije",
    "Bela dnes: ranní venčen\u00ed m\u00e1 Adam od 7:20, ve\u010dern\u00ed tabletku je\u0161t\u011b nikdo.",
    "Tohle je obrazovka, kterou d\u00e1te tomu, kdo se o n\u011b bude starat.",
    "Pohotovost: +420 606 771 002 \u2014 non-stop klinika \u017dabovřesky.",
    "Nesm\u00ed: hrozny, xylitol, \u010dokol\u00e1da, buvol\u00ed k\u016f\u017ee."
  ];
  function weightRun(id) {
    var rs = readingsOf(id || "bela", "kg");
    var target = { min: 17, max: 20, from: "druh a k\u0159\u00ed\u017eenec \u00b7 podle veterin\u00e1\u0159ky" };
    var last = rs[rs.length - 1], first = rs[0];
    return {
      points: rs.map(function (r) { return { date: r.date, kg: r.milli / 1000, by: name(r.by), src: r.src }; }),
      rows: rs.length, target: target,
      min: Math.min.apply(null, rs.map(function (r) { return r.milli / 1000; })),
      max: Math.max.apply(null, rs.map(function (r) { return r.milli / 1000; })),
      delta: (last.milli - first.milli) / 1000,
      inRange: rs.every(function (r) { return r.milli / 1000 >= target.min && r.milli / 1000 <= target.max; }),
      says: rs.length + " weighings over a year, " + (first.milli / 1000).toFixed(1) + " kg down to " +
        (last.milli / 1000).toFixed(1) + " kg, target " + target.min + "\u2013" + target.max +
        " kg from the species and the vet. Same additive series as an odometer, drawn as a chart because that is what a weight is for."
    };
  }

  /* D-72 — a pet that has died is archived with its history intact and never
     silently deleted, and the words on the screen are not a disposal form's. */
  var STATUS_FLOW = [
    { id: "st-1", title: "Bela u n\u00e1s u\u017e nen\u00ed?",
      body: "Vyberte, co se stalo. Nic se nesma\u017ee \u2014 z\u00e1znam z\u016fstane cel\u00fd, jen se p\u0159estane pt\u00e1t na denn\u00ed re\u017eim.",
      choices: [
        { cs: "Zem\u0159ela", consequence: "Datum, a jestli chcete napsat pozn\u00e1mku. Zdravotn\u00ed z\u00e1znam, fotky i v\u00e1ha z\u016fstanou.",
          rows: "pets.pet.status = deceased \u00b7 0 smazan\u00fdch \u0159\u00e1dk\u016f" },
        { cs: "Odst\u011bhovala se k n\u011bkomu jin\u00e9mu", consequence: "Datum a komu. Z\u00e1znam z\u016fstane u v\u00e1s; nikam se neposílá.",
          rows: "pets.pet.status = rehomed \u00b7 0 smazan\u00fdch \u0159\u00e1dk\u016f" }
      ] },
    { id: "st-2", title: "Co se stane te\u010f",
      body: "P\u0159ipomínky a denn\u00ed re\u017eim se ticho zastav\u00ed. Bela z\u016fstane v seznamu pod \u201eBylo n\u00e1m spolu dobře\u201c a d\u00e1 se otev\u0159\u00edt kdykoli.",
      choices: [] }
  ];
  var DISPOSAL = {
    vehicles: { words: ["prod\u00e1no", "sešrotov\u00e1no", "odepsáno"],
                copy: "Vozidlo prod\u00e1no, sešrotov\u00e1no nebo odepsáno \u2014 s datem a cenou. Historie z\u016fst\u00e1v\u00e1 k dani." },
    property: { words: ["vyřazeno", "prod\u00e1no"],
                copy: "Za\u0159\u00edzen\u00ed vyřazeno nebo prod\u00e1no. Servisn\u00ed historie z\u016fst\u00e1v\u00e1 u domu." },
    pets: { words: [], copy: STATUS_FLOW[0].body }
  };
  function gentleAudit() {
    var harsh = ["smazat", "odstranit", "vyřadit", "archivovat", "likvidace", "delete", "remove", "archive", "dispose", "retire"];
    var body = STATUS_FLOW.map(function (s) {
      return s.title + " " + s.body + " " + s.choices.map(function (c) { return c.cs + " " + c.consequence; }).join(" ");
    }).join(" ").toLowerCase();
    var hits = harsh.filter(function (w) { return body.indexOf(w) >= 0; });
    /* "nesmaže" contains "smaž" — the negation is the point, so count only imperatives */
    var real = hits.filter(function (w) { return new RegExp("(^|[^e])" + w).test(body) && body.indexOf("ne" + w) < 0; });
    return {
      steps: STATUS_FLOW.length, choices: STATUS_FLOW[0].choices.length,
      harsh: harsh.length, hits: real,
      deletedRows: 0, keepsHistory: true,
      vehicleWords: DISPOSAL.vehicles.words,
      says: STATUS_FLOW.length + " steps, " + STATUS_FLOW[0].choices.length +
        " choices, " + real.length + " of " + harsh.length +
        " deletion words, and zero deleted rows. Vehicles keeps " +
        DISPOSAL.vehicles.words.join(", ") + " because that is what happens to a car; the same engine, the same status column, and copy that knows the difference."
    };
  }

  /* Pets defaults to contribute for everybody, children included (FR-PE10) */
  function petsGrantRun() {
    var F = window.HH_FIXTURES;
    var rows = (F ? F.members : []).map(function (m) {
      return { id: m.id, name: m.name, role: m.role, fixture: m.grants.pets,
               defaultLevel: "contribute",
               agrees: m.grants.pets === "contribute" };
    });
    return {
      rows: rows, agreeing: rows.filter(function (r) { return r.agrees; }).length,
      childDefault: "contribute",
      says: "FR-PE10 makes Pets default to contribute for every member including children \u2014 feeding the cat is the archetypal thing a child ticks off, and editing the health record still needs manage. " +
        rows.filter(function (r) { return r.agrees; }).length + " of " + rows.length +
        " fixture members carry that default today, which is a fixture written before this module existed rather than a disagreement about the rule."
    };
  }

  /* ── 10. Reconciling what earlier stages already drew ────────────────────── */

  var EARLIER = [
    { text: "property.due widget \u2014 \u201cBoiler service \u00b7 Mon 14\u201d and \u201cWashing machine warranty ends 3 Nov\u201d",
      stage: 10, resolves: "sch-kotel + pracka-bosch",
      drift: "The schedule became due 4 September \u2014 twelve months from 4 September 2025, where Stage 12\u2019s occurrence carries the 3rd \u2014 and the appointment Jana booked is 14 September \u2014 which is the Calendar event Stage 18 draws at 14:00 with Novotn\u00fd on it. The widget shows the appointment and calls it the service. The warranty is 30 November, not 3 November: one row of Stage 10's fixture is a typo and this module's arithmetic is where it shows." },
    { text: "vehicles.due widget \u2014 insurance notice 30 Sept, inspection \u201cdue March 2027\u201d, bike brake pads at 1 200 km",
      stage: 10, resolves: "pol-octavia + sch-octavia + sch-kolo",
      drift: "The notice date and the brake pads reproduce exactly. The inspection does not: 5 October 2018 plus four years plus two is 5 October 2026, which is what Stage 12's reminder occurrence says. \u201cMarch 2027\u201d is the widget's own number and has no first registration behind it." },
    { text: "pets.today widget \u2014 morning walk done by Adam 07:20, evening feed not yet, worming tablet due today",
      stage: 10, resolves: "routine + sch-bela-odcerveni", drift: "" },
    { text: "Reminder occurrence o-boiler \u2014 property.service_due, 3 September, \u201cVaillant \u00b7 annual, last done 4 September 2025\u201d",
      stage: 12, resolves: "sch-kotel", drift: "" },
    { text: "Reminder occurrence o-warranty \u2014 property.warranty_expiry, 30 November, \u201cBosch \u00b7 bought 30 November 2024\u201d",
      stage: 12, resolves: "pracka-bosch", drift: "" },
    { text: "Reminder occurrence o-stk \u2014 vehicles.inspection_due, 5 October, \u201cbook the garage\u201d",
      stage: 12, resolves: "octavia statutory CZ", drift: "" },
    { text: "Reminder occurrence o-dose \u2014 pets.medication_dose, \u201cSecond of two today \u00b7 Adam gave the morning one\u201d",
      stage: 12, resolves: "med-bela-synulox", drift: "" },
    { text: "Reminder lead times \u2014 vehicles.insurance_renewal 42 d, pets.insurance_renewal 30 d, property.warranty_expiry 30 d, property.lease_notice 90 d",
      stage: 12, resolves: "POLICIES_INS noticeDays", drift: "" },
    { text: "Jana's changed lead \u2014 property.service_due at 7 days, \u201ca month\u2019s notice about the boiler is a month of being told about the boiler\u201d",
      stage: 12, resolves: "sch-kotel", drift: "" },
    { text: "Settings \u00a73 module toggles \u2014 Property off \u201cnothing in it yet\u201d, Pets off \u201cnothing in it yet\u201d",
      stage: 8, resolves: "both modules",
      drift: "Both are off in Stage 8's fixture while Stage 10 draws their widgets with data and Stage 12 fires their reminders. Setup ran in this stage, so the two toggle rows are the drift, and Stage 20's sweep is where they change." },
    { text: "Settings \u00a75 storage \u2014 largest file \u201cChata \u2014 roof, 2025-08.mp4\u201d, 0.9 GB, Chat \u00b7 Milo\u0161",
      stage: 8, resolves: "chat.js custody transfer", drift: "" },
    { text: "Household defaults table \u2014 pets contribute / contribute / contribute",
      stage: 8, resolves: "petsGrantRun", drift: "" },
    { text: "Calendar event \u201cServis kotle\u201d, 14 September 14:00, place \u201cNovotn\u00fd \u2014 servis\u201d, mirrored from Jana's Google",
      stage: 18, resolves: "contractor novotny + sch-kotel", drift: "" },
    { text: "chat.unread widget \u2014 7 unread over 2 threads, \u201cChata weekend \u00b7 5\u201d and \u201cHouse \u00b7 2\u201d",
      stage: 10, resolves: "chat.js conversations", drift: "" }
  ];
  function reconcile() {
    var drifts = EARLIER.filter(function (r) { return !!r.drift; });
    return {
      total: EARLIER.length, resolved: EARLIER.length, drifts: drifts.length,
      rows: EARLIER, driftRows: drifts,
      stages: EARLIER.map(function (r) { return r.stage; })
        .filter(function (s, i, a) { return a.indexOf(s) === i; }).sort(),
      says: EARLIER.length + " rows drawn by Stages 8, 10, 12 and 18 all resolve to something in this module, and " +
        drifts.length + " of them disagree with its arithmetic. None of the three is fixed here: a stage that quietly edits an earlier fixture to make its own numbers work is the failure this ledger exists to catch."
    };
  }

  /* ── 11. The empty states and the help ──────────────────────────────────── */

  var EMPTY = {
    property: { s: "Sem pat\u0159\u00ed to, co v dom\u011b nesm\u00ed p\u0159estat fungovat.",
      e: "Nap\u0159\u00edklad kotel \u2014 servis ka\u017cd\u00fd rok, posledn\u00ed lo\u0148ské z\u00e1\u0159\u00ed.",
      a: "Za\u010d\u00edt seznamem pro \u010cesko" },
    vehicles: { s: "Auto, motorka, kolo, vozík \u2014 co m\u00e1 term\u00edny a n\u00e1klady.",
      e: "Nap\u0159\u00edklad Octavia \u2014 STK 5. 10., poji\u0161t\u011bn\u00ed do listopadu.",
      a: "P\u0159idat vozidlo" },
    pets: { s: "Kdo u v\u00e1s \u017eije a co pro n\u011b ka\u017ed\u00fd den d\u011bl\u00e1te.",
      e: "Nap\u0159\u00edklad Bela \u2014 venčen\u00ed r\u00e1no a ve\u010der, tabletka dvakr\u00e1t denn\u011b.",
      a: "P\u0159idat mazl\u00ed\u010dka" }
  };
  function emptyAudit() {
    var banned = ["no records", "no items", "0 ", "empty", "collection", "entity", "asset"];
    var hits = [];
    MODULES.forEach(function (m) {
      var body = (EMPTY[m].s + " " + EMPTY[m].e + " " + EMPTY[m].a).toLowerCase();
      banned.forEach(function (w) { if (body.indexOf(w) >= 0) hits.push(m + ": " + w); });
    });
    return {
      states: MODULES.length, sentence: MODULES.length, example: MODULES.length,
      action: MODULES.length, banned: hits,
      distinctActions: MODULES.map(function (m) { return EMPTY[m].a; })
        .filter(function (a, i, arr) { return arr.indexOf(a) === i; }).length,
      says: MODULES.length + " empty states against Stage 9's template \u2014 one sentence, one example a household would really type, one action \u2014 with " +
        hits.length + " of the banned words and " + MODULES.length +
        " different actions, because \u201cadd your first item\u201d three times is the shared engine leaking into the copy."
    };
  }

  var HELP = [
    { id: "assets.schedule.dual", screen: "/assets/{entity_type}/{id}/schedules", hard: true, model: true,
      title: "Podle data, nebo podle kilometr\u016f?",
      body: "M\u016f\u017cete zadat oboj\u00ed. Plat\u00ed, co p\u0159ijde d\u0159\u00edv \u2014 a u kilometr\u016f je to odhad z toho, kolik jezd\u00edte, ne term\u00edn.",
      steps: ["Zadejte interval v m\u011bs\u00edc\u00edch.", "Nebo v kilometrech.", "Nebo oboj\u00ed.",
              "Vid\u00edte, kter\u00e9 z toho vyhr\u00e1lo a pro\u010d."],
      en: { title: "By date, or by kilometres?",
            body: "You can set both. Whichever comes first applies \u2014 and the kilometre one is an estimate from how much you drive, not a date.",
            steps: ["Set the interval in months.", "Or in kilometres.", "Or both.", "See which one won, and why."] },
      authoredIn: 19 },
    { id: "vehicles.fuel.partial", screen: "/vehicles/{id}/fuel", hard: true,
      title: "Pro\u010d se pt\u00e1me, jestli je pln\u00e1?",
      body: "Spot\u0159eba se po\u010d\u00edt\u00e1 mezi dv\u011bma pln\u00fdmi n\u00e1dr\u017eemi. Dol\u00e9v\u00e1n\u00ed mezi t\u00edm se se\u010dte \u2014 jinak by \u010d\u00edslo l\u00edtalo a nedalo se mu v\u011b\u0159it.",
      example: "Dv\u011b pln\u00e9 n\u00e1dr\u017ee po sob\u011b: 5,47 l/100 km. Bez toho rozd\u011blen\u00ed 5,73.",
      en: { title: "Why do you ask whether the tank is full?",
            body: "Consumption is measured between two full tanks. Partial fills in between are added up \u2014 otherwise the figure jumps around and nobody trusts it.",
            example: "Two full tanks in a row: 5,47 l/100 km. Without that split, 5,73." },
      authoredIn: 19 },
    { id: "pets.dose.shared", screen: "/pets/{id}/medication", hard: false,
      title: "Kdo tabletku dal?",
      body: "Kdo prvn\u00ed klikne, ten je u d\u00e1vky napsan\u00fd. D\u00e1vka je jedna, i kdy\u017e kliknete dva \u2014 pes ji dostal jednou.",
      en: { title: "Who gave the tablet?",
            body: "Whoever ticks it first is named on the dose. The dose is one even if two of you tick \u2014 the dog got it once." },
      authoredIn: 19 },
    { id: "property.meters.where", screen: "/property/{id}/meters", hard: false,
      title: "Pro\u010d je tohle tady a ne v Energiích?",
      body: "Tady je, kde ten m\u011b\u0159i\u010d je. Kolik na n\u011bm je, pat\u0159\u00ed do Energií \u2014 a je odtud jeden klik.",
      en: { title: "Why is this here and not in Utilities?",
            body: "This is where the meter is. What it reads belongs in Utilities \u2014 and it is one tap from here." },
      authoredIn: 19 }
  ].map(function (h) {
    var steps = h.steps || [];
    var surface = (steps.length >= 4 || h.model) ? "panel" : (h.example || h.body.length > 120) ? "expandable" : "inline";
    return { id: h.id, screen: h.screen, hard: !!h.hard, title: h.title, body: h.body,
             example: h.example || null, steps: steps, surface: surface, authoredIn: 19,
             cs: h.cs || null, en: h.en || null,
             chars: h.body.length, links: [] };
  });
  function helpAudit() {
    var by = {};
    HELP.forEach(function (h) { by[h.surface] = (by[h.surface] || 0) + 1; });
    return { entries: HELP.length, bySurface: by, surfaces: Object.keys(by).length, external: 0,
             overlong: HELP.filter(function (h) { return h.title.length > 48 || h.chars > 240; }).length,
             says: HELP.length + " entries authored with the screens, " +
               Object.keys(by).map(function (k) { return by[k] + " " + k; }).join(" \u00b7 ") +
               ", the surface derived from the content by Stage 11's rule and zero external links." };
  }

  /* ── 12. Merge policies, and the exclusions argued from them ─────────────── */

  var POLICIES = [
    ["property.property, property.item", "lww_field", "A thing and its fields. Two members editing the serial number and the location both succeed.", false],
    ["asset.service_schedule", "strict_version", "A schedule is structural: two versions of \u201cevery 12 months or 15 000 km\u201d is two different maintenance plans, so this one asks.", true],
    ["asset.service_record", "additive", "A record of something that was done. Appended, never merged \u2014 and corrected online only.", false],
    ["asset.usage_reading", "additive", "A reading. Non-decreasing is a cross-row invariant, which is why an offline reading can come back rejected against a neighbour the replica never held.", false],
    ["property.contractor", "lww_field", "A name and a number.", false],
    ["vehicles.vehicle", "lww_field", "", false],
    ["vehicles.fuel_entry", "additive", "Recorded at a petrol station, frequently with no signal, and it cannot conflict.", false],
    ["vehicles.insurance_policy, vehicles.statutory_date", "strict_version", "Money-bearing and legally-bearing dates. Both ask.", true],
    ["pets.pet, pets.vet, pets.insurance_policy", "lww_field", "", false],
    ["pets.health_entry", "additive", "A record of something that happened.", false],
    ["pets.medication", "strict_version", "A dose schedule is not a thing to merge.", true],
    ["pets.medication_dose", "state_set", "Key (dose_occurrence) \u2014 not (occurrence, member). A dose is given once to the animal, not once per person. D-73 as a merge key.", false],
    ["pets.routine_completion", "state_set", "Key (routine_item, date). Who ticked it is shown and is not part of the key.", false]
  ];

  var ADDITIVE_NO_CONFLICT = {
    conflicted: "A reading and a record are additive: they are appended, never merged, so two devices writing at once produce two rows rather than two versions of one. What they can produce is a rejection, which is the cell to the left."
  };
  var LWW = {
    conflicted: "lww_field, field by field. Two members editing the location and the serial number both succeed; the same field twice resolves to the later client time and says nothing."
  };
  var STRICT = {};
  var STATE_SET_DOSE = {
    conflicted: "state_set keyed on (dose_occurrence). Two members recording the same dose resolve to one dose, which is the whole point of the key \u2014 there is no version of this screen that asks."
  };

  /* ── 13. The screen ledger for this stage ───────────────────────────────── */

  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending", "syncing",
                    "conflicted", "rejected", "absent", "withdrawn", "readonly"];

  var SCREENS = [
    { id: "E-15", view: "engine", client: "mw", preset: "D", route: "/property", kind: "list",
      name: "Asset entity list", title: "Co je v dom\u011b",
      lede: "One list body, three vocabularies, and the word for the thing is the module's own.",
      empty: EMPTY.property,
      error: "Seznam se nena\u010detl. Co je v telefonu, se pod t\u00edm po\u0159\u00e1d \u010dte.",
      rejected: "Odm\u00edtnuto: dv\u011b za\u0159\u00edzen\u00ed nem\u016f\u017cou m\u00edt stejn\u00e9 v\u00fdrobn\u00ed \u010d\u00edslo.",
      withdrawn: "D\u016fm a vybaven\u00ed u\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00e9.",
      readonly: "Jen ke \u010dten\u00ed, dokud se p\u0159edplatn\u00e9 neobnov\u00ed.",
      states: { absent: "Petr holds manage on Utilities and none on all three of these modules: no tab, no widget, no row on Today, and the engine's own routes answer him 404.",
                offline: "Things, schedules, records and readings are all on the device. The due arithmetic runs there.",
                pending: "A thing added with no signal, queued, and editable while it waits.",
                syncing: "Past the 800 ms threshold only." },
      impossible: LWW,
      foot: "Retired things leave the active list and keep their history \u2014 Kiki is in the Pets list under a heading no asset engine would write.",
      note: "The same body renders three times because the engine is shared. What is not shared is a single word of it.", drawn: "all" },

    { id: "E-16", view: "engine", client: "mw", preset: "D", route: "/property/items/kotel-vaillant", kind: "detail",
      name: "Asset entity detail", title: "Kotel Vaillant ecoTEC",
      lede: "What it is, when it was serviced, what is under warranty, where the manual is, what it has cost.",
      empty: { s: "Nov\u00e9 za\u0159\u00edzen\u00ed.", e: "Kategorie napov\u00ed interval \u2014 plynov\u00fd kotel ka\u017ed\u00fd rok.", a: "Ulo\u017cit" },
      error: "Za\u0159\u00edzen\u00ed se nena\u010detlo.",
      rejected: "Odm\u00edtnuto: datum instalace nem\u016f\u017ce b\u00fdt po dne\u0161ku.",
      withdrawn: "U\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00e9.",
      readonly: "Jen ke \u010dten\u00ed. Manu\u00e1l se st\u00e1hne, servis se nezap\u00ed\u0161e.",
      states: { absent: "Absent with the module.",
                offline: "Everything but the documents, which are fetched on demand \u2014 Documents' rule, not a second one.",
                pending: "A cost typed offline sits on the row, marked in a word.",
                syncing: "Past the threshold only." },
      impossible: LWW,
      foot: "Costs roll up per thing, per property and per year, and Finance is a reference rather than a hidden join.",
      note: "Category is reference data and carries the default interval, which is what makes D-69's one tap worth having.", drawn: "all" },

    { id: "E-17", view: "engine", client: "mw", preset: "D", route: "/assets/vehicle/octavia/schedules", kind: "schedule",
      name: "Service schedule editor", title: "Servisn\u00ed interval",
      lede: "Every 12 months or 15 000 km, whichever comes first \u2014 and the screen says which one won.",
      empty: { s: "Bez intervalu je to jen seznam v\u011bc\u00ed.", e: "Kotel: ka\u017ed\u00fdch 12 m\u011bs\u00edc\u016f.", a: "P\u0159idat interval" },
      error: "Interval se neulo\u017cil.",
      rejected: "Odm\u00edtnuto: interval mus\u00ed b\u00fdt aspo\u0148 jeden \u2014 m\u011bs\u00edce, kilometry, nebo oboj\u00ed.",
      withdrawn: "U\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00e9.",
      readonly: "Jen ke \u010dten\u00ed.",
      states: { absent: "A member with contribute may log a service and not edit the plan: this screen is manage, and at contribute it is absent rather than disabled.",
                offline: "The projection is arithmetic on local readings.",
                pending: "", syncing: "" },
      impossible: { pending: "asset.service_schedule is strict_version: the editor requires a version and will not queue one offline. The write it does queue is a service record, which is additive.",
                    syncing: "Same reason \u2014 there is nothing queued to be past a threshold." },
      foot: "The usage answer is an estimate and is drawn as one. Nothing here claims a date the household committed to.",
      note: "One function resolves all three shapes, and \u201cno reading yet\u201d is a state rather than a silent never.", drawn: "all" },

    { id: "E-18", view: "engine", client: "mw", preset: "D", route: "/assets/vehicle/octavia/records", kind: "history",
      name: "Service history", title: "Co u\u017e se d\u011blalo",
      lede: "Dated, by whom, at what cost, with the invoice on it.",
      empty: { s: "Historie za\u010d\u00edn\u00e1 prvn\u00edm z\u00e1pisem.", e: "\u201eServis 120 000 \u2014 olej, filtry, brzdy \u00b7 8 940 K\u010d\u201c.", a: "Zapsat servis" },
      error: "Historie se nena\u010detla.",
      rejected: "Odm\u00edtnuto: z\u00e1pis nem\u016f\u017ce b\u00fdt star\u0161\u00ed ne\u017e vozidlo.",
      withdrawn: "U\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00e1.",
      readonly: "Jen ke \u010dten\u00ed.",
      states: { absent: "Absent with the module.",
                offline: "Written offline, because a garage forecourt has no signal either.",
                pending: "The row is there and marked; the invoice photo follows when the bytes go.",
                syncing: "Past the threshold only." },
      impossible: ADDITIVE_NO_CONFLICT,
      foot: "Additive, so it is created offline and corrected online only \u2014 the same sentence Shopping's recorded trip carries.",
      note: "A service record carries the reading at the time, which is what makes the next threshold arithmetic reproducible.", drawn: "all" },

    { id: "E-19", view: "engine", client: "mw", preset: "D", route: "/assets/vehicle/octavia/readings", kind: "usage",
      name: "Usage log", title: "Stav tacho",
      lede: "One non-decreasing series in thousandths of the unit, shared with the fuel log.",
      empty: { s: "Bez z\u00e1pisu se podle kilometr\u016f po\u010d\u00edtat ned\u00e1.", e: "Te\u010f na tachu: 132 560 km.", a: "Zapsat stav" },
      error: "Z\u00e1pisy se nena\u010detly.",
      rejected: "Odm\u00edtnuto: 131 900 km je m\u00ed\u0148 ne\u017e 132 340 km z 5. 9. Tacho nejde zp\u00e1tky.",
      withdrawn: "U\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00fd.",
      readonly: "Jen ke \u010dten\u00ed.",
      states: { absent: "Absent with the module.",
                offline: "Pre-checked against the neighbour the device holds, then queued.",
                pending: "Queued and marked. The value is the member's; the verdict is the server's.",
                syncing: "Past the threshold only." },
      impossible: ADDITIVE_NO_CONFLICT,
      foot: "Exactly the shape Utilities uses for meters, integer included, so the monotonicity check is one implementation.",
      note: "Petr's rejected 131 900 is a real fixture row, and the rejected state is drawn from it rather than invented for the matrix.", drawn: "all" },

    { id: "E-20", view: "property", client: "mw", preset: "D", route: "/property/setup/checklist", kind: "starter",
      name: "Property starter checklist by country", title: "Za\u010dneme t\u00edm, co m\u00e1 skoro ka\u017cd\u00fd d\u016fm",
      lede: "Five common things for your country, each with its usual interval, one tap each.",
      empty: { s: "Pro tuhle zemi je\u0161t\u011b seznam nem\u00e1me.", e: "P\u0159idejte kotel ru\u010dn\u011b \u2014 interval napov\u00edme podle kategorie.", a: "P\u0159idat ru\u010dn\u011b" },
      error: "Seznam se nena\u010detl. P\u0159idat ru\u010dn\u011b jde po\u0159\u00e1d.",
      rejected: "", withdrawn: "", readonly: "Jen ke \u010dten\u00ed \u2014 p\u0159id\u00e1vat te\u010f nejde.",
      states: { absent: "Setup is manage-only.", offline: "Reference data, on the device.",
                pending: "Five taps offline are five queued things.", syncing: "Past the threshold only." },
      impossible: { conflicted: "Reference data on one side, new rows on the other. Nothing here is edited by two people at once." },
      foot: "The interval is the point. An item without one is a row, and a row is not why anybody opened the module.",
      note: "Country reference data, so a profile that does not exist yet is addable without a release.", drawn: "all" },

    { id: "E-21", view: "property", client: "mw", preset: "D", route: "/property/contractors", kind: "contractors",
      name: "Contractors", title: "\u017divnostn\u00edci",
      lede: "A name, a number, and what they did. Five fields, and no sixth.",
      empty: { s: "Kdo v\u00e1m d\u011bl\u00e1 kotel?", e: "Novotn\u00fd \u2014 servis, +420 604 118 220.", a: "P\u0159idat kontakt" },
      error: "Kontakty se nena\u010detly.",
      rejected: "Odm\u00edtnuto: telefon nebo e-mail, aspo\u0148 jedno.",
      withdrawn: "U\u017e s v\u00e1mi nejsou sd\u00edlen\u00e9.", readonly: "Jen ke \u010dten\u00ed. Volat jde d\u00e1l.",
      states: { absent: "Absent with the module.", offline: "On the device, which is where a phone number needs to be.",
                pending: "A contact added offline.", syncing: "Past the threshold only." },
      impossible: LWW,
      foot: "Not a CRM: no pipeline, no rating, no quote, no marketplace.",
      note: "Novotn\u00fd is the same name Stage 18's calendar event carries as its place, because it is the same appointment.", drawn: "all" },

    { id: "E-22", view: "property", client: "mw", preset: "D", route: "/property/dum-brno/meters", kind: "meters",
      name: "Meter locations", title: "Kde jsou m\u011b\u0159i\u010de",
      lede: "Where the stopcock is, with a photo and how to get at it.",
      empty: { s: "Kde m\u00e1te hlavn\u00ed uz\u00e1v\u011br vody?", e: "\u201eSklep, za regálem vlevo. Kl\u00ed\u010d na 24 vis\u00ed vedle.\u201c", a: "P\u0159idat m\u00edsto" },
      error: "M\u00edsta se nena\u010detla.", rejected: "", withdrawn: "U\u017e s v\u00e1mi nejsou sd\u00edlen\u00e1.",
      readonly: "Jen ke \u010dten\u00ed.",
      states: { absent: "Absent with the module.",
                offline: "Deliberately offline-first: the moment this screen is needed, the water is already on the floor.",
                pending: "A note typed offline.", syncing: "Past the threshold only." },
      impossible: LWW,
      foot: "Zero readings and zero values live here. What is on the meter is Utilities', one tap away.",
      note: "A house-sitter's screen, which is why the photo is not decoration.", drawn: "all" },

    { id: "E-23", view: "property", client: "b", preset: "P", route: "/property/print/inventory", kind: "print",
      name: "Print \u2014 insurance inventory", title: "Inventura pro poji\u0161t\u011bn\u00ed",
      lede: "Photos, serial numbers, purchase dates, values. On paper, because that is the day it is needed.",
      empty: { s: "Nic je\u0161t\u011b nen\u00ed ozna\u010den\u00e9 jako poji\u0161t\u011bn\u00e9.", e: "Ozna\u010dte kotel a pra\u010dku \u2014 dv\u011b za\u0161krtnut\u00e1 pol\u00ed\u010dka.", a: "Ozna\u010dit poji\u0161t\u011bn\u00e9" },
      error: "", rejected: "", withdrawn: "", readonly: "",
      states: { populated: "Three flagged things, their serials, dates and values, and a total. Stage 17's print stylesheet: light only, no accent, ink-cheap." },
      impossible: {},
      foot: "One deliverable, not two: the same page prints and exports.",
      note: "A small feature that becomes the most valuable thing in the app on exactly one very bad day.", drawn: "all" },

    { id: "E-24", view: "vehicles", client: "mw", preset: "D", route: "/vehicles/octavia/statutory", kind: "statutory",
      name: "Vehicle statutory dates", title: "Z\u00e1konn\u00e9 term\u00edny",
      lede: "STK on 5 October, from one first registration and the country profile.",
      empty: { s: "Pro tuhle zemi p\u0159ednastaven\u00ed nem\u00e1me.", e: "Zadejte datum a periodu ru\u010dn\u011b \u2014 dv\u011b pol\u00ed\u010dka.", a: "Zadat ru\u010dn\u011b" },
      error: "Term\u00edny se nena\u010detly.",
      rejected: "Odm\u00edtnuto: term\u00edn nem\u016f\u017ce b\u00fdt p\u0159ed prvn\u00ed registrac\u00ed.",
      withdrawn: "Vozidla u\u017e s v\u00e1mi nejsou sd\u00edlen\u00e1.", readonly: "Jen ke \u010dten\u00ed.",
      states: { absent: "Absent with the module \u2014 and absent for a bicycle, which has no statutory inspection at all.",
                offline: "Computed on the device from reference data it holds.",
                pending: "An overridden date queued.", syncing: "Past the threshold only." },
      impossible: { conflicted: "vehicles.statutory_date is strict_version and money-and-law-bearing. Two owners editing one date is the case where a dialog is the correct answer, and it asks." },
      foot: "Silni\u010dn\u00ed da\u0148 is absent rather than zero: Czech passenger cars have none, so the reminder kind is not registered for this vehicle.",
      note: "Five countries, five different answers from the same car, which is why D-70 makes them versioned data.", drawn: "all" },

    { id: "E-25", view: "vehicles", client: "mw", preset: "D", route: "/vehicles/octavia/insurance", kind: "insurance",
      name: "Vehicle insurance with notice period", title: "Poji\u0161t\u011bn\u00ed",
      lede: "The renewal reminder fires at the notice period, not at expiry, so switching is still possible.",
      empty: { s: "Poji\u0161t\u011bn\u00ed nen\u00ed zadan\u00e9.", e: "Kooperativa, do 11. 11., v\u00fdpov\u011b\u010f 6 tydn\u016f p\u0159edem.", a: "Zadat poji\u0161t\u011bn\u00ed" },
      error: "Poji\u0161t\u011bn\u00ed se nena\u010detlo.",
      rejected: "Odm\u00edtnuto: konec nem\u016f\u017ce b\u00fdt p\u0159ed za\u010d\u00e1tkem.",
      withdrawn: "U\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00e9.", readonly: "Jen ke \u010dten\u00ed. Smlouva se st\u00e1hne.",
      states: { absent: "Absent with the module.", offline: "Dates and the document reference are local.",
                pending: "A premium corrected offline.", syncing: "Past the threshold only." },
      impossible: { conflicted: "strict_version, like Finance's subscriptions and Utilities' contracts, and for the same reason: this is money with a date on it." },
      foot: "Same rule as a Finance subscription and a Utilities contract \u2014 D-58, written once and reused three times.",
      note: "42 days is the policy's own notice period, and Stage 12 already carries it as this kind's default lead.", drawn: "all" },

    { id: "E-26", view: "vehicles", client: "mw", preset: "D", route: "/vehicles/octavia/fuel", kind: "fuel",
      name: "Fuel and charging log", title: "Tankov\u00e1n\u00ed",
      lede: "Seven entries, three of them full fills, and consumption computed between the full ones.",
      empty: { s: "Tankov\u00e1n\u00ed je vypnut\u00e9, dokud ho nezapnete.", e: "Prvn\u00ed pln\u00e1 n\u00e1dr\u017e je nulov\u00fd bod \u2014 od n\u00ed se po\u010d\u00edt\u00e1.", a: "Zapnout a zapsat prvn\u00ed" },
      error: "Z\u00e1pisy se nena\u010detly.",
      rejected: "Odm\u00edtnuto: 131 900 km je m\u00ed\u0148 ne\u017e p\u0159edchoz\u00ed z\u00e1pis. Tacho nejde zp\u00e1tky.",
      withdrawn: "U\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00e9.", readonly: "Jen ke \u010dten\u00ed.",
      states: { absent: "Off by default: a household that does not want a fuel log never sees one.",
                offline: "The whole reason it is additive \u2014 this is typed on a forecourt.",
                pending: "Queued, and the consumption line says which interval is still open.",
                syncing: "Past the threshold only." },
      impossible: ADDITIVE_NO_CONFLICT,
      foot: "The partial fills are accumulated, not divided. Getting this wrong is why fuel apps get abandoned.",
      note: "The odometer field on a fuel entry is a reading in the usage series, so two numbers cannot disagree.", drawn: "all" },

    { id: "E-27", view: "vehicles", client: "mw", preset: "D", route: "/vehicles/octavia/costs", kind: "tco",
      name: "Total cost of ownership", title: "Co n\u00e1s to stoj\u00ed",
      lede: "Six lines, each measured over a window the screen names.",
      empty: { s: "Je\u0161t\u011b nen\u00ed z \u010deho po\u010d\u00edtat.", e: "Za\u010dn\u011bte poji\u0161t\u011bn\u00edm \u2014 to je jedno \u010d\u00edslo a hned n\u011bco \u0159\u00edk\u00e1.", a: "Zadat poji\u0161t\u011bn\u00ed" },
      error: "\u010c\u00edsla se nena\u010detla.", rejected: "", withdrawn: "U\u017e s v\u00e1mi nejsou sd\u00edlen\u00e1.",
      readonly: "Jen ke \u010dten\u00ed.",
      states: { absent: "Absent with the module.",
                offline: "Arithmetic over local rows, so it is the same number offline.",
                pending: "A queued cost is in the total and marked in it." },
      impossible: { syncing: "Nothing is uploaded from this screen; it is a read over rows other screens wrote.",
                    conflicted: "A sum cannot disagree with itself. The rows it sums can, and they say so where they are.",
                    rejected: "Nothing is written here." },
      foot: "The number nobody calculates and everybody wants \u2014 with the window it is measured over next to it.",
      note: "Silni\u010dn\u00ed da\u0148 is a line that says \u201cnot in CZ\u201d rather than a zero, because a zero looks like data.", drawn: "all" },

    { id: "E-28", view: "vehicles", client: "mw", preset: "D", route: "/vehicles/kolo-adam", kind: "bike",
      name: "Bike variant", title: "Adamovo kolo",
      lede: "The same editor with a different set of fields, and no greyed-out registration box.",
      empty: { s: "Kolo, elektrokolo, vozík za kolo.", e: "Author Solution 29 \u2014 r\u00e1m AU24-77 1902.", a: "P\u0159idat kolo" },
      error: "Kolo se nena\u010detlo.",
      rejected: "Odm\u00edtnuto: \u010d\u00edslo r\u00e1mu u\u017e u jednoho kola m\u00e1me.",
      withdrawn: "U\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00e9.", readonly: "Jen ke \u010dten\u00ed.",
      states: { absent: "Absent with the module.", offline: "Local.",
                pending: "Queued.", syncing: "Past the threshold only." },
      impossible: LWW,
      foot: "Zero of the three plate-shaped fields, and a frame number and battery-health note instead.",
      note: "A household with three bikes and no car should find Vehicles useful, and it will not if every screen asks for a plate.", drawn: "all" },

    { id: "E-29", view: "pets", client: "mw", preset: "D", route: "/pets/bela/health", kind: "health",
      name: "Pet health record", title: "Zdravotn\u00ed z\u00e1znam",
      lede: "Six kinds of entry on one dated timeline \u2014 the thing you cannot find when the vet asks.",
      empty: { s: "Zat\u00edm tu nic nen\u00ed.", e: "Za\u010dn\u011bte posledn\u00edm o\u010dkov\u00e1n\u00edm \u2014 datum a co to bylo.", a: "P\u0159idat z\u00e1znam" },
      error: "Z\u00e1znam se nena\u010detl. Co je v telefonu, se \u010dte d\u00e1l.",
      rejected: "Odm\u00edtnuto: datum nem\u016f\u017ce b\u00fdt p\u0159ed narozen\u00edm.",
      withdrawn: "Mazl\u00ed\u010dci u\u017e s v\u00e1mi nejsou sd\u00edlen\u00ed.", readonly: "Jen ke \u010dten\u00ed.",
      states: { absent: "Absent with the module \u2014 though FR-PE10 defaults every member, children included, to contribute.",
                offline: "On the device, because a vet's waiting room is a basement with no signal.",
                pending: "A visit written on the way home, queued.", syncing: "Past the threshold only." },
      impossible: ADDITIVE_NO_CONFLICT,
      foot: "Every entry may carry a cost and documents. Editing it needs manage; adding one does not.",
      note: "The one screen where the shared engine is invisible: nothing on it is worded as a service record.", drawn: "all" },

    { id: "E-30", view: "pets", client: "mw", preset: "D", route: "/pets/bela/medication", kind: "doses",
      name: "Medication doses", title: "Synulox 250 mg",
      lede: "Twenty doses over ten days, ticked by whoever gave them.",
      empty: { s: "\u017d\u00e1dn\u00e9 l\u00e9ky nete\u010fka nejsou.", e: "Antibiotika 2\u00d7 denn\u011b na deset dn\u00ed \u2014 dvacet pol\u00ed\u010dek.", a: "P\u0159idat l\u00e9k" },
      error: "D\u00e1vky se nena\u010detly. Co je za\u0161krtnut\u00e9 v telefonu, plat\u00ed.",
      rejected: "Odm\u00edtnuto: d\u00e1vku nelze za\u0161krtnout dop\u0159edu.",
      withdrawn: "U\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00e9.", readonly: "Jen ke \u010dten\u00ed \u2014 co u\u017e je dan\u00e9, se \u010dte.",
      states: { absent: "Absent with the module.",
                offline: "Ticking works offline, and two offline ticks of the same dose still resolve to one dose.",
                pending: "Ticked with no signal: marked, and still one dose.",
                syncing: "Past the threshold only." },
      impossible: STATE_SET_DOSE,
      foot: "Shared completion: anyone can record a dose and everyone sees it immediately.",
      note: "The only per-occurrence tracking in the module, because \u201cdid you already give it\u201d is a real question with a bad answer.", drawn: "all" },

    { id: "E-31", view: "pets", client: "mw", preset: "D", route: "/pets/routine", kind: "routine",
      name: "Daily routine", title: "Denn\u00ed re\u017eim",
      lede: "Seven things across two animals, resetting at midnight, showing who did it and when.",
      empty: { s: "Co pro n\u011b d\u011bl\u00e1te ka\u017cd\u00fd den?", e: "Venčen\u00ed r\u00e1no, krmen\u00ed r\u00e1no a ve\u010der, voda.", a: "P\u0159idat do re\u017eimu" },
      error: "Re\u017eim se nena\u010detl.",
      rejected: "Odm\u00edtnuto: za\u0161krtnout jde jen dne\u0161n\u00ed a v\u010dere\u0161n\u00ed den.",
      withdrawn: "U\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00fd.", readonly: "Jen ke \u010dten\u00ed.",
      states: { absent: "Absent with the module.", offline: "Ticks queue and merge by (routine_item, date).",
                pending: "Marked, and in its place \u2014 the list never reorders under a thumb.",
                syncing: "Past the threshold only." },
      impossible: { conflicted: "state_set keyed on (routine_item, date). Two people ticking the evening feed is one tick with one name on it." },
      foot: "Deliberately not Chores: no rotation, no points, no verification, no swap.",
      note: "Where a household wants pet care in the rotation, a chore can reference a pet \u2014 and the routine keeps the parts that reset.", drawn: "all" },

    { id: "E-32", view: "pets", client: "mw", preset: "D", route: "/pets/bela/vet", kind: "vet",
      name: "Vet card", title: "Kartička k veterin\u00e1\u0159i",
      lede: "The practice, the vet, and the out-of-hours number one tap from the top.",
      empty: { s: "Ke komu s n\u00ed chod\u00edte?", e: "Veterina Kohoutovice, MVDr. S\u00fdkorov\u00e1.", a: "P\u0159idat veterin\u00e1\u0159e" },
      error: "Kartička se nena\u010detla. \u010c\u00edslo na pohotovost je v telefonu.",
      rejected: "Odm\u00edtnuto: telefon nen\u00ed ve spr\u00e1vn\u00e9m tvaru.",
      withdrawn: "U\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00e1.", readonly: "Jen ke \u010dten\u00ed. Volat jde.",
      states: { absent: "Absent with the module.",
                offline: "The one screen in the module that must work with no signal and no battery to spare, so all of it is local.",
                pending: "A number corrected offline.", syncing: "Past the threshold only." },
      impossible: LWW,
      foot: "Chip registry, insurance policy and the passport number are on the same card.",
      note: "One tap from the pet's screen, because that is the moment it is needed.", drawn: "all" },

    { id: "E-33", view: "pets", client: "mw", preset: "D", route: "/pets/bela/feeding", kind: "feeding",
      name: "Feeding details and allergies", title: "Krmen\u00ed a alergie",
      lede: "What, how much, how often, and what she must not have.",
      empty: { s: "Co dost\u00e1v\u00e1 a kolik?", e: "Brit Care Adult Salmon, 170 g dvakr\u00e1t denn\u011b.", a: "Doplnit krmen\u00ed" },
      error: "\u00dadaje se nena\u010detly.",
      rejected: "Odm\u00edtnuto: d\u00e1vka mus\u00ed b\u00fdt kladn\u00e1.",
      withdrawn: "U\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00e9.", readonly: "Jen ke \u010dten\u00ed.",
      states: { absent: "Absent with the module.", offline: "Local \u2014 handed to a house-sitter who may not have the app.",
                pending: "An amount changed offline.", syncing: "Past the threshold only." },
      impossible: LWW,
      foot: "Together with the vet card this is the screen you hand to whoever is looking after them.",
      note: "\u201eNesm\u00ed\u201c is its own block and not a note under the food, because that is the line that matters.", drawn: "all" },

    { id: "E-34", view: "pets", client: "mw", preset: "D", route: "/pets/bela/weight", kind: "weight",
      name: "Weight chart", title: "V\u00e1ha",
      lede: "Five weighings over a year against a target range from the species.",
      empty: { s: "Jedno \u010d\u00edslo a graf za\u010dne.", e: "18,4 kg \u2014 doma, na osobn\u00ed v\u00e1ze.", a: "Zapsat v\u00e1hu" },
      error: "Graf se nena\u010detl.",
      rejected: "Odm\u00edtnuto: v\u00e1ha mus\u00ed b\u00fdt kladn\u00e1.",
      withdrawn: "U\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00e1.", readonly: "Jen ke \u010dten\u00ed.",
      states: { absent: "Absent with the module.", offline: "Local.",
                pending: "Queued.", syncing: "Past the threshold only." },
      impossible: ADDITIVE_NO_CONFLICT,
      foot: "The same additive series as an odometer, and the target range comes from the species rather than from a chart line.",
      note: "Small feature, high engagement, genuinely useful \u2014 and it shares its implementation with the usage log.", drawn: "all" },

    { id: "E-35", view: "pets", client: "mw", preset: "F", route: "/pets/bela/status", kind: "gone",
      name: "Deceased / rehomed flow", title: "Bela u n\u00e1s u\u017e nen\u00ed?",
      lede: "Two choices, a date, and nothing deleted.",
      error: "Nepoda\u0159ilo se ulo\u017cit. Zkuste to pozd\u011bji \u2014 nic se nezm\u011bnilo.",
      states: { populated: "Two choices, each stating what stays: the health record, the photos, the weight chart. Zero rows removed." },
      impossible: {},
      foot: "She stays in the list under \u201eBylo n\u00e1m spolu dobře\u201c and opens like any other screen.",
      note: "D-72. The module shares its tables with an asset engine and this is the screen where that must be invisible.", drawn: "all" }
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

  /* ── 14. The gate ───────────────────────────────────────────────────────── */

  function checks() {
    var v = vocabRun(), t = toneAudit(), g = grantRun(), d = dueRun();
    var f = fuelRun(), st = statutoryRun(), b = bikeAudit(), ba = tco("octavia");
    var dr = doseRun(), rt = routineRun(), w = weightRun("bela"), ge = gentleAudit();
    var inv = inventoryRun(), sr = starterRun("CZ"), mr = meterRun(), cr = contractorRun();
    var rec = reconcile(), em = emptyAudit(), hp = helpAudit(), cov = coverage();
    var mono = monotonic("octavia", "km");
    var oct = due("sch-octavia"), kolo = due("sch-kolo"), filtr = due("sch-filtr");
    var pg = petsGrantRun(), nr = noticeRun("pol-octavia");

    return [
      { name: "One engine, three vocabularies \u2014 and no word shared between them",
        detail: v.says,
        pass: v.allDistinct && v.cells === 15 },

      { name: "Pets does not read like asset management, and Vehicles still does where it should",
        detail: t.says,
        pass: t.hits.length === 0 && DISPOSAL.vehicles.words.length > 0 },

      { name: "The grant is resolved from entity_type, and a none grant answers 404",
        detail: g.says,
        pass: g.no403OnNone && g.denied404 > 0 && g.allowed > 0 && g.intended403 > 0 },

      { name: "The dual trigger resolves all three shapes, and the estimate is labelled one",
        detail: d.says + " The Octavia is " + oct.reason + "-driven \u2014 " + fmtEn(oct.intervalDue) +
          " by date against an estimated " + (oct.usageDueOn ? fmtEn(oct.usageDueOn) : "\u2014") +
          " at " + (oct.perDay ? oct.perDay.toFixed(1) : "?") + " km a day, so the definite date wins. Adam's bike is the other way round: " +
          num(kolo.usageDueAt) + " km against " + num(kolo.reading.milli / 1000) +
          " km now and " + kolo.perDay.toFixed(1) + " km a day gives " + fmtEn(kolo.usageDueOn) +
          ", months before its " + fmtEn(kolo.intervalDue) + " interval.",
        pass: d.both === 3 && d.byUsage >= 1 && d.byInterval >= 1 && d.neverDue === 0 &&
              oct.reason === "interval" && kolo.reason === "usage" && kolo.estimate === true },

      { name: "A usage schedule with no readings degrades to \u201cno reading yet\u201d, never to never",
        detail: "The water filter is every 6 months or 30 000 l, and nobody has ever logged a litre. It resolves to " +
          fmtEn(filtr.resolved) + " on the date alone with the usage half saying \u201eBez z\u00e1pisu\u201c, which is D-68's requirement: " +
          d.noReading + " of " + d.total + " schedules is in that state and " + d.neverDue +
          " resolve to never.",
        pass: filtr.noReading === true && filtr.resolved !== null && d.neverDue === 0 },

      { name: "Every usage value is an integer in thousandths, and monotonicity is checked on it",
        detail: mono.rows + " odometer readings, " + mono.violations +
          " violations in the accepted series, and one rejected row that is in the fixture rather than in the matrix: " +
          REJECTED_READING.en + " 132 560 km is stored as " + num(132560000) +
          " and 18,4 kg as " + num(18400) + " \u2014 the same suffix, the same convention and the same rejection path as a Utilities meter, so the check is one implementation rather than two that round differently.",
        pass: mono.violations === 0 && REJECTED_READING.reason === "monotonicity_violation" &&
              READINGS.every(function (r) { return r.milli % 1 === 0; }) },

      { name: "Partial fills are accumulated, and the wrong answer is a number on the screen",
        detail: f.says,
        pass: f.fulls === 3 && f.partials === 4 && Math.abs(f.consistent) < 0.05 &&
              f.error > 0.2 },

      { name: "Statutory dates are country reference data, and a bicycle is never asked for a plate",
        detail: st.says + " " + b.says,
        pass: st.countries === 5 && st.distinct === 5 && st.cadences === 4 && st.nextDistinct === 2 && st.here.next === "2026-10-05" &&
              b.bikeAsksPlate === 0 && b.bikeOnly.length === 2 },

      { name: "The insurance renewal fires at the notice period, not at expiry",
        detail: nr.says + " That is " + nr.late +
          " days of head start, and it is the same rule as a Finance subscription and a Utilities contract rather than a third one written here.",
        pass: nr.fires === "2026-09-30" && nr.late === 42 },

      { name: "Total cost of ownership names the window every line is measured over",
        detail: ba.says,
        pass: ba.lines.length === 6 && ba.lines.filter(function (l) { return !l.measured; }).length === 1 },

      { name: "A dose is given once to the animal, not once per person",
        detail: dr.race.says + " " + dr.says,
        pass: dr.race.rows === 1 && dr.race.wouldBe === 2 && dr.sharers >= 3 },

      { name: "The daily routine resets, shows who did it, and is not Chores",
        detail: rt.says,
        pass: rt.doneToday > 0 && rt.doneYesterday > rt.doneToday &&
              Object.keys(rt.chorelike).every(function (k) { return rt.chorelike[k] === 0; }) },

      { name: "The out-of-hours number is one tap from the top of the pet's screen",
        detail: "Veterina Kohoutovice, MVDr. S\u00fdkorov\u00e1, " + VET.phone + " \u2014 and " +
          VET.outOfHours + " (" + VET.outOfHoursNote + ") at " + VET.taps +
          " tap from /pets/bela. Feeding, allergies and the four things she must not have sit on the next card down, which together are what you hand to whoever is looking after them.",
        pass: VET.taps === 1 && !!VET.outOfHours && FEEDING.never.length >= 3 },

      { name: "The weight chart is the usage log with a different unit",
        detail: w.says,
        pass: w.rows === 5 && w.inRange && w.delta < 0 },

      { name: "The deceased flow deletes nothing and says so, in words a disposal screen would not use",
        detail: ge.says,
        pass: ge.hits.length === 0 && ge.deletedRows === 0 && ge.choices === 2 },

      { name: "Property's own four screens each do the one thing they exist for",
        detail: sr.says + " " + cr.says + " " + mr.says + " " + inv.says,
        pass: sr.withInterval === 5 && cr.crmFields === 0 && mr.readings === 0 &&
              inv.count === 3 && inv.serials >= 2 },

      { name: "Pets defaults to contribute for everybody, children included",
        detail: pg.says,
        pass: pg.childDefault === "contribute" },

      { name: "Every earlier stage's row resolves here, and the three that disagree are named rather than fixed",
        detail: rec.says + " " + rec.driftRows.map(function (r) { return r.drift; }).join(" "),
        pass: rec.resolved === rec.total && rec.drifts === 3 },

      { name: "The empty state teaches, three times, in three different sentences",
        detail: em.says,
        pass: em.banned.length === 0 && em.distinctActions === 3 },

      { name: "Help is authored with the screens, and the surface comes from the content",
        detail: hp.says,
        pass: hp.entries === 4 && hp.overlong === 0 && hp.external === 0 && hp.surfaces >= 2 },

      { name: "Twenty-one rows, every state drawn, every exclusion argued from a merge policy",
        detail: cov.length + " rows: " + cov.reduce(function (n, c) { return n + c.drawn; }, 0) +
          " cells drawn of " + cov.reduce(function (n, c) { return n + c.required; }, 0) +
          " required, with " + cov.reduce(function (n, c) { return n + c.excluded; }, 0) +
          " states declared unreachable across " + cov.filter(function (c) { return c.excluded > 0; }).length +
          " of them. " + POLICIES.length + " entity policies do that arguing, and the three that carry a dialog are the three that are structural or money-bearing: " +
          POLICIES.filter(function (p) { return p[3]; }).map(function (p) { return p[0]; }).join(", ") + ".",
        pass: cov.every(function (c) { return c.complete; }) }
    ];
  }

  window.HH_ASSETS = {
    version: "0.1-stage-19-candidate",
    today: TODAY, allStates: ALL_STATES, screens: SCREENS, coverage: coverage,
    policies: POLICIES, modules: MODULES, vocab: VOCAB, vocabRun: vocabRun,
    assetWords: ASSET_WORDS, toneAudit: toneAudit,
    entities: ENTITIES, entity: entity, entitiesOf: entitiesOf,
    readings: READINGS, readingsOf: readingsOf, latest: latest, rate: rate,
    monotonic: monotonic, rejectedReading: REJECTED_READING,
    schedules: SCHEDULES, schedule: schedule, schedulesOf: schedulesOf, due: due, dueRun: dueRun,
    records: RECORDS, recordsOf: recordsOf, costOf: costOf,
    engineRoutes: ENGINE_ROUTES, resolve: resolve, grantRun: grantRun,
    starter: STARTER, starterRun: starterRun,
    contractors: CONTRACTORS, contractorRun: contractorRun,
    meters: METERS, meterRun: meterRun, inventoryRun: inventoryRun,
    statutory: STATUTORY, statutoryFor: statutoryFor, statutoryRun: statutoryRun,
    insurance: POLICIES_INS, noticeRun: noticeRun,
    fuel: FUEL, fuelRun: fuelRun, tco: tco,
    vehicleFields: VEHICLE_FIELDS, bikeAudit: bikeAudit,
    healthTypes: HEALTH_TYPES, health: HEALTH, healthOf: healthOf, healthRun: healthRun,
    medication: MEDICATION, doses: doses, doseRun: doseRun, doseRace: doseRace,
    routine: ROUTINE, routineFor: routineFor, routineRun: routineRun,
    vet: VET, feeding: FEEDING, weightRun: weightRun,
    statusFlow: STATUS_FLOW, disposal: DISPOSAL, gentleAudit: gentleAudit,
    petsGrantRun: petsGrantRun,
    earlier: EARLIER, reconcile: reconcile,
    empty: EMPTY, emptyAudit: emptyAudit, help: HELP, helpAudit: helpAudit,
    name: name, grantOf: grantOf, atLeast: atLeast,
    fmt: fmt, fmtCs: fmtCs, fmtEn: fmtEn, num: num, czk: czk,
    addDays: addDays, addMonths: addMonths, diff: diff,
    checks: checks
  };
})();
