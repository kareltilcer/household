// What the app does about Web Push wherever it is open, drawing nothing. A pressed notification's
// address is opened (PushLinks.tsx). And a browser that allows notifications already is registered
// again for the member who is here, when they sign in and when the app starts with them signed
// in: a subscription reaches its member only while the session that registered it lives, and a
// browser may have let one go since. Nothing is asked: the browser's question is a press's alone
// (worker.ts).
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useApi, useProblems } from '../api/ApiProvider.tsx'
import { useSession } from '../session/SessionProvider.tsx'
import { PushLinks } from './PushLinks.tsx'
import { pushStateKey, renewPush } from './worker.ts'

export function Push() {
  const api = useApi()
  const problems = useProblems()
  const queries = useQueryClient()
  const { state } = useSession()
  const member = state.status === 'member' ? state.me.id : null
  useEffect(() => {
    if (member === null) return
    // A screen that read this browser's state before the renewal subscribed it reads it again.
    void renewPush(api, problems).then(() => queries.invalidateQueries({ queryKey: pushStateKey }))
  }, [api, problems, queries, member])
  return <PushLinks />
}
