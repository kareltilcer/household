// The API client, handed down: a screen asks `useApi` for it and never makes its own, so every
// request leaves with the same name, the same token and the same handling of what comes back.
import type { ApiClient } from '@household/api'
import { createContext, use, type ReactNode } from 'react'

const ApiContext = createContext<ApiClient | null>(null)

export function ApiProvider({
  client,
  children,
}: {
  readonly client: ApiClient
  readonly children: ReactNode
}) {
  return <ApiContext value={client}>{children}</ApiContext>
}

export function useApi(): ApiClient {
  const client = use(ApiContext)
  if (client === null) throw new Error('useApi: no ApiProvider above this component')
  return client
}
