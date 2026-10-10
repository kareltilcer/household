// The entitlement banner (A-30; PRD 04 §3 and §6, FR-BI2, FR-BI7; 03-patterns §3; DD-9, D-114):
// what the household's state means for whoever reads it, said above every screen of the
// household, under the offline bar (HouseholdBars.tsx). One banner at a time, the state's own as
// the server resolved it (entitlement.ts), and none for a household in good standing. It never
// stands in the way of a read and asks nothing: it says the state, what still works, what does
// not, and the way to the fix for its reader. The payer is led to where a subscription is made
// or paid for, another owner to where it is read, any owner to where a restriction is lifted
// and the household exported, and a member, who can do none of that, is told whose it is and,
// where the household's data has a last day, the way to their own.
//
// Which of billing's two screens a payer is led to is read off the household's own answer, the
// shell reading no billing: a household in its trial, or one whose subscription was cancelled,
// has none to manage and is led to subscribing; one whose payment failed is led to billing,
// which reads the subscription and says which of the two it needs. Who pays is the member's own
// row among the household's members, which every member may read; until it is read an owner is
// led to billing, which is right for either (`useReader`, household/data.ts).
//
// What the prototype drew and this does not, and why:
// - No price: the plans are an owner's to read, and billing's to show (FR-BI5).
// - No day of a next attempt on a failed payment, and no count of the days it is given: no
//   answer carries either (D-134). The past-due banner is the owners' alone (PRD 04 §6).
// - No *you cancelled on*: nothing a member reads says who cancelled, or when.
// - No one-press *resume*: a household that lapsed subscribes again, in the payment form.
// - A day of deletion on a lapse alone (`data_retained_until`, as given): on any other state it
//   would tell a household it is about to lose data that is in no danger. And none where the
//   household's own deletion is scheduled, which comes first: the day a lapse would keep its data
//   until is then a day it does not reach.
// - No *everybody can export*: the household's export is an owner's, and a member's is of
//   their own data.
//
// The first trial notice is put away once, in this browser (entitlement.ts); no other banner is.
// One that stood when the household was opened is read in its place, and one that arrives while
// its member is here, the household read again after a write or when the page is looked at
// again, is announced. It is no data body: of the twelve states it has none, only its seven
// drawings, and with the household unread there is no shell to draw it in.
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { refocus } from '../account/common.ts'
import { inHousehold, paths } from '../app/paths.ts'
import { useOwnerNames, useReader, type Reader } from '../household/data.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import type { Household } from '../household/households.ts'
import { useTimeZone } from '../household/timezone.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import { Banner, type BannerTone } from '../ui/Banner.tsx'
import styles from './Entitlement.module.css'
import { contentId } from './Frame.tsx'
import {
  bannerId,
  bannerOf,
  daysLeft,
  putAway,
  putAwayNow,
  type Restriction,
  type Shown,
} from './entitlement.ts'

const tones: Readonly<Record<Shown['kind'], BannerTone>> = {
  trial: 'warning',
  past_due: 'warning',
  grace: 'warning',
  read_only: 'danger',
  canceled: 'danger',
  restricted: 'warning',
}

export interface EntitlementBannerViewProps {
  readonly household: Pick<Household, 'id' | 'name'>
  /** What it is of (entitlement.ts). */
  readonly shown: Shown
  readonly reader: Reader
  /** The owners' names, for a member to know whom to ask: none while the members are unread. */
  readonly owners: readonly string[]
  /** The zone its days and times are said in. */
  readonly zone: string
  /** The moment it is drawn at, as `Date.now()` counts: what the trial's days are counted from. */
  readonly now: number
  /** Whether it is announced: it arrived while the member was here. */
  readonly announce?: boolean
  /** Puts the first trial notice away. No other banner is given one. */
  readonly onDismiss?: (() => void) | undefined
}

/** The banner of one state, to one reader: a household's own, or a dev page's fixture. */
export function EntitlementBannerView({
  household,
  shown,
  reader,
  owners,
  zone,
  now,
  announce = false,
  onDismiss,
}: EntitlementBannerViewProps) {
  const t = useTranslate()
  const format = useFormat()
  const { id } = household
  const owner = reader !== 'member'

  const subscribe = { to: inHousehold.subscribe(id), label: t('entitlement.to.subscribe') }
  const billing = { to: inHousehold.billing(id), label: t('entitlement.to.billing') }
  const exported = { to: inHousehold.exports(id), label: t('entitlement.to.export') }
  const lift = { to: inHousehold.data(id), label: t('entitlement.to.lift') }

  /** Who restricted the household and when, and why where they said: their own words, as written. */
  const restricted = (restriction: Restriction | null): string[] => {
    if (restriction === null) return []
    const when = format.instant(restriction.restricted_at, zone)
    // Nobody is named once that account is gone.
    const name = restriction.restricted_by.label ?? ''
    const reason = restriction.reason ?? ''
    return [
      // Nor is somebody who has left since named as an owner: the data screen says who it was.
      name === '' || restriction.restricted_by.is_former_member === true
        ? t('entitlement.restricted.on', { when })
        : t('entitlement.restricted.by', { when, name }),
      ...(reason.trim() === '' ? [] : [t('entitlement.restricted.reason', { reason })]),
    ]
  }

  let title: string
  let tone = tones[shown.kind]
  const sentences: string[] = []
  const ways: { readonly to: string; readonly label: string }[] = []
  switch (shown.kind) {
    case 'trial':
      // The notice of the days before the last five is news, and no warning yet (DD-9).
      if (shown.stage === 'notice') tone = 'info'
      title = t('entitlement.trial.title', { days: daysLeft(shown.endsAt, now, zone) })
      sentences.push(t('entitlement.trial.body', { day: format.dayOf(shown.endsAt, zone) }))
      if (reader === 'payer') ways.push(subscribe)
      else if (owner) ways.push(billing)
      break
    case 'past_due':
      title = t('entitlement.past_due.title')
      sentences.push(t('entitlement.past_due.body'))
      ways.push(billing)
      break
    case 'grace':
      title = t('entitlement.grace.title')
      sentences.push(t('entitlement.grace.body'))
      if (shown.endsAt !== null) {
        sentences.push(t('entitlement.grace.until', { day: format.dayOf(shown.endsAt, zone) }))
      }
      if (owner) ways.push(billing)
      break
    case 'read_only':
    case 'canceled':
      if (shown.kind === 'read_only') {
        title = t('entitlement.read_only.title', { household: household.name })
        sentences.push(t('entitlement.read_only.body'))
      } else {
        title = t('entitlement.canceled.title')
        sentences.push(t('entitlement.canceled.body'))
      }
      sentences.push(t('entitlement.held'))
      if (shown.retainedUntil !== null) {
        sentences.push(
          t('entitlement.kept_until', { day: format.dayOf(shown.retainedUntil, zone) }),
        )
      }
      // The lapse outranks a restriction, which is said beside it all the same (D-114).
      sentences.push(...restricted(shown.restriction))
      if (owner) {
        // A subscription that was cancelled is over: its payer makes another.
        ways.push(shown.kind === 'canceled' && reader === 'payer' ? subscribe : billing, exported)
        if (shown.restriction !== null) ways.push(lift)
      } else {
        // Their own data is theirs to take, whatever becomes of the household's.
        ways.push({ to: paths.accountPrivacy.path, label: t('account.nav.privacy') })
      }
      break
    case 'restricted':
      title = t('entitlement.restricted.title')
      sentences.push(...restricted(shown.restriction), t('entitlement.restricted.body'))
      sentences.push(t('entitlement.held'))
      if (owner) ways.push(lift)
      break
  }
  // A member can do nothing about any of it, and is told who can.
  if (!owner) {
    sentences.push(
      owners.length === 0
        ? t('entitlement.ask.owner')
        : t('entitlement.ask.owners', { owners: format.list(owners) }),
    )
  }

  return (
    <Banner
      tone={tone}
      title={title}
      announce={announce}
      onDismiss={onDismiss}
      actions={
        ways.length === 0
          ? undefined
          : ways.map(({ to, label }) => (
              <Link key={to} to={to} className={styles.way}>
                {label}
              </Link>
            ))
      }
    >
      <div className={styles.sentences}>
        {sentences.map((sentence) => (
          <p key={sentence} className={styles.written}>
            {sentence}
          </p>
        ))}
      </div>
    </Banner>
  )
}

/** The banner of a state that has one, read for its member: who they are in the household. */
function Drawn({ shown, announce }: { readonly shown: Shown; readonly announce: boolean }) {
  const household = useHousehold()
  const me = useMe()
  const zone = useTimeZone()
  const owners = useOwnerNames(household.id)
  const reader = useReader(household)

  // The trial's end as it was when its first notice was put away, here or on an earlier visit.
  const [away, setAway] = useState(() => putAway(me.id, household.id))
  const notice = shown.kind === 'trial' && shown.stage === 'notice' ? shown : null
  const hidden = notice !== null && away === notice.endsAt
  // Its control left with it, and the focus that control held: it goes to the page's landmark,
  // which is what stands under the place the notice was.
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (dismissed) refocus(document.getElementById(contentId))
  }, [dismissed])

  if (hidden) return null
  return (
    <EntitlementBannerView
      household={household}
      shown={shown}
      reader={reader}
      owners={owners}
      zone={zone}
      // The clock as it is drawn: the days are counted anew whenever the shell draws again.
      now={Date.now()}
      announce={announce}
      onDismiss={
        notice === null
          ? undefined
          : () => {
              putAwayNow(me.id, household.id, notice.endsAt)
              setAway(notice.endsAt)
              setDismissed(true)
            }
      }
    />
  )
}

/** The banner of the household the shell is around, or nothing where its state asks for none. */
export function EntitlementBanner() {
  const household = useHousehold()
  const shown = bannerOf(
    household.entitlement,
    household.my_role === 'owner',
    (household.deletion_scheduled_at ?? null) !== null,
  )
  const id = shown === null ? null : bannerId(shown)
  // What stood when the household was opened, a banner or none, is read in its place. Anything
  // it comes to afterwards arrived while the member was here, and nothing moved the focus to it.
  const [first] = useState(id)
  const [moved, setMoved] = useState(false)
  if (!moved && id !== first) setMoved(true)
  if (shown === null) return null
  // A banner of its own for each, so that one which takes another's place is said as it arrives.
  return <Drawn key={id} shown={shown} announce={moved} />
}
