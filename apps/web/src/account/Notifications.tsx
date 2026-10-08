// Notifications (F-20, `/account/notifications`; PRD 03 §4 FR-NT1 and FR-NT2, 03-patterns §8,
// D-112): this browser's permission and the member's own preferences on one screen, so that
// *notifications are off* has one place to be diagnosed. The categories stay drawn under a
// browser that blocks them: that is what makes the sentence above them believable, and they still
// reach the member's other devices.
//
// The browser's question is put by a press of *Turn on notifications in this browser* and by
// nothing else, never as the page loads (06-clients §6).
//
// Preferences are per household, with defaults for the account that stand in wherever the member
// has set nothing; a household's detach from the defaults at the first change made for it, which
// the screen says. They are the member's own and plain requests, saved as they change and kept
// nowhere to be sent later, so what the prototype drew of a sync, a household-wide switch, a
// test notification and a list of receiving devices is not here: the contract has none of them.
//
// F-20's states, and which a set of plain online requests reaches:
// - *loading*, *populated* and *error* are the read's.
// - *offline* is the page as this browser kept it; a change then says it could not reach the
//   server, and the control goes back.
// - *syncing* is a change being saved, marked once it has taken longer than a moment.
// - *rejected* is a change the server refused or could not be asked: the control is put back
//   and the strip says why. Nothing is held: what the strip offers is to put it away.
// - *pending* has nothing to be. A change is asked of the server at once and is either answered
//   or refused; none waits on the device for a sync.
// - *absent* has nothing to be either: the preferences are a member's own, under no grant, and
//   the one profile the prototype names, a locked child profile, is signed in nowhere.
// - *read-only* is reached and changes nothing: these are no household's writes, and they keep
//   working while a subscription is paused.
import type { components } from '@household/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useApi } from '../api/ApiProvider.tsx'
import { unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { useHouseholds } from '../household/households.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { usePush } from '../push/usePush.ts'
import { useMe } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Switch } from '../ui/Choice.tsx'
import { Select, TextField } from '../ui/Field.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import { SyncMark } from '../ui/StatusMark.tsx'
import { isRefusedAsSent, readState, useNoWithdrawal, useOwnZone } from './common.ts'
import { useOnline } from '../ui/online.ts'
import { Section, SettingsPage } from './Page.tsx'
import styles from './Settings.module.css'

type Preferences = components['schemas']['NotificationPreferences']
type Change = components['schemas']['NotificationPreferencesUpdate']
type Category = components['schemas']['NotificationCategory']

const categories = ['direct', 'household', 'reminders', 'digest'] as const satisfies Category[]

/** The quiet hours a member starts from when they turn them on: the night, as most keep it. */
const night = { from: '22:00', to: '07:00' } as const

/** A time of day as the contract carries one. */
const timeOfDay = /^\d{2}:\d{2}$/

/** The preferences of the account (`null`) or of one household, by key. */
function preferencesKey(household: string | null) {
  return ['me', 'notification-preferences', household ?? 'account'] as const
}

function ThisBrowser() {
  const t = useTranslate()
  const say = useProblemText(useOwnZone())
  const push = usePush()
  // Whether the browser was asked from this screen. What it answered is then what a press came
  // to, and a refusal is said as it arrives; one it had given before the screen opened is read
  // in its place.
  const [asked, setAsked] = useState(false)
  if (push.state === undefined) return null
  const { permission, subscribed } = push.state
  const turnOn = (
    <div className={styles.actions}>
      <Button
        variant="primary"
        loading={push.asking}
        onClick={() => {
          setAsked(true)
          // The browser's question is put in this press, and by nothing else.
          push.ask().catch(() => undefined)
        }}
      >
        {t('push.turn_on')}
      </Button>
    </div>
  )
  const failed =
    push.askError !== null ? (
      <Banner tone="danger" announce>
        {/* The browser's own refusal, or the server's of what the browser gave it: neither is
            a connection lost. */}
        {push.askError instanceof DOMException || isRefusedAsSent(push.askError)
          ? t('push.failed')
          : say(push.askError)}
      </Banner>
    ) : push.turnOffError !== null ? (
      <Banner tone="danger" announce>
        {say(push.turnOffError)}
      </Banner>
    ) : null
  return (
    <Section title={t('push.title')}>
      {permission === 'unsupported' ? (
        <p className={styles.text}>{t('push.unsupported')}</p>
      ) : permission === 'denied' ? (
        <Banner tone="warning" title={t('push.denied.title')} announce={asked}>
          {t('push.denied.body')}
        </Banner>
      ) : permission === 'granted' && subscribed ? (
        <>
          <p className={styles.text}>{t('push.on')}</p>
          <div className={styles.actions}>
            <Button
              loading={push.turningOff}
              onClick={() => {
                push.turnOff().catch(() => undefined)
              }}
            >
              {t('push.turn_off')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.text}>
            {permission === 'granted' ? t('push.off_here') : t('push.not_asked')}
          </p>
          {turnOn}
        </>
      )}
      {failed}
    </Section>
  )
}

interface QuietWindow {
  readonly from: string
  readonly to: string
}

/**
 * The two times quiet hours run between. Each field holds what is typed until it is left, and
 * the pair is saved then, once it is two different times of day: saved at every key, a time
 * half typed would be sent, and the field drawn again under the member's hands.
 */
function QuietTimes({
  held,
  onChange,
}: {
  /** The window the server holds. */
  readonly held: QuietWindow
  readonly onChange: (next: QuietWindow) => void
}) {
  const t = useTranslate()
  const [from, setFrom] = useState(held.from)
  const [to, setTo] = useState(held.to)
  const whole = timeOfDay.test(from) && timeOfDay.test(to)
  const same = whole && from === to
  const settle = () => {
    if (whole && !same && (from !== held.from || to !== held.to)) onChange({ from, to })
  }
  return (
    <>
      <div className={styles.pair}>
        <TextField
          type="time"
          label={t('account.notifications.quiet.from')}
          value={from}
          onChange={(event) => {
            setFrom(event.currentTarget.value)
          }}
          onBlur={settle}
        />
        <TextField
          type="time"
          label={t('account.notifications.quiet.until')}
          value={to}
          onChange={(event) => {
            setTo(event.currentTarget.value)
          }}
          onBlur={settle}
        />
      </div>
      {/* Of the two together, and of neither alone: said under them as it comes to be so,
          whichever of them holds the focus. */}
      {same ? (
        <Banner tone="danger" announce>
          {t('account.notifications.quiet.same')}
        </Banner>
      ) : null}
    </>
  )
}

function Settings({
  household,
  householdName,
}: {
  /** The household these are for, or null for the account's defaults. */
  readonly household: string | null
  readonly householdName: string | undefined
}) {
  const t = useTranslate()
  const api = useApi()
  const me = useMe()
  const queries = useQueryClient()
  const online = useOnline()
  const say = useProblemText(useOwnZone())
  const withdrawn = useNoWithdrawal()
  const ids = useId()
  const key = preferencesKey(household)
  const query = household === null ? {} : { household_id: household }

  const read = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/me/notification-preferences', { params: { query }, signal })),
  })
  // Why the last change was not saved, until the next one or until it is put away, and how many
  // have not been: the time fields are drawn afresh after each, holding what the server holds.
  const [refusal, setRefusal] = useState<string | null>(null)
  const [refusals, setRefusals] = useState(0)
  const save = useMutation({
    ...askedNow,
    mutationFn: async (change: Change) =>
      unwrap(await api.PATCH('/me/notification-preferences', { params: { query }, body: change })),
    onMutate: (change: Change) => {
      setRefusal(null)
      const before = queries.getQueryData<Preferences>(key)
      // Shown as chosen while it is asked: a switch that waited for the answer would feel stuck.
      queries.setQueryData<Preferences>(key, (was) =>
        was === undefined
          ? was
          : {
              ...was,
              ...(change.enabled === undefined ? {} : { enabled: change.enabled }),
              categories: { ...was.categories, ...change.categories },
              ...(change.quiet_hours === undefined ? {} : { quiet_hours: change.quiet_hours }),
            },
      )
      return { before }
    },
    onSuccess: (saved) => {
      queries.setQueryData(key, saved)
    },
    onError: (error, _change, context) => {
      // Put back: what the screen shows is what the server holds. It is asked again too, since
      // two changes made a moment apart are each put back to what was there before them.
      if (context?.before !== undefined) queries.setQueryData(key, context.before)
      void queries.invalidateQueries({ queryKey: key })
      setRefusal(isRefusedAsSent(error) ? t('account.refused') : say(error))
      setRefusals((count) => count + 1)
    },
  })

  const preferences = read.data
  const quiet = preferences?.quiet_hours ?? null
  const state = save.isPending
    ? 'syncing'
    : refusal !== null && preferences !== undefined
      ? 'rejected'
      : readState(read, online)

  const clock =
    me.timezone !== undefined && me.timezone !== null
      ? t('account.notifications.quiet.own', { zone: me.timezone })
      : household === null
        ? t('account.notifications.quiet.each')
        : t('account.notifications.quiet.household')

  return (
    <StateFrame
      state={state}
      skeleton={
        <Skeleton
          bars={[
            [55, 1.5],
            [80, 1.25],
            [75, 1.25],
            [60, 1.25],
            [50, 1.25],
          ]}
        />
      }
      // Four categories, always all four: there is no empty state to teach.
      empty={null}
      texts={{
        error: {
          text: t('account.notifications.error'),
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
        rejected: {
          title: t('account.notifications.not_saved'),
          text: refusal ?? '',
          actions: (
            <Button
              onClick={() => {
                setRefusal(null)
              }}
            >
              {t('ui.dismiss')}
            </Button>
          ),
        },
      }}
    >
      {({ mark }) =>
        preferences === undefined ? null : (
          <div className={styles.group}>
            {household === null ? null : (
              <p className={styles.note}>
                {t('account.notifications.detach', { household: householdName ?? '' })}
              </p>
            )}
            <div className={styles.group}>
              <Switch
                label={t('account.notifications.master.label')}
                checked={preferences.enabled}
                aria-describedby={`${ids}-master`}
                onChange={(event) => {
                  save.mutate({ enabled: event.currentTarget.checked })
                }}
              />
              <p id={`${ids}-master`} className={styles.note}>
                {preferences.enabled
                  ? t('account.notifications.master.on')
                  : t('account.notifications.master.off')}
              </p>
            </div>

            <h3 className={styles.strong}>{t('account.notifications.kinds')}</h3>
            {categories.map((category) => (
              <div key={category} className={styles.group}>
                <Switch
                  label={t(`account.notifications.category.${category}.label`)}
                  checked={preferences.categories[category]}
                  aria-describedby={`${ids}-${category}`}
                  onChange={(event) => {
                    save.mutate({ categories: { [category]: event.currentTarget.checked } })
                  }}
                />
                <p id={`${ids}-${category}`} className={styles.note}>
                  {t(`account.notifications.category.${category}.says`)}
                </p>
              </div>
            ))}

            <h3 className={styles.strong}>{t('account.notifications.quiet.title')}</h3>
            <div className={styles.group}>
              <Switch
                label={t('account.notifications.quiet.label')}
                checked={quiet !== null}
                aria-describedby={`${ids}-quiet`}
                onChange={(event) => {
                  save.mutate({ quiet_hours: event.currentTarget.checked ? night : null })
                }}
              />
              <p id={`${ids}-quiet`} className={styles.note}>
                {t('account.notifications.quiet.says')} {clock}
              </p>
            </div>
            {quiet === null ? null : (
              <QuietTimes
                key={refusals}
                held={quiet}
                onChange={(next) => {
                  save.mutate({ quiet_hours: next })
                }}
              />
            )}
            {/* After everything else, so that nothing above it moves when it comes and goes. */}
            {mark === 'syncing' ? <SyncMark state="syncing" /> : null}
          </div>
        )
      }
    </StateFrame>
  )
}

export function Notifications() {
  const t = useTranslate()
  const households = useHouseholds()
  // What the settings below are for: the account's defaults, or one of the member's households.
  const [scope, setScope] = useState('')
  const list = households.data ?? []
  const chosen = list.find((household) => household.id === scope)
  const household = chosen?.id ?? null
  // Could not be read, with nothing kept of them: a read that failed, or one that waits for a
  // connection. The defaults below are the account's, and are drawn all the same.
  const unread =
    households.data === undefined && (households.isError || households.fetchStatus === 'paused')
  return (
    <SettingsPage title={t('account.notifications.title')} lead={t('account.notifications.lead')}>
      <ThisBrowser />
      <Section title={t('account.notifications.settings.title')}>
        {unread ? (
          // In the place of the control that chooses one of them, and said as it arrives: with
          // nothing said, the screen would read as that of a member in no household.
          <Banner
            tone="danger"
            title={t('shell.households.error.title')}
            announce
            actions={
              <Button
                onClick={() => {
                  void households.refetch()
                }}
              >
                {t('ui.retry')}
              </Button>
            }
          >
            {t('shell.households.error.body')}
          </Banner>
        ) : list.length === 0 ? null : (
          // With no household there are only the defaults, and nothing to choose between.
          <div className={styles.form}>
            <Select
              label={t('account.notifications.scope.label')}
              value={household ?? ''}
              options={[
                { value: '', label: t('account.notifications.scope.account') },
                ...list.map((each) => ({ value: each.id, label: each.name ?? '' })),
              ]}
              onChange={(event) => {
                setScope(event.currentTarget.value)
              }}
            />
          </div>
        )}
        {/* Each scope's own, from its first draw: nothing of another's is kept on the screen. */}
        <Settings key={household ?? 'account'} household={household} householdName={chosen?.name} />
      </Section>
      <Section title={t('account.notifications.email.title')}>
        <p className={styles.text}>{t('account.notifications.email.body')}</p>
      </Section>
    </SettingsPage>
  )
}
