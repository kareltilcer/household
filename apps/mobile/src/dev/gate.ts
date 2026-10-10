// Whether the dev screens are in this build (D-154: a dev-only page is in no build a deployment
// serves). They are in a development build, and in the build the end-to-end flows run against,
// which is made with `EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS=1`; a store's build has neither.
//
// This constant is for whatever asks at run time, a row that leads to the dev screens. It is
// not what keeps them out of a bundle: Metro folds a condition only where it is written, so
// each route file under app/dev/ writes this same expression out and imports its screen behind
// it, and build/check.ts fails a production export that holds the screens' marker.
export const devScreens: boolean = __DEV__ || process.env.EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS === '1'
