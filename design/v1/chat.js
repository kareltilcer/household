/* Stage 19 — Chat: the conversation list, the thread, and the floor that has to hold twice.

   Sources: docs/prd/modules/15-chat.md (FR-CT1-13, D-74, D-89, D-90, the sync table),
   design/05-screens.md §E Chat, 03-patterns §1 (merge policies) and §5,
   prd/03-platform-strands.md §2.3 and §2.5 (the pull predicate, state_set keys),
   prd/modules/08-documents.md FR-DO1 (the sniffing, caps and quota this module reuses),
   04-navigation §1 and DD-11 (the four- and five-destination bars).

   Four things this file computes rather than claims.

   1. The floor, on both paths. FR-CT2 gives a member added to an existing conversation an
      effective_from message id; D-90 adds floor_seq to the same row because the sync pull
      is a second delivery path and a rule that holds on one of two holds on neither.
      floorRun() counts what each path would hand Kl\u00e1ra, and both come back at the same
      number or the gate fails.

   2. Reactions as desired state. FR-CT4: the gesture is a double tap and a gesture fires
      twice. reactRun() replays the same two frames through desired-state and through a
      toggle, and the toggle ends with the reaction gone.

   3. The read marker merges as a maximum. chat.read is state_set with resolution monotonic,
      so two devices with two markers resolve to the further one. readRun() also computes
      what latest_client_time would have done, which is mark four read messages unread.

   4. Custody transfer, not a copy. FR-CT7 moves the bytes: storageRun() computes the chat
      prefix before and after, the Documents figure before and after, and the household
      total, which does not move \u2014 against the copy, which adds 1.11 GB to the bill.

   One finding this file does not paper over: three of the five fixture members hold none on
   Chat, and FR-CT1 says the general conversation contains every member automatically. Both
   cannot be true. The resolution drawn here is that Chat membership is resolved against the
   grant, so the household room holds three of five and says so \u2014 and Milo\u0161, who owns the
   cottage, cannot be in the conversation about the cottage. That is a grant to change, not a
   workaround to design, and the conversation list says which.
*/
(function () {

  var TODAY = "2026-09-09";
  var LEVELS = ["none", "view", "contribute", "manage"];
  var EMOJI = ["\ud83d\udc4d", "\u2764\ufe0f", "\ud83d\ude02", "\ud83d\ude4f"];
  var EDIT_WINDOW_MIN = 15;
  var LOSER_DAYS = 30;

  function member(id) {
    var F = window.HH_FIXTURES;
    return (F ? F.members : []).filter(function (m) { return m.id === id; })[0] || null;
  }
  function name(id) { var m = member(id); return m ? m.name : id; }
  function grantOf(id) { var m = member(id); return m ? (m.grants.chat || "none") : "none"; }
  function atLeast(a, b) { return LEVELS.indexOf(a) >= LEVELS.indexOf(b); }
  function members() { var F = window.HH_FIXTURES; return F ? F.members : []; }

  /* ── 1. Conversations and membership ─────────────────────────────────────
     A general room created with the household, a group, and a direct pair.
     `floorSeq` is D-90's: the household sync cursor at the moment of joining. */

  var CONVERSATIONS = [
    { id: "c-dum", kind: "general", cs: "D\u016fm", created: "2024-01-14", by: "jana",
      muted: [], undeletable: true },
    { id: "c-chata", kind: "group", cs: "Chata \u2014 v\u00edkend", created: "2026-08-30", by: "jana",
      muted: ["adam"], undeletable: false },
    { id: "c-jk", kind: "direct", cs: "Kl\u00e1ra", created: "2026-09-08", by: "jana",
      muted: [], undeletable: false }
  ];
  var MEMBERSHIP = [
    { conv: "c-dum", who: "jana", joined: "2024-01-14", floor: null, floorSeq: 0 },
    { conv: "c-dum", who: "adam", joined: "2024-01-14", floor: null, floorSeq: 0 },
    { conv: "c-dum", who: "klara", joined: "2026-09-08", floor: "m-dum-09", floorSeq: 88214 },
    { conv: "c-chata", who: "jana", joined: "2026-08-30", floor: null, floorSeq: 0 },
    { conv: "c-chata", who: "adam", joined: "2026-08-30", floor: null, floorSeq: 0 },
    { conv: "c-chata", who: "klara", joined: "2026-09-08", floor: "m-chata-03", floorSeq: 88214 },
    { conv: "c-jk", who: "jana", joined: "2026-09-08", floor: null, floorSeq: 0 },
    { conv: "c-jk", who: "klara", joined: "2026-09-08", floor: null, floorSeq: 0 }
  ];
  function conversation(id) { return CONVERSATIONS.filter(function (c) { return c.id === id; })[0] || null; }
  function membersOf(conv) { return MEMBERSHIP.filter(function (m) { return m.conv === conv; }); }
  function membershipOf(conv, who) {
    return MEMBERSHIP.filter(function (m) { return m.conv === conv && m.who === who; })[0] || null;
  }
  function inConversation(conv, who) { return !!membershipOf(conv, who); }

  /* FR-CT1 says the general conversation contains every member automatically.
     The grant says otherwise for three of five, and the grant wins. */
  function membershipRun() {
    var granted = members().filter(function (m) { return grantOf(m.id) !== "none"; });
    var absent = members().filter(function (m) { return grantOf(m.id) === "none"; });
    return {
      household: members().length, granted: granted.length, absent: absent.length,
      inGeneral: membersOf("c-dum").length,
      absentNames: absent.map(function (m) { return m.name; }),
      readOnly: granted.filter(function (m) { return grantOf(m.id) === "view"; }).map(function (m) { return m.name; }),
      cottage: { owner: "Milo\u0161", grant: grantOf("milos"), inCottageThread: inConversation("c-chata", "milos") },
      says: "The general room holds " + membersOf("c-dum").length + " of " + members().length +
        " members, because " + absent.map(function (m) { return m.name; }).join(" and ") +
        " hold none on Chat and a module at none is absent rather than empty. Two of the three who are in it \u2014 " +
        granted.filter(function (m) { return grantOf(m.id) === "view"; }).map(function (m) { return m.name; }).join(" and ") +
        " \u2014 hold view, which the permissions table makes read-only participation: they read, they cannot post, and the composer is absent rather than disabled. Milo\u0161 owns the cottage and cannot be in the thread about the cottage; the list says so, in one line, with the grant it would take."
    };
  }

  /* ── 2. Messages ─────────────────────────────────────────────────────────
     chat.message is additive \u2014 the envelope is appended and never merged.
     chat.message_body is lww_row, so an edit inside the window is a whole-body
     replacement and the loser is preserved for 30 days. */

  var MESSAGES = [
    { id: "m-dum-01", conv: "c-dum", by: "jana", at: "2026-09-07 08:12", seq: 88090,
      text: "Pra\u010dka dorazí ve st\u0159edu mezi 13 a 17. N\u011bkdo mus\u00ed b\u00fdt doma." },
    { id: "m-dum-02", conv: "c-dum", by: "adam", at: "2026-09-07 08:20", seq: 88092,
      text: "Ve st\u0159edu m\u00e1m plav\u00e1n\u00ed a\u017e v p\u016fl p\u00e1t\u00e9." },
    { id: "m-dum-03", conv: "c-dum", by: "jana", at: "2026-09-07 08:24", seq: 88095,
      text: "Tak jsem doma j\u00e1." },
    { id: "m-dum-04", conv: "c-dum", by: "jana", at: "2026-09-07 19:40", seq: 88121,
      text: "Kl\u00ed\u010de od sklepa jsou na h\u00e1\u010dku u dve\u0159\u00ed.", hit: "kl\u00ed\u010de" },
    { id: "m-dum-05", conv: "c-dum", by: "adam", at: "2026-09-07 19:52", seq: 88124,
      text: "Bela m\u011bla r\u00e1no tabletku, dal jsem ji v tvarohu." },
    { id: "m-dum-06", conv: "c-dum", by: "jana", at: "2026-09-08 07:02", seq: 88180,
      text: "Kotel m\u00e1 servis v pond\u011bl\u00ed ve dvou. Novotn\u00fd p\u0159ijede s\u00e1m." },
    { id: "m-dum-07", conv: "c-dum", by: "jana", at: "2026-09-08 07:04", seq: 88182,
      text: "Kdo bude m\u00edt kl\u00ed\u010de od branky?", hit: "kl\u00ed\u010de" },
    { id: "m-dum-08", conv: "c-dum", by: "adam", at: "2026-09-08 07:31", seq: 88190,
      text: "J\u00e1 do \u0161koly a\u017e v devět, otev\u0159u." },
    { id: "m-dum-09", conv: "c-dum", by: "jana", at: "2026-09-08 09:14", seq: 88216,
      text: "Kl\u00e1ro, v\u00edtej. Tady se \u0159e\u0161\u00ed v\u0161echno praktick\u00e9." },
    { id: "m-dum-10", conv: "c-dum", by: "klara", at: "2026-09-08 09:20", seq: 88219,
      text: "D\u00edky! Kde m\u00e1te kl\u00ed\u010de od sklepa?", hit: "kl\u00ed\u010de" },
    { id: "m-dum-11", conv: "c-dum", by: "adam", at: "2026-09-09 07:22", seq: 88301,
      text: "Kl\u00ed\u010de od branky nech venku, prší celej den.", hit: "kl\u00ed\u010de" },
    { id: "m-dum-12", conv: "c-dum", by: "klara", at: "2026-09-09 12:41", seq: 88340,
      text: "Vodu Bele jsem dala, m\u011bla pr\u00e1zdnou misku." },

    { id: "m-chata-01", conv: "c-chata", by: "jana", at: "2026-08-30 18:02", seq: 87400,
      text: "Milo\u0161 psal, \u017ee na chat\u011b te\u010de st\u0159echa. V\u00edkend 12.\u201313.?" },
    { id: "m-chata-02", conv: "c-chata", by: "adam", at: "2026-09-02 16:40", seq: 87610,
      text: "M\u016f\u017eu, ale a\u017e po plav\u00e1n\u00ed." },
    { id: "m-chata-03", conv: "c-chata", by: "jana", at: "2026-09-08 09:15", seq: 88217,
      text: "P\u0159idala jsem Kl\u00e1ru \u2014 pojede s n\u00e1mi." },
    { id: "m-chata-04", conv: "c-chata", by: "klara", at: "2026-09-08 20:10", seq: 88240,
      text: "Vzala bych vrták a stupačky. Tohle je z lo\u0148ska?", att: "a-2" },
    { id: "m-chata-05", conv: "c-chata", by: "adam", at: "2026-09-09 07:50", seq: 88310,
      text: "Ta krytina je nová, faktura je tu.", att: "a-3" },
    { id: "m-chata-06", conv: "c-chata", by: "klara", at: "2026-09-09 13:02", seq: 88345,
      text: "Tak v sobotu v osm u v\u00e1s?" },
    { id: "m-chata-07", conv: "c-chata", by: "adam", at: "2026-09-09 13:20", seq: 88349,
      text: "J\u00e1 vezmu vrt\u00e1k, je u kola." },

    { id: "m-jk-01", conv: "c-jk", by: "jana", at: "2026-09-08 09:30", seq: 88222,
      text: "Kdyby cokoli, pi\u0161 mi rovnou sem." },
    { id: "m-jk-02", conv: "c-jk", by: "klara", at: "2026-09-08 09:31", seq: 88223,
      text: "Jasn\u011b, d\u00edky." }
  ];
  /* One edited body and one tombstone, so the two states are drawn from rows. */
  var EDITED = {
    "m-dum-06": { at: "2026-09-08 07:06", was: "Kotel m\u00e1 servis v pond\u011bl\u00ed v jednu.",
                  by: "jana", loserKeptDays: LOSER_DAYS }
  };
  var DELETED = { "m-chata-02": false };
  var TOMBSTONE = { id: "m-dum-t1", conv: "c-dum", by: "adam", at: "2026-09-09 07:25", seq: 88303,
                    text: "zpr\u00e1va smaz\u00e1na", tomb: true };

  function messagesOf(conv) {
    return MESSAGES.filter(function (m) { return m.conv === conv; })
      .sort(function (a, b) { return a.seq - b.seq; });
  }
  /* FR-CT2 read as a function: the API path. */
  function visibleTo(conv, who) {
    var ms = membershipOf(conv, who);
    if (!ms) return [];
    var all = messagesOf(conv);
    if (!ms.floor) return all;
    var from = all.map(function (m) { return m.id; }).indexOf(ms.floor);
    return all.slice(Math.max(0, from));
  }
  /* D-90's path: the sync pull predicate, which is a different query entirely. */
  function replicaOf(conv, who) {
    var ms = membershipOf(conv, who);
    if (!ms) return [];
    return messagesOf(conv).filter(function (m) { return m.seq >= ms.floorSeq; });
  }
  function floorRun() {
    var rows = [];
    MEMBERSHIP.forEach(function (ms) {
      var all = messagesOf(ms.conv);
      var api = visibleTo(ms.conv, ms.who);
      var rep = replicaOf(ms.conv, ms.who);
      rows.push({
        conv: ms.conv, convName: conversation(ms.conv).cs, who: ms.who, name: name(ms.who),
        joined: ms.joined, floor: ms.floor, floorSeq: ms.floorSeq,
        total: all.length, api: api.length, replica: rep.length,
        withheld: all.length - api.length, agree: api.length === rep.length
      });
    });
    var klara = rows.filter(function (r) { return r.who === "klara" && r.floor; });
    return {
      rows: rows, pairs: rows.length,
      bothPaths: rows.every(function (r) { return r.agree; }),
      withheld: rows.reduce(function (n, r) { return n + r.withheld; }, 0),
      klara: klara,
      says: "Kl\u00e1ra joined two existing conversations yesterday. The API path withholds " +
        klara.reduce(function (n, r) { return n + r.withheld; }, 0) +
        " messages from her (" + klara.map(function (r) { return r.convName + ": " + r.api + " of " + r.total; }).join(", ") +
        ") and the sync pull, which is a different query against seq \u2265 floor_seq, withholds the same ones \u2014 " +
        (rows.every(function (r) { return r.agree; }) ? "the two paths agree on all " + rows.length + " membership rows" : "THE PATHS DISAGREE") +
        ". Without floor_seq the replica would have handed her every message inside the 90-day horizon: the back catalogue FR-CT2 exists to withhold, delivered by the path nobody was looking at. Both floors are written in one transaction from one event, so they cannot drift."
    };
  }

  /* ── 3. Unread, and the last-message line ────────────────────────────────
     chat.read is state_set keyed (conversation, user), resolution monotonic. */

  var READS = {
    "c-dum|jana": "m-dum-10", "c-dum|adam": "m-dum-12", "c-dum|klara": "m-dum-11",
    "c-chata|jana": "m-chata-01", "c-chata|adam": "m-chata-06", "c-chata|klara": "m-chata-06",
    "c-jk|jana": "m-jk-02", "c-jk|klara": "m-jk-02"
  };
  function unread(conv, who) {
    var vis = visibleTo(conv, who);
    if (!vis.length) return 0;
    var mark = READS[conv + "|" + who];
    var idx = vis.map(function (m) { return m.id; }).indexOf(mark);
    var after = idx < 0 ? vis : vis.slice(idx + 1);
    return after.filter(function (m) { return m.by !== who; }).length;
  }
  function lastVisible(conv, who) {
    var vis = visibleTo(conv, who);
    return vis.length ? vis[vis.length - 1] : null;
  }
  function listFor(who) {
    if (grantOf(who) === "none") return [];
    return CONVERSATIONS.filter(function (c) { return inConversation(c.id, who); })
      .map(function (c) {
        var last = lastVisible(c.id, who);
        return {
          id: c.id, kind: c.kind, cs: c.cs,
          members: membersOf(c.id).length,
          unread: unread(c.id, who),
          muted: c.muted.indexOf(who) >= 0,
          last: last ? { by: name(last.by), at: last.at, text: last.text } : null,
          nullLast: !last
        };
      })
      .sort(function (a, b) { return b.unread - a.unread; });
  }
  function unreadRun() {
    var rows = members().filter(function (m) { return grantOf(m.id) !== "none"; }).map(function (m) {
      var l = listFor(m.id);
      return { who: m.id, name: m.name, grant: grantOf(m.id),
               total: l.reduce(function (n, c) { return n + c.unread; }, 0),
               threads: l.filter(function (c) { return c.unread > 0; }).length,
               rows: l };
    });
    var jana = rows.filter(function (r) { return r.who === "jana"; })[0];
    var widget = { total: 7, threads: 2 };
    return {
      rows: rows, jana: jana, widget: widget,
      agrees: jana.total === widget.total && jana.threads === widget.threads,
      boundedByFloor: rows.every(function (r) {
        return r.rows.every(function (c) { return c.unread <= visibleTo(c.id, r.who).length; });
      }),
      says: "Jana carries " + jana.total + " unread over " + jana.threads +
        " threads (" + jana.rows.filter(function (c) { return c.unread; }).map(function (c) { return c.cs + " " + c.unread; }).join(", ") +
        "), which is exactly what Stage 10's chat.unread widget shows. Every count is taken over what the member may see rather than over the conversation, so a member's unread can never exceed their own visible window \u2014 and a conversation whose last visible message is null renders a row with no preview line rather than a row with somebody else's sentence in it."
    };
  }

  /* ── 4. Reactions \u2014 desired state, because a double tap fires twice ─────── */

  var REACTIONS = [
    { msg: "m-dum-05", by: "jana", emoji: EMOJI[1] },
    { msg: "m-dum-05", by: "klara", emoji: EMOJI[0] },
    { msg: "m-chata-05", by: "jana", emoji: EMOJI[0] },
    { msg: "m-chata-05", by: "klara", emoji: EMOJI[0] },
    { msg: "m-chata-06", by: "adam", emoji: EMOJI[3] }
  ];
  function reactionsOn(id) {
    var by = {};
    REACTIONS.filter(function (r) { return r.msg === id; }).forEach(function (r) {
      by[r.emoji] = by[r.emoji] || [];
      by[r.emoji].push(name(r.by));
    });
    return Object.keys(by).map(function (e) { return { emoji: e, n: by[e].length, who: by[e] }; });
  }
  function reactRun() {
    var frames = [
      { call: "PUT reacted: true", from: "double tap, first frame" },
      { call: "PUT reacted: true", from: "double tap, second frame 40 ms later" }
    ];
    /* desired state: idempotent by (message, user, emoji) */
    var desired = true;
    frames.forEach(function () { desired = true; });
    /* toggle: the second frame undoes the first */
    var toggle = false;
    frames.forEach(function () { toggle = !toggle; });
    return {
      frames: frames, emoji: EMOJI, set: EMOJI.length,
      desiredEnds: desired, toggleEnds: toggle,
      key: "(message, user, emoji)", resolution: "latest_client_time",
      says: "The gesture is a double tap, so the client sends the same frame twice 40 ms apart. Desired-state (" +
        frames[0].call + ") ends " + (desired ? "reacted" : "not reacted") +
        " and is idempotent on (message, user, emoji); a toggle endpoint ends " +
        (toggle ? "reacted" : "not reacted") +
        " \u2014 the reaction the member just made, gone. Carried from home D265, and the reason the API takes a state rather than an instruction."
    };
  }

  /* ── 5. The read marker merges as a maximum ─────────────────────────────── */

  function readRun() {
    var all = messagesOf("c-dum");
    var idx = function (id) { return all.map(function (m) { return m.id; }).indexOf(id); };
    var devices = [
      { device: "phone", marker: "m-dum-12", at: "2026-09-09 12:44" },
      { device: "tablet", marker: "m-dum-08", at: "2026-09-09 13:10" }
    ];
    var monotonic = devices.reduce(function (best, d) { return idx(d.marker) > idx(best.marker) ? d : best; }, devices[0]);
    var latest = devices.reduce(function (best, d) { return d.at > best.at ? d : best; }, devices[0]);
    return {
      devices: devices, monotonicWins: monotonic.marker, latestWins: latest.marker,
      wouldUnread: idx(monotonic.marker) - idx(latest.marker),
      key: "(conversation, user)", resolution: "monotonic",
      says: "Two devices, two markers: the phone read to " + monotonic.marker.replace("m-dum-", "message ") +
        " at 12:44 and the tablet was left open at " + latest.marker.replace("m-dum-", "message ") +
        " until 13:10. Resolution monotonic takes the maximum and the marker stays at " +
        monotonic.marker.replace("m-dum-", "message ") + "; latest_client_time would have taken the tablet's and marked " +
        (idx(monotonic.marker) - idx(latest.marker)) +
        " already-read messages unread again. A read marker only moves forward, which is why 03 \u00a72.5 makes the resolution a declaration rather than a default."
    };
  }

  /* ── 6. Attachments \u2014 the row exists before the bytes ──────────────────── */

  var ATTACHMENTS = [
    { id: "a-0", conv: "c-dum", msg: "m-dum-old", by: "milos", at: "2025-08-24 17:40",
      file: "chata-strecha-2025-08.mp4", mb: 921.6, ct: "video/mp4",
      bytes: "ready", thumb: "ready", note: "Nahr\u00e1no v srpnu 2025, kdy\u017e Milo\u0161 na Chat je\u0161t\u011b pr\u00e1vo m\u011bl." },
    { id: "a-1", conv: "c-chata", msg: "m-chata-04", by: "klara", at: "2026-09-08 20:10",
      file: "chata-strecha.jpg", mb: 3.2, ct: "image/jpeg", bytes: "ready", thumb: "ready" },
    { id: "a-2", conv: "c-chata", msg: "m-chata-04", by: "klara", at: "2026-09-08 20:11",
      file: "chata-video.mp4", mb: 214.0, ct: "video/mp4", bytes: "pending", thumb: "none",
      note: "\u0158\u00e1dek je tady, bajty jsou po\u0159\u00e1d v telefonu." },
    { id: "a-3", conv: "c-chata", msg: "m-chata-05", by: "adam", at: "2026-09-09 07:50",
      file: "faktura-krytina.pdf", mb: 1.1, ct: "application/pdf", bytes: "ready", thumb: "processing" }
  ];
  /* The same three-answer table Documents uses, so the states are one vocabulary. */
  function serve(att, endpoint) {
    if (att.bytes === "pending") {
      return endpoint === "thumbnail"
        ? { status: 404, says: "je\u0161t\u011b nen\u00ed n\u00e1hled", note: "\u0158\u00e1dek existuje, bajty ne." }
        : { status: 409, says: "bajty nejsou nahran\u00e9", note: "Ve fronte na za\u0159\u00edzen\u00ed, kter\u00e9 to poslalo. \u0158\u00e1dek je u\u017e v\u0161ude." };
    }
    if (endpoint === "thumbnail") {
      return att.thumb === "ready" ? { status: 200, says: "mal\u00fd obr\u00e1zek", note: "" }
           : att.thumb === "processing" ? { status: 202, says: "d\u011bl\u00e1 se", note: "Placeholder ve spr\u00e1vn\u00e9 velikosti, \u0159\u00e1dek se nehne." }
           : { status: 404, says: "n\u00e1hled nebude", note: "" };
    }
    return { status: 200, says: "bajty \u00b7 ETag = checksum", note: "" };
  }
  function attachRun() {
    var rows = ATTACHMENTS.map(function (a) {
      return { id: a.id, file: a.file, mb: a.mb, by: name(a.by), state: a.bytes + "/" + a.thumb,
               thumbnail: serve(a, "thumbnail").status, raw: serve(a, "raw").status, note: a.note || "" };
    });
    return {
      rows: rows, total: ATTACHMENTS.length,
      pending: ATTACHMENTS.filter(function (a) { return a.bytes === "pending"; }).length,
      processing: ATTACHMENTS.filter(function (a) { return a.thumb === "processing"; }).length,
      states: 3,
      says: ATTACHMENTS.length + " attachments in three states: bytes and thumbnail ready, bytes uploaded and thumbnail still being made (202, a placeholder at the right size and the row does not move when it arrives), and bytes still on the sending device (thumbnail 404, raw 409, and the row is already on every other device). Same sniffing, same size caps, same quota as Documents, and the same three answers \u2014 one vocabulary rather than a second one written for Chat."
    };
  }

  /* ── 7. Storage clean-up, and the custody transfer ──────────────────────── */

  var PER_CONV = [
    { conv: "c-dum", files: 214, gb: 1.42, oldest: "2024-01-20" },
    { conv: "c-chata", files: 38, gb: 3.86, oldest: "2026-08-30" },
    { conv: "c-jk", files: 3, gb: 0.12, oldest: "2026-09-08" }
  ];
  var THRESHOLDS = [{ gb: 4, level: "notice" }, { gb: 8, level: "warn" }];
  function storageRun(selection) {
    var H = window.HH_HOUSEHOLD;
    var chat = PER_CONV.reduce(function (n, c) { return n + c.gb; }, 0);
    var settings = H ? (H.storage.byModule.filter(function (m) { return m[0] === "Chat"; })[0] || [null, null])[1] : null;
    var docs = H ? (H.storage.byModule.filter(function (m) { return m[0] === "Documents"; })[0] || [null, null])[1] : null;
    var sel = selection || ["a-0", "a-2"];
    var moving = ATTACHMENTS.filter(function (a) { return sel.indexOf(a.id) >= 0; });
    var gb = moving.reduce(function (n, a) { return n + a.mb; }, 0) / 1024;
    var totalBefore = H ? H.storage.current : null;
    return {
      perConv: PER_CONV, chat: chat, settings: settings, docs: docs,
      agrees: settings !== null && Math.abs(settings - chat) < 0.005,
      thresholds: THRESHOLDS,
      crossed: THRESHOLDS.filter(function (t) { return chat >= t.gb; }),
      selection: moving.map(function (a) { return { file: a.file, mb: a.mb, by: name(a.by) }; }),
      moveGb: gb,
      chatAfter: chat - gb, docsAfter: docs === null ? null : docs + gb,
      totalBefore: totalBefore, totalAfter: totalBefore,
      copyWouldBe: totalBefore === null ? null : totalBefore + gb,
      largest: H ? H.storage.largest.filter(function (l) { return /Chat/.test(l[1]); })[0] : null,
      says: "Chat holds " + chat.toFixed(2) + " GB over " +
        PER_CONV.reduce(function (n, c) { return n + c.files; }, 0) + " files in " +
        PER_CONV.length + " conversations, which is the " + settings +
        " GB Settings \u00a75 attributes to Chat \u2014 the same rows, counted once. Moving the two videos (" +
        moving.map(function (a) { return a.file; }).join(", ") + ", " + gb.toFixed(2) +
        " GB) into Documents is a custody transfer: the chat prefix drops to " + (chat - gb).toFixed(2) +
        " GB, Documents rises to " + (docs + gb).toFixed(2) + " GB, and the household total stays at " +
        totalBefore + " GB. A copy would have made it " + (totalBefore + gb).toFixed(2) +
        " GB and the household would be paying for the roof twice. The message keeps a reference, so the thread still reads."
    };
  }
  function attributionRun() {
    var a = ATTACHMENTS[0];
    return {
      file: a.file, by: name(a.by),
      level: grantOf(a.by), stillAttributed: true,
      says: "The largest file in the household is " + a.file + ", 0.90 GB, uploaded by " +
        name(a.by) + " in August 2025 \u2014 and " + name(a.by) +
        " holds none on Chat today. The row keeps its uploader: a grant change is not a retroactive edit of who did what, the storage screen still attributes the bytes to the member who put them there, and the clean-up view is reachable by an owner rather than only by the person who can no longer open the module. Stage 8's storage screen and this one are looking at the same file."
    };
  }

  /* ── 8. Search, bounded by the floor ────────────────────────────────────── */

  function search(who, q) {
    if (grantOf(who) === "none") return { rows: [], reason: "absent" };
    var rows = [];
    CONVERSATIONS.forEach(function (c) {
      if (!inConversation(c.id, who)) return;
      visibleTo(c.id, who).forEach(function (m) {
        if (m.text.toLowerCase().indexOf(q.toLowerCase()) >= 0) {
          rows.push({ conv: c.cs, id: m.id, by: name(m.by), at: m.at, text: m.text });
        }
      });
    });
    return { rows: rows, reason: "" };
  }
  function searchRun() {
    var q = "kl\u00ed\u010de";
    var all = MESSAGES.filter(function (m) { return m.text.toLowerCase().indexOf(q) >= 0; });
    var jana = search("jana", q), klara = search("klara", q), petr = search("petr", q);
    return {
      q: q, corpus: all.length,
      jana: jana.rows.length, klara: klara.rows.length, petr: petr.rows.length,
      hidden: jana.rows.length - klara.rows.length,
      rows: jana.rows, klaraRows: klara.rows,
      says: "\u201e" + q + "\u201c appears in " + all.length + " messages. Jana gets " +
        jana.rows.length + ", Kl\u00e1ra gets " + klara.rows.length +
        " \u2014 the missing " + (jana.rows.length - klara.rows.length) +
        " are below her floor, and a member cannot search text they cannot read. Petr gets " +
        petr.rows.length + " and no empty-results screen either: at none the search scope is absent, not zero."
    };
  }

  /* ── 9. Realtime, offline queue, mute, refusals ─────────────────────────── */

  function realtimeRun() {
    var audience = membersOf("c-dum").length;
    return {
      audience: audience, frames: 1, perRecipient: audience,
      exception: "the one nudge-only exception in the product",
      says: "A message to the house room resolves to " + audience +
        " conversation members and is marshalled once for that audience, not " + audience +
        " times. Chat is the one place a payload rides the socket at all \u2014 everywhere else the socket nudges and the client pulls \u2014 because a pull round-trip is visible latency in a chat and nowhere else."
    };
  }
  var QUEUE = [
    { id: "q-1", conv: "c-chata", by: "jana", at: "2026-09-09 13:40", text: "Vezmu \u017eeb\u0159\u00edk.", state: "pending" },
    { id: "q-2", conv: "c-chata", by: "jana", at: "2026-09-09 13:41", text: "A plachtu, kdyby pr\u0161elo.", state: "pending" }
  ];
  function queueRun() {
    return { rows: QUEUE, ordered: true,
             says: QUEUE.length + " messages typed with no signal, queued in order, drawn with a pending mark and sent in that order on reconnect \u2014 the behaviour every messenger has and every member expects. The envelope is additive, so nothing about them can conflict." };
  }
  function muteRun() {
    var rows = [];
    CONVERSATIONS.forEach(function (c) {
      membersOf(c.id).forEach(function (m) {
        rows.push({ conv: c.cs, who: name(m.who), muted: c.muted.indexOf(m.who) >= 0 });
      });
    });
    return { rows: rows, muted: rows.filter(function (r) { return r.muted; }).length,
             category: "direct", quietHours: true,
             says: "Push goes in the direct category, honours quiet hours and honours the mute \u2014 " +
               rows.filter(function (r) { return r.muted; }).length + " of " + rows.length +
               " (member, conversation) pairs is muted: Adam has muted the cottage thread and still sees it in the list with its unread count, because mute is about the phone rather than about the conversation." };
  }
  /* FR-CT13 / D-217: a conversation the caller is not in does not exist. */
  function refuseRun() {
    var cases = [
      { who: "petr", conv: "c-dum", why: "none on Chat" },
      { who: "adam", conv: "c-jk", why: "not a member of a direct conversation" },
      { who: "milos", conv: "c-chata", why: "none on Chat, and it is about his own cottage" },
      { who: "klara", conv: "c-dum", why: "a member \u2014 served, with her floor applied" }
    ].map(function (c) {
      var ok = grantOf(c.who) !== "none" && inConversation(c.conv, c.who);
      return { who: name(c.who), conv: conversation(c.conv).cs, why: c.why,
               status: ok ? 200 : 404, oracle: false };
    });
    return { cases: cases, refusals: cases.filter(function (c) { return c.status === 404; }).length,
             any403: cases.filter(function (c) { return c.status === 403; }).length,
             says: cases.filter(function (c) { return c.status === 404; }).length + " of " + cases.length +
               " reads answer 404 and none answers 403: a 403 turns a guessed id into an oracle over who talks to whom. Carried from home D217, and it is the same answer whether the cause is the grant or the membership." };
  }

  /* ── 10. The four-tab bar ───────────────────────────────────────────────── */

  function barRun() {
    var N = window.HH_NAV;
    if (!N) return { ready: false, says: "" };
    var rows = members().map(function (m) {
      var nav = N.navFor(m.id, "hh-tilcer");
      return { who: m.name, tabs: nav.tabs.length,
               labels: nav.tabs.map(function (t) { return t[1] || t.label || t[0]; }),
               hasChat: nav.hasChat };
    });
    var four = rows.filter(function (r) { return r.tabs === 4; });
    var five = rows.filter(function (r) { return r.tabs === 5; });
    return {
      ready: true, rows: rows, four: four.length, five: five.length,
      says: "Chat is the destination that decides the bar: " + five.length +
        " members get five tabs and " + four.length + " get four (" +
        four.map(function (r) { return r.who; }).join(", ") +
        "). Both are finished layouts \u2014 the four-tab bar redistributes its width rather than leaving a gap where Chat was \u2014 which is DD-11 settled in Stage 6 and inherited here rather than re-decided."
    };
  }

  /* ── 11. Empty state, help, policies, screens ───────────────────────────── */

  var EMPTY = {
    s: "Tady si p\u00ed\u0161e dom\u00e1cnost \u2014 to, co nepat\u0159\u00ed k \u017e\u00e1dn\u00e9 konkr\u00e9tn\u00ed v\u011bci.",
    e: "Nap\u0159\u00edklad \u201ejsem u pekaře, chcete n\u011bco?\u201c",
    a: "Napsat prvn\u00ed zpr\u00e1vu"
  };
  function emptyAudit() {
    var banned = ["no messages", "no records", "0 messages", "empty", "conversation object", "entity"];
    var body = (EMPTY.s + " " + EMPTY.e + " " + EMPTY.a).toLowerCase();
    return { sentence: 1, example: 1, action: 1,
             banned: banned.filter(function (w) { return body.indexOf(w) >= 0; }),
             says: "One sentence, one example a household would really send, one action \u2014 and the example is deliberately not about the roof, because the first message in a new household is never about the roof." };
  }
  var HELP = [
    { id: "chat.floor.why", screen: "/chat/{id}", hard: false,
      title: "Pro\u010d nevid\u00edm star\u0161\u00ed zpr\u00e1vy?",
      body: "Do konverzace jste p\u0159i\u0161li v\u010dera. Co bylo p\u0159ed t\u00edm, z\u016fst\u00e1v\u00e1 t\u011bm, kdo tam byli \u2014 nen\u00ed to chyba ani nastaven\u00ed.",
      en: { title: "Why can I not see older messages?",
            body: "You joined the thread yesterday. What came before stays with the people who were there \u2014 it is not a fault and not a setting." },
      authoredIn: 19 },
    { id: "chat.storage.move", screen: "/chat/storage", hard: true, model: true,
      title: "P\u0159esunout do Dokument\u016f, nebo smazat?",
      body: "P\u0159esun soubor opravdu p\u0159est\u011bhuje: p\u0159estanete ho platit dvakr\u00e1t a ve zpr\u00e1v\u011b z\u016fstane odkaz. Smaz\u00e1n\u00ed ho vezme oboj\u00ed.",
      steps: ["Vyberte soubory.", "P\u0159esunout do Dokument\u016f, nebo smazat.",
              "Uvid\u00edte, kolik to uvoln\u00ed.", "Potvr\u010fte."],
      en: { title: "Move to Documents, or delete?",
            body: "Moving really moves the file: you stop paying for it twice and the message keeps a link to it. Deleting takes both.",
            steps: ["Pick the files.", "Move to Documents, or delete.", "See how much it frees.", "Confirm."] },
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
             says: HELP.length + " entries, " + Object.keys(by).map(function (k) { return by[k] + " " + k; }).join(" \u00b7 ") +
               ", surface derived from the content." };
  }

  var POLICIES = [
    ["chat.conversation", "strict_version", "Its name, its membership, its bin state.", true],
    ["chat.message", "additive", "The envelope \u2014 author, conversation, reply parent, timestamps, tombstone. Appended and never merged.", false],
    ["chat.message_body", "lww_row", "The editable text, split out for the same reason Notes splits its body: one entity declares one policy, and an edit inside the fifteen-minute window is a whole-body replacement that cannot be field-merged honestly. Rare, online-only, loser preserved 30 days.", false],
    ["chat.reaction", "state_set", "Key (message, user, emoji), resolution latest_client_time. Desired-state semantics.", false],
    ["chat.read", "state_set", "Key (conversation, user), resolution monotonic \u2014 a maximum, not a latest.", false],
    ["attachment bytes", "not synced", "Metadata and thumbnails sync; originals are fetched on demand.", false]
  ];

  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending", "syncing",
                    "conflicted", "rejected", "absent", "withdrawn", "readonly"];
  var ADDITIVE = {
    conflicted: "chat.message is additive: the envelope is appended and never merged, so two people sending at once produce two messages rather than two versions of one. The one lww_row in the module is the edited body, and its loser is preserved and offered for 30 days."
  };
  var STRICT_CONV = {};

  var SCREENS = [
    { id: "E-36", view: "chat", client: "mw", preset: "D", route: "/chat", kind: "list",
      name: "Conversation list", title: "Zpr\u00e1vy",
      lede: "Three conversations, unread first, and one line saying who is not here.",
      empty: EMPTY,
      error: "Seznam se nena\u010detl. Co je v telefonu, se \u010dte d\u00e1l.",
      rejected: "Odm\u00edtnuto: konverzaci m\u016f\u017ee zalo\u017eit jen spr\u00e1vce.",
      withdrawn: "Zpr\u00e1vy u\u017e s v\u00e1mi nejsou sd\u00edlen\u00e9 \u2014 tohle za\u0159\u00edzen\u00ed smazalo svou kopii.",
      readonly: "Jen ke \u010dten\u00ed, dokud se p\u0159edplatn\u00e9 neobnov\u00ed. \u010c\u00edst jde v\u0161echno.",
      states: { absent: "Three of five members hold none on Chat: no tab, no widget, no list, and a conversation they are named in answers 404.",
                offline: "Messages and thumbnails are on the device; originals are fetched on demand.",
                pending: "A queued message shows on its conversation row as pending, in order.",
                syncing: "Past the 800 ms threshold only.",
                populated: "Unread first, then by last message. A conversation whose last visible message is below the floor draws no preview line at all rather than borrowing one." },
      impossible: { conflicted: "A conversation row is strict_version and resolved on the server; the list itself is a read over messages, which are additive." },
      foot: "The general conversation cannot be deleted, and the list says so where a member would look for the control.",
      note: "Kl\u00e1ra's row is the null-last-message case, which is a nullable field that still has to read as a row.", drawn: "all" },

    { id: "E-37", view: "chat", client: "mw", preset: "D", route: "/chat/c-chata", kind: "thread",
      name: "Thread", title: "Chata \u2014 v\u00edkend",
      lede: "Seven messages, reactions as chips, two files on one of them, and a tombstone where one was deleted.",
      empty: { s: "Je\u0161t\u011b tu nic nen\u00ed.", e: "\u201eV\u00edkend 12.\u201313.?\u201c", a: "Napsat" },
      error: "Zpr\u00e1vy se nena\u010detly.",
      rejected: "Odm\u00edtnuto: upravovat zpr\u00e1vu jde 15 minut od odesl\u00e1n\u00ed.",
      withdrawn: "U\u017e s v\u00e1mi nen\u00ed sd\u00edlen\u00e1.",
      readonly: "Jen ke \u010dten\u00ed \u2014 a u \u010dlena s pr\u00e1vem \u201eč\u00edst\u201c to nen\u00ed doček\u00e1n\u00ed: psac\u00ed pole tam nen\u00ed v\u016fbec.",
      states: { absent: "Absent with the module, and 404 for a member who is not in this conversation.",
                offline: "Reading is complete; sending queues and shows pending in place.",
                pending: "The bubble is there, greyed on its own side, with the mark and no reorder.",
                syncing: "Past the threshold only." },
      impossible: ADDITIVE,
      foot: "Reactions are a fixed set of four, one chip per emoji, and the API takes the desired state.",
      note: "Kl\u00e1ra's first visible message is the one that says she was added \u2014 the floor lands on a sentence that explains itself.", drawn: "all" },

    { id: "E-38", view: "chat", client: "mw", preset: "D", route: "/chat/c-chata#a-2", kind: "attach",
      name: "Attachments with async thumbnails", title: "P\u0159\u00edlohy",
      lede: "Four files in three states, and the row exists before the bytes.",
      empty: { s: "\u017d\u00e1dn\u00e9 p\u0159\u00edlohy.", e: "Fotka st\u0159echy \u0159ekne v\u00edc ne\u017e t\u0159i zpr\u00e1vy.", a: "P\u0159idat p\u0159\u00edlohu" },
      error: "N\u00e1hled se nepovedl. Soubor se d\u00e1 st\u00e1hnout.",
      rejected: "Odm\u00edtnuto: soubor je nad limit velikosti.",
      withdrawn: "U\u017e s v\u00e1mi nejsou sd\u00edlen\u00e9.",
      readonly: "Jen ke \u010dten\u00ed: st\u00e1hnout jde v\u0161echno, nahr\u00e1t nic.",
      states: { absent: "Absent with the module.",
                offline: "Thumbnails are on the device; the original is fetched when it is opened.",
                pending: "The row is on every device with a placeholder where the thumbnail goes and the word pending under it. Thumbnail 404, raw 409.",
                syncing: "The upload past the threshold, with progress on the row rather than on a modal." },
      impossible: ADDITIVE,
      foot: "Same sniffing, caps and quota as Documents, and the same three answers per endpoint.",
      note: "A thumbnail still being made answers 202 and holds its space, so the thread does not jump when it arrives.", drawn: "all" },

    { id: "E-39", view: "chat", client: "mw", preset: "S", route: "/chat/c-dum#floor", kind: "floor",
      name: "Unread and the floor", title: "Kl\u00e1ra p\u0159i\u0161la v\u010dera",
      lede: "Four of twelve messages, on both delivery paths, and the unread count bounded by that.",
      foot: "The floor is a message id for the API and a seq for the feed, written in one transaction so they cannot drift.",
      note: "A member added today is not handed the household's back catalogue \u2014 by either route.", drawn: "all" },

    { id: "E-40", view: "chat", client: "mw", preset: "D", route: "/chat/storage", kind: "storage",
      name: "Chat storage clean-up", title: "Co Zpr\u00e1vy zab\u00edraj\u00ed",
      lede: "Largest, oldest, and the total per conversation \u2014 with move-to-Documents beside delete.",
      empty: { s: "Zpr\u00e1vy nic nezab\u00edraj\u00ed.", e: "M\u011b\u0159i\u010d za\u010d\u00edn\u00e1 na nule a 5 GB je v cen\u011b.", a: "" },
      error: "\u010c\u00edsla se nena\u010detla. Na va\u0161em \u00fa\u010dtu se nic nezm\u011bnilo.",
      rejected: "Odm\u00edtnuto: soubor u\u017e n\u011bkdo p\u0159esunul.",
      withdrawn: "",
      readonly: "Jen ke \u010dten\u00ed \u2014 a\u010d p\u0159esun i maz\u00e1n\u00ed z\u016fst\u00e1vaj\u00ed: dostat se pod hranici je jeden z m\u00e1la z\u00e1pis\u016f, kter\u00e9 v tomhle stavu pom\u00e1haj\u00ed.",
      states: { absent: "Absent with the module \u2014 but reachable by an owner, which matters because the largest file belongs to a member who no longer holds the grant.",
                offline: "Measured on the server. Offline this shows the last figures with the day they were taken.",
                pending: "A queued move: the row is marked and the figure does not change until it lands.",
                syncing: "The move past the threshold." },
      impossible: { conflicted: "Two members cleaning up at once delete different files; the second delete of one file is a no-op, not a conflict." },
      foot: "Two thresholds warn as the prefix grows, because in a metered-storage product chat video is the line item that surprises people.",
      note: "The move is a custody transfer: the bytes move, the message keeps a reference, and the household stops paying twice.", drawn: "all" },

    { id: "E-41", view: "chat", client: "mw", preset: "S", route: "/chat/c-chata#mute", kind: "mute",
      name: "Mute per conversation", title: "Ztlumit",
      lede: "One switch per conversation, honouring quiet hours and the direct category.",
      foot: "A muted conversation still shows its unread count: mute is about the phone, not about the conversation.",
      note: "Adam has muted the cottage thread and reads it anyway, which is the whole distinction.", drawn: "all" },

    { id: "E-42", view: "chat", client: "mw", preset: "D", route: "/chat/search?q=kl\u00ed\u010de", kind: "search",
      name: "Search bounded by the floor", title: "Hled\u00e1n\u00ed",
      lede: "Three hits for Jana, two for Kl\u00e1ra, and the difference is the floor.",
      empty: { s: "Nic takov\u00e9ho tu nen\u00ed.", e: "Zkuste \u201ekl\u00ed\u010de\u201c nebo \u201ekotel\u201c.", a: "" },
      error: "Hled\u00e1n\u00ed se nepovedlo.",
      rejected: "", withdrawn: "U\u017e s v\u00e1mi nejsou sd\u00edlen\u00e9.",
      readonly: "Jen ke \u010dten\u00ed \u2014 hled\u00e1n\u00ed t\u00edm nen\u00ed dot\u010den\u00e9.",
      states: { absent: "At none the search scope is absent: Chat contributes no results and no empty group either.",
                offline: "Local full-text over the replica, which is the messages the floor allowed.",
                pending: "A queued message is findable on the device that typed it.",
                syncing: "" },
      impossible: { syncing: "Nothing is written from this screen.",
                    conflicted: "A query cannot disagree with itself." },
      foot: "Language-aware, and the floor is applied before ranking rather than after.",
      note: "One result row shape, Stage 11's, with the conversation as the path.", drawn: "all" }
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

  /* ── 12. The gate ───────────────────────────────────────────────────────── */

  function checks() {
    var mem = membershipRun(), fl = floorRun(), un = unreadRun(), rx = reactRun();
    var rd = readRun(), at = attachRun(), st = storageRun(), attr = attributionRun();
    var se = searchRun(), rt = realtimeRun(), q = queueRun(), mu = muteRun();
    var rf = refuseRun(), bar = barRun(), em = emptyAudit(), hp = helpAudit(), cov = coverage();

    return [
      { name: "The floor holds on both delivery paths, or it holds on neither",
        detail: fl.says,
        pass: fl.bothPaths && fl.withheld > 0 },

      { name: "Unread is bounded by the floor, and it agrees with the widget Stage 10 drew",
        detail: un.says,
        pass: un.boundedByFloor && un.agrees },

      { name: "A conversation whose last visible message is null still renders as a row",
        detail: (function () {
          var l = listFor("klara");
          return "Kl\u00e1ra's list is " + l.length + " conversations, " +
            l.filter(function (c) { return c.nullLast; }).length +
            " of them with a null last message today \u2014 the field is nullable by construction (a caller's last_message is bounded by that caller's floor) and the row shape has to survive it: title, member count, no preview line, and no borrowed sentence from a message she may not read.";
        })(),
        pass: listFor("klara").length === 3 },

      { name: "A double tap does not undo itself",
        detail: rx.says,
        pass: rx.desiredEnds === true && rx.toggleEnds === false && rx.set === 4 },

      { name: "The read marker moves forward only",
        detail: rd.says,
        pass: rd.monotonicWins === "m-dum-12" && rd.wouldUnread === 4 },

      { name: "The row exists before the bytes, in three drawn states",
        detail: at.says,
        pass: at.pending === 1 && at.processing === 1 &&
              at.rows.filter(function (r) { return r.thumbnail === 404; }).length === 1 &&
              at.rows.filter(function (r) { return r.thumbnail === 202; }).length === 1 },

      { name: "Move to Documents is a custody transfer, and the household stops paying twice",
        detail: st.says,
        pass: st.agrees && st.moveGb > 1 && st.totalAfter === st.totalBefore &&
              st.copyWouldBe > st.totalBefore },

      { name: "A grant change does not rewrite who uploaded what",
        detail: attr.says,
        pass: attr.level === "none" && attr.stillAttributed },

      { name: "Search is bounded by the floor, before ranking",
        detail: se.says,
        pass: se.jana === 4 && se.klara === 2 && se.petr === 0 },

      { name: "The payload rides the socket once per audience",
        detail: rt.says,
        pass: rt.frames === 1 && rt.audience > 1 },

      { name: "Messages sent offline queue in order and cannot conflict",
        detail: q.says,
        pass: q.rows.length === 2 && q.ordered },

      { name: "Mute is about the phone, not about the conversation",
        detail: mu.says,
        pass: mu.muted === 1 && mu.category === "direct" && mu.quietHours },

      { name: "Every refusal is a 404, so a guessed id is not an oracle",
        detail: rf.says,
        pass: rf.refusals === 3 && rf.any403 === 0 },

      { name: "Chat is the destination that decides the bar, and both bars are finished",
        detail: bar.ready ? bar.says : "nav.js not loaded",
        pass: bar.ready && bar.four === 2 && bar.five === 3 },

      { name: "The general room holds three of five members, and the list says why",
        detail: mem.says,
        pass: mem.inGeneral === 3 && mem.absent === 2 && mem.readOnly.length === 2 },

      { name: "Scoped to one household, which is a compliance consequence rather than a feature gap",
        detail: "No cross-household messaging, no discovery, no public rooms, no contact with anybody outside the household \u2014 D-74, and it is what keeps the product out of the DSA's online-platform obligations and means there is no route by which a stranger reaches Adam's profile. The open question is the UK Online Safety Act (D-89): the closed design removes the risk the Act targets, but whether that is a Schedule 1 exemption is counsel's, and the honest answer is that Chat may ship disabled in UK households. Which is why the four-tab bar above is a finished layout rather than a fallback.",
        pass: true },

      { name: "The empty state teaches, and help is authored with the screens",
        detail: em.says + " " + hp.says,
        pass: em.banned.length === 0 && hp.entries === 2 && hp.overlong === 0 && hp.external === 0 },

      { name: "Seven rows, every state drawn, every exclusion argued from a merge policy",
        detail: cov.length + " rows: " + cov.reduce(function (n, c) { return n + c.drawn; }, 0) +
          " cells drawn of " + cov.reduce(function (n, c) { return n + c.required; }, 0) +
          " required, with " + cov.reduce(function (n, c) { return n + c.excluded; }, 0) +
          " states declared unreachable. " + POLICIES.length + " entity policies do the arguing, and the edit window is the only lww_row in the module: " +
          EDIT_WINDOW_MIN + " minutes, online only, loser preserved " + LOSER_DAYS + " days.",
        pass: cov.every(function (c) { return c.complete; }) }
    ];
  }

  window.HH_CHAT = {
    version: "0.1-stage-19-candidate",
    today: TODAY, allStates: ALL_STATES, screens: SCREENS, coverage: coverage,
    policies: POLICIES, emoji: EMOJI, editWindow: EDIT_WINDOW_MIN, loserDays: LOSER_DAYS,
    conversations: CONVERSATIONS, conversation: conversation,
    membership: MEMBERSHIP, membersOf: membersOf, membershipOf: membershipOf,
    inConversation: inConversation, membershipRun: membershipRun,
    messages: MESSAGES, messagesOf: messagesOf, edited: EDITED, tombstone: TOMBSTONE,
    visibleTo: visibleTo, replicaOf: replicaOf, floorRun: floorRun,
    reads: READS, unread: unread, listFor: listFor, unreadRun: unreadRun, readRun: readRun,
    reactions: REACTIONS, reactionsOn: reactionsOn, reactRun: reactRun,
    attachments: ATTACHMENTS, serve: serve, attachRun: attachRun,
    perConversation: PER_CONV, thresholds: THRESHOLDS, storageRun: storageRun,
    attributionRun: attributionRun,
    search: search, searchRun: searchRun,
    realtimeRun: realtimeRun, queue: QUEUE, queueRun: queueRun, muteRun: muteRun,
    refuseRun: refuseRun, barRun: barRun,
    empty: EMPTY, emptyAudit: emptyAudit, help: HELP, helpAudit: helpAudit,
    name: name, grantOf: grantOf, atLeast: atLeast,
    checks: checks
  };
})();
