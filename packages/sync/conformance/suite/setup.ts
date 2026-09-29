// The suite's global setup: the stack must be up (`conformance:up`), and the stand-in API is
// built and started here unless one already answers, then stopped when the suite ends.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { adminDatabaseUrl, powerSyncUrl, standInUrl, startStandIn } from '../harness/env.ts'
import { until } from '../harness/wait.ts'
import { serverDir, serverEnv } from '../stack/stack.ts'

async function answers(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}

const upHint = 'start the stack with `pnpm --filter @household/sync conformance:up`'

export default async function setup(): Promise<() => Promise<void>> {
  const admin = new pg.Client({ connectionString: adminDatabaseUrl })
  try {
    await admin.connect()
    await admin.query("SELECT 'conformance_items'::regclass")
  } catch (error) {
    throw new Error(`the stack's database is not ready at ${adminDatabaseUrl}: ${upHint}`, { cause: error })
  } finally {
    await admin.end().catch(() => undefined)
  }
  if (!(await answers(`${powerSyncUrl}/probes/readiness`))) throw new Error(`PowerSync does not answer at ${powerSyncUrl}: ${upHint}`)

  const health = `${standInUrl}/standin/healthz`
  if (await answers(health)) return () => Promise.resolve()
  if (!startStandIn) throw new Error(`no stand-in answers at ${standInUrl}, and CONFORMANCE_START_STANDIN is false`)

  // Built, then run: a `go run` would leave its child running when it is stopped.
  const dir = mkdtempSync(join(tmpdir(), 'household-standin-'))
  const binary = join(dir, process.platform === 'win32' ? 'conformance-standin.exe' : 'conformance-standin')
  execFileSync('go', ['build', '-o', binary, './cmd/conformance-standin'], { cwd: serverDir, stdio: 'inherit' })
  const listen = new URL(standInUrl)
  const child: ChildProcess = spawn(binary, ['serve'], {
    env: { ...process.env, ...serverEnv, CONFORMANCE_STANDIN_ADDR: listen.host, CONFORMANCE_POWERSYNC_URL: powerSyncUrl },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => {
      resolve()
    })
  })
  if ((await until(() => answers(health), 30_000)) === null) {
    child.kill()
    throw new Error(`the stand-in did not answer at ${health}`)
  }
  return async () => {
    child.kill()
    await exited
    rmSync(dir, { recursive: true, force: true })
  }
}
