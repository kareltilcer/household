// `pnpm --filter @household/sync conformance:up`: starts the suite's stack and prepares it. The
// database first, then the platform's roles and migrations as a deploy runs them, then the
// conformance module and what PowerSync needs of the database, and PowerSync last, once its
// role, publication and storage exist. It can be run again on a stack that is up: PowerSync is
// started afresh each time, so that it runs on the configuration and the streams in the working
// tree (stack/powersync), not on the ones it was first started with.

import { execFileSync } from 'node:child_process'
import { powerSyncUrl } from '../harness/env.ts'
import { until } from '../harness/wait.ts'
import { composeFile, serverDir, serverEnv } from './stack.ts'

function run(command: string, args: readonly string[], cwd?: string): void {
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...serverEnv } })
}

run('docker', ['compose', '--file', composeFile, 'up', '--detach', '--wait', 'postgres'])
run('go', ['run', './cmd/household-api', 'bootstrap'], serverDir)
run('go', ['run', './cmd/household-api', 'migrate'], serverDir)
run('go', ['run', './cmd/conformance-standin', 'setup'], serverDir)
run('docker', ['compose', '--file', composeFile, 'up', '--detach', '--force-recreate', 'powersync'])

const ready = await until(async () => {
  try {
    return (await fetch(`${powerSyncUrl}/probes/readiness`)).ok
  } catch {
    return false
  }
}, 120_000)
if (ready === null) {
  run('docker', ['compose', '--file', composeFile, 'logs', '--tail', '50', 'powersync'])
  throw new Error(`PowerSync did not become ready at ${powerSyncUrl}`)
}
console.log(`the conformance stack is up: PowerSync at ${powerSyncUrl}`)
