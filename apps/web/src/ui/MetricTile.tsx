// The metric tile (02-components §3): a catalog metric rendered, with its label, its value and an
// optional trend. A figure the product has not earned is not shown as a zero: the tile says there
// is not enough information, with the no-history mark, names what is missing, and offers the one
// action that supplies it (03-patterns §12, F-10): an absence is distinguishable from a genuine
// zero, which is a measurement and is drawn as a figure.
import { BaseIcon, StatusIcon } from '@household/icons/web'
import type { ReactNode } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import styles from './MetricTile.module.css'

export interface Trend {
  readonly direction: 'up' | 'down' | 'flat'
  /** The change in words: "6 % more than last period". The arrow repeats it and says nothing alone. */
  readonly text: string
}

export interface MetricTileProps {
  readonly label: string
  /** The figure, formatted. Left out, there is not enough information to state one. */
  readonly value?: string | undefined
  readonly unit?: string | undefined
  readonly trend?: Trend | undefined
  /** With no value: exactly what is missing. "Two readings on the same meter produce the first figure." */
  readonly missing?: string | undefined
  /**
   * With no value: the one action that supplies what is missing, *Add a reading*. A tile with a
   * figure draws none, and a member who may not write is given none (03-patterns §2).
   */
  readonly action?: ReactNode
}

const arrows = { up: 'chevron-up', down: 'chevron-down' } as const

/** Whether React would draw nothing for `node`: an action its owner left out, or decided against. */
function drawsNothing(node: ReactNode): boolean {
  return node === undefined || node === null || typeof node === 'boolean'
}

export function MetricTile({ label, value, unit, trend, missing, action }: MetricTileProps) {
  const t = useTranslate()
  return (
    <div className={styles.tile}>
      <p className={styles.label}>{label}</p>
      {value === undefined ? (
        <>
          <p className={styles.none}>
            {/* Decoration: the words beside it are the state's own. */}
            <span className={styles.glyph}>
              <StatusIcon status="no_history" />
            </span>
            <span>{t('ui.metric.not_enough')}</span>
          </p>
          {missing === undefined ? null : <p className={styles.foot}>{missing}</p>}
          {drawsNothing(action) ? null : <div className={styles.action}>{action}</div>}
        </>
      ) : (
        <>
          <p className={styles.figure}>
            <span className={styles.value}>{value}</span>
            {unit === undefined ? null : <span className={styles.unit}>{unit}</span>}
          </p>
          {trend === undefined ? null : (
            <p className={styles.foot}>
              {trend.direction === 'flat' ? null : (
                <BaseIcon name={arrows[trend.direction]} size={16} className={styles.arrow} />
              )}
              <span>{trend.text}</span>
            </p>
          )}
        </>
      )}
    </div>
  )
}
