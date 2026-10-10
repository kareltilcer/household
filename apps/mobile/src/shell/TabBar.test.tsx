// The tab bar as a member meets it (F-11, F-12): which slots a bar holds is tabs.ts's and has a
// test of its own; this holds what each of them is drawn and said as, at five, four and three.
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { catalogs, createTranslator } from '@household/i18n'
import { nativeThemes } from '@household/tokens/native'
import { fireEvent, screen, userEvent, within } from '@testing-library/react-native'
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import type { TestInstance } from 'test-renderer'
import { elementsOf, expectAccessible } from '../test/a11y.ts'
import { render } from '../test/render.tsx'
import { TabBar, type TabBarProps } from './TabBar.tsx'
import type { Destination } from './tabs.ts'

const en = catalogs.en
const labels: Readonly<Record<Destination, string>> = {
  home: en['nav.home'],
  today: en['nav.today'],
  add: en['nav.add'],
  chat: en['module.chat.name'],
  more: en['device.nav.more'],
}

const five: readonly Destination[] = ['home', 'today', 'add', 'chat', 'more']
const four: readonly Destination[] = ['home', 'today', 'add', 'more']
const three: readonly Destination[] = ['home', 'today', 'more']

/** A phone held upright, and a tablet. */
const phone = 390
const tablet = 834

function bar(over: Partial<TabBarProps> = {}) {
  return (
    <TabBar
      slots={five}
      open="home"
      onOpen={() => undefined}
      onAdd={() => undefined}
      width={phone}
      {...over}
    />
  )
}

function styleOf(element: TestInstance): ViewStyle {
  const style: unknown = element.props.style
  return StyleSheet.flatten(
    (typeof style === 'function'
      ? (style as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : style) as StyleProp<ViewStyle>,
  )
}

const slot = (destination: Destination) => screen.getByTestId(`tab-bar:${destination}`)
/** What holds the slots: the list of tabs itself. */
const tabs = () => screen.getByTestId('tab-bar:tabs')

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the tab bar', () => {
  it.each([
    ['five', five],
    ['four', four],
    ['three', three],
  ])('draws %s slots in order, each a glyph and its word', async (_, slots) => {
    await render(bar({ slots }))
    const drawn = within(screen.getByTestId('tab-bar')).getAllByRole(/^(tab|button)$/)
    expect(drawn.map((each) => each.props.accessibilityLabel as string)).toEqual(
      slots.map((each) => labels[each]),
    )
    for (const each of slots) {
      // The word is drawn, and a glyph beside it: never one without the other.
      expect(within(slot(each)).getByText(labels[each])).toBeOnTheScreen()
      expect(elementsOf(slot(each)).some((inner) => inner.type === 'RNSVGSvgView')).toBe(true)
    }
    expectAccessible()
  })

  it('shares the width between its slots, none stretched and none left empty', async () => {
    for (const slots of [five, four, three]) {
      const view = await render(bar({ slots }))
      for (const each of slots) expect(styleOf(slot(each))).toMatchObject({ flex: 1 })
      await view.unmount()
    }
  })

  it('is a list of tabs under the household’s name for it, and Add a button among them', async () => {
    await render(bar())
    // iOS has a trait for a tab bar, under which it counts the tabs itself.
    expect(tabs().props).toMatchObject({
      accessibilityRole: 'tabbar',
      accessibilityLabel: en['shell.navigation'],
    })
    // It holds the tabs, and is not one thing itself: that would close them to a screen reader.
    expect(tabs().props.accessible).toBeUndefined()
    for (const place of ['home', 'today', 'chat', 'more'] as const) {
      expect(screen.getByRole('tab', { name: labels[place] })).toBe(slot(place))
    }
    expect(screen.getByRole('button', { name: labels.add })).toBe(slot('add'))
    expect(screen.queryByRole('tab', { name: labels.add })).toBeNull()
  })

  it('is a tablist where the platform has a word for one', async () => {
    jest.replaceProperty(Platform, 'OS', 'android')
    await render(bar())
    expect(tabs().props).toMatchObject({
      accessibilityRole: 'tablist',
      accessibilityLabel: en['shell.navigation'],
    })
  })

  it('says which slot is open, and draws it by more than a colour', async () => {
    await render(bar({ open: 'today' }))
    expect(screen.getByRole('tab', { name: labels.today, selected: true })).toBe(slot('today'))
    expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1)
    // A rule above it, and its word in a heavier weight: the others have neither.
    const accent = nativeThemes.light.color.accent
    expect(styleOf(slot('today'))).toMatchObject({ borderTopWidth: 2, borderTopColor: accent })
    expect(styleOf(slot('home')).borderTopColor).not.toBe(accent)
    const family = (place: Destination) =>
      StyleSheet.flatten(within(slot(place)).getByText(labels[place]).props.style as never)
    expect(family('today')).toMatchObject({ fontFamily: 'IBMPlexSans-SemiBold' })
    expect(family('home')).toMatchObject({ fontFamily: 'IBMPlexSans-Regular' })
  })

  it('says none is open where what is on screen stands under none of them', async () => {
    await render(bar({ open: null }))
    expect(screen.queryAllByRole('tab', { selected: true })).toHaveLength(0)
    expect(screen.getAllByRole('tab', { selected: false })).toHaveLength(4)
  })

  it('opens the place whose slot is pressed', async () => {
    const onOpen = jest.fn()
    const onAdd = jest.fn()
    await render(bar({ onOpen, onAdd }))
    for (const place of ['more', 'today', 'chat', 'home'] as const) {
      await userEvent.press(screen.getByRole('tab', { name: labels[place] }))
    }
    expect(onOpen.mock.calls).toEqual([['more'], ['today'], ['chat'], ['home']])
    expect(onAdd).not.toHaveBeenCalled()
  })

  // Add is a sheet, not a route: pressing it never changes which place is open.
  it('opens the Add sheet from Add, and no place', async () => {
    const onOpen = jest.fn()
    const onAdd = jest.fn()
    await render(bar({ onOpen, onAdd }))
    await userEvent.press(screen.getByRole('button', { name: labels.add }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('carries the count of what waits on More, in words and as a figure', async () => {
    await render(bar({ waiting: 3 }))
    const attention = createTranslator('en')('shell.sidebar.attention', { count: 3 })
    // The slot's name holds its word first, and then what the number counts.
    expect(screen.getByRole('tab', { name: `${labels.more}, ${attention}` })).toBe(slot('more'))
    const badge = within(slot('more')).getByTestId('badge', { includeHiddenElements: true })
    expect(badge).toHaveTextContent('3')
    // The figure is the slot's own to say, once.
    expect(within(slot('more')).queryByTestId('badge')).toBeNull()
    expectAccessible()
  })

  it('carries no figure while nothing waits', async () => {
    await render(bar())
    expect(screen.queryByTestId('badge', { includeHiddenElements: true })).toBeNull()
    expect(screen.getByRole('tab', { name: labels.more })).toBe(slot('more'))
  })

  it.each([1, 2])(
    'gives each slot 44 pt at the least, grown with the text (× %i)',
    async (scale) => {
      await render(bar(), { scale })
      for (const each of five) expect(styleOf(slot(each)).minHeight).toBe(44 * scale)
      expectAccessible()
    },
  )

  // German is the longest: a label that does not fit its share wraps, and is never cut.
  it('survives the longest words at twice the text, with every label whole', async () => {
    await render(bar(), { scale: 2, locale: 'de' })
    for (const each of five) {
      const de = { ...labels, home: catalogs.de['nav.home'], add: catalogs.de['nav.add'] }
      if (each === 'home' || each === 'add') {
        expect(within(slot(each)).getByText(de[each])).toBeOnTheScreen()
      }
    }
    expectAccessible()
  })

  it('tells its owner how high the slots stand, which a toast is drawn above', async () => {
    const onHeight = jest.fn()
    await render(bar({ onHeight }))
    await fireEvent(tabs(), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: phone, height: 61 } },
    })
    expect(onHeight).toHaveBeenCalledWith(61)
  })

  it('keeps clear of the device’s own foot and sides, where it is told of them', async () => {
    await render(bar({ insets: { bottom: 34, left: 0, right: 44 } }))
    expect(styleOf(screen.getByTestId('tab-bar'))).toMatchObject({
      paddingBottom: 34,
      paddingRight: 44,
    })
  })
})

describe('the tab bar on a tablet', () => {
  it('is a layout of its own: slots as wide as their words, each glyph beside its word', async () => {
    await render(bar({ width: tablet }))
    for (const each of five) {
      const style = styleOf(slot(each))
      expect(style).toMatchObject({ flexDirection: 'row', minWidth: 144, minHeight: 44 })
      // Not a phone's five shares stretched over a tablet's width.
      expect(style.flex).toBeUndefined()
    }
    expect(styleOf(tabs())).toMatchObject({ justifyContent: 'center' })
    expectAccessible()
  })

  // The room is counted in the reader's text: twice the text halves it.
  it('is the phone’s at twice the text', async () => {
    await render(bar({ width: tablet }), { scale: 2 })
    for (const each of five) expect(styleOf(slot(each))).toMatchObject({ flex: 1 })
    expectAccessible()
  })

  it('begins at 744 pt of room', async () => {
    const view = await render(bar({ width: 743 }))
    expect(styleOf(slot('home')).flex).toBe(1)
    await view.unmount()
    await render(bar({ width: 744 }))
    expect(styleOf(slot('home')).flex).toBeUndefined()
  })
})
