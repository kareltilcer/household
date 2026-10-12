// The household whose screens are drawn, as its frame read it (HouseholdFrame.tsx), and its
// member's arrangement of its modules, as this device keeps it (arrangement.ts). A screen under
// a household's frame reads both from here: neither is being read any more by the time a screen
// is drawn, so no screen of a household has a wait of its own for them. It is no second reading
// of the household: the app has one (`useHousehold`, household/data.ts), which the frame asks
// and this hands down, read already.
//
// Which household that is is in the address and nowhere else (D-4): this holds the answer to the
// address, never a household that is "current".
import { createContext, use, useMemo, type ReactNode } from 'react'
import type { Household } from '../household/data.ts'
import type { Arrangement } from './navigation.ts'

interface Shown {
  readonly household: Household
  readonly arrangement: Arrangement
  readonly arrange: (next: Arrangement) => void
}

const HouseholdContext = createContext<Shown | null>(null)

export interface HouseholdProviderProps extends Shown {
  readonly children: ReactNode
}

export function HouseholdProvider({
  household,
  arrangement,
  arrange,
  children,
}: HouseholdProviderProps) {
  const shown = useMemo(
    () => ({ household, arrangement, arrange }),
    [household, arrangement, arrange],
  )
  return <HouseholdContext value={shown}>{children}</HouseholdContext>
}

function useShown(): Shown {
  const shown = use(HouseholdContext)
  if (shown === null) throw new Error('no household’s frame above this component')
  return shown
}

/** The household this screen is drawn in, as its member reads it. */
export function useHouseholdShown(): Household {
  return useShown().household
}

/** The member's arrangement of this household's modules, and what changes it. */
export function useArrangement(): readonly [Arrangement, (next: Arrangement) => void] {
  const { arrangement, arrange } = useShown()
  return [arrangement, arrange]
}
