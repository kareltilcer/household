// The modules this build of the app has screens for. A module's mobile item adds its line here
// as it lands, and the shell lists a module only where the member holds it and this build can
// open it (shell/navigation.ts): a granted module with no screen yet is not a row that leads to
// nothing (D-160). Nothing here is a grant, and nothing here names a module to a member who does
// not hold it: the list is filtered by the household's own answer first.
//
// A module's screens are routes of the app's own, each a line of app/paths.ts and a file under
// app/, so that whatever walks the routes walks every one of them. What a module says here is
// where it opens, and where it takes a first record.
import type { ModuleKey } from '../household/data.ts'

export interface ModuleScreens {
  /** Where the module opens in `household`: the address of its first screen. */
  readonly home: (household: string) => string
  /**
   * Where the module takes a first record with nothing set up before it, its capture surface
   * (03-patterns §7), for a module that has such a screen. It is what the Add sheet offers, and
   * so what decides whether the tab bar has an Add at all (shell/tabs.ts).
   */
  readonly capture?: (household: string) => string
}

export type ModuleRegistry = Readonly<Partial<Record<ModuleKey, ModuleScreens>>>

/** The registry this build has: no module has a screen on a device yet. */
export const modules: ModuleRegistry = {}

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
