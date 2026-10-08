// Where a member's arrangement of their modules is kept (D-38, D-155): in this browser, for each
// member and each household, since the same person orders two households differently. Nothing on
// the server keeps it yet: item 36 gives it a store that follows the member across their devices,
// and until then a phone and a browser order their lists apart. It is a preference and no
// household's data: it survives a sign-out, and a household's read-only state does not hold it.
import { useCallback, useSyncExternalStore } from 'react'
import { moduleKeys, type ModuleKey } from '../household/households.ts'
import { noArrangement, type Arrangement } from './navigation.ts'

/** The key a member's arrangement of a household is kept under. */
export function arrangementKey(user: string, household: string): string {
  return `household.arrange.${user.toLowerCase()}.${household.toLowerCase()}`
}

function modulesIn(value: unknown): ModuleKey[] {
  if (!Array.isArray(value)) return []
  const known = new Set<string>(moduleKeys)
  return [...new Set(value.filter((entry): entry is ModuleKey => known.has(String(entry))))]
}

/** The arrangement `stored` holds: what storage gave, which may be anything at all. */
export function parseArrangement(stored: string | null): Arrangement {
  if (stored === null) return noArrangement
  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch {
    return noArrangement
  }
  if (typeof value !== 'object' || value === null) return noArrangement
  const record: Partial<Record<string, unknown>> = { ...value }
  const hidden = modulesIn(record.hidden)
  return {
    // A module is in one place: put away, it is neither pinned nor in the order.
    pinned: modulesIn(record.pinned).filter((module) => !hidden.includes(module)),
    order: modulesIn(record.order),
    hidden,
  }
}

const listeners = new Set<() => void>()

function subscribe(notify: () => void): () => void {
  listeners.add(notify)
  // Another tab's change arrives here; this tab's own is told by `write`.
  window.addEventListener('storage', notify)
  return () => {
    listeners.delete(notify)
    window.removeEventListener('storage', notify)
  }
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

// Kept for the page alone where the browser refuses storage.
const unstored = new Map<string, string>()

function write(key: string, arrangement: Arrangement): void {
  const value = JSON.stringify(arrangement)
  try {
    window.localStorage.setItem(key, value)
    unstored.delete(key)
  } catch {
    unstored.set(key, value)
  }
  for (const notify of listeners) notify()
}

// One parsed value for each stored text, so that a reader is handed the same arrangement until
// it changes.
let parsed: { readonly text: string | null; readonly arrangement: Arrangement } | undefined

function arrangementOf(text: string | null): Arrangement {
  if (parsed?.text !== text) parsed = { text, arrangement: parseArrangement(text) }
  return parsed.arrangement
}

/** `user`'s arrangement of `household`'s modules, and what changes it, here and in other tabs. */
export function useArrangement(
  user: string,
  household: string,
): readonly [Arrangement, (next: Arrangement) => void] {
  const key = arrangementKey(user, household)
  const text = useSyncExternalStore(subscribe, () => unstored.get(key) ?? read(key))
  const set = useCallback(
    (next: Arrangement) => {
      write(key, next)
    },
    [key],
  )
  return [arrangementOf(text), set]
}
