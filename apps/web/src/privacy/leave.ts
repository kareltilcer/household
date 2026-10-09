// How the page hands the browser an address that is not the app's own: an archive's pre-signed
// link at the object store. It is a navigation and never a request of the page's: the policy's
// `connect-src` does not admit the object store (build/csp.ts), and the store answers the link
// as an attachment, so the browser saves the file and the page stays where it is. A file of its
// own, so that a test names what was opened and no test navigates.
export function leaveFor(url: string): void {
  window.location.assign(url)
}
