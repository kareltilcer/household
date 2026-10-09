// What the two screens that list exports share that draws nothing (PRD 05 §3, FR-PR2, D-139): a
// household's, which its owners ask for from its settings (A-35), and a member's own, which is
// asked for and listed in the privacy centre (A-34). They are one list behind two addresses of
// the API, and the server never mixes them: each is read, asked for and read again through a
// source that names its address.
//
// An export is its requester's (D-139), so a list holds its reader's own and nobody else's. Its
// link is good for minutes and each read of the job renews it, so no list keeps one: what is
// filed under the household's key, or the account's, and kept in this browser for a day, is the
// job without its link and with whether one was given, and the link is read at the press that
// downloads (ExportList.tsx).
import type { components } from '@household/api'
import { pseudoLocale, pseudolocalize } from '@household/i18n/lazy'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useApi } from '../api/ApiProvider.tsx'
import { unwrap } from '../api/problem.ts'
import { useReread } from '../household/data.ts'
import { householdKey, moduleKeys, type ModuleKey } from '../household/households.ts'
import { useFormat, useI18n } from '../i18n/I18nProvider.tsx'

export type ExportJob = components['schemas']['ExportJob']
export type ExportStatus = NonNullable<ExportJob['status']>

/** A job as a list keeps it: all of it but its link, and whether it was given one. */
export interface Listed extends Omit<ExportJob, 'download_url'> {
  /**
   * Whether the server handed its reader a link: only for one that is ready, and for a
   * household's only while its requester is still an owner there.
   */
  readonly linked: boolean
}

/** `job` as a list keeps it. */
export function listed({ download_url: link, ...job }: ExportJob): Listed {
  return { ...job, linked: typeof link === 'string' && link !== '' }
}

/** How a job stands. One that names no status has only been asked for. */
export function statusOf(job: Pick<ExportJob, 'status'>): ExportStatus {
  return job.status ?? 'queued'
}

/** Whether a job is still on its way: waiting to be made, or being made. */
export function underWay(job: Pick<ExportJob, 'status'>): boolean {
  const status = statusOf(job)
  return status === 'queued' || status === 'running'
}

/** Where a list of exports is read, asked for and read again. */
export interface ExportSource {
  /** What its list is filed under: the household's own key, or the account's. */
  readonly key: QueryKey
  /** Its reader's own exports, newest first, fifty at most. */
  readonly list: (signal: AbortSignal) => Promise<ExportJob[]>
  /** Asks for one. While one waits or is being made, the server answers that one. */
  readonly ask: () => Promise<ExportJob>
  /** One job, read again: its link is renewed by each read. */
  readonly read: (id: string) => Promise<ExportJob>
  /**
   * What an answered request leaves to be read again: the list, and with a household's the
   * household and everything filed under it, as after any write to one (household/data.ts).
   */
  readonly reread: () => Promise<void>
}

/** A household's exports that its reader asked for, under the household's own key. */
export function householdExportsKey(household: string) {
  return [...householdKey(household), 'exports'] as const
}

/** A member's own exports, under the account's key: gone with their session. */
export const ownExportsKey = ['me', 'exports'] as const

export function useHouseholdExports(household: string): ExportSource {
  const api = useApi()
  const reread = useReread(household)
  return useMemo(() => {
    const path = { household_id: household }
    return {
      key: householdExportsKey(household),
      reread,
      list: async (signal) =>
        unwrap(await api.GET('/households/{household_id}/exports', { params: { path }, signal }))
          .items ?? [],
      ask: async () =>
        unwrap(await api.POST('/households/{household_id}/exports', { params: { path } })),
      read: async (id) =>
        unwrap(
          await api.GET('/households/{household_id}/exports/{export_id}', {
            params: { path: { ...path, export_id: id } },
          }),
        ),
    }
  }, [api, household, reread])
}

export function useOwnExports(): ExportSource {
  const api = useApi()
  const queries = useQueryClient()
  return useMemo(
    () => ({
      key: ownExportsKey,
      reread: () => queries.invalidateQueries({ queryKey: ownExportsKey, exact: true }),
      list: async (signal) => unwrap(await api.GET('/me/exports', { signal })).items ?? [],
      ask: async () => unwrap(await api.POST('/me/exports')),
      read: async (id) =>
        unwrap(await api.GET('/me/exports/{export_id}', { params: { path: { export_id: id } } })),
    }),
    [api, queries],
  )
}

/**
 * What an entry of an archive is, where its name says: the platform's own entries, a module's
 * structured data, and the readable versions FR-PR2 names. Undefined for a name this build has
 * no line for: the name is shown all the same, being the archive's own.
 */
export type Entry =
  | {
      readonly kind:
        | 'manifest'
        | 'account'
        | 'households'
        | 'files'
        | 'calendar'
        | 'spreadsheet'
        | 'notes'
        | 'chat'
        | 'activity'
    }
  | { readonly kind: 'module'; readonly module: ModuleKey }

const named: Readonly<Record<string, Entry>> = {
  'manifest.json': { kind: 'manifest' },
  'account.json': { kind: 'account' },
  'households/': { kind: 'households' },
  'files/': { kind: 'files' },
  'calendar.ics': { kind: 'calendar' },
  'finance-transactions.csv': { kind: 'spreadsheet' },
  'finance-accounts.csv': { kind: 'spreadsheet' },
  'utilities-readings.csv': { kind: 'spreadsheet' },
  'notes/': { kind: 'notes' },
  'chat.html': { kind: 'chat' },
  'activity-log.csv': { kind: 'activity' },
}

export function entryOf(name: string): Entry | undefined {
  const known = named[name]
  if (known !== undefined) return known
  const module = moduleKeys.find((key) => name === `${key}.json`)
  return module === undefined ? undefined : { kind: 'module', module }
}

/** The units a size is said in, the largest first, each with the bytes it holds (a GB is 10⁹). */
const units = [
  ['gigabyte', 1_000_000_000],
  ['megabyte', 1_000_000],
  ['kilobyte', 1_000],
] as const

/** A count of bytes as a size, in the largest unit it fills: `Intl`'s words, never this file's. */
export function useSize(): (bytes: number) => string {
  const format = useFormat()
  return useCallback(
    (bytes) => {
      const [unit, per] = units.find(([, each]) => bytes >= each) ?? (['byte', 1] as const)
      return format.number(bytes / per, { style: 'unit', unit, maximumFractionDigits: 1 })
    },
    [format],
  )
}

/**
 * A name that is no catalog's, as the page draws it: an archive's own entry. In a language of
 * the app's it is drawn as it is written. The pseudo-locale accents it as it accents every word
 * of the catalogs, so that its pass tells what the server gave from a word nobody translated
 * (as `useGiven` does for the household's profile, household/settings/profile.ts).
 */
export function useAsWritten(): (text: string) => string {
  const { locale } = useI18n()
  return useCallback((text) => (locale === pseudoLocale ? pseudolocalize(text) : text), [locale])
}
