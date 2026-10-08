// The end-to-end suite (PL-3, 06-clients §8): Playwright's Chromium against a production build of
// the app, served as a deployment would serve it, under the policy of build/csp.ts, with the API
// behind it. The build is `vite build --mode e2e`, which has the dev-only routes, the twelve-state
// harness among them. `pnpm run e2e` writes it and then runs the suite, so that no run is of an
// older build's files: the preview server below serves whatever `dist/e2e` holds.
//
// Both servers are the suite's own, started for the run and stopped after it: one found
// listening already is refused and not used, since nothing says which build, or which
// configuration, it serves. The API runs on the development services, which the suite does not
// start: `pnpm run up`, `pnpm run db:setup` and `pnpm run up:sync` come first (e2e/stack.ts).
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { api, apiOrigin, previewOrigin } from './build/preview.ts'
import { apiPath } from './src/api/names.ts'
import { devPagesMode } from './src/app/paths.ts'

const ci = process.env.CI !== undefined

/**
 * Where the suite's API listens: the loopback, unless the environment names another interface.
 * PowerSync, in its container, fetches the keys it verifies a replica's token with from the API
 * at `host.docker.internal`, which on a Linux runner is the docker bridge's address and not the
 * loopback, so CI has it listen on every interface, as the conformance suite's does.
 */
const apiAddress = process.env.HOUSEHOLD_E2E_API_ADDR ?? `${api.host}:${String(api.port)}`

export default defineConfig({
  testDir: 'e2e',
  // Under dist/, which git, ESLint and Prettier already leave alone.
  outputDir: 'dist/test-results',
  fullyParallel: true,
  forbidOnly: ci,
  // Patience, not leniency: no test asserts less for it. The harness is 216 cells under axe, and a
  // CI runner, or a developer's machine with other work on it, runs the suite at a third of the
  // speed of an idle one: at Playwright's own 30 s and 5 s, two tests ran out of time there with
  // nothing wrong on the page. A test that calls `test.slow()` has three times this.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: previewOrigin,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // The server itself, on the development stack's database, object store and mail catcher,
      // which are its defaults in development. It is told three things: where it listens, which
      // is where the preview server's proxy and PowerSync's configuration look for it; where the
      // web client is, which is the origin it takes an unsafe request from and the address its
      // emails link to; and that the preview server's proxy is one, whose word for where a
      // request came from it takes, so that each test is a network of its own (e2e/stack.ts).
      command: 'go run ./cmd/household-api serve',
      cwd: fileURLToPath(new URL('../../server', import.meta.url)),
      env: {
        HOUSEHOLD_ENV: 'development',
        HOUSEHOLD_HTTP_ADDR: apiAddress,
        HOUSEHOLD_WEB_URL: previewOrigin,
        HOUSEHOLD_TRUSTED_PROXIES: '127.0.0.1/32',
        HOUSEHOLD_LOG_LEVEL: 'warn',
      },
      url: `${apiOrigin}${apiPath}/readyz`,
      reuseExistingServer: false,
      // The first run compiles the server.
      timeout: 5 * 60_000,
    },
    {
      // In the build's own mode: the policy the server sends is the one the build wrote into
      // its page, the sync service's origin among it (vite.config.ts).
      command: `vite preview --outDir dist/e2e --mode ${devPagesMode}`,
      url: previewOrigin,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
