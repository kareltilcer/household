// What every end-to-end test stands on. A page is opened with the display modes and the language
// a test names, set where the app keeps them, before its first script runs. And every test fails
// on what no page may do: break the policy (build/csp.ts), or log an error.
import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, test as base, type Locator, type Page } from '@playwright/test'
import { previewOrigin, stripeStandInOrigin } from '../build/preview.ts'
import { apiPath } from '../src/api/names.ts'
import { paths, type RouteId } from '../src/app/paths.ts'
import { storageKey as displayKey, type DisplayPreferences } from '../src/display/modes.ts'
import { storageKey as localeKey } from '../src/i18n/storage.ts'
import { buildFile } from '../src/update/build.ts'
import { createHousehold, network, person, register, signIn, whoAmI, type Person } from './stack.ts'

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

/**
 * Waits for the page to draw `count` more frames. What is announced politely as it arrives, a
 * banner or the offline bar, is drawn before its words, which are put into it two frames later
 * (ui/Banner): a gate that looked at the page sooner would pass over them, and a test that
 * expects nothing to be drawn would find nothing whatever the page went on to do. Not for a
 * page whose clock a test holds, where no frame comes by itself.
 */
export function frames(page: Page, count = 3): Promise<void> {
  return page.evaluate(
    (wanted) =>
      new Promise<void>((resolve) => {
        const next = (left: number) => {
          if (left === 0) resolve()
          else {
            requestAnimationFrame(() => {
              next(left - 1)
            })
          }
        }
        next(wanted)
      }),
    count,
  )
}

/**
 * The reads this browser keeps, by their keys: the app's persisted cache as it wrote it, one
 * clone under one key of one store (src/api/query.ts). Read once the app has drawn, which is
 * after it opened the store.
 */
export function kept(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const opening = indexedDB.open('household-web')
        opening.onerror = () => {
          reject(new Error('the kept reads could not be opened'))
        }
        opening.onsuccess = () => {
          const database = opening.result
          const read = database.transaction('query-cache').objectStore('query-cache').get('client')
          read.onerror = () => {
            reject(new Error('the kept reads could not be read'))
          }
          read.onsuccess = () => {
            const client = read.result as
              | { readonly clientState: { readonly queries: { readonly queryHash: string }[] } }
              | undefined
            database.close()
            resolve((client?.clientState.queries ?? []).map((query) => query.queryHash))
          }
        }
      }),
  )
}

/**
 * What `colours` come to, drawn one over another in that order: the red, green and blue of the
 * result, each 0 to 255. A colour is whatever the browser computed, in whatever notation, a veil
 * that lets what is under it through among them.
 */
export function drawn(page: Page, colours: readonly string[]): Promise<number[]> {
  return page.evaluate((layers) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('no canvas to draw a colour on')
    for (const layer of layers) {
      context.fillStyle = layer
      context.fillRect(0, 0, 1, 1)
    }
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
  }, colours)
}

/** WCAG 2.1 at levels A and AA: the release gate (06-clients §4). */
const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/**
 * Fails on any axe violation of the page as it stands, naming the rule and each element. What is
 * still arriving is waited for first: the words of a region that is drawn before them, and what
 * fades in, since axe reads a colour as it is drawn, and one read half-way through a dialog's
 * fade is no colour of the design's.
 */
export async function expectAccessible(page: Page): Promise<void> {
  await frames(page)
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        // One that never ends, a busy button's turning, has no end to wait for.
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  )
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze()
  expect(
    violations.flatMap((violation) =>
      violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')}`),
    ),
  ).toEqual([])
}

/**
 * Plain words a page may show that are no language of the app's: what `Intl` writes into a date
 * in English, the language the pseudo-locale formats in. A unit or a currency code is under the
 * length that counts as a word.
 */
const formatted = new Set(
  Array.from({ length: 12 }, (_, month) =>
    (['long', 'short'] as const).map((style) =>
      new Intl.DateTimeFormat('en', { month: style, timeZone: 'UTC' }).format(
        Date.UTC(2026, month, 1),
      ),
    ),
  ).flat(),
)

/** The shortest run of plain letters that is taken for a word: `kWh` and `CZK` are not. */
const wordLength = 4

/** What the pseudo-locale pass found on a page, each list empty where nothing is wrong. */
export interface Finding {
  /** Words in plain letters: strings that escaped the catalogs. */
  readonly escaped: string[]
  /** Texts whose opening brackets and closing ones do not pair: a cut-off end. */
  readonly unbalanced: string[]
  /** Texts wider than the box that clips them. */
  readonly clipped: string[]
}

/**
 * The pseudo-locale pass over the page as it stands (PRD 03 §9, 06-clients §8), in `en-XA`: every
 * text that is drawn, in a dialog, a menu or a toast as on the page beneath them, the words of a
 * region drawn before them among it.
 */
export async function inspect(page: Page): Promise<Finding> {
  await frames(page)
  return page.evaluate(
    ([shortest, allowed]) => {
      const plain = new RegExp(`[A-Za-z]{${String(shortest)},}`, 'g')
      const escaped: string[] = []
      const unbalanced: string[] = []
      const clipped: string[] = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = (node.textContent ?? '').trim()
        const parent = node.parentElement
        if (text === '' || parent === null || !parent.checkVisibility()) continue
        if (parent.closest('script, style, option') !== null) continue
        for (const word of text.match(plain) ?? []) {
          if (!allowed.includes(word)) escaped.push(`${word} in "${text.slice(0, 60)}"`)
        }
        const opened = text.split('⟦').length - 1
        const closed = text.split('⟧').length - 1
        if (opened !== closed) unbalanced.push(text.slice(0, 80))
      }
      for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
        if (!element.checkVisibility() || element.textContent.trim() === '') continue
        // Drawn nowhere by design: a word for assistive technology alone (ui/a11y.module.css).
        const box = element.getBoundingClientRect()
        if (box.width <= 1 || box.height <= 1) continue
        const style = window.getComputedStyle(element)
        const clips = style.overflowX === 'hidden' || style.overflowX === 'clip'
        if (clips && element.scrollWidth - element.clientWidth > 1) {
          clipped.push(element.textContent.trim().slice(0, 60))
        }
      }
      return { escaped, unbalanced, clipped }
    },
    [wordLength, [...formatted]] as const,
  )
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

/**
 * Whether a console error is the browser's own note that the API refused a request: an answer in
 * the four hundreds from `/api/v1`. A refusal is an answer the contract names, a wrong password's
 * `401` or a spent link's `410`, which the app reads and says in its own words, and a browser
 * logs each as an error all the same. Any other failed request is a fault: a file of the app's
 * own that is missing, the API failing (a five hundred), a service that cannot be reached.
 */
function refusal(text: string, url: string): boolean {
  if (!/^Failed to load resource: the server responded with a status of 4\d\d\b/.test(text)) {
    return false
  }
  try {
    const asked = new URL(url)
    return asked.origin === previewOrigin && asked.pathname.startsWith(`${apiPath}/`)
  } catch {
    return false
  }
}

/** A person the suite registered, and the household it made for them once one was needed. */
export interface Account {
  readonly who: Person
  household?: string
  /** Their id, which their own page among the household's members is addressed by. */
  user?: string
}

/** The suite's stand-in for Stripe.js (stripe.js), read once for every test of a worker. */
const standInScript = readFile(new URL('./stripe.js', import.meta.url), 'utf8')

/** Where a page asks for the processor's script, and where that script asks the processor. */
const stripe = { script: 'https://js.stripe.com/**', api: 'https://api.stripe.com/**' } as const

interface Fixtures {
  readonly faults: string[]
  /** The address this test's requests come from, to the server: its own (stack.ts). */
  readonly network: string
  /**
   * Whose script a payment form loads: the suite's stand-in for Stripe.js, unless a test says the
   * processor's own, which only the check of the policy against it does (stripe.spec.ts).
   */
  readonly processorScript: 'stand-in' | 'stripe'
  readonly processor: undefined
  /**
   * Signs this test's page in as the worker's member, who owns a household, and returns the
   * household's id. A member's routes are opened after it.
   */
  readonly enter: () => Promise<string>
}

/**
 * The person this worker's tests sign in as: one for each worker, since each worker loads this
 * file once. Registered by the first test that enters as them, since registering asks the API
 * from a page.
 */
const account: Account = { who: person() }

export const test = base.extend<Fixtures>({
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
        if (message.type() !== 'error') return
        if (refusal(message.text(), message.location().url)) return
        faults.push(message.text())
      })
      page.on('pageerror', (error) => {
        faults.push(error.message)
      })
      await use(faults)
      expect(faults, 'errors and policy violations on the page').toEqual([])
    },
    { auto: true },
  ],

  network: [
    async ({ context }, use) => {
      const address = network()
      // Named to the API alone, as a proxy in front of it would: on a request to another origin,
      // the sync service's, the header would be one the page seemed to add, which that origin
      // has not said it takes, and the browser would refuse the request before sending it.
      await context.route(`${previewOrigin}${apiPath}/**`, (route) =>
        route.continue({
          headers: { ...route.request().headers(), 'x-forwarded-for': address },
        }),
      )
      await use(address)
    },
    { auto: true },
  ],

  processorScript: ['stand-in', { option: true }],

  // The payment processor, for every test: the suite never reaches Stripe. A page that draws a
  // payment form asks Stripe for its script, and is answered the stand-in for it (stripe.js);
  // that script confirms a payment by asking Stripe's API, which is answered here, from Node, by
  // the stand-in for Stripe's server at its loopback origin (stack.ts). Both are asked for at
  // the origins the app's policy admits for the processor, so the policy is held as it is
  // written, and no directive is wider for the suite. A test that draws no payment form asks
  // for neither, and nothing here touches it.
  processor: [
    async ({ context, processorScript }, use) => {
      if (processorScript === 'stand-in') {
        await context.route(stripe.script, async (route) =>
          route.fulfill({ contentType: 'text/javascript', body: await standInScript }),
        )
        await context.route(stripe.api, async (route) => {
          // What the form's script sent, as a form (stripe.js): the secret, and how it is paid.
          const sent = new URLSearchParams(route.request().postData() ?? '')
          const answer = await fetch(`${stripeStandInOrigin}/_standin/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_secret: sent.get('client_secret'),
              with: sent.get('with'),
            }),
          })
          await route.fulfill({
            status: answer.status,
            contentType: 'application/json',
            // Another origin than the page's: the browser hands the page its answer only where
            // that origin says it may, as Stripe's does.
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: await answer.text(),
          })
        })
      }
      await use(undefined)
    },
    { auto: true },
  ],

  enter: async ({ page }, use) => {
    await use(async () => {
      // A document of the app's origin to ask the API from, with none of the app in it.
      await page.goto(buildFile)
      if (account.household === undefined) {
        await register(page, account.who)
        await signIn(page, account.who)
        account.user = await whoAmI(page)
        account.household = await createHousehold(page)
      } else {
        await signIn(page, account.who)
      }
      return account.household
    })
  },
})

/**
 * An address that reaches the route `id`, for the suite's walk of every route (paths.ts): its
 * example, opened as whoever the route is drawn for. A member's route is entered first, and an
 * example that names a household names the member's own, and one that names a member names
 * them.
 */
export async function reach(id: RouteId, enter: () => Promise<string>): Promise<string> {
  const { example, layout } = paths[id]
  if (layout !== 'account' && layout !== 'household') return example
  const household = await enter()
  return example.replace('{household}', household).replace('{member}', account.user ?? '')
}

export { displayKey, expect }
