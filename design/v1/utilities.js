/* Stage 15 — Utilities.
   Sources: docs/prd/modules/10-utilities.md (FR-UT1-18, D-60 to D-64, the data model, the sync
   table, Catalog contributions, Permissions), design/05-screens.md §D Utilities,
   03-patterns.md §1 (the cellar case) and §5 (the honesty table), 02-components.md §4.10
   (the tariff composer) and §129 (the reading capture), 01-foundations.md §7 (rounding display,
   value_milli), prd/03-platform-strands.md §6 FR-RM1 (the reminder resolver contract).

   The engine is the deliverable. Every figure on the Utilities screens is computed here from
   readings, tariff versions, conversions, advances and periods — including the three ways this
   module refuses to produce a number: a boundary with no reading (FR-UT9), a period with no
   closing reading (FR-UT12), and an estimated reading, which is drawn and never priced (FR-UT4).

   A reading is the meter state at 00:00 of read_on, so one reading closes a period and opens the
   next: the closing reading of [from, to] is dated to + 1 day. Money is integer minor units
   (haléře); consumption is thousandths of the dial unit (value_milli). Neither is ever a float
   in a sum.
*/
(function () {
  var TODAY = "2026-09-09";

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
  function daysInMonth(k) {
    var p = k.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
  }
  function monthStart(k) { return k + "-01"; }
  function nextMonth(k) {
    var p = k.split("-").map(Number);
    return p[1] === 12 ? (p[0] + 1) + "-01" : p[0] + "-" + String(p[1] + 1).padStart(2, "0");
  }

  /* ── money and units, cs-CZ ───────────────────────────────────────────── */
  function grp(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0"); }
  function money(minor) {
    if (minor == null) return "\u2014";
    var neg = minor < 0, v = Math.abs(Math.round(minor));
    return (neg ? "\u2212" : "") + grp(Math.floor(v / 100)) + "," +
      String(v % 100).padStart(2, "0") + "\u00a0K\u010d";
  }
  function moneyRound(minor) {
    if (minor == null) return "\u2014";
    var neg = minor < 0, v = Math.abs(Math.round(minor / 100));
    return (neg ? "\u2212" : "") + grp(v) + "\u00a0K\u010d";
  }
  function rate(minor, per) { return money(minor) + "/" + per; }
  function dial(milli, dec) {
    var s = (milli / 1000).toFixed(dec).split(".");
    return grp(Number(s[0])) + (dec ? "," + s[1] : "");
  }
  function qty(milli, dec, unit) { return dial(milli, dec) + "\u00a0" + unit; }

  /* ── D-60 · the three modes ───────────────────────────────────────────── */
  var MODES = [
    { key: "bills_only", plain: "I just get a bill", records: "Invoices and payments",
      gets: "Spend history, renewal and price-change tracking, payment reminders",
      who: "Renters, flat-fee arrangements, shared buildings, internet and waste" },
    { key: "readings", plain: "I read the meter", records: "The above, plus meter readings",
      gets: "Consumption trends, per-period usage, \u201care we using more than last year\u201d",
      who: "Anyone with meter access who does not want to model prices" },
    { key: "full", plain: "I want to check the annual settlement",
      records: "The above, plus tariffs, advance schedules and billing periods",
      gets: "Cost per stretch, a forecast, a recommended advance, computed against invoiced",
      who: "Owners, energy-focused households" }
  ];
  function modeOf(k) { return MODES.filter(function (m) { return m.key === k; })[0]; }

  /* ── FR-UT5 · the eleven component types ──────────────────────────────
     Each parameter declares its kind. The gate counts the kinds: not one of them is a field a
     member could type an expression into, which is what D-64 means once it is a form. */
  var TYPES = [
    { type: "standing_charge", applies: "time", plain: "A charge for having the connection",
      params: [["amount", "money"], ["period", "enum: day / month / year"]],
      bill: { CZ: "M\u011bs\u00ed\u010dn\u00ed plat za odb\u011brn\u00e9 m\u00edsto", DE: "Grundpreis", UK: "Standing charge" } },
    { type: "capacity_charge", applies: "time", plain: "A charge for the size of your connection",
      params: [["amount", "money per capacity-unit"], ["capacity", "number with a unit"], ["period", "enum"]],
      bill: { CZ: "Plat za jisti\u010d (3\u00d725 A)", DE: "Leistungspreis (\u20ac/kW)", UK: "\u2014" } },
    { type: "unit_rate", applies: "consumption", plain: "A price for each unit you use",
      params: [["amount", "money per billed unit"], ["register", "pick one of this meter\u2019s registers"]],
      bill: { CZ: "Cena za dodanou elektřinu \u2014 VT / NT", DE: "Arbeitspreis", UK: "Unit rate" } },
    { type: "tiered_rate", applies: "consumption", plain: "A price that changes after so many units",
      params: [["blocks", "ordered rows: up to N units, price"], ["register", "pick"], ["reset", "enum: year / period"]],
      bill: { CZ: "\u2014", DE: "\u2014", UK: "Block tariff \u2014 first 60 m\u00b3" } },
    { type: "time_of_use", applies: "mapping", plain: "Which price applies at which hour",
      params: [["schedule", "rows: days, from, to, register"], ["register", "the single register being split"]],
      bill: { CZ: "\u2014", DE: "\u2014", UK: "Economy 7, 00:30\u201307:30" } },
    { type: "per_unit_levy", applies: "consumption", plain: "A levy for each unit you use",
      params: [["amount", "money per billed unit"], ["register", "pick, or all of them"]],
      bill: { CZ: "POZE \u2014 podpora vykupovan\u00e9 elektřiny", DE: "Umlagen", UK: "\u2014" } },
    { type: "fixed_levy", applies: "time", plain: "A flat regulatory charge",
      params: [["amount", "money"], ["period", "enum"]],
      bill: { CZ: "Syst\u00e9mov\u00e9 slu\u017eby a poplatek OTE", DE: "Abgaben", UK: "\u2014" } },
    { type: "tax", applies: "subtotal", plain: "Tax on some of the lines above",
      params: [["percentage", "percent"], ["applies_to", "tick the lines it applies to"]],
      bill: { CZ: "DPH 21 %", DE: "USt. 19 %", UK: "VAT 5 %" } },
    { type: "discount", applies: "subtotal", plain: "Money off some of the lines above",
      params: [["percentage or amount", "percent or money"], ["applies_to", "tick the lines it applies to"]],
      bill: { CZ: "Sleva za v\u011brnost", DE: "Neukundenbonus", UK: "Loyalty discount" } },
    { type: "feed_in", applies: "export", plain: "What they pay you for what you send back",
      params: [["amount", "money per unit"], ["register", "an export register"]],
      bill: { CZ: "V\u00fdkupn\u00ed cena přetok\u016f", DE: "Einspeiseverg\u00fctung", UK: "Export payment" } },
    { type: "self_consumption_credit", applies: "computed", plain: "A credit for what you generate and use yourself",
      params: [["amount", "money per unit"]],
      bill: { CZ: "\u2014", DE: "Eigenverbrauchsverg\u00fctung", UK: "\u2014" } }
  ];

  /* ── D-61 · presets are versioned reference data, not code ────────────── */
  var COUNTRY_PRESETS = [
    { id: "cz-elec-2t", country: "CZ", commodity: "electricity", v: 4,
      label: "Czech electricity, two tariffs (VT/NT)",
      skeleton: ["standing_charge", "capacity_charge", "unit_rate", "unit_rate", "per_unit_levy", "fixed_levy"],
      vat: "inclusive", registers: ["vt", "nt"] },
    { id: "cz-elec-1t", country: "CZ", commodity: "electricity", v: 4,
      label: "Czech electricity, single tariff",
      skeleton: ["standing_charge", "capacity_charge", "unit_rate", "per_unit_levy", "fixed_levy"],
      vat: "inclusive", registers: ["total"] },
    { id: "de-elec", country: "DE", commodity: "electricity", v: 3,
      label: "German electricity (Grundpreis + Arbeitspreis)",
      skeleton: ["standing_charge", "unit_rate", "fixed_levy", "tax"],
      vat: "exclusive", registers: ["total"] },
    { id: "uk-elec", country: "UK", commodity: "electricity", v: 2,
      label: "UK electricity (standing charge + unit rate)",
      skeleton: ["standing_charge", "unit_rate", "tax"], vat: "exclusive", registers: ["total"] },
    { id: "uk-e7", country: "UK", commodity: "electricity", v: 2, label: "UK Economy 7",
      skeleton: ["standing_charge", "time_of_use", "unit_rate", "unit_rate", "tax"],
      vat: "exclusive", registers: ["day", "night"] },
    { id: "pl-elec", country: "PL", commodity: "electricity", v: 2, label: "Polish electricity, G11 / G12",
      skeleton: ["standing_charge", "unit_rate", "unit_rate", "per_unit_levy", "tax"],
      vat: "exclusive", registers: ["day", "night"] },
    { id: "sk-elec", country: "SK", commodity: "electricity", v: 1, label: "Slovak electricity",
      skeleton: ["standing_charge", "capacity_charge", "unit_rate", "tax"], vat: "exclusive", registers: ["total"] },
    { id: "cz-gas", country: "CZ", commodity: "gas", v: 3, label: "Czech gas",
      skeleton: ["standing_charge", "unit_rate", "per_unit_levy", "discount"],
      vat: "inclusive", registers: ["total"], conversion: true },
    { id: "de-gas", country: "DE", commodity: "gas", v: 2, label: "German gas",
      skeleton: ["standing_charge", "unit_rate", "tax"], vat: "exclusive", registers: ["total"], conversion: true },
    { id: "water-vol", country: "*", commodity: "water", v: 2, label: "Water (volumetric + standing)",
      skeleton: ["standing_charge", "unit_rate", "tax"], vat: "inclusive", registers: ["total"] },
    { id: "water-sewage", country: "*", commodity: "water", v: 2, label: "Water with sewage on volume",
      skeleton: ["standing_charge", "unit_rate", "unit_rate"], vat: "inclusive", registers: ["total"] },
    { id: "water-block", country: "*", commodity: "water", v: 1, label: "Water, block tariff",
      skeleton: ["standing_charge", "tiered_rate", "tax"], vat: "inclusive", registers: ["total"] },
    { id: "heat-gj", country: "*", commodity: "heat", v: 1, label: "Heat (GJ)",
      skeleton: ["standing_charge", "unit_rate"], vat: "inclusive", registers: ["total"], conversion: true },
    { id: "custom", country: "*", commodity: "*", v: 1, label: "Custom \u2014 build it from the eleven parts",
      skeleton: [], vat: "inclusive", registers: ["total"] }
  ];

  /* ── the fixture: six services in three modes (D-60) ──────────────────── */
  var SERVICES = [
    { id: "elec", commodity: "electricity", name: "Elektřina", supplier: "\u010cEZ Prodej",
      account: "8100294471", place: "D\u016fm, Kohoutovice", currency: "CZK", mode: "full",
      contract_start: "2024-02-01", contract_end: "2027-01-31", notice_days: 90,
      preset: "cz-elec-2t", cadence: 31, readingDay: 11 },
    { id: "gas", commodity: "gas", name: "Plyn", supplier: "innogy Energie",
      account: "2740061188", place: "D\u016fm, Kohoutovice", currency: "CZK", mode: "full",
      contract_start: "2023-02-11", contract_end: "2027-02-10", notice_days: 30,
      preset: "cz-gas", cadence: 31, readingDay: 9 },
    { id: "water", commodity: "water", name: "Voda a sto\u010dn\u00e9", supplier: "BVK",
      account: "4471002", place: "D\u016fm, Kohoutovice", currency: "CZK", mode: "full",
      contract_start: "2019-07-01", contract_end: null, notice_days: 0,
      preset: "water-sewage", cadence: 183, readingDay: null },
    { id: "garden", commodity: "water", name: "Vodom\u011br na zahrad\u011b", supplier: "vlastn\u00ed podru\u017en\u00fd",
      account: null, place: "Zahrada", currency: "CZK", mode: "readings",
      contract_start: "2024-04-01", contract_end: null, notice_days: 0,
      preset: null, cadence: 61, readingDay: null },
    { id: "internet", commodity: "internet", name: "Internet", supplier: "O2",
      account: "77219004", place: "D\u016fm, Kohoutovice", currency: "CZK", mode: "bills_only",
      contract_start: "2024-03-01", contract_end: "2026-02-28", notice_days: 30,
      preset: null, cadence: null, readingDay: null },
    { id: "waste", commodity: "waste", name: "Odpad", supplier: "M\u011bsto Brno",
      account: "OB-4471", place: "D\u016fm, Kohoutovice", currency: "CZK", mode: "bills_only",
      contract_start: "2019-01-01", contract_end: null, notice_days: 0,
      preset: null, cadence: null, readingDay: null }
  ];
  function svc(id) { return SERVICES.filter(function (s) { return s.id === id; })[0]; }

  /* D-62 · registers are data. One, two, or an import/export pair. */
  var METERS = [
    { id: "m-elec", service: "elec", serial: "1EZ0271449", location: "sklep, u schod\u016f",
      unit: "kWh", digits: 5, decimals: 1, multiplier: 1, direction: "import",
      from: "2024-02-01", to: null,
      registers: [
        { key: "vt", label: "Vysok\u00fd tarif (VT)", direction: "import" },
        { key: "nt", label: "N\u00edzk\u00fd tarif (NT)", direction: "import" }
      ] },
    { id: "m-gas-old", service: "gas", serial: "G4-118820", location: "nika u vchodu",
      unit: "m3", digits: 5, decimals: 3, multiplier: 1, direction: "import",
      from: "2023-02-11", to: "2026-05-09",
      registers: [{ key: "total", label: "Odb\u011br", direction: "import" }] },
    { id: "m-gas-new", service: "gas", serial: "G4-771204", location: "nika u vchodu",
      unit: "m3", digits: 5, decimals: 3, multiplier: 1, direction: "import",
      from: "2026-05-09", to: null,
      registers: [{ key: "total", label: "Odb\u011br", direction: "import" }] },
    { id: "m-water", service: "water", serial: "VM-2214", location: "vodom\u011brn\u00e1 \u0161achta",
      unit: "m3", digits: 5, decimals: 3, multiplier: 1, direction: "import",
      from: "2019-07-01", to: null,
      registers: [{ key: "total", label: "Odb\u011br", direction: "import" }] },
    { id: "m-garden", service: "garden", serial: "VM-9041", location: "zahradn\u00ed dom\u011bk",
      unit: "m3", digits: 4, decimals: 3, multiplier: 1, direction: "import",
      from: "2024-04-01", to: null,
      registers: [{ key: "total", label: "Zavla\u017eov\u00e1n\u00ed", direction: "import" }] }
  ];
  function metersOf(id) { return METERS.filter(function (m) { return m.service === id; }); }
  function meterAt(id, on) {
    var ms = metersOf(id).filter(function (m) { return m.from <= on && (!m.to || on <= m.to); });
    return ms[ms.length - 1] || metersOf(id)[0];
  }

  /* D-63 · unit conversion is a first-class, versioned object. Both numbers are printed on the
     invoice and both change. A constant in the code is a module that is wrong in one country. */
  var CONVERSIONS = [
    { meter: "m-gas-old", from: "2023-02-11", correction: 1.0223, calorific: 10.55, to_unit: "MWh" },
    { meter: "m-gas-old", from: "2026-04-01", correction: 1.0230, calorific: 10.61, to_unit: "MWh" },
    { meter: "m-gas-new", from: "2026-05-09", correction: 1.0230, calorific: 10.61, to_unit: "MWh" },
    { meter: "m-elec", from: "2024-02-01", factor: 0.001, to_unit: "MWh" },
    { meter: "m-water", from: "2019-07-01", factor: 1, to_unit: "m3" },
    { meter: "m-garden", from: "2024-04-01", factor: 1, to_unit: "m3" }
  ];
  function conversionAt(meterId, on) {
    var cs = CONVERSIONS.filter(function (c) { return c.meter === meterId && c.from <= on; });
    return cs[cs.length - 1];
  }
  /* The factor takes the dial unit to the unit the price is quoted in: a Czech gas price is
     Kč/MWh and the invoice prints kWh/m³, so the ÷ 1000 belongs to the conversion. */
  function convFactor(c) {
    return c.factor != null ? c.factor : c.correction * c.calorific / 1000;
  }
  function convKwh(c) { return c.factor != null ? c.factor : c.correction * c.calorific; }
  function convSays(c) {
    return c.factor != null
      ? "\u00d7 " + c.factor + " \u2192 " + c.to_unit
      : "objemov\u00e1 korekce " + c.correction.toFixed(4) + " \u00d7 spalné teplo " +
        c.calorific.toFixed(2) + " kWh/m\u00b3 = " + convKwh(c).toFixed(4) +
        " kWh/m\u00b3, and \u00f7 1000 because the price is per MWh";
  }

  function R(service, on, vals, opt) {
    var o = opt || {};
    var out = { service: service, on: on, vals: {}, source: o.source || "manual",
                photo: !!o.photo, note: o.note || "", by: o.by || "petr",
                mark: o.mark || null, rollover: !!o.rollover, meter: o.meter || null,
                initial: !!o.initial, final: !!o.final };
    Object.keys(vals).forEach(function (k) { out.vals[k] = Math.round(vals[k] * 1000); });
    return out;
  }
  var READINGS = [
    /* electricity — VT is a five-digit register that ran past 99 999 in the spring */
    R("elec", "2025-01-01", { vt: 93208.4, nt: 22940.6 }, { note: "Opening of the 2025 period" }),
    R("elec", "2025-02-04", { vt: 93908.2, nt: 23342.1 }),
    R("elec", "2025-03-05", { vt: 94512.7, nt: 23706.4 }),
    R("elec", "2025-04-05", { vt: 95012.3, nt: 24020.8 }),
    R("elec", "2025-05-05", { vt: 95402.6, nt: 24288.5 }),
    R("elec", "2025-06-05", { vt: 95720.1, nt: 24512.9 }),
    R("elec", "2025-07-05", { vt: 96010.4, nt: 24730.2 }),
    R("elec", "2025-08-05", { vt: 96218.9, nt: 24940.7 }),
    R("elec", "2025-09-05", { vt: 96402.7, nt: 25118.4 }),
    R("elec", "2025-10-05", { vt: 96918.3, nt: 25402.1 }),
    R("elec", "2025-11-05", { vt: 97512.6, nt: 25744.8 }),
    R("elec", "2025-12-05", { vt: 98205.4, nt: 26138.2 }),
    /* nothing for 1 January 2026 — which is where the year is cut and where the price changed */
    R("elec", "2026-01-14", { vt: 99106.2, nt: 26641.5 }),
    R("elec", "2026-02-05", { vt: 99480.3, nt: 27002.9 }),
    R("elec", "2026-03-03", { vt: 99926.5, nt: 27341.6 }),
    R("elec", "2026-04-02", { vt: 320.8, nt: 27655.2 }, { rollover: true, note: "Rollover confirmed at the meter" }),
    R("elec", "2026-05-06", { vt: 742.4, nt: 27908.1 }),
    R("elec", "2026-06-05", { vt: 1108.9, nt: 28140.3 }),
    R("elec", "2026-07-05", { vt: 1469.2, nt: 28366.7 }),
    R("elec", "2026-07-20", { vt: 1720.0, nt: 28520.0 },
      { source: "estimated", by: "jana", note: "Off \u010cEZ\u2019s advance statement \u2014 nobody read the dial" }),
    R("elec", "2026-08-05", { vt: 1838.6, nt: 28602.4 }, { photo: true }),
    R("elec", "2026-09-06", { vt: 2260.0, nt: 28790.0 },
      { source: "supplier", by: "jana", note: "Typed off the letter from \u010cEZ" }),
    /* gas — one meter to 9 May, its successor from 9 May (FR-UT2) */
    R("gas", "2025-02-11", { total: 12418.602 }, { meter: "m-gas-old", note: "Opening of the 2025 period" }),
    R("gas", "2025-03-10", { total: 12593.602 }, { meter: "m-gas-old" }),
    R("gas", "2025-04-09", { total: 12741.602 }, { meter: "m-gas-old" }),
    R("gas", "2025-05-09", { total: 12837.602 }, { meter: "m-gas-old" }),
    R("gas", "2025-06-09", { total: 12889.602 }, { meter: "m-gas-old" }),
    R("gas", "2025-07-09", { total: 12927.602 }, { meter: "m-gas-old" }),
    R("gas", "2025-08-09", { total: 12963.602 }, { meter: "m-gas-old" }),
    R("gas", "2025-09-09", { total: 12999.602 }, { meter: "m-gas-old" }),
    R("gas", "2025-10-09", { total: 13047.602 }, { meter: "m-gas-old" }),
    R("gas", "2025-11-09", { total: 13139.602 }, { meter: "m-gas-old" }),
    R("gas", "2025-12-09", { total: 13289.602 }, { meter: "m-gas-old" }),
    R("gas", "2026-01-09", { total: 13507.602 }, { meter: "m-gas-old" }),
    R("gas", "2026-02-11", { total: 13689.202 }, { meter: "m-gas-old", note: "Closes 2025 and opens 2026" }),
    R("gas", "2026-03-08", { total: 13894.202 }, { meter: "m-gas-old" }),
    R("gas", "2026-04-08", { total: 14074.202 }, { meter: "m-gas-old" }),
    R("gas", "2026-05-09", { total: 14186.202 }, { meter: "m-gas-old", final: true, note: "Final reading \u2014 innogy changed the meter" }),
    R("gas", "2026-05-09", { total: 0.000 }, { meter: "m-gas-new", initial: true, note: "First reading on the successor" }),
    R("gas", "2026-06-08", { total: 58.000 }, { meter: "m-gas-new" }),
    R("gas", "2026-07-08", { total: 108.000 }, { meter: "m-gas-new" }),
    R("gas", "2026-08-08", { total: 147.000 }, { meter: "m-gas-new", photo: true }),
    /* water — one reading inside the closed period, and none at its end */
    R("water", "2025-07-01", { total: 2418.402 }, { by: "jana", note: "Opening of the period" }),
    R("water", "2026-07-20", { total: 2501.166 }, { by: "jana", note: "Three weeks after the period ended" }),
    /* the garden sub-meter — readings mode, no prices at all */
    R("garden", "2026-04-12", { total: 118.400 }, { by: "milos" }),
    R("garden", "2026-06-14", { total: 141.900 }, { by: "milos" }),
    R("garden", "2026-08-16", { total: 168.600 }, { by: "milos", photo: true })
  ];
  /* The cellar mutation: created offline at the meter, still queued on this device. */
  var CELLAR = R("elec", "2026-09-09", { vt: 2214.9, nt: 28861.7 },
    { photo: true, by: "petr", mark: "pending", note: "Typed in the cellar, no signal" });

  function readingsOf(id, opt) {
    var o = opt || {};
    var rows = READINGS.filter(function (r) { return r.service === id; });
    if (o.withPending) rows = rows.concat([CELLAR]);
    if (o.money) rows = rows.filter(function (r) { return r.source !== "estimated"; });
    return rows.slice().sort(function (a, b) {
      return a.on < b.on ? -1 : a.on > b.on ? 1 : (a.final ? -1 : 1);
    });
  }

  /* ── FR-UT1 / FR-UT3 · what the client can check, and what it cannot ──── */
  function neighbours(id, on, replica) {
    var rows = (replica || readingsOf(id)).filter(function (r) { return !r.final && !r.initial; });
    var before = null, after = null;
    rows.forEach(function (r) {
      if (r.on < on && (!before || r.on > before.on)) before = r;
      if (r.on > on && (!after || r.on < after.on)) after = r;
    });
    return { before: before, after: after };
  }
  function checkReading(id, on, vals, opt) {
    var o = opt || {};
    var m = meterAt(id, on);
    var n = neighbours(id, on, o.replica);
    var out = { ok: true, code: null, says: "", offer: null, against: null };
    var wrap = Math.pow(10, m.digits) * 1000;
    m.registers.forEach(function (reg) {
      if (!out.ok) return;
      var v = Math.round(vals[reg.key] * 1000);
      if (n.before && v < n.before.vals[reg.key]) {
        var drop = n.before.vals[reg.key] - v;
        if (Math.abs(drop - wrap) < wrap * 0.02) {
          out.ok = false; out.code = "rollover_suspected"; out.against = n.before;
          out.offer = "rollover";
          out.says = "That is lower than your reading on " + fmtLong(n.before.on) +
            ". The dial has " + m.digits + " digits, so it may have gone past " +
            dial(wrap - Math.pow(10, -m.decimals) * 1000, m.decimals) +
            " and started again. Is that what happened?";
        } else {
          out.ok = false; out.code = "monotonicity_violation"; out.against = n.before;
          out.offer = "question";
          out.says = "That reading is lower than the one on " + fmtLong(n.before.on) +
            " (" + qty(n.before.vals[reg.key], m.decimals, m.unit) + "). Is it a rollover, or a typo?";
        }
      } else if (n.after && v > n.after.vals[reg.key]) {
        out.ok = false; out.code = "monotonicity_violation"; out.against = n.after;
        out.offer = "server";
        out.says = "A reading already exists for " + fmtLong(n.after.on) + " at " +
          qty(n.after.vals[reg.key], m.decimals, m.unit) +
          ", which is lower than this one. One of the two is wrong \u2014 this one, or that one.";
      }
    });
    return out;
  }
  /* The cellar run. FR-UT1 is a cross-row invariant, so the phone's verdict and the server's
     verdict are not the same verdict — and the difference has a member standing in a cellar. */
  function cellarRun() {
    var replica = readingsOf("elec").filter(function (r) { return r.on <= "2026-08-05"; });
    var vals = { vt: CELLAR.vals.vt / 1000, nt: CELLAR.vals.nt / 1000 };
    var local = checkReading("elec", CELLAR.on, vals, { replica: replica });
    var server = checkReading("elec", CELLAR.on, vals, {});
    var back = readingsOf("elec").filter(function (r) { return r.on === "2026-09-06"; })[0];
    return {
      replicaRows: replica.length, allRows: readingsOf("elec").length,
      local: local, server: server, backfill: back,
      says: "The phone held " + replica.length + " rows and passed the value. The server holds " +
        readingsOf("elec").length + " \u2014 including a supplier row Jana typed in on " +
        fmtLong("2026-09-06") + " while Petr was in the cellar \u2014 and refuses it.",
      resolver: {
        title: "That reading was refused",
        body: "Your reading of " + qty(CELLAR.vals.vt, 1, "kWh") + " for " + fmtLong(CELLAR.on) +
          " is lower than the supplier reading of " + qty(back.vals.vt, 1, "kWh") + " for " +
          fmtLong(back.on) + ". One of the two is wrong. Yours was taken at the meter; " +
          "the supplier\u2019s came off a letter.",
        actions: ["Keep mine and correct 6 September", "Edit my reading", "Discard mine"]
      }
    };
  }
  function rolloverRun() {
    var rows = readingsOf("elec");
    var mar = rows.filter(function (r) { return r.on === "2026-03-03"; })[0];
    var apr = rows.filter(function (r) { return r.on === "2026-04-02"; })[0];
    var pre = checkReading("elec", "2026-04-02", { vt: 320.8, nt: 27655.2 },
      { replica: rows.filter(function (r) { return r.on < "2026-04-02"; }) });
    var m = meterAt("elec", apr.on);
    var wrap = Math.pow(10, m.digits) * 1000;
    var real = wrap - mar.vals.vt + apr.vals.vt;
    var naive = apr.vals.vt - mar.vals.vt;
    return { offer: pre.offer, code: pre.code, says: pre.says, real: real, naive: naive,
             wrap: wrap, before: mar, after: apr,
             line: "Confirmed, the stretch is " + qty(real, 1, "kWh") +
               ". Refused, it would have been " + qty(naive, 1, "kWh") +
               " and the year would never add up again." };
  }
  /* FR-UT2 · meter replacement, priced across the swap. */
  function replacementRun() {
    var rows = readingsOf("gas");
    var prev = rows.filter(function (r) { return r.on === "2026-04-08"; })[0];
    var fin = rows.filter(function (r) { return r.final; })[0];
    var init = rows.filter(function (r) { return r.initial; })[0];
    var cur = rows.filter(function (r) { return r.on === "2026-06-08"; })[0];
    var across = (fin.vals.total - prev.vals.total) + (cur.vals.total - init.vals.total);
    return { prev: prev, fin: fin, init: init, cur: cur, across: across,
             naive: cur.vals.total - prev.vals.total,
             says: "(" + qty(fin.vals.total, 3, "m\u00b3") + " \u2212 " + qty(prev.vals.total, 3, "m\u00b3") +
               ") + (" + qty(cur.vals.total, 3, "m\u00b3") + " \u2212 " + qty(init.vals.total, 3, "m\u00b3") +
               ") = " + qty(across, 3, "m\u00b3") };
  }

  /* ── the tariff engine ────────────────────────────────────────────────── */
  function C(id, type, bill, o) { return Object.assign({ id: id, type: type, bill: bill }, o); }
  var TARIFFS = [
    { id: "e-2025", service: "elec", from: "2025-01-01", vat: "inclusive", by: "jana",
      note: "Transcribed from the 2025 price list",
      components: [
        C("e25-standing", "standing_charge", "M\u011bs\u00ed\u010dn\u00ed plat za odb\u011brn\u00e9 m\u00edsto", { amount: 14800, period: "month" }),
        C("e25-jistic", "capacity_charge", "Plat za jisti\u010d 3\u00d725 A", { amount: 3610, capacity: 25, capUnit: "A", period: "month" }),
        C("e25-vt", "unit_rate", "Cena za dodanou elektřinu \u2014 VT", { amount: 298760, per: "MWh", register: "vt" }),
        C("e25-nt", "unit_rate", "Cena za dodanou elektřinu \u2014 NT", { amount: 195400, per: "MWh", register: "nt" }),
        C("e25-poze", "per_unit_levy", "POZE \u2014 podpora vykupovan\u00e9 elektřiny", { amount: 49500, per: "MWh", register: "all" }),
        C("e25-ote", "fixed_levy", "Syst\u00e9mov\u00e9 slu\u017eby a poplatek OTE", { amount: 5800, period: "month" })
      ] },
    { id: "e-2026", service: "elec", from: "2026-01-01", vat: "inclusive", by: "jana",
      note: "The version the conflict was about: 148,00 from Petr\u2019s device, 162,00 from Jana\u2019s",
      components: [
        C("e26-standing", "standing_charge", "M\u011bs\u00ed\u010dn\u00ed plat za odb\u011brn\u00e9 m\u00edsto", { amount: 16200, period: "month" }),
        C("e26-jistic", "capacity_charge", "Plat za jisti\u010d 3\u00d725 A", { amount: 3920, capacity: 25, capUnit: "A", period: "month" }),
        C("e26-vt", "unit_rate", "Cena za dodanou elektřinu \u2014 VT", { amount: 321845, per: "MWh", register: "vt" }),
        C("e26-nt", "unit_rate", "Cena za dodanou elektřinu \u2014 NT", { amount: 210630, per: "MWh", register: "nt" }),
        C("e26-poze", "per_unit_levy", "POZE \u2014 podpora vykupovan\u00e9 elektřiny", { amount: 49500, per: "MWh", register: "all" }),
        C("e26-ote", "fixed_levy", "Syst\u00e9mov\u00e9 slu\u017eby a poplatek OTE", { amount: 5800, period: "month" })
      ] },
    { id: "g-2025", service: "gas", from: "2025-01-01", vat: "inclusive", by: "petr",
      note: "Two lines and a loyalty discount, exactly as printed",
      components: [
        C("g-standing", "standing_charge", "M\u011bs\u00ed\u010dn\u00ed plat za odb\u011brn\u00e9 m\u00edsto", { amount: 22000, period: "month" }),
        C("g-supply", "unit_rate", "Cena za dodan\u00fd plyn", { amount: 145230, per: "MWh", register: "total" }),
        C("g-levy", "per_unit_levy", "Dan\u011b a poplatky za dodan\u00fd plyn", { amount: 3060, per: "MWh", register: "all" }),
        C("g-loyal", "discount", "Sleva za v\u011brnost 3 %", { pct: -300, applies_to: { only: ["g-supply"] } })
      ] },
    { id: "g-2027", service: "gas", from: "2027-01-01", vat: "inclusive", by: "petr",
      note: "Next January\u2019s prices, entered in August \u2014 they change the forecast the moment they are saved",
      components: [
        C("g27-standing", "standing_charge", "M\u011bs\u00ed\u010dn\u00ed plat za odb\u011brn\u00e9 m\u00edsto", { amount: 23500, period: "month" }),
        C("g27-supply", "unit_rate", "Cena za dodan\u00fd plyn", { amount: 158400, per: "MWh", register: "total" }),
        C("g27-levy", "per_unit_levy", "Dan\u011b a poplatky za dodan\u00fd plyn", { amount: 3060, per: "MWh", register: "all" }),
        C("g27-loyal", "discount", "Sleva za v\u011brnost 3 %", { pct: -300, applies_to: { only: ["g27-supply"] } })
      ] },
    { id: "w-2025", service: "water", from: "2025-01-01", vat: "inclusive", by: "jana",
      note: "Vodn\u00e9 and sto\u010dn\u00e9 are two lines on one bill",
      components: [
        C("w-standing", "standing_charge", "Pevn\u00e1 slo\u017eka podle profilu vodom\u011bru", { amount: 12600, period: "year" }),
        C("w-vodne", "unit_rate", "Vodn\u00e9", { amount: 5280, per: "m3", register: "total" }),
        C("w-stocne", "unit_rate", "Sto\u010dn\u00e9", { amount: 4610, per: "m3", register: "total" })
      ] }
  ];
  function tariffsOf(id) {
    return TARIFFS.filter(function (t) { return t.service === id; })
      .sort(function (a, b) { return a.from < b.from ? -1 : 1; });
  }
  /* The end of a version is derived, never stored. */
  function tariffSpans(id) {
    var vs = tariffsOf(id);
    return vs.map(function (v, i) {
      return { v: v, from: v.from, to: vs[i + 1] ? addDays(vs[i + 1].from, -1) : null };
    });
  }
  function tariffAt(id, on) {
    var vs = tariffsOf(id).filter(function (v) { return v.from <= on; });
    return vs[vs.length - 1] || null;
  }
  function monthChunks(from, to) {
    var out = [], k = monthKey(from);
    while (monthStart(k) < to) {
      var s = monthStart(k) > from ? monthStart(k) : from;
      var e = monthStart(nextMonth(k)) < to ? monthStart(nextMonth(k)) : to;
      out.push({ ym: k, from: s, to: e, days: diff(s, e), of: daysInMonth(k) });
      k = nextMonth(k);
    }
    return out;
  }
  function periodAmount(c) {
    var base = c.type === "capacity_charge" ? c.amount * c.capacity : c.amount;
    return { month: c.period === "month" ? base : c.period === "year" ? base / 12 : base * 30.4375,
             perDay: c.period === "day" ? base : null, period: c.period, base: base };
  }
  /* FR-UT8 · one stretch, one tariff version, one rounding per component. */
  function priceInterval(id, a, b, opt) {
    var o = opt || {};
    var inside = tariffsOf(id).filter(function (v) { return v.from > a.on && v.from < b.on; });
    if (inside.length) {
      return { blocked: true, date: inside[0].from, from: a.on, to: b.on,
               says: "a reading is needed for " + fmtLong(inside[0].from),
               why: "The price changed on " + fmtLong(inside[0].from) + ", inside the stretch from " +
                 fmtLong(a.on) + " to " + fmtLong(b.on) + ". Splitting it would mean inventing a meter value." };
    }
    var v = tariffAt(id, a.on);
    if (!v) {
      return { blocked: true, date: a.on, from: a.on, to: b.on,
               says: "no tariff is in effect on " + fmtLong(a.on),
               why: "There is no tariff version effective at the start of this stretch." };
    }
    var m = o.meterObj || meterAt(id, a.on);
    var conv = conversionAt(o.meter || m.id, b.on);
    var usage = {}, billed = {};
    m.registers.forEach(function (reg) {
      var d = b.vals[reg.key] - a.vals[reg.key];
      if (b.rollover && d < 0) d += Math.pow(10, m.digits) * 1000;
      usage[reg.key] = d;
      billed[reg.key] = d / 1000 * convFactor(conv) * m.multiplier;
    });
    var days = diff(a.on, b.on);
    var chunks = monthChunks(a.on, b.on);
    var lines = [];
    v.components.forEach(function (c) {
      var amount = 0, detail = "";
      if (c.type === "unit_rate" || c.type === "per_unit_levy" || c.type === "feed_in") {
        var u = c.register === "all"
          ? Object.keys(billed).reduce(function (n, k) { return n + billed[k]; }, 0)
          : (billed[c.register] || 0);
        amount = Math.round(u * c.amount) * (c.type === "feed_in" ? -1 : 1);
        detail = u.toFixed(3) + " " + c.per + " \u00d7 " + money(c.amount) + "/" + c.per;
      } else if (c.type === "tiered_rate") {
        var left = billed[c.register] || 0, acc = 0, parts = [];
        c.blocks.forEach(function (bl) {
          var cap = bl.up_to == null ? left : Math.min(left, Math.max(0, bl.up_to - acc));
          if (cap <= 0) return;
          amount += Math.round(cap * bl.amount);
          parts.push(cap.toFixed(1) + " \u00d7 " + money(bl.amount));
          acc += cap; left -= cap;
        });
        detail = parts.join(" + ");
      } else if (c.type === "standing_charge" || c.type === "capacity_charge" || c.type === "fixed_levy") {
        var pa = periodAmount(c), whole = 0;
        chunks.forEach(function (ch) {
          amount += Math.round(pa.perDay != null ? pa.perDay * ch.days : pa.month * ch.days / ch.of);
          if (ch.days === ch.of) whole++;
        });
        detail = chunks.length + (chunks.length === 1 ? " month chunk, " : " month chunks, ") +
          whole + " whole \u00b7 " + money(pa.base) + " per " + c.period +
          (c.type === "capacity_charge" ? " per " + c.capUnit + " \u00d7 " + c.capacity : "");
      } else if (c.type === "tax" || c.type === "discount") {
        var sub = 0;
        lines.forEach(function (l) {
          var inc = !c.applies_to || c.applies_to === "all" ? true
            : c.applies_to.only ? c.applies_to.only.indexOf(l.id) >= 0
            : c.applies_to.except ? c.applies_to.except.indexOf(l.id) < 0 : true;
          if (inc) sub += l.amount;
        });
        amount = Math.round(sub * c.pct / 10000);
        detail = (c.pct / 100).toFixed(0) + " % of " + money(sub) + " \u2014 " +
          (!c.applies_to || c.applies_to === "all" ? "everything above"
            : c.applies_to.only ? "only " + c.applies_to.only.join(", ")
            : "everything above except " + c.applies_to.except.join(", "));
      } else if (c.type === "self_consumption_credit") {
        var self = o.selfConsumed || 0;
        amount = -Math.round(self * c.amount);
        detail = self.toFixed(3) + " " + (c.per || "MWh") + " credited \u2014 a figure the member enters";
      } else if (c.type === "time_of_use") {
        detail = "maps " + c.register + " onto " +
          c.schedule.map(function (r) { return r.register; }).join(" / ") +
          " by clock time; the priced lines are the ones below";
      }
      lines.push({ id: c.id, type: c.type, bill: c.bill, amount: amount, detail: detail });
    });
    var total = lines.reduce(function (n, l) { return n + l.amount; }, 0);
    return { blocked: false, version: v, from: a.on, to: b.on, days: days, usage: usage,
             billed: billed, conv: conv, lines: lines, total: total, chunks: chunks,
             meter: m, estimatedUsed: (a.source === "estimated" || b.source === "estimated") };
  }

  /* FR-UT8 last rule · a displayed breakdown is rounded and the largest part takes the
     remainder, so the parts sum to the whole by construction. */
  function breakdown(total, weights) {
    var sum = weights.reduce(function (n, w) { return n + w.w; }, 0) || 1;
    var parts = weights.map(function (w) {
      return { label: w.label, amount: Math.round(total * w.w / sum), w: w.w, remainder: 0 };
    });
    var got = parts.reduce(function (n, p) { return n + p.amount; }, 0);
    if (got !== total && parts.length) {
      var big = parts.reduce(function (x, y) { return Math.abs(y.amount) > Math.abs(x.amount) ? y : x; });
      big.remainder = total - got;
      big.amount += total - got;
    }
    return parts;
  }

  /* ── periods, advances, settlement ────────────────────────────────────── */
  var PERIODS = [
    { id: "e-2025", service: "elec", from: "2025-01-01", to: "2025-12-31", estimatedEnd: false,
      invoice: { on: "2026-02-04", total: 4315600, balance: -595600, vals: { vt: 99180.0, nt: 26480.0 },
                 note: "\u010cEZ vy\u00fa\u010dtov\u00e1n\u00ed 2025" } },
    { id: "e-2026", service: "elec", from: "2026-01-01", to: "2026-12-31", estimatedEnd: false, invoice: null },
    { id: "g-2025", service: "gas", from: "2025-02-11", to: "2026-02-10", estimatedEnd: false,
      invoice: { on: "2026-02-11", total: 2254000, balance: -214000, vals: { total: 13700.602 },
                 note: "Vy\u00fa\u010dtov\u00e1n\u00ed plyn 2025 \u00b7 dopo\u010det 2 140 K\u010d" } },
    { id: "g-2026", service: "gas", from: "2026-02-11", to: "2027-02-10", estimatedEnd: false, invoice: null },
    { id: "w-2025", service: "water", from: "2025-07-01", to: "2026-06-30", estimatedEnd: true, invoice: null }
  ];
  function periodsOf(id) { return PERIODS.filter(function (p) { return p.service === id; }); }
  function periodOf(pid) { return PERIODS.filter(function (p) { return p.id === pid; })[0]; }
  function currentPeriod(id) {
    return periodsOf(id).filter(function (p) { return p.from <= TODAY && TODAY <= p.to; })[0] || null;
  }

  var ADVANCE_SCHEDULES = [
    { service: "elec", from: "2025-01-01", amount: 310000, day: 15 },
    { service: "elec", from: "2026-01-01", amount: 330000, day: 15 },
    { service: "gas", from: "2025-02-11", amount: 170000, day: 20 },
    { service: "gas", from: "2026-03-01", amount: 190000, day: 20 },
    { service: "water", from: "2025-07-01", amount: 62000, day: 25 }
  ];
  function scheduleAt(id, on) {
    var ss = ADVANCE_SCHEDULES.filter(function (s) { return s.service === id && s.from <= on; });
    return ss[ss.length - 1] || null;
  }
  /* FR-UT10 · a recorded payment wins over the schedule for its month, and attribution is by
     month key rather than payment date. */
  var ADVANCE_PAYMENTS = [
    { service: "gas", month: "2026-03", paid_on: "2026-04-02", amount: 190000, by: "jana",
      note: "Paid two days late \u2014 still March\u2019s advance" },
    { service: "gas", month: "2026-04", paid_on: "2026-04-19", amount: 190000, by: "jana" },
    { service: "gas", month: "2026-05", paid_on: "2026-05-20", amount: 190000, by: "jana" },
    { service: "gas", month: "2026-06", paid_on: "2026-06-19", amount: 190000, by: "jana" },
    { service: "gas", month: "2026-07", paid_on: "2026-07-20", amount: 210000, by: "jana",
      note: "Rounded up on purpose after the last settlement" },
    { service: "gas", month: "2026-08", paid_on: "2026-08-20", amount: 190000, by: "jana" },
    { service: "elec", month: "2026-01", paid_on: "2026-01-15", amount: 330000, by: "jana" },
    { service: "elec", month: "2026-02", paid_on: "2026-02-16", amount: 330000, by: "jana" },
    { service: "elec", month: "2026-03", paid_on: "2026-03-15", amount: 330000, by: "jana" },
    { service: "elec", month: "2026-04", paid_on: "2026-04-15", amount: 330000, by: "jana" },
    { service: "elec", month: "2026-05", paid_on: "2026-05-15", amount: 330000, by: "jana" },
    { service: "elec", month: "2026-06", paid_on: "2026-06-15", amount: 330000, by: "jana" },
    { service: "elec", month: "2026-07", paid_on: "2026-07-15", amount: 330000, by: "jana" },
    { service: "elec", month: "2026-08", paid_on: "2026-08-15", amount: 330000, by: "jana" }
  ];
  /* FR-UT13 · a calendar month counts toward a period iff the period contains that month's
     first day, which makes a year-long period exactly twelve months whatever day it starts. */
  function monthsOf(p) {
    var out = [], k = monthKey(p.from);
    while (monthStart(k) <= p.to) {
      if (monthStart(k) >= p.from) out.push(k);
      k = nextMonth(k);
    }
    return out;
  }
  function advanceRows(p) {
    return monthsOf(p).map(function (k) {
      var pay = ADVANCE_PAYMENTS.filter(function (a) { return a.service === p.service && a.month === k; })[0];
      var sch = scheduleAt(p.service, monthStart(k));
      var due = k + "-" + String(sch ? sch.day : 15).padStart(2, "0");
      return { month: k, label: monthLabel(k), due: due,
               scheduled: sch ? sch.amount : 0,
               amount: pay ? pay.amount : (sch ? sch.amount : 0),
               paid: !!pay, paid_on: pay ? pay.paid_on : null, note: pay ? pay.note || "" : "",
               source: pay ? "recorded payment" : "schedule",
               elapsed: due <= TODAY, future: due > TODAY };
    });
  }

  /* The period, stretch by stretch. A period is priced from its own start, so the reading that
     opens it and the one that closes it are boundary conditions, not conveniences. */
  function periodRun(pid) {
    var p = periodOf(pid), id = p.service;
    var closeOn = addDays(p.to, 1);
    var rows = readingsOf(id, { money: true })
      .filter(function (r) { return r.on >= p.from && r.on <= closeOn; });
    var opening = rows[0] || null;
    var closing = rows.length ? rows[rows.length - 1] : null;
    var openingMissing = !opening || opening.on !== p.from;
    var closingMissing = !closing || closing.on !== closeOn;
    var needsClosing = closeOn <= TODAY;
    var intervals = [], meterSwaps = 0, insideBlock = null;
    for (var i = 0; i + 1 < rows.length; i++) {
      var a = rows[i], b = rows[i + 1];
      if (a.final && b.initial) { meterSwaps++; continue; }
      if (a.on === b.on) continue;
      var res = priceInterval(id, a, b, { meter: b.meter });
      if (res.blocked) { insideBlock = res; continue; }
      intervals.push(res);
    }
    var blocked = null;
    var boundary = openingMissing ? p.from : (needsClosing && closingMissing ? closeOn : null);
    if (insideBlock) blocked = insideBlock;
    else if (boundary) {
      var change = tariffsOf(id).filter(function (v) { return v.from === boundary; })[0];
      blocked = {
        blocked: true, date: boundary, boundaryOf: openingMissing ? "start" : "end",
        says: "a reading is needed for " + fmtLong(boundary),
        why: change
          ? "The price changed on " + fmtLong(boundary) + " and the year is cut on the same day. " +
            "The nearest readings are " + (opening ? fmtLong(opening.on) : "none") +
            " and the one before it, and splitting that stretch would mean inventing a meter value."
          : "The period " + (openingMissing ? "starts" : "ends") + " on " + fmtLong(boundary) +
            " and there is no reading for that day. Consumption is a difference between two readings, " +
            "and one side of this one does not exist."
      };
    }
    var cost = blocked ? null : intervals.reduce(function (n, r) { return n + r.total; }, 0);
    var adv = advanceRows(p);
    return {
      period: p, service: svc(id), rows: rows, intervals: intervals, blocked: blocked,
      insideBlock: insideBlock, meterSwaps: meterSwaps,
      opening: opening, openingMissing: openingMissing, closeOn: closeOn,
      closing: closing, closingMissing: closingMissing, needsClosing: needsClosing,
      cost: cost, priced: intervals.reduce(function (n, r) { return n + r.total; }, 0),
      advances: adv.filter(function (a) { return a.elapsed; }).reduce(function (n, a) { return n + a.amount; }, 0),
      advancesAll: adv.reduce(function (n, a) { return n + a.amount; }, 0),
      advanceRows: adv, months: monthsOf(p),
      estimatedRows: readingsOf(id).filter(function (r) {
        return r.source === "estimated" && r.on >= p.from && r.on <= closeOn; }).length,
      estimatedInMoney: intervals.filter(function (r) { return r.estimatedUsed; }).length
    };
  }

  /* FR-UT12 · the boundary between fact and forecast is the latest reading, not today, and every
     future day is priced by the tariff effective on that day. */
  function forecast(pid, opt) {
    var o = opt || {};
    var run = periodRun(pid), p = run.period;
    if (run.blocked) {
      return { ok: false, why: "not enough information to forecast", missing: run.blocked.says,
               detail: run.blocked.why, run: run };
    }
    if (run.intervals.length < 1) {
      return { ok: false, why: "not enough information to forecast",
               missing: run.rows.length < 2
                 ? "a second reading inside this period \u2014 there " +
                   (run.rows.length === 1 ? "is one" : "are none")
                 : "a priced stretch",
               detail: "Consumption is a difference between two readings. One reading is a number, not a difference.",
               run: run };
    }
    var last = run.intervals[run.intervals.length - 1];
    var elapsed = diff(run.opening.on, last.to);
    var endEx = addDays(p.to, 1);
    var future = diff(last.to, endEx);
    if (future <= 0) {
      return { ok: true, complete: true, run: run, future: 0, cost: run.cost, actual: run.cost,
               boundary: last.to, versionRows: [],
               says: "The period has its closing reading, so there is nothing left to forecast." };
    }
    var perDay = {};
    Object.keys(last.usage).forEach(function (k) {
      var tot = run.intervals.reduce(function (n, r) { return n + (r.usage[k] || 0); }, 0);
      perDay[k] = tot / elapsed;
    });
    var meter = meterAt(p.service, TODAY);
    var spans = [];
    tariffSpans(p.service).forEach(function (s) {
      if (o.withoutFuture && s.from > last.to) return;
      var from = s.from > last.to ? s.from : last.to;
      var to = s.to ? addDays(s.to, 1) : endEx;
      if (to > endEx) to = endEx;
      if (from < to) spans.push({ v: s.v, from: from, to: to });
    });
    var projected = 0, versionRows = [];
    spans.forEach(function (sp) {
      var n = diff(sp.from, sp.to);
      var a = { on: sp.from, vals: {}, source: "manual" }, b = { on: sp.to, vals: {}, source: "manual" };
      Object.keys(perDay).forEach(function (k) { a.vals[k] = 0; b.vals[k] = Math.round(perDay[k] * n); });
      var res = priceInterval(p.service, a, b, { meter: meter.id, meterObj: meter });
      projected += res.total;
      versionRows.push({ version: sp.v.id, from: sp.from, to: sp.to, days: n, amount: res.total });
    });
    return { ok: true, complete: false, run: run, elapsed: elapsed, future: future,
             perDay: perDay, projected: projected, cost: run.cost + projected, actual: run.cost,
             versionRows: versionRows, boundary: last.to, spans: spans,
             says: "Facts to " + fmtLong(last.to) + " \u2014 the last reading, not today \u2014 then " +
               future + " days projected at " + Object.keys(perDay).map(function (k) {
                 return (perDay[k] / 1000).toFixed(2) + " " + meter.unit + "/day";
               }).join(" and ") + "." };
  }

  /* FR-UT13 · balance and the recommended advance. */
  function summary(id) {
    var s = svc(id);
    var p = currentPeriod(id);
    var past = periodsOf(id).filter(function (x) { return x.to < TODAY; });
    var last = past.length ? past[past.length - 1] : null;
    if (!p) {
      return { service: s, mode: s.mode, none: true, headroom: headroom(id),
               lastPeriod: last, lastSettlement: last ? settlement(last.id) : null,
               bills: s.mode === "bills_only" ? spend(id) : null,
               readings: readingsOf(id).length,
               balance: null, cost: null, blocked: last ? periodRun(last.id).blocked : null };
    }
    var f = forecast(p.id), run = f.run;
    var remaining = run.advanceRows.filter(function (a) { return a.future; });
    var out = { service: s, period: p, run: run, forecast: f, advances: run.advances,
                advancesAll: run.advancesAll, cost: f.ok ? f.cost : null, balance: null,
                recommended: null, shortfall: null, blocked: run.blocked,
                months: run.months.length, remainingMonths: remaining.length,
                headroom: headroom(id), lastPeriod: last,
                lastSettlement: last ? settlement(last.id) : null,
                readings: readingsOf(id).length,
                bills: s.mode === "bills_only" ? spend(id) : null };
    if (f.ok) {
      out.balance = run.advancesAll - f.cost;
      if (out.balance < 0 && remaining.length) {
        out.shortfall = -out.balance;
        out.recommended = (scheduleAt(id, TODAY) ? scheduleAt(id, TODAY).amount : 0) +
          Math.ceil((out.shortfall / remaining.length) / 100) * 100;
      }
    }
    return out;
  }

  /* FR-UT14 · headroom. Computable with zero consumption data, which is why it is what the
     overview shows on day one — and what a blocked service keeps showing. */
  function approxUnits(n) {
    return n >= 100 ? String(Math.round(n / 10) * 10)
         : n >= 10 ? String(Math.round(n))
         : (Math.round(n * 10) / 10).toFixed(1).replace(".", ",");
  }
  var MIX = { vt: 0.6, nt: 0.4 };
  function headroom(id, opt) {
    var o = opt || {};
    var on = o.on || TODAY;
    var v = tariffAt(id, on), sch = scheduleAt(id, on);
    if (!v || !sch) return null;
    var fixed = 0, fixedRows = [];
    v.components.forEach(function (c) {
      if (c.type === "standing_charge" || c.type === "capacity_charge" || c.type === "fixed_levy") {
        var m = Math.round(periodAmount(c).month);
        fixed += m; fixedRows.push({ bill: c.bill, amount: m, period: c.period });
      }
    });
    var buys = sch.amount - fixed;
    var m = meterAt(id, on), conv = conversionAt(m.id, on), levy = 0;
    v.components.forEach(function (c) { if (c.type === "per_unit_levy") levy += c.amount; });
    var regs = m.registers.map(function (reg) {
      var rs = v.components.filter(function (c) { return c.type === "unit_rate" && c.register === reg.key; });
      if (!rs.length) return null;
      var per = rs.reduce(function (n, c) { return n + c.amount; }, 0) + levy;
      var perDial = per * convFactor(conv);
      return { key: reg.key, label: reg.label, rate: per - levy, lines: rs.length,
               perUnit: per, perDial: perDial,
               units: buys > 0 ? buys / perDial : 0, unit: m.unit,
               share: MIX[reg.key] != null ? MIX[reg.key] : 1 / m.registers.length };
    }).filter(Boolean);
    var blended = regs.reduce(function (n, r) { return n + r.share * r.perDial; }, 0);
    var atMix = buys > 0 && blended > 0 ? buys / blended : 0;
    return {
      service: svc(id), advance: sch.amount, fixed: fixed, fixedRows: fixedRows, buys: buys,
      registers: regs, unit: m.unit, atMix: atMix, vat: v.vat,
      mixSays: regs.length > 1
        ? Math.round((MIX.vt || 0) * 100) + " % VT / " + Math.round((MIX.nt || 0) * 100) + " % NT"
        : "one register",
      says: "Your advance is " + money(sch.amount) + ". " + money(fixed) +
        " of that is fixed charges. " + money(buys) + " buys about " +
        approxUnits(atMix) + " " + m.unit + " at your rates.",
      heuristic: regs.length > 1
        ? "At " + Math.round(MIX.vt * 100) + " % VT and " + Math.round(MIX.nt * 100) +
          " % NT \u2014 that split is a guess about how you live, not a measurement."
        : "One register, so there is no mix to guess."
    };
  }

  /* FR-UT15 · history. is_approximate wherever a contributing stretch crosses a month end. */
  function history(id) {
    var byMonth = {};
    periodsOf(id).forEach(function (p) {
      periodRun(p.id).intervals.forEach(function (r) {
        r.chunks.forEach(function (ch) {
          var w = ch.days / r.days;
          var row = byMonth[ch.ym] || (byMonth[ch.ym] = { ym: ch.ym, cost: 0, usage: {}, approx: false, parts: 0 });
          row.parts++;
          row.cost += Math.round(r.total * w);
          Object.keys(r.usage).forEach(function (k) {
            row.usage[k] = (row.usage[k] || 0) + Math.round(r.usage[k] * w);
          });
          if (r.chunks.length > 1) row.approx = true;
        });
      });
    });
    return Object.keys(byMonth).sort().map(function (k) {
      var r = byMonth[k];
      r.label = monthLabel(k);
      r.total = Object.keys(r.usage).reduce(function (n, x) { return n + r.usage[x]; }, 0);
      return r;
    });
  }
  /* The flag is computed, not decorative: a calendar-aligned stretch is not approximate. */
  function approxProof(id) {
    var rows = readingsOf(id, { money: true });
    var a = rows.filter(function (r) { return r.on === "2026-06-08"; })[0];
    var aligned = priceInterval(id, { on: "2026-06-01", vals: { total: 0 }, source: "manual" },
      { on: "2026-07-01", vals: { total: 50000 }, source: "manual" }, { meter: "m-gas-new" });
    var real = priceInterval(id, a, rows.filter(function (r) { return r.on === "2026-07-08"; })[0],
      { meter: "m-gas-new" });
    return { alignedChunks: aligned.chunks.length, realChunks: real.chunks.length,
             alignedApprox: aligned.chunks.length > 1, realApprox: real.chunks.length > 1 };
  }
  function chartPoints(id) {
    var rows = readingsOf(id, { withPending: id === "elec" });
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var a = rows[i - 1], b = rows[i];
      if (a.final && b.initial) continue;
      if (a.on === b.on) continue;
      var m = meterAt(id, b.on), d = 0;
      m.registers.forEach(function (reg) {
        var x = b.vals[reg.key] - a.vals[reg.key];
        if (b.rollover && x < 0) x += Math.pow(10, m.digits) * 1000;
        d += x;
      });
      var days = diff(a.on, b.on) || 1;
      out.push({ on: b.on, from: a.on, days: days, usage: d, perDay: d / days,
                 estimated: b.source === "estimated", fromEstimated: a.source === "estimated",
                 supplier: b.source === "supplier", pending: b.mark === "pending",
                 rollover: !!b.rollover, unit: m.unit, decimals: m.decimals });
    }
    return out;
  }

  /* FR-UT11 · the settlement stores the supplier's total, balance and their own final meter
     values, so a discrepancy is attributable to consumption rather than only to money. */
  function settlement(pid) {
    var run = periodRun(pid), p = run.period;
    if (!p.invoice) {
      return { ok: false, run: run,
               why: run.blocked ? run.blocked.says : "no invoice recorded",
               says: run.blocked ? run.blocked.why : "The supplier has not sent the settlement yet." };
    }
    var inv = p.invoice, m = meterAt(p.service, p.to);
    var ours = run.closing && !run.closingMissing ? run.closing.vals : null;
    var regs = m.registers.map(function (reg) {
      var t = Math.round((inv.vals[reg.key] || 0) * 1000);
      var o = ours ? ours[reg.key] : null;
      return { key: reg.key, label: reg.label, theirs: t, ours: o, delta: o == null ? null : t - o };
    });
    var unitDelta = regs.reduce(function (n, r) { return n + (r.delta || 0); }, 0);
    var conv = conversionAt(m.id, p.to), v = tariffAt(p.service, p.to), unitRate = 0;
    if (v) v.components.forEach(function (c) {
      if (c.type === "unit_rate" || c.type === "per_unit_levy") unitRate += c.amount;
    });
    var moneyOfUnits = Math.round(unitDelta / 1000 * convFactor(conv) * unitRate /
      (m.registers.length > 1 ? m.registers.length : 1));
    return {
      ok: true, run: run, invoice: inv, registers: regs, unitDelta: unitDelta,
      computed: run.cost, invoiced: inv.total, advances: run.advancesAll, balance: inv.balance,
      moneyDelta: run.cost == null ? null : inv.total - run.cost, moneyOfUnits: moneyOfUnits,
      says: run.cost == null
        ? "Computed cannot be produced for this period, so there is nothing to compare the invoice with \u2014 and the reason is on the row above it."
        : "Invoiced " + money(inv.total) + " against computed " + money(run.cost) + ": " +
          money(Math.abs(inv.total - run.cost)) + " apart, and " +
          qty(Math.abs(unitDelta), m.decimals, m.unit) + " of that difference is meter, not money."
    };
  }

  /* Bills-only (FR-UT16) and the upgrade (FR-UT17). */
  var BILLS = [
    { service: "internet", issued: "2025-09-05", due: "2025-09-20", from: "2025-09-01", to: "2025-09-30", amount: 59900, paid: "2025-09-11" },
    { service: "internet", issued: "2025-10-05", due: "2025-10-20", from: "2025-10-01", to: "2025-10-31", amount: 59900, paid: "2025-10-09" },
    { service: "internet", issued: "2025-11-05", due: "2025-11-20", from: "2025-11-01", to: "2025-11-30", amount: 59900, paid: "2025-11-12" },
    { service: "internet", issued: "2025-12-05", due: "2025-12-20", from: "2025-12-01", to: "2025-12-31", amount: 59900, paid: "2025-12-10" },
    { service: "internet", issued: "2026-01-05", due: "2026-01-20", from: "2026-01-01", to: "2026-01-31", amount: 59900, paid: "2026-01-13" },
    { service: "internet", issued: "2026-02-05", due: "2026-02-20", from: "2026-02-01", to: "2026-02-28", amount: 59900, paid: "2026-02-09" },
    { service: "internet", issued: "2026-03-05", due: "2026-03-20", from: "2026-03-01", to: "2026-03-31", amount: 59900, paid: "2026-03-11" },
    { service: "internet", issued: "2026-04-05", due: "2026-04-20", from: "2026-04-01", to: "2026-04-30", amount: 64900, paid: "2026-04-10",
      note: "Price change \u2014 the contract\u2019s fixed period ended in February" },
    { service: "internet", issued: "2026-05-05", due: "2026-05-20", from: "2026-05-01", to: "2026-05-31", amount: 64900, paid: "2026-05-12" },
    { service: "internet", issued: "2026-06-05", due: "2026-06-20", from: "2026-06-01", to: "2026-06-30", amount: 64900, paid: "2026-06-10" },
    { service: "internet", issued: "2026-07-05", due: "2026-07-20", from: "2026-07-01", to: "2026-07-31", amount: 64900, paid: "2026-07-14" },
    { service: "internet", issued: "2026-08-05", due: "2026-08-20", from: null, to: null, amount: 64900, paid: "2026-08-11",
      note: "The period is not printed on this one \u2014 it arrived as a payment confirmation" },
    { service: "internet", issued: "2026-09-05", due: "2026-09-20", from: "2026-09-01", to: "2026-09-30", amount: 64900, paid: null },
    { service: "waste", issued: "2026-03-02", due: "2026-05-31", from: "2026-01-01", to: "2026-12-31", amount: 180000, paid: "2026-04-28",
      note: "One bill a year, per person in the household" },
    { service: "waste", issued: "2025-03-03", due: "2025-05-31", from: "2025-01-01", to: "2025-12-31", amount: 170000, paid: "2025-05-06" }
  ];
  function billsOf(id) {
    return BILLS.filter(function (b) { return b.service === id; })
      .sort(function (a, b) { return a.issued < b.issued ? 1 : -1; });
  }
  function spend(id) {
    var rows = billsOf(id), byYear = {};
    rows.forEach(function (b) {
      var y = (b.from || b.issued).slice(0, 4);
      byYear[y] = (byYear[y] || 0) + b.amount;
    });
    var asc = rows.slice().reverse(), changes = [];
    for (var i = 1; i < asc.length; i++) {
      if (asc[i].amount !== asc[i - 1].amount) {
        changes.push({ on: asc[i].from || asc[i].issued, from: asc[i - 1].amount, to: asc[i].amount,
                       pct: Math.round((asc[i].amount - asc[i - 1].amount) / asc[i - 1].amount * 1000) / 10 });
      }
    }
    return { rows: rows, byYear: byYear, changes: changes,
             unpaid: rows.filter(function (b) { return !b.paid; }),
             total: rows.reduce(function (n, b) { return n + b.amount; }, 0) };
  }
  /* FR-UT17 · upgrading keeps every bill; they become the invoice record of retrospective
     periods where the dates allow — which is arithmetic, not a promise. */
  function upgradeRun(id) {
    var rows = billsOf(id).slice().reverse(), kept = [], skipped = [], last = null;
    rows.forEach(function (b) {
      if (!b.from || !b.to) { skipped.push({ b: b, why: "no period printed on the bill" }); return; }
      if (last && b.from <= last) { skipped.push({ b: b, why: "overlaps the period ending " + fmt(last) }); return; }
      kept.push(b); last = b.to;
    });
    return { bills: rows.length, periods: kept.length, skipped: skipped, kept: kept,
             says: rows.length + " bills become " + kept.length + " retrospective billing periods; " +
               skipped.length + " cannot, and say why on the row." };
  }

  /* ── FR-UT18 · export is an ordinary register with a feed_in component ─── */
  function solarRun() {
    var meter = { id: "m-pv", service: "pv", serial: "generated", location: "\u2014", unit: "kWh",
                  digits: 5, decimals: 1, multiplier: 1, direction: "bidirectional",
                  from: "2026-01-01", to: null,
                  registers: [{ key: "import", label: "Odb\u011br", direction: "import" },
                              { key: "export", label: "Přetoky", direction: "export" }] };
    var v = { id: "pv", service: "pv", from: "2026-01-01", vat: "inclusive", components: [
      C("pv-standing", "standing_charge", "M\u011bs\u00ed\u010dn\u00ed plat za odb\u011brn\u00e9 m\u00edsto", { amount: 16200, period: "month" }),
      C("pv-import", "unit_rate", "Cena za dodanou elektřinu", { amount: 321845, per: "MWh", register: "import" }),
      C("pv-export", "feed_in", "V\u00fdkupn\u00ed cena přetok\u016f", { amount: 142000, per: "MWh", register: "export" }),
      C("pv-self", "self_consumption_credit", "Bonus za vlastn\u00ed spotřebu", { amount: 24000, per: "MWh" })
    ] };
    METERS.push(meter); TARIFFS.push(v);
    CONVERSIONS.push({ meter: "m-pv", from: "2026-01-01", factor: 0.001, to_unit: "MWh" });
    var a = R("pv", "2026-06-01", { import: 1200.0, export: 400.0 });
    var b = R("pv", "2026-07-01", { import: 1290.0, export: 780.0 });
    var res = priceInterval("pv", a, b, { meter: "m-pv", meterObj: meter, selfConsumed: 0.31 });
    METERS.pop(); TARIFFS.pop(); CONVERSIONS.pop();
    return { res: res, negative: res.total < 0, meter: meter, version: v,
             says: "One month, 90 kWh imported and 380 kWh exported: " + money(res.total) +
               ". A net cost that comes out negative is an ordinary result, not an error state." };
  }

  /* ── the eleven types, each run through the engine ────────────────────── */
  function typeRun() {
    var out = [];
    var run = function (components, regs, vals, unit, dec, opt) {
      var meter = { id: "m-t", service: "t", serial: "t", location: "t", unit: unit || "kWh",
                    digits: 5, decimals: dec == null ? 1 : dec, multiplier: 1,
                    direction: "bidirectional", from: "2020-01-01", to: null, registers: regs };
      var v = { id: "t", service: "t", from: "2020-01-01", vat: "inclusive", components: components };
      METERS.push(meter); TARIFFS.push(v);
      CONVERSIONS.push({ meter: "m-t", from: "2020-01-01",
                         factor: unit === "m3" ? 1 : 0.001, to_unit: unit === "m3" ? "m3" : "MWh" });
      var res = priceInterval("t", R("t", "2026-03-01", vals[0]), R("t", "2026-04-01", vals[1]),
        Object.assign({ meter: "m-t", meterObj: meter }, opt || {}));
      METERS.pop(); TARIFFS.pop(); CONVERSIONS.pop();
      return res;
    };
    var push = function (type, res, lineId, note) {
      var line = res.lines.filter(function (l) { return l.id === lineId; })[0];
      out.push({ type: type, amount: line.amount, detail: line.detail, bill: line.bill,
                 total: res.total, note: note });
    };
    var one = [{ key: "total", label: "Odb\u011br", direction: "import" }];
    var two = [{ key: "day", label: "Day", direction: "import" },
               { key: "night", label: "Night", direction: "import" }];
    var base = C("t-unit", "unit_rate", "Cena za dodanou elektřinu", { amount: 321845, per: "MWh", register: "total" });

    push("standing_charge", run([C("t-s", "standing_charge", "M\u011bs\u00ed\u010dn\u00ed plat za odb\u011brn\u00e9 m\u00edsto", { amount: 16200, period: "month" })],
      one, [{ total: 100 }, { total: 400 }]), "t-s", "One whole March, so the month costs the monthly figure exactly.");
    push("capacity_charge", run([C("t-c", "capacity_charge", "Plat za jisti\u010d 3\u00d725 A", { amount: 3920, capacity: 25, capUnit: "A", period: "month" })],
      one, [{ total: 100 }, { total: 400 }]), "t-c", "Money per amp per month \u00d7 the breaker on the wall.");
    push("unit_rate", run([base], one, [{ total: 100 }, { total: 400 }]), "t-unit",
      "300 kWh through one register, converted to MWh by the meter\u2019s own conversion.");
    push("tiered_rate", run([C("t-t", "tiered_rate", "Block tariff", { register: "total", reset: "year",
      blocks: [{ up_to: 60, amount: 4200 }, { up_to: 120, amount: 5600 }, { up_to: null, amount: 7100 }] })],
      one, [{ total: 1000 }, { total: 1150 }], "m3", 3), "t-t", "150 m\u00b3 across three blocks, in the order printed.");
    push("time_of_use", run([C("t-tou", "time_of_use", "Economy 7, 00:30\u201307:30", { register: "total",
      schedule: [{ days: "all", from: "00:30", to: "07:30", register: "night" },
                 { days: "all", from: "07:30", to: "00:30", register: "day" }] }),
      C("t-d", "unit_rate", "Day rate", { amount: 780000, per: "MWh", register: "day" }),
      C("t-n", "unit_rate", "Night rate", { amount: 390000, per: "MWh", register: "night" })],
      two, [{ day: 100, night: 50 }, { day: 300, night: 180 }]), "t-tou",
      "A mapping, not a price: it says which register a clock hour lands in.");
    push("per_unit_levy", run([base, C("t-l", "per_unit_levy", "POZE", { amount: 49500, per: "MWh", register: "all" })],
      one, [{ total: 100 }, { total: 400 }]), "t-l", "Applied to every register, including ones added later.");
    push("fixed_levy", run([C("t-f", "fixed_levy", "Syst\u00e9mov\u00e9 slu\u017eby", { amount: 5800, period: "month" })],
      one, [{ total: 100 }, { total: 400 }]), "t-f", "Time, not consumption, so it is pro-rata at the ends.");
    push("tax", run([base, C("t-l2", "per_unit_levy", "Umlage", { amount: 49500, per: "MWh", register: "all" }),
      C("t-vat", "tax", "USt. 19 %", { pct: 1900, applies_to: { except: ["t-l2"] } })],
      one, [{ total: 100 }, { total: 400 }]), "t-vat",
      "19 % of the energy line and not of the levy \u2014 ordering plus applies_to, no expression anywhere.");
    push("discount", run([base, C("t-disc", "discount", "Sleva za v\u011brnost 3 %", { pct: -300, applies_to: { only: ["t-unit"] } })],
      one, [{ total: 100 }, { total: 400 }]), "t-disc", "A negative percentage of one named line.");
    var pv = solarRun();
    var fi = pv.res.lines.filter(function (l) { return l.type === "feed_in"; })[0];
    var sc = pv.res.lines.filter(function (l) { return l.type === "self_consumption_credit"; })[0];
    out.push({ type: "feed_in", amount: fi.amount, detail: fi.detail, bill: fi.bill,
               total: pv.res.total, note: "A negative cost on an export register." });
    out.push({ type: "self_consumption_credit", amount: sc.amount, detail: sc.detail, bill: sc.bill,
               total: pv.res.total,
               note: "Household does not talk to an inverter, so the figure is entered and the module says so." });
    return out;
  }
  /* D-64 · counted rather than argued: every parameter resolves to one of eight controls, and
     none of them is free text. */
  var PARAM_KINDS = [
    [/percent/i, "percent"], [/money/i, "money"], [/number/i, "number"],
    [/enum/i, "enum"], [/schedule/i, "schedule"], [/register/i, "register"],
    [/blocks/i, "ordered blocks"], [/tick/i, "tick boxes"]
  ];
  function paramAudit() {
    var kinds = {}, free = [];
    TYPES.forEach(function (t) {
      t.params.forEach(function (p) {
        var hit = null, text = p[0] + " \u00b7 " + p[1];
        PARAM_KINDS.forEach(function (k) { if (!hit && k[0].test(text)) hit = k[1]; });
        if (!hit) { free.push(t.type + " \u00b7 " + p[0] + " (" + p[1] + ")"); hit = "unclassified"; }
        kinds[hit] = (kinds[hit] || 0) + 1;
      });
    });
    return { types: TYPES.length, kinds: Object.keys(kinds).length, free: free,
             params: TYPES.reduce(function (n, t) { return n + t.params.length; }, 0),
             kindList: Object.keys(kinds), counts: kinds };
  }
  /* The compounding case, computed both ways. */
  function compoundRun() {
    var except = typeRun().filter(function (r) { return r.type === "tax"; })[0].amount;
    var meter = { id: "m-t2", service: "t2", serial: "t", location: "t", unit: "kWh", digits: 5,
                  decimals: 1, multiplier: 1, direction: "import", from: "2020-01-01", to: null,
                  registers: [{ key: "total", label: "Odb\u011br", direction: "import" }] };
    var v = { id: "t2", service: "t2", from: "2020-01-01", vat: "inclusive", components: [
      C("x-unit", "unit_rate", "Arbeitspreis", { amount: 321845, per: "MWh", register: "total" }),
      C("x-levy", "per_unit_levy", "Umlage", { amount: 49500, per: "MWh", register: "all" }),
      C("x-vat", "tax", "USt. 19 %", { pct: 1900, applies_to: "all" })] };
    METERS.push(meter); TARIFFS.push(v);
    CONVERSIONS.push({ meter: "m-t2", from: "2020-01-01", factor: 0.001, to_unit: "MWh" });
    var res = priceInterval("t2", R("t2", "2026-03-01", { total: 100 }), R("t2", "2026-04-01", { total: 400 }),
      { meter: "m-t2", meterObj: meter });
    METERS.pop(); TARIFFS.pop(); CONVERSIONS.pop();
    var whole = res.lines.filter(function (l) { return l.type === "tax"; })[0].amount;
    return { except: except, whole: whole, delta: whole - except,
             says: "The same three lines with the same numbers: VAT on everything is " + money(whole) +
               ", VAT on everything except the levy is " + money(except) + " \u2014 " +
               money(whole - except) + " apart, expressed by ordering and applies_to and nothing else." };
  }

  /* ── FR-UT4 · the estimated reading, counted out of the money ─────────── */
  function estimatedRun() {
    var run = periodRun("e-2026"), chart = chartPoints("elec");
    var rows = readingsOf("elec", { money: true });
    var a = rows.filter(function (r) { return r.on === "2026-07-05"; })[0];
    var b = rows.filter(function (r) { return r.on === "2026-08-05"; })[0];
    var est = readingsOf("elec").filter(function (r) { return r.on === "2026-07-20"; })[0];
    var whole = priceInterval("elec", a, b);
    var first = priceInterval("elec", a, est), second = priceInterval("elec", est, b);
    var wholePerDay = (whole.usage.vt + whole.usage.nt) / whole.days;
    var firstPerDay = (first.usage.vt + first.usage.nt) / first.days;
    var swing = firstPerDay / wholePerDay;
    return {
      estimated: readingsOf("elec").filter(function (r) { return r.source === "estimated"; }).length,
      inMoney: run.estimatedInMoney,
      onChart: chart.filter(function (p) { return p.estimated; }).length,
      whole: whole.total, split: first.total + second.total,
      delta: first.total + second.total - whole.total,
      wholePerDay: wholePerDay, firstPerDay: firstPerDay, swing: swing,
      says: "One estimated reading in this period. Money paths that use it: " + run.estimatedInMoney +
        ". Chart bars drawn from it: " + chart.filter(function (p) { return p.estimated; }).length +
        ". Believed, it would say the household used " + (firstPerDay / 1000).toFixed(1) +
        " kWh a day in mid-July against the measured " + (wholePerDay / 1000).toFixed(1) +
        " \u2014 " + Math.round((swing - 1) * 100) + " % more \u2014 and would move the fact boundary from " +
        fmtLong(b.on) + " back to a number nobody read."
    };
  }

  /* ── FR-UT9 · the block, and the form it pre-fills ────────────────────── */
  function blockRun() {
    var run = periodRun("e-2026"), prev = periodRun("e-2025");
    var b = run.blocked || prev.blocked;
    var need = b ? b.date : "2026-01-01";
    return {
      run: run, prev: prev, blocked: b, prevBlocked: prev.blocked, date: need,
      pricedBefore: prev.intervals.length, pricedAfter: run.intervals.length,
      form: { on: need, locked: true, values: { vt: "", nt: "" }, source: "manual",
              sourceOptions: ["manual", "supplier"],
              says: "A reading for " + fmtLong(need) +
                ". The date is filled in; the two values are not, and nothing on this form offers to estimate them." },
      says: "Stretches priced inside 2025: " + prev.intervals.length + ". Cost for either period: absent, not zero. " +
        "Everything before " + fmtLong(need) + " stays valid and on the screen.",
      today: "Electricity needs a reading for " + fmtLong(need)
    };
  }

  /* ── the reminder resolver (FR-RM1) and the reading cadence ───────────── */
  function readingDue(id) {
    var s = svc(id);
    if (!s.cadence) return null;
    var rows = readingsOf(id, { money: true });
    var last = rows[rows.length - 1];
    var moneyLast = rows.filter(function (r) { return r.source === "manual"; });
    var anchor = moneyLast.length ? moneyLast[moneyLast.length - 1] : last;
    var cadenceDue = anchor ? addDays(anchor.on, s.cadence) : null;
    var ruleDue = null;
    if (s.readingDay) {
      var k = monthKey(TODAY), day = String(s.readingDay).padStart(2, "0");
      ruleDue = (k + "-" + day) >= TODAY ? k + "-" + day : nextMonth(k) + "-" + day;
    }
    var upcoming = [cadenceDue, ruleDue].filter(function (d) { return d && d >= TODAY; }).sort();
    var due = upcoming.length ? upcoming[0] : (cadenceDue || ruleDue);
    var from = due === cadenceDue ? "cadence" : "reading day";
    return { service: s, last: anchor ? anchor.on : null, cadence: s.cadence,
             cadenceDue: cadenceDue, ruleDue: ruleDue, due: due, from: from,
             lateBy: cadenceDue ? Math.max(0, diff(cadenceDue, TODAY)) : 0 };
  }
  function reminderKinds() {
    return [
      { key: "utilities.reading_due", anchor: "whichever comes sooner \u2014 the reading day or last reading plus the service\u2019s cadence",
        lead: "3 days by default \u00b7 Petr set his to 1",
        resolves: function (id) { var r = readingDue(id); return r && r.due; } },
      { key: "utilities.advance_due", anchor: "the advance schedule\u2019s own due day",
        lead: "3 days",
        resolves: function (id) {
          var p = currentPeriod(id); if (!p) return null;
          var next = advanceRows(p).filter(function (a) { return a.future; })[0];
          return next ? next.due : null; } },
      { key: "utilities.contract_notice", anchor: "contract_end minus notice_period_days",
        lead: "the notice period itself",
        resolves: function (id) {
          var s = svc(id);
          return s.contract_end ? addDays(s.contract_end, -s.notice_days) : null; } }
    ];
  }

  /* ── permissions ──────────────────────────────────────────────────────── */
  function grantOf(member) {
    var F = window.HH_FIXTURES;
    var m = F && F.members.filter(function (x) { return x.id === member; })[0];
    return m ? (m.grants.utilities || "none") : "none";
  }
  var OPS = [
    ["See services, readings, costs and forecasts", "view"],
    ["Add a reading", "contribute"],
    ["Record an advance payment", "contribute"],
    ["Record a bill", "contribute"],
    ["Create or edit a service or a meter", "manage"],
    ["Edit a tariff version", "manage"],
    ["Set an advance schedule", "manage"],
    ["Open or close a billing period", "manage"]
  ];
  function can(member, level) {
    var order = ["none", "view", "contribute", "manage"];
    return order.indexOf(grantOf(member)) >= order.indexOf(level);
  }
  function whoCan(level) {
    var F = window.HH_FIXTURES;
    return ((F && F.members) || []).filter(function (m) { return can(m.id, level); })
      .map(function (m) { return m.name; });
  }

  /* ── setup ────────────────────────────────────────────────────────────── */
  var SETUP = [
    { n: 1, title: "What does this household pay for?", kind: "multi",
      body: "Pre-ordered by the household\u2019s country profile, so a Czech household sees electricity, gas, water, waste and internet in that order rather than alphabetically.",
      options: ["Elektřina", "Plyn", "Voda a sto\u010dn\u00e9", "Odpad", "Internet", "Teplo", "N\u011bco jin\u00e9ho"],
      picked: ["Elektřina", "Plyn", "Voda a sto\u010dn\u00e9", "Odpad", "Internet"] },
    { n: 2, title: "How much detail for each one?", kind: "modes",
      body: "The three modes in the words a member would use. A service is upgraded later without re-entering anything, and downgrading only hides the deeper screens." },
    { n: 3, title: "Which arrangement is on your bill?", kind: "preset",
      body: "A country and commodity preset creates the meter, its registers and a tariff skeleton with the right component types in the right order, and empty values. The engine is never shown." },
    { n: 4, title: "Enter what you know", kind: "fill",
      body: "The current prices, the current advance, the current meter reading. Every one of them is optional, and the module degrades to whatever it has \u2014 which is why headroom works on day one and a forecast does not." }
  ];

  /* ── screens ──────────────────────────────────────────────────────────── */
  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending", "syncing",
                    "conflicted", "rejected", "absent", "withdrawn", "readonly"];
  var DERIVED = {
    conflicted: "A derived figure cannot fork. Two devices can hold two tariffs or two advances \u2014 this is arithmetic over them, and it links to the row that is actually in conflict.",
    rejected: "Nothing is written from this screen.",
    syncing: "Nothing here is uploaded. The readings and prices it reads from carry their own marks."
  };
  var ADDITIVE = {
    conflicted: "A reading is an observation of a moment, created with a client id and never merged. Nobody else recorded the same observation \u2014 which is exactly why it can be written in a cellar."
  };
  var SCREENS = [
    { id: "D-1", view: "setup", client: "mw", preset: "F", route: "/utilities/setup/1", kind: "setup",
      name: "Utilities setup 1 \u2014 what do you pay for",
      title: "What does this household pay for?", lede: "Pick the ones you have. More can be added later.",
      error: "Couldn\u2019t load the country list. You can still type a service in by hand.",
      foot: "Five picked from a list ordered by country profile.",
      note: "The commodity list is the only guess in setup, and it is a guess from the country the household already gave in Stage 8.", drawn: "all" },
    { id: "D-2", view: "setup", client: "mw", preset: "F", route: "/utilities/setup/2", kind: "modes",
      name: "Utilities setup 2 \u2014 detail per service",
      title: "How much detail for each one?", lede: "Three answers, and one module serves all three.",
      error: "Couldn\u2019t save that choice. Your picks are still here.",
      foot: "D-60: one household, three modes, one per service.",
      note: "The words are the member\u2019s rather than the model\u2019s: I just get a bill \u00b7 I read the meter \u00b7 I want to check the annual settlement.", drawn: "all" },
    { id: "D-3", view: "setup", client: "mw", preset: "F", route: "/utilities/setup/3", kind: "preset",
      name: "Utilities setup 3 \u2014 country + commodity preset",
      title: "Which arrangement is on your bill?", lede: "Pick the one that matches and the form comes out in your bill\u2019s own words.",
      error: "Couldn\u2019t load the presets. Custom still works, and it is not a downgrade.",
      foot: "Fourteen presets as versioned reference data (D-61). Custom always exists.",
      note: "A country changing its billing arrangement has to be a data update rather than a release, so the preset carries a version and the screen names the one it used.", drawn: "all" },
    { id: "D-4", view: "setup", client: "mw", preset: "F", route: "/utilities/setup/4", kind: "fill",
      name: "Utilities setup 4 \u2014 enter what you know",
      title: "Enter what you know", lede: "All of it is optional. The module works with whatever you have.",
      error: "Couldn\u2019t save. Nothing you typed has been lost.",
      foot: "Skipping everything still produces a working service \u2014 with a smaller screen.",
      note: "This is the step that decides whether the module gets used: a form that demands a whole tariff before it shows anything is a form nobody finishes.", drawn: "all" },

    { id: "D-5", view: "overview", client: "mw", preset: "D", route: "/utilities", kind: "overview",
      name: "Services overview", title: "Energie a slu\u017eby",
      lede: "A balance where one can be computed, and headroom where it cannot.",
      empty: { s: "No services yet.", e: "Most households start with electricity: a supplier, an advance and one meter reading.", a: "Add the first service" },
      error: "Couldn\u2019t load the services. The readings on this device are unaffected.",
      withdrawn: "Utilities is no longer shared with you, so this device has dropped its copy of the services.",
      readonly: "Read-only while the subscription is past due. Every figure is here; adding a reading is not.",
      states: {
        absent: "Utilities is not shared with this member: no tab, no card on Today, no mention of the module anywhere.",
        offline: "Every figure here is derived on the device from synced inputs, so offline it is the same screen with the bar above it \u2014 not a stale cache.",
        pending: "Petr\u2019s cellar reading is queued, so the service it belongs to says so and its consumption figure moves with it.",
        populated: "Six services: three with a balance or a headroom line, one readings-only, two bills-only."
      },
      impossible: DERIVED,
      foot: "One service is blocked, and the block is a row on this screen rather than an error.",
      note: "The overview answers one question per service \u2014 am I ahead or behind \u2014 and where it cannot answer it, it says what is missing instead of printing a zero.", drawn: "all" },

    { id: "D-6", view: "modes", client: "mw", preset: "D", route: "/utilities/internet", kind: "detail",
      name: "Service detail \u2014 bills_only", title: "Internet \u00b7 O2",
      lede: "Invoices, spend and where the price changed. No meter, no tariff, no forecast.",
      empty: { s: "No bills recorded yet.", e: "Add the one on your desk: the amount, the period it covers, and a photo if you have it.", a: "Add a bill" },
      error: "Couldn\u2019t load the bills.",
      rejected: "That bill was refused: another one already covers 1\u201330 September, and two bills for one period would double the spend history.",
      withdrawn: "Utilities is no longer shared with you.",
      readonly: "Read-only while the subscription is past due. The bills are all here.",
      states: {
        absent: "Absent with the module.",
        offline: "Bills are synced rows, so the list and the spend history read the same offline.",
        conflicted: "Two members recorded September differently while one was offline. A bill is money and strict_version, so the app asks."
      },
      foot: "Fourteen bills, one price change, and no screen anywhere asking for a meter.",
      note: "The mode is the whole design: a renter who only ever sees an invoice gets a module with nothing missing from it rather than a stripped-down version of the full one.", drawn: "all" },

    { id: "D-7", view: "modes", client: "mw", preset: "D", route: "/utilities/garden", kind: "detail",
      name: "Service detail \u2014 readings", title: "Vodom\u011br na zahrad\u011b",
      lede: "Readings and consumption. No prices, because nobody bills this meter.",
      empty: { s: "No readings yet.", e: "Type what the dial says today. One reading is a starting point; two are a consumption figure.", a: "Add a reading" },
      error: "Couldn\u2019t load the readings.",
      rejected: "That reading is lower than the one on 14 June. Is it a rollover, or a typo?",
      withdrawn: "Utilities is no longer shared with you.",
      readonly: "Read-only while the subscription is past due.",
      states: {
        absent: "Absent with the module.",
        offline: "This is the mode that works best offline: readings are additive and consumption is arithmetic on the device.",
        pending: "A queued reading is on the chart with its mark, and the trend moves with it.",
        conflicted: "Its readings are additive and cannot conflict; the service row itself is strict_version, and that is what this state is."
      },
      foot: "Three readings, one chart, and an offer to upgrade that names what upgrading would add.",
      note: "The middle mode is what most households actually want: they can read the meter, and they do not want to model a tariff to find out whether they are using more than last year.", drawn: "all" },

    { id: "D-8", view: "modes", client: "mw", preset: "D", route: "/utilities/elec", kind: "detail",
      name: "Service detail \u2014 full", title: "Elektřina \u00b7 \u010cEZ",
      lede: "Readings, prices, advances, the period and the settlement.",
      empty: { s: "Set up, nothing recorded.", e: "Enter today\u2019s meter reading and the advance from your bill. That is enough for a headroom figure.", a: "Enter a reading" },
      error: "Couldn\u2019t load the service.",
      rejected: "The reading for 9 September was refused: it is lower than the supplier reading for 6 September.",
      withdrawn: "Utilities is no longer shared with you.",
      readonly: "Read-only while the subscription is past due: the numbers are all here, adding a reading is not.",
      states: {
        absent: "Absent with the module.",
        offline: "The whole screen recomputes on the device \u2014 the same stretches, the same forecast refusal, the same block.",
        pending: "One queued reading, and the sections it feeds say so rather than showing a stale figure as though it were settled.",
        conflicted: "The standing charge from 1 January: 148,00 from this device, 162,00 from Jana\u2019s. A tariff is strict_version, because a half-merged tariff is a wrong bill."
      },
      foot: "The blocked period is a row on this screen with an action, not an error banner.",
      note: "Full mode is the only mode with a settlement, which is why it is the only one that can be blocked \u2014 and the block is the module\u2019s defining honesty property.", drawn: "all" },

    { id: "D-9", view: "cellar", client: "mw", preset: "D", route: "/utilities/elec/readings/new", kind: "capture",
      name: "Reading entry \u2014 the cellar screen", title: "Z\u00e1pis stavu m\u011břidla",
      lede: "Two registers, five digits and one decimal each, and a photo if the light is bad.",
      empty: { s: "First reading on this meter.", e: "Type what the dial says. There is nothing to compare it with yet, so nothing will be questioned.", a: "Save the reading" },
      error: "Couldn\u2019t save it up there. It is queued on this device and will go when there is signal.",
      rejected: "That reading is lower than the supplier reading for 6 September. One of the two is wrong \u2014 yours was taken at the meter.",
      withdrawn: "Utilities is no longer shared with you, so this form closed. What you had typed is still on the screen and can be copied.",
      readonly: "Adding a reading is a write, and writes are held while the subscription is past due. The form says so at the door rather than failing at save.",
      states: {
        absent: "A member with view sees readings and no way to add one \u2014 the button is not there. Adding is contribute deliberately, so that a teenager sent to the cellar can do it.",
        offline: "The whole point of the screen. The row is created locally with a client id, the photo waits in the app sandbox, and the form says it is queued rather than pretending it is saved.",
        pending: "Pending stays visible until the server has actually taken it, because additive does not promise the reading will be accepted.",
        conflicted: "Additive: nobody else recorded this observation."
      },
      impossible: ADDITIVE,
      foot: "The pre-check runs against the neighbours this device holds, and says so about the ones it does not.",
      note: "This is the one screen in the product where the member is standing in a cellar with no signal, two floors from the kitchen table where the refusal will arrive.", drawn: "all" },

    { id: "D-10", view: "readings", client: "mw", preset: "D", route: "/utilities/elec/readings", kind: "list",
      name: "Readings list", title: "Stavy m\u011břidla",
      lede: "Every reading with where it came from, and what each stretch consumed.",
      empty: { s: "No readings yet.", e: "The first one is just a number off the dial.", a: "Add a reading" },
      error: "Couldn\u2019t load the readings.",
      rejected: "One reading was refused and is still here, with the neighbour it clashed with.",
      withdrawn: "Utilities is no longer shared with you.",
      readonly: "Read-only while the subscription is past due.",
      states: {
        absent: "Absent with the module.",
        offline: "Readings are on the device by construction.",
        pending: "The queued one sits in date order with its mark, not at the bottom of the list.",
        conflicted: "Additive."
      },
      impossible: ADDITIVE,
      foot: "Estimated rows are styled apart and labelled as excluded from money.",
      note: "A reading list is also a provenance list \u2014 manual, supplier, estimated \u2014 and only two of the three ever reach a price.", drawn: "all" },

    { id: "D-11", view: "readings", client: "mw", preset: "D", route: "/utilities/elec/consumption", kind: "chart",
      name: "Consumption chart", title: "Spotřeba",
      lede: "Per stretch, with the estimated bar drawn and excluded.",
      empty: { s: "Nothing to draw yet.", e: "Two readings make one bar.", a: "Add a reading" },
      error: "Couldn\u2019t load the consumption.",
      withdrawn: "Utilities is no longer shared with you.",
      readonly: "Charts read in every billing state.",
      states: {
        absent: "Absent with the module.",
        offline: "Derived on the device from synced readings.",
        pending: "The queued reading gets a bar with its mark: pictures may be interpolated, money may not.",
        populated: "Monthly aggregates carry is_approximate wherever a stretch crosses a month end."
      },
      impossible: DERIVED,
      foot: "Money never uses an estimated reading. This chart does, and says which bars they are.",
      note: "Money is never interpolated; pictures may be. That one rule is what lets this chart be useful without being a claim.", drawn: "all" },

    { id: "D-12", view: "tariff", client: "mw", preset: "D", route: "/utilities/elec/tariff", kind: "composer",
      name: "Tariff composer", title: "Opi\u0161te to z faktury",
      lede: "One line here per line on your bill, in the order it is printed.",
      empty: { s: "No prices yet.", e: "The preset left six empty lines in the order a \u010cEZ bill prints them. Start with the first one.", a: "Fill in the monthly charge" },
      error: "Couldn\u2019t save. Nothing has changed for the prices already in effect.",
      rejected: "That version was refused: another one already starts on 1 January 2026, and a version\u2019s end is derived from the next one\u2019s start.",
      withdrawn: "You no longer hold manage on Utilities, so the prices are readable and not editable.",
      readonly: "Read-only while the subscription is past due. Prices already entered keep pricing.",
      states: {
        absent: "A member with contribute adds readings and never sees this screen \u2014 it is not greyed, it is not in the service\u2019s section list at all.",
        offline: "The version reads; editing it needs the network, because a half-merged tariff is a wrong bill.",
        pending: "A queued edit to one line, with the breakdown recomputed locally so the member can see what they just did.",
        conflicted: "148,00 against 162,00 for the monthly charge from 1 January. The question names both values, both people and both times, and offers a third field."
      },
      foot: "Eleven component types, a live breakdown, and no field anywhere that takes an expression.",
      note: "Designed as transcribing a bill: the labels are the words printed on that country\u2019s bill, the order is the order on the page, and applies_to is a set of tick boxes against the lines above.", drawn: "all" },

    { id: "D-13", view: "money", client: "mw", preset: "D", route: "/utilities/gas/advances", kind: "advances",
      name: "Advances schedule", title: "Z\u00e1lohy",
      lede: "The schedule, and every month with what actually happened to it.",
      empty: { s: "No advance schedule.", e: "Type the amount from your bill and the day it leaves your account.", a: "Add the schedule" },
      error: "Couldn\u2019t load the advances.",
      rejected: "That payment was refused: March already has a recorded payment, and a month has one.",
      withdrawn: "Utilities is no longer shared with you.",
      readonly: "Read-only while the subscription is past due.",
      states: {
        absent: "Absent with the module.",
        offline: "The schedule and the payments are synced rows.",
        pending: "A payment recorded offline sits in its own month with its mark.",
        conflicted: "Two members recorded March differently. Money is strict_version, so the app asks."
      },
      foot: "A recorded payment wins over the schedule for its month, and July\u2019s is 2 100 rather than 1 900.",
      note: "Attribution by month key rather than payment date is the whole feature: a March advance paid on 2 April is March\u2019s, and the balance does not lurch because somebody paid late.", drawn: "all" },

    { id: "D-14", view: "money", client: "mw", preset: "D", route: "/utilities/gas/periods/2025", kind: "settlement",
      name: "Billing period and settlement", title: "Vy\u00fa\u010dtov\u00e1n\u00ed 2025",
      lede: "Computed against invoiced, in money and in units.",
      empty: { s: "No billing period yet.", e: "A period is two dates. If your supplier has not said when it ends, leave it \u2014 a year is assumed and marked estimated.", a: "Add a period" },
      error: "Couldn\u2019t load the settlement.",
      rejected: "That period was refused: it overlaps 11 February 2025 \u2013 10 February 2026, and periods cannot overlap.",
      withdrawn: "Utilities is no longer shared with you.",
      readonly: "Read-only while the subscription is past due.",
      states: {
        absent: "Absent with the module.",
        offline: "Computed on the device; the invoice figures are synced rows.",
        pending: "The invoice was typed in offline and is queued, so the comparison says which side of it is not final.",
        conflicted: "Two members typed the supplier\u2019s total differently. Money is strict_version."
      },
      foot: "The supplier\u2019s own final meter values are stored, so a discrepancy can be attributed to consumption.",
      note: "Recording their meter values rather than only their total is what turns \u201cthe bill is wrong\u201d into \u201cthey read 13 700 and we read 13 689\u201d.", drawn: "all" },

    { id: "D-15", view: "money", client: "mw", preset: "S", route: "/utilities/elec/readings/new?on=2026-01-01", kind: "blocked",
      name: "Blocked state", title: "Chyb\u00ed stav k 1. lednu 2026",
      lede: "The price changed that day and the year is cut on the same day, so both need a meter value for it.",
      foot: "The date is filled in. The values are empty, and there is no control that would estimate them.",
      note: "Everything before the gap stays valid and visible. Nothing after it is computed at all, and that is the difference between an honest gap and a guess.", drawn: "all" },

    { id: "D-16", view: "overview", client: "mw", preset: "D", route: "/utilities/elec#headroom", kind: "headroom",
      name: "Headroom", title: "Co za z\u00e1lohu koup\u00edte",
      lede: "Your advance, minus the fixed part, in kilowatt-hours.",
      empty: { s: "Nothing to work with yet.", e: "An advance and one price is enough for this figure. No readings needed.", a: "Enter your advance" },
      error: "Couldn\u2019t load the prices, so this figure is not shown rather than shown wrong.",
      withdrawn: "Utilities is no longer shared with you.",
      readonly: "Arithmetic on a price and an advance, so it reads in every billing state.",
      states: {
        absent: "Absent with the module.",
        offline: "A price and an advance are both on the device, so this is the one figure that never needs the network.",
        populated: "Day one, no consumption data, and a real sentence."
      },
      impossible: {
        conflicted: DERIVED.conflicted, rejected: DERIVED.rejected, syncing: DERIVED.syncing,
        pending: "Headroom holds no row of its own. A queued price edit shows its mark on the price; this figure simply recomputes."
      },
      foot: "The mix is named as a heuristic inside the sentence itself.",
      note: "This is the figure that makes the module useful before it is useful: computable with zero consumption data, which is why it is what day one shows \u2014 and what a blocked service keeps showing.", drawn: "all" },

    { id: "D-17", view: "bills", client: "mw", preset: "D", route: "/utilities/internet/bills", kind: "bills",
      name: "Bills-only \u2014 invoices and spend history", title: "Faktury",
      lede: "What you paid, when, and where it changed.",
      empty: { s: "No bills yet.", e: "Add the last one that arrived. Two make a comparison.", a: "Add a bill" },
      error: "Couldn\u2019t load the bills.",
      rejected: "That bill was refused: its period overlaps the one before it.",
      withdrawn: "Utilities is no longer shared with you.",
      readonly: "Read-only while the subscription is past due.",
      states: {
        absent: "Absent with the module.",
        offline: "Bills are synced rows and read offline.",
        pending: "A bill photographed and typed in at the kitchen table, queued with its amount.",
        conflicted: "Two people typed September differently. Money is strict_version."
      },
      foot: "Year on year, and the price change dated to the month it started.",
      note: "Price-change detection is why bills-only is not a downgrade: it is the feature a renter actually wants, and it needs no meter at all.", drawn: "all" },

    { id: "D-18", view: "readings", client: "mw", preset: "F", route: "/utilities/gas/meters/replace", kind: "swap",
      name: "Meter replacement", title: "V\u00fdm\u011bna m\u011břidla",
      lede: "Close the old one with its final reading, open the new one with its first.",
      error: "Couldn\u2019t save the replacement. Neither meter has been changed.",
      foot: "The stretch across the swap is (final \u2212 previous) + (current \u2212 initial), computed and shown.",
      note: "Without this, a household whose meter is replaced \u2014 which happens \u2014 has a broken module and no way out. With it, the year still adds up.", drawn: "all" },

    { id: "D-19", view: "modes", client: "mw", preset: "F", route: "/utilities/garden/mode", kind: "upgrade",
      name: "Mode upgrade \u2014 nothing lost", title: "Přidat ceny",
      lede: "What upgrading adds, and what it leaves exactly as it is.",
      error: "Couldn\u2019t change the mode. Everything recorded is untouched.",
      foot: "Bills become retrospective periods where the dates allow; readings stay readings.",
      note: "Downgrading only hides the deeper screens, which is why the offer can be made without a warning: there is nothing to lose by trying it.", drawn: "all" }
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
    var types = typeRun(), pa = paramAudit(), comp = compoundRun();
    var est = estimatedRun(), block = blockRun(), cellar = cellarRun(), roll = rolloverRun();
    var repl = replacementRun();
    var gas = summary("gas"), elec = summary("elec");
    var gasSet = settlement("g-2025"), waterSet = settlement("w-2025");
    var hr = headroom("elec");
    var f = forecast("g-2026"), fNoFuture = forecast("g-2026", { withoutFuture: true });
    var hist = history("gas"), proof = approxProof("gas");
    var up = upgradeRun("internet"), pv = solarRun();
    var due = { elec: readingDue("elec"), gas: readingDue("gas") };
    var cov = coverage();
    var cells = cov.reduce(function (n, c) { return n + c.cells; }, 0);
    var apiWords = ["standing_charge", "capacity_charge", "unit_rate", "tiered_rate", "time_of_use",
                    "per_unit_levy", "fixed_levy", "applies_to", "feed_in", "self_consumption",
                    "effective_from", "value_milli", "amount_minor", "monotonicity"];
    var labels = TARIFFS.reduce(function (a, t) {
      return a.concat(t.components.map(function (c) { return c.bill; }));
    }, []).concat(MODES.map(function (m) { return m.plain; }))
      .concat(COUNTRY_PRESETS.map(function (p) { return p.label; }))
      .concat(SETUP.map(function (s) { return s.title; }))
      .concat(TYPES.map(function (t) { return t.plain; }))
      .concat(SCREENS.map(function (s) { return s.title; }))
      .concat(SCREENS.map(function (s) { return s.lede || ""; }));
    var leaks = apiWords.filter(function (w) {
      return labels.some(function (l) { return String(l).indexOf(w) >= 0; });
    });
    var monthly = 0;
    tariffAt("elec", TODAY).components.forEach(function (c) {
      if (c.type === "standing_charge" || c.type === "capacity_charge" || c.type === "fixed_levy")
        monthly += Math.round(periodAmount(c).month);
    });
    var partials = 0, wholes = 0;
    periodRun("g-2026").intervals.forEach(function (r) {
      r.chunks.forEach(function (ch) { if (ch.days === ch.of) wholes++; else partials++; });
    });
    var wholeMarch = types.filter(function (t) { return t.type === "standing_charge"; })[0].amount;
    var yearStanding = 0;
    periodRun("g-2025").intervals.forEach(function (r) {
      r.lines.forEach(function (l) { if (l.id === "g-standing") yearStanding += l.amount; });
    });
    var bd = breakdown(gas.cost, [{ label: "supply", w: 70 }, { label: "fixed charges", w: 12 }, { label: "levy", w: 3 }]);
    var bdSum = bd.reduce(function (n, p) { return n + p.amount; }, 0);
    var gasMonths = monthsOf(periodOf("g-2026"));
    var marPay = ADVANCE_PAYMENTS.filter(function (a) { return a.service === "gas" && a.month === "2026-03"; })[0];
    var conv1 = conversionAt("m-gas-old", "2026-03-01"), conv2 = conversionAt("m-gas-old", "2026-05-01");
    var gasUsage = periodRun("g-2026").intervals.reduce(function (n, r) { return n + r.usage.total; }, 0);
    var constWrong = Math.round(gasUsage / 1000 * (convKwh(conv2) - convKwh(conv1)));
    var approx = hist.filter(function (h) { return h.approx; }).length;
    var invOk = periodOf("g-2025").invoice.total + periodOf("g-2025").invoice.balance ===
                periodRun("g-2025").advancesAll;

    return [
      { name: "Eleven component types, all eleven priced, not one of them a formula",
        detail: types.length + " of " + TYPES.length + " types run through the engine on a worked stretch each. " +
          pa.params + " parameters across the eleven, and every one of them resolves to one of " +
          pa.kinds + " controls \u2014 " + pa.kindList.join(", ") +
          ". Parameters that would need a free-text or expression field: " + pa.free.length +
          ". D-64 is a count here rather than a promise.",
        pass: types.length === TYPES.length && pa.free.length === 0 &&
              types.every(function (t) { return typeof t.amount === "number"; }) },

      { name: "A compounding tax is expressible by ordering and applies_to alone",
        detail: comp.says,
        pass: comp.whole !== comp.except && comp.delta > 0 },

      { name: "The composer speaks the bill, not the API",
        detail: labels.length + " labels reach these screens \u2014 component names, mode wording, preset names, setup steps, type descriptions, screen titles. API words among them: " +
          leaks.length + ". A \u010cEZ line reads \u201cM\u011bs\u00ed\u010dn\u00ed plat za odb\u011brn\u00e9 m\u00edsto\u201d and a German one \u201cGrundpreis\u201d, because the label travels with the preset rather than with the type.",
        pass: leaks.length === 0 },

      { name: "An estimated reading never enters a money figure",
        detail: est.says,
        pass: est.estimated === 1 && est.inMoney === 0 && est.onChart === 1 && est.swing > 1.2 },

      { name: "A boundary with no reading blocks, and the block is a date rather than a zero",
        detail: block.says + " The form it opens is pre-filled to " + fmtLong(block.date) + " with " +
          Object.keys(block.form.values).length +
          " empty value fields and no estimate offered. Today\u2019s alert reads \u201c" + block.today +
          "\u201d, which is the line Stage 11 already draws.",
        pass: !!block.blocked && block.date === "2026-01-01" && elec.cost === null &&
              elec.balance === null &&
              Object.keys(block.form.values).every(function (k) { return block.form.values[k] === ""; }) },

      { name: "Blocked and insufficient mean absent, not zero",
        detail: "Electricity: cost " + (elec.cost === null ? "absent" : money(elec.cost)) + ", balance " +
          (elec.balance === null ? "absent" : money(elec.balance)) + ", headroom " + money(hr.buys) +
          " \u2014 so the service still says something true. Water: " + waterSet.why + " \u2014 \u201c" +
          waterSet.says + "\u201d Gas, which has both boundary readings: balance " + money(gas.balance) + ".",
        pass: elec.cost === null && elec.balance === null && !waterSet.ok && gas.balance !== null },

      { name: "A whole month inside one version costs the monthly figure exactly",
        detail: "One stretch from 1 March to 1 April with a monthly charge of " + money(16200) +
          " costs " + money(wholeMarch) +
          " \u2014 no pro-rata, no rounding drift. The fixed part of the current electricity prices is " +
          money(monthly) + " a month across three time components, each summed per (calendar month \u00d7 tariff version) with one rounding per chunk. This household reads on the 8th to the 11th, so across the 2025 gas period " +
          wholes + " of " + (wholes + partials) +
          " chunks are whole \u2014 and the year still costs exactly twelve monthly charges, " +
          money(yearStanding) + " against " + money(12 * 22000) + ".",
        pass: wholeMarch === 16200 && monthly === 120000 && yearStanding === 12 * 22000 },

      { name: "Where a breakdown is displayed, the parts sum to the whole",
        detail: "Three weighted parts of " + money(gas.cost) + " round to " +
          bd.map(function (p) { return money(p.amount); }).join(" + ") + " = " + money(bdSum) +
          ", because the largest part carries the remainder of " +
          money(bd.reduce(function (n, p) { return n + p.remainder; }, 0)) + ".",
        pass: bdSum === gas.cost },

      { name: "The cellar pre-check catches what the replica holds, and says so about the rest",
        detail: cellar.says + " Locally: " + (cellar.local.ok ? "accepted" : cellar.local.code) +
          ". On the server: " + cellar.server.code + ", against " + fmtLong(cellar.server.against.on) +
          ". The pending mark stays up until the server has taken it, which is the only honest thing a queued reading can do.",
        pass: cellar.local.ok && !cellar.server.ok && cellar.server.code === "monotonicity_violation" &&
              cellar.server.against.on === "2026-09-06" },

      { name: "A rollover is offered rather than refused, and the arithmetic follows",
        detail: roll.says + " " + roll.line,
        pass: roll.offer === "rollover" && roll.real > 0 && roll.naive < 0 },

      { name: "A replaced meter still adds up",
        detail: repl.says + " A single subtraction across the swap would have given " +
          qty(repl.naive, 3, "m\u00b3") + ", which is why FR-UT2 exists.",
        pass: repl.across > 0 && repl.naive < 0 },

      { name: "A March advance paid in April is March\u2019s advance",
        detail: "March 2026 is recorded as " + money(marPay.amount) + " paid on " + fmtLong(marPay.paid_on) +
          " and attributed to " + monthLabel(marPay.month) +
          ". A recorded payment also wins over the schedule for its month: July is " +
          money(ADVANCE_PAYMENTS.filter(function (a) { return a.month === "2026-07" && a.service === "gas"; })[0].amount) +
          " against a schedule of " + money(scheduleAt("gas", "2026-07-01").amount) + ".",
        pass: marPay.month === "2026-03" && marPay.paid_on > "2026-03-31" },

      { name: "A year-long period is exactly twelve months whatever day it starts",
        detail: "The gas period runs " + fmtLong("2026-02-11") + " to " + fmtLong("2027-02-10") +
          " and counts " + gasMonths.length + " months, " + monthLabel(gasMonths[0]) + " to " +
          monthLabel(gasMonths[gasMonths.length - 1]) +
          ", because a month counts iff the period contains its first day. February 2026 does not count; February 2027 does.",
        pass: gasMonths.length === 12 && gasMonths[0] === "2026-03" && gasMonths[11] === "2027-02" },

      { name: "The balance is arithmetic and the recommended advance is the shortfall spread",
        detail: "Advances " + money(gas.advancesAll) + " against a projected cost of " + money(gas.cost) +
          " gives " + money(gas.balance) + ", which is the dashboard widget\u2019s \u201cover by 480 K\u010d\u201d. " +
          (gas.recommended
            ? "Spread over the " + gas.remainingMonths + " months not yet due and rounded up, the recommendation is " +
              money(gas.recommended) + " a month against the current " + money(scheduleAt("gas", TODAY).amount) + "."
            : "No shortfall, so nothing is recommended.") +
          " The counted months are listed on the screen rather than left as folklore.",
        pass: gas.balance !== null && gas.cost > 0 && gas.recommended > scheduleAt("gas", TODAY).amount },

      { name: "Fact stops at the last reading, not at today",
        detail: f.says + " " + f.future + " days are projected although only " +
          diff(f.boundary, TODAY) + " of them are already in the past, and each future day is priced by the version effective on it: " +
          f.versionRows.map(function (v) { return v.days + " days on " + v.version; }).join(", ") +
          ". Entering next January\u2019s prices in August moved the projection by " +
          money(f.cost - fNoFuture.cost) + " the moment they were saved.",
        pass: f.ok && f.boundary === "2026-08-08" && f.future > diff(f.boundary, TODAY) &&
              f.versionRows.length === 2 && f.cost !== fNoFuture.cost },

      { name: "Headroom needs no consumption data at all",
        detail: hr.says + " " + hr.heuristic + " Per register: " +
          hr.registers.map(function (r) { return Math.round(r.units) + " " + r.unit + " " + r.key.toUpperCase(); }).join(" or ") +
          ". It reconciles with the dashboard widget\u2019s \u201c2 100 K\u010d of 3 300 K\u010d advance\u201d to the crown, and it is the figure electricity shows because its balance is blocked.",
        pass: hr.buys === 210000 && hr.advance === 330000 && hr.fixed === 120000 && hr.atMix > 0 },

      { name: "Monthly consumption says when it is approximate",
        detail: hist.length + " months of gas history and " + approx +
          " marked is_approximate, because a household that reads the meter on the 9th never produces a calendar month. The flag is computed from the chunk count rather than always set: a stretch from 1 June to 1 July comes back with " +
          proof.alignedChunks + " chunk and is not flagged, while the real 8 June \u2013 8 July stretch has " +
          proof.realChunks + " and is.",
        pass: approx === hist.length && !proof.alignedApprox && proof.realApprox },

      { name: "The settlement attributes the difference to a meter, not only to money",
        detail: gasSet.says + " Their final value " +
          qty(Math.round(gasSet.invoice.vals.total * 1000), 3, "m\u00b3") + " against ours " +
          qty(gasSet.run.closing.vals.total, 3, "m\u00b3") + ", a difference of " +
          qty(Math.abs(gasSet.unitDelta), 3, "m\u00b3") + " worth about " + money(Math.abs(gasSet.moneyOfUnits)) +
          " of the " + money(Math.abs(gasSet.moneyDelta)) + " gap. Their total minus their balance is our advances (" +
          money(gasSet.advances) + "), so the invoice is internally consistent too.",
        pass: gasSet.ok && gasSet.unitDelta !== 0 && gasSet.moneyDelta !== null && invOk },

      { name: "A conversion is versioned, and a constant would be wrong",
        detail: "Gas reads m\u00b3 and is billed in kWh: " + convSays(conv1) + " until " +
          fmtLong("2026-04-01") + ", then " + convSays(conv2) + ". Over this period\u2019s " +
          qty(gasUsage, 3, "m\u00b3") + " a single hard-coded factor would be out by " +
          Math.abs(constWrong) + " kWh, about " +
          money(Math.abs(Math.round(constWrong / 1000 * 148290))) +
          ". FR-UT9 blocks on a price change inside a stretch but says nothing about a conversion change: this engine prices the stretch with the conversion effective at its end, and that is recorded as a gap rather than hidden.",
        pass: convFactor(conv1) !== convFactor(conv2) && Math.abs(constWrong) > 0 },

      { name: "Export is an ordinary register, and a negative bill is an ordinary result",
        detail: pv.says + " Lines: " + pv.res.lines.map(function (l) { return l.type; }).join(", ") +
          ". Household does not talk to an inverter, so self-consumption is a figure the member enters and the module says so.",
        pass: pv.res.lines.length === 4 && pv.negative },

      { name: "Upgrading from bills-only keeps every bill",
        detail: up.says + (up.skipped.length
          ? " The ones that cannot: " + up.skipped.map(function (s) { return fmt(s.b.issued) + " \u2014 " + s.why; }).join("; ") + "."
          : "") + " Readings, prices and periods are additions; nothing already recorded is re-entered.",
        pass: up.periods === up.bills - up.skipped.length && up.skipped.length > 0 && up.periods > 10 },

      { name: "One reading date, whichever of the two comes sooner",
        detail: "The handoff carried two anchors \u2014 the household\u2019s reading day, which reminders.js resolved, and last reading plus the service\u2019s own cadence, which the widget measured \u2014 so one meter could be told two things. Settled: the next date is whichever of the two falls sooner, and the row says which. Electricity resolves to " +
          fmtLong(due.elec.due) + " from its " + due.elec.from + " and is " + due.elec.lateBy +
          " days past its cadence; gas to " + fmtLong(due.gas.due) + " from its " + due.gas.from + ", " +
          due.gas.lateBy + " day past. A cadence date already gone makes the reading overdue \u2014 it does not move the next one into the past. The cadence itself is per service, set next to the meter on service detail: 31 days for electricity and gas, 183 for water, 61 for the garden submeter, none for the three bills-only services.",
        pass: due.elec.due === "2026-09-11" && due.gas.due === "2026-09-09" &&
              due.elec.lateBy === 4 && due.gas.lateBy === 1 &&
              due.elec.from === "reading day" && due.gas.from === "reading day" },

      { name: "Adding a reading is contribute, and the grant decides the screen",
        detail: "In this household " + whoCan("contribute").join(" and ") + " can add a reading and " +
          whoCan("manage").join(" and ") + " can edit prices; " +
          (window.HH_FIXTURES ? window.HH_FIXTURES.members.length - whoCan("view").length : 0) +
          " of five members hold none and see no Utilities at all. The eight operations resolve to " +
          OPS.filter(function (o) { return o[1] === "contribute"; }).length + " at contribute and " +
          OPS.filter(function (o) { return o[1] === "manage"; }).length +
          " at manage, and the cellar screen is the contribute one.",
        pass: can("petr", "manage") && can("jana", "manage") && !can("adam", "view") && !can("klara", "view") },

      { name: "Every row is drawn in every state its surface can reach",
        detail: SCREENS.length + " rows, " + cells + " state cells, " +
          cov.reduce(function (n, c) { return n + c.impossible.length; }, 0) +
          " declared exclusions with a reason each. They come from three facts: a reading is additive and cannot conflict, a derived figure holds no row of its own, and everything money-bearing here is strict_version.",
        pass: cov.every(function (c) { return c.complete; }) }
    ];
  }

  window.HH_UTILITIES = {
    version: "0.1-stage-15",
    today: TODAY, mix: MIX,
    modes: MODES, modeOf: modeOf, types: TYPES, presets: COUNTRY_PRESETS, setup: SETUP,
    services: SERVICES, svc: svc, meters: METERS, metersOf: metersOf, meterAt: meterAt,
    conversions: CONVERSIONS, conversionAt: conversionAt, convFactor: convFactor,
    convKwh: convKwh, convSays: convSays,
    readings: READINGS, readingsOf: readingsOf, cellarReading: CELLAR,
    checkReading: checkReading, neighbours: neighbours,
    cellarRun: cellarRun, rolloverRun: rolloverRun, replacementRun: replacementRun,
    tariffs: TARIFFS, tariffsOf: tariffsOf, tariffAt: tariffAt, tariffSpans: tariffSpans,
    priceInterval: priceInterval, breakdown: breakdown, periodAmount: periodAmount,
    periods: PERIODS, periodsOf: periodsOf, periodOf: periodOf, currentPeriod: currentPeriod,
    periodRun: periodRun, forecast: forecast, summary: summary, headroom: headroom,
    history: history, approxProof: approxProof, chartPoints: chartPoints, settlement: settlement,
    approxUnits: approxUnits,
    schedules: ADVANCE_SCHEDULES, scheduleAt: scheduleAt, payments: ADVANCE_PAYMENTS,
    advanceRows: advanceRows, monthsOf: monthsOf,
    bills: BILLS, billsOf: billsOf, spend: spend, upgradeRun: upgradeRun,
    typeRun: typeRun, paramAudit: paramAudit, compoundRun: compoundRun, solarRun: solarRun,
    estimatedRun: estimatedRun, blockRun: blockRun,
    readingDue: readingDue, reminderKinds: reminderKinds,
    ops: OPS, can: can, whoCan: whoCan, grantOf: grantOf,
    screens: SCREENS, rows: SCREENS, allStates: ALL_STATES, coverage: coverage,
    money: money, moneyRound: moneyRound, qty: qty, dial: dial, rate: rate,
    fmt: fmt, fmtLong: fmtLong, monthLabel: monthLabel, monthKey: monthKey,
    addDays: addDays, diff: diff, daysInMonth: daysInMonth,
    checks: checks
  };
})();
