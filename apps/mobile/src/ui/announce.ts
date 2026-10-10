// What is said to whoever cannot see it (the twins of D-165 and D-166 on a device), and what the
// device says of its reader. This is the one file that calls React Native's `AccessibilityInfo`:
// a component announces, moves the focus and asks about the device through here, so what the
// app says aloud can be read in one place, and a test stands in for one module.
import type { Component } from 'react'
import { AccessibilityInfo, findNodeHandle } from 'react-native'

/**
 * Says `message` to a screen reader once it has finished what it is saying: a success, a change
 * of state, a wait. Nothing is said for an empty message.
 */
export function announce(message: string): void {
  if (message === '') return
  AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true })
}

/**
 * Says `message` at once, over what is being said: a failure, and nothing else. A screen that
 * opens with a failure announces nothing: it is read in its place.
 */
export function announceNow(message: string): void {
  if (message === '') return
  AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: false })
}

/** What a ref holds that the accessibility focus can be given to: a host component, or nothing. */
export interface Focusable {
  readonly current: Component | null
}

/**
 * Moves the accessibility focus to what `target` holds: the first field a refusal marked, the
 * control a closed sheet was opened from. It answers whether there was anything to move it to.
 */
export function focusOn(target: Focusable): boolean {
  const node = target.current === null ? null : findNodeHandle(target.current)
  if (node === null) return false
  AccessibilityInfo.setAccessibilityFocus(node)
  return true
}

/**
 * Whether the device asks for less motion, now and at each change, until the answer's function
 * is called. `listener` is told the first answer too, once the device has given it.
 */
export function watchReducedMotion(listener: (reduced: boolean) => void): () => void {
  let watching = true
  AccessibilityInfo.isReduceMotionEnabled().then(
    (reduced) => {
      if (watching) listener(reduced)
    },
    () => undefined,
  )
  const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', listener)
  return () => {
    watching = false
    subscription.remove()
  }
}

/** Whether a screen reader is on, now and at each change, until the answer's function is called. */
export function watchScreenReader(listener: (on: boolean) => void): () => void {
  let watching = true
  AccessibilityInfo.isScreenReaderEnabled().then(
    (on) => {
      if (watching) listener(on)
    },
    () => undefined,
  )
  const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', listener)
  return () => {
    watching = false
    subscription.remove()
  }
}
