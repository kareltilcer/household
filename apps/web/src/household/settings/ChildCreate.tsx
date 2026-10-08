// Making a child profile (PRD 02 §6, FR-CH1 to FR-CH3 and FR-AC4; PRD 17 §2, FR-HA7): the sheet
// an owner opens from the list of members. A child is a managed profile and never an invitation
// (D-17, D-103): an owner gives it a name and a PIN, and it has no email address, which is
// neither asked for nor collected.
//
// What it leaves out, and why. No matrix: the profile starts with a child's defaults (FR-AC4),
// which the sheet shows and the request sends by naming no `grants`, and every level is changed
// on the profile's own page once it exists. No picture: the contract refuses one here, and it is
// uploaded once the profile exists. No judgement of a PIN: the prototype refuses 1234 and the
// server does not, and a rule only the client applies is not built. And no second chance at
// whether Home is locked: no operation changes it afterwards (plan item 36), which the sheet
// says where it is chosen.
//
// The one asymmetry is stated to the owner as a fact, where they make the profile (FR-CH3,
// 03-patterns §9): what a child keeps in their private space an owner can read, as nobody can an
// adult's. The child is told it themself when they first sign in.
//
// The request is asked at once and is never held for a connection (PRD 17, Sync; D-80). The
// server keeps no Idempotency-Key for it, a PIN never being stored under one, so the profile's id
// is made once for each opening of the sheet: asked again it is the same profile that is asked
// for, and a `422` that names `/id` and nothing else is the answer to one that was made already,
// its first answer lost. So is a household found full, which may be full of this very profile:
// the server counts its members before it looks at the id. The profile is read by its id, and
// is made where it is there, holding what was sent first, its name as the toast then says it.
// The PIN is shown to nobody afterwards: not in the toast, and not on the page.
import { newId, type components } from '@household/api'
import { useMutation } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import settings from '../../account/Settings.module.css'
import { useApi } from '../../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../../api/problem.ts'
import { useProblemText } from '../../api/problemText.ts'
import { askedNow } from '../../api/query.ts'
import { fieldCodes, isMadeAlready, useRefusedField } from '../../auth/fields.tsx'
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import { Banner } from '../../ui/Banner.tsx'
import { Button } from '../../ui/Button.tsx'
import { Checkbox } from '../../ui/Choice.tsx'
import { Sheet } from '../../ui/Dialog.tsx'
import { PasswordField, TextField } from '../../ui/Field.tsx'
import { useToast } from '../../ui/Toast.tsx'
import { useReread } from '../data.ts'
import { GrantSummary } from '../GrantMatrix.tsx'
import { defaultsFor } from '../grants.ts'
import { useHousehold } from '../HouseholdContext.tsx'
import { useTimeZone } from '../timezone.ts'
import { pinShape } from './member.ts'
import styles from './Members.module.css'
import { isStandingRefusal, useStandingRefusal } from './profile.ts'

type ChildProfileCreate = components['schemas']['ChildProfileCreate']

/** The earliest year of birth the contract takes. */
const earliestYear = 1900

/**
 * The year it is in `timeZone`: a year of birth after this one in the household's zone is
 * refused (`postChildren`), and a timezone is never assumed.
 */
function yearIn(timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en', { timeZone, year: 'numeric' }).format(new Date()))
}

/** Whether `typed` is a year a child may have been born in: four digits, from 1900 to `latest`. */
function isYear(typed: string, latest: number): boolean {
  if (!/^[0-9]{4}$/.test(typed)) return false
  const year = Number(typed)
  return year >= earliestYear && year <= latest
}

/** Whether `error` says the household has as many members as it may have. */
function isFull(error: unknown): boolean {
  return problemIn(error)?.code === 'fair_use_ceiling'
}

/**
 * Whether `error` says the household is not as this page read it: its owner one no longer, its
 * writes stopped or the household itself gone from them, as on every screen of the settings
 * (profile.ts), or its members as many as it may have.
 */
function isOutOfDate(error: unknown): boolean {
  return isStandingRefusal(error) || isFull(error)
}

/** What a submission was not sent for: what the server would certainly refuse, found here. */
interface Faults {
  readonly name: boolean
  readonly year: boolean
  readonly pin: boolean
  readonly again: boolean
}

export interface ChildCreateProps {
  /** Asked to close: put away by its owner, or closed once the profile is made. */
  readonly onClose: () => void
}

export function ChildCreate({ onClose }: ChildCreateProps) {
  const t = useTranslate()
  const api = useApi()
  const toast = useToast()
  const household = useHousehold()
  const reread = useReread(household.id)
  const say = useProblemText(useTimeZone())
  const standing = useStandingRefusal()
  const form = useId()
  const lockHelp = useId()
  const startsWith = useId()
  const privateSpace = useId()
  const first = useRef<HTMLInputElement>(null)
  // The profile's id, made once for each opening of the sheet: sent again, it is the same
  // profile that is asked for.
  const [id] = useState(newId)
  const [name, setName] = useState('')
  const [year, setYear] = useState('')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [locked, setLocked] = useState(true)
  // Set, anew, each time a submission is held back: it is not sent.
  const [faults, setFaults] = useState<Faults>()

  const made = (called: string) => {
    // What happens next is said with it, and no second sheet is opened to say it. The PIN is
    // not: it is shown to nobody again.
    toast({ message: t('household.child.create.made', { name: called }) })
    void reread()
    onClose()
  }
  const create = useMutation({
    ...askedNow,
    mutationFn: async (profile: ChildProfileCreate) => {
      try {
        return unwrap(
          await api.POST('/households/{household_id}/children', {
            params: { path: { household_id: household.id } },
            body: profile,
          }),
        )
      } catch (error) {
        // The id is this sheet's own. One the server has already is the profile an earlier
        // request made, whose answer never came; and a household found full may be full of that
        // very profile. It is read by its id, and where it is there it is the answer.
        if (!isMadeAlready(error) && !isFull(error)) throw error
        const read = await api
          .GET('/households/{household_id}/members/{user_id}', {
            params: { path: { household_id: household.id, user_id: profile.id } },
          })
          .catch(() => undefined)
        if (read?.data !== undefined) return read.data
        // Full of others, and nothing was made. The server's word that it has the id stands
        // though the profile could not be read: it was made.
        if (isFull(error)) throw error
        return undefined
      }
    },
    onSuccess: (membership, profile) => {
      // By the name the profile holds, which is the one that was sent first.
      made(membership?.display_name ?? profile.display_name)
    },
    onError: (error) => {
      // The page behind the sheet is read again, and says how the household stands itself.
      if (isOutOfDate(error)) void reread()
    },
  })

  const named = fieldCodes(create.error)
  const errors = {
    name:
      faults?.name === true || named.has('/display_name')
        ? t('household.child.create.name.missing')
        : undefined,
    year:
      faults?.year === true || named.has('/year_of_birth')
        ? t('household.child.create.year.invalid')
        : undefined,
    pin:
      faults?.pin === true || named.has('/pin')
        ? t('household.child.create.pin.invalid')
        : undefined,
    again: faults?.again === true ? t('household.child.create.again.differs') : undefined,
  }
  const marked = Object.values(errors).some((error) => error !== undefined)
  const refused = useRefusedField(faults ?? create.error)

  /** What a refusal that is no field's says, in the sheet's own words where it has them. */
  const refusal = (): string | undefined => {
    if (!create.isError || marked) return undefined
    const problem = problemIn(create.error)
    if (problem?.code === 'fair_use_ceiling') {
      return t('household.child.create.refused.full', { count: problem.ceiling })
    }
    return standing(create.error) ?? say(create.error)
  }
  const why = refusal()

  const close = () => {
    if (!create.isPending) onClose()
  }
  return (
    <Sheet
      open
      onClose={close}
      title={t('household.child.create.title')}
      initialFocus={first}
      actions={
        <>
          <Button onClick={close}>{t('account.cancel')}</Button>
          <Button type="submit" form={form} variant="primary" loading={create.isPending}>
            {t('household.child.create.submit')}
          </Button>
        </>
      }
    >
      <form
        id={form}
        ref={refused}
        className={settings.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          const called = name.trim()
          const born = year.trim()
          const found: Faults = {
            name: called === '',
            year: born !== '' && !isYear(born, yearIn(household.timezone)),
            pin: !pinShape.test(pin),
            // Said once the PIN itself is one: two that differ are no news beside one that is none.
            again: pinShape.test(pin) && again !== pin,
          }
          if (found.name || found.year || found.pin || found.again) {
            create.reset()
            setFaults(found)
            return
          }
          setFaults(undefined)
          create.mutate({
            id,
            display_name: called,
            ...(born === '' ? {} : { year_of_birth: Number(born) }),
            pin,
            lock_dashboard: locked,
          })
        }}
      >
        <TextField
          ref={first}
          label={t('household.child.create.name.label')}
          help={t('household.child.create.name.help')}
          maxLength={80}
          autoComplete="off"
          value={name}
          error={errors.name}
          onChange={(event) => {
            setName(event.currentTarget.value)
          }}
        />
        <TextField
          label={t('household.child.create.year.label')}
          help={t('household.child.create.year.help')}
          inputMode="numeric"
          maxLength={4}
          autoComplete="off"
          value={year}
          error={errors.year}
          onChange={(event) => {
            setYear(event.currentTarget.value)
          }}
        />
        <PasswordField
          label={t('household.child.create.pin.label')}
          help={t('household.child.create.pin.help')}
          inputMode="numeric"
          maxLength={6}
          autoComplete="new-password"
          value={pin}
          error={errors.pin}
          onChange={(event) => {
            setPin(event.currentTarget.value)
          }}
        />
        <PasswordField
          label={t('household.child.create.again.label')}
          inputMode="numeric"
          maxLength={6}
          autoComplete="new-password"
          value={again}
          error={errors.again}
          onChange={(event) => {
            setAgain(event.currentTarget.value)
          }}
        />
        <div className={settings.group}>
          <Checkbox
            label={t('household.child.create.lock.label')}
            aria-describedby={lockHelp}
            checked={locked}
            onChange={(event) => {
              setLocked(event.currentTarget.checked)
            }}
          />
          <p id={lockHelp} className={settings.note}>
            {t('household.child.create.lock.help')}
          </p>
        </div>
        <section className={settings.group} aria-labelledby={startsWith}>
          <h3 id={startsWith} className={styles.subheading}>
            {t('household.child.create.starts.title')}
          </h3>
          <GrantSummary grants={defaultsFor('child')} whose="theirs" role="child" />
          <p className={settings.note}>{t('household.grant.child_note')}</p>
          <p className={settings.note}>{t('household.child.create.starts.note')}</p>
        </section>
        <section className={settings.group} aria-labelledby={privateSpace}>
          <h3 id={privateSpace} className={styles.subheading}>
            {t('household.child.create.private.title')}
          </h3>
          <p className={settings.text}>{t('household.child.create.private.body')}</p>
        </section>
        {/* A new one for each submission refused, so that the second is said as the first was. */}
        {why === undefined ? null : (
          <Banner key={create.submittedAt} tone="danger" announce>
            {why}
          </Banner>
        )}
      </form>
    </Sheet>
  )
}
