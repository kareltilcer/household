/**
 * @household/test-vectors — JSON files of inputs and expected outputs, run by the Go and the
 * Vitest suites alike, so two implementations of one rule cannot drift (D-37). The format is
 * in README.md; the Vitest runner is `@household/test-vectors/vitest`, and the Go runner is
 * server/internal/platform/vectors.
 */
import i18n from '../vectors/i18n.json'
import money from '../vectors/money.json'

/** One case: an input, and either the output it gives or the code of the error it raises. */
export interface VectorCase {
  readonly name: string
  readonly input: unknown
  readonly output?: unknown
  readonly error?: string
}

/** A vector file: what it holds, where its expectations come from, and its cases by group. */
export interface VectorFile {
  readonly description: string
  readonly sources: readonly string[]
  readonly groups: Readonly<Record<string, readonly VectorCase[]>>
}

/** Every vector file, by the name its file has in vectors/. */
export const vectors = { i18n, money } satisfies Readonly<Record<string, VectorFile>>

const fileFields: ReadonlySet<string> = new Set(['description', 'sources', 'groups'])
const caseFields: ReadonlySet<string> = new Set(['name', 'input', 'output', 'error'])

/**
 * What is wrong with `file` as a vector file, beyond its shape: a field the format does not
 * have, a group with no cases, two cases of one name in a group, or a case with both an
 * output and an error, or neither. The Go runner refuses the same.
 */
export function problems(file: VectorFile): string[] {
  const found: string[] = []
  for (const field of Object.keys(file)) {
    if (!fileFields.has(field)) found.push(`an unknown field ${JSON.stringify(field)}`)
  }
  if (file.description.trim() === '') found.push('no description')
  if (file.sources.length === 0) found.push('no sources')
  const groups = Object.entries(file.groups)
  if (groups.length === 0) found.push('no groups')
  for (const [group, cases] of groups) {
    if (cases.length === 0) found.push(`${group}: no cases`)
    const names = new Set<string>()
    for (const c of cases) {
      for (const field of Object.keys(c)) {
        if (!caseFields.has(field)) {
          found.push(
            `${group}: ${JSON.stringify(c.name)} has an unknown field ${JSON.stringify(field)}`,
          )
        }
      }
      if (c.name.trim() === '') found.push(`${group}: a case with no name`)
      if (names.has(c.name)) found.push(`${group}: two cases named ${JSON.stringify(c.name)}`)
      names.add(c.name)
      if ('output' in c === 'error' in c) {
        found.push(
          `${group}: ${JSON.stringify(c.name)} has both an output and an error, or neither`,
        )
      }
      if ('error' in c && (typeof c.error !== 'string' || c.error === '')) {
        found.push(`${group}: ${JSON.stringify(c.name)} has an error that is not a code`)
      }
    }
  }
  return found
}
