// The web replica's smoke test (plan item 18): @household/sync's web build, PowerSync's web SDK on
// wa-sqlite over IndexedDB, in a real browser (Playwright's Chromium) against the conformance stack.
// The API is reached through this server's proxy, as the web app reaches its own; PowerSync, which
// answers any origin, directly.
import { resolve } from 'node:path'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { apiUrl } from '../harness/env.ts'
import { webOrigin, webPort } from './origin.ts'

export default defineConfig({
  root: resolve(import.meta.dirname, '../..'),
  // PowerSync's web SDK loads its SQLite as WebAssembly in workers of its own, which Vite's dependency
  // optimiser would bundle away from the files they load.
  optimizeDeps: { exclude: ['@powersync/web', '@journeyapps/wa-sqlite'] },
  worker: { format: 'es' },
  // The suite's sign-in alone: the rest of /conformance is this package's own files.
  server: { proxy: { '/api': apiUrl, '/conformance/sign-in': apiUrl } },
  test: {
    include: ['conformance/web/**/*.test.ts'],
    globalSetup: ['conformance/suite/setup.ts', 'conformance/web/setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 5 * 60_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
    // The page's own origin, fixed: the API allows an unsafe request from it alone.
    api: { host: new URL(webOrigin).hostname, port: webPort, strictPort: true },
  },
})
