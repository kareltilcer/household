// A money value (02-components §3): the amount and its currency, with the original currency and
// the stored exchange rate where one was used. The number is in the mono face with tabular
// figures, formatted in the member's locale from whole minor units. A negative amount is told
// apart by its sign and by a word, never by a colour.
import type { Money } from '@household/domain'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import styles from './MoneyValue.module.css'

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
  const format = useFormat()
  return (
    <span className={styles.money}>
      <span className={styles.line}>
        <span className={large ? styles.amountLarge : styles.amount}>
          {format.moneyParts(amount).map((part, index) => (
            // A formatted amount's pieces are in a fixed order and have no identity but it.
            <span key={index} className={part.type === 'currency' ? styles.currency : undefined}>
              {part.value}
            </span>
          ))}
        </span>
        {amount.amount_minor < 0 ? <span className={styles.out}>{t('ui.money.out')}</span> : null}
      </span>
      {conversion === undefined ? null : (
        <span className={styles.conversion}>
          {t('ui.money.converted', {
            original: format.money(conversion.original),
            // Every digit it was stored with: a rate rounded here would not give the amount
            // shown beside it.
            rate: format.decimal(conversion.rate),
            day: format.day(conversion.day, 'short'),
          })}
        </span>
      )}
    </span>
  )
}
