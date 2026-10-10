// The shell's dev screen: every drawing of the bar, in both themes, at both text sizes and both
// widths, and the rest of the shell over fixtures. Its words are fixtures (D-154), so a test
// reads it by `testID`, as the end-to-end flow does.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { catalogs, pseudolocalize } from '@household/i18n'
import { nativeThemes } from '@household/tokens/native'
import { screen, userEvent, within } from '@testing-library/react-native'
import { Platform } from 'react-native'
import { expectAccessible } from '../../test/a11y.ts'
import { render, styleOf } from '../../test/render.tsx'
import * as announcer from '../../ui/announce.ts'
import { devMarker } from '../marker.ts'
import { drawings, widths, type Width } from './fixtures.ts'
import DevShell from './index.tsx'

// The router's own: a row of the page leads somewhere, and no test of the page follows it.
jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false },
  useIsFocused: () => true,
}))

const en = catalogs.en
const themes = ['light', 'dark'] as const
const scales = [1, 2] as const
const rooms = Object.keys(widths) as Width[]

let said: jest.SpiedFunction<typeof announcer.announce>

beforeEach(() => {
  said = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
  jest.spyOn(announcer, 'focusOn').mockReturnValue(true)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the shell’s dev screen', () => {
  it('holds the marker no production bundle may', async () => {
    await render(<DevShell />)
    expect(screen.getByTestId(`${devMarker}:shell`)).toBeOnTheScreen()
  })

  it('draws the bar in each drawing, in both themes, at both text sizes and both widths', async () => {
    await render(<DevShell />)
    for (const drawing of drawings) {
      for (const theme of themes) {
        for (const room of rooms) {
          for (const scale of scales) {
            const id = `shell:bar:${drawing.id}:${theme}:${room}:${String(scale)}`
            const bar = screen.getByTestId(id)
            // Its own slots, in order.
            expect(
              within(bar)
                .getAllByRole(/^(tab|button)$/)
                .map((slot) => String(slot.props.testID).replace(`${id}:`, '')),
            ).toEqual(drawing.slots)
            // In its own theme, whatever the page's is.
            expect(styleOf(bar).backgroundColor).toBe(nativeThemes[theme].color['surface-raised'])
            // At its own text size, whatever the device's is.
            const home = styleOf(screen.getByTestId(`${id}:home`))
            expect(home.minHeight).toBe(44 * scale)
            // And in the layout its room gives it, counted in that text: a tablet's at twice
            // the text is a phone's.
            expect(home.flex).toBe(room === 'tablet' && scale === 1 ? undefined : 1)
          }
        }
      }
    }
  })

  it.each(scales)('draws its bars accessibly at a text scale of %i', async (scale) => {
    await render(<DevShell />)
    expectAccessible(screen.getByTestId(`shell:bars:${String(scale)}`), { scale })
  })

  it.each(scales)('draws the rest of the shell accessibly at a text scale of %i', async (scale) => {
    await render(<DevShell />, { scale })
    for (const part of [
      'shell:app-bar:light',
      'shell:app-bar:dark',
      'shell:more',
      'shell:arrange',
      'shell:arrange:tablet',
      'shell:panes:phone:one',
      'shell:panes:tablet-200:one',
      'shell:not-available',
      'switched',
    ]) {
      expectAccessible(screen.getByTestId(part), { scale: part.includes('200') ? 2 : scale })
    }
  })

  it('opens a place in every bar from a press on any of them', async () => {
    await render(<DevShell />)
    await userEvent.press(screen.getByTestId('shell:bar:five:light:phone:1:today'))
    for (const id of ['shell:bar:five:light:phone:1', 'shell:bar:three:dark:tablet:2']) {
      expect(screen.getByTestId(`${id}:today`)).toBeSelected()
      expect(screen.getByTestId(`${id}:home`)).not.toBeSelected()
    }
  })

  // Add is a sheet and no place: the bar still says which place is open.
  it('opens a sheet from Add, over the place that is open', async () => {
    await render(<DevShell />)
    expect(screen.queryByTestId('shell:add:surface')).toBeNull()
    await userEvent.press(screen.getByTestId('shell:bar:five:dark:phone:1:add'))
    expect(screen.getByTestId('shell:add:surface')).toBeOnTheScreen()
    expect(screen.getByTestId('shell:bar:five:dark:phone:1:home')).toBeSelected()
    await userEvent.press(screen.getByTestId('shell:add:close'))
    expect(screen.queryByTestId('shell:add:surface')).toBeNull()
  })

  it('carries the count of what waits on one bar’s More, and on More’s own row', async () => {
    await render(<DevShell />)
    const counted = screen.getByTestId('shell:bar:counted:light:phone:1:more')
    expect(within(counted).getByTestId('badge', { includeHiddenElements: true })).toHaveTextContent(
      '3',
    )
    expect(
      within(screen.getByTestId('shell:bar:three:light:phone:1:more')).queryByTestId('badge', {
        includeHiddenElements: true,
      }),
    ).toBeNull()
    expect(within(screen.getByTestId('shell:more')).getByTestId('more:sync')).toBeOnTheScreen()
  })

  it('lists in More what is arranged under it: one arrangement for the page', async () => {
    // Everywhere but on iOS a menu's sheet is gone as soon as it is closed, and its item acts.
    jest.replaceProperty(Platform, 'OS', 'android')
    await render(<DevShell />)
    const more = () =>
      within(screen.getByTestId('shell:more'))
        .getAllByRole('link')
        .map((row) => row.props.testID as string)
    expect(more()).toEqual([
      'more:module:tasks',
      'more:module:shopping',
      'more:module:garden',
      'more:module:admin',
      'more:arrange',
      'more:sync',
    ])
    await userEvent.press(
      within(screen.getByTestId('shell:arrange')).getByTestId('arrange:menu:tasks'),
    )
    await userEvent.press(screen.getByRole('button', { name: en['shell.arrange.hide'] }))
    expect(more()).not.toContain('more:module:tasks')
    // And in the tablet's drawing of the same lists, where the sections stand side by side.
    expect(
      within(
        within(screen.getByTestId('shell:arrange:tablet')).getByTestId('arrange:hidden'),
      ).getByTestId('arrange:row:tasks'),
    ).toBeOnTheScreen()
  })

  it('draws the panes at a phone’s width, a tablet’s, and a tablet’s at twice the text', async () => {
    await render(<DevShell />)
    expect(screen.getByTestId('shell:panes:phone:one')).toBeOnTheScreen()
    expect(screen.getByTestId('shell:panes:tablet:two')).toBeOnTheScreen()
    expect(screen.getByTestId('shell:panes:tablet-200:one')).toBeOnTheScreen()
    // Nothing is selected: only the pane that has room for a second says so.
    expect(screen.getAllByText(en['device.shell.panes.empty'])).toHaveLength(1)

    // A phone: what was opened takes the list's place, and closing it gives the list back.
    await userEvent.press(screen.getByTestId('shell:panes:phone:cellar'))
    expect(screen.queryByTestId('shell:panes:phone:cellar')).toBeNull()
    await userEvent.press(screen.getByTestId('shell:panes:phone:close'))
    expect(screen.getByTestId('shell:panes:phone:cellar')).toBeOnTheScreen()

    // A tablet: it is drawn beside the list, which stays.
    await userEvent.press(screen.getByTestId('shell:panes:tablet:garden'))
    expect(screen.getByTestId('shell:panes:tablet:close')).toBeOnTheScreen()
    expect(screen.getByTestId('shell:panes:tablet:garden')).toBeOnTheScreen()
    expect(screen.queryByText(en['device.shell.panes.empty'])).toBeNull()
  })

  it('draws the neutral screen’s words and its one way out', async () => {
    await render(<DevShell />)
    const part = within(screen.getByTestId('shell:not-available'))
    expect(part.getByText(en['ui.not_available.title'])).toBeOnTheScreen()
    expect(part.getByText(en['ui.not_available.body'])).toBeOnTheScreen()
    expect(part.getAllByRole('button')).toHaveLength(1)
  })

  it('draws the notice of a switch without saying it, and draws it again once it is put away', async () => {
    await render(<DevShell />)
    expect(screen.getByTestId('switched')).toBeOnTheScreen()
    // It was there when the page opened: nothing arrived.
    expect(said).not.toHaveBeenCalledWith(en['shell.switched.body'])
    await userEvent.press(screen.getByRole('button', { name: en['ui.dismiss'] }))
    expect(screen.queryByTestId('switched')).toBeNull()
    await userEvent.press(screen.getByTestId('shell:switched:again'))
    expect(screen.getByTestId('switched')).toBeOnTheScreen()
  })

  it('accents its fixtures under the pseudo-locale, as a catalog’s words are', async () => {
    await render(<DevShell />, { locale: 'en-XA' })
    expect(screen.getByRole('header', { name: pseudolocalize('Tab bar') })).toBeOnTheScreen()
    expect(screen.getAllByText(pseudolocalize('Tilcerovi')).length).toBeGreaterThan(0)
  })
})
