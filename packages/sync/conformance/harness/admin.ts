// The server's side of a run, as the database's administrator: households seeded for a scenario,
// the access changes a scenario makes, and the truth every replica is compared against.
//
// The access changes are written here directly, as the spike's harness wrote them, standing in
// for the routes item 10 built: the conformance module is not among the contract's
// ModuleKeyValue, so those routes cannot grant it. A stream reads the tables they write whichever
// path wrote them, so a replica follows either the same way.

import { randomInt } from 'node:crypto'
import pg from 'pg'
import type { Rng } from './rng.ts'
import { canonicalRow, tableSpec, type CanonicalRow, type TableName } from './schema.ts'

export type Level = 'none' | 'view' | 'contribute' | 'manage'
export type Role = 'owner' | 'member' | 'child'

/** The module whose grant holds every conformance entity. */
export const moduleId = 'conformance'

export interface Member {
  readonly id: string
  readonly name: string
}

export interface MemberSpec {
  readonly member: Member
  readonly role: Role
  /** The member's grant on the conformance module; an owner's is manage whatever it says. */
  readonly level?: Level
}

export interface Household {
  readonly id: string
  readonly name: string
  /** The IANA timezone its calendar days are in. */
  readonly timezone: string
}

const joinCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * A household's join code. Unseeded: codes are unique across runs on one database, and no schedule
 * depends on one.
 */
function joinCode(): string {
  return Array.from({ length: 8 }, () =>
    joinCodeAlphabet.charAt(randomInt(joinCodeAlphabet.length)),
  ).join('')
}

// A date is a calendar day, read as its text: node-postgres would make it a Date at the local
// timezone's midnight, which is another day in UTC. The suite reads the database only here.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value)

export class Admin {
  readonly pool: pg.Pool

  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 4 })
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  /** A user, with a display name. */
  async member(rng: Rng, name: string): Promise<Member> {
    const member = { id: rng.uuid(), name }
    await this.pool.query('INSERT INTO users (id, display_name) VALUES ($1, $2)', [member.id, name])
    return member
  }

  /**
   * A household in which members hold their roles and grants, and the conformance module is
   * enabled: its first owner is its payer.
   */
  async household(rng: Rng, name: string, members: readonly MemberSpec[]): Promise<Household> {
    const owner = members.find((m) => m.role === 'owner')
    if (owner === undefined) throw new Error('a household has an owner')
    const household: Household = { id: rng.uuid(), name, timezone: 'Europe/Prague' }
    const code = joinCode()
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query(
        `INSERT INTO households (id, name, country, timezone, base_currency, locale, units, first_day_of_week, join_code, billing_payer_id)
         VALUES ($1, $2, 'CZ', $3, 'CZK', 'cs', 'metric', 1, $4, $5)`,
        [household.id, name, household.timezone, code, owner.member.id],
      )
      for (const m of members) {
        await c.query(
          'INSERT INTO memberships (id, household_id, user_id, role) VALUES ($1, $2, $3, $4)',
          [rng.uuid(), household.id, m.member.id, m.role],
        )
        if (m.role !== 'owner' && m.level !== undefined) {
          await c.query(
            'INSERT INTO module_grants (household_id, user_id, module, level) VALUES ($1, $2, $3, $4)',
            [household.id, m.member.id, moduleId, m.level],
          )
        }
      }
      await c.query(
        'INSERT INTO module_enablement (id, household_id, module, enabled) VALUES ($1, $2, $3, true)',
        [rng.uuid(), household.id, moduleId],
      )
      await c.query('COMMIT')
    } catch (error) {
      await c.query('ROLLBACK')
      throw error
    } finally {
      c.release()
    }
    return household
  }

  /**
   * Households with no member, until the database holds at least total that enable the conformance
   * module: the load a stream bears whose lookups reach households it was not asked for.
   */
  async fill(rng: Rng, total: number): Promise<void> {
    const counted = await this.pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM module_enablement WHERE module = $1 AND enabled',
      [moduleId],
    )
    const missing = total - Number(counted.rows[0]?.n ?? 0)
    if (missing <= 0) return
    const households = Array.from({ length: missing }, () => rng.uuid())
    const enablements = Array.from({ length: missing }, () => rng.uuid())
    const codes = Array.from({ length: missing }, joinCode)
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query(
        `INSERT INTO households (id, name, country, timezone, base_currency, locale, units, first_day_of_week, join_code)
         SELECT f.id, 'Filler', 'CZ', 'Europe/Prague', 'CZK', 'cs', 'metric', 1, f.code
         FROM unnest($1::uuid[], $2::text[]) AS f (id, code)`,
        [households, codes],
      )
      await c.query(
        `INSERT INTO module_enablement (id, household_id, module, enabled)
         SELECT f.id, f.household_id, $3, true FROM unnest($1::uuid[], $2::uuid[]) AS f (id, household_id)`,
        [enablements, households, moduleId],
      )
      await c.query('COMMIT')
    } catch (error) {
      await c.query('ROLLBACK')
      throw error
    } finally {
      c.release()
    }
  }

  /** Sets member's grant on the conformance module (FR-AC3). */
  async setGrant(household: Household, member: Member, level: Level): Promise<void> {
    await this.pool.query(
      `INSERT INTO module_grants (household_id, user_id, module, level) VALUES ($1, $2, $3, $4)
       ON CONFLICT (household_id, user_id, module) DO UPDATE SET level = excluded.level`,
      [household.id, member.id, moduleId, level],
    )
  }

  /** Enables or disables the conformance module household-wide (FR-HA3). */
  async setEnabled(household: Household, enabled: boolean): Promise<void> {
    await this.pool.query(
      'UPDATE module_enablement SET enabled = $3 WHERE household_id = $1 AND module = $2',
      [household.id, moduleId, enabled],
    )
  }

  /** Removes member from household (FR-HH5); their grants go with the membership. */
  async remove(household: Household, member: Member): Promise<void> {
    await this.pool.query('DELETE FROM memberships WHERE household_id = $1 AND user_id = $2', [
      household.id,
      member.id,
    ])
  }

  /**
   * A conversation of household whose members join it at the floors given, each the household's
   * feed sequence at which they joined (D-90), 0 for the start.
   */
  async conversation(
    rng: Rng,
    household: Household,
    members: readonly { readonly member: Member; readonly floor: number }[],
  ): Promise<string> {
    const id = rng.uuid()
    await this.insert('conformance_conversations', household, [{ id, title: 'Nákup' }])
    for (const m of members) await this.joinConversation(rng, household, id, m.member, m.floor)
    return id
  }

  async joinConversation(
    rng: Rng,
    household: Household,
    conversation: string,
    member: Member,
    floor: number,
  ): Promise<void> {
    await this.insert('conformance_conversation_members', household, [
      { id: rng.uuid(), conversation_id: conversation, user_id: member.id, floor_seq: floor },
    ])
  }

  /**
   * A message at seq in conversation, whose readers are the members whose floor it is at or above,
   * as item 14's mutation will write them (ADR 0001).
   */
  async message(
    rng: Rng,
    household: Household,
    conversation: string,
    seq: number,
    body: string,
  ): Promise<string> {
    const id = rng.uuid()
    await this.pool.query(
      `INSERT INTO conformance_messages (id, household_id, conversation_id, seq, body, readers)
       SELECT $1, $2, $3, $4, $5, coalesce(array_agg(user_id), '{}')
       FROM conformance_conversation_members WHERE conversation_id = $3 AND floor_seq <= $4`,
      [id, household.id, conversation, seq, body],
    )
    return id
  }

  /** Takes member out of conversation and out of the readers of every message in it (ADR 0001). */
  async leaveConversation(conversation: string, member: Member): Promise<void> {
    await this.pool.query(
      'UPDATE conformance_messages SET readers = array_remove(readers, $2::uuid) WHERE conversation_id = $1',
      [conversation, member.id],
    )
    await this.pool.query(
      'DELETE FROM conformance_conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [conversation, member.id],
    )
  }

  /** Makes a shared note private to owner, which retracts it from everyone else (PRD 03 §2.6). */
  async makePrivate(note: string, owner: Member): Promise<void> {
    await this.pool.query(
      `UPDATE conformance_notes SET visibility = 'private', owner_id = $2 WHERE id = $1`,
      [note, owner.id],
    )
  }

  /** Rows as the administrator inserts them, past the push: a scenario's starting state. */
  async insert(
    table: TableName,
    household: Household,
    rows: readonly Readonly<Record<string, unknown>>[],
  ): Promise<void> {
    for (const row of rows) {
      const columns = ['household_id', ...Object.keys(row)]
      const values = [household.id, ...Object.values(row)]
      const placeholders = values.map((_, i) => `$${String(i + 1)}`)
      await this.pool.query(
        `INSERT INTO ${pg.escapeIdentifier(table)} (${columns.map((c) => pg.escapeIdentifier(c)).join(', ')}) VALUES (${placeholders.join(', ')})`,
        values,
      )
    }
  }

  /** Every row of table in household, deleted or not, keyed by id. */
  async rows(table: TableName, household: Household): Promise<Map<string, CanonicalRow>> {
    const spec = tableSpec(table)
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM ${pg.escapeIdentifier(table)} WHERE household_id = $1`,
      [household.id],
    )
    return new Map(result.rows.map((r) => [String(r['id']), canonicalRow(spec, r)]))
  }

  /** How many audit events and feed changes household has: what a replayed batch must not add to. */
  async history(household: Household): Promise<{ events: number; changes: number }> {
    const events = await this.pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM audit_events WHERE household_id = $1',
      [household.id],
    )
    const changes = await this.pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM sync_changes WHERE household_id = $1',
      [household.id],
    )
    return { events: Number(events.rows[0]?.n ?? 0), changes: Number(changes.rows[0]?.n ?? 0) }
  }

  /**
   * The rows of table member may see in household (PRD 03 §2.3): while the module is enabled, an
   * owner's, or a member's whose grant is above none; a private note only to its owner, and its
   * redacted form to everyone with the grant; a message to its readers. Tombstones are the target's
   * to keep or drop. This is the suite's own statement of the predicate, never a stream's, so that
   * a stream that disagrees with it is caught.
   */
  async visible(
    table: TableName,
    household: Household,
    member: Member,
    tombstones: 'dropped' | 'kept',
  ): Promise<Map<string, CanonicalRow>> {
    const spec = tableSpec(table)
    const source = table === 'conformance_notes_redacted' ? 'conformance_notes' : table
    const conditions = [
      't.household_id = $1',
      `EXISTS (SELECT FROM module_enablement e WHERE e.household_id = $1 AND e.module = '${moduleId}' AND e.enabled)`,
      `(EXISTS (SELECT FROM memberships m WHERE m.household_id = $1 AND m.user_id = $2 AND m.role = 'owner')
        OR EXISTS (SELECT FROM module_grants g WHERE g.household_id = $1 AND g.user_id = $2
                     AND g.module = '${moduleId}' AND g.level <> 'none'))`,
    ]
    if (tombstones === 'dropped') conditions.push('t.deleted_at IS NULL')
    if (table === 'conformance_notes')
      conditions.push(`(t.visibility = 'shared' OR t.owner_id = $2)`)
    if (table === 'conformance_notes_redacted') conditions.push(`t.visibility = 'private'`)
    if (table === 'conformance_messages') conditions.push('$2 = ANY (t.readers)')
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT t.* FROM ${pg.escapeIdentifier(source)} t WHERE ${conditions.join(' AND ')}`,
      [household.id, member.id],
    )
    return new Map(result.rows.map((r) => [String(r['id']), canonicalRow(spec, r)]))
  }

  /** The household every row of table with id belongs to, for a row a replica should not hold. */
  async householdOf(table: TableName, id: string): Promise<string | null> {
    const source = table === 'conformance_notes_redacted' ? 'conformance_notes' : table
    const result = await this.pool.query<{ household_id: string }>(
      // As text: a replica may hold an id the server's uuid column could never take.
      `SELECT household_id FROM ${pg.escapeIdentifier(source)} WHERE id::text = lower($1)`,
      [id],
    )
    return result.rows[0]?.household_id ?? null
  }
}
