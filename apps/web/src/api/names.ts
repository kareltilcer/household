// The names the web app and the API share that are no part of the generated client: where the
// API is served, and the cookie whose value proves a request is the app's own (ADR 0009). A file
// of its own, with nothing imported: the end-to-end suite reads it on Node.

/** Where the API is served: this origin's own `/api/v1`, in production and behind the dev proxy. */
export const apiPath = '/api/v1'

/** The cookie the server sets beside the session's, readable so that a script can send it back. */
export const csrfCookie = '__Host-hh_csrf'
