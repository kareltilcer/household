// The implementation plan's numbers are its build order (docs/implementation-plan.md, rule 6 of
// *Rules for changing the plan*): every item an item's after list names has a lower number, so
// the lowest-numbered planned item can always start. Nothing else fails when a rewrite makes an
// item wait for a later one, which is how Sync engine II came to wait for two items numbered
// after it.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const lines = readFileSync(join(root, 'docs', 'implementation-plan.md'), 'utf8').split(/\r?\n/)

interface Item {
  readonly number: number
  readonly after: readonly number[]
}

/** The items an after list names: `—` for none, `a–b` for a range, a note in parentheses last. */
function named(list: string): number[] {
  const bare = list.replace(/\s*\(.*\)$/, '')
  if (bare === '—') return []
  return bare.split(/,\s*/).flatMap((part) => {
    const range = /^(\d+)–(\d+)$/.exec(part)
    if (range?.[1] !== undefined && range[2] !== undefined) {
      const [from, to] = [Number(range[1]), Number(range[2])]
      return Array.from({ length: to - from + 1 }, (_, i) => from + i)
    }
    if (/^\d+$/.test(part)) return [Number(part)]
    throw new Error(`the after list "${list}" names "${part}", which is not an item`)
  })
}

const items: Item[] = lines.flatMap((line, i) => {
  const heading = /^### (\d+) · /.exec(line)
  if (heading?.[1] === undefined) return []
  const meta = /^(?:Phase \d|Content) · after (.+?) · size /.exec(lines[i + 2] ?? '')
  if (meta?.[1] === undefined) throw new Error(`item ${heading[1]} has no after list under it`)
  return [{ number: Number(heading[1]), after: named(meta[1]) }]
})

describe('docs/implementation-plan.md', () => {
  it('numbers its items from 1, in the order they appear', () => {
    expect(items.length).toBeGreaterThan(0)
    expect(items.map((item) => item.number)).toEqual(items.map((_, i) => i + 1))
  })

  it('makes every item wait only for items numbered before it', () => {
    const later = items.flatMap((item) =>
      item.after
        .filter((n) => n >= item.number)
        .map((n) => `${String(item.number)} after ${String(n)}`),
    )
    expect(later).toEqual([])
  })
})
