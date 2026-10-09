// The diagnostic bundle (A-33): what it draws before anything leaves, that what is drawn is
// what is sent, what leaving a part out takes out of the request, what the send asks of the
// server and says afterwards, and each way the server can refuse it.
import { focusManager, onlineManager } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clientName } from '../api/client.ts'
import { inHousehold } from '../app/paths.ts'
import type { BundleBody } from './bundle.ts'
import type { Report } from './data.ts'
import {
  accountOf,
  chromeOnWindows,
  createServer,
  here,
  home,
  invalid,
  jana,
  klara,
  laptop,
  open,
  outcome,
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

beforeEach(() => {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(chromeOnWindows)
})

afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

const at = inHousehold.diagnostics(home)
const send = `POST ${routes.diagnostics}`
const kept = '0190a000-0000-7000-8000-0000000000b1'

/** A server that lists `reports` and keeps a bundle it is sent, answering as the contract does. */
function taking(reports: Report[] = [report()], server: HouseholdServer = createServer()) {
  server.on(`GET ${routes.state}`, () => Response.json({ replicas: reports }))
  server.on(send, async (request) => {
    const body = (await request.clone().json()) as BundleBody
    return Response.json(
      { id: body.id ?? kept, expires_at: '2026-10-08T17:00:00Z' },
      { status: 201 },
    )
  })
  return server
}

/** A replica with something waiting and one answer kept, which holds what a member wrote. */
const busy = () => syncOver(standIn({ queued: 2, held: 1, outcomes: [outcome()] }))

async function bundle(server: HouseholdServer = taking(), options: OpenOptions = {}) {
  const opened = open(at, server, { sync: busy(), ...options })
  await screen.findByRole('heading', { level: 1 })
  return opened
}

const sendButton = () => screen.findByRole('button', { name: 'Send diagnostics' })

/** The part whose box is named `name`, as its row. */
async function partOf(name: string): Promise<HTMLElement> {
  const row = (await screen.findByRole('checkbox', { name })).closest('li')
  if (row === null) throw new Error(`${name} is on no row`)
  return row
}

/** What a block of pairs says, by its labels. */
function pairsIn(container: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    [...container.querySelectorAll('dt')].map((label) => [
      label.textContent,
      label.nextElementSibling?.textContent ?? '',
    ]),
  )
}

/** The request as the screen draws it. */
async function drawn(): Promise<BundleBody> {
  const text = (await screen.findByText(/^\{\s+"id"/)).textContent
  return JSON.parse(text) as BundleBody
}

describe('the diagnostic bundle', () => {
  it('is titled for what it shows, and says nothing leaves until it is sent', async () => {
    await bundle()
    expect(screen.getByRole('heading', { level: 1, name: 'Send diagnostics' })).toBeInTheDocument()
    await waitFor(() => {
      expect(document.title).toBe('Send diagnostics · Household')
    })
    expect(
      screen.getByText('This is what would be sent. Nothing leaves until you send it.'),
    ).toBeInTheDocument()
    await sendButton()
  })

  it('asks nothing of the server until its member sends it', async () => {
    const server = taking()
    await bundle(server)
    await sendButton()
    expect(server.to(send)).toHaveLength(0)
  })

  it('draws every part in words, each one sent unless it is left out', async () => {
    await bundle()
    await sendButton()
    expect(
      screen
        .getAllByRole('checkbox')
        .map((box) => [
          box.getAttribute('aria-label') ?? box.closest('label')?.textContent,
          (box as HTMLInputElement).checked,
        ]),
    ).toEqual([
      ['Send the app and the browser', true],
      ['Send the language and the time zone', true],
      ['Send the ids', true],
      ['Send how this browser’s copy stands', true],
      ['Send what this browser last reported', true],
      ['Send the changes that weren’t saved as made', true],
    ])
    expect(pairsIn(await partOf('Send the app and the browser'))).toEqual({
      'App and build': clientName(),
      Browser: 'Chrome on Windows',
    })
    expect(pairsIn(await partOf('Send the language and the time zone'))).toEqual({
      Language: 'en',
      'Dates and numbers': 'en',
      'Time zone': 'Europe/Prague',
    })
    expect(pairsIn(await partOf('Send the ids'))).toEqual({
      'Your account': jana.id,
      'This household': home,
      'This browser’s copy': here,
    })
    expect(pairsIn(await partOf('Send how this browser’s copy stands'))).toEqual({
      'The household’s copy': 'Kept by this tab',
      Connection: 'Online',
      'Receiving changes': 'Yes',
      'Changes waiting to be sent': '2',
      'Changes held to send again': '1',
    })
    const reported = pairsIn(await partOf('Send what this browser last reported'))
    expect(reported['Last reported']).toMatch(/^Sep 8, 2026, 6:41\sPM$/)
    expect(reported).toMatchObject({
      'Last checkpoint': '184402',
      'Checksum failures': '0',
      'Kinds of things that didn’t match': '0',
      'Marked to download again': 'No',
    })
    const answers = await partOf('Send the changes that weren’t saved as made')
    expect(pairsIn(answers)).toEqual({ 'Changes not saved as made': '1' })
    expect(
      within(answers).getByText(
        'For each: its id, the kind of thing it was, what was done to it, how the server answered and why, and when. Nothing of what was written.',
      ),
    ).toBeInTheDocument()
    // What the request itself always carries.
    const always = screen.getByRole('region', { name: 'Always sent' })
    expect(pairsIn(always)).toMatchObject({
      'The page this is about': at,
      'This household': home,
    })
    expect(
      screen.getByText('Never in it: anything you or anybody else wrote, any name, any file.'),
    ).toBeInTheDocument()
  })

  it('draws the request as text, and sends exactly that', async () => {
    const server = taking([
      report({ checksum_failures: 3, digest_mismatch_entity_types: ['shopping.item'] }),
    ])
    const { user } = await bundle(server)
    const shown = await drawn()
    await user.click(await sendButton())
    await screen.findByText('Sent')
    const sent = await server.body(send)
    expect(sent).toEqual(shown)
    expect(sent).toEqual({
      id: shown.id,
      screen: at,
      household_id: home,
      payload: {
        client: { name: clientName(), browser: 'chrome', system: 'windows' },
        locale: { language: 'en', formats: 'en', time_zone: 'Europe/Prague' },
        ids: { member: jana.id, household: home, replica: here },
        sync: { replica: 'open', online: true, receiving: true, queued: 2, held: 1 },
        report: {
          reported_at: '2026-09-08T16:41:00Z',
          checkpoint: '184402',
          checksum_failures: 3,
          digest_mismatch_entity_types: ['shopping.item'],
          marked_to_download_again: false,
        },
        outcomes: [
          {
            mutation_id: outcome().mutation_id,
            entity_type: 'shopping.item',
            op: 'update',
            outcome: 'rejected',
            code: 'validation_failed',
            answered_at: '2026-09-08T16:31:00Z',
          },
        ],
      },
      redacted_fields: [],
    })
    expect(server.to(send)).toHaveLength(1)
  })

  // The replica keeps the row an answer carried and what the member wrote: neither is drawn,
  // and neither is sent.
  it('holds no value any member wrote, on the page or in what is sent', async () => {
    const server = taking()
    const { user } = await bundle(server)
    await sendButton()
    expect(document.body).not.toHaveTextContent(/Ovesné|mléko|cukru|Kvasnice|quantity/)
    // Nor a name: the account's and the household's are ids here.
    expect(document.body).not.toHaveTextContent(/Jana|Tilcer/)
    await user.click(await sendButton())
    await screen.findByText('Sent')
    const text = JSON.stringify(await server.body(send))
    expect(text).not.toMatch(/Ovesné|mléko|cukru|Kvasnice|quantity|Jana|Tilcer|"fields"|"row"/)
    expect(text).not.toContain(outcome().entity_id)
  })

  it('names what its browser is by what its header tells, and never sends the header', async () => {
    const server = taking()
    const { user } = await bundle(server)
    await user.click(await sendButton())
    await screen.findByText('Sent')
    expect(JSON.stringify(await server.body(send))).not.toContain('Mozilla')
  })

  it('leaves a part out of what is sent, names it as left out, and puts it back', async () => {
    const server = taking()
    const { user } = await bundle(server)
    const before = await drawn()
    const ids = await screen.findByRole('checkbox', { name: 'Send the ids' })
    await user.click(ids)
    expect(ids).not.toBeChecked()
    // The box said it: the focus is where it was, on the box.
    expect(document.activeElement).toBe(ids)
    const row = await partOf('Send the ids')
    expect(within(row).getByText('Left out. This part is not sent.')).toBeInTheDocument()
    const without = await drawn()
    expect(Object.keys(without.payload)).toEqual(['client', 'locale', 'sync', 'report', 'outcomes'])
    expect(without.redacted_fields).toEqual(['ids'])
    // Another bundle than the one that might have been sent whole.
    expect(without.id).not.toBe(before.id)

    await user.click(
      screen.getByRole('checkbox', { name: 'Send the changes that weren’t saved as made' }),
    )
    await user.click(await sendButton())
    await screen.findByText('Sent')
    const sent = (await server.body(send)) as BundleBody
    expect(Object.keys(sent.payload)).toEqual(['client', 'locale', 'sync', 'report'])
    expect(sent.redacted_fields).toEqual(['ids', 'outcomes'])
    expect(JSON.stringify(sent)).not.toContain(jana.id)
    expect(JSON.stringify(sent)).not.toContain('mutation_id')
  })

  it('sends a part again once it is put back', async () => {
    const server = taking()
    const { user } = await bundle(server)
    const ids = await screen.findByRole('checkbox', { name: 'Send the ids' })
    await user.click(ids)
    await user.click(ids)
    expect(ids).toBeChecked()
    expect(screen.queryByText('Left out. This part is not sent.')).not.toBeInTheDocument()
    await user.click(await sendButton())
    await screen.findByText('Sent')
    const sent = (await server.body(send)) as BundleBody
    expect(sent.redacted_fields).toEqual([])
    expect(sent.payload).toHaveProperty('ids')
  })

  it('is about the screen its member came from, where the link that led here said', async () => {
    const server = taking()
    const from = inHousehold.syncHealth(home)
    const { user } = await bundle(server, { state: { from } })
    expect((await drawn()).screen).toBe(from)
    await user.click(await sendButton())
    await screen.findByText('Sent')
    expect(await server.body(send)).toMatchObject({ screen: from })
  })

  it('is about its own address where what led here names no address of the app’s', async () => {
    await bundle(taking(), { state: { from: '//elsewhere.example/page' } })
    expect((await drawn()).screen).toBe(at)
  })

  it('says it was sent, with its reference and the day it is kept until, and takes the form away', async () => {
    const server = taking()
    const { user } = await bundle(server)
    const { id } = await drawn()
    await user.click(await sendButton())
    const said = await screen.findByText('Sent')
    expect(said.closest('[role="status"]')).not.toBeNull()
    expect(
      screen.getByText(`Its reference is ${String(id)}. Quote it when you report the problem.`),
    ).toBeInTheDocument()
    // The day the server named, in the household's zone.
    expect(
      screen.getByText(
        'It is kept until Oct 8, 2026 and then deleted. It can’t be read back here.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send diagnostics' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Sync health' })).toHaveAttribute(
      'href',
      inHousehold.syncHealth(home),
    )
    // The button that sent it left with the form, and the focus with it: it is put where the
    // screen says what became of the bundle, and not dropped to the page.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(said)
  })

  it('sends the reference its member typed, and none where the field is left empty', async () => {
    const server = taking()
    const { user } = await bundle(server)
    await user.type(
      await screen.findByRole('textbox', { name: 'A reference, if you were given one' }),
      '  T-4471 ',
    )
    expect((await drawn()).ticket_reference).toBe('T-4471')
    await user.click(await sendButton())
    await screen.findByText('Sent')
    expect(await server.body(send)).toMatchObject({ ticket_reference: 'T-4471' })
  })

  it('sends no reference where none was typed', async () => {
    const server = taking()
    const { user } = await bundle(server)
    await user.click(await sendButton())
    await screen.findByText('Sent')
    expect(await server.body(send)).not.toHaveProperty('ticket_reference')
  })

  it('is every member’s, in a household that takes no writes too', async () => {
    const server = taking([report()], createServer(accountOf(klara)))
    server.household = { ...server.household, entitlement: readOnly.entitlement }
    const { user } = await bundle(server)
    await user.click(await sendButton())
    expect(await screen.findByText('Sent')).toBeInTheDocument()
    expect(await server.body(send)).toMatchObject({
      payload: { ids: { member: klara, household: home } },
    })
  })
})

describe('a bundle that was not taken', () => {
  it('names the same bundle when it is sent again after an answer that never came', async () => {
    const server = taking()
    server.on(send, () => Promise.reject(new TypeError('offline')))
    const { user } = await bundle(server)
    const { id } = await drawn()
    onlineManager.setOnline(false)
    try {
      await user.click(await sendButton())
      // Asked at once, and said: nothing waits to be sent when the connection is back.
      expect(await screen.findByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
    } finally {
      onlineManager.setOnline(true)
    }
    expect(server.to(send)).toHaveLength(1)
    expect(await sendButton()).not.toHaveAttribute('aria-busy')
    taking([report()], server)
    await user.click(await sendButton())
    await screen.findByText('Sent')
    const [first, second] = await Promise.all(
      server.to(send).map(async (request) => (await request.clone().json()) as BundleBody),
    )
    expect(first?.id).toBe(id)
    expect(second?.id).toBe(id)
    expect(second).toEqual(first)
  })

  it('says a reference the server would not keep beside its field, and moves the focus there', async () => {
    const server = taking()
    server.on(send, () => invalid('/ticket_reference'))
    const { user } = await bundle(server)
    const field = await screen.findByRole('textbox', {
      name: 'A reference, if you were given one',
    })
    await user.type(field, 'T-4471')
    await user.click(await sendButton())
    await waitFor(() => {
      expect(field).toHaveAccessibleDescription(
        /That reference can’t be kept as it is\. Shorten it, or leave the field empty\./,
      )
    })
    expect(field).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => {
      expect(document.activeElement).toBe(field)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says a bundle the server would not take as it is, and that nothing was sent', async () => {
    const server = taking()
    server.on(send, () => invalid('/payload'))
    const { user } = await bundle(server)
    await user.click(await sendButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Household wouldn’t take the bundle as it is, so nothing was sent.',
    )
    expect(await sendButton()).toBeInTheDocument()
  })

  it('says when another may be sent, past the most an account sends in a day', async () => {
    const server = taking()
    server.on(send, () => problem(429, 'rate_limited', {}, { 'Retry-After': '3600' }))
    const { user } = await bundle(server)
    await user.click(await sendButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Too many attempts\. Try again at \d/,
    )
  })

  it('says each refusal as it comes, a second one again', async () => {
    const server = taking()
    server.on(send, () => problem(500, 'internal'))
    const { user } = await bundle(server)
    await user.click(await sendButton())
    const first = await screen.findByRole('alert')
    expect(first).toHaveTextContent(/^Something went wrong at our end\./)
    await user.click(await sendButton())
    await waitFor(() => {
      expect(screen.getByRole('alert')).not.toBe(first)
    })
  })

  it('keeps its button busy while the bundle is on its way', async () => {
    const server = taking()
    let answer: (response: Response) => void = () => undefined
    server.on(
      send,
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    )
    const { user } = await bundle(server)
    await user.click(await sendButton())
    await waitFor(async () => {
      expect(await sendButton()).toHaveAttribute('aria-busy', 'true')
    })
    await user.click(await sendButton())
    expect(server.to(send)).toHaveLength(1)
    answer(Response.json({ id: kept, expires_at: '2026-10-08T17:00:00Z' }, { status: 201 }))
    expect(await screen.findByText('Sent')).toBeInTheDocument()
  })
})

describe('what a bundle holds of this browser’s copy', () => {
  it('says the tab does not hold the copy, and holds no report it cannot know as its own', async () => {
    const server = taking([report(), report({ replica_id: laptop })])
    await bundle(server, { sync: syncWithout('elsewhere') })
    expect(pairsIn(await partOf('Send how this browser’s copy stands'))).toEqual({
      'The household’s copy': 'Kept by another tab',
      Connection: 'Online',
      'Receiving changes': 'Not known yet',
      'Changes waiting to be sent': '— Not recorded',
      'Changes held to send again': '— Not recorded',
    })
    expect(pairsIn(await partOf('Send the ids'))['This browser’s copy']).toBe('— Not recorded')
    expect(
      screen.queryByRole('checkbox', { name: 'Send what this browser last reported' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'What this browser last reported is not in the bundle: this tab doesn’t hold the household’s copy, so it can’t say which report is its own.',
      ),
    ).toBeInTheDocument()
    const shown = await drawn()
    expect(shown.payload).not.toHaveProperty('report')
    expect(shown.payload).toMatchObject({
      ids: { replica: null },
      sync: { replica: 'elsewhere', receiving: null, queued: null, held: null },
      outcomes: [],
    })
    // Nothing was taken out by its member: nothing is named as taken out.
    expect(shown.redacted_fields).toEqual([])
  })

  it('says a browser that keeps none keeps none', async () => {
    await bundle(taking(), { sync: syncWithout('unavailable') })
    expect(
      pairsIn(await partOf('Send how this browser’s copy stands'))['The household’s copy'],
    ).toBe('Not kept by this browser')
  })

  it('says the last report could not be read, and is built without it', async () => {
    const server = taking()
    server.on(`GET ${routes.state}`, () => Promise.reject(new TypeError('offline')))
    const { user } = await bundle(server)
    expect(
      await screen.findByText(
        'What this browser last reported is not in the bundle: the server couldn’t be asked for it.',
      ),
    ).toBeInTheDocument()
    await user.click(await sendButton())
    await screen.findByText('Sent')
    expect(((await server.body(send)) as BundleBody).payload).not.toHaveProperty('report')
  })

  it('says a browser that has not reported has no last report', async () => {
    await bundle(taking([report({ replica_id: laptop })]))
    expect(
      await screen.findByText(
        'What this browser last reported is not in the bundle: it hasn’t reported to the server yet.',
      ),
    ).toBeInTheDocument()
  })

  it('says a browser that keeps no answers keeps none', async () => {
    await bundle(taking(), { sync: syncOver(standIn()) })
    const answers = await partOf('Send the changes that weren’t saved as made')
    expect(pairsIn(answers)).toEqual({ 'Changes not saved as made': '0' })
    expect(within(answers).getByText('This browser keeps none.')).toBeInTheDocument()
  })

  it('draws its shape while this browser’s copy is asked and its last report read', async () => {
    const server = taking()
    server.on(`GET ${routes.state}`, () => new Promise<Response>(() => undefined))
    await bundle(server)
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send diagnostics' })).not.toBeInTheDocument()
  })

  it('is built once: what changes while it is read is not written into it', async () => {
    const stand = standIn({ queued: 2 })
    await bundle(taking(), { sync: syncOver(stand) })
    expect((await drawn()).payload).toMatchObject({ sync: { queued: 2 } })
    stand.move({ queued: 5 })
    await waitFor(async () => {
      expect((await drawn()).payload).toMatchObject({ sync: { queued: 2 } })
    })
  })
})
