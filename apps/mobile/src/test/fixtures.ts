// The names and the words a test may draw. A test's markup holds no literal word, as the app's
// holds none (the lint reads both): what a member would have typed comes from here, and what
// the app says comes from the catalogs. A name holds no run of four plain letters, which the
// pseudo-locale's pass takes for a word nobody translated: a name is data, and is drawn as it
// is in every language.
import { inHousehold } from '../app/paths.ts'
import type { EntitlementState, Household, HouseholdSummary, ModuleKey } from '../household/data.ts'
import type { ModuleRegistry, ModuleScreens } from '../modules/registry.ts'

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
 * A household as its member reads it (`GET /households/{id}`): the fixtures' own, a member's,
 * holding nothing and taking writes, or what `over` makes of it.
 */
export function householdOf(over: Partial<Household> = {}): Household {
  return {
    ...households.own,
    country: 'CZ',
    timezone: 'Europe/Prague',
    base_currency: 'CZK',
    locale: 'cs-CZ',
    my_role: 'member',
    my_grants: {},
    entitlement: { state: 'active', can_write: true },
    ...over,
  }
}

/** A household as a member's list of theirs names it, in the state its entitlement is in. */
export function summaryOf(
  household: { readonly id: string; readonly name?: string },
  state: EntitlementState = 'active',
): HouseholdSummary {
  const { id, name } = household
  return { id, ...(name === undefined ? {} : { name }), entitlement: { state } }
}

/** A module's screens as a build registers them (modules/registry.ts): where the module opens. */
export function screensOf(module: ModuleKey): ModuleScreens {
  return { home: (household) => inHousehold.module(household, module) }
}

/** A build with screens for five modules, the household's own settings among them. */
export const fiveModules: ModuleRegistry = {
  tasks: screensOf('tasks'),
  shopping: screensOf('shopping'),
  finance: screensOf('finance'),
  garden: screensOf('garden'),
  admin: screensOf('admin'),
}

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
