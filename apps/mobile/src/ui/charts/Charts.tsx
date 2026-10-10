// The three chart shapes (02-components §3): a time series, a composition and a flow. Each is
// drawn from elements that carry their own words, so that nothing is told by a colour or by a
// shape alone: a column has its label and its value, a segment its row of the legend, a flow its
// two lists. They are layout, not pictures: at 200 % text the words grow and the shapes give way.
// The contract is the web's (apps/web/src/ui/charts/Charts.tsx).
import { remPx } from '@household/tokens'
import type { ColorName } from '@household/tokens/native'
import { useState, type ReactNode } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import { useDisplay, useTheme } from '../../display/DisplayProvider.tsx'
import { useFormat, useTranslate } from '../../i18n/I18nProvider.tsx'
import { BaseIcon } from '../Icon.tsx'
import { StatusMark } from '../StatusMark.tsx'
import { Text } from '../Text.tsx'

/** The eight series colours, in the order series take them. */
const series: readonly ColorName[] = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'chart-7',
  'chart-8',
]

/** `share` of the room it stands in, from none of it to all, as a style takes a share. */
function percent(share: number): `${number}%` {
  return `${String(share * 100)}%` as `${number}%`
}

/** The colour of the series at `index`: the ninth takes the first's again. */
function seriesAt(index: number): ColorName {
  return series[index % series.length] ?? 'chart-1'
}

/** What every chart stands in: a raised ground, which the series colours are tested against. */
function Chart({
  testID,
  onWidth,
  children,
}: {
  readonly testID: string
  readonly onWidth?: (width: number) => void
  readonly children: ReactNode
}) {
  const theme = useTheme()
  const measure =
    onWidth === undefined
      ? undefined
      : (event: LayoutChangeEvent) => {
          onWidth(event.nativeEvent.layout.width)
        }
  return (
    <View
      testID={testID}
      onLayout={measure}
      style={{
        gap: theme.space['space-1'],
        padding: theme.space['space-15'],
        backgroundColor: theme.color['surface-raised'],
        borderWidth: 1,
        borderColor: theme.color['border-subtle'],
        borderRadius: theme.radii['radius-card'],
      }}
    >
      {children}
    </View>
  )
}

/** A chart's caption: what it shows, and whatever is said beside that. */
function Caption({
  caption,
  children,
}: {
  readonly caption: string
  readonly children?: ReactNode
}) {
  const theme = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: theme.space['space-15'],
        rowGap: theme.space['space-05'],
      }}
    >
      <Text step="caption" color="text-muted" style={{ flexShrink: 1 }}>
        {caption}
      </Text>
      {children}
    </View>
  )
}

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
  const theme = useTheme()
  const top = Math.max(0, ...points.map((point) => point.value))
  const estimated = points.some((point) => point.estimated === true)
  return (
    <Chart testID="chart:series">
      <View
        role="list"
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: theme.space['space-1'],
          borderBottomWidth: 1,
          borderBottomColor: theme.color['chart-axis'],
        }}
      >
        {points.map((point, index) => (
          // A point is its place in the series: a label is a month's letter, and J comes thrice.
          <View
            key={index}
            role="listitem"
            // Said in words, which is the point's name: its column and its tick only draw it.
            accessible
            accessibilityLabel={
              point.estimated === true
                ? t('ui.chart.point_estimated', { label: point.label, value: point.text })
                : t('ui.chart.point', { label: point.label, value: point.text })
            }
            style={{ flex: 1, alignItems: 'center', gap: theme.space['space-05'] }}
          >
            {/* The plot is as high as it is at any text size: a picture's room, not a word's. */}
            <View
              style={{
                alignSelf: 'stretch',
                height: theme.space['space-10'],
                justifyContent: 'flex-end',
              }}
            >
              {/* A share of the tallest column. A point at or under zero has no column, and
                  not one of no height: every column is given a height that can be seen, so
                  that a small reading is not lost beside a large one, and a reading of nothing
                  would stand on the axis as a small one. */}
              {point.value > 0 ? (
                <View
                  testID={point.estimated === true ? 'chart:column:estimated' : 'chart:column'}
                  style={{
                    height: percent(point.value / top),
                    minHeight: 2,
                    borderTopLeftRadius: theme.radii['radius-control'],
                    borderTopRightRadius: theme.radii['radius-control'],
                    ...(point.estimated === true
                      ? // An estimated point is an outline with nothing in it: a shape a
                        // measured one never has.
                        {
                          borderWidth: 2,
                          borderStyle: 'dashed',
                          borderColor: theme.color['chart-1'],
                        }
                      : { backgroundColor: theme.color['chart-1'] }),
                  }}
                />
              ) : null}
            </View>
            <Text step="caption" color="text-muted" style={{ textAlign: 'center' }}>
              {point.label}
            </Text>
          </View>
        ))}
      </View>
      <Caption caption={caption}>
        {estimated ? <StatusMark status="estimated" /> : null}
        {approximate ? (
          <View
            style={{
              paddingHorizontal: theme.space['space-1'],
              borderWidth: 1,
              borderColor: theme.color['border-strong'],
              borderRadius: theme.radii['radius-pill'],
            }}
          >
            <Text step="caption">{t('ui.chart.approximate')}</Text>
          </View>
        ) : null}
      </Caption>
    </Chart>
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

/** The least room a legend's or a flow's label is given before its figure goes under it, in rem. */
const labelRem = 8

export function Composition({ caption, segments, total }: CompositionProps) {
  const format = useFormat()
  const theme = useTheme()
  const { textScale } = useDisplay()
  return (
    <Chart testID="chart:composition">
      <View
        testID="chart:whole"
        // Decoration the legend explains: the bar is read from it.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          flexDirection: 'row',
          gap: 2,
          height: theme.space['space-3'],
          overflow: 'hidden',
          borderRadius: theme.radii['radius-control'],
        }}
      >
        {segments.map((segment, index) =>
          // A segment that is none of the whole has no part of the bar, as a point of nothing
          // has no column: every part is given a width that can be seen. Its row of the legend
          // says it, with the colour of its place there.
          segment.share > 0 ? (
            <View
              // A segment is its place in the bar, as a point is its place in a series.
              key={index}
              style={{
                width: percent(segment.share),
                minWidth: 2,
                // The parts give the gaps between them their room.
                flexShrink: 1,
                backgroundColor: theme.color[seriesAt(index)],
              }}
            />
          ) : null,
        )}
      </View>
      {/* The legend names every segment with its figure, in the bar's order: the bar is read
          from it, and a colour is only how the eye finds a row again. */}
      <View role="list" style={{ gap: theme.space['space-05'] }}>
        {segments.map((segment, index) => (
          <View
            key={index}
            role="listitem"
            accessible
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              columnGap: theme.space['space-15'],
              rowGap: theme.space['space-05'],
            }}
          >
            <View
              style={{
                alignSelf: 'center',
                width: theme.space['space-15'],
                height: theme.space['space-15'],
                backgroundColor: theme.color[seriesAt(index)],
                borderRadius: theme.radii['radius-control'],
              }}
            />
            <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: labelRem * remPx * textScale }}>
              <Text>{segment.label}</Text>
            </View>
            <Text step="num">{segment.text}</Text>
            <Text step="num">{format.percent(segment.share)}</Text>
          </View>
        ))}
      </View>
      <Caption caption={caption}>
        {/* A chart's total is a sentence of figures, and wraps where a sentence does. */}
        <Text step="num-sm" style={{ flexShrink: 1 }}>
          {total}
        </Text>
      </Caption>
    </Chart>
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

/** The least width, in rem, at which a flow's two sides stand beside each other. */
const besideFromRem = 28

function Side({
  label,
  nodes,
  beside,
}: {
  readonly label: string
  readonly nodes: readonly FlowNode[]
  /** Whether it stands beside the other side, and so takes half the room, or above or under it. */
  readonly beside: boolean
}) {
  const theme = useTheme()
  const { textScale } = useDisplay()
  return (
    <View style={{ ...(beside ? { flex: 1 } : {}), gap: theme.space['space-05'] }}>
      <Text step="overline" color="text-muted">
        {label}
      </Text>
      <View role="list" aria-label={label} style={{ gap: theme.space['space-05'] }}>
        {nodes.map((node, index) => (
          // In the order given, and no other: two accounts may carry one name.
          <View
            key={index}
            role="listitem"
            accessible
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              columnGap: theme.space['space-15'],
              rowGap: theme.space['space-05'],
              paddingVertical: theme.space['space-1'],
              paddingHorizontal: theme.space['space-15'],
              borderWidth: 1,
              borderColor: theme.color['border-strong'],
              borderRadius: theme.radii['radius-control'],
            }}
          >
            <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: labelRem * remPx * textScale }}>
              <Text>{node.label}</Text>
            </View>
            <Text step="num">{node.text}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

/**
 * N sources to M accounts, reconciling exactly (FR-FI9). This is the shell: the two lists with
 * their figures and the line that says they agree. The readable diagram between them is
 * Finance's own work, and nothing here draws money moving by itself.
 */
export function Flow({ caption, sourcesLabel, sources, targetsLabel, targets, total }: FlowProps) {
  const theme = useTheme()
  const { textScale } = useDisplay()
  // Where the two sides do not fit beside each other, on a phone, at 200 % text or in a narrow
  // pane, the second goes under the first and the arrow points down. Which it is, is the room
  // the chart is given, counted in the reader's text size; until the chart has been laid out
  // it is drawn as a phone draws it.
  const [width, setWidth] = useState<number | undefined>(undefined)
  const beside = width !== undefined && width >= besideFromRem * remPx * textScale
  return (
    <Chart testID="chart:flow" onWidth={setWidth}>
      <View
        testID="chart:flow:sides"
        style={{
          flexDirection: beside ? 'row' : 'column',
          alignItems: beside ? 'center' : 'stretch',
          gap: theme.space['space-2'],
        }}
      >
        <Side label={sourcesLabel} nodes={sources} beside={beside} />
        <View
          style={{
            alignSelf: 'center',
            ...(beside ? {} : { transform: [{ rotate: '90deg' }] }),
          }}
        >
          <BaseIcon name="arrow-right" color="text-muted" />
        </View>
        <Side label={targetsLabel} nodes={targets} beside={beside} />
      </View>
      <Caption caption={caption}>
        <Text step="num-sm" style={{ flexShrink: 1 }}>
          {total}
        </Text>
      </Caption>
    </Chart>
  )
}
