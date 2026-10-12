// The router's routes, one for each path of paths.ts, each drawn in the layout its path names:
// the plain one, the frame of the screens before sign-in, or the shell around an account or a
// household, which are a member's alone. Every screen is a file of its own, fetched when its
// address is opened: a first visit downloads the app and the one screen it opened at (D-153),
// and with a screen's file the parts of the catalog its path says it reads (D-159). A shell is a
// file too, fetched with the first of its screens. What every route is drawn in is drawn before
// any of them has come, and stays where one fails (ADR 0025): a route that is a file stands
// under a place for what is loading and a boundary, `bounded`'s for a screen and `sheltered`'s
// for a shell. And a guard, which says whom its routes are drawn for, stands above the place of
// the files under it, so it is drawn while they load and sends on whoever they are not drawn
// for without waiting for them.
//
// The dev-only pages are named only where a build is told to have them: the development server,
// and the build the end-to-end suite runs against (`vite build --mode e2e`). Both conditions are
// constants of each build, so in every other one, whatever mode it is built in, the branch that
// imports the pages is dead code, and neither they nor the files they would load are written
// (build/check.ts holds the build a deployment serves to that).
import type { RouteObject } from 'react-router'
import { needWords } from '../i18n/catalogs.ts'
import { Signed, VisitorOnly, WaitingPage } from './guards.tsx'
import { Home } from './Home.tsx'
import { NotAvailable } from './NotAvailable.tsx'
import { paths, routeIds, type Layout, type RouteId, type RoutePath } from './paths.ts'
import { Public } from './Public.tsx'
import { Plain, Root } from './Root.tsx'
import { RootError, RouteError, ShellError } from './RouteError.tsx'

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
  notFound: { Component: NotAvailable },

  signIn: { lazy: async () => ({ Component: (await import('../auth/SignIn.tsx')).SignIn }) },
  secondStep: {
    lazy: async () => ({ Component: (await import('../auth/SecondStep.tsx')).SecondStep }),
  },
  recoveryCode: {
    lazy: async () => ({ Component: (await import('../auth/RecoveryCode.tsx')).RecoveryCode }),
  },
  providerReturn: {
    lazy: async () => ({ Component: (await import('../auth/ProviderReturn.tsx')).ProviderReturn }),
  },
  register: { lazy: async () => ({ Component: (await import('../auth/Register.tsx')).Register }) },
  verifySent: {
    lazy: async () => ({ Component: (await import('../auth/VerifySent.tsx')).VerifySent }),
  },
  verifyEmail: {
    lazy: async () => ({ Component: (await import('../auth/VerifyEmail.tsx')).VerifyEmail }),
  },
  reset: {
    lazy: async () => ({ Component: (await import('../auth/ResetRequest.tsx')).ResetRequest }),
  },
  resetSet: { lazy: async () => ({ Component: (await import('../auth/ResetSet.tsx')).ResetSet }) },
  graduate: { lazy: async () => ({ Component: (await import('../auth/Graduate.tsx')).Graduate }) },
  deletionCancel: {
    lazy: async () => ({ Component: (await import('../auth/DeletionCancel.tsx')).DeletionCancel }),
  },
  invitation: {
    lazy: async () => ({ Component: (await import('../household/Invitation.tsx')).Invitation }),
  },

  account: { lazy: async () => ({ Component: (await import('../account/Account.tsx')).Account }) },
  accountSecurity: {
    lazy: async () => ({ Component: (await import('../account/Security.tsx')).Security }),
  },
  accountSecondStep: {
    lazy: async () => ({
      Component: (await import('../account/SecondStepSetup.tsx')).SecondStepSetup,
    }),
  },
  accountDevices: {
    lazy: async () => ({ Component: (await import('../account/Devices.tsx')).Devices }),
  },
  accountNotifications: {
    lazy: async () => ({ Component: (await import('../account/Notifications.tsx')).Notifications }),
  },
  accountDelete: {
    lazy: async () => ({ Component: (await import('../account/DeleteAccount.tsx')).DeleteAccount }),
  },
  accountPrivacy: {
    lazy: async () => ({ Component: (await import('../privacy/Privacy.tsx')).Privacy }),
  },
  householdNew: {
    lazy: async () => ({ Component: (await import('../household/Create.tsx')).Create }),
  },

  household: {
    lazy: async () => ({
      Component: (await import('../household/HouseholdHome.tsx')).HouseholdHome,
    }),
  },
  sync: { lazy: async () => ({ Component: (await import('../sync/Inbox.tsx')).Inbox }) },
  arrange: { lazy: async () => ({ Component: (await import('../shell/Arrange.tsx')).Arrange }) },
  start: { lazy: async () => ({ Component: (await import('../household/Start.tsx')).Start }) },
  leave: { lazy: async () => ({ Component: (await import('../household/Leave.tsx')).Leave }) },
  settings: {
    lazy: async () => ({
      Component: (await import('../household/settings/Profile.tsx')).Profile,
    }),
  },
  settingsMembers: {
    lazy: async () => ({
      Component: (await import('../household/settings/Members.tsx')).Members,
    }),
  },
  settingsMember: {
    lazy: async () => ({
      Component: (await import('../household/settings/Member.tsx')).Member,
    }),
  },
  settingsInvitations: {
    lazy: async () => ({
      Component: (await import('../household/settings/Invitations.tsx')).Invitations,
    }),
  },
  settingsInvite: {
    lazy: async () => ({
      Component: (await import('../household/settings/Invite.tsx')).Invite,
    }),
  },
  settingsModules: {
    lazy: async () => ({
      Component: (await import('../household/settings/Modules.tsx')).Modules,
    }),
  },
  settingsStorage: {
    lazy: async () => ({ Component: (await import('../storage/Storage.tsx')).Storage }),
  },
  settingsBilling: {
    lazy: async () => ({ Component: (await import('../billing/Billing.tsx')).Billing }),
  },
  settingsSubscribe: {
    lazy: async () => ({ Component: (await import('../billing/Subscribe.tsx')).Subscribe }),
  },
  settingsTakeover: {
    lazy: async () => ({ Component: (await import('../billing/Takeover.tsx')).Takeover }),
  },
  settingsData: {
    lazy: async () => ({ Component: (await import('../privacy/Data.tsx')).Data }),
  },
  settingsExports: {
    lazy: async () => ({ Component: (await import('../privacy/Exports.tsx')).Exports }),
  },
  settingsSync: {
    lazy: async () => ({ Component: (await import('../health/SyncHealth.tsx')).SyncHealth }),
  },
  settingsDiagnostics: {
    lazy: async () => ({ Component: (await import('../health/Diagnostics.tsx')).Diagnostics }),
  },
  settingsClients: {
    lazy: async () => ({ Component: (await import('../health/Clients.tsx')).Clients }),
  },
  module: {
    lazy: async () => ({ Component: (await import('../modules/ModuleRoute.tsx')).ModuleRoute }),
  },
  householdOther: {
    lazy: async () => ({ Component: (await import('../shell/Elsewhere.tsx')).Elsewhere }),
  },

  ...(devPages
    ? {
        harness: {
          lazy: async () => ({ Component: (await import('../dev/harness/Harness.tsx')).Harness }),
        },
        primitives: {
          lazy: async () => ({ Component: (await import('../dev/Primitives.tsx')).Primitives }),
        },
        devShell: {
          lazy: async () => ({ Component: (await import('../dev/shell/DevShell.tsx')).DevShell }),
        },
        devSync: {
          lazy: async () => ({ Component: (await import('../dev/sync/DevSync.tsx')).DevSync }),
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
 * The page of the route `id`, with its words: where paths.ts names parts of the catalog that its
 * screen reads, they are fetched beside the screen's file, and the screen is drawn once both have
 * come. Either failing is the screen's file failing, and is named as that is (RouteError): a
 * file of the app's own whose import failed is not imported again. A screen that is no file of
 * its own is in the first download, which has the app's own words and no other.
 */
function pageOf(id: RouteId): Page | undefined {
  const page = pages[id]
  const { words }: RoutePath = paths[id]
  if (page === undefined || words === undefined) return page
  const { lazy } = page
  if (typeof lazy !== 'function') {
    throw new Error(`routes: ${id} names words, and its page fetches no file to fetch them with`)
  }
  return {
    ...page,
    lazy: async () => {
      const [screen] = await Promise.all([lazy(), needWords(words)])
      return screen
    },
  }
}

/**
 * What stands in a screen's place while its file loads, on the visit that opens the app at it:
 * nothing. It is there for what it leaves the router free to draw around it. With no such place
 * named, the router draws nothing at all until the file has loaded or failed to, Root neither.
 * Under a shell it is not what such a visit draws: the shell is a file above it, and the router
 * draws down to the shell's own place (`sheltered`) until both files have come.
 */
function Loading() {
  return null
}

/**
 * `screens` under the boundary a screen that fails stops at: one that fails to load or to draw
 * is named in its own place (RouteError), inside its layout, which stays, and Root with it, the
 * prompt of a newer build among it.
 */
function bounded(screens: RouteObject[]): RouteObject {
  return { ErrorBoundary: RouteError, HydrateFallback: Loading, children: screens }
}

/**
 * A member's `shells`, each a file as a screen is, under a boundary and a loading place of their
 * own. `bounded`'s two stand below a shell and are no use to the shell's own file: the router
 * draws down to the place named last at or above the first route whose file is still loading,
 * and names a failure at the nearest boundary at or above the route that failed. With neither
 * here, nothing at all was drawn until both files had come, Root neither, and a shell that
 * failed was named in Root's place, the prompt of a newer build gone with it.
 *
 * Both stand under `Signed`, which is so drawn while the shell loads: a visitor is sent to sign
 * in before the shell's file has come, the file being none of theirs, and a member is drawn the
 * shape of a page (WaitingPage) or the failure (ShellError), each in a landmark of its own,
 * since the shell is what gives a member's page its landmark.
 *
 * The router draws the address it opened at once, down to this place, and once more when every
 * file the address names has come or failed: the shape of a page stands until the screen's file
 * has come too, and a shell and its first screen are drawn together. And it asks for every file
 * of that address as it is made, before anything is drawn: a visitor is not kept waiting for
 * the shell and its screen, and their browser fetches both all the same.
 */
function sheltered(shells: RouteObject[]): RouteObject {
  return { ErrorBoundary: ShellError, HydrateFallback: WaitingPage, children: shells }
}

/**
 * The router's table for `screens` in the plain layout: each drawn inside Root and the page's
 * landmark. Root is drawn before a screen that is still loading, too, its watch listening by the
 * time the screen's file fails. The second boundary is for Root's own failure, which leaves
 * nothing to draw inside.
 */
export function inRoot(screens: RouteObject[]): RouteObject[] {
  return [
    {
      Component: Root,
      ErrorBoundary: RootError,
      children: [{ Component: Plain, children: [bounded(screens)] }],
    },
  ]
}

/** The served routes of `layout`: those a visitor alone is drawn, or the rest, where it says. */
function idsOf(layout: Layout, visitor?: boolean): RouteId[] {
  return served.filter((id) => {
    const route: { readonly layout: Layout; readonly visitor?: true } = paths[id]
    return (
      route.layout === layout && (visitor === undefined || (route.visitor ?? false) === visitor)
    )
  })
}

/** The served routes of `layout`, by their whole paths. */
function of(layout: Layout, visitor?: boolean): RouteObject[] {
  return idsOf(layout, visitor).map((id) => ({ path: paths[id].path, ...pageOf(id) }))
}

/**
 * A household's routes, by their paths from the household's own, which is the shell's: the
 * shell is drawn at the household's address and reads the household from it, and each screen at
 * what follows.
 */
function underHousehold(): RouteObject[] {
  return idsOf('household').map((id): RouteObject => {
    const rest = paths[id].path.slice(paths.household.path.length).replace(/^\//, '')
    return rest === '' ? { index: true, ...pageOf(id) } : { path: rest, ...pageOf(id) }
  })
}

export const routes: RouteObject[] = [
  {
    Component: Root,
    ErrorBoundary: RootError,
    children: [
      { Component: Plain, children: [bounded(of('plain'))] },
      {
        Component: Public,
        children: [
          bounded(of('public', false)),
          // The guard above its screens' place, as `Signed` is above a shell's: it is drawn
          // while a visitor's screen loads, and a member is sent on before the file has come.
          { Component: VisitorOnly, children: [bounded(of('public', true))] },
        ],
      },
      {
        Component: Signed,
        children: [
          sheltered([
            {
              lazy: async () => ({
                Component: (await import('../shell/AccountShell.tsx')).AccountShell,
              }),
              children: [bounded(of('account'))],
            },
            {
              path: paths.household.path,
              lazy: async () => ({
                Component: (await import('../shell/HouseholdShell.tsx')).HouseholdShell,
              }),
              children: [bounded(underHousehold())],
            },
          ]),
        ],
      },
    ],
  },
]
