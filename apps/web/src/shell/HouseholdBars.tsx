// What stands above every screen of a household: the offline bar (A-37), and in its place, with
// the browser online, the sentence that the household's changes are not arriving (D-105). With
// the sync service down and the API up everything else works: what the member reads is as they
// last had it, what they change is kept and sent, and other members' changes arrive when the
// service is back. In sync and online, nothing is drawn: the absence of an indicator is the
// indicator (06-clients §5).
//
// A household's entitlement banner is drawn here too, by item 27. The one thing this item does
// with the household's state is tell the replica when the household writes again, so that what
// it held for a household that did not is sent (ADR 0019).
import { useEffect } from 'react'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useReplica, useSync } from '../sync/ReplicaProvider.tsx'
import { OfflineBar } from '../ui/Banner.tsx'

export function HouseholdBars() {
  const t = useTranslate()
  const { online, receiving } = useSync()
  const replica = useReplica()
  const writes = useHousehold().entitlement?.can_write !== false
  useEffect(() => {
    if (writes) replica?.resume()
  }, [replica, writes])
  if (!online) return <OfflineBar />
  if (receiving === false) return <OfflineBar sentence={t('sync.not_receiving')} />
  return null
}
