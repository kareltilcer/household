// Where an account is signed in (A-12 and A-13, `/account/devices`; PRD 02 §2, ADR 0009, 0010):
// its browsers and its phones and tablets, each signed out from here.
//
// They are two lists, as the server keeps them: a web session, of which the server knows a raw
// `User-Agent` and when it was last seen, and a device, which named itself and can be renamed.
// What the prototype drew and the server has none of is left out: no count of unsent changes, no
// city unless the server names one, and then as where the request came from, never as where the
// member was. So the confirmation (A-13) says what is true without a number: a browser or a
// device that is signed out drops its copy of the households the next time it opens the app, and
// whatever it had saved offline and not sent goes with it. Signing any one out also ends every
// trust to skip the second step, which the confirmation says to an account that has one.
// Nothing here has an undo: a session ended is ended.
//
// The browser the member is looking at has no control: signing out of it is the shell's. *Sign
// out everywhere* ends it too, and says so before it does.
//
// A-12's states, for a list that is read and a revocation that is a request asked at once:
// *loading*, *populated* and *error* are the read's; *empty* is this browser alone, drawn as the
// one row it is and not as a teaching state, there being nothing to set up; *offline* is the
// list as this browser kept it, and a sign-out that says it could not reach the server;
// *syncing* is a sign-out under way, its row marked once it has taken longer than a moment;
// *pending* has nothing to be, since a revocation is never held to be sent later; and
// *read-only* changes nothing, one's own devices being no household's write.
import type { components } from '@household/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { useRefusedField } from '../auth/fields.tsx'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe, useSession } from '../session/SessionProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Dialog, Sheet } from '../ui/Dialog.tsx'
import { TextField } from '../ui/Field.tsx'
import { List, ListRow } from '../ui/ListRow.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import { useToast } from '../ui/Toast.tsx'
import a11y from '../ui/a11y.module.css'
import { readState, signedInKey, useNoWithdrawal, useOwnZone } from './common.ts'
import { useOnline } from '../ui/online.ts'
import { Section, SettingsPage } from './Page.tsx'
import styles from './Settings.module.css'
import { agentOf, type Browser, type System } from './userAgent.ts'

type Device = components['schemas']['Device']

/** What a confirmation signs out: a browser's session, or a device's sign-in. */
interface Target {
  readonly kind: 'session' | 'device'
  readonly id: string
  readonly name: string
}

/** The names of what an account is signed in on, as a member would say them. */
function useNames() {
  const t = useTranslate()
  const browser = (given: Browser): string => {
    switch (given) {
      case 'edge':
        return t('account.devices.browser.edge')
      case 'opera':
        return t('account.devices.browser.opera')
      case 'samsung':
        return t('account.devices.browser.samsung')
      case 'firefox':
        return t('account.devices.browser.firefox')
      case 'chrome':
        return t('account.devices.browser.chrome')
      case 'safari':
        return t('account.devices.browser.safari')
    }
  }
  const system = (given: System): string => {
    switch (given) {
      case 'iphone':
        return t('account.devices.system.iphone')
      case 'ipad':
        return t('account.devices.system.ipad')
      case 'android':
        return t('account.devices.system.android')
      case 'windows':
        return t('account.devices.system.windows')
      case 'chromeos':
        return t('account.devices.system.chromeos')
      case 'macos':
        return t('account.devices.system.macos')
      case 'linux':
        return t('account.devices.system.linux')
    }
  }
  return {
    /** A browser's session, from the one thing the server keeps of it. */
    ofAgent: (userAgent: string | undefined): string => {
      const agent = agentOf(userAgent)
      if (agent.browser !== undefined && agent.system !== undefined) {
        return t('account.devices.agent.both', {
          browser: browser(agent.browser),
          system: system(agent.system),
        })
      }
      if (agent.browser !== undefined) return browser(agent.browser)
      if (agent.system !== undefined) {
        return t('account.devices.agent.system', { system: system(agent.system) })
      }
      return t('account.devices.agent.unknown')
    },
    /** A device, as it named itself or was renamed, or by its kind where it named nothing. */
    ofDevice: (device: Device): string => {
      const label = (device.label ?? '').trim()
      if (label !== '') return label
      switch (device.platform) {
        case 'ios':
          return t('account.devices.device.ios')
        case 'android':
          return t('account.devices.device.android')
        default:
          return t('account.devices.device.unknown')
      }
    },
  }
}

/** A row's own control, named for what it acts on and drawn as the one word. */
function RowAction({
  name,
  word,
  onPress,
}: {
  readonly name: string
  readonly word: string
  readonly onPress: () => void
}) {
  return (
    <Button
      onClick={() => {
        onPress()
      }}
    >
      <span className={a11y.visuallyHidden}>{name}</span>
      <span aria-hidden="true">{word}</span>
    </Button>
  )
}

function Rename({
  device,
  name,
  onDone,
  onClose,
}: {
  readonly device: Device
  readonly name: string
  readonly onDone: () => void
  readonly onClose: () => void
}) {
  const t = useTranslate()
  const api = useApi()
  const toast = useToast()
  const say = useProblemText(useOwnZone())
  const form = useId()
  const field = useRef<HTMLInputElement>(null)
  const [label, setLabel] = useState(device.label ?? '')
  const rename = useMutation({
    ...askedNow,
    mutationFn: async (next: string) =>
      unwrap(
        await api.PATCH('/me/devices/{device_id}', {
          params: { path: { device_id: device.id } },
          body: { label: next },
        }),
      ),
    onSuccess: onDone,
    onError: (error) => {
      // Signed out since the list was read: there is nothing left to name.
      if (problemIn(error)?.status !== 404) return
      toast({ message: t('account.devices.revoke.already') })
      onDone()
    },
  })
  const refused = useRefusedField(rename.error)
  const close = () => {
    if (!rename.isPending) onClose()
  }
  return (
    <Sheet
      open
      onClose={close}
      title={t('account.devices.rename.named', { name })}
      initialFocus={field}
      actions={
        <>
          <Button onClick={close}>{t('account.cancel')}</Button>
          <Button type="submit" form={form} variant="primary" loading={rename.isPending}>
            {t('account.devices.rename.save')}
          </Button>
        </>
      }
    >
      <form
        id={form}
        ref={refused}
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          rename.mutate(label.trim())
        }}
      >
        <TextField
          ref={field}
          label={t('account.devices.rename.label')}
          help={t('account.devices.rename.help')}
          maxLength={80}
          value={label}
          error={
            rename.isError && problemIn(rename.error)?.status !== 404
              ? say(rename.error)
              : undefined
          }
          onChange={(event) => {
            setLabel(event.currentTarget.value)
          }}
        />
      </form>
    </Sheet>
  )
}

export function Devices() {
  const t = useTranslate()
  const api = useApi()
  const me = useMe()
  const session = useSession()
  const queries = useQueryClient()
  const format = useFormat()
  const toast = useToast()
  const zone = useOwnZone()
  const say = useProblemText(zone)
  const online = useOnline()
  const names = useNames()
  const withdrawn = useNoWithdrawal()

  const read = useQuery({
    queryKey: signedInKey,
    queryFn: async ({ signal }) => {
      const [sessions, devices] = await Promise.all([
        api.GET('/me/sessions', { signal }),
        api.GET('/me/devices', { signal }),
      ])
      return { sessions: unwrap(sessions).items ?? [], devices: unwrap(devices).items ?? [] }
    },
  })
  const refresh = () => queries.invalidateQueries({ queryKey: signedInKey })

  // The row a confirmation was opened from is gone once what it names is signed out, and the
  // focus the confirmation gave back went with it: it is put on the lists' own place.
  const view = useRef<HTMLDivElement>(null)
  const leaving = useRef<string | null>(null)
  const listed = read.data
  useEffect(() => {
    const id = leaving.current
    if (id === null || listed === undefined) return
    if ([...listed.sessions, ...listed.devices].some((each) => each.id === id)) return
    leaving.current = null
    const focused = document.activeElement
    if (focused === null || focused === document.body) view.current?.focus()
  }, [listed])

  const [target, setTarget] = useState<Target | null>(null)
  const [everywhere, setEverywhere] = useState(false)
  const [renaming, setRenaming] = useState<Device | null>(null)

  const revoke = useMutation({
    ...askedNow,
    mutationFn: async (given: Target) => {
      if (given.kind === 'session') {
        unwrap(
          await api.DELETE('/me/sessions/{session_id}', {
            params: { path: { session_id: given.id } },
          }),
        )
      } else {
        unwrap(
          await api.DELETE('/me/devices/{device_id}', {
            params: { path: { device_id: given.id } },
          }),
        )
      }
    },
    onSuccess: (_answer, given) => {
      leaving.current = given.id
      setTarget(null)
      // No undo: a session ended is ended.
      toast({ message: t('account.devices.revoke.done', { name: given.name }) })
      void refresh()
    },
    onError: (error, given) => {
      // Signed out from somewhere else since the list was read: what was asked for is so.
      if (problemIn(error)?.status !== 404) return
      leaving.current = given.id
      setTarget(null)
      toast({ message: t('account.devices.revoke.already') })
      void refresh()
    },
  })
  const all = useMutation({
    ...askedNow,
    mutationFn: async () => {
      unwrap(await api.DELETE('/me/sessions'))
    },
    onSuccess: () => {
      // This browser's session went with the rest: the app asks who is signed in, and is told.
      session.retry()
    },
  })

  const sessions = [...(read.data?.sessions ?? [])].sort(
    (one, other) =>
      Number(other.is_current === true) - Number(one.is_current === true) ||
      (other.last_seen_at ?? '').localeCompare(one.last_seen_at ?? ''),
  )
  const devices = read.data?.devices ?? []
  const current = sessions.find((each) => each.is_current === true)
  const alone = devices.length === 0 && sessions.every((each) => each.is_current === true)

  const seen = (at: string | undefined, place?: string | null): string | undefined => {
    if (at === undefined) return undefined
    const when = format.instant(at, zone)
    // The place a request came from, where the server names one: never where the member was.
    return place === undefined || place === null || place === ''
      ? t('account.devices.seen', { when })
      : t('account.devices.seen_from', { when, place })
  }
  const thisBrowser = <span className={styles.badge}>{t('account.devices.this_browser')}</span>
  const trusted = me.mfa_enabled === true ? ` ${t('account.devices.trusted')}` : ''

  return (
    <SettingsPage title={t('account.devices.title')}>
      <div ref={view} tabIndex={-1} className={styles.view}>
        <StateFrame
          state={revoke.isPending ? 'syncing' : readState(read, online, alone)}
          skeleton={
            <Skeleton
              bars={[
                [45, 1.25],
                [70, 1],
                [50, 1.25],
                [65, 1],
              ]}
            />
          }
          // One row, and no teaching state: there is nothing to set up.
          empty={
            <div className={styles.group}>
              <p className={styles.strong}>{t('account.devices.only.title')}</p>
              <List label={t('account.devices.browsers.title')}>
                <ListRow
                  title={names.ofAgent(current?.user_agent ?? window.navigator.userAgent)}
                  secondary={seen(current?.last_seen_at, current?.approximate_location)}
                  trailing={thisBrowser}
                />
              </List>
              <p className={styles.note}>{t('account.devices.only.body')}</p>
            </div>
          }
          texts={{
            error: {
              title: t('account.devices.error.title'),
              text: t('account.devices.error.body'),
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
          {({ mark, writes }) => {
            const marked = (kind: Target['kind'], id: string) =>
              revoke.variables?.kind === kind && revoke.variables.id === id ? mark : undefined
            return (
              <>
                <Section title={t('account.devices.browsers.title')}>
                  <List label={t('account.devices.browsers.title')}>
                    {sessions.map((each) => {
                      const name = names.ofAgent(each.user_agent)
                      return (
                        <ListRow
                          key={each.id}
                          title={name}
                          secondary={seen(each.last_seen_at, each.approximate_location)}
                          mark={marked('session', each.id)}
                          trailing={
                            each.is_current === true ? (
                              thisBrowser
                            ) : writes ? (
                              <RowAction
                                name={t('account.devices.sign_out_named', { name })}
                                word={t('account.devices.sign_out')}
                                onPress={() => {
                                  revoke.reset()
                                  setTarget({ kind: 'session', id: each.id, name })
                                }}
                              />
                            ) : undefined
                          }
                        />
                      )
                    })}
                  </List>
                </Section>
                <Section title={t('account.devices.devices.title')}>
                  {devices.length === 0 ? (
                    <p className={styles.note}>{t('account.devices.devices.none')}</p>
                  ) : (
                    <List label={t('account.devices.devices.title')}>
                      {devices.map((each) => {
                        const name = names.ofDevice(each)
                        return (
                          <ListRow
                            key={each.id}
                            title={name}
                            secondary={seen(each.last_seen_at)}
                            mark={marked('device', each.id)}
                            trailing={
                              writes ? (
                                <>
                                  <RowAction
                                    name={t('account.devices.rename.named', { name })}
                                    word={t('account.devices.rename.action')}
                                    onPress={() => {
                                      setRenaming(each)
                                    }}
                                  />
                                  <RowAction
                                    name={t('account.devices.sign_out_named', { name })}
                                    word={t('account.devices.sign_out')}
                                    onPress={() => {
                                      revoke.reset()
                                      setTarget({ kind: 'device', id: each.id, name })
                                    }}
                                  />
                                </>
                              ) : undefined
                            }
                          />
                        )
                      })}
                    </List>
                  )}
                </Section>
                {writes ? (
                  <div className={styles.section}>
                    <p className={styles.note}>{t('account.devices.note')}</p>
                    <div className={styles.actions}>
                      <Button
                        onClick={() => {
                          all.reset()
                          setEverywhere(true)
                        }}
                      >
                        {t('account.devices.everywhere.action')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            )
          }}
        </StateFrame>
      </div>

      {target === null ? null : (
        <Dialog
          open
          onClose={() => {
            if (!revoke.isPending) setTarget(null)
          }}
          title={t('account.devices.revoke.title', { name: target.name })}
          description={`${
            target.kind === 'session'
              ? t('account.devices.revoke.browser')
              : t('account.devices.revoke.device')
          }${trusted}`}
          actions={
            <>
              <Button
                onClick={() => {
                  if (!revoke.isPending) setTarget(null)
                }}
              >
                {t('account.devices.revoke.keep')}
              </Button>
              <Button
                variant="danger"
                loading={revoke.isPending}
                onClick={() => {
                  revoke.mutate(target)
                }}
              >
                {t('account.devices.sign_out_named', { name: target.name })}
              </Button>
            </>
          }
        >
          {revoke.isError && problemIn(revoke.error)?.status !== 404 ? (
            <Banner tone="danger" announce>
              {say(revoke.error)}
            </Banner>
          ) : undefined}
        </Dialog>
      )}

      {everywhere ? (
        <Dialog
          open
          onClose={() => {
            if (!all.isPending) setEverywhere(false)
          }}
          title={t('account.devices.everywhere.title')}
          description={`${t('account.devices.everywhere.body')}${trusted}`}
          actions={
            <>
              <Button
                onClick={() => {
                  if (!all.isPending) setEverywhere(false)
                }}
              >
                {t('account.devices.everywhere.keep')}
              </Button>
              <Button
                variant="danger"
                // Busy until this browser has been told it is signed out, and is on its way.
                loading={all.isPending || all.isSuccess}
                onClick={() => {
                  all.mutate()
                }}
              >
                {t('account.devices.everywhere.action')}
              </Button>
            </>
          }
        >
          {all.isError ? (
            <Banner tone="danger" announce>
              {say(all.error)}
            </Banner>
          ) : undefined}
        </Dialog>
      ) : null}

      {renaming === null ? null : (
        <Rename
          device={renaming}
          name={names.ofDevice(renaming)}
          onDone={() => {
            setRenaming(null)
            void refresh()
          }}
          onClose={() => {
            setRenaming(null)
          }}
        />
      )}
    </SettingsPage>
  )
}
