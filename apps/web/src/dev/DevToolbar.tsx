// The dev pages' own controls: the language, the pseudo-locale among them, and the display modes.
// The member's settings screen for the same choices is item 25's; this is where they are switched
// while there is none, and where the pseudo-locale stays once there is. Its words are fixtures, as
// the harness's are (harness/model.ts).
import { locales, pseudoLocale, type DisplayLocale } from '@household/i18n'
import { useDisplay } from '../display/DisplayProvider.tsx'
import {
  densities,
  motions,
  themes,
  type DensityPreference,
  type MotionPreference,
  type ThemePreference,
} from '../display/modes.ts'
import { useI18n } from '../i18n/I18nProvider.tsx'
import { Select } from '../ui/Field.tsx'
import styles from './DevToolbar.module.css'
import { useSample } from './sample.ts'

const displayLocales: readonly DisplayLocale[] = [...locales, pseudoLocale]

function oneOf<T extends string>(values: readonly T[], value: string): T | undefined {
  return values.find((candidate) => candidate === value)
}

export function DevToolbar() {
  const sample = useSample()
  const { locale, setLocale } = useI18n()
  const { preferences, set } = useDisplay()
  const options = (values: readonly string[]) => values.map((value) => ({ value, label: value }))
  return (
    <div className={styles.toolbar}>
      <Select
        label={sample('Language')}
        options={options(displayLocales)}
        value={locale}
        onChange={(event) => {
          const next = oneOf(displayLocales, event.currentTarget.value)
          if (next !== undefined) setLocale(next)
        }}
      />
      <Select
        label={sample('Theme')}
        options={options(themes)}
        value={preferences.theme}
        onChange={(event) => {
          const theme = oneOf<ThemePreference>(themes, event.currentTarget.value)
          if (theme !== undefined) set({ theme })
        }}
      />
      <Select
        label={sample('Density')}
        options={options(densities)}
        value={preferences.density}
        onChange={(event) => {
          const density = oneOf<DensityPreference>(densities, event.currentTarget.value)
          if (density !== undefined) set({ density })
        }}
      />
      <Select
        label={sample('Motion')}
        options={options(motions)}
        value={preferences.motion}
        onChange={(event) => {
          const motion = oneOf<MotionPreference>(motions, event.currentTarget.value)
          if (motion !== undefined) set({ motion })
        }}
      />
    </div>
  )
}
