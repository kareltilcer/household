// Where a member's arrangement of their modules is kept (D-38, D-155): on this device, for each
// member and each household, since the same person orders two households differently. Nothing on
// the server keeps it yet: item 36 gives it a store that follows the member across their devices,
// and until then a phone and a browser order their lists apart, which the arrange screen says.
// It is a preference and no household's data: it outlives a sign-out, it is not removed with
// what the device kept of a member whose sign-in ended, and a household's read-only state does
// not hold it.
//
// A device's storage answers later, where a browser's answers at once. So the arrangement is
// read once, by the household's frame, before anything of the shell is drawn
// (HouseholdFrame.tsx), and handed down from there: no list is drawn in the product's order for
// a moment and then in its member's.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useState } from 'react'
import { moduleKeys, type ModuleKey } from '../household/data.ts'
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

interface Kept {
  readonly key: string
  readonly arrangement: Arrangement
}

/**
 * `user`'s arrangement of `household`'s modules as this device keeps it, undefined until the
 * device has answered, and what changes it. A change is its member's at once, and is kept for
 * as long as the app is open where the device will not store it.
 */
export function useKeptArrangement(
  user: string,
  household: string,
): readonly [Arrangement | undefined, (next: Arrangement) => void] {
  const key = arrangementKey(user, household)
  const [kept, setKept] = useState<Kept>()
  useEffect(() => {
    let wanted = true
    AsyncStorage.getItem(key)
      .then(parseArrangement, () => noArrangement)
      .then((arrangement) => {
        // A change made while the device was being asked is the newer of the two.
        if (wanted) setKept((current) => (current?.key === key ? current : { key, arrangement }))
      })
      .catch(() => undefined)
    return () => {
      wanted = false
    }
  }, [key])
  const set = useCallback(
    (next: Arrangement) => {
      setKept({ key, arrangement: next })
      AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => undefined)
    },
    [key],
  )
  // What was read for another member, or another household, is not this one's.
  return [kept?.key === key ? kept.arrangement : undefined, set]
}
