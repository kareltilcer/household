// The components that display household data (02-components §3): the list row, the data table,
// the key–value block, the money value, the metric tile, the three charts and the search result
// row, with the chip and the avatar a row carries.
import { money } from '@household/domain'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { storageKey } from '../display/modes.ts'
import { draw } from '../test/render.tsx'
import { Button } from './Button.tsx'
import { Composition, Flow, TimeSeries } from './charts/Charts.tsx'
import { Avatar, ModuleChip } from './Chip.tsx'
import { DataTable, type Column, type Sort } from './DataTable.tsx'
import { KeyValue } from './KeyValue.tsx'
import { List, ListRow } from './ListRow.tsx'
import { MetricTile } from './MetricTile.tsx'
import { MoneyValue } from './MoneyValue.tsx'
import { SearchResultRow } from './SearchResultRow.tsx'
import type { SyncState } from './StatusMark.tsx'

const words = {
  meters: 'Meters',
  electricity: 'Electricity, cellar meter',
  read: '18 402 kWh · read 3 March by Petr',
  open: 'Open',
  ledger: 'Ledger, March',
  petr: 'Petr Novák',
  period: 'Electricity, this period',
  more: '6 % more than last period',
  missing: 'Two readings on the same meter produce the first figure.',
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
} as const

describe('a list row', () => {
  it('is an item of a named list, with its title and its secondary line', () => {
    draw(
      <List label={words.meters}>
        <ListRow title={words.electricity} secondary={words.read} />
      </List>,
    )
    const list = screen.getByRole('list', { name: words.meters })
    expect(within(list).getByRole('listitem')).toHaveTextContent(words.electricity)
    expect(screen.getByText(words.read)).toBeVisible()
  })

  it('carries no mark while it is in sync, and the state of its own write when it is not', () => {
    const { container, rerender } = draw(
      <List label={words.meters}>
        <ListRow title={words.electricity} />
      </List>,
    )
    expect(container.querySelector('[data-status]')).toBeNull()
    rerender(
      <List label={words.meters}>
        <ListRow title={words.electricity} mark="pending" />
      </List>,
    )
    expect(screen.getByText('Not sent yet')).toBeVisible()
  })

  it('opens what a conflict is about from its mark, which names the row', async () => {
    const onOpenMark = vi.fn()
    draw(
      <List label={words.meters}>
        <ListRow title={words.electricity} mark="conflict" onOpenMark={onOpenMark} />
      </List>,
    )
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Two versions of Electricity, cellar meter. Open to resolve',
      }),
    )
    expect(onOpenMark).toHaveBeenCalledTimes(1)
  })

  it('has nothing to open on a row that is waiting to be sent, as a table’s row has not', () => {
    draw(
      <List label={words.meters}>
        <ListRow title={words.electricity} mark="pending" onOpenMark={() => undefined} />
      </List>,
    )
    expect(screen.getByText('Not sent yet')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('draws at once the mark of a row that began to sync more than a moment ago', () => {
    const { container } = draw(
      <List label={words.meters}>
        <ListRow title={words.electricity} mark="syncing" syncingSince={Date.now() - 5000} />
      </List>,
    )
    expect(container.querySelector('[data-status="syncing"]')).not.toBeNull()
  })

  it('draws its chip, its avatar and its trailing action, and none that it was not given', () => {
    const { rerender } = draw(
      <List label={words.meters}>
        <ListRow
          title={words.electricity}
          avatar={<Avatar initials="P" tone={2} />}
          chip={<ModuleChip module="utilities" />}
          trailing={<Button variant="ghost">{words.open}</Button>}
        />
      </List>,
    )
    expect(screen.getByText('Utilities')).toBeVisible()
    expect(screen.getByText('P')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: words.open })).toBeVisible()
    // A member who may not write: the action is absent, and nothing stands in for it.
    rerender(
      <List label={words.meters}>
        <ListRow title={words.electricity} />
      </List>,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('a module chip and an avatar', () => {
  it('name the module in the member’s language, in its own accent', () => {
    const { container } = draw(<ModuleChip module="finance" />, 'cs')
    expect(screen.getByText('Finance')).toBeVisible()
    expect(container.firstElementChild).toHaveStyle({ '--chip-accent': 'var(--accent-finance)' })
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('say a member’s name where the avatar stands alone', () => {
    draw(<Avatar initials="PN" tone={3} name={words.petr} />)
    expect(screen.getByRole('img', { name: words.petr })).toHaveTextContent('PN')
  })
})

interface Row {
  readonly id: string
  readonly description: string
  readonly amountMinor: number
}

const rows: readonly Row[] = [
  { id: 'a', description: 'Lidl, weekly shop', amountMinor: -148200 },
  { id: 'b', description: 'Settle-up from Petr', amountMinor: 200000 },
]

const columns: readonly Column<Row>[] = [
  { id: 'description', header: 'Description', cell: (row) => row.description },
  {
    id: 'amount',
    header: 'Amount',
    numeric: true,
    sortable: true,
    cell: (row) => String(row.amountMinor),
  },
]

function Ledger({
  onMore,
  mark,
  onOpenMark,
  syncingSince,
}: {
  onMore?: () => void
  mark?: (row: Row) => SyncState | undefined
  onOpenMark?: (row: Row) => void
  syncingSince?: (row: Row) => number | undefined
}) {
  const [sort, setSort] = useState<Sort | undefined>(undefined)
  return (
    <DataTable
      caption={words.ledger}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      onSort={setSort}
      {...(sort === undefined ? {} : { sort })}
      {...(onMore === undefined ? {} : { onMore })}
      {...(mark === undefined ? {} : { mark })}
      {...(onOpenMark === undefined ? {} : { onOpenMark, rowName: (row: Row) => row.description })}
      {...(syncingSince === undefined ? {} : { syncingSince })}
    />
  )
}

describe('a data table', () => {
  it('is a named table inside a named region the keyboard can reach and scroll', () => {
    draw(<Ledger />)
    const region = screen.getByRole('region', { name: words.ledger })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(within(region).getByRole('table', { name: words.ledger })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('sets its numeric columns apart, head and cells', () => {
    draw(<Ledger />)
    expect(screen.getByRole('columnheader', { name: 'Amount' }).className).toContain('numeric')
    expect(screen.getByRole('cell', { name: '-148200' }).className).toContain('numeric')
    expect(screen.getByRole('cell', { name: 'Lidl, weekly shop' }).className).not.toContain(
      'numeric',
    )
  })

  it('sorts from a column’s head, which says which way, and turns on a second press', async () => {
    draw(<Ledger />)
    const head = screen.getByRole('columnheader', { name: 'Amount' })
    expect(head).not.toHaveAttribute('aria-sort')
    await userEvent.click(within(head).getByRole('button', { name: 'Amount' }))
    expect(head).toHaveAttribute('aria-sort', 'ascending')
    await userEvent.click(within(head).getByRole('button'))
    expect(head).toHaveAttribute('aria-sort', 'descending')
    // A column that does not sort has no control.
    expect(
      within(screen.getByRole('columnheader', { name: 'Description' })).queryByRole('button'),
    ).not.toBeInTheDocument()
  })

  it('has a column for the rows’ sync state only while a row is not in sync', () => {
    const { rerender } = draw(<Ledger />)
    expect(screen.getAllByRole('columnheader')).toHaveLength(2)
    rerender(<Ledger mark={(row) => (row.id === 'a' ? 'pending' : undefined)} />)
    expect(screen.getByRole('columnheader', { name: 'Sync state' })).toBeInTheDocument()
    expect(screen.getAllByText('Not sent yet')).toHaveLength(1)
  })

  it('draws at once the mark of a row that began to sync more than a moment ago', () => {
    draw(
      <Ledger
        mark={(row) => (row.id === 'a' ? 'syncing' : undefined)}
        syncingSince={() => Date.now() - 5000}
      />,
    )
    expect(screen.getAllByText('Sending')).toHaveLength(1)
  })

  it('opens what a row’s conflict or rejection is about from its mark, which names the row', async () => {
    const onOpenMark = vi.fn()
    const { rerender } = draw(
      <Ledger mark={(row) => (row.id === 'a' ? 'conflict' : 'rejected')} onOpenMark={onOpenMark} />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Two versions of Lidl, weekly shop. Open to resolve' }),
    )
    expect(onOpenMark).toHaveBeenCalledExactlyOnceWith(rows[0])
    await userEvent.click(screen.getByRole('button', { name: 'Not accepted. Open for details' }))
    expect(onOpenMark).toHaveBeenLastCalledWith(rows[1])

    // A row that is waiting to be sent has nothing to open, and one given no way to open is words.
    rerender(<Ledger mark={() => 'pending'} onOpenMark={onOpenMark} />)
    expect(screen.getAllByText('Not sent yet')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Open/ })).not.toBeInTheDocument()
    rerender(<Ledger mark={() => 'conflict'} />)
    expect(screen.getAllByText('Two versions')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Open/ })).not.toBeInTheDocument()
  })

  it('asks for the rows after the last by a control, and has none where there are none', async () => {
    const onMore = vi.fn()
    const { rerender } = draw(<Ledger />)
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
    rerender(<Ledger onMore={onMore} />)
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(onMore).toHaveBeenCalledTimes(1)
  })

  it('is compact by itself, and follows the member’s own density when they chose one', () => {
    const { unmount } = draw(<Ledger />)
    expect(screen.getByRole('region', { name: words.ledger })).toHaveAttribute(
      'data-density',
      'compact',
    )
    unmount()
    // The choice is on the root, where the stylesheet reads it for the table too.
    window.localStorage.setItem(storageKey, JSON.stringify({ density: 'comfortable' }))
    draw(<Ledger />)
    expect(screen.getByRole('region', { name: words.ledger })).not.toHaveAttribute('data-density')
    expect(document.documentElement).toHaveAttribute('data-density', 'comfortable')
  })
})

describe('a key–value block', () => {
  const pairs = [
    { key: 'Registration', value: '5AZ 4471', numeric: true },
    { key: 'Next STK', value: '14 May 2027' },
    { key: 'Tyres changed' },
    { key: 'Odometer', value: null },
  ]

  it('pairs each label with its value', () => {
    draw(<KeyValue pairs={pairs} />)
    const terms = screen.getAllByRole('term').map((term) => term.textContent)
    expect(terms).toEqual(['Registration', 'Next STK', 'Tyres changed', 'Odometer'])
    expect(screen.getByText('5AZ 4471').className).toContain('numeric')
    expect(screen.getByText('14 May 2027').className).not.toContain('numeric')
  })

  it('draws a value that does not exist as a dash with a word, never an empty cell', () => {
    draw(<KeyValue pairs={pairs} />)
    const missing = screen.getAllByRole('definition').slice(2)
    expect(missing.map((value) => value.textContent)).toEqual(['— Not recorded', '— Not recorded'])
  })
})

describe('a money value', () => {
  it('sets the number and the currency apart, in the member’s locale', () => {
    const { container } = draw(<MoneyValue amount={money(124000, 'CZK')} />, 'cs')
    expect(container).toHaveTextContent('1 240,00 CZK')
    expect(screen.getByText('CZK').className).toContain('currency')
    expect(screen.queryByText('Výdaj')).not.toBeInTheDocument()
  })

  it('tells a negative amount by its sign and by a word, and by no colour', () => {
    const { container } = draw(<MoneyValue amount={money(-34000, 'CZK')} />)
    expect(container).toHaveTextContent('-CZK 340.00')
    expect(screen.getByText('Money out')).toBeVisible()
    expect(container.innerHTML).not.toMatch(/danger|negative/)
  })

  it('says what was paid in its own currency, at which stored rate, of which day', () => {
    draw(
      <MoneyValue
        amount={money(124000, 'CZK')}
        conversion={{ original: money(4860, 'EUR'), rate: '25.5200', day: '2026-03-02' }}
      />,
    )
    expect(screen.getByText('EUR 48.60 at a rate of 25.52, stored 3/2/26')).toBeVisible()
  })

  it('shows the stored rate with every digit it has, however small it is', () => {
    draw(
      <MoneyValue
        amount={money(36500, 'EUR')}
        conversion={{ original: money(10000000, 'VND'), rate: '0.0000365', day: '2026-03-02' }}
      />,
    )
    expect(screen.getByText('VND 10,000,000 at a rate of 0.0000365, stored 3/2/26')).toBeVisible()
  })

  it('draws a zero as a zero, with no word', () => {
    const { container } = draw(<MoneyValue amount={money(0, 'EUR')} large />)
    expect(container).toHaveTextContent('EUR 0.00')
    expect(screen.queryByText('Money out')).not.toBeInTheDocument()
  })
})

describe('a metric tile', () => {
  it('shows its label, its figure with its unit, and its trend in words', () => {
    const { container } = draw(
      <MetricTile
        label={words.period}
        value="412"
        unit="kWh"
        trend={{ direction: 'up', text: words.more }}
      />,
    )
    expect(screen.getByText(words.period)).toBeVisible()
    expect(screen.getByText('412')).toBeVisible()
    expect(screen.getByText('kWh')).toBeVisible()
    expect(screen.getByText(words.more)).toBeVisible()
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('says there is not enough information, and what is missing, where it has no figure', () => {
    draw(<MetricTile label={words.period} missing={words.missing} />)
    expect(screen.getByText('Not enough information')).toBeVisible()
    expect(screen.getByText(words.missing)).toBeVisible()
    // Not a zero: a figure the product has not earned is not shown at all.
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('shows a genuine zero as a figure', () => {
    draw(<MetricTile label={words.period} value="0" />)
    expect(screen.getByText('0')).toBeVisible()
    expect(screen.queryByText('Not enough information')).not.toBeInTheDocument()
  })
})

describe('a time series', () => {
  const points = [
    { label: 'Jan', value: 88, text: '88 kWh' },
    { label: 'Feb', value: 79, text: '79 kWh', estimated: true },
    { label: 'Mar', value: 44, text: '44 kWh' },
  ]

  const flat = [{ label: 'Jan', value: 0, text: '0 kWh' }]

  it('says every point in words, and an estimated one as estimated', () => {
    draw(<TimeSeries caption={words.perMonth} points={points} />)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'JanJan: 88 kWh',
      'FebFeb: 79 kWh, estimated',
      'MarMar: 44 kWh',
    ])
    expect(screen.getByRole('figure')).toHaveTextContent(words.perMonth)
  })

  it('draws each column against the tallest, and an estimated one in a style of its own', () => {
    const { container } = draw(<TimeSeries caption={words.perMonth} points={points} />)
    const bars = [...container.querySelectorAll<HTMLElement>('li > span:first-child > span')]
    expect(bars.map((bar) => bar.style.blockSize)).toEqual(['100%', '89.77272727272727%', '50%'])
    expect(bars.map((bar) => bar.className.includes('estimated'))).toEqual([false, true, false])
  })

  it('names the estimated style and the approximate aggregate beside the caption', () => {
    const { rerender } = draw(<TimeSeries caption={words.perMonth} points={points} approximate />)
    expect(screen.getByText('Estimated')).toBeVisible()
    expect(screen.getByText('Approximate')).toBeVisible()
    rerender(<TimeSeries caption={words.perMonth} points={points.slice(0, 1)} />)
    expect(screen.queryByText('Estimated')).not.toBeInTheDocument()
    expect(screen.queryByText('Approximate')).not.toBeInTheDocument()
  })

  it('draws a year by its months’ letters, three of which are J, each column in its place', () => {
    const complained = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const letters = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
    const year = (first: number) =>
      letters.map((label, month) => ({
        label,
        value: first + month,
        text: `${String(first + month)} kWh`,
      }))
    const { rerender } = draw(<TimeSeries caption={words.perMonth} points={year(1)} />)
    // The next year's figures, under the same letters.
    rerender(<TimeSeries caption={words.perMonth} points={year(20)} />)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(
      year(20).map((point) => `${point.label}${point.label}: ${point.text}`),
    )
    // React says so, on the console, where two of a list's elements share a key.
    expect(complained).not.toHaveBeenCalled()
  })

  it('draws nothing tall where every point is zero, and divides by nothing', () => {
    const { container } = draw(<TimeSeries caption={words.perMonth} points={flat} />)
    expect(container.querySelector<HTMLElement>('li > span > span')?.style.blockSize).toBe('0%')
  })
})

describe('a composition', () => {
  const segments = [
    { label: 'Documents', share: 0.44, text: '1.8 GB' },
    { label: 'Chat', share: 0.24, text: '980 MB' },
    { label: 'Overhead (derived)', share: 0.32, text: '1.3 GB' },
  ]

  it('names every segment in its legend, with its figure and its share, in the bar’s order', () => {
    draw(<Composition caption={words.storage} segments={segments} total={words.used} />)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Documents1.8 GB44%',
      'Chat980 MB24%',
      'Overhead (derived)1.3 GB32%',
    ])
    expect(screen.getByText(words.used)).toBeVisible()
  })

  it('draws the bar from the shares, as decoration the legend explains', () => {
    const { container } = draw(
      <Composition caption={words.storage} segments={segments} total={words.used} />,
    )
    const bar = container.querySelector('[aria-hidden="true"]')
    expect(
      [...(bar?.children ?? [])].map((part) => (part as HTMLElement).style.inlineSize),
    ).toEqual(['44%', '24%', '32%'])
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

  it('lists what comes in and where it goes, each with its figure, and how they agree', () => {
    draw(
      <Flow
        caption={words.march}
        total={words.agree}
        sourcesLabel={words.income}
        sources={sources}
        targetsLabel={words.accounts}
        targets={targets}
      />,
    )
    const [incoming, outgoing] = screen.getAllByRole('list')
    expect(incoming).toHaveTextContent('Jana, salary42 000Petr, salary31 000')
    expect(outgoing).toHaveTextContent('Household account48 000Savings25 000')
    expect(screen.getByText(words.income)).toBeVisible()
    expect(screen.getByText(words.accounts)).toBeVisible()
    expect(screen.getByText(words.agree)).toBeVisible()
  })

  it('lists two of one name apart, as it lists two segments of one name', () => {
    const complained = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const twice = [
      { label: 'Savings', text: '15 000' },
      { label: 'Savings', text: '10 000' },
    ]
    draw(
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

  it('shows the module, the kind of thing, the title, the snippet, the path and the day', () => {
    draw(<SearchResultRow {...result} snippet={words.snippet} path={words.path} />)
    expect(screen.getByText('Documents')).toBeVisible()
    expect(screen.getByText(words.document)).toBeVisible()
    expect(screen.getByText(words.insurance)).toBeVisible()
    expect(screen.getByText(words.snippet)).toBeVisible()
    expect(screen.getByText(words.path)).toBeVisible()
    // The day it was in the household's zone, where it was already the 5th.
    expect(screen.getByText('Updated Mar 5, 2026')).toBeVisible()
  })

  it('tells the day in the zone it is given, and assumes none', () => {
    draw(<SearchResultRow {...result} timeZone="America/New_York" />)
    expect(screen.getByText('Updated Mar 4, 2026')).toBeVisible()
  })

  it.each([null, undefined])('reads as a result with no snippet and no path: %s', (none) => {
    const { container } = draw(<SearchResultRow {...result} snippet={none} path={none} />)
    expect(screen.getByText(words.insurance)).toBeVisible()
    expect(screen.queryByText(words.snippet)).not.toBeInTheDocument()
    expect(screen.queryByText(words.path)).not.toBeInTheDocument()
    expect(container.querySelectorAll('p')).toHaveLength(3)
    expect([...container.querySelectorAll('p')].every((p) => p.textContent !== '')).toBe(true)
  })

  it('says the day in the member’s language', () => {
    draw(<SearchResultRow {...result} />, 'de')
    expect(screen.getByText('Geändert am 05.03.2026')).toBeVisible()
  })
})
