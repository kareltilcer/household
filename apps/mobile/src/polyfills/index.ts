// What the shared packages ask of an engine and Hermes does not have, installed before any of
// them is imported: the app's entry imports this file first (index.ts), and so does Jest's
// setup (src/test/setup.ts), so a test runs through the code a device runs.
import './crypto.ts'
import './intl.ts'
