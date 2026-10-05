// Every route the web app has, by path. The router is built from this list (routes.tsx), and the
// end-to-end suite walks it: axe runs on every route in both themes (06-clients §8), so a route
// that is not here is a route nothing checks, and a test fails a router that has one. This file
// is data, with nothing of React's: the suite reads it on Node.

export interface RoutePath {
  /** The path as the router matches it. */
  readonly path: string
  /** An address that reaches it, for the routes whose path is a pattern. */
  readonly example: string
  /**
   * Dev-only: in the development server and in the build the end-to-end suite runs against, and
   * in no build a deployment serves (vite.config.ts).
   */
  readonly dev: boolean
}

export const paths = {
  home: { path: '/', example: '/', dev: false },
  /** The twelve-state harness: nine bodies × twelve states × two themes, at 200 % text. */
  harness: { path: '/dev/harness', example: '/dev/harness', dev: true },
  /** The primitives that carry no household data, each in its own states. */
  primitives: { path: '/dev/primitives', example: '/dev/primitives', dev: true },
  /** Whatever no other route matches. */
  notFound: { path: '*', example: '/no-such-page', dev: false },
} as const satisfies Record<string, RoutePath>

export type RouteId = keyof typeof paths

export const routeIds = Object.keys(paths) as RouteId[]
