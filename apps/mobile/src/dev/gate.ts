// Whether the dev screens are in this build (D-154: a dev-only page is in no build a deployment
// serves). They are in a development build, and in the build the end-to-end flows run against,
// which is made with `EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS=1`; a store's build has neither.
//
// This file is the one place the condition is written to be read, and it is imported by
// nothing. Metro folds a condition only where it is written: a value imported from here is one
// it cannot fold, and the screens behind it would be in every bundle. So each route file under
// app/dev/ writes this same expression out and imports its screen behind it, and so do the two
// controls that lead to the dev screens (src/session/SignIn.tsx, src/shell/More.tsx). A test
// reads the expression off the line below and holds each of those places to exactly it, and
// this file to being imported by none (build/check.test.ts); build/check.ts fails a production
// export that holds the screens' marker.
export const devScreens: boolean = __DEV__ || process.env.EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS === '1'
