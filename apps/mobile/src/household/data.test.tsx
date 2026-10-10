// What every screen reads of a household: the household an address names, as its frame draws
// it, where the app opens, and the state of a body that is read from the server.
import { beforeEach, describe, expect, it } from '@jest/globals'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react-native'
import { answering, json, problem, testClient, unanswered } from '../api/testing.ts'
import { SessionFixture } from '../session/fixture.tsx'
import { households, ids } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import { dataStates } from '../ui/states.ts'
import { Text } from '../ui/Text.tsx'
import {
  householdKey,
  lastHousehold,
  moduleKeys,
  opening,
  readState,
  rememberHousehold,
  together,
  useHousehold,
  useHouseholds,
  useLastHousehold,
  writes,
  type Household,
  type HouseholdRead,
  type HouseholdSummary,
  type Read,
} from './data.ts'

const household: Household = {
  ...households.own,
  country: 'CZ',
  timezone: 'Europe/Prague',
  base_currency: 'CZK',
  locale: 'cs-CZ',
  my_role: 'member',
  my_grants: { shopping: 'contribute' },
  entitlement: { state: 'active', can_write: true },
}

let read: HouseholdRead | undefined
let queries: QueryClient | undefined

/** Reads the household an address names, and says what that came to. */
function Frame({ id }: { readonly id: string }) {
  const current = useHousehold(id)
  read = current
  queries = useQueryClient()
  const name = current.status === 'read' ? ` ${current.household.name}` : ''
  return <Text testID="read">{`${current.status}${name}`}</Text>
}

async function framed(id: string, routes: Parameters<typeof answering>[0]) {
  const api = answering(routes)
  await render(
    <SessionFixture api={testClient(api.transport)}>
      <Frame id={id} />
    </SessionFixture>,
  )
  return api
}

async function comesTo(text: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('read')).toHaveTextContent(text, { exact: true })
  })
}

beforeEach(async () => {
  await AsyncStorage.clear()
  read = undefined
  queries = undefined
})

describe('the household an address names', () => {
  const route = `GET /households/${ids.household}`

  it('is being read, then read, as its member reads it', async () => {
    let answer: (response: Response) => void = () => undefined
    const api = await framed(ids.household, {
      [route]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    })
    expect(screen.getByTestId('read')).toHaveTextContent('reading', { exact: true })
    await waitFor(() => {
      expect(api.sent(route)).toHaveLength(1)
    })
    await act(() => {
      answer(json(200, household))
    })
    await comesTo(`read ${households.own.name}`)
    expect(read).toMatchObject({ household: { my_grants: { shopping: 'contribute' } } })
    expect(api.sent(route)).toHaveLength(1)
  })

  it('could not be read where the server cannot be asked and nothing is kept, until it can', async () => {
    let reachable = false
    await framed(ids.household, {
      [route]: () => (reachable ? json(200, household) : unanswered()),
    })
    await comesTo('unread')
    reachable = true
    await act(() => {
      if (read?.status === 'unread') read.retry()
    })
    await comesTo(`read ${households.own.name}`)
  })

  it('is drawn as the device kept it, where the server cannot be asked', async () => {
    let reachable = true
    await framed(ids.household, {
      [route]: () => (reachable ? json(200, household) : unanswered()),
    })
    await comesTo(`read ${households.own.name}`)
    reachable = false
    await act(() => queries?.invalidateQueries({ queryKey: householdKey(ids.household) }))
    expect(screen.getByTestId('read')).toHaveTextContent(`read ${households.own.name}`, {
      exact: true,
    })
  })

  // F-17: a kept read stands in for a server that cannot be asked, never for one that answered.
  it('is not available once the server says it is not found, over whatever the device kept', async () => {
    let member = true
    await framed(ids.household, {
      [route]: () => (member ? json(200, household) : problem(404, 'not_found')),
    })
    await comesTo(`read ${households.own.name}`)
    member = false
    await act(() => queries?.invalidateQueries({ queryKey: householdKey(ids.household) }))
    await comesTo('gone')
  })

  it('stays not available while it is asked for again with nothing kept of it', async () => {
    let answer: () => Response | Promise<Response> = () => problem(404, 'not_found')
    await framed(ids.household, { [route]: () => answer() })
    await comesTo('gone')
    // Asked again, as it is each time the app is looked at again: no wait takes its place.
    let release: (response: Response) => void = () => undefined
    answer = () =>
      new Promise<Response>((resolve) => {
        release = resolve
      })
    const seen: string[] = []
    await act(async () => {
      void queries?.resetQueries({ queryKey: householdKey(ids.household) })
      await Promise.resolve()
      seen.push(read?.status ?? '')
    })
    expect(seen).toEqual(['gone'])
    expect(screen.getByTestId('read')).toHaveTextContent('gone', { exact: true })
    // Only an answer that is no `404` ends it.
    await act(() => {
      release(json(200, household))
    })
    await comesTo(`read ${households.own.name}`)
  })

  it('asks the server nothing for an address that names no household', async () => {
    const api = await framed('settings', {})
    expect(screen.getByTestId('read')).toHaveTextContent('gone', { exact: true })
    expect(api.asked).toEqual([])
  })

  it('is one household whichever case its id is written in', () => {
    expect(householdKey(ids.household.toUpperCase())).toEqual(householdKey(ids.household))
  })
})

describe('a member’s households', () => {
  it('are read in the server’s order, a suspended one among them', async () => {
    const items: HouseholdSummary[] = [
      { ...households.other, entitlement: { state: 'suspended' } },
      { ...households.own, entitlement: { state: 'active' } },
    ]
    const api = answering({ 'GET /households': () => json(200, { items }) })
    function List() {
      const list = useHouseholds()
      return <Text testID="list">{(list.data ?? []).map((each) => each.id).join(' ')}</Text>
    }
    await render(
      <SessionFixture api={testClient(api.transport)}>
        <List />
      </SessionFixture>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('list')).toHaveTextContent(`${ids.otherHousehold} ${ids.household}`)
    })
  })
})

describe('where the app opens', () => {
  const own: HouseholdSummary = { ...households.own, entitlement: { state: 'active' } }
  const other: HouseholdSummary = { ...households.other, entitlement: { state: 'grace' } }
  const suspended = (each: HouseholdSummary): HouseholdSummary => ({
    ...each,
    entitlement: { state: 'suspended' },
  })

  const rows: [
    name: string,
    list: HouseholdSummary[],
    last: string | null,
    opens: string | undefined,
  ][] = [
    ['the first household, where the device remembers none', [own, other], null, ids.household],
    ['the one they were last in', [own, other], ids.otherHousehold, ids.otherHousehold],
    [
      'the one they were last in, in whichever case',
      [own, other],
      ids.otherHousehold.toUpperCase(),
      ids.otherHousehold,
    ],
    ['the first, where the last is theirs no longer', [own], ids.otherHousehold, ids.household],
    [
      'one that opens, passing over a suspended first',
      [suspended(own), other],
      null,
      ids.otherHousehold,
    ],
    [
      'one that opens, though the last was suspended since',
      [suspended(own), other],
      ids.household,
      ids.otherHousehold,
    ],
    [
      'the first suspended one, for a member in none that opens',
      [suspended(own), suspended(other)],
      ids.otherHousehold,
      ids.household,
    ],
    ['nowhere, for a member in none', [], ids.household, undefined],
  ]

  it.each(rows)('is %s', (_name, list, last, opens) => {
    expect(opening(list, last)?.id).toBe(opens)
  })

  it('is remembered for each member, on this device', async () => {
    expect(await lastHousehold(ids.member)).toBeNull()
    rememberHousehold(ids.member, ids.household)
    rememberHousehold(ids.otherMember.toUpperCase(), ids.otherHousehold)
    expect(await lastHousehold(ids.member.toUpperCase())).toBe(ids.household)
    expect(await lastHousehold(ids.otherMember)).toBe(ids.otherHousehold)
  })

  it('is asked of the device before the app opens anywhere', async () => {
    rememberHousehold(ids.member, ids.household)
    function Last() {
      const last = useLastHousehold(ids.member)
      const said = last.read ? String(last.household) : 'asking'
      return <Text testID="last">{said}</Text>
    }
    await render(<Last />)
    await waitFor(() => {
      expect(screen.getByTestId('last')).toHaveTextContent(ids.household)
    })
  })
})

describe('the state of a body that is read from the server', () => {
  const none = { data: undefined, isError: false, fetchStatus: 'fetching' } as const

  const rows: [name: string, read: Read, online: boolean, empty: boolean, state: string][] = [
    ['loading while it is asked for the first time', none, true, false, 'loading'],
    [
      'could not be read where it failed with nothing kept',
      { ...none, isError: true, fetchStatus: 'idle' },
      true,
      false,
      'error',
    ],
    // Never a skeleton: a read that waits for a connection could not be made, to a member.
    [
      'could not be read where it waits for a connection with nothing kept',
      { ...none, fetchStatus: 'paused' },
      false,
      false,
      'error',
    ],
    [
      'populated with what was read',
      { data: [1], isError: false, fetchStatus: 'idle' },
      true,
      false,
      'populated',
    ],
    [
      'empty where what was read holds nothing',
      { data: [], isError: false, fetchStatus: 'idle' },
      true,
      true,
      'empty',
    ],
    [
      'offline where what is drawn is as the device kept it',
      { data: [1], isError: false, fetchStatus: 'paused' },
      false,
      false,
      'offline',
    ],
    [
      'what was kept, where it could not be read again',
      { data: [1], isError: true, fetchStatus: 'idle' },
      true,
      false,
      'populated',
    ],
  ]

  it.each(rows)('is %s', (_name, read, online, empty, state) => {
    expect(readState(read, online, empty)).toBe(state)
    expect(dataStates).toContain(state)
  })

  it('is one read for several that one body is drawn from: unread until each is read', () => {
    const kept: Read = { data: 1, isError: true, fetchStatus: 'idle' }
    expect(together([kept, kept]).data).toBeDefined()
    expect(together([kept, none])).toEqual({ data: undefined, isError: false, fetchStatus: 'idle' })
    expect(together([kept, { ...none, isError: true }])).toMatchObject({
      data: undefined,
      isError: true,
    })
    expect(together([kept, { ...none, fetchStatus: 'paused' }])).toMatchObject({
      fetchStatus: 'paused',
    })
    // One that was read and could not be read again says nothing: what was kept is drawn.
    expect(readState(together([kept, kept]), true)).toBe('populated')
  })
})

describe('a household', () => {
  it('takes writes unless its entitlement says it does not', () => {
    expect(writes({})).toBe(true)
    expect(writes({ entitlement: { state: 'active', can_write: true } })).toBe(true)
    expect(writes({ entitlement: { state: 'read_only', can_write: false } })).toBe(false)
  })

  it('has its modules in the contract’s order, every one once', () => {
    expect(new Set(moduleKeys).size).toBe(moduleKeys.length)
    expect(moduleKeys[0]).toBe('dashboard')
    expect(moduleKeys.at(-1)).toBe('admin')
  })
})
