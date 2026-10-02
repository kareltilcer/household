// PRD 10 §4's scenarios about access (7, 16 and 18), and the causes of access loss PRD 03 §2.6
// lists, which item 17 proves each retract as a row leaving every bucket a member holds, and the
// one cause that is not on the list, a lapsed entitlement (FR-BI2, item 16).
//
// The access changes are the administrator's, standing in for item 10's routes and for the
// audience mutations items 17 and 85 build (Admin).

import { expect } from 'vitest'
import type { Household, Member } from '../harness/admin.ts'
import type { World } from '../harness/world.ts'
import { answersOf, family, offline, online, staysQuiet, type Scenario } from './scenario.ts'

/**
 * A conversation of Jana and Petr, from its start, with two messages, which Eva joins at 3 with a
 * third message, the first at her floor.
 */
async function conversation(
  w: World,
  home: Household,
  jana: Member,
  petr: Member,
  eva: Member,
): Promise<{ id: string; messages: string[] }> {
  const id = await w.admin.conversation(w.rng, home, [
    { member: jana, floor: 0 },
    { member: petr, floor: 0 },
  ])
  const messages = [
    await w.admin.message(w.rng, home, id, 1, 'Who buys bread?'),
    await w.admin.message(w.rng, home, id, 2, 'I will'),
  ]
  await w.admin.joinConversation(w.rng, home, id, eva, 3)
  messages.push(await w.admin.message(w.rng, home, id, 3, 'Welcome, Eva'))
  return { id, messages }
}

export const access: readonly Scenario[] = [
  {
    key: '7',
    title: 'Grant revoked while the client is offline',
    expected:
      'On reconnect, retractions delete the local rows; queued mutations against them are rejected, surfaced once, ' +
      'and not retried forever',
    enabledBy: 17,
    needs: ['conformance.item'],
    async run(w) {
      const f = await family(w)
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, eva)
      await offline(eva)
      await eva.update('conformance_items', f.milk, { quantity: 3 })
      const butter = await eva.create('conformance_items', { title: 'Butter' })
      expect(await eva.rows('conformance_items')).toHaveLength(4)
      await w.admin.setGrant(f.home, f.eva, 'none')
      await online(w, eva)

      expect(await eva.rows('conformance_items')).toEqual([])
      expect(answersOf(w, eva).map((a) => [a.outcome, a.code])).toEqual([
        ['rejected', 'not_found'],
        ['rejected', 'not_found'],
      ])
      expect((await eva.outcomes()).map((o) => o.outcome)).toEqual(['rejected', 'rejected'])
      await staysQuiet(w)
      const items = await w.admin.rows('conformance_items', f.home)
      expect(items.has(butter)).toBe(false)
      expect(items.get(f.milk)).toMatchObject({ quantity: 1, version: 1 })
    },
  },
  {
    key: '16',
    title: 'Member removed from a conversation while offline',
    expected:
      'Messages retracted; the floor still holds for everyone else; a message queued in it is rejected once',
    enabledBy: 17,
    needs: ['conformance.message'],
    async run(w) {
      const f = await family(w)
      const talk = await conversation(w, f.home, f.jana, f.petr, f.eva)
      const jana = w.client({ name: 'jana', member: f.jana, household: f.home })
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, jana, petr, eva)
      expect(await petr.rows('conformance_messages')).toHaveLength(3)
      await offline(petr)
      await petr.create('conformance_messages', { conversation_id: talk.id, body: 'And milk' })
      await w.admin.leaveConversation(talk.id, f.petr)
      await online(w, petr)

      expect(await petr.rows('conformance_messages')).toEqual([])
      expect(answersOf(w, petr).map((a) => a.outcome)).toEqual(['rejected'])
      expect(await eva.rows('conformance_messages')).toEqual([
        expect.objectContaining({ id: talk.messages[2] }),
      ])
      expect(await jana.rows('conformance_messages')).toHaveLength(3)
      await staysQuiet(w)
    },
  },
  {
    key: '18',
    title: 'Member added to an existing conversation, then pulls',
    expected:
      'Nothing before their floor reaches their replica, because they are not among the readers of any earlier ' +
      'message: asserted on the count of message rows received',
    enabledBy: 17,
    needs: [],
    replicates: ['conformance_messages'],
    async run(w) {
      const f = await family(w)
      const talk = await conversation(w, f.home, f.jana, f.petr, f.eva)
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, eva)

      const held = await eva.rows('conformance_messages')
      expect(held).toHaveLength(1)
      expect(held[0]?.['id']).toBe(talk.messages[2])
    },
  },
  {
    key: 'loss-grant',
    title: 'Access loss: a grant lowered to none, while connected',
    expected: "The member's rows leave their replica; they come back when the grant does",
    enabledBy: 17,
    needs: [],
    replicates: ['conformance_items'],
    async run(w) {
      const f = await family(w)
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, eva)
      await w.admin.setGrant(f.home, f.eva, 'none')
      expect(await w.settle()).toBe(true)
      expect(await eva.rows('conformance_items')).toEqual([])
      await w.admin.setGrant(f.home, f.eva, 'view')
      expect(await w.settle()).toBe(true)
      expect(await eva.rows('conformance_items')).toHaveLength(3)
    },
  },
  {
    key: 'loss-audience',
    title: 'Access loss: removal from an audience, while connected',
    expected: "The conversation's messages leave the removed member's replica, and no one else's",
    enabledBy: 17,
    needs: [],
    replicates: ['conformance_messages'],
    async run(w) {
      const f = await family(w)
      const talk = await conversation(w, f.home, f.jana, f.petr, f.eva)
      const jana = w.client({ name: 'jana', member: f.jana, household: f.home })
      const petr = w.client({ name: 'petr', member: f.petr, household: f.home })
      await online(w, jana, petr)
      await w.admin.leaveConversation(talk.id, f.petr)
      expect(await w.settle()).toBe(true)
      expect(await petr.rows('conformance_messages')).toEqual([])
      expect(await jana.rows('conformance_messages')).toHaveLength(3)
    },
  },
  {
    key: 'loss-private',
    title: 'Access loss: an item moved from shared to private, while connected',
    expected:
      "The note leaves every other member's replica, whose redacted form arrives in its place (D-88); its owner keeps it whole",
    enabledBy: 17,
    needs: [],
    replicates: ['conformance_notes', 'conformance_notes_redacted'],
    async run(w) {
      const f = await family(w)
      const plan = w.rng.uuid()
      await w.admin.insert('conformance_notes', f.home, [
        { id: plan, visibility: 'shared', title: 'Holiday plan', body: 'Book the cottage' },
      ])
      const jana = w.client({ name: 'jana', member: f.jana, household: f.home })
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, jana, eva)
      expect(await eva.row('conformance_notes', plan)).toMatchObject({ title: 'Holiday plan' })
      await w.admin.makePrivate(plan, f.jana)
      expect(await w.settle()).toBe(true)
      expect(await eva.row('conformance_notes', plan)).toBeNull()
      expect(await eva.row('conformance_notes_redacted', plan)).toMatchObject({
        owner_id: f.jana.id,
      })
      expect(await jana.row('conformance_notes', plan)).toMatchObject({ body: 'Book the cottage' })
    },
  },
  {
    key: 'loss-removal',
    title: 'Access loss: removal from the household, while connected',
    expected: "Every row of the household leaves the removed member's replica",
    enabledBy: 17,
    needs: [],
    replicates: ['conformance_items'],
    async run(w) {
      const f = await family(w)
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, eva)
      await w.admin.remove(f.home, f.eva)
      expect(await w.settle()).toBe(true)
      expect(await eva.rows('conformance_items')).toEqual([])
    },
  },
  {
    key: 'loss-disabled',
    title: 'Access loss: a module disabled household-wide, while connected',
    expected:
      "The module's rows leave every replica, the owner's included; they come back when it is enabled again",
    enabledBy: 17,
    needs: [],
    replicates: ['conformance_items'],
    async run(w) {
      const f = await family(w)
      const jana = w.client({ name: 'jana', member: f.jana, household: f.home })
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, jana, eva)
      await w.admin.setEnabled(f.home, false)
      expect(await w.settle()).toBe(true)
      expect(await jana.rows('conformance_items')).toEqual([])
      expect(await eva.rows('conformance_items')).toEqual([])
      await w.admin.setEnabled(f.home, true)
      expect(await w.settle()).toBe(true)
      expect(await jana.rows('conformance_items')).toHaveLength(3)
    },
  },
  {
    key: 'suspension',
    title: 'A suspended household replicates nothing',
    expected:
      'Every replica of a suspended household is emptied of it, its own row among them, and holds it all again ' +
      'once the suspension is lifted (PRD 04 §3, D-115)',
    enabledBy: 16,
    needs: [],
    replicates: ['conformance_items'],
    async run(w) {
      const f = await family(w)
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, eva)
      expect(await eva.rows('conformance_items')).toHaveLength(3)
      await w.admin.setSuspended(f.home, true)
      expect(await w.settle()).toBe(true)
      expect(await eva.rows('conformance_items')).toEqual([])
      expect(await eva.rows('households')).toEqual([])
      await w.admin.setSuspended(f.home, false)
      expect(await w.settle()).toBe(true)
      expect(await eva.rows('conformance_items')).toHaveLength(3)
    },
  },
  {
    key: 'no-loss-lapse',
    title: 'Not access loss: a lapsed entitlement',
    expected:
      'A household that may no longer write keeps every replica exactly where it is (PRD 03 §2.6, FR-BI2)',
    enabledBy: 16,
    needs: [],
    replicates: ['conformance_items'],
    capabilities: ['setEntitlement'],
    async run(w) {
      const f = await family(w)
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, eva)
      await w.target.setEntitlement?.(f.home.id, 'read_only')
      expect(await w.settle()).toBe(true)
      expect(await eva.rows('conformance_items')).toHaveLength(3)
      // The state is on the household's row (item 16), whose change replicates as any row's does:
      // the replica settles on the resumed household too, and loses nothing either way.
      await w.target.setEntitlement?.(f.home.id, 'active')
      expect(await w.settle()).toBe(true)
      expect(await eva.rows('conformance_items')).toHaveLength(3)
    },
  },
]
