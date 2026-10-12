// `node build/apk.ts <file> [variant]`: what a built APK asks of its device, held to the list
// that says what each permission is for (asked.ts, FR-PR1). The file is what
// `aapt2 dump permissions <apk>` printed; the variant is the build's, development's where none
// is said, which is the one CI builds. It exits 1 on a permission with no reason, and on one
// the list names that the build does not ask for.
import { existsSync, readFileSync } from 'node:fs'
import { judge, read, type Built } from './asked.ts'

const [file, named = 'development'] = process.argv.slice(2)
const variants: readonly Built[] = ['development', 'staging', 'production']
const variant = variants.find((known) => known === named)
if (file === undefined || !existsSync(file) || variant === undefined) {
  console.error('apk: which list, of which variant? `node build/apk.ts <file> [variant]`.')
  process.exit(2)
}
const dump = readFileSync(file, 'utf8')
const failures = judge(dump, variant)
if (failures.length > 0) {
  for (const failure of failures) console.error(`apk: ${failure}`)
  process.exit(1)
}
console.log(
  `apk: the ${variant} build asks for ${String(read(dump).names.length)} permissions, each with its reason`,
)
