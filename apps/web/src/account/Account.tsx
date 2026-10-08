// Account settings (A-19, `/account`; plan item 25, PRD 02 §2, 06-clients §3): who the member is
// to every household they are in, how the app is drawn for them, and what they are in. Account is
// per person: nothing of a household's settings is here, only the list of the member's
// memberships with their role in each, which is the fact an account's deletion later turns on.
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
// an export of one's data (item 27) and a way to create a household (item 26). A child profile
// has no address and deletes nothing: an owner removes it (D-104).
import type { components } from '@household/api'
import { isLocale, locales, matchLocale, type Locale } from '@household/i18n/lazy'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { paths } from '../app/paths.ts'
import { fieldCodes } from '../auth/fields.tsx'
import { useDisplay } from '../display/DisplayProvider.tsx'
import { densities, motions, scales, themes } from '../display/modes.ts'
import { useHouseholds, useRoleWord } from '../household/households.ts'
import { useFormat, useI18n, useTranslate } from '../i18n/I18nProvider.tsx'
import { meKey, useMe, type Me } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Avatar } from '../ui/Chip.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { Select, TextField } from '../ui/Field.tsx'
import { KeyValue } from '../ui/KeyValue.tsx'
import { List, ListRow } from '../ui/ListRow.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import { useToast } from '../ui/Toast.tsx'
import { askedNow, isRefusedAsSent, readState, useNoWithdrawal, useOwnZone } from './common.ts'
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
  const [missing, setMissing] = useState(false)
  const refused = fieldCodes(save.error).has('/display_name')
  const error =
    missing || refused
      ? t('account.profile.name.missing')
      : save.isError
        ? say(save.error)
        : undefined
  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        setMissing(trimmed === '')
        if (trimmed === '') return
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

/** The first letters of a name's first two words: what stands where a member has no picture. */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => (Array.from(word)[0] ?? '').toLocaleUpperCase())
    .join('')
}

function Portrait({ me }: { readonly me: Me }) {
  // A picture's link is good for minutes (D-9), and the account may be read from what this
  // browser kept: a link that no longer loads gives way to the initials, and is no broken image.
  const [failed, setFailed] = useState<string | null>(null)
  const address = me.avatar_url ?? null
  if (address !== null && failed !== address) {
    return (
      <img
        className={styles.portrait}
        src={address}
        // Decoration: the member's name is written beside it.
        alt=""
        onError={() => {
          setFailed(address)
        }}
      />
    )
  }
  return <Avatar initials={initialsOf(me.display_name)} tone={1} />
}

/** The images the server makes a picture of (`putMeAvatar`). */
const pictures = 'image/jpeg,image/png,image/gif,image/webp'

function Picture({ me }: { readonly me: Me }) {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const say = useProblemText(useOwnZone())
  const chooser = useRef<HTMLInputElement>(null)
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
        <Portrait me={me} />
        <div className={styles.actions}>
          <input
            ref={chooser}
            type="file"
            hidden
            accept={pictures}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              // Chosen again, the same file is a change again.
              event.currentTarget.value = ''
              remove.reset()
              if (file !== undefined) upload.mutate(file)
            }}
          />
          <Button
            loading={upload.isPending}
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
              onClick={() => {
                upload.reset()
                remove.mutate({ avatar_url: null })
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

/** A language's own name for itself, as `Intl` has it, with a capital as a list of names has. */
function ownName(locale: Locale): string {
  const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
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
  const options = useMemo(
    () => locales.map((locale) => ({ value: locale, label: ownName(locale) })),
    [],
  )
  const choose = (next: Locale) => {
    const before = shown
    setChosen(next)
    setUnfetched(false)
    save.reset()
    // The words change first, in this browser, and then the account is told, so that the
    // member's other devices and their emails follow.
    setLocale(next).then(
      () => {
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
        setChosen(null)
        setUnfetched(true)
      },
    )
  }
  return (
    <div className={styles.form}>
      <Select
        label={t('account.profile.language.label')}
        help={t('account.profile.language.help')}
        value={chosen ?? matchLocale([me.locale ?? ''])}
        options={options}
        error={
          unfetched
            ? t('account.profile.language.unfetched')
            : save.isError
              ? say(save.error)
              : undefined
        }
        onChange={(event) => {
          const next = event.currentTarget.value
          if (isLocale(next)) choose(next)
        }}
      />
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

/** A Sunday, at noon in UTC: the day the days of the week are counted from, 0 for Sunday. */
const aSunday = Date.UTC(2026, 0, 4, 12)

/** The days of the week as the contract numbers them, Monday first as a list of them reads. */
const weekdays = [1, 2, 3, 4, 5, 6, 0] as const

function DatesAndTimes({ me }: { readonly me: Me }) {
  const t = useTranslate()
  const format = useFormat()
  const say = useProblemText(useOwnZone())
  const saveZone = useSaveMe()
  const saveDay = useSaveMe()
  // A choice the server will not take is no failure of the server's: it is said as a refusal.
  const why = (error: unknown) => (isRefusedAsSent(error) ? t('account.refused') : say(error))
  const own = me.timezone ?? null
  const zones = useMemo(() => {
    const known = Intl.supportedValuesOf('timeZone')
    // The account's own stays in the list though this browser does not name it.
    return own === null || known.includes(own) ? known : [own, ...known]
  }, [own])
  const days = useMemo(() => {
    const named = new Intl.DateTimeFormat(format.locale, { weekday: 'long', timeZone: 'UTC' })
    return weekdays.map((day) => ({
      value: String(day),
      label: named.format(aSunday + day * 24 * 60 * 60 * 1000),
    }))
  }, [format.locale])
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
          error={saveZone.isError ? why(saveZone.error) : undefined}
          onChange={(event) => {
            const next = event.currentTarget.value
            saveZone.mutate({ timezone: next === '' ? null : next })
          }}
        />
        <Select
          label={t('account.dates.first_day.label')}
          value={firstDay === null ? '' : String(firstDay)}
          options={[{ value: '', label: t('account.dates.first_day.locale') }, ...days]}
          error={saveDay.isError ? why(saveDay.error) : undefined}
          onChange={(event) => {
            const next = event.currentTarget.value
            saveDay.mutate({ first_day_of_week: next === '' ? null : Number(next) })
          }}
        />
      </div>
    </Section>
  )
}

function Households() {
  const t = useTranslate()
  const households = useHouseholds()
  const online = useOnline()
  const withdrawn = useNoWithdrawal()
  const role = useRoleWord()
  const list = households.data ?? []
  return (
    <Section title={t('account.households.title')}>
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
        // No way to create one is drawn: creating a household is not built yet (plan item 26).
        empty={
          <div className={styles.group}>
            <EmptyState sentence={t('account.households.empty.title')} />
            <p className={styles.note}>{t('account.households.empty.body')}</p>
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
          // A list of memberships, and no switcher: it says what the member is in each one.
          <List label={t('account.households.title')}>
            {list.map((household) => (
              <ListRow
                key={household.id}
                title={household.name ?? ''}
                trailing={<span className={styles.badge}>{role(household.my_role)}</span>}
              />
            ))}
          </List>
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
      <Households />
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
