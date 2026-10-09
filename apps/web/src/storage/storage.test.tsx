// The storage picture (C-54) as each member reads it: what an owner is told of the month and
// its charge and nobody else is, what the picture says of a household that stores nothing, of
// one that takes no uploads and of one near, at and past its allowance, and the picture while
// it is read, unread and kept. The screen writes nothing, which is held too.
import { pseudoLocale } from '@household/i18n/lazy'
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inHousehold } from '../app/paths.ts'
import { defaultsFor } from '../household/grants.ts'
import { storageKey } from '../i18n/locale.ts'
import {
  accountOf,
  adam,
  holding,
  home,
  jana,
  klara,
  memberOf,
  petr,
  problem,
  readBy,
  tilcerovi,
} from '../household/testing.tsx'
import { together, type StorageReport } from './data.ts'
import {
  columnsOf,
  fullestDay,
  hasUnlisted,
  plotHeight,
  standingOf,
  storesNothing,
  unattributedBytes,
} from './picture.ts'
import {
  createServer,
  gb,
  nothing,
  open,
  plan,
  report,
  routes,
  samples,
  unused,
  usage,
  type StorageServer,
} from './testing.tsx'

// A test that says the page is looked at again leaves the next one a page nobody has looked at,
// and one that takes the connection away leaves the next one a browser that has it.
afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

const at = inHousehold.storage(home)
const household = `GET /households/${home}`

const readOnly = {
  ...tilcerovi,
  entitlement: { state: 'read_only', can_write: false, can_upload: false },
} as const

/** The household as Petr reads it, a member who can see household settings, two blocks in effect. */
const petrs = {
  ...readBy(memberOf(petr)),
  entitlement: {
    state: 'active',
    can_write: true,
    can_upload: true,
    storage_used_bytes: report.total_bytes,
    storage_included_bytes: report.included_bytes,
    storage_blocks: 2,
  },
} as const

async function storage(server: StorageServer = createServer()) {
  const opened = open(at, server)
  await screen.findByRole('heading', { level: 1 })
  return opened
}

/** The section of the picture called `name`, once it is drawn. */
const section = (name: string) => screen.findByRole('region', { name })

/** What the pair called `key` says, in a section's block of pairs. */
function said(block: HTMLElement, key: string): HTMLElement {
  const value = within(block).getByText(key).nextElementSibling
  if (!(value instanceof HTMLElement)) throw new Error(`${key} says nothing`)
  return value
}

/** The rows of the list called `name`, in their order, once it is drawn. */
async function rowsOf(name: string): Promise<HTMLElement[]> {
  return within(await screen.findByRole('list', { name })).getAllByRole('listitem')
}

/** What an element says, a space of any kind read as one: `Intl` sets a unit off with its own. */
const words = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ')

describe('the storage picture', () => {
  it('is titled for what it shows, and says what it is', async () => {
    await storage()
    expect(screen.getByRole('heading', { level: 1, name: 'Storage' })).toBeInTheDocument()
    await waitFor(() => {
      expect(document.title).toBe('Storage · Household')
    })
    expect(
      screen.getByText('What the household stores, against what its plan includes.'),
    ).toBeInTheDocument()
  })

  it('says what is stored against the allowance, and how much of it is in use', async () => {
    await storage()
    const now = await section('Right now')
    expect(said(now, 'Stored')).toHaveTextContent('19.4 GB')
    expect(said(now, 'Allowance this month')).toHaveTextContent('25 GB')
    expect(within(now).getByText('77.6% of the allowance is in use.')).toBeInTheDocument()
    expect(
      within(now).getByText(
        'The allowance is what the plan includes and the blocks in effect this month.',
      ),
    ).toBeInTheDocument()
    // The share is drawn beside the words that say it, and is theirs alone to say.
    expect(now.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    // Under four fifths of the allowance nothing more is said.
    expect(within(now).queryByText('Near the storage allowance')).not.toBeInTheDocument()
  })

  it('says to an owner the month as it will be billed, and how far it is from a block more and a block fewer', async () => {
    await storage()
    const month = await section('This month')
    // The month's days are the server's, UTC's, and are shown as the days they are.
    expect(
      within(month).getByText('From Sep 1, 2026 to Sep 30, 2026, counted in UTC days.'),
    ).toBeInTheDocument()
    expect(said(month, 'Daily average so far')).toHaveTextContent('18.2 GB')
    expect(said(month, 'Blocks it needs')).toHaveTextContent('2 blocks')
    expect(said(month, 'Projected average at the month’s end')).toHaveTextContent('18.9 GB')
    expect(said(month, 'Blocks that will be billed')).toHaveTextContent('2 blocks')
    expect(said(month, 'Projected charge for storage')).toHaveTextContent('EUR 2.00')
    expect(said(month, 'Price of a block')).toHaveTextContent('EUR 1.00 a month for 10 GB')
    expect(
      within(month).getByText(
        'Storage is billed on the average of the month’s daily measurements, not on its fullest day, so a large file added and removed the same day costs nothing.',
      ),
    ).toBeInTheDocument()
    expect(
      within(month).getByText(
        'The projection assumes that what is stored now stays for the rest of the month.',
      ),
    ).toBeInTheDocument()
    expect(
      within(month).getByText('Another block is needed once the month’s average rises by 6.8 GB.'),
    ).toBeInTheDocument()
    expect(
      within(month).getByText(
        'One block fewer is needed once the month’s average falls by 3.2 GB.',
      ),
    ).toBeInTheDocument()
    // The household subscribes: its month is billed, and nothing says otherwise.
    expect(within(month).queryByText(/has no subscription/)).not.toBeInTheDocument()
  })

  it('says of one block that it is one, and of a month that needs none that it needs none', async () => {
    const server = createServer()
    server.usage = { ...usage, blocks_now: 0, blocks_projected: 1, bytes_to_drop_a_block: null }
    await storage(server)
    const month = await section('This month')
    expect(said(month, 'Blocks it needs')).toHaveTextContent('None')
    expect(said(month, 'Blocks that will be billed')).toHaveTextContent('1 block')
    // With no block in effect there is none to drop.
    expect(within(month).queryByText(/^One block fewer/)).not.toBeInTheDocument()
  })

  it('says a month that ends with no subscription is not billed', async () => {
    const server = createServer()
    server.plan = { ...plan, state: 'trialing', interval: null, base_price: null }
    await storage(server)
    expect(
      within(await section('This month')).getByText(
        'The household has no subscription now. A month that ends without one is not billed for storage.',
      ),
    ).toBeInTheDocument()
  })

  it('says every block is in effect where the plan has no more to add', async () => {
    const server = createServer()
    server.usage = {
      ...usage,
      current_bytes: 100 * gb,
      mtd_average_bytes: 200 * gb,
      included_bytes: 205 * gb,
      blocks_now: 20,
      blocks_projected: 20,
      bytes_to_next_block: 5 * gb,
    }
    await storage(server)
    const month = await section('This month')
    expect(
      within(month).getByText('Every block the plan has is in effect: no more are added.'),
    ).toBeInTheDocument()
    expect(within(month).queryByText(/^Another block is needed/)).not.toBeInTheDocument()
  })

  it('draws the trend, and says in words where it began, where it stands and its fullest day', async () => {
    await storage()
    const trend = await section('Day by day')
    expect(
      within(trend).getByText(
        'What the household stored when each day was measured. Each day is a UTC day.',
      ),
    ).toBeInTheDocument()
    expect(
      within(trend).getByText(
        'From 15 GB on Jun 12, 2026 to 19.4 GB on Sep 9, 2026, over 90 measured days.',
      ),
    ).toBeInTheDocument()
    // The first of the two days that held the most.
    expect(within(trend).getByText('The most was 19.4 GB, on Sep 8, 2026.')).toBeInTheDocument()
    // A column a day, placed by attributes and by no style, and hidden from assistive technology.
    const plot = trend.querySelector('svg')
    expect(plot).toHaveAttribute('aria-hidden', 'true')
    expect(plot).toHaveAttribute('viewBox', `0 0 90 ${String(plotHeight)}`)
    expect(plot?.querySelectorAll('rect')).toHaveLength(90)
    expect(trend.querySelector('[style]')).toBeNull()
    // The sentences are the plot's own caption.
    expect(within(trend).getByRole('figure')).toHaveTextContent(/^From 15 GB on Jun 12, 2026/)
  })

  it('says one measured day in words alone, and that none has been measured yet', async () => {
    const server = createServer()
    server.report = { ...report, trend: samples('2026-09-09', 1, () => report.total_bytes) }
    const first = await storage(server)
    const one = await section('Day by day')
    expect(
      within(one).getByText('One day has been measured so far: 19.4 GB on Sep 9, 2026.'),
    ).toBeInTheDocument()
    expect(one.querySelector('svg')).toBeNull()
    first.unmount()

    server.report = { ...report, trend: [] }
    await storage(server)
    const none = await section('Day by day')
    expect(
      within(none).getByText('No day has been measured yet. The household is measured once a day.'),
    ).toBeInTheDocument()
    expect(none.querySelector('svg')).toBeNull()
  })

  it('splits what is stored by module, each line saying how much of it is copies made from the files', async () => {
    await storage()
    const rows = await rowsOf('By module')
    // A row's name is the first thing its line says, beside its glyph.
    expect(rows.map((row) => words(row.querySelector('div > div > span')))).toEqual([
      'Documents',
      'Chat',
      'Garden',
      'Utilities',
      'Finance',
      'Notes',
      'Shopping',
    ])
    const [documents, , , utilities, finance] = rows as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ]
    expect(within(documents).getByText('6.7 GB')).toBeInTheDocument()
    expect(
      within(documents).getByText(
        '6.1 GB of files and 600 MB of previews and thumbnails made from them',
      ),
    ).toBeInTheDocument()
    expect(
      within(utilities).getByText(
        '1.1 GB of files and 100 MB of previews and thumbnails made from them',
      ),
    ).toBeInTheDocument()
    // A module with no copies says its files, and nothing of copies.
    expect(within(finance).getByText('400 MB')).toBeInTheDocument()
    expect(within(finance).queryByText(/previews/)).not.toBeInTheDocument()
    // The copies are named and counted, and said to be billed as the files are.
    expect(
      within(await section('By module')).getByText(
        'Of these, 1.8 GB is previews and thumbnails made from the files. They are counted and billed like the files themselves, which is why removing an item frees more than the file’s own size.',
      ),
    ).toBeInTheDocument()
    // Every module has its line: they add up, and nothing says they need not.
    expect(screen.queryByText(/need not add up/)).not.toBeInTheDocument()
    // The contract's own names for the modules are drawn nowhere.
    expect(document.body).not.toHaveTextContent(/\b(documents|utilities|finance|shopping)\b/)
  })

  it('says the lines need not add up where a module the reader cannot see keeps files', async () => {
    const server = createServer()
    server.report = { ...report, by_module: report.by_module.slice(0, 2) }
    await storage(server)
    expect(await rowsOf('By module')).toHaveLength(2)
    expect(
      screen.getByText(
        'The total also counts what is in modules that are turned off or that you cannot see. They have no line here, so the lines need not add up to it.',
      ),
    ).toBeInTheDocument()
  })

  // A module added on the server since this page was loaded: the page has no word for it.
  it('leaves out a module this build cannot name, as one its reader cannot see', async () => {
    const server = createServer()
    const cellar = 'cellar' as StorageReport['by_module'][number]['module']
    const [item] = report.largest
    if (item === undefined) throw new Error('the fixture lists no item')
    server.report = {
      ...report,
      by_module: [
        { module: cellar, bytes: 6 * gb, derived_bytes: 7 * gb, object_count: 1 },
        ...report.by_module.slice(1),
      ],
      largest: [{ ...item, module: cellar }, ...report.largest.slice(1)],
    }
    await storage(server)
    expect(await rowsOf('By module')).toHaveLength(6)
    expect(await rowsOf('The largest items')).toHaveLength(2)
    // Its files are in the total and in no line, which is said; its copies are not counted
    // among those of the modules that have one.
    expect(screen.getByText(/the lines need not add up to it\.$/)).toBeInTheDocument()
    expect(screen.getByText(/^Of these, 1\.2 GB is previews and thumbnails/)).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('cellar')
  })

  it('says what is stored is in modules its reader cannot see where none has a line', async () => {
    const server = createServer()
    server.report = { ...report, by_module: [], largest: [] }
    await storage(server)
    const modules = await section('By module')
    expect(
      within(modules).getByText(
        'What is stored is in modules that are turned off or that you cannot see.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'By module' })).not.toBeInTheDocument()
    expect(
      within(await section('The largest items')).getByText(
        'Nothing you can open is among what is stored.',
      ),
    ).toBeInTheDocument()
  })

  it('splits it by member, the largest first, each with what they keep', async () => {
    await storage()
    const rows = await rowsOf('By member')
    expect(rows.map(words)).toEqual([
      'Jana Tilcerová8.4 GB',
      'Miloš Tilcer5.9 GB',
      'Petr Tilcer3.1 GB',
      'Adam1.2 GB',
      'Klára Nováková800 MB',
    ])
    expect(
      within(await section('By member')).getByText(
        'Whose files they are, each with the previews and thumbnails made from it.',
      ),
    ).toBeInTheDocument()
    // Every byte is somebody's.
    expect(screen.queryByText(/in no member’s name/)).not.toBeInTheDocument()
  })

  it('names somebody who has left as one who has, and an erased account as a former member', async () => {
    const server = createServer()
    server.report = {
      ...report,
      by_member: [
        { user: { user_id: petr, label: 'Petr Tilcer', is_former_member: true }, bytes: 9 * gb },
        { user: { user_id: klara, label: '', is_former_member: true }, bytes: 4 * gb },
        { user: { user_id: adam, label: '', is_former_member: true }, bytes: 2 * gb },
      ],
    }
    await storage(server)
    const [left, erased, another] = (await rowsOf('By member')) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ]
    expect(within(left).getByText('Petr Tilcer')).toBeInTheDocument()
    expect(within(left).getByText('No longer a member')).toBeInTheDocument()
    // No name is left of an account that was erased, and nothing more is said of it.
    expect(erased).toHaveTextContent(/^A former member4 GB$/)
    expect(another).toHaveTextContent(/^A former member2 GB$/)
    // What has no owner is in the total and in nobody's line.
    expect(screen.getByText('4.4 GB is in no member’s name.')).toBeInTheDocument()
  })

  it('lists the largest items by what removing each would free, and opens none of them', async () => {
    await storage()
    const rows = await rowsOf('The largest items')
    expect(rows).toHaveLength(3)
    const [first, second, third] = rows as [HTMLElement, HTMLElement, HTMLElement]
    expect(within(first).getByText('Chata, střecha 2025-08.mp4')).toBeInTheDocument()
    expect(within(first).getByText('Removing it would free 950 MB')).toBeInTheDocument()
    expect(within(first).getByText('Chat · the file itself is 900 MB')).toBeInTheDocument()
    expect(within(second).getByText('Removing it would free 600 MB')).toBeInTheDocument()
    expect(within(second).getByText('Documents · the file itself is 400 MB')).toBeInTheDocument()
    // One its module gave no name, whose file has none either.
    expect(within(third).getByText('An item with no name')).toBeInTheDocument()
    expect(within(third).getByText('Garden · the file itself is 300 MB')).toBeInTheDocument()
    expect(
      within(await section('The largest items')).getByText(
        'By what removing each would free: the file, and every preview and thumbnail made from it. Items you cannot open are not listed.',
      ),
    ).toBeInTheDocument()
    // No module has screens yet: nothing leads into one, and nothing here is pressed.
    expect(within(await section('The largest items')).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says a size in the largest unit it fills', async () => {
    const server = createServer()
    const [item] = report.largest
    if (item === undefined) throw new Error('the fixture lists no item')
    server.report = {
      ...report,
      largest: [{ ...item, bytes: 2_300, recoverable_bytes: 1_250_000 }],
    }
    await storage(server)
    const [row] = await rowsOf('The largest items')
    expect(row).toHaveTextContent('Removing it would free 1.3 MB')
    expect(row).toHaveTextContent('the file itself is 2.3 kB')
  })

  it('tells an owner how storage is counted, with the plan’s own figures', async () => {
    await storage()
    const counted = await section('How storage is counted')
    expect(
      within(counted).getByText(
        'Every file a member adds counts, and so do the previews and thumbnails made from it.',
      ),
    ).toBeInTheDocument()
    expect(
      within(counted).getByText(
        'The plan includes 5 GB. Past it, whole blocks of 10 GB are added automatically, at EUR 1.00 a month each, up to 20 blocks: 205 GB in all. Past that nothing more can be uploaded, and nothing is ever deleted to make room.',
      ),
    ).toBeInTheDocument()
    // What is billed is said once, with the month it is about.
    expect(screen.getAllByText(/^Storage is billed on the average/)).toHaveLength(1)
  })

  it('asks for the picture, the month and the plan, once each, and writes nothing', async () => {
    const server = createServer()
    await storage(server)
    await section('How storage is counted')
    expect(server.to(routes.picture)).toHaveLength(1)
    expect(server.to(routes.usage)).toHaveLength(1)
    expect(server.to(routes.plan)).toHaveLength(1)
    expect(server.sent.filter((request) => request.method !== 'GET')).toEqual([])
  })
})

describe('where what is stored stands against the allowance, to an owner', () => {
  /** The picture of a household that stores `stored`, the server's answers changed by `change`. */
  const storing = async (stored: number, change?: (server: StorageServer) => void) => {
    const server = createServer()
    server.report = { ...report, total_bytes: stored }
    server.usage = { ...usage, current_bytes: stored }
    change?.(server)
    await storage(server)
    return section('Right now')
  }

  it('says it is near at four fifths of it, and that another block follows the average', async () => {
    const now = await storing(20 * gb)
    // Beside the figure it is said of.
    expect(within(now).getByText('80% of the allowance is in use.')).toBeInTheDocument()
    expect(within(now).getByText('Near the storage allowance')).toBeInTheDocument()
    expect(
      within(now).getByText(
        'Past it, another block is added to the month’s bill as the average needs it.',
      ),
    ).toBeInTheDocument()
    // It was so when the screen opened: read in its place, and announced to nobody.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says nothing of it a byte under four fifths', async () => {
    const now = await storing(20 * gb - 1)
    expect(within(now).queryByText('Near the storage allowance')).not.toBeInTheDocument()
  })

  it('says nothing more can be uploaded past it where every block is in effect', async () => {
    const now = await storing(170 * gb, (server) => {
      server.report = { ...server.report, included_bytes: 205 * gb }
      server.usage = {
        ...server.usage,
        included_bytes: 205 * gb,
        blocks_now: 20,
        blocks_projected: 20,
      }
    })
    expect(within(now).getByText('Near the storage allowance')).toBeInTheDocument()
    expect(within(now).getByText('Past it, nothing more can be uploaded.')).toBeInTheDocument()
  })

  it('says it is used up at the whole of it, and that uploads still work', async () => {
    const now = await storing(25 * gb)
    expect(within(now).getByText('The storage allowance is used up')).toBeInTheDocument()
    expect(
      within(now).getByText(
        'Uploads still work. The next block is added to the month’s bill if the month’s average passes the allowance.',
      ),
    ).toBeInTheDocument()
    expect(within(now).queryByText('Near the storage allowance')).not.toBeInTheDocument()
  })

  it('says uploads are blocked at the most a household may store, and what is not affected', async () => {
    const now = await storing(205 * gb, (server) => {
      server.usage = { ...server.usage, upload_blocked: true }
    })
    expect(within(now).getByText('Uploads are blocked')).toBeInTheDocument()
    expect(
      within(now).getByText(
        'The household holds as much as it may: 205 GB. Nothing new can be uploaded until something is deleted. Reading, downloading and exporting are not affected.',
      ),
    ).toBeInTheDocument()
    expect(within(now).queryByText('The storage allowance is used up')).not.toBeInTheDocument()
  })

  it('says none of it of a household that takes no uploads, whose own sentence says so', async () => {
    const now = await storing(25 * gb, (server) => {
      server.usage = { ...server.usage, upload_blocked: true }
      server.household = {
        ...tilcerovi,
        entitlement: { state: 'grace', can_write: true, can_upload: false },
      }
    })
    expect(within(now).queryByText('The storage allowance is used up')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Uploads still work')
    expect(
      screen.getByText(
        'Nothing new can be uploaded for now. Everything else works, and what is stored can still be read and downloaded.',
      ),
    ).toBeInTheDocument()
  })
})

describe('the storage picture, to a member who is no owner', () => {
  it('is the same picture with the blocks in effect, and no money', async () => {
    const server = createServer(accountOf(petr))
    server.household = petrs
    await storage(server)
    const now = await section('Right now')
    expect(said(now, 'Stored')).toHaveTextContent('19.4 GB')
    expect(said(now, 'Allowance this month')).toHaveTextContent('25 GB')
    expect(said(now, 'Blocks in effect')).toHaveTextContent('2 blocks')
    expect(await rowsOf('By module')).toHaveLength(7)
    expect(await rowsOf('By member')).toHaveLength(5)
    expect(await rowsOf('The largest items')).toHaveLength(3)
    expect(await section('Day by day')).toBeInTheDocument()
    // Billing is no part of a member's app (FR-BI5): the month and the plan are not asked for,
    // and no price, charge or currency is drawn.
    expect(screen.queryByRole('region', { name: 'This month' })).not.toBeInTheDocument()
    expect(server.to(routes.usage)).toHaveLength(0)
    expect(server.to(routes.plan)).toHaveLength(0)
    expect(document.body).not.toHaveTextContent(/EUR|Projected|Price/)
    // The settings' note of who may change what is here is left out: nothing here is changed.
    expect(screen.queryByText(/^You can read everything here/)).not.toBeInTheDocument()
  })

  it('is told how storage is counted with the allowance they are answered, and no price', async () => {
    const server = createServer(accountOf(petr))
    server.household = petrs
    await storage(server)
    const counted = await section('How storage is counted')
    expect(
      within(counted).getByText(
        'The household’s allowance this month is 25 GB. Past what the plan includes, storage is added automatically in whole blocks, and nothing is ever deleted to make room.',
      ),
    ).toBeInTheDocument()
    expect(within(counted).getByText(/^Storage is billed on the average/)).toBeInTheDocument()
  })

  it('is not told where it stands against the allowance, which is its owners’ to be told', async () => {
    const server = createServer(accountOf(petr))
    server.household = petrs
    server.report = { ...report, total_bytes: 25 * gb }
    await storage(server)
    const now = await section('Right now')
    expect(within(now).getByText('100% of the allowance is in use.')).toBeInTheDocument()
    expect(within(now).queryByText('The storage allowance is used up')).not.toBeInTheDocument()
  })

  it('is not available to a member who holds nothing on household settings, and asks nothing', async () => {
    const server = createServer(accountOf(klara))
    await storage(server)
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link doesn’t open anything here.' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute(
      'href',
      inHousehold.home(home),
    )
    expect(server.to(routes.picture)).toHaveLength(0)
    expect(server.to(routes.usage)).toHaveLength(0)
    expect(server.to(routes.plan)).toHaveLength(0)
  })

  // A child profile's default on household settings is nothing (FR-AC4), and may be raised.
  it('is not available to a child profile, and is a member’s picture to one who was given the level', async () => {
    const server = createServer(accountOf(adam))
    const first = await storage(server)
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link doesn’t open anything here.' }),
    ).toBeInTheDocument()
    expect(server.to(routes.picture)).toHaveLength(0)
    first.unmount()

    server.household = readBy({
      ...memberOf(adam),
      grants: holding({ dashboard: 'view', chores: 'contribute', admin: 'view' }),
    })
    await storage(server)
    expect(said(await section('Right now'), 'Stored')).toHaveTextContent('19.4 GB')
    expect(server.to(routes.usage)).toHaveLength(0)
  })

  const changed =
    'Your access changed, so this is no longer part of your app. Nobody deleted anything.'

  it('says that access changed when the picture is refused after it was read', async () => {
    const server = createServer(accountOf(petr))
    server.household = petrs
    await storage(server)
    await section('Right now')

    // An owner lowers what Petr holds on household settings while he is looking at the picture.
    server.household = readBy({
      ...memberOf(petr),
      grants: holding({ dashboard: 'view', utilities: 'manage', shopping: 'contribute' }),
    })
    act(() => {
      focusManager.setFocused(true)
    })
    // It arrived while he was here: said, and not only drawn.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(changed)
    })
    expect(screen.queryByRole('region', { name: 'Right now' })).not.toBeInTheDocument()
    // The way to the picture goes with the level.
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Storage' })).not.toBeInTheDocument()
    })
    // He was here when it changed: he is told so, and not shown a screen that never was.
    expect(screen.getByText(changed)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Storage' })).toBeInTheDocument()
  })

  it('reads the household again where the picture is refused though the household said they hold it', async () => {
    const server = createServer(accountOf(petr))
    server.household = petrs
    // What this browser read of the household is older than what an owner did since.
    server.on(routes.picture, () => problem(404, 'not_found'))
    await storage(server)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(changed)
    })
    // The picture's own refusal is the server's word on it: the household is read again, once,
    // which is what tells the rest of the app, and the picture is not asked for a second time.
    await waitFor(() => {
      expect(server.to(household)).toHaveLength(2)
    })
    expect(server.to(routes.picture)).toHaveLength(1)
  })

  it('draws the picture as a member’s to an owner the server answers as one no longer', async () => {
    const server = createServer()
    // The month is refused though the household says Jana owns it.
    server.on(routes.usage, () => problem(404, 'not_found'))
    await storage(server)
    // The picture is drawn, without the money that is an owner's to read, and not as unread.
    expect(said(await section('Right now'), 'Stored')).toHaveTextContent('19.4 GB')
    expect(screen.queryByRole('region', { name: 'This month' })).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/EUR/)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      within(await section('How storage is counted')).getByText(
        /^The household’s allowance this month is 25 GB\./,
      ),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(server.to(household)).toHaveLength(2)
    })
  })

  it('takes the money away from one who was an owner when the picture was read', async () => {
    const server = createServer()
    await storage(server)
    await section('This month')

    // Jana is made a member while she is looking at the picture.
    server.household = readBy({
      ...memberOf(jana.id),
      role: 'member',
      grants: defaultsFor('member'),
    })
    act(() => {
      focusManager.setFocused(true)
    })
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'This month' })).not.toBeInTheDocument()
    })
    expect(said(await section('Right now'), 'Stored')).toHaveTextContent('19.4 GB')
    expect(document.body).not.toHaveTextContent(/EUR/)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('the picture of a household that stores nothing', () => {
  it('teaches an owner what is counted, what is included and how blocks are worked out', async () => {
    const server = createServer()
    server.report = nothing
    server.usage = unused
    await storage(server)
    expect(await screen.findByText('Nothing is stored yet.')).toBeInTheDocument()
    expect(screen.getByText('Example')).toBeInTheDocument()
    expect(
      screen.getByText('A photo added to a chat, with the thumbnail made from it.'),
    ).toBeInTheDocument()
    // The month reads as it stands, a nothing that was measured, with what a block would cost.
    const month = await section('This month')
    expect(said(month, 'Daily average so far')).toHaveTextContent('0 GB')
    expect(said(month, 'Blocks it needs')).toHaveTextContent('None')
    expect(said(month, 'Projected charge for storage')).toHaveTextContent('EUR 0.00')
    expect(said(month, 'Price of a block')).toHaveTextContent('EUR 1.00 a month for 10 GB')
    expect(
      within(month).getByText('Another block is needed once the month’s average rises by 5 GB.'),
    ).toBeInTheDocument()
    expect(
      within(await section('How storage is counted')).getByText(/^The plan includes 5 GB\./),
    ).toBeInTheDocument()
    // Nothing is split and nothing is listed, and no module has a screen to add a file on.
    expect(screen.queryByRole('region', { name: 'Right now' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'By module' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Day by day' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('teaches a member the same, with the allowance they are answered and no price', async () => {
    const server = createServer(accountOf(petr))
    server.report = nothing
    await storage(server)
    expect(await screen.findByText('Nothing is stored yet.')).toBeInTheDocument()
    const counted = await section('How storage is counted')
    expect(
      within(counted).getByText(/^The household’s allowance this month is 5 GB\./),
    ).toBeInTheDocument()
    expect(within(counted).getByText(/^Storage is billed on the average/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'This month' })).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/EUR/)
  })

  it('draws a household that stored something once as a picture, with nothing to split', async () => {
    const server = createServer()
    server.report = {
      ...nothing,
      trend: samples('2026-09-01', 9, (index) => (index < 3 ? 2 * gb : 0)),
    }
    server.usage = { ...unused, mtd_average_bytes: 666_666_666, projected_average_bytes: 200 * 1e6 }
    await storage(server)
    expect(said(await section('Right now'), 'Stored')).toHaveTextContent('0 GB')
    expect(
      within(await section('Day by day')).getByText(
        'From 2 GB on Sep 1, 2026 to 0 GB on Sep 9, 2026, over 9 measured days.',
      ),
    ).toBeInTheDocument()
    expect(said(await section('This month'), 'Daily average so far')).toHaveTextContent('666.7 MB')
    expect(screen.queryByText('Nothing is stored yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'By module' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'By member' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'The largest items' })).not.toBeInTheDocument()
  })
})

describe('the picture of a household that takes no writes or no uploads', () => {
  it('still reads in a read-only household, under what that means for storage', async () => {
    const server = createServer()
    server.household = readOnly
    await storage(server)
    expect(
      screen.getByText(
        'This household is read-only, so nothing new can be uploaded. What is stored is kept, and can still be read and downloaded.',
      ),
    ).toBeInTheDocument()
    expect(said(await section('Right now'), 'Stored')).toHaveTextContent('19.4 GB')
    expect(await rowsOf('The largest items')).toHaveLength(3)
    expect(said(await section('This month'), 'Projected charge for storage')).toHaveTextContent(
      'EUR 2.00',
    )
    // A delete is a write, which such a household refuses: nothing is said of cleaning up.
    expect(document.body).not.toHaveTextContent(/clean|until something is deleted/i)
    // It was so when the screen opened: announced to nobody.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // The settings' own note is of changing what is here, of which there is nothing.
    expect(screen.queryByText(/^Read-only: nothing here can be changed/)).not.toBeInTheDocument()
  })

  it('says of a restricted household that an owner lifts it', async () => {
    const server = createServer(accountOf(petr))
    server.household = {
      ...petrs,
      entitlement: {
        ...petrs.entitlement,
        state: 'restricted',
        can_write: false,
        can_upload: false,
      },
    }
    await storage(server)
    expect(
      screen.getByText(
        'This household is restricted, so nothing new can be uploaded until an owner lifts the restriction. What is stored can still be read and downloaded.',
      ),
    ).toBeInTheDocument()
    expect(said(await section('Right now'), 'Stored')).toHaveTextContent('19.4 GB')
    // The contract's own words for a state and what it permits are drawn nowhere.
    expect(document.body).not.toHaveTextContent(/read_only|can_write|can_upload/)
  })

  it('says it above the teaching of a household that stores nothing, too', async () => {
    const server = createServer()
    server.household = readOnly
    server.report = nothing
    server.usage = unused
    await storage(server)
    expect(await screen.findByText('Nothing is stored yet.')).toBeInTheDocument()
    expect(screen.getByText(/^This household is read-only, so nothing new/)).toBeInTheDocument()
  })

  it('says nothing of it of a household that takes uploads', async () => {
    await storage()
    await section('Right now')
    expect(document.body).not.toHaveTextContent(/nothing new can be uploaded/i)
  })
})

describe('the storage picture while it is read, unread and kept', () => {
  it('is a skeleton while it is read', async () => {
    const server = createServer()
    server.on(routes.picture, () => new Promise<Response>(() => undefined))
    await storage(server)
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('is a skeleton to an owner until the month and the plan are read too', async () => {
    const server = createServer()
    let answer: (response: Response) => void = () => undefined
    server.on(
      routes.usage,
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    )
    await storage(server)
    await waitFor(() => {
      expect(server.to(routes.picture)).toHaveLength(1)
    })
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Right now' })).not.toBeInTheDocument()
    answer(Response.json(usage))
    expect(await section('This month')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
  })

  it('says it did not load and that nothing changed, and reads it again, the focus on its place', async () => {
    const server = createServer()
    server.on(routes.picture, () => Promise.reject(new TypeError('offline')))
    const { user } = await storage(server)
    // It arrived while its reader was here: said at once, and not only drawn.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The storage figures did not load')
    expect(alert).toHaveTextContent('Nothing the household stores has changed.')
    server.on(routes.picture, () => Response.json(server.report))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    const now = await section('Right now')
    expect(said(now, 'Stored')).toHaveTextContent('19.4 GB')
    // The control left with its sentence: the focus it held is on the picture's own place.
    const place = now.closest('[tabindex="-1"]')
    expect(place).not.toBeNull()
    expect(document.activeElement).toBe(place)
  })

  it('reads again only what was not read', async () => {
    const server = createServer()
    server.on(routes.usage, () => Promise.reject(new TypeError('offline')))
    const { user } = await storage(server)
    expect(await screen.findByRole('alert')).toHaveTextContent('The storage figures did not load')
    // The picture was read, and is no good to an owner without the month it is billed by.
    expect(screen.queryByRole('region', { name: 'Right now' })).not.toBeInTheDocument()
    server.on(routes.usage, () => Response.json(server.usage))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await section('This month')).toBeInTheDocument()
    expect(server.to(routes.usage)).toHaveLength(2)
    expect(server.to(routes.picture)).toHaveLength(1)
    expect(server.to(routes.plan)).toHaveLength(1)
  })

  // Asked with no connection and nothing kept, the read waits: that is a picture that could not
  // be read, and no skeleton that never ends.
  it('says it could not be read where it is asked for with no connection, and reads it when one returns', async () => {
    const server = createServer()
    server.on(household, () => {
      // The connection goes once the household is known: what the screen then asks for waits.
      onlineManager.setOnline(false)
      return Response.json(server.household)
    })
    await storage(server)
    expect(await screen.findByText('The storage figures did not load')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    expect(server.to(routes.picture)).toHaveLength(0)
    server.on(household, () => Response.json(server.household))
    act(() => {
      onlineManager.setOnline(true)
    })
    expect(said(await section('Right now'), 'Stored')).toHaveTextContent('19.4 GB')
  })

  // That the browser is offline is the shell's bar's to say (shell/HouseholdBars.tsx).
  it('draws what this browser kept when the connection goes', async () => {
    await storage()
    await section('Right now')
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(said(await section('Right now'), 'Stored')).toHaveTextContent('19.4 GB')
    expect(said(await section('This month'), 'Projected charge for storage')).toHaveTextContent(
      'EUR 2.00',
    )
    expect(await rowsOf('By module')).toHaveLength(7)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('draws what it kept where reading it again fails', async () => {
    const server = createServer()
    await storage(server)
    await section('Right now')
    server.on(routes.picture, () => Promise.reject(new TypeError('offline')))
    server.on(routes.usage, () => Promise.reject(new TypeError('offline')))
    act(() => {
      focusManager.setFocused(true)
    })
    await waitFor(() => {
      expect(server.to(routes.picture)).toHaveLength(2)
    })
    await waitFor(() => {
      expect(server.to(routes.usage)).toHaveLength(2)
    })
    expect(said(await section('Right now'), 'Stored')).toHaveTextContent('19.4 GB')
    expect(screen.queryByText('The storage figures did not load')).not.toBeInTheDocument()
  })
})

// Every word the screen draws is the catalogs', a figure `Intl` wrote, or what the server said
// of a member or a file: under the pseudo-locale nothing else is left in plain letters. The
// names here hold no run of four of them, so that what is found is the screen's own.
describe('the storage picture under the pseudo-locale', () => {
  /** The runs of four plain letters on the page, each text read by itself as the suite reads it. */
  const plain = () => {
    const found: string[] = []
    const texts = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = texts.nextNode(); node !== null; node = texts.nextNode()) {
      found.push(...((node.textContent ?? '').match(/[A-Za-z]{4,}/g) ?? []))
    }
    return found
  }

  it('draws no word of its own in plain letters, to an owner of a household that stores something', async () => {
    window.localStorage.setItem(storageKey, pseudoLocale)
    const server = createServer()
    const [item] = report.largest
    if (item === undefined) throw new Error('the fixture lists no item')
    server.report = {
      ...report,
      // Near its allowance: what that comes to is drawn too.
      total_bytes: 20 * gb,
      by_member: [
        { user: { user_id: jana.id, label: 'Ája', is_former_member: false }, bytes: 9 * gb },
        { user: { user_id: petr, label: 'Eda', is_former_member: true }, bytes: 4 * gb },
        { user: { user_id: klara, label: '', is_former_member: true }, bytes: 2 * gb },
      ],
      largest: [
        { ...item, label: 'Účet 2025.pdf' },
        { ...item, entity_id: '0190a000-0000-7000-8000-0000000000e9', label: '' },
      ],
    }
    open(at, server)
    await screen.findByRole('heading', { level: 1 })
    // Its seven sections, the month and the plan read with the picture.
    await waitFor(() => {
      expect(document.querySelectorAll('section')).toHaveLength(7)
    })
    expect(document.body).toHaveTextContent('EUR 2.00')
    expect(plain()).toEqual([])
  })

  it('draws none where nothing is stored, in a household that takes no uploads', async () => {
    window.localStorage.setItem(storageKey, pseudoLocale)
    const server = createServer()
    server.household = readOnly
    server.report = nothing
    server.usage = unused
    server.plan = { ...plan, interval: null, base_price: null }
    open(at, server)
    await screen.findByRole('heading', { level: 1 })
    await waitFor(() => {
      expect(document.querySelectorAll('section')).toHaveLength(2)
    })
    expect(plain()).toEqual([])
  })

  it('draws none to a member, nor where the picture did not load', async () => {
    window.localStorage.setItem(storageKey, pseudoLocale)
    const server = createServer(accountOf(petr))
    server.household = petrs
    server.report = { ...report, by_member: [], largest: [] }
    const first = open(at, server)
    await screen.findByRole('heading', { level: 1 })
    await waitFor(() => {
      expect(document.querySelectorAll('section')).toHaveLength(6)
    })
    expect(plain()).toEqual([])
    first.unmount()

    server.on(routes.picture, () => Promise.reject(new TypeError('offline')))
    open(at, server)
    await screen.findByRole('alert')
    expect(screen.getByRole('button')).toBeInTheDocument()
    expect(plain()).toEqual([])
  })
})

// The screen has no write. Should it be given one, it is asked at once, as every write of a
// household's own screens is (D-170; api/api.test.ts holds the directories that have some).
describe('a write of the storage screen', () => {
  const sources = import.meta.glob<string>(['./*.{ts,tsx}', '!./*.test.{ts,tsx}'], {
    query: '?raw',
    import: 'default',
    eager: true,
  })

  it('is none, and one added here is asked at once', () => {
    expect(Object.keys(sources)).toContain('./Storage.tsx')
    const writes = Object.entries(sources).flatMap(([path, source]) =>
      [...source.matchAll(/useMutation\(\{\s*(\S+)/g)].map(([, first = '']) => ({ path, first })),
    )
    expect(writes.filter(({ first }) => first !== '...askedNow,')).toEqual([])
    expect(writes).toEqual([])
  })
})

describe('whether a household stores anything', () => {
  it('is no where it stores nothing and no sample of its trend held anything', () => {
    expect(storesNothing(nothing)).toBe(true)
    expect(storesNothing({ ...nothing, trend: samples('2026-09-01', 3, () => 0) })).toBe(true)
    expect(storesNothing(report)).toBe(false)
    // Removed since, and still in the month's average.
    expect(storesNothing({ ...nothing, trend: samples('2026-09-01', 3, () => gb) })).toBe(false)
    expect(storesNothing({ ...nothing, total_bytes: 1 })).toBe(false)
  })
})

describe('where what is stored stands against the allowance', () => {
  const standing = (stored: number, allowance = 25 * gb) =>
    standingOf({ total_bytes: stored, included_bytes: allowance }, usage)

  it('is near from four fifths of it, counted in whole bytes', () => {
    expect(standing(20 * gb - 1)).toBe('under')
    expect(standing(20 * gb)).toBe('near')
    expect(standing(25 * gb - 1)).toBe('near')
  })

  it('is reached at the whole of it, and the ceiling at the most a household may store', () => {
    expect(standing(25 * gb)).toBe('reached')
    expect(standing(205 * gb - 1)).toBe('reached')
    expect(standing(205 * gb)).toBe('ceiling')
    // With every block in effect the allowance is the ceiling, and the ceiling is what it says.
    expect(standing(205 * gb, 205 * gb)).toBe('ceiling')
  })

  it('is not the ceiling for an answer that says uploads are blocked by the household’s state', () => {
    const blocked = { ...usage, upload_blocked: true }
    expect(standingOf({ total_bytes: 3 * gb, included_bytes: 5 * gb }, blocked)).toBe('under')
  })
})

describe('what the picture’s lines leave out of the total', () => {
  it('is something where the modules’ lines come to less than it', () => {
    expect(hasUnlisted(report)).toBe(false)
    expect(hasUnlisted({ ...report, by_module: report.by_module.slice(1) })).toBe(true)
    expect(hasUnlisted({ ...report, by_module: [] })).toBe(true)
  })

  it('is what no member’s line counts', () => {
    expect(unattributedBytes(report)).toBe(0)
    expect(unattributedBytes({ ...report, by_member: report.by_member.slice(1) })).toBe(8.4 * gb)
    // A picture read while a file was being added is not said to owe anybody bytes.
    expect(unattributedBytes({ ...report, total_bytes: gb })).toBe(0)
  })
})

describe('the columns of the trend', () => {
  it('stand each at its own day, a day with no sample a gap as wide as one', () => {
    const { days, bars } = columnsOf([
      { date: '2026-08-30', bytes: gb },
      { date: '2026-08-31', bytes: 2 * gb },
      // The first of September was not sampled.
      { date: '2026-09-02', bytes: 4 * gb },
    ])
    expect(days).toBe(4)
    expect(bars).toEqual([
      { day: 0, height: plotHeight / 4 },
      { day: 1, height: plotHeight / 2 },
      { day: 3, height: plotHeight },
    ])
  })

  it('draw none for a day that held nothing, and a small day as a column that can be seen', () => {
    const { bars } = columnsOf([
      { date: '2026-09-01', bytes: 0 },
      { date: '2026-09-02', bytes: 1 },
      { date: '2026-09-03', bytes: 100 * gb },
    ])
    expect(bars.map((bar) => bar.day)).toEqual([1, 2])
    expect(bars[0]?.height).toBeGreaterThan(1)
  })

  it('are none of a trend that never held anything, or has no sample', () => {
    expect(columnsOf(samples('2026-09-01', 5, () => 0))).toEqual({ days: 0, bars: [] })
    expect(columnsOf([])).toEqual({ days: 0, bars: [] })
  })

  it('name the first of the days that held the most as the fullest', () => {
    expect(fullestDay(samples('2026-09-01', 4, (index) => [1, 3, 3, 2][index] ?? 0))?.date).toBe(
      '2026-09-02',
    )
    expect(fullestDay([])).toBeUndefined()
  })
})

describe('several reads drawn as one body', () => {
  const read = { data: {}, isError: false, fetchStatus: 'idle' } as const
  const unread = { data: undefined, isError: false, fetchStatus: 'fetching' } as const

  it('are read once every one of them is', () => {
    expect(together([read, read]).data).toBeDefined()
    expect(together([read, unread]).data).toBeUndefined()
  })

  it('have failed, or wait for a connection, where one still unread has or does', () => {
    expect(together([read, { ...unread, isError: true }]).isError).toBe(true)
    expect(together([read, { ...unread, fetchStatus: 'paused' }]).fetchStatus).toBe('paused')
    expect(together([read, unread])).toMatchObject({ isError: false, fetchStatus: 'idle' })
  })

  it('say nothing of one that was read and could not be read again', () => {
    const stale = { ...read, isError: true, fetchStatus: 'paused' } as const
    expect(together([stale, read])).toMatchObject({ isError: false, fetchStatus: 'idle' })
    expect(together([stale, read]).data).toBeDefined()
  })
})
