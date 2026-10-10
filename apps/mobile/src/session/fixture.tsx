// The session a component test is drawn in. The test harness (src/test/render.tsx) draws every
// test inside this, so that a component that asks who is signed in, or for the API, is
// answered: by a member, and by a client that answers nothing until a test says what. A test
// that needs another session draws its component inside one of its own, which stands over the
// harness's:
//
//   await render(<SessionFixture state={{ status: 'visitor' }} ended><Subject /></SessionFixture>)
//
// Nothing here reads the device: no keychain, no notifications, no stored reads.
import type { ApiClient } from '@household/api'
import { useMemo, useState, type ReactNode } from 'react'
import { ApiProvider } from '../api/ApiProvider.tsx'
import { createProblemHub, type ProblemHub } from '../api/problems.ts'
import { answering, testClient } from '../api/testing.ts'
import { ids, people } from '../test/fixtures.ts'
import { SessionContext, type Me, type Session, type SessionState } from './context.ts'

/** An account as the API answers it: the fixtures' owner, or whoever `over` makes of them. */
export function account(over: Partial<Me> = {}): Me {
  return {
    id: ids.member,
    email: people.owner.email,
    email_verified: true,
    display_name: people.owner.name,
    avatar_url: null,
    locale: 'en',
    timezone: null,
    first_day_of_week: null,
    is_child: false,
    mfa_enabled: false,
    mfa_recovery_codes_left: null,
    credentials: ['password'],
    deletion_scheduled_at: null,
    ...over,
  }
}

export interface SessionFixtureProps extends Partial<
  Pick<Session, 'ended' | 'signedOut' | 'minimumVersion' | 'signedIn' | 'signOut' | 'retry'>
> {
  readonly children: ReactNode
  /** Who is signed in. Left out, the fixtures' owner. */
  readonly state?: SessionState
  /** The client `useApi` answers with. Left out, one that fails whatever is asked, by name. */
  readonly api?: ApiClient
  /** Left out, a hub of the fixture's own. */
  readonly problems?: ProblemHub
}

const nothing = () => Promise.resolve()

export function SessionFixture({
  children,
  state,
  api,
  problems,
  ended = false,
  signedOut = false,
  minimumVersion = null,
  signedIn = nothing,
  signOut = nothing,
  retry = () => undefined,
}: SessionFixtureProps) {
  const [made] = useState(() => ({
    api: testClient(answering({}).transport),
    problems: createProblemHub(),
    state: { status: 'member', me: account() } as const,
  }))
  const session = useMemo<Session>(
    () => ({
      state: state ?? made.state,
      ended,
      signedOut,
      minimumVersion,
      signedIn,
      signOut,
      retry,
      device: () =>
        Promise.resolve({ id: ids.device, platform: 'ios' as const, app_version: '0.0.0' }),
      credential: () => ({
        current: () => Promise.resolve('access'),
        renew: nothing,
      }),
    }),
    [state, made, ended, signedOut, minimumVersion, signedIn, signOut, retry],
  )
  return (
    <ApiProvider client={api ?? made.api} problems={problems ?? made.problems}>
      <SessionContext value={session}>{children}</SessionContext>
    </ApiProvider>
  )
}
