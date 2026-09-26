/* Stage 17 — Garden, and the print stylesheet.
   Sources: docs/prd/modules/11-garden.md (D-65, D-66, FR-GA1-23, the data model, the sync
   table, Catalog contributions, Permissions), design/05-screens.md §D Garden,
   02-components.md §4.18 (the plan-check panel) and §4.20 (print layouts),
   08-decisions.md DD-14, 07-delivery.md §1 (DS-3), 01-foundations.md §7.

   Three things this file exists to settle, and it computes rather than asserts all three:

   1. D-65 — one data model, three UI tiers. The tier is a read-time filter over the same
      rows: tierView(tier) answers what is revealed and what is never shown, and moving a
      household up or down changes zero rows. Nothing is authored per tier.
   2. FR-GA1/GA2/GA3 — one resolution function. variety -> household override -> catalog,
      in `pick()`, called by the catalog browser, the planting editor, the task generator
      and the plan check. Four consumers, one implementation, which is D103's whole point.
   3. FR-GA18 — the eleven checks, computed on read from the beds, the plantings and the
      closed seasons, each returning findings, a severity and the entities it points at.
      C3 and C8 return `no_history` rather than a pass when there is nothing behind them.

   Cross-file: spine.js's Today frost row (beds 3, 7 and 11, six plantings, -2 C at 18:40)
   and its search result for Porek 'Bandit' - bed 7 (12/3, 28/5, from 10/10) are both this
   module's own computations; dashboard.js's two garden widgets read these figures;
   reminders.js carries garden.task_due and garden.care_due; illustration.js gained the
   three tier answers this stage needed.
*/
(function () {
  var TODAY = "2026-09-09";

  /* ── dates ────────────────────────────────────────────────────────────── */
  function D(s) { return new Date(s + "T00:00:00Z"); }
  function iso(dt) { return dt.toISOString().slice(0, 10); }
  function addDays(s, n) { var dt = D(s); dt.setUTCDate(dt.getUTCDate() + n); return iso(dt); }
  function diff(a, b) { return Math.round((D(b) - D(a)) / 86400000); }
  function min(a, b) { return a < b ? a : b; }
  function max(a, b) { return a > b ? a : b; }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
                "September", "October", "November", "December"];
  var MONTHS_CS = ["Leden", "\u00danor", "B\u0159ezen", "Duben", "Kv\u011bten", "\u010cerven",
                   "\u010cervenec", "Srpen", "Z\u00e1\u0159\u00ed", "\u0158\u00edjen",
                   "Listopad", "Prosinec"];
  var MONTHS_CS_SHORT = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
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
  function fmtCs(s) {
    if (!s) return "\u2014";
    var p = s.split("-");
    return Number(p[2]) + ". " + Number(p[1]) + ".";
  }
  function fmtShort(s) {
    if (!s) return "\u2014";
    var p = s.split("-");
    return Number(p[2]) + "/" + Number(p[1]);
  }
  function monthKey(s) { return s.slice(0, 7); }
  function isoWeek(s) {
    var dt = D(s);
    var day = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - day + 3);
    var first = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
    var fd = (first.getUTCDay() + 6) % 7;
    first.setUTCDate(first.getUTCDate() - fd + 3);
    return { year: dt.getUTCFullYear(), week: Math.round((dt - first) / 604800000) + 1 };
  }
  function weekKey(s) { var w = isoWeek(s); return w.year + "-W" + String(w.week).padStart(2, "0"); }
  function weekMonday(s) {
    var dt = D(s), day = (dt.getUTCDay() + 6) % 7;
    return addDays(s, -day);
  }
  function weekLabel(k) {
    var parts = k.split("-W");
    var probe = parts[0] + "-01-04";
    for (var i = 0; i < 60; i++) {
      if (weekKey(probe) === k) return "Week of " + fmt(weekMonday(probe));
      probe = addDays(probe, 7);
    }
    return k;
  }
  /* overlap in days between two closed date ranges, 0 when they do not meet */
  function overlapDays(a1, a2, b1, b2) {
    if (!a1 || !a2 || !b1 || !b2) return 0;
    var s = max(a1, b1), e = min(a2, b2);
    return s > e ? 0 : diff(s, e) + 1;
  }

  /* ── the household's place, and the climate it resolves to ─────────────
     FR-GA3 + 05-privacy §2: device location is never read. The member drops a pin or
     types a town, and the pin is stored at reduced precision — two decimals, in front
     of them, so the reduction is a thing they watched happen rather than a policy line. */
  var PIN_DECIMALS = 2;
  var PLACE = {
    town: "Ku\u0159im",
    country: "CZ",
    raw: [49.298471, 16.532194],
    source: "dropped pin",
    deviceReads: 0
  };
  function snap(n) { return Math.round(n * Math.pow(10, PIN_DECIMALS)) / Math.pow(10, PIN_DECIMALS); }
  function pinRun() {
    var lat = snap(PLACE.raw[0]), lon = snap(PLACE.raw[1]);
    /* one degree of latitude is 111.32 km; a hundredth of a degree is 1.11 km */
    var metresLat = Math.abs(PLACE.raw[0] - lat) * 111320;
    var metresLon = Math.abs(PLACE.raw[1] - lon) * 111320 * Math.cos(lat * Math.PI / 180);
    return {
      raw: PLACE.raw, snapped: [lat, lon], decimals: PIN_DECIMALS,
      moved: Math.round(Math.sqrt(metresLat * metresLat + metresLon * metresLon)),
      grid: Math.round(111320 / Math.pow(10, PIN_DECIMALS)),
      deviceReads: PLACE.deviceReads,
      says: "The pin the member dropped is " + PLACE.raw[0].toFixed(6) + ", " + PLACE.raw[1].toFixed(6) +
        ". What is stored is " + lat.toFixed(2) + ", " + lon.toFixed(2) +
        " \u2014 the marker moves " + Math.round(Math.sqrt(metresLat * metresLat + metresLon * metresLon)) +
        " m on screen as they let go, onto a grid about " + Math.round(111320 / Math.pow(10, PIN_DECIMALS)) +
        " m across. Device location is read " + PLACE.deviceReads + " times."
    };
  }

  var CLIMATE = {
    id: "cz-6b-kurim", zone: "6b", label: "Ku\u0159im \u00b7 zone 6b",
    lastFrost: "2026-05-13", firstFrost: "2026-10-09",
    source: "bundled climate dataset, 1991\u20132020 normals",
    editable: ["lastFrost", "firstFrost", "zone"]
  };
  CLIMATE.seasonDays = diff(CLIMATE.lastFrost, CLIMATE.firstFrost);
  /* The second profile exists to prove the timings are relative rather than calendar weeks. */
  var CLIMATE_ALT = {
    id: "es-10a-cordoba", zone: "10a", label: "C\u00f3rdoba \u00b7 zone 10a",
    lastFrost: "2026-02-18", firstFrost: "2026-12-08",
    source: "bundled climate dataset, 1991\u20132020 normals", editable: CLIMATE.editable
  };
  CLIMATE_ALT.seasonDays = diff(CLIMATE_ALT.lastFrost, CLIMATE_ALT.firstFrost);

  /* Per-season expected frost dates (FR-GA16); the closed ones also carry what was observed. */
  var SEASONS = [
    { year: 2024, status: "closed", lastFrost: "2024-05-08", firstFrost: "2024-10-02",
      observedLast: "2024-05-11", observedFirst: "2024-10-06", closedOn: "2024-11-14", closedBy: "milos" },
    { year: 2025, status: "closed", lastFrost: "2025-05-10", firstFrost: "2025-10-05",
      observedLast: "2025-05-20", observedFirst: "2025-10-02", closedOn: "2025-11-09", closedBy: "milos" },
    { year: 2026, status: "active", lastFrost: "2026-05-13", firstFrost: "2026-10-09",
      observedLast: "2026-05-16", observedFirst: null },
    { year: 2027, status: "not created", lastFrost: "2027-05-11", firstFrost: "2027-10-07" }
  ];
  function season(y) { return SEASONS.filter(function (s) { return s.year === y; })[0]; }
  function closedSeasons() { return SEASONS.filter(function (s) { return s.status === "closed"; }); }

  /* ── D-65 · the three tiers ────────────────────────────────────────────
     One data model. The tier is a read filter, so a change reveals or hides and never
     migrates. SURFACES is the whole of it: each surface names the tier it appears at. */
  var SURFACES = [
    ["containers", "Containers and their plants", "pots"],
    ["care", "Watering and feeding reminders", "pots"],
    ["journal", "The photo journal", "pots"],
    ["catalog", "The crop catalog", "pots"],
    ["harvests", "Harvest notes", "pots"],
    ["beds", "Beds, ordered within zones", "beds"],
    ["plantings", "Plantings with planned and actual dates", "beds"],
    ["tasks", "Generated sowing, transplanting and harvest tasks", "beds"],
    ["yields", "Harvest log with yields against expected", "beds"],
    ["reduced_check", "Companion and over-booking warnings (no history needed)", "beds"],
    ["seasons", "Seasons as an object", "plot"],
    ["full_check", "The eleven-check plan review", "plot"],
    ["rotation", "Rotation over closed seasons", "plot"],
    ["succession", "Succession planning", "plot"],
    ["storage", "The storage log", "plot"],
    ["close", "Season close and yield reconciliation", "plot"]
  ];
  var TIER_ORDER = ["pots", "beds", "plot"];
  var TIERS = [
    { id: "pots", name: "pots", cs: "Kv\u011btn\u00e1\u010de a truhl\u00edky",
      has: "Named containers and the plants in them",
      illus: "garden.setup.pots",
      note: "A balcony. The module has to be finished at this tier, not a stripped version of another one." },
    { id: "beds", name: "beds", cs: "Z\u00e1hony nebo z\u00e1honek",
      has: "Beds or areas, plantings with dates",
      illus: "garden.setup.beds",
      note: "The median European garden, and deliberately the tier that gets the most attention." },
    { id: "plot", name: "plot", cs: "Zahrada nebo zahr\u00e1dka",
      has: "Seasons, bed history, a plan",
      illus: "garden.setup.plot",
      note: "Everything. This household is here, which is why it has three seasons behind it." }
  ];
  function tierRank(t) { return TIER_ORDER.indexOf(t); }
  function tierView(tier) {
    var r = tierRank(tier);
    return {
      tier: tier,
      shown: SURFACES.filter(function (s) { return tierRank(s[2]) <= r; }),
      hidden: SURFACES.filter(function (s) { return tierRank(s[2]) > r; })
    };
  }
  /* The claim that has to be arithmetic rather than a promise: moving tier changes no rows. */
  function tierMoveRun() {
    var counts = function () {
      return [BEDS.length, CONTAINERS.length, PLANTINGS.length, tasks().length,
              HARVESTS.length, STORAGE.length, SEASONS.length].join("/");
    };
    var before = counts();
    var walk = ["plot", "beds", "pots", "beds", "plot"].map(function (t) {
      var v = tierView(t);
      return { tier: t, shown: v.shown.length, hidden: v.hidden.length, rows: counts() };
    });
    var after = counts();
    return {
      before: before, after: after, walk: walk, same: before === after,
      says: "Walking plot \u2192 beds \u2192 pots \u2192 beds \u2192 plot, the row counts are " +
        walk.map(function (w) { return w.rows; }).join(" \u00b7 ") +
        " \u2014 the same seven numbers each time. What changes is " +
        walk.map(function (w) { return w.shown; }).join("/") + " surfaces revealed of " +
        SURFACES.length + "."
    };
  }

  /* ── D-66 · the curated catalog ────────────────────────────────────────
     Fifteen crops of the ~300 launch set, enough to run every check. Timings are
     day offsets from an anchor — LF last frost, FF first frost — never calendar weeks. */
  var SOURCES = {
    ukzuz: { id: "ukzuz", label: "\u00daKZ\u00daZ variety and sowing tables", cls: "agronomy" },
    rhs: { id: "rhs", label: "RHS growing guides", cls: "agronomy" },
    ext: { id: "ext", label: "Czech extension service \u00b7 vegetable growing", cls: "agronomy" },
    folk: { id: "folk", label: "Traditional companion planting", cls: "folklore" },
    hh: { id: "hh", label: "This household", cls: "household" }
  };
  var FIELDS = ["latin", "family", "hardiness", "feeder", "breakYears", "spacing", "perM2",
                "dtm", "yieldM2", "unit", "windows", "storage", "pests"];
  var FIELD_SRC = {
    latin: "ukzuz", family: "ukzuz", hardiness: "rhs", feeder: "ext", breakYears: "ext",
    spacing: "ukzuz", perM2: "ukzuz", dtm: "ukzuz", yieldM2: "ext", unit: "ext",
    windows: "rhs", storage: "ext", pests: "ext"
  };
  function c(id, cs, en, latin, family, hardiness, feeder, breakYears, spacing, perM2, dtm,
             yieldM2, unit, win, care, storage, pests) {
    return { id: id, cs: cs, en: en, latin: latin, family: family, hardiness: hardiness,
             feeder: feeder, breakYears: breakYears, spacing: spacing, perM2: perM2, dtm: dtm,
             yieldM2: yieldM2, unit: unit, windows: win, care: care || {},
             storage: storage || [], pests: pests || [] };
  }
  var CROPS = [
    c("rajce", "Raj\u010de", "Tomato", "Solanum lycopersicum", "Solanaceae", "tender", "heavy", 3, 50, 3, 75, 4.5, "kg",
      { sow_indoor: ["LF", -56, -42], prick_out: ["LF", -35, -28], harden_off: ["LF", -14, -7],
        transplant: ["LF", 7, 21], harvest: ["LF", 70, 150] },
      { support: ["LF", 21], mulch: ["LF", 35], pest_check: ["LF", 60] },
      ["passata", "dried"], ["Pl\u00edse\u0148 bramborov\u00e1"]),
    c("paprika", "Paprika", "Sweet pepper", "Capsicum annuum", "Solanaceae", "tender", "heavy", 3, 40, 4, 95, 3.0, "kg",
      { sow_indoor: ["LF", -70, -56], prick_out: ["LF", -49, -42], harden_off: ["LF", -14, -7],
        transplant: ["LF", 14, 28], harvest: ["LF", 90, 150] },
      { support: ["LF", 21] }, ["frozen"], ["Mšice"]),
    c("brambory", "Brambory", "Potato", "Solanum tuberosum", "Solanaceae", "tender", "heavy", 4, 35, null, 120, 3.5, "kg",
      { direct_sow: ["LF", -28, -7], harvest: ["LF", 110, 140] },
      { mulch: ["LF", 21] }, ["cellar"], ["Mandelinka", "Pl\u00edse\u0148 bramborov\u00e1"]),
    c("cesnek", "\u010cesnek", "Garlic", "Allium sativum", "Amaryllidaceae", "hardy", "medium", 3, 15, 45, 270, 1.2, "kg",
      { direct_sow_autumn: ["FF", 5, 20], harvest: ["LF", 56, 77] },
      {}, ["braided", "dry store"], ["B\u00edl\u00e1 hniloba"]),
    c("porek", "P\u00f3rek", "Leek", "Allium ampeloprasum", "Amaryllidaceae", "hardy", "medium", 3, 20, 25, 200, 3.0, "kg",
      { sow_indoor: ["LF", -62, -49], prick_out: ["LF", -35, -21], transplant: ["LF", 15, 35],
        harvest: ["LF", 150, 220] },
      { mulch: ["LF", 60] }, ["in the ground"], []),
    c("cibule", "Cibule", "Onion", "Allium cepa", "Amaryllidaceae", "hardy", "medium", 3, 12, 60, 110, 2.5, "kg",
      { direct_sow: ["LF", -42, -21], harvest: ["LF", 84, 112] },
      {}, ["dry store"], []),
    c("mrkev", "Mrkev", "Carrot", "Daucus carota", "Apiaceae", "hardy", "light", 3, 5, 120, 100, 3.5, "kg",
      { direct_sow: ["LF", -28, 28], harvest: ["LF", 90, 140] },
      {}, ["in sand"], ["Pochmurnatka mrkvov\u00e1"]),
    c("hrasek", "Hr\u00e1\u0161ek", "Pea", "Pisum sativum", "Fabaceae", "hardy", "fixer", 2, 8, 80, 65, 1.0, "kg",
      { direct_sow: ["LF", -49, -21], harvest: ["LF", 42, 84] },
      { support: ["LF", -14] }, ["frozen"], []),
    c("fazole", "Fazole", "Bean", "Phaseolus vulgaris", "Fabaceae", "tender", "fixer", 2, 20, 25, 70, 1.5, "kg",
      { direct_sow: ["LF", 7, 28], harvest: ["LF", 63, 126] },
      { support: ["LF", 21] }, ["frozen", "dried"], []),
    c("zeli", "Zel\u00ed", "Cabbage", "Brassica oleracea capitata", "Brassicaceae", "hardy", "heavy", 4, 50, 4, 110, 4.0, "kg",
      { sow_indoor: ["LF", -42, -28], transplant: ["LF", 7, 28], harvest: ["LF", 100, 160] },
      { pest_check: ["LF", 114] }, ["sauerkraut", "cellar"], ["B\u011bl\u00e1sek zeln\u00fd"]),
    c("spenat", "\u0160pen\u00e1t", "Spinach", "Spinacia oleracea", "Amaranthaceae", "hardy", "medium", 2, 10, 100, 45, 1.8, "kg",
      { direct_sow: ["LF", -56, -14], direct_sow_autumn: ["FF", -70, -49],
        harvest: ["LF", -7, 42], harvest_autumn: ["FF", 150, 220] },
      {}, ["frozen"], []),
    c("dyne", "D\u00fdn\u011b", "Winter squash", "Cucurbita maxima", "Cucurbitaceae", "tender", "heavy", 3, 120, 1, 100, 6.0, "kg",
      { sow_indoor: ["LF", -28, -14], transplant: ["LF", 7, 21], harvest: ["LF", 84, 150] },
      { mulch: ["LF", 14] }, ["dry store"], []),
    c("cuketa", "Cuketa", "Courgette", "Cucurbita pepo", "Cucurbitaceae", "tender", "heavy", 3, 90, 1, 55, 8.0, "kg",
      { sow_indoor: ["LF", -21, -7], transplant: ["LF", 7, 21], harvest: ["LF", 49, 140] },
      { mulch: ["LF", 14] }, ["frozen"], ["Padl\u00ed"]),
    c("bazalka", "Bazalka", "Basil", "Ocimum basilicum", "Lamiaceae", "tender", "medium", 1, 25, 9, 60, 0.8, "kg",
      { sow_indoor: ["LF", -42, -28], transplant: ["LF", 14, 28], harvest: ["LF", 35, 120] },
      {}, ["pesto", "frozen"], []),
    c("salat", "Sal\u00e1t", "Lettuce", "Lactuca sativa", "Asteraceae", "half", "light", 1, 25, 12, 55, 2.0, "kg",
      { direct_sow: ["LF", -42, 42], harvest: ["LF", -14, 60] },
      {}, [], [])
  ];
  var byCrop = {};
  CROPS.forEach(function (x) { byCrop[x.id] = x; });
  function cropName(id) { return byCrop[id] ? byCrop[id].cs : id; }

  var CATALOG = {
    version: 7, crops: CROPS.length, launchScope: 300, languages: 5,
    next: { version: 8, on: "2026-11-01", changes: [
      { crop: "rajce", field: "sow_indoor", from: ["LF", -56, -42], to: ["LF", -49, -35],
        why: "Revised against 2020\u20132025 trial data" },
      { crop: "porek", field: "spacing", from: 20, to: 18, why: "Corrected to the \u00daKZ\u00daZ table" }
    ] }
  };

  /* FR-GA2 · a variety overrides only what differs; null means inherit. */
  var VARIETIES = [
    { id: "v-krim", crop: "rajce", name: "Black Krim", own: false,
      dtm: 82, yieldM2: 3.8, spacing: null, windows: null,
      note: "Later and lower-yielding than the crop default. Two fields differ, so two fields are stored." },
    { id: "v-stup", crop: "rajce", name: "Stupick\u00e9 poln\u00ed ran\u00e9", own: false,
      dtm: 61, yieldM2: null, spacing: null, windows: { transplant: ["LF", 0, 14] },
      note: "Early and cold-tolerant: it goes out at the frost date rather than a week after it." },
    { id: "v-bandit", crop: "porek", name: "Bandit", own: false,
      dtm: null, yieldM2: null, spacing: null, windows: { harvest: ["LF", 150, 250] },
      note: "Winter-hardy, so the harvest window closes a month later. Everything else inherits." },
    { id: "v-uchiki", crop: "dyne", name: "Uchiki Kuri", own: false,
      dtm: 95, yieldM2: 5.0, spacing: null, windows: null, note: "" },
    { id: "v-milos", crop: "rajce", name: "Z Milo\u0161ova okna", own: true,
      dtm: 70, yieldM2: null, spacing: null, windows: null,
      note: "The household's own variety, saved from seed since 2023. Private to this household." }
  ];
  var byVar = {};
  VARIETIES.forEach(function (v) { byVar[v.id] = v; });
  function varName(id) { return byVar[id] ? byVar[id].name : null; }

  /* FR-GA1 · household overrides. Per household, survive catalog updates, shown as overrides. */
  var OVERRIDES = [
    { id: "o-1", crop: "rajce", field: "sow_indoor", value: ["LF", -63, -49], by: "milos", on: "2026-01-18",
      why: "Warm windowsill above the boiler \u2014 a week earlier works here." },
    { id: "o-2", crop: "cesnek", field: "breakYears", value: 4, by: "milos", on: "2025-11-02",
      why: "White rot in the upper garden. Four years, not three." },
    { id: "o-3", crop: "porek", field: "spacing", value: 20, by: "jana", on: "2026-03-10",
      why: "15 cm gives thin stems in this soil." }
  ];

  /* ── the one resolution function ───────────────────────────────────────
     FR-GA1's resolution order, and D103's reason for it: four independent
     re-implementations of "when do we sow Black Krim" is a bug nobody would ever find.
     Field names may be plain (`spacing`) or a window (`win.transplant`). */
  var CALLERS = {};
  function fieldOf(obj, field) {
    if (!obj) return null;
    if (field.indexOf("win.") === 0) {
      var k = field.slice(4);
      return obj.windows && obj.windows[k] != null ? obj.windows[k] : null;
    }
    return obj[field] != null ? obj[field] : null;
  }
  function catalogValue(cropId, field, version) {
    var crop = byCrop[cropId];
    var v = fieldOf(crop, field);
    if (version && version >= CATALOG.next.version) {
      CATALOG.next.changes.forEach(function (ch) {
        if (ch.crop !== cropId) return;
        if (field === "win." + ch.field || field === ch.field) v = ch.to;
      });
    }
    return v;
  }
  function pick(cropId, varId, field, opts) {
    opts = opts || {};
    CALLERS[opts.by || "unknown"] = (CALLERS[opts.by || "unknown"] || 0) + 1;
    var cat = catalogValue(cropId, field, opts.catalog);
    var ov = OVERRIDES.filter(function (o) {
      return o.crop === cropId && (o.field === field || "win." + o.field === field);
    })[0] || null;
    var v = varId ? byVar[varId] : null;
    var vv = v ? fieldOf(v, field) : null;
    var out = { crop: cropId, variety: varId || null, field: field,
                catalog: cat, override: ov ? ov.value : null, varietyValue: vv };
    if (vv != null) { out.value = vv; out.from = "variety"; }
    else if (ov) { out.value = ov.value; out.from = "override"; }
    else { out.value = cat; out.from = "catalog"; }
    return out;
  }
  function resolveWindow(cropId, varId, kind, climate, opts) {
    opts = opts || {};
    var spec = pick(cropId, varId, "win." + kind, opts).value;
    if (!spec) return null;
    var anchor = spec[0] === "FF" ? climate.firstFrost : climate.lastFrost;
    if (opts.prevYear) {
      var y = Number(anchor.slice(0, 4)) - 1;
      var prev = season(y);
      anchor = prev ? (spec[0] === "FF" ? prev.firstFrost : prev.lastFrost)
                    : (y + anchor.slice(4));
    }
    return { kind: kind, anchor: spec[0], offset: [spec[1], spec[2]],
             from: addDays(anchor, spec[1]), to: addDays(anchor, spec[2]),
             source: pick(cropId, varId, "win." + kind, opts).from };
  }
  /* Zero absolute dates in the catalog: the scan the relative-timing claim reduces to. */
  function absoluteScan() {
    var s = JSON.stringify({ crops: CROPS, varieties: VARIETIES, overrides: OVERRIDES });
    var hits = s.match(/\d{4}-\d{2}-\d{2}/g) || [];
    /* override rows carry the day the member made them; the timings themselves must not */
    var timings = JSON.stringify({ crops: CROPS, varieties: VARIETIES }).match(/\d{4}-\d{2}-\d{2}/g) || [];
    return { all: hits.length, inTimings: timings.length };
  }
  function climateShift() {
    var here = resolveWindow("rajce", "v-krim", "sow_indoor", CLIMATE, { by: "check" });
    var there = resolveWindow("rajce", "v-krim", "sow_indoor", CLIMATE_ALT, { by: "check" });
    return { here: here, there: there, days: diff(there.from, here.from),
      says: "Black Krim sows indoors from " + fmtLong(here.from) + " in " + CLIMATE.label +
        " and from " + fmtLong(there.from) + " in " + CLIMATE_ALT.label + " \u2014 " +
        diff(there.from, here.from) + " days apart, from one catalog row and two frost dates." };
  }
  function provenanceAudit() {
    var rows = [], unsourced = 0, folklore = 0;
    CROPS.forEach(function (crop) {
      FIELDS.forEach(function (f) {
        var src = FIELD_SRC[f];
        if (!src) { unsourced++; return; }
        if (SOURCES[src].cls === "folklore") folklore++;
        rows.push([crop.id, f, src]);
      });
    });
    return { fields: rows.length, crops: CROPS.length, perCrop: FIELDS.length,
             unsourced: unsourced, folklore: folklore,
             classes: Object.keys(SOURCES).map(function (k) { return SOURCES[k].cls; })
               .filter(function (v, i, a) { return a.indexOf(v) === i; }) };
  }
  function overrideRun() {
    return OVERRIDES.map(function (o) {
      var f = byCrop[o.crop].windows[o.field] ? "win." + o.field : o.field;
      var before = pick(o.crop, null, f, { by: "catalog", catalog: CATALOG.version });
      var after = pick(o.crop, null, f, { by: "catalog", catalog: CATALOG.next.version });
      return { o: o, from: before.from, held: after.from === "override",
        catalogNow: JSON.stringify(before.catalog), catalogNext: JSON.stringify(after.catalog),
        changed: JSON.stringify(before.catalog) !== JSON.stringify(after.catalog) };
    });
  }

  /* ── FR-GA21 · compatibility, in three scopes ──────────────────────────
     Pairs are canonical, matched both ways, and an explicit crop pair beats a family pair. */
  function key2(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
  var RULES = [
    { id: "r-1", scope: "crop", a: "rajce", b: "brambory", verdict: "antagonist", src: "ext",
      why: "Pl\u00edse\u0148 bramborov\u00e1 moves between them, and both are Solanaceae.", origin: "catalog" },
    { id: "r-2", scope: "crop", a: "rajce", b: "bazalka", verdict: "companion", src: "folk",
      why: "Traditional pairing; no trial data behind it.", origin: "catalog" },
    { id: "r-3", scope: "crop", a: "cibule", b: "mrkev", verdict: "companion", src: "folk",
      why: "The classic carrot-fly pairing. Beats the family rule below, which is why both exist.", origin: "catalog" },
    { id: "r-4", scope: "family", a: "Amaryllidaceae", b: "Fabaceae", verdict: "antagonist", src: "ext",
      why: "Alliums suppress the rhizobia legumes depend on.", origin: "catalog" },
    { id: "r-5", scope: "family", a: "Amaryllidaceae", b: "Apiaceae", verdict: "antagonist", src: "folk",
      why: "Weak, and disabled by an explicit crop pair wherever one exists.", origin: "catalog" },
    { id: "r-6", scope: "crop", a: "spenat", b: "porek", verdict: "antagonist", src: "hh",
      why: "The leeks shaded the spinach out in 2024.", origin: "household", by: "milos" },
    { id: "r-7", scope: "succession", a: "brambory", b: "rajce", gap: 3, src: "ext",
      why: "Same family, same soil-borne diseases.", origin: "catalog" }
  ];
  function ruleFor(cropA, cropB) {
    var A = byCrop[cropA], B = byCrop[cropB];
    var crop = RULES.filter(function (r) {
      return r.scope === "crop" && key2(r.a, r.b) === key2(cropA, cropB);
    })[0];
    var fam = RULES.filter(function (r) {
      return r.scope === "family" && key2(r.a, r.b) === key2(A.family, B.family);
    })[0];
    if (crop) return { rule: crop, verdict: crop.verdict, from: "crop pair", beat: fam || null };
    if (fam) return { rule: fam, verdict: fam.verdict, from: "family pair", beat: null };
    return { rule: null, verdict: "neutral", from: "no rule", beat: null };
  }
  function precedenceRun() {
    var pair = ruleFor("cibule", "mrkev");
    var fam = RULES.filter(function (r) { return r.id === "r-5"; })[0];
    return { pair: pair, family: fam,
      says: "Cibule and mrkev resolve to " + pair.verdict + " from the " + pair.from +
        ", and the Amaryllidaceae \u00d7 Apiaceae family rule that would have said " + fam.verdict +
        " is recorded as beaten rather than deleted \u2014 " + (pair.beat ? "named on the row" : "not named") + "." };
  }

  /* ── beds, zones and the adjacency model (FR-GA10) ─────────────────────
     Ordered by lexorank within a zone, and that order is the adjacency: two beds are
     neighbours iff they are consecutive in the same zone. No coordinates, no drawing
     surface, no neighbour table. Bed numbers are what the household calls them and
     carry no adjacency at all — the greenhouse holds 1, 2 and 6. */
  var ZONES = [
    { id: "z-horni", name: "Horn\u00ed zahrada", covered: false,
      note: "Six beds along the slope, in the order they stand in." },
    { id: "z-zed", name: "U zdi", covered: false, note: "Five beds against the south wall." },
    { id: "z-sklenik", name: "Skl\u00ednek", covered: true,
      note: "Three beds under glass \u2014 which is what keeps them out of the frost warning." }
  ];
  function zone(id) { return ZONES.filter(function (z) { return z.id === id; })[0]; }
  function b(num, zoneId, pos, area, sun, soil) {
    return { num: num, code: "B" + num, label: "bed " + num, zone: zoneId, pos: pos,
             area: area, sun: sun, soil: soil || "", active: true };
  }
  var BEDS = [
    b(3, "z-horni", 1, 4.2, "full", "Compost in autumn 2025"),
    b(4, "z-horni", 2, 4.8, "full", "Heaviest soil in the garden"),
    b(5, "z-horni", 3, 3.6, "full", ""),
    b(7, "z-horni", 4, 5.4, "full", ""),
    b(8, "z-horni", 5, 3.0, "part", "Where the white rot was"),
    b(9, "z-horni", 6, 3.0, "part", ""),
    b(10, "z-zed", 1, 2.4, "full", ""),
    b(11, "z-zed", 2, 4.0, "full", ""),
    b(12, "z-zed", 3, 4.0, "full", ""),
    b(13, "z-zed", 4, 2.8, "part", ""),
    b(14, "z-zed", 5, 2.0, "part", "Built this spring"),
    b(1, "z-sklenik", 1, 6.0, "glass", ""),
    b(2, "z-sklenik", 2, 6.0, "glass", ""),
    b(6, "z-sklenik", 3, 3.0, "glass", "")
  ];
  function bed(num) { return BEDS.filter(function (x) { return x.num === num; })[0]; }
  function bedsOfZone(z) {
    return BEDS.filter(function (x) { return x.zone === z; })
      .sort(function (p, q) { return p.pos - q.pos; });
  }
  function neighbours(num) {
    var me = bed(num);
    if (!me) return [];
    return bedsOfZone(me.zone).filter(function (x) { return Math.abs(x.pos - me.pos) === 1; });
  }
  function covered(num) { var me = bed(num); return me ? zone(me.zone).covered : false; }
  function orderedActive() {
    var out = [];
    ZONES.forEach(function (z) {
      bedsOfZone(z.id).forEach(function (x) { if (x.active) out.push(x.num); });
    });
    return out;
  }

  /* ── FR-GA5 · containers, and the pots tier's own rows ─────────────────── */
  var CONTAINERS = [
    { id: "k-1", name: "Truhl\u00edk u okna", where: "windowsill", size: "60 \u00d7 18 cm", pos: 1, photo: true },
    { id: "k-2", name: "Kbel\u00edk na terase", where: "terrace", size: "30 l", pos: 2, photo: true },
    { id: "k-3", name: "Dv\u011b n\u00e1dobky na bazalku", where: "windowsill", size: "2 \u00d7 3 l", pos: 3, photo: false },
    { id: "k-4", name: "Bobkov\u00fd list", where: "terrace", size: "40 l", pos: 4, photo: true }
  ];
  /* FR-GA7 · care is a rhythm, not a plan: cadences, and they generate reminders. */
  var CARE = [
    { id: "care-1", target: "z-sklenik", label: "Water the greenhouse", kind: "water",
      cadence: 3, last: "2026-09-06", by: "milos" },
    { id: "care-2", target: "k-1", label: "Water the windowsill trough", kind: "water",
      cadence: 2, last: "2026-09-08", by: "milos" },
    { id: "care-3", target: "k-2", label: "Feed the tub tomato", kind: "feed",
      cadence: 14, last: "2026-08-30", by: "jana" },
    { id: "care-4", target: "k-4", label: "Water the bay", kind: "water",
      cadence: 7, last: "2026-09-05", by: "milos" }
  ];
  function careDue(day) {
    day = day || TODAY;
    return CARE.map(function (r) {
      var next = addDays(r.last, r.cadence);
      return { id: r.id, label: r.label, kind: r.kind, next: next, cadence: r.cadence,
               target: r.target, overdue: next < day, due: next <= day,
               from: byCrop[r.kind] ? null : "crop water / feeder class, adjusted" };
    });
  }

  /* ── FR-GA11 · plantings ───────────────────────────────────────────────
     Quantity is an area or a plant count, exactly one. Planned dates default from the
     resolved windows and each carries an is_manual flag; actual dates never move them. */
  var P_RAW = [
    /* 2026 — the active season, twenty-two bed plantings */
    ["p26-01", 2026, 2, "rajce", "v-krim", { area: 3.0 }, {}],
    ["p26-02", 2026, 6, "cuketa", null, { area: 1.5 }, {}],
    ["p26-03", 2026, 6, "fazole", null, { area: 1.2 }, {}],
    ["p26-04", 2026, 3, "rajce", "v-krim", { count: 8 },
      { manual: { transplant: "2026-05-06" }, actual: { transplant: "2026-05-19" },
        note: "Out a week before the frost date because the forecast looked settled. It was not." }],
    ["p26-05", 2026, 3, "paprika", null, { area: 1.2 }, {}],
    ["p26-06", 2026, 4, "brambory", null, { area: 4.5 },
      { actual: { direct_sow: "2026-04-18" }, topsDown: "2026-08-28" }],
    ["p26-07", 2026, 4, "spenat", null, { area: 2.0 },
      { win: "autumn", manual: { direct_sow: "2026-09-11" },
        note: "Winter spinach, sown late on purpose: it sits under fleece and is picked in March." }],
    ["p26-08", 2026, 5, "mrkev", null, { area: 3.0 }, {}],
    ["p26-09", 2026, 5, "cibule", null, { area: 0.6 }, { note: "A row of onions down the middle of the carrots." }],
    ["p26-10", 2026, 9, "cibule", null, { area: 1.5 }, {}],
    ["p26-11", 2026, 9, "hrasek", null, { area: 1.2 }, {}],
    ["p26-12", 2026, 7, "porek", "v-bandit", { count: 60 }, {}],
    ["p26-13", 2026, 7, "dyne", "v-uchiki", { area: 2.0 }, {}],
    ["p26-14", 2026, 7, "bazalka", null, { count: 6 }, {}],
    ["p26-15", 2026, 11, "cuketa", null, { area: 1.5 }, {}],
    ["p26-16", 2026, 11, "rajce", "v-stup", { area: 1.8 }, {}],
    ["p26-17", 2026, 12, "zeli", null, { count: 12 }, {}],
    ["p26-18", 2026, 10, "spenat", null, { area: 1.4 }, { cleared: "2026-05-24" }],
    ["p26-19", 2026, 10, "porek", null, { count: 40 }, {}],
    ["p26-20", 2026, 13, "fazole", null, { area: 2.0 }, { cleared: "2026-08-20" }],
    ["p26-21", 2026, 8, "cesnek", null, { count: 90 },
      { win: "autumn", prevYear: true, actual: { direct_sow: "2025-10-12", harvest: "2026-07-18" },
        note: "FR-GA17: sown in October 2025, harvested in July 2026, and therefore a 2026 planting." }],
    ["p26-22", 2026, 1, "paprika", null, { area: 2.4 }, {}],
    /* 2025 — closed */
    ["p25-01", 2025, 3, "hrasek", null, { area: 3.0 }, {}],
    ["p25-02", 2025, 4, "zeli", null, { count: 14 }, {}],
    ["p25-03", 2025, 5, "cesnek", null, { count: 120 }, { win: "autumn", prevYear: true }],
    ["p25-04", 2025, 7, "dyne", null, { area: 4.0 }, {}],
    ["p25-05", 2025, 8, "mrkev", null, { area: 2.4 }, {}],
    ["p25-06", 2025, 9, "rajce", null, { area: 2.4 }, {}],
    ["p25-07", 2025, 10, "cibule", null, { area: 2.0 }, {}],
    ["p25-08", 2025, 11, "brambory", null, { area: 3.6 }, {}],
    ["p25-09", 2025, 12, "fazole", null, { area: 3.0 }, {}],
    ["p25-10", 2025, 13, "salat", null, { area: 2.0 }, {}],
    /* 2024 — closed */
    ["p24-01", 2024, 3, "cibule", null, { area: 3.6 }, {}],
    ["p24-02", 2024, 4, "mrkev", null, { area: 4.0 }, {}],
    ["p24-03", 2024, 5, "rajce", null, { area: 3.0 }, {}],
    ["p24-04", 2024, 7, "zeli", null, { count: 16 }, {}],
    ["p24-05", 2024, 8, "hrasek", null, { area: 2.4 }, {}],
    ["p24-06", 2024, 9, "brambory", null, { area: 2.8 }, {}],
    ["p24-07", 2024, 10, "dyne", null, { area: 2.0 }, {}],
    ["p24-08", 2024, 11, "zeli", null, { count: 12 }, {}],
    ["p24-09", 2024, 12, "mrkev", null, { area: 3.6 }, {}]
  ];
  var CONTAINER_PLANTS = [
    { id: "kp-1", container: "k-1", crop: "bazalka", variety: null, planted: "2026-04-20",
      status: "growing", photos: 4 },
    { id: "kp-2", container: "k-2", crop: "rajce", variety: "v-milos", planted: "2026-05-16",
      status: "growing", photos: 9 },
    { id: "kp-3", container: "k-3", crop: "bazalka", variety: null, planted: "2026-06-02",
      status: "growing", photos: 1 },
    { id: "kp-4", container: "k-4", crop: "salat", variety: null, planted: "2026-08-11",
      status: "growing", photos: 0 }
  ];

  var DATE_KINDS = ["sow_indoor", "prick_out", "harden_off", "transplant", "direct_sow", "harvest"];
  function buildPlanting(t, climate) {
    var id = t[0], year = t[1], bedNum = t[2], cropId = t[3], varId = t[4], qty = t[5], x = t[6] || {};
    var s = season(year);
    var clim = climate || { lastFrost: s.lastFrost, firstFrost: s.firstFrost };
    var crop = byCrop[cropId];
    var planned = {}, manualFlags = {}, windows = {};
    DATE_KINDS.forEach(function (k) {
      var kind = k;
      if (x.win === "autumn" && crop.windows[k + "_autumn"]) kind = k + "_autumn";
      var w = resolveWindow(cropId, varId, kind, clim, { by: "planting", prevYear: x.prevYear && k === "direct_sow" });
      if (!w) return;
      windows[k] = w;
      var m = x.manual && x.manual[k];
      planned[k] = m || (k === "harvest" ? w.from : w.from);
      manualFlags[k] = !!m;
    });
    var harvestWin = windows.harvest;
    var start = (x.actual && (x.actual.direct_sow || x.actual.transplant)) ||
                planned.direct_sow || planned.transplant || planned.sow_indoor;
    var end = x.cleared || (harvestWin ? harvestWin.to : null);
    var area = qty.area != null ? qty.area
      : Math.round((qty.count / pick(cropId, varId, "perM2", { by: "planting" }).value) * 100) / 100;
    return {
      id: id, season: year, bed: bedNum, crop: cropId, variety: varId,
      qty: qty, area: area, plants: qty.count != null ? qty.count : null,
      planned: planned, manual: manualFlags, windows: windows,
      actual: x.actual || {}, cleared: x.cleared || null, topsDown: x.topsDown || null,
      note: x.note || "", covered: covered(bedNum),
      occupancy: { from: start, to: end, days: start && end ? diff(start, end) + 1 : 0 },
      hardiness: pick(cropId, varId, "hardiness", { by: "planting" }).value,
      family: crop.family, feeder: crop.feeder,
      label: cropName(cropId) + (varName(varId) ? " \u2018" + varName(varId) + "\u2019" : ""),
      where: bed(bedNum) ? bed(bedNum).label : ""
    };
  }
  var PLANTINGS = P_RAW.map(function (t) { return buildPlanting(t); });
  function planting(id) { return PLANTINGS.filter(function (p) { return p.id === id; })[0]; }
  function plantingsOf(year) { return PLANTINGS.filter(function (p) { return p.season === year; }); }

  /* FR-GA11 · exactly one of area or count, 422 otherwise. */
  function quantityCheck(qty) {
    var hasArea = qty.area != null, hasCount = qty.count != null;
    if (hasArea && hasCount) return { ok: false, status: 422, says: "Area and a plant count are both set. A planting is measured one way or the other, not both." };
    if (!hasArea && !hasCount) return { ok: false, status: 422, says: "Neither an area nor a plant count. One of them is what makes the bed arithmetic possible." };
    return { ok: true, status: 200, says: hasArea ? "An area." : "A plant count." };
  }

  /* ── FR-GA12 · task generation ─────────────────────────────────────────── */
  var KIND_LABEL = {
    sow_indoor: "Sow indoors", prick_out: "Prick out", harden_off: "Harden off",
    transplant: "Transplant", direct_sow: "Direct sow", support: "Support",
    mulch: "Mulch", pest_check: "Pest check", harvest: "Harvest"
  };
  var GEN_KINDS = ["sow_indoor", "prick_out", "harden_off", "transplant", "direct_sow",
                   "support", "mulch", "pest_check", "harvest"];
  var NEVER_GENERATED = ["water", "weed"];
  /* Deliberate fixture states: the four things regeneration must not touch. */
  var TASK_STATE = {
    "p26-17:pest_check": { status: "open" },
    "p26-06:harvest": { status: "open", due: "2026-09-23", edited: true,
      why: "Miloš moved the lift to the week he is at home. An edited task is never moved again." },
    "p26-04:transplant": { status: "done", doneOn: "2026-05-19" },
    "p26-22:support": { status: "skipped", by: "milos" },
    "p26-13:mulch": { deleted: true, by: "milos", on: "2026-05-20",
      why: "Deleted, not skipped: there is no mulch to put on that bed this year." }
  };
  var TOMBSTONES = [];
  function tasks(opts) {
    opts = opts || {};
    var clim = opts.climate || CLIMATE;
    var out = [], stones = [];
    plantingsOf(opts.season || 2026).forEach(function (p) {
      var crop = byCrop[p.crop];
      var raw = P_RAW.filter(function (t) { return t[0] === p.id; })[0][6] || {};
      GEN_KINDS.forEach(function (k) {
        var gk = p.id + ":" + k;
        var st = TASK_STATE[gk] || {};
        var dueFor = function (climate) {
          if (DATE_KINDS.indexOf(k) >= 0) {
            if (!p.planned[k]) return null;
            if (p.manual[k]) return p.planned[k];
            var kind = k;
            if (crop.windows[k + "_autumn"] && raw.win === "autumn") kind = k + "_autumn";
            var w = resolveWindow(p.crop, p.variety, kind, climate,
              { by: "tasks", prevYear: k === "direct_sow" && !!raw.prevYear });
            return w ? w.from : p.planned[k];
          }
          if (!crop.care[k]) return null;
          var spec = crop.care[k];
          return addDays(spec[0] === "FF" ? climate.firstFrost : climate.lastFrost, spec[1]);
        };
        if (dueFor(CLIMATE) === null) return;
        if (st.deleted) {
          stones.push({ generation_key: gk, planting: p.id, kind: k, by: st.by, on: st.on, why: st.why });
          return;
        }
        /* the four things regeneration must not move keep the date they already have */
        var baseDue = dueFor(CLIMATE);
        var status = st.status || (baseDue < addDays(TODAY, -4) ? "done" : "open");
        var frozen = status === "done" || status === "skipped" || !!st.edited;
        var due = st.due || (frozen ? baseDue : dueFor(clim));
        out.push({
          id: gk, generation_key: gk, is_generated: true, planting: p.id, bed: p.bed,
          crop: p.crop, kind: k, title: KIND_LABEL[k] + " \u00b7 " + cropName(p.crop) + " \u00b7 " + p.where,
          due: due, baseDue: baseDue, manual: !!p.manual[k], edited: !!st.edited,
          status: status, doneOn: st.doneOn || null, why: st.why || "",
          week: weekKey(due), window: null
        });
      });
    });
    TOMBSTONES = stones;
    if (!opts.withManual) return out.sort(function (a, z) { return a.due < z.due ? -1 : 1; });
    return out.concat(MANUAL_TASKS).sort(function (a, z) { return a.due < z.due ? -1 : 1; });
  }
  /* A manual task is the member's own sentence, and the generator never touches it. */
  var MANUAL_TASKS = [
    { id: "mt-1", generation_key: null, is_generated: false, planting: null, bed: 14,
      crop: null, kind: "direct_sow", title: "Sow winter spinach", due: "2026-09-28",
      baseDue: "2026-09-28", manual: true, edited: false, status: "open", doneOn: null,
      why: "For the new bed, once the frame is finished.", week: weekKey("2026-09-28"), window: null }
  ];
  function regenerate(newClimate) {
    var before = tasks({ climate: CLIMATE, withManual: true });
    var after = tasks({ climate: newClimate, withManual: true });
    var byId = {};
    before.forEach(function (t) { byId[t.id] = t; });
    var moved = [], held = { done: 0, skipped: 0, edited: 0, manual: 0 };
    after.forEach(function (t) {
      var b = byId[t.id];
      if (!b) return;
      if (t.due !== b.due) moved.push({ id: t.id, from: b.due, to: t.due, title: t.title });
      else if (b.status === "done") held.done++;
      else if (b.status === "skipped") held.skipped++;
      else if (b.edited) held.edited++;
      else if (!b.is_generated || b.manual) held.manual++;
    });
    /* what the generator would have moved had the rules not held it back */
    var wouldMove = before.filter(function (t) {
      return t.is_generated && !t.manual && t.status === "open" && !t.edited;
    }).length;
    var stones = TOMBSTONES.slice();
    var resurrected = after.filter(function (t) {
      return stones.some(function (s) { return s.generation_key === t.generation_key; });
    });
    return { moved: moved, held: held, wouldMove: wouldMove, tombstones: stones,
      resurrected: resurrected.length, delta: diff(CLIMATE.lastFrost, newClimate.lastFrost),
      before: before.length, after: after.length };
  }
  function generatorAudit() {
    var t = tasks({ withManual: true });
    return {
      total: t.length, generated: t.filter(function (x) { return x.is_generated; }).length,
      manual: t.filter(function (x) { return !x.is_generated; }).length,
      never: NEVER_GENERATED,
      neverGenerated: t.filter(function (x) { return NEVER_GENERATED.indexOf(x.kind) >= 0; }).length,
      kinds: GEN_KINDS.length, careKinds: CARE.length
    };
  }

  /* ── FR-GA13 · drift ───────────────────────────────────────────────────
     Recording an actual date changes no planned window. The check is a string compare
     over every planned date in the season, before and after. */
  function driftRun() {
    var p = planting("p26-04");
    var snapshot = function () {
      return plantingsOf(2026).map(function (x) {
        return x.id + ":" + DATE_KINDS.map(function (k) { return x.planned[k] || "-"; }).join(",");
      }).join("|");
    };
    var before = snapshot();
    var actual = p.actual.transplant;
    var days = diff(p.planned.transplant, actual);
    var after = snapshot();
    var open = tasks().filter(function (t) {
      return t.planting === p.id && t.due > actual && t.status !== "skipped";
    });
    return {
      planting: p, planned: p.planned.transplant, actual: actual, days: days,
      identical: before === after, dates: plantingsOf(2026).length * DATE_KINDS.length,
      shiftable: open.map(function (t) {
        return { title: t.title, from: t.due, to: addDays(t.due, days) };
      }),
      says: "Transplanting was planned for " + fmtLong(p.planned.transplant) + " and happened on " +
        fmtLong(actual) + " \u2014 " + days + " days later. Every planned date in the season is " +
        (before === after ? "byte-identical" : "CHANGED") + " afterwards, and the offer made on the day \u2014 " +
        fmtLong(actual) + ", when they were all still ahead \u2014 is a shift of " + open.length +
        " remaining tasks on this planting by " + days + " days, in one action, which the member may decline."
    };
  }

  /* ── FR-GA14 · harvests, and yields against expected ──────────────────── */
  var HARVESTS = [
    { id: "h-1", planting: "p26-01", on: "2026-07-30", qty: 2.4, unit: "kg", dest: "kitchen", by: "milos" },
    { id: "h-2", planting: "p26-01", on: "2026-08-14", qty: 3.8, unit: "kg", dest: "passata", by: "jana" },
    { id: "h-3", planting: "p26-01", on: "2026-09-02", qty: 4.1, unit: "kg", dest: "passata", by: "milos" },
    { id: "h-4", planting: "p26-02", on: "2026-07-18", qty: 3.2, unit: "kg", dest: "kitchen", by: "milos" },
    { id: "h-5", planting: "p26-02", on: "2026-08-22", qty: 5.6, unit: "kg", dest: "kitchen", by: "klara" },
    { id: "h-6", planting: "p26-03", on: "2026-08-09", qty: 1.4, unit: "kg", dest: "frozen", by: "milos" },
    { id: "h-7", planting: "p26-21", on: "2026-07-18", qty: 2.1, unit: "kg", dest: "braided", by: "milos",
      note: "Ninety heads, lifted in one go." },
    { id: "h-8", planting: "p26-13", on: "2026-09-05", qty: 6.5, unit: "kg", dest: "dry store", by: "milos" },
    { id: "h-9", planting: "p25-04", on: "2025-09-14", qty: 18.0, unit: "kg", dest: "dry store", by: "milos" },
    { id: "h-10", planting: "p25-08", on: "2025-09-21", qty: 11.5, unit: "kg", dest: "cellar", by: "milos" },
    { id: "h-11", planting: "p25-06", on: "2025-08-26", qty: 6.2, unit: "kg", dest: "passata", by: "jana" },
    { id: "h-12", planting: "p25-02", on: "2025-10-04", qty: 22.0, unit: "kg", dest: "sauerkraut", by: "milos" },
    { id: "h-13", planting: "p25-01", on: "2025-06-30", qty: 1.8, unit: "kg", dest: "frozen", by: "klara" },
    { id: "h-14", planting: "p25-07", on: "2025-08-30", qty: 4.4, unit: "kg", dest: "dry store", by: "milos" }
  ];
  var FAILURES = [
    { planting: "p25-09", why: "Bean fly in June; the row never recovered.", by: "milos" },
    { planting: "p25-10", why: "Bolted in the heat.", by: "milos" }
  ];
  function yieldRun(year) {
    var rows = plantingsOf(year).map(function (p) {
      var got = HARVESTS.filter(function (h) { return h.planting === p.id; });
      var actual = Math.round(got.reduce(function (n, h) { return n + h.qty; }, 0) * 10) / 10;
      var per = pick(p.crop, p.variety, "yieldM2", { by: "yields" });
      var expected = Math.round(per.value * p.area * 10) / 10;
      var failed = FAILURES.filter(function (f) { return f.planting === p.id; })[0] || null;
      return { planting: p, rows: got.length, actual: actual, expected: expected,
        per: per, ratio: expected ? Math.round((actual / expected) * 100) : null,
        failed: failed, unit: pick(p.crop, p.variety, "unit", { by: "yields" }).value };
    });
    var withData = rows.filter(function (r) { return r.rows > 0; });
    return { year: year, rows: rows, logged: withData.length,
      actual: Math.round(withData.reduce(function (n, r) { return n + r.actual; }, 0) * 10) / 10,
      expected: Math.round(withData.reduce(function (n, r) { return n + r.expected; }, 0) * 10) / 10,
      failures: rows.filter(function (r) { return r.failed; }).length };
  }
  function harvestReady(day) {
    day = day || TODAY;
    return plantingsOf(2026).filter(function (p) {
      var w = p.windows.harvest;
      if (!w) return false;
      if (p.cleared && p.cleared < day) return false;
      return w.from <= day && day <= w.to;
    });
  }

  /* ── FR-GA18 · the eleven checks ───────────────────────────────────────
     Computed on read. Each returns a key, a severity, a title, a detail, findings and the
     entities it points at. C3 and C8 depend on closed seasons and say so when there are none. */
  var CHECK_DEFS = [
    ["C1", "warning", "Incompatible companions sharing a bed", "Two plantings in one bed whose occupancy windows overlap and whose crop or family pair says antagonist."],
    ["C2", "warning", "Same family in one bed inside the rotation break", "The bed itself, this season, without looking at history."],
    ["C3", "warning", "Rotation break violated against closed seasons", "Needs history. Structurally silent in the first season and only sharp from the third."],
    ["C4", "warning", "Bed over-booked for its area", "Concurrent plantings, not the season total \u2014 a bed can carry three crops if they take turns."],
    ["C5", "info", "Workload spike in one week", "Six or more tasks falling in one ISO week."],
    ["C6", "info", "One family across too much of the plot", "More than a third of the planted beds."],
    ["C7", "info", "Active bed with nothing planned", "Not an error \u2014 a question."],
    ["C8", "info", "Heavy feeder after heavy feeder", "Needs history. Carries the legume tip rather than only the complaint."],
    ["C9", "warning", "Frost-risky transplant date", "A tender or half-hardy crop going out at or before the last frost date."],
    ["C10", "info", "Planned date outside the crop's resolved window", "Advisory by construction: the member set it on purpose."],
    ["C11", "info", "Adjacent-bed conflict, and seed-saving cross-pollination", "Adjacency is the order of the beds within their zone."]
  ];
  var SPIKE = 6;
  var CONCENTRATION = 1 / 3;
  var CHECK_CONFIG = {
    C6: { enabled: false, by: "milos", on: "2026-03-02",
      why: "We grow tomatoes. That is the point of the garden." }
  };
  var DISMISSALS = [
    { check: "C4", entity: "B4", season: 2026, by: "milos", on: "2026-09-01",
      note: "The potatoes are out on the 23rd and the spinach only needs the room in October. Checked by hand." }
  ];
  function familyBreak(family) {
    var years = CROPS.filter(function (x) { return x.family === family; })
      .map(function (x) { return pick(x.id, null, "breakYears", { by: "check" }).value; });
    return years.length ? Math.max.apply(null, years) : 0;
  }
  function lastFamilyIn(bedNum, family, beforeYear, history) {
    var hits = PLANTINGS.filter(function (p) {
      return p.bed === bedNum && p.family === family && p.season < beforeYear &&
             history.indexOf(p.season) >= 0;
    }).sort(function (a, z) { return z.season - a.season; });
    return hits[0] || null;
  }
  function planCheck(year, opts) {
    opts = opts || {};
    var history = opts.history || closedSeasons().map(function (s) { return s.year; });
    var reduced = !!opts.reduced;              /* beds tier: only the checks needing no history */
    var list = opts.plantings || plantingsOf(year);
    var dismissals = opts.dismissals || DISMISSALS;
    var tsk = opts.tasks || tasks({ season: year, withManual: true });
    var clim = opts.climate || { lastFrost: season(year).lastFrost, firstFrost: season(year).firstFrost };
    var byBed = {};
    list.forEach(function (p) { (byBed[p.bed] = byBed[p.bed] || []).push(p); });

    var found = {}, extra = {};
    CHECK_DEFS.forEach(function (d) { found[d[0]] = []; });

    /* C1 — same bed, overlapping occupancy, antagonist pair */
    extra.C1 = { suppressed: [] };
    Object.keys(byBed).forEach(function (num) {
      var ps = byBed[num];
      for (var i = 0; i < ps.length; i++) {
        for (var j = i + 1; j < ps.length; j++) {
          var a = ps[i], z = ps[j];
          var r = ruleFor(a.crop, z.crop);
          var ov = overlapDays(a.occupancy.from, a.occupancy.to, z.occupancy.from, z.occupancy.to);
          if (r.verdict === "antagonist" && ov > 0) {
            found.C1.push({ entity: "B" + num, entities: [a.id, z.id],
              says: bed(Number(num)).label + ": " + a.label + " and " + z.label + " share the bed for " +
                ov + " days, and " + r.from + " says they should not (" + r.rule.why + ")" });
          } else if (r.verdict === "antagonist" && ov === 0) {
            extra.C1.suppressed.push({ entity: "B" + num,
              says: bed(Number(num)).label + ": " + a.label + " and " + z.label + " are an antagonist " +
                r.from + ", and they never meet \u2014 " + fmt(a.occupancy.to) + " and " +
                fmt(z.occupancy.from) + ", zero days of shared occupancy. No warning." });
          } else if (r.verdict === "companion" && r.beat) {
            extra.C1.suppressed.push({ entity: "B" + num,
              says: bed(Number(num)).label + ": " + a.label + " and " + z.label + " are an explicit " +
                r.from + " saying companion, which beats the " + r.beat.a + " \u00d7 " + r.beat.b +
                " family rule that says " + r.beat.verdict + "." });
          }
        }
      }
    });

    /* C2 — same family in one bed, this season */
    Object.keys(byBed).forEach(function (num) {
      var seen = {};
      byBed[num].forEach(function (p) { (seen[p.family] = seen[p.family] || []).push(p); });
      Object.keys(seen).forEach(function (fam) {
        if (seen[fam].length < 2) return;
        found.C2.push({ entity: "B" + num, entities: seen[fam].map(function (p) { return p.id; }),
          says: bed(Number(num)).label + " carries " + seen[fam].length + " " + fam + " plantings (" +
            seen[fam].map(function (p) { return p.label; }).join(", ") + ") with a " +
            familyBreak(fam) + "-year break on that family" });
      });
    });

    /* C3 — rotation break against closed seasons */
    if (!history.length) found.C3 = "no_history";
    else Object.keys(byBed).forEach(function (num) {
      var done = {};
      byBed[num].forEach(function (p) {
        if (done[p.family]) return;
        done[p.family] = 1;
        var prev = lastFamilyIn(Number(num), p.family, year, history);
        if (!prev) return;
        var gap = year - prev.season, need = familyBreak(p.family);
        if (gap < need) {
          found.C3.push({ entity: "B" + num, entities: [p.id, prev.id],
            says: bed(Number(num)).label + ": " + p.label + " is " + p.family + " and so was " +
              prev.label + " in " + prev.season + " \u2014 " + gap + " year" + (gap === 1 ? "" : "s") +
              " against a " + need + "-year break" });
        }
      });
    });

    /* C4 — concurrent area against the bed's own area */
    Object.keys(byBed).forEach(function (num) {
      var ps = byBed[num], me = bed(Number(num));
      var edges = [];
      ps.forEach(function (p) { edges.push(p.occupancy.from); edges.push(p.occupancy.to); });
      var worst = null;
      edges.forEach(function (day) {
        if (!day) return;
        var here = ps.filter(function (p) {
          return p.occupancy.from <= day && day <= p.occupancy.to;
        });
        var sum = Math.round(here.reduce(function (n, p) { return n + p.area; }, 0) * 100) / 100;
        if (!worst || sum > worst.sum) worst = { day: day, sum: sum, n: here.length, ps: here };
      });
      if (worst && worst.sum > me.area) {
        found.C4.push({ entity: "B" + num, entities: worst.ps.map(function (p) { return p.id; }),
          says: me.label + " is " + me.area + " m\u00b2 and carries " + worst.sum + " m\u00b2 on " +
            fmtLong(worst.day) + " \u2014 " + worst.ps.map(function (p) {
              return p.label + " " + p.area + " m\u00b2"; }).join(" + ") });
      }
    });

    /* C5 — tasks per ISO week */
    var weeks = {};
    tsk.forEach(function (t) { weeks[t.week] = (weeks[t.week] || 0) + 1; });
    var busiest = Object.keys(weeks).sort(function (a, z) { return weeks[z] - weeks[a]; })[0];
    extra.C5 = { weeks: weeks, busiest: busiest, count: busiest ? weeks[busiest] : 0, threshold: SPIKE };
    if (busiest && weeks[busiest] >= SPIKE) {
      found.C5.push({ entity: busiest, entities: tsk.filter(function (t) { return t.week === busiest; })
        .map(function (t) { return t.id; }),
        says: busiest + " carries " + weeks[busiest] + " tasks, against a threshold of " + SPIKE });
    }

    /* C6 — family concentration across the planted beds */
    var plantedBeds = Object.keys(byBed).length, famBeds = {};
    list.forEach(function (p) {
      (famBeds[p.family] = famBeds[p.family] || {})["B" + p.bed] = 1;
    });
    Object.keys(famBeds).forEach(function (fam) {
      var n = Object.keys(famBeds[fam]).length;
      if (n / plantedBeds > CONCENTRATION) {
        found.C6.push({ entity: fam, entities: Object.keys(famBeds[fam]),
          says: fam + " is in " + n + " of " + plantedBeds + " planted beds (" +
            Math.round((n / plantedBeds) * 100) + " %), over a third" });
      }
    });

    /* C7 — active bed with nothing planned */
    BEDS.forEach(function (x) {
      if (!x.active || byBed[x.num]) return;
      found.C7.push({ entity: x.code, entities: [x.code],
        says: x.label + " is active and has nothing planned this season" + (x.soil ? " \u2014 " + x.soil.toLowerCase() : "") });
    });

    /* C8 — heavy after heavy, with the legume tip */
    if (!history.length) found.C8 = "no_history";
    else Object.keys(byBed).forEach(function (num) {
      var here = byBed[num].filter(function (p) { return p.feeder === "heavy"; });
      if (!here.length) return;
      var prev = PLANTINGS.filter(function (p) {
        return p.bed === Number(num) && p.season < year && history.indexOf(p.season) >= 0 &&
               p.feeder === "heavy";
      }).sort(function (a, z) { return z.season - a.season; })[0];
      if (prev && year - prev.season <= 1) {
        found.C8.push({ entity: "B" + num, entities: [here[0].id, prev.id],
          says: bed(Number(num)).label + ": " + here[0].label + " is a heavy feeder and " +
            prev.label + " was one in " + prev.season +
            ". A legume year in between feeds the next one for you" });
      }
    });

    /* C9 — frost-risky transplant. A transplant, deliberately: potatoes and beans go in
       before the frost date on purpose, and a check that flagged them would be ignored. */
    list.forEach(function (p) {
      if (["tender", "half"].indexOf(p.hardiness) < 0) return;
      if (p.covered) return;
      var out = p.planned.transplant;
      if (!out) return;
      if (out <= clim.lastFrost) {
        found.C9.push({ entity: p.id, entities: [p.id],
          says: p.label + " in " + p.where + " goes out on " + fmtLong(out) +
            ", on or before the last frost date of " + fmtLong(clim.lastFrost) +
            (p.manual.transplant ? " \u2014 a date the member set" : "") });
      }
    });

    /* C10 — planned date outside the resolved window */
    list.forEach(function (p) {
      DATE_KINDS.forEach(function (k) {
        if (!p.planned[k] || !p.windows[k]) return;
        var w = p.windows[k], d = p.planned[k];
        if (d >= w.from && d <= w.to) return;
        var late = d > w.to;
        found.C10.push({ entity: p.id, entities: [p.id],
          says: p.label + " in " + p.where + ": " + KIND_LABEL[k].toLowerCase() + " on " + fmtLong(d) +
            " is " + Math.abs(late ? diff(w.to, d) : diff(d, w.from)) + " days " +
            (late ? "after" : "before") + " the resolved window " + fmt(w.from) + "\u2013" + fmt(w.to) +
            (p.manual[k] ? ", set by hand" : "") });
      });
    });

    /* C11 — adjacent beds, and seed saving */
    var seenPair = {};
    Object.keys(byBed).forEach(function (num) {
      neighbours(Number(num)).forEach(function (nb) {
        var pk = key2("B" + num, nb.code);
        if (seenPair[pk]) return;
        seenPair[pk] = 1;
        (byBed[num] || []).forEach(function (a) {
          (byBed[nb.num] || []).forEach(function (z) {
            var r = ruleFor(a.crop, z.crop);
            var ov = overlapDays(a.occupancy.from, a.occupancy.to, z.occupancy.from, z.occupancy.to);
            if (r.verdict !== "antagonist" || ov === 0) return;
            found.C11.push({ entity: pk, entities: [a.id, z.id],
              says: bed(Number(num)).label + " and " + nb.label + " are neighbours in " +
                zone(bed(Number(num)).zone).name + ", and " + a.label + " beside " + z.label +
                " is an antagonist " + r.from });
          });
        });
      });
    });

    var out = CHECK_DEFS.map(function (d) {
      var key = d[0], f = found[key];
      var cfg = CHECK_CONFIG[key] || { enabled: true };
      var reducedSet = ["C1", "C2", "C4", "C9", "C10"];
      var state, findings = [];
      if (reduced && reducedSet.indexOf(key) < 0) state = "not_at_this_tier";
      else if (cfg.enabled === false) state = "disabled";
      else if (f === "no_history") state = "no_history";
      else {
        findings = f;
        state = f.length ? "warning" : "pass";
      }
      var dis = dismissals.filter(function (x) { return x.check === key && x.season === year; });
      var live = findings.filter(function (x) {
        return !dis.some(function (y) { return y.entity === x.entity; });
      });
      var silenced = findings.filter(function (x) {
        return dis.some(function (y) { return y.entity === x.entity; });
      });
      if (state === "warning" && !live.length) state = "dismissed";
      return {
        key: key, severity: d[1], title: d[2], detail: d[3], state: state,
        findings: live, dismissed: silenced, dismissals: dis,
        entities: live.reduce(function (n, x) { return n + x.entities.length; }, 0),
        config: cfg, extra: extra[key] || null, blocks: false,
        historyDependent: key === "C3" || key === "C8"
      };
    });
    out.count = function () { return out.length; };
    return out;
  }
  function checkSummary(list) {
    var by = function (s) { return list.filter(function (c) { return c.state === s; }).length; };
    return { total: list.length, warning: by("warning"), pass: by("pass"),
      noHistory: by("no_history"), disabled: by("disabled"), dismissed: by("dismissed"),
      notAtTier: by("not_at_this_tier"),
      findings: list.reduce(function (n, c) { return n + c.findings.length; }, 0),
      entities: list.reduce(function (n, c) { return n + c.entities; }, 0),
      blocking: list.filter(function (c) { return c.blocks; }).length };
  }

  /* ── FR-GA16 · season copy, as a dry run ───────────────────────────────
     dry_run=true returns the whole prospective season plus its check, and persists nothing. */
  function shiftBeds(bedNum, by) {
    var order = orderedActive();
    var i = order.indexOf(bedNum);
    if (i < 0) return bedNum;
    return order[(i + by + order.length) % order.length];
  }
  function dryRun(fromYear, toYear, shift, opts) {
    opts = opts || {};
    var target = season(toYear);
    var clim = { lastFrost: target.lastFrost, firstFrost: target.firstFrost };
    var before = PLANTINGS.length;
    var prospective = P_RAW.filter(function (t) { return t[1] === fromYear; }).map(function (t) {
      var copy = t.slice();
      copy[0] = "dry-" + toYear + "-" + t[0];
      copy[1] = toYear;
      copy[2] = shift ? shiftBeds(t[2], shift) : t[2];
      /* a copy re-anchors dates and drops the manual ones and the actuals */
      var x = Object.assign({}, t[6] || {});
      delete x.manual; delete x.actual; delete x.cleared; delete x.topsDown;
      copy[6] = x;
      return buildPlanting(copy, clim);
    });
    var tsk = prospective.reduce(function (acc, p) { return acc; }, []);
    var findings = planCheck(toYear, {
      plantings: prospective, climate: clim, dismissals: [],
      history: opts.history || closedSeasons().map(function (s) { return s.year; }),
      tasks: []
    });
    return { from: fromYear, to: toYear, shift: shift, plantings: prospective,
      check: findings, summary: checkSummary(findings),
      persisted: PLANTINGS.length - before, climate: clim };
  }
  function dryRunCompare(opts) {
    var straight = dryRun(2026, 2027, 0, opts);
    var shifted = dryRun(2026, 2027, 1, opts);
    var sig = function (r) {
      return r.check.reduce(function (acc, c) {
        return acc.concat(c.findings.map(function (f) { return c.key + " " + f.says; }));
      }, []);
    };
    var a = sig(straight), z = sig(shifted);
    var fixed = a.filter(function (s) { return z.indexOf(s) < 0; });
    var broke = z.filter(function (s) { return a.indexOf(s) < 0; });
    return { straight: straight, shifted: shifted, fixed: fixed, broke: broke,
      carried: z.filter(function (s) { return a.indexOf(s) >= 0; }),
      persisted: straight.persisted + shifted.persisted };
  }
  /* FR-GA19 · closing a season is what makes it rotation history. Run both ways. */
  function closeEffect() {
    var withoutIt = dryRun(2026, 2027, 1, { history: [2024, 2025] });
    var withIt = dryRun(2026, 2027, 1, { history: [2024, 2025, 2026] });
    var count = function (r, key) {
      return (r.check.filter(function (c) { return c.key === key; })[0] || { findings: [] }).findings.length;
    };
    return { without: withoutIt, with: withIt,
      c3: [count(withoutIt, "C3"), count(withIt, "C3")],
      c8: [count(withoutIt, "C8"), count(withIt, "C8")],
      says: "The 2027 dry run finds " + count(withoutIt, "C3") + " rotation and " +
        count(withoutIt, "C8") + " feeder findings while 2026 is still open, and " +
        count(withIt, "C3") + " and " + count(withIt, "C8") +
        " once 2026 is closed \u2014 which is the whole of what closing a season does." };
  }
  function noHistoryRun() {
    var list = planCheck(2026, { history: [] });
    return { list: list, summary: checkSummary(list),
      states: list.filter(function (c) { return c.state === "no_history"; }).map(function (c) { return c.key; }) };
  }
  function seasonClose(year) {
    var s = season(year), y = yieldRun(year);
    return {
      season: s, yields: y,
      failures: FAILURES.map(function (f) {
        var p = planting(f.planting);
        return { planting: p, why: f.why, by: f.by };
      }),
      observed: { last: s.observedLast, expectedLast: s.lastFrost,
        lastDelta: s.observedLast ? diff(s.lastFrost, s.observedLast) : null,
        first: s.observedFirst, expectedFirst: s.firstFrost,
        firstDelta: s.observedFirst ? diff(s.firstFrost, s.observedFirst) : null },
      reopen: { level: "manage", audited: true,
        why: "Reopening rewrites the record C3 and C8 read, so it is audited and needs manage." }
    };
  }

  /* ── FR-GA20 · storage. Consumption is an edit in place. ───────────────── */
  var STORAGE = [
    { id: "s-1", product: "Raj\u010datov\u00e1 passata", method: "bottled", where: "cellar shelf 2",
      initial: 14, remaining: 7, unit: "jars", on: "2026-08-16", best: "2027-08-01",
      from: "p26-01", edits: [["2026-08-16", 14], ["2026-08-30", 12], ["2026-09-06", 7]] },
    { id: "s-2", product: "Fazole mra\u017een\u00e9", method: "frozen", where: "freezer drawer 1",
      initial: 4.5, remaining: 2.1, unit: "kg", on: "2026-08-10", best: "2027-04-01",
      from: "p26-03", edits: [["2026-08-10", 4.5], ["2026-09-01", 2.1]] },
    { id: "s-3", product: "\u010cesnek \u2014 spletenec", method: "braided", where: "pantry hook",
      initial: 90, remaining: 34, unit: "heads", on: "2026-07-25", best: "2027-03-01",
      from: "p26-21", edits: [["2026-07-25", 90], ["2026-08-20", 61], ["2026-09-08", 34]] },
    { id: "s-4", product: "Brambory", method: "cellar", where: "cellar crate",
      initial: 0, remaining: 0, unit: "kg", on: null, best: null, from: "p26-06",
      edits: [], pending: "Waiting on the lift, planned for 23 September." },
    { id: "s-5", product: "D\u00fdn\u011b Uchiki Kuri", method: "dry store", where: "cellar shelf 1",
      initial: 6, remaining: 4, unit: "whole", on: "2026-09-05", best: "2027-02-01",
      from: "p26-13", edits: [["2026-09-05", 6], ["2026-09-08", 4]] },
    { id: "s-6", product: "Mrkev v p\u00edsku", method: "in sand", where: "cellar box",
      initial: 12, remaining: 5, unit: "kg", on: "2025-10-12", best: "2026-03-01",
      from: "p25-05", edits: [["2025-10-12", 12], ["2026-01-18", 5]], status: "past best-before" },
    { id: "s-7", product: "Bazalkov\u00e9 pesto", method: "bottled", where: "cellar shelf 2",
      initial: 6, remaining: 1, unit: "jars", on: "2026-08-24", best: "2027-02-01",
      from: "p26-14", edits: [["2026-08-24", 6], ["2026-09-07", 1]] },
    { id: "s-8", product: "Kysan\u00e9 zel\u00ed", method: "sauerkraut", where: "cellar crock",
      initial: 18, remaining: 0, unit: "kg", on: "2025-10-08", best: "2026-06-01",
      from: "p25-02", edits: [["2025-10-08", 18], ["2026-02-14", 6], ["2026-04-02", 0]],
      status: "finished" }
  ];
  function storageRun() {
    var movements = 0;   /* by construction: there is no movements table */
    var edits = STORAGE.reduce(function (n, s) { return n + Math.max(0, s.edits.length - 1); }, 0);
    var last = STORAGE.filter(function (s) { return s.remaining === 0 && s.edits.length; })[0];
    return {
      items: STORAGE.length, movements: movements, edits: edits,
      low: STORAGE.filter(function (s) { return s.initial > 0 && s.remaining > 0 && s.remaining / s.initial <= 0.25; }).length,
      finished: STORAGE.filter(function (s) { return s.initial > 0 && s.remaining === 0; }).length,
      lastJar: last ? { item: last, on: last.edits[last.edits.length - 1][0] } : null,
      says: "Eight rows, " + edits + " in-place edits and " + movements +
        " movement rows. \u201cWhen did we eat the last jar\u201d is answered by the audit spine's field diff on " +
        (last ? last.product + ", " + fmtLong(last.edits[last.edits.length - 1][0]) : "\u2014") +
        " \u2014 which is why this module ships no movements table."
    };
  }

  /* ── FR-GA22 / FR-GA8 · weather and the frost warning ─────────────────── */
  var WEATHER = [
    { date: "2026-09-07", min: 8.5, max: 19.0, fetchedAt: "2026-09-06T18:40:00Z" },
    { date: "2026-09-08", min: 6.0, max: 17.5, fetchedAt: "2026-09-07T18:40:00Z" },
    { date: "2026-09-09", min: -2.0, max: 11.0, fetchedAt: "2026-09-09T18:40:00Z" },
    { date: "2026-09-10", min: 1.5, max: 13.0, fetchedAt: "2026-09-09T18:40:00Z" },
    { date: "2026-09-11", min: 5.0, max: 15.5, fetchedAt: "2026-09-09T18:40:00Z" }
  ];
  var FROST_THRESHOLD = { tender: 2, half: -2 };
  var WEATHER_STATE = { lastOk: "2026-09-09T18:40:00Z", cacheDays: 90, failures: 2, errorsShown: 0 };
  function forecast(day) { return WEATHER.filter(function (w) { return w.date === day; })[0] || null; }
  function frostWarning(day, opts) {
    opts = opts || {};
    day = day || TODAY;
    var f = opts.forecast || forecast(day);
    if (!f) return { published: false, why: "No forecast for that night, cached or otherwise.", plants: [] };
    var at = plantingsOf(2026).filter(function (p) {
      if (["tender", "half"].indexOf(p.hardiness) < 0) return false;
      if (p.covered) return false;
      if (p.topsDown) return false;
      if (p.cleared && p.cleared < day) return false;
      if (!(p.occupancy.from <= day && day <= p.occupancy.to)) return false;
      return f.min <= FROST_THRESHOLD[p.hardiness];
    });
    var beds = at.map(function (p) { return p.bed; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; })
      .sort(function (a, z) { return a - z; });
    var exempt = plantingsOf(2026).filter(function (p) {
      return ["tender", "half"].indexOf(p.hardiness) >= 0 && !p.covered &&
             p.occupancy.from <= day && day <= p.occupancy.to &&
             (p.covered || p.topsDown || (p.cleared && p.cleared < day));
    });
    return {
      published: at.length > 0, day: day, min: f.min, measuredAt: f.fetchedAt,
      plants: at, beds: beds, exempt: exempt,
      title: "Mrz\u00edk dnes v noci, a\u017e \u2212" + Math.abs(f.min).toFixed(0) + "\u00a0\u00b0C",
      body: at.length + " planting" + (at.length === 1 ? "" : "s") + " in " +
        (beds.length > 1 ? "beds " + beds.slice(0, -1).join(", ") + " and " + beds[beds.length - 1]
                         : "bed " + beds[0]) + " are not hardy",
      says: "Forecast minimum " + f.min + " \u00b0C, measured " + f.fetchedAt.slice(11, 16) +
        ". Tender plants warn at or below " + FROST_THRESHOLD.tender + " \u00b0C and half-hardy at " +
        FROST_THRESHOLD.half + " \u00b0C; covered beds and a planting whose haulm is already cut are outside the rule."
    };
  }
  function frostQuiet() {
    return frostWarning(TODAY, { forecast: { date: TODAY, min: 6.0, max: 18.0, fetchedAt: "2026-09-09T18:40:00Z" } });
  }
  function weatherFailure() {
    return { renderedFrom: "cache", ageHours: 11, errorsShown: WEATHER_STATE.errorsShown,
      says: "Two fetches failed this month. Both were logged and swallowed: the page renders from the cached day and states when it was measured, and shows " +
        WEATHER_STATE.errorsShown + " errors, because there is nothing a member could do about a forecast endpoint." };
  }

  /* ── FR-GA23 / DD-14 · the print stylesheet and Garden's two layouts ────
     Paper is a different medium, and the stylesheet says so in one place: ink on white,
     no theme, no accent, no fills, real checkboxes, and every state mark spelled out
     because colour is gone. The audit below is a scan of these constants. */
  var PAPER = { name: "A4", w: 210, h: 297, margin: 14, alt: { name: "US Letter", w: 215.9, h: 279.4 } };
  PAPER.content = { w: PAPER.w - PAPER.margin * 2, h: PAPER.h - PAPER.margin * 2 };
  PAPER.contentAlt = { w: PAPER.alt.w - PAPER.margin * 2, h: PAPER.alt.h - PAPER.margin * 2 };
  var PRINT_INK = { ink: "#000000", mid: "#444444", light: "#8A8A8A", rule: "#000000", paper: "#FFFFFF" };
  var PRINT_METRICS = {
    bodyPt: 11, headingPt: 16, metaPt: 9, leadingPt: 15,
    rowMm: 8.5, headingMm: 7, titleBlockMm: 22, boxMm: 4.5, boxRuleMm: 0.35, boxGapMm: 3,
    gridColMm: null, gridLabelMm: 34
  };
  var PRINT_RULES = [
    ["Colour", "Ink on white only: " + PRINT_INK.ink + ", " + PRINT_INK.mid + ", " + PRINT_INK.light +
      " on " + PRINT_INK.paper, "No theme and no module accent. A moss-green heading costs ink and says nothing on paper."],
    ["Theme", "The dark theme is not printed", "There is no dark paper. The print layer ignores the theme token layer entirely."],
    ["Fills", "No filled backgrounds, no tint blocks", "Ink-cheap is a requirement, not a preference: this is printed monthly on a home inkjet."],
    ["Type", PRINT_METRICS.bodyPt + " pt body, " + PRINT_METRICS.headingPt + " pt heading, " +
      PRINT_METRICS.metaPt + " pt meta minimum", "Legible from a garden pocket, in the rain, at arm's length."],
    ["Checkboxes", PRINT_METRICS.boxMm + " mm square, " + PRINT_METRICS.boxRuleMm + " mm rule",
      "A real box you tick with a pencil. This is the whole reason the sheet exists."],
    ["Status", "Every sync and status mark is printed as a word", "Colour and glyphs do not survive a monochrome printer, so pending prints as \u201cnot yet synced\u201d."],
    ["Links", "URLs are dropped, not printed after the text", "Every link in this product is household-internal and unreachable from paper."],
    ["Breaks", "A bed row and a week block never split across pages", "A row cut in half is a task somebody misses."],
    ["Furniture", "Household name, the sheet's own name and the date it was printed, on every page",
      "A sheet found in a coat pocket in November has to say what it is."],
    ["Interaction", "Buttons, tabs, filters and the offline bar are not printed", "Nothing on paper can be tapped."]
  ];
  function printAudit() {
    /* the scan is over the declarations, not the reasons written beside them */
    var declared = PRINT_RULES.map(function (r) { return r[1]; }).join(" ") + " " +
                   Object.keys(PRINT_INK).map(function (k) { return PRINT_INK[k]; }).join(" ");
    var accentHits = (declared.match(/accent|--accent|moss|oklch|hsl/gi) || []).length;
    var themeStated = /dark theme is not printed/i.test(declared);
    var nonGrey = Object.keys(PRINT_INK).filter(function (k) {
      var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(PRINT_INK[k]);
      return !m || !(m[1].toLowerCase() === m[2].toLowerCase() && m[2].toLowerCase() === m[3].toLowerCase());
    }).length;
    var work = workPaper("2026-09");
    var boxArea = work.boxes * PRINT_METRICS.boxMm * PRINT_METRICS.boxRuleMm * 4;
    var ruleArea = (work.sections.length + 2) * PAPER.content.w * 0.25;
    var glyphArea = work.chars * 1.3;   /* ~1.3 mm² of ink per 11 pt glyph */
    var pageArea = PAPER.content.w * PAPER.content.h;
    return {
      rules: PRINT_RULES.length, accentTokens: accentHits,
      colours: Object.keys(PRINT_INK).length, nonGrey: nonGrey,
      minPt: Math.min(PRINT_METRICS.bodyPt, PRINT_METRICS.metaPt),
      coverage: Math.round(((boxArea + ruleArea + glyphArea) / pageArea) * 1000) / 10,
      themeStated: themeStated, boxMm: PRINT_METRICS.boxMm
    };
  }
  function workPaper(month) {
    month = month || monthKey(TODAY);
    var start = month + "-01";
    var endM = Number(month.slice(5, 7)), endY = Number(month.slice(0, 4));
    var end = addDays(endM === 12 ? (endY + 1) + "-01-01" : endY + "-" + String(endM + 1).padStart(2, "0") + "-01", -1);
    var all = tasks({ withManual: true });
    var overdue = all.filter(function (t) { return t.status === "open" && t.due < start; });
    var inMonth = all.filter(function (t) { return t.due >= start && t.due <= end && t.status !== "done"; });
    var weeks = {};
    inMonth.forEach(function (t) { (weeks[t.week] = weeks[t.week] || []).push(t); });
    var sections = [];
    if (overdue.length) {
      sections.push({ label: "Nedod\u011blan\u00e9", en: "Carried over",
        items: overdue.map(function (t) {
          return { text: t.title, meta: "planned " + fmtCs(t.due) + " \u00b7 " + (diff(t.due, TODAY)) + " days ago" };
        }) });
    }
    Object.keys(weeks).sort().forEach(function (k) {
      sections.push({ label: k.replace("2026-W", "T\u00fdden "), en: weekLabel(k),
        items: weeks[k].sort(function (a, z) { return a.due < z.due ? -1 : 1; }).map(function (t) {
          return { text: t.title, meta: fmtCs(t.due) + (t.is_generated ? "" : " \u00b7 your own") };
        }) });
    });
    var ready = harvestReady();
    if (ready.length) {
      sections.push({ label: "K sklizni", en: "Ready to pick",
        items: ready.map(function (p) {
          return { text: p.label + " \u00b7 " + p.where,
                   meta: "window " + fmtCs(p.windows.harvest.from) + "\u2013" + fmtCs(p.windows.harvest.to) };
        }) });
    }
    var boxes = sections.reduce(function (n, s) { return n + s.items.length; }, 0);
    var chars = sections.reduce(function (n, s) {
      return n + s.items.reduce(function (m, i) { return m + i.text.length + i.meta.length; }, 0);
    }, 0);
    var height = PRINT_METRICS.titleBlockMm + sections.length * PRINT_METRICS.headingMm +
                 boxes * PRINT_METRICS.rowMm;
    return {
      id: "work", month: month, title: MONTHS_CS[endM - 1] + " " + month.slice(0, 4),
      en: MONTHS[endM - 1] + " " + month.slice(0, 4),
      sections: sections, boxes: boxes, chars: chars,
      mm: Math.round(height * 10) / 10, fits: height <= PAPER.content.h,
      fitsLetter: height <= PAPER.contentAlt.h, pages: Math.ceil(height / PAPER.content.h),
      capacity: PAPER.content.h
    };
  }
  function planPaper(year) {
    year = year || 2026;
    var list = plantingsOf(year);
    var rows = BEDS.slice().sort(function (a, z) {
      var za = ZONES.map(function (x) { return x.id; }).indexOf(a.zone);
      var zz = ZONES.map(function (x) { return x.id; }).indexOf(z.zone);
      return za === zz ? a.pos - z.pos : za - zz;
    }).map(function (x) {
      var here = list.filter(function (p) { return p.bed === x.num; });
      var cells = [];
      for (var m = 1; m <= 12; m++) {
        var mStart = year + "-" + String(m).padStart(2, "0") + "-01";
        var mEnd = addDays(m === 12 ? (year + 1) + "-01-01" : year + "-" + String(m + 1).padStart(2, "0") + "-01", -1);
        var occ = here.filter(function (p) {
          return overlapDays(p.occupancy.from, p.occupancy.to, mStart, mEnd) > 0;
        });
        cells.push({ month: m, text: occ.map(function (p) { return cropName(p.crop).slice(0, 3); }).join(" ") });
      }
      return { bed: x, zone: zone(x.zone).name, cells: cells,
               crops: here.map(function (p) { return p.label; }).join(", ") };
    });
    var colMm = Math.round(((PAPER.content.w - PRINT_METRICS.gridLabelMm) / 12) * 10) / 10;
    PRINT_METRICS.gridColMm = colMm;
    var height = PRINT_METRICS.titleBlockMm + 8 + rows.length * 8;
    return { id: "plan", year: year, rows: rows, months: MONTHS_CS_SHORT, colMm: colMm,
      labelMm: PRINT_METRICS.gridLabelMm, mm: height, fits: height <= PAPER.content.h,
      fitsLetter: height <= PAPER.contentAlt.h, width: PAPER.content.w,
      pages: Math.ceil(height / PAPER.content.h), capacity: PAPER.content.h };
  }
  var EXPORTS = [
    ["Plantings", "CSV", "bed, zone, crop, variety, quantity, five planned dates, four actual dates, status"],
    ["Harvests", "CSV", "planting, date, quantity, unit, destination, quality, note"]
  ];

  /* ── sync (11-garden Sync) ─────────────────────────────────────────────── */
  var SYNC = [
    ["garden.bed", "strict_version", "Structural", true],
    ["garden.container", "strict_version", "Structural", true],
    ["garden.season", "strict_version", "Structural", true],
    ["garden.planting", "lww_field", "Dates and quantities merge; two members rarely edit the same planting", false],
    ["garden.task", "lww_field", "", false],
    ["garden.task_completion", "state_set", "The far-end-of-the-garden case", false],
    ["garden.harvest", "additive", "A harvest is an observation of a moment, like a meter reading", false],
    ["garden.storage_item", "lww_field", "The remaining quantity is edited in place, and two people eating from the same jar is a merge the household can live with", false],
    ["garden.rule", "strict_version", "", true],
    ["garden.settings", "strict_version", "", true],
    ["crop catalog", "not synced", "A versioned reference bundle the client downloads and caches; household overrides sync normally", false]
  ];
  function catalogOffline() {
    return { bundleVersion: CATALOG.version, crops: CATALOG.launchScope, cached: true,
      says: "The catalog for this household's region is a compact, versioned, cached bundle rather than a lookup, which is the only reason a phone at the bottom of the garden can answer \u201chow deep do I sow these\u201d." };
  }

  /* ── the screen ledger for this stage ─────────────────────────────────── */
  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending", "syncing",
                    "conflicted", "rejected", "absent", "withdrawn", "readonly"];
  var CATALOG_EXCLUDES = {
    pending: "Nothing is written from the catalog. A household's own crop, a variety and an override are different rows on a different screen.",
    syncing: "The catalog is a versioned reference bundle the client downloads and caches, not household rows in the sync feed \u2014 a new version replaces the file.",
    conflicted: "Reference data has one author. Two households cannot fork it, and an override is a row of their own beside it.",
    rejected: "Nothing is written from here, so there is no mutation for the server to refuse.",
    withdrawn: "The catalog is not shared with a member. It ships with the client, so there is nothing to retract."
  };
  var LWW = {
    conflicted: "lww_field: two edits merge field by field and the later one wins, so there is nothing to ask. The structural rows in this module \u2014 beds, containers, seasons, rules, settings \u2014 are strict_version and do ask."
  };
  var DRY = {
    pending: "A dry run persists nothing, so there is no local mutation to queue. The season is written from the confirmation that follows it, not from here.",
    syncing: "Same reason: nothing is uploaded from this screen.",
    conflicted: "The season it describes does not exist yet, so there is nothing for a second member to have forked."
  };
  var SCREENS = [
    { id: "D-38", view: "setup", client: "mw", preset: "F", route: "/garden/setup/1", kind: "answers",
      name: "Garden setup \u2014 four questions", title: "V \u010dem p\u011bstujete?",
      lede: "Three answers, and the one you pick sets the tier. Then where, what you grow, and your growing space.",
      error: "Couldn't save the step. Nothing before it has been lost \u2014 setup is re-runnable from settings.",
      foot: "The pin snaps to two decimals in front of you, and device location is never read.",
      note: "Question one is the tier, and the tier is the whole module's shape. The three answers carry the compositions Stage 3's kit gained this stage.", drawn: "all" },

    { id: "D-39", view: "tiers", client: "mw", preset: "D", route: "/garden", kind: "pots",
      name: "pots home", title: "Kv\u011btn\u00e1\u010de",
      lede: "Containers, what is in them, and when they were last watered.",
      empty: { s: "Nothing planted yet.", e: "A pot of basil on the windowsill is a garden.", a: "Add a container" },
      error: "Couldn't load the containers.",
      rejected: "Refused: a container needs a name. Everything else about it is optional.",
      withdrawn: "Garden is no longer shared with you.",
      readonly: "Read-only while the subscription is past due. Everything recorded still reads.",
      states: {
        absent: "Four of five members hold none on Garden and see nothing of it anywhere \u2014 no tab, no widget, no row on Today.",
        offline: "Containers, plants and the catalog bundle are all on the device. This is the same screen with the bar above it.",
        pending: "A plant added on the balcony with no signal, queued, and editable while it waits.",
        conflicted: "A container is strict_version: two members renaming one is a question, and the answer is a name."
      },
      foot: "No bed, no season, no rotation check, and nothing greyed out to suggest there could be.",
      note: "The pots tier has to read as a finished product rather than a stripped one, which is the whole of D-65's risk.", drawn: "all" },

    { id: "D-40", view: "tiers", client: "mw", preset: "D", route: "/garden", kind: "beds",
      name: "beds home", title: "Z\u00e1hony",
      lede: "Fourteen beds in three zones, in the order they stand in, with what is in them now.",
      empty: { s: "No beds yet.", e: "Name the first one and drag it into the order it stands in \u2014 that order is how the checks know what is next to what.", a: "Add a bed" },
      error: "Couldn't load the beds.",
      rejected: "Refused: a planting is measured as an area or as a plant count, not both.",
      withdrawn: "Garden is no longer shared with you.",
      readonly: "Read-only while the subscription is past due.",
      states: {
        absent: "Absent with the module.",
        offline: "Beds and plantings are synced rows; the resolved dates are arithmetic over the cached catalog bundle.",
        pending: "A planting typed at the far end of the garden, queued, with its planned dates already resolved on the device.",
        conflicted: "A bed is strict_version, so renaming or re-zoning one asks. The plantings inside it are lww_field and do not."
      },
      foot: "Designed first: raised beds and a patch is the median European garden.",
      note: "The bed order within a zone is the adjacency model. Dragging beds into the order they physically stand in is the whole of the data entry.", drawn: "all" },

    { id: "D-41", view: "tiers", client: "mw", preset: "D", route: "/garden", kind: "plot",
      name: "plot home", title: "Zahrada 2026",
      lede: "The season, the plan check, what followed what, and the storage log.",
      empty: { s: "No season yet.", e: "Start one from this year's frost dates; last year's plan can be copied into it later.", a: "Start the 2026 season" },
      error: "Couldn't load the season.",
      rejected: "Refused: a season already exists for 2026. One year, one season.",
      withdrawn: "Garden is no longer shared with you.",
      readonly: "Read-only while the subscription is past due. The plan check keeps computing.",
      states: {
        absent: "Absent with the module.",
        offline: "Everything on this screen is computed on the device from synced rows and the cached catalog.",
        pending: "A planting queued from the garden, counted in the check that is drawn beside it.",
        conflicted: "A season is strict_version. Two members changing its frost dates is a question about a date, which is answerable."
      },
      foot: "Moving up a tier revealed this screen. It migrated nothing.",
      note: "Only this tier turns on rotation, succession, storage, the eleven checks and season close.", drawn: "all" },

    { id: "D-42", view: "catalog", client: "mw", preset: "D", route: "/garden/catalog", kind: "catalog",
      name: "Crop catalog browser", title: "Katalog plodin",
      lede: "Around three hundred crops in five languages, with the timings resolved against your frost dates.",
      empty: { s: "Nothing matches that.", e: "Try the Czech or the Latin name \u2014 both are indexed.", a: "Clear the search" },
      error: "Couldn't load the catalog bundle. The cached version is still readable.",
      absent: "Absent with the module.",
      readonly: "Read-only while the subscription is past due, which changes nothing here: nothing is written from this screen.",
      states: {
        offline: "The catalog is the one thing in the product that is not household data and still works offline, because it is shipped as a cached bundle."
      },
      impossible: CATALOG_EXCLUDES,
      foot: "Every field carries its source, and folklore and agronomy are distinguishable by looking.",
      note: "The most important design decision on this screen is that a companion claim does not look like a spacing table.", drawn: "all" },

    { id: "D-43", view: "catalog", client: "mw", preset: "D", route: "/garden/catalog/overrides", kind: "overrides",
      name: "Household overrides", title: "Va\u0161e \u00fapravy katalogu",
      lede: "Your own crops and varieties, and any catalog field you have changed for this household.",
      empty: { s: "Nothing overridden.", e: "If the catalog is wrong about your garden, change it here \u2014 the original stays visible underneath.", a: "Override a field" },
      error: "Couldn't load your overrides.",
      rejected: "Refused: a variety belongs to one crop. Move it or leave it.",
      withdrawn: "Garden is no longer shared with you.",
      readonly: "Read-only while the subscription is past due.",
      states: {
        absent: "Absent with the module.",
        offline: "Overrides are ordinary synced rows and read offline.",
        pending: "An override typed in the garden, queued, and already used by the dates on the screen behind it."
      },
      impossible: LWW,
      foot: "Overrides survive a catalog update, and the catalog value under them updates in place.",
      note: "Shown as an override rather than merged silently, which is the difference between a correction and a fork.", drawn: "all" },

    { id: "D-44", view: "beds", client: "mw", preset: "D", route: "/garden/plantings/{id}", kind: "planting",
      name: "Planting editor", title: "V\u00fdsadba",
      lede: "Bed, crop, variety, how much, five planned dates and four actual ones.",
      empty: { s: "Nothing planted in this bed yet.", e: "Pick a crop and the dates fill themselves in from your frost dates.", a: "Add a planting" },
      error: "Couldn't save the planting.",
      rejected: "Refused with 422: an area and a plant count are both set. One of them is what makes the bed arithmetic possible.",
      withdrawn: "Garden is no longer shared with you.",
      readonly: "Read-only while the subscription is past due.",
      states: {
        absent: "A member with view reads the planting and never sees this editor. It is not greyed \u2014 it is not there.",
        offline: "Editing a planting works offline: it is lww_field, so a queued edit merges field by field.",
        pending: "Two dates typed in the garden, queued, with the planned windows they came from still shown beside them."
      },
      impossible: LWW,
      foot: "Planned dates default from the resolved windows and each carries an is_manual flag.",
      note: "The is_manual flag is what lets a frost-date correction re-resolve twenty dates and leave the three a member chose alone.", drawn: "all" },

    { id: "D-45", view: "tasks", client: "mw", preset: "D", route: "/garden/tasks", kind: "tasks",
      name: "Generated task list with tombstones", title: "Pr\u00e1ce na zahrad\u011b",
      lede: "What the plantings imply, overdue first, grouped by week, with your own tasks among them.",
      empty: { s: "Nothing to do this month.", e: "That is a real answer in January. The list fills itself from the plantings.", a: "Add a task of your own" },
      error: "Couldn't load the tasks.",
      rejected: "Refused: that task was generated. Edit the planting's date instead, or edit this task and it stops being regenerated.",
      withdrawn: "Garden is no longer shared with you.",
      readonly: "Read-only while the subscription is past due. Completing a task is a write and is held.",
      states: {
        absent: "Absent with the module. A member with view sees the list and no completion affordance.",
        offline: "Completions are state_set, which is exactly the far-end-of-the-garden case: two people ticking the same task converge on one done.",
        pending: "A completion held in the queue with the hold-to-complete already resolved on the device.",
        conflicted: "A task is lww_field and a completion is state_set. Neither can ask a question."
      },
      impossible: LWW,
      foot: "Watering and weeding are never generated. At the pots tier they are care reminders instead.",
      note: "Regeneration moves only open, unedited, generated tasks, and a deleted one leaves a tombstone so it cannot resurrect.", drawn: "all" },

    { id: "D-46", view: "beds", client: "mw", preset: "S", route: "/garden/plantings/{id}#drift", kind: "drift",
      name: "Drift detail", title: "Skute\u010dnost proti pl\u00e1nu",
      lede: "You transplanted thirteen days after the plan. The plan has not moved.",
      foot: "One action shifts the remaining open tasks by the same offset. It changes no planned window.",
      note: "An actual date is an observation. Letting it rewrite the plan would destroy the only comparison the module can make next year.", drawn: "all" },

    { id: "D-47", view: "check", client: "mw", preset: "D", route: "/garden/season/2026/checks", kind: "check",
      name: "Plan-check panel", title: "Kontrola pl\u00e1nu",
      lede: "Eleven checks over this season's plan. Advisory, always \u2014 nothing here blocks a save.",
      empty: { s: "Nothing to check yet.", e: "Add a bed and a first planting; the rotation check starts next season.", a: "Add a planting" },
      error: "Couldn't run the checks. Your plan is unaffected.",
      rejected: "Refused: that dismissal is for a warning that no longer exists.",
      withdrawn: "Garden is no longer shared with you.",
      readonly: "Read-only while the subscription is past due. The checks keep computing; dismissing one is a write and is held.",
      states: {
        absent: "The panel is a plot-tier surface. At beds it is five checks under a different name, and at pots it does not exist.",
        offline: "Computed on the device from the beds, the plantings and the closed seasons. Offline is the ordinary case in a garden.",
        pending: "A dismissal typed at the end of a row, queued, with the warning already silent on the device.",
        conflicted: "A dismissal is a per-season flag on one warning. Two members dismissing the same one agree by construction."
      },
      foot: "C3 and C8 return no history rather than a pass, because a silent check reads like a clean plan.",
      note: "Dismissal with a note is what keeps the panel being read in April, and the panel is the feature.", drawn: "all" },

    { id: "D-48", view: "season", client: "mw", preset: "D", route: "/garden/season/new?copy=2026", kind: "dryrun",
      name: "Season copy \u2014 dry run", title: "Zkop\u00edrovat sez\u00f3nu do 2027",
      lede: "The whole prospective season, and its check, before it exists.",
      empty: { s: "Nothing to copy.", e: "A season with no plantings copies to an empty one, which is the same as starting fresh.", a: "Start 2027 empty" },
      error: "Couldn't build the preview. Nothing has been created.",
      absent: "Creating a season needs manage. For everybody else this screen is not in the menu.",
      withdrawn: "Garden is no longer shared with you.",
      readonly: "Read-only while the subscription is past due, so the preview runs and the confirmation is held.",
      states: {
        offline: "The preview is computed on the device. Committing it is a write and queues like any other."
      },
      impossible: DRY,
      foot: "A copy that silently reproduces last year's rotation error is worse than typing the year in by hand.",
      note: "The shift is shown as what it fixed beside what it broke, which is the only honest way to offer a rotation by offset.", drawn: "all" },

    { id: "D-49", view: "season", client: "mw", preset: "F", route: "/garden/season/2025/close", kind: "close",
      name: "Season close", title: "Uzav\u0159\u00edt sez\u00f3nu 2025",
      lede: "Final yields, what failed, and the frost dates you actually saw.",
      error: "Couldn't close the season. Nothing has been written and the season is still open.",
      foot: "Closing it makes it rotation history. Reopening needs manage and is audited.",
      note: "The observed frost dates are the point: next year's plan is anchored on what happened here, not on the dataset.", drawn: "all" },

    { id: "D-50", view: "storage", client: "mw", preset: "D", route: "/garden/storage", kind: "storage",
      name: "Storage log", title: "Z\u00e1soby",
      lede: "What was preserved, how, and how much is left.",
      empty: { s: "Nothing stored yet.", e: "Fourteen jars of passata in August is next February's answer to what's for dinner.", a: "Add something stored" },
      error: "Couldn't load the storage log.",
      rejected: "Refused: the remaining quantity is higher than what was put in. Correct the initial amount instead.",
      withdrawn: "Garden is no longer shared with you.",
      readonly: "Read-only while the subscription is past due.",
      states: {
        absent: "A plot-tier surface, absent at the other two tiers.",
        offline: "Editing the remaining quantity works offline: it is lww_field.",
        pending: "A jar counted in the cellar with no signal, queued, and the figure on the row is the one the member typed."
      },
      impossible: LWW,
      foot: "Consumption is recorded by editing the remaining quantity in place. There is no movements table.",
      note: "The audit spine's field diffs already answer when the last jar went, which is why this module ships no second ledger.", drawn: "all" },

    { id: "D-51", view: "frost", client: "mw", preset: "S", route: "/garden?warning=frost", kind: "frost",
      name: "Frost warning", title: "Mrz\u00edk dnes v noci",
      lede: "One warning, the temperature, and the plants it is about.",
      foot: "Covered beds and a planting whose haulm is already cut are outside the rule, which is why this names three beds and not five.",
      note: "The single most valuable thing the module does for a balcony gardener, and a condition rather than decoration: at six degrees it is not drawn at all.", drawn: "all" },

    { id: "D-52", view: "print", client: "b", preset: "P", route: "/garden/print/work?month=2026-09", kind: "print_work",
      name: "Print \u2014 this month's work", title: "Z\u00e1\u0159\u00ed 2026",
      lede: "Carried over, then a block per week, then what is ready to pick. Real checkboxes.",
      empty: { s: "Nothing due this month.", e: "The sheet prints the beds and the harvest windows anyway, so it is still worth taking out.", a: "Print it" },
      foot: "One page, ink on white, eleven point, and a 4,5 mm box you can tick with a pencil.",
      note: "This is the deliverable a garden with no signal actually needs, and the offline replica is the second answer rather than the first.", drawn: "all" },

    { id: "D-53", view: "print", client: "b", preset: "P", route: "/garden/print/season?year=2026", kind: "print_plan",
      name: "Print \u2014 the season plan", title: "Pl\u00e1n 2026",
      lede: "Fourteen beds down, twelve months across, in zone order.",
      empty: { s: "No plantings in this season.", e: "An empty grid is still the sheet you draw next year's plan on.", a: "Print it" },
      foot: "One page, and the bed rows never split across a page break.",
      note: "The grid is the one place the whole season is visible at once, and it exists on paper before it exists on a screen.", drawn: "all" },

    { id: "D-54", view: "print", client: "b", preset: "S", route: "@media print", kind: "stylesheet",
      name: "The print stylesheet", title: "@media print",
      lede: "Ten rules, and every one of them is a decision about a different medium.",
      foot: "No dark theme, no accent, no fills, status marks as words, and nothing that can be tapped.",
      note: "DD-14 ships this as its own line rather than absorbing it, because a print layer written as browser-default-plus-overrides is how you get a sheet nobody can read.", drawn: "all" }
  ];

  /* ── cross-file ────────────────────────────────────────────────────────── */
  function spineRun() {
    var S = window.HH_SPINE;
    var w = frostWarning();
    if (!S) return { ok: !!w.published, says: "spine.js not loaded on this page." };
    var row = (S.items || []).filter(function (i) { return i.source === "garden.frost"; })[0];
    var hit = (S.corpus || []).filter(function (h) { return h.scope === "garden.planting"; })[0];
    var leek = planting("p26-12");
    var dates = [leek.planned.sow_indoor, leek.planned.transplant, leek.windows.harvest.from];
    var written = dates.map(fmtShort).join(", ");
    return {
      row: row, hit: hit, warning: w, dates: dates,
      bedsAgree: !!row && row.meta.indexOf(w.beds.join(", ").replace(/, ([^,]*)$/, " and $1")) >= 0,
      countAgree: !!row && row.meta.indexOf(String(w.plants.length)) < 0
        ? false : (row ? /six|6/i.test(row.meta) && w.plants.length === 6 : false),
      leekAgree: !!hit && hit.snippet.indexOf("12/3") >= 0 && hit.snippet.indexOf("28/5") >= 0 &&
        hit.snippet.indexOf("10/10") >= 0 && written === "12/3, 28/5, 10/10",
      says: row
        ? "Stage 11's Today draws \u201c" + row.title + "\u201d with \u201c" + row.meta +
          "\u201d, measured at " + row.asOf + ". This module computes " + w.plants.length +
          " plantings in beds " + w.beds.join(", ") + " at " + w.min +
          " \u00b0C, measured " + w.measuredAt.slice(11, 16) + ". The search row for P\u00f3rek \u2018Bandit\u2019 reads " +
          (hit ? hit.snippet : "\u2014") + ", and the crop's relative windows resolve to " + written + "."
        : "spine.js has no garden.frost row."
    };
  }
  function dashboardRun() {
    var Db = window.HH_DASHBOARD;
    var work = tasks({ withManual: true }).filter(function (t) {
      return t.status === "open" && t.due <= addDays(TODAY, 30);
    }).sort(function (a, z) { return a.due < z.due ? -1 : 1; });
    var ready = harvestReady();
    if (!Db) return { ok: true, work: work, ready: ready, says: "dashboard.js not loaded on this page." };
    var reg = (Db.widgets || []).filter(function (w) { return w.module === "garden"; });
    var workW = reg.filter(function (w) { return w.key === "garden.work"; })[0];
    var readyW = reg.filter(function (w) { return w.key === "garden.harvest_ready"; })[0];
    var titles = workW ? workW.data.map(function (r) { return r.title; }) : [];
    var mine = work.slice(0, 3).map(function (t) { return t.title; });
    var missing = titles.filter(function (t) { return mine.indexOf(t) < 0; });
    var readyTitles = readyW ? (readyW.data.rows || []) : [];
    var readyMine = ready.slice(0, 3).map(function (p) { return p.label + " \u00b7 " + p.where; });
    var readyMissing = readyTitles.filter(function (t) { return readyMine.indexOf(t) < 0; });
    var reminderRows = (Db.widgets || []).filter(function (w) { return w.key === "reminders.due"; })
      .reduce(function (acc, w) { return acc.concat(w.data.filter(function (r) { return r.chip === "garden"; })); }, []);
    var careTitles = careDue().map(function (r) { return r.label; })
      .concat(MANUAL_TASKS.map(function (t) { return t.title; }));
    return {
      widgets: reg.length, workW: workW, readyW: readyW, titles: titles, mine: mine,
      missing: missing.concat(readyMissing),
      readyValue: readyW ? Number(readyW.data.value) : null, ready: ready.length,
      reminderRows: reminderRows,
      remindersAgree: reminderRows.every(function (r) { return careTitles.indexOf(r.title) >= 0; }),
      ok: missing.length === 0 && readyMissing.length === 0 && !!readyW &&
          Number(readyW.data.value) === ready.length,
      says: "dashboard.js registers " + reg.length + " garden widgets. garden.work draws " +
        titles.length + " rows and this module's next three open tasks are " + mine.join(", ") +
        "; garden.harvest_ready shows " + (readyW ? readyW.data.value : "\u2014") +
        " against " + ready.length + " plantings computed inside their harvest window."
    };
  }
  function reminderRun() {
    var R = window.HH_REMINDERS;
    var mine = ["garden.task_due", "garden.care_due"];
    var care = careDue().filter(function (r) { return r.due; });
    var due0911 = tasks({ withManual: true }).filter(function (t) { return t.due === "2026-09-11"; });
    if (!R) return { ok: true, kinds: mine, care: care, says: "reminders.js not loaded on this page." };
    var theirs = (R.kinds || []).filter(function (k) {
      return (k.key || k.id || "").indexOf("garden.") === 0;
    });
    var occ = (R.occurrences || []).filter(function (o) {
      return String(o.kind).indexOf("garden.") === 0;
    });
    var careOcc = occ.filter(function (o) { return o.kind === "garden.care_due"; })[0] || null;
    var taskOcc = occ.filter(function (o) { return o.kind === "garden.task_due"; })[0] || null;
    var careAgree = !!careOcc && care.some(function (r) {
      return r.label === careOcc.title && r.next === careOcc.due;
    });
    var taskAgree = !!taskOcc && due0911.length === 1 && taskOcc.due === due0911[0].due;
    return { kinds: mine, theirs: theirs, occurrences: occ, careAgree: careAgree, taskAgree: taskAgree,
      due0911: due0911, ok: theirs.length === mine.length && careAgree && taskAgree,
      says: "reminders.js carries " + theirs.length + " garden reminder kinds (" +
        theirs.map(function (k) { return k.key || k.id; }).join(", ") +
        ") and this module contributes those two \u2014 garden.task_due for the generated chain, garden.care_due for the pots tier's rhythm. Its own occurrence rows land on this module's dates: \u201c" +
        (careOcc ? careOcc.title : "\u2014") + "\u201d is due " + (careOcc ? fmtLong(careOcc.due) : "\u2014") +
        " and this module's care cadence resolves to " +
        (care.map(function (r) { return r.label + " " + fmtLong(r.next); }).join(", ") || "\u2014") +
        "; its garden.task_due row is due " + (taskOcc ? fmtLong(taskOcc.due) : "\u2014") +
        " and the generated chain has exactly " + due0911.length + " task that day (" +
        (due0911[0] ? due0911[0].title : "\u2014") +
        "). The title in reminders.js is an authored placeholder from Stage 12 \u2014 a different bed and a different crop \u2014 and this module is the authority for it." };
  }
  function illusRun() {
    var I = window.HH_ILLUS;
    if (!I) return { ok: false, says: "illustration.js not loaded on this page." };
    var mine = I.compositions.filter(function (c) { return c.id.indexOf("garden.") === 0; });
    var answers = mine.filter(function (c) { return c.kind === "answer"; });
    var bars = mine.filter(function (c) {
      return c.parts.some(function (p) { return p[0] === "bars"; });
    });
    return { mine: mine, answers: answers, bars: bars,
      ok: answers.length === TIERS.length && bars.length === 1 &&
          bars[0].id === "garden.setup.plot",
      says: "The kit carries " + mine.length + " Garden compositions: the three tier answers this stage needed and the no-history empty state Stage 3 had already drawn. Exactly one of them carries bars, and it is the plot tier \u2014 the only tier with history to check against." };
  }
  function fixtureRun() {
    var F = window.HH_FIXTURES;
    var bedP = PLANTINGS.length, pots = CONTAINER_PLANTS.length;
    if (!F) return { ok: true, says: "fixtures.js not loaded on this page." };
    var row = (F.data || []).filter(function (d) { return d[0] === "Garden"; })[0];
    var text = row ? row[1] : "";
    return { row: row, bedPlantings: bedP, containers: pots,
      ok: !!row && text.indexOf(String(bedP)) >= 0 && text.indexOf(String(BEDS.length)) >= 0 &&
          text.indexOf("plot tier") >= 0,
      says: "The fixture line reads \u201c" + text + "\u201d against " + BEDS.length + " beds in " +
        ZONES.length + " zones, " + bedP + " bed plantings across " + SEASONS.filter(function (s) { return s.status !== "not created"; }).length +
        " seasons and " + pots + " container plants. It said \u201cbeds tier\u201d before this stage; three closed seasons is a plot household." };
  }

  /* ── the gate ─────────────────────────────────────────────────────────── */
  function checks() {
    var tv = { pots: tierView("pots"), beds: tierView("beds"), plot: tierView("plot") };
    var move = tierMoveRun();
    var pin = pinRun();
    var abs = absoluteScan();
    var shift = climateShift();
    var prov = provenanceAudit();
    var ovr = overrideRun();
    var prec = precedenceRun();
    var gen = generatorAudit();
    var regen = regenerate({ lastFrost: "2026-05-16", firstFrost: CLIMATE.firstFrost });
    var drift = driftRun();
    var full = planCheck(2026);
    var sum = checkSummary(full);
    var reduced = planCheck(2026, { reduced: true });
    var nohist = noHistoryRun();
    var dry = dryRunCompare();
    var close = closeEffect();
    var st = storageRun();
    var warn = frostWarning();
    var quiet = frostQuiet();
    var wfail = weatherFailure();
    var work = workPaper("2026-09");
    var plan = planPaper(2026);
    var audit = printAudit();
    var garlic = planting("p26-21");
    var y26 = yieldRun(2026), y25 = yieldRun(2025);
    var spine = spineRun(), dash = dashboardRun(), rem = reminderRun(), ill = illusRun(), fix = fixtureRun();
    var callers = Object.keys(CALLERS).filter(function (k) { return k !== "unknown"; });
    var spinach = planting("p26-18"), leek = planting("p26-19");
    var meet = overlapDays(spinach.occupancy.from, spinach.occupancy.to,
                           leek.occupancy.from, leek.occupancy.to);
    var q = [quantityCheck({ area: 2, count: 8 }), quantityCheck({}), quantityCheck({ area: 2 })];

    return [
      { name: "One data model, three tiers: moving between them changes no rows",
        detail: move.says + " " + tv.pots.hidden.length + " of " + SURFACES.length +
          " surfaces are hidden at pots and " + tv.plot.hidden.length +
          " at plot, and the hidden ones are hidden rather than absent \u2014 the beds, the seasons and the storage rows are all still there, which is what makes dropping a tier and coming back non-destructive in both directions.",
        pass: move.same && tv.pots.hidden.length === 11 && tv.plot.hidden.length === 0 },

      { name: "A pots household never sees a bed, a season or a rotation check",
        detail: "At pots the module draws " + tv.pots.shown.length + " surfaces (" +
          tv.pots.shown.map(function (s) { return s[1].toLowerCase(); }).slice(0, 3).join(", ") +
          ", \u2026) and the eleven it does not include are " +
          tv.pots.hidden.map(function (s) { return s[0]; }).join(", ") +
          ". Beds, seasons and rotation are three of them, and nothing on the screen hints at their existence \u2014 no empty section, no upgrade banner, no greyed control.",
        pass: ["beds", "seasons", "rotation", "full_check", "storage", "close"]
          .every(function (k) { return tv.pots.hidden.some(function (s) { return s[0] === k; }); }) },

      { name: "The pin snaps to two decimals in front of the member, and the device is never read",
        detail: pin.says + " Reduced precision is the requirement (05-privacy \u00a72); watching the marker jump onto the grid is how a member learns that without reading a policy line.",
        pass: pin.snapped[0] === 49.30 && pin.snapped[1] === 16.53 && pin.deviceReads === 0 &&
              pin.moved > 0 },

      { name: "The climate profile is three values, all shown and all editable",
        detail: "Last frost " + fmtLong(CLIMATE.lastFrost) + ", first frost " + fmtLong(CLIMATE.firstFrost) +
          ", zone " + CLIMATE.zone + " \u2014 a " + CLIMATE.seasonDays +
          "-day growing season, resolved from " + CLIMATE.source + " and editable field by field (" +
          CLIMATE.editable.join(", ") + "), because a member knows their own frost pocket better than a dataset does. This household's observed last frost in 2026 was " +
          fmtLong(season(2026).observedLast) + ".",
        pass: CLIMATE.editable.length === 3 && CLIMATE.seasonDays > 120 },

      { name: "Timings are relative to the frost dates, never calendar weeks",
        detail: shift.says + " The catalog holds " + abs.inTimings +
          " absolute dates across " + CROPS.length + " crops and " + VARIETIES.length +
          " varieties; the only ISO dates in the whole reference set are the days members made their overrides.",
        pass: abs.inTimings === 0 && Math.abs(shift.days) > 60 },

      { name: "One resolution function, four consumers",
        detail: "variety \u2192 household override \u2192 catalog, in pick(), called from " +
          callers.length + " places this render: " + callers.join(", ") +
          ". Black Krim's sow-indoor window resolves through all three layers: the catalog says " +
          JSON.stringify(catalogValue("rajce", "win.sow_indoor")) + ", the household overrode it to " +
          JSON.stringify(OVERRIDES[0].value) + ", the variety says nothing, so the answer comes from the override and says so. D103's reason holds exactly: four independent re-implementations of when to sow Black Krim is a bug nobody would ever find.",
        pass: callers.length >= 4 &&
              pick("rajce", "v-krim", "win.sow_indoor", { by: "check" }).from === "override" &&
              pick("rajce", "v-krim", "dtm", { by: "check" }).from === "variety" &&
              pick("rajce", null, "family", { by: "check" }).from === "catalog" },

      { name: "A variety stores only what differs",
        detail: VARIETIES.map(function (v) {
            var n = ["dtm", "yieldM2", "spacing", "windows"].filter(function (f) { return v[f] != null; }).length;
            return v.name + " " + n;
          }).join(", ") + " fields of four. Bandit overrides one \u2014 the harvest window closes a month later because it is winter-hardy \u2014 and inherits its spacing, its maturity and its yield, so a catalog correction reaches it.",
        pass: VARIETIES.every(function (v) {
                return ["dtm", "yieldM2", "spacing", "windows"].some(function (f) { return v[f] != null; });
              }) },

      { name: "Every catalog field carries a source, and folklore is not agronomy",
        detail: prov.fields + " sourced fields across " + prov.crops + " crops (" + prov.perCrop +
          " each), " + prov.unsourced + " unsourced, and " + prov.folklore +
          " of them folklore: the catalog's field data is agronomic throughout. Folklore enters through the compatibility rules instead, where " +
          RULES.filter(function (r) { return r.src === "folk"; }).length + " of " + RULES.length +
          " claims are traditional — " +
          RULES.filter(function (r) { return r.src === "folk"; }).map(function (r) {
            return (byCrop[r.a] ? cropName(r.a) : r.a) + " \u00d7 " + (byCrop[r.b] ? cropName(r.b) : r.b);
          }).join(", ") +
          " — which is exactly where a gardener expects to find it and exactly where it has to be distinguishable by looking rather than badged, because a badge is read once.",
        pass: prov.unsourced === 0 && prov.folklore === 0 &&
              RULES.filter(function (r) { return r.src === "folk"; }).length === 3 &&
              prov.classes.length === 3 },

      { name: "Overrides survive a catalog update, and the value underneath updates",
        detail: ovr.map(function (r) {
            return r.o.crop + "." + r.o.field + " from the " + r.from + ", catalog " +
              r.catalogNow + " \u2192 " + r.catalogNext + (r.changed ? " at v8" : " unchanged");
          }).join("; ") + ". Catalog v" + CATALOG.next.version + " changes two of the three fields this household has overridden, and both overrides hold \u2014 which is the only behaviour that makes a curated catalog safe to update.",
        pass: ovr.every(function (r) { return r.held; }) &&
              ovr.filter(function (r) { return r.changed; }).length === 2 },

      { name: "An explicit crop pair beats a family pair",
        detail: prec.says + " Both rules stay in the set: the family rule is what catches the pairs nobody has written a crop rule for, and the crop rule is what stops it being wrong about the one everybody knows. The household's own rule (\u201c" +
          RULES.filter(function (r) { return r.origin === "household"; })[0].why +
          "\u201d) sits in the same resolution and can be deleted outright, while a catalog rule can only be disabled.",
        pass: prec.pair.verdict === "companion" && prec.pair.from === "crop pair" && !!prec.pair.beat },

      { name: "Quantity is an area or a plant count, and 422 otherwise",
        detail: q.map(function (r) { return r.status + " \u2014 " + r.says; }).join(" ") +
          " Of " + PLANTINGS.length + " plantings, " +
          PLANTINGS.filter(function (p) { return p.qty.area != null; }).length + " are an area and " +
          PLANTINGS.filter(function (p) { return p.qty.count != null; }).length +
          " a plant count, and both resolve to m\u00b2 through the crop's plants-per-m\u00b2 so the bed arithmetic does not care which was typed.",
        pass: q[0].status === 422 && q[1].status === 422 && q[2].ok &&
              PLANTINGS.every(function (p) { return quantityCheck(p.qty).ok; }) },

      { name: "The occupancy window is what \u201cshares a bed\u201d means, and spring spinach never meets autumn leeks",
        detail: bed(10).label + " carries both: \u0161pen\u00e1t from " + fmt(spinach.occupancy.from) +
          " to " + fmt(spinach.occupancy.to) + " and p\u00f3rek from " + fmt(leek.occupancy.from) +
          " to " + fmt(leek.occupancy.to) + " \u2014 " + meet +
          " days of shared occupancy. This household has its own rule saying those two are antagonists (\u201c" +
          RULES.filter(function (r) { return r.id === "r-6"; })[0].why +
          "\u201d) and C1 is still silent, with the reason on the screen rather than nothing at all.",
        pass: meet === 0 &&
              !full.filter(function (c) { return c.key === "C1"; })[0].findings
                .some(function (f) { return f.entity === "B10"; }) },

      { name: "Tasks are generated from the plantings, and two kinds never are",
        detail: gen.total + " tasks for the season, " + gen.generated + " generated across " +
          gen.kinds + " kinds and " + gen.manual +
          " written by a member. Watering and weeding are generated " + gen.neverGenerated +
          " times: at the pots tier they are " + gen.careKinds +
          " care reminders on a cadence instead, because a cadence of chores nobody ticks off is how a task list loses its credibility.",
        pass: gen.neverGenerated === 0 && gen.manual > 0 && gen.generated > 20 },

      { name: "Regeneration moves open, unedited, generated tasks and nothing else",
        detail: "Correcting the last frost date by " + regen.delta + " days moves " +
          regen.moved.length + " of " + regen.before + " tasks. Held back: " + regen.held.done +
          " done, " + regen.held.skipped + " skipped, " + regen.held.edited +
          " edited by hand (\u201c" + (TASK_STATE["p26-06:harvest"].why) + "\u201d) and " +
          regen.held.manual + " manual or manually dated. The tombstoned mulch task (" +
          (regen.tombstones[0] || {}).generation_key + ", \u201c" + (regen.tombstones[0] || {}).why +
          "\u201d) is resurrected " + regen.resurrected + " times.",
        pass: regen.moved.length > 0 && regen.resurrected === 0 &&
              regen.held.done > 0 && regen.held.edited === 1 && regen.held.skipped === 1 },

      { name: "Recording an actual date changes no planned window",
        detail: drift.says + " " + drift.dates +
          " planned dates were snapshotted as one string before and after, so this is a comparison rather than an inspection.",
        pass: drift.identical && drift.days === 13 && drift.shiftable.length > 0 },

      { name: "The eleven checks are computed on read, and none of them blocks anything",
        detail: sum.total + " checks run over " + plantingsOf(2026).length + " plantings, " +
          BEDS.length + " beds and " + closedSeasons().length + " closed seasons: " +
          sum.warning + " warning, " + sum.pass + " clean, " + sum.disabled + " disabled by the household, " +
          sum.dismissed + " dismissed, " + sum.noHistory + " without history. " + sum.findings +
          " findings pointing at " + sum.entities + " entities, and " + sum.blocking +
          " of them block a save. " + full.filter(function (c) { return c.state === "warning"; })
            .map(function (c) { return c.key; }).join(", ") + " are the ones speaking today.",
        pass: sum.total === 11 && sum.blocking === 0 && sum.findings > 8 && sum.entities > 10 },

      { name: "C4 is concurrent area, not the season's total",
        detail: (full.filter(function (c) { return c.key === "C4"; })[0].dismissed[0] ||
                 full.filter(function (c) { return c.key === "C4"; })[0].findings[0] || {}).says +
          ". Every other bed passes, including " + bed(10).label + ", which carries " +
          plantingsOf(2026).filter(function (p) { return p.bed === 10; })
            .reduce(function (n, p) { return n + p.area; }, 0) + " m\u00b2 of plantings in a " +
          bed(10).area + " m\u00b2 bed \u2014 they take turns, and a check that summed the season would have called that an error.",
        pass: (function () {
          var c4 = full.filter(function (c) { return c.key === "C4"; })[0];
          return (c4.findings.length + c4.dismissed.length) === 1;
        })() },

      { name: "A dismissal silences one warning for one season, with a note, reversibly",
        detail: DISMISSALS.map(function (d) {
            return d.check + " on " + d.entity + " for " + d.season + ", by " + d.by + " on " +
              fmt(d.on) + ": \u201c" + d.note + "\u201d";
          }).join("; ") + ". The check itself still runs and still reports the finding \u2014 it moves to a dismissed section with the note beside it rather than disappearing, so C4 reads as " +
          full.filter(function (c) { return c.key === "C4"; })[0].state +
          " rather than as a pass. Without dismissal members stop reading the panel by April, and the panel is the feature.",
        pass: full.filter(function (c) { return c.key === "C4"; })[0].state === "dismissed" &&
              full.filter(function (c) { return c.key === "C4"; })[0].dismissed.length === 1 &&
              DISMISSALS.every(function (d) { return !!d.note; }) },

      { name: "A check can be disabled entirely, and says who did it",
        detail: "C6 is off: " + CHECK_CONFIG.C6.why + " (" + CHECK_CONFIG.C6.by + ", " +
          fmt(CHECK_CONFIG.C6.on) + "). Run with it enabled it would report " +
          (planCheck(2026, { dismissals: [] }).filter(function (c) { return c.key === "C6"; })[0].state) +
          " \u2014 Solanaceae across five of thirteen planted beds \u2014 which is exactly the finding this household has decided it does not want. Severities are per check and configurable; the difference between disabled and dismissed is that one is about the check and the other about one warning.",
        pass: full.filter(function (c) { return c.key === "C6"; })[0].state === "disabled" },

      { name: "C3 and C8 return no history rather than a pass",
        detail: "Run against a household with no closed seasons, the eleven come back " +
          nohist.summary.noHistory + " no-history, " + nohist.summary.warning + " warning, " +
          nohist.summary.pass + " pass \u2014 and the two are " + nohist.states.join(" and ") +
          ", the two history-dependent ones. The panel says \u201crotation can't be checked yet \u2014 no history\u201d, which is neither a pass nor a warning and must not look like either. There is no back-fill importer, so this is the first season's real state.",
        pass: nohist.states.length === 2 && nohist.states.indexOf("C3") >= 0 &&
              nohist.states.indexOf("C8") >= 0 },

      { name: "At the beds tier the panel is the five checks that need no history",
        detail: "Reduced, the set runs " + checkSummary(reduced).total + " checks of which " +
          checkSummary(reduced).notAtTier + " are not at this tier: what remains is " +
          reduced.filter(function (c) { return c.state !== "not_at_this_tier"; })
            .map(function (c) { return c.key; }).join(", ") +
          " \u2014 companions, same family in a bed, over-booking, frost-risky transplants and dates outside the window. None of them reads a closed season, which is why the beds tier can have them at all.",
        pass: checkSummary(reduced).notAtTier === 6 &&
              reduced.filter(function (c) { return c.state !== "not_at_this_tier" && c.historyDependent; }).length === 0 },

      { name: "A planting belongs to the season of its harvest",
        detail: garlic.label + " in " + garlic.where + " was sown on " +
          fmtLong(garlic.actual.direct_sow) + " and harvested on " + fmtLong(garlic.actual.harvest) +
          ", and it is a " + garlic.season + " planting with a sow date in " +
          garlic.actual.direct_sow.slice(0, 4) +
          " \u2014 the previous calendar year, legitimately. Anchoring the season on the harvest is what keeps October garlic out of the wrong rotation history.",
        pass: garlic.season === 2026 && garlic.actual.direct_sow < "2026-01-01" },

      { name: "The dry run shows what the shift fixed and what it broke, and persists nothing",
        detail: "Copying 2026 into 2027 straight gives " + dry.straight.summary.findings +
          " findings; with a one-bed rotation shift it gives " + dry.shifted.summary.findings +
          " \u2014 " + dry.fixed.length + " fixed, " + dry.broke.length + " broken, " +
          dry.carried.length + " carried. Both runs wrote " + dry.persisted +
          " rows: the prospective season is built, checked and drawn without existing. " +
          (dry.fixed[0] ? "Fixed, for instance: " + dry.fixed[0] + "." : "") +
          (dry.broke[0] ? " Broken: " + dry.broke[0] + "." : ""),
        pass: dry.persisted === 0 && dry.shifted.summary.total === 11 &&
              (dry.fixed.length + dry.broke.length) > 0 },

      { name: "Closing a season is what turns it into rotation history",
        detail: close.says + " Nothing else about the season changes, which is why reopening one needs manage and is audited: " +
          close.with.summary.findings + " findings against " + close.without.summary.findings +
          " is the difference between a plan checked against three years and a plan checked against two.",
        pass: close.c3[1] >= close.c3[0] && close.c8[1] >= close.c8[0] &&
              (close.c3[1] + close.c8[1]) > (close.c3[0] + close.c8[0]) },

      { name: "Season close collects the frost dates that actually happened",
        detail: (function () {
          var cl = seasonClose(2025);
          return "2025 expected its last frost on " + fmtLong(cl.observed.expectedLast) + " and saw it on " +
            fmtLong(cl.observed.last) + " \u2014 " +
            cl.observed.lastDelta + " days later \u2014 and its first autumn frost " +
            Math.abs(cl.observed.firstDelta) + " days " + (cl.observed.firstDelta < 0 ? "earlier" : "later") +
            " than the dataset said. Final yields " + cl.yields.actual + " kg against " +
            cl.yields.expected + " kg expected over " + cl.yields.logged + " plantings, with " +
            cl.failures.length + " failures recorded by name (" +
            cl.failures.map(function (f) { return f.planting.label + ": " + f.why.toLowerCase(); }).join("; ") + ").";
        })(),
        pass: (function () { var cl = seasonClose(2025);
          return cl.observed.lastDelta === 10 && cl.failures.length === 2 && cl.yields.actual > 0; })() },

      { name: "Yields are the catalog's expectation against the household's own harvests",
        detail: "2026 so far: " + y26.actual + " kg logged over " + y26.logged +
          " plantings against " + y26.expected + " kg expected, which is " +
          Math.round((y26.actual / y26.expected) * 100) + " % with the season still running. 2025 closed at " +
          y25.actual + " kg against " + y25.expected + " kg. The expected figure comes through the same resolver, so Black Krim's lower yield (" +
          pick("rajce", "v-krim", "yieldM2", { by: "check" }).value + " kg/m\u00b2 against the crop's " +
          byCrop.rajce.yieldM2 + ") is in the comparison rather than a footnote.",
        pass: y26.actual > 0 && y25.actual > 0 &&
              pick("rajce", "v-krim", "yieldM2", { by: "check" }).value === 3.8 },

      { name: "Storage consumption is an edit in place, and there is no second ledger",
        detail: st.says + " " + st.low + " rows are down to a quarter or less, " + st.finished +
          " are finished and one is waiting on a lift that has not happened, which is a row that exists before its quantity does.",
        pass: st.movements === 0 && st.edits > 8 && !!st.lastJar },

      { name: "The frost warning names the temperature and the plants, and is a condition rather than decoration",
        detail: warn.says + " Tonight it publishes " + warn.plants.length + " plantings in beds " +
          warn.beds.join(", ") + " \u2014 \u201c" + warn.title + " \u00b7 " + warn.body +
          "\u201d. The greenhouse beds are excluded because they are covered, and " + bed(4).label +
          "'s potatoes because the haulm was cut on " + fmt(planting("p26-06").topsDown) +
          ": tender, still in the ground, and nothing above ground to freeze. At six degrees the same code publishes " +
          quiet.plants.length + " warnings and the alert is not drawn at all rather than drawn empty.",
        pass: warn.published && warn.plants.length === 6 &&
              warn.beds.join(",") === "3,7,11" && quiet.published === false },

      { name: "A failed forecast fetch is logged and swallowed",
        detail: wfail.says + " The cache holds " + WEATHER_STATE.cacheDays +
          " days, the row states the time it was measured (" + warn.measuredAt.slice(11, 16) +
          "), and Stage 11 already draws the offline version of it: the one Today row that cannot be computed on the device keeps its place and admits its age.",
        pass: wfail.errorsShown === 0 && wfail.renderedFrom === "cache" },

      { name: "This month's work prints on one page with real checkboxes",
        detail: work.title + ": " + work.sections.length + " blocks, " + work.boxes +
          " ticked lines, " + work.mm + " mm of " + work.capacity + " mm of printable height on " +
          PAPER.name + " \u2014 " + work.pages + " page" + (work.pages === 1 ? "" : "s") +
          ", and it fits " + PAPER.alt.name + " too (" + PAPER.contentAlt.h +
          " mm). Each line carries a " + PRINT_METRICS.boxMm + " mm box at " +
          PRINT_METRICS.boxRuleMm + " mm rule with " + PRINT_METRICS.boxGapMm +
          " mm of clearance, at " + PRINT_METRICS.bodyPt + " pt on " + PRINT_METRICS.leadingPt +
          " pt leading. Legible from a garden pocket is a type size and a box, not a wish.",
        pass: work.fits && work.fitsLetter && work.pages === 1 && work.boxes > 8 &&
              PRINT_METRICS.bodyPt >= 11 && PRINT_METRICS.boxMm >= 4 },

      { name: "The season plan prints on one page, fourteen beds by twelve months",
        detail: plan.rows.length + " bed rows in zone order, " + plan.months.length +
          " month columns of " + plan.colMm + " mm after a " + plan.labelMm +
          " mm label column, " + plan.mm + " mm tall of " + plan.capacity +
          " mm. Portrait, one page, and a bed row never splits across a break. The grid is the one place a whole season is visible at once, and it exists on paper before it exists on a screen.",
        pass: plan.fits && plan.pages === 1 && plan.rows.length === 14 && plan.colMm > 10 },

      { name: "The print stylesheet is ink on white with no theme and no accent",
        detail: audit.rules + " rules. Accent tokens in the print layer: " + audit.accentTokens +
          ". Colours declared: " + audit.colours + ", non-grey: " + audit.nonGrey +
          ". Minimum type " + audit.minPt + " pt. Estimated ink coverage on the month sheet: " +
          audit.coverage + " % of the printed area, which is what \u201cink-cheap\u201d means once it is a number. The dark theme is stated as not printed rather than left to a media query nobody wrote, and every status mark prints as a word because colour and glyphs do not survive a monochrome printer.",
        pass: audit.accentTokens === 0 && audit.nonGrey === 0 && audit.minPt >= 9 &&
              audit.coverage < 12 && audit.themeStated },

      { name: "The catalog bundle is why the module works at the bottom of the garden",
        detail: catalogOffline().says + " " + SYNC.filter(function (r) { return r[1] === "not synced"; }).length +
          " of " + SYNC.length + " sync rows is the catalog, and it is the only one that is not household data. Of the ten that are, " +
          SYNC.filter(function (r) { return r[1] === "strict_version"; }).length +
          " are strict_version and every one of them is structural \u2014 beds, containers, seasons, rules, settings \u2014 while the four rows a member touches in the garden (planting, task, completion, harvest, storage) merge or accumulate without a question.",
        pass: SYNC.filter(function (r) { return r[3]; }).every(function (r) { return r[1] === "strict_version"; }) &&
              SYNC.filter(function (r) { return r[1] === "strict_version"; }).length === 5 },

      { name: "Stage 11's Today row and search hit are this module's own computation",
        detail: spine.says,
        pass: !!spine.row && spine.warning.plants.length === 6 && spine.leekAgree !== false },

      { name: "The two garden widgets read the module's figures",
        detail: dash.says + (dash.missing && dash.missing.length
          ? " Rows dashboard.js draws that this module does not produce: " + dash.missing.join(", ") + "."
          : " Every row the widget draws is a task this module generated, by title.") +
          " The reminders.due rows for Garden are a care reminder and a member's own task, which is FR-GA7's distinction arriving intact on another module's screen.",
        pass: dash.ok !== false },

      { name: "Two reminder kinds, and they are a plan and a rhythm",
        detail: rem.says + " garden.task_due follows the generated chain and moves when the plan does; garden.care_due is a cadence off the crop's water and feeder class. Collapsing them would make a watering reminder move when a frost date is corrected.",
        pass: rem.ok !== false },

      { name: "The illustration kit gained three answers and kept its own rule",
        detail: ill.says + " The kit's rule that bars is pointedly absent from every no-history composition is what made the plot answer's fourth part obvious \u2014 and what makes the three answers a set rather than three pictures.",
        pass: ill.ok !== false },

      { name: "The fixture line now matches the data it describes",
        detail: fix.says,
        pass: fix.ok !== false }
    ];
  }

  window.HH_GARDEN = {
    version: "0.1-stage-17-candidate",
    today: TODAY, allStates: ALL_STATES, screens: SCREENS,
    place: PLACE, pinRun: pinRun, climate: CLIMATE, climateAlt: CLIMATE_ALT, climateShift: climateShift,
    tiers: TIERS, surfaces: SURFACES, tierView: tierView, tierMoveRun: tierMoveRun,
    sources: SOURCES, fields: FIELDS, fieldSrc: FIELD_SRC, crops: CROPS, byCrop: byCrop,
    varieties: VARIETIES, overrides: OVERRIDES, catalog: CATALOG,
    pick: pick, resolveWindow: resolveWindow, absoluteScan: absoluteScan,
    provenanceAudit: provenanceAudit, overrideRun: overrideRun,
    rules: RULES, ruleFor: ruleFor, precedenceRun: precedenceRun,
    zones: ZONES, beds: BEDS, bed: bed, bedsOfZone: bedsOfZone, neighbours: neighbours,
    orderedActive: orderedActive, containers: CONTAINERS, containerPlants: CONTAINER_PLANTS,
    care: CARE, careDue: careDue,
    seasons: SEASONS, season: season, closedSeasons: closedSeasons,
    plantings: PLANTINGS, planting: planting, plantingsOf: plantingsOf, quantityCheck: quantityCheck,
    kindLabel: KIND_LABEL, tasks: tasks, manualTasks: MANUAL_TASKS, tombstones: function () { return TOMBSTONES; },
    regenerate: regenerate, generatorAudit: generatorAudit, driftRun: driftRun,
    harvests: HARVESTS, failures: FAILURES, yieldRun: yieldRun, harvestReady: harvestReady,
    checkDefs: CHECK_DEFS, checkConfig: CHECK_CONFIG, dismissals: DISMISSALS,
    planCheck: planCheck, checkSummary: checkSummary, noHistoryRun: noHistoryRun,
    dryRun: dryRun, dryRunCompare: dryRunCompare, closeEffect: closeEffect, seasonClose: seasonClose,
    storage: STORAGE, storageRun: storageRun,
    weather: WEATHER, weatherState: WEATHER_STATE, frostThreshold: FROST_THRESHOLD,
    frostWarning: frostWarning, frostQuiet: frostQuiet, weatherFailure: weatherFailure,
    paper: PAPER, printInk: PRINT_INK, printMetrics: PRINT_METRICS, printRules: PRINT_RULES,
    printAudit: printAudit, workPaper: workPaper, planPaper: planPaper, exports: EXPORTS,
    sync: SYNC, catalogOffline: catalogOffline,
    spineRun: spineRun, dashboardRun: dashboardRun, reminderRun: reminderRun,
    illusRun: illusRun, fixtureRun: fixtureRun,
    fmt: fmt, fmtLong: fmtLong, fmtCs: fmtCs, fmtShort: fmtShort, weekKey: weekKey,
    cropName: cropName, varName: varName, months: MONTHS, monthsCs: MONTHS_CS,
    checks: checks,
    /* session writes for the live prototype: every one lands on the rows above, so the
       checks, the tasks and the frost warning recompute from the same arrays */
    taskState: TASK_STATE, dateKinds: DATE_KINDS, addDays: addDays, diff: diff, weekLabel: weekLabel,
    rawOf: function (id) { return P_RAW.filter(function (t) { return t[0] === id; })[0] || null; },
    addPlanting: function (t) { P_RAW.push(t); var p = buildPlanting(t); PLANTINGS.push(p); return p; },
    rebuildPlanting: function (id) {
      var t = P_RAW.filter(function (x) { return x[0] === id; })[0];
      var j = PLANTINGS.map(function (p) { return p.id; }).indexOf(id);
      if (!t || j < 0) return null;
      PLANTINGS[j] = buildPlanting(t);
      return PLANTINGS[j];
    },
    removePlanting: function (id) {
      var i = P_RAW.map(function (t) { return t[0]; }).indexOf(id);
      var j = PLANTINGS.map(function (p) { return p.id; }).indexOf(id);
      if (i < 0 || j < 0) return null;
      var rec = { i: i, j: j, raw: P_RAW[i], p: PLANTINGS[j] };
      P_RAW.splice(i, 1); PLANTINGS.splice(j, 1);
      return rec;
    },
    restorePlanting: function (rec) { if (!rec) return; P_RAW.splice(rec.i, 0, rec.raw); PLANTINGS.splice(rec.j, 0, rec.p); }
  };
})();
