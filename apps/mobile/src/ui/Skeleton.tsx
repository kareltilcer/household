// Skeleton (02-components §1): the loading state where the shape is known, matched to what it
// replaces, never a spinner. It says "Loading" to a screen reader once, and its bars are
// decoration. Under reduced motion it is a still shape (01-foundations §7).
import { remPx } from '@household/tokens'
import { useEffect, useState } from 'react'
import { Animated, Easing, View } from 'react-native'
import { useDisplay, useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'

/** A bar of the shape: its width as a percentage of the body's, and its height in rem. */
export type SkeletonBar = readonly [width: number, height: number]

export interface SkeletonProps {
  /** The bars, top to bottom, as the content they stand for is laid out. */
  readonly bars: readonly SkeletonBar[]
}

/** How far the shape fades at the far end of a breath. */
const faint = 0.55

/** `share` per cent of the room it stands in, as a style takes a share. */
function percent(share: number): `${number}%` {
  return `${String(share)}%` as `${number}%`
}

export function Skeleton({ bars }: SkeletonProps) {
  const t = useTranslate()
  const theme = useTheme()
  const { reducedMotion, textScale } = useDisplay()
  const [breath] = useState(() => new Animated.Value(1))
  const slow = theme.durations['dur-slow']
  const [x1, y1, x2, y2] = theme.easings['ease-exit']

  // A breath every 1.6 s, counted in the slow duration, there and back for as long as it is
  // drawn. Under reduced motion nothing is started, and the shape stands still.
  useEffect(() => {
    if (reducedMotion) return undefined
    const half = {
      duration: slow * 5,
      easing: Easing.bezier(x1, y1, x2, y2),
      useNativeDriver: true,
    }
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { ...half, toValue: faint }),
        Animated.timing(breath, { ...half, toValue: 1 }),
      ]),
    )
    breathing.start()
    return () => {
      breathing.stop()
      breath.setValue(1)
    }
  }, [breath, reducedMotion, slow, x1, y1, x2, y2])

  return (
    <Animated.View
      testID="skeleton"
      // Said once, as one thing that is busy: the bars are a shape, and no words.
      accessible
      accessibilityLabel={t('ui.loading')}
      accessibilityState={{ busy: true }}
      style={{ gap: theme.space['space-1'], opacity: breath }}
    >
      {bars.map(([width, height], index) => (
        <View
          // The bars are a fixed shape with no identity of their own: their place is their key.
          key={index}
          style={{
            width: percent(width),
            // A rem is as tall as the reader's text makes it: the shape is the text's.
            height: height * remPx * textScale,
            backgroundColor: theme.color['skeleton-bg'],
            borderRadius: theme.radii['radius-control'],
          }}
        />
      ))}
    </Animated.View>
  )
}
