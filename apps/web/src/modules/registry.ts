// The modules this build of the web app has screens for. A module's web item adds its line here
// as it lands (item 26 adds household settings, item 32 Shopping), and the shell lists a module
// only where the member is granted it and this build can open it (shell/navigation.ts): a
// granted module with no screen yet is not a link to nothing. Nothing here is a grant, and
// nothing here names a module to a member who does not hold it: the list is filtered by the
// household's own answer first.
import type { ComponentType } from 'react'
import type { ModuleKey } from '../household/households.ts'

export interface ModuleScreens {
  /**
   * Loads the module's screens: everything under its address,
   * `/households/{household}/modules/<module>/…`, routed by the module itself.
   */
  readonly load: () => Promise<{ readonly Component: ComponentType }>
}

export type ModuleRegistry = Readonly<Partial<Record<ModuleKey, ModuleScreens>>>

/** The registry a deployment's build has. */
export const modules: ModuleRegistry = {}

/** Whether `value` is a module this build has screens for. */
export function hasScreens(registry: ModuleRegistry, value: string): value is ModuleKey {
  return Object.hasOwn(registry, value)
}
