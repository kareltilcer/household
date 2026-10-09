// Account settings (A-19, `/account`; plan item 25, PRD 02 §2, 06-clients §3): who the member is
// to every household they are in, how the app is drawn for them, and what they are in. Account is
// per person: nothing of a household's settings is here, only the list of the member's
// memberships with their role in each, which is the fact an account's deletion later turns on.
// From each a member goes to the household and to leaving it, and from the list to making
// another (plan item 26); the invitations that wait for them are listed above it. A household
// the platform suspended is named with its state and leads nowhere: its every route answers
// `404` (D-115). A child profile is in the one household an owner made it in, and neither makes
// one nor leaves (D-104).
//
// The account's writes are plain requests asked at once (common.ts), so A-19's states are these.
// *Loading* is the households' alone: the account itself is read before the shell is drawn.
// *Empty* is a member in no household, whose account is complete all the same. *Pending* and
// *syncing* are a save under way, its control busy and nothing kept to be sent later. *Offline*
// is the page readable from what this browser kept, and a save that says it could not reach the
// server and changed nothing. *Error* is the households' list that could not be read. *Read-only*
// changes nothing here: a paused subscription is a household's, not the member's, whose name,
// language and picture all still change. *Absent*, *withdrawn*, *conflicted* and *rejected* have
// nothing to be on a member's own account: a refused change is said beside its control.
//
// What the contract has none of is absent: a change of address, when the password last changed,
// and an export of one's data (item 27). A child profile has no address and deletes nothing: an
// owner removes it (D-104).
import type { components } from '@household/api'
import { isLocale, locales, matchLocale, type Locale } from '@household/i18n/lazy'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { inHousehold, paths } from '../app/paths.ts'
import { fieldCodes, useRefusedField } from '../auth/fields.tsx'
import { useDisplay } from '../display/DisplayProvider.tsx'
import { densities, motions, scales, themes } from '../display/modes.ts'
import { useHouseholds, useRoleWord } from '../household/households.ts'
import { RowLink } from '../household/RowLink.tsx'
import { useWaiting, WaitingList } from '../household/Waiting.tsx'
import { useFormat, useI18n, useTranslate } from '../i18n/I18nProvider.tsx'
import { dayName, ownName, timeZones, weekdays } from '../i18n/names.ts'
import { meKey, useMe, type Me } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Portrait } from '../ui/Chip.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { Select, TextField } from '../ui/Field.tsx'
import { KeyValue } from '../ui/KeyValue.tsx'
import { List, ListRow } from '../ui/ListRow.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import { useToast } from '../ui/Toast.tsx'
import { isRefusedAsSent, pictureTypes, readState, useNoWithdrawal, useOwnZone } from './common.ts'
import { useOnline } from '../ui/online.ts'
import { Section, SettingsPage } from './Page.tsx'
import styles from './Settings.module.css'
import { VerifyResend } from './VerifyResend.tsx'

type MeUpdate = components['schemas']['MeUpdate']

/** Changes the account, and keeps the answer as the account every screen reads. */
function useSaveMe() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    ...askedNow,
    mutationFn: async (change: MeUpdate) => unwrap(await api.PATCH('/me', { body: change })),
    onSuccess: (me) => {
      queries.setQueryData(meKey, me)
    },
  })
}

function Name({ me }: { readonly me: Me }) {
  const t = useTranslate()
  const toast = useToast()
  const say = useProblemText(useOwnZone())
  const save = useSaveMe()
  const [name, setName] = useState(me.display_name)
  // Set, anew, each time a name of nothing is submitted: it is not sent.
  const [missing, setMissing] = useState<object>()
  const refused = fieldCodes(save.error).has('/display_name')
  const form = useRefusedField(missing ?? save.error)
  const error =
    missing !== undefined || refused
      ? t('account.profile.name.missing')
      : save.isError
        ? say(save.error)
        : undefined
  return (
    <form
      ref={form}
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        if (trimmed === '') {
          save.reset()
          setMissing({})
          return
        }
        setMissing(undefined)
        save.mutate(
          { display_name: trimmed },
          {
            onSuccess: (saved) => {
              setName(saved.display_name)
              toast({ message: t('account.profile.name.saved') })
            },
          },
        )
      }}
    >
      <TextField
        label={t('account.profile.name.label')}
        help={t('account.profile.name.help')}
        value={name}
        maxLength={80}
        autoComplete="name"
        error={error}
        onChange={(event) => {
          setName(event.currentTarget.value)
        }}
      />
      <div className={styles.actions}>
        <Button type="submit" loading={save.isPending}>
          {t('account.profile.name.save')}
        </Button>
      </div>
    </form>
  )
}

function Email({ email, verified }: { readonly email: string; readonly verified: boolean }) {
  const t = useTranslate()
  return (
    <div className={styles.group}>
      <KeyValue
        pairs={[
          {
            key: t('account.profile.email.label'),
            value: verified
              ? t('account.profile.email.verified', { email })
              : t('account.profile.email.unverified', { email }),
          },
        ]}
      />
      {verified ? null : (
        <>
          <p className={styles.note}>{t('account.profile.email.unverified_note')}</p>
          <VerifyResend email={email} />
        </>
      )}
    </div>
  )
}

function Picture({ me }: { readonly me: Me }) {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const toast = useToast()
  const say = useProblemText(useOwnZone())
  const chooser = useRef<HTMLInputElement>(null)
  const choose = useRef<HTMLButtonElement>(null)
  const upload = useMutation({
    ...askedNow,
    mutationFn: async (file: File) =>
      unwrap(
        await api.PUT('/me/avatar', {
          // The contract's multipart body, one part named `file`: the file itself is the part.
          body: { file: file.name },
          bodySerializer: () => {
            const form = new FormData()
            form.set('file', file)
            return form
          },
        }),
      ),
    onSuccess: (saved) => {
      queries.setQueryData(meKey, saved)
      // The picture is all that changes, and it is drawn for the eye alone: where one took
      // another's place not a word on the page is different. It is said, as the name's save is.
      toast({ message: t('account.profile.picture.saved') })
    },
  })
  const remove = useSaveMe()
  const has = (me.avatar_url ?? null) !== null

  let failure: string | undefined
  if (upload.isError) {
    const problem = problemIn(upload.error)
    if (problem?.status === 413) failure = t('account.profile.picture.too_large')
    else if (problem?.status === 415 || problem?.status === 422) {
      failure = t('account.profile.picture.unreadable')
    } else failure = say(upload.error)
  } else if (remove.isError) failure = say(remove.error)

  return (
    <div className={styles.group}>
      <p className={styles.strong}>{t('account.profile.picture.label')}</p>
      <div className={styles.picture}>
        <Portrait
          address={me.avatar_url ?? null}
          name={me.display_name}
          className={styles.portrait}
        />
        <div className={styles.actions}>
          <input
            ref={chooser}
            type="file"
            hidden
            accept={pictureTypes}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              // Chosen again, the same file is a change again.
              event.currentTarget.value = ''
              // What a removal was refused with is said no longer. One on its way is left to be
              // answered: no press opens the chooser while it is, and a file that arrives all the
              // same puts nothing away.
              if (!remove.isPending) remove.reset()
              if (file !== undefined) upload.mutate(file)
            }}
          />
          {/* One write of the picture at a time: while either is on its way the other's control
              takes no press, so neither is put away before it is answered. */}
          <Button
            ref={choose}
            loading={upload.isPending}
            aria-disabled={remove.isPending}
            onClick={() => {
              chooser.current?.click()
            }}
          >
            {has ? t('account.profile.picture.change') : t('account.profile.picture.choose')}
          </Button>
          {has ? (
            <Button
              variant="ghost"
              loading={remove.isPending}
              aria-disabled={upload.isPending}
              onClick={(event) => {
                const pressed = event.currentTarget
                upload.reset()
                remove.mutate(
                  { avatar_url: null },
                  {
                    // The control that removed it goes with the picture, and nothing else says
                    // it went: the focus it still holds goes to the one that stays, which then
                    // offers to choose a picture where it offered to change one.
                    onSuccess: () => {
                      if (document.activeElement === pressed) choose.current?.focus()
                    },
                  },
                )
              }}
            >
              {t('account.profile.picture.remove')}
            </Button>
          ) : null}
        </div>
      </div>
      <p className={styles.note}>{t('account.profile.picture.help')}</p>
      {failure === undefined ? null : (
        <Banner tone="danger" announce>
          {failure}
        </Banner>
      )}
    </div>
  )
}

function Language({ me }: { readonly me: Me }) {
  const t = useTranslate()
  const say = useProblemText(useOwnZone())
  const { locale: shown, setLocale } = useI18n()
  const save = useSaveMe()
  // The language chosen, from the press until the account has it: the control says what was
  // asked for, and goes back to the account's own when the account could not be told.
  const [chosen, setChosen] = useState<Locale | null>(null)
  const [unfetched, setUnfetched] = useState(false)
  // The language chosen last: one whose catalog arrives after another was chosen is shown no
  // longer (I18nProvider.tsx), and the account is not told of it either.
  const last = useRef<Locale | null>(null)
  const options = useMemo(
    () => locales.map((locale) => ({ value: locale, label: ownName(locale) })),
    [],
  )
  const choose = (next: Locale) => {
    const before = shown
    last.current = next
    setChosen(next)
    setUnfetched(false)
    save.reset()
    // The words change first, in this browser, and then the account is told, so that the
    // member's other devices and their emails follow.
    setLocale(next).then(
      () => {
        if (last.current !== next) return
        save.mutate(
          { locale: next },
          {
            onSettled: () => {
              setChosen(null)
            },
            onError: () => {
              // A language whose catalog was shown a moment ago is held still.
              setLocale(before).catch(() => undefined)
            },
          },
        )
      },
      () => {
        if (last.current !== next) return
        setChosen(null)
        setUnfetched(true)
      },
    )
  }
  const failure = unfetched
    ? t('account.profile.language.unfetched')
    : save.isError
      ? say(save.error)
      : undefined
  return (
    <div className={styles.form}>
      <Select
        label={t('account.profile.language.label')}
        help={t('account.profile.language.help')}
        value={chosen ?? matchLocale([me.locale ?? ''])}
        options={options}
        onChange={(event) => {
          const next = event.currentTarget.value
          if (isLocale(next)) choose(next)
        }}
      />
      {/* Under the control, which is put back and holds the focus: said as it arrives. */}
      {failure === undefined ? null : (
        <Banner tone="danger" announce>
          {failure}
        </Banner>
      )}
    </div>
  )
}

function Appearance() {
  const t = useTranslate()
  const { preferences, set } = useDisplay()
  return (
    <Section title={t('account.appearance.title')} note={t('account.appearance.note')}>
      <div className={styles.form}>
        <Select
          label={t('account.appearance.theme.label')}
          value={preferences.theme}
          options={[
            { value: 'light', label: t('account.appearance.theme.light') },
            { value: 'dark', label: t('account.appearance.theme.dark') },
            { value: 'system', label: t('account.appearance.theme.system') },
          ]}
          onChange={(event) => {
            const theme = themes.find((value) => value === event.currentTarget.value)
            if (theme !== undefined) set({ theme })
          }}
        />
        <Select
          label={t('account.appearance.density.label')}
          help={t('account.appearance.density.help')}
          value={preferences.density}
          options={[
            { value: 'auto', label: t('account.appearance.density.auto') },
            { value: 'comfortable', label: t('account.appearance.density.comfortable') },
            { value: 'compact', label: t('account.appearance.density.compact') },
          ]}
          onChange={(event) => {
            const density = densities.find((value) => value === event.currentTarget.value)
            if (density !== undefined) set({ density })
          }}
        />
        <Select
          label={t('account.appearance.scale.label')}
          help={t('account.appearance.scale.help')}
          value={preferences.scale}
          options={[
            { value: '100', label: t('account.appearance.scale.standard') },
            { value: '200', label: t('account.appearance.scale.double') },
          ]}
          onChange={(event) => {
            const scale = scales.find((value) => value === event.currentTarget.value)
            if (scale !== undefined) set({ scale })
          }}
        />
        <Select
          label={t('account.appearance.motion.label')}
          value={preferences.motion}
          options={[
            { value: 'system', label: t('account.appearance.motion.system') },
            { value: 'reduced', label: t('account.appearance.motion.reduced') },
          ]}
          onChange={(event) => {
            const motion = motions.find((value) => value === event.currentTarget.value)
            if (motion !== undefined) set({ motion })
          }}
        />
      </div>
    </Section>
  )
}

function DatesAndTimes({ me }: { readonly me: Me }) {
  const t = useTranslate()
  const format = useFormat()
  const say = useProblemText(useOwnZone())
  const saveZone = useSaveMe()
  const saveDay = useSaveMe()
  // A choice the server will not take is no failure of the server's: it is said as a refusal.
  const why = (error: unknown) => (isRefusedAsSent(error) ? t('account.refused') : say(error))
  const own = me.timezone ?? null
  // The account's own stays in the list though this browser does not name it.
  const zones = useMemo(() => timeZones(own), [own])
  const days = useMemo(
    () => weekdays.map((day) => ({ value: String(day), label: dayName(format.locale, day) })),
    [format.locale],
  )
  // While a choice is being saved the control says what was chosen; refused, it is put back.
  const zone = saveZone.isPending ? (saveZone.variables.timezone ?? null) : own
  const firstDay = saveDay.isPending
    ? (saveDay.variables.first_day_of_week ?? null)
    : (me.first_day_of_week ?? null)
  return (
    <Section title={t('account.dates.title')}>
      <div className={styles.form}>
        <Select
          label={t('account.dates.timezone.label')}
          help={t('account.dates.timezone.help')}
          value={zone ?? ''}
          options={[
            { value: '', label: t('account.dates.timezone.household') },
            ...zones.map((name) => ({ value: name, label: name })),
          ]}
          onChange={(event) => {
            const next = event.currentTarget.value
            saveZone.mutate({ timezone: next === '' ? null : next })
          }}
        />
        {/* The control is put back, and holds the focus: why is said under it, as it arrives. */}
        {saveZone.isError ? (
          <Banner tone="danger" announce>
            {why(saveZone.error)}
          </Banner>
        ) : null}
        <Select
          label={t('account.dates.first_day.label')}
          value={firstDay === null ? '' : String(firstDay)}
          options={[{ value: '', label: t('account.dates.first_day.locale') }, ...days]}
          onChange={(event) => {
            const next = event.currentTarget.value
            saveDay.mutate({ first_day_of_week: next === '' ? null : Number(next) })
          }}
        />
        {saveDay.isError ? (
          <Banner tone="danger" announce>
            {why(saveDay.error)}
          </Banner>
        ) : null}
      </div>
    </Section>
  )
}

function Households({ child }: { readonly child: boolean }) {
  const t = useTranslate()
  const households = useHouseholds()
  const online = useOnline()
  const withdrawn = useNoWithdrawal()
  const role = useRoleWord()
  const list = households.data ?? []
  // No part of the section's own read: nothing is drawn of them while they cannot be read, or
  // while there are none.
  const waiting = useWaiting(!child) ?? []
  return (
    <Section title={t('account.households.title')}>
      {waiting.length === 0 ? null : (
        <div className={styles.group}>
          <p className={styles.strong}>{t('account.households.waiting.title')}</p>
          <WaitingList invitations={waiting} />
        </div>
      )}
      <StateFrame
        state={readState(households, online, list.length === 0)}
        skeleton={
          <Skeleton
            bars={[
              [60, 1.25],
              [40, 1.25],
            ]}
          />
        }
        // Its one action is making a household, which a child profile does not do (D-104).
        empty={
          <div className={styles.group}>
            <EmptyState
              sentence={t('account.households.empty.title')}
              action={
                child ? undefined : (
                  <Link className={styles.link} to={paths.householdNew.path}>
                    {t('account.households.create')}
                  </Link>
                )
              }
            />
            {child ? null : <p className={styles.note}>{t('account.households.empty.body')}</p>}
          </div>
        }
        texts={{
          error: {
            title: t('shell.households.error.title'),
            text: t('shell.households.error.body'),
            actions: (
              <Button
                onClick={() => {
                  void households.refetch()
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
            {/* A list of memberships, and no switcher: it says what the member is in each one,
                and each leads to its household and to leaving it. */}
            <List label={t('account.households.title')}>
              {list.map((household) => {
                const name = household.name ?? ''
                return (
                  <ListRow
                    key={household.id}
                    title={name}
                    trailing={
                      <>
                        <span className={styles.badge}>{role(household.my_role)}</span>
                        {household.entitlement?.state === 'suspended' ? (
                          // Its every route answers `404` (D-115): its state in a word, as the
                          // switcher says it, and no link that would open nothing.
                          <span className={styles.badge}>{t('shell.entitlement.suspended')}</span>
                        ) : (
                          <>
                            <RowLink
                              to={inHousehold.home(household.id)}
                              name={t('account.households.open_named', { household: name })}
                              word={t('account.households.open')}
                            />
                            {/* A child profile does not leave: an owner removes it (D-104). */}
                            {household.my_role === 'child' ? null : (
                              <RowLink
                                to={inHousehold.leave(household.id)}
                                name={t('account.households.leave_named', { household: name })}
                                word={t('account.households.leave')}
                              />
                            )}
                          </>
                        )}
                      </>
                    }
                  />
                )
              })}
            </List>
            {child ? null : (
              <Link className={styles.link} to={paths.householdNew.path}>
                {t('account.households.create_another')}
              </Link>
            )}
          </>
        )}
      </StateFrame>
    </Section>
  )
}

export function Account() {
  const t = useTranslate()
  const me = useMe()
  const child = me.is_child === true
  const email = me.email ?? null
  return (
    <SettingsPage
      title={t('account.profile.title')}
      lead={child ? t('account.profile.child') : undefined}
    >
      <Section title={t('account.you.title')}>
        <Name me={me} />
        {child || email === null ? null : <Email email={email} verified={me.email_verified} />}
        <Picture me={me} />
        <Language me={me} />
      </Section>
      <Appearance />
      <DatesAndTimes me={me} />
      <Households child={child} />
      {child ? null : (
        <Section title={t('account.closing.title')}>
          <p className={styles.note}>{t('account.closing.note')}</p>
          <Link className={styles.link} to={paths.accountDelete.path}>
            {t('account.closing.delete')}
          </Link>
        </Section>
      )}
    </SettingsPage>
  )
}
