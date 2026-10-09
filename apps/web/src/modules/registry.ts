// The modules this build of the web app has screens for. A module's web item adds its line here
// as it lands (item 26 added household settings, item 32 adds Shopping), and the shell lists a
// module only where the member holds it and this build can open it (shell/navigation.ts): a
// granted module with no screen yet is not a link to nothing. Nothing here is a grant, and
// nothing here names a module to a member who does not hold it: the list is filtered by the
// household's own answer first.
//
// A module's screens are routes of the app's own, each a line of app/paths.ts, so that the walk
// of the routes holds every one of them to the gates (06-clients §8). What a module says here is
// where it opens, and where it takes a first record.
import { inHousehold } from '../app/paths.ts'
import type { ModuleKey } from '../household/households.ts'

export interface ModuleScreens {
  /** Where the module opens in `household`: the address of its first screen. */
  readonly home: (household: string) => string
  /**
   * Where the module takes a first record with nothing set up before it, its capture surface
   * (03-patterns §7), for a module that has such a screen: what the first run's question offers
   * (DD-6, household/Start.tsx).
   */
  readonly capture?: (household: string) => string
}

export type ModuleRegistry = Readonly<Partial<Record<ModuleKey, ModuleScreens>>>

/** The registry a deployment's build has. */
export const modules: ModuleRegistry = {
  admin: { home: inHousehold.settings },
}

/** Whether `value` is a module this build has screens for. */
export function hasScreens(registry: ModuleRegistry, value: string): value is ModuleKey {
  return Object.hasOwn(registry, value)
}

/** Where `module` opens in `household`, in a build with `registry`'s screens: nowhere if it has none. */
export function homeOf(
  registry: ModuleRegistry,
  module: ModuleKey,
  household: string,
): string | undefined {
  return registry[module]?.home(household)
}
