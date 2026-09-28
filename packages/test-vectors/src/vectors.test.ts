import { describe, expect, it } from 'vitest'
import { problems, vectors, type VectorFile } from './index.ts'

describe.each(Object.entries(vectors))('vectors/%s.json', (_, file: VectorFile) => {
  it('is well formed', () => {
    expect(problems(file)).toEqual([])
  })
})

describe('the format check', () => {
  const file = (cases: VectorFile['groups'][string]): VectorFile => ({
    description: 'd',
    sources: ['s'],
    groups: { g: cases },
  })

  it.each([
    [file([]), 'g: no cases'],
    [
      file([
        { name: 'a', input: 1, output: 1 },
        { name: 'a', input: 2, output: 2 },
      ]),
      'g: two cases named "a"',
    ],
    [file([{ name: 'a', input: 1 }]), 'g: "a" has both an output and an error, or neither'],
    [
      file([{ name: 'a', input: 1, output: 1, error: 'x' }]),
      'g: "a" has both an output and an error, or neither',
    ],
    [file([{ name: 'a', input: 1, error: '' }]), 'g: "a" has an error that is not a code'],
  ])('refuses %j', (f, problem) => {
    expect(problems(f)).toContain(problem)
  })
})
