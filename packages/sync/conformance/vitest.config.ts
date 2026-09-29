// The conformance suite against its stack (`pnpm --filter @household/sync conformance`). The
// package's own `test` runs the harness's unit tests, which need no stack.
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: resolve(import.meta.dirname, '..'),
  test: {
    include: ['conformance/suite/**/*.test.ts'],
    globalSetup: ['conformance/suite/setup.ts'],
    // Each scenario waits on replication, and a fuzz run is many scenarios' worth.
    testTimeout: 10 * 60_000,
    hookTimeout: 5 * 60_000,
    // One PowerSync, one stand-in: the runs take their turns, so that one run's load does not
    // time another's.
    fileParallelism: false,
  },
})
