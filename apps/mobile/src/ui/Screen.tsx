// What every screen stands in: the theme's ground, the device's safe area, a body that scrolls,
// and the screen's title as a header, which is what a screen reader names the screen by and
// moves to first (D-165's twin). A screen under the shell's app bar gives its title there and
// none here.
import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../display/DisplayProvider.tsx'
import { Text } from './Text.tsx'

export interface ScreenProps {
  /** The screen's title, drawn as its header. Left out where a bar above the screen says it. */
  readonly title?: string
  /**
   * The edges of the device this screen reaches, and so keeps its content clear of. Left out,
   * all four: a screen under a bar of the shell's names the ones the shell has not taken.
   */
  readonly edges?: readonly ('top' | 'bottom' | 'left' | 'right')[]
  readonly testID?: string
  readonly children?: ReactNode
}

const all = ['top', 'bottom', 'left', 'right'] as const

export function Screen({ title, edges = all, testID, children }: ScreenProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const inset = (edge: (typeof all)[number]) => (edges.includes(edge) ? insets[edge] : 0)
  return (
    <View
      testID={testID}
      style={{
        flex: 1,
        backgroundColor: theme.color.surface,
        paddingTop: inset('top'),
        paddingLeft: inset('left'),
        paddingRight: inset('right'),
      }}
    >
      <ScrollView
        // A press on a control goes to the control, with a keyboard up as without one.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          gap: theme.space['space-2'],
          paddingHorizontal: theme.density['dens-pad-x'],
          paddingTop: theme.space['space-2'],
          paddingBottom: theme.space['space-3'] + inset('bottom'),
        }}
      >
        {title === undefined ? null : (
          <Text step="title-2" header>
            {title}
          </Text>
        )}
        {children}
      </ScrollView>
    </View>
  )
}
