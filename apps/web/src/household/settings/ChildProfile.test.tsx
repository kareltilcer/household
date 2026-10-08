// A child profile's own part of its page (PRD 17 FR-HA7; PRD 02 §6): what every reader is told
// of it, and what an owner does to it: unlock it, set a new PIN, set its picture, and give it a
// sign-in of its own.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { inHousehold } from '../../app/paths.ts'
import type { Membership } from '../data.ts'
import {
  accountOf,
  adam,
  createServer,
  home,
  invalid,
  jana,
  memberOf,
  noContent,
  open,
  origin,
  petr,
  problem,
  tilcerovi,
  type HouseholdServer,
} from '../testing.tsx'

const at = `/households/${home}`
const profile = `${at}/children/${adam}`

/** Changes the child profile as the server holds it. */
function change(server: HouseholdServer, more: Partial<Membership>): Membership {
  const next = { ...memberOf(adam, server.members), ...more }
  server.members = server.members.map((each) => (each.user_id === adam ? next : each))
  return next
}

/** Whether the profile is locked, as the server holds it. */
function lock(server: HouseholdServer, locked: boolean): void {
  change(server, { child: { ...memberOf(adam, server.members).child, pin_locked: locked } })
}

/** Opens Adam's page, and waits until his own part of it is drawn. */
async function page(server: HouseholdServer = createServer()) {
  const opened = open(inHousehold.member(home, adam), server)
  const part = await screen.findByRole('region', { name: 'Adam’s profile' })
  return { ...opened, part }
}

describe('a child profile’s own part of its page', () => {
  it('tells an owner how the profile signs in, its year of birth and that Home is locked, and offers its controls', async () => {
    const { part } = await page()
    expect(
      within(part).getByText(
        'Adam signs in with the household’s code, their profile and a PIN. A child profile has no email address.',
      ),
    ).toBeInTheDocument()
    expect(
      within(part)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Year of birth', 'Home'])
    // A year, and no quantity: written without a separator.
    expect(within(part).getByText('2014')).toBeInTheDocument()
    expect(
      within(part).getByText('Locked: Adam sees the Home an owner set, and can’t rearrange it.'),
    ).toBeInTheDocument()
    expect(
      within(part)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Set a new PIN', 'Give Adam their own sign-in', 'Choose a picture'])
    // It is not locked: nothing says it is, and there is nothing to unlock.
    expect(within(part).queryByText('This profile is locked')).not.toBeInTheDocument()
    // Whether Home is locked was chosen when the profile was made: nothing here changes it.
    expect(within(part).queryByRole('switch')).not.toBeInTheDocument()
    expect(within(part).queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('tells a member the same without the controls, and no year the answer does not carry', async () => {
    const server = createServer(accountOf(petr))
    // A child's year of birth is the owners' and the child's to read.
    change(server, { child: { ...memberOf(adam).child, year_of_birth: null } })
    const { part } = await page(server)
    expect(within(part).getByText(/^Adam signs in with the household’s code/)).toBeInTheDocument()
    expect(
      within(part)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Home'])
    expect(within(part).queryByRole('button')).not.toBeInTheDocument()
  })

  it('says Home is the profile’s own to arrange where it is not locked', async () => {
    const server = createServer(accountOf(adam))
    change(server, { child: { ...memberOf(adam).child, dashboard_locked: false } })
    const { part } = await page(server)
    expect(within(part).getByText('Not locked: Adam arranges their own.')).toBeInTheDocument()
    // The child reads their own year, and has no control of their own profile.
    expect(within(part).getByText('2014')).toBeInTheDocument()
    expect(within(part).queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers an owner nothing in a household that takes no writes', async () => {
    const server = createServer()
    server.household = {
      ...tilcerovi,
      entitlement: { state: 'read_only', can_write: false, can_upload: false },
    }
    lock(server, true)
    const { part } = await page(server)
    // That it is locked is still said: it is so, whoever may lift it.
    expect(within(part).getByText('This profile is locked')).toBeInTheDocument()
    expect(within(part).queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('a locked child profile', () => {
  const calm =
    'Ten wrong PINs in a row locked it, which is how a guesser is kept out. Nothing is lost and nobody is in trouble. It stays locked until an owner unlocks it or sets a new PIN.'

  it('says so calmly, in its place, and to a member without a way to lift it', async () => {
    const server = createServer(accountOf(petr))
    lock(server, true)
    const { part } = await page(server)
    expect(within(part).getByText('This profile is locked')).toBeInTheDocument()
    const said = within(part).getByText(calm)
    // It was so when the page opened: read where it stands, and announced to nobody.
    expect(said.closest('[role="status"], [role="alert"]')).toBeNull()
    expect(within(part).queryByRole('button')).not.toBeInTheDocument()
  })

  it('is unlocked by an owner, and hands the focus to the control that stays', async () => {
    const server = createServer()
    lock(server, true)
    server.on(`POST ${profile}/unlock`, () => {
      lock(server, false)
      change(server, { version: 2 })
      return noContent()
    })
    const { user, part } = await page(server)
    expect(within(part).getByText(calm)).toBeInTheDocument()
    const asked = server.to(`GET ${at}/members/${adam}`).length
    await user.click(within(part).getByRole('button', { name: 'Unlock the profile' }))

    expect(await screen.findByText('Adam can sign in again with the same PIN.')).toBeInTheDocument()
    expect(server.to(`POST ${profile}/unlock`)).toHaveLength(1)
    // The banner leaves with the lock, and its button with it.
    await waitFor(() => {
      expect(within(part).queryByText('This profile is locked')).not.toBeInTheDocument()
    })
    expect(within(part).queryByRole('button', { name: 'Unlock the profile' })).toBeNull()
    await waitFor(() => {
      expect(within(part).getByRole('button', { name: 'Set a new PIN' })).toHaveFocus()
    })
    // The member is read again, for the version the unlock moved.
    await waitFor(() => {
      expect(server.to(`GET ${at}/members/${adam}`).length).toBeGreaterThan(asked)
    })
    expect(within(part).queryByText('This profile is locked')).not.toBeInTheDocument()
  })

  it('says an unlock could not reach the server, and stays locked', async () => {
    const server = createServer()
    lock(server, true)
    server.on(`POST ${profile}/unlock`, () => Promise.reject(new TypeError('offline')))
    const { user, part } = await page(server)
    await user.click(within(part).getByRole('button', { name: 'Unlock the profile' }))
    expect(await within(part).findByRole('alert')).toHaveTextContent(
      /^We couldn’t reach Household\./,
    )
    expect(within(part).getByText('This profile is locked')).toBeInTheDocument()
  })
})

describe('a new PIN for a child profile', () => {
  async function sheet(server: HouseholdServer = createServer()) {
    const opened = await page(server)
    await opened.user.click(within(opened.part).getByRole('button', { name: 'Set a new PIN' }))
    const panel = screen.getByRole('dialog', { name: 'A new PIN for Adam' })
    return {
      ...opened,
      panel,
      first: within(panel).getByLabelText('New PIN'),
      second: within(panel).getByLabelText('The same PIN again'),
      set: within(panel).getByRole('button', { name: 'Set the PIN' }),
    }
  }

  it('says what a new PIN does before it is typed', async () => {
    const { panel, first } = await sheet()
    expect(panel).toHaveAccessibleDescription(
      'The old PIN stops working on every device at once, and Adam is signed out everywhere. A locked profile is unlocked by it. Tell Adam the new PIN in person: Household sends it nowhere.',
    )
    expect(first).toHaveAttribute('inputmode', 'numeric')
    expect(first).toHaveAttribute('autocomplete', 'new-password')
    expect(first).toHaveAttribute('type', 'password')
    expect(first).toHaveAccessibleDescription('4 to 6 digits.')
  })

  it('asks for 4 to 6 digits, typed the same twice, before it asks the server', async () => {
    const server = createServer()
    const { user, first, second, set } = await sheet(server)
    await user.type(first, '12a')
    await user.click(set)
    expect(first).toHaveAccessibleDescription(
      expect.stringContaining('A PIN is 4 to 6 digits, and nothing else.'),
    )
    await waitFor(() => {
      expect(first).toHaveFocus()
    })

    await user.clear(first)
    await user.type(first, '1234567')
    await user.click(set)
    expect(first).toHaveAccessibleDescription(
      expect.stringContaining('A PIN is 4 to 6 digits, and nothing else.'),
    )

    await user.clear(first)
    await user.type(first, '4821')
    await user.type(second, '4812')
    await user.click(set)
    expect(first).toHaveAccessibleDescription('4 to 6 digits.')
    expect(second).toHaveAccessibleDescription('The two PINs don’t match.')
    await waitFor(() => {
      expect(second).toHaveFocus()
    })
    expect(server.to(`PUT ${profile}/pin`)).toHaveLength(0)
  })

  it('sets the PIN, says so without saying it, and unlocks the profile', async () => {
    const server = createServer()
    lock(server, true)
    server.on(`PUT ${profile}/pin`, () => {
      lock(server, false)
      change(server, { version: 2 })
      return noContent()
    })
    const { user, part, first, second, set } = await sheet(server)
    await user.type(first, '482193')
    await user.type(second, '482193')
    await user.click(set)

    expect(await screen.findByText('Adam’s PIN is changed.')).toBeInTheDocument()
    expect(await server.body(`PUT ${profile}/pin`)).toEqual({ pin: '482193' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Never the PIN itself: the owner says it, in person.
    expect(document.body).not.toHaveTextContent('482193')
    await waitFor(() => {
      expect(within(part).queryByText('This profile is locked')).not.toBeInTheDocument()
    })
  })

  it('says what the server refused the PIN for on its field, which takes the focus', async () => {
    const server = createServer()
    server.on(`PUT ${profile}/pin`, () => invalid('/pin', 'pattern'))
    const { user, first, second, set } = await sheet(server)
    await user.type(first, '4821')
    await user.type(second, '4821')
    await user.click(set)
    await waitFor(() => {
      expect(first).toHaveAccessibleDescription(
        expect.stringContaining('A PIN is 4 to 6 digits, and nothing else.'),
      )
    })
    await waitFor(() => {
      expect(first).toHaveFocus()
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('says a new PIN could not reach the server, and keeps the panel open', async () => {
    const server = createServer()
    server.on(`PUT ${profile}/pin`, () => Promise.reject(new TypeError('offline')))
    const { user, panel, first, second, set } = await sheet(server)
    await user.type(first, '4821')
    await user.type(second, '4821')
    await user.click(set)
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      /^We couldn’t reach Household\./,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes on a profile that is a child profile no longer, and says it is gone', async () => {
    const server = createServer()
    server.on(`PUT ${profile}/pin`, () => {
      // Adam finished the sign-in of his own a moment ago: he is a member now.
      change(server, { role: 'member', child: null, version: 3 })
      return problem(404, 'not_found')
    })
    const { user, first, second, set } = await sheet(server)
    await user.type(first, '4821')
    await user.type(second, '4821')
    await user.click(set)
    expect(
      await screen.findByText(
        'That is no longer there to change. The page shows how things stand now.',
      ),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    // Read again, the page is a member's: the profile's own part has left it.
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Adam’s profile' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Make Adam an owner' })).toBeInTheDocument()
  })
})

describe('a child profile’s picture', () => {
  const address = `${origin}/files/adam`

  /** The form a browser would send, as far as a test needs it: which parts it was given. */
  function parts(): (readonly [string, unknown])[] {
    const given: (readonly [string, unknown])[] = []
    vi.stubGlobal(
      'FormData',
      class {
        set(name: string, value: unknown) {
          given.push([name, value])
        }
      },
    )
    return given
  }

  function chooser(container: HTMLElement): HTMLInputElement {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    if (input === null) throw new Error('no file input')
    return input
  }

  const file = new File(['picture'], 'adam.png', { type: 'image/png' })

  it('is chosen, said to be saved, and removed, the focus going to the control that stays', async () => {
    const server = createServer()
    server.on(`PUT ${profile}/avatar`, () =>
      Response.json(change(server, { avatar_url: address, version: 2 })),
    )
    server.on(`DELETE ${profile}/avatar`, () =>
      Response.json(change(server, { avatar_url: null, version: 3 })),
    )
    const given = parts()
    const { user, part, container } = await page(server)
    fireEvent.change(chooser(container), { target: { files: [file] } })

    const remove = await within(part).findByRole('button', { name: 'Remove picture' })
    const [sent] = server.to(`PUT ${profile}/avatar`)
    // A multipart body with the one part the contract names: never JSON.
    expect(given).toEqual([['file', file]])
    expect(sent?.headers.get('Content-Type')).not.toBe('application/json')
    expect(container.querySelector('img')).toHaveAttribute('src', address)
    expect(await screen.findByText('Adam’s picture is saved.')).toBeInTheDocument()
    expect(within(part).getByRole('button', { name: 'Change picture' })).toBeInTheDocument()

    await user.click(remove)
    await waitFor(() => {
      expect(within(part).queryByRole('button', { name: 'Remove picture' })).toBeNull()
    })
    expect(server.to(`DELETE ${profile}/avatar`)).toHaveLength(1)
    expect(within(part).getByRole('button', { name: 'Choose a picture' })).toHaveFocus()
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })

  it('gives each refusal its sentence, and changes no picture', async () => {
    const server = createServer()
    parts()
    const { part, container } = await page(server)

    server.on(`PUT ${profile}/avatar`, () => problem(413, 'payload_too_large'))
    fireEvent.change(chooser(container), { target: { files: [file] } })
    expect(await within(part).findByRole('alert')).toHaveTextContent(
      'That picture is over 20 MB. Choose a smaller one. The picture was not changed.',
    )

    server.on(`PUT ${profile}/avatar`, () => problem(415, 'unsupported_media_type'))
    fireEvent.change(chooser(container), { target: { files: [file] } })
    expect(
      await within(part).findByText(
        'That file isn’t a picture Household can use. Choose a JPEG, PNG, GIF or WebP image. The picture was not changed.',
      ),
    ).toBeInTheDocument()

    server.on(`PUT ${profile}/avatar`, () =>
      problem(402, 'entitlement_read_only', { state: 'grace', remedy: 'subscribe' }),
    )
    fireEvent.change(chooser(container), { target: { files: [file] } })
    expect(
      await within(part).findByText(
        'The household takes no uploads just now, so the picture was not changed.',
      ),
    ).toBeInTheDocument()
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })

  it('draws initials where the picture’s link no longer loads', async () => {
    const server = createServer()
    change(server, { avatar_url: `${origin}/files/expired` })
    const { container } = await page(server)
    const picture = container.querySelector('img')
    if (picture === null) throw new Error('no picture')
    fireEvent.error(picture)
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })

  // Grace writes and takes no upload (PRD 04 §3): a picture is still removed, and none chosen.
  it('offers no picture to choose in a household that takes no uploads, and still removes one', async () => {
    const server = createServer()
    server.household = {
      ...tilcerovi,
      entitlement: { state: 'grace', can_write: true, can_upload: false },
    }
    change(server, { avatar_url: address })
    server.on(`DELETE ${profile}/avatar`, () =>
      Response.json(change(server, { avatar_url: null, version: 2 })),
    )
    const { user, part, container } = await page(server)
    expect(container.querySelector('input[type="file"]')).not.toBeInTheDocument()
    expect(within(part).queryByRole('button', { name: /picture$/ })).toHaveTextContent(
      'Remove picture',
    )
    await user.click(within(part).getByRole('button', { name: 'Remove picture' }))
    await waitFor(() => {
      expect(within(part).queryByRole('button', { name: 'Remove picture' })).toBeNull()
    })
    // Nothing is left to choose with: the focus is on the picture's own place, and not on nothing.
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toContainElement(within(part).getByText('Picture'))
  })
})

describe('giving a child profile a sign-in of its own', () => {
  const sent = () => new Response(null, { status: 202 })

  async function sheet(server: HouseholdServer = createServer()) {
    const opened = await page(server)
    await opened.user.click(
      within(opened.part).getByRole('button', { name: 'Give Adam their own sign-in' }),
    )
    const panel = screen.getByRole('dialog', { name: 'Give Adam their own sign-in' })
    return { ...opened, panel }
  }

  it('says what it does before it asks for anything', async () => {
    const { panel } = await sheet()
    expect(
      within(panel).getByText(
        'Nothing is lost or copied: Adam stays the same person here, with an email address and a password in place of the PIN.',
      ),
    ).toBeInTheDocument()
    expect(
      within(panel).getByText(
        'A link goes to the address. Once Adam has opened it and chosen a password, they are a member, with the levels they hold now and everything they made, and Home unlocks.',
      ),
    ).toBeInTheDocument()
    expect(
      within(panel).getByText(
        'From then on the owners can no longer read Adam’s private notes: that is for child profiles only.',
      ),
    ).toBeInTheDocument()
    const address = within(panel).getByRole('textbox', { name: 'Their email address' })
    expect(address).toHaveAccessibleDescription(
      'The link is sent here, and this becomes the address they sign in with.',
    )
    expect(
      within(panel)
        .getAllByRole('button')
        .slice(-2)
        .map((button) => button.textContent),
    ).toEqual(['Cancel', 'Send the link'])
  })

  it('asks for an address that could be one before it asks the server', async () => {
    const server = createServer()
    const { user, panel } = await sheet(server)
    const address = within(panel).getByRole('textbox', { name: 'Their email address' })
    await user.click(within(panel).getByRole('button', { name: 'Send the link' }))
    expect(address).toHaveAccessibleDescription(
      expect.stringContaining('Enter the address the link is sent to.'),
    )
    await waitFor(() => {
      expect(address).toHaveFocus()
    })
    await user.type(address, 'adam')
    await user.click(within(panel).getByRole('button', { name: 'Send the link' }))
    expect(address).toHaveAccessibleDescription(
      expect.stringContaining('That email is missing something.'),
    )
    expect(server.to(`POST ${profile}/graduate`)).toHaveLength(0)
  })

  it('sends the link, says in the form’s place what happens next, and says it once more as it closes', async () => {
    const server = createServer()
    server.on(`POST ${profile}/graduate`, sent)
    const { user, panel, part } = await sheet(server)
    await user.type(
      within(panel).getByRole('textbox', { name: 'Their email address' }),
      ' adam@tilcerovi.cz ',
    )
    await user.click(within(panel).getByRole('button', { name: 'Send the link' }))

    // Said as it arrives, where the form stood.
    const said = await within(panel).findByRole('status')
    await waitFor(() => {
      expect(said).toHaveTextContent(
        'A link is on its way to adam@tilcerovi.cz. It works for 14 days.',
      )
    })
    expect(said).toHaveTextContent(
      'Until it is used, Adam is still a child profile and signs in with the PIN.',
    )
    expect(said).toHaveTextContent(
      'Sending another link, to the same address or a corrected one, retires this one.',
    )
    expect(await server.body(`POST ${profile}/graduate`)).toEqual({ email: 'adam@tilcerovi.cz' })
    expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Send the link' })).toBeNull()
    // The form's button went with the form: the focus is on the one that ends the panel.
    const done = within(panel).getByRole('button', { name: 'Done' })
    await waitFor(() => {
      expect(done).toHaveFocus()
    })

    await user.click(done)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText('A link was sent to adam@tilcerovi.cz.')).toBeInTheDocument()
    // The membership does not say a link is out, and neither does the page: Adam is a child still.
    expect(within(part).getByRole('button', { name: 'Give Adam their own sign-in' })).toBeVisible()
  })

  it('says of an address an account has only that it cannot be used here', async () => {
    const server = createServer()
    server.on(`POST ${profile}/graduate`, () => problem(409, 'email_taken'))
    const { user, panel } = await sheet(server)
    const address = within(panel).getByRole('textbox', { name: 'Their email address' })
    await user.type(address, 'petr@tilcerovi.cz')
    await user.click(within(panel).getByRole('button', { name: 'Send the link' }))
    await waitFor(() => {
      expect(address).toHaveAccessibleDescription(
        expect.stringContaining('That address can’t be used here. Another one can.'),
      )
    })
    await waitFor(() => {
      expect(address).toHaveFocus()
    })
    expect(address).toHaveValue('petr@tilcerovi.cz')
    expect(panel).not.toHaveTextContent(/account/i)
  })

  it('says what the server refused the address for on its field', async () => {
    const server = createServer()
    server.on(`POST ${profile}/graduate`, () => invalid('/email', 'format'))
    const { user, panel } = await sheet(server)
    const address = within(panel).getByRole('textbox', { name: 'Their email address' })
    await user.type(address, 'adam@tilcerovi')
    await user.click(within(panel).getByRole('button', { name: 'Send the link' }))
    await waitFor(() => {
      expect(address).toHaveAccessibleDescription(
        expect.stringContaining('That email is missing something.'),
      )
    })
  })

  it('says when the household has sent too many links today, and keeps what was typed', async () => {
    const server = createServer()
    server.on(`POST ${profile}/graduate`, () => problem(429, 'rate_limited'))
    const { user, panel } = await sheet(server)
    const address = within(panel).getByRole('textbox', { name: 'Their email address' })
    await user.type(address, 'adam@tilcerovi.cz')
    await user.click(within(panel).getByRole('button', { name: 'Send the link' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in a little while.',
    )
    expect(address).toHaveValue('adam@tilcerovi.cz')
  })

  it('says to verify first to an owner whose own address is not verified, from the first', async () => {
    const server = createServer({ ...jana, email_verified: false })
    const { panel } = await sheet(server)
    expect(within(panel).getByText('Verify your email first')).toBeInTheDocument()
    const why = within(panel).getByText(
      /^The link carries the household’s name to somebody’s mailbox on your word, so your own address is confirmed first\./,
    )
    // It was so when the panel opened: read in its place.
    expect(why.closest('[role="status"], [role="alert"]')).toBeNull()
    expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Send the link' })).toBeNull()
    expect(
      within(panel).getByRole('button', { name: 'Send the verification link again' }),
    ).toBeInTheDocument()
    expect(server.to(`POST ${profile}/graduate`)).toHaveLength(0)
  })

  it('takes the server’s word that the owner’s address is not verified, in the form’s place', async () => {
    const server = createServer()
    server.on(`POST ${profile}/graduate`, () => problem(403, 'account_unverified'))
    const { user, panel } = await sheet(server)
    await user.type(
      within(panel).getByRole('textbox', { name: 'Their email address' }),
      'adam@tilcerovi.cz',
    )
    await user.click(within(panel).getByRole('button', { name: 'Send the link' }))
    // The server's answer to a press: said as it arrives.
    const said = await within(panel).findByRole('status')
    await waitFor(() => {
      expect(said).toHaveTextContent('Verify your email first')
    })
    expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Send the link' })).toBeNull()
    await waitFor(() => {
      expect(within(panel).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    })
  })
})
