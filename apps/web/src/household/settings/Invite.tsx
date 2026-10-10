// The invitation composer (A-23, `/households/{id}/settings/invitations/new`; PRD 02 §3, FR-HH2;
// PRD 17 §2, FR-HA4): seventeen decisions, already answered. An owner says how the invitation
// travels, as what role, and the whole of what the person gets, before the person exists, and
// what the invitee accepts is what they get.
//
// - By email it is named: one address, 14 days, and only the account with that address joins by
//   it. By a link it is whoever holds it, up to twelve of them, for 72 hours. A link's address
//   is answered once and kept nowhere (the server keeps its hash), so it is drawn once, in the
//   form's place, and the screen says so before the link is made as well as after.
// - The role is a member or an owner. A child profile is made by an owner and never invited
//   (D-17, D-103): the prototype's third chip is a sentence and the way to where one is made.
// - A member's matrix starts at the defaults (FR-AC3), which both sides compute, and says which
//   rows were changed from them. An owner holds everything, so there is no matrix to fill in;
//   the one that was being filled in is kept for when the role is changed back.
// - Inviting waits for the owner's own verified address (FR-ID1), and the block explains itself
//   where it blocks (A-4): in the form's place, from the first for an account read as
//   unverified, and as the server's answer for one this page had read otherwise.
// - It is sent on the server or not at all (D-80, data.ts): asked at once, and a send that
//   fails says that nothing was sent and keeps everything as it was set. The invitation's id is
//   made once for a composing, so that asking again after an answer that was lost names the
//   same invitation: the server then says it has it, and the screen says to look in the list,
//   a link made so being shown to nobody.
//
// What the prototype drew and the contract has none of is left out: *their name*, an invitation
// naming its invitee by the address alone; *save and send later*, there being no drafts; and the
// 14 days it gave a link. The starting dashboard layout the contract takes (FR-DB4) is left to
// the item that builds Dashboard's screens, which is where a layout can be drawn.
//
// A-23's states. *Loading* is the household's modules being read, which only says which rows
// are off for everybody: the form does not wait for it. *Empty* has nothing to be, the defaults
// filling the matrix before anybody touches it, so the prototype's *no modules are shared yet*
// is never drawn. *Populated* is the form. *Error* is a send that failed, said beside the field
// it names or above the button that was pressed. *Offline* is the form with the sentence that
// an invitation needs a connection as it is sent, and a send that says it could not reach the
// server. *Absent* is the member who holds nothing on household settings, drawn *not
// available*; one who reads the invitations and is no owner is told whose it is to invite.
// *Withdrawn* is that access lost while the screen was open. *Read-only* is the sentence that
// inviting is a write. *Pending*, *syncing*, *conflicted* and *rejected* have nothing to be: an
// invitation is never a change held to be sent later, and two owners cannot disagree over one
// that does not exist yet.
import { newId, type components } from '@household/api'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import account from '../../account/Settings.module.css'
import { copyText, refocus } from '../../account/common.ts'
import { useApi } from '../../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../../api/problem.ts'
import { askedNow } from '../../api/query.ts'
import { NotAvailable } from '../../app/NotAvailable.tsx'
import { inHousehold } from '../../app/paths.ts'
import {
  checkEmail,
  fieldCodes,
  isMadeAlready,
  useRefusedField,
  type EmailFault,
} from '../../auth/fields.tsx'
import { useFormat, useTranslate } from '../../i18n/I18nProvider.tsx'
import { useMe } from '../../session/SessionProvider.tsx'
import { Banner } from '../../ui/Banner.tsx'
import { Button } from '../../ui/Button.tsx'
import { RadioGroup } from '../../ui/Choice.tsx'
import { Stepper, TextArea, TextField } from '../../ui/Field.tsx'
import { useToast } from '../../ui/Toast.tsx'
import { cx } from '../../ui/cx.ts'
import { useOnline } from '../../ui/online.ts'
import { useOff, useOwnerNames, useReread, type Invitation } from '../data.ts'
import { GrantMatrix } from '../GrantMatrix.tsx'
import { changedModules, defaultsFor, matrixOrder, type Levels } from '../grants.ts'
import { useHousehold } from '../HouseholdContext.tsx'
import { useRoleWord, type AccessLevel, type ModuleKey } from '../households.ts'
import { useTimeZone } from '../timezone.ts'
import { isUnverified, Unverified, useMarkUnverified } from '../Unverified.tsx'
import { readAgain, useRefusal } from './invitations.ts'
import styles from './Invitations.module.css'
import { HouseholdSettingsPage, Section, useEverHeld, useStanding } from './Page.tsx'
import { isStandingRefusal } from './profile.ts'

type InvitationCreate = components['schemas']['InvitationCreate']
type Kind = 'email' | 'link'
type Role = 'owner' | 'member'

/** What a member starts with (FR-AC3): what the matrix begins at, and is held against. */
const defaults = defaultsFor('member')

/** The most accounts a link may bring in: the members' fair-use ceiling (FR-HH2). */
const mostUses = 12

/** The contract's longest message. */
const longestMessage = 500

/**
 * Whether the server says it has this invitation already: the first request for it took effect,
 * and its answer never reached this page. A request the transport sent again is told so by its
 * key, and one pressed again by the invitation's own id.
 */
function isAnswerLost(error: unknown): boolean {
  return problemIn(error)?.code === 'idempotency_in_progress' || isMadeAlready(error)
}

function WhatAMemberGets({
  levels,
  errors,
  onChange,
  onReset,
}: {
  readonly levels: Levels
  readonly errors: ReadonlyMap<ModuleKey, string>
  readonly onChange: (module: ModuleKey, level: AccessLevel) => void
  readonly onReset: () => void
}) {
  const t = useTranslate()
  const format = useFormat()
  const household = useHousehold()
  // Which modules the household has off: the matrix is filled in while that is being read.
  const off = useOff(household.id)
  const counts = useRef<HTMLParagraphElement>(null)
  const held = (level: AccessLevel) =>
    format.number(matrixOrder.filter((module) => levels[module] === level).length)
  return (
    <>
      {/* One sentence whose numbers change in place. It takes the focus when the defaults are put
          back: the control that did it goes, nothing differing from them any more. */}
      <p ref={counts} tabIndex={-1} className={styles.counts}>
        {t('household.invite.grants.counts', {
          manage: held('manage'),
          contribute: held('contribute'),
          view: held('view'),
          none: held('none'),
        })}
      </p>
      {changedModules(defaults, levels).length === 0 ? null : (
        <div className={account.actions}>
          <Button
            onClick={() => {
              onReset()
              counts.current?.focus()
            }}
          >
            {t('household.invite.grants.reset')}
          </Button>
        </div>
      )}
      <GrantMatrix
        label={t('household.invite.grants.title')}
        role="member"
        levels={levels}
        from={defaults}
        off={off}
        errors={errors}
        onChange={onChange}
      />
      <p className={account.note}>{t('household.invite.grants.line')}</p>
    </>
  )
}

/** A link, as it was made: its address, shown this once, and what it is good for. */
function Made({ url, made }: { readonly url: string; readonly made: Invitation }) {
  const t = useTranslate()
  const format = useFormat()
  const toast = useToast()
  const household = useHousehold()
  const zone = useTimeZone()
  // The form went with the press that made the link, and the focus with the form: it is put on
  // the link itself, which is read with the sentence that it is shown only once.
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    field.current?.focus()
  }, [])
  return (
    <Section title={t('household.invite.made.title')}>
      <div className={account.form}>
        <TextField
          ref={field}
          label={t('household.invite.made.label')}
          help={t('household.invite.made.once')}
          readOnly
          value={url}
          onFocus={(event) => {
            event.currentTarget.select()
          }}
        />
        <p className={account.text}>
          {t('household.invite.made.uses', { count: made.max_uses ?? 1 })}
        </p>
        {made.expires_at === undefined ? null : (
          <p className={account.text}>
            {t('household.invite.made.until', { when: format.instant(made.expires_at, zone) })}
          </p>
        )}
        <div className={account.actions}>
          <Button
            variant="primary"
            onClick={() => {
              copyText(url).then(
                () => {
                  toast({ message: t('household.invite.made.copied') })
                },
                () => {
                  toast({ message: t('household.invite.made.copy_failed') })
                },
              )
            }}
          >
            {t('household.invite.made.copy')}
          </Button>
          <Link className={account.link} to={inHousehold.invitations(household.id)}>
            {t('household.invite.made.done')}
          </Link>
        </div>
      </div>
    </Section>
  )
}

/** Whose it is to invite, for a member who reads the invitations and is no owner. */
function ForAnOwner() {
  const t = useTranslate()
  const format = useFormat()
  const owners = useOwnerNames(useHousehold().id)
  return (
    <p className={account.text}>
      {owners.length === 0
        ? t('household.invite.owner_only')
        : t('household.invite.owners', { owners: format.list(owners) })}
    </p>
  )
}

/** What the screen draws: the form, or what stands in its place. */
type Shown = 'form' | 'made' | 'unverified' | 'reader' | 'readonly' | 'withdrawn'

function Composer() {
  const t = useTranslate()
  const api = useApi()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const household = useHousehold()
  const standing = useStanding()
  const me = useMe()
  const online = useOnline()
  const refusal = useRefusal(useTimeZone())
  const reread = useReread(household.id)
  const markUnverified = useMarkUnverified()
  const word = useRoleWord()
  const formId = useId()

  // What a declined invitation's notice handed over, read once: the address, the role and the
  // levels of the one that was declined, for an owner to change what gave its invitee pause.
  const [again] = useState(() => readAgain(location.state))
  // The invitation's id, for as long as it is being composed: asked again, it is the same one.
  const [id, setId] = useState(newId)
  const [kind, setKind] = useState<Kind>(again?.kind ?? 'email')
  const [email, setEmail] = useState(again?.email ?? '')
  const [uses, setUses] = useState(1)
  const [role, setRole] = useState<Role>(again?.role ?? 'member')
  const [message, setMessage] = useState('')
  const [levels, setLevels] = useState<Levels>(again?.levels ?? defaults)
  // Set, anew, each time an address that cannot be one is submitted: it is not sent.
  const [unsent, setUnsent] = useState<{ readonly fault: EmailFault }>()
  // Set, anew, each time the server says it holds an invitation whose answer never came.
  const [lost, setLost] = useState<{ readonly count: number; readonly kind: Kind }>()
  const [made, setMade] = useState<{ readonly url: string; readonly invitation: Invitation }>()

  const lose = (of: Kind) => {
    setLost((was) => ({ count: (was?.count ?? 0) + 1, kind: of }))
    // Whatever is sent from here on is another invitation, and is named as one.
    setId(newId())
    void reread()
  }
  const send = useMutation({
    ...askedNow,
    mutationFn: async (body: InvitationCreate) =>
      unwrap(
        await api.POST('/households/{household_id}/invitations', {
          params: { path: { household_id: household.id } },
          body,
        }),
      ),
    // What is so whether or not this screen is still drawn when the answer comes: where it
    // leads is the press's own to say (below), to an owner who is still here.
    onSuccess: (sent, body) => {
      if (body.kind === 'email') {
        void reread()
        toast({ message: t('household.invite.sent', { email: body.email ?? '' }) })
        return
      }
      const url = sent.url ?? ''
      // A link made and answered without its address is one nobody can use.
      if (url === '') lose('link')
      else {
        void reread()
        setMade({ url, invitation: sent })
      }
    },
    onError: (error, body) => {
      if (isUnverified(error)) {
        // The server's word on it, whatever this page had read: the block takes the form's
        // place, and lifts when the account is read as verified. What was set is kept.
        markUnverified()
      } else if (isAnswerLost(error)) lose(body.kind)
      else if (isStandingRefusal(error)) void reread()
    },
  })

  const codes = fieldCodes(send.error)
  const refusedAddress = codes.get('/email')
  // An address the server refused though it read as one here is one an invitation already waits
  // for, or a member's: the contract answers `invalid` for both, and a malformed one by the
  // keyword it failed.
  const address: EmailFault | 'taken' | undefined =
    unsent?.fault ??
    (refusedAddress === undefined
      ? undefined
      : refusedAddress === 'required'
        ? 'required'
        : refusedAddress === 'invalid'
          ? 'taken'
          : 'invalid')
  const rows = new Map<ModuleKey, string>()
  for (const module of matrixOrder) {
    if (codes.has(`/grants/${module}`)) rows.set(module, t('household.invite.grants.refused'))
  }
  // Whether the refusal is one of a field of the form: one that names none is said above the
  // button, as any other failure is. It is asked of what was refused, and not of what the form
  // draws now: a field put away since, by another way of inviting or another role, takes its
  // sentence with it, and nothing is said anew of a press that was answered already. Neither
  // is chosen while a send is on its way, so the answer finds the fields it was sent from.
  const beside =
    address !== undefined || codes.has('/message') || codes.has('/max_uses') || rows.size > 0
  const form = useRefusedField(unsent ?? send.error)

  const gone = problemIn(send.error)?.code === 'not_found'
  const shown: Shown =
    made !== undefined
      ? 'made'
      : !standing.invitations || gone
        ? 'withdrawn'
        : !standing.writes
          ? 'readonly'
          : !standing.owner
            ? 'reader'
            : !me.email_verified
              ? 'unverified'
              : 'form'

  // What held the focus goes with the form when something takes its place, a refusal that
  // changed where the member stands or a block that arrived: the focus is put on the screen's
  // own place, the element around whatever is drawn, and not dropped to the page.
  const view = useRef<HTMLDivElement>(null)
  const drawn = useRef(shown)
  useEffect(() => {
    if (drawn.current === shown) return
    drawn.current = shown
    refocus(view.current)
  }, [shown])

  const toList = (
    <Link className={account.link} to={inHousehold.invitations(household.id)}>
      {t('household.invite.to_list')}
    </Link>
  )

  let body: ReactNode
  let foot: ReactNode = toList
  switch (shown) {
    case 'made':
      // Its own way on, *Done*, stands with the link.
      body = made === undefined ? null : <Made url={made.url} made={made.invitation} />
      foot = null
      break
    case 'withdrawn':
      // Said as it arrives: the member was here when their access changed.
      body = (
        <Banner tone="neutral" announce>
          {t('household.settings.withdrawn')}
        </Banner>
      )
      foot = (
        <Link className={account.link} to={inHousehold.settings(household.id)}>
          {t('module.admin.name')}
        </Link>
      )
      break
    case 'readonly': {
      const restricted = household.entitlement?.state === 'restricted'
      body = (
        <Banner
          tone="warning"
          title={
            restricted
              ? t('household.invite.restricted.title')
              : t('household.invite.read_only.title')
          }
        >
          {restricted
            ? t('household.invite.restricted.body')
            : t('household.invite.read_only.body')}
        </Banner>
      )
      break
    }
    case 'reader':
      body = <ForAnOwner />
      break
    case 'unverified':
      body = (
        <Unverified why={t('household.invite.unverified')} announce={isUnverified(send.error)} />
      )
      break
    case 'form':
      body = (
        <form
          id={formId}
          ref={form}
          className={account.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            const to = email.trim()
            const fault = kind === 'email' ? checkEmail(to) : undefined
            const words = message.trim()
            send.reset()
            setLost(undefined)
            setUnsent(fault === undefined ? undefined : { fault })
            if (fault !== undefined) return
            send.mutate(
              {
                id,
                kind,
                role,
                ...(kind === 'email' ? { email: to } : { max_uses: uses }),
                // An owner holds everything: the server sets it, and is sent no levels to refuse.
                ...(role === 'member' ? { grants: levels } : {}),
                ...(kind === 'email' && words !== '' ? { message: words } : {}),
              },
              {
                // On to the list, from this screen alone: an owner who went on to another while
                // the answer was on its way is told there, and stays where they went.
                onSuccess: (_sent, body) => {
                  if (body.kind === 'email') void navigate(inHousehold.invitations(household.id))
                },
              },
            )
          }}
        >
          {online ? null : (
            <Banner tone="warning" title={t('household.invite.offline.title')}>
              {t('household.invite.offline.body')}
            </Banner>
          )}
          <div className={account.group}>
            <RadioGroup
              label={t('household.invite.how.label')}
              value={kind}
              options={[
                { value: 'email', label: t('household.invite.how.email') },
                { value: 'link', label: t('household.invite.how.link') },
              ]}
              onChange={(value) => {
                // Not while a send is on its way: its answer is about the form as it was sent,
                // and a field put away meanwhile would take its refusal with it, unsaid.
                if (send.isPending) return
                if (value === 'email' || value === 'link') setKind(value)
              }}
            />
            <p className={account.note}>
              {kind === 'email'
                ? t('household.invite.how.email_note')
                : t('household.invite.how.link_note')}
            </p>
          </div>
          {kind === 'email' ? (
            <div className={account.group}>
              <TextField
                label={t('household.invite.email.label')}
                type="email"
                inputMode="email"
                // Somebody else's address: the browser's own is no suggestion for it.
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                // The contract's longest address.
                maxLength={254}
                value={email}
                error={
                  address === undefined
                    ? undefined
                    : address === 'required'
                      ? t('household.invite.email.required')
                      : address === 'taken'
                        ? t('household.invite.email.taken')
                        : t('household.invite.email.invalid')
                }
                onChange={(event) => {
                  setEmail(event.currentTarget.value)
                }}
              />
              {address === 'taken' ? toList : null}
            </div>
          ) : (
            <Stepper
              label={t('household.invite.uses.label')}
              help={t('household.invite.uses.help')}
              error={codes.has('/max_uses') ? t('household.invite.uses.refused') : undefined}
              min={1}
              max={mostUses}
              value={uses}
              onChange={setUses}
            />
          )}
          <div className={account.group}>
            <RadioGroup
              label={t('household.invite.role.label')}
              value={role}
              options={[
                { value: 'member', label: word('member') },
                { value: 'owner', label: word('owner') },
              ]}
              onChange={(value) => {
                if (send.isPending) return
                if (value === 'member' || value === 'owner') setRole(value)
              }}
            />
            <p className={account.note}>
              {role === 'owner'
                ? t('household.invite.role.owner_note')
                : t('household.invite.role.member_note')}
            </p>
            <p className={account.note}>{t('household.invite.role.child')}</p>
            <Link className={account.link} to={inHousehold.members(household.id)}>
              {t('household.invite.role.child_link')}
            </Link>
          </div>
          {kind === 'email' ? (
            <TextArea
              label={t('household.invite.message.label')}
              help={t('household.invite.message.help')}
              error={codes.has('/message') ? t('household.invite.message.refused') : undefined}
              maxLength={longestMessage}
              value={message}
              onChange={(event) => {
                setMessage(event.currentTarget.value)
              }}
            />
          ) : null}
          <Section title={t('household.invite.grants.title')}>
            {role === 'owner' ? (
              <p className={account.text}>{t('household.invite.grants.owner')}</p>
            ) : (
              <WhatAMemberGets
                levels={levels}
                errors={rows}
                onChange={(module, level) => {
                  setLevels((now) => ({ ...now, [module]: level }))
                }}
                onReset={() => {
                  setLevels(defaults)
                }}
              />
            )}
          </Section>
        </form>
      )
      foot = (
        <div className={account.actions}>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            // Busy, once an invitation is sent, until its list has taken this screen's place.
            loading={send.isPending || (send.isSuccess && lost === undefined)}
          >
            {kind === 'email' ? t('household.invite.send') : t('household.invite.make')}
          </Button>
          <Link className={account.link} to={inHousehold.invitations(household.id)}>
            {t('account.cancel')}
          </Link>
        </div>
      )
      break
  }

  // What a press came to, where no field says it: one banner for each refusal, so that a second
  // is said as the first was. It stands under whatever is drawn, the form or what took the
  // form's place once the household was read again, and above the way on.
  let refused: ReactNode = null
  if (lost !== undefined) {
    refused = (
      <Banner key={`lost ${String(lost.count)}`} tone="danger" announce actions={toList}>
        {lost.kind === 'link' ? t('household.invite.lost.link') : t('household.invite.lost.email')}
      </Banner>
    )
  } else if (send.isError && !isUnverified(send.error) && !gone && !beside) {
    refused = (
      <Banner
        key={`sent ${String(send.submittedAt)}`}
        tone="danger"
        announce
        title={
          send.variables.kind === 'link'
            ? t('household.invite.failed.link')
            : t('household.invite.failed.email')
        }
      >
        {refusal(send.error)}
      </Banner>
    )
  }

  return (
    <HouseholdSettingsPage
      title={t('household.invite.title')}
      lead={shown === 'form' ? t('household.invite.lead') : undefined}
      // Where the member stands is said here in the screen's own words.
      note={false}
    >
      <div ref={view} tabIndex={-1} className={cx(account.view, styles.stack)}>
        {body}
        {refused}
        {foot}
      </div>
    </HouseholdSettingsPage>
  )
}

export function Invite() {
  const household = useHousehold()
  const held = useEverHeld(useStanding().invitations)
  // Absent: no form, no reason, and nothing asked of the server.
  if (!held) return <NotAvailable home={inHousehold.home(household.id)} />
  return <Composer />
}
