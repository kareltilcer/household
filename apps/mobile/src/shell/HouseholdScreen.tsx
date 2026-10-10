// What every screen of a household stands in, under its frame (HouseholdFrame.tsx): the app bar,
// which names the household and titles the screen, and under it the screen's own body, which
// scrolls. A screen of a household draws itself in this and never in `Screen` alone: the frame
// has taken the top of the device for the bars above every screen, and the tab bar its foot.
//
//   <HouseholdScreen title={t('shell.arrange.title')} back testID="route:arrange">…</HouseholdScreen>
import { router, useIsFocused } from 'expo-router'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { Screen } from '../ui/Screen.tsx'
import { AppBar } from './AppBar.tsx'
import { useHouseholdShown } from './HouseholdContext.tsx'
import { useBesideList } from './Panes.tsx'

export interface HouseholdScreenProps {
  /** The screen's title, drawn in the app bar as its header. */
  readonly title: string
  /**
   * Whether the screen is reached from another, and so may lead back to it: arranging the
   * modules is, a tab's own screen is not. The way back is drawn only where there is something
   * to go back to, and never beside the list in two panes.
   */
  readonly back?: boolean
  /** What the end-to-end flows find the screen by: `route:<id>` (app/paths.ts). */
  readonly testID?: string
  readonly children?: ReactNode
}

/** The edges of the device a household's screen still reaches: the frame and the bar took the others. */
const sides = ['left', 'right'] as const

export function HouseholdScreen({ title, back = false, testID, children }: HouseholdScreenProps) {
  const theme = useTheme()
  const household = useHouseholdShown()
  const beside = useBesideList()
  // Read again each time the screen comes to the front: a screen opened by a link has nothing
  // behind it, and the same screen opened from More a moment later has.
  useIsFocused()
  const leads = back && !beside && router.canGoBack()
  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <AppBar
        title={title}
        household={household.name}
        onBack={
          leads
            ? () => {
                router.back()
              }
            : undefined
        }
      />
      <Screen edges={sides}>{children}</Screen>
    </View>
  )
}
