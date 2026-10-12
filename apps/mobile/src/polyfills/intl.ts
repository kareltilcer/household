// `Intl`, as far as the translator and the app's formatter ask for it and Hermes does not answer
// as Node does. The rule both clients and the server share is vectors/i18n.json, which was
// written against Node's ICU (ADR 0007), and a device's own `Intl` is its operating system's,
// one ICU on Android and another on iOS, each of its own age.
//
// Plurals and numbers are FormatJS's on every device, whatever the engine has: Hermes has no
// `Intl.PluralRules` at all, and its `Intl.NumberFormat` is the platform's, which groups and
// rounds as that platform's data says and has no `formatToParts` on iOS. Forced, they are one
// implementation with one CLDR, and the vectors run through them in Jest (src/i18n).
//
// What Hermes lacks beside them is filled where it is missing and left alone where an engine
// has it: `Intl.Locale`, `Intl.ListFormat`, `Intl.DisplayNames` and `Intl.supportedValuesOf`.
// What Hermes has is used as it is: `Intl.DateTimeFormat`, `Intl.Collator` and
// `Intl.getCanonicalLocales`. (Read in Hermes's lib/VM/JSLib/Intl.cpp at the tag React Native
// 0.86 ships, hermes-v250829098.0.17, and in its doc/IntlAPIs.md: no Hermes runs where this was
// written.)
//
// The data is the five languages' and no other's (D-29), English first: the first language a
// polyfill is given is the one it falls back to. A region's own conventions are not here, so
// `de-AT` counts and groups as `de` does.
//
// The order is what each needs beneath it: a locale to resolve, then plural rules, which a
// number's format chooses its unit by.
import '@formatjs/intl-locale/polyfill.js'

import '@formatjs/intl-pluralrules/polyfill-force.js'
import '@formatjs/intl-pluralrules/locale-data/en.js'
import '@formatjs/intl-pluralrules/locale-data/cs.js'
import '@formatjs/intl-pluralrules/locale-data/sk.js'
import '@formatjs/intl-pluralrules/locale-data/de.js'
import '@formatjs/intl-pluralrules/locale-data/pl.js'

import '@formatjs/intl-numberformat/polyfill-force.js'
import '@formatjs/intl-numberformat/locale-data/en.js'
import '@formatjs/intl-numberformat/locale-data/cs.js'
import '@formatjs/intl-numberformat/locale-data/sk.js'
import '@formatjs/intl-numberformat/locale-data/de.js'
import '@formatjs/intl-numberformat/locale-data/pl.js'

import '@formatjs/intl-listformat/polyfill.js'
import '@formatjs/intl-listformat/locale-data/en.js'
import '@formatjs/intl-listformat/locale-data/cs.js'
import '@formatjs/intl-listformat/locale-data/sk.js'
import '@formatjs/intl-listformat/locale-data/de.js'
import '@formatjs/intl-listformat/locale-data/pl.js'

import '@formatjs/intl-displaynames/polyfill.js'
import '@formatjs/intl-displaynames/locale-data/en.js'
import '@formatjs/intl-displaynames/locale-data/cs.js'
import '@formatjs/intl-displaynames/locale-data/sk.js'
import '@formatjs/intl-displaynames/locale-data/de.js'
import '@formatjs/intl-displaynames/locale-data/pl.js'

import '@formatjs/intl-supportedvaluesof/polyfill.js'
