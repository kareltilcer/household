// An account refused for an address it has not verified (A-4, FR-ID1): whether a refusal is that
// one, and the server's word on it taken. It draws nothing, and so reads no word: the block a
// household's screen draws in the refused write's place is household/Unverified.tsx, and the
// account's own second step draws its own (SecondStepSetup.tsx), which imports this and no word
// of a household's with it (i18n/words.test.ts).
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { problemIn } from '../api/problem.ts'
import { meKey, type Me } from '../session/SessionProvider.tsx'

/** Whether `error` is the server's refusal of an account whose address is not verified. */
export function isUnverified(error: unknown): boolean {
  return problemIn(error)?.code === 'account_unverified'
}

/**
 * Takes the server's word that the account is not verified, whatever this page had read of it:
 * a screen calls it where a write of its own was refused so, and then draws the block in the
 * write's place, as it does for an account it read as unverified from the first.
 */
export function useMarkUnverified(): () => void {
  const queries = useQueryClient()
  return useCallback(() => {
    queries.setQueryData<Me>(meKey, (was) =>
      was === undefined ? was : { ...was, email_verified: false },
    )
  }, [queries])
}
