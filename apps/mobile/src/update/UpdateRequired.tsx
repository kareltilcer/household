// Placeholder: *please update* (06-clients §7, A-21, ADR 0010), the screen that stands in every
// other's place once the server has answered `400 update_required`.
// Owner: the session group (S1), which fills it once the primitives it is drawn with are merged.
// What decides it is here already: the session's `minimumVersion` (session/SessionProvider.tsx)
// puts this in every screen's place (session/Providers.tsx), its words are in the catalogs
// (`ui.update.required.title`, `device.update.body`, `device.update.action`), and its one action
// is store.ts's, drawn only where the build was told of a store page.
import { Screen } from '../ui/Screen.tsx'

export function UpdateRequired() {
  return <Screen testID="update-required" />
}
