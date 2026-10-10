// The offline bar (02-components §2, 06-clients §5): persistent, unobtrusive, and never in the
// way of what it sits above. A read looks the same with it as without. It is the offline status
// said three ways, its colour, its glyph and a sentence, and the sentence is the product's own
// (PRD 06 §5), which the shared key holds.
//
// It is drawn when the connection goes and is said then, once the screen reader has finished,
// as a banner that arrives is; and said again when its owner changes what it says, which is one
// bar whose words change where it stands (the household's bars, src/sync). A bar that was there
// when its screen opened is read in its place: its owner says so.
import { useEffect } from 'react'
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { announce as say } from './announce.ts'
import { StatusIcon } from './Icon.tsx'
import { Text } from './Text.tsx'

export interface OfflineBarProps {
  /**
   * What it says, where that is not that the device is offline: that the household's changes
   * are not arriving though everything else works (D-105).
   */
  readonly sentence?: string
  /** Whether it is said as it arrives and as its sentence changes. Left out, it is. */
  readonly announce?: boolean
  /** What an end-to-end flow finds it by. Left out, `offline-bar`. */
  readonly testID?: string
}

export function OfflineBar({ sentence, announce = true, testID = 'offline-bar' }: OfflineBarProps) {
  const t = useTranslate()
  const theme = useTheme()
  const said = sentence ?? t('ui.offline.bar')
  useEffect(() => {
    if (announce) say(said)
  }, [announce, said])
  return (
    <View
      testID={testID}
      // One thing to a screen reader: the sentence, which names the state the glyph draws.
      accessible
      accessibilityRole="text"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['space-1'],
        paddingVertical: theme.space['space-1'],
        paddingHorizontal: theme.space['space-2'],
        backgroundColor: theme.color['surface-sunken'],
        borderRadius: theme.radii['radius-control'],
      }}
    >
      <StatusIcon status="offline" />
      <Text step="caption" style={{ flex: 1 }}>
        {said}
      </Text>
    </View>
  )
}
