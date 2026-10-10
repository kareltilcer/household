// Banner (02-components §2): a state of the household or of a screen, said in words above or in
// place of what it is about, with the action that answers it. Its tone is a colour, a glyph and
// the sentence itself; nothing here is told by the colour alone. The same shape carries a screen's
// error, a rejected write's reason, a withdrawn row's sentence and the read-only notice. The
// contract is the web's (apps/web/src/ui/Banner.tsx).
//
// A device has no region that is read out as its words change, on both platforms alike: a banner
// that arrives while its member is here says its words through the one announcer (announce.ts),
// a failure at once and anything else once the screen reader has finished. So its sentence is a
// string, which can be said, and what else stands under it is `detail`, which is not.
import { controls } from '@household/icons'
import type { ColorName } from '@household/tokens/native'
import { useEffect, type ReactNode } from 'react'
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { announce as say, announceNow as sayNow } from './announce.ts'
import { IconButton } from './Button.tsx'
import { BaseIcon } from './Icon.tsx'
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
   * One that was there when the screen opened is read in its place and is not announced. A
   * failure is announced at once; any other tone once the screen reader has finished.
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
  const t = useTranslate()
  const theme = useTheme()
  const urgent = tone === 'danger'
  // What is said: the title, a pause, the sentence. The glyph only repeats the tone.
  const said = title === undefined ? children : `${title}\n${children}`
  useEffect(() => {
    if (!announce) return
    if (urgent) sayNow(said)
    else say(said)
  }, [announce, urgent, said])

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
