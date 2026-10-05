// Writes tokens.css from src/css.ts: the package's `css` script, which `pnpm run gen` runs. The
// stylesheet is committed, so that both clients find it without a build and a token's change
// shows in a diff, and src/css.test.ts fails a committed one that is not what this writes.
import { writeFileSync } from 'node:fs'
import { stylesheet } from '../src/css.ts'

writeFileSync(new URL('../tokens.css', import.meta.url), stylesheet())
