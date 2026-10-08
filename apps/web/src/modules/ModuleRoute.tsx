// A module's place in a household: its own screens, where the member holds the module and this
// build has screens for it, and the neutral *not available* screen in every other case (F-17,
// 03-patterns §2). A module the member holds `none` on, one the household has turned off, one
// that does not exist and one this build cannot open yet read the same: nothing here confirms
// that a household uses a module.
import { lazy, Suspense, useMemo } from 'react'
import { useParams } from 'react-router'
import { NotAvailable } from '../app/NotAvailable.tsx'
import { inHousehold } from '../app/paths.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { hasScreens, modules, type ModuleRegistry } from './registry.ts'

export interface ModuleRouteProps {
  /** The modules this build has screens for. Left out, the app's own; a test gives its own. */
  readonly registry?: ModuleRegistry
}

export function ModuleRoute({ registry = modules }: ModuleRouteProps) {
  const household = useHousehold()
  const { module = '' } = useParams()
  const level = household.my_grants?.[module]
  const screens = hasScreens(registry, module) ? registry[module] : undefined
  const Screens = useMemo(
    () =>
      screens === undefined
        ? undefined
        : lazy(async () => ({ default: (await screens.load()).Component })),
    [screens],
  )
  if (Screens === undefined || level === undefined || level === 'none') {
    return <NotAvailable home={inHousehold.home(household.id)} />
  }
  return (
    <Suspense fallback={null}>
      <Screens />
    </Suspense>
  )
}
