// Which modules the household has on (C-51) as each member reads it and as an owner changes it:
// the sixteen rows and what each says, turning one on at once and one off after it is asked
// about, every refusal the server can answer, and the list while it is read, unread and kept.
import { pseudoLocale } from '@household/i18n/lazy'
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inHousehold } from '../../app/paths.ts'
import { storageKey } from '../../i18n/locale.ts'
import { defaultsFor } from '../grants.ts'
import { moduleKeys } from '../households.ts'
import {
  accountOf,
  adam,
  createServer,
  home,
  jana,
  klara,
  memberOf,
  members,
  moduleStates,
  open,
  petr,
  problem,
  readBy,
  tilcerovi,
  type HouseholdServer,
} from '../testing.tsx'

// A test that says the page is looked at again leaves the next one a page nobody has looked at,
// and one that takes the connection away leaves the next one a browser that has it.
afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

const at = `/households/${home}`
const list = `GET ${at}/modules`
const turning = (module: string) => `PATCH ${at}/modules/${module}`

const names = [
  'Dashboard',
  'Tasks',
  'Reminders',
  'Calendar',
  'Shopping',
  'Chores',
  'Notes',
  'Chat',
  'Pets',
  'Documents',
  'Activity log',
  'Finance',
  'Utilities',
  'Garden',
  'Property',
  'Vehicles',
]

const readOnly = { state: 'read_only', can_write: false, can_upload: false } as const

async function modules(server: HouseholdServer = createServer()) {
  const opened = open(inHousehold.modules(home), server)
  await screen.findByRole('heading', { level: 1, name: 'Modules' })
  return opened
}

/** The rows of the list, once it is read. */
async function rows(): Promise<HTMLElement[]> {
  return within(await screen.findByRole('list', { name: 'Modules' })).getAllByRole('listitem')
}

/** The row of the module called `name`. */
async function row(name: string): Promise<HTMLElement> {
  const found = within(await screen.findByRole('list', { name: 'Modules' }))
    .getByText(name)
    .closest('li')
  if (found === null) throw new Error(`${name} has no row`)
  return found
}

/** A server that turns a module on or off as the real one does. */
function switching(server: HouseholdServer = createServer()): HouseholdServer {
  for (const module of moduleKeys) {
    server.on(turning(module), async (request) => {
      const { enabled } = (await request.json()) as { enabled: boolean }
      server.off = enabled ? server.off.filter((each) => each !== module) : [...server.off, module]
      return Response.json({
        module,
        enabled,
        my_level: enabled ? 'manage' : 'none',
        needs_setup: false,
        entity_count: null,
      })
    })
  }
  return server
}

/** Makes Jana a member, as another owner would have. */
function demote(server: HouseholdServer): void {
  server.household = readBy({
    ...memberOf(jana.id),
    role: 'member',
    grants: defaultsFor('member'),
  })
}

describe('the household’s modules, as each member reads them', () => {
  it('is sixteen rows in the matrix’s order, every module but household settings, each on or off in a word', async () => {
    const server = createServer()
    server.off = ['pets', 'property']
    await modules(server)
    const drawn = await rows()
    expect(drawn.map((each) => within(each).getAllByText(/./)[0]?.textContent)).toEqual(names)
    expect(screen.queryByText('Household settings')).not.toBeInTheDocument()
    expect(within(await row('Garden')).getByText('On')).toBeInTheDocument()
    expect(within(await row('Pets')).getByText('Off')).toBeInTheDocument()
    expect(within(await row('Property')).getByText('Off')).toBeInTheDocument()
    // Why there are sixteen here, and seventeen in a member's access.
    expect(
      screen.getByText(
        'Sixteen here, seventeen in a member’s access: Household settings is granted, never turned off.',
      ),
    ).toBeInTheDocument()
  })

  it('answers the one thing people ask before anything else', async () => {
    await modules()
    expect(screen.getByText('On or off for the whole household.')).toBeInTheDocument()
    expect(screen.getByText('Turning a module off keeps its data')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Its screens, widgets and reminders go for everybody. Nothing is deleted, and turning it back on restores all of it.',
      ),
    ).toBeInTheDocument()
  })

  it('says how many of the household’s members hold each module that is on, and that one off keeps its data', async () => {
    const server = createServer()
    server.off = ['pets']
    await modules(server)
    await screen.findByText('Held by 5 of 5 members')
    expect(within(await row('Dashboard')).getByText('Held by 5 of 5 members')).toBeInTheDocument()
    expect(within(await row('Shopping')).getByText('Held by 4 of 5 members')).toBeInTheDocument()
    expect(within(await row('Garden')).getByText('Held by 2 of 5 members')).toBeInTheDocument()
    expect(within(await row('Reminders')).getByText('Held by 1 of 5 members')).toBeInTheDocument()
    expect(
      within(await row('Pets')).getByText('Off for everybody. Its data is kept.'),
    ).toBeInTheDocument()
    expect(within(await row('Pets')).queryByText(/^Held by/)).not.toBeInTheDocument()
  })

  it('counts a household of one as one member', async () => {
    const server = createServer()
    server.members = [memberOf(jana.id)]
    await modules(server)
    expect(await screen.findAllByText('Held by 1 of 1 member')).toHaveLength(16)
  })

  it('leaves the count out while the members are unread, and draws the rest', async () => {
    const server = createServer()
    server.on(`GET ${at}/members`, () => Promise.reject(new TypeError('offline')))
    await modules(server)
    expect(await rows()).toHaveLength(16)
    await waitFor(() => {
      expect(server.to(`GET ${at}/members`).length).toBeGreaterThan(0)
    })
    expect(screen.queryByText(/^Held by/)).not.toBeInTheDocument()
    expect(within(await row('Garden')).getByText('On')).toBeInTheDocument()
  })

  it('gives an owner one control a row, named for its module and for what it will do', async () => {
    const server = createServer()
    server.off = ['pets']
    await modules(server)
    const drawn = await rows()
    for (const each of drawn) expect(within(each).getAllByRole('button')).toHaveLength(1)
    const off = within(await row('Garden')).getByRole('button', { name: 'Turn off Garden' })
    // A short word to the eye, and the module's name with it to whoever cannot see the row.
    expect(off).toHaveTextContent(/Turn off$/)
    const on = within(await row('Pets')).getByRole('button', { name: 'Turn on Pets' })
    expect(on).toHaveTextContent(/Turn on$/)
  })

  it('reads the same to a member, with no control', async () => {
    const server = createServer(accountOf(petr))
    server.off = ['pets']
    await modules(server)
    expect(await rows()).toHaveLength(16)
    expect(within(await row('Garden')).getByText('On')).toBeInTheDocument()
    expect(within(await row('Pets')).getByText('Off')).toBeInTheDocument()
    expect(await screen.findByText('Held by 5 of 5 members')).toBeInTheDocument()
    // Absent, and not disabled.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  // What `view` on household settings unlocks is the invitations: the modules are every member's.
  it('reads the same to a member who holds nothing on household settings', async () => {
    await modules(createServer(accountOf(klara)))
    expect(await rows()).toHaveLength(16)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('reads the same to a child profile', async () => {
    await modules(createServer(accountOf(adam)))
    expect(await rows()).toHaveLength(16)
    expect(within(await row('Chores')).getByText('On')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('draws no control in a read-only household, for its owner either', async () => {
    const server = createServer()
    server.household = { ...tilcerovi, entitlement: readOnly }
    server.off = ['pets']
    await modules(server)
    expect(await rows()).toHaveLength(16)
    // Which ones are on still reads.
    expect(within(await row('Pets')).getByText('Off')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('an owner made a member while the modules are open', () => {
  it('loses the controls when the household is read again, and the focus one of them held stays on the list', async () => {
    const server = createServer()
    await modules(server)
    const control = within(await row('Garden')).getByRole('button', { name: 'Turn off Garden' })
    act(() => {
      control.focus()
    })
    // Made a member by another owner: the page is looked at again, and reads it.
    demote(server)
    act(() => {
      focusManager.setFocused(true)
    })
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(screen.getByRole('list', { name: 'Modules' }))
    // Nothing was pressed, so nothing was refused, and what is on stayed on.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(within(await row('Garden')).getByText('On')).toBeInTheDocument()
  })
})

describe('the list of modules while it is read, unread and kept', () => {
  it('is a skeleton while it is read', async () => {
    const server = createServer()
    let answer: (response: Response) => void = () => undefined
    server.on(
      list,
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    )
    await modules(server)
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Modules' })).not.toBeInTheDocument()
    answer(Response.json({ items: moduleStates() }))
    expect(await rows()).toHaveLength(16)
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
  })

  it('says it did not load and that nothing was turned on or off, and reads it again', async () => {
    const server = createServer()
    server.on(list, () => Promise.reject(new TypeError('offline')))
    const { user } = await modules(server)
    expect(await screen.findByText('The module list did not load')).toBeInTheDocument()
    expect(screen.getByText('Nothing was turned on or off.')).toBeInTheDocument()
    server.on(list, () => Response.json({ items: moduleStates() }))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await rows()).toHaveLength(16)
  })

  // Asked with no connection and nothing kept, the read waits: that is a list that could not be
  // read, and no skeleton that never ends.
  it('says it could not be read where it is asked for with no connection, and reads it when one returns', async () => {
    const server = createServer()
    server.on(`GET ${at}`, () => {
      // The connection goes once the household is known: what the screen then asks for waits.
      onlineManager.setOnline(false)
      return Response.json(server.household)
    })
    await modules(server)
    expect(await screen.findByText('The module list did not load')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    expect(server.to(list)).toHaveLength(0)
    server.on(`GET ${at}`, () => Response.json(server.household))
    act(() => {
      onlineManager.setOnline(true)
    })
    expect(await rows()).toHaveLength(16)
  })

  it('draws what this browser kept when the connection goes, and says a change needs one', async () => {
    const server = createServer()
    server.on(turning('garden'), () => Promise.reject(new TypeError('offline')))
    const { user } = await modules(server)
    expect(await rows()).toHaveLength(16)
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(
      await screen.findByText(
        'Changing anything here needs a connection: it is changed on the server or not at all. Reading does not.',
      ),
    ).toBeInTheDocument()
    expect(await rows()).toHaveLength(16)
    expect(within(await row('Garden')).getByText('On')).toBeInTheDocument()

    // A change pressed all the same is asked, and says it could not reach the server.
    await user.click(screen.getByRole('button', { name: 'Turn off Garden' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Turn off Garden for everyone' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^We couldn’t reach Household\./,
    )
  })
})

describe('turning a module on', () => {
  it('is done at once, says everything in it is back, and leaves the focus on the row’s control', async () => {
    const server = switching()
    server.off = ['pets']
    const { user } = await modules(server)
    const control = within(await row('Pets')).getByRole('button', { name: 'Turn on Pets' })
    const read = server.to(`GET ${at}`).length
    const listed = server.to(list).length
    await user.click(control)

    expect(
      await screen.findByText('Pets is on for everyone, and everything in it is back.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const sent = server.to(turning('pets'))
    expect(sent).toHaveLength(1)
    expect(await server.body(turning('pets'))).toEqual({ enabled: true })
    // A module has no version to hold a change against: it is on or it is off.
    expect(sent[0]?.headers.get('If-Match')).toBeNull()
    // The row stays where it was, and its control is its opposite under the focus.
    expect(within(await row('Pets')).getByText('On')).toBeInTheDocument()
    expect(control).toBeInTheDocument()
    expect(control).toHaveAccessibleName('Turn off Pets')
    expect(control).toHaveFocus()
    // The household, whose own grants change with it, and its modules are read again.
    await waitFor(() => {
      expect(server.to(`GET ${at}`).length).toBeGreaterThan(read)
      expect(server.to(list).length).toBeGreaterThan(listed)
    })
    expect(within(await row('Pets')).getByText('On')).toBeInTheDocument()
  })

  it('makes its own row’s control busy, and leaves every other to be pressed', async () => {
    const server = switching()
    server.off = ['pets', 'property']
    let answer: () => void = () => undefined
    server.on(
      turning('pets'),
      () =>
        new Promise<Response>((resolve) => {
          answer = () => {
            server.off = server.off.filter((each) => each !== 'pets')
            resolve(Response.json({ module: 'pets', enabled: true, my_level: 'manage' }))
          }
        }),
    )
    const { user } = await modules(server)
    const pets = within(await row('Pets')).getByRole('button', { name: 'Turn on Pets' })
    const property = within(await row('Property')).getByRole('button', {
      name: 'Turn on Property',
    })
    await user.click(pets)
    await waitFor(() => {
      expect(pets).toHaveAttribute('aria-busy', 'true')
    })
    expect(property).not.toHaveAttribute('aria-busy')
    // A second press of a busy control asks nothing more.
    await user.click(pets)
    expect(server.to(turning('pets'))).toHaveLength(1)

    await user.click(property)
    expect(
      await screen.findByText('Property is on for everyone, and everything in it is back.'),
    ).toBeInTheDocument()
    expect(pets).toHaveAttribute('aria-busy', 'true')

    answer()
    expect(
      await screen.findByText('Pets is on for everyone, and everything in it is back.'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(pets).not.toHaveAttribute('aria-busy')
    })
  })

  it('says an owner made a member meanwhile is one no longer, and takes the controls away', async () => {
    const server = createServer()
    server.off = ['pets']
    server.on(turning('pets'), () => {
      demote(server)
      return problem(403, 'forbidden')
    })
    const { user } = await modules(server)
    await user.click(within(await row('Pets')).getByRole('button', { name: 'Turn on Pets' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an owner can change this, and you are not one any more. Nothing was changed.',
    )
    // The household is read again, and draws no control for a member.
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
    expect(within(await row('Pets')).getByText('Off')).toBeInTheDocument()
    // The control that was pressed went with the rest: the focus is on the list's own place.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(screen.getByRole('list', { name: 'Modules' }))
  })

  it('says a household that became read-only changed nothing', async () => {
    const server = createServer()
    server.off = ['pets']
    server.on(turning('pets'), () => {
      server.household = { ...tilcerovi, entitlement: readOnly }
      return problem(402, 'entitlement_read_only', { state: 'read_only', remedy: 'subscribe' })
    })
    const { user } = await modules(server)
    await user.click(within(await row('Pets')).getByRole('button', { name: 'Turn on Pets' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The household is read-only now, so nothing was changed.',
    )
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  it('says a module the server does not know is not there to change, and reads the list again', async () => {
    const server = createServer()
    server.off = ['pets']
    const { user } = await modules(server)
    const control = within(await row('Pets')).getByRole('button', { name: 'Turn on Pets' })
    const listed = server.to(list).length
    // Nothing answers the change: the server knows no such module.
    await user.click(control)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That is no longer there to change. The page shows how things stand now.',
    )
    await waitFor(() => {
      expect(server.to(list).length).toBeGreaterThan(listed)
    })
    expect(control).not.toHaveAttribute('aria-busy')
  })

  it('is asked at once with no connection, says the server was not reached, and is sent by nothing later', async () => {
    const server = createServer()
    server.off = ['pets']
    server.on(turning('pets'), () => Promise.reject(new TypeError('offline')))
    const { user } = await modules(server)
    const control = within(await row('Pets')).getByRole('button', { name: 'Turn on Pets' })
    onlineManager.setOnline(false)
    await user.click(control)
    expect(await screen.findByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
    // Not held for a connection behind a busy control: it is asked, and answered.
    expect(control).not.toHaveAttribute('aria-busy')
    expect(control).toHaveAccessibleName('Turn on Pets')
    expect(within(await row('Pets')).getByText('Off')).toBeInTheDocument()
    act(() => {
      onlineManager.setOnline(true)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(server.to(turning('pets'))).toHaveLength(1)
  })

  it('says a second refusal as it said the first, and nothing of either once a press succeeds', async () => {
    const server = switching()
    server.off = ['pets']
    server.on(turning('pets'), () => problem(429, 'rate_limited'))
    const { user } = await modules(server)
    const control = within(await row('Pets')).getByRole('button', { name: 'Turn on Pets' })
    await user.click(control)
    const first = await screen.findByRole('alert')
    expect(first).toHaveTextContent('Too many attempts. Try again in a little while.')
    server.on(turning('pets'), () => problem(500, 'internal'))
    await user.click(control)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/^Something went wrong at our end\./)
    })
    // A banner of its own, which arrives and is said, and not the first one's words changed.
    expect(screen.getByRole('alert')).not.toBe(first)

    switching(server)
    await user.click(control)
    expect(
      await screen.findByText('Pets is on for everyone, and everything in it is back.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('turning a module off', () => {
  it('asks first, saying for how many its screens go and that nothing is deleted, and then turns it off', async () => {
    const server = switching()
    const { user } = await modules(server)
    await within(await row('Garden')).findByText('Held by 2 of 5 members')
    const control = within(await row('Garden')).getByRole('button', { name: 'Turn off Garden' })
    const read = server.to(`GET ${at}`).length
    await user.click(control)
    const dialog = screen.getByRole('dialog', { name: 'Turn off Garden for everyone?' })
    expect(dialog).toHaveAccessibleDescription(
      'Its screens, widgets and reminders go for all 2 people who hold it. Nothing is deleted: everything in it stays where it is, and comes back if Garden is turned on again.',
    )
    // The safe choice first, then the one that names what it turns off.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Cancel', 'Turn off Garden for everyone'])
    expect(server.to(turning('garden'))).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Turn off Garden for everyone' }))

    expect(await screen.findByText('Garden is off. Its data is kept.')).toBeInTheDocument()
    expect(server.to(turning('garden'))).toHaveLength(1)
    expect(await server.body(turning('garden'))).toEqual({ enabled: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The row stays where it was and says what is so. Its control never left the page, so it is
    // there for the dialog to hand the focus back to, and is now its opposite.
    const garden = await row('Garden')
    expect(within(garden).getByText('Off')).toBeInTheDocument()
    expect(within(garden).getByText('Off for everybody. Its data is kept.')).toBeInTheDocument()
    expect(control).toBeInTheDocument()
    expect(control).toHaveAccessibleName('Turn on Garden')
    await waitFor(() => {
      expect(server.to(`GET ${at}`).length).toBeGreaterThan(read)
    })
    expect((await rows()).map((each) => within(each).getAllByText(/./)[0]?.textContent)).toEqual(
      names,
    )
  })

  it('says it of the one person who holds a module', async () => {
    const server = createServer()
    const { user } = await modules(server)
    await within(await row('Pets')).findByText('Held by 1 of 5 members')
    await user.click(screen.getByRole('button', { name: 'Turn off Pets' }))
    expect(
      screen.getByRole('dialog', { name: 'Turn off Pets for everyone?' }),
    ).toHaveAccessibleDescription(
      'Its screens, widgets and reminders go for the one person who holds it. Nothing is deleted: everything in it stays where it is, and comes back if Pets is turned on again.',
    )
  })

  it('says nobody’s app changes where nobody holds the module', async () => {
    const server = createServer()
    server.members = members.map((member) => ({
      ...member,
      grants: { ...member.grants, pets: 'none' as const },
    }))
    const { user } = await modules(server)
    await screen.findByText('Held by 0 of 5 members')
    await user.click(screen.getByRole('button', { name: 'Turn off Pets' }))
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'Nobody holds it now, so nobody’s app changes. Nothing is deleted: everything in it stays where it is, and comes back if Pets is turned on again.',
    )
  })

  it('says it of everybody who holds the module while the members are unread', async () => {
    const server = createServer()
    server.on(`GET ${at}/members`, () => Promise.reject(new TypeError('offline')))
    const { user } = await modules(server)
    await user.click(await screen.findByRole('button', { name: 'Turn off Pets' }))
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'Its screens, widgets and reminders go for everybody who holds it. Nothing is deleted: everything in it stays where it is, and comes back if Pets is turned on again.',
    )
  })

  it('leaves it on when its owner says so', async () => {
    const server = switching()
    const { user } = await modules(server)
    await user.click(await screen.findByRole('button', { name: 'Turn off Garden' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.to(turning('garden'))).toHaveLength(0)
    expect(within(await row('Garden')).getByText('On')).toBeInTheDocument()
  })

  it('says it could not reach the server, and leaves the question open', async () => {
    const server = createServer()
    server.on(turning('garden'), () => Promise.reject(new TypeError('offline')))
    const { user } = await modules(server)
    await user.click(await screen.findByRole('button', { name: 'Turn off Garden' }))
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Turn off Garden for everyone' })
    onlineManager.setOnline(false)
    await user.click(confirm)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^We couldn’t reach Household\./,
    )
    expect(confirm).not.toHaveAttribute('aria-busy')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(await row('Garden')).getByText('On')).toBeInTheDocument()
    act(() => {
      onlineManager.setOnline(true)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(server.to(turning('garden'))).toHaveLength(1)
  })

  it('says an owner made a member meanwhile is one no longer, on the page, and takes the controls away', async () => {
    const server = createServer()
    server.on(turning('garden'), () => {
      demote(server)
      return problem(403, 'forbidden')
    })
    const { user } = await modules(server)
    await user.click(await screen.findByRole('button', { name: 'Turn off Garden' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Turn off Garden for everyone',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an owner can change this, and you are not one any more. Nothing was changed.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
    expect(within(await row('Garden')).getByText('On')).toBeInTheDocument()
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(screen.getByRole('list', { name: 'Modules' }))
  })

  it('says a household that became restricted changed nothing, and that a module is not there', async () => {
    const server = createServer()
    server.on(turning('garden'), () =>
      problem(402, 'entitlement_restricted', { state: 'restricted', remedy: 'lift_restriction' }),
    )
    const { user } = await modules(server)
    await user.click(await screen.findByRole('button', { name: 'Turn off Garden' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Turn off Garden for everyone',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The household is read-only now, so nothing was changed.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Nothing answers the next change: the server knows no such module.
    const listed = server.to(list).length
    await user.click(await screen.findByRole('button', { name: 'Turn off Pets' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Turn off Pets for everyone',
      }),
    )
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'That is no longer there to change. The page shows how things stand now.',
      )
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(server.to(list).length).toBeGreaterThan(listed)
    })
  })
})

describe('the modules under the pseudo-locale', () => {
  // The end-to-end pass takes a run of four plain letters for a word nobody translated.
  it('draws no word in plain letters, on the page or in its question', async () => {
    window.localStorage.setItem(storageKey, pseudoLocale)
    const server = createServer()
    server.off = ['pets']
    const { user } = open(inHousehold.modules(home), server)
    await screen.findByRole('heading', { level: 1 })
    // A control a row, once the list is read, and the count once the members are.
    await waitFor(() => {
      expect(screen.getAllByRole('button')).toHaveLength(16)
    })
    await waitFor(() => {
      expect(document.body).toHaveTextContent('5 ó')
    })
    const plain = () => (document.body.textContent.match(/[A-Za-z]{4,}/g) ?? []).join(' ')
    expect(plain()).toBe('')
    await user.click(screen.getAllByRole('button')[0] as HTMLElement)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(plain()).toBe('')
  })
})
