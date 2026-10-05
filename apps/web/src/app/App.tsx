// The app: its providers, outermost first, around its router. The language and the display modes
// stand outside everything, since even the screen a broken route falls back to is drawn in them;
// the API client and the query cache are next, and the toasts are inside them all.
import { QueryClientProvider } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { useState, type ReactNode } from 'react'
import { RouterProvider, type RouterProviderProps } from 'react-router'
import { ApiProvider } from '../api/ApiProvider.tsx'
import { createWebClient } from '../api/client.ts'
import { createPersister, createQueryClient, persistOptions } from '../api/query.ts'
import { DisplayProvider } from '../display/DisplayProvider.tsx'
import { I18nProvider } from '../i18n/I18nProvider.tsx'
import { ToastProvider } from '../ui/Toast.tsx'
import { ownBuild } from '../update/build.ts'

export interface ProvidersProps {
  readonly children: ReactNode
  /**
   * Whether the query cache is kept in this browser. A test turns it off, and reads from a cache
   * it made itself.
   */
  readonly persist?: boolean
}

/** Everything a screen may ask for, with no router: what a component test wraps its subject in. */
export function Providers({ children, persist = true }: ProvidersProps) {
  const [api] = useState(() => createWebClient())
  const [queries] = useState(() => createQueryClient())
  const [persistence] = useState(() =>
    persist ? persistOptions(createPersister(), ownBuild()) : undefined,
  )
  const inner = (
    <ApiProvider client={api}>
      <ToastProvider>{children}</ToastProvider>
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
