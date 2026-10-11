// The list row (02-components §3), the workhorse: a title, an optional secondary line, an optional
// module chip and member avatar, the sync mark of a row whose own write is not in sync yet, and a
// trailing action. A row in sync carries no mark. A row wraps and grows with its words and is
// never held to a height: where it has not the room for both, as at 200 % text on a phone, the
// mark and the action go under the avatar and the words. The contract is the web's
// (apps/web/src/ui/ListRow.tsx).
//
// A row is two parts that wrap, and it matters that it is two, and how the first says its room.
// The first is the avatar with the words, which says how much room it is to have before anything
// goes under it; the second is the mark with the action, and it may shrink. All of the reading
// below is of React Native 0.86.3's ReactCommon/yoga/yoga and its renderer; that a row breaks
// its line at 200 % has been seen on no device yet.
//
// - That it is two *(read)*. Yoga takes a row's one child that both grows and shrinks for a
//   child whose room it need not ask, counts it as nothing wide, and breaks the row's lines by
//   that (`computeFlexBasisForChildren`, algorithm/CalculateLayout.cpp:585-625;
//   `calculateFlexLine`, FlexLine.cpp). With the mark and the action as the words' plain
//   neighbours, neither of which shrinks, no line ever broke: the title was left what they did
//   not take, which in a row in conflict at 200 % was one letter's width. A second part that
//   can shrink is a second flexible child, and the first part's room is then asked.
// - That its room is a `width` *(seen, then read)*. It was a `flexBasis` at first, and CI's
//   tenth run (38131404522) showed the row at 200 % on one line still, on both platforms: the
//   first part 160 pt and what was left over, the room of a text scale of one, though its
//   style said 320 by then. The harness holds its scale after its first layout. A room said by
//   a `flexBasis` is computed once, while the node has none (`computeFlexBasisForChild`,
//   CalculateLayout.cpp:108-116), and only `Node::markDirtyAndPropagate` takes it away again
//   (node/Node.cpp:421-424), which the renderer never calls for a style that changed: it sets
//   the style on a node copied with its layout (`updateYogaProps`,
//   react/renderer/components/view/YogaLayoutableShadowNode.cpp). So neither a new text size
//   reached it, nor a second part that arrived after a layout in which the first was alone:
//   the nothing it was counted as then was kept. The branch a `width` takes
//   (CalculateLayout.cpp:117-128) has no such guard and is taken at every layout; with
//   `flexGrow` and `flexShrink` the part is sized by flexing from it, as from a basis, and is
//   never held to it. The accessibility rules fail a `flexBasis` wherever one is drawn
//   (src/test/a11y.ts).
//
// The avatar stands in the first part, beside the words, and never on a line of its own: it says
// whose the row is, and above the title it would say that of nothing.
import { remPx } from '@household/tokens'
import { Children, Fragment, isValidElement, type ReactNode, type Ref } from 'react'
import { View } from 'react-native'
import { useDisplay, useTarget, useTheme } from '../display/DisplayProvider.tsx'
import { drawsNothing } from './nothing.ts'
import { SyncMark, useLongEnough, type SyncState } from './StatusMark.tsx'
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
        // A rule between two rows, and none under the last. A row is known by its own key, which
        // `Children.toArray` gives every element: known by its place, every row after one that
        // left would be drawn anew, and lose what it held, an open banner, a decision under way,
        // a screen reader's focus.
        <Fragment key={isValidElement(row) && row.key !== null ? row.key : index}>
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
  /**
   * A module's chip, or what else marks the row in words. No control goes here: it is drawn
   * inside the row's words, which are one thing to a screen reader, and a control inside them
   * is out of its reach on iOS.
   */
  readonly chip?: ReactNode
  /** The state of the row's own write, where it is not in sync. */
  readonly mark?: SyncState | undefined
  /**
   * Opens what the mark is about: the comparison for a conflict, the reason for a rejection. A
   * row that is pending or syncing has nothing to open, and its mark stays words.
   */
  readonly onOpenMark?: (() => void) | undefined
  /**
   * The mark's control, where the mark is one: what the sheet it opened gives the focus back
   * to (ui/Dialog.tsx's `opener`).
   */
  readonly markRef?: Ref<View> | undefined
  /** When the row's write began to sync, as `Date.now()` counts, where its owner knows. */
  readonly syncingSince?: number | undefined
  /**
   * What can be done to the row. A member who may not write is given none: it is absent, not
   * disabled (03-patterns §2).
   */
  readonly trailing?: ReactNode
  /**
   * What stands under the row, as wide as the row, where its owner has something to show of
   * it: a merge's banner. It is a line of its own, so what opens it stays where it was pressed.
   */
  readonly under?: ReactNode
}

/**
 * The least room the avatar and the words are given before the mark and the action go under
 * them, in rem.
 */
const wordsRem = 10

export function ListRow({
  title,
  secondary,
  avatar,
  chip,
  mark,
  onOpenMark,
  markRef,
  syncingSince,
  trailing,
  under,
}: ListRowProps) {
  const theme = useTheme()
  const target = useTarget()
  const { textScale } = useDisplay()
  const gaps = { columnGap: theme.space['space-15'], rowGap: theme.space['space-1'] }
  // A sync is marked only once it has taken longer than a moment, and until then its mark draws
  // nothing. With no action beside it the second part would be an empty one for that moment,
  // which is not nothing to a row: it costs the words a gap, and at 200 % a line of its own
  // under them. So the row waits the moment out itself, and its mark counts from the same time.
  const waited = useLongEnough(mark === 'syncing', syncingSince)
  const marked = mark !== undefined && (mark !== 'syncing' || waited.shown)
  return (
    <View
      role="listitem"
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        ...gaps,
        minHeight: target,
        paddingVertical: theme.density['dens-pad-y'],
        paddingHorizontal: theme.density['dens-pad-x'],
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          columnGap: gaps.columnGap,
          flexGrow: 1,
          flexShrink: 1,
          // The room it asks for, and no size it is held to: see the head of this file for
          // why it is a `width`.
          width: wordsRem * remPx * textScale,
        }}
      >
        {avatar}
        {/* The words are one thing to a screen reader, read in one go; the mark and the action
            are each their own, and take the room they need. */}
        <View
          accessible
          style={{ flex: 1, alignItems: 'flex-start', gap: theme.space['space-05'] }}
        >
          <Text>{title}</Text>
          {secondary === undefined ? null : (
            <Text step="caption" color="text-muted">
              {secondary}
            </Text>
          )}
          {chip}
        </View>
      </View>
      {!marked && drawsNothing(trailing) ? null : (
        // The second part, which may shrink: see the head of this file for why it must.
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            ...gaps,
            flexShrink: 1,
          }}
        >
          {mark === undefined ? null : (
            <SyncMark
              state={mark}
              name={title}
              onOpen={onOpenMark}
              since={waited.since}
              ref={markRef}
            />
          )}
          {trailing}
        </View>
      )}
      {/* The whole of a line, by a `width` as the words' room is: a share said by a `flexBasis`
          is resolved once too, against the width the row had then, and kept when the device
          is turned. */}
      {drawsNothing(under) ? null : <View style={{ width: '100%', flexGrow: 1 }}>{under}</View>}
    </View>
  )
}
