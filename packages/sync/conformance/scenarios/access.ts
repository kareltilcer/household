// PRD 10 §4's scenarios about access (7, 16 and 18), and the causes of access loss PRD 03 §2.6
// lists, which item 17 proves each retract as a row leaving every bucket a member holds, and the
// one cause that is not on the list, a lapsed entitlement (FR-BI2, item 16).
//
// A grant and a module's enablement are the administrator's, standing in for item 10's routes, which
// cannot name the conformance module (Admin). Every other access change is the server's: a member
// leaving a conversation and a note made private are pushed, and the server rewrites the readers, the
// visibility and the owner the rows carry (ADR 0018); a removal from the household goes through item
// 10's route, whose hook takes the member out of every audience (World).

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
      await w.leaveConversation(f.home, talk.id, f.petr, f.jana)
      await online(w, petr)

      expect(await petr.rows('conformance_messages')).toEqual([])
      expect(answersOf(w, petr).map((a) => [a.outcome, a.code])).toEqual([
        ['rejected', 'not_found'],
      ])
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
      await w.leaveConversation(f.home, talk.id, f.petr, f.jana)
      expect(await w.settle()).toBe(true)
      expect(await petr.rows('conformance_messages')).toEqual([])
      expect(await jana.rows('conformance_messages')).toHaveLength(3)
      // The rewrite of their readers is no edit of the messages: each is at the version it was made.
      for (const m of (await w.admin.rows('conformance_messages', f.home)).values())
        expect(m).toMatchObject({ version: 1 })
    },
  },
  {
    key: 'loss-private',
    title: 'Access loss: an item moved from shared to private, while connected',
    expected:
      "The note and the comment it bounds leave every other member's replica, whose redacted form of the note arrives " +
      'in its place (D-88); its owner keeps both whole, and an edit she queued against the comment applies, the rewrite ' +
      'of its visibility being no edit of it',
    enabledBy: 17,
    needs: ['conformance.note', 'conformance.note_comment'],
    replicates: ['conformance_notes_redacted'],
    async run(w) {
      const f = await family(w)
      const [plan, remark] = [w.rng.uuid(), w.rng.uuid()]
      await w.admin.insert('conformance_notes', f.home, [
        { id: plan, visibility: 'shared', title: 'Holiday plan', body: 'Book the cottage' },
      ])
      await w.admin.insert('conformance_note_comments', f.home, [
        { id: remark, note_id: plan, visibility: 'shared', body: 'Two weeks?' },
      ])
      const jana = w.client({ name: 'jana', member: f.jana, household: f.home })
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, jana, eva)
      expect(await eva.row('conformance_notes', plan)).toMatchObject({ title: 'Holiday plan' })
      expect(await eva.row('conformance_note_comments', remark)).toMatchObject({
        body: 'Two weeks?',
      })
      // Jana edits the comment on her phone, offline, and makes the note private from elsewhere.
      await offline(jana)
      await jana.update('conformance_note_comments', remark, { body: 'Ten days' })
      await w.makePrivate(f.home, plan, f.jana)
      await online(w, jana)

      expect(await eva.row('conformance_notes', plan)).toBeNull()
      expect(await eva.row('conformance_note_comments', remark)).toBeNull()
      expect(await eva.row('conformance_notes_redacted', plan)).toMatchObject({
        owner_id: f.jana.id,
      })
      expect(await jana.row('conformance_notes', plan)).toMatchObject({ body: 'Book the cottage' })
      // Her edit was made against the comment's version, which the move left as it was: applied, not
      // merged over a change she never saw.
      expect(answersOf(w, jana).map((a) => a.outcome)).toEqual(['applied'])
      expect((await w.admin.rows('conformance_note_comments', f.home)).get(remark)).toMatchObject({
        body: 'Ten days',
        visibility: 'private',
        owner_id: f.jana.id,
        version: 2,
      })
    },
  },
  {
    key: 'loss-removal',
    title: 'Access loss: removal from the household, while connected',
    expected:
      "Every row of the household leaves the removed member's replica, and the removal takes them out of the " +
      'readers of every audience they were in',
    enabledBy: 17,
    needs: [],
    replicates: ['conformance_items', 'conformance_messages'],
    async run(w) {
      const f = await family(w)
      const talk = await conversation(w, f.home, f.jana, f.petr, f.eva)
      const eva = w.client({ name: 'eva', member: f.eva, household: f.home })
      await online(w, eva)
      expect(await eva.rows('conformance_messages')).toHaveLength(1)
      await w.removeMember(f.home, f.eva, f.jana)
      expect(await w.settle()).toBe(true)
      expect(await eva.rows('conformance_items')).toEqual([])
      expect(await eva.rows('conformance_messages')).toEqual([])
      expect(await eva.rows('households')).toEqual([])
      const messages = [...(await w.admin.rows('conformance_messages', f.home)).values()]
      expect(messages.map((m) => m['id']).sort()).toEqual([...talk.messages].sort())
      for (const m of messages) expect(m['readers']).not.toContain(f.eva.id)
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
