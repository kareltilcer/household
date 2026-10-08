// What a request that failed is said to have failed with, where its screen has no sentence of its
// own for it. A screen switches on the problem's `code` first and says what happened in its own
// words (problem.ts); what is left is one of three things whoever asked: the server could not be
// reached, it refused for now and says until when, or it failed. Each says what became of what
// was typed, which is nothing: a failure that silently emptied a form would be a second one.
import { useCallback } from 'react'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { ApiProblemError, problemIn } from './problem.ts'

/** The zone a visitor's clock is in: this device's, said outright, since no account names one yet. */
export function deviceTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * A sentence for `error`, whatever it is: a lost connection, a `429` with the time it clears, or
 * the server's own failure. `timeZone` is the zone that time is said in: the member's own, or
 * the device's where nobody is signed in.
 */
export function useProblemText(timeZone: string = deviceTimeZone()): (error: unknown) => string {
  const t = useTranslate()
  const format = useFormat()
  return useCallback(
    (error: unknown) => {
      const problem = problemIn(error)
      // No answer at all: the request did not reach the server, or its answer did not come back.
      if (problem === undefined) return t('ui.problem.unreachable')
      if (problem.status === 429) {
        const at = error instanceof ApiProblemError ? error.retryAt : undefined
        return at === undefined
          ? t('ui.problem.rate_limited')
          : t('ui.problem.rate_limited_until', { time: format.time(at, timeZone) })
      }
      return t('ui.problem.server')
    },
    [t, format, timeZone],
  )
}
