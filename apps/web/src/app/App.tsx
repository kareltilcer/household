// The app: its providers, outermost first, around its router. The language and the display modes
// stand outside everything, since even the screen a broken route falls back to is drawn in them;
// the query cache and the API client are next, then the session, which every screen but the
// dev-only ones is drawn for, and the toasts are inside them all.
import type { ApiClient } from '@household/api'
import { QueryClientProvider } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { useCallback, useState, type ReactNode } from 'react'
import { RouterProvider, type RouterProviderProps } from 'react-router'
import { ApiProvider } from '../api/ApiProvider.tsx'
import { createWebClient } from '../api/client.ts'
import { createProblemHub } from '../api/problems.ts'
import { createPersister, createQueryClient, persistOptions } from '../api/query.ts'
import { DisplayProvider } from '../display/DisplayProvider.tsx'
import { I18nProvider } from '../i18n/I18nProvider.tsx'
import { SessionProvider } from '../session/SessionProvider.tsx'
import { forgetReplicas } from '../sync/databases.ts'
import { ToastProvider } from '../ui/Toast.tsx'
import { ownBuild } from '../update/build.ts'

export interface ProvidersProps {
  readonly children: ReactNode
  /**
   * Whether the query cache is kept in this browser. A test turns it off, and reads from a cache
   * it made itself.
   */
  readonly persist?: boolean
  /** The API client. Left out, the app's own; a test gives one whose transport it answers. */
  readonly client?: ApiClient
  /** Reads the page's cookies. Left out, `document.cookie`; a test says what they are. */
  readonly cookies?: () => string
}

/** Everything a screen may ask for, with no router: what a component test wraps its subject in. */
export function Providers({ children, persist = true, client, cookies }: ProvidersProps) {
  const [problems] = useState(createProblemHub)
  const [api] = useState(() => client ?? createWebClient(cookies === undefined ? {} : { cookies }))
  const [queries] = useState(() => createQueryClient({ onProblem: problems.report }))
  const [persister] = useState(() => (persist ? createPersister() : undefined))
  const [persistence] = useState(() =>
    persister === undefined ? undefined : persistOptions(persister, ownBuild()),
  )
  // What this browser keeps of a member's households, removed when they sign out or their
  // session ends (06-clients, ADR 0026): what was read, in memory and in the persisted cache,
  // and every replica.
  const forget = useCallback(async () => {
    queries.clear()
    await persister?.removeClient()
    await forgetReplicas()
  }, [queries, persister])
  const inner = (
    <ApiProvider client={api} problems={problems}>
      <SessionProvider forget={forget} {...(cookies === undefined ? {} : { cookies })}>
        <ToastProvider>{children}</ToastProvider>
      </SessionProvider>
    </ApiProvider>
  )
  return (
    <I18nProvider>
      <DisplayProvider>
        {persistence === undefined ? (
          <QueryClientProvider client={queries}>{inner}</QueryClientProvider>
        ) : (
          <PersistQueryClientProvider client={queries} persistOptions={persistence}>
            {inner}
          </PersistQueryClientProvider>
        )}
      </DisplayProvider>
    </I18nProvider>
  )
}

/**
 * The app around its router, which whoever draws it makes, once and outside React (main.tsx). A
 * router listens to the browser's history from the moment it is made, and React's strict mode
 * runs a state's initializer twice in development: made in one, the router thrown away would go
 * on listening.
 */
export function App({ router }: Pick<RouterProviderProps, 'router'>) {
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  )
}
