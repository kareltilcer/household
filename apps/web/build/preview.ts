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
