import type { Replica } from '@household/sync'
import {
  focusManager,
  onlineManager,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebClient } from '../api/client.ts'
import { Providers } from '../app/App.tsx'
import { inHousehold, paths } from '../app/paths.ts'
import { routes } from '../app/routes.tsx'
import { HouseholdContext } from '../household/HouseholdContext.tsx'
import {
  householdKey,
  lastHousehold,
  rememberHousehold,
  type Household,
} from '../household/households.ts'
import { openHouseholdReplica, type Opened } from '../sync/open.ts'
import { SyncFixture, type Sync } from '../sync/ReplicaProvider.tsx'
import { home, household, me, notFound, signedIn } from '../test/member.ts'
import { draw, loaded } from '../test/render.tsx'
import { HouseholdBars } from './HouseholdBars.tsx'

// The file that opens a replica, with the sync library and its SDK behind it, is no part of
// these tests: what the shell asks it to open is counted, in a browser that has what a replica
// needs (`withReplicas`). jsdom has none of it, and every other test here opens none.
vi.mock('../sync/open.ts', () => ({ openHouseholdReplica: vi.fn() }))

const origin = 'https://household.example'

// A test that says the page is looked at again leaves the next one a page nobody has looked at,
// one that takes the connection away leaves the next one a browser that has it, and one that
// gave the browser its locks leaves the next one jsdom's, which has none.
afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
  Reflect.deleteProperty(window.navigator, 'locks')
})
const cottage = '01900000-0000-7000-8000-0000000000a2'

const known: Readonly<Record<string, Household>> = {
  [home]: household(home, 'Tilcerovi'),
  [cottage]: household(cottage, 'Chata'),
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
  /**
   * Whether the server cannot be reached, asked as each request leaves: one that then leaves
   * gets no answer, whatever it asks for.
   */
  readonly away?: () => boolean
}

/** Hands `to` the page's own query client, which holds what the page read as the page holds it. */
function Reads({ to }: { readonly to: (queries: QueryClient) => void }) {
  const queries = useQueryClient()
  useEffect(() => {
    to(queries)
  }, [queries, to])
  return null
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
    away,
  }: Server = {},
) {
  const asked: string[] = []
  const client = createWebClient({
    origin,
    cookies: signedIn,
    retry: { delays: [], sleep: () => Promise.resolve() },
    fetch: (request) => {
      const path = new URL(request.url).pathname.replace('/api/v1', '')
      asked.push(path)
      asking?.(path)
      if (away?.() === true) return Promise.reject(new TypeError('offline'))
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
  const held: QueryClient[] = []
  render(
    <Providers persist={false} client={client} cookies={signedIn}>
      <Reads
        to={(queries) => {
          held.push(queries)
        }}
      />
      <RouterProvider router={router} />
    </Providers>,
  )
  const reads = (): QueryClient => {
    const [queries] = held
    if (queries === undefined) throw new Error('the page has not been drawn yet')
    return queries
  }
  return { router, asked, reads }
}

type Page = Pick<ReturnType<typeof open>, 'asked' | 'reads'>

/**
 * Does `doing`, which has `id`'s own address asked for, and waits until that has been answered,
 * or has got no answer, and whoever reads it has been told: the query client tells its readers
 * a turn after it holds an answer. What is drawn then is what the answer came to, so a test may
 * say what is not drawn.
 */
async function asksAgain({ asked, reads }: Page, id: string, doing: () => unknown): Promise<void> {
  const asks = () => asked.filter((path) => path === `/households/${id}`).length
  const before = asks()
  // Drawn before the wait begins: a shell that `doing` opens asks as it is drawn.
  await act(async () => {
    await doing()
  })
  await act(async () => {
    await vi.waitFor(() => {
      expect(asks()).toBeGreaterThan(before)
      expect(reads().isFetching({ queryKey: householdKey(id), exact: true })).toBe(0)
    })
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  })
}

/** Says the page is looked at again, which has what it shows read again (`asksAgain`). */
function lookAgain(page: Page, id: string): Promise<void> {
  return asksAgain(page, id, () => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
}

/** A replica as far as the shell reads one: connected, with nothing that needs its member. */
const replica: Opened = {
  replica: {
    db: { currentStatus: { connected: true }, registerListener: () => () => undefined },
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    resume: () => undefined,
  } as unknown as Replica,
  needsConnection: () => false,
  watchInbox: (listener) => {
    listener([])
    return () => undefined
  },
}

/**
 * Gives the browser what a replica needs, which jsdom has none of: its storage, its workers, and
 * Web Locks that are this tab's for the asking. It answers with what says the households whose
 * replica the shell has opened since, one for each opening. A replica is opened some turns
 * after the shell that keeps it is drawn, its lock taken as it is drawn and the file that opens
 * it imported then: what is said waits until every lock taken has come to its opening.
 */
function withReplicas(): () => Promise<string[]> {
  let taken = 0
  Object.defineProperty(window.navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, _options: unknown, hold: (lock: object) => Promise<unknown>) => {
        taken += 1
        return hold({})
      },
    },
  })
  vi.stubGlobal('Worker', () => undefined)
  vi.stubGlobal('indexedDB', {})
  const opens = vi.mocked(openHouseholdReplica)
  opens.mockImplementation(() => Promise.resolve(replica))
  return async () => {
    await waitFor(() => {
      expect(opens.mock.calls).toHaveLength(taken)
    })
    return opens.mock.calls.map(([options]) => options.household)
  }
}

// The router draws nothing of a shell until every file its address names has come, the shell's
// own *not available* neither: the shape of a page stands in its place meanwhile
// (app/routes.tsx). The first test's wait is long enough for the shell's own files. A test that
// is the first here to open another screen with as many files behind it, the inbox or a page of
// the settings, loads them before it opens it (`loaded`, test/render.tsx), and waits for what is
// drawn and no more.
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
    // The address names the inbox, which no test before this one opened: what stands in a
    // household's place is drawn once the inbox's file has come, as the inbox would be.
    const address = '/households/not-an-id/sync'
    await loaded(routes, address)
    const { asked } = open(address)
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
    // Where it leads is the household's profile, which no test before this one opened.
    await loaded(routes, inHousehold.settings(home))
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
        // An email reaches a verified address alone: no other owner is said to have been told.
        'Each owner with a verified address was told by email. An owner who thinks it is a mistake contacts Household support.',
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

  // The household is asked for again each time the page is looked at, with nothing kept of it:
  // the lockout stands through the asking, the focus on it kept, and is not taken down and
  // built again around a skeleton, nor the member's households read anew at each look.
  it('stands, with the focus on it, while the household is asked for again', async () => {
    const { asked } = open(inHousehold.home(cottage), { suspended: [cottage] })
    await screen.findByRole('heading', { level: 1, name: title })
    const out = within(screen.getByRole('main')).getByRole('button', { name: 'Sign out' })
    out.focus()
    const lists = () => asked.filter((path) => path === '/households').length
    const before = { lists: lists(), all: asked.length }
    act(() => {
      focusManager.setFocused(true)
    })
    await waitFor(() => {
      expect(asked.slice(before.all)).toContain(`/households/${cottage}`)
    })
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    // The very control, and the focus still on it.
    expect(within(screen.getByRole('main')).getByRole('button', { name: 'Sign out' })).toBe(out)
    expect(out).toHaveFocus()
    // The list is read again as any list is when the page is looked at, once, and by no reset.
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    })
    expect(lists() - before.lists).toBeLessThanOrEqual(1)
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

// The server's *not found* is its last word of a household until it answers otherwise. The query
// client keeps the last answer it was given through a failure, so a household read while it was
// its member's, then answered `404`, then asked for again of a server that gave no answer, was
// left with the kept answer and nothing over it: drawn again as its member's, its replica
// opened. A re-read that got no answer has said nothing of the household.
describe('a household the server said is not found, asked for again of a server that gives no answer', () => {
  const absent = 'This link doesn’t open anything here.'
  const unread = 'This household could not be read'

  it('stays not available, whatever this browser kept of it, and opens its replica once more only when the server says it is there', async () => {
    const opened = withReplicas()
    const memberships = [home, cottage]
    const server = { member: true, away: false }
    const page = open(inHousehold.home(home), {
      memberships,
      household: (id) => {
        const found = known[id]
        return found === undefined || (id === home && !server.member)
          ? notFound()
          : Response.json(found)
      },
      away: () => server.away,
    })
    await screen.findByRole('navigation', { name: 'Household' })
    expect(await opened()).toEqual([home])

    // Taken out of it since: the page is looked at again, and what it shows is read again.
    server.member = false
    memberships.splice(0, 1)
    await lookAgain(page, home)
    expect(await screen.findByRole('heading', { level: 1, name: absent })).toBeInTheDocument()

    // The server cannot be reached, and the page is looked at again.
    server.away = true
    await lookAgain(page, home)
    expect(screen.getByRole('heading', { level: 1, name: absent })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Household' })).not.toBeInTheDocument()
    expect(screen.getByRole('banner')).not.toHaveTextContent('Tilcerovi')
    expect(await opened()).toEqual([home])

    // Only an answer that is no `404` ends it: they are a member of it again.
    server.away = false
    server.member = true
    memberships.unshift(home)
    await lookAgain(page, home)
    expect(await screen.findByRole('navigation', { name: 'Household' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toHaveTextContent('Tilcerovi')
    expect(await opened()).toEqual([home, home])
  })

  it('stands as the lockout of a household suspended since this browser read it, with the focus on it', async () => {
    const opened = withReplicas()
    const suspended: string[] = []
    const server = { away: false }
    const page = open(inHousehold.home(cottage), { suspended, away: () => server.away })
    await screen.findByRole('navigation', { name: 'Household' })
    expect(await opened()).toEqual([cottage])

    suspended.push(cottage)
    await lookAgain(page, cottage)
    const title = 'Chata is suspended'
    await screen.findByRole('heading', { level: 1, name: title })
    const out = within(screen.getByRole('main')).getByRole('button', { name: 'Sign out' })
    out.focus()

    server.away = true
    await lookAgain(page, cottage)
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    // The very control, and the focus still on it: the lockout was not taken down.
    expect(within(screen.getByRole('main')).getByRole('button', { name: 'Sign out' })).toBe(out)
    expect(out).toHaveFocus()
    expect(screen.queryByRole('navigation', { name: 'Household' })).not.toBeInTheDocument()
    expect(screen.getByRole('banner')).not.toHaveTextContent('Chata')
    expect(await opened()).toEqual([cottage])
  })

  // Nothing was kept of it, so nothing could be put back; and what stood in its place was taken
  // down for *could not be read*, of a household the server had just said is not there.
  it('stays not available where nothing of it was kept, and is not said to be unread', async () => {
    const stranger = '01900000-0000-7000-8000-0000000000ff'
    const server = { away: false }
    const page = open(inHousehold.home(stranger), { away: () => server.away })
    const said = await screen.findByRole('heading', { level: 1, name: absent })

    server.away = true
    await lookAgain(page, stranger)
    expect(screen.getByRole('heading', { level: 1, name: absent })).toBe(said)
    expect(screen.queryByRole('heading', { name: unread })).not.toBeInTheDocument()
  })

  // What says *not available* through a failed re-read is the shell that heard the `404`, and a
  // member who leaves the address and comes back to it is drawn a shell that heard nothing. The
  // query client holds nothing of the household by then, so that shell has nothing to draw it
  // from: it could not be read.
  it('is not drawn from what this browser kept by a shell opened at its address afterwards', async () => {
    const opened = withReplicas()
    const memberships = [home, cottage]
    const server = { member: true, away: false }
    const page = open(inHousehold.home(home), {
      memberships,
      household: (id) => {
        const found = known[id]
        return found === undefined || (id === home && !server.member)
          ? notFound()
          : Response.json(found)
      },
      away: () => server.away,
    })
    await screen.findByRole('navigation', { name: 'Household' })
    expect(await opened()).toEqual([home])
    server.member = false
    memberships.splice(0, 1)
    await lookAgain(page, home)
    await screen.findByRole('heading', { level: 1, name: absent })
    server.away = true
    await lookAgain(page, home)

    // To another household of theirs, which cannot be read either, and back.
    await act(() => page.router.navigate(inHousehold.home(cottage)))
    await screen.findByRole('heading', { level: 1, name: unread })
    await asksAgain(page, home, () => page.router.navigate(inHousehold.home(home)))
    expect(page.router.state.location.pathname).toBe(inHousehold.home(home))
    expect(screen.getByRole('heading', { level: 1, name: unread })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Household' })).not.toBeInTheDocument()
    expect(screen.getByRole('banner')).not.toHaveTextContent('Tilcerovi')
    expect(await opened()).toEqual([home])
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
