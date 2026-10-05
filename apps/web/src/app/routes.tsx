// The router's routes, one for each path of paths.ts. The dev-only pages are loaded lazily and
// are named only where the build has them: `import.meta.env.MODE` is a constant of each build, so
// in a production build the branch that imports them is dead code, and neither they nor the files
// they would load are written (a test of the build holds that).
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
  ...(import.meta.env.MODE === 'production'
    ? {}
    : {
        harness: {
          lazy: async () => ({ Component: (await import('../dev/harness/Harness.tsx')).Harness }),
        },
        primitives: {
          lazy: async () => ({ Component: (await import('../dev/Primitives.tsx')).Primitives }),
        },
      }),
}

/** The routes this build serves, by the id paths.ts gives each: all of them but in production. */
export const served: readonly RouteId[] = routeIds.filter((id) => pages[id] !== undefined)

export const routes: RouteObject[] = [
  {
    Component: Root,
    ErrorBoundary: RouteError,
    children: served.map((id) => ({ path: paths[id].path, ...pages[id] })),
  },
]
