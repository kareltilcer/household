// Leaving a household (A-26, `/households/{id}/leave`; PRD 02 FR-HH4 and FR-HH6, 05 §5 FR-PR7;
// 03-patterns §5). Any member may leave, whatever they hold in the household, so the screen is
// outside household settings and is drawn for every member alike.
//
// Two members cannot leave without doing something first, the last owner and whoever pays, and a
// member who is both is told both at once, before they press anything: a refusal met one at a
// time is how somebody spends twenty minutes clearing one to meet the second. What stands in the
// way is worked out from the household's members and the member's own row among them, each with
// what unblocks it, and while anything does the control that leaves is absent. The server is the
// judge all the same: it names every reason at once (`409`, `blocked_by`), which the screen then
// draws as the same refusals and says as they arrive, since somebody may have changed something
// since the members were read, and an owner whose account is being deleted counts as none
// (D-137), which no member can read.
//
// *Hand billing over* leads to the billing screen, where whoever pays offers billing to another
// owner and it moves once they accept (billing/Handover.tsx; FR-BI6). The server refuses a payer
// of record whatever the subscription's state, a trial that never subscribed among them, so
// cancelling the subscription is no way out and is said not to be. What the prototype drew and
// this does not:
// deleting the household, the last owner's other way out, is not built, so only making somebody
// else an owner is offered. A member who is the only one in the household is told that leaving
// would leave it with nobody in it, and one whose only company is child profiles, which are
// never made owners, is led to where somebody is invited and not to a list that can give no
// owner. A child profile does not leave: an owner removes it (D-104).
//
// What leaving does to what the member wrote is said in a section of its own, always, and again
// in the confirmation: what they added stays with the household, and their private notes and
// documents go after thirty days in which they can be exported.
//
// A-26's states (ledger preset F) are *loading*, the members being read; *populated*, the
// refusals or the control; and *error*, the members unread with nothing kept, where the refusals
// cannot be worked out and no leaving is offered. The rest have nothing to be here. Nothing is
// listed to be *empty*. *Offline* is the screen from what this browser kept, and a leaving that
// says it could not reach the server. Nothing waits *pending* or *syncing*: a membership ends on
// the server or not at all (D-80), its control busy meanwhile. Nothing is *conflicted*, and a
// refusal is no *rejected* change to settle later: it is drawn as what stands in the way.
// Nothing is *absent* or *withdrawn*, no grant standing over leaving. *Read-only* changes one
// thing: leaving is taken by a household that takes no other write (FR-BI1), so a household
// whose subscription lapsed is left like any other, but its last owner can make nobody an owner
// there and invite nobody, and is told that in the place of a way that would lead to neither.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { readState, refocus, useNoWithdrawal } from '../account/common.ts'
import { Section, SettingsPage } from '../account/Page.tsx'
import styles from '../account/Settings.module.css'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { inHousehold, paths } from '../app/paths.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe, type Me } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import { useToast } from '../ui/Toast.tsx'
import { useMembers, useReread, writes } from './data.ts'
import { useHousehold } from './HouseholdContext.tsx'
import { householdKey, householdsKey, type HouseholdSummary } from './households.ts'
import { useTimeZone } from './timezone.ts'

/** What stands in the way of leaving, as the server names it (FR-HH4). */
export type Blocker = 'last_owner' | 'billing_payer'

function isBlocker(value: unknown): value is Blocker {
  return value === 'last_owner' || value === 'billing_payer'
}

function same(one: string | undefined, other: string): boolean {
  return one?.toLowerCase() === other.toLowerCase()
}

/**
 * What a refused leaving names: every reason at once, read from the problem document as it came
 * (the contract's `LeaveBlockedProblem`). One that lists none this build knows names its own
 * code at least. Empty for any other failure.
 */
export function blockedBy(error: unknown): readonly Blocker[] {
  const problem = problemIn(error)
  if (problem?.status !== 409 || !isBlocker(problem.code)) return []
  const listed: unknown = 'blocked_by' in problem ? problem.blocked_by : undefined
  const named = Array.isArray(listed) ? listed.filter(isBlocker) : []
  return named.length > 0 ? named : [problem.code]
}

function Leaving({ me }: { readonly me: Me }) {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const online = useOnline()
  const withdrawn = useNoWithdrawal()
  const say = useProblemText(useTimeZone())
  const household = useHousehold()
  const reread = useReread(household.id)
  const members = useMembers(household.id)
  const { id, name } = household

  const [confirming, setConfirming] = useState(false)
  // Whether the members were read again after the server refused: what they say then is how the
  // household stands, and no longer what somebody changed while this page was open.
  const [readAgain, setReadAgain] = useState(false)

  // Whether the member left. What this browser kept of the household is removed as this screen
  // leaves the page, and not a moment sooner: the shell around it reads the household from the
  // same place, and with it gone would ask the server for one that is no longer theirs.
  const left = useRef(false)
  // Whether this screen has left the page: by the browser's own way back, which no question
  // holds, it may have before a leaving it asked for is answered.
  const gone = useRef(false)
  useEffect(() => {
    gone.current = false
    return () => {
      gone.current = true
      if (left.current) queries.removeQueries({ queryKey: householdKey(id) })
    }
  }, [queries, id])

  const leave = useMutation({
    ...askedNow,
    mutationFn: async () => {
      unwrap(
        await api.POST('/households/{household_id}/leave', {
          params: { path: { household_id: id } },
        }),
      )
    },
    onSuccess: () => {
      // The list this browser kept names the household still, and where the app opens would
      // lead straight back to it: it is taken out of the list at once, and the list read again.
      queries.setQueryData<HouseholdSummary[]>(householdsKey, (list) =>
        list?.filter((each) => !same(each.id, id)),
      )
      void queries.invalidateQueries({ queryKey: householdsKey, exact: true })
      toast({ message: t('household.leave.done', { household: name }) })
      left.current = true
      // The screen went before the answer came, and took its own tidying with it.
      if (gone.current) queries.removeQueries({ queryKey: householdKey(id) })
      void navigate(paths.home.path, { replace: true })
    },
    onError: (error) => {
      // The household is not as this page read it: it is read again.
      const status = problemIn(error)?.status
      if (status !== 409 && status !== 403 && status !== 404) return
      void reread().then(() => {
        setReadAgain(true)
      })
    },
  })

  // What stands in the way, as the members read here say it.
  const list = members.data ?? []
  const own = list.find((each) => same(each.user_id, me.id))
  const others = list.filter((each) => each !== own)
  const anotherOwner = others.some((each) => each.role === 'owner')
  const alone = own !== undefined && others.length === 0
  // Whether everybody else here is a child profile, which is never made an owner (FR-CH1): the
  // list of members is then no place to make one, and somebody has to be invited first.
  const onlyChildren = others.length > 0 && others.every((each) => each.role === 'child')
  // And as the server said it, to a press: its word stands for as long as the screen does.
  const named = blockedBy(leave.error)
  const lastOwner = (own?.role === 'owner' && !anotherOwner) || named.includes('last_owner')
  const payer = own?.is_billing_payer === true || named.includes('billing_payer')
  const inTheWay = Number(lastOwner) + Number(payer)
  const forbidden = problemIn(leave.error)?.code === 'forbidden'
  /** Whether the server's answer to a press took the control away. */
  const stopped = named.length > 0 || forbidden
  // Read again, the members still name another owner: one the server did not count.
  const uncounted = named.includes('last_owner') && anotherOwner && readAgain

  // The confirmation closes on such an answer and the control it was opened from is gone: the
  // focus they held goes to the screen's own place, where what stands in the way is drawn.
  const view = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (stopped) refocus(view.current)
  }, [stopped])

  // Any other failure is said in the confirmation, which stays: the member is still a member.
  let failure: string | undefined
  if (leave.isError && !stopped) {
    const problem = problemIn(leave.error)
    if (problem === undefined) failure = t('household.leave.unreachable', { household: name })
    else if (problem.status === 404) failure = t('household.settings.refused.gone')
    else if (problem.status === 429) failure = say(leave.error)
    else failure = t('household.leave.failed', { household: name })
  }

  const intro = inTheWay === 2 ? t('household.leave.intro.two') : t('household.leave.intro.one')
  const behind = t('household.leave.behind.body')
  const close = () => {
    if (!leave.isPending) setConfirming(false)
  }

  return (
    <SettingsPage title={t('household.leave.title', { household: name })}>
      <div ref={view} tabIndex={-1} className={styles.view}>
        <StateFrame
          state={readState(members, online)}
          skeleton={
            <Skeleton
              bars={[
                [45, 1.25],
                [90, 1],
                [70, 1],
                [40, 2.75],
              ]}
            />
          }
          // Nothing is listed here: the members are read for what they say of leaving.
          empty={null}
          texts={{
            error: {
              title: t('household.leave.unread.title'),
              text: t('household.leave.unread.body'),
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
            withdrawn,
          }}
        >
          {() => (
            <>
              {forbidden ? (
                <Banner tone="danger" announce>
                  {t('household.leave.child')}
                </Banner>
              ) : inTheWay === 0 ? null : named.length > 0 ? (
                // The server's answer to a press: said as it arrives.
                <Banner tone="danger" title={t('household.leave.refused.title')} announce>
                  {intro}
                </Banner>
              ) : (
                // So when the screen opened: read in its place.
                <Banner tone="warning">{intro}</Banner>
              )}
              {lastOwner && alone ? (
                <Section title={t('household.leave.alone.title')}>
                  <p className={styles.text}>
                    {t('household.leave.alone.body', { household: name })}
                  </p>
                </Section>
              ) : null}
              {lastOwner && !alone ? (
                <Section title={t('household.leave.last_owner.title')}>
                  <p className={styles.text}>
                    {onlyChildren
                      ? t('household.leave.last_owner.children')
                      : t('household.leave.last_owner.body')}
                  </p>
                  {uncounted ? (
                    <p className={styles.text}>{t('household.leave.last_owner.deleting')}</p>
                  ) : null}
                  {/* No way that could only lead to nobody: where the members can give no owner,
                      the way on is to where one is invited, and where the household takes no
                      writes neither can be done, which is said. */}
                  {!writes(household) ? (
                    <p className={styles.text}>
                      {t('household.leave.last_owner.held', { household: name })}
                    </p>
                  ) : onlyChildren ? (
                    <Link className={styles.link} to={inHousehold.invite(id)}>
                      {t('household.invite.title')}
                    </Link>
                  ) : (
                    <Link className={styles.link} to={inHousehold.members(id)}>
                      {t('household.leave.last_owner.action')}
                    </Link>
                  )}
                </Section>
              ) : null}
              {payer ? (
                <Section title={t('household.leave.payer.title')}>
                  <p className={styles.text}>{t('household.leave.payer.body')}</p>
                  {/* Billing is an owner's screen, and whoever pays is one (FR-HH6): the way
                      to where it is offered to another. */}
                  {household.my_role === 'owner' ? (
                    <Link className={styles.link} to={inHousehold.billing(id)}>
                      {t('household.leave.payer.action')}
                    </Link>
                  ) : null}
                </Section>
              ) : null}
              <Section title={t('household.leave.behind.title')}>
                <p className={styles.text}>{behind}</p>
              </Section>
              {/* No control that could only be refused: what it waits for is said above. */}
              {inTheWay === 0 && !forbidden ? (
                <div className={styles.actions}>
                  <Button
                    variant="danger"
                    onClick={() => {
                      leave.reset()
                      setConfirming(true)
                    }}
                  >
                    {t('household.leave.action', { household: name })}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </StateFrame>
      </div>

      {confirming && !stopped ? (
        <Dialog
          open
          onClose={close}
          title={t('household.leave.confirm.title', { household: name })}
          description={behind}
          actions={
            <>
              <Button onClick={close}>{t('account.cancel')}</Button>
              <Button
                variant="danger"
                // Busy until where the app opens has taken this screen's place.
                loading={leave.isPending || leave.isSuccess}
                onClick={() => {
                  leave.mutate()
                }}
              >
                {t('household.leave.action', { household: name })}
              </Button>
            </>
          }
        >
          {failure === undefined ? undefined : (
            // A banner of its own for each failure, so that a second one is said again.
            <Banner key={leave.submittedAt} tone="danger" announce>
              {failure}
            </Banner>
          )}
        </Dialog>
      ) : null}
    </SettingsPage>
  )
}

export function Leave() {
  const t = useTranslate()
  const me = useMe()
  const household = useHousehold()
  // A child profile is nothing outside its household, and is an owner's to remove (D-104): it
  // is told so, and offered nothing the server would refuse.
  if (me.is_child === true || household.my_role === 'child') {
    return (
      <SettingsPage
        title={t('household.leave.title', { household: household.name })}
        lead={t('household.leave.child')}
      >
        {null}
      </SettingsPage>
    )
  }
  return <Leaving me={me} />
}
