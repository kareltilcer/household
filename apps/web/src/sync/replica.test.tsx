import type { RecordedOutcome, Replica } from '@household/sync'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '../app/App.tsx'
import { replicaLock } from './databases.ts'
import type { Opened } from './open.ts'
import { ReplicaProvider, useInbox, useSync, type OpenReplica } from './ReplicaProvider.tsx'

const household = '01900000-0000-7000-8000-0000000000a1'

/**
 * A browser's Web Locks, as far as the provider asks of them: one holder of a name at a time,
 * the others waiting their turn, a wait given up by its signal, and who holds and who waits.
 */
function locks() {
  const held = new Set<string>()
  const waiting = new Map<string, (() => void)[]>()
  const pending: string[] = []
  const api = {
    query: () =>
      Promise.resolve({
        held: [...held].map((name) => ({ name })),
        pending: pending.map((name) => ({ name })),
      }),
    request: async (
      name: string,
      options: { readonly signal?: AbortSignal },
      callback: () => Promise<void>,
    ) => {
      if (held.has(name)) {
        pending.push(name)
        await new Promise<void>((resolve, reject) => {
          const turn = () => {
            pending.splice(pending.indexOf(name), 1)
            resolve()
          }
          waiting.set(name, [...(waiting.get(name) ?? []), turn])
          options.signal?.addEventListener('abort', () => {
            pending.splice(pending.indexOf(name), 1)
            waiting.set(
              name,
              (waiting.get(name) ?? []).filter((other) => other !== turn),
            )
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      }
      held.add(name)
      try {
        await callback()
      } finally {
        held.delete(name)
        waiting.get(name)?.shift()?.()
      }
    },
  }
  return {
    api,
    held,
    /** Another tab takes `name`, until the function this returns is called. */
    takenElsewhere: (name: string) => {
      held.add(name)
      return () => {
        held.delete(name)
        waiting.get(name)?.shift()?.()
      }
    },
  }
}

/**
 * A browser that has what a replica needs, its storage and its workers, and these Web Locks, or
 * none. jsdom has none of the three.
 */
function browserWith(api: ReturnType<typeof locks>['api'] | undefined) {
  Object.defineProperty(window.navigator, 'locks', { value: api, configurable: true })
  vi.stubGlobal('Worker', () => undefined)
  vi.stubGlobal('indexedDB', {})
}

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'locks')
})

/** PowerSync's status, as far as the provider reads it. */
interface Status {
  readonly connected: boolean
  readonly connecting: boolean
  readonly hasSynced: boolean
  readonly downloadError: Error | undefined
}

/** A replica as far as the provider and its hooks ask of one, and what was done to it. */
function replica() {
  let status: Status = {
    connected: false,
    connecting: true,
    hasSynced: false,
    downloadError: undefined,
  }
  let changed: () => void = () => undefined
  let inbox: (entries: readonly RecordedOutcome[]) => void = () => undefined
  const connect = vi.fn(() => Promise.resolve())
  const close = vi.fn(() => Promise.resolve())
  const stopped = vi.fn()
  const opened: Opened = {
    replica: {
      db: {
        get currentStatus() {
          return status
        },
        registerListener: (listener: { readonly statusChanged: () => void }) => {
          changed = listener.statusChanged
          return () => undefined
        },
      },
      connect,
      close,
    } as unknown as Replica,
    watchInbox: (listener) => {
      inbox = listener
      listener([])
      return stopped
    },
  }
  return {
    opened,
    connect,
    close,
    stopped,
    /** PowerSync's status moves. */
    becomes: (next: Partial<Status>) => {
      status = { ...status, ...next }
      changed()
    },
    answers: (entries: readonly RecordedOutcome[]) => {
      inbox(entries)
    },
  }
}

function Probe() {
  const sync = useSync()
  const inbox = useInbox()
  return (
    <output>
      {[sync.replica.phase, String(sync.receiving), inbox === undefined ? 'unread' : inbox.length]
        .join(' ')
        .trim()}
    </output>
  )
}

function draw(open: OpenReplica, of = household) {
  return render(
    <Providers persist={false} cookies={() => ''}>
      <ReplicaProvider household={of} open={open}>
        <Probe />
      </ReplicaProvider>
    </Providers>,
  )
}

describe('a household’s replica', () => {
  it('is opened by the tab that holds the household’s lock, connected, and closed with it', async () => {
    const browser = locks()
    browserWith(browser.api)
    const mine = replica()
    const open = vi.fn<OpenReplica>(() => Promise.resolve(mine.opened))
    const { unmount } = draw(open)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^open/)
    })
    expect(open).toHaveBeenCalledExactlyOnceWith(household)
    expect(mine.connect).toHaveBeenCalledOnce()
    expect(browser.held).toEqual(new Set([replicaLock(household)]))

    unmount()
    await waitFor(() => {
      expect(mine.close).toHaveBeenCalledOnce()
    })
    // The lock is the replica's for as long as it is open, and no longer.
    await waitFor(() => {
      expect(browser.held.size).toBe(0)
    })
  })

  it('is left to the tab that has it, said so, and taken over when that tab lets go', async () => {
    const browser = locks()
    browserWith(browser.api)
    const release = browser.takenElsewhere(replicaLock(household))
    const mine = replica()
    const open = vi.fn<OpenReplica>(() => Promise.resolve(mine.opened))
    draw(open)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^elsewhere null unread/)
    })
    // Two replicas of one household would each send the same queued writes: none is opened.
    expect(open).not.toHaveBeenCalled()

    act(() => {
      release()
    })
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^open/)
    })
    expect(open).toHaveBeenCalledOnce()
  })

  it('gives up its wait when the household is left before its turn came', async () => {
    const browser = locks()
    browserWith(browser.api)
    const release = browser.takenElsewhere(replicaLock(household))
    const open = vi.fn<OpenReplica>(() => Promise.resolve(replica().opened))
    const { unmount } = draw(open)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^elsewhere/)
    })
    unmount()
    release()
    await act(() => Promise.resolve())
    expect(open).not.toHaveBeenCalled()
  })

  it('is none in a browser that cannot keep one, or that refused to open it', async () => {
    // No Web Locks: nothing to hold a household's replica to one tab by.
    browserWith(undefined)
    const never = vi.fn<OpenReplica>()
    const first = draw(never)
    expect(screen.getByRole('status')).toHaveTextContent(/^unavailable null unread/)
    expect(never).not.toHaveBeenCalled()
    first.unmount()

    const browser = locks()
    browserWith(browser.api)
    draw(() => Promise.reject(new Error('storage refused')))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^unavailable/)
    })
    // And the lock is let go: another tab may fare better.
    await waitFor(() => {
      expect(browser.held.size).toBe(0)
    })
  })

  it('says whether it is receiving, once that is a thing to say', async () => {
    const browser = locks()
    browserWith(browser.api)
    const mine = replica()
    draw(() => Promise.resolve(mine.opened))
    // Still at its first attempt: not yet known.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^open null/)
    })
    act(() => {
      mine.becomes({ connected: true, connecting: false, hasSynced: true })
    })
    expect(screen.getByRole('status')).toHaveTextContent(/^open true/)
    // The sync service gone and the API not: everything else works, and this says so (D-105).
    act(() => {
      mine.becomes({ connected: false, connecting: false, downloadError: new Error('down') })
    })
    expect(screen.getByRole('status')).toHaveTextContent(/^open false/)
  })

  it('tells what needs the member’s attention, as the replica holds it', async () => {
    const browser = locks()
    browserWith(browser.api)
    const mine = replica()
    const { unmount } = draw(() => Promise.resolve(mine.opened))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^open null 0$/)
    })
    act(() => {
      mine.answers([
        { mutation_id: 'm1' } as RecordedOutcome,
        { mutation_id: 'm2' } as RecordedOutcome,
      ])
    })
    expect(screen.getByRole('status')).toHaveTextContent(/2$/)
    unmount()
    expect(mine.stopped).toHaveBeenCalled()
  })
})
