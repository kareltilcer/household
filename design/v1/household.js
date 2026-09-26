/* Stage 8 — household, invitation, the grant matrix, billing, privacy, as data.
   Source: docs/design/05-screens.md §A rows 22-35 and §C Household settings (§1, §2, §3, §5, §6, §7, §8),
   03-patterns.md §2, §3, §5 and §10, 08-decisions.md DD-9 and DD-15,
   prd/02-identity-and-access.md §3-§6, 04-billing-and-entitlements.md §1-§6,
   05-privacy-and-compliance.md §3-§5, modules/17-household-admin.md.

   Two rules this file exists to enforce.

   One: the grant matrix is written in words a member already knows. The four API levels
   (none / view / contribute / manage) appear nowhere a member can see; every row of the
   matrix carries its own phrase, so seventeen rows read without a legend. The gate scans
   the rendered labels for the enum words rather than trusting the screens.

   Two: the eight entitlement states are one table, and every banner, lockout and lift
   control is derived from it. Which states show nothing, which carry a deletion date, and
   which keep their write affordances because FR-BI1 exempts them, are computed here — so a
   banner cannot acquire a deletion date on one screen and lose it on another.
*/
(function () {

  var ALL_STATES = ["loading", "empty", "populated", "error", "offline", "pending",
                    "syncing", "conflicted", "rejected", "absent", "withdrawn", "readonly"];

  /* ── the eight entitlement states ───────────────────────────────────────
     [key, read, write, upload, sync, presentation, deletion date, origin, what the member sees] */

  var ENT = [
    ["trialing", 1, 1, 1, 1, "banner", false, "billing",
     "Nothing for twenty days, then two escalating stages (DD-9). No card was required to get here."],
    ["active", 1, 1, 1, 1, "nothing", false, "billing",
     "Nothing at all. It is a state, not a banner."],
    ["past_due", 1, 1, 1, 1, "banner", false, "billing",
     "A payment-method prompt. Nothing is restricted \u2014 not one write, not one upload."],
    ["grace", 1, 1, 0, 1, "banner", false, "billing",
     "Fourteen days. Uploads are blocked and everything else works."],
    ["read_only", 1, 0, 0, "pull", "banner", true, "billing",
     "Writes off, reads and exports untouched, and the deletion date from the first day."],
    ["canceled", 1, 0, 0, "pull", "banner", true, "billing",
     "The same shape as read-only, said differently: this one was a decision, not a failure."],
    ["restricted", 1, 0, 0, "pull", "banner", false, "owner",
     "Who restricted the household and when. No deletion date \u2014 a restricted household is still paying."],
    ["suspended", 0, 0, 0, 0, "lockout", false, "staff",
     "A full-screen lockout with no household content on it, the notice, and a route to support."]
  ];

  var ENT_BY = {};
  ENT.forEach(function (e) { ENT_BY[e[0]] = e; });

  /* The deletion date is one value, written once. Only two states may carry it. */
  var DELETION_DATE = "9 September 2027";

  /* ── the banners, drawn ───────────────────────────────────────────────── */

  var BANNERS = [
    { key: "trialing", stage: "days 21\u201325", tone: "info", dismissible: true,
      title: "Nine days of the trial left",
      body: "Everything keeps working until 30 September. After that, uploads pause for two weeks before anything else changes \u2014 and nothing is ever deleted for lapsing.",
      actions: ["See the plan", "Dismiss"] },

    { key: "trialing", stage: "days 26\u201330", tone: "warning", dismissible: false,
      title: "The trial ends on 30 September",
      body: "\u20ac4.99 a month, billed yearly. Nothing on this phone is at risk either way: if the trial simply ends, the household keeps reading and exporting everything it has.",
      actions: ["Subscribe"] },

    { key: "past_due", stage: "from the first failed charge", tone: "warning", dismissible: false,
      title: "The last payment didn\u2019t go through",
      body: "Nothing has changed in the app and nothing will for two weeks. It is usually an expired card \u2014 we will try again on 12 September.",
      actions: ["Update the card"] },

    { key: "grace", stage: "14 days", tone: "warning", dismissible: false,
      title: "New photos and files can\u2019t be added for now",
      body: "Everything already here is readable, editable and exportable. Uploads come back the moment the subscription does. Nothing is deleted at the end of the fourteen days \u2014 the household becomes read-only.",
      actions: ["Resume the subscription"] },

    { key: "read_only", stage: "12-month retention window", tone: "danger", dismissible: false,
      title: "Tilcerovi is read-only",
      body: "Everybody can read and export everything. Nothing new can be added until the subscription resumes, and the changes waiting on your phone are held \u2014 not lost \u2014 and offered back if it does. Data is kept until " + DELETION_DATE + ", and you will be told three times before anything goes.",
      actions: ["Resume the subscription", "Export everything"] },

    { key: "canceled", stage: "12-month retention window", tone: "danger", dismissible: false,
      title: "The subscription was cancelled",
      body: "You cancelled on 8 September, and everything is still here to read and to export. Data is kept until " + DELETION_DATE + ". Resuming at any point before then brings writing back and clears the date.",
      actions: ["Resume the subscription", "Export everything"] },

    { key: "restricted", stage: "until an owner lifts it", tone: "warning", dismissible: false,
      title: "Jana restricted this household on 9 September at 14:02",
      body: "Nothing can be added or changed by anyone until an owner lifts it. Reading, downloading and exporting all work, and the subscription keeps running as normal.",
      actions: ["Lift the restriction"] }
  ];

  /* ── lifting a restriction reveals what is underneath ────────────────────
     [billing state while restricted, what lifting lands in, what the control says] */

  var LIFT = [
    ["active", "active", "Lift the restriction \u2014 writing comes back on"],
    ["trialing", "trialing", "Lift the restriction \u2014 the trial runs to 30 September"],
    ["past_due", "past_due", "Lift the restriction \u2014 writing comes back, and a payment is still outstanding"],
    ["grace", "grace", "Lift the restriction \u2014 writing comes back, uploads stay blocked"],
    ["read_only", "read_only", "Lift the restriction \u2014 the household stays read-only, with a deletion date"],
    ["canceled", "canceled", "Lift the restriction \u2014 the household stays read-only; the subscription was cancelled"],
    ["suspended", "suspended", "Lift the restriction \u2014 the household stays locked; suspension is not ours to lift"]
  ];

  /* ── the four levels, in words a member already knows ───────────────────
     The API word is here so the gate can prove no screen shows it. */

  var LEVELS = [
    ["none", "Off", "Not in their app at all \u2014 no screen, no widget, no search result, no reminder"],
    ["view", "Can see", "Reads everything in it and changes nothing"],
    ["contribute", "Can add and edit", "Adds things, edits things, ticks things off"],
    ["manage", "Can set it up", "The structural things too: seasons, tariffs, accounts, definitions"]
  ];

  var PHRASE = {};
  LEVELS.forEach(function (l) { PHRASE[l[0]] = l[1]; });

  /* ── the seventeen grantable modules, with their defaults ────────────────
     [key, name, adult default, child default, cap for a child]
     FR-AC3 lists all seventeen because a module missing from the table is a module
     whose default nobody decided. FR-AC4 gives the child column. */

  var MODULES = [
    ["dashboard", "Dashboard", "contribute", "view", "contribute"],
    ["tasks", "Tasks", "contribute", "contribute", "contribute"],
    ["reminders", "Reminders", "contribute", "view", "contribute"],
    ["calendar", "Calendar", "contribute", "contribute", "contribute"],
    ["shopping", "Shopping", "contribute", "contribute", "contribute"],
    ["chores", "Chores", "contribute", "contribute", "contribute"],
    ["notes", "Notes", "contribute", "none", "contribute"],
    ["chat", "Chat", "contribute", "none", "contribute"],
    ["pets", "Pets", "contribute", "contribute", "contribute"],
    ["documents", "Documents", "view", "none", "contribute"],
    ["activity", "Activity log", "view", "none", "view"],
    ["admin", "Household settings", "view", "none", "view"],
    ["finance", "Finance", "none", "none", "view"],
    ["utilities", "Utilities", "none", "none", "contribute"],
    ["garden", "Garden", "none", "none", "contribute"],
    ["property", "Property", "none", "none", "contribute"],
    ["vehicles", "Vehicles", "none", "none", "contribute"]
  ];

  var LEVEL_ORDER = ["none", "view", "contribute", "manage"];

  /* The invitation composer opens on the defaults, so the matrix is answered
     before it is asked. Counted, not asserted. */
  function defaultCounts(col) {
    var c = { none: 0, view: 0, contribute: 0, manage: 0 };
    MODULES.forEach(function (m) { c[m[col]]++; });
    return c;
  }

  /* What the acceptance screen shows: the grants grouped by what they let you do,
     absent modules named — the one screen in the product where `none` is spoken aloud. */
  function acceptanceGroups(col) {
    return LEVEL_ORDER.slice().reverse().map(function (lv) {
      return {
        level: lv, phrase: PHRASE[lv],
        modules: MODULES.filter(function (m) { return m[col] === lv; }).map(function (m) { return m[1]; })
      };
    }).filter(function (g) { return g.modules.length > 0; });
  }

  /* Each member's row of the matrix, derived from the fixture rather than authored.
     fixtures.js now carries FR-AC3's seventeen, Household settings included, so nothing
     here is inferred from a role. */
  function matrixFor(memberId) {
    var F = window.HH_FIXTURES;
    if (!F) return [];
    var m = F.members.filter(function (x) { return x.id === memberId; })[0];
    if (!m) return [];
    return MODULES.map(function (mod) {
      var lv = m.grants[mod[0]] || "none";
      if (m.role === "child" && lv === "manage") lv = "contribute";
      if (m.role === "child" && mod[0] === "finance" && lv === "manage") lv = "view";
      return { key: mod[0], name: mod[1], level: lv, phrase: PHRASE[lv] };
    });
  }

  /* ── storage, computed the way the invoice computes it ───────────────────
     FR-BI3: avg over daily samples, 5 GB included, 10 GB blocks at €1. */

  var STORAGE = {
    allowance: 5, block: 10, price: 1, currency: "\u20ac",
    current: 19.4, mtdAverage: 18.2, projectedAverage: 18.9,
    byModule: [["Documents", 6.1], ["Chat", 5.4], ["Garden", 4.2], ["Utilities", 1.1],
               ["Finance", 0.4], ["Notes", 0.2], ["Shopping", 0.0]],
    byMember: [["Jana", 8.4], ["Milo\u0161", 5.9], ["Petr", 3.1], ["Adam", 1.2], ["Kl\u00e1ra", 0.8]],
    derived: 1.8,
    largest: [["Chata \u2014 roof, 2025-08.mp4", "Chat \u00b7 Milo\u0161", 0.9],
              ["Insurance inventory scan.pdf", "Documents \u00b7 Jana", 0.4],
              ["Bed 3, whole season.zip", "Garden \u00b7 Milo\u0161", 0.3]]
  };

  function blocksFor(avgGB) {
    return Math.ceil(Math.max(0, avgGB - STORAGE.allowance) / STORAGE.block);
  }
  function chargeFor(avgGB) { return blocksFor(avgGB) * STORAGE.price; }

  /* ── the six data-subject rights, self-service ─────────────────────────── */

  var RIGHTS = [
    ["Get a copy of everything", "Access and portability",
     "A ZIP of every module as JSON, your files with their real names, and readable versions where a standard exists \u2014 an .ics, two .csv files, your notes as Markdown.",
     "Ready within 24 hours \u00b7 yours for 7 days", "Request the export"],
    ["Correct something", "Rectification",
     "Ordinary editing. Your profile and the household\u2019s settings are edited in place, not requested from anybody.",
     "Immediate", "Open your profile"],
    ["Delete your account", "Erasure",
     "Four situations are resolved before anything happens, and the household\u2019s own records stay with the household.",
     "30-day window, then irreversible", "Delete your account"],
    ["Stop all changes for now", "Restriction of processing",
     "Puts the household into a state where everything is readable and exportable and nothing can be written. Any owner lifts it at any time.",
     "Immediate", "Restrict the household"],
    ["Turn off analytics", "Objection",
     "Analytics are off unless you turned them on, they never contain anything you typed, and the product works identically either way.",
     "Immediate", "Analytics: off"],
    ["Complain to a regulator", "Complaint",
     "Routed to your own country\u2019s authority \u2014 for this account, the Czech \u00daOO\u00da. A member in the UK is shown the ICO instead.",
     "\u2014", "Open the authority\u2019s site"]
  ];

  /* ── the diagnostic bundle, rendered before it is sent ──────────────────
     [field, what it holds, included by default, redactable] */

  var BUNDLE = [
    ["Screen", "/shopping/lists/2 \u00b7 the list you were on", true, false],
    ["App and API", "Household 1.4.2 (build 4471) \u00b7 API v1 \u00b7 iOS 18.2", true, false],
    ["Device", "iPhone 13 \u00b7 Prague \u00b7 en-GB, household cs-CZ", true, false],
    ["Your ids", "member 8f2c\u2026 \u00b7 household 41ab\u2026 \u00b7 device 7d19\u2026", true, false],
    ["Sync cursor", "seq 184 402, last pull 18:41, 2 mutations queued", true, false],
    ["Last 40 mutations", "Action keys and timestamps. No field values.", true, false],
    ["The row you were looking at", "Shopping item \u00b7 4 fields \u00b7 values included", true, true],
    ["Recent log", "12 lines. Two carry text you typed.", true, true],
    ["Attachments", "Nothing. Files are never in a bundle.", false, false]
  ];

  /* ── per device, on the sync-health screen ─────────────────────────────── */

  var DEVICES = [
    { name: "iPhone 13 \u00b7 Jana", meta: "Synced 18:41 \u00b7 seq 184 402 \u00b7 nothing queued \u00b7 digest agreed 18:41", tone: "ok", action: "" },
    { name: "iPad (kitchen) \u00b7 shared", meta: "Synced yesterday 21:03 \u00b7 seq 183 990 \u00b7 2 queued \u00b7 digest agreed yesterday", tone: "pending", action: "" },
    { name: "Pixel 6 \u00b7 Petr", meta: "Synced 17:58 \u00b7 seq 184 401 \u00b7 1 conflict waiting \u00b7 digest agreed 17:58", tone: "conflict", action: "Open the conflict" },
    { name: "Chrome on Windows \u00b7 Jana", meta: "Synced 16:12 \u00b7 seq 184 388 \u00b7 utilities.reading disagreed on the digest", tone: "digest", action: "Force a re-snapshot" }
  ];

  /* ── destructive confirmations, for the scan ─────────────────────────────
     [situation, the object named, the button, what it says goes] */

  var DESTRUCTIVE = [
    ["Delete the household", "Tilcerovi",
     "Delete Tilcerovi and everything in it",
     "Type the name. Every member is told immediately. Thirty days to change your mind, then it cannot be undone: 38 documents, three seasons of garden history, two years of readings and 1.4 GB of files."],
    ["Restrict the household", "Tilcerovi",
     "Restrict Tilcerovi \u2014 nobody can write until it is lifted",
     "Every write, every upload and every queued offline change stops. Reading, downloading, exporting and the subscription carry on. Any owner lifts it at any time."],
    ["Remove a member", "Petr",
     "Remove Petr from Tilcerovi",
     "What Petr added stays \u2014 it is the household\u2019s record. His private notes and documents are deleted after thirty days, and he can export them until then."],
    ["Disable a module", "Garden",
     "Turn Garden off for everyone",
     "Its screens, widgets and reminders go for all five members. Nothing is deleted: three seasons of history stay exactly where they are and come back if Garden is turned on again."],
    ["Regenerate the household code", "code",
     "Make a new code",
     "K7M2-4PQX stops working for new sign-ins. Adam\u2019s phone and the kitchen iPad stay signed in \u2014 existing sessions are untouched."],
    ["Transfer ownership", "Milo\u0161",
     "Make Milo\u0161 an owner",
     "Owners invite, remove, re-grant, enable modules and delete the household. There can be several, and this does not move billing."]
  ];

  /* ── the two refusals leaving a household states together ─────────────── */

  var LEAVE = [
    ["last_owner", "You are the only owner", "blocked",
     "Four other people are in Tilcerovi. If you go with nobody else able to invite, remove or change what anyone sees, the household is left unadministrable.",
     "Make someone an owner"],
    ["billing_payer", "You pay for the subscription", "blocked",
     "The household needs another payer, or the subscription ends and Tilcerovi goes read-only when the period does. A household whose payer walked out lapses for a reason nobody in it can fix.",
     "Hand billing over"],
    ["stays", "What you leave behind", "kept",
     "Shopping items, readings, notes, the activity log \u2014 they are the household\u2019s record and they stay, with your name on them. Your private notes and documents are deleted after thirty days, and you can export them until then.",
     ""]
  ];

  /* ── the price, one currency in every market ───────────────────── */

  var PRICE = [
    ["EUR", "\u20ac4.99 / month billed yearly (\u20ac59.88)", "\u20ac5.99 month to month", "\u20ac1.00 per 10 GB block", true],
    ["GBP", "\u00a34.49 / month billed yearly", "\u00a35.49 month to month", "\u00a31.00 per 10 GB block", true],
    ["CZK", "billed in EUR \u2014 \u20ac4.99 / month billed yearly (\u20ac59.88)", "billed in EUR \u2014 \u20ac5.99 month to month", "\u20ac1.00 per 10 GB block", true],
    ["PLN", "billed in EUR \u2014 \u20ac4.99 / month billed yearly (\u20ac59.88)", "billed in EUR \u2014 \u20ac5.99 month to month", "\u20ac1.00 per 10 GB block", true]
  ];

  /* ── generic treatments for the twelve states ─────────────────────────── */

  var TREATMENTS = {
    offline: { tone: "info", title: "Offline", body: "Everything on this screen reads exactly as it does online. Changes are saved here and sent when there is signal." },
    pending: { tone: "info", title: "Saved here, not sent yet", body: "This change is queued on this device and is still fully editable \u2014 an edit merges into what is waiting." },
    syncing: { tone: "info", title: "Sending", body: "It has taken longer than a moment, so it says so rather than pretending to be finished." },
    conflicted: { tone: "warning", title: "Two versions of this setting", body: "Somebody changed it while you were editing. Both values are kept and the resolver asks which one stands \u2014 household settings are strict-version, so it is always a question." },
    rejected: { tone: "danger", title: "The server would not take this", body: "The reason is given in a sentence, and the change is held on this device until you retry, edit or discard it." },
    absent: { tone: "info", title: "Not available", body: "This is not part of your app. Nothing here says whether the household uses it." },
    withdrawn: { tone: "info", title: "Your access changed", body: "This was on the screen a moment ago. Access changed, so this device dropped its copy \u2014 nobody deleted anything." },
    readonly: { tone: "warning", title: "Read-only \u2014 the subscription lapsed", body: "Everything is readable and exportable. Writing is off until it resumes, and what is queued on this device is held rather than lost." },
    empty: { tone: "info", title: "", body: "" }
  };

  /* ── the screens ────────────────────────────────────────────────────────── */

  var SCREENS = [

    { id: "A-22", view: "make", client: "mw", preset: "F", route: "/households/new",
      name: "Create household", title: "Set up your household", kind: "form",
      lede: "Four of these five are read from this phone. Change any of them.",
      fields: [
        { label: "Name", value: "Tilcerovi", type: "text" },
        { label: "Country", value: "Czechia", type: "text", hint: "from this phone" },
        { label: "Time zone", value: "Europe/Prague", type: "text", hint: "from this phone" },
        { label: "Language", value: "\u010ce\u0161tina", type: "text", hint: "from this phone" },
        { label: "Money is counted in", value: "CZK \u2014 Czech koruna", type: "text", hint: "from this phone" }
      ],
      notice: { tone: "info", title: "Thirty days, no card",
        body: "The trial starts now and runs to 9 October. There is no card to enter and nothing to cancel \u2014 if you do nothing at the end, the household keeps reading and exporting everything in it." },
      primary: "Create Tilcerovi",
      secondary: ["I was invited to one instead"],
      error: { tone: "danger", title: "", body: "Something went wrong at our end. Nothing you typed was lost \u2014 try again." },
      foot: "Country decides which tariff presets, document types and statutory dates are offered. It is confirmed, not asked.",
      note: "Every one of these has a right answer the phone already knows, so the screen shows the answers and asks for a glance rather than five decisions. Naming the source on each row is what makes it a confirmation instead of a guess the member has to check.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-23", view: "make", client: "mw", preset: "D", route: "/households/tilcerovi/invitations/new",
      name: "Invitation composer", title: "Invite Petr", kind: "matrix",
      lede: "Seventeen decisions, already answered. Change the ones you want to.",
      fields: [
        { label: "Their name", value: "Petr", type: "text" },
        { label: "How they get it", value: "Email to petr@\u2026 \u00b7 expires in 14 days", type: "text", hint: "Send a link instead" },
        { label: "Role", value: "Member", type: "choice", options: ["Member", "Owner", "Child"] }
      ],
      matrixCol: 2,
      primary: "Send the invitation",
      secondary: ["Save and send later"],
      error: { tone: "danger", title: "", body: "The invitation was not sent. Nothing has reached Petr, and the seventeen settings below are as you left them." },
      states: {
        offline: { tone: "warning", title: "An invitation cannot be sent offline", body: "It carries your name to somebody else\u2019s phone, so it goes when there is signal. What you set here is kept." },
        readonly: { tone: "warning", title: "Read-only \u2014 no new members for now", body: "Inviting is a write, and writes are off until the subscription resumes. Everybody already in the household keeps reading and exporting." }
      },
      impossible: {
        pending: "A grant is never a queued local write. Grants reach the client as derived capability state, not as an editable synced entity (D-80), so there is nothing to hold in a queue.",
        syncing: "Same reason: the composer writes an invitation on the server or it does not write at all.",
        conflicted: "Two owners cannot hold conflicting drafts of an invitation that does not exist yet.",
        rejected: "A refused invitation is an error on this screen with the reason in it, not a rejected mutation to resolve later."
      },
      foot: "The defaults draw one line: what the household does together is open, what it owns and spends is closed until somebody opens it.",
      note: "The matrix is the reason this screen exists, and it is answered before it is asked. Nine modules on, three to read, five off \u2014 an owner who changes nothing has still made a defensible decision, and an owner who cares can change all seventeen without leaving the screen.",
      drawn: ["loading", "empty", "populated", "error", "offline", "absent", "withdrawn", "readonly"] },

    { id: "A-24", view: "make", client: "mw", preset: "F", route: "/invitations/K7M2-4PQX",
      name: "Invitation acceptance", title: "Jana has invited you to Tilcerovi", kind: "accept",
      lede: "Here is exactly what that gives you.",
      acceptCol: 2,
      primary: "Join Tilcerovi",
      secondary: ["Decline"],
      error: { tone: "danger", title: "This invitation has expired", body: "Email invitations last 14 days. Ask Jana for another \u2014 nothing about your account has changed." },
      notice: { tone: "info", title: "This can change later, and you will be told",
        body: "Jana can raise or lower any of it. An access change you discover by finding something missing would be a bug, so the household tells you when it happens." },
      foot: "Declining is recorded and Jana is told. Nothing is added to your account either way.",
      note: "The highest-value screen in the phase, and the only screen in the product that says the word for absence out loud. Everywhere else a module a member cannot see leaves no trace \u2014 here the five closed ones are named, because consent to a boundary needs the whole picture, and after this they are never mentioned again.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-25", view: "make", client: "mw", preset: "S", route: "/households/tilcerovi/invitations",
      name: "Invitation declined \u2014 inviter notice", title: "Petr declined the invitation", kind: "form",
      lede: "9 September at 18:20.",
      fields: [],
      notice: { tone: "info", title: "",
        body: "Nothing was shared with him and the invitation is closed. If it was the access that gave him pause, you can invite him again with different modules \u2014 he sees the whole list before he answers either way." },
      primary: "Invite Petr again",
      secondary: ["Dismiss"],
      foot: "Recorded in the activity log, where the household can see it.",
      note: "Written flat. A declined invitation is one of the ordinary outcomes of asking, and the notice offers the one thing that might change the answer without suggesting anybody did something wrong.",
      drawn: ["populated"] },

    { id: "A-26", view: "grants", client: "mw", preset: "F", route: "/households/tilcerovi/leave",
      name: "Leave household", title: "Leave Tilcerovi", kind: "blockers",
      lede: "Two things have to be settled first, and here they both are.",
      blockers: LEAVE,
      primary: "",
      secondary: [],
      error: { tone: "danger", title: "", body: "Something went wrong at our end. You are still a member of Tilcerovi and nothing has changed." },
      foot: "Both refusals at once, each naming what unblocks it. A payer who is also the last owner meets both here, not one after the other.",
      note: "Serial refusals are how somebody spends twenty minutes clearing one blocker to meet a second. Both are resolved and shown up front, and the third card is not a blocker at all \u2014 it is what leaving actually does to the things they wrote.",
      drawn: ["loading", "populated", "error"] },

    { id: "C-50", view: "grants", client: "mw", preset: "D", route: "/households/tilcerovi/settings/members",
      name: "Settings \u00a72 \u2014 members and grants", title: "Members", kind: "members",
      lede: "Everybody\u2019s access, visible to everybody.",
      primary: "Invite somebody",
      secondary: ["Child profiles"],
      error: { tone: "danger", title: "", body: "The member list did not load. Nobody\u2019s access has changed \u2014 try again." },
      states: {
        readonly: { tone: "warning", title: "Read-only \u2014 access cannot be changed for now", body: "The list still reads, because \u201cwhy can Petr see Utilities and I can\u2019t\u201d is a question a lapsed household still gets asked." },
        absent: { tone: "info", title: "Not available", body: "Household settings are not part of your app." }
      },
      impossible: {
        pending: "Permissions are never client-authoritative (D-80). A grant change is a server write or it is nothing, so there is no queued local state to draw.",
        syncing: "Same reason.",
        conflicted: "Two owners editing one member\u2019s grants is a strict-version conflict on the server, resolved there; the client never holds two versions of somebody\u2019s access.",
        rejected: "A refused grant change is an error here with its reason, not a held mutation."
      },
      foot: "Any member may read this screen. Every write on it is owner-only, whatever the grant says.",
      note: "One screen, because access questions are answered by comparison. Every row spells its own level out, so seventeen modules across five people need no key and no colour \u2014 and lowering somebody\u2019s access from here tells them, at the moment it happens.",
      drawn: ["loading", "empty", "populated", "error", "offline", "absent", "withdrawn", "readonly"] },

    { id: "A-27", view: "money", client: "mw", preset: "F", route: "/households/tilcerovi/billing/subscribe",
      name: "Subscribe", title: "Keep Tilcerovi", kind: "plan",
      lede: "One price for the whole household, however many people are in it.",
      primary: "Pay yearly \u2014 \u20ac59.88",
      secondary: ["Pay monthly \u2014 \u20ac5.99", "Not yet"],
      notice: { tone: "info", title: "Storage is the only thing that varies",
        body: "5 GB is included. Above that, whole 10 GB blocks at \u20ac1 a month each, worked out from the month\u2019s daily average rather than its worst day \u2014 so 40 GB uploaded and deleted the same afternoon costs nothing." },
      error: { tone: "danger", title: "", body: "The card was not accepted, and it was not charged. Nothing about the household has changed \u2014 the trial runs to 30 September." },
      foot: "Card, SEPA, Apple Pay or Google Pay. The card never touches our servers.",
      note: "The variable line is explained beside the fixed one, before anybody has paid anything. An invoice is never the first place a household learns a number \u2014 which is also why the phone draws this screen differently.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-28", view: "money", client: "mw", preset: "D", route: "/households/tilcerovi/settings/billing",
      name: "Manage billing \u00b7 settings \u00a76", title: "Billing", kind: "billing",
      lede: "",
      primary: "",
      secondary: ["Cancel the subscription", "Hand billing to another owner"],
      error: { tone: "danger", title: "", body: "Billing did not load. Your subscription is unaffected \u2014 nothing here retries a charge." },
      exempt: true,
      states: {
        readonly: { tone: "warning", title: "Read-only \u2014 and this screen still works", body: "Everything under billing is exempt from the gate, on purpose: a subscription you cannot resume because you did not pay is a trap." },
        absent: { tone: "info", title: "Not available", body: "Billing is not part of your app." }
      },
      impossible: {
        pending: "Billing is not in the sync feed. Nothing here is written offline and queued \u2014 the screen is unavailable rather than optimistic.",
        syncing: "Same reason.",
        conflicted: "The processor is the single source of the subscription\u2019s state; two clients cannot hold two versions of it.",
        rejected: "A failed charge is the past-due banner and a dunning email, not a rejected mutation on this screen.",
        withdrawn: "Billing is not retractable data. Losing the payer role changes this screen to the state-only view, which is the drawing beside it."
      },
      foot: "The payer sees all of it. Other owners see the state and can offer to take it over; members and children never see billing at all.",
      note: "Two audiences, one screen, and the difference is drawn rather than described: switch the rail from payer to other owner. The invoice lines are separated the way the invoice separates them, because \u201cwhy was it \u20ac6.99\u201d has to be answerable without opening a PDF.",
      drawn: ["loading", "empty", "populated", "error", "offline", "absent", "readonly"] },

    { id: "A-29", view: "money", client: "mw", preset: "F", route: "/households/tilcerovi/billing/takeover",
      name: "Take over billing", title: "Jana has offered you billing", kind: "form",
      lede: "Tilcerovi \u00b7 offered 9 September at 19:04.",
      fields: [
        { label: "What you would pay", value: "\u20ac59.88 a year, next on 1 October", type: "text" },
        { label: "Card", value: "Add a card", type: "text", hint: "Stripe" }
      ],
      notice: { tone: "info", title: "Nothing lapses in between",
        body: "Jana keeps paying until you accept. If you decline, or do nothing, the subscription carries on exactly as it is and she is told." },
      primary: "Take over billing",
      secondary: ["Decline"],
      error: { tone: "danger", title: "", body: "The card was not accepted. Billing has not moved and Jana is still the payer." },
      foot: "Two steps, deliberately: one owner offers, another owner accepts and supplies a card.",
      note: "A handshake rather than a transfer, because the failure mode of a one-sided hand-off is a household with no working card and nobody who knows it. Transferring ownership and transferring billing stay two separate actions on two separate screens.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-30", view: "states", client: "b", preset: "S", route: "\u00b7 component",
      name: "Entitlement banners \u2014 six states", title: "The six that are banners", kind: "banners",
      lede: "Two of the eight are not banners at all.",
      primary: "", secondary: [],
      foot: "One table, eight states, seven drawings: trialing has two stages and active has none.",
      note: "The set is derived from the state table rather than authored, so a banner cannot pick up a deletion date it is not entitled to. Only read-only and cancelled carry one: putting a date on grace or restricted tells a household it is about to lose data that is in no danger.",
      drawn: ["populated"] },

    { id: "A-31", view: "states", client: "mw", preset: "S", route: "/locked",
      name: "Suspended lockout", title: "Tilcerovi is locked", kind: "lockout",
      lede: "",
      notice: { tone: "danger", title: "This is not about payment",
        body: "The household was suspended on 9 September and everybody in it has been emailed the reason. Nothing has been deleted. Support can tell you what happened and what it takes to lift it \u2014 they cannot read anything inside the household." },
      primary: "Write to support",
      secondary: ["Sign out"],
      foot: "Export is unavailable while a household is suspended, and this screen says so rather than offering a button that would fail.",
      note: "The only screen in the product with no household content on it. Suspension refuses reads, so there is nothing to show and nothing to package up \u2014 which is why the export affordance is absent here and present in every billing state, including read-only and cancelled.",
      drawn: ["populated"] },

    { id: "A-32", view: "honest", client: "mw", preset: "D", route: "/households/tilcerovi/settings/sync",
      name: "Sync health \u00b7 settings \u00a78", title: "Sync health", kind: "devices",
      lede: "Four devices, and what each of them has actually got.",
      primary: "", secondary: ["What these numbers mean"],
      error: { tone: "danger", title: "", body: "This screen could not reach the server, which is itself the answer to some questions. Nothing on your device has changed." },
      exempt: false,
      states: {
        offline: { tone: "info", title: "Offline \u2014 this device only", body: "Your own cursor and queue are read from this phone. The other three rows are as of the last time it was online, and each says when that was." },
        readonly: { tone: "warning", title: "Read-only \u2014 nothing is retracted for lapsing", body: "Every device keeps its replica exactly where it is. What is queued stays queued and is offered back if the subscription resumes." }
      },
      impossible: {
        conflicted: "This is the screen that reports conflicts. It does not have them.",
        rejected: "Same: it reports rejections rather than producing them.",
        withdrawn: "Device rows are the household\u2019s own, and losing a grant does not retract them."
      },
      foot: "Ships in Phase 0, before any feature module. Nobody at the platform can look at a member\u2019s data, so this is the only view anyone gets of a sync failure.",
      note: "Written as four sentences about four devices rather than a diagnostics dump. The digest row is the one that matters: a device that disagreed with the server about one entity type, named, with the one action that fixes it.",
      drawn: ["loading", "empty", "populated", "error", "offline", "pending", "syncing", "absent", "readonly"] },

    { id: "A-33", view: "honest", client: "mw", preset: "S", route: "/support/diagnostics",
      name: "Diagnostic bundle", title: "This is what would be sent", kind: "bundle",
      lede: "Nothing leaves until you press send.",
      primary: "Send this to support",
      secondary: ["Cancel"],
      foot: "It expires in 30 days. Files and attachments are never in a bundle.",
      note: "The no-content-access guarantee expressed entirely as a screen. Support cannot read a household, so the member is the only route to a hard bug \u2014 which only works if they can see the whole payload, rendered, and take any line out of it before it goes.",
      drawn: ["populated"] },

    { id: "A-34", view: "honest", client: "mw", preset: "D", route: "/account/privacy",
      name: "Privacy centre", title: "Your data", kind: "rights",
      lede: "Six rights, all of them a button.",
      primary: "", secondary: [],
      exempt: true,
      error: { tone: "danger", title: "", body: "The page did not load. Every right on it is still available \u2014 try again." },
      states: {
        readonly: { tone: "warning", title: "Read-only \u2014 every right on this screen still works", body: "Export, deletion and restriction are exempt from the billing gate. A household must be able to leave, and to take its data with it, in any state." }
      },
      impossible: {
        empty: "Six rights, always all six \u2014 there is no state in which a member has fewer.",
        pending: "Nothing on this screen is written offline; a request is made on the server or it is not made.",
        syncing: "Same reason.",
        conflicted: "There is nothing here two people can edit into conflict.",
        rejected: "A refused request is an error with a reason, not a held mutation.",
        withdrawn: "This is account-scoped, not household-scoped. There is no grant to lose."
      },
      foot: "A right that needs an email to support is a right nobody exercises.",
      note: "The regulation\u2019s words are the subtitle, not the label \u2014 nobody arrives wanting to exercise Article 20. Each row says what it does, what it takes, and what it does not touch.",
      drawn: ["loading", "populated", "error", "offline", "absent", "readonly"] },

    { id: "A-35", view: "honest", client: "mw", preset: "D", route: "/households/tilcerovi/exports",
      name: "Export \u2014 request, progress, download", title: "Export the household", kind: "export",
      lede: "Everything, as files that work without us.",
      primary: "Download the ZIP \u00b7 1.6 GB",
      secondary: ["Start another export"],
      exempt: true,
      error: { tone: "danger", title: "", body: "The export failed halfway and nothing partial was kept. Starting again costs you the wait, not the data." },
      states: {
        empty: { tone: "info", title: "", body: "" },
        syncing: { tone: "info", title: "Packing \u2014 about 20 minutes left", body: "You can close the app. We email you when it is ready, and it stays downloadable for seven days." },
        readonly: { tone: "warning", title: "Read-only \u2014 export is exempt", body: "Generating an export is a write, and it is one of the five the gate deliberately lets through. It works in grace, read-only, cancelled and restricted alike." }
      },
      impossible: {
        pending: "An export is server work. Nothing about it is queued on the device.",
        conflicted: "An export is a snapshot, and two of them cannot disagree.",
        rejected: "A refused export is an error with a reason; there is nothing to hold.",
        withdrawn: "A completed export belongs to whoever asked for it."
      },
      foot: "Available for 7 days. Works in every state except suspended, which is not a billing state.",
      note: "The manifest is shown rather than promised, because Article 20 is satisfied by the file being useful somewhere else \u2014 an .ics that opens in a calendar and a .csv that opens in a spreadsheet, not only a JSON dump that matches our own schemas.",
      drawn: ["loading", "empty", "populated", "error", "offline", "syncing", "absent", "readonly"] },

    { id: "C-49", view: "settings", client: "mw", preset: "D", route: "/households/tilcerovi/settings",
      name: "Settings \u00a71 \u2014 profile", title: "Household", kind: "settings",
      lede: "",
      groups: [
        ["The household", [["Name", "Tilcerovi"], ["Country", "Czechia"], ["Time zone", "Europe/Prague"],
                           ["Language", "\u010ce\u0161tina"], ["Units", "Metric"]]],
        ["Money", [["Counted in", "CZK \u2014 Czech koruna"], ["Changing this", "Shows what would change first"]]],
        ["The week starts on", [["For the household", "Monday \u00b7 from \u010ce\u0161tina"],
                                ["For you", "Monday \u00b7 your own setting wins on your screens"]]],
        ["The household code", [["Code", "K7M2-4PQX"], ["Who needs it", "Adam, on his own phone"], ["", "Copy \u00b7 Make a new one"]]]
      ],
      primary: "", secondary: [],
      states: {
        readonly: { tone: "warning", title: "Read-only \u2014 settings cannot be changed for now", body: "Everything on the screen still reads, including the household code." },
        conflicted: { tone: "warning", title: "Two versions of the household name", body: "Jana renamed it to Tilcerovi at 18:40 and Milo\u0161 to Tilcerovi \u2014 chata at 18:41. Household settings are strict-version, so it is a question, not a merge." }
      },
      impossible: {
        empty: "A household always has a name, a country, a currency and a code. There is nothing here to be empty of.",
        absent: "Any member may read the household profile, whatever their grant. There is no absent state for this screen \u2014 the writes are owner-gated instead."
      },
      foot: "Two first-day-of-week controls, and the screen says which is which. Two members of one household can genuinely see different weeks.",
      note: "The currency row is the dangerous one, so it says what it would do rather than doing it. The household code is presented as an identifier a child needs, not as a secret to guard \u2014 and the screen tells a household with no child profile that it will never need it.",
      drawn: ["loading", "populated", "error", "offline", "pending", "syncing", "conflicted", "rejected", "withdrawn", "readonly"] },

    { id: "C-51", view: "settings", client: "mw", preset: "D", route: "/households/tilcerovi/settings/modules",
      name: "Settings \u00a73 \u2014 modules", title: "Modules", kind: "toggles",
      lede: "On for the whole household, or off for the whole household.",
      toggles: [
        ["Dashboard", 1, ""], ["Tasks", 1, ""], ["Reminders", 1, ""], ["Calendar", 1, ""],
        ["Shopping", 1, ""], ["Chores", 1, ""], ["Notes", 1, ""], ["Documents", 1, ""],
        ["Finance", 1, ""], ["Utilities", 1, ""], ["Garden", 1, "three seasons of history"],
        ["Property", 0, "nothing in it yet"], ["Vehicles", 1, ""], ["Pets", 0, "nothing in it yet"],
        ["Chat", 1, ""], ["Activity log", 1, ""]
      ],
      notice: { tone: "info", title: "Turning a module off keeps its data",
        body: "Its screens, widgets and reminders go for everybody. Nothing is deleted, and turning it back on restores all of it \u2014 which is the answer to the question people actually ask." },
      primary: "", secondary: [],
      states: {
        readonly: { tone: "warning", title: "Read-only \u2014 modules cannot be turned on or off", body: "Which ones are on still reads." }
      },
      impossible: {
        empty: "Sixteen modules, always all sixteen. A household with nothing enabled still sees the list it could enable.",
        conflicted: "Enablement is one household-wide switch per module and it is strict-version on the server; the client never holds two answers.",
        absent: "A member with no access to household settings does not reach this route at all \u2014 it is a neutral not-available, which Stage 6 drew."
      },
      foot: "Sixteen rows here, seventeen in the grant matrix: Household settings is granted, never disabled.",
      note: "The confirmation carries one sentence and it is the sentence somebody is actually frightened of. Retention is not a footnote here \u2014 it is the whole content of the dialog.",
      drawn: ["loading", "populated", "error", "offline", "pending", "syncing", "rejected", "withdrawn", "readonly"] },

    { id: "C-54", view: "settings", client: "mw", preset: "D", route: "/households/tilcerovi/settings/storage",
      name: "Settings \u00a75 \u2014 storage", title: "Storage", kind: "storage",
      lede: "",
      primary: "", secondary: ["Documents clean-up", "Chat clean-up"],
      error: { tone: "danger", title: "", body: "The figures did not load. Nothing about your storage or your bill has changed." },
      states: {
        readonly: { tone: "warning", title: "Read-only \u2014 nothing new can be uploaded", body: "The figures still read, and so does the clean-up view: dropping under a block boundary is one of the few useful things to do in this state." }
      },
      impossible: {
        pending: "Usage is measured on the server from daily samples. There is no local version of it to queue.",
        syncing: "Same reason.",
        conflicted: "A measurement cannot conflict with itself.",
        rejected: "Nothing is written from this screen.",
        withdrawn: "Storage totals are the household\u2019s, and reading them needs the settings grant \u2014 which is the absent state, not a retraction."
      },
      foot: "Blocks are computed from the month\u2019s daily average, so a big upload deleted the same day costs nothing.",
      note: "Derived overhead is named on the screen rather than buried in a total, because \u201cwhy is my 2 MB file using 3 MB\u201d is otherwise a support ticket. Every number here is arithmetic on the samples, including the projected charge \u2014 the invoice is never the first place the figure appears.",
      drawn: ["loading", "empty", "populated", "error", "offline", "absent", "readonly"] },

    { id: "C-56", view: "settings", client: "mw", preset: "D", route: "/households/tilcerovi/settings/data",
      name: "Settings \u00a77 \u2014 data", title: "Data", kind: "blockers",
      lede: "Export, restrict, hand over, delete. In that order.",
      blockers: [
        ["Export", "Take a copy of everything", "kept",
         "A ZIP of every module, your files with their real names, and readable versions where a standard exists. Owner-only, ready within a day, yours for seven \u2014 and it works in every state the household can be in.",
         "Export the household"],
        ["Restrict", "Stop all changes for now", "blocked",
         "Every write, every upload and every queued offline change stops for everybody. Reading, downloading and exporting carry on, and so does the subscription \u2014 restriction is not cancellation. Any owner lifts it at any time, and the control that lifts it says which state the household will actually land in.",
         "Restrict Tilcerovi"],
        ["Transfer", "Make somebody else an owner", "kept",
         "Owners invite, remove, re-grant, enable modules and delete the household. There can be several. This does not move billing \u2014 that is its own two-step hand-off.",
         "Make Milo\u0161 an owner"],
        ["Delete", "Delete the household", "deleted",
         "Type the name to confirm. All five members are told immediately. Thirty days to change your mind, then it is gone: 38 documents, three seasons of garden history, two years of readings and 1.4 GB of files.",
         "Delete Tilcerovi and everything in it"]
      ],
      primary: "", secondary: [],
      exempt: true,
      states: {
        readonly: { tone: "warning", title: "Read-only \u2014 all four of these still work", body: "Export, restriction, transfer and deletion are exempt from the billing gate. A household must be able to take its data and leave in any state." }
      },
      impossible: {
        empty: "Four actions, always all four.",
        pending: "None of these four is written offline.",
        syncing: "Same reason.",
        conflicted: "Two owners cannot hold conflicting versions of a deletion request; the server holds one.",
        rejected: "A refusal here is stated on the screen with the reason, not held for later."
      },
      foot: "Restriction sits here rather than under billing, because it is not a billing action.",
      note: "The order is the argument: the thing that costs a household nothing is first, and the irreversible one is last. Restriction is Article 18 made self-service, so it lives beside export and deletion where somebody looking for their rights will find it.",
      drawn: ["loading", "populated", "error", "offline", "absent", "withdrawn", "readonly"] },

    { id: "C-57", view: "settings", client: "mw", preset: "D", route: "/households/tilcerovi/settings/advanced",
      name: "Settings \u00a78 \u2014 advanced", title: "Clients and versions", kind: "devices",
      lede: "Useful when one person sees something the others do not.",
      devices: [
        { name: "Household 1.4.2 \u00b7 iPhone 13 \u00b7 Jana", meta: "API v1 \u00b7 current \u00b7 seen 18:41", tone: "ok", action: "" },
        { name: "Household 1.4.2 \u00b7 iPad \u00b7 shared", meta: "API v1 \u00b7 current \u00b7 seen yesterday 21:03", tone: "ok", action: "" },
        { name: "Household 1.2.0 \u00b7 Pixel 6 \u00b7 Petr", meta: "API v1 \u00b7 two versions behind \u00b7 seen 17:58", tone: "pending", action: "" },
        { name: "Web \u00b7 Chrome 141 \u00b7 Jana", meta: "Always current \u00b7 seen 16:12", tone: "ok", action: "" }
      ],
      primary: "", secondary: ["Sync health"],
      states: {
        readonly: { tone: "warning", title: "Read-only", body: "Nothing on this screen writes anything." }
      },
      impossible: {
        empty: "There is always at least the client you are reading this on.",
        pending: "Nothing here is written from a client.",
        syncing: "Same reason.",
        conflicted: "A version number is reported, not edited.",
        rejected: "Nothing is written.",
        withdrawn: "Reading this needs the settings grant, which is the absent state."
      },
      foot: "A client two versions behind is a fact, not a warning. The update wall is a different screen and a different threshold.",
      note: "This exists for one sentence in a support conversation: which of these five people is on which build. It sits next to sync health because the two questions arrive together.",
      drawn: ["loading", "populated", "error", "offline", "absent", "readonly"] },

    { id: "F-20", view: "settings", client: "mw", preset: "D", route: "/account/notifications",
      name: "Notification permission + categories", title: "Notifications", kind: "toggles",
      lede: "The phone\u2019s permission and your four categories, on one screen.",
      notice: { tone: "warning", title: "This phone is not allowing notifications",
        body: "iOS is blocking all of them, so the four settings below have no effect until that changes. Everything still appears in the app." },
      toggles: [
        ["Someone messages or mentions me", 1, "direct"],
        ["Something happens in the household", 1, "household"],
        ["Reminders I subscribed to", 1, "reminders"],
        ["The weekly digest", 0, "digest"],
        ["Quiet hours \u00b7 22:00\u201307:00", 1, "your own timezone, not the household\u2019s"]
      ],
      primary: "Open iOS settings",
      secondary: ["Turn all of mine off"],
      states: {
        readonly: { tone: "warning", title: "Read-only", body: "Notification preferences are personal and are not household writes, so they keep working." }
      },
      impossible: {
        empty: "Four categories, always all four.",
        conflicted: "These are personal preferences. Nobody else edits them.",
        withdrawn: "Personal, not household-scoped: there is no grant to lose."
      },
      foot: "Permission is asked the first time something implies wanting to be told \u2014 never on first launch.",
      note: "One screen, because \u201cnotifications are off\u201d has one diagnosis and it is usually the operating system. Showing the four categories under a blocked permission is what makes the sentence above them believable.",
      drawn: ["loading", "populated", "error", "offline", "pending", "syncing", "rejected", "absent", "readonly"] }
  ];

  /* ── the gate, computed from the data above ─────────────────────────────── */

  function matrixLabels() {
    /* Every phrase that reaches a screen from the matrix, the acceptance list and the
       member list. The API words must appear in none of them. */
    var out = [];
    LEVELS.forEach(function (l) { out.push(l[1]); });
    acceptanceGroups(2).forEach(function (g) { out.push(g.phrase); });
    ["jana", "petr", "adam", "klara", "milos"].forEach(function (id) {
      matrixFor(id).forEach(function (r) { out.push(r.phrase); });
    });
    return out;
  }

  function enumLeaks() {
    var words = LEVEL_ORDER;
    var leaks = [];
    matrixLabels().forEach(function (s) {
      words.forEach(function (w) {
        if (String(s).toLowerCase().indexOf(w) >= 0 && leaks.indexOf(s) < 0) leaks.push(s);
      });
    });
    return leaks;
  }

  function dateLeaks() {
    /* Only read_only and canceled may name the deletion date. */
    return BANNERS.filter(function (b) {
      var has = b.body.indexOf(DELETION_DATE) >= 0;
      var allowed = b.key === "read_only" || b.key === "canceled";
      return has !== allowed;
    }).map(function (b) { return b.key + (b.stage ? " (" + b.stage + ")" : ""); });
  }

  function liftGaps() {
    return LIFT.filter(function (l) {
      var landing = l[1].replace("_", "-");
      var says = l[2].toLowerCase();
      if (l[1] === "active" || l[1] === "trialing") return says.indexOf("comes back") < 0 && says.indexOf("runs to") < 0;
      if (l[1] === "read_only" || l[1] === "canceled") return says.indexOf("read-only") < 0;
      if (l[1] === "grace") return says.indexOf("upload") < 0;
      if (l[1] === "past_due") return says.indexOf("payment") < 0;
      if (l[1] === "suspended") return says.indexOf("locked") < 0;
      return landing.length === 0;
    }).map(function (l) { return l[0]; });
  }

  function exportReach() {
    /* Which states a household can export from: every one whose read is allowed. */
    return ENT.filter(function (e) { return e[1] === 1; }).map(function (e) { return e[0]; });
  }

  function lockoutExportAffordance() {
    var s = SCREENS.filter(function (x) { return x.id === "A-31"; })[0];
    var text = [s.primary].concat(s.secondary || []).join(" ").toLowerCase();
    return text.indexOf("export") >= 0;
  }

  function destructiveGaps() {
    return DESTRUCTIVE.filter(function (d) {
      return d[2].toLowerCase().indexOf(d[1].toLowerCase()) < 0 && d[1] !== "Tilcerovi";
    }).map(function (d) { return d[0]; });
  }

  function checks() {
    var leaks = enumLeaks();
    var dates = dateLeaks();
    var lifts = liftGaps();
    var banners = ENT.filter(function (e) { return e[5] === "banner"; }).length;
    var silent = ENT_BY["active"][5] === "nothing";
    var lockout = ENT_BY["suspended"][5] === "lockout";
    var reach = exportReach();
    var dGaps = destructiveGaps();
    var blocks = blocksFor(STORAGE.mtdAverage);
    var proj = blocksFor(STORAGE.projectedAverage);

    return [
      { name: "The grant matrix reads without a legend",
        detail: MODULES.length + " rows, each carrying its own phrase in words a member already knows. The four API levels appear in " +
          (leaks.length ? leaks.join(", ") : "none of the " + matrixLabels().length + " labels that reach a screen") +
          " \u2014 scanned, not asserted.",
        pass: leaks.length === 0 },

      { name: "Six of the eight states are banners; active is silent and suspended is a lockout",
        detail: banners + " banner states, " + BANNERS.length + " drawings (trialing has two stages, DD-9). active resolves to " +
          ENT_BY["active"][5] + " and suspended to " + ENT_BY["suspended"][5] + ".",
        pass: banners === 6 && silent && lockout },

      { name: "Only read-only and cancelled carry a deletion date",
        detail: dates.length ? "Wrong on: " + dates.join(", ")
          : "The date appears in exactly two of the seven banners. Grace and restricted name no date, because nothing there is at risk.",
        pass: dates.length === 0 },

      { name: "Lifting a restriction names the state it lands in",
        detail: lifts.length ? "Silent about the landing state: " + lifts.join(", ")
          : LIFT.length + " underlying states, and each lift control says what the household will actually be in \u2014 including the two where lifting restores nothing.",
        pass: lifts.length === 0 },

      { name: "Export is reachable in every state but suspended, and the lockout offers no button",
        detail: reach.length + " of 8 states can export (" + reach.join(", ") +
          "); suspended refuses reads, and the lockout " +
          (lockoutExportAffordance() ? "still offers an export control." : "says so instead of offering a control that would fail (DD-15)."),
        pass: reach.length === 7 && !lockoutExportAffordance() },

      { name: "Every destructive confirmation names its object in the button",
        detail: dGaps.length ? "Unnamed in: " + dGaps.join(", ")
          : DESTRUCTIVE.length + " confirmations, each naming the household, member, module or code in the control itself and counting what goes.",
        pass: dGaps.length === 0 },

      { name: "The storage charge is arithmetic on the samples",
        detail: "Month-to-date average " + STORAGE.mtdAverage + " GB \u2192 " + blocks + " blocks \u2192 " +
          STORAGE.currency + blocks.toFixed(2) + ". Projected " + STORAGE.projectedAverage + " GB \u2192 " + proj +
          " blocks. Recomputed on render from the same formula the invoice uses.",
        pass: blocks === 2 && proj === 2 }
    ];
  }

  /* Which of the twelve states can occur on each surface, computed from the screens. */
  function occurrence() {
    return SCREENS.filter(function (s) { return s.preset === "D"; }).map(function (s) {
      var imp = Object.keys(s.impossible || {});
      return { id: s.id, name: s.name, possible: 12 - imp.length, drawn: s.drawn.length,
               impossible: imp, reasons: s.impossible || {} };
    });
  }

  var OPEN = [
    ["The twelve-state preset \u2014 settled",
     "One D preset stays, and a row may now declare the states its own surface cannot reach, each with the reason. The exclusions live next to the screen that argues them \u2014 the thirteen rows here carry theirs in this file and draw the reason where the state would have been \u2014 and ledger.js mirrors them to compute coverage, with a mismatch check so the mirror cannot drift. Every Stage 8 row is now drawn in all of its reachable states; Stages 5 and 6 keep four part-drawn rows, which is eighteen genuinely undrawn cells rather than an argument about presets.",
     "resolved in Stage 8 \u00b7 the eighteen cells were drawn in Stage 20"],

    ["The subscription is priced in euro everywhere \u2014 settled",
     "04-billing \u00a71 named the EUR and GBP figures and said CZK and PLN were set on the same basis, local anchors rather than FX, without giving them. Settled: there are no local anchors. The subscription is priced and billed in EUR in every market, so this Czech household sees \u20ac4.99 on subscribe, manage billing and take-over, and the storage block is \u20ac1.00. The household\u2019s own money is untouched \u2014 Finance and Utilities still count in CZK, which is the currency it is asked about at creation.",
     "resolved \u00b7 A-27, A-28, A-29 copy unblocked"],

    ["Two different seventeens \u2014 settled",
     "FR-AC3 wins. The seventeen grantable modules are its seventeen, Household settings among them under the key admin that foundations.js and icons.js already used, and Today is not one of them: it is a cross-cutting screen with a route, a tab slot and nothing to grant. fixtures.js was corrected, nav.js now treats Dashboard alone as the platform destination inside the module list, and the counts every screen quotes are computed from the corrected list. Sixteen modules can be enabled or disabled; seventeen can be granted; nineteen have a navigation icon.",
     "resolved in Stage 8 \u2014 Stage 10 builds its catalog off the seventeen"],

    ["Household settings \u00a74 is Phase 2, so this stage draws seven of the eight sections",
     "05-screens \u00a7C puts the notification composer, its per-language templates, the delivery log and the test send in P2 with Stage 14. \u00a71, \u00a72, \u00a73, \u00a75, \u00a76, \u00a77 and \u00a78 are here. The gap is labelled on the settings rail rather than left as an omission somebody later reads as an oversight.",
     "by design \u2014 Stage 14 closes it"]
  ];

  window.HH_HOUSEHOLD = {
    version: "0.1-stage-8-candidate",
    allStates: ALL_STATES,
    ent: ENT, entBy: ENT_BY, deletionDate: DELETION_DATE,
    banners: BANNERS, lift: LIFT,
    levels: LEVELS, phrase: PHRASE, levelOrder: LEVEL_ORDER,
    modules: MODULES,
    defaultCounts: defaultCounts,
    acceptanceGroups: acceptanceGroups,
    matrixFor: matrixFor,
    storage: STORAGE, blocksFor: blocksFor, chargeFor: chargeFor,
    rights: RIGHTS, bundle: BUNDLE, devices: DEVICES,
    destructive: DESTRUCTIVE, leave: LEAVE, price: PRICE,
    treatments: TREATMENTS,
    screens: SCREENS,
    checks: checks,
    occurrence: occurrence,
    open: OPEN
  };
})();
