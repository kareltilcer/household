// Making a child profile (FR-CH1 to FR-CH3) as an owner does it from the list of members: what
// the sheet says before the profile exists, what it sends, what it does with each answer, and
// where the focus is once it has closed.
import { onlineManager } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { inHousehold } from '../../app/paths.ts'
import type { Membership } from '../data.ts'
import { defaultsFor } from '../grants.ts'
import {
  adam,
  createServer,
  home,
  invalid,
  jana,
  memberOf,
  open,
  problem,
  readBy,
  type HouseholdServer,
} from '../testing.tsx'

const childrenRoute = `POST /households/${home}/children`
const membersRoute = `GET /households/${home}/members`

const madeEma =
  'Ema’s profile is made. They sign in with the household’s code, their profile and their PIN.'
const unreachable = /^We couldn’t reach Household\./

/** What the sheet sends. */
interface Sent {
  readonly id: string
  readonly display_name: string
  readonly year_of_birth?: number
  readonly pin: string
  readonly lock_dashboard: boolean
}

// A test that takes the connection away leaves the next one a browser that has it.
afterEach(() => {
  onlineManager.setOnline(true)
})

/** A server that makes the profile it is asked for, and lists it among the members from then on. */
function making(server: HouseholdServer = createServer()): HouseholdServer {
  server.on(childrenRoute, async (request) => {
    const sent = (await request.json()) as Sent
    const made: Membership = {
      ...memberOf(adam),
      user_id: sent.id,
      display_name: sent.display_name,
      grants: defaultsFor('child'),
      last_active_at: null,
      child: {
        year_of_birth: sent.year_of_birth ?? null,
        pin_locked: false,
        dashboard_locked: sent.lock_dashboard,
      },
    }
    server.members = [...server.members, made]
    return Response.json(made, { status: 201, headers: { ETag: '"1"' } })
  })
  return server
}

/** The members screen with the sheet opened from it. */
async function sheet(server: HouseholdServer = createServer()) {
  const opened = open(inHousehold.members(home), server)
  const opener = await screen.findByRole('button', { name: 'Add a child profile' })
  await opened.user.click(opener)
  const dialog = screen.getByRole('dialog', { name: 'Add a child profile' })
  const inside = within(dialog)
  return {
    ...opened,
    opener,
    dialog,
    name: inside.getByRole('textbox', { name: 'Name' }),
    year: inside.getByRole('textbox', { name: 'Year of birth' }),
    pin: inside.getByLabelText('PIN'),
    again: inside.getByLabelText('The same PIN again'),
    lock: inside.getByRole('checkbox', { name: /^Lock their Home:/ }),
    submit: inside.getByRole('button', { name: 'Make the profile' }),
  }
}

type Opened = Awaited<ReturnType<typeof sheet>>

/** Fills in a profile the server would take. */
async function fill({ user, name, pin, again }: Opened, called = 'Ema', digits = '4821') {
  await user.clear(name)
  await user.type(name, called)
  await user.clear(pin)
  await user.type(pin, digits)
  await user.clear(again)
  await user.type(again, digits)
}

/** Fills in a profile the server would take, and asks for it. */
async function ask(opened: Opened, called = 'Ema', digits = '4821') {
  await fill(opened, called, digits)
  await opened.user.click(opened.submit)
}

describe('the sheet that makes a child profile', () => {
  it('opens on the name, and says what each thing asked for is for', async () => {
    const { dialog, name, year, pin, again, lock } = await sheet()
    expect(name).toHaveFocus()
    expect(name).toHaveAttribute('maxlength', '80')
    expect(year).toHaveAttribute('inputmode', 'numeric')
    expect(year).toHaveAccessibleDescription(
      'Optional. It is used only for age-appropriate defaults and a birthday reminder, and only the owners and the child see it.',
    )
    // A PIN is typed twice, as digits, and is no password a browser already keeps.
    for (const field of [pin, again]) {
      expect(field).toHaveAttribute('type', 'password')
      expect(field).toHaveAttribute('inputmode', 'numeric')
      expect(field).toHaveAttribute('autocomplete', 'new-password')
    }
    expect(pin).toHaveAccessibleDescription(
      '4 to 6 digits. They sign in on their own phone with the household’s code, their profile and this PIN, and no email address is collected. It isn’t shown again once the profile is made: an owner can set a new one.',
    )
    // Home is locked unless the owner says otherwise, and it is said that this is when to say.
    expect(lock).toBeChecked()
    expect(lock).toHaveAccessibleName(
      'Lock their Home: they see the Home an owner set, and can’t rearrange it',
    )
    expect(lock).toHaveAccessibleDescription(
      'This is chosen here, as the profile is made. It can’t be changed afterwards.',
    )
    // The safe choice first.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent)
        .filter((words) => words !== ''),
    ).toEqual(['Show', 'Show', 'Cancel', 'Make the profile'])
  })

  it('shows what a child profile starts with, and has no matrix to fill in', async () => {
    const { dialog } = await sheet()
    const starts = within(dialog).getByRole('region', { name: 'What they start with' })
    expect(
      within(starts)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Can add and edit · 5', 'Can see · 2', 'Off · 9', 'Household settings'])
    const held = within(starts).getAllByRole('definition')
    expect(held[0]).toHaveTextContent('Tasks, Calendar, Shopping, Chores, and Pets')
    // What is off leaves their app, and household settings is not among it: it stays in a
    // child profile's app as in every member's, which its own sentence says.
    expect(held[2]).not.toHaveTextContent('Household settings')
    expect(held[3]).toHaveTextContent(
      'In their app all the same, as in every member’s: the household’s profile, its members and its modules. Its invitations are not.',
    )
    expect(
      within(starts).getByText(
        'A child profile can’t set anything up, and can at most see Finance. The choices stop there.',
      ),
    ).toBeInTheDocument()
    expect(
      within(starts).getByText(
        'Every level can be changed on their own page once the profile is made.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    expect(dialog).not.toHaveTextContent(/\b(none|view|contribute|manage)\b/)
  })

  // FR-CH3: said as a fact where the profile is made, and neither as a warning nor an alarm.
  it('states the one asymmetry of a child’s private space, plainly', async () => {
    const { dialog } = await sheet()
    const space = within(dialog).getByRole('region', { name: 'Their private space' })
    expect(space).toHaveTextContent(
      'An owner can read what a child keeps in their private space. It is the one difference from an adult’s, which nobody else can read. They are told so, in plain words, the first time they sign in.',
    )
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument()
  })

  it('makes the profile, says so with what happens next, and reads the members again', async () => {
    const server = making()
    const opened = await sheet(server)
    const { user, name, year, pin, again, submit, opener } = opened
    await user.type(name, '  Ema ')
    await user.type(year, '2016')
    await user.type(pin, '4821')
    await user.type(again, '4821')
    await user.click(submit)

    expect(await screen.findByText(madeEma)).toBeInTheDocument()
    // The id is the client's own, a UUIDv7, and the defaults are sent by naming no levels.
    const sent = (await server.body(childrenRoute)) as Sent
    expect(sent.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(sent).toEqual({
      id: sent.id,
      display_name: 'Ema',
      year_of_birth: 2016,
      pin: '4821',
      lock_dashboard: true,
    })
    expect(server.to(childrenRoute)).toHaveLength(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The focus is back on what opened the sheet, which is where it was.
    await waitFor(() => {
      expect(opener).toHaveFocus()
    })
    expect(opener).toBeInTheDocument()
    // The list is read again, and the profile is in it.
    expect(await screen.findByRole('link', { name: 'Ema' })).toBeInTheDocument()
    expect(server.to(membersRoute).length).toBeGreaterThan(1)
    // The PIN is shown to nobody again.
    expect(document.body).not.toHaveTextContent('4821')
  })

  it('sends no year where none was given, and that Home is not locked where the owner says so', async () => {
    const server = making()
    const opened = await sheet(server)
    await opened.user.click(opened.lock)
    expect(opened.lock).not.toBeChecked()
    await ask(opened, 'Ema', '482100')
    expect(await screen.findByText(madeEma)).toBeInTheDocument()
    const sent = (await server.body(childrenRoute)) as Sent
    expect(sent).toEqual({
      id: sent.id,
      display_name: 'Ema',
      pin: '482100',
      lock_dashboard: false,
    })
  })

  it('takes this year for a year of birth, and sends it', async () => {
    const server = making()
    const opened = await sheet(server)
    const thisYear = new Date().getUTCFullYear()
    await opened.user.type(opened.year, String(thisYear - 1))
    await ask(opened)
    expect(await screen.findByText(madeEma)).toBeInTheDocument()
    expect(await server.body(childrenRoute)).toMatchObject({ year_of_birth: thisYear - 1 })
  })

  it('is put away by Cancel, with nothing sent and the focus back on what opened it', async () => {
    const server = making()
    const { user, dialog, name, opener } = await sheet(server)
    await user.type(name, 'Ema')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.to(childrenRoute)).toHaveLength(0)
    await waitFor(() => {
      expect(opener).toHaveFocus()
    })
  })

  // A household of one is drawn another way once it has a second member: the control the sheet
  // was opened from is the same one all the same, and takes the focus back.
  it('gives the focus back in a household that was its owner’s alone until now', async () => {
    const server = making()
    server.members = [memberOf(jana.id)]
    const opened = await sheet(server)
    expect(screen.getByText('You are the only member.')).toBeInTheDocument()
    await ask(opened)
    expect(await screen.findByText(madeEma)).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Ema' })).toBeInTheDocument()
    expect(screen.queryByText('You are the only member.')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(opened.opener).toHaveFocus()
    })
  })
})

describe('a profile whose answer was lost', () => {
  it('is asked for again by the same id, and by another once the sheet is opened anew', async () => {
    const server = createServer()
    server.on(childrenRoute, () => Promise.reject(new TypeError('offline')))
    const opened = await sheet(server)
    await ask(opened)
    expect(await within(opened.dialog).findByRole('alert')).toHaveTextContent(unreachable)
    // Nothing that was typed is lost, and the sheet stays.
    expect(opened.name).toHaveValue('Ema')
    expect(opened.pin).toHaveValue('4821')

    making(server)
    await opened.user.click(opened.submit)
    expect(await screen.findByText(madeEma)).toBeInTheDocument()
    const [first, second] = await Promise.all(
      server.to(childrenRoute).map(async (request) => (await request.clone().json()) as Sent),
    )
    expect(second?.id).toBe(first?.id)

    // Another opening is another profile.
    await opened.user.click(screen.getByRole('button', { name: 'Add a child profile' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a child profile' })
    const inside = within(dialog)
    expect(inside.getByRole('textbox', { name: 'Name' })).toHaveValue('')
    await opened.user.type(inside.getByRole('textbox', { name: 'Name' }), 'Ota')
    await opened.user.type(inside.getByLabelText('PIN'), '7350')
    await opened.user.type(inside.getByLabelText('The same PIN again'), '7350')
    await opened.user.click(inside.getByRole('button', { name: 'Make the profile' }))
    await waitFor(() => {
      expect(server.to(childrenRoute)).toHaveLength(3)
    })
    const third = (await server.body(childrenRoute)) as Sent
    expect(third.id).not.toBe(first?.id)
  })

  // The server keeps no Idempotency-Key for this request, a PIN never being stored under one:
  // a repeat of a profile it made answers `422` naming the id alone.
  it('is read as made where the server refuses its id alone, and the members are read again', async () => {
    const server = createServer()
    server.on(childrenRoute, () => invalid('/id'))
    const opened = await sheet(server)
    const before = server.to(membersRoute).length
    await ask(opened)
    expect(await screen.findByText(madeEma)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(server.to(membersRoute).length).toBeGreaterThan(before)
    })
    await waitFor(() => {
      expect(opened.opener).toHaveFocus()
    })
  })

  // The server counts the household's members before it looks at the id: a household the
  // first request filled refuses its repeat as full, of the very profile that filled it.
  it('is read as made where the household is full of the very profile it asks for, by the name that profile holds', async () => {
    const server = createServer()
    server.on(childrenRoute, async (request) => {
      const sent = (await request.json()) as Sent
      // Made by a request whose answer never came, under the name that one carried.
      const made = { ...memberOf(adam), user_id: sent.id, display_name: 'Emička' }
      server.members = [...server.members, made]
      server.on(`${membersRoute}/${sent.id}`, () => Response.json(made))
      return problem(403, 'fair_use_ceiling', { resource: 'members', ceiling: 12 })
    })
    const opened = await sheet(server)
    await ask(opened)
    expect(await screen.findByText(madeEma.replace('Ema', 'Emička'))).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(opened.opener).toHaveFocus()
    })
  })

  it('is not read as made where the refusal names anything beside the id', async () => {
    const server = createServer()
    server.on(childrenRoute, () =>
      problem(422, 'validation_failed', {
        errors: [
          { field: '/id', code: 'invalid' },
          { field: '/pin', code: 'pattern' },
        ],
      }),
    )
    const opened = await sheet(server)
    await ask(opened)
    await waitFor(() => {
      expect(opened.pin).toHaveAccessibleDescription(
        expect.stringContaining('A PIN is 4 to 6 digits, and nothing else.'),
      )
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText(madeEma)).not.toBeInTheDocument()
  })
})

describe('a child profile that is not sent', () => {
  it('asks for a name and a PIN before it asks the server, and puts the focus on the first', async () => {
    const server = making()
    const { user, name, pin, again, submit } = await sheet(server)
    await user.click(submit)
    expect(name).toHaveAccessibleDescription(
      expect.stringContaining('Add a name, at most 80 characters.'),
    )
    expect(pin).toHaveAccessibleDescription(
      expect.stringContaining('A PIN is 4 to 6 digits, and nothing else.'),
    )
    // Two PINs that differ are no news beside one that is none.
    expect(again).not.toHaveAccessibleDescription()
    await waitFor(() => {
      expect(name).toHaveFocus()
    })
    expect(server.to(childrenRoute)).toHaveLength(0)
  })

  it('takes four to six digits for a PIN, and nothing else', async () => {
    const server = making()
    const { user, name, pin, again, submit } = await sheet(server)
    await user.type(name, 'Ema')
    for (const digits of ['482', '48x1']) {
      await user.clear(pin)
      await user.type(pin, digits)
      await user.clear(again)
      await user.type(again, digits)
      await user.click(submit)
      expect(pin).toHaveAccessibleDescription(
        expect.stringContaining('A PIN is 4 to 6 digits, and nothing else.'),
      )
      await waitFor(() => {
        expect(pin).toHaveFocus()
      })
    }
    // A seventh digit is not typed at all.
    await user.clear(pin)
    await user.type(pin, '4821007')
    expect(pin).toHaveValue('482100')
    expect(server.to(childrenRoute)).toHaveLength(0)
  })

  // The prototype refuses 1234: the server does not, and a rule only the client applies is not built.
  it('does not judge a PIN that is one', async () => {
    const server = making()
    const opened = await sheet(server)
    await ask(opened, 'Ema', '1234')
    expect(await screen.findByText(madeEma)).toBeInTheDocument()
    expect(await server.body(childrenRoute)).toMatchObject({ pin: '1234' })
  })

  it('says two PINs differ on the second, which takes the focus', async () => {
    const server = making()
    const { user, name, pin, again, submit } = await sheet(server)
    await user.type(name, 'Ema')
    await user.type(pin, '4821')
    await user.type(again, '4812')
    await user.click(submit)
    expect(again).toHaveAccessibleDescription(
      expect.stringContaining('The two PINs are not the same. Type it again.'),
    )
    expect(pin).not.toHaveAccessibleDescription(expect.stringContaining('A PIN is'))
    await waitFor(() => {
      expect(again).toHaveFocus()
    })
    expect(server.to(childrenRoute)).toHaveLength(0)
  })

  it('takes a year of four digits, from 1900 to this one, or none', async () => {
    const server = making()
    const opened = await sheet(server)
    const { user, year, submit } = opened
    const refused =
      'A year of birth is four digits, from 1900 to this year. Leave it empty if you’d rather not give one.'
    await fill(opened)
    for (const typed of ['16', '20x6', '1899', String(new Date().getUTCFullYear() + 2)]) {
      await user.clear(year)
      await user.type(year, typed)
      await user.click(submit)
      expect(year).toHaveAccessibleDescription(expect.stringContaining(refused))
      await waitFor(() => {
        expect(year).toHaveFocus()
      })
    }
    expect(server.to(childrenRoute)).toHaveLength(0)
  })
})

describe('a child profile the server refuses', () => {
  it('says what it refused beside the field it named, and puts the focus there', async () => {
    const server = createServer()
    const opened = await sheet(server)
    const { user, name, year, pin, submit } = opened

    server.on(childrenRoute, () => invalid('/pin', 'pattern'))
    await ask(opened)
    await waitFor(() => {
      expect(pin).toHaveAccessibleDescription(
        expect.stringContaining('A PIN is 4 to 6 digits, and nothing else.'),
      )
    })
    await waitFor(() => {
      expect(pin).toHaveFocus()
    })

    server.on(childrenRoute, () => invalid('/year_of_birth'))
    await user.click(submit)
    await waitFor(() => {
      expect(year).toHaveAccessibleDescription(expect.stringContaining('A year of birth is'))
    })
    await waitFor(() => {
      expect(year).toHaveFocus()
    })
    expect(pin).not.toHaveAccessibleDescription(expect.stringContaining('A PIN is'))

    server.on(childrenRoute, () => invalid('/display_name', 'max_length'))
    await user.click(submit)
    await waitFor(() => {
      expect(name).toHaveAccessibleDescription(
        expect.stringContaining('Add a name, at most 80 characters.'),
      )
    })
    await waitFor(() => {
      expect(name).toHaveFocus()
    })
    // Said beside its field, and by no banner as well.
    expect(within(opened.dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(server.to(childrenRoute)).toHaveLength(3)
  })

  it('says a household is full, with how many members it may have', async () => {
    const server = createServer()
    server.on(childrenRoute, () =>
      problem(403, 'fair_use_ceiling', { resource: 'members', ceiling: 12 }),
    )
    const opened = await sheet(server)
    const before = server.to(membersRoute).length
    await ask(opened)
    expect(await within(opened.dialog).findByRole('alert')).toHaveTextContent(
      'A household has at most 12 members, child profiles counted, and this one has that many. No profile was made.',
    )
    // The list behind the sheet is read again: it was not as the server has it.
    await waitFor(() => {
      expect(server.to(membersRoute).length).toBeGreaterThan(before)
    })
    expect(opened.name).toHaveValue('Ema')
    // Full of others: the profile was looked for by its id, and is nobody.
    const asked = (await server.body(childrenRoute)) as Sent
    expect(server.to(`${membersRoute}/${asked.id}`)).toHaveLength(1)
  })

  it('says its owner is one no longer, and once it is closed puts the focus on the list', async () => {
    const server = createServer()
    const opened = await sheet(server)
    // Made a member from somewhere else since the screen was read.
    const demoted = { ...memberOf(jana.id), role: 'member', grants: defaultsFor('member') } as const
    server.on(childrenRoute, () => {
      server.household = readBy(demoted)
      server.members = server.members.map((each) => (each.user_id === jana.id ? demoted : each))
      return problem(403, 'forbidden')
    })
    await ask(opened)
    expect(await within(opened.dialog).findByRole('alert')).toHaveTextContent(
      'Only an owner can change this, and you are not one any more. Nothing was changed.',
    )
    // The page behind the sheet is read again, and what an owner had on it is gone.
    await waitFor(() => {
      expect(opened.opener).not.toBeInTheDocument()
    })
    await opened.user.click(within(opened.dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The control that opened the sheet went with the owner's standing: the focus is on the
    // list's own place, and not dropped to the page.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(screen.getByRole('list', { name: 'Members' }))
  })

  it('says the household is read-only now', async () => {
    const server = createServer()
    server.on(childrenRoute, () =>
      problem(402, 'entitlement_read_only', { state: 'read_only', remedy: 'subscribe' }),
    )
    const opened = await sheet(server)
    await ask(opened)
    expect(await within(opened.dialog).findByRole('alert')).toHaveTextContent(
      'The household is read-only now, so nothing was changed.',
    )
  })

  it('says a household that is its member’s no longer has nothing there to change', async () => {
    const server = createServer()
    server.on(childrenRoute, () => problem(404, 'not_found'))
    const opened = await sheet(server)
    await ask(opened)
    expect(await within(opened.dialog).findByRole('alert')).toHaveTextContent(
      'That is no longer there to change. The page shows how things stand now.',
    )
  })

  it('says each other refusal in a banner of its own, so that a second is said as the first was', async () => {
    const server = createServer()
    server.on(childrenRoute, () => problem(429, 'rate_limited'))
    const opened = await sheet(server)
    await ask(opened)
    const first = await within(opened.dialog).findByRole('alert')
    expect(first).toHaveTextContent('Too many attempts. Try again in a little while.')

    server.on(childrenRoute, () => problem(500, 'internal_error'))
    await opened.user.click(opened.submit)
    await waitFor(() => {
      expect(within(opened.dialog).getByRole('alert')).toHaveTextContent(
        'Something went wrong at our end. Nothing you typed was lost. Try again.',
      )
    })
    expect(within(opened.dialog).getByRole('alert')).not.toBe(first)
    // No field is marked for a refusal that is none's, and the focus is moved to none.
    expect(opened.name).not.toHaveAttribute('aria-invalid')
    expect(opened.pin).not.toHaveAttribute('aria-invalid')
  })

  it('is asked at once though the browser says it has no connection, and is sent by nothing when one returns', async () => {
    const server = createServer()
    server.on(childrenRoute, () => Promise.reject(new TypeError('offline')))
    const opened = await sheet(server)
    onlineManager.setOnline(false)
    await ask(opened)
    // Not held for a connection, with a busy control and no word: it is asked, and answered.
    expect(await within(opened.dialog).findByRole('alert')).toHaveTextContent(unreachable)
    expect(opened.submit).not.toHaveAttribute('aria-busy')
    expect(server.to(childrenRoute)).toHaveLength(1)
    making(server)
    onlineManager.setOnline(true)
    // Nothing waited for the connection: a profile made now would be nobody's doing.
    await screen.findByRole('list', { name: 'Members' })
    expect(server.to(childrenRoute)).toHaveLength(1)
    expect(screen.queryByText(madeEma)).not.toBeInTheDocument()
  })
})
