// The modal that is open (ADR 0025). A `<dialog>` opened modally makes everything outside itself
// inert: it takes no press and no focus, and assistive technology does not read it. So what a
// component draws apart from where it stands, a menu's list or the toasts, is drawn inside the
// open modal for as long as one is open, or it could not be reached. The dialogs say here when
// they open and close, and a menu and the toasts ask which one is on top.
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
