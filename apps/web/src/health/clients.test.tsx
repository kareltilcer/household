// Clients and versions (C-57): what each row says of a client, whose it is and what it is, what
// is said of its version and what never is, which row is this browser, who is drawn the screen
// at all, and what it draws where the list cannot be read.
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientName } from '../api/client.ts'
import { inHousehold } from '../app/paths.ts'
import type { Client, ClientList } from './data.ts'
import {
  accountOf,
  adam,
  client,
  createServer,
  firefoxOnLinux,
  home,
  klara,
  laptop,
  memberOf,
  open,
  petr,
  phone,
  problem,
  readBy,
  readOnly,
  routes,
  syncWithout,
  type HouseholdServer,
  type OpenOptions,
} from './testing.tsx'
import { ownVersion } from './versions.ts'

afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

const at = inHousehold.clients(home)
/** This page's own version, as a report of it names it. */
const own = ownVersion(clientName())

const petrs = client({
  replica_id: laptop,
  member: { user_id: petr, label: 'Petr Tilcer', is_former_member: false },
  label: firefoxOnLinux,
  version: `${own}+0f0f0f0f0f0f0f0f`,
  last_seen_at: '2026-09-08T14:12:00Z',
})
const phones = client({
  replica_id: phone,
  member: { user_id: klara, label: 'Klára Nováková', is_former_member: false },
  type: 'mobile',
  platform: 'ios',
  label: 'Klářin telefon',
  version: '1.4.2',
  last_seen_at: '2026-09-07T19:03:00Z',
})

/** A server that lists `items`, under the minimums a deployment sets, which is none unless said. */
function listing(
  items: Client[],
  minimums: ClientList['minimum_versions'] = { web: null, mobile: null },
  server: HouseholdServer = createServer(),
) {
  server.on(`GET ${routes.clients}`, () =>
    Response.json({ items, minimum_versions: minimums } satisfies ClientList),
  )
  return server
}

async function clients(server: HouseholdServer = listing([client()]), options?: OpenOptions) {
  const opened = open(at, server, options)
  await screen.findByRole('heading', { level: 1 })
  return opened
}

const list = () => screen.findByRole('list', { name: 'Apps and versions' })

async function rows(): Promise<HTMLElement[]> {
  return [...(await list()).children] as HTMLElement[]
}

/** The row of the client `whose` member is named. */
async function rowOf(whose: string): Promise<HTMLElement> {
  const row = (await within(await list()).findByText(whose)).closest('li')
  if (row === null) throw new Error(`${whose} is on no row`)
  return row
}

describe('clients and versions', () => {
  it('is titled for what it shows, and says what it is for', async () => {
    await clients()
    expect(screen.getByRole('heading', { level: 1, name: 'Apps and versions' })).toBeInTheDocument()
    await waitFor(() => {
      expect(document.title).toBe('Apps and versions · Household')
    })
    expect(
      screen.getByText(
        'Every browser and device that has synced this household, and the version each one runs. Useful when one person sees something the others do not.',
      ),
    ).toBeInTheDocument()
  })

  it('says of each client whose it is, what it is, its version and when it last reported', async () => {
    await clients(listing([client({ version: own }), petrs, phones]))
    const [mine, laptopRow, phoneRow] = (await rows()) as [HTMLElement, HTMLElement, HTMLElement]
    expect(within(mine).getByText('Chrome on Windows')).toBeInTheDocument()
    expect(within(mine).getByText('Jana Tilcerová')).toBeInTheDocument()
    expect(within(mine).getByText(`Version ${own}`)).toBeInTheDocument()
    // In the household's zone: 16:41 in UTC is 18:41 in Prague.
    expect(within(mine).getByText(/^Last reported Sep 8, 2026, 6:41\sPM\.$/)).toBeInTheDocument()

    expect(within(laptopRow).getByText('Firefox on Linux')).toBeInTheDocument()
    expect(within(laptopRow).getByText('Petr Tilcer')).toBeInTheDocument()
    expect(within(laptopRow).getByText(`Version ${own}+0f0f0f0f0f0f0f0f`)).toBeInTheDocument()

    // The app on a phone: by its label, with what kind of device it is beside it.
    expect(within(phoneRow).getByText('Klářin telefon')).toBeInTheDocument()
    expect(within(phoneRow).getByText('iPhone or iPad')).toBeInTheDocument()
    expect(within(phoneRow).getByText('Klára Nováková')).toBeInTheDocument()
    expect(within(phoneRow).getByText('Version 1.4.2')).toBeInTheDocument()
    // A header anyone may write is drawn nowhere as it was sent, nor the contract's own words.
    expect(document.body).not.toHaveTextContent(/Mozilla|\bweb\b|\bmobile\b|\bios\b|replica/)
  })

  it('marks this browser’s row, by the id its replica reports under', async () => {
    await clients(listing([petrs, client()]))
    const [laptopRow, mine] = (await rows()) as [HTMLElement, HTMLElement]
    expect(await within(mine).findByText('This browser')).toBeInTheDocument()
    expect(within(laptopRow).queryByText('This browser')).not.toBeInTheDocument()
  })

  it('says of another browser whether it runs this page’s build, and never that it is behind', async () => {
    const same = client({
      replica_id: phone,
      member: { user_id: klara, label: 'Klára Nováková', is_former_member: false },
      version: own,
    })
    await clients(listing([client({ version: own }), petrs, same]))
    expect(
      within(await rowOf('Petr Tilcer')).getByText('Another build than this browser.'),
    ).toBeInTheDocument()
    expect(
      within(await rowOf('Klára Nováková')).getByText('The same build as this browser.'),
    ).toBeInTheDocument()
    // This browser is compared with nothing: it is the one the others are compared with.
    await within(await rowOf('Jana Tilcerová')).findByText('This browser')
    expect(within(await rowOf('Jana Tilcerová')).queryByText(/build/)).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/behind|current|newest version is|up to date/i)
    expect(
      screen.getByText(
        'A browser or device is listed once it has synced this household and reported, and a browser that was signed in again is listed again beside its earlier row. Another build is a fact, not a fault: nothing here knows which version is the newest.',
      ),
    ).toBeInTheDocument()
  })

  it('compares the app on a phone with no build of a browser’s', async () => {
    await clients(listing([client(), phones]))
    expect(within(await rowOf('Klára Nováková')).queryByText(/build/)).not.toBeInTheDocument()
  })

  it('says a client under the oldest version the deployment serves must update', async () => {
    await clients(
      listing(
        [
          client({ version: '0.0.9+aaaa' }),
          { ...petrs, version: '0.2.0-beta.1+bbbb' },
          { ...phones, version: '1.5.12' },
        ],
        { web: '0.2.0', mobile: '1.6.0' },
      ),
    )
    const mine = await rowOf('Jana Tilcerová')
    expect(within(mine).getByText('Must update before it syncs again')).toBeInTheDocument()
    expect(
      within(mine).getByText('The oldest version that still syncs is 0.2.0.'),
    ).toBeInTheDocument()
    // By its three numbers alone: a suffix is read past, and is no reason to refuse.
    expect(
      within(await rowOf('Petr Tilcer')).queryByText('Must update before it syncs again'),
    ).not.toBeInTheDocument()
    // Each type against its own minimum.
    const phoneRow = await rowOf('Klára Nováková')
    expect(within(phoneRow).getByText('Must update before it syncs again')).toBeInTheDocument()
    expect(
      within(phoneRow).getByText('The oldest version that still syncs is 1.6.0.'),
    ).toBeInTheDocument()
  })

  it('says nothing of a minimum where the deployment sets none', async () => {
    await clients(listing([client({ version: '0.0.1' }), phones]))
    await rowOf('Klára Nováková')
    expect(screen.queryByText('Must update before it syncs again')).not.toBeInTheDocument()
  })

  it('says a client that reported before versions were recorded has none', async () => {
    await clients(
      listing([
        client({ type: null, version: null }),
        { ...petrs, type: null, version: null, label: 'curl/8.4.0' },
        { ...phones, type: null, version: null, label: '' },
      ]),
    )
    const mine = await rowOf('Jana Tilcerová')
    expect(
      within(mine).getByText(
        'It last reported before versions were recorded, so its version isn’t known.',
      ),
    ).toBeInTheDocument()
    // What it is is told by what is left: a header that tells a browser, a device's platform,
    // or neither, which is said as that and never by the label.
    expect(within(mine).getByText('Chrome on Windows')).toBeInTheDocument()
    expect(within(await rowOf('Petr Tilcer')).getByText('A browser or device')).toBeInTheDocument()
    expect(within(await rowOf('Klára Nováková')).getByText('iPhone or iPad')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('curl')
    expect(within(await list()).queryByText(/build/)).not.toBeInTheDocument()
  })

  it('names the app on a device that named nothing by its platform, or as a phone or tablet', async () => {
    await clients(
      listing([
        client(),
        { ...phones, label: '  ', platform: 'android' },
        { ...petrs, type: 'mobile', label: '', platform: null, version: '1.4.2' },
      ]),
    )
    expect(
      within(await rowOf('Klára Nováková')).getByText('Android phone or tablet'),
    ).toBeInTheDocument()
    expect(within(await rowOf('Petr Tilcer')).getByText('Phone or tablet')).toBeInTheDocument()
  })

  it('gives the way to sync health', async () => {
    await clients()
    expect(
      screen.getByText(
        'How one of your own browsers or devices stands, and the way to download it again, is under Sync health.',
      ),
    ).toBeInTheDocument()
    // Named apart from the settings' own way there, which stands above every screen of them.
    expect(screen.getByRole('link', { name: 'Open Sync health' })).toHaveAttribute(
      'href',
      inHousehold.syncHealth(home),
    )
  })

  it('says it cannot mark this browser in a tab that holds no replica', async () => {
    await clients(listing([client(), petrs]), { sync: syncWithout('elsewhere') })
    expect(
      await screen.findByText(
        'Another tab of this browser keeps this household’s copy, so this tab can’t mark which row is this browser.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('This browser')).not.toBeInTheDocument()
    // What is compared with this page still is: the build is the page's own.
    expect(
      within(await rowOf('Petr Tilcer')).getByText('Another build than this browser.'),
    ).toBeInTheDocument()
  })
})

describe('who reads clients and versions', () => {
  it.each([
    ['a member who can see household settings', petr],
    ['a member who holds nothing on them', klara],
    ['a child profile', adam],
  ])('is not available to %s, and asks nothing of the server', async (_who, user) => {
    const server = listing([client()], undefined, createServer(accountOf(user)))
    await clients(server)
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link doesn’t open anything here.' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute(
      'href',
      inHousehold.home(home),
    )
    expect(server.to(`GET ${routes.clients}`)).toHaveLength(0)
  })

  it('is not available once the server says its reader is an owner no longer, and reads the household again', async () => {
    const server = createServer()
    server.on(`GET ${routes.clients}`, () => {
      // Made a member since the household was read.
      server.household = readBy(memberOf(petr))
      return problem(404, 'not_found')
    })
    await clients(server)
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This link doesn’t open anything here.',
      }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(server.to(`GET /households/${home}`).length).toBeGreaterThan(1)
    })
    expect(server.to(`GET ${routes.clients}`)).toHaveLength(1)
  })
})

describe('clients and versions, where the list cannot be read or nothing reports', () => {
  it('draws the list’s shape while it is read', async () => {
    const server = createServer()
    server.on(`GET ${routes.clients}`, () => new Promise<Response>(() => undefined))
    await clients(server)
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('says the list did not load and that nothing was changed, and reads it again', async () => {
    const server = createServer()
    server.on(`GET ${routes.clients}`, () => Promise.reject(new TypeError('offline')))
    const { user } = await clients(server)
    expect(await screen.findByText('The list of apps did not load')).toBeInTheDocument()
    expect(screen.getByText('Nothing on any browser or device was changed.')).toBeInTheDocument()
    listing([client()], undefined, server)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await rowOf('Jana Tilcerová')).toBeInTheDocument()
  })

  // A read that waits for a connection is no read under way: nothing is kept, and it is said.
  it('says a list it cannot ask for could not be read, and draws no skeleton', async () => {
    const server = listing([client()])
    let gone = false
    server.on(`GET /households/${home}`, () => {
      if (!gone) onlineManager.setOnline(false)
      gone = true
      return Response.json(server.household)
    })
    await clients(server)
    expect(await screen.findByText('The list of apps did not load')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    expect(server.to(`GET ${routes.clients}`)).toHaveLength(0)
  })

  it('is drawn as this browser kept it when the connection goes', async () => {
    await clients(listing([client(), petrs]))
    expect(await rows()).toHaveLength(2)
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(await rows()).toHaveLength(2)
    expect(screen.queryByText('The list of apps did not load')).not.toBeInTheDocument()
  })

  it('says in one sentence that nothing has reported yet', async () => {
    await clients(listing([]))
    expect(
      await screen.findByText(
        'No browser or device has reported on this household yet. One is listed once it has synced the household and reported.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Apps and versions' })).not.toBeInTheDocument()
  })

  it('says in a household that takes no writes that each row is as it last reported', async () => {
    const server = listing([client(), petrs])
    server.household = readOnly
    await clients(server)
    expect(await rows()).toHaveLength(2)
    expect(await screen.findByText('Read-only')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Nothing on this page changes anything. While the household can’t be changed, no browser or device reports on it, so each row is as it last reported.',
      ),
    ).toBeInTheDocument()
    // Nothing here writes: there is no control to take away.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
