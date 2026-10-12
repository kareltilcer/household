// The modal that is open (ADR 0025). A `<dialog>` opened modally makes everything outside itself
// inert: it takes no press and no focus, and assistive technology does not read it. So what a
// component draws apart from where it stands, a menu's list or the toasts, is drawn inside the
// open modal for as long as one is open, or it could not be reached. The dialogs say here when
// they open and close, and a menu asks which one is on top. A menu is drawn for a press and gone
// with the next one. The toasts outlast a modal's opening and its closing, so they are one element
// that is moved into the modal on top and out of it again, and told where it stands (`standOnTop`).
import { useSyncExternalStore } from 'react'

/** The modals that said they opened, in that order: the last is the one over everything else. */
let entered: readonly HTMLDialogElement[] = []
const watchers = new Set<() => void>()

function changed(): void {
  for (const watcher of watchers) watcher()
}

/**
 * Says `modal` is open, until it is closing: its owner says so by the function this returns,
 * before it closes it, and the platform says so of a dialog it closes itself, behind its owner's
 * back, by a `beforetoggle` that comes while the dialog is open still.
 */
export function enterTopLayer(modal: HTMLDialogElement): () => void {
  entered = [...entered, modal]
  changed()
  const leave = () => {
    // With the modals drawn inside it, which are closed when it is (ui/Dialog.tsx). Taken away
    // together with them, it is the first to say so, React undoing a parent's effect before
    // its child's there, and it closes them before they have said anything: left for each to
    // say for itself, one inside it would be the modal on top still as it closed, and what
    // stands in it would leave a dialog that had closed.
    entered = entered.filter((other) => !modal.contains(other))
    changed()
  }
  const closing = (event: ToggleEvent) => {
    if (event.newState === 'closed') leave()
  }
  modal.addEventListener('beforetoggle', closing)
  return () => {
    modal.removeEventListener('beforetoggle', closing)
    leave()
  }
}

function watch(watcher: () => void): () => void {
  watchers.add(watcher)
  return () => {
    watchers.delete(watcher)
  }
}

function top(): HTMLDialogElement | null {
  // One the platform has closed without a word, where it sends a dialog no `beforetoggle`, and
  // whose owner has not yet said so, holds nothing any more.
  return entered.findLast((modal) => modal.open) ?? null
}

/** The modal that is open over everything else, or null while none is open. */
export function useTopModal(): HTMLDialogElement | null {
  return useSyncExternalStore(watch, top)
}

/**
 * Has `element` give up a focus inside it, and take none until the turn is over.
 *
 * The focus is not the element's to keep through a move: a dialog takes the focus as it opens,
 * and as one closes the platform gives the focus to what opened it, wherever the focus was. But
 * a dialog's owner closes it inside a commit of React's, and React, once a commit has changed
 * the document, puts the focus back on what held it before the commit, if that lost it and is in
 * the document still. The element is, on the page by then, where one left inside the dialog that
 * closed could take no focus: the focus would be among the toasts again, and on a region with
 * nothing in it where the last toast was put away by a key. So the focus leaves the element
 * first, by a `blur` that is heard whichever way the element is then moved, as Radix has to hear
 * it, which holds every toast's dwell for as long as the focus is among them; and the element
 * is inert until the commit is over, which is to take no focus.
 */
function yieldFocus(element: HTMLElement): void {
  const held = document.activeElement
  if (held === null || !element.contains(held)) return
  if (held instanceof HTMLElement || held instanceof SVGElement) held.blur()
  element.toggleAttribute('inert', true)
  queueMicrotask(() => {
    element.removeAttribute('inert')
  })
}

/**
 * Puts `element` at the end of `parent`. One that is in the document already is moved as it is,
 * where the platform can (`moveBefore`): an animation part run goes on, and a pointer that is
 * over it is over it still. Where it cannot, the element is taken out and put in, which is the
 * same element to whoever holds it, and one whose animation the browser begins again if it is
 * still on it.
 *
 * Two things are kept through neither. A focus inside it is given up (`yieldFocus`). And a press
 * held on it while it is moved comes to no click: a browser gives a click to no element that was
 * moved between the two ends of a press, as it is or out and in (Chromium 152), as it gave none
 * to an element drawn in the place of the one that was pressed.
 */
function put(element: HTMLElement, parent: HTMLElement): void {
  if (element.parentNode === parent) return
  yieldFocus(element)
  // The platform moves only what is in the document, to somewhere in it.
  if ('moveBefore' in Element.prototype && element.isConnected && parent.isConnected) {
    parent.moveBefore(element, null)
  } else {
    parent.append(element)
  }
}

/**
 * Stands `element` in the modal that is open over everything else, and at the end of the page
 * while none is, until the function this returns is called, which takes it out of the document.
 * `stood` is told where each time: the modal the element stands in, or null on the page. Whoever
 * does something for that modal learns of it there and nowhere else, so that what it holds to be
 * the element's modal is the one the element is in.
 *
 * It is moved in the turn a dialog says it opened or is closing, and not in a render that
 * follows: a dialog is said to be closing before it closes (`enterTopLayer`), and before React
 * takes it out of the document with the screen that drew it, so the element leaves a dialog that
 * is shown still. It does not where the platform closes a dialog behind its owner's back in a
 * browser that sends a dialog no `beforetoggle`: there the element is inside a closed dialog,
 * undrawn, until the owner hears of the close, and leaves it then.
 * Drawn anew at each change instead, as a portal into whichever modal is on top draws it, what
 * stands in it is other elements each time: a toast said as a confirmation leads on to another
 * screen was one element inside the confirmation and another on the page a moment later, arriving
 * twice, with what reads it out made again beside it.
 */
export function standOnTop(
  element: HTMLElement,
  stood: (modal: HTMLDialogElement | null) => void,
): () => void {
  const stand = () => {
    const modal = top()
    put(element, modal ?? document.body)
    stood(modal)
  }
  stand()
  const unwatch = watch(stand)
  return () => {
    unwatch()
    element.remove()
  }
}
