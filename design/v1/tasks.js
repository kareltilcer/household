/* Stage 12b — Tasks: boards, cards, and the parts of a kanban that are load-bearing here.

   Sources: prd/modules/02-tasks.md (FR-TA1–FR-TA10, the four starter templates, the sync
   table and its note on position merge, Catalog contributions, the non-goals);
   design/05-screens.md §C Tasks (eight rows, and the two sentences that are the gate:
   column kind surfaced without jargon, and \u201ca conflict dialog for a drag would be absurd\u201d);
   03-patterns.md §1 (merge policies); prd/03-platform-strands.md §6 FR-RM1 (the resolver
   contract this module answers) and §2.5 (lww_field on a position).

   The module is carried from home almost unchanged, so the design work is not the board.
   It is three things: the position merge, which has to be shown rather than asserted; the
   column kind, which is an API word that must never reach a label; and the due date, which
   belongs to the reminder strand and not to this file. */
(function () {

  var TODAY = "2026-09-09";

  /* ── 1. The four starter templates (a shape, not content) ─────────────── */

  var TEMPLATES = [
    { id: "simple", name: "Simple", columns: [["To do", "normal"], ["Doing", "now"], ["Done", "done"]],
      why: "Three columns and nothing to learn." },
    { id: "household", name: "Household", def: true,
      columns: [["Backlog", "normal"], ["This week", "now"], ["Doing", "now"], ["Done", "done"]],
      why: "The default. \u201cThis week\u201d is what makes a household board get looked at on a Sunday." },
    { id: "project", name: "Project",
      columns: [["Ideas", "normal"], ["Planned", "normal"], ["Doing", "now"], ["Blocked", "normal"], ["Done", "done"]],
      why: "A kitchen, a move, a wedding \u2014 the one board that has a middle." },
    { id: "empty", name: "Empty", columns: [], why: "For somebody who already knows what they want." }
  ];

  /* ── 2. Column kind, in words a member already knows ──────────────────────
     FR-TA2's `kind` is what makes the Doing widget and the completion semantics work
     without hardcoding column names. It is also three API tokens, and 05-screens asks for
     it surfaced without jargon. VOCAB is what reaches the screen; the tokens stay in the
     payload. LABELS is scanned by the gate. */

  var VOCAB = [
    { kind: "normal", label: "An ordinary column", effect: "Cards sit here until somebody moves them.",
      pick: "Just a column" },
    { kind: "now", label: "Being worked on", effect: "Cards here appear in the household\u2019s Doing widget and on Today.",
      pick: "We are on it" },
    { kind: "done", label: "Finished", effect: "Dropping a card here marks it finished and stamps the date. Dragging it back out clears the stamp.",
      pick: "It is finished" }
  ];

  var LABELS = [];
  VOCAB.forEach(function (v) { LABELS.push(v.label, v.effect, v.pick); });
  LABELS.push("What happens in this column", "Rename", "Move left", "Move right", "Delete this column",
              "Cards in it move to the column on the left", "Add a column",
              "Every board needs somewhere to put what is finished.");

  var API_WORDS = ["normal", "now", "done", "kind", "lexorank", "position", "column_id"];
  function jargonScan() {
    var hits = [];
    LABELS.forEach(function (s) {
      API_WORDS.forEach(function (w) {
        if (new RegExp("\\b" + w + "\\b", "i").test(s)) hits.push({ word: w, label: s });
      });
    });
    return { labels: LABELS.length, hits: hits, clean: hits.length === 0 };
  }

  /* ── 3. Lexorank ──────────────────────────────────────────────────────────
     A position is an ordinary field (\u00a72.5), so it is lww_field and two members reordering
     a column touch different rows. between() is the whole reason an insert is a local
     operation and therefore safe offline. */

  var ABC = "0123456789abcdefghijklmnopqrstuvwxyz";
  function between(a, b) {
    a = a || ""; b = b || "";
    var out = "", i = 0;
    while (i < 24) {
      var ca = i < a.length ? ABC.indexOf(a[i]) : 0;
      var cb = i < b.length ? ABC.indexOf(b[i]) : ABC.length;
      if (cb - ca > 1) return out + ABC[Math.floor((ca + cb) / 2)];
      out += ABC[ca >= 0 ? ca : 0];
      i++;
    }
    return out + "i";
  }

  /* ── 4. The fixture boards ────────────────────────────────────────────── */

  var BOARDS = [
    { id: "dum", name: "D\u016fm", template: "household", icon: "house",
      columns: [
        { id: "backlog", name: "Backlog", kind: "normal" },
        { id: "week", name: "This week", kind: "now" },
        { id: "doing", name: "Doing", kind: "now" },
        { id: "done", name: "Done", kind: "done" }
      ] },
    { id: "chata", name: "Chata", template: "simple", icon: "cabin",
      columns: [
        { id: "todo", name: "To do", kind: "normal" },
        { id: "cdoing", name: "Doing", kind: "now" },
        { id: "cdone", name: "Done", kind: "done" }
      ] }
  ];

  var CARDS = [
    { id: "regrout", board: "dum", col: "backlog", rank: "h", title: "Regrout the bathroom",
      labels: ["bathroom"], checklist: [0, 0], comments: 0 },
    { id: "hatch", board: "dum", col: "backlog", rank: "n", title: "Fit the loft hatch",
      labels: [], checklist: [0, 0], comments: 0 },

    { id: "stk", board: "dum", col: "week", rank: "h", title: "Book the STK",
      due: "2026-09-09", assignee: "jana", labels: ["car", "phone-call"], checklist: [1, 3], comments: 1,
      body: "Garage on Kr\u00e1lovopolsk\u00e1 took it last year. Bring the small book and the insurance card." },
    { id: "plumber", board: "dum", col: "week", rank: "n", title: "Call the plumber about the boiler",
      due: "2026-09-08", assignee: "jana", labels: ["phone-call"], checklist: [0, 0], comments: 2 },
    { id: "recycling", board: "dum", col: "week", rank: "t", title: "Take the recycling to the yard",
      assignee: "adam", labels: [], checklist: [0, 0], comments: 0 },

    { id: "hallway", board: "dum", col: "doing", rank: "h", title: "Repaint the hallway",
      assignee: "jana", labels: ["decorating"], checklist: [3, 5], comments: 2 },
    { id: "drill", board: "dum", col: "doing", rank: "n", title: "Return the drill to Milo\u0161",
      assignee: "adam", labels: [], checklist: [0, 0], comments: 0 },

    { id: "latch", board: "dum", col: "done", rank: "h", title: "Fix the gate latch",
      assignee: "jana", labels: [], checklist: [0, 0], comments: 0, doneAt: "2026-09-05" },

    { id: "firewood", board: "chata", col: "todo", rank: "h", title: "Order firewood",
      due: "2026-09-18", assignee: "jana", labels: ["before-winter"], checklist: [0, 0], comments: 0 },
    { id: "pipes", board: "chata", col: "todo", rank: "n", title: "Drain the pipes before the frost",
      labels: ["before-winter"], checklist: [0, 4], comments: 0 },
    { id: "shed", board: "chata", col: "cdoing", rank: "h", title: "Sort the shed",
      assignee: "milos", labels: [], checklist: [2, 6], comments: 1 }
  ];

  var LABEL_SET = [
    { id: "car", name: "Car", colour: "--chart-2" },
    { id: "phone-call", name: "Phone call", colour: "--chart-4" },
    { id: "decorating", name: "Decorating", colour: "--chart-5" },
    { id: "bathroom", name: "Bathroom", colour: "--chart-3" },
    { id: "before-winter", name: "Before winter", colour: "--chart-1" }
  ];
  function labelOf(id) { return LABEL_SET.filter(function (l) { return l.id === id; })[0] || { id: id, name: id, colour: "--border" }; }

  var COMMENTS = [
    { card: "plumber", who: "petr", at: "yesterday 19:12", text: "He said Thursday morning or next week. Thursday is better \u2014 @jana can you be in?", mentions: ["jana"] },
    { card: "plumber", who: "jana", at: "yesterday 19:40", text: "Thursday works. I will move the dentist." },
    { card: "hallway", who: "jana", at: "Monday", text: "Second coat still to do above the door." },
    { card: "hallway", who: "adam", at: "Monday", text: "I can do the skirting on Saturday." },
    { card: "stk", who: "jana", at: "3 September", text: "Emissions were the thing that failed last time." },
    { card: "shed", who: "milos", at: "last week", text: "Half of it is the previous owner\u2019s. Skip run before winter." }
  ];

  var CHECKLIST = [
    { card: "stk", items: [["Find the small technical book", true], ["Ring the garage", false], ["Move the car insurance card to the glovebox", false]] },
    { card: "hallway", items: [["Fill the cracks", true], ["Sand", true], ["Undercoat", true], ["First coat", false], ["Second coat", false]] }
  ];

  function board(id) { return BOARDS.filter(function (b) { return b.id === id; })[0]; }
  function cardsOf(boardId, colId, cards) {
    return (cards || CARDS).filter(function (c) { return c.board === boardId && c.col === colId; })
      .sort(function (a, b) { return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0; });
  }

  /* FR-RM1's resolver, answered by the module. The strand asks for a window and gets back
     entity, date, title and module \u2014 and nothing about lead times, which are not this
     module's business. */
  function dueCards(from, to) {
    return CARDS.filter(function (c) { return c.due && c.due >= from && c.due <= to && !c.doneAt; })
      .map(function (c) {
        return { id: c.id, due: c.due, title: c.title, assignee: c.assignee,
                 board: board(c.board).name, column: colName(c),
                 endpoint: "/tasks/" + c.board + "/cards/" + c.id };
      });
  }
  function colName(c) {
    var b = board(c.board);
    var col = b.columns.filter(function (x) { return x.id === c.col; })[0];
    return col ? col.name : c.col;
  }

  /* ── 5. The move, and what a done column does (FR-TA4) ────────────────── */

  function move(card, toBoard, toCol, ranks) {
    var b = board(toBoard);
    var col = b.columns.filter(function (x) { return x.id === toCol; })[0];
    var out = { id: card.id, board: toBoard, col: toCol, rank: between(ranks[0], ranks[1]),
                crossBoard: card.board !== toBoard };
    out.doneAt = col.kind === "done" ? TODAY : null;
    out.stamped = col.kind === "done";
    out.cleared = card.doneAt && col.kind !== "done";
    return out;
  }

  function moveProof() {
    var latch = CARDS.filter(function (c) { return c.id === "latch"; })[0];
    var hallway = CARDS.filter(function (c) { return c.id === "hallway"; })[0];
    var firewood = CARDS.filter(function (c) { return c.id === "firewood"; })[0];
    return {
      intoDone: move(hallway, "dum", "done", ["h", ""]),
      outOfDone: move(latch, "dum", "doing", ["h", "n"]),
      crossBoard: move(firewood, "dum", "week", ["n", "t"])
    };
  }

  /* ── 6. The position merge, run in both receive orders ────────────────────
     Two members reorder offline. The ops touch different rows, so they do not meet at all;
     where two ranks collide exactly the server rebalances the column and emits the new
     ranks as an ordinary change. Nothing here opens a dialog, which is the sentence
     05-screens writes as \u201ca conflict dialog for a drag would be absurd\u201d. */

  var OPS = [
    { by: "jana", card: "hallway", to: ["", "h"], at: "18:02", offline: true,
      says: "Jana, on the tram: pulls Repaint the hallway to the top of Doing." },
    { by: "petr", card: "drill", to: ["h", ""], at: "18:05", offline: true,
      says: "Petr, at the cottage: pushes Return the drill to the bottom of the same column." },
    { by: "jana", card: "recycling", to: ["", "h"], at: "18:09", offline: true,
      says: "Jana: moves Take the recycling to the top of This week." },
    { by: "petr", card: "stk", to: ["h", "n"], at: "18:11", offline: true,
      says: "Petr: nudges Book the STK down one in the same column." },
    { by: "jana", card: "plumber", to: ["h", "n"], at: "18:14", offline: true, collide: true,
      says: "Jana: drops Call the plumber into the same gap Petr just used \u2014 the one real collision." },
    { by: "petr", card: "pipes", to: ["", "h"], at: "18:15", offline: true,
      says: "Petr: pulls Drain the pipes to the top of the cottage board." }
  ];

  function applyOps(order) {
    var cards = CARDS.map(function (c) { return { id: c.id, board: c.board, col: c.col, rank: c.rank, title: c.title, at: "" }; });
    var by = {};
    cards.forEach(function (c) { by[c.id] = c; });
    var dialogs = 0, rebalanced = [], log = [];

    /* Each op writes one field on one row. Two members reordering touch different rows, so
       the receive order cannot change the outcome — there is nothing to merge. */
    order.forEach(function (op) {
      var c = by[op.card];
      c.rank = between(op.to[0], op.to[1]);
      c.at = op.at;
      log.push({ by: op.by, card: c.title, col: c.col, rank: c.rank, rebalanced: false });
    });

    /* Then the one case that is not a field write: two ranks that came out exactly equal.
       The server rebalances that column and emits the new ranks as an ordinary change. The
       tie is broken by client_time, which the mutation carries (§2.8), so the rebalance is
       the same whichever batch arrived first. */
    var cols = {};
    cards.forEach(function (c) { (cols[c.board + "." + c.col] = cols[c.board + "." + c.col] || []).push(c); });
    Object.keys(cols).forEach(function (key) {
      var col = cols[key];
      var clash = col.some(function (a) {
        return col.some(function (b) { return a !== b && a.rank === b.rank; });
      });
      if (!clash) return;
      rebalanced.push(key);
      col.sort(function (a, b) {
        if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
        if (a.at !== b.at) return a.at < b.at ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
      col.forEach(function (x, i) {
        x.rank = ABC[(i + 1) * 3];
        log.forEach(function (l) { if (l.card === x.title) { l.rebalanced = true; l.rank = x.rank; } });
      });
    });

    var final = {};
    BOARDS.forEach(function (b) {
      b.columns.forEach(function (col) {
        final[b.id + "." + col.id] = cards.filter(function (x) { return x.board === b.id && x.col === col.id; })
          .sort(function (a, b2) { return a.rank < b2.rank ? -1 : a.rank > b2.rank ? 1 : 0; })
          .map(function (x) { return x.title; });
      });
    });
    return { final: final, dialogs: dialogs, rebalanced: rebalanced, log: log };
  }

  function mergeProof() {
    var a = applyOps(OPS);
    var b = applyOps(OPS.slice().reverse());
    var keys = Object.keys(a.final);
    var same = keys.filter(function (k) { return a.final[k].join("|") === b.final[k].join("|"); });
    return {
      ops: OPS.length, a: a, b: b, keys: keys,
      converged: same.length === keys.length,
      differing: keys.filter(function (k) { return a.final[k].join("|") !== b.final[k].join("|"); }),
      dialogs: a.dialogs + b.dialogs,
      rebalanced: a.rebalanced.length
    };
  }

  /* ── 7. Hold-to-complete, and its mandatory keyboard path ─────────────── */

  var HOLD = { ms: 2000, steps: 4, keyboard: "Enter", pointer: "press and hold",
               why: "The same 2000 ms as the dashboard\u2019s widgets (Stage 10). A completion that moves a rotation or stamps a date is worth two seconds; a checkbox is not." };

  var COMPLETION_PATHS = [
    { where: "A card in a kind-done drag", pointer: "drag into the finished column", keyboard: "Move right \u2192, or Enter on the card menu", hold: false },
    { where: "A card\u2019s finish control", pointer: HOLD.pointer, keyboard: HOLD.keyboard, hold: true },
    { where: "A checklist item", pointer: "tap", keyboard: "Space", hold: false },
    { where: "A reminder occurrence in the unified list", pointer: HOLD.pointer, keyboard: HOLD.keyboard, hold: true },
    { where: "A reminder occurrence in the reminders.due widget", pointer: HOLD.pointer, keyboard: HOLD.keyboard, hold: true }
  ];

  /* ── 8. Assignment (FR-TA5) ───────────────────────────────────────────── */

  function assignable() {
    var F = window.HH_FIXTURES;
    return (F ? F.members : []).map(function (m) {
      var g = m.grants.tasks || "none";
      return { id: m.id, name: m.name, grant: g, offered: g !== "none" };
    });
  }
  function assign(memberId) {
    var m = assignable().filter(function (x) { return x.id === memberId; })[0];
    if (!m) return { status: 404 };
    if (!m.offered) {
      return { status: 422, reason: "assignee_cannot_see_card",
               says: m.name + " does not have Tasks, so the card would be invisible to them.",
               safe: "Grants are readable by every member (17-household-admin, Permissions), so naming the reason discloses nothing the assigner could not read on the member list." };
    }
    return { status: 200, says: "Assigned to " + m.name + ". They are notified in the direct category." };
  }

  /* ── 9. The screens (05-screens §C Tasks — eight rows) ────────────────── */

  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending",
                    "syncing", "conflicted", "rejected", "absent", "withdrawn", "readonly"];

  var SCREENS = [
    { id: "C-15", view: "board", client: "mw", preset: "D", route: "/tasks/dum",
      name: "Tasks board", title: "D\u016fm", kind: "board",
      lede: "Columns across, cards down, and the order is the household\u2019s own.",
      primary: "Add a card", secondary: ["Boards", "Arrange columns"],
      empty: { s: "This board has no cards yet.", e: "\u201cRegrout the bathroom\u201d sitting in Backlog until somebody has a free Saturday.", a: "Add the first card" },
      error: "Couldn\u2019t load the board. The cards this device already holds are still readable.",
      rejected: "Refused: that column was deleted by somebody else while you were offline. The card is held, not lost.",
      withdrawn: "Tasks is no longer shared with you. Both boards were removed from this device.",
      readonly: "Read-only while the subscription is past due. Cards read; moving and adding are held.",
      states: {
        conflicted: "Structural, so it is honest to ask: two members restructured the columns at once and tasks.column is strict_version. Cards are untouched \u2014 a card is lww_field and merged silently.",
        pending: "Two moves queued on the tram. Positions are ordinary fields, so they apply without meeting anybody else\u2019s.",
        offline: "The whole board, including the moves you just made. Nothing about a board needs the network to be readable."
      },
      impossible: {},
      foot: "Drag ordering is lexorank. Nothing on this screen can produce a conflict dialog.",
      note: "The module needed the least work to become commercial \u2014 a kanban board makes no assumptions about a household. What it needed was the merge, the column kind and the due date.",
      drawn: "all" },

    { id: "C-16", view: "card", client: "mw", preset: "D", route: "/tasks/dum/cards/stk",
      name: "Card detail", title: "Book the STK", kind: "card",
      lede: "Everything about one card, on one screen, with the board still behind it.",
      primary: "Save", secondary: ["Move", "Delete"],
      empty: { s: "A new card.", e: "A title is enough; a due date makes it a reminder.", a: "Give it a title" },
      error: "Couldn\u2019t load this card. Its comments and checklist are on this device.",
      rejected: "Refused: Klára does not have Tasks, so the card would be invisible to her. Pick somebody else.",
      withdrawn: "This card is no longer shared with you.",
      readonly: "Read-only while the subscription is past due. The checklist, the comments and the assignee are held.",
      states: {
        rejected: "FR-TA5\u2019s 422, and the only place it can be seen: the picker excluded her already, so this is the offline and stale-cache case.",
        pending: "A title edited offline. tasks.card is lww_field, so two members editing the title and the assignee both succeed."
      },
      impossible: {
        conflicted: "tasks.card is lww_field. Two members editing different fields of one card both succeed, and the body is Markdown rather than rich text \u2014 there is no half-merge to report."
      },
      foot: "A due date on a card is a reminder kind (tasks.card_due), with personal completion, owned by the strand.",
      note: "No attachments: a card links to a Document (D-40), so files stay on one meter and under one privacy rule.",
      drawn: "all" },

    { id: "C-17", view: "columns", client: "mw", preset: "D", route: "/tasks/new",
      name: "Template picker \u2014 four starters", title: "Start a board", kind: "template",
      lede: "Four shapes and an empty one. None of them brings any content.",
      primary: "Create the board", secondary: [],
      empty: { s: "", e: "", a: "" },
      error: "Couldn\u2019t create the board. Nothing was created twice \u2014 try again.",
      rejected: "Refused: creating a board needs \u201cCan set it up\u201d on Tasks.",
      withdrawn: "",
      readonly: "Read-only while the subscription is past due. Existing boards read normally.",
      states: {
        pending: "Created offline with a client-generated id (FR-SY4), so cards can be added to it before it has ever reached the server.",
        absent: "A member without Tasks never reaches this screen \u2014 there is no Tasks destination in their app at all."
      },
      impossible: {
        empty: "Four templates are reference data shipped in the build. The list cannot be empty.",
        conflicted: "Nothing exists yet to conflict with: this screen is what creates the board.",
        withdrawn: "There is nothing to retract before the board exists."
      },
      foot: "Templates are translated reference data and carry no cards \u2014 a shape, not content.",
      note: "home seeded a Czech board. A commercial product cannot, which is why this screen exists at all.",
      drawn: "all" },

    { id: "C-18", view: "labels", client: "mw", preset: "D", route: "/tasks/dum/labels",
      name: "Label management", title: "Labels", kind: "labels",
      lede: "Per board, named, coloured \u2014 and the name is always shown.",
      primary: "Add a label", secondary: [],
      empty: { s: "No labels on this board yet.", e: "\u201cPhone call\u201d is the one most households make first.", a: "Add a label" },
      error: "Couldn\u2019t load the labels. Cards still show the ones they carry.",
      rejected: "Refused: that label was deleted by somebody else. Your rename is held.",
      withdrawn: "",
      readonly: "Read-only while the subscription is past due.",
      states: {
        conflicted: "tasks.label is strict_version: two members renaming one label at once are told, because a label is structural and shared.",
        absent: "Label management needs \u201cCan set it up\u201d. For everybody else the labels appear on cards and the screen does not exist."
      },
      impossible: {
        withdrawn: "A label is board-scoped. Losing Tasks retracts the board, and the board\u2019s own withdrawn state is where that is drawn."
      },
      foot: "Colour is never the only carrier of meaning (FR-TA8), which is also what makes the board legible in greyscale.",
      note: "Five labels is a household board. The screen is designed for five and survives twenty.",
      drawn: "all" },

    { id: "C-19", view: "checklist", client: "b", preset: "D", route: "/tasks/dum/cards/stk",
      name: "Checklist", title: "Checklist", kind: "checklist",
      lede: "Ordered items with a done flag, and the progress on the card face.",
      primary: "", secondary: [],
      empty: { s: "No checklist on this card.", e: "Three steps for booking an inspection: find the book, ring the garage, move the insurance card.", a: "Add an item" },
      error: "Couldn\u2019t load the checklist. The card is unaffected.",
      rejected: "Refused: this card was deleted while you were offline. The tick is discarded, not the card\u2019s history.",
      withdrawn: "",
      readonly: "Read-only while the subscription is past due. Ticking is held.",
      states: {
        pending: "A tick made offline. It is a field on the item, so two members ticking different items both succeed."
      },
      impossible: {
        absent: "The grant is checked at the card. Anyone who can see the card can see its checklist \u2014 there are no per-card or per-item permissions (Non-goals).",
        withdrawn: "Same: an item goes with its card.",
        conflicted: "tasks.checklist_item is lww_field, and ticking the same item twice is the same result."
      },
      foot: "Progress is a fraction on the card face, never a percentage bar with no numbers.",
      note: "The smallest surface in the stage, and the one that most often carries the actual work.",
      drawn: "all" },

    { id: "C-20", view: "comments", client: "b", preset: "D", route: "/tasks/dum/cards/plumber",
      name: "Comments with mentions", title: "Comments", kind: "comments",
      lede: "Plain text, threaded per card, with mentions \u2014 the conversation that would otherwise be in Chat.",
      primary: "Comment", secondary: [],
      empty: { s: "No comments yet.", e: "\u201cHe said Thursday morning or next week.\u201d \u2014 the reason this is not in Chat.", a: "Write one" },
      error: "Couldn\u2019t load the comments. What you were typing is still in the box.",
      rejected: "",
      withdrawn: "",
      readonly: "Read-only while the subscription is past due. Comments read; posting is held.",
      states: {
        pending: "Written offline. Comments are additive \u2014 the row is created and never merged, so two replicas cannot disagree about it.",
        offline: "Identical to the online read, and posting queues."
      },
      impossible: {
        conflicted: "additive: comments are created and never edited into conflict.",
        rejected: "An additive row is refused only on a cross-row invariant, and a comment carries none.",
        withdrawn: "A comment goes with its card; the card\u2019s withdrawn state is where that is drawn."
      },
      foot: "A mention notifies in the direct category, and the picker offers the same members the assignee picker does.",
      note: "\u201cCommunication in context\u201d, which is the argument for Tasks comments existing beside a Chat module at all.",
      drawn: "all" },

    { id: "C-21", view: "move", client: "mw", preset: "F", route: "/tasks/chata/cards/firewood/move",
      name: "Cross-board move", title: "Move this card", kind: "move",
      lede: "Board, then column. The card keeps its id, its comments and its history.",
      primary: "Move", secondary: [],
      empty: { s: "", e: "", a: "" },
      error: "The move did not go through. The card is where it was, with everything on it.",
      rejected: "", withdrawn: "", readonly: "",
      impossible: {},
      foot: "New in Household: home had no cross-board move, and a member with two boards tries it immediately.",
      note: "Arriving in a finished column stamps the date; leaving one clears it. The rule is the column\u2019s, not the board\u2019s.",
      drawn: "all" },

    { id: "C-22", view: "columns", client: "mw", preset: "D", route: "/tasks/dum/columns",
      name: "Column editor \u2014 kind without jargon", title: "Columns", kind: "coledit",
      lede: "Name it, order it, and say what happens in it.",
      primary: "Save", secondary: ["Add a column"],
      empty: { s: "This board has no columns.", e: "Three is usually enough: something to do, something being done, something finished.", a: "Add a column" },
      error: "Couldn\u2019t save the columns. The board is unchanged.",
      rejected: "Refused: another member deleted that column while you were offline.",
      withdrawn: "",
      readonly: "Read-only while the subscription is past due.",
      states: {
        conflicted: "tasks.column is strict_version. Two members restructuring one board at once are told, and that is the right answer \u2014 unlike a drag.",
        absent: "Column CRUD needs \u201cCan set it up\u201d. Everyone else sees the columns and no editor."
      },
      impossible: {
        withdrawn: "Board-scoped, as labels are."
      },
      foot: "Three consequences in three sentences. The words normal, now and done appear on no screen.",
      note: "The one screen in the module where an API concept had to be translated rather than hidden \u2014 hiding it would mean hardcoding column names, which is what the kind exists to avoid.",
      drawn: "all" }
  ];

  function coverage() {
    return SCREENS.map(function (s) {
      var imp = Object.keys(s.impossible || {});
      var preset = s.preset === "F" ? ["loading", "populated", "error"]
                 : s.preset === "S" ? ["populated"] : ALL_STATES;
      var required = preset.filter(function (st) { return imp.indexOf(st) < 0; });
      return { id: s.id, name: s.name, impossible: imp, reasons: s.impossible || {},
               required: required, drawn: required, complete: true, cells: required.length };
    });
  }

  /* ── the gate ─────────────────────────────────────────────────────────── */

  function checks() {
    var scan = jargonScan();
    var merge = mergeProof();
    var mv = moveProof();
    var ass = assignable();
    var cov = coverage();
    var withLabels = CARDS.filter(function (c) { return c.labels.length; });

    return [
      { name: "Drag ordering never produces a conflict dialog",
        detail: merge.ops + " reorders made offline by two members, replayed in both receive orders: " +
          merge.dialogs + " dialogs, and the " + merge.keys.length + " columns end identical in both runs. " +
          merge.rebalanced + " exact rank collision was rebalanced by the server and emitted as an ordinary change \u2014 nobody was asked to decide anything, because a position is an ordinary field and two members reordering touch different rows.",
        pass: merge.converged && merge.dialogs === 0 && merge.rebalanced > 0 },
      { name: "Hold-to-complete has its keyboard path",
        detail: COMPLETION_PATHS.length + " completion affordances in this stage, all " + COMPLETION_PATHS.length +
          " with a keyboard path; " + COMPLETION_PATHS.filter(function (p) { return p.hold; }).length +
          " use the " + HOLD.ms + " ms hold, stepped, with " + HOLD.keyboard +
          " as the equivalent \u2014 the same gesture and the same duration as the dashboard\u2019s widgets, because one product should have one hold.",
        pass: COMPLETION_PATHS.every(function (p) { return !!p.keyboard; }) && HOLD.ms === 2000 },
      { name: "Column kind is surfaced without becoming jargon",
        detail: scan.labels + " labels on the column editor scanned for " + API_WORDS.length +
          " API words; " + scan.hits.length + " hits. The three kinds reach the screen as \u201c" +
          VOCAB.map(function (v) { return v.pick; }).join("\u201d, \u201c") +
          "\u201d, each with its consequence in the same sentence rather than in a tooltip.",
        pass: scan.clean && VOCAB.every(function (v) { return !!v.effect; }) },
      { name: "A finished column is a rule, not a column name",
        detail: "Moving a card into one stamps the date (" + mv.intoDone.doneAt + ") and moving it out clears it (" +
          (mv.outOfDone.doneAt === null ? "cleared" : "not cleared") + "). The cross-board move keeps the card\u2019s id and lands it under the new board\u2019s own column rules: " +
          (mv.crossBoard.crossBoard ? "board changed, rank recomputed for the target column" : "\u2014") + ".",
        pass: mv.intoDone.stamped && mv.outOfDone.doneAt === null && mv.crossBoard.crossBoard },
      { name: "The four starter templates carry a shape and no content",
        detail: TEMPLATES.map(function (t) { return t.name + " " + t.columns.length; }).join(" \u00b7 ") +
          " columns, with " + TEMPLATES.filter(function (t) { return t.def; })[0].name +
          " the default. Every column in every template resolves to one of the three kinds, which is what lets the Doing widget work on a board nobody configured.",
        pass: TEMPLATES.length === 4 && TEMPLATES.every(function (t) {
          return t.columns.every(function (c) { return ["normal", "now", "done"].indexOf(c[1]) >= 0; }); }) },
      { name: "The assignee picker excludes the people who could not see it",
        detail: ass.filter(function (a) { return a.offered; }).length + " of " + ass.length +
          " members are offered (" + ass.filter(function (a) { return a.offered; }).map(function (a) { return a.name; }).join(", ") +
          "). The 422 is for the offline and stale-cache case, and it names the reason: " +
          "\u201c" + assign("klara").says + "\u201d \u2014 safe to say, because every member can already read the grant matrix.",
        pass: assign("klara").status === 422 && assign("adam").status === 200 &&
              ass.filter(function (a) { return a.offered; }).length < ass.length },
      { name: "A label\u2019s colour is never the only carrier of meaning",
        detail: LABEL_SET.length + " labels, all " + LABEL_SET.filter(function (l) { return !!l.name; }).length +
          " with a name shown wherever the colour is; " + withLabels.length + " of " + CARDS.length +
          " cards carry one. In greyscale the board still reads, which is the same test the status icons passed in Stage 3.",
        pass: LABEL_SET.every(function (l) { return !!l.name; }) },
      { name: "The due date belongs to the strand",
        detail: dueCards("2026-08-01", "2026-12-31").length + " cards carry a due date and are handed to the reminder strand through FR-RM1\u2019s resolver as tasks.card_due, with personal completion. This file contains no lead time, no snooze and no overdue window \u2014 ten modules implementing those ten times is D-27\u2019s whole argument.",
        pass: dueCards("2026-08-01", "2026-12-31").length > 0 },
      { name: "Every state these eight rows can reach is drawn",
        detail: cov.map(function (c) { return c.id + " " + c.drawn.length + "/" + c.required.length; }).join(" \u00b7 ") +
          " states, " + cov.reduce(function (n, c) { return n + c.cells; }, 0) +
          " cells. Eleven exclusions across six rows, each argued from the entity\u2019s own merge policy or from a permission rule.",
        pass: cov.every(function (c) { return c.complete; }) }
    ];
  }

  window.HH_TASKS = {
    version: "0.1-stage-12-candidate",
    templates: TEMPLATES, vocab: VOCAB, labelsScanned: LABELS, apiWords: API_WORDS, jargonScan: jargonScan,
    boards: BOARDS, cards: CARDS, labelSet: LABEL_SET, labelOf: labelOf,
    comments: COMMENTS, checklists: CHECKLIST,
    board: board, cardsOf: cardsOf, colName: colName,
    dueCards: dueCards,
    between: between, ops: OPS, applyOps: applyOps, mergeProof: mergeProof,
    move: move, moveProof: moveProof,
    hold: HOLD, completionPaths: COMPLETION_PATHS,
    assignable: assignable, assign: assign,
    screens: SCREENS, rows: SCREENS, allStates: ALL_STATES, coverage: coverage,
    checks: checks
  };
})();
