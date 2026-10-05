// Writes src/lucide.json and LICENSE.lucide from the pinned lucide-static: the package's `vendor`
// script, which `pnpm run gen` runs and a change of the pin or of the manifest calls for.
import { writeFileSync } from 'node:fs'
import { vendor } from './lucide.ts'

const { json, license } = vendor()
writeFileSync(new URL('../src/lucide.json', import.meta.url), json)
writeFileSync(new URL('../LICENSE.lucide', import.meta.url), license)
