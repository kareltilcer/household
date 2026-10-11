// The dev screens every other one stands on: the engine's lines, the toolbar, the index and the
// page of primitives. Their words are fixtures (D-154), so a test reads them by `testID`, as the
// end-to-end flow does. The harness, the shell's page, the sync UI's and the sign-in form each
// have a test beside them.
import { describe, expect, it, jest } from '@jest/globals'
import { pseudolocalize } from '@household/i18n'
import { fonts } from '@household/tokens'
import { screen, userEvent } from '@testing-library/react-native'
import { router } from 'expo-router'
import { paths } from '../app/paths.ts'
import { createFormatters, type Formatters } from '../i18n/format.ts'
import { expectAccessible } from '../test/a11y.ts'
import { render } from '../test/render.tsx'
import { held, lacking } from './engine/builtins.ts'
import {
  allChecks,
  builtIns,
  client,
  fontFamilies,
  formats,
  i18nVectors,
  randomSource,
} from './engine/checks.ts'
import Engine from './engine/Engine.tsx'
import DevIndex, { devRoutes } from './Index.tsx'
import { devMarker } from './marker.ts'
import Primitives from './Primitives.tsx'

describe('the engine’s checks', () => {
  it('run every case of vectors/i18n.json on the engine they are asked on, and all hold', () => {
    const [format, match] = i18nVectors()
    expect(format).toEqual({ id: 'vectors-format', cases: 87, failed: [] })
    expect(match).toEqual({ id: 'vectors-match', cases: 8, failed: [] })
  })

  it('find each family the type scale names, or say which the device has not', () => {
    const families = Object.values(fonts).flatMap((face) => Object.values<string>(face.native))
    expect(fontFamilies((family) => families.includes(family))).toEqual({
      id: 'fonts',
      cases: 5,
      failed: [],
    })
    expect(fontFamilies((family) => family !== 'IBMPlexMono-Medium').failed).toEqual([
      'IBMPlexMono-Medium',
    ])
    // A device that cannot say is one that has none.
    expect(
      fontFamilies(() => {
        throw new Error('no font module')
      }).failed,
    ).toHaveLength(5)
  })

  it('draw two identifiers that are UUIDv7 and not the same, and name the client', () => {
    expect(randomSource()).toEqual({ id: 'random', cases: 2, failed: [] })
    expect(client()).toMatchObject({ id: 'client', failed: [] })
    expect(client().found).toMatch(/^mobile\/\d+\.\d+\.\d+$/)
  })

  it('hold the engine to the list of what a device lacks and what it has', () => {
    // An engine that is as the list says: none of the first, all of the second.
    const device = builtIns((builtIn) => held.includes(builtIn))
    expect(device).toEqual({ id: 'built-ins', cases: lacking.length + held.length, failed: [] })
    // One that has gained what the list says it lacks, and lost what it says is there.
    const other = builtIns((builtIn) => !held.includes(builtIn))
    expect(other.failed).toEqual([
      ...lacking.map(({ name }) => `gained: ${name}`),
      ...held.map(({ name }) => `absent: ${name}`),
    ])
    // And Node, which Jest runs on, has every one the list says a device lacks: a call of one
    // passes every test here, which is why the sources are read for them (e2e/engine.test.ts).
    expect(lacking.filter((builtIn) => !builtIn.has()).map(({ name }) => name)).toEqual([])
  })

  it('write a sample of each thing the app formats as Node writes it, and name what differs', () => {
    // What the check holds a device to is what Node writes here: this is where it is held, to
    // the very string, a date's as a number's. Nothing varied, so nothing is said to have.
    const here = formats()
    expect(here).toEqual({ id: 'formats', cases: 10, failed: [], apart: true })
    expect(here.found).toBeUndefined()
    // An engine that writes another way is named with what it wrote.
    const german = formats(() => createFormatters('de'))
    expect(german.failed).toContain('en day: 3. März 2026')
    // Every sample but one: German writes a size as Czech does.
    expect(german.failed).toHaveLength(9)
    expect(german.found).toBeUndefined()
  })

  // The spaces a device's `Intl` writes, by code point: none of them shows in a source.
  const nbsp = String.fromCharCode(0x00a0)
  const thin = String.fromCharCode(0x2009)
  const narrow = String.fromCharCode(0x202f)

  /** The app's formatters, but for what `written` says a device's own `Intl` wrote instead. */
  const device =
    (written: Partial<Record<keyof Formatters, Readonly<Record<string, string>>>>) =>
    (locale: string): Formatters => ({
      ...createFormatters(locale),
      ...Object.fromEntries(
        Object.entries(written).map(([name, by]) => [name, () => by[locale] ?? 'no sample']),
      ),
    })

  it('let a date be written as a device’s own ICU writes it, and say what was written', () => {
    // What the simulator of iOS 26 wrote (run 38152216148): a word between the day and its
    // time where Node writes a comma, and a narrow no-break space where Node writes a plain one.
    const iphone = formats(
      device({
        instant: {
          en: `Mar 3, 2026 at 6:41${narrow}PM`,
          cs: `3.${narrow}3.${narrow}2026 18:41`,
        },
      }),
    )
    expect(iphone.failed).toEqual([])
    expect(iphone.found?.split('\n')).toEqual([
      `en instant: Mar 3, 2026 at 6:41${narrow}PM`,
      `cs instant: 3.${narrow}3.${narrow}2026 18:41`,
    ])
    // A comma that is not there, a no-break space, an abbreviation's full stop.
    const other = formats(
      device({
        day: { en: 'March 3 2026', cs: `3.${nbsp}března 2026` },
        instant: { en: `Mar. 3, 2026, 6:41${thin}PM`, cs: '3.3.2026 18:41' },
        list: { en: 'Petr, Jana and Tomáš', cs: 'Petr, Jana a Tomáš' },
      }),
    )
    expect(other.failed).toEqual([])
    expect(other.found?.split('\n')).toHaveLength(6)
  })

  it('fail a date that is wrong in substance, however it is spaced', () => {
    // The hour of another zone than the one named; a day that is one off; a month named in
    // another language; the day and the month the other way round; a time of another clock.
    const wrong = {
      'the hour': { en: 'Mar 3, 2026, 5:41 PM', cs: '3. 3. 2026 17:41' },
      'the day': { en: 'Mar 2, 2026, 6:41 PM', cs: '2. 3. 2026 18:41' },
      'the month': { en: 'bře 3, 2026, 6:41 PM', cs: '3. Mar 2026 18:41' },
      'the order': { en: '3 Mar 2026, 6:41 PM', cs: '2026 3. 3. 18:41' },
      'the clock': { en: 'Mar 3, 2026, 18:41', cs: '3. 3. 2026 6:41 PM' },
    }
    for (const [what, instant] of Object.entries(wrong)) {
      const { failed, found } = formats(device({ instant }))
      expect([what, failed]).toEqual([
        what,
        [`en instant: ${instant.en}`, `cs instant: ${instant.cs}`],
      ])
      expect([what, found]).toEqual([what, undefined])
    }
    // A joining word is the language's own: English's is no part of a Czech date.
    const joined = { en: 'Mar 3, 2026, 6:41 PM', cs: '3. 3. 2026 at 18:41' }
    expect(formats(device({ instant: joined })).failed).toEqual(['cs instant: 3. 3. 2026 at 18:41'])
  })

  it('hold what FormatJS writes to the very string: a number written another way is a defect', () => {
    // A device's own `Intl.NumberFormat`, were the polyfill not reached: a narrow no-break
    // space where FormatJS groups with a no-break one, and a no-break one before a unit where
    // it writes a plain one. Folded, each would be the sample's own fields.
    const native = formats(
      device({
        money: { en: `CZK${narrow}1,240.00`, cs: `1${narrow}240,00${nbsp}CZK` },
        bytes: { en: `1.5${nbsp}MB`, cs: `1,5${nbsp}MB` },
      }),
    )
    expect(native.failed).toEqual([
      `en money: CZK${narrow}1,240.00`,
      `cs money: 1${narrow}240,00${nbsp}CZK`,
      `en bytes: 1.5${nbsp}MB`,
      `cs bytes: 1,5${nbsp}MB`,
    ])
    expect(native.found).toBeUndefined()
  })
})

describe('the engine screen', () => {
  it('says how each check came out by a `testID`, and that all passed where all did', async () => {
    // The fonts are the binary's and the built-ins a device's engine's: neither is Node's.
    const checks = allChecks().map((check) =>
      check.id === 'fonts' || check.id === 'built-ins' ? { ...check, failed: [] } : check,
    )
    await render(<Engine checks={checks} />)
    for (const id of [
      'vectors-format',
      'vectors-match',
      'fonts',
      'random',
      'client',
      'built-ins',
    ]) {
      expect(screen.getByTestId(`engine:${id}:passed`)).toBeOnTheScreen()
    }
    expect(screen.getByTestId('engine:all:passed')).toBeOnTheScreen()
    expect(screen.getByTestId('engine:client:found')).toHaveTextContent(/^mobile\//)
    expect(screen.getByTestId(`${devMarker}:engine`)).toBeOnTheScreen()
    expectAccessible()
  })

  it('names what failed, and no longer says that all passed', async () => {
    await render(
      <Engine
        checks={[
          { id: 'vectors-format', cases: 87, failed: ['cs: 2 is few'] },
          { id: 'random', cases: 2, failed: [] },
        ]}
      />,
    )
    expect(screen.getByTestId('engine:vectors-format:failed')).toHaveTextContent(/cs: 2 is few/)
    expect(screen.getByTestId('engine:random:passed')).toBeOnTheScreen()
    expect(screen.getByTestId('engine:all:failed')).toBeOnTheScreen()
    expect(screen.queryByTestId('engine:all:passed')).toBeNull()
  })
})

describe('the dev toolbar', () => {
  it('changes the language, the pseudo-locale among them, and a fixture is accented under it', async () => {
    await render(<DevIndex />)
    const language = screen.getByTestId('dev-toolbar:language')
    expect(language).toHaveTextContent('Language: en')
    for (const next of ['cs', 'sk', 'de', 'pl']) {
      await userEvent.press(language)
      expect(language).toHaveTextContent(`Language: ${next}`)
    }
    await userEvent.press(language)
    expect(language).toHaveTextContent(`${pseudolocalize('Language')}: en-XA`)
    expect(screen.getByRole('header')).toHaveTextContent(pseudolocalize('Dev screens'))
  })

  it('changes the theme and motion, and holds the text at 100 or at 200 %', async () => {
    await render(<DevIndex />)
    await userEvent.press(screen.getByTestId('dev-toolbar:theme'))
    expect(screen.getByTestId('dev-toolbar:theme')).toHaveTextContent('Theme: dark')
    await userEvent.press(screen.getByTestId('dev-toolbar:motion'))
    expect(screen.getByTestId('dev-toolbar:motion')).toHaveTextContent('Motion: reduced')

    const scale = screen.getByTestId('dev-toolbar:scale')
    const high = () => (scale.props.style as { minHeight: number }).minHeight
    expect(scale).toHaveTextContent('Text: device')
    await userEvent.press(scale)
    expect(scale).toHaveTextContent('Text: 100')
    expect(high()).toBe(44)
    await userEvent.press(scale)
    expect(scale).toHaveTextContent('Text: 200')
    expect(high()).toBe(88)
    expectAccessible(screen.root, { scale: 2 })
  })

  it('gives the text back to the device’s own size at the press after 200 %', async () => {
    await render(<DevIndex />)
    const scale = screen.getByTestId('dev-toolbar:scale')
    await userEvent.press(scale)
    await userEvent.press(scale)
    expect(scale).toHaveTextContent('Text: 200')
    await userEvent.press(scale)
    expect(scale).toHaveTextContent('Text: device')
  })
})

describe('a dev screen', () => {
  it('leads to the index of them at a press, by a `testID` and with no address to type', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => undefined)
    await render(<Engine checks={[]} />)
    const index = screen.getByTestId('dev-screen:index')
    // Its name is the address it leads to, which is data.
    expect(index).toHaveTextContent(paths.dev.path)
    await userEvent.press(index)
    expect(push.mock.calls).toEqual([[paths.dev.path]])
    expectAccessible()
    push.mockRestore()
  })

  it('offers no way to the index on the index itself', async () => {
    await render(<DevIndex />)
    expect(screen.queryByTestId('dev-screen:index')).toBeNull()
  })
})

describe('the dev index and the page of primitives', () => {
  it('list every dev screen that is a route, each by a `testID`', async () => {
    await render(<DevIndex />)
    expect(devRoutes.map((id) => paths[id].path)).toEqual([
      '/dev/harness',
      '/dev/primitives',
      '/dev/shell',
      '/dev/sync',
      '/dev/engine',
      '/dev/sign-in',
    ])
    for (const id of devRoutes) {
      expect(screen.getByTestId(`dev-index:${id}`)).toHaveTextContent(paths[id].path)
    }
    expectAccessible()
  })

  it.each([1, 2])(
    'draw the page of primitives accessibly, at a text scale of %i',
    async (scale) => {
      await render(<Primitives />, { scale })
      expect(screen.getByTestId(`${devMarker}:primitives`)).toBeOnTheScreen()
      expectAccessible()
    },
  )
})
