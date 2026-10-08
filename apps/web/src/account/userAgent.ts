// A short name for a browser session (A-12). The server keeps a session's raw `User-Agent` and
// nothing else of what it ran in, so the list derives a name a member recognises from it, a
// browser and a system for the common cases, and falls back to a generic word: a string of
// version numbers tells nobody which of their computers it was. It is a guess at a label, never
// a check of anything, and a header anyone may write is drawn nowhere as it was sent.

export const browsers = ['edge', 'opera', 'samsung', 'firefox', 'chrome', 'safari'] as const
export type Browser = (typeof browsers)[number]

export const systems = [
  'iphone',
  'ipad',
  'android',
  'windows',
  'chromeos',
  'macos',
  'linux',
] as const
export type System = (typeof systems)[number]

export interface Agent {
  readonly browser: Browser | undefined
  readonly system: System | undefined
}

// In the order they must be asked: Edge, Opera and Samsung's browser each say Chrome too, Chrome
// says Safari, and every one of them says Mozilla.
const browserMarks: readonly (readonly [Browser, RegExp])[] = [
  ['edge', /\bEdg(?:e|A|iOS)?\//],
  ['opera', /\b(?:OPR|Opera)\//],
  ['samsung', /\bSamsungBrowser\//],
  ['firefox', /\b(?:Firefox|FxiOS)\//],
  ['chrome', /\b(?:Chrome|CriOS|Chromium)\//],
  ['safari', /\bSafari\//],
]

// A phone or a tablet before the system it is built on: Android says Linux, and an iPad may say
// Mac OS X.
const systemMarks: readonly (readonly [System, RegExp])[] = [
  ['iphone', /\biPhone\b/],
  ['ipad', /\biPad\b/],
  ['android', /\bAndroid\b/],
  ['windows', /\bWindows\b/],
  ['chromeos', /\bCrOS\b/],
  ['macos', /\bMac(?:intosh| OS X)\b/],
  ['linux', /\b(?:Linux|X11)\b/],
]

/** The browser and the system `userAgent` names, each where one of the common ones is told. */
export function agentOf(userAgent: string | undefined): Agent {
  const text = userAgent ?? ''
  return {
    browser: browserMarks.find(([, mark]) => mark.test(text))?.[0],
    system: systemMarks.find(([, mark]) => mark.test(text))?.[0],
  }
}
