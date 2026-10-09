import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { inHousehold } from '../app/paths.ts'
import { HouseholdContext } from '../household/HouseholdContext.tsx'
import type { Household, HouseholdSummary, ModuleKey } from '../household/households.ts'
import type { ModuleRegistry } from '../modules/registry.ts'
import { SyncFixture, type Sync } from '../sync/ReplicaProvider.tsx'
import { draw } from '../test/render.tsx'
import { ArrangeView } from './Arrange.tsx'
import { arrangementKey } from './arrangement.ts'
import { SidebarView } from './Sidebar.tsx'
import { SwitcherView } from './Switcher.tsx'

const user = '01900000-0000-7000-8000-00000000d0e5'
const at = (module: ModuleKey) => ({
  home: (household: string) => inHousehold.module(household, module),
})
const registry: ModuleRegistry = {
  tasks: at('tasks'),
  shopping: at('shopping'),
  garden: at('garden'),
  finance: at('finance'),
}

function household(grants: NonNullable<Household['my_grants']>, name = 'Tilcerovi'): Household {
  return {
    id: '01900000-0000-7000-8000-0000000000a1',
    name,
    country: 'CZ',
    timezone: 'Europe/Prague',
    base_currency: 'CZK',
    locale: 'cs',
    my_role: 'owner',
    my_grants: grants,
  }
}

const held = household({
  dashboard: 'view',
  tasks: 'contribute',
  shopping: 'contribute',
  garden: 'manage',
  finance: 'none',
})

const noReplica: Sync = { replica: { phase: 'opening' }, online: true, receiving: null }

/** A part of the shell as a household's screen draws it: in a router, in a household, with sync. */
function inShell(part: ReactNode, of: Household = held) {
  return draw(
    <MemoryRouter initialEntries={[`/households/${of.id}`]}>
      <SyncFixture value={noReplica}>
        <HouseholdContext value={of}>{part}</HouseholdContext>
      </SyncFixture>
    </MemoryRouter>,
  )
}

/** The names of the links under the group named `label`, in the order drawn. */
function group(label: string): string[] {
  const heading = screen.getByText(label)
  const parent = heading.parentElement
  if (parent === null) throw new Error(`${label} stands in no group`)
  return within(parent)
    .getAllByRole('link')
    .map((link) => link.textContent)
}

describe('the sidebar', () => {
  const switcher = <p>{held.name}</p>

  it('lists the modules the member holds and this build can open, each a link to it', () => {
    inShell(<SidebarView household={held} user={user} registry={registry} switcher={switcher} />)
    expect(group('My modules')).toEqual(['Tasks', 'Shopping', 'Garden'])
    expect(screen.getByRole('link', { name: 'Garden' })).toHaveAttribute(
      'href',
      `/households/${held.id}/modules/garden`,
    )
    // Home is the household's own address, and the one that is open says so.
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows no trace of a module the member does not hold', () => {
    inShell(<SidebarView household={held} user={user} registry={registry} switcher={switcher} />)
    // Finance is at `none`: not listed, not greyed, not locked, not counted.
    expect(screen.queryByText('Finance')).not.toBeInTheDocument()
    expect(screen.queryByText(/lock|upgrade|unavailable/i)).not.toBeInTheDocument()
  })

  it('draws the member’s own order, with what they pinned above and what they hid nowhere', () => {
    window.localStorage.setItem(
      arrangementKey(user, held.id),
      JSON.stringify({ pinned: ['garden'], order: ['shopping', 'tasks'], hidden: ['tasks'] }),
    )
    inShell(<SidebarView household={held} user={user} registry={registry} switcher={switcher} />)
    expect(group('Pinned')).toEqual(['Garden'])
    expect(group('My modules')).toEqual(['Shopping'])
    expect(screen.queryByText('Tasks')).not.toBeInTheDocument()
  })

  it('has no way into arranging, and no heading of an empty list, where there is no module', () => {
    const none = household({ dashboard: 'view', finance: 'none' })
    inShell(
      <SidebarView household={none} user={user} registry={registry} switcher={switcher} />,
      none,
    )
    expect(screen.queryByText('My modules')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Arrange my modules' })).not.toBeInTheDocument()
    // What is the member's own is there all the same.
    expect(screen.getByRole('link', { name: 'Your account' })).toHaveAttribute('href', '/account')
  })

  it('has no link to what needs attention while nothing does', () => {
    inShell(<SidebarView household={held} user={user} registry={registry} switcher={switcher} />)
    expect(screen.queryByRole('link', { name: /attention/ })).not.toBeInTheDocument()
  })
})

describe('the household switcher', () => {
  const others: HouseholdSummary[] = [
    {
      id: '01900000-0000-7000-8000-0000000000a2',
      name: 'Chata Vysočina',
      my_role: 'member',
      entitlement: { state: 'read_only' },
    },
    {
      id: '01900000-0000-7000-8000-0000000000a3',
      name: 'Babička',
      my_role: 'child',
      entitlement: { state: 'active' },
    },
  ]

  it('is a label, and no control, for a member of one household', () => {
    inShell(<SwitcherView household={held} others={[]} failed={false} onSwitch={vi.fn()} />)
    expect(screen.getByText('Tilcerovi')).toBeInTheDocument()
    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('names the household that is open, and lists the others with the role in each', async () => {
    const onSwitch = vi.fn()
    inShell(<SwitcherView household={held} others={others} failed={false} onSwitch={onSwitch} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Switch household. Currently Tilcerovi' }),
    )
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent)
    // A household whose subscription lapsed is listed, with its state in a word, and can be
    // entered; one in good standing is named with none.
    expect(items).toEqual(['Chata Vysočina · Member · read-only', 'Babička · Child profile'])
    await userEvent.click(screen.getByRole('menuitem', { name: /Chata/ }))
    expect(onSwitch).toHaveBeenCalledExactlyOnceWith(others[0]?.id)
  })

  it('says the other households could not be read, and still names the one that is open', () => {
    inShell(<SwitcherView household={held} others={[]} failed onSwitch={vi.fn()} />)
    expect(screen.getByText('Tilcerovi')).toBeInTheDocument()
    expect(screen.getByText('We couldn’t load your other households.')).toBeInTheDocument()
  })
})

describe('arranging the modules', () => {
  const view = <ArrangeView household={held} user={user} registry={registry} />

  /** The names of the modules under the section headed `label`, in the order drawn. */
  function section(label: string): string[] {
    const region = screen.getByRole('region', { name: label })
    return within(region)
      .queryAllByRole('listitem')
      .map((row) => row.textContent)
  }

  /** What this browser keeps of the arrangement. */
  function kept(): unknown {
    return JSON.parse(window.localStorage.getItem(arrangementKey(user, held.id)) ?? 'null')
  }

  it('lists the member’s modules in order, and says nothing is hidden', () => {
    inShell(view)
    expect(screen.getByRole('heading', { level: 1, name: 'Arrange your modules' })).toBeVisible()
    expect(section('In order')).toEqual(['Tasks', 'Shopping', 'Garden'])
    expect(screen.getByText('Nothing is hidden.')).toBeInTheDocument()
    // No module the member does not hold is anywhere on it, and none is counted.
    expect(screen.queryByText('Finance')).not.toBeInTheDocument()
  })

  it('moves a row by the arrow keys on its handle, and says where it has come to', async () => {
    inShell(view)
    screen.getByRole('button', { name: 'Reorder Tasks. Use arrow keys to move it' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(section('In order')).toEqual(['Shopping', 'Tasks', 'Garden'])
    expect(screen.getByRole('status')).toHaveTextContent('Tasks: 2 of 3')
    // The handle is the same row's still, wherever the row has gone.
    expect(screen.getByRole('button', { name: /^Reorder Tasks/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    expect(section('In order')).toEqual(['Tasks', 'Shopping', 'Garden'])
    expect(screen.getByRole('status')).toHaveTextContent('Tasks: 1 of 3')
  })

  it('offers no move past an end of the list', async () => {
    inShell(view)
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Tasks' }))
    expect(screen.queryByRole('menuitem', { name: 'Move up' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toBeInTheDocument()
  })

  it('pins a module above the rest, and keeps that in this browser', async () => {
    inShell(view)
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Garden' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pin to the top' }))
    expect(section('Pinned')).toEqual(['Garden'])
    expect(section('In order')).toEqual(['Tasks', 'Shopping'])
    expect(kept()).toMatchObject({ pinned: ['garden'] })
  })

  // The row left the list its controls were in, and the focus with them: what became of it is
  // said, and the focus is on the row's handle where the row now is (D-166).
  it('says that a row was pinned or unpinned, and takes the focus to it in the list it went to', async () => {
    inShell(view)
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Garden' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pin to the top' }))
    expect(screen.getByRole('status')).toHaveTextContent('Garden is pinned to the top.')
    const pinnedHandle = within(screen.getByRole('region', { name: 'Pinned' })).getByRole(
      'button',
      { name: /^Reorder Garden/ },
    )
    await waitFor(() => {
      expect(pinnedHandle).toHaveFocus()
    })

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Garden' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unpin' }))
    expect(screen.getByRole('status')).toHaveTextContent('Garden is no longer pinned.')
    // Unpinned, it is first of the rest, next to where it was.
    expect(section('In order')).toEqual(['Garden', 'Tasks', 'Shopping'])
    await waitFor(() => {
      expect(
        within(screen.getByRole('region', { name: 'In order' })).getByRole('button', {
          name: /^Reorder Garden/,
        }),
      ).toHaveFocus()
    })
  })

  it('says that a row was put away or shown again, and takes the focus with it both ways', async () => {
    inShell(view)
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Shopping' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Hide from my list' }))
    expect(screen.getByRole('status')).toHaveTextContent('Shopping is hidden from your list.')
    // Put away, the row has one control: what shows it again.
    const show = screen.getByRole('button', { name: 'Show Shopping in your list again' })
    await waitFor(() => {
      expect(show).toHaveFocus()
    })

    await userEvent.click(show)
    expect(screen.getByRole('status')).toHaveTextContent('Shopping is back in your list.')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Reorder Shopping/ })).toHaveFocus()
    })
  })

  it('hides a module in the one place it is named, and brings it back from there', async () => {
    inShell(view)
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Shopping' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Hide from my list' }))
    expect(section('In order')).toEqual(['Tasks', 'Garden'])
    expect(section('Hidden by me')).toEqual([expect.stringContaining('Shopping')])
    await userEvent.click(screen.getByRole('button', { name: /Show Shopping in your list again/ }))
    expect(section('In order')).toEqual(['Tasks', 'Garden', 'Shopping'])
    expect(screen.getByText('Nothing is hidden.')).toBeInTheDocument()
  })

  it('says there is nothing to arrange for a member who holds no module', () => {
    const none = household({ dashboard: 'view' })
    inShell(<ArrangeView household={none} user={user} registry={registry} />, none)
    expect(screen.getByRole('heading', { name: 'Nothing to arrange yet' })).toBeInTheDocument()
    expect(screen.queryByText('Hidden by me')).not.toBeInTheDocument()
  })
})
