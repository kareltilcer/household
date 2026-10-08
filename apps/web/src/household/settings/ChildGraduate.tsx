// Giving a child profile a sign-in of its own (PRD 02 §6 FR-CH4, D-104; ADR 0012): an owner
// names the address, and a link goes to it with which the young adult chooses a password. That
// verifies the address and makes the profile a member in one step. Until it is used the profile
// is a child still, signing in with its PIN.
//
// The panel says what it does before it asks for anything: nothing is lost or copied, the same
// person gets an address and a password in place of the PIN, they become a member with the
// levels they hold and everything they made, Home unlocks, and the owners stop reading their
// private notes, which is a child profile's alone (FR-CH3).
//
// Once the link is sent the panel says so in its form's place, and that is the only record of
// it: the membership does not say that a link is out, so nothing on the member's page does
// either. The prototype draws a pending invitation with a way to withdraw it, which the contract
// has none of: sending another link, to the same address or a corrected one, retires the one
// before, and the panel says that instead.
//
// The link carries the household's name to somebody's mailbox on the owner's word, so the owner's
// own address is verified first (FR-ID1): an owner whose address is not is told so here, from
// the first where the account says it and in the form's place where the server does. An address
// an account already has is refused without saying more than that it cannot be used here: that
// an account has it is nobody's to learn from this field (D-13).
import { useMutation } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import styles from '../../account/Settings.module.css'
import { useApi } from '../../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../../api/problem.ts'
import { askedNow } from '../../api/query.ts'
import { checkEmail, refusedEmail, useRefusedField, type EmailFault } from '../../auth/fields.tsx'
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import { useMe } from '../../session/SessionProvider.tsx'
import { Banner } from '../../ui/Banner.tsx'
import { Button } from '../../ui/Button.tsx'
import { Sheet } from '../../ui/Dialog.tsx'
import { TextField } from '../../ui/Field.tsx'
import { useToast } from '../../ui/Toast.tsx'
import { useHousehold } from '../HouseholdContext.tsx'
import { isUnverified, Unverified, useMarkUnverified } from '../Unverified.tsx'
import { useFocusHandedOn, type Refusals, type Subject } from './member.ts'
import own from './Member.module.css'
import { Refused } from './MemberRefused.tsx'

export function ChildGraduate({
  subject,
  refusals,
  onClose,
}: {
  readonly subject: Subject
  readonly refusals: Refusals
  readonly onClose: () => void
}) {
  const t = useTranslate()
  const api = useApi()
  const me = useMe()
  const toast = useToast()
  const household = useHousehold()
  const markUnverified = useMarkUnverified()
  const id = useId()
  const field = useRef<HTMLInputElement>(null)
  const ending = useRef<HTMLButtonElement>(null)
  const { name } = subject
  const [email, setEmail] = useState('')
  // What was typed that is not sent, set anew each time: nothing, or no address.
  const [unsent, setUnsent] = useState<{ readonly fault: EmailFault }>()
  // The address the link went to, once it has.
  const [sentTo, setSentTo] = useState<string>()

  const send = useMutation({
    ...askedNow,
    mutationFn: async (address: string) => {
      unwrap(
        await api.POST('/households/{household_id}/children/{user_id}/graduate', {
          params: { path: { household_id: household.id, user_id: subject.id } },
          body: { email: address },
        }),
      )
    },
    onSuccess: (_answer, address) => {
      setSentTo(address)
    },
    onError: (error) => {
      if (isUnverified(error)) {
        // The server's word on it, whatever this page had read of the account.
        markUnverified()
        return
      }
      // The address's own to say, beside it.
      if (refusedEmail(error) !== undefined || problemIn(error)?.code === 'email_taken') return
      if (refusals.refuse(error)) onClose()
    },
  })
  const taken = problemIn(send.error)?.code === 'email_taken'
  const fault = unsent?.fault ?? refusedEmail(send.error)
  const form = useRefusedField(unsent ?? send.error)
  const verified = me.email_verified
  const asks = verified && sentTo === undefined
  // The form's own button goes with the form, when the link is sent and when the account turns
  // out not to be verified: the focus it held goes to the one that stays, which ends the panel.
  useFocusHandedOn(asks, ending)

  const close = () => {
    if (send.isPending) return
    refusals.clear()
    // Nothing on the page behind says a link went: it is said once more as the panel closes.
    if (sentTo !== undefined) {
      toast({ message: t('household.child.graduate.sent.toast', { email: sentTo }) })
    }
    onClose()
  }

  return (
    <Sheet
      open
      onClose={close}
      title={t('household.child.graduate.action', { name })}
      {...(asks ? { initialFocus: field } : {})}
      actions={
        <>
          <Button ref={ending} onClick={close}>
            {sentTo === undefined ? t('account.cancel') : t('household.child.graduate.sent.done')}
          </Button>
          {asks ? (
            <Button type="submit" form={id} variant="primary" loading={send.isPending}>
              {t('household.child.graduate.send')}
            </Button>
          ) : null}
        </>
      }
    >
      <ul className={own.points} role="list">
        <li>{t('household.child.graduate.what', { name })}</li>
        <li>{t('household.child.graduate.member', { name })}</li>
        <li>{t('household.child.graduate.private', { name })}</li>
      </ul>
      {sentTo !== undefined ? (
        // What became of the press, in the form's place: said as it arrives.
        <Banner tone="info" announce>
          <ul className={own.points} role="list">
            <li>{t('household.child.graduate.sent.body', { email: sentTo })}</li>
            <li>{t('household.child.graduate.sent.until', { name })}</li>
            <li>{t('household.child.graduate.sent.again')}</li>
          </ul>
        </Banner>
      ) : !verified ? (
        <Unverified
          why={t('household.child.graduate.unverified')}
          announce={isUnverified(send.error)}
        />
      ) : (
        <form
          id={id}
          ref={form}
          className={styles.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            const address = email.trim()
            const wrong = checkEmail(address)
            send.reset()
            refusals.clear()
            setUnsent(wrong === undefined ? undefined : { fault: wrong })
            if (wrong === undefined) send.mutate(address)
          }}
        >
          <TextField
            ref={field}
            label={t('household.child.graduate.email.label')}
            help={t('household.child.graduate.email.help')}
            type="email"
            inputMode="email"
            // Somebody else's address: nothing of the owner's own is offered for it.
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            // The contract's longest address.
            maxLength={254}
            value={email}
            error={
              taken
                ? t('household.child.graduate.email.taken')
                : fault === 'required'
                  ? t('household.child.graduate.email.required')
                  : fault === 'invalid'
                    ? t('household.child.graduate.email.invalid')
                    : undefined
            }
            onChange={(event) => {
              setEmail(event.currentTarget.value)
            }}
          />
          <Refused refusal={refusals.refusal} />
        </form>
      )}
    </Sheet>
  )
}
