// A household's data (C-56), and the notice of a scheduled deletion wherever it is drawn: what
// each reader of the household sees, what stopping all changes, lifting it, scheduling a deletion
// and keeping the household ask of the server, what each says afterwards and where the focus
// then is, and what each is refused with.
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { inHousehold, paths } from '../app/paths.ts'
import {
  accountOf,
  adam,
  createServer,
  home,
  invalid,
  jana,
  memberOf,
  noContent,
  petr,
  problem,
  readBy,
  tilcerovi,
  type HouseholdServer,
} from '../household/testing.tsx'
import type { Household } from '../household/households.ts'
import { open } from './testing.tsx'

// A test that says the page is looked at again leaves the next one a page nobody has looked at,
// and one that takes the connection away leaves the next one a browser that has it.
afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

const at = inHousehold.data(home)
const restriction = `/households/${home}/restriction`
const deletion = `/households/${home}/deletion`

type Entitlement = NonNullable<Household['entitlement']>

const writing: Entitlement = {
  state: 'active',
  can_write: true,
  can_upload: true,
  restriction: null,
}

/** Jana's restriction of the ninth of September, with the reason she gave. */
const byJana: NonNullable<Entitlement['restriction']> = {
  restricted_by: { user_id: jana.id, label: jana.display_name, is_former_member: false },
  restricted_at: '2026-09-09T17:00:00Z',
  reason: 'Sorting out who paid for what.',
}

const stopped: Entitlement = {
  state: 'restricted',
  can_write: false,
  can_upload: false,
  restriction: byJana,
}

/** The household as its owner reads it with `entitlement`. */
const standing = (entitlement: Entitlement): Household => ({ ...tilcerovi, entitlement })

/** The day a deletion scheduled on the ninth of September is carried out. */
const goes = '2026-10-09T17:05:00Z'

async function data(server: HouseholdServer = createServer()) {
  const opened = open(at, server)
  await screen.findByRole('heading', { level: 1, name: 'Data' })
  return opened
}

const stop = 'Stop all changes in Tilcerovi'
const remove = 'Delete Tilcerovi'

/** Where the screen puts the focus a control left behind: around its notices and its sections. */
function place(): HTMLElement {
  const found = screen.getByRole('heading', { level: 2, name: 'Take a copy of everything' })
    .parentElement?.parentElement
  if (!found) throw new Error('the screen has no place of its own')
  return found
}

/** The focus is on the screen's own place, and not dropped to the page. */
async function focusIsKept() {
  await waitFor(() => {
    expect(document.activeElement).not.toBe(document.body)
  })
  expect(document.activeElement).toBe(place())
}

describe('a household’s data', () => {
  it('is titled for what it shows, and draws the four in the design’s order, the irreversible last', async () => {
    await data()
    await waitFor(() => {
      expect(document.title).toBe('Data · Household')
    })
    expect(
      screen.getByText('A copy of everything, and what can be done with the household’s data.'),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map((each) => each.textContent)).toEqual([
      'Take a copy of everything',
      'Stop all changes for now',
      'Make somebody an owner',
      'Delete the household',
    ])
  })

  it('leads an owner to the exports and to the members, and offers the two questions', async () => {
    await data()
    expect(screen.getByRole('link', { name: 'Export the household' })).toHaveAttribute(
      'href',
      inHousehold.exports(home),
    )
    // Making an owner is no second way of doing it: it leads to where a member is made one.
    expect(screen.getByRole('link', { name: 'Choose from the members' })).toHaveAttribute(
      'href',
      inHousehold.members(home),
    )
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      stop,
      remove,
    ])
    // Nothing is so that a member would be told of: no notice.
    expect(screen.queryByText('All changes are stopped')).not.toBeInTheDocument()
    expect(screen.queryByText(/will be deleted on/)).not.toBeInTheDocument()
  })

  it('draws a member no control, says whose they are, and leads them to their own data', async () => {
    await data(createServer(accountOf(petr)))
    expect(
      await screen.findByText(
        'Exporting the household, stopping its changes, making an owner and deleting it are for an owner: Jana Tilcerová.',
      ),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map((each) => each.textContent)).toEqual([
      'What is yours',
    ])
    expect(screen.getByRole('link', { name: 'Your data' })).toHaveAttribute(
      'href',
      paths.accountPrivacy.path,
    )
    // Absent, not disabled.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Export the household' })).not.toBeInTheDocument()
  })

  it('draws a child profile the same as any member who is no owner', async () => {
    await data(createServer(accountOf(adam)))
    expect(await screen.findByText(/are for an owner: Jana Tilcerová\.$/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  // The gate lets an export, a restriction and a deletion through, and not the making of an
  // owner (FR-BI1), whatever the prototype says.
  it('says to the owner of a read-only household what still works, and draws no way to make an owner', async () => {
    const server = createServer()
    server.household = standing({
      state: 'read_only',
      can_write: false,
      can_upload: false,
      data_retained_until: '2027-10-09T00:00:00Z',
      restriction: null,
    })
    await data(server)
    expect(
      screen.getByText(
        'The household is read-only. What is on this page works all the same, except making an owner.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Export the household' })).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      stop,
      remove,
    ])
    expect(
      screen.getByText(
        'The household is read-only as it is. Stopped now, its changes stay stopped after the subscription resumes, until an owner lifts it.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Choose from the members' })).not.toBeInTheDocument()
    expect(
      screen.getByText('Nobody can be made an owner while the household takes no changes.'),
    ).toBeInTheDocument()
  })

  it('takes the controls from an owner made a member while the screen is open, and keeps the focus', async () => {
    const server = createServer()
    await data(server)
    const control = screen.getByRole('button', { name: stop })
    const view = place()
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
    expect(document.activeElement).toBe(view)
    // Nothing was pressed, so nothing was refused.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('that changes are stopped', () => {
  it('is said to every member: by whom, when and why, and what still works', async () => {
    const server = createServer(accountOf(petr))
    server.household = { ...readBy(memberOf(petr)), entitlement: stopped }
    await data(server)
    const title = screen.getByText('All changes are stopped')
    expect(
      // In the member's own zone, whatever this device's is.
      screen.getByText('Jana Tilcerová stopped all changes here on Sep 9, 2026, 7:00 PM.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The reason they gave: Sorting out who paid for what.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Nobody can add or change anything until an owner lifts it. Reading, downloading and exporting work as before.',
      ),
    ).toBeInTheDocument()
    // It was so when the screen opened: read in its place, and announced as nothing that arrived.
    expect(title.closest('[role="status"], [role="alert"]')).toBeNull()
    // Lifting it is an owner's.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    // The contract's word for the state is drawn nowhere.
    expect(document.body).not.toHaveTextContent(/\brestricted\b/)
  })

  it('names an owner who has left as a former member, and gives no reason where none was given', async () => {
    const server = createServer()
    server.household = standing({
      ...stopped,
      restriction: {
        ...byJana,
        restricted_by: { user_id: petr, label: 'Petr Tilcer', is_former_member: true },
        reason: null,
      },
    })
    await data(server)
    expect(
      screen.getByText(
        'Petr Tilcer, who is no longer a member, stopped all changes here on Sep 9, 2026, 7:00 PM.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^The reason they gave/)).not.toBeInTheDocument()
  })

  // An erased account leaves neither an id nor a name.
  it('says a former member stopped them where the owner’s account is gone', async () => {
    const server = createServer()
    server.household = standing({
      ...stopped,
      restriction: {
        ...byJana,
        restricted_by: { user_id: null, label: '', is_former_member: true },
      },
    })
    await data(server)
    expect(
      screen.getByText('A former member stopped all changes here on Sep 9, 2026, 7:00 PM.'),
    ).toBeInTheDocument()
  })
})

describe('stopping all changes', () => {
  /** A server that restricts the household, as Jana, when it is asked to. */
  function restricting(): HouseholdServer {
    const server = createServer()
    server.on(`POST ${restriction}`, () => {
      server.household = standing(stopped)
      return Response.json(stopped)
    })
    return server
  }

  async function asked(server: HouseholdServer = restricting()) {
    const opened = await data(server)
    await opened.user.click(screen.getByRole('button', { name: stop }))
    const dialog = screen.getByRole('dialog', { name: 'Stop all changes in Tilcerovi?' })
    return { ...opened, dialog }
  }

  it('asks first, saying plainly what stops and what does not, and takes a reason nobody has to give', async () => {
    const { dialog } = await asked()
    expect(dialog).toHaveAccessibleDescription(
      'Nobody can add, change or upload anything, an owner included. Changes that are still waiting in a browser or on a phone are held there and are not taken.',
    )
    expect(
      within(dialog).getByText(
        'Reading, downloading and exporting work as before. The subscription keeps running and keeps being charged: this does not cancel it. Any owner lifts the restriction at any time, and it lifts at once.',
      ),
    ).toBeInTheDocument()
    const reason = within(dialog).getByRole('textbox', { name: 'Why, for the other members' })
    expect(reason).toHaveAccessibleDescription(
      'You can leave this empty. Every member reads it while changes are stopped.',
    )
    expect(reason).not.toBeRequired()
    // The safe choice first, then the one that names what it stops.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Cancel', stop])
  })

  it('stops them with the reason given, says so, and draws who, when, why and the way to lift it', async () => {
    const { user, server, dialog } = await asked()
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Why, for the other members' }),
      '  Sorting out who paid for what. ',
    )
    await user.click(within(dialog).getByRole('button', { name: stop }))

    expect(
      await screen.findByText('All changes in Tilcerovi are stopped. Any owner can lift it.'),
    ).toBeInTheDocument()
    expect(server.to(`POST ${restriction}`)).toHaveLength(1)
    expect(await server.body(`POST ${restriction}`)).toEqual({
      reason: 'Sorting out who paid for what.',
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText('All changes are stopped')).toBeInTheDocument()
    expect(
      screen.getByText('The reason they gave: Sorting out who paid for what.'),
    ).toBeInTheDocument()
    // The control that stopped them has left for the one that lifts it.
    expect(screen.queryByRole('button', { name: stop })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lift the restriction' })).toBeInTheDocument()
    await focusIsKept()
    // The household is read again.
    await waitFor(() => {
      expect(server.to(`GET /households/${home}`).length).toBeGreaterThan(1)
    })
  })

  it('sends no reason where none was typed', async () => {
    const { user, server, dialog } = await asked()
    await user.click(within(dialog).getByRole('button', { name: stop }))
    await screen.findByText('All changes in Tilcerovi are stopped. Any owner can lift it.')
    expect(await server.body(`POST ${restriction}`)).toEqual({})
  })

  it('stops nothing where the owner says to cancel', async () => {
    const { user, server, dialog } = await asked()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.to(`POST ${restriction}`)).toHaveLength(0)
  })

  // The typed client lists no `422` for this operation, and the server answers one all the same.
  it('says beside the reason that it cannot be kept, and puts the focus on it', async () => {
    const server = createServer()
    server.on(`POST ${restriction}`, () => invalid('/reason'))
    const { user, dialog } = await asked(server)
    const reason = within(dialog).getByRole('textbox', { name: 'Why, for the other members' })
    await user.type(reason, 'x')
    await user.click(within(dialog).getByRole('button', { name: stop }))
    await waitFor(() => {
      expect(reason).toHaveAccessibleDescription(
        expect.stringContaining(
          'That reason holds characters that can’t be kept. Type it again as plain text.',
        ),
      )
    })
    expect(reason).toBeInvalid()
    await waitFor(() => {
      expect(document.activeElement).toBe(reason)
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('All changes are stopped')).not.toBeInTheDocument()
  })

  it('is asked at once with no connection, says the server was not reached, and is sent by nothing later', async () => {
    const server = createServer()
    server.on(`POST ${restriction}`, () => Promise.reject(new TypeError('offline')))
    const { user, dialog } = await asked(server)
    const confirm = within(dialog).getByRole('button', { name: stop })
    onlineManager.setOnline(false)
    await user.click(confirm)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^We couldn’t reach Household\./,
    )
    expect(confirm).not.toHaveAttribute('aria-busy')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => {
      onlineManager.setOnline(true)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(server.to(`POST ${restriction}`)).toHaveLength(1)
  })

  it('tells an owner made a member meanwhile, on the page, and takes the controls away', async () => {
    const server = createServer()
    server.on(`POST ${restriction}`, () => {
      server.household = readBy({ ...memberOf(jana.id), role: 'member' })
      return problem(403, 'forbidden')
    })
    const { user, dialog } = await asked(server)
    await user.click(within(dialog).getByRole('button', { name: stop }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an owner can change this, and you are not one any more. Nothing was changed.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { level: 2, name: 'What is yours' })).toBeInTheDocument()
  })
})

describe('lifting a restriction', () => {
  const lift = 'Lift the restriction'

  /** A server whose household is restricted and stands as `entitlement`, lifted to `after`. */
  function lifting(entitlement: Entitlement = stopped, after: Entitlement = writing) {
    const server = createServer()
    server.household = standing(entitlement)
    server.on(`DELETE ${restriction}`, () => {
      server.household = standing(after)
      return Response.json(after)
    })
    return server
  }

  it('says before it is used that changes come back, and no more than the household says', async () => {
    await data(lifting())
    expect(screen.getByRole('button', { name: lift })).toHaveAccessibleDescription(
      'Lifting it brings changes back at once.',
    )
    // The control that restricts is not drawn beside the one that lifts.
    expect(screen.queryByRole('button', { name: stop })).not.toBeInTheDocument()
    // Whether a payment is outstanding is not this screen's to know, and it claims neither way.
    expect(document.body).not.toHaveTextContent(/payment/i)
  })

  it('says a trial runs to its day, and that uploads stay paused in grace', async () => {
    const trial = await data(lifting({ ...stopped, trial_ends_at: '2026-09-30T08:00:00Z' }))
    expect(screen.getByRole('button', { name: lift })).toHaveAccessibleDescription(
      'Lifting it brings changes back at once. The trial runs until September 30, 2026.',
    )
    trial.unmount()

    await data(lifting({ ...stopped, grace_ends_at: '2026-09-20T08:00:00Z' }))
    expect(screen.getByRole('button', { name: lift })).toHaveAccessibleDescription(
      'Lifting it brings changes back at once. Uploads stay paused.',
    )
  })

  // A lapse outranks a restriction (D-114): the state is the lapse's, and the restriction is
  // read off `restriction`.
  it('says a household whose subscription lapsed stays read-only, with the day its data is kept until', async () => {
    const lapsed = await data(
      lifting({
        ...stopped,
        state: 'read_only',
        data_retained_until: '2027-10-09T00:00:00Z',
      }),
    )
    const control = screen.getByRole('button', { name: lift })
    expect(control).toHaveAccessibleDescription(
      expect.stringContaining(
        'Lifting it leaves Tilcerovi read-only: its subscription has lapsed.',
      ),
    )
    expect(control).toHaveAccessibleDescription(
      expect.stringContaining('Its data is kept until October 9, 2027.'),
    )
    // Both are so, and both are said: that changes are stopped, and by whom.
    expect(screen.getByText('All changes are stopped')).toBeInTheDocument()
    lapsed.unmount()

    await data(
      lifting({ ...stopped, state: 'canceled', data_retained_until: '2027-10-09T00:00:00Z' }),
    )
    expect(screen.getByRole('button', { name: lift })).toHaveAccessibleDescription(
      expect.stringContaining(
        'Lifting it leaves Tilcerovi read-only: its subscription was cancelled.',
      ),
    )
  })

  it('lifts it at once, says what the household now is, and draws the way to stop changes again', async () => {
    const server = lifting()
    const { user } = await data(server)
    await user.click(screen.getByRole('button', { name: lift }))
    expect(
      await screen.findByText('The restriction is lifted. Tilcerovi takes changes again.'),
    ).toBeInTheDocument()
    const [sent] = server.to(`DELETE ${restriction}`)
    expect(server.to(`DELETE ${restriction}`)).toHaveLength(1)
    expect(await sent?.text()).toBe('')
    await waitFor(() => {
      expect(screen.queryByText('All changes are stopped')).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: lift })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: stop })).toBeInTheDocument()
    await focusIsKept()
  })

  it('says what the server answered the household now is, where that is not what it was', async () => {
    const grace = await data(lifting(stopped, { ...writing, state: 'grace', can_upload: false }))
    await grace.user.click(screen.getByRole('button', { name: lift }))
    expect(
      await screen.findByText(
        'The restriction is lifted. Tilcerovi takes changes again, and uploads stay paused.',
      ),
    ).toBeInTheDocument()
    grace.unmount()

    const lapsed = await data(
      lifting(stopped, {
        state: 'read_only',
        can_write: false,
        can_upload: false,
        restriction: null,
      }),
    )
    await lapsed.user.click(screen.getByRole('button', { name: lift }))
    expect(
      await screen.findByText('The restriction is lifted. Tilcerovi stays read-only.'),
    ).toBeInTheDocument()
  })

  it('says each refusal as it comes, and is asked at once with no connection', async () => {
    const server = lifting()
    server.on(`DELETE ${restriction}`, () => problem(429, 'rate_limited'))
    const { user } = await data(server)
    const control = screen.getByRole('button', { name: lift })
    await user.click(control)
    const first = await screen.findByRole('alert')
    expect(first).toHaveTextContent('Too many attempts. Try again in a little while.')

    server.on(`DELETE ${restriction}`, () => Promise.reject(new TypeError('offline')))
    onlineManager.setOnline(false)
    await user.click(control)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
    })
    expect(screen.getByRole('alert')).not.toBe(first)
    expect(control).not.toHaveAttribute('aria-busy')
    act(() => {
      onlineManager.setOnline(true)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(server.to(`DELETE ${restriction}`)).toHaveLength(2)
    expect(screen.getByText('All changes are stopped')).toBeInTheDocument()
  })

  it('tells an owner made a member meanwhile, on the page, and takes the control away', async () => {
    const server = lifting()
    server.on(`DELETE ${restriction}`, () => {
      server.household = {
        ...readBy({ ...memberOf(jana.id), role: 'member' }),
        entitlement: stopped,
      }
      return problem(403, 'forbidden')
    })
    const { user } = await data(server)
    await user.click(screen.getByRole('button', { name: lift }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an owner can change this, and you are not one any more. Nothing was changed.',
    )
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
    // What is so is still said to them, as to every member.
    expect(screen.getByText('All changes are stopped')).toBeInTheDocument()
  })
})

describe('deleting the household', () => {
  const confirmed = 'Delete Tilcerovi and everything in it'
  const named = 'The household’s name'

  /** A server that schedules the household's deletion when it is asked to. */
  function scheduling(): HouseholdServer {
    const server = createServer()
    server.on(`POST ${deletion}`, () => {
      server.household = { ...server.household, deletion_scheduled_at: goes }
      return Response.json(
        {
          id: '0190a000-0000-7000-8000-0000000000d1',
          scope: 'household',
          requested_at: '2026-09-09T17:05:00Z',
          executes_at: goes,
          cancel_token: null,
        },
        { status: 202 },
      )
    })
    return server
  }

  async function asked(server: HouseholdServer = scheduling()) {
    const opened = await data(server)
    await opened.user.click(screen.getByRole('button', { name: remove }))
    const panel = screen.getByRole('dialog', { name: 'Delete Tilcerovi?' })
    return { ...opened, panel }
  }

  it('says what it does before it asks for the name: who is told, the thirty days, what is gone, and the subscription', async () => {
    const { panel } = await asked()
    for (const sentence of [
      'Every member is told at once, by email.',
      'For thirty days Tilcerovi works as before, and any owner can cancel the deletion. That is everybody’s time to take a copy of what is theirs.',
      'After that, everything in it is deleted and cannot be brought back.',
      'A subscription keeps running and is charged until then. Nothing is refunded.',
    ]) {
      expect(within(panel).getByText(sentence)).toBeInTheDocument()
    }
    const name = within(panel).getByRole('textbox', { name: named })
    expect(name).toHaveAccessibleDescription('Type Tilcerovi to confirm.')
    // The safe choice first, then the one that names what it destroys.
    expect(within(panel).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: confirmed })).toBeInTheDocument()
    // Nothing gives a count of what the household holds, so none is shown.
    expect(panel).not.toHaveTextContent(/\d/)
  })

  it('sends no name of nothing, and says beside the field what to type', async () => {
    const { user, server, panel } = await asked()
    const name = within(panel).getByRole('textbox', { name: named })
    await user.type(name, '   ')
    await user.click(within(panel).getByRole('button', { name: confirmed }))
    expect(name).toHaveAccessibleDescription(
      expect.stringContaining('Type the household’s name to confirm.'),
    )
    await waitFor(() => {
      expect(document.activeElement).toBe(name)
    })
    expect(server.to(`POST ${deletion}`)).toHaveLength(0)
  })

  // The server compares the name whatever its case and the space around it: its word holds.
  it('says beside the field that the name is not the household’s, where the server says so', async () => {
    const server = createServer()
    server.on(`POST ${deletion}`, () => invalid('/confirm_name'))
    const { user, panel } = await asked(server)
    const name = within(panel).getByRole('textbox', { name: named })
    await user.type(name, 'Tilcerovci')
    await user.click(within(panel).getByRole('button', { name: confirmed }))
    await waitFor(() => {
      expect(name).toHaveAccessibleDescription(
        expect.stringContaining('That is not the household’s name. Type Tilcerovi.'),
      )
    })
    expect(await server.body(`POST ${deletion}`)).toEqual({ confirm_name: 'Tilcerovci' })
    await waitFor(() => {
      expect(document.activeElement).toBe(name)
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('schedules it with the name as typed, says so, and draws the day with the way to keep the household', async () => {
    const { user, server, panel } = await asked()
    await user.type(within(panel).getByRole('textbox', { name: named }), ' tilcerovi ')
    await user.click(within(panel).getByRole('button', { name: confirmed }))

    expect(
      await screen.findByText('Tilcerovi is scheduled for deletion. Every member has been told.'),
    ).toBeInTheDocument()
    expect(server.to(`POST ${deletion}`)).toHaveLength(1)
    expect(await server.body(`POST ${deletion}`)).toEqual({ confirm_name: ' tilcerovi ' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The day is the household's own to say, in the member's zone.
    expect(
      await screen.findByText('Tilcerovi will be deleted on October 9, 2026'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep Tilcerovi' })).toBeInTheDocument()
    // One deletion is scheduled: no control asks for another.
    expect(screen.queryByRole('button', { name: remove })).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'The deletion is scheduled for October 9, 2026. Any owner can still keep the household, at the top of this page.',
      ),
    ).toBeInTheDocument()
    await focusIsKept()
  })

  it('says when another can be scheduled, to a household that scheduled five in a day', async () => {
    const server = createServer()
    server.on(`POST ${deletion}`, () => problem(429, 'rate_limited'))
    const { user, panel } = await asked(server)
    await user.type(within(panel).getByRole('textbox', { name: named }), 'Tilcerovi')
    await user.click(within(panel).getByRole('button', { name: confirmed }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in a little while.',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('is asked at once with no connection, says the server was not reached, and is sent by nothing later', async () => {
    const server = createServer()
    server.on(`POST ${deletion}`, () => Promise.reject(new TypeError('offline')))
    const { user, panel } = await asked(server)
    await user.type(within(panel).getByRole('textbox', { name: named }), 'Tilcerovi')
    const confirm = within(panel).getByRole('button', { name: confirmed })
    onlineManager.setOnline(false)
    await user.click(confirm)
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      /^We couldn’t reach Household\./,
    )
    expect(confirm).not.toHaveAttribute('aria-busy')
    act(() => {
      onlineManager.setOnline(true)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(server.to(`POST ${deletion}`)).toHaveLength(1)
    expect(screen.queryByText(/will be deleted on/)).not.toBeInTheDocument()
  })

  it('tells an owner made a member meanwhile, on the page, and takes the controls away', async () => {
    const server = createServer()
    server.on(`POST ${deletion}`, () => {
      server.household = readBy({ ...memberOf(jana.id), role: 'member' })
      return problem(403, 'forbidden')
    })
    const { user, panel } = await asked(server)
    await user.type(within(panel).getByRole('textbox', { name: named }), 'Tilcerovi')
    await user.click(within(panel).getByRole('button', { name: confirmed }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an owner can change this, and you are not one any more. Nothing was changed.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  it('deletes nothing where the owner says to cancel', async () => {
    const { user, server, panel } = await asked()
    await user.type(within(panel).getByRole('textbox', { name: named }), 'Tilcerovi')
    await user.click(within(panel).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.to(`POST ${deletion}`)).toHaveLength(0)
  })
})

describe('the notice of a scheduled deletion', () => {
  const title = 'Tilcerovi will be deleted on October 9, 2026'
  const keep = 'Keep Tilcerovi'

  /** A server whose household is scheduled for deletion, as `me` reads it. */
  function scheduled(me = jana): HouseholdServer {
    const server = createServer(me)
    server.household = { ...server.household, deletion_scheduled_at: goes }
    return server
  }

  /** And which keeps the household when it is asked to. */
  function keeping(): HouseholdServer {
    const server = scheduled()
    server.on(`DELETE ${deletion}`, () => {
      server.household = { ...server.household, deletion_scheduled_at: null }
      return noContent()
    })
    return server
  }

  it('tells every member the day, what holds until then, and the way to take what is theirs', async () => {
    await data(scheduled(accountOf(petr)))
    const heading = screen.getByText(title)
    expect(
      screen.getByText(
        'Every member has been told. Until that day the household works as before, and any owner can cancel the deletion. After it, everything in the household is gone for good, so take a copy of what is yours first.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Export what is yours' })).toHaveAttribute(
      'href',
      paths.accountPrivacy.path,
    )
    // Keeping the household is an owner's.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    // It was so when the screen opened: read in its place.
    expect(heading.closest('[role="status"], [role="alert"]')).toBeNull()
  })

  it('stands on the settings’ first screen too, which every member opens', async () => {
    const member = open(inHousehold.settings(home), scheduled(accountOf(petr)))
    expect(await screen.findByText(title)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: keep })).not.toBeInTheDocument()
    member.unmount()

    open(inHousehold.settings(home), scheduled())
    expect(await screen.findByText(title)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: keep })).toBeInTheDocument()
  })

  it('draws nothing where no deletion is scheduled', async () => {
    open(inHousehold.settings(home), createServer())
    await screen.findByRole('heading', { level: 1, name: 'Household' })
    expect(screen.queryByText(/will be deleted on/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Export what is yours' })).not.toBeInTheDocument()
  })

  it('keeps the household at an owner’s press, says so, and puts the focus on the screen’s own place', async () => {
    const server = keeping()
    const { user } = await data(server)
    await user.click(screen.getByRole('button', { name: keep }))
    expect(
      await screen.findByText(
        'Tilcerovi is kept. The deletion is cancelled, and every member is told.',
      ),
    ).toBeInTheDocument()
    const [sent] = server.to(`DELETE ${deletion}`)
    expect(server.to(`DELETE ${deletion}`)).toHaveLength(1)
    expect(await sent?.text()).toBe('')
    await waitFor(() => {
      expect(screen.queryByText(title)).not.toBeInTheDocument()
    })
    // The way to delete it is offered again.
    expect(screen.getByRole('button', { name: remove })).toBeInTheDocument()
    await focusIsKept()
  })

  it('keeps it from the settings’ first screen as well, the focus on that screen’s place', async () => {
    const { user } = open(inHousehold.settings(home), keeping())
    await user.click(await screen.findByRole('button', { name: keep }))
    await waitFor(() => {
      expect(screen.queryByText(title)).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(
      screen.getByRole('heading', { level: 2, name: 'The household' }),
    )
  })

  // Another owner kept the household first: what was asked for is so.
  it('says no deletion was waiting any more, and reads the household again', async () => {
    const server = scheduled()
    server.on(`DELETE ${deletion}`, () => {
      server.household = { ...server.household, deletion_scheduled_at: null }
      return problem(404, 'not_found')
    })
    const { user } = await data(server)
    await user.click(screen.getByRole('button', { name: keep }))
    expect(
      await screen.findByText(
        'No deletion was waiting any more. The page shows how the household stands.',
      ),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText(title)).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await focusIsKept()
  })

  it('tells an owner made a member meanwhile, and takes the control away with the day still said', async () => {
    const server = scheduled()
    server.on(`DELETE ${deletion}`, () => {
      server.household = {
        ...readBy({ ...memberOf(jana.id), role: 'member' }),
        deletion_scheduled_at: goes,
      }
      return problem(403, 'forbidden')
    })
    const { user } = await data(server)
    await user.click(screen.getByRole('button', { name: keep }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an owner can change this, and you are not one any more. Nothing was changed.',
    )
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
    expect(screen.getByText(title)).toBeInTheDocument()
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
  })

  it('is asked at once with no connection, says the server was not reached, and is sent by nothing later', async () => {
    const server = scheduled()
    server.on(`DELETE ${deletion}`, () => Promise.reject(new TypeError('offline')))
    const { user } = await data(server)
    const control = screen.getByRole('button', { name: keep })
    onlineManager.setOnline(false)
    await user.click(control)
    expect(await screen.findByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
    expect(control).not.toHaveAttribute('aria-busy')
    expect(screen.getByText(title)).toBeInTheDocument()
    act(() => {
      onlineManager.setOnline(true)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(server.to(`DELETE ${deletion}`)).toHaveLength(1)
  })
})
