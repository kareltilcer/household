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
 * the device's where nobody is signed in. A time that is on another calendar day than now, in
 * that zone, is said with its day: a limit counted by the day clears most of a day later, and a
 * time of day alone would read as today's.
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
        if (at === undefined) return t('ui.problem.rate_limited')
        const time = format.time(at, timeZone)
        const day = format.dayOf(at, timeZone)
        return day === format.dayOf(new Date(), timeZone)
          ? t('ui.problem.rate_limited_until', { time })
          : t('ui.problem.rate_limited_until_day', { time, day })
      }
      return t('ui.problem.server')
    },
    [t, format, timeZone],
  )
}
