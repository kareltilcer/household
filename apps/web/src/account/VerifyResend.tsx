// *Send the verification link again* (A-3, A-4): for a member whose address is not verified yet,
// offered where that matters, beside the address on their account and where an action it blocks
// is refused. The server answers the same whether or not anything was sent, so the screen says
// where the link went and that only the newest one works, and no more.
import { useMutation } from '@tanstack/react-query'
import { useApi } from '../api/ApiProvider.tsx'
import { unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { askedNow, useOwnZone } from './common.ts'
import styles from './Settings.module.css'

export function VerifyResend({ email }: { readonly email: string }) {
  const t = useTranslate()
  const api = useApi()
  const say = useProblemText(useOwnZone())
  const resend = useMutation({
    ...askedNow,
    mutationFn: async () => {
      unwrap(await api.POST('/auth/verify-email/resend', { body: { email } }))
    },
  })
  return (
    <div className={styles.group}>
      <div className={styles.actions}>
        <Button
          loading={resend.isPending}
          onClick={() => {
            resend.mutate()
          }}
        >
          {t('account.verify.resend')}
        </Button>
      </div>
      {resend.isSuccess ? (
        <Banner tone="info" announce>
          {t('account.verify.sent', { email })}
        </Banner>
      ) : null}
      {resend.isError ? (
        <Banner tone="danger" announce>
          {say(resend.error)}
        </Banner>
      ) : null}
    </div>
  )
}
