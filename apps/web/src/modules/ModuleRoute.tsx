// A module by its name, `/households/{household}/modules/<module>`: it leads to where the module
// opens, for one the member holds and this build has screens for, and shows the neutral *not
// available* screen in every other case (F-17, 03-patterns §2). A module the member holds `none`
// on, one the household has turned off, one that does not exist and one this build cannot open
// yet read the same: nothing here confirms that a household uses a module.
import { Navigate, useParams } from 'react-router'
import { NotAvailable } from '../app/NotAvailable.tsx'
import { inHousehold } from '../app/paths.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { heldModules } from '../shell/navigation.ts'
import { hasScreens, homeOf, modules, type ModuleRegistry } from './registry.ts'

export interface ModuleRouteProps {
  /** The modules this build has screens for. Left out, the app's own; a test gives its own. */
  readonly registry?: ModuleRegistry
}

export function ModuleRoute({ registry = modules }: ModuleRouteProps) {
  const household = useHousehold()
  const { module = '' } = useParams()
  const home =
    hasScreens(registry, module) && heldModules(household).includes(module)
      ? homeOf(registry, module, household.id)
      : undefined
  if (home === undefined) return <NotAvailable home={inHousehold.home(household.id)} />
  return <Navigate to={home} replace />
}
