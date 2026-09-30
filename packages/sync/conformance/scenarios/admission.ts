// PRD 10 §4's scenarios about what the server admits, beyond merging: 12, 14 and 17.

import { expect } from 'vitest'
import { answersOf, family, offline, online, staysQuiet, type Scenario } from './scenario.ts'

export const admission: readonly Scenario[] = [
  {
    key: '12',
    title: 'Attachment row syncs, bytes fail permanently',
    expected:
      'The row is marked failed with a reason a member can act on; the row is never lost (D-25)',
    enabledBy: 17,
    needs: ['conformance.attachment'],
    capabilities: ['uploadAttachment'],
    async run(w) {
      const f = await family(w)
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      const jana = w.client({ name: 'jana', member: f.jana, household: f.home })
      await online(w, petr, jana)
      await offline(petr)
      const receipt = await petr.create('conformance_attachments', {
        item_id: f.milk,
        file_name: 'receipt.exe',
        attachment_status: 'pending',
      })
      await online(w, petr)
      expect((await w.admin.rows('conformance_attachments', f.home)).get(receipt)).toMatchObject({
        attachment_status: 'pending',
      })

      // An executable is a blocked type (FR-FL1): the upload fails, and no retry can make it pass.
      const status = await w.target.uploadAttachment?.(
        await petr.credentialNow(),
        f.home.id,
        receipt,
        new TextEncoder().encode('MZ'),
        'application/x-msdownload',
      )
      expect(status).toBeGreaterThanOrEqual(400)
      expect(await w.settle()).toBe(true)

      const row = (await w.admin.rows('conformance_attachments', f.home)).get(receipt)
      expect(row).toMatchObject({ attachment_status: 'failed' })
      expect(String(row?.['failure_reason'])).not.toBe('')
      expect(await jana.row('conformance_attachments', receipt)).toMatchObject({
        attachment_status: 'failed',
      })
    },
  },
  {
    key: '14',
    title: 'Entitlement lapses with a queue outstanding',
    expected:
      'Rejected with entitlement, held locally, and replayed once the subscription resumes; nothing is retracted in ' +
      'the meantime (FR-BI2)',
    enabledBy: 16,
    needs: ['conformance.item'],
    capabilities: ['setEntitlement'],
    allowHeld: ['entitlement'],
    async run(w) {
      const f = await family(w)
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      await online(w, petr)
      await offline(petr)
      await petr.update('conformance_items', f.milk, { title: 'Goat milk' })
      const honey = await petr.create('conformance_items', { title: 'Honey' })
      await w.target.setEntitlement?.(f.home.id, 'read_only')
      await online(w, petr)

      expect(answersOf(w, petr).map((a) => a.outcome)).toEqual(['rejected', 'rejected'])
      expect((await petr.held('entitlement')).map((h) => h.mutation.entity_id)).toEqual([
        f.milk,
        honey,
      ])
      expect((await w.admin.rows('conformance_items', f.home)).has(honey)).toBe(false)
      // Read-only is not access loss: the replica keeps every row the member held.
      expect((await petr.rows('conformance_items')).map((r) => r['id'])).toEqual(
        expect.arrayContaining([f.milk, f.bread, f.eggs]),
      )
      await staysQuiet(w)

      await w.target.setEntitlement?.(f.home.id, 'active')
      petr.connector.resume()
      await petr.flush()
      expect(await w.settle()).toBe(true)
      expect(await petr.held()).toEqual([])
      const items = await w.admin.rows('conformance_items', f.home)
      expect(items.get(f.milk)).toMatchObject({ title: 'Goat milk' })
      expect(items.get(honey)).toMatchObject({ title: 'Honey' })
    },
  },
  {
    key: '17',
    title: 'Offline additive create that violates a cross-row invariant on arrival',
    expected:
      'Rejected with monotonicity_violation, surfaced once with the offending neighbour named, never retried in a ' +
      "loop, and the member's typed value preserved so they can correct it",
    enabledBy: 13,
    needs: ['conformance.reading'],
    async run(w) {
      const f = await family(w)
      const meter = w.rng.uuid()
      const day = (n: number): string => new Date(Date.UTC(2026, 8, n, 7)).toISOString()
      await w.admin.insert('conformance_readings', f.home, [
        { id: w.rng.uuid(), meter_id: meter, read_at: day(1), value: 100 },
      ])
      const jana = w.client({ name: 'jana', member: f.jana, household: f.home })
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      await online(w, jana, petr)
      await offline(petr)
      // Jana reads 300 on the 3rd; Petr, in the cellar without her reading, back-fills 250 on the 4th.
      const neighbour = await jana.create('conformance_readings', {
        meter_id: meter,
        read_at: day(3),
        value: 300,
      })
      expect(await w.settle({ clients: [jana] })).toBe(true)
      const typed = await petr.create('conformance_readings', {
        meter_id: meter,
        read_at: day(4),
        value: 250,
      })
      await online(w, petr)

      const [refused] = answersOf(w, petr)
      expect(refused).toMatchObject({ outcome: 'rejected', code: 'monotonicity_violation' })
      // The neighbour it broke against is named in the answer.
      expect(JSON.stringify(refused)).toContain(neighbour)
      const [kept] = await petr.outcomes()
      expect(kept).toMatchObject({
        entity_id: typed,
        outcome: 'rejected',
        code: 'monotonicity_violation',
      })
      // What Petr typed stays with the rejection, for him to correct rather than read the meter again.
      const recorded = await petr.db.get<{ mutation: string }>(
        'SELECT mutation FROM conformance_outcomes WHERE entity_id = ?',
        [typed],
      )
      expect(JSON.parse(recorded.mutation)).toMatchObject({ fields: { value: 250 } })
      await staysQuiet(w)
      expect(w.recorder.attemptsAt(answersOf(w, petr)[0]?.mutation_id ?? '')).toHaveLength(1)
    },
  },
]
