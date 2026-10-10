// The app's routes, as one table. A route is a line here and a file under app/, which
// expo-router reads the addresses from: the file re-exports the route's screen and holds nothing
// else, and a test holds the two to each other (routes.test.ts), since a screen that is no line
// is a screen nothing walks.
//
// The addresses are the web's own (apps/web/src/app/paths.ts): the server names a place by the
// web's address, in a push's `data.url` and in a link, and the app opens it one to one. An
// address the app has no screen for, a household's settings today, is the neutral *not
// available* screen and never an error: `householdNotFound` under a household, `notFound`
// anywhere else.
//
// This file is data, with nothing of React Native's or of expo-router's: the links read it to
// say whether an address is the app's own, and so does the test of the routes.

/**
 * What stands around a route's screen: nothing but the providers (`plain`), or a household's
 * frame, its bars and its tab bar (`household`, app/households/[household]/_layout.tsx).
 */
export type Layout = 'plain' | 'household'

export interface RoutePath {
  /**
   * The address as expo-router writes it: a segment in square brackets is a parameter, and
   * `[...rest]` is whatever follows, one segment or more.
   */
  readonly path: string
  readonly layout: Layout
  /** A dev screen (src/dev): in a bundle only where the gate is open (src/dev/gate.ts). */
  readonly dev: boolean
}

export const paths = {
  /** Where the app opens: no screen of its own, it leads to sign-in or to a household. */
  home: { path: '/', layout: 'plain', dev: false },
  signIn: { path: '/sign-in', layout: 'plain', dev: false },

  /** A household's Home, the first of its tabs. */
  household: { path: '/households/[household]', layout: 'household', dev: false },
  today: { path: '/households/[household]/today', layout: 'household', dev: false },
  more: { path: '/households/[household]/more', layout: 'household', dev: false },
  arrange: { path: '/households/[household]/arrange', layout: 'household', dev: false },
  sync: { path: '/households/[household]/sync', layout: 'household', dev: false },
  /** A module's screens, which no build has yet: each is a line of its own as it is built. */
  module: {
    path: '/households/[household]/modules/[module]/[...rest]',
    layout: 'household',
    dev: false,
  },
  /** Whatever else is asked of a household: *not available*, inside its frame. */
  householdNotFound: { path: '/households/[household]/[...rest]', layout: 'household', dev: false },

  dev: { path: '/dev', layout: 'plain', dev: true },
  devHarness: { path: '/dev/harness', layout: 'plain', dev: true },
  devPrimitives: { path: '/dev/primitives', layout: 'plain', dev: true },
  devShell: { path: '/dev/shell', layout: 'plain', dev: true },
  devSync: { path: '/dev/sync', layout: 'plain', dev: true },
  devEngine: { path: '/dev/engine', layout: 'plain', dev: true },
  devSignIn: { path: '/dev/sign-in', layout: 'plain', dev: true },

  /** Whatever no other route matches. */
  notFound: { path: '/+not-found', layout: 'plain', dev: false },
} as const satisfies Record<string, RoutePath>

export type RouteId = keyof typeof paths

export const routeIds = Object.keys(paths) as RouteId[]

/** The layouts' own files under app/, which are no route: each holds what stands around its routes. */
export const layoutFiles = ['_layout', 'households/[household]/_layout'] as const

/**
 * The file under app/ that is route `id`, with no extension: its address, or `index` inside its
 * folder where other routes stand under it.
 */
export function fileOf(id: RouteId): string {
  const { path } = paths[id]
  const folder = routeIds.some((other) => paths[other].path.startsWith(`${path}/`))
  if (path === '/') return 'index'
  return `${path.slice(1)}${folder ? '/index' : ''}`
}

/**
 * `path` with each `[name]` it holds replaced by `params`' value for it, and a `[...rest]` at
 * its end by `rest`: the address of a route whose path is a pattern. A value is written as one
 * segment of a path, whatever it holds.
 */
export function fill(path: string, params: Readonly<Record<string, string>>, rest = ''): string {
  const filled = path.replace(/\[([A-Za-z]+)\]/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined) throw new Error(`fill: ${path} needs ${name}`)
    return encodeURIComponent(value)
  })
  const tail = '/[...rest]'
  if (!filled.endsWith(tail)) return filled
  const base = filled.slice(0, -tail.length)
  return rest === '' ? base : `${base}/${rest.replace(/^\/+/, '')}`
}

/**
 * Whether `path` is an address of the app's own: a path from the root, and no other origin's,
 * which is what `//host` and `/\host` are taken for. It is asked of whatever a notification or a
 * link carried, and of the address held while a visitor signs in, before that is opened.
 */
export function isOwnPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\')
}

/** The addresses of a household's own routes. */
export const inHousehold = {
  home: (household: string) => fill(paths.household.path, { household }),
  today: (household: string) => fill(paths.today.path, { household }),
  more: (household: string) => fill(paths.more.path, { household }),
  arrange: (household: string) => fill(paths.arrange.path, { household }),
  sync: (household: string) => fill(paths.sync.path, { household }),
  module: (household: string, module: string, rest = '') =>
    fill(paths.module.path, { household, module }, rest),
} as const
