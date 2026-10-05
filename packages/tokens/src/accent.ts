import type { ColorToken } from './color.ts'

/**
 * The five module families and Garden (DD-1), each with the accent token that carries its hue.
 * Garden sits outside the five: it is the module a member may use exclusively.
 */
export const families = {
  /** Time & work: the things that ask something of you today. */
  time: 'accent-family-time',
  /** Money: the things with a number that must be right. */
  money: 'accent-family-money',
  /** Things we own: the asset engine's three faces. */
  things: 'accent-family-things',
  /** Keeping: capture and retrieval. */
  keeping: 'accent-family-keeping',
  /** Household: the platform itself. */
  household: 'accent-family-household',
  garden: 'accent-garden',
} as const satisfies Record<string, ColorToken>

export type Family = keyof typeof families

/**
 * The accent map: seventeen module ids, six values (01-foundations §3, §10). Keyed by the
 * module's stable id, the one in routes, audit keys and translation keys, which a test holds to
 * the contract's `ModuleKeyValue`. Today and Add are not modules and hold no key: they render in
 * the Household family's hue. A hue never carries meaning alone: a module's identity is its hue
 * and its icon and its name.
 */
export const moduleFamilies = {
  dashboard: 'household',
  chat: 'household',
  activity: 'household',
  admin: 'household',
  tasks: 'time',
  reminders: 'time',
  calendar: 'time',
  chores: 'time',
  finance: 'money',
  utilities: 'money',
  property: 'things',
  vehicles: 'things',
  pets: 'things',
  notes: 'keeping',
  documents: 'keeping',
  shopping: 'keeping',
  garden: 'garden',
} as const satisfies Record<string, Family>

export type ModuleId = keyof typeof moduleFamilies

/** A module's own accent token, `accent-garden` or `accent-finance`: an alias of its family's. */
export type AccentToken = `accent-${ModuleId}`

export const moduleIds = Object.keys(moduleFamilies) as ModuleId[]

/** The family accent a module's `accent-<id>` aliases. */
export function familyAccent(module: ModuleId): ColorToken {
  return families[moduleFamilies[module]]
}
