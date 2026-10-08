// The household's profile (C-49) as each member reads it and as an owner changes it: what is
// drawn for whom, each change's request and what is said of it, every refusal the server can
// answer, the code as an identifier, and what the page does while a read is still out.
import { pseudoLocale } from '@household/i18n/lazy'
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inHousehold } from '../../app/paths.ts'
import { storageKey } from '../../i18n/locale.ts'
import { defaultsFor } from '../grants.ts'
import type { Household } from '../households.ts'
import {
  accountOf,
  adam,
  countries,
  createServer,
  home,
  invalid,
  jana,
  klara,
  memberOf,
  members,
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

const at = `/households/${home}`
const patch = `PATCH ${at}`
const renew = `POST ${at}/join-code`

async function profile(server: HouseholdServer = createServer()) {
  const opened = open(inHousehold.settings(home), server)
  await screen.findByRole('heading', { level: 1, name: 'Household' })
  return opened
}

/** A section of the page, by its heading. */
function section(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

/** What a block of labels and values says, each value by its label. */
function pairs(within_: HTMLElement): Record<string, string> {
  const terms = within(within_).getAllByRole('term')
  const values = within(within_).getAllByRole('definition')
  return Object.fromEntries(
    terms.map((term, index) => [term.textContent, values[index]?.textContent ?? '']),
  )
}

/** A server that takes a change of the household as the real one does, and moves its version. */
function taking(server: HouseholdServer = createServer()): HouseholdServer {
  server.on(patch, async (request) => {
    const change = (await request.json()) as Partial<Household>
    server.household = {
      ...server.household,
      ...change,
      version: (server.household.version ?? 0) + 1,
    }
    return Response.json(server.household)
  })
  return server
}

/** The household as Jana reads it once she has been made a member. */
function demoted(): Household {
  return readBy({ ...memberOf(jana.id), role: 'member', grants: defaultsFor('member') })
}

const readOnly = { state: 'read_only', can_write: false, can_upload: false } as const

/** Opens the panel that edits the household, and answers with it and its fields. */
async function editing(server: HouseholdServer) {
  const opened = await profile(server)
  await opened.user.click(await screen.findByRole('button', { name: 'Edit the household' }))
  const sheet = screen.getByRole('dialog', { name: 'Edit the household' })
  return {
    ...opened,
    sheet,
    name: within(sheet).getByRole('textbox', { name: /^Name/ }),
    zone: within(sheet).getByRole('combobox', { name: 'Timezone' }),
    language: within(sheet).getByRole('combobox', { name: 'Language' }),
    units: within(sheet).getByRole('combobox', { name: 'Units' }),
    week: within(sheet).getByRole('combobox', { name: 'First day of the week' }),
    save: within(sheet).getByRole('button', { name: 'Save for everyone' }),
  }
}

/** Opens the panel that moves the household to another country. */
async function moving(server: HouseholdServer) {
  const opened = await profile(server)
  await opened.user.click(await screen.findByRole('button', { name: 'Change the country' }))
  const sheet = screen.getByRole('dialog', { name: 'Change the country' })
  return { ...opened, sheet, to: within(sheet).getByRole('combobox', { name: 'Move to' }) }
}

describe('the household’s profile, as each member reads it', () => {
  it('says what the household is to its owner, and draws what changes it', async () => {
    await profile()
    await screen.findByText('Czechia')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['The household', 'The household code', 'You'])
    expect(pairs(section('The household'))).toEqual({
      Name: 'Tilcerovi',
      Country: 'Czechia',
      Timezone: 'Europe/Prague',
      // The language's own name for itself, whatever the app is shown in.
      Language: 'Čeština',
      Units: 'Metric',
      'First day of the week': 'Monday',
      'Money is counted in': 'CZK',
    })
    expect(screen.getByRole('button', { name: 'Edit the household' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change the country' })).toBeInTheDocument()
    // What money is counted in is read: no operation changes it yet. And no picture is set.
    expect(screen.queryByRole('button', { name: /money|currency|picture/i })).toBeNull()
  })

  it('says which first day of the week and which language these are, and where one’s own are', async () => {
    await profile()
    expect(
      screen.getByText(
        'The first day of the week here is the household’s. Your own setting, on your account, wins on your own screens.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'The language is the one the household’s shared words and its emails are in. The language of your own app is yours, on your account.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Your account’s language, dates and times' }),
    ).toHaveAttribute('href', '/account')
  })

  it('leads to leaving, by the household’s name, and says what that screen says first', async () => {
    await profile()
    expect(within(section('You')).getByRole('link', { name: 'Leave Tilcerovi' })).toHaveAttribute(
      'href',
      inHousehold.leave(home),
    )
    expect(
      screen.getByText(
        'Leaving is on a screen of its own, which first says what has to be settled and what stays.',
      ),
    ).toBeInTheDocument()
  })

  it('reads the same to a member, with nothing that changes it and no code', async () => {
    await profile(createServer(accountOf(petr)))
    await screen.findByText('Czechia')
    expect(pairs(section('The household'))).toMatchObject({
      Name: 'Tilcerovi',
      Timezone: 'Europe/Prague',
      'Money is counted in': 'CZK',
    })
    // Absent, and not disabled: no control is drawn for a member who may not use it.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'The household code' })).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('K7M2')
    expect(screen.getByRole('link', { name: 'Leave Tilcerovi' })).toBeInTheDocument()
  })

  // What `view` on household settings unlocks is the invitations: the profile is every member's.
  it('reads the same to a member who holds nothing on household settings', async () => {
    await profile(createServer(accountOf(klara)))
    expect(pairs(section('The household'))).toMatchObject({ Name: 'Tilcerovi', Units: 'Metric' })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'The household code' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Leave Tilcerovi' })).toBeInTheDocument()
  })

  it('reads the same to a child profile, which changes nothing and leaves nothing', async () => {
    await profile(createServer(accountOf(adam)))
    expect(pairs(section('The household'))).toMatchObject({ Name: 'Tilcerovi' })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'The household code' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Leave Tilcerovi' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'You' })).not.toBeInTheDocument()
  })

  it('draws nothing that changes a read-only household, for its owner either', async () => {
    const server = createServer()
    server.household = { ...tilcerovi, entitlement: readOnly }
    await profile(server)
    await screen.findByText('Czechia')
    expect(screen.queryByRole('button', { name: 'Edit the household' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change the country' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make a new code' })).not.toBeInTheDocument()
    // Everything still reads, the code among it, and copying it changes nothing.
    expect(pairs(section('The household code')).Code).toBe('K7M2-4PQX')
    expect(screen.getByRole('button', { name: 'Copy the code' })).toBeInTheDocument()
  })
})

describe('an owner made a member while the profile is open', () => {
  it('loses the controls when the household is read again, and the focus one of them held stays on the page', async () => {
    const server = createServer()
    await profile(server)
    const edit = await screen.findByRole('button', { name: 'Edit the household' })
    act(() => {
      edit.focus()
    })
    // Made a member by another owner: the page is looked at again, and reads it.
    server.household = demoted()
    act(() => {
      focusManager.setFocused(true)
    })
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('region', { name: 'The household code' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(
      screen.getByRole('heading', { name: 'The household' }),
    )
    // Nothing was pressed, so nothing was refused: what stands above the page says where its
    // reader now stands.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(pairs(section('The household')).Name).toBe('Tilcerovi')
  })

  // On a second visit the page may be drawn as an owner's from what this browser kept, and lose
  // its controls once the household is read: no focus was on one, and none is moved.
  it('moves no focus that was on no control when the controls leave', async () => {
    const server = createServer()
    await profile(server)
    await screen.findByRole('button', { name: 'Edit the household' })
    server.household = demoted()
    act(() => {
      focusManager.setFocused(true)
    })
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves the focus where a member took it before the controls left', async () => {
    const server = createServer()
    const { user } = await profile(server)
    const edit = await screen.findByRole('button', { name: 'Edit the household' })
    act(() => {
      edit.focus()
    })
    // On from the control, to the way to leaving, before the household is read again.
    const leave = screen.getByRole('link', { name: 'Leave Tilcerovi' })
    while (document.activeElement !== leave) await user.tab()
    server.household = demoted()
    act(() => {
      focusManager.setFocused(true)
    })
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
    expect(leave).toHaveFocus()
  })
})

describe('what the profile draws while a read is still out', () => {
  it('names the country by its code until its name is read, and offers no move until then', async () => {
    const server = createServer()
    let answer: (response: Response) => void = () => undefined
    server.on(
      'GET /reference/countries',
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    )
    await profile(server)
    expect(pairs(section('The household')).Country).toBe('CZ')
    // Nothing waits on the countries: the rest is drawn, and what needs none of them works.
    expect(screen.getByRole('button', { name: 'Edit the household' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change the country' })).not.toBeInTheDocument()
    answer(Response.json({ version: 1, items: countries }))
    expect(await screen.findByText('Czechia')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Change the country' })).toBeInTheDocument()
  })

  it('goes on naming it by its code where the countries could not be read', async () => {
    const server = createServer()
    server.on('GET /reference/countries', () => Promise.reject(new TypeError('offline')))
    await profile(server)
    await waitFor(() => {
      expect(server.to('GET /reference/countries').length).toBeGreaterThan(0)
    })
    expect(pairs(section('The household')).Country).toBe('CZ')
    expect(screen.queryByRole('button', { name: 'Change the country' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('leaves out who needs the code where the members could not be read', async () => {
    const server = createServer()
    server.on(`GET ${at}/members`, () => Promise.reject(new TypeError('offline')))
    await profile(server)
    await waitFor(() => {
      expect(server.to(`GET ${at}/members`).length).toBeGreaterThan(0)
    })
    expect(pairs(section('The household code'))).toEqual({ Code: 'K7M2-4PQX' })
  })
})

describe('editing the household', () => {
  it('opens on the household as it stands, each language by its own name and the week from Monday', async () => {
    const { name, zone, language, units, week } = await editing(createServer())
    expect(name).toHaveValue('Tilcerovi')
    expect(name).toHaveFocus()
    expect(name).toBeRequired()
    expect(zone).toHaveValue('Europe/Prague')
    expect(language).toHaveValue('cs')
    expect(
      within(language)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['English', 'Čeština', 'Slovenčina', 'Deutsch', 'Polski'])
    expect(language).toHaveAccessibleDescription(
      'What the household’s shared words and its emails are in. Each member’s own app language is theirs, on their account.',
    )
    expect(units).toHaveValue('metric')
    expect(week).toHaveValue('1')
    expect(
      within(week)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
    expect(week).toHaveAccessibleDescription(
      'The household’s. A member’s own setting, on their account, wins on their own screens.',
    )
  })

  it('keeps the household’s own timezone in the list though the browser does not name it', async () => {
    const server = createServer()
    server.household = { ...tilcerovi, timezone: 'Mars/Olympus_Mons' }
    const { zone } = await editing(server)
    expect(zone).toHaveValue('Mars/Olympus_Mons')
    expect(within(zone).getByRole('option', { name: 'Europe/Prague' })).toBeInTheDocument()
  })

  it('sends what changed and nothing else, under the version it read, and says it is saved for everyone', async () => {
    const server = taking()
    const { user, name, units, week, save } = await editing(server)
    await user.clear(name)
    await user.type(name, '  Tilcerovi doma  ')
    await user.selectOptions(units, 'Imperial')
    await user.selectOptions(week, 'Sunday')
    const read = server.to(`GET ${at}`).length
    const listed = server.to(`GET ${at}/members`).length
    await user.click(save)

    expect(await screen.findByText('Saved for everyone.')).toBeInTheDocument()
    const sent = server.to(patch)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.headers.get('If-Match')).toBe('"4"')
    expect(await server.body(patch)).toEqual({
      name: 'Tilcerovi doma',
      units: 'imperial',
      first_day_of_week: 0,
    })
    // The panel closes onto the page, whose control is there for the focus to go back to, and
    // the page says what was saved.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit the household' })).toBeInTheDocument()
    expect(pairs(section('The household'))).toMatchObject({
      Name: 'Tilcerovi doma',
      Units: 'Imperial',
      'First day of the week': 'Sunday',
    })
    // The household and what is filed under it are read again.
    await waitFor(() => {
      expect(server.to(`GET ${at}`).length).toBeGreaterThan(read)
      expect(server.to(`GET ${at}/members`).length).toBeGreaterThan(listed)
    })
  })

  it('sends a timezone and a language where those are what changed', async () => {
    const server = taking()
    const { user, zone, language, save } = await editing(server)
    await user.selectOptions(zone, 'Europe/Vienna')
    await user.selectOptions(language, 'Deutsch')
    await user.click(save)
    expect(await screen.findByText('Saved for everyone.')).toBeInTheDocument()
    expect(await server.body(patch)).toEqual({ timezone: 'Europe/Vienna', locale: 'de' })
    expect(pairs(section('The household'))).toMatchObject({
      Timezone: 'Europe/Vienna',
      Language: 'Deutsch',
    })
  })

  it('asks nothing where nothing was changed, and closes', async () => {
    const server = taking()
    const { user, name, save } = await editing(server)
    // Typed, and put back as it was.
    await user.type(name, 'x{Backspace}')
    await user.click(save)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.to(patch)).toHaveLength(0)
    expect(screen.queryByText('Saved for everyone.')).not.toBeInTheDocument()
  })

  it('asks for a name before it asks the server, on the field, which takes the focus', async () => {
    const server = taking()
    const { user, name, units, save } = await editing(server)
    await user.clear(name)
    await user.click(units)
    await user.click(save)
    expect(name).toHaveAccessibleDescription(
      expect.stringContaining('A household needs a name, of 80 characters at most.'),
    )
    await waitFor(() => {
      expect(name).toHaveFocus()
    })
    expect(server.to(patch)).toHaveLength(0)
    expect(screen.getByRole('dialog', { name: 'Edit the household' })).toBeInTheDocument()
  })

  it('says each refusal of a field beside it, and moves the focus to the first', async () => {
    const server = createServer()
    server.on(patch, () =>
      problem(422, 'validation_failed', {
        errors: [
          { field: '/timezone', code: 'invalid' },
          { field: '/locale', code: 'invalid' },
          { field: '/name', code: 'invalid' },
        ],
      }),
    )
    const { user, sheet, name, zone, language, units, save } = await editing(server)
    await user.selectOptions(units, 'Imperial')
    await user.click(save)
    await waitFor(() => {
      expect(name).toHaveAccessibleDescription(
        expect.stringContaining('A household needs a name, of 80 characters at most.'),
      )
    })
    expect(zone).toHaveAccessibleDescription(
      expect.stringContaining('Household doesn’t know that timezone. Choose another.'),
    )
    expect(language).toHaveAccessibleDescription(
      expect.stringContaining('Household isn’t written in that language yet. Choose another.'),
    )
    // The first field of the form that was refused, whatever order the server named them in.
    await waitFor(() => {
      expect(name).toHaveFocus()
    })
    // Each is said beside its field, and nothing of it under the form.
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument()
    expect(units).toHaveValue('imperial')
  })

  it('says a refusal of what was sent that is no field’s under the form', async () => {
    const server = createServer()
    server.on(patch, () => invalid('/units'))
    const { user, sheet, units, save } = await editing(server)
    await user.selectOptions(units, 'Imperial')
    await user.click(save)
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      'That change wasn’t accepted, and nothing was changed.',
    )
    expect(units).toHaveValue('imperial')
  })

  it('stays open on what was typed where somebody else changed the household, shows how it stands, and saves over it', async () => {
    const server = createServer()
    const current: Household = { ...tilcerovi, name: 'Tilcerovi — chata', version: 5 }
    server.on(patch, async (request) => {
      if (request.headers.get('If-Match') !== '"5"') {
        // Renamed by another owner since this page read it.
        server.household = current
        return problem(409, 'version_conflict', { current, current_version: 5 })
      }
      server.household = { ...current, ...((await request.json()) as object), version: 6 }
      return Response.json(server.household)
    })
    const { user, sheet, name, units, save } = await editing(server)
    await user.selectOptions(units, 'Imperial')
    await user.click(save)

    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      'Somebody else changed this just now. Here is how it stands; check it, and change it again if it still needs changing.',
    )
    // What was chosen is kept, and what nobody touched reads as the household now stands.
    expect(units).toHaveValue('imperial')
    expect(name).toHaveValue('Tilcerovi — chata')
    expect(pairs(section('The household')).Name).toBe('Tilcerovi — chata')

    await user.click(save)
    expect(await screen.findByText('Saved for everyone.')).toBeInTheDocument()
    const sent = server.to(patch)
    expect(sent).toHaveLength(2)
    // Held against the household the refusal carried, and the other owner's name is not undone.
    expect(sent[1]?.headers.get('If-Match')).toBe('"5"')
    expect(await server.body(patch)).toEqual({ units: 'imperial' })
    expect(pairs(section('The household'))).toMatchObject({
      Name: 'Tilcerovi — chata',
      Units: 'Imperial',
    })
  })

  it('says an owner made a member meanwhile is one no longer, on the page, and takes the controls away', async () => {
    const server = createServer()
    server.on(patch, () => {
      server.household = demoted()
      return problem(403, 'forbidden')
    })
    const { user, units, save } = await editing(server)
    await user.selectOptions(units, 'Imperial')
    await user.click(save)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an owner can change this, and you are not one any more. Nothing was changed.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The household is read again, and draws nothing for a member to change.
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('region', { name: 'The household code' })).not.toBeInTheDocument()
    // The control the panel was opened from went with the rest: the focus is on the page's own
    // place, and not dropped.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(
      screen.getByRole('heading', { name: 'The household' }),
    )
  })

  it('says a household that became read-only changed nothing, and takes the controls away', async () => {
    const server = createServer()
    server.on(patch, () => {
      server.household = { ...tilcerovi, entitlement: readOnly }
      return problem(402, 'entitlement_read_only', { state: 'read_only', remedy: 'subscribe' })
    })
    const { user, units, save } = await editing(server)
    await user.selectOptions(units, 'Imperial')
    await user.click(save)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The household is read-only now, so nothing was changed.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Edit the household' })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Make a new code' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy the code' })).toBeInTheDocument()
  })

  it('is asked at once with no connection, says the server was not reached, and is sent by nothing later', async () => {
    const server = createServer()
    server.on(patch, () => Promise.reject(new TypeError('offline')))
    const { user, sheet, name, units, save } = await editing(server)
    await user.clear(name)
    await user.type(name, 'Doma')
    await user.selectOptions(units, 'Imperial')
    onlineManager.setOnline(false)
    await user.click(save)
    // Not held for a connection, with a busy control and no word: it is asked, and answered.
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      /^We couldn’t reach Household\./,
    )
    expect(save).not.toHaveAttribute('aria-busy')
    // Nothing that was typed is lost, and the panel is there to save from again.
    expect(name).toHaveValue('Doma')
    expect(units).toHaveValue('imperial')
    act(() => {
      onlineManager.setOnline(true)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(server.to(patch)).toHaveLength(1)
  })

  it('says when the server is asked too often', async () => {
    const server = createServer()
    server.on(patch, () => problem(429, 'rate_limited'))
    const { user, sheet, units, save } = await editing(server)
    await user.selectOptions(units, 'Imperial')
    await user.click(save)
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in a little while.',
    )
  })

  it('is put away with nothing asked', async () => {
    const server = taking()
    const { user, sheet, name } = await editing(server)
    await user.type(name, ' doma')
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.to(patch)).toHaveLength(0)
    expect(pairs(section('The household')).Name).toBe('Tilcerovi')
  })
})

describe('changing the country', () => {
  it('says what it changes and what it leaves before anything is chosen, and offers the other profiles', async () => {
    const server = taking()
    const { sheet, to } = await moving(server)
    expect(pairs(sheet)).toEqual({ Now: 'Czechia' })
    expect(
      within(to)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Choose a country', 'Germany', 'United Kingdom'])
    expect(within(sheet).getByRole('heading', { name: 'What this changes' })).toBeInTheDocument()
    expect(
      within(within(sheet).getByRole('list', { name: 'What this changes' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Vehicles: new statutory inspections follow the new country’s rules.',
      'Documents: the document types offered, and how long before a renewal the reminder comes, are the new country’s.',
      'Calendar: the public holidays shown are the new country’s.',
      'Property: the starter checklist offered is the new country’s.',
      'Utilities: the tariff presets offered are the new country’s.',
    ])
    expect(
      within(sheet).getByText(
        'Nothing already written is changed: past bills, readings, expenses and dates stay exactly as entered. The currency does not move, and neither do the units or the first day of the week.',
      ),
    ).toBeInTheDocument()
    expect(server.to(patch)).toHaveLength(0)
  })

  it('asks which country before it asks the server', async () => {
    const server = taking()
    const { user, sheet, to } = await moving(server)
    await user.click(within(sheet).getByRole('button', { name: 'Change the country' }))
    expect(to).toHaveAccessibleDescription(
      expect.stringContaining('Choose the country to move to.'),
    )
    await waitFor(() => {
      expect(to).toHaveFocus()
    })
    expect(server.to(patch)).toHaveLength(0)
  })

  it('moves the household under the version it read, names the country in its control, and offers no undo', async () => {
    const server = taking()
    const { user, sheet, to } = await moving(server)
    await user.selectOptions(to, 'Germany')
    await user.click(within(sheet).getByRole('button', { name: 'Change the country to Germany' }))

    expect(await screen.findByText('The country is Germany.')).toBeInTheDocument()
    const sent = server.to(patch)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.headers.get('If-Match')).toBe('"4"')
    expect(await server.body(patch)).toEqual({ country: 'DE' })
    // There is nothing to undo it with but the same change back.
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(pairs(section('The household'))).toMatchObject({
      Country: 'Germany',
      // Nothing else of the household moved with it.
      Units: 'Metric',
      'Money is counted in': 'CZK',
    })
  })

  it('says a country Household has no profile of on its field, which takes the focus', async () => {
    const server = createServer()
    server.on(patch, () => invalid('/country'))
    const { user, sheet, to } = await moving(server)
    await user.selectOptions(to, 'Germany')
    await user.click(within(sheet).getByRole('button', { name: 'Change the country to Germany' }))
    await waitFor(() => {
      expect(to).toHaveAccessibleDescription(
        expect.stringContaining('Household has no profile of that country yet. Choose another.'),
      )
    })
    await waitFor(() => {
      expect(to).toHaveFocus()
    })
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('stays open where somebody else changed the household, and says a failure under the form', async () => {
    const server = createServer()
    const current: Household = { ...tilcerovi, units: 'imperial', version: 5 }
    server.on(patch, () => {
      server.household = current
      return problem(409, 'version_conflict', { current, current_version: 5 })
    })
    const { user, sheet, to } = await moving(server)
    await user.selectOptions(to, 'United Kingdom')
    const move = within(sheet).getByRole('button', {
      name: 'Change the country to United Kingdom',
    })
    await user.click(move)
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      /^Somebody else changed this just now\./,
    )
    expect(to).toHaveValue('GB')
    expect(pairs(section('The household')).Units).toBe('Imperial')

    server.on(patch, () => problem(500, 'internal'))
    await user.click(move)
    await waitFor(() => {
      expect(within(sheet).getByRole('alert')).toHaveTextContent(
        /^Something went wrong at our end\./,
      )
    })
    expect(server.to(patch)[1]?.headers.get('If-Match')).toBe('"5"')
  })

  it('says an owner made a member meanwhile is one no longer, on the page', async () => {
    const server = createServer()
    server.on(patch, () => {
      server.household = demoted()
      return problem(403, 'forbidden')
    })
    const { user, sheet, to } = await moving(server)
    await user.selectOptions(to, 'Germany')
    await user.click(within(sheet).getByRole('button', { name: 'Change the country to Germany' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an owner can change this, and you are not one any more. Nothing was changed.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })
})

describe('the household code', () => {
  it('is drawn in full, in its two groups, as an identifier and no secret, with who needs it', async () => {
    await profile()
    const code = section('The household code')
    expect(await within(code).findByText(/^Adam/)).toBeInTheDocument()
    expect(pairs(code)).toEqual({
      Code: 'K7M2-4PQX',
      'Who needs it': 'Adam, to sign in on a phone or tablet of their own',
    })
    expect(
      within(code).getByText(
        'The code says which household a child profile is signing in to. It signs nobody in by itself: that takes the profile and its PIN. So it is no password, and there is no need to keep it secret.',
      ),
    ).toBeInTheDocument()
    // Never masked, and never a field that hides what it holds.
    expect(code.querySelector('input')).toBeNull()
  })

  it('tells a household with no child profile that nobody in it needs the code', async () => {
    const server = createServer()
    server.members = members.filter((member) => member.role !== 'child')
    await profile(server)
    expect(
      await screen.findByText(
        'Nobody here. It is only for a child profile signing in, and this household has none.',
      ),
    ).toBeInTheDocument()
  })

  it('copies the code as it is shown, and says so', async () => {
    const { user } = await profile()
    const written = vi.spyOn(window.navigator.clipboard, 'writeText').mockResolvedValue()
    await user.click(screen.getByRole('button', { name: 'Copy the code' }))
    expect(written).toHaveBeenCalledExactlyOnceWith('K7M2-4PQX')
    expect(await screen.findByText('Copied K7M2-4PQX.')).toBeInTheDocument()
  })

  it('says the browser would not copy it, and how to take it down', async () => {
    const { user } = await profile()
    vi.spyOn(window.navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    await user.click(screen.getByRole('button', { name: 'Copy the code' }))
    expect(
      await screen.findByText('Copying didn’t work. Type the code as it is shown.'),
    ).toBeInTheDocument()
  })

  it('makes a new one after saying what stops and what stays, and names both codes', async () => {
    const server = createServer()
    server.on(renew, () => {
      server.household = { ...server.household, join_code: 'ABCD2345', version: 5 }
      return Response.json(server.household)
    })
    const { user } = await profile(server)
    const read = server.to(`GET ${at}`).length
    await user.click(screen.getByRole('button', { name: 'Make a new code' }))
    const dialog = screen.getByRole('dialog', { name: 'Make a new household code?' })
    expect(dialog).toHaveAccessibleDescription(
      'K7M2-4PQX stops working for new sign-ins. Phones and tablets that are already signed in stay signed in.',
    )
    // The safe choice first, then the one that names what it does.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Keep this code', 'Make a new code'])
    await user.click(within(dialog).getByRole('button', { name: 'Make a new code' }))

    expect(
      await screen.findByText(
        'The new code is ABCD-2345. K7M2-4PQX no longer works for new sign-ins.',
      ),
    ).toBeInTheDocument()
    const sent = server.to(renew)
    expect(sent).toHaveLength(1)
    expect(await sent[0]?.text()).toBe('')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(pairs(section('The household code')).Code).toBe('ABCD-2345')
    // What it was opened from is there for the focus to go back to.
    expect(screen.getByRole('button', { name: 'Make a new code' })).toBeInTheDocument()
    await waitFor(() => {
      expect(server.to(`GET ${at}`).length).toBeGreaterThan(read)
    })
  })

  it('keeps the code when its owner says so', async () => {
    const server = createServer()
    const { user } = await profile(server)
    await user.click(screen.getByRole('button', { name: 'Make a new code' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep this code' }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.to(renew)).toHaveLength(0)
    expect(pairs(section('The household code')).Code).toBe('K7M2-4PQX')
  })

  it('says a new one could not be asked for, and leaves the question open', async () => {
    const server = createServer()
    server.on(renew, () => Promise.reject(new TypeError('offline')))
    const { user } = await profile(server)
    await user.click(screen.getByRole('button', { name: 'Make a new code' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Make a new code' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^We couldn’t reach Household\./,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(pairs(section('The household code')).Code).toBe('K7M2-4PQX')
  })

  it('says an owner made a member meanwhile is one no longer, and the code goes with it', async () => {
    const server = createServer()
    server.on(renew, () => {
      server.household = demoted()
      return problem(403, 'forbidden')
    })
    const { user } = await profile(server)
    await user.click(screen.getByRole('button', { name: 'Make a new code' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Make a new code' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an owner can change this, and you are not one any more. Nothing was changed.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'The household code' })).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(
      screen.getByRole('heading', { name: 'The household' }),
    )
  })

  it('says a household that became read-only made no new code, and keeps the one it has', async () => {
    const server = createServer()
    server.on(renew, () => {
      server.household = { ...tilcerovi, entitlement: readOnly }
      return problem(402, 'entitlement_restricted', {
        state: 'restricted',
        remedy: 'lift_restriction',
      })
    })
    const { user } = await profile(server)
    await user.click(screen.getByRole('button', { name: 'Make a new code' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Make a new code' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The household is read-only now, so nothing was changed.',
    )
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Make a new code' })).not.toBeInTheDocument()
    })
    expect(pairs(section('The household code')).Code).toBe('K7M2-4PQX')
  })
})

describe('the profile under the pseudo-locale', () => {
  /** The runs of plain letters the page draws outside a list of choices, as the pass reads it. */
  function plain(): string[] {
    const words: string[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.parentElement?.closest('option') !== null) continue
      words.push(...((node.textContent ?? '').match(/[A-Za-z]{4,}/g) ?? []))
    }
    return words
  }

  // The end-to-end pass takes a run of four plain letters for a word nobody translated. A day of
  // the week, a language's own name, a timezone and a code are no catalog's, and are accented
  // there with the catalogs' words, so that the pass is about what escaped them.
  it('draws no word in plain letters: not the day, the language, the timezone or the code', async () => {
    window.localStorage.setItem(storageKey, pseudoLocale)
    const server = createServer()
    // What a household is called and who is in it are its own, and no word of the app's.
    server.household = { ...tilcerovi, name: 'T. 1', join_code: 'KMPQRSTU' }
    server.members = members.map((member) => ({ ...member, display_name: 'A.' }))
    const { user } = open(inHousehold.settings(home), server)
    await screen.findByRole('heading', { level: 1 })
    await screen.findByText(/Çžéçĥíá/)
    await screen.findByText(/A\., /)
    expect(plain()).toEqual([])

    await user.click(screen.getAllByRole('button')[0] as HTMLElement)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(plain()).toEqual([])
  })
})
