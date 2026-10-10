// The app bar (F-14, 04-navigation §6): which household this is, and under it the screen's
// title, with the way back where there is one. Which household a member is in is in the address
// and nowhere else (D-4), so it is said on every screen where something of a household can be
// done, first, before the title, which is the order a screen reader meets them in.
//
// The title is the screen's header: what a screen reader names the screen by and moves between
// (D-165's twin). Nothing else on a screen is titled so, and the navigator draws no header of
// its own.
//
// The bar holds no search and no action of a screen's: search is item 38's, and a screen's own
// actions stand in the screen.
import { controls } from '@household/icons'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTarget, useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { IconButton } from '../ui/Button.tsx'
import { BaseIcon } from '../ui/Icon.tsx'
import { Text } from '../ui/Text.tsx'

export interface HouseholdNameProps {
  /** The household's name, as its members wrote it. */
  readonly name: string
  /**
   * Opens the switcher. Left out, the name is a label: with one prop it is the switcher's
   * control, named for what it does and for the household that is open, which is item 29's to
   * give it once a member's other households have a screen to be chosen on.
   */
  readonly onSwitch?: (() => void) | undefined
}

/** The household that is open: a label, or the control that switches to another. */
export function HouseholdName({ name, onSwitch }: HouseholdNameProps) {
  const t = useTranslate()
  const theme = useTheme()
  const target = useTarget()
  if (onSwitch === undefined) {
    return (
      <Text testID="app-bar:household" step="caption" color="text-muted" weight={600}>
        {name}
      </Text>
    )
  }
  return (
    <Pressable
      testID="app-bar:household"
      accessibilityRole="button"
      // Its name holds the word that is drawn, the household's own (WCAG 2.5.3).
      accessibilityLabel={t(controls.switch_household.labelKey, { household: name })}
      onPress={onSwitch}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        minHeight: target,
        minWidth: target,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['space-05'],
        borderRadius: theme.radii['radius-control'],
        backgroundColor: pressed ? theme.color['surface-sunken'] : 'transparent',
      })}
    >
      <Text step="caption" weight={600} style={{ flexShrink: 1 }}>
        {name}
      </Text>
      <BaseIcon name={controls.switch_household.glyph.id} color="text-muted" />
    </Pressable>
  )
}

export interface AppBarProps {
  /** The screen's title: its one header. */
  readonly title: string
  /** The household whose screen this is. Left out on a screen that is no household's. */
  readonly household?: string | undefined
  /** Opens the household switcher (item 29): see `HouseholdName`. */
  readonly onSwitch?: (() => void) | undefined
  /** Goes back. Left out where there is nothing to go back to, and beside a list in two panes. */
  readonly onBack?: (() => void) | undefined
}

export function AppBar({ title, household, onSwitch, onBack }: AppBarProps) {
  const t = useTranslate()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View
      testID="app-bar"
      style={{
        gap: theme.space['space-05'],
        paddingTop: theme.space['space-1'],
        paddingBottom: theme.space['space-1'],
        paddingLeft: insets.left + theme.density['dens-pad-x'],
        paddingRight: insets.right + theme.density['dens-pad-x'],
        backgroundColor: theme.color.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.color['border-subtle'],
      }}
    >
      {household === undefined ? null : <HouseholdName name={household} onSwitch={onSwitch} />}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['space-1'] }}>
        {onBack === undefined ? null : (
          <IconButton
            testID="app-bar:back"
            label={t(controls.back.labelKey)}
            icon={<BaseIcon name={controls.back.glyph.id} />}
            onPress={() => {
              onBack()
            }}
          />
        )}
        <Text testID="app-bar:title" step="title-3" header style={{ flex: 1 }}>
          {title}
        </Text>
      </View>
    </View>
  )
}
