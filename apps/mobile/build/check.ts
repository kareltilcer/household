// `pnpm --filter @household/mobile run check`: what an export a store's build is made of is held
// to, read off the files `expo export` wrote to dist/ (06-clients §8). It exits 1 when the
// export
//
// - carries a dev screen: the harness and its neighbours are in no build a member is served
//   (D-154). Each holds one marker (src/dev/marker.ts), and a bundle is searched for it as bytes,
//   so Hermes bytecode is read as plain JavaScript is.
//
// It reads the export made with no `EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS`: the end-to-end build is
// made with it and holds the dev screens by design, so this check is not run on that one. An
// argument names another directory to read than dist/.
import { existsSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { bundlesOf, check } from './bundles.ts'

const root = resolve(process.argv[2] ?? 'dist')
if (!existsSync(root) || bundlesOf(root).length === 0) {
  console.error(`check: ${root} holds no export. Run \`pnpm run export\` first.`)
  process.exit(1)
}
const { failures, bundles } = check(root)
for (const file of bundles) {
  console.log(`bundle ${relative(root, file)}: ${String(statSync(file).size)} bytes`)
}
if (failures.length > 0) {
  for (const failure of failures) console.error(`check: ${failure}`)
  process.exit(1)
}
console.log(`check: ${String(bundles.length)} bundles, no dev screen`)
