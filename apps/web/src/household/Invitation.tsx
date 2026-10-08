// What an invitation's link opens (A-24, `/invitation`; PRD 02 §3, FR-HH3, ADR 0011): exactly
// what is being given, shown to whoever holds the link before they have an account, and joined
// or declined by a member who has signed in. It is the first of the product that most of the
// people in a household see (05-screens §A), and it is read on a phone: one column, the
// inviter's own words first, then the role in a sentence and the modules gathered under each
// level, highest first.
//
// It is the one screen that says the word for absence aloud. Everywhere else a module a member
// does not hold leaves no trace (FR-AC2); here the ones that are off are named, under *Not in
// your app at all*, because consent to a boundary needs the whole picture, and after this they
// are never mentioned again. A module the household itself has off is not in the answer, and
// nothing is said of it.
//
// The token is in the link's fragment, read once and taken out of the address (auth/fragment.ts),
// and held in this page's memory while its visitor signs in (invitationToken.ts). The read is
// kept out of this browser's stored cache and out of the page's own once the page is left: its
// key holds the token. A visitor is sent to sign in with this address held for them
// (session/destination.ts) and comes back to the invitation they were reading. A page that is
// loaded again holds no token, as one is on the way back from a provider's sign-in: it says so,
// and that the link is to be opened again.
//
// What it leaves out, and why:
// - No question before *Decline*. It destroys nothing of the member's, and the sentence under
//   the two answers says what it does before it is pressed: it is recorded, the inviter is told,
//   and the invitation is closed for good.
// - Who it was sent to. The preview carries no addressee, so an account with another address
//   than an email invitation's learns it only from the answer's `404`, which is also what an
//   invitation that stopped working a moment ago answers, sent again with a new link or, to a
//   decline, withdrawn or answered: the page says both, names the address signed in with, and
//   does not guess.
// - Which kind it is. The preview does not say, so an expired one is told both lifetimes.
// - That the inviter is told of a joining. The server tells them of a decline (A-25) and of
//   nothing else; the prototype's toast said otherwise.
// - The household's picture, which the server never sets here.
//
// What the server says ended an invitation takes the page's place, each in its own words: a
// `404` to the read is a link cut short or one a newer link replaced, since an invitation sent
// again gets a new one; a `410` is one that expired, or one that was accepted, declined or
// withdrawn. A refusal that leaves it standing is said above the answers, which stay.
//
// A-24's states, for one thing read and two answers asked at once: *loading*, *populated* and
// *error* are the read's. *Empty* has nothing to be: an invitation is one thing, and a link that
// opens none says so in the page's place. *Offline* is the read waiting for a connection, which
// is *could not be read*, and an answer that says the server could not be reached. *Pending* and
// *syncing* are an answer under way, its control busy and nothing kept to be sent later (D-80).
// *Read-only* is the household's and not yet the invitee's: it is what a `402` to an answer
// says. *Absent*, *withdrawn*, *conflicted* and *rejected* have nothing to be before a
// membership exists.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { readState, useNoWithdrawal } from '../account/common.ts'
import settings from '../account/Settings.module.css'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { deviceTimeZone, useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { inHousehold, paths } from '../app/paths.ts'
import { useFragment } from '../auth/fragment.ts'
import { Line, Notices, Screen, Way, Ways } from '../auth/Screen.tsx'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { heldDestination, holdDestination, takeDestination } from '../session/destination.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { Banner, type BannerTone } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import { useToast } from '../ui/Toast.tsx'
import { waitingInvitationsKey, type InvitationForInvitee } from './data.ts'
import { GrantSummary } from './GrantMatrix.tsx'
import { householdsKey, type AccessLevel } from './households.ts'
import styles from './Invitation.module.css'
import {
  forgetInvitationToken,
  heldInvitationToken,
  holdInvitationToken,
} from './invitationToken.ts'
import { isUnverified, Unverified, useMarkUnverified } from './Unverified.tsx'

/** How the server says an invitation is over: nothing answers it any more. */
type Over = 'gone' | 'expired' | 'used'

/** What `error` says ended the invitation, or undefined for a refusal that leaves it standing. */
function overIn(error: unknown): Over | undefined {
  const problem = problemIn(error)
  if (problem?.status === 404) return 'gone'
  if (problem?.code === 'token_already_used') return 'used'
  if (problem?.status === 410) return 'expired'
  return undefined
}

/** What is being given, as the invitee reads it before they answer. */
function Offer({
  invitation,
  zone,
}: {
  readonly invitation: InvitationForInvitee
  /** The zone the day it stops working is said in. */
  readonly zone: string
}) {
  const t = useTranslate()
  const format = useFormat()
  const inviter = invitation.invited_by ?? ''
  const message = (invitation.message ?? '').trim()
  const owner = invitation.role === 'owner'
  const grants: Record<string, AccessLevel> = {}
  for (const { module, level } of invitation.modules ?? []) {
    if (module !== undefined && level !== undefined) grants[module] = level
  }
  return (
    <>
      {message === '' ? null : (
        // Their words are text, whatever they typed: nothing of them is read as markup.
        <figure className={styles.message}>
          <figcaption className={styles.from}>
            {t('household.invitation.message', { inviter })}
          </figcaption>
          <blockquote className={styles.words}>{message}</blockquote>
        </figure>
      )}
      <div className={styles.gives}>
        <div className={styles.role}>
          <h2 className={styles.heading}>
            {owner
              ? t('household.invitation.role.owner.title')
              : t('household.invitation.role.member.title')}
          </h2>
          <p className={settings.text}>
            {owner
              ? t('household.invitation.role.owner.body')
              : t('household.invitation.role.member.body')}
          </p>
        </div>
        <GrantSummary grants={grants} whose="yours" role={owner ? 'owner' : 'member'} />
      </div>
      <Banner tone="info" title={t('household.invitation.later.title')}>
        {t('household.invitation.later.body', { inviter })}
      </Banner>
      {invitation.expires_at === undefined ? null : (
        <p className={settings.note}>
          {t('household.invitation.expires', {
            day: format.dayOf(invitation.expires_at, zone, 'long'),
          })}
        </p>
      )}
    </>
  )
}

export function Invitation() {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const online = useOnline()
  const session = useSession()
  const markUnverified = useMarkUnverified()
  const withdrawn = useNoWithdrawal()

  // The token its link carried, or the one held since a visitor left here to sign in. Read once,
  // as the page opens: what becomes of the held one afterwards is this page's own doing.
  const carried = useFragment().get('token') ?? ''
  const [token] = useState(() => (carried === '' ? (heldInvitationToken() ?? '') : carried))
  useEffect(() => {
    if (token !== '') holdInvitationToken(token)
  }, [token])

  const me = session.state.status === 'member' ? session.state.me : undefined
  const member = me !== undefined
  const visitor = session.state.status === 'visitor'
  // Nobody's account names a zone for a visitor: the device's, said outright.
  const zone = me?.timezone ?? deviceTimeZone()
  const say = useProblemText(zone)

  const join = useMutation({
    ...askedNow,
    mutationFn: async () =>
      unwrap(await api.POST('/me/invitations/{token}/accept', { params: { path: { token } } })),
    // What is so whether or not this page is still drawn when the answer comes.
    onSuccess: () => {
      forgetInvitationToken()
      void queries.invalidateQueries({ queryKey: householdsKey, exact: true })
      void queries.invalidateQueries({ queryKey: waitingInvitationsKey, exact: true })
    },
    onError: (error) => {
      // The server's word on it, whatever this page had read of the account.
      if (isUnverified(error)) markUnverified()
    },
  })
  const decline = useMutation({
    ...askedNow,
    mutationFn: async () => {
      unwrap(await api.POST('/me/invitations/{token}/decline', { params: { path: { token } } }))
    },
    onSuccess: () => {
      forgetInvitationToken()
      void queries.invalidateQueries({ queryKey: waitingInvitationsKey, exact: true })
    },
  })
  // One answer is pressed at a time, and each press puts the other's refusal away.
  const refused = join.error !== null ? join : decline
  const refusal = refused.error
  const answered = overIn(refusal)

  // The invitation as whoever holds its token is shown it, signed in or not, and read again each
  // time the page is looked at again: it may have been withdrawn meanwhile.
  const read = useQuery({
    queryKey: ['invitation', token],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/me/invitations/{token}', { params: { path: { token } }, signal })),
    // The key holds the token, which is half a credential: the answer is kept out of this
    // browser's stored cache, and out of the page's own as soon as nothing draws it. A visitor
    // back from signing in reads it again, which is also what tells them it still stands.
    meta: { persist: false },
    gcTime: 0,
    // An invitation that is answered or over is not read again: asked on the next look at the
    // page, the read would start from nothing and draw a skeleton over what the page just said.
    enabled: (query) =>
      token !== '' &&
      !join.isSuccess &&
      !decline.isSuccess &&
      answered === undefined &&
      overIn(query.state.error) === undefined,
  })
  const invitation = read.data
  const household = invitation?.household_name ?? ''
  const inviter = invitation?.invited_by ?? ''
  const over = overIn(read.error) ?? answered
  // A `404` to an answer, the preview having been read: the page cannot know which of two it is.
  const mismatched = overIn(read.error) === undefined && answered === 'gone'

  // Found over by the server, the token opens nothing more, and is forgotten. One this account
  // could not answer may yet be its addressee's, who is told to sign in as them: it stays held.
  useEffect(() => {
    if (over !== undefined && !mismatched) forgetInvitationToken()
  }, [over, mismatched])

  // The address is held for as long as a visitor has an invitation here to come back to, so
  // that signing in leads back to it (auth/SignIn.tsx). No guard takes it on arrival, this
  // route being drawn for anyone (app/guards.tsx): it is taken here once a member is on the
  // page, and given up where there is nothing left to come back for, or the next sign-in in
  // this tab would be sent here again.
  const awaited = visitor && invitation !== undefined && over === undefined && !decline.isSuccess
  useEffect(() => {
    if (awaited) holdDestination(paths.invitation.path)
    else if (member || heldDestination() === paths.invitation.path) takeDestination()
  }, [awaited, member])

  // An answer that takes away the control that was pressed leaves the focus on nothing: the
  // page's place taken by what became of it, or *Join* by the block that says why not yet, which
  // is drawn once the account is read as unverified and so a moment after the refusal. The focus
  // is put on the screen's own place, whose title is where what happened is said (D-166).
  const unverified = me !== undefined && !me.email_verified
  const place = useRef<HTMLDivElement>(null)
  const settled = join.isError || decline.isError || decline.isSuccess
  useEffect(() => {
    if (!settled) return
    const focused = document.activeElement
    if (focused === null || focused === document.body) place.current?.focus()
  }, [settled, unverified])

  const home = visitor ? (
    <Way to={paths.signIn.path}>{t('auth.way.sign_in')}</Way>
  ) : (
    <Way to={paths.home.path}>{t('ui.not_available.home')}</Way>
  )

  /** A refusal that leaves the invitation standing, said above the answers. */
  const standing = (): { readonly tone: BannerTone; readonly text: string } | undefined => {
    // An address not yet verified is said in the place of *Join*, with the way to verify it.
    if (refusal === null || isUnverified(refusal)) return undefined
    const problem = problemIn(refusal)
    if (problem?.code === 'fair_use_ceiling') {
      return {
        tone: 'warning',
        text: t('household.invitation.refused.full', { household, ceiling: problem.ceiling }),
      }
    }
    // A household that takes no writes is a wait, and nobody's failure (D-120).
    if (problem?.code === 'entitlement_restricted') {
      return {
        tone: 'warning',
        text: t('household.invitation.refused.restricted', { household, inviter }),
      }
    }
    if (problem?.status === 402) {
      return {
        tone: 'warning',
        text: t('household.invitation.refused.read_only', { household, inviter }),
      }
    }
    return { tone: 'danger', text: say(refusal) }
  }

  /** What whoever is looking can do about the invitation, under what it gives. */
  const answers = (): ReactNode => {
    if (me === undefined) {
      switch (session.state.status) {
        case 'visitor':
          return (
            <>
              <Line>{t('household.invitation.visitor.body')}</Line>
              <Ways>
                <Way to={paths.signIn.path}>{t('household.invitation.visitor.sign_in')}</Way>
                <Way to={paths.register.path}>{t('auth.sign_in.register')}</Way>
              </Ways>
              <p className={settings.note}>{t('household.invitation.visitor.return')}</p>
            </>
          )
        case 'unreachable':
          // The invitation was read and the account was not: neither a visitor's ways nor a
          // member's answers are drawn on a guess.
          return (
            <Banner
              tone="warning"
              announce
              actions={
                <Button
                  onClick={() => {
                    session.retry()
                  }}
                >
                  {t('ui.retry')}
                </Button>
              }
            >
              {t('session.unreachable.body')}
            </Banner>
          )
        default:
          // Not yet known who is here: no way of a visitor's is drawn for a member to see go.
          return null
      }
    }
    if (me.is_child === true) {
      return (
        <>
          <Banner tone="neutral" title={t('household.invitation.child.title')}>
            {t('household.invitation.child.body')}
          </Banner>
          <Ways>{home}</Ways>
        </>
      )
    }
    const stands = standing()
    // Busy until the page has left for the household it joined, and no second answer meanwhile.
    const joining = join.isPending || join.isSuccess
    return (
      <>
        <Notices>
          {stands === undefined ? null : (
            // A banner of its own for each refusal, so that a second one is said again.
            <Banner key={refused.submittedAt} tone={stands.tone} announce>
              {stands.text}
            </Banner>
          )}
        </Notices>
        {unverified ? (
          <Unverified
            why={t('household.invitation.unverified')}
            // Said as it arrives where it is the server's answer to *Join*; read in its place
            // where the page opened with it.
            announce={isUnverified(join.error)}
          />
        ) : null}
        <div className={styles.answers}>
          {unverified ? null : (
            <Button
              variant="primary"
              loading={joining}
              aria-disabled={decline.isPending}
              onClick={() => {
                decline.reset()
                join.mutate(undefined, {
                  onSuccess: (membership) => {
                    toast({ message: t('household.invitation.joined', { household }) })
                    void navigate(
                      membership.household_id === undefined
                        ? paths.home.path
                        : inHousehold.home(membership.household_id),
                      { replace: true },
                    )
                  },
                })
              }}
            >
              {t('household.invitation.join', { household })}
            </Button>
          )}
          {/* Declining needs no verified address: it extends no trust to anybody. */}
          <Button
            loading={decline.isPending}
            aria-disabled={joining}
            onClick={() => {
              join.reset()
              decline.mutate()
            }}
          >
            {t('household.invitation.decline')}
          </Button>
        </div>
        <p className={settings.note}>{t('household.invitation.foot', { inviter })}</p>
      </>
    )
  }

  let said: { readonly title: string; readonly lede?: string; readonly rest: ReactNode }
  if (token === '') {
    // Opened bare, cut short in copying, or loaded again: the address holds the token no longer.
    said = {
      title: t('household.invitation.none.title'),
      lede: t('household.invitation.none.body'),
      rest: (
        <>
          <Line>{t('household.invitation.none.next')}</Line>
          <Ways>{home}</Ways>
        </>
      ),
    }
  } else if (decline.isSuccess) {
    said = {
      title: t('household.invitation.declined.title', { household }),
      lede: t('household.invitation.declined.body', { inviter }),
      rest: <Ways>{home}</Ways>,
    }
  } else if (mismatched) {
    said = {
      title: t('household.invitation.mismatch.title'),
      lede: t('household.invitation.mismatch.body', {
        email: me?.email ?? me?.display_name ?? '',
      }),
      rest: (
        <>
          <Line>{t('household.invitation.mismatch.next', { inviter })}</Line>
          {/* Signing out is the shell's, which the account's screens are drawn in. */}
          <Ways>
            <Way to={paths.account.path}>{t('household.invitation.mismatch.account')}</Way>
            {home}
          </Ways>
        </>
      ),
    }
  } else if (over === 'gone') {
    said = {
      title: t('household.invitation.gone.title'),
      lede: t('household.invitation.gone.body'),
      rest: (
        <>
          <Line>{t('household.invitation.gone.next')}</Line>
          <Ways>{home}</Ways>
        </>
      ),
    }
  } else if (over === 'used') {
    // A member who is in the household by now is told no more than anybody: the server says
    // only that it was answered.
    said = {
      title: t('household.invitation.used.title'),
      lede: t('household.invitation.used.body'),
      rest: <Ways>{home}</Ways>,
    }
  } else if (over === 'expired') {
    said = {
      title: t('household.invitation.expired.title'),
      lede: t('household.invitation.expired.body'),
      rest: (
        <>
          <Line>{t('household.invitation.expired.next')}</Line>
          <Ways>{home}</Ways>
        </>
      ),
    }
  } else {
    said = {
      title:
        invitation === undefined
          ? t('household.invitation.title')
          : t('household.invitation.invited.title', { inviter, household }),
      ...(invitation === undefined ? {} : { lede: t('household.invitation.invited.lede') }),
      rest: (
        <StateFrame
          state={readState(read, online)}
          skeleton={
            <Skeleton
              bars={[
                [55, 1.25],
                [90, 1],
                [70, 1],
                [45, 1],
                [80, 1],
                [45, 1],
                [80, 1],
                [100, 2.75],
                [100, 2.75],
              ]}
            />
          }
          // An invitation is one thing: there is no list of them to be empty.
          empty={null}
          texts={{
            error: {
              title: t('household.invitation.unread.title'),
              // A limit says when it clears; anything else, that nothing was changed.
              text:
                problemIn(read.error)?.status === 429
                  ? say(read.error)
                  : t('household.invitation.unread.body'),
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
          {() => {
            if (invitation === undefined) return null
            const under = answers()
            return (
              <div className={styles.body}>
                <Offer invitation={invitation} zone={zone} />
                {under === null ? null : <div className={styles.answering}>{under}</div>}
              </div>
            )
          }}
        </StateFrame>
      ),
    }
  }
  return (
    <div ref={place} tabIndex={-1} className={styles.place}>
      {/* One screen for all it says, so that what changes is its words, and they are said. */}
      <Screen live title={said.title} lede={said.lede}>
        {said.rest}
      </Screen>
    </div>
  )
}
