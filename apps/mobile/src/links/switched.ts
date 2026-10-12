// A link that opened another household than the one on screen (F-16, 04-navigation §8, the
// wrong-household case). The household is in the address (D-4), so opening the link is the
// switch: it needs no step of its own. What it needs is to be said, since everything else on
// screen changed with it, and one control that goes back, which the household's frame draws
// (`shell.switched.*`). This file holds the fact it draws them from.
//
// It is said only where a link made the switch: an address that arrived (Links.tsx) and named
// another household than the one that was drawn. The first household the app opens is no
// switch, and neither is one its member chose themselves, in the switcher or by the banner's
// own way back, which arrive as no link.
import { useEffect, useSyncExternalStore } from 'react'
import { onForget } from '../session/forget.ts'

export interface Switched {
  /** The household that was on screen before the link: where *back* leads, if it is still its member's. */
  readonly from: string
  /** The household the link opened. */
  readonly to: string
}

let shown: string | null = null
let arriving: string | null = null
let switched: Switched | null = null
const listeners = new Set<() => void>()

function say(next: Switched | null): void {
  if (switched === next) return
  switched = next
  for (const listener of [...listeners]) listener()
}

/** The household whose screens are drawn, or null where none has been. */
export function shownHousehold(): string | null {
  return shown
}

/** Notes that a link is on its way to `household`, another than the one on screen. */
export function linkArrived(household: string): void {
  arriving = household.toLowerCase()
}

/**
 * Notes that `household`'s screens are drawn: its frame says so as it opens. Where a link led
 * here from another household, that is a switch to say; any other way here is not, and puts
 * away one said before.
 */
export function householdShown(household: string): void {
  const id = household.toLowerCase()
  if (shown !== null && shown !== id && arriving === id) say({ from: shown, to: id })
  else if (switched?.to !== id) say(null)
  shown = id
  arriving = null
}

/** Puts the notice away: its member dismissed it. */
export function dismissSwitched(): void {
  say(null)
}

/** Begins again, with nothing on screen: whoever was here is gone. */
export function resetSwitched(): void {
  shown = null
  arriving = null
  say(null)
}

// Which household was on screen is its member's to have been in, and the next one's to know
// nothing of.
onForget(resetSwitched)

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * For the frame of `household`: says its screens are drawn, and answers with the switch a link
 * made to get here, or null. The frame draws the notice from it, names `from` only where it is
 * still one of its member's households that opens, and calls `dismissSwitched` to put it away.
 *
 * `inFront` is whether this frame is the one its member is looking at. A stack keeps the screen
 * a link was opened over, so two households' frames may stand at once, and the one underneath
 * is drawn again, with no link, when its member goes back to it.
 */
export function useSwitchedByLink(household: string, inFront = true): Switched | null {
  useEffect(() => {
    if (inFront) householdShown(household)
  }, [household, inFront])
  const current = useSyncExternalStore(subscribe, () => switched)
  return current?.to === household.toLowerCase() ? current : null
}
