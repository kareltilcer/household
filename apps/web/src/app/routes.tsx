// The router's routes, one for each path of paths.ts. The dev-only pages are loaded lazily and
// are named only where a build is told to have them: the development server, and the build the
// end-to-end suite runs against (`vite build --mode e2e`). Both conditions are constants of each
// build, so in every other one, whatever mode it is built in, the branch that imports the pages
// is dead code, and neither they nor the files they would load are written (build/check.ts
// holds the build a deployment serves to that).
import type { RouteObject } from 'react-router'
import { Home } from './Home.tsx'
import { NotFound } from './NotFound.tsx'
import { paths, routeIds, type RouteId } from './paths.ts'
import { Root } from './Root.tsx'
import { RouteError } from './RouteError.tsx'

type Page = Omit<RouteObject, 'path' | 'children' | 'index'>

const pages: Partial<Record<RouteId, Page>> = {
  home: { Component: Home },
  notFound: { Component: NotFound },
  ...(import.meta.env.DEV || import.meta.env.MODE === 'e2e'
    ? {
        harness: {
          lazy: async () => ({ Component: (await import('../dev/harness/Harness.tsx')).Harness }),
        },
        primitives: {
          lazy: async () => ({ Component: (await import('../dev/Primitives.tsx')).Primitives }),
        },
      }
    : {}),
}

/**
 * The routes this build serves, by the id paths.ts gives each: all of them in development and in
 * the end-to-end build, and all but the dev-only ones in any other.
 */
export const served: readonly RouteId[] = routeIds.filter((id) => pages[id] !== undefined)

export const routes: RouteObject[] = [
  {
    Component: Root,
    ErrorBoundary: RouteError,
    children: served.map((id) => ({ path: paths[id].path, ...pages[id] })),
  },
]
