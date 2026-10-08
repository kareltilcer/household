// The inbox (F-5): its states, its rows and what each opens, over a stand-in replica; and its
// page as the router draws it for a member, where the household's own zone, its members' names
// and the app's own describers, which are none yet, are what it reads.
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { createWebClient } from '../api/client.ts'
import { Providers } from '../app/App.tsx'
import { Signed } from '../app/guards.tsx'
import { inHousehold, paths } from '../app/paths.ts'
import {
  answer,
  conflict,
  conflictWithDeletion,
  describersFor,
  everything,
  household,
  me,
  overriddenMerge,
  petr,
  registry,
  rejectionWith,
  replacingMerge,
  settingFor,
} from '../dev/sync/fixtures.ts'
import { standIn, type StandIn } from '../dev/sync/standIn.ts'
import { HouseholdContext } from '../household/HouseholdContext.tsx'
import type { Household } from '../household/households.ts'
import { Press } from '../test/render.tsx'
import { Inbox, inboxState, InboxView, type InboxFacts } from './Inbox.tsx'
import { SyncFixture, type Sync } from './ReplicaProvider.tsx'

const words = {
  title: 'Changes that need your attention',
  list: 'Changes waiting for you',
  loading: 'Loading',
  empty: 'Everything is in sync. Nothing needs your attention.',
  emptyOffline:
    'Nothing needs your attention. What you change offline is saved, and sent when the connection is back.',
  emptyPlain: 'Nothing needs your attention.',
  offline:
    'You’re offline. You can still decide here: what you choose is kept in this browser and sent when the connection is back.',
  elsewhere: 'Open in another tab',
  elsewhereText:
    'Another tab of this browser is keeping this household’s changes, and only one tab can at a time. Use that tab, or close it and this one takes over.',
  error: 'These can’t be shown right now',
  reload: 'Reload',
  readonly: 'Read-only',
  settlement: 'March electricity settlement',
  water: 'February water settlement',
  oatMilk: 'Oat milk',
  packing: 'Packing list',
  openConflict: 'Two versions of March electricity settlement. Open to resolve',
  openRejected: 'Not accepted. Open for details',
  keepMine: 'Keep mine',
  keepTheirs: 'Keep theirs',
  details: 'Show the details',
  overridden: 'Part of your change was replaced',
  putAway: 'Put it away',
  finance: 'Finance',
  openFinance: 'Two versions of Finance. Open to resolve',
  petr: 'Petr Novák',
  find: 'Find the other tab',
  another: 'Another member',
  myOther: 'You, on another device',
  close: 'Close',
  openNotes: 'Two versions of Notes. Open to resolve',
} as const

const plain = (text: string) => text
const describers = describersFor(plain)

function syncOver(stand: StandIn, more: Partial<Sync> = {}): Sync {
  return { replica: { phase: 'open', ...stand.opened }, online: true, receiving: true, ...more }
}

function page(ui: ReactNode) {
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: ['/'] })
  return render(
    <Providers persist={false}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

/** The inbox over `sync`, in a household that writes unless it is said not to. */
function drawView(sync: Sync, { writes = true } = {}) {
  return page(
    <SyncFixture value={sync}>
      <InboxView setting={settingFor(plain, { writes })} describers={describers} />
    </SyncFixture>,
  )
}

describe('the inbox’s state', () => {
  const facts: InboxFacts = { phase: 'open', entries: [conflict], online: true, writes: true }

  it('is loading while the replica is being opened, and until it has been read', () => {
    expect(inboxState({ ...facts, phase: 'opening', entries: undefined })).toBe('loading')
    expect(inboxState({ ...facts, entries: undefined })).toBe('loading')
  })

  it('is an error where this browser opened no replica, and its own where another tab holds it', () => {
    expect(inboxState({ ...facts, phase: 'unavailable', entries: undefined })).toBe('error')
    expect(inboxState({ ...facts, phase: 'elsewhere', entries: undefined })).toBe('elsewhere')
  })

  it('is empty with nothing waiting, whatever else is so', () => {
    expect(inboxState({ ...facts, entries: [] })).toBe('empty')
    expect(inboxState({ ...facts, entries: [], online: false, writes: false })).toBe('empty')
  })

  it('says what the member can do before what the entries are', () => {
    expect(inboxState({ ...facts, writes: false, online: false })).toBe('readonly')
    expect(inboxState({ ...facts, online: false })).toBe('offline')
    expect(inboxState({ ...facts, entries: everything })).toBe('rejected')
    expect(inboxState(facts)).toBe('conflicted')
    expect(inboxState({ ...facts, entries: [overriddenMerge] })).toBe('populated')
  })
})

describe('the inbox', () => {
  it('draws the shape of its rows while the replica is being opened', () => {
    drawView({ replica: { phase: 'opening' }, online: true, receiving: null })
    expect(screen.getByRole('status', { name: words.loading })).toBeVisible()
    expect(screen.queryByRole('list', { name: words.list })).not.toBeInTheDocument()
  })

  it('says everything is in sync with nothing waiting, in one sentence and no example', () => {
    drawView(syncOver(standIn({ registry })))
    expect(screen.getByText(words.empty)).toBeVisible()
    expect(screen.queryByText('Example')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('claims no more than it knows with nothing waiting and no connection', () => {
    drawView(syncOver(standIn({ registry }), { online: false, receiving: null }))
    expect(screen.getByText(words.emptyOffline)).toBeVisible()
  })

  it('does not say all is in sync while the household’s changes are not arriving', () => {
    drawView(syncOver(standIn({ registry }), { receiving: false }))
    expect(screen.getByText(words.emptyPlain)).toBeVisible()
    expect(screen.queryByText(words.empty)).not.toBeInTheDocument()
  })

  it('says another tab holds the household’s replica, and what to do', () => {
    drawView({ replica: { phase: 'elsewhere' }, online: true, receiving: null })
    expect(screen.getByText(words.elsewhere)).toBeVisible()
    expect(screen.getByText(words.elsewhereText)).toBeVisible()
    expect(screen.queryByRole('list', { name: words.list })).not.toBeInTheDocument()
  })

  it('says this browser could not open its replica, that nothing was lost, and offers a reload', () => {
    drawView({ replica: { phase: 'unavailable' }, online: true, receiving: null })
    expect(screen.getByText(words.error)).toBeVisible()
    expect(screen.getByText(/Nothing was lost\./)).toBeVisible()
    expect(screen.getByRole('button', { name: words.reload })).toBeVisible()
  })

  it('announces that another tab holds it where that is learned while the member is here', async () => {
    const setting = settingFor(plain)
    function Found() {
      const [phase, setPhase] = useState<'opening' | 'elsewhere'>('opening')
      return (
        <>
          <Press
            name={words.find}
            onPress={() => {
              setPhase('elsewhere')
            }}
          />
          <SyncFixture value={{ replica: { phase }, online: true, receiving: null }}>
            <InboxView setting={setting} describers={describers} />
          </SyncFixture>
        </>
      )
    }
    page(<Found />)
    await userEvent.click(screen.getByRole('button', { name: words.find }))
    // Politely, and so drawn before its words (ui/Banner).
    expect(await screen.findByText(words.elsewhereText)).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(words.elsewhereText)
  })

  it('reads a state it opened in in its place, and announces none', () => {
    drawView({ replica: { phase: 'elsewhere' }, online: true, receiving: null })
    expect(screen.getByText(words.elsewhereText)).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lists what waits oldest first, each with its module, its name, when, and its mark', () => {
    drawView(syncOver(standIn({ registry, entries: everything })))
    const rows = within(screen.getByRole('list', { name: words.list })).getAllByRole('listitem')
    expect(rows).toHaveLength(everything.length)
    // Oldest first, as the replica lists them.
    expect(rows[0]).toHaveTextContent(words.oatMilk)
    const deleted = rows.find((row) => row.textContent.includes(words.water))
    const asked = rows.find((row) => row.textContent.includes(words.settlement))
    if (deleted === undefined || asked === undefined) throw new Error('a conflict is not listed')
    expect(rows.indexOf(deleted)).toBeLessThan(rows.indexOf(asked))
    // When it was answered, in the household's zone: an hour ahead of the instant as written.
    expect(asked).toHaveTextContent(/Since Mar 3, 2026, 6:41/)
    expect(within(asked).getByText(words.finance)).toBeVisible()
    expect(within(asked).getByRole('button', { name: words.openConflict })).toBeVisible()
    // A refusal's mark is a control too, and a merge has none: nothing of it is in question.
    expect(screen.getAllByRole('button', { name: words.openRejected })).toHaveLength(9)
    expect(screen.getAllByRole('button', { name: words.details })).toHaveLength(2)
  })

  it('opens the comparison from a conflict’s mark, and lets the row go once it is answered', async () => {
    const stand = standIn({ registry, entries: [conflictWithDeletion, conflict] })
    drawView(syncOver(stand))
    await userEvent.click(screen.getByRole('button', { name: words.openConflict }))
    const panel = screen.getByRole('dialog', { name: words.settlement })
    await userEvent.click(within(panel).getByRole('button', { name: words.keepTheirs }))
    expect(stand.asked).toEqual(['discard:c1'])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(words.settlement)).not.toBeInTheDocument()
    expect(screen.getByText(words.water)).toBeVisible()
    // The row that opened the panel is gone, and the focus with it: it is put on the list's place.
    expect(screen.getByRole('list', { name: words.list }).closest('[tabindex="-1"]')).toHaveFocus()
  })

  it('opens the reason from a refusal’s mark', async () => {
    drawView(syncOver(standIn({ registry, entries: [rejectionWith('forbidden')] })))
    await userEvent.click(screen.getByRole('button', { name: words.openRejected }))
    const panel = screen.getByRole('dialog', { name: words.oatMilk })
    expect(within(panel).getByText(/^You aren’t allowed to make this change/)).toBeVisible()
  })

  it('closes a panel whose answer left the list behind it', async () => {
    const stand = standIn({ registry, entries: [conflict] })
    drawView(syncOver(stand))
    await userEvent.click(screen.getByRole('button', { name: words.openConflict }))
    expect(screen.getByRole('dialog')).toBeVisible()
    // Answered from the row's own screen, or sent by the replica itself.
    await act(() => stand.opened.replica.resolve(conflict.mutation_id))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(words.empty)).toBeVisible()
  })

  it('shows a merge’s banner under its row when asked, and puts it away', async () => {
    const stand = standIn({ registry, entries: [overriddenMerge, replacingMerge] })
    drawView(syncOver(stand))
    const [first] = screen.getAllByRole('button', { name: words.details })
    if (first === undefined) throw new Error('no merge is listed')
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(words.overridden)).not.toBeInTheDocument()
    await userEvent.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    const banner = document.getElementById(first.getAttribute('aria-controls') ?? '')
    expect(banner).toHaveTextContent(words.overridden)
    // It is no panel: the list beside it stays in reach.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: words.putAway }))
    expect(stand.asked).toEqual(['resolve:m1'])
    expect(screen.queryByText(words.oatMilk)).not.toBeInTheDocument()
    expect(screen.getByText(words.packing)).toBeVisible()
  })

  it('reads the same with no connection, and says changes go when it is back', () => {
    drawView(syncOver(standIn({ registry, entries: [conflict] }), { online: false }))
    expect(screen.getByText(words.offline)).toBeVisible()
    expect(screen.getByRole('button', { name: words.openConflict })).toBeVisible()
  })

  it('says a household that does not write keeps what is held, and draws nothing that sends', async () => {
    const stand = standIn({
      registry,
      entries: [conflict, rejectionWith('entitlement_read_only')],
    })
    drawView(syncOver(stand), { writes: false })
    // Said politely once the replica has been read, and so drawn before its words (ui/Banner).
    expect(await screen.findByText(words.readonly)).toBeVisible()
    expect(screen.getByText(/sent by themselves once it can be changed again\.$/)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: words.openConflict }))
    expect(screen.queryByRole('button', { name: words.keepMine })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: words.keepTheirs })).toBeVisible()
  })
})

describe('the inbox’s page', () => {
  const origin = 'https://household.example'
  const home: Household = {
    id: household,
    name: 'Tilcerovi',
    country: 'CZ',
    timezone: 'Europe/Prague',
    base_currency: 'CZK',
    locale: 'cs-CZ',
    entitlement: { state: 'active', can_write: true },
  }

  /** The household's members as the API lists them: Petr, and nobody who has left. */
  const listed = () => Response.json({ items: [{ user_id: petr, display_name: words.petr }] })

  /** The page as the router draws it for a member of `inHome`, over `stand`. */
  function open(stand: StandIn, inHome: Household = home, members: () => Response = listed) {
    const asked: string[] = []
    const client = createWebClient({
      origin,
      cookies: () => '__Host-hh_csrf=t',
      fetch: (request) => {
        const { pathname } = new URL(request.url)
        asked.push(pathname)
        if (pathname === '/api/v1/me') {
          return Promise.resolve(
            Response.json({ id: me, display_name: 'Karel', email_verified: true, locale: 'en' }),
          )
        }
        if (pathname === `/api/v1/households/${household}/members`) {
          return Promise.resolve(members())
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      },
    })
    const router = createMemoryRouter(
      [
        {
          Component: Signed,
          children: [
            {
              path: paths.sync.path,
              element: (
                <HouseholdContext value={inHome}>
                  <SyncFixture value={syncOver(stand)}>
                    <Inbox />
                  </SyncFixture>
                </HouseholdContext>
              ),
            },
          ],
        },
      ],
      { initialEntries: [inHousehold.sync(household)] },
    )
    render(
      <Providers persist={false} client={client} cookies={() => '__Host-hh_csrf=t'}>
        <RouterProvider router={router} />
      </Providers>,
    )
    return asked
  }

  it('has one title, and names the other author from the household’s members', async () => {
    const asked = open(standIn({ registry, entries: [conflict] }))
    expect(await screen.findByRole('heading', { level: 1, name: words.title })).toBeVisible()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    // No module describes its rows yet: the row is read by its module's name.
    await userEvent.click(await screen.findByRole('button', { name: words.openFinance }))
    const panel = screen.getByRole('dialog', { name: words.finance })
    expect(await within(panel).findByRole('heading', { level: 3, name: words.petr })).toBeVisible()
    expect(
      within(panel)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['amount_minor', 'amount_minor'])
    expect(asked).toContain(`/api/v1/households/${household}/members`)
  })

  it('names the member’s own other device, and nobody for an author the household does not list', async () => {
    const mine = answer({
      id: 'c4',
      entityType: 'notes.note',
      outcome: 'conflict',
      fields: { title: 'Packing' },
      // The same user, written as another client writes an id.
      row: { title: 'Packing list', updated_by: me.toUpperCase() },
      answeredAt: '2026-03-04T08:00:00Z',
    })
    open(standIn({ registry, entries: [conflictWithDeletion, mine] }))
    await userEvent.click(await screen.findByRole('button', { name: words.openFinance }))
    // Someone who has since left: no name is made up for them.
    expect(screen.getByRole('heading', { level: 3, name: words.another })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: words.close }))
    await userEvent.click(screen.getByRole('button', { name: words.openNotes }))
    expect(screen.getByRole('heading', { level: 3, name: words.myOther })).toBeVisible()
  })

  it('names nobody where the household’s members cannot be read, and still asks the question', async () => {
    const refused = () =>
      Response.json(
        { type: 'about:blank', title: 'not_found', status: 404, code: 'not_found' },
        { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
      )
    open(standIn({ registry, entries: [conflict] }), home, refused)
    await userEvent.click(await screen.findByRole('button', { name: words.openFinance }))
    expect(screen.getByRole('heading', { level: 3, name: words.another })).toBeVisible()
    expect(screen.getByRole('button', { name: words.keepMine })).toBeVisible()
  })

  it('is read-only in a household whose entitlement does not write', async () => {
    open(standIn({ registry, entries: [conflict] }), {
      ...home,
      entitlement: { state: 'read_only', can_write: false },
    })
    expect(await screen.findByText(words.readonly)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: words.openFinance }))
    expect(screen.queryByRole('button', { name: words.keepMine })).not.toBeInTheDocument()
  })
})
