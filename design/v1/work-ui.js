/* The inner work screens, live in the prototype shell.
   Tasks: one card with its checklist and comments, moving a card between boards, the board's
   labels and columns, a new board from a template (C-16 … C-22). Reminders: what you are told
   about, snoozing one occurrence, the cancellation window (C-13, C-14, D-34). Documents: the
   tree, storage, and the slug paths that resolve to the library's own screens (C-28 … C-35).
   Card state goes through the board's own overlay (taskOv), so the board and the card agree. */
(function () {
  function view(self, seg, query, hash, wide) {
    var a0 = seg[0] || "";
    if (a0 === "tasks") return tasks(self, seg, hash, wide);
    if (a0 === "reminders") return reminders(self, seg, hash, wide);
    if (a0 === "documents") return documents(self, seg, hash, wide);
    return null;
  }

  /* ═══ Tasks ═══ */
  function tasks(self, seg, hash, wide) {
    var T = window.HH_TASKS; if (!T) return null;
    var K = window.HH_KIT(self), L = K.L, s = self.state, me = s.member;
    var canW = K.at("tasks", "contribute") && !K.ro, canM = K.at("tasks", "manage") && !K.ro;
    var P = { title: "", blocks: [], back: "/tasks" }, B = P.blocks, push = function (x) { if (x) B.push(x); };
    var boardObj = function (id) { return T.boards.filter(function (b) { return b.id === id; })[0]; };
    var bump = function () { self.forceUpdate(); };

    /* C-17 a new board from a template */
    if (seg[1] === "new" && !seg[2]) {
      P.title = L("Start a board", "Nov\u00e1 tabule");
      var tpl = K.get("tk_tpl", (T.templates.filter(function (t) { return t.def; })[0] || T.templates[0]).id);
      push(K.bound("tk_bname", { label: L("Name", "N\u00e1zev"), placeholder: L("e.g. Kitchen renovation", "nap\u0159. Rekonstrukce kuchyn\u011b"), err: K.get("tk_berr", "") }));
      push(K.label(L("Columns to start with", "Sloupce na za\u010d\u00e1tek")));
      push(K.cards(T.templates.map(function (t) {
        return { title: t.name, sub: t.columns.map(function (c) { return c[0]; }).join(" \u2192 "), meta: t.why, on: t.id === tpl, pick: function () { K.put({ tk_tpl: t.id }); } };
      })));
      push(K.note(L("Columns can be renamed, added and reordered later. Nothing here is permanent.", "Sloupce jde pozd\u011bji p\u0159ejmenovat, p\u0159idat i p\u0159euspo\u0159\u00e1dat."), "muted"));
      push(K.acts([K.btn(L("Create board", "Vytvo\u0159it tabuli"), "primary", function () {
        var n = String(K.get("tk_bname", "")).trim();
        if (!n) return K.put({ tk_berr: L("Give it a name.", "Dejte j\u00ed n\u00e1zev.") });
        var t = T.templates.filter(function (x) { return x.id === tpl; })[0];
        var id = n.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "board";
        while (boardObj(id)) id += "-2";
        T.boards.push({ id: id, name: n, template: t.id, icon: "board", columns: t.columns.map(function (c, i) { return { id: id + "-c" + i, name: c[0], kind: c[1] }; }) });
        K.put({ tk_bname: "", tk_berr: "" }, { route: "/tasks/" + id });
        K.toast(L(n + " is ready", n + " je p\u0159ipraven\u00e1"));
      }, !canW)]));
      return K.page(P);
    }

    var b = boardObj(seg[1]); if (!b) return null;
    P.back = "/tasks/" + b.id;

    /* C-18 labels */
    if (seg[2] === "labels") {
      P.title = L("Labels", "\u0160t\u00edtky"); P.sub = b.name;
      var palette = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"];
      var all = self.taskLabelSet ? self.taskLabelSet() : T.labelSet;
      var used = function (id) { var n = 0; T.boards.forEach(function (x) { self.taskAllCards(x.id).forEach(function (c) { if ((c.labels || []).indexOf(id) >= 0) n++; }); }); return n; };
      var ed = K.get("tk_led", "");
      push(K.note(L("A label always shows its name. Colour helps you scan; it never carries the meaning on its own.", "\u0160t\u00edtek v\u017edy ukazuje n\u00e1zev. Barva pom\u00e1h\u00e1, ale v\u00fdznam nenese sama."), "muted"));
      push(K.rows(all.map(function (l) {
        var n = used(l.id);
        if (ed === l.id) return null;
        return K.row({ dot: true, dotInk: "var(" + l.colour + ")", title: l.name, sub: n + (n === 1 ? L(" card", " karta") : L(" cards", " karet")),
          act: canW ? L("Edit", "Upravit") : "", onAct: function () { K.put({ tk_led: l.id, tk_lname: l.name, tk_lcol: l.colour }); } });
      })));
      if (ed) {
        var cur = all.filter(function (l) { return l.id === ed; })[0];
        push(K.label(L("Edit label", "Upravit \u0161t\u00edtek")));
        push(K.bound("tk_lname", { label: L("Name", "N\u00e1zev") }));
        push(K.chips(L("Colour", "Barva"), palette.map(function (c, i) { return K.chip(L("Colour ", "Barva ") + (i + 1), K.get("tk_lcol", cur.colour) === c, function () { K.put({ tk_lcol: c }); }); })));
        push(K.acts([K.btn(L("Save", "Ulo\u017eit"), "primary", function () { cur.name = String(K.get("tk_lname", cur.name)).trim() || cur.name; cur.colour = K.get("tk_lcol", cur.colour); K.put({ tk_led: "" }); }),
          K.btn(L("Delete label", "Smazat \u0161t\u00edtek"), "danger-ghost", function () {
            var i = T.labelSet.indexOf(cur); if (i >= 0) T.labelSet.splice(i, 1);
            var mine = (s.taskLabelsNew || []).filter(function (x) { return x.id !== cur.id; });
            K.put({ tk_led: "" }, { taskLabelsNew: mine });
            K.toast(L("Deleted \u00b7 removed from " + used(cur.id) + " cards", "Smaz\u00e1no"), function () { if (i >= 0) T.labelSet.splice(i, 0, cur); bump(); });
          }), K.btn(L("Cancel", "Zru\u0161it"), "", function () { K.put({ tk_led: "" }); })]));
      } else if (canW) {
        push(K.bound("tk_lnew", { label: L("New label", "Nov\u00fd \u0161t\u00edtek"), placeholder: L("e.g. Garden", "nap\u0159. Zahrada") }));
        push(K.acts([K.btn(L("Add label", "P\u0159idat"), "", function () {
          var n = String(K.get("tk_lnew", "")).trim(); if (!n) return;
          T.labelSet.push({ id: "l-" + Date.now().toString(36), name: n, colour: palette[T.labelSet.length % palette.length] });
          K.put({ tk_lnew: "" });
        })]));
      }
      return K.page(P);
    }

    /* C-22 columns */
    if (seg[2] === "columns") {
      P.title = L("Columns", "Sloupce"); P.sub = b.name;
      var KIND = { normal: L("just a column", "jen sloupec"), now: L("we are on it", "pracujeme na tom"), done: L("it is finished", "je hotovo") };
      var KSAYS = { normal: L("Cards here are waiting.", "Karty tu \u010dekaj\u00ed."), now: L("Cards here show on Home as in progress.", "Karty tu se na Dom\u016f ukazuj\u00ed jako rozpracovan\u00e9."),
        done: L("Moving a card here marks it done and stamps the day.", "P\u0159esunut\u00edm sem se karta ozna\u010d\u00ed jako hotov\u00e1.") };
      var n = function (c) { return self.taskCardsIn(b.id, c.id).length; };
      b.columns.forEach(function (c, i) {
        push(K.label((i + 1) + " \u00b7 " + c.name));
        push(K.field({ label: "", value: c.name, off: !canM, set: function (v) { c.name = v; bump(); } }));
        push(K.chips("", ["normal", "now", "done"].map(function (k) { return K.chip(KIND[k], c.kind === k, canM ? function () { c.kind = k; bump(); } : function () {}); }), KSAYS[c.kind] + " " + n(c) + L(" cards in it.", " karet.")));
        push(K.acts([canM && i > 0 ? K.btn(L("Move left", "Doleva"), "", function () { b.columns.splice(i - 1, 0, b.columns.splice(i, 1)[0]); bump(); }) : null,
          canM && i < b.columns.length - 1 ? K.btn(L("Move right", "Doprava"), "", function () { b.columns.splice(i + 1, 0, b.columns.splice(i, 1)[0]); bump(); }) : null,
          canM && b.columns.length > 1 ? K.btn(n(c) ? L("Delete \u00b7 " + n(c) + " cards move left", "Smazat \u00b7 karty se p\u0159esunou") : L("Delete", "Smazat"), "danger-ghost", function () {
            var to = b.columns[i === 0 ? 1 : i - 1];
            self.taskCardsIn(b.id, c.id).forEach(function (x) { self.taskPatch(x.id, { col: to.id }); });
            b.columns.splice(i, 1); bump(); K.toast(L("Column deleted", "Sloupec smaz\u00e1n"));
          }) : null]));
      });
      if (!b.columns.some(function (c) { return c.kind === "done"; })) push(K.note(L("No column is \u201cfinished\u201d, so nothing on this board ever counts as done. That is allowed.", "\u017d\u00e1dn\u00fd sloupec nen\u00ed \u201ehotovo\u201c, tak\u017ee nic nebude hotov\u00e9. To je v po\u0159\u00e1dku."), "boxWarn"));
      if (canM) push(K.acts([K.btn(L("Add a column", "P\u0159idat sloupec"), "", function () { b.columns.push({ id: b.id + "-n" + Date.now().toString(36), name: L("New column", "Nov\u00fd sloupec"), kind: "normal" }); bump(); }),
        K.btn(L("Back to the board", "Zp\u011bt na tabuli"), "primary", K.go("/tasks/" + b.id))]));
      else push(K.note(L("Changing columns needs \u201cCan set it up\u201d on Tasks.", "Zm\u011bna sloupc\u016f vy\u017eaduje \u201eM\u016f\u017ee nastavit\u201c."), "muted"));
      return K.page(P);
    }

    if (seg[2] !== "cards" || !seg[3]) return null;
    var c = self.taskCard(seg[3]); if (!c) return null;
    var cb = boardObj(c.board) || b;
    P.back = "/tasks/" + cb.id;

    /* C-21 move, including to another board */
    if (seg[4] === "move") {
      P.title = L("Move this card", "P\u0159esunout kartu"); P.sub = c.title; P.back = "/tasks/" + cb.id + "/cards/" + c.id;
      T.boards.forEach(function (x) {
        push(K.label(x.name + (x.id === c.board ? L(" \u00b7 this board", " \u00b7 tato tabule") : "")));
        push(K.rows(x.columns.map(function (col) {
          var here = x.id === c.board && col.id === c.col;
          return K.row({ title: col.name, sub: col.kind === "done" ? L("marks it done", "ozna\u010d\u00ed jako hotovou") : "", on: here, right: here ? L("here now", "te\u010f tady") : "", noChev: true,
            open: here || !canW ? null : function () {
              var prev = { board: c.board, col: c.col, doneAt: c.doneAt || "" };
              self.taskPatch(c.id, { board: x.id, col: col.id, doneAt: col.kind === "done" ? self.taskToday() : "" });
              self.taskOpenCol(x.id, col.id); self.go("/tasks/" + x.id);
              K.toast(L("Moved to " + x.name + " \u00b7 " + col.name, "P\u0159esunuto do " + x.name), function () { self.taskPatch(c.id, prev); self.go("/tasks/" + prev.board); });
            } });
        })));
      });
      push(K.note(L("Labels belong to the household, so they come along. The assignee stays if they can see Tasks.", "\u0160t\u00edtky pat\u0159\u00ed dom\u00e1cnosti, tak\u017ee jdou s kartou."), "muted"));
      return K.page(P);
    }

    /* C-16 / C-19 / C-20 the card */
    P.title = c.title; P.sub = cb.name + " \u00b7 " + (self.taskBoardObj(cb.id).columns.filter(function (k) { return k.id === c.col; })[0] || { name: "" }).name;
    var cl = T.checklists.filter(function (x) { return x.card === c.id; })[0];
    var syncCl = function () { if (cl) self.taskPatch(c.id, { checklist: [cl.items.filter(function (i) { return i[1]; }).length, cl.items.length] }); };
    if (hash === "c-19") push(K.note(L("The checklist is below. Ticking an item is one tap; it counts on the card face on the board.", "Kontroln\u00ed seznam je n\u00ed\u017ee."), "boxOk"));
    push(K.rows([K.check({ title: c.doneAt ? L("Done " + self.taskDueFact(c.doneAt), "Hotovo") : L("Mark as done", "Ozna\u010dit jako hotov\u00e9"), done: !!c.doneAt, noStrike: true,
      open: canW ? function () { self.taskToggleDone(c); } : null })]));
    push(K.bound("tk_title_" + c.id, { label: L("Title", "N\u00e1zev"), def: c.title, off: !canW }));
    push(K.label(L("Details", "Podrobnosti")));
    var members = (T.assignable ? T.assignable() : []);
    push(K.chips(L("Who", "Kdo"), [K.chip(L("Nobody", "Nikdo"), !c.assignee, canW ? function () { self.taskPatch(c.id, { assignee: "" }); } : function () {})].concat(members.map(function (m) {
      return m.offered ? K.chip(m.name, c.assignee === m.id, canW ? function () { self.taskPatch(c.id, { assignee: m.id }); } : function () {}) : null;
    })), L("Only people who can see Tasks can be given a card.", "Kartu lze p\u0159i\u0159adit jen tomu, kdo vid\u00ed \u00dakoly.")));
    var dq = self.taskDueQuick ? K.safe(function () { return self.taskDueQuick(c.due || "", function (d) { self.taskPatch(c.id, { due: d }); }); }, null) : null;
    push(K.field({ label: L("Due", "Term\u00edn"), type: "date", value: c.due || "", off: !canW, set: function (v) { self.taskPatch(c.id, { due: v }); },
      hint: c.due ? self.taskDueFact(c.due) + L(" \u00b7 reminds whoever it\u2019s assigned to", " \u00b7 p\u0159ipomene p\u0159i\u0159azen\u00e9mu") : L("No date, so no reminder.", "Bez data, bez p\u0159ipom\u00ednky.") }));
    var lset = self.taskLabelSet ? self.taskLabelSet() : T.labelSet;
    push(K.chips(L("Labels", "\u0160t\u00edtky"), lset.map(function (l) {
      var on = (c.labels || []).indexOf(l.id) >= 0;
      return K.chip((on ? "\u2713 " : "") + l.name, on, canW ? function () { var ls = (c.labels || []).slice(); if (on) ls.splice(ls.indexOf(l.id), 1); else ls.push(l.id); self.taskPatch(c.id, { labels: ls }); } : function () {});
    }).concat([K.chip(L("Manage labels", "Spravovat \u0161t\u00edtky"), false, K.go("/tasks/" + cb.id + "/labels"))])));
    push(K.bound("tk_body_" + c.id, { label: L("Notes", "Pozn\u00e1mky"), def: c.body || "", off: !canW, placeholder: L("Anything the next person needs to know", "Co pot\u0159ebuje v\u011bd\u011bt dal\u0161\u00ed") }));
    var tDraft = K.get("tk_title_" + c.id, c.title), bDraft = K.get("tk_body_" + c.id, c.body || "");
    if (canW && (tDraft !== c.title || bDraft !== (c.body || ""))) push(K.acts([K.btn(L("Save changes", "Ulo\u017eit zm\u011bny"), "primary", function () { self.taskPatch(c.id, { title: String(tDraft).trim() || c.title, body: bDraft }); K.toast(L("Saved", "Ulo\u017eeno")); })]));

    /* checklist */
    var done = cl ? cl.items.filter(function (i) { return i[1]; }).length : 0;
    push(K.label(L("Checklist", "Kontroln\u00ed seznam") + (cl ? " \u00b7 " + done + L(" of ", " z ") + cl.items.length : "")));
    if (cl) push(K.rows(cl.items.map(function (it, i) {
      return K.check({ title: it[0], done: it[1], open: canW ? function () { it[1] = !it[1]; syncCl(); } : null,
        act: canW ? L("Remove", "Odebrat") : "", actTone: "danger", onAct: function () { var rm = cl.items.splice(i, 1)[0]; syncCl(); K.toast(L("Removed", "Odebr\u00e1no"), function () { cl.items.splice(i, 0, rm); syncCl(); }); } });
    })));
    if (canW) {
      push(K.bound("tk_cl_" + c.id, { label: "", placeholder: L("Add an item", "P\u0159idat polo\u017eku") }));
      push(K.acts([K.btn(L("Add", "P\u0159idat"), "", function () {
        var t = String(K.get("tk_cl_" + c.id, "")).trim(); if (!t) return;
        if (!cl) { cl = { card: c.id, items: [] }; T.checklists.push(cl); }
        cl.items.push([t, false]); var o = {}; o["tk_cl_" + c.id] = ""; K.put(o); syncCl();
      })]));
    }

    /* comments (FR-TA9) */
    var cm = T.comments.filter(function (x) { return x.card === c.id; });
    push(K.label(L("Comments", "Koment\u00e1\u0159e") + (cm.length ? " \u00b7 " + cm.length : "")));
    if (!cm.length) push(K.note(L("No comments yet.", "Zat\u00edm bez koment\u00e1\u0159\u016f."), "muted"));
    push(K.rows(cm.map(function (x) { return K.row({ title: x.text, sub: K.nameOf(x.who) + " \u00b7 " + x.at }); })));
    if (canW) {
      var draft = String(K.get("tk_cm_" + c.id, ""));
      var ment = (draft.match(/@([\p{L}]+)/gu) || []).map(function (m) { return m.slice(1).toLowerCase(); });
      var blind = members.filter(function (m) { return !m.offered && ment.some(function (x) { return m.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").indexOf(x.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) === 0; }); });
      push(K.bound("tk_cm_" + c.id, { label: "", placeholder: L("Write a comment \u2014 @name tells them", "Napi\u0161te koment\u00e1\u0159 \u2014 @jm\u00e9no dotyčn\u00e9ho upozorn\u00ed"),
        hint: blind.length ? L(blind.map(function (m) { return m.name; }).join(", ") + " can\u2019t see Tasks, so they won\u2019t be told and the name stays plain text.", blind.map(function (m) { return m.name; }).join(", ") + " \u00dakoly nevid\u00ed, tak\u017ee se nic nedozv\u00ed.") : "" }));
      push(K.acts([K.btn(L("Post", "Odeslat"), "primary", function () {
        var t = draft.trim(); if (!t) return;
        T.comments.push({ card: c.id, who: me, at: L("just now", "pr\u00e1v\u011b te\u010f"), text: t, mentions: ment });
        self.taskPatch(c.id, { comments: cm.length + 1 }); var o = {}; o["tk_cm_" + c.id] = ""; K.put(o);
      }, !draft.trim())]));
    }
    push(K.acts([canW ? K.btn(L("Move", "P\u0159esunout"), "", K.go("/tasks/" + cb.id + "/cards/" + c.id + "/move")) : null,
      canW ? K.btn(L("Delete card", "Smazat kartu"), "danger-ghost", function () {
        self.taskPatch(c.id, { gone: true }); self.go("/tasks/" + cb.id);
        K.toast(L("Card deleted", "Karta smaz\u00e1na"), function () { self.taskPatch(c.id, { gone: false }); });
      }) : null]));
    if (!canW) push(K.note(L("You can read this board. Changing it needs \u201cCan add and edit\u201d.", "Tabuli m\u016f\u017eete \u010d\u00edst."), "muted"));
    return K.page(P);
  }

  /* ═══ Reminders ═══ */
  function reminders(self, seg, hash, wide) {
    var R = window.HH_REMINDERS; if (!R) return null;
    var sub = seg[1] === "subscriptions", snz = !seg[1] && hash === "c-14", cw = !seg[1] && hash === "finance.cancellation_window";
    if (!sub && !snz && !cw) return null;
    var K = window.HH_KIT(self), L = K.L, s = self.state, me = s.member;
    var P = { title: "", blocks: [], back: "/reminders" }, B = P.blocks, push = function (x) { if (x) B.push(x); };

    if (sub) {
      P.title = L("What you are told about", "O \u010dem v\u00e1s informujeme");
      var ov = K.get("rm_subs", {}), open = K.get("rm_open", "");
      var rows0 = K.safe(function () { return R.subscriptionsFor(me); }, []).filter(function (r) { return r.offered; });
      var eff = function (r) { var o = ov[r.key] || {}; return { days: o.days != null ? o.days : r.days, channel: o.channel || r.channel, off: !!o.off }; };
      var leadW = function (d) { var h = R.leadSet.filter(function (x) { return x[1] === d; })[0]; return h ? h[2] : d + L(" days before", " dn\u00ed p\u0159edem"); };
      var setO = function (k, p) { var o = Object.assign({}, ov); o[k] = Object.assign({}, o[k] || {}, p); K.put({ rm_subs: o }); };
      var changed = rows0.filter(function (r) { var e = eff(r); return e.off || e.days !== r.defaultDays || e.channel !== r.defaultChannel; });
      push(K.note(L("One line per kind of date. Your lead time is yours: someone else setting a week doesn\u2019t change your three days.", "Jeden \u0159\u00e1dek na druh term\u00ednu. Va\u0161e p\u0159edstih je jen v\u00e1\u0161."), "muted"));
      var section = function (title, list) {
        if (!list.length) return;
        push(K.label(title));
        list.forEach(function (r) {
          var e = eff(r), isOpen = open === r.key;
          push(K.rows([K.row({ title: r.label, sub: K.F.moduleName(r.module, s.locale) + " \u00b7 " + (r.scope === "household" ? L("done once for everyone", "hotovo jednou za v\u0161echny") : L("done by you", "hotovo za v\u00e1s")),
            right: e.off ? L("Off", "Vypnuto") : leadW(e.days), rightSub: e.off ? "" : e.channel === "email" ? L("by email", "e-mailem") : e.channel === "none" ? L("list only", "jen v seznamu") : L("push", "ozn\u00e1men\u00ed"),
            tone: e.off ? "muted" : "", on: isOpen, open: function () { K.put({ rm_open: isOpen ? "" : r.key }); } })]));
          if (isOpen) {
            push(K.chips(L("How early", "Jak brzy"), R.leadSet.map(function (x) { return K.chip(x[2], !e.off && e.days === x[1], function () { setO(r.key, { days: x[1], off: false }); }); })));
            push(K.field({ label: L("Or a number of days", "Nebo po\u010det dn\u00ed"), mode: "numeric", narrow: true, value: String(e.days), suffix: L("days", "dn\u00ed"),
              set: function (v) { var n = parseInt(v, 10); if (!isNaN(n) && n >= 0 && n <= 365) setO(r.key, { days: n, off: false }); },
              hint: r.defaultDays > 90 ? L("The default for this kind is longer than any preset, which is why a number is here.", "V\u00fdchoz\u00ed hodnota je del\u0161\u00ed ne\u017e p\u0159edvolby.") : "" }));
            push(K.chips(L("How", "Jak"), [["push", L("Push", "Ozn\u00e1men\u00ed")], ["email", L("Email", "E-mail")], ["none", L("Only in the list", "Jen v seznamu")]].map(function (x) {
              return K.chip(x[1], !e.off && e.channel === x[0], function () { setO(r.key, { channel: x[0], off: false }); });
            })));
            push(K.acts([K.btn(e.off ? L("Turn back on", "Znovu zapnout") : L("Don\u2019t tell me about these", "Tohle mi ne\u0159\u00edkejte"), e.off ? "" : "danger-ghost", function () { setO(r.key, { off: !e.off }); }),
              K.btn(L("Back to the default \u00b7 ", "V\u00fdchoz\u00ed \u00b7 ") + leadW(r.defaultDays), "", function () { var o = Object.assign({}, ov); delete o[r.key]; K.put({ rm_subs: o }); })]));
          }
        });
      };
      section(L("Changed from the default", "Zm\u011bn\u011bno oproti v\u00fdchoz\u00edmu") + " \u00b7 " + changed.length, changed);
      section(L("On the default", "V\u00fdchoz\u00ed"), rows0.filter(function (r) { return changed.indexOf(r) < 0; }));
      push(K.note(L("Kinds from modules you can\u2019t see aren\u2019t listed. Turning one off here keeps it in the Reminders list; it just stops reaching your phone.", "Druhy z modul\u016f, kter\u00e9 nevid\u00edte, tu nejsou."), "muted"));
      return K.page(P);
    }

    if (snz) {
      var ag = K.safe(function () { return R.agendaFor(me, R.today); }, { blocks: [] });
      var occ = []; (ag.blocks || []).forEach(function (b) { occ = occ.concat(b.rows || []); });
      var pick = K.get("rm_snzId", occ[0] ? occ[0].id : ""), o = occ.filter(function (x) { return x.id === pick; })[0] || occ[0];
      var until = K.get("rm_snzUntil", {})[o ? o.id : ""];
      P.title = L("Not now", "Te\u010f ne");
      if (!o) { push(K.empty(L("Nothing to snooze.", "Nen\u00ed co odlo\u017eit."), "", L("Back", "Zp\u011bt"), K.go("/reminders"))); return K.page(P); }
      push(K.hero({ small: true, kicker: o.moduleName + " \u00b7 " + o.whenLong, big: o.title, sub: o.meta }));
      if (occ.length > 1) push(K.chips(L("Which one", "Kter\u00fd"), occ.slice(0, 6).map(function (x) { return K.chip(x.title, x.id === o.id, function () { K.put({ rm_snzId: x.id }); }); })));
      var add = function (d) { return R.addDays(R.today, d); };
      var setU = function (d) { var m = Object.assign({}, K.get("rm_snzUntil", {})); if (d) m[o.id] = d; else delete m[o.id]; K.put({ rm_snzUntil: m }); };
      if (until) {
        push(K.note(L("Snoozed until " + R.fmtLong(until) + " \u2014 for you only. It stays on everyone else\u2019s list, and it isn\u2019t done for anybody.", "Odlo\u017eeno do " + R.fmtLong(until) + " \u2014 jen pro v\u00e1s. Ostatn\u00ed to v seznamu maj\u00ed d\u00e1l."), "boxOk"));
        push(K.acts([K.btn(L("Undo snooze", "Zru\u0161it odlo\u017een\u00ed"), "", function () { setU(""); }), K.btn(L("Back to the list", "Zp\u011bt na seznam"), "primary", K.go("/reminders"))]));
      } else {
        push(K.rows([[1, L("Tomorrow", "Z\u00edtra")], [3, L("In three days", "Za t\u0159i dny")], [7, L("Next week", "P\u0159\u00ed\u0161t\u00ed t\u00fdden")]].map(function (x) {
          return K.row({ title: x[1], right: R.fmt(add(x[0])), open: function () { setU(add(x[0])); } });
        })));
        push(K.field({ label: L("Or pick a day", "Nebo vyberte den"), type: "date", value: "", set: function (v) { if (v && v > R.today) setU(v); } }));
        if (o.scope === "household") push(K.note(L("This one is shared. Snoozing moves it off your list only; when anybody completes it, it leaves everyone\u2019s.", "Tento je sd\u00edlen\u00fd. Odlo\u017een\u00ed plat\u00ed jen pro v\u00e1s."), "muted"));
      }
      return K.page(P);
    }

    /* D-34 the cancellation window */
    P.title = L("Netflix \u2014 last day to cancel", "Netflix \u2014 posledn\u00ed den na zru\u0161en\u00ed");
    var st = K.get("rm_cw", "");
    push(K.hero({ small: true, kicker: L("Finance \u00b7 recurring", "Finance \u00b7 pravideln\u00e9"), big: L("Cancel by 20 September", "Zru\u0161it do 20. z\u00e1\u0159\u00ed"), sub: L("It renews on 4 October for 12 months. The contract asks for 14 days\u2019 notice, so after the 20th it runs another year.", "Obnov\u00ed se 4. \u0159\u00edjna na 12 m\u011bs\u00edc\u016f. Smlouva chce 14 dn\u00ed v\u00fdpov\u011bdi.") ,
      stats: [K.stat(L("Renews", "Obnova"), "4 Oct"), K.stat(L("Notice", "V\u00fdpov\u011b\u010f"), L("14 days", "14 dn\u00ed")), K.stat(L("Costs", "Stoj\u00ed"), "3 588 K\u010d / " + L("year", "rok"))] }));
    if (st === "keep") push(K.note(L("Kept. You won\u2019t be reminded about this window again; the renewal itself still shows on 4 October.", "Ponech\u00e1no. Na toto okno u\u017e nebudeme upozor\u0148ovat."), "boxOk", L("Undo", "Zp\u011bt"), function () { K.put({ rm_cw: "" }); }));
    else if (st === "cancelled") push(K.note(L("Marked as cancelled. Household can\u2019t cancel it for you \u2014 do it with Netflix, then this stops the renewal from being expected in Finance.", "Ozna\u010deno jako zru\u0161en\u00e9. Zru\u0161it mus\u00edte u Netflixu."), "boxOk", L("Undo", "Zp\u011bt"), function () { K.put({ rm_cw: "" }); }));
    else if (st === "later") push(K.note(L("We\u2019ll remind you again on 17 September.", "P\u0159ipomeneme znovu 17. z\u00e1\u0159\u00ed."), "box", L("Undo", "Zp\u011bt"), function () { K.put({ rm_cw: "" }); }));
    else push(K.acts([K.btn(L("I\u2019ve cancelled it", "Zru\u0161il(a) jsem"), "primary", function () { K.put({ rm_cw: "cancelled" }); }),
      K.btn(L("Keep it", "Ponechat"), "", function () { K.put({ rm_cw: "keep" }); }), K.btn(L("Remind me in 3 days", "P\u0159ipomenout za 3 dny"), "", function () { K.put({ rm_cw: "later" }); })]));
    push(K.acts([K.btn(L("Open it in Finance", "Otev\u0159\u00edt ve Financ\u00edch"), "", K.go("/finance/recurring"), !K.at("finance", "view"))]));
    return K.page(P);
  }

  /* ═══ Documents ═══ */
  function documents(self, seg, hash, wide) {
    var D = window.HH_DOCS; if (!D) return null;
    var K = window.HH_KIT(self), L = K.L, s = self.state, me = s.member;
    var redirect = function (patch) {
      if (self._xRedir === s.route) return;
      self._xRedir = s.route;
      setTimeout(function () { self._xRedir = null; self.setState(patch); if (patch.__add && self.docOpenAdd) self.docOpenAdd(); }, 0);
      return K.page({ title: L("Opening\u2026", "Otev\u00edr\u00e1m\u2026"), blocks: [K.note(L("Opening\u2026", "Otev\u00edr\u00e1m\u2026"), "muted")] });
    };
    var P = { title: "", blocks: [], back: "/documents" }, B = P.blocks, push = function (x) { if (x) B.push(x); };
    var visible = K.safe(function () { return D.visibleTo(me); }, D.docs).filter(function (d) { return !(K.get("doc_gone", [])).length || K.get("doc_gone", []).indexOf(d.id) < 0; });
    var fold = function (t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); };

    if (seg[1] === "upload" && !seg[2]) return redirect({ route: "/documents", sheet: false, __add: true });
    if (seg[1] === "storage" && !seg[2]) {
      var t = D.totals(), cap = 20;
      P.title = L("What Documents is using", "Co zab\u00edraj\u00ed Dokumenty");
      push(K.hero({ kicker: L("Documents", "Dokumenty"), big: t.originalsGB.toFixed(2) + " GB", sub: L("originals, plus " + t.derivedGB.toFixed(2) + " GB of previews and thumbnails (" + Math.round(t.overheadPct) + " % on top)", "origin\u00e1l\u016f a " + t.derivedGB.toFixed(2) + " GB n\u00e1hled\u016f"),
        stats: [K.stat(L("Files", "Soubory"), String(t.count)), K.stat(L("Household total", "Celkem v dom\u00e1cnosti"), "19,4 GB"), K.stat(L("Allowance", "Limit"), cap + " GB")] }));
      var by = K.get("doc_by", "folder");
      push(K.chips(L("Split by", "Rozd\u011blit podle"), [["folder", L("Folder", "Slo\u017eka")], ["type", L("Type", "Typ")], ["member", L("Who added it", "Kdo p\u0159idal")]].map(function (x) { return K.chip(x[1], by === x[0], function () { K.put({ doc_by: x[0] }); }); })));
      push(K.bars(D.splitBy(by).map(function (x) { return { name: x.name, right: D.mb ? D.mb(x.bytes) : Math.round(x.bytes) + " MB", left: x.n + L(" files", " soubor\u016f"), v: x.bytes }; })));
      push(K.label(L("Largest files", "Nejv\u011bt\u0161\u00ed soubory")));
      push(K.rows(D.largest(6).map(function (x) {
        var d = D.docs.filter(function (y) { return y.title === x.title; })[0];
        return K.row({ title: x.title, sub: x.folder + " \u00b7 " + x.by, right: Math.round(x.bytes) + " MB", open: d ? K.go("/documents/" + d.id) : null });
      })));
      push(K.note(L("Over the allowance nothing is deleted and nothing stops opening \u2014 new uploads wait until there\u2019s room or the next block is added.", "Nad limit se nic nema\u017ee ani neblokuje \u010dten\u00ed."), "muted"));
      push(K.acts([K.btn(L("Household storage", "\u00dalo\u017ei\u0161t\u011b dom\u00e1cnosti"), "", K.go("/households/" + (s.household === "hh-tilcer" ? "tilcerovi" : "chata") + "/settings/storage"), !K.at("admin", "view"))]));
      return K.page(P);
    }
    if (seg[1] !== "shared" && seg[1] !== "private") return null;
    var folders = D.folders.filter(function (f) { return seg[1] === "shared" ? f.root === "shared" : f.root === "private:" + me; });
    var fseg = seg[2] || "", folder = folders.filter(function (f) { return f.id === fseg || fold(f.name) === fseg; })[0];

    /* a slug path to one document resolves to the library's own screen for it */
    if (seg[3] && folder) {
      var last = seg[3], inF = visible.filter(function (d) { return d.folder === folder.id; });
      var d = inF.filter(function (x) { return x.id === "d-" + last || x.id.indexOf(last) >= 0 || fold(x.title).indexOf(last) === 0; })[0]
        || inF.filter(function (x) { return fold(x.title).indexOf(last.split("-")[0]) >= 0; })[0]
        || (last === "servisni-faktura" ? inF.filter(function (x) { return x.id === "d-servis-skoda"; })[0] : null);
      if (!d) return null;
      var patch = { route: "/documents/" + d.id, sheet: false };
      if (last === "servisni-faktura") patch.docSheet = { kind: "delete", ids: [d.id] };
      return redirect(patch);
    }
    if (fseg === "faktury" && hash !== "tree") {
      var bulk = {}; (D.bulkSelection || []).forEach(function (id) { bulk[id] = true; });
      if (!seg[3]) return redirect({ route: "/documents", docSelecting: true, docSel: bulk });
    }

    /* C-28 the tree */
    P.title = folder ? folder.name : seg[1] === "shared" ? L("Shared documents", "Sd\u00edlen\u00e9 dokumenty") : L("Only you", "Jen vy");
    P.back = folder ? "/documents/" + seg[1] : "/documents";
    push(K.chips("", [K.chip(L("Shared", "Sd\u00edlen\u00e9"), seg[1] === "shared", K.go("/documents/shared")), K.chip(L("Only you", "Jen vy"), seg[1] === "private", K.go("/documents/private"))]));
    if (!folder) {
      var loose = visible.filter(function (d) { return folders.every(function (f) { return f.id !== d.folder; }) && (seg[1] === "shared" ? d.root === "shared" : d.root === "private:" + me); });
      push(K.rows(folders.map(function (f) {
        var n = visible.filter(function (d) { return d.folder === f.id; }).length;
        return K.row({ lead: "\u25a2", title: f.name, sub: n + L(" files", " soubor\u016f"), open: K.go("/documents/" + seg[1] + "/" + fold(f.name) + "#tree") });
      })));
      if (!folders.length) push(K.empty(seg[1] === "private" ? L("Nothing private yet.", "Zat\u00edm nic soukrom\u00e9ho.") : L("No folders yet.", "Zat\u00edm \u017e\u00e1dn\u00e9 slo\u017eky."),
        seg[1] === "private" ? L("Files here are yours alone. Nobody else in the household can find them, search them or see that they exist.", "Soubory tady vid\u00edte jen vy.") : "", L("Add a file", "P\u0159idat soubor"), function () { self.go("/documents"); if (self.docOpenAdd) self.docOpenAdd(); }));
    } else {
      var files = visible.filter(function (d) { return d.folder === folder.id; });
      push(K.rows(files.map(function (d) {
        var ex = d.expires ? L("expires ", "plat\u00ed do ") + D.fmt(d.expires) : "";
        return K.row({ title: d.title, sub: [K.nameOf(d.by), Math.round(d.bytes) + " MB", ex].filter(Boolean).join(" \u00b7 "), badge: d.attachment === "pending" ? L("not arrived", "nedorazilo") : "", badgeTone: "offline", open: K.go("/documents/" + d.id) });
      })));
      if (!files.length) push(K.empty(L("This folder is empty.", "Slo\u017eka je pr\u00e1zdn\u00e1."), "", L("Add a file", "P\u0159idat soubor"), function () { self.go("/documents"); if (self.docOpenAdd) self.docOpenAdd(); }));
      push(K.acts([K.btn(L("Select several", "Vybrat v\u00edce"), "", function () { self.setState({ route: "/documents", docSelecting: true, docSel: {} }); }, !files.length)]));
    }
    push(K.acts([K.btn(L("Storage", "\u00dalo\u017ei\u0161t\u011b"), "", K.go("/documents/storage"))]));
    return K.page(P);
  }

  window.HH_WORK_VIEW = view;
})();
