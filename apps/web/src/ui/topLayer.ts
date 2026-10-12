// The modal that is open (ADR 0025). A `<dialog>` opened modally makes everything outside itself
// inert: it takes no press and no focus, and assistive technology does not read it. So what a
// component draws apart from where it stands, a menu's list or the toasts, is drawn inside the
// open modal for as long as one is open, or it could not be reached. The dialogs say here when
// they open and close, and a menu and the toasts ask which one is on top. A menu is drawn for a
// press and gone with the next one. The toasts outlast a modal's opening and its closing, so they
// are one element that is moved into the modal on top and out of it again (`standOnTop`).
import { useSyncExternalStore } from 'react'

/** The modals that said they opened, in that order: the last is the one over everything else. */
const entered: HTMLDialogElement[] = []
const watchers = new Set<() => void>()

function changed(): void {
  for (const watcher of watchers) watcher()
}

/** Says `modal` is open, until the function this returns is called. */
export function enterTopLayer(modal: HTMLDialogElement): () => void {
  entered.push(modal)
  changed()
  return () => {
    const at = entered.lastIndexOf(modal)
    if (at !== -1) entered.splice(at, 1)
    changed()
  }
}

function watch(watcher: () => void): () => void {
  watchers.add(watcher)
  return () => {
    watchers.delete(watcher)
  }
}

function top(): HTMLDialogElement | null {
  // One the platform has closed, and whose owner has not yet said so, holds nothing any more.
  return entered.findLast((modal) => modal.open) ?? null
}

/** The modal that is open over everything else, or null while none is open. */
export function useTopModal(): HTMLDialogElement | null {
  return useSyncExternalStore(watch, top)
}

/**
 * Puts `element` at the end of `parent`. One that is in the document already is moved as it is,
 * where the platform can (`moveBefore`): an animation part run goes on, and a pointer on it and a
 * focus inside it are on it still. Where it cannot, the element is taken out and put in, which
 * is the same element to whoever holds it, and one whose animation the browser begins again.
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
 * follows: a dialog says it is closing before it closes, and before React takes it out of the
 * document with the screen that drew it, so the element leaves a dialog that is shown still.
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
