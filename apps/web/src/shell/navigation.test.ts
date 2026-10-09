import { describe, expect, it } from 'vitest'
import { inHousehold } from '../app/paths.ts'
import type { ModuleKey } from '../household/households.ts'
import type { ModuleRegistry } from '../modules/registry.ts'
import { arrangementKey, parseArrangement } from './arrangement.ts'
import {
  heldModules,
  hidden,
  moved,
  navigationOf,
  noArrangement,
  pinned,
  shown,
  unpinned,
  type Arrangement,
} from './navigation.ts'

const at = (module: ModuleKey) => ({
  home: (household: string) => inHousehold.module(household, module),
})
/** A build with screens for five modules, the household's own settings among them. */
const registry: ModuleRegistry = {
  tasks: at('tasks'),
  shopping: at('shopping'),
  finance: at('finance'),
  garden: at('garden'),
  admin: at('admin'),
}

/** A member who holds four of them, Finance at `none`, and Chat, which this build cannot open. */
const household = {
  my_grants: {
    dashboard: 'view',
    tasks: 'contribute',
    shopping: 'contribute',
    finance: 'none',
    garden: 'manage',
    chat: 'view',
    admin: 'view',
  },
} as const

describe('the modules a member holds', () => {
  it('are those the household’s own answer gives a level above none, in the product’s order', () => {
    expect(heldModules(household)).toEqual([
      'dashboard',
      'tasks',
      'shopping',
      'garden',
      'chat',
      'admin',
    ])
  })

  // Its profile, its members and its modules are every member's to read (PRD 17, Permissions):
  // a level of `none` on household settings takes its invitations away, and not its screens.
  it('have household settings among them whatever level the member holds on it', () => {
    expect(heldModules({ my_grants: { tasks: 'view', admin: 'none' } })).toEqual(['tasks', 'admin'])
    expect(heldModules({ my_grants: { tasks: 'view' } })).toEqual(['tasks', 'admin'])
    expect(heldModules({})).toEqual(['admin'])
  })
})

describe('the shell’s module list', () => {
  it('holds what the member is granted and this build can open, and nothing else', () => {
    const navigation = navigationOf(household, registry)
    expect(navigation).toEqual({
      pinned: [],
      listed: ['tasks', 'shopping', 'garden', 'admin'],
      hidden: [],
    })
    // Absent, with no trace: a module at `none` is in no list, the hidden one neither, and
    // nor is one this build has no screen for, nor the dashboard, which is Home.
    const everywhere = [...navigation.pinned, ...navigation.listed, ...navigation.hidden]
    for (const absent of ['finance', 'chat', 'dashboard']) expect(everywhere).not.toContain(absent)
  })

  it('is household settings alone for a member who holds no other module', () => {
    expect(navigationOf({ my_grants: { dashboard: 'view' } }, registry)).toEqual({
      pinned: [],
      listed: ['admin'],
      hidden: [],
    })
    // And nothing at all in a build that has no screen for it.
    expect(navigationOf({ my_grants: { dashboard: 'view' } }, { tasks: at('tasks') })).toEqual({
      pinned: [],
      listed: [],
      hidden: [],
    })
  })

  it('is in the member’s own order, with what they pinned above and what they hid apart', () => {
    const arrangement: Arrangement = {
      pinned: ['garden'],
      order: ['admin', 'shopping'],
      hidden: ['tasks'],
    }
    expect(navigationOf(household, registry, arrangement)).toEqual({
      pinned: ['garden'],
      // What the order does not name comes after what it does, in the product's order.
      listed: ['admin', 'shopping'],
      hidden: ['tasks'],
    })
  })

  it('never draws a module the member no longer holds, whatever their arrangement names', () => {
    const arrangement: Arrangement = {
      pinned: ['finance', 'garden'],
      order: ['chat', 'shopping'],
      hidden: ['finance', 'notes'],
    }
    const navigation = navigationOf(household, registry, arrangement)
    expect(navigation).toEqual({
      pinned: ['garden'],
      listed: ['shopping', 'tasks', 'admin'],
      hidden: [],
    })
  })
})

describe('a change to an arrangement', () => {
  const start = navigationOf(household, registry)

  it('moves a module within its list, and holds it at the list’s ends', () => {
    const down = moved(noArrangement, start, 'tasks', 1)
    expect(navigationOf(household, registry, down).listed).toEqual([
      'shopping',
      'tasks',
      'garden',
      'admin',
    ])
    const top = moved(down, navigationOf(household, registry, down), 'shopping', -1)
    expect(navigationOf(household, registry, top).listed[0]).toBe('shopping')
    const far = moved(noArrangement, start, 'admin', 5)
    expect(navigationOf(household, registry, far).listed.at(-1)).toBe('admin')
  })

  it('pins a module above the rest, and unpins it back to the head of the list', () => {
    const one = pinned(noArrangement, start, 'garden')
    const after = navigationOf(household, registry, one)
    expect(after).toEqual({
      pinned: ['garden'],
      listed: ['tasks', 'shopping', 'admin'],
      hidden: [],
    })
    const two = pinned(one, after, 'admin')
    expect(navigationOf(household, registry, two).pinned).toEqual(['garden', 'admin'])
    const back = unpinned(two, navigationOf(household, registry, two), 'garden')
    expect(navigationOf(household, registry, back)).toEqual({
      pinned: ['admin'],
      listed: ['garden', 'tasks', 'shopping'],
      hidden: [],
    })
  })

  it('puts a module away, a pinned one too, and shows it again at the end of the list', () => {
    const one = pinned(noArrangement, start, 'garden')
    const away = hidden(one, navigationOf(household, registry, one), 'garden')
    const after = navigationOf(household, registry, away)
    expect(after).toEqual({
      pinned: [],
      listed: ['tasks', 'shopping', 'admin'],
      hidden: ['garden'],
    })
    const again = shown(away, after, 'garden')
    expect(navigationOf(household, registry, again)).toEqual({
      pinned: [],
      listed: ['tasks', 'shopping', 'admin', 'garden'],
      hidden: [],
    })
  })

  it('keeps what it names of a module the member no longer holds, for when they do again', () => {
    const arrangement: Arrangement = { pinned: ['finance'], order: [], hidden: ['notes'] }
    const next = moved(arrangement, navigationOf(household, registry, arrangement), 'tasks', 1)
    expect(next.pinned).toEqual(['finance'])
    expect(next.hidden).toEqual(['notes'])
  })
})

describe('an arrangement as this browser keeps it', () => {
  it('is kept for each member and each household', () => {
    expect(arrangementKey('U1', 'H1')).toBe('household.arrange.u1.h1')
    expect(arrangementKey('u1', 'h2')).not.toBe(arrangementKey('u1', 'h1'))
  })

  it('is read from whatever storage holds, which may be anything at all', () => {
    for (const stored of [null, '', 'not json', '7', '[]', '{"pinned":7}']) {
      expect(parseArrangement(stored), String(stored)).toEqual(noArrangement)
    }
    expect(
      parseArrangement(
        JSON.stringify({
          pinned: ['garden', 'garden', 'no-such-module', 'tasks'],
          order: ['shopping', 4],
          hidden: ['tasks'],
        }),
      ),
    ).toEqual({ pinned: ['garden'], order: ['shopping'], hidden: ['tasks'] })
  })
})
