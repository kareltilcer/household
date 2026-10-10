// A household's replica as the app holds it (ADR 0019): for whom it is opened and for whom it is
// not, how long it is held, what the app says of the connection beside it, and what is read of
// it. The replica is a stand-in (standIn.ts): a test hands the provider what opens one, and no
// SQLite is opened on a developer's machine.
import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, screen, userEvent, waitFor } from '@testing-library/react-native'
import { useState } from 'react'
import { answering, json, problem, testClient } from '../api/testing.ts'
import type { Household } from '../household/data.ts'
import type { SessionState } from '../session/context.ts'
import { SessionFixture } from '../session/fixture.tsx'
import { households, ids } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import { Button } from '../ui/Button.tsx'
import { Text } from '../ui/Text.tsx'
import { useOnline } from './online.ts'
import {
  ReplicaProvider,
  useInbox,
  useReplica,
  useSync,
  type OpenReplica,
} from './ReplicaProvider.tsx'
import { standIn } from './standIn.ts'
import { conflict, registry, rejectionWith } from './sync.fixtures.ts'

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
const other: Household = { ...home, ...households.other }

const routes = {
  [`GET /households/${home.id}`]: () => json(200, home),
  [`GET /households/${other.id}`]: () => json(200, other),
}

/** What the device says of its connection, told to whoever listens as the device tells it. */
function connection(state: {
  readonly isConnected: boolean | null
  readonly isInternetReachable?: boolean
}): void {
  const hear = jest.mocked(NetInfo.addEventListener).mock.lastCall?.[0]
  // What the app reads of it is all a test says of it.
  hear?.(state as NetInfoState)
}

/** What a screen under the provider reads of it, each by a `testID`. */
function Probe() {
  const { replica, online, receiving } = useSync()
  const open = useReplica()
  const inbox = useInbox()
  const held = open === undefined ? 'none' : 'held'
  const waiting = inbox === undefined ? 'unread' : inbox.map((entry) => entry.mutation_id).join(' ')
  return (
    <>
      <Text testID="phase">{replica.phase}</Text>
      <Text testID="replica">{held}</Text>
      <Text testID="receiving">{String(receiving)}</Text>
      <Text testID="online">{String(online)}</Text>
      <Text testID="inbox">{waiting}</Text>
      {replica.phase === 'unavailable' ? (
        <Button testID="again" onPress={replica.retry}>
          {households.own.name}
        </Button>
      ) : null}
    </>
  )
}

interface DrawnOptions {
  readonly household?: string
  readonly state?: SessionState
  readonly open?: OpenReplica
  readonly answers?: Parameters<typeof answering>[0]
}

async function drawn({ household = home.id, state, open, answers = routes }: DrawnOptions = {}) {
  const stand = standIn({ registry, entries: [conflict, rejectionWith('forbidden')] })
  const opener = jest.fn<OpenReplica>(open ?? (() => Promise.resolve(stand.opened)))
  const api = answering(answers)
  const view = await render(
    <SessionFixture api={testClient(api.transport)} {...(state === undefined ? {} : { state })}>
      <ReplicaProvider household={household} open={opener}>
        <Probe />
      </ReplicaProvider>
    </SessionFixture>,
  )
  return { stand, opener, api, view }
}

const says = (id: string) => screen.getByTestId(id)

async function comesTo(id: string, text: string): Promise<void> {
  await waitFor(() => {
    expect(says(id)).toHaveTextContent(text, { exact: true })
  })
}

beforeEach(async () => {
  await AsyncStorage.clear()
  // What the test before this one left the device saying: nothing is drawn yet to hear it.
  connection({ isConnected: true })
})

describe('a household’s replica', () => {
  it('is opened for its member once the household is read as theirs, and held', async () => {
    // An address may write a household's id in either case.
    const address = home.id.toUpperCase()
    let answer: (response: Response) => void = () => undefined
    const { opener, api } = await drawn({
      household: address,
      answers: {
        [`GET /households/${address}`]: () =>
          new Promise<Response>((resolve) => {
            answer = resolve
          }),
      },
    })
    await waitFor(() => {
      expect(api.asked).toHaveLength(1)
    })
    // Not on the address's word: nothing is opened while the household is being read.
    expect(says('phase')).toHaveTextContent('opening', { exact: true })
    expect(says('replica')).toHaveTextContent('none', { exact: true })
    // And nothing waits for the member in a replica that is not open yet: it has not been read.
    expect(says('inbox')).toHaveTextContent('unread', { exact: true })
    expect(opener).not.toHaveBeenCalled()
    await act(() => {
      answer(json(200, home))
    })
    await comesTo('phase', 'open')
    expect(says('replica')).toHaveTextContent('held', { exact: true })
    // Whose it is and which household's, as the file is named: in one case.
    expect(opener.mock.calls).toEqual([[ids.member, home.id]])
  })

  it('is opened for nobody but a member', async () => {
    const { opener, api } = await drawn({ state: { status: 'visitor' } })
    await waitFor(() => {
      expect(api.sent(`GET /households/${home.id}`)).toHaveLength(1)
    })
    expect(opener).not.toHaveBeenCalled()
    expect(says('phase')).toHaveTextContent('opening', { exact: true })
  })

  it('is not opened of a household the server says is not theirs, nor of an address that names none', async () => {
    const refused = await drawn({
      answers: { [`GET /households/${home.id}`]: () => problem(404, 'not_found') },
    })
    await waitFor(() => {
      expect(refused.api.sent(`GET /households/${home.id}`)).toHaveLength(1)
    })
    expect(refused.opener).not.toHaveBeenCalled()
    await refused.view.unmount()

    const unnamed = await drawn({ household: 'settings' })
    // No household has such an address: the server is not asked, and no file is made.
    expect(unnamed.api.asked).toEqual([])
    expect(unnamed.opener).not.toHaveBeenCalled()
    expect(says('inbox')).toHaveTextContent('unread', { exact: true })
  })

  it('is let go of when its household leaves the screen', async () => {
    const { stand, view } = await drawn()
    await comesTo('phase', 'open')
    expect(stand.asked).not.toContain('close')
    await view.unmount()
    await waitFor(() => {
      expect(stand.asked).toContain('close')
    })
  })

  it('is another replica for another household: the first is let go of, and says nothing of the second', async () => {
    const [first, second] = [standIn({ registry, entries: [conflict] }), standIn({ registry })]
    const opener = jest.fn<OpenReplica>((_member, household) =>
      Promise.resolve(household === home.id ? first.opened : second.opened),
    )
    function Switching() {
      const [household, setHousehold] = useState<string>(home.id)
      return (
        <ReplicaProvider household={household} open={opener}>
          <Probe />
          <Button
            testID="switch"
            onPress={() => {
              setHousehold(other.id)
            }}
          >
            {households.other.name}
          </Button>
        </ReplicaProvider>
      )
    }
    await render(
      <SessionFixture api={testClient(answering(routes).transport)}>
        <Switching />
      </SessionFixture>,
    )
    await comesTo('inbox', conflict.mutation_id)
    await userEvent.press(says('switch'))
    // What was read of the first household's replica is not the second's.
    await comesTo('inbox', '')
    expect(opener.mock.calls.map(([, household]) => household)).toEqual([home.id, other.id])
    expect(first.asked).toContain('close')
    expect(second.asked).not.toContain('close')
  })

  it('says it could not be opened, and opens it once more when asked: a device has no page to reload', async () => {
    let fails = true
    const stand = standIn({ registry })
    const { opener } = await drawn({
      open: () => (fails ? Promise.reject(new Error('disk full')) : Promise.resolve(stand.opened)),
    })
    await comesTo('phase', 'unavailable')
    expect(says('replica')).toHaveTextContent('none', { exact: true })
    expect(opener).toHaveBeenCalledTimes(1)
    fails = false
    await userEvent.press(says('again'))
    await comesTo('phase', 'open')
    expect(opener).toHaveBeenCalledTimes(2)
  })

  it('is not left open by an opening that ended after its household had left the screen', async () => {
    let arrive: () => void = () => undefined
    const stand = standIn({ registry })
    const { view } = await drawn({
      open: () =>
        new Promise((resolve) => {
          arrive = () => {
            resolve(stand.opened)
          }
        }),
    })
    await waitFor(() => {
      expect(arrive).not.toBe(undefined)
    })
    await comesTo('phase', 'opening')
    await waitFor(() => {
      expect(stand.asked).toEqual([])
    })
    await view.unmount()
    await act(async () => {
      arrive()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(stand.asked).toEqual(['close'])
    })
  })
})

describe('whether the replica is receiving (D-105)', () => {
  it('is not known until an attempt of its has failed or succeeded', async () => {
    const { stand } = await drawn()
    await comesTo('phase', 'open')
    // Opened again, it has synced before and has not tried yet: nothing to say.
    expect(says('receiving')).toHaveTextContent('null', { exact: true })
    // Every attempt is a connecting one: that is no news either.
    await act(() => {
      stand.become({ connected: false, downloadError: undefined })
    })
    expect(says('receiving')).toHaveTextContent('null', { exact: true })
  })

  it('is false once an attempt has failed, for as long as the SDK keeps that failure, and true once connected', async () => {
    const { stand } = await drawn()
    await comesTo('phase', 'open')
    await act(() => {
      stand.become({ connected: false, downloadError: new Error('503') })
    })
    expect(says('receiving')).toHaveTextContent('false', { exact: true })
    await act(() => {
      stand.become({ connected: true, downloadError: undefined })
    })
    expect(says('receiving')).toHaveTextContent('true', { exact: true })
  })

  it('is said of no replica that is not open', async () => {
    await drawn({ open: () => Promise.reject(new Error('disk full')) })
    await comesTo('phase', 'unavailable')
    expect(says('receiving')).toHaveTextContent('null', { exact: true })
  })
})

describe('what needs the member’s attention', () => {
  it('is what the open replica lists, oldest first, and again as that changes', async () => {
    const { stand } = await drawn()
    await comesTo('inbox', `${conflict.mutation_id} ${rejectionWith('forbidden').mutation_id}`)
    await act(async () => {
      await stand.opened.replica.discard(conflict.mutation_id)
    })
    await comesTo('inbox', rejectionWith('forbidden').mutation_id)
  })
})

describe('whether the device says it has a connection', () => {
  function Online() {
    return <Text testID="online">{String(useOnline())}</Text>
  }

  it('is taken to be so until the device says otherwise, and follows what it says', async () => {
    await render(<Online />)
    expect(says('online')).toHaveTextContent('true', { exact: true })
    await act(() => {
      connection({ isConnected: false })
    })
    expect(says('online')).toHaveTextContent('false', { exact: true })
    await act(() => {
      connection({ isConnected: true })
    })
    expect(says('online')).toHaveTextContent('true', { exact: true })
  })

  it('reads a device that does not know as one that has: nothing is drawn for a state nobody reported', async () => {
    await render(<Online />)
    await act(() => {
      connection({ isConnected: false })
    })
    await act(() => {
      connection({ isConnected: null })
    })
    expect(says('online')).toHaveTextContent('true', { exact: true })
  })

  it('is wrong in one direction alone: connected, with no way to the internet, is connected', async () => {
    await render(<Online />)
    await act(() => {
      connection({ isConnected: true, isInternetReachable: false })
    })
    expect(says('online')).toHaveTextContent('true', { exact: true })
  })

  it('reaches whatever is drawn under the provider', async () => {
    await drawn()
    await comesTo('phase', 'open')
    await act(() => {
      connection({ isConnected: false })
    })
    expect(says('online')).toHaveTextContent('false', { exact: true })
  })
})
