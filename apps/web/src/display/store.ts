// The display modes in this browser: read from and written to localStorage, and put on the root as
// the attributes the tokens' stylesheet reads. Storage may be refused, in a private window or by a
// policy; the modes then last as long as the page does.
import { attributesOf, parsePreferences, storageKey, type DisplayPreferences } from './modes.ts'

/** What is kept in this browser, or the defaults where nothing is, or nothing can be read. */
export function readPreferences(): DisplayPreferences {
  try {
    return parsePreferences(window.localStorage.getItem(storageKey))
  } catch {
    return parsePreferences(null)
  }
}

export function writePreferences(preferences: DisplayPreferences): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(preferences))
  } catch {
    // Kept for this page alone.
  }
}

/** Puts `preferences` on `root` as the stylesheet reads them, taking off what they do not set. */
export function applyPreferences(root: Element, preferences: DisplayPreferences): void {
  for (const [attribute, value] of Object.entries(attributesOf(preferences))) {
    if (value === null) root.removeAttribute(attribute)
    else root.setAttribute(attribute, value)
  }
}

/** One CSS pixel per `1/16` rem: the root font size the type scale assumes at 100 % text. */
const remPx = 16

/**
 * How large text is drawn against the scale's own size: 2 at 200 % text, whether the member's
 * browser, their device or `data-scale` set it. Page zoom is not text scale: it enlarges every
 * pixel alike and leaves this at 1. Where the root's size cannot be measured, the attribute says.
 */
export function measureTextScale(root: Element): number {
  const measured = Number.parseFloat(window.getComputedStyle(root).fontSize)
  if (Number.isFinite(measured) && measured > 0) return measured / remPx
  return root.getAttribute('data-scale') === '200' ? 2 : 1
}
