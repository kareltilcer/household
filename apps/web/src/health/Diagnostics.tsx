// The diagnostic bundle (A-33, `/households/{id}/settings/sync/diagnostics`; PRD 02 FR-PS1,
// PRD 10 §6, D-142), reached from sync health: how content bugs are looked into without anybody
// reading content. It is built when the screen opens, drawn whole before anything leaves, part
// by part with each part the member can leave out and put back, and sent only on their press
// (`postMeDiagnostics`). The member is the one who decided to share, and they saw what they
// shared.
//
// A bundle is metadata (bundle.ts): which build and browser, the language and the zone, three
// ids, how this browser's copy stands, what it last reported, and the last answers it recorded
// that were not a plain save, each as what it was and never as what it held. The prototype's
// two parts that carried content, the row being looked at and a log with typed text in it, are
// not built: PRD 10 §6 says no field values, and with none there is no file or row to redact,
// only parts to leave out. A part left out is absent from what is sent and named in
// `redacted_fields`; the page it is about and the household are the request's own and always go.
//
// What is drawn is what is sent. Each part is read in the catalog's words, and under the parts
// the request stands as text, the very object that is sent: the one place a contract's own word
// is on a page, since there it is the thing itself and no label for it. The server reads none of
// it and there is no reading it back (D-142): once sent, the screen says so, with the bundle's
// id as the reference to quote and the day the server says it is kept until.
//
// The bundle's id is made as the screen opens, and again whenever what would be sent changes: a
// press repeated after an answer that never came names the same bundle, which the server keeps
// once, and a bundle with a part since left out is another one, so that the one kept is never
// one its member had taken something out of.
//
// A-33 is drawn *populated*: the bundle. Before that it is *loading*, while this browser's copy
// is asked and its last report read; *offline* is the bundle as it was built, and a send that
// says it could not reach the server. Nothing here is a read that fails in the body's place: a
// last report that could not be read is a part the bundle says it does not hold. It is every
// member's, in every state of the household: the operation is the account's and no gate's, so
// nothing is *absent* or *read-only*; and nothing is *pending*, a bundle being sent now or not
// at all.
import { newId } from '@household/api'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import account from '../account/Settings.module.css'
import { refocus, useData, useNoWithdrawal } from '../account/common.ts'
import { agentOf, useClientNames } from '../account/userAgent.ts'
import { useApi } from '../api/ApiProvider.tsx'
import { clientName } from '../api/client.ts'
import { problemIn, unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { inHousehold, isOwnPath } from '../app/paths.ts'
import { fieldCodes, useRefusedField } from '../auth/fields.tsx'
import { notTheirs, useRereadWhereRefused } from '../household/data.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { HouseholdSettingsPage, Section } from '../household/settings/Page.tsx'
import { useTimeZone } from '../household/timezone.ts'
import { useFormat, useI18n, useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import { useReplica, useSync } from '../sync/ReplicaProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Checkbox } from '../ui/Choice.tsx'
import { cx } from '../ui/cx.ts'
import { TextField } from '../ui/Field.tsx'
import { KeyValue, type Pair } from '../ui/KeyValue.tsx'
import { List } from '../ui/ListRow.tsx'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import { useToast } from '../ui/Toast.tsx'
import {
  bodyOf,
  compose,
  factsOf,
  heldParts,
  referenceLimit,
  textOf,
  type Bundle,
  type PartId,
} from './bundle.ts'
import { useSyncState } from './data.ts'
import styles from './Health.module.css'

/** The address a bundle is about: the one its member came from, where the link that led here said. */
function cameFrom(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null || !('from' in state)) return undefined
  const { from } = state
  return typeof from === 'string' && isOwnPath(from) ? from : undefined
}

/** What the server answered a bundle it kept. */
interface Sent {
  /** The reference to quote: the bundle's own id. */
  readonly reference: string
  /** When the server deletes it, where it said. */
  readonly expires: string | undefined
}

/** A part of the bundle, by its name and what it holds, each in the catalog's words. */
function useParts(bundle: Bundle | null, unread: boolean) {
  const t = useTranslate()
  const format = useFormat()
  const zone = useTimeZone()
  const names = useClientNames()
  const data = useData()
  if (bundle === null) return undefined
  const { parts } = bundle
  const yesNo = (value: boolean) =>
    value ? t('health.diagnostics.value.yes') : t('health.diagnostics.value.no')
  const count = (value: number | null) => (value === null ? undefined : format.number(value))
  const name = (id: PartId): string => {
    switch (id) {
      case 'client':
        return t('health.diagnostics.part.client')
      case 'locale':
        return t('health.diagnostics.part.locale')
      case 'ids':
        return t('health.diagnostics.part.ids')
      case 'sync':
        return t('health.diagnostics.part.sync')
      case 'report':
        return t('health.diagnostics.part.report')
      case 'outcomes':
        return t('health.diagnostics.part.outcomes')
    }
  }
  const pairs = (id: PartId): Pair[] => {
    switch (id) {
      case 'client':
        return [
          {
            key: t('health.diagnostics.label.build'),
            value: data(parts.client.name),
            numeric: true,
          },
          {
            key: t('health.diagnostics.label.browser'),
            value: names.ofBrowser(parts.client.browser, parts.client.system),
          },
        ]
      case 'locale':
        return [
          {
            key: t('health.diagnostics.label.language'),
            value: data(parts.locale.language),
            numeric: true,
          },
          {
            key: t('health.diagnostics.label.formats'),
            value: data(parts.locale.formats),
            numeric: true,
          },
          {
            key: t('health.diagnostics.label.zone'),
            value: data(parts.locale.time_zone),
            numeric: true,
          },
        ]
      case 'ids':
        return [
          {
            key: t('health.diagnostics.label.member'),
            value: data(parts.ids.member),
            numeric: true,
          },
          {
            key: t('health.diagnostics.label.household'),
            value: data(parts.ids.household),
            numeric: true,
          },
          {
            key: t('health.diagnostics.label.replica'),
            value: parts.ids.replica === null ? undefined : data(parts.ids.replica),
            numeric: true,
          },
        ]
      case 'sync':
        return [
          {
            key: t('health.diagnostics.label.copy'),
            value:
              parts.sync.replica === 'open'
                ? t('health.diagnostics.value.copy_here')
                : parts.sync.replica === 'elsewhere'
                  ? t('health.diagnostics.value.copy_elsewhere')
                  : t('health.diagnostics.value.copy_none'),
          },
          {
            key: t('health.diagnostics.label.connection'),
            value: parts.sync.online
              ? t('health.diagnostics.value.online')
              : t('health.diagnostics.value.offline'),
          },
          {
            key: t('health.diagnostics.label.receiving'),
            value:
              parts.sync.receiving === null
                ? t('health.diagnostics.value.unknown')
                : yesNo(parts.sync.receiving),
          },
          {
            key: t('health.diagnostics.label.queued'),
            value: count(parts.sync.queued),
            numeric: true,
          },
          { key: t('health.diagnostics.label.held'), value: count(parts.sync.held), numeric: true },
        ]
      case 'report': {
        const { report } = parts
        if (report === undefined) return []
        return [
          {
            key: t('health.diagnostics.label.reported'),
            value:
              report.reported_at === null ? undefined : format.instant(report.reported_at, zone),
          },
          {
            key: t('health.diagnostics.label.checkpoint'),
            value: report.checkpoint === null ? undefined : data(report.checkpoint),
            numeric: true,
          },
          {
            key: t('health.diagnostics.label.checksums'),
            value: format.number(report.checksum_failures),
            numeric: true,
          },
          {
            key: t('health.diagnostics.label.mismatches'),
            value: format.number(report.digest_mismatch_entity_types.length),
            numeric: true,
          },
          {
            key: t('health.diagnostics.label.again'),
            value: yesNo(report.marked_to_download_again),
          },
        ]
      }
      case 'outcomes':
        return [
          {
            key: t('health.diagnostics.label.outcomes'),
            value: format.number(parts.outcomes.length),
            numeric: true,
          },
        ]
    }
  }
  /** What a part's pairs do not say of it: one sentence, where there is one. */
  const note = (id: PartId): string | undefined => {
    switch (id) {
      case 'ids':
        return t('health.diagnostics.note.ids')
      case 'outcomes':
        return parts.outcomes.length === 0
          ? t('health.diagnostics.note.outcomes_none')
          : t('health.diagnostics.note.outcomes')
      default:
        return undefined
    }
  }
  /** Why the bundle holds no last report, the one part that something else has to give. */
  const noReport =
    parts.report !== undefined
      ? undefined
      : parts.sync.replica !== 'open'
        ? t('health.diagnostics.note.report_no_copy')
        : unread
          ? t('health.diagnostics.note.report_unread')
          : t('health.diagnostics.note.report_none')
  return { name, pairs, note, noReport }
}

export function Diagnostics() {
  const t = useTranslate()
  const format = useFormat()
  const api = useApi()
  const me = useMe()
  const household = useHousehold()
  const zone = useTimeZone()
  const online = useOnline()
  const { locale } = useI18n()
  const data = useData()
  const say = useProblemText(zone)
  const toast = useToast()
  const withdrawn = useNoWithdrawal()
  const location = useLocation()
  const { replica: held, receiving } = useSync()
  const replica = useReplica()

  // What this browser's copy last reported is the server's to say: the bundle waits for the
  // answer, or for there to be none, and is then built once.
  const read = useSyncState(household.id)
  const reports = read.data
  // The list's own refusal says its reader is in the household no longer: it is read again, as
  // sync health reads it over the same list.
  useRereadWhereRefused(household.id, notTheirs(read))
  const settled = read.fetchStatus !== 'fetching'
  const screen = cameFrom(location.state) ?? location.pathname
  const [bundle, setBundle] = useState<Bundle | null>(null)
  // Whether the server's list was unread as the bundle was built: why it holds no last report is
  // said of the bundle that is drawn, and not of a list read since.
  const [unread, setUnread] = useState(false)
  const { phase } = held
  const { id: householdId } = household
  const { id: member } = me
  const { locale: formats } = format
  useEffect(() => {
    if (bundle !== null || phase === 'opening' || !settled) return undefined
    let stopped = false
    const agent = agentOf(window.navigator.userAgent)
    void factsOf(replica, phase === 'elsewhere', receiving).then((facts) => {
      if (stopped) return
      setUnread(reports === undefined)
      setBundle(
        compose({
          screen,
          household: householdId,
          member,
          client: {
            name: clientName(),
            browser: agent.browser ?? null,
            system: agent.system ?? null,
          },
          locale: { language: locale, formats, time_zone: zone },
          online,
          replica: facts,
          reports,
        }),
      )
    })
    return () => {
      stopped = true
    }
  }, [
    bundle,
    phase,
    settled,
    replica,
    receiving,
    screen,
    householdId,
    member,
    locale,
    formats,
    zone,
    online,
    reports,
  ])

  const [id, setId] = useState(() => newId())
  const [out, setOut] = useState<ReadonlySet<PartId>>(() => new Set())
  const [reference, setReference] = useState('')
  const [sent, setSent] = useState<Sent | null>(null)
  const parts = useParts(bundle, unread)
  const body = bundle === null ? undefined : bodyOf(bundle, id, out, reference)

  const send = useMutation({
    ...askedNow,
    mutationFn: async (given: NonNullable<typeof body>) =>
      unwrap(await api.POST('/me/diagnostics', { body: given })),
    onSuccess: (answer, given) => {
      const kept = answer.id ?? given.id ?? id
      setSent({ reference: kept, expires: answer.expires_at })
      // Said wherever its member is by then, and not by this screen alone: a bundle cannot be
      // read back, and somebody who went back before the answer would never learn its reference.
      toast({ message: t('health.diagnostics.sent.said', { reference: data(kept) }) })
    },
  })
  // What was typed as the reference is the one thing of the bundle its member wrote: a refusal
  // that names it is said beside it, and the focus is moved there.
  const refusedReference = fieldCodes(send.error).has('/ticket_reference')
  const refused = useRefusedField(refusedReference ? send.error : undefined)

  // The form left with the button that sent it, and the focus with the button: it is put where
  // the screen now says that the bundle was sent.
  const view = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (sent !== null) refocus(view.current)
  }, [sent])

  const back = (
    <Link className={account.link} to={inHousehold.syncHealth(household.id)}>
      {t('health.diagnostics.back')}
    </Link>
  )

  return (
    <HouseholdSettingsPage
      title={t('health.diagnostics.title')}
      lead={t('health.diagnostics.lead')}
      note={false}
    >
      <div ref={view} tabIndex={-1} className={cx(account.view, styles.stack)}>
        {sent !== null ? (
          <>
            {/* Said by the toast, as it arrived: read here in its place. */}
            <Banner tone="info" title={t('health.diagnostics.sent.title')}>
              <p className={account.text}>
                {t('health.diagnostics.sent.reference', { reference: data(sent.reference) })}
              </p>
              <p className={account.text}>
                {sent.expires === undefined
                  ? t('health.diagnostics.sent.kept')
                  : t('health.diagnostics.sent.kept_until', {
                      day: format.dayOf(sent.expires, zone),
                    })}
              </p>
            </Banner>
            {back}
          </>
        ) : (
          <StateFrame
            state={bundle === null ? 'loading' : online ? 'populated' : 'offline'}
            skeleton={
              <Skeleton
                bars={[
                  [40, 1.25],
                  [75, 1],
                  [60, 1],
                  [45, 1.25],
                  [70, 1],
                ]}
              />
            }
            // No state of this screen: a bundle is never nothing, and no read stands in its
            // place. The frame asks for the sentence of every state that could.
            empty={null}
            texts={{ error: { title: t('ui.error.title'), text: t('ui.error.body') }, withdrawn }}
          >
            {() =>
              bundle === null || parts === undefined || body === undefined ? null : (
                <form
                  ref={refused}
                  className={styles.stack}
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault()
                    send.mutate(body)
                  }}
                >
                  <Section
                    title={t('health.diagnostics.always.title')}
                    note={t('health.diagnostics.always.note')}
                  >
                    <KeyValue
                      pairs={[
                        {
                          key: t('health.diagnostics.label.screen'),
                          value: data(bundle.screen),
                          numeric: true,
                        },
                        {
                          key: t('health.diagnostics.label.household'),
                          value: data(bundle.household),
                          numeric: true,
                        },
                        {
                          key: t('health.diagnostics.label.id'),
                          value: data(id),
                          numeric: true,
                        },
                      ]}
                    />
                  </Section>
                  <Section
                    title={t('health.diagnostics.parts.title')}
                    note={t('health.diagnostics.parts.note')}
                  >
                    <List label={t('health.diagnostics.parts.title')}>
                      {heldParts(bundle).map((part) => {
                        const left = out.has(part)
                        const said = parts.note(part)
                        return (
                          <li key={part} className={styles.part}>
                            <Checkbox
                              label={parts.name(part)}
                              checked={!left}
                              // Said of the box too, which takes no press while a bundle is sent.
                              aria-disabled={send.isPending || undefined}
                              onChange={(event) => {
                                // A bundle on its way is the one that was read: what it holds
                                // is not changed under its answer.
                                if (send.isPending) return
                                const sends = event.currentTarget.checked
                                // Another bundle than the one that might have been sent.
                                setId(newId())
                                setOut((was) => {
                                  const next = new Set(was)
                                  if (sends) next.delete(part)
                                  else next.add(part)
                                  return next
                                })
                              }}
                            />
                            {left ? (
                              <p className={styles.detail}>{t('health.diagnostics.parts.out')}</p>
                            ) : null}
                            <div className={left ? styles.out : undefined}>
                              <KeyValue pairs={parts.pairs(part)} />
                            </div>
                            {said === undefined ? null : <p className={styles.detail}>{said}</p>}
                          </li>
                        )
                      })}
                    </List>
                    {parts.noReport === undefined ? null : (
                      <p className={account.note}>{parts.noReport}</p>
                    )}
                    <p className={account.note}>{t('health.diagnostics.parts.never')}</p>
                  </Section>
                  <Section
                    title={t('health.diagnostics.exact.title')}
                    note={t('health.diagnostics.exact.note')}
                  >
                    <pre className={styles.exact}>{data(textOf(body))}</pre>
                  </Section>
                  <Section title={t('health.diagnostics.send.title')}>
                    <div className={account.form}>
                      <TextField
                        label={t('health.diagnostics.reference.label')}
                        help={t('health.diagnostics.reference.help')}
                        maxLength={referenceLimit}
                        autoComplete="off"
                        value={reference}
                        // Nor is the reference typed over while its bundle is on its way.
                        readOnly={send.isPending}
                        error={
                          refusedReference ? t('health.diagnostics.reference.invalid') : undefined
                        }
                        onChange={(event) => {
                          if (send.isPending) return
                          setId(newId())
                          setReference(event.currentTarget.value)
                        }}
                      />
                    </div>
                    {send.isError && !refusedReference ? (
                      <Banner key={send.submittedAt} tone="danger" announce>
                        {problemIn(send.error)?.code === 'validation_failed'
                          ? t('health.diagnostics.refused')
                          : say(send.error)}
                      </Banner>
                    ) : null}
                    <p className={account.note}>{t('health.diagnostics.send.note')}</p>
                    <div className={account.actions}>
                      <Button type="submit" variant="primary" loading={send.isPending}>
                        {t('health.diagnostics.send.action')}
                      </Button>
                      {back}
                    </div>
                  </Section>
                </form>
              )
            }
          </StateFrame>
        )}
      </div>
    </HouseholdSettingsPage>
  )
}
