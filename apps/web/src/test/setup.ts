// What every component test starts from: Testing Library's matchers, the five catalogs in hand,
// a document cleared between tests, and the few parts of a browser that jsdom leaves out and the
// components ask for.
import { catalogs, locales } from '@household/i18n'
import { clientParts } from '@household/i18n/lazy'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { dropCatalogs, holdCatalog } from '../i18n/catalogs.ts'

beforeEach(() => {
  // The app fetches its own words in the language it starts in before it draws (main.tsx), a
  // screen's with its file, and a language chosen later when it is chosen. A test holds all five
  // whole from the start, every part of each, so that a component drawn in any of them is drawn
  // at once; one that tests the fetching drops them. What the test before this one needed is
  // forgotten first.
  dropCatalogs()
  for (const locale of locales) holdCatalog(locale, catalogs[locale], clientParts)
  // jsdom has no media queries: every test starts on a device that prefers nothing.
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  window.sessionStorage.clear()
  for (const attribute of [...document.documentElement.attributes]) {
    document.documentElement.removeAttribute(attribute.name)
  }
})

// jsdom draws nothing, so a <dialog> is never modal there: these give it the two methods the
// component calls, as far as a test can see them. What the browser does with a modal dialog, the
// focus it traps and gives back, is the end-to-end suite's to hold (e2e/primitives.spec.ts).
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    // The platform queues the event, and so tells of a close after whatever closed it is done:
    // a dialog opened again by then is open when its `close` arrives.
    queueMicrotask(() => {
      this.dispatchEvent(new Event('close'))
    })
  }
}

// Radix measures and scrolls what it positions, with parts of the platform jsdom has none of.
if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe(): void {
      // Nothing is laid out, so nothing is resized.
    }
    unobserve(): void {
      // Nothing was observed.
    }
    disconnect(): void {
      // Nothing was observed.
    }
  }
}
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => undefined
}
if (typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => undefined
}
