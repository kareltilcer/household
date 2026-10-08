// Every route the web app has, by path. The router is built from this list (routes.tsx), and the
// end-to-end suite walks it: axe runs on every route in both themes (06-clients §8), so a route
// that is not here is a route nothing checks, and a test fails a router that has one. This file
// is data, with nothing of React's: the suite reads it on Node.

/**
 * The mode of the one build that has the dev-only pages, beside the development server: the build
 * the end-to-end suite runs against, `vite build --mode e2e`. The build's configuration reads it
 * here (vite.config.ts), and its plugin, which refuses a dev-only page to a build of any other
 * mode (build/plugin.ts). The router writes it out, as the bundler needs it (routes.tsx).
 */
export const devPagesMode = 'e2e'

/**
 * What a route is drawn in (routes.tsx):
 *
 * - `plain`: the page's landmark and nothing more. The dev-only pages, and what stands in the
 *   place of an address that opens nothing.
 * - `public`: the frame of the screens a person reaches before they are signed in, or by a link
 *   an email carried. Drawn for anyone.
 * - `account`: the shell, around a member's own account. Signed in only.
 * - `household`: the shell, around one household, which the address names (D-4). Signed in only.
 */
export type Layout = 'plain' | 'public' | 'account' | 'household'

export interface RoutePath {
  /** The path as the router matches it. */
  readonly path: string
  /**
   * An address that reaches it. `{household}` stands for a household of the member who opens
   * it: the end-to-end suite puts in one it made.
   */
  readonly example: string
  /**
   * Dev-only: served by the development server and by the build of `devPagesMode`, and by no
   * build a deployment serves. The router serves a route marked so nowhere else (routes.tsx).
   */
  readonly dev: boolean
  readonly layout: Layout
  /**
   * For a visitor alone: a member who opens it is sent on to where they were going, since they
   * are signed in already.
   */
  readonly visitor?: true
}

const household = '/households/:householdId'
const exampleHousehold = '/households/{household}'

export const paths = {
  /** Where the app opens: a member's household, or the way in. */
  home: { path: '/', example: '/', dev: false, layout: 'plain' },

  // Signing in and what an email's link opens (A-1 to A-10; ADR 0009, 0010, 0012). The server
  // links to `sign-in`, `verify-email`, `reset`, `reset/set`, `graduate` and
  // `account/deletion/cancel` by these names.
  signIn: { path: '/sign-in', example: '/sign-in', dev: false, layout: 'public', visitor: true },
  /** The second step of a sign-in that was challenged (A-7). */
  secondStep: {
    path: '/sign-in/2fa',
    example: '/sign-in/2fa',
    dev: false,
    layout: 'public',
    visitor: true,
  },
  /** A recovery code in the second step's place (A-8). */
  recoveryCode: {
    path: '/sign-in/2fa/recovery',
    example: '/sign-in/2fa/recovery',
    dev: false,
    layout: 'public',
    visitor: true,
  },
  /**
   * Where Google sends a person back, and where the API sends on what Apple posted to it
   * (`postAuthOauthAppleReturn`): a sign-in's end, or a link's, begun in this browser.
   */
  providerReturn: {
    path: '/sign-in/:provider',
    example: '/sign-in/google',
    dev: false,
    layout: 'public',
  },
  register: {
    path: '/register',
    example: '/register',
    dev: false,
    layout: 'public',
    visitor: true,
  },
  /** *Check your email*, after registering (A-3). */
  verifySent: { path: '/verify', example: '/verify', dev: false, layout: 'public' },
  /** What the verification email's link opens, its token in the fragment. */
  verifyEmail: { path: '/verify-email', example: '/verify-email', dev: false, layout: 'public' },
  reset: { path: '/reset', example: '/reset', dev: false, layout: 'public' },
  /** What the reset email's link opens, its token in the fragment (A-10). */
  resetSet: { path: '/reset/set', example: '/reset/set', dev: false, layout: 'public' },
  /** What a child profile's graduation link opens (ADR 0012). */
  graduate: { path: '/graduate', example: '/graduate', dev: false, layout: 'public' },
  /** What the link in an account deletion's email opens: it cancels it, signed out (D-136). */
  deletionCancel: {
    path: '/account/deletion/cancel',
    example: '/account/deletion/cancel',
    dev: false,
    layout: 'public',
  },

  // A member's own account (A-12, A-13, A-19, A-20, F-20).
  account: { path: '/account', example: '/account', dev: false, layout: 'account' },
  accountSecurity: {
    path: '/account/security',
    example: '/account/security',
    dev: false,
    layout: 'account',
  },
  /** Turning the second step on, and the recovery codes it answers with (A-5, A-6). */
  accountSecondStep: {
    path: '/account/2fa',
    example: '/account/2fa',
    dev: false,
    layout: 'account',
  },
  accountDevices: {
    path: '/account/devices',
    example: '/account/devices',
    dev: false,
    layout: 'account',
  },
  accountNotifications: {
    path: '/account/notifications',
    example: '/account/notifications',
    dev: false,
    layout: 'account',
  },
  accountDelete: {
    path: '/account/delete',
    example: '/account/delete',
    dev: false,
    layout: 'account',
  },

  // One household, which the address names (D-4).
  household: { path: household, example: exampleHousehold, dev: false, layout: 'household' },
  /** What needs the member's attention: conflicts and refused changes (F-5 to F-7). */
  sync: {
    path: `${household}/sync`,
    example: `${exampleHousehold}/sync`,
    dev: false,
    layout: 'household',
  },
  /** The member's own order of their modules (F-15, D-38). */
  arrange: {
    path: `${household}/arrange`,
    example: `${exampleHousehold}/arrange`,
    dev: false,
    layout: 'household',
  },
  /** A module's own screens, where this build has them (modules/registry.ts). */
  module: {
    path: `${household}/modules/:module/*`,
    example: `${exampleHousehold}/modules/shopping`,
    dev: false,
    layout: 'household',
  },
  /** Whatever else is asked of a household: it opens nothing (F-17). */
  householdOther: {
    path: `${household}/*`,
    example: `${exampleHousehold}/no-such-page`,
    dev: false,
    layout: 'household',
  },

  /** The twelve-state harness: nine data bodies × twelve states × two themes, at 200 % text. */
  harness: { path: '/dev/harness', example: '/dev/harness', dev: true, layout: 'plain' },
  /** The primitives that carry no household data, each in its own states. */
  primitives: { path: '/dev/primitives', example: '/dev/primitives', dev: true, layout: 'plain' },
  /** The shell's own parts in their states: the sidebar, the switcher, the arrange screen. */
  devShell: { path: '/dev/shell', example: '/dev/shell', dev: true, layout: 'plain' },
  /** The sync UI in its states: the inbox, the two resolvers, the withdrawn treatment. */
  devSync: { path: '/dev/sync', example: '/dev/sync', dev: true, layout: 'plain' },
  /** Whatever no other route matches. */
  notFound: { path: '*', example: '/no-such-page', dev: false, layout: 'plain' },
} as const satisfies Record<string, RoutePath>

export type RouteId = keyof typeof paths

export const routeIds = Object.keys(paths) as RouteId[]

/**
 * `path` with each `:name` it holds replaced by `params`' value for it, and a trailing `/*`
 * by `rest`: the address of a route whose path is a pattern. A value is written as one segment
 * of a path, whatever it holds.
 */
export function fill(path: string, params: Readonly<Record<string, string>>, rest = ''): string {
  const filled = path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined) throw new Error(`fill: ${path} needs ${name}`)
    return encodeURIComponent(value)
  })
  if (!filled.endsWith('/*')) return filled
  const base = filled.slice(0, -2)
  return rest === '' ? base : `${base}/${rest.replace(/^\/+/, '')}`
}

/** The addresses of a household's own routes. */
export const inHousehold = {
  home: (householdId: string) => fill(paths.household.path, { householdId }),
  sync: (householdId: string) => fill(paths.sync.path, { householdId }),
  arrange: (householdId: string) => fill(paths.arrange.path, { householdId }),
  module: (householdId: string, module: string, rest = '') =>
    fill(paths.module.path, { householdId, module }, rest),
} as const
