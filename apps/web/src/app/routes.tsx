// The router's routes, one for each path of paths.ts, each drawn in the layout its path names:
// the plain one, the frame of the screens before sign-in, or the shell around an account or a
// household, which are a member's alone. Every screen is a file of its own, fetched when its
// address is opened: a first visit downloads the app and the one screen it opened at (D-153).
//
// The dev-only pages are named only where a build is told to have them: the development server,
// and the build the end-to-end suite runs against (`vite build --mode e2e`). Both conditions are
// constants of each build, so in every other one, whatever mode it is built in, the branch that
// imports the pages is dead code, and neither they nor the files they would load are written
// (build/check.ts holds the build a deployment serves to that).
import type { RouteObject } from 'react-router'
import { Signed, VisitorOnly } from './guards.tsx'
import { Home } from './Home.tsx'
import { NotAvailable } from './NotAvailable.tsx'
import { paths, routeIds, type Layout, type RouteId } from './paths.ts'
import { Public } from './Public.tsx'
import { Plain, Root } from './Root.tsx'
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
 * What stands in a screen's place while its file loads, on the visit that opens the app at it:
 * nothing. It is there for what it leaves the router free to draw around it. With no such place
 * named, the router draws nothing at all until the file has loaded or failed to, Root neither.
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
  return idsOf(layout, visitor).map((id) => ({ path: paths[id].path, ...pages[id] }))
}

/**
 * A household's routes, by their paths from the household's own, which is the shell's: the
 * shell is drawn at the household's address and reads the household from it, and each screen at
 * what follows.
 */
function underHousehold(): RouteObject[] {
  return idsOf('household').map((id): RouteObject => {
    const rest = paths[id].path.slice(paths.household.path.length).replace(/^\//, '')
    return rest === '' ? { index: true, ...pages[id] } : { path: rest, ...pages[id] }
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
          bounded([
            ...of('public', false),
            { Component: VisitorOnly, children: of('public', true) },
          ]),
        ],
      },
      {
        Component: Signed,
        children: [
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
        ],
      },
    ],
  },
]
