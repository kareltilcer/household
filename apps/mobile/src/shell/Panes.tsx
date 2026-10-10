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

  if (!two) {
    // One pane: what was opened takes the list's place, and its own bar leads back to it.
    return (
      <View testID={`${testID}:one`} style={{ flex: 1 }}>
        {detail ?? list}
      </View>
    )
  }
  return (
    <View testID={`${testID}:two`} style={{ flex: 1, flexDirection: 'row' }}>
      <View
        testID={`${testID}:list`}
        style={{
          width: listShare,
          borderRightWidth: 1,
          borderRightColor: theme.color['border-subtle'],
        }}
      >
        {list}
      </View>
      <View testID={`${testID}:detail`} style={{ flex: 1 }}>
        <PanesContext value>
          {detail ?? (
            <View style={{ padding: theme.space['space-3'] }}>
              <Text color="text-muted">{t('device.shell.panes.empty')}</Text>
            </View>
          )}
        </PanesContext>
      </View>
    </View>
  )
}
