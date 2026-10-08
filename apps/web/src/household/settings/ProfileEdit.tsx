// The two editors of the household's profile (C-49; PRD 17 §1): the panel that changes its name,
// timezone, language, units and first day of the week, and the panel that moves it to another
// country, which says what that changes before anything is changed (FR-HA1).
//
// Each is one `PATCH` of the household under the version this page read (`If-Match`), asked at
// once (D-170). The first sends what its member changed and nothing else, so that two owners who
// change different things both keep theirs: a field nobody touched reads as the household stands
// and is never sent back as it stood when the panel opened. A save that changes nothing asks
// nothing. Refused because somebody else changed the household meanwhile, a panel stays open on
// what was typed, and the next save is held against the household the refusal carried.
//
// The country's panel offers the profiles Household has, but for the one the household is in.
// The prototype's toast offers to undo the move: there is no operation to undo it with but the
// same change back, so none is offered. What money is counted in has no editor: the server
// refuses a change of it until its recomputation is built (FR-HA2, plan item 62).
import { entityTag, type components } from '@household/api'
import { isLocale, locales, matchLocale, type Locale } from '@household/i18n/lazy'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useRef, useState } from 'react'
import styles from '../../account/Settings.module.css'
import { useApi } from '../../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../../api/problem.ts'
import { useProblemText } from '../../api/problemText.ts'
import { askedNow } from '../../api/query.ts'
import { fieldCodes, useRefusedField } from '../../auth/fields.tsx'
import { useFormat, useTranslate } from '../../i18n/I18nProvider.tsx'
import { Banner } from '../../ui/Banner.tsx'
import { Button } from '../../ui/Button.tsx'
import { Sheet } from '../../ui/Dialog.tsx'
import { Select, TextField } from '../../ui/Field.tsx'
import { KeyValue } from '../../ui/KeyValue.tsx'
import { useToast } from '../../ui/Toast.tsx'
import { useLocalized, useReread, type Country } from '../data.ts'
import { useHousehold } from '../HouseholdContext.tsx'
import { householdKey, type Household } from '../households.ts'
import { useTimeZone } from '../timezone.ts'
import { dayName, ownName, useStandingRefusal, weekdays, type AskedProps } from './profile.ts'

type HouseholdUpdate = components['schemas']['HouseholdUpdate']
type UnitSystem = components['schemas']['UnitSystem']

const unitSystems: readonly UnitSystem[] = ['metric', 'imperial']

/** The household a `409 version_conflict` carries, where it is the one that was to be changed. */
function currentOf(error: unknown, id: string): Household | undefined {
  const problem = problemIn(error)
  if (problem?.code !== 'version_conflict') return undefined
  const current = problem.current
  if (typeof current !== 'object' || current === null || !('id' in current)) return undefined
  return current.id === id ? (current as Household) : undefined
}

/**
 * Changes the household under the version this page read, and keeps the answer as the household
 * every screen reads. Refused because somebody changed it meanwhile, it keeps the household the
 * refusal carries: what the page then shows, and what the next save is held against. Either
 * way what is filed under the household, and the list that names it, are read again.
 */
function useSaveHousehold() {
  const api = useApi()
  const queries = useQueryClient()
  const household = useHousehold()
  const reread = useReread(household.id)
  return useMutation({
    ...askedNow,
    mutationFn: async (change: HouseholdUpdate) =>
      unwrap(
        await api.PATCH('/households/{household_id}', {
          params: {
            path: { household_id: household.id },
            header: { 'If-Match': entityTag(household.version ?? 0) },
          },
          body: change,
        }),
      ),
    onSuccess: (saved) => {
      queries.setQueryData(householdKey(household.id), saved)
      void reread()
    },
    onError: (error) => {
      const current = currentOf(error, household.id)
      if (current === undefined) return
      queries.setQueryData(householdKey(household.id), current)
      void reread()
    },
  })
}

/**
 * What a save was refused with that is no field's, for the banner under its form: somebody else
 * changed the household, something was sent that the server would not take and `fields` does
 * not name, or the request failed. Nothing for a refusal that marked one of `fields`, which is
 * said beside it, or that is about where the member stands, which closes the panel.
 */
function useElse(): (error: unknown, fields: readonly string[]) => string | undefined {
  const t = useTranslate()
  const say = useProblemText(useTimeZone())
  const standing = useStandingRefusal()
  return (error, fields) => {
    if (standing(error) !== undefined) return undefined
    const problem = problemIn(error)
    if (problem?.code === 'version_conflict') return t('household.settings.refused.conflict')
    if (problem?.code === 'validation_failed') {
      return problem.errors.some(({ field }) => fields.includes(field))
        ? undefined
        : t('household.profile.refused')
    }
    return say(error)
  }
}

/** What its member changed in the panel, and nothing they left as it was. */
interface Edits {
  readonly name?: string
  readonly timezone?: string
  readonly locale?: Locale
  readonly units?: UnitSystem
  readonly firstDay?: number
}

/** The fields of the panel a `422` may name: each has its own sentence beside it. */
const edited = ['/name', '/timezone', '/locale'] as const

export function EditHousehold({ onClose, onEnded }: AskedProps) {
  const t = useTranslate()
  const format = useFormat()
  const toast = useToast()
  const household = useHousehold()
  const standing = useStandingRefusal()
  const other = useElse()
  const save = useSaveHousehold()
  const form = useId()
  const first = useRef<HTMLInputElement>(null)
  const [edits, setEdits] = useState<Edits>({})
  // Set, anew, each time a name of nothing is submitted: it is not sent.
  const [missing, setMissing] = useState<object>()
  const refused = useRefusedField(missing ?? save.error)

  // A field nobody touched reads as the household stands, now.
  const name = edits.name ?? household.name
  const zone = edits.timezone ?? household.timezone
  const language = edits.locale ?? matchLocale([household.locale])
  const units = edits.units ?? household.units
  const firstDay = edits.firstDay ?? household.first_day_of_week

  const zones = useMemo(() => {
    const known = Intl.supportedValuesOf('timeZone')
    // The household's own stays in the list though this browser does not name it.
    return known.includes(household.timezone) ? known : [household.timezone, ...known]
  }, [household.timezone])
  const languages = useMemo(
    () => locales.map((locale) => ({ value: locale, label: ownName(locale) })),
    [],
  )
  const days = useMemo(
    () => weekdays.map((day) => ({ value: String(day), label: dayName(format.locale, day) })),
    [format.locale],
  )

  const named = fieldCodes(save.error)
  const banner = save.isError ? other(save.error, edited) : undefined
  const close = () => {
    if (!save.isPending) onClose()
  }
  return (
    <Sheet
      open
      onClose={close}
      title={t('household.profile.edit.title')}
      initialFocus={first}
      actions={
        <>
          <Button onClick={close}>{t('account.cancel')}</Button>
          <Button type="submit" form={form} variant="primary" loading={save.isPending}>
            {t('household.profile.edit.save')}
          </Button>
        </>
      }
    >
      <form
        id={form}
        ref={refused}
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          const trimmed = name.trim()
          if (trimmed === '') {
            save.reset()
            setMissing({})
            return
          }
          setMissing(undefined)
          // What differs from the household as it stands, and nothing else.
          const change: HouseholdUpdate = {
            ...(trimmed === household.name ? {} : { name: trimmed }),
            ...(zone === household.timezone ? {} : { timezone: zone }),
            ...(language === matchLocale([household.locale]) ? {} : { locale: language }),
            ...(units === undefined || units === household.units ? {} : { units }),
            ...(firstDay === undefined || firstDay === household.first_day_of_week
              ? {}
              : { first_day_of_week: firstDay }),
          }
          if (Object.keys(change).length === 0) {
            onClose()
            return
          }
          save.mutate(change, {
            onSuccess: () => {
              // The panel closes onto the page, which shows what was saved where it is looked
              // for: that it was saved, and for whom, is said.
              toast({ message: t('household.profile.edit.saved') })
              onClose()
            },
            onError: (error) => {
              const ended = standing(error)
              if (ended !== undefined) onEnded(ended)
            },
          })
        }}
      >
        <TextField
          ref={first}
          label={t('household.profile.field.name')}
          required
          maxLength={80}
          value={name}
          error={
            missing !== undefined || named.has('/name')
              ? t('household.profile.edit.name.missing')
              : undefined
          }
          onChange={(event) => {
            setEdits({ ...edits, name: event.currentTarget.value })
          }}
        />
        <Select
          label={t('household.profile.field.timezone')}
          help={t('household.profile.edit.timezone.help')}
          value={zone}
          options={zones.map((each) => ({ value: each, label: each }))}
          error={named.has('/timezone') ? t('household.profile.edit.timezone.invalid') : undefined}
          onChange={(event) => {
            setEdits({ ...edits, timezone: event.currentTarget.value })
          }}
        />
        <Select
          label={t('household.profile.field.language')}
          help={t('household.profile.edit.language.help')}
          value={language}
          options={languages}
          error={named.has('/locale') ? t('household.profile.edit.language.invalid') : undefined}
          onChange={(event) => {
            const next = event.currentTarget.value
            if (isLocale(next)) setEdits({ ...edits, locale: next })
          }}
        />
        <Select
          label={t('household.profile.field.units')}
          value={units ?? ''}
          options={[
            { value: 'metric', label: t('household.profile.units.metric') },
            { value: 'imperial', label: t('household.profile.units.imperial') },
          ]}
          onChange={(event) => {
            const next = unitSystems.find((system) => system === event.currentTarget.value)
            if (next !== undefined) setEdits({ ...edits, units: next })
          }}
        />
        <Select
          label={t('household.profile.field.week')}
          help={t('household.profile.edit.week.help')}
          value={firstDay === undefined ? '' : String(firstDay)}
          options={days}
          onChange={(event) => {
            setEdits({ ...edits, firstDay: Number(event.currentTarget.value) })
          }}
        />
        {banner === undefined ? null : (
          // One of its own for each refusal, so that a second is said as the first was.
          <Banner key={save.submittedAt} tone="danger" announce>
            {banner}
          </Banner>
        )}
      </form>
    </Sheet>
  )
}

export interface MoveCountryProps extends AskedProps {
  /** The profiles the household could move to: every one but its own. */
  readonly others: readonly Country[]
  /** The country it is in now, by name, or by its code while the profiles are unread. */
  readonly now: string
}

export function MoveCountry({ others, now, onClose, onEnded }: MoveCountryProps) {
  const t = useTranslate()
  const format = useFormat()
  const toast = useToast()
  const localized = useLocalized()
  const standing = useStandingRefusal()
  const other = useElse()
  const save = useSaveHousehold()
  const form = useId()
  const changes = useId()
  const [to, setTo] = useState('')
  // Set, anew, each time the move is asked for with no country chosen: it is not sent.
  const [missing, setMissing] = useState<object>()
  const refused = useRefusedField(missing ?? save.error)

  const options = useMemo(
    () =>
      others
        .map((country) => ({ value: country.code, label: localized(country.name) }))
        .sort((one, two) => one.label.localeCompare(two.label, format.locale)),
    [others, localized, format.locale],
  )
  const chosen = options.find((option) => option.value === to)
  const invalid = fieldCodes(save.error).has('/country')
  const banner = save.isError ? other(save.error, ['/country']) : undefined
  const close = () => {
    if (!save.isPending) onClose()
  }
  const about = (module: 'vehicles' | 'documents' | 'calendar' | 'property' | 'utilities') => ({
    module: t(`module.${module}.name`),
  })
  return (
    <Sheet
      open
      onClose={close}
      title={t('household.profile.country.title')}
      actions={
        <>
          <Button onClick={close}>{t('account.cancel')}</Button>
          <Button type="submit" form={form} variant="primary" loading={save.isPending}>
            {/* Named for where it moves the household, once that is chosen. */}
            {chosen === undefined
              ? t('household.profile.country.title')
              : t('household.profile.country.save', { country: chosen.label })}
          </Button>
        </>
      }
    >
      <form
        id={form}
        ref={refused}
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (chosen === undefined) {
            save.reset()
            setMissing({})
            return
          }
          setMissing(undefined)
          save.mutate(
            { country: chosen.value },
            {
              onSuccess: () => {
                toast({
                  message: t('household.profile.country.saved', { country: chosen.label }),
                })
                onClose()
              },
              onError: (error) => {
                const ended = standing(error)
                if (ended !== undefined) onEnded(ended)
              },
            },
          )
        }}
      >
        <KeyValue pairs={[{ key: t('household.profile.country.now'), value: now }]} />
        <Select
          label={t('household.profile.country.to')}
          placeholder={t('household.profile.country.choose')}
          value={to}
          options={options}
          error={
            missing !== undefined
              ? t('household.profile.country.missing')
              : invalid
                ? t('household.profile.country.invalid')
                : undefined
          }
          onChange={(event) => {
            setTo(event.currentTarget.value)
          }}
        />
        {/* Said before anything is changed, whichever country is chosen: what follows the new
            country from now on, and that nothing already written does. */}
        <div className={styles.group}>
          <h3 id={changes} className={styles.strong}>
            {t('household.profile.country.changes.title')}
          </h3>
          <p className={styles.text}>{t('household.profile.country.changes.lead')}</p>
          <ul className={styles.group} role="list" aria-labelledby={changes}>
            <li className={styles.text}>
              {t('household.profile.country.changes.vehicles', about('vehicles'))}
            </li>
            <li className={styles.text}>
              {t('household.profile.country.changes.documents', about('documents'))}
            </li>
            <li className={styles.text}>
              {t('household.profile.country.changes.holidays', about('calendar'))}
            </li>
            <li className={styles.text}>
              {t('household.profile.country.changes.checklists', about('property'))}
            </li>
            <li className={styles.text}>
              {t('household.profile.country.changes.tariffs', about('utilities'))}
            </li>
          </ul>
          <p className={styles.text}>{t('household.profile.country.kept')}</p>
        </div>
        {banner === undefined ? null : (
          <Banner key={save.submittedAt} tone="danger" announce>
            {banner}
          </Banner>
        )}
      </form>
    </Sheet>
  )
}
