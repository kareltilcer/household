// The flows, held to the app's own names with no device to run them on: nothing on a
// developer's machine need be able to launch the app, and a name a flow has wrong would
// otherwise be found by a runner, a quarter of an hour in. That a flow passes is seen by CI's
// two jobs alone.
import { describe, expect, it } from '@jest/globals'
import { existsSync, globSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import config from '../app.config.ts'
import { paths, routeIds } from '../src/app/paths.ts'
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
  /** The files whose steps it runs as its own, as it names them: beside it, in `parts/`. */
  readonly parts: string[]
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
    parts: [...steps.matchAll(/^- runFlow: (\S+)$/gm)].map(([, part = '']) => part),
    steps,
  }
}

/** The flows Maestro runs: the files of the folder itself. */
const flows = globSync('e2e/flows/*.yaml', { cwd: app }).sort().map(flow)

/** The steps several flows share, which a flow runs as its own and Maestro runs for none. */
const parts = globSync('e2e/flows/parts/*.yaml', { cwd: app }).sort().map(flow)

/** The configuration of the build the flows run on: development's, told nothing else. */
function development(): ReturnType<typeof config> {
  for (const name of ['APP_VARIANT', 'HOUSEHOLD_MOBILE_API_URL', 'HOUSEHOLD_MOBILE_LINK_HOST']) {
    Reflect.deleteProperty(process.env, name)
  }
  return config()
}

const sources = globSync('src/**/*.{ts,tsx}', { cwd: app })
  .filter((file) => !file.includes('.test.'))
  .map((file) => readFileSync(join(app, file), 'utf8'))
  .join('\n')

/** Every `testID` the sources write out whole. */
const written = [...sources.matchAll(/testID="([^"]+)"/g)].map(([, id = '']) => id)

/**
 * Every piece of a name the sources write: what stands between the colons of a quoted string
 * or of a template's own words, and each route by its name in the table. A component makes
 * most names of pieces, `status:` and a status, a sheet's own name and `:close`, so a name is
 * held to its pieces: one misspelt is in no source. A name spelt right that its screen does
 * not draw is the run's to find.
 */
const pieces = new Set<string>(routeIds)
for (const [, , text = ''] of sources.matchAll(/(['"`])((?:(?!\1)[^\n\\])*)\1/g)) {
  for (const piece of text.replace(/\$\{[^}]*\}/g, ':').split(':')) {
    if (/^[A-Za-z0-9_.-]+$/.test(piece)) pieces.add(piece)
  }
}

/** Whether the app can draw something a flow's `id` selects. */
function drawn(id: string): boolean {
  // A pattern: something written out whole is all of it.
  if (/[.*+?()[\]|\\]/.test(id)) return written.some((known) => new RegExp(`^${id}$`).test(known))
  return written.includes(id) || id.split(':').every((piece) => pieces.has(piece))
}

describe('the flows', () => {
  it('are there, each a file Maestro takes for a flow', () => {
    expect(flows.length).toBeGreaterThan(0)
    for (const { name, steps } of [...flows, ...parts]) {
      expect([name, steps.trim()]).not.toEqual([name, ''])
    }
  })

  it('name the app the end-to-end build is: the development variant', () => {
    const { android, ios } = development()
    expect(ios?.bundleIdentifier).toBe(android?.package)
    const all = [...flows, ...parts]
    expect(all.map(({ name, appId }) => [name, appId])).toEqual(
      all.map(({ name }) => [name, android?.package]),
    )
  })

  it('run as their own only steps that are there, and a part runs none', () => {
    for (const { name, parts: named } of flows) {
      for (const part of named) {
        expect([name, part, existsSync(join(app, 'e2e', 'flows', part))]).toEqual([
          name,
          part,
          true,
        ])
      }
    }
    expect(parts.flatMap((part) => part.parts)).toEqual([])
    // A part is nobody's flow: it says no tag, and is run by a flow that does.
    expect(parts.flatMap((part) => part.tags)).toEqual([])
  })

  it('open only what that build answers to: its scheme, and an address of the table', () => {
    const { scheme } = development()
    const addresses: string[] = Object.values(paths).map(({ path }) => path)
    const opened = flows.flatMap(({ name, links }) => links.map((link) => [name, link] as const))
    expect(opened.length).toBeGreaterThan(0)
    for (const [name, link] of opened) {
      const start = `${String(scheme)}://`
      expect([name, link.startsWith(`${start}/`)]).toEqual([name, true])
      // The household the run was told of stands where the table has its parameter.
      const address = link.slice(start.length).replace('${HOUSEHOLD}', '[household]')
      expect([name, link, addresses.includes(address)]).toEqual([name, link, true])
    }
    // A part is run on both platforms, and a link is Android's alone.
    expect(parts.flatMap((part) => part.links)).toEqual([])
  })

  it('send a link from outside the app on Android alone: iOS asks first, in a dialog of its own', () => {
    const linking = flows.filter((each) => each.links.length > 0)
    expect(
      linking.filter((each) => !each.tags.includes('android')).map(({ name }) => name),
    ).toEqual([])
  })

  it('are tagged by what a run knows to leave out, and by nothing else', () => {
    const known: readonly string[] = tags
    expect(flows.flatMap((each) => each.tags).filter((tag) => !known.includes(tag))).toEqual([])
  })

  it('select by a `testID` the app draws, but for a flow written ahead of its screens', () => {
    const missing = [...flows, ...parts]
      .filter((each) => !each.tags.includes('awaiting'))
      .flatMap(({ name, ids }) => ids.filter((id) => !drawn(id)).map((id) => `${name}: ${id}`))
    expect(missing).toEqual([])
  })

  it('never select by a word: the app draws in five languages', () => {
    for (const { name, steps } of [...flows, ...parts]) {
      // A command with its selector on its own line is one by words.
      const byWords =
        /^- (tapOn|longPressOn|assertVisible|assertNotVisible|scrollUntilVisible): \S/m
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
