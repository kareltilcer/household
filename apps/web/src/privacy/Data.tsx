// A household's data (C-56, `/households/{id}/settings/data`; PRD 17 §7 FR-HA15 to FR-HA17 and
// FR-HA20, PRD 05 §3 and §5, PRD 04 §3 FR-BI1 and FR-BI7): what an owner does with all of it,
// in the design's order, which is the argument: what costs the household nothing comes first
// and the irreversible one is last. Take a copy; stop all changes for now, or allow them again;
// make somebody an owner; delete the household.
//
// Every member opens the screen and reads what is so: that a deletion is scheduled and for
// which day, which every member is told (D-138), and that changes are stopped, by whom, when
// and why (FR-BI7). The controls are an owner's, and a member who is none reads whose they are
// and is led to their own data, which is their account's. Three of the four work in every state
// the household can be opened in, a read-only one among them: the gate lets an export, a
// restriction and a deletion through (FR-BI1), so those are asked of an owner and not of an
// owner in a household that takes writes. Making an owner is not among them, whatever the
// prototype says: it is drawn where the household takes changes, and in its place is a sentence
// where it does not. It is no second way of doing it either: it leads to the members, where a
// member is made an owner from their own page (household/settings/MemberRole.tsx).
//
// What the prototype drew and nothing serves is left out: who scheduled a deletion and when,
// the household saying only its day; a count of what a deletion takes; and a trailing word on
// the copy's row for an export on its way, which is its own screen's to say.
//
// C-56's states. The household is read before this screen is drawn, by the shell, and the
// screen reads nothing else that it waits for, so *loading* and *error* are the shell's, and
// *offline* reads as online does, from what this browser kept, each write then saying that it
// could not reach the server and changed nothing. *Populated* is the page. *Absent* is the
// controls, for a member who is no owner. *Withdrawn* is an owner made a member while the
// screen was open: the controls leave when the household is read again, and a press before
// then is answered `403`, which is said on the page. *Read-only* is the page in a household
// that takes no other write: it says so, and that what is here still works. *Empty* has nothing
// to be, the four being always the four; nor have *pending*, *syncing* beyond a control that
// is busy, and *conflicted*, none of these being held to be sent later and the server holding
// one deletion and one restriction; nor *rejected*, a refusal being said where it was pressed.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { refocus, useFocusKept, useSaid } from '../account/common.ts'
import account from '../account/Settings.module.css'
import { inHousehold, paths } from '../app/paths.ts'
import { useOwnerNames, useReread } from '../household/data.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { HouseholdSettingsPage, Section, useStanding } from '../household/settings/Page.tsx'
import { useTimeZone } from '../household/timezone.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { cx } from '../ui/cx.ts'
import { DeleteHousehold } from './DataDelete.tsx'
import { Lift, Restrict } from './DataRestrict.tsx'
import { DeletionNotice } from './DeletionNotice.tsx'
import styles from './Privacy.module.css'

/** What the screen has open over itself: one of its two questions, or nothing. */
type Open = 'restrict' | 'delete' | null

/** That changes are stopped, by whom, when and why: every member's to read (FR-BI7). */
function RestrictionNotice() {
  const t = useTranslate()
  const format = useFormat()
  const zone = useTimeZone()
  const entitlement = useHousehold().entitlement
  const restriction = entitlement?.restriction ?? null
  if (restriction === null) return null
  // Under a lapse, lifting it gives nobody a change back (D-114): what it holds back is not said
  // to end with it, and an owner reads what lifting comes to beside the control.
  const lapsed = entitlement?.state === 'read_only' || entitlement?.state === 'canceled'
  const when = format.instant(restriction.restricted_at, zone)
  // The owner's name as it was when they restricted, which an erased account leaves empty.
  const name = restriction.restricted_by.label ?? ''
  const reason = restriction.reason ?? ''
  return (
    // Not announced: it was so when the screen opened, and whoever restricted it here was told
    // as they did.
    <Banner tone="warning" title={t('data.restricted.title')}>
      <div className={account.group}>
        <p>
          {name === ''
            ? t('data.restricted.by_unknown', { when })
            : restriction.restricted_by.is_former_member === true
              ? t('data.restricted.by_former', { name, when })
              : t('data.restricted.by', { name, when })}
        </p>
        {reason === '' ? null : (
          <p className={styles.written}>{t('data.restricted.reason', { reason })}</p>
        )}
        {lapsed ? null : <p>{t('data.restricted.rest')}</p>}
      </div>
    </Banner>
  )
}

export function Data() {
  const t = useTranslate()
  const format = useFormat()
  const household = useHousehold()
  const standing = useStanding()
  const zone = useTimeZone()
  const reread = useReread(household.id)
  const owners = useOwnerNames(household.id)
  const [open, setOpen] = useState<Open>(null)
  const [said, say] = useSaid()
  const view = useFocusKept(standing.owner, open)
  const { id, name } = household

  const restricted = (household.entitlement?.restriction ?? null) !== null
  const scheduled = household.deletion_scheduled_at ?? null
  // Read-only for want of a subscription, which a restriction is not: its own notice says that.
  const lapsed = !standing.writes && !restricted

  // A write that was answered changes what the screen draws, and the control that asked for it
  // leaves: the one that restricts for the one that lifts, the one that deletes for the day it
  // is scheduled for. The focus it held, or that its question gave back to it, goes to the
  // screen's own place, once the question is closed and the household is drawn as it now stands.
  const before = useRef<{ readonly restricted: boolean; readonly scheduled: boolean } | null>(null)
  const done = () => {
    before.current = { restricted, scheduled: scheduled !== null }
    setOpen(null)
  }
  useEffect(() => {
    const was = before.current
    if (was === null || open !== null) return
    if (was.restricted === restricted && was.scheduled === (scheduled !== null)) return
    before.current = null
    refocus(view.current)
  }, [open, restricted, scheduled, view])

  const show = (next: Open) => {
    // What an earlier press came to is said no longer once another is begun.
    say(null)
    setOpen(next)
  }
  const close = () => {
    setOpen(null)
  }
  // Refused for where the member now stands: said on the page, which is read again and then
  // draws no control for them.
  const ended = (text: string) => {
    setOpen(null)
    say(text)
    void reread()
  }

  return (
    <HouseholdSettingsPage
      title={t('household.settings.data.title')}
      lead={t('data.lead')}
      // Where its reader stands is said in the screen's own words, with their own way on beside
      // it: whose the four are, and which of them still work in a household that takes no other
      // write. The settings' note beside that would say the first of them twice.
      note={false}
    >
      {said === null ? null : (
        <Banner key={said.id} tone="danger" announce>
          {said.text}
        </Banner>
      )}
      {/* Where the focus goes when the control that held it has left (account/common.ts). */}
      <div ref={view} tabIndex={-1} className={cx(account.view, styles.sections)}>
        <DeletionNotice after={view} />
        <RestrictionNotice />
        {standing.owner && lapsed ? (
          // So when the screen opened: read in its place.
          <Banner tone="neutral">{t('data.read_only')}</Banner>
        ) : null}

        {standing.owner ? (
          <>
            <Section title={t('data.copy.title')}>
              <p className={account.text}>{t('data.copy.body')}</p>
              <Link className={account.link} to={inHousehold.exports(id)}>
                {t('data.exports.title')}
              </Link>
            </Section>

            <Section title={t('data.restrict.title')}>
              {restricted ? (
                <Lift
                  onBegin={() => {
                    say(null)
                  }}
                  onDone={done}
                  onEnded={ended}
                />
              ) : (
                <>
                  <p className={account.text}>{t('data.restrict.body')}</p>
                  {lapsed ? <p className={account.note}>{t('data.restrict.lapsed')}</p> : null}
                  <div className={account.actions}>
                    <Button
                      onClick={() => {
                        show('restrict')
                      }}
                    >
                      {t('data.restrict.action', { household: name })}
                    </Button>
                  </div>
                </>
              )}
            </Section>

            <Section title={t('data.owner.title')}>
              <p className={account.text}>{t('data.owner.body')}</p>
              {standing.writes ? (
                <Link className={account.link} to={inHousehold.members(id)}>
                  {t('data.owner.action')}
                </Link>
              ) : (
                // No way that could only lead to a refusal: an owner is made by a write the
                // gate does not let through.
                <p className={account.note}>{t('data.owner.not_now')}</p>
              )}
            </Section>

            <Section title={t('data.delete.title')}>
              <p className={account.text}>{t('data.delete.body')}</p>
              {scheduled === null ? (
                <div className={account.actions}>
                  <Button
                    variant="danger"
                    onClick={() => {
                      show('delete')
                    }}
                  >
                    {t('data.delete.action', { household: name })}
                  </Button>
                </div>
              ) : (
                // No control that would only be answered with the deletion already scheduled.
                <p className={account.note}>
                  {t('data.delete.scheduled', { day: format.dayOf(scheduled, zone, 'long') })}
                </p>
              )}
            </Section>
          </>
        ) : (
          // Absent: none of the four is a member's. Whose they are is said, and what is their
          // own is their account's.
          <>
            <Banner tone="neutral">
              {owners.length === 0
                ? t('data.owners_only')
                : t('data.owners_named', { owners: format.list(owners) })}
            </Banner>
            <Section title={t('data.own.title')}>
              <p className={account.text}>{t('data.own.body')}</p>
              <Link className={account.link} to={paths.accountPrivacy.path}>
                {t('privacy.title')}
              </Link>
            </Section>
          </>
        )}
      </div>

      {open === 'restrict' ? <Restrict onClose={close} onDone={done} onEnded={ended} /> : null}
      {open === 'delete' ? <DeleteHousehold onClose={close} onDone={done} onEnded={ended} /> : null}
    </HouseholdSettingsPage>
  )
}
