// The modal that is open (ADR 0025). A `<dialog>` opened modally makes everything outside itself
// inert: it takes no press and no focus, and assistive technology does not read it. So what a
// component draws apart from where it stands, a menu's list or the toasts, is drawn inside the
// open modal for as long as one is open, or it could not be reached. The dialogs say here when
// they open and close, and a menu and the toasts ask which one is on top. A menu is drawn for a
// press and gone with the next one. The toasts outlast a modal's opening and its closing, so they
// are one element that is moved into the modal on top and out of it again (`standOnTop`).
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
 * Puts `element` at the end of `parent`. One that is in the document already is moved as it is,
 * where the platform can (`moveBefore`): an animation part run goes on, and a pointer on it is on
 * it still. Where it cannot, the element is taken out and put in, which is the same element to
 * whoever holds it, and one whose animation the browser begins again if it is still on it.
 *
 * A focus inside it is not kept, either way. The move itself leaves it there, and what the move
 * is made for takes it: a dialog takes the focus as it opens, and as one closes the platform
 * gives the focus to what opened it, wherever the focus was.
 */
function put(element: HTMLElement, parent: HTMLElement): void {
  if (element.parentNode === parent) return
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
export function standOnTop(element: HTMLElement): () => void {
  const stand = () => {
    put(element, top() ?? document.body)
  }
  stand()
  const unwatch = watch(stand)
  return () => {
    unwatch()
    element.remove()
  }
}
