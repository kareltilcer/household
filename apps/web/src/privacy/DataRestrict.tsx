// Stopping all changes in a household, and lifting it (C-56; PRD 17 §7 FR-HA20, PRD 04 §3
// FR-BI7, D-114; 03-patterns §3): GDPR Article 18 as something an owner does themself, beside
// export and deletion and not beside billing, since it is no billing action.
//
// Any owner restricts and any owner lifts, at once, in every state the household can be opened
// in (FR-BI1). The question that restricts says plainly what stops, every change and every
// upload, for everybody, what waits in a browser or on a phone among it, and what does not:
// reading, downloading, exporting, and the subscription, which keeps running and keeps being
// charged. It takes a reason, which nobody has to give and every member then reads. The
// prototype drew no reason; the contract takes one.
//
// Lifting is no return to normal, and the control says so before it is used (03-patterns §3):
// a household whose subscription lapsed under the restriction stays read-only, with the day its
// data is kept until; one in its trial is told the trial's day, one in grace that uploads stay
// paused. Past those, what the household's own answer carries says no more, so the screen
// claims no more: whether a payment is outstanding is not this screen's to know. The restriction
// is read off `restriction` and never off the state, which a lapse outranks (D-114). Either
// write answers how the household then stands, which is kept at once and said.
import type { components } from '@household/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import account from '../account/Settings.module.css'
import { useApi } from '../api/ApiProvider.tsx'
import { unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { fieldCodes, useRefusedField } from '../auth/fields.tsx'
import { useReread } from '../household/data.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { householdKey, type Household } from '../household/households.ts'
import { useStandingRefusal, type AskedProps } from '../household/settings/profile.ts'
import { useTimeZone } from '../household/timezone.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { TextArea } from '../ui/Field.tsx'
import { useToast } from '../ui/Toast.tsx'

type Entitlement = components['schemas']['EntitlementSummary']

/** The longest reason the contract takes, in characters. */
const longestReason = 500

/**
 * Keeps how the household stands, as a restriction's write answered it, in the household every
 * screen reads, and reads the household again.
 */
function useTaken(): (answer: Entitlement) => void {
  const queries = useQueryClient()
  const household = useHousehold()
  const reread = useReread(household.id)
  return (answer) => {
    queries.setQueryData<Household>(householdKey(household.id), (was) =>
      was === undefined ? was : { ...was, entitlement: answer },
    )
    void reread()
  }
}

export interface RestrictProps extends AskedProps {
  /** Restricted: what the screen draws in the place of the control that asked is drawn next. */
  readonly onDone: () => void
}

/** The question that stops all changes: what stops, what does not, and a reason if one is given. */
export function Restrict({ onClose, onDone, onEnded }: RestrictProps) {
  const t = useTranslate()
  const api = useApi()
  const toast = useToast()
  const household = useHousehold()
  const say = useProblemText(useTimeZone())
  const standing = useStandingRefusal()
  const taken = useTaken()
  const form = useId()
  const [reason, setReason] = useState('')
  const { id, name } = household

  const restrict = useMutation({
    ...askedNow,
    mutationFn: async (given: string) =>
      unwrap(
        await api.POST('/households/{household_id}/restriction', {
          params: { path: { household_id: id } },
          // No reason is no member of the body: an empty one would be kept as none all the same.
          body: given === '' ? {} : { reason: given },
        }),
      ),
    onSuccess: (answer) => {
      taken(answer)
      toast({ message: t('data.restrict.done', { household: name }) })
    },
  })
  const refused = useRefusedField(restrict.error)
  // The typed client lists no `422` for this operation, and the server answers one all the
  // same, for a reason that holds what it does not keep: read by hand.
  const invalid = fieldCodes(restrict.error).has('/reason')
  const close = () => {
    if (!restrict.isPending) onClose()
  }
  const action = t('data.restrict.action', { household: name })

  return (
    <Dialog
      open
      onClose={close}
      title={t('data.restrict.confirm.title', { household: name })}
      description={t('data.restrict.confirm.stops')}
      actions={
        <>
          <Button onClick={close}>{t('account.cancel')}</Button>
          <Button type="submit" form={form} variant="danger" loading={restrict.isPending}>
            {action}
          </Button>
        </>
      }
    >
      <form
        id={form}
        ref={refused}
        className={account.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          restrict.mutate(reason.trim(), {
            onSuccess: onDone,
            onError: (error) => {
              const ended = standing(error)
              if (ended !== undefined) onEnded(ended)
            },
          })
        }}
      >
        <p className={account.text}>{t('data.restrict.confirm.goes_on')}</p>
        <TextArea
          label={t('data.restrict.reason.label')}
          help={t('data.restrict.reason.help')}
          maxLength={longestReason}
          value={reason}
          error={invalid ? t('data.restrict.reason.invalid') : undefined}
          onChange={(event) => {
            setReason(event.currentTarget.value)
          }}
        />
        {restrict.isError && !invalid && standing(restrict.error) === undefined ? (
          // One of its own for each refusal, so that a second is said as the first was.
          <Banner key={restrict.submittedAt} tone="danger" announce>
            {say(restrict.error)}
          </Banner>
        ) : null}
      </form>
    </Dialog>
  )
}

export interface LiftProps {
  /** Pressed: what an earlier press on the screen came to is said no longer. */
  readonly onBegin: () => void
  /** Lifted: what the screen draws in this control's place is drawn next. */
  readonly onDone: () => void
  /** Refused for where its member now stands, in `text`. */
  readonly onEnded: (text: string) => void
}

/** The control that lifts a restriction, with what the household will be once it has. */
export function Lift({ onBegin, onDone, onEnded }: LiftProps) {
  const t = useTranslate()
  const format = useFormat()
  const api = useApi()
  const toast = useToast()
  const household = useHousehold()
  const zone = useTimeZone()
  const say = useProblemText(zone)
  const standing = useStandingRefusal()
  const taken = useTaken()
  const after = useId()
  const { id, name } = household
  const entitlement = household.entitlement

  const lift = useMutation({
    ...askedNow,
    mutationFn: async () =>
      unwrap(
        await api.DELETE('/households/{household_id}/restriction', {
          params: { path: { household_id: id } },
        }),
      ),
    onSuccess: (answer) => {
      taken(answer)
      // What it now is, as the server answered it, which is what was said before the press
      // unless the household changed meanwhile.
      toast({
        message:
          answer.can_write === false
            ? t('data.lift.done.read_only', { household: name })
            : answer.can_upload === false
              ? t('data.lift.done.grace', { household: name })
              : t('data.lift.done.writes', { household: name }),
      })
    },
  })

  // What lifting comes to, from what the household's own answer carries: under a lapse the
  // state says it; otherwise the day a trial runs to, or that uploads stay paused; and with
  // neither, that changes come back, and nothing of a payment, which this screen cannot read.
  const day = (at: string) => format.dayOf(at, zone, 'long')
  const lapsed = entitlement?.state === 'read_only' || entitlement?.state === 'canceled'
  const comes = (): string => {
    if (entitlement?.state === 'read_only') {
      return t('data.lift.after.read_only', { household: name })
    }
    if (entitlement?.state === 'canceled') return t('data.lift.after.canceled', { household: name })
    if (typeof entitlement?.trial_ends_at === 'string') {
      return t('data.lift.after.trial', { day: day(entitlement.trial_ends_at) })
    }
    if (typeof entitlement?.grace_ends_at === 'string') return t('data.lift.after.grace')
    return t('data.lift.after.writes')
  }
  // The day a lapse keeps the household's data until is not said where its own deletion is
  // scheduled: that day comes first.
  const deleting = (household.deletion_scheduled_at ?? null) !== null
  const until = lapsed && !deleting ? entitlement.data_retained_until : undefined

  return (
    <>
      {/* Said before the control is used, and tied to it. */}
      <div id={after} className={account.group}>
        <p className={account.text}>{comes()}</p>
        {typeof until === 'string' ? (
          <p className={account.text}>{t('data.lift.after.kept_until', { day: day(until) })}</p>
        ) : null}
      </div>
      <div className={account.actions}>
        <Button
          variant="primary"
          loading={lift.isPending}
          aria-describedby={after}
          onClick={() => {
            onBegin()
            lift.mutate(undefined, {
              onSuccess: onDone,
              onError: (error) => {
                const ended = standing(error)
                if (ended !== undefined) onEnded(ended)
              },
            })
          }}
        >
          {t('data.lift.action')}
        </Button>
      </div>
      {lift.isError && standing(lift.error) === undefined ? (
        <Banner key={lift.submittedAt} tone="danger" announce>
          {say(lift.error)}
        </Banner>
      ) : null}
    </>
  )
}
