// A row's state as a module's screen reads it (F-8, F-9, D-84): the mark each state carries, the
// sentence of each withdrawal, the time a sync is counted from, and the refusal of a write that
// needs a connection, which a screen recognises without the library.
import { catalogs } from '@household/i18n'
import { translatorOver } from '@household/i18n/lazy'
import { NeedsConnection, type Replica, type RowState } from '@household/sync'
import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { conflict, overriddenMerge, registry, rejectionWith } from '../dev/sync/fixtures.ts'
import { standIn, StandInNeedsConnection, type StandIn } from '../dev/sync/standIn.ts'
import { opened } from './open.ts'
import { SyncFixture, type Sync } from './ReplicaProvider.tsx'
import {
  markOf,
  needsConnectionText,
  useNeedsConnection,
  useRowState,
  withdrawnText,
} from './rowState.ts'

const words = {
  access: 'Your access to this changed, so it was removed from this device.',
  module:
    'This module was turned off for the household. Nothing was deleted — it comes back if it is turned on again.',
  connection: 'This needs a connection. Nothing was changed. Try again when you’re back online.',
} as const

const t = translatorOver('en', catalogs.en)

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
    for (const [state, mark] of marks) expect(markOf(state), state.kind).toBe(mark)
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
    for (const state of none) expect(markOf(state), state.kind).toBeUndefined()
    expect(markOf(undefined)).toBeUndefined()
  })
})

describe('a withdrawn row’s sentence', () => {
  it('says which of the two causes it was', () => {
    expect(withdrawnText(t, 'access')).toEqual({ text: words.access })
    expect(withdrawnText(t, 'module')).toEqual({ text: words.module })
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
  return (
    <output data-kind={state?.kind ?? 'unknown'} data-since={since === undefined ? '' : since} />
  )
}

function over(stand: StandIn, ui: ReactNode, more: Partial<Sync> = {}) {
  const sync: Sync = {
    replica: { phase: 'open', ...stand.opened },
    online: true,
    receiving: true,
    ...more,
  }
  return render(<SyncFixture value={sync}>{ui}</SyncFixture>)
}

describe('a row’s state', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const probe = () => screen.getByRole('status')

  it('is what the replica reports, now and as it moves', () => {
    const stand = standIn({ registry })
    over(stand, <Probe table="settlements" id="a" />)
    expect(probe()).toHaveAttribute('data-kind', 'absent')
    act(() => {
      stand.move('settlements', 'a', { kind: 'pending', op: 'update', held: null })
    })
    expect(probe()).toHaveAttribute('data-kind', 'pending')
    act(() => {
      stand.move('settlements', 'a', { kind: 'withdrawn', reason: 'module' })
    })
    expect(probe()).toHaveAttribute('data-kind', 'withdrawn')
  })

  it('dates a sync from when the replica told of it, and keeps the date while it goes on', () => {
    vi.useFakeTimers({ now: new Date('2026-03-04T10:00:00Z') })
    const began = Date.now()
    const stand = standIn({ registry })
    over(stand, <Probe table="settlements" id="a" />)
    expect(probe()).toHaveAttribute('data-since', '')
    act(() => {
      stand.move('settlements', 'a', { kind: 'syncing', op: 'update' })
    })
    expect(probe()).toHaveAttribute('data-since', String(began))
    // Told of again a second later, its write another: the sync began when it began.
    vi.setSystemTime(began + 1000)
    act(() => {
      stand.move('settlements', 'a', { kind: 'syncing', op: 'delete' })
    })
    expect(probe()).toHaveAttribute('data-since', String(began))
    act(() => {
      stand.move('settlements', 'a', { kind: 'synced', deleted: false })
    })
    expect(probe()).toHaveAttribute('data-since', '')
    // And a sync after that one is dated anew.
    act(() => {
      stand.move('settlements', 'a', { kind: 'syncing', op: 'update' })
    })
    expect(probe()).toHaveAttribute('data-since', String(began + 1000))
  })

  it('says nothing of a row another row’s watch read', () => {
    const stand = standIn({
      registry,
      rows: { 'settlements/a': { kind: 'pending', op: 'update', held: null } },
    })
    const { rerender } = over(stand, <Probe table="settlements" id="a" />)
    expect(probe()).toHaveAttribute('data-kind', 'pending')
    const sync: Sync = {
      replica: { phase: 'open', ...stand.opened },
      online: true,
      receiving: true,
    }
    rerender(
      <SyncFixture value={sync}>
        <Probe table="settlements" id="b" />
      </SyncFixture>,
    )
    expect(probe()).toHaveAttribute('data-kind', 'absent')
  })

  it('is unknown in a tab that does not hold the household’s replica', () => {
    render(
      <SyncFixture value={{ replica: { phase: 'elsewhere' }, online: true, receiving: null }}>
        <Probe table="settlements" id="a" />
      </SyncFixture>,
    )
    expect(probe()).toHaveAttribute('data-kind', 'unknown')
  })
})

describe('a write that needs a connection', () => {
  function Asks({ error }: { readonly error: unknown }) {
    const needsConnection = useNeedsConnection()
    return <output data-needs={String(needsConnection(error))} />
  }

  it('is recognised by a screen through the replica it holds, with nothing of the library’s', () => {
    const stand = standIn({ registry })
    const { rerender } = over(stand, <Asks error={new StandInNeedsConnection()} />)
    expect(screen.getByRole('status')).toHaveAttribute('data-needs', 'true')
    const sync: Sync = {
      replica: { phase: 'open', ...stand.opened },
      online: true,
      receiving: true,
    }
    rerender(
      <SyncFixture value={sync}>
        <Asks error={new Error('the database is closed')} />
      </SyncFixture>,
    )
    expect(screen.getByRole('status')).toHaveAttribute('data-needs', 'false')
  })

  it('is no error’s in a tab that holds no replica, which made no write', () => {
    render(
      <SyncFixture value={{ replica: { phase: 'opening' }, online: true, receiving: null }}>
        <Asks error={new StandInNeedsConnection()} />
      </SyncFixture>,
    )
    expect(screen.getByRole('status')).toHaveAttribute('data-needs', 'false')
  })

  it('is the library’s own refusal, as an opened replica tells it', () => {
    // The replica itself is not asked: what tells the refusal is the library's class.
    const { needsConnection } = opened({} as Replica)
    expect(needsConnection?.(new NeedsConnection('admin.membership'))).toBe(true)
    expect(needsConnection?.(new Error('admin.membership'))).toBe(false)
    expect(needsConnection?.(undefined)).toBe(false)
  })

  it('says so in a sentence, and that nothing was changed', () => {
    expect(needsConnectionText(t)).toBe(words.connection)
  })
})
