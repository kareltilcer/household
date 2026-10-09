// A member's role (PRD 17 FR-HA17; PRD 02 §3 FR-HH6, §4; D-103), on their own page.
//
// An owner makes a member an owner too, and another owner a member. Both are asked first. Making
// somebody an owner says what owners can do, that there can be several, and that billing does
// not move with it. Making an owner a member has a question the prototype had none for: they
// lose the household's administration, they keep the levels they hold until somebody lowers
// them, and what they sent that still waits, invitations and the links that give a child profile
// a sign-in of its own, is withdrawn (D-103).
//
// What is left out, and why:
// - The payer has no control here. Billing moves only between owners (FR-HH6), so the server
//   would refuse, and a button that could only be refused is not drawn: the sentence in its
//   place says what has to happen first. Handing billing over is billing's own screen (plan
//   item 27), which is not built: the sentence links nowhere.
// - Nobody's own role is changed from their own page, an owner's included: they leave, which is
//   a screen of its own and says what stands in the way. The page leads there.
// - A child profile has no role control. A role is never changed to or from child (FR-CH1):
//   giving the profile a sign-in of its own is how it becomes a member (ChildProfile.tsx).
import { entityTag } from '@household/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import styles from '../../account/Settings.module.css'
import { useApi } from '../../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../../api/problem.ts'
import { askedNow } from '../../api/query.ts'
import { inHousehold } from '../../app/paths.ts'
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import { Button } from '../../ui/Button.tsx'
import { Dialog } from '../../ui/Dialog.tsx'
import { useToast } from '../../ui/Toast.tsx'
import { useReread, type Membership } from '../data.ts'
import { useLevelWords } from '../grants.ts'
import { useHousehold } from '../HouseholdContext.tsx'
import { memberKey, useRefusals, type Subject } from './member.ts'
import { Refused } from './MemberRefused.tsx'
import { Section, useStanding } from './Page.tsx'

export function MemberRole({ subject }: { readonly subject: Subject }) {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const toast = useToast()
  const words = useLevelWords()
  const household = useHousehold()
  const standing = useStanding()
  const reread = useReread(household.id)
  const refusals = useRefusals(household.id)
  const [asking, setAsking] = useState(false)
  const { name } = subject
  const owner = subject.role === 'owner'
  const path = { household_id: household.id, user_id: subject.id }

  const changed = (answer: Membership) => {
    queries.setQueryData(memberKey(household.id, subject.id), answer)
    setAsking(false)
    void reread()
  }
  const promote = useMutation({
    ...askedNow,
    mutationFn: async () =>
      unwrap(
        await api.POST('/households/{household_id}/ownership/transfer', {
          params: { path: { household_id: household.id } },
          body: { user_id: subject.id },
        }),
      ),
    onSuccess: (answer) => {
      changed(answer)
      toast({ message: t('household.member.role.owner.done', { name }) })
    },
    onError: (error) => {
      if (refusals.refuse(error)) setAsking(false)
    },
  })
  const demote = useMutation({
    ...askedNow,
    mutationFn: async () =>
      unwrap(
        await api.PATCH('/households/{household_id}/members/{user_id}', {
          params: { path, header: { 'If-Match': entityTag(subject.version) } },
          body: { role: 'member' },
        }),
      ),
    onSuccess: (answer) => {
      changed(answer)
      toast({ message: t('household.member.role.member.done', { name }) })
    },
    onError: (error) => {
      const code = problemIn(error)?.code
      // Neither is so as this page read the household, or the control would not have been
      // drawn: billing moved to them, or the other owners left, since. Each is said as it is.
      const why =
        code === 'billing_payer'
          ? t('household.member.role.refused.payer', { name })
          : code === 'last_owner'
            ? t('household.member.role.refused.last_owner', { name })
            : undefined
      if (refusals.refuse(error, why)) setAsking(false)
    },
  })
  const change = owner ? demote : promote
  const close = () => {
    if (change.isPending) return
    refusals.clear()
    setAsking(false)
  }

  if (subject.role === 'child') return null
  if (subject.own) {
    return (
      <Section title={t('household.member.own.title')}>
        <p className={styles.text}>
          {t('household.member.own.note', { household: household.name })}
        </p>
        <Link className={styles.link} to={inHousehold.leave(household.id)}>
          {t('household.leave.title', { household: household.name })}
        </Link>
      </Section>
    )
  }
  if (!standing.changes) {
    // Nothing of a role is a reader's to change. What a change was refused with, to somebody
    // who was an owner when they pressed, is still said where its control stood.
    return refusals.refusal === undefined ? null : (
      <Section title={t('household.member.role.title')}>
        <Refused refusal={refusals.refusal} />
      </Section>
    )
  }
  // One control, whose words say which way it goes: made an owner or a member, the member's
  // page keeps the button the question was asked from, and the focus the question gives back.
  const action = owner
    ? t('household.member.role.make_member', { name })
    : t('household.member.role.make_owner', { name })
  return (
    <Section title={t('household.member.role.title')}>
      {owner && subject.payer ? (
        <p className={styles.text}>{t('household.member.role.payer', { name })}</p>
      ) : (
        <div className={styles.actions}>
          <Button
            onClick={() => {
              refusals.clear()
              setAsking(true)
            }}
          >
            {action}
          </Button>
        </div>
      )}
      {asking ? null : <Refused refusal={refusals.refusal} />}
      <Dialog
        open={asking}
        onClose={close}
        title={
          owner
            ? t('household.member.role.member.title', { name })
            : t('household.member.role.owner.title', { name })
        }
        description={
          owner
            ? t('household.member.role.member.body', { name, level: words.name('manage') })
            : t('household.member.role.owner.body')
        }
        actions={
          <>
            <Button onClick={close}>{t('account.cancel')}</Button>
            <Button
              variant="primary"
              loading={change.isPending}
              onClick={() => {
                refusals.clear()
                change.mutate()
              }}
            >
              {action}
            </Button>
          </>
        }
      >
        {refusals.refusal === undefined ? undefined : <Refused refusal={refusals.refusal} />}
      </Dialog>
    </Section>
  )
}
