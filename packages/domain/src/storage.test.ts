import { vectors } from '@household/test-vectors'
import { runVectors } from '@household/test-vectors/vitest'
import { describe, expect, it } from 'vitest'
import {
  averageBytes,
  gigabyte,
  projectedAverageBytes,
  storageAllowance,
  storageBlocks,
  storageCharge,
} from './storage.ts'

describe('vectors/storage.json', () => {
  runVectors(
    vectors.storage,
    {
      average: (samples) => averageBytes(samples),
      blocks: (average) => storageBlocks(average),
      charge: ({ average_bytes, unit_amount_minor }) =>
        storageCharge(average_bytes, unit_amount_minor),
      projected: ({ samples, current, remaining }) =>
        projectedAverageBytes(samples, current, remaining),
    },
    () => undefined,
  )
})

describe('the allowance', () => {
  it('is 5 GB, then 10 GB blocks, 205 GB in all', () => {
    const { baseBytes, blockBytes, maxBlocks } = storageAllowance
    expect(baseBytes + blockBytes * maxBlocks).toBe(205 * gigabyte)
  })

  it('counts blocks against an allowance of its own', () => {
    const small = { baseBytes: gigabyte, blockBytes: gigabyte, maxBlocks: 2 }
    expect(storageBlocks(gigabyte + 1, small)).toBe(1)
    expect(storageBlocks(10 * gigabyte, small)).toBe(2)
  })

  it('projects nothing for days that cannot be left', () => {
    expect(projectedAverageBytes([4, 6], 100, -3)).toBe(5)
  })
})
