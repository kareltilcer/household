// The end-to-end suite (PL-3, 06-clients §8): Playwright's Chromium against a production build of
// the app, served as a deployment would serve it, under the policy of build/csp.ts. The build is
// `vite build --mode e2e`, which has the dev-only routes, the twelve-state harness among them.
// `pnpm run e2e` writes it and then runs the suite, so that no run is of an older build's files:
// the server below serves whatever `dist/e2e` holds. It is the suite's own, started for the run
// and stopped after it: a server found listening there already is refused and not used, since
// nothing says which build it serves.
import { defineConfig, devices } from '@playwright/test'
import { previewOrigin } from './build/preview.ts'

const ci = process.env.CI !== undefined

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
  webServer: {
    command: 'vite preview --outDir dist/e2e',
    url: previewOrigin,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
