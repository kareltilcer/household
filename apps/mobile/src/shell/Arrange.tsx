// Arranging the modules (F-15, D-38, 04-navigation §5): a member's own order of their modules in
// this household, what they pinned above the rest, and what they put away. It is a preference
// and needs only `view`: every member has it, a child among them. *Hidden by me* is recoverable,
// and this screen is the one place it is named. A module the member does not hold is not in any
// list here, is not counted, and is mentioned nowhere: absent, with no trace.
//
// Nothing is dragged. A row is moved from its menu, *Move up* and *Move down*, and by a screen
// reader from its handle, which is what the platforms call adjustable: the two moves are its
// own actions, each under its translated name, and where the row has come to is said. A row
// that is pinned, unpinned, put away or shown again leaves the list it was in for another: that
// is said too, and the focus goes with the row to where it now is, the control that held it
// having left with the row's old place (D-166's twin).
//
// The arrangement is kept on this device (D-155, arrangement.ts), which decides this screen's
// states. The household's frame has read it before this is drawn, so it is never loading, and
// never fails to load; it is written to no server, so a change is never pending, syncing,
// conflicted or rejected; with no connection it works as with one; and a household that is
// read-only holds none of it back, it being the member's and not the household's. A module
// withdrawn while the screen is open leaves its list with no word said beside it: this is not
// where a member learns of a change of access.
import { controls } from '@household/icons'
import { remPx } from '@household/tokens'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { useDisplay, useTarget, useTheme } from '../display/DisplayProvider.tsx'
import type { Household, ModuleKey } from '../household/data.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { modules, type ModuleRegistry } from '../modules/registry.ts'
import { announce, focusOn } from '../ui/announce.ts'
import { IconButton } from '../ui/Button.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { BaseIcon, ModuleIcon } from '../ui/Icon.tsx'
import { Menu, type MenuItem } from '../ui/Menu.tsx'
import { RowAction } from '../ui/RowAction.tsx'
import { Text } from '../ui/Text.tsx'
import { useArrangement, useHouseholdShown } from './HouseholdContext.tsx'
import { HouseholdScreen } from './HouseholdScreen.tsx'
import {
  arrangeable,
  hidden,
  moved,
  navigationOf,
  pinned,
  shown,
  unpinned,
  type Arrangement,
} from './navigation.ts'

export interface ArrangeListsProps {
  readonly household: Pick<Household, 'my_grants'>
  /** The modules this build has screens for. */
  readonly registry: ModuleRegistry
  /** The member's arrangement, and what changes it: the device's own keeps it, a dev page's does not. */
  readonly arrangement: Arrangement
  readonly onArrange: (next: Arrangement) => void
}

/** The least a section is wide before the next one goes under it, in rem. */
const sectionRem = 14

/** The lists themselves, under whatever titles them: the screen's own bar, or a dev page. */
export function ArrangeLists({ household, registry, arrangement, onArrange }: ArrangeListsProps) {
  const t = useTranslate()
  const format = useFormat()
  const theme = useTheme()
  const target = useTarget()
  const { textScale } = useDisplay()
  const navigation = navigationOf(household, registry, arrangement)
  // The row that last went from one list to another, to be followed there: a new value for each
  // such change, so that a row that goes back and forth is followed each time.
  const [followed, setFollowed] = useState<{ readonly module: ModuleKey } | null>(null)
  // What a screen reader meets first of each row, by its module: its handle where it has one,
  // and its name where it has none.
  const firsts = useRef(new Map<ModuleKey, View>())
  const first = (module: ModuleKey) => (element: View | null) => {
    if (element === null) return undefined
    firsts.current.set(module, element)
    return () => {
      if (firsts.current.get(module) === element) firsts.current.delete(module)
    }
  }
  useEffect(() => {
    if (followed === null) return
    const element = firsts.current.get(followed.module)
    if (element !== undefined) focusOn({ current: element })
  }, [followed])
  const name = (module: ModuleKey) => t(`module.${module}.name`)

  /** Takes `module` to another list: it is said, and the focus follows the row there. */
  const went = (module: ModuleKey, next: Arrangement, sentence: string) => {
    onArrange(next)
    announce(sentence)
    setFollowed({ module })
  }

  /** Moves `module` within `list`, and says where it has come to: at an end, where it still is. */
  const move = (module: ModuleKey, list: readonly ModuleKey[], by: number) => {
    const at = Math.min(list.length - 1, Math.max(0, list.indexOf(module) + by))
    onArrange(moved(arrangement, navigation, module, by))
    announce(
      t('shell.arrange.position', {
        name: name(module),
        position: format.number(at + 1),
        count: format.number(list.length),
      }),
    )
  }

  /** A row's glyph and its name: one thing to a screen reader, which reads the name. */
  const words = (module: ModuleKey, leads: boolean) => (
    <View
      ref={leads ? first(module) : undefined}
      testID={`arrange:name:${module}`}
      accessible
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['space-15'],
      }}
    >
      <ModuleIcon module={module} color={`accent-${module}`} />
      <Text style={{ flex: 1 }}>{name(module)}</Text>
    </View>
  )

  const row = (module: ModuleKey, children: ReactNode) => (
    <View
      key={module}
      testID={`arrange:row:${module}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['space-1'],
        minHeight: target,
      }}
    >
      {children}
    </View>
  )

  /** A row of a list that has an order: its handle, its name, and what else can be done to it. */
  const ordered = (module: ModuleKey, list: readonly ModuleKey[], more: readonly MenuItem[]) => {
    const at = list.indexOf(module)
    // A row at an end of its list has no move past it: the move is absent, not disabled.
    const up = at > 0
    const down = at < list.length - 1
    const items: MenuItem[] = [
      ...(up
        ? [
            {
              id: 'up',
              testID: `arrange:${module}:up`,
              label: t('shell.arrange.move_up'),
              onSelect: () => {
                move(module, list, -1)
              },
            },
          ]
        : []),
      ...(down
        ? [
            {
              id: 'down',
              testID: `arrange:${module}:down`,
              label: t('shell.arrange.move_down'),
              onSelect: () => {
                move(module, list, 1)
              },
            },
          ]
        : []),
      ...more,
    ]
    return row(
      module,
      <>
        {/* The one row of a list has nowhere to be moved to, and no handle. */}
        {up || down ? (
          <View
            ref={first(module)}
            testID={`arrange:handle:${module}`}
            accessible
            // What takes a step either way by a screen reader's own gesture, and by nothing a
            // finger does: no press moves a row, so this is no button.
            accessibilityRole="adjustable"
            accessibilityLabel={t('device.shell.arrange.reorder', { name: name(module) })}
            accessibilityActions={[
              ...(up ? [{ name: 'increment', label: t('shell.arrange.move_up') }] : []),
              ...(down ? [{ name: 'decrement', label: t('shell.arrange.move_down') }] : []),
            ]}
            onAccessibilityAction={({ nativeEvent }) => {
              // Up the screen is up the list.
              if (nativeEvent.actionName === 'increment') move(module, list, -1)
              if (nativeEvent.actionName === 'decrement') move(module, list, 1)
            }}
            style={{
              minHeight: target,
              minWidth: target,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <BaseIcon name={controls.reorder.glyph.id} color="text-muted" />
          </View>
        ) : null}
        {words(module, !(up || down))}
        <Menu
          trigger={
            <IconButton
              testID={`arrange:menu:${module}`}
              label={t(controls.more_actions.labelKey, { name: name(module) })}
              icon={<BaseIcon name={controls.more_actions.glyph.id} />}
            />
          }
          items={items}
        />
      </>,
    )
  }

  const section = (id: string, title: string, children: ReactNode) => (
    <View
      testID={`arrange:${id}`}
      style={{
        // Side by side where there is room for them, which a tablet has, and one under another
        // where there is not: the room is counted in the reader's text.
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: sectionRem * remPx * textScale,
        gap: theme.space['space-1'],
      }}
    >
      <Text step="title-3" header>
        {title}
      </Text>
      {children}
    </View>
  )

  if (!arrangeable(navigation)) {
    return (
      <View testID="arrange:empty" style={{ gap: theme.space['space-1'] }}>
        <Text step="title-3" header>
          {t('shell.arrange.empty.title')}
        </Text>
        <EmptyState sentence={t('shell.arrange.empty.body')} />
      </View>
    )
  }
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: theme.space['space-3'],
        rowGap: theme.space['space-3'],
      }}
    >
      {navigation.pinned.length === 0
        ? null
        : section(
            'pinned',
            t('shell.sidebar.pinned'),
            navigation.pinned.map((module) =>
              ordered(module, navigation.pinned, [
                {
                  id: 'unpin',
                  testID: `arrange:${module}:unpin`,
                  label: t('shell.arrange.unpin'),
                  onSelect: () => {
                    went(
                      module,
                      unpinned(arrangement, navigation, module),
                      t('shell.arrange.said.unpinned', { name: name(module) }),
                    )
                  },
                },
              ]),
            ),
          )}
      {navigation.listed.length === 0
        ? null
        : section(
            'order',
            t('shell.arrange.order'),
            navigation.listed.map((module) =>
              ordered(module, navigation.listed, [
                {
                  id: 'pin',
                  testID: `arrange:${module}:pin`,
                  label: t('shell.arrange.pin'),
                  onSelect: () => {
                    went(
                      module,
                      pinned(arrangement, navigation, module),
                      t('shell.arrange.said.pinned', { name: name(module) }),
                    )
                  },
                },
                {
                  id: 'hide',
                  testID: `arrange:${module}:hide`,
                  label: t('shell.arrange.hide'),
                  onSelect: () => {
                    went(
                      module,
                      hidden(arrangement, navigation, module),
                      t('shell.arrange.said.hidden', { name: name(module) }),
                    )
                  },
                },
              ]),
            ),
          )}
      {section(
        'hidden',
        t('shell.arrange.hidden'),
        navigation.hidden.length === 0 ? (
          <Text color="text-muted">{t('shell.arrange.hidden.none')}</Text>
        ) : (
          navigation.hidden.map((module) =>
            row(
              module,
              <>
                {words(module, true)}
                <RowAction
                  testID={`arrange:${module}:show`}
                  name={t('shell.arrange.show_named', { name: name(module) })}
                  word={t('shell.arrange.show')}
                  onPress={() => {
                    went(
                      module,
                      shown(arrangement, navigation, module),
                      t('shell.arrange.said.shown', { name: name(module) }),
                    )
                  }}
                />
              </>,
            ),
          )
        ),
      )}
    </View>
  )
}

/** The screen: its title, what it is and where it is kept, and the lists. */
export function Arrange() {
  const t = useTranslate()
  const household = useHouseholdShown()
  const [arrangement, arrange] = useArrangement()
  return (
    <HouseholdScreen title={t('shell.arrange.title')} back testID="route:arrange">
      <Text>{t('shell.arrange.lede')}</Text>
      <Text color="text-muted">{t('device.shell.arrange.kept_here')}</Text>
      <ArrangeLists
        household={household}
        registry={modules}
        arrangement={arrangement}
        onArrange={arrange}
      />
    </HouseholdScreen>
  )
}
