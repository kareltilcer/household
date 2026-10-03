import { vectors } from '@household/test-vectors'
import { runVectors } from '@household/test-vectors/vitest'
import { describe } from 'vitest'
import { Digest, pairHash } from './digest.ts'
import { hex64, utf8, xxh3 } from './xxh3.ts'

// The report's hashes are the shared vectors' (D-37): the server computes the same in
// server/internal/platform/replica, so a replica and the server agree on every row's pair.
describe('vectors/replica-digest.json', () => {
  runVectors(
    vectors['replica-digest'],
    {
      xxh3: ({ text }) => hex64(xxh3(utf8(text))),
      pair: ({ entity_id, version }) => hex64(pairHash(entity_id, version)),
      entry: ({ pairs }) => {
        const d = new Digest()
        for (const p of pairs) d.add(p.entity_id, p.version)
        return { count: d.count, hash: d.hex }
      },
    },
    (error) => (error instanceof Error ? error.message : undefined),
  )
})
