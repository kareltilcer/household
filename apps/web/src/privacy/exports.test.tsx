// A household's exports (A-35): what each reader of the household sees, what asking for one and
// downloading one ask of the server and say afterwards, how a job on its way is followed, and
// what the list draws while it is read, when it could not be, and with no connection.
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inHousehold, paths } from '../app/paths.ts'
import {
  accountOf,
  createServer,
  home,
  jana,
  memberOf,
  petr,
  problem,
  readBy,
  tilcerovi,
  type HouseholdServer,
} from '../household/testing.tsx'
import { askAgainEvery } from './ExportList.tsx'
import { entryOf, listed, statusOf, underWay } from './exports.ts'
import { leaveFor } from './leave.ts'
import { archive, exportId, job, open, ready } from './testing.tsx'

// No test navigates: what the page handed the browser is read off this.
vi.mock('./leave.ts', () => ({ leaveFor: vi.fn() }))

// A test that takes the connection or the page's being looked at away leaves the next one a
// browser that has both, and one that holds the clock gives it back.
afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
  vi.useRealTimers()
  vi.mocked(leaveFor).mockClear()
})

const at = inHousehold.exports(home)
const exports = `/households/${home}/exports`
const one = `${exports}/${exportId(1)}`

const readOnly = {
  ...tilcerovi,
  entitlement: { state: 'read_only', can_write: false, can_upload: false },
} as const

/** A server whose household lists `jobs` as its reader's own exports. */
function serving(jobs: readonly ReturnType<typeof job>[] = [], me = jana): HouseholdServer {
  const server = createServer(me)
  server.on(`GET ${exports}`, () => Response.json({ items: jobs }))
  return server
}

async function screenOf(server: HouseholdServer = serving()) {
  const opened = open(at, server)
  await screen.findByRole('heading', { level: 1 })
  return opened
}

const list = () => screen.findByRole('list', { name: 'Exports you asked for' })

/** The row of the export asked for at `when`, as the row says it. */
async function rowOf(when = 'Sep 9, 2026, 7:02 PM'): Promise<HTMLElement> {
  const row = (await screen.findByText(`Asked for on ${when}`)).closest('li')
  if (row === null) throw new Error(`nothing was asked for on ${when}`)
  return row
}

const download = 'Download the export asked for on Sep 9, 2026, 7:02 PM'

describe('a household’s exports', () => {
  it('is titled for what it shows, and says what an export is', async () => {
    await screenOf()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Export the household' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(document.title).toBe('Export the household · Household')
    })
    expect(
      screen.getByText('Everything the household holds, as files that open without Household.'),
    ).toBeInTheDocument()
  })

  it('teaches an owner what an export is where none was asked for, with the one way to ask', async () => {
    await screenOf()
    expect(
      await screen.findByText(
        'No export yet. An export is one ZIP of everything the household holds, to keep or to take elsewhere.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Example')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Make an export' })).toHaveLength(1)
    // What to expect is said before the press: a day, an email, seven days, and no time left.
    expect(
      screen.getByText(
        'An export is usually ready within a day. We email you when it is, and it stays downloadable for seven days.',
      ),
    ).toBeInTheDocument()
  })

  // The email that says one is ready goes to a verified address alone.
  it('promises no email to an account whose address is not verified', async () => {
    await screenOf(serving([], { ...jana, email_verified: false }))
    expect(
      await screen.findByText(
        'An export is usually ready within a day and stays downloadable for seven days. No email will come, since your account has no verified address: look here.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/We email you/)).not.toBeInTheDocument()
  })

  it('says how each export stands in words, with its size and until when it downloads', async () => {
    const server = serving([
      job({ id: exportId(5), requested_at: '2026-09-09T20:00:00Z' }),
      job({ id: exportId(4), status: 'running', requested_at: '2026-09-08T20:00:00Z' }),
      ready(),
      job({ id: exportId(2), status: 'failed', requested_at: '2026-09-02T08:00:00Z' }),
      ready({
        id: exportId(3),
        status: 'expired',
        download_url: null,
        requested_at: '2026-08-01T08:00:00Z',
        expires_at: '2026-08-08T21:30:00Z',
        size_bytes: 412_000_000,
      }),
    ])
    await screenOf(server)
    // An instant is said in the member's own zone, whatever this device's is.
    expect(
      within(await rowOf('Sep 9, 2026, 10:00 PM')).getByText('Waiting to be made'),
    ).toBeInTheDocument()
    expect(within(await rowOf('Sep 8, 2026, 10:00 PM')).getByText('Being made')).toBeInTheDocument()

    const made = await rowOf()
    expect(within(made).getByText('Ready')).toBeInTheDocument()
    // The moment it is gone at, and not its day alone: on the day itself the day would be read
    // as the whole of it.
    expect(
      within(made).getByText(/^Download it until Sep 16, 2026, \d{1,2}:\d{2}\s[AP]M\.$/),
    ).toBeInTheDocument()
    expect(within(made).getByText('One ZIP of 1.6 GB')).toBeInTheDocument()

    const failed = await rowOf('Sep 2, 2026, 10:00 AM')
    expect(within(failed).getByText('Failed')).toBeInTheDocument()
    expect(within(failed).getByText('Nothing partial was kept.')).toBeInTheDocument()

    const expired = await rowOf('Aug 1, 2026, 10:00 AM')
    expect(within(expired).getByText('Expired')).toBeInTheDocument()
    expect(
      within(expired).getByText(/^It could be downloaded until Aug 8, 2026, 11:30\sPM\.$/),
    ).toBeInTheDocument()
    expect(within(expired).getByText('One ZIP of 412 MB')).toBeInTheDocument()

    // Newest first, as the server answers them, and only the one that is ready downloads.
    expect([...(await list()).children]).toHaveLength(5)
    expect(screen.getAllByRole('button', { name: /^Download/ })).toHaveLength(1)
    // The contract's own words for a state are drawn nowhere.
    expect(document.body).not.toHaveTextContent(/\b(queued|running)\b/)
  })

  // The server removes a household's archives with the household, whatever last moment each
  // names for itself, which is seven days from when it was made whatever is scheduled.
  it('says a ready export downloads until its household goes, where that comes first', async () => {
    const sooner = serving([ready()])
    sooner.household = { ...sooner.household, deletion_scheduled_at: '2026-09-12T08:00:00Z' }
    const first = await screenOf(sooner)
    expect(
      within(await rowOf()).getByText(/^Download it until Sep 12, 2026, 10:00\sAM\.$/),
    ).toBeInTheDocument()
    first.unmount()

    // A deletion that comes after the archive's own last moment takes nothing from it, and a
    // household that stays names the archive's own.
    const later = serving([ready()])
    later.household = { ...later.household, deletion_scheduled_at: '2026-10-01T08:00:00Z' }
    const second = await screenOf(later)
    expect(
      within(await rowOf()).getByText(/^Download it until Sep 16, 2026, 7:20\sPM\.$/),
    ).toBeInTheDocument()
    second.unmount()

    await screenOf(serving([ready()]))
    expect(
      within(await rowOf()).getByText(/^Download it until Sep 16, 2026, 7:20\sPM\.$/),
    ).toBeInTheDocument()
  })

  it('lists what is in an archive by its own names, each with what it is where its name says', async () => {
    const server = serving([ready({ contents: [...(ready().contents ?? []), 'recipes.bin'] })])
    const { user } = await screenOf(server)
    const made = await rowOf()
    await user.click(within(made).getByText('What is in it'))
    const line = (name: string) => within(made).getByText(name).closest('li')
    expect(line('garden.json')).toHaveTextContent('Garden: every record, as structured data')
    expect(line('files/')).toHaveTextContent('Every file, under its original name')
    expect(line('calendar.ics')).toHaveTextContent('The calendar, for any calendar app')
    expect(line('activity-log.csv')).toHaveTextContent(
      'The activity log, as it reads on screen for you',
    )
    expect(line('manifest.json')).toHaveTextContent(
      'What is inside, when it was taken, and a checksum of every file',
    )
    // A name this build has no line for is the archive's own all the same, and is shown.
    expect(line('recipes.bin')?.textContent).toBe('recipes.bin')
  })

  it('draws the list’s shape while it is read', async () => {
    const server = createServer()
    server.on(`GET ${exports}`, () => new Promise<Response>(() => undefined))
    await screenOf(server)
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make an export' })).not.toBeInTheDocument()
  })

  it('says the list did not load and that nothing was lost, and reads it again', async () => {
    const server = createServer()
    server.on(`GET ${exports}`, () => Promise.reject(new TypeError('offline')))
    const { user } = await screenOf(server)
    expect(await screen.findByText('The exports did not load')).toBeInTheDocument()
    expect(screen.getByText('Nothing was asked for, and nothing was lost.')).toBeInTheDocument()
    let answer: (response: Response) => void = () => undefined
    server.on(
      `GET ${exports}`,
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    // *Try again* left with the sentence it stood in as the list was asked for again: the focus
    // it held is on the list's own place from then on, and not dropped to the page.
    const shape = await screen.findByRole('status', { name: 'Loading' })
    const place = shape.closest('[tabindex="-1"]')
    expect(place).not.toBeNull()
    await waitFor(() => {
      expect(document.activeElement).toBe(place)
    })
    answer(Response.json({ items: [ready()] }))
    expect(place).toContainElement(await rowOf())
    expect(document.activeElement).toBe(place)
  })

  // A read that waits for a connection is no read under way: nothing is kept, and it is said.
  it('says a list it cannot ask for could not be read, and draws no skeleton', async () => {
    const server = serving([ready()])
    let gone = false
    server.on(`GET /households/${home}`, () => {
      // The connection goes once the household is known: what the screen then asks for waits.
      if (!gone) onlineManager.setOnline(false)
      gone = true
      return Response.json(server.household)
    })
    await screenOf(server)
    expect(await screen.findByText('The exports did not load')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    expect(server.to(`GET ${exports}`)).toHaveLength(0)
  })

  it('draws what this browser kept when the connection goes', async () => {
    const server = serving([ready()])
    await screenOf(server)
    await rowOf()
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(within(await rowOf()).getByText('Ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: download })).toBeInTheDocument()
  })
})

describe('who a household’s exports are for', () => {
  it('tells a member that an export is an owner’s, and leads them to their own data', async () => {
    const server = serving([], accountOf(petr))
    await screenOf(server)
    expect(
      await screen.findByText(
        'An export of the whole household is for an owner. A copy of what is yours is on your account.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Your data' })).toHaveAttribute(
      'href',
      paths.accountPrivacy.path,
    )
    // Absent, not disabled: no control that asks, and nothing that teaches how to.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('Example')).not.toBeInTheDocument()
    // The list they read is their own, which any member may ask for.
    expect(server.to(`GET ${exports}`)).toHaveLength(1)
  })

  // An owner made a member since: the job is theirs still, and its link is handed to an owner.
  it('still lists an export a member asked for while they were an owner, with no way to download it', async () => {
    const server = serving([ready({ download_url: null })], accountOf(petr))
    await screenOf(server)
    const made = await rowOf()
    expect(within(made).getByText('Ready')).toBeInTheDocument()
    expect(
      within(made).getByText(
        'Only an owner downloads an export of the household, and you are not one any more.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Download/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Your data' })).toBeInTheDocument()
  })

  // Asking for an export is one of the writes the gate lets through (FR-BI1).
  it('says to the owner of a read-only household that an export is made all the same, and asks', async () => {
    const server = serving()
    server.household = readOnly
    server.on(`POST ${exports}`, () => {
      server.on(`GET ${exports}`, () => Response.json({ items: [job()] }))
      return Response.json(job(), { status: 202 })
    })
    const { user } = await screenOf(server)
    expect(
      await screen.findByText(
        // Of a household an owner restricted as of one that lapsed: neither takes a change.
        'The household can’t be changed right now. An export is made and downloaded all the same.',
      ),
    ).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Make an export' }))
    expect(await screen.findByText('Waiting to be made')).toBeInTheDocument()
    expect(server.to(`POST ${exports}`)).toHaveLength(1)
  })

  // Taken out of the household since the page read it: the list's own refusal is the first word
  // of it. The household alone is read again, which is what tells the rest of the app; read
  // again with it, the list would only be refused again, and that refusal ask for the next.
  it('reads the household alone again where the list is answered as not its reader’s', async () => {
    const server = serving()
    server.on(`GET ${exports}`, () => {
      server.on(`GET /households/${home}`, () => problem(404, 'not_found'))
      return problem(404, 'not_found')
    })
    await screenOf(server)
    expect(await screen.findByText('The exports did not load')).toBeInTheDocument()
    await waitFor(() => {
      expect(server.to(`GET /households/${home}`)).toHaveLength(2)
    })
    for (let turn = 0; turn < 3; turn += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
    expect(server.to(`GET /households/${home}`)).toHaveLength(2)
    expect(server.to(`GET ${exports}`)).toHaveLength(1)
  })

  it('says nothing of a read-only household to a member, who asks for nothing', async () => {
    const server = serving([], accountOf(petr))
    server.household = { ...readBy(memberOf(petr)), entitlement: readOnly.entitlement }
    await screenOf(server)
    await screen.findByRole('link', { name: 'Your data' })
    expect(screen.queryByText(/^The household is read-only/)).not.toBeInTheDocument()
  })
})

describe('asking for an export', () => {
  it('asks the server, says so, lists the export, and puts the focus where it is listed', async () => {
    const server = serving()
    server.on(`POST ${exports}`, () => {
      server.on(`GET ${exports}`, () => Response.json({ items: [job()] }))
      return Response.json(job(), { status: 202 })
    })
    const { user } = await screenOf(server)
    await user.click(await screen.findByRole('button', { name: 'Make an export' }))

    expect(
      await screen.findByText('The export was asked for. It is usually ready within a day.'),
    ).toBeInTheDocument()
    const [asked] = server.to(`POST ${exports}`)
    expect(server.to(`POST ${exports}`)).toHaveLength(1)
    // Nothing is sent but the asking: the server mints the export's id.
    expect(await asked?.text()).toBe('')
    expect(within(await rowOf()).getByText('Waiting to be made')).toBeInTheDocument()
    // While one is on its way the server would answer the same job: no control asks again.
    expect(screen.queryByRole('button', { name: 'Make an export' })).not.toBeInTheDocument()
    expect(
      screen.getByText('An export is on its way, so another is not asked for yet.'),
    ).toBeInTheDocument()
    // The control that was pressed is gone: the focus is on the list's own place.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(await list())
    // The household is read again, its exports among what is filed under it.
    await waitFor(() => {
      expect(server.to(`GET ${exports}`).length).toBeGreaterThan(1)
    })
  })

  it('offers no asking while one is on its way, and offers it again beside one that has ended', async () => {
    const waiting = serving([job({ status: 'running' })])
    const first = await screenOf(waiting)
    await rowOf()
    expect(screen.queryByRole('button', { name: 'Make an export' })).not.toBeInTheDocument()
    first.unmount()

    await screenOf(serving([ready()]))
    await rowOf()
    expect(screen.getByRole('button', { name: 'Make an export' })).toBeInTheDocument()
  })

  it('says when another can be asked for, to an owner who asked for five in a day', async () => {
    const server = serving([ready()])
    server.on(`POST ${exports}`, () => problem(429, 'rate_limited', {}, { 'Retry-After': '3600' }))
    const { user } = await screenOf(server)
    await user.click(await screen.findByRole('button', { name: 'Make an export' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Too many attempts\. Try again at /)
    expect(screen.getByRole('button', { name: 'Make an export' })).not.toHaveAttribute('aria-busy')
  })

  it('says a second refusal as it said the first', async () => {
    const server = serving()
    server.on(`POST ${exports}`, () => problem(429, 'rate_limited'))
    const { user } = await screenOf(server)
    const control = await screen.findByRole('button', { name: 'Make an export' })
    await user.click(control)
    const first = await screen.findByRole('alert')
    expect(first).toHaveTextContent('Too many attempts. Try again in a little while.')
    server.on(`POST ${exports}`, () => problem(500, 'internal'))
    await user.click(control)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/^Something went wrong at our end\./)
    })
    // A banner of its own, and not the first one's words changed where they stood.
    expect(screen.getByRole('alert')).not.toBe(first)
  })

  it('tells an owner made a member meanwhile that they are one no longer, and takes the control away', async () => {
    const server = serving([ready()])
    server.on(`POST ${exports}`, () => {
      server.household = readBy({ ...memberOf(jana.id), role: 'member' })
      server.on(`GET ${exports}`, () => Response.json({ items: [ready({ download_url: null })] }))
      return problem(403, 'forbidden')
    })
    const { user } = await screenOf(server)
    await user.click(await screen.findByRole('button', { name: 'Make an export' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an owner can change this, and you are not one any more. Nothing was changed.',
    )
    // The household is read again, and what it then says is drawn: no control, and whose it is.
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: 'Your data' })).toBeInTheDocument()
    // The focus the control held is not dropped to the page.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(await list())
  })

  it('is asked at once with no connection, says the server was not reached, and is sent by nothing later', async () => {
    const server = serving()
    server.on(`POST ${exports}`, () => Promise.reject(new TypeError('offline')))
    const { user } = await screenOf(server)
    const control = await screen.findByRole('button', { name: 'Make an export' })
    onlineManager.setOnline(false)
    await user.click(control)
    expect(await screen.findByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
    // Not held for a connection behind a busy control: it is asked, and answered.
    expect(control).not.toHaveAttribute('aria-busy')
    act(() => {
      onlineManager.setOnline(true)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(server.to(`POST ${exports}`)).toHaveLength(1)
  })
})

describe('an export on its way', () => {
  /** The interval is a clock's: the test moves it, and nothing else the page waits on. */
  function holdTheClock() {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  }

  function pass(milliseconds: number) {
    act(() => {
      vi.advanceTimersByTime(milliseconds)
    })
  }

  it('is asked after again until it has ended, and what it came to is said', async () => {
    holdTheClock()
    const server = serving([job()])
    await screenOf(server)
    expect(within(await rowOf()).getByText('Waiting to be made')).toBeInTheDocument()
    expect(server.to(`GET ${exports}`)).toHaveLength(1)

    server.on(`GET ${exports}`, () => Response.json({ items: [job({ status: 'running' })] }))
    pass(askAgainEvery)
    expect(await within(await rowOf()).findByText('Being made')).toBeInTheDocument()
    // Nothing arrived that a member is told of: it is still on its way.
    expect(screen.queryByText('The export is ready to download.')).not.toBeInTheDocument()

    server.on(`GET ${exports}`, () => Response.json({ items: [ready()] }))
    pass(askAgainEvery)
    // It arrived with nobody pressing anything: said, and not only drawn.
    expect(await screen.findByText('The export is ready to download.')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: download })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make an export' })).toBeInTheDocument()

    // It has ended: nothing is asked after any more.
    const asked = server.to(`GET ${exports}`).length
    pass(askAgainEvery * 3)
    expect(server.to(`GET ${exports}`)).toHaveLength(asked)
  })

  it('says of one that failed that it did, and that nothing partial was kept', async () => {
    holdTheClock()
    const server = serving([job({ status: 'running' })])
    await screenOf(server)
    await rowOf()
    server.on(`GET ${exports}`, () => Response.json({ items: [job({ status: 'failed' })] }))
    pass(askAgainEvery)
    expect(
      await screen.findByText('The export failed. Nothing partial was kept.'),
    ).toBeInTheDocument()
    expect(within(await rowOf()).getByText('Failed')).toBeInTheDocument()
  })

  it('is not asked after while the page is hidden', async () => {
    holdTheClock()
    const server = serving([job()])
    await screenOf(server)
    await rowOf()
    act(() => {
      focusManager.setFocused(false)
    })
    pass(askAgainEvery * 3)
    expect(server.to(`GET ${exports}`)).toHaveLength(1)
  })

  // A requester made a member since is handed no link: their row says so, and nothing says the
  // export is ready to download.
  it('does not say an export is ready to download to somebody who is handed no link to it', async () => {
    holdTheClock()
    const server = serving([job({ status: 'running' })])
    await screenOf(server)
    await rowOf()
    // An owner is handed a link: she is made a member while the export is on its way.
    server.household = readBy({ ...memberOf(jana.id), role: 'member' })
    server.on(`GET ${exports}`, () => Response.json({ items: [ready({ download_url: null })] }))
    pass(askAgainEvery)
    expect(await within(await rowOf()).findByText('Ready')).toBeInTheDocument()
    expect(screen.queryByText('The export is ready to download.')).not.toBeInTheDocument()
  })

  // Taken out of the household while an export was on its way, the list is its reader's no
  // longer: what this browser kept of it does not have it asked for every few seconds.
  it('is asked after no more once the list is answered as not its reader’s', async () => {
    holdTheClock()
    const server = serving([job({ status: 'running' })])
    await screenOf(server)
    await rowOf()
    server.on(`GET ${exports}`, () => problem(404, 'not_found'))
    // The refusal draws nothing anew, and the clock is held: its answer is waited for by hand.
    const settle = () => act(() => vi.advanceTimersByTimeAsync(askAgainEvery - 1))
    pass(1)
    await settle()
    const asked = server.to(`GET ${exports}`).length
    expect(asked).toBeGreaterThan(1)
    for (let turn = 0; turn < 4; turn += 1) await settle()
    expect(server.to(`GET ${exports}`)).toHaveLength(asked)
  })

  it('says nothing of an export that had ended before the screen opened', async () => {
    await screenOf(serving([ready()]))
    await rowOf()
    expect(screen.queryByText('The export is ready to download.')).not.toBeInTheDocument()
  })
})

describe('downloading an export', () => {
  it('reads the job again, and hands the browser the link it then carries', async () => {
    const renewed = `${archive}&renewed=1`
    const server = serving([ready()])
    server.on(`GET ${one}`, () => Response.json(ready({ download_url: renewed })))
    const { user } = await screenOf(server)
    await user.click(await screen.findByRole('button', { name: download }))

    await waitFor(() => {
      expect(leaveFor).toHaveBeenCalledTimes(1)
    })
    // The link read at the press, and not one a list kept: that one is good for minutes.
    expect(leaveFor).toHaveBeenCalledWith(renewed)
    expect(server.to(`GET ${one}`)).toHaveLength(1)
    expect(await screen.findByText('Your browser is downloading the export.')).toBeInTheDocument()
    // The page asked the object store for nothing: the browser does, by the link.
    expect(
      server.sent.every((request) => new URL(request.url).host !== new URL(archive).host),
    ).toBe(true)
    expect(screen.getByRole('button', { name: download })).not.toHaveAttribute('aria-busy')
  })

  it('keeps no link in the list it reads', () => {
    expect(listed(ready())).not.toHaveProperty('download_url')
    expect(listed(ready()).linked).toBe(true)
    expect(listed(ready({ download_url: null })).linked).toBe(false)
  })

  // Made a member between the list's read and the press: the server hands them no link.
  it('says an export is no longer its requester’s to download where the job carries no link', async () => {
    const server = serving([ready()])
    server.on(`GET ${one}`, () => {
      // As the server then stands: she is a member, and her list hands her no link either.
      server.household = readBy({ ...memberOf(jana.id), role: 'member' })
      server.on(`GET ${exports}`, () => Response.json({ items: [ready({ download_url: null })] }))
      return Response.json(ready({ download_url: null }))
    })
    const { user } = await screenOf(server)
    await user.click(await screen.findByRole('button', { name: download }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an owner downloads an export of the household, and you are not one any more.',
    )
    expect(leaveFor).not.toHaveBeenCalled()
    // Its row is drawn as the job now reads: nothing to press.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: download })).not.toBeInTheDocument()
    })
    // The control that was pressed is gone: the focus is on the list's own place.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(await list())
    // A job that is ready and carries no link is the server's word that she owns the household
    // no longer: it is read again, and the control that asks leaves for whose it is.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Make an export' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: 'Your data' })).toBeInTheDocument()
    expect(document.activeElement).not.toBe(document.body)
  })

  it('says one that has expired since can no longer be downloaded', async () => {
    const server = serving([ready()])
    server.on(`GET ${one}`, () => Response.json(ready({ status: 'expired', download_url: null })))
    const { user } = await screenOf(server)
    await user.click(await screen.findByRole('button', { name: download }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That export can no longer be downloaded. The list shows how it stands.',
    )
    expect(leaveFor).not.toHaveBeenCalled()
    expect(await within(await rowOf()).findByText('Expired')).toBeInTheDocument()
  })

  it('says one that is no longer kept is gone, and reads the list again', async () => {
    const server = serving([ready()])
    server.on(`GET ${one}`, () => {
      server.on(`GET ${exports}`, () => Response.json({ items: [] }))
      return problem(404, 'not_found')
    })
    const { user } = await screenOf(server)
    await user.click(await screen.findByRole('button', { name: download }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That export can no longer be downloaded. The list shows how it stands.',
    )
    expect(leaveFor).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByText(/^Asked for on/)).not.toBeInTheDocument()
    })
    // Its row left the list with the control that was pressed, and the focus is not dropped.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(
      screen.getByRole('button', { name: 'Make an export' }),
    )
  })

  it('is asked at once with no connection, and says the server was not reached', async () => {
    const server = serving([ready()])
    server.on(`GET ${one}`, () => Promise.reject(new TypeError('offline')))
    const { user } = await screenOf(server)
    const control = await screen.findByRole('button', { name: download })
    onlineManager.setOnline(false)
    await user.click(control)
    expect(await screen.findByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
    expect(control).not.toHaveAttribute('aria-busy')
    expect(leaveFor).not.toHaveBeenCalled()
    act(() => {
      onlineManager.setOnline(true)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(server.to(`GET ${one}`)).toHaveLength(1)
  })

  // Two archives, each good for seven days: one press at a time, and each row says which.
  it('takes no press on another row while one row’s download is asked for', async () => {
    const other = '2026-09-08T17:02:00Z'
    const server = serving([ready(), ready({ id: exportId(2), requested_at: other })])
    let answer: (response: Response) => void = () => undefined
    server.on(
      `GET ${one}`,
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    )
    const { user } = await screenOf(server)
    const first = await screen.findByRole('button', { name: download })
    const second = screen.getByRole('button', {
      name: 'Download the export asked for on Sep 8, 2026, 7:02 PM',
    })
    await user.click(first)
    await waitFor(() => {
      expect(first).toHaveAttribute('aria-busy', 'true')
    })
    expect(second).toHaveAttribute('aria-disabled', 'true')
    expect(second).not.toHaveAttribute('aria-busy')
    await user.click(second)
    expect(server.to(`GET ${exports}/${exportId(2)}`)).toHaveLength(0)
    answer(Response.json(ready()))
    await waitFor(() => {
      expect(second).not.toHaveAttribute('aria-disabled')
    })
  })
})

describe('what a list of exports is read by', () => {
  it('reads a job that names no state as only asked for', () => {
    expect(statusOf({})).toBe('queued')
    expect(underWay({})).toBe(true)
    expect(underWay({ status: 'running' })).toBe(true)
    expect(underWay({ status: 'ready' })).toBe(false)
    expect(underWay({ status: 'failed' })).toBe(false)
    expect(underWay({ status: 'expired' })).toBe(false)
  })

  it('knows the archive’s own entries, a module’s data and the readable versions by name', () => {
    expect(entryOf('manifest.json')).toEqual({ kind: 'manifest' })
    expect(entryOf('account.json')).toEqual({ kind: 'account' })
    expect(entryOf('households/')).toEqual({ kind: 'households' })
    expect(entryOf('shopping.json')).toEqual({ kind: 'module', module: 'shopping' })
    expect(entryOf('finance-transactions.csv')).toEqual({ kind: 'spreadsheet' })
    expect(entryOf('finance-accounts.csv')).toEqual({ kind: 'spreadsheet' })
    expect(entryOf('utilities-readings.csv')).toEqual({ kind: 'spreadsheet' })
    expect(entryOf('notes/')).toEqual({ kind: 'notes' })
    expect(entryOf('chat.html')).toEqual({ kind: 'chat' })
    // A name that only looks like a module's is none.
    expect(entryOf('budget.json')).toBeUndefined()
    expect(entryOf('files')).toBeUndefined()
  })
})
