// What every dev screen stands in: the screen itself, its title, the dev toolbar, and the marker
// in its `testID`, which is how the end-to-end flow knows a dev screen is open and how the check
// of a production export knows that none is in it (marker.ts).
import type { ReactNode } from 'react'
import { Screen } from '../ui/Screen.tsx'
import { DevToolbar } from './DevToolbar.tsx'
import { devMarker, type DevPage } from './marker.ts'

export interface DevScreenProps {
  readonly page: DevPage
  /** A fixture, through `useSample`: a dev screen's words are in no catalog. */
  readonly title: string
  readonly children?: ReactNode
}

export function DevScreen({ page, title, children }: DevScreenProps) {
  return (
    <Screen title={title} testID={`${devMarker}:${page}`}>
      <DevToolbar />
      {children}
    </Screen>
  )
}
