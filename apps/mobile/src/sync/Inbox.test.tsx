// The inbox (F-5, DD-4): which state it is in, what each state draws and says, what its rows
// open, and where a screen reader's focus is once a row has been answered. The web's cases, on a
// device (apps/web/src/sync/Inbox.test.tsx), less the one state a browser's tabs add.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { catalogs } from '@household/i18n'
import type { RecordedOutcome } from '@household/sync'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, screen, userEvent, waitFor, within } from '@testing-library/react-native'
import { useState } from 'react'
import { Platform } from 'react-native'
import { answering, json, problem, testClient } from '../api/testing.ts'
import type { Household } from '../household/data.ts'
import { createFormatters } from '../i18n/format.ts'
import { account, SessionFixture } from '../session/fixture.tsx'
import { elementsOf, expectAccessible, textOf } from '../test/a11y.ts'
import { households, people } from '../test/fixtures.ts'
import { render, type DrawOptions } from '../test/render.tsx'
import * as announcer from '../ui/announce.ts'
import { Inbox, inboxState, InboxView, type InboxFacts } from './Inbox.tsx'
import { SyncFixture, type ReplicaState, type Sync } from './ReplicaProvider.tsx'
import { standIn, type StandIn } from './standIn.ts'
import {
  conflict,
  conflictWithDeletion,
  describersFor,
  everything,
  overriddenMerge,
  petr,
  registry,
  rejectionWith,
  replacingMerge,
  settingFor,
} from './sync.fixtures.ts'

/** The household an address names, as a test says it. */
const mockAt = { household: households.own.id as string }

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ household: mockAt.household }),
}))

const en = catalogs.en
const format = createFormatters('en')
const plain = (text: string) => text
const describers = describersFor(plain)
const since = (instant: string) => `Since ${format.instant(instant, 'Europe/Prague')}`

interface InboxOptions {
  readonly entries?: readonly RecordedOutcome[]
  readonly phase?: ReplicaState['phase']
  readonly online?: boolean
  readonly receiving?: boolean | null
  readonly writes?: boolean
  /** What asking an unavailable replica to open once more comes to. */
  readonly retried?: ReplicaState['phase']
}

/** The inbox over a stand-in replica, in the state of sync a test gives it. */
function Over({
  stand,
  phase = 'open',
  online = true,
  receiving = true,
  writes = true,
  retried,
}: InboxOptions & { readonly stand: StandIn }) {
  const [at, setAt] = useState(phase)
  const replica: ReplicaState =
    at === 'open'
      ? { phase: 'open', ...stand.opened }
      : at === 'unavailable'
        ? {
            phase: 'unavailable',
            retry: () => {
              if (retried !== undefined) setAt(retried)
            },
          }
        : { phase: 'opening' }
  const sync: Sync = { replica, online, receiving: at === 'open' ? receiving : null }
  return (
    <SyncFixture value={sync}>
      <InboxView setting={settingFor(plain, { writes })} describers={describers} />
    </SyncFixture>
  )
}

async function inbox(options: InboxOptions = {}, draw?: DrawOptions) {
  const stand = standIn({ registry, entries: options.entries ?? [] })
  await render(<Over stand={stand} {...options} />, draw)
  return stand
}

/** The rows of the list, as the words each holds. */
function rows(): string[] {
  return elementsOf(screen.getByTestId('sync:inbox:list'))
    .filter((element) => element.props.role === 'listitem')
    .map((element) => textOf(element))
}

const row = (name: string) => {
  const found = elementsOf(screen.getByTestId('sync:inbox:list')).find(
    (element) => element.props.role === 'listitem' && textOf(element).includes(name),
  )
  if (found === undefined) throw new Error(`no row is called ${name}`)
  return found
}

beforeEach(async () => {
  await AsyncStorage.clear()
  mockAt.household = households.own.id
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the inbox’s state', () => {
  const open: InboxFacts = { phase: 'open', entries: [], online: true, writes: true }

  it('is loading while the replica is being opened, and until it has been read', () => {
    expect(inboxState({ ...open, phase: 'opening', entries: undefined })).toBe('loading')
    expect(inboxState({ ...open, entries: undefined })).toBe('loading')
  })

  it('is an error where this device could not open its copy', () => {
    expect(inboxState({ ...open, phase: 'unavailable', entries: undefined })).toBe('error')
  })

  it('is empty with nothing waiting, whatever else is so', () => {
    expect(inboxState(open)).toBe('empty')
    expect(inboxState({ ...open, online: false, writes: false })).toBe('empty')
  })

  it('says what the member can do before what the entries are', () => {
    const waiting = { ...open, entries: [conflict, rejectionWith('forbidden'), overriddenMerge] }
    expect(inboxState({ ...waiting, writes: false, online: false })).toBe('readonly')
    expect(inboxState({ ...waiting, online: false })).toBe('offline')
    expect(inboxState(waiting)).toBe('rejected')
    expect(inboxState({ ...waiting, entries: [conflict, overriddenMerge] })).toBe('conflicted')
    expect(inboxState({ ...waiting, entries: [overriddenMerge] })).toBe('populated')
  })
})

describe('the inbox', () => {
  it('draws the shape of its rows while the replica is being opened', async () => {
    await inbox({ phase: 'opening' })
    expect(screen.getByTestId('skeleton')).toBeBusy()
    expect(screen.queryByTestId('sync:inbox:list')).toBeNull()
    expectAccessible()
  })

  it('says everything is in sync with nothing waiting, in one sentence and no example', async () => {
    await inbox()
    expect(screen.getByTestId('empty-state')).toHaveTextContent(en['sync.inbox.empty'], {
      exact: true,
    })
    expect(screen.queryByRole('button')).toBeNull()
    expectAccessible()
  })

  it('claims no more than it knows with nothing waiting and no connection', async () => {
    await inbox({ online: false, receiving: null })
    expect(screen.getByTestId('empty-state')).toHaveTextContent(en['sync.inbox.empty_offline'], {
      exact: true,
    })
  })

  it('does not say all is in sync while the household’s changes are not arriving', async () => {
    await inbox({ receiving: false })
    expect(screen.getByTestId('empty-state')).toHaveTextContent(en['sync.inbox.empty_plain'], {
      exact: true,
    })
    expect(en['sync.inbox.empty_plain']).not.toMatch(/in sync/)
  })

  it('says this device could not open its copy, that nothing was lost, and offers to try again', async () => {
    await inbox({ phase: 'unavailable' })
    const banner = screen.getByTestId('banner:danger')
    expect(banner).toHaveTextContent(en['sync.inbox.error.title'], { exact: false })
    expect(banner).toHaveTextContent(en['device.sync.inbox.error.text'], { exact: false })
    // A device's words: nothing of a browser, a page or a site.
    expect(en['device.sync.inbox.error.text']).toMatch(/This device.*Nothing was lost/)
    expect(en['device.sync.inbox.error.text']).not.toMatch(/browser|page|site|reload/i)
    expect(screen.getByRole('button', { name: en['ui.retry'] })).toBeOnTheScreen()
    expectAccessible()
  })

  it('reads a state it opened in in its place, and announces none', async () => {
    const announce = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
    const urgent = jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
    await inbox({ phase: 'unavailable' })
    expect(announce).not.toHaveBeenCalled()
    expect(urgent).not.toHaveBeenCalled()
  })

  it('says what trying again came to: the control that was pressed leaves with its sentence', async () => {
    const announce = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
    await inbox({ phase: 'unavailable', retried: 'open', entries: [conflict] })
    await userEvent.press(screen.getByTestId('sync:inbox:retry'))
    await waitFor(() => {
      expect(screen.getByTestId('sync:inbox:list')).toBeOnTheScreen()
    })
    expect(screen.queryByTestId('sync:inbox:retry')).toBeNull()
    expect(announce.mock.calls).toEqual([[en['sync.inbox.list']]])
  })

  it('says that nothing waits where trying again opened a copy with nothing in it', async () => {
    const announce = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
    await inbox({ phase: 'unavailable', retried: 'open' })
    await userEvent.press(screen.getByTestId('sync:inbox:retry'))
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeOnTheScreen()
    })
    expect(announce.mock.calls).toEqual([[en['sync.inbox.empty']]])
  })

  it('lists what waits oldest first, each with its module, its name, when, and its mark', async () => {
    await inbox({ entries: [conflictWithDeletion, conflict, rejectionWith('forbidden')] })
    expect(screen.getByText(en['device.sync.inbox.lead'])).toBeOnTheScreen()
    // The changes are this device's: the lead says so in a device's words.
    expect(en['device.sync.inbox.lead']).toContain('on this device')
    expect(screen.getByTestId('sync:inbox:list')).toHaveProp('aria-label', en['sync.inbox.list'])
    const [first, second, third] = rows()
    expect(first).toContain('February water settlement')
    expect(first).toContain(since('2026-03-03T06:10:00Z'))
    expect(first).toContain(en['module.finance.name'])
    expect(second).toContain('March electricity settlement')
    expect(second).toContain(since('2026-03-03T17:41:00Z'))
    expect(third).toContain('Oat milk')
    expect(third).toContain(en['module.shopping.name'])
    // Each mark is a control named for what opening it does: a conflict's for its row.
    expect(
      screen.getByRole('button', {
        name: 'Two versions of March electricity settlement. Open to resolve',
      }),
    ).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Not accepted. Open for details' })).toBeOnTheScreen()
    // Nothing is a modal at reconnect: no sheet is open until a row's mark is pressed.
    expect(screen.queryByTestId('resolver')).toBeNull()
    expectAccessible()
  })

  it('opens the comparison from a conflict’s mark, and lets the row go once it is answered', async () => {
    jest.replaceProperty(Platform, 'OS', 'android')
    const stand = await inbox({ entries: [conflict, rejectionWith('forbidden')] })
    await userEvent.press(within(row('March electricity')).getByTestId('status:conflict'))
    expect(screen.getByTestId('resolver:surface')).toBeOnTheScreen()
    expect(screen.getByText(en['sync.conflict.question'])).toBeOnTheScreen()
    await userEvent.press(screen.getByTestId('resolver:keep-theirs'))
    await waitFor(() => {
      expect(rows()).toHaveLength(1)
    })
    expect(stand.asked).toEqual([`discard:${conflict.mutation_id}`])
    expect(screen.queryByTestId('resolver:surface')).toBeNull()
  })

  it('puts the focus on the list’s own place once an answered row has gone, and not before the sheet has', async () => {
    const focus = jest.spyOn(announcer, 'focusOn').mockReturnValue(true)
    await inbox({ entries: [conflict, rejectionWith('forbidden')] })
    await userEvent.press(within(row('March electricity')).getByTestId('status:conflict'))
    const { onDismiss } = screen.getByTestId('resolver').props as {
      readonly onDismiss: () => void
    }
    focus.mockClear()
    await userEvent.press(screen.getByTestId('resolver:keep-theirs'))
    await waitFor(() => {
      expect(rows()).toHaveLength(1)
    })
    // The sheet is still leaving: the focus it gives back would land under it.
    expect(focus).not.toHaveBeenCalled()
    await act(async () => {
      onDismiss()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(focus).toHaveBeenCalledTimes(1)
    })
    // One thing to a screen reader, which says what the list under it is.
    const place = focus.mock.lastCall?.[0].current
    expect({ ...place?.props }).toMatchObject({ accessible: true })
    expect(screen.getByText(en['device.sync.inbox.lead'])).toBeOnTheScreen()
  })

  it('leaves the focus where the sheet gave it back when it was closed with no answer', async () => {
    jest.replaceProperty(Platform, 'OS', 'android')
    const focus = jest.spyOn(announcer, 'focusOn').mockReturnValue(true)
    await inbox({ entries: [rejectionWith('forbidden'), rejectionWith('not_found')] })
    const [first] = screen.getAllByTestId('status:rejected')
    if (first === undefined) throw new Error('no row is marked')
    await userEvent.press(first)
    await userEvent.press(screen.getByTestId('resolver:close'))
    await waitFor(() => {
      expect(screen.queryByTestId('resolver:surface')).toBeNull()
    })
    expect(rows()).toHaveLength(2)
    // Its own row is still there, and the platform gives the focus back to its mark.
    expect(focus).not.toHaveBeenCalled()
  })

  it('opens the reason from a refusal’s mark', async () => {
    await inbox({ entries: [rejectionWith('forbidden')] })
    await userEvent.press(screen.getByTestId('status:rejected'))
    expect(screen.getByText(en['sync.rejected.reason.forbidden'])).toBeOnTheScreen()
  })

  it('closes a sheet whose answer left the list behind it', async () => {
    const stand = await inbox({ entries: [conflict, rejectionWith('forbidden')] })
    await userEvent.press(within(row('March electricity')).getByTestId('status:conflict'))
    expect(screen.getByTestId('resolver:surface')).toBeOnTheScreen()
    // The replica sent what it was holding, or the member answered it from the row's own screen.
    await act(async () => {
      await stand.opened.replica.discard(conflict.mutation_id)
    })
    await waitFor(() => {
      expect(screen.queryByTestId('resolver:surface')).toBeNull()
    })
  })

  it('shows a merge’s banner under its row when asked, and puts it away', async () => {
    const stand = await inbox({ entries: [overriddenMerge, replacingMerge] })
    const [first, second] = rows()
    // No mark: nothing of a merge is in question. It says what became of the change, and when.
    expect(first).toContain('Oat milk')
    expect(first).toMatch(/^Oat milk Part of your change was replaced \(/)
    expect(second).toMatch(/Your change replaced a version you hadn’t seen \(/)
    expect(screen.queryByTestId('status:conflict')).toBeNull()
    expect(screen.queryByTestId('sync:kept')).toBeNull()
    const [show] = screen.getAllByRole('button', { name: en['sync.kept.show'] })
    if (show === undefined) throw new Error('no merge is listed')
    expect(show).toBeCollapsed()
    await userEvent.press(show)
    expect(show).toBeExpanded()
    expect(screen.getByTestId('sync:kept')).toHaveTextContent(en['sync.kept.overridden.text'], {
      exact: false,
    })
    await userEvent.press(screen.getByRole('button', { name: en['sync.kept.put_away'] }))
    await waitFor(() => {
      expect(rows()).toHaveLength(1)
    })
    expect(stand.asked).toEqual([`resolve:${overriddenMerge.mutation_id}`])
  })

  it('reads the same with no connection, and says changes go when it is back', async () => {
    await inbox({ online: false, entries: [conflict, rejectionWith('forbidden')] })
    expect(rows()).toHaveLength(2)
    expect(screen.getByText(en['device.sync.inbox.offline'])).toBeOnTheScreen()
    expect(en['device.sync.inbox.offline']).toContain('on this device')
    // Deciding is this device's own write, so nothing is taken away.
    await userEvent.press(screen.getByTestId('status:conflict'))
    expect(screen.getByTestId('resolver:keep-mine')).toBeOnTheScreen()
  })

  it('says a household that takes no writes keeps what is held, and answers nothing there', async () => {
    await inbox({ writes: false, entries: [conflict, rejectionWith('forbidden')] })
    const strip = screen.getByTestId('banner:warning')
    expect(strip).toHaveTextContent(en['sync.inbox.readonly.title'], { exact: false })
    expect(strip).toHaveTextContent(en['device.sync.inbox.readonly.text'], { exact: false })
    expect(rows()).toHaveLength(2)
    // The conflict's sheet draws neither answer.
    await userEvent.press(screen.getByTestId('status:conflict'))
    expect(screen.queryByTestId('resolver:keep-mine')).toBeNull()
    expect(screen.queryByTestId('resolver:keep-theirs')).toBeNull()
  })

  it('does not say that a member can still decide, in a household that takes no writes', async () => {
    await inbox({ writes: false, online: false, entries: [conflict] })
    expect(screen.queryByText(en['device.sync.inbox.offline'])).toBeNull()
  })

  it('holds everything at once at 200 % text, in German, with nothing unnamed', async () => {
    await inbox({ entries: everything }, { scale: 2, locale: 'de' })
    expect(rows()).toHaveLength(everything.length)
    expectAccessible()
  })
})

describe('the inbox’s screen', () => {
  const home: Household = {
    ...households.own,
    country: 'CZ',
    timezone: 'Europe/Prague',
    base_currency: 'CZK',
    locale: 'cs-CZ',
    my_role: 'member',
    my_grants: {},
    entitlement: { state: 'active', can_write: true },
  }
  const members = {
    items: [
      { user_id: petr.toUpperCase(), display_name: people.member.name, role: 'member' },
      { user_id: people.owner.id, display_name: people.owner.name, role: 'owner' },
    ],
  }

  interface ScreenOptions {
    readonly household?: Household
    readonly listed?: () => Response
    readonly read?: () => Response
    readonly entries?: readonly RecordedOutcome[]
  }

  async function drawn({
    household = home,
    listed = () => json(200, members),
    read = () => json(200, household),
    entries = [conflict],
  }: ScreenOptions = {}) {
    const stand = standIn({ registry, entries })
    const api = answering({
      [`GET /households/${home.id}`]: read,
      [`GET /households/${home.id}/members`]: listed,
    })
    const sync: Sync = {
      replica: { phase: 'open', ...stand.opened },
      online: true,
      receiving: true,
    }
    await render(
      <SessionFixture api={testClient(api.transport)} state={{ status: 'member', me: account() }}>
        <SyncFixture value={sync}>
          <Inbox />
        </SyncFixture>
      </SessionFixture>,
    )
    return { stand, api }
  }

  it('has one title, which is its header, and keeps the name its route is found by', async () => {
    await drawn()
    expect(screen.getByTestId('route:sync')).toBeOnTheScreen()
    expect(screen.getAllByRole('header')).toHaveLength(1)
    expect(screen.getByRole('header', { name: en['sync.inbox.title'] })).toBeOnTheScreen()
    await waitFor(() => {
      expect(screen.getByTestId('sync:inbox:list')).toBeOnTheScreen()
    })
    expectAccessible()
  })

  it('names the other author from the household’s members, whom the replica does not name', async () => {
    const { api } = await drawn()
    await waitFor(() => {
      expect(api.sent(`GET /households/${home.id}/members`)).toHaveLength(1)
    })
    await userEvent.press(await screen.findByTestId('status:conflict'))
    await waitFor(() => {
      expect(
        within(screen.getByTestId('sync:version:1')).getByRole('header', {
          name: people.member.name,
        }),
      ).toBeOnTheScreen()
    })
  })

  it('names nobody where the household’s members cannot be read, and still asks the question', async () => {
    await drawn({ listed: () => problem(500, 'internal') })
    await userEvent.press(await screen.findByTestId('status:conflict'))
    expect(
      within(screen.getByTestId('sync:version:1')).getByRole('header', {
        name: en['sync.author.unknown'],
      }),
    ).toBeOnTheScreen()
    expect(screen.getByText(en['sync.conflict.question'])).toBeOnTheScreen()
  })

  it('reads an instant in the member’s own zone where their account names one', async () => {
    const stand = standIn({ registry, entries: [conflict] })
    const api = answering({
      [`GET /households/${home.id}`]: () => json(200, home),
      [`GET /households/${home.id}/members`]: () => json(200, members),
    })
    const sync: Sync = {
      replica: { phase: 'open', ...stand.opened },
      online: true,
      receiving: true,
    }
    await render(
      <SessionFixture
        api={testClient(api.transport)}
        state={{ status: 'member', me: account({ timezone: 'America/New_York' }) }}
      >
        <SyncFixture value={sync}>
          <Inbox />
        </SyncFixture>
      </SessionFixture>,
    )
    await waitFor(() => {
      expect(rows()[0]).toContain(
        `Since ${format.instant('2026-03-03T17:41:00Z', 'America/New_York')}`,
      )
    })
  })

  it('is read-only in a household whose entitlement does not write', async () => {
    await drawn({
      household: { ...home, entitlement: { state: 'read_only', can_write: false } },
    })
    await waitFor(() => {
      expect(screen.getByTestId('banner:warning')).toHaveTextContent(
        en['sync.inbox.readonly.title'],
        { exact: false },
      )
    })
  })

  it('draws nothing under its title for a household that could not be read: the frame says that', async () => {
    const { api } = await drawn({ read: () => problem(404, 'not_found') })
    await waitFor(() => {
      expect(api.sent(`GET /households/${home.id}`)).toHaveLength(1)
    })
    expect(screen.queryByTestId('sync:inbox:list')).toBeNull()
    expect(screen.queryByTestId('skeleton')).toBeNull()
    // And nothing was asked about a household that is not the member's.
    expect(api.sent(`GET /households/${home.id}/members`)).toEqual([])
  })
})
