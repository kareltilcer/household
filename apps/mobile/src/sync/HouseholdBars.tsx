// What stands above every screen of a household: the offline bar (A-37), and in its place, with
// the device online, the sentence that the household's changes are not arriving (D-105). With
// the sync service down and the API up everything else works: what the member reads is as they
// last had it, what they change is kept and sent, and other members' changes arrive when the
// service is back. In sync and online, nothing is drawn: the absence of an indicator is the
// indicator (06-clients §5). The web's is its twin (apps/web/src/shell/HouseholdBars.tsx).
//
// It is one bar, in one place, whose sentence changes where it stands. A module's change is
// saved and sent when the connection returns. The household's settings and leaving it are
// changed on the server or not at all (D-170): nothing pressed there waits on the device, so on
// those screens the bar says that a change needs a connection, and not that it is saved. And a
// household that takes no writes keeps no change of its member's to send, so over its modules
// the bar says what is read and promises nothing of a change, as does the sentence that changes
// are not arriving.
//
// The shell's frame draws it above the screens (shell/HouseholdFrame.tsx), and item 29's one
// entitlement banner under it. And the replica is told here when the household writes again,
// so that what it held for a household that did not is sent (ADR 0019).
import { usePathname } from 'expo-router'
import { useEffect, useState } from 'react'
import { inHousehold } from '../app/paths.ts'
import { writes, type Household } from '../household/data.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { OfflineBar } from '../ui/OfflineBar.tsx'
import { useReplica, useSync } from './ReplicaProvider.tsx'

export interface HouseholdBarsProps {
  /**
   * The household whose screens the bar stands above, as it was read: whoever draws the bar
   * hands it over, so a household that could not be read, and an address that opens none, have
   * no bar, and the bar asks the server nothing.
   */
  readonly household: Pick<Household, 'id' | 'entitlement'>
}

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
 * the household's settings, every screen of them, and leaving it (D-170). The addresses are the
 * web's own, as every address of the app's is; the screens at them are plan item 29's.
 */
export function changesAtOnce(pathname: string, household: string): boolean {
  const home = inHousehold.home(household)
  return isUnder(pathname, `${home}/settings`) || isUnder(pathname, `${home}/leave`)
}

/** What the bar says, or null where there is no bar. */
type Sentence = string | null

/** What stood above a household's screens when it was first drawn, and whether that has changed since. */
interface Stood {
  readonly household: string
  readonly sentence: Sentence
  readonly moved: boolean
}

export function HouseholdBars({ household }: HouseholdBarsProps) {
  const t = useTranslate()
  const { online, receiving } = useSync()
  const replica = useReplica()
  const pathname = usePathname()
  const { id } = household
  const takesWrites = writes(household)
  useEffect(() => {
    if (takesWrites) replica?.resume()
  }, [replica, takesWrites])

  const sentence: Sentence = !online
    ? changesAtOnce(pathname, id)
      ? t('device.sync.offline.settings')
      : takesWrites
        ? t('ui.offline.bar')
        : t('device.sync.offline.reading')
    : receiving === false
      ? takesWrites
        ? t('sync.not_receiving')
        : t('shell.not_receiving.reading')
      : null

  // A bar that stood here when the household was first drawn is read in its place. One that
  // arrives later, and a sentence that takes another's place, is said: nothing moved the focus
  // to it.
  const [stood, setStood] = useState<Stood>({ household: id, sentence, moved: false })
  let moved = false
  if (stood.household !== id) setStood({ household: id, sentence, moved: false })
  else if (!stood.moved && stood.sentence !== sentence) setStood({ ...stood, moved: true })
  else moved = stood.moved

  return sentence === null ? null : <OfflineBar sentence={sentence} announce={moved} />
}
