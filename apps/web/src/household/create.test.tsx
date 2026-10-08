// Creating a household (A-22): what the form opens with, read from the device and from the
// countries; the one request it makes and where it leads; each refusal; the invitations that wait
// above it; and its states.
import { onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deviceTimeZone } from '../api/problemText.ts'
import { inHousehold, paths } from '../app/paths.ts'
import { deviceCountry, ownName, timeZones } from './device.ts'
import {
  countries,
  createServer,
  invalid,
  jana,
  open,
  problem,
  tilcerovi,
  type HouseholdServer,
} from './testing.tsx'

// A test that takes the connection away leaves the next one a browser that has it.
afterEach(() => {
  onlineManager.setOnline(true)
})

const title = 'Set up your household'
const unreachable =
  'We couldn’t reach Household. Nothing you typed was lost. Check your connection and try again.'

/** The screens this file holds, each as it is written. */
const sources = import.meta.glob<string>('./Create.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** The languages this device says its member reads, first the one they prefer. */
function deviceReads(...languages: string[]): void {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages)
}

async function creating(server: HouseholdServer = createServer()) {
  const opened = open(paths.householdNew.path, server)
  await screen.findByRole('heading', { level: 1, name: title })
  return opened
}

/** The form, once the countries it offers are read. */
async function form(server: HouseholdServer = createServer()) {
  const opened = await creating(server)
  await screen.findByRole('textbox', { name: /^Name/ })
  return opened
}

const field = (name: string) => screen.getByRole('combobox', { name })
const optionsOf = (control: HTMLElement) =>
  within(control)
    .getAllByRole('option')
    .map((option) => option.textContent)

/** The household the server makes of what it was sent, as its owner then reads it. */
function made(server: HouseholdServer) {
  server.on('POST /households', async (request) => {
    const asked = (await request.json()) as { id: string; name: string }
    return Response.json({ ...tilcerovi, ...asked, version: 1 }, { status: 201 })
  })
}

interface Asked {
  readonly id: string
}

describe('what this device says of where its member is', () => {
  it('is the country its languages name first, of those Household has a profile of', () => {
    // Austria has no profile, German is most likely Germany's, and Britain comes after it.
    expect(deviceCountry(countries, ['de-AT', 'de', 'en-GB'])?.code).toBe('DE')
    expect(deviceCountry(countries, ['en-GB', 'cs'])?.code).toBe('GB')
    expect(deviceCountry(countries, ['cs'])?.code).toBe('CZ')
  })

  it('is no country where its languages name none of them, or are no languages at all', () => {
    expect(deviceCountry(countries, ['en-US', 'fr'])).toBeUndefined()
    expect(deviceCountry(countries, ['not a language', ''])).toBeUndefined()
    expect(deviceCountry(countries, [])).toBeUndefined()
  })

  it('keeps the device’s own zone in the list, though the browser lists it nowhere', () => {
    expect(timeZones('UTC')[0]).toBe('UTC')
    expect(timeZones('Europe/Prague').filter((zone) => zone === 'Europe/Prague')).toHaveLength(1)
  })

  it('names each language in its own', () => {
    expect((['en', 'cs', 'sk', 'de', 'pl'] as const).map(ownName)).toEqual([
      'English',
      'Čeština',
      'Slovenčina',
      'Deutsch',
      'Polski',
    ])
  })
})

describe('creating a household', () => {
  it('asks for the name alone, and opens with the rest read from the device and the countries', async () => {
    // No profile is of a country this device's languages name: the first one listed stands.
    deviceReads('en-US', 'en')
    await form()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.title).toBe(`${title} · Household`)
    expect(
      screen.getByText(
        'Only the name is asked. The rest is read from this device, and any of it can be changed.',
      ),
    ).toBeInTheDocument()

    const name = screen.getByRole('textbox', { name: /^Name/ })
    expect(name).toHaveValue('')
    expect(name).toBeRequired()
    expect(name).toHaveAccessibleDescription(
      'What the household is called on every screen and in every invitation.',
    )

    // By name, in the member's language.
    const country = field('Country')
    expect(optionsOf(country)).toEqual(['Czechia', 'Germany', 'United Kingdom'])
    expect(country).toHaveValue('CZ')
    // It was not read from the device, and does not say it was.
    expect(country).toHaveAccessibleDescription(
      'It decides which tariff presets, document types and statutory dates are offered.',
    )

    const zone = field('Timezone')
    expect(zone).toHaveValue(deviceTimeZone())
    expect(zone).toHaveAccessibleDescription(
      'Read from this device. The household’s days begin and end in it.',
    )

    const language = field('Language')
    expect(optionsOf(language)).toEqual(['English', 'Čeština', 'Slovenčina', 'Deutsch', 'Polski'])
    expect(language).toHaveValue('en')
    expect(language).toHaveAccessibleDescription(
      'The language you are reading now. What the household’s shared words and its emails are in. Each member’s own app language is theirs.',
    )

    // The currencies of the countries, each once and by its code and its name as the member's
    // language has it, and the country's own chosen.
    const currency = field('Money is counted in')
    const named = new Intl.DisplayNames(['en-US'], { type: 'currency' })
    expect(optionsOf(currency)).toEqual(
      ['CZK', 'EUR', 'GBP'].map((code) => `${code} — ${named.of(code) ?? ''}`),
    )
    expect(optionsOf(currency)[1]).toBe('EUR — Euro')
    expect(currency).toHaveValue('CZK')

    expect(screen.getByText('Thirty days, no card')).toBeInTheDocument()
    expect(
      screen.getByText(
        'The trial starts when the household is created and runs for thirty days. There is no card to enter and nothing to cancel: if you do nothing at its end, the household keeps reading and exporting everything in it.',
      ),
    ).toBeInTheDocument()
    // Units and the first day of the week are the country's own, and are not asked.
    expect(screen.getAllByRole('combobox')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Create the household' })).toBeInTheDocument()
  })

  it('reads the country from the device’s languages, and says so until it is changed', async () => {
    deviceReads('de-AT', 'de', 'en-GB')
    const { user } = await form()
    const country = field('Country')
    expect(country).toHaveValue('DE')
    expect(country).toHaveAccessibleDescription(
      'Read from this device. It decides which tariff presets, document types and statutory dates are offered.',
    )
    expect(field('Money is counted in')).toHaveValue('EUR')

    await user.selectOptions(country, 'United Kingdom')
    expect(country).toHaveAccessibleDescription(
      'It decides which tariff presets, document types and statutory dates are offered.',
    )
    // Any zone but the device's own, wherever this test runs.
    const elsewhere = deviceTimeZone() === 'Europe/Lisbon' ? 'Europe/Berlin' : 'Europe/Lisbon'
    await user.selectOptions(field('Timezone'), elsewhere)
    expect(field('Timezone')).toHaveAccessibleDescription(
      'The household’s days begin and end in it.',
    )
    await user.selectOptions(field('Language'), 'Polski')
    expect(field('Language')).toHaveAccessibleDescription(
      'What the household’s shared words and its emails are in. Each member’s own app language is theirs.',
    )
  })

  it('opens in the language the app is shown in', async () => {
    const { container } = open(paths.householdNew.path, createServer({ ...jana, locale: 'cs' }))
    await screen.findByRole('heading', { level: 1, name: 'Založte domácnost' })
    await waitFor(() => {
      expect(container.querySelectorAll('select')).toHaveLength(4)
    })
    expect(screen.getByRole('combobox', { name: 'Jazyk' })).toHaveValue('cs')
    // The countries are named and ordered in it.
    expect(optionsOf(screen.getByRole('combobox', { name: 'Země' }))).toEqual([
      'Česko',
      'Německo',
      'Spojené království',
    ])
  })

  it('has the currency follow the country until its member chooses one themselves', async () => {
    deviceReads('cs-CZ')
    const { user } = await form()
    const country = field('Country')
    const currency = field('Money is counted in')
    expect(currency).toHaveValue('CZK')
    await user.selectOptions(country, 'Germany')
    expect(currency).toHaveValue('EUR')
    await user.selectOptions(country, 'United Kingdom')
    expect(currency).toHaveValue('GBP')

    await user.selectOptions(currency, 'EUR')
    await user.selectOptions(country, 'Czechia')
    expect(currency).toHaveValue('EUR')
  })

  it('names its control for the household, makes it, and goes on to the first run', async () => {
    deviceReads('cs-CZ', 'en')
    const server = createServer()
    made(server)
    const { user, router } = await form(server)
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), '  Novákovi ')
    await user.click(screen.getByRole('button', { name: 'Create Novákovi' }))

    await waitFor(() => {
      expect(server.to('POST /households')).toHaveLength(1)
    })
    const sent = (await server.body('POST /households')) as Asked
    // The id is the client's own, a UUIDv7, and nothing the form does not ask is sent.
    expect(sent.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(sent).toEqual({
      id: sent.id,
      name: 'Novákovi',
      country: 'CZ',
      timezone: deviceTimeZone(),
      base_currency: 'CZK',
      locale: 'en',
    })
    // *What brought you here?* passes on to Home while no module takes a first record. The
    // household is drawn from the answer: the server here knows no household of that id.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(sent.id))
    })
    // The form is no entry to go back to: its household is made.
    await router.navigate(-1)
    expect(router.state.location.pathname).toBe(inHousehold.home(sent.id))
  })

  it('sends what was chosen', async () => {
    deviceReads('cs-CZ')
    const server = createServer()
    made(server)
    const { user } = await form(server)
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Chalupa')
    await user.selectOptions(field('Country'), 'Germany')
    await user.selectOptions(field('Timezone'), 'Europe/Berlin')
    await user.selectOptions(field('Language'), 'Deutsch')
    await user.selectOptions(field('Money is counted in'), 'CZK')
    await user.click(screen.getByRole('button', { name: 'Create Chalupa' }))
    await waitFor(() => {
      expect(server.to('POST /households')).toHaveLength(1)
    })
    expect(await server.body('POST /households')).toMatchObject({
      name: 'Chalupa',
      country: 'DE',
      timezone: 'Europe/Berlin',
      base_currency: 'CZK',
      locale: 'de',
    })
  })

  it('asks for the same household after an answer that was lost, and reads the one an earlier press made', async () => {
    const server = createServer()
    server.on('POST /households', () => Promise.reject(new TypeError('offline')))
    const { user, router } = await form(server)
    const name = screen.getByRole('textbox', { name: /^Name/ })
    await user.type(name, 'Novákovi')
    await user.click(screen.getByRole('button', { name: 'Create Novákovi' }))
    // Said as it arrives, with what was typed kept.
    expect(await screen.findByRole('alert')).toHaveTextContent(unreachable)
    expect(name).toHaveValue('Novákovi')
    expect(screen.getByRole('button', { name: 'Create Novákovi' })).not.toHaveAttribute('aria-busy')
    const first = (await server.body('POST /households')) as Asked

    // The first request made the household after all: its id is taken, by itself.
    server.on('POST /households', () => invalid('/id'))
    server.on(`GET /households/${first.id}`, () =>
      Response.json({ ...tilcerovi, id: first.id, name: 'Novákovi' }),
    )
    await user.click(screen.getByRole('button', { name: 'Create Novákovi' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(first.id))
    })
    expect(server.to('POST /households')).toHaveLength(2)
    expect(((await server.body('POST /households')) as Asked).id).toBe(first.id)
  })

  it('asks for a name before it asks the server', async () => {
    const server = createServer()
    const { user } = await form(server)
    const name = screen.getByRole('textbox', { name: /^Name/ })
    await user.type(name, '   ')
    await user.click(screen.getByRole('button', { name: 'Create the household' }))
    expect(name).toHaveAccessibleDescription(expect.stringContaining('A household needs a name.'))
    expect(name).toBeInvalid()
    // The focus is on the field to put right, where its sentence is read with it.
    await waitFor(() => {
      expect(name).toHaveFocus()
    })
    expect(server.to('POST /households')).toHaveLength(0)
  })

  it('puts each refusal of the server’s beside its field, and the focus on the first', async () => {
    const server = createServer()
    server.on('POST /households', () =>
      problem(422, 'validation_failed', {
        errors: [
          { field: '/name', code: 'invalid' },
          { field: '/country', code: 'invalid' },
          { field: '/timezone', code: 'invalid' },
          { field: '/locale', code: 'invalid' },
          { field: '/base_currency', code: 'invalid' },
        ],
      }),
    )
    const { user } = await form(server)
    const name = screen.getByRole('textbox', { name: /^Name/ })
    await user.type(name, 'Novákovi')
    await user.click(screen.getByRole('button', { name: 'Create Novákovi' }))
    await waitFor(() => {
      expect(name).toHaveAccessibleDescription(
        expect.stringContaining(
          'That name wasn’t accepted. Use up to 80 letters, numbers and ordinary punctuation.',
        ),
      )
    })
    expect(field('Country')).toHaveAccessibleDescription(
      expect.stringContaining('Household has no profile of that country. Choose another.'),
    )
    expect(field('Timezone')).toHaveAccessibleDescription(
      expect.stringContaining('That timezone wasn’t accepted. Choose another one near you.'),
    )
    expect(field('Language')).toHaveAccessibleDescription(
      expect.stringContaining('That language wasn’t accepted. Choose another.'),
    )
    expect(field('Money is counted in')).toHaveAccessibleDescription(
      expect.stringContaining('That currency wasn’t accepted. Choose another.'),
    )
    await waitFor(() => {
      expect(name).toHaveFocus()
    })
    // Every sentence stands beside its field: no banner says them again.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(name).toHaveValue('Novákovi')
  })

  it('says a name the server found empty is missing', async () => {
    const server = createServer()
    server.on('POST /households', () => invalid('/name', 'required'))
    const { user } = await form(server)
    const name = screen.getByRole('textbox', { name: /^Name/ })
    await user.type(name, 'x')
    await user.click(screen.getByRole('button', { name: 'Create x' }))
    await waitFor(() => {
      expect(name).toHaveAccessibleDescription(expect.stringContaining('A household needs a name.'))
    })
  })

  it('says an account that owns as many households as it may owns no more, and names how many', async () => {
    const server = createServer()
    server.on('POST /households', () => problem(403, 'household_limit_reached', { ceiling: 5 }))
    const { user } = await form(server)
    const name = screen.getByRole('textbox', { name: /^Name/ })
    await user.type(name, 'Šestá')
    await user.click(screen.getByRole('button', { name: 'Create Šestá' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You own 5 households already, and one account owns no more than that. Nothing was created.',
    )
    expect(name).toHaveValue('Šestá')
  })

  it('says a second refusal anew, and any other failure in the app’s own words', async () => {
    const server = createServer()
    server.on('POST /households', () => problem(500, 'internal'))
    const { user } = await form(server)
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Novákovi')
    await user.click(screen.getByRole('button', { name: 'Create Novákovi' }))
    const first = await screen.findByRole('alert')
    expect(first).toHaveTextContent(/^Something went wrong at our end\./)

    server.on('POST /households', () => problem(429, 'rate_limited'))
    await user.click(screen.getByRole('button', { name: 'Create Novákovi' }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Too many attempts. Try again in a little while.',
      )
    })
    // A banner of its own, which is said as it arrives: not the first one's words changed.
    expect(screen.getByRole('alert')).not.toBe(first)
  })

  it('tells a child profile the server refused that it makes no household', async () => {
    const server = createServer()
    server.on('POST /households', () => problem(403, 'forbidden'))
    const { user } = await form(server)
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Novákovi')
    await user.click(screen.getByRole('button', { name: 'Create Novákovi' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A child profile is part of the household an owner made it in, and makes none of its own.',
    )
  })

  it('offers a child profile no form, and asks for nothing a form is made of', async () => {
    const server = createServer({ ...jana, is_child: true, credentials: ['child_pin'] })
    await creating(server)
    expect(
      screen.getByText(
        'A child profile is part of the household an owner made it in, and makes none of its own.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(server.to('GET /reference/countries')).toHaveLength(0)
    expect(server.to('GET /me/invitations')).toHaveLength(0)
  })

  it('creates a household for an account whose address is not verified, like any other', async () => {
    const server = createServer({ ...jana, email_verified: false })
    made(server)
    const { user } = await form(server)
    expect(screen.queryByText('Verify your email first')).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Novákovi')
    await user.click(screen.getByRole('button', { name: 'Create Novákovi' }))
    await waitFor(() => {
      expect(server.to('POST /households')).toHaveLength(1)
    })
  })
})

describe('the invitations that wait for a member, above the form', () => {
  const token = '0190a000-0000-7000-8000-0000000000c7'
  const waiting = {
    token,
    household_name: 'Chata Vysočina',
    invited_by: 'Petr Tilcer',
    role: 'member',
    modules: [],
    message: null,
    expires_at: '2026-10-20T18:00:00Z',
  }

  it('says who invited them to which household, and leads to the invitation’s own screen', async () => {
    const server = createServer()
    server.on('GET /me/invitations', () => Response.json({ items: [waiting] }))
    await form(server)
    const section = (
      await screen.findByRole('heading', { level: 2, name: 'Invitations waiting for you' })
    ).closest('section')
    if (section === null) throw new Error('no section')
    const list = within(section).getByRole('list', { name: 'Invitations waiting for you' })
    expect(within(list).getByText('Petr Tilcer invited you to Chata Vysočina')).toBeInTheDocument()
    // Named for the household it is to, and drawn as the words the name begins with.
    const link = within(list).getByRole('link', {
      name: 'See the invitation to Chata Vysočina',
    })
    expect(link).toHaveTextContent('See the invitation')
    expect(link).toHaveAttribute('href', `/invitation#token=${token}`)
    // It stands above the form, which is still there to make a household of one's own.
    const own = screen.getByRole('heading', { level: 2, name: 'A new household' })
    expect(section.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText(/shows here once the address is verified/)).not.toBeInTheDocument()
  })

  it('says of an invitation that names nobody only where it is to', async () => {
    const server = createServer()
    server.on('GET /me/invitations', () =>
      Response.json({ items: [{ ...waiting, invited_by: '' }] }),
    )
    await form(server)
    expect(await screen.findByText('You are invited to Chata Vysočina')).toBeInTheDocument()
  })

  it('says where one would show while none waits', async () => {
    await form()
    expect(
      await screen.findByText(
        'An invitation sent to your address shows here once the address is verified. If somebody sent you a link, opening it is enough.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Invitations waiting for you' }),
    ).not.toBeInTheDocument()
  })

  it('draws nothing of them while they cannot be read, and the form all the same', async () => {
    const server = createServer()
    server.on('GET /me/invitations', () => Promise.reject(new TypeError('offline')))
    await form(server)
    await waitFor(() => {
      expect(server.to('GET /me/invitations')).not.toHaveLength(0)
    })
    expect(screen.queryByText(/shows here once the address is verified/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Invitations waiting for you' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create the household' })).toBeInTheDocument()
  })
})

describe('the form’s states', () => {
  it('is the form’s shape while the countries are read', async () => {
    const server = createServer()
    server.on('GET /reference/countries', () => new Promise<Response>(() => undefined))
    await creating(server)
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create the household' })).not.toBeInTheDocument()
  })

  it('says the countries could not be read, and reads them again', async () => {
    const server = createServer()
    server.on('GET /reference/countries', () => Promise.reject(new TypeError('offline')))
    const { user } = await creating(server)
    expect(await screen.findByText('The countries could not be read')).toBeInTheDocument()
    expect(
      screen.getByText(
        'A household is set up in a country, and the list of them did not arrive. Nothing was created. Check your connection and try again.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    server.on('GET /reference/countries', () => Response.json({ version: 1, items: countries }))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('textbox', { name: /^Name/ })).toBeInTheDocument()
  })

  it('says so, and draws no skeleton, while the browser has no connection to read them with', async () => {
    const server = createServer()
    // The connection goes as the account is read: what the screen reads next waits for one.
    server.on('GET /me', () => {
      onlineManager.setOnline(false)
      return Response.json(server.me)
    })
    await creating(server)
    expect(await screen.findByText('The countries could not be read')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    expect(server.to('GET /reference/countries')).toHaveLength(0)
    server.on('GET /me', () => Response.json(server.me))
    act(() => {
      onlineManager.setOnline(true)
    })
    expect(await screen.findByRole('textbox', { name: /^Name/ })).toBeInTheDocument()
  })

  it('asks at once though the browser says it has no connection, and is sent by nothing when one returns', async () => {
    const server = createServer()
    server.on('POST /households', () => Promise.reject(new TypeError('offline')))
    const { user } = await form(server)
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Novákovi')
    onlineManager.setOnline(false)
    await user.click(screen.getByRole('button', { name: 'Create Novákovi' }))
    // Not held for a connection behind a busy control: asked, and said to have reached nobody.
    expect(await screen.findByRole('alert')).toHaveTextContent(unreachable)
    expect(screen.getByRole('button', { name: 'Create Novákovi' })).not.toHaveAttribute('aria-busy')
    act(() => {
      onlineManager.setOnline(true)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Nothing waited for the connection: a household made now would be nobody's press.
    expect(server.to('POST /households')).toHaveLength(1)
  })

  // A household made minutes after the press, with nobody at the screen, is not what was asked
  // for (D-164): the write is held to being asked at once, as the account's are (api.test.ts).
  it('makes its one write a write that is asked at once', () => {
    const writes = Object.values(sources).flatMap((source) =>
      [...source.matchAll(/useMutation\(\{\s*(\S+)/g)].map(([, first = '']) => first),
    )
    expect(writes).toEqual(['...askedNow,'])
  })
})
