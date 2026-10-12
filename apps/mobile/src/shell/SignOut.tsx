// Signing out, from More. The sign-in is the server's to end: the session removes this device's
// push registration, tells the server, and only then removes what the device kept of its member
// (session/SessionProvider.tsx). Where the server could not be told the member is still signed
// in, with everything kept, and is told so: no control of its screen says it. Where it could,
// the guard above every household screen, or the index, leads to the sign-in by itself, and
// this control stays busy until it has.
import { useState } from 'react'
import { problemIn } from '../api/problem.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useSession } from '../session/context.ts'
import { Button } from '../ui/Button.tsx'
import { BaseIcon } from '../ui/Icon.tsx'
import { useToast } from '../ui/Toast.tsx'

export interface SignOutProps {
  /** Left out, More's: the index draws the same control for a member in no household. */
  readonly testID?: string
}

export function SignOut({ testID = 'more:sign-out' }: SignOutProps) {
  const t = useTranslate()
  const toast = useToast()
  const { signOut } = useSession()
  const [leaving, setLeaving] = useState(false)
  return (
    <Button
      testID={testID}
      icon={<BaseIcon name="log-out" />}
      loading={leaving}
      onPress={() => {
        setLeaving(true)
        signOut().catch((error: unknown) => {
          // Refused as a build older than the server serves: *please update* takes every
          // screen's place, this one's among them, and says itself (update/UpdateRequired.tsx).
          // A toast raised now would be said for a screen that is no longer drawn, and in
          // words untrue of that refusal, the server having answered.
          if (problemIn(error)?.code === 'update_required') return
          // With no answer from the server nothing was ended: the control is theirs again.
          setLeaving(false)
          toast({ message: t('shell.sign_out.failed') })
        })
      }}
    >
      {t('shell.sign_out.action')}
    </Button>
  )
}
