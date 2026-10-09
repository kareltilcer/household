// A short name for a browser session (A-12). The server keeps a session's raw `User-Agent` and
// nothing else of what it ran in, so the list derives a name a member recognises from it, a
// browser and a system for the common cases, and falls back to a generic word: a string of
// version numbers tells nobody which of their computers it was. It is a guess at a label, never
// a check of anything, and a header anyone may write is drawn nowhere as it was sent.
//
// The same names say what a household's replicas and clients are (health/), which the server
// keeps under the same two things: a browser's raw `User-Agent`, or a device's own label. So a
// browser is named for the browser and the system its header tells, and a device by its label,
// or by its kind where it named nothing (`useClientNames`).
import type { Translate } from '@household/i18n/lazy'
import { useTranslate } from '../i18n/I18nProvider.tsx'

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

/** A device's platform, as the account's record of it names one. */
export type Platform = 'ios' | 'android'

/** The names of what an account is signed in on, and of what syncs a household, as a member would say them. */
export interface ClientNames {
  /** A browser, from the `User-Agent` the server keeps of it. */
  readonly ofAgent: (userAgent: string | undefined) => string
  /** A browser, from the browser and the system a header told, each where it told one. */
  readonly ofBrowser: (browser: Browser | null | undefined, system?: System | null) => string
  /** A phone or a tablet: as it named itself or was renamed, or by its kind where it named nothing. */
  readonly ofDevice: (label: string | undefined, platform: Platform | null | undefined) => string
  /** What kind of device a platform is. */
  readonly ofPlatform: (platform: Platform | null | undefined) => string
}

export function useClientNames(): ClientNames {
  const t = useTranslate()
  const ofBrowser: ClientNames['ofBrowser'] = (given, on) => {
    const browser = given == null ? undefined : browserName(t, given)
    const system = on == null ? undefined : systemName(t, on)
    if (browser !== undefined && system !== undefined) {
      return t('account.devices.agent.both', { browser, system })
    }
    if (browser !== undefined) return browser
    if (system !== undefined) return t('account.devices.agent.system', { system })
    return t('account.devices.agent.unknown')
  }
  return {
    ofAgent: (userAgent) => {
      const agent = agentOf(userAgent)
      return ofBrowser(agent.browser, agent.system)
    },
    ofBrowser,
    ofDevice: (label, platform) => {
      const written = (label ?? '').trim()
      return written === '' ? platformName(t, platform) : written
    },
    ofPlatform: (platform) => platformName(t, platform),
  }
}

function browserName(t: Translate, browser: Browser): string {
  switch (browser) {
    case 'edge':
      return t('account.devices.browser.edge')
    case 'opera':
      return t('account.devices.browser.opera')
    case 'samsung':
      return t('account.devices.browser.samsung')
    case 'firefox':
      return t('account.devices.browser.firefox')
    case 'chrome':
      return t('account.devices.browser.chrome')
    case 'safari':
      return t('account.devices.browser.safari')
  }
}

function systemName(t: Translate, system: System): string {
  switch (system) {
    case 'iphone':
      return t('account.devices.system.iphone')
    case 'ipad':
      return t('account.devices.system.ipad')
    case 'android':
      return t('account.devices.system.android')
    case 'windows':
      return t('account.devices.system.windows')
    case 'chromeos':
      return t('account.devices.system.chromeos')
    case 'macos':
      return t('account.devices.system.macos')
    case 'linux':
      return t('account.devices.system.linux')
  }
}

function platformName(t: Translate, platform: Platform | null | undefined): string {
  switch (platform) {
    case 'ios':
      return t('account.devices.device.ios')
    case 'android':
      return t('account.devices.device.android')
    default:
      return t('account.devices.device.unknown')
  }
}
