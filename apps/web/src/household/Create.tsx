// Creating a household (A-22, `/account/households/new`; PRD 02 FR-HH1, 03-patterns §6, DD-6):
// the first thing a new account does, which a member in no household is opened at (app/Home.tsx),
// and how a member of some makes another. It is the account's screen, there being no household
// around it yet.
//
// One thing is asked, the name. The country, the timezone and the language are read from this
// device and the currency from the country, each shown with where it came from and each to be
// changed: confirmed, not asked. The currency follows the country as the country is changed,
// until its member chooses one themselves. Units and the first day of the week are not on the
// form: the server takes the country's own, and the household's settings change them.
//
// A device whose languages name no country Household has a profile of, a browser in English
// anywhere but Britain, says nothing to confirm. The country is then asked too, and none stands
// in for it: the first of the list would be chosen by nobody, and with it the currency, which
// no screen changes afterwards. The currency is drawn once there is a country for it to follow.
//
// What the prototype drew and this does not: the three steps after this one (modules, people,
// *ready*), which DD-6 put *what brought you here?* in the place of (Start.tsx); the day the
// trial ends, which nothing knows before the household exists; and *I was invited to one
// instead*, in whose place the invitations that wait for this member are listed above the form,
// each leading to its own screen. An unverified account makes a household like any other
// (FR-HH1): what waits for a proven address is what leaves a household, and is said where it is
// refused. A child profile makes none (D-104), and is told so in the form's place.
//
// The household's id is the client's, made once for the visit: pressed again after an answer
// that never arrived, the same household is asked for and not a second one, and where the
// server says it has that id already, or that the account owns as many as it may, the earlier
// press made it where it can be read.
//
// A-22's states (ledger preset F) are *loading*, the countries being read; *populated*, the form;
// and *error*, the countries unread with nothing kept, and a create that failed, said in the form
// with what was typed kept. The rest have nothing to be on a form that makes something new.
// Nothing is listed to be *empty*. *Offline* is the form as this browser kept its countries, and
// a create that says it could not reach the server. Nothing waits *pending* or *syncing*: a
// household is made on the server or not at all (D-80), its control busy meanwhile. Nothing is
// *conflicted* or *rejected*: nobody else holds a version of what does not exist yet, and a
// refusal stands beside the field it is of. Nothing is *absent*, *withdrawn* or *read-only*: no
// grant stands over making a household, and no household is there yet to have lapsed.
import { newId, type components } from '@household/api'
import { currencyCodes } from '@household/domain'
import { catalogLocale, isLocale, locales, type Locale } from '@household/i18n/lazy'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { readState, useNoWithdrawal, useOwnZone } from '../account/common.ts'
import { Section, SettingsPage } from '../account/Page.tsx'
import styles from '../account/Settings.module.css'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { deviceTimeZone, useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { inHousehold } from '../app/paths.ts'
import { fieldCodes, isMadeAlready, useRefusedField } from '../auth/fields.tsx'
import { useFormat, useI18n, useTranslate } from '../i18n/I18nProvider.tsx'
import { currencyName, ownName, timeZones } from '../i18n/names.ts'
import { useMe } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Select, TextField } from '../ui/Field.tsx'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import { useCountries, useCountryChoices, type Country } from './data.ts'
import { deviceCountry } from './device.ts'
import { householdKey, householdsKey } from './households.ts'
import { useWaiting, WaitingList, type Waiting } from './Waiting.tsx'

type HouseholdCreate = components['schemas']['HouseholdCreate']

/** The fields of the form, as a `422` names them. */
const fields = ['/name', '/country', '/timezone', '/locale', '/base_currency'] as const

function Form({
  countries,
  fromDevice,
}: {
  readonly countries: readonly Country[]
  /** The country the device named as the form opened, by its code: undefined where it named none. */
  readonly fromDevice: string | undefined
}) {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const format = useFormat()
  const { locale: shown } = useI18n()
  const say = useProblemText(useOwnZone())

  // Made once for the visit: a press after an answer that was lost asks for the same household.
  const [id] = useState(newId)
  const [name, setName] = useState('')
  // Set, anew, each time it is submitted with no name or no country: it is not sent.
  const [missing, setMissing] = useState<{ readonly name: boolean; readonly country: boolean }>()

  const listed = useCountryChoices(countries)
  const [ownZone] = useState(deviceTimeZone)
  const reading = catalogLocale(shown)

  // What the device named, or none until its member chooses one.
  const [country, setCountry] = useState(fromDevice ?? '')
  const [timezone, setTimezone] = useState(ownZone)
  const [language, setLanguage] = useState<Locale>(reading)
  // The currency the member chose themselves: until they have, it is the country's.
  const [chosen, setChosen] = useState<string>()
  const currency = chosen ?? countries.find((each) => each.code === country)?.currency ?? ''

  const zones = useMemo(
    () => timeZones(ownZone).map((zone) => ({ value: zone, label: zone })),
    [ownZone],
  )
  const languages = useMemo(
    () => locales.map((locale) => ({ value: locale, label: ownName(locale) })),
    [],
  )
  // Every currency the server takes, by its code: a household counts its money in whichever
  // its member says, and no screen changes it afterwards. The country's own stands chosen.
  const currencies = useMemo(
    () =>
      currencyCodes.map((code) => {
        const named = currencyName(format.locale, code)
        return {
          value: code,
          label:
            named === undefined
              ? code
              : t('household.create.currency.option', { code, name: named }),
        }
      }),
    [format.locale, t],
  )

  const create = useMutation({
    ...askedNow,
    mutationFn: async (body: HouseholdCreate) => {
      try {
        return unwrap(await api.POST('/households', { body }))
      } catch (error) {
        // The id is this visit's own. One the server has already is the household an earlier
        // press made, whose answer never arrived: it is read, and is the answer.
        const read = () =>
          api.GET('/households/{household_id}', { params: { path: { household_id: body.id } } })
        if (isMadeAlready(error)) return unwrap(await read())
        // As many as an account may own, and that press may have made the last of them: the
        // server counts them before it looks at the id. Where the household is there, it is
        // the answer; where it is not, the refusal stands.
        if (problemIn(error)?.code !== 'household_limit_reached') throw error
        const made = await read().catch(() => undefined)
        if (made?.data === undefined) throw error
        return made.data
      }
    },
    // What is so whether or not this screen is still drawn when the answer comes: the
    // household's shell reads it from here, and the member's list is read again, naming one more.
    onSuccess: (household) => {
      queries.setQueryData(householdKey(household.id), household)
      void queries.invalidateQueries({ queryKey: householdsKey, exact: true })
    },
  })

  const refused = fieldCodes(create.error)
  const form = useRefusedField(missing ?? create.error)
  const nameCode = refused.get('/name')
  const nameError =
    missing?.name === true || nameCode === 'required' || nameCode === 'min_length'
      ? t('household.create.name.missing')
      : nameCode === undefined
        ? undefined
        : t('household.create.name.refused')

  // A refusal that is no field's: said above the control, as it arrives.
  let failure: string | undefined
  if (create.isError && !fields.some((field) => refused.has(field))) {
    const problem = problemIn(create.error)
    if (problem?.code === 'household_limit_reached') {
      failure = t('household.create.limit', { ceiling: problem.ceiling })
    } else if (problem?.code === 'forbidden') {
      // A child profile, whatever this page had read of the account.
      failure = t('household.create.child')
    } else failure = say(create.error)
  }

  const source = t('household.create.from_device')
  const named = name.trim()
  return (
    <form
      ref={form}
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (named === '' || country === '') {
          create.reset()
          setMissing({ name: named === '', country: country === '' })
          return
        }
        setMissing(undefined)
        create.mutate(
          { id, name: named, country, timezone, base_currency: currency, locale: language },
          {
            // On to the first run's question, which passes on to Home while nothing takes a
            // first record, from this screen alone: a member who went on to another while the
            // answer was on its way stays there, and finds the household among theirs. The form
            // is no place to come back to: its household is made.
            onSuccess: (household) => {
              void navigate(inHousehold.start(household.id), { replace: true })
            },
          },
        )
      }}
    >
      <TextField
        label={t('household.create.name.label')}
        help={t('household.create.name.help')}
        required
        value={name}
        maxLength={80}
        autoComplete="off"
        error={nameError}
        onChange={(event) => {
          setName(event.currentTarget.value)
        }}
      />
      <Select
        label={t('household.create.country.label')}
        // Where it came from is said for as long as it is what the device said.
        help={
          country === fromDevice
            ? `${source} ${t('household.create.country.help')}`
            : t('household.create.country.help')
        }
        // Asked, where the device named none: nothing is chosen until its member chooses.
        {...(fromDevice === undefined
          ? { placeholder: t('household.profile.country.choose'), required: true }
          : {})}
        value={country}
        options={listed}
        error={
          missing?.country === true
            ? t('household.create.country.missing')
            : refused.has('/country')
              ? t('household.create.country.refused')
              : undefined
        }
        onChange={(event) => {
          setCountry(event.currentTarget.value)
        }}
      />
      <Select
        label={t('household.create.timezone.label')}
        help={
          timezone === ownZone
            ? `${source} ${t('household.create.timezone.help')}`
            : t('household.create.timezone.help')
        }
        value={timezone}
        options={zones}
        error={refused.has('/timezone') ? t('household.create.timezone.refused') : undefined}
        onChange={(event) => {
          setTimezone(event.currentTarget.value)
        }}
      />
      <Select
        label={t('household.create.language.label')}
        help={
          language === reading
            ? `${t('household.create.language.shown')} ${t('household.create.language.help')}`
            : t('household.create.language.help')
        }
        value={language}
        options={languages}
        error={refused.has('/locale') ? t('household.create.language.refused') : undefined}
        onChange={(event) => {
          const next = event.currentTarget.value
          if (isLocale(next)) setLanguage(next)
        }}
      />
      {country === '' ? null : (
        <Select
          label={t('household.create.currency.label')}
          help={t('household.create.currency.help')}
          value={currency}
          options={currencies}
          error={refused.has('/base_currency') ? t('household.create.currency.refused') : undefined}
          onChange={(event) => {
            setChosen(event.currentTarget.value)
          }}
        />
      )}
      <Banner tone="info" title={t('household.create.trial.title')}>
        {t('household.create.trial.body')}
      </Banner>
      {failure === undefined ? null : (
        // A banner of its own for each refusal, so that a second one is said again.
        <Banner key={create.submittedAt} tone="danger" announce>
          {failure}
        </Banner>
      )}
      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          // Busy until the household it made has opened.
          loading={create.isPending || create.isSuccess}
        >
          {named === ''
            ? t('household.create.submit')
            : t('household.create.submit_named', { name: named })}
        </Button>
      </div>
    </form>
  )
}

/** The invitations that wait for this member, above the form; nothing while they are unread. */
function Invited({ waiting }: { readonly waiting: readonly Waiting[] | undefined }) {
  const t = useTranslate()
  if (waiting === undefined) return null
  if (waiting.length === 0) {
    return <p className={styles.note}>{t('household.create.waiting.none')}</p>
  }
  return (
    <Section title={t('account.households.waiting.title')}>
      <WaitingList invitations={waiting} />
    </Section>
  )
}

function Creation() {
  const t = useTranslate()
  const countries = useCountries()
  const online = useOnline()
  const withdrawn = useNoWithdrawal()
  const waiting = useWaiting(true)
  // What the device named, of the countries as they were first read. Read once, for the form
  // and for the sentence over it alike: a list that is read again while the form stands changes
  // neither what the form opened with nor what is said of it.
  const [device, setDevice] = useState<{ readonly country: string | undefined }>()
  if (device === undefined && countries.data !== undefined) {
    setDevice({ country: deviceCountry(countries.data)?.code })
  }
  // Said where it is so: with no country read from the device, the name is not all that is asked.
  const confirmed = device?.country !== undefined
  return (
    <SettingsPage
      title={t('household.create.title')}
      lead={confirmed ? t('household.create.lead') : undefined}
    >
      <Invited waiting={waiting} />
      <Section title={t('household.create.new.title')}>
        <StateFrame
          state={readState(countries, online)}
          skeleton={
            <Skeleton
              bars={[
                [20, 1],
                [100, 2.75],
                [20, 1],
                [100, 2.75],
                [20, 1],
                [100, 2.75],
                [20, 1],
                [100, 2.75],
                [30, 1],
                [100, 2.75],
              ]}
            />
          }
          // A form lists nothing, and is never empty.
          empty={null}
          texts={{
            error: {
              title: t('household.create.unread.title'),
              text: t('household.create.unread.body'),
              actions: (
                <Button
                  onClick={() => {
                    void countries.refetch()
                  }}
                >
                  {t('ui.retry')}
                </Button>
              ),
            },
            withdrawn,
          }}
        >
          {() => <Form countries={countries.data ?? []} fromDevice={device?.country} />}
        </StateFrame>
      </Section>
    </SettingsPage>
  )
}

export function Create() {
  const t = useTranslate()
  const me = useMe()
  // A child profile is an owner's to manage, in the household it was made in (D-104): it is
  // told so, and offered no form the server would refuse.
  if (me.is_child === true) {
    return (
      <SettingsPage title={t('household.create.title')} lead={t('household.create.child')}>
        {null}
      </SettingsPage>
    )
  }
  return <Creation />
}
