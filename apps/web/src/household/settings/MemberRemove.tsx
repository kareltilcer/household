// Removing a member (PRD 02 §3 FR-HH5; PRD 17 FR-HA6; 03-patterns §5), from their own page.
//
// An owner's, on anybody's page but their own. The question names who is removed and from what,
// and says what becomes of what they made before it is asked: what they added stays, as the
// household's record; their private notes and documents go after thirty days, theirs to export
// until then; and they are told. A child profile has no account outside its household, so its
// profile, its PIN and every sign-in it has end with it, and nobody is left to tell.
//
// The payer has no control: the server refuses to remove them until billing has moved, and what
// has to happen first is said in the control's place. Nobody removes themself: they leave.
//
// Once the member is removed the page it was asked from is about nobody. It goes to the list of
// members, which is where the focus starts over, and what this browser kept of the member goes
// as the page leaves: read again while the page still stood, the member's own address would
// answer that it opens nothing, and the page would say so on its way out.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
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
import { useHousehold } from '../HouseholdContext.tsx'
import { membersKey } from '../households.ts'
import { memberKey, useRefusals, type Subject } from './member.ts'
import { Refused } from './MemberRefused.tsx'
import { Section, useStanding } from './Page.tsx'

export function MemberRemove({ subject }: { readonly subject: Subject }) {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const household = useHousehold()
  const standing = useStanding()
  const reread = useReread(household.id)
  const refusals = useRefusals(household.id)
  const [asking, setAsking] = useState(false)
  const { name } = subject
  const named = { name, household: household.name }

  // Whether the member was removed, and the page is on its way to the list. What is kept of
  // them is dropped, and the household read again, as this page leaves and not a moment sooner.
  const removed = useRef(false)
  const forget = useRef<() => void>(() => undefined)
  useEffect(() => {
    forget.current = () => {
      queries.removeQueries({ queryKey: memberKey(household.id, subject.id), exact: true })
      void reread()
    }
  }, [queries, reread, household.id, subject.id])
  useEffect(
    () => () => {
      if (removed.current) forget.current()
    },
    [],
  )

  const remove = useMutation({
    ...askedNow,
    mutationFn: async () => {
      unwrap(
        await api.DELETE('/households/{household_id}/members/{user_id}', {
          params: { path: { household_id: household.id, user_id: subject.id } },
        }),
      )
    },
    onSuccess: () => {
      removed.current = true
      setAsking(false)
      // The list this leads to is drawn from what was kept until it is read again: without them.
      queries.setQueryData<Membership[]>(membersKey(household.id), (list) =>
        list?.filter((each) => each.user_id?.toLowerCase() !== subject.id.toLowerCase()),
      )
      toast({
        message:
          subject.role === 'child'
            ? t('household.member.remove.done_child', { name })
            : t('household.member.remove.done', { name }),
      })
      void navigate(inHousehold.members(household.id), { replace: true })
    },
    onError: (error) => {
      // Billing moved to them since the page was read: what the control's place would have said.
      const why =
        problemIn(error)?.code === 'billing_payer'
          ? t('household.member.remove.payer', { name })
          : undefined
      if (refusals.refuse(error, why)) setAsking(false)
    },
  })
  const close = () => {
    if (remove.isPending) return
    refusals.clear()
    setAsking(false)
  }

  if (subject.own) return null
  if (!standing.changes) {
    return refusals.refusal === undefined ? null : (
      <Section title={t('household.member.remove.title')}>
        <Refused refusal={refusals.refusal} />
      </Section>
    )
  }
  return (
    <Section title={t('household.member.remove.title')}>
      {subject.payer ? (
        // No button that could only be refused: what it waits for is said in its place.
        <p className={styles.text}>{t('household.member.remove.payer', { name })}</p>
      ) : (
        <div className={styles.actions}>
          <Button
            variant="danger"
            onClick={() => {
              refusals.clear()
              setAsking(true)
            }}
          >
            {t('household.member.remove.action', { name })}
          </Button>
        </div>
      )}
      {asking ? null : <Refused refusal={refusals.refusal} />}
      <Dialog
        open={asking}
        onClose={close}
        title={t('household.member.remove.confirm.title', named)}
        description={
          subject.role === 'child'
            ? t('household.member.remove.confirm.child', { name })
            : t('household.member.remove.confirm.body', { name })
        }
        actions={
          <>
            <Button onClick={close}>{t('account.cancel')}</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                refusals.clear()
                remove.mutate()
              }}
            >
              {t('household.member.remove.confirm.action', named)}
            </Button>
          </>
        }
      >
        {refusals.refusal === undefined ? undefined : <Refused refusal={refusals.refusal} />}
      </Dialog>
    </Section>
  )
}
