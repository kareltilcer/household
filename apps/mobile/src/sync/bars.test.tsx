// The one bar above a household's screens (A-37, D-105, D-170): which sentence it says where it
// stands, when it is said aloud, and that the replica is told when its household writes again.
// The web's table, on a device (apps/web/src/shell/household.test.tsx).
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { catalogs } from '@household/i18n'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react-native'
import { useState } from 'react'
import { inHousehold } from '../app/paths.ts'
import { answering, json, testClient } from '../api/testing.ts'
import type { Household } from '../household/data.ts'
import { SessionFixture } from '../session/fixture.tsx'
import { HouseholdFrame } from '../shell/HouseholdFrame.tsx'
import { expectAccessible } from '../test/a11y.ts'
import { householdOf, households, summaryOf } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import * as announcer from '../ui/announce.ts'
import { Text } from '../ui/Text.tsx'
import { changesAtOnce, HouseholdBars } from './HouseholdBars.tsx'
import { ReplicaProvider, SyncFixture, type Sync } from './ReplicaProvider.tsx'
import { standIn, type StandIn } from './standIn.ts'
import { registry } from './sync.fixtures.ts'

/** Where the router says the app is, as a test moves it. */
const mockAt = { path: '/' }

// The router's own: where the app is, and what the frame's other parts ask of it.
jest.mock('expo-router', () => ({
  usePathname: () => mockAt.path,
  useIsFocused: () => true,
  router: { navigate: jest.fn(), replace: jest.fn() },
  Redirect: () => null,
}))

const en = catalogs.en
const id = households.own.id

function home(canWrite: boolean): Household {
  return canWrite
    ? householdOf()
    : householdOf({ entitlement: { state: 'read_only', can_write: false } })
}

interface Stands {
  readonly online: boolean
  readonly receiving: boolean | null
}

/** Moves what the bars are drawn by, as the device and the sync service move it. */
let move: (next: Partial<Stands>) => void = () => undefined

interface DrawnProps {
  readonly stand: StandIn
  readonly first: Stands
  /** The household, as its frame read it and hands it to the bars (shell/HouseholdFrame.tsx). */
  readonly household: Household
}

function Drawn({ stand, first, household }: DrawnProps) {
  const [stands, setStands] = useState(first)
  move = (next) => {
    setStands((was) => ({ ...was, ...next }))
  }
  const sync: Sync = { replica: { phase: 'open', ...stand.opened }, ...stands }
  return (
    <SyncFixture value={sync}>
      <HouseholdBars household={household} />
      <Text testID="under">{households.own.name}</Text>
    </SyncFixture>
  )
}

interface BarsOptions extends Partial<Stands> {
  readonly writes?: boolean
  readonly at?: string
}

async function bars({
  online = true,
  receiving = true,
  writes = true,
  at = inHousehold.home(id),
}: BarsOptions = {}) {
  mockAt.path = at
  const stand = standIn({ registry })
  await render(<Drawn stand={stand} first={{ online, receiving }} household={home(writes)} />)
  return { stand }
}

const bar = () => screen.queryByTestId('offline-bar')

async function says(sentence: string): Promise<void> {
  await waitFor(() => {
    expect(bar()).toHaveTextContent(sentence, { exact: true })
  })
}

beforeEach(async () => {
  await AsyncStorage.clear()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the bar above a household’s screens', () => {
  it('is absent in sync and online: the absence of an indicator is the indicator', async () => {
    await bars()
    expect(bar()).toBeNull()
    // Nor while it is not yet known whether the replica is receiving.
    await act(() => {
      move({ receiving: null })
    })
    expect(bar()).toBeNull()
    expect(screen.getByTestId('under')).toBeOnTheScreen()
  })

  it('says offline, and that changes are saved and will sync, in the product’s own words', async () => {
    await bars({ online: false })
    await says(en['ui.offline.bar'])
    expect(en['ui.offline.bar']).toBe('Offline — changes are saved and will sync')
    // Said three ways: its glyph, its word and the sentence.
    expect(screen.getByTestId('offline-bar')).toHaveProp('accessible', true)
    expectAccessible()
  })

  it('promises nothing of a change in a household that takes none', async () => {
    await bars({ online: false, writes: false })
    await says(en['device.sync.offline.reading'])
    expect(en['device.sync.offline.reading']).not.toMatch(/saved|sync/)
  })

  it('says a change needs a connection where a change is made on the server or not at all', async () => {
    await bars({ online: false, at: `${inHousehold.home(id)}/settings/members` })
    await says(en['device.sync.offline.settings'])
    expect(en['device.sync.offline.settings']).toMatch(/needs a connection/)
  })

  it('says that the household’s changes are not arriving, with the device online and the sync service away', async () => {
    await bars({ receiving: false })
    await says(en['sync.not_receiving'])
    // What the member changes is still kept and sent: the sentence says so.
    expect(en['sync.not_receiving']).toMatch(/still saved and sent/)
  })

  it('says only that they are not arriving in a household that takes no writes', async () => {
    await bars({ receiving: false, writes: false })
    await says(en['shell.not_receiving.reading'])
  })

  it('is the offline sentence where both hold: no connection is why nothing arrives', async () => {
    await bars({ online: false, receiving: false })
    await says(en['ui.offline.bar'])
  })

  it('is one bar whose sentence changes where it stands', async () => {
    await bars({ online: false })
    await says(en['ui.offline.bar'])
    await act(() => {
      move({ online: true, receiving: false })
    })
    await says(en['sync.not_receiving'])
    expect(screen.getAllByTestId('offline-bar')).toHaveLength(1)
    await act(() => {
      move({ receiving: true })
    })
    expect(bar()).toBeNull()
  })

  // The household's own answer is one reading (household/data.ts): the replica's provider and
  // the frame ask for it together, and the bars are handed what the frame read. And the
  // device's word for its connection reaches them through the provider, from the one place
  // that hears it (api/query.ts).
  it('is drawn by the household’s frame from what it read, which was asked for once, and by the device’s own word', async () => {
    mockAt.path = inHousehold.home(id)
    const route = `GET /households/${id}`
    const api = answering({
      [route]: () => json(200, home(true)),
      'GET /households': () => json(200, { items: [summaryOf(households.own)] }),
    })
    const stand = standIn({ registry })
    await render(
      <SessionFixture api={testClient(api.transport)}>
        <ReplicaProvider household={id} open={() => Promise.resolve(stand.opened)}>
          <HouseholdFrame household={id}>
            <Text testID="under">{households.own.name}</Text>
          </HouseholdFrame>
        </ReplicaProvider>
      </SessionFixture>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('under')).toBeOnTheScreen()
    })
    // Long enough for a second request to have left, had one been made.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(api.sent(route)).toHaveLength(1)
    expect(bar()).toBeNull()
    try {
      await act(() => {
        onlineManager.setOnline(false)
      })
      await says(en['ui.offline.bar'])
    } finally {
      await act(() => {
        onlineManager.setOnline(true)
      })
    }
    await waitFor(() => {
      expect(bar()).toBeNull()
    })
  })
})

describe('the screens whose changes are made at once', () => {
  it('are the household’s settings, every screen of them, and leaving it', () => {
    const base = inHousehold.home(id)
    expect(changesAtOnce(`${base}/settings`, id)).toBe(true)
    expect(changesAtOnce(`${base}/settings/members/x`, id)).toBe(true)
    expect(changesAtOnce(`${base}/leave`, id)).toBe(true)
    // In whatever case the address writes the household's id.
    expect(changesAtOnce(`${base.toUpperCase()}/SETTINGS`, id)).toBe(true)
  })

  it('are no other: a module’s screens, the inbox, and an address that only begins alike', () => {
    const base = inHousehold.home(id)
    for (const path of [base, inHousehold.sync(id), inHousehold.more(id), `${base}/settingsx`]) {
      expect([path, changesAtOnce(path, id)]).toEqual([path, false])
    }
    expect(changesAtOnce(`${inHousehold.home(households.other.id)}/settings`, id)).toBe(false)
  })
})

describe('what the bar says aloud', () => {
  it('is nothing for a bar that stood there when the household was opened: it is read in its place', async () => {
    const announce = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
    await bars({ online: false })
    await says(en['ui.offline.bar'])
    expect(announce).not.toHaveBeenCalled()
  })

  it('is the sentence of a bar that arrives, said once, and politely', async () => {
    const announce = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
    const urgent = jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
    await bars()
    await act(() => {
      move({ online: false })
    })
    await says(en['ui.offline.bar'])
    expect(announce.mock.calls).toEqual([[en['ui.offline.bar']]])
    // Offline is no failure, and is not said as one.
    expect(urgent).not.toHaveBeenCalled()
  })

  it('is the new sentence where one takes another’s place, and the bar’s again when it comes back', async () => {
    const announce = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
    await bars({ online: false })
    await says(en['ui.offline.bar'])
    await act(() => {
      move({ online: true, receiving: false })
    })
    await says(en['sync.not_receiving'])
    expect(announce.mock.calls).toEqual([[en['sync.not_receiving']]])
    await act(() => {
      move({ receiving: true })
    })
    await act(() => {
      move({ online: false })
    })
    await says(en['ui.offline.bar'])
    expect(announce.mock.calls).toEqual([[en['sync.not_receiving']], [en['ui.offline.bar']]])
  })
})

describe('a household that writes again', () => {
  it('has its replica told, so that what was held for it is sent', async () => {
    const { stand } = await bars()
    await waitFor(() => {
      expect(stand.asked).toEqual(['resume'])
    })
  })

  it('tells a replica nothing while the household takes no writes', async () => {
    const { stand } = await bars({ writes: false, online: false })
    await says(en['device.sync.offline.reading'])
    expect(stand.asked).toEqual([])
  })
})
