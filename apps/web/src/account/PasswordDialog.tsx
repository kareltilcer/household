// The password, asked again before a change to how an account signs in (PRD 02, ADR 0010): a
// second step enrolled or turned off, and new recovery codes made. The server asks for it with
// each of them, since a session alone, one left open on a shared computer or stolen, must not be
// enough to bind an authenticator of its own or take the codes. It is asked in a confirmation,
// which names what is about to happen and says what goes with it; a wrong password is said
// beside the field, which takes the focus, and what was typed stays.
import { useId, useState } from 'react'
import { problemIn } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { useRefusedField } from '../auth/fields.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { PasswordField } from '../ui/Field.tsx'
import { useOwnZone } from './common.ts'
import styles from './Settings.module.css'

export interface PasswordDialogProps {
  readonly open: boolean
  /** What is about to happen, naming what it happens to. */
  readonly title: string
  /** What goes with it, and what stays, in a plain sentence. */
  readonly description: string
  /** Its one action's words: what it does, and for one that destroys, to what. */
  readonly confirm: string
  /** Whether the action takes something away that does not come back. */
  readonly danger?: boolean
  /** Whether the server is being asked: the action is busy, and the dialog stays. */
  readonly pending: boolean
  /** What the server refused the last attempt with, or null. */
  readonly error: unknown
  readonly onSubmit: (password: string) => void
  /** Asked to close, which it is not while the server is being asked. */
  readonly onClose: () => void
}

function Ask({
  id,
  error,
  onSubmit,
}: Pick<PasswordDialogProps, 'error' | 'onSubmit'> & { readonly id: string }) {
  const t = useTranslate()
  const me = useMe()
  const say = useProblemText(useOwnZone())
  const [password, setPassword] = useState('')
  // Set, anew, each time nothing was typed: it is not sent.
  const [missing, setMissing] = useState<object>()
  const form = useRefusedField(missing ?? error)
  const wrong = problemIn(error)?.code === 'invalid_credentials'
  const said =
    missing !== undefined
      ? t('account.password.missing')
      : error === null || error === undefined
        ? undefined
        : wrong
          ? t('account.password.wrong')
          : say(error)
  return (
    <form
      id={id}
      ref={form}
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (password === '') {
          setMissing({})
          return
        }
        setMissing(undefined)
        onSubmit(password)
      }}
    >
      {/* Whose password it is, for a password manager: drawn nowhere, and no field of the form's. */}
      <input type="text" hidden readOnly autoComplete="username" value={me.email ?? ''} />
      <PasswordField
        label={t('account.password.label')}
        autoComplete="current-password"
        value={password}
        error={said}
        onChange={(event) => {
          setPassword(event.currentTarget.value)
        }}
      />
    </form>
  )
}

export function PasswordDialog({
  open,
  title,
  description,
  confirm,
  danger = false,
  pending,
  error,
  onSubmit,
  onClose,
}: PasswordDialogProps) {
  const t = useTranslate()
  const form = useId()
  const close = () => {
    // A request under way is answered before the dialog goes: what it comes to is said in it.
    if (!pending) onClose()
  }
  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      description={description}
      actions={
        <>
          <Button onClick={close}>{t('account.cancel')}</Button>
          <Button
            type="submit"
            form={form}
            variant={danger ? 'danger' : 'primary'}
            loading={pending}
          >
            {confirm}
          </Button>
        </>
      }
    >
      {/* Drawn while the dialog is open alone, so what was typed goes when it closes. */}
      <Ask id={form} error={error} onSubmit={onSubmit} />
    </Dialog>
  )
}
