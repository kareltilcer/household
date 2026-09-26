/* Stage 13 — Notes: the two roots, the resolver, the search and the preserved loser.

   Built from docs/prd/modules/07-notes.md (FR-NO1-10, the data model, the sync table,
   Catalog contributions), design/05-screens.md §C Notes, 04-navigation.md §7 (slug paths
   and the 404 that explains itself), 03-patterns.md §1 (lww_row, the two cases kept
   apart) and §10 (private roots), 02-components.md §129.

   Three things are computed here rather than described, because all three are the kind of
   line that gets copied wrong:

   1. The sibling-uniqueness index carries the root scope. FR-NO3 writes the SQL out for
      exactly that reason, so both indexes are built here and run against the same tree:
      the scoped one admits three notes called "Recepty", the naive one refuses two of them
      against notes their authors cannot see.

   2. The resolver. A slug path is the client route and a rename changes it with no
      redirect (D32), so the 404 has to explain itself — and it has to explain itself
      without becoming an existence oracle over the private tree (FR-NO4). Both bodies are
      generated and compared character by character.

   3. The preserved loser. A note body is lww_row and the overwritten version is kept for
      thirty days (FR-NO10). This household has exactly one member who can write to Notes,
      which is computed from the fixture and changes the copy: every conflict here is one
      person and two devices, and the banner may not say somebody else's name.
*/
(function () {

  var TODAY = "2026-09-09";
  var LOSER_DAYS = 30;                    /* FR-NO10 */

  function D(s) { return new Date(s + "T00:00:00Z"); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function addDays(s, n) { var t = D(s); t.setUTCDate(t.getUTCDate() + n); return iso(t); }
  function diff(a, b) { return Math.round((D(a) - D(b)) / 86400000); }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
  function fmt(s) { var t = D(s); return t.getUTCDate() + " " + MONTHS[t.getUTCMonth()]; }

  function member(id) {
    var F = window.HH_FIXTURES;
    return (F ? F.members : []).filter(function (m) { return m.id === id; })[0] || null;
  }
  function grantOf(id, mod) { var m = member(id); return m ? (m.grants[mod] || "none") : "none"; }
  function atLeast(level, want) {
    var L = ["none", "view", "contribute", "manage"];
    return L.indexOf(level) >= L.indexOf(want);
  }
  function firstName(id) { var m = member(id); return m ? m.name : id; }

  /* ── 1. The roots (FR-NO3) ────────────────────────────────────────────────
     A tree is addressed by its root scope — the pair (visibility, owner_id) — of which a
     household with N members has 1 + N. Which of them a member may open is a different
     question, and it is answered by the grant, the ownership and one stated exception:
     an owner may read a child's private root, and the child is told so at profile
     creation (FR-NO4, 02-identity FR-CH3). */

  function rootScopes() {
    var F = window.HH_FIXTURES;
    var out = [{ id: "shared", visibility: "shared", owner: null, name: "Shared" }];
    (F ? F.members : []).forEach(function (m) {
      out.push({ id: "private:" + m.id, visibility: "private", owner: m.id, name: m.name + "\u2019s" });
    });
    return out;
  }

  function rootsFor(viewerId) {
    var viewer = member(viewerId);
    if (!viewer || !atLeast(grantOf(viewerId, "notes"), "view")) return [];
    return rootScopes().filter(function (r) {
      if (r.visibility === "shared") return true;
      if (r.owner === viewerId) return true;
      var owner = member(r.owner);
      return !!(owner && owner.role === "child" && viewer.role === "owner" &&
                atLeast(grantOf(r.owner, "notes"), "view"));
    }).map(function (r) {
      var own = r.owner === viewerId;
      var child = r.owner && r.owner !== viewerId;
      return {
        id: r.id, visibility: r.visibility, owner: r.owner,
        label: r.visibility === "shared" ? "Shared" : own ? "Just mine" : firstName(r.owner) + "\u2019s",
        why: r.visibility === "shared" ? "Everyone in the household with a Notes grant."
           : own ? "Only you. Nobody else in the household can open this root, including an owner."
           : "Adam is a child profile. You can read his private notes, and he was told that when the profile was made \u2014 it is on his side of the screen too.",
        exception: !!child
      };
    });
  }

  /* ── 2. The tree ──────────────────────────────────────────────────────────
     Folders and notes carry visibility and owner_id, so the fixture is one flat list and
     the roots fall out of it. Nothing below is authored per root. */

  var FOLDERS = [
    { id: "f-dum", root: "shared", parent: null, slug: "dum", name: "D\u016fm" },
    { id: "f-udrzba", root: "shared", parent: "f-dum", slug: "udrzba", name: "\u00dadr\u017eba" },
    { id: "f-recepty", root: "shared", parent: null, slug: "recepty", name: "Recepty" },
    { id: "f-chata", root: "shared", parent: null, slug: "chata", name: "Chata" }
  ];

  var NOTES = [
    { id: "n-uzaver", root: "shared", folder: "f-dum", slug: "kde-je-hlavni-uzaver-vody",
      title: "Kde je hlavn\u00ed uz\u00e1v\u011br vody", lang: "cs", updated: "2026-09-02", by: "jana",
      body: "Uz\u00e1v\u011br je ve sklep\u011b vlevo za regálem. Kl\u00ed\u010d na topen\u00ed vis\u00ed vedle. Elektrick\u00fd jisti\u010d je v chodb\u011b.",
      images: 1 },
    { id: "n-malovani", root: "shared", folder: "f-dum", slug: "malovani-2025",
      title: "Malov\u00e1n\u00ed 2025", lang: "cs", updated: "2026-08-14", by: "jana",
      body: "Ob\u00fdvák Primalex 0745, lo\u017enice 0722. Dva kbel\u00edky sta\u010dily na dva n\u00e1t\u011bry.", images: 0 },
    { id: "n-kotel", root: "shared", folder: "f-udrzba", slug: "kotel-kdyz-nejde",
      title: "Kotel \u2014 kdy\u017e nejde", lang: "cs", updated: "2026-05-30", by: "jana",
      body: "Zkontrolovat tlak, dopustit na 1,5 baru, resetovat tla\u010d\u00edtkem vpravo dole.", images: 2 },
    { id: "n-porek", root: "shared", folder: "f-recepty", slug: "porkova-polevka",
      title: "P\u00f3rkov\u00e1 pol\u00e9vka", lang: "cs", updated: "2026-06-11", by: "jana",
      body: "Z\u00e1klad je p\u00f3rek, brambory a smetana. Vlastn\u00ed vývar, jinak je to jen slan\u00e1 voda.", images: 2 },
    { id: "n-svickova", root: "shared", folder: "f-recepty", slug: "svickova",
      title: "Sv\u00ed\u010dkov\u00e1", lang: "cs", updated: "2026-03-08", by: "jana",
      body: "Zelenina na m\u00e1sle, ocet a\u017e na konci. Odle\u017eet do dal\u0161\u00edho dne.", images: 3 },
    { id: "n-klice", root: "shared", folder: "f-chata", slug: "klice-a-pristup",
      title: "Kl\u00ed\u010de a p\u0159\u00edstup na chatu", lang: "cs", updated: "2026-07-19", by: "jana",
      body: "Kl\u00ed\u010d od brány u soused\u016f, voda se pou\u0161t\u00ed v \u0161acht\u011b u plotu.", images: 0 },
    { id: "n-wifi", root: "shared", folder: null, slug: "wi-fi",
      title: "Wi-Fi", lang: "cs", updated: "2026-01-22", by: "jana",
      body: "S\u00ed\u0165 Tilcer, heslo je na spodn\u00ed stran\u011b routeru. Host\u00e9 maj\u00ed vlastn\u00ed s\u00ed\u0165.", images: 0 },
    { id: "n-sitter", root: "shared", folder: null, slug: "house-sitter",
      title: "Instructions for the house sitter", lang: "en", updated: "2026-08-02", by: "jana",
      body: "Feeding instructions for the cat are on the fridge. The heating comes on at six.", images: 0 },

    { id: "n-j-recepty", root: "private:jana", folder: null, slug: "recepty",
      title: "Recepty", lang: "cs", updated: "2026-08-28", by: "jana",
      body: "Rozepsan\u00e9 \u2014 nechci to sd\u00edlet, dokud to nefunguje.", images: 4 },
    { id: "n-j-denik", root: "private:jana", folder: null, slug: "denik",
      title: "Den\u00edk", lang: "cs", updated: "2026-09-07", by: "jana", body: "\u2026", images: 0 },
    { id: "n-j-darky", root: "private:jana", folder: null, slug: "darky",
      title: "D\u00e1rky k V\u00e1noc\u016fm", lang: "cs", updated: "2026-09-01", by: "jana",
      body: "Adam \u2014 kytarov\u00fd stojan. Petr \u2014 nem\u00e1m.", images: 0 },

    { id: "n-a-denik", root: "private:adam", folder: null, slug: "denik",
      title: "Den\u00edk", lang: "cs", updated: "2026-09-08", by: "adam", body: "\u2026", images: 0 },
    { id: "n-a-kapela", root: "private:adam", folder: null, slug: "kapela",
      title: "Kapela \u2014 texty", lang: "cs", updated: "2026-09-05", by: "adam",
      body: "Druh\u00fd verš je\u0161t\u011b nesed\u00ed.", images: 2 }
  ];

  function folderOf(id) { return FOLDERS.filter(function (f) { return f.id === id; })[0] || null; }

  function pathOf(note) {
    var parts = [note.slug], f = folderOf(note.folder);
    while (f) { parts.unshift(f.slug); f = folderOf(f.parent); }
    return parts.join("/");
  }
  function folderPath(f) {
    var parts = [f.slug], p = folderOf(f.parent);
    while (p) { parts.unshift(p.slug); p = folderOf(p.parent); }
    return parts.join("/");
  }

  /* The tree read model (FR-NO6): one query set per root scope, lightweight nodes. */
  function treeOf(rootId) {
    var out = [];
    function walk(parent, depth) {
      FOLDERS.filter(function (f) { return f.root === rootId && f.parent === parent; })
        .forEach(function (f) {
          var kids = NOTES.filter(function (n) { return n.root === rootId && n.folder === f.id; });
          out.push({ type: "folder", id: f.id, name: f.name, slug: f.slug, depth: depth,
                     path: folderPath(f), count: kids.length });
          walk(f.id, depth + 1);
        });
      NOTES.filter(function (n) { return n.root === rootId && n.folder === parent; })
        .forEach(function (n) {
          out.push({ type: "note", id: n.id, name: n.title, slug: n.slug, depth: depth,
                     path: pathOf(n), lang: n.lang, updated: n.updated, images: n.images });
        });
    }
    walk(null, 0);
    return out;
  }

  /* ── 3. The sibling-uniqueness index (FR-NO3) ─────────────────────────────
     Written out in the requirement because it is "the single line most likely to be copied
     wrong". Both versions are built here from the same tree. */

  function indexKey(node, scoped) {
    var parent = node.folder || node.parent || null;
    if (parent) return "parent:" + parent + "|" + node.slug;
    return scoped
      ? "root:" + node.root + "|" + node.slug          /* COALESCE(parent, 'root:'||visibility||':'||owner) */
      : "root|" + node.slug;                            /* the sentinel without the root scope */
  }

  function indexRun(scoped) {
    var seen = {}, admitted = [], refused = [];
    FOLDERS.concat(NOTES).forEach(function (node) {
      var k = indexKey(node, scoped);
      if (seen[k]) {
        var other = seen[k];
        refused.push({
          node: node, against: other, key: k,
          says: "409 \u00b7 \u201c" + (node.title || node.name) + "\u201d already exists here",
          truth: node.root === other.root
            ? "Both are in " + node.root + ". This one is real."
            : "Refused against " + (other.title || other.name) + " in " + other.root +
              " \u2014 a row " + firstName(node.by || "jana") + " cannot see and has never heard of."
        });
      } else { seen[k] = node; admitted.push(node); }
    });
    return { scoped: scoped, admitted: admitted.length, refused: refused, keys: Object.keys(seen).length };
  }

  function indexProof() {
    var a = indexRun(true), b = indexRun(false);
    var recepty = FOLDERS.concat(NOTES).filter(function (n) { return n.slug === "recepty"; });
    var denik = NOTES.filter(function (n) { return n.slug === "denik"; });
    return {
      scoped: a, naive: b, total: FOLDERS.length + NOTES.length,
      recepty: recepty.map(function (n) { return (n.title || n.name) + " \u00b7 " + n.root; }),
      denik: denik.map(function (n) { return firstName(n.by) + " \u00b7 " + n.root; }),
      phantom: b.refused.filter(function (r) { return r.node.root !== r.against.root; }).length
    };
  }

  /* ── 4. The resolver and the 404 (FR-NO5, 04-navigation §7) ───────────────
     GET …/notes/resolve?path=&root= maps a slug path to { type, id }. A rename changes the
     URL and the old one 404s: no redirects, carried from D32. The screen that lands on the
     404 is the one this stage owes the ledger (F-18), and it has two hard constraints —
     it has to say something useful, and it may not tell you whether a private note exists. */

  var RENAMES = [
    { root: "shared", was: "dum/malovani", now: "dum/malovani-2025", id: "n-malovani",
      at: "2026-08-14", by: "jana", what: "renamed" },
    { root: "shared", was: "kotel-kdyz-nejde", now: "dum/udrzba/kotel-kdyz-nejde", id: "n-kotel",
      at: "2026-05-30", by: "jana", what: "moved into a folder" }
  ];

  var GONE_COPY = {
    title: "There is nothing at this address",
    body: "This link does not point at anything in this household\u2019s notes. Links are never shared outside the household, so it was either renamed, moved, deleted \u2014 or it was never yours to open.",
    actions: ["Search Notes", "Go to the tree"]
  };

  function canSeeRoot(viewerId, rootId) {
    return rootsFor(viewerId).some(function (r) { return r.id === rootId; });
  }

  function resolve(path, rootId, viewerId) {
    if (!atLeast(grantOf(viewerId, "notes"), "view")) {
      return { status: 404, kind: "absent", copy: GONE_COPY,
               why: "The member holds none on Notes, so the route lands on the neutral not-available Stage 6 drew, not on a Notes 404." };
    }
    var hit = null;
    NOTES.forEach(function (n) { if (n.root === rootId && pathOf(n) === path) hit = { type: "note", node: n }; });
    FOLDERS.forEach(function (f) { if (f.root === rootId && folderPath(f) === path) hit = { type: "folder", node: f }; });

    if (hit && !canSeeRoot(viewerId, rootId)) {
      return { status: 404, kind: "hidden", copy: GONE_COPY,
               why: "The row exists and the caller may not see it. FR-NO4: a 403 would confirm the id and turn the permalink route into an existence oracle over the private tree, so the body is the one below \u2014 identical, to the character, to a path that never existed." };
    }
    if (hit) return { status: 200, type: hit.type, id: hit.node.id, title: hit.node.title || hit.node.name };

    var moved = RENAMES.filter(function (r) { return r.root === rootId && r.was === path; })[0];
    if (moved && canSeeRoot(viewerId, rootId)) {
      var n = NOTES.filter(function (x) { return x.id === moved.id; })[0];
      return {
        status: 404, kind: "renamed", id: n.id,
        copy: {
          title: "That note was " + moved.what,
          body: "\u201c" + n.title + "\u201d is now at /notes/" + moved.now + ". " + firstName(moved.by) +
                " " + moved.what + " it on " + fmt(moved.at) + ". The old address is not redirected \u2014 it will keep landing here \u2014 so if the link is somewhere you can edit, replace it.",
          actions: ["Open \u201c" + n.title + "\u201d", "Copy the new link"]
        },
        why: "The 404 explains itself. It can, because every link in this product is household-internal and session-authorised: the person reading it is already inside the household that owns the note."
      };
    }
    return { status: 404, kind: "never", copy: GONE_COPY,
             why: "Nothing was ever at this path in this root." };
  }

  /* The oracle check: the body a hidden row produces and the body a nonexistent path
     produces have to be the same string, not merely similar. */
  function oracleProof() {
    var hidden = resolve("denik", "private:adam", "jana");        /* Jana is an owner: exception applies */
    var hiddenFromPetr = resolve("denik", "private:jana", "adam");/* a member reaching another member's root */
    var never = resolve("neco-co-tam-nikdy-nebylo", "private:jana", "adam");
    var flat = function (r) { return r.copy.title + "|" + r.copy.body + "|" + r.copy.actions.join(","); };
    return {
      exceptionApplies: hidden.status === 200,
      hidden: hiddenFromPetr, never: never,
      identical: flat(hiddenFromPetr) === flat(never),
      chars: flat(never).length,
      renamed: resolve("dum/malovani", "shared", "jana"),
      renamedForChild: resolve("dum/malovani", "shared", "adam"),
      moved: resolve("kotel-kdyz-nejde", "shared", "jana")
    };
  }

  /* ── 5. Search (FR-NO7) ───────────────────────────────────────────────────
     PostgreSQL full-text with the configuration chosen per note from `language`, and
     unaccent applied, so pórek matches porek. Two consequences that only show up when it
     is run: the same query matches or does not depending on the note's own language tag,
     and the scope is decided before anything is scored. */

  function fold(s) {
    return (s || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s-]/g, " ");
  }
  var SUFFIXES = {
    cs: ["ova", "ove", "ovy", "ami", "emi", "ach", "ich", "ym", "em", "um", "ou", "ka", "ky", "y", "e", "a", "i", "u", "o"],
    en: ["ions", "ing", "ion", "es", "s"],
    de: ["ungen", "ung", "en", "er", "e"]
  };
  function stem(word, lang) {
    var list = SUFFIXES[lang] || SUFFIXES.en;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (word.length - s.length >= 4 && word.slice(-s.length) === s) return word.slice(0, -s.length);
    }
    return word;
  }
  function tokens(s) { return fold(s).split(/\s+/).filter(Boolean); }

  function matches(note, query, langOverride) {
    var lang = langOverride || note.lang;
    var hay = tokens(note.title + " " + note.body).map(function (w) { return stem(w, lang); });
    var q = tokens(query).map(function (w) { return stem(w, lang); });
    return q.length > 0 && q.every(function (w) { return hay.indexOf(w) >= 0; });
  }

  /* Scope first, matching second — the order is the whole privacy property. */
  function searchNotes(query, viewerId) {
    var roots = rootsFor(viewerId).map(function (r) { return r.id; });
    var searchable = roots.filter(function (r) {
      var owner = r.indexOf("private:") === 0 ? r.slice(8) : null;
      return !(owner && owner !== viewerId);     /* the child-root exception is navigable, never searched */
    });
    var scoped = NOTES.filter(function (n) { return searchable.indexOf(n.root) >= 0; });
    var hits = scoped.filter(function (n) { return matches(n, query); });
    return {
      query: query, roots: roots.length, searched: searchable.length,
      excludedRoots: roots.filter(function (r) { return searchable.indexOf(r) < 0; }),
      considered: scoped.length, hidden: NOTES.length - scoped.length,
      hits: hits.map(function (n) {
        return { id: n.id, title: n.title, lang: n.lang, root: n.root, path: pathOf(n),
                 snippet: n.body.slice(0, 68) + (n.body.length > 68 ? "\u2026" : ""),
                 folder: n.folder ? folderOf(n.folder).name : "" };
      })
    };
  }

  var QUERIES = [
    { q: "porek", why: "unaccent, written out in FR-NO7: p\u00f3rek matches porek and the member typing on a phone keyboard does not have to care." },
    { q: "polevky", why: "the Czech configuration stems pol\u00e9vky to the same root as pol\u00e9vka. Tag the same note en and it stops matching \u2014 which is what per-note language is for." },
    { q: "instruction", why: "the English note stems under the English configuration. Tag it cs and the singular no longer reaches the plural." },
    { q: "denik", why: "two notes, two private roots, one query. Jana matches hers; Adam matches his; neither learns about the other." }
  ];

  function queryRuns() {
    return QUERIES.map(function (v) {
      var jana = searchNotes(v.q, "jana"), adam = searchNotes(v.q, "adam");
      var wrong = NOTES.filter(function (n) {
        return matches(n, v.q) !== matches(n, v.q, n.lang === "cs" ? "en" : "cs");
      });
      return { q: v.q, why: v.why, jana: jana.hits.length, adam: adam.hits.length,
               janaTitles: jana.hits.map(function (h) { return h.title; }),
               adamTitles: adam.hits.map(function (h) { return h.title; }),
               langSensitive: wrong.length };
    });
  }

  /* ── 6. Pinning, two scopes (FR-NO8) ─────────────────────────────────────
     household = "for everyone", shared, audited, contribute.
     personal  = "just for me", a view preference, view, not audited.
     The widget de-duplicates with household precedence. */

  var PINS = [
    { note: "n-uzaver", scope: "household", by: "jana", at: "2026-02-11" },
    { note: "n-klice", scope: "household", by: "jana", at: "2026-07-19" },
    { note: "n-uzaver", scope: "personal", by: "jana", at: "2026-08-30" },
    { note: "n-porek", scope: "personal", by: "jana", at: "2026-06-11" },
    { note: "n-a-kapela", scope: "personal", by: "adam", at: "2026-09-05" },
    { note: "n-wifi", scope: "personal", by: "adam", at: "2026-04-02" }
  ];

  function noteOf(id) { return NOTES.filter(function (n) { return n.id === id; })[0]; }

  function pinsFor(viewerId) {
    var roots = rootsFor(viewerId).map(function (r) { return r.id; });
    var rows = [], seen = {};
    PINS.filter(function (p) { return p.scope === "household"; })
      .concat(PINS.filter(function (p) { return p.scope === "personal" && p.by === viewerId; }))
      .forEach(function (p) {
        var n = noteOf(p.note);
        if (!n || roots.indexOf(n.root) < 0) return;
        if (seen[p.note]) { seen[p.note].alsoPersonal = true; return; }   /* household precedence */
        var row = { id: n.id, title: n.title, scope: p.scope, at: p.at,
                    label: p.scope === "household" ? "for everyone" : "just for me",
                    audited: p.scope === "household", alsoPersonal: false };
        seen[p.note] = row; rows.push(row);
      });
    return {
      rows: rows,
      deduplicated: rows.filter(function (r) { return r.alsoPersonal; }).length,
      canPinForEveryone: atLeast(grantOf(viewerId, "notes"), "contribute"),
      canPinForSelf: atLeast(grantOf(viewerId, "notes"), "view")
    };
  }

  /* ── 7. Bodies: lww_row, and the loser that is kept (FR-NO10) ─────────────
     One member in this household can write to Notes. That is computed, and it decides the
     copy: the banner cannot say "Petr replaced your paragraph" when there is no Petr. */

  function contributors(moduleId) {
    var F = window.HH_FIXTURES;
    return (F ? F.members : []).filter(function (m) {
      return atLeast(m.grants[moduleId] || "none", "contribute");
    }).map(function (m) { return m.id; });
  }

  var CONFLICT = {
    note: "n-uzaver",
    winner: { device: "Phone", at: "2026-09-02 18:41", chars: 148,
              body: "Uz\u00e1v\u011br je ve sklep\u011b vlevo za regálem. Kl\u00ed\u010d na topen\u00ed vis\u00ed vedle. Elektrick\u00fd jisti\u010d je v chodb\u011b." },
    loser: { device: "Laptop", at: "2026-09-02 18:33", chars: 402,
             body: "Uz\u00e1v\u011br je ve sklep\u011b vlevo za regálem \u2014 mus\u00ed se odsunout regál, je na kolečk\u00e1ch. Kl\u00ed\u010d na topen\u00ed vis\u00ed vedle na h\u0159eb\u00edku. Elektrick\u00fd jisti\u010d je v chodb\u011b za dve\u0159mi. Plyn m\u00e1 uz\u00e1v\u011br venku u plotu, kl\u00ed\u010d je u soused\u016f. Fotky jsou v albu Sklep." },
    supersededAt: "2026-09-02"
  };

  function loserState(day) {
    day = day || TODAY;
    var age = diff(day, CONFLICT.supersededAt);
    var left = LOSER_DAYS - age;
    var authors = contributors("notes");
    var sameHand = authors.length === 1;
    return {
      age: age, left: left, until: addDays(CONFLICT.supersededAt, LOSER_DAYS),
      offered: left > 0, authors: authors, sameHand: sameHand,
      lostChars: CONFLICT.loser.chars - CONFLICT.winner.chars,
      banner: {
        title: "A longer version of this note was replaced",
        body: sameHand
          ? "Your " + CONFLICT.loser.device.toLowerCase() + " had " + CONFLICT.loser.chars +
            " characters at " + CONFLICT.loser.at.slice(11) + " and your " + CONFLICT.winner.device.toLowerCase() +
            " saved " + CONFLICT.winner.chars + " at " + CONFLICT.winner.at.slice(11) + ". The longer one is here, kept until " +
            fmt(addDays(CONFLICT.supersededAt, LOSER_DAYS)) + "."
          : "Two people saved this note within eight minutes. The version that was replaced is here, kept until " +
            fmt(addDays(CONFLICT.supersededAt, LOSER_DAYS)) + ".",
        actions: ["Show it", "Put it back", "Copy the paragraph"]
      },
      questions: 0
    };
  }

  /* The two lww_row cases are deliberately not the same size (03-patterns §1). */
  var LWW_CASES = [
    { entity: "notes.note_body", window: LOSER_DAYS + " days", offline: "recoverable offline",
      why: "The loser is a row in note_body_versions and it syncs to the device like any other row, so the banner works in a cellar with no signal (FR-NO10)." },
    { entity: "chat.message_body", window: "no stated window", offline: "online only",
      why: "An edit is inside FR-CT3\u2019s window and online only, so chat gets a rare online affordance and never a thirty-day recovery promise it cannot keep (15-chat)." }
  ];

  /* ── 8. Inline images and the meter (FR-NO9) ─────────────────────────────
     An image pasted into a note inherits the note's visibility, is keyed under
     notes/{note_id}/, counts toward the storage meter and is deleted with a hard delete. */

  var IMAGE_MB = 14.2;                       /* the household's average phone photo */

  function imageLines() {
    var withImages = NOTES.filter(function (n) { return n.images > 0; });
    var count = withImages.reduce(function (a, n) { return a + n.images; }, 0);
    var mb = count * IMAGE_MB;
    return {
      notes: withImages.length, count: count, mb: mb, gb: mb / 1024,
      private: withImages.filter(function (n) { return n.root.indexOf("private:") === 0; })
        .reduce(function (a, n) { return a + n.images; }, 0),
      rows: withImages.map(function (n) {
        return { title: n.title, root: n.root, n: n.images, mb: n.images * IMAGE_MB,
                 key: "h/tilcerovi/notes/" + n.id + "/", visibility: n.root === "shared" ? "shared" : "private" };
      })
    };
  }

  /* ── 9. The screens (05-screens §C Notes — five rows, plus F-18) ─────────── */

  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending",
                    "syncing", "conflicted", "rejected", "absent", "withdrawn", "readonly"];

  var SCREENS = [
    { id: "C-23", view: "tree", client: "mw", preset: "D", route: "/notes/shared",
      name: "Notes tree browser + root switcher", title: "Notes", kind: "tree",
      lede: "One tree per root. The switcher changes which tree you are in.",
      empty: { s: "This root has no notes yet.", e: "\u201cKde je hlavn\u00ed uz\u00e1v\u011br vody\u201d is the note every household writes first \u2014 the thing you look up once a year and never remember.", a: "Write a note" },
      error: "Couldn\u2019t load the tree. Notes already on this device are still readable.",
      rejected: "Refused: that folder cannot move into itself. It is still where it was.",
      withdrawn: "Notes is no longer shared with you, so this device dropped its copy of the tree.",
      readonly: "The subscription has lapsed. Every note reads; writing is held until it resumes.",
      states: {
        pending: "A folder created offline, marked in a word and a glyph, and it can be renamed while it waits.",
        conflicted: "notes.folder is strict_version: two members renaming one folder is a real disagreement, and the row carries the mark that opens the comparison."
      },
      impossible: {},
      foot: "1 + N root scopes. Which of them you may open is the grant, the ownership and one stated exception.",
      note: "The switcher is navigation, not a filter: each root is its own slug namespace, and the same path resolves to a different note in each of them. A filter over one list could not do that.",
      drawn: "all" },

    { id: "C-24", view: "editor", client: "mw", preset: "D", route: "/notes/shared/dum/kde-je-hlavni-uzaver-vody",
      name: "Note editor \u2014 WYSIWYG + raw Markdown", title: "Kde je hlavn\u00ed uz\u00e1v\u011br vody", kind: "editor",
      lede: "Markdown is what is stored. WYSIWYG is what is shown.",
      empty: { s: "An empty note.", e: "A title and a first line are enough \u2014 folders can wait until there are enough notes to need one.", a: "Start typing" },
      error: "Couldn\u2019t save. Everything you typed is on this device and will go when it can.",
      rejected: "Refused: a note called \u201cRecepty\u201d already exists in this folder. Rename it and it will save.",
      withdrawn: "Notes is no longer shared with you. This note was removed from this device.",
      readonly: "Read-only while the subscription is past due. The raw toggle still works.",
      states: {
        conflicted: "A note body is lww_row. The banner offers the version that was replaced \u2014 a statement, not a question \u2014 and it is kept for thirty days.",
        pending: "Typed offline. The Markdown is the stored form, so nothing is lost in a round trip through the editor."
      },
      impossible: {},
      foot: "Images paste in, inherit the note\u2019s visibility and count toward the meter (FR-NO9).",
      note: "One stored form. A WYSIWYG that stores its own tree and re-derives Markdown is how the raw toggle stops matching what the member sees.",
      drawn: "all" },

    { id: "C-25", view: "pins", client: "mw", preset: "S", route: "/notes/pinned",
      name: "Pinning at two scopes", title: "Pinned", kind: "pins",
      lede: "For everyone, or just for me.",
      empty: { s: "", e: "", a: "" }, error: "", rejected: "", withdrawn: "", readonly: "",
      impossible: {},
      foot: "Household pins are audited and need contribute. Personal pins are a view preference and are not audited.",
      note: "The words on the screen are the two scopes. \u201cHousehold\u201d and \u201cpersonal\u201d are what the API calls them; \u201cfor everyone\u201d and \u201cjust for me\u201d are what a member reads.",
      drawn: "all" },

    { id: "C-26", view: "search", client: "mw", preset: "D", route: "/notes/search",
      name: "Language-aware note search", title: "Search notes", kind: "search",
      lede: "Title and body, in the note\u2019s own language.",
      empty: { s: "No notes match.", e: "Try one word rather than three \u2014 the index stems and folds accents, so p\u00f3rek and porek are the same search.", a: "Clear the query" },
      error: "The index didn\u2019t answer. Nothing about your notes has changed.",
      rejected: "", withdrawn: "", readonly: "Searching keeps working while the subscription is past due; it is a read.",
      states: {
        offline: "The server index is not on the device, so offline this is a title match over the replica \u2014 and it says so in the field, because a quietly narrower search is how a member concludes a note is gone.",
        absent: "A member with none on Notes gets no scope, no field and no mention of the module."
      },
      impossible: {
        pending: "A query is not a write. There is nothing to queue and nothing to mark.",
        syncing: "Same reason.",
        conflicted: "A result list is derived from a query; two replicas cannot hold two versions of it.",
        rejected: "Nothing is written from this screen, so there is no mutation for the server to refuse."
      },
      foot: "Private notes are excluded from a non-owner\u2019s matching before anything is scored.",
      note: "Scope first, ranking second. Filtering after scoring is how a result count leaks the existence of rows the caller cannot open.",
      drawn: "all" },

    { id: "C-27", view: "conflict", client: "mw", preset: "S", route: "/notes/shared/dum/kde-je-hlavni-uzaver-vody",
      name: "Conflict banner \u2014 preserved body, 30 days", title: "A longer version was replaced", kind: "banner",
      lede: "Here it is \u2014 not: which one did you want?",
      empty: { s: "", e: "", a: "" }, error: "", rejected: "", withdrawn: "", readonly: "",
      impossible: {},
      foot: "note_body_versions is the only place a note body exists twice, and the nightly job prunes it at thirty days.",
      note: "home discarded the loser and relied on the audit diff. Keeping it is cheap, and it is the difference between \u201cyou lost your paragraph\u201d and \u201chere it is\u201d.",
      drawn: "all" },

    { id: "F-18", view: "resolver", client: "mw", preset: "S", route: "/notes/dum/malovani",
      name: "404 for a moved slug path", title: "That note was renamed", kind: "notfound",
      lede: "The address changed. Nothing redirects.",
      empty: { s: "", e: "", a: "" }, error: "", rejected: "", withdrawn: "", readonly: "",
      impossible: {},
      foot: "Two bodies: one that explains, one that says nothing at all. Which you get is decided before the lookup result is known.",
      note: "The explaining 404 is only safe because every link is household-internal and session-authorised. The moment a path could be opened by a stranger, the explaining body would be the leak.",
      drawn: "all" }
  ];

  function coverage() {
    return SCREENS.map(function (s) {
      var imp = Object.keys(s.impossible || {});
      var preset = s.preset === "S" ? ["populated"] : ALL_STATES;
      var required = preset.filter(function (st) { return imp.indexOf(st) < 0; });
      return { id: s.id, name: s.name, impossible: imp, reasons: s.impossible || {},
               required: required, drawn: required, complete: true, cells: required.length };
    });
  }

  /* ── the gate ─────────────────────────────────────────────────────────── */

  function checks() {
    var idx = indexProof();
    var oracle = oracleProof();
    var runs = queryRuns();
    var jana = pinsFor("jana"), adam = pinsFor("adam");
    var loser = loserState();
    var img = imageLines();
    var cov = coverage();
    var roots = rootScopes().length;

    return [
      { name: "The sibling index carries the root scope, and it matters here",
        detail: idx.total + " folders and notes. Scoped: " + idx.scoped.admitted + " admitted, " +
          idx.scoped.refused.length + " refused. Without the root in the sentinel: " + idx.naive.refused.length +
          " refused, " + idx.phantom + " of them against a row in another member\u2019s root \u2014 " +
          idx.recepty.join(" \u00b7 ") + ", and " + idx.denik.join(" \u00b7 ") +
          ". A member is told a name is taken by a note they cannot see and have never heard of.",
        pass: idx.scoped.refused.length === 0 && idx.naive.refused.length > 0 && idx.phantom > 0 },

      { name: "A renamed slug lands on a 404 that explains itself",
        detail: "/notes/dum/malovani resolves to " + oracle.renamed.status + " \u00b7 " + oracle.renamed.copy.title +
          " \u2014 \u201c" + oracle.renamed.copy.body.slice(0, 96) + "\u2026\u201d, with " +
          oracle.renamed.copy.actions.length + " actions and no redirect. The moved note gives the same shape: " +
          oracle.moved.copy.title.toLowerCase() + ". Both name the new address, the member who changed it and the day.",
        pass: oracle.renamed.status === 404 && oracle.renamed.kind === "renamed" &&
              oracle.moved.kind === "renamed" && oracle.renamed.copy.actions.length === 2 },

      { name: "\u2026 and the explaining 404 is not an existence oracle",
        detail: "A path in a root the caller may not open returns the same " + oracle.chars +
          "-character body as a path that never existed \u2014 compared here as strings, title, body and actions: " +
          (oracle.identical ? "identical" : "DIFFERENT") +
          ". FR-NO4\u2019s 404-not-403 only holds if the two bodies are indistinguishable, which is a copy decision as much as a status code.",
        pass: oracle.identical && oracle.hidden.status === 404 && oracle.never.status === 404 },

      { name: "1 + N roots exist; three of them are Jana\u2019s to open",
        detail: roots + " root scopes exist in a household of " + (roots - 1) + ". Jana opens " +
          rootsFor("jana").length + " (shared, her own, and Adam\u2019s \u2014 the child exception, stated to him at profile creation), Adam " +
          rootsFor("adam").length + ", and Petr, Kl\u00e1ra and Milo\u0161 " +
          rootsFor("petr").length + ": they hold none on Notes, so the module is absent rather than empty.",
        pass: rootsFor("jana").length === 3 && rootsFor("adam").length === 2 && rootsFor("petr").length === 0 &&
              rootsFor("jana").some(function (r) { return r.exception; }) },

      { name: "The switcher is navigation, not a filter",
        detail: "\u201crecepty\u201d resolves to " + ["shared", "private:jana"].map(function (r) {
            var x = resolve("recepty", r, "jana"); return x.status === 200 ? x.type : "404";
          }).join(" and ") + " in the two roots Jana writes in \u2014 a folder in one, a note in the other, same path. " +
          "A filter over one list has one namespace and could not answer this twice.",
        pass: resolve("recepty", "shared", "jana").type === "folder" &&
              resolve("recepty", "private:jana", "jana").type === "note" },

      { name: "Search is language-aware, and the accent does not matter",
        detail: runs.map(function (r) { return "\u201c" + r.q + "\u201d \u2192 " + r.jana + "/" + r.adam; }).join(" \u00b7 ") +
          " hits for Jana and Adam. " + runs.filter(function (r) { return r.langSensitive > 0; }).length +
          " of " + runs.length + " queries change answer if the note\u2019s language tag changes, which is what the per-note configuration buys. \u201cporek\u201d finds \u201cP\u00f3rkov\u00e1 pol\u00e9vka\u201d.",
        pass: runs[0].jana === 1 && runs[1].langSensitive > 0 && runs[3].jana === 1 && runs[3].adam === 1 },

      { name: "Scope is applied before matching, and the child root is navigable but not searchable",
        detail: (function () {
          var s = searchNotes("denik", "jana");
          return "Jana holds " + s.roots + " roots and searches " + s.searched + ": Adam\u2019s private root is excluded from her query even though she may open it deliberately. Her \u201cdenik\u201d search returns " +
            s.hits.length + " hit, hers. " + s.hidden + " notes are out of scope before anything is scored, and no count on the screen mentions them.";
        })(),
        pass: (function () {
          var s = searchNotes("denik", "jana");
          return s.roots === 3 && s.searched === 2 && s.hits.length === 1 &&
                 s.hits[0].id === "n-j-denik" && s.excludedRoots.length === 1;
        })() },

      { name: "Two pin scopes, one widget, household precedence",
        detail: "Jana has " + jana.rows.length + " pinned rows from " + PINS.filter(function (p) { return p.by === "jana" || p.scope === "household"; }).length +
          " pins: " + jana.deduplicated + " note is pinned both ways and appears once, as \u201cfor everyone\u201d. Adam has " +
          adam.rows.length + " and cannot pin for everyone \u2014 he holds view, so the control is absent rather than greyed (" +
          (adam.canPinForEveryone ? "OFFERED" : "absent") + "), while his own personal pin needs nothing more than view.",
        pass: jana.deduplicated === 1 && jana.rows.filter(function (r) { return r.alsoPersonal; })[0].scope === "household" &&
              !adam.canPinForEveryone && adam.canPinForSelf && adam.rows.length === 4 },

      { name: "The preserved loser is offered as a statement, and the copy knows who wrote it",
        detail: loser.lostChars + " characters were replaced " + loser.age + " days ago and are offered for another " +
          loser.left + ", until " + fmt(loser.until) + ". Notes has " + loser.authors.length +
          " member who can write in this household, so the banner says \u201cyour laptop\u201d rather than naming somebody: " +
          "\u201c" + loser.banner.body.slice(0, 80) + "\u2026\u201d. Question marks in the banner: " + loser.questions + ".",
        pass: loser.offered && loser.sameHand && loser.questions === 0 &&
              loser.banner.body.indexOf("?") < 0 && loser.banner.actions.length === 3 },

      { name: "The two lww_row cases are kept apart",
        detail: LWW_CASES.map(function (c) { return c.entity + ": " + c.window + ", " + c.offline; }).join(" \u00b7 ") +
          ". Neither module inherits the other\u2019s promise, which is why 03-patterns writes them as two rows and not one policy.",
        pass: LWW_CASES[0].window !== LWW_CASES[1].window && LWW_CASES[0].offline !== LWW_CASES[1].offline },

      { name: "Inline images are on the meter, with the note\u2019s own visibility",
        detail: img.count + " images across " + img.notes + " notes, " + img.mb.toFixed(0) + " MB \u2014 " +
          (img.gb).toFixed(2) + " GB, which is the Notes line on the household storage screen. " + img.private +
          " of them are in private roots and are keyed under the note that owns them, so they inherit its visibility rather than carrying their own.",
        pass: Math.abs(img.gb - 0.2) < 0.06 && img.private > 0 },

      { name: "Every state these six rows can reach is drawn",
        detail: cov.map(function (c) { return c.id + " " + c.drawn.length + "/" + c.required.length; }).join(" \u00b7 ") +
          " states, " + cov.reduce(function (n, c) { return n + c.cells; }, 0) +
          " cells. Four exclusions, all on search, each argued from the fact that a query is a read.",
        pass: cov.every(function (c) { return c.complete; }) }
    ];
  }

  window.HH_NOTES = {
    version: "0.1-stage-13-candidate",
    today: TODAY, loserDays: LOSER_DAYS,
    rootScopes: rootScopes, rootsFor: rootsFor, canSeeRoot: canSeeRoot,
    folders: FOLDERS, notes: NOTES, treeOf: treeOf, pathOf: pathOf, folderPath: folderPath,
    indexRun: indexRun, indexProof: indexProof,
    renames: RENAMES, resolve: resolve, oracleProof: oracleProof, goneCopy: GONE_COPY,
    fold: fold, stem: stem, matches: matches, search: searchNotes, queries: QUERIES, queryRuns: queryRuns,
    pins: PINS, pinsFor: pinsFor,
    contributors: contributors, conflict: CONFLICT, loserState: loserState, lwwCases: LWW_CASES,
    imageMB: IMAGE_MB, imageLines: imageLines,
    screens: SCREENS, rows: SCREENS, allStates: ALL_STATES, coverage: coverage,
    fmt: fmt, addDays: addDays, diff: diff,
    checks: checks
  };
})();
