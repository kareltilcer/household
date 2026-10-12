// The search result row (02-components §3): one shape for a result of any module, as the
// contract's SearchHit gives it. The entity type is what tells a board from a card, and this row
// is the only place that can be shown. A snippet and a path may each be null, and the row reads
// as a result without either.
import type { ModuleId } from '@household/tokens'
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { ModuleChip } from './Chip.tsx'
import { Text } from './Text.tsx'

export interface SearchResultRowProps {
  readonly module: ModuleId
  /** The kind of thing it is, in words: "Document", "Card". */
  readonly entityType: string
  readonly title: string
  readonly snippet?: string | null | undefined
  /** Where it is kept: "Documents / House / Insurance". */
  readonly path?: string | null | undefined
  /** When it was last changed: the instant the contract's `updated_at` carries. */
  readonly updatedAt: string
  /** The zone the day of that instant is told in: the household's. */
  readonly timeZone: string
}

export function SearchResultRow({
  module,
  entityType,
  title,
  snippet,
  path,
  updatedAt,
  timeZone,
}: SearchResultRowProps) {
  const t = useTranslate()
  const theme = useTheme()
  const format = useFormat()
  const line = {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: theme.space['space-15'],
    rowGap: theme.space['space-05'],
  } as const
  return (
    <View
      testID="search-result"
      // One result is one thing to a screen reader, read in one go.
      accessible
      style={{ gap: theme.space['space-05'], paddingVertical: theme.density['dens-pad-y'] }}
    >
      <View style={line}>
        <ModuleChip module={module} />
        <Text step="caption" color="text-muted" style={{ flexShrink: 1 }}>
          {entityType}
        </Text>
      </View>
      <Text weight={500}>{title}</Text>
      {snippet === undefined || snippet === null ? null : <Text color="text-muted">{snippet}</Text>}
      <View style={line}>
        {path === undefined || path === null ? null : (
          <Text step="caption" color="text-muted" style={{ flexShrink: 1 }}>
            {path}
          </Text>
        )}
        <Text step="caption" color="text-muted" style={{ flexShrink: 1 }}>
          {t('ui.search.updated', { day: format.dayOf(updatedAt, timeZone) })}
        </Text>
      </View>
    </View>
  )
}
