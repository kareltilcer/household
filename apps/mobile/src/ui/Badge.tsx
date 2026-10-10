// A count (02-components §1): how many of something wait, drawn as a figure in a pill. It is
// never a bare dot, and never a colour alone: the figure is drawn, and what it counts is said in
// words, which its owner writes with the count in them ("3 changes need your attention"). The
// words are the badge's name for a screen reader; where the badge stands inside a control, a
// tab or a row, that control's own name carries them instead.
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { useFormat } from '../i18n/I18nProvider.tsx'
import { Text } from './Text.tsx'

export interface BadgeProps {
  readonly count: number
  /** The count in words, by its owner: what there are this many of. */
  readonly label: string
  readonly testID?: string
}

export function Badge({ count, label, testID = 'badge' }: BadgeProps) {
  const theme = useTheme()
  const format = useFormat()
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{
        alignSelf: 'flex-start',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: theme.space['space-1'],
        backgroundColor: theme.color['surface-inverse'],
        borderRadius: theme.radii['radius-pill'],
      }}
    >
      {/* The figure in the mono face, as every figure is: a 9 and a 10 are then one height. */}
      <Text step="num-sm" color="text-inverse">
        {format.number(count)}
      </Text>
    </View>
  )
}
