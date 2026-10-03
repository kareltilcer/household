// @household/sync's web replica in a real browser (plan item 18): it replicates its household from
// PowerSync, queues a write, pushes it through the connector, survives being closed and opened again
// with a write queued, and reports itself as holding what its member may see.
import { expect, inject, it } from 'vitest'
import { asRegistry, type Credential } from '../../src/index.ts'
import { openReplica } from '../../web/index.ts'
import generated from '../stack/powersync/registry.json'

const registry = asRegistry(generated)
const { household, member, milk } = inject('web')

/** Looks at holds until it is true, every 100 ms, for at most timeoutMs. */
async function until(holds: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  while (!(await holds())) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

let token: string | null = null
const signIn = async (): Promise<void> => {
  const response = await fetch('/conformance/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: member, ttl_seconds: 0 }),
  })
  token = ((await response.json()) as { token: string }).token
}
const credential: Credential = {
  current: async () => {
    if (token === null) await signIn()
    return token ?? ''
  },
  renew: signIn,
}

const open = () =>
  openReplica({
    dbFilename: `smoke-${household}.db`,
    registry,
    household,
    apiUrl: '/api/v1',
    credential,
    reportEveryMs: 0,
    connection: { crudUploadThrottleMs: 20, retryDelayMs: 200 },
  })

it('replicates, pushes, survives a reload with a write queued, and reports itself, in a browser', async () => {
  const replica = await open()
  await replica.connect()
  await until(async () => (await replica.rowState('conformance_items', milk)).kind === 'synced')

  const tea = await replica.create('conformance_items', { title: 'Tea' })
  await until(async () => {
    const row = await replica.db.getOptional<{ version: number | null }>(
      'SELECT version FROM conformance_items WHERE id = ?',
      [tea],
    )
    return row?.version === 1
  })

  // Offline, a write is queued, and the page's database is closed and opened again.
  await replica.disconnect()
  const coffee = await replica.create('conformance_items', { title: 'Coffee' })
  await replica.close()
  const reopened = await open()
  expect(await reopened.queued()).toBe(1)
  expect(await reopened.rowState('conformance_items', coffee)).toMatchObject({ kind: 'pending' })
  await reopened.connect()
  await until(async () => (await reopened.queued()) === 0)
  await until(async () => (await reopened.rowState('conformance_items', coffee)).kind === 'synced')

  await until(async () => (await reopened.report()) !== null)
  const verdict = await reopened.report()
  expect(verdict).toMatchObject({ matched: true, resnapshot_required: false })
  await reopened.close()
})
