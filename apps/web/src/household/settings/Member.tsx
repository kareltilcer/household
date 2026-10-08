// One member (C-50's detail, `/households/{id}/settings/members/{user_id}`; PRD 17 §2 FR-HA3,
// FR-HA5 to FR-HA7 and FR-HA17; PRD 02 §3 to §6): what they hold, their role, removing them,
// and, for a child profile, the profile's own controls. Every member may read any member's
// page, their own included: who holds what is answered by comparison, and a household is not an
// org chart. Every change on it is an owner's, in a household that takes writes, and is made on
// the server or not at all: nothing here is kept to be sent later (D-80).
//
// The page is its parts, each a section that says what it leaves out (MemberGrants.tsx,
// MemberRole.tsx, MemberRemove.tsx, ChildProfile.tsx). A child profile's own part comes first:
// a locked profile is what brings an owner here, and its unlock should not wait under seventeen
// rows.
//
// What the page itself leaves out:
// - When they joined, when they were last active and their address: those are the list's to
//   say, where the members are compared (FR-HA3).
// - A guard on leaving with levels changed and not saved: a level is one press to choose again.
//
// C-50's states. *Loading* and *error* are the member's read: a skeleton, and a sentence with a
// way to try again where nothing is kept of them, a read paused for want of a connection among
// it. *Populated* is the page. *Offline* is the page as this browser kept it, with every write
// answered at once that the server could not be reached. *Absent* is an address that names no
// member of the household, and *withdrawn* a member removed while the page stood open, whose
// next read finds nobody: both draw the neutral *not available*, with the list of members as its
// way out, and neither says which it was. *Read-only* is the same page without its controls,
// which the frame of the settings says the reason for (Page.tsx). *Empty* has nothing to be on
// one member's page. *Pending* and *syncing* are a write under way, its control busy;
// *conflicted* and *rejected* are refusals said where they are met, there being no queue to
// hold a change that waits.
import { useRef } from 'react'
import { useParams } from 'react-router'
import { readState, useNoWithdrawal } from '../../account/common.ts'
import styles from '../../account/Settings.module.css'
import { problemIn } from '../../api/problem.ts'
import { NotAvailable } from '../../app/NotAvailable.tsx'
import { inHousehold } from '../../app/paths.ts'
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import { useMe } from '../../session/SessionProvider.tsx'
import { Button } from '../../ui/Button.tsx'
import { useOnline } from '../../ui/online.ts'
import { Skeleton } from '../../ui/Skeleton.tsx'
import { StateFrame } from '../../ui/StateFrame.tsx'
import { useHousehold } from '../HouseholdContext.tsx'
import { useRoleWord } from '../households.ts'
import { ChildProfile } from './ChildProfile.tsx'
import { subjectOf, useFocusHandedOn, useMember, type Subject } from './member.ts'
import { MemberGrants } from './MemberGrants.tsx'
import { MemberRemove } from './MemberRemove.tsx'
import { MemberRole } from './MemberRole.tsx'
import { HouseholdSettingsPage, useStanding } from './Page.tsx'

function Parts({ subject }: { readonly subject: Subject }) {
  return (
    <>
      {subject.role === 'child' ? <ChildProfile subject={subject} /> : null}
      <MemberGrants subject={subject} />
      <MemberRole subject={subject} />
      <MemberRemove subject={subject} />
    </>
  )
}

function MemberPage({ userId }: { readonly userId: string }) {
  const t = useTranslate()
  const household = useHousehold()
  const standing = useStanding()
  const me = useMe()
  const online = useOnline()
  const role = useRoleWord()
  const withdrawn = useNoWithdrawal()
  const read = useMember(household.id, userId)
  // Every control here is drawn only for an owner, where writes are taken. Should either stop
  // being so while the page is open, the control that held the focus goes with the rest: the
  // focus is put on the page's own place.
  const view = useRef<HTMLDivElement>(null)
  useFocusHandedOn(standing.changes, view)

  // Nobody of the household is at this address, or is any more. It opens nothing, as any other
  // address that does (F-17): whatever this browser kept of them is not drawn in its place.
  if (problemIn(read.error)?.status === 404) {
    return <NotAvailable home={inHousehold.members(household.id)} />
  }
  const subject = read.data === undefined ? undefined : subjectOf(read.data, userId, me.id)
  // Until the member is read the page is the members', which is where it stands.
  const title =
    subject === undefined || subject.name === ''
      ? t('household.settings.members.title')
      : subject.name
  const lead =
    subject === undefined
      ? undefined
      : subject.payer
        ? t('household.member.lead.payer', { role: role(subject.role) })
        : role(subject.role)
  return (
    <HouseholdSettingsPage title={title} lead={lead}>
      <div ref={view} tabIndex={-1} className={styles.view}>
        <StateFrame
          state={readState(read, online)}
          skeleton={
            <Skeleton
              bars={[
                [40, 1.25],
                [90, 1],
                [70, 1],
                [40, 1.25],
                [85, 1],
              ]}
            />
          }
          // One member's page is never empty: a member holds a level on every module.
          empty={null}
          texts={{
            error: {
              title: t('household.member.error.title'),
              text: t('household.member.error.body'),
              actions: (
                <Button
                  onClick={() => {
                    void read.refetch()
                  }}
                >
                  {t('ui.retry')}
                </Button>
              ),
            },
            withdrawn,
          }}
        >
          {() => (subject === undefined ? null : <Parts subject={subject} />)}
        </StateFrame>
      </div>
    </HouseholdSettingsPage>
  )
}

export function Member() {
  const { userId = '' } = useParams()
  const household = useHousehold()
  // A page is one member's, in one household: what was chosen, opened or refused on one is not
  // carried to the next, which the same route draws.
  return <MemberPage key={`${household.id}/${userId}`} userId={userId} />
}
