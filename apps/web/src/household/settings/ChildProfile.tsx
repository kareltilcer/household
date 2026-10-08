// A child profile's own part of its page (PRD 17 FR-HA7; PRD 02 §6 FR-CH1 to FR-CH5, D-104;
// ADR 0012; 03-patterns §9).
//
// Every reader is told what a child profile is to the household: how it signs in, with the
// household's code, its profile and a PIN, and with no address; its year of birth, where the
// answer carries one, which is to the owners and the child alone; whether Home is locked for
// it; and that it is locked, when ten wrong PINs locked it. The lock is written calmly: it is
// what keeps a guesser out, nothing is lost by it, and nobody is in trouble.
//
// An owner, in a household that takes writes, unlocks it, sets a new PIN (ChildPin.tsx), sets
// its picture (ChildPicture.tsx) and gives it a sign-in of its own, which is how a child profile
// becomes a member (ChildGraduate.tsx).
//
// What is left out, and why:
// - No control changes whether Home is locked. It was chosen when the profile was made, and no
//   operation changes it afterwards: locking and laying out a child's Home is the dashboard's
//   (plan item 36). Its name and its year of birth have no operation either.
// - The prototype pauses a profile after five wrong tries, for a time. The lock is ten, and it
//   lasts until an owner lifts it (FR-CH5).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import styles from '../../account/Settings.module.css'
import { useApi } from '../../api/ApiProvider.tsx'
import { unwrap } from '../../api/problem.ts'
import { askedNow } from '../../api/query.ts'
import { useFormat, useTranslate } from '../../i18n/I18nProvider.tsx'
import { Banner } from '../../ui/Banner.tsx'
import { Button } from '../../ui/Button.tsx'
import { KeyValue, type Pair } from '../../ui/KeyValue.tsx'
import { useToast } from '../../ui/Toast.tsx'
import { useReread, type Membership } from '../data.ts'
import { useHousehold } from '../HouseholdContext.tsx'
import { ChildGraduate } from './ChildGraduate.tsx'
import { ChildPicture } from './ChildPicture.tsx'
import { ChildPin } from './ChildPin.tsx'
import { memberKey, useFocusHandedOn, useRefusals, type Subject } from './member.ts'
import { Refused } from './MemberRefused.tsx'
import { Section, useStanding } from './Page.tsx'

export function ChildProfile({ subject }: { readonly subject: Subject }) {
  const t = useTranslate()
  const format = useFormat()
  const api = useApi()
  const queries = useQueryClient()
  const toast = useToast()
  const household = useHousehold()
  const standing = useStanding()
  const reread = useReread(household.id)
  const refusals = useRefusals(household.id)
  const [panel, setPanel] = useState<'pin' | 'graduate' | null>(null)
  const { name } = subject
  const child = subject.membership.child ?? {}
  const locked = child.pin_locked === true

  const unlock = useMutation({
    ...askedNow,
    mutationFn: async () => {
      unwrap(
        await api.POST('/households/{household_id}/children/{user_id}/unlock', {
          params: { path: { household_id: household.id, user_id: subject.id } },
        }),
      )
    },
    onSuccess: () => {
      // The server's word that the lock is lifted, drawn before the member is read again.
      queries.setQueryData<Membership>(memberKey(household.id, subject.id), (was) =>
        was?.child == null ? was : { ...was, child: { ...was.child, pin_locked: false } },
      )
      toast({ message: t('household.child.unlock.done', { name }) })
      void reread()
    },
    onError: (error) => {
      refusals.refuse(error)
    },
  })

  // The banner leaves with the lock, and its button with it, which held the focus: it goes to
  // the control that stays beside where the banner stood, the one that sets a new PIN.
  const newPin = useRef<HTMLButtonElement>(null)
  useFocusHandedOn(locked && standing.changes, newPin)

  const facts: Pair[] = []
  if (typeof child.year_of_birth === 'number') {
    facts.push({
      key: t('household.child.born'),
      // A year is no quantity: it is written without the separator a thousand takes.
      value: format.number(child.year_of_birth, { useGrouping: false }),
      numeric: true,
    })
  }
  if (child.dashboard_locked !== undefined) {
    facts.push({
      key: t('household.child.home.label'),
      value: child.dashboard_locked
        ? t('household.child.home.locked', { name })
        : t('household.child.home.open', { name }),
    })
  }
  const close = () => {
    setPanel(null)
  }

  return (
    <Section title={t('household.child.title', { name })}>
      {locked ? (
        // Read in its place: it was so when the page opened.
        <Banner
          tone="warning"
          title={t('household.child.locked.title')}
          actions={
            standing.changes ? (
              <Button
                loading={unlock.isPending}
                onClick={() => {
                  refusals.clear()
                  unlock.mutate()
                }}
              >
                {t('household.child.unlock.action')}
              </Button>
            ) : undefined
          }
        >
          {t('household.child.locked.body')}
        </Banner>
      ) : null}
      <p className={styles.text}>{t('household.child.sign_in', { name })}</p>
      {facts.length > 0 ? <KeyValue pairs={facts} /> : null}
      {standing.changes ? (
        <>
          <div className={styles.actions}>
            <Button
              ref={newPin}
              onClick={() => {
                refusals.clear()
                setPanel('pin')
              }}
            >
              {t('household.child.pin.action')}
            </Button>
            <Button
              onClick={() => {
                refusals.clear()
                setPanel('graduate')
              }}
            >
              {t('household.child.graduate.action', { name })}
            </Button>
          </div>
          <ChildPicture subject={subject} refusals={refusals} />
        </>
      ) : null}
      {/* A panel that is open says its own refusal: one that closed it is said here. */}
      {panel === null ? <Refused refusal={refusals.refusal} /> : null}
      {panel === 'pin' ? <ChildPin subject={subject} refusals={refusals} onClose={close} /> : null}
      {panel === 'graduate' ? (
        <ChildGraduate subject={subject} refusals={refusals} onClose={close} />
      ) : null}
    </Section>
  )
}
