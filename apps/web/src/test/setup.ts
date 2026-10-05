// What every component test starts from: Testing Library's matchers, a document cleared between
// tests, and the few parts of a browser that jsdom leaves out and the components ask for.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

beforeEach(() => {
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
