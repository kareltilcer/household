// The dev screens the core draws: the engine's lines, the toolbar, the index and the page of
// primitives. Their words are fixtures (D-154), so a test reads them by `testID`, as the
// end-to-end flow does.
import { describe, expect, it, jest } from '@jest/globals'
import { pseudolocalize } from '@household/i18n'
import { fonts } from '@household/tokens'
import { screen, userEvent } from '@testing-library/react-native'
import { router } from 'expo-router'
import { paths } from '../app/paths.ts'
import { expectAccessible } from '../test/a11y.ts'
import { render } from '../test/render.tsx'
import { allChecks, client, fontFamilies, i18nVectors, randomSource } from './engine/checks.ts'
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
})

describe('the engine screen', () => {
  it('says how each check came out by a `testID`, and that all passed where all did', async () => {
    const checks = allChecks().map((check) =>
      check.id === 'fonts' ? { ...check, failed: [] } : check,
    )
    await render(<Engine checks={checks} />)
    for (const id of ['vectors-format', 'vectors-match', 'fonts', 'random', 'client']) {
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

  it.each([1, 2])('draw what the core built accessibly, at a text scale of %i', async (scale) => {
    await render(<Primitives />, { scale })
    expect(screen.getByTestId(`${devMarker}:primitives`)).toBeOnTheScreen()
    expectAccessible()
  })
})
