// Where the preview server listens: Vite serves a build there (vite.config.ts), and the
// end-to-end suite asks it for pages (playwright.config.ts). 127.0.0.1, not localhost, which a
// Windows machine may resolve to ::1 while the server listens on IPv4.
export const preview = { host: '127.0.0.1', port: 4173 } as const

/** The origin a page of the previewed build has. */
export const previewOrigin = `http://${preview.host}:${String(preview.port)}`

/**
 * Where the API listens beside the web app, which the development server and the preview server
 * both proxy `/api` to: `pnpm run dev:api`'s address, and the one the end-to-end suite starts its
 * own API on, since PowerSync's development configuration fetches its keys from there
 * (deploy/powersync/powersync.yaml).
 */
export const api = { host: '127.0.0.1', port: 8080 } as const

/** The API's origin, as a proxy and a test reach it. */
export const apiOrigin = `http://${api.host}:${String(api.port)}`

/**
 * Where the end-to-end suite's stand-in for Stripe listens (server/cmd/stripe-standin): the
 * loopback, which is all it listens on, at the port beside stripe-mock's (docker-compose.yml).
 * Stripe's API is under `/v1` there, and what drives the stand-in, the payment form's
 * confirmation and what Stripe does on its own, under `/_standin`. The suite starts it
 * (playwright.config.ts) and asks it from Node (e2e/stack.ts): no page reaches it.
 */
export const stripeStandIn = { host: '127.0.0.1', port: 12112 } as const

/** The stand-in's origin, as the suite's API and its tests reach it. */
export const stripeStandInOrigin = `http://${stripeStandIn.host}:${String(stripeStandIn.port)}`
