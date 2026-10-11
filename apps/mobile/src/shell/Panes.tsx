// Two panes (04-navigation §7, PL-5): a list, and beside it what is selected in it, where there
// is room for both; where there is not, one pane, the list or what was opened from it. A tablet
// is this layout and no other client: the same list and the same detail a phone draws one at a
// time.
//
// The room is counted in the reader's text (width.ts): a tablet at twice the text is drawn as a
// phone is. And a second pane is a pane only where something on the left can fill it: a list
// with nothing in it is drawn across the whole width, with no empty half beside its empty
// state. With something to select and nothing selected, the second pane says so.
//
// No module draws its screens in this yet: the first that has a list and a detail does.
import { createContext, use, type ReactNode } from 'react'
import { useWindowDimensions, View } from 'react-native'
import { useDisplay, useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { drawsNothing } from '../ui/nothing.ts'
import { Text } from '../ui/Text.tsx'
import { isWide } from './width.ts'

/** Whether what is drawn here stands in one of two panes: its bar then has no way back to draw. */
const PanesContext = createContext(false)

/**
 * Whether this is drawn beside its list, in two panes. What was opened from a list goes back
 * to it by Back where it took the list's place, and has nothing to go back to where the list
 * is still beside it.
 */
export function useBesideList(): boolean {
  return use(PanesContext)
}

export interface PanesProps {
  /** The list: the left pane, or the only one. */
  readonly list: ReactNode
  /** What is selected in the list, or null where nothing is. */
  readonly detail: ReactNode | null
  /**
   * Whether the list holds anything that could be selected. Left out, it does. With nothing in
   * it nothing can fill a second pane, and none is drawn.
   */
  readonly fills?: boolean
  /** The room there is, in points. Left out, the window's width. */
  readonly width?: number
  readonly testID?: string
}

/** The share of the room the list takes beside a detail, as the design draws a tablet's. */
const listShare = '44%'

export function Panes({ list, detail, fills = true, width, testID = 'panes' }: PanesProps) {
  const t = useTranslate()
  const theme = useTheme()
  const { textScale } = useDisplay()
  const window = useWindowDimensions()
  const two = fills && isWide(width ?? window.width, textScale)
  // Nothing is opened where its owner left `detail` out or decided against it by a condition:
  // whatever React would draw nothing for (ui/nothing.ts), and not `null` alone.
  const opened = !drawsNothing(detail)

  // One tree for both layouts: each pane is the same element, in the same place, whether it
  // stands alone or beside the other. The room turns under what is drawn, a phone turned on
  // its side being wide enough for two on most phones, a tablet given another app beside this
  // one too narrow: drawn as two trees, the list and what was opened were taken down and built
  // again at each turn, and whatever they held went with them, where a list was scrolled to
  // and what was half typed into a form. In one pane what was opened takes the list's place,
  // which is not drawn, and its own bar leads back to it.
  //
  // The list's room is a `width` in both, which a device reads at every layout, and the other
  // pane's a `flex` it has from its first layout, in a row that is a row in both and has the
  // width its screen gives it: neither is given later what Yoga computes once (test/a11y.ts,
  // `roomByWidth`; read, and a turn run on no device).
  return (
    <View
      // Each name written whole: the flows' test holds a name to the pieces the sources write.
      testID={two ? `${testID}:two` : `${testID}:one`}
      style={{ flex: 1, flexDirection: 'row' }}
    >
      {two || !opened ? (
        <View
          key="list"
          {...(two ? { testID: `${testID}:list` } : {})}
          style={
            two
              ? {
                  width: listShare,
                  borderRightWidth: 1,
                  borderRightColor: theme.color['border-subtle'],
                }
              : { width: '100%' }
          }
        >
          {list}
        </View>
      ) : null}
      {two || opened ? (
        <View key="detail" {...(two ? { testID: `${testID}:detail` } : {})} style={{ flex: 1 }}>
          <PanesContext value={two}>
            {opened ? (
              detail
            ) : (
              <View style={{ padding: theme.space['space-3'] }}>
                <Text color="text-muted">{t('device.shell.panes.empty')}</Text>
              </View>
            )}
          </PanesContext>
        </View>
      ) : null}
    </View>
  )
}
