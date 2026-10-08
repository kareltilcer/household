import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { draw } from '../test/render.tsx'
import { GrantMatrix, GrantSummary } from './GrantMatrix.tsx'
import {
  changedModules,
  defaultsFor,
  isLowered,
  levelsOf,
  matrixOrder,
  offeredLevels,
  type Levels,
} from './grants.ts'
import { moduleKeys, type AccessLevel, type HouseholdRole, type ModuleKey } from './households.ts'

/** The words a row's choice offers, in the order offered. */
function offered(row: HTMLElement): string[] {
  return within(row)
    .getAllByRole('option')
    .map((option) => option.textContent)
}

describe('what a role may be given', () => {
  it('is every level for a member, and stops under setting up for a child', () => {
    expect(offeredLevels('member', 'garden')).toEqual(['none', 'view', 'contribute', 'manage'])
    expect(offeredLevels('child', 'garden')).toEqual(['none', 'view', 'contribute'])
    // Finance is the one module a child may at most read (FR-AC4).
    expect(offeredLevels('child', 'finance')).toEqual(['none', 'view'])
  })

  it('lists every module of the contract once, in the matrix’s own order', () => {
    expect([...matrixOrder].sort()).toEqual([...moduleKeys].sort())
    // What a household owns and spends comes last: a member’s defaults close exactly those.
    const closed = matrixOrder.filter((module) => defaultsFor('member')[module] === 'none')
    expect(closed).toEqual(matrixOrder.slice(-closed.length))
  })

  it('holds a module nobody named at none, and tells a lowering from a raising', () => {
    const held = levelsOf({ tasks: 'view' })
    expect(held.tasks).toBe('view')
    expect(held.finance).toBe('none')
    expect(
      changedModules(defaultsFor('member'), { ...defaultsFor('member'), finance: 'view' }),
    ).toEqual(['finance'])
    expect(isLowered('contribute', 'view')).toBe(true)
    expect(isLowered('view', 'contribute')).toBe(false)
    expect(isLowered('view', 'view')).toBe(false)
  })
})

describe('the grant matrix', () => {
  const label = 'What Petr gets'

  function Filled({
    role,
    onChange,
    off,
  }: {
    readonly role: HouseholdRole
    readonly onChange?: (module: ModuleKey, level: AccessLevel) => void
    readonly off?: ReadonlySet<ModuleKey>
  }) {
    const from = defaultsFor(role)
    const [levels, setLevels] = useState<Levels>(from)
    return (
      <GrantMatrix
        label={label}
        role={role}
        levels={levels}
        from={from}
        {...(off === undefined ? {} : { off })}
        onChange={(module, level) => {
          onChange?.(module, level)
          setLevels({ ...levels, [module]: level })
        }}
      />
    )
  }

  it('is a row a module, each a choice named for its module, in words and never the contract’s', () => {
    draw(<Filled role="member" />)
    const matrix = screen.getByRole('list', { name: label })
    expect(within(matrix).getAllByRole('listitem')).toHaveLength(17)
    const shopping = within(matrix).getByRole('combobox', { name: 'Shopping' })
    expect(shopping).toHaveValue('contribute')
    expect(within(shopping).getByRole('option', { selected: true })).toHaveTextContent(
      'Can add and edit',
    )
    expect(offered(shopping)).toEqual(['Off', 'Can see', 'Can add and edit', 'Can set it up'])
    expect(matrix).not.toHaveTextContent(/\b(none|view|contribute|manage)\b/)
  })

  it('says under each row what its level comes to, so that it reads without a legend', () => {
    draw(<Filled role="member" />)
    expect(screen.getByRole('combobox', { name: 'Finance' })).toHaveAccessibleDescription(
      'Not in their app at all: no screen, no widget, no search result, no reminder.',
    )
    expect(screen.getByRole('combobox', { name: 'Documents' })).toHaveAccessibleDescription(
      'Everything in it can be read, and nothing changed.',
    )
  })

  it('says what a row was changed from, and tells its owner of the change', async () => {
    const onChange = vi.fn()
    draw(<Filled role="member" onChange={onChange} />)
    const finance = screen.getByRole('combobox', { name: 'Finance' })
    await userEvent.selectOptions(finance, 'Can see')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('finance', 'view')
    expect(finance).toHaveAccessibleDescription(
      'Everything in it can be read, and nothing changed. Changed from “Off”.',
    )
  })

  // The cap is said by construction, and not by a save the server refuses (03-patterns §9).
  it('does not offer a child profile what a child may not hold', () => {
    draw(<Filled role="child" />)
    expect(offered(screen.getByRole('combobox', { name: 'Chores' }))).toEqual([
      'Off',
      'Can see',
      'Can add and edit',
    ])
    expect(offered(screen.getByRole('combobox', { name: 'Finance' }))).toEqual(['Off', 'Can see'])
  })

  it('says of a module the household has off that the level holds for when it is on', () => {
    draw(<Filled role="member" off={new Set<ModuleKey>(['garden'])} />)
    expect(screen.getByRole('combobox', { name: 'Garden' })).toHaveAccessibleDescription(
      /Off for the whole household: this holds for when it is turned on\.$/,
    )
  })
})

describe('what somebody holds, gathered by level', () => {
  it('names each level with its count and its sentence, highest first, and what is off aloud', () => {
    draw(<GrantSummary grants={defaultsFor('member')} whose="yours" />)
    const terms = screen.getAllByRole('term').map((term) => term.textContent)
    expect(terms).toEqual(['Can add and edit · 9', 'Can see · 3', 'Off · 5'])
    const held = screen.getAllByRole('definition')
    expect(held[0]).toHaveTextContent(
      'Dashboard, Tasks, Reminders, Calendar, Shopping, Chores, Notes, Chat, and Pets',
    )
    expect(held[2]).toHaveTextContent('Not in your app at all')
    expect(held[2]).toHaveTextContent('Finance, Utilities, Garden, Property, and Vehicles')
  })

  it('draws only the modules it is given, and no level nobody holds', () => {
    draw(<GrantSummary grants={{ tasks: 'view', chat: 'none' }} whose="theirs" />)
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Can see · 1',
      'Off · 1',
    ])
    expect(screen.getByText('Not in their app at all', { exact: false })).toBeInTheDocument()
  })

  it('is a line a level in a list of members, with what is off counted and not named', () => {
    draw(
      <GrantSummary
        grants={levelsOf({ dashboard: 'view', utilities: 'manage', shopping: 'contribute' })}
        whose="theirs"
        compact
      />,
    )
    expect(screen.getAllByRole('listitem').map((line) => line.textContent)).toEqual([
      'Can set it up: Utilities',
      'Can add and edit: Shopping',
      'Can see: Dashboard',
      'Off: 14 modules',
    ])
  })
})
