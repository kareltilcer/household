// The Vitest runner: one `describe` per group and one test per case, so a failure names the
// file's group and case. Its Go twin is server/internal/platform/vectors.
import { describe, expect, it } from 'vitest'
import { problems, type VectorFile } from './index.ts'

/**
 * One subject per group of `F`, each taking that group's input as the file declares it and
 * returning its output. A group without a subject, or a subject for a group the file does
 * not have, fails the type check: every case is run on this side.
 */
export type Subjects<F extends VectorFile> = {
  readonly [G in keyof F['groups']]: (input: F['groups'][G][number]['input']) => unknown
}

/**
 * Runs every case of `file`. A case with an `output` passes when its subject returns a value
 * deeply equal to it; a case with an `error` passes when its subject throws and `codeOf`
 * reads the error's code as that code.
 */
export function runVectors<F extends VectorFile>(
  file: F,
  subjects: Subjects<F>,
  codeOf: (error: unknown) => string | undefined,
): void {
  it('is a well-formed vector file', () => {
    expect(problems(file)).toEqual([])
  })
  const run: Readonly<Record<string, (input: unknown) => unknown>> = subjects
  for (const [group, cases] of Object.entries(file.groups)) {
    describe(group, () => {
      it.each(cases)('$name', (c) => {
        const subject = run[group]
        if (subject === undefined) throw new Error(`no subject for group ${group}`)
        if (c.error === undefined) {
          expect(subject(c.input)).toEqual(c.output)
          return
        }
        let output: unknown
        try {
          output = subject(c.input)
        } catch (error) {
          expect(codeOf(error), String(error)).toBe(c.error)
          return
        }
        expect.fail(`expected error ${c.error}, got ${JSON.stringify(output)}`)
      })
    })
  }
}
