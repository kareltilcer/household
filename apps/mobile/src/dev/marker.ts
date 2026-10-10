// What every dev screen holds and no production bundle may: `DevScreen` writes it into each
// one's `testID`, and build/check.ts searches an export for it, as the web's check searches its
// build for the harness's cells. It is imported by src/dev alone: a file a production bundle
// holds that imported it would carry the string with it.
export const devMarker = 'household-dev-screen'

/** The dev screens, by the name each one's `testID` ends in. */
export type DevPage = 'index' | 'harness' | 'primitives' | 'shell' | 'sync' | 'engine' | 'sign-in'
