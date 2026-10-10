// How a member's replica of a household is opened on a device, held and removed (ADR 0019,
// FR-ID7): what the library is handed, that one file is one open replica however many hold it,
// and that a sign-in which ended takes its member's replicas with it, wiped, closed and their
// files deleted. The library's own opening and SQLite are stood in for: nothing on a developer's
// machine opens a device's database, and a replica's behaviour is the conformance suite's.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { NeedsConnection, Revoked, type Replica } from '@household/sync'
import type { NativeReplicaOptions } from '@household/sync/native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Directory, Paths } from 'expo-file-system'
import { createProblemHub } from '../api/problems.ts'
import { testApi } from '../api/testing.ts'
import type { ReplicaCredential } from '../session/context.ts'
import { forget } from '../session/forget.ts'
import { sourcesIn } from '../test/sources.ts'
import { keptReplicas, replicaDatabase } from './databases.ts'
import { filesOf, fileStorage } from './files.ts'
import { opened, openHouseholdReplica, type OpenOptions } from './open.ts'

/** A replica as the library would hand one back: what it was opened with, and what was asked of it. */
interface Fake {
  readonly options: NativeReplicaOptions
  readonly asked: string[]
  /** Fails its wiping, where a test says. */
  wipes: boolean
}

const mockOpened: Fake[] = []
/** Whether the next connect is refused: a sync service that cannot be reached. */
const mockConnect = { fails: false }

jest.mock('@household/sync/native', () => ({
  openReplica: (options: NativeReplicaOptions) => {
    const fake: Fake = { options, asked: [], wipes: true }
    mockOpened.push(fake)
    return Promise.resolve({
      fake,
      connect: () => {
        fake.asked.push('connect')
        return mockConnect.fails ? Promise.reject(new Error('unreachable')) : Promise.resolve()
      },
      wipe: () => {
        fake.asked.push('wipe')
        return fake.wipes ? Promise.resolve() : Promise.reject(new Error('the database is locked'))
      },
      close: () => {
        fake.asked.push('close')
        return Promise.resolve()
      },
    })
  },
}))

/** The database files a test says exist, and what was asked of each, in order. */
const mockFiles = { there: new Set<string>(), asked: [] as string[], stuck: false }

jest.mock('@op-engineering/op-sqlite', () => ({
  open: ({ name, failOnCreate }: { readonly name: string; readonly failOnCreate?: boolean }) => {
    if (!mockFiles.there.has(name)) {
      // A file that is not there is never made by being asked about.
      if (failOnCreate !== true) mockFiles.asked.push(`made:${name}`)
      throw new Error('unable to open database file')
    }
    return {
      executeSync: (statement: string) => {
        mockFiles.asked.push(`${statement}:${name}`)
      },
      delete: () => {
        if (mockFiles.stuck) throw new Error('the file is in use')
        mockFiles.asked.push(`deleted:${name}`)
        mockFiles.there.delete(name)
      },
    }
  },
}))

/** A member and a household nobody else in this file uses: what is open here outlives a test. */
let counter = 0
function pair() {
  counter += 1
  const tail = String(counter).padStart(4, '0')
  return {
    member: `0198c0de-0000-7000-8000-0000000b${tail}`,
    household: `0198c0de-0000-7000-8000-0000000a${tail}`,
  }
}

const credential: ReplicaCredential = {
  current: () => Promise.resolve('access-a'),
  renew: () => Promise.resolve(),
}

function options(over: Partial<OpenOptions> & Pick<OpenOptions, 'member' | 'household'>) {
  return {
    problems: createProblemHub(),
    credential: () => credential,
    api: testApi,
    ...over,
  } satisfies OpenOptions
}

const fakeOf = (replica: Replica) => (replica as unknown as { readonly fake: Fake }).fake

beforeEach(async () => {
  await AsyncStorage.clear()
  mockOpened.length = 0
  mockFiles.there.clear()
  mockFiles.asked.length = 0
  mockFiles.stuck = false
  mockConnect.fails = false
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a replica that is opened', () => {
  it('is its member’s copy of its household: a file named for both, noted before it is made', async () => {
    const who = pair()
    const mine = await openHouseholdReplica(options(who))
    expect(mockOpened).toHaveLength(1)
    const handed = fakeOf(mine.replica).options
    expect(handed.dbFilename).toBe(replicaDatabase(who.member, who.household))
    expect(handed.household).toBe(who.household)
    expect(handed.apiUrl).toBe(testApi)
    expect(await keptReplicas()).toEqual([who])
    await mine.close()
  })

  it('is handed the session’s sign-in, with the library’s own word for one that has ended', async () => {
    const who = pair()
    let ended: (() => Error) | undefined
    const mine = await openHouseholdReplica(
      options({
        ...who,
        credential: (gone) => {
          ended = gone
          return credential
        },
      }),
    )
    expect(fakeOf(mine.replica).options.credential).toBe(credential)
    // What the replica tells its own revocation by: nothing else discards it.
    expect(ended?.()).toBeInstanceOf(Revoked)
    await mine.close()
  })

  it('asks the API by a `fetch` that names the app, and leaves the bearer the library set', async () => {
    const who = pair()
    const sent: Request[] = []
    jest.spyOn(globalThis, 'fetch').mockImplementation((request) => {
      if (request instanceof Request) sent.push(request)
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    const mine = await openHouseholdReplica(options(who))
    const ask = fakeOf(mine.replica).options.fetch
    await ask?.(`${testApi}/households/${who.household}/sync/digest`, {
      method: 'POST',
      headers: { authorization: 'Bearer access-a', 'content-type': 'application/json' },
      body: '{}',
    })
    expect(sent).toHaveLength(1)
    // Or the household's clients would list this device with no type and no version (D-178).
    expect(sent[0]?.headers.get('Household-Client')).toMatch(/^mobile\/\d+\.\d+\.\d+$/)
    expect(sent[0]?.headers.get('Authorization')).toBe('Bearer access-a')
    expect(sent[0]?.credentials).toBe('omit')
    await mine.close()
  })

  it('tells the app where the server answers one of its own requests that this build is too old', async () => {
    const who = pair()
    const problems = createProblemHub()
    const told: unknown[] = []
    problems.subscribe((problem) => told.push(problem.code))
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'https://household.example/problems/update_required',
          title: 'update_required',
          status: 400,
          code: 'update_required',
          minimum_version: '9.0.0',
        }),
        { status: 400, headers: { 'content-type': 'application/problem+json' } },
      ),
    )
    const mine = await openHouseholdReplica(options({ ...who, problems }))
    const answer = await fakeOf(mine.replica).options.fetch?.(`${testApi}/x`, { method: 'POST' })
    expect(told).toEqual(['update_required'])
    // And the answer is the library's to read still.
    expect(answer?.status).toBe(400)
    await mine.close()
  })

  it('keeps its waiting files in its own directory, sends them by where they are, and has no route to send one to yet', async () => {
    const who = pair()
    const mine = await openHouseholdReplica(options(who))
    const { attachments } = fakeOf(mine.replica).options
    expect(attachments?.uploadUrl('documents.document', who.household, 'x')).toBeNull()
    // Handed the file's place, and never its bytes: a transport that is a function is handed bytes.
    expect(attachments?.transport).toEqual({ byUri: expect.any(Function) })
    expect(attachments?.storage.getLocalUri('row')).toBe(
      fileStorage(filesOf(who.member, who.household)).getLocalUri('row'),
    )
    await mine.close()
  })

  it('is connected as it is opened, and a sync service that cannot be reached is no failure to open', async () => {
    const who = pair()
    mockConnect.fails = true
    const mine = await openHouseholdReplica(options(who))
    expect(fakeOf(mine.replica).asked).toEqual(['connect'])
    await mine.close()
  })

  it('tells a write that needs a connection by the library’s own refusal', () => {
    const { needsConnection } = opened({} as Replica, () => Promise.resolve())
    expect(needsConnection(new NeedsConnection('admin.membership'))).toBe(true)
    expect(needsConnection(new Error('admin.membership'))).toBe(false)
    expect(needsConnection(undefined)).toBe(false)
  })
})

describe('a replica that is held', () => {
  it('is open once however many hold it, and closed when the last has let go', async () => {
    const who = pair()
    const [first, second] = await Promise.all([
      openHouseholdReplica(options(who)),
      openHouseholdReplica(options(who)),
    ])
    expect(mockOpened).toHaveLength(1)
    expect(second.replica).toBe(first.replica)
    const asked = fakeOf(first.replica).asked
    // Connected once, too.
    expect(asked).toEqual(['connect'])
    await first.close()
    expect(asked).toEqual(['connect'])
    // Let go of twice by one holder, it is still the other's.
    await first.close()
    expect(asked).toEqual(['connect'])
    await second.close()
    expect(asked).toEqual(['connect', 'close'])
  })

  it('is opened anew once it has been closed, on the file as it was left', async () => {
    const who = pair()
    const first = await openHouseholdReplica(options(who))
    const closing = first.close()
    // Asked for while it is closing: waited out, and opened again.
    const second = await openHouseholdReplica(options(who))
    await closing
    expect(mockOpened).toHaveLength(2)
    expect(second.replica).not.toBe(first.replica)
    expect(fakeOf(first.replica).asked).toEqual(['connect', 'close'])
    await second.close()
  })
})

describe('a sign-in that ended', () => {
  it('takes its member’s open replica with it: wiped, closed, its file and its files deleted', async () => {
    const who = pair()
    const name = replicaDatabase(who.member, who.household)
    const mine = await openHouseholdReplica(options(who))
    mockFiles.there.add(name)
    const storage = fileStorage(filesOf(who.member, who.household))
    await storage.saveFile(storage.getLocalUri('row'), new Uint8Array([1, 2, 3]).buffer)

    await forget(who.member.toUpperCase())
    // The session waited for the note alone: the removal goes on behind it.
    expect(await keptReplicas()).toEqual([])
    expect(fakeOf(mine.replica).asked).toEqual(['connect', 'wipe', 'close'])
    expect(mockFiles.asked).toEqual([`PRAGMA wal_checkpoint(TRUNCATE):${name}`, `deleted:${name}`])
    expect(filesOf(who.member, who.household).exists).toBe(false)
    expect(new Directory(Paths.document, 'replicas', who.member).exists).toBe(false)
    // Whoever still held it lets go of a replica that is closed already.
    await mine.close()
    expect(fakeOf(mine.replica).asked).toEqual(['connect', 'wipe', 'close'])
  })

  it('takes a replica that is not open too: opened for nobody, wiped, closed and deleted', async () => {
    const who = pair()
    const name = replicaDatabase(who.member, who.household)
    const mine = await openHouseholdReplica(options(who))
    await mine.close()
    mockFiles.there.add(name)
    mockOpened.length = 0

    await forget(who.member)
    expect(await keptReplicas()).toEqual([])
    expect(mockOpened).toHaveLength(1)
    const [emptied] = mockOpened
    expect(emptied?.asked).toEqual(['wipe', 'close'])
    expect(emptied?.options.dbFilename).toBe(name)
    // It asks the server nothing, and has no sign-in to ask with.
    expect(emptied?.options.apiUrl).toBe('about:blank')
    await expect(emptied?.options.credential.current()).rejects.toBeInstanceOf(Revoked)
    expect(mockFiles.asked).toContain(`deleted:${name}`)
  })

  it('leaves another member’s replicas as they are', async () => {
    const [who, other] = [pair(), pair()]
    const [mine, theirs] = [
      await openHouseholdReplica(options(who)),
      await openHouseholdReplica(options(other)),
    ]
    await forget(who.member)
    expect(fakeOf(theirs.replica).asked).toEqual(['connect'])
    expect(await keptReplicas()).toEqual([other])
    await mine.close()
    await theirs.close()
  })

  it('deletes at the next start a file it could not delete now, and opens nothing to do it', async () => {
    const who = pair()
    const name = replicaDatabase(who.member, who.household)
    const mine = await openHouseholdReplica(options(who))
    mockFiles.there.add(name)
    mockFiles.stuck = true
    await forget(who.member)
    expect(await keptReplicas()).toEqual([{ ...who, leaving: true, emptied: true }])
    expect(mockFiles.there.has(name)).toBe(true)
    await mine.close()

    // The next start is this file loaded again, which asks for what a run before it left: here,
    // the next thing that asks.
    mockFiles.stuck = false
    mockOpened.length = 0
    const other = pair()
    const next = await openHouseholdReplica(options(other))
    expect(mockFiles.there.has(name)).toBe(false)
    expect(await keptReplicas()).toEqual([other])
    // Emptied once: only the file was left to delete.
    expect(mockOpened).toHaveLength(1)
    await next.close()
  })

  it('is not opened again by its member while what it left could not be wiped', async () => {
    const who = pair()
    const mine = await openHouseholdReplica(options(who))
    fakeOf(mine.replica).wipes = false
    await forget(who.member)
    expect(await keptReplicas()).toEqual([{ ...who, leaving: true }])
    // Asked for again, it is wiped first, by a replica opened for nobody.
    mockOpened.length = 0
    const again = await openHouseholdReplica(options(who))
    expect(mockOpened.map((each) => each.asked)).toEqual([['wipe', 'close'], ['connect']])
    expect(await keptReplicas()).toEqual([who])
    await again.close()
  })

  it('opens nothing for a member whose sign-in ended while their replica was on its way', async () => {
    const who = pair()
    const opening = openHouseholdReplica(options(who))
    const forgotten = forget(who.member)
    await expect(opening).rejects.toThrow(/has ended/)
    await forgotten
    // Nothing was opened under the sign-in that ended: what was, was opened to be emptied.
    expect(mockOpened.map((each) => each.options.apiUrl)).not.toContain(testApi)
  })
})

describe('the sync library', () => {
  const sources = sourcesIn(['app', 'src'])

  it('is imported for its values by this one file of the app, and for its types alone by every other', () => {
    // One import at a time: the names it takes, in braces, and where from.
    const imports = sources.flatMap(({ path, source }) =>
      [...source.matchAll(/import (type )?\{[^}]*\} from '@household\/sync(\/[a-z]+)?'/g)].map(
        ([, type]) => ({ path, typed: type !== undefined }),
      ),
    )
    // And no file takes it any other way, which the reading above would not see.
    const named = sources.flatMap(({ source }) => [...source.matchAll(/'@household\/sync[/']/g)])
    expect(named).toHaveLength(imports.length)
    // The sources were read: the provider imports its types, and this file's subject its values.
    expect(imports.map(({ path }) => path)).toContain('src/sync/ReplicaProvider.tsx')
    expect(imports.filter(({ typed }) => !typed).map(({ path }) => path)).toEqual([
      'src/sync/open.ts',
      'src/sync/open.ts',
    ])
  })
})
