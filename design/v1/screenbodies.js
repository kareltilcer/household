/* Stage 22 — the per-screen bodies.

   surfaces.js gave every module one body: ask Finance for a surface and you got the
   ledger, whichever of its seventeen screens you were standing on. That was the plan's
   own admitted gap — the bespoke bodies lived in the stage artifacts and the application
   drew the module's default list underneath every route's chrome.

   This file closes it. One entry per declared route, keyed by the path screens.js
   registers, each reading the module's own file — HH_FINANCE, HH_UTILITIES, HH_GARDEN
   and the rest — so a screen here still cannot drift from the stage that argued it.
   A route with no entry falls back to the module body, and an entry that throws or
   returns nothing falls back too: this file can only add, never subtract.

   H, passed in by surfaces.js: { section, row, day, money, pick, daysBetween, TODAY, get }
*/
(function () {
  "use strict";

  var B = {};
  function def(path, fn) { B[path] = fn; }
  function G(n) { return window[n]; }

  /* Several module files carry their rows as tuples or as prose objects rather than as
     the {title, meta} shape a list row wants. These two read either without guessing. */
  function words(v) {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) return v.filter(function (x) { return x && typeof x !== "object"; }).join(" \u00b7 ");
    if (typeof v === "object") {
      return v.label || v.name || v.title || v.says || v.cs || v.en || v.text || v.body || "";
    }
    return String(v);
  }
  function tuple(H, v, i) {
    if (Array.isArray(v)) {
      return H.row("", String(v[0] === undefined ? "" : v[0]), v.slice(1, 3).filter(function (x) {
        return x && typeof x !== "object";
      }).join(" \u00b7 "), v.length > 3 && typeof v[3] !== "object" ? String(v[3]) : "");
    }
    if (v && typeof v === "object") {
      var title = words(v);
      if (!title) {
        /* a row the generic renderer has no label for: build one from its own scalar
           fields rather than drawing an empty line */
        title = Object.keys(v).filter(function (k) {
          return typeof v[k] === "string" || typeof v[k] === "number";
        }).slice(0, 2).map(function (k) { return v[k] + (k === "gb" ? " GB" : ""); }).join(" \u00b7 ");
      }
      if (!title) return null;
      return H.row(v.id || "", title, v.says || v.why || v.note || v.meta || v.body || "",
                   v.right || v.state || v.when || v.level || "");
    }
    return H.row("", String(v), "", "");
  }
  function tuples(H, label, list, cap) {
    return H.section(label, (list || []).slice(0, cap || 40)
      .map(function (v, i) { return tuple(H, v, i); })
      .filter(function (r) { return r && (r.title || r.meta || r.right); }));
  }
  /* A pair whose value is a sentence rather than a token: the value belongs in
     meta, which wraps full-width under the label, not in the right-hand slot,
     which is sized to a token and would starve the label to nothing. */
  function facts(H, label, pairs) {
    return H.section(label, (pairs || []).filter(function (p) { return p && p[1] !== undefined && p[1] !== null && p[1] !== ""; })
      .map(function (p) {
        var v = String(p[1]);
        return v.length > 28 ? H.row("", String(p[0]), v, "") : H.row("", String(p[0]), "", v);
      }));
  }
  /* module files carry timestamps as ISO or as "2026-08-30 18:02"; every screen shows
     them the way H.day shows a date, with the clock kept where there is one */
  function when(H, v) {
    if (!v) return "";
    var str = String(v).replace("T", " ");
    var d = str.slice(0, 10), rest = str.slice(11, 16);
    return H.day(d) + (rest ? " " + rest : "");
  }

  function tryv(fn, fallback) { try { var v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; } }
  function last(seg) { var p = String(seg).split("?")[0].split("#")[0].split("/").filter(Boolean); return p[p.length - 1] || ""; }

  /* ── Reminders ─────────────────────────────────────────────────────── */

  def("/reminders/new", function (ctx, H) {
    var R = G("HH_REMINDERS"); if (!R) return null;
    var own = R.own || {};
    return { sections: [
      facts(H, "The reminder you write yourself", [
        ["What", own.label || "A reminder of your own"],
        ["Kind", own.key || "reminders.own"],
        ["Attached to", own.entity || "nothing — it stands alone"],
        ["Completion", own.scope === "personal" ? "personal" : (own.scope || "personal")],
        ["Due", "a day, not an instant \u2014 due_on carries no time"]
      ]),
      tuples(H, "Lead time offered", R.leadSet, 10),
      H.section("Delivery classes", (R.classes || []).map(function (c) {
        var lead = c.days === 0 ? "on the day"
                 : (c.days === null || c.days === undefined)
                   ? (c.id === "notice" ? "from the contract\u2019s notice period" : "per type")
                   : c.days + (c.days === 1 ? " day" : " days");
        return H.row(c.id, c.label, c.why || "", lead + " \u00b7 " +
                     (c.channel === "in_app" ? "in-app" : c.channel));
      }))
    ], note: "The editor writes one kind: reminders.own. The twenty-one the modules register are subscribed to, not written." };
  });

  def("/reminders/subscriptions", function (ctx, H) {
    var R = G("HH_REMINDERS"); if (!R) return null;
    var subs = tryv(function () { return R.subscriptionsFor(ctx.member) || []; }, []);
    if (!subs.length) return null;
    var changed = subs.filter(function (s) { return s.changed; });
    var offered = subs.filter(function (s) { return !s.changed && s.offered !== false; });
    var withheld = subs.filter(function (s) { return s.offered === false; });
    function r(s) {
      return H.row(s.key, s.label, s.module + " \u00b7 " + (s.scope || "") + (s.why ? " \u00b7 " + s.why : ""),
                   s.label2 || s.preset || "", s.changed ? "accent" : "");
    }
    return { sections: [
      H.section("Changed from the default", changed.map(r)),
      H.section("On the default", offered.map(r)),
      H.section("Not offered \u2014 the grant is missing", withheld.map(r))
    ], note: subs.length + " subscribable kinds. Defaults are designed; this screen is for the minority who change them." };
  });

  def("/reminders#c-14", function (ctx, H) {
    var R = G("HH_REMINDERS"); if (!R) return null;
    var occ = (R.occurrences || [])[0];
    var kind = occ ? (R.allKinds || R.kinds || []).filter(function (k) { return k.key === occ.kind; })[0] : null;
    return { sections: [
      facts(H, "Not now", [
        ["Reminder", occ ? occ.title : ""],
        ["Kind", occ ? occ.kind : ""],
        ["Due", occ ? H.day(occ.due) : ""],
        ["Completion scope", kind ? (kind.scope || "") : ""],
        ["Snoozing", "personal, even where completion is shared"]
      ]),
      tuples(H, "How long", R.leadSet, 8)
    ], note: "Snooze moves your copy of the reminder. Nobody else's row changes, and the underlying due day does not move." };
  });

  def("/reminders#finance.cancellation_window", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    var w = tryv(function () { return F.cancellationWindows() || []; }, []);
    if (!w.length) return null;
    return { sections: [
      H.section("The window", w.map(function (x) {
        return H.row(x.rec, x.name, x.says || "", H.day(x.fires), "warning");
      })),
      facts(H, "Why this day", [
        ["Renews", H.day(w[0].renews)],
        ["Notice period", w[0].notice + " days"],
        ["Reminder fires", H.day(w[0].fires)],
        ["Amount", H.money(w[0].amount)]
      ])
    ], note: "The last day the household can cancel without paying for another term \u2014 counted back from the renewal, not from the charge." };
  });

  /* ── Tasks ─────────────────────────────────────────────────────────── */

  function cardBySlug(T, slug) {
    return (T.cards || []).filter(function (c) {
      return c.id === slug || String(c.id).indexOf(slug) >= 0 ||
             String(c.title || "").toLowerCase().indexOf(slug) >= 0;
    })[0] || null;
  }

  def("/tasks/new", function (ctx, H) {
    var T = G("HH_TASKS"); if (!T) return null;
    return { sections: [
      H.section("Start from a template", (T.templates || []).map(function (t) {
        return H.row(t.id, t.name, t.why || "", (t.columns || []).length + " columns");
      })),
      H.section("Columns", (T.templates || []).map(function (t) {
        return H.row("", t.name, (t.columns || []).map(function (c) { return c.name || c; }).join(" \u2192 "), "");
      }))
    ], note: "Four starter templates. A board can also start empty \u2014 the templates are a shortcut, not a gate." };
  });

  def("/tasks/dum/labels", function (ctx, H) {
    var T = G("HH_TASKS"); if (!T) return null;
    return { sections: [
      H.section("Labels on this board", (T.labelSet || []).map(function (l) {
        var used = (T.cards || []).filter(function (c) { return (c.labels || []).indexOf(l.id) >= 0 || (c.labels || []).indexOf(l.name) >= 0; }).length;
        return H.row(l.id, l.name, l.colour ? "colour " + l.colour + " \u00b7 and the word" : "", used + " cards");
      }))
    ], note: "A label is a colour and a word. The word is what the row reads out, so a colour-blind member loses nothing." };
  });

  def("/tasks/dum/columns", function (ctx, H) {
    var T = G("HH_TASKS"); if (!T) return null;
    var b = (T.boards || [])[0]; if (!b) return null;
    return { sections: [
      H.section("Columns", (b.columns || []).map(function (c, i) {
        var v = (T.vocab || []).filter(function (x) { return x.kind === c.kind; })[0];
        return H.row(c.id, c.name, v ? v.effect : "", (i + 1) + " of " + b.columns.length);
      })),
      H.section("Column types", (T.vocab || []).map(function (v) {
        return H.row(v.kind, v.label, v.effect || "", v.pick || "");
      }))
    ], note: "kind surfaces as what the column does to a card, never as the word kind." };
  });

  def("/tasks/chata/cards/firewood/move", function (ctx, H) {
    var T = G("HH_TASKS"); if (!T) return null;
    var card = cardBySlug(T, "firewood") || cardBySlug(T, "drevo");
    var proof = tryv(function () { return T.moveProof(); }, null);
    return { sections: [
      facts(H, "The card", [["Card", card ? card.title : "\u2014"], ["Board", card ? card.board : ""],
                            ["Column", card ? card.col : ""], ["Assignee", card ? (card.assignee || "nobody") : ""]]),
      H.section("Move to", (T.boards || []).map(function (b) {
        return H.row(b.id, b.name, (b.columns || []).map(function (c) { return c.name; }).join(" \u00b7 "),
                     card && b.id === card.board ? "current" : "", card && b.id === card.board ? "muted" : "");
      })),
      proof ? facts(H, "What the move does", [
        ["Into done", proof.intoDone ? (proof.intoDone.id + " \u00b7 stamped " + when(H, proof.intoDone.doneAt)) : ""],
        ["Out of done", proof.outOfDone ? (proof.outOfDone.id + " \u00b7 stamp cleared") : ""]
      ]) : null
    ].filter(Boolean), note: "A cross-board move keeps the card's identity, its comments and its checklist. Its column becomes the target board's own." };
  });

  function cardScreen(slug, which) {
    return function (ctx, H) {
      var T = G("HH_TASKS"); if (!T) return null;
      var c = cardBySlug(T, slug); if (!c) return null;
      var checks = (T.checklists || []).filter(function (k) { return k.card === c.id; });
      var comments = (T.comments || []).filter(function (m) { return m.card === c.id; });
      var items = [];
      checks.forEach(function (k) { (k.items || []).forEach(function (it) { items.push(it); }); });
      var secs = [];
      if (which !== "comments") {
        secs.push(facts(H, "The card", [
          ["Board", c.board], ["Column", tryv(function () { return T.colName(c); }, c.col)],
          ["Labels", (c.labels || []).join(", ") || "none"],
          ["Due", c.due ? H.day(c.due) : "no date"],
          ["Assignee", c.assignee || "nobody yet"]
        ]));
      }
      if (which !== "comments") {
        secs.push(H.section("Checklist", items.map(function (it, i) {
          var done = it.done || it.checked;
          return H.row("i" + i, (done ? "\u2713 " : "\u25cb ") + (it.text || it.title || words(it)), "", "", done ? "muted" : "");
        })));
      }
      secs.push(H.section("Comments", comments.map(function (m, i) {
        return H.row("m" + i, m.text || "", (m.who || "") + " \u00b7 " + (m.at || "") +
                     ((m.mentions || []).length ? " \u00b7 mentions " + m.mentions.join(", ") : ""), "");
      })));
      return { sections: secs.filter(function (s) { return s.rows.length; }),
               note: which === "checklist"
                 ? "A checklist item is not a task: it has no due date, no assignee and no reminder of its own."
                 : which === "comments"
                 ? "A mention notifies in the direct category. Who may be mentioned is the one line FR-TA9 never wrote."
                 : "A card is lww_field: two members editing different fields both succeed." };
    };
  }
  def("/tasks/dum/cards/plumber", cardScreen("plumber", "comments"));

  /* ── Notes ─────────────────────────────────────────────────────────── */

  def("/notes/pinned", function (ctx, H) {
    var N = G("HH_NOTES"); if (!N) return null;
    var p = tryv(function () { return N.pinsFor(ctx.member); }, null);
    var rows = (p && p.rows) || [];
    if (!rows.length) {
      return { sections: [H.section("Nothing pinned", [
        H.row("", "You have not pinned a note yet",
              "Pin the ones you look up in a hurry — the water stopcock, the boiler code — and they stay at the top for you.",
              "", "muted")
      ])], note: "Two scopes, one list. A household pin would show here too, and this household has none for you." };
    }
    return { sections: [
      H.section("For everyone", rows.filter(function (r) { return r.scope === "household"; }).map(function (r) {
        return H.row(r.id, r.title, "pinned " + H.day(r.at) + (r.alsoPersonal ? " \u00b7 also pinned by you" : ""), r.label || "", "", true);
      })),
      H.section("Just for you", rows.filter(function (r) { return r.scope !== "household"; }).map(function (r) {
        return H.row(r.id, r.title, "pinned " + H.day(r.at), r.label || "", "", true);
      }))
    ], note: "Two scopes, one list. Unpinning the household pin does not unpin yours." };
  });

  def("/notes/search", function (ctx, H) {
    var N = G("HH_NOTES"); if (!N) return null;
    var q = ((N.queries || [])[0] || {}).q || "uz\u00e1v\u011br";
    var res = tryv(function () { return N.search(q, ctx.member); }, null);
    if (!res) return null;
    return { sections: [
      H.section("\u201c" + q + "\u201d", (res.hits || []).map(function (h) {
        return H.row(h.id, h.title, h.path + (h.snippet ? " \u00b7 " + h.snippet : ""), h.root, "", true);
      })),
      facts(H, "What was searched", [
        ["Roots you can read", String(res.searched) + " of " + String(res.roots)],
        ["Excluded", (res.excludedRoots || []).join(", ") || "none"],
        ["Notes considered", String(res.considered)],
        ["Hidden by a grant", String(res.hidden)]
      ])
    ], note: "Diacritics fold both ways: uzaver finds uz\u00e1v\u011br. Whether an owner's search reaches a child's private root is still open." };
  });

  def("/notes/shared/dum/kde-je-hlavni-uzaver-vody", function (ctx, H) {
    var N = G("HH_NOTES"); if (!N) return null;
    var n = (N.notes || []).filter(function (x) { return x.slug === "kde-je-hlavni-uzaver-vody" || x.id === "n-uzaver"; })[0];
    if (!n) return null;
    return { sections: [
      facts(H, "The note", [["Root", n.root], ["Path", tryv(function () { return N.pathOf(n.id); }, n.slug)],
                            ["Language", n.lang], ["Last edit", H.day(n.updated) + " by " + n.by],
                            ["Inline images", String(n.images || 0)]]),
      H.section("Body", [H.row("", n.body || "", "", "")]),
      H.section("Who has written in it", tryv(function () {
        return (N.contributors(n.id) || []).map(function (c) { return H.row("", words(c), "", ""); });
      }, []))
    ], note: "WYSIWYG with a raw Markdown toggle. The body is one field, and it is lww_field \u2014 which is what makes the thirty-day loser necessary." };
  });

  def("/notes/shared/dum/kde-je-hlavni-uzaver-vody#c-27", function (ctx, H) {
    var N = G("HH_NOTES"); if (!N) return null;
    var c = N.conflict; if (!c) return null;
    var st = tryv(function () { return N.loserState(c.note); }, null);
    return { sections: [
      facts(H, "A longer version was replaced", [
        ["Note", c.note], ["Kept", words(c.winner)], ["Replaced", words(c.loser)],
        ["Superseded", when(H, c.supersededAt)], ["Offered for", (N.loserDays || 30) + " days"],
        ["State", st ? words(st) : ""]
      ]),
      H.section("The version that lost", [H.row("", (c.loser && (c.loser.body || c.loser.text)) || words(c.loser), "", "")])
    ], note: "The banner offers the overwritten body rather than restoring it. Nobody is told they were overwritten by name." };
  });

  def("/notes/dum/malovani", function (ctx, H) {
    var N = G("HH_NOTES"); if (!N) return null;
    var g = N.goneCopy || {};
    return { sections: [
      H.section("That note was renamed", [H.row("", g.title || "", g.body || "", "")]),
      H.section("What the resolver found", (N.renames || []).map(function (r) {
        return H.row(r.id, r.was + " \u2192 " + r.now, (r.what || "") + " \u00b7 " + H.day(r.at) + " by " + r.by, r.root, "", true);
      })),
      tuples(H, "What you can do", g.actions, 4)
    ], note: "A renamed slug resolves through the rename log rather than 404ing blind: the page names the note it became." };
  });

  /* ── Documents ─────────────────────────────────────────────────────── */

  function docBySlug(D, slug) {
    return (D.docs || []).filter(function (d) {
      return d.id === slug || String(d.id).indexOf(slug) >= 0 ||
             String(d.title || "").toLowerCase().indexOf(slug) >= 0;
    })[0] || null;
  }

  def("/documents/upload", function (ctx, H) {
    var D = G("HH_DOCS"); if (!D) return null;
    var tl = tryv(function () { return D.uploadTimeline() || []; }, []);
    if (!tl.length) return null;
    return { sections: [
      H.section("Step by step", tl.map(function (s, i) {
        return H.row("s" + i, s.step, s.phone || "", s.status || "", s.offline ? "warning" : "");
      }))
    ], note: "The row exists before its bytes. That is why a document can be named, filed and referenced while the upload is still queued." };
  });

  def("/documents/shared/byt/inventura", function (ctx, H) {
    var D = G("HH_DOCS"); if (!D) return null;
    var d = docBySlug(D, "inventura"); if (!d) return null;
    return { sections: [
      facts(H, "The document", [["Type", d.type], ["Folder", tryv(function () { return (D.folderOf(d.folder) || {}).name; }, d.folder)],
                                ["Size", tryv(function () { return D.mb(d.bytes); }, d.bytes + " kB")],
                                ["Added by", d.by], ["Preview", d.previewKind + " \u00b7 " + d.previewStatus],
                                ["Expires", d.expires ? H.day(d.expires) : "does not expire"]]),
      H.section("Referenced from", tryv(function () {
        return (D.referencesTo(d.id) || []).map(function (r) { return H.row("", r.module + " \u00b7 " + r.entity, r.says || r.what, ""); });
      }, []))
    ], note: "Preview, thumbnail, raw and download are four endpoints over one file, and each answers differently by type." };
  });

  def("/documents/shared/byt/pudorys", function (ctx, H) {
    var D = G("HH_DOCS"); if (!D) return null;
    var d = docBySlug(D, "pudorys") || docBySlug(D, "svg"); if (!d) return null;
    return { sections: [
      facts(H, "The file", [["Declared type", d.declared], ["Sniffed", d.sniffMismatch ? "does not match" : "matches"],
                            ["Preview", d.previewKind + " \u00b7 " + d.previewStatus]])
    ], note: "An active type is served as a download and never inline. The refusal is the design, not a limitation to apologise for." };
  });

  def("/documents/shared/doklady/pas-jana", function (ctx, H) {
    var D = G("HH_DOCS"); if (!D) return null;
    var rows = tryv(function () { return D.expiryRows(ctx.member) || []; }, []);
    if (!rows.length) return null;
    return { sections: [
      H.section("Expiring", rows.map(function (r) {
        return H.row(r.id, r.title, r.cs + " \u00b7 lead " + r.lead + " days \u00b7 window opens " + H.day(r.opens),
                     H.day(r.expires), r.inWindow ? "warning" : "", true);
      })),
      H.section("Document types", (D.types || []).map(function (t) {
        return H.row(t.id, t.en + " \u00b7 " + t.cs, t.why || "", t.lead ? t.lead + " days" : "no lead stated",
                     t.stated ? "" : "muted");
      }))
    ], note: "Two lead times are stated in the handoff and nine are not. The catalog is country-aware and enumerated nowhere \u2014 still open." };
  });

  def("/documents/shared/faktury", function (ctx, H) {
    var D = G("HH_DOCS"); if (!D) return null;
    var sel = tryv(function () { return D.selection(D.bulkSelection); }, null);
    if (!sel) return null;
    return { sections: [
      H.section((sel.docs || []).length + " selected", (sel.docs || []).map(function (d) {
        return H.row(d.id, d.title, d.type + (d.attachment !== "ready" ? " \u00b7 " + d.attachment : ""),
                     tryv(function () { return D.mb(d.bytes); }, ""), d.attachment !== "ready" ? "warning" : "");
      })),
      facts(H, "What the four actions would do", [
        ["Move", "one write per row, no bytes touched"],
        ["Archive", "reversible; the rows stay searchable"],
        ["Download as zip", "one row's bytes have not arrived \u2014 what the zip does is unstated (FR-DO11)"],
        ["Delete", tryv(function () { return words(D.deleteWarning(sel.ids)); }, "names what points at each file")]
      ])
    ], note: "Bulk actions name the objects. The pending row is the one that makes the zip question real rather than theoretical." };
  });

  def("/documents/storage", function (ctx, H) {
    var D = G("HH_DOCS"); if (!D) return null;
    var t = tryv(function () { return D.totals(); }, null); if (!t) return null;
    var split = tryv(function () { return D.splitBy("folder") || D.splitBy("type"); }, null);
    var big = tryv(function () { return D.largest(6) || []; }, []);
    return { sections: [
      facts(H, "What Documents is using", [
        ["Files", String(t.count)],
        ["Originals", t.originalsGB.toFixed(2) + " GB"],
        ["Derived \u2014 thumbnails and previews", t.derivedGB.toFixed(2) + " GB"],
        ["Overhead", t.overheadPct.toFixed(1) + " %"],
        ["Notes images", t.notesGB.toFixed(2) + " GB"]
      ]),
      H.section("Largest files", (big || []).map(function (d) {
        return H.row(d.id, d.title, d.type || "", tryv(function () { return D.mb(d.bytes); }, ""), "", true);
      })),
      split ? H.section("Split", (Array.isArray(split) ? split : (split.rows || [])).map(function (x) {
        return H.row("", x.name, x.n + " files" + (x.derived ? " \u00b7 " + tryv(function () { return D.mb(x.derived); }, "") + " of it derived" : ""),
                     tryv(function () { return D.mb(x.bytes); }, ""));
      })) : null
    ].filter(Boolean), note: "Derived bytes are counted and named. Deleting a file recovers both its original and its derivatives, and the screen says how much." };
  });

  def("/documents/shared/auto/servisni-faktura", function (ctx, H) {
    var D = G("HH_DOCS"); if (!D) return null;
    var d = docBySlug(D, "servis"); if (!d) return null;
    var refs = tryv(function () { return D.referencesTo(d.id) || []; }, []);
    return { sections: [
      H.section("This is used somewhere else", refs.map(function (r) {
        return H.row("", r.module + " \u00b7 " + r.entity, r.says || r.what || "", "", "warning", true);
      })),
      facts(H, "The document", [["Title", d.title], ["Type", d.type], ["Added by", d.by],
                                ["Size", tryv(function () { return D.mb(d.bytes); }, "")]])
    ], note: "The warning names what points at the file. It does not block: a household may delete a file another module quotes." };
  });

  /* ── Chores ────────────────────────────────────────────────────────── */

  def("/chores/week", function (ctx, H) {
    var C = G("HH_CHORES"); if (!C) return null;
    var start = tryv(function () { return C.weekStart(H.TODAY); }, "2026-09-07");
    var g = tryv(function () { return C.weekGrid(start); }, null);
    if (!g || !g.days) return null;
    return { sections: (g.days || []).map(function (d) {
      var rows = [];
      (d.cells || []).forEach(function (cell) {
        (cell.items || []).forEach(function (it) {
          rows.push(H.row(it.chore, it.name, cell.name, it.done ? "done" : (it.late ? "late" : ""),
                          it.done ? "muted" : (it.late ? "danger" : "")));
        });
      });
      return H.section(d.label + " " + d.date + (d.today ? " \u00b7 today" : ""), rows);
    }).filter(function (s) { return s.rows.length; }),
      note: (g.members || []).length + " members across seven days. On a phone the grid pivots to a day list; at 200 % text it pivots at twelve members too." };
  });

  def("/chores/all", function (ctx, H) {
    var C = G("HH_CHORES"); if (!C) return null;
    return { sections: [
      H.section("All chores", (C.chores || []).map(function (c) {
        return H.row(c.id, H.pick(c, ctx, "name", "cs"),
                     (c.sched ? c.sched.says : "") + " \u00b7 " + c.room + " \u00b7 " + c.minutes + " min",
                     c.points + " pts", "", true);
      })),
      H.section("Scheduling", (C.scheduleKinds || []).map(function (k) {
        return H.row(k.kind, k.label, k.says || k.why || "", k.example || "");
      })),
      H.section("Assignment", (C.modes || []).map(function (m) {
        return H.row(m.mode, m.label, m.says || m.why || "", m.advancesOnComplete ? "advances on complete" : "");
      }))
    ], note: "Four schedule kinds and four assignment modes. Everything else on a chore is a field, not a mode." };
  });

  def("/chores/bins/edit", function (ctx, H) {
    var C = G("HH_CHORES"); if (!C) return null;
    var c = tryv(function () { return C.choreOf("bins"); }, null) ||
            (C.chores || []).filter(function (x) { return String(x.id).indexOf("bins") >= 0; })[0];
    if (!c) return null;
    return { sections: [
      facts(H, "The chore", [["Name", c.name], ["Room", c.room], ["Minutes", String(c.minutes)],
                             ["Points", String(c.points)],
                             ["Schedule", c.sched ? c.sched.kind + " \u2014 " + c.sched.says : ""],
                             ["Assignment", c.mode + (c.rotation ? " \u00b7 " + c.rotation.join(" \u2192 ") : "")],
                             ["Verification", c.verify ? "an owner confirms it" : "none"],
                             ["Last done", c.last ? H.day(c.last.on) + " by " + c.last.by : "never"]]),
      H.section("Whose turn it is next", tryv(function () {
        return (c.rotation || []).map(function (m, i) {
          return H.row(m, m, i === c.rotIndex ? "next" : "", "", i === c.rotIndex ? "accent" : "");
        });
      }, []))
    ], note: "Completion is household scope: the rotation says whose turn it is, not whose obligation it is." };
  });

  def("/chores/points/adam", function (ctx, H) {
    var C = G("HH_CHORES"); if (!C) return null;
    var entries = (C.pointEntries || []).filter(function (e) { return e.member === "adam"; });
    if (!entries.length) return null;
    return { sections: [
      H.section("Awards", entries.map(function (e) {
        return H.row(e.id, e.reason || e.kind, (e.actor || "") + " \u00b7 " + H.day(e.on) + (e.chore ? " \u00b7 " + e.chore : ""),
                     (e.delta > 0 ? "+" : "") + e.delta, e.delta < 0 ? "warning" : "");
      })),
      facts(H, "Balance", [["Adam", String(tryv(function () { return C.balanceOf("adam"); }, ""))],
                           ["Streak", String(tryv(function () { return words(C.streakOf("adam")); }, ""))]])
    ], note: "No leaderboard. A child sees their own ledger and nobody else's total." };
  });

  def("/chores/rewards", function (ctx, H) {
    var C = G("HH_CHORES"); if (!C) return null;
    var b = tryv(function () { return C.rewardBoard(ctx.member === "adam" ? "adam" : "adam"); }, null);
    if (!b) return null;
    return { sections: [
      H.section("Rewards \u00b7 " + b.balance + " points", (b.rows || []).map(function (r) {
        return H.row(r.id, r.name, r.says || r.refusal || "", r.cost + " pts",
                     r.affordable ? "" : "muted");
      })),
      H.section("Asked for", (C.redemptions || []).map(function (r) {
        return H.row(r.id, tryv(function () { return (C.rewardOf(r.reward) || {}).name; }, r.reward),
                     r.member + " \u00b7 " + H.day(r.requested) + (r.decidedBy ? " \u00b7 decided by " + r.decidedBy : ""),
                     r.state, r.state === "refused" ? "warning" : "");
      }))
    ], note: "A reward a child cannot afford states what it would take, rather than being hidden or greyed." };
  });

  def("/chores/verify", function (ctx, H) {
    var C = G("HH_CHORES"); if (!C) return null;
    var q = tryv(function () { return C.verificationQueue() || []; }, []);
    if (!q.length) return null;
    return { sections: [
      H.section("To check", q.map(function (v) {
        return H.row(v.chore, v.name, [v.by, when(H, v.at), v.says].filter(Boolean).join(" \u00b7 "),
                     "+" + v.points, "warning");
      })),
      H.section("The two answers", (q[0].actions || []).map(function (a, i) {
        return H.row("a" + i, a, i === 0 ? "points land and the row says who confirmed" : "the row goes back, with the reason attached", "");
      }))
    ], note: "Verification is per chore, not per household. Only the chores that ask for it arrive here." };
  });

  def("/chores/swaps", function (ctx, H) {
    var C = G("HH_CHORES"); if (!C) return null;
    var rows = tryv(function () { return C.swapRows() || []; }, []);
    if (!rows.length) return null;
    return { sections: [
      H.section("Swaps", rows.map(function (s) {
        return H.row(s.id, s.line || (s.from + " \u2192 " + s.to), s.note || "", s.state,
                     s.state === "accepted" ? "" : s.state === "refused" ? "warning" : "muted");
      }))
    ], note: "A swap moves one occurrence, never the rotation. The next turn still belongs to whoever it belonged to." };
  });

  def("/chores/prune", function (ctx, H) {
    var C = G("HH_CHORES"); if (!C) return null;
    var rows = tryv(function () { return C.staleRows() || []; }, []);
    if (!rows.length) return null;
    return { sections: [
      H.section("Nobody has done these", rows.map(function (r) {
        return H.row(r.id, r.name, r.late + " days late \u00b7 untouched for " + r.untouchedDays + " days \u00b7 " +
                     r.escalations + " escalations", r.assignee || "unassigned", "warning");
      })),
      H.section("What the screen asks", rows.map(function (r) {
        return H.row("q" + r.id, tryv(function () { return words(C.pruneCopy(r.id)); }, "Is this still a chore?"), "", "");
      }))
    ], note: "Owner-facing and quiet: a chore nobody does is a question about the chore, not a failure to nag harder." };
  });

  /* ── Activity ──────────────────────────────────────────────────────── */

  def("/activity/entity/documents.document/d-servis-skoda", function (ctx, H) {
    var A = G("HH_ACTIVITY"); if (!A) return null;
    var t = tryv(function () { return A.timelineFor("d-servis-skoda") || []; }, []);
    if (!t.length) return null;
    return { sections: [
      H.section("Everything that happened to this row", t.map(function (e) {
        return H.row(e.id, tryv(function () { return A.render(e, ctx.locale || "en"); }, e.key),
                     [e.actor, e.via, when(H, e.at)].filter(Boolean).join(" \u00b7 "),
                     e.entity ? e.entity.type.split(".")[0] : "");
      }))
    ], note: "One entity, every module that touched it. The timeline crosses Documents, Vehicles and Finance without leaving the row." };
  });

  def("/activity#diff", function (ctx, H) {
    var A = G("HH_ACTIVITY"); if (!A) return null;
    var rows = tryv(function () { return A.diffRows() || []; }, []);
    if (!rows.length) return null;
    var secs = rows.slice(0, 6).map(function (e) {
      return H.section((e.entity ? e.entity.label : e.key) + " \u00b7 " + when(H, e.at),
        (e.fields || []).map(function (f) {
          var iso = /^\d{4}-\d{2}-\d{2}/;
          return H.row(f.field, f.field,
                       (iso.test(String(f.from)) ? when(H, f.from) : f.from) + " \u2192 " +
                       (iso.test(String(f.to)) ? when(H, f.to) : f.to), e.module, "");
        }));
    });
    return { sections: secs, note: "Field-level diffs, stored as values rather than rendered sentences, so a later translation still reads correctly." };
  });

  def("/activity#c-48", function (ctx, H) {
    var A = G("HH_ACTIVITY"); if (!A) return null;
    var s = tryv(function () { return A.offlineState(ctx.member); }, null); if (!s) return null;
    return { sections: [
      facts(H, "What you have here", [["Cached entries", String(s.cached)], ["On the server", String(s.total)],
                                      ["Read at", when(H, s.readAt)]]),
      H.section("Why", [H.row("", s.body || "", s.why || "", "")])
    ], note: "The one read in the product that admits it is a server read. It says so plainly rather than looking broken." };
  });

  /* ── Chat ──────────────────────────────────────────────────────────── */

  def("/chat/c-chata", function (ctx, H) {
    var C = G("HH_CHAT"); if (!C) return null;
    var msgs = tryv(function () { return C.messagesOf("c-chata") || []; }, []);
    if (!msgs.length) return null;
    return { sections: [
      H.section(tryv(function () { return (C.conversation("c-chata") || {}).cs; }, "Chata"), msgs.map(function (m) {
        var re = tryv(function () { return (C.reactionsOn(m.id) || []).map(function (r) { return r.emoji; }).join(" "); }, "");
        return H.row(m.id, m.text, [tryv(function () { return C.name(m.by); }, m.by), when(H, m.at),
                     C.edited && C.edited[m.id] ? "edited" : ""].filter(Boolean).join(" \u00b7 "), re, "");
      }))
    ], note: "Edits are allowed for " + (C.editWindow || 15) + " minutes and the row says so. A deleted message leaves a tombstone, not a hole." };
  });

  def("/chat/c-chata#a-2", function (ctx, H) {
    var C = G("HH_CHAT"); if (!C) return null;
    var a = (C.attachments || []);
    if (!a.length) return null;
    return { sections: [
      H.section("Attachments", a.map(function (x) {
        return H.row(x.id, x.file, [x.by, when(H, x.at), x.ct, x.thumb ? "" : "thumbnail still being made"]
                     .filter(Boolean).join(" \u00b7 "), x.mb + " MB", x.thumb ? "" : "warning");
      })),
      H.section("Custody", a.map(function (x) {
        return H.row("c" + x.id, x.file, x.note || "moving it to Documents transfers custody \u2014 the bytes leave the chat prefix", "");
      }))
    ], note: "Thumbnails arrive after the file. A row exists the moment the message does." };
  });

  def("/chat/c-dum#floor", function (ctx, H) {
    var C = G("HH_CHAT"); if (!C) return null;
    var mem = (C.membership || []).filter(function (m) { return m.conv === "c-dum"; });
    if (!mem.length) return null;
    return { sections: [
      H.section("Who is in this conversation", mem.map(function (m) {
        return H.row(m.who, tryv(function () { return C.name(m.who); }, m.who),
                     "joined " + H.day(m.joined) + (m.floor ? " \u00b7 reads from " + m.floor : " \u00b7 reads from the beginning"),
                     "seq " + m.floorSeq);
      }))
    ], note: "The floor is per membership. Rejoining does not reopen the history that was closed." };
  });

  def("/chat/storage", function (ctx, H) {
    var C = G("HH_CHAT"); if (!C) return null;
    var per = C.perConversation || [];
    if (!per.length) return null;
    return { sections: [
      H.section("Per conversation", per.map(function (p) {
        return H.row(p.conv, tryv(function () { return (C.conversation(p.conv) || {}).cs; }, p.conv),
                     p.files + " files \u00b7 oldest " + H.day(p.oldest), p.gb.toFixed(2) + " GB");
      })),
      H.section("Thresholds", (C.thresholds || []).map(function (t) {
        return H.row("", t.gb + " GB", t.level === "warn" ? "the household is told, and the row names Chat"
                                                          : "a quiet notice on the storage screen", t.level);
      }))
    ], note: "Chat's bytes are counted in the household total and can be moved out of it \u2014 custody transfer changes the prefix, not the total." };
  });

  def("/chat/c-chata#mute", function (ctx, H) {
    var C = G("HH_CHAT"); if (!C) return null;
    var conv = tryv(function () { return C.conversation("c-chata"); }, null); if (!conv) return null;
    var run = tryv(function () { return C.muteRun(); }, null);
    var who = tryv(function () { return C.name(ctx.member); }, ctx.member);
    var mine = ((run && run.rows) || []).filter(function (r) { return r.conv === conv.cs && r.who === who; })[0];
    return { sections: [
      facts(H, "Mute", [["Conversation", conv.cs],
                        ["Muted for you", mine ? (mine.muted ? "yes" : "no") : "no"],
                        ["Muted for anyone", run ? run.muted + " of " + (run.rows || []).length + " memberships" : ""],
                        ["Undeletable", conv.undeletable ? "yes \u2014 the household general thread" : "no"]]),
      H.section("Mute is per membership", ((run && run.rows) || []).filter(function (r) { return r.conv === conv.cs; })
        .map(function (r) {
          return H.row("", r.who, r.muted ? "has muted this conversation" : "hears it",
                       r.muted ? "muted" : "", r.muted ? "muted" : "");
        })),
      run && run.says ? H.section("What mute does and does not do", [
        H.row("", run.says, "", ""),
        H.row("", "Unread still counts", "and a direct mention still arrives" +
              (run.quietHours ? ", inside quiet hours as well" : ""), "")
      ]) : null
    ].filter(Boolean),
      note: "Muting silences delivery for one member, not membership for everybody." };
  });

  def("/chat/search?q=kl\u00ed\u010de", function (ctx, H) {
    var C = G("HH_CHAT"); if (!C) return null;
    var res = tryv(function () { return C.search("kl\u00ed\u010de", ctx.member); }, null); if (!res) return null;
    if (res.rows && res.rows.length) {
      return { sections: [H.section("\u201ckl\u00ed\u010de\u201d", res.rows.map(function (r) {
        return H.row(r.id || "", r.text || words(r), (r.conv || "") + " \u00b7 " + (r.at || ""), "");
      }))], note: "Search reads the conversations you are in, from your floor forward." };
    }
    return { sections: [
      facts(H, "Nothing to search", [["Reason", res.reason === "absent" ? "this member does not hold Chat" : res.reason],
                                     ["What is shown", "the module is absent, so the search field is not drawn at all"]])
    ], note: "Absence, not a disabled field: a member without Chat has no Chat search to be refused by." };
  });

  /* ── Utilities ─────────────────────────────────────────────────────── */

  function uSetup(n) {
    return function (ctx, H) {
      var U = G("HH_UTILITIES"); if (!U) return null;
      var step = (U.setup || []).filter(function (s) { return s.n === n; })[0] || (U.setup || [])[n - 1];
      if (!step) return null;
      if (step.kind === "preset") {
        var country = "CZ";
        var picked = {};
        (U.services || []).forEach(function (sv) { if (sv.preset) picked[sv.preset] = 1; });
        return { sections: [
          H.section(step.title, (U.presets || []).filter(function (p) { return p.country === country; })
            .map(function (p) {
              return H.row(p.id, p.label,
                           (p.skeleton || []).map(function (k) {
                             var ty = (U.types || []).filter(function (x) { return x.type === k; })[0];
                             return ty ? ty.plain : k;
                           }).join(" \u00b7 "),
                           picked[p.id] ? "picked" : "", picked[p.id] ? "accent" : "");
            })),
          step.body ? H.section("What choosing one does", [H.row("", step.body, "", "")]) : null,
          H.section("The four steps", (U.setup || []).map(function (x) {
            return H.row("s" + x.n, x.n + " \u00b7 " + x.title, x.kind || "", x.n === n ? "here" : "",
                         x.n === n ? "accent" : "muted");
          }))
        ].filter(Boolean),
          note: "A preset creates the meter, its registers and a tariff skeleton with the right component types in the right order, and empty values. The engine is never shown." };
      }
      return { sections: [
        H.section(step.title || ("Step " + n), (step.options || []).map(function (o, i) {
          var on = step.picked && (step.picked === o || (Array.isArray(step.picked) && step.picked.indexOf(o.id || o) >= 0));
          return H.row((o && o.id) || String(i), words(o) || String(o), (o && (o.says || o.why || o.note)) || "",
                       on ? "picked" : "", on ? "accent" : "");
        })),
        step.body ? H.section("What this step is for", [H.row("", step.body, "", "")]) : null,
        H.section("The four steps", (U.setup || []).map(function (s) {
          return H.row("s" + s.n, s.n + " \u00b7 " + s.title, s.kind || "", s.n === n ? "here" : "", s.n === n ? "accent" : "muted");
        }))
      ].filter(Boolean), note: n === 4
        ? "The last step asks for what the member knows and accepts not knowing the rest \u2014 an empty field is a legitimate answer."
        : "Setup answers four questions and then stops. Everything else is offered later, on the service it belongs to." };
    };
  }
  def("/utilities/setup/1", uSetup(1));
  def("/utilities/setup/2", uSetup(2));
  def("/utilities/setup/3", uSetup(3));
  def("/utilities/setup/4", uSetup(4));

  function uService(id) {
    return function (ctx, H) {
      var U = G("HH_UTILITIES"); if (!U) return null;
      var s = tryv(function () { return U.summary(id); }, null);
      var svc = (s && s.service) || tryv(function () { return U.svc(id); }, null);
      if (!svc) return null;
      var mode = tryv(function () { return U.modeOf(svc.mode); }, null);
      var meters = tryv(function () { return U.metersOf(id) || []; }, []);
      var due = tryv(function () { return U.readingDue(id); }, null);
      return { sections: [
        facts(H, svc.name, [
          ["Supplier", svc.supplier], ["Account", svc.account], ["Where", svc.place],
          ["Mode", mode ? (mode.plain || mode.key) : svc.mode],
          ["Contract", [svc.contract_end ? H.day(svc.contract_start) + " \u2013 " + H.day(svc.contract_end)
                                          : "from " + H.day(svc.contract_start) + ", open-ended",
                        svc.notice_days ? "notice " + svc.notice_days + " days" : ""].filter(Boolean).join(" \u00b7 ")],
          ["Reading cadence", svc.cadence ? ["every " + svc.cadence + " days",
                                             svc.readingDay ? "reading day " + svc.readingDay : ""]
                                            .filter(Boolean).join(" \u00b7 ") : "bills only"],
          ["Next reading", due && due.on ? H.day(due.on) + (due.overdue ? " \u00b7 overdue" : "") : ""]
        ]),
        H.section("Meters", meters.map(function (m) {
          return H.row(m.id, m.serial + " \u00b7 " + m.location,
                       m.digits + " digits, " + m.decimals + " decimals \u00b7 " +
                       (m.registers || []).map(function (g) { return g.label || g.key || String(g); }).join(", "),
                       m.unit, "");
        })),
        s ? facts(H, "Where the money stands", [
          ["Balance", s.balance === null || s.balance === undefined ? "" : H.money(s.balance)],
          ["Headroom", s.headroom && s.headroom.says ? s.headroom.says
                      : (typeof s.headroom === "number" ? H.money(s.headroom) : "")],
          ["Cost so far", s.cost === null || s.cost === undefined ? "" : H.money(s.cost)],
          ["This period", s.lastPeriod ? H.day(s.lastPeriod.from) + " \u2013 " + H.day(s.lastPeriod.to) : ""],
          ["Readings", s.readings === undefined ? "" : String(s.readings)],
          ["Nothing to price yet", s.none ? "no tariff on this service, so it counts units and not money" : ""]
        ]) : null
      ].filter(Boolean), note: "Three modes over one service. Upgrading a service reveals fields; it never migrates or discards what is already recorded." };
    };
  }
  def("/utilities/elec", uService("elec"));
  def("/utilities/internet", uService("internet"));
  def("/utilities/garden", uService("garden"));

  def("/utilities/elec/readings/new", function (ctx, H) {
    var U = G("HH_UTILITIES"); if (!U) return null;
    var r = U.cellarReading; if (!r) return null;
    var run = tryv(function () { return U.cellarRun(); }, null);
    var meters = tryv(function () { return U.metersOf(r.service) || []; }, []);
    var m = meters[0];
    return { sections: [
      H.section("Enter what the meter shows", Object.keys(r.vals || {}).map(function (k) {
        var unit = m ? m.unit : "kWh", dec = m ? m.decimals : 1;
        return H.row(k, k.toUpperCase(), (m ? m.digits + " digits \u00b7 " + m.decimals + " decimals \u00b7 " + unit : ""),
                     tryv(function () { return U.qty(r.vals[k], dec, unit); }, String(r.vals[k])), "");
      })),
      facts(H, "The rest of the form", [["Date", H.day(r.on)], ["Photo", r.photo ? "attached" : "optional"],
                                        ["By", r.by], ["Mark", r.mark || "pending until the server takes it"],
                                        ["Note", r.note || ""]]),
      run ? H.section("What the pre-check says", (run.cases || run.rows || []).slice(0, 6).map(function (c) {
        return H.row("", words(c), c.says || c.why || "", c.verdict || c.outcome || "", c.blocks ? "warning" : "");
      })) : null
    ].filter(Boolean), note: "Used standing in a cellar with no signal: the check runs on the replica, so a wrong number is refused before the stairs." };
  });

  def("/utilities/elec/readings", function (ctx, H) {
    var U = G("HH_UTILITIES"); if (!U) return null;
    var rs = tryv(function () { return U.readingsOf("elec") || []; }, []);
    if (!rs.length) return null;
    return { sections: [
      H.section("Readings", rs.slice(-12).reverse().map(function (r) {
        var vals = Object.keys(r.vals || {}).map(function (k) {
          return k + " " + tryv(function () { return U.qty(r.vals[k], 1, "kWh"); }, r.vals[k]);
        }).join(" \u00b7 ");
        return H.row("", H.day(r.on), vals + (r.note ? " \u00b7 " + r.note : ""),
                     r.source + (r.mark ? " \u00b7 " + r.mark : ""),
                     r.source === "estimate" ? "warning" : "");
      }))
    ], note: "An estimated reading is marked on every row it appears on, and never reaches a money figure." };
  });

  def("/utilities/elec/consumption", function (ctx, H) {
    var U = G("HH_UTILITIES"); if (!U) return null;
    var pts = tryv(function () { return U.chartPoints("elec") || []; }, []);
    if (!pts.length) return null;
    return { sections: [
      H.section("Consumption between readings", pts.slice(-10).reverse().map(function (p) {
        return H.row("", H.day(p.from) + " \u2013 " + H.day(p.on),
                     p.days + " days \u00b7 " + (p.perDay / 10000).toFixed(1) + " " + p.unit + "/day" +
                     (p.estimated || p.fromEstimated ? " \u00b7 one end estimated" : ""),
                     (p.usage / 10000).toFixed(p.decimals) + " " + p.unit,
                     p.estimated || p.fromEstimated ? "warning" : "");
      }))
    ], note: "A bar between two readings, not a smooth line: the app knows the interval, not the day." };
  });

  def("/utilities/elec/tariff", function (ctx, H) {
    var U = G("HH_UTILITIES"); if (!U) return null;
    var ts = tryv(function () { return U.tariffsOf("elec") || []; }, []);
    var t = ts[ts.length - 1]; if (!t) return null;
    /* the wording on a component is the wording printed on that country's bill */
    var country = tryv(function () {
      return ((U.presets || []).filter(function (p) { return p.id === U.svc("elec").preset; })[0] || {}).country;
    }, "CZ") || "CZ";
    /* every component carries its amount in minor units; what it is per is the
       difference between a monthly charge and a rate for a megawatt-hour */
    function price(c) {
      if (c.amount === undefined || c.amount === null) return "";
      var per = c.per ? " / " + c.per : (c.period ? " / " + c.period : "");
      return H.money(c.amount) + per;
    }
    function billWord(ty, cc) {
      if (!ty || !ty.bill) return "";
      var w = typeof ty.bill === "string" ? ty.bill : (ty.bill[cc] || ty.bill.CZ || "");
      return w ? "on the bill as: " + w : "";
    }
    return { sections: [
      facts(H, "From the bill", [["In force from", H.day(t.from)],
                                 ["VAT", t.vat === "inclusive" ? "prices include VAT" : String(t.vat)],
                                 ["Entered by", t.by], ["Note", t.note || ""]]),
      H.section("Components", (t.components || []).map(function (c) {
        var ty = (U.types || []).filter(function (x) { return x.type === c.type; })[0];
        return H.row(c.id, ty ? ty.plain : c.type,
                     [c.bill ? "on the bill as: " + c.bill : billWord(ty, country),
                      c.register && c.register !== "all" ? "register " + c.register.toUpperCase() : "",
                      c.capacity ? c.capacity + " " + (c.capUnit || "") : ""].filter(Boolean).join(" \u00b7 "),
                     price(c), "");
      })),
      H.section("The eleven types this composer can express", (U.types || []).map(function (ty) {
        return H.row(ty.type, ty.plain,
                     [ty.applies, billWord(ty, country),
                      (ty.params || []).map(function (p) { return p[0] + " \u2014 " + p[1]; }).join(" \u00b7 ")]
                       .filter(Boolean).join(" \u00b7 "),
                     (ty.params || []).length + " fields", "");
      }))
    ], note: "Eleven component types, priced with no expression field anywhere on the screen: the member transcribes a bill, not a formula." };
  });

  def("/utilities/gas/advances", function (ctx, H) {
    var U = G("HH_UTILITIES"); if (!U) return null;
    var sch = (U.schedules || []).filter(function (s) { return s.service === "gas"; });
    var pay = (U.payments || []).filter(function (p) { return p.service === "gas"; });
    if (!sch.length && !pay.length) return null;
    return { sections: [
      H.section("The advance", sch.map(function (s) {
        return H.row("", "From " + H.day(s.from), "due on day " + s.day + " of the month", H.money(s.amount));
      })),
      H.section("Paid by month", pay.slice(-12).reverse().map(function (p) {
        return H.row("", p.month, (p.paid_on ? "paid " + H.day(p.paid_on) : "not paid") + (p.by ? " \u00b7 " + p.by : "") +
                     (p.note ? " \u00b7 " + p.note : ""), H.money(p.amount), p.paid_on ? "" : "warning");
      }))
    ], note: "Advances are keyed by month, not by date paid, so a late payment lands on the month it was for." };
  });

  def("/utilities/gas/periods/2025", function (ctx, H) {
    var U = G("HH_UTILITIES"); if (!U) return null;
    var s = tryv(function () { return U.settlement("g-2025"); }, null);
    var run = (s && s.run) || s; if (!run || !run.period) return null;
    var p = run.period, inv = p.invoice || {};
    return { sections: [
      facts(H, "The period", [["From", H.day(p.from)], ["To", H.day(p.to)],
                              ["Invoice", inv.on ? H.day(inv.on) : "not yet issued"],
                              ["Billed", inv.total !== undefined ? H.money(inv.total) : ""],
                              ["Balance", inv.balance !== undefined ? H.money(inv.balance) : ""],
                              ["In units", inv.vals ? Object.keys(inv.vals).map(function (k) {
                                 return k + " " + String(inv.vals[k].toFixed ? inv.vals[k].toFixed(3) : inv.vals[k]).replace(".", ",");
                               }).join(" \u00b7 ") : ""],
                              ["Note", inv.note || ""]]),
      facts(H, "How it was settled", [
        ["Priced from the meter", run.priced !== undefined ? H.money(run.priced) : ""],
        ["Advances paid", run.advances !== undefined ? H.money(run.advances) : ""],
        ["Difference", run.priced !== undefined && run.advances !== undefined ? H.money(run.priced - run.advances) : ""],
        ["Estimated readings in the money", run.estimatedInMoney ? H.money(run.estimatedInMoney) : "none \u2014 no estimate reaches a figure"],
        ["Intervals priced", String((run.intervals || []).length)],
        ["Meter swaps inside the period", String((run.meterSwaps || []).length)]
      ]),
      H.section("The advances it is set against", (run.advanceRows || []).map(function (a) {
        return H.row("", a.label || a.month, (a.paid ? "paid " + H.day(a.paid_on) : "not paid") +
                     (a.source ? " \u00b7 " + a.source : ""), H.money(a.amount), a.paid ? "" : "warning");
      }))
    ].filter(Boolean), note: "Settlement is stated in both money and units, because the household argues about the units and pays in money." };
  });

  def("/utilities/elec/readings/new?on=2026-01-01", function (ctx, H) {
    var U = G("HH_UTILITIES"); if (!U) return null;
    var b = tryv(function () { return U.blockRun(); }, null);
    var run = (b && b.run) || b; if (!run) return null;
    return { sections: [
      facts(H, "Why this is blocked", [
        ["Service", run.service ? run.service.name : ""],
        ["Period", run.period ? H.day(run.period.from) + " \u2013 " + H.day(run.period.to) : ""],
        ["Missing", run.blocked ? run.blocked.says : "the reading that opens the period"],
        ["Opening reading", run.openingMissing ? "not recorded" : "recorded"],
        ["Closing reading", run.needsClosing ? "still needed" : "not needed yet"],
        ["What is not done", "no estimate is written in its place"]
      ]),
      run.blocked && run.blocked.why ? H.section("What the block affects", [
        H.row("", run.blocked.why, "", "", "warning"),
        H.row("", "Nothing in this period is priced", "The stretch either side of " + H.day(run.blocked.date) +
              " cannot be split without inventing a meter value.", "", "warning")
      ]) : null,
      H.section("The form, pre-filled", [
        H.row("", "Date", "the day the period opens", H.day("2026-01-01") + " 2026"),
        H.row("", "Value", "empty, and it stays empty until somebody knows it", "")
      ])
    ].filter(Boolean), note: "The refusal names what is missing and offers the form to fix it. It does not invent a number to unblock itself." };
  });

  def("/utilities/elec#headroom", function (ctx, H) {
    var U = G("HH_UTILITIES"); if (!U) return null;
    var h = tryv(function () { return U.headroom("elec", "2026-09"); }, null) ||
            tryv(function () { return U.headroom("gas", "2026-09"); }, null);
    if (!h) return null;
    return { sections: [
      facts(H, "What the advance buys", [
        ["Service", h.service ? h.service.name : ""],
        ["Advance", h.advance !== undefined ? H.money(h.advance) : ""],
        ["Buys", h.units !== undefined ? words(h.units) : (h.says || "")],
        ["At the current tariff", h.rate !== undefined ? words(h.rate) : ""]
      ]),
      h.rows ? tuples(H, "How it was worked out", h.rows, 8) : null
    ].filter(Boolean), note: "Headroom is computable on day one with no consumption history at all \u2014 tariff and advance are enough." };
  });

  def("/utilities/internet/bills", function (ctx, H) {
    var U = G("HH_UTILITIES"); if (!U) return null;
    var bs = tryv(function () { return U.billsOf("internet") || []; }, []);
    if (!bs.length) return null;
    return { sections: [
      H.section("Bills", bs.slice(-12).reverse().map(function (b) {
        return H.row("", [H.day(b.issued), b.from && b.to ? H.day(b.from) + " \u2013 " + H.day(b.to) : ""]
                         .filter(Boolean).join(" \u00b7 "),
                     b.paid ? "paid" : "due " + H.day(b.due), H.money(b.amount), b.paid ? "" : "warning");
      }))
    ], note: "A bills-only service records what arrived and what was paid. There is no meter to read and the screen does not pretend there is." };
  });

  def("/utilities/gas/meters/replace", function (ctx, H) {
    var U = G("HH_UTILITIES"); if (!U) return null;
    var ms = tryv(function () { return U.metersOf("gas") || []; }, []);
    var run = tryv(function () { return U.replacementRun(); }, null);
    if (!ms.length) return null;
    return { sections: [
      H.section("The meters on this service", ms.map(function (m) {
        return H.row(m.id, m.serial + " \u00b7 " + m.location,
                     (m.from ? "from " + H.day(m.from) : "") + (m.to ? " to " + H.day(m.to) : " \u00b7 current"),
                     m.digits + " digits \u00b7 " + m.unit, m.to ? "muted" : "");
      })),
      run ? facts(H, "What a replacement does", [
        ["Final on the old", words(run.final || run.old)],
        ["Initial on the new", words(run.initial || run.next)],
        ["Consumption", run.says || "the two readings are paired, so the interval is not lost"]
      ]) : null
    ].filter(Boolean), note: "Replacing a meter pairs a final and an initial reading. Consumption crosses the swap without a gap and without a spike." };
  });

  def("/utilities/garden/mode", function (ctx, H) {
    var U = G("HH_UTILITIES"); if (!U) return null;
    var up = tryv(function () { return U.upgradeRun("garden"); }, null);
    return { sections: [
      H.section("The three modes", (U.modes || []).map(function (m) {
        return H.row(m.key, m.plain, m.records || "", m.who || "", "");
      })),
      up ? facts(H, "What upgrading this service would do", [
        ["Bills that become periods", String(up.bills)],
        ["Retrospective periods", String(up.periods)],
        ["Cannot be converted", String((up.skipped || []).length) + (up.skipped && up.skipped.length ? " \u00b7 each says why on its row" : "")],
        ["Summary", up.says || ""]
      ]) : null
    ].filter(Boolean), note: "Upgrading reveals fields and keeps every row. Nothing already recorded is discarded or rewritten." };
  });

  /* ── Finance ───────────────────────────────────────────────────────── */

  /* A plan rule is written in API terms — account ids, a basis enum, a mode with no
     value on the remainder. The edges resolve all three per earner; the rule list has to
     resolve them for itself. */
  function ruleWords(F, r) {
    var PLACE = { owner_personal: "the earner\u2019s own account", income: "income" };
    var BASIS = { own_income: "of that earner\u2019s own income", total_income: "of the household\u2019s total income" };
    function place(k) {
      if (!k) return "";
      return PLACE[k] || tryv(function () { var n = F.acctName(k); return n === k ? "" : n; }, "") || k;
    }
    return {
      from: place(r.from), to: place(r.to),
      basis: r.basis ? (BASIS[r.basis] || r.basis) : "",
      value: r.mode === "percent" ? r.value + " %"
           : r.mode === "amount" ? tryv(function () { return F.money(r.value); }, String(r.value))
           : "whatever is left"
    };
  }

  def("/finance/setup/1", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    return { sections: [
      H.section("How does your household handle money?", (F.answers || []).map(function (a) {
        return H.row(a.key, a.title, a.en || "", (a.caps || []).length + " capabilities", "");
      })),
      H.section("What each answer turns on", (F.answers || []).map(function (a) {
        return H.row("c" + a.key, a.title, (a.caps || []).join(" \u00b7 "), a.preset || "", "muted");
      }))
    ], note: "Four illustrated answers, and the fourth is a control rather than an answer \u2014 which is why the kit's allowance composition has nothing to attach to." };
  });

  def("/finance/setup/2", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    return { sections: [
      H.section("The steps", (F.setup || []).map(function (s) {
        return H.row("s" + s.n, s.n + " \u00b7 " + s.title, s.en || s.note || "", String(s.cap || ""));
      })),
      H.section("Who earns", (F.income || []).filter(function (i) { return i.period === "2026-09"; }).map(function (i) {
        return H.row(i.id, tryv(function () { return F.nameOf(i.member); }, i.member), i.source || "", H.money(i.amount));
      }))
    ], note: "Setup asks who earns before it asks where the money goes, because the allocation plan is written per earner." };
  });

  def("/finance", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    var period = "2026-09";
    var inc = tryv(function () { return F.incomeTotal(period); }, null);
    var bal = tryv(function () { return F.balances(); }, null);
    var bud = tryv(function () { return F.budgetRun(period); }, null);
    return { sections: [
      facts(H, tryv(function () { return F.monthLabel(period); }, period), [
        ["Income this period", inc !== null && inc !== undefined ? H.money(inc) : ""],
        ["Plan", tryv(function () { return (F.planFor(period) || {}).label; }, "")],
        ["Budget period", bud && bud.period ? bud.period.label : ""],
        ["Days elapsed", bud ? bud.elapsed + " of " + bud.total : ""]
      ]),
      bal ? H.section("Who owes whom", (bal.rows || []).map(function (r) {
        return H.row(r.member, r.name, r.net > 0 ? "is owed" : r.net < 0 ? "owes" : "square",
                     H.money(r.net), r.net < 0 ? "warning" : "");
      })) : null,
      bud ? H.section("Budgets", (bud.rows || []).slice(0, 6).map(function (b) {
        return H.row(b.id, b.category, H.money(b.actual) + " of " + H.money(b.budget),
                     b.remaining !== undefined ? H.money(b.remaining) : "", b.remaining < 0 ? "danger" : "");
      })) : null
    ].filter(Boolean), note: "The headline is the month: what came in, what the plan does with it, and where the household stands with itself." };
  });

  def("/finance/periods", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    var missing = tryv(function () { return F.missingPeriods("2026-01", "2026-09"); }, null);
    var periods = {};
    (F.income || []).forEach(function (i) { periods[i.period] = (periods[i.period] || 0) + i.amount; });
    var keys = Object.keys(periods).sort();
    if (!keys.length) return null;
    var miss = Array.isArray(missing) ? missing : (missing && missing.rows) || [];
    return { sections: [
      H.section("Income by period", keys.reverse().map(function (k) {
        return H.row(k, tryv(function () { return F.monthLabel(k); }, k), "", H.money(periods[k]));
      })),
      H.section("Not written down", (miss || []).filter(function (m) {
        return m && (m.none || m.partial);
      }).map(function (m) {
        var who = (m.absent || []).map(function (a) { return a.member || a.name || String(a); }).join(", ");
        return H.row("", tryv(function () { return F.monthLabel(m.period); }, m.period),
                     m.none ? "nobody's income is written for this month \u2014 the flow view cannot be drawn for it"
                            : "written for some earners only" + (who ? " \u00b7 missing: " + who : ""),
                     m.none ? "none" : "partial", "warning");
      }))
    ], note: "A missing period is stated, never inferred. The flow view for it says the month is not written rather than drawing a zero." };
  });

  def("/finance/flow/2026-09", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    var f = tryv(function () { return F.flow("2026-09"); }, null);
    var run = (f && f.run) || f; if (!run) return null;
    var plan = run.plan || {};
    var alloc = tryv(function () { return F.allocate("2026-09"); }, null);
    return { sections: [
      H.section("The plan, stage by stage", (plan.rules || []).map(function (r) {
        var w = ruleWords(F, r);
        return H.row("r" + r.order, r.label,
                     ["from " + w.from, r.per_earner ? "per earner" : "", w.basis].filter(Boolean).join(" \u00b7 "),
                     w.value + " \u2192 " + w.to, r.mode === "remainder" ? "muted" : "");
      })),
      H.section("What it moves this month", (alloc && alloc.edges || []).map(function (e) {
        return H.row("", e.fromLabel + " \u2192 " + e.toLabel,
                     [e.label, e.mode, e.basis].filter(Boolean).join(" \u00b7 "),
                     H.money(e.amount), e.mode === "remainder" ? "muted" : "");
      })),
      H.section("Per earner", (alloc && alloc.perEarner || []).map(function (p) {
        return H.row(p.member, p.name, "income " + H.money(p.income) + " \u00b7 allocated " + H.money(p.allocated),
                     p.ok ? "square" : "off", p.ok ? "" : "danger");
      })),
      facts(H, "It has to reconcile", [
        ["In", alloc ? H.money(alloc.total) : ""],
        ["Allocated", alloc ? H.money(alloc.allocated) : ""],
        ["Remainder", alloc ? H.money(alloc.remainderShown) + " \u2014 exactly one per source" : ""],
        ["Joint account", (alloc && (alloc.sources || [])[0])
          ? (alloc.sources[0].name + " \u00b7 in " + H.money(alloc.sources[0].inflow) +
             " \u00b7 out " + H.money(alloc.sources[0].outflow) + (alloc.sources[0].ok ? " \u00b7 reconciles" : " \u00b7 does not reconcile"))
          : ""],
        ["Fits", tryv(function () { var p = F.phoneFit(run); return p && (p.says || (p.px + " px")); }, "360 px")]
      ])
    ].filter(Boolean), note: "Stage-major rows, not a node diagram: the same nodes read node-major need 1 694 px, and this fits 360." };
  });

  def("/finance/flow/2026-09/post", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    return { sections: [
      H.section("Already recorded", (F.posted || []).map(function (p) {
        var rule = tryv(function () {
          return ((F.planFor(p.period) || {}).rules || []).filter(function (r) { return r.order === p.rule; })[0];
        }, null);
        return H.row(p.id, (rule && rule.label) || "Rule " + p.rule,
                     [tryv(function () { return F.nameOf(p.earner); }, p.earner), H.day(p.on),
                      p.by ? "by " + tryv(function () { return F.nameOf(p.by); }, p.by) : ""].filter(Boolean).join(" \u00b7 "),
                     H.money(p.amount));
      }))
    ], note: "The app records that a person moved money. It never says the app moved it, and it never offers to." };
  });

  def("/finance/allocation", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    var a = tryv(function () { return F.allocate("2026-09"); }, null); if (!a) return null;
    var plan = a.plan || {};
    var v = tryv(function () { return F.validatePlan(plan); }, null);
    return { sections: [
      H.section("Rules, in order", (plan.rules || []).map(function (r) {
        var w = ruleWords(F, r);
        return H.row("r" + r.order, r.label,
                     ["from " + w.from, w.basis, r.per_earner ? "per earner" : "", "\u2192 " + w.to].filter(Boolean).join(" \u00b7 "),
                     w.value, r.mode === "remainder" ? "muted" : "");
      })),
      H.section("Worked on this month's real numbers", (a.edges || []).map(function (e) {
        return H.row("", e.label, e.fromLabel + " \u2192 " + e.toLabel +
                     (e.basis ? " \u00b7 " + e.basis : "") + " \u00b7 " + e.mode, H.money(e.amount),
                     e.mode === "remainder" ? "muted" : "");
      })),
      H.section("Where it lands", Object.keys(a.pots || {}).map(function (k) {
        return H.row(k, tryv(function () { return F.acctName(k); }, k), "", H.money(a.pots[k]));
      })),
      facts(H, "What save would refuse", [
        ["Remainder", a.remainderShown !== undefined ? H.money(a.remainderShown) : ""],
        ["A second remainder on one source", "refused by name, with the source named"],
        ["Negative anywhere", a.negative ? "yes \u2014 the plan over-allocates" : "no"],
        ["Valid", v ? (v.ok ? "yes" : words(v.errors || v.reason || v.says) || "no") : (a.ok ? "yes" : "no")]
      ])
    ].filter(Boolean), note: "Exactly one remainder rule per source. A second one is refused at save, by name, with the source named." };
  });

  def("/finance/accounts", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    return { sections: [
      H.section("Accounts", (F.accounts || []).filter(function (a) { return a.active !== false; }).map(function (a) {
        return H.row(a.id, a.name, [a.type, a.inst, a.last4 ? "\u2022\u2022\u2022\u2022" + a.last4 : "", a.owner || "household"]
                     .filter(Boolean).join(" \u00b7 "), a.currency);
      })),
      H.section("Closed", (F.accounts || []).filter(function (a) { return a.active === false; }).map(function (a) {
        return H.row(a.id, a.name, "closed \u2014 its transactions stay", a.currency, "muted");
      }))
    ], note: "An account is a place money sits, not a person. Closing one keeps every row that ever pointed at it." };
  });

  def("/finance/ledger", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    var p = tryv(function () { return F.ledgerPage(0, 14); }, null);
    var rows = (p && p.rows) || (F.transactions || []).slice(0, 14);
    if (!rows.length) return null;
    return { sections: [
      H.section("Transactions", rows.map(function (t) {
        return H.row(t.id, t.desc, H.day(t.date) + " \u00b7 " + tryv(function () { return F.acctName(t.account); }, t.account) +
                     " \u00b7 " + tryv(function () { return F.catName(t.category); }, t.category || "") +
                     (t.source !== "manual" ? " \u00b7 " + t.source : ""),
                     H.money(t.amount, t.currency === "CZK" ? "K\u010d" : t.currency),
                     t.amount < 0 ? "" : "positive", true);
      }))
    ], note: "One ledger, several sources: typed, imported, and offered by another module. The row always says which." };
  });

  def("/finance/expenses/new", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    var e = (F.expenses || [])[0]; if (!e) return null;
    var split = tryv(function () { return F.sharesOf(e); }, null);
    var ten = tryv(function () { var r = F.tenEuroRun(); return (r && r.runs && r.runs[0]) || r; }, null);
    function shareRows(run, cur) {
      var sh = (run && run.shares) || {};
      return Object.keys(sh).map(function (m) {
        return H.row(m, tryv(function () { return F.nameOf(m); }, m), "", H.money(sh[m], cur));
      });
    }
    return { sections: [
      facts(H, "The expense", [["What", e.desc], ["Amount", H.money(e.amount, e.currency === "CZK" ? "K\u010d" : e.currency)],
                               ["Paid by", (e.paid || []).map(function (p) {
                                  return tryv(function () { return F.nameOf(p[0]); }, p[0]) + " \u00b7 " + H.money(p[1]);
                                }).join(", ")],
                               ["Method", e.method],
                               ["Category", tryv(function () { return F.catName(e.category); }, e.category)],
                               ["Participants", (e.participants || []).map(function (m) {
                                  return tryv(function () { return F.nameOf(m); }, m);
                                }).join(", ")]]),
      H.section("The split \u00b7 " + (split ? split.method : e.method), shareRows(split)),
      split ? H.section("Does it divide", [
        H.row("", split.why || "", "", split.ok ? "exact" : "off", split.ok ? "" : "danger")
      ]) : null,
      ten ? H.section("Ten euro, three ways", shareRows(ten, "\u20ac").concat([
        H.row("", ten.why || "", "", "", "muted")
      ])) : null
    ].filter(Boolean), note: "Five split methods, and the last minor unit is deterministic \u2014 3,34 / 3,33 / 3,33, in that order, every time." };
  });

  def("/finance/balances", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    var b = tryv(function () { return F.balances(); }, null);
    var s = tryv(function () { return F.simplify(); }, null);
    if (!b) return null;
    return { sections: [
      H.section("Where everyone stands", (b.rows || []).map(function (r) {
        return H.row(r.member, r.name, r.net > 0 ? "is owed" : r.net < 0 ? "owes" : "square", H.money(r.net),
                     r.net < 0 ? "warning" : "");
      })),
      s ? H.section("Simplified \u2014 the fewest transfers", (s.transfers || []).map(function (t) {
        return H.row("", t.says || (t.from + " \u2192 " + t.to), "", H.money(t.amount));
      })) : null,
      s ? H.section("Pairwise \u2014 who actually owes whom", (s.pairwise || []).map(function (t) {
        return H.row("", t.says || (t.from + " \u2192 " + t.to), "", H.money(t.amount), "muted");
      })) : null,
      H.section("Settled", (F.settlements || []).map(function (x) {
        return H.row(x.id, tryv(function () { return F.nameOf(x.from) + " \u2192 " + F.nameOf(x.to); }, x.from + " \u2192 " + x.to),
                     H.day(x.date) + (x.note ? " \u00b7 " + x.note : ""), H.money(x.amount), "muted");
      }))
    ].filter(Boolean), note: "Both sets are shown. A share may only name a member who holds Finance, which in this fixture is one person." };
  });

  def("/finance/budgets", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    var b = tryv(function () { return F.budgetRun("2026-09"); }, null); if (!b) return null;
    return { sections: [
      H.section(b.period ? b.period.label : "This period", (b.rows || []).map(function (r) {
        return H.row(r.id, r.category,
                     H.money(r.actual) + " of " + H.money(r.budget) +
                     (r.carried ? " \u00b7 carried " + H.money(r.carried) : ""),
                     r.remaining !== undefined ? H.money(r.remaining) : "",
                     r.remaining < 0 ? "danger" : "");
      })),
      facts(H, "The period", [["Runs", b.period ? H.day(b.period.from) + " \u2013 " + H.day(b.period.to) : ""],
                              ["Elapsed", b.elapsed + " of " + b.total + " days"],
                              ["Starts on", "payday \u2014 not the first of the month"]])
    ], note: "A budget period is the household's own, and it is not the income period. Two different things called a period is still an open line." };
  });

  def("/finance/recurring", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    return { sections: [
      H.section("Recurring", (F.recurring || []).map(function (r) {
        return H.row(r.id, r.name, r.cadence + " \u00b7 next " + H.day(r.next) +
                     (r.notice ? " \u00b7 notice " + r.notice + " days" : "") + (r.payee ? " \u00b7 " + r.payee : ""),
                     H.money(r.amount, r.currency === "CZK" ? "K\u010d" : r.currency),
                     r.status === "cancelled" ? "muted" : "", true);
      })),
      H.section("Materialised", (F.materialised || []).map(function (m) {
        return H.row(m.id, m.rec, "due " + H.day(m.due) + " \u00b7 " + m.state +
                     (m.confirmedBy ? " \u00b7 confirmed by " + m.confirmedBy : ""),
                     H.money(m.amount), m.state === "pending" ? "warning" : "");
      }))
    ], note: "A recurring payment is a prediction until somebody confirms it. The predicted row is visibly not a transaction." };
  });

  def("/finance/recurring/netflix/prices", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    var hist = (F.priceHistory || []).filter(function (p) { return String(p.rec).indexOf("netflix") >= 0; });
    if (!hist.length) return null;
    return { sections: [
      H.section("How the price moved", hist.map(function (p) {
        return H.row("", "From " + H.day(p.from), (p.why || "") + (p.by ? " \u00b7 " + p.by : ""), H.money(p.amount));
      })),
      H.section("The cancellation window", tryv(function () {
        return (F.cancellationWindows() || []).filter(function (w) { return String(w.rec).indexOf("netflix") >= 0; })
          .map(function (w) { return H.row(w.rec, w.says, "", H.day(w.fires), "warning"); });
      }, []))
    ], note: "Price history is kept per recurring payment, so a rise is a fact with a date rather than a surprise on a statement." };
  });

  def("/finance/import", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    return { sections: [
      H.section("The file", (F.importRows || []).slice(0, 10).map(function (r) {
        return H.row("i" + r.i, r.desc, H.day(r.date) + " \u00b7 " + (r.ref || "no reference") + " \u00b7 " + r.account,
                     H.money(r.amount));
      })),
      H.section("Mappings the household has saved", (F.mappings || []).map(function (m) {
        return H.row(m.id, m.name, [m.format, m.delimiter, m.encoding, m.date ? "dates " + m.date : ""]
                     .filter(Boolean).join(" \u00b7 "), (m.uses || 0) + " uses");
      })),
      H.section("Rules that will run", (F.importRules || []).map(function (r) {
        return H.row(r.id, "contains \u201c" + r.contains + "\u201d",
                     "\u2192 " + tryv(function () { return F.catName(r.category); }, r.category) + " \u00b7 by " + r.by, "");
      }))
    ], note: "The wizard shows the file as it read it before anything is written, and the mapping is saved for next month." };
  });

  def("/finance/import/duplicates", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    var d = tryv(function () { return F.dedupe(); }, null); if (!d) return null;
    return { sections: [
      H.section((d.suspects || []).length + " of " + d.rows + " rows look like something already here",
        (d.suspects || []).map(function (s) {
          return H.row("", (s.row && s.row.desc) || "", s.says || "", s.verdict,
                       s.verdict === "duplicate" ? "warning" : "");
        }))
    ], note: "What \u201cnormalised description\u201d means is the whole of this check and is defined nowhere \u2014 the prototype picked one and recorded it." };
  });

  def("/finance/ledger/tx-13?conflict=cf-1", function (ctx, H) {
    var F = G("HH_FINANCE"); if (!F) return null;
    var c = tryv(function () { return F.conflictRun(); }, null);
    var e = (c && c.entry) || c; if (!e) return null;
    return { sections: [
      facts(H, e.title || "Which amount is right?", [
        ["Where", e.where || ""],
        [e.mine ? e.mine.who : "You", e.mine ? e.mine.value + " \u00b7 " + e.mine.at : ""],
        [e.theirs ? e.theirs.who : "Them", e.theirs ? e.theirs.value + " \u00b7 " + e.theirs.at : ""],
        ["Question", e.question || ""]
      ]),
      e.third ? H.section("A third answer", [H.row("", words(e.third), "", "")]) : null
    ].filter(Boolean), note: "The one module where a dialog is right: two amounts for one payment cannot both be kept, and neither can be guessed." };
  });

  /* ── Garden ────────────────────────────────────────────────────────── */

  def("/garden/setup/1", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    return { sections: [
      H.section("What do you grow in?", (Ga.tiers || []).map(function (t) {
        return H.row(t.id, H.pick(t, ctx, "name", "cs"), t.note || "", words(t.has), "");
      })),
      facts(H, "The place", [["Town", Ga.place ? Ga.place.town : ""], ["Country", Ga.place ? Ga.place.country : ""],
                             ["Pin", Ga.place ? Ga.place.raw : ""], ["From", Ga.place ? Ga.place.source : ""],
                             ["Climate", Ga.climate ? Ga.climate.label + " \u00b7 last frost " + H.day(Ga.climate.lastFrost) : ""]])
    ], note: "Tier is a read filter over one data model. Moving up reveals surfaces; it never migrates or rewrites a row." };
  });

  def("/garden", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    var plants = Ga.containerPlants || [];
    if (!plants.length) return null;
    return { sections: [
      H.section("Pots", (Ga.containers || []).map(function (c) {
        var n = plants.filter(function (p) { return p.container === c.id; }).length;
        return H.row(c.id, c.name, c.where + " \u00b7 " + c.size, n + " planted", "", true);
      })),
      H.section("What is in them", plants.map(function (p) {
        return H.row(p.id, tryv(function () { return Ga.cropName(p.crop); }, p.crop),
                     (tryv(function () { return (Ga.containers.filter(function (c) { return c.id === p.container; })[0] || {}).name; }, "")) +
                     " \u00b7 planted " + H.day(p.planted), p.status, "");
      })),
      H.section("Care due", tryv(function () {
        return (Ga.careDue(H.TODAY) || []).map(function (c) {
          return H.row(c.id, c.label, c.kind + " \u00b7 every " + c.cadence + " days \u00b7 last " + H.day(c.last), "");
        });
      }, []))
    ], note: "A pots household never sees a bed, a season or a rotation check. This is the whole module at that tier." };
  });

  def("/garden#d-40", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    var ps = tryv(function () { return Ga.plantingsOf(2026) || []; }, []);
    return { sections: [
      H.section("Beds", (Ga.beds || []).filter(function (b) { return b.active; }).map(function (b) {
        var n = ps.filter(function (p) { return p.bed === b.num; }).length;
        return H.row(String(b.num), b.label + " \u00b7 " + b.code, b.area + " m\u00b2 \u00b7 " + b.sun + (b.soil ? " \u00b7 " + b.soil : ""),
                     n + " plantings", "", true);
      }))
    ], note: "At the beds tier there are beds and plantings, and no zones, no rotation history and no season close." };
  });

  def("/garden#d-41", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    var ps = tryv(function () { return Ga.plantingsOf(2026) || []; }, []);
    return { sections: (Ga.zones || []).map(function (z) {
      return H.section(z.name + (z.note ? " \u00b7 " + z.note : ""),
        (Ga.beds || []).filter(function (b) { return b.zone === z.id; }).map(function (b) {
          var mine = ps.filter(function (p) { return p.bed === b.num; });
          return H.row(String(b.num), b.label,
                       mine.map(function (p) { return tryv(function () { return Ga.cropName(p.crop); }, p.crop); }).join(", ") || "empty",
                       b.area + " m\u00b2", "", true);
        }));
    }).filter(function (s) { return s.rows.length; }),
      note: "The plot tier adds zones, seasons and the rotation check \u2014 the only tier with enough history to check against." };
  });

  def("/garden/catalog", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    return { sections: [
      H.section("Crops", (Ga.crops || []).map(function (c) {
        return H.row(c.id, H.pick(c, ctx, "en", "cs"),
                     c.family + " \u00b7 " + c.feeder + " feeder \u00b7 break " + c.breakYears + " years \u00b7 " +
                     c.spacing + " cm", c.dtm + " days", "", true);
      })),
      H.section("Varieties the household added", (Ga.varieties || []).map(function (v) {
        return H.row(v.id, v.name, tryv(function () { return Ga.cropName(v.crop); }, v.crop) +
                     (v.own ? " \u00b7 the household's own" : ""), v.dtm ? v.dtm + " days" : "", v.own ? "accent" : "");
      })),
      facts(H, "Where the fields come from", [
        ["Sources", Object.keys(Ga.sources || {}).join(", ")],
        ["Per-field provenance", (Ga.fields || []).length + " fields, each with its own source"],
        ["Catalog version", Ga.catalog ? Ga.catalog.version : ""]
      ])
    ], note: "Provenance is per field, not per crop: a spacing from \u00daKZUZ and a yield from the household sit on the same row." };
  });

  def("/garden/catalog/overrides", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    if (!(Ga.overrides || []).length) return null;
    return { sections: [
      H.section("Your changes to the catalog", (Ga.overrides || []).map(function (o) {
        return H.row(o.id, tryv(function () { return Ga.cropName(o.crop); }, o.crop) + " \u00b7 " + o.field,
                     (o.why || "") + " \u00b7 " + o.by + " \u00b7 " + H.day(o.on), String(o.value), "accent");
      }))
    ], note: "An override is shown as an override, with the catalog value still readable underneath it." };
  });

  def("/garden/plantings/p26-01", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    var ps = tryv(function () { return Ga.plantingsOf(2026) || []; }, []);
    if (!ps.length) return null;
    return { sections: [
      H.section("2026", ps.map(function (p) {
        return H.row(p.id, tryv(function () { return Ga.cropName(p.crop); }, p.crop) +
                     (p.variety ? " \u00b7 " + tryv(function () { return Ga.varName(p.variety); }, p.variety) : ""),
                     "bed " + p.bed + " \u00b7 " + p.area + " m\u00b2" + (p.plants ? " \u00b7 " + p.plants + " plants" : "") +
                     (p.cleared ? " \u00b7 cleared " + H.day(p.cleared) : ""),
                     p.planned && p.planned.transplant ? H.day(p.planned.transplant) : "", "", true);
      }))
    ], note: "One planting is one crop in one place for one season. Its windows come from the catalog and its dates from the season." };
  });

  def("/garden/tasks", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    var ts = tryv(function () { return Ga.tasks(2026) || []; }, []);
    if (!ts.length) return null;
    var open = ts.filter(function (t) { return t.status !== "done"; });
    var done = ts.filter(function (t) { return t.status === "done"; });
    function r(t) {
      return H.row(t.id, t.title, (t.manual ? "added by hand" : "generated") + (t.edited ? " \u00b7 edited" : "") +
                   (t.why ? " \u00b7 " + t.why : ""), H.day(t.due),
                   t.due < H.TODAY && t.status !== "done" ? "danger" : "");
    }
    return { sections: [
      H.section("To do", open.slice(0, 20).map(r)),
      H.section("Done", done.slice(-8).map(function (t) { return H.row(t.id, t.title, "done", H.day(t.due), "muted"); })),
      facts(H, "Generation", [["Generated", String(ts.filter(function (t) { return t.is_generated; }).length)],
                              ["By hand", String(ts.filter(function (t) { return t.manual; }).length)],
                              ["Tombstoned", String(tryv(function () { return (Ga.tombstones() || []).length; }, 0))]])
    ], note: "A deleted generated task leaves a tombstone, so regenerating does not bring it back." };
  });

  def("/garden/plantings/p26-01#drift", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    var d = tryv(function () { return Ga.driftRun(); }, null); if (!d) return null;
    var p = d.planting || {};
    return { sections: [
      facts(H, "Planned against actual", [
        ["Planting", tryv(function () { return Ga.cropName(p.crop); }, p.crop) + " \u00b7 bed " + p.bed],
        ["Planned transplant", p.planned ? H.day(p.planned.transplant) : ""],
        ["Actually", p.actual ? words(Object.keys(p.actual).map(function (k) { return k + " " + H.day(p.actual[k]); })) : ""],
        ["Drift", d.days !== undefined ? d.days + " days" : words(d.says)]
      ]),
      d.tasks ? H.section("What moved", (d.tasks || []).map(function (t) {
        return H.row("", t.title || words(t), t.was && t.now ? H.day(t.was) + " \u2192 " + H.day(t.now) : "", "");
      })) : null
    ].filter(Boolean), note: "Reality moves the tasks. It never rewrites the plan, so next season still compares against what was intended." };
  });

  def("/garden/season/2026/checks", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    var defs = Ga.checkDefs || [];
    if (!defs.length) return null;
    return { sections: [
      H.section("Checks", defs.map(function (d) { return tuple(H, d); })),
      H.section("Dismissed", (Ga.dismissals || []).map(function (d) {
        return H.row("", d.check + " \u00b7 " + d.entity, (d.note || "") + " \u00b7 " + d.by + " \u00b7 " + H.day(d.on),
                     "season " + d.season, "muted");
      })),
      facts(H, "What a check cannot do", [["Block a save", "no \u2014 every check is advisory"],
                                          ["Need history", "C6 says so explicitly and states its no-history case"]])
    ], note: "Eleven checks, zero saves blocked. A check with no history says it has none rather than passing quietly." };
  });

  def("/garden/season/new?copy=2026", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    var c = tryv(function () { return Ga.dryRunCompare(2026); }, null); if (!c) return null;
    var straight = (c.straight && c.straight.plantings) || [];
    return { sections: [
      facts(H, "Copying 2026 into 2027", [
        ["Plantings copied", String(straight.length)],
        ["Frost shift", c.straight ? String(c.straight.shift) + " days" : ""],
        ["Compared with", c.shifted ? "the frost-shifted reading of the same copy" : "the straight copy"]
      ]),
      H.section("What would be created", straight.slice(0, 14).map(function (p) {
        return H.row(p.id, tryv(function () { return Ga.cropName(p.crop); }, p.crop) + " \u00b7 bed " + p.bed,
                     p.planned ? "transplant " + H.day(p.planned.transplant) : "", p.area + " m\u00b2");
      })),
      c.differences ? tuples(H, "Where the two readings differ", c.differences, 8) : null
    ].filter(Boolean), note: "The dry run is shown before the season exists. Nothing is written until the member accepts the list." };
  });

  def("/garden/season/2025/close", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    var c = tryv(function () { return Ga.seasonClose(2025); }, null); if (!c) return null;
    var s = c.season || {};
    return { sections: [
      facts(H, "Season 2025", [["Status", s.status], ["Closed", s.closedOn ? H.day(s.closedOn) + " by " + s.closedBy : "open"],
                               ["Frost, planned", H.day(s.lastFrost) + " \u2013 " + H.day(s.firstFrost)],
                               ["Frost, observed", H.day(s.observedLast) + " \u2013 " + H.day(s.observedFirst)]]),
      c.yields ? H.section("What it produced", (c.yields.rows || []).slice(0, 12).map(function (r) {
        var p = r.planting || {};
        return H.row(p.id || "", tryv(function () { return Ga.cropName(p.crop); }, p.crop) +
                     (p.bed ? " \u00b7 bed " + p.bed : ""),
                     (r.expected !== undefined ? "expected " + r.expected + " " + (r.unit || "") : "") +
                     (r.ratio !== undefined ? " \u00b7 " + Math.round(r.ratio) + " % of it" : "") +
                     (r.failed ? " \u00b7 " + (r.failed.why || r.failed) : ""),
                     (r.actual !== undefined ? String(r.actual).replace(".", ",") + " " + (r.unit || "") : ""),
                     r.failed ? "warning" : "");
      })) : null,
      H.section("What closing does", tryv(function () {
        var e = Ga.closeEffect() || [];
        return (Array.isArray(e) ? e : [e]).map(function (x) { return H.row("", words(x), x.why || "", ""); });
      }, []))
    ].filter(Boolean), note: "Closing a season freezes its observed frost dates, which is what the next season's copy reads." };
  });

  def("/garden/storage", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    if (!(Ga.storage || []).length) return null;
    return { sections: [
      H.section("In store", (Ga.storage || []).map(function (s) {
        return H.row(s.id, s.product, s.method + " \u00b7 " + s.where + " \u00b7 since " + H.day(s.on) +
                     (s.best ? " \u00b7 best by " + H.day(s.best) : ""),
                     s.remaining + " of " + s.initial + " " + s.unit,
                     s.best && s.best < H.TODAY ? "warning" : "");
      }))
    ], note: "The log is edited in place: taking a jar out is one tap on the row, not a new record to fill in." };
  });

  def("/garden?warning=frost", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    var w = tryv(function () { return Ga.frostWarning(H.TODAY, ctx.member); }, null);
    if (!w || !w.published) return null;
    return { sections: [
      facts(H, "Frost tonight", [["Low", w.min + " \u00b0C"], ["Measured at", when(H, w.measuredAt)],
                                 ["Threshold", Ga.frostThreshold ? "tender " + Ga.frostThreshold.tender + " \u00b0C" : ""]]),
      H.section("What is at risk", (w.plants || []).map(function (p) {
        return H.row(p.id, tryv(function () { return Ga.cropName(p.crop); }, p.crop) + " \u00b7 bed " + p.bed,
                     (p.hardiness || "") + (p.covered ? " \u00b7 covered" : " \u00b7 not covered"),
                     p.plants ? p.plants + " plants" : p.area + " m\u00b2", p.covered ? "muted" : "warning");
      }))
    ], note: "The warning names the plantings, not the garden. A covered row is listed and marked rather than left out." };
  });

  def("/garden/print/work?month=2026-09", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    var p = tryv(function () { return Ga.workPaper("2026-09"); }, null); if (!p) return null;
    return { sections: (p.sections || []).map(function (s) {
      return H.section(s.label + (s.en ? " \u00b7 " + s.en : ""), (s.items || []).map(function (i) {
        return H.row("", "\u2610  " + i.text, "", i.meta || "");
      }));
    }).concat([facts(H, "On paper", [
      ["Sheet", Ga.paper ? Ga.paper.name + " \u00b7 " + Ga.paper.w + "\u00d7" + Ga.paper.h + " mm" : ""],
      ["Body", Ga.printMetrics ? Ga.printMetrics.bodyPt + " pt on " + Ga.printMetrics.leadingPt + " pt" : ""],
      ["Checkboxes", "real boxes, printed \u2014 the sheet is used with a pencil in a garden pocket"]
    ])]).filter(function (s) { return s.rows.length; }),
      note: "This month's work, printed. Client-neutral: the print layout is one deliverable, not one per client." };
  });

  def("/garden/print/season?year=2026", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    var p = tryv(function () { return Ga.planPaper(2026); }, null); if (!p) return null;
    return { sections: [
      H.section("Plan 2026 \u00b7 bed by month", (p.rows || []).slice(0, 16).map(function (r) {
        return H.row("", (r.bed ? r.bed.label : "") + (r.zone ? " \u00b7 " + r.zone : ""),
                     (r.cells || []).filter(function (c) { return c.text; }).map(function (c) {
                       return c.month + ": " + c.text;
                     }).join(" \u00b7 "), r.bed ? r.bed.area + " m\u00b2" : "");
      }))
    ], note: "One sheet of paper for the year, one row per bed. It prints in ink the household already owns \u2014 no fills, no colour." };
  });

  /* ── Calendar ──────────────────────────────────────────────────────── */

  /* rsvp is answered per member: on a list row it is this member's own answer */
  function rsvpFor(C, o, ctx) {
    var v = o && o.rsvp;
    if (!v) return "";
    if (typeof v === "object") {
      var mine = v[ctx.member];
      if (!mine) {
        var yes = Object.keys(v).filter(function (k) { return v[k] === "yes"; }).length;
        return yes ? yes + " coming" : "";
      }
      return tryv(function () { return C.rsvpWord(mine); }, mine);
    }
    return tryv(function () { return C.rsvpWord(v); }, String(v));
  }

  function occRows(C, H, ctx, from, to) {
    var occ = tryv(function () { return C.occurrences(from, to) || []; }, []);
    var byDay = {}, order = [];
    occ.forEach(function (o) { if (!byDay[o.date]) { byDay[o.date] = []; order.push(o.date); } byDay[o.date].push(o); });
    return order.map(function (d) {
      return H.section(H.day(d) + (d === H.TODAY ? " \u00b7 today" : ""), byDay[d].map(function (o) {
        return H.row(o.key, H.pick(o, ctx), [o.kind === "allday" ? "all day" : (o.start || ""), o.place,
                     (o.who || []).join(", ")].filter(Boolean).join(" \u00b7 "),
                     rsvpFor(C, o, ctx),
                     o.conflict ? "warning" : "", true);
      }));
    });
  }

  def("/calendar/month/2026-09", function (ctx, H) {
    var C = G("HH_CALENDAR"); if (!C) return null;
    var g = tryv(function () { return C.monthGrid("2026-09"); }, null); if (!g) return null;
    var occ = tryv(function () { return C.occurrences("2026-08-31", "2026-10-04") || []; }, []);
    var count = {};
    occ.forEach(function (o) { count[o.date] = (count[o.date] || 0) + 1; });
    var cells = g.cells || [], weeks = [];
    for (var i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return { sections: weeks.map(function (w, i) {
      return H.section("Week " + (i + 1), w.map(function (c) {
        var n = count[c.date] || 0;
        return H.row(c.date, H.day(c.date), n ? n + (n === 1 ? " event" : " events") : "",
                     c.today ? "today" : "", c.inMonth ? (c.today ? "accent" : "") : "muted", true);
      }));
    }), note: "Month is the web default. A cell gives 46 px against a 50 px time label, which is why the mobile default is agenda." };
  });

  def("/calendar/week/2026-W37", function (ctx, H) {
    var C = G("HH_CALENDAR"); if (!C) return null;
    var secs = occRows(C, H, ctx, "2026-09-07", "2026-09-13");
    if (!secs.length) return null;
    return { sections: secs, note: "Seven columns on a tablet and a desktop, seven stacked days on a phone \u2014 one set of rows either way." };
  });

  def("/calendar/day/2026-09-09", function (ctx, H) {
    var C = G("HH_CALENDAR"); if (!C) return null;
    var secs = occRows(C, H, ctx, "2026-09-09", "2026-09-09");
    var e = C.empty || {};
    if (!secs.length) {
      return { sections: [H.section("Nothing today", [H.row("", e.sentence || e.en || "A quiet day.", e.example || "", "")])],
               note: "The one empty state in the set that is not an invitation: a quiet day is said out loud, not taught." };
    }
    return { sections: secs, note: "The day view is empty often and legitimately, so its empty state says the quiet day rather than teaching." };
  });

  def("/calendar/events/s-pilates/edit", function (ctx, H) {
    var C = G("HH_CALENDAR"); if (!C) return null;
    var s = (C.series || [])[0]; if (!s) return null;
    return { sections: [
      facts(H, H.pick(s, ctx), [["Kind", s.kind], ["Starts", H.day(s.start) + (s.from ? " " + s.from : "")],
                                ["Ends", s.to || ""], ["Where", s.place || ""],
                                ["Who", (s.who || []).join(", ")], ["Author", s.author],
                                ["Origin", s.origin], ["Visibility", s.visibility],
                                ["Reminder", words(s.reminder)]]),
      H.section("Exceptions on this series", (C.exceptions || []).filter(function (e) { return e.series === s.id; })
        .map(function (e) {
          return H.row("", H.day(e.date) + " \u00b7 " + e.type, (e.why || "") + " \u00b7 " + e.by, e.from ? e.from + "\u2013" + e.to : "");
        }))
    ], note: "A series and its exceptions are two objects. Editing one occurrence writes an exception rather than splitting the series." };
  });

  def("/calendar/events/s-pilates/edit#scope", function (ctx, H) {
    var C = G("HH_CALENDAR"); if (!C) return null;
    var run = tryv(function () { var r = C.choiceRun(); return (r && r.run) || r; }, null);
    var rows = (run && (run.choices || run.rows)) || [];
    var s = (run && run.series) || (C.series || [])[0];
    if (!rows.length && s) rows = (C.exceptions || []).filter(function (e) { return e.series === s.id; });
    if (!rows.length) return null;
    return { sections: [
      facts(H, "The occurrence", [["Event", s ? H.pick(s, ctx) : ""],
                                  ["Date", run && run.date ? H.day(run.date) : ""],
                                  ["Repeats", s && s.rrule ? s.rrule.freq + " \u00b7 every " + s.rrule.interval : ""]]),
      H.section("What should this change apply to?", rows.map(function (r) {
        return H.row("", words(r) || (r.type ? H.day(r.date) + " \u00b7 " + r.type : ""),
                     r.consequence || r.says || r.why || "", r.scope || r.type || "");
      }))
    ].filter(function (x) { return x.rows.length; }),
      note: "Three choices, and each one states its own consequence before it is taken \u2014 not after." };
  });

  def("/calendar/events/s-pilates#who", function (ctx, H) {
    var C = G("HH_CALENDAR"); if (!C) return null;
    var keys = Object.keys(C.rsvp || {});
    if (!keys.length) return null;
    return { sections: [
      H.section("Who is coming", keys.map(function (k) {
        var v = C.rsvp[k];
        var per = typeof v === "object" ? Object.keys(v).map(function (m) {
          return tryv(function () { return C.name(m); }, m) + " \u00b7 " + tryv(function () { return C.rsvpWord(v[m]); }, v[m]);
        }).join(", ") : words(v);
        return H.row(k, tryv(function () { return H.pick((C.series || []).filter(function (x) { return x.id === k.split("|")[0]; })[0], ctx); }, k.split("|")[0]) || k.split("|")[0],
                     per, when(H, k.split("|")[1]));
      })),
      tuples(H, "The four answers", C.rsvpWords, 4)
    ], note: "An RSVP is per occurrence, not per series. Answering one Thursday says nothing about the next." };
  });

  def("/calendar#who", function (ctx, H) {
    var C = G("HH_CALENDAR"); if (!C) return null;
    var o = tryv(function () { return C.whoOverlay("2026-09-07", "2026-09-13"); }, null);
    if (!o || !o.members) return null;
    return { sections: [
      H.section("Whose is what", o.members.map(function (m) {
        return H.row(m.id, m.name, "colour " + m.colour + " \u00b7 initial " + m.initial + " \u00b7 and the name on the row",
                     m.count + " this week", m.on ? "accent" : "");
      }))
    ], note: "Colour is never the only carrier: every row also has the member's name, and the overlay is a filter rather than a legend." };
  });

  def("/calendar/week/2026-W37#busy", function (ctx, H) {
    var C = G("HH_CALENDAR"); if (!C) return null;
    var occ = tryv(function () { return C.occurrences("2026-09-07", "2026-09-13") || []; }, []);
    var busy = occ.filter(function (o) { return o.visibility === "busy" || o.busy; })[0] || occ[0];
    var b = tryv(function () { return C.busyRow(busy); }, null);
    return { sections: [
      facts(H, "A busy block", [["Owner", b ? tryv(function () { return C.name(b.owner); }, b.owner) : ""],
                                ["Date", b ? H.day(b.date) : ""],
                                ["Fields kept", b ? Object.keys(b).join(", ") : ""],
                                ["Fields dropped", (C.stripped || []).length + " \u00b7 " + (C.stripped || []).join(", ")]])
    ], note: "Five fields kept, nine dropped. A private event's busy block carries no title, no place and no participants." };
  });

  def("/calendar/connections/new", function (ctx, H) {
    var C = G("HH_CALENDAR"); if (!C) return null;
    var offer = tryv(function () { return C.connectOffer("google", ctx.member); }, null);
    return { sections: [
      tuples(H, "Providers", C.providers, 6),
      offer ? facts(H, "What connecting would do", [
        ["Provider", offer.name], ["How", offer.how], ["Account", offer.account],
        ["Direction offered first", offer.direction], ["Scope offered first", offer.scope],
        ["In words", offer.sentence]
      ]) : null
    ].filter(Boolean), note: "Busy-only is offered first, and the recipient is named at the moment of connecting rather than in a settings screen later." };
  });

  def("/calendar/connections/c-jana-google", function (ctx, H) {
    var C = G("HH_CALENDAR"); if (!C) return null;
    return { sections: [
      tuples(H, "Direction", C.directions, 4),
      tuples(H, "Scope", C.scopes, 4),
      H.section("On this connection", (C.connections || []).slice(0, 1).map(function (c) {
        return H.row(c.id, c.account, (c.calendars || []).map(function (cal) { return cal.id || words(cal); }).join(", "), c.provider);
      }))
    ], note: "Direction and scope are per remote calendar, not per account. This is a privacy screen wearing a settings screen's clothes." };
  });

  def("/calendar/connections", function (ctx, H) {
    var C = G("HH_CALENDAR"); if (!C) return null;
    if (!(C.connections || []).length) return null;
    return { sections: [
      H.section("Connected calendars", (C.connections || []).map(function (c) {
        var h = tryv(function () { return C.health(c.id, ctx.member); }, null);
        return H.row(c.id, c.account, [c.provider, "added " + H.day(c.added),
                     c.lastOk ? "last ok " + when(H, c.lastOk) : "",
                     c.attempts ? c.attempts + " failed attempts" : ""].filter(Boolean).join(" \u00b7 "),
                     h ? h.word : c.health, h && h.state !== "ok" ? "warning" : "", true);
      }))
    ], note: "Health carries a staleness badge with a word beside it, because a silent connection looks identical to a working one." };
  });

  def("/calendar/conflicts/c-boiler", function (ctx, H) {
    var C = G("HH_CALENDAR"); if (!C) return null;
    var e = C.external; if (!e) return null;
    return { sections: [
      facts(H, "Two versions", [["Occurrence", (function () {
                                   var k = String(words(e.occurrence) || e.occurrence || "").split("|");
                                   var sr = (C.series || []).filter(function (x) { return x.id === k[0]; })[0];
                                   return [sr ? H.pick(sr, ctx) : k[0], k[1] ? when(H, k[1]) : ""].filter(Boolean).join(" \u00b7 ");
                                 })()],
                                ["Here", words(e.local)], ["Over there", words(e.remote)],
                                ["Rule", words(e.rule)]]),
      H.section("The other version", [
        H.row("", "It is preserved", "for " + (C.loserDays || 30) + " days, and offered on the row rather than mailed to anyone", "")
      ])
    ], note: "An external conflict keeps both readings. The remote one wins by rule, and the local one is still there to look at." };
  });

  def("/calendar/connections/c-jana-google/disconnect", function (ctx, H) {
    var C = G("HH_CALENDAR"); if (!C) return null;
    var c = (C.connections || [])[0]; if (!c) return null;
    var d = tryv(function () { return C.disconnect(c.id, ctx.member); }, null);
    return { sections: [
      facts(H, "Disconnect " + c.account, [["Provider", c.provider],
                                           ["Mirrored events", d && d.mirrored !== undefined ? String(d.mirrored) : ""],
                                           ["Added", H.day(c.added)]]),
      H.section("What should happen to the mirrored events?", tryv(function () {
        var opts = (d && (d.choices || d.options)) || [];
        return opts.map(function (o) { return H.row("", words(o), o.says || o.why || "", ""); });
      }, [
        H.row("", "Keep them here", "They stop updating and stay as ordinary rows.", ""),
        H.row("", "Remove them", "They leave this household. Nothing is deleted on the other side.", "")
      ]))
    ], note: "Disconnecting asks. It does not quietly keep a copy, and it does not quietly delete one either." };
  });

  /* ── Property, Vehicles, Pets ──────────────────────────────────────── */

  def("/property/items/kotel-vaillant", function (ctx, H) {
    var A = G("HH_ASSETS"); if (!A) return null;
    var e = tryv(function () { return A.entity("kotel-vaillant"); }, null); if (!e) return null;
    return { sections: [
      facts(H, H.pick(e, ctx), [["Category", e.category], ["Acquired", H.day(e.acquired)],
                                ["Price", e.price ? A.czk(e.price) : ""], ["Status", e.status],
                                ["Detail", e.meta], ["Documents", String(e.docs || 0)]]),
      H.section("Service schedule", tryv(function () {
        return (A.schedulesOf(e.id) || []).map(function (s) {
          var d = tryv(function () { return A.due(s.id, H.TODAY); }, null);
          return H.row(s.id, s.cs, s.basis + (s.months ? " \u00b7 every " + s.months + " months" : "") +
                       " \u00b7 last done " + H.day(s.lastDone), d ? H.day(d.resolved) + " \u00b7 " + d.reason : "",
                       d && d.resolved < H.TODAY ? "danger" : "");
        });
      }, [])),
      H.section("What has been done", tryv(function () {
        return (A.recordsOf(e.id) || []).map(function (r) {
          return H.row(r.id, r.what, H.day(r.date) + " \u00b7 " + (r.actor || r.by || "") + (r.docs ? " \u00b7 " + r.docs + " docs" : ""),
                       r.cost ? A.czk(r.cost) : "");
        });
      }, []))
    ], note: "One asset engine, three vocabularies. In Property the words are the house's own \u2014 nothing here says asset." };
  });

  def("/property/setup/checklist", function (ctx, H) {
    var A = G("HH_ASSETS"); if (!A) return null;
    var s = tryv(function () { return A.starterRun("CZ"); }, null); if (!s) return null;
    return { sections: [
      H.section("Most houses in " + s.country + " have these", (s.items || []).map(function (i) {
        return H.row("", i.cs, i.note || "", i.months ? "every " + i.months + " months" : "");
      }))
    ], note: "A country starter list, ticked or skipped. Nothing is created until the member says so." };
  });

  def("/property/contractors", function (ctx, H) {
    var A = G("HH_ASSETS"); if (!A) return null;
    if (!(A.contractors || []).length) return null;
    return { sections: [
      H.section("People who have worked on the house", (A.contractors || []).map(function (c) {
        return H.row(c.id, c.name, c.trade + " \u00b7 " + (c.phone || "") + (c.note ? " \u00b7 " + c.note : ""),
                     (c.did || []).length + " jobs");
      }))
    ], note: "A contractor is attached to the jobs they did, so the record survives the phone that had the number in it." };
  });

  def("/property/dum-brno/meters", function (ctx, H) {
    var A = G("HH_ASSETS"); if (!A) return null;
    if (!(A.meters || []).length) return null;
    return { sections: [
      H.section("Where the meters are", (A.meters || []).map(function (m) {
        return H.row("", m.cs, m.where + (m.note ? " \u00b7 " + m.note : ""), m.photo ? "photo" : "", "");
      }))
    ], note: "Written for whoever is in the house when something goes wrong, which is not always the person who filled it in." };
  });

  def("/property/print/inventory", function (ctx, H) {
    var A = G("HH_ASSETS"); if (!A) return null;
    var ents = tryv(function () { return A.entitiesOf("property", ctx.member) || []; }, []);
    if (!ents.length) return null;
    var total = ents.reduce(function (a, e) { return a + (e.price || 0); }, 0);
    return { sections: [
      H.section("Insurance inventory", ents.map(function (e) {
        return H.row(e.id, H.pick(e, ctx), (e.category || "") + (e.acquired ? " \u00b7 " + H.day(e.acquired) : "") +
                     (e.meta ? " \u00b7 " + e.meta : ""), e.price ? A.czk(e.price) : "", "");
      })),
      facts(H, "On paper", [["Items", String(ents.length)], ["Declared value", A.czk(total)],
                            ["Documents attached", String(ents.reduce(function (a, e) { return a + (e.docs || 0); }, 0))]])
    ], note: "The most valuable thing in the app on exactly one very bad day, and it has to print without the app." };
  });

  /* the asset engine stores usage in thousandths, and every screen that shows it
     has to say the unit — 132 560 km, never 132560. */
  function km(A, milli, unit) {
    if (milli === null || milli === undefined) return "";
    return tryv(function () { return A.num(milli / 1000, 0); }, String(milli / 1000)) + " " + (unit || "km");
  }

  function vehicle(which) {
    return function (ctx, H) {
      var A = G("HH_ASSETS"); if (!A) return null;
      var id = "octavia";
      if (which === "schedules") {
        var rows = tryv(function () { return A.schedulesOf(id) || []; }, []);
        if (!rows.length) return null;
        return { sections: [H.section("Service schedule", rows.map(function (s) {
          var d = tryv(function () { return A.due(s.id, H.TODAY); }, null);
          return H.row(s.id, s.cs, s.basis + (s.months ? " \u00b7 every " + s.months + " months" : "") +
                       (d && d.usageDueAt ? " \u00b7 or at " + km(A, d.usageDueAt * 1000, "km") : "") +
                       " \u00b7 last " + H.day(s.lastDone),
                       d ? H.day(d.resolved) + " \u00b7 " + d.reason : "", d && d.estimate ? "warning" : "");
        }))], note: "Interval, usage, or whichever comes first. The row says which of the two produced the date." };
      }
      if (which === "records") {
        var recs = tryv(function () { return A.recordsOf(id) || []; }, []);
        if (!recs.length) return null;
        return { sections: [H.section("What has been done", recs.map(function (r) {
          return H.row(r.id, r.what, H.day(r.date) + " \u00b7 " + (r.actor || r.by || "") + (r.docs ? " \u00b7 " + r.docs + " docs" : ""),
                       r.cost ? A.czk(r.cost) : "");
        }))], note: "Service history is the asset's own log. It outlives the garage, the owner and the phone." };
      }
      if (which === "readings") {
        var rs = tryv(function () { return A.readingsOf(id) || []; }, []);
        if (!rs.length) return null;
        return { sections: [
          H.section("Odometer", rs.slice(-10).reverse().map(function (r) {
            return H.row("", H.day(r.date), (r.by || "") + " \u00b7 " + (r.src || ""),
                         km(A, r.milli, r.unit));
          })),
          A.rejectedReading ? facts(H, "A reading that was refused", [
            ["Value", km(A, A.rejectedReading.milli, A.rejectedReading.unit)],
            ["Against", km(A, A.rejectedReading.againstMilli, A.rejectedReading.unit)],
            ["Reason", A.rejectedReading.says || A.rejectedReading.reason]
          ]) : null
        ].filter(Boolean), note: "Usage readings are monotonic. A lower number is refused with the number it was measured against." };
      }
      if (which === "statutory") {
        var st = (A.statutory || {}).CZ; if (!st) return null;
        var e = tryv(function () { return A.entity(id); }, null);
        return { sections: [
          H.section("Statutory dates \u00b7 \u010cesko", [
            H.row("", st.inspection, "The first one falls " + st.first + " months after the car was registered, and every " +
                  st.then + " months after that.", st.first + " / " + st.then + " months"),
            H.row("", st.tax ? "Road tax" : "No road tax",
                  st.taxNote || "", st.tax ? "due" : "not registered", st.tax ? "" : "muted")
          ]),
          e ? facts(H, "This car", [["Vehicle", H.pick(e, ctx)], ["Registered", H.day(e.acquired)],
                                    ["Kind", e.category || ""]]) : null
        ].filter(Boolean),
          note: "Statutory dates are per country and per vehicle kind. A bike is never asked for a plate or an STK." };
      }
      if (which === "insurance") {
        var ins = (A.insurance || []).filter(function (i) { return i.entity === id; });
        if (!ins.length) return null;
        return { sections: [
          H.section("Policies", ins.map(function (i) {
            return H.row(i.id, i.type + " \u00b7 " + i.insurer, "number " + i.number + " \u00b7 " + H.day(i.start) + " \u2013 " + H.day(i.end) +
                         " \u00b7 notice " + i.noticeDays + " days", A.czk(i.premium) + " / " + i.cadence);
          })),
          facts(H, "The reminder", [["Renews", H.day(ins[0].end)],
                                    ["Notice period", ins[0].noticeDays + " days"],
                                    ["So the reminder fires", H.day(tryv(function () { return A.addDays(ins[0].end, -ins[0].noticeDays); }, ins[0].end))]])
        ], note: "Insurance renewal counts back from the notice period, not from the renewal date. That is the day the household can still act." };
      }
      if (which === "fuel") {
        var run = tryv(function () { return A.fuelRun(); }, null);
        if (!run) return null;
        return { sections: [
          H.section("Fills", (A.fuel || []).slice().reverse().map(function (f) {
            return H.row("", H.day(f.date) + " \u00b7 " + (f.station || ""),
                         f.odo + " km \u00b7 " + f.litres + " l" + (f.full ? " \u00b7 full" : " \u00b7 partial"),
                         A.czk(f.cost * 100), f.full ? "" : "muted");
          })),
          H.section("Consumption, full to full", (run.intervals || []).map(function (i) {
            return H.row("", H.day(i.from) + " \u2013 " + H.day(i.to),
                         i.km + " km \u00b7 " + i.litres + " l" + (i.partials ? " \u00b7 " + i.partials + " partial fills inside" : ""),
                         i.per100.toFixed(2) + " l/100 km");
          }))
        ], note: run.fulls + " full tanks and " + run.partials + " partial fills: consumption is only computed between two fulls." };
      }
      if (which === "tco") {
        var t = tryv(function () { return A.tco(id); }, null); if (!t) return null;
        return { sections: [
          facts(H, "What it costs", [["Vehicle", t.entity ? H.pick(t.entity, ctx) : ""],
                                     ["Per year", t.perYear !== undefined ? A.czk(t.perYear) : ""],
                                     ["Per km", t.perKm !== undefined ? A.czk(t.perKm) : ""],
                                     ["Total recorded", t.total !== undefined ? A.czk(t.total) : ""]]),
          t.rows ? tuples(H, "Where it goes", t.rows, 10) : null
        ].filter(Boolean), note: "Cost is summed from what was recorded, and the screen says what it does not know rather than estimating it." };
      }
      if (which === "bike") {
        var b = tryv(function () { return A.entity("kolo-adam"); }, null); if (!b) return null;
        var audit = tryv(function () { return A.bikeAudit(); }, null);
        return { sections: [
          facts(H, H.pick(b, ctx), [["Category", b.category], ["Acquired", H.day(b.acquired)],
                                    ["Detail", b.meta], ["Status", b.status]])
        ], note: "A bike is a vehicle without a plate, an STK or a fuel log. The variant drops fields rather than showing empty ones." };
      }
      return null;
    };
  }
  def("/assets/vehicle/octavia/records", vehicle("records"));
  def("/assets/vehicle/octavia/readings", vehicle("readings"));
  def("/vehicles/octavia/statutory", vehicle("statutory"));
  def("/vehicles/octavia/insurance", vehicle("insurance"));
  def("/vehicles/octavia/fuel", vehicle("fuel"));
  def("/vehicles/octavia/costs", vehicle("tco"));
  def("/vehicles/kolo-adam", vehicle("bike"));

  def("/pets/bela/health", function (ctx, H) {
    var A = G("HH_ASSETS"); if (!A) return null;
    var rows = tryv(function () { return A.healthOf("bela") || []; }, []);
    if (!rows.length) return null;
    return { sections: [
      H.section("Health record", rows.map(function (h) {
        return H.row(h.id, h.cs, h.type + " \u00b7 " + H.day(h.date) + (h.vet ? " \u00b7 " + h.vet : "") +
                     (h.meta ? " \u00b7 " + h.meta : ""), h.cost ? A.czk(h.cost) : "", "");
      }))
    ], note: "Kept for the animal, not for an inventory. Nothing on this screen calls Bela an asset." };
  });

  def("/pets/bela/medication", function (ctx, H) {
    var A = G("HH_ASSETS"); if (!A) return null;
    var m = A.medication || {};
    var doses = tryv(function () { return A.doses(H.TODAY) || []; }, []);
    if (!doses.length) return null;
    return { sections: [
      facts(H, m.cs || "Medication", [["Reason", m.reason], ["Dose", m.dose], ["Times a day", String(m.perDay)],
                                      ["Course", H.day(m.start) + " \u00b7 " + m.days + " days"], ["Vet", m.vet]]),
      H.section("Doses", doses.map(function (d) {
        return H.row(d.id, H.day(d.date) + " \u00b7 " + d.time,
                     d.given ? "given by " + d.by + " at " + d.at : (d.due ? "due" : "not yet"),
                     d.given ? "\u2713" : "", d.given ? "muted" : (d.due ? "warning" : ""));
      }))
    ], note: "A dose is ticked once for the household: whoever gives it, everybody else sees it done. Two people cannot both give it." };
  });

  def("/pets/routine", function (ctx, H) {
    var A = G("HH_ASSETS"); if (!A) return null;
    var rows = tryv(function () { return A.routineFor("bela") || []; }, []);
    if (!rows.length) return null;
    return { sections: [
      H.section("Today", rows.map(function (r) {
        return H.row(r.id, r.cs, r.at + (r.by ? " \u00b7 " + r.by + (r.time ? " at " + r.time : "") : ""),
                     r.done ? "\u2713" : "", r.done ? "muted" : "");
      }))
    ], note: "The routine resets every day. It is the screen you hand to whoever is looking after them." };
  });

  def("/pets/bela/vet", function (ctx, H) {
    var A = G("HH_ASSETS"); if (!A) return null;
    var v = A.vet; if (!v) return null;
    return { sections: [
      facts(H, "The vet card", [["Practice", v.practice], ["Vet", v.vet], ["Phone", v.phone],
                                ["Hours", v.hours], ["Out of hours", v.outOfHours],
                                ["Address", v.address], ["Chip registry", v.chipRegistry],
                                ["Insurance", v.insurance]]),
      v.outOfHoursNote ? H.section("At night", [H.row("", v.outOfHoursNote, "", "")]) : null
    ].filter(Boolean), note: "One tap from the top of the module, because the day it is needed nobody is browsing." };
  });

  def("/pets/bela/feeding", function (ctx, H) {
    var A = G("HH_ASSETS"); if (!A) return null;
    var f = A.feeding; if (!f) return null;
    return { sections: [
      facts(H, "Feeding", [["Food", f.food], ["Amount", f.amount], ["Meals", String(f.meals)],
                           ["Total a day", f.total], ["Times", (f.times || []).join(", ")],
                           ["Treats", f.treats]]),
      H.section("Allergies", (f.allergies || []).map(function (a) { return H.row("", String(a), "", "", "warning"); })),
      H.section("Never", (f.never || []).map(function (a) { return H.row("", String(a), "", "", "danger"); }))
    ], note: f.note || "Written to be handed over: the numbers are on the screen, not in somebody's head." };
  });

  def("/pets/bela/weight", function (ctx, H) {
    var A = G("HH_ASSETS"); if (!A) return null;
    var w = tryv(function () { return A.weightRun("bela"); }, null);
    var pts = (w && w.points) || [];
    if (!pts.length) return null;
    return { sections: [
      H.section("Weight", pts.slice().reverse().map(function (p) {
        return H.row("", H.day(p.date), (p.by || "") + " \u00b7 " + (p.src === "vet" ? "at the vet" : "at home"),
                     p.kg + " kg", "");
      })),
      w.trend ? facts(H, "Trend", [["Change", words(w.trend)]]) : null
    ].filter(Boolean), note: "Home and vet readings are marked differently, because the scales disagree and the vet's is the one that counts." };
  });

  def("/pets/bela/status", function (ctx, H) {
    var A = G("HH_ASSETS"); if (!A) return null;
    var flow = A.statusFlow || [];
    if (!flow.length) return null;
    return { sections: flow.map(function (s) {
      return H.section(s.title, [H.row("", s.body || "", "", "")].concat((s.choices || []).map(function (c, i) {
        return H.row("c" + i, words(c) || String(c), (c && (c.says || c.why)) || "", "");
      })));
    }), note: "A gentle flow with no deletion in it. The record stays; what changes is how the app talks about it." };
  });

  /* ── Household administration ──────────────────────────────────────── */

  function hhScreenFields(id) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return [];
    var s = (Ho.screens || []).filter(function (x) { return x.id === id; })[0];
    return (s && s.fields) || [];
  }

  function grantMatrix(ctx, H, who) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    var m = tryv(function () { return Ho.matrixFor(who); }, null);
    var rows = Array.isArray(m) ? m : (m && (m.rows || m.modules)) || [];
    if (!rows.length) return null;
    return H.section("What " + who + " would get", rows.map(function (r) {
      var lvl = r.level || r.grant || (Array.isArray(r) ? r[1] : "");
      return H.row("", words(r) || (Array.isArray(r) ? r[0] : ""),
                   tryv(function () { return Ho.phrase[lvl]; }, "") || r.says || "",
                   String(lvl), lvl === "none" ? "muted" : "");
    }));
  }


  def("/invitations/K7M2-4PQX", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    var m = tryv(function () { return Ho.matrixFor("petr") || []; }, []);
    if (!m.length) return null;
    var held = m.filter(function (r) { return r.level && r.level !== "none"; });
    var off = m.filter(function (r) { return !r.level || r.level === "none"; });
    return { sections: [
      H.section("What Jana is giving you", held.map(function (r) {
        return H.row(r.key, r.name, r.phrase || "", r.level, "");
      })),
      H.section("What you will not see at all", off.map(function (r) {
        return H.row(r.key, r.name, "absent \u2014 no tab, no row, no trace", "", "muted");
      })),
      facts(H, "The invitation", [["Household", "Tilcerovi"], ["From", "Jana"],
                                  ["Modules offered", held.length + " of " + m.length],
                                  ["Code", "K7M2-4PQX"]])
    ], note: "The acceptance screen shows exactly what is being given, and what is withheld is shown as absence rather than as a locked row." };
  });

  def("/households/tilcerovi/invitations", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    var s = (Ho.screens || []).filter(function (x) { return x.id === "A-25"; })[0];
    if (!s) return null;
    return { sections: [
      facts(H, s.title || "The invitation", [["What happened", s.lede || ""],
                                             ["Notice", words(s.notice)],
                                             ["Primary action", words(s.primary)],
                                             ["Also offered", (s.secondary || []).map(words).join(" \u00b7 ")],
                                             ["If it fails", s.error || ""]]),
      H.section("What happens next", [
        H.row("", "Petr is not a member",
              s.foot || s.note || "The invitation can be sent again, with the same grants or different ones.", "")
      ])
    ], note: "A declined invitation is a state of the invitation, not an error. Nothing about the household changed." };
  });

  def("/households/new", function (ctx, H) {
    var f = hhScreenFields("A-22");
    if (!f.length) return null;
    return { sections: [H.section("Four fields, three of them already answered", f.map(function (x) {
      return H.row("", x.label, x.hint || "", x.value === undefined ? "" : String(x.value), x.hint ? "muted" : "");
    }))], note: "Country, currency, timezone and first day of the week are answered once here and read by every module afterwards." };
  });

  def("/households/tilcerovi/leave", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    if (!(Ho.leave || []).length) return null;
    return { sections: [tuples(H, "Before you can leave", Ho.leave, 8)],
             note: "Leaving is blocked by things that would be orphaned, and each blocker names what to do about it." };
  });

  def("/households/tilcerovi/billing/subscribe", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    return { sections: [tuples(H, "The plan", Ho.price, 6)],
             note: "One price in euro in every market: \u20ac4.99, billed in EUR even here. The household's own money stays in CZK." };
  });

  def("/households/tilcerovi/settings/billing", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    return { sections: [
      tuples(H, "The eight states", Ho.ent, 10),
      H.section("What each one shows", (Ho.banners || []).map(function (b) {
        return H.row(b.key, b.title || b.key, b.body || "", b.dismissible ? "dismissible" : "",
                     b.tone === "danger" ? "danger" : b.tone === "warning" ? "warning" : "");
      }))
    ], note: "Active shows nothing at all. Suspended is not a banner \u2014 it is a lockout screen, and it carries no export button." };
  });

  def("/households/tilcerovi/billing/takeover", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    var f = hhScreenFields("A-29");
    return { sections: [
      f.length ? H.section("Taking over billing", f.map(function (x) { return tuple(H, x); })) : null,
      tuples(H, "What it would cost", Ho.price, 6)
    ].filter(Boolean), note: "Taking over billing moves the payment method, not the ownership of the household." };
  });

  def("/households/tilcerovi/settings/sync", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    if (!(Ho.devices || []).length) return null;
    return { sections: [H.section("Sync health", (Ho.devices || []).map(function (d) {
      return H.row("", d.name, d.meta || "", d.action || "", d.tone === "warning" ? "warning" : "");
    }))], note: "Health per device, and revoking one discards its replica rather than pretending the data was never there." };
  });

  def("/support/diagnostics", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    if (!(Ho.bundle || []).length) return null;
    return { sections: [tuples(H, "This is what would be sent", Ho.bundle, 12)],
             note: "The bundle is rendered in full before it is sent. Nothing is collected that is not on this screen." };
  });

  def("/households/tilcerovi/exports", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    if (!(Ho.rights || []).length) return null;
    return { sections: [tuples(H, "Your data", Ho.rights, 8)],
             note: "Export sits next to restrict, not next to billing: they are the same kind of promise." };
  });

  def("/households/tilcerovi/settings", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    var st = Ho.storage || {};
    return { sections: [
      H.section("Sections", [
        H.row("/households/tilcerovi/settings/members", "Members", "who is here and what they hold", "", "", true),
        H.row("/households/tilcerovi/settings/modules", "Modules", (Ho.modules || []).length + " modules", "", "", true),
        H.row("/households/tilcerovi/settings/storage", "Storage", "against the allowance", "", "", true),
        H.row("/households/tilcerovi/settings/billing", "Billing", "the eight states", "", "", true),
        H.row("/households/tilcerovi/settings/data", "Data", "export, restrict, delete", "", "", true),
        H.row("/households/tilcerovi/settings/advanced", "Clients and versions", "devices and replicas", "", "", true)
      ]),
      facts(H, "At a glance", [["Storage used", st.current !== undefined ? st.current + " of " + st.allowance + " GB" : ""],
                               ["Derived overhead", st.derived !== undefined ? String(st.derived) + " GB" : ""],
                               ["Modules", String((Ho.modules || []).length)]])
    ], note: "Household settings is Phase-0 only. Everything a module owns is configured in that module, not here." };
  });

  def("/households/tilcerovi/settings/members", function (ctx, H) {
    var Fx = G("HH_FIXTURES"), N = G("HH_NAV"), Ho = G("HH_HOUSEHOLD");
    if (!Fx) return null;
    return { sections: [H.section("Members", (Fx.members || []).map(function (m) {
      var g = tryv(function () { return N.grantsFor(m.id, ctx.household) || {}; }, {});
      var held = Object.keys(g).filter(function (k) { return g[k] && g[k] !== "none"; }).length;
      return H.row(m.id, m.name, (m.role || "") + " \u00b7 " + held + " of " + ((Ho && Ho.modules) || []).length + " modules" +
                   (m.client ? " \u00b7 " + m.client : ""), m.role === "owner" ? "owner" : "", "", true);
    }))], note: "The grant matrix is per member and per module. A member with none on a module has no trace of it anywhere." };
  });

  def("/households/tilcerovi/settings/modules", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    if (!(Ho.modules || []).length) return null;
    return { sections: [H.section("Modules", (Ho.modules || []).map(function (m) {
      return tuple(H, m);
    }))], note: "Turning a module off removes it from every member's app. It does not delete what is in it." };
  });

  def("/settings/notifications", function (ctx, H) {
    var N = G("HH_NOTIFY"); if (!N) return null;
    var by = {};
    (N.offers || []).forEach(function (o) { (by[o.section] = by[o.section] || []).push(o); });
    var secs = Object.keys(by).map(function (k) {
      return H.section(k, by[k].map(function (o) {
        return H.row(o.id, o.label, o.says || o.why || "", tryv(function () { return N.audienceLabel(o.audience); }, o.audience || ""));
      }));
    });
    secs.push(H.section("Rules the household has made", (N.rules || []).map(function (r) {
      return H.row(r.id, tryv(function () { return (N.offerOf(r.offer) || {}).label; }, r.offer),
                   "for " + tryv(function () { return N.audienceLabel(r.audience); }, r.audience) +
                   (r.coalesce ? " \u00b7 coalesced" : "") + " \u00b7 by " + r.by, r.on ? "on" : "off", r.on ? "" : "muted");
    })));
    return { sections: secs.filter(function (s) { return s.rows.length; }),
             note: "Household-meaningful events are picked, not composed. There is no predicate editor anywhere on this screen." };
  });

  def("/settings/notifications/log", function (ctx, H) {
    var N = G("HH_NOTIFY"); if (!N) return null;
    var rows = tryv(function () { return N.logRows() || N.log || []; }, N.log || []);
    if (!rows.length) return null;
    return { sections: [H.section("What was sent", rows.map(function (l) {
      return H.row(l.id, l.rule ? tryv(function () { return (N.ruleOf(l.rule) || {}).id || l.rule; }, l.rule)
                                : (l.note || l.reason || "System \u00b7 not from a household rule"),
                   ["to " + l.to, l.transport, when(H, l.at), l.ms ? l.ms + " ms" : ""].filter(Boolean).join(" \u00b7 "),
                   l.outcome,
                   l.outcome === "failed" ? "danger" : "");
    }))], note: "Bodies are kept for " + (N.bodyRetention || 7) + " days and then dropped. The fact of the send is kept." };
  });

  def("/households/tilcerovi/settings/storage", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    var st = Ho.storage; if (!st) return null;
    return { sections: [
      facts(H, "Against the allowance", [["Used", st.current + " GB of " + st.allowance + " GB"],
                                         ["Derived overhead", String(st.derived) + " GB"],
                                         ["Month to date average", String(st.mtdAverage) + " GB"],
                                         ["Projected", String(st.projectedAverage) + " GB"],
                                         ["Over the block", st.block ? "blocks at " + st.block + " GB" : ""]]),
      H.section("By module", (st.byModule || []).map(function (p) {
        return H.row(p[0], p[0], "", p[1] + " GB");
      })),
      H.section("By member", (st.byMember || []).map(function (p) {
        return H.row(p[0], p[0], "", p[1] + " GB");
      }))
    ], note: "Derived bytes are named as derived. Restrict sits next to export here, not next to billing." };
  });

  def("/households/tilcerovi/settings/data", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    if (!(Ho.destructive || []).length) return null;
    return { sections: [
      tuples(H, "The destructive actions", Ho.destructive, 8),
      facts(H, "Deletion", [["Household data removed", Ho.deletionDate ? "by " + Ho.deletionDate : ""],
                            ["Each action", "names the object it would destroy, in the confirm copy"]])
    ], note: "Destructive copy names the object. \u201cDelete\u201d alone is never the whole sentence." };
  });

  def("/households/tilcerovi/settings/advanced", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    if (!(Ho.devices || []).length) return null;
    return { sections: [
      H.section("Clients and versions", (Ho.devices || []).map(function (d) {
        return H.row("", d.name, d.meta || "", d.action || "", d.tone === "warning" ? "warning" : "");
      }))
    ], note: "A revoked client loses its replica. The screen says that in words before the button is pressed." };
  });

  def("/settings/modules/setup", function (ctx, H) {
    var N = G("HH_NOTIFY"); if (!N) return null;
    if (!(N.setup || []).length) return null;
    return { sections: [H.section("Set up again", (N.setup || []).map(function (s) {
      return H.row(s.module, s.label, [s.says, s.changed ? "changed since setup" : ""].filter(Boolean).join(" \u00b7 "),
                   s.state, s.state === "done" ? "muted" : "");
    }))], note: "Re-running a module's setup does not reset it: it reopens the questions and keeps the answers already given." };
  });

  def("/account/notifications", function (ctx, H) {
    var N = G("HH_NOTIFY"); if (!N) return null;
    var p = tryv(function () { return N.prefsOf(ctx.member); }, null); if (!p) return null;
    var rows = Array.isArray(p) ? p : Object.keys(p).map(function (k) { return [k, p[k]]; });
    return { sections: [
      H.section("How you are told", rows.map(function (r) { return tuple(H, r); })),
      H.section("Transports", (N.transports || []).map(function (t) {
        return H.row(t.id, t.label, t.says || "", t.quietHours ? "quiet hours apply" : "");
      })),
      H.section("Categories", (N.categories || []).map(function (c) {
        return H.row(c.id, c.label, c.says || "", (c.examples || []).slice(0, 2).join(" \u00b7 "));
      }))
    ], note: "Per-account, not per-household: this is the phone's preference, and it survives switching households." };
  });


  /* ── Stage 22b: the routes that fell through to a module body ──────────
     Twenty-four routes rendered a body identical to another route on the
     same module, and seven drew chrome over nothing. Each one below reads
     its own module file, so the surface differs where the screen differs. */

  function screenOf(mod, id) {
    var M = G(mod); if (!M) return null;
    var l = M.screens || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function msgRows(H, keys) {
    var A = G("HH_AUTH"); if (!A) return [];
    return (A.messages || []).filter(function (m) { return keys.indexOf(m[0]) >= 0; })
      .map(function (m) { return H.row(m[0], m[2], m[5] || "", m[3] ? "non-enumerating" : (m[4] || "")); });
  }
  function profileRows(H, s) {
    return ((s && s.profiles) || []).map(function (p) {
      return H.row("", p.name, p.meta || "", p.current ? "on this device now" : "", p.current ? "accent" : "");
    });
  }

  /* Account: the sign-in family ───────────────────────────────────────── */

  def("/sign-in", function (ctx, H) {
    if (!G("HH_AUTH")) return null;
    return { sections: [
      
      facts(H, "Why three situations get two sentences", [
        ["Wrong password, and no such account", "one sentence, and the same response time for both"],
        ["Deleted or suspended", "the same sentence again — not ours to report here"],
        ["Throttling", "attributed to the device, never to the account"],
        ["A device seen for the first time", "the second step is asked next"]
      ]),
      facts(H, "The other two ways in", [
        ["A child, or the shared tablet", "Join with a household code · /join"],
        ["A forgotten password", "/reset · the link lasts one hour"]
      ])
    ], note: "The household-code route is on this screen rather than behind a disclosure: the people who need it are the ones least able to find one." };
  });

  def("/verify", function (ctx, H) {
    if (!G("HH_AUTH")) return null;
    return { sections: [
      
      facts(H, "The link", [
        ["Lasts", "24 hours"],
        ["Resend", "on a cooldown, drawn as a countdown rather than a refusal"],
        ["Sent to", "jana@tilcerovi.cz"]
      ]),
      facts(H, "Reached from two places", [
        ["Register, with a new address", "the link verifies and signs in"],
        ["Register, with an address that already has an account", "the identical screen — which is what makes register non-enumerating"]
      ])
    ], note: "Drawn once, reached twice. The second path is the whole reason the first one can be honest." };
  });

  def("/reset", function (ctx, H) {
    if (!G("HH_AUTH")) return null;
    return { sections: [
      
      facts(H, "The reset link", [
        ["Works for", "one hour, once"],
        ["Shown", "whether or not the address has an account"],
        ["Confirmation", "a notice on this screen, not a route of its own"]
      ])
    ], note: "Keeping the form visible is the point: a mistyped address is corrected here rather than discovered in an inbox that never rang." };
  });

  def("/reset/set", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!G("HH_AUTH")) return null;
    return { sections: [
      
      H.section("What setting a password signs out", [
        H.row("", "Every session and refresh token", "including the device in your hand", ""),
        H.row("", "Each device replica", "a signed-out device discards its copy of the household", ""),
        H.row("", "Anything saved offline and not yet sent", "it goes with the replica — stated before the button, not in a toast after it", "")
      ]),
      H.section("Devices this touches", ((Ho && Ho.devices) || []).map(function (d) {
        return H.row("", d.name, d.meta || "", "");
      }))
    ], note: "The consequence is in the button. Somebody who reads nothing else still reads the thing they are about to press." };
  });

  /* Account: the second step ──────────────────────────────────────────── */

  def("/account/2fa", function (ctx, H) {
    if (!G("HH_AUTH")) return null;
    return { sections: [
      facts(H, "What is being added", [
        ["Method", "TOTP — a six-digit code from an authenticator app"],
        ["Codes change", "every 30 seconds"],
        ["The key", "offered as a square and as text, at the same level"],
        ["Before this finishes", "ten recovery codes are issued on the next screen"]
      ])
    ], note: "The typed key is not behind a “can’t scan?” link: somebody setting this up on their only phone cannot photograph the screen they are reading." };
  });

  def("/account/2fa/codes", function (ctx, H) {
    var s = screenOf("HH_AUTH", "A-6"); if (!s || !(s.codes || []).length) return null;
    return { sections: [
      H.section("The ten, as issued", s.codes.map(function (c, i) {
        return H.row("", c, "", String(i + 1));
      })),
      facts(H, "How they behave", [
        ["Each one", "works once"],
        ["A new set", "retires these ten the moment it is made"],
        ["Where they belong", "somewhere that is not this phone — Print is a real action here"],
        ["Finish before the box is ticked", "re-asks rather than sitting dead"]
      ])
    ], note: "The recommended place for these is a drawer, which is why the print stylesheet is a line of work and not an afterthought." };
  });

  def("/sign-in/2fa", function (ctx, H) {
    if (!G("HH_AUTH")) return null;
    return { sections: [
      facts(H, "Why you are seeing this", [
        ["This device", "has not signed in before"],
        ["If it signs in every day", "that is the thing worth noticing — the screen has already said what would be odd"],
        ["Trust this device", "opt-in, dated, 30 days — never the default"]
      ]),
      
      facts(H, "If the app is gone", [["Use a recovery code instead", "/sign-in/2fa/recovery · one of the ten"]])
    ], note: "Naming the device as new is the sentence doing the security work." };
  });

  def("/sign-in/2fa/recovery", function (ctx, H) {
    if (!G("HH_AUTH")) return null;
    return { sections: [
      facts(H, "The count, before the code is spent", [
        ["Issued", "ten, when the second step was turned on"],
        ["Left after this one", "eight"],
        ["At two", "we ask you to make a new set"],
        ["Every use", "is also an email to the account"]
      ])
    ], note: "The legitimate case and the stolen-notebook case look identical from here, so both get the email." };
  });

  def("/account/notice", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!G("HH_AUTH")) return null;
    return { sections: [
      facts(H, "The change this is about", [
        ["When", "8 September, 21:14"],
        ["Where", "Prague, Czechia"],
        ["Client", "Chrome on Windows"],
        ["Also sent as", "email — the session it warns about may be the one reading it"]
      ]),
      H.section("What “This wasn’t me” does, in one press", [
        H.row("", "A new password is set", "the current one stops working immediately", "1"),
        H.row("", "Every device is signed out", "each discards its replica, this one included", "2"),
        H.row("", "Exports are held for 24 hours", "so an open session cannot take the household with it", "3")
      ]),
      H.section("Devices it would sign out", ((Ho && Ho.devices) || []).map(function (d) {
        return H.row("", d.name, d.meta || "", "");
      }))
    ], note: "Calm is a design decision here. The honest case is a member changing their own password on a laptop, and red would make that an incident." };
  });

  /* Account: the child path and the shared tablet ─────────────────────── */

  def("/join", function (ctx, H) {
    var A = G("HH_AUTH"); if (!A) return null;
    return { sections: [
      H.section("Rules", (A.childRules || []).map(function (r) {
        return H.row("", r[0], r[1] || "", "");
      })),
      H.section("Never asked for", (A.childForbidden || []).map(function (w) {
        return H.row("", w, "", "absent");
      })),
      facts(H, "What it does ask for", [
        ["A household code", "six characters, capitals do not matter"],
        ["Then", "four digits, on the next screen but one"]
      ])
    ], note: "Anything asked for here is something an adult would have to supply, which turns setting up a phone into an appointment." };
  });

  def("/join/profile", function (ctx, H) {
    var s = screenOf("HH_AUTH", "A-15"); if (!s) return null;
    return { sections: [
      H.section("The household’s members, in the household’s order", profileRows(H, s)),
      facts(H, "One list, two methods", [
        ["A PIN profile", "the next screen is four digits"],
        ["A password profile", "the next screen is a password"],
        ["Not on the list", "sign in with an email address instead"]
      ])
    ], note: "The person tapping does not think of themselves as an authentication method, so the picker does not sort them into two." };
  });

  def("/join/pin", function (ctx, H) {
    var A = G("HH_AUTH"); if (!A) return null;
    return { sections: [
      facts(H, "The keypad", [
        ["Digits", "four"],
        ["Key size", "44 pt"],
        ["On the screen otherwise", "nothing"],
        ["Tries left after a wrong one", "two, then the profile takes a break"]
      ]),
      H.section("If it is forgotten", [
        H.row("", "Jana resets it from her phone, in two taps", "the screen names her rather than a support address", "a person"),
        H.row("", "No email is sent", "Adam has no address, and should not be asked for one", "by design")
      ])
    ], note: "The forgotten-PIN path is a person in the house, not a support flow." };
  });

  def("/join/pin/paused", function (ctx, H) {
    var A = G("HH_AUTH"); if (!A) return null;
    var r = (A.childRules || [])[2];
    return { sections: [
      facts(H, "What happened", [
        ["Wrong PINs", "five"],
        ["Paused until", "16:42 — a clock time, not a countdown to stare at"],
        ["Lost", "nothing"],
        ["Tone", "info · no red, no lock icon, no “failed attempts”"]
      ]),
      H.section("The two ways out", [
        H.row("", "Ask Jana to unlock it", "she can do it from her phone now", "a person"),
        H.row("", "Wait", "six minutes left", "the clock")
      ])
    ], note: "A child meets this screen alone, usually after a genuine mistake." };
  });

  def("/switch", function (ctx, H) {
    var s = screenOf("HH_AUTH", "A-17"); if (!s) return null;
    return { sections: [
      H.section("Profiles on the kitchen iPad", profileRows(H, s)),
      facts(H, "What switching changes, and what it does not", [
        ["The replica", "stored on the device once, not once per profile"],
        ["What changes", "which grants apply — not which data exists"],
        ["Speed", "instant; the screen clears immediately"],
        ["The destructive act", "signing the tablet out of the household, phrased as such"]
      ])
    ], note: "A shared device is a grants question, not a storage question." };
  });

  def("/locked", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho) return null;
    var susp = (Ho.ent || []).filter(function (e) { return e[0] === "suspended"; })[0];
    return { sections: [
      facts(H, "The state", [
        ["Household", "Tilcerovi"],
        ["Suspended on", "9 September"],
        ["Reason", "emailed to everybody in the household"],
        ["Deleted", "nothing"],
        ["About payment", "no — every billing state has its own screen, and this is not one of them"]
      ]),
      
      H.section("How it lifts", (Ho.lift || []).slice(0, 3).map(function (l) {
        return H.row("", l[2] || "", "returns to " + (l[1] || l[0]), l[0]);
      }))
    ], note: "The only screen in the product with no household content on it, and the absence is the requirement." };
  });

  /* Admin: the two invitation screens ─────────────────────────────────── */

  def("/household/invite", function (ctx, H) {
    if (!G("HH_AUTH")) return null;
    return { sections: [
      H.section("Blocked, here and only here", [
        H.row("", "Sending an invitation", "it carries your name to somebody else’s phone, so the address is confirmed first", "blocked")
      ]),
      
      facts(H, "How the refusal behaves", [
        ["Where it is explained", "on the screen that refuses, at the moment it refuses"],
        ["Global nag banner", "none"],
        ["The form behind it", "stays filled in"],
        ["The way out", "resend the verification link, from here"]
      ])
    ], note: "Unverified is a condition on the few actions that reach other people, not an account state the product nags about." };
  });

  def("/households/tilcerovi/invitations/new", function (ctx, H) {
    var Ho = G("HH_HOUSEHOLD"); if (!Ho || !(Ho.modules || []).length) return null;
    var levels = {};
    (Ho.levels || []).forEach(function (l) { levels[l[0]] = l[1]; });
    var counts = tryv(function () { return Ho.defaultCounts(2); }, null);
    return { sections: [
      H.section("Decisions", (Ho.modules || []).map(function (m) {
        return H.row(m[0], m[1], levels[m[2]] ? levels[m[2]] + " — " + (Ho.phrase && Ho.phrase[m[2]] ? Ho.phrase[m[2]] : "") : "",
                     levels[m[2]] || m[2], m[2] === "none" ? "muted" : "");
      })),
      facts(H, "The default for a Member, counted", counts ? [
        ["Off", counts.none], ["Can see", counts.view],
        ["Can add and edit", counts.contribute], ["Can set up", counts.manage]
      ] : []),
      facts(H, "Sending", [
        ["How it goes", "email to petr@…, or a link you send yourself"],
        ["Expires", "in 14 days"],
        ["Offline", "not sendable — what you set here is kept"],
        ["Read-only", "inviting is a write, so it waits for the subscription"]
      ])
    ], note: "A grant is never a queued local write: it reaches the client as derived capability state, so this matrix has no pending version of itself." };
  });

  /* Nav: the switcher and the neutral refusal ─────────────────────────── */

  def("/households", function (ctx, H) {
    var N = G("HH_NAV"); if (!N || !N.switcher) return null;
    return { sections: [
      H.section("What changes when you switch", (N.switcher.changes || []).map(function (c) {
        return H.row("", c[0], c[1] || "", "");
      })),
      H.section("The three rules", (N.switcher.rules || []).map(function (r) {
        return H.row("", r[0], r[1] || "", "");
      }))
    ], note: "All six change together, or none of them do. There is no state where the sidebar has switched and the banner has not." };
  });

  def("/unavailable", function (ctx, H) {
    var N = G("HH_NAV"); if (!N || !N.slug404) return null;
    var s = N.slug404;
    return { sections: [
      
      facts(H, "Where it is not used", [
        ["A note at a stale path", s.title],
        ["Why that one may explain itself", "the household is internal and the address is not a secret"],
        ["A document attachment", "content URLs are id-based and permanent, so a link never lands here"]
      ])
    ], note: s.note || "The one screen in the product whose emptiness is the requirement." };
  });

  /* Sync: inbox and resolver ──────────────────────────────────────────── */

  def("/sync", function (ctx, H) {
    var S = G("HH_SYNC"); if (!S) return null;
    return { sections: [
      H.section("Waiting for an answer", (S.inbox || []).map(function (c) {
        return H.row(c.id, c.title, c.where + " · " + c.mine.who + " " + c.mine.value + " · " +
                     c.theirs.who + " " + c.theirs.value, c.module);
      })),
      H.section("Refused, and held", (S.rejections || []).map(function (r) {
        return H.row(r.code, r.where, r.copy || "", r.ref || "");
      })),
      H.section("Rules", (S.inboxRules || []).map(function (r) {
        return H.row("", r[0], r[1] || "", "");
      }))
    ], note: "The inbox routes; it does not resolve. Which amount is right is only answerable beside what the amount is for." };
  });

  def("/sync/cf-1", function (ctx, H) {
    var S = G("HH_SYNC"); if (!S) return null;
    var c = (S.inbox || []).filter(function (x) { return x.id === "cf-1"; })[0]; if (!c) return null;
    var p = (S.policies || []).filter(function (x) { return x.id === "strict_version"; })[0];
    return { sections: [
      H.section("The two versions", [
        H.row("", c.mine.who, c.mine.at, c.mine.value),
        H.row("", c.theirs.who, c.theirs.at, c.theirs.value, "accent"),
        H.row("", "Where", c.where, c.module)
      ]),
      H.section("Choose one", [
        H.row("", "Keep " + c.theirs.value + " (" + c.theirs.who + ")", "", "primary"),
        H.row("", "Keep " + c.mine.value, "", ""),
        H.row("", c.third || "Enter a different amount", "", "")
      ]),
      facts(H, "Why this one interrupts", p ? [
        ["Policy", p.id], ["Category", p.category], ["What the member sees", p.sees],
        ["Entities on it", (p.entities || []).slice(0, 5).join(", ")]
      ] : [])
    ], note: "The one policy that interrupts, interrupting here rather than at reconnect — and on the member’s own schedule." };
  });

  /* Dashboard: home, the shell, the catalog, the set, the child pair ──── */

  function widgetRow(H, D, e) {
    var w = D.byKey ? D.byKey[e.key] : null;
    var sp = tryv(function () { return [D.span(e.size, 2), D.span(e.size, 4), D.span(e.size, 6)].join(" / "); }, "");
    return H.row(e.key, (w && w.title) || e.key, (w ? w.module + " · " : "") + e.size + " · spans " + sp,
                 w ? "" : "not shipped in this version", w ? "" : "muted");
  }

  def("/home", function (ctx, H) {
    var D = G("HH_DASHBOARD"); if (!D || !D.layouts) return null;
    var entries = D.layouts.jana || [];
    return { sections: [
      H.section("Stored entries", entries.map(function (e) { return widgetRow(H, D, e); })),
      facts(H, "How the widths are arrived at", [
        ["Input", "the ordered list and the column count, and nothing else"],
        ["Columns", "2 on a phone, 4 on a tablet, 6 on the web"],
        ["Row unit", (D.rhythm ? D.rhythm.unit + " px, " + D.rhythm.gap + " px gap" : "")],
        ["A key this version does not ship", "meals.planner — stored, resolved to nothing, and not drawn"]
      ])
    ], note: "The host owns no feature data. Everything here is somebody else’s module rendered through one shell." };
  });

  def("/home#c-9", function (ctx, H) {
    var D = G("HH_DASHBOARD"); if (!D || !D.spanTable) return null;
    return { sections: [
      H.section("Sizes", (D.sizes || []).map(function (s) {
        var sp = D.spanTable[s], rw = D.rowTable[s];
        return H.row(s, s, "spans " + sp["2"] + " / " + sp["4"] + " / " + sp["6"] + " columns", 
                     "rows " + rw["2"] + " / " + rw["4"] + " / " + rw["6"]);
      })),
      H.section("States", Object.keys(D.treatments || {}).map(function (k) {
        var t = D.treatments[k];
        return H.row(k, (t && t.title) || k, (t && t.body) || "", (t && t.tone) || "");
      })),
      facts(H, "The frame", [
        ["Parts", "header, optional module chip, body, optional action"],
        ["Row rhythm", D.rhythm ? D.rhythm.unit + " px — a floor, not a fixed height" : ""],
        ["At 200 % text", "the frame grows; two smalls still line up"],
        ["Refresh", "per widget — one failure does not take the dashboard"]
      ])
    ], note: "Every widget in the stage is this frame with a different body." };
  });

  def("/dashboard/catalog", function (ctx, H) {
    var D = G("HH_DASHBOARD"); if (!D) return null;
    var cat = tryv(function () { return D.catalogFor(ctx.member || "jana"); }, null);
    var entries = (cat && cat.entries) || [];
    if (!entries.length) return null;
    var mods = {};
    entries.forEach(function (e) {
      var m = (e.widget && e.widget.module) || "other";
      (mods[m] = mods[m] || []).push(e);
    });
    var secs = Object.keys(mods).map(function (m) {
      return H.section(m + " · " + mods[m].length, mods[m].map(function (e) {
        var w = e.widget || {};
        return H.row(e.key, w.title || e.key, w.says || "", w.size || "");
      }));
    });
    secs.push(facts(H, "What is not here", [
      ["A module held at none", "no greyed row, no count, no mention"],
      ["This member", (cat.member && cat.member.name) || ctx.member, ],
      ["Available to them", entries.length + " of 24"]
    ]));
    return { sections: secs, note: "It is never the same set twice: the catalog is the member’s grants, rendered." };
  });

  def("/dashboard/catalog#c-10", function (ctx, H) {
    var D = G("HH_DASHBOARD"); if (!D || !(D.widgets || []).length) return null;
    var mods = {};
    D.widgets.forEach(function (w) { (mods[w.module] = mods[w.module] || []).push(w); });
    var secs = Object.keys(mods).map(function (m) {
      return H.section(m, mods[m].map(function (w) {
        return H.row(w.key, w.title, w.src || "", w.size);
      }));
    });
    secs.push(facts(H, "Seven body shapes cover all twenty-four", [
      ["list", "rows with a chip and a mark"], ["count", "one number, and what it is of"],
      ["split", "two figures against each other"], ["bars", "a period compared with the last"],
      ["agenda", "the day, in order"], ["grid", "a month at a glance"],
      ["the module’s own", "where nothing generic would be honest"]
    ]));
    return { sections: secs, note: "The ones that carry a write are the ones the hold gesture has to work inside; the ones that carry a number must have a not-enough-information state." };
  });

  def("/home#c-6", function (ctx, H) {
    var D = G("HH_DASHBOARD"); if (!D || !D.layouts) return null;
    return { sections: [
      H.section("Four widgets, set by an owner", (D.layouts.child || []).map(function (e) { return widgetRow(H, D, e); })),
      facts(H, "What suggested means", [
        ["Adam may", "move them, resize them, add his own"],
        ["The arrange affordances", "ordinary — the same ones Jana has"],
        ["The layout row", "his own from the moment it is suggested"],
        ["Of the twenty he cannot see", "no trace"]
      ])
    ], note: "His screen has to read as his product rather than as an allowance." };
  });

  def("/home#c-7", function (ctx, H) {
    var D = G("HH_DASHBOARD"); if (!D || !D.layouts) return null;
    var s = screenOf("HH_DASHBOARD", "C-7");
    var imp = (s && s.impossible) || {};
    return { sections: [
      H.section("The same four widgets", (D.layouts.child || []).map(function (e) { return widgetRow(H, D, e); })),
      
      
      facts(H, "The setting behind it", [
        ["Default", "under the household’s configured age threshold"],
        ["Lifted", "at any time, by an owner"]
      ])
    ], note: "A locked screen that shows what you cannot touch is worse than one that simply does not offer it." };
  });

  /* Tasks: the card and its checklist ─────────────────────────────────── */

  def("/tasks/dum/cards/stk", function (ctx, H) {
    var T = G("HH_TASKS"); if (!T) return null;
    var c = (T.cards || []).filter(function (x) { return x.id === "stk"; })[0]; if (!c) return null;
    var cl = (T.checklists || []).filter(function (x) { return x.card === "stk"; })[0];
    var cm = (T.comments || []).filter(function (x) { return x.card === "stk"; });
    var board = tryv(function () { return T.board(c.board); }, null);
    var col = board && (board.columns || []).filter(function (x) { return x.id === c.col; })[0];
    return { sections: [
      facts(H, "The card", [
        ["Board", (board && board.name) || c.board],
        ["Column", (col && col.name) || c.col],
        ["Due", c.due ? H.day(c.due) + " — a reminder kind, tasks.card_due, with personal completion" : "none"],
        ["Assignee", c.assignee || "nobody"],
        ["Labels", (c.labels || []).map(function (l) { var o = tryv(function () { return T.labelOf(l); }, null); return (o && o.name) || l; }).join(", ")],
        ["Body", "Markdown, not rich text — which is why there is no half-merge to report"]
      ]),
      H.section("Checklist · " + (c.checklist || [0, 0]).join(" of "), ((cl && cl.items) || []).map(function (i) {
        return H.row("", i[0], "", i[1] ? "done" : "", i[1] ? "muted" : "");
      })),
      H.section("Comments", cm.map(function (m) {
        return H.row("", m.text, m.who + " · " + m.at, "");
      }))
    ], note: "tasks.card is lww_field: two members editing the title and the assignee both succeed." };
  });

  def("/tasks/dum/cards/stk#c-19", function (ctx, H) {
    var T = G("HH_TASKS"); if (!T) return null;
    var cl = (T.checklists || []).filter(function (x) { return x.card === "stk"; })[0];
    if (!cl) return null;
    var done = (cl.items || []).filter(function (i) { return i[1]; }).length;
    return { sections: [
      H.section("Ordered items, with a done flag", (cl.items || []).map(function (i, n) {
        return H.row(String(n + 1), i[0], "", i[1] ? "done" : "to do", i[1] ? "muted" : "");
      })),
      facts(H, "On the card face", [
        ["Progress", done + " of " + (cl.items || []).length + " — a fraction, never a percentage bar with no numbers"],
        ["A tick made offline", "a field on the item: two members ticking different items both succeed"],
        ["Ticking the same item twice", "the same result — lww_field"]
      ])
    ], note: "The smallest surface in the stage, and the one that most often carries the actual work." };
  });

  /* Assets: the schedule editor ───────────────────────────────────────── */

  def("/assets/vehicle/octavia/schedules", function (ctx, H) {
    var A = G("HH_ASSETS"); if (!A) return null;
    var list = tryv(function () { return A.schedulesOf("octavia") || []; }, []);
    if (!list.length) return null;
    var s = list[0];
    var d = tryv(function () { return A.due(s.id, A.today); }, null);
    var help = (A.help || []).filter(function (h) { return h.id === "assets.schedule.dual"; })[0];
    return { sections: [
      facts(H, "The interval", [
        ["Basis", s.basis === "both" ? "both — whichever comes first" : s.basis],
        ["By date", s.months ? "every " + s.months + " months" : "—"],
        ["By use", s.everyUnit ? "every " + A.num(s.everyUnit) + " " + s.unit : "—"],
        ["Last done", s.lastDone ? H.day(s.lastDone) + (s.lastValue ? " · " + A.num(s.lastValue) + " " + s.unit : "") : "—"]
      ]),
      facts(H, "Which one won, and why", d ? [
        ["By date", d.intervalDue ? H.day(d.intervalDue) : "—"],
        ["By use", d.usageDueOn ? H.day(d.usageDueOn) + " · estimated at " + A.num(d.usageDueAt) + " " + s.unit : "—"],
        ["Resolved", (d.resolved ? H.day(d.resolved) : "—") + " · " + (d.reason === "interval" ? "the date came first" : "the usage came first")],
        ["Rate used", d.perDay ? A.num(d.perDay, 1) + " " + s.unit + " a day, from the readings on this vehicle" : "no reading yet"],
        ["Left", d.left ? A.num(d.left) + " " + s.unit + " · " + d.inDays + " days" : ""]
      ] : []),
      
      H.section("Help, on this screen", help ? [H.row(help.id, help.title, help.body, help.surface)] : [])
    ], note: "The usage answer is an estimate and is drawn as one. Nothing here claims a date the household committed to." };
  });

  /* The print stylesheet ──────────────────────────────────────────────── */

  def("/screens/d-54", function (ctx, H) {
    var Ga = G("HH_GARDEN"); if (!Ga) return null;
    var rules = Ga.printRules || [];
    var audit = tryv(function () { return Ga.printAudit(); }, null);
    if (!rules.length && !audit) return null;
    return { sections: [
      H.section("The rules, and the decision in each", rules.map(function (r) {
        return Array.isArray(r) ? H.row("", r[0], r[1] || "", r[2] || "")
                                : H.row("", r.rule || r.what || words(r), r.why || r.says || "", r.value || "");
      })),
      facts(H, "Audited", audit ? [
        ["Rules", audit.rules], ["Accent tokens", audit.accentTokens],
        ["Colours declared", audit.colours], ["Non-grey", audit.nonGrey],
        ["Minimum type", audit.minPt + " pt"],
        ["Ink coverage on the month sheet", audit.coverage + " % of the printed area"]
      ] : []),
      facts(H, "What paper does not have", [
        ["A theme", "the dark theme is stated as not printed, rather than left to a media query nobody wrote"],
        ["A text scale", "print ignores it by design"],
        ["Anything tappable", "status marks are words"],
        ["The month sheet", "201,5 mm of 269 on A4"]
      ])
    ], note: "A print layer written as browser-default-plus-overrides is how you get a sheet nobody can read." };
  });

  window.HH_BODIES = {
    version: "0.1-stage-22",
    paths: function () { return Object.keys(B); },
    count: function () { return Object.keys(B).length; },
    has: function (p) { return !!B[p]; },
    define: def,
    build: function (path, ctx, H) {
      var fn = B[path];
      if (!fn || !H) return null;
      var out = null;
      try { out = fn(ctx || {}, H); } catch (e) { return null; }
      if (!out) return null;
      var SEP = /^[\s\u00b7\u2013\u2014,|-]+$/;
      function tidy(v) {
        if (v === null || v === undefined) return "";
        if (typeof v === "number") return String(v);
        if (typeof v !== "string") return "";
        var x = v.replace(/\s*\u00b7\s*\u00b7\s*/g, " \u00b7 ")
                 .replace(/^[\s\u00b7\u2013\u2014]+/, "")
                 .replace(/[\s\u00b7\u2013\u2014]+$/, "");
        return SEP.test(x) ? "" : x;
      }
      (out.sections || []).forEach(function (sec) {
        (sec.rows || []).forEach(function (r) {
          r.title = tidy(r.title); r.meta = tidy(r.meta); r.right = tidy(r.right);
          /* the right slot is a token, not a sentence: anything longer wraps
             under the title instead of collapsing it */
          if (r.right && r.right.length > 28) {
            r.meta = r.meta ? r.meta + " \u00b7 " + r.right : r.right;
            r.right = "";
          }
        });
      });
      out.sections = (out.sections || []).filter(function (s) { return s && s.rows && s.rows.length; });
      if (!out.sections.length) return null;
      out.count = out.sections.reduce(function (a, s) { return a + s.rows.length; }, 0);
      out.perScreen = true;
      return out;
    }
  };
})();
