// The replica in a real browser, under the policy (plan item 25, ADR 0026): a member's household
// opens its replica, which is PowerSync's SDK, its SQLite compiled from WebAssembly in a worker,
// over IndexedDB; it asks the API for its credentials as the session does, with the cookie and
// no bearer token; and it connects to the sync service, the one origin beside its own the policy
// lets a page connect to. Every test fails on a violation of the policy and on a console error
// (fixtures.ts), so a replica that the policy refused, or that the API did, fails here. And the
// replica goes with the session it was opened as: a real database, removed from a real browser
// (D-156), where the app's own tests hold the removal over a stand-in.
import type { Page } from '@playwright/test'
import { devSyncOrigin } from '../build/deployment.ts'
import { previewOrigin } from '../build/preview.ts'
import { inHousehold } from '../src/app/paths.ts'
import { replicaDatabase, replicaLock } from '../src/sync/databases.ts'
import { buildFile } from '../src/update/build.ts'
import { expect, frames, open, test } from './fixtures.ts'
import { call } from './stack.ts'

test('a household’s replica opens under the policy, as the session, and connects', async ({
  page,
  enter,
}) => {
  const household = await enter()
  // The credentials are asked for with the session's cookie and its CSRF token, and no bearer.
  const credentials = page.waitForRequest((request) =>
    request.url().endsWith(`/households/${household}/sync/credentials`),
  )
  // And the sync service is reached: its own origin, which the policy names.
  const reached = page.waitForResponse((response) => response.url().startsWith(devSyncOrigin))
  const socket = page.waitForEvent('websocket', (opened) =>
    opened.url().startsWith(devSyncOrigin.replace(/^http/, 'ws')),
  )
  await open(page, inHousehold.home(household))

  const asked = await credentials
  expect(asked.method()).toBe('POST')
  expect(await asked.headerValue('authorization')).toBeNull()
  expect(await asked.headerValue('x-csrf-token')).not.toBeNull()
  expect((await asked.response())?.status()).toBe(200)
  await Promise.race([reached, socket])

  // The household's one database is this browser's, by its name.
  await expect
    .poll(() => page.evaluate(async () => (await indexedDB.databases()).map(({ name }) => name)))
    .toContain(replicaDatabase(household))
  // In sync and online, nothing says so: the absence of an indicator is the indicator.
  await frames(page)
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('a second tab leaves the household’s replica to the first', async ({
  page,
  context,
  enter,
}) => {
  const household = await enter()
  const lock = replicaLock(household)
  /** Who holds the household's lock, and who waits for it, among this browser's tabs. */
  const locks = (tab: typeof page) =>
    tab.evaluate(async (name) => {
      const { held = [], pending = [] } = await navigator.locks.query()
      return {
        held: held.filter((taken) => taken.name === name).length,
        pending: pending.filter((asked) => asked.name === name).length,
      }
    }, lock)
  await open(page, inHousehold.home(household))
  await expect.poll(() => locks(page)).toEqual({ held: 1, pending: 0 })

  const second = await context.newPage()
  let asked = 0
  second.on('request', (request) => {
    if (request.url().endsWith('/sync/credentials')) asked += 1
  })
  await second.goto(inHousehold.home(household))
  await expect(second.getByRole('heading', { level: 1 })).toBeVisible()
  // It waits for the lock, and opens nothing of its own meanwhile.
  await expect.poll(() => locks(second)).toEqual({ held: 1, pending: 1 })
  expect(asked).toBe(0)

  // The first tab gone, the second holds the lock, and its replica asks for its credentials.
  const takesOver = second.waitForRequest((request) => request.url().endsWith('/sync/credentials'))
  await page.close()
  await takesOver
})

/** The databases this browser keeps, by name. */
function databases(page: Page): Promise<(string | undefined)[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map(({ name }) => name))
}

test('signing out removes the household’s replica from this browser', async ({ page, enter }) => {
  const household = await enter()
  await open(page, inHousehold.home(household))
  await expect.poll(() => databases(page)).toContain(replicaDatabase(household))

  // The way out is the account's: the household is left, and its replica closed, on the way.
  await page.getByRole('link', { name: 'Your account' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  // What the browser kept of the member's households went with the session (D-156).
  await expect.poll(() => databases(page)).not.toContain(replicaDatabase(household))
})

test('a session ended from elsewhere takes the replica a page has open with it', async ({
  page,
  browser,
  enter,
}) => {
  const household = await enter()
  await open(page, inHousehold.home(household))
  await expect.poll(() => databases(page)).toContain(replicaDatabase(household))

  // Every session of the account is ended at the server, by a request whose answer this browser
  // never sees: its cookies are as they were, and say a session is here still.
  const elsewhere = await browser.newContext({ baseURL: previewOrigin })
  await elsewhere.addCookies(await page.context().cookies())
  const other = await elsewhere.newPage()
  await other.goto(buildFile)
  expect((await call(other, 'DELETE', '/me/sessions')).status).toBe(204)
  await elsewhere.close()

  // The page is looked at again, what it shows is read again, and the answer is a `401`: the
  // member signs in again, and the replica the page had open is gone with the session (D-156).
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  await expect(page.getByText('You were signed out. Sign in again to carry on.')).toBeVisible()
  await expect.poll(() => databases(page)).not.toContain(replicaDatabase(household))
})
