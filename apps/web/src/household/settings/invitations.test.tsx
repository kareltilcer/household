// The invitations a household sent, and the inviter's notice of one that was declined (A-25):
// what each row says, who is drawn the controls, what withdrawing and sending again ask of the
// server and say afterwards, and what a member reads who may only read, or may not.
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { inHousehold } from '../../app/paths.ts'
import { defaultsFor } from '../grants.ts'
import {
  accountOf,
  adam,
  createServer,
  holding,
  home,
  invitation,
  jana,
  klara,
  memberOf,
  noContent,
  open,
  petr,
  problem,
  readBy,
  tilcerovi,
  type HouseholdServer,
} from '../testing.tsx'
import {
  againState,
  declinedNotices,
  readAgain,
  settledAddresses,
  statusAt,
} from './invitations.ts'

// A test that says the page is looked at again leaves the next one a page nobody has looked at,
// and one that takes the connection away leaves the next one a browser that has it.
afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

const at = inHousehold.invitations(home)
const invitations = `/households/${home}/invitations`
const id = (last: number) => `0190a000-0000-7000-8000-0000000000c${String(last)}`

/** Half past eleven at night in UTC on the fourteenth: the fifteenth already, in Prague. */
const later = '2099-01-14T23:30:00Z'
const earlier = '2020-01-10T12:00:00Z'

const waiting = invitation({ id: id(1), expires_at: later })
const joined = invitation({
  id: id(2),
  email: 'teta@example.cz',
  status: 'accepted',
  uses: 1,
  expires_at: later,
})
const declined = invitation({
  id: id(3),
  email: 'petr@example.cz',
  status: 'declined',
  expires_at: later,
  grants: { ...defaultsFor('member'), finance: 'view' },
})
const revoked = invitation({
  id: id(4),
  email: 'soused@example.cz',
  status: 'revoked',
  expires_at: later,
})
const expired = invitation({
  id: id(5),
  email: 'stryc@example.cz',
  status: 'expired',
  expires_at: earlier,
})
const link = invitation({
  id: id(6),
  kind: 'link',
  email: null,
  max_uses: 4,
  uses: 2,
  expires_at: later,
})

const readOnly = {
  ...tilcerovi,
  entitlement: { state: 'read_only', can_write: false, can_upload: false },
} as const

async function list(server: HouseholdServer = createServer()) {
  const opened = open(at, server)
  await screen.findByRole('heading', { level: 1 })
  return opened
}

/** The row of the invitation for `who`: an address, or what a link is called. */
async function rowOf(who: string): Promise<HTMLElement> {
  const row = (await screen.findByText(who)).closest('li')
  if (row === null) throw new Error(`${who} is on no row`)
  return row
}

const sent = () => screen.getByRole('list', { name: 'Invitations' })

describe('the invitations a household sent', () => {
  it('is titled for what it shows, and says what it is', async () => {
    await list()
    expect(screen.getByRole('heading', { level: 1, name: 'Invitations' })).toBeInTheDocument()
    await waitFor(() => {
      expect(document.title).toBe('Invitations · Household')
    })
    expect(
      screen.getByText('Everybody this household has invited, and what became of each invitation.'),
    ).toBeInTheDocument()
  })

  it('says of each whom it is for, as what, how it stands, who sent it and what it gives', async () => {
    const server = createServer()
    server.invitations = [waiting, joined, declined, revoked, expired]
    await list(server)
    const row = await rowOf('babicka@example.cz')
    expect(within(row).getByText('Member')).toBeInTheDocument()
    // The day it runs out on is said in the member's own zone, whatever this device's is.
    expect(within(row).getByText('Waiting · expires Jan 15, 2099')).toBeInTheDocument()
    expect(within(row).getByText('Sent by Jana Tilcerová · Jan 1, 2099')).toBeInTheDocument()
    expect(
      within(row).getByText(
        /^Can add and edit: Dashboard, Tasks, Reminders, Calendar, Shopping, Chores, Notes, Chat,? and Pets$/,
      ),
    ).toBeInTheDocument()
    expect(
      within(row).getByText(/^Can see: Documents, Activity log,? and Household settings$/),
    ).toBeInTheDocument()
    expect(within(row).getByText('Off: 5 modules')).toBeInTheDocument()

    expect(within(await rowOf('teta@example.cz')).getByText('Joined')).toBeInTheDocument()
    expect(within(await rowOf('petr@example.cz')).getByText('Declined')).toBeInTheDocument()
    expect(within(await rowOf('soused@example.cz')).getByText('Withdrawn')).toBeInTheDocument()
    expect(
      within(await rowOf('stryc@example.cz')).getByText('Expired on Jan 10, 2020'),
    ).toBeInTheDocument()
    // Newest first, as the server answers them.
    expect([...sent().children].map((each) => each.querySelector('span')?.textContent)).toEqual([
      'babicka@example.cz',
      'teta@example.cz',
      'petr@example.cz',
      'soused@example.cz',
      'stryc@example.cz',
    ])
    // The contract's own words for a status and a level are drawn nowhere.
    expect(document.body).not.toHaveTextContent(
      /\b(pending|accepted|revoked|none|view|contribute|manage)\b/,
    )
  })

  it('reads one still said to be waiting whose time has passed as expired', async () => {
    const server = createServer()
    server.invitations = [invitation({ status: 'pending', expires_at: earlier })]
    await list(server)
    const row = await rowOf('babicka@example.cz')
    expect(within(row).getByText('Expired on Jan 10, 2020')).toBeInTheDocument()
    expect(within(row).queryByText(/^Waiting/)).not.toBeInTheDocument()
  })

  it('says of a link that it names nobody, and how many of how many have joined by it', async () => {
    const server = createServer()
    server.invitations = [link, invitation({ id: id(7), kind: 'link', email: null, role: 'owner' })]
    await list(server)
    await screen.findByRole('list', { name: 'Invitations' })
    const several = [...sent().children][0] as HTMLElement
    expect(within(several).getByText('A link, passed on by hand')).toBeInTheDocument()
    expect(within(several).getByText('Joined with this link: 2 of 4')).toBeInTheDocument()
    // A link has no address to send to again, and is withdrawn by the day it was made.
    expect(within(several).queryByRole('button', { name: /^Send again/ })).not.toBeInTheDocument()
    expect(
      within(several).getByRole('button', { name: 'Withdraw the link made on Jan 1, 2099' }),
    ).toBeInTheDocument()
    // One that takes one account says nothing of how many.
    const single = [...sent().children][1] as HTMLElement
    expect(within(single).getByText('Owner')).toBeInTheDocument()
    expect(within(single).queryByText(/^Joined with this link/)).not.toBeInTheDocument()
  })

  it('says a sender who has left is a former member', async () => {
    const server = createServer()
    server.invitations = [
      invitation({
        expires_at: later,
        invited_by: { user_id: petr, label: 'Petr Tilcer', is_former_member: true },
      }),
    ]
    await list(server)
    expect(
      await screen.findByText('Sent by Petr Tilcer, who is no longer a member · Jan 1, 2099'),
    ).toBeInTheDocument()
  })

  it('gives an owner the way to invite somebody, and each row its own controls', async () => {
    const server = createServer()
    server.invitations = [waiting, joined, declined, revoked, expired]
    await list(server)
    await rowOf('babicka@example.cz')
    expect(screen.getByRole('link', { name: 'Invite somebody' })).toHaveAttribute(
      'href',
      inHousehold.invite(home),
    )
    const controls = async (who: string) =>
      within(await rowOf(who))
        .queryAllByRole('button')
        .map((button) => button.textContent)
    const again = (who: string) => `Send again to ${who}Send again`
    const withdraw = (who: string) => `Withdraw the invitation to ${who}Withdraw`
    expect(await controls('babicka@example.cz')).toEqual([
      again('babicka@example.cz'),
      withdraw('babicka@example.cz'),
    ])
    // Somebody joined by it: it is a membership now, and nothing of an invitation's is left.
    expect(await controls('teta@example.cz')).toEqual([])
    expect(await controls('petr@example.cz')).toEqual([
      again('petr@example.cz'),
      withdraw('petr@example.cz'),
    ])
    // Withdrawn already: it can be sent again, which opens it.
    expect(await controls('soused@example.cz')).toEqual([again('soused@example.cz')])
    expect(await controls('stryc@example.cz')).toEqual([
      again('stryc@example.cz'),
      withdraw('stryc@example.cz'),
    ])
  })

  it('reads the same list to a member who can see it, without a control on it', async () => {
    const server = createServer(accountOf(petr))
    server.invitations = [waiting, declined]
    await list(server)
    expect(within(await rowOf('babicka@example.cz')).getByText(/^Waiting/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Invite somebody' })).not.toBeInTheDocument()
    // The notice of a decline is its inviter's kind: an owner's.
    expect(screen.queryByText(/declined the invitation$/)).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'You can read everything here. Changing it is for an owner: Jana Tilcerová.',
      ),
    ).toBeInTheDocument()
  })

  it('is not available to a member who holds nothing on household settings, and asks nothing', async () => {
    const server = createServer(accountOf(klara))
    await list(server)
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link doesn’t open anything here.' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute(
      'href',
      inHousehold.home(home),
    )
    expect(server.to(`GET ${invitations}`)).toHaveLength(0)
  })

  // A child profile's default on household settings is nothing (FR-AC4).
  it('is not available to a child profile, and asks nothing', async () => {
    const server = createServer(accountOf(adam))
    await list(server)
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link doesn’t open anything here.' }),
    ).toBeInTheDocument()
    expect(server.to(`GET ${invitations}`)).toHaveLength(0)
  })

  it('reads in a read-only household, to its owner too, with nothing to press', async () => {
    const server = createServer()
    server.household = readOnly
    server.invitations = [waiting, declined]
    await list(server)
    await rowOf('babicka@example.cz')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Invite somebody' })).not.toBeInTheDocument()
    // The decline is still said; the way to ask again is a write, and is not drawn.
    expect(screen.getByText('petr@example.cz declined the invitation')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Invite .* again$/ })).not.toBeInTheDocument()
    expect(screen.getByText(/^Read-only: nothing here can be changed/)).toBeInTheDocument()
  })

  it('teaches what an invitation takes where none was sent, with the way to send one', async () => {
    await list()
    expect(await screen.findByText('No invitations yet.')).toBeInTheDocument()
    expect(screen.getByText('Example')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Grandma’s email address, and seventeen answers about what she gets that are already filled in.',
      ),
    ).toBeInTheDocument()
    // One action, and not the same one twice.
    expect(screen.getAllByRole('link', { name: 'Invite somebody' })).toHaveLength(1)
  })

  it('teaches a member who only reads the same, with nothing to press', async () => {
    await list(createServer(accountOf(petr)))
    expect(await screen.findByText('No invitations yet.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Invite somebody' })).not.toBeInTheDocument()
  })

  it('draws the list’s shape while it is read', async () => {
    const server = createServer()
    server.on(`GET ${invitations}`, () => new Promise<Response>(() => undefined))
    await list(server)
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('says the list did not load and that nothing was sent, and reads it again', async () => {
    const server = createServer()
    server.on(`GET ${invitations}`, () => Promise.reject(new TypeError('offline')))
    const { user } = await list(server)
    expect(await screen.findByText('The invitations did not load')).toBeInTheDocument()
    expect(screen.getByText('Nothing was sent, and nothing was withdrawn.')).toBeInTheDocument()
    server.on(`GET ${invitations}`, () => Response.json({ items: [waiting] }))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await rowOf('babicka@example.cz')).toBeInTheDocument()
  })

  // A read that waits for a connection is no read under way: nothing is kept, and it is said.
  it('says a list it cannot ask for could not be read, and draws no skeleton', async () => {
    const server = createServer()
    server.invitations = [waiting]
    // The connection goes once the household has been read, and before its invitations are. It
    // goes once: the household is asked for again when the test gives the connection back.
    let gone = false
    server.on(`GET /households/${home}`, () => {
      if (!gone) onlineManager.setOnline(false)
      gone = true
      return Response.json(server.household)
    })
    await list(server)
    expect(await screen.findByText('The invitations did not load')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    expect(server.to(`GET ${invitations}`)).toHaveLength(0)
  })

  it('says that access changed when the list is refused after it was read', async () => {
    const server = createServer(accountOf(petr))
    server.invitations = [waiting]
    await list(server)
    await rowOf('babicka@example.cz')

    // An owner lowers what Petr holds on household settings while he is looking at the list.
    server.household = readBy({
      ...memberOf(petr),
      grants: holding({ dashboard: 'view', utilities: 'manage', shopping: 'contribute' }),
    })
    server.on(`GET ${invitations}`, () => problem(404, 'not_found'))
    act(() => {
      focusManager.setFocused(true)
    })
    const sentence =
      'Your access changed, so this is no longer part of your app. Nobody deleted anything.'
    // It arrived while he was here: said, and not only drawn.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(sentence)
    })
    expect(screen.queryByText('babicka@example.cz')).not.toBeInTheDocument()
    // The household is read again, and the way to the invitations goes with the level.
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Invitations' })).not.toBeInTheDocument()
    })
    // He was here when it changed: he is told so, and not shown a screen that never was.
    expect(screen.getByText(sentence)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Invitations' })).toBeInTheDocument()
  })
})

describe('the notice of an invitation that was declined', () => {
  it('tells an owner who declined, what that came to, and how it is put away', async () => {
    const server = createServer()
    server.invitations = [waiting, declined]
    await list(server)
    const title = await screen.findByText('petr@example.cz declined the invitation')
    expect(
      screen.getByText(
        'Nothing was shared with them, and the invitation is closed. If it was the access that gave them pause, you can invite them again with different modules: they see the whole list before they answer. Withdrawing the invitation below puts this notice away.',
      ),
    ).toBeInTheDocument()
    // It was so when the screen opened: read in its place, and announced as nothing that arrived.
    expect(title.closest('[role="status"], [role="alert"]')).toBeNull()
    // No date of the decline, which the contract does not keep, and nothing to dismiss it by.
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument()
  })

  it('opens the composer filled in from the one that was declined', async () => {
    const server = createServer()
    server.invitations = [declined]
    const { user, router } = await list(server)
    await user.click(await screen.findByRole('link', { name: 'Invite petr@example.cz again' }))
    await screen.findByRole('heading', { level: 1, name: 'Invite somebody' })
    expect(router.state.location.pathname).toBe(inHousehold.invite(home))
    expect(screen.getByRole('radio', { name: 'By email, to one person' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Their email address' })).toHaveValue(
      'petr@example.cz',
    )
    expect(screen.getByRole('radio', { name: 'Member' })).toBeChecked()
    // What it proposed, held against the defaults: the one row that differed says so.
    const finance = screen.getByRole('combobox', { name: 'Finance' })
    expect(finance).toHaveValue('view')
    expect(finance).toHaveAccessibleDescription(expect.stringContaining('Changed from “Off”.'))
    expect(screen.getByRole('combobox', { name: 'Tasks' })).toHaveValue('contribute')
  })

  it('says of a link that somebody who had it declined, and offers another', async () => {
    const server = createServer()
    server.invitations = [{ ...link, status: 'declined' }]
    const { user } = await list(server)
    expect(
      await screen.findByText(/^Somebody who had the link made on .+ declined$/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/^Nothing was shared with them, and the link is closed for everybody/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Make another link' }))
    await screen.findByRole('heading', { level: 1, name: 'Invite somebody' })
    expect(screen.getByRole('radio', { name: 'By a link I send myself' })).toBeChecked()
    expect(screen.queryByRole('textbox', { name: 'Their email address' })).not.toBeInTheDocument()
  })

  // Asked again, the address has an invitation waiting: the decline is news no longer, and the
  // one to send again is the one that waits.
  it('is put away once the address has been asked again', async () => {
    const server = createServer()
    server.invitations = [
      invitation({ id: id(8), email: 'Petr@Example.cz', expires_at: later }),
      declined,
    ]
    await list(server)
    const old = await rowOf('petr@example.cz')
    expect(screen.queryByText(/declined the invitation$/)).not.toBeInTheDocument()
    expect(within(old).getByText('Declined')).toBeInTheDocument()
    expect(within(old).queryByRole('button', { name: /^Send again/ })).not.toBeInTheDocument()
    expect(
      within(old).getByRole('button', { name: 'Withdraw the invitation to petr@example.cz' }),
    ).toBeInTheDocument()
  })

  // Somebody who joined by an invitation and has left since is no member. Asked again, their
  // decline is told as anybody's is, and their invitation is sent again as anybody's is: the
  // invitation they once joined by says who came, and not who is here.
  it('tells of a decline by somebody who was a member once, and offers to send it again', async () => {
    const server = createServer()
    server.invitations = [invitation({ ...declined, id: id(9), email: 'teta@example.cz' }), joined]
    await list(server)
    expect(await screen.findByText('teta@example.cz declined the invitation')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Invite teta@example.cz again' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Send again to teta@example.cz' }),
    ).toBeInTheDocument()
  })

  // A member's address is invited nowhere: whoever declined at one is in by now, by a link or
  // by an invitation this list no longer holds, and the server would send them nothing.
  it('is put away where the address is a member’s by now', async () => {
    const server = createServer()
    server.invitations = [invitation({ ...declined, email: 'Klara@Example.cz' })]
    await list(server)
    const row = await rowOf('Klara@Example.cz')
    // Once the members are read: until then nothing says whose the address is.
    await waitFor(() => {
      expect(screen.queryByText(/declined the invitation$/)).not.toBeInTheDocument()
    })
    expect(within(row).queryByRole('button', { name: /^Send again/ })).not.toBeInTheDocument()
    expect(
      within(row).getByRole('button', { name: 'Withdraw the invitation to Klara@Example.cz' }),
    ).toBeInTheDocument()
  })

  // One that still waits for somebody who came in by another way meanwhile, a link, is sent to
  // nobody: the server would answer that nothing is there to send. It is withdrawn as any is.
  it('offers no sending again of one that waits for an address that is a member’s by now', async () => {
    const server = createServer()
    server.invitations = [invitation({ ...waiting, email: 'Klara@Example.cz' })]
    await list(server)
    const row = await rowOf('Klara@Example.cz')
    // Once the members are read: until then nothing says whose the address is.
    await waitFor(() => {
      expect(within(row).queryByRole('button', { name: /^Send again/ })).not.toBeInTheDocument()
    })
    expect(
      within(row).getByRole('button', { name: 'Withdraw the invitation to Klara@Example.cz' }),
    ).toBeInTheDocument()
  })

  // Asked again and declined again, the address is answered for by the invitation that asked
  // last: one notice, and not the earlier one back beside it.
  it('is one for an address that declined twice, of the invitation that asked last', async () => {
    const server = createServer()
    server.invitations = [
      invitation({ ...declined, id: id(9), grants: defaultsFor('member') }),
      declined,
    ]
    const { user } = await list(server)
    expect(await screen.findAllByText('petr@example.cz declined the invitation')).toHaveLength(1)
    await user.click(screen.getByRole('link', { name: 'Invite petr@example.cz again' }))
    await screen.findByRole('heading', { level: 1, name: 'Invite somebody' })
    // What the last one proposed, and not what the first did.
    expect(screen.getByRole('combobox', { name: 'Finance' })).toHaveValue('none')
  })
})

describe('withdrawing an invitation', () => {
  it('asks first, naming whom, then withdraws it and says so, the focus on the list', async () => {
    const server = createServer()
    server.invitations = [waiting]
    server.on(`DELETE ${invitations}/${id(1)}`, () => {
      server.invitations = [{ ...waiting, status: 'revoked' }]
      return noContent()
    })
    const { user } = await list(server)
    await user.click(
      await screen.findByRole('button', { name: 'Withdraw the invitation to babicka@example.cz' }),
    )
    const dialog = screen.getByRole('dialog', {
      name: 'Withdraw the invitation to babicka@example.cz?',
    })
    expect(dialog).toHaveAccessibleDescription(
      'The link in it stops working at once. Nothing else changes: nobody is removed, and you can invite them again.',
    )
    // The safe choice first, then the one that names what it withdraws.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Keep it', 'Withdraw the invitation to babicka@example.cz'])
    await user.click(
      within(dialog).getByRole('button', { name: 'Withdraw the invitation to babicka@example.cz' }),
    )

    expect(
      await screen.findByText(
        'The invitation to babicka@example.cz is withdrawn. Its link no longer works.',
      ),
    ).toBeInTheDocument()
    expect(server.to(`DELETE ${invitations}/${id(1)}`)).toHaveLength(1)
    // The list is read again: the row stays, and says how it stands now.
    const row = await rowOf('babicka@example.cz')
    expect(await within(row).findByText('Withdrawn')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The control the question was opened from is gone, and the focus the question gave back
    // with it: it is on the list's own place, and not dropped to the page.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(sent())
  })

  it('says of a link that it stops working for everybody who has it', async () => {
    const server = createServer()
    server.invitations = [link]
    server.on(`DELETE ${invitations}/${id(6)}`, noContent)
    const { user } = await list(server)
    await user.click(await screen.findByRole('button', { name: /^Withdraw the link made on/ }))
    const dialog = screen.getByRole('dialog', { name: 'Withdraw this link?' })
    expect(dialog).toHaveAccessibleDescription(
      'It stops working at once, for everybody who has it. Nothing else changes: whoever has joined with it stays.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw this link' }))
    expect(
      await screen.findByText('The link is withdrawn. It no longer works.'),
    ).toBeInTheDocument()
  })

  it('keeps one the owner says to keep', async () => {
    const server = createServer()
    server.invitations = [waiting]
    const { user } = await list(server)
    await user.click(
      await screen.findByRole('button', { name: 'Withdraw the invitation to babicka@example.cz' }),
    )
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep it' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.to(`DELETE ${invitations}/${id(1)}`)).toHaveLength(0)
  })

  it('says one that somebody joined by meanwhile is no longer there to withdraw', async () => {
    const server = createServer()
    server.invitations = [waiting]
    server.on(`DELETE ${invitations}/${id(1)}`, () => {
      server.invitations = [{ ...waiting, status: 'accepted', uses: 1 }]
      return problem(404, 'not_found')
    })
    const { user } = await list(server)
    await user.click(
      await screen.findByRole('button', { name: 'Withdraw the invitation to babicka@example.cz' }),
    )
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Withdraw the invitation to babicka@example.cz',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That is no longer there to change. The page shows how things stand now.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await within(await rowOf('babicka@example.cz')).findByText('Joined')).toBeInTheDocument()
    await waitFor(() => {
      expect(document.activeElement).toContainElement(sent())
    })
  })

  it('says a withdrawal could not reach the server, and leaves the question open', async () => {
    const server = createServer()
    server.invitations = [waiting]
    server.on(`DELETE ${invitations}/${id(1)}`, () => Promise.reject(new TypeError('offline')))
    const { user } = await list(server)
    await user.click(
      await screen.findByRole('button', { name: 'Withdraw the invitation to babicka@example.cz' }),
    )
    const dialog = screen.getByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Withdraw the invitation to babicka@example.cz' }),
    )
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^We couldn’t reach Household\./,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('tells a member who is an owner no longer, and draws the list as they read it now', async () => {
    const server = createServer()
    server.invitations = [waiting]
    server.on(`DELETE ${invitations}/${id(1)}`, () => {
      server.household = readBy({ ...memberOf(jana.id), role: 'member' })
      return problem(403, 'forbidden')
    })
    const { user } = await list(server)
    await user.click(
      await screen.findByRole('button', { name: 'Withdraw the invitation to babicka@example.cz' }),
    )
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Withdraw the invitation to babicka@example.cz',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an owner can change this, and you are not one any more. Nothing was changed.',
    )
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
    expect(within(await rowOf('babicka@example.cz')).getByText(/^Waiting/)).toBeInTheDocument()
    await waitFor(() => {
      expect(document.activeElement).toContainElement(sent())
    })
  })

  it('keeps the focus on the list when the controls leave it with nothing pressed', async () => {
    const server = createServer()
    server.invitations = [waiting]
    await list(server)
    const control = await screen.findByRole('button', {
      name: 'Withdraw the invitation to babicka@example.cz',
    })
    act(() => {
      control.focus()
    })
    // Made a member by another owner: the page is looked at again, and reads it.
    server.household = readBy({ ...memberOf(jana.id), role: 'member' })
    act(() => {
      focusManager.setFocused(true)
    })
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(sent())
    // Nothing was pressed, so nothing was refused.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('sending an invitation again', () => {
  it('sends it, and says the link sent before is dead and how long this one works', async () => {
    const server = createServer()
    server.invitations = [expired]
    server.on(`POST ${invitations}/${id(5)}/resend`, () => {
      server.invitations = [{ ...expired, status: 'pending', expires_at: later }]
      return new Response(null, { status: 202 })
    })
    const { user } = await list(server)
    await user.click(await screen.findByRole('button', { name: 'Send again to stryc@example.cz' }))
    expect(
      await screen.findByText(
        'Sent again to stryc@example.cz. The link sent before no longer works; this one works for 14 days.',
      ),
    ).toBeInTheDocument()
    expect(server.to(`POST ${invitations}/${id(5)}/resend`)).toHaveLength(1)
    // The list is read again: it waits once more.
    expect(
      await within(await rowOf('stryc@example.cz')).findByText('Waiting · expires Jan 15, 2099'),
    ).toBeInTheDocument()
  })

  it('says one whose address has joined since is no longer there to send', async () => {
    const server = createServer()
    server.invitations = [revoked]
    server.on(`POST ${invitations}/${id(4)}/resend`, () => problem(404, 'not_found'))
    const { user } = await list(server)
    await user.click(await screen.findByRole('button', { name: 'Send again to soused@example.cz' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That is no longer there to change. The page shows how things stand now.',
    )
    await waitFor(() => {
      expect(server.to(`GET ${invitations}`).length).toBeGreaterThan(1)
    })
  })

  // One row's sending under way keeps no other from being pressed, and the first is busy for
  // as long as its own is on its way: pressed again meanwhile, it would be sent twice, the
  // second making the link in the first one's email a dead one.
  it('keeps a row busy while its own is on its way, whichever row was pressed since', async () => {
    const server = createServer()
    server.invitations = [revoked, expired]
    let answer: (response: Response) => void = () => undefined
    server.on(
      `POST ${invitations}/${id(5)}/resend`,
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    )
    server.on(`POST ${invitations}/${id(4)}/resend`, () => new Response(null, { status: 202 }))
    const { user } = await list(server)
    const first = await screen.findByRole('button', {
      name: 'Send again to stryc@example.cz',
    })
    await user.click(first)
    await user.click(screen.getByRole('button', { name: 'Send again to soused@example.cz' }))
    expect(await screen.findByText(/^Sent again to soused@example\.cz\./)).toBeInTheDocument()
    expect(first).toHaveAttribute('aria-busy', 'true')
    await user.click(first)
    expect(server.to(`POST ${invitations}/${id(5)}/resend`)).toHaveLength(1)
    act(() => {
      answer(new Response(null, { status: 202 }))
    })
    expect(await screen.findByText(/^Sent again to stryc@example\.cz\./)).toBeInTheDocument()
    await waitFor(() => {
      expect(first).not.toHaveAttribute('aria-busy')
    })
  })

  it('explains an unverified address where the server refuses for it, and sends its link again', async () => {
    const server = createServer()
    server.invitations = [waiting]
    server.on(`POST ${invitations}/${id(1)}/resend`, () => problem(403, 'account_unverified'))
    server.on('POST /auth/verify-email/resend', () => new Response(null, { status: 202 }))
    const { user } = await list(server)
    await user.click(
      await screen.findByRole('button', {
        name: 'Send again to babicka@example.cz',
      }),
    )
    // The answer to the press: said as it arrives, its words drawn a moment after its region.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^Verify your email first/)
    })
    expect(
      screen.getByText(
        /^An invitation carries your name to somebody else’s phone, so your own address is confirmed before one goes\./,
      ),
    ).toBeInTheDocument()
    // At the top of the list, where the notices stand, and the list still under it.
    expect(
      screen.getByRole('status').compareDocumentPosition(sent()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Send the verification link again' }))
    expect(
      await screen.findByText(/^A link is on its way to jana@tilcerovi\.cz\./),
    ).toBeInTheDocument()
  })

  it('says when to try again where the household has sent its twenty for the day', async () => {
    const server = createServer()
    server.invitations = [waiting]
    server.on(`POST ${invitations}/${id(1)}/resend`, () =>
      problem(429, 'rate_limited', {}, { 'Retry-After': '3600' }),
    )
    const { user } = await list(server)
    await user.click(
      await screen.findByRole('button', {
        name: 'Send again to babicka@example.cz',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Too many attempts\. Try again at \d/,
    )
  })

  it('is asked at once with no connection, says so, and is sent by nothing when one returns', async () => {
    const server = createServer()
    server.invitations = [waiting]
    server.on(`POST ${invitations}/${id(1)}/resend`, () => Promise.reject(new TypeError('offline')))
    const { user } = await list(server)
    const again = await screen.findByRole('button', {
      name: 'Send again to babicka@example.cz',
    })
    onlineManager.setOnline(false)
    try {
      await user.click(again)
      expect(await screen.findByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
      expect(again).not.toHaveAttribute('aria-busy')
    } finally {
      onlineManager.setOnline(true)
    }
    expect(server.to(`POST ${invitations}/${id(1)}/resend`)).toHaveLength(1)
  })
})

describe('how an invitation stands', () => {
  const now = Date.parse('2026-10-08T12:00:00Z')

  it('is as the server says, but for one that waits past its time', () => {
    expect(statusAt(invitation({ expires_at: '2026-10-08T12:00:01Z' }), now)).toBe('pending')
    // At its very time it has run out, as the server reads it.
    expect(statusAt(invitation({ expires_at: '2026-10-08T12:00:00Z' }), now)).toBe('expired')
    expect(statusAt(invitation({ status: 'declined', expires_at: earlier }), now)).toBe('declined')
    expect(statusAt(invitation({ status: 'accepted', expires_at: earlier }), now)).toBe('accepted')
  })

  it('counts an address as settled where an invitation waits for it or brought somebody in', () => {
    expect([
      ...settledAddresses(
        [
          invitation({ email: 'Babicka@Example.cz', expires_at: later }),
          joined,
          declined,
          revoked,
          expired,
          link,
        ],
        now,
      ),
    ]).toEqual(['babicka@example.cz', 'teta@example.cz'])
  })

  it('counts a member’s address as settled, and not one somebody joined by and has left', () => {
    expect([...settledAddresses([joined, declined, revoked], now, ['Klara@Example.cz'])]).toEqual([
      'klara@example.cz',
    ])
    // With the members unread, an invitation somebody joined by is all there is to go by.
    expect([...settledAddresses([joined, declined, revoked], now)]).toEqual(['teta@example.cz'])
    const noticed = declinedNotices(
      [invitation({ ...declined, id: id(9), email: 'teta@example.cz' }), joined],
      now,
      settledAddresses([joined], now, []),
    )
    expect(noticed.map((each) => each.id)).toEqual([id(9)])
  })

  it('tells of a decline only where it is the last word on its address', () => {
    const again = invitation({ ...declined, id: id(9), email: 'Petr@Example.cz' })
    const noticed = (list: Parameters<typeof settledAddresses>[0]) =>
      declinedNotices(list, now, settledAddresses(list, now)).map((each) => each.id)
    // Newest first, as the server lists them.
    expect(noticed([again, declined])).toEqual([id(9)])
    // Asked again, whatever became of the asking: it waits, or was withdrawn, or ran out.
    expect(noticed([{ ...again, status: 'pending' }, declined])).toEqual([])
    expect(noticed([{ ...again, status: 'revoked' }, declined])).toEqual([])
    expect(noticed([{ ...again, status: 'expired' }, declined])).toEqual([])
    // An earlier one sent again waits, under a later one that was declined.
    expect(noticed([again, { ...declined, status: 'pending' }])).toEqual([])
    // A link names nobody: each declined one stands for itself.
    const one = { ...link, status: 'declined' } as const
    expect(noticed([declined, one, { ...one, id: id(7) }])).toEqual([id(3), id(6), id(7)])
  })
})

describe('what a declined invitation hands the composer', () => {
  it('is its kind, its address, its role and its levels', () => {
    expect(readAgain(againState(declined))).toEqual({
      kind: 'email',
      email: 'petr@example.cz',
      role: 'member',
      levels: { ...defaultsFor('member'), finance: 'view' },
    })
  })

  it('hands on no levels for an owner, whose matrix would start at a member’s defaults', () => {
    const owner = invitation({ role: 'owner', grants: defaultsFor('owner'), status: 'declined' })
    expect(readAgain(againState(owner))).toEqual({
      kind: 'email',
      email: 'babicka@example.cz',
      role: 'owner',
      levels: defaultsFor('member'),
    })
  })

  // The state is whatever the history entry holds: nothing of it is taken on trust.
  it('is nothing where the state is not shaped as it was handed over', () => {
    const good = { kind: 'email', email: 'a@b.cz', role: 'member', grants: { tasks: 'view' } }
    expect(readAgain({ again: good })).toMatchObject({ email: 'a@b.cz' })
    for (const state of [
      undefined,
      null,
      'again',
      {},
      { again: null },
      { again: { ...good, kind: 'sms' } },
      { again: { ...good, role: 'child' } },
      { again: { ...good, email: 7 } },
      { again: { ...good, grants: null } },
      { again: { ...good, grants: { tasks: 'everything' } } },
    ]) {
      expect(readAgain(state)).toBeUndefined()
    }
  })
})
