// Where the app hears of a problem that is about the app and not about one screen. Every problem
// document a query or a mutation meets is told here (query.ts's `onProblem`), and so is one a
// request made outside either meets: a renewal of the device's sign-in (session/tokens.ts), a
// sign-out, the push's registration, and the replica's own requests, whose `fetch` is the one
// client.ts makes for it. The session listens for the one it answers for everybody,
// `400 update_required`. A `401` is no news here: a device renews its sign-in and asks again
// (transport.ts), and only a renewal the server refuses ends it.
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
