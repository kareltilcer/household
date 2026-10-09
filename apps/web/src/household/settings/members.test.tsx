// The list of members (C-50) as each member of the household reads it: who is in it and what
// each holds, what an owner has beside it, and the list in each of its states.
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inHousehold } from '../../app/paths.ts'
import type { Membership } from '../data.ts'
import {
  accountOf,
  adam,
  createServer,
  home,
  invitation,
  jana,
  klara,
  memberOf,
  members,
  open,
  origin,
  petr,
  problem,
  readBy,
  tilcerovi,
  type HouseholdServer,
} from '../testing.tsx'

const at = inHousehold.members(home)
const membersRoute = `GET /households/${home}/members`
const invitationsRoute = `GET /households/${home}/invitations`

const readOnly = { state: 'read_only', can_write: false, can_upload: false } as const

// A test that takes the connection away leaves the next one a browser that has it, and one
// that says the page is looked at again a page nobody has looked at.
afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
})

async function membersScreen(server: HouseholdServer = createServer()) {
  const opened = open(at, server)
  await screen.findByRole('heading', { level: 1, name: 'Members' })
  return opened
}

/** The list's rows, a member each. A row holds a list of its own, of what its member holds. */
async function rows(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: 'Members' })
  return Array.from(list.children) as HTMLElement[]
}

/** The row of the member the list names `name`. */
async function rowOf(name: string): Promise<HTMLElement> {
  const found = (await rows()).find((row) => within(row).queryByRole('link', { name }) !== null)
  if (found === undefined) throw new Error(`the list names nobody ${name}`)
  return found
}

/** What a row says its member holds, a line a level. */
function held(row: HTMLElement): (string | null)[] {
  return within(row)
    .getAllByRole('listitem')
    .map((line) => line.textContent)
}

/** The fixture's members, with `change` made to the one whose id is `user`. */
function changed(user: string, change: Partial<Membership>): Membership[] {
  return members.map((each) => (each.user_id === user ? { ...each, ...change } : each))
}

describe('the list of members', () => {
  it('names every member in the order they joined, each with their role and what they hold', async () => {
    await membersScreen()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.title).toBe('Members · Household')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByText('Everybody’s access, visible to everybody.')).toBeInTheDocument()
    const list = await rows()
    expect(list.map((row) => within(row).getAllByRole('link')[0]?.textContent)).toEqual([
      'Jana Tilcerová (you)',
      'Petr Tilcer',
      'Adam',
      'Klára Nováková',
      'Miloš Tilcer',
    ])
    // A name leads to the member's own page, where what they hold is changed.
    expect(within(await rowOf('Petr Tilcer')).getByRole('link')).toHaveAttribute(
      'href',
      inHousehold.member(home, petr),
    )
    expect(within(await rowOf('Jana Tilcerová (you)')).getByText('Owner')).toBeInTheDocument()
    expect(within(await rowOf('Petr Tilcer')).getByText('Member')).toBeInTheDocument()
    expect(within(await rowOf('Adam')).getByText('Child profile')).toBeInTheDocument()

    // An owner holds everything, which is one line and nothing more.
    const owner = held(await rowOf('Jana Tilcerová (you)'))
    expect(owner).toHaveLength(1)
    expect(owner[0]).toMatch(/^Can set it up: Dashboard, Tasks, .* and Vehicles$/)
    expect(held(await rowOf('Petr Tilcer'))).toEqual([
      'Can set it up: Utilities',
      'Can add and edit: Shopping',
      'Can see: Dashboard and Household settings',
      'Off: 13 modules',
    ])
    expect(held(await rowOf('Adam'))).toEqual([
      'Can add and edit: Tasks, Shopping, and Chores',
      'Can see: Dashboard, Calendar, Notes, and Chat',
      'Off: 10 modules',
    ])
    // A level is never shown by the name the contract gives it.
    expect(screen.getByRole('list', { name: 'Members' })).not.toHaveTextContent(
      /\b(none|view|contribute|manage)\b/,
    )
  })

  it('gives an owner the way to the composer and the sheet that makes a child profile', async () => {
    await membersScreen()
    await rows()
    expect(screen.getByRole('link', { name: 'Invite somebody' })).toHaveAttribute(
      'href',
      inHousehold.invite(home),
    )
    expect(screen.getByRole('button', { name: 'Add a child profile' })).toBeInTheDocument()
  })

  it('is the same list to a member, with their own row said to be theirs and nothing to press', async () => {
    await membersScreen(createServer(accountOf(petr)))
    const list = await rows()
    expect(list.map((row) => within(row).getAllByRole('link')[0]?.textContent)).toEqual([
      'Jana Tilcerová',
      'Petr Tilcer (you)',
      'Adam',
      'Klára Nováková',
      'Miloš Tilcer',
    ])
    expect(held(await rowOf('Klára Nováková'))).toEqual([
      'Can add and edit: Shopping',
      'Can see: Dashboard and Chat',
      'Off: 14 modules',
    ])
    // Absence, not disabling: what an owner has here is not drawn at all.
    expect(screen.queryByRole('link', { name: 'Invite somebody' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'You can read everything here. Changing it is for an owner: Jana Tilcerová.',
      ),
    ).toBeInTheDocument()
  })

  // What `view` on household settings unlocks is the invitations: the list is every member's.
  it('is read by a member who holds nothing of household settings, who is asked for no invitations', async () => {
    const server = createServer(accountOf(klara))
    server.invitations = [invitation()]
    await membersScreen(server)
    expect(await rows()).toHaveLength(5)
    expect(within(await rowOf('Klára Nováková (you)')).getByText('Member')).toBeInTheDocument()
    expect(screen.queryByText(/waiting for an answer/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'See the invitations' })).not.toBeInTheDocument()
    expect(server.to(invitationsRoute)).toHaveLength(0)
  })

  it('is read by a child profile, with nothing to press', async () => {
    await membersScreen(createServer(accountOf(adam)))
    expect(await rows()).toHaveLength(5)
    expect(within(await rowOf('Adam (you)')).getByText('Child profile')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Invite somebody' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('reads in a read-only household, whose owner has nothing to press and is told why', async () => {
    const server = createServer()
    server.household = { ...tilcerovi, entitlement: readOnly }
    await membersScreen(server)
    expect(await rows()).toHaveLength(5)
    expect(
      screen.getByText(
        'Read-only: nothing here can be changed until the subscription resumes. Everything still reads.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Invite somebody' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    // Nor is it nudged towards what it cannot do now.
    expect(screen.queryByText('This household has one owner')).not.toBeInTheDocument()
  })

  it('says who pays for the household, on their row alone', async () => {
    await membersScreen()
    expect(
      within(await rowOf('Jana Tilcerová (you)')).getByText('Pays for the household'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Pays for the household')).toHaveLength(1)
  })

  it('says when each joined and was last active, on the day it was in the household’s zone', async () => {
    const server = createServer({ ...jana, timezone: null })
    server.household = { ...tilcerovi, timezone: 'Asia/Tokyo' }
    server.members = changed(petr, {
      joined_at: '2026-03-02T20:00:00Z',
      last_active_at: '2026-09-08T18:20:00Z',
    })
    await membersScreen(server)
    // Both are a day later in Tokyo than they are in UTC, or anywhere west of it.
    expect(
      within(await rowOf('Petr Tilcer')).getByText('Joined Mar 3, 2026 · last active Sep 9, 2026'),
    ).toBeInTheDocument()
  })

  it('says them in the member’s own zone where their account names one', async () => {
    const server = createServer({ ...jana, timezone: 'America/Los_Angeles' })
    server.members = changed(petr, {
      joined_at: '2026-03-02T03:00:00Z',
      last_active_at: '2026-09-08T18:20:00Z',
    })
    await membersScreen(server)
    expect(
      within(await rowOf('Petr Tilcer')).getByText('Joined Mar 1, 2026 · last active Sep 8, 2026'),
    ).toBeInTheDocument()
  })

  it('says of a member who has changed nothing yet that they have not been active', async () => {
    const server = createServer()
    server.members = changed(klara, { last_active_at: null })
    await membersScreen(server)
    expect(
      within(await rowOf('Klára Nováková')).getByText('Joined Mar 2, 2026 · not active yet'),
    ).toBeInTheDocument()
  })

  it('draws a member’s picture, and their initials where there is none or it does not load', async () => {
    const server = createServer()
    const address = `${origin}/files/petr`
    server.members = changed(petr, { avatar_url: address })
    await membersScreen(server)
    const row = await rowOf('Petr Tilcer')
    // Decoration: the name is written beside it.
    const picture = within(row).getByRole('presentation')
    expect(picture).toHaveAttribute('src', address)
    // A picture's link is good for minutes, and the list may be one this browser kept.
    fireEvent.error(picture)
    expect(within(row).queryByRole('presentation')).not.toBeInTheDocument()
    expect(within(row).getByText('PT')).toBeInTheDocument()
    expect(within(await rowOf('Jana Tilcerová (you)')).getByText('JT')).toBeInTheDocument()
  })
})

describe('a child profile that ten wrong PINs locked', () => {
  const locked = changed(adam, {
    child: { year_of_birth: 2014, pin_locked: true, dashboard_locked: true },
  })

  it('is said to be locked, in a word and a sentence, and leads an owner to where it is unlocked', async () => {
    const server = createServer()
    server.members = locked
    await membersScreen(server)
    const row = await rowOf('Adam')
    expect(within(row).getByText('Locked')).toBeInTheDocument()
    expect(
      within(row).getByText(
        'Ten wrong PINs locked this profile. It stays locked until an owner unlocks it or sets a new PIN.',
      ),
    ).toBeInTheDocument()
    expect(
      within(row).getByRole('link', { name: 'Open Adam’s profile to unlock it' }),
    ).toHaveAttribute('href', inHousehold.member(home, adam))
    // No other row says it.
    expect(screen.getAllByText('Locked')).toHaveLength(1)
  })

  it('is said to a member too, who is led nowhere', async () => {
    const server = createServer(accountOf(petr))
    server.members = locked
    await membersScreen(server)
    const row = await rowOf('Adam')
    expect(within(row).getByText('Locked')).toBeInTheDocument()
    expect(within(row).getAllByRole('link')).toHaveLength(1)
  })

  it('is not said of a profile that is not locked', async () => {
    await membersScreen()
    await rows()
    expect(screen.queryByText('Locked')).not.toBeInTheDocument()
  })
})

describe('the nudge of a household with one owner', () => {
  const title = 'This household has one owner'

  it('tells its owner, where an adult member could be a second, and is not announced', async () => {
    await membersScreen()
    await rows()
    const nudge = screen.getByText(title)
    expect(nudge).toBeInTheDocument()
    expect(
      screen.getByText(
        'If you ever couldn’t get into your account, nobody could look after the household. There can be several owners, and making somebody an owner doesn’t move billing. A member is made an owner from their own page.',
      ),
    ).toBeInTheDocument()
    // It was so when the screen opened: read in its place, and said to nobody as an arrival.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is not drawn where the only other member is a child profile', async () => {
    const server = createServer()
    server.members = [memberOf(jana.id), memberOf(adam)]
    await membersScreen(server)
    expect(await rows()).toHaveLength(2)
    expect(screen.queryByText(title)).not.toBeInTheDocument()
  })

  it('is not drawn where there are two owners', async () => {
    const server = createServer()
    server.members = changed(petr, { role: 'owner' })
    await membersScreen(server)
    await rows()
    expect(screen.queryByText(title)).not.toBeInTheDocument()
  })

  it('is not drawn for a member, who could not act on it', async () => {
    await membersScreen(createServer(accountOf(petr)))
    await rows()
    expect(screen.queryByText(title)).not.toBeInTheDocument()
  })
})

describe('a household of one', () => {
  it('is its member’s own row, what inviting takes, and the one way to the composer', async () => {
    const server = createServer()
    server.members = [memberOf(jana.id)]
    await membersScreen(server)
    expect(await rows()).toHaveLength(1)
    expect(await rowOf('Jana Tilcerová (you)')).toBeInTheDocument()
    expect(screen.getByText('You are the only member.')).toBeInTheDocument()
    expect(screen.getByText('Example')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Inviting somebody takes their email address and seventeen answers that are already filled in.',
      ),
    ).toBeInTheDocument()
    // One action, and it is drawn once.
    expect(screen.getAllByRole('link', { name: 'Invite somebody' })).toHaveLength(1)
    // A child profile is made from here all the same.
    expect(screen.getByRole('button', { name: 'Add a child profile' })).toBeInTheDocument()
    expect(screen.queryByText('This household has one owner')).not.toBeInTheDocument()
  })

  it('offers no way to invite where the household takes no writes', async () => {
    const server = createServer()
    server.household = { ...tilcerovi, entitlement: readOnly }
    server.members = [memberOf(jana.id)]
    await membersScreen(server)
    expect(await screen.findByText('You are the only member.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Invite somebody' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('the invitations that wait', () => {
  it('are counted for a member who may read them, with the way to them', async () => {
    const server = createServer(accountOf(petr))
    server.invitations = [
      invitation(),
      invitation({ id: '0190a000-0000-7000-8000-0000000000c2', kind: 'link', email: null }),
      invitation({ id: '0190a000-0000-7000-8000-0000000000c3', status: 'accepted' }),
      invitation({ id: '0190a000-0000-7000-8000-0000000000c4', status: 'declined' }),
    ]
    await membersScreen(server)
    expect(await screen.findByText('2 invitations are waiting for an answer.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See the invitations' })).toHaveAttribute(
      'href',
      inHousehold.invitations(home),
    )
  })

  it('are counted in the singular where one waits', async () => {
    const server = createServer()
    server.invitations = [invitation()]
    await membersScreen(server)
    expect(await screen.findByText('1 invitation is waiting for an answer.')).toBeInTheDocument()
  })

  it('are not spoken of where none waits, or where they could not be read', async () => {
    const server = createServer()
    server.invitations = [invitation({ status: 'revoked' }), invitation({ status: 'expired' })]
    const first = await membersScreen(server)
    await rows()
    expect(server.to(invitationsRoute)).toHaveLength(1)
    expect(screen.queryByText(/waiting for an answer/)).not.toBeInTheDocument()
    first.unmount()

    const unread = createServer()
    unread.on(invitationsRoute, () => Promise.reject(new TypeError('offline')))
    await membersScreen(unread)
    expect(await rows()).toHaveLength(5)
    expect(screen.queryByText(/waiting for an answer/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'See the invitations' })).not.toBeInTheDocument()
  })

  it('are not counted past their time, though this browser read them as waiting', async () => {
    const server = createServer()
    server.invitations = [
      invitation(),
      invitation({
        id: '0190a000-0000-7000-8000-0000000000c2',
        email: 'stryc@example.cz',
        expires_at: '2020-01-10T12:00:00Z',
      }),
    ]
    await membersScreen(server)
    expect(await screen.findByText('1 invitation is waiting for an answer.')).toBeInTheDocument()
  })

  // What this browser kept of them is a member's who could read them. Their level lowered to
  // nothing, they are told of none, and led to no screen that would open nothing.
  it('are spoken of no longer once the member may not read them', async () => {
    const server = createServer(accountOf(petr))
    server.invitations = [invitation()]
    await membersScreen(server)
    expect(await screen.findByText('1 invitation is waiting for an answer.')).toBeInTheDocument()

    server.household = {
      ...server.household,
      my_grants: { ...memberOf(petr).grants, admin: 'none' },
    }
    server.on(invitationsRoute, () => problem(404, 'not_found'))
    act(() => {
      focusManager.setFocused(true)
    })
    await waitFor(() => {
      expect(screen.queryByText(/waiting for an answer/)).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('link', { name: 'See the invitations' })).not.toBeInTheDocument()
  })
})

describe('an owner made a member while the members are open', () => {
  it('loses the controls when the household is read again, and the focus one of them held stays on the list', async () => {
    const server = createServer()
    await membersScreen(server)
    const control = await screen.findByRole('button', { name: 'Add a child profile' })
    act(() => {
      control.focus()
    })
    // Made a member by another owner: the page is looked at again, and reads it.
    server.household = readBy({ ...memberOf(jana.id), role: 'member' })
    act(() => {
      focusManager.setFocused(true)
    })
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(screen.getByRole('list', { name: 'Members' }))
  })
})

describe('the list of members, as it is read', () => {
  it('is a skeleton until it is read, with nothing to press meanwhile', async () => {
    const server = createServer()
    let answer: (response: Response) => void = () => undefined
    server.on(
      membersRoute,
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    )
    await membersScreen(server)
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    answer(Response.json({ items: server.members }))
    expect(await rows()).toHaveLength(5)
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a child profile' })).toBeInTheDocument()
  })

  it('says the list did not load and that nobody’s access changed, and reads it again', async () => {
    const server = createServer()
    server.on(membersRoute, () => Promise.reject(new TypeError('offline')))
    const { user } = await membersScreen(server)
    // It arrived while the member was here, a skeleton before it: it is said as it arrives.
    const failure = await screen.findByRole('alert')
    expect(failure).toHaveTextContent('The member list did not load')
    expect(failure).toHaveTextContent('Nobody’s access has changed.')
    server.on(membersRoute, () => Response.json({ items: server.members }))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await rows()).toHaveLength(5)
  })

  it('says the list could not be read while the browser has no connection to read it with', async () => {
    const server = createServer()
    // The household is read, and the connection goes before its members are: once, since the
    // household is read again when the connection is back.
    let read = false
    server.on(`GET /households/${home}`, () => {
      if (!read) onlineManager.setOnline(false)
      read = true
      return Response.json(server.household)
    })
    await membersScreen(server)
    // Asked for with no connection, the read waits for one: no skeleton stands for it meanwhile.
    expect(await screen.findByText('The member list did not load')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    // It was so when the screen opened: read in its place, and not said as an arrival.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(server.to(membersRoute)).toHaveLength(0)
    act(() => {
      onlineManager.setOnline(true)
    })
    expect(await rows()).toHaveLength(5)
  })

  // That a change needs a connection is the shell's bar's to say (shell/HouseholdBars.tsx).
  it('is drawn as this browser kept it when the connection goes', async () => {
    await membersScreen()
    expect(await rows()).toHaveLength(5)
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(await rows()).toHaveLength(5)
    expect(screen.queryByText('The member list did not load')).not.toBeInTheDocument()
  })
})
