// The components that display household data (02-components §3): the list row, the key–value
// block, the money value, the metric tile, the three charts and the search result row, with the
// chip, the avatar and the badge a row carries. The web's `data.test.tsx` is its twin; the data
// table is the web's alone.
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { money } from '@household/domain'
import { controls } from '@household/icons'
import { catalogs } from '@household/i18n'
import { nativeThemes } from '@household/tokens/native'
import { fireEvent, screen, userEvent, within } from '@testing-library/react-native'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import type { TestInstance } from 'test-renderer'
import {
  drawingsOf,
  elementsOf,
  expectAccessible,
  nameOf,
  statusTestID,
  textOf,
} from '../test/a11y.ts'
import { render, root, styleOf } from '../test/render.tsx'
import { Badge } from './Badge.tsx'
import { Button } from './Button.tsx'
import { Composition, Flow, TimeSeries } from './charts/Charts.tsx'
import { Avatar, initialsOf, ModuleChip, Portrait } from './Chip.tsx'
import { KeyValue } from './KeyValue.tsx'
import { List, ListRow } from './ListRow.tsx'
import { MetricTile } from './MetricTile.tsx'
import { MoneyValue } from './MoneyValue.tsx'
import { SearchResultRow } from './SearchResultRow.tsx'

const en = catalogs.en

const words = {
  meters: 'Meters',
  electricity: 'Electricity, cellar meter',
  gas: 'Gas, hallway meter',
  read: '18 402 kWh · read 3 March by Petr',
  open: 'Open',
  petr: 'Petr Novák',
  waiting: '3 changes need your attention',
  period: 'Electricity, this period',
  more: '6 % more than last period',
  missing: 'Two readings on the same meter produce the first figure.',
  add: 'Add a reading',
  perMonth: 'kWh per month',
  storage: 'Storage by module',
  used: '4.1 GB of 10 GB',
  march: 'March, in and out',
  agree: '73 000 in · 73 000 out',
  income: 'Income',
  accounts: 'Accounts',
  document: 'Document',
  insurance: 'Insurance, house contents 2026',
  snippet: '…policy number CZ-448 201, renewal 1 June…',
  path: 'Documents / House / Insurance',
  registration: 'Registration',
  plate: '5AZ 4471',
  stk: 'Next STK',
  day: '14 May 2027',
  tyres: 'Tyres changed',
  odometer: 'Odometer',
  chassis: 'Chassis number',
  insurer: 'Insurer',
  seats: 'Seats',
  phone: 'Phone',
  picture: 'https://files.dum.test/eva.jpg',
} as const

/** The elements under `element` that a `role` names, in the order they are drawn. */
function byRole(element: TestInstance, role: string): TestInstance[] {
  return elementsOf(element).filter((inner) => inner.props.role === role)
}

/**
 * What a text draws: its pieces as they stand, one against the next, with a space that does not
 * break read as any other space is.
 */
function drawn(element: TestInstance | undefined): string {
  if (element === undefined) throw new Error('no text is drawn there')
  return element.children
    .map((child) => (typeof child === 'string' ? child : drawn(child)))
    .join('')
    .replace(/\s/g, ' ')
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a list row', () => {
  it('is an item of a named list, with its title and its secondary line', async () => {
    await render(
      <List testID="list" label={words.meters}>
        <ListRow title={words.electricity} secondary={words.read} />
      </List>,
    )
    const list = screen.getByTestId('list')
    expect(list.props).toMatchObject({ role: 'list', 'aria-label': words.meters })
    // A list is not one thing to a screen reader, which would close its rows to it.
    expect(list.props.accessible).toBeUndefined()
    const [row] = byRole(list, 'listitem')
    expect(textOf(row as TestInstance)).toBe(`${words.electricity} ${words.read}`)
    expectAccessible()
  })

  it('draws a rule between two rows, and none over the first or under the last', async () => {
    await render(
      <List testID="list" label={words.meters}>
        <ListRow title={words.electricity} />
        <ListRow title={words.gas} />
        <ListRow title={words.read} />
      </List>,
    )
    const kinds = screen
      .getByTestId('list')
      .children.map((child) => ((child as TestInstance).props.role === 'listitem' ? 'row' : 'rule'))
    expect(kinds).toEqual(['row', 'rule', 'row', 'rule', 'row'])
  })

  it('grows with its words and is held to no height: 44 pt at the least, and more at 200 %', async () => {
    await render(
      <List testID="list" label={words.meters}>
        <ListRow title={words.electricity} secondary={words.read} />
      </List>,
      { scale: 2 },
    )
    const [row] = byRole(screen.getByTestId('list'), 'listitem')
    const style = styleOf(row as TestInstance)
    expect(style).toMatchObject({ minHeight: 88, flexWrap: 'wrap' })
    expect(style.height).toBeUndefined()
    expectAccessible()
  })

  it('carries no mark while it is in sync, and the state of its own write when it is not', async () => {
    const view = await render(
      <List label={words.meters}>
        <ListRow title={words.electricity} />
      </List>,
    )
    expect(drawingsOf(root())).toEqual([])
    await view.rerender(
      <List label={words.meters}>
        <ListRow title={words.electricity} mark="pending" />
      </List>,
    )
    expect(screen.getByText(en['a11y.status.pending'])).toBeOnTheScreen()
    expectAccessible()
  })

  it('opens what a conflict is about from its mark, which names the row', async () => {
    const onOpenMark = jest.fn()
    await render(
      <List label={words.meters}>
        <ListRow title={words.electricity} mark="conflict" onOpenMark={onOpenMark} />
      </List>,
    )
    await userEvent.press(
      screen.getByRole('button', {
        name: en[controls.conflict.labelKey].replace('{name}', words.electricity),
      }),
    )
    expect(onOpenMark).toHaveBeenCalledTimes(1)
    expectAccessible()
  })

  it('has nothing to open on a row that is waiting to be sent', async () => {
    await render(
      <List label={words.meters}>
        <ListRow title={words.electricity} mark="pending" onOpenMark={() => undefined} />
      </List>,
    )
    expect(screen.getByText(en['a11y.status.pending'])).toBeOnTheScreen()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('draws at once the mark of a row that began to sync more than a moment ago', async () => {
    await render(
      <List label={words.meters}>
        <ListRow title={words.electricity} mark="syncing" syncingSince={Date.now() - 5000} />
      </List>,
    )
    expect(screen.getByTestId(statusTestID('syncing'))).toBeOnTheScreen()
  })

  it('draws its chip, its avatar and its trailing action, and none that it was not given', async () => {
    const view = await render(
      <List label={words.meters}>
        <ListRow
          title={words.electricity}
          avatar={<Avatar initials="P" tone={2} />}
          chip={<ModuleChip module="utilities" />}
          trailing={<Button variant="ghost">{words.open}</Button>}
        />
      </List>,
    )
    expect(screen.getByText(en['module.utilities.name'])).toBeOnTheScreen()
    // Decoration beside the row's words: a screen reader is not read a letter.
    expect(screen.queryByText('P')).toBeNull()
    expect(screen.getByText('P', { includeHiddenElements: true })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: words.open })).toBeOnTheScreen()
    expectAccessible()
    // A member who may not write: the action is absent, and nothing stands in for it.
    await view.rerender(
      <List label={words.meters}>
        <ListRow title={words.electricity} />
      </List>,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('a module chip, an avatar, a portrait and a badge', () => {
  it('name the module in the member’s language, in its own accent', async () => {
    for (const theme of ['light', 'dark'] as const) {
      const view = await render(<ModuleChip module="finance" />, { locale: 'cs', theme })
      const name = screen.getByText(catalogs.cs['module.finance.name'])
      const chip = name.parent as TestInstance
      const accent = nativeThemes[theme].color['accent-finance']
      // The accent is the rule's and the glyph's, never the name's ink.
      expect(styleOf(chip).borderColor).toBe(accent)
      expect(drawingsOf(chip)[0]?.props.color).toBe(accent)
      expect(StyleSheet.flatten(name.props.style as StyleProp<ViewStyle>)).toMatchObject({
        color: nativeThemes[theme].color['text-primary'],
      })
      expectAccessible()
      await view.unmount()
    }
  })

  it('say a member’s name where the avatar stands alone', async () => {
    await render(<Avatar initials="PN" tone={3} name={words.petr} />)
    const avatar = screen.getByRole('image', { name: words.petr })
    expect(textOf(avatar)).toBe('PN')
    expect(styleOf(avatar).borderColor).toBe(nativeThemes.light.color['chart-3'])
  })

  it('grow the avatar with its initials', async () => {
    await render(<Avatar initials="PN" tone={3} name={words.petr} />, { scale: 2 })
    expect(styleOf(screen.getByRole('image'))).toMatchObject({ width: 72, height: 72 })
  })

  it('take for a member’s initials the first letters of their name’s first two words', () => {
    expect(initialsOf(' jana  tilcerová nováková ')).toBe('JT')
    expect(initialsOf('')).toBe('')
  })

  it('draw a member’s picture as decoration, and their initials where its link no longer loads', async () => {
    await render(<Portrait address={words.picture} name={words.petr} tone={4} />)
    const picture = elementsOf(root()).find((element) => element.type === 'Image')
    expect(picture?.props.source).toEqual({ uri: words.picture })
    expectAccessible()
    // A picture's link is good for minutes: one that failed gives way, and is no broken image.
    await fireEvent(picture as TestInstance, 'error', { nativeEvent: { error: 'gone' } })
    expect(elementsOf(root()).some((element) => element.type === 'Image')).toBe(false)
    expect(screen.getByText('PN', { includeHiddenElements: true })).toBeOnTheScreen()
  })

  it('draw their initials where a member has no picture', async () => {
    await render(<Portrait address={null} name={words.petr} />)
    expect(elementsOf(root()).some((element) => element.type === 'Image')).toBe(false)
    expect(screen.getByText('PN', { includeHiddenElements: true })).toBeOnTheScreen()
  })

  it('draw a count as a figure, and say what it counts in its owner’s words', async () => {
    await render(<Badge count={3} label={words.waiting} />)
    const badge = screen.getByRole('text', { name: words.waiting })
    expect(textOf(badge)).toBe('3')
    // The inverse chip: its ink on its ground is a declared pair.
    expect(styleOf(badge).backgroundColor).toBe(nativeThemes.light.color['surface-inverse'])
    expectAccessible()
  })

  it('draw a large count in the member’s own grouping', async () => {
    await render(<Badge count={1240} label={words.waiting} />, { locale: 'cs' })
    expect(drawn(screen.getByText(/240/))).toBe('1 240')
  })
})

describe('a key–value block', () => {
  const pairs = [
    { key: words.registration, value: words.plate, numeric: true },
    { key: words.stk, value: words.day },
    { key: words.tyres },
    { key: words.odometer, value: null },
  ]
  const none = en['ui.kv.none']

  /** Each pair, as a screen reader reads it: one thing, its label and its value. */
  function read(): string[] {
    return elementsOf(root())
      .filter((element) => element.props.accessible === true)
      .map(textOf)
  }

  it('pairs each label with its value, read in one go', async () => {
    await render(<KeyValue pairs={pairs} />)
    expect(read().slice(0, 2)).toEqual([
      `${words.registration} ${words.plate}`,
      `${words.stk} ${words.day}`,
    ])
    // Mono for anything numeric, and the body's own face for anything else.
    const face = (value: string) =>
      StyleSheet.flatten(screen.getByText(value).props.style as StyleProp<ViewStyle>)
    expect(face(words.plate)).toMatchObject({ fontFamily: nativeThemes.light.type.num.fontFamily })
    expect(face(words.day)).toMatchObject({ fontFamily: nativeThemes.light.type.body.fontFamily })
    expectAccessible()
  })

  it('draws a value that does not exist as a dash with a word, never an empty cell', async () => {
    await render(<KeyValue pairs={pairs} />)
    const missing = screen.getAllByText(`— ${none}`)
    expect(missing).toHaveLength(2)
    // The dash is the cell's face: a screen reader is read the word.
    expect(missing.map((value): unknown => value.props.accessibilityLabel)).toEqual([none, none])
  })

  it('says the same of a value that would be drawn as nothing: an empty string, a false', async () => {
    const blank = [
      { key: words.chassis, value: '' },
      { key: words.insurer, value: false },
      { key: words.seats, value: 0, numeric: true },
    ]
    await render(<KeyValue pairs={blank} />)
    expect(read()).toEqual([
      `${words.chassis} — ${none}`,
      `${words.insurer} — ${none}`,
      // A zero is a value.
      `${words.seats} 0`,
    ])
  })

  it('draws a value that is no word as it is given', async () => {
    await render(
      <KeyValue
        pairs={[{ key: words.period, value: <MoneyValue amount={money(124000, 'CZK')} /> }]}
      />,
    )
    expect(screen.getByText(words.period)).toBeOnTheScreen()
    expect(drawn(elementsOf(root()).filter((element) => element.type === 'Text')[1])).toBe(
      'CZK 1,240.00',
    )
  })

  it('draws two pairs of one label apart, each in its place', async () => {
    const complained = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const phones = (first: string, second: string) => [
      { key: words.phone, value: first },
      { key: words.phone, value: second },
    ]
    const view = await render(<KeyValue pairs={phones('602 111 222', '603 333 444')} />)
    await view.rerender(<KeyValue pairs={phones('602 111 222', '604 555 666')} />)
    expect(read()).toEqual([`${words.phone} 602 111 222`, `${words.phone} 604 555 666`])
    // React says so, on the console, where two of a list's elements share a key.
    expect(complained).not.toHaveBeenCalled()
  })
})

describe('a money value', () => {
  /** The amount as it is drawn: one text, its pieces one against the next. */
  function amount(): string {
    return drawn(elementsOf(root()).find((element) => element.type === 'Text'))
  }

  it('sets the number and the currency apart, in the member’s locale', async () => {
    await render(<MoneyValue amount={money(124000, 'CZK')} />, { locale: 'cs' })
    expect(amount()).toBe('1 240,00 CZK')
    // The code is the amount's label, in the label's face and its quieter ink.
    expect(
      StyleSheet.flatten(screen.getByText('CZK').props.style as StyleProp<ViewStyle>),
    ).toMatchObject({
      fontFamily: nativeThemes.light.type.caption.fontFamily,
      color: nativeThemes.light.color['text-muted'],
    })
    expect(screen.queryByText(catalogs.cs['ui.money.out'])).toBeNull()
    expectAccessible()
  })

  it('tells a negative amount by its sign and by a word, and by no colour', async () => {
    await render(<MoneyValue amount={money(-34000, 'CZK')} />)
    expect(amount()).toBe('-CZK 340.00')
    expect(screen.getByText(en['ui.money.out'])).toBeOnTheScreen()
    const colours = new Set(
      elementsOf(root())
        .filter((element) => element.type === 'Text')
        .map(
          (element) =>
            (StyleSheet.flatten(element.props.style as StyleProp<ViewStyle>) as { color?: string })
              .color,
        ),
    )
    const { color } = nativeThemes.light
    expect([...colours].sort()).toEqual([color['text-muted'], color['text-primary']].sort())
  })

  it('says what was paid in its own currency, at which stored rate, of which day', async () => {
    await render(
      <MoneyValue
        amount={money(124000, 'CZK')}
        conversion={{ original: money(4860, 'EUR'), rate: '25.5200', day: '2026-03-02' }}
      />,
    )
    expect(screen.getByText('EUR 48.60 at a rate of 25.52, stored 3/2/26')).toBeOnTheScreen()
  })

  it('shows the stored rate with every digit it has, however small it is', async () => {
    await render(
      <MoneyValue
        amount={money(36500, 'EUR')}
        conversion={{ original: money(10000000, 'VND'), rate: '0.0000365', day: '2026-03-02' }}
      />,
    )
    expect(
      screen.getByText('VND 10,000,000 at a rate of 0.0000365, stored 3/2/26'),
    ).toBeOnTheScreen()
  })

  it('draws a zero as a zero, with no word, and the figure a screen is about in the larger step', async () => {
    await render(<MoneyValue amount={money(0, 'EUR')} large />)
    expect(amount()).toBe('EUR 0.00')
    expect(screen.queryByText(en['ui.money.out'])).toBeNull()
    const figure = elementsOf(root()).find((element) => element.type === 'Text')
    expect(StyleSheet.flatten(figure?.props.style as StyleProp<ViewStyle>)).toMatchObject({
      fontSize: nativeThemes.light.type['num-lg'].fontSize,
    })
  })
})

describe('a metric tile', () => {
  const notEnough = en['ui.metric.not_enough']

  it('shows its label, its figure with its unit, and its trend in words', async () => {
    await render(
      <MetricTile
        label={words.period}
        value="412"
        unit="kWh"
        trend={{ direction: 'up', text: words.more }}
      />,
    )
    expect(screen.getByText(words.period)).toBeOnTheScreen()
    expect(screen.getByText('412')).toBeOnTheScreen()
    expect(screen.getByText('kWh')).toBeOnTheScreen()
    expect(screen.getByText(words.more)).toBeOnTheScreen()
    // The arrow repeats the words, and says nothing alone.
    expect(drawingsOf(root())).toHaveLength(1)
    expectAccessible()
  })

  it('draws no arrow for a figure that did not move', async () => {
    await render(
      <MetricTile
        label={words.period}
        value="412"
        trend={{ direction: 'flat', text: words.more }}
      />,
    )
    expect(screen.getByText(words.more)).toBeOnTheScreen()
    expect(drawingsOf(root())).toEqual([])
  })

  it('says there is not enough information, and what is missing, where it has no figure', async () => {
    await render(<MetricTile label={words.period} missing={words.missing} />)
    // The no-history status, said three ways: its colour, its glyph and the tile's words for it.
    const status = screen.getByTestId(statusTestID('no_history'))
    expect(within(status).getByText(notEnough)).toBeOnTheScreen()
    expect(drawingsOf(status)[0]?.props.color).toBe(nativeThemes.light.color['status-no-history'])
    expect(screen.getByText(words.missing)).toBeOnTheScreen()
    // Not a zero: a figure the product has not earned is not shown at all.
    expect(screen.queryByText('0')).toBeNull()
    expectAccessible()
  })

  it('shows a genuine zero as a figure', async () => {
    await render(<MetricTile label={words.period} value="0" />)
    expect(screen.getByText('0')).toBeOnTheScreen()
    expect(screen.queryByText(notEnough)).toBeNull()
  })

  it('offers the one action that supplies what is missing, under what is missing', async () => {
    const onAdd = jest.fn()
    await render(
      <MetricTile
        label={words.period}
        missing={words.missing}
        action={<Button onPress={onAdd}>{words.add}</Button>}
      />,
    )
    const action = screen.getByRole('button', { name: words.add })
    // After the sentence that names what it supplies, in the order they are read.
    const order = elementsOf(root())
    expect(order.indexOf(action)).toBeGreaterThan(order.indexOf(screen.getByText(words.missing)))
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await userEvent.press(action)
    expect(onAdd).toHaveBeenCalledTimes(1)
    expectAccessible()
  })

  it('draws no action beside a figure, which is missing nothing', async () => {
    await render(
      <MetricTile
        label={words.period}
        value="0"
        unit="kWh"
        action={<Button>{words.add}</Button>}
      />,
    )
    expect(screen.getByText('0')).toBeOnTheScreen()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('draws nothing where an action would be for a member who is given none', async () => {
    await render(<MetricTile label={words.period} missing={words.missing} action={false} />)
    expect(screen.queryByRole('button')).toBeNull()
    // No empty box under the sentence: an action that is absent leaves no trace.
    const said = screen.getByText(words.period).parent
    expect(said?.parent?.children).toEqual([said])
  })
})

describe('a time series', () => {
  const points = [
    { label: 'Jan', value: 88, text: '88 kWh' },
    { label: 'Feb', value: 79, text: '79 kWh', estimated: true },
    { label: 'Mar', value: 44, text: '44 kWh' },
  ]
  const flat = [{ label: 'Jan', value: 0, text: '0 kWh' }]

  function said(): string[] {
    return byRole(screen.getByTestId('chart:series'), 'listitem').map(nameOf)
  }

  /** Each point's column, by its height, and null where the point has none. */
  function columns(): (string | number | null)[] {
    return byRole(screen.getByTestId('chart:series'), 'listitem').map((point) => {
      const column = elementsOf(point).find((inner) =>
        String(inner.props.testID).startsWith('chart:column'),
      )
      return column === undefined ? null : (styleOf(column).height as string)
    })
  }

  it('says every point in words, and an estimated one as estimated', async () => {
    await render(<TimeSeries caption={words.perMonth} points={points} />)
    expect(said()).toEqual(['Jan: 88 kWh', 'Feb: 79 kWh, estimated', 'Mar: 44 kWh'])
    // One thing each to a screen reader: its column and its tick only draw it.
    expect(
      byRole(screen.getByTestId('chart:series'), 'listitem').map(
        (point): unknown => point.props.accessible,
      ),
    ).toEqual([true, true, true])
    expect(screen.getByText(words.perMonth)).toBeOnTheScreen()
    expectAccessible()
  })

  it('draws each column against the tallest, and an estimated one in a style of its own', async () => {
    await render(<TimeSeries caption={words.perMonth} points={points} />)
    expect(columns()).toEqual(['100%', '89.77272727272727%', '50%'])
    const [measured, estimated] = screen.getAllByTestId(/^chart:column/)
    const series = nativeThemes.light.color['chart-1']
    expect(styleOf(measured as TestInstance)).toMatchObject({ backgroundColor: series })
    // An outline with nothing in it: a shape a measured point never has.
    const outline = styleOf(estimated as TestInstance)
    expect(outline).toMatchObject({ borderStyle: 'dashed', borderColor: series })
    expect(outline.backgroundColor).toBeUndefined()
  })

  it('names the estimated style and the approximate aggregate beside the caption', async () => {
    const view = await render(<TimeSeries caption={words.perMonth} points={points} approximate />)
    expect(screen.getByTestId(statusTestID('estimated'))).toBeOnTheScreen()
    expect(screen.getByText(en['ui.chart.approximate'])).toBeOnTheScreen()
    await view.rerender(<TimeSeries caption={words.perMonth} points={points.slice(0, 1)} />)
    expect(screen.queryByTestId(statusTestID('estimated'))).toBeNull()
    expect(screen.queryByText(en['ui.chart.approximate'])).toBeNull()
  })

  it('draws a year by its months’ letters, three of which are J, each column in its place', async () => {
    const complained = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const letters = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
    const year = (first: number) =>
      letters.map((label, month) => ({
        label,
        value: first + month,
        text: `${String(first + month)} kWh`,
      }))
    const view = await render(<TimeSeries caption={words.perMonth} points={year(1)} />)
    // The next year's figures, under the same letters.
    await view.rerender(<TimeSeries caption={words.perMonth} points={year(20)} />)
    expect(said()).toEqual(year(20).map((point) => `${point.label}: ${point.text}`))
    // React says so, on the console, where two of a list's elements share a key.
    expect(complained).not.toHaveBeenCalled()
  })

  it('draws no column where every point is zero, and divides by nothing', async () => {
    await render(<TimeSeries caption={words.perMonth} points={flat} />)
    // No column, and not one of no height: every column is given a height that can be seen, so
    // that a small reading is not lost beside a large one.
    expect(columns()).toEqual([null])
    expect(said()).toEqual(['Jan: 0 kWh'])
  })

  it('draws a point at or under zero as no column, estimated or not, and says its value', async () => {
    const under = [
      { label: 'Jan', value: 40, text: '40 kWh' },
      { label: 'Feb', value: -10, text: '−10 kWh' },
      { label: 'Mar', value: 0, text: '0 kWh', estimated: true },
    ]
    await render(<TimeSeries caption={words.perMonth} points={under} />)
    expect(columns()).toEqual(['100%', null, null])
    expect(said()).toEqual(['Jan: 40 kWh', 'Feb: −10 kWh', 'Mar: 0 kWh, estimated'])
  })

  it('keeps its plot the height of a picture, and lets its words grow, at 200 % text', async () => {
    await render(<TimeSeries caption={words.perMonth} points={points} />, { scale: 2 })
    const [point] = byRole(screen.getByTestId('chart:series'), 'listitem')
    const plot = (point as TestInstance).children[0] as TestInstance
    expect(styleOf(plot).height).toBe(80)
    expect(
      StyleSheet.flatten(
        screen.getByText('Jan', { includeHiddenElements: true }).props
          .style as StyleProp<ViewStyle>,
      ),
    ).toMatchObject({ fontSize: 26 })
    expectAccessible()
  })
})

describe('a composition', () => {
  const segments = [
    { label: 'Documents', share: 0.44, text: '1.8 GB' },
    { label: 'Chat', share: 0.24, text: '980 MB' },
    { label: 'Overhead (derived)', share: 0.32, text: '1.3 GB' },
  ]

  function legend(): string[] {
    return byRole(screen.getByTestId('chart:composition'), 'listitem').map(textOf)
  }

  function bar(): TestInstance[] {
    return screen
      .getByTestId('chart:whole', { includeHiddenElements: true })
      .children.map((part) => part as TestInstance)
  }

  it('names every segment in its legend, with its figure and its share, in the bar’s order', async () => {
    await render(<Composition caption={words.storage} segments={segments} total={words.used} />)
    expect(legend()).toEqual([
      'Documents 1.8 GB 44%',
      'Chat 980 MB 24%',
      'Overhead (derived) 1.3 GB 32%',
    ])
    expect(screen.getByText(words.used)).toBeOnTheScreen()
    expectAccessible()
  })

  it('draws the bar from the shares, as decoration the legend explains', async () => {
    await render(<Composition caption={words.storage} segments={segments} total={words.used} />)
    expect(bar().map((part) => styleOf(part).width)).toEqual(['44%', '24%', '32%'])
    expect(screen.queryByTestId('chart:whole')).toBeNull()
  })

  it('draws no part of the bar for a segment that is none of the whole, and lists it all the same', async () => {
    const some = [
      { label: 'Documents', share: 0.68, text: '1.8 GB' },
      { label: 'Chat', share: 0, text: '0 MB' },
      { label: 'Overhead (derived)', share: 0.32, text: '1.3 GB' },
    ]
    await render(<Composition caption={words.storage} segments={some} total={words.used} />)
    expect(bar().map((part) => styleOf(part).width)).toEqual(['68%', '32%'])
    // A segment keeps the colour of its place in the legend, whatever is not drawn before it.
    const { color } = nativeThemes.light
    expect(bar().map((part) => styleOf(part).backgroundColor)).toEqual([
      color['chart-1'],
      color['chart-3'],
    ])
    expect(legend()).toEqual([
      'Documents 1.8 GB 68%',
      'Chat 0 MB 0%',
      'Overhead (derived) 1.3 GB 32%',
    ])
  })
})

describe('a flow', () => {
  const sources = [
    { label: 'Jana, salary', text: '42 000' },
    { label: 'Petr, salary', text: '31 000' },
  ]
  const targets = [
    { label: 'Household account', text: '48 000' },
    { label: 'Savings', text: '25 000' },
  ]
  const flow = (
    <Flow
      caption={words.march}
      total={words.agree}
      sourcesLabel={words.income}
      sources={sources}
      targetsLabel={words.accounts}
      targets={targets}
    />
  )

  it('lists what comes in and where it goes, each with its figure, and how they agree', async () => {
    await render(flow)
    const [incoming, outgoing] = byRole(screen.getByTestId('chart:flow'), 'list')
    expect(byRole(incoming as TestInstance, 'listitem').map(textOf)).toEqual([
      'Jana, salary 42 000',
      'Petr, salary 31 000',
    ])
    expect(byRole(outgoing as TestInstance, 'listitem').map(textOf)).toEqual([
      'Household account 48 000',
      'Savings 25 000',
    ])
    expect(incoming?.props['aria-label']).toBe(words.income)
    expect(outgoing?.props['aria-label']).toBe(words.accounts)
    expect(screen.getByText(words.income)).toBeOnTheScreen()
    expect(screen.getByText(words.accounts)).toBeOnTheScreen()
    expect(screen.getByText(words.agree)).toBeOnTheScreen()
    expectAccessible()
  })

  it('stands one side under the other on a phone, and beside it where there is the room', async () => {
    await render(flow)
    const sides = () => styleOf(screen.getByTestId('chart:flow:sides')).flexDirection
    // Before it has been laid out it is drawn as a phone draws it.
    expect(sides()).toBe('column')
    const laid = (width: number) => ({
      nativeEvent: { layout: { x: 0, y: 0, width, height: 300 } },
    })
    await fireEvent(screen.getByTestId('chart:flow'), 'layout', laid(358))
    expect(sides()).toBe('column')
    await fireEvent(screen.getByTestId('chart:flow'), 'layout', laid(448))
    expect(sides()).toBe('row')
  })

  it('counts its room in the reader’s text size: beside each other takes twice the room at 200 %', async () => {
    await render(flow, { scale: 2 })
    const sides = () => styleOf(screen.getByTestId('chart:flow:sides')).flexDirection
    const laid = (width: number) => ({
      nativeEvent: { layout: { x: 0, y: 0, width, height: 300 } },
    })
    await fireEvent(screen.getByTestId('chart:flow'), 'layout', laid(600))
    expect(sides()).toBe('column')
    await fireEvent(screen.getByTestId('chart:flow'), 'layout', laid(896))
    expect(sides()).toBe('row')
    expectAccessible()
  })

  it('lists two of one name apart, as it lists two segments of one name', async () => {
    const complained = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const twice = [
      { label: 'Savings', text: '15 000' },
      { label: 'Savings', text: '10 000' },
    ]
    await render(
      <>
        <Flow
          caption={words.march}
          total={words.agree}
          sourcesLabel={words.income}
          sources={sources}
          targetsLabel={words.accounts}
          targets={twice}
        />
        <Composition
          caption={words.storage}
          total={words.used}
          segments={twice.map((node) => ({ ...node, share: 0.5 }))}
        />
      </>,
    )
    expect(screen.getAllByText('Savings')).toHaveLength(4)
    expect(complained).not.toHaveBeenCalled()
  })
})

describe('a search result row', () => {
  const result = {
    module: 'documents',
    entityType: words.document,
    title: words.insurance,
    // As the contract's SearchHit carries it: an instant, late on the 4th in UTC.
    updatedAt: '2026-03-04T23:30:00Z',
    timeZone: 'Europe/Prague',
  } as const

  it('shows the module, the kind of thing, the title, the snippet, the path and the day', async () => {
    await render(<SearchResultRow {...result} snippet={words.snippet} path={words.path} />)
    expect(screen.getByText(en['module.documents.name'])).toBeOnTheScreen()
    expect(screen.getByText(words.document)).toBeOnTheScreen()
    expect(screen.getByText(words.insurance)).toBeOnTheScreen()
    expect(screen.getByText(words.snippet)).toBeOnTheScreen()
    expect(screen.getByText(words.path)).toBeOnTheScreen()
    // The day it was in the household's zone, where it was already the 5th.
    expect(screen.getByText('Updated Mar 5, 2026')).toBeOnTheScreen()
    // One result is one thing to a screen reader.
    expect(screen.getByTestId('search-result').props.accessible).toBe(true)
    expectAccessible()
  })

  it('tells the day in the zone it is given, and assumes none', async () => {
    await render(<SearchResultRow {...result} timeZone="America/New_York" />)
    expect(screen.getByText('Updated Mar 4, 2026')).toBeOnTheScreen()
  })

  it.each([null, undefined])('reads as a result with no snippet and no path: %s', async (none) => {
    await render(<SearchResultRow {...result} snippet={none} path={none} />)
    expect(screen.getByText(words.insurance)).toBeOnTheScreen()
    expect(screen.queryByText(words.snippet)).toBeNull()
    expect(screen.queryByText(words.path)).toBeNull()
    // Three lines, and none of them empty.
    const lines = screen
      .getByTestId('search-result')
      .children.map((line) => textOf(line as TestInstance))
    expect(lines).toHaveLength(3)
    expect(lines.every((line) => line !== '')).toBe(true)
  })

  it('says the day in the member’s language', async () => {
    await render(<SearchResultRow {...result} />, { locale: 'de' })
    expect(screen.getByText('Geändert am 05.03.2026')).toBeOnTheScreen()
  })
})
