// The suite's global setup: the stack must be up (`conformance:up`), and the API the suite runs
// against (server/cmd/conformance-api) is built and started here unless one already answers, then
// stopped when the suite ends.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import pg from 'pg'
import { adminDatabaseUrl, apiListen, apiUrl, powerSyncUrl, startApi } from '../harness/env.ts'
import { until } from '../harness/wait.ts'
import { answers, serverDir, serverEnv } from '../stack/stack.ts'

const upHint = 'start the stack with `pnpm --filter @household/sync conformance:up`'

export default async function setup(): Promise<() => Promise<void>> {
  const admin = new pg.Client({ connectionString: adminDatabaseUrl })
  try {
    await admin.connect()
    await admin.query("SELECT 'conformance_items'::regclass")
  } catch (error) {
    throw new Error(`the stack's database is not ready at ${adminDatabaseUrl}: ${upHint}`, {
      cause: error,
    })
  } finally {
    await admin.end().catch(() => undefined)
  }
  if (!(await answers(`${powerSyncUrl}/probes/readiness`)))
    throw new Error(`PowerSync does not answer at ${powerSyncUrl}: ${upHint}`)

  const health = `${apiUrl}/conformance/healthz`
  if (await answers(health)) return () => Promise.resolve()
  if (!startApi) throw new Error(`no API answers at ${apiUrl}, and CONFORMANCE_START_API is false`)

  // Built, then run: a `go run` would leave its child running when it is stopped.
  const dir = mkdtempSync(join(tmpdir(), 'household-conformance-api-'))
  const binary = join(dir, process.platform === 'win32' ? 'conformance-api.exe' : 'conformance-api')
  execFileSync('go', ['build', '-o', binary, './cmd/conformance-api'], {
    cwd: serverDir,
    stdio: 'inherit',
  })
  const child: ChildProcess = spawn(binary, ['serve'], {
    env: {
      ...process.env,
      ...serverEnv,
      HOUSEHOLD_HTTP_ADDR: apiListen,
      HOUSEHOLD_POWERSYNC_URL: powerSyncUrl,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  // The API logs to stdout, a line for every request and the error behind every 500 it answers:
  // the requests answered well are left out, and what went wrong is passed on.
  if (child.stdout !== null) {
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (/"level":"(?:WARN|ERROR)"/.test(line)) process.stderr.write(`conformance-api: ${line}\n`)
    })
  }
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => {
      resolve()
    })
  })
  if ((await until(() => answers(health), 30_000)) === null) {
    child.kill()
    throw new Error(`the API did not answer at ${health}`)
  }
  return async () => {
    child.kill()
    await exited
    rmSync(dir, { recursive: true, force: true })
  }
}
