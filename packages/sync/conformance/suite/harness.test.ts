// The harness proves itself against the stand-ins (plan item 12): it drives real PowerSync clients
// through every kind of fault it scripts and finds every invariant held, and it fails a
// deliberately broken connector and a deliberately broken stream, which shows the suite can fail.
// The scenarios themselves (scenarios.test.ts) wait for the engine items 13, 14 and 18 build.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Admin } from '../harness/admin.ts'
import { adminDatabaseUrl } from '../harness/env.ts'
import type { Violation } from '../harness/invariants.ts'
import { push } from '../harness/network.ts'
import { leakyStream, standIn } from '../harness/target.ts'
import { sleep } from '../harness/wait.ts'
import { World } from '../harness/world.ts'
import { family } from '../scenarios/scenario.ts'

let admin: Admin

beforeAll(() => {
  admin = new Admin(adminDatabaseUrl)
})

afterAll(async () => {
  await admin.close()
})

async function run(name: string, seed: number, body: (w: World) => Promise<void>): Promise<void> {
  const w = new World(standIn, admin, seed, name)
  try {
    await body(w)
  } finally {
    await w.close()
  }
}

// Every run starts from the household the scenarios start from (family): Jana owns it, Petr and
// Eva contribute to the module, and three items are on the list.

const kinds = (violations: readonly Violation[]): string[] =>
  [...new Set(violations.map((v) => v.invariant))].sort()

describe('the harness, against the stand-ins', () => {
  it('drives clients through partitions, lost answers, duplicates and skew, and finds every invariant held', async () => {
    await run('control', 12_001, async (w) => {
      const f = await family(w)
      const jana = w.client({ name: 'jana', member: f.jana, household: f.home })
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      const eva = w.client({
        name: 'eva',
        member: f.eva,
        household: f.home,
        skewMs: 48 * 3_600_000,
      })
      await Promise.all([jana.online(), petr.online(), eva.online()])
      expect(await w.settle()).toBe(true)

      // Offline, both edit, check and add; Eva's clock is two days fast.
      await Promise.all([petr.offline(), eva.offline()])
      await petr.update('conformance_items', f.milk, { title: 'Oat milk' })
      await eva.update('conformance_items', f.milk, { note: 'two litres' })
      await petr.check(f.bread, true)
      await eva.check(f.bread, true)
      await eva.check(f.milk, true)
      const cheese = await petr.create('conformance_items', { title: 'Cheese' })
      await eva.remove('conformance_items', f.eggs)
      expect(await petr.pending()).toBe(3)
      expect(await eva.pending()).toBe(4)

      // Petr's first push reaches the server and its answer is lost; its retry carries the same key.
      petr.network.next('lose', push)
      await Promise.all([petr.online(), eva.online()])
      expect(await w.settle()).toBe(true)
      expect(await w.violations()).toEqual([])

      // The push whose answer was lost was sent again under its key, and answered.
      const lost = petr.network.carried.find((c) => c.fault === 'lose')
      expect(lost).toMatchObject({ status: 200 })
      expect(lost?.url).toSatisfy(push)
      const [first, again] = w.recorder.attempts.filter((a) => a.client === 'petr')
      expect(first).toMatchObject({ status: null })
      expect(again).toMatchObject({ key: first?.key, status: 200 })

      const items = await admin.rows('conformance_items', f.home)
      expect(items.get(f.milk)).toMatchObject({ title: 'Oat milk', note: 'two litres' })
      expect(items.get(cheese)).toMatchObject({ title: 'Cheese' })
      expect(items.get(f.eggs)?.['deleted_at']).not.toBeNull()
      const checks = [...(await admin.rows('conformance_item_checks', f.home)).values()]
      expect(checks.filter((c) => c['item_id'] === f.bread)).toHaveLength(1)
      // Eva's check of the milk came two days ahead of the server's clock: clamped to one day, and flagged.
      const milkCheck = checks.find((c) => c['item_id'] === f.milk)
      expect(milkCheck?.['clock_flagged']).toBe(true)
      expect(Number(milkCheck?.['checked_at'])).toBeLessThanOrEqual(Date.now() + 24 * 3_600_000)

      // Every batch delivered again is answered alike and changes nothing.
      expect(await w.replay(petr, w.answered(petr))).toEqual([])
      expect(await w.replay(eva, w.answered(eva))).toEqual([])

      // Eva loses the module while offline with writes queued: her replica empties, and both writes
      // are rejected once and never sent again.
      await eva.offline()
      await eva.update('conformance_items', f.milk, { quantity: 3 })
      const butter = await eva.create('conformance_items', { title: 'Butter' })
      await admin.setGrant(f.home, f.eva, 'none')
      await eva.online()
      expect(await w.settle()).toBe(true)
      expect(await eva.rows('conformance_items')).toEqual([])
      const refused = (await eva.outcomes()).filter((o) => o.outcome === 'rejected')
      expect(refused.map((o) => o.code)).toEqual(['not_found', 'not_found'])
      const sent = w.recorder.attempts.length
      await sleep(1_500)
      expect(w.recorder.attempts.length).toBe(sent)
      expect((await admin.rows('conformance_items', f.home)).has(butter)).toBe(false)
      expect(await w.violations()).toEqual([])
    })
  })

  it('follows each access loss the stand-in streams express, and the access coming back', async () => {
    await run('access-loss', 12_002, async (w) => {
      const f = await family(w)
      const jana = w.client({ name: 'jana', member: f.jana, household: f.home })
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await Promise.all([jana.online(), eva.online()])
      expect(await w.settle()).toBe(true)
      expect(await eva.rows('conformance_items')).toHaveLength(3)

      await admin.setGrant(f.home, f.eva, 'none')
      expect(await w.settle()).toBe(true)
      expect(await eva.rows('conformance_items')).toHaveLength(0)
      await admin.setGrant(f.home, f.eva, 'view')
      expect(await w.settle()).toBe(true)
      expect(await eva.rows('conformance_items')).toHaveLength(3)

      await admin.setEnabled(f.home, false)
      expect(await w.settle()).toBe(true)
      expect(await jana.rows('conformance_items')).toHaveLength(0)
      expect(await eva.rows('conformance_items')).toHaveLength(0)
      await admin.setEnabled(f.home, true)
      expect(await w.settle()).toBe(true)
      expect(await jana.rows('conformance_items')).toHaveLength(3)

      await admin.remove(f.home, f.eva)
      expect(await w.settle()).toBe(true)
      expect(await eva.rows('conformance_items')).toHaveLength(0)
      expect(await w.violations()).toEqual([])
    })
  })

  it('keeps a member of two households to the household each replica subscribed to', async () => {
    await run('isolation', 12_003, async (w) => {
      const f = await family(w)
      const cottage = await w.household('Chata', [
        { member: f.petr, role: 'owner' },
        { member: f.jana, role: 'member', level: 'view' },
      ])
      await admin.insert('conformance_items', cottage, [{ id: w.rng.uuid(), title: 'Firewood' }])
      const home = w.client({ name: 'petr-home', member: f.petr, household: f.home })
      const away = w.client({ name: 'petr-cottage', member: f.petr, household: cottage })
      await Promise.all([home.online(), away.online()])
      expect(await w.settle()).toBe(true)
      expect(await home.rows('conformance_items')).toHaveLength(3)
      expect(await away.rows('conformance_items')).toHaveLength(1)
      expect(await w.violations()).toEqual([])
    })
  })

  // PowerSync refuses a connection whose parameter lookups return more than 1000 results
  // (PSYNC_S2305), so a stream that looks up every household enabling the module stops syncing
  // once the database holds 250 of them across its four streams. The suite's database keeps its
  // households from run to run, and the engine's serves every household there is.
  it('keeps each stream to the caller and the household, however many households enable the module', async () => {
    await run('many-households', 12_007, async (w) => {
      await admin.fill(w.rng.fork(), 300)
      const f = await family(w)
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      const jana = w.client({ name: 'jana', member: f.jana, household: f.home })
      await Promise.all([petr.online(), jana.online()])
      expect(await w.settle()).toBe(true)
      expect(await petr.rows('conformance_items')).toHaveLength(3)
      expect(await w.violations()).toEqual([])
    })
  })

  it('renews a credential the push refuses, and sends a batch again without the mutation the edge refused', async () => {
    await run('refusals', 12_004, async (w) => {
      const f = await family(w)
      const petr = w.client({
        name: 'petr',
        member: f.petr,
        household: f.home,
        credentialTtlSeconds: 2,
      })
      await petr.online()
      expect(await w.settle()).toBe(true)
      await petr.offline()
      // Its credential lapses while it is offline.
      await sleep(2_500)
      const good = await petr.create('conformance_items', { title: 'Flour' })
      // An id the contract's Uuid refuses: the edge answers 422 and points at this mutation.
      await petr.create('conformance_items', { title: 'Sugar' }, { id: 'not-a-uuid' })
      await petr.update('conformance_items', f.milk, { quantity: 2 })
      await petr.online()
      expect(await w.settle()).toBe(true)
      expect(w.recorder.attempts.some((a) => a.status === 401)).toBe(true)
      expect(w.recorder.attempts.some((a) => a.status === 422)).toBe(true)
      expect((await petr.outcomes()).map((o) => [o.entity_id, o.outcome, o.code])).toEqual([
        ['not-a-uuid', 'rejected', 'validation_failed'],
      ])
      expect((await admin.rows('conformance_items', f.home)).get(good)).toMatchObject({
        title: 'Flour',
      })
      expect(await w.violations()).toEqual([])
    })
  })

  describe('fails', () => {
    it('a connector that retries a rejection forever', async () => {
      await run('negative-connector', 12_005, async (w) => {
        const f = await family(w)
        const eva = w.client({
          name: 'eva',
          member: f.eva,
          household: f.home,
          retryRejections: true,
        })
        await eva.online()
        expect(await w.settle()).toBe(true)
        await eva.offline()
        await eva.update('conformance_items', f.milk, { quantity: 3 })
        await admin.setGrant(f.home, f.eva, 'none')
        await eva.online()
        expect(await w.settle({ timeoutMs: 5_000 })).toBe(false)
        const found = await w.violations()
        expect(kinds(found)).toContain('terminality')
        const ends = found.filter((v) => v.invariant === 'terminality').map((v) => v.detail)
        expect(ends).toContainEqual(expect.stringMatching(/never ended: \d+ requests carried it/))
        expect(w.recorder.attempts.length).toBeGreaterThan(3)
      })
    })

    it("a stream that leaks another household's rows", async () => {
      await run('negative-stream', 12_006, async (w) => {
        const f = await family(w)
        const cottage = await w.household('Chata', [{ member: f.petr, role: 'owner' }])
        await admin.insert('conformance_items', cottage, [{ id: w.rng.uuid(), title: 'Firewood' }])
        const home = w.client({
          name: 'petr-home',
          member: f.petr,
          household: f.home,
          extraStreams: [leakyStream],
        })
        await home.online()
        expect(await w.settle({ timeoutMs: 5_000 })).toBe(false)
        const found = await w.violations()
        expect(kinds(found)).toEqual(['isolation'])
        expect(found[0]?.detail).toContain(cottage.id)
      })
    })
  })
})
