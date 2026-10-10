// The names and the words a test may draw. A test's markup holds no literal word, as the app's
// holds none (the lint reads both): what a member would have typed comes from here, and what
// the app says comes from the catalogs. A name holds no run of four plain letters, which the
// pseudo-locale's pass takes for a word nobody translated: a name is data, and is drawn as it
// is in every language.

/** Identifiers as the app mints them: UUIDv7, fixed, so that a failure names the same one twice. */
export const ids = {
  household: '0198c0de-0000-7000-8000-00000000a001',
  otherHousehold: '0198c0de-0000-7000-8000-00000000a002',
  member: '0198c0de-0000-7000-8000-00000000b001',
  otherMember: '0198c0de-0000-7000-8000-00000000b002',
  device: '0198c0de-0000-7000-8000-00000000c001',
} as const

export const households = {
  own: { id: ids.household, name: 'Dům U Lípy' },
  other: { id: ids.otherHousehold, name: 'Byt Žiž' },
} as const

export const people = {
  owner: { id: ids.member, name: 'Eva Řá', email: 'eva@dum.test' },
  member: { id: ids.otherMember, name: 'Jiří Kö', email: 'jiri@dum.test' },
} as const

/**
 * Words a test gives a component that takes its words from its owner: a button's, a title's.
 * English, as a fixture of a dev screen is; a test of what the app itself says reads the
 * catalogs instead.
 */
export const words = {
  save: 'Save',
  remove: 'Remove the reading',
  open: 'Open',
  title: 'Readings',
  sentence: 'The cellar meter was read on the first of March.',
  /** The longest of its kind: a label in German, which a layout must survive. */
  long: 'Zählerstand für den Kellerzähler speichern',
} as const
