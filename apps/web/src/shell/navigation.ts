// Navigation is computed, never authored (design/v1 nav.js, 04-navigation §5, D-38): the shell's
// module list is derived from what the household's own answer grants this member, so a module
// they do not hold cannot be drawn by accident. This file is that derivation, with nothing of
// React's or the DOM's.
//
// Three sets come out of it. *Pinned* and *listed* are what the sidebar draws, in the member's own
// order. *Hidden* is what the member put away themselves, and is named in one place, the arrange
// screen. A module the member holds `none` on, or the household has turned off, is in none of
// the three: absent, with no trace, and not counted.
import { moduleIds } from '@household/tokens'
import type { Household, ModuleKey } from '../household/households.ts'
import { hasScreens, type ModuleRegistry } from '../modules/registry.ts'

/** A member's own arrangement of their modules in one household (D-38). */
export interface Arrangement {
  /** Above the rest, in this order. */
  readonly pinned: readonly ModuleKey[]
  /** The order of the rest. A module it does not name comes after those it does. */
  readonly order: readonly ModuleKey[]
  /** Put away by the member: in no list but the arrange screen's own. */
  readonly hidden: readonly ModuleKey[]
}

/** The arrangement of a member who has made none: every module, in the product's order. */
export const noArrangement: Arrangement = { pinned: [], order: [], hidden: [] }

export interface Navigation {
  readonly pinned: readonly ModuleKey[]
  readonly listed: readonly ModuleKey[]
  readonly hidden: readonly ModuleKey[]
}

/**
 * The dashboard is the household's Home, assembled from whatever the member does hold: it is a
 * destination of its own and never a row of the module list (nav.js, PLATFORM).
 */
const destinations: ReadonlySet<ModuleKey> = new Set<ModuleKey>(['dashboard'])

/**
 * The modules the member holds in `household`, in the product's order: each the household's own
 * answer gives a level above `none`. That answer already holds a module the household turned off,
 * or whose flag is off, to no level (openapi.yaml, `my_grants`).
 */
export function heldModules(household: Pick<Household, 'my_grants'>): ModuleKey[] {
  const grants = household.my_grants ?? {}
  return moduleIds.filter((module) => {
    const level = grants[module]
    return level !== undefined && level !== 'none'
  })
}

/** The shell's module list for a member of `household`, in a build with `registry`'s screens. */
export function navigationOf(
  household: Pick<Household, 'my_grants'>,
  registry: ModuleRegistry,
  arrangement: Arrangement = noArrangement,
): Navigation {
  const open = heldModules(household).filter(
    (module) => !destinations.has(module) && hasScreens(registry, module),
  )
  const has = (list: readonly ModuleKey[], module: ModuleKey) => list.includes(module)
  // What an arrangement names and the member no longer holds is passed over, and stays in the
  // arrangement: a module turned on again comes back where it was.
  const hidden = arrangement.hidden.filter((module) => has(open, module))
  const pinned = arrangement.pinned.filter((module) => has(open, module) && !has(hidden, module))
  const place = (module: ModuleKey) => {
    const at = arrangement.order.indexOf(module)
    return at === -1 ? arrangement.order.length + open.indexOf(module) : at
  }
  const listed = open
    .filter((module) => !has(pinned, module) && !has(hidden, module))
    .sort((a, b) => place(a) - place(b))
  return { pinned: [...new Set(pinned)], listed, hidden: [...new Set(hidden)] }
}
