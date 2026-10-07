// Where the preview server listens: Vite serves a build there (vite.config.ts), and the
// end-to-end suite asks it for pages (playwright.config.ts). 127.0.0.1, not localhost, which a
// Windows machine may resolve to ::1 while the server listens on IPv4.
export const preview = { host: '127.0.0.1', port: 4173 } as const

/** The origin a page of the previewed build has. */
export const previewOrigin = `http://${preview.host}:${String(preview.port)}`
