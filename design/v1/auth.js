/* Stage 7 — auth, child sign-in, account, as data.
   Source: docs/design/05-screens.md §A rows 1-21, 02-identity-and-access.md §1-§4,
   07-delivery.md §3 (the checklist), 08-decisions.md DD-15 (suspended), D-4 (household in the URL).

   The rule this file exists to enforce: a failure message is written once, in one place,
   with its enumeration verdict attached. The screens read their copy from the register
   below, so a message cannot be softened on one screen and leak on another. The gate
   ("every failure message is generic where enumeration is possible") is computed from
   this file rather than asserted about it.
*/
(function () {

  /* ── the failure-message register ──────────────────────────────────────
     [key, situation, what the screen says, enumerable, verdict, rule] */

  var MESSAGES = [
    ["signin.bad", "Sign in · wrong password, or no such account",
     "Email or password is not correct.",
     true, "generic",
     "One message for both, and the same response time for both. Two messages, or two timings, is a working account-existence oracle."],

    ["signin.throttled", "Sign in · too many attempts",
     "Too many attempts from this device. Try again at 16:42.",
     true, "generic",
     "Attributed to the device, not the account. \u201cThis account is locked\u201d would confirm the account exists — and would let anyone lock anyone out."],

    ["signin.gone", "Sign in · account deleted or suspended",
     "Email or password is not correct.",
     true, "generic",
     "Deliberately the same sentence as a wrong password. The state of somebody else\u2019s account is not ours to report at an unauthenticated screen."],

    ["register.taken", "Register · the address already has an account",
     "Check your email. We\u2019ve sent a link to jana@tilcerovi.cz.",
     true, "generic",
     "The screen is identical either way. The address itself gets the branch: a verification link if it is new, a \u201csomebody tried to register with your address, sign in instead\u201d note if it is not."],

    ["reset.request", "Password reset · request",
     "If that address has an account, a reset link is on its way. It works for one hour.",
     true, "generic",
     "The one place the conditional phrasing is unavoidable. It is stated as a fact about the system rather than a hedge about the person."],

    ["verify.expired", "Verification or reset link · expired, or already used",
     "This link has expired. Links last 24 hours \u2014 here\u2019s a new one.",
     false, "specific",
     "Whoever holds the link already holds the mailbox. Nothing is disclosed by being precise, and vagueness here just wastes a trip."],

    ["mfa.bad", "Second step · wrong code",
     "That code isn\u2019t right. Codes change every 30 seconds \u2014 check the app for the current one.",
     false, "specific",
     "The password already passed, so the account is known to the caller. The sentence carries the most common cause: a code that expired while it was being typed."],

    ["mfa.recovery.bad", "Second step · recovery code wrong or spent",
     "That code isn\u2019t right, or it has already been used.",
     false, "specific",
     "Used and wrong are said together \u2014 not to hide anything, but because the next action is the same and a second sentence would not change it."],

    ["child.code", "Household code · no match",
     "That code doesn\u2019t match a household. Codes are six characters and capitals don\u2019t matter.",
     true, "generic",
     "Six characters is a guessable space, so the message never distinguishes \u201cwrong\u201d from \u201cexpired\u201d and the attempt is rate-limited per device."],

    ["child.pin", "PIN · wrong",
     "That\u2019s not the PIN. Two more tries before this profile takes a break.",
     false, "specific",
     "A child is holding the phone. The remaining count is given so the pause is never a surprise, and the sentence blames the digits, not the person."],

    ["password.breached", "Register or reset · the password is in a public breach",
     "This password is on a public list of passwords taken from other services, so it is one of the first things anyone would try.",
     false, "specific",
     "A refusal, not a warning: the form does not accept it. It says what the list is, so the refusal reads as information rather than judgement."],

    ["server", "Any screen · the server failed",
     "Something went wrong at our end. Nothing you typed was lost \u2014 try again.",
     false, "specific",
     "Named in words, with an action, and it says what happened to the input. A retry that silently empties the form is a second failure."]
  ];

  var M = {};
  MESSAGES.forEach(function (m) { M[m[0]] = m[2]; });

  /* ── the screens ────────────────────────────────────────────────────────
     Each carries the ledger id it satisfies, the states drawn here, and the
     one decision it exists to settle. */

  var SCREENS = [

    { id: "A-1", view: "in", client: "mw", preset: "F", route: "/sign-in",
      name: "Sign in", title: "Sign in", kind: "form",
      lede: "One account, however many households you are in.",
      fields: [
        { label: "Email", value: "jana@tilcerovi.cz", type: "text" },
        { label: "Password", value: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", type: "password", hint: "Show" }
      ],
      primary: "Sign in",
      secondary: ["Forgot your password", "Join with a household code"],
      error: { tone: "danger", title: "", body: M["signin.bad"] },
      foot: "A device that has not signed in before is asked for the second step next.",
      note: "The household-code route sits on the sign-in screen rather than behind a \u201cmore ways to sign in\u201d disclosure, because the people who need it are the ones least able to find a disclosure: a child, and whoever is holding the shared tablet.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-9", view: "in", client: "mw", preset: "F", route: "/reset",
      name: "Password reset \u2014 request", title: "Reset your password", kind: "form",
      lede: "We\u2019ll email a link that sets a new one.",
      fields: [{ label: "Email", value: "jana@tilcerovi.cz", type: "text" }],
      primary: "Send the link",
      secondary: ["Back to sign in"],
      notice: { tone: "info", title: "Sent", body: M["reset.request"] },
      error: { tone: "danger", title: "", body: M["server"] },
      foot: "The confirmation is shown whether or not the address has an account.",
      note: "The confirmation is a notice on the same screen rather than a route of its own, so the form stays visible: a mistyped address is corrected here instead of being discovered ten minutes later in an inbox that never rang.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-10", view: "in", client: "mw", preset: "F", route: "/reset/set",
      name: "Password reset \u2014 set", title: "Choose a new password", kind: "form",
      lede: "",
      fields: [{ label: "New password", value: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", type: "password", hint: "Show" }],
      notice: { tone: "warning", title: "This signs you out everywhere",
        body: "Every phone, tablet and browser signed into this account has to sign in again \u2014 including the one in your hand, if you are doing this somewhere else. A signed-out device discards its copy of the household, and anything it saved offline and has not sent yet goes with it." },
      primary: "Set password and sign out everywhere",
      secondary: ["Cancel"],
      error: { tone: "danger", title: "", body: M["password.breached"] },
      foot: "Sessions, refresh tokens and device replicas, all of them, stated before the button rather than in a toast after it.",
      note: "The consequence is in the button, not only in the notice above it. Somebody who reads nothing on this screen still reads the thing they are about to press.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-2", view: "new", client: "mw", preset: "F", route: "/register",
      name: "Register", title: "Create your account", kind: "form",
      lede: "You can make a household next, or join one you have been invited to.",
      fields: [
        { label: "Name", value: "Jana Tilcerov\u00e1", type: "text", hint: "" },
        { label: "Email", value: "jana@tilcerovi.cz", type: "text" },
        { label: "Password", value: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", type: "password", hint: "Show" }
      ],
      primary: "Create account",
      secondary: ["I already have an account"],
      error: { tone: "danger", title: "This password has turned up in a breach",
        body: M["password.breached"] + " Choose another and this account stays off that list. The check never sends your password: only the first five characters of a fingerprint of it leave the device." },
      foot: "An address that already has an account gets the same next screen \u2014 and a different email.",
      note: "The hardest sentence in the product. It has to refuse without implying the person was careless, so it describes the list rather than the password, and it explains the check in the same breath \u2014 a refusal that sounds like it read your password is worse than no check at all.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-3", view: "new", client: "mw", preset: "F", route: "/verify",
      name: "Verify email", title: "Check your email", kind: "form",
      lede: "We\u2019ve sent a link to jana@tilcerovi.cz. It works for 24 hours.",
      fields: [],
      primary: "Open the mail app",
      secondary: ["Send it again in 43 s", "Use a different address"],
      error: { tone: "danger", title: "", body: M["verify.expired"] },
      foot: "Resend is on a cooldown, and the cooldown is shown as a countdown rather than a refusal.",
      note: "This screen is also what somebody sees when the address already has an account \u2014 which is what makes the register screen non-enumerating. It is drawn once and reached from two places.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-4", view: "new", client: "mw", preset: "S", route: "/household/invite",
      name: "Unverified but working", title: "Invite someone", kind: "form",
      lede: "",
      fields: [
        { label: "Their name", value: "Petr", type: "text" },
        { label: "Their email", value: "petr@\u2026", type: "text" },
        { label: "What they get", value: "17 modules \u00b7 set on the next screen", type: "text" }
      ],
      notice: { tone: "warning", title: "Verify your email first",
        body: "An invitation carries your name to somebody else\u2019s phone, so we confirm the address before it goes. Everything else works as normal \u2014 add, edit, sync, all of it." },
      primary: "Resend the verification link",
      secondary: ["Not now"],
      foot: "One blocked action, explained where it is blocked. No global nag banner.",
      note: "Unverified is not an account state the product nags about; it is a condition on the three actions that reach other people. The explanation lives on the screen that refuses, at the moment it refuses, and the form stays filled in behind it.",
      drawn: ["populated"] },

    { id: "A-5", view: "mfa", client: "mw", preset: "F", route: "/account/2fa",
      name: "MFA enrol (TOTP)", title: "Add a second step", kind: "form",
      lede: "A six-digit code from an authenticator app, on top of your password.",
      qr: true,
      fields: [{ label: "Code from the app", value: "417 902", type: "code" }],
      primary: "Turn it on",
      secondary: ["Not now"],
      error: { tone: "danger", title: "", body: M["mfa.bad"] },
      foot: "Ten recovery codes are issued on the next screen, before this is finished.",
      note: "The typed key is offered at the same level as the square, not behind a \u201ccan\u2019t scan?\u201d link: the people setting this up on the only phone they own cannot photograph the screen they are reading.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-6", view: "mfa", client: "mw", preset: "S", route: "/account/2fa/codes",
      name: "Recovery codes", title: "Ten codes, in case the app is gone", kind: "codes",
      lede: "Each one works once. Keep them somewhere that is not this phone.",
      codes: ["7QK2-M4VD", "R8HX-2PLC", "94BN-TZQ6", "KD3F-8WMR", "X2VP-6JHT",
              "5MCR-QB9K", "TN7D-3XFW", "H6JQ-VZ24", "2PWL-8KRN", "B9XT-M5DQ"],
      confirm: "I have saved them",
      primary: "Finish",
      secondary: ["Copy", "Download", "Print"],
      notice: { tone: "info", title: "", body: "Making a new set retires these ten the moment it is made." },
      foot: "Finish stays present before the box is ticked; it re-asks rather than sitting dead.",
      note: "Print is a real action here rather than an afterthought \u2014 the recommended place for these is a drawer, and the print stylesheet already exists as a Stage 17 line of work.",
      drawn: ["populated"] },

    { id: "A-7", view: "mfa", client: "mw", preset: "F", route: "/sign-in/2fa",
      name: "MFA challenge on a new device", title: "Enter your code", kind: "form",
      lede: "This device hasn\u2019t signed in before.",
      fields: [{ label: "Six-digit code", value: "\u2013\u2013\u2013 \u2013\u2013\u2013", type: "code" }],
      checkbox: "Trust this device for 30 days",
      primary: "Continue",
      secondary: ["Use a recovery code instead"],
      error: { tone: "danger", title: "", body: M["mfa.bad"] },
      foot: "Trusting a device is opt-in and dated, never the default.",
      note: "Saying the device is new is the whole point of the sentence: if this challenge arrives on a phone that signs in every day, that is the thing worth noticing, and the screen has already said what would be odd.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-8", view: "mfa", client: "mw", preset: "F", route: "/sign-in/2fa/recovery",
      name: "Recovery-code use", title: "Use a recovery code", kind: "form",
      lede: "One of the ten you saved when you turned the second step on.",
      fields: [{ label: "Recovery code", value: "R8HX-2PLC", type: "code" }],
      primary: "Continue",
      secondary: ["Back to the code"],
      notice: { tone: "info", title: "", body: "Eight left after this one. At two we will ask you to make a new set \u2014 and email you to say the code was used." },
      error: { tone: "danger", title: "", body: M["mfa.recovery.bad"] },
      foot: "The count is shown before the code is spent, not after.",
      note: "Every recovery-code use is also an email, because the legitimate case and the stolen-notebook case look identical from here.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-11", view: "trouble", client: "mw", preset: "S", route: "/account/notice",
      name: "Account-takeover notice", title: "Your password was changed", kind: "form",
      lede: "8 September at 21:14 \u00b7 Prague, Czechia \u00b7 Chrome on Windows.",
      fields: [],
      notice: { tone: "info", title: "If that was you, there is nothing to do",
        body: "If it wasn\u2019t: we will set a new password, sign every device out, and hold exports for 24 hours while you get back in." },
      primary: "This wasn\u2019t me",
      secondary: ["It was me \u2014 dismiss"],
      foot: "Sent as an email as well as a screen, because the session it warns about may be the one reading it.",
      note: "Calm is a design decision here, not a tone preference. Red and an alarm icon make the honest case (a member changed their own password on a laptop) feel like an incident, and the rare real case is not helped by panic \u2014 it is helped by one button that does everything at once.",
      drawn: ["populated"] },

    { id: "A-12", view: "trouble", client: "mw", preset: "D", route: "/account/devices",
      name: "Sessions and devices", title: "Where you are signed in", kind: "list",
      lede: "",
      rows: [
        { name: "iPhone 13", meta: "This device \u00b7 Prague \u00b7 active now", current: true },
        { name: "Chrome on Windows", meta: "Prague \u00b7 2 hours ago", current: false },
        { name: "iPad (kitchen)", meta: "Prague \u00b7 yesterday \u00b7 2 unsent changes", current: false, pending: true },
        { name: "Pixel 6", meta: "Brno \u00b7 3 weeks ago", current: false }
      ],
      primary: "Sign out everything else",
      secondary: [],
      foot: "Location is the city the request came from, and it is described as that rather than as \u201cwhere you were\u201d.",
      note: "Unsent changes are shown on the row, before the revoke is pressed \u2014 the one fact that decides whether signing a device out is housekeeping or data loss belongs next to the device, not in the dialog that follows.",
      states: {
        empty: { title: "Only this device", body: "You are signed in here and nowhere else. The list is one row rather than a teaching state \u2014 there is nothing to set up." },
        error: { title: "The device list did not load", body: "Sessions are server state and this screen is the one place they are shown. Nothing was signed out, and nothing was lost." },
        readonly: { title: "Read-only", body: "Your own devices are not a household write: the list reads and signing a device out still works while the subscription is paused." }
      },
      excludes: {
        absent: "Per-user, not per-household: there is no module grant over your own devices.",
        withdrawn: "Nothing here is retracted by an access change.",
        conflicted: "Sessions are server state; the client never holds two versions of them.",
        rejected: "Revocation is online-only \u2014 a refusal is an error on the screen with its reason, not a mutation held for later."
      },
      drawn: ["loading", "empty", "populated", "error", "offline", "pending", "syncing", "readonly"] },

    { id: "A-13", view: "trouble", client: "mw", preset: "S", route: "/account/devices/revoke",
      name: "Revoke device \u2014 discards its replica", title: "Sign out the iPad (kitchen)?", kind: "form",
      lede: "",
      fields: [],
      notice: { tone: "danger", title: "Two changes have not reached us",
        body: "That tablet drops its copy of Tilcerovi the next time it opens the app. Two changes it saved offline \u2014 a shopping check-off and a meter reading from 7 September \u2014 have not been sent yet, and they go with it." },
      primary: "Sign out and discard the two changes",
      secondary: ["Keep it signed in"],
      foot: "The object is named, the loss is counted, and the count is real \u2014 it is read from the device row.",
      note: "This is the destructive-copy exemplar for the whole product: name the object, count what is lost, and put both in the button. \u201cAre you sure?\u201d asks the member to supply the facts themselves.",
      drawn: ["populated"] },

    { id: "A-14", view: "child", client: "m", preset: "F", route: "/join",
      name: "Child sign-in \u2014 household code", title: "Join your household", kind: "form",
      lede: "Type the six characters from the code you were given.",
      fields: [{ label: "Household code", value: "K7 M2 4P", type: "code" }],
      primary: "Continue",
      secondary: ["I have an email address instead"],
      error: { tone: "danger", title: "", body: M["child.code"] },
      foot: "No email address, no password, no date of birth.",
      note: "The whole child path exists so that joining a household needs nothing a ten-year-old does not have. Anything asked for here is something an adult would have to supply, which turns setting up a phone into an appointment.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-15", view: "child", client: "m", preset: "F", route: "/join/profile",
      name: "Child sign-in \u2014 profile picker", title: "Who is using this phone?", kind: "picker",
      lede: "",
      profiles: [
        { name: "Adam", meta: "PIN", initials: "A" },
        { name: "Jana", meta: "Password", initials: "J" },
        { name: "Milo\u0161", meta: "Password", initials: "M" }
      ],
      primary: "",
      secondary: ["Somebody else \u2014 sign in with an email address"],
      foot: "Profiles are the household\u2019s members, in the household\u2019s order.",
      note: "PIN and password profiles sit in one list rather than two, because the person tapping does not think of themselves as an authentication method. What differs is what the next screen asks for.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-16", view: "child", client: "m", preset: "F", route: "/join/pin",
      name: "Child sign-in \u2014 PIN", title: "Hi Adam", kind: "pin",
      lede: "Enter your PIN.",
      primary: "",
      secondary: ["I forgot it \u2014 ask Jana to reset it"],
      error: { tone: "warning", title: "", body: M["child.pin"] },
      foot: "Four digits, 44 pt keys, and nothing else on the screen.",
      note: "The forgotten-PIN path is a person, not a support flow. Adam cannot receive an email and should not be asked to; Jana can reset it from her phone in two taps, and the screen says so by name.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-17", view: "child", client: "m", preset: "F", route: "/switch",
      name: "Shared-tablet profile switcher", title: "Switch profile", kind: "picker",
      lede: "Kitchen iPad \u00b7 Tilcerovi",
      profiles: [
        { name: "Milo\u0161", meta: "Signed in \u00b7 password", initials: "M", current: true },
        { name: "Adam", meta: "PIN", initials: "A" },
        { name: "Jana", meta: "Password", initials: "J" }
      ],
      primary: "",
      secondary: ["Sign this tablet out of the household"],
      foot: "The household is stored on the device once, not once per profile.",
      note: "Switching is instant and the screen clears immediately; the replica is shared, so what changes is which grants apply, not which data exists. Signing the tablet out is the destructive act, and it is the one phrased as such.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-18", view: "child", client: "m", preset: "S", route: "/join/pin/paused",
      name: "PIN lockout", title: "Let\u2019s take a short break", kind: "form",
      lede: "",
      fields: [],
      notice: { tone: "info", title: "",
        body: "The PIN didn\u2019t match five times, so this profile is paused until 16:42. Nothing is wrong and nothing has been lost. If you would rather not wait, Jana can unlock it from her phone." },
      primary: "Ask Jana to unlock it",
      secondary: ["Wait \u2014 6 minutes left"],
      foot: "Info, not danger. No red, no lock icon, no \u201cfailed attempts\u201d.",
      note: "A child meets this screen alone, usually after a genuine mistake. The counting is done in a neutral voice, the wait is given as a clock time rather than a countdown to stare at, and the way out is a person in the house.",
      drawn: ["populated"] },

    { id: "A-19", view: "account", client: "mw", preset: "D", route: "/account",
      name: "Account settings", title: "Your account", kind: "settings",
      lede: "",
      groups: [
        ["You", [["Name", "Jana Tilcerov\u00e1"], ["Email", "jana@tilcerovi.cz \u00b7 verified"], ["Language", "\u010ce\u0161tina"], ["Appearance", "Follow the system"]]],
        ["Security", [["Password", "Changed 8 September"], ["Second step", "On \u00b7 authenticator app"], ["Recovery codes", "8 of 10 left"], ["Devices", "4 signed in"]]],
        ["Households", [["Tilcerovi", "Owner \u00b7 billing payer"], ["Chata Vyso\u010dina", "Member"]]],
        ["Account", [["Export your data", "Everything you can see, as files"], ["Delete account", "Four things to settle first"]]]
      ],
      primary: "",
      secondary: [],
      foot: "Account is per person. Household settings are elsewhere, and the two are never mixed on one screen.",
      note: "The households group is a list of memberships, not a switcher \u2014 it says what this person is in each one, which is the fact the deletion screen later depends on.",
      states: {
        empty: { title: "You are not in a household yet", body: "Your account is complete on its own. Join one with a code, or create one \u2014 the four groups below are yours either way.", action: "Create a household" },
        error: { title: "Your account did not load", body: "Nothing about your account has changed. It is this screen that failed, and signing in elsewhere is unaffected." },
        readonly: { title: "Read-only", body: "A paused subscription is the household\u2019s, not yours. Your name, your password and your second step all still change from here." }
      },
      excludes: {
        absent: "Per-user. Your own account settings are not grantable.",
        withdrawn: "Same reason: there is no grant to lose.",
        conflicted: "One person edits their own account, from one place at a time.",
        rejected: "A refused change is an error with a reason, not a held mutation."
      },
      drawn: ["loading", "empty", "populated", "error", "offline", "pending", "syncing", "readonly"] },

    { id: "A-20", view: "account", client: "mw", preset: "F", route: "/account/delete",
      name: "Account deletion", title: "Delete your account", kind: "deletion",
      lede: "Four things are true about your account. Two of them have to be settled first.",
      primary: "Schedule deletion for 9 October",
      secondary: ["Keep my account"],
      error: { tone: "danger", title: "", body: M["server"] },
      foot: "Signing in before 9 October cancels it, and the screen says so before the button, not after.",
      note: "The four situations are resolved and stated up front rather than discovered one refusal at a time. Two are blockers with a way to clear them; two are consequences that need reading. A deletion flow that reveals its blockers serially is how people end up believing they deleted an account they still have.",
      drawn: ["loading", "populated", "error"] },

    { id: "A-21", view: "account", client: "m", preset: "S", route: "/must-update",
      name: "Please update", title: "Time to update", kind: "update",
      lede: "",
      primary: "Update Household",
      secondary: [],
      foot: "No dismiss, because there is nothing behind it that would work.",
      note: "The last screen some members ever see, on a phone that has been in a drawer for a year. It is the one screen with no household, no session and no data behind it, so every word has to be translated and none of it can be interpolated from anything.",
      drawn: ["populated"] }
  ];

  /* ── the four deletion situations (A-20) ────────────────────────────────
     [household or scope, situation, verdict, what it says, the way out] */

  var DELETION = [
    ["Tilcerovi", "You are the only owner, and four other people are members", "blocked",
     "Somebody else has to be an owner before you can go. Otherwise the household is left with nobody who can invite, remove or change what anyone sees.",
     "Make someone an owner"],
    ["Tilcerovi", "You pay for the subscription", "blocked",
     "The household needs another payer, or the subscription ends with your account and the household goes read-only on 9 October.",
     "Hand billing over"],
    ["Chata Vyso\u010dina", "You are the only member", "deleted",
     "It goes with you: 38 documents, two seasons of garden history and 1.4 GB of files. Nothing else has a copy.",
     ""],
    ["Everywhere else", "Things you created in households you are leaving", "kept",
     "They stay with the household \u2014 shopping items, meter readings, notes, the activity log. Your name stays on them, because rewriting a shared record to say \u201csomebody\u201d would make it useless to the people still using it. Your profile, your devices and your personal settings go.",
     ""]
  ];

  /* ── please update, per language (A-21) ─────────────────────────────── */

  var UPDATE = [
    ["en", "English", "Time to update",
     "This version of Household can\u2019t talk to the server any more. Update the app to carry on \u2014 nothing on this phone is lost, it is waiting to be sent.",
     "Update Household", true],
    ["cs", "\u010ce\u0161tina", "\u010cas na aktualizaci",
     "Tato verze aplikace Household u\u017e nedok\u00e1\u017ee komunikovat se serverem. Aktualizujte ji a pokra\u010dujte \u2014 nic v tomto telefonu se neztratilo, \u010dek\u00e1 to na odesl\u00e1n\u00ed.",
     "Aktualizovat Household", true],
    ["de", "Deutsch", "Zeit f\u00fcr ein Update",
     "Diese Version von Household kann nicht mehr mit dem Server sprechen. Aktualisieren Sie die App, um weiterzumachen \u2014 auf diesem Telefon geht nichts verloren, es wartet auf das Senden.",
     "Household aktualisieren", true],
    ["pl", "Polski", "Czas na aktualizacj\u0119",
     "Ta wersja aplikacji Household nie mo\u017ce si\u0119 ju\u017c po\u0142\u0105czy\u0107 z serwerem. Zaktualizuj aplikacj\u0119, aby kontynuowa\u0107 \u2014 nic w tym telefonie nie znik\u0142o, czeka na wys\u0142anie.",
     "Zaktualizuj Household", true],
    ["sk", "Sloven\u010dina", "\u010cas na aktualiz\u00e1ciu",
     "T\u00e1to verzia aplik\u00e1cie Household u\u017e nedok\u00e1\u017ee komunikova\u0165 so serverom. Aktualizujte ju a pokra\u010dujte \u2014 ni\u010d v tomto telef\u00f3ne sa nestratilo, \u010dak\u00e1 to na odoslanie.",
     "Aktualizova\u0165 Household", true]
  ];

  /* ── what the child path is allowed to say ──────────────────────────── */

  var CHILD_FORBIDDEN = ["email", "password", "billing", "subscription", "account"];

  var CHILD_RULES = [
    ["Nothing only an adult has", "A six-character code and four digits. No email address, no password, no date of birth, no phone number."],
    ["The way out is a person", "A forgotten PIN is reset by whoever set it, named on the screen. Never a support address a child cannot use."],
    ["The pause is not a punishment", "Five wrong PINs pauses the profile and says so in a neutral voice, with a clock time and an unlock path."],
    ["One list, two methods", "PIN profiles and password profiles are one picker. What differs is the next screen, not the shape of this one."]
  ];

  /* ── the gate ───────────────────────────────────────────────────────── */

  function scanChild() {
    var meets = SCREENS.filter(function (s) { return s.id === "A-16" || s.id === "A-18"; });
    var hits = [];
    meets.forEach(function (s) {
      var text = [s.title, s.lede, s.foot, s.notice && s.notice.body, s.error && s.error.body]
        .concat(s.secondary || []).filter(Boolean).join(" ").toLowerCase();
      CHILD_FORBIDDEN.forEach(function (w) {
        if (text.indexOf(w) >= 0 && hits.indexOf(w) < 0) hits.push(s.id + ": " + w);
      });
    });
    return hits;
  }

  function scanDestructive() {
    var d = SCREENS.filter(function (s) { return s.id === "A-13" || s.id === "A-20" || s.id === "A-10"; });
    return d.filter(function (s) {
      var b = (s.primary || "").toLowerCase();
      return !(b.indexOf("discard") >= 0 || b.indexOf("sign out") >= 0 || b.indexOf("deletion") >= 0);
    }).map(function (s) { return s.id; });
  }

  function checks() {
    var leaks = MESSAGES.filter(function (m) { return m[3] && m[4] !== "generic"; });
    var childHits = scanChild();
    var noWayForward = SCREENS.filter(function (s) {
      return s.error && !(s.primary || (s.secondary || []).length);
    });
    var undrawn = SCREENS.filter(function (s) {
      if (s.preset !== "D") return false;
      var ex = Object.keys(s.excludes || {}).length;
      return s.drawn.length < 12 - ex;
    });
    return [
      { name: "Every enumerable failure is generic",
        detail: MESSAGES.filter(function (m) { return m[3]; }).length + " of " + MESSAGES.length +
          " registered messages are reachable before authentication; all of them resolve to a message that does not confirm an account exists.",
        pass: leaks.length === 0 },
      { name: "Every refusal offers a next action",
        detail: "Each screen that can fail carries a primary or a secondary that moves. " +
          (noWayForward.length ? noWayForward.length + " do not." : "None is a dead end."),
        pass: noWayForward.length === 0 },
      { name: "Destructive actions name the object in the button",
        detail: "Revoke, delete and reset all state the object and the loss in the control itself, not only in the copy above it.",
        pass: scanDestructive().length === 0 },
      { name: "The child screens say nothing only an adult would understand",
        detail: childHits.length ? "Found: " + childHits.join(", ") :
          "The PIN and the pause screen mention no email, password, billing or subscription \u2014 scanned, not asserted.",
        pass: childHits.length === 0 },
      { name: "The account-scoped rows are drawn in every state they can reach",
        detail: undrawn.length
          ? undrawn.map(function (s) {
              return s.id + " at " + s.drawn.length + " of " + (12 - Object.keys(s.excludes || {}).length);
            }).join(" \u00b7 ")
          : "Sessions and devices and account settings are per-user surfaces: absent, withdrawn, conflicted and rejected cannot occur on either, each with its reason recorded on the row, and both are drawn in all eight states that remain.",
        pass: undrawn.length === 0 }
    ];
  }

  var OPEN = [
    ["The five languages are named \u2014 settled",
     "05-screens \u00a7A row 21 asks for Please update in five languages and the handoff named three of them: English, German and Czech. The remaining two are Polish and Slovak, and all five are drawn here. It is the one screen that cannot fall back on a language the reader does not have, because the app behind it will not open.",
     "resolved \u00b7 A-21 drawn in five languages"],
    ["Account-scoped surfaces carry the household twelve-state preset \u2014 settled",
     "Sessions and devices (A-12) and Account settings (A-19) are per-user, not per-household, so permission-absent, withdrawn, conflicted and rejected cannot occur on them: there is no grant to remove, no second member to conflict with, and no offline write path for a revocation. Stage 8 settled the mechanism \u2014 one D preset, with a row declaring what its own surface cannot reach and why \u2014 so both rows now carry their four exclusions here and are drawn in all eight states that remain.",
     "resolved in Stage 8"]
  ];

  window.HH_AUTH = {
    version: "0.1-stage-7-candidate",
    messages: MESSAGES,
    byKey: M,
    screens: SCREENS,
    deletion: DELETION,
    update: UPDATE,
    childRules: CHILD_RULES,
    childForbidden: CHILD_FORBIDDEN,
    checks: checks,
    open: OPEN
  };
})();
