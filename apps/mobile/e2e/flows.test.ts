// The flows, held to the app's own names with no device to run them on: nothing on a
// developer's machine need be able to launch the app, and a name a flow has wrong would
// otherwise be found by a runner, a quarter of an hour in. That a flow passes is seen by CI's
// two jobs alone.
import { describe, expect, it } from '@jest/globals'
import { globSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import config from '../app.config.ts'
import { paths, routeIds } from '../src/app/paths.ts'
import { devMarker } from '../src/dev/marker.ts'
import { tags } from './maestro.ts'

/** apps/mobile: Jest runs in it. */
const app = resolve('.')

interface Flow {
  readonly name: string
  readonly appId: string | undefined
  readonly tags: string[]
  /** Each `id` the flow selects by, as it is written: Maestro reads one as a pattern. */
  readonly ids: string[]
  readonly links: string[]
  readonly steps: string
}

/** A flow as far as this test reads one: what stands above its `---`, and its steps. */
function flow(file: string): Flow {
  const [head = '', steps = ''] = readFileSync(join(app, file), 'utf8').split(/^---$/m)
  return {
    name: basename(file),
    appId: /^appId: (\S+)$/m.exec(head)?.[1],
    tags: [...head.matchAll(/^ {2}- (\S+)$/gm)].map(([, tag = '']) => tag),
    ids: [...steps.matchAll(/^\s+id: '?([^'\n]+?)'?$/gm)].map(([, id = '']) => id),
    links: [...steps.matchAll(/^- openLink: (\S+)$/gm)].map(([, link = '']) => link),
    steps,
  }
}

const flows = globSync('e2e/flows/*.yaml', { cwd: app }).sort().map(flow)

/** The configuration of the build the flows run on: development's, told nothing else. */
function development(): ReturnType<typeof config> {
  for (const name of ['APP_VARIANT', 'HOUSEHOLD_MOBILE_API_URL', 'HOUSEHOLD_MOBILE_LINK_HOST']) {
    Reflect.deleteProperty(process.env, name)
  }
  return config()
}

const sources = globSync('src/**/*.tsx', { cwd: app })
  .filter((file) => !file.includes('.test.'))
  .map((file) => readFileSync(join(app, file), 'utf8'))
  .join('\n')

/** Every `testID` the sources write out whole. */
const written = [...sources.matchAll(/testID="([^"]+)"/g)].map(([, id = '']) => id)

/** What a `testID` the sources make of a value begins with, where it begins with anything. */
const begun = [...sources.matchAll(/testID=\{`([^$`]+)\$\{/g)].map(([, start = '']) => start)

/** The dev screens' own, each named for its address: `/dev` is the index. */
const devScreens = routeIds
  .filter((id) => paths[id].dev)
  .map((id) => `${devMarker}:${paths[id].path === '/dev' ? 'index' : paths[id].path.slice(5)}`)

/** Whether the app can draw something a flow's `id` selects. */
function drawn(id: string): boolean {
  // A pattern: something written out whole is all of it.
  if (/[.*+?()[\]|\\]/.test(id)) return written.some((known) => new RegExp(`^${id}$`).test(known))
  return (
    written.includes(id) || devScreens.includes(id) || begun.some((start) => id.startsWith(start))
  )
}

describe('the flows', () => {
  it('are there, each a file Maestro takes for a flow', () => {
    expect(flows.length).toBeGreaterThan(0)
    for (const { name, steps } of flows) expect([name, steps.trim()]).not.toEqual([name, ''])
  })

  it('name the app the end-to-end build is: the development variant', () => {
    const { android, ios } = development()
    expect(ios?.bundleIdentifier).toBe(android?.package)
    expect(flows.map(({ name, appId }) => [name, appId])).toEqual(
      flows.map(({ name }) => [name, android?.package]),
    )
  })

  it('open only what that build answers to: its scheme, and an address of the table', () => {
    const { scheme } = development()
    const addresses: string[] = Object.values(paths).map(({ path }) => path)
    const opened = flows.flatMap(({ name, links }) => links.map((link) => [name, link] as const))
    expect(opened.length).toBeGreaterThan(0)
    for (const [name, link] of opened) {
      const start = `${String(scheme)}://`
      expect([name, link.startsWith(`${start}/`)]).toEqual([name, true])
      expect([name, addresses.includes(link.slice(start.length))]).toEqual([name, true])
    }
  })

  it('are tagged by what a run knows to leave out, and by nothing else', () => {
    const known: readonly string[] = tags
    expect(flows.flatMap((each) => each.tags).filter((tag) => !known.includes(tag))).toEqual([])
  })

  it('select by a `testID` the app draws, but for a flow written ahead of its screens', () => {
    const missing = flows
      .filter((each) => !each.tags.includes('awaiting'))
      .flatMap(({ name, ids }) => ids.filter((id) => !drawn(id)).map((id) => `${name}: ${id}`))
    expect(missing).toEqual([])
  })

  it('never select by a word: the app draws in five languages', () => {
    for (const { name, steps } of flows) {
      // A command with its selector on its own line is one by words.
      const byWords = /^- (tapOn|assertVisible|assertNotVisible|scrollUntilVisible): \S/m
      expect([name, byWords.test(steps)]).toEqual([name, false])
      // And what is read of an element is read of one found by its `testID`.
      const lines = steps.split('\n')
      const loose = lines.filter(
        (line, at) => /^\s+text: /.test(line) && !/^\s+id: /.test(lines[at - 1] ?? ''),
      )
      expect([name, loose]).toEqual([name, []])
    }
  })
})
