// The app's entry, which package.json's `main` names. The polyfills come first and expo-router's
// entry after them: it loads every route, and with a route the shared packages, which draw an
// id and format a number as soon as they are asked.
import './src/polyfills/index.ts'
import 'expo-router/entry'
