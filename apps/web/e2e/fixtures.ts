// What every end-to-end test stands on. A page is opened with the display modes and the language
// a test names, set where the app keeps them, before its first script runs. And every test fails
// on what no page may do: break the policy (build/csp.ts), or log an error.
import AxeBuilder from '@axe-core/playwright'
import { expect, test as base, type Locator, type Page } from '@playwright/test'
import { storageKey as displayKey, type DisplayPreferences } from '../src/display/modes.ts'
import { storageKey as localeKey } from '../src/i18n/storage.ts'

export interface Opening extends Partial<DisplayPreferences> {
  /** The language: one Household ships, or the pseudo-locale `en-XA`. English when left out. */
  readonly locale?: string
}

/** Opens `path` as a member with these display modes and this language would see it. */
export async function open(page: Page, path: string, opening: Opening = {}): Promise<void> {
  const { locale = 'en', ...display } = opening
  await page.addInitScript(
    ([keys, values]) => {
      window.localStorage.setItem(keys.display, values.display)
      window.localStorage.setItem(keys.locale, values.locale)
    },
    [
      { display: displayKey, locale: localeKey },
      { display: JSON.stringify(display), locale },
    ] as const,
  )
  await page.goto(path)
  // Every page has one title, drawn once its route has loaded.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

/** WCAG 2.1 at levels A and AA: the release gate (06-clients §4). */
const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** Fails on any axe violation of the page as it stands, naming the rule and each element. */
export async function expectAccessible(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze()
  expect(
    violations.flatMap((violation) =>
      violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')}`),
    ),
  ).toEqual([])
}

/** What a member can press, tick or type in: the elements a target's size is measured on. */
const interactive = 'button, a[href], select, textarea, input, [role="button"]'

/**
 * The targets under `scope` that are smaller than 44 × 44 CSS px, each with its size: measured on
 * live rectangles, not on declared minimums (06-accessibility §1).
 */
export function smallTargets(scope: Locator): Promise<string[]> {
  return scope.locator(interactive).evaluateAll((elements) =>
    elements.flatMap((element) => {
      // A checkbox or a radio is pressed by its label, which is its target.
      const target =
        element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)
          ? (element.closest('label') ?? element)
          : element
      const box = target.getBoundingClientRect()
      // Drawn nowhere: the plain button that stands for a gesture (ui/HoldToComplete).
      if (box.width <= 1 && box.height <= 1) return []
      const name = (element.getAttribute('aria-label') ?? element.textContent).trim().slice(0, 40)
      return box.width < 43.5 || box.height < 43.5
        ? [`${element.tagName.toLowerCase()} "${name}" ${String(box.width)}×${String(box.height)}`]
        : []
    }),
  )
}

/**
 * Stops the page's clock before it opens, so that a test moves time itself: `page.clock.runFor`
 * fires exactly the timers that fall due, and none fires by itself.
 */
export async function holdTheClock(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-03-04T10:00:00Z') })
  await page.clock.pauseAt(new Date('2026-03-04T10:00:01Z'))
}

export const test = base.extend<{ readonly faults: string[] }>({
  // What the page did that no page may: collected as it happens, and held to nothing once the
  // test is done. A test that provokes a fault on purpose empties the list before it ends.
  faults: [
    async ({ page }, use) => {
      const faults: string[] = []
      // A violation is reported to the document: said on the console, it reaches the listener
      // below with every other error.
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          console.error(
            `Content-Security-Policy: ${event.violatedDirective} refused ${event.blockedURI}`,
          )
        })
      })
      page.on('console', (message) => {
        if (message.type() === 'error') faults.push(message.text())
      })
      page.on('pageerror', (error) => {
        faults.push(error.message)
      })
      await use(faults)
      expect(faults, 'errors and policy violations on the page').toEqual([])
    },
    { auto: true },
  ],
})

export { displayKey, expect }
