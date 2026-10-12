// Jest runs on Node, whose `Intl` is whole, and the app runs on Hermes, whose is not. Left as
// Node's, a polyfill that fills only what is missing would fill nothing here, and a test would
// pass through an implementation no device has. So what Hermes does not have is taken away
// before the polyfills load (setup.ts), and they install in a test what they install on a
// device.
//
// The list is Hermes's at the tag React Native 0.86 ships (hermes-v250829098.0.17,
// lib/VM/JSLib/Intl.cpp): it defines `Collator`, `DateTimeFormat`, `NumberFormat` and
// `getCanonicalLocales`, and nothing else of `Intl`. An SDK that moves Hermes moves this list.
// What stays is still Node's and not a device's: a date is formatted by the operating system's
// ICU there, and no test here says what it prints.
//
// `crypto` stays Node's too, though Hermes has none. The generator a device is given is
// expo-crypto's, whose native half is stood in for under Jest by a function that fills nothing:
// installed here, every id a test drew would be the same.
const absent = [
  'DisplayNames',
  'DurationFormat',
  'ListFormat',
  'Locale',
  'PluralRules',
  'RelativeTimeFormat',
  'Segmenter',
  'supportedValuesOf',
] as const

for (const name of absent) Reflect.deleteProperty(Intl, name)
