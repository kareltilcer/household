// The trend of the storage picture (C-54; FR-HA14, FR-ST4): what the household stored on each of
// the days it was sampled, ninety at most, as a small chart and as the sentences that say the
// same in words. The chart is never the only carrier: it is hidden from assistive technology,
// and what it shows, where the trend began, where it stands and its fullest day, is said under it.
//
// A sample is dated by the UTC day it was taken on (D-109), and is shown as that day: it is a
// calendar day and is moved through no timezone. A day with no sample is a gap in the plot, as
// wide as a day. The chart is an SVG whose columns are placed by attributes: nothing of it is a
// style, which the page's policy would refuse.
import account from '../account/Settings.module.css'
import { Section } from '../household/settings/Page.tsx'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import type { StorageReport } from './data.ts'
import { columnsOf, fullestDay, plotHeight } from './picture.ts'
import styles from './Storage.module.css'

/** The room left at each side of a column, of the day's width it stands in. */
const gap = 0.1

export function Trend({ trend }: { readonly trend: StorageReport['trend'] }) {
  const t = useTranslate()
  const format = useFormat()
  const first = trend[0]
  const last = trend.at(-1)
  const fullest = fullestDay(trend)
  const { days, bars } = columnsOf(trend)

  const says =
    first === undefined || last === undefined || fullest === undefined ? (
      <p className={account.text}>{t('storage.trend.none')}</p>
    ) : trend.length === 1 ? (
      <p className={account.text}>
        {t('storage.trend.one', { size: format.bytes(first.bytes), day: format.day(first.date) })}
      </p>
    ) : (
      <>
        <p className={account.text}>
          {t('storage.trend.span', {
            first_size: format.bytes(first.bytes),
            first_day: format.day(first.date),
            last_size: format.bytes(last.bytes),
            last_day: format.day(last.date),
            count: trend.length,
          })}
        </p>
        <p className={account.text}>
          {t('storage.trend.peak', {
            size: format.bytes(fullest.bytes),
            day: format.day(fullest.date),
          })}
        </p>
      </>
    )

  return (
    <Section title={t('storage.trend.title')} note={t('storage.trend.note')}>
      {/* One column is no trend, and neither are days that held nothing: the words say those. */}
      {bars.length > 1 ? (
        <figure className={styles.chart}>
          <svg
            className={styles.plot}
            viewBox={`0 0 ${String(days)} ${String(plotHeight)}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            {bars.map((bar) => (
              <rect
                key={bar.day}
                className={styles.column}
                x={bar.day + gap}
                y={plotHeight - bar.height}
                width={1 - 2 * gap}
                height={bar.height}
              />
            ))}
          </svg>
          <figcaption className={styles.says}>{says}</figcaption>
        </figure>
      ) : (
        says
      )}
    </Section>
  )
}
