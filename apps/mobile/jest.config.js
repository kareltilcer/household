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
  // And a module named `.mjs` or `.cjs` is one Metro transforms too, where the preset's
  // pattern stops at `.js`: PowerSync's SDK ships such files.
  transform: { '\\.[cm]js$': babel },
  // The replica's SQLite has a native half and no other: a stand-in is imported in its place.
  moduleNameMapper: { '^@op-engineering/op-sqlite$': '<rootDir>/src/test/op-sqlite.ts' },
}
