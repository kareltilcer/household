// The household a screen is in: the one its address names (D-4), as the member reads it. The
// shell provides it (shell/HouseholdShell.tsx), and a household's screen asks for it here and
// never for "the current household", which nothing keeps.
import { createContext, use } from 'react'
import type { Household } from './households.ts'

export const HouseholdContext = createContext<Household | null>(null)

/** The household this screen is in. */
export function useHousehold(): Household {
  const household = use(HouseholdContext)
  if (household === null) throw new Error('useHousehold: this screen is in no household')
  return household
}

/** The id of the household this screen is in. */
export function useHouseholdId(): string {
  return useHousehold().id
}
