// What every screen stands in: the theme's ground, the device's safe area, a body that scrolls,
// and the screen's title as a header, which is what a screen reader names the screen by and
// moves to first (D-165's twin). A screen under the shell's app bar gives its title there and
// none here.
import { createContext, use, useEffect, useRef, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../display/DisplayProvider.tsx'
import { announceNow } from './announce.ts'
import { Text } from './Text.tsx'

export interface ScreenProps {
  /** The screen's title, drawn as its header. Left out where a bar above the screen says it. */
  readonly title?: string
  /**
   * The edges of the device this screen reaches, and so keeps its content clear of. Left out,
   * all four: a screen under a bar of the shell's names the ones the shell has not taken.
   */
  readonly edges?: readonly ('top' | 'bottom' | 'left' | 'right')[]
  /**
   * Whether the screen is the one in front. Left out, it is. A screen that stays mounted when
   * another is opened, a tab's own or a household's underneath, says, so that what arrives on
   * it out of sight is said to nobody (`useInFront`).
   */
  readonly inFront?: boolean
  readonly testID?: string
  readonly children?: ReactNode
}

const all = ['top', 'bottom', 'left', 'right'] as const

const FrontContext = createContext(true)

/**
 * Whether the screen this is drawn in is the one in front: what a screen that is not would
 * say aloud of something that arrived on it, its member is not there to be told
 * (ui/Banner.tsx). True where no screen says otherwise.
 */
export function useInFront(): boolean {
  return use(FrontContext)
}

/**
 * Says aloud, at once, what stands in a screen's place as it arrives there: its title, a line
 * break, its sentence, as a banner says its own (ui/Banner.tsx). What could not be read,
 * *please update* and a route that failed open no screen of their own, so nothing moved a
 * screen reader's focus to them.
 *
 * Once, as its caller arrives, and never again for as long as that is drawn. Its words in
 * another language are no other sentence: the app's language follows the account's whenever
 * that is learned or changes, on every screen that is drawn (i18n/I18nProvider.tsx), and said
 * by its words it was said a second time then. What is drawn anew has arrived again and is said
 * again: a second asking that came to nothing, after the wait that stood in its place.
 *
 * And only where `inFront`, which its caller says: a screen that stands in another's place
 * draws its own `Screen`, and stands above whatever `useInFront` would read. What arrives
 * under another screen is told to nobody, and is read in its place when its member comes back.
 */
export function useSaidOnArrival(title: string, sentence: string, inFront = true): void {
  // As it arrived: what a later draw is told is no part of what was said.
  const arrived = useRef({ title, sentence, inFront })
  useEffect(() => {
    const { title: heading, sentence: words, inFront: front } = arrived.current
    if (front) announceNow(`${heading}\n${words}`)
  }, [])
}

export function Screen({ title, edges = all, inFront = true, testID, children }: ScreenProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const inset = (edge: (typeof all)[number]) => (edges.includes(edge) ? insets[edge] : 0)
  return (
    <View
      testID={testID}
      style={{
        flex: 1,
        backgroundColor: theme.color.surface,
        paddingTop: inset('top'),
        paddingLeft: inset('left'),
        paddingRight: inset('right'),
      }}
    >
      <ScrollView
        // A press on a control goes to the control, with a keyboard up as without one.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          gap: theme.space['space-2'],
          paddingHorizontal: theme.density['dens-pad-x'],
          paddingTop: theme.space['space-2'],
          paddingBottom: theme.space['space-3'] + inset('bottom'),
        }}
      >
        {title === undefined ? null : (
          <Text step="title-2" header>
            {title}
          </Text>
        )}
        <FrontContext value={inFront}>{children}</FrontContext>
      </ScrollView>
    </View>
  )
}
