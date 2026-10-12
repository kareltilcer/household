// The dev screens' index: one button a screen, each by a `testID` the end-to-end flow presses.
// The list is the table of routes' own (src/app/paths.ts), so a dev screen that is a route is
// listed here without being named twice.
import { router } from 'expo-router'
import { paths, routeIds, type RouteId } from '../app/paths.ts'
import { Button } from '../ui/Button.tsx'
import { DevScreen } from './DevScreen.tsx'
import { useSample } from './sample.ts'

/** The dev screens but for this one, in the table's order. */
export const devRoutes: readonly RouteId[] = routeIds.filter((id) => paths[id].dev && id !== 'dev')

export default function DevIndex() {
  const sample = useSample()
  return (
    <DevScreen page="index" title={sample('Dev screens')}>
      {devRoutes.map((id) => (
        <Button
          key={id}
          testID={`dev-index:${id}`}
          onPress={() => {
            router.push(paths[id].path)
          }}
        >
          {paths[id].path}
        </Button>
      ))}
    </DevScreen>
  )
}
