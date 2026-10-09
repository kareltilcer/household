// How the screens of a household's sync name what they list, and how they draw what is no word
// of a catalog's. A replica's label is what the server kept of where it reported from: a
// device's own label, which its member wrote, or a browser's raw `User-Agent`, which is drawn
// nowhere as it was sent (account/userAgent.ts). So a browser is named for the browser and the
// system its header tells, in the words *where you are signed in* names it by, and a device by
// its label, or by its kind where it named nothing.
import { pseudoLocale, pseudolocalize, type Translate } from '@household/i18n/lazy'
import { useCallback } from 'react'
import { agentOf, type Browser, type System } from '../account/userAgent.ts'
import { useI18n, useTranslate } from '../i18n/I18nProvider.tsx'

/** A device's platform, as its account's record of it names one. */
export type Platform = 'ios' | 'android'

export interface ClientNames {
  /** A browser, from the `User-Agent` its replica reported under. */
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

/** A run of plain letters, each accented as the pseudo-locale accents it, and nothing added. */
function accented(run: string): string {
  // The pseudo-locale brackets and pads a message: the letters between are the run's own, one
  // for one.
  return pseudolocalize(run).slice(1, 1 + run.length)
}

/**
 * What is data and no word, as the page draws it: a version, an id, a zone's name, an address,
 * and the text of a bundle exactly as it is sent. In a language of the app's it is drawn as it
 * is. The pseudo-locale accents its letters, as it accents every word of the catalogs, so that
 * its pass tells data from a word nobody translated; it adds no bracket and no padding, data
 * being no sentence that could be cut off. The text may hold anything, a brace or an
 * apostrophe among it: it is never read as a message.
 */
export function useData(): (text: string) => string {
  const { locale } = useI18n()
  return useCallback(
    (text) => (locale === pseudoLocale ? text.replace(/[A-Za-z]+/g, accented) : text),
    [locale],
  )
}
