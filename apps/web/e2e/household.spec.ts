// A household's own screens in a real browser, against the API itself (plan item 26; A-22 to
// A-26, C-49 to C-51): the first of the product's critical paths, *register → create household →
// invite → accept* (PRD 06 §8), and beside it what each screen writes: an invitation declined
// and told of, a link shown once and withdrawn, leaving, what a member holds and what they are
// to the household, a child profile, the household's profile and its modules. Each screen a
// path passes is held to axe as it stands, and each write to what a member who cannot see the
// screen is given of it: where the focus is afterwards, and what was said.
//
// Then what the server alone can say of them: an address not confirmed, an invitation that is
// another's, a change somebody else got in before; what they do with the connection away; the
// matrix at a phone's width, which is the item's second measure; and, as overlays.spec.ts does
// for the primitives, everything these screens open, under the two gates every route is under.
//
// Every test makes its own people and its own household: the worker's member (fixtures.ts) owns
// a household of one, which the walk of the routes reads as that. What a test needs before its
// first screen is made through the API (stack.ts), from a document that draws none of the app,
// and whoever is at the screen changes as it does for a member: by the account's own way out.
import type { Browser, Locator, Page } from '@playwright/test'
import { previewOrigin } from '../build/preview.ts'
import { apiPath } from '../src/api/names.ts'
import { inHousehold, paths } from '../src/app/paths.ts'
import { buildFile } from '../src/update/build.ts'
import {
  expect,
  expectAccessible,
  frames,
  inspect,
  kept,
  open,
  smallTargets,
  test,
} from './fixtures.ts'
import {
  acceptInvitation,
  call,
  changeMeanwhile,
  createChild,
  createHousehold,
  invite,
  join,
  linkToken,
  makeOwner,
  person,
  picture,
  register,
  registerUnverified,
  signIn,
  signOut,
  type Person,
} from './stack.ts'

/** What the suite calls its households: no word a translator missed (stack.ts). */
const home = 'Dům č. 7'

/** Whom the suite brings into a household beside its owner, named as its people are. */
const guest = 'Vít Ježek'

/** What the suite calls a child profile. */
const child = 'Ádík'

/** The inviter's own words in an invitation of the suite's. */
const words = 'Přijď k nám, Víťo!'

/**
 * What a level on household settings comes to, which is not what it comes to on any other
 * module (D-167): its screens are every member's, and what *Can see* adds is the invitations.
 */
const settingsSay = {
  none: 'In their app all the same, as in every member’s: the household’s profile, its members, its modules, its data and sync health. Its invitations and its storage are not.',
  noneYours:
    'In your app all the same, as in every member’s: the household’s profile, its members, its modules, its data and sync health. Its invitations and its storage are not.',
  view: 'The household’s invitations and its storage, beside its profile, its members, its modules, its data and sync health, which every member reads. Changing anything in the settings is for an owner.',
  contribute:
    'No more than “Can see” gives: changing anything in the settings is for an owner, whatever is set here.',
} as const

/**
 * The screens of household settings that are every member's, whatever they hold on it, in the
 * order its navigation lists them: the three of plan item 26, and the household's data and
 * sync health, which plan item 27 put beside them. What *Can see* adds, the invitations and the
 * storage picture, and what is an owner's, billing and the apps, are not among them.
 */
const everyMembers = ['Household', 'Members', 'Modules', 'Data', 'Sync health']

/** The page's one title, which a screen is known by. */
function title(page: Page, name: string) {
  return page.getByRole('heading', { level: 1, name })
}

/** A toast on the screen, wherever its region is drawn: the page, or the modal that is open. */
function toasts(scope: Page | Locator): Locator {
  return scope.locator('[data-third-party] li')
}

/** The rows a screen lists: the toasts are items of a list too, and stand outside the landmark. */
function rows(page: Page): Locator {
  return page.getByRole('main').getByRole('listitem')
}

/** The way between the screens of household settings. */
function settings(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Household settings' })
}

/** The shell's own navigation: the sidebar, which names the household and the member's role. */
function sidebar(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Household', exact: true })
}

/**
 * A screen's own place: the element around what it draws, which takes the focus when the control
 * that held it has left the page (D-166).
 */
function place(page: Page): Locator {
  return page.getByRole('main').locator('div[tabindex="-1"]')
}

/** What a block of labels and values says under `key`. */
function valueOf(page: Page, key: string): Locator {
  return page
    .getByRole('term')
    .filter({ hasText: new RegExp(`^${key}$`) })
    .locator('xpath=following-sibling::dd[1]')
}

/** What was said of a write: a toast with these words, on the page or in the modal that is open. */
async function expectSaid(page: Page, words: string | RegExp): Promise<void> {
  await expect(toasts(page).filter({ hasText: words })).toBeVisible()
}

/** Fills the sign-in screen's two fields as `who`. */
async function signInAs(page: Page, who: Person): Promise<void> {
  await expect(title(page, 'Sign in')).toBeVisible()
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

/**
 * Signs out as a member does, by the account's own way out: what this browser kept of them goes
 * with their session, and whoever signs in next is drawn nothing of theirs (D-161).
 */
async function signOutHere(page: Page): Promise<void> {
  await page.goto(paths.account.path)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(title(page, 'Sign in')).toBeVisible()
}

/**
 * Opens the link an invitation's email carried, as a mail client opens it: a new document of
 * the app's, whatever the page showed before, with the token in the address's fragment.
 */
async function openLink(page: Page, token: string): Promise<void> {
  // From a page at the same path the browser would only change the fragment under it.
  await page.goto(buildFile)
  await page.goto(`${paths.invitation.path}#token=${token}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

interface Owner {
  readonly who: Person
  readonly household: string
}

/**
 * A person of this test's own who owns a household, signed in to the page's browser, which has
 * drawn nothing of the app yet.
 */
async function owner(page: Page): Promise<Owner> {
  const who = person()
  // A document of the app's origin to ask the API from, with none of the app in it.
  await page.goto(buildFile)
  await register(page, who)
  await signIn(page, who)
  return { who, household: await createHousehold(page, home) }
}

test.describe('on a device that says where it is', () => {
  // A household starts from what its maker's device says of them (A-22): its languages, which
  // name a country, and its timezone. The app's own language is the suite's, English, all the same.
  test.use({ locale: 'cs-CZ', timezoneId: 'Europe/Prague' })

  test('a person registers, creates a household and invites somebody, who accepts and is in it', async ({
    page,
  }) => {
    // One path through a dozen screens, each under axe.
    test.slow()
    const invited = person(guest)
    // The invited person has an account already, with its address verified: joining waits for it.
    await page.goto(buildFile)
    await register(page, invited)

    const who = person()
    await open(page, paths.register.example)
    await page.getByLabel('Name').fill(who.name)
    await page.getByLabel('Email').fill(who.email)
    await page.getByLabel('Password', { exact: true }).fill(who.password)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(title(page, 'Check your email')).toBeVisible()
    await page.goto(`${paths.verifyEmail.path}#token=${await linkToken(who.email, 'verify-email')}`)
    await expect(title(page, 'Your email is verified')).toBeVisible()
    await page.getByRole('link', { name: 'Go to sign in' }).click()
    await signInAs(page, who)

    // In no household yet, they are opened at making one (DD-6). Only the name is asked: the
    // country and the timezone are read from the device, the currency follows the country, and
    // each says where it came from.
    await expect(page).toHaveURL(paths.householdNew.path)
    await expect(title(page, 'Set up your household')).toBeVisible()
    await expect(page.getByLabel('Country')).toHaveValue('CZ')
    await expect(page.getByLabel('Country')).toHaveAccessibleDescription(/^Read from this device\./)
    await expect(page.getByLabel('Timezone')).toHaveValue('Europe/Prague')
    await expect(page.getByLabel('Timezone')).toHaveAccessibleDescription(
      /^Read from this device\./,
    )
    await expect(page.getByLabel('Money is counted in')).toHaveValue('CZK')
    // Asked for with no name, nothing is sent, and the focus is on the field that says so.
    await page.getByRole('button', { name: 'Create the household' }).click()
    await expect(page.getByLabel('Name')).toBeFocused()
    await expect(page.getByLabel('Name')).toHaveAccessibleDescription(/A household needs a name\.$/)
    await page.getByLabel('Name').fill(home)
    await expectAccessible(page)
    await page.getByRole('button', { name: `Create ${home}` }).click()

    // The first run's question passes on to Home while no module takes a first record.
    await expect(title(page, 'Home')).toBeVisible()
    await expect(page).toHaveURL(/\/households\/[0-9a-f-]{36}$/)
    const household = new URL(page.url()).pathname.split('/')[2] ?? ''
    await expect(page.getByRole('banner')).toContainText(home)
    await expectAccessible(page)

    await sidebar(page).getByRole('link', { name: 'Household settings' }).click()
    await expect(title(page, 'Household')).toBeVisible()
    // The household is where its device said it was.
    await expect(valueOf(page, 'Country')).toHaveText('Czechia')
    await expect(valueOf(page, 'Timezone')).toHaveText('Europe/Prague')
    await expect(valueOf(page, 'Money is counted in')).toHaveText('CZK')
    await expectAccessible(page)
    await settings(page).getByRole('link', { name: 'Members' }).click()
    await expect(title(page, 'Members')).toBeVisible()
    await expect(page.getByRole('link', { name: `${who.name} (you)` })).toBeVisible()
    await expectAccessible(page)

    // The composer: seventeen decisions, already answered, and one of them changed.
    await page.getByRole('link', { name: 'Invite somebody' }).click()
    await expect(title(page, 'Invite somebody')).toBeVisible()
    // Sent with no address, it goes nowhere: the focus is on the field, which says what it wants.
    const address = page.getByLabel('Their email address')
    await page.getByRole('button', { name: 'Send the invitation' }).click()
    await expect(address).toBeFocused()
    await expect(address).toHaveAccessibleDescription('Enter the address the invitation goes to.')
    await address.fill(invited.email)
    const counts = page.getByText('Of the seventeen modules:')
    await expect(counts).toHaveText(
      'Of the seventeen modules: 0 to set up, 9 to add and edit in, 3 to see, 5 off.',
    )
    const finance = page.getByLabel('Finance')
    await expect(finance).toHaveValue('none')
    await finance.selectOption({ label: 'Can see' })
    await expect(finance).toHaveAccessibleDescription(
      'Everything in it can be read, and nothing changed. Changed from “Off”.',
    )
    await expect(counts).toHaveText(
      'Of the seventeen modules: 0 to set up, 9 to add and edit in, 4 to see, 4 off.',
    )
    await expectAccessible(page)
    await page.getByRole('button', { name: 'Send the invitation' }).click()

    // Sent, which is said, and it waits among the household's invitations.
    await expect(title(page, 'Invitations')).toBeVisible()
    await expect(toasts(page)).toHaveText([`Sent to ${invited.email}. It works for 14 days.`])
    await expect(page).toHaveURL(inHousehold.invitations(household))
    const sent = rows(page).filter({ hasText: invited.email })
    await expect(sent).toContainText('Member')
    await expect(sent).toContainText('Waiting · expires')
    await expect(sent).toContainText(`Sent by ${who.name}`)
    await expect(sent).toContainText(/Can see: .*Finance/)
    await expectAccessible(page)

    // The owner leaves the browser, and the invited person opens the link their email carried.
    await signOutHere(page)
    await page.goto(
      `${paths.invitation.path}#token=${await linkToken(invited.email, 'invitation')}`,
    )
    await expect(title(page, `${who.name} has invited you to ${home}`)).toBeVisible()
    // The token is read, and is in the address no longer.
    expect(new URL(page.url()).hash).toBe('')
    // Exactly what is given, to a visitor: the role, and the modules under each level.
    await expect(page.getByRole('heading', { name: 'You would join as a member' })).toBeVisible()
    // Household settings is no part of a level's count: it is said last, as what it is.
    const given = page.getByRole('term')
    const levels = ['Can add and edit · 9', 'Can see · 3', 'Off · 4', 'Household settings']
    await expect(given).toHaveText(levels)
    await expect(page.getByRole('definition').nth(1)).toContainText('Finance')
    await expect(page.getByRole('definition').nth(2)).toContainText('Not in your app at all')
    await expect(page.getByRole('definition').nth(3)).toContainText(settingsSay.view)
    await expect(page.getByText('To join or to decline, sign in first.')).toBeVisible()
    await expect(page.getByRole('button', { name: `Join ${home}` })).toHaveCount(0)
    await expectAccessible(page)

    // Signing in brings them back to the invitation they were reading.
    await page.getByRole('link', { name: 'Sign in to answer' }).click()
    await signInAs(page, invited)
    await expect(title(page, `${who.name} has invited you to ${home}`)).toBeVisible()
    await expect(page).toHaveURL(paths.invitation.path)
    await expect(given).toHaveText(levels)
    await expectAccessible(page)
    await page.getByRole('button', { name: `Join ${home}` }).click()

    // They are in the household, which is said, and read it as a member does.
    await expect(title(page, 'Home')).toBeVisible()
    await expect(toasts(page)).toHaveText([`You joined ${home}.`])
    await expect(page).toHaveURL(inHousehold.home(household))
    await expect(sidebar(page)).toContainText('Member')
    await expectAccessible(page)

    // And the owner's list of members names them, with what they hold.
    await signOutHere(page)
    await signInAs(page, who)
    await expect(title(page, 'Home')).toBeVisible()
    await page.goto(inHousehold.members(household))
    const joined = rows(page).filter({ hasText: invited.name })
    await expect(joined).toContainText('Member')
    await expect(joined).toContainText(/Can see: .*Finance/)
    await expect(joined).toContainText('Off: 4 modules')
    await expectAccessible(page)
  })
})

test('an invitation that is declined is told to the owner who sent it, who can ask again', async ({
  page,
}) => {
  const { who, household } = await owner(page)
  const invited = person(guest)
  await invite(page, household, invited.email, { message: words })
  await signOut(page)
  await register(page, invited)
  await signIn(page, invited)

  // An invitation sent to a member's own address waits on their account, where they look for a
  // household to be in: above the form that makes one, which a member in none is opened at.
  await open(page, paths.home.example)
  await expect(title(page, 'Set up your household')).toBeVisible()
  const waiting = page.getByRole('list', { name: 'Invitations waiting for you' })
  await expect(waiting.getByRole('listitem')).toHaveCount(1)
  await expect(waiting.getByRole('listitem')).toContainText(`${who.name} invited you to ${home}`)
  await expectAccessible(page)
  await waiting.getByRole('link', { name: `See the invitation to ${home}` }).click()

  // Nothing is answered from a list: the invitation's own screen, which the address names with
  // nothing after it. The inviter's own words first, and under the two answers what declining does.
  await expect(title(page, `${who.name} has invited you to ${home}`)).toBeVisible()
  await expect(page).toHaveURL(paths.invitation.path)
  await expect(page.getByRole('figure')).toContainText(`${who.name} writes:`)
  await expect(page.getByRole('figure')).toContainText(words)
  await expect(
    page.getByText(`Declining is recorded and ${who.name} is told.`, { exact: false }),
  ).toBeVisible()
  await expectAccessible(page)
  // What the page says is said as it changes: one element, whose words change where they stand.
  const said = page.locator('[aria-live="polite"]').filter({ has: page.getByRole('heading') })
  const before = await said.elementHandle()
  await page.getByRole('button', { name: 'Decline' }).click()

  // The page's place is taken by what became of it, which its title says, and the answers are
  // gone with the focus one of them held: it is put on the screen's own place.
  await expect(title(page, `You declined the invitation to ${home}`)).toBeVisible()
  await expect(said).toContainText(`You declined the invitation to ${home}`)
  expect(await before.evaluate((element) => element.isConnected)).toBe(true)
  await expect(
    page.getByText(`${who.name} is told. Nothing was added to your account.`),
  ).toBeVisible()
  await expect(place(page)).toBeFocused()
  await expect(page.getByRole('button')).toHaveCount(0)
  await expectAccessible(page)

  // The owner reads of it above the household's invitations (A-25), with the one thing that
  // might change the answer: asking again, the composer filled in from what was declined.
  await signOutHere(page)
  await signInAs(page, who)
  await expect(title(page, 'Home')).toBeVisible()
  await page.goto(inHousehold.invitations(household))
  await expect(page.getByText(`${invited.email} declined the invitation`)).toBeVisible()
  await expect(rows(page).filter({ hasText: invited.email })).toContainText('Declined')
  await expectAccessible(page)
  await page.getByRole('link', { name: `Invite ${invited.email} again` }).click()
  await expect(title(page, 'Invite somebody')).toBeVisible()
  await expect(page.getByLabel('Their email address')).toHaveValue(invited.email)
  await expect(page.getByLabel('By email, to one person')).toBeChecked()
})

test('an invitation link is shown once, copied, and answers nobody once it is withdrawn', async ({
  page,
  context,
}) => {
  const { household } = await owner(page)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await open(page, inHousehold.invite(household))
  await page.getByLabel('By a link I send myself').check()
  // Said before the link is made as after: it is shown once.
  await expect(page.getByText('It is shown once, on this page', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Make the link' }).click()

  // The form went with the press: the focus is on the link itself, read with the sentence that
  // it is shown only this once.
  const link = page.getByRole('textbox', { name: 'The link' })
  await expect(link).toBeFocused()
  await expect(link).toHaveAccessibleDescription(
    'Shown only this once. Copy it before you leave this page: a reload loses it.',
  )
  const address = await link.inputValue()
  expect(new URL(address).pathname).toBe(paths.invitation.path)
  expect(new URL(address).hash).toMatch(/^#token=[A-Za-z0-9_-]+$/)
  await expect(page.getByText('One person can join with it.')).toBeVisible()
  await expectAccessible(page)
  const copy = page.getByRole('button', { name: 'Copy the link' })
  await copy.click()
  await expectSaid(page, 'Link copied')
  await expect(copy).toBeFocused()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address)

  // Among the invitations it names nobody, and is withdrawn by a question that says what stops.
  await page.getByRole('link', { name: 'Done' }).click()
  await expect(title(page, 'Invitations')).toBeVisible()
  const row = rows(page).filter({ hasText: 'A link, passed on by hand' })
  await expect(row).toContainText('Waiting · expires')
  await row.getByRole('button', { name: /^Withdraw the link made on / }).click()
  const question = page.getByRole('dialog', { name: 'Withdraw this link?' })
  await expect(question).toContainText('It stops working at once, for everybody who has it.')
  await expectAccessible(page)
  await question.getByRole('button', { name: 'Withdraw this link' }).click()
  await expect(question).toBeHidden()
  await expectSaid(page, 'The link is withdrawn. It no longer works.')
  await expect(row).toContainText('Withdrawn')
  // A withdrawn link offers nothing more: the control the question was asked from went with
  // the list's next reading, and the focus it was given back goes to the list's own place.
  await expect(row.getByRole('button')).toHaveCount(0)
  await expect(place(page)).toBeFocused()

  // And whoever opens it now is told it was answered, and no more than that.
  await page.goto(address)
  await expect(title(page, 'This invitation has already been answered')).toBeVisible()
  await expectAccessible(page)
})

test('an invitation sent again goes out with a new link, and the one before opens nothing', async ({
  page,
}) => {
  const { who, household } = await owner(page)
  // Nobody's account yet: an invitation names its invitee by the address alone.
  const address = person().email
  const first = await invite(page, household, address)
  await open(page, inHousehold.invitations(household))
  const row = rows(page).filter({ hasText: address })
  const again = row.getByRole('button', { name: `Send again to ${address}` })
  await again.click()
  // Sent, which is said with what it does to the link before. The row and its control stay
  // where they were, and the focus with them.
  await expectSaid(
    page,
    `Sent again to ${address}. The link sent before no longer works; this one works for 14 days.`,
  )
  await expect(again).toBeFocused()
  await expect(again).not.toHaveAttribute('aria-busy', 'true')

  // An address is asked once at a time: a second invitation to it is refused beside the field,
  // where the focus goes, with the way to the one that waits.
  await page.getByRole('link', { name: 'Invite somebody' }).click()
  const field = page.getByLabel('Their email address')
  await field.fill(address)
  // Enter in the field sends, as the button under the form does.
  await field.press('Enter')
  await expect(field).toBeFocused()
  await expect(field).toHaveAccessibleDescription(
    /^An invitation is already waiting for this address, or it belongs to somebody who is a member already\./,
  )
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Go to the invitations' }),
  ).toBeVisible()
  await expectAccessible(page)

  // The link sent first is cut off by the second, and says no more than that it opens nothing.
  let second = first
  await expect.poll(async () => (second = await linkToken(address, 'invitation'))).not.toBe(first)
  await signOutHere(page)
  await openLink(page, first)
  await expect(title(page, 'This link opens no invitation')).toBeVisible()
  await expect(
    page.getByText('the invitation was sent again since', { exact: false }),
  ).toBeVisible()
  await expectAccessible(page)
  await openLink(page, second)
  await expect(title(page, `${who.name} has invited you to ${home}`)).toBeVisible()
})

test('an invitation sent to one address is not answered from another’s account, which is told what that may be', async ({
  page,
}) => {
  const { who, household } = await owner(page)
  const token = await invite(page, household, person().email)
  const other = person(guest)
  await signOut(page)
  await register(page, other)
  await signIn(page, other)

  // Whoever holds the link reads what it gives. The answer is the addressee's alone, and the
  // server says of another's only that it found nothing to answer.
  await openLink(page, token)
  await expect(title(page, `${who.name} has invited you to ${home}`)).toBeVisible()
  // The token is half a credential: once this browser has written down what it keeps, the
  // account among it, nothing of that names the token or what was read by it.
  await expect.poll(() => kept(page)).toContain(JSON.stringify(['me']))
  expect((await kept(page)).filter((key) => key.includes(token))).toEqual([])
  await page.getByRole('button', { name: `Join ${home}` }).click()
  await expect(title(page, 'This invitation can’t be answered from this account')).toBeVisible()
  await expect(
    page.getByText(`than the one you are signed in with (${other.email})`, { exact: false }),
  ).toBeVisible()
  // The two answers went with the page's place, and the focus one held is put on it.
  await expect(place(page)).toBeFocused()
  await expect(page.getByRole('link', { name: 'Go to your account' })).toBeVisible()
  await expectAccessible(page)
})

test('an invitation’s link opened in a tab that is on the invitation’s page already is the one that is shown', async ({
  page,
}) => {
  const { who, household } = await owner(page)
  const invited = person(guest)
  const token = await invite(page, household, invited.email)
  await signOut(page)
  await register(page, invited)
  await signIn(page, invited)

  // The page loaded with no link holds none, and says to open the link again.
  await open(page, paths.invitation.path)
  await expect(title(page, 'There is no invitation to show here')).toBeVisible()
  // Opened where they are, as a link pasted into the address is: the browser loads nothing, and
  // only changes the fragment under the page. It is the invitation the page then shows.
  await page.goto(`${paths.invitation.path}#token=${token}`)
  await expect(title(page, `${who.name} has invited you to ${home}`)).toBeVisible()
  await expect(page).toHaveURL(paths.invitation.path)

  // The same link again, where the page shows what it read: the screen is begun again and reads
  // for itself. Its read is held back for as long as the test says, and nothing the screen
  // before it read is drawn meanwhile, the two answers least of all. Handed on to the route that
  // names this test's network (fixtures.ts), and not past it.
  const reading = `**${apiPath}/me/invitations/${token}`
  let send: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    send = resolve
  })
  await page.route(reading, async (route) => {
    await held
    await route.fallback()
  })
  await page.goto(`${paths.invitation.path}#token=${token}`)
  await expect(title(page, 'An invitation to a household')).toBeVisible()
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  send()
  await expect(title(page, `${who.name} has invited you to ${home}`)).toBeVisible()
  await expect(page).toHaveURL(paths.invitation.path)
  await page.unroute(reading)

  await page.getByRole('button', { name: `Join ${home}` }).click()
  await expect(title(page, 'Home')).toBeVisible()
  await expect(page).toHaveURL(inHousehold.home(household))
})

// An invitation somebody joined by says who came, and not who is here: a member who left and is
// asked back is anybody again, and their decline is told as anybody's is (A-25, D-171).
test('a decline by somebody who was a member once and left is told to the owner, who can send it again', async ({
  page,
}) => {
  const { who, household } = await owner(page)
  const back = person(guest)
  await join(page, who, household, back)
  await signOut(page)
  await signIn(page, back)
  expect((await call(page, 'POST', `/households/${household}/leave`)).status).toBe(204)
  await signOut(page)
  await signIn(page, who)
  await invite(page, household, back.email)
  await signOut(page)
  await signIn(page, back)
  // Answered by the invitation as their account lists it: two emails to the address carry a
  // link by now, and the one that asked them back is the one that waits.
  const waiting = (await call(page, 'GET', '/me/invitations')).body as {
    readonly items?: readonly { readonly token?: string }[]
  }
  const token = waiting.items?.[0]?.token ?? ''
  expect((await call(page, 'POST', `/me/invitations/${token}/decline`)).status).toBe(204)
  await signOut(page)
  await signIn(page, who)

  await open(page, inHousehold.invitations(household))
  await expect(page.getByText(`${back.email} declined the invitation`)).toBeVisible()
  await expect(page.getByRole('link', { name: `Invite ${back.email} again` })).toBeVisible()
  const declined = rows(page).filter({ hasText: 'Declined' })
  await expect(declined).toHaveCount(1)
  await declined.getByRole('button', { name: `Send again to ${back.email}` }).click()
  await expectSaid(page, `Sent again to ${back.email}.`)
  // It waits once more, and the decline is news no longer.
  await expect(page.getByText(`${back.email} declined the invitation`)).toHaveCount(0)
  await expect(rows(page).filter({ hasText: 'Waiting' })).toHaveCount(1)
})

test('an account whose address is not confirmed is told why, where it is refused: joining a household, and inviting into its own', async ({
  page,
}) => {
  const { who, household } = await owner(page)
  const invited = person(guest)
  const token = await invite(page, household, invited.email)
  await signOut(page)
  await registerUnverified(page, invited)
  await signIn(page, invited)

  // In the place of *Join*: why this waits for a proven address, and the way to prove it.
  await openLink(page, token)
  await expect(title(page, `${who.name} has invited you to ${home}`)).toBeVisible()
  await expect(page.getByText('Verify your email first')).toBeVisible()
  await expect(
    page.getByText('Joining a household is trust extended to your account', { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: `Join ${home}` })).toHaveCount(0)
  await expectAccessible(page)
  // Declining extends no trust to anybody, and needs none.
  await page.getByRole('button', { name: 'Decline' }).click()
  await expect(title(page, `You declined the invitation to ${home}`)).toBeVisible()
  await expect(place(page)).toBeFocused()

  // Such an account makes a household like any other (FR-HH1), and is told the same where it
  // would invite somebody into it: in the form's place, from the first.
  const own = await createHousehold(page, 'Byt č. 3')
  await page.goto(inHousehold.invite(own))
  await expect(title(page, 'Invite somebody')).toBeVisible()
  await expect(page.getByText('Verify your email first')).toBeVisible()
  await expect(
    page.getByText('so your own address is confirmed before one goes', { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send the invitation' })).toHaveCount(0)
  await expect(page.getByLabel('Their email address')).toHaveCount(0)
  await expectAccessible(page)
})

test('a member leaves from their account, and the only owner who also pays is told both things in the way at once', async ({
  page,
  faults,
}) => {
  const { who, household } = await owner(page)
  const member = person(guest)
  await join(page, who, household, member)

  // Whoever made a household pays for it until billing moves, and is its only owner until they
  // make another: two things stand in the way, and both are said before anything is pressed.
  await open(page, inHousehold.leave(household))
  await expect(title(page, `Leave ${home}`)).toBeVisible()
  await expect(
    page.getByText('Two things have to be settled first, and here they both are.'),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'You are the only owner' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Make somebody an owner' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'You pay for the household' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What you leave behind' })).toBeVisible()
  // No control that could only be refused: what it waits for is said above.
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  await expectAccessible(page)

  // The member finds the way out among the households of their account, whatever they hold.
  await signOutHere(page)
  await signInAs(page, member)
  await expect(title(page, 'Home')).toBeVisible()
  await sidebar(page).getByRole('link', { name: 'Your account' }).click()
  await expect(title(page, 'Your account')).toBeVisible()
  const listed = rows(page).filter({ hasText: home })
  await expect(listed).toContainText('Member')
  await listed.getByRole('link', { name: `Leave ${home}` }).click()
  await expect(title(page, `Leave ${home}`)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What you leave behind' })).toBeVisible()
  await expectAccessible(page)
  await page.getByRole('button', { name: `Leave ${home}` }).click()
  const question = page.getByRole('dialog', { name: `Leave ${home}?` })
  await expect(question).toContainText('What you added stays with the household')
  await expectAccessible(page)
  await question.getByRole('button', { name: `Leave ${home}` }).click()

  // They left, which is said, and are opened where a member in no household is.
  await expect(title(page, 'Set up your household')).toBeVisible()
  await expectSaid(page, `You left ${home}.`)
  await expect(page).toHaveURL(paths.householdNew.path)
  // What this browser kept of the household went as its screen did: no read of it is kept.
  await expect
    .poll(async () => (await kept(page)).filter((key) => key.includes(household)))
    .toEqual([])
  await page.getByRole('link', { name: 'Profile' }).click()
  await expect(page.getByText('You are not in a household yet')).toBeVisible()

  // The household's replica is open for as long as its screens are drawn, and may have been
  // asking for its credentials as the membership ended. The API's refusal of it then, as the
  // SDK says it, is this test's own doing, and its only fault.
  expect(
    faults.filter(
      (fault) => !/^\[PowerSync\]: Sync error Error: the sync credentials: 404\b/.test(fault),
    ),
  ).toEqual([])
  faults.length = 0
})

test('an owner lowers what a member holds, having read what that comes to, and the member’s own page says so', async ({
  page,
}) => {
  const { who, household } = await owner(page)
  const member = person(guest)
  const memberId = await join(page, who, household, member)
  await open(page, inHousehold.member(household, memberId))
  await expect(title(page, member.name)).toBeVisible()

  // The row says what its level comes to and where it came from, and the save what the change
  // does, before anything is saved (D-78).
  const shopping = page.getByLabel('Shopping')
  await expect(shopping).toHaveValue('contribute')
  await shopping.selectOption({ label: 'Off' })
  await expect(shopping).toHaveAccessibleDescription(
    'Not in their app at all: no screen, no widget, no search result, no reminder. Changed from “Can add and edit”.',
  )
  const save = page.getByRole('button', { name: 'Save changes' })
  await expect(save).toHaveAccessibleDescription(
    `1 module is lowered. Shopping leaves ${member.name}’s app entirely, and their devices drop their copy of it. Nothing they added is deleted. ${member.name} is told of the change.`,
  )
  await expectAccessible(page)

  // Put back, nothing is saved, which is said: the two buttons go with the change, and the
  // focus one of them held goes to the matrix they stood under.
  const matrix = page.getByRole('group', { name: `What ${member.name} holds` })
  await page.getByRole('button', { name: 'Put back' }).click()
  await expectSaid(page, 'The levels are back to what is saved.')
  await expect(shopping).toHaveValue('contribute')
  await expect(save).toHaveCount(0)
  await expect(matrix).toBeFocused()

  // Changed again, and household settings lowered beside it: the one row whose *Off* takes no
  // screen away (D-167). The row says what does go, and so does the save, which does not count
  // it among what leaves their app.
  await shopping.selectOption({ label: 'Off' })
  const ofSettings = page.getByRole('combobox', { name: 'Household settings' })
  await ofSettings.selectOption({ label: 'Off' })
  await expect(ofSettings).toHaveAccessibleDescription(
    `${settingsSay.none} Changed from “Can see”.`,
  )
  await expect(save).toHaveAccessibleDescription(
    `2 modules are lowered. Shopping leaves ${member.name}’s app entirely, and their devices drop their copy of it. Nothing they added is deleted. ${member.name} no longer reads the household’s invitations or its storage. Its profile, its members, its modules, its data and sync health stay theirs to read. ${member.name} is told of the change.`,
  )
  // Saved, which is said, and the focus goes where it went before.
  await save.click()
  await expectSaid(page, `${member.name}’s access is saved. They are told.`)
  await expect(save).toHaveCount(0)
  await expect(matrix).toBeFocused()
  await expect(shopping).toHaveAccessibleDescription(
    'Not in their app at all: no screen, no widget, no search result, no reminder.',
  )

  // The member reads it on their own page: the module is among what is off for them, and
  // household settings, which they read it in, is said by itself.
  await signOutHere(page)
  await signInAs(page, member)
  await expect(title(page, 'Home')).toBeVisible()
  await page.goto(inHousehold.member(household, memberId))
  await expect(page.getByRole('heading', { name: 'What you hold' })).toBeVisible()
  await expect(page.getByRole('term')).toHaveText([
    'Can add and edit · 8',
    'Can see · 2',
    'Off · 6',
    'Household settings',
  ])
  await expect(page.getByRole('definition').nth(2)).toContainText('Not in your app at all')
  await expect(page.getByRole('definition').nth(2)).toContainText('Shopping')
  await expect(page.getByRole('definition').nth(2)).not.toContainText('Household settings')
  await expect(page.getByRole('definition').nth(3)).toHaveText(settingsSay.noneYours)
  // What went with it is the invitations, and the storage picture beside them (plan item 27):
  // the way between the settings' screens names neither, and nothing that is an owner's.
  await expect(settings(page).getByRole('link')).toHaveText(everyMembers)
  // Nothing of theirs to change here, and the page says whose it is.
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await expect(
    page.getByText(`Changing it is for an owner: ${who.name}.`, { exact: false }),
  ).toBeVisible()
  await expectAccessible(page)
})

// Household settings is every member's to open (D-167): what a level on it decides is what
// *Can see* unlocks, the invitations, and no screen.
test('a member who holds nothing on household settings reads its screens all the same, and the invitations are not among them', async ({
  page,
}) => {
  const { who, household } = await owner(page)
  const member = person(guest)
  const memberId = await join(page, who, household, member, { admin: 'none' })
  await signOut(page)
  await signIn(page, member)

  // It is in their list of modules, and opens the household's profile, which they read.
  await open(page, inHousehold.home(household))
  await sidebar(page).getByRole('link', { name: 'Household settings' }).click()
  await expect(title(page, 'Household')).toBeVisible()
  await expect(valueOf(page, 'Name')).toHaveText(home)
  // No control that changes anything, and no code, which is its owners' to read.
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'The household code' })).toHaveCount(0)
  await expectAccessible(page)

  // The way between its screens leads to what every member reads, and names no invitations.
  await expect(settings(page).getByRole('link')).toHaveText(everyMembers)
  await settings(page).getByRole('link', { name: 'Members' }).click()
  await expect(title(page, 'Members')).toBeVisible()
  // Everybody's access, visible to everybody: the owner's, and their own.
  await expect(rows(page).filter({ hasText: who.name })).toContainText('Can set it up:')
  const own = rows(page).filter({ hasText: `${member.name} (you)` })
  await expect(own).toContainText('Off: 6 modules')
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Invite somebody' })).toHaveCount(0)
  await expectAccessible(page)
  await settings(page).getByRole('link', { name: 'Modules' }).click()
  await expect(title(page, 'Modules')).toBeVisible()
  await expect(rows(page).filter({ hasText: 'Shopping' })).toContainText('Held by 2 of 2 members')
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  await expectAccessible(page)

  // The invitations and the composer open nothing for them, and say no more than that (F-17).
  for (const address of [inHousehold.invitations(household), inHousehold.invite(household)]) {
    await page.goto(address)
    await expect(title(page, 'This link doesn’t open anything here.')).toBeVisible()
  }
  await expectAccessible(page)
  // Their own page is theirs to read. What is off for them is not in their app at all, and
  // household settings, which they are reading it in, is not said to be among that: it is said
  // last, as what a level of nothing on it comes to.
  await page.goto(inHousehold.member(household, memberId))
  await expect(page.getByRole('heading', { name: 'What you hold' })).toBeVisible()
  await expect(page.getByRole('term')).toHaveText([
    'Can add and edit · 9',
    'Can see · 2',
    'Off · 5',
    'Household settings',
  ])
  const held = page.getByRole('definition')
  await expect(held.nth(2)).toContainText('Not in your app at all')
  await expect(held.nth(2)).toContainText('Finance, Utilities, Garden, Property, and Vehicles')
  await expect(held.nth(2)).not.toContainText('Household settings')
  await expect(held.nth(3)).toHaveText(settingsSay.noneYours)
  await expectAccessible(page)
  // And it leads to leaving, which no level stands over.
  await page.getByRole('link', { name: `Leave ${home}` }).click()
  await expect(page.getByRole('button', { name: `Leave ${home}` })).toBeVisible()
})

test('an owner makes a member an owner, and removes them, each asked first and said once done', async ({
  page,
}) => {
  const { who, household } = await owner(page)
  const member = person(guest)
  const memberId = await join(page, who, household, member)
  await open(page, inHousehold.member(household, memberId))
  await expect(title(page, member.name)).toBeVisible()

  // The question says what owners can do, and that billing does not move with it.
  const promote = page.getByRole('button', { name: `Make ${member.name} an owner` })
  await promote.click()
  const asked = page.getByRole('dialog', { name: `Make ${member.name} an owner?` })
  await expect(asked).toContainText('There can be several owners, and this does not move billing.')
  await expectAccessible(page)
  await asked.getByRole('button', { name: `Make ${member.name} an owner` }).click()
  await expect(asked).toBeHidden()
  await expectSaid(page, `${member.name} is an owner. They are told.`)
  // The one control stays where the question was asked from, says the other way now, and has
  // the focus the question gave back.
  const demote = page.getByRole('button', { name: `Make ${member.name} a member` })
  await expect(demote).toBeFocused()
  await expect(page.getByRole('main').getByText('Owner', { exact: true })).toBeVisible()
  await expect(
    page.getByText(`To narrow what ${member.name} holds, make them a member first.`, {
      exact: false,
    }),
  ).toBeVisible()
  await expectAccessible(page)

  // Removing names who is removed and from what, and says what becomes of what they made.
  await page.getByRole('button', { name: `Remove ${member.name}`, exact: true }).click()
  const removal = page.getByRole('dialog', { name: `Remove ${member.name} from ${home}?` })
  await expect(removal).toContainText(`What ${member.name} added stays`)
  await expect(removal).toContainText(`${member.name} is told.`)
  await expectAccessible(page)
  await removal.getByRole('button', { name: `Remove ${member.name} from ${home}` }).click()

  // The page is about nobody now: it goes to the list of members, which is without them, and
  // what happened is said there.
  await expect(title(page, 'Members')).toBeVisible()
  await expectSaid(page, `${member.name} was removed. They are told.`)
  await expect(page).toHaveURL(inHousehold.members(household))
  await expect(rows(page).filter({ hasText: member.name })).toHaveCount(0)
  await expect(page.getByRole('link', { name: `${who.name} (you)` })).toBeVisible()
  await expectAccessible(page)
})

test('an owner makes a child profile, sets it a new PIN, sends it a sign-in of its own and removes it', async ({
  page,
}) => {
  // Three panels and a confirmation, each under axe.
  test.slow()
  const { who, household } = await owner(page)
  await open(page, inHousehold.members(household))
  const add = page.getByRole('button', { name: 'Add a child profile' })
  await add.click()
  const sheet = page.getByRole('dialog', { name: 'Add a child profile' })
  // Its first field has the focus, and the one asymmetry is stated as a fact (FR-CH3).
  await expect(sheet.getByLabel('Name')).toBeFocused()
  await expect(sheet).toContainText('An owner can read what a child keeps in their private space.')
  await expect(sheet.getByRole('term')).toHaveText([
    'Can add and edit · 5',
    'Can see · 2',
    'Off · 9',
    'Household settings',
  ])
  await expect(sheet.getByRole('definition').last()).toHaveText(settingsSay.none)
  await sheet.getByLabel('Name').fill(child)
  await sheet.getByLabel('PIN', { exact: true }).fill('4827')
  await sheet.getByLabel('The same PIN again').fill('4872')
  await expectAccessible(page)
  await sheet.getByRole('button', { name: 'Make the profile' }).click()
  // Two PINs that differ are not sent: the focus is on the field that says so.
  await expect(sheet.getByLabel('The same PIN again')).toBeFocused()
  await expect(sheet.getByLabel('The same PIN again')).toHaveAccessibleDescription(
    'The two PINs are not the same. Type it again.',
  )
  await sheet.getByLabel('The same PIN again').fill('4827')
  await sheet.getByRole('button', { name: 'Make the profile' }).click()

  // Made, which is said with what happens next and without the PIN, and the focus is back on
  // the control the sheet was opened from.
  await expect(sheet).toBeHidden()
  await expectSaid(
    page,
    `${child}’s profile is made. They sign in with the household’s code, their profile and their PIN.`,
  )
  await expect(toasts(page).filter({ hasText: '4827' })).toHaveCount(0)
  await expect(add).toBeFocused()
  const row = rows(page).filter({ hasText: child })
  await expect(row).toContainText('Child profile')
  await expectAccessible(page)

  // Its own page: how it signs in, and an owner's controls over it.
  await row.getByRole('link', { name: child }).click()
  await expect(title(page, child)).toBeVisible()
  await expect(page.getByRole('heading', { name: `${child}’s profile` })).toBeVisible()
  await expect(
    page.getByText('A child profile has no email address.', { exact: false }),
  ).toBeVisible()
  await expectAccessible(page)

  // Its picture, which an owner sets: saved, which is said, and drawn from the object store,
  // another origin than the page's, which the policy admits for a picture and nothing else.
  const portrait = page.getByRole('main').locator('img')
  await expect(portrait).toHaveCount(0)
  await page
    .getByRole('main')
    .locator('input[type="file"]')
    .setInputFiles({ name: 'picture.png', mimeType: 'image/png', buffer: picture() })
  await expectSaid(page, `${child}’s picture is saved.`)
  await expect(portrait).toBeVisible()
  await expect
    .poll(() => portrait.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0)
  expect(new URL((await portrait.getAttribute('src')) ?? '').origin).not.toBe(
    new URL(page.url()).origin,
  )
  // Removed, the control that removed it goes with it, and the focus it held is on the one
  // that stays, which offers to choose a picture again.
  await page.getByRole('button', { name: 'Remove picture' }).click()
  await expect(portrait).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Choose a picture' })).toBeFocused()

  const newPin = page.getByRole('button', { name: 'Set a new PIN' })
  await newPin.click()
  const pin = page.getByRole('dialog', { name: `A new PIN for ${child}` })
  await expect(pin.getByLabel('New PIN')).toBeFocused()
  await expect(pin).toContainText(
    `Tell ${child} the new PIN in person: Household sends it nowhere.`,
  )
  await pin.getByLabel('New PIN').fill('913467')
  await pin.getByLabel('The same PIN again').fill('913467')
  await expectAccessible(page)
  // Enter in a field asks as the panel's own button does, which stands at its foot.
  await pin.getByLabel('The same PIN again').press('Enter')
  await expect(pin).toBeHidden()
  await expectSaid(page, `${child}’s PIN is changed.`)
  await expect(toasts(page).filter({ hasText: '913467' })).toHaveCount(0)
  await expect(newPin).toBeFocused()

  // A sign-in of its own, up to the link's sending: what it opens is another screen's.
  const young = person(child)
  const graduate = page.getByRole('button', { name: `Give ${child} their own sign-in` })
  await graduate.click()
  const panel = page.getByRole('dialog', { name: `Give ${child} their own sign-in` })
  await expect(panel.getByLabel('Their email address')).toBeFocused()
  await expect(panel).toContainText(
    `From then on the owners can no longer read ${child}’s private notes`,
  )
  // An address an account has is refused beside the field, where the focus goes, in words that
  // say no more than that it cannot be used here (D-13).
  await panel.getByLabel('Their email address').fill(who.email)
  await panel.getByRole('button', { name: 'Send the link' }).click()
  await expect(panel.getByLabel('Their email address')).toBeFocused()
  await expect(panel.getByLabel('Their email address')).toHaveAccessibleDescription(
    /That address can’t be used here\. Another one can\.$/,
  )
  await panel.getByLabel('Their email address').fill(young.email)
  await expectAccessible(page)
  await panel.getByRole('button', { name: 'Send the link' }).click()
  // Sent, which is said in the form's place as it arrives, and the form's own button went with
  // the form: the focus it held goes to the one that stays, which ends the panel. The status is
  // named by its words: a toast is read out from inside the modal that is open, for a second
  // from when it is raised, so the panel may hold what reads out the PIN's beside its own.
  await expect(
    panel.getByRole('status').filter({
      hasText: `A link is on its way to ${young.email}. It works for 14 days.`,
    }),
  ).toBeVisible()
  const done = panel.getByRole('button', { name: 'Done' })
  await expect(done).toBeFocused()
  await expect(panel.getByRole('button', { name: 'Send the link' })).toHaveCount(0)
  await expectAccessible(page)
  // The mail catcher holds the link, and nothing follows it here.
  expect(await linkToken(young.email, 'graduate')).not.toBe('')
  await done.click()
  await expect(panel).toBeHidden()
  await expectSaid(page, `A link was sent to ${young.email}.`)
  await expect(graduate).toBeFocused()

  // Removing it ends the profile, its PIN and its sign-ins, and tells nobody: nobody is left to.
  await page.getByRole('button', { name: `Remove ${child}`, exact: true }).click()
  const removal = page.getByRole('dialog', { name: `Remove ${child} from ${home}?` })
  await expect(removal).toContainText('The profile, its PIN and its sign-ins end with it')
  await expectAccessible(page)
  await removal.getByRole('button', { name: `Remove ${child} from ${home}` }).click()
  await expect(title(page, 'Members')).toBeVisible()
  await expectSaid(page, `${child} was removed.`)
  await expect(rows(page).filter({ hasText: child })).toHaveCount(0)
})

test('an owner renames the household, moves its country, makes a new code and turns a module off and on', async ({
  page,
}) => {
  // Two panels and two confirmations, each under axe.
  test.slow()
  const { household } = await owner(page)
  await open(page, inHousehold.settings(household))
  await expect(valueOf(page, 'Name')).toHaveText(home)

  // The name: the panel opens on it, and what is saved is drawn wherever the household is named.
  const edit = page.getByRole('button', { name: 'Edit the household' })
  await edit.click()
  const editor = page.getByRole('dialog', { name: 'Edit the household' })
  await expect(editor.getByLabel('Name')).toBeFocused()
  await expect(editor.getByLabel('Name')).toHaveValue(home)
  await expectAccessible(page)
  const renamed = 'Dům č. 9'
  await editor.getByLabel('Name').fill(renamed)
  await editor.getByRole('button', { name: 'Save for everyone' }).click()
  await expect(editor).toBeHidden()
  await expectSaid(page, 'Saved for everyone.')
  await expect(edit).toBeFocused()
  await expect(valueOf(page, 'Name')).toHaveText(renamed)
  await expect(page.getByRole('banner')).toContainText(renamed)
  await expect(sidebar(page)).toContainText(renamed)
  await expect(page.getByText(home)).toHaveCount(0)

  // The country: what the move changes is drawn before any country is chosen.
  await expect(valueOf(page, 'Country')).toHaveText('Czechia')
  const move = page.getByRole('button', { name: 'Change the country' })
  await move.click()
  const mover = page.getByRole('dialog', { name: 'Change the country' })
  await expect(mover.getByRole('heading', { name: 'What this changes' })).toBeVisible()
  await expect(
    mover.getByRole('list', { name: 'What this changes' }).getByRole('listitem'),
  ).toHaveCount(5)
  await expect(mover).toContainText('Nothing already written is changed')
  await expectAccessible(page)
  // Asked for with no country chosen, it is not sent, and the focus is on the field that says so.
  await mover.getByRole('button', { name: 'Change the country' }).click()
  await expect(mover.getByLabel('Move to')).toBeFocused()
  await expect(mover.getByLabel('Move to')).toHaveAccessibleDescription(
    'Choose the country to move to.',
  )
  await mover.getByLabel('Move to').selectOption({ label: 'Slovakia' })
  await mover.getByRole('button', { name: 'Change the country to Slovakia' }).click()
  await expect(mover).toBeHidden()
  await expectSaid(page, 'The country is Slovakia.')
  await expect(move).toBeFocused()
  await expect(valueOf(page, 'Country')).toHaveText('Slovakia')
  // What money is counted in did not move with it.
  await expect(valueOf(page, 'Money is counted in')).toHaveText('CZK')

  // The code: the question names the one that stops working, and the answer the one that works.
  const old = await valueOf(page, 'Code').innerText()
  expect(old).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  const renew = page.getByRole('button', { name: 'Make a new code' })
  await renew.click()
  const question = page.getByRole('dialog', { name: 'Make a new household code?' })
  await expect(question).toContainText(`${old} stops working for new sign-ins.`)
  await expectAccessible(page)
  await question.getByRole('button', { name: 'Make a new code' }).click()
  await expect(question).toBeHidden()
  await expect(valueOf(page, 'Code')).not.toHaveText(old)
  const made = await valueOf(page, 'Code').innerText()
  await expectSaid(page, `The new code is ${made}. ${old} no longer works for new sign-ins.`)
  await expect(renew).toBeFocused()

  // A module: turning it off is asked about, and says for whom its screens go and what stays.
  await settings(page).getByRole('link', { name: 'Modules' }).click()
  await expect(title(page, 'Modules')).toBeVisible()
  const row = rows(page).filter({ hasText: 'Shopping' })
  await expect(row).toContainText('Held by 1 of 1 member')
  await row.getByRole('button', { name: 'Turn off Shopping' }).click()
  const turnOff = page.getByRole('dialog', { name: 'Turn off Shopping for everyone?' })
  await expect(turnOff).toContainText(
    'Its screens, widgets and reminders go for the one person who holds it. Nothing is deleted',
  )
  await expectAccessible(page)
  await turnOff.getByRole('button', { name: 'Turn off Shopping for everyone' }).click()
  await expect(turnOff).toBeHidden()
  await expectSaid(page, 'Shopping is off. Its data is kept.')
  // The row stays where it was, and its control is its opposite under the focus.
  const turnOn = row.getByRole('button', { name: 'Turn on Shopping' })
  await expect(turnOn).toBeFocused()
  await expect(row).toContainText('Off for everybody. Its data is kept.')
  await expectAccessible(page)
  await turnOn.click()
  await expectSaid(page, 'Shopping is on for everyone, and everything in it is back.')
  await expect(row.getByRole('button', { name: 'Turn off Shopping' })).toBeFocused()
  await expect(row).toContainText('Held by 1 of 1 member')
})

// *Conflicted*, for a household's profile and for what a member holds: a change is held against
// the version its page read, and one that another owner got in before is refused with how
// things stand, never laid over it.
test('a change that another owner got in first is not laid over theirs: it is said, with how things stand', async ({
  page,
}) => {
  const { who, household } = await owner(page)
  const member = person(guest)
  const memberId = await join(page, who, household, member)

  // The profile's panel is open on a new name when the household's units are changed elsewhere.
  await open(page, inHousehold.settings(household))
  await page.getByRole('button', { name: 'Edit the household' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit the household' })
  const renamed = 'Dům č. 9'
  await editor.getByLabel('Name').fill(renamed)
  await expect(editor.getByLabel('Units')).toHaveValue('metric')
  await changeMeanwhile(page, `/households/${household}`, { units: 'imperial' })
  const save = editor.getByRole('button', { name: 'Save for everyone' })
  await save.click()
  // Refused, which is said in the panel. It stays open on what was typed, and what nobody
  // here touched reads as the household now stands, in the panel and on the page under it.
  await expect(editor.getByRole('alert')).toContainText('Somebody else changed this just now.')
  await expect(editor.getByLabel('Name')).toHaveValue(renamed)
  await expect(editor.getByLabel('Units')).toHaveValue('imperial')
  await expect(valueOf(page, 'Units')).toHaveText('Imperial')
  await expect(valueOf(page, 'Name')).toHaveText(home)
  await expectAccessible(page)
  // Saved again, it is held against the household the refusal carried, and both changes stand.
  await save.click()
  await expect(editor).toBeHidden()
  await expectSaid(page, 'Saved for everyone.')
  await expect(valueOf(page, 'Name')).toHaveText(renamed)
  await expect(valueOf(page, 'Units')).toHaveText('Imperial')

  // A member's levels: one is lowered here and not yet saved when another is raised elsewhere.
  await page.goto(inHousehold.member(household, memberId))
  const shopping = page.getByLabel('Shopping')
  await shopping.selectOption({ label: 'Off' })
  await changeMeanwhile(page, `/households/${household}/members/${memberId}`, {
    grants: { finance: 'view' },
  })
  await page.getByRole('button', { name: 'Save changes' }).click()
  // Refused, which is said, and nothing of this change is kept to be laid over the other: the
  // rows are as the server holds them, and the focus the button held is on the matrix.
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Somebody else changed this just now. Here is how it stands',
  )
  await expect(shopping).toHaveValue('contribute')
  await expect(page.getByLabel('Finance')).toHaveValue('view')
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: `What ${member.name} holds` })).toBeFocused()
  await expectAccessible(page)
})

interface Second {
  /** The owner who made the household. */
  readonly first: Person
  readonly household: string
  /** Makes the second owner a member again, as the first, from another browser. */
  readonly demote: () => Promise<void>
}

/**
 * A household with a second owner, who is signed in to the page's browser, which has drawn
 * nothing of the app. The first owner's session is kept, and ended by nothing here: it is how
 * they change something from elsewhere while the second's page is open.
 */
async function secondOwner(page: Page, browser: Browser): Promise<Second> {
  const { who, household } = await owner(page)
  const second = person(guest)
  const id = await join(page, who, household, second)
  await makeOwner(page, household, id)
  const session = await page.context().cookies()
  await page.context().clearCookies()
  await signIn(page, second)
  return {
    first: who,
    household,
    demote: async () => {
      const elsewhere = await browser.newContext({ baseURL: previewOrigin })
      await elsewhere.addCookies(session)
      const other = await elsewhere.newPage()
      await other.goto(buildFile)
      await changeMeanwhile(other, `/households/${household}/members/${id}`, { role: 'member' })
      await elsewhere.close()
    },
  }
}

// *Withdrawn*, for the household's profile: an owner is made a member while their panel is
// open. In a browser the panel's closing hands the focus back to the control that opened it,
// which then leaves with every other control: where the focus goes next is a real `<dialog>`'s
// to show, and no stand-in's.
test('an owner made a member while their panel is open is told so as they save, and the controls leave', async ({
  page,
  browser,
}) => {
  const { first, household, demote } = await secondOwner(page, browser)
  await open(page, inHousehold.settings(household))
  await page.getByRole('button', { name: 'Edit the household' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit the household' })
  await editor.getByLabel('Name').fill('Dům č. 9')
  await demote()

  await editor.getByRole('button', { name: 'Save for everyone' }).click()
  // Refused for where they now stand, which is said on the page as it arrives. The panel is
  // closed, the household read again, and no control that changes anything is left.
  await expect(editor).toBeHidden()
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Only an owner can change this, and you are not one any more. Nothing was changed.',
  )
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  await expect(valueOf(page, 'Name')).toHaveText(home)
  await expect(
    page.getByText(`Changing it is for an owner: ${first.name}.`, { exact: false }),
  ).toBeVisible()
  // The code is its owners' to read, and went with the rest.
  await expect(page.getByRole('heading', { name: 'The household code' })).toHaveCount(0)
  // The focus the panel gave back went with the control that held it: it is on the screen's
  // own place, and not dropped to the page.
  await expect(place(page)).toBeFocused()
  await expect(sidebar(page)).toContainText('Member')
  await expectAccessible(page)
})

// A second visit: this browser kept the household as an owner read it, and its member is one
// no longer. The page is drawn from what was kept, then as things stand, and a member whose
// focus was on none of the controls that left keeps their place.
test('a second visit of somebody who was an owner when this browser last read the household settles as a member’s', async ({
  page,
  browser,
}) => {
  const { first, household, demote } = await secondOwner(page, browser)
  await open(page, inHousehold.settings(household))
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(4)
  await expect.poll(() => kept(page)).toContain(JSON.stringify(['households', household]))
  await demote()

  await page.reload()
  await expect(
    page.getByText(`Changing it is for an owner: ${first.name}.`, { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'The household code' })).toHaveCount(0)
  await expect(sidebar(page)).toContainText('Member')
  // Nothing was refused, so nothing is announced, and the focus was moved nowhere.
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(place(page)).not.toBeFocused()
  await expectAccessible(page)
})

// A second visit of somebody who was in no household when this browser last read their list,
// and has joined one since, by an invitation answered elsewhere. Where the app opens goes by
// the list, and a list that names none sends its member to make a household: read a day ago,
// it is read again first.
test('a second visit of somebody who joined a household elsewhere opens at it, and not at making one', async ({
  page,
  browser,
}) => {
  const { household } = await owner(page)
  const invited = person(guest)
  const token = await invite(page, household, invited.email)
  await signOut(page)
  await register(page, invited)
  await signIn(page, invited)
  await open(page, paths.home.path)
  await expect(title(page, 'Set up your household')).toBeVisible()
  await expect.poll(() => kept(page)).toContain(JSON.stringify(['households']))

  // They join from another browser: this one hears nothing of it.
  const elsewhere = await browser.newContext({ baseURL: previewOrigin })
  const other = await elsewhere.newPage()
  await other.goto(buildFile)
  await signIn(other, invited)
  await acceptInvitation(other, token)
  await elsewhere.close()

  await page.goto(paths.home.path)
  await expect(title(page, 'Home')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`${inHousehold.home(household)}$`))
  await expect(sidebar(page)).toContainText('Member')
})

/**
 * What the shell's bar says with no connection: over the household's settings and over
 * leaving, whose changes are made on the server or not at all (D-170), and over any other
 * screen of a household, whose changes are kept and sent.
 */
const offline = {
  settings:
    'Offline — you are reading what this browser kept. Changing anything here needs a connection.',
  elsewhere: 'Offline — changes are saved and will sync',
} as const

/**
 * Whether a fault is the connection's being away, as the browser says each request that found
 * none and the replica's SDK each attempt of its own: a test that takes the connection away has
 * those, and they are its own doing.
 */
function ofNoConnection(fault: string): boolean {
  return /ERR_INTERNET_DISCONNECTED|^\[PowerSync\]: Sync error/.test(fault)
}

// Nothing of a household's settings waits on the device to be sent later (D-80, D-170): a
// member may not come to believe they changed something with no connection.
test('a change pressed with no connection says so at once, and nothing is sent once the connection is back', async ({
  page,
  context,
  faults,
}) => {
  const { household } = await owner(page)
  await open(page, inHousehold.settings(household))
  let asked = 0
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().endsWith(`/households/${household}`)) {
      asked += 1
    }
  })
  await page.getByRole('button', { name: 'Edit the household' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit the household' })
  const renamed = 'Dům č. 9'
  await editor.getByLabel('Name').fill(renamed)

  await context.setOffline(true)
  // The bar says what is so on this screen: a change needs a connection, and none is saved to
  // be sent later, which is what it says everywhere else.
  await expect(page.getByText(offline.settings)).toBeVisible()
  await expect(page.getByText(offline.elsewhere)).toHaveCount(0)
  const save = editor.getByRole('button', { name: 'Save for everyone' })
  await save.click()
  // Asked at once, and not held for a connection: the panel says the server was not reached,
  // keeps what was typed, and its control is theirs again.
  await expect(editor.getByRole('alert')).toContainText('We couldn’t reach Household.')
  await expect(save).not.toHaveAttribute('aria-busy', 'true')
  await expect(editor.getByLabel('Name')).toHaveValue(renamed)
  await expectAccessible(page)

  // The connection is back, and nothing was left waiting for it: the household is called what
  // it was, here and on the server.
  const before = asked
  await context.setOffline(false)
  await frames(page, 10)
  expect(asked).toBe(before)
  const read = await call(page, 'GET', `/households/${household}`)
  expect((read.body as { readonly name?: unknown }).name).toBe(home)

  // Pressed again with somebody at the screen, it is saved.
  await save.click()
  await expect(editor).toBeHidden()
  await expectSaid(page, 'Saved for everyone.')
  await expect(valueOf(page, 'Name')).toHaveText(renamed)
  expect(faults.filter((fault) => !ofNoConnection(fault))).toEqual([])
  faults.length = 0
})

// A second visit, which a browser that kept nothing never makes (ADR 0026): what was read of
// the household is in what this browser kept, and the connection is not there to read it again.
test('a second visit with no connection draws the members from what this browser kept', async ({
  page,
  context,
  faults,
}) => {
  const { who, household } = await owner(page)
  const member = person(guest)
  await join(page, who, household, member)
  await open(page, inHousehold.members(household))
  const listed = rows(page).filter({ hasText: member.name })
  await expect(listed).toContainText('Member')
  await expect
    .poll(() => kept(page))
    .toContain(JSON.stringify(['households', household, 'members']))

  // The connection goes, and the page is opened again. No worker of the app's keeps its own
  // files for a browser with no connection (ADR 0026), so they are given here as a browser that
  // kept them gives them, by a request the suite makes itself: what is away is everything else,
  // the API and the sync service.
  await context.route(
    (address) => address.origin === previewOrigin && !address.pathname.startsWith(`${apiPath}/`),
    async (route) => {
      await route.fulfill({ response: await route.fetch() })
    },
  )
  await context.setOffline(true)
  await page.reload()

  // The list as it was read, with what each member holds, and nothing in the place of it that
  // says it is loading or could not be read.
  await expect(title(page, 'Members')).toBeVisible()
  await expect(page.getByRole('link', { name: `${who.name} (you)` })).toBeVisible()
  await expect(listed).toContainText('Member')
  await expect(listed).toContainText('Can see: Documents, Activity log, and Household settings')
  await expect(listed).toContainText('Off: 5 modules')
  await expect(page.getByText('The member list did not load')).toHaveCount(0)
  // That there is no connection is said once, by the shell's bar, with what is so here: a
  // change needs one.
  const bar = page.getByRole('status')
  await expect(bar).toHaveText(offline.settings)
  await expect(page.getByText('it is changed on the server or not at all')).toHaveCount(0)
  await expectAccessible(page)
  // On a screen whose changes are kept and sent, the same bar says that.
  await sidebar(page).getByRole('link', { name: 'Home' }).click()
  await expect(title(page, 'Home')).toBeVisible()
  await expect(bar).toHaveText(offline.elsewhere)
  await sidebar(page).getByRole('link', { name: 'Household settings' }).click()
  await expect(title(page, 'Household')).toBeVisible()
  await expect(bar).toHaveText(offline.settings)
  expect(faults.filter((fault) => !ofNoConnection(fault))).toEqual([])
  faults.length = 0
})

/** A phone's width, where the screens are read at twice the text's size too. */
const phone = { width: 375, height: 812 }

/** How far the page scrolls sideways, in CSS px: nothing, where its layout holds. */
function sideways(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

/** What each level comes to, in the sentence a row or a group says it in. */
const says = {
  contribute: 'Adding things, editing things, ticking things off.',
  view: 'Everything in it can be read, and nothing changed.',
  none: 'Not in their app at all: no screen, no widget, no search result, no reminder.',
} as const

/**
 * The seventeen modules in the order a matrix lists them, each with the level a member starts
 * at (FR-AC3): what the composer shows before anybody has touched it.
 */
const defaults = [
  ['Dashboard', 'contribute'],
  ['Tasks', 'contribute'],
  ['Reminders', 'contribute'],
  ['Calendar', 'contribute'],
  ['Shopping', 'contribute'],
  ['Chores', 'contribute'],
  ['Notes', 'contribute'],
  ['Chat', 'contribute'],
  ['Pets', 'contribute'],
  ['Documents', 'view'],
  ['Activity log', 'view'],
  ['Household settings', 'view'],
  ['Finance', 'none'],
  ['Utilities', 'none'],
  ['Garden', 'none'],
  ['Property', 'none'],
  ['Vehicles', 'none'],
] as const

// The item's second measure (plan item 26): the matrix is read where an invitation is written
// and where it is answered, and both are a phone's as often as a desk's. Nothing beside a row
// says what its level means but the row itself.
test.describe('at a phone’s width and 200 % text', () => {
  test('the composer’s matrix reads without a legend: a row a module, each saying what its level comes to', async ({
    page,
  }) => {
    const { household } = await owner(page)
    await page.setViewportSize(phone)
    await open(page, inHousehold.invite(household), { scale: '200' })
    const matrix = page.getByRole('list', { name: 'What they get' })
    await expect(matrix.getByRole('listitem')).toHaveCount(defaults.length)
    const controls = matrix.getByRole('combobox')
    for (const [at, [module, level]] of defaults.entries()) {
      const control = controls.nth(at)
      // Household settings is the one row whose level means what no other's does (D-167).
      const sentence = module === 'Household settings' ? settingsSay[level] : says[level]
      // Named for its module, and described by the sentence drawn under it.
      await expect(control).toHaveAccessibleName(module)
      await expect(control).toHaveValue(level)
      await expect(control).toHaveAccessibleDescription(sentence)
      await expect(matrix.getByRole('listitem').nth(at).getByText(sentence)).toBeVisible()
    }

    // A row that is changed says so in the same place, and the way back to the defaults is drawn.
    const finance = matrix.getByRole('combobox', { name: 'Finance' })
    await finance.selectOption({ label: 'Can see' })
    await expect(finance).toHaveAccessibleDescription(`${says.view} Changed from “Off”.`)
    const reset = page.getByRole('button', { name: 'Reset to the defaults' })
    await expect(reset).toBeVisible()

    expect(await sideways(page), 'the page scrolls sideways').toBeLessThanOrEqual(1)
    expect((await inspect(page)).clipped, 'text is clipped').toEqual([])
    expect(await smallTargets(page.locator('body')), 'targets under 44 px').toEqual([])

    // Put back, nothing differs from the defaults and the control that did it goes: the focus
    // it held is on the sentence that counts the levels, which says how they stand.
    await reset.click()
    const counts = page.getByText('Of the seventeen modules:')
    await expect(counts).toBeFocused()
    await expect(counts).toHaveText(
      'Of the seventeen modules: 0 to set up, 9 to add and edit in, 3 to see, 5 off.',
    )
    await expect(finance).toHaveValue('none')
    await expect(reset).toHaveCount(0)
  })

  test('what an invitation gives reads without a legend to whoever is asked: a level, its sentence, its modules', async ({
    page,
  }) => {
    const { invited, token } = await invitation(page)
    await signIn(page, invited)
    await page.setViewportSize(phone)
    await open(page, `${paths.invitation.path}#token=${token}`, { scale: '200' })
    await expect(page.getByRole('button', { name: `Join ${home}` })).toBeVisible()

    // Each level with its count, then what it comes to, then the modules it is held on.
    await expect(page.getByRole('term')).toHaveText([
      'Can add and edit · 9',
      'Can see · 3',
      'Off · 4',
      'Household settings',
    ])
    const groups = page.getByRole('definition')
    await expect(groups.nth(0)).toContainText(says.contribute)
    await expect(groups.nth(0)).toContainText('Dashboard, Tasks, Reminders')
    await expect(groups.nth(1)).toContainText(says.view)
    await expect(groups.nth(1)).toContainText('Finance')
    // The one screen that names what is off, in the reader's own words.
    await expect(groups.nth(2)).toContainText(
      'Not in your app at all: no screen, no widget, no search result, no reminder.',
    )
    await expect(groups.nth(2)).toContainText('Utilities, Garden, Property')
    // And household settings by itself, whose level means what no other's does.
    await expect(groups.nth(3)).toHaveText(settingsSay.view)

    expect(await sideways(page), 'the page scrolls sideways').toBeLessThanOrEqual(1)
    expect((await inspect(page)).clipped, 'text is clipped').toEqual([])
    expect(await smallTargets(page.locator('body')), 'targets under 44 px').toEqual([])
  })
})

interface Asked {
  readonly inviter: Person
  readonly invited: Person
  readonly token: string
}

/**
 * An invitation that waits for somebody who has an account: a member's defaults with Finance to
 * see, and a message. Nobody is signed in to the page's browser when it returns, which has drawn
 * nothing of the app.
 */
async function invitation(page: Page): Promise<Asked> {
  const { who, household } = await owner(page)
  const invited = person(guest)
  const token = await invite(page, household, invited.email, {
    grants: { finance: 'view' },
    message: words,
  })
  await signOut(page)
  await register(page, invited)
  return { inviter: who, invited, token }
}

interface Cast {
  readonly household: string
  /** A member, whom an owner may make an owner or remove. */
  readonly member: string
  /** Another owner, who pays for nothing: whom an owner may make a member again. */
  readonly owner: string
  /** A child profile. */
  readonly child: string
}

/**
 * A household with everybody a control of its screens is drawn for, and an invitation that
 * waits: whoever made it, who pays for it and so neither leaves nor is made a member; a member;
 * two more owners; and a child profile. One of the two owners is signed in to the page's
 * browser, which has drawn nothing of the app: every control is theirs, leaving among them.
 */
async function populated(page: Page): Promise<Cast> {
  const { who, household } = await owner(page)
  const member = await join(page, who, household, person(guest))
  const reader = person('Eliška Nová')
  const second = await join(page, who, household, reader)
  const third = await join(page, who, household, person('Jiří Kůs'))
  await makeOwner(page, household, second)
  await makeOwner(page, household, third)
  const young = await createChild(page, household, child)
  await invite(page, household, person().email)
  await signOut(page)
  await signIn(page, reader)
  return { household, member, owner: third, child: young }
}

/**
 * Goes through a household's screens as they are with somebody in them, and opens each thing
 * they open, handing each to `look` as it stands, the screen first and then what is drawn over
 * it: the two panels and the confirmation of its profile, a module's confirmation and the toast
 * it ends in, the panel that makes a child profile, the questions of a member's page and of an
 * owner's, a child profile's two panels, and the confirmations that withdraw an invitation and
 * that leave. A control is found by where it stands and never by its words, which the
 * pseudo-locale changes.
 */
async function openEach(page: Page, cast: Cast, look: () => Promise<void>): Promise<void> {
  const controls = page.getByRole('main').getByRole('button')
  const dialog = page.getByRole('dialog')
  /** Goes to `address`, and looks at its screen once it has drawn the controls of all it reads. */
  const go = async (address: string, count: number) => {
    await page.goto(address)
    await expect(controls).toHaveCount(count)
    await look()
  }
  /** Opens what `control` opens, looks at it, and puts it away. */
  const each = async (control: Locator) => {
    await control.click()
    await expect(dialog).toBeVisible()
    await look()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    // Put away, it gives the focus back to what it was opened from.
    await expect(control).toBeFocused()
  }

  // The profile: the panel that edits it, the one that moves its country, and, past the control
  // that copies the code, the confirmation of a new one.
  await go(inHousehold.settings(cast.household), 4)
  for (const control of [0, 1, 3]) await each(controls.nth(control))

  // The modules, a control a row: the first one's confirmation, and then the toast that says
  // it is off. It is turned on again, which is said too.
  await go(inHousehold.modules(cast.household), 16)
  await controls.first().click()
  await expect(dialog).toBeVisible()
  await look()
  await dialog.getByRole('button').last().click()
  await expect(dialog).toHaveCount(0)
  await expect(toasts(page)).toHaveCount(1)
  await look()
  await controls.first().click()
  await expect(toasts(page)).toHaveCount(2)

  // The members: the panel that makes a child profile.
  await go(inHousehold.members(cast.household), 1)
  await each(controls.first())

  // A member's page: making them an owner, and removing them. An owner's: making them a member.
  await go(inHousehold.member(cast.household, cast.member), 2)
  for (const control of [0, 1]) await each(controls.nth(control))
  await go(inHousehold.member(cast.household, cast.owner), 2)
  await each(controls.first())

  // A child profile's page: a new PIN, and a sign-in of its own. Its picture and its removal
  // are the two controls after them.
  await go(inHousehold.member(cast.household, cast.child), 4)
  for (const control of [0, 1]) await each(controls.nth(control))

  // The invitations: the one that waits is sent again or withdrawn, and withdrawing asks first.
  await go(inHousehold.invitations(cast.household), 2)
  await each(controls.last())

  // Leaving, which an owner beside another may: its one control asks first.
  await go(inHousehold.leave(cast.household), 1)
  await each(controls.first())
}

for (const theme of ['light', 'dark'] as const) {
  test(`what a household’s screens open is accessible in the ${theme} theme`, async ({ page }) => {
    // Twenty-one passes of axe: one for each screen, and one for each thing opened.
    test.slow()
    const cast = await populated(page)
    await open(page, inHousehold.home(cast.household), { theme })
    await openEach(page, cast, () => expectAccessible(page))
  })

  test(`an invitation is accessible in the ${theme} theme, to a visitor and to whoever it asks`, async ({
    page,
  }) => {
    const { inviter, invited, token } = await invitation(page)
    await open(page, `${paths.invitation.path}#token=${token}`, { theme })
    await expect(title(page, `${inviter.name} has invited you to ${home}`)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sign in to answer' })).toBeVisible()
    await expectAccessible(page)

    // The same link, opened by its addressee signed in.
    await page.goto(buildFile)
    await signIn(page, invited)
    await openLink(page, token)
    await expect(page.getByRole('button', { name: `Join ${home}` })).toBeVisible()
    await expectAccessible(page)
  })
}

test.describe('under the pseudo-locale, where no control has a name a test can spell', () => {
  const clean = { escaped: [], unbalanced: [], clipped: [] }

  test('what a household’s screens open survives', async ({ page }) => {
    test.slow()
    const cast = await populated(page)
    await open(page, inHousehold.home(cast.household), { locale: 'en-XA' })
    await openEach(page, cast, async () => {
      // What was drawn last is in the pseudo-locale's words: a dialog's last control, a toast,
      // or the screen's own last control. A screen's title may be a member's name, which is
      // drawn as it was written.
      const dialog = page.getByRole('dialog')
      const drawn =
        (await dialog.count()) > 0
          ? dialog.getByRole('button').last()
          : (await toasts(page).count()) > 0
            ? toasts(page).last()
            : page.getByRole('main').getByRole('button').last()
      await expect(drawn).toContainText('⟦')
      expect(await inspect(page)).toEqual(clean)
    })
  })

  test('an invitation survives, as a visitor reads it and as whoever it asks does', async ({
    page,
  }) => {
    const { invited, token } = await invitation(page)
    await open(page, `${paths.invitation.path}#token=${token}`, { locale: 'en-XA' })
    // A visitor's two ways on, under what is given.
    await expect(page.getByRole('main').getByRole('link')).toHaveCount(2)
    await expect(page.getByRole('term').first()).toContainText('⟦')
    expect(await inspect(page)).toEqual(clean)
    expect(await sideways(page), 'the page scrolls sideways').toBeLessThanOrEqual(1)

    await page.goto(buildFile)
    await signIn(page, invited)
    await openLink(page, token)
    // A member's two answers.
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(2)
    await expect(page.getByRole('main').getByRole('button').first()).toContainText('⟦')
    expect(await inspect(page)).toEqual(clean)
    expect(await sideways(page), 'the page scrolls sideways').toBeLessThanOrEqual(1)
  })
})

// narrow.spec.ts holds every route to a phone's width as it opens, which is before a panel or a
// confirmation is drawn over it, and in a household of one.
test('what a household’s screens open holds at a phone’s width and 200 % text', async ({
  page,
}) => {
  test.slow()
  const cast = await populated(page)
  await page.setViewportSize(phone)
  await open(page, inHousehold.home(cast.household), { scale: '200' })
  await openEach(page, cast, async () => {
    expect(await sideways(page), 'the page scrolls sideways').toBeLessThanOrEqual(1)
    // A panel or a confirmation scrolls down where it is long, and never sideways.
    for (const opened of await page.getByRole('dialog').all()) {
      expect(
        await opened.evaluate((element) => element.scrollWidth - element.clientWidth),
        'what is open scrolls sideways',
      ).toBeLessThanOrEqual(1)
    }
    expect((await inspect(page)).clipped, 'text is clipped').toEqual([])
    expect(await smallTargets(page.locator('body')), 'targets under 44 px').toEqual([])
  })
})
