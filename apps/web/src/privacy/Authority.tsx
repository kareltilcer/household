// Whom a member complains to (PRD 05 §3 and §11): the data protection authority of their own
// country, which the privacy centre names and links to.
//
// An account has no country: a household has one. So the authorities shown are those of the
// countries of the households the member is in, each named with its country, which for most
// members is one. A suspended household answers nobody (D-115) and is passed over, never waited
// on, and so is one that could not be read where another could. A member in no household is
// shown the authority of the country their device's languages name, as a choice they can change
// among the countries Household has a profile of, and is asked for one where the device names
// none: no country is chosen for them (D-172).
//
// The authority is reference data, a country profile's (`Country.supervisory_authority`): its
// name in the language the app is shown in, and the address of its own page for a complaint.
// The link opens that page in a new tab and says that it leaves Household.
import { useQueries } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useNoWithdrawal } from '../account/common.ts'
import account from '../account/Settings.module.css'
import { useApi } from '../api/ApiProvider.tsx'
import { useCountries, useCountryChoices, useLocalized, type Country } from '../household/data.ts'
import { deviceCountry } from '../household/device.ts'
import { householdQuery, useHouseholds } from '../household/households.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { Select } from '../ui/Field.tsx'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import type { DataState } from '../ui/states.ts'
import styles from './Privacy.module.css'

/** What a read tells of itself that this screen asks. */
interface Asked {
  readonly data: unknown
  readonly isError: boolean
  readonly fetchStatus: string
}

/** Whether `read` could not be made and nothing is kept of it: it failed, or waits for a connection. */
function unread(read: Asked): boolean {
  return read.data === undefined && (read.isError || read.fetchStatus === 'paused')
}

/** A country's authority, by name, with the way to its own page. */
function Named({ country, leaves }: { readonly country: Country; readonly leaves: string }) {
  const localized = useLocalized()
  const authority = country.supervisory_authority
  return (
    <li className={styles.line}>
      <span className={account.strong}>{localized(country.name)}</span>
      <a
        className={account.link}
        href={authority.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-describedby={leaves}
      >
        {localized(authority.name)}
      </a>
    </li>
  )
}

/** For a member in no household: the country the device names, as a choice they can change. */
function Chosen({
  countries,
  leaves,
}: {
  readonly countries: readonly Country[]
  readonly leaves: string
}) {
  const t = useTranslate()
  const options = useCountryChoices(countries)
  // What the device says is confirmed, not asked: it is offered, and every other can be chosen.
  const [code, setCode] = useState(() => deviceCountry(countries)?.code ?? '')
  const country = countries.find((each) => each.code === code)
  return (
    <>
      <div className={account.form}>
        <Select
          label={t('privacy.complain.country.label')}
          help={t('privacy.complain.country.help')}
          placeholder={t('privacy.complain.country.choose')}
          value={code}
          options={options}
          onChange={(event) => {
            setCode(event.currentTarget.value)
          }}
        />
      </div>
      {country === undefined ? null : (
        <ul className={styles.lines} role="list">
          <Named country={country} leaves={leaves} />
        </ul>
      )}
    </>
  )
}

export function Authority() {
  const t = useTranslate()
  const api = useApi()
  const online = useOnline()
  const withdrawn = useNoWithdrawal()
  const leaves = useId()
  const households = useHouseholds()
  const profiles = useCountries()

  // A household says its country on its own representation, and a suspended one answers `404`
  // on every route (D-115): asked for, it would hold this section at a read that never comes.
  const open = (households.data ?? []).filter(
    (household) => household.entitlement?.state !== 'suspended',
  )
  const read = useQueries({
    // The household as every screen of it reads it, kept as that.
    queries: open.map((household) => householdQuery(api, household.id)),
  })

  const waited: readonly Asked[] = [households, profiles, ...read]
  // The countries of the households that were read, each once, in the households' order.
  const codes = [...new Set(read.flatMap((each) => (each.data ? [each.data.country] : [])))]
  const countries = profiles.data ?? []
  const named = codes.flatMap((code) => countries.filter((country) => country.code === code))
  // None of the member's households could be read: whose authority it is cannot be said.
  const none = open.length > 0 && named.length === 0
  const state: DataState = waited.some((each) => each.data === undefined && !unread(each))
    ? 'loading'
    : unread(households) || unread(profiles) || none
      ? 'error'
      : online
        ? 'populated'
        : 'offline'

  return (
    <StateFrame
      state={state}
      skeleton={
        <Skeleton
          bars={[
            [35, 1.25],
            [70, 1.25],
          ]}
        />
      }
      // An authority for every country Household has a profile of: nothing to teach.
      empty={null}
      texts={{
        error: {
          text: t('privacy.complain.error'),
          actions: (
            <Button
              onClick={() => {
                for (const each of [households, profiles, ...read]) {
                  if (each.data === undefined) void each.refetch()
                }
              }}
            >
              {t('ui.retry')}
            </Button>
          ),
        },
        withdrawn,
      }}
    >
      {() => (
        <>
          {open.length === 0 ? (
            <Chosen countries={countries} leaves={leaves} />
          ) : (
            <ul className={styles.lines} role="list">
              {named.map((country) => (
                <Named key={country.code} country={country} leaves={leaves} />
              ))}
            </ul>
          )}
          <p id={leaves} className={account.note}>
            {t('privacy.complain.leaves')}
          </p>
        </>
      )}
    </StateFrame>
  )
}
