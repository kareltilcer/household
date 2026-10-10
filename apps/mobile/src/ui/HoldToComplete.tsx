// Hold-to-complete (02-components §4.1, 06-clients §3): a 2000 ms press-and-hold, carried from
// `home`, for a completion that is expensive to undo. Its two non-negotiables are both here.
//
// - A visible progress indicator for the whole hold: a ring that fills. Under reduced motion it
//   fills in steps, not in a sweep, since it is the only sign that the gesture is working.
// - An immediate path for assistive technology and a keyboard, which needs no hold. What they
//   meet is one control, a button named for what it completes, and activating it completes at
//   once. A gesture that is the only way to do something is an accessibility failure.
//
// The two paths are two elements, and neither guesses the other from how long a press lasted
// (the web's rule, ADR 0025). The ring is what a finger lands on: it answers touches alone, and
// is hidden from a screen reader. The button around it is what everything else meets, and no
// finger reaches it, the ring covering it whole. How an activation arrives is the platform's:
//
// - on iOS a screen reader's double tap, and whatever else activates as it does, asks the
//   element to activate itself, which React Native hands on as `onAccessibilityTap`, and only
//   where that is set: without it iOS taps the screen in its place, and the tap would land on
//   the ring as a hold let go at once;
// - on Android a screen reader's double tap performs the click action, which is the `activate`
//   accessibility action where one is declared;
// - a keyboard's Enter on Android clicks the focused view, which reaches a pressable as a press
//   with no touch before it;
// - and the `activate` action is listed among an element's actions by iOS under its label,
//   which is why it carries the control's own name: left bare it would be read as its
//   identifier, in English.
//
// A release before the time is up does nothing and says so, for as long as a toast would stay,
// and the control is then idle again, as it was. A finger that leaves the ring gives the hold up.
//
// Completed, it stays so for as long as it is drawn, and takes no second completion: what it
// knows is what it did, and not what became of it. A row that is to be completed again, after an
// undo or a write the server refused, draws a control of its own for it, by a `key` that changes
// with what is to be completed.
import { reducedMotion, thresholds } from '@household/tokens'
import type { ColorName } from '@household/tokens/native'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Animated,
  Easing,
  Pressable,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
} from 'react-native'
import { Circle, Svg } from 'react-native-svg'
import { useDisplay, useTarget, useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { announce as say } from './announce.ts'
import { BaseIcon } from './Icon.tsx'
import { Text } from './Text.tsx'

export type HoldPhase = 'idle' | 'holding' | 'released' | 'completing' | 'completed' | 'failed'

export interface HoldToCompleteProps {
  /** What it completes, by name: "Complete Take out the bins". */
  readonly label: string
  /**
   * Completes it. A promise it returns is waited for: the control says it is completing, then
   * how it went. Anything else it returns is not read. What it throws is thrown on, once the
   * control has said that it failed.
   */
  readonly onComplete: () => unknown
}

/** The ring, on the grid the web draws it on: a box of 44, a radius of 19, a stroke of 3. */
const ring = { box: 44, radius: 19, stroke: 3 } as const
const circumference = 2 * Math.PI * ring.radius
/** The ring's centre on that grid, as a drawing's attribute writes a number. */
const centre = String(ring.box / 2)

const Fill = Animated.createAnimatedComponent(Circle)

/**
 * A fill in `steps` steps, each taken as its share of the time ends: what reduced motion draws
 * in a sweep's place (CSS's `steps(n, end)`).
 */
export function stepped(steps: number): (time: number) => number {
  return (time) => Math.floor(time * steps) / steps
}

/**
 * Whether a completion returned something to wait for. A promise is told by its `then`, as the
 * platform tells one: a library's own is no instance of the app's.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  )
}

/** Whether a phase is one that takes no hold and no second completion. */
function settled(at: HoldPhase): boolean {
  return at === 'completing' || at === 'completed'
}

/** The colour of the mark in the ring: muted until it has something to say. */
const marks: Readonly<Partial<Record<HoldPhase, ColorName>>> = {
  completed: 'positive',
  failed: 'danger',
}

export function HoldToComplete({ label, onComplete }: HoldToCompleteProps) {
  const t = useTranslate()
  const theme = useTheme()
  const target = useTarget()
  const display = useDisplay()
  const [phase, setPhase] = useState<HoldPhase>('idle')
  // The phase as it is now, which is what a touch's handler asks. The hold's timer fires
  // between two draws, and a finger lifted in that instant, as the ring fills, would be told by
  // the last draw that it is held still: the release would be taken for an early one, its word
  // put over a completion that has run, and the control made idle again to complete it twice.
  const now = useRef<HoldPhase>('idle')
  const turn = (next: HoldPhase) => {
    now.current = next
    setPhase(next)
  }
  // The one timer the control has: the hold's while it is held, and the word's after a release.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const mounted = useRef(true)
  // What completes it, as its owner last said. The hold's timer is set two seconds before it
  // fires, and a row drawn again in between, by a sync that brought it a newer version, has
  // handed down another: the completion is the one asked at the end of the hold.
  const latest = useRef(onComplete)
  useLayoutEffect(() => {
    latest.current = onComplete
  })

  // How far round the ring is filled, from nothing to all of it, and the fill on its way.
  const [filled] = useState(() => new Animated.Value(0))
  const sweep = useRef<Animated.CompositeAnimation>(undefined)
  const fill = (to: 0 | 1) => {
    sweep.current?.stop()
    filled.setValue(to)
  }
  // Where the ring stands on the screen, which a finger's leaving is told against.
  const origin = useRef({ x: 0, y: 0 })
  // A keyboard's focus, or a switch's: a touch gives none, so this is drawn for them alone.
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(timer.current)
      sweep.current?.stop()
    }
  }, [])

  const complete = () => {
    clearTimeout(timer.current)
    fill(1)
    turn('completing')
    const finish = (next: HoldPhase) => {
      if (!mounted.current) return
      if (next === 'failed') fill(0)
      turn(next)
    }
    let result: unknown
    try {
      result = latest.current()
    } catch (error) {
      // The control is not left saying that it is completing. And what was thrown is thrown on:
      // a promise refused is a write that did not go through, which its owner hears of, and a
      // throw is its owner's fault, which the app reports as it does any other.
      finish('failed')
      throw error
    }
    if (isThenable(result)) {
      Promise.resolve(result).then(
        () => {
          finish('completed')
        },
        () => {
          finish('failed')
        },
      )
    } else {
      finish('completed')
    }
  }

  /** Completes at once: what an activation that is no touch comes to. */
  const activate = () => {
    if (!settled(now.current)) complete()
  }

  const press = (event: GestureResponderEvent) => {
    if (settled(now.current)) return
    const { pageX, pageY, locationX, locationY } = event.nativeEvent
    origin.current = { x: pageX - locationX, y: pageY - locationY }
    clearTimeout(timer.current)
    turn('holding')
    filled.setValue(0)
    // The whole hold, by the threshold's own token, which reduced motion does not shorten: it
    // is then stepped, not removed. The fill only shows the hold: the timer is what ends it.
    sweep.current = Animated.timing(filled, {
      toValue: 1,
      duration: thresholds['hold-to-complete'],
      easing: display.reducedMotion ? stepped(reducedMotion.holdSteps) : Easing.linear,
      // A stroke is drawn by the drawing's own code, which the native driver does not reach.
      useNativeDriver: false,
    })
    sweep.current.start()
    timer.current = setTimeout(complete, thresholds['hold-to-complete'])
  }
  const release = () => {
    // Let go of a hold, and of nothing else: once the time is up the hold is over, and the
    // finger's going is no early release, whether or not the control has been drawn since.
    if (now.current !== 'holding') return
    clearTimeout(timer.current)
    fill(0)
    turn('released')
    // It says to keep holding for as long as a toast would say it, and is then as it was
    // (02-components §4.1: released early, it returns to idle). A row touched once is not left
    // saying it.
    timer.current = setTimeout(() => {
      turn('idle')
    }, thresholds['toast-dwell'])
  }
  const move = (event: GestureResponderEvent) => {
    // A finger slid off the ring calls the hold off, and sliding back on begins none: a hold
    // begins where a finger comes down.
    const x = event.nativeEvent.pageX - origin.current.x
    const y = event.nativeEvent.pageY - origin.current.y
    if (x < 0 || y < 0 || x > target || y > target) release()
  }

  const word =
    phase === 'released'
      ? t('ui.hold.keep_holding')
      : phase === 'completing'
        ? t('ui.hold.completing')
        : phase === 'completed'
          ? t('ui.hold.completed')
          : phase === 'failed'
            ? t('ui.hold.failed')
            : undefined
  // Said as it changes, to whoever does not see it change: that it is completing, how it went,
  // and that a hold let go early has to be held for longer.
  useEffect(() => {
    if (word !== undefined) say(word)
  }, [word])

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['space-1'],
        flexShrink: 1,
      }}
    >
      <Pressable
        testID={`hold:${phase}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        // Completing or completed, it takes no activation and says so; it is never taken away,
        // and keeps a screen reader's focus.
        accessibilityState={{ busy: phase === 'completing', disabled: settled(phase) }}
        accessibilityActions={[{ name: 'activate', label }]}
        onAccessibilityAction={(event: AccessibilityActionEvent) => {
          if (event.nativeEvent.actionName === 'activate') activate()
        }}
        onAccessibilityTap={activate}
        // A press that reaches the button is no finger's: the ring is over all of it.
        onPress={activate}
        onFocus={() => {
          setFocused(true)
        }}
        onBlur={() => {
          setFocused(false)
        }}
        style={{
          minWidth: target,
          minHeight: target,
          borderRadius: theme.radii['radius-full'],
          ...(focused
            ? {
                outlineWidth: 2,
                outlineStyle: 'solid',
                outlineOffset: 2,
                outlineColor: theme.color.focus,
              }
            : {}),
        }}
      >
        <View
          testID="hold-ring"
          // A finger's alone: assistive technology meets the button, and completes with no hold.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          // The touch is the ring's own from where it lands, whatever is drawn in it, and is
          // not given up to a row that would open under it or to a list that would swipe.
          pointerEvents="box-only"
          onStartShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={press}
          onResponderMove={move}
          onResponderRelease={release}
          onResponderTerminate={release}
          style={{ width: target, height: target, alignItems: 'center', justifyContent: 'center' }}
        >
          <Svg
            width={target}
            height={target}
            viewBox={`0 0 ${String(ring.box)} ${String(ring.box)}`}
            style={{ position: 'absolute' }}
          >
            <Circle
              cx={ring.box / 2}
              cy={ring.box / 2}
              r={ring.radius}
              fill="none"
              stroke={theme.color['hold-track']}
              strokeWidth={ring.stroke}
            />
            <Fill
              cx={ring.box / 2}
              cy={ring.box / 2}
              r={ring.radius}
              fill="none"
              stroke={theme.color['hold-fill']}
              strokeWidth={ring.stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={filled.interpolate({
                inputRange: [0, 1],
                outputRange: [circumference, 0],
              })}
              // The fill starts at the top and runs clockwise.
              transform={`rotate(-90 ${centre} ${centre})`}
            />
          </Svg>
          <BaseIcon name="check" color={marks[phase] ?? 'text-muted'} />
        </View>
      </Pressable>
      {word === undefined ? null : (
        <Text step="caption" style={{ flexShrink: 1 }}>
          {word}
        </Text>
      )}
    </View>
  )
}
