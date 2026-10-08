// Where a sign-in with Google or Apple comes back to (FR-ID2, ADR 0010, provider.ts): the end
// of a flow this tab began, to sign in or to link the provider to the account signed in. Google
// sends the person back with a query; Apple answers with a form, which the API receives and
// sends on here in the fragment. Either is read once and taken out of the address (fragment.ts),
// and the flow this tab kept is taken with it: a return is completed once.
//
// The state that came back is compared with the one the flow began with before anything is
// sent: a return this tab did not begin, another provider's, one the person turned down at the
// provider, or one opened a second time, completes nothing, and says so with the way to begin
// again. The code is then redeemed with the verifier this tab kept, which has left for nowhere
// until now.
//
// An identity whose address an account already has is never linked silently (D-102): its owner
// signs in as they always have, and links the provider from their account.
import type { components } from '@household/api'
import { pseudoLocale } from '@household/i18n/lazy'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { NotAvailable } from '../app/NotAvailable.tsx'
import { isOwnPath, paths } from '../app/paths.ts'
import { useI18n } from '../i18n/I18nProvider.tsx'
import { heldDestination } from '../session/destination.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { useOnArrival } from './arrival.ts'
import { challengeIn, holdChallenge } from './challenge.ts'
import { useFragmentAndQuery, type Carried } from './fragment.ts'
import { isProvider, takePendingFlow, type PendingFlow, type Provider } from './provider.ts'
import { Screen, Way, Ways } from './Screen.tsx'

type Callback = components['schemas']['OauthCallbackRequest']

/** Why a link was not made, each with a sentence of its own. */
type Unlinked = 'already' | 'invalid' | 'signed_out' | 'child' | 'other'

type Outcome =
  /** The return is being completed, or is about to be. */
  | { readonly kind: 'working' }
  /** Nothing was completed: `again` is where the flow is begun again. */
  | { readonly kind: 'unfinished'; readonly again: string; readonly linking: boolean }
  /** An account already has the identity's address, and nothing was linked to it. */
  | { readonly kind: 'link_required' }
  | {
      readonly kind: 'unlinked'
      readonly why: Unlinked
      readonly back: string
      readonly error: unknown
    }

/** What the provider answered with: Apple's in the fragment, Google's in the query. */
function answerIn({ fragment, query }: Carried) {
  const from = ['code', 'state', 'error'].some((field) => fragment.has(field)) ? fragment : query
  return {
    code: from.get('code') ?? '',
    state: from.get('state') ?? '',
    /** Set where the person turned the sign-in down at the provider, or it failed there. */
    refused: from.has('error'),
    /** The person's name, which Apple gives the browser alone, the first time they sign in. */
    name: (from.get('name') ?? '').trim(),
  }
}

/**
 * Where a link goes back to: what the flow named, where that is a path of the app's own, or the
 * account's security screen. What a tab's storage holds is whatever was put there.
 */
function backOf(flow: PendingFlow): string {
  const to = flow.returnTo
  return to !== undefined && isOwnPath(to) ? to : paths.accountSecurity.path
}

/** `name` held to the contract's longest, counted in characters as the contract counts them. */
function nameOf(name: string): string {
  return Array.from(name).slice(0, 80).join('')
}

function unlinkedBy(error: unknown): Unlinked {
  const problem = problemIn(error)
  if (problem?.code === 'identity_already_linked') return 'already'
  if (problem?.status === 422) return 'invalid'
  if (problem?.status === 401) return 'signed_out'
  if (problem?.status === 403) return 'child'
  return 'other'
}

export function ProviderReturn() {
  const { provider } = useParams()
  // An address under `sign-in` that names no provider opens nothing.
  if (!isProvider(provider)) return <NotAvailable />
  return <Returned provider={provider} />
}

function Returned({ provider }: { readonly provider: Provider }) {
  const { t, locale } = useI18n()
  const api = useApi()
  const session = useSession()
  const navigate = useNavigate()
  const problemText = useProblemText()
  const carried = useFragmentAndQuery()
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'working' })

  // Whether the screen is still the one drawn, when an answer arrives: an answer that comes
  // after the person has gone elsewhere takes them nowhere.
  const drawn = useRef(true)
  useEffect(() => {
    drawn.current = true
    return () => {
      drawn.current = false
    }
  }, [])

  const signIn = useMutation({
    mutationFn: async (body: Callback) =>
      unwrap(
        await api.POST('/auth/oauth/{provider}/callback', { params: { path: { provider } }, body }),
      ),
  })
  const link = useMutation({
    mutationFn: async (body: Pick<Callback, 'code' | 'state' | 'code_verifier'>) => {
      unwrap(
        await api.POST('/auth/oauth/{provider}/link', { params: { path: { provider } }, body }),
      )
    },
  })

  useOnArrival(() => {
    const flow = takePendingFlow()
    const answer = answerIn(carried)
    const linking = flow?.intent === 'link'
    const back = flow !== null && linking ? backOf(flow) : paths.signIn.path
    if (
      flow === null ||
      flow.provider !== provider ||
      answer.refused ||
      answer.code === '' ||
      answer.state !== flow.state
    ) {
      setOutcome({ kind: 'unfinished', again: back, linking })
      return
    }
    const redeemed = { code: answer.code, state: answer.state, code_verifier: flow.verifier }

    if (linking) {
      link.mutateAsync(redeemed).then(
        () => {
          if (drawn.current) void navigate(back, { replace: true })
        },
        (error: unknown) => {
          setOutcome({ kind: 'unlinked', why: unlinkedBy(error), back, error })
        },
      )
      return
    }

    signIn
      .mutateAsync({
        ...redeemed,
        // A new account's name, where Apple gave one: its ID token carries none. And its
        // language, the one the app is shown in, as at registering; the pseudo-locale is nobody's.
        ...(answer.name === '' ? {} : { display_name: nameOf(answer.name) }),
        ...(locale === pseudoLocale ? {} : { locale }),
      })
      .then(async () => {
        await session.entered()
        if (drawn.current) void navigate(heldDestination() ?? paths.home.path, { replace: true })
      })
      .catch((error: unknown) => {
        const challenge = challengeIn(error)
        if (challenge !== undefined) {
          // The second step is asked of a provider's sign-in as of a password's (D-100).
          holdChallenge(challenge)
          if (!drawn.current) return
          void navigate(
            challenge.methods.includes('totp') ? paths.secondStep.path : paths.recoveryCode.path,
            { replace: true },
          )
          return
        }
        if (problemIn(error)?.code === 'link_required') setOutcome({ kind: 'link_required' })
        // The provider did not vouch for it, or the answer never came: the code and the state
        // are spent either way, and the sign-in begins again.
        else setOutcome({ kind: 'unfinished', again: paths.signIn.path, linking: false })
      })
  })

  let said: { readonly title: string; readonly lede: string; readonly rest: ReactNode }
  switch (outcome.kind) {
    case 'working':
      // The page has its title from the first paint, before anything is known of the return.
      said = { title: t('auth.provider.working.title'), lede: t('auth.working'), rest: null }
      break
    case 'unfinished':
      said = {
        title: t('auth.provider.unfinished.title'),
        lede: t('auth.provider.unfinished.body'),
        rest: (
          <Ways>
            <Way to={outcome.again}>
              {outcome.linking ? t('auth.provider.link.back') : t('auth.provider.start_again')}
            </Way>
          </Ways>
        ),
      }
      break
    case 'link_required':
      said = {
        title: t('auth.provider.link_required.title'),
        lede: t('auth.provider.link_required.body', { provider }),
        rest: (
          <Ways>
            <Way to={paths.signIn.path}>{t('auth.way.sign_in')}</Way>
          </Ways>
        ),
      }
      break
    case 'unlinked':
      said = {
        title: t('auth.provider.link.failed.title', { provider }),
        lede:
          outcome.why === 'already'
            ? t('auth.provider.link.already', { provider })
            : outcome.why === 'invalid'
              ? t('auth.provider.link.invalid')
              : outcome.why === 'signed_out'
                ? t('auth.provider.link.signed_out')
                : outcome.why === 'child'
                  ? t('auth.provider.link.child')
                  : problemText(outcome.error),
        rest: (
          <Ways>
            {/* A visitor who takes it is asked to sign in, and brought back to it (guards.tsx). */}
            <Way to={outcome.back}>{t('auth.provider.link.back')}</Way>
          </Ways>
        ),
      }
      break
  }
  return (
    <Screen live title={said.title} lede={said.lede}>
      {said.rest}
    </Screen>
  )
}
