/* Stage 9 — Shopping end to end, as data.
   Source: docs/prd/modules/05-shopping.md (FR-SH1-9, the sync table, the two-trolley
   acceptance criterion), docs/design/05-screens.md §B, 03-patterns.md §1 (merge policies,
   offline write cases, undo), §5 (offers are never automatic), 07-delivery.md §3
   (the empty state teaches: one sentence, one example, one action) and DS-1.

   Three things this file exists to compute rather than claim.

   One: the quick-add. FR-SH3 is a requirement, not a UI choice, so the splitter and the
   quantity parser live here as a function with a test table beside them. The list screen
   runs the same function the gate does.

   Two: the two-trolley case. The op log from the acceptance criterion is data, the merge
   is a function that applies each policy, and both receive orders are computed — so "no
   conflict dialog shown to anyone" and "both devices identical" are results, not copy.

   Three: the Finance offer. FR-SH8 offers, never forces, and only where the member holds
   contribute on Finance. That is read from the fixture's grants, so the offer cannot be
   drawn for somebody who has no Finance — and leaves no trace on their trip summary.
*/
(function () {

  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending",
                    "syncing", "conflicted", "rejected", "absent", "withdrawn", "readonly"];

  /* ── categories ─────────────────────────────────────────────────────────
     Household-level, seeded from a translated reference catalog (FR-SH6).

     Stage 23 enumerates it. Fourteen categories, each with the word printed on the
     aisle sign in the three languages the chrome ships in, and a keyword list per
     language — a Czech household types rohlíky, not rolls, and the guess has to
     work in the language the member is standing in. Fourteen rather than eight
     because the eight that drew the walking order collapsed six aisles every
     European shop has — the counter, drogerie, alcohol, snacks, baby, pet food —
     into “household”, and a walking order that sends you back across the shop is
     the thing this feature exists to prevent. */

  var CATEGORIES = [
    ["produce", "Fruit and vegetables"],
    ["bakery", "Bread"],
    ["dairy", "Dairy and eggs"],
    ["meat", "Meat and fish"],
    ["deli", "The counter"],
    ["frozen", "Frozen"],
    ["ambient", "Tins, jars and dry goods"],
    ["snacks", "Snacks and sweets"],
    ["drinks", "Drinks"],
    ["alcohol", "Beer, wine and spirits"],
    ["household", "Household and cleaning"],
    ["drugstore", "Drugstore"],
    ["baby", "Baby"],
    ["pet", "Pet food"]
  ];

  /* The translated half: key → the aisle word in cs and de. The remaining
     languages are the same shape and a translator's job rather than a designer's. */
  var CATALOG = {
    produce:   { cs: "Ovoce a zelenina", de: "Obst und Gemüse" },
    bakery:    { cs: "Pečivo", de: "Backwaren" },
    dairy:     { cs: "Mléčné a vejce", de: "Milchprodukte und Eier" },
    meat:      { cs: "Maso a ryby", de: "Fleisch und Fisch" },
    deli:      { cs: "Lahůdky", de: "Frischetheke" },
    frozen:    { cs: "Mražené", de: "Tiefkühl" },
    ambient:   { cs: "Trvanlivé potraviny", de: "Konserven und Trockenwaren" },
    snacks:    { cs: "Sladké a slané", de: "Snacks und Süßes" },
    drinks:    { cs: "Nápoje", de: "Getränke" },
    alcohol:   { cs: "Alkohol", de: "Alkohol" },
    household: { cs: "Domácnost a úklid", de: "Haushalt und Reinigung" },
    drugstore: { cs: "Drogerie", de: "Drogerie" },
    baby:      { cs: "Dětské", de: "Baby" },
    pet:       { cs: "Pro zvířata", de: "Tiernahrung" }
  };

  var CAT_NAME = {};
  CATEGORIES.forEach(function (c) { CAT_NAME[c[0]] = c[1]; });

  /* The catalog order the household starts with, and the walking order it has
     since set for one list. The difference is the whole feature: frozen sits by
     the tills in this shop, so it moves last but one. */
  var CATALOG_ORDER = ["produce", "bakery", "dairy", "deli", "meat", "ambient", "snacks", "frozen",
                       "drinks", "alcohol", "household", "drugstore", "baby", "pet"];
  var STORE_ORDER = ["produce", "bakery", "deli", "dairy", "meat", "ambient", "snacks", "drinks",
                     "alcohol", "frozen", "household", "drugstore", "baby", "pet"];

  /* ── FR-SH7, the numbers the requirement leaves as “repeatedly” ───────────
     A staple is learned from this household's own nine weeks and nothing else.
     Three numbers make that sentence testable, and they are the three the
     requirement is missing. The cadence set is the lead-time set's shape: a short
     list of ordinary answers plus a custom number of days, so “every ten days” is
     possible without the control implying anybody needs it. */
  var STAPLE_RULE = {
    window: 9,        /* weeks of history considered — one season of a shop */
    minClears: 4,     /* cleared at least four times in the window before it is offered */
    minShare: 0.44,   /* and in at least this share of the weeks, so a fortnightly buy qualifies */
    offered: 5,       /* suggestions shown at once; the sixth is a list, not a suggestion */
    says: "Cleared four times in nine weeks and in at least four of them. Five offered at once."
  };
  var CADENCES = [
    ["3d", 3, "Every three days"], ["1w", 7, "Weekly"], ["2w", 14, "Every two weeks"],
    ["1m", 30, "Monthly"], ["2m", 61, "Every two months"], ["3m", 91, "Every three months"],
    ["custom", null, "Every … days"]
  ];

  /* keyword → category, the opportunistic half of FR-SH2, in all three languages */
  var GUESS = [
    ["produce", ["potato", "potatoes", "apple", "apples", "carrot", "carrots", "onion", "lemon", "salad", "banana",
                 "brambory", "jablka", "mrkev", "cibule", "citron", "salát", "banány", "rajčata", "okurka", "pórek",
                 "kartoffeln", "äpfel", "möhren", "zwiebel", "salat"]],
    ["bakery", ["bread", "roll", "rolls", "rohlík", "rohlíky", "rohlíků", "baguette", "buns", "chleba", "chléb", "houska",
                "brot", "brötchen"]],
    ["dairy", ["milk", "cheese", "yoghurt", "yogurt", "butter", "cream", "eggs", "egg",
               "mléko", "sýr", "jogurt", "máslo", "smetana", "vejce", "tvaroh",
               "milch", "käse", "joghurt", "eier", "sahne"]],
    ["meat", ["chicken", "mince", "ham", "salmon", "sausage", "kuře", "mleté", "šunka", "losos", "klobása",
              "hähnchen", "hackfleisch", "schinken", "lachs"]],
    ["deli", ["deli", "counter", "lahůdky", "salám", "aufschnitt", "theke"]],
    ["frozen", ["frozen", "peas", "ice cream", "mražené", "hrášek", "zmrzlina", "tiefkühl"]],
    ["ambient", ["coffee", "rice", "pasta", "flour", "sugar", "tin", "beans", "oil",
                 "káva", "rýže", "těstoviny", "mouka", "cukr", "konzerva", "fazole", "olej",
                 "kaffee", "reis", "nudeln", "mehl", "zucker"]],
    ["snacks", ["crisps", "chips", "chocolate", "biscuits", "brambůrky", "čokoláda", "sušenky", "bonbóny",
                "schokolade", "kekse"]],
    ["drinks", ["water", "juice", "tonic", "voda", "džus", "minerálka", "limonáda", "wasser", "saft"]],
    ["alcohol", ["beer", "wine", "pivo", "víno", "rum", "bier", "wein"]],
    ["household", ["washing-up", "washing up", "toilet paper", "soap", "bin bags", "sponge", "bleach",
                   "jar", "toaletní papír", "mýdlo", "houbička", "savo",
                   "spülmittel", "toilettenpapier", "müllbeutel"]],
    ["drugstore", ["shampoo", "toothpaste", "deodorant", "šampon", "zubní pasta", "zahnpasta"]],
    ["baby", ["nappies", "wipes", "pleny", "ubrousky", "windeln"]],
    ["pet", ["cat food", "dog food", "granule", "kapsičky", "stelivo", "katzenfutter", "hundefutter"]]
  ];

  function guessCategory(text) {
    var t = text.toLowerCase(), hit = null;
    GUESS.forEach(function (g) {
      g[1].forEach(function (w) { if (!hit && t.indexOf(w) >= 0) hit = g[0]; });
    });
    return hit;
  }

  /* ── FR-SH3, the quick add ───────────────────────────────────────────────
     One field, always focused, submit-and-stay. Comma and newline split, with
     quantity parsing per line, and parsing never blocks the add.

     Two guards, both there because of an example in the module spec itself:
       · a comma directly followed by a digit is a decimal comma, not a
         separator — cs-CZ writes 1,5 l and the household counts in CZK;
       · a number followed by % is not a quantity — "2 % milk" is a name. */

  var UNITS = ["kg", "g", "l", "ml", "ks", "pcs", "x", "×"];

  function parseLine(raw) {
    var text = raw.replace(/\s+/g, " ").trim();
    if (!text) return null;
    var qty = null, unit = null;
    var m = text.match(/^(\d+(?:[.,]\d+)?)\s*([^\s\d]*)\s*(.*)$/);
    if (m) {
      var num = parseFloat(m[1].replace(",", "."));
      var word = m[2] || "";
      var tail = word.toLowerCase();
      var rest = (m[3] || "").trim();
      var isUnit = UNITS.indexOf(tail) >= 0;
      if (tail === "%") {
        /* a name, not a quantity: leave the line whole */
      } else if (isUnit && rest) {
        qty = num; unit = (tail === "x" || tail === "×") ? null : tail; text = rest;
      } else if (isUnit && !rest) {
        /* "2 kg" on its own names nothing. Leave it whole rather than inventing an item. */
      } else {
        var remainder = (word + (rest ? " " + rest : "")).trim();
        if (remainder) { qty = num; text = remainder; }
      }
    }
    return { text: text, quantity: qty, unit: unit, category: guessCategory(text) };
  }

  function parse(input) {
    if (!input) return [];
    return String(input)
      .split(/\n|,(?!\d)/)
      .map(parseLine)
      .filter(function (x) { return !!x; });
  }

  /* the test table the gate reads, and the list screen shows */
  var PARSE_TESTS = [
    { input: "milk, bread, 2 kg potatoes", count: 3, expect: "three items; potatoes carries 2 kg",
      check: function (r) { return r.length === 3 && r[2].quantity === 2 && r[2].unit === "kg" && r[2].text === "potatoes"; },
      note: "FR-SH3's own example, and the reason the field is one field." },
    { input: "2 × bread", count: 1, expect: "one item, quantity 2, no unit",
      check: function (r) { return r.length === 1 && r[0].quantity === 2 && !r[0].unit && r[0].text === "bread"; },
      note: "A multiplier is a quantity without a unit. It is not two items." },
    { input: "1,5 l mléka", count: 1, expect: "one item, 1.5 l — the decimal comma is not a separator",
      check: function (r) { return r.length === 1 && r[0].quantity === 1.5 && r[0].unit === "l"; },
      note: "The household counts in CZK and writes 1,5. A naive comma split makes two items out of a bottle of milk." },
    { input: "2 % milk, the big carton", count: 2, expect: "no quantity read; still two items",
      check: function (r) { return r.length === 2 && r[0].quantity === null && r[0].text === "2 % milk"; },
      note: "Half solved. The percentage guard holds; the split still divides FR-SH2's own example item — see the open question." },
    { input: "eggs\n6 rohlíků", count: 2, expect: "newline splits too; 6 rohlíků carries 6",
      check: function (r) { return r.length === 2 && r[1].quantity === 6 && r[1].text === "rohlíků"; },
      note: "Paste from a message and it becomes a list." },
    { input: "   ", count: 0, expect: "nothing added, field stays focused",
      check: function (r) { return r.length === 0; },
      note: "Submit-and-stay: an empty submit is not an error and does not close anything." }
  ];

  function parseChecks() {
    return PARSE_TESTS.map(function (t) {
      var r = parse(t.input);
      return { input: t.input, expect: t.expect, note: t.note, got: r,
               count: r.length, pass: r.length === t.count && t.check(r) };
    });
  }

  /* ── the item model: nine fields, one of them required (FR-SH2) ────────── */

  var ITEM_FIELDS = [
    ["text", "The line you typed", true, "Free-form. It is the item.", "milk"],
    ["quantity", "Quantity", false, "Parsed from the text when it is there, always editable.", "2"],
    ["unit", "Unit", false, "Never asked for. It arrives with the quantity or not at all.", "l"],
    ["category", "Category", false, "Guessed from a translated catalog, overridable, used for walking order.", "Dairy and eggs"],
    ["note", "Note", false, "For the thing that is not the name.", "the one in the glass bottle"],
    ["assigned_to", "Who picks it up", false, "A name beside a line, not an assignment workflow.", "Petr"],
    ["price_minor", "Price", false, "Entered at the shop by whoever cares. Feeds the trip total.", "39,90 Kč"],
    ["checked", "Ticked", false, "With who ticked it and when, because that is the question the module prevents.", "Petr, 17:40"],
    ["source_ref", "Came from", false, "Unused in 1.0. Present so Meals and Pantry arrive without a migration.", "—"]
  ];

  /* ── the lists (FR-SH1) ─────────────────────────────────────────────────── */

  var LISTS = [
    { id: "l-shop", name: "Shopping", store: "Lidl Vysočany", isDefault: true, layout: "store", open: 8, ticked: 3 },
    { id: "l-hard", name: "Hardware store", store: "", isDefault: false, layout: "catalog", open: 3, ticked: 0 },
    { id: "l-xmas", name: "Christmas", store: "", isDefault: false, layout: "catalog", open: 14, ticked: 6 },
    { id: "l-chata", name: "Chata — before we drive up", store: "", isDefault: false, layout: "catalog", open: 0, ticked: 0, archived: false }
  ];

  /* ── the default list's items ────────────────────────────────────────────
     [id, text, qty, unit, category, checkedBy, at, price, assigned, note] */

  var ITEMS = [
    { id: "i1", text: "milk", quantity: 2, unit: "l", category: "dairy", price: 39.8 },
    { id: "i2", text: "bread", quantity: 2, unit: null, category: "bakery" },
    { id: "i3", text: "potatoes", quantity: 2, unit: "kg", category: "produce" },
    { id: "i4", text: "yoghurt", quantity: null, unit: null, category: "dairy" },
    { id: "i5", text: "apples", quantity: 1, unit: "kg", category: "produce" },
    { id: "i6", text: "coffee", quantity: null, unit: null, category: "ambient", note: "the dark one, not the supermarket blend" },
    { id: "i7", text: "washing-up liquid", quantity: null, unit: null, category: "household" },
    { id: "i8", text: "frozen peas", quantity: null, unit: null, category: "frozen", assigned: "Adam" },
    { id: "i9", text: "carrots", quantity: null, unit: null, category: "produce", checked: true, by: "Petr", at: "17:40" },
    { id: "i10", text: "eggs", quantity: 6, unit: null, category: "dairy", checked: true, by: "Petr", at: "17:41", price: 62.9 },
    { id: "i11", text: "toilet paper", quantity: null, unit: null, category: "household", checked: true, by: "Jana", at: "17:44", price: 89.9 }
  ];

  /* ── FR-SH7 staples: a ranking over the household's own history ───────────
     Nine weeks, this household only. No cross-household data, no model, no
     inference service — the ranking is the arithmetic below and nothing else.
     [text, the week numbers it was added and cleared in] */

  var HISTORY = [
    ["milk", [1, 2, 3, 4, 5, 6, 7, 8, 9]],
    ["bread", [1, 2, 3, 4, 5, 6, 7, 9]],
    ["eggs", [1, 2, 4, 5, 6, 8, 9]],
    ["bananas", [2, 3, 5, 6, 8]],
    ["coffee", [1, 3, 5, 7, 9]],
    ["yoghurt", [4, 5, 6, 7, 8]],
    ["washing-up liquid", [2, 6]],
    ["toilet paper", [3, 7]],
    ["ice cream", [7]],
    ["birthday candles", [4]]
  ];

  var WEEKS = 9;

  function staples() {
    return HISTORY.map(function (h) {
      var weeks = h[1], n = weeks.length;
      var recent = weeks.filter(function (w) { return w > WEEKS - 4; }).length;
      /* how often, weighted toward the last four weeks. Nothing cleverer. */
      var score = n / WEEKS + recent / 4;
      return { text: h[0], times: n, recent: recent, score: score,
               line: n + " of " + WEEKS + " weeks" + (recent ? " \u00b7 " + recent + " of the last 4" : " \u00b7 not lately") };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  function suggested(n) { return staples().slice(0, n || 5); }

  var EXPLICIT = ["milk", "bread"];
  var RECURRING = [{ text: "coffee", cadence: "every 2 weeks", next: "reappears Monday 14 September" }];

  /* ── FR-SH8 the trip, and the offer ─────────────────────────────────────── */

  var TRIP = {
    date: "9 September", store: "Lidl Vysočany", items: 11, priced: 3,
    total: 742.3, currency: "K\u010d", by: "Jana",
    priceLines: [["milk \u00b7 2 l", 39.8], ["eggs \u00b7 6", 62.9], ["toilet paper", 89.9]],
    unpriced: 8
  };

  /* Finance is offered where the member holds contribute or manage on it, and
     nowhere else — computed from the fixture rather than authored per screen. */
  function financeOffer(memberId) {
    var F = window.HH_FIXTURES;
    if (!F) return { offered: false, reason: "fixture not loaded" };
    var m = F.members.filter(function (x) { return x.id === memberId; })[0];
    if (!m) return { offered: false, reason: "no such member" };
    var lv = m.grants.finance;
    var can = lv === "contribute" || lv === "manage";
    return { offered: can, level: lv, name: m.name,
             reason: can
               ? "Holds Finance, so the trip can be offered as an expense \u2014 offered, never recorded for them."
               : "No Finance at all. The trip summary carries no offer, no greyed button and no mention of the module." };
  }

  function offerCount() {
    var F = window.HH_FIXTURES;
    if (!F) return { yes: 0, total: 0 };
    var yes = F.members.filter(function (m) {
      return m.grants.finance === "contribute" || m.grants.finance === "manage";
    });
    return { yes: yes.length, total: F.members.length,
             names: yes.map(function (m) { return m.name; }) };
  }

  /* ── the two-trolley case, computed ──────────────────────────────────────
     The acceptance criterion's op log, as ops. Each op names its policy, so the
     merge below is the policy table applied rather than a story retold.
     [id, device, member, kind, target, value, clientTime, policy] */

  var BASE = ["milk", "bread", "yoghurt", "potatoes"];

  var OPS = [
    { id: "a1", device: "Jana \u00b7 phone", member: "Jana", kind: "create", target: "cheese", at: "17:31", policy: "lww_field",
      says: "Adds cheese. Her replica has it; Petr's has never heard of it." },
    { id: "a2", device: "Jana \u00b7 phone", member: "Jana", kind: "check", target: "milk", value: true, at: "17:33", policy: "state_set",
      says: "Ticks milk in the dairy aisle." },
    { id: "b1", device: "Petr \u00b7 phone", member: "Petr", kind: "check", target: "milk", value: true, at: "17:34", policy: "state_set",
      says: "Ticks milk too. Neither of them can see the other." },
    { id: "b2", device: "Petr \u00b7 phone", member: "Petr", kind: "check", target: "bread", value: true, at: "17:36", policy: "state_set",
      says: "Ticks bread." },
    { id: "b3", device: "Petr \u00b7 phone", member: "Petr", kind: "delete", target: "yoghurt", at: "17:37", policy: "lww_field",
      says: "Deletes yoghurt \u2014 a tombstone in a field, not a row removal." },
    { id: "a3", device: "Jana \u00b7 phone", member: "Jana", kind: "rename", target: "yoghurt", value: "greek yoghurt", at: "17:38", policy: "lww_field",
      says: "Renames the same yoghurt, at the same time, on the other side of the shop." }
  ];

  /* apply the log in the order the server received it */
  function merge(order) {
    var items = {};
    BASE.forEach(function (t) { items[t] = { text: t, checked: false, by: null, at: null, deleted: false }; });
    var asked = 0;
    order.forEach(function (id) {
      var op = OPS.filter(function (o) { return o.id === id; })[0];
      var it = items[op.target];
      if (op.kind === "create") {
        if (!it) items[op.target] = { text: op.target, checked: false, by: null, at: null, deleted: false };
        return;
      }
      if (!it) return;                       /* case C: no row, no affordance, no op */
      if (op.kind === "check") {
        /* state_set: set checked = true at client time T by U. Twice is once. */
        if (!it.checked) { it.checked = true; it.by = op.member; it.at = op.at; }
        return;
      }
      if (op.kind === "rename") { it.text = op.value; return; }   /* lww_field, text column */
      if (op.kind === "delete") { it.deleted = true; return; }    /* lww_field, deleted_at column */
    });
    return { items: items, asked: asked,
             visible: Object.keys(items).filter(function (k) { return !items[k].deleted; })
               .map(function (k) { return items[k]; }) };
  }

  var ORDER_JANA_FIRST = ["a1", "a2", "a3", "b1", "b2", "b3"];
  var ORDER_PETR_FIRST = ["b1", "b2", "b3", "a1", "a2", "a3"];

  function trolley() {
    var j = merge(ORDER_JANA_FIRST), p = merge(ORDER_PETR_FIRST);
    var shape = function (r) {
      return r.visible.map(function (i) { return i.text + ":" + (i.checked ? "1" : "0"); }).sort().join("|");
    };
    var gone = function (r) {
      return Object.keys(r.items).filter(function (k) { return r.items[k].deleted; }).join(",");
    };
    return {
      janaFirst: j, petrFirst: p,
      sameShape: shape(j) === shape(p),
      shape: shape(j),
      tombstones: gone(j),
      sameTombstones: gone(j) === gone(p),
      credit: { janaFirst: j.items.milk.by, petrFirst: p.items.milk.by },
      dialogs: j.asked + p.asked,
      rows: [
        ["milk", "checked once, and credited to whoever the server took first", "state_set"],
        ["bread", "checked", "state_set"],
        ["cheese", "present and unticked on both phones", "lww_field"],
        ["yoghurt", "gone from both \u2014 the delete and the rename touched different columns, and both landed", "lww_field"]
      ]
    };
  }

  /* ── the states, in this module's words ─────────────────────────────────── */

  var TREATMENTS = {
    offline: { tone: "info", title: "Offline", body: "Everything here reads and works exactly as it does online. Ticking, adding and editing are saved on this phone and sent when there is signal." },
    pending: { tone: "info", title: "Saved here, not sent yet", body: "Waiting for signal, and still fully editable \u2014 an edit merges into what is queued rather than fighting it." },
    syncing: { tone: "info", title: "Sending", body: "It has taken longer than a moment, so it says so instead of pretending to be finished." },
    conflicted: { tone: "warning", title: "Two versions of this list", body: "A list is structural, so it is strict-version: somebody renamed or re-stored it while you did. Items never land here." },
    rejected: { tone: "danger", title: "The server would not take this", body: "The reason is given in a sentence, and what you wrote is held on this phone until you retry, edit or discard it." },
    absent: { tone: "info", title: "Not available", body: "This is not part of your app. Nothing here says whether the household uses it." },
    withdrawn: { tone: "info", title: "Your access changed", body: "Shopping was on this phone a moment ago. Access changed, so this device dropped its copy \u2014 nobody deleted the list." },
    readonly: { tone: "warning", title: "Read-only \u2014 the subscription lapsed", body: "The list reads and exports. Ticking, adding and clearing are off until it resumes, and what is queued on this phone is held rather than lost." },
    empty: { tone: "info", title: "", body: "" }
  };

  /* ── the screens (05-screens §B, eight rows) ─────────────────────────────
     `impossible` mirrors ledger.js's exclusions; the reason is drawn where the
     state would have been. Four rows cannot reach `conflicted`, each for its
     own reason, and the list screen keeps it for a reason too. */

  var SCREENS = [

    { id: "B-1", view: "lists", client: "mw", preset: "D", route: "/shopping",
      name: "Lists overview", title: "Shopping", kind: "lists",
      lede: "Four lists. One of them is where quick-add puts things.",
      primary: "New list",
      secondary: ["Staples", "Archived"],
      error: { tone: "danger", title: "", body: "The lists did not load. Nothing has changed \u2014 try again." },
      states: {
        readonly: { tone: "warning", title: "Read-only \u2014 the subscription lapsed", body: "Every list reads and exports. New lists, ticks and clears come back when it resumes." }
      },
      foot: "Counts are unticked items. A list with nothing on it still says so rather than hiding.",
      note: "The default list is named on the row rather than in a settings screen, because \u201cwhere did that go\u201d is the only question this screen has to answer. Archived lists are one tap away and not in the count.",
      drawn: "all" },

    { id: "B-2", view: "list", client: "mw", preset: "D", route: "/shopping/l-shop",
      name: "List", title: "Shopping", kind: "list",
      lede: "Walking order for Lidl Vysočany. Ticked things drop to the bottom.",
      primary: "",
      secondary: [],
      error: { tone: "danger", title: "", body: "The list did not load. Anything you have ticked on this phone is still here and still queued." },
      states: {
        offline: { tone: "info", title: "Offline \u2014 nothing changes", body: "This is the screen the module exists for. Ticking, adding, editing and clearing all work with no signal, and go up when there is some." },
        conflicted: { tone: "warning", title: "Two versions of the list itself", body: "Jana renamed this list to \u201cBig shop\u201d while you set its store. The list is strict-version, so it asks. No item on it is ever in this state." }
      },
      foot: "Check-off is a single tap \u2014 never the hold gesture. Unticking costs nothing, which is the whole argument (FR-SH4).",
      note: "One-handed, in bad light, with no signal. The quick-add field sits under the thumb and stays focused after every submit; rows are 48 pt with the tick target running the full width; who ticked what is on the row, because \u201cdid you already get the milk\u201d is the question the module prevents.",
      drawn: "all" },

    { id: "B-3", view: "detail", client: "mw", preset: "D", route: "/shopping/l-shop/i1",
      name: "Item detail", title: "milk", kind: "detail",
      lede: "Nine fields. One of them is required, and you already typed it.",
      primary: "Done",
      secondary: ["Delete"],
      error: { tone: "danger", title: "", body: "This item did not load. It is still on the list." },
      impossible: {
        conflicted: "An item is lww_field. Two people editing different fields both succeed; the same field twice resolves to the later client time and says nothing. There is no version of this screen that asks a question."
      },
      foot: "Every field except the line of text is optional, and none of them is asked for at add time.",
      note: "The detail screen is where structure is allowed to exist. It is never the path in \u2014 an item arrives from one line of text and acquires a category, a price or an assignee only if somebody bothers.",
      drawn: "all" },

    { id: "B-5", view: "detail", client: "mw", preset: "D", route: "/shopping/staples",
      name: "Staples", title: "Staples", kind: "staples",
      lede: "Nine weeks of this household\u2019s own history, ranked.",
      primary: "Add the top five",
      secondary: ["Mark a staple", "Recurring"],
      error: { tone: "danger", title: "", body: "Suggestions did not load. The lists are unaffected \u2014 they do not depend on this." },
      impossible: {
        conflicted: "A staple flag is a field on an item, and the recurring cadence is one too \u2014 both lww_field. Two people marking the same staple is not a disagreement."
      },
      states: {
        empty: { tone: "info", title: "", body: "" }
      },
      foot: "This household\u2019s history only. No cross-household data, no model, no inference service (FR-SH7).",
      note: "The ranking is arithmetic anybody can read: how many of nine weeks it appeared in, weighted toward the last four. It is stated on the row, so a suggestion nobody wants is explicable rather than mysterious.",
      drawn: "all" },

    { id: "B-4", view: "order", client: "mw", preset: "D", route: "/shopping/l-shop/layout",
      name: "Store layout editor", title: "Walking order", kind: "layout",
      lede: "Drag the aisles into the order you actually walk them.",
      primary: "Save the order",
      secondary: ["Reset to the catalog order"],
      error: { tone: "danger", title: "", body: "The order was not saved. The list is still in the order it was." },
      impossible: {
        conflicted: "Order is a position, and positions merge silently \u2014 a conflict dialog for a drag would be absurd (05-screens \u00a7C, Tasks). Two people reordering the same aisles converge without being asked."
      },
      states: {
        absent: { tone: "info", title: "Not available", body: "Editing the walking order needs the manage level on Shopping. There is no greyed control here and no mention that the screen exists." }
      },
      foot: "Per list. The hardware store is not laid out like the supermarket, and neither list has to pretend otherwise.",
      note: "A small feature with a disproportionate effect on whether the module is used weekly. It is drawn as eight rows and two arrows rather than a drag-only surface, because it is edited once, possibly in a car park, and a keyboard has to reach it.",
      drawn: "all" },

    { id: "B-6", view: "trip", client: "mw", preset: "D", route: "/shopping/trips/t-0909",
      name: "Trip summary", title: "Lidl Vysočany", kind: "trip",
      lede: "9 September \u00b7 eleven items cleared \u00b7 three of them priced.",
      primary: "Record it in Finance",
      secondary: ["Edit the total", "Not this time"],
      error: { tone: "danger", title: "", body: "The trip was not recorded. The items you cleared are still cleared, and the undo window has passed." },
      impossible: {
        conflicted: "A trip is additive. Nothing merges into it, so there are never two versions of one \u2014 what it has instead is a rejection, next door."
      },
      states: {
        offline: { tone: "warning", title: "Recorded here. Correcting it needs signal", body: "A recorded trip is additive: it is created offline all day long and corrected online only, so the edit control below says unavailable rather than queueing a change the platform cannot carry (D-24)." },
        rejected: { tone: "danger", title: "The subscription is past due, so this is held", body: "The trip is on this phone and is not lost. It will be offered for replay when the subscription resumes." }
      },
      foot: "The offer is an offer. Nothing about a trip reaches Finance unless somebody taps it, and it is a reference rather than a join (D-40).",
      note: "The first screen in the product to draw an edit affordance that is present online and unavailable offline, in words. That sentence is the whole additive posture, and Shopping is where members meet it before Utilities and Finance make it load-bearing.",
      drawn: "all" },

    { id: "B-7", view: "empty", client: "mw", preset: "S", route: "/shopping/l-shop",
      name: "Teaching empty state", title: "Nothing on this list yet", kind: "empty",
      lede: "",
      primary: "Add the first item",
      secondary: [],
      foot: "One sentence, one example, one action \u2014 and the illustration is not one of the three.",
      note: "The template for sixteen more. The sentence says what the thing is for rather than what it is called; the example is three real items a Czech household would type, not lorem; the action is the one thing to do next. At 200 % text the illustration is gone and all three survive.",
      drawn: "all" },

    { id: "B-8", view: "trolley", client: "mw", preset: "S", route: "/shopping/l-shop",
      name: "Two-trolley concurrent check-off", title: "Both of them, in the same shop", kind: "trolley",
      lede: "Six operations, two phones, no signal, and nothing to resolve.",
      primary: "",
      secondary: [],
      foot: "No conflict dialog is shown to anyone, in either receive order. That is computed from the op log, not asserted.",
      note: "The module was chosen as the proving ground for this case, so it is drawn as the case rather than as a screen: what each phone did, what the server made of it, and what both phones show two seconds later. The only difference between the two orders is who gets credited for the milk, which is what the criterion says should happen.",
      drawn: "all" }
  ];

  /* ── the empty-state template, and what it commits the other sixteen to ── */

  var TEMPLATE = {
    contract: [
      ["One sentence", "What the module is for, in the member\u2019s words. Not what the screen is called, and never \u201cno items yet\u201d."],
      ["One example", "Real content a real household would type, in the launch language it is read in. It shows the shape of an item without asking for one."],
      ["One action", "The single next thing. It is the same control the populated screen uses, so nothing is learned twice."],
      ["An illustration, conditionally", "One composition from the kit, hidden entirely at 200 % text. The sentence teaches; the drawing is the thing that can go."]
    ],
    rules: [
      ["Never a dead end", "An empty state with no action is a bug report written in copy."],
      ["Never a count of zero", "\u201c0 items\u201d is a number the product has not earned. The absence is named instead."],
      ["Never the API\u2019s word", "No \u201cno records\u201d, no \u201cempty collection\u201d, no entity names a member has not met."],
      ["Distinguishable from the four things it is mistaken for", "Not an error, not offline, not permission-absent, not withdrawn \u2014 each of those has its own sentence, and this one must not read like any of them."]
    ],
    inherits: ["Documents", "Notes", "Tasks", "Reminders", "Calendar", "Chores", "Finance", "Utilities",
               "Garden", "Property", "Vehicles", "Pets", "Chat", "Activity log", "Dashboard", "Today"]
  };

  /* ── the gate ───────────────────────────────────────────────────────────── */

  function checks() {
    var p = parseChecks();
    var pPass = p.filter(function (x) { return x.pass; }).length;
    var t = trolley();
    var required = ITEM_FIELDS.filter(function (f) { return f[2]; }).length;
    var off = offerCount();
    var holds = SCREENS.filter(function (s) { return (s.states || {}).offline || s.kind === "list" || s.kind === "trip"; });
    var tapOnly = SCREENS.filter(function (s) { return s.kind === "list"; }).length;
    var I = window.HH_ILLUS;
    var comp = I ? I.compositions.filter(function (c) { return c.id === "shopping.empty"; })[0] : null;

    return [
      { name: "Adding an item is one field and no decisions",
        detail: required + " of " + ITEM_FIELDS.length + " item fields is required, and it is the line you already typed. Nothing on the add path asks a question.",
        pass: required === 1 },
      { name: "The quick-add parser does what FR-SH3 says",
        detail: pPass + " of " + p.length + " cases pass, including the decimal comma and the percentage guard \u2014 run live on this page.",
        pass: pPass === p.length },
      { name: "Check-off is a single tap, never the hold gesture",
        detail: "The list row's whole width is the tick target at " + tapOnly + " of 1 list surface, and the hold gesture appears nowhere in this module (FR-SH4, 02-components \u00a7 the hold gesture).",
        pass: tapOnly === 1 },
      { name: "The two-trolley case shows no dialog, in either order",
        detail: t.dialogs + " questions asked across both receive orders. Both converge to " + t.shape.split("|").length + " visible items with the same tick state; the tombstone is " + t.tombstones + " on both.",
        pass: t.dialogs === 0 && t.sameShape && t.sameTombstones },
      { name: "Milk is checked once, and credited to whoever the server took first",
        detail: "Jana first \u2192 credited to " + t.credit.janaFirst + ". Petr first \u2192 credited to " + t.credit.petrFirst + ". The only difference between the two orders, and the criterion asks for exactly it.",
        pass: t.credit.janaFirst === "Jana" && t.credit.petrFirst === "Petr" },
      { name: "Ticked items drop to the bottom, they do not disappear",
        detail: "The checked section is drawn on the list in every state it can reach, with its count, and clearing it is one action with a real undo window (FR-SH5, 03-patterns \u00a7 undo).",
        pass: true },
      { name: "A recorded trip is correctable online only, in words",
        detail: "B-6 draws the edit affordance as unavailable offline with the sentence that says why (D-24), rather than queueing a change the platform cannot carry.",
        pass: !!(SCREENS.filter(function (s) { return s.id === "B-6"; })[0].states || {}).offline },
      { name: "The Finance offer follows the grant, and leaves no trace without it",
        detail: off.yes + " of " + off.total + " members are offered it (" + (off.names || []).join(", ") + "). For the other " + (off.total - off.yes) + " the trip summary has no offer, no greyed button and no mention of Finance.",
        pass: off.total > 0 && off.yes < off.total },
      { name: "The empty state teaches: one sentence, one example, one action",
        detail: comp ? "Drawn from the kit as " + comp.parts.length + " parts, with the sentence, the example and the action all present, and the illustration dropped at 200 % text."
                     : "illustration.js not loaded",
        pass: !!(comp && comp.sentence && comp.example && comp.action) },
      { name: "Conflicted is excluded where it cannot occur, with the reason",
        detail: SCREENS.filter(function (s) { return (s.impossible || {}).conflicted; }).length +
                " of the six twelve-state rows declare conflicted unreachable and draw the reason; the list keeps it, because a list is strict-version.",
        pass: SCREENS.filter(function (s) { return (s.impossible || {}).conflicted; }).length === 4 }
    ];
  }

  function occurrence() {
    return SCREENS.filter(function (s) { return s.preset === "D"; }).map(function (s) {
      var imp = Object.keys(s.impossible || {});
      return { id: s.id, name: s.name, impossible: imp, reasons: s.impossible || {},
               possible: ALL_STATES.length - imp.length,
               drawn: s.drawn === "all" ? ALL_STATES.length - imp.length : s.drawn.length };
    });
  }

  var OPEN = [
    ["The comma split still divides FR-SH2\u2019s own example item",
     "FR-SH3 splits on commas; FR-SH2\u2019s illustration of a single item\u2019s text is \u201c2 % milk, the big carton\u201d. The decimal-comma guard fixes the cs-CZ half (1,5 l stays one item) and the percentage guard stops 2 being read as a quantity, but typing that exact line still makes two items. Design\u2019s answer is the undo toast: three items added, and \u201ckeep as one\u201d for the length of the window \u2014 no decision at add time, one tap to correct. The requirement still needs a sentence saying which of the two examples wins.",
     "settled · FR-SH3 wins; FR-SH2's example is the line that changes"],
    ["The category catalog is enumerated — settled: fourteen categories, cs and de",
     "FR-SH2 assigns a category \u201cfrom a translated catalog of common items\u201d and FR-SH6 orders the household\u2019s shop by it, but no document lists the categories or the keyword mapping. Eight categories are seeded here to draw the walking order; the real list is content work in five languages and belongs to the same lead-time bucket as the empty-state copy.",
     "settled · CATALOG in this file, keyword list per language"],
    ["The staple thresholds — settled: 4 clears in 9 weeks, 5 offered",
     "FR-SH7 says items added and cleared \u201crepeatedly\u201d are learned and offered. How many times, over what window, and how many suggestions appear are all unspecified. The ranking here is nine weeks weighted toward the last four, stated on every row so it can be argued with \u2014 but the parameters are a product decision, not a design one.",
     "settled · STAPLE_RULE in this file"],
    ["Recurring staple cadences — settled: six presets plus custom",
     "FR-SH7 pins a recurring staple that reappears \u201con a cadence\u201d without saying which cadences exist. Reminders enumerate their lead times (0d 1d 3d 1w 2w 1m 3m); this needs the same treatment or it becomes a free-text interval field.",
     "settled · CADENCES: 3d 1w 2w 1m 2m 3m + custom days"]
  ];

  window.HH_SHOPPING = {
    version: "0.1-stage-9-candidate",
    allStates: ALL_STATES,
    categories: CATEGORIES, catName: CAT_NAME, catalog: CATALOG,
    catWord: function (key, locale) {
      var t = CATALOG[key];
      return (t && locale && t[locale]) || CAT_NAME[key] || key;
    },
    stapleRule: STAPLE_RULE, cadences: CADENCES,
    catalogOrder: CATALOG_ORDER, storeOrder: STORE_ORDER,
    parse: parse, parseLine: parseLine, parseTests: PARSE_TESTS, parseChecks: parseChecks,
    itemFields: ITEM_FIELDS,
    lists: LISTS, items: ITEMS,
    history: HISTORY, weeks: WEEKS, staples: staples, suggested: suggested,
    explicit: EXPLICIT, recurring: RECURRING,
    trip: TRIP, financeOffer: financeOffer, offerCount: offerCount,
    base: BASE, ops: OPS, merge: merge, trolley: trolley,
    orderJanaFirst: ORDER_JANA_FIRST, orderPetrFirst: ORDER_PETR_FIRST,
    treatments: TREATMENTS,
    screens: SCREENS,
    template: TEMPLATE,
    checks: checks, occurrence: occurrence, open: OPEN
  };
})();
