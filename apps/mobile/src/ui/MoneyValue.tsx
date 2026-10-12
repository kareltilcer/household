// A money value (02-components §3): the amount and its currency, with the original currency and
// the stored exchange rate where one was used. The number is in the mono face with tabular
// figures, formatted in the member's locale from whole minor units. A negative amount is told
// apart by its sign and by a word, never by a colour.
import type { Money } from '@household/domain'
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { Text } from './Text.tsx'

export interface Conversion {
  /** What was paid, in the currency it was paid in. */
  readonly original: Money
  /** The rate that was stored with it, as the contract carries a decimal: a string. */
  readonly rate: string
  /** The calendar day the rate is of, `YYYY-MM-DD`. */
  readonly day: string
}

export interface MoneyValueProps {
  readonly amount: Money
  readonly conversion?: Conversion
  /** The figure a screen is about, in the larger mono step. */
  readonly large?: boolean
}

export function MoneyValue({ amount, conversion, large = false }: MoneyValueProps) {
  const t = useTranslate()
  const theme = useTheme()
  const format = useFormat()
  return (
    // One thing to a screen reader: the amount, its word and where it came from, in one go.
    <View accessible style={{ alignItems: 'flex-start', gap: theme.space['space-05'] }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: theme.space['space-1'],
        }}
      >
        {/* One amount is one text: its digits, its separators and its sign stay together, by
            the spaces that do not break which the locale's own format sets between them. */}
        <Text step={large ? 'num-lg' : 'num'}>
          {format.moneyParts(amount).map((part, index) =>
            part.type === 'currency' ? (
              // The code is the amount's label, in the label's face. A formatted amount's
              // pieces are in a fixed order and have no identity but it.
              <Text key={index} step="caption" color="text-muted">
                {part.value}
              </Text>
            ) : (
              part.value
            ),
          )}
        </Text>
        {amount.amount_minor < 0 ? (
          <View
            style={{
              paddingHorizontal: theme.space['space-1'],
              borderWidth: 1,
              borderColor: theme.color['border-strong'],
              borderRadius: theme.radii['radius-pill'],
            }}
          >
            <Text step="caption">{t('ui.money.out')}</Text>
          </View>
        ) : null}
      </View>
      {conversion === undefined ? null : (
        <Text step="caption" color="text-muted">
          {t('ui.money.converted', {
            original: format.money(conversion.original),
            // Every digit it was stored with: a rate rounded here would not give the amount
            // shown beside it.
            rate: format.decimal(conversion.rate),
            day: format.day(conversion.day, 'short'),
          })}
        </Text>
      )}
    </View>
  )
}
