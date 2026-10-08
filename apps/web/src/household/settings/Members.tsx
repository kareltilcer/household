// Everybody's access, visible to everybody (C-50, `/households/{id}/settings/members`; PRD 17 §2,
// FR-HA3; PRD 02 §4): every member of the household in the order they joined, each with their
// role, when they joined and were last active, and what they hold on every module, a line a
// level. It is one screen because a question about access is answered by comparison ("why can
// Petr see Finance and I can't"), and every member reads it, whatever they hold on household
// settings (D-167): a household is not an org chart.
//
// The screen changes nothing itself. A member's role and levels are changed on their own page,
// which their name leads to, and an invitation is written in the composer. What an owner has
// here are the two ways to add somebody: the way to the composer, and the sheet that makes a
// child profile (ChildCreate.tsx). Both are drawn for an owner of a household that takes writes,
// and for nobody else. Two things the prototype drew here are left out: the invitations as rows
// of their own, which have a screen (a member who may read them is told how many wait, and led
// there), and a badge on a member who has just joined, of which the server says nothing.
//
// A household with one owner nudges that owner to make a second (PRD 02 §4): an account nobody
// can get into would leave a household nobody can administer. It is said to the owner alone, who
// can act on it, and only where there is an adult member to make one.
//
// C-50's states. *Loading*, *error* and *offline* are the read's: a skeleton, *could not be
// read* where nothing is kept and the read failed or waits for a connection, and the list as
// this browser kept it. *Empty* is a household of one: its member's own row, and under it what
// inviting somebody takes. *Populated* is the list. *Read-only* is the list with the owner's two
// actions absent, the settings' own note saying why (Page.tsx). *Absent* has nothing to be,
// every member reading this screen. *Withdrawn* is a member removed while the screen is open,
// which the shell answers for the whole household, a `404` on it drawing *not available*: the
// screen has no state of its own for it. *Pending*, *syncing*, *conflicted* and *rejected* have
// nothing to be either: nothing here is written offline (D-80), and a change that is refused is
// said where it was asked.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { readState } from '../../account/common.ts'
import settings from '../../account/Settings.module.css'
import { inHousehold } from '../../app/paths.ts'
import { useFormat, useTranslate } from '../../i18n/I18nProvider.tsx'
import { useMe } from '../../session/SessionProvider.tsx'
import { Banner } from '../../ui/Banner.tsx'
import { Button } from '../../ui/Button.tsx'
import { Portrait, type MemberTone } from '../../ui/Chip.tsx'
import { cx } from '../../ui/cx.ts'
import { EmptyState } from '../../ui/EmptyState.tsx'
import { List } from '../../ui/ListRow.tsx'
import { useOnline } from '../../ui/online.ts'
import { Skeleton } from '../../ui/Skeleton.tsx'
import { StateFrame } from '../../ui/StateFrame.tsx'
import { StatusMark } from '../../ui/StatusMark.tsx'
import { useInvitations, useMembers, type Membership } from '../data.ts'
import { GrantSummary } from '../GrantMatrix.tsx'
import { useHousehold } from '../HouseholdContext.tsx'
import { useRoleWord } from '../households.ts'
import { useTimeZone } from '../timezone.ts'
import { ChildCreate } from './ChildCreate.tsx'
import styles from './Members.module.css'
import { HouseholdSettingsPage, useStanding } from './Page.tsx'

const tones: readonly MemberTone[] = [1, 2, 3, 4, 5, 6, 7, 8]

/** A member's colour in the household: theirs by their place in its list, and around again. */
function toneOf(place: number): MemberTone {
  return tones[place % tones.length] ?? 1
}

function Row({ member, tone }: { readonly member: Membership; readonly tone: MemberTone }) {
  const t = useTranslate()
  const format = useFormat()
  const household = useHousehold()
  const me = useMe()
  const zone = useTimeZone()
  const role = useRoleWord()
  const { changes } = useStanding()
  const name = member.display_name ?? ''
  const own = member.user_id === me.id
  const page = inHousehold.member(household.id, member.user_id ?? '')
  const active = member.last_active_at ?? null
  const dates =
    member.joined_at === undefined
      ? undefined
      : active === null
        ? t('household.members.dates_never', { joined: format.dayOf(member.joined_at, zone) })
        : t('household.members.dates', {
            joined: format.dayOf(member.joined_at, zone),
            active: format.dayOf(active, zone),
          })
  return (
    <li className={styles.row}>
      <Portrait
        address={member.avatar_url ?? null}
        name={name}
        tone={tone}
        className={styles.picture}
      />
      <div className={styles.text}>
        <Link className={cx(settings.link, settings.strong)} to={page}>
          {own ? t('household.members.you', { name }) : name}
        </Link>
        <p className={styles.facts}>
          <span className={settings.badge}>{role(member.role)}</span>
          {member.is_billing_payer === true ? (
            <span className={settings.note}>{t('household.members.payer')}</span>
          ) : null}
        </p>
        {dates === undefined ? null : <p className={settings.note}>{dates}</p>}
        {member.child?.pin_locked === true ? (
          // A status: its colour, its glyph and its word together, and then what it means. Its
          // unlocking is on the profile's own page, where an owner is led.
          <div className={settings.group}>
            <StatusMark status="locked" />
            <p className={settings.note}>{t('household.members.locked.body')}</p>
            {changes ? (
              <Link className={settings.link} to={page}>
                {t('household.members.locked.open', { name })}
              </Link>
            ) : null}
          </div>
        ) : null}
        <GrantSummary grants={member.grants} whose={own ? 'yours' : 'theirs'} compact />
      </div>
    </li>
  )
}

export function Members() {
  const t = useTranslate()
  const household = useHousehold()
  const me = useMe()
  const online = useOnline()
  const standing = useStanding()
  const members = useMembers(household.id)
  const invitations = useInvitations(household.id, { enabled: standing.invitations })

  const list = members.data ?? []
  const alone = list.every((member) => member.user_id === me.id)
  const waiting = (invitations.data ?? []).filter((each) => each.status === 'pending').length
  // One owner, who is then the one reading, and an adult beside them who could be a second.
  const nudged =
    standing.changes &&
    list.filter((member) => member.role === 'owner').length === 1 &&
    list.some((member) => member.role === 'member')

  // Where the focus is once the sheet has closed: on the control that opened it, and, where
  // that control went while the sheet was open, with the owner's standing or the household's
  // writes, on the list's own place. It is not left to drop to the page.
  const [adding, setAdding] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const view = useRef<HTMLDivElement>(null)
  const closed = useRef(false)
  useEffect(() => {
    if (adding || !closed.current) return
    closed.current = false
    const next = opener.current ?? view.current
    next?.focus()
  }, [adding])

  const invite = (
    <Link className={settings.link} to={inHousehold.invite(household.id)}>
      {t('household.invite.title')}
    </Link>
  )
  const rows = (
    <List label={t('household.settings.members.title')}>
      {list.map((member, place) => (
        <Row key={member.user_id} member={member} tone={toneOf(place)} />
      ))}
    </List>
  )

  return (
    <HouseholdSettingsPage
      title={t('household.settings.members.title')}
      lead={t('household.members.lede')}
    >
      {/* Read in its place, and never announced: it was so when the screen opened. */}
      {nudged ? (
        <Banner tone="info" title={t('household.members.one_owner.title')}>
          {t('household.members.one_owner.body')}
        </Banner>
      ) : null}
      {/* Once the list is read, and from then on: the control a sheet was opened from stays
          where it is while the list is read again. A household of one is offered the way to
          the composer by its empty state, and by nothing twice. */}
      {standing.changes && members.data !== undefined ? (
        <div className={settings.actions}>
          {alone ? null : invite}
          <Button
            ref={opener}
            onClick={() => {
              setAdding(true)
            }}
          >
            {t('household.child.create.title')}
          </Button>
        </div>
      ) : null}
      {waiting > 0 ? (
        <div className={settings.group}>
          <p className={settings.text}>{t('household.members.waiting', { count: waiting })}</p>
          <Link className={settings.link} to={inHousehold.invitations(household.id)}>
            {t('household.members.invitations_open')}
          </Link>
        </div>
      ) : null}
      <div ref={view} tabIndex={-1} className={settings.view}>
        <StateFrame
          state={readState(members, online, alone)}
          skeleton={
            <Skeleton
              bars={[
                [40, 1.25],
                [70, 1],
                [55, 1],
                [40, 1.25],
                [70, 1],
                [55, 1],
              ]}
            />
          }
          empty={
            <div className={styles.alone}>
              {rows}
              <EmptyState
                sentence={t('household.members.empty.title')}
                example={t('household.members.empty.example')}
                action={standing.changes ? invite : undefined}
              />
            </div>
          }
          texts={{
            error: {
              title: t('household.members.error.title'),
              text: t('household.members.error.body'),
              actions: (
                <Button
                  onClick={() => {
                    void members.refetch()
                  }}
                >
                  {t('ui.retry')}
                </Button>
              ),
            },
            // Never drawn: a member who was removed is answered by the shell, for the household.
            withdrawn: { text: t('household.settings.withdrawn') },
          }}
        >
          {() => rows}
        </StateFrame>
      </div>

      {adding ? (
        <ChildCreate
          onClose={() => {
            closed.current = true
            setAdding(false)
          }}
        />
      ) : null}
    </HouseholdSettingsPage>
  )
}
