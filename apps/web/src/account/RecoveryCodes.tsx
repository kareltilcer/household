// The recovery codes (A-6): ten, each spent once in place of a code from the app, answered by the
// server once and never again. So they are shown from what this page was handed and holds in
// memory alone: nothing keeps them, a reload loses them, and no later screen lists them or marks
// one as used. The account says only how many are left (`Me.mfa_recovery_codes_left`).
//
// Copy, Download and Print are each a real way to keep them, the drawer being the place they
// belong. *Finish* is there before the box is ticked: pressed too soon it asks again, and never
// sits dead.
import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Checkbox } from '../ui/Choice.tsx'
import { cx } from '../ui/cx.ts'
import { useToast } from '../ui/Toast.tsx'
import { copyText } from './common.ts'
import { SettingsPage } from './Page.tsx'
import styles from './Settings.module.css'

/** The name of the file the codes are saved as: the same in every language, as a file's is. */
export const codesFile = 'household-recovery-codes.txt'

/**
 * Hands the member `text` as a file named `name`: made in the page, and fetched from nowhere. It
 * answers with the address the file is at, for its caller to let go of.
 */
function download(name: string, text: string): string {
  const address = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = address
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  return address
}

export interface RecoveryCodesProps {
  /** The ten codes, as the server answered them. */
  readonly codes: readonly string[]
  /** The member has said they saved them: the codes are let go of. */
  readonly onFinish: () => void
}

export function RecoveryCodes({ codes, onFinish }: RecoveryCodesProps) {
  const t = useTranslate()
  const toast = useToast()
  const [saved, setSaved] = useState(false)
  const [asked, setAsked] = useState(false)
  const box = useRef<HTMLInputElement>(null)
  // The files handed over are let go of with the screen, and not in the press that made them:
  // a browser may begin reading a file only once the press has returned, and one let go of by
  // then is saved as nothing.
  const files = useRef<string[]>([])
  useEffect(() => {
    const made = files.current
    return () => {
      for (const address of made.splice(0)) URL.revokeObjectURL(address)
    }
  }, [])
  const list = codes.join('\n')
  return (
    <SettingsPage title={t('account.codes.title')} lead={t('account.codes.lead')}>
      <Banner tone="info">{t('account.codes.retires')}</Banner>
      <ol className={styles.codes} role="list" aria-label={t('account.codes.list')}>
        {codes.map((code) => (
          <li key={code} className={styles.code}>
            {code}
          </li>
        ))}
      </ol>
      <div className={cx(styles.actions, styles.unprinted)}>
        <Button
          onClick={() => {
            copyText(list).then(
              () => {
                toast({ message: t('account.codes.copied') })
              },
              () => {
                toast({ message: t('account.codes.copy_failed') })
              },
            )
          }}
        >
          {t('account.codes.copy')}
        </Button>
        <Button
          onClick={() => {
            files.current.push(
              download(codesFile, `${t('account.codes.file_heading')}\n\n${list}\n`),
            )
          }}
        >
          {t('account.codes.download')}
        </Button>
        <Button
          onClick={() => {
            window.print()
          }}
        >
          {t('account.codes.print')}
        </Button>
      </div>
      <div className={cx(styles.group, styles.unprinted)}>
        <Checkbox
          ref={box}
          label={t('account.codes.saved')}
          checked={saved}
          onChange={(event) => {
            setSaved(event.currentTarget.checked)
            setAsked(false)
          }}
        />
        {asked && !saved ? (
          <Banner tone="warning" announce>
            {t('account.codes.ask_again')}
          </Banner>
        ) : null}
        <div className={styles.actions}>
          <Button
            variant="primary"
            onClick={() => {
              if (saved) {
                onFinish()
                return
              }
              // Asked again, with the box it waits for under the focus.
              setAsked(true)
              box.current?.focus()
            }}
          >
            {t('account.codes.finish')}
          </Button>
        </div>
      </div>
    </SettingsPage>
  )
}
