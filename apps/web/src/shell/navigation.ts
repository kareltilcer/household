// Navigation is computed, never authored (design/v1 nav.js, 04-navigation §5, D-38): the shell's
// module list is derived from what the household's own answer grants this member, so a module
// they do not hold cannot be drawn by accident. This file is that derivation, with nothing of
// React's or the DOM's.
//
// Three sets come out of it. *Pinned* and *listed* are what the sidebar draws, in the member's own
// order. *Hidden* is what the member put away themselves, and is named in one place, the arrange
// screen. A module the member holds `none` on, or the household has turned off, is in none of
// the three: absent, with no trace, and not counted.
import { moduleKeys, type Household, type ModuleKey } from '../household/households.ts'
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
 * Household settings is every member's to open, whatever level they hold on it (D-167): its
 * profile, its members with what each of them holds and its modules are read by every member
 * (PRD 17, Permissions), "why can Petr see Finance and I can't" being a question nobody should
 * need an owner for. A level of `none` on it takes away what `view` unlocks, the invitations,
 * whose own screen answers for that; every change in it is an owner's.
 */
const everyMembers: ReadonlySet<ModuleKey> = new Set<ModuleKey>(['admin'])

/**
 * The modules the member holds in `household`, in the product's order: each the household's own
 * answer gives a level above `none`, and the one that is every member's. That answer already
 * holds a module the household turned off, or whose flag is off, to no level (openapi.yaml,
 * `my_grants`).
 */
export function heldModules(household: Pick<Household, 'my_grants'>): ModuleKey[] {
  const grants = household.my_grants ?? {}
  return moduleKeys.filter((module) => {
    if (everyMembers.has(module)) return true
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

/** The arrangement that draws `navigation` as it stands: what a change to it starts from. */
function settled(arrangement: Arrangement, navigation: Navigation): Arrangement {
  // What the arrangement names beyond what is drawn, a module the member no longer holds, is
  // kept where it was: it comes back there if they hold it again.
  const drawn = new Set<ModuleKey>([
    ...navigation.pinned,
    ...navigation.listed,
    ...navigation.hidden,
  ])
  const kept = (list: readonly ModuleKey[]) => list.filter((module) => !drawn.has(module))
  return {
    pinned: [...navigation.pinned, ...kept(arrangement.pinned)],
    order: [...navigation.listed, ...kept(arrangement.order)],
    hidden: [...navigation.hidden, ...kept(arrangement.hidden)],
  }
}

/**
 * `arrangement` with `module` moved `by` places in the list it is in, the pinned ones or the
 * rest, and held at that list's ends.
 */
export function moved(
  arrangement: Arrangement,
  navigation: Navigation,
  module: ModuleKey,
  by: number,
): Arrangement {
  const base = settled(arrangement, navigation)
  const within = (list: readonly ModuleKey[], length: number): ModuleKey[] | undefined => {
    const from = list.indexOf(module)
    if (from === -1 || from >= length) return undefined
    const to = Math.min(length - 1, Math.max(0, from + by))
    const next = [...list]
    next.splice(from, 1)
    next.splice(to, 0, module)
    return next
  }
  const pinned = within(base.pinned, navigation.pinned.length)
  if (pinned !== undefined) return { ...base, pinned }
  const order = within(base.order, navigation.listed.length)
  return order === undefined ? base : { ...base, order }
}

/** `arrangement` with `module` pinned, after the ones pinned already. */
export function pinned(
  arrangement: Arrangement,
  navigation: Navigation,
  module: ModuleKey,
): Arrangement {
  const base = settled(arrangement, navigation)
  if (!navigation.listed.includes(module)) return base
  return {
    ...base,
    pinned: [...navigation.pinned, module, ...base.pinned.slice(navigation.pinned.length)],
    order: base.order.filter((other) => other !== module),
  }
}

/** `arrangement` with `module` no longer pinned: first of the rest, next to where it was. */
export function unpinned(
  arrangement: Arrangement,
  navigation: Navigation,
  module: ModuleKey,
): Arrangement {
  const base = settled(arrangement, navigation)
  if (!navigation.pinned.includes(module)) return base
  return {
    ...base,
    pinned: base.pinned.filter((other) => other !== module),
    order: [module, ...base.order],
  }
}

/** `arrangement` with `module` put away: in neither list, and named in the arrange screen alone. */
export function hidden(
  arrangement: Arrangement,
  navigation: Navigation,
  module: ModuleKey,
): Arrangement {
  const base = settled(arrangement, navigation)
  if (base.hidden.includes(module)) return base
  return {
    pinned: base.pinned.filter((other) => other !== module),
    order: base.order.filter((other) => other !== module),
    hidden: [...navigation.hidden, module, ...base.hidden.slice(navigation.hidden.length)],
  }
}

/** `arrangement` with `module` shown again: last of the list, where a member looks for it. */
export function shown(
  arrangement: Arrangement,
  navigation: Navigation,
  module: ModuleKey,
): Arrangement {
  const base = settled(arrangement, navigation)
  if (!navigation.hidden.includes(module)) return base
  return {
    ...base,
    hidden: base.hidden.filter((other) => other !== module),
    order: [
      ...navigation.listed,
      module,
      ...base.order.slice(navigation.listed.length).filter((other) => other !== module),
    ],
  }
}
