// What every dev screen stands in: the screen itself, its title, the dev toolbar, and the marker
// in its `testID`, which is how the end-to-end flow knows a dev screen is open and how the check
// of a production export knows that none is in it (marker.ts).
//
// And, on every dev screen but the index, the way to the index. A dev screen is reached from
// the sign-in screen's own control, which leads to one of them, and from there this leads to
// the rest: by a press, with no address to type. A link would do it too, but iOS asks before
// it opens one that came from outside the app (*Open in "Household Dev"?*), in a dialog of its
// own that no flow can find by a `testID`; so the flows walk here (e2e/flows/parts/dev.yaml),
// and so does a developer with a build on a phone. Its name is its address, which is data.
//
// A screen that is many screens long names its parts, and can then be narrowed to one of them
// (Only.tsx).
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { paths } from '../app/paths.ts'
import { Button } from '../ui/Button.tsx'
import { Screen } from '../ui/Screen.tsx'
import { DevToolbar } from './DevToolbar.tsx'
import { devMarker, type DevPage } from './marker.ts'
import { Only } from './Only.tsx'

export interface DevScreenProps {
  readonly page: DevPage
  /** A fixture, through `useSample`: a dev screen's words are in no catalog. */
  readonly title: string
  /**
   * The parts the screen can be narrowed to, each of which it draws in a `Shown`: a control
   * for each stands under the toolbar, `<page>:only:<part>`. Left out, a screen short enough
   * to be read whole.
   */
  readonly parts?: readonly string[]
  readonly children?: ReactNode
}

export function DevScreen({ page, title, parts, children }: DevScreenProps) {
  return (
    <Screen title={title} testID={`${devMarker}:${page}`}>
      <DevToolbar />
      {page === 'index' ? null : (
        <Button
          variant="ghost"
          testID="dev-screen:index"
          onPress={() => {
            router.push(paths.dev.path)
          }}
        >
          {paths.dev.path}
        </Button>
      )}
      {parts === undefined ? (
        children
      ) : (
        <Only page={page} parts={parts}>
          {children}
        </Only>
      )}
    </Screen>
  )
}
