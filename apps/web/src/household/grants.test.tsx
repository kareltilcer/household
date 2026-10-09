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

  // Household settings is every member's to open whatever is set (D-167), and every change in
  // it is an owner's: a level's sentence on any other module would be untrue of it.
  it('says of household settings what each level comes to there, which is not what it comes to elsewhere', async () => {
    draw(<Filled role="member" />)
    const settings = screen.getByRole('combobox', { name: 'Household settings' })
    expect(settings).toHaveValue('view')
    expect(settings).toHaveAccessibleDescription(
      'The household’s invitations and its storage, beside its profile, its members, its modules, its data and sync health, which every member reads. Changing anything in the settings is for an owner.',
    )
    // It offers what the server takes, and says what each comes to.
    expect(offered(settings)).toEqual(['Off', 'Can see', 'Can add and edit', 'Can set it up'])
    await userEvent.selectOptions(settings, 'Off')
    expect(settings).toHaveAccessibleDescription(
      'In their app all the same, as in every member’s: the household’s profile, its members, its modules, its data and sync health. Its invitations and its storage are not. Changed from “Can see”.',
    )
    for (const level of ['Can add and edit', 'Can set it up']) {
      await userEvent.selectOptions(settings, level)
      expect(settings).toHaveAccessibleDescription(
        'No more than “Can see” gives: changing anything in the settings is for an owner, whatever is set here. Changed from “Can see”.',
      )
    }
  })

  it('says of a module the household has off that the level holds for when it is on', () => {
    draw(<Filled role="member" off={new Set<ModuleKey>(['garden'])} />)
    expect(screen.getByRole('combobox', { name: 'Garden' })).toHaveAccessibleDescription(
      /Off for the whole household: this holds for when it is turned on\.$/,
    )
  })
})

describe('what somebody holds, gathered by level', () => {
  const terms = () => screen.getAllByRole('term').map((term) => term.textContent)

  it('names each level with its count and its sentence, highest first, and what is off aloud', () => {
    draw(<GrantSummary grants={defaultsFor('member')} whose="yours" role="member" />)
    // Household settings is no part of a level's count: it is a group of its own, last.
    expect(terms()).toEqual([
      'Can add and edit · 9',
      'Can see · 2',
      'Off · 5',
      'Household settings',
    ])
    const held = screen.getAllByRole('definition')
    expect(held[0]).toHaveTextContent(
      'Dashboard, Tasks, Reminders, Calendar, Shopping, Chores, Notes, Chat, and Pets',
    )
    expect(held[1]).toHaveTextContent('Documents and Activity log')
    expect(held[2]).toHaveTextContent('Not in your app at all')
    expect(held[2]).toHaveTextContent('Finance, Utilities, Garden, Property, and Vehicles')
    expect(held[3]).toHaveTextContent(
      'The household’s invitations and its storage, beside its profile, its members, its modules, its data and sync health, which every member reads. Changing anything in the settings is for an owner.',
    )
  })

  it('draws only the modules it is given, and no level nobody holds', () => {
    draw(<GrantSummary grants={{ tasks: 'view', chat: 'none' }} whose="theirs" role="member" />)
    expect(terms()).toEqual(['Can see · 1', 'Off · 1'])
    expect(screen.getByText('Not in their app at all', { exact: false })).toBeInTheDocument()
  })

  // *Not in their app at all* is untrue of household settings, whose screens no level takes
  // away (D-167): what is off there is said in its own sentence, in whose app it is.
  it('says of household settings held at nothing that it stays, and its invitations do not', () => {
    const { unmount } = draw(
      <GrantSummary grants={defaultsFor('child')} whose="theirs" role="child" />,
    )
    expect(terms()).toEqual([
      'Can add and edit · 5',
      'Can see · 2',
      'Off · 9',
      'Household settings',
    ])
    const theirs = screen.getAllByRole('definition')
    expect(theirs[2]).toHaveTextContent('Not in their app at all')
    expect(theirs[2]).not.toHaveTextContent('Household settings')
    expect(theirs[3]).toHaveTextContent(
      'In their app all the same, as in every member’s: the household’s profile, its members, its modules, its data and sync health. Its invitations and its storage are not.',
    )
    unmount()
    draw(
      <GrantSummary
        grants={{ ...defaultsFor('member'), admin: 'none' }}
        whose="yours"
        role="member"
      />,
    )
    expect(terms()).toEqual([
      'Can add and edit · 9',
      'Can see · 2',
      'Off · 5',
      'Household settings',
    ])
    expect(screen.getAllByRole('definition')[3]).toHaveTextContent(
      'In your app all the same, as in every member’s: the household’s profile, its members, its modules, its data and sync health. Its invitations and its storage are not.',
    )
  })

  it('says of household settings held above seeing that it gives no more than seeing does', () => {
    draw(
      <GrantSummary
        grants={{ ...defaultsFor('member'), admin: 'manage' }}
        whose="theirs"
        role="member"
      />,
    )
    // No group of its own for a level nobody else holds: the settings are not counted in one.
    expect(terms()).toEqual([
      'Can add and edit · 9',
      'Can see · 2',
      'Off · 5',
      'Household settings',
    ])
    expect(screen.getAllByRole('definition')[3]).toHaveTextContent(
      'No more than “Can see” gives: changing anything in the settings is for an owner, whatever is set here.',
    )
  })

  it('gathers an owner’s household settings with everything else an owner holds', () => {
    draw(<GrantSummary grants={defaultsFor('owner')} whose="theirs" role="owner" />)
    expect(terms()).toEqual(['Can set it up · 17'])
    expect(screen.getByRole('definition')).toHaveTextContent('Household settings')
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
