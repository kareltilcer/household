// The visit that opens the app at a member's address (ADR 0025): the shell around an account or
// a household is a file as its screen is, so two files are on their way, and what every route is
// drawn in is on the page before either has come. A browser alone can say so of a build: the
// files are the build's own, fetched as a deployment serves them, and each test here holds one
// back or takes it away where the network answers.
import type { Page } from '@playwright/test'
import { inHousehold, paths } from '../src/app/paths.ts'
import { expect, expectAccessible, frames, test } from './fixtures.ts'

/** The file of each shell, as the build names it: the shell's own name, before its content's hash. */
const files = {
  account: '**/assets/AccountShell-*.js',
  household: '**/assets/HouseholdShell-*.js',
} as const

/**
 * Holds back `file` until the test lets it come: asked for, it is answered only then, and as the
 * build's own server answers it.
 */
async function hold(page: Page, file: string): Promise<{ readonly release: () => Promise<void> }> {
  let come: () => void = () => undefined
  const released = new Promise<void>((resolve) => {
    come = resolve
  })
  await page.route(file, async (route) => {
    await released
    await route.continue()
  })
  return {
    release: async () => {
      const answered = page.waitForResponse(file)
      come()
      await answered
    },
  }
}

test('a member’s page has its landmark, and says it is loading, while its shell is on its way', async ({
  page,
  enter,
}) => {
  const household = await enter()
  const shell = await hold(page, files.household)
  await page.goto(inHousehold.home(household), { waitUntil: 'commit' })
  // Who is signed in is asked and answered, and the shell's file has not come: one landmark from
  // the first drawing on, with the shape of a page in it, and nothing of a shell. The shape is
  // held to being there and said, and not to being seen: `Waiting` draws it no wider than
  // nothing, here as wherever it stands, which is its own to mend.
  const landmark = page.getByRole('main')
  await expect(landmark.getByRole('status', { name: 'Loading' })).toBeAttached()
  await expect(landmark).toHaveCount(1)
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expectAccessible(page)

  await shell.release()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Household' })).toBeVisible()
  await expect(landmark).toHaveCount(1)
})

for (const [of, file, address] of [
  ['an account', files.account, () => paths.account.example],
  ['a household', files.household, inHousehold.home],
] as const) {
  test(`a member’s page opened at ${of} whose shell a newer build took away says a newer build is live`, async ({
    page,
    enter,
    faults,
  }) => {
    const opened = address(await enter())
    await page.route('**/build.json', (route) => route.fulfill({ json: { id: 'a-newer-build' } }))
    await page.route(file, async (route) => {
      // No file is refused sooner than a page can draw: the answer is given once what every
      // route is drawn in is on the page, as it is long before any network has answered.
      await expect(page.getByRole('main')).toBeAttached()
      await frames(page)
      await route.fulfill({ status: 404, body: 'gone' })
    })
    await page.goto(opened, { waitUntil: 'commit' })
    const failure = page.getByRole('heading', { level: 1, name: 'This page could not be shown' })
    await expect(failure).toBeVisible()
    // The watch for a newer build was listening when the shell's file failed, and was not taken
    // down with it: it asked which build is live, and says so over the failure.
    await expect(page.getByText('A new version of Household is ready.')).toBeVisible()
    // The shell would have given the page its landmark, and the failure brings its own: one.
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('main')).toContainText('This page could not be shown')
    await expect(page.getByRole('navigation')).toHaveCount(0)
    // The browser says the file it was refused on its console, and the router the route that
    // failed for it: the ones this test asked for.
    expect(faults).toContainEqual(expect.stringContaining('404'))
    faults.length = 0
  })
}

test('a visitor who opens a member’s address is sent to sign in before its shell has come', async ({
  page,
}) => {
  const shell = await hold(page, files.account)
  await page.goto(paths.accountDevices.example, { waitUntil: 'commit' })
  // The shell is none of a visitor's: the way in is drawn while its file is still on its way.
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  await expect(page).toHaveURL(paths.signIn.path)
  // The file comes after all, to a page that is no longer waiting for it, and changes nothing.
  await shell.release()
  await frames(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  await expect(page).toHaveURL(paths.signIn.path)
})
