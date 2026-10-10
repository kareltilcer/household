// The table of routes against the files expo-router reads the routes from: a route is a line of
// paths.ts and a file under app/, and neither without the other.
import { describe, expect, it, jest } from '@jest/globals'
import requireContext from 'expo-router/build/testing-library/require-context-ponyfill'
import { fileOf, fill, inHousehold, isOwnPath, layoutFiles, paths, routeIds } from './paths.ts'

/** Every file under app/, as a path from it with no extension. Jest runs in apps/mobile. */
const files = requireContext('app', true, /\.tsx?$/)
  .keys()
  .map((key) => key.replace(/^\.\//, '').replace(/\.tsx?$/, ''))
  .sort()

/** What a file under app/ holds: the module expo-router would load for it. */
function moduleOf(file: string): Record<string, unknown> {
  return jest.requireActual<Record<string, unknown>>(`../../app/${file}.tsx`)
}

describe('the routes', () => {
  it('are each a file under app/, and every file there is a route or a layout', () => {
    const routes = routeIds.map(fileOf)
    expect(files).toEqual([...routes, ...layoutFiles].sort())
    // No two lines are one file.
    expect(new Set(routes).size).toBe(routes.length)
  })

  it.each(routeIds)('%s is a file that hands expo-router a screen', (id) => {
    // A component, or one that is loaded when it is first drawn (a dev screen's).
    const screen = moduleOf(fileOf(id)).default
    expect(['function', 'object']).toContain(typeof screen)
    expect(screen).not.toBeNull()
  })

  it('stand in a layout their address is under', () => {
    for (const id of routeIds) {
      const inside = paths[id].path.startsWith('/households/[household]')
      expect([id, paths[id].layout]).toEqual([id, inside ? 'household' : 'plain'])
    }
  })

  it('keep the dev screens apart: under /dev, and nowhere else', () => {
    for (const id of routeIds) {
      const under = paths[id].path === '/dev' || paths[id].path.startsWith('/dev/')
      expect([id, paths[id].dev]).toEqual([id, under])
    }
  })
})

describe('an address', () => {
  const household = '0198c0de-0000-7000-8000-00000000a001'

  it('of a household’s route is the web’s own', () => {
    expect(inHousehold.home(household)).toBe(`/households/${household}`)
    expect(inHousehold.today(household)).toBe(`/households/${household}/today`)
    expect(inHousehold.more(household)).toBe(`/households/${household}/more`)
    expect(inHousehold.arrange(household)).toBe(`/households/${household}/arrange`)
    expect(inHousehold.sync(household)).toBe(`/households/${household}/sync`)
    expect(inHousehold.module(household, 'tasks')).toBe(`/households/${household}/modules/tasks`)
    expect(inHousehold.module(household, 'tasks', '/lists/7')).toBe(
      `/households/${household}/modules/tasks/lists/7`,
    )
  })

  it('writes a value as one segment, whatever it holds, and needs every one', () => {
    expect(fill(paths.sync.path, { household: 'a/b?c' })).toBe('/households/a%2Fb%3Fc/sync')
    expect(() => fill(paths.sync.path, {})).toThrow(/household/)
  })

  it('is the app’s own only as a path from the root', () => {
    expect(isOwnPath('/households/x/sync')).toBe(true)
    expect(isOwnPath('/')).toBe(true)
    for (const other of [
      '//evil.test/x',
      '/\\evil.test',
      'https://evil.test/',
      'households/x',
      '',
    ]) {
      expect([other, isOwnPath(other)]).toEqual([other, false])
    }
  })
})
