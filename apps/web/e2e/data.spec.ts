// A household's data, storage and sync health, and a member's own privacy centre, in a real
// browser against the API itself (plan item 27; C-54, C-56, C-57, A-31 to A-35): what each
// screen writes and whom it is drawn for, the lockout of a household the platform suspended,
// what they do with the connection away, and, as overlays.spec.ts does for the primitives,
// everything these screens open, under the two gates every route is under. Each write is held
// to what a member who cannot see the screen is given of it: where the focus is afterwards, and
// what was said.
//
// What no screen does is done beside them (stack.ts): a suspension, which is staff's; a
// household written as read-only, where the way into that state is not what a test proves
// (billing.spec.ts proves it); and what a household stores, which no module writes yet.
//
// Every test makes its own people and its own household (screens.ts), and whoever is at the
// screen changes as it does for a member: by the account's own way out.
import type { Page } from '@playwright/test'
import { previewOrigin } from '../build/preview.ts'
import { apiPath } from '../src/api/names.ts'
import { inHousehold, paths } from '../src/app/paths.ts'
import { buildFile } from '../src/update/build.ts'
import { expect, expectAccessible, frames, kept, open, test } from './fixtures.ts'
import {
  above,
  dayOf,
  expectHolds,
  expectSaid,
  expectSurvives,
  home,
  instantOf,
  money,
  openLoaded,
  owner,
  phone,
  priceOf,
  rows,
  section,
  settings,
  sidebar,
  signInAs,
  signOutHere,
  subscriptionOf,
  title,
  toasts,
  valueOf,
} from './screens.ts'
import {
  call,
  createChild,
  createHousehold,
  join,
  lapse,
  linked,
  makeOwner,
  person,
  signIn,
  signOut,
  standingOf,
  store,
  subscribeNow,
  suspend,
} from './stack.ts'

/** Whom the suite brings into a household beside its owner, named as its people are. */
const guest = 'Vít Ježek'

/** A third person of the suite's. */
const other = 'Ema Šťastná'

/** A reason an owner gives for stopping all changes: no word a translator missed (stack.ts). */
const reason = 'Účty za říjen.'

/** What the suite calls a second household of one member's. */
const flat = 'Byt č. 3'

/** What any write says that could not reach the server. */
const unreachable =
  'We couldn’t reach Household. Nothing you typed was lost. Check your connection and try again.'

/** A screen's own place, which takes the focus when the control that held it has left (D-166). */
function place(page: Page) {
  return page.getByRole('main').locator('div[tabindex="-1"]')
}

/** The day `household` is scheduled to be deleted on, as the signed-in person reads it. */
async function deletionOf(page: Page, household: string): Promise<string> {
  const { body } = await call(page, 'GET', `/households/${household}`)
  const { deletion_scheduled_at: at } = body as { readonly deletion_scheduled_at?: unknown }
  if (typeof at !== 'string') throw new Error('no deletion is scheduled')
  return at
}

test('an owner stops all changes with a reason, every member reads who, when and why, and lifting says what follows', async ({
  page,
}) => {
  test.slow()
  const { who, household } = await owner(page)
  const member = person(guest)
  await join(page, who, household, member)
  const trial = await standingOf(page, household)
  await open(page, inHousehold.data(household))
  const stopping = section(page, 'Stop all changes for now')
  await stopping.getByRole('button', { name: `Stop all changes in ${home}` }).click()

  // The question says plainly what stops and what does not, the subscription among it.
  const question = page.getByRole('dialog', { name: `Stop all changes in ${home}?` })
  await expect(question).toContainText(
    'Nobody can add, change or upload anything, an owner included.',
  )
  await expect(question).toContainText(
    'A subscription keeps running and keeps being charged: this does not cancel it.',
  )
  await question.getByLabel('Why, for the other members').fill(reason)
  await expectAccessible(page)
  await question.getByRole('button', { name: `Stop all changes in ${home}` }).click()
  await expect(question).toBeHidden()
  await expect(toasts(page)).toHaveText([
    `All changes in ${home} are stopped. Any owner can lift it.`,
  ])

  // Who, when and why, above every screen and on this one; the control that asked gave its
  // place to the one that lifts, and the focus it held is on the screen's own place.
  const restriction = (await standingOf(page, household)).restriction
  if (restriction === null) throw new Error('the household is not restricted')
  const when = instantOf(restriction.restricted_at)
  await expect(above(page)).toContainText('This household is restricted')
  // The banner arrived while its member was here, and nothing moved the focus to it: it is said.
  await expect(above(page)).toHaveRole('status')
  await expect(above(page)).toContainText(
    `An owner restricted this household on ${when}: ${who.name}.`,
  )
  await expect(above(page)).toContainText(`The reason given: ${reason}`)
  await expect(above(page).getByRole('link', { name: 'Lift the restriction' })).toBeVisible()
  await expect(page.getByRole('main')).toContainText(
    `${who.name} stopped all changes here on ${when}.`,
  )
  await expect(page.getByRole('main')).toContainText(`The reason they gave: ${reason}`)
  await expect(place(page)).toBeFocused()
  await expectAccessible(page)
  // A write is absent, for an owner too: the household's profile has no control.
  await settings(page).getByRole('link', { name: 'Household', exact: true }).click()
  await expect(title(page, 'Household')).toBeVisible()
  await expect(valueOf(page, 'Name')).toHaveText(home)
  await expect(page.getByRole('button', { name: 'Edit the household' })).toHaveCount(0)
  await settings(page).getByRole('link', { name: 'Members' }).click()
  await expect(rows(page).filter({ hasText: member.name })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Invite somebody' })).toHaveCount(0)

  // A member reads the same, with whom to ask, and is offered nothing.
  await signOutHere(page)
  await signInAs(page, member)
  await expect(title(page, 'Home')).toBeVisible()
  await expect(above(page)).toContainText(
    `An owner restricted this household on ${when}: ${who.name}.`,
  )
  await expect(above(page)).toContainText(`The reason given: ${reason}`)
  await expect(above(page)).toContainText(`Only an owner can change this: ${who.name}.`)
  await expect(above(page).getByRole('link')).toHaveCount(0)
  await expectAccessible(page)
  await page.goto(inHousehold.data(household))
  await expect(page.getByRole('main')).toContainText(
    `${who.name} stopped all changes here on ${when}.`,
  )
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  await expectAccessible(page)

  // The owner lifts it. What the household will be is said before the press, and tied to it:
  // it is in its trial, so changes come back, and the trial runs to its day.
  await signOutHere(page)
  await signInAs(page, who)
  await expect(title(page, 'Home')).toBeVisible()
  await above(page).getByRole('link', { name: 'Lift the restriction' }).click()
  await expect(title(page, 'Data')).toBeVisible()
  const lift = stopping.getByRole('button', { name: 'Lift the restriction' })
  const follows = `Lifting it brings changes back at once. The trial runs until ${dayOf(trial.trial_ends_at ?? '', 'long')}.`
  await expect(stopping).toContainText(follows)
  await expect(lift).toHaveAccessibleDescription(follows)
  await lift.click()
  await expect(toasts(page)).toHaveText([`The restriction is lifted. ${home} takes changes again.`])
  // And it is: in its trial, with nothing above its screens, and the control that restricts
  // there again in the place of the one that left with the focus.
  await expect(stopping.getByRole('button', { name: `Stop all changes in ${home}` })).toBeVisible()
  await expect(above(page)).toHaveCount(0)
  await expect(place(page)).toBeFocused()
  const lifted = await standingOf(page, household)
  expect([lifted.state, lifted.can_write, lifted.restriction]).toEqual(['trialing', true, null])
})

test('a household is deleted by its name typed, the day is said to every member, and another owner keeps it', async ({
  page,
}) => {
  test.slow()
  const { who, household } = await owner(page)
  const second = person(guest)
  await makeOwner(page, household, await join(page, who, household, second))
  const member = person(other)
  await join(page, who, household, member)
  await open(page, inHousehold.data(household))
  const deleting = section(page, 'Delete the household')
  await deleting.getByRole('button', { name: `Delete ${home}` }).click()

  // The panel says what is so before it asks, the subscription among it, and the focus is on
  // the name it asks for.
  const panel = page.getByRole('dialog', { name: `Delete ${home}?` })
  await expect(panel).toContainText('Every member is told at once, by email.')
  await expect(panel).toContainText(
    'A subscription keeps running and is charged until then. Nothing is refunded.',
  )
  const name = panel.getByLabel('The household’s name')
  await expect(name).toBeFocused()
  // Another name is refused by the server, beside the field, with the focus on it.
  await name.fill(flat)
  const confirm = panel.getByRole('button', { name: `Delete ${home} and everything in it` })
  await confirm.click()
  await expect(name).toBeFocused()
  await expect(name).toHaveAccessibleDescription(
    new RegExp(`That is not the household’s name\\. Type: ${home.replaceAll('.', '\\.')}$`),
  )
  await expect(confirm).not.toHaveAttribute('aria-busy', 'true')
  await expectAccessible(page)

  // Typed right, whatever its case and the space around it, the deletion is scheduled.
  await name.fill(` ${home.toUpperCase()} `)
  await confirm.click()
  await expect(panel).toBeHidden()
  await expect(toasts(page)).toHaveText([
    `${home} is scheduled for deletion. Every member has been told.`,
  ])
  const day = dayOf(await deletionOf(page, household), 'long')
  const notice = `${home} will be deleted on ${day}`
  await expect(page.getByRole('main')).toContainText(notice)
  await expect(deleting).toContainText(
    `The deletion is scheduled for ${day}. Any owner can still keep the household, at the top of this page.`,
  )
  await expect(deleting.getByRole('button')).toHaveCount(0)
  await expect(place(page)).toBeFocused()
  await expectAccessible(page)
  // And on the settings' first screen, which every member opens.
  await settings(page).getByRole('link', { name: 'Household', exact: true }).click()
  await expect(title(page, 'Household')).toBeVisible()
  await expect(page.getByRole('main')).toContainText(notice)
  await expect(page.getByRole('button', { name: `Keep ${home}` })).toBeVisible()
  await expectAccessible(page)

  // A member reads the day on both, with the way to what is theirs, and no control.
  await signOutHere(page)
  await signInAs(page, member)
  await expect(title(page, 'Home')).toBeVisible()
  await sidebar(page).getByRole('link', { name: 'Household settings' }).click()
  await expect(page.getByRole('main')).toContainText(notice)
  await expect(page.getByRole('link', { name: 'Export what is yours' })).toBeVisible()
  await expect(page.getByRole('button', { name: `Keep ${home}` })).toHaveCount(0)
  await expectAccessible(page)
  await settings(page).getByRole('link', { name: 'Data' }).click()
  await expect(title(page, 'Data')).toBeVisible()
  await expect(page.getByRole('main')).toContainText(notice)
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  // The household's four are its owners', who are named; a member's own data is their account's.
  await expect(page.getByRole('main')).toContainText(
    'Exporting the household, stopping its changes, making an owner and deleting it are for an owner:',
  )
  await page.goto(inHousehold.exports(household))
  await expect(title(page, 'Export the household')).toBeVisible()
  await expect(
    page.getByText(
      'An export of the whole household is for an owner. A copy of what is yours is on your account.',
    ),
  ).toBeVisible()
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  await expectAccessible(page)
  await page.getByRole('main').getByRole('link', { name: 'Your data' }).click()
  await expect(title(page, 'Your data')).toBeVisible()
  await expect(section(page, 'Stop all changes for now')).toContainText(
    'This is for a household’s owners, and you own no household. In one you are in, ask an owner.',
  )

  // Any owner keeps it, whoever scheduled it, and is asked nothing: keeping destroys nothing.
  await signOutHere(page)
  await signInAs(page, second)
  await expect(title(page, 'Home')).toBeVisible()
  await page.goto(inHousehold.data(household))
  await page.getByRole('button', { name: `Keep ${home}` }).click()
  await expect(toasts(page)).toHaveText([
    `${home} is kept. The deletion is cancelled, and every member is told.`,
  ])
  await expect(page.getByRole('main')).not.toContainText(notice)
  await expect(deleting.getByRole('button', { name: `Delete ${home}` })).toBeVisible()
  await expect(place(page)).toBeFocused()
  const { body } = await call(page, 'GET', `/households/${household}`)
  expect((body as { readonly deletion_scheduled_at?: unknown }).deletion_scheduled_at).toBeNull()
})

test('the privacy centre holds the six rights, a copy of one’s own data, the two consents and the authority to complain to', async ({
  page,
}) => {
  test.slow()
  const { who, household } = await owner(page)
  await open(page, paths.accountPrivacy.example)
  await expect(title(page, 'Your data')).toBeVisible()
  // The six rights, in plain words, each with the regulation's own term beside it.
  const rights = page.getByRole('main').getByRole('region')
  await expect(rights.getByRole('heading', { level: 2 })).toHaveText([
    'Get a copy of everything',
    'Correct something',
    'Delete your account',
    'Stop all changes for now',
    'Choose what you agree to',
    'Complain to a regulator',
  ])
  for (const [right, term] of [
    ['Get a copy of everything', 'Access and portability'],
    ['Correct something', 'Rectification'],
    ['Delete your account', 'Erasure'],
    ['Stop all changes for now', 'Restriction of processing'],
    ['Choose what you agree to', 'Objection'],
    ['Complain to a regulator', 'Complaint'],
  ] as const) {
    await expect(section(page, right)).toContainText(term)
  }
  await expectAccessible(page)
  // Each has its one way: the account, its deletion, and the data of a household they own.
  await expect(
    section(page, 'Correct something').getByRole('link', { name: 'Your account' }),
  ).toHaveAttribute('href', paths.account.path)
  await expect(
    section(page, 'Delete your account').getByRole('link', { name: 'Delete your account' }),
  ).toHaveAttribute('href', paths.accountDelete.path)
  await expect(
    section(page, 'Stop all changes for now').getByRole('link', {
      name: `Open the data of ${home}`,
    }),
  ).toHaveAttribute('href', inHousehold.data(household))

  // A copy of their own: asked for, waiting, and then ready. The list's read is held back for
  // as long as the test says, the worker beginning at once.
  const copy = section(page, 'Get a copy of everything')
  await expect(copy.getByText('No export yet.', { exact: false })).toBeVisible()
  let made: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    made = resolve
  })
  await page.route(`**${apiPath}/me/exports`, async (route) => {
    if (route.request().method() === 'GET') await held
    await route.continue()
  })
  await copy.getByRole('button', { name: 'Export my data' }).click()
  await expectSaid(page, 'The export was asked for. It is usually ready within a day.')
  const exported = copy.getByRole('listitem').filter({ hasText: 'Asked for on' })
  await expect(exported).toContainText('Waiting to be made')
  await expect(copy.getByRole('button', { name: 'Export my data' })).toHaveCount(0)
  // The control that asked left with the focus it held: it is on the list's own place.
  await expect(copy.locator('div[tabindex="-1"]')).toBeFocused()
  // An account with a verified address is told an email will come.
  await expect(copy).toContainText('We email you when it is')
  await expectAccessible(page)
  made()
  await expectSaid(page, 'The export is ready to download.')
  await expect(exported).toContainText('Ready')
  await exported.getByText('What is in it').click()
  await expect(exported).toContainText('What your account keeps outside any household')
  await expectAccessible(page)
  // The email that says so opens this address.
  expect(await linked(who.email, paths.accountPrivacy.path)).toBe(paths.accountPrivacy.path)
  const downloading = page.waitForEvent('download')
  await exported.getByRole('button', { name: /^Download the export asked for on / }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^household-account-export-\d{4}-\d{2}-\d{2}\.zip$/)
  await expectSaid(page, 'Your browser is downloading the export.')
  await download.cancel()

  // The two consents: off until turned on, each saved as it is changed, and both sent each time.
  const sent: unknown[] = []
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith(`${apiPath}/me/consents`)) {
      sent.push(request.postDataJSON())
    }
  })
  const statistics = page.getByRole('switch', { name: 'Allow usage statistics' })
  const news = page.getByRole('switch', { name: 'Email me news about Household' })
  await expect(statistics).not.toBeChecked()
  await expect(news).not.toBeChecked()
  await expect(statistics).toHaveAccessibleDescription(/Never anything you typed/)
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' && response.url().endsWith(`${apiPath}/me/consents`),
  )
  await statistics.check()
  expect((await saved).status()).toBe(200)
  await expect(statistics).toBeChecked()
  await expect(statistics).toBeFocused()
  expect(sent).toEqual([{ analytics: true, marketing_email: false }])
  // Still there after a reload: it was the server that kept it.
  await page.reload()
  await expect(statistics).toBeChecked()
  await expect(news).not.toBeChecked()
  const savedAgain = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' && response.url().endsWith(`${apiPath}/me/consents`),
  )
  await news.check()
  expect((await savedAgain).status()).toBe(200)
  expect(sent.at(-1)).toEqual({ analytics: true, marketing_email: true })
  await page.reload()
  await expect(statistics).toBeChecked()
  await expect(news).toBeChecked()

  // The authority of the household's country, by name, its own site in a new tab, which is
  // said: the link is not followed.
  const complain = section(page, 'Complain to a regulator')
  await expect(complain).toContainText('Czechia')
  const authority = complain.getByRole('link', { name: 'Office for Personal Data Protection' })
  await expect(authority).toHaveAttribute('href', /^https:\/\/uoou\.gov\.cz\//)
  await expect(authority).toHaveAttribute('target', '_blank')
  await expect(authority).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(authority).toHaveAccessibleDescription(
    'Opens the authority’s own site in a new tab. It is not part of Household.',
  )
  await expectAccessible(page)
})

test('a household that stores nothing is taught what is counted, to its owner with the plan’s figures and to a member with none', async ({
  page,
}) => {
  const { who, household } = await owner(page)
  const member = person(guest)
  await join(page, who, household, member)
  const plan = await subscriptionOf(page, household)
  await open(page, inHousehold.settings(household))
  await settings(page).getByRole('link', { name: 'Storage' }).click()
  await expect(title(page, 'Storage')).toBeVisible()
  await expect(page.getByText('Nothing is stored yet.')).toBeVisible()
  await expect(
    page.getByText('A photo added to a chat, with the thumbnail made from it.'),
  ).toBeVisible()
  const counted = section(page, 'How storage is counted')
  await expect(counted).toContainText(
    'Every file a member adds counts, and so do the previews and thumbnails made from it.',
  )
  // To an owner, with what a block costs: the plan's own figure.
  const price = money(plan.price_per_storage_block)
  await expect(counted).toContainText(`at ${price} a month each`)
  await expectAccessible(page)

  // A member who holds *Can see* on household settings reads the picture, and no money.
  await signOutHere(page)
  await signInAs(page, member)
  await expect(title(page, 'Home')).toBeVisible()
  await sidebar(page).getByRole('link', { name: 'Household settings' }).click()
  await settings(page).getByRole('link', { name: 'Storage' }).click()
  await expect(title(page, 'Storage')).toBeVisible()
  await expect(page.getByText('Nothing is stored yet.')).toBeVisible()
  await expect(counted).toContainText('Every file a member adds counts')
  await expect(page.getByRole('main')).not.toContainText(price)
  await expect(page.getByRole('main')).not.toContainText(plan.price_per_storage_block.currency)
  await expectAccessible(page)
})

test('storage is no part of the app of a member who holds nothing on household settings', async ({
  page,
}) => {
  const { who, household } = await owner(page)
  const member = person(guest)
  await join(page, who, household, member, { admin: 'none' })
  await signOutHere(page)
  await signInAs(page, member)
  await expect(title(page, 'Home')).toBeVisible()
  let asked = 0
  page.on('request', (request) => {
    if (request.url().endsWith(`/households/${household}/storage`)) asked += 1
  })
  await sidebar(page).getByRole('link', { name: 'Household settings' }).click()
  await expect(settings(page).getByRole('link', { name: 'Data' })).toBeVisible()
  await expect(settings(page).getByRole('link', { name: 'Storage' })).toHaveCount(0)
  await page.goto(inHousehold.storage(household))
  await expect(title(page, 'This link doesn’t open anything here.')).toBeVisible()
  await expectAccessible(page)
  expect(asked).toBe(0)
})

/** A thousand million bytes: the unit storage is sold in. */
const gigabyte = 1_000_000_000

/**
 * A household that stores three files of two members in two modules, measured on each of the
 * last twenty days: no module writes a file yet, so the rows are written beside the screens
 * (stack.ts). Its owner is signed in to the page's browser, which has drawn nothing yet.
 */
async function storing(page: Page) {
  const made = await owner(page)
  const member = person(guest)
  const memberId = await join(page, made.who, made.household, member)
  await store(
    made.household,
    [
      {
        module: 'documents',
        name: 'Účet č. 12.pdf',
        owner: made.user,
        bytes: 9 * gigabyte,
        thumbnail: gigabyte / 2,
      },
      { module: 'chat', name: 'Dům 2026.mp4', owner: memberId, bytes: 6 * gigabyte, thumbnail: 0 },
      {
        module: 'documents',
        name: 'Byt č. 3.zip',
        owner: memberId,
        bytes: 1.5 * gigabyte,
        thumbnail: 0,
      },
    ],
    20,
  )
  return { ...made, member }
}

for (const theme of ['light', 'dark'] as const) {
  test(`what a household stores is drawn in the ${theme} theme: the total, the month, the trend, by module and by member, and the largest items`, async ({
    page,
  }) => {
    const { who, household, member } = await storing(page)
    const plan = await subscriptionOf(page, household)
    await open(page, inHousehold.storage(household), { theme })
    const now = section(page, 'Right now')
    await expect(valueOf(now, 'Stored')).toHaveText('17 GB')
    // The month as it will be billed is an owner's to read: two blocks, at the plan's price.
    const month = section(page, 'This month')
    await expect(valueOf(month, 'Blocks that will be billed')).toHaveText('2 blocks')
    await expect(valueOf(month, 'Projected charge for storage')).toHaveText(
      money({
        amount_minor: 2 * plan.price_per_storage_block.amount_minor,
        currency: plan.price_per_storage_block.currency,
      }),
    )
    // The trend says in words what its drawing shows.
    await expect(section(page, 'Day by day')).toContainText('over 20 measured days.')
    const modules = section(page, 'By module').getByRole('listitem')
    await expect(modules).toHaveCount(2)
    await expect(modules.first()).toContainText('Documents')
    await expect(modules.last()).toContainText('Chat')
    await expect(section(page, 'By module')).toContainText(
      '500 MB is previews and thumbnails made from the files.',
    )
    const members = section(page, 'By member').getByRole('listitem')
    await expect(members).toHaveCount(2)
    await expect(members.first()).toContainText(who.name)
    await expect(members.last()).toContainText(member.name)
    const largest = section(page, 'The largest items').getByRole('listitem')
    await expect(largest).toHaveCount(3)
    await expect(largest.first()).toContainText('Účet č. 12.pdf')
    await expect(largest.first()).toContainText('Removing it would free 9.5 GB')
    await expectAccessible(page)
  })
}

test('a member who holds Can see reads what the household stores, and nothing of what it costs', async ({
  page,
}) => {
  const { household, member } = await storing(page)
  const plan = await subscriptionOf(page, household)
  await signOut(page)
  await signIn(page, member)
  let asked = 0
  page.on('request', (request) => {
    if (request.url().includes(`/households/${household}/billing/`)) asked += 1
  })
  await open(page, inHousehold.storage(household))
  await expect(valueOf(section(page, 'Right now'), 'Stored')).toHaveText('17 GB')
  // The blocks in effect are every member's to read, off the household's own row.
  await expect(valueOf(section(page, 'Right now'), 'Blocks in effect')).toHaveText(/^\d+ blocks?$/)
  await expect(section(page, 'The largest items').getByRole('listitem')).toHaveCount(3)
  // The month as it will be billed is an owner's: no such section, no price, and nothing asked.
  await expect(section(page, 'This month')).toHaveCount(0)
  await expect(page.getByRole('main')).not.toContainText(plan.price_per_storage_block.currency)
  expect(asked).toBe(0)
  await expectAccessible(page)
})

test('what a household stores holds at a phone’s width and 200 % text', async ({ page }) => {
  const { household } = await storing(page)
  await page.setViewportSize(phone)
  await open(page, inHousehold.storage(household), { scale: '200' })
  await expect(section(page, 'The largest items').getByRole('listitem')).toHaveCount(3)
  await expectHolds(page)
})

test('this browser is listed once it has reported, is asked to download the household again, and says so', async ({
  page,
}) => {
  test.slow()
  const { household } = await owner(page)
  await open(page, inHousehold.settings(household))
  await settings(page).getByRole('link', { name: 'Sync health' }).click()
  await expect(title(page, 'Sync health')).toBeVisible()
  // The screen has this browser report as it opens: its row is marked, and says when it last
  // reported, with nothing queued and other members' changes arriving.
  const list = page.getByRole('list', { name: 'Your browsers and devices' })
  const own = list.getByRole('listitem').filter({ hasText: 'This browser' })
  await expect(own).toHaveCount(1)
  await expect(own).toContainText(/Last reported .+\./)
  await expect(own).toContainText('In sync')
  await expect(own).not.toContainText('waiting to be sent')
  await expect(own).not.toContainText('aren’t arriving')
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(
    page.getByText('This browser is shown as it is now.', { exact: false }),
  ).toBeVisible()
  await expectAccessible(page)

  // Downloading again is asked, with what it does and that nothing waiting is lost.
  const name = (await own.locator('span').first().innerText()).trim()
  await own.getByRole('button', { name: `Download again on ${name}` }).click()
  const question = page.getByRole('dialog', { name: `Download the household again on ${name}?` })
  await expect(question).toContainText(
    'This browser first sends everything it has waiting, so nothing is lost.',
  )
  await expect(question.getByRole('button', { name: 'Leave it as it is' })).toBeVisible()
  await expectAccessible(page)
  let asked: unknown
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/sync/reset')) {
      asked = request.postDataJSON()
    }
  })
  await question.getByRole('button', { name: `Download again on ${name}` }).click()
  await expect(question).toBeHidden()
  await expect(toasts(page)).toHaveText([
    `${name} downloads the household again after its next report. Nothing waiting on it is lost.`,
  ])
  expect(asked).toEqual({ replica_id: expect.stringMatching(/^[0-9a-f-]{36}$/) })
  // The row says so, its control is gone, and the focus that control held is on the list's place.
  await expect(own).toContainText('Downloading again')
  await expect(own.getByRole('button')).toHaveCount(0)
  await expect(place(page)).toBeFocused()
  await expectAccessible(page)
})

// The report this browser sends as the screen opens waits for the first checkpoint of the visit.
// Sent as the replica's stream came up, it was of the copy as the visit before left it, which the
// server read as a copy that does not match: a false alarm, with *Download again* beside it, for
// whoever opened the screen at its address after anything in the household had changed.
test('sync health opened at its address after the household changed elsewhere says this browser is in sync', async ({
  page,
}) => {
  test.slow()
  const { household } = await owner(page)
  await open(page, inHousehold.syncHealth(household))
  const list = page.getByRole('list', { name: 'Your browsers and devices' })
  const own = list.getByRole('listitem').filter({ hasText: 'This browser' })
  const checkpoint = async () => {
    await expect(own).toContainText(/Last checkpoint: \S+\./)
    return /Last checkpoint: (\S+)\./.exec(await own.innerText())?.[1]
  }
  let before = await checkpoint()
  await expect(own).toContainText('In sync')
  for (const child of ['Ádík', 'Bětka']) {
    // The app is left, its replica closed with it, and the household changes meanwhile.
    await page.goto(buildFile)
    await createChild(page, household, child)
    await open(page, inHousehold.syncHealth(household))
    // This visit's report is in: it names a later checkpoint than the visit before did.
    await expect.poll(checkpoint).not.toBe(before)
    before = await checkpoint()
    await expect(own).toContainText('In sync')
    await expect(own).not.toContainText('Doesn’t match the server')
    await expect(own.getByRole('button', { name: /^Download again on / })).toBeVisible()
  }
})

test('in a read-only household no browser is asked to download again, and the list says why', async ({
  page,
}) => {
  const { household } = await owner(page)
  await open(page, inHousehold.syncHealth(household))
  const own = page.getByRole('listitem').filter({ hasText: 'This browser' })
  await expect(own).toContainText(/Last reported .+\./)
  await expect(own.getByRole('button', { name: /^Download again on / })).toBeVisible()

  await lapse(household)
  await page.reload()
  await expect(own).toContainText(/Last reported .+\./)
  await expect(
    page.getByText(
      'This household can’t be changed right now, and while that is so no browser or device reports on it.',
      { exact: false },
    ),
  ).toBeVisible()
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  await expectAccessible(page)
})

test('the diagnostic bundle is drawn whole, a part taken out is gone from what is sent, and sending says its reference', async ({
  page,
}) => {
  const { user, household } = await owner(page)
  await open(page, inHousehold.syncHealth(household))
  await expect(page.getByRole('listitem').filter({ hasText: 'This browser' })).toContainText(
    /Last reported .+\./,
  )
  await page.getByRole('link', { name: 'Send diagnostics' }).click()
  await expect(title(page, 'Send diagnostics')).toBeVisible()
  await expect(
    page.getByText('This is what would be sent. Nothing leaves until you send it.'),
  ).toBeVisible()

  // Everything that would be sent is on the page: what it is about, each part, and the text
  // itself, exactly as it leaves.
  const always = section(page, 'Always sent')
  await expect(valueOf(always, 'The page this is about')).toHaveText(
    inHousehold.syncHealth(household),
  )
  await expect(valueOf(always, 'This household')).toHaveText(household)
  const parts = page.getByRole('list', { name: 'What else is in it' }).getByRole('listitem')
  await expect(parts.getByRole('checkbox')).toHaveCount(6)
  for (const part of await parts.getByRole('checkbox').all()) await expect(part).toBeChecked()
  const exact = section(page, 'Exactly what is sent').locator('pre')
  const whole = JSON.parse(await exact.innerText()) as {
    readonly payload: Readonly<Record<string, unknown>>
    readonly redacted_fields: readonly string[]
  }
  expect(Object.keys(whole.payload)).toEqual([
    'client',
    'locale',
    'ids',
    'sync',
    'report',
    'outcomes',
  ])
  expect(whole.redacted_fields).toEqual([])
  expect(whole.payload.ids).toMatchObject({ member: user, household })
  await expectAccessible(page)

  // A part taken out is not sent at all: only its name goes, to say that it was left out.
  const ids = parts.filter({ hasText: 'Send the ids' })
  await ids.getByRole('checkbox', { name: 'Send the ids' }).uncheck()
  await expect(ids).toContainText('Left out. This part is not sent.')
  await expect(exact).not.toContainText(user)
  await expectAccessible(page)
  let sent: unknown
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith(`${apiPath}/me/diagnostics`)) {
      sent = request.postDataJSON()
    }
  })
  const drawn = JSON.parse(await exact.innerText()) as { readonly id: string }
  await page.getByRole('button', { name: 'Send diagnostics' }).click()

  // Sent, which is said as it arrives, in a toast, with the reference to quote, wherever its
  // member is by then; the screen reads it in its place. And what left is what the page drew,
  // the part that was taken out absent from it.
  await expectSaid(page, `The bundle was sent. Its reference is ${drawn.id}.`)
  const said = page.getByRole('main')
  await expect(said).toContainText(
    `Its reference is ${drawn.id}. Quote it when you report the problem.`,
  )
  await expect(said).toContainText(
    /It is kept until .+ and then deleted\. It can’t be read back here\./,
  )
  expect(sent).toEqual(drawn)
  const body = sent as {
    readonly screen: string
    readonly household_id: string
    readonly payload: Readonly<Record<string, unknown>>
    readonly redacted_fields: readonly string[]
  }
  expect(Object.keys(body.payload)).toEqual(['client', 'locale', 'sync', 'report', 'outcomes'])
  expect(body.redacted_fields).toEqual(['ids'])
  expect(JSON.stringify(body.payload)).not.toContain(user)
  expect([body.screen, body.household_id]).toEqual([inHousehold.syncHealth(household), household])
  // The form left with the press that sent it: the focus is where the screen says it was sent.
  await expect(page.getByRole('button', { name: 'Send diagnostics' })).toHaveCount(0)
  await expect(place(page)).toBeFocused()
  await expectAccessible(page)
})

test('an owner reads the apps that synced the household with their versions, and a member has no such screen', async ({
  page,
}) => {
  const { who, household } = await owner(page)
  const member = person(guest)
  await join(page, who, household, member)
  // This browser is listed once it has reported, which sync health has it do as it opens.
  await open(page, inHousehold.syncHealth(household))
  await expect(page.getByRole('listitem').filter({ hasText: 'This browser' })).toContainText(
    /Last reported .+\./,
  )
  await settings(page).getByRole('link', { name: 'Apps and versions' }).click()
  await expect(title(page, 'Apps and versions')).toBeVisible()
  const listed = page.getByRole('list', { name: 'Apps and versions' }).getByRole('listitem')
  await expect(listed).toHaveCount(1)
  await expect(listed).toContainText('This browser')
  await expect(listed).toContainText(who.name)
  // The version it named itself by: the app's, with the build it is of.
  await expect(listed).toContainText(/Version \d+\.\d+\.\d+\+\S+/)
  await expect(listed).toContainText(/Last reported .+\./)
  await expect(page.getByRole('link', { name: 'Open Sync health' })).toHaveAttribute(
    'href',
    inHousehold.syncHealth(household),
  )
  await expectAccessible(page)

  // A member: no way in among the settings, nothing asked of the server at its address.
  await signOutHere(page)
  await signInAs(page, member)
  await expect(title(page, 'Home')).toBeVisible()
  let asked = 0
  page.on('request', (request) => {
    if (request.url().endsWith(`/households/${household}/clients`)) asked += 1
  })
  await sidebar(page).getByRole('link', { name: 'Household settings' }).click()
  await expect(settings(page).getByRole('link', { name: 'Sync health' })).toBeVisible()
  await expect(settings(page).getByRole('link', { name: 'Apps and versions' })).toHaveCount(0)
  await page.goto(inHousehold.clients(household))
  await expect(title(page, 'This link doesn’t open anything here.')).toBeVisible()
  expect(asked).toBe(0)
})

/** What its members are told of why a household of the suite's is suspended. */
const notice = 'Účty za říjen 2026.'

test('a suspended household opens the lockout with the notice itself and no export, and leads to the member’s other household', async ({
  page,
}) => {
  const { household } = await owner(page)
  const elsewhere = await createHousehold(page, flat)
  await suspend(household, notice)
  await open(page, inHousehold.home(household))

  // Nothing of the household is drawn: its name, the day, what its owners were told, and that
  // nothing was deleted and nothing can be exported, which is said and is no control.
  await expect(title(page, `${home} is suspended`)).toBeVisible()
  await expect(page.getByText(/^Household suspended it on .+\.$/)).toBeVisible()
  const main = page.getByRole('main')
  await expect(main).toContainText('What its owners were told')
  await expect(main).toContainText(notice)
  await expect(main).toContainText(
    'Nothing in it was deleted. While it is suspended, nobody can open it and nothing can be exported.',
  )
  await expect(main).toContainText('Each owner was told by email.')
  await expect(main.getByRole('link')).toHaveText([`Go to ${flat}`])
  await expect(main.getByRole('button')).toHaveText(['Sign out'])
  await expect(sidebar(page)).toHaveCount(0)
  await expect(above(page)).toHaveCount(0)
  await expectAccessible(page)
  // Every address of it opens the same: its settings, and where an export would be asked for.
  await page.goto(inHousehold.exports(household))
  await expect(title(page, `${home} is suspended`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Make an export' })).toHaveCount(0)

  // The way on is the member's other household, which opens as theirs.
  await page.getByRole('link', { name: `Go to ${flat}` }).click()
  await expect(title(page, 'Home')).toBeVisible()
  await expect(page).toHaveURL(inHousehold.home(elsewhere))
  await expect(sidebar(page)).toContainText(flat)
  // And the app opens there, not at the one that opens nothing.
  await page.goto(paths.home.path)
  await expect(page).toHaveURL(inHousehold.home(elsewhere))
})

test('the app opens at the lockout for a member whose only household is suspended, with the way out', async ({
  page,
}) => {
  const { household } = await owner(page)
  await suspend(household, notice)
  await open(page, paths.home.example)
  await expect(title(page, `${home} is suspended`)).toBeVisible()
  await expect(page).toHaveURL(inHousehold.home(household))
  const main = page.getByRole('main')
  await expect(main).toContainText(notice)
  // No other household to go to: the one way on is out.
  await expect(main.getByRole('link')).toHaveCount(0)
  await expectAccessible(page)
  await main.getByRole('button', { name: 'Sign out' }).click()
  await expect(title(page, 'Sign in')).toBeVisible()
})

/**
 * Whether a fault is the connection's being away, as the browser says each request that found
 * none and the replica's SDK each attempt of its own: a test that takes the connection away has
 * those, and they are its own doing.
 */
function ofNoConnection(fault: string): boolean {
  return /ERR_INTERNET_DISCONNECTED|^\[PowerSync\]: Sync error/.test(fault)
}

/** Counts the requests of `method` whose address ends in `path`, sent or tried, from here on. */
function counting(page: Page, method: string, path: string): () => number {
  let asked = 0
  page.on('request', (request) => {
    if (request.method() === method && request.url().endsWith(path)) asked += 1
  })
  return () => asked
}

// None of these screens holds a change on the device to send later (D-170): a member may not
// come to believe they subscribed, restricted, consented or asked for an export with no
// connection. One write of each group of screens, each asked at once and sent by nothing after.
test('subscribing asked for with no connection says so at once, and nothing is sent once the connection is back', async ({
  page,
  context,
  faults,
}) => {
  const { household } = await owner(page)
  const plan = await subscriptionOf(page, household)
  await openLoaded(page, inHousehold.subscribe(household))
  await page.getByRole('radio', { name: `${money(priceOf(plan, 'year'))} a year` }).check()
  const asked = counting(page, 'POST', `/households/${household}/billing/subscription`)
  await context.setOffline(true)
  const press = page.getByRole('button', { name: 'Continue to payment' })
  await press.click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText(unreachable)
  await expect(press).not.toHaveAttribute('aria-busy', 'true')
  await expect(press).toBeFocused()
  await expect(page.getByRole('group', { name: 'Payment details' })).toHaveCount(0)
  await expectAccessible(page)

  const before = asked()
  await context.setOffline(false)
  await frames(page, 10)
  expect(asked()).toBe(before)
  const still = await subscriptionOf(page, household)
  expect([still.state, still.interval, still.payment_pending]).toEqual(['trialing', null, false])
  expect(faults.filter((fault) => !ofNoConnection(fault))).toEqual([])
  faults.length = 0
})

test('a restriction asked for with no connection says so in its question, and nothing is sent once the connection is back', async ({
  page,
  context,
  faults,
}) => {
  const { household } = await owner(page)
  await openLoaded(page, inHousehold.data(household))
  await page.getByRole('button', { name: `Stop all changes in ${home}` }).click()
  const question = page.getByRole('dialog', { name: `Stop all changes in ${home}?` })
  await question.getByLabel('Why, for the other members').fill(reason)
  const asked = counting(page, 'POST', `/households/${household}/restriction`)
  await context.setOffline(true)
  const press = question.getByRole('button', { name: `Stop all changes in ${home}` })
  await press.click()
  // The question stays, with what was typed, and its control is theirs again.
  await expect(question.getByRole('alert')).toContainText(unreachable)
  await expect(press).not.toHaveAttribute('aria-busy', 'true')
  await expect(question.getByLabel('Why, for the other members')).toHaveValue(reason)
  await expectAccessible(page)

  const before = asked()
  await context.setOffline(false)
  await frames(page, 10)
  expect(asked()).toBe(before)
  expect((await standingOf(page, household)).restriction).toBeNull()
  expect(faults.filter((fault) => !ofNoConnection(fault))).toEqual([])
  faults.length = 0
})

test('a consent changed with no connection is put back and said not to be saved, and nothing is sent once the connection is back', async ({
  page,
  context,
  faults,
}) => {
  await owner(page)
  await open(page, paths.accountPrivacy.example)
  const statistics = page.getByRole('switch', { name: 'Allow usage statistics' })
  await expect(statistics).not.toBeChecked()
  const asked = counting(page, 'PUT', `${apiPath}/me/consents`)
  await context.setOffline(true)
  await statistics.click()
  // What the screen shows is what the server holds: the switch is as it was, and the section
  // says why.
  const choices = section(page, 'Choose what you agree to')
  await expect(choices).toContainText('Not saved')
  await expect(choices).toContainText(unreachable)
  await expect(statistics).not.toBeChecked()
  await expectAccessible(page)

  const before = asked()
  await context.setOffline(false)
  await frames(page, 10)
  expect(asked()).toBe(before)
  const { body } = await call(page, 'GET', '/me/consents')
  expect(body).toMatchObject({ analytics: false, marketing_email: false })
  expect(faults.filter((fault) => !ofNoConnection(fault))).toEqual([])
  faults.length = 0
})

test('an export asked for with no connection says so at once, and nothing is sent once the connection is back', async ({
  page,
  context,
  faults,
}) => {
  const { household } = await owner(page)
  await openLoaded(page, inHousehold.exports(household))
  const press = page.getByRole('button', { name: 'Make an export' })
  await expect(press).toBeVisible()
  const asked = counting(page, 'POST', `/households/${household}/exports`)
  await context.setOffline(true)
  await press.click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText(unreachable)
  await expect(press).not.toHaveAttribute('aria-busy', 'true')
  await expect(press).toBeFocused()
  await expectAccessible(page)

  const before = asked()
  await context.setOffline(false)
  await frames(page, 10)
  expect(asked()).toBe(before)
  const { body } = await call(page, 'GET', `/households/${household}/exports`)
  expect((body as { readonly items: readonly unknown[] }).items).toEqual([])
  expect(faults.filter((fault) => !ofNoConnection(fault))).toEqual([])
  faults.length = 0
})

// A second visit, which a browser that kept nothing never makes (ADR 0026): what was read of
// billing and of the household is in what this browser kept, and the connection is not there
// to read it again.
test('a second visit with no connection draws billing, the household’s data and the rest of its settings from what this browser kept', async ({
  page,
  context,
  faults,
}) => {
  const { who, household } = await owner(page)
  await subscribeNow(page, household, 'year')
  const plan = await subscriptionOf(page, household)
  await openLoaded(page, inHousehold.billing(household))
  const subscription = section(page, 'Subscription')
  await expect(subscription).toContainText('Active')
  await expect(section(page, 'Invoices').getByRole('listitem').first()).toContainText('Paid')
  await expect
    .poll(() => kept(page))
    .toContain(JSON.stringify(['households', household, 'billing', 'subscription']))
  // Each of the other screens is read once too: storage, sync health, where this browser
  // reports, and the apps, where it is then listed.
  await settings(page).getByRole('link', { name: 'Storage' }).click()
  await expect(page.getByText('Nothing is stored yet.')).toBeVisible()
  await settings(page).getByRole('link', { name: 'Sync health' }).click()
  const own = page.getByRole('main').getByRole('listitem').filter({ hasText: 'This browser' })
  await expect(own).toContainText(/Last reported .+\./)
  await settings(page).getByRole('link', { name: 'Apps and versions' }).click()
  await expect(own).toContainText(/Version \d/)
  // Kept, the apps last, and so with them what sync health read once this browser had reported.
  await expect
    .poll(() => kept(page))
    .toContain(JSON.stringify(['households', household, 'clients']))
  await settings(page).getByRole('link', { name: 'Data' }).click()
  await expect(title(page, 'Data')).toBeVisible()

  // The connection goes, and the page is opened again. The app's own files are given as a
  // browser that kept them gives them, by a request the suite makes itself: what is away is
  // everything else, the API and the sync service.
  await context.route(
    (address) => address.origin === previewOrigin && !address.pathname.startsWith(`${apiPath}/`),
    async (route) => {
      await route.fulfill({ response: await route.fetch() })
    },
  )
  await context.setOffline(true)
  await page.reload()

  // The household's data, as an owner reads it, with every control it had: each would say that
  // it could not reach the server.
  await expect(title(page, 'Data')).toBeVisible()
  await expect(page.getByRole('button', { name: `Stop all changes in ${home}` })).toBeVisible()
  await expect(page.getByRole('button', { name: `Delete ${home}` })).toBeVisible()
  const bar = page.getByRole('status').filter({ hasText: 'Offline' })
  await expect(bar).toHaveText(
    'Offline — you are reading what this browser kept. Changing anything here needs a connection.',
  )
  await expectAccessible(page)

  // And billing: the state, the plan, who pays, the method and the invoice, as they were read.
  await settings(page).getByRole('link', { name: 'Billing' }).click()
  await expect(title(page, 'Billing')).toBeVisible()
  await expect(subscription).toContainText('Active')
  await expect(valueOf(subscription, 'Plan')).toHaveText(`${money(priceOf(plan, 'year'))} a year`)
  await expect(valueOf(subscription, 'Paid by')).toHaveText(`${who.name} (you)`)
  await expect(section(page, 'Payment method')).toContainText('Visa ending in 4242')
  await expect(section(page, 'Invoices').getByRole('listitem').first()).toContainText('Paid')
  await expect(page.getByText('Billing could not be read')).toHaveCount(0)
  await expectAccessible(page)

  // Storage, as it was read; sync health, where this browser says for itself that it has no
  // connection, beside what it last reported; and the apps, this browser among them.
  await settings(page).getByRole('link', { name: 'Storage' }).click()
  await expect(page.getByText('Nothing is stored yet.')).toBeVisible()
  await expect(page.getByText('The storage figures did not load')).toHaveCount(0)
  await settings(page).getByRole('link', { name: 'Sync health' }).click()
  await expect(own).toContainText('Offline')
  await expect(own).toContainText(
    'This browser has no connection, so nothing arrives and nothing is sent until it is back.',
  )
  await expect(own).toContainText(/Last reported .+\./)
  await expectAccessible(page)
  await settings(page).getByRole('link', { name: 'Apps and versions' }).click()
  await expect(own).toContainText(/Version \d/)
  await expect(page.getByText('The list of apps did not load')).toHaveCount(0)
  await expectAccessible(page)
  expect(faults.filter((fault) => !ofNoConnection(fault))).toEqual([])
  faults.length = 0
})

/**
 * Opens each thing these screens open, and hands the page to `look` as it stands with each: the
 * restriction's question, the household restricted and the control that lifts it, the toast of
 * its lifting, the panel that deletes with its name refused, the notice of a deletion, an
 * export waiting and ready with what is in it, the question that downloads a browser's copy
 * again, and the bundle with a part taken out and then sent.
 *
 * A control is found by where it stands and never by its words, which the pseudo-locale changes.
 */
async function openEach(page: Page, household: string, look: () => Promise<void>): Promise<void> {
  const main = page.getByRole('main')
  const dialog = page.getByRole('dialog')
  // The data screen's sections, in the order it draws them (privacy/Data.tsx): the copy, the
  // restriction, making an owner, the deletion.
  const sections = main.locator('section')
  await expect(sections).toHaveCount(4)

  await sections.nth(1).getByRole('button').click()
  await dialog.locator('textarea').fill(reason)
  await look()
  await dialog.locator('button[type="submit"]').click()
  await expect(dialog).toBeHidden()
  await expect(toasts(page)).toHaveCount(1)
  // Restricted: the banner above the screen, the notice on it, and what lifting comes to.
  await look()
  await sections.nth(1).getByRole('button').click()
  await expect(toasts(page)).toHaveCount(2)
  await expect(above(page)).toHaveCount(0)
  await look()

  // The panel that deletes, asked with no name, and then with the household's. A toast is
  // drawn inside the panel that is open, with a control of its own: the panel's is its form's.
  await sections.nth(3).getByRole('button').click()
  await dialog.locator('button[type="submit"]').click()
  await expect(dialog.locator('input')).toBeFocused()
  await look()
  await dialog.locator('input').fill(home)
  await dialog.locator('button[type="submit"]').click()
  await expect(dialog).toBeHidden()
  await expect(sections.nth(3).getByRole('button')).toHaveCount(0)
  await look()
  // Kept again: the notice's one button.
  await main.getByRole('button').first().click()
  await expect(sections.nth(3).getByRole('button')).toHaveCount(1)

  // An export: none yet, then waiting, the list's read held back, and then ready.
  await page.goto(inHousehold.exports(household))
  await expect(main.getByRole('button')).toHaveCount(1)
  await look()
  let made: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    made = resolve
  })
  await page.route(`**/households/${household}/exports`, async (route) => {
    if (route.request().method() === 'GET') await held
    await route.continue()
  })
  await main.getByRole('button').click()
  // The one row of the list of exports: the settings' navigation is a list too.
  await expect(main.locator('li:not(nav li)')).toHaveCount(1)
  await look()
  made()
  await expect(main.locator('summary')).toBeVisible()
  await main.locator('summary').click()
  await look()

  // Sync health: this browser's row, and the question its one control asks.
  await page.goto(inHousehold.syncHealth(household))
  await main.getByRole('listitem').getByRole('button').click()
  await expect(dialog).toBeVisible()
  await look()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // The bundle, a part taken out, and then sent.
  await page.goto(inHousehold.diagnostics(household))
  await expect(main.getByRole('checkbox')).toHaveCount(6)
  await main.getByRole('checkbox').nth(2).uncheck()
  await look()
  await main.locator('button[type="submit"]').click()
  await expect(main.locator('form')).toHaveCount(0)
  await look()
}

for (const theme of ['light', 'dark'] as const) {
  test(`what the screens of a household’s data and its sync health open is accessible in the ${theme} theme`, async ({
    page,
  }) => {
    // Fourteen passes of axe, one for each thing opened.
    test.slow()
    const { household } = await owner(page)
    await open(page, inHousehold.data(household), { theme })
    await openEach(page, household, () => expectAccessible(page))
  })
}

test('what the screens of a household’s data and its sync health open survives the pseudo-locale', async ({
  page,
}) => {
  test.slow()
  const { household } = await owner(page)
  await open(page, inHousehold.data(household), { locale: 'en-XA' })
  await expect(page.getByRole('main')).toContainText('⟦')
  await openEach(page, household, () => expectSurvives(page))
})

test('what the screens of a household’s data and its sync health open holds at a phone’s width and 200 % text', async ({
  page,
}) => {
  test.slow()
  const { household } = await owner(page)
  await page.setViewportSize(phone)
  await open(page, inHousehold.data(household), { scale: '200' })
  await openEach(page, household, () => expectHolds(page))
})

/**
 * Opens the screens that draw what the server gives as data and no word of a catalog's, and
 * hands the page to `look` as it stands with each: the apps that synced the household, by the
 * version each named itself with; what the household stores, by its files' own names; a ready
 * export of the member's own, with the archive's names for what is in it; and, last, the
 * lockout, with the notice as its staff wrote it. The household is suspended on the way: the
 * page is of no use to its test afterwards.
 */
async function drawnFromData(
  page: Page,
  household: string,
  look: () => Promise<void>,
): Promise<void> {
  const main = page.getByRole('main')
  /** A screen's own rows: the settings' navigation is a list too. */
  const listed = main.locator('li:not(nav li)')

  // This browser is listed among the apps once it has reported, which sync health has it do.
  await expect(listed.getByRole('button')).toHaveCount(1)
  await page.goto(inHousehold.clients(household))
  await expect(listed).toHaveCount(1)
  await look()

  await page.goto(inHousehold.storage(household))
  await expect(main.locator('ol li')).toHaveCount(3)
  await look()

  // The first right's one control asks for a copy, and the row then says what is in it.
  await page.goto(paths.accountPrivacy.example)
  await main.locator('section').first().getByRole('button').click()
  await expect(main.locator('summary')).toBeVisible()
  await main.locator('summary').click()
  await look()

  await suspend(household, notice)
  await page.goto(inHousehold.home(household))
  await expect(main.getByRole('heading', { level: 1 })).toContainText(home)
  await expect(main).toContainText(notice)
  await look()
}

test('what these screens draw of the server’s own data survives the pseudo-locale', async ({
  page,
}) => {
  test.slow()
  const { household } = await storing(page)
  await open(page, inHousehold.syncHealth(household), { locale: 'en-XA' })
  await expect(page.getByRole('main')).toContainText('⟦')
  await drawnFromData(page, household, () => expectSurvives(page))
})

test('what these screens draw of the server’s own data holds at a phone’s width and 200 % text', async ({
  page,
}) => {
  test.slow()
  const { household } = await storing(page)
  await page.setViewportSize(phone)
  await open(page, inHousehold.syncHealth(household), { scale: '200' })
  await drawnFromData(page, household, () => expectHolds(page))
})

test('the settings’ navigation, the banner in its longest drawing, a replica’s row and the bundle hold at a phone’s width and 200 % text', async ({
  page,
}) => {
  test.slow()
  const { who, household } = await owner(page)
  await page.setViewportSize(phone)
  // A browser's row, with its one control, and the bundle, in a household that takes writes.
  await open(page, inHousehold.syncHealth(household), { scale: '200' })
  const own = page.getByRole('listitem').filter({ hasText: 'This browser' })
  await expect(own.getByRole('button', { name: /^Download again on / })).toBeVisible()
  await expectHolds(page)
  await page.getByRole('link', { name: 'Send diagnostics' }).click()
  await expect(page.getByRole('main').getByRole('checkbox')).toHaveCount(6)
  await expectHolds(page)

  // The banner in its longest drawing: a household that lapsed and was restricted, to an owner,
  // with the day its data is kept until, who restricted it and why, and its three ways on.
  const restricted = await call(page, 'POST', `/households/${household}/restriction`, { reason })
  expect(restricted.status).toBe(200)
  await lapse(household)
  await page.goto(inHousehold.settings(household))
  await expect(title(page, 'Household')).toBeVisible()
  await expect(above(page)).toContainText(`${home} is read-only`)
  await expect(above(page)).toContainText(/Its data is kept until .+, then deleted\./)
  await expect(above(page)).toContainText(
    new RegExp(`An owner restricted this household on .+: ${who.name}\\.`),
  )
  await expect(above(page)).toContainText(`The reason given: ${reason}`)
  await expect(above(page).getByRole('link')).toHaveText([
    'Go to billing',
    'Export the household',
    'Lift the restriction',
  ])
  // And under it the settings' navigation, with the nine screens an owner has.
  await expect(settings(page).getByRole('link')).toHaveCount(9)
  await expectHolds(page)
})
