// Who is signed in on this device, and what ends it (PRD 02 §2, ADR 0010). A device's sign-in
// is a token pair it keeps (tokens.ts), so the app knows at once whether anybody is signed in,
// and learns who by asking (`GET /me`), whose answer it keeps for when the server cannot be
// asked. Two answers are about the session whoever asked:
//
// - A renewal refused `401 refresh_token_invalid`: the sign-in ended, from elsewhere. Nothing
//   says why (Q18). Everything this device kept of its member is removed, the pair, what was
//   read, every replica with the changes it had not sent (forget.ts, FR-ID7), and the sign-in
//   screen says so. A request refused `401` ends nothing: the client renews and asks again
//   (api/transport.ts).
// - `400 update_required`: this build is older than the server serves. Nothing else is drawn
//   but the screen that says so (update/).
//
// What a device keeps is its member's, by name, and for no longer than their sign-in (D-161's
// twin): what was read is kept under its member (api/keep.ts), and a different member signing
// in removes the first one's first.
//
// The language is the account's once it is known (i18n's `followAccount`), and the display
// modes stay the device's.
import { problemOf, type ApiClient } from '@household/api'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useProblems } from '../api/ApiProvider.tsx'
import { createKeep, removeKept, type Keep } from '../api/keep.ts'
import { unwrap } from '../api/problem.ts'
import { couldNotBeRead } from '../api/query.ts'
import { useI18n } from '../i18n/I18nProvider.tsx'
import { restoreDestination, takeDestination } from '../links/destination.ts'
import { forgetPush } from '../push/registration.ts'
import {
  meKey,
  sameId,
  SessionContext,
  type ReplicaCredential,
  type Session,
  type SessionState,
  type SignedIn,
} from './context.ts'
import { forget, onForget } from './forget.ts'
import { describeDevice } from './installation.ts'
import type { TokenStore } from './tokens.ts'

export interface SessionProviderProps {
  readonly children: ReactNode
  /** The device's sign-ins. */
  readonly tokens: TokenStore
  /**
   * The client the account is read and the sign-in ended through, made when it is first asked
   * for: the one every screen has (`useApi`).
   */
  readonly api: () => ApiClient
}

/** What the device kept of the member whose sign-in is in use, and what stops its writing. */
interface Kept {
  readonly member: string
  readonly keep: Keep
  readonly stop: () => void
}

export function SessionProvider({ children, tokens, api }: SessionProviderProps) {
  const problems = useProblems()
  const queries = useQueryClient()
  const { followAccount } = useI18n()
  // Whether the device's own has been read: until then nobody is known to be signed in or not.
  const [read, setRead] = useState(false)
  const [member, setMember] = useState<string | null>(null)
  const [ended, setEnded] = useState(false)
  const [left, setLeft] = useState(false)
  const [minimumVersion, setMinimumVersion] = useState<string | null>(null)

  const kept = useRef<Kept | null>(null)
  const keepFor = useCallback(
    (id: string) => {
      kept.current?.stop()
      const keep = createKeep(id)
      kept.current = { member: id, keep, stop: keep.watch(queries) }
      return keep
    },
    [queries],
  )

  // What the session itself keeps of a member, removed with everything else of theirs: what was
  // read, on the device and in memory. The reads on screen are theirs only while theirs is the
  // sign-in in use.
  useEffect(
    () =>
      onForget(async (id) => {
        const own = kept.current
        if (own?.member !== id) {
          await removeKept(id)
          return
        }
        kept.current = null
        // Asked first, so that nothing the emptying below stirs is written back.
        const removing = own.keep.remove()
        own.stop()
        queries.clear()
        await removing
      }),
    [queries],
  )

  // One forgetting after another, which a sign-in that follows waits for.
  const forgetting = useRef<Promise<void>>(Promise.resolve())
  const forgetNext = useCallback((id: string) => {
    forgetting.current = forgetting.current.then(() => forget(id))
    return forgetting.current
  }, [])

  // The device's own, read once: whose sign-in it holds, what it kept of what they read, and an
  // address held from a run before this one.
  const starting = useRef<Promise<void> | null>(null)
  const start = useCallback(() => {
    starting.current ??= (async () => {
      const [active] = await Promise.all([tokens.start(), restoreDestination()])
      if (active !== null) await keepFor(active).restore(queries)
    })()
    return starting.current
  }, [tokens, queries, keepFor])
  useEffect(() => {
    let wanted = true
    void start().then(() => {
      if (!wanted) return
      // Whoever the device holds now: a sign-in taken while it was being read is that one.
      setMember(tokens.member())
      setRead(true)
    })
    return () => {
      wanted = false
    }
  }, [start, tokens])
  useEffect(
    () => () => {
      kept.current?.stop()
    },
    [],
  )

  // The server refused to renew the sign-in: it has ended, and its pair is gone already.
  useEffect(
    () =>
      tokens.onEnded((id) => {
        setMember(null)
        setEnded(true)
        void forgetNext(id)
      }),
    [tokens, forgetNext],
  )

  useEffect(
    () =>
      problems.subscribe((problem) => {
        if (problem.code === 'update_required') setMinimumVersion(problem.minimum_version)
      }),
    [problems],
  )

  const account = useQuery({
    queryKey: meKey,
    queryFn: async ({ signal }) => unwrap(await api().GET('/me', { signal })),
    // The account is asked for again each time the app is looked at again, however lately it
    // was read: that is when a sign-in ended from elsewhere is noticed, and a name or a language
    // changed on another device. Read a moment ago it is not asked for again by anything else.
    staleTime: 60_000,
    refetchOnWindowFocus: 'always',
    enabled: read && member !== null && minimumVersion === null,
  })
  // What the query holds may be the last member's for a moment, as another signs in: an
  // account is the one signed in only where its id is theirs.
  const me =
    account.data !== undefined && sameId(account.data.id, member) ? account.data : undefined
  // Asked with no connection the question may wait for one, neither answered nor failed: with
  // nothing kept, the server could not be asked, and no skeleton says otherwise.
  const unasked = couldNotBeRead(account)

  const state = useMemo<SessionState>(() => {
    if (!read) return { status: 'unknown' }
    if (member === null) return { status: 'visitor' }
    if (me !== undefined) return { status: 'member', me }
    return unasked ? { status: 'unreachable' } : { status: 'unknown' }
  }, [read, member, me, unasked])

  const accountLocale = state.status === 'member' ? state.me.locale : undefined
  useEffect(() => {
    followAccount(accountLocale)
  }, [accountLocale, followAccount])

  const signedIn = useCallback(
    async ({ user, tokens: pair }: SignedIn) => {
      const id = user.id.toLowerCase()
      await start()
      await forgetting.current
      // What the device kept is its member's. Another member's, signed in here before, goes
      // first: its pair, and with it everything else.
      const before = tokens.member()
      if (before !== null && before !== id) {
        await tokens.remove(before)
        await forgetNext(before)
      }
      await tokens.keep(id, pair)
      if (kept.current?.member !== id) keepFor(id)
      queries.setQueryData(meKey, user)
      setEnded(false)
      setLeft(false)
      setMember(id)
      setRead(true)
    },
    [tokens, queries, start, keepFor, forgetNext],
  )

  const signOut = useCallback(async () => {
    const id = tokens.member()
    if (id === null) return
    const client = api()
    // While the server can still be told, and not put back if what follows fails: the next
    // start registers the device again.
    await forgetPush(client, id)
    const answer = await client.POST('/auth/logout')
    // A sign-in the server no longer knows has ended already: what was asked for is so.
    if (answer.response.status !== 401) {
      // Asked outside a query or a mutation, so what it was refused with is told here.
      const refusal = problemOf(answer)
      if (refusal !== undefined) problems.report(refusal)
      unwrap(answer)
    }
    await tokens.remove(id)
    // Whoever signs in next is not sent to where this member was going.
    takeDestination()
    setLeft(true)
    setEnded(false)
    setMember(null)
    await forgetNext(id)
  }, [tokens, api, problems, forgetNext])

  // The query's own, which is the same function for as long as the query is observed.
  const { refetch } = account
  const retry = useCallback(() => {
    void refetch()
  }, [refetch])

  const device = useCallback(async () => describeDevice(await tokens.device()), [tokens])

  const credential = useCallback(
    (gone: () => Error): ReplicaCredential => {
      // The token a request of the replica's was refused on is the one it was last handed.
      let handed: string | undefined
      return {
        current: async () => {
          handed = await tokens.current()
          if (handed === undefined) throw gone()
          return handed
        },
        renew: async () => {
          const renewed = handed === undefined ? await tokens.current() : await tokens.renew(handed)
          if (renewed === undefined) throw gone()
          handed = renewed
        },
      }
    },
    [tokens],
  )

  const value = useMemo<Session>(
    () => ({
      state,
      ended,
      signedOut: left,
      signedIn,
      signOut,
      retry,
      minimumVersion,
      device,
      credential,
    }),
    [state, ended, left, signedIn, signOut, retry, minimumVersion, device, credential],
  )
  return <SessionContext value={value}>{children}</SessionContext>
}
