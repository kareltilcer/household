// A new PIN for a child profile (PRD 02 §6 FR-CH5, D-104; PRD 17 FR-HA7): an owner types it
// twice, 4 to 6 digits. The old PIN stops working on every device at once, the profile is
// signed out everywhere, since whoever knew the old PIN may hold one of them, and a locked
// profile is unlocked by it. The owner tells the child in person: nothing sends a PIN anywhere,
// and it is said nowhere on the screen once it is set, the toast included.
//
// The prototype asks for four digits and refuses the ones that are easy to guess. The contract
// takes 4 to 6 digits and screens none: what it would not refuse is not refused here.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import styles from '../../account/Settings.module.css'
import { useApi } from '../../api/ApiProvider.tsx'
import { unwrap } from '../../api/problem.ts'
import { askedNow } from '../../api/query.ts'
import { fieldCodes, useRefusedField } from '../../auth/fields.tsx'
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import { Button } from '../../ui/Button.tsx'
import { Sheet } from '../../ui/Dialog.tsx'
import { PasswordField } from '../../ui/Field.tsx'
import { useToast } from '../../ui/Toast.tsx'
import { useReread, type Membership } from '../data.ts'
import { useHousehold } from '../HouseholdContext.tsx'
import { memberKey, pinShape, type Refusals, type Subject } from './member.ts'
import { Refused } from './MemberRefused.tsx'

export function ChildPin({
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
  const queries = useQueryClient()
  const toast = useToast()
  const household = useHousehold()
  const reread = useReread(household.id)
  const id = useId()
  const first = useRef<HTMLInputElement>(null)
  const { name } = subject
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  // What was typed that is not sent, set anew each time: no PIN, or two that differ.
  const [fault, setFault] = useState<{ readonly field: 'pin' | 'again' }>()

  const set = useMutation({
    ...askedNow,
    mutationFn: async (next: string) => {
      unwrap(
        await api.PUT('/households/{household_id}/children/{user_id}/pin', {
          params: { path: { household_id: household.id, user_id: subject.id } },
          body: { pin: next },
        }),
      )
    },
    onSuccess: () => {
      // A new PIN unlocks the profile: the server's word, drawn before the member is read again.
      queries.setQueryData<Membership>(memberKey(household.id, subject.id), (was) =>
        was?.child == null ? was : { ...was, child: { ...was.child, pin_locked: false } },
      )
      // Never the PIN itself: it is said by the owner, in person.
      toast({ message: t('household.child.pin.done', { name }) })
      onClose()
      void reread()
    },
    onError: (error) => {
      if (fieldCodes(error).has('/pin')) return
      if (refusals.refuse(error)) onClose()
    },
  })
  const form = useRefusedField(fault ?? set.error)
  const malformed = fault?.field === 'pin' || fieldCodes(set.error).has('/pin')
  const close = () => {
    if (set.isPending) return
    refusals.clear()
    onClose()
  }

  return (
    <Sheet
      open
      onClose={close}
      title={t('household.child.pin.title', { name })}
      description={t('household.child.pin.note', { name })}
      initialFocus={first}
      actions={
        <>
          <Button onClick={close}>{t('account.cancel')}</Button>
          <Button type="submit" form={id} variant="primary" loading={set.isPending}>
            {t('household.child.pin.save')}
          </Button>
        </>
      }
    >
      <form
        id={id}
        ref={form}
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          set.reset()
          refusals.clear()
          if (!pinShape.test(pin)) {
            setFault({ field: 'pin' })
            return
          }
          if (pin !== again) {
            setFault({ field: 'again' })
            return
          }
          setFault(undefined)
          set.mutate(pin)
        }}
      >
        <PasswordField
          ref={first}
          label={t('household.child.pin.label')}
          help={t('household.child.pin.help')}
          inputMode="numeric"
          autoComplete="new-password"
          value={pin}
          error={malformed ? t('household.child.pin.malformed') : undefined}
          onChange={(event) => {
            setPin(event.currentTarget.value)
          }}
        />
        <PasswordField
          label={t('household.child.pin.again')}
          inputMode="numeric"
          autoComplete="new-password"
          value={again}
          error={fault?.field === 'again' ? t('household.child.pin.mismatch') : undefined}
          onChange={(event) => {
            setAgain(event.currentTarget.value)
          }}
        />
        <Refused refusal={refusals.refusal} />
      </form>
    </Sheet>
  )
}
