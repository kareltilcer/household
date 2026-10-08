// Web Push as a screen holds it (03-patterns §8): what this browser says of notifications, and
// the two things a member does about it, turning them on, which is where the browser's own
// question is put, and turning them off here. The state is read as the screen opens and again
// when the page is looked at again, which is when a member comes back from the browser's own
// settings, the one place a refusal is undone.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useApi } from '../api/ApiProvider.tsx'
import {
  readPushState,
  requestPushPermission,
  subscribePush,
  unsubscribePush,
  type PushPermission,
  type PushState,
} from './worker.ts'

/** The query that holds this browser's state: read by key where something else changes it. */
export const pushStateKey = ['push', 'state'] as const

export interface Push {
  /** What this browser says, or undefined until it has been read. */
  readonly state: PushState | undefined
  /**
   * Turns notifications on in this browser. Called in a press: the browser's question is put
   * then and there, where it has not been answered, and a browser that allows them is
   * subscribed. It answers with the state it comes to, and rejects where subscribing failed.
   */
  readonly ask: () => Promise<PushState>
  /** Whether a press of `ask` is still being answered. */
  readonly asking: boolean
  /** Why the last `ask` failed, or null. */
  readonly askError: unknown
  /** Turns notifications off in this browser, and keeps them off across sign-ins. */
  readonly turnOff: () => Promise<PushState>
  readonly turningOff: boolean
  readonly turnOffError: unknown
}

export function usePush(): Push {
  const api = useApi()
  const queries = useQueryClient()
  const state = useQuery({
    queryKey: pushStateKey,
    queryFn: readPushState,
    // The browser's own, read from it each time: kept nowhere, and read with no connection too.
    meta: { persist: false },
    gcTime: 0,
    networkMode: 'always',
  })
  const settle = useCallback(
    (next: PushState) => {
      queries.setQueryData(pushStateKey, next)
    },
    [queries],
  )
  const on = useMutation({
    networkMode: 'always',
    mutationFn: async (answer: Promise<PushPermission>) =>
      (await answer) === 'granted' ? subscribePush(api) : readPushState(),
    onSuccess: settle,
  })
  const off = useMutation({
    networkMode: 'always',
    mutationFn: () => unsubscribePush(api),
    onSuccess: settle,
  })
  const { mutateAsync: turnOn } = on
  const { mutateAsync: turnOff } = off
  // The question is put as `ask` is called, in the press itself, and what follows waits on it.
  const ask = useCallback(() => turnOn(requestPushPermission()), [turnOn])
  return {
    state: state.data,
    ask,
    asking: on.isPending,
    askError: on.error,
    turnOff: useCallback(() => turnOff(), [turnOff]),
    turningOff: off.isPending,
    turnOffError: off.error,
  }
}

export interface PushPrompt {
  readonly state: PushState | undefined
  readonly ask: () => Promise<PushState>
}

/**
 * For a module to ask in context (03-patterns §8, 06-clients §6): the first time a member does
 * something that implies wanting to be told, and never as a page loads. A control that would
 * ask is drawn while `state.permission` is `default`, and calls `ask` in its own press.
 */
export function usePushPrompt(): PushPrompt {
  const { state, ask } = usePush()
  return { state, ask }
}
