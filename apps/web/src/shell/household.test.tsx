import { focusManager } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
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

// A test that says the page is looked at again leaves the next one a page nobody has looked at.
afterEach(() => {
  focusManager.setFocused(undefined)
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
  /** The households the member is in. */
  readonly memberships?: readonly string[]
  /** Answers a household's own address: left out, what `known` holds, else not found. */
  readonly household?: (id: string) => Response
}

/** The app at `address`, signed in, over a server of the test's, and what the server was asked. */
function open(address: string, { memberships = [home, cottage], household: answer }: Server = {}) {
  const asked: string[] = []
  const client = createWebClient({
    origin,
    cookies: () => `${csrfCookie}=t`,
    retry: { delays: [], sleep: () => Promise.resolve() },
    fetch: (request) => {
      const path = new URL(request.url).pathname.replace('/api/v1', '')
      asked.push(path)
      if (path === '/me') return Promise.resolve(Response.json(me))
      if (path === '/households') {
        return Promise.resolve(
          Response.json({
            items: memberships.map((id) => ({
              id,
              name: known[id]?.name,
              my_role: 'owner',
              entitlement: { state: 'trialing' },
            })),
          }),
        )
      }
      const id = /^\/households\/([^/]+)$/.exec(path)?.[1]
      if (id !== undefined) {
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
    // No module has a screen in this build yet, so none is listed, though several are held.
    expect(within(navigation).queryByText('Shopping')).not.toBeInTheDocument()
    expect(within(navigation).queryByText('Household settings')).not.toBeInTheDocument()
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

  it('is their first household where they were in none here, or are in that one no longer', async () => {
    rememberHousehold(me.id, '01900000-0000-7000-8000-0000000000ff')
    const { router } = open(paths.home.path)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(home))
    })
  })

  it('is their account for a member who is in no household', async () => {
    const { router } = open(paths.home.path, { memberships: [] })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(paths.account.path)
    })
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

  it('names no household that is not this member’s', async () => {
    // Left there by someone who was signed in here before.
    window.sessionStorage.setItem('household.tab', '01900000-0000-7000-8000-0000000000ff')
    open(inHousehold.home(home))
    await screen.findByRole('heading', { level: 1, name: 'Home' })
    expect(screen.queryByText('Switched household to open this link.')).not.toBeInTheDocument()
  })
})

describe('what stands above a household’s screens', () => {
  function bars(sync: Sync) {
    return draw(
      <SyncFixture value={sync}>
        <HouseholdContext value={known[home] ?? household(home, 'Tilcerovi')}>
          <HouseholdBars />
        </HouseholdContext>
      </SyncFixture>,
    )
  }
  const replica = { phase: 'opening' } as const

  it('is nothing while the browser is online and the household’s changes arrive', () => {
    bars({ replica, online: true, receiving: true })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // Nor while it is not yet known whether they do.
    bars({ replica, online: true, receiving: null })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('is the offline bar with no connection', async () => {
    bars({ replica, online: false, receiving: false })
    expect(await screen.findByText('Offline — changes are saved and will sync')).toBeInTheDocument()
  })

  it('says the household’s changes are not arriving, with the browser online (D-105)', async () => {
    bars({ replica, online: true, receiving: false })
    expect(await screen.findByText(/^Not receiving changes from other members/)).toBeInTheDocument()
  })
})
