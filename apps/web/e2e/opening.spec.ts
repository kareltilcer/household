// The visit that opens the app at a member's address (ADR 0025): the shell around an account or
// a household is a file as its screen is, so two files are on their way, and what every route is
// drawn in is on the page before either has come. And the visit that opens it at its root, which
// sends a member on to such an address. A browser alone can say so of a build: the files are the
// build's own, fetched as a deployment serves them, and each test here holds one back or takes
// it away where the network answers.
import type { Page } from '@playwright/test'
import { apiPath } from '../src/api/names.ts'
import { inHousehold, paths } from '../src/app/paths.ts'
import { expect, expectAccessible, frames, takenAway, test } from './fixtures.ts'

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
  const known = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `${apiPath}/me`,
  )
  await page.goto(inHousehold.home(household), { waitUntil: 'commit' })
  // Who is signed in is asked, answered and drawn before the page is looked at. The guard draws
  // the same shape while it does not know its member, and a look taken then would pass whatever
  // the shell's own place gave way to once it did.
  await (await known).finished()
  await frames(page, 6)
  // The member is known and the shell's file has not come: one landmark, with the shape of a
  // page in it where it can be seen, and nothing of a shell.
  const landmark = page.getByRole('main')
  await expect(landmark.getByRole('status', { name: 'Loading' })).toBeVisible()
  await expect(landmark).toHaveCount(1)
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expectAccessible(page)

  await shell.release()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Household' })).toBeVisible()
  await expect(landmark).toHaveCount(1)
})

test('a member who opens the app at its root is drawn the shape of a page until the shell they are sent on to has come', async ({
  page,
  enter,
}) => {
  await enter()
  const shell = await hold(page, files.household)
  // The shell is asked for as the member is sent on to their household: who is signed in and
  // which households are theirs have been read by then, and the route that sent them on is what
  // is drawn until the shell has come.
  const sentOn = page.waitForRequest(files.household)
  await page.goto(paths.home.path, { waitUntil: 'commit' })
  await sentOn
  await frames(page, 6)
  const landmark = page.getByRole('main')
  await expect(landmark.getByRole('status', { name: 'Loading' })).toBeVisible()
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
    await takenAway(page, file)
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
