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
import { RootError, RouteError } from './RouteError.tsx'

type Page = Omit<RouteObject, 'path' | 'children' | 'index'>

/**
 * Whether this build has the dev-only pages. The mode is paths.ts's `devPagesMode`, written out
 * here: the bundler drops the branch below only where it reads a constant in this very
 * expression, and one imported from another module is none to it. A test of the build holds the
 * two together (build/build.test.ts), and the build's plugin refuses a build that kept the pages.
 */
const devPages = import.meta.env.DEV || import.meta.env.MODE === 'e2e'

const pages: Partial<Record<RouteId, Page>> = {
  home: { Component: Home },
  notFound: { Component: NotFound },
  ...(devPages
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
 * the end-to-end build, and all but the dev-only ones in any other. A route paths.ts marks
 * dev-only is served by no other build, whatever names a page for it above.
 */
export const served: readonly RouteId[] = routeIds.filter(
  (id) => pages[id] !== undefined && (devPages || !paths[id].dev),
)

/**
 * What stands in a screen's place while its file loads, on the visit that opens the app at it:
 * nothing. It is there for what it leaves the router free to draw around it. With no such place
 * named, the router draws nothing at all until the file has loaded or failed to, Root neither.
 */
function Loading() {
  return null
}

/**
 * The router's table for `screens`: each drawn inside Root, and a screen that fails to load or to
 * draw named in its own place there (RouteError), so that Root stays, the prompt of a newer build
 * with it. Root is drawn before a screen that is still loading, too, its landmark on the page and
 * its watch listening by the time the screen's file fails. The second boundary is for Root's own
 * failure, which leaves nothing to draw inside.
 */
export function inRoot(screens: RouteObject[]): RouteObject[] {
  return [
    {
      Component: Root,
      ErrorBoundary: RootError,
      children: [{ ErrorBoundary: RouteError, HydrateFallback: Loading, children: screens }],
    },
  ]
}

export const routes: RouteObject[] = inRoot(
  served.map((id) => ({ path: paths[id].path, ...pages[id] })),
)
