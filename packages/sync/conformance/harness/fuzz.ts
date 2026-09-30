// The fuzzer (PRD 10 §4): a seeded random schedule of what four clients of one household do,
// offline and on, over a network that refuses and loses, with skewed clocks, a batch delivered
// again, and a member's grant changing under them, judged at the end by the same six invariants
// as every scenario. Scenarios find the bugs someone thought of; the fuzzer finds the others,
// with the same harness. A failing seed replays its schedule (Rng): every step draws the same
// number of times whatever the replicas hold, and whatever draws as often as PowerSync's timing
// decides (a client's ids and keys, a flaky network's rolls) draws from a generator of its own
// (Rng.fork). PowerSync's timing is not the seed's, so a replay may interleave differently with
// replication, and an update may land on another of the rows a replica holds.

import type { Admin, Level } from './admin.ts'
import type { Client } from './client.ts'
import type { Violation } from './invariants.ts'
import { push } from './network.ts'
import type { Target } from './target.ts'
import { sleep } from './wait.ts'
import { World } from './world.ts'

export interface FuzzRun {
  readonly seed: number
  readonly steps: number
  readonly target: Target
  readonly admin: Admin
}

export interface FuzzResult {
  readonly violations: Violation[]
  /** What the schedule did, step by step: the report of a failing seed. */
  readonly log: string[]
  readonly settled: boolean
}

/**
 * The item at the place in items a draw u in [0, 1) names, or undefined when there are none. The
 * draw is made whether or not there are, so that what a replica holds does not move the schedule.
 */
function at<T>(items: readonly T[], u: number): T | undefined {
  return items[Math.floor(u * items.length)]
}

const titles = [
  'Milk',
  'Bread',
  'Eggs',
  'Cheese',
  'Apples',
  'Coffee',
  'Rice',
  'Tea',
  'Jam',
  'Butter',
]

export async function fuzz(run: FuzzRun): Promise<FuzzResult> {
  const w = new World(run.target, run.admin, run.seed, `fuzz-${String(run.seed)}`)
  const log: string[] = []
  const violations: Violation[] = []
  try {
    const { rng, target } = w
    const jana = await w.member('Jana')
    const petr = await w.member('Petr')
    const eva = await w.member('Eva')
    const home = await w.household('Novákovi', [
      { member: jana, role: 'owner' },
      { member: petr, role: 'member', level: 'contribute' },
      { member: eva, role: 'member', level: 'contribute' },
    ])
    await run.admin.insert(
      'conformance_items',
      home,
      titles.slice(0, 3).map((title) => ({ id: rng.uuid(), title })),
    )
    const clients = [
      w.client({ name: 'jana', member: jana, household: home }),
      w.client({ name: 'petr-phone', member: petr, household: home }),
      w.client({ name: 'petr-tablet', member: petr, household: home }),
      w.client({ name: 'eva', member: eva, household: home }),
    ]
    // Eva's grant is the one that changes; the others' batches may be delivered again at any
    // time, since their access never does.
    const steady = clients.filter((c) => c.member !== eva)
    for (const c of clients) await c.online()
    const say = (step: number, what: string): void => {
      log.push(`${String(step)}: ${what}`)
    }

    const writes = target.writes
    // In id order, so that one draw names the same row of the same rows.
    const holds = async (c: Client, table: 'conformance_items'): Promise<string[]> =>
      (await c.rows(table)).map((r) => String(r['id'])).sort()

    for (let step = 0; step < run.steps; step++) {
      const c = rng.pick(clients)
      const action = rng.weighted<string>([
        ['toggle', 3],
        ['create', writes.has('conformance.item') ? 2 : 0],
        ['update', writes.has('conformance.item') ? 4 : 0],
        ['delete', writes.has('conformance.item') ? 1 : 0],
        ['check', writes.has('conformance.item_checked') ? 3 : 0],
        ['flaky', 1],
        ['heal', 1],
        ['lose', 1],
        ['skew', 1],
        ['grant', 1],
        ['again', 1],
        ['pause', 2],
      ])
      switch (action) {
        case 'toggle':
          if (c.isOnline) await c.offline()
          else await c.online()
          say(step, `${c.name} ${c.isOnline ? 'online' : 'offline'}`)
          break
        case 'create': {
          const id = await c.create('conformance_items', { title: rng.pick(titles) })
          say(step, `${c.name} creates ${id}`)
          break
        }
        case 'update': {
          const u = rng.float()
          const fields = rng.pick([
            { title: rng.pick(titles) },
            { note: `note ${String(rng.int(0, 99))}` },
            { quantity: rng.int(1, 12) },
          ])
          const id = at(await holds(c, 'conformance_items'), u)
          if (id === undefined) break
          await c.update('conformance_items', id, fields)
          say(step, `${c.name} sets ${JSON.stringify(fields)} on ${id}`)
          break
        }
        case 'delete': {
          const u = rng.float()
          const id = at(await holds(c, 'conformance_items'), u)
          if (id === undefined) break
          await c.remove('conformance_items', id)
          say(step, `${c.name} deletes ${id}`)
          break
        }
        case 'check': {
          const u = rng.float()
          const checked = rng.chance(0.7)
          const id = at(await holds(c, 'conformance_items'), u)
          if (id === undefined) break
          await c.check(id, checked)
          say(step, `${c.name} ${checked ? 'checks' : 'unchecks'} ${id}`)
          break
        }
        case 'flaky': {
          const refuse = rng.float() * 0.3
          const lose = rng.float() * 0.3
          // Its rolls are as many as the requests PowerSync's timing makes: a generator of its own.
          c.network.flaky(rng.fork(), refuse, lose)
          say(step, `${c.name}'s network refuses ${refuse.toFixed(2)} and loses ${lose.toFixed(2)}`)
          break
        }
        case 'heal':
          c.network.heal()
          say(step, `${c.name}'s network heals`)
          break
        case 'lose':
          c.network.next('lose', push)
          say(step, `${c.name}'s next push answer is lost`)
          break
        case 'skew':
          c.skewMs = rng.int(-50, 50) * 3_600_000
          say(step, `${c.name}'s clock is ${String(c.skewMs / 3_600_000)} h off`)
          break
        case 'grant': {
          const level = rng.pick<Level>(['contribute', 'view', 'none'])
          await run.admin.setGrant(home, eva, level)
          say(step, `Eva's grant becomes ${level}`)
          break
        }
        case 'again': {
          const s = rng.pick(steady)
          const batch = at(w.answered(s), rng.float())
          if (batch === undefined) break
          violations.push(...(await w.deliverAgain(s, batch)))
          say(step, `${s.name}'s batch ${batch.key} is delivered again`)
          break
        }
        case 'pause': {
          const ms = rng.int(0, 300)
          await sleep(ms)
          say(step, `pause ${String(ms)} ms`)
          break
        }
      }
      if (step % 5 === 0) await w.sample()
    }

    // Quiet: every network heals, every client comes online, and the run settles.
    for (const c of clients) {
      c.network.heal()
      if (!c.isOnline) await c.online()
    }
    const settled = await w.settle({ timeoutMs: 30_000 })
    log.push(settled ? 'settled' : 'did not settle within 30 s')
    violations.push(...(await w.violations()))
    // Invariant 3 at rest: every batch the steady clients had answered, delivered again.
    for (const s of steady) violations.push(...(await w.replay(s, w.answered(s))))
    return { violations, log, settled }
  } finally {
    await w.close()
  }
}
