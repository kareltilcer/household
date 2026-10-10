// What the app does about push wherever it is open, drawing nothing. A notification that
// arrives while the app is open is shown as any other is. And a device that allows
// notifications already is registered again for the member who is here, when they sign in and
// when the app starts with them signed in: a token reaches its member only while their sign-in
// lives, and Expo may have given the installation another since. Nothing is asked: the system's
// question is a press's alone (registration.ts). Where a pressed notification leads is the
// links' (links/Links.tsx).
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useApi, useProblems } from '../api/ApiProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useSession } from '../session/context.ts'
import { showWhileOpen } from './device.ts'
import { pushProject, pushStateKey, renewPush } from './registration.ts'

/** Registers the device again for `member`, once: they are signed in. */
function Renewal({ member }: { readonly member: string }) {
  const api = useApi()
  const problems = useProblems()
  const queries = useQueryClient()
  const { device } = useSession()
  const t = useTranslate()
  const channel = t('device.push.channel')
  useEffect(() => {
    let wanted = true
    void device().then(async ({ id }) => {
      if (!wanted) return
      await renewPush({ api, member, device: id, channel, project: pushProject() }, problems)
      // A screen that read this device's state before the renewal registered it reads it again.
      await queries.invalidateQueries({ queryKey: pushStateKey(member) })
    })
    return () => {
      wanted = false
    }
  }, [api, problems, queries, device, member, channel])
  return null
}

export function Push() {
  const { state } = useSession()
  const member = state.status === 'member' ? state.me.id : null
  useEffect(() => {
    showWhileOpen()
  }, [])
  // Nobody is registered for nobody, and the client is asked for only once somebody is here.
  return member === null ? null : <Renewal member={member} />
}
