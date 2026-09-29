// PRD 10 §4's scenarios about how mutations reach the server: 6, 8, 9, 10 and 15.

import { expect } from 'vitest'
import { push } from '../harness/network.ts'
import {
  answersOf,
  eventsAbout,
  family,
  offline,
  online,
  staysQuiet,
  type Scenario,
} from './scenario.ts'

export const delivery: readonly Scenario[] = [
  {
    key: '6',
    title: 'Client offline past the compaction horizon',
    expected:
      "Under D-93: the client catches up from PowerSync's compacted buckets, downloading again any bucket whose " +
      'checksum no longer matches, and converges with its queue intact',
    enabledBy: 14,
    needs: ['conformance.item'],
    capabilities: ['compact'],
    async run(w) {
      const f = await family(w)
      const jana = w.client({ name: 'jana', member: f.jana, household: f.home })
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      await online(w, jana, petr)
      await offline(petr)
      const queued = await petr.create('conformance_items', { title: 'Coffee' })
      // While Petr is away, every item is rewritten many times and a new one comes and goes, so
      // that compaction supersedes operations his replica last saw.
      for (let i = 0; i < 20; i++) {
        for (const item of [f.milk, f.bread, f.eggs])
          await jana.update('conformance_items', item, { note: `round ${String(i)}` })
      }
      const gone = await jana.create('conformance_items', { title: 'Tea' })
      await jana.remove('conformance_items', gone)
      expect(await w.settle({ clients: [jana] })).toBe(true)
      await w.target.compact?.()
      await online(w, petr)

      expect((await w.admin.rows('conformance_items', f.home)).get(queued)).toMatchObject({
        title: 'Coffee',
      })
      expect(await petr.row('conformance_items', f.milk)).toMatchObject({ note: 'round 19' })
    },
  },
  {
    key: '8',
    title: 'Batch where mutation 3 fails',
    expected:
      '1–2 apply, 3 rejected, 4 and on deferred; the retry resolves: the deferred ones are replayed once the queue has ' +
      'drained, after a later write to the same row queued behind them (PRD 10 §4, D-93), and each ends once',
    enabledBy: 13,
    needs: ['conformance.item'],
    async run(w) {
      const f = await family(w)
      // Five mutations to a batch, so that the sixth write is sent in a batch of its own.
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home, maxBatch: 5 })
      await online(w, petr)
      await offline(petr)
      const rice = await petr.create('conformance_items', { title: 'Rice' })
      await petr.update('conformance_items', rice, { title: 'Brown rice' })
      // Out of the item's range (1 to 999): the server refuses it.
      await petr.update('conformance_items', rice, { quantity: 0 })
      await petr.update('conformance_items', rice, { note: 'organic' })
      await petr.update('conformance_items', rice, { title: 'Basmati' })
      // A later write to the same row, queued behind the two the server defers: they replay after
      // it, the one reorder of a client's own uploads (PRD 10 §4).
      await petr.update('conformance_items', rice, { quantity: 2 })
      await online(w, petr)

      const outcomes = answersOf(w, petr).map((a) => a.outcome)
      expect(outcomes.slice(0, 5)).toEqual([
        'applied',
        'applied',
        'rejected',
        'deferred',
        'deferred',
      ])
      expect(outcomes.slice(5)).toEqual(['applied', 'applied', 'applied'])
      expect(answersOf(w, petr)[2]?.code).toBe('validation_failed')
      // Petr's outcomes table keeps the three answers that were not applied, in the order they came.
      expect((await petr.outcomes()).map((o) => o.outcome)).toEqual([
        'rejected',
        'deferred',
        'deferred',
      ])
      // The queue's two batches, then the replay of the deferred ones.
      expect(
        w.recorder.attempts
          .filter((a) => a.client === 'petr' && a.status === 200)
          .map((a) => a.source),
      ).toEqual(['queue', 'queue', 'deferred'])
      expect((await w.admin.rows('conformance_items', f.home)).get(rice)).toMatchObject({
        title: 'Basmati',
        note: 'organic',
        quantity: 2,
      })
      expect(await petr.held()).toEqual([])
    },
  },
  {
    key: '9',
    title: 'Whole batch delivered twice (network retry)',
    expected:
      'Identical result; no duplicates: an answer lost in flight is retried under its key, and every batch delivered ' +
      'again under a fresh key is answered from per-mutation idempotency (FR-SY5) and changes nothing',
    enabledBy: 13,
    needs: ['conformance.item', 'conformance.item_checked'],
    async run(w) {
      const f = await family(w)
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      await online(w, petr)
      await offline(petr)
      const oats = await petr.create('conformance_items', { title: 'Oats' })
      await petr.update('conformance_items', f.milk, { title: 'Whole milk' })
      await petr.check(f.bread, true)
      petr.network.next('lose', push)
      await online(w, petr)

      // The first push was answered and its answer lost; it was sent again under its key.
      const [lost, again] = w.recorder.attempts.filter((a) => a.client === 'petr')
      expect(lost).toMatchObject({ status: null })
      expect(again).toMatchObject({ key: lost?.key, status: 200 })
      expect(await w.replay(petr, w.answered(petr), 'fresh-key')).toEqual([])
      expect(await w.replay(petr, w.answered(petr), 'same-key')).toEqual([])
      const rows = [...(await w.admin.rows('conformance_items', f.home)).values()]
      expect(rows.filter((r) => r['title'] === 'Oats')).toEqual([
        expect.objectContaining({ id: oats }),
      ])
      expect(await eventsAbout(w, f.home, oats)).toHaveLength(1)
      expect(await eventsAbout(w, f.home, f.milk)).toHaveLength(1)
    },
  },
  {
    key: '10',
    title: 'Client clock skewed +48 h',
    expected:
      'Clamped and flagged; ordering unaffected: the server orders by receipt, whatever the clock said',
    enabledBy: 13,
    needs: ['conformance.item', 'conformance.item_checked'],
    async run(w) {
      const f = await family(w)
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      const eva = w.client({
        name: 'eva',
        member: f.eva,
        household: f.home,
        skewMs: 48 * 3_600_000,
      })
      await online(w, petr, eva)
      await offline(petr, eva)
      await eva.update('conformance_items', f.milk, { title: "Eva's milk" })
      await eva.check(f.bread, true)
      await petr.update('conformance_items', f.milk, { title: "Petr's milk" })
      // Eva's arrive first, with a clock two days ahead; Petr's arrives after.
      await online(w, eva)
      const serverNow = Date.now()
      await online(w, petr)

      expect((await w.admin.rows('conformance_items', f.home)).get(f.milk)).toMatchObject({
        title: "Petr's milk",
      })
      const check = [...(await w.admin.rows('conformance_item_checks', f.home)).values()].find(
        (c) => c['item_id'] === f.bread,
      )
      expect(check).toMatchObject({ checked: true, clock_flagged: true })
      // Clamped to a day of the server's clock, not the two days Eva's said.
      expect(Number(check?.['checked_at'])).toBeLessThanOrEqual(serverNow + 24 * 3_600_000 + 5_000)
    },
  },
  {
    key: '15',
    title: 'Two devices of the same member, both offline',
    expected: 'Converge; no self-echo loops',
    enabledBy: 13,
    needs: ['conformance.item', 'conformance.item_checked'],
    async run(w) {
      const f = await family(w)
      const phone = w.client({ name: 'petr-phone', member: f.petr, household: f.home })
      const tablet = w.client({ name: 'petr-tablet', member: f.petr, household: f.home })
      await online(w, phone, tablet)
      await offline(phone, tablet)
      await phone.update('conformance_items', f.milk, { title: 'Milk 1.5 %' })
      await tablet.update('conformance_items', f.milk, { note: 'for coffee' })
      await phone.check(f.bread, true)
      const jam = await tablet.create('conformance_items', { title: 'Jam' })
      await online(w, phone, tablet)

      expect((await w.admin.rows('conformance_items', f.home)).get(f.milk)).toMatchObject({
        title: 'Milk 1.5 %',
        note: 'for coffee',
      })
      expect(await phone.row('conformance_items', jam)).toMatchObject({ title: 'Jam' })
      for (const device of [phone, tablet]) {
        expect(
          (await device.rows('conformance_item_checks')).filter((r) => r['item_id'] === f.bread),
        ).toHaveLength(1)
      }
      await staysQuiet(w)
    },
  },
]
