// Jest for the mobile app (PL-3): jest-expo's preset, which is React Native's own with Expo's
// modules stood in for and Babel run as Metro runs it, so a test's module is the bundle's.
import preset from 'jest-expo/jest-preset.js'

/** Babel as the preset hands it to Jest: Expo's own preset, called as Metro calls it. */
const babel = Object.values(preset.transform).find(
  (transformer) => Array.isArray(transformer) && transformer[0] === 'babel-jest',
)

export default {
  preset: 'jest-expo',
  // Before a test file's first import: the engine cut down to what Hermes has, then the
  // polyfills the app's entry loads (src/test/setup.ts).
  setupFiles: ['<rootDir>/src/test/setup.ts'],
  // Metro transforms every module it bundles, a dependency's as the app's own, and so does
  // Jest here. The preset would leave node_modules alone but for a list of names, which under
  // pnpm's layout is read at each package's own folder: a dependency published as ES modules
  // alone (uuid, intl-messageformat, FormatJS's polyfills, PowerSync's SDK) would have to be on
  // it, and the next one added would fail until somebody knew to add it. Babel's own preset
  // stays out, being part of the transformer.
  transformIgnorePatterns: ['/node_modules/@react-native/babel-preset/'],
  // Which is why a file's first test may wait on Babel for most of React Native where nothing
  // is cached yet, as on CI's runner at every run: Jest's five seconds are that test's alone.
  testTimeout: 60_000,
  // And a module named `.mjs` or `.cjs` is one Metro transforms too, where the preset's
  // pattern stops at `.js`: PowerSync's SDK ships such files.
  transform: { '\\.[cm]js$': babel },
  moduleNameMapper: {
    // The replica's SQLite has a native half and no other: a stand-in is imported in its place.
    '^@op-engineering/op-sqlite$': '<rootDir>/src/test/op-sqlite.ts',
    // And so has the device's key-value store: the library's own stand-in, which keeps what a
    // test wrote for as long as the test file runs.
    '^@react-native-async-storage/async-storage$':
      '@react-native-async-storage/async-storage/jest/async-storage-mock',
    // And what says whether the device has a connection: the library's own stand-in, which
    // answers that it has one until a test says otherwise.
    '^@react-native-community/netinfo$': '@react-native-community/netinfo/jest/netinfo-mock.js',
  },
}
