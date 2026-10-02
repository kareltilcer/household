// PRD 10 §4's scenarios about how concurrent writes merge (PRD 03 §2.5): 1, 2, 3, 4, 5, 11 and 13.

import { expect } from 'vitest'
import {
  answersOf,
  eventsAbout,
  family,
  fieldHistory,
  offline,
  online,
  staysQuiet,
  today,
  type Scenario,
} from './scenario.ts'

export const merge: readonly Scenario[] = [
  {
    key: '1',
    title: 'Two clients offline edit different fields of one row (lww_field)',
    expected: 'Both changes survive; no conflict shown',
    enabledBy: 13,
    needs: ['conformance.item'],
    async run(w) {
      const f = await family(w)
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, petr, eva)
      await offline(petr, eva)
      await petr.update('conformance_items', f.milk, { title: 'Oat milk' })
      await eva.update('conformance_items', f.milk, { note: 'two litres' })
      await online(w, petr, eva)

      expect((await w.admin.rows('conformance_items', f.home)).get(f.milk)).toMatchObject({
        title: 'Oat milk',
        note: 'two litres',
      })
      const answers = [...answersOf(w, petr), ...answersOf(w, eva)]
      // No conflict and no refusal. A merged answer is shown only where a field the member set was
      // overridden, and here neither was: its row keeps what the member wrote.
      expect(
        answers.map((a) => a.outcome).filter((o) => o !== 'applied' && o !== 'merged'),
      ).toEqual([])
      for (const a of answers.filter((x) => x.outcome === 'merged')) {
        expect(a.row).toMatchObject({ title: 'Oat milk', note: 'two litres' })
      }
    },
  },
  {
    key: '2',
    title: 'Two clients offline edit the same field',
    expected:
      'One wins by server receipt; the loser is surfaced, not silently dropped: the later write answers merged, ' +
      'carrying the row, the earlier value is not what either replica ends with, and the activity log keeps it as ' +
      'the value the later write replaced (D-122)',
    enabledBy: 17,
    needs: ['conformance.item'],
    async run(w) {
      const f = await family(w)
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, petr, eva)
      await offline(petr, eva)
      await petr.update('conformance_items', f.milk, { title: 'Oat milk' })
      await eva.update('conformance_items', f.milk, { title: 'Soy milk' })
      // Petr's arrives first, Eva's second: Eva's wins by receipt.
      await online(w, petr)
      await online(w, eva)

      expect((await w.admin.rows('conformance_items', f.home)).get(f.milk)).toMatchObject({
        title: 'Soy milk',
      })
      expect(answersOf(w, petr).map((a) => a.outcome)).toEqual(['applied'])
      const [won] = answersOf(w, eva)
      // The write that replaced a concurrent change of the same field says so, and its client
      // keeps the answer in its outcomes table beside its mutation.
      expect(won?.outcome).toBe('merged')
      expect(won?.row).toMatchObject({ title: 'Soy milk' })
      expect((await eva.outcomes()).map((o) => o.outcome)).toEqual(['merged'])
      // Petr's value is not lost: the log keeps it, the one Eva's write replaced.
      expect(await fieldHistory(w, f.home, f.milk, 'title')).toEqual([
        { old: 'Milk', new: 'Oat milk' },
        { old: 'Oat milk', new: 'Soy milk' },
      ])
    },
  },
  {
    key: '3',
    title: 'Two clients offline check the same shopping item',
    expected: 'One check; idempotent; no conflict dialog',
    enabledBy: 13,
    needs: ['conformance.item', 'conformance.item_checked'],
    async run(w) {
      const f = await family(w)
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home, skewMs: 1_000 })
      await online(w, petr, eva)
      await offline(petr, eva)
      await petr.check(f.milk, true)
      await eva.check(f.milk, true)
      await online(w, petr, eva)

      const checks = [...(await w.admin.rows('conformance_item_checks', f.home)).values()].filter(
        (c) => c['item_id'] === f.milk,
      )
      expect(checks).toHaveLength(1)
      expect(checks[0]).toMatchObject({ checked: true })
      const id = checks[0]?.id ?? ''
      // Applied once: one audit event for the one check the server holds.
      expect(await eventsAbout(w, f.home, id)).toHaveLength(1)
      const outcomes = [...answersOf(w, petr), ...answersOf(w, eva)].map((a) => a.outcome)
      expect(outcomes.filter((o) => o === 'conflict' || o === 'rejected')).toEqual([])
    },
  },
  {
    key: '4',
    title: 'Client A creates X offline and edits it twice before syncing',
    expected: 'One entity, final state, no id remapping',
    enabledBy: 13,
    needs: ['conformance.item'],
    async run(w) {
      const f = await family(w)
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      await online(w, petr)
      await offline(petr)
      const cheese = await petr.create('conformance_items', { title: 'Cheese' })
      await petr.update('conformance_items', cheese, { title: 'Gouda' })
      await petr.update('conformance_items', cheese, { note: 'sliced' })
      await online(w, petr)

      const rows = [...(await w.admin.rows('conformance_items', f.home)).values()]
      expect(rows.filter((r) => r['title'] === 'Gouda')).toEqual([
        expect.objectContaining({ id: cheese, note: 'sliced' }),
      ])
      expect(rows.filter((r) => r['title'] === 'Cheese')).toEqual([])
      expect(answersOf(w, petr).map((a) => a.outcome)).toEqual(['applied', 'applied', 'applied'])
      expect(await petr.row('conformance_items', cheese)).toMatchObject({
        title: 'Gouda',
        note: 'sliced',
      })
    },
  },
  {
    key: '5',
    title: 'Client A creates X, edits X, deletes X, all offline',
    expected:
      'The server sees three mutations for an id it never had; the net effect is a tombstone and no error storm',
    enabledBy: 13,
    needs: ['conformance.item'],
    async run(w) {
      const f = await family(w)
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      await online(w, petr)
      await offline(petr)
      const jam = await petr.create('conformance_items', { title: 'Jam' })
      await petr.update('conformance_items', jam, { note: 'apricot' })
      await petr.remove('conformance_items', jam)
      await online(w, petr)

      const row = (await w.admin.rows('conformance_items', f.home)).get(jam)
      expect(row?.['deleted_at']).not.toBeNull()
      expect(answersOf(w, petr).map((a) => a.outcome)).toEqual(['applied', 'applied', 'applied'])
      // No error storm: one batch carried the three, and nothing follows it.
      expect(w.recorder.attempts.filter((a) => a.client === 'petr')).toHaveLength(1)
      await staysQuiet(w)
      if (w.target.tombstones === 'dropped')
        expect(await petr.row('conformance_items', jam)).toBeNull()
    },
  },
  {
    key: '11',
    title: 'strict_version mismatch',
    expected: "Conflict carrying the server's current row; the member's change kept to re-present",
    enabledBy: 17,
    needs: ['conformance.budget'],
    async run(w) {
      const f = await family(w)
      const groceries = w.rng.uuid()
      await w.admin.insert('conformance_budgets', f.home, [
        { id: groceries, name: 'Groceries', amount_minor: 450_000, currency: 'CZK' },
      ])
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, petr, eva)
      await offline(petr, eva)
      await petr.update('conformance_budgets', groceries, { amount_minor: 500_000 })
      await eva.update('conformance_budgets', groceries, { amount_minor: 400_000 })
      await online(w, petr)
      await online(w, eva)

      expect((await w.admin.rows('conformance_budgets', f.home)).get(groceries)).toMatchObject({
        amount_minor: 500_000,
        version: 2,
      })
      expect(answersOf(w, petr).map((a) => a.outcome)).toEqual(['applied'])
      const [refused] = answersOf(w, eva)
      expect(refused?.outcome).toBe('conflict')
      expect(refused?.row).toMatchObject({ id: groceries, amount_minor: 500_000, version: 2 })
      // Eva's change stays in her outcomes table, to be re-presented beside the server's.
      const [kept] = await eva.outcomes()
      expect(kept).toMatchObject({ outcome: 'conflict', entity_id: groceries })
      expect(await eva.row('conformance_budgets', groceries)).toMatchObject({
        amount_minor: 500_000,
      })
    },
  },
  {
    key: '13',
    title: 'Two rotating-chore completions offline: one completion',
    expected:
      'The two completions of one occurrence are one row, applied once (state_set on (chore_id, occurrence))',
    enabledBy: 13,
    needs: ['conformance.completion'],
    async run(w) {
      const f = await family(w)
      const dishes = w.rng.uuid()
      await w.admin.insert('conformance_chores', f.home, [
        { id: dishes, name: 'Dishes', rotation: [f.petr.id, f.eva.id, f.jana.id] },
      ])
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, petr, eva)
      await offline(petr, eva)
      const day = today(f.home)
      for (const c of [petr, eva]) {
        await c.create('conformance_completions', {
          chore_id: dishes,
          occurrence: day,
          done: true,
          done_at: c.now().toISOString(),
        })
      }
      await online(w, petr, eva)

      const done = [...(await w.admin.rows('conformance_completions', f.home)).values()].filter(
        (c) => c['chore_id'] === dishes,
      )
      expect(done).toHaveLength(1)
      expect(done[0]).toMatchObject({ occurrence: day, done: true })
      expect(await eventsAbout(w, f.home, done[0]?.id ?? '')).toHaveLength(1)
    },
  },
  {
    key: '13-rotation',
    title: 'Two rotating-chore completions offline: the rotation',
    expected: 'Rotation advances once (D-52: from the occurrence, not from the mutation)',
    enabledBy: 17,
    needs: ['conformance.completion', 'conformance.chore'],
    async run(w) {
      const f = await family(w)
      const dishes = w.rng.uuid()
      await w.admin.insert('conformance_chores', f.home, [
        { id: dishes, name: 'Dishes', rotation: [f.petr.id, f.eva.id, f.jana.id] },
      ])
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, petr, eva)
      await offline(petr, eva)
      const day = today(f.home)
      for (const c of [petr, eva]) {
        await c.create('conformance_completions', {
          chore_id: dishes,
          occurrence: day,
          done: true,
          done_at: c.now().toISOString(),
        })
      }
      await online(w, petr, eva)

      expect((await w.admin.rows('conformance_chores', f.home)).get(dishes)).toMatchObject({
        rotation_index: 1,
      })
      expect(await petr.row('conformance_chores', dishes)).toMatchObject({ rotation_index: 1 })
    },
  },
]
