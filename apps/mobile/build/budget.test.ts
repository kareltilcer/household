// The bundle budget's own arithmetic, asked of a folder laid out as an export is. That a real
// export is under it is seen by running it: `pnpm run export` and then `pnpm run check`.
import { describe, expect, it } from '@jest/globals'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { budgetOf, measure, measured, over, platformOf, platforms } from './budget.ts'

/** An export's folder, with each of `files` in it, a path under the bundles' folder and its bytes. */
function exported(files: Readonly<Record<string, number>>): string {
  const root = mkdtempSync(join(tmpdir(), 'household-mobile-budget-'))
  for (const [file, bytes] of Object.entries(files)) {
    const path = join(root, '_expo', 'static', 'js', ...file.split('/'))
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, Buffer.alloc(bytes))
  }
  return root
}

describe('the bundle budget', () => {
  it('is what a platform measured and a fifth over it', () => {
    for (const platform of platforms) {
      expect(measured[platform]).toBeGreaterThan(0)
      expect(budgetOf(platform)).toBe(measured[platform] + Math.floor(measured[platform] / 5))
    }
  })

  it('reads a bundle’s platform off the folder an export keeps it in', () => {
    const root = join('some', 'dist')
    expect(platformOf(root, join(root, '_expo', 'static', 'js', 'android', 'index-1.hbc'))).toBe(
      'android',
    )
    expect(platformOf(root, join(root, '_expo', 'static', 'js', 'ios', 'index-2.hbc'))).toBe('ios')
    expect(
      platformOf(root, join(root, '_expo', 'static', 'js', 'web', 'index-3.js')),
    ).toBeUndefined()
  })

  it('counts each platform’s bytecode, every file of it, and nothing else', () => {
    const root = exported({
      'android/index-1.hbc': 700,
      'android/later-2.hbc': 300,
      // Not bytecode: an export made to be read, which no build embeds.
      'android/index-1.js': 5000,
      'ios/index-3.hbc': 400,
    })
    try {
      expect(measure(root)).toEqual([
        { platform: 'android', files: 2, bytes: 1000, limit: budgetOf('android') },
        { platform: 'ios', files: 1, bytes: 400, limit: budgetOf('ios') },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('passes a platform at its budget and fails one a byte over, by name', () => {
    const root = exported({ 'android/index-1.hbc': 1, 'ios/index-2.hbc': 1 })
    try {
      const at = (file: string) => budgetOf(file.includes('android') ? 'android' : 'ios')
      expect(over(measure(root, at))).toEqual([])

      const failures = over(measure(root, (file) => at(file) + (file.includes('ios') ? 1 : 0)))
      expect(failures).toHaveLength(1)
      expect(failures[0]).toContain('ios')
      expect(failures[0]).toContain('over its budget')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails an export that holds no bytecode for a platform, which would measure nothing', () => {
    const root = exported({ 'android/index-1.hbc': 10, 'ios/index-2.js': 10 })
    try {
      const failures = over(measure(root))
      expect(failures).toHaveLength(1)
      expect(failures[0]).toContain('no bytecode for ios')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
