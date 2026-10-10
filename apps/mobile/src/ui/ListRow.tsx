// The list row (02-components §3), the workhorse: a title, an optional secondary line, an optional
// module chip and member avatar, the sync mark of a row whose own write is not in sync yet, and a
// trailing action. A row in sync carries no mark. A row wraps and grows with its words and is
// never held to a height: at 200 % text the mark and the action go under the words. The
// contract is the web's (apps/web/src/ui/ListRow.tsx).
import { remPx } from '@household/tokens'
import { Children, Fragment, type ReactNode } from 'react'
import { View } from 'react-native'
import { useDisplay, useTarget, useTheme } from '../display/DisplayProvider.tsx'
import { SyncMark, type SyncState } from './StatusMark.tsx'
import { Text } from './Text.tsx'

export interface ListProps {
  /** What the list is of, for assistive technology. */
  readonly label: string
  readonly children: ReactNode
  readonly testID?: string
}

export function List({ label, children, testID }: ListProps) {
  const theme = useTheme()
  const rows = Children.toArray(children)
  return (
    // Not one thing to a screen reader, which would close its rows and their controls to it: a
    // list by its role, that holds them.
    <View testID={testID} role="list" aria-label={label}>
      {rows.map((row, index) => (
        // A rule between two rows, and none under the last.
        <Fragment key={index}>
          {index === 0 ? null : (
            <View style={{ height: 1, backgroundColor: theme.density['dens-rule'] }} />
          )}
          {row}
        </Fragment>
      ))}
    </View>
  )
}

export interface ListRowProps {
  readonly title: string
  readonly secondary?: string | undefined
  readonly avatar?: ReactNode
  readonly chip?: ReactNode
  /** The state of the row's own write, where it is not in sync. */
  readonly mark?: SyncState | undefined
  /**
   * Opens what the mark is about: the comparison for a conflict, the reason for a rejection. A
   * row that is pending or syncing has nothing to open, and its mark stays words.
   */
  readonly onOpenMark?: (() => void) | undefined
  /** When the row's write began to sync, as `Date.now()` counts, where its owner knows. */
  readonly syncingSince?: number | undefined
  /**
   * What can be done to the row. A member who may not write is given none: it is absent, not
   * disabled (03-patterns §2).
   */
  readonly trailing?: ReactNode
}

/** The least room the words are given before the mark and the action go under them, in rem. */
const wordsRem = 10

export function ListRow({
  title,
  secondary,
  avatar,
  chip,
  mark,
  onOpenMark,
  syncingSince,
  trailing,
}: ListRowProps) {
  const theme = useTheme()
  const target = useTarget()
  const { textScale } = useDisplay()
  return (
    <View
      role="listitem"
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: theme.space['space-15'],
        rowGap: theme.space['space-1'],
        minHeight: target,
        paddingVertical: theme.density['dens-pad-y'],
        paddingHorizontal: theme.density['dens-pad-x'],
      }}
    >
      {avatar}
      {/* The words are one thing to a screen reader, read in one go; the mark and the action
          are each their own, and take the room they need. */}
      <View
        accessible
        style={{
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: wordsRem * remPx * textScale,
          alignItems: 'flex-start',
          gap: theme.space['space-05'],
        }}
      >
        <Text>{title}</Text>
        {secondary === undefined ? null : (
          <Text step="caption" color="text-muted">
            {secondary}
          </Text>
        )}
        {chip}
      </View>
      {mark === undefined ? null : (
        <SyncMark state={mark} name={title} onOpen={onOpenMark} since={syncingSince} />
      )}
      {trailing}
    </View>
  )
}
