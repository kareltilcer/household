// Where the app hears of a problem that is about the session and not about one screen. Every
// problem document a query or a mutation meets is told here (query.ts's `onProblem`), and so is
// one the replica's own requests meet (sync/sessionFetch.ts); the session listens, for the three
// it answers: `401 unauthenticated`, `403 csrf_failed` and `400 update_required` (session/).
import type { ApiProblem, UnreadableProblem } from '@household/api'

export type Problem = ApiProblem | UnreadableProblem

export interface ProblemHub {
  /** Tells every listener of `problem`. */
  readonly report: (problem: Problem) => void
  /** Listens until the function it returns is called. */
  readonly subscribe: (listener: (problem: Problem) => void) => () => void
}

export function createProblemHub(): ProblemHub {
  const listeners = new Set<(problem: Problem) => void>()
  return {
    report: (problem) => {
      for (const listener of [...listeners]) listener(problem)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
