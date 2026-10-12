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
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createWebClient } from '../api/client.ts'
import { dropCatalogs, holdCatalog } from '../i18n/catalogs.ts'
import { heldDestination, holdDestination, takeDestination } from '../session/destination.ts'
import { home, household, me, notFound, signedIn } from '../test/member.ts'
import { loaded } from '../test/render.tsx'
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

/** The household the member is in, as its own address answers it. */
const ours = household(home, 'Tilcerovi')

/** The list of the member's households, as the server answers it: the one they are in. */
function theirs(): Promise<Response> {
  return Promise.resolve(
    Response.json({
      items: [
        { id: ours.id, name: ours.name, my_role: ours.my_role, entitlement: ours.entitlement },
      ],
    }),
  )
}

/**
 * A member's pages ask who is signed in, for their households and for the one an address names,
 * and are answered here too: the list by `households`, which a test may hold back. Anything else
 * a screen asks is not found, which no test here reads.
 */
function serving(households: () => Promise<Response> = theirs) {
  return createWebClient({
    origin,
    cookies: signedIn,
    retry: { delays: [], sleep: () => Promise.resolve() },
    fetch: (request) => {
      const path = new URL(request.url).pathname.replace('/api/v1', '')
      if (path === '/me') return Promise.resolve(Response.json(me))
      if (path === '/households') return households()
      if (path === `/households/${home}`) return Promise.resolve(Response.json(ours))
      return Promise.resolve(notFound())
    },
  })
}

const memberClient = serving()

/**
 * The app at `address`, as a visitor opens it, or as a member does where `member` says so, over
 * the server it names where it names one.
 */
function open(
  address: string,
  table: RouteObject[] = routes,
  member: boolean | ReturnType<typeof serving> = false,
) {
  const router = createMemoryRouter(table, { initialEntries: [address] })
  const { unmount } = render(
    <Providers
      persist={false}
      client={member === false ? client : member === true ? memberClient : member}
      {...(member === false ? {} : { cookies: signedIn })}
    >
      <RouterProvider router={router} />
    </Providers>,
  )
  return { router, unmount }
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
 * The app's own table with one of the files `address` names loaded as `load` says: its screen's,
 * or the shell's around it where the address is a member's. Every route stands where the app
 * puts it, under the layouts, the guards and the boundaries the app gives it. `table` is what it
 * is made from: the app's own, or one a test already holds a file of another address in.
 */
function withFile(
  address: string,
  part: 'shell' | 'screen',
  load: (own: LazyRouteFunction<RouteObject>) => ReturnType<LazyRouteFunction<RouteObject>>,
  table: RouteObject[] = routes,
): RouteObject[] {
  const files = (matchRoutes(table, address) ?? []).flatMap(({ route }) =>
    typeof route.lazy === 'function' ? [{ route, own: route.lazy }] : [],
  )
  // A screen's file is the last an address names, and a shell's the one before it.
  const file = part === 'screen' ? files.at(-1) : files.length === 2 ? files[0] : undefined
  if (file === undefined) throw new Error(`routes: ${address} names no ${part} that is a file`)
  return replaced(table, file.route, { ...file.route, lazy: () => load(file.own) })
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

/**
 * The routes of `table` that are files and stand without a place for what is loading or without
 * a boundary, each named by the first screen it is fetched for.
 *
 * The router draws down to the place named last at or above the first route whose file is still
 * loading, and nothing at all where none is named, Root neither; and it names a failure at the
 * nearest boundary at or above the route that failed, which with none nearer is Root's own, in
 * Root's place. A place on Root itself stands in Root's place too, so neither counts, and a
 * route that is a file beside Root has neither. Nor does a place count for a file that stands
 * at or above a route between them that the table draws itself, a guard or a layout: the router
 * would draw down to the place and not to that route, and a guard would then send nobody on
 * until the file had come. A guard is told by nothing but that, so the next one is held too.
 */
function bare(table: readonly RouteObject[]): string[] {
  const found: string[] = []
  const walk = (under: readonly RouteObject[], placed: boolean, bounded: boolean, top = false) => {
    for (const route of under) {
      const place = !top && (placed || (route.HydrateFallback ?? null) !== null)
      const boundary = !top && (bounded || (route.ErrorBoundary ?? null) !== null)
      if (route.lazy !== undefined && !(place && boundary)) {
        found.push(screens([route])[0] ?? route.path ?? 'a file that draws no screen')
      }
      const drawn = (route.Component ?? route.element ?? null) !== null
      walk(route.children ?? [], place && !drawn, boundary)
    }
  }
  walk(table, false, false, true)
  return found
}

describe('the routes', () => {
  // The end-to-end suite walks paths.ts with axe in both themes (06-clients §8): a route the
  // router had and that list had not would be a route nothing checks.
  it('are exactly the paths of paths.ts', () => {
    expect(screens(routes).sort()).toEqual(routeIds.map((id) => paths[id].path).sort())
    expect(served).toEqual(routeIds)
  })

  it('give every route that is a file a place for what is loading and a boundary, under what every route is drawn in and under every guard and layout above it', () => {
    expect(bare(routes)).toEqual([])
  })

  // The rule above on tables made to break it, each in one way: what it says of the app's own
  // table is worth what it says of these.
  it('are failed for a file with no place or no boundary of its own, and for one whose place stands at or above a route drawn before it', () => {
    const Drawn = () => null
    const lazy = () => Promise.resolve({ Component: Drawn })
    const file: RouteObject = { path: '/file', lazy }
    const both = { HydrateFallback: Drawn, ErrorBoundary: Drawn }
    /** `children` under a stand-in for what every route is drawn in. */
    const under = (children: RouteObject[]): RouteObject[] => [
      { Component: Drawn, ErrorBoundary: Drawn, children },
    ]
    // Held: a file under both, and a file with a file under it, as a shell and its screen are.
    expect(bare(under([{ ...both, children: [file] }]))).toEqual([])
    expect(bare(under([{ ...both, children: [{ lazy, children: [file] }] }]))).toEqual([])
    // Beside Root, and under Root's own place and boundary alone.
    expect(bare([file])).toEqual(['/file'])
    expect(bare([{ Component: Drawn, ...both, children: [file] }])).toEqual(['/file'])
    // Without one of the two below Root.
    expect(bare(under([{ HydrateFallback: Drawn, children: [file] }]))).toEqual(['/file'])
    expect(bare(under([{ ErrorBoundary: Drawn, children: [file] }]))).toEqual(['/file'])
    // Its place above a guard or a layout, or on that route itself.
    expect(bare(under([{ ...both, children: [{ Component: Drawn, children: [file] }] }]))).toEqual([
      '/file',
    ])
    expect(bare(under([{ Component: Drawn, ...both, children: [file] }]))).toEqual(['/file'])
    // A file with no screen under it has no screen to be named by.
    expect(bare(under([{ lazy, children: [] }]))).toEqual(['a file that draws no screen'])
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
  // A file imported for the first time is transformed as it is asked for, with whatever it
  // imports that nothing imported before, which for a shell is much of the app: on a machine
  // with other work that can take longer than the five seconds a test is given. The files the
  // tests here hold back or let fail are loaded first, in time of their own, so that each test
  // waits for what is drawn and never for a first import.
  beforeAll(async () => {
    await Promise.all(
      [paths.signIn.path, paths.account.path, inHousehold.home(home)].map((address) =>
        loaded(routes, address),
      ),
    )
  }, 30_000)

  afterEach(() => {
    document.head.querySelector(`meta[name="${buildMeta}"]`)?.remove()
  })

  /** What an address that opens nothing says, which is all its page draws and needs no file. */
  const nothing = 'This link doesn’t open anything here.'

  it('opens a visitor at the way in, inside the page’s one main landmark', async () => {
    const { router } = open(paths.home.example)
    await screen.findByRole('heading', { level: 1 })
    expect(router.state.location.pathname).toBe(paths.signIn.path)
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  // A tab, a history entry and a screen reader's list of windows name a page by its title: one
  // title for every screen would tell none of them apart (WCAG 2.1, 2.4.2; D-165).
  it('names the page for the screen it shows, and for the app alone once that screen has gone', async () => {
    const { router, unmount } = open(paths.signIn.path)
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    // The page is named in an effect, which React may run a task after the commit that drew the
    // heading: the heading found, its title is waited for.
    await waitFor(() => {
      expect(document.title).toBe('Sign in · Household')
    })
    await act(() => router.navigate(paths.notFound.example))
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
    expect(await screen.findByRole('heading', { level: 1, name: nothing })).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/')
  })

  it('sends a visitor who opens a member’s address to sign in, and holds the address', async () => {
    const address = '/account/devices?x=1'
    const { router } = open(address)
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
    const lazy = () => Promise.reject(gone)
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
    const load = vi.spyOn(lazy, 'loadCatalog').mockRejectedValue(gone)
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
    aNewerBuildIsLive()
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
    aNewerBuildIsLive()
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
      fail(gone)
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
      // An address held from before a sign-in: the guard lets go of it once it knows its member.
      holdDestination(address)
      open(address, withFile(address, 'shell', file.load), true)
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

  // The router draws the address it opened at once, down to the shell's place, and once more
  // when every file the address names has come: a shell whose file has come is not drawn until
  // its screen's has, and the shape of a page stands in the page's landmark until then.
  it.each(membersOwn)(
    'draws the shape of a page, and nothing of the shell, until the screen of $of has come too, its shell’s file come',
    async ({ address, navigation }) => {
      const file = held()
      holdDestination(address)
      open(address, withFile(address, 'screen', file.load), true)
      expect(screen.getAllByRole('main')).toHaveLength(1)
      await waitFor(() => {
        expect(heldDestination()).toBeNull()
      })
      // The member is known and their shell's file has come: nothing of the shell is drawn yet.
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

  // A member who goes back or forward while the address the app opened at is still loading has
  // the router draw that address again, on their way to another. The shells' place is the one
  // place under the guard, so it is what is drawn then too: with one below the shell, the router
  // drew down to that once the shell's file had come, the shell around nothing.
  it.each(membersOwn)(
    'draws the shape of a page, and nothing of the shell of $of, while a member is led elsewhere before its screen has come',
    async ({ address }) => {
      const [elsewhere, there] =
        address === paths.account.path
          ? ([inHousehold.home(home), 'Household'] as const)
          : ([paths.account.path, 'Account'] as const)
      const file = held()
      const other = held()
      const table = withFile(
        elsewhere,
        'screen',
        other.load,
        withFile(address, 'screen', file.load),
      )
      holdDestination(address)
      const { router } = open(address, table, true)
      // The member is known, and of the two files the address names the screen's alone is still
      // on its way.
      await waitFor(() => {
        expect(heldDestination()).toBeNull()
        expect(router.state.matches.filter(({ route }) => route.lazy !== undefined)).toHaveLength(1)
      })
      let led: Promise<void> = Promise.resolve()
      act(() => {
        led = router.navigate(elsewhere)
      })
      await waitFor(() => {
        expect(router.state.navigation.location?.pathname).toBe(elsewhere)
      })
      expect(screen.getAllByRole('main')).toHaveLength(1)
      expect(screen.getByRole('main')).toContainElement(
        screen.getByRole('status', { name: 'Loading' }),
      )
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
      await other.arrive()
      await act(() => led)
      expect(await screen.findByRole('navigation', { name: there })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe(elsewhere)
      expect(screen.getAllByRole('main')).toHaveLength(1)
    },
  )

  it.each(underShell)(
    'is watching for a newer build before the $part of $of has loaded, or failed to, and names the failure under the prompt',
    async ({ address, navigation, part }) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      aNewerBuildIsLive()
      const file = held()
      open(address, withFile(address, part, file.load), true)
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
      // It took the place of a shape that said it was loading, and is said as it arrives.
      expect(failure.closest('[role="alert"]')).not.toBeNull()
    },
  )

  it.each(membersOwn)(
    'names the shell of $of that failed to draw under the prompt of a newer build, and not for the whole page',
    async ({ address }) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      aNewerBuildIsLive()
      const table = withFile(address, 'shell', () => Promise.resolve({ Component: Broken }))
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
      const { router } = open(paths.notFound.example, withFile(address, 'shell', file.load), true)
      await screen.findByRole('heading', { level: 1, name: nothing })
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
      // It took the place of the screen its member pressed their way from, and is said so.
      expect(failure.closest('[role="alert"]')).not.toBeNull()
    },
  )

  // The router keeps a file's failure and asks for the file no more, as a browser answers a
  // second import of a file with the first one's failure. So a shell that failed while nobody
  // was waiting for it, its page led elsewhere meanwhile, is named where its address is opened
  // next: what a visitor sent to sign in meets at the address held for them.
  it.each(membersOwn)(
    'names the shell of $of that failed after its page was led elsewhere once its address is opened again, and asks for the file once',
    async ({ address }) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const file = held()
      let asked = 0
      const table = withFile(address, 'shell', (own) => {
        asked += 1
        return file.load(own)
      })
      const { router } = open(paths.notFound.example, table, true)
      await screen.findByRole('heading', { level: 1, name: nothing })
      // Led to the address, and away again before its shell has come: that load is given up.
      act(() => {
        void router.navigate(address)
      })
      await act(() => router.navigate(paths.notFound.example))
      await file.fail()
      expect(screen.getByRole('heading', { level: 1, name: nothing })).toBeInTheDocument()
      expect(router.state.errors).toBeNull()
      await act(() => router.navigate(address))
      const failure = await screen.findByRole('heading', { level: 1, name: failed })
      expect(screen.getAllByRole('main')).toHaveLength(1)
      expect(screen.getByRole('main')).toContainElement(failure)
      expect(asked).toBe(1)
    },
  )

  it.each(membersOwn)(
    'sends a visitor who opens the address of $of to sign in before its shell has come, whatever becomes of the file',
    async ({ address }) => {
      const file = held()
      const { router } = open(address, withFile(address, 'shell', file.load))
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

  // The way in is a file as a shell is, and a visitor's page is on its way to it from the first
  // drawing: the guard that sends them there is what is drawn until the file has come.
  it('keeps the page’s landmark, and the shape of a page in it, while a visitor at a member’s address is sent to sign in and the file of the way in is still loading', async () => {
    const file = held()
    const { router } = open(paths.account.path, withFile(paths.signIn.path, 'screen', file.load))
    await waitFor(() => {
      expect(router.state.navigation.location?.pathname).toBe(paths.signIn.path)
    })
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('status', { name: 'Loading' }),
    )
    await file.arrive()
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(paths.signIn.path)
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  // Where the app opens sends a member on to their household, whose shell and screen are files
  // on their way from then on: the route that sent them is what is drawn until both have come.
  // It drew the shape of a page while it read their households, and that shape stays, the one
  // element: sent on with nothing drawn, the page was an empty landmark for as long.
  it('keeps the one shape of a page in the page’s landmark from the reading of a member’s households until the shell they are sent on to has come', async () => {
    const file = held()
    const address = inHousehold.home(home)
    let asked = false
    let answer: () => void = () => undefined
    const read = new Promise<void>((resolve) => {
      answer = resolve
    })
    const server = serving(async () => {
      asked = true
      await read
      return theirs()
    })
    const { router } = open(paths.home.path, withFile(address, 'shell', file.load), server)
    // The member is known, and their households are asked for: the shape is that reading's.
    await waitFor(() => {
      expect(asked).toBe(true)
    })
    const shape = screen.getByRole('status', { name: 'Loading' })
    expect(screen.getByRole('main')).toContainElement(shape)
    await act(async () => {
      answer()
      await read
    })
    await waitFor(() => {
      expect(router.state.navigation.location?.pathname).toBe(address)
    })
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('main')).toContainElement(shape)
    expect(screen.getByRole('status', { name: 'Loading' })).toBe(shape)
    await file.arrive()
    expect(await screen.findByRole('navigation', { name: 'Household' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(address)
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('keeps the shape of a page in the page’s landmark while a visitor is sent on from where the app opens and the file of the way in is still loading', async () => {
    const file = held()
    const { router } = open(paths.home.path, withFile(paths.signIn.path, 'screen', file.load))
    await waitFor(() => {
      expect(router.state.navigation.location?.pathname).toBe(paths.signIn.path)
    })
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('status', { name: 'Loading' }),
    )
    await file.arrive()
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  // The other guard, and the same rule: the way in is none of a member's, and its file is
  // not waited for before they are sent on.
  it('sends a member who opens the way in on before its file has come, whatever becomes of the file', async () => {
    const file = held()
    // The address held for them: one that opens nothing, and has no file of its own to wait for.
    holdDestination(paths.notFound.example)
    const { router } = open(
      paths.signIn.path,
      withFile(paths.signIn.path, 'screen', file.load),
      true,
    )
    await screen.findByRole('heading', { level: 1, name: nothing })
    expect(router.state.location.pathname).toBe(paths.notFound.example)
    takeDestination()
    // The file the member was sent on from fails: it is no file of the page they are on.
    await file.fail()
    expect(screen.getByRole('heading', { level: 1, name: nothing })).toBeInTheDocument()
    expect(router.state.errors).toBeNull()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  // The address held for them may be a household's, whose shell and screen are files: the guard
  // that sent them on is what is drawn until both have come, in the frame of the way in.
  it('keeps the shape of a page in the frame’s landmark while a member who opens the way in is sent on to an address whose shell is still loading', async () => {
    const file = held()
    const address = inHousehold.home(home)
    holdDestination(address)
    const { router } = open(paths.signIn.path, withFile(address, 'shell', file.load), true)
    await waitFor(() => {
      expect(router.state.navigation.location?.pathname).toBe(address)
    })
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('status', { name: 'Loading' }),
    )
    await file.arrive()
    expect(await screen.findByRole('navigation', { name: 'Household' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(address)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    // The address was held to be opened once, and has been.
    await waitFor(() => {
      expect(heldDestination()).toBeNull()
    })
  })

  it('names a failure of what every route is drawn in for the whole page, with its own landmark, and says it as it arrives', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const table = inRoot([{ path: '/', Component: () => null }])
    open(
      '/',
      table.map((root) => ({ ...root, Component: Broken })),
    )
    const failure = await screen.findByRole('heading', { level: 1, name: failed })
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('main')).toContainElement(failure)
    // It took the place of the whole page a member was on, and nothing moved the focus to it.
    expect(failure.closest('[role="alert"]')).not.toBeNull()
  })

  it('loads a dev-only page when its address is opened', async () => {
    open(paths.primitives.example)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Primitives' }, { timeout: 10_000 }),
    ).toBeInTheDocument()
  })
})
