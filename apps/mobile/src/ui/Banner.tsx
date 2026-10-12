// Banner (02-components §2): a state of the household or of a screen, said in words above or in
// place of what it is about, with the action that answers it. Its tone is a colour, a glyph and
// the sentence itself; nothing here is told by the colour alone. The same shape carries a screen's
// error, a rejected write's reason, a withdrawn row's sentence and the read-only notice. The
// contract is the web's (apps/web/src/ui/Banner.tsx).
//
// A device has no region that is read out as its words change, on both platforms alike: a banner
// that arrives while its member is here says its words through the one announcer (announce.ts).
// On iOS a failure is said at once, over what is being said, and anything else once the screen
// reader has finished; on Android React Native passes no such option (read, announce.ts), so
// each is said as any other is. So its sentence is a string, which can be said, and what else
// stands under it is `detail`, which is not.
import { controls } from '@household/icons'
import type { DisplayLocale } from '@household/i18n'
import type { ColorName } from '@household/tokens/native'
import { useEffect, useRef, type ReactNode } from 'react'
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { useI18n } from '../i18n/I18nProvider.tsx'
import { announce as say, announceNow as sayNow } from './announce.ts'
import { IconButton } from './Button.tsx'
import { BaseIcon } from './Icon.tsx'
import { useInFront } from './Screen.tsx'
import { Text } from './Text.tsx'

export type BannerTone = 'neutral' | 'info' | 'warning' | 'danger'

const glyphs = {
  neutral: 'info',
  info: 'info',
  warning: 'alert-triangle',
  danger: 'alert-circle',
} as const

/** A tone's colour, by its token: its rule's and its glyph's. Neutral is no status, and has none's. */
const paint: Readonly<Record<BannerTone, { readonly rule: ColorName; readonly glyph: ColorName }>> =
  {
    neutral: { rule: 'border-strong', glyph: 'text-muted' },
    info: { rule: 'info', glyph: 'info' },
    warning: { rule: 'warning', glyph: 'warning' },
    danger: { rule: 'danger', glyph: 'danger' },
  }

export interface BannerProps {
  readonly tone: BannerTone
  /** What the state is, in two or three words, where the sentence alone would not say. */
  readonly title?: string | undefined
  /** The sentence: what happened, and what was not lost. */
  readonly children: string
  /** What stands under the sentence and is no part of what is said aloud: the two versions kept. */
  readonly detail?: ReactNode
  /** What answers it: one action for an error, retry, edit and discard for a rejected write. */
  readonly actions?: ReactNode
  /** Lets the member put it away. A banner that must stay has none. */
  readonly onDismiss?: (() => void) | undefined
  /**
   * Whether it is announced when it appears: a state that arrived while the member was here.
   * One that was there when the screen opened is read in its place and is not announced. On
   * iOS a failure is announced at once, and any other tone once the screen reader has
   * finished; on Android each is announced as any other is (announce.ts).
   */
  readonly announce?: boolean
  readonly testID?: string
}

export function Banner({
  tone,
  title,
  children,
  detail,
  actions,
  onDismiss,
  announce = false,
  testID,
}: BannerProps) {
  const { t, locale } = useI18n()
  const theme = useTheme()
  const urgent = tone === 'danger'
  // What is said: the title, a line break, the sentence. That a screen reader pauses at the
  // break is heard by nobody yet. The glyph only repeats the tone.
  const said = title === undefined ? children : `${title}\n${children}`
  // Said by a screen that is in front alone. A tab's screen and a household another was opened
  // over stay mounted, and what arrives on one out of sight is told to nobody: it stands there
  // when its member comes back, and is read in its place as what stood at the start is.
  const front = useInFront()
  // And a sentence in another language is no other sentence. The app's language follows the
  // account's whenever that is learned or changes (i18n/I18nProvider.tsx), on every screen
  // that is drawn: what stands in the language it was said in, and is drawn in another, is
  // not said again. A banner is given words and not their key, so that is told by the
  // language: one whose sentence changed in the very draw its language did is taken for
  // the same one.
  const stood = useRef<{ readonly said: string; readonly locale: DisplayLocale } | null>(null)
  useEffect(() => {
    if (!announce) {
      stood.current = null
      return
    }
    const was = stood.current
    const translated = was !== null && was.locale !== locale
    if (front && !translated && was?.said !== said) {
      if (urgent) sayNow(said)
      else say(said)
    }
    stood.current = { said, locale }
  }, [announce, urgent, said, front, locale])

  return (
    <View
      testID={testID ?? `banner:${tone}`}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: theme.space['space-15'],
        paddingVertical: theme.space['space-15'],
        paddingHorizontal: theme.space['space-2'],
        backgroundColor: theme.color['surface-raised'],
        borderWidth: 1,
        borderColor: theme.color['border-subtle'],
        borderStartWidth: 4,
        borderStartColor: theme.color[paint[tone].rule],
        borderRadius: theme.radii['radius-control'],
      }}
    >
      <View style={{ marginTop: theme.space['space-05'] }}>
        <BaseIcon name={glyphs[tone]} color={paint[tone].glyph} />
      </View>
      <View style={{ flex: 1, gap: theme.space['space-1'] }}>
        {/* The title and the sentence are one thing to a screen reader, read in one go. */}
        <View accessible style={{ gap: theme.space['space-1'] }}>
          {title === undefined ? null : <Text weight={600}>{title}</Text>}
          <Text>{children}</Text>
        </View>
        {detail}
        {actions === undefined ? null : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['space-1'] }}>
            {actions}
          </View>
        )}
      </View>
      {onDismiss === undefined ? null : (
        <IconButton
          label={t(controls.dismiss.labelKey)}
          icon={<BaseIcon name={controls.dismiss.glyph.id} />}
          onPress={() => {
            onDismiss()
          }}
        />
      )}
    </View>
  )
}
