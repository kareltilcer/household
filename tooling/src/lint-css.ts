// `pnpm run lint:css`: the clients' stylesheets held to stylesheets.ts, which `pnpm run lint` and
// CI run. It reads every stylesheet under apps/ that is the app's own, none of its dependencies'
// and none a build wrote, and exits 1 if one spends a raw colour or a primitive. An argument
// names another directory to read apps/ under than the repository, which the test of this uses.
import { globSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lintStylesheet, messages } from './stylesheets.ts'

const root = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
const skipped = /(^|\/)(node_modules|dist|coverage|\.turbo|\.expo)\//

const files = globSync('apps/**/*.css', { cwd: root })
  .map((file) => file.split('\\').join('/'))
  .filter((file) => !skipped.test(file))
  .sort()

const findings = files.flatMap((file) =>
  lintStylesheet(readFileSync(join(root, file), 'utf8'), file),
)
for (const finding of findings) {
  console.error(
    `${finding.file}:${String(finding.line)}:${String(finding.column)}  ${finding.text}\n` +
      `  ${messages[finding.rule]}`,
  )
}
console.log(
  `lint:css: ${String(files.length)} stylesheets, ${String(findings.length)} raw colours or primitives`,
)
process.exitCode = findings.length > 0 ? 1 : 0
