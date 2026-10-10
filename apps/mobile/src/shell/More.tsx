// More (04-navigation §3): every module the member holds that this build can open, in their own
// order, and after them the rows that are no module's: arranging the list, what needs their
// attention, and the way out.
//
// The module list is derived and never authored (navigation.ts): the modules the household's
// own answer grants this member, of those this build has screens for, in the order the member
// put them. A module they do not hold is not in it, is not counted, and is mentioned nowhere.
// It is a list and no tree, and nothing is written from it, so it has no pending, syncing,
// conflicted or rejected state to be in; while the household is being read nothing of the shell
// is drawn at all (HouseholdFrame.tsx), so no module is drawn for a moment that the member does
// not hold; and a household's read-only state changes nothing here, navigation being a read.
//
// A row that would lead to nothing is absent. Arranging needs something to arrange. The way to
// what needs attention is drawn only while something does, with its count: in sync is the
// absence of an indicator (06-clients §5), and a row to an empty inbox would be one. No build
// has a module's screens yet, so today the list is the way out alone, and says nothing of what
// is not there.
import { router } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { inHousehold } from '../app/paths.ts'
import { useTarget, useTheme } from '../display/DisplayProvider.tsx'
import type { Household, ModuleKey } from '../household/data.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { homeOf, modules, type ModuleRegistry } from '../modules/registry.ts'
import { Badge } from '../ui/Badge.tsx'
import { BaseIcon, ModuleIcon } from '../ui/Icon.tsx'
import { List } from '../ui/ListRow.tsx'
import { Text } from '../ui/Text.tsx'
import { useArrangement, useHouseholdShown } from './HouseholdContext.tsx'
import { HouseholdScreen } from './HouseholdScreen.tsx'
import { arrangeable, navigationOf, type Arrangement } from './navigation.ts'
import { SignOut } from './SignOut.tsx'
import { useWaiting } from './waiting.ts'

interface NavRowProps {
  /** Where it leads: an address of the app's own. */
  readonly to: string
  /** A glyph before the words, as decoration. */
  readonly icon?: ReactNode
  /** What stands after the words: a count of what waits there. */
  readonly trailing?: ReactNode
  /** The words, which are its name. */
  readonly children: string
  readonly testID: string
}

/** A row of More: the whole row is the way on, named by its words. */
function NavRow({ to, icon, trailing, children, testID }: NavRowProps) {
  const theme = useTheme()
  const target = useTarget()
  // A keyboard's focus, or a switch's: a touch gives none.
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      // Its words and nothing after them: a count beside them is in the words already.
      accessibilityLabel={children}
      onPress={() => {
        router.navigate(to)
      }}
      onFocus={() => {
        setFocused(true)
      }}
      onBlur={() => {
        setFocused(false)
      }}
      style={({ pressed }) => ({
        alignSelf: 'stretch',
        minHeight: target,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['space-15'],
        paddingVertical: theme.density['dens-pad-y'],
        paddingHorizontal: theme.space['space-1'],
        borderRadius: theme.radii['radius-control'],
        backgroundColor: pressed ? theme.color['surface-sunken'] : 'transparent',
        ...(focused
          ? {
              outlineWidth: 2,
              outlineStyle: 'solid' as const,
              outlineOffset: -2,
              outlineColor: theme.color.focus,
            }
          : {}),
      })}
    >
      {icon}
      <Text style={{ flex: 1 }}>{children}</Text>
      {trailing}
      {/* That it leads on is said by its role, and shown by more than the row's place. */}
      <BaseIcon name="chevron-right" color="text-muted" />
    </Pressable>
  )
}

export interface MoreListProps {
  readonly household: Pick<Household, 'id' | 'my_grants'>
  /** The modules this build has screens for. */
  readonly registry: ModuleRegistry
  /** The member's own arrangement of this household's modules. */
  readonly arrangement: Arrangement
  /** How many changes wait for the member's answer (F-5). */
  readonly waiting: number
}

/** The rows themselves, under whatever titles them: the screen's own bar, or a dev page. */
export function MoreList({ household, registry, arrangement, waiting }: MoreListProps) {
  const t = useTranslate()
  const theme = useTheme()
  const navigation = navigationOf(household, registry, arrangement)
  const row = (module: ModuleKey) => (
    <NavRow
      key={module}
      testID={`more:module:${module}`}
      // Where the module opens.
      to={homeOf(registry, module, household.id) ?? inHousehold.module(household.id, module)}
      icon={<ModuleIcon module={module} color={`accent-${module}`} />}
    >
      {t(`module.${module}.name`)}
    </NavRow>
  )
  const group = (label: string, list: readonly ModuleKey[]) =>
    list.length === 0 ? null : (
      <View style={{ gap: theme.space['space-05'] }}>
        <Text step="overline" color="text-muted" header>
          {label}
        </Text>
        <List label={label}>{list.map(row)}</List>
      </View>
    )
  return (
    <>
      {group(t('shell.sidebar.pinned'), navigation.pinned)}
      {group(t('shell.sidebar.modules'), navigation.listed)}
      {/* Arranging needs something to arrange: with no module to list, its way in is absent. */}
      {arrangeable(navigation) ? (
        <NavRow testID="more:arrange" to={inHousehold.arrange(household.id)}>
          {t('shell.sidebar.arrange')}
        </NavRow>
      ) : null}
      {waiting > 0 ? (
        <NavRow
          testID="more:sync"
          to={inHousehold.sync(household.id)}
          trailing={
            // The row's own words say what the number counts: the figure is not read again.
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Badge count={waiting} label={t('shell.sidebar.attention', { count: waiting })} />
            </View>
          }
        >
          {t('shell.sidebar.attention', { count: waiting })}
        </NavRow>
      ) : null}
    </>
  )
}

export function More() {
  const t = useTranslate()
  const household = useHouseholdShown()
  const [arrangement] = useArrangement()
  const waiting = useWaiting()
  return (
    <HouseholdScreen title={t('device.nav.more')} testID="route:more">
      <MoreList
        household={household}
        registry={modules}
        arrangement={arrangement}
        waiting={waiting}
      />
      <View style={{ alignItems: 'flex-start' }}>
        <SignOut />
      </View>
    </HouseholdScreen>
  )
}
