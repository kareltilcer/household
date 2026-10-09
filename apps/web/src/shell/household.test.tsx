import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebClient } from '../api/client.ts'
import { csrfCookie } from '../api/names.ts'
import { Providers } from '../app/App.tsx'
import { inHousehold, paths } from '../app/paths.ts'
import { routes } from '../app/routes.tsx'
import { HouseholdContext } from '../household/HouseholdContext.tsx'
import { lastHousehold, rememberHousehold, type Household } from '../household/households.ts'
import { SyncFixture, type Sync } from '../sync/ReplicaProvider.tsx'
import { draw } from '../test/render.tsx'
import { HouseholdBars } from './HouseholdBars.tsx'

const origin = 'https://household.example'

// A test that says the page is looked at again leaves the next one a page nobody has looked at,
// and one that takes the connection away leaves the next one a browser that has it.
afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})
const me = {
  id: '01900000-0000-7000-8000-00000000d0e5',
  email: 'jana@example.test',
  email_verified: true,
  display_name: 'Jana',
  locale: 'en',
}
const home = '01900000-0000-7000-8000-0000000000a1'
const cottage = '01900000-0000-7000-8000-0000000000a2'

function household(id: string, name: string): Household {
  return {
    id,
    name,
    country: 'CZ',
    timezone: 'Europe/Prague',
    base_currency: 'CZK',
    locale: 'cs',
    my_role: 'owner',
    my_grants: { dashboard: 'view', admin: 'manage', shopping: 'contribute' },
    entitlement: { state: 'trialing', can_write: true },
  }
}

const known: Readonly<Record<string, Household>> = {
  [home]: household(home, 'Tilcerovi'),
  [cottage]: household(cottage, 'Chata'),
}

function notFound(): Response {
  return Response.json(
    { type: 'about:blank', title: 'not found', status: 404, code: 'not_found' },
    { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
  )
}

interface Server {
  /** The households the member is in: read as each request is answered, so a test may change them. */
  readonly memberships?: readonly string[]
  /**
   * Those of them the platform suspended: the list still names each, with its state, when it was
   * suspended and the notice that went with it, and its own address is not found (D-115). Read
   * as each request is answered too.
   */
  readonly suspended?: readonly string[]
  /** Answers a household's own address: left out, what `known` holds, else not found. */
  readonly household?: (id: string) => Response
  /** Answers the list of the member's households: left out, `memberships` as the server lists them. */
  readonly households?: () => Response | undefined
  /** Told of each request as it is asked, before it is answered. */
  readonly asking?: (path: string) => void
}

/** What the platform told a suspended household of why: its own words, shown as written. */
const notice = 'We were told of files here that break our terms, and are looking at them.'

/**
 * Takes the browser's connection away as the account is read: what the screen that follows
 * reads is then asked for with none, and waits for one.
 */
function offlineOnceKnown(path: string): void {
  if (path === '/me') onlineManager.setOnline(false)
}

/** The app at `address`, signed in, over a server of the test's, and what the server was asked. */
function open(
  address: string,
  {
    memberships = [home, cottage],
    suspended = [],
    household: answer,
    households,
    asking,
  }: Server = {},
) {
  const asked: string[] = []
  const client = createWebClient({
    origin,
    cookies: () => `${csrfCookie}=t`,
    retry: { delays: [], sleep: () => Promise.resolve() },
    fetch: (request) => {
      const path = new URL(request.url).pathname.replace('/api/v1', '')
      asked.push(path)
      asking?.(path)
      if (path === '/me') return Promise.resolve(Response.json(me))
      if (path === '/households') {
        return Promise.resolve(
          households?.() ??
            Response.json({
              items: memberships.map((id) => ({
                id,
                name: known[id]?.name,
                my_role: 'owner',
                entitlement: suspended.includes(id)
                  ? {
                      state: 'suspended',
                      suspended_at: '2026-09-09T12:02:00Z',
                      suspension_notice: notice,
                    }
                  : { state: 'trialing' },
              })),
            }),
        )
      }
      const id = /^\/households\/([^/]+)$/.exec(path)?.[1]
      if (id !== undefined) {
        if (suspended.includes(id)) return Promise.resolve(notFound())
        if (answer !== undefined) return Promise.resolve(answer(id))
        const found = known[id]
        return Promise.resolve(found === undefined ? notFound() : Response.json(found))
      }
      return Promise.resolve(notFound())
    },
  })
  const router = createMemoryRouter(routes, { initialEntries: [address] })
  render(
    <Providers persist={false} client={client} cookies={() => `${csrfCookie}=t`}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return { router, asked }
}

describe('a household’s shell', () => {
  it('draws the household the address names: its name, its navigation, and one landmark', async () => {
    open(inHousehold.home(home))
    // The first screen this file draws loads the shell's own files, which on a machine with
    // other work takes longer than the second a find waits by itself.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Home' }, { timeout: 4000 }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    // The household is stated on every screen: in the bar, and at the head of the sidebar.
    expect(screen.getByRole('banner')).toHaveTextContent('Tilcerovi')
    const navigation = screen.getByRole('navigation', { name: 'Household' })
    expect(within(navigation).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // Of the modules the member holds, the ones this build has screens for are listed:
    // household settings, and not Shopping, which has none yet.
    expect(within(navigation).queryByText('Shopping')).not.toBeInTheDocument()
    expect(within(navigation).getByRole('link', { name: 'Household settings' })).toHaveAttribute(
      'href',
      inHousehold.settings(home),
    )
    // The first thing the keyboard reaches skips past the bar and the navigation.
    const skip = screen.getByRole('link', { name: 'Skip to the content' })
    expect(skip).toHaveAttribute('href', '#content')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'content')
  })

  it('remembers the household for the next visit, for this member', async () => {
    open(inHousehold.home(cottage))
    await screen.findByRole('heading', { level: 1, name: 'Home' })
    await waitFor(() => {
      expect(lastHousehold(me.id)).toBe(cottage)
    })
  })

  it('opens nothing, and says no more, for a household the member is not in', async () => {
    const stranger = '01900000-0000-7000-8000-0000000000ff'
    open(inHousehold.home(stranger))
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This link doesn’t open anything here.',
      }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    // Nothing of a household is drawn around it: not its name, not a list of modules.
    expect(screen.queryByRole('navigation', { name: 'Household' })).not.toBeInTheDocument()
    expect(lastHousehold(me.id)).toBeNull()
  })

  it('opens nothing for a household the member was taken out of, whatever this browser kept of it', async () => {
    const memberships = [home, cottage]
    let member = true
    const { router } = open(inHousehold.home(home), {
      memberships,
      household: (id) => {
        const found = known[id]
        return found === undefined || (id === home && !member) ? notFound() : Response.json(found)
      },
    })
    await screen.findByRole('navigation', { name: 'Household' })
    await waitFor(() => {
      expect(lastHousehold(me.id)).toBe(home)
    })
    // Taken out of it since: the page is looked at again, and what it shows is read again.
    member = false
    memberships.splice(0, 1)
    act(() => {
      focusManager.setFocused(true)
    })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This link doesn’t open anything here.',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Household' })).not.toBeInTheDocument()
    expect(screen.getByRole('banner')).not.toHaveTextContent('Tilcerovi')
    // The way out leads to a household they are in, and not back by the list this browser kept.
    await userEvent.click(screen.getByRole('link', { name: 'Go to Home' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(cottage))
    })
    await waitFor(() => {
      expect(screen.getByRole('banner')).toHaveTextContent('Chata')
    })
  })

  it('does not ask the server for an address that names no household at all', async () => {
    const { asked } = open('/households/not-an-id/sync')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This link doesn’t open anything here.',
      }),
    ).toBeInTheDocument()
    expect(asked.filter((path) => path.startsWith('/households/'))).toEqual([])
  })

  it('says a household could not be read, and reads it again when asked', async () => {
    let down = true
    open(inHousehold.home(home), {
      household: (id) =>
        down
          ? Response.json(
              { type: 'about:blank', title: 'down', status: 503, code: 'internal' },
              { status: 503, headers: { 'Content-Type': 'application/problem+json' } },
            )
          : Response.json(known[id]),
    })
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'This household could not be read' },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument()
    down = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
  }, 20_000)

  it('says a household could not be read while the browser has no connection to read it with', async () => {
    open(inHousehold.home(home), { asking: offlineOnceKnown })
    // Asked for with no connection, the read waits for one: no skeleton stands for it meanwhile.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This household could not be read' }),
    ).toBeInTheDocument()
    act(() => {
      onlineManager.setOnline(true)
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
  })

  it('says the member’s other households could not be read while the browser has no connection to read them with', async () => {
    // The household is read, and the connection goes before the list of the member's others is:
    // once, since the household is read again when the connection is back.
    let read = false
    open(inHousehold.home(home), {
      asking: (path) => {
        if (read || path !== `/households/${home}`) return
        read = true
        onlineManager.setOnline(false)
      },
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
    // Asked for with no connection, the read waits for one: the switcher is no label of a
    // member in this household alone meanwhile.
    expect(screen.getByText('We couldn’t load your other households.')).toBeInTheDocument()
    act(() => {
      onlineManager.setOnline(true)
    })
    expect(
      await screen.findByRole('button', { name: 'Switch household. Currently Tilcerovi' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('We couldn’t load your other households.')).not.toBeInTheDocument()
  })

  it('opens any other address under a household on nothing, with the way back to its home', async () => {
    open(`${inHousehold.home(home)}/no-such-page`)
    await screen.findByRole('heading', { level: 1, name: 'This link doesn’t open anything here.' })
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute(
      'href',
      inHousehold.home(home),
    )
    // A module the member holds, which this build has no screen for, opens the same.
    open(inHousehold.module(home, 'shopping'))
    expect(
      (await screen.findAllByRole('heading', { level: 1, name: /doesn’t open anything/ })).length,
    ).toBeGreaterThan(0)
  })

  it('leads from a module’s name to where the module opens, for one this build has screens for', async () => {
    const { router } = open(inHousehold.module(home, 'admin'))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.settings(home))
    })
  })

  it('is a panel opened from the bar where the window is too narrow for a sidebar', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('width <'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    open(inHousehold.home(home))
    await screen.findByRole('heading', { level: 1, name: 'Home' })
    expect(screen.queryByRole('navigation', { name: 'Household' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const navigation = await screen.findByRole('navigation', { name: 'Household' })
    expect(within(navigation).getByRole('link', { name: 'Your account' })).toBeInTheDocument()
  })
})

describe('where the app opens', () => {
  it('is the household the member was last in on this browser', async () => {
    rememberHousehold(me.id, cottage)
    const { router } = open(paths.home.path)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(cottage))
    })
  })

  it('says the households could not be read while the browser has no connection, and opens once it has', async () => {
    const { router } = open(paths.home.path, { asking: offlineOnceKnown })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your households could not be read' }),
    ).toBeInTheDocument()
    act(() => {
      onlineManager.setOnline(true)
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(home))
    })
  })

  it('is their first household where they were in none here, or are in that one no longer', async () => {
    rememberHousehold(me.id, '01900000-0000-7000-8000-0000000000ff')
    const { router } = open(paths.home.path)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(home))
    })
  })

  // The first thing a new account does (DD-6): the screen that makes a household, which says
  // of an invitation that waits for them too.
  it('is making a household for a member who is in none', async () => {
    const { router } = open(paths.home.path, { memberships: [] })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(paths.householdNew.path)
    })
  })

  it('is a household that opens, where the one they were last in has been suspended since', async () => {
    rememberHousehold(me.id, cottage)
    const { router } = open(paths.home.path, { suspended: [cottage] })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(home))
    })
  })

  it('is the first household that opens, where their first is suspended', async () => {
    const { router } = open(paths.home.path, { suspended: [home] })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(cottage))
    })
  })

  it('leads from a suspended household’s address, by where the app opens, to one that opens', async () => {
    rememberHousehold(me.id, cottage)
    const { router } = open(inHousehold.home(cottage), { suspended: [cottage] })
    await screen.findByRole('heading', { level: 1, name: 'Chata is suspended' })
    // The shell's own way to where the app opens passes over the household it stands at.
    await userEvent.click(screen.getByRole('link', { name: 'Home' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(home))
    })
    await waitFor(() => {
      expect(screen.getByRole('banner')).toHaveTextContent('Tilcerovi')
    })
  })

  it('is the suspended household’s own address for a member in no other: where its lockout stands', async () => {
    const { router } = open(paths.home.path, { memberships: [cottage], suspended: [cottage] })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(cottage))
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Chata is suspended' }),
    ).toBeInTheDocument()
  })
})

// A-31 (DD-15, D-115): every route of a suspended household answers `404`, and the member's own
// list of households still names it. Where the two meet, the lockout stands in the place of
// *not available*.
describe('a suspended household’s lockout', () => {
  const title = 'Chata is suspended'

  it('says whose it is, since when, the notice itself, what was kept and whom it was told to', async () => {
    open(inHousehold.home(cottage), { suspended: [cottage] })
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    const page = screen.getByRole('main')
    expect(within(page).getByText('Household suspended it on Sep 9, 2026.')).toBeInTheDocument()
    // The platform's own words to the household, as written, under what they are.
    expect(within(page).getByText('What its owners were told')).toBeInTheDocument()
    expect(within(page).getByText(notice)).toBeInTheDocument()
    expect(
      within(page).getByText(
        'Nothing in it was deleted. While it is suspended, nobody can open it and nothing can be exported.',
      ),
    ).toBeInTheDocument()
    expect(
      within(page).getByText(
        'Each owner was told by email. An owner who thinks it is a mistake contacts Household support.',
      ),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    await waitFor(() => {
      expect(document.title).toBe(`${title} · Household`)
    })
  })

  it('draws nothing of the household: no navigation of it, no bar, no banner, and no way to export', async () => {
    open(inHousehold.settings(cottage), { suspended: [cottage] })
    await screen.findByRole('heading', { level: 1, name: title })
    expect(screen.queryByRole('navigation', { name: 'Household' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Household settings' })).not.toBeInTheDocument()
    // The bar names the app, and no household.
    expect(screen.getByRole('banner')).not.toHaveTextContent('Chata')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // Export is said to be unavailable, and offered by no control that could only fail (DD-15).
    const page = screen.getByRole('main')
    expect(within(page).queryByRole('link', { name: /export/i })).not.toBeInTheDocument()
    expect(within(page).queryByRole('button', { name: /export/i })).not.toBeInTheDocument()
    expect(lastHousehold(me.id)).toBeNull()
  })

  it('leads to another household of the member’s, and lets them sign out', async () => {
    const { router } = open(inHousehold.home(cottage), { suspended: [cottage] })
    await screen.findByRole('heading', { level: 1, name: title })
    const page = screen.getByRole('main')
    expect(within(page).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    await userEvent.click(within(page).getByRole('link', { name: 'Go to Tilcerovi' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(home))
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
    // The member chose it themselves: nothing is said of a switch.
    expect(screen.queryByText('Switched household to open this link.')).not.toBeInTheDocument()
  })

  it('offers a member in no other household that opens the way out alone', async () => {
    open(inHousehold.home(cottage), { suspended: [home, cottage] })
    await screen.findByRole('heading', { level: 1, name: title })
    const page = screen.getByRole('main')
    expect(within(page).queryByRole('link')).not.toBeInTheDocument()
    expect(within(page).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  // What this browser kept of the member's households may be older than the suspension: it is
  // read again once the address is not found, and only that answer says which screen stands.
  it('reads the member’s households again before it says which it is', async () => {
    const suspended: string[] = []
    const { router, asked } = open(inHousehold.home(home), { suspended })
    await screen.findByRole('button', { name: 'Switch household. Currently Tilcerovi' })
    // The list was read, and named the household as one that opens. It is suspended since.
    suspended.push(cottage)
    const before = asked.length
    await act(() => router.navigate(inHousehold.home(cottage)))
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    const since = asked.slice(before)
    expect(since.indexOf('/households')).toBeGreaterThan(since.indexOf(`/households/${cottage}`))
    expect(
      screen.queryByRole('heading', { name: 'This link doesn’t open anything here.' }),
    ).not.toBeInTheDocument()
  })

  it('opens the household once the suspension is lifted and the page is looked at again', async () => {
    const suspended = [cottage]
    open(inHousehold.home(cottage), { suspended })
    await screen.findByRole('heading', { level: 1, name: title })
    suspended.splice(0, 1)
    act(() => {
      focusManager.setFocused(true)
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toHaveTextContent('Chata')
  })

  it('says the households could not be read where they were not, and draws the lockout once they are', async () => {
    let down = true
    open(inHousehold.home(cottage), {
      suspended: [cottage],
      households: () =>
        down
          ? Response.json(
              { type: 'about:blank', title: 'down', status: 503, code: 'internal' },
              { status: 503, headers: { 'Content-Type': 'application/problem+json' } },
            )
          : undefined,
    })
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Your households could not be read' },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument()
    // Neither screen is drawn on a guess.
    expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'This link doesn’t open anything here.' }),
    ).not.toBeInTheDocument()
    down = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
  }, 20_000)

  it('is not drawn for a household the member is simply not in', async () => {
    open(inHousehold.home('01900000-0000-7000-8000-0000000000ff'), { suspended: [cottage] })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This link doesn’t open anything here.',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText(notice)).not.toBeInTheDocument()
  })
})

describe('a link that opened another household than the tab was in', () => {
  it('says the household was switched, and offers the way back', async () => {
    window.sessionStorage.setItem('household.tab', home)
    open(inHousehold.home(cottage))
    expect(await screen.findByText('Switched household to open this link.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Tilcerovi' })).toHaveAttribute(
      'href',
      inHousehold.home(home),
    )
  })

  it('says nothing of the first household a tab opens, nor of one that is opened again', async () => {
    open(inHousehold.home(home))
    await screen.findByRole('heading', { level: 1, name: 'Home' })
    await waitFor(() => {
      expect(window.sessionStorage.getItem('household.tab')).toBe(home)
    })
    expect(screen.queryByText('Switched household to open this link.')).not.toBeInTheDocument()
  })

  it('offers no way back to a household the platform has suspended since', async () => {
    window.sessionStorage.setItem('household.tab', cottage)
    const { asked } = open(inHousehold.home(home), { suspended: [cottage] })
    // The list names it still, with its state, and its own address opens nothing (D-115).
    expect(
      await screen.findByRole('button', { name: 'Switch household. Currently Tilcerovi' }),
    ).toBeInTheDocument()
    expect(asked).toContain('/households')
    // No banner at all: one that is announced is drawn before its words, its control with it.
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    expect(screen.queryByText('Switched household to open this link.')).not.toBeInTheDocument()
  })

  it('names no household that is not this member’s', async () => {
    // Left there by someone who was signed in here before.
    window.sessionStorage.setItem('household.tab', '01900000-0000-7000-8000-0000000000ff')
    open(inHousehold.home(home))
    await screen.findByRole('heading', { level: 1, name: 'Home' })
    expect(screen.queryByText('Switched household to open this link.')).not.toBeInTheDocument()
  })
})

describe('what stands above a household’s screens', () => {
  /** The bars over the screen at `address`: the household's Home unless a test names another. */
  function bars(sync: Sync, address: string = inHousehold.home(home)) {
    return draw(
      <MemoryRouter initialEntries={[address]}>
        <SyncFixture value={sync}>
          <HouseholdContext value={known[home] ?? household(home, 'Tilcerovi')}>
            <HouseholdBars />
          </HouseholdContext>
        </SyncFixture>
      </MemoryRouter>,
    )
  }
  const replica = { phase: 'opening' } as const
  const saved = 'Offline — changes are saved and will sync'
  const needed =
    'Offline — you are reading what this browser kept. Changing anything here needs a connection.'

  it('is nothing while the browser is online and the household’s changes arrive', () => {
    bars({ replica, online: true, receiving: true })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // Nor while it is not yet known whether they do.
    bars({ replica, online: true, receiving: null })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('is the offline bar with no connection', async () => {
    bars({ replica, online: false, receiving: false })
    expect(await screen.findByText(saved)).toBeInTheDocument()
  })

  // The household's settings and leaving it are changed on the server or not at all (D-170):
  // nothing pressed there is saved to be sent later, and the bar does not say that it is.
  it.each([
    ['the household’s profile', inHousehold.settings(home)],
    ['its members', inHousehold.members(home)],
    ['one member’s page', inHousehold.member(home, me.id)],
    ['the invitation composer', inHousehold.invite(home)],
    ['its modules', inHousehold.modules(home)],
    ['leaving', inHousehold.leave(home)],
    // The address names the household as it was typed, in whatever case.
    ['an address that names the household in capitals', inHousehold.members(home.toUpperCase())],
  ])('says with no connection that a change needs one, over %s', async (_screen, address) => {
    bars({ replica, online: false, receiving: false }, address)
    expect(await screen.findByText(needed)).toBeInTheDocument()
    expect(screen.queryByText(saved)).not.toBeInTheDocument()
  })

  it.each([
    ['Home', inHousehold.home(home)],
    ['a module', inHousehold.module(home, 'shopping')],
    ['arranging', inHousehold.arrange(home)],
    // An address that only begins as the settings' does is none of them.
    ['an address that begins like the settings’', `${inHousehold.settings(home)}-of-another`],
  ])('says with no connection that changes are saved, over %s', async (_screen, address) => {
    bars({ replica, online: false, receiving: false }, address)
    expect(await screen.findByText(saved)).toBeInTheDocument()
    expect(screen.queryByText(needed)).not.toBeInTheDocument()
  })

  // One bar, whose words change where they stand as its member goes from one screen to another.
  it('is the same bar across the two, its sentence changed in place', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <SyncFixture value={{ replica, online: false, receiving: false }}>
              <HouseholdContext value={known[home] ?? household(home, 'Tilcerovi')}>
                <HouseholdBars />
              </HouseholdContext>
            </SyncFixture>
          ),
        },
      ],
      { initialEntries: [inHousehold.home(home)] },
    )
    draw(<RouterProvider router={router} />)
    const bar = await screen.findByRole('status')
    await waitFor(() => {
      expect(bar).toHaveTextContent(saved)
    })
    await act(() => router.navigate(inHousehold.members(home)))
    expect(bar).toBeInTheDocument()
    expect(bar).toHaveTextContent(needed)
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('says the household’s changes are not arriving, with the browser online (D-105)', async () => {
    bars({ replica, online: true, receiving: false })
    expect(await screen.findByText(/^Not receiving changes from other members/)).toBeInTheDocument()
  })
})
