// The teaching empty state (03-patterns §4, 06-clients §3): one sentence that says what the place
// is for, one example that is marked as one, and one action. The illustration is decoration: the
// sentence says everything it shows, and at 200 % text it is not drawn at all (the kit's first
// rule, which leaves the hiding to the screen, which knows the text scale).
import type { CompositionId } from '@household/icons'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useDisplay, useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Illustration } from './Icon.tsx'
import { Text } from './Text.tsx'

/** The text scale from which the illustration gives its room to the sentence. */
const illustrationUntil = 2

/** The kit's one frame is 200 wide, and is drawn no wider. */
const illustrationWidth = 200

export interface EmptyStateProps {
  /** What this is for, in the member's own words. */
  readonly sentence: string
  /**
   * One real-looking example: a sentence, or a row. It is drawn inside a frame that says
   * "Example", which is what stops it reading as something that is there.
   */
  readonly example?: ReactNode
  /** The one action. A member who may not write here is given none (03-patterns §2). */
  readonly action?: ReactNode
  readonly composition?: CompositionId
}

export function EmptyState({ sentence, example, action, composition }: EmptyStateProps) {
  const t = useTranslate()
  const theme = useTheme()
  const { textScale } = useDisplay()
  return (
    <View testID="empty-state" style={{ alignItems: 'flex-start', gap: theme.space['space-2'] }}>
      {composition !== undefined && textScale < illustrationUntil ? (
        <Illustration composition={composition} width={illustrationWidth} />
      ) : null}
      <Text step="body-lg">{sentence}</Text>
      {example === undefined ? null : (
        <View
          style={{
            alignSelf: 'stretch',
            gap: theme.space['space-05'],
            padding: theme.space['space-15'],
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: theme.color['border-strong'],
            borderRadius: theme.radii['radius-control'],
          }}
        >
          <Text step="overline" color="text-muted">
            {t('ui.empty.example')}
          </Text>
          {typeof example === 'string' ? <Text color="text-muted">{example}</Text> : example}
        </View>
      )}
      {action === undefined ? null : <View>{action}</View>}
    </View>
  )
}
