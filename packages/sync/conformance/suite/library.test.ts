// What plan item 18 proves of @household/sync against the stack, beyond the scenarios it runs through:
// a queued write and the replica survive the database being closed and opened again before the queue
// drains (PRD 03 §2.1, nothing is lost), the first proof of it, since the spike never restarted a
// client (ADR 0001); every replica's report of itself matches what the server finds its member may
// see, at rest, across every access axis (D-125), which holds the two halves of the report to one
// hash; and a replica its member asks to download itself again does so once its queue has drained,
// losing nothing queued.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
      // It clears itself and fills again from PowerSync: Jam among the rows, sent before it cleared.
      expect(await w.settle()).toBe(true)
      expect(await petr.row('conformance_items', jam)).toMatchObject({ title: 'Jam' })
      expect(await petr.replica.report()).toMatchObject({
        matched: true,
        resnapshot_required: false,
      })
    })
  })
})
