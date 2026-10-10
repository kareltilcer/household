// What stands around every screen once the display and the language do (app/Root.tsx), outermost
// first: the query client and the API client with the problem hub, then the session, which
// every screen but the dev-only ones is drawn for, and inside it *please update* in every
// screen's place where the server asked for a newer build. Beside the screens, drawing nothing:
// what the app does about an address that arrives (links/) and about push (push/).
//
// Everything made here is made once for the app's life, and nothing of it asks the device or
// the server anything until the session starts: the API clients are made when they are first
// asked for, being made of the address the build was told.
import type { ApiClient } from '@household/api'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { ApiProvider } from '../api/ApiProvider.tsx'
import { createMobileClient } from '../api/client.ts'
import { createProblemHub, type ProblemHub } from '../api/problems.ts'
import { createQueryClient, watchFocus } from '../api/query.ts'
import { Links } from '../links/Links.tsx'
import { Push } from '../push/Push.tsx'
import { UpdateRequired } from '../update/UpdateRequired.tsx'
import { useSession } from './context.ts'
import { exchange } from './renewal.ts'
import { SessionProvider } from './SessionProvider.tsx'
import { createTokenStore, type TokenStore } from './tokens.ts'
import { secureVault, type Vault } from './vault.ts'

/** What the app is made of under its screens. */
export interface Services {
  readonly problems: ProblemHub
  readonly queries: QueryClient
  readonly tokens: TokenStore
  /** The client every screen asks through, signed with the device's sign-in. */
  readonly api: () => ApiClient
}

/** `make`'s answer, made when it is first asked for and the same one from then on. */
function once<Made>(make: () => Made): () => Made {
  let made: { readonly value: Made } | undefined
  return () => {
    made ??= { value: make() }
    return made.value
  }
}

export interface ServiceOptions {
  /** Where the sign-ins are kept. Left out, the device's keychain. */
  readonly vault?: Vault
  /** Makes a client: one that signs with `bearer`, or that signs nothing. Left out, the app's own. */
  readonly client?: (bearer?: TokenStore) => ApiClient
}

export function createServices({
  vault = secureVault(),
  client = (bearer) => createMobileClient(bearer === undefined ? {} : { bearer }),
}: ServiceOptions = {}): Services {
  const problems = createProblemHub()
  // The sign-in is renewed through a client that signs nothing (renewal.ts).
  const unsigned = once(() => client())
  const tokens = createTokenStore({
    vault,
    exchange: (refresh) => exchange(unsigned(), problems, refresh),
  })
  return {
    problems,
    queries: createQueryClient({ onProblem: problems.report }),
    tokens,
    api: once(() => client(tokens)),
  }
}

/**
 * *Please update* in every screen's place, and nothing else, once the server has asked for it:
 * no route, no address that arrives, no registration. Nothing this build asks will be answered.
 */
function Served({ children }: { readonly children: ReactNode }) {
  const { minimumVersion } = useSession()
  if (minimumVersion !== null) return <UpdateRequired />
  return (
    <>
      {children}
      {/* After the screens, so that the router they stand in is there to be told. */}
      <Links />
      <Push />
    </>
  )
}

export interface SessionProvidersProps {
  readonly children: ReactNode
  /** Left out, the app's own; a test gives ones it answers for. */
  readonly services?: Services
}

export function SessionProviders({ children, services: given }: SessionProvidersProps) {
  const [services] = useState(() => given ?? createServices())
  useEffect(() => watchFocus(), [])
  return (
    <QueryClientProvider client={services.queries}>
      <ApiProvider client={services.api} problems={services.problems}>
        <SessionProvider tokens={services.tokens} api={services.api}>
          <Served>{children}</Served>
        </SessionProvider>
      </ApiProvider>
      <Emptied queries={services.queries} />
    </QueryClientProvider>
  )
}

/**
 * Empties what was read as the providers are taken down. The app's stand for as long as it
 * runs; a test's do not, and a read nobody draws is kept in memory for a day by a timer, which
 * would hold whatever ran the test open for as long. It stands after everything that reads:
 * what is taken down is put away in the order it stands in, and a reader that let go of its
 * read after this had emptied them would set the timer again.
 */
function Emptied({ queries }: { readonly queries: QueryClient }) {
  useEffect(
    () => () => {
      queries.clear()
    },
    [queries],
  )
  return null
}
