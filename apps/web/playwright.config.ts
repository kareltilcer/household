// The end-to-end suite (PL-3, 06-clients §8): Playwright's Chromium against a production build of
// the app, served as a deployment would serve it, under the policy of build/csp.ts, with the API
// behind it. The build is `vite build --mode e2e`, which has the dev-only routes, the twelve-state
// harness among them. `pnpm run e2e` writes it and then runs the suite, so that no run is of an
// older build's files: the preview server below serves whatever `dist/e2e` holds.
//
// The three servers are the suite's own, started for the run and stopped after it: one found
// listening already is refused and not used, since nothing says which build, or which
// configuration, it serves. The API runs on the development services, which the suite does not
// start: `pnpm run up`, `pnpm run db:setup` and `pnpm run up:sync` come first (e2e/stack.ts).
//
// The third stands in for Stripe (server/cmd/stripe-standin): the API asks it where it would ask
// Stripe, and it tells the API what Stripe would, so the suite pays with no account at Stripe, no
// secret and no network to it. A payment in Stripe's own test mode is staging's
// (docs/runbooks/billing.md).
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import {
  api,
  apiOrigin,
  previewOrigin,
  stripeStandIn,
  stripeStandInOrigin,
} from './build/preview.ts'
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

/** The server's sources, which both of its commands the suite starts are run from. */
const server = fileURLToPath(new URL('../../server', import.meta.url))

/**
 * The plans of the stand-in's account, as `go run ./cmd/stripe-standin prices` prints them from
 * `server/`: PRD 04 §1's figures, each with the price the stand-in charges it by. The API is given
 * them, so that what it shows is what the stand-in charges, and so is the stand-in, which does
 * not start on plans that are not its own: figures that drift apart stop the run here.
 */
const stripeStandInPrices = JSON.stringify({
  EUR: {
    year: { amount_minor: 5988, price: 'price_eur_year' },
    month: { amount_minor: 599, price: 'price_eur_month' },
    block: { amount_minor: 100, price: 'price_eur_block' },
  },
  GBP: {
    year: { amount_minor: 5388, price: 'price_gbp_year' },
    month: { amount_minor: 549, price: 'price_gbp_month' },
    block: { amount_minor: 100, price: 'price_gbp_block' },
  },
})

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
      //
      // And it is told of billing: that Stripe is the stand-in below, which only a development
      // server may be told, and then only with test-mode keys; the stand-in's own three keys, the
      // published ones of the server's tests (internal/platform/billing/billingtest), which open
      // nothing anywhere else; and the stand-in's plans, since a server with keys takes no plan
      // that names no price.
      command: 'go run ./cmd/household-api serve',
      cwd: server,
      env: {
        HOUSEHOLD_ENV: 'development',
        HOUSEHOLD_HTTP_ADDR: apiAddress,
        HOUSEHOLD_WEB_URL: previewOrigin,
        HOUSEHOLD_TRUSTED_PROXIES: '127.0.0.1/32',
        HOUSEHOLD_LOG_LEVEL: 'warn',
        HOUSEHOLD_STRIPE_API_URL: stripeStandInOrigin,
        HOUSEHOLD_STRIPE_SECRET_KEY: 'sk_test_standin',
        HOUSEHOLD_STRIPE_PUBLISHABLE_KEY: 'pk_test_standin',
        HOUSEHOLD_STRIPE_WEBHOOK_SECRET: 'whsec_standin',
        HOUSEHOLD_BILLING_PRICES: stripeStandInPrices,
      },
      url: `${apiOrigin}${apiPath}/readyz`,
      reuseExistingServer: false,
      // The first run compiles the server.
      timeout: 5 * 60_000,
    },
    {
      // The stand-in for Stripe, which is told three things: where it listens, which is where the
      // API above asks it; where the API's webhook is, on the loopback however the API listens,
      // which it posts Stripe's events to itself, each before the request that caused it is
      // answered; and the plans the API was given, which it holds to its own.
      command: 'go run ./cmd/stripe-standin serve',
      cwd: server,
      env: {
        STRIPE_STANDIN_ADDR: `${stripeStandIn.host}:${String(stripeStandIn.port)}`,
        STRIPE_STANDIN_WEBHOOK_URL: `${apiOrigin}${apiPath}/webhooks/stripe`,
        HOUSEHOLD_BILLING_PRICES: stripeStandInPrices,
      },
      url: `${stripeStandInOrigin}/_standin/health`,
      reuseExistingServer: false,
      // The first run compiles it.
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
