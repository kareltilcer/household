// The status section of the primitives dev screen: that it draws every status and every tone in
// both themes, passes the accessibility rules at 100 and at 200 %, and that what it draws works
// as its components do. Its words are fixtures, so a test reads it by `testID` and by the
// catalogs' own words.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { controls, statusGlyphs } from '@household/icons'
import { catalogs, pseudolocalize } from '@household/i18n'
import { act, fireEvent, screen, userEvent, within } from '@testing-library/react-native'
import type { TestInstance } from 'test-renderer'
import { expectAccessible, statusTestID } from '../../../test/a11y.ts'
import { render } from '../../../test/render.tsx'
import * as announcer from '../../../ui/announce.ts'
import { StatusSection } from './index.tsx'

const en = catalogs.en
const themes = ['light', 'dark'] as const

function part(id: string, theme: (typeof themes)[number] = 'light'): TestInstance {
  return screen.getByTestId(`status-section:${id}:${theme}`)
}

let said: jest.SpiedFunction<typeof announcer.announce>

beforeEach(() => {
  said = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
})
afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('the status section of the primitives', () => {
  it.each([1, 2])('passes the accessibility rules at a text scale of %i', async (scale) => {
    await render(<StatusSection />, { scale })
    expectAccessible()
  })

  it('draws the thirteen statuses, with their words and without, in each theme', async () => {
    await render(<StatusSection />)
    for (const theme of themes) {
      for (const status of Object.keys(statusGlyphs)) {
        // Twice among the statuses, and again wherever a part of the section marks one.
        expect(within(part('statuses', theme)).getAllByTestId(statusTestID(status))).toHaveLength(2)
      }
    }
  })

  it('draws the four tones of a banner, the refusal with its three answers, and the two bars', async () => {
    await render(<StatusSection />)
    for (const theme of themes) {
      const banners = within(part('banners', theme))
      expect(banners.getAllByTestId('banner:neutral')).toHaveLength(1)
      expect(banners.getAllByTestId('banner:warning')).toHaveLength(1)
      expect(banners.getAllByTestId('banner:info')).toHaveLength(2)
      expect(banners.getAllByTestId('banner:danger')).toHaveLength(2)
      expect(banners.getByText(en['ui.offline.bar'])).toBeOnTheScreen()
      expect(banners.getByTestId('offline-bar:not-receiving')).toBeOnTheScreen()
    }
    // What was there when the screen opened is read in its place.
    expect(said).not.toHaveBeenCalled()
  })

  it('puts away the banner that may be put away', async () => {
    await render(<StatusSection />)
    const dismiss = within(part('banners')).getByRole('button', {
      name: en[controls.dismiss.labelKey],
    })
    await userEvent.press(dismiss)
    expect(within(part('banners')).getAllByTestId('banner:info')).toHaveLength(1)
  })

  it('completes a row at once without the hold, and draws a fresh control to complete it again', async () => {
    await render(<StatusSection />)
    const hold = within(part('hold'))
    const [first] = hold.getAllByTestId('hold:idle')
    expect(hold.getAllByTestId('hold:idle')).toHaveLength(3)
    await fireEvent(first as TestInstance, 'accessibilityTap')
    expect(hold.getAllByTestId('hold:completed')).toHaveLength(1)
    expect(said.mock.calls).toEqual([[en['ui.hold.completed']]])
    // Completed stays completed: the row draws one of its own for what is to be done again.
    const [again] = hold.getAllByRole('button', { name: 'Again' })
    await userEvent.press(again as TestInstance)
    expect(hold.queryAllByTestId('hold:completed')).toEqual([])
    expect(hold.getAllByTestId('hold:idle')).toHaveLength(3)
  })

  it('says a slow completion is completing, and a refused one that it failed', async () => {
    jest.useFakeTimers()
    await render(<StatusSection />)
    const hold = within(part('hold'))
    const [, slow, refused] = hold.getAllByTestId('hold:idle')
    await fireEvent(slow as TestInstance, 'accessibilityTap')
    expect(hold.getAllByTestId('hold:completing')).toHaveLength(1)
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1500)
    })
    expect(hold.getAllByTestId('hold:completed')).toHaveLength(1)
    await fireEvent(refused as TestInstance, 'accessibilityTap')
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
    })
    expect(hold.getAllByTestId('hold:failed')).toHaveLength(1)
    expect(hold.getByText(en['ui.hold.failed'])).toBeOnTheScreen()
  })

  it('draws the not-enough-information tile beside a genuine zero, which is a figure', async () => {
    await render(<StatusSection />)
    const metric = within(part('metric'))
    expect(metric.getByText(en['ui.metric.not_enough'])).toBeOnTheScreen()
    expect(metric.getByTestId(statusTestID('no_history'))).toBeOnTheScreen()
    expect(metric.getByText('0')).toBeOnTheScreen()
    expect(metric.getAllByRole('button')).toHaveLength(1)
  })

  it('accents its fixtures under the pseudo-locale, and says the app’s own words from the catalog', async () => {
    await render(<StatusSection />, { locale: 'en-XA' })
    expect(screen.getAllByRole('header')[0]).toHaveTextContent(pseudolocalize('Status'))
    expect(
      within(part('banners')).getByText(pseudolocalize(en['ui.offline.bar'])),
    ).toBeOnTheScreen()
  })
})
