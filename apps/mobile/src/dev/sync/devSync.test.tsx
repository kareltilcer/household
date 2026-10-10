// The sync UI's dev screen and its model: that each case is the state it is named for, that the
// screen draws each in both themes under one title, that a sheet opens from it, that it holds to
// the accessibility rules at both text sizes, and what its one live section says of a real
// replica. What a device measures, and that a device opens the replica at all, is the
// end-to-end flow's.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { pseudolocalize } from '@household/i18n'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { onlineManager } from '@tanstack/react-query'
import { act, screen, userEvent, waitFor, within } from '@testing-library/react-native'
import type { TestInstance } from 'test-renderer'
import * as client from '../../api/client.ts'
import { answering, json, testApi, testClient } from '../../api/testing.ts'
import type { HouseholdSummary } from '../../household/data.ts'
import { SessionFixture } from '../../session/fixture.tsx'
import { inboxState } from '../../sync/Inbox.tsx'
import { rejectionCodes } from '../../sync/rejection.ts'
import {
  describersFor,
  everything,
  refusalCodes,
  registry,
  rejections,
} from '../../sync/sync.fixtures.ts'
import { elementsOf, expectAccessible } from '../../test/a11y.ts'
import { householdOf, households, ids } from '../../test/fixtures.ts'
import { render } from '../../test/render.tsx'
import * as announcer from '../../ui/announce.ts'
import { devMarker } from '../marker.ts'
import DevSync from './index.tsx'
import { cellId, cellThemes, inboxCases, inboxStates, rowCases, rowStates, texts } from './model.ts'

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  usePathname: () => '/dev/sync',
}))

/** What the sync service says of the one real replica this file opens, and who listens. */
const mockLive = {
  status: { connected: false, downloadError: undefined as Error | undefined },
  /** Whether a checkpoint has been applied since its stream came up: what a report waits for. */
  caughtUp: false,
  /** What the server answers its report with: a verdict, a refusal, or nothing at all. */
  answers: 'matched' as 'matched' | 'refused' | 'nothing',
  listeners: new Set<{ statusChanged?: (status: unknown) => void }>(),
  asked: [] as string[],
}

// The library's own opening, stood in for: no SQLite is opened on a developer's machine. What
// stands in holds what the provider and the inbox ask of an open replica.
jest.mock('@household/sync/native', () => ({
  openReplica: (options: { readonly dbFilename: string }) => {
    mockLive.asked.push(`open:${options.dbFilename}`)
    return Promise.resolve({
      db: {
        get currentStatus() {
          return mockLive.status
        },
        registerListener: (listener: { statusChanged?: (status: unknown) => void }) => {
          mockLive.listeners.add(listener)
          return () => {
            mockLive.listeners.delete(listener)
          }
        },
        onChange: ({ onChange }: { readonly onChange: () => Promise<void> }) => {
          void onChange()
          return () => undefined
        },
      },
      inbox: () => Promise.resolve([]),
      connect: () => {
        mockLive.asked.push('connect')
        return Promise.resolve()
      },
      resume: () => {
        mockLive.asked.push('resume')
      },
      close: () => {
        mockLive.asked.push('close')
        return Promise.resolve()
      },
      get caughtUp() {
        return mockLive.caughtUp
      },
      report: () => {
        mockLive.asked.push('report')
        if (mockLive.answers === 'nothing') return Promise.reject(new Error('no answer'))
        return Promise.resolve(
          mockLive.answers === 'refused'
            ? null
            : { matched: true, resnapshot_required: false, entries: [] },
        )
      },
    })
  },
}))

beforeEach(async () => {
  await AsyncStorage.clear()
  mockLive.status = { connected: false, downloadError: undefined }
  mockLive.caughtUp = false
  mockLive.answers = 'matched'
  mockLive.listeners.clear()
  mockLive.asked.length = 0
  jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
  jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
  // The clock is the test's: the screen takes longer to draw than the moment a sync is given
  // before its mark is shown, and a mark that came due under a test would be drawn behind it.
  jest.useFakeTimers()
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('the sync screen’s model', () => {
  it('puts the inbox in each state F-5 requires: each case is what it is named', () => {
    // The twelve but pending and syncing, which are a row's, and absent and withdrawn, which an
    // entry leaves with its row. A device runs the app once: no state is another holder's.
    expect(inboxStates).toEqual([
      'loading',
      'empty',
      'populated',
      'error',
      'offline',
      'conflicted',
      'rejected',
      'readonly',
    ])
    for (const state of inboxStates) {
      const { facts } = inboxCases[state]
      const entries = facts.phase === 'open' ? facts.entries : undefined
      expect([state, inboxState({ ...facts, entries })]).toEqual([state, state])
    }
  })

  it('has a refusal for every code the resolver has a sentence for, and one for no code of its', () => {
    expect(rejections.map((entry) => entry.code)).toEqual(refusalCodes)
    expect(refusalCodes.slice(0, -1)).toEqual([...rejectionCodes])
  })

  it('lists everything oldest first, as a replica’s inbox does', () => {
    const answered = everything.map((entry) => entry.answered_at)
    expect(answered).toEqual([...answered].sort())
    expect(new Set(everything.map((entry) => entry.mutation_id)).size).toBe(everything.length)
  })

  it('draws a row in every state that is not in sync, and in both withdrawals', () => {
    expect(rowStates.map((state) => rowCases[state].state.kind)).toEqual([
      'pending',
      'syncing',
      'conflict',
      'rejected',
      'merged',
      'withdrawn',
      'withdrawn',
    ])
  })

  it('describes every entity its answers are of', () => {
    const described = Object.keys(describersFor((text) => text))
    for (const entry of everything) expect(described).toContain(entry.entity_type)
    for (const type of described) expect(Object.keys(registry.entities)).toContain(type)
  })

  it('is written so that the pseudo-locale can accent it: no brace, no straight apostrophe', () => {
    expect(texts().filter((text) => /[{}'#]/.test(text))).toEqual([])
    for (const text of texts()) expect(text.trim()).not.toBe('')
  })
})

const sections = [
  ['bar', ['offline', 'not-receiving', 'reading', 'settings']],
  ['inbox', inboxStates],
  ['resolvers', ['conflict', 'rejected', 'readonly']],
  ['kept', ['overridden', 'replaced']],
  ['row', rowStates],
  ['honesty', ['not-enough', 'zero']],
  ['connection', ['needed']],
] as const

/** Every cell the screen draws, in the order it draws them. */
function cells(): TestInstance[] {
  const ids = new Set(
    sections.flatMap(([section, names]) =>
      names.flatMap((state) => cellThemes.map((theme) => cellId(section, state, theme))),
    ),
  )
  return elementsOf(screen.getByTestId(`${devMarker}:sync`)).filter(
    (element) => typeof element.props.testID === 'string' && ids.has(element.props.testID),
  )
}

const cell = (section: string, state: string, theme: 'light' | 'dark' = 'light') =>
  screen.getByTestId(cellId(section, state, theme))

describe('the sync screen', () => {
  it('stands in the dev screens’ own frame, under one title, and draws every state in both themes', async () => {
    await render(<DevSync />)
    expect(screen.getByTestId(`${devMarker}:sync`)).toBeOnTheScreen()
    expect(cells().map((each): unknown => each.props.testID)).toEqual(
      sections.flatMap(([section, names]) =>
        names.flatMap((state) => cellThemes.map((theme) => cellId(section, state, theme))),
      ),
    )
  })

  it('holds to the accessibility rules, every cell of it, at the text’s own size and at twice it', async () => {
    const first = await render(<DevSync />)
    expectAccessible()
    await first.unmount()
    await render(<DevSync />, { scale: 2 })
    expectAccessible()
  })

  it('draws no sheet open, and opens one from the screen', async () => {
    await render(<DevSync />)
    expect(screen.queryByTestId('resolver')).toBeNull()
    const opener = cellId('resolvers', 'conflict', 'light')
    await userEvent.press(screen.getByTestId(`${opener}:open:version_conflict`))
    expect(screen.getByTestId('resolver:surface')).toBeOnTheScreen()
    expect(screen.getByTestId('resolver:keep-mine')).toBeOnTheScreen()
  })

  it('opens a refusal’s sheet for every code, each from its own control', async () => {
    await render(<DevSync />)
    const opener = cellId('resolvers', 'rejected', 'dark')
    for (const code of refusalCodes) {
      expect(screen.getByTestId(`${opener}:open:${code}`)).toBeOnTheScreen()
    }
    await userEvent.press(screen.getByTestId(`${opener}:open:monotonicity_violation`))
    expect(screen.getByTestId('resolver:discard')).toBeOnTheScreen()
    expect(screen.getByTestId('sync:version:1')).toBeOnTheScreen()
  })

  it('draws neither answer of a conflict, and keeps Discard, in a household that takes no writes', async () => {
    await render(<DevSync />)
    const opener = cellId('resolvers', 'readonly', 'light')
    await userEvent.press(screen.getByTestId(`${opener}:open:version_conflict`))
    expect(screen.queryByTestId('resolver:keep-mine')).toBeNull()
    expect(screen.queryByTestId('resolver:keep-theirs')).toBeNull()
    await userEvent.press(screen.getByTestId('resolver:close'))
    await userEvent.press(screen.getByTestId(`${opener}:open:forbidden`))
    expect(screen.queryByTestId('resolver:retry')).toBeNull()
    expect(screen.getByTestId('resolver:discard')).toBeOnTheScreen()
  })

  it('lets a member answer in one cell and leaves the other theme’s as it was', async () => {
    await render(<DevSync />)
    const put = (theme: 'light' | 'dark') =>
      within(cell('kept', 'overridden', theme)).queryByTestId('sync:kept:put-away')
    const away = put('light')
    if (away === null) throw new Error('no kept loser is drawn')
    await userEvent.press(away)
    // The stand-in's answer leaves its inbox; the banner is its owner's to take down, and the
    // other cell's replica was asked nothing.
    expect(put('dark')).not.toBeNull()
  })

  it('draws a withdrawn row as its sentence, with nothing that writes', async () => {
    await render(<DevSync />)
    for (const state of ['withdrawn-access', 'withdrawn-module'] as const) {
      const drawn = cell('row', state)
      expect(within(drawn).getByTestId('banner:neutral')).toBeOnTheScreen()
      expect(within(drawn).queryAllByRole('button')).toEqual([])
      expect(within(drawn).queryByRole('list')).toBeNull()
    }
  })

  it('shows a syncing row’s mark only once the sync has taken longer than a moment', async () => {
    await render(<DevSync />)
    const marks = () => within(cell('row', 'syncing')).queryAllByTestId('status:syncing')
    expect(marks()).toEqual([])
    await act(() => {
      jest.advanceTimersByTime(800)
    })
    expect(marks()).toHaveLength(1)
    // A pending one is there from the first, and neither is anything to open.
    expect(within(cell('row', 'pending')).getByTestId('status:pending')).toBeOnTheScreen()
    expect(within(cell('row', 'pending')).queryAllByRole('button')).toEqual([])
  })

  it('draws the not-enough tile with its action, beside a genuine zero', async () => {
    await render(<DevSync />)
    expect(within(cell('honesty', 'not-enough')).getByTestId('status:no_history')).toBeOnTheScreen()
    expect(within(cell('honesty', 'not-enough')).getAllByRole('button')).toHaveLength(1)
    expect(within(cell('honesty', 'zero')).queryByTestId('status:no_history')).toBeNull()
    expect(cell('honesty', 'zero')).toHaveTextContent(/0/)
  })

  it('accents its own words under the pseudo-locale, as a member’s screen would be', async () => {
    await render(<DevSync />, { locale: 'en-XA' })
    expect(screen.getByRole('header', { name: pseudolocalize('Sync UI') })).toBeOnTheScreen()
    expect(screen.queryByText('Offline bar')).toBeNull()
    expect(screen.getByText(pseudolocalize('Offline bar'))).toBeOnTheScreen()
  })
})

describe('this device’s replica, on the sync screen', () => {
  const home = householdOf({ my_role: 'owner' })
  const listed: HouseholdSummary[] = [
    { ...households.own, my_role: 'owner', entitlement: { state: 'active', can_write: true } },
  ]

  async function signedIn() {
    jest.spyOn(client, 'apiUrl').mockReturnValue(testApi)
    const api = answering({
      'GET /households': () => json(200, { items: listed }),
      [`GET /households/${home.id}`]: () => json(200, home),
    })
    await render(
      <SessionFixture api={testClient(api.transport)}>
        <DevSync />
      </SessionFixture>,
    )
    return api
  }

  /** Says to whoever listens what the sync service now says of the replica. */
  async function becomes(status: typeof mockLive.status): Promise<void> {
    mockLive.status = status
    await act(() => {
      for (const listener of mockLive.listeners) listener.statusChanged?.(status)
    })
  }

  it('says nobody is signed in where nobody is, and opens nothing', async () => {
    await render(
      <SessionFixture state={{ status: 'visitor' }}>
        <DevSync />
      </SessionFixture>,
    )
    expect(screen.getByTestId('sync:live:session:none')).toBeOnTheScreen()
    expect(mockLive.asked).toEqual([])
  })

  it('opens the real replica of the member’s first household, and says in lines a flow reads how it stands', async () => {
    await signedIn()
    await waitFor(() => {
      expect(screen.getByTestId('sync:live:replica:open')).toBeOnTheScreen()
    })
    // Its member's and its household's own file, connected as it was opened.
    expect(mockLive.asked.slice(0, 2)).toEqual([
      `open:household.${ids.member}.${home.id}.db`,
      'connect',
    ])
    // It has not tried yet: nothing is known of whether it receives.
    expect(screen.getByTestId('sync:live:receiving:unknown')).toBeOnTheScreen()
    expect(screen.getByTestId('sync:live:online:yes')).toBeOnTheScreen()
    await waitFor(() => {
      expect(screen.getByTestId('sync:live:inbox:0')).toBeOnTheScreen()
    })
    await becomes({ connected: true, downloadError: undefined })
    expect(screen.getByTestId('sync:live:receiving:yes')).toBeOnTheScreen()
    // And its household writes: what it held is sent.
    expect(mockLive.asked).toContain('resume')
  })

  it('draws the household’s own bar over it: not receiving, and offline when the device says so', async () => {
    await signedIn()
    await waitFor(() => {
      expect(screen.getByTestId('sync:live:replica:open')).toBeOnTheScreen()
    })
    const live = () => within(screen.getByTestId('sync:section:live'))
    expect(live().queryByTestId('offline-bar')).toBeNull()
    await becomes({ connected: false, downloadError: new Error('503') })
    expect(screen.getByTestId('sync:live:receiving:no')).toBeOnTheScreen()
    expect(live().getByTestId('offline-bar')).toBeOnTheScreen()
    // What the app's one listener tells the query client of the device (api/query.ts).
    await act(() => {
      onlineManager.setOnline(false)
    })
    expect(screen.getByTestId('sync:live:online:no')).toBeOnTheScreen()
    expect(live().getAllByTestId('offline-bar')).toHaveLength(1)
    await act(() => {
      onlineManager.setOnline(true)
    })
  })

  it('lets go of the replica as the screen is left', async () => {
    await signedIn()
    await waitFor(() => {
      expect(screen.getByTestId('sync:live:replica:open')).toBeOnTheScreen()
    })
    await screen.unmount()
    await waitFor(() => {
      expect(mockLive.asked).toContain('close')
    })
  })

  it('has the replica report itself when asked, once it has caught up and not before', async () => {
    await signedIn()
    await waitFor(() => {
      expect(screen.getByTestId('sync:live:reported:never')).toBeOnTheScreen()
    })
    await userEvent.press(screen.getByTestId('sync:live:report'))
    // Its stream has only just come up: a report made now would read as a copy that differs.
    expect(screen.getByTestId('sync:live:reported:waiting')).toBeOnTheScreen()
    expect(screen.getByTestId('sync:live:report')).toBeBusy()
    expect(mockLive.asked).not.toContain('report')
    mockLive.caughtUp = true
    await becomes({ connected: true, downloadError: undefined })
    await waitFor(() => {
      expect(screen.getByTestId('sync:live:reported:sent')).toBeOnTheScreen()
    })
    // Once, whatever the sync service goes on to say of itself.
    await becomes({ connected: true, downloadError: undefined })
    expect(mockLive.asked.filter((asked) => asked === 'report')).toHaveLength(1)
    expect(screen.getByTestId('sync:live:report')).not.toBeBusy()
  })

  it('says a report the server took none of, and one that got no answer, each as it is', async () => {
    mockLive.caughtUp = true
    await signedIn()
    await waitFor(() => {
      expect(screen.getByTestId('sync:live:replica:open')).toBeOnTheScreen()
    })
    mockLive.answers = 'refused'
    await userEvent.press(screen.getByTestId('sync:live:report'))
    await waitFor(() => {
      expect(screen.getByTestId('sync:live:reported:refused')).toBeOnTheScreen()
    })
    mockLive.answers = 'nothing'
    await userEvent.press(screen.getByTestId('sync:live:report'))
    await waitFor(() => {
      expect(screen.getByTestId('sync:live:reported:failed')).toBeOnTheScreen()
    })
    expect(mockLive.asked.filter((asked) => asked === 'report')).toHaveLength(2)
  })
})
