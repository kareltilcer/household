// The invitations a household sent (`/households/{id}/settings/invitations`; PRD 02 §3, FR-HH2
// and FR-HH3; PRD 17 §2, FR-HA4), and among them the inviter's notice of one that was declined
// (A-25): whom each was for and as what, how it stands, who sent it and what it gives, newest
// first as the server lists them.
//
// The invitations are what *Can see* on household settings unlocks (FR-AC3, D-103): a member who
// holds less is drawn the neutral *not available* and the server is asked nothing. Withdrawing
// one and sending one again are an owner's, in a household that takes writes; everybody else who
// reads the list reads it without the controls.
//
// A decline reaches its inviter as a push, whose link opens this screen, and the screen says it
// too: one notice above the list for each invitation that stands declined, to an owner, with the
// one thing that might change the answer, inviting again with different modules, which opens
// the composer filled in from the one that was declined. What the prototype drew and the server
// has none of is left out: no time of the decline, which the contract does not keep, and no
// *Dismiss*, there being nowhere to keep that it was dismissed. Withdrawing the invitation is
// what puts its notice away, and the notice says so; so does asking the address again, since a
// decline that has been answered is news no longer. Nor is there the prototype's *not sent*
// status, the contract having no drafts, nor its sheet of one invitation: a row holds all of it.
//
// Sending again is the caller's own sending (D-103): the row names them as its sender once the
// list is read again, which says it. It waits for a verified address, as inviting does, and the
// block is drawn where it blocks, at the top of the list, when the server refuses (A-4).
//
// Its states, for a list that is read and two writes asked at once (data.ts): *loading*,
// *populated* and *error* are the read's; *empty* teaches what an invitation takes, with the way
// to send one for an owner; *offline* is the list as this browser kept it, and a write that says
// it could not reach the server; *absent* is the member who holds nothing on household settings;
// *withdrawn* is that level lowered while the screen was open, which the list's `404` or the
// household read again says; *read-only* is the list without its controls, the settings' own
// note saying why. *Pending* and *syncing* have nothing to be, an invitation never being a
// change held to be sent later (D-80), nor has *conflicted*, an invitation having no version to
// disagree over, nor *rejected*: a refused write is said where it was pressed.
import type { BaseId } from '@household/icons'
import { BaseIcon } from '@household/icons/web'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import account from '../../account/Settings.module.css'
import { readState } from '../../account/common.ts'
import { useApi } from '../../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../../api/problem.ts'
import { useProblemText } from '../../api/problemText.ts'
import { askedNow } from '../../api/query.ts'
import { NotAvailable } from '../../app/NotAvailable.tsx'
import { inHousehold } from '../../app/paths.ts'
import { useFormat, useTranslate } from '../../i18n/I18nProvider.tsx'
import { useMe } from '../../session/SessionProvider.tsx'
import { Banner } from '../../ui/Banner.tsx'
import { Button } from '../../ui/Button.tsx'
import { Dialog } from '../../ui/Dialog.tsx'
import { EmptyState } from '../../ui/EmptyState.tsx'
import { List } from '../../ui/ListRow.tsx'
import { Skeleton } from '../../ui/Skeleton.tsx'
import { StateFrame } from '../../ui/StateFrame.tsx'
import { useToast } from '../../ui/Toast.tsx'
import a11y from '../../ui/a11y.module.css'
import { cx } from '../../ui/cx.ts'
import { useOnline } from '../../ui/online.ts'
import type { DataState } from '../../ui/states.ts'
import { useInvitations, useReread, type Invitation } from '../data.ts'
import { GrantSummary } from '../GrantMatrix.tsx'
import { useHousehold } from '../HouseholdContext.tsx'
import { householdKey, useRoleWord } from '../households.ts'
import { useTimeZone } from '../timezone.ts'
import { isUnverified, Unverified, useMarkUnverified } from '../Unverified.tsx'
import {
  addressOf,
  againState,
  isStale,
  settledAddresses,
  statusAt,
  useEverHeld,
  useRefusal,
  type InvitationStatus,
} from './invitations.ts'
import styles from './Invitations.module.css'
import { HouseholdSettingsPage, useStanding } from './Page.tsx'

/** What an owner can do to an invitation as it stands. */
interface Offered {
  /** Its link stops working: one that waits, and one that was declined or ran out, tidied away. */
  readonly withdraw: boolean
  /** A new link goes to its address: an email invitation that nobody has joined by. */
  readonly resend: boolean
}

/**
 * What is offered on `invitation`. One whose address another invitation waits for, or brought
 * somebody in at, is not sent again: the server answers that `404`, and the row to send is the
 * one that waits.
 */
function offeredOn(
  invitation: Invitation,
  status: InvitationStatus,
  settled: ReadonlySet<string>,
): Offered {
  const address = addressOf(invitation)
  return {
    withdraw: status === 'pending' || status === 'declined' || status === 'expired',
    resend:
      address !== null &&
      status !== 'accepted' &&
      (status === 'pending' || !settled.has(address.toLowerCase())),
  }
}

/** The invitation a confirmation withdraws. */
interface Target {
  readonly id: string
  /** The address it was sent to, or null for a link. */
  readonly email: string | null
}

/** A row's own control, named for what it acts on and drawn as the one word. */
function RowAction({
  name,
  word,
  loading = false,
  onPress,
}: {
  readonly name: string
  readonly word: string
  readonly loading?: boolean
  readonly onPress: () => void
}) {
  return (
    <Button
      loading={loading}
      onClick={() => {
        onPress()
      }}
    >
      <span className={a11y.visuallyHidden}>{name}</span>
      <span aria-hidden="true">{word}</span>
    </Button>
  )
}

/** The glyph that stands beside each status's words: decoration, the words saying all of it. */
const glyphs: Readonly<Record<InvitationStatus, BaseId>> = {
  pending: 'clock',
  accepted: 'check',
  declined: 'x',
  revoked: 'rotate-ccw',
  expired: 'calendar-days',
}

function Row({
  invitation,
  status,
  offered,
  resending,
  onWithdraw,
  onResend,
}: {
  readonly invitation: Invitation
  readonly status: InvitationStatus
  /** What its row draws a control for: nothing, for a member who changes nothing here. */
  readonly offered: Offered
  readonly resending: boolean
  readonly onWithdraw: () => void
  readonly onResend: (email: string) => void
}) {
  const t = useTranslate()
  const format = useFormat()
  const zone = useTimeZone()
  const role = useRoleWord()
  const address = addressOf(invitation)
  const day = (at: string | undefined) => (at === undefined ? '' : format.dayOf(at, zone))
  const sent = { name: invitation.invited_by?.label ?? '', day: day(invitation.created_at) }
  // How it stands, in words: the contract's own names for it are drawn nowhere.
  const stands = (): string => {
    switch (status) {
      case 'pending':
        return t('household.invitations.status.waiting', { day: day(invitation.expires_at) })
      case 'accepted':
        return t('household.invitations.status.joined')
      case 'declined':
        return t('household.invitations.status.declined')
      case 'revoked':
        return t('household.invitations.status.withdrawn')
      case 'expired':
        return t('household.invitations.status.expired', { day: day(invitation.expires_at) })
    }
  }
  const most = invitation.max_uses ?? 1

  return (
    <li className={styles.row}>
      <div className={styles.about}>
        <div className={styles.whom}>
          <span className={styles.who}>{address ?? t('household.invitations.row.link')}</span>
          <span className={account.badge}>{role(invitation.role)}</span>
        </div>
        <p className={styles.status}>
          <span className={styles.glyph}>
            <BaseIcon name={glyphs[status]} size={16} />
          </span>
          <span>{stands()}</span>
        </p>
        {/* A link that takes several: how many of them have joined by it. */}
        {address === null && most > 1 ? (
          <p className={styles.detail}>
            {t('household.invitations.row.uses', {
              uses: format.number(invitation.uses ?? 0),
              max: format.number(most),
            })}
          </p>
        ) : null}
        <p className={styles.detail}>
          {invitation.invited_by?.is_former_member === true
            ? t('household.invitations.row.sent_former', sent)
            : t('household.invitations.row.sent', sent)}
        </p>
        <GrantSummary grants={invitation.grants} whose="theirs" compact />
      </div>
      {offered.resend || offered.withdraw ? (
        <div className={styles.actions}>
          {offered.resend && address !== null ? (
            <RowAction
              name={t('household.invitations.resend.named', { email: address })}
              word={t('household.invitations.resend.word')}
              loading={resending}
              onPress={() => {
                onResend(address)
              }}
            />
          ) : null}
          {offered.withdraw ? (
            <RowAction
              name={
                address === null
                  ? t('household.invitations.withdraw.named_link', {
                      day: day(invitation.created_at),
                    })
                  : t('household.invitations.withdraw.named', { email: address })
              }
              word={t('household.invitations.withdraw.word')}
              onPress={onWithdraw}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/** A refusal that is no dialog's to say, and which one it is: each is said as it arrives. */
interface Refused {
  readonly count: number
  readonly text: string
}

function Sent() {
  const t = useTranslate()
  const api = useApi()
  const toast = useToast()
  const queries = useQueryClient()
  const household = useHousehold()
  const standing = useStanding()
  const zone = useTimeZone()
  const refusal = useRefusal(zone)
  const say = useProblemText(zone)
  const online = useOnline()
  const reread = useReread(household.id)
  const markUnverified = useMarkUnverified()
  const me = useMe()
  // The moment the screen opened: what a waiting invitation's time is held against.
  const [now] = useState(() => Date.now())

  const read = useInvitations(household.id, { enabled: standing.invitations })
  // The list's own refusal says the level was lowered since the household was read. The
  // household alone is read again, which is what tells the rest of the app; read again with it,
  // the list would only be refused again.
  const lowered = standing.invitations && problemIn(read.error)?.status === 404
  useEffect(() => {
    if (!lowered) return
    void queries.invalidateQueries({ queryKey: householdKey(household.id), exact: true })
  }, [lowered, queries, household.id])
  const withdrawn = !standing.invitations || lowered

  const listed = read.data
  const list = listed ?? []
  const settled = useMemo(() => settledAddresses(listed ?? [], now), [listed, now])

  const [target, setTarget] = useState<Target | null>(null)
  const [refused, setRefused] = useState<Refused | null>(null)
  // How many times the server has said this account's address is not verified.
  const [blocked, setBlocked] = useState(0)
  const refuse = (text: string) => {
    setRefused((was) => ({ count: (was?.count ?? 0) + 1, text }))
  }

  // A control that was pressed may be gone once the list is read again: an invitation that was
  // withdrawn offers no *Withdraw*, one that somebody joined by offers nothing, and a member who
  // is an owner no longer is offered none of them. The focus the control held went with it: it
  // is put on the list's own place, the element around the notices and the rows.
  const view = useRef<HTMLDivElement>(null)
  const pressed = useRef<{ readonly id: string; readonly control: keyof Offered } | null>(null)
  useEffect(() => {
    const was = pressed.current
    if (was === null || listed === undefined) return
    const row = listed.find((each) => each.id === was.id)
    if (
      standing.changes &&
      row !== undefined &&
      offeredOn(row, statusAt(row, now), settled)[was.control]
    ) {
      return
    }
    pressed.current = null
    const focused = document.activeElement
    if (focused === null || focused === document.body) view.current?.focus()
  }, [listed, now, settled, standing.changes])

  const withdraw = useMutation({
    ...askedNow,
    mutationFn: async (given: Target) => {
      unwrap(
        await api.DELETE('/households/{household_id}/invitations/{invitation_id}', {
          params: { path: { household_id: household.id, invitation_id: given.id } },
        }),
      )
    },
    onSuccess: (_answer, given) => {
      pressed.current = { id: given.id, control: 'withdraw' }
      setTarget(null)
      // The row stays, and says it is withdrawn once the list is read again.
      toast({
        message:
          given.email === null
            ? t('household.invitations.withdraw.done_link')
            : t('household.invitations.withdraw.done', { email: given.email }),
      })
      void reread()
    },
    onError: (error, given) => {
      // Joined by since the list was read, or no longer this member's to withdraw: the question
      // has nothing left to ask, and the list is read again. Any other failure is the
      // question's own to say, and it stays open.
      if (!isStale(error)) return
      pressed.current = { id: given.id, control: 'withdraw' }
      setTarget(null)
      refuse(refusal(error))
      void reread()
    },
  })
  const resend = useMutation({
    ...askedNow,
    mutationFn: async (given: { readonly id: string; readonly email: string }) => {
      unwrap(
        await api.POST('/households/{household_id}/invitations/{invitation_id}/resend', {
          params: { path: { household_id: household.id, invitation_id: given.id } },
        }),
      )
    },
    onSuccess: (_answer, given) => {
      // It is the caller's now (D-103), which the row says once the list is read again.
      toast({ message: t('household.invitations.resend.done', { email: given.email }) })
      void reread()
    },
    onError: (error, given) => {
      if (isUnverified(error)) {
        // The server's word on it, whatever this page had read: the block is drawn where the
        // notices stand, and lifts when the account is read as verified.
        markUnverified()
        setBlocked((times) => times + 1)
        return
      }
      refuse(refusal(error))
      if (!isStale(error)) return
      // The address has joined since, or the invitation was accepted: the row will say so.
      pressed.current = { id: given.id, control: 'resend' }
      void reread()
    },
  })

  const base = readState(read, online, list.length === 0)
  const state: DataState = withdrawn
    ? 'withdrawn'
    : !standing.writes && (base === 'populated' || base === 'offline')
      ? 'readonly'
      : base
  const invite = (
    <Link className={account.link} to={inHousehold.invite(household.id)}>
      {t('household.invite.title')}
    </Link>
  )

  return (
    <HouseholdSettingsPage
      title={t('household.settings.invitations.title')}
      lead={t('household.invitations.lead')}
    >
      <div ref={view} tabIndex={-1} className={cx(account.view, styles.stack)}>
        {blocked > 0 && !me.email_verified ? (
          <Unverified key={blocked} why={t('household.invite.unverified')} announce />
        ) : null}
        {refused === null ? null : (
          <Banner key={refused.count} tone="danger" announce>
            {refused.text}
          </Banner>
        )}
        <StateFrame
          state={state}
          skeleton={
            <Skeleton
              bars={[
                [55, 1.25],
                [35, 1],
                [70, 1],
                [50, 1.25],
                [40, 1],
              ]}
            />
          }
          empty={
            <EmptyState
              sentence={t('household.invitations.empty.sentence')}
              example={t('household.invitations.empty.example')}
              action={standing.changes ? invite : undefined}
            />
          }
          texts={{
            error: {
              title: t('household.invitations.error.title'),
              text: t('household.invitations.error.body'),
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
            withdrawn: { text: t('household.settings.withdrawn') },
          }}
        >
          {({ writes }) => {
            const changes = standing.changes && writes
            // A-25: what was declined, to the owners, until it is withdrawn or asked again.
            const declined = standing.owner
              ? list.filter((each) => {
                  const address = addressOf(each)
                  return (
                    statusAt(each, now) === 'declined' &&
                    (address === null || !settled.has(address.toLowerCase()))
                  )
                })
              : []
            return (
              <>
                {changes ? invite : null}
                {declined.map((each) => {
                  const who = addressOf(each)
                  return (
                    // Not announced: it was so when the screen opened.
                    <Banner
                      key={each.id}
                      tone="info"
                      title={
                        who === null
                          ? t('household.invitations.declined.title_link')
                          : t('household.invitations.declined.title', { who })
                      }
                      actions={
                        changes ? (
                          <Link
                            className={account.link}
                            to={inHousehold.invite(household.id)}
                            state={againState(each)}
                          >
                            {who === null
                              ? t('household.invitations.declined.again_link')
                              : t('household.invitations.declined.again', { who })}
                          </Link>
                        ) : undefined
                      }
                    >
                      {who === null
                        ? t('household.invitations.declined.body_link')
                        : t('household.invitations.declined.body')}
                    </Banner>
                  )
                })}
                <List label={t('household.settings.invitations.title')}>
                  {list.map((each) => {
                    const status = statusAt(each, now)
                    const offered = changes
                      ? offeredOn(each, status, settled)
                      : { withdraw: false, resend: false }
                    return (
                      <Row
                        key={each.id}
                        invitation={each}
                        status={status}
                        offered={offered}
                        resending={resend.isPending && resend.variables.id === each.id}
                        onWithdraw={() => {
                          withdraw.reset()
                          setRefused(null)
                          setTarget({ id: each.id, email: addressOf(each) })
                        }}
                        onResend={(email) => {
                          setRefused(null)
                          resend.mutate({ id: each.id, email })
                        }}
                      />
                    )
                  })}
                </List>
              </>
            )
          }}
        </StateFrame>
      </div>

      {target === null ? null : (
        <Dialog
          open
          onClose={() => {
            if (!withdraw.isPending) setTarget(null)
          }}
          title={
            target.email === null
              ? t('household.invitations.withdraw.title_link')
              : t('household.invitations.withdraw.title', { email: target.email })
          }
          description={
            target.email === null
              ? t('household.invitations.withdraw.body_link')
              : t('household.invitations.withdraw.body')
          }
          actions={
            <>
              <Button
                onClick={() => {
                  if (!withdraw.isPending) setTarget(null)
                }}
              >
                {t('household.invitations.withdraw.keep')}
              </Button>
              <Button
                variant="danger"
                loading={withdraw.isPending}
                onClick={() => {
                  withdraw.mutate(target)
                }}
              >
                {target.email === null
                  ? t('household.invitations.withdraw.confirm_link')
                  : t('household.invitations.withdraw.named', { email: target.email })}
              </Button>
            </>
          }
        >
          {withdraw.isError && !isStale(withdraw.error) ? (
            <Banner key={withdraw.submittedAt} tone="danger" announce>
              {say(withdraw.error)}
            </Banner>
          ) : undefined}
        </Dialog>
      )}
    </HouseholdSettingsPage>
  )
}

export function Invitations() {
  const household = useHousehold()
  const held = useEverHeld(useStanding().invitations)
  // Absent: no list, no reason, and nothing asked of the server.
  if (!held) return <NotAvailable home={inHousehold.settings(household.id)} />
  return <Sent />
}
