// The notice of a household's scheduled deletion (PRD 05 §5 FR-PR6, D-138; PRD 17 FR-HA16):
// the day the household goes, said to every member wherever they would look for it, on the
// settings' first screen (household/settings/Profile.tsx) and above the household's data
// (Data.tsx), with the way to take what is theirs before then, and for an owner the control
// that keeps the household.
//
// The household says one thing of a deletion, the day (`deletion_scheduled_at`): not who asked
// for it nor when, which the prototype drew and nothing serves. Any owner cancels it, whoever
// scheduled it, in every state the household can be opened in (FR-BI1), and is not asked twice:
// keeping a household destroys nothing, and every member is told of it as they were of the
// deletion. An owner told that none is pending any more is told what is so, and the household
// is read again.
//
// It reads the words under `household.deletion` and no other part's, so that the profile's
// screen, whose route fetches the household's words alone, may draw it (i18n/words.test.ts).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, type RefObject } from 'react'
import { Link } from 'react-router'
import { refocus } from '../account/common.ts'
import account from '../account/Settings.module.css'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { paths } from '../app/paths.ts'
import { useReread } from '../household/data.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { householdKey, type Household } from '../household/households.ts'
import { useStanding } from '../household/settings/Page.tsx'
import { useStandingRefusal } from '../household/settings/profile.ts'
import { useTimeZone } from '../household/timezone.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { useToast } from '../ui/Toast.tsx'

export interface DeletionNoticeProps {
  /**
   * Where the focus goes once the control that keeps the household has left, with the notice
   * or with its reader's being an owner: the place of the screen that draws it.
   */
  readonly after: RefObject<HTMLElement | null>
}

export function DeletionNotice({ after }: DeletionNoticeProps) {
  const t = useTranslate()
  const format = useFormat()
  const api = useApi()
  const queries = useQueryClient()
  const toast = useToast()
  const household = useHousehold()
  const { owner } = useStanding()
  const zone = useTimeZone()
  const say = useProblemText(zone)
  const standing = useStandingRefusal()
  const reread = useReread(household.id)
  const { id, name } = household
  const at = household.deletion_scheduled_at ?? null
  /** Whether the control that keeps the household is drawn: an owner's, while a deletion waits. */
  const offered = owner && at !== null

  // The control that was pressed leaves once the household is kept, or its member is read as an
  // owner no longer, and the focus it held with it.
  const pressed = useRef(false)
  useEffect(() => {
    if (!pressed.current || offered) return
    pressed.current = false
    refocus(after.current)
  }, [offered, after])

  const keep = useMutation({
    ...askedNow,
    mutationFn: async () => {
      unwrap(
        await api.DELETE('/households/{household_id}/deletion', {
          params: { path: { household_id: id } },
        }),
      )
    },
    onSuccess: () => {
      // Drawn as kept at once, and read again for how it stands.
      queries.setQueryData<Household>(householdKey(id), (was) =>
        was === undefined ? was : { ...was, deletion_scheduled_at: null },
      )
      toast({ message: t('household.deletion.kept', { household: name }) })
      void reread()
    },
    onError: (error) => {
      const problem = problemIn(error)
      // None is pending any more: another owner kept the household first. What was asked for
      // is so, which the household read again says.
      if (problem?.status === 404) toast({ message: t('household.deletion.none') })
      if (problem?.status === 404 || problem?.status === 403) void reread()
    },
  })

  if (at === null) return null
  const refusal =
    keep.isError && problemIn(keep.error)?.status !== 404
      ? (standing(keep.error) ?? say(keep.error))
      : undefined
  return (
    <div className={account.group}>
      {/* Not announced: it was so when the screen opened, and whoever scheduled it here was
          told as they did. */}
      <Banner
        tone="warning"
        title={t('household.deletion.title', {
          household: name,
          day: format.dayOf(at, zone, 'long'),
        })}
        actions={
          <>
            <Link className={account.link} to={paths.accountPrivacy.path}>
              {t('household.deletion.own')}
            </Link>
            {owner ? (
              <Button
                loading={keep.isPending}
                onClick={() => {
                  pressed.current = true
                  keep.mutate()
                }}
              >
                {t('household.deletion.keep', { household: name })}
              </Button>
            ) : null}
          </>
        }
      >
        {t('household.deletion.body')}
      </Banner>
      {refusal === undefined ? null : (
        // One of its own for each refusal, so that a second is said as the first was.
        <Banner key={keep.submittedAt} tone="danger" announce>
          {refusal}
        </Banner>
      )}
    </div>
  )
}
