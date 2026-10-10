// The metric tile (02-components §3): a catalog metric rendered, with its label, its value and an
// optional trend. A figure the product has not earned is not shown as a zero: the tile says there
// is not enough information, with the no-history mark, names what is missing, and offers the one
// action that supplies it (03-patterns §12, F-10): an absence is distinguishable from a genuine
// zero, which is a measurement and is drawn as a figure.
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { BaseIcon, StatusIcon } from './Icon.tsx'
import { Text } from './Text.tsx'

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
  const theme = useTheme()
  return (
    <View
      style={{
        gap: theme.space['space-05'],
        padding: theme.space['space-15'],
        borderWidth: 1,
        borderColor: theme.color['border-subtle'],
        borderRadius: theme.radii['radius-card'],
      }}
    >
      {/* The label and what it measures are one thing to a screen reader, read in one go: the
          action under them is its own. */}
      <View accessible style={{ gap: theme.space['space-05'] }}>
        <Text step="overline" color="text-muted">
          {label}
        </Text>
        {value === undefined ? (
          <>
            <View
              // The no-history status, said three ways as every status is, under the tile's own
              // words for it.
              testID="status:no_history"
              style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['space-05'] }}
            >
              <StatusIcon status="no_history" />
              <Text style={{ flexShrink: 1 }}>{t('ui.metric.not_enough')}</Text>
            </View>
            {missing === undefined ? null : (
              <Text step="caption" color="text-muted">
                {missing}
              </Text>
            )}
          </>
        ) : (
          <>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                gap: theme.space['space-05'],
              }}
            >
              <Text step="num-lg">{value}</Text>
              {unit === undefined ? null : (
                <Text step="caption" color="text-muted">
                  {unit}
                </Text>
              )}
            </View>
            {trend === undefined ? null : (
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['space-05'] }}
              >
                {trend.direction === 'flat' ? null : (
                  <BaseIcon name={arrows[trend.direction]} size={16} color="text-muted" />
                )}
                <Text step="caption" color="text-muted" style={{ flexShrink: 1 }}>
                  {trend.text}
                </Text>
              </View>
            )}
          </>
        )}
      </View>
      {/* The one action of a tile with no figure, under what is missing, at its own width. */}
      {value !== undefined || drawsNothing(action) ? null : (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            marginTop: theme.space['space-05'],
          }}
        >
          {action}
        </View>
      )}
    </View>
  )
}
