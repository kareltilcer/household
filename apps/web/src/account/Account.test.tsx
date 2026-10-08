// Account settings (A-19) as a member uses them: each control's save and its refusal, what is
// kept in this browser alone, the households list in its states, and what a child profile has
// none of.
import { catalogs, type Catalog } from '@household/i18n'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { storageKey } from '../display/modes.ts'
import { dropCatalogs, fetchCatalog, holdCatalog } from '../i18n/catalogs.ts'
import { initialsOf } from './Account.tsx'
import {
  chata,
  createServer,
  invalid,
  jana,
  open,
  origin,
  problem,
  tilcerovi,
  type Server,
} from './testing.tsx'

// A language's catalog is fetched when it is chosen, where this page does not hold it: a test
// that says when one arrives answers for the fetch itself.
vi.mock(import('../i18n/catalogs.ts'), async (original) => {
  const actual = await original()
  return { ...actual, fetchCatalog: vi.fn(actual.fetchCatalog) }
})

const title = 'Your account'

async function account(server: Server = createServer()) {
  const opened = open('/account', server)
  await screen.findByRole('heading', { level: 1, name: title })
  return opened
}

describe('the account screen', () => {
  it('is its one title and a section for each thing an account has', async () => {
    await account()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['You', 'Appearance', 'Dates and times', 'Households', 'Account'])
    // What the contract has none of is absent: no export, and no way to create a household.
    expect(screen.queryByText(/export/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument()
  })

  it('saves the name, and says so', async () => {
    const server = createServer()
    server.on('PATCH /me', async (request) => {
      const change = (await request.json()) as { display_name: string }
      server.me = { ...server.me, display_name: change.display_name }
      return Response.json(server.me)
    })
    const { user } = await account(server)
    const name = screen.getByRole('textbox', { name: 'Name' })
    expect(name).toHaveValue('Jana Tilcerová')
    await user.clear(name)
    await user.type(name, '  Jana T.  ')
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    expect(await screen.findByText('Your name is saved.')).toBeInTheDocument()
    expect(await server.body('PATCH /me')).toEqual({ display_name: 'Jana T.' })
    expect(name).toHaveValue('Jana T.')
  })

  it('asks for a name before it asks the server, and says what the server refused', async () => {
    const server = createServer()
    const { user } = await account(server)
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    const missing = 'Add a name — it’s what appears on things you do.'
    expect(name).toHaveAccessibleDescription(expect.stringContaining(missing))
    expect(server.to('PATCH /me')).toHaveLength(0)
    // The focus is on the field to put right, and its sentence is read with it: beside a
    // field the focus is not on, it would be said to nobody who cannot see it.
    await waitFor(() => {
      expect(name).toHaveFocus()
    })

    server.on('PATCH /me', () => invalid('/display_name', 'min_length'))
    await user.type(name, 'x')
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => {
      expect(server.to('PATCH /me')).toHaveLength(1)
    })
    expect(name).toHaveAccessibleDescription(expect.stringContaining(missing))
    await waitFor(() => {
      expect(name).toHaveFocus()
    })
  })

  it('says a save could not reach the server, and loses nothing that was typed', async () => {
    const server = createServer()
    server.on('PATCH /me', () => Promise.reject(new TypeError('offline')))
    const { user } = await account(server)
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Jana')
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => {
      expect(name).toHaveAccessibleDescription(
        expect.stringContaining('We couldn’t reach Household.'),
      )
    })
    expect(name).toHaveValue('Jana')
  })

  it('says the address is verified, and offers nothing to send', async () => {
    await account()
    expect(screen.getByText('jana@tilcerovi.cz · verified')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Send the verification link again' }),
    ).not.toBeInTheDocument()
  })

  it('says an address is not verified, and sends the link again', async () => {
    const server = createServer({ ...jana, email_verified: false })
    server.on('POST /auth/verify-email/resend', () => new Response(null, { status: 202 }))
    const { user } = await account(server)
    expect(screen.getByText('jana@tilcerovi.cz · not verified')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send the verification link again' }))
    expect(
      await screen.findByText(
        'A link is on its way to jana@tilcerovi.cz. Only the newest one works, and it works for 24 hours.',
      ),
    ).toBeInTheDocument()
    expect(await server.body('POST /auth/verify-email/resend')).toEqual({
      email: 'jana@tilcerovi.cz',
    })
  })

  it('uploads a picture, removes one, and gives each refusal its sentence', async () => {
    const server = createServer()
    const address = `${origin}/files/picture`
    server.on('PUT /me/avatar', () => {
      server.me = { ...server.me, avatar_url: address }
      return Response.json(server.me)
    })
    server.on('PATCH /me', () => {
      server.me = { ...server.me, avatar_url: null }
      return Response.json(server.me)
    })
    // The form a browser would send, as far as a test needs it: which parts it was given. The
    // test environment's own `Request` cannot carry jsdom's form with a file in it.
    const parts: (readonly [string, unknown])[] = []
    vi.stubGlobal(
      'FormData',
      class {
        set(name: string, value: unknown) {
          parts.push([name, value])
        }
      },
    )
    const { user, container } = await account(server)
    const chooser = container.querySelector<HTMLInputElement>('input[type="file"]')
    if (chooser === null) throw new Error('no file input')
    const file = new File(['picture'], 'me.png', { type: 'image/png' })

    fireEvent.change(chooser, { target: { files: [file] } })
    const remove = await screen.findByRole('button', { name: 'Remove picture' })
    const [sent] = server.to('PUT /me/avatar')
    // A multipart body with the one part the contract names, whose boundary the transport
    // writes: never JSON.
    expect(parts).toEqual([['file', file]])
    expect(sent?.headers.get('Content-Type')).not.toBe('application/json')
    expect(container.querySelector('img')).toHaveAttribute('src', address)
    // The picture is drawn for the eye alone: that it was saved is said, as the name's save is.
    expect(await screen.findByText('Your picture is saved.')).toBeInTheDocument()

    await user.click(remove)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Remove picture' })).not.toBeInTheDocument()
    })
    expect(await server.body('PATCH /me')).toEqual({ avatar_url: null })
    // The control that was pressed went with the picture: the focus is on the one that stays,
    // which says there is a picture to choose, and not on nothing.
    expect(screen.getByRole('button', { name: 'Choose a picture' })).toHaveFocus()

    server.on('PUT /me/avatar', () => problem(413, 'payload_too_large'))
    fireEvent.change(chooser, { target: { files: [file] } })
    expect(
      await screen.findByText(
        'That picture is over 20 MB. Choose a smaller one. Your picture was not changed.',
      ),
    ).toBeInTheDocument()

    server.on('PUT /me/avatar', () => problem(415, 'unsupported_media_type'))
    fireEvent.change(chooser, { target: { files: [file] } })
    expect(
      await screen.findByText(/That file isn’t a picture Household can use\./),
    ).toBeInTheDocument()
  })

  it('draws initials where a picture’s link no longer loads', async () => {
    const { container } = await account(
      createServer({ ...jana, avatar_url: `${origin}/files/expired` }),
    )
    const picture = container.querySelector('img')
    if (picture === null) throw new Error('no picture')
    fireEvent.error(picture)
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(initialsOf(' jana  tilcerová nováková ')).toBe('JT')
    expect(initialsOf('')).toBe('')
  })

  it('leaves the focus where its member took it while a picture was being removed', async () => {
    const server = createServer({ ...jana, avatar_url: `${origin}/files/picture` })
    let answer: () => void = () => undefined
    server.on(
      'PATCH /me',
      () =>
        new Promise<Response>((resolve) => {
          answer = () => {
            server.me = { ...server.me, avatar_url: null }
            resolve(Response.json(server.me))
          }
        }),
    )
    const { user } = await account(server)
    await user.click(screen.getByRole('button', { name: 'Remove picture' }))
    await waitFor(() => {
      expect(server.to('PATCH /me')).toHaveLength(1)
    })
    // On to the next control before the server has answered: the focus is theirs to keep.
    await user.tab()
    const taken = document.activeElement
    answer()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Remove picture' })).not.toBeInTheDocument()
    })
    expect(taken).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Choose a picture' })).not.toHaveFocus()
  })

  it('names each language in its own, changes the words, and tells the account', async () => {
    const server = createServer()
    server.on('PATCH /me', async (request) => {
      const change = (await request.json()) as { locale: string }
      server.me = { ...server.me, locale: change.locale }
      return Response.json(server.me)
    })
    const { user } = await account(server)
    const language = screen.getByRole('combobox', { name: 'Language' })
    expect(
      within(language)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['English', 'Čeština', 'Slovenčina', 'Deutsch', 'Polski'])
    await user.selectOptions(language, 'cs')
    expect(await screen.findByRole('heading', { level: 1, name: 'Váš účet' })).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('lang', 'cs')
    expect(await server.body('PATCH /me')).toEqual({ locale: 'cs' })
  })

  it('tells the account of the language chosen last, though one chosen before it arrives after', async () => {
    // German is still to be fetched, and Polish this page holds.
    dropCatalogs()
    holdCatalog('en', catalogs.en)
    holdCatalog('pl', catalogs.pl)
    let arrive: (catalog: Catalog) => void = () => undefined
    vi.mocked(fetchCatalog).mockImplementationOnce(
      () =>
        new Promise<Catalog>((resolve) => {
          arrive = resolve
        }),
    )
    const server = createServer()
    server.on('PATCH /me', async (request) => {
      const change = (await request.json()) as { locale: string }
      server.me = { ...server.me, locale: change.locale }
      return Response.json(server.me)
    })
    const { user } = await account(server)
    const language = screen.getByRole('combobox', { name: 'Language' })
    await user.selectOptions(language, 'de')
    await user.selectOptions(language, 'pl')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Twoje konto' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(server.to('PATCH /me')).toHaveLength(1)
    })
    // German's catalog arrives now, for a choice that another has taken the place of.
    await act(async () => {
      arrive(catalogs.de)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(server.to('PATCH /me')).toHaveLength(1)
    expect(await server.body('PATCH /me')).toEqual({ locale: 'pl' })
    expect(document.documentElement).toHaveAttribute('lang', 'pl')
  })

  it('puts the language back where the account could not be told', async () => {
    const server = createServer()
    server.on('PATCH /me', () => problem(500, 'internal'))
    const { user } = await account(server)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'de')
    await waitFor(() => {
      expect(server.to('PATCH /me')).toHaveLength(1)
    })
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    const language = screen.getByRole('combobox', { name: 'Language' })
    expect(language).toHaveValue('en')
    // Said as it arrives: the control is as it was, and holds the focus already.
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Something went wrong at our end\./)
  })

  it('keeps the appearance in this browser alone, and says so', async () => {
    const server = createServer()
    const { user } = await account(server)
    expect(
      screen.getByText(
        'These are kept in this browser alone. Another browser or device has its own.',
      ),
    ).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'dark')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Density' }), 'compact')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Text size' }), '200')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Motion' }), 'reduced')
    const root = document.documentElement
    expect(root).toHaveAttribute('data-theme', 'dark')
    expect(root).toHaveAttribute('data-density', 'compact')
    expect(root).toHaveAttribute('data-scale', '200')
    expect(root).toHaveAttribute('data-motion', 'reduced')
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')).toEqual({
        theme: 'dark',
        density: 'compact',
        scale: '200',
        motion: 'reduced',
      })
    })
    // Nothing of it is the account's.
    expect(server.to('PATCH /me')).toHaveLength(0)
  })

  it('saves a timezone and a first day, and null where they follow something else', async () => {
    const server = createServer({ ...jana, timezone: null, first_day_of_week: 0 })
    server.on('PATCH /me', async (request) => {
      server.me = { ...server.me, ...((await request.json()) as object) }
      return Response.json(server.me)
    })
    const { user } = await account(server)
    const zone = screen.getByRole('combobox', { name: 'Timezone' })
    expect(zone).toHaveDisplayValue('Follow each household’s')
    await user.selectOptions(zone, 'Europe/Prague')
    await waitFor(async () => {
      expect(await server.body('PATCH /me')).toEqual({ timezone: 'Europe/Prague' })
    })
    await waitFor(() => {
      expect(zone).toHaveValue('Europe/Prague')
    })
    await user.selectOptions(zone, '')
    await waitFor(async () => {
      expect(await server.body('PATCH /me')).toEqual({ timezone: null })
    })

    const day = screen.getByRole('combobox', { name: 'First day of the week' })
    expect(day).toHaveDisplayValue('Sunday')
    await user.selectOptions(day, 'Monday')
    await waitFor(async () => {
      expect(await server.body('PATCH /me')).toEqual({ first_day_of_week: 1 })
    })
    await user.selectOptions(day, 'Follow the language')
    await waitFor(async () => {
      expect(await server.body('PATCH /me')).toEqual({ first_day_of_week: null })
    })
  })

  it('puts a choice back when the server refuses it, and says why', async () => {
    const server = createServer()
    server.on('PATCH /me', () => invalid('/timezone'))
    const { user } = await account(server)
    const zone = screen.getByRole('combobox', { name: 'Timezone' })
    await user.selectOptions(zone, 'Europe/Vienna')
    // Said as it arrives, under the control it is of.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That change wasn’t accepted, and the setting is as it was.',
    )
    expect(zone).toHaveValue('Europe/Prague')
  })

  it('lists the member’s households with their role in each, and switches nothing', async () => {
    const server = createServer()
    server.on('GET /households', () => Response.json({ items: [tilcerovi, chata] }))
    await account(server)
    const list = await screen.findByRole('list', { name: 'Households' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual(['TilceroviOwner', 'Chata VysočinaMember'])
    expect(within(list).queryByRole('link')).not.toBeInTheDocument()
    expect(within(list).queryByRole('button')).not.toBeInTheDocument()
  })

  it('says a member is in no household yet, and draws no way to create one', async () => {
    await account()
    expect(await screen.findByText('You are not in a household yet')).toBeInTheDocument()
    expect(screen.getByText(/^Your account is complete on its own\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /household/i })).not.toBeInTheDocument()
  })

  it('says the households could not be read, and reads them again', async () => {
    const server = createServer()
    server.on('GET /households', () => Promise.reject(new TypeError('offline')))
    const { user } = await account(server)
    expect(await screen.findByText('Your households could not be read')).toBeInTheDocument()
    server.on('GET /households', () => Response.json({ items: [chata] }))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: 'Households' })).toBeInTheDocument()
  })

  it('leads to deleting the account', async () => {
    await account()
    expect(screen.getByRole('link', { name: 'Delete account' })).toHaveAttribute(
      'href',
      '/account/delete',
    )
  })

  it('has no address and no deletion for a child profile', async () => {
    await account(
      createServer({
        ...jana,
        email: null,
        email_verified: false,
        is_child: true,
        credentials: ['child_pin'],
      }),
    )
    expect(
      screen.getByText(
        'This is a child profile. It signs in with a PIN on its household’s devices.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Email')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Delete account' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Send the verification link again' }),
    ).not.toBeInTheDocument()
  })
})
