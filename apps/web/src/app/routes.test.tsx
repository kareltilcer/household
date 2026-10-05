import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { Providers } from './App.tsx'
import { paths, routeIds } from './paths.ts'
import { Root } from './Root.tsx'
import { RouteError } from './RouteError.tsx'
import { routes, served } from './routes.tsx'

function open(address: string, table: RouteObject[] = routes) {
  const router = createMemoryRouter(table, { initialEntries: [address] })
  return render(
    <Providers persist={false}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

describe('the routes', () => {
  // The end-to-end suite walks paths.ts with axe in both themes (06-clients §8): a route the
  // router had and that list had not would be a route nothing checks.
  it('are exactly the paths of paths.ts', () => {
    const routed = routes.flatMap((route) => route.children ?? []).map((route) => route.path)
    expect(routed).toEqual(routeIds.map((id) => paths[id].path))
    expect(served).toEqual(routeIds)
  })

  it('keep the dev-only pages apart from the ones every build has', () => {
    expect(routeIds.filter((id) => paths[id].dev)).toEqual(['harness', 'primitives'])
    for (const id of routeIds) {
      expect(paths[id].path.startsWith('/dev/'), id).toBe(paths[id].dev)
    }
  })

  it('each have an address that reaches them', () => {
    for (const id of routeIds) expect(paths[id].example).toMatch(/^\//)
  })
})

describe('the app', () => {
  it('opens on its name, inside the page’s one main landmark', async () => {
    open(paths.home.example)
    expect(await screen.findByRole('heading', { level: 1, name: 'Household' })).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(document.title).toBe('Household')
  })

  it('says an address is not available without saying why, and leads back', async () => {
    open(paths.notFound.example)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This page is not available' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Go to the start page' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Household' })).toBeInTheDocument()
  })

  it('names a route that failed to draw in words, with an action, and not a blank page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const Broken = () => {
      throw new Error('broken')
    }
    open('/broken', [
      {
        Component: Root,
        ErrorBoundary: RouteError,
        children: [{ path: '/broken', Component: Broken }],
      },
    ])
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This page could not be shown' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('loads a dev-only page when its address is opened', async () => {
    open(paths.primitives.example)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Primitives' }, { timeout: 10_000 }),
    ).toBeInTheDocument()
  })
})
