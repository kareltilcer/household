// The three chart shapes (02-components §3): a time series, a composition and a flow. Each is
// drawn from elements that carry their own words, so that nothing is told by a colour or by a
// shape alone: a column has its label and its value, a segment its row of the legend, a flow its
// two lists. They are layout, not pictures: at 200 % text the words grow and the shapes give way.
import { BaseIcon } from '@household/icons/web'
import { useFormat, useTranslate } from '../../i18n/I18nProvider.tsx'
import a11y from '../a11y.module.css'
import { StatusMark } from '../StatusMark.tsx'
import { cx } from '../cx.ts'
import styles from './Charts.module.css'

/** The eight series colours, in the order series take them. */
const series = [
  styles.series1,
  styles.series2,
  styles.series3,
  styles.series4,
  styles.series5,
  styles.series6,
  styles.series7,
  styles.series8,
] as const

export interface SeriesPoint {
  /** The period: a month's letter, a date. */
  readonly label: string
  /**
   * What its column is drawn to, against the tallest. The columns stand on the axis: a value at
   * or under zero has no column and is said in `text`, and a series that goes under it is its
   * own screen's to draw.
   */
  readonly value: number
  /** The value as it is read, with its unit: "412 kWh". */
  readonly text: string
  /**
   * Interpolated, not measured. Drawn in its own style and named as estimated, and never part of
   * a money figure (FR-UT4).
   */
  readonly estimated?: boolean
}

export interface TimeSeriesProps {
  /** What the chart shows, and in what unit. */
  readonly caption: string
  readonly points: readonly SeriesPoint[]
  /** Monthly aggregates that cross a boundary are approximate by construction (FR-UT15). */
  readonly approximate?: boolean
}

export function TimeSeries({ caption, points, approximate = false }: TimeSeriesProps) {
  const t = useTranslate()
  const top = Math.max(0, ...points.map((point) => point.value))
  const estimated = points.some((point) => point.estimated === true)
  return (
    <figure className={styles.chart}>
      <ol className={styles.columns}>
        {points.map((point, index) => (
          // A point is its place in the series: a label is a month's letter, and J comes thrice.
          <li key={index} className={styles.column}>
            <span className={styles.plot} aria-hidden="true">
              {/* A share of the tallest column. A point at or under zero has no column, and
                  not one of no height: the stylesheet gives every column a height that can be
                  seen, so that a small reading is not lost beside a large one, and a reading
                  of nothing would stand on the axis as a small one. */}
              {point.value > 0 ? (
                <span
                  className={cx(styles.bar, point.estimated === true && styles.estimated)}
                  style={{ blockSize: `${String((point.value / top) * 100)}%` }}
                />
              ) : null}
            </span>
            <span className={styles.tick} aria-hidden="true">
              {point.label}
            </span>
            <span className={a11y.visuallyHidden}>
              {point.estimated === true
                ? t('ui.chart.point_estimated', { label: point.label, value: point.text })
                : t('ui.chart.point', { label: point.label, value: point.text })}
            </span>
          </li>
        ))}
      </ol>
      <figcaption className={styles.caption}>
        <span>{caption}</span>
        {estimated ? <StatusMark status="estimated" /> : null}
        {approximate ? <span className={styles.note}>{t('ui.chart.approximate')}</span> : null}
      </figcaption>
    </figure>
  )
}

export interface Segment {
  readonly label: string
  /** Its share of the whole, 0 to 1. */
  readonly share: number
  /** Its own figure, formatted: "1.8 GB". */
  readonly text: string
}

export interface CompositionProps {
  readonly caption: string
  /** In the order they are drawn, start to end, which is the order the legend lists them in. */
  readonly segments: readonly Segment[]
  /** The whole, formatted: "4.1 GB of 10 GB". */
  readonly total: string
}

export function Composition({ caption, segments, total }: CompositionProps) {
  const format = useFormat()
  return (
    <figure className={styles.chart}>
      <div className={styles.whole} aria-hidden="true">
        {segments.map((segment, index) =>
          // A segment that is none of the whole has no part of the bar, as a point of nothing
          // has no column: the stylesheet gives every part a width that can be seen. Its row of
          // the legend says it, with the colour of its place there.
          segment.share > 0 ? (
            <span
              // A segment is its place in the bar, as a point is its place in a series.
              key={index}
              className={cx(styles.segment, series[index % series.length])}
              style={{ inlineSize: `${String(segment.share * 100)}%` }}
            />
          ) : null,
        )}
      </div>
      {/* The legend names every segment with its figure, in the bar's order: the bar is read
          from it, and a colour is only how the eye finds a row again. */}
      <ol className={styles.legend}>
        {segments.map((segment, index) => (
          <li key={index} className={styles.entry}>
            <span className={cx(styles.swatch, series[index % series.length])} aria-hidden="true" />
            <span className={styles.entryLabel}>{segment.label}</span>
            <span className={styles.figure}>{segment.text}</span>
            <span className={styles.figure}>{format.percent(segment.share)}</span>
          </li>
        ))}
      </ol>
      <figcaption className={styles.caption}>
        <span>{caption}</span>
        <span className={styles.figure}>{total}</span>
      </figcaption>
    </figure>
  )
}

export interface FlowNode {
  readonly label: string
  /** Its amount, formatted. */
  readonly text: string
}

export interface FlowProps {
  readonly caption: string
  /** What the first list is: "Income". */
  readonly sourcesLabel: string
  readonly sources: readonly FlowNode[]
  /** What the second list is: "Accounts". */
  readonly targetsLabel: string
  readonly targets: readonly FlowNode[]
  /** How the two sides reconcile: "73 000 in · 73 000 out". */
  readonly total: string
}

/**
 * N sources to M accounts, reconciling exactly (FR-FI9). This is the shell: the two lists with
 * their figures and the line that says they agree. The readable diagram between them is
 * Finance's own work, and nothing here draws money moving by itself.
 */
export function Flow({ caption, sourcesLabel, sources, targetsLabel, targets, total }: FlowProps) {
  const side = (label: string, nodes: readonly FlowNode[]) => (
    <div className={styles.side}>
      <p className={styles.sideLabel}>{label}</p>
      <ul className={styles.nodes}>
        {nodes.map((node, index) => (
          // In the order given, and no other: two accounts may carry one name.
          <li key={index} className={styles.node}>
            <span className={styles.entryLabel}>{node.label}</span>
            <span className={styles.figure}>{node.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
  return (
    <figure className={styles.chart}>
      <div className={styles.flow}>
        {side(sourcesLabel, sources)}
        <BaseIcon name="arrow-right" className={styles.towards} />
        {side(targetsLabel, targets)}
      </div>
      <figcaption className={styles.caption}>
        <span>{caption}</span>
        <span className={styles.figure}>{total}</span>
      </figcaption>
    </figure>
  )
}
