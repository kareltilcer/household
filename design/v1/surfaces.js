/* Stage 21 — the module surfaces, moved into the shell.

   Stages 7–19 drew every screen inside their own artifact, where a cell is a measured
   drawing next to the argument for it. This file is what the plan actually promised:
   the same rows, read from the same module files, assembled as surfaces the shell can
   route to. Nothing here invents data. Every builder reads the module's own export —
   HH_TASKS, HH_GARDEN, HH_ASSETS and the rest — so a surface cannot drift from the
   stage that argued it, and a module whose file is missing degrades to a named absence
   rather than an empty screen.

   Shape returned by build():
     { sections: [{ label, rows: [row] }], note }
     row: { id, title, meta, right, tone, deep }
   Shape returned by detail():
     { title, sub, facts: [[k, v]], sections: [{ label, rows }], note }

   ctx: { member, household, client, route, locale, online, level } — level is the member's
        grant on the module, and route is what the two route-addressed builders branch on.
*/
(function () {
  "use strict";

  var TODAY = "2026-09-09";

  function has(o) { return !!o; }
  function get(name) { return window[name]; }

  /* Locale is a real switch, not a label: several module files carry cs and en on the
     same row, so the shell picks the field rather than translating at render time.
     Where a module holds one language only, that string is what a translator gets. */
  function pick(row, ctx, a, b) {
    var loc = (ctx && ctx.locale) || "en";
    if (!row) return "";
    if (loc === "cs" && row.cs) return row.cs;
    if (row[loc]) return row[loc];
    return row[a || "en"] || row[b || "cs"] || row.title || row.name || "";
  }

  function money(v, cur) {
    if (v === null || v === undefined) return "—";
    var n = Math.abs(v) / 100, sign = v < 0 ? "−" : "";
    var s = n.toFixed(2).replace(".", ",");
    s = s.replace(/\B(?=(\d{3})+(?!\d)(?=,))/g, "\u00a0");
    return sign + s + " " + (cur || "Kč");
  }

  function day(iso) {
    if (!iso) return "";
    var M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var p = String(iso).slice(0, 10).split("-");
    if (p.length < 3) return iso;
    return Number(p[2]) + " " + M[Number(p[1]) - 1];
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }

  function section(label, rows) { return { label: label, rows: (rows || []).filter(Boolean) }; }

  function row(id, title, meta, right, tone, deep) {
    return { id: id || "", title: title || "", meta: meta || "", right: right || "",
             tone: tone || "", deep: !!deep };
  }

  /* ── Tasks ─────────────────────────────────────────────────────────── */

  function tasks(ctx) {
    var T = get("HH_TASKS");
    if (!has(T)) return null;
    var board = T.boards[0];
    var secs = board.columns.map(function (col) {
      var cards = T.cardsOf(board.id, col.id) || [];
      return section(col.name + " · " + cards.length, cards.map(function (c) {
        var bits = [];
        if (c.labels && c.labels.length) bits.push(c.labels.join(", "));
        if (c.checklist && c.checklist[1]) bits.push(c.checklist[0] + "/" + c.checklist[1] + " done");
        if (c.comments) bits.push(c.comments + " comments");
        if (c.due) bits.push("due " + day(c.due));
        return row(c.id, c.title, bits.join(" · "), c.assignee || "", c.due && c.due < TODAY ? "danger" : "", true);
      }));
    });
    return { sections: secs, note: board.name + " · " + board.columns.length + " columns · a second board, " +
      (T.boards[1] ? T.boards[1].name : "") + ", holds the cottage" };
  }

  function taskDetail(id, ctx) {
    var T = get("HH_TASKS");
    if (!has(T)) return null;
    var c = (T.cards || []).filter(function (x) { return x.id === id; })[0];
    if (!c) return null;
    var col = c.col;
    try { col = T.colName ? T.colName(c) : c.col; } catch (e) { col = c.col; }
    var facts = [["Column", col],
                 ["Labels", (c.labels || []).join(", ") || "none"],
                 ["Due", c.due ? day(c.due) : "no date"],
                 ["Assignee", c.assignee || "nobody yet"]];
    var checks = (T.checklists || []).filter(function (k) { return k.card === c.id; });
    var comments = (T.comments || []).filter(function (m) { return m.card === c.id; });
    return {
      title: c.title, sub: "Card · " + c.board,
      facts: facts,
      sections: [
        section("Checklist", checks.map(function (k, i) {
          return row("chk" + i, (k.done ? "\u2713 " : "\u25cb ") + (k.text || k.title || ""), "", "", k.done ? "muted" : "");
        })),
        section("Comments", comments.map(function (m, i) {
          return row("cm" + i, m.text || m.body || "", (m.who || m.by || "") + " · " + (m.at || ""));
        }))
      ].filter(function (s) { return s.rows.length; }),
      note: "A card is lww_field: two members editing different fields both succeed."
    };
  }

  /* ── Reminders ─────────────────────────────────────────────────────── */

  function reminders(ctx) {
    var R = get("HH_REMINDERS");
    if (!has(R)) return null;
    var a = R.agendaFor(ctx.member);
    var secs = (a.blocks || []).map(function (b) {
      return section(b.label + (b.rule ? " · " + b.rule : ""), (b.rows || []).map(function (r) {
        return row(r.id, r.title, r.meta, r.when || day(r.due),
                   r.overdue ? "danger" : (r.severity === "warning" ? "warning" : ""), false);
      }));
    }).filter(function (s) { return s.rows.length; });
    return { sections: secs, note: "One list across every module. Overdue first, oldest first, then by week." };
  }

  /* ── Calendar ──────────────────────────────────────────────────────── */

  function calendar(ctx) {
    var C = get("HH_CALENDAR");
    if (!has(C)) return null;
    var to = new Date(new Date(TODAY).getTime() + 20 * 86400000).toISOString().slice(0, 10);
    var occ = C.occurrences(TODAY, to) || [];
    var byDay = {}, order = [];
    occ.forEach(function (o) {
      if (!byDay[o.date]) { byDay[o.date] = []; order.push(o.date); }
      byDay[o.date].push(o);
    });
    var secs = order.slice(0, 8).map(function (d) {
      return section(day(d) + (d === TODAY ? " · today" : ""), byDay[d].map(function (o) {
        var who = (o.who || []).join(", ");
        var meta = [o.kind === "allday" ? "all day" : (o.start || o.time || ""), o.place, who]
          .filter(Boolean).join(" · ");
        return row(o.key, pick(o, ctx), meta, o.rsvp ? (C.rsvpWord ? C.rsvpWord(o.rsvp) : o.rsvp) : "",
                   o.conflict ? "warning" : "", true);
      }));
    });
    return { sections: secs, note: "Agenda is the mobile default; month is the web default. A busy block is a real synced row." };
  }

  function calendarDetail(key, ctx) {
    var C = get("HH_CALENDAR");
    if (!has(C)) return null;
    var to = new Date(new Date(TODAY).getTime() + 20 * 86400000).toISOString().slice(0, 10);
    var o = (C.occurrences(TODAY, to) || []).filter(function (x) { return x.key === key; })[0];
    if (!o) return null;
    return {
      title: pick(o, ctx), sub: day(o.date) + (o.kind === "allday" ? " · all day" : ""),
      facts: [["Who", (o.who || []).join(", ") || "nobody named"],
              ["Place", o.place || "not set"],
              ["Visibility", o.visibility || "household"],
              ["Origin", o.origin === "local" ? "this household" : (o.origin || "")],
              ["Repeats", o.recurring ? "yes — editing offers the three choices" : "no"]],
      sections: [], note: o.description || "An occurrence edit asks which of the three it applies to, and each choice states its consequence."
    };
  }

  /* ── Chores ────────────────────────────────────────────────────────── */

  function chores(ctx) {
    var C = get("HH_CHORES");
    if (!has(C)) return null;
    var over = C.overdueRows() || [];
    var mine = over.filter(function (r) { return r.assignee === ctx.member; });
    var secs = [];
    if (mine.length) secs.push(section("Yours, overdue", mine.map(function (r) {
      return row(r.id, r.name, r.late + " days late · " + r.points + " points", day(r.due), "danger", true);
    })));
    secs.push(section("Overdue", over.filter(function (r) { return r.assignee !== ctx.member; }).map(function (r) {
      return row(r.id, r.name, (r.assignee ? r.assignee : "nobody assigned") + " · " + r.late + " days late",
                 day(r.due), "danger", true);
    })));
    secs.push(section("All chores", (C.chores || []).map(function (c) {
      var who = null;
      try { who = C.assigneeFor ? C.assigneeFor(c) : null; } catch (e) { who = null; }
      return row(c.id, pick(c, ctx, "name", "cs"),
                 (c.sched ? c.sched.says : "") + " · " + c.room + " · " + c.minutes + " min",
                 (who || "unassigned") + " · " + c.points + " pts", "", true);
    })));
    var bal = C.balanceOf ? C.balanceOf(ctx.member) : null;
    return { sections: secs.filter(function (s) { return s.rows.length; }),
             note: bal === null ? "" : "Points: " + bal + ". Every award has a reason and an actor, and there is no leaderboard." };
  }

  function choreDetail(id, ctx) {
    var C = get("HH_CHORES");
    if (!has(C)) return null;
    var c = (C.chores || []).filter(function (x) { return x.id === id; })[0];
    if (!c) return null;
    var ledger = C.ledgerFor ? (C.ledgerFor(id) || []) : [];
    return {
      title: pick(c, ctx, "name", "cs"), sub: c.room + " · " + c.minutes + " minutes · " + c.points + " points",
      facts: [["Schedule", c.sched ? c.sched.kind + " — " + c.sched.says : ""],
              ["Assignment", c.mode + (c.rotation ? " · " + c.rotation.join(" → ") : "")],
              ["Whose turn", (function () {
                try { return (C.assigneeFor && C.assigneeFor(c)) || "unassigned"; } catch (e) { return "unassigned"; }
              })()],
              ["Verification", c.verify ? "an owner confirms it" : "none — it is done when it is done"],
              ["Last done", c.last ? day(c.last.on) + " by " + c.last.by : "never"]],
      sections: [section("Points ledger", ledger.slice(0, 6).map(function (e, i) {
        return row("p" + i, e.why || e.reason || e.kind, (e.by || e.actor || "") + " · " + day(e.on || e.at),
                   (e.points > 0 ? "+" : "") + e.points);
      }))].filter(function (s) { return s.rows.length; }),
      note: "Completion is household scope: the rotation says whose turn it is, not whose obligation it is."
    };
  }

  /* ── Notes ─────────────────────────────────────────────────────────── */

  function notes(ctx) {
    var N = get("HH_NOTES");
    if (!has(N)) return null;
    var roots = N.rootsFor ? (N.rootsFor(ctx.member) || []) : [{ id: "shared", name: "Shared" }];
    var secs = roots.map(function (r) {
      var rootId = r.id || r;
      var tree = [];
      try { tree = N.treeOf(rootId, ctx.member) || []; } catch (e) { tree = []; }
      return section((r.name || rootId) + " · root", tree.map(function (t) {
        var indent = new Array(t.depth + 1).join("   ");
        return t.type === "folder"
          ? row("", indent + t.name, t.count + " inside", "", "muted", false)
          : row(t.id, indent + t.name, t.path, day(t.updated), "", true);
      }));
    });
    return { sections: secs.filter(function (s) { return s.rows.length; }),
             note: "The root switcher is navigation, not a filter. A renamed slug lands on a 404 that explains itself." };
  }

  function noteDetail(id, ctx) {
    var N = get("HH_NOTES");
    if (!has(N)) return null;
    var n = (N.notes || []).filter(function (x) { return x.id === id; })[0];
    if (!n) return null;
    return {
      title: n.title, sub: (N.pathOf ? N.pathOf(n.id) : n.slug) + " · " + day(n.updated),
      facts: [["Root", n.root], ["Language", n.lang], ["Last edit", day(n.updated) + " by " + n.by],
              ["Images", String(n.images || 0)]],
      sections: [section("Body", [row("", n.body, "", "", "")])],
      note: "An overwritten body is preserved for thirty days and offered in a banner."
    };
  }

  /* ── Documents ─────────────────────────────────────────────────────── */

  function documents(ctx) {
    var D = get("HH_DOCS");
    if (!has(D)) return null;
    var visible = D.visibleTo ? (D.visibleTo(ctx.member) || []) : (D.docs || []);
    var byFolder = {}, order = [];
    visible.forEach(function (d) {
      var f = (D.folderOf ? (D.folderOf(d.folder) || {}).name : d.folder) || d.folder;
      if (!byFolder[f]) { byFolder[f] = []; order.push(f); }
      byFolder[f].push(d);
    });
    var secs = order.map(function (f) {
      return section(f, byFolder[f].map(function (d) {
        var bits = [d.type, d.bytes ? Math.round(d.bytes) + " kB" : ""];
        if (d.expires) bits.push("expires " + day(d.expires));
        if (d.attachment !== "ready") bits.push(d.attachment);
        return row(d.id, d.title, bits.filter(Boolean).join(" · "), "",
                   d.expires && daysBetween(TODAY, d.expires) < 60 ? "warning" : "", true);
      }));
    });
    var t = D.totals ? D.totals() : null;
    return { sections: secs, note: t ? "Storage: " + (t.says || (Math.round((t.total || 0) * 10) / 10) + " GB, overhead derived") : "" };
  }

  function docDetail(id, ctx) {
    var D = get("HH_DOCS");
    if (!has(D)) return null;
    var d = D.docOf ? D.docOf(id) : (D.docs || []).filter(function (x) { return x.id === id; })[0];
    if (!d) return null;
    var refs = D.referencesTo ? (D.referencesTo(id) || []) : [];
    return {
      title: d.title, sub: d.declared + " · " + Math.round(d.bytes) + " kB",
      facts: [["Type", d.type], ["Uploaded by", d.by], ["Expires", d.expires ? day(d.expires) : "no date"],
              ["Preview", d.previewStatus + " · " + d.previewKind],
              ["Bytes", d.attachment === "ready" ? "on the server" : d.attachment]],
      sections: [section("Referenced by", refs.map(function (r, i) {
        return row("r" + i, r.label || r.title || r.id, r.module || r.type || "");
      }))].filter(function (s) { return s.rows.length; }),
      note: "Deleting names what points at the file rather than blocking the delete."
    };
  }

  /* ── Finance ───────────────────────────────────────────────────────── */

  function finance(ctx) {
    var F = get("HH_FINANCE");
    if (!has(F)) return null;
    var bal = F.balances ? F.balances() : null;
    var bud = F.budgetRun ? F.budgetRun() : null;
    var secs = [];
    if (bal) secs.push(section("Balances · simplified", (bal.pairs || []).map(function (p, i) {
      return row("pair" + i, p.says || (p.from + " → " + p.to), "settle-up moves one payment", money(p.amount));
    })));
    if (bud) secs.push(section("Budgets · " + bud.period.label, (bud.rows || []).map(function (b) {
      return row(b.id, b.category, money(b.actual) + " of " + money(b.budget) + " · " + b.pct + " %",
                 b.over ? "over" : (b.willBeOver ? "will be over" : money(b.remaining) + " left"),
                 b.over ? "danger" : (b.willBeOver ? "warning" : ""), false);
    })));
    secs.push(section("Recent", (F.expenses || []).slice(0, 6).map(function (e) {
      return row(e.id, e.desc, day(e.date) + " · " + (F.catName ? F.catName(e.category) : e.category) +
                 " · split " + e.method, money(e.amount, e.currency), "", true);
    })));
    return { sections: secs, note: "€10 three ways is 3,34 / 3,33 / 3,33 every time. Planned sits beside posted, and nothing here moves anybody's money." };
  }

  function financeDetail(id, ctx) {
    var F = get("HH_FINANCE");
    if (!has(F)) return null;
    var e = (F.expenses || []).filter(function (x) { return x.id === id; })[0];
    if (!e) return null;
    var shares = [];
    try {
      var raw = F.sharesOf ? F.sharesOf(e) : [];
      shares = Array.isArray(raw) ? raw : (raw && raw.rows) || [];
    } catch (err) { shares = []; }
    return {
      title: e.desc, sub: day(e.date) + " · " + money(e.amount, e.currency),
      facts: [["Paid by", (e.paid || []).map(function (p) { return p[0] + " " + money(p[1], e.currency); }).join(", ")],
              ["Split", e.method], ["Participants", (e.participants || []).join(", ")],
              ["Category", F.catName ? F.catName(e.category) : e.category],
              ["Document", e.doc ? "attached" : "none"]],
      sections: [section("Shares", shares.map(function (s, i) {
        return row("s" + i, s.name || s.member, s.says || "", money(s.amount, e.currency));
      }))].filter(function (s) { return s.rows.length; }),
      note: "A share may only name a member who holds Finance; the picker refuses the rest by name."
    };
  }

  /* ── Utilities ─────────────────────────────────────────────────────── */

  function utilities(ctx) {
    var U = get("HH_UTILITIES");
    if (!has(U)) return null;
    var rows = (U.services || []).map(function (s) {
      var sum = null;
      try { sum = U.summary(s.id); } catch (e) { sum = null; }
      var right = "", tone = "";
      if (sum && sum.balance !== undefined && sum.balance !== null) {
        right = money(sum.balance * 100, s.currency);
        tone = sum.balance < 0 ? "warning" : "";
      }
      return row(s.id, pick(s, ctx, "name", "name"),
                 s.supplier + " · " + s.mode + (s.cadence ? " · every " + s.cadence + " days" : " · bills only"),
                 right, tone, true);
    });
    return { sections: [section("Services", rows)],
             note: "Balance or headroom, per service. An estimated reading never enters a money figure." };
  }

  function utilityDetail(id, ctx) {
    var U = get("HH_UTILITIES");
    if (!has(U)) return null;
    var sum = null;
    try { sum = U.summary(id); } catch (e) { sum = null; }
    var s = U.svc ? U.svc(id) : null;
    if (!s) return null;
    var readings = [];
    try { readings = (U.readingsOf ? U.readingsOf(id) : []) || []; } catch (e) { readings = []; }
    var facts = [["Supplier", s.supplier], ["Account", s.account], ["Mode", s.mode],
                 ["Reading cadence", s.cadence ? "every " + s.cadence + " days, set here" : "no meter"],
                 ["Contract", day(s.contract_start) + " → " + day(s.contract_end) + " · " + s.notice_days + " days notice"]];
    if (sum && sum.period) facts.push(["Period", (sum.period.from ? day(sum.period.from) + " → " + day(sum.period.to) : "")]);
    if (sum && sum.balance !== undefined && sum.balance !== null) facts.push(["Balance", money(sum.balance * 100, s.currency)]);
    if (sum && sum.headroom) facts.push(["Headroom", String(sum.headroom.says || sum.headroom)]);
    return {
      title: pick(s, ctx, "name", "name"), sub: s.place + " · " + s.commodity,
      facts: facts,
      sections: [section("Readings", readings.slice(-6).reverse().map(function (r, i) {
        return row("rd" + i, String(r.value) + (r.unit ? " " + r.unit : ""),
                   day(r.on || r.date) + (r.estimated ? " · estimated" : "") + (r.by ? " · " + r.by : ""),
                   r.pending ? "pending" : "", r.estimated ? "warning" : "");
      }))].filter(function (x) { return x.rows.length; }),
      note: "The cellar screen sizes its fields to the meter's own digits, questions a low value, and stays pending until the server takes it."
    };
  }

  /* ── Garden ────────────────────────────────────────────────────────── */

  function garden(ctx) {
    var G = get("HH_GARDEN");
    if (!has(G)) return null;
    var all = [];
    try { all = G.tasks() || []; } catch (e) { all = []; }
    var open = all.filter(function (t) { return t.status === "open"; })
      .sort(function (a, b) { return a.due < b.due ? -1 : 1; }).slice(0, 8);
    var secs = [section("This month's work", open.map(function (t) {
      return row(t.id, t.title, (t.bed ? "bed " + t.bed + " · " : "") + (t.window ? "window " + t.window.kind : t.kind),
                 day(t.due), t.due < TODAY ? "danger" : "", false);
    }))];
    (G.zones || []).forEach(function (z) {
      var beds = G.bedsOfZone ? (G.bedsOfZone(z.id) || []) : [];
      secs.push(section(z.name, beds.map(function (b) {
        var pl = [];
        try { pl = (G.plantingsOf ? G.plantingsOf(2026) : []).filter(function (p) { return p.bed === b.num; }); } catch (e) { pl = []; }
        return row("bed-" + b.num, b.label, b.area + " m² · " + b.sun + " sun",
                   pl.length + (pl.length === 1 ? " planting" : " plantings"), "", true);
      })));
    });
    return { sections: secs.filter(function (s) { return s.rows.length; }),
             note: "Three tiers over one data model. A pots household never sees a bed, and moving up a tier reveals rather than migrates." };
  }

  function gardenDetail(id, ctx) {
    var G = get("HH_GARDEN");
    if (!has(G)) return null;
    var num = Number(String(id).replace("bed-", ""));
    var b = G.bed ? G.bed(num) : null;
    if (!b) return null;
    var pl = [];
    try { pl = (G.plantingsOf ? G.plantingsOf(2026) : []).filter(function (p) { return p.bed === num; }); } catch (e) { pl = []; }
    return {
      title: b.label, sub: b.area + " m² · " + b.sun + " sun",
      facts: [["Zone", (G.zones || []).filter(function (z) { return z.id === b.zone; }).map(function (z) { return z.name; })[0] || b.zone],
              ["Soil", b.soil || "not recorded"], ["Active", b.active ? "in this season" : "resting"]],
      sections: [section("2026 plantings", pl.map(function (p) {
        var crop = G.byCrop ? (G.byCrop[p.crop] || {}) : {};
        return row(p.id, pick(crop, ctx, "en", "cs") || p.crop,
                   "sown " + day(p.planned && p.planned.sow_indoor || p.planned && p.planned.direct_sow) +
                   " · harvest " + day(p.planned && p.planned.harvest),
                   p.area ? p.area + " m²" : "");
      }))].filter(function (s) { return s.rows.length; }),
      note: "The eleven plan checks warn; none of them blocks a save."
    };
  }

  /* ── Property / Vehicles / Pets — one engine, three vocabularies ───── */

  function assets(mod, ctx) {
    var A = get("HH_ASSETS");
    if (!has(A)) return null;
    var list = [];
    try { list = A.entitiesOf(mod) || []; } catch (e) { list = []; }
    var rows = list.map(function (e) {
      var scheds = A.schedulesOf ? (A.schedulesOf(e.id) || []) : [];
      var soonest = null;
      scheds.forEach(function (s) {
        var d = null;
        try { d = A.due(s.id); } catch (err) { d = null; }
        if (d && (!soonest || d.resolved < soonest.resolved)) soonest = d;
      });
      return row(e.id, pick(e, ctx), e.meta || e.category || "",
                 soonest ? (soonest.overdue ? "overdue " + day(soonest.resolved) : "due " + day(soonest.resolved)) : "",
                 soonest && soonest.overdue ? "danger" : "", true);
    });
    var note = mod === "pets"
      ? "Doses ticked and shared, a routine that resets, the vet card one tap from the top. No asset words appear on these screens."
      : mod === "vehicles"
        ? "Statutory dates per country, notice-period renewal, partial fills counted correctly, and a bike variant that never asks for a plate."
        : "The starter checklist, the contractors, the meter locations, and the printable insurance inventory.";
    return { sections: [section(mod === "pets" ? "Who lives here" : "Things", rows)], note: note };
  }

  function assetDetail(id, ctx) {
    var A = get("HH_ASSETS");
    if (!has(A)) return null;
    var e = A.entity ? A.entity(id) : null;
    if (!e) return null;
    var scheds = A.schedulesOf ? (A.schedulesOf(id) || []) : [];
    var records = A.recordsOf ? (A.recordsOf(id) || []) : [];
    return {
      title: pick(e, ctx), sub: e.category || e.kind || "",
      facts: [["Acquired", e.acquired ? day(e.acquired) : "not recorded"],
              ["Status", e.status || ""], ["Detail", e.meta || ""],
              ["Documents", String(e.docs || 0)]],
      sections: [
        section("Schedule", scheds.map(function (s) {
          var d = null;
          try { d = A.due(s.id); } catch (err) { d = null; }
          return row(s.id, pick(s, ctx, "en", "cs"),
                     s.basis === "interval" ? "every " + s.months + " months" : s.basis,
                     d ? d.says : "", d && d.overdue ? "danger" : "");
        })),
        section("History", records.slice(0, 6).map(function (r) {
          return row(r.id, r.what, day(r.date) + " · " + (r.by || ""), r.cost ? r.cost + " Kč" : "");
        }))
      ].filter(function (s) { return s.rows.length; }),
      note: "One engine keyed by (entity_type, entity_id); the words on the screen belong to the module."
    };
  }

  /* ── Chat ──────────────────────────────────────────────────────────── */

  function chat(ctx) {
    var C = get("HH_CHAT");
    if (!has(C)) return null;
    var list = [];
    try { list = C.listFor(ctx.member) || []; } catch (e) { list = []; }
    return {
      sections: [section("Conversations", list.map(function (c) {
        return row(c.id, pick(c, ctx, "en", "cs"),
                   c.last ? c.last.by + ": " + c.last.text : "nothing yet",
                   c.unread ? String(c.unread) : "", c.unread ? "accent" : "", true);
      }))],
      note: "The floor is per conversation. An attachment can be handed to Documents, and custody moves with it."
    };
  }

  function chatDetail(id, ctx) {
    var C = get("HH_CHAT");
    if (!has(C)) return null;
    var conv = C.conversation ? C.conversation(id) : null;
    var msgs = [];
    try { msgs = C.messagesOf(id) || []; } catch (e) { msgs = []; }
    if (!conv && !msgs.length) return null;
    return {
      title: conv ? pick(conv, ctx, "en", "cs") : id,
      sub: (conv && conv.members ? conv.members + " people" : "") + (conv && conv.kind ? " · " + conv.kind : ""),
      facts: [],
      sections: [section("Messages", msgs.slice(-8).map(function (m) {
        return row(m.id, m.text, m.by + " · " + m.at);
      }))],
      note: "Attachments arrive as rows before their bytes do, and say so."
    };
  }

  /* ── Activity log ──────────────────────────────────────────────────── */

  function activity(ctx) {
    var A = get("HH_ACTIVITY");
    if (!has(A)) return null;
    var feed = null;
    try { feed = A.feedFor(ctx.member); } catch (e) { feed = null; }
    if (!feed) return null;
    var byDay = {}, order = [];
    (feed.rows || []).forEach(function (e) {
      var d = String(e.at).slice(0, 10);
      if (!byDay[d]) { byDay[d] = []; order.push(d); }
      byDay[d].push(e);
    });
    var secs = order.slice(0, 4).map(function (d) {
      return section(day(d) + (d === TODAY ? " · today" : ""), byDay[d].map(function (e) {
        var text = "";
        try { text = A.render ? A.render(e) : ""; } catch (err) { text = ""; }
        if (!text) text = (e.entity && e.entity.label ? e.entity.label : e.key);
        var diff = e.diff && e.diff.length
          ? e.diff.map(function (d2) { return d2.field + " " + d2.from + " → " + d2.to; }).join(", ") : "";
        return row(e.id, String(text), [e.actor, e.via, diff].filter(Boolean).join(" · "),
                   String(e.at).slice(11), "", false);
      }));
    });
    return { sections: secs, note: feed.ownOnly
      ? "A member without the log grant sees their own entries only."
      : "Cross-module timelines and field diffs. The log needs a connection, and says so where it would be wrong to guess." };
  }

  /* ── Household settings ────────────────────────────────────────────── */

  function admin(ctx) {
    var H = get("HH_HOUSEHOLD"), F = get("HH_FIXTURES");
    if (!has(H)) return null;
    var entRow = (H.ent || []).filter(function (e) { return e[0] === (ctx.ent || "active"); })[0];
    var storage = H.storage || {};
    var secs = [];
    secs.push(section("Subscription", [
      row("ent", "State — " + (ctx.ent || "active"), entRow ? entRow[8] : "", entRow ? entRow[5] : "", "", false),
      row("price", "Price", "One price in every market, billed in EUR", (H.price && H.price.says) || "€4.99 / month", "", false)
    ]));
    secs.push(section("Storage · " + (storage.current || 0) + " GB of " + (storage.allowance || 0) + " GB",
      (storage.byModule || []).map(function (m) {
        return row("st-" + m[0], m[0], "", m[1] + " GB", m[1] > 5 ? "warning" : "", false);
      })));
    var matrix = [];
    try { matrix = H.matrixFor(ctx.member) || []; } catch (e) { matrix = []; }
    secs.push(section("What " + ((F && (F.members.filter(function (m) { return m.id === ctx.member; })[0] || {}).name) || "this member") + " holds",
      matrix.map(function (m) {
        return row("g-" + m.key, m.name, m.phrase, m.level, m.level === "none" ? "muted" : "", false);
      })));
    return { sections: secs, note: "Seventeen rows in words a member already knows, and no legend." };
  }


  /* ── Sync, conflicts and refusals ──────────────────────────────────── */

  function sync(ctx) {
    var S = get("HH_SYNC");
    if (!has(S)) return null;
    var route = (ctx && ctx.route) || "/sync";
    if (route.indexOf("/refused") === 0) {
      return { sections: [section("Four reasons occur \u00b7 each opens with its three ways out",
        (S.rejections || []).map(function (r) {
          return { id: r.code, route: "/sync/" + r.code, title: r.where,
                   meta: r.copy, right: r.ref, tone: "danger", deep: true };
        }))],
        note: "Held, never lost. Each reason states the limit and what to do about it." };
    }
    var secs = [section("Conflicts to answer \u00b7 " + (S.inbox || []).length,
      (S.inbox || []).map(function (e) {
        return row(e.id, e.title,
          e.where + " \u00b7 " + e.mine.who + " " + e.mine.value + " against " + e.theirs.who + " " + e.theirs.value,
          e.module, "warning", true);
      }))];
    secs.push(section("Refused changes", [
      { id: "refused", route: "/refused", title: "Changes the server refused",
        meta: "Four reasons, each naming what happened and offering retry, edit and discard",
        right: String((S.rejections || []).length), tone: "danger", deep: true }
    ]));
    return { sections: secs, note: "One inbox across every module. Resolution happens from the row, and nothing ages out." };
  }

  function syncDetail(id, ctx) {
    var S = get("HH_SYNC");
    if (!has(S)) return null;
    var e = (S.inbox || []).filter(function (x) { return x.id === id; })[0];
    if (e) {
      return {
        title: e.title, sub: "Conflict \u00b7 " + e.where,
        facts: [[e.mine.who, e.mine.value + " \u00b7 " + e.mine.at],
                [e.theirs.who, e.theirs.value + " \u00b7 " + e.theirs.at],
                ["Module", e.module]],
        sections: [section("Which is right?", [
          row("q", e.question, "", "", "warning", false),
          row("a1", "Keep " + e.theirs.value + " (" + e.theirs.who + ")", "", "", "", false),
          row("a2", "Keep " + e.mine.value + " (" + e.mine.who + ")", "", "", "", false),
          row("a3", e.third, "", "", "muted", false)
        ])],
        note: "Two names, two numbers, two times, and a way to enter a third."
      };
    }
    var r = (S.rejections || []).filter(function (x) { return x.code === id; })[0];
    if (!r) return null;
    return { title: r.where, sub: "Refused \u00b7 " + r.ref,
      facts: [["Reason", r.code], ["What to do", r.actions.join(" / ")]],
      sections: [section("What the screen says", [row("c", r.copy, r.extra || "", "", "danger", false)])],
      note: r.note };
  }

  /* ── Navigation: households, arrange, the deep links ───────────────── */

  function navigation(ctx) {
    var N = get("HH_NAV"), F = get("HH_FIXTURES");
    if (!has(N)) return null;
    var route = (ctx && ctx.route) || "/households";
    var here = (ctx && ctx.household) || "hh-tilcer";
    var who = (ctx && ctx.member) || "jana";

    if (route.indexOf("/more/arrange") === 0) {
      var n = N.navFor(who, here) || {};
      var order = (n.more || []).map(function (m, i) {
        return row(m[0], m[1], (i + 1) + " of " + (n.more || []).length + " \u00b7 " + (n.grants || {})[m[0]],
                   i === 0 ? "pinned" : "", "", false);
      });
      var secs = [section("In order \u00b7 drag, or move from the same handle with the keyboard", order)];
      secs.push(section("Hidden by me \u00b7 recoverable", [
        row("hidden", "Nothing hidden yet", N.arrange.surfaces[0][2], "show again", "muted", false)
      ]));
      secs.push(section("Not in this list", [
        row("absent", (n.absent || []).length + " " + N.arrange.absentLine, N.arrange.surfaces[1][2], "", "muted", false)
      ]));
      return { sections: secs, note: N.arrange.rules[1][1] };
    }

    if (route.indexOf("/link") === 0) {
      return { sections: [section("Four situations, four finished screens",
        (N.deeplinks || []).map(function (d) {
          return row(d.id, d.name + " \u2014 " + d.title, d.story, d.ref, d.id === "noaccess" ? "muted" : "", false);
        }))],
        note: "Cold start resolves after sign-in without losing the target. Wrong household switches first, and says so." };
    }

    var mine = (F ? F.households : []).filter(function (h) { return h.members.indexOf(who) >= 0; });
    var rows = mine.map(function (h) {
      var n2 = N.navFor(who, h.id) || {};
      return { id: h.id, switchTo: h.id, title: h.name,
        meta: (n2.role || "member") + " \u00b7 " + (n2.more || []).length + " modules in your list",
        right: h.id === here ? "you are here" : "switch", tone: h.id === here ? "accent" : "", deep: true };
    });
    var secs = [section("Your households \u00b7 " + mine.length, rows)];
    secs.push(section("Switching changes all of these at once",
      (N.switcher.changes || []).map(function (c) { return row(c[0], c[0], c[1], "", "muted", false); })));
    return { sections: secs, note: N.switcher.chata.note };
  }

  /* ── Shopping ──────────────────────────────────────────────────────── */

  function shopping(ctx) {
    var S = get("HH_SHOPPING");
    if (!has(S)) return null;
    var route = (ctx && ctx.route) || "/shopping";
    var CAT = {};
    (S.categories || []).forEach(function (c) { CAT[c[0]] = c[1]; });
    var items = S.items || [];

    function itemLine(it) {
      var q = it.quantity ? (it.quantity + (it.unit ? " " + it.unit : "")) : "";
      return [q, CAT[it.category] || it.category, it.note, it.assigned ? "for " + it.assigned : ""]
        .filter(Boolean).join(" \u00b7 ");
    }

    /* B-7 — the teaching empty state, and the template it commits sixteen more to */
    if (route.indexOf("#b-7") > 0) {
      var TPL = S.template || { contract: [], rules: [] };
      return { sections: [
        section("What every empty state carries", (TPL.contract || []).map(function (c, i) {
          return row("c" + i, c[0], c[1], "", "", false); })),
        section("And what none of them does", (TPL.rules || []).map(function (r, i) {
          return row("r" + i, r[0], r[1], "", "muted", false); }))
      ], note: "Written once here. The other sixteen are authored in their own module's stage, beside the screen they teach." };
    }

    /* B-8 — two trolleys, one list, and a dialog for nobody */
    if (route.indexOf("#b-8") > 0) {
      var tr = typeof S.trolley === "function" ? S.trolley() : S.trolley;
      var jf = (tr && tr.janaFirst) || { visible: [], asked: 0 };
      var pf = (tr && tr.petrFirst) || jf;
      var vis = function (o) {
        return (o.visible || []).map(function (v, i) {
          return row("v" + i, v.text, v.checked ? "checked by " + v.by + " at " + v.at : "still on the list",
            v.checked ? "done" : "", v.checked ? "ok" : "", false); });
      };
      return { sections: [
        section("Jana's replica reconciles first", vis(jf)),
        section("Petr's replica reconciles first", vis(pf)),
        section("What either of them was asked", [
          row("asked", (jf.asked || 0) + " questions asked",
            "A tick is a state set, not an edit; a delete beats an edit; neither is a conflict",
            "no dialog", "ok", false)])
      ], note: "Two trolleys in one shop end on the same list in the same order, and neither person is interrupted." };
    }

    if (route.indexOf("/layout") > 0) {
      var store = ((S.lists || [])[0] || {}).store || "this store";
      return { sections: [
        section("Walking order \u00b7 " + store, (S.storeOrder || []).map(function (k, i) {
          return row(k, (i + 1) + ". " + (CAT[k] || k),
            items.filter(function (it) { return it.category === k; }).length + " on this list", "", "", false); })),
        section("The catalog order it started from", (S.catalogOrder || []).map(function (k, i) {
          return row("c-" + k, (i + 1) + ". " + (CAT[k] || k), "", "", "muted", false); }))
      ], note: "The order belongs to the store rather than to the household, so a second shop starts from the catalog again." };
    }

    if (route.indexOf("/staples") > 0) {
      var st = typeof S.staples === "function" ? S.staples() : S.staples;
      return { sections: [
        section("Bought often enough to suggest", (st || []).filter(function (x) { return x.score >= 1; })
          .map(function (x) { return row(x.text, x.text, x.line, x.times + "\u00d7", "", false); })),
        section("Not often enough", (st || []).filter(function (x) { return x.score < 1; })
          .map(function (x) { return row(x.text, x.text, x.line, "", "muted", false); }))
      ], note: "Nine weeks of history, no threshold anybody has to understand, and nothing joins the list without a tap." };
    }

    if (route.indexOf("/trips") > 0) {
      var t = S.trip || {};
      var off = null;
      try { off = typeof S.financeOffer === "function" ? S.financeOffer(ctx && ctx.member) : S.financeOffer; } catch (e) { off = null; }
      return { sections: [
        section("Priced at the till \u00b7 " + (t.priced || 0) + " of " + (t.items || 0), (t.priceLines || []).map(function (p) {
          return row(p[0], p[0], "", money(Math.round(p[1] * 100), t.currency), "", false); })),
        section("Not priced", [row("un", (t.unpriced || 0) + " items went in without a price",
          "A price is optional everywhere, and the total says what it is a total of", "", "muted", false)]),
        section("The trip", [row("tot", (t.store || "") + " \u00b7 " + (t.date || ""), "Entered by " + (t.by || ""),
          money(Math.round((t.total || 0) * 100), t.currency), "accent", false)]),
        section("Finance", [row("offer", off && off.offered ? "Record this as an expense?" : "No Finance offer on this trip",
          off && off.offered ? "Optional, and declining leaves nothing behind" : ((off && off.reason) || ""),
          "", "muted", false)])
      ], note: "A receipt rather than a workflow: everything on it is optional except that the trip happened." };
    }

    var m3 = route.match(/^\/shopping\/([^/#]+)\/([^/#]+)$/);
    if (m3 && m3[2] !== "layout" && m3[1] !== "trips") {
      var it3 = items.filter(function (x) { return x.id === m3[2]; })[0];
      if (it3) return { sections: [section("Every field except the first is optional",
        (S.itemFields || []).map(function (f) {
          var v = it3[f[0]] === undefined || it3[f[0]] === null ? "" : String(it3[f[0]]);
          if (f[0] === "category") v = CAT[it3.category] || "";
          if (f[0] === "assigned_to") v = it3.assigned || "";
          if (f[0] === "price_minor") v = it3.price ? money(Math.round(it3.price * 100)) : "";
          return row(f[0], f[1], f[3], v || "\u2014", v ? "" : "muted", false);
        }))], note: "Nothing is required and nothing is asked for twice: the quantity and the unit arrived with the line that was typed." };
    }

    if (route === "/shopping" || route === "/shopping/") {
      return { sections: [section("Lists \u00b7 " + (S.lists || []).length, (S.lists || []).map(function (l) {
        return { id: l.id, route: "/shopping/" + l.id, title: l.name,
          meta: [l.store, l.isDefault ? "default" : "", l.layout + " order"].filter(Boolean).join(" \u00b7 "),
          right: l.open ? l.open + " open" : "empty", tone: l.open ? "" : "muted", deep: true }; }))],
        note: "One list is the default and opens on its own. The rest are named for the moment they are used." };
    }

    var listId = (route.split("/")[2] || "l-shop").split("#")[0];
    var list = (S.lists || []).filter(function (l) { return l.id === listId; })[0];
    if (!list) {
      return { sections: [section("No list with that address", [
        row("gone", "This list is not here",
          "It may have been renamed, or it belongs to a household you are not in. Nothing was deleted by opening this.",
          listId, "muted", false)].concat((S.lists || []).map(function (l) {
            return { id: l.id, route: "/shopping/" + l.id, title: l.name,
                     meta: (l.store || "no store set"), right: l.open + " open", tone: "", deep: true }; })))],
        note: "A renamed address lands on a screen that explains itself and offers the lists that do exist." };
    }
    var order = list.layout === "store" ? (S.storeOrder || []) : (S.catalogOrder || []);
    var secs2 = [];
    order.forEach(function (cat) {
      var open = items.filter(function (i2) { return i2.category === cat && !i2.checked; })
        .map(function (i2) {
          return { id: i2.id, route: "/shopping/" + listId + "/" + i2.id, title: i2.text,
                   meta: itemLine(i2), right: "", tone: "", deep: true }; });
      if (open.length) secs2.push(section(CAT[cat] || cat, open));
    });
    var done = items.filter(function (i2) { return i2.checked; });
    if (done.length) secs2.push(section("Checked \u00b7 " + done.length + " \u00b7 collapsed at the bottom, not gone",
      done.map(function (i2) { return row(i2.id, i2.text, "checked by " + i2.by + " at " + i2.at, "undo", "ok", false); })));
    return { sections: secs2,
      note: "Quick-add is focused the moment the list opens, check-off is one tap and reversible, and the order is the store's." };
  }

  function shoppingDetail(id, ctx) {
    var S = get("HH_SHOPPING");
    if (!has(S)) return null;
    var it = (S.items || []).filter(function (x) { return x.id === id; })[0];
    if (!it) return null;
    var CAT = {};
    (S.categories || []).forEach(function (c) { CAT[c[0]] = c[1]; });
    return {
      title: it.text, sub: "Item \u00b7 " + (CAT[it.category] || it.category),
      facts: [["Quantity", it.quantity ? it.quantity + (it.unit ? " " + it.unit : "") : "\u2014"],
              ["Price", it.price ? money(Math.round(it.price * 100)) : "\u2014"],
              ["Who picks it up", it.assigned || "\u2014"]],
      sections: [section("Every field except the first is optional", (S.itemFields || []).map(function (f) {
        return row(f[0], f[1], f[3], f[2] ? "required" : "", f[2] ? "" : "muted", false); }))],
      note: it.note ? "Note: " + it.note : "No note. The row closes up rather than reserving the line."
    };
  }

  /* ── Dashboard ─────────────────────────────────────────────────────── */

  function dashboard(ctx) {
    var D = get("HH_DASHBOARD"), N = get("HH_NAV");
    if (!has(D)) return null;
    var route = (ctx && ctx.route) || "/home";
    var who = (ctx && ctx.member) || "jana";
    var nav = N ? N.navFor(who, (ctx && ctx.household) || "hh-tilcer") : {};
    var locked = !!nav.locked;
    var layout = locked ? D.layouts.child : (D.layouts[who] || D.layouts.household);
    var res = null;
    try { res = D.resolve(layout, who); } catch (e) { res = null; }
    var entries = (res && res.entries) || layout || [];
    var KEY = D.byKey || {};
    function widgetOf(e) { return e.widget || KEY[e.key] || {}; }
    function listOf(set, from) {
      return (set || []).map(function (e, i) {
        var w = widgetOf(e);
        return row(e.key, (i + 1 + (from || 0)) + ". " + (w.title || e.key),
          [w.module, w.says].filter(Boolean).join(" \u00b7 "), e.size || w.size || "", "", false);
      });
    }

    if (route.indexOf("/dashboard/catalog") === 0) {
      var cat = null;
      try { cat = D.catalogFor(who); } catch (e) { cat = null; }
      var offered = {};
      ((cat && cat.entries) || []).forEach(function (e) { offered[e.key] = true; });
      var byMod = {};
      (D.widgets || []).forEach(function (w) { (byMod[w.module] = byMod[w.module] || []).push(w); });
      var secs = Object.keys(byMod).map(function (m) {
        return section(m + " \u00b7 " + byMod[m].length, byMod[m].map(function (w) {
          return row(w.key, w.title, w.says, offered[w.key] ? w.size : "not offered",
            offered[w.key] ? "" : "muted", false); }));
      });
      return { sections: secs,
        note: (D.widgets || []).length + " widgets from " + Object.keys(byMod).length +
          " modules. A module this member does not hold is not offered here, and is not shown greyed out either." };
    }

    if (route.indexOf("/dashboard/arrange") === 0) {
      return { sections: [section("In order \u00b7 drag, or move from the same handle with the keyboard", listOf(entries))],
        note: locked
          ? "A locked layout has no arrange affordances at all \u2014 absent, not disabled."
          : "One ordered list. The 2 / 4 / 6 reflow is derived from it, so nothing is laid out twice." };
    }

    if (route.indexOf("/dashboard/default") === 0) {
      return { sections: [
        section("The household default \u00b7 " + (D.layouts.household || []).length, listOf(D.layouts.household)),
        section("What a member who customised sees", [
          row("adopt", "A dismissible notice, not a replacement",
            "Their own order stays until they adopt the new default", "dismissible", "muted", false)])
      ], note: "The owner edits what a new member starts with. Saving this rewrites nobody's existing layout." };
    }

    if (route.indexOf("#c-6") > 0 || route.indexOf("#c-7") > 0) {
      var isLocked = route.indexOf("#c-7") > 0;
      return { sections: [section("A child's dashboard \u00b7 " + (D.layouts.child || []).length + " widgets", listOf(D.layouts.child))],
        note: isLocked
          ? "Locked: the order is the owner's, and there is no arrange control on the screen."
          : "Suggested: the owner proposes this order and the child may change it. The same list either way." };
    }

    if (route.indexOf("#c-8") > 0) {
      return { sections: [section("One widget cannot load", (entries || []).slice(0, 4).map(function (e, i) {
        var w = widgetOf(e);
        return row(e.key, w.title || e.key,
          i === 1 ? "This one did not load. Nothing else on the screen is affected." : (w.says || ""),
          i === 1 ? "unavailable" : "", i === 1 ? "warning" : "", false); }))],
        note: "A widget that fails says so inside its own frame. One module never blanks the dashboard." };
    }

    if (route.indexOf("#c-5") > 0) {
      return { sections: [
        section("Your order, unchanged", listOf(entries)),
        section("The owner changed the household default", [
          row("adopt", "Adopt the new default", "Replaces your order with the owner's \u2014 one tap, and reversible from here", "adopt", "accent", false),
          row("keep", "Keep mine", "Dismisses the notice and nothing changes", "dismiss", "muted", false)])
      ], note: "A notice rather than a replacement: a member who arranged their own dashboard keeps it until they say otherwise." };
    }

    return { sections: [section("Your dashboard \u00b7 " + (entries || []).length + " widgets", listOf(entries))],
      note: locked
        ? "A locked layout: the widgets are the owner's choice and the arrange control is absent rather than disabled."
        : "One ordered list at two, four or six columns. Large takes two rows on a phone, so the three sizes have three outcomes." };
  }

  function dashboardDetail(id, ctx) {
    var D = get("HH_DASHBOARD");
    if (!has(D)) return null;
    var w = (D.byKey || {})[id] || (D.widgets || []).filter(function (x) { return x.key === id; })[0];
    if (!w) return null;
    return {
      title: w.title, sub: w.key + " \u00b7 " + w.size,
      facts: [["Module", w.module], ["Kind", w.kind || ""],
              ["Action", w.act ? w.act.verb + (w.act.hold ? " \u00b7 hold to complete" : "") : "read only"]],
      sections: [section("What it shows", (w.data || []).map(function (d, i) {
        return row("d" + i, d.title, d.meta, d.chip || "", d.tone || "", false); }))],
      note: w.says || ""
    };
  }

  /* ── Account: auth, the child path, devices, privacy ───────────────── */

  function account(ctx) {
    var A = get("HH_AUTH"), H = get("HH_HOUSEHOLD"), F = get("HH_FIXTURES");
    if (!has(A)) return null;
    var route = (ctx && ctx.route) || "/account";
    var who = (ctx && ctx.member) || "jana";
    var msgs = A.messages || [];

    function failures(prefixes, label) {
      var rows = msgs.filter(function (m) {
        for (var i = 0; i < prefixes.length; i++) { if (String(m[0]).indexOf(prefixes[i]) === 0) return true; }
        return false;
      }).map(function (m) {
        return row(m[0], m[2], m[5] || m[1], m[4] || "", m[3] ? "ok" : "warning", false);
      });
      return rows.length ? section(label || "What it says when it refuses", rows) : null;
    }

    if (route.indexOf("/must-update") === 0) {
      return { sections: [section("Five languages, all written", (A.update || []).map(function (u) {
        return row(u[0], u[1] + " \u00b7 " + u[2], u[3], u[4], u[5] ? "" : "warning", false); }))],
        note: "The one screen that has to work when the app can no longer talk to the server, so it carries its own copy in every launch language." };
    }

    if (route.indexOf("/account/delete") === 0) {
      return { sections: [section("Four situations, resolved before anything happens", (A.deletion || []).map(function (d, i) {
        return row("d" + i, d[0] + " \u00b7 " + d[1], d[3], d[2], d[2] === "blocked" ? "danger" : "muted", false); }))],
        note: "Each one names the object it affects. Nothing here is a generic 'are you sure'." };
    }

    if (route.indexOf("/account/privacy") === 0) {
      return { sections: [section("Your rights, as things you can do", ((H && H.rights) || []).map(function (r, i) {
        return row("r" + i, r[0], r[2], r[3], "", false); }))],
        note: "Named by what a person wants rather than by the article number, with the legal name beside it." };
    }

    if (route.indexOf("/account/devices") === 0) {
      var revoke = route.indexOf("/revoke") > 0;
      return { sections: [
        section("Signed in \u00b7 " + ((H && H.devices) || []).length, ((H && H.devices) || []).map(function (d, i) {
          return row("dev" + i, d.name, d.meta, revoke ? "revoke" : (d.action || ""), d.tone === "ok" ? "ok" : d.tone === "conflict" ? "danger" : "warning", false); })),
        revoke ? section("What revoking does", [
          row("r1", "The replica on that device is discarded", "Anything queued there and not yet sent is lost, and the screen says so by name before you confirm", "", "danger", false)]) : null
      ].filter(Boolean), note: "Each row carries its own sync position, so a device that looks signed in but is behind cannot hide." };
    }

    if (route.indexOf("/screens/a-30") === 0) {
      return { sections: [section("Six banner states \u00b7 active shows nothing", ((H && H.banners) || []).map(function (b, i) {
        return row("b" + i, b.title, b.stage + " \u00b7 " + b.body, b.dismissible ? "dismissible" : "stays",
          b.tone === "warning" ? "warning" : b.tone === "danger" ? "danger" : "", false); }))],
        note: "Eight entitlement states, six of which say something. Suspended is not a banner at all." };
    }

    if (route.indexOf("/join") === 0 || route.indexOf("/switch") === 0) {
      var childSecs = [failures(["child."], "What it says when the code or the PIN is wrong")].filter(Boolean);
      childSecs.push(section("The four rules the child path is designed against", (A.childRules || []).map(function (r, i) {
        return row("cr" + i, r[0], r[1], "", "", false); })));
      if (F) childSecs.unshift(section("Profiles on this device", (F.members || []).map(function (m) {
        return row(m.id, m.name, m.role + " \u00b7 " + (m.role === "child" ? "four digits" : "password"),
          m.device || "", m.role === "child" ? "accent" : "muted", false); })));
      return { sections: childSecs, note: "One picker, two methods. What differs is the next screen, not the shape of this one." };
    }

    if (route === "/account") {
      var me = ((F && F.members) || []).filter(function (m) { return m.id === who; })[0] || {};
      var mine = ((F && F.households) || []).filter(function (h) { return (h.members || []).indexOf(me.id) >= 0; });
      return { sections: [
        section("You", [
          row("name", "Name", me.name || "", "", "", false),
          row("role", "Role in this household", me.role || "", "", "", false),
          row("device", "Signed in on", me.device || "", "", "", false)]),
        section("Households \u00b7 " + mine.length, mine.map(function (h) {
          return row(h.id, h.name, (h.members || []).length + " members", "", "", false); })),
        section("Security", [
          row("2fa", "Two-step sign-in", "An authenticator code, with recovery codes kept offline", "on", "ok", false),
          row("dev", "Sessions and devices", ((H && H.devices) || []).length + " signed in", "review", "", false)])
      ], note: "Account settings are per person and cross every household, so nothing here belongs to one of them." };
    }

    var map = [
      ["/sign-in/2fa/recovery", ["mfa.recovery"]], ["/sign-in/2fa", ["mfa."]],
      ["/sign-in", ["signin.", "server"]], ["/register", ["register.", "password.breached"]],
      ["/verify", ["verify."]], ["/reset/set", ["password.breached"]], ["/reset", ["reset."]],
      ["/account/2fa", ["mfa."]], ["/account/notice", ["signin.", "server"]]
    ];
    for (var i = 0; i < map.length; i++) {
      if (route.indexOf(map[i][0]) === 0) {
        var sec = failures(map[i][1]);
        if (!sec) return null;
        return { sections: [sec],
          note: "Generic wherever enumeration is possible: one message and one response time for both halves of a wrong sign-in." };
      }
    }
    return null;
  }

  /* ── Platform: search, Today, the Add sheet, help ──────────────────── */

  function platform(ctx) {
    var SP = get("HH_SPINE");
    if (!has(SP)) return null;
    var route = (ctx && ctx.route) || "/help";
    var who = (ctx && ctx.member) || "jana";

    if (route.indexOf("/help") === 0) {
      var loc = (ctx && ctx.locale) || "en";
      var inLoc = function (h) { return SP.helpIn ? SP.helpIn(h, loc) : h; };
      var bySurf = {};
      (SP.help || []).forEach(function (h) { (bySurf[h.surface] = bySurf[h.surface] || []).push(h); });
      var secs = (SP.surfaces || []).map(function (s2) {
        return section(s2[1] + " \u00b7 " + s2[2], (bySurf[s2[0]] || []).map(function (h) {
          var l = inLoc(h);
          return row(h.id, l.title, l.body, h.hard ? "hard screen" : "", h.hard ? "accent" : "", false); }));
      });
      secs.push(section("What decides the surface", (SP.surfaces || []).map(function (s2) {
        return row("rule-" + s2[0], s2[1], s2[3], "", "muted", false); })));
      var langs = SP.helpLangs ? SP.helpLangs() : null;
      return { sections: secs,
        note: "The content picks the surface. Nobody chooses a panel because a panel looks more thorough." +
          (langs ? " " + langs.twoLanguages + " of " + langs.entries + " entries carry both shipping languages, and the rail switches between them." : "") };
    }

    if (route.indexOf("/result-row") === 0) {
      return { sections: [
        section("The row's fields", (SP.hitShape || []).map(function (f) {
          return row(f[0], f[0], f[2], f[1], f[1] === "nullable" ? "muted" : "", false); })),
        section("Where rows come from \u00b7 " + (SP.scopes || []).length + " scopes", (SP.scopes || []).map(function (sc) {
          return row(sc.key, sc.moduleName + " \u00b7 " + sc.key, sc.fields, "", "muted", false); }))
      ], note: "A row with no snippet closes up rather than reserving the line, and a module with no path does not invent a breadcrumb." };
    }

    if (route.indexOf("/today") === 0) {
      var td = null;
      try { td = SP.today(who); } catch (e) { td = null; }
      if (!td) return null;
      return { sections: (td.blocks || []).map(function (b) {
        return section((b.label || b.id) + " \u00b7 " + (b.rows || []).length, (b.rows || []).map(function (r) {
          return row(r.id, r.title, r.meta, r.moduleName, r.severity === "warning" ? "warning" : "", true); }));
      }), note: "A group with nothing in it is not rendered at all, so a quiet day is a short screen rather than five empty headings." };
    }

    if (route.indexOf("/add") === 0) {
      var sh = null;
      try { sh = SP.addSheet(who); } catch (e) { sh = null; }
      if (!sh) return null;
      var ent = sh.entries || [];
      return { sections: [
        section("On the sheet \u00b7 " + Math.min(ent.length, SP.slots || 6), ent.slice(0, SP.slots || 6).map(function (e, i) {
          return row(e.key, (i + 1) + ". " + e.label, e.capture, String(e.score), "", false); })),
        section("Ranked but below the fold", ent.slice(SP.slots || 6).map(function (e) {
          return row(e.key, e.label, e.capture, String(e.score), "muted", false); }))
      ], note: "The window moves slowly and never reorders while the sheet is open, so the thing that was second stays second." };
    }
    return null;
  }

  /* ── registry ──────────────────────────────────────────────────────── */

  var BUILD = {
    tasks: tasks, reminders: reminders, calendar: calendar, chores: chores,
    notes: notes, documents: documents, finance: finance, utilities: utilities,
    garden: garden, chat: chat, activity: activity, admin: admin,
    sync: sync, nav: navigation,
    shopping: shopping, dashboard: dashboard, account: account, platform: platform,
    property: function (c) { return assets("property", c); },
    vehicles: function (c) { return assets("vehicles", c); },
    pets: function (c) { return assets("pets", c); }
  };

  var DETAIL = {
    tasks: taskDetail, calendar: calendarDetail, chores: choreDetail, notes: noteDetail,
    documents: docDetail, finance: financeDetail, utilities: utilityDetail, garden: gardenDetail,
    chat: chatDetail, sync: syncDetail,
    shopping: shoppingDetail, dashboard: dashboardDetail,
    property: assetDetail, vehicles: assetDetail, pets: assetDetail
  };

  /* Does this module draw a body for this particular route? The four route-addressed
     modules answer differently per screen, so the shell asks rather than assumes. */
  function routed(moduleId, route, ctx) {
    var c = {}, k;
    for (k in (ctx || {})) { if (Object.prototype.hasOwnProperty.call(ctx, k)) c[k] = ctx[k]; }
    if (route) c.route = route;
    var b = build(moduleId, c);
    return !!(b && b.sections && b.sections.length);
  }

  /* The helpers a per-screen body is written against, handed to screenbodies.js so a
     route body reads its module's file the same way a module body does. */
  var HELPERS = { section: section, row: row, day: day, money: money, pick: pick,
                  daysBetween: daysBetween, TODAY: TODAY, get: get };

  function build(moduleId, ctx) {
    var c0 = ctx || {};
    /* Stage 22: a declared route with a body of its own answers before the module's
       default list. A route with no entry, or one that fails, falls through to it. */
    if (c0.route && window.HH_BODIES) {
      var own = window.HH_BODIES.build(c0.route, c0, HELPERS);
      if (own) { own.module = moduleId; walkable(own, c0); return own; }
    }
    var fn = BUILD[moduleId];
    if (!fn) return null;
    var out = null;
    try { out = fn(ctx || {}); } catch (e) { out = { sections: [], note: "", error: String(e.message || e) }; }
    if (!out) return null;
    out.sections = (out.sections || []).filter(function (s) { return s && s.rows && s.rows.length; });
    out.count = out.sections.reduce(function (a, s) { return a + s.rows.length; }, 0);
    return out;
  }

  /* A row may only be deep if the click has somewhere to land: either its id is a
     declared route (a hub row, which the shell honours before the deep id), or the
     module the shell would ask — the route's own head — resolves it to a detail. */
  function walkable(out, ctx) {
    var SC = window.HH_SCREENS;
    var head = String(ctx.route || "").split("/").filter(Boolean)[0] || "";
    var canDetail = head && Object.keys(DETAIL).indexOf(head) >= 0;
    (out.sections || []).forEach(function (sec) {
      (sec.rows || []).forEach(function (r) {
        if (!r.deep || r.route) return;
        if (r.id && String(r.id).charAt(0) === "/") {
          if (SC && SC.get(r.id)) { r.route = r.id; } else { r.deep = false; }
          return;
        }
        if (!r.id || !canDetail) { r.deep = false; return; }
        var hit = null;
        try { hit = detail(head, r.id, ctx); } catch (e) { hit = null; }
        r.deep = !!hit;
      });
    });
  }

  function detail(moduleId, id, ctx) {
    var fn = DETAIL[moduleId];
    if (!fn) return null;
    try { return fn(id, ctx || {}); } catch (e) { return null; }
  }

  window.HH_SURFACES = {
    version: "0.1-stage-22",
    helpers: HELPERS,
    perScreen: function () { return window.HH_BODIES ? window.HH_BODIES.count() : 0; },
    today: TODAY,
    modules: Object.keys(BUILD),
    hasDetail: function (m) { return !!DETAIL[m]; },
    build: build, detail: detail, routed: routed, money: money, day: day, pick: pick
  };
})();
