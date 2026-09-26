/* Account and sign-in, live in the prototype shell (A-1 … A-34, F-20).
   Every screen works: fields validate, codes are checked, the child PIN pauses after five
   tries, devices sign out, deletion names what blocks it and then opens a 30-day window.
   The session lives in state.xs under acc_* keys; nothing here edits another module's data. */
(function () {
  var PIN = "1234", CODE = "TILC42", TOTP_OK = /^\d{6}$/, REC = ["7F3K-9QLM", "2HXV-8RTD", "Q4NB-6WYC", "M9PZ-3KJE", "T6DF-1VAS", "B8LR-5GUN", "X2CW-7HPY", "K5JM-4ZQT", "R1EV-9DXB", "N7GS-2LFW"];
  var BARE = { "sign-in": 1, register: 1, verify: 1, reset: 1, join: 1, switch: 1, "must-update": 1, locked: 1 };

  function view(self, seg, query, hash, wide) {
    var a0 = seg[0] || "", a1 = seg[1] || "", a2 = seg[2] || "";
    var path = "/" + seg.join("/");
    var ACC = { "/sign-in": 1, "/register": 1, "/verify": 1, "/household/invite": 1, "/account/2fa": 1, "/account/2fa/codes": 1, "/sign-in/2fa": 1,
      "/sign-in/2fa/recovery": 1, "/reset": 1, "/reset/set": 1, "/account/notice": 1, "/account/devices": 1, "/account/devices/revoke": 1, "/join": 1,
      "/join/profile": 1, "/join/pin": 1, "/switch": 1, "/join/pin/paused": 1, "/account": 1, "/account/delete": 1, "/must-update": 1, "/screens/a-30": 1,
      "/locked": 1, "/account/privacy": 1, "/account/notifications": 1 };
    if (!ACC[path]) return null;
    var K = window.HH_KIT(self), L = K.L, get = K.get, put = K.put, go = K.go;
    var s = self.state, F = K.F, me = K.memberOf(s.member) || { id: s.member, name: s.member };
    var H = window.HH_HOUSEHOLD, A = window.HH_AUTH, N = window.HH_NOTIFY;
    var q = {}; String(query || "").split("&").forEach(function (p) { var x = p.split("="); if (x[0]) q[x[0]] = decodeURIComponent(x[1] || ""); });
    var B = [], push = function (x) { if (x) B.push(x); };
    var P = { title: "", sub: "", blocks: B, bare: !!BARE[a0] && path !== "/account", center: !!BARE[a0], narrow: !!BARE[a0], back: "/account" };
    var email = get("acc_email", me.id + "@tilcerovi.cz");
    var twofa = get("acc_2fa", me.id === "jana");
    var err = function (k) { return get("acc_err_" + k, ""); };
    var setErr = function (k, v) { var o = {}; o["acc_err_" + k] = v; put(o); };
    var signedIn = function (who, t) {
      var patch = { acc_err_signin: "", acc_err_mfa: "", acc_bad: 0 };
      put(patch, { member: who || s.member, route: "/home" });
      K.toast(t || L("Signed in", "P\u0159ihl\u00e1\u0161eno"));
    };
    var owner = (F.members.filter(function (m) { return m.role === "owner"; })[0] || { name: "Jana" }).name;
    var brand = K.hero({ small: true, kicker: "Household", big: "", sub: "" });

    /* ── A-1 Sign in ── */
    if (path === "/sign-in") {
      P.title = L("Sign in", "P\u0159ihl\u00e1sit se");
      var bad = get("acc_bad", 0);
      push(K.hero({ small: true, kicker: "Household", big: L("Sign in", "P\u0159ihl\u00e1sit se"), sub: L("One account for every household you belong to.", "Jeden \u00fa\u010det pro v\u0161echny va\u0161e dom\u00e1cnosti.") }));
      if (bad >= 5) push(K.note(L("Too many tries from this device. Wait until " + clock(10) + " or reset the password \u2014 the wait is on this device, not on your account.",
        "P\u0159\u00edli\u0161 mnoho pokus\u016f z tohoto za\u0159\u00edzen\u00ed. Po\u010dkejte do " + clock(10) + " nebo obnovte heslo."), "boxWarn"));
      push(K.bound("acc_email", { label: L("Email", "E-mail"), def: email, placeholder: "name@example.com", mode: "email", type: "email" }));
      push(K.bound("acc_pw", { label: L("Password", "Heslo"), type: "password", placeholder: L("At least 10 characters", "Alespo\u0148 10 znak\u016f"), err: err("signin"),
        hint: L("Try any password. \u201cwrong\u201d shows the refusal.", "Zkuste libovoln\u00e9 heslo. \u201ewrong\u201c uk\u00e1\u017ee odm\u00edtnut\u00ed.") }));
      push(K.acts([K.btn(L("Sign in", "P\u0159ihl\u00e1sit"), "primary", function () {
        var e = String(get("acc_email", email)).trim(), p = String(get("acc_pw", ""));
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return setErr("signin", L("That email is missing something.", "V e-mailu n\u011bco chyb\u00ed."));
        if (!p) return setErr("signin", L("Enter your password.", "Zadejte heslo."));
        if (p === "wrong") return put({ acc_bad: bad + 1, acc_err_signin: L("That email and password don\u2019t match an account. The same answer is given whether or not the address exists.",
          "E-mail a heslo nesed\u00ed. Stejn\u00e1 odpov\u011b\u010f p\u0159ijde, a\u0165 adresa existuje, nebo ne.") });
        if (twofa) return put({ acc_err_signin: "" }, { route: "/sign-in/2fa" });
        signedIn();
      }, bad >= 5), K.btn(L("Forgot your password", "Zapomenut\u00e9 heslo"), "", go("/reset"))]));
      push(K.label(L("Or", "Nebo")));
      push(K.acts([K.btn(L("Continue with Google", "Pokra\u010dovat p\u0159es Google"), "", function () { signedIn(null, L("Signed in with Google", "P\u0159ihl\u00e1\u0161eno p\u0159es Google")); }),
        K.btn(L("Continue with Apple", "Pokra\u010dovat p\u0159es Apple"), "", function () { signedIn(null, L("Signed in with Apple", "P\u0159ihl\u00e1\u0161eno p\u0159es Apple")); })]));
      push(K.rows([K.row({ title: L("A child, or the shared tablet", "D\u00edt\u011b nebo sd\u00edlen\u00fd tablet"), sub: L("Join with a household code", "P\u0159ipojit se k\u00f3dem dom\u00e1cnosti"), open: go("/join") }),
        K.row({ title: L("New to Household", "Poprv\u00e9 v Householdu"), sub: L("Create an account", "Vytvo\u0159it \u00fa\u010det"), open: go("/register") })]));
    }

    /* ── A-2 Register ── */
    if (path === "/register") {
      P.title = L("Create your account", "Vytvo\u0159it \u00fa\u010det");
      push(K.hero({ small: true, kicker: "Household", big: L("Create your account", "Vytvo\u0159it \u00fa\u010det"), sub: L("You can start a household straight away; confirming the email only matters when you invite someone.", "Dom\u00e1cnost m\u016f\u017eete zalo\u017eit hned; potvrzen\u00ed e-mailu je pot\u0159eba a\u017e pro pozv\u00e1n\u00ed.") }));
      push(K.bound("acc_rname", { label: L("Your name", "Jm\u00e9no"), placeholder: L("What the household calls you", "Jak v\u00e1m doma \u0159\u00edkaj\u00ed"), err: err("rname") }));
      push(K.bound("acc_remail", { label: L("Email", "E-mail"), placeholder: "name@example.com", type: "email", mode: "email", err: err("remail") }));
      var pw = String(get("acc_rpw", ""));
      push(K.bound("acc_rpw", { label: L("Password", "Heslo"), type: "password", err: err("rpw"),
        hint: pw ? (pw.length < 10 ? L((10 - pw.length) + " more characters", "Je\u0161t\u011b " + (10 - pw.length) + " znak\u016f") : L("Long enough. Length matters more than symbols.", "Dost dlouh\u00e9. D\u00e9lka je d\u016fle\u017eit\u011bj\u0161\u00ed ne\u017e symboly."))
          : L("At least 10 characters. It\u2019s checked against known leaked passwords, never stored in plain text.", "Alespo\u0148 10 znak\u016f. Kontroluje se proti uniklym heslu\u016fm.") }));
      push(K.rows([K.check({ title: L("I agree to the terms and the privacy policy", "Souhlas\u00edm s podm\u00ednkami a z\u00e1sadami"), done: get("acc_terms", false), noStrike: true,
        sub: err("terms"), subTone: err("terms") ? "danger" : "", open: function () { put({ acc_terms: !get("acc_terms", false), acc_err_terms: "" }); } })]));
      push(K.acts([K.btn(L("Create account", "Vytvo\u0159it \u00fa\u010det"), "primary", function () {
        var n = String(get("acc_rname", "")).trim(), e = String(get("acc_remail", "")).trim(), p = String(get("acc_rpw", "")), e2 = {};
        e2.acc_err_rname = n ? "" : L("Add a name \u2014 it\u2019s what appears on things you do.", "Dopl\u0148te jm\u00e9no.");
        e2.acc_err_remail = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? L("That email is missing something.", "V e-mailu n\u011bco chyb\u00ed.")
          : /@tilcerovi\.cz$/.test(e) ? L("That address already has an account. Sign in instead, or reset its password.", "Tato adresa u\u017e \u00fa\u010det m\u00e1. P\u0159ihlaste se.") : "";
        e2.acc_err_rpw = p.length < 10 ? L("Ten characters or more.", "Alespo\u0148 deset znak\u016f.") : /password|heslo|123456/i.test(p) ? L("That password has appeared in a known leak. Pick another.", "Toto heslo se objevilo v \u00faniku. Zvolte jin\u00e9.") : "";
        e2.acc_err_terms = get("acc_terms", false) ? "" : L("Tick this to carry on.", "Pro pokra\u010dov\u00e1n\u00ed za\u0161krtn\u011bte.");
        if (e2.acc_err_rname || e2.acc_err_remail || e2.acc_err_rpw || e2.acc_err_terms) return put(e2);
        put(Object.assign(e2, { acc_pending: e }), { route: "/verify" });
      }), K.btn(L("I already have one", "U\u017e m\u00e1m \u00fa\u010det"), "", go("/sign-in"))]));
    }

    /* ── A-3 Verify ── */
    if (path === "/verify") {
      var pe = get("acc_pending", email), sentN = get("acc_sent", 1);
      P.title = L("Check your email", "Zkontrolujte e-mail");
      push(K.hero({ small: true, kicker: L("Almost there", "Skoro hotovo"), big: L("Check your email", "Zkontrolujte e-mail"), sub: L("We sent a link to " + pe + ". It works for 24 hours.", "Poslali jsme odkaz na " + pe + ". Plat\u00ed 24 hodin.") }));
      if (get("acc_expired", false)) push(K.note(L("That link has expired. A new one is on its way; the old one no longer works.", "Odkaz vypr\u0161el. Nov\u00fd je na cest\u011b, star\u00fd u\u017e nefunguje."), "boxWarn"));
      push(K.acts([K.btn(L("I\u2019ve clicked the link", "Klikl(a) jsem na odkaz"), "primary", function () { put({ acc_verified: true, acc_expired: false }, { route: "/households/new" }); K.toast(L("Email confirmed", "E-mail potvrzen")); }),
        K.btn(L("Send it again", "Poslat znovu") + (sentN > 1 ? " \u00b7 " + sentN : ""), "", function () { put({ acc_sent: sentN + 1 }); K.toast(L("Sent again. Only the newest link works.", "Odesl\u00e1no znovu. Plat\u00ed jen nejnov\u011bj\u0161\u00ed odkaz.")); }, sentN >= 5),
        K.btn(L("The link says it expired", "Odkaz vypr\u0161el"), "", function () { put({ acc_expired: true, acc_sent: sentN + 1 }); })]));
      push(K.note(L("You can set up a household before confirming. Inviting someone waits until you do, because an invitation is the one thing that reaches another person.",
        "Dom\u00e1cnost m\u016f\u017eete zalo\u017eit p\u0159ed potvrzen\u00edm. Pozv\u00e1nky po\u010dkaj\u00ed, proto\u017ee pozv\u00e1nka jako jedin\u00e1 dojde k dal\u0161\u00edmu \u010dlov\u011bku."), "muted"));
      push(K.acts([K.btn(L("Use a different address", "Pou\u017e\u00edt jinou adresu"), "", go("/register")), K.btn(L("Set up the household now", "Zalo\u017eit dom\u00e1cnost hned"), "", go("/households/new"))]));
    }

    /* ── A-7 / A-8 second step at sign-in ── */
    if (path === "/sign-in/2fa") {
      P.title = L("Enter your code", "Zadejte k\u00f3d");
      push(K.hero({ small: true, kicker: L("Second step", "Druh\u00fd krok"), big: L("Enter your code", "Zadejte k\u00f3d"), sub: L("Six digits from your authenticator app.", "\u0160est \u010d\u00edslic z ov\u011b\u0159ovac\u00ed aplikace.") }));
      push(K.bound("acc_totp", { label: L("Code", "K\u00f3d"), mode: "numeric", placeholder: "123 456", narrow: true, err: err("mfa"), hint: L("000000 shows the refusal.", "000000 uk\u00e1\u017ee odm\u00edtnut\u00ed.") }));
      push(K.acts([K.btn(L("Continue", "Pokra\u010dovat"), "primary", function () {
        var c = String(get("acc_totp", "")).replace(/\s/g, "");
        if (!TOTP_OK.test(c) || c === "000000") return setErr("mfa", L("That code didn\u2019t work. Codes change every 30 seconds \u2014 use the one showing now.", "K\u00f3d nefungoval. M\u011bn\u00ed se ka\u017ed\u00fdch 30 sekund."));
        put({ acc_totp: "" }); signedIn();
      }), K.btn(L("Use a recovery code", "Pou\u017e\u00edt z\u00e1lo\u017en\u00ed k\u00f3d"), "", go("/sign-in/2fa/recovery"))]));
    }
    if (path === "/sign-in/2fa/recovery") {
      var used = get("acc_used", []);
      P.title = L("Use a recovery code", "Z\u00e1lo\u017en\u00ed k\u00f3d");
      push(K.hero({ small: true, kicker: L("Second step", "Druh\u00fd krok"), big: L("Use a recovery code", "Pou\u017eijte z\u00e1lo\u017en\u00ed k\u00f3d"), sub: L("One of the ten you saved when you turned this on. Each works once.", "Jeden z deseti ulo\u017een\u00fdch. Ka\u017ed\u00fd funguje jednou.") }));
      push(K.bound("acc_rec", { label: L("Recovery code", "Z\u00e1lo\u017en\u00ed k\u00f3d"), placeholder: "XXXX-XXXX", narrow: true, err: err("rec"), hint: L("Try " + REC[0] + ".", "Zkuste " + REC[0] + ".") }));
      push(K.acts([K.btn(L("Continue", "Pokra\u010dovat"), "primary", function () {
        var c = String(get("acc_rec", "")).trim().toUpperCase();
        if (REC.indexOf(c) < 0) return setErr("rec", L("That isn\u2019t one of your codes.", "To nen\u00ed v\u00e1\u0161 k\u00f3d."));
        if (used.indexOf(c) >= 0) return setErr("rec", L("That code has been used already.", "Tento k\u00f3d u\u017e byl pou\u017eit."));
        put({ acc_used: used.concat([c]), acc_rec: "", acc_err_rec: "" });
        signedIn(null, L((REC.length - used.length - 1) + " recovery codes left. Make new ones in your account.", "Zb\u00fdv\u00e1 " + (REC.length - used.length - 1) + " z\u00e1lo\u017en\u00edch k\u00f3d\u016f."));
      }), K.btn(L("Back", "Zp\u011bt"), "", go("/sign-in/2fa"))]));
      push(K.note(L("Lost the codes and the phone? An owner can\u2019t reset this for you, and neither can support \u2014 that is what makes it a second step. Reset your password to start again with the account.",
        "Ztratili jste k\u00f3dy i telefon? Vlastn\u00edk ani podpora to neobnov\u00ed \u2014 proto je to druh\u00fd krok."), "muted"));
    }

    /* ── A-5 / A-6 turning it on ── */
    if (path === "/account/2fa") {
      P.title = L("A second step", "Druh\u00fd krok"); P.back = "/account";
      if (twofa) {
        push(K.hero({ small: true, kicker: L("Two-step sign-in", "Dvoukrokov\u00e9 p\u0159ihl\u00e1\u0161en\u00ed"), big: L("On", "Zapnuto"), sub: L("Signing in on a new device asks for a code from your authenticator app.", "P\u0159ihl\u00e1\u0161en\u00ed na nov\u00e9m za\u0159\u00edzen\u00ed chce k\u00f3d z aplikace.") }));
        push(K.kv([[L("Recovery codes left", "Zb\u00fdv\u00e1 k\u00f3d\u016f"), String(REC.length - get("acc_used", []).length)]]));
        push(K.acts([K.btn(L("Make new recovery codes", "Nov\u00e9 z\u00e1lo\u017en\u00ed k\u00f3dy"), "", function () { put({ acc_used: [] }, { route: "/account/2fa/codes" }); }),
          K.btn(L("Turn it off", "Vypnout"), "danger-ghost", function () { put({ acc_2fa: false }); K.toast(L("Two-step sign-in is off", "Dvoukrokov\u00e9 p\u0159ihl\u00e1\u0161en\u00ed vypnuto"), function () { put({ acc_2fa: true }); }); })]));
      } else {
        var st = get("acc_2fa_step", 0);
        push(K.steps([L("Scan", "Naskenovat"), L("Enter a code", "Zadat k\u00f3d"), L("Save codes", "Ulo\u017eit k\u00f3dy")], st));
        push(K.label(L("1 \u00b7 Add Household to your authenticator app", "1 \u00b7 P\u0159idejte Household do aplikace")));
        push(K.note(L("Scan the square in any authenticator app, or type this key: JBSW Y3DP EHPK 3PXP", "Naskenujte k\u00f3d v libovoln\u00e9 aplikaci, nebo zadejte kl\u00ed\u010d: JBSW Y3DP EHPK 3PXP"), "box"));
        push(K.label(L("2 \u00b7 Type the code it shows", "2 \u00b7 Opi\u0161te k\u00f3d")));
        push(K.bound("acc_setup", { label: L("Code", "K\u00f3d"), mode: "numeric", placeholder: "123 456", narrow: true, err: err("setup") }));
        push(K.acts([K.btn(L("Turn it on", "Zapnout"), "primary", function () {
          var c = String(get("acc_setup", "")).replace(/\s/g, "");
          if (!TOTP_OK.test(c) || c === "000000") return setErr("setup", L("That code didn\u2019t match. Check the phone\u2019s clock is right.", "K\u00f3d nesed\u00ed. Zkontrolujte \u010das v telefonu."));
          put({ acc_2fa: true, acc_used: [], acc_setup: "", acc_err_setup: "", acc_2fa_step: 2 }, { route: "/account/2fa/codes" });
        })]));
      }
    }
    if (path === "/account/2fa/codes") {
      var usedC = get("acc_used", []);
      P.title = L("Ten codes, in case the app is gone", "Deset k\u00f3d\u016f pro p\u0159\u00edpad ztr\u00e1ty"); P.back = "/account/2fa";
      push(K.note(L("Each works once, instead of a code from the app. Keep them somewhere that isn\u2019t this phone. They won\u2019t be shown again.", "Ka\u017ed\u00fd funguje jednou m\u00edsto k\u00f3du z aplikace. Uschovejte je jinde ne\u017e v tomto telefonu."), "boxWarn"));
      push(K.rows(REC.map(function (c, i) { return K.row({ lead: String(i + 1), title: c, strike: usedC.indexOf(c) >= 0, muted: usedC.indexOf(c) >= 0, right: usedC.indexOf(c) >= 0 ? L("used", "pou\u017eit") : "" }); })));
      push(K.acts([K.btn(L("Copy", "Kop\u00edrovat"), "", function () { K.toast(L("Copied all ten", "Zkop\u00edrov\u00e1no v\u0161ech deset")); }),
        K.btn(L("Download as text", "St\u00e1hnout jako text"), "", function () { K.toast("household-recovery-codes.txt"); }),
        K.btn(L("I\u2019ve saved them", "M\u00e1m je ulo\u017een\u00e9"), "primary", go("/account"))]));
    }

    /* ── A-9 / A-10 / A-11 reset ── */
    if (path === "/reset") {
      P.title = L("Reset your password", "Obnovit heslo");
      var sent = get("acc_resetSent", "");
      push(K.hero({ small: true, kicker: "Household", big: L("Reset your password", "Obnovit heslo"), sub: sent ? "" : L("We\u2019ll email a link that works for one hour.", "Po\u0161leme odkaz platn\u00fd hodinu.") }));
      if (sent) {
        push(K.note(L("If " + sent + " has an account, a link is on its way. The answer is the same either way, so this page can\u2019t be used to find out who has an account.",
          "Pokud m\u00e1 " + sent + " \u00fa\u010det, odkaz je na cest\u011b. Odpov\u011b\u010f je v\u017edy stejn\u00e1."), "box"));
        push(K.acts([K.btn(L("Open the link", "Otev\u0159\u00edt odkaz"), "primary", go("/reset/set")), K.btn(L("Back to sign-in", "Zp\u011bt na p\u0159ihl\u00e1\u0161en\u00ed"), "", go("/sign-in"))]));
      } else {
        push(K.bound("acc_remail2", { label: L("Email", "E-mail"), def: email, type: "email", mode: "email", err: err("reset") }));
        push(K.acts([K.btn(L("Send the link", "Poslat odkaz"), "primary", function () {
          var e = String(get("acc_remail2", email)).trim();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return setErr("reset", L("That email is missing something.", "V e-mailu n\u011bco chyb\u00ed."));
          put({ acc_resetSent: e, acc_err_reset: "" });
        }), K.btn(L("Back", "Zp\u011bt"), "", go("/sign-in"))]));
      }
    }
    if (path === "/reset/set") {
      P.title = L("Choose a new password", "Nov\u00e9 heslo");
      push(K.hero({ small: true, kicker: "Household", big: L("Choose a new password", "Zvolte nov\u00e9 heslo"), sub: L("Every other device signs out when you save it.", "Po ulo\u017een\u00ed se odhl\u00e1s\u00ed v\u0161echna ostatn\u00ed za\u0159\u00edzen\u00ed.") }));
      push(K.bound("acc_np1", { label: L("New password", "Nov\u00e9 heslo"), type: "password", err: err("np1") }));
      push(K.bound("acc_np2", { label: L("Again", "Znovu"), type: "password", err: err("np2") }));
      push(K.acts([K.btn(L("Save", "Ulo\u017eit"), "primary", function () {
        var p1 = String(get("acc_np1", "")), p2 = String(get("acc_np2", ""));
        var e = { acc_err_np1: p1.length < 10 ? L("Ten characters or more.", "Alespo\u0148 deset znak\u016f.") : "", acc_err_np2: p1 && p2 !== p1 ? L("The two don\u2019t match.", "Hesla se neshoduj\u00ed.") : "" };
        if (e.acc_err_np1 || e.acc_err_np2) return put(e);
        put(Object.assign(e, { acc_np1: "", acc_np2: "", acc_resetSent: "", acc_revoked: ["d-web", "d-ipad"] }), { route: "/account/notice" });
      })]));
    }
    if (path === "/account/notice") {
      P.title = L("Your password was changed", "Heslo bylo zm\u011bn\u011bno"); P.back = "/account";
      push(K.hero({ small: true, kicker: L("Today, " + clock(0), "Dnes, " + clock(0)), big: L("Your password was changed", "Heslo bylo zm\u011bn\u011bno"), sub: L("We also sent this to " + email + ".", "Poslali jsme to tak\u00e9 na " + email + ".") }));
      push(K.label(L("Signed out", "Odhl\u00e1\u0161eno")));
      push(K.rows(devices().filter(function (d) { return !d.current; }).map(function (d) { return K.row({ title: d.name, sub: L("signed out when the password changed", "odhl\u00e1\u0161eno p\u0159i zm\u011bn\u011b hesla") }); })));
      push(K.note(L("Wasn\u2019t you? Reset it again from a device you trust \u2014 that signs out everything, including this one.", "Nebyli jste to vy? Obnovte heslo znovu z d\u016fv\u011bryhodn\u00e9ho za\u0159\u00edzen\u00ed."), "boxWarn"));
      push(K.acts([K.btn(L("It was me", "Byl(a) jsem to j\u00e1"), "primary", go("/home")), K.btn(L("It wasn\u2019t me", "Nebyl(a) jsem to j\u00e1"), "danger-ghost", go("/reset"))]));
    }

    /* ── A-12 / A-13 devices ── */
    function devices() {
      var gone = get("acc_revoked", []);
      return [{ id: "d-this", name: L("This phone", "Tento telefon") + " \u00b7 iPhone 13", meta: L("Now", "Te\u010f"), current: true },
        { id: "d-web", name: "Chrome \u00b7 Windows", meta: L("Today 16:12 \u00b7 Brno", "Dnes 16:12 \u00b7 Brno") },
        { id: "d-ipad", name: L("iPad (kitchen)", "iPad (kuchy\u0148)"), meta: L("Yesterday 21:03 \u00b7 shared, Adam uses it", "V\u010dera 21:03 \u00b7 sd\u00edlen\u00fd, pou\u017e\u00edv\u00e1 ho Adam"), shared: true }]
        .filter(function (d) { return gone.indexOf(d.id) < 0; });
    }
    if (path === "/account/devices") {
      P.title = L("Where you are signed in", "Kde jste p\u0159ihl\u00e1\u0161eni"); P.back = "/account";
      var ds = devices();
      push(K.rows(ds.map(function (d) {
        return K.row({ title: d.name, sub: d.meta, badge: d.current ? L("this one", "tento") : "", badgeTone: "accent",
          act: d.current ? "" : L("Sign out", "Odhl\u00e1sit"), actTone: "danger", onAct: go("/account/devices/revoke?d=" + d.id) });
      })));
      if (ds.length > 1) push(K.acts([K.btn(L("Sign out everywhere else", "Odhl\u00e1sit v\u0161ude jinde"), "danger-ghost", function () {
        var before = get("acc_revoked", []);
        put({ acc_revoked: ["d-web", "d-ipad"] }); K.toast(L("Signed out of " + (ds.length - 1) + " devices", "Odhl\u00e1\u0161eno z " + (ds.length - 1) + " za\u0159\u00edzen\u00ed"), function () { put({ acc_revoked: before }); });
      })]));
      else push(K.note(L("Only this device is signed in.", "P\u0159ihl\u00e1\u0161en je jen tento telefon."), "muted"));
      push(K.note(L("Signing a device out ends its session at once. Anything it hadn\u2019t sent yet stays on it and goes when somebody signs in there again.", "Odhl\u00e1\u0161en\u00ed ukon\u010d\u00ed relaci hned. Co za\u0159\u00edzen\u00ed je\u0161t\u011b neodeslalo, na n\u011bm z\u016fstane."), "muted"));
    }
    if (path === "/account/devices/revoke") {
      var d = devices().filter(function (x) { return x.id === (q.d || "d-ipad"); })[0];
      P.title = d ? L("Sign out " + d.name + "?", "Odhl\u00e1sit " + d.name + "?") : L("Already signed out", "U\u017e odhl\u00e1\u0161eno"); P.back = "/account/devices";
      if (!d) push(K.empty(L("That device is already signed out.", "Za\u0159\u00edzen\u00ed u\u017e je odhl\u00e1\u0161en\u00e9."), "", L("Back to devices", "Zp\u011bt"), go("/account/devices")));
      else {
        push(K.kv([[L("Last used", "Naposledy"), d.meta]]));
        if (d.shared) push(K.note(L("This tablet is shared. Adam\u2019s profile on it stays \u2014 it signs in with his PIN, not your account \u2014 but your own session on it ends.", "Tablet je sd\u00edlen\u00fd. Adam\u016fv profil z\u016fstane, va\u0161e relace skon\u010d\u00ed."), "box"));
        push(K.acts([K.btn(L("Sign it out", "Odhl\u00e1sit"), "danger", function () {
          var before = get("acc_revoked", []);
          put({ acc_revoked: before.concat([d.id]) }, { route: "/account/devices" });
          K.toast(L(d.name + " is signed out", d.name + " je odhl\u00e1\u0161en"), function () { put({ acc_revoked: before }); });
        }), K.btn(L("Cancel", "Zru\u0161it"), "", go("/account/devices"))]));
      }
    }

    /* ── A-14 … A-18 the child path ── */
    if (path === "/join") {
      P.title = L("Join your household", "P\u0159ipojit se k dom\u00e1cnosti");
      push(K.hero({ small: true, kicker: "Household", big: L("Join your household", "P\u0159ipojte se"), sub: L("Ask a grown-up for the six-letter code on their Members screen.", "Popros dosp\u011bl\u00e9ho o \u0161estim\u00edstn\u00fd k\u00f3d ze str\u00e1nky \u010cleny.") }));
      push(K.bound("acc_code", { label: L("Household code", "K\u00f3d dom\u00e1cnosti"), placeholder: "ABC123", narrow: true, err: err("code"), hint: L("This household\u2019s code is " + CODE + ".", "K\u00f3d t\u00e9to dom\u00e1cnosti je " + CODE + ".") }));
      push(K.acts([K.btn(L("Next", "D\u00e1l"), "primary", function () {
        var c = String(get("acc_code", "")).trim().toUpperCase().replace(/\s/g, "");
        if (c !== CODE) return setErr("code", L("That code doesn\u2019t open a household. Check it with " + owner + ".", "Ten k\u00f3d neotev\u00edr\u00e1 \u017e\u00e1dnou dom\u00e1cnost. Ov\u011b\u0159 si ho u " + owner + "."));
        put({ acc_err_code: "" }, { route: "/join/profile" });
      }), K.btn(L("I have an account", "M\u00e1m \u00fa\u010det"), "", go("/sign-in"))]));
    }
    if (path === "/join/profile" || path === "/switch") {
      var sw = path === "/switch";
      P.title = sw ? L("Switch profile", "P\u0159epnout profil") : L("Who is using this phone?", "Kdo pou\u017e\u00edv\u00e1 tento telefon?");
      push(K.hero({ small: true, kicker: F.households.filter(function (h) { return h.id === s.household; }).map(function (h) { return h.name; })[0] || "", big: P.title,
        sub: sw ? L("Profiles on this device. A child profile asks for its PIN.", "Profily v tomto za\u0159\u00edzen\u00ed. D\u011btsk\u00fd chce PIN.") : L("Pick your name.", "Vyber sv\u00e9 jm\u00e9no.") }));
      var list = F.members.filter(function (m) { return sw ? (m.id === "jana" || m.role === "child") : m.role === "child"; });
      push(K.cards(list.map(function (m) {
        return { title: m.name, sub: m.role === "child" ? L("PIN", "PIN") : L("Signed in with email", "P\u0159ihl\u00e1\u0161en e-mailem"), on: m.id === s.member,
          pick: function () { if (m.role === "child") put({ acc_child: m.id, acc_pinTry: 0, acc_pin: "" }, { route: "/join/pin" }); else signedIn(m.id, L("Switched to " + m.name, "P\u0159epnuto na " + m.name)); } };
      })));
      push(K.acts([K.btn(sw ? L("Add somebody else", "P\u0159idat n\u011bkoho") : L("I\u2019m a grown-up \u2014 sign in", "Jsem dosp\u011bl\u00fd \u2014 p\u0159ihl\u00e1sit"), "", go("/sign-in"))]));
    }
    if (path === "/join/pin") {
      var cid = get("acc_child", "adam"), cm = K.memberOf(cid) || { name: "Adam" }, tries = get("acc_pinTry", 0);
      P.title = L("Hi " + cm.name, "Ahoj, " + cm.name);
      push(K.hero({ small: true, kicker: L("Your PIN", "Tv\u016fj PIN"), big: L("Hi " + cm.name, "Ahoj, " + cm.name), sub: L("Four numbers.", "\u010cty\u0159i \u010d\u00edsla.") }));
      push(K.bound("acc_pin", { label: "PIN", type: "password", mode: "numeric", placeholder: "\u2022\u2022\u2022\u2022", narrow: true, err: err("pin"), hint: L("Adam\u2019s PIN is " + PIN + ".", "Adam\u016fv PIN je " + PIN + ".") }));
      push(K.acts([K.btn(L("Go", "Jdeme"), "primary", function () {
        var p = String(get("acc_pin", ""));
        if (p === PIN) { put({ acc_pinTry: 0, acc_pin: "", acc_err_pin: "" }); return signedIn(cid, L("Hi " + cm.name, "Ahoj, " + cm.name)); }
        var n = tries + 1;
        if (n >= 5) return put({ acc_pinTry: n, acc_pin: "", acc_err_pin: "", acc_pausedUntil: clock(15) }, { route: "/join/pin/paused" });
        put({ acc_pinTry: n, acc_pin: "", acc_err_pin: L("Not that one. " + (5 - n) + " more tries, then a short break.", "To nen\u00ed on. Je\u0161t\u011b " + (5 - n) + " pokusy, pak kr\u00e1tk\u00e1 pauza.") });
      }), K.btn(L("Not " + cm.name, "Nejsem " + cm.name), "", go("/join/profile"))]));
      push(K.note(L("Forgot it? " + owner + " can reset it from their phone.", "Zapomn\u011bl(a) jsi ho? " + owner + " ho m\u016f\u017ee obnovit ze sv\u00e9ho telefonu."), "muted"));
    }
    if (path === "/join/pin/paused") {
      var until = get("acc_pausedUntil", clock(15));
      P.title = L("Let\u2019s take a short break", "D\u00e1me si kr\u00e1tkou pauzu");
      push(K.hero({ small: true, kicker: "PIN", big: L("Let\u2019s take a short break", "D\u00e1me si kr\u00e1tkou pauzu"), sub: L("Five tries didn\u2019t match. You can try again at " + until + ".", "P\u011bt pokus\u016f nesed\u011blo. Zkusit znovu m\u016f\u017ee\u0161 v " + until + ".") }));
      push(K.note(L("Nothing is wrong and nobody is cross. If you\u2019ve forgotten it, ask " + owner + " \u2014 they can set a new one straight away.", "Nic se ned\u011bje. Jestli jsi ho zapomn\u011bl(a), popros " + owner + " \u2014 nastav\u00ed nov\u00fd hned."), "box"));
      push(K.acts([K.btn(L("It\u2019s " + until + " now", "U\u017e je " + until), "", function () { put({ acc_pinTry: 0 }, { route: "/join/pin" }); }), K.btn(L("Somebody else", "N\u011bkdo jin\u00fd"), "", go("/join/profile"))]));
    }

    /* ── A-19 account ── */
    if (path === "/account") {
      P.title = L("Your account", "V\u00e1\u0161 \u00fa\u010det"); P.showBack = !K.wide; P.back = "/more";
      var del = get("acc_delAt", "");
      if (del) push(K.note(L("This account closes on " + del + ". Sign in before then and it stays.", "\u00da\u010det se uzav\u0159e " + del + ". P\u0159ihl\u00e1\u0161en\u00edm p\u0159edt\u00edm z\u016fstane."), "boxDanger", L("Keep my account", "Ponechat \u00fa\u010det"), function () { put({ acc_delAt: "" }); }));
      push(K.hero({ small: true, kicker: me.role === "child" ? L("Child profile", "D\u011btsk\u00fd profil") : L("Account", "\u00da\u010det"), big: me.name, sub: me.role === "child" ? L("Signs in with a PIN on this household\u2019s devices.", "P\u0159ihla\u0161uje se PINem.") : email }));
      if (me.role !== "child") {
        push(K.bound("acc_email", { label: L("Email", "E-mail"), def: email, type: "email", hint: L("Changing it sends a link to the new address; the old one keeps working until it\u2019s clicked.", "Zm\u011bna po\u0161le odkaz na novou adresu.") }));
        push(K.label(L("Signing in", "P\u0159ihla\u0161ov\u00e1n\u00ed")));
        push(K.rows([K.row({ title: L("Password", "Heslo"), sub: L("Changed 14 March", "Zm\u011bn\u011bno 14. b\u0159ezna"), open: go("/reset/set") }),
          K.row({ title: L("Two-step sign-in", "Dvoukrokov\u00e9 p\u0159ihl\u00e1\u0161en\u00ed"), right: twofa ? L("On", "Zapnuto") : L("Off", "Vypnuto"), tone: twofa ? "accent" : "muted", open: go("/account/2fa") }),
          K.row({ title: L("Where you are signed in", "Kde jste p\u0159ihl\u00e1\u0161eni"), right: String(devices().length), open: go("/account/devices") }),
          K.row({ title: "Google", sub: L("Connected \u00b7 can sign you in", "P\u0159ipojeno"), right: "" })]));
      }
      push(K.label(L("You", "Vy")));
      push(K.rows([K.row({ title: L("Notifications", "Ozn\u00e1men\u00ed"), sub: L("What reaches your phone, and when it stays quiet", "Co v\u00e1m p\u0159ijde a kdy je ticho"), open: go("/account/notifications") }),
        K.row({ title: L("Your data", "Va\u0161e data"), sub: L("Export, analytics, permissions", "Export, analytika, opr\u00e1vn\u011bn\u00ed"), open: go("/account/privacy") }),
        K.row({ title: L("Language", "Jazyk"), right: s.locale === "cs" ? "\u010ce\u0161tina" : s.locale === "de" ? "Deutsch" : "English", open: function () { self.setState({ locale: s.locale === "cs" ? "en" : "cs" }); } }),
        K.row({ title: L("Switch profile on this device", "P\u0159epnout profil"), open: go("/switch") })]));
      push(K.acts([K.btn(L("Sign out", "Odhl\u00e1sit"), "", go("/sign-in")), me.role !== "child" ? K.btn(L("Delete account", "Smazat \u00fa\u010det"), "danger-ghost", go("/account/delete")) : null]));
    }

    /* ── A-20 delete ── */
    if (path === "/account/delete") {
      P.title = L("Delete your account", "Smazat \u00fa\u010det"); P.back = "/account";
      var rowsD = (A && A.deletion) || [];
      var mine = me.id === "jana" ? rowsD.filter(function (r) { return r[2] === "blocked"; }) : [];
      var fixed = get("acc_delFixed", []);
      var open = mine.filter(function (r, i) { return fixed.indexOf(i) < 0; });
      if (get("acc_delAt", "")) {
        push(K.hero({ small: true, kicker: L("Closing", "Uzav\u00edr\u00e1 se"), big: get("acc_delAt", ""), sub: L("Your account is switched off now and deleted on that day. Sign in before then and nothing is lost.", "\u00da\u010det je vypnut\u00fd a sma\u017ee se v ten den. P\u0159ihl\u00e1\u0161en\u00edm p\u0159edt\u00edm se nic neztrat\u00ed.") }));
        push(K.note(L("Backups are overwritten on a 35-day cycle, so the last copy is gone five weeks after that. The privacy policy says the same.", "Z\u00e1lohy se p\u0159episuj\u00ed ka\u017ed\u00fdch 35 dn\u00ed."), "muted"));
        push(K.acts([K.btn(L("Keep my account", "Ponechat \u00fa\u010det"), "primary", function () { put({ acc_delAt: "", acc_delType: "" }, { route: "/account" }); })]));
      } else {
        push(K.note(L("What you added to a household stays there with your name on it \u2014 it\u2019s the household\u2019s record. Your private notes and documents are deleted.", "Co jste p\u0159idali do dom\u00e1cnosti, z\u016fstane. Soukrom\u00e9 pozn\u00e1mky a dokumenty se sma\u017eou."), "box"));
        if (open.length) {
          push(K.label(L("First, " + open.length + (open.length === 1 ? " thing" : " things"), "Nejd\u0159\u00edv " + open.length)));
          push(K.rows(open.map(function (r) {
            var i = mine.indexOf(r);
            return K.row({ title: r[0] + " \u00b7 " + r[1], sub: r[3], subTone: "", act: r[4], onAct: function () {
              var admin = "/households/" + (r[0] === "Tilcerovi" ? "tilcerovi" : "chata") + "/settings/" + (/billing|platby/i.test(r[4]) ? "billing" : "members");
              put({ acc_delFixed: fixed.concat([i]) }, { route: admin });
            } });
          })));
          push(K.note(L("Deleting waits for these, so no household is left without an owner or a payer.", "Smaz\u00e1n\u00ed po\u010dk\u00e1, aby \u017e\u00e1dn\u00e1 dom\u00e1cnost nez\u016fstala bez vlastn\u00edka nebo pl\u00e1tce."), "muted"));
        }
        push(K.bound("acc_delType", { label: L("Type your email to confirm", "Pro potvrzen\u00ed napi\u0161te e-mail"), placeholder: email, off: !!open.length }));
        var ok = !open.length && String(get("acc_delType", "")).trim().toLowerCase() === email.toLowerCase();
        push(K.acts([K.btn(L("Delete my account", "Smazat \u00fa\u010det"), "danger", function () { put({ acc_delAt: dayPlus(30) }); }, !ok), K.btn(L("Cancel", "Zru\u0161it"), "", go("/account"))]));
      }
    }

    /* ── A-21 must update ── */
    if (path === "/must-update") {
      var U = ((A && A.update) || []).filter(function (r) { return r[0] === (s.locale === "cs" ? "cs" : s.locale === "de" ? "de" : "en"); })[0] || ["en", "English", "Time to update", "This version of Household can\u2019t talk to the server any more. Update the app to carry on \u2014 nothing on this phone is lost, it is waiting to be sent.", "Update Household"];
      P.title = U[2];
      push(K.hero({ small: true, kicker: "Household", big: U[2], sub: U[3] }));
      push(K.kv([[L("Waiting to be sent", "\u010cek\u00e1 na odesl\u00e1n\u00ed"), L("3 changes, kept on this phone", "3 zm\u011bny v tomto telefonu")], [L("This version", "Tato verze"), "1.4.2"], [L("Needed", "Pot\u0159eba"), "1.6.0"]]));
      push(K.acts([K.btn(U[4], "primary", function () { K.toast(L("Opening the store\u2026", "Otev\u00edr\u00e1m obchod\u2026")); })]));
    }

    /* ── A-30 the banners ── */
    if (path === "/screens/a-30") {
      P.title = L("The six that are banners", "\u0160est, kter\u00e9 jsou pruhem"); P.back = "/more";
      push(K.note(L("Pick a subscription state and the whole app wears its banner. Active draws nothing; suspended isn\u2019t a banner but a locked screen.", "Vyberte stav p\u0159edplatn\u00e9ho a cel\u00e1 aplikace ponese jeho pruh."), "muted"));
      var ents = H ? H.ent.map(function (e) { return e[0]; }) : ["trialing", "active", "past_due", "grace", "read_only", "canceled", "restricted", "suspended"];
      push(K.rows(ents.map(function (e) {
        var b = H && H.banners ? H.banners.filter(function (x) { return x.key === e; })[0] : null;
        return K.row({ title: e.replace(/_/g, " "), sub: b ? (b.title || b.text || "") : e === "active" ? L("no banner", "\u017e\u00e1dn\u00fd pruh") : e === "suspended" ? L("a locked screen instead", "m\u00edsto toho zam\u010den\u00e1 obrazovka") : "",
          on: s.ent === e, act: s.ent === e ? L("Showing", "Zobrazeno") : L("Show", "Zobrazit"), actOn: s.ent === e, onAct: function () { self.setState({ ent: e }); }, noChev: true, open: function () { self.setState({ ent: e }); } });
      })));
    }

    /* ── A-31 locked ── */
    if (path === "/locked") {
      var hh = F.households.filter(function (h) { return h.id === s.household; })[0] || F.households[0];
      var other = F.households.filter(function (h) { return h.id !== hh.id; })[0];
      P.title = L(hh.name + " is locked", hh.name + " je zam\u010den\u00e1");
      push(K.hero({ small: true, kicker: L("Suspended", "Pozastaveno"), big: P.title, sub: L("Household support has paused this household while a report is looked into. Nothing in it has been deleted or read.", "Podpora dom\u00e1cnost pozastavila kv\u016fli \u0161et\u0159en\u00ed. Nic nebylo smaz\u00e1no ani \u010dteno.") }));
      push(K.note(L("Owners have had an email with the reason and how to answer it. The household\u2019s activity log records it too.", "Vlastn\u00edci dostali e-mail s d\u016fvodem. Z\u00e1znam aktivity to eviduje."), "box"));
      push(K.acts([other ? K.btn(L("Go to " + other.name, "P\u0159ej\u00edt do " + other.name), "primary", function () { self.setState({ household: other.id, ent: "active", route: "/home" }); }) : null,
        K.btn(L("Sign out", "Odhl\u00e1sit"), "", go("/sign-in"))]));
    }

    /* ── A-34 privacy ── */
    if (path === "/account/privacy") {
      P.title = L("Your data", "Va\u0161e data"); P.back = "/account";
      var ex = get("acc_export", "");
      push(K.label(L("A copy of everything", "Kopie v\u0161eho")));
      push(K.note(L("A ZIP of what you added, in files that open without Household: CSV for lists and money, Markdown for notes, the original documents, and a README that explains the folders.",
        "ZIP s t\u00edm, co jste p\u0159idali, v souborech, kter\u00e9 se otev\u0159ou i bez Householdu: CSV, Markdown, p\u016fvodn\u00ed dokumenty a README."), "muted"));
      if (ex === "running") push(K.note(L("Being put together. It usually takes a few minutes and you\u2019ll get an email when it\u2019s ready.", "P\u0159ipravuje se. Po\u0161leme e-mail, a\u017e bude hotov\u00fd."), "box", L("It\u2019s ready", "Je hotovo"), function () { put({ acc_export: "ready" }); }));
      if (ex === "ready") push(K.rows([K.row({ title: "household-" + me.id + "-2026-09-26.zip", sub: L("412 MB \u00b7 link works for 7 days", "412 MB \u00b7 odkaz plat\u00ed 7 dn\u00ed"), act: L("Download", "St\u00e1hnout"), onAct: function () { K.toast(L("Downloading\u2026", "Stahuji\u2026")); } })]));
      push(K.acts([K.btn(ex ? L("Make a new export", "Nov\u00fd export") : L("Export my data", "Exportovat data"), "", function () { put({ acc_export: "running" }); }, ex === "running")]));
      push(K.label(L("Helping us improve", "Pomoc se zlep\u0161en\u00edm")));
      push(K.rows([K.toggle({ title: L("Share usage statistics", "Sd\u00edlet statistiky pou\u017e\u00edv\u00e1n\u00ed"), sub: L("Which screens are opened and how long things take. Never what you typed, never names, never content. Kept in the EU.", "Kter\u00e9 obrazovky se otev\u00edraj\u00ed. Nikdy obsah ani jm\u00e9na. Ulo\u017eeno v EU."),
          value: get("acc_analytics", false), flip: function () { put({ acc_analytics: !get("acc_analytics", false) }); } }),
        K.toggle({ title: L("Send crash reports", "Pos\u00edlat hl\u00e1\u0161en\u00ed o p\u00e1dech"), sub: L("What broke, on which version. Screen content is stripped before it leaves the phone.", "Co se rozbilo a na jak\u00e9 verzi. Obsah obrazovky se odstran\u00ed."),
          value: get("acc_crash", false), flip: function () { put({ acc_crash: !get("acc_crash", false) }); } })]));
      push(K.note(L("Both start off. Nothing is sent until you turn one on.", "Ob\u011b jsou na za\u010d\u00e1tku vypnut\u00e9."), "muted"));
      push(K.label(L("What this phone lets Household do", "Co telefon Householdu dovoluje")));
      push(K.rows([["Camera", "Kamera", "Photographing a receipt, a meter or a document. Only when you tap the camera button.", "Vyfocen\u00ed \u00fa\u010dtenky, m\u011b\u0159idla nebo dokumentu.", L("Allowed", "Povoleno")],
        ["Photos", "Fotky", "Attaching a picture you already have. Household sees only the ones you pick.", "P\u0159ilo\u017een\u00ed fotky. Household vid\u00ed jen vybran\u00e9.", L("Selected photos", "Vybran\u00e9 fotky")],
        ["Notifications", "Ozn\u00e1men\u00ed", "Reminders, messages and what you asked to hear about.", "P\u0159ipom\u00ednky, zpr\u00e1vy a to, o \u010dem chcete v\u011bd\u011bt.", L("Allowed", "Povoleno")],
        ["Location", "Poloha", "Never asked for. The garden\u2019s frost forecast uses the town you typed, rounded.", "Nikdy se nevy\u017eaduje. P\u0159edpov\u011b\u010f mraz\u016f pou\u017e\u00edv\u00e1 zadan\u00e9 m\u011bsto.", L("Not requested", "Nevy\u017eadov\u00e1no")]].map(function (r) {
        return K.row({ title: L(r[0], r[1]), sub: L(r[2], r[3]), right: r[4], tone: "muted" });
      })));
      push(K.acts([K.btn(L("Delete account", "Smazat \u00fa\u010det"), "danger-ghost", go("/account/delete"))]));
    }

    /* ── F-20 notifications ── */
    if (path === "/account/notifications") {
      P.title = L("Notifications", "Ozn\u00e1men\u00ed"); P.back = "/account";
      var pr = (N && N.prefsOf ? K.safe(function () { return N.prefsOf(me.id); }, null) : null) || { master: true, quiet: { from: "22:00", to: "07:00" }, cats: { direct: true, household: true, reminders: true, digest: true }, devices: [] };
      var master = get("nt_master", pr.master), cats = get("nt_cats", pr.cats), qfrom = get("nt_qfrom", pr.quiet.from), qto = get("nt_qto", pr.quiet.to), gone = get("nt_devGone", []);
      push(K.rows([K.toggle({ title: L("Notifications from Household", "Ozn\u00e1men\u00ed z Householdu"), sub: master ? L("On for " + me.name + " in this household", "Zapnuto pro " + me.name) : L("Nothing reaches your devices. Everything still shows in the app.", "Nic nep\u0159ijde. V aplikaci je v\u0161e vid\u011bt."),
        value: master, flip: function () { put({ nt_master: !master }); } })]));
      push(K.label(L("What kinds", "Jak\u00e9 druhy")));
      push(K.rows(((N && N.categories) || []).map(function (c) {
        return K.toggle({ title: c.label, sub: c.says, value: master && cats[c.id] !== false, off: !master, flip: function () { var o = Object.assign({}, cats); o[c.id] = cats[c.id] === false; put({ nt_cats: o }); } });
      })));
      push(K.label(L("Quiet hours", "No\u010dn\u00ed klid")));
      push(K.bound("nt_qfrom", { label: L("From", "Od"), def: qfrom, narrow: true, placeholder: "22:00", err: /^\d{1,2}:\d{2}$/.test(qfrom) ? "" : L("Use hh:mm", "Pou\u017eijte hh:mm") }));
      push(K.bound("nt_qto", { label: L("Until", "Do"), def: qto, narrow: true, placeholder: "07:00", err: /^\d{1,2}:\d{2}$/.test(qto) ? "" : L("Use hh:mm", "Pou\u017eijte hh:mm") }));
      push(K.note(L("During quiet hours things wait and arrive together at " + qto + ". Nothing is dropped.", "B\u011bhem klidu v\u011bci po\u010dkaj\u00ed a p\u0159ijdou spolu v " + qto + ". Nic se neztrat\u00ed."), "muted"));
      push(K.label(L("Devices that receive them", "Za\u0159\u00edzen\u00ed, kter\u00e1 je dost\u00e1vaj\u00ed")));
      var devs = (pr.devices || []).filter(function (d) { return gone.indexOf(d.id) < 0; });
      if (!devs.length) push(K.note(L("No device receives notifications. Allow them on a phone to add it here.", "\u017d\u00e1dn\u00e9 za\u0159\u00edzen\u00ed. Povolte ozn\u00e1men\u00ed v telefonu."), "muted"));
      push(K.rows(devs.map(function (d) {
        return K.row({ title: d.label, sub: d.transport === "webpush" ? L("Browser", "Prohl\u00ed\u017ee\u010d") : L("App", "Aplikace"), act: L("Remove", "Odebrat"), actTone: "danger",
          onAct: function () { put({ nt_devGone: gone.concat([d.id]) }); K.toast(L(d.label + " won\u2019t get notifications", d.label + " u\u017e ozn\u00e1men\u00ed nedostane"), function () { put({ nt_devGone: gone }); }); } });
      })));
      push(K.acts([K.btn(L("Send me a test", "Poslat zku\u0161ebn\u00ed"), "", function () { K.toast(master ? L("Test sent to " + devs.length + " devices", "Zku\u0161ebn\u00ed odesl\u00e1no na " + devs.length + " za\u0159\u00edzen\u00ed") : L("Notifications are off, so nothing was sent", "Ozn\u00e1men\u00ed jsou vypnut\u00e1, nic se neodeslalo")); })]));
    }

    /* ── A-4 invite: the household's own composer ── */
    if (path === "/household/invite") {
      var slug = s.household === "hh-tilcer" ? "tilcerovi" : "chata";
      return window.HH_HS_VIEW ? window.HH_HS_VIEW(self, ["households", slug, "invitations", "new"], "", "", wide) : null;
    }

    return K.page(P);
  }

  function clock(plusMin) {
    var d = new Date(); d.setMinutes(d.getMinutes() + (plusMin || 0));
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function dayPlus(n) {
    var d = new Date("2026-09-26T12:00:00"); d.setDate(d.getDate() + n);
    return d.getDate() + " " + ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][d.getMonth()] + " " + d.getFullYear();
  }

  window.HH_ACC_VIEW = view;
})();
