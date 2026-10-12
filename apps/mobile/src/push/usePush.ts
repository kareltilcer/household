// Push as a screen holds it (03-patterns §8): what this device says of notifications, and the
// two things a member does about it, turning them on, which is where the system's own question
// is put, and turning them off here. The state is read as the screen opens and again when the
// app is looked at again, which is when a member comes back from the system's own settings, the
// one place a refusal is undone. No screen of this build draws it yet: the account's
// notifications screen is plan item 29's, and a module asks in context through `usePushPrompt`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useApi } from '../api/ApiProvider.tsx'
import { askedNow } from '../api/query.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe, useSession } from '../session/context.ts'
import {
  pushProject,
  pushStateKey,
  readPushState,
  requestPushPermission,
  subscribePush,
  unsubscribePush,
  type PushPermission,
  type PushState,
} from './registration.ts'

export interface Push {
  /** What this device says, or undefined until it has been read. */
  readonly state: PushState | undefined
  /**
   * Turns notifications on for this device. Called in a press: the system's question is put
   * then and there, where it has not been answered, and a device that allows them is
   * registered. It answers with the state it comes to, and rejects where registering failed.
   */
  readonly ask: () => Promise<PushState>
  /** Whether a press of `ask` is still being answered. */
  readonly asking: boolean
  /** Why the last `ask` failed, or null. */
  readonly askError: unknown
  /** Turns notifications off on this device, and keeps them off across sign-ins. */
  readonly turnOff: () => Promise<PushState>
  readonly turningOff: boolean
  readonly turnOffError: unknown
}

export function usePush(): Push {
  const api = useApi()
  const t = useTranslate()
  const queries = useQueryClient()
  const { device } = useSession()
  const member = useMe().id
  // What Android's settings call the notifications, in the language the app is in.
  const channel = t('device.push.channel')
  const project = pushProject()
  const state = useQuery({
    queryKey: pushStateKey(member),
    queryFn: () => readPushState(member, project),
    // The device's own, read from it each time: kept nowhere, and read with no connection too.
    meta: { persist: false },
    gcTime: 0,
    networkMode: 'always',
  })
  const settle = useCallback(
    (next: PushState) => {
      queries.setQueryData(pushStateKey(member), next)
    },
    [queries, member],
  )
  const on = useMutation({
    ...askedNow,
    mutationFn: async (answer: Promise<PushPermission>) =>
      (await answer) === 'granted'
        ? subscribePush({ api, member, device: (await device()).id, channel, project })
        : readPushState(member, project),
    onSuccess: settle,
  })
  const off = useMutation({
    ...askedNow,
    mutationFn: () => unsubscribePush(api, member, project),
    onSuccess: settle,
  })
  const { mutateAsync: turnOn } = on
  const { mutateAsync: turnOff } = off
  // The question is put as `ask` is called, in the press itself, and what follows waits on it.
  const ask = useCallback(
    () => turnOn(requestPushPermission(channel, project)),
    [turnOn, channel, project],
  )
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
 * something that implies wanting to be told, and never as the app starts. A control that would
 * ask is drawn while `state.permission` is `default`, and calls `ask` in its own press.
 */
export function usePushPrompt(): PushPrompt {
  const { state, ask } = usePush()
  return { state, ask }
}
