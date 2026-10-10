// Every write that is no part of a replica is asked at once, connection or none (D-164, D-170):
// the sources say so, each file as it is written. The web holds its screens to the same by the
// same reading (apps/web/src/api/api.test.ts); what `askedNow` does is api.test.tsx's.
import { describe, expect, it, jest } from '@jest/globals'

/** Node's own, asked for by name: the app's sources know nothing of Node, and its tests read them. */
interface Files {
  readonly readdirSync: (
    path: string,
    options: { readonly recursive: true; readonly encoding: 'utf8' },
  ) => string[]
  readonly readFileSync: (path: string, encoding: 'utf8') => string
}

const files = jest.requireActual<Files>('node:fs')

/**
 * The directories whose writes are no replica's: the session's, push's, a household's own
 * answer, what stands beside them, and the dev screens' sign-in, which is the one screen of
 * this build that signs anybody in. Jest runs in apps/mobile.
 */
const directories = [
  'src/session',
  'src/push',
  'src/household',
  'src/links',
  'src/update',
  'src/dev/signin',
]

const sources = directories.flatMap((directory) =>
  files
    .readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .map((name) => `${directory}/${name.replaceAll('\\', '/')}`)
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
    .map((path) => ({ path, source: files.readFileSync(path, 'utf8') })),
)

describe('a write that must not wait', () => {
  // A device registered for notifications, or its registration removed, when a connection
  // returns, minutes after the press and with nobody at the screen, is not what was asked for.
  it('is every write of the session, of push and of a household’s own answer', () => {
    const writes = sources.flatMap(({ path, source }) =>
      [...source.matchAll(/useMutation\(\{\s*(\S+)/g)].map(([, first = '']) => ({ path, first })),
    )
    // The sources were read at all: every directory is among them, and the two that write.
    expect(new Set(sources.map(({ path }) => path.split('/')[1]))).toEqual(
      new Set(['session', 'push', 'household', 'links', 'update', 'dev']),
    )
    expect(writes.map(({ path }) => path)).toContain('src/push/usePush.ts')
    expect(writes.map(({ path }) => path)).toContain('src/dev/signin/index.tsx')
    expect(writes.filter(({ first }) => first !== '...askedNow,')).toEqual([])
    // And no mutation is written any other way than the one that is read here: each naming of
    // `useMutation` is its import or a write that was read.
    const named = sources.flatMap(({ source }) => [...source.matchAll(/useMutation\b/g)])
    const imported = sources.filter(({ source }) => /import \{[^}]*\buseMutation\b/.test(source))
    expect(named.length - imported.length).toBe(writes.length)
  })

  it('is read out of a source that does not ask so, where there is one', () => {
    const source = 'const on = useMutation({\n    mutationFn: () => subscribe(),\n  })'
    const [, first] = /useMutation\(\{\s*(\S+)/.exec(source) ?? []
    expect(first).toBe('mutationFn:')
  })
})
