import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebClient } from '../api/client.ts'
import { heldDestination } from '../session/destination.ts'
import { buildMeta } from '../update/build.ts'
import { Providers } from './App.tsx'
import { fill, inHousehold, paths, routeIds } from './paths.ts'
import { inRoot, routes, served } from './routes.tsx'

// A visitor's pages ask the server one thing, which providers it signs in with, and are answered
// here: no test asks the network.
const client = createWebClient({
  origin: 'https://household.example',
  cookies: () => '',
  fetch: () => Promise.resolve(Response.json({ providers: [] })),
})

function open(address: string, table: RouteObject[] = routes) {
  const router = createMemoryRouter(table, { initialEntries: [address] })
  return render(
    <Providers persist={false} client={client}>
      <RouterProvider router={router} />
    </Providers>,
  )
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
