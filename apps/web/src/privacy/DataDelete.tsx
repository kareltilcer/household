// Deleting a household (C-56; PRD 05 §5 FR-PR6, PRD 17 §7 FR-HA16, D-138, D-140; 03-patterns
// §5): the panel that says what it does before it asks for the household's name.
//
// It says what is so, and each of these is: every member is told at once; the household works
// as before for thirty days, in which any owner cancels; then everything in it is gone and
// cannot be brought back; and a subscription keeps running and is charged until then, with
// nothing refunded (D-140), which the prototype left unsaid. It names the household and counts
// nothing in it: the prototype's "38 documents, three seasons of garden history" has no
// operation behind it, and no number is shown that nothing gave.
//
// The name is typed to confirm. The server compares it whatever its case and the space around
// it, and its word on it is the one that holds: a name of nothing is not sent, and any other is,
// to be said beside the field where the server refuses it. Scheduling is any owner's, in every
// state the household can be opened in (FR-BI1), five times a day and no more, since each one
// writes to every member.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
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
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Sheet } from '../ui/Dialog.tsx'
import { TextField } from '../ui/Field.tsx'
import { useToast } from '../ui/Toast.tsx'

export interface DeleteHouseholdProps extends AskedProps {
  /** Scheduled: what the screen draws in the place of the control that asked is drawn next. */
  readonly onDone: () => void
}

export function DeleteHousehold({ onClose, onDone, onEnded }: DeleteHouseholdProps) {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const toast = useToast()
  const household = useHousehold()
  const reread = useReread(household.id)
  const say = useProblemText(useTimeZone())
  const standing = useStandingRefusal()
  const form = useId()
  const field = useRef<HTMLInputElement>(null)
  const [typed, setTyped] = useState('')
  // Set, anew, each time a name of nothing is submitted: it is not sent.
  const [missing, setMissing] = useState<object>()
  const { id, name } = household

  const schedule = useMutation({
    ...askedNow,
    mutationFn: async (confirmed: string) =>
      unwrap(
        await api.POST('/households/{household_id}/deletion', {
          params: { path: { household_id: id } },
          body: { confirm_name: confirmed },
        }),
      ),
    onSuccess: (request) => {
      // The day it goes is the household's to say from now on: kept at once where the answer
      // carries it, and read again either way.
      const at = request.executes_at
      if (at !== undefined) {
        queries.setQueryData<Household>(householdKey(id), (was) =>
          was === undefined ? was : { ...was, deletion_scheduled_at: at },
        )
      }
      toast({ message: t('data.delete.done', { household: name }) })
      void reread()
    },
  })
  const refused = useRefusedField(missing ?? schedule.error)
  const wrong = fieldCodes(schedule.error).has('/confirm_name')
  const close = () => {
    if (!schedule.isPending) onClose()
  }

  return (
    <Sheet
      open
      onClose={close}
      title={t('data.delete.confirm.title', { household: name })}
      initialFocus={field}
      actions={
        <>
          <Button onClick={close}>{t('account.cancel')}</Button>
          <Button type="submit" form={form} variant="danger" loading={schedule.isPending}>
            {t('data.delete.confirm.action', { household: name })}
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
          if (typed.trim() === '') {
            schedule.reset()
            setMissing({})
            return
          }
          setMissing(undefined)
          schedule.mutate(typed, {
            onSuccess: onDone,
            onError: (error) => {
              const ended = standing(error)
              if (ended !== undefined) onEnded(ended)
            },
          })
        }}
      >
        <p className={account.text}>{t('data.delete.confirm.told')}</p>
        <p className={account.text}>{t('data.delete.confirm.window', { household: name })}</p>
        <p className={account.text}>{t('data.delete.confirm.gone')}</p>
        <p className={account.text}>{t('data.delete.confirm.subscription')}</p>
        <TextField
          ref={field}
          label={t('data.delete.confirm.name.label')}
          help={t('data.delete.confirm.name.help', { household: name })}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={typed}
          error={
            missing !== undefined
              ? t('data.delete.confirm.name.missing')
              : wrong
                ? t('data.delete.confirm.name.wrong', { household: name })
                : undefined
          }
          onChange={(event) => {
            setTyped(event.currentTarget.value)
          }}
        />
        {schedule.isError && !wrong && standing(schedule.error) === undefined ? (
          // One of its own for each refusal, so that a second is said as the first was.
          <Banner key={schedule.submittedAt} tone="danger" announce>
            {say(schedule.error)}
          </Banner>
        ) : null}
      </form>
    </Sheet>
  )
}
