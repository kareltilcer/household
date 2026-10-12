// The tab bar's destinations (04-navigation §3, F-11, F-12): Home · Today · Add · Chat · More, in
// that order, of which a member's bar holds those that exist for them in this build. Like the
// module list, the bar is computed and never authored: from the household's own answer and from
// what this build has screens for, by one function, so that a slot that leads nowhere cannot be
// drawn and neither can a hole where one would be.
//
// Home, Today and More are every member's. Chat is there where the household has it on, the
// member holds it and this build can open it. Add is there only where its sheet would offer
// something (plan Q6): a module this build has a capture surface for, that the member may create
// in, in a household that takes writes. A member who can create nothing is given no slot that
// opens a sheet which could only explain itself: absence, not disabling. So the bar is five
// slots, four or three, and each of those is a whole bar: the order holds, the slots share the
// width again, and none is stretched or left empty.
//
// This file is data in and data out, with nothing of React Native's or of expo-router's.
import { fileOf, inHousehold, type RouteId } from '../app/paths.ts'
import { moduleKeys, writes, type AccessLevel, type Household } from '../household/data.ts'
import { hasScreens, homeOf, type ModuleRegistry } from '../modules/registry.ts'

export type Destination = 'home' | 'today' | 'add' | 'chat' | 'more'

/** A destination that is a place. Add is none: it opens its sheet over whichever one is open. */
export type Place = Exclude<Destination, 'add'>

/** The order of the bar, which a bar with fewer slots keeps. */
export const destinations: readonly Destination[] = ['home', 'today', 'add', 'chat', 'more']

/** The levels a member creates at. */
const creates: ReadonlySet<AccessLevel | undefined> = new Set<AccessLevel>(['contribute', 'manage'])

type Asked = Pick<Household, 'my_grants' | 'entitlement'>

/**
 * Whether the Add sheet would offer this member anything: a capture surface of this build's,
 * for a module they may create in, in a household that takes writes. The household's own answer
 * holds a module it has turned off to no level, so one that is off offers nothing either.
 */
export function canAdd(household: Asked, registry: ModuleRegistry): boolean {
  if (!writes(household)) return false
  const grants = household.my_grants ?? {}
  return moduleKeys.some(
    (module) => registry[module]?.capture !== undefined && creates.has(grants[module]),
  )
}

/** Whether Chat is a destination for this member: on, held, and built. */
export function hasChat(household: Asked, registry: ModuleRegistry): boolean {
  const level = household.my_grants?.chat
  return level !== undefined && level !== 'none' && hasScreens(registry, 'chat')
}

/** The bar of a member of `household`, in a build with `registry`'s screens: its slots, in order. */
export function tabsOf(household: Asked, registry: ModuleRegistry): Destination[] {
  const absent = new Set<Destination>([
    ...(canAdd(household, registry) ? [] : ['add' as const]),
    ...(hasChat(household, registry) ? [] : ['chat' as const]),
  ])
  return destinations.filter((destination) => !absent.has(destination))
}

/** Where `place` opens in `household`. Chat opens where its module does, in a build that has it. */
export function addressOf(
  place: Place,
  household: string,
  registry: ModuleRegistry,
): string | undefined {
  switch (place) {
    case 'home':
      return inHousehold.home(household)
    case 'today':
      return inHousehold.today(household)
    case 'chat':
      return homeOf(registry, 'chat', household)
    case 'more':
      return inHousehold.more(household)
  }
}

/** The folder under app/ that holds a household's routes, which its navigator names them from. */
const folder = fileOf('household').replace(/index$/, '')

/** A household's route as its navigator names it: its file under the household's folder. */
export function routeName(id: RouteId): string {
  return fileOf(id).slice(folder.length)
}

/**
 * The place each of a household's routes stands under, by the navigator's name for the route:
 * arranging the modules and what needs attention are reached from More. A module's own screens
 * say theirs here as they are built.
 */
const places: Readonly<Partial<Record<string, Place>>> = {
  [routeName('household')]: 'home',
  [routeName('today')]: 'today',
  [routeName('more')]: 'more',
  [routeName('arrange')]: 'more',
  [routeName('sync')]: 'more',
}

/**
 * The place that is open while the household's navigator shows `route`, or null where it shows
 * none of them: an address that opens nothing is under no destination, and no slot says it is.
 */
export function placeOf(route: string): Place | null {
  return places[route] ?? null
}
