// What stands above every screen of a household: the offline bar (A-37), and in its place, with
// the browser online, the sentence that the household's changes are not arriving (D-105). With
// the sync service down and the API up everything else works: what the member reads is as they
// last had it, what they change is kept and sent, and other members' changes arrive when the
// service is back. In sync and online, nothing is drawn: the absence of an indicator is the
// indicator (06-clients §5).
//
// The offline bar says what becomes of a change made meanwhile, and that is not one thing for
// every screen. A module's change is saved and sent when the connection returns. The household's
// settings and leaving it are changed on the server or not at all (D-170; PRD 17, Sync): nothing
// pressed there waits on the device, so on those screens the bar says that a change needs a
// connection, and not that it is saved.
//
// A household's entitlement banner is drawn here too, by item 27. The one thing this item does
// with the household's state is tell the replica when the household writes again, so that what
// it held for a household that did not is sent (ADR 0019).
import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { inHousehold } from '../app/paths.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useReplica, useSync } from '../sync/ReplicaProvider.tsx'
import { OfflineBar } from '../ui/Banner.tsx'

/**
 * Whether `pathname` is `address` or an address under it: by whole segments, so that an address
 * which only begins with the same letters is no part of it.
 */
function isUnder(pathname: string, address: string): boolean {
  const path = pathname.toLowerCase()
  const base = address.toLowerCase()
  return path === base || path.startsWith(`${base}/`)
}

/**
 * Whether the screen at `pathname` is one whose changes are made on the server or not at all:
 * the household's settings, every screen of them, and leaving it (D-170).
 */
export function changesAtOnce(pathname: string, household: string): boolean {
  return (
    isUnder(pathname, inHousehold.settings(household)) ||
    isUnder(pathname, inHousehold.leave(household))
  )
}

export function HouseholdBars() {
  const t = useTranslate()
  const { online, receiving } = useSync()
  const replica = useReplica()
  const household = useHousehold()
  const { pathname } = useLocation()
  const writes = household.entitlement?.can_write !== false
  useEffect(() => {
    if (writes) replica?.resume()
  }, [replica, writes])
  if (!online) {
    return changesAtOnce(pathname, household.id) ? (
      <OfflineBar sentence={t('shell.offline.settings')} />
    ) : (
      <OfflineBar />
    )
  }
  if (receiving === false) return <OfflineBar sentence={t('sync.not_receiving')} />
  return null
}
