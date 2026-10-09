// What a test of the data and privacy screens stands on: the household's fixture and its server
// (household/testing.tsx), with the three screens of this directory routed where the app routes
// them (`routed`), a household's inside the household its address names and the privacy centre
// in the account's landmark, and the export jobs a server answers them with. Imported by tests
// alone.
import type { Server } from '../account/testing.tsx'
import { paths } from '../app/paths.ts'
import { Profile } from '../household/settings/Profile.tsx'
import { Elsewhere, home, openOver, routed } from '../household/testing.tsx'
import { Data } from './Data.tsx'
import { Exports } from './Exports.tsx'
import type { ExportJob } from './exports.ts'
import { Privacy } from './Privacy.tsx'

/** An id of an export, by its last digit. */
export const exportId = (last: number) => `0190a000-0000-7000-8000-0000000000e${String(last)}`

/** An export of the household that waits to be made, asked for on the ninth of September. */
export function job(more: Partial<ExportJob> = {}): ExportJob {
  return {
    id: exportId(1),
    scope: 'household',
    household_id: home,
    status: 'queued',
    requested_at: '2026-09-09T17:02:00Z',
    ready_at: null,
    expires_at: null,
    download_url: null,
    size_bytes: null,
    contents: [],
    ...more,
  }
}

/** Where the object store answers an archive's link from: no origin of the app's. */
export const archive = 'https://files.household.example/exports/archive.zip?signature=1'

/** The same export once it is made: its size, what is in it, and a link good for minutes. */
export function ready(more: Partial<ExportJob> = {}): ExportJob {
  return job({
    status: 'ready',
    ready_at: '2026-09-09T17:20:00Z',
    expires_at: '2026-09-16T17:20:00Z',
    download_url: archive,
    size_bytes: 1_600_000_000,
    contents: ['garden.json', 'files/', 'calendar.ics', 'activity-log.csv', 'manifest.json'],
    ...more,
  })
}

const table = routed({
  household: [
    [paths.settings, Profile],
    [paths.settingsMembers, Elsewhere],
    [paths.settingsData, Data],
    [paths.settingsExports, Exports],
  ],
  account: [
    [paths.accountPrivacy, Privacy],
    [paths.account, Elsewhere],
    [paths.accountDelete, Elsewhere],
  ],
})

/** Opens `address` in a browser `server`'s member is signed in to. */
export function open<Known extends Server>(address: string, server: Known) {
  return openOver(table, address, server)
}
