import { catalogs } from '@household/i18n'
import * as lazy from '@household/i18n/lazy'
import { partOf } from '@household/i18n/lazy'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  createMemoryRouter,
  matchRoutes,
  RouterProvider,
  type LazyRouteFunction,
  type RouteObject,
} from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebClient } from '../api/client.ts'
import { csrfCookie } from '../api/names.ts'
import { dropCatalogs, holdCatalog } from '../i18n/catalogs.ts'
import { heldDestination, holdDestination } from '../session/destination.ts'
import { buildMeta } from '../update/build.ts'
import { Providers } from './App.tsx'
import { fill, inHousehold, isOwnPath, paths, routeIds } from './paths.ts'
import { inRoot, routes, served } from './routes.tsx'

const origin = 'https://household.example'

// A visitor's pages ask the server one thing, which providers it signs in with, and are answered
// here: no test asks the network.
const client = createWebClient({
  origin,
  cookies: () => '',
  fetch: () => Promise.resolve(Response.json({ providers: [] })),
})

const home = '01900000-0000-7000-8000-0000000000a1'

/** The cookies of a browser that holds a session: the readable one is all a page reads of it. */
const signedIn = () => `${csrfCookie}=t`

// A member's pages ask who is signed in and for the household its address names, and are
// answered here too. Anything else a screen asks is not found, which no test here reads.
const memberClient = createWebClient({
  origin,
  cookies: signedIn,
  retry: { delays: [], sleep: () => Promise.resolve() },
  fetch: (request) => {
    const path = new URL(request.url).pathname.replace('/api/v1', '')
    if (path === '/me') {
      return Promise.resolve(
        Response.json({
          id: '01900000-0000-7000-8000-00000000d0e5',
          email: 'jana@example.test',
          email_verified: true,
          display_name: 'Jana',
          locale: 'en',
        }),
      )
    }
    if (path === `/households/${home}`) {
      return Promise.resolve(
        Response.json({
          id: home,
          name: 'Tilcerovi',
          country: 'CZ',
          timezone: 'Europe/Prague',
          base_currency: 'CZK',
          locale: 'cs',
          my_role: 'owner',
          my_grants: { dashboard: 'view', admin: 'manage' },
          entitlement: { state: 'trialing', can_write: true },
        }),
      )
    }
    return Promise.resolve(
      Response.json(
        { type: 'about:blank', title: 'not found', status: 404, code: 'not_found' },
        { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    )
  },
})

/** The app at `address`, as a visitor opens it, or as a member does where `member` says so. */
function open(address: string, table: RouteObject[] = routes, member = false) {
  const router = createMemoryRouter(table, { initialEntries: [address] })
  render(
    <Providers
      persist={false}
      client={member ? memberClient : client}
      {...(member ? { cookies: signedIn } : {})}
    >
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

/** `table` with `route` replaced by `by`, wherever it stands in it. */
function replaced(
  table: readonly RouteObject[],
  route: RouteObject,
  by: RouteObject,
): RouteObject[] {
  return table.map((each) => {
    if (each === route) return by
    return each.children === undefined
      ? each
      : { ...each, children: replaced(each.children, route, by) }
  })
}

/**
 * The app's own table with one of the two files a member's `address` names, its shell's or its
 * screen's, loaded as `load` says: every route stands where the app puts it, under the layouts
 * and the boundaries the app gives it. Both files are loaded here first, as they are, so that a
 * test that lets one arrive waits for what is drawn, and never for a first import.
 */
async function withFile(
  address: string,
  part: 'shell' | 'screen',
  load: (own: LazyRouteFunction<RouteObject>) => ReturnType<LazyRouteFunction<RouteObject>>,
): Promise<RouteObject[]> {
  const files = (matchRoutes(routes, address) ?? []).flatMap(({ route }) =>
    typeof route.lazy === 'function' ? [{ route, own: route.lazy }] : [],
  )
  const [shell, page] = files
  if (shell === undefined || page === undefined || files.length !== 2) {
    throw new Error(`routes: ${address} is not a shell's file and a screen's`)
  }
  await Promise.all(files.map(({ own }) => own()))
  const { route, own } = part === 'shell' ? shell : page
  return replaced(routes, route, { ...route, lazy: () => load(own) })
}

/** What a page meets when a newer build has taken a file of its own away. */
const gone = new TypeError('Failed to fetch dynamically imported module')

/**
 * A file whose arrival its test decides, by a promise and no clock: it is loaded once `arrive`
 * is called, and fails as a file that is gone does once `fail` is.
 */
function held() {
  let come: () => void = () => undefined
  let lost: (reason: Error) => void = () => undefined
  const settled = new Promise<void>((resolve, reject) => {
    come = resolve
    lost = reject
  })
  return {
    load: async (own: LazyRouteFunction<RouteObject>) => {
      await settled
      return own()
    },
    arrive: () =>
      act(async () => {
        come()
        await settled
      }),
    fail: () =>
      act(async () => {
        lost(gone)
        await settled.catch(() => undefined)
      }),
  }
}

/** A page of one build while another is live, which is what the watch for a newer one reads. */
function aNewerBuildIsLive(): void {
  const meta = document.createElement('meta')
  meta.name = buildMeta
  meta.content = 'own'
  document.head.append(meta)
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ id: 'next' })))
}

/**
 * The screens of a table, each by its whole path: every route that draws one, under whatever
 * layouts and boundaries, a layout's own path before its screens' and an index at its layout's.
 */
function screens(table: readonly RouteObject[], under = ''): string[] {
  return table.flatMap((route) => {
    const own = route.path ?? ''
    const path = own.startsWith('/') || own === '*' ? own : [under, own].filter(Boolean).join('/')
    if (route.children !== undefined) return screens(route.children, path === '*' ? under : path)
    return [own === '*' && under !== '' ? `${under}/*` : path]
  })
}

describe('the routes', () => {
  // The end-to-end suite walks paths.ts with axe in both themes (06-clients §8): a route the
  // router had and that list had not would be a route nothing checks.
  it('are exactly the paths of paths.ts', () => {
    expect(screens(routes).sort()).toEqual(routeIds.map((id) => paths[id].path).sort())
    expect(served).toEqual(routeIds)
  })

  // The router draws down to the place named last at or above the first route whose file is
  // still loading, and nothing at all where none is named, Root neither; and it names a failure
  // at the nearest boundary at or above the route that failed, which with none nearer is Root's
  // own, in Root's place. A place on Root itself stands in Root's place too, so neither counts.
  it('give every route that is a file a place for what is loading and a boundary, under what every route is drawn in', () => {
    // Each such file without one of the two, named by the first screen it is fetched for.
    const bare: string[] = []
    const walk = (table: readonly RouteObject[], placed: boolean, bounded: boolean) => {
      for (const route of table) {
        const place = placed || (route.HydrateFallback ?? null) !== null
        const boundary = bounded || (route.ErrorBoundary ?? null) !== null
        if (route.lazy !== undefined && !(place && boundary)) {
          bare.push(...screens([route]).slice(0, 1))
        }
        walk(route.children ?? [], place, boundary)
      }
    }
    for (const root of routes) walk(root.children ?? [], false, false)
    expect(bare).toEqual([])
  })

  it('give every path a layout, and the shell to a member’s routes alone', () => {
    for (const id of routeIds) {
      const { path, layout } = paths[id]
      expect(path.startsWith('/households/'), id).toBe(layout === 'household')
      if (layout === 'account') expect(path.startsWith('/account'), id).toBe(true)
    }
  })

  it('fill a pattern with what it names, each value as one segment', () => {
    expect(fill('/households/:householdId/sync', { householdId: 'h1' })).toBe('/households/h1/sync')
    expect(fill('/a/:b/*', { b: 'x/y' })).toBe('/a/x%2Fy')
    expect(fill('/a/:b/*', { b: 'x' }, '/c/d')).toBe('/a/x/c/d')
    expect(() => fill('/a/:b', {})).toThrow(/needs b/)
    expect(inHousehold.module('h1', 'shopping', 'lists/2')).toBe(
      '/households/h1/modules/shopping/lists/2',
    )
  })

  it('are told from another origin’s address, which is held, gone back to and opened by nothing', () => {
    for (const own of ['/', '/account', '/households/h1/sync?x=1#y']) {
      expect(isOwnPath(own), own).toBe(true)
    }
    for (const other of ['', 'account', 'https://other.example/', '//other.example', '/\\other']) {
      expect(isOwnPath(other), other).toBe(false)
    }
  })

  it('keep the dev-only pages apart from the ones every build has', () => {
    expect(routeIds.filter((id) => paths[id].dev)).toEqual([
      'harness',
      'primitives',
      'devShell',
      'devSync',
    ])
    for (const id of routeIds) {
      expect(paths[id].path.startsWith('/dev/'), id).toBe(paths[id].dev)
    }
  })

  it('each have an address that reaches them', () => {
    for (const id of routeIds) expect(paths[id].example).toMatch(/^\//)
  })
})

describe('the app', () => {
  afterEach(() => {
    document.head.querySelector(`meta[name="${buildMeta}"]`)?.remove()
  })

  it('opens a visitor at the way in, inside the page’s one main landmark', async () => {
    const router = createMemoryRouter(routes, { initialEntries: [paths.home.example] })
    render(
      <Providers persist={false} client={client}>
        <RouterProvider router={router} />
      </Providers>,
    )
    await screen.findByRole('heading', { level: 1 })
    expect(router.state.location.pathname).toBe(paths.signIn.path)
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  // A tab, a history entry and a screen reader's list of windows name a page by its title: one
  // title for every screen would tell none of them apart (WCAG 2.1, 2.4.2; D-165).
  it('names the page for the screen it shows, and for the app alone once that screen has gone', async () => {
    const router = createMemoryRouter(routes, { initialEntries: [paths.signIn.path] })
    const { unmount } = render(
      <Providers persist={false} client={client}>
        <RouterProvider router={router} />
      </Providers>,
    )
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    // The page is named in an effect, which React may run a task after the commit that drew the
    // heading: the heading found, its title is waited for.
    await waitFor(() => {
      expect(document.title).toBe('Sign in · Household')
    })
    await act(() => router.navigate(paths.notFound.example))
    const nothing = 'This link doesn’t open anything here.'
    await screen.findByRole('heading', { level: 1, name: nothing })
    await waitFor(() => {
      expect(document.title).toBe(`${nothing} · Household`)
    })
    // What the effect undoes is undone before `unmount` returns.
    unmount()
    expect(document.title).toBe('Household')
  })

  it('says an address opens nothing without saying why, and leads back', async () => {
    open(paths.notFound.example)
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This link doesn’t open anything here.',
      }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/')
  })

  it('sends a visitor who opens a member’s address to sign in, and holds the address', async () => {
    const address = '/account/devices?x=1'
    const router = createMemoryRouter(routes, { initialEntries: [address] })
    render(
      <Providers persist={false} client={client}>
        <RouterProvider router={router} />
      </Providers>,
    )
    await screen.findByRole('heading', { level: 1 })
    expect(router.state.location.pathname).toBe(paths.signIn.path)
    expect(heldDestination()).toBe(address)
  })

  const Broken = () => {
    throw new Error('broken')
  }

  it('names a route that failed to draw in words, with an action, and not a blank page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    open('/broken', inRoot([{ path: '/broken', Component: Broken }]))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This page could not be shown' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    // In the route's place, inside what every route is drawn in: the one landmark is Root's.
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }))
  })

  it('names a route that could not be loaded as one that could not be drawn', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // What a page meets when a newer build has taken a file of its own away.
    const lazy = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'))
    open('/gone', inRoot([{ path: '/gone', lazy }]))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This page could not be shown' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  /** The app's own words in English, which are all a page holds until a screen brings more. */
  const ownWords = Object.fromEntries(
    Object.entries(catalogs.en).filter(([key]) => partOf(key) === 'app'),
  )
  const noInvitation = catalogs.en['household.invitation.none.title']

  // A screen's own words are a file as its script is, and are fetched beside it (D-159).
  it('draws a route with the words its path names, fetched with the screen’s file', async () => {
    const load = vi.spyOn(lazy, 'loadCatalog')
    dropCatalogs()
    holdCatalog('en', ownWords, ['app'])
    expect(paths.invitation.words).toEqual(['household'])
    open(paths.invitation.example)
    expect(
      await screen.findByRole('heading', { level: 1, name: noInvitation }, { timeout: 10_000 }),
    ).toBeInTheDocument()
    expect(load.mock.calls).toEqual([['en', 'household']])
  })

  it('names a route whose words could not be fetched as one that could not be drawn', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // What a page meets when a newer build has taken a file of its own away, the words' this
    // time: the screen's script came, and is not drawn without them.
    const load = vi
      .spyOn(lazy, 'loadCatalog')
      .mockRejectedValue(new TypeError('Failed to fetch dynamically imported module'))
    dropCatalogs()
    holdCatalog('en', ownWords, ['app'])
    open(paths.invitation.example)
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'This page could not be shown' },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument()
    expect(load.mock.calls).toEqual([['en', 'household']])
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.queryByText(noInvitation)).not.toBeInTheDocument()
  })

  it('still says a newer build is live over a route that failed, which is when it most often is', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const meta = document.createElement('meta')
    meta.name = buildMeta
    meta.content = 'own'
    document.head.append(meta)
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ id: 'next' })))
    open('/broken', inRoot([{ path: '/broken', Component: Broken }]))
    await screen.findByRole('heading', { level: 1, name: 'This page could not be shown' })
    // The page could not load a file of its own build, and asks which build is live: Root, and
    // the watch it keeps, were not taken down with the route.
    act(() => {
      window.dispatchEvent(new Event('vite:preloadError'))
    })
    expect(await screen.findByText('A new version of Household is ready.')).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'Reload' })).toHaveLength(2)
  })

  it('draws what every route is drawn in while the route the app opened at is still loading', async () => {
    const title = 'Slow'
    let loaded: (page: { Component: () => ReactNode }) => void = () => undefined
    const lazy = () =>
      new Promise<{ Component: () => ReactNode }>((resolve) => {
        loaded = resolve
      })
    open('/slow', inRoot([{ path: '/slow', lazy }]))
    // The landmark is Root's, and is there before the route: its place is empty until it loads.
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('main')).toBeEmptyDOMElement()
    await act(async () => {
      loaded({ Component: () => <h1>{title}</h1> })
      await Promise.resolve()
    })
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('is watching for a newer build before the route it opened at has loaded, or failed to', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const meta = document.createElement('meta')
    meta.name = buildMeta
    meta.content = 'own'
    document.head.append(meta)
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ id: 'next' })))
    let fail: (reason: Error) => void = () => undefined
    const lazy = () =>
      new Promise<never>((_, reject) => {
        fail = reject
      })
    open('/gone', inRoot([{ path: '/gone', lazy }]))
    // Vite says it could not load the route's file, and then the import of it fails: the watch
    // is Root's, which is drawn already, and hears the first.
    act(() => {
      window.dispatchEvent(new Event('vite:preloadError'))
    })
    await act(async () => {
      fail(new TypeError('Failed to fetch dynamically imported module'))
      await Promise.resolve()
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This page could not be shown' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('A new version of Household is ready.')).toBeVisible()
  })

  // A member's routes are drawn in a shell that is a file as a screen is: on the visit that
  // opens the app at one, two files are on their way, and what every route is drawn in is drawn
  // before either has come.
  const membersOwn = [
    { of: 'an account', address: paths.account.path, navigation: 'Account' },
    { of: 'a household', address: inHousehold.home(home), navigation: 'Household' },
  ] as const
  const underShell = membersOwn.flatMap((route) =>
    (['shell', 'screen'] as const).map((part) => ({ ...route, part })),
  )
  const newer = 'A new version of Household is ready.'
  const failed = 'This page could not be shown'

  it.each(membersOwn)(
    'draws what every route is drawn in, and the shape of a page in the page’s landmark, while the shell of $of is still loading',
    async ({ address, navigation }) => {
      const file = held()
      const table = await withFile(address, 'shell', file.load)
      // An address held from before a sign-in: the guard lets go of it once it knows its member.
      holdDestination(address)
      open(address, table, true)
      // Who is signed in is not known yet, and the page has its landmark: the guard's.
      expect(screen.getAllByRole('main')).toHaveLength(1)
      await waitFor(() => {
        expect(heldDestination()).toBeNull()
      })
      // The member is known and their shell has not come: the landmark is the loading place's.
      expect(screen.getAllByRole('main')).toHaveLength(1)
      expect(screen.getByRole('main')).toContainElement(
        screen.getByRole('status', { name: 'Loading' }),
      )
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
      await file.arrive()
      expect(await screen.findByRole('navigation', { name: navigation })).toBeInTheDocument()
      expect(screen.getAllByRole('main')).toHaveLength(1)
    },
  )

  it.each(membersOwn)(
    'keeps the page’s one landmark while the screen of $of is still loading, its shell’s file come',
    async ({ address, navigation }) => {
      const file = held()
      const table = await withFile(address, 'screen', file.load)
      holdDestination(address)
      open(address, table, true)
      expect(screen.getAllByRole('main')).toHaveLength(1)
      await waitFor(() => {
        expect(heldDestination()).toBeNull()
      })
      expect(screen.getAllByRole('main')).toHaveLength(1)
      await file.arrive()
      expect(await screen.findByRole('navigation', { name: navigation })).toBeInTheDocument()
      expect(screen.getAllByRole('main')).toHaveLength(1)
    },
  )

  it.each(underShell)(
    'is watching for a newer build before the $part of $of has loaded, or failed to, and names the failure under the prompt',
    async ({ address, navigation, part }) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      aNewerBuildIsLive()
      const file = held()
      open(address, await withFile(address, part, file.load), true)
      // Vite says it could not load the file, and then the import of it fails: the watch is
      // Root's, which is drawn already, and hears the first.
      act(() => {
        window.dispatchEvent(new Event('vite:preloadError'))
      })
      await file.fail()
      const failure = await screen.findByRole('heading', { level: 1, name: failed })
      expect(await screen.findByText(newer)).toBeVisible()
      // The failure is in the page's one landmark: a shell that failed gives none, so its
      // failure brings its own, and a screen that failed is named in its shell's, which stays.
      expect(screen.getAllByRole('main')).toHaveLength(1)
      expect(screen.getByRole('main')).toContainElement(failure)
      expect(screen.queryAllByRole('navigation', { name: navigation })).toHaveLength(
        part === 'screen' ? 1 : 0,
      )
    },
  )

  it.each(membersOwn)(
    'names the shell of $of that failed to draw under the prompt of a newer build, and not for the whole page',
    async ({ address }) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      aNewerBuildIsLive()
      const table = await withFile(address, 'shell', () => Promise.resolve({ Component: Broken }))
      open(address, table, true)
      const failure = await screen.findByRole('heading', { level: 1, name: failed })
      expect(screen.getAllByRole('main')).toHaveLength(1)
      expect(screen.getByRole('main')).toContainElement(failure)
      // Root was not taken down with the shell: its watch hears of a file that failed since.
      act(() => {
        window.dispatchEvent(new Event('vite:preloadError'))
      })
      expect(await screen.findByText(newer)).toBeVisible()
    },
  )

  // A page left open over a deploy asks for a shell for the first time when its member is led
  // into one, from the way in or from where the app opens: the file is gone by then.
  it.each(membersOwn)(
    'names the shell of $of that a page already open could not load under the prompt, and not for the whole page',
    async ({ address }) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      aNewerBuildIsLive()
      const file = held()
      const router = open(paths.notFound.example, await withFile(address, 'shell', file.load), true)
      await screen.findByRole('heading', {
        level: 1,
        name: 'This link doesn’t open anything here.',
      })
      let led: Promise<void> = Promise.resolve()
      act(() => {
        led = router.navigate(address)
        window.dispatchEvent(new Event('vite:preloadError'))
      })
      await file.fail()
      await act(() => led)
      const failure = await screen.findByRole('heading', { level: 1, name: failed })
      expect(await screen.findByText(newer)).toBeVisible()
      expect(screen.getAllByRole('main')).toHaveLength(1)
      expect(screen.getByRole('main')).toContainElement(failure)
    },
  )

  it.each(membersOwn)(
    'sends a visitor who opens the address of $of to sign in before its shell has come, whatever becomes of the file',
    async ({ address }) => {
      const file = held()
      const router = open(address, await withFile(address, 'shell', file.load))
      await screen.findByRole('heading', { level: 1, name: 'Sign in' })
      expect(router.state.location.pathname).toBe(paths.signIn.path)
      expect(heldDestination()).toBe(address)
      // The file the visitor was sent away from fails, as one a newer build took away would:
      // it is no file of the page they are on, which says nothing of it.
      await file.fail()
      expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
      expect(router.state.errors).toBeNull()
    },
  )

  it('names a failure of what every route is drawn in for the whole page, with its own landmark', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const table = inRoot([{ path: '/', Component: () => null }])
    open(
      '/',
      table.map((root) => ({ ...root, Component: Broken })),
    )
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This page could not be shown' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('loads a dev-only page when its address is opened', async () => {
    open(paths.primitives.example)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Primitives' }, { timeout: 10_000 }),
    ).toBeInTheDocument()
  })
})
