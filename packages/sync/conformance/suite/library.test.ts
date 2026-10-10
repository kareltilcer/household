// What plan item 18 proves of @household/sync against the stack, beyond the scenarios it runs through:
// a queued write and the replica survive the database being closed and opened again before the queue
// drains (PRD 03 §2.1, nothing is lost), the first proof of it, since the spike never restarted a
// client (ADR 0001); every replica's report of itself matches what the server finds its member may
// see, at rest, across every access axis (D-125), which holds the two halves of the report to one
// hash; and a replica its member asks to download itself again does so once its queue has drained,
// losing nothing queued.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { metaKeys, type RowState } from '../../src/index.ts'
import { Admin } from '../harness/admin.ts'
import { adminDatabaseUrl, apiUrl } from '../harness/env.ts'
import { engine } from '../harness/target.ts'
import { until } from '../harness/wait.ts'
import { World } from '../harness/world.ts'
import { family, offline, online } from '../scenarios/scenario.ts'

let admin: Admin

beforeAll(() => {
  admin = new Admin(adminDatabaseUrl)
})

afterAll(async () => {
  await admin.close()
})

async function run(name: string, seed: number, body: (w: World) => Promise<void>): Promise<void> {
  const w = new World(engine, admin, seed, name)
  try {
    await body(w)
    expect(await w.violations()).toEqual([])
  } finally {
    await w.close()
  }
}

describe('@household/sync against the engine', () => {
  it('keeps a queued write and its replica through a restart before the queue drains (03 §2.1)', async () => {
    await run('library-restart', 20_001, async (w) => {
      const f = await family(w)
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      await online(w, petr)
      await offline(petr)
      const tea = await petr.create('conformance_items', { title: 'Tea' })
      await petr.update('conformance_items', f.milk, { title: 'Oat milk' })
      // The app is killed with both writes queued, and started again.
      await petr.restart()
      expect(await petr.pending()).toBe(2)
      expect(await petr.row('conformance_items', tea)).toMatchObject({ title: 'Tea' })
      expect(await petr.row('conformance_items', f.milk)).toMatchObject({ title: 'Oat milk' })
      await online(w, petr)
      const items = await w.admin.rows('conformance_items', f.home)
      expect(items.get(tea)).toMatchObject({ title: 'Tea' })
      expect(items.get(f.milk)).toMatchObject({ title: 'Oat milk' })
    })
  })

  it('reports every replica as holding what its member may see, at rest, on every access axis (D-125)', async () => {
    await run('library-report', 20_002, async (w) => {
      const f = await family(w)
      const [plan, note] = [w.rng.uuid(), w.rng.uuid()]
      // A note private to Jana, which Petr and Eva hold as its redacted projection, and a shared one.
      await w.admin.insert('conformance_notes', f.home, [
        { id: plan, visibility: 'private', owner_id: f.jana.id, title: 'Gift', body: 'A bike' },
        { id: note, visibility: 'shared', title: 'Holiday', body: 'The cottage' },
      ])
      // A conversation Jana and Petr are in, whose messages Eva, not in it, never holds.
      const talk = await w.admin.conversation(w.rng, f.home, [
        { member: f.jana, floor: 0 },
        { member: f.petr, floor: 0 },
      ])
      await w.admin.message(w.rng, f.home, talk, 1, 'Who buys bread?')
      const clients = [
        w.client({ name: 'jana', member: f.jana, household: f.home }),
        w.client({ name: 'petr', member: f.petr, household: f.home }),
        w.client({ name: 'eva', member: f.eva, household: f.home }),
      ]
      await online(w, ...clients)
      for (const c of clients) {
        const verdict = await c.replica.report()
        expect(verdict, c.name).not.toBeNull()
        expect(
          verdict?.entries.filter((e) => !e.matched).map((e) => e.entity_type),
          c.name,
        ).toEqual([])
        expect(verdict?.resnapshot_required, c.name).toBe(false)
      }
      // A replica that lost a row it should hold disagrees on that entity type, and only that one.
      const eva = clients[2]
      if (eva === undefined) throw new Error('no eva')
      await eva.db.execute('DELETE FROM ps_data__conformance_items WHERE id = ?', [f.eggs])
      const verdict = await eva.replica.report()
      expect(verdict?.entries.filter((e) => !e.matched).map((e) => e.entity_type)).toEqual([
        'conformance.item',
      ])
      // Put back, by downloading itself again, as the server would have it do were it to persist.
      await eva.replica.resnapshot()
      expect(await w.settle()).toBe(true)
    })
  })

  it('downloads itself again when its member asks, once its queue has drained, losing nothing queued (D-125)', async () => {
    await run('library-reset', 20_003, async (w) => {
      const f = await family(w)
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      await online(w, petr)
      // A row its member is looking at while the replica downloads itself again.
      const states: RowState[] = []
      const stop = petr.replica.watchRowState('conformance_items', f.milk, (s) => states.push(s))
      const stands = (kind: RowState['kind']): Promise<number | null> =>
        until(() => Promise.resolve(states.at(-1)?.kind === kind), 20_000)
      try {
        expect(await petr.replica.report()).toMatchObject({ resnapshot_required: false })
        const replica = await petr.replica.id()
        const reset = await fetch(`${apiUrl}/api/v1/households/${f.home.id}/sync/reset`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await petr.credentialNow()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ replica_id: replica }),
        })
        expect(reset.status).toBe(204)
        // Offline, a write is queued; the replica is told at its next report, and waits for it.
        await offline(petr)
        const jam = await petr.create('conformance_items', { title: 'Jam' })
        await petr.online()
        expect(
          await until(async () => (await petr.pending()) === 0, 20_000),
          'the queue drains',
        ).not.toBeNull()
        expect(await w.settle()).toBe(true)
        expect(await petr.replica.report()).toMatchObject({ resnapshot_required: true })
        // It clears itself and connects again: waited for by the mark it clears once it has, since a
        // replica downloading itself is offline to the run, which settle() would not wait for, and one
        // about to is still whole, which settle() would find settled.
        expect(
          await until(
            async () =>
              petr.isOnline && (await petr.replica.journal.meta(metaKeys.resnapshot)) === null,
            20_000,
          ),
          'the replica clears itself and connects again',
        ).not.toBeNull()
        // And fills again from PowerSync: Jam among the rows, sent before it cleared.
        expect(await w.settle({ clients: [petr] })).toBe(true)
        expect(await petr.row('conformance_items', jam)).toMatchObject({ title: 'Jam' })
        expect(await petr.replica.report()).toMatchObject({
          matched: true,
          resnapshot_required: false,
        })
        // The row its member watched left with every other and came back with the download: it was
        // never told as withdrawn, which a row leaving a replica otherwise is.
        expect(await stands('synced'), 'the watched row comes back').not.toBeNull()
        expect(states.map((s) => s.kind)).not.toContain('withdrawn')
        // Withdrawn once the download has landed, it is told so: the download no longer explains it.
        await w.admin.setGrant(f.home, f.petr, 'none')
        expect(await stands('withdrawn'), 'the watched row is withdrawn').not.toBeNull()
        expect(states.at(-1)).toEqual({ kind: 'withdrawn', reason: 'access' })
        expect(await w.settle({ clients: [petr] })).toBe(true)
      } finally {
        stop()
      }
    })
  })

  it('has caught up once a checkpoint of this connection has landed, and not on the one the visit before left (D-125)', async () => {
    await run('library-caught-up', 20_004, async (w) => {
      const f = await family(w)
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      await online(w, petr)
      const caughtUp = (): Promise<number | null> =>
        until(() => Promise.resolve(petr.replica.caughtUp), 20_000)
      expect(await caughtUp(), 'caught up on its first visit').not.toBeNull()
      // The app is closed and started again, in a household nothing changed in meanwhile: what
      // PowerSync last applied is the visit before's, and says nothing of this connection.
      await petr.restart()
      const before = petr.db.currentStatus.lastSyncedAt?.getTime()
      expect(before, 'a checkpoint the visit before left').toBeDefined()
      expect(petr.replica.caughtUp).toBe(false)
      // Each status of the new connection at which the stream is up and what PowerSync has
      // applied is still the visit before's: the replica says it has not caught up at any of them.
      const early: boolean[] = []
      const stop = petr.db.registerListener({
        statusChanged: (status) => {
          if (status.connected && status.lastSyncedAt?.getTime() === before) {
            early.push(petr.replica.caughtUp)
          }
        },
      })
      try {
        await petr.online()
        // An idle household too gets a checkpoint of this connection, and with it the replica has
        // caught up: one that never did would never report itself again.
        expect(await caughtUp(), 'caught up on its second visit').not.toBeNull()
      } finally {
        stop()
      }
      expect(petr.db.currentStatus.lastSyncedAt?.getTime()).not.toBe(before)
      expect(early).not.toContain(true)
      expect(await w.settle()).toBe(true)
    })
  })
})
