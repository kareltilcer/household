// The invitation composer (A-23): what it starts from, what it sends for an email, a link and an
// owner, what each refusal is said to be and where the focus goes, the link that is shown once,
// and what stands in the form's place for whoever may not invite, or not yet.
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inHousehold } from '../../app/paths.ts'
import { defaultsFor } from '../grants.ts'
import {
  accountOf,
  adam,
  createServer,
  home,
  invalid,
  invitation,
  jana,
  klara,
  memberOf,
  open,
  petr,
  problem,
  readBy,
  tilcerovi,
  type HouseholdServer,
} from '../testing.tsx'

// A test that says the page is looked at again leaves the next one a page nobody has looked at,
// and one that takes the connection away leaves the next one a browser that has it.
afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

const at = inHousehold.invite(home)
const post = `POST /households/${home}/invitations`
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/
const counted = (see: number, off: number) =>
  `Of the seventeen modules: 0 to set up, 9 to add and edit in, ${String(see)} to see, ${String(off)} off.`

async function composer(server: HouseholdServer = createServer()) {
  const opened = open(at, server)
  await screen.findByRole('heading', { level: 1 })
  return opened
}

/** Has `server` take whatever invitation it is sent, and answer it as made, with `more`. */
function taking(server: HouseholdServer, more: Parameters<typeof invitation>[0] = {}) {
  server.on(post, async (request) => {
    const sent = (await request.json()) as Parameters<typeof invitation>[0]
    return Response.json(invitation({ ...sent, ...more }), { status: 201 })
  })
}

const address = () => screen.getByRole('textbox', { name: 'Their email address' })
const send = () => screen.getByRole('button', { name: 'Send the invitation' })
const level = (module: string) => screen.getByRole('combobox', { name: module })

describe('the invitation composer', () => {
  it('starts with every decision answered: by email, as a member, at the defaults', async () => {
    await composer()
    expect(screen.getByRole('heading', { level: 1, name: 'Invite somebody' })).toBeInTheDocument()
    expect(document.title).toBe('Invite somebody · Household')
    expect(
      screen.getByText('Seventeen decisions, already answered. Change the ones you want to.'),
    ).toBeInTheDocument()

    expect(screen.getByRole('radio', { name: 'By email, to one person' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'By a link I send myself' })).not.toBeChecked()
    expect(
      screen.getByText(
        'It is theirs alone: only the account with that address can join with it. It works for 14 days.',
      ),
    ).toBeInTheDocument()
    expect(address()).toHaveValue('')
    // Somebody else's address: the browser's own is no suggestion for it.
    expect(address()).toHaveAttribute('autocomplete', 'off')
    expect(screen.getByRole('textbox', { name: 'A message (optional)' })).toHaveValue('')

    expect(screen.getByRole('radio', { name: 'Member' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Owner' })).not.toBeChecked()
    // A child profile is made, and never invited: it is no role to choose here.
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(
      screen.getByText(
        'A child profile is not invited: an owner makes one, with no invitation and no email address.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Go to Members, where a child profile is made' }),
    ).toHaveAttribute('href', inHousehold.members(home))

    const matrix = screen.getByRole('list', { name: 'What they get' })
    expect(within(matrix).getAllByRole('combobox')).toHaveLength(17)
    expect(level('Tasks')).toHaveValue('contribute')
    expect(level('Documents')).toHaveValue('view')
    expect(level('Finance')).toHaveValue('none')
    expect(screen.getByText(counted(3, 5))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset to the defaults' })).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'The defaults draw one line: what the household does together is open, and what it owns and spends is closed until somebody opens it. They see this whole list before they answer.',
      ),
    ).toBeInTheDocument()

    expect(send()).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
      'href',
      inHousehold.invitations(home),
    )
    // An owner who may invite is told nothing of where they stand.
    expect(screen.queryByText(/^Read-only/)).not.toBeInTheDocument()
    expect(screen.queryByText(/can’t be sent offline/)).not.toBeInTheDocument()
  })

  it('says which modules are off for everybody once that is read, and does not wait for it', async () => {
    const server = createServer()
    server.off = ['garden']
    let answer: (response: Response) => void = () => undefined
    const modules = `GET /households/${home}/modules`
    const read = new Promise<Response>((resolve) => {
      answer = resolve
    })
    server.on(modules, () => read)
    await composer(server)
    // The matrix is there to be filled in while the modules are still being read.
    expect(level('Garden')).toHaveValue('none')
    expect(level('Garden')).not.toHaveAccessibleDescription(expect.stringContaining('whole'))
    answer(
      Response.json({
        items: [{ module: 'garden', enabled: false, my_level: 'none' }],
      }),
    )
    await waitFor(() => {
      expect(level('Garden')).toHaveAccessibleDescription(
        expect.stringContaining(
          'Off for the whole household: this holds for when it is turned on.',
        ),
      )
    })
    expect(level('Tasks')).not.toHaveAccessibleDescription(expect.stringContaining('whole'))
  })

  it('asks for an address or for how many may use a link, by how it travels', async () => {
    const { user } = await composer()
    await user.type(address(), 'babicka@example.cz')
    await user.click(screen.getByRole('radio', { name: 'By a link I send myself' }))
    expect(screen.queryByRole('textbox', { name: 'Their email address' })).not.toBeInTheDocument()
    // The message goes in the email, and a link has none.
    expect(screen.queryByRole('textbox', { name: 'A message (optional)' })).not.toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'How many people may use it' })).toHaveValue(1)
    // That it is shown once is said before it is made, and not only after.
    expect(
      screen.getByText(
        'Anybody who has the link can join with it, for 72 hours. It is shown once, on this page, when it is made, and a reload loses it: have somewhere to paste it.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make the link' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send the invitation' })).not.toBeInTheDocument()

    // Changed back, what was typed is as it was left.
    await user.click(screen.getByRole('radio', { name: 'By email, to one person' }))
    expect(address()).toHaveValue('babicka@example.cz')
  })

  it('draws no matrix for an owner, and keeps a member’s as it was left', async () => {
    const { user } = await composer()
    await user.selectOptions(level('Finance'), 'Can see')
    await user.click(screen.getByRole('radio', { name: 'Owner' }))
    expect(
      screen.getByText(
        'Owners can set up everything, invite and remove people, turn modules on and off, and delete the household.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'What they get' })).not.toBeInTheDocument()
    expect(
      screen.getByText('An owner can set up every module, so there is nothing to choose here.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Member' }))
    expect(
      screen.getByText('A member can do exactly what is set below, and nothing more.'),
    ).toBeInTheDocument()
    expect(level('Finance')).toHaveValue('view')
  })

  it('counts the levels as they are changed, and puts the defaults back', async () => {
    const { user } = await composer()
    await user.selectOptions(level('Finance'), 'Can see')
    expect(screen.getByText(counted(4, 4))).toBeInTheDocument()
    expect(level('Finance')).toHaveAccessibleDescription(
      'Everything in it can be read, and nothing changed. Changed from “Off”.',
    )
    // A level a member may hold is offered on every row: the contract's names for them never.
    expect(
      within(level('Finance'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Off', 'Can see', 'Can add and edit', 'Can set it up'])

    await user.click(screen.getByRole('button', { name: 'Reset to the defaults' }))
    const counts = screen.getByText(counted(3, 5))
    expect(level('Finance')).toHaveValue('none')
    // The control that put them back went with the difference: the focus is on the sentence
    // that says how they stand, and not dropped to the page.
    expect(screen.queryByRole('button', { name: 'Reset to the defaults' })).not.toBeInTheDocument()
    expect(counts).toHaveFocus()
  })
})

describe('sending an invitation', () => {
  it('sends an email invitation with the whole of what a member gets, says so, and goes to the list', async () => {
    const server = createServer()
    taking(server)
    const { user, router } = await composer(server)
    await user.type(address(), 'babicka@example.cz')
    await user.type(screen.getByRole('textbox', { name: 'A message (optional)' }), ' Ahoj babi ')
    await user.selectOptions(level('Finance'), 'Can see')
    await user.click(send())

    expect(
      await screen.findByText('Sent to babicka@example.cz. It works for 14 days.'),
    ).toBeInTheDocument()
    expect(await server.body(post)).toEqual({
      id: expect.stringMatching(uuid) as string,
      kind: 'email',
      email: 'babicka@example.cz',
      role: 'member',
      grants: { ...defaultsFor('member'), finance: 'view' },
      message: 'Ahoj babi',
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.invitations(home))
    })
  })

  it('says an invitation was sent to an owner who went on to another screen meanwhile, and leaves them there', async () => {
    const server = createServer()
    let answer = () => {}
    const asked = new Promise<void>((resolve) => {
      answer = resolve
    })
    server.on(post, async (request) => {
      const sent = (await request.json()) as Parameters<typeof invitation>[0]
      await asked
      return Response.json(invitation(sent), { status: 201 })
    })
    const { user, router } = await composer(server)
    await user.type(address(), 'babicka@example.cz')
    await user.click(send())
    await waitFor(() => {
      expect(server.to(post)).toHaveLength(1)
    })

    // The answer is slow, and the owner does not wait for it.
    await act(() => router.navigate(inHousehold.modules(home)))
    await screen.findByRole('heading', { level: 1, name: 'Modules' })
    answer()

    expect(
      await screen.findByText('Sent to babicka@example.cz. It works for 14 days.'),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(inHousehold.modules(home))
  })

  it('leaves out a message nobody wrote', async () => {
    const server = createServer()
    taking(server)
    const { user } = await composer(server)
    await user.type(address(), 'babicka@example.cz')
    await user.click(send())
    await screen.findByText('Sent to babicka@example.cz. It works for 14 days.')
    const body = await server.body(post)
    expect(body).not.toHaveProperty('message')
    expect(body).not.toHaveProperty('max_uses')
  })

  it('sends an owner’s invitation with no levels, an owner holding everything', async () => {
    const server = createServer()
    taking(server)
    const { user } = await composer(server)
    await user.type(address(), 'babicka@example.cz')
    await user.click(screen.getByRole('radio', { name: 'Owner' }))
    await user.click(send())
    await screen.findByText('Sent to babicka@example.cz. It works for 14 days.')
    expect(await server.body(post)).toEqual({
      id: expect.stringMatching(uuid) as string,
      kind: 'email',
      email: 'babicka@example.cz',
      role: 'owner',
    })
  })

  it('makes a link, and shows it this once with how many may use it and until when', async () => {
    const server = createServer()
    const url = 'https://household.example/invitation#0tZ9_x'
    // Half past eleven at night in UTC on the fourteenth: the fifteenth already, in Prague.
    taking(server, { email: null, url, expires_at: '2099-01-14T23:30:00Z' })
    const { user } = await composer(server)
    await user.click(screen.getByRole('radio', { name: 'By a link I send myself' }))
    const more = screen.getByRole('button', { name: 'Increase How many people may use it' })
    await user.click(more)
    await user.click(more)
    await user.click(screen.getByRole('button', { name: 'Make the link' }))

    expect(await screen.findByRole('heading', { level: 2, name: 'The link is made' })).toBeVisible()
    expect(await server.body(post)).toEqual({
      id: expect.stringMatching(uuid) as string,
      kind: 'link',
      role: 'member',
      grants: defaultsFor('member'),
      max_uses: 3,
    })
    // In the form's place: there is nothing left to send.
    expect(screen.queryByRole('button', { name: 'Make the link' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    const link = screen.getByRole('textbox', { name: 'The link' })
    expect(link).toHaveValue(url)
    expect(link).toHaveAttribute('readonly')
    expect(link).toHaveAccessibleDescription(
      'Shown only this once. Copy it before you leave this page: a reload loses it.',
    )
    // The form went with the press, and the focus with it: it is on the link, which is read out.
    expect(link).toHaveFocus()
    expect(screen.getByText('3 people can join with it.')).toBeInTheDocument()
    expect(screen.getByText(/^It stops working on Jan 15, 2099, 12:30/)).toBeInTheDocument()

    const written = vi.spyOn(window.navigator.clipboard, 'writeText').mockResolvedValue()
    await user.click(screen.getByRole('button', { name: 'Copy the link' }))
    expect(written).toHaveBeenCalledWith(url)
    expect(await screen.findByText('Link copied')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Done' })).toHaveAttribute(
      'href',
      inHousehold.invitations(home),
    )
  })

  it('says a link for one is for one, and that a browser would not copy it', async () => {
    const server = createServer()
    taking(server, { email: null, url: 'https://household.example/invitation#0tZ9_x' })
    const { user } = await composer(server)
    await user.click(screen.getByRole('radio', { name: 'By a link I send myself' }))
    await user.click(screen.getByRole('button', { name: 'Make the link' }))
    expect(await screen.findByText('One person can join with it.')).toBeInTheDocument()
    vi.spyOn(window.navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    await user.click(screen.getByRole('button', { name: 'Copy the link' }))
    expect(
      await screen.findByText('Copying didn’t work. Select the link and copy it yourself.'),
    ).toBeInTheDocument()
  })
})

describe('an invitation the composer does not send', () => {
  it('asks for an address before it asks the server for anything', async () => {
    const server = createServer()
    const { user } = await composer(server)
    await user.click(send())
    expect(address()).toHaveAccessibleDescription('Enter the address the invitation goes to.')
    expect(address()).toHaveFocus()

    await user.type(address(), 'babicka')
    await user.click(send())
    expect(address()).toHaveAccessibleDescription(
      'That address is missing something. Or send a link instead.',
    )
    expect(address()).toHaveFocus()
    expect(server.to(post)).toHaveLength(0)
  })

  it('says an address the server will not take is waited for already, or a member’s', async () => {
    const server = createServer()
    server.on(post, () => invalid('/email'))
    const { user } = await composer(server)
    await user.type(address(), 'petr@tilcerovi.cz')
    await user.selectOptions(level('Finance'), 'Can see')
    await user.click(send())
    await waitFor(() => {
      expect(address()).toHaveAccessibleDescription(
        'An invitation is already waiting for this address, or it belongs to somebody who is a member already. The invitations and the member list show which.',
      )
    })
    await waitFor(() => {
      expect(address()).toHaveFocus()
    })
    expect(screen.getByRole('link', { name: 'Go to the invitations' })).toHaveAttribute(
      'href',
      inHousehold.invitations(home),
    )
    // Said beside its field, and nowhere else; and everything is as it was set.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(address()).toHaveValue('petr@tilcerovi.cz')
    expect(level('Finance')).toHaveValue('view')
  })

  // The refusal was of the address. Another way of inviting puts the address away, and its
  // sentence with it: nothing is said anew, as a failure, of a press that was answered already.
  it('says nothing anew of a refused address when another way of inviting is chosen', async () => {
    const server = createServer()
    server.on(post, () => invalid('/email'))
    const { user } = await composer(server)
    await user.type(address(), 'petr@tilcerovi.cz')
    await user.click(send())
    await waitFor(() => {
      expect(address()).toHaveAccessibleDescription(/^An invitation is already waiting/)
    })
    await user.click(screen.getByRole('radio', { name: 'By a link I send myself' }))
    expect(screen.queryByRole('textbox', { name: 'Their email address' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('The invitation was not sent')).not.toBeInTheDocument()
    // Chosen again, the address is as it was refused, and says so still.
    await user.click(screen.getByRole('radio', { name: 'By email, to one person' }))
    expect(address()).toHaveAccessibleDescription(/^An invitation is already waiting/)
  })

  it('reads the server’s own word that an address is missing, or is no address', async () => {
    const server = createServer()
    server.on(post, () => invalid('/email', 'required'))
    const { user } = await composer(server)
    await user.type(address(), 'babicka@example.cz')
    await user.click(send())
    await waitFor(() => {
      expect(address()).toHaveAccessibleDescription('Enter the address the invitation goes to.')
    })
    server.on(post, () => invalid('/email', 'format'))
    await user.click(send())
    await waitFor(() => {
      expect(address()).toHaveAccessibleDescription(
        'That address is missing something. Or send a link instead.',
      )
    })
  })

  it('says a level the server refused on its own row, which takes the focus', async () => {
    const server = createServer()
    server.on(post, () => invalid('/grants/finance'))
    const { user } = await composer(server)
    await user.type(address(), 'babicka@example.cz')
    await user.click(send())
    await waitFor(() => {
      expect(level('Finance')).toHaveAccessibleDescription(
        expect.stringContaining('This role can’t be given that level here. Choose another.'),
      )
    })
    await waitFor(() => {
      expect(level('Finance')).toHaveFocus()
    })
    expect(level('Tasks')).not.toHaveAttribute('aria-invalid')
  })

  it('says a message the server refused on the message, which takes the focus', async () => {
    const server = createServer()
    server.on(post, () => invalid('/message'))
    const { user } = await composer(server)
    await user.type(address(), 'babicka@example.cz')
    const message = screen.getByRole('textbox', { name: 'A message (optional)' })
    await user.type(message, 'Ahoj')
    await user.click(send())
    await waitFor(() => {
      expect(message).toHaveAccessibleDescription(
        expect.stringContaining(
          'The message can’t be sent as it is written. Keep it to 500 characters of plain text.',
        ),
      )
    })
    await waitFor(() => {
      expect(message).toHaveFocus()
    })
  })

  it('says how many a link may take where the server refused the number', async () => {
    const server = createServer()
    server.on(post, () => invalid('/max_uses', 'maximum'))
    const { user } = await composer(server)
    await user.click(screen.getByRole('radio', { name: 'By a link I send myself' }))
    await user.click(screen.getByRole('button', { name: 'Make the link' }))
    const uses = screen.getByRole('spinbutton', { name: 'How many people may use it' })
    await waitFor(() => {
      expect(uses).toHaveAccessibleDescription(
        expect.stringContaining('Choose a number from 1 to 12.'),
      )
    })
    await waitFor(() => {
      expect(uses).toHaveFocus()
    })
  })

  it('says nothing was sent when the server could not be reached, and keeps what was set', async () => {
    const server = createServer()
    server.on(post, () => Promise.reject(new TypeError('offline')))
    const { user } = await composer(server)
    await user.type(address(), 'babicka@example.cz')
    await user.selectOptions(level('Finance'), 'Can see')
    await user.click(send())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The invitation was not sent')
    expect(alert).toHaveTextContent(/We couldn’t reach Household\. Nothing you typed was lost\./)
    expect(address()).toHaveValue('babicka@example.cz')
    expect(level('Finance')).toHaveValue('view')

    // Asked again, it is the same invitation: an answer that was lost makes no second one.
    taking(server)
    await user.click(send())
    await screen.findByText('Sent to babicka@example.cz. It works for 14 days.')
    const [first, second] = await Promise.all(
      server.to(post).map(async (request) => (await request.clone().json()) as { id: string }),
    )
    expect(first?.id).toMatch(uuid)
    expect(second?.id).toBe(first?.id)
  })

  it('says when to try again where the household has sent its twenty for the day', async () => {
    const server = createServer()
    server.on(post, () => problem(429, 'rate_limited', {}, { 'Retry-After': '3600' }))
    const { user } = await composer(server)
    await user.type(address(), 'babicka@example.cz')
    await user.click(send())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The invitation was not sent')
    expect(alert).toHaveTextContent(/Too many attempts\. Try again at \d/)
  })

  it('says a link was not made, in a link’s own words', async () => {
    const server = createServer()
    server.on(post, () => problem(500, 'internal'))
    const { user } = await composer(server)
    await user.click(screen.getByRole('radio', { name: 'By a link I send myself' }))
    await user.click(screen.getByRole('button', { name: 'Make the link' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The link was not made')
    expect(alert).toHaveTextContent(/Something went wrong at our end\./)
  })

  // The first request took effect and its answer never came: sent again, it is refused by the
  // key it left with, and the invitation is in the list all the same.
  it('says to look in the list where the answer to an invitation was lost', async () => {
    const server = createServer()
    server.on(post, () => problem(409, 'idempotency_in_progress'))
    const { user } = await composer(server)
    await user.type(address(), 'babicka@example.cz')
    await user.click(send())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'The answer to that was lost on its way back, so the invitation may have gone out all the same. Look in the invitations before you send it again.',
    )
    expect(within(alert).getByRole('link', { name: 'Go to the invitations' })).toHaveAttribute(
      'href',
      inHousehold.invitations(home),
    )
    expect(alert).not.toHaveTextContent('The invitation was not sent')
  })

  // Pressed again after an answer that was lost, the invitation's own id is refused: the link
  // exists, nobody was shown it, and what is made next is another one.
  it('says a link whose answer was lost is to be withdrawn, and makes another under a new id', async () => {
    const server = createServer()
    server.on(post, () => invalid('/id'))
    const { user } = await composer(server)
    await user.click(screen.getByRole('radio', { name: 'By a link I send myself' }))
    await user.click(screen.getByRole('button', { name: 'Make the link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The answer to that was lost on its way back, and a link is shown only once. If the invitations show a new link, withdraw it, then make another here.',
    )
    taking(server, { email: null, url: 'https://household.example/invitation#0tZ9_x' })
    await user.click(screen.getByRole('button', { name: 'Make the link' }))
    await screen.findByRole('textbox', { name: 'The link' })
    const [first, second] = await Promise.all(
      server.to(post).map(async (request) => (await request.clone().json()) as { id: string }),
    )
    expect(second?.id).toMatch(uuid)
    expect(second?.id).not.toBe(first?.id)
  })

  it('is asked at once with no connection, says so, and is sent by nothing when one returns', async () => {
    const server = createServer()
    server.on(post, () => Promise.reject(new TypeError('offline')))
    const { user } = await composer(server)
    await user.type(address(), 'babicka@example.cz')
    onlineManager.setOnline(false)
    try {
      await user.click(send())
      expect(await screen.findByRole('alert')).toHaveTextContent('The invitation was not sent')
      expect(send()).not.toHaveAttribute('aria-busy')
    } finally {
      onlineManager.setOnline(true)
    }
    expect(server.to(post)).toHaveLength(1)
  })

  it('says, before it is pressed, that an invitation needs a connection as it is sent', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    await composer()
    expect(screen.getByText('An invitation can’t be sent offline')).toBeInTheDocument()
    expect(
      screen.getByText(
        'It carries your name to somebody else’s phone, so it needs a connection at the moment you send it. What you set here stays while this page is open.',
      ),
    ).toBeInTheDocument()
    // The form is there to be filled in all the same.
    expect(address()).toBeInTheDocument()
    expect(send()).toBeInTheDocument()
  })
})

describe('an owner whose own address is not verified', () => {
  const why =
    /^An invitation carries your name to somebody else’s phone, so your own address is confirmed before one goes\./

  it('is told so in the form’s place from the first, with the way to verify', async () => {
    const server = createServer({ ...jana, email_verified: false })
    await composer(server)
    const title = screen.getByText('Verify your email first')
    expect(screen.getByText(why)).toBeInTheDocument()
    // There as the screen opened: read in its place, and announced as nothing that arrived.
    expect(title.closest('[role="status"], [role="alert"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send the invitation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Send the verification link again' }),
    ).toBeInTheDocument()
    expect(server.to(post)).toHaveLength(0)
  })

  it('is told so where the server refuses, and finds what was set once the address is proven', async () => {
    const server = createServer()
    server.on(post, () => problem(403, 'account_unverified'))
    const { user } = await composer(server)
    await user.type(address(), 'babicka@example.cz')
    await user.selectOptions(level('Finance'), 'Can see')
    await user.click(send())
    // The answer to the press: said as it arrives, its words drawn a moment after its region.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^Verify your email first/)
    })
    expect(screen.getByText(why)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send the invitation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // The button that was pressed went with the form: the focus is on the screen's own place.
    expect(document.activeElement).toContainElement(screen.getByRole('status'))

    // The address is proven in the tab its email's link opened, and the account is read again
    // when this page is looked at again: the form is back as it was left.
    act(() => {
      focusManager.setFocused(true)
    })
    expect(await screen.findByRole('button', { name: 'Send the invitation' })).toBeInTheDocument()
    expect(address()).toHaveValue('babicka@example.cz')
    expect(level('Finance')).toHaveValue('view')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('the composer, for whoever may not invite', () => {
  it('tells a member who reads the invitations whose it is to invite, and draws no form', async () => {
    const server = createServer(accountOf(petr))
    await composer(server)
    expect(
      await screen.findByText('Inviting somebody is for an owner: Jana Tilcerová.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the invitations' })).toHaveAttribute(
      'href',
      inHousehold.invitations(home),
    )
    // Said once, in the screen's own words.
    expect(screen.queryByText(/^You can read everything here/)).not.toBeInTheDocument()
  })

  it('is not available to a member who holds nothing on household settings, and asks nothing', async () => {
    const server = createServer(accountOf(klara))
    await composer(server)
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link doesn’t open anything here.' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute(
      'href',
      inHousehold.home(home),
    )
    expect(server.to(`GET /households/${home}/modules`)).toHaveLength(0)
    expect(server.to(`GET /households/${home}/members`)).toHaveLength(0)
  })

  // A child profile's default on household settings is nothing (FR-AC4).
  it('is not available to a child profile', async () => {
    await composer(createServer(accountOf(adam)))
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link doesn’t open anything here.' }),
    ).toBeInTheDocument()
  })

  it('says in a read-only household that inviting is a write, to its owner too', async () => {
    const server = createServer()
    server.household = {
      ...tilcerovi,
      entitlement: { state: 'read_only', can_write: false, can_upload: false },
    }
    await composer(server)
    expect(screen.getByText('Read-only: no new members for now')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Inviting is a write, and writes are off until the subscription resumes. Everybody already in the household keeps reading.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says in a restricted household that an owner lifts it', async () => {
    const server = createServer()
    server.household = {
      ...tilcerovi,
      entitlement: { state: 'restricted', can_write: false, can_upload: false },
    }
    await composer(server)
    expect(screen.getByText('Restricted: no new members for now')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Inviting is a write, and writes are off until an owner lifts the restriction. Everybody already in the household keeps reading.',
      ),
    ).toBeInTheDocument()
  })

  it('says the household went read-only where the server refuses for it, and draws it so', async () => {
    const server = createServer()
    server.on(post, () => {
      server.household = {
        ...tilcerovi,
        entitlement: { state: 'read_only', can_write: false, can_upload: false },
      }
      return problem(402, 'entitlement_read_only', { state: 'read_only', remedy: 'contact_owner' })
    })
    const { user } = await composer(server)
    await user.type(address(), 'babicka@example.cz')
    await user.click(send())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The invitation was not sent')
    expect(alert).toHaveTextContent('The household is read-only now, so nothing was changed.')
    // The household is read again, and the form gives way to why there is none.
    expect(await screen.findByText('Read-only: no new members for now')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send the invitation' })).not.toBeInTheDocument()
    // What the press came to is still said, by the banner that said it: it is not said twice.
    expect(screen.getByRole('alert')).toBe(alert)
    await waitFor(() => {
      expect(document.activeElement).toContainElement(alert)
    })
  })

  it('tells a member who is an owner no longer, and whose it is to invite now', async () => {
    const server = createServer()
    server.on(post, () => {
      server.household = readBy({ ...memberOf(jana.id), role: 'member' })
      return problem(403, 'forbidden')
    })
    const { user } = await composer(server)
    await user.type(address(), 'babicka@example.cz')
    await user.click(send())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an owner can change this, and you are not one any more. Nothing was changed.',
    )
    expect(await screen.findByText(/^Inviting somebody is for an owner/)).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('says that access changed when it is lowered while the composer is open', async () => {
    const server = createServer(accountOf(petr))
    await composer(server)
    await screen.findByText('Inviting somebody is for an owner: Jana Tilcerová.')
    server.household = readBy(memberOf(klara))
    act(() => {
      focusManager.setFocused(true)
    })
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Your access changed, so this is no longer part of your app. Nobody deleted anything.',
      )
    })
    expect(screen.queryByText(/^Inviting somebody is for an owner/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Household settings' })).toHaveAttribute(
      'href',
      inHousehold.settings(home),
    )
  })

  it('says that access changed where the server no longer finds the invitations for them', async () => {
    const server = createServer()
    server.on(post, () => problem(404, 'not_found'))
    const { user } = await composer(server)
    await user.type(address(), 'babicka@example.cz')
    await user.click(send())
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Your access changed, so this is no longer part of your app. Nobody deleted anything.',
      )
    })
    expect(screen.queryByRole('button', { name: 'Send the invitation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
