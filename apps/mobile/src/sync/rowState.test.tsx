// A row's state as a module's screen reads it (F-8, F-9, D-84): the mark each state carries, the
// sentence of each withdrawal, the time a sync is counted from, and the refusal of a write that
// needs a connection, which a screen recognises without the library. The web's cases, on a
// device (apps/web/src/sync/rowState.test.tsx).
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { catalogs, createTranslator } from '@household/i18n'
import type { RowState } from '@household/sync'
import { act, screen, userEvent } from '@testing-library/react-native'
import { useState, type ReactNode } from 'react'
import { render } from '../test/render.tsx'
import { words as given } from '../test/fixtures.ts'
import { Button } from '../ui/Button.tsx'
import { Text } from '../ui/Text.tsx'
import { SyncFixture, type Sync } from './ReplicaProvider.tsx'
import {
  markOf,
  needsConnectionText,
  useNeedsConnection,
  useRowState,
  withdrawnText,
} from './rowState.ts'
import { standIn, StandInNeedsConnection, type StandIn } from './standIn.ts'
import { conflict, overriddenMerge, registry, rejectionWith } from './sync.fixtures.ts'

const en = catalogs.en
const t = createTranslator('en')

describe('the mark a row carries', () => {
  it('is its state’s, for a write that is not in sync yet', () => {
    const marks: readonly (readonly [RowState, ReturnType<typeof markOf>])[] = [
      [{ kind: 'pending', op: 'update', held: null }, 'pending'],
      // Held for a household that does not write: still a write that waits.
      [{ kind: 'pending', op: 'create', held: 'entitlement' }, 'pending'],
      [{ kind: 'syncing', op: 'update' }, 'syncing'],
      [{ kind: 'conflict', outcome: conflict }, 'conflict'],
      [{ kind: 'rejected', outcome: rejectionWith('forbidden') }, 'rejected'],
    ]
    for (const [state, mark] of marks)
      expect([state.kind, markOf(state)]).toEqual([state.kind, mark])
  })

  it('is none for a row in sync, and for every state that is no write under way', () => {
    const none: readonly RowState[] = [
      { kind: 'synced', deleted: false },
      { kind: 'synced', deleted: true },
      // A merge is a banner, and no mark.
      { kind: 'merged', outcome: overriddenMerge },
      { kind: 'withdrawn', reason: 'access' },
      { kind: 'absent' },
    ]
    for (const state of none) expect([state.kind, markOf(state)]).toEqual([state.kind, undefined])
    expect(markOf(undefined)).toBeUndefined()
  })
})

describe('a withdrawn row’s sentence', () => {
  it('says which of the two causes it was', () => {
    expect(withdrawnText(t, 'access')).toEqual({ text: en['sync.withdrawn.access'] })
    expect(withdrawnText(t, 'module')).toEqual({ text: en['sync.withdrawn.module'] })
    expect(en['sync.withdrawn.access']).not.toBe(en['sync.withdrawn.module'])
    // The device it left is said to be this one, which on a phone it is.
    expect(en['sync.withdrawn.access']).toContain('this device')
  })

  it('names nothing that was withdrawn, and does not say it was recalled everywhere', () => {
    for (const reason of ['access', 'module'] as const) {
      const { text } = withdrawnText(t, reason)
      expect(text).not.toMatch(/everywhere|every device|all (your )?devices/i)
      // No module's name, and no entity's: the sentence is the same whatever left.
      for (const name of ['Finance', 'Shopping', 'Notes', 'settlement']) {
        expect(text).not.toContain(name)
      }
    }
  })
})

/** What a module's screen would draw of a row: its state, and when its sync began. */
function Probe({ table, id }: { readonly table: string; readonly id: string }) {
  const { state, since } = useRowState(table, id)
  const kind = state?.kind ?? 'unknown'
  const dated = since === undefined ? 'undated' : String(since)
  return (
    <>
      <Text testID="kind">{kind}</Text>
      <Text testID="since">{dated}</Text>
    </>
  )
}

function over(stand: StandIn, ui: ReactNode) {
  const sync: Sync = { replica: { phase: 'open', ...stand.opened }, online: true, receiving: true }
  return render(<SyncFixture value={sync}>{ui}</SyncFixture>)
}

const kind = () => screen.getByTestId('kind')
const since = () => screen.getByTestId('since')

describe('a row’s state', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('is what the replica reports, now and as it moves', async () => {
    const stand = standIn({ registry })
    await over(stand, <Probe table="settlements" id="a" />)
    expect(kind()).toHaveTextContent('absent', { exact: true })
    await act(() => {
      stand.move('settlements', 'a', { kind: 'pending', op: 'update', held: null })
    })
    expect(kind()).toHaveTextContent('pending', { exact: true })
    await act(() => {
      stand.move('settlements', 'a', { kind: 'withdrawn', reason: 'module' })
    })
    expect(kind()).toHaveTextContent('withdrawn', { exact: true })
  })

  it('dates a sync from when the replica told of it, and keeps the date while it goes on', async () => {
    const stand = standIn({ registry })
    await over(stand, <Probe table="settlements" id="a" />)
    expect(since()).toHaveTextContent('undated', { exact: true })
    const began = Date.parse('2026-03-04T10:00:00Z')
    const clock = jest.spyOn(Date, 'now').mockReturnValue(began)
    await act(() => {
      stand.move('settlements', 'a', { kind: 'syncing', op: 'update' })
    })
    expect(since()).toHaveTextContent(String(began), { exact: true })
    // Told of again a second later, its write another: the sync began when it began.
    clock.mockReturnValue(began + 1000)
    await act(() => {
      stand.move('settlements', 'a', { kind: 'syncing', op: 'delete' })
    })
    expect(since()).toHaveTextContent(String(began), { exact: true })
    await act(() => {
      stand.move('settlements', 'a', { kind: 'synced', deleted: false })
    })
    expect(since()).toHaveTextContent('undated', { exact: true })
    // And a sync after that one is dated anew.
    await act(() => {
      stand.move('settlements', 'a', { kind: 'syncing', op: 'update' })
    })
    expect(since()).toHaveTextContent(String(began + 1000), { exact: true })
    clock.mockRestore()
  })

  it('says nothing of a row another row’s watch read', async () => {
    const stand = standIn({
      registry,
      rows: { 'settlements/a': { kind: 'pending', op: 'update', held: null } },
    })
    function Either() {
      const [id, setId] = useState('a')
      return (
        <>
          <Probe table="settlements" id={id} />
          <Button
            onPress={() => {
              setId('b')
            }}
          >
            {given.open}
          </Button>
        </>
      )
    }
    await over(stand, <Either />)
    expect(kind()).toHaveTextContent('pending', { exact: true })
    await userEvent.press(screen.getByRole('button', { name: given.open }))
    expect(kind()).toHaveTextContent('absent', { exact: true })
  })

  it('is unknown while the household’s replica is not open', async () => {
    await render(
      <SyncFixture value={{ replica: { phase: 'opening' }, online: true, receiving: null }}>
        <Probe table="settlements" id="a" />
      </SyncFixture>,
    )
    expect(kind()).toHaveTextContent('unknown', { exact: true })
  })
})

describe('a write that needs a connection', () => {
  function Asks({ error }: { readonly error: unknown }) {
    const needsConnection = useNeedsConnection()
    return <Text testID="needs">{String(needsConnection(error))}</Text>
  }

  it('is recognised by a screen through the replica it holds, with nothing of the library’s', async () => {
    const stand = standIn({ registry })
    const view = await over(stand, <Asks error={new StandInNeedsConnection()} />)
    expect(screen.getByTestId('needs')).toHaveTextContent('true', { exact: true })
    await view.unmount()
    await over(stand, <Asks error={new Error('the database is closed')} />)
    expect(screen.getByTestId('needs')).toHaveTextContent('false', { exact: true })
  })

  it('is no error’s where no replica is open, which made no write', async () => {
    await render(
      <SyncFixture value={{ replica: { phase: 'opening' }, online: true, receiving: null }}>
        <Asks error={new StandInNeedsConnection()} />
      </SyncFixture>,
    )
    expect(screen.getByTestId('needs')).toHaveTextContent('false', { exact: true })
  })

  it('says so in a sentence, and that nothing was changed', () => {
    expect(needsConnectionText(t)).toBe(en['sync.needs_connection'])
    expect(needsConnectionText(t)).toMatch(/Nothing was changed/)
  })
})
