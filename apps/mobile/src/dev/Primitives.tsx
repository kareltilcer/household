// The primitives' dev screen: every component that needs no household's data, in every state it
// has. The page is the core's and its two sections are their groups', each a file of its own
// (primitives/controls, primitives/status), so that two groups at work at once never edit one
// page. What the core built itself is drawn first: the type scale, and the button.
import { typeScale, type TypeToken } from '@household/tokens'
import { controls } from '@household/icons'
import { View } from 'react-native'
import { ThemeScope, useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Button, IconButton, type ButtonVariant } from '../ui/Button.tsx'
import { BaseIcon } from '../ui/Icon.tsx'
import { Text } from '../ui/Text.tsx'
import { DevScreen } from './DevScreen.tsx'
import { ControlsSection } from './primitives/controls/index.tsx'
import { StatusSection } from './primitives/status/index.tsx'
import { useSample } from './sample.ts'

const steps = Object.keys(typeScale) as TypeToken[]
const variants: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger']

/** The button in each variant: idle, with a glyph, busy, and the icon-only one. */
function Buttons() {
  const sample = useSample()
  const t = useTranslate()
  const theme = useTheme()
  return (
    <View
      style={{
        gap: theme.space['space-1'],
        padding: theme.space['space-2'],
        backgroundColor: theme.color.surface,
      }}
    >
      {variants.map((variant) => (
        <View
          key={variant}
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['space-1'] }}
        >
          <Button variant={variant}>{sample('Save')}</Button>
          <Button variant={variant} icon={<BaseIcon name="plus" />}>
            {sample('Add a reading')}
          </Button>
          <Button variant={variant} loading>
            {sample('Saving')}
          </Button>
          <IconButton
            variant={variant}
            label={t(controls.close_sheet.labelKey)}
            icon={<BaseIcon name="x" />}
          />
        </View>
      ))}
    </View>
  )
}

export default function Primitives() {
  const sample = useSample()
  return (
    <DevScreen page="primitives" title={sample('Primitives')}>
      <Text step="title-3" header>
        {sample('Type')}
      </Text>
      {steps.map((step) => (
        <Text key={step} step={step}>
          {sample('Ďábelské ódy, 1 234,50')}
        </Text>
      ))}
      <Text step="title-3" header>
        {sample('Button')}
      </Text>
      <ThemeScope theme="light">
        <Buttons />
      </ThemeScope>
      <ThemeScope theme="dark">
        <Buttons />
      </ThemeScope>
      <ControlsSection />
      <StatusSection />
    </DevScreen>
  )
}
