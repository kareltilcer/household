// The dev screens' own controls: the language, the pseudo-locale among them, the theme, the
// text scale held at 100 or at 200 % whatever the device says, and motion. A member chooses the
// theme and motion in their account's settings (item 29) and the text size in the device's; the
// pseudo-locale and a held scale are chosen here alone. Its words are fixtures.
//
// Each control is a button that goes to its next value and says the one in force: one press a
// value, which the end-to-end flow makes by `testID`, where a chooser would be a sheet to open.
import { locales, pseudoLocale, type DisplayLocale } from '@household/i18n'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useDisplay, useTheme } from '../display/DisplayProvider.tsx'
import { motions, themes } from '../display/modes.ts'
import { useI18n } from '../i18n/I18nProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { useSample } from './sample.ts'

const displayLocales: readonly DisplayLocale[] = [...locales, pseudoLocale]

/** The scale a dev screen holds the text at: the device's own, or one of the two the design is held to. */
const scales = [undefined, 1, 2] as const

/** The value after `value` in `values`, the first after the last. */
function next<T>(values: readonly T[], value: T): T {
  return values[(values.indexOf(value) + 1) % values.length] ?? value
}

export function DevToolbar() {
  const sample = useSample()
  const theme = useTheme()
  const { locale, setLocale } = useI18n()
  const { preferences, set, hold } = useDisplay()
  const [scale, setScale] = useState<(typeof scales)[number]>(undefined)
  // Held for as long as this toolbar is drawn, and let go with it: no screen after a dev screen
  // is left at a scale the device is not set to.
  useEffect(() => (scale === undefined ? undefined : hold({ scale })), [scale, hold])

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['space-1'] }}>
      <Button
        testID="dev-toolbar:language"
        onPress={() => {
          setLocale(next(displayLocales, locale))
        }}
      >
        {`${sample('Language')}: ${locale}`}
      </Button>
      <Button
        testID="dev-toolbar:theme"
        onPress={() => {
          set({ theme: next(themes, preferences.theme) })
        }}
      >
        {`${sample('Theme')}: ${preferences.theme}`}
      </Button>
      <Button
        testID="dev-toolbar:scale"
        onPress={() => {
          setScale(next(scales, scale))
        }}
      >
        {`${sample('Text')}: ${scale === undefined ? sample('device') : String(scale * 100)}`}
      </Button>
      <Button
        testID="dev-toolbar:motion"
        onPress={() => {
          set({ motion: next(motions, preferences.motion) })
        }}
      >
        {`${sample('Motion')}: ${preferences.motion}`}
      </Button>
    </View>
  )
}
