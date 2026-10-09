// Sync health (A-32): what each of the reader's own replicas says, which of them is this
// browser and what only it can say, the report it sends as the screen opens, what asking a
// replica to download itself again sends and says afterwards, and what the screen draws where
// the list or the replica cannot be read.
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inHousehold } from '../app/paths.ts'
import type { Report } from './data.ts'
import {
  accountOf,
  chromeOnWindows,
  createServer,
  firefoxOnLinux,
  here,
  home,
  klara,
  laptop,
  noContent,
  open,
  outcome,
  phone,
  phoneDevice,
  problem,
  readOnly,
  report,
  routes,
  standIn,
  syncOver,
  syncWithout,
  type HouseholdServer,
  type OpenOptions,
} from './testing.tsx'

// The browser every test is in says what a browser says of itself, which jsdom does not: it is
// what this browser's own row is named from until the server lists what it reported.
beforeEach(() => {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(chromeOnWindows)
})

// A test that says the page is looked at again leaves the next one a page nobody has looked at,
// and one that takes the connection away leaves the next one a browser that has it.
afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

const at = inHousehold.syncHealth(home)
const other = report({
  replica_id: laptop,
  label: firefoxOnLinux,
  checkpoint: '184388',
  last_report_at: '2026-09-08T14:12:00Z',
})

/** A server that lists `reports`, and goes on listing whatever a test puts in their place. */
function listing(reports: Report[], server: HouseholdServer = createServer()) {
  const listed = { reports }
  server.on(`GET ${routes.state}`, () => Response.json({ replicas: listed.reports }))
  return Object.assign(server, { listed })
}

async function health(server: HouseholdServer = listing([report()]), options?: OpenOptions) {
  const opened = open(at, server, options)
  await screen.findByRole('heading', { level: 1 })
  return opened
}

const list = () => screen.findByRole('list', { name: 'Your browsers and devices' })

/** The row named `name`. */
async function rowOf(name: string): Promise<HTMLElement> {
  const row = (await within(await list()).findByText(name)).closest('li')
  if (row === null) throw new Error(`${name} is on no row`)
  return row
}

describe('sync health', () => {
  it('is titled for what it shows, and says what it is', async () => {
    await health()
    expect(screen.getByRole('heading', { level: 1, name: 'Sync health' })).toBeInTheDocument()
    await waitFor(() => {
      expect(document.title).toBe('Sync health · Household')
    })
    expect(
      screen.getByText(
        'Your browsers and devices that keep a copy of this household, and how each one stands.',
      ),
    ).toBeInTheDocument()
  })

  it('lists the reader’s own replicas, this browser’s first and marked', async () => {
    // The server lists the one that reported last first: this browser's is put before it.
    await health(listing([other, report()]))
    const rows = [...(await list()).children] as HTMLElement[]
    expect(rows).toHaveLength(2)
    const [mine, laptopRow] = rows as [HTMLElement, HTMLElement]
    expect(within(mine).getByText('Chrome on Windows')).toBeInTheDocument()
    expect(within(mine).getByText('This browser')).toBeInTheDocument()
    expect(within(mine).getByText('In sync')).toBeInTheDocument()
    // In the household's zone, whatever this device's is: 16:41 in UTC is 18:41 in Prague.
    expect(
      within(mine).getByText(/^Last reported Sep 8, 2026, 6:41\sPM\. Last checkpoint: 184402\.$/),
    ).toBeInTheDocument()
    expect(within(laptopRow).getByText('Firefox on Linux')).toBeInTheDocument()
    expect(within(laptopRow).queryByText('This browser')).not.toBeInTheDocument()
    expect(
      within(laptopRow).getByText(
        /^Last reported Sep 8, 2026, 4:12\sPM\. Last checkpoint: 184388\.$/,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'This browser is shown as it is now. Every other row is as that browser or device last reported to the server, and says when.',
      ),
    ).toBeInTheDocument()
    // A header anyone may write is drawn nowhere as it was sent.
    expect(document.body).not.toHaveTextContent('Mozilla')
  })

  it('says what another replica had waiting when it last reported, and offers no way to its inbox', async () => {
    await health(listing([report(), { ...other, pending_mutations: 2, unresolved_conflicts: 1 }]))
    const row = await rowOf('Firefox on Linux')
    // What waits for the member is said before what waits to be sent.
    expect(within(row).getByText('Needs your attention')).toBeInTheDocument()
    expect(within(row).getByText('2 changes were waiting to be sent from it.')).toBeInTheDocument()
    expect(
      within(row).getByText(
        '1 change was waiting for your attention there. Open Household on it to answer it.',
      ),
    ).toBeInTheDocument()
    // Its inbox is its own: no link from here leads to it.
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
  })

  it('says a replica with changes waiting and nothing else is waiting to send them', async () => {
    await health(listing([report(), { ...other, pending_mutations: 1 }]))
    const row = await rowOf('Firefox on Linux')
    expect(within(row).getByText('Changes waiting to be sent')).toBeInTheDocument()
    expect(within(row).getByText('1 change was waiting to be sent from it.')).toBeInTheDocument()
  })

  it('draws this browser’s figures as they are now, with the way to what waits for the member', async () => {
    // The report said nothing was waiting: the replica says what is so now.
    const stand = standIn({ queued: 2, held: 1, inbox: [outcome()] })
    await health(listing([report()]), { sync: syncOver(stand) })
    const row = await rowOf('Chrome on Windows')
    expect(await within(row).findByText('Needs your attention')).toBeInTheDocument()
    expect(
      within(row).getByText('3 changes are waiting to be sent from this browser.'),
    ).toBeInTheDocument()
    expect(
      within(row).getByRole('link', { name: '1 change needs your attention' }),
    ).toHaveAttribute('href', inHousehold.sync(home))
  })

  it('reads what waits in this browser again when its replica’s status moves', async () => {
    const stand = standIn()
    await health(listing([report()]), { sync: syncOver(stand) })
    const row = await rowOf('Chrome on Windows')
    expect(within(row).getByText('In sync')).toBeInTheDocument()
    act(() => {
      stand.move({ queued: 1 })
    })
    expect(
      await within(row).findByText('1 change is waiting to be sent from this browser.'),
    ).toBeInTheDocument()
    expect(within(row).getByText('Changes waiting to be sent')).toBeInTheDocument()
  })

  it('says this browser is not receiving changes, where its replica says so', async () => {
    await health(listing([report()]), { sync: syncOver(standIn(), { receiving: false }) })
    const row = await rowOf('Chrome on Windows')
    expect(within(row).getByText('Not receiving changes')).toBeInTheDocument()
    expect(
      within(row).getByText(
        'Other members’ changes aren’t arriving right now. What you change is still saved and sent.',
      ),
    ).toBeInTheDocument()
  })

  it('names a device by its label with its kind beside it, and by its kind where it named nothing', async () => {
    const server = listing([
      report(),
      report({ replica_id: phone, device_id: phoneDevice, label: 'Janin telefon' }),
      report({ replica_id: laptop, device_id: '0190a000-0000-7000-8000-0000000000e4', label: '' }),
    ])
    server.on(`GET ${routes.devices}`, () =>
      Response.json({
        items: [
          { id: phoneDevice, label: 'Janin telefon', platform: 'ios' },
          { id: '0190a000-0000-7000-8000-0000000000e4', label: '', platform: 'android' },
        ],
      }),
    )
    await health(server)
    const labelled = await rowOf('Janin telefon')
    expect(await within(labelled).findByText('iPhone or iPad')).toBeInTheDocument()
    expect(await rowOf('Android phone or tablet')).toBeInTheDocument()
  })

  it('names a device by what its report says where the account’s devices cannot be read', async () => {
    // Nothing answers the list of devices: its label is all there is, and is enough.
    await health(
      listing([
        report(),
        report({ replica_id: phone, device_id: phoneDevice, label: 'Janin telefon' }),
        report({
          replica_id: laptop,
          device_id: '0190a000-0000-7000-8000-0000000000e4',
          label: '',
        }),
      ]),
    )
    expect(await rowOf('Janin telefon')).toBeInTheDocument()
    expect(await rowOf('Phone or tablet')).toBeInTheDocument()
  })

  it('asks for the account’s devices only where a replica names one', async () => {
    const server = listing([report(), other])
    await health(server)
    await rowOf('Firefox on Linux')
    expect(server.to(`GET ${routes.devices}`)).toHaveLength(0)
  })

  it('counts what did not match and what failed its check, and names no kind of thing', async () => {
    await health(
      listing([
        report(),
        {
          ...other,
          checksum_failures: 1,
          digest_mismatch_entity_types: ['shopping.item', 'utilities.reading'],
        },
      ]),
    )
    const row = await rowOf('Firefox on Linux')
    expect(within(row).getByText('Doesn’t match the server')).toBeInTheDocument()
    expect(
      within(row).getByText(
        '2 kinds of things in its copy didn’t match the server at its last report. Downloading it again puts that right.',
      ),
    ).toBeInTheDocument()
    expect(
      within(row).getByText(
        '1 part of what it downloaded failed its check since the report before, and was downloaded again by itself.',
      ),
    ).toBeInTheDocument()
    // What it means, and what puts it right.
    expect(
      screen.getByText(
        'A copy that doesn’t match holds something other than what the server holds. Downloading it again replaces it with the server’s, once everything waiting on it has been sent.',
      ),
    ).toBeInTheDocument()
    // The contract's own words for none of it are drawn.
    expect(document.body).not.toHaveTextContent(
      /shopping\.item|utilities\.reading|resnapshot|digest|\bseq\b|replica/i,
    )
  })

  it('is every member’s, whatever they hold on household settings', async () => {
    await health(listing([report()], createServer(accountOf(klara))))
    expect(await rowOf('Chrome on Windows')).toBeInTheDocument()
    expect(
      within(await rowOf('Chrome on Windows')).getByRole('button', {
        name: 'Download again on Chrome on Windows',
      }),
    ).toBeInTheDocument()
  })

  it('leads to the diagnostic bundle, and says which screen it came from', async () => {
    const { user, router } = await health()
    await user.click(screen.getByRole('link', { name: 'Send diagnostics' }))
    expect(router.state.location.pathname).toBe(inHousehold.diagnostics(home))
    expect(router.state.location.state).toEqual({ from: at })
  })
})

describe('the report this browser sends as the screen opens', () => {
  it('is sent once, and the list is read again when the server has answered it', async () => {
    const server = listing([])
    const stand = standIn({
      onReport: () => {
        server.listed.reports = [report()]
        return { matched: true, resnapshot_required: false, entries: [] }
      },
    })
    await health(server, { sync: syncOver(stand) })
    const row = await rowOf('Chrome on Windows')
    expect(await within(row).findByText(/^Last reported /)).toBeInTheDocument()
    expect(stand.reports()).toBe(1)
    // Its status moving again sends no second one.
    act(() => {
      stand.move({ queued: 0 })
    })
    expect(stand.reports()).toBe(1)
  })

  // Two reports of a replica that has not caught up, a minute apart, read as divergence.
  it('waits for a replica that is still catching up, and is sent once it has', async () => {
    const stand = standIn({ caughtUp: false })
    await health(listing([]), { sync: syncOver(stand) })
    await rowOf('Chrome on Windows')
    expect(stand.reports()).toBe(0)
    act(() => {
      stand.move({ caughtUp: true })
    })
    expect(stand.reports()).toBe(1)
  })

  it('leaves this browser’s row saying it has not reported where the server took none', async () => {
    const stand = standIn({ queued: 1 })
    const server = listing([])
    await health(server, { sync: syncOver(stand) })
    const row = await rowOf('Chrome on Windows')
    expect(
      within(row).getByText(
        'It hasn’t reported to the server yet. A browser reports once it has caught up and has nothing waiting to be sent.',
      ),
    ).toBeInTheDocument()
    // Nothing the server lists is there to mark: no download is offered for it.
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
    expect(server.to(`GET ${routes.state}`)).toHaveLength(1)
  })

  it('is not sent from a household that takes no writes, which takes no report', async () => {
    const server = listing([report()])
    server.household = readOnly
    const stand = standIn()
    await health(server, { sync: syncOver(stand) })
    await rowOf('Chrome on Windows')
    expect(stand.reports()).toBe(0)
  })

  it('says nothing where it got no answer', async () => {
    const stand = standIn({
      onReport: () => {
        throw new TypeError('offline')
      },
    })
    await health(listing([report()]), { sync: syncOver(stand) })
    expect(await rowOf('Chrome on Windows')).toBeInTheDocument()
    expect(stand.reports()).toBe(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('downloading a replica again', () => {
  async function asked(server: HouseholdServer = listing([report(), other])) {
    const opened = await health(server)
    const row = await rowOf('Firefox on Linux')
    await opened.user.click(
      within(row).getByRole('button', { name: 'Download again on Firefox on Linux' }),
    )
    const dialog = screen.getByRole('dialog', {
      name: 'Download the household again on Firefox on Linux?',
    })
    return { ...opened, dialog, row }
  }
  const confirm = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: 'Download again on Firefox on Linux' })

  it('draws the control as one word, which its name holds', async () => {
    await health(listing([report(), other]))
    const control = within(await rowOf('Firefox on Linux')).getByRole('button')
    expect(control).toHaveAccessibleName('Download again on Firefox on Linux')
    expect(control).toHaveTextContent('Download again')
  })

  it('asks first, saying that nothing waiting is lost and when it happens', async () => {
    const { dialog, server } = await asked()
    expect(dialog).toHaveAccessibleDescription(
      'It first sends everything it has waiting, so nothing is lost. Then it clears its copy of the household and downloads all of it again. It starts after it next reports to the server, which it does by itself while Household is open on it and connected.',
    )
    // The safe choice first, then the one that names what it downloads again.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Leave it as it is', 'Download again on Firefox on Linux'])
    expect(server.to(`POST ${routes.reset}`)).toHaveLength(0)
  })

  it('says of this browser that it is this browser that sends and downloads', async () => {
    const { user } = await health(listing([report()]))
    await user.click(
      within(await rowOf('Chrome on Windows')).getByRole('button', {
        name: 'Download again on Chrome on Windows',
      }),
    )
    expect(
      screen.getByRole('dialog', { name: 'Download the household again on Chrome on Windows?' }),
    ).toHaveAccessibleDescription(
      'This browser first sends everything it has waiting, so nothing is lost. Then it clears its copy of the household and downloads all of it again. It starts after this browser next reports to the server, which it does by itself while Household is open here and connected.',
    )
  })

  it('asks nothing of the server when it is left as it is', async () => {
    const { user, dialog, server } = await asked()
    await user.click(within(dialog).getByRole('button', { name: 'Leave it as it is' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.to(`POST ${routes.reset}`)).toHaveLength(0)
  })

  it('marks the replica, says so, and reads the list again, with the focus on the list’s place', async () => {
    const server = listing([report(), other])
    server.on(`POST ${routes.reset}`, () => {
      server.listed.reports = [report(), { ...other, needs_resnapshot: true }]
      return noContent()
    })
    const { user, dialog } = await asked(server)
    await user.click(confirm(dialog))

    expect(
      await screen.findByText(
        'Firefox on Linux downloads the household again after its next report. Nothing waiting on it is lost.',
      ),
    ).toBeInTheDocument()
    expect(await server.body(`POST ${routes.reset}`)).toEqual({ replica_id: laptop })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The row says it until the report after the one that told it, and offers nothing more.
    const row = await rowOf('Firefox on Linux')
    expect(await within(row).findByText('Downloading again')).toBeInTheDocument()
    expect(
      within(row).getByText(
        'It downloads the household again after its next report, once it has sent everything it has waiting. This row says so until the report after that.',
      ),
    ).toBeInTheDocument()
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
    // The control the question was opened from is gone, and the focus the question gave back
    // with it: it is on the list's own place, and not dropped to the page.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(await list())
    expect(document.activeElement).not.toBe(await list())
  })

  it('says a replica that is listed no longer is gone, and reads the list again', async () => {
    const server = listing([report(), other])
    server.on(`POST ${routes.reset}`, () => {
      server.listed.reports = [report()]
      return problem(404, 'not_found')
    })
    const { user, dialog } = await asked(server)
    await user.click(confirm(dialog))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Firefox on Linux is no longer listed, so there was nothing to download again. The list shows how things stand now.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Firefox on Linux')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(await list())
  })

  it('says the household takes no writes now, and takes the controls away', async () => {
    const server = listing([report(), other])
    server.on(`POST ${routes.reset}`, () => {
      server.household = readOnly
      return problem(402, 'entitlement_read_only', { state: 'read_only', remedy: 'subscribe' })
    })
    const { user, dialog } = await asked(server)
    await user.click(confirm(dialog))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The household is read-only now, so nothing was changed.',
    )
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Download again/ })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(await list())
  })

  it('says a refusal for now in the question, which stays open', async () => {
    const server = listing([report(), other])
    server.on(`POST ${routes.reset}`, () =>
      problem(429, 'rate_limited', {}, { 'Retry-After': '120' }),
    )
    const { user, dialog } = await asked(server)
    await user.click(confirm(dialog))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^Too many attempts\. Try again at \d/,
    )
    expect(confirm(dialog)).not.toHaveAttribute('aria-busy')
  })

  it('is asked at once with no connection, says so, and is sent by nothing when one returns', async () => {
    const server = listing([report(), other])
    server.on(`POST ${routes.reset}`, () => Promise.reject(new TypeError('offline')))
    const { user, dialog } = await asked(server)
    onlineManager.setOnline(false)
    try {
      await user.click(confirm(dialog))
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        /^We couldn’t reach Household\./,
      )
    } finally {
      onlineManager.setOnline(true)
    }
    expect(server.to(`POST ${routes.reset}`)).toHaveLength(1)
  })

  it('keeps its control busy while the write is on its way', async () => {
    const server = listing([report(), other])
    let answer: (response: Response) => void = () => undefined
    server.on(
      `POST ${routes.reset}`,
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    )
    const { user, dialog } = await asked(server)
    await user.click(confirm(dialog))
    await waitFor(() => {
      expect(confirm(dialog)).toHaveAttribute('aria-busy', 'true')
    })
    await user.click(confirm(dialog))
    await user.click(within(dialog).getByRole('button', { name: 'Leave it as it is' }))
    // Neither a second press nor the safe choice does anything while it is asked.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(server.to(`POST ${routes.reset}`)).toHaveLength(1)
    act(() => {
      answer(noContent())
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})

describe('sync health, where something cannot be read or changed', () => {
  it('draws the list’s shape while it is read', async () => {
    const server = createServer()
    server.on(`GET ${routes.state}`, () => new Promise<Response>(() => undefined))
    await health(server)
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('draws the list’s shape while this tab’s replica is being opened', async () => {
    await health(listing([report()]), { sync: syncWithout('opening') })
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(
      screen.queryByRole('list', { name: 'Your browsers and devices' }),
    ).not.toBeInTheDocument()
  })

  it('draws this browser as it is now where the server’s list cannot be read, and says so', async () => {
    const server = createServer()
    server.on(`GET ${routes.state}`, () => Promise.reject(new TypeError('offline')))
    const stand = standIn({ queued: 2 })
    const { user } = await health(server, { sync: syncOver(stand) })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The rest could not be read')
    expect(alert).toHaveTextContent(
      'The server couldn’t be asked what your browsers and devices last reported. This browser is shown as it is now, and nothing on any of them was changed.',
    )
    const row = await rowOf('Chrome on Windows')
    expect(
      await within(row).findByText('2 changes are waiting to be sent from this browser.'),
    ).toBeInTheDocument()
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
    // Read again, the rest is there.
    listing([report(), other], server)
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await rowOf('Firefox on Linux')).toBeInTheDocument()
    expect(screen.queryByText('The rest could not be read')).not.toBeInTheDocument()
  })

  it('says the list could not be read in a tab with no replica to speak for itself, and reads it again', async () => {
    const server = createServer()
    server.on(`GET ${routes.state}`, () => Promise.reject(new TypeError('offline')))
    const { user } = await health(server, { sync: syncWithout('elsewhere') })
    expect(
      await screen.findByText('Your browsers and devices could not be read'),
    ).toBeInTheDocument()
    expect(screen.getByText('Nothing on any of them was changed.')).toBeInTheDocument()
    listing([other], server)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await rowOf('Firefox on Linux')).toBeInTheDocument()
  })

  // A read that waits for a connection is no read under way: nothing is kept, and it is said.
  it('says a list it cannot ask for could not be read, and draws no skeleton', async () => {
    const server = listing([report()])
    // The connection goes once the household has been read, and before its replicas are.
    let gone = false
    server.on(`GET /households/${home}`, () => {
      if (!gone) onlineManager.setOnline(false)
      gone = true
      return Response.json(server.household)
    })
    await health(server, { sync: syncWithout('unavailable') })
    expect(
      await screen.findByText('Your browsers and devices could not be read'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    expect(server.to(`GET ${routes.state}`)).toHaveLength(0)
  })

  it('is drawn as this browser kept it when the connection goes, its own row saying it is offline', async () => {
    await health(listing([report(), other]))
    await rowOf('Firefox on Linux')
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    const row = await rowOf('Chrome on Windows')
    expect(await within(row).findByText('Offline')).toBeInTheDocument()
    expect(
      within(row).getByText(
        'This browser has no connection, so nothing arrives and nothing is sent until it is back.',
      ),
    ).toBeInTheDocument()
    expect(await rowOf('Firefox on Linux')).toBeInTheDocument()
    expect(
      screen.queryByText('Your browsers and devices could not be read'),
    ).not.toBeInTheDocument()
  })

  it('says another tab keeps the household’s copy, and marks no row as this browser', async () => {
    await health(listing([report(), other]), { sync: syncWithout('elsewhere') })
    const said = screen.getByText('Another tab keeps this household’s copy')
    expect(
      screen.getByText(
        'Only one tab of a browser keeps a household’s copy at a time, and another tab of this one has it. So this tab can’t say which row is this browser, or what it has waiting right now. Use that tab, or close it and this one takes over.',
      ),
    ).toBeInTheDocument()
    // It was so when the screen opened: read in its place, and not said as an arrival.
    expect(said.closest('[role="status"]')).toBeNull()
    expect((await list()).children).toHaveLength(2)
    expect(screen.queryByText('This browser')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Each row is as that browser or device last reported to the server, and says when.',
      ),
    ).toBeInTheDocument()
  })

  it('announces that another tab took the copy while its member was here', async () => {
    const stand = standIn()
    const { sync } = await health(listing([report()]), { sync: syncOver(stand) })
    await rowOf('Chrome on Windows')
    act(() => {
      sync.set({ replica: { phase: 'elsewhere' }, receiving: null })
    })
    const said = await screen.findByText('Another tab keeps this household’s copy')
    expect(said.closest('[role="status"]')).not.toBeNull()
    expect(screen.queryByText('This browser')).not.toBeInTheDocument()
  })

  it('says this browser keeps no copy where it could open none', async () => {
    await health(listing([other]), { sync: syncWithout('unavailable') })
    expect(screen.getByText('This browser keeps no copy of this household')).toBeInTheDocument()
    expect(await rowOf('Firefox on Linux')).toBeInTheDocument()
  })

  it('says so as well where the replica cannot say which is its own', async () => {
    await health(listing([report()]), { sync: syncOver(standIn({ broken: true })) })
    expect(
      await screen.findByText('This browser keeps no copy of this household'),
    ).toBeInTheDocument()
    expect(screen.queryByText('This browser')).not.toBeInTheDocument()
  })

  it('teaches what will be here where nothing has reported and this tab holds no replica', async () => {
    const server = listing([])
    const { user } = await health(server, { sync: syncWithout('elsewhere') })
    expect(
      await screen.findByText('No browser or device of yours has reported on this household yet.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Example')).toBeInTheDocument()
    server.listed.reports = [other]
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await rowOf('Firefox on Linux')).toBeInTheDocument()
  })

  it('draws no control in a household that takes no writes, and says each row is as it last reported', async () => {
    const server = listing([report(), { ...other, digest_mismatch_entity_types: ['notes.note'] }])
    server.household = readOnly
    await health(server)
    expect(await rowOf('Firefox on Linux')).toBeInTheDocument()
    expect(await screen.findByText('Read-only')).toBeInTheDocument()
    expect(
      screen.getByText(
        'This household can’t be changed right now, and while that is so no browser or device reports on it. Each row is as it last reported, and nothing can be downloaded again until the household can be changed.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Download again/ })).not.toBeInTheDocument()
    // The way to the bundle is no write of the household's, and stays.
    expect(screen.getByRole('link', { name: 'Send diagnostics' })).toBeInTheDocument()
  })

  it('names a browser by what its header tells, and as a browser where it tells nothing', async () => {
    await health(
      listing([
        report(),
        report({ replica_id: laptop, label: 'curl/8.4.0' }),
        report({ replica_id: phone, label: chromeOnWindows }),
      ]),
    )
    expect(await rowOf('A browser')).toBeInTheDocument()
    // The same browser signed in again is listed again: only one of the two is this one.
    expect(within(await list()).getAllByText('Chrome on Windows')).toHaveLength(2)
    expect(screen.getAllByText('This browser')).toHaveLength(1)
    expect(here).not.toBe(phone)
  })
})
