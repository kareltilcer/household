// Who is signed in to this browser, and what ends it (PRD 02 §2, ADR 0009, ADR 0026). A web
// session is a cookie no script can read, so the app learns who it is by asking (`GET /me`), and
// learns that it is nobody's any more from the answers its requests get:
//
// - `401 unauthenticated`: the session ended, here or from elsewhere. It has nothing to renew, so
//   what this browser kept of the member's households is removed, the persisted cache and every
//   replica, and they sign in again with the address they were at held for them.
// - `403 csrf_failed`: the request did not prove it was the app's own. The member signs in again,
//   which sets a new session and its token together, and nothing is removed.
// - `400 update_required`: this build is older than the server serves. Nothing else is drawn but
//   the screen that says so (UpdateRequired.tsx).
//
// What a browser keeps of a member's households is theirs, and for no longer than their session
// (D-161). It is removed where the session is found gone though this page never knew its member,
// and where another member is found signed in under the page, which then starts again.
//
// The language is the account's once it is known, and the display modes stay this browser's:
// the account keeps none (ADR 0026).
import { problemOf, type components } from '@household/api'
import { matchLocale, pseudoLocale } from '@household/i18n/lazy'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useApi, useProblems } from '../api/ApiProvider.tsx'
import { cookieValue, csrfCookie } from '../api/client.ts'
import { problemIn, unwrap } from '../api/problem.ts'
import { useI18n } from '../i18n/I18nProvider.tsx'
import { keepsReplicas } from '../sync/databases.ts'

export type Me = components['schemas']['Me']

export type SessionState =
  /** Asked and not yet answered, with nothing kept from before. */
  | { readonly status: 'unknown' }
  /** Nobody is signed in. */
  | { readonly status: 'visitor' }
  /** Signed in: the account as it was last read, which with no connection is as it was kept. */
  | { readonly status: 'member'; readonly me: Me }
  /** The server could not be asked, and nothing is kept. */
  | { readonly status: 'unreachable' }

/** Why a member who was signed in here is so no longer, for the sign-in screen to say. */
export type Ended = 'expired' | 'csrf'

export interface Session {
  readonly state: SessionState
  /** Why the session that was here ended, until someone signs in again. */
  readonly ended: Ended | null
  /** Whether the member who was here signed out themselves, until someone signs in again. */
  readonly signedOut: boolean
  /** Reads who is signed in, after a sign-in the server answered: the screen that made it calls. */
  readonly entered: () => Promise<void>
  /**
   * Signs out: the server ends the session, and then what this browser kept is removed. It
   * rejects, and nothing is removed, where the server could not be told: a session only it ends.
   */
  readonly signOut: () => Promise<void>
  /** Asks again who is signed in, where the server could not be asked. */
  readonly retry: () => void
  /** The oldest version the server serves, once it has refused this build as older. */
  readonly minimumVersion: string | null
}

const SessionContext = createContext<Session | null>(null)

/** The query that holds the account: read by key wherever the account is changed. */
export const meKey = ['me'] as const

export interface SessionProviderProps {
  readonly children: ReactNode
  /**
   * Removes what this browser keeps of a member's households: the persisted cache and the
   * replicas (App.tsx). Called when a session ends and when a member signs out.
   */
  readonly forget: () => Promise<void>
  /** Reads the page's cookies. Defaults to `document.cookie`. */
  readonly cookies?: () => string
  /**
   * Starts the page again, for whoever is signed in now: called once what it kept of another
   * member has been removed. Defaults to a reload.
   */
  readonly restart?: () => void
}

const pageCookies = () => document.cookie

const reloadPage = () => {
  window.location.reload()
}

export function SessionProvider({
  children,
  forget,
  cookies = pageCookies,
  restart = reloadPage,
}: SessionProviderProps) {
  const api = useApi()
  const problems = useProblems()
  const queries = useQueryClient()
  const { locale, setLocale, setFormatting } = useI18n()
  // Set when the session that was here ended, and until someone signs in: whatever the account's
  // query still holds, nobody is signed in.
  const [ended, setEnded] = useState<Ended | null>(null)
  const [left, setLeft] = useState(false)
  const [minimumVersion, setMinimumVersion] = useState<string | null>(null)

  // The server sets the session's cookie and the readable one that carries its CSRF token
  // together, and takes both away together: a browser without the second holds no session, and
  // is not asked whose it is. A visitor's page asks the server nothing it would refuse.
  const token = cookieValue(cookies(), csrfCookie)
  const hinted = token !== undefined && token !== ''

  const account = useQuery({
    queryKey: meKey,
    queryFn: async ({ signal }) => unwrap(await api.GET('/me', { signal })),
    // The account is asked for again when the page is looked at again, which is when a session
    // ended from elsewhere is noticed.
    staleTime: 60_000,
    // A session the server said is gone is not asked about again until someone signs in, though
    // its cookies are still here: forgetting empties this query, which would ask at once.
    enabled: hinted && minimumVersion === null && ended === null && !left,
  })
  const refused = problemIn(account.error)?.code === 'unauthenticated'

  const state = useMemo<SessionState>(() => {
    if (left || ended !== null || refused || !hinted) return { status: 'visitor' }
    if (account.data !== undefined) return { status: 'member', me: account.data }
    return account.isError ? { status: 'unreachable' } : { status: 'unknown' }
  }, [left, ended, refused, hinted, account.data, account.isError])

  // A member is read here as they are known to the listener below, which is told of a problem
  // outside any render.
  const member = useRef(false)
  useEffect(() => {
    member.current = state.status === 'member'
  }, [state.status])

  const forgetting = useRef<Promise<void> | null>(null)
  const forgetOnce = useCallback(() => {
    forgetting.current ??= forget().finally(() => {
      forgetting.current = null
    })
    return forgetting.current
  }, [forget])

  // What a session that is gone left behind is removed, whether its ending was heard of here or
  // not: an account still kept in a browser whose cookies were cleared, and a replica, which is
  // kept for longer than the account's day and outlives the cookies that lapsed with its session.
  const kept = account.data !== undefined
  const replicas = keepsReplicas()
  useEffect(() => {
    if ((kept || replicas) && !hinted) void forgetOnce()
  }, [kept, replicas, hinted, forgetOnce])

  // The server said the session this browser holds is gone, of a page that never knew it as a
  // member's: the account is kept for a day and for one build, and the cookies for longer. It
  // ended all the same, and is not asked about again.
  useEffect(() => {
    if (!refused) return
    setEnded('expired')
    void forgetOnce()
  }, [refused, forgetOnce])

  // Whose households this page holds. Another member may be found signed in under it: from
  // another tab of this browser, or where a failed CSRF check left the first one's page as it
  // was. What it kept is the first one's, and the page starts again for whoever is here now.
  const holder = useRef<string | undefined>(undefined)
  const who = account.data?.id
  useEffect(() => {
    const before = holder.current
    holder.current = who
    if (before === undefined || who === undefined || before === who) return
    void forgetOnce().finally(restart)
  }, [who, forgetOnce, restart])

  useEffect(
    () =>
      problems.subscribe((problem) => {
        if (problem.code === 'update_required') {
          setMinimumVersion(problem.minimum_version)
          return
        }
        // A visitor's own refusals are their screens' to answer: a sign-in that failed, a second
        // step whose challenge is gone.
        if (!member.current) return
        if (problem.code === 'unauthenticated') {
          member.current = false
          setEnded('expired')
          void forgetOnce()
        } else if (problem.code === 'csrf_failed') {
          member.current = false
          setEnded('csrf')
        }
      }),
    [problems, forgetOnce],
  )

  // The language is the account's, once it is known, and the pseudo-locale is nobody's: it is
  // chosen on the dev pages and stays until another language is.
  const accountLocale = state.status === 'member' ? state.me.locale : undefined
  // The language shown, as the effect below reads it: it follows the account's language when
  // that is learned or changes, and not a language chosen here since, which the account's
  // settings write to the account themselves.
  const shown = useRef(locale)
  useEffect(() => {
    shown.current = locale
  }, [locale])
  useEffect(() => {
    setFormatting(accountLocale)
    if (accountLocale === undefined || shown.current === pseudoLocale) return
    const language = matchLocale([accountLocale])
    if (language !== shown.current) {
      // A catalog that cannot be fetched leaves the language as it is, which is still a language.
      setLocale(language).catch(() => undefined)
    }
  }, [accountLocale, setFormatting, setLocale])

  const entered = useCallback(async () => {
    await forgetting.current
    setEnded(null)
    setLeft(false)
    await queries.query({
      queryKey: meKey,
      queryFn: async () => unwrap(await api.GET('/me')),
      staleTime: 0,
    })
  }, [api, queries])

  const signOut = useCallback(async () => {
    const answer = await api.POST('/auth/logout')
    // A session the server no longer knows has ended already: what was asked for is so.
    if (answer.response.status !== 401) {
      // Asked outside a query or a mutation, so what it was refused with is told here: a
      // refusal that is about the session is answered as it is wherever it is met.
      const refusal = problemOf(answer)
      if (refusal !== undefined) problems.report(refusal)
      unwrap(answer)
    }
    member.current = false
    setLeft(true)
    await forgetOnce()
  }, [api, problems, forgetOnce])

  const retry = useCallback(() => {
    void account.refetch()
  }, [account])

  const value = useMemo<Session>(
    () => ({ state, ended, signedOut: left, entered, signOut, retry, minimumVersion }),
    [state, ended, left, entered, signOut, retry, minimumVersion],
  )
  return <SessionContext value={value}>{children}</SessionContext>
}

export function useSession(): Session {
  const session = use(SessionContext)
  if (session === null) throw new Error('useSession: no SessionProvider above this component')
  return session
}

/** The signed-in member's account: for a screen drawn only for one (app/guards.tsx). */
export function useMe(): Me {
  const { state } = useSession()
  if (state.status !== 'member') throw new Error('useMe: nobody is signed in on this screen')
  return state.me
}
