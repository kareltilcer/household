// Answering a sign-in's second step (FR-ID5, `postAuthMfaVerify`), which the code's screen and
// the recovery code's share (A-7, A-8). A right answer signs in as the sign-in itself would
// have. A wrong one leaves the challenge standing, and its screen says so. Two answers end it,
// and the sign-in begins again, with the reason carried to the sign-in screen (notice.ts):
//
// - `401 unauthenticated`: the challenge is unknown, expired or ended. It lasts ten minutes.
// - `423 mfa_locked`: the tenth wrong code since the last right one locked the authenticator
//   and ended every challenge of the account. A recovery code unlocks it at the next sign-in.
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { paths } from '../app/paths.ts'
import { heldDestination } from '../session/destination.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { dropChallenge, type Challenge } from './challenge.ts'
import { noticeState, type Notice } from './notice.ts'

export interface Answer {
  /** Six digits from the authenticator, or a recovery code, which is spent. */
  readonly code: string
  /** Trusts this browser to sign in without the second step for 30 days: opt-in, never the default. */
  readonly trust: boolean
}

/** Why `error` ended the challenge, as the sign-in screen is told, or undefined where it stands. */
export function endingIn(error: unknown): Notice | undefined {
  const problem = problemIn(error)
  if (problem?.code === 'unauthenticated') return 'took_too_long'
  if (problem?.code === 'mfa_locked' || problem?.status === 423) return 'locked'
  return undefined
}

/** Whether `error` is a wrong code's refusal: the one the answering screen has a sentence for. */
export function isWrongCode(error: unknown): boolean {
  return problemIn(error)?.code === 'invalid_credentials'
}

/** The answer to `challenge`, sent, with where its outcome leads. */
export function useAnswer(challenge: Challenge) {
  const api = useApi()
  const session = useSession()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: async ({ code, trust }: Answer) =>
      unwrap(
        await api.POST('/auth/mfa/verify', {
          body: { challenge_token: challenge.token, code, remember_device: trust },
        }),
      ),
    onSuccess: async () => {
      dropChallenge()
      await session.entered()
      void navigate(heldDestination() ?? paths.home.path, { replace: true })
    },
    onError: (error) => {
      const over = endingIn(error)
      if (over === undefined) return
      dropChallenge()
      void navigate(paths.signIn.path, { replace: true, state: noticeState(over) })
    },
  })
}
