// Where the browser smoke test's page is served from: an origin the API the suite starts allows an
// unsafe request from (HOUSEHOLD_ALLOWED_ORIGINS, stack/stack.ts), as the web app's own is.
export const webPort = 63315
export const webOrigin = `http://localhost:${String(webPort)}`
