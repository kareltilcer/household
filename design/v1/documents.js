/* Stage 13 — Documents: the household's file store, and the meter it feeds.

   Built from docs/prd/modules/08-documents.md (FR-DO1-12, the data model, the sync table,
   Catalog contributions), design/05-screens.md §C Documents, 03-patterns.md §1 (attachments
   before their bytes), §5 (destructive actions), §11 (a file lives in Documents),
   02-components.md §4.10 (the document reference), 04-billing FR-BI3 by way of household.js.

   What is computed here rather than asserted:

   1. Serving. FR-DO5's four endpoints against every content type in the fixture, including
      the two states that are easy to forget — 409 while a derived preview is pending, and
      the active types, which are download-only and never rendered in the app's origin.

   2. The bytes and the row are separate things. §2.7's offline upload is run as a four-step
      timeline across two devices, because "the row exists before the bytes" is this stage's
      gate and a sentence is not a demonstration.

   3. The meter. Originals, derived variants, the split by folder, member and type, and what
      deleting a selection would actually recover — arithmetic on the same 38 documents the
      household storage screen counts, so the two screens cannot drift.

   4. The type table. FR-DO7 makes the reminder lead time a property of the document type and
      states two of them; the rest are derived from one question — how long it takes to
      replace the thing — and reminders.js reads this table rather than holding its own.
*/
(function () {

  var TODAY = "2026-09-09";
  var MB = 1, GB = 1024;

  function D(s) { return new Date(s + "T00:00:00Z"); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function addDays(s, n) { var t = D(s); t.setUTCDate(t.getUTCDate() + n); return iso(t); }
  function diff(a, b) { return Math.round((D(a) - D(b)) / 86400000); }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
  function fmt(s) { var t = D(s); return t.getUTCDate() + " " + MONTHS[t.getUTCMonth()] + " " + t.getUTCFullYear(); }
  function mb(n) { return n >= 1024 ? (n / 1024).toFixed(2) + " GB" : n >= 10 ? Math.round(n) + " MB" : n.toFixed(1) + " MB"; }

  function member(id) {
    var F = window.HH_FIXTURES;
    return (F ? F.members : []).filter(function (m) { return m.id === id; })[0] || null;
  }
  function grantOf(id) { var m = member(id); return m ? (m.grants.documents || "none") : "none"; }
  function atLeast(level, want) {
    var L = ["none", "view", "contribute", "manage"];
    return L.indexOf(level) >= L.indexOf(want);
  }
  function firstName(id) { var m = member(id); return m ? m.name : id; }

  /* ── 1. The type catalog (FR-DO7, D-53) ───────────────────────────────────
     Eleven types, translated and country-aware — the CZ column is the word printed on the
     thing itself, which is what a member is looking at while they file it. Two lead times
     are stated in the requirement (a passport at six months, an insurance policy at one).
     The other nine come from the same question: how long does it take to replace it?
     Completion scope is the type's, not the reminder's: a passport belongs to a person, a
     lease belongs to the household. */

  var TYPES = [
    { id: "passport", en: "Passport", cs: "Cestovn\u00ed pas", lead: 180, scope: "personal",
      why: "Stated in FR-DO7. Six months is an appointment, a queue and a photograph.", stated: true },
    { id: "id_card", en: "ID card", cs: "Ob\u010dansk\u00fd pr\u016fkaz", lead: 90, scope: "personal",
      why: "Same errand, shorter queue \u2014 a municipal office rather than a passport office." },
    { id: "driving_licence", en: "Driving licence", cs: "\u0158idi\u010dsk\u00fd pr\u016fkaz", lead: 90, scope: "personal",
      why: "A medical check for older holders is the long pole, and it is bookable inside three months." },
    { id: "insurance_policy", en: "Insurance policy", cs: "Pojistn\u00e1 smlouva", lead: 30, scope: "shared",
      why: "Stated in FR-DO7. One phone call, or one comparison site evening.", stated: true },
    { id: "lease", en: "Lease", cs: "N\u00e1jemn\u00ed smlouva", lead: 90, scope: "shared",
      why: "The notice period is the deadline, not the end date, and three months is the common Czech term." },
    { id: "warranty", en: "Warranty", cs: "Z\u00e1ru\u010dn\u00ed list", lead: 30, scope: "shared",
      why: "A month is enough to make the claim that the expiry is about to make impossible." },
    { id: "certificate", en: "Certificate", cs: "Revizn\u00ed zpr\u00e1va", lead: 30, scope: "shared",
      why: "An inspection is booked in weeks, and the certificate is worthless the day after it lapses." },
    { id: "invoice", en: "Invoice", cs: "Faktura", lead: null, scope: "shared",
      why: "An invoice does not expire. The type exists for filing and search, and it never registers a reminder." },
    { id: "contract", en: "Contract", cs: "Smlouva", lead: 90, scope: "shared",
      why: "A supply or service contract renews on notice, and the notice is usually three months (10-utilities)." },
    { id: "medical", en: "Medical", cs: "L\u00e9ka\u0159sk\u00e1 zpr\u00e1va", lead: 30, scope: "personal",
      why: "Personal, always: it belongs to the member it is about, whatever root it sits in." },
    { id: "other", en: "Other", cs: "Ostatn\u00ed", lead: 30, scope: "shared",
      why: "The fallback. A month is the least surprising default for a thing nobody has classified." }
  ];
  function typeOf(id) { return TYPES.filter(function (t) { return t.id === id; })[0] || null; }

  /* Stage 23 \u2014 the country-aware half, which FR-DO7 asks for and names nowhere.
     The catalog is one table with a column per country: the word printed on the
     thing, and a lead override where the errand itself is different in that
     country. Two columns are written \u2014 CZ, the fixture's own, and DE, because it
     is the one the sweep's length test runs against \u2014 which is enough to fix the
     shape: a country column is a word and an optional number, never a new type.
     The other markets are the same fourteen keys in front of a translator. */
  var COUNTRY = {
    cz: { label: "\u010cesko", words: {}, leads: {} },
    de: {
      label: "Deutschland",
      words: {
        passport: "Reisepass", id_card: "Personalausweis", driving_licence: "F\u00fchrerschein",
        insurance_policy: "Versicherungspolice", lease: "Mietvertrag", warranty: "Garantieschein",
        certificate: "Pr\u00fcfbericht", invoice: "Rechnung", contract: "Vertrag",
        medical: "Arztbericht", other: "Sonstiges"
      },
      /* the two errands that genuinely differ: a Personalausweis is issued faster
         than a Czech ob\u010dansk\u00fd pr\u016fkaz, and a German Mietvertrag runs on a
         three-month notice like the Czech one, so only the first moves */
      leads: { id_card: 60 }
    }
  };
  /* cz words are the table's own cs column rather than a copy of it */
  TYPES.forEach(function (t) { COUNTRY.cz.words[t.id] = t.cs; });

  function typeIn(id, country) {
    var t = typeOf(id);
    if (!t) return null;
    var c = COUNTRY[country] || COUNTRY.cz;
    return { id: t.id, en: t.en, word: c.words[t.id] || t.en,
             lead: (c.leads[t.id] !== undefined ? c.leads[t.id] : t.lead),
             scope: t.scope, overridden: c.leads[t.id] !== undefined };
  }

  /* The strand reads this table (03-platform-strands FR-RM1, reminders.js ENTITY_LEAD). */
  function strandHandshake() {
    var R = window.HH_REMINDERS;
    var strand = R && R.entityLead && R.entityLead["documents.expiry"];
    var pass = typeOf("passport");
    return {
      strandDays: strand ? strand.days : null,
      tableDays: pass.lead,
      agree: !!strand && strand.days === pass.lead,
      kinds: R ? R.allKinds.filter(function (k) { return k.module === "documents"; }).length : 0,
      leads: TYPES.filter(function (t) { return t.lead !== null; }).length,
      presets: R ? TYPES.filter(function (t) {
        return t.lead !== null && R.leadSet.some(function (l) { return l[1] === t.lead; });
      }).length : 0
    };
  }

  /* ── 2. The 38 documents ──────────────────────────────────────────────────
     [id, title, folder, uploader, root, declared content type, MB, type, expires]
     `declared` is what the client sent. FR-DO1 sniffs the leading bytes instead, and one
     row in this fixture is the reason that sentence is in the requirement. */

  var FOLDERS = [
    { id: "byt", name: "Byt", root: "shared" },
    { id: "smlouvy", name: "Smlouvy", root: "shared" },
    { id: "faktury", name: "Faktury", root: "shared" },
    { id: "auto", name: "Auto", root: "shared" },
    { id: "doklady", name: "Doklady", root: "shared" },
    { id: "chata", name: "Chata", root: "shared" },
    { id: "zdravi", name: "Zdrav\u00ed", root: "private:jana" },
    { id: "adam-zdravi", name: "Zdrav\u00ed", root: "private:adam" }
  ];

  var RAW = [
    ["d-inventura", "Pojistn\u00e1 inventura bytu \u2014 sken.pdf", "byt", "jana", "shared", "application/pdf", 409.6, "other", null],
    ["d-kupni", "Kupn\u00ed smlouva byt \u2014 sken.pdf", "smlouvy", "jana", "shared", "application/pdf", 402, "contract", null],
    ["d-stavebni", "Stavebn\u00ed dokumentace domu.pdf", "byt", "jana", "shared", "application/pdf", 398, "other", null],
    ["d-zdravi-jana", "Zdravotn\u00ed dokumentace \u2014 Jana.pdf", "zdravi", "jana", "private:jana", "application/pdf", 336, "medical", null],
    ["d-foto-byt", "Fotodokumentace bytu 2025.pdf", "byt", "jana", "shared", "application/pdf", 396, "other", null],
    ["d-archiv", "Rodinn\u00fd archiv \u2014 listiny.pdf", "byt", "jana", "shared", "application/pdf", 392, "other", null],
    ["d-revize", "Revizn\u00ed zpr\u00e1vy 2019\u20132025.pdf", "byt", "jana", "shared", "application/pdf", 368, "certificate", "2027-05-31"],
    ["d-pudorysy", "P\u016fdorysy a pl\u00e1ny chaty.pdf", "chata", "milos", "shared", "application/pdf", 352, "other", null],
    ["d-zaruky", "Z\u00e1ru\u010dn\u00ed listy \u2014 spot\u0159ebi\u010de.pdf", "byt", "jana", "shared", "application/pdf", 324, "warranty", "2026-11-30"],
    ["d-ucto-24", "\u00da\u010detnictv\u00ed 2024 \u2014 sken.pdf", "faktury", "jana", "shared", "application/pdf", 318, "invoice", null],
    ["d-ucto-25", "\u00da\u010detnictv\u00ed 2025 \u2014 sken.pdf", "faktury", "jana", "shared", "application/pdf", 332, "invoice", null],
    ["d-zdravi-adam", "Zdravotn\u00ed dokumentace \u2014 Adam.pdf", "adam-zdravi", "jana", "private:adam", "application/pdf", 278.6, "medical", null],
    ["d-servisni-kniha", "Servisn\u00ed kniha \u0160koda \u2014 sken.pdf", "auto", "jana", "shared", "application/pdf", 268, "other", null],
    ["d-najem-chata", "N\u00e1jemn\u00ed smlouva chata.pdf", "chata", "jana", "shared", "application/pdf", 248, "lease", "2027-06-30"],
    ["d-pojistka-byt", "Pojistn\u00e1 smlouva byt.pdf", "smlouvy", "jana", "shared", "application/pdf", 236, "insurance_policy", "2027-02-28"],
    ["d-hypoteka", "Hypot\u00e9ka \u2014 smluvn\u00ed dokumentace.pdf", "smlouvy", "jana", "shared", "application/pdf", 296, "contract", null],
    ["d-pas-jana", "Cestovn\u00ed pas \u2014 Jana.pdf", "doklady", "jana", "shared", "application/pdf", 6.4, "passport", "2027-01-20"],
    ["d-pas-petr", "Cestovn\u00ed pas \u2014 Petr.pdf", "doklady", "jana", "shared", "application/pdf", 6.1, "passport", "2029-05-11"],
    ["d-op-jana", "Ob\u010dansk\u00fd pr\u016fkaz \u2014 Jana.pdf", "doklady", "jana", "shared", "application/pdf", 3.2, "id_card", "2031-03-02"],
    ["d-rp-jana", "\u0158idi\u010dsk\u00fd pr\u016fkaz \u2014 Jana.pdf", "doklady", "jana", "shared", "application/pdf", 3.0, "driving_licence", "2028-06-30"],
    ["d-pojistka-auto", "Pojistka auta 2026.pdf", "auto", "jana", "shared", "application/pdf", 2.4, "insurance_policy", "2026-09-28"],
    ["d-servis-skoda", "Servisn\u00ed faktura \u0160koda 2026-03.pdf", "auto", "jana", "shared", "application/pdf", 1.8, "invoice", null],
    ["d-navod-mycka", "N\u00e1vod my\u010dka Bosch.pdf", "byt", "jana", "shared", "application/pdf", 28.6, "other", null],
    ["d-navod-kotel", "N\u00e1vod kotel Vaillant.pdf", "byt", "jana", "shared", "application/pdf", 32.4, "other", null],
    ["d-bruno", "O\u010dkovac\u00ed pr\u016fkaz Bruno.pdf", "doklady", "jana", "shared", "application/pdf", 4.2, "medical", "2027-04-18"],
    ["d-cez", "Smlouva \u010cEZ \u2014 elekt\u0159ina.pdf", "smlouvy", "jana", "shared", "application/pdf", 1.9, "contract", "2027-03-31"],
    ["d-gasnet", "Smlouva GasNet \u2014 plyn.pdf", "smlouvy", "jana", "shared", "application/pdf", 1.7, "contract", "2027-09-30"],
    ["d-fak-06", "Faktura \u010cEZ 2026-06.pdf", "faktury", "jana", "shared", "application/pdf", 0.4, "invoice", null],
    ["d-fak-07", "Faktura \u010cEZ 2026-07.pdf", "faktury", "jana", "shared", "application/pdf", 0.4, "invoice", null],
    ["d-fak-08", "Faktura \u010cEZ 2026-08.pdf", "faktury", "jana", "shared", "application/pdf", 0.4, "invoice", null],
    ["d-vysvedceni", "Vysv\u011bd\u010den\u00ed \u2014 Adam 2026.pdf", "doklady", "jana", "shared", "application/pdf", 2.8, "other", null],
    ["d-pudorys-svg", "P\u016fdorys bytu.svg", "byt", "milos", "shared", "image/png", 0.6, "other", null],
    ["d-rozpocet", "Rozpo\u010det rekonstrukce.xlsx", "byt", "jana", "shared", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 1.4, "other", null],
    ["d-okna", "Smlouva o d\u00edlo \u2014 okna.docx", "smlouvy", "jana", "shared", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 0.8, "contract", null],
    ["d-svj", "Z\u00e1pis ze sch\u016fze SVJ 2026-05.docx", "byt", "jana", "shared", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 0.5, "other", null],
    ["d-bourka", "Fotky \u0161kody po bou\u0159ce.zip", "byt", "milos", "shared", "application/zip", 392, "other", null],
    ["d-prohlidka", "Chata \u2014 prohl\u00eddka pro poji\u0161\u0165ovnu.mp4", "chata", "milos", "shared", "video/mp4", 398, "other", null],
    ["d-uctenka", "\u00da\u010dtenka \u2014 parkovi\u0161t\u011b Kaufland.jpg", "faktury", "jana", "shared", "image/jpeg", 3.2, "invoice", null]
  ];

  /* FR-DO1: the content type is sniffed from the leading bytes, never taken from the
     client's header. One upload in this fixture disagrees, and it is the dangerous one. */
  var SNIFFED = { "d-pudorys-svg": "image/svg+xml" };

  /* §2.7: the row syncs immediately; the bytes follow. */
  var PENDING = { "d-uctenka": { since: "2026-09-09 07:12", device: "Jana \u00b7 phone",
                                 where: "held in the app sandbox until there is signal" } };
  /* FR-DO6: a conversion may fail. The upload is never lost. */
  var PREVIEW_FAILED = { "d-rozpocet": "The spreadsheet took longer than the conversion budget. The file itself is untouched and downloads normally." };

  var ACTIVE = ["image/svg+xml", "text/html", "application/xhtml+xml"];
  var NATIVE = ["application/pdf", "image/jpeg", "image/png", "text/plain"];
  var OFFICE = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];

  function build() {
    return RAW.map(function (r) {
      var declared = r[5], sniffed = SNIFFED[r[0]] || declared;
      var active = ACTIVE.indexOf(sniffed) >= 0;
      var kind = active ? "active"
        : NATIVE.indexOf(sniffed) >= 0 ? "native"
        : OFFICE.indexOf(sniffed) >= 0 ? "derived" : "none";
      var pending = !!PENDING[r[0]];
      var failed = !!PREVIEW_FAILED[r[0]];
      var d = {
        id: r[0], title: r[1], folder: r[2], by: r[3], root: r[4],
        declared: declared, ct: sniffed, sniffMismatch: declared !== sniffed,
        bytes: r[6], type: r[7], expires: r[8],
        attachment: pending ? "pending" : "ready",
        previewKind: kind,
        previewStatus: pending ? "pending" : failed ? "failed" : kind === "none" || kind === "active" ? "none" : "ready",
        checksum: "sha256:" + r[0].replace(/[^a-z0-9]/g, "").slice(0, 12),
        key: "h/tilcerovi/documents/" + r[0] + "/original"
      };
      d.derived = derivedFor(d);
      return d;
    });
  }

  /* FR-DO6: derived variants are generated once and cached forever, and they count. */
  function derivedFor(d) {
    if (d.attachment === "pending" || d.previewKind === "active" || d.previewKind === "none") return 0;
    if (d.previewStatus === "failed") return 0;
    var out = 0.25;                                     /* the thumbnail */
    if (d.ct === "application/pdf" && d.bytes > 32) out += d.bytes * 0.12;   /* a web-sized re-render */
    if (d.previewKind === "derived") out += d.bytes * 1.4;                   /* the preview PDF */
    return Math.round(out * 10) / 10;
  }

  var DOCS = build();
  function docOf(id) { return DOCS.filter(function (d) { return d.id === id; })[0] || null; }
  function folderOf(id) { return FOLDERS.filter(function (f) { return f.id === id; })[0] || null; }

  /* ── 3. Roots and who may see what (FR-DO3, identical to Notes) ─────────── */

  function rootsFor(viewerId) {
    var N = window.HH_NOTES;
    if (!atLeast(grantOf(viewerId), "view")) return [];
    if (!N) return [{ id: "shared", label: "Shared" }];
    var viewer = member(viewerId);
    return N.rootScopes().filter(function (r) {
      if (r.visibility === "shared") return true;
      if (r.owner === viewerId) return true;
      var owner = member(r.owner);
      return !!(owner && owner.role === "child" && viewer.role === "owner" &&
                atLeast(grantOf(r.owner), "view"));
    }).map(function (r) {
      return { id: r.id, label: r.visibility === "shared" ? "Shared"
                 : r.owner === viewerId ? "Just mine" : firstName(r.owner) + "\u2019s",
               empty: DOCS.filter(function (d) { return d.root === r.id; }).length === 0 };
    });
  }

  function visibleTo(viewerId) {
    var roots = rootsFor(viewerId).map(function (r) { return r.id; });
    return DOCS.filter(function (d) { return roots.indexOf(d.root) >= 0; });
  }

  /* ── 4. Serving (FR-DO5) ──────────────────────────────────────────────────
     Four endpoints, each authorising the caller and then either streaming through or
     issuing a short-lived pre-signed URL. The interesting cells are the refusals. */

  var ENDPOINTS = ["raw", "download", "preview", "thumbnail"];

  function serve(doc, endpoint) {
    if (doc.attachment === "pending") {
      return endpoint === "thumbnail"
        ? { status: 404, says: "no thumbnail yet", note: "The row exists; the bytes do not." }
        : { status: 409, says: "bytes not uploaded", note: "Queued on the device that made it. The row is already here on every other device." };
    }
    if (endpoint === "raw") {
      return doc.previewKind === "active"
        ? { status: 200, says: "bytes, nosniff, never embedded", note: "Served, but never rendered in the app\u2019s origin \u2014 the app links to it as a download instead." }
        : { status: 200, says: "bytes \u00b7 ETag = checksum", note: "immutable, Range supported" };
    }
    if (endpoint === "download") return { status: 200, says: "attachment", note: "Content-Disposition: attachment, always." };
    if (endpoint === "preview") {
      if (doc.previewKind === "active") return { status: 404, says: "no preview for this type", note: "Active types are download-only (D48)." };
      if (doc.previewKind === "none") return { status: 404, says: "no preview for this type", note: "Nothing to render, and no conversion is attempted." };
      if (doc.previewStatus === "pending") return { status: 409, says: "still converting", note: "The derived variant is generated once, after commit." };
      if (doc.previewStatus === "failed") return { status: 404, says: "conversion failed", note: PREVIEW_FAILED[doc.id] };
      return { status: 200, says: doc.previewKind === "native" ? "the original" : "a derived PDF", note: "sandboxed viewer for PDFs, <img> for images" };
    }
    if (doc.previewKind === "active" || doc.previewKind === "none" || doc.previewStatus === "failed")
      return { status: 404, says: "no thumbnail", note: "" };
    return { status: 200, says: "a small image", note: "" };
  }

  function serveMatrix() {
    var pick = ["d-inventura", "d-uctenka", "d-rozpocet", "d-okna", "d-pudorys-svg", "d-bourka", "d-prohlidka"];
    return pick.map(function (id) {
      var d = docOf(id);
      return { id: id, title: d.title, ct: d.ct, kind: d.previewKind,
               cells: ENDPOINTS.map(function (e) {
                 var r = serve(d, e);
                 return { endpoint: e, status: r.status, says: r.says, note: r.note };
               }) };
    });
  }

  function isolation() {
    return [
      { rule: "X-Content-Type-Options: nosniff", where: "every content route", why: "The browser may not decide a type we already decided." },
      { rule: "PDFs render in a sandboxed viewer", where: "preview", why: "A PDF is a program. It renders where it cannot reach the session." },
      { rule: "Images render through <img>", where: "preview, thumbnail", why: "No object, no embed, no iframe of a household file." },
      { rule: "Active types are download-only", where: "SVG, HTML, anything scriptable", why: "Rendering one in the app\u2019s origin hands it the session. Carried from home D48." },
      { rule: "Text is escaped", where: "preview", why: "A text preview is text, not markup." }
    ];
  }

  /* ── 5. The row before the bytes (§2.7, and this stage's gate) ──────────── */

  function uploadTimeline() {
    var d = docOf("d-uctenka");
    return [
      { step: "In the car park", offline: true,
        phone: "The row is written locally with its own id, title and type. The photo sits in the app sandbox.",
        tablet: "Nothing yet.", status: "local" },
      { step: "The metadata syncs", offline: true,
        phone: "attachment_status: pending. The row is in the feed; the bytes are not.",
        tablet: "The row appears, with a placeholder where the thumbnail will be and the word pending under it.",
        status: "pending" },
      { step: "Milo\u0161 opens it on the tablet", offline: true,
        phone: "\u2014",
        tablet: "Title, folder, type and who uploaded it, all readable. Preview and download return 409 in words: the bytes have not arrived.",
        status: "pending" },
      { step: "Signal, and the bytes go", offline: false,
        phone: "The upload completes and the mark disappears \u2014 synced is the absence of a mark.",
        tablet: "The thumbnail replaces the placeholder without the row moving.",
        status: "ready" }
    ].map(function (s) {
      return Object.assign({}, s, {
        rowExists: s.status !== "local",
        bytesExist: s.status === "ready",
        serves: s.status === "pending" ? serve(d, "preview").status : s.status === "ready" ? 200 : null
      });
    });
  }

  /* ── 6. Expiry (FR-DO7) ───────────────────────────────────────────────────
     A document with an expiry registers with the strand as documents.expiry. The lead is
     the type's; the completion scope is the type's; the reminder itself is Reminders'. */

  function expiryRows(day) {
    day = day || TODAY;
    return DOCS.filter(function (d) { return d.expires; }).map(function (d) {
      var t = typeOf(d.type);
      var lead = t.lead === null ? null : t.lead;
      var opens = lead === null ? null : addDays(d.expires, -lead);
      return {
        id: d.id, title: d.title, type: t.en, cs: t.cs, expires: d.expires,
        days: diff(d.expires, day), lead: lead, opens: opens, scope: t.scope,
        inWindow: opens !== null && opens <= day && d.expires >= day,
        registers: lead !== null
      };
    }).sort(function (a, b) { return a.expires < b.expires ? -1 : 1; });
  }

  function expiringFor(viewerId, day) {
    var ids = visibleTo(viewerId).map(function (d) { return d.id; });
    return expiryRows(day).filter(function (r) { return r.inWindow && ids.indexOf(r.id) >= 0; });
  }

  /* ── 7. References (FR-DO9, FR-DO12, D-40) ────────────────────────────────
     The reverse index of which module rows point at a document. It is what makes the
     delete warning able to say "this is the service invoice on your Škoda". */

  var REFERENCES = [
    { doc: "d-servis-skoda", module: "vehicles", entity: "\u0160koda Octavia", what: "the service record for 12 March", says: "this is the service invoice on your \u0160koda" },
    { doc: "d-pojistka-byt", module: "property", entity: "Byt Kr\u00e1le Ji\u0159\u00edho", what: "the insurance on the flat", says: "the flat\u2019s insurance policy is this file" },
    { doc: "d-pojistka-byt", module: "finance", entity: "Poji\u0161t\u011bn\u00ed bytu", what: "the recurring payment", says: "the recurring payment in Finance points here too" },
    { doc: "d-navod-mycka", module: "property", entity: "My\u010dka Bosch", what: "the appliance manual", says: "this is the manual on the dishwasher" },
    { doc: "d-bruno", module: "pets", entity: "Bruno", what: "the vaccination record", says: "this is Bruno\u2019s vaccination record" },
    { doc: "d-cez", module: "utilities", entity: "Elekt\u0159ina \u010cEZ", what: "the supply contract", says: "the electricity service points at this contract" }
  ];

  function referencesTo(id) { return REFERENCES.filter(function (r) { return r.doc === id; }); }

  /* The component the referring module draws (02-components §4.10) has a state it cannot
     predict, because the platform applies the caller's grant to the reference. */
  function referenceFor(docId, viewerId) {
    var d = docOf(docId);
    var can = atLeast(grantOf(viewerId), "view");
    var visible = can && visibleTo(viewerId).some(function (x) { return x.id === docId; });
    if (visible) return { state: "resolved", title: d.title, size: mb(d.bytes),
                          says: "Opens in the preview overlay. The referring module never read the documents tables." };
    if (!can) return { state: "no-grant", title: null,
                       says: "A document is attached here. You do not have Documents, so it is named as existing and nothing more." };
    return { state: "not-visible", title: null,
             says: "A document is attached here and it is not visible to you." };
  }

  /* ── 8. Bulk operations (FR-DO11) ────────────────────────────────────────── */

  function selection(ids) {
    var docs = ids.map(docOf).filter(Boolean);
    var refs = [];
    docs.forEach(function (d) { refs = refs.concat(referencesTo(d.id)); });
    var pending = docs.filter(function (d) { return d.attachment === "pending"; });
    return {
      ids: ids, docs: docs, count: docs.length,
      bytes: docs.reduce(function (a, d) { return a + d.bytes; }, 0),
      derived: docs.reduce(function (a, d) { return a + d.derived; }, 0),
      references: refs, referenced: docs.filter(function (d) { return referencesTo(d.id).length; }),
      pending: pending,
      zip: {
        included: docs.length - pending.length, skipped: pending.length,
        says: pending.length
          ? pending.length + " file has not finished uploading and is left out of the zip, by name, with an offer to wait."
          : "Every file in the selection has its bytes."
      },
      recovers: docs.reduce(function (a, d) { return a + d.bytes + d.derived; }, 0)
    };
  }

  function deleteWarning(ids) {
    var s = selection(ids);
    return {
      count: s.count, recovers: s.recovers,
      blocks: false,
      title: s.referenced.length
        ? s.referenced.length + " of these " + s.count + " are used somewhere else"
        : "Delete " + s.count + " files?",
      body: s.references.map(function (r) { return r.says; }),
      confirm: "Delete " + s.count + " \u00b7 recovers " + mb(s.recovers),
      after: "The other modules keep their row and draw \u201cthis document was deleted\u201d where the file was. Nothing silently breaks, and nothing was blocked \u2014 the household\u2019s files are theirs."
    };
  }

  /* ── 9. Storage (FR-DO10) ─────────────────────────────────────────────────
     Arithmetic on the same 38 rows, so this screen and Settings §5 cannot disagree. */

  function totals() {
    var originals = DOCS.reduce(function (a, d) { return a + d.bytes; }, 0);
    var derived = DOCS.reduce(function (a, d) { return a + d.derived; }, 0);
    var N = window.HH_NOTES;
    return {
      count: DOCS.length, originals: originals, derived: derived, total: originals + derived,
      originalsGB: originals / GB, derivedGB: derived / GB,
      overheadPct: (derived / originals) * 100,
      notesGB: N ? N.imageLines().gb : 0
    };
  }

  function splitBy(key) {
    var map = {};
    DOCS.forEach(function (d) {
      var k = key === "folder" ? (folderOf(d.folder) || { name: "\u2014" }).name
            : key === "member" ? firstName(d.by)
            : typeOf(d.type).en;
      map[k] = map[k] || { name: k, n: 0, bytes: 0, derived: 0 };
      map[k].n++; map[k].bytes += d.bytes; map[k].derived += d.derived;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.bytes - a.bytes; });
  }

  function largest(n) {
    return DOCS.slice().sort(function (a, b) { return b.bytes - a.bytes; }).slice(0, n || 6)
      .map(function (d) {
        return { title: d.title, by: firstName(d.by), bytes: d.bytes, derived: d.derived,
                 folder: (folderOf(d.folder) || { name: "" }).name,
                 share: (d.bytes / totals().originals) * 100 };
      });
  }

  /* The household screen's Documents line, recomputed from these rows. */
  function reconcile() {
    var H = window.HH_HOUSEHOLD;
    var line = H ? (H.storage.byModule.filter(function (m) { return m[0] === "Documents"; })[0] || [])[1] : null;
    var t = totals();
    return {
      settings: line, here: t.originalsGB, delta: line === null ? null : Math.abs(line - t.originalsGB),
      agree: line !== null && Math.abs(line - t.originalsGB) < 0.05,
      derivedHousehold: H ? H.storage.derived : null,
      derivedHere: t.derivedGB,
      withinDerived: H ? t.derivedGB < H.storage.derived : false,
      largestHere: largest(1)[0],
      largestSettings: H ? (H.storage.largest.filter(function (l) { return /Documents/.test(l[1]); })[0] || null) : null
    };
  }

  /* ── 10. The screens (05-screens §C Documents — eight rows) ─────────────── */

  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending",
                    "syncing", "conflicted", "rejected", "absent", "withdrawn", "readonly"];

  var SCREENS = [
    { id: "C-28", view: "tree", client: "mw", preset: "D", route: "/documents/shared",
      name: "Documents tree", title: "Documents", kind: "tree",
      lede: "Folders, roots and slug paths \u2014 the same tree Notes has, over files.",
      empty: { s: "No files here yet.", e: "The lease, the boiler manual and last year\u2019s insurance are what most households put in first \u2014 photograph them, they do not have to be scans.", a: "Add a file" },
      error: "Couldn\u2019t load the folder. Files already on this device still open.",
      rejected: "Refused: a folder cannot move into itself. It is still where it was.",
      withdrawn: "Documents is no longer shared with you, so this device dropped the tree and its thumbnails.",
      readonly: "Read-only while the subscription is past due: every file downloads, nothing new goes up.",
      states: {
        offline: "Metadata and thumbnails are on the device. Originals are fetched on demand and cached to a budget the member sets \u2014 so the tree is complete offline and some files are not.",
        pending: "A row whose bytes are still queued, marked in a word and a glyph, in its right place in the tree."
      },
      impossible: {},
      foot: "Bytes are never synced. The replica holds metadata and thumbnails, and the LRU budget is the member\u2019s.",
      note: "Documents and Notes are the same navigation over different payloads, which is the argument for building them in one stage: one tree, one root switcher, one resolver, one 404.",
      drawn: "all" },

    { id: "C-29", view: "upload", client: "mw", preset: "D", route: "/documents/upload",
      name: "Upload, including from the camera", title: "Add a file", kind: "upload",
      lede: "Photograph it, or pick it. The row exists before the bytes do.",
      empty: { s: "Nothing chosen yet.", e: "The camera is the first option on a phone, because most of what a household files is paper.", a: "Take a photo" },
      error: "The upload didn\u2019t start. Nothing was committed \u2014 no half-written row, no orphaned bytes.",
      rejected: "Refused: the household is over its storage ceiling. The file is still on this device and the storage screen says what would recover space.",
      withdrawn: "Documents is no longer shared with you. The queued upload was discarded and the file is still in your camera roll.",
      readonly: "Uploading is held while the subscription is past due. Everything already here downloads.",
      states: {
        pending: "The row syncs immediately with attachment_status: pending; the bytes go when there is signal. This is the state the gate is about.",
        offline: "The whole flow works offline, which is the point \u2014 the receipt is photographed in the car park, not at the desk."
      },
      impossible: {
        conflicted: "Bytes are write-once and an upload is additive. Two uploads are two documents, never two versions of one \u2014 a replacement is a new document, optionally linked as a successor."
      },
      foot: "402 over the ceiling \u00b7 413 over the size cap \u00b7 415 a blocked type \u00b7 422 an empty file \u00b7 502 with nothing committed.",
      note: "The content type is sniffed from the leading bytes. The client\u2019s header is recorded and ignored, and this fixture has one upload where that difference is the whole of the security story.",
      drawn: "all" },

    { id: "C-30", view: "detail", client: "mw", preset: "D", route: "/documents/shared/byt/inventura",
      name: "Document detail \u2014 preview / raw / download", title: "Pojistn\u00e1 inventura bytu", kind: "detail",
      lede: "One file, four endpoints, and the permanent link.",
      empty: { s: "", e: "", a: "" },
      error: "The preview didn\u2019t load. The file is intact \u2014 download gives you the original bytes.",
      rejected: "Refused: that rename collides with another file in this folder.",
      withdrawn: "Documents is no longer shared with you, so this file left the device.",
      readonly: "Read-only: the file downloads, the fields do not save.",
      states: {
        pending: "A metadata edit queued offline. The bytes are untouched \u2014 they always are.",
        loading: "The preview loads behind the thumbnail, so the page does not jump when it arrives."
      },
      impossible: {
        conflicted: "Metadata is lww_field and the bytes are immutable. Two members editing the title and the expiry both succeed; the same field twice resolves to the later client time and says nothing."
      },
      foot: "The content URL is id-based and permanent. The slug path is a convenience and is not.",
      note: "Everything on this screen is session-authorised. There is no public path, no share token and no unauthenticated route \u2014 stated on the screen where a member would look for a share button.",
      drawn: "all" },

    { id: "C-31", view: "active", client: "mw", preset: "S", route: "/documents/shared/byt/pudorys",
      name: "Document detail \u2014 active type, download-only", title: "P\u016fdorys bytu.svg", kind: "active",
      lede: "This one is never rendered here.",
      empty: { s: "", e: "", a: "" }, error: "", rejected: "", withdrawn: "", readonly: "",
      impossible: {},
      foot: "Uploaded as image/png; the leading bytes say SVG. The sniffed type is what the product acts on.",
      note: "The state exists because the honest answer is a sentence, not a broken preview pane: it is a drawing, it can contain script, and it opens outside the app.",
      drawn: "all" },

    { id: "C-32", view: "expiry", client: "mw", preset: "D", route: "/documents/shared/doklady/pas-jana",
      name: "Document type + expiry", title: "Cestovn\u00ed pas \u2014 Jana", kind: "expiry",
      lede: "A type and a date turn a filing cabinet into something that tells you.",
      empty: { s: "No type yet.", e: "Passport, lease, insurance policy \u2014 the type is what sets how much notice you get, so it is worth the one tap.", a: "Pick a type" },
      error: "Couldn\u2019t save the expiry. The file and its other fields are unchanged.",
      rejected: "Refused: that expiry is before the day the document was issued.",
      withdrawn: "Documents is no longer shared with you, so its dates left your reminders too.",
      readonly: "Read-only: the date shows and the reminder still fires.",
      states: {
        populated: "The type carries the notice and the completion scope. The screen says both in words, next to the date, because they are the consequence of the tap."
      },
      impossible: {
        conflicted: "Type and expiry are fields on the document row: lww_field, and two people setting the same expiry are not disagreeing."
      },
      foot: "Eleven types. Ten register a reminder; an invoice does not expire.",
      note: "Nothing about the reminder is configured here. The document declares a date and a type; the strand decides notice, snooze and channel (FR-RM1).",
      drawn: "all" },

    { id: "C-33", view: "bulk", client: "mw", preset: "D", route: "/documents/shared/faktury",
      name: "Bulk move / archive / zip / delete", title: "6 selected", kind: "bulk",
      lede: "A household migrating from a laptop folder uploads two hundred files and needs to sort them.",
      empty: { s: "Nothing selected.", e: "Tap and hold any file to start a selection, then tap the rest.", a: "Select all in this folder" },
      error: "The move didn\u2019t finish. Nothing moved \u2014 it is all or none.",
      rejected: "Refused: two of these have the same name as files in the destination. Rename or keep both.",
      withdrawn: "Some of the selection left with your access to that folder, and the count changed while you were looking at it \u2014 said out loud rather than silently.",
      readonly: "Read-only: zip and download work, move, archive and delete are held.",
      states: {
        pending: "A bulk move offline is N ordinary mutations, each marked on its own row \u2014 there is no bulk entity to be pending."
      },
      impossible: {
        conflicted: "A selection is not an entity. Each row merges on its own policy, and a bulk operation cannot hold two versions of itself."
      },
      foot: "Zip leaves out anything whose bytes have not arrived, by name.",
      note: "Delete names what points at the file and does not block. Blocking would make the household ask us for their own files back.",
      drawn: "all" },

    { id: "C-34", view: "storage", client: "mw", preset: "D", route: "/documents/storage",
      name: "Documents storage screen", title: "What Documents is using", kind: "storage",
      lede: "The largest contributor to the bill, itemised.",
      empty: { s: "Nothing stored yet.", e: "The meter starts at zero and 5 GB is included, so most households never see a charge from this screen.", a: "Add your first file" },
      error: "The figures didn\u2019t load. Nothing about your storage or your bill has changed.",
      rejected: "", withdrawn: "",
      readonly: "Read-only: the figures read, and so does the clean-up view \u2014 dropping under a block boundary is one of the few writes that still helps.",
      states: {
        offline: "Measured on the server. Offline this shows the last figures with the day they were taken, rather than a number that looks current."
      },
      impossible: {
        pending: "Usage is measured on the server from daily samples, not written by a client.",
        syncing: "Same reason.",
        conflicted: "A measurement cannot conflict with itself.",
        rejected: "Nothing is written from this screen. Deleting happens on the document row and is marked there."
      },
      foot: "Derived variants are a line, not a rounding error: they are why a 2 MB file can be using 3 MB.",
      note: "Every number is arithmetic on the same rows Settings \u00a75 counts, computed on render, so the two screens cannot drift into two answers.",
      drawn: "all" },

    { id: "C-35", view: "refwarn", client: "mw", preset: "S", route: "/documents/shared/auto/servisni-faktura",
      name: "Reference warning before delete", title: "This is used somewhere else", kind: "warn",
      lede: "Named, not blocked.",
      empty: { s: "", e: "", a: "" }, error: "", rejected: "", withdrawn: "", readonly: "",
      impossible: {},
      foot: "document_references is the reverse index. It exists for this sentence.",
      note: "\u201cThis is the service invoice on your \u0160koda\u201d is the whole feature. A count of references would be a warning about nothing.",
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

  var BULK = ["d-fak-06", "d-fak-07", "d-fak-08", "d-servis-skoda", "d-bourka", "d-uctenka"];

  function checks() {
    var t = totals();
    var rec = reconcile();
    var tl = uploadTimeline();
    var mx = serveMatrix();
    var exp = expiryRows();
    var hand = strandHandshake();
    var sel = selection(BULK);
    var warn = deleteWarning(BULK);
    var cov = coverage();
    var sniffed = DOCS.filter(function (d) { return d.sniffMismatch; });
    var active = DOCS.filter(function (d) { return d.previewKind === "active"; });

    return [
      { name: "The row exists before its bytes \u2014 on the other device",
        detail: tl.map(function (s) { return s.step.toLowerCase() + ": " + (s.rowExists ? "row" : "no row") + "/" + (s.bytesExist ? "bytes" : "no bytes"); }).join(" \u00b7 ") +
          ". At step two the tablet has the row and the preview endpoint answers " + tl[1].serves +
          " in words. Nothing about the row is hidden while the bytes are missing, and nothing pretends they are there.",
        pass: !tl[0].rowExists && tl[1].rowExists && !tl[1].bytesExist && tl[1].serves === 409 &&
              tl[3].rowExists && tl[3].bytesExist },

      { name: "Four endpoints, and the refusals are the interesting cells",
        detail: mx.length + " content types \u00d7 " + ENDPOINTS.length + " endpoints = " + (mx.length * ENDPOINTS.length) +
          " answers, computed: " + mx.map(function (r) {
            return r.kind + " " + r.cells.map(function (c) { return c.status; }).join("/");
          }).join(" \u00b7 ") + ". Every 404 and 409 carries a sentence rather than a broken pane.",
        pass: mx.every(function (r) { return r.cells.every(function (c) { return [200, 404, 409].indexOf(c.status) >= 0; }); }) &&
              mx.some(function (r) { return r.cells.some(function (c) { return c.status === 409; }); }) },

      { name: "Active types are download-only, and the client\u2019s header is not evidence",
        detail: sniffed.length + " of " + DOCS.length + " uploads declared one type and sniffed as another: \u201c" +
          sniffed.map(function (d) { return d.title + "\u201d (" + d.declared + " \u2192 " + d.ct + ")"; }).join(", ") +
          ". It is the SVG, so trusting the header would have rendered a scriptable file in the app\u2019s origin. " +
          active.length + " active-type document, preview " + serve(active[0], "preview").status + ", thumbnail " +
          serve(active[0], "thumbnail").status + ", download 200.",
        pass: sniffed.length === 1 && active.length === 1 && active[0].sniffMismatch &&
              serve(active[0], "preview").status === 404 && serve(active[0], "download").status === 200 },

      { name: "A failed conversion loses nothing",
        detail: (function () {
          var d = docOf("d-rozpocet");
          return "\u201c" + d.title + "\u201d timed out in conversion: preview " + serve(d, "preview").status +
            ", thumbnail " + serve(d, "thumbnail").status + ", raw and download 200. The document is download-only and the upload is intact \u2014 " +
            "and it is the one row of the " + DOCS.length + " with no derived bytes on the meter.";
        })(),
        pass: (function () {
          var d = docOf("d-rozpocet");
          return d.previewStatus === "failed" && serve(d, "preview").status === 404 &&
                 serve(d, "raw").status === 200 && d.derived === 0;
        })() },

      { name: "The type carries the notice and the scope; the strand reads the table",
        detail: TYPES.length + " types, " + hand.leads + " with a lead time, " + hand.presets +
          " of them on FR-RM2\u2019s preset set \u2014 the passport\u2019s " + hand.tableDays +
          " days is the one that needs the custom field, which is the gap Stage 12 recorded. reminders.js resolves documents.expiry to " +
          hand.strandDays + " days from this table: " + (hand.agree ? "they agree" : "THEY DISAGREE") + ". " +
          TYPES.filter(function (x) { return x.scope === "personal"; }).length + " types complete personally, " +
          TYPES.filter(function (x) { return x.scope === "shared"; }).length + " for the household (D-53).",
        pass: hand.agree && hand.kinds === 1 && hand.leads === 10 &&
              TYPES.filter(function (x) { return x.scope === "personal"; }).length === 4 },

      { name: "Two documents are inside their lead window today, and it is not the two nearest",
        detail: (function () {
          var inw = exp.filter(function (r) { return r.inWindow; });
          return exp.length + " documents carry an expiry. " + inw.length + " are inside their window on " + fmt(TODAY) + ": " +
            inw.map(function (r) { return r.title.replace(/\.pdf$/, "") + " (" + r.days + " days, " + r.lead + "-day notice, " + r.scope + ")"; }).join(" \u00b7 ") +
            ". The passport is further away than three other documents and is the earliest warning, because six months is what replacing one takes.";
        })(),
        pass: (function () {
          var inw = exp.filter(function (r) { return r.inWindow; });
          return inw.length === 2 && inw.some(function (r) { return r.id === "d-pas-jana"; }) &&
                 exp.filter(function (r) { return !r.registers; }).length === 0;
        })() },

      { name: "The expiring list follows the grant, not the screen",
        detail: ["jana", "milos", "petr", "adam", "klara"].map(function (m) {
            return firstName(m) + " " + expiringFor(m).length;
          }).join(" \u00b7 ") + " expiring documents, and " +
          ["jana", "milos", "petr"].map(function (m) { return firstName(m) + " " + visibleTo(m).length; }).join(" \u00b7 ") +
          " visible files. Milo\u0161 holds view: he sees the shared root and neither private one. Petr, Kl\u00e1ra and Adam hold none, so Documents is absent \u2014 no list, no count, no mention.",
        pass: expiringFor("jana").length === 2 && expiringFor("milos").length === 2 &&
              visibleTo("petr").length === 0 && visibleTo("milos").length < visibleTo("jana").length },

      { name: "Deleting names what points at the file, and does not block",
        detail: warn.title + " \u2014 " + warn.body.join("; ") + ". " + sel.count + " files, " +
          mb(sel.recovers) + " recovered including derived variants, " + (warn.blocks ? "BLOCKED" : "not blocked") +
          ". " + REFERENCES.length + " references exist across " +
          REFERENCES.filter(function (r, i, a) { return a.map(function (x) { return x.module; }).indexOf(r.module) === i; }).length +
          " modules, and no module reads the documents tables to make them.",
        pass: !warn.blocks && warn.body.length === 1 && /\u0160koda/.test(warn.body[0]) && sel.recovers > sel.bytes },

      { name: "A zip leaves out what has not arrived, by name",
        detail: sel.zip.included + " of " + sel.count + " files go into the zip. " + sel.zip.says +
          " The pending row is the parking receipt from this morning, and the offer is to wait rather than to silently produce an incomplete archive.",
        pass: sel.zip.skipped === 1 && sel.zip.included === sel.count - 1 },

      { name: "The meter is arithmetic, and it agrees with the household screen",
        detail: t.count + " documents, " + (t.originalsGB).toFixed(2) + " GB of originals plus " +
          (t.derivedGB).toFixed(2) + " GB derived \u2014 " + t.overheadPct.toFixed(0) +
          " % overhead, which is the answer to \u201cwhy is my 2 MB file using 3 MB\u201d. Settings \u00a75 carries " +
          rec.settings + " GB for Documents: " + (rec.agree ? "agrees to " + rec.delta.toFixed(3) + " GB" : "DISAGREES") +
          ", and the derived figure sits inside the household\u2019s " + rec.derivedHousehold + " GB.",
        pass: rec.agree && rec.withinDerived && t.overheadPct > 5 },

      { name: "The largest file here is the largest file the household screen names",
        detail: "\u201c" + rec.largestHere.title + "\u201d at " + mb(rec.largestHere.bytes) + " (" +
          rec.largestHere.share.toFixed(1) + " % of Documents) is the top row of both screens. " +
          "Splits are computed three ways: " + splitBy("folder").length + " folders, " +
          splitBy("member").length + " members, " + splitBy("type").length + " types \u2014 " +
          "the top folder is " + splitBy("folder")[0].name + " at " + mb(splitBy("folder")[0].bytes) + ".",
        pass: rec.largestHere.bytes >= 400 && !!rec.largestSettings && splitBy("type").length >= 6 },

      { name: "A reference resolves to what the caller may see, or says so",
        detail: ["jana", "milos", "petr"].map(function (m) {
            return firstName(m) + ": " + referenceFor("d-servis-skoda", m).state;
          }).join(" \u00b7 ") + ". The vehicle screen draws the same component in all three cases and never learns which \u2014 the platform applies the grant and the privacy, and returns a placeholder rather than a hole (D-40).",
        pass: referenceFor("d-servis-skoda", "jana").state === "resolved" &&
              referenceFor("d-servis-skoda", "petr").state === "no-grant" &&
              referenceFor("d-servis-skoda", "milos").state === "resolved" },

      { name: "Every state these eight rows can reach is drawn",
        detail: cov.map(function (c) { return c.id + " " + c.drawn.length + "/" + c.required.length; }).join(" \u00b7 ") +
          " states, " + cov.reduce(function (n, c) { return n + c.cells; }, 0) +
          " cells. Eight exclusions across five rows: write-once bytes, lww_field metadata, a selection that is not an entity, and a measurement taken on the server.",
        pass: cov.every(function (c) { return c.complete; }) }
    ];
  }

  window.HH_DOCS = {
    version: "0.1-stage-13-candidate",
    today: TODAY,
    types: TYPES, typeOf: typeOf, country: COUNTRY, typeIn: typeIn, strandHandshake: strandHandshake,
    folders: FOLDERS, docs: DOCS, docOf: docOf, folderOf: folderOf,
    rootsFor: rootsFor, visibleTo: visibleTo,
    endpoints: ENDPOINTS, serve: serve, serveMatrix: serveMatrix, isolation: isolation,
    pending: PENDING, previewFailed: PREVIEW_FAILED, uploadTimeline: uploadTimeline,
    expiryRows: expiryRows, expiringFor: expiringFor,
    references: REFERENCES, referencesTo: referencesTo, referenceFor: referenceFor,
    bulkSelection: BULK, selection: selection, deleteWarning: deleteWarning,
    totals: totals, splitBy: splitBy, largest: largest, reconcile: reconcile,
    screens: SCREENS, rows: SCREENS, allStates: ALL_STATES, coverage: coverage,
    mb: mb, fmt: fmt, addDays: addDays, diff: diff,
    checks: checks
  };
})();
