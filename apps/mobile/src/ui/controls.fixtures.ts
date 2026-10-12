// The words the controls' and the overlays' tests draw, which a member or a screen's owner
// would have given: a label, a help, an error, a title. English, as a dev screen's fixtures
// are, and here and not in a test's markup, which holds no literal word (the lint reads both).
// What a control says itself comes from the catalogs.

export const sample = {
  value: 'Value, kWh',
  help: 'As the meter in the cellar shows it.',
  low: 'Lower than the last reading.',
  note: 'Note',
  password: 'Password',
  register: 'Register',
  choose: 'Choose',
  members: 'Members',
  remind: 'Remind me the day before',
  share: 'Share with the household',
  repeats: 'Repeats',
  first: 'First reading',
  second: 'Second reading',
  third: 'Third reading',
  refused: 'The server refused the reading.',
  /** A destructive confirmation names its object, in its title and on its button. */
  deleteTitle: 'Delete the March reading?',
  deleteBody: 'The reading is removed for everybody. The meter keeps its other readings.',
  keep: 'Keep it',
  deleteIt: 'Delete the reading',
  edit: 'Edit the reading',
  discard: 'Discard the changes?',
  cleared: '7 checked items cleared from Weekly shop',
  archived: 'March reading archived',
  rename: 'Rename the meter',
  archive: 'Archive the meter',
  signOutPixel: 'Sign out Pixel 8',
  signOut: 'Sign out',
  openHousehold: 'Open Dům U Lípy',
  open: 'Open',
} as const

export const tariffs = [
  { value: 'day', label: 'Day tariff' },
  { value: 'night', label: 'Night tariff' },
] as const

export const intervals = [
  { value: 'week', label: 'Every week' },
  { value: 'month', label: 'Every month' },
  { value: 'never', label: 'Never' },
] as const
