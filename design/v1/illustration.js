/* Household — @household/illustration, stage 3 candidate.
   DD-5: one systematic construction language, not bespoke artwork per module.
   A limited palette drawn from the family accents, one drawing language, and
   composition from a shared kit of parts.

   The unit of work is a PART, not a picture. Seventeen empty states and the
   four Finance setup answers are compositions of the parts below; none of
   them is drawn. That is what makes seventeen of them survive translation,
   dark theme and the schedule. Nothing here is a screen. */
(function () {

  var FRAME = { w: 200, h: 140, stroke: 2, partBox: 48 };

  var RULES = [
    ["One frame", "200 × 140, and the illustration never sets its own height. It sits above the empty state's sentence at 100 % text and is hidden entirely at 200 % — the sentence is what teaches."],
    ["Four parts, at most", "A composition is up to four part instances. A fifth means the sentence is doing too little."],
    ["Quarter-step scales only", "0.75 · 1 · 1.25 · 1.5. The stroke is compensated per instance so the whole composition holds one 2-unit weight — a scaled-up part never brings a fatter line with it."],
    ["Two tones", "Ink (text-muted) and one accent — the module's family accent, never a second hue. Fills are the same accent at 12 %, and only inside a closed part."],
    ["The slot is the vocabulary", "The dashed slot is the one part that means nothing here yet, and it appears in every empty state. It is how an empty state reads as empty rather than as broken."],
    ["No faces, no hands, no perspective", "No gradients, no shadows, no rendered form. A figure is a circle and an arc — it is a member, not a person, and it needs no skin tone."],
    ["No text, ever", "Not a letter, not a digit, not a currency mark. Five launch languages, and a label inside artwork is an untranslated string."],
    ["Dark is the same shapes", "Only the tokens change. There is no dark variant of any part, and no part relies on a light ground."]
  ];

  /* ── the kit of parts ─────────────────────────────────────────────────
     [id, name, tone, dashed, note, paths, fills] — all on a 48-unit box */

  var PARTS = [
    ["slot", "Slot", "ink", true, "Nothing here yet. The only part that carries a meaning of its own.",
      ["M5 12h38v24H5z"], []],
    ["shelf", "Shelf", "ink", false, "A place things belong. Grounds a composition without a floor line.",
      ["M4 34h40", "M11 34v7", "M37 34v7"], []],
    ["crate", "Crate", "ink", false, "A container of many. Storage, stock, an archive.",
      ["M8 16h32v24H8z", "M8 24h32"], []],
    ["bag", "Bag", "accent", false, "Shopping, and the only part with a handle — the thing you carry out.",
      ["M12 18h24l-3 22H15z", "M18 18a6 6 0 0 1 12 0"], ["M14 26h20l-2 12H16z"]],
    ["jar", "Jar", "accent", false, "A held amount. The money parts are jars, never coins with a currency mark on them.",
      ["M12 16h24v24a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z", "M10 10h28v6H10z"], ["M12 28h24v12a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z"]],
    ["pot", "Pot", "accent", false, "Garden's own container, and the tier the median household starts at.",
      ["M12 20h24l-4 20H16z", "M9 20h30"], []],
    ["leaves", "Leaves", "accent", false, "Growth, one stem and two leaves. The same construction as the Garden icon at 2×.",
      ["M24 41V24", "M24 24c-8 0-13-4.6-13-11.6 8.4 0 13 4.6 13 11.6z", "M24 24c8 0 13-4.6 13-11.6-8.4 0-13 4.6-13 11.6z"], []],
    ["stack", "Stack", "ink", false, "Repetition of a record: readings, entries, rows.",
      ["M12 33h24v7H12z", "M12 24h24v7H12z", "M12 15h24v7H12z"], []],
    ["card", "Card", "accent", false, "A payment instrument, an account, a subscription.",
      ["M8 15h32v18H8z", "M8 21h32"], []],
    ["sheet", "Sheet", "ink", false, "One written thing: a note, a document, a bill.",
      ["M12 7h24v34H12z", "M18 17h12", "M18 24h12", "M18 31h8"], []],
    ["folder", "Folder", "accent", false, "Custody. What is filed, and who may see it.",
      ["M6 13h14l4 5h18v23H6z"], []],
    ["clock", "Clock", "ink", false, "A time that has come. Used for due, never for late — lateness is a status, not an illustration.",
      ["M24 8a16 16 0 1 0 0 32a16 16 0 1 0 0-32", "M24 15v9l7 4"], []],
    ["dial", "Dial", "accent", false, "A register with a needle. Utilities' whole vocabulary in one part.",
      ["M8 34a16 16 0 1 1 32 0", "M24 34L34 22", "M6 40h36"], []],
    ["flow", "Flow", "accent", false, "Movement from one place to another. Never drawn as money moving by itself.",
      ["M8 34C8 18 24 18 37 18", "M32 13l5 5-5 5"], []],
    ["fork", "Fork", "accent", false, "One source, two destinations. The allocation editor's shape.",
      ["M9 24h11c6 0 6-10 12-10h5", "M20 24c6 0 6 10 12 10h5", "M32 9l5 5-5 5", "M32 29l5 5-5 5"], []],
    ["figure", "Figure", "ink", false, "A member. A circle and an arc, so it needs no face and no skin tone.",
      ["M24 10a5 5 0 1 0 0 10a5 5 0 1 0 0-10", "M13 41c0-7 5-12 11-12s11 5 11 12"], []],
    ["house", "House", "ink", false, "The household itself, or a property in it.",
      ["M6 26L24 12l18 14v15H6z"], []],
    ["bars", "Bars", "ink", false, "History that exists. Pointedly absent from every no-history composition.",
      ["M8 40h32", "M13 40V28", "M21 40V19", "M29 40V32", "M37 40V23"], []]
  ];

  /* ── compositions ─────────────────────────────────────────────────────
     Empty states carry the 07-delivery contract: one sentence, one example,
     one action. The Finance four are answers, not empty states, and carry
     the consequence of choosing them instead. */

  var COMPOSITIONS = [
    { id: "shopping.empty", screen: "Shopping · list, nothing on it", accent: "accent-family-keeping", kind: "empty",
      sentence: "A list is what someone else can see while you are still at home.",
      example: "Milk, 2 × bread, the thing you forgot last time",
      action: "Add the first item",
      note: "Written in Stage 9 as the template for sixteen more. Three parts: a place things belong, the thing you carry, and the slot that says it is empty.",
      parts: [["shelf", 20, 62, 1.5], ["bag", 30, 26, 1], ["slot", 104, 44, 1.25]] },

    { id: "finance.setup.pooled", screen: "Finance · setup step 1, answer A", accent: "accent-family-money", kind: "answer",
      sentence: "Everything comes out of one pot.",
      example: "One household account, both of us paying into it",
      action: "Choose this",
      note: "One jar, two members. The composition says pooled without a diagram of accounts.",
      parts: [["jar", 76, 40, 1.25], ["figure", 16, 52, 0.75], ["figure", 148, 52, 0.75]] },

    { id: "finance.setup.split", screen: "Finance · setup step 1, answer B", accent: "accent-family-money", kind: "answer",
      sentence: "We split what we share.",
      example: "Rent and the shop halved; everything else is ours",
      action: "Choose this",
      note: "The fork is the allocation editor's own shape, introduced here so the editor is recognised when it arrives.",
      parts: [["jar", 8, 46, 0.75], ["fork", 62, 46, 1], ["jar", 148, 46, 0.75]] },

    { id: "finance.setup.allowance", screen: "Finance · setup step 1, answer C", accent: "accent-family-money", kind: "answer",
      sentence: "One of us handles the money.",
      example: "I pay the bills; the household sees where it went",
      action: "Choose this",
      note: "A member, a movement, a held amount. The arrow never implies the app moved anybody's money.",
      parts: [["figure", 12, 46, 1], ["flow", 68, 44, 1], ["jar", 132, 44, 1]] },

    { id: "finance.setup.separate", screen: "Finance · setup step 1, answer D", accent: "accent-family-money", kind: "answer",
      sentence: "We keep it separate and settle up.",
      example: "You bought the boiler service, I owe you half",
      action: "Choose this",
      note: "Two jars, one slot between them: the shared thing does not exist yet, which is exactly what settling up is for.",
      parts: [["jar", 6, 40, 1], ["slot", 62, 52, 0.75], ["jar", 122, 40, 1]] },

    { id: "garden.setup.pots", screen: "Garden · setup step 1, answer A", accent: "accent-garden", kind: "answer",
      sentence: "Pots, tubs and a windowsill.",
      example: "Four tomatoes, basil, a bay in a tub by the door",
      action: "Choose this",
      note: "Added in Stage 17. Two pots and one stem: the tier is the container, and there is no ground in the picture because there is no ground.",
      parts: [["pot", 40, 44, 1.25], ["leaves", 96, 30, 1], ["pot", 140, 48, 0.75]] },

    { id: "garden.setup.beds", screen: "Garden · setup step 1, answer B", accent: "accent-garden", kind: "answer",
      sentence: "Raised beds, or a patch behind the house.",
      example: "Four beds, tomatoes in two of them, garlic in October",
      action: "Choose this",
      note: "The median European garden, and the tier that gets the most attention. A place things belong, with two stems in it.",
      parts: [["shelf", 14, 64, 1.5], ["leaves", 46, 26, 1.25], ["leaves", 116, 34, 1]] },

    { id: "garden.setup.plot", screen: "Garden · setup step 1, answer C", accent: "accent-garden", kind: "answer",
      sentence: "A plot, and a plan for it.",
      example: "Fourteen beds, what followed what, and what to move this year",
      action: "Choose this",
      note: "The only Garden composition that carries bars, because this is the only tier with history to check against — the same reason garden.no_history carries none.",
      parts: [["shelf", 8, 80, 1.25], ["shelf", 104, 80, 1.25], ["leaves", 40, 30, 1], ["bars", 120, 24, 1]] },

    { id: "garden.no_history", screen: "Garden · plan check, no history", accent: "accent-garden", kind: "empty",
      sentence: "Nothing has been planted here yet, so there is nothing to check against.",
      example: "Add a bed and a first planting; the rotation check starts next season",
      action: "Add a planting",
      note: "No bars part. A no-history composition never shows history in outline — that is how it stays distinguishable from a genuine zero.",
      parts: [["pot", 22, 50, 1.25], ["leaves", 66, 12, 1], ["slot", 116, 46, 1.25]] },

    { id: "documents.empty", screen: "Documents · folder, empty", accent: "accent-family-keeping", kind: "empty",
      sentence: "Documents live here so the person who needs one at a bad moment can find it.",
      example: "The boiler warranty, the tenancy, last year's insurance",
      action: "Upload or take a photo",
      note: "Folder, one sheet, one slot — custody, an example of custody, and room for more.",
      parts: [["folder", 14, 44, 1.25], ["sheet", 78, 34, 1], ["slot", 124, 48, 1]] },

    { id: "utilities.not_enough", screen: "Utilities · service, not enough information", accent: "accent-family-money", kind: "empty",
      sentence: "One reading is not enough to work out what you are using.",
      example: "Enter this month's reading; the figure appears with the second one",
      action: "Add a reading",
      note: "A dial and a slot. The slot stands where the figure would be, so the screen names what is missing instead of printing a zero.",
      parts: [["dial", 22, 46, 1.25], ["stack", 96, 34, 0.75], ["slot", 132, 48, 1]] }
  ];

  var BY_PART = {};
  PARTS.forEach(function (p) {
    BY_PART[p[0]] = { id: p[0], name: p[1], tone: p[2], dashed: p[3], note: p[4], paths: p[5], fills: p[6] };
  });

  /* the two things the kit claims and can therefore be checked on:
     every composition is four parts or fewer, and every part it names exists */
  function audit() {
    var over = [], missing = [], scales = {};
    COMPOSITIONS.forEach(function (c) {
      if (c.parts.length > 4) over.push(c.id);
      c.parts.forEach(function (p) {
        if (!BY_PART[p[0]]) missing.push(c.id + " → " + p[0]);
        scales[p[3]] = (scales[p[3]] || 0) + 1;
      });
    });
    var illegal = Object.keys(scales).filter(function (s) { return [0.75, 1, 1.25, 1.5].indexOf(parseFloat(s)) < 0; });
    var used = {};
    COMPOSITIONS.forEach(function (c) { c.parts.forEach(function (p) { used[p[0]] = 1; }); });
    var unused = PARTS.map(function (p) { return p[0]; }).filter(function (id) { return !used[id]; });
    return { over: over, missing: missing, illegalScales: illegal, unused: unused, scales: scales };
  }

  window.HH_ILLUS = {
    version: "0.1-stage-3-candidate",
    frame: FRAME, rules: RULES, parts: PARTS, byPart: BY_PART,
    compositions: COMPOSITIONS, audit: audit()
  };
})();
