// The end-to-end suite (PL-3, 06-clients §8): Playwright's Chromium against a production build of
// the app, served as a deployment would serve it, under the policy of build/csp.ts. The build is
// `vite build --mode e2e`, which has the dev-only routes, the twelve-state harness among them:
// run `pnpm run build:e2e` before `pnpm run e2e`, as CI does.
import { defineConfig, devices } from '@playwright/test'
import { previewOrigin } from './build/preview.ts'

const ci = process.env.CI !== undefined

export default defineConfig({
  testDir: 'e2e',
  // Under dist/, which git, ESLint and Prettier already leave alone.
  outputDir: 'dist/test-results',
  fullyParallel: true,
  forbidOnly: ci,
  reporter: [['list']],
  use: {
    baseURL: previewOrigin,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'vite preview --outDir dist/e2e',
    url: previewOrigin,
    reuseExistingServer: !ci,
    timeout: 60_000,
  },
})
