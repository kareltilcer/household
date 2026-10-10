// Signing out, from More. The sign-in is the server's to end: the session removes this device's
// push registration, tells the server, and only then removes what the device kept of its member
// (session/SessionProvider.tsx). Where the server could not be told the member is still signed
// in, with everything kept, and is told so. Where it could, the guard above every household
// screen leads to the sign-in by itself, and this control stays busy until it has.
import { useState } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useSession } from '../session/context.ts'
import { Button } from '../ui/Button.tsx'
import { BaseIcon } from '../ui/Icon.tsx'
import { useToast } from '../ui/Toast.tsx'

export function SignOut() {
  const t = useTranslate()
  const toast = useToast()
  const { signOut } = useSession()
  const [leaving, setLeaving] = useState(false)
  return (
    <Button
      testID="more:sign-out"
      icon={<BaseIcon name="log-out" />}
      loading={leaving}
      onPress={() => {
        setLeaving(true)
        signOut().catch(() => {
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
