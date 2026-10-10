// The API client, handed down: a screen asks `useApi` for it and never makes its own, so every
// request leaves with the same name, the same sign-in and the same handling of what comes back.
// With it, where a problem that is about the app is told (problems.ts).
import type { ApiClient } from '@household/api'
import { createContext, use, useMemo, type ReactNode } from 'react'
import type { ProblemHub } from './problems.ts'

interface Api {
  readonly client: () => ApiClient
  readonly problems: ProblemHub
}

const ApiContext = createContext<Api | null>(null)

export interface ApiProviderProps {
  /**
   * The client, or what makes it when it is first asked for. The app hands the second: its
   * client is made of the address the build was told, and a provider that stands around every
   * screen makes nothing before a screen asks for it.
   */
  readonly client: ApiClient | (() => ApiClient)
  readonly problems: ProblemHub
  readonly children: ReactNode
}

export function ApiProvider({ client, problems, children }: ApiProviderProps) {
  const value = useMemo(
    () => ({ client: typeof client === 'function' ? client : () => client, problems }),
    [client, problems],
  )
  return <ApiContext value={value}>{children}</ApiContext>
}

function useApiContext(): Api {
  const api = use(ApiContext)
  if (api === null) throw new Error('useApi: no ApiProvider above this component')
  return api
}

export function useApi(): ApiClient {
  return useApiContext().client()
}

/** Where a request made outside a query or a mutation tells of the problem it met. */
export function useProblems(): ProblemHub {
  return useApiContext().problems
}
