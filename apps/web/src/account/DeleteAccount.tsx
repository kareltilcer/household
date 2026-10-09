// Deleting an account (A-20, `/account/delete`; PRD 05 §4 FR-PR3 and FR-PR4, D-136, D-137;
// 03-patterns §5): what it does to each of the member's households is resolved and stated before
// the button, and never met one refusal at a time. A deletion that reveals its blockers serially
// is how people come to believe they deleted an account they still have.
//
// It says what the server does, which is not what the prototype drew:
//
// - The account is switched off at once and signs nobody in. For thirty days the link in the
//   email cancels the deletion, signed out; signing in does not, there being no signing in.
// - The confirmation is the password, or, for an account that has none, its own address typed
//   out. A session alone must not delete an account.
// - The only owner of a household with other people in it has two ways on, and both are offered:
//   make someone else an owner, which is said in words, the members' screen not being built yet
//   (plan item 26), or name the household to be deleted with the account, by a box that names it.
// - A payer is held until billing is handed over or the subscription cancelled.
// - A suspended household the member owns answers nobody, so who else is in it cannot be read
//   (D-115): the screen says so and offers its box all the same, the one way its only owner has
//   on, and the server says where they stand in it (D-163).
// - An owner whose own account is scheduled for deletion counts as no owner (D-137), and no list
//   a member reads says whose is: the other owner of their household is told their membership
//   ends, and is refused. What the refusal names as theirs alone to own is the server's word on
//   it, kept beside what is read again and drawn as that, with its box (D-173).
// - What the member added to a household that goes on stays there as a former member's (PRD 05
//   §4): the prototype has it stay under their name, which the erasure does not leave.
// - Counts of what a household holds have no source a member's own page can read, and are left
//   out.
//
// The server resolves the households again when it is asked and answers with every one that
// stands in the way at once (`409`), which the screen names; what it read is then read again.
// Once the deletion is scheduled every session has ended, this one too: the screen goes to the
// page that says when the account closes and offers to keep it, and the app asks who is signed
// in only once this screen has gone, since the shell would send a visitor it still drew to sign
// in instead. A child profile deletes nothing: an owner removes it (D-104).
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { paths } from '../app/paths.ts'
import { useRefusedField } from '../auth/fields.tsx'
import { householdsKey, membersKey, useHouseholds } from '../household/households.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe, useSession, type Me } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Checkbox } from '../ui/Choice.tsx'
import { cx } from '../ui/cx.ts'
import { PasswordField, TextField } from '../ui/Field.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import { readState, refocus, useNoWithdrawal, useOwnZone, type Read } from './common.ts'
import { useOnline } from '../ui/online.ts'
import { blockedBy, blocks, standingOf, type Standing } from './deletion.ts'
import { Section, SettingsPage } from './Page.tsx'
import styles from './Settings.module.css'

/** How long an account's deletion can still be cancelled: thirty days (FR-PR4). */
const window30 = 30 * 24 * 60 * 60 * 1000

function Situation({
  standing,
  readAgain,
  chosen,
  onChoose,
}: {
  readonly standing: Standing
  /** Whether its members were read again since the server last refused a deletion. */
  readonly readAgain: boolean
  readonly chosen: boolean
  readonly onChoose: (chosen: boolean) => void
}) {
  const t = useTranslate()
  const name = standing.household.name ?? ''
  const renews = <span className={styles.text}>{t('account.delete.renews')}</span>
  return (
    <li className={styles.situation}>
      <span className={styles.strong}>{name}</span>
      {standing.kind === 'alone' ? (
        <>
          <span className={styles.text}>{t('account.delete.alone')}</span>
          {standing.payer ? renews : null}
        </>
      ) : null}
      {standing.kind === 'sole' ? (
        <>
          <span className={styles.text}>{t('account.delete.sole.body')}</span>
          {/* Read again, the members still name another owner: one the server did not count. */}
          {standing.uncounted && readAgain ? (
            <span className={styles.text}>{t('household.leave.last_owner.deleting')}</span>
          ) : null}
          <Checkbox
            label={t('account.delete.sole.choose', { household: name })}
            checked={chosen}
            onChange={(event) => {
              onChoose(event.currentTarget.checked)
            }}
          />
          {chosen ? <span className={styles.text}>{t('account.delete.sole.chosen')}</span> : null}
          {standing.payer ? (
            chosen ? (
              renews
            ) : (
              <span className={styles.text}>{t('account.delete.sole.payer')}</span>
            )
          ) : null}
        </>
      ) : null}
      {standing.kind === 'payer' ? (
        <span className={styles.text}>{t('account.delete.payer')}</span>
      ) : null}
      {standing.kind === 'leaves' ? (
        <span className={styles.text}>{t('account.delete.leaves')}</span>
      ) : null}
      {standing.kind === 'unread' ? (
        <>
          <span className={styles.text}>{t('account.delete.unread')}</span>
          <Checkbox
            label={t('account.delete.sole.choose', { household: name })}
            checked={chosen}
            onChange={(event) => {
              onChoose(event.currentTarget.checked)
            }}
          />
          {chosen ? <span className={styles.text}>{t('account.delete.sole.chosen')}</span> : null}
        </>
      ) : null}
    </li>
  )
}

function Deletion({ me }: { readonly me: Me }) {
  const t = useTranslate()
  const api = useApi()
  const navigate = useNavigate()
  const session = useSession()
  const queries = useQueryClient()
  const format = useFormat()
  const online = useOnline()
  const zone = useOwnZone()
  const say = useProblemText(zone)
  const withdrawn = useNoWithdrawal()

  const households = useHouseholds()
  const list = households.data
  // Only an owner can be a household's last owner, or its payer: the rest need no more read.
  // Nor is a suspended household read, which answers `404` on every route (D-115), its members'
  // among them: asked for, they would hold this screen at a read that never comes.
  const owned = (list ?? []).filter(
    (household) => household.my_role === 'owner' && household.entitlement?.state !== 'suspended',
  )
  const members = useQueries({
    queries: owned.map((household) => ({
      queryKey: membersKey(household.id),
      queryFn: async ({ signal }: { readonly signal: AbortSignal }) =>
        unwrap(
          await api.GET('/households/{household_id}/members', {
            params: { path: { household_id: household.id } },
            signal,
          }),
        ).items ?? [],
    })),
  })
  const reads = [households, ...members]
  const ready = list !== undefined && members.every((each) => each.data !== undefined)
  const read: Read = {
    data: ready ? list : undefined,
    isError: reads.some((each) => each.isError && each.data === undefined),
    fetchStatus: reads.some((each) => each.data === undefined && each.fetchStatus === 'paused')
      ? 'paused'
      : 'idle',
  }
  // The households the server named, refusing a press, as the member's alone to own: its word
  // on where they stand there, kept beside what the page reads again after every refusal
  // (D-173). An owner whose own account is scheduled for deletion counts as none (D-137) and is
  // listed as an owner all the same, so the members read again would take away the box the
  // refusal asks to be ticked. It stands until the server says otherwise.
  const [named, setNamed] = useState<ReadonlySet<string>>(new Set())
  // Whether the households were read again since it last refused: what their members say then
  // is how they stand, and no longer what somebody changed while this page was open.
  const [readAgain, setReadAgain] = useState(false)
  const standings = ready
    ? list.map((household) =>
        standingOf(
          household,
          me.id,
          members[owned.indexOf(household)]?.data,
          named.has(household.id.toLowerCase()),
        ),
      )
    : []

  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [proof, setProof] = useState('')
  // What was typed that is not sent, set anew each time: nothing, or an address not the account's.
  const [unproven, setUnproven] = useState<{ readonly fault: 'missing' | 'wrong' }>()
  // The day the page was opened on: the date on the button does not move under a press.
  const [opened] = useState(() => Date.now())
  const held = standings.some((standing) => blocks(standing, chosen))

  const reread = () => queries.invalidateQueries({ queryKey: householdsKey })
  // Whether the deletion was scheduled, and every session ended with it. The app is told to ask
  // who is signed in as this screen leaves the page, and not a moment sooner: the router draws
  // the next page when it is ready to, and until it has, the answer that nobody is signed in
  // would have the shell around this screen send its visitor to sign in.
  const scheduled = useRef(false)
  const ask = useRef(session.retry)
  useEffect(() => {
    ask.current = session.retry
  }, [session.retry])
  useEffect(
    () => () => {
      if (scheduled.current) ask.current()
    },
    [],
  )
  const schedule = useMutation({
    ...askedNow,
    mutationFn: async (body: {
      readonly password_or_confirmation: string
      readonly delete_sole_owned_households: string[]
    }) => unwrap(await api.POST('/me/deletion', { body })),
    onSuccess: (request) => {
      const kept = new URLSearchParams()
      if (typeof request.cancel_token === 'string') kept.set('token', request.cancel_token)
      if (request.executes_at !== undefined) kept.set('at', request.executes_at)
      // Every session has ended, this one too. The page that says when the account closes and
      // offers to keep it is drawn for anyone, signed in or not.
      scheduled.current = true
      void navigate(`${paths.deletionCancel.path}#${kept.toString()}`, { replace: true })
    },
    onError: (error) => {
      const refusal = problemIn(error)
      if (refusal?.status !== 409 && refusal?.status !== 422) return
      // What a `409` names as the member's alone to own is kept with what one named before: a
      // household whose box was ticked since is named by none after it. A `422` says that one
      // named to go with the account is not theirs alone to delete, and puts the server's
      // earlier word away with the page's: the next press is answered as they stand.
      const sole =
        refusal.status === 409
          ? blockedBy(refusal).soleOwned.map((household) => household.id.toLowerCase())
          : undefined
      setNamed((before) => (sole === undefined ? new Set() : new Set([...before, ...sole])))
      // The households are not as this page read them: they are read again.
      setReadAgain(false)
      void reread().then(() => {
        setReadAgain(true)
      })
    },
  })

  const password = (me.credentials ?? []).includes('password')
  const email = me.email ?? ''
  const form = useRefusedField(unproven ?? schedule.error)
  const problem = problemIn(schedule.error)
  const wrong = unproven?.fault === 'wrong' || problem?.code === 'invalid_credentials'
  const proofError =
    unproven?.fault === 'missing'
      ? password
        ? t('account.password.missing')
        : t('account.delete.confirm.email_missing')
      : wrong
        ? password
          ? t('account.password.wrong')
          : t('account.delete.confirm.email_wrong')
        : undefined
  const blocked = problem?.code === 'account_deletion_blocked'
  const refused = blocked ? blockedBy(problem) : undefined
  // The server's answer to a press took the control away, at once or as the households were
  // read again: the focus it held goes to their list, where what stands in the way is drawn.
  const view = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (blocked && held) refocus(view.current)
  }, [blocked, held])
  const other =
    schedule.isError && problem?.code !== 'invalid_credentials' && refused === undefined
      ? problem?.status === 403
        ? t('account.delete.forbidden')
        : problem?.status === 422
          ? t('account.delete.changed')
          : say(schedule.error)
      : undefined
  const nameOf = (id: string) =>
    (list ?? []).find((household) => household.id.toLowerCase() === id.toLowerCase())?.name

  const keep = (
    <Button
      onClick={() => {
        void navigate(paths.account.path)
      }}
    >
      {t('account.delete.keep')}
    </Button>
  )

  return (
    <SettingsPage title={t('account.delete.title')} lead={t('account.delete.lead')}>
      <Section title={t('account.delete.households.title')}>
        <StateFrame
          state={readState(read, online, ready && list.length === 0)}
          skeleton={
            <Skeleton
              bars={[
                [35, 1.25],
                [90, 1],
                [40, 1.25],
                [80, 1],
              ]}
            />
          }
          empty={<p className={styles.text}>{t('account.delete.households.none')}</p>}
          texts={{
            error: {
              title: t('shell.households.error.title'),
              text: t('account.delete.households.error'),
              actions: (
                <Button
                  onClick={() => {
                    for (const each of reads) if (each.data === undefined) void each.refetch()
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
            <ul ref={view} tabIndex={-1} className={cx(styles.situations, styles.view)} role="list">
              {standings.map((standing) => (
                <Situation
                  key={standing.household.id}
                  standing={standing}
                  readAgain={readAgain}
                  chosen={chosen.has(standing.household.id)}
                  onChoose={(ticked) => {
                    const next = new Set(chosen)
                    if (ticked) next.add(standing.household.id)
                    else next.delete(standing.household.id)
                    setChosen(next)
                  }}
                />
              ))}
            </ul>
          )}
        </StateFrame>
      </Section>

      {ready ? (
        <>
          <Section title={t('account.delete.account.title')}>
            <p className={styles.text}>{t('account.delete.account.off')}</p>
            <p className={styles.text}>{t('account.delete.account.gone')}</p>
            <p className={styles.note}>{t('account.delete.account.backups')}</p>
          </Section>

          <Section title={t('account.delete.confirm.title')}>
            {refused === undefined ? null : (
              <Banner tone="danger" title={t('account.delete.blocked.title')} announce>
                <ul role="list">
                  {refused.soleOwned.map((household) => (
                    <li key={`sole-${household.id}`}>
                      {t('account.delete.blocked.sole', { household: household.name })}
                    </li>
                  ))}
                  {refused.payerFor.map((id) => (
                    <li key={`payer-${id}`}>
                      {t('account.delete.blocked.payer', { household: nameOf(id) ?? '' })}
                    </li>
                  ))}
                </ul>
              </Banner>
            )}
            {held ? (
              // No button that could only be refused: what it waits for is said in its place.
              <>
                <Banner tone="warning">{t('account.delete.waits')}</Banner>
                <div className={styles.actions}>{keep}</div>
              </>
            ) : (
              <form
                ref={form}
                className={styles.form}
                noValidate
                onSubmit={(event) => {
                  event.preventDefault()
                  const typed = password ? proof : proof.trim()
                  schedule.reset()
                  if (typed === '') {
                    setUnproven({ fault: 'missing' })
                    return
                  }
                  // An address that is not the account's is not sent to be counted as a failed
                  // sign-in: it is said here.
                  if (!password && typed.toLowerCase() !== email.toLowerCase()) {
                    setUnproven({ fault: 'wrong' })
                    return
                  }
                  setUnproven(undefined)
                  schedule.mutate({
                    password_or_confirmation: typed,
                    delete_sole_owned_households: standings.flatMap((standing) =>
                      (standing.kind === 'sole' || standing.kind === 'unread') &&
                      chosen.has(standing.household.id)
                        ? [standing.household.id]
                        : [],
                    ),
                  })
                }}
              >
                {password ? (
                  <>
                    {/* Whose password it is, for a password manager: drawn nowhere. */}
                    <input type="text" hidden readOnly autoComplete="username" value={email} />
                    <PasswordField
                      label={t('account.password.label')}
                      help={t('account.delete.confirm.password_help')}
                      autoComplete="current-password"
                      value={proof}
                      error={proofError}
                      onChange={(event) => {
                        setProof(event.currentTarget.value)
                      }}
                    />
                  </>
                ) : (
                  <TextField
                    type="email"
                    label={t('account.delete.confirm.email_label')}
                    help={t('account.delete.confirm.email_help', { email })}
                    autoComplete="off"
                    value={proof}
                    error={proofError}
                    onChange={(event) => {
                      setProof(event.currentTarget.value)
                    }}
                  />
                )}
                {other === undefined ? null : (
                  <Banner tone="danger" announce>
                    {other}
                  </Banner>
                )}
                <div className={styles.actions}>
                  {keep}
                  <Button
                    type="submit"
                    variant="danger"
                    // Busy until the page that says when the account closes has opened.
                    loading={schedule.isPending || schedule.isSuccess}
                  >
                    {t('account.delete.schedule', {
                      date: format.dayOf(new Date(opened + window30), zone, 'long'),
                    })}
                  </Button>
                </div>
              </form>
            )}
          </Section>
        </>
      ) : null}
    </SettingsPage>
  )
}

export function DeleteAccount() {
  const t = useTranslate()
  const me = useMe()
  if (me.is_child === true) {
    return (
      <SettingsPage title={t('account.delete.title')} lead={t('account.delete.child')}>
        {null}
      </SettingsPage>
    )
  }
  return <Deletion me={me} />
}
