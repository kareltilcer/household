// Deleting an account (A-20): where a member stands in each household, resolved as the server
// resolves it, and the screen that states it before the button, takes the confirmation, and
// names what the server says still stands in the way.
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { blockedBy, blocks, standingOf } from './deletion.ts'
import {
  chata,
  createServer,
  jana,
  open,
  problem,
  tilcerovi,
  type HouseholdSummary,
  type Membership,
  type Server,
} from './testing.tsx'

const title = 'Delete your account'

const petr = '0190a000-0000-7000-8000-000000000002'
const adam = '0190a000-0000-7000-8000-000000000003'

function member(
  user: string,
  role: NonNullable<Membership['role']>,
  more: Partial<Membership> = {},
): Membership {
  return { user_id: user, role, is_billing_payer: false, ...more }
}

/** Jana's own household, with nobody else in it. */
const zahrada: HouseholdSummary = {
  id: '0190a000-0000-7000-8000-0000000000a3',
  name: 'Zahrada',
  my_role: 'owner',
  member_count: 1,
}

function withHouseholds(
  server: Server,
  households: readonly HouseholdSummary[],
  members: Readonly<Record<string, readonly Membership[]>> = {},
) {
  server.on('GET /households', () => Response.json({ items: households }))
  for (const [household, items] of Object.entries(members)) {
    server.on(`GET /households/${household}/members`, () => Response.json({ items }))
  }
}

async function deleting(server: Server) {
  const opened = open('/account/delete', server)
  await screen.findByRole('heading', { level: 1, name: title })
  return opened
}

/** The line of the household named `name`: its row of the list. */
async function situation(name: string) {
  const row = (await screen.findByText(name)).closest('li')
  if (row === null) throw new Error(`no row for ${name}`)
  return within(row)
}

const scheduled = {
  id: '0190a000-0000-7000-8000-0000000000d1',
  scope: 'user',
  requested_at: '2026-10-08T07:30:00Z',
  executes_at: '2026-11-07T07:30:00Z',
  cancel_token: 'the-token',
}

describe('where a member stands in a household', () => {
  const me = jana.id

  it('is that it goes with the account, for its only member', () => {
    const standing = standingOf(zahrada, me, [member(me, 'owner')])
    expect(standing).toMatchObject({ kind: 'alone', payer: false })
    expect(blocks(standing, new Set())).toBe(false)
  })

  it('is that it needs another owner or its box, for its only owner among others', () => {
    const standing = standingOf(tilcerovi, me, [
      member(me, 'owner', { is_billing_payer: true }),
      member(petr, 'member'),
      member(adam, 'child'),
    ])
    expect(standing).toMatchObject({ kind: 'sole', payer: true })
    expect(blocks(standing, new Set())).toBe(true)
    expect(blocks(standing, new Set([tilcerovi.id]))).toBe(false)
  })

  it('is that billing is settled first, for a payer whose household goes on', () => {
    const standing = standingOf(tilcerovi, me.toUpperCase(), [
      member(me, 'owner', { is_billing_payer: true }),
      member(petr, 'owner'),
    ])
    expect(standing).toMatchObject({ kind: 'payer' })
    expect(blocks(standing, new Set([tilcerovi.id]))).toBe(true)
  })

  it('is that the membership ends, for anyone else', () => {
    expect(standingOf(chata, me, undefined)).toMatchObject({ kind: 'leaves' })
    const coOwner = standingOf(tilcerovi, me, [member(me, 'owner'), member(petr, 'owner')])
    expect(coOwner).toMatchObject({ kind: 'leaves' })
    expect(blocks(coOwner, new Set())).toBe(false)
  })

  it('reads what a refusal names, and nothing from what is no such document', () => {
    expect(
      blockedBy({
        sole_owned_households: [
          { household_id: tilcerovi.id, name: 'Tilcerovi', member_count: 5 },
          { name: 'no id' },
        ],
        billing_payer_for: [chata.id, 7],
      }),
    ).toEqual({ soleOwned: [{ id: tilcerovi.id, name: 'Tilcerovi' }], payerFor: [chata.id] })
    expect(blockedBy(undefined)).toEqual({ soleOwned: [], payerFor: [] })
    expect(blockedBy({ sole_owned_households: 'x' })).toEqual({ soleOwned: [], payerFor: [] })
  })
})

describe('deleting an account', () => {
  it('states what happens to each household before the button', async () => {
    const server = createServer()
    withHouseholds(server, [tilcerovi, chata, zahrada], {
      [tilcerovi.id]: [member(jana.id, 'owner'), member(petr, 'owner')],
      [zahrada.id]: [member(jana.id, 'owner')],
    })
    await deleting(server)
    expect(
      (await situation('Tilcerovi')).getByText(
        'Your membership ends. What you added stays with the household, shown as a former member’s.',
      ),
    ).toBeInTheDocument()
    expect(
      (await situation('Chata Vysočina')).getByText(/^Your membership ends\./),
    ).toBeInTheDocument()
    expect(
      (await situation('Zahrada')).getByText(
        'It goes with your account: you are its only member. Everything in it is deleted, and nothing else has a copy.',
      ),
    ).toBeInTheDocument()
    // Only the households the member owns are read any further.
    expect(server.to(`GET /households/${chata.id}/members`)).toHaveLength(0)

    // What the server does, and not what the prototype drew: the link cancels it, signing in
    // does not.
    expect(
      screen.getByText(
        /Your account is switched off at once.*For thirty days the link in the email we send you cancels the deletion\. Signing in does not/,
      ),
    ).toBeInTheDocument()
    // The button names the day, thirty days out, and the safe choice comes before it.
    const actions = screen.getByRole('button', { name: /^Schedule deletion for / }).parentElement
    expect(
      within(actions as HTMLElement)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Keep my account', expect.stringMatching(/^Schedule deletion for \w+ \d+, \d{4}$/)])
  })

  it('holds for a household with no other owner, and offers both ways on', async () => {
    const server = createServer()
    withHouseholds(server, [tilcerovi], {
      [tilcerovi.id]: [member(jana.id, 'owner'), member(petr, 'member'), member(adam, 'child')],
    })
    server.on('POST /me/deletion', () => Response.json(scheduled, { status: 202 }))
    const { user, router } = await deleting(server)
    const row = await situation('Tilcerovi')
    expect(
      row.getByText(
        /Somebody else has to be an owner before you can go.*Make someone an owner from the household’s members, or tick the box and it is deleted with your account\./,
      ),
    ).toBeInTheDocument()
    // Making someone an owner is said in words: there is no screen to send the member to yet.
    expect(row.queryByRole('link')).not.toBeInTheDocument()
    // No button that could only be refused.
    expect(screen.queryByRole('button', { name: /^Schedule deletion/ })).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Deletion waits for what is said above, so that no household is left without an owner or a payer.',
      ),
    ).toBeInTheDocument()

    await user.click(row.getByRole('checkbox', { name: 'Delete Tilcerovi with my account' }))
    expect(
      row.getByText(
        /^It is scheduled for deletion with your account, and its members are told now\./,
      ),
    ).toBeInTheDocument()
    await user.type(screen.getByLabelText('Password'), 'the password')
    await user.click(screen.getByRole('button', { name: /^Schedule deletion for / }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/account/deletion/cancel')
    })
    expect(await server.body('POST /me/deletion')).toEqual({
      password_or_confirmation: 'the password',
      delete_sole_owned_households: [tilcerovi.id],
    })
    // The page that offers to keep the account is told the token and the day.
    const kept = new URLSearchParams(router.state.location.hash.slice(1))
    expect(kept.get('token')).toBe('the-token')
    expect(kept.get('at')).toBe('2026-11-07T07:30:00Z')
    expect(router.state.location.hash.startsWith('#token=')).toBe(true)
  })

  it('asks who is signed in once it is scheduled, and not before the next page is open', async () => {
    const server = createServer()
    withHouseholds(server, [])
    server.on('POST /me/deletion', () => {
      // Every session has ended, the one that asked among them.
      server.on('GET /me', () => problem(401, 'unauthenticated'))
      return Response.json({ ...scheduled, cancel_token: null }, { status: 202 })
    })
    const { user, router } = await deleting(server)
    expect(
      await screen.findByText('You are in no household, so only your account goes.'),
    ).toBeInTheDocument()
    const before = server.to('GET /me').length
    await user.type(screen.getByLabelText('Password'), 'the password')
    await user.click(screen.getByRole('button', { name: /^Schedule deletion for / }))
    await waitFor(() => {
      expect(server.to('GET /me').length).toBeGreaterThan(before)
    })
    // Not sent to sign in: the page that says when the account closes is where it stays.
    expect(router.state.location.pathname).toBe('/account/deletion/cancel')
    // With no token to hand on, the day alone.
    expect(router.state.location.hash).toBe(
      `#${new URLSearchParams({ at: '2026-11-07T07:30:00Z' }).toString()}`,
    )
    expect(await server.body('POST /me/deletion')).toEqual({
      password_or_confirmation: 'the password',
      delete_sole_owned_households: [],
    })
  })

  it('holds a payer until billing is settled', async () => {
    const server = createServer()
    withHouseholds(server, [tilcerovi], {
      [tilcerovi.id]: [member(jana.id, 'owner', { is_billing_payer: true }), member(petr, 'owner')],
    })
    await deleting(server)
    expect(
      (await situation('Tilcerovi')).getByText(
        'You pay for it. Hand billing over to another owner, or cancel the subscription, before you go: otherwise it would go on with nobody paying.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Schedule deletion/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep my account' })).toBeInTheDocument()
  })

  it('says both at once to a sole owner who also pays', async () => {
    const server = createServer()
    withHouseholds(server, [tilcerovi], {
      [tilcerovi.id]: [
        member(jana.id, 'owner', { is_billing_payer: true }),
        member(petr, 'member'),
      ],
    })
    const { user } = await deleting(server)
    const row = await situation('Tilcerovi')
    expect(row.getByText(/^You are its only owner/)).toBeInTheDocument()
    expect(row.getByText(/^You also pay for it:/)).toBeInTheDocument()
    // Chosen to go with the account, what is left is a subscription that may still renew.
    await user.click(row.getByRole('checkbox', { name: 'Delete Tilcerovi with my account' }))
    expect(
      row.getByText(/If its subscription is still set to renew, cancel it first/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Schedule deletion for / })).toBeInTheDocument()
  })

  it('names every household the server says stands in the way, and reads them again', async () => {
    const server = createServer()
    withHouseholds(server, [tilcerovi, zahrada], {
      [tilcerovi.id]: [member(jana.id, 'owner'), member(petr, 'owner')],
      [zahrada.id]: [member(jana.id, 'owner', { is_billing_payer: true })],
    })
    server.on('POST /me/deletion', () =>
      problem(409, 'account_deletion_blocked', {
        sole_owned_households: [{ household_id: tilcerovi.id, name: 'Tilcerovi', member_count: 5 }],
        billing_payer_for: [zahrada.id],
      }),
    )
    const { user } = await deleting(server)
    await situation('Zahrada')
    const read = server.to('GET /households').length
    await user.type(screen.getByLabelText('Password'), 'the password')
    await user.click(screen.getByRole('button', { name: /^Schedule deletion for / }))
    expect(await screen.findByText('Deletion is waiting for these')).toBeInTheDocument()
    expect(
      screen.getByText('Tilcerovi: somebody else has to be an owner, or its box has to be ticked.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Zahrada: hand billing over, or cancel the subscription, first.'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(server.to('GET /households').length).toBeGreaterThan(read)
    })
  })

  it('says a wrong password is wrong, and deletes nothing', async () => {
    const server = createServer()
    withHouseholds(server, [])
    server.on('POST /me/deletion', () => problem(401, 'invalid_credentials'))
    const { user, router } = await deleting(server)
    const password = await screen.findByLabelText('Password')
    await user.click(screen.getByRole('button', { name: /^Schedule deletion for / }))
    expect(password).toHaveAccessibleDescription(expect.stringContaining('Enter your password.'))
    expect(server.to('POST /me/deletion')).toHaveLength(0)

    await user.type(password, 'not it')
    await user.click(screen.getByRole('button', { name: /^Schedule deletion for / }))
    await waitFor(() => {
      expect(password).toHaveAccessibleDescription(
        expect.stringContaining('That isn’t your password.'),
      )
    })
    expect(router.state.location.pathname).toBe('/account/delete')
  })

  it('takes the account’s own address from an account with no password', async () => {
    const server = createServer({ ...jana, credentials: ['google'] })
    withHouseholds(server, [])
    server.on('POST /me/deletion', () => Response.json(scheduled, { status: 202 }))
    const { user, router } = await deleting(server)
    const confirm = await screen.findByRole('textbox', {
      name: 'Type your email address to confirm',
    })
    expect(confirm).toHaveAccessibleDescription(
      expect.stringContaining('its own address confirms it: jana@tilcerovi.cz'),
    )
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()

    await user.type(confirm, 'petr@tilcerovi.cz')
    await user.click(screen.getByRole('button', { name: /^Schedule deletion for / }))
    expect(confirm).toHaveAccessibleDescription(
      expect.stringContaining('That isn’t this account’s address.'),
    )
    // Not sent to be counted as a failed sign-in.
    expect(server.to('POST /me/deletion')).toHaveLength(0)

    await user.clear(confirm)
    await user.type(confirm, ' Jana@Tilcerovi.cz ')
    await user.click(screen.getByRole('button', { name: /^Schedule deletion for / }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/account/deletion/cancel')
    })
    expect(await server.body('POST /me/deletion')).toMatchObject({
      password_or_confirmation: 'Jana@Tilcerovi.cz',
    })
  })

  it('gives a refusal and a wait a sentence each', async () => {
    const server = createServer()
    withHouseholds(server, [])
    server.on('POST /me/deletion', () => problem(403, 'forbidden'))
    const { user } = await deleting(server)
    await user.type(await screen.findByLabelText('Password'), 'the password')
    await user.click(screen.getByRole('button', { name: /^Schedule deletion for / }))
    expect(
      await screen.findByText('This account can’t be deleted from here. Nothing was changed.'),
    ).toBeInTheDocument()

    server.on('POST /me/deletion', () => problem(429, 'rate_limited', {}, { 'Retry-After': '600' }))
    await user.click(screen.getByRole('button', { name: /^Schedule deletion for / }))
    expect(await screen.findByText(/^Too many attempts\. Try again at \d/)).toBeInTheDocument()
  })

  it('says the households could not be read, and offers no deletion blind', async () => {
    const server = createServer()
    withHouseholds(server, [tilcerovi])
    server.on(`GET /households/${tilcerovi.id}/members`, () =>
      Promise.reject(new TypeError('offline')),
    )
    const { user } = await deleting(server)
    expect(
      await screen.findByText(/^Without them, what deleting your account would do can’t be said\./),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Schedule deletion/ })).not.toBeInTheDocument()
    server.on(`GET /households/${tilcerovi.id}/members`, () =>
      Response.json({ items: [member(jana.id, 'owner'), member(petr, 'owner')] }),
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('button', { name: /^Schedule deletion for / }),
    ).toBeInTheDocument()
  })

  it('keeps the account when the member says so', async () => {
    const server = createServer()
    withHouseholds(server, [])
    const { user, router } = await deleting(server)
    await user.click(await screen.findByRole('button', { name: 'Keep my account' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/account')
    })
    expect(server.to('POST /me/deletion')).toHaveLength(0)
  })

  it('is not a child profile’s to do', async () => {
    const server = createServer({
      ...jana,
      email: null,
      is_child: true,
      credentials: ['child_pin'],
    })
    await deleting(server)
    expect(
      screen.getByText(
        'A child profile is removed by an owner of its household, from the household’s members.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(server.to('GET /households')).toHaveLength(0)
  })
})
