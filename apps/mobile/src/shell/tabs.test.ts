// The tab bar's slots, a row a case: the bar is computed from the household's own answer and the
// build's registry (tabs.ts), and each of five, four and three slots is a bar a member may have.
import { describe, expect, it } from '@jest/globals'
import { inHousehold } from '../app/paths.ts'
import type { Household, ModuleKey } from '../household/data.ts'
import { modules, type ModuleRegistry } from '../modules/registry.ts'
import { ids, screensOf } from '../test/fixtures.ts'
import { addressOf, canAdd, destinations, hasChat, placeOf, routeName, tabsOf } from './tabs.ts'

const taking = (module: ModuleKey) => ({
  ...screensOf(module),
  capture: (household: string) => inHousehold.module(household, module, 'new'),
})

/** A build with Chat's screens, and a capture surface for Shopping and for Tasks. */
const built: ModuleRegistry = {
  shopping: taking('shopping'),
  tasks: taking('tasks'),
  chat: screensOf('chat'),
  admin: screensOf('admin'),
}

type Asked = Pick<Household, 'my_grants' | 'entitlement'>

/** A member who creates in Shopping and holds Chat, in a household that takes writes. */
const everything: Asked = {
  my_grants: { dashboard: 'view', shopping: 'contribute', tasks: 'view', chat: 'contribute' },
  entitlement: { state: 'active', can_write: true },
}

const cases: readonly (readonly [string, Asked, ModuleRegistry, readonly string[]])[] = [
  [
    'a member with everything has five',
    everything,
    built,
    ['home', 'today', 'add', 'chat', 'more'],
  ],
  [
    'a member with none on Chat has four, Add still the third',
    { ...everything, my_grants: { ...everything.my_grants, chat: 'none' } },
    built,
    ['home', 'today', 'add', 'more'],
  ],
  [
    'a household with Chat turned off holds it to no level, and has four',
    { ...everything, my_grants: { dashboard: 'view', shopping: 'manage' } },
    built,
    ['home', 'today', 'add', 'more'],
  ],
  [
    'a member who can create nothing has no Add',
    { ...everything, my_grants: { dashboard: 'view', shopping: 'view', chat: 'view' } },
    built,
    ['home', 'today', 'chat', 'more'],
  ],
  [
    'a member with neither has three',
    { ...everything, my_grants: { dashboard: 'view', shopping: 'view', tasks: 'view' } },
    built,
    ['home', 'today', 'more'],
  ],
  [
    'a household that takes no writes has no Add, whatever its member holds',
    { ...everything, entitlement: { state: 'read_only', can_write: false } },
    built,
    ['home', 'today', 'chat', 'more'],
  ],
  [
    'a module the build has no screen for adds nothing: Chat held and not built',
    everything,
    { shopping: taking('shopping') },
    ['home', 'today', 'add', 'more'],
  ],
  [
    'a module the build has no capture surface for offers nothing to create',
    everything,
    { shopping: screensOf('shopping'), chat: screensOf('chat') },
    ['home', 'today', 'chat', 'more'],
  ],
  [
    'a capture surface for a module the member only reads offers them nothing',
    everything,
    { tasks: taking('tasks'), chat: screensOf('chat') },
    ['home', 'today', 'chat', 'more'],
  ],
  [
    'a member the household’s answer grants nothing has three',
    {},
    built,
    ['home', 'today', 'more'],
  ],
]

describe('the tab bar’s slots', () => {
  it.each(cases)('%s', (_, household, registry, slots) => {
    expect(tabsOf(household, registry)).toEqual(slots)
  })

  it('keep the order of the five in every bar', () => {
    for (const [, household, registry] of cases) {
      const slots = tabsOf(household, registry)
      expect(slots).toEqual(destinations.filter((destination) => slots.includes(destination)))
    }
  })

  it('take a household whose answer says nothing of writes for one that takes them', () => {
    expect(canAdd({ my_grants: { shopping: 'manage' } }, built)).toBe(true)
    expect(hasChat({ my_grants: { chat: 'view' } }, built)).toBe(true)
  })

  // The seam item 38 fills: Add opens a sheet that does not exist yet (HouseholdLayout.tsx). A
  // module's item that registers a capture surface before then draws a slot that opens nothing.
  it('are Home, Today and More in this build: it has no capture surface and no Chat', () => {
    expect(Object.values(modules).some((screens) => screens.capture !== undefined)).toBe(false)
    expect(tabsOf(everything, modules)).toEqual(['home', 'today', 'more'])
  })
})

describe('a place', () => {
  it('opens at the household’s own address for it', () => {
    expect(addressOf('home', ids.household, built)).toBe(`/households/${ids.household}`)
    expect(addressOf('today', ids.household, built)).toBe(`/households/${ids.household}/today`)
    expect(addressOf('more', ids.household, built)).toBe(`/households/${ids.household}/more`)
    // Chat opens where its module does, and nowhere in a build that has none.
    expect(addressOf('chat', ids.household, built)).toBe(
      `/households/${ids.household}/modules/chat`,
    )
    expect(addressOf('chat', ids.household, {})).toBeUndefined()
  })

  it('is the one each of the household’s routes stands under, as its navigator names the route', () => {
    expect(routeName('household')).toBe('index')
    expect(placeOf('index')).toBe('home')
    expect(placeOf('today')).toBe('today')
    for (const under of ['more', 'arrange', 'sync']) expect(placeOf(under)).toBe('more')
  })

  // An address that opens nothing is under no destination: no slot says that it is open.
  it('is none for a route that draws not available', () => {
    expect(placeOf(routeName('householdNotFound'))).toBeNull()
    expect(placeOf(routeName('module'))).toBeNull()
    expect(placeOf('no-such-route')).toBeNull()
  })
})
