// What needs the member's attention in a household (F-5, 06-clients §5, DD-4): the changes they
// made in this browser that were not saved as they made them, oldest first, across every module.
// A conflict opens its comparison, a change that was not accepted its reason, and a merge the
// banner that says what became of it. Nothing here is a modal at reconnect: the list waits, in
// the member's own time.
//
// design/v1 has the inbox derived on the server. Under the library it is this replica's own
// table: each mutation's last answer that still asks for attention (ADR 0019), so it is as local
// as the changes it lists, and a change made on the phone is in the phone's. Its states follow
// from that. Loading is the replica being opened; the error is a replica this browser could not
// open; and a tab that does not hold the household's replica says so, and what to do, since one
// tab keeps it at a time (ReplicaProvider.tsx). In sync is the absence of an indicator, so the
// empty state teaches nothing: it is one calm sentence.
import type { RecordedOutcome } from '@household/sync'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { ModuleChip } from '../ui/Chip.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { List, ListRow } from '../ui/ListRow.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import type { DataState } from '../ui/states.ts'
import {
  describers as appDescribers,
  read,
  type Describers,
  type Reading,
  type Words,
} from './describe.ts'
import { KeptLoser, overrode } from './KeptLoser.tsx'
import { useInbox, useReplica, useSync, type ReplicaState } from './ReplicaProvider.tsx'
import { Resolver } from './Resolver.tsx'
import { withdrawnText } from './rowState.ts'
import { useSetting, type Setting } from './setting.ts'
import styles from './Sync.module.css'
import { instantOf, useWords } from './words.ts'

/**
 * The inbox's state: one of the twelve (ui/states.ts), or `elsewhere`, which is none of them and
 * the inbox's own, for a tab that does not hold the household's replica.
 */
export type InboxState = DataState | 'elsewhere'

export interface InboxFacts {
  readonly phase: ReplicaState['phase']
  /** What the replica lists, once it is open here and has been read. */
  readonly entries: readonly RecordedOutcome[] | undefined
  readonly online: boolean
  /** Whether the household writes (FR-BI2). */
  readonly writes: boolean
}

/**
 * Which state the inbox is in (F-5's required states: the twelve but pending and syncing, which
 * are a row's and no answer's, and absent and withdrawn, which an entry leaves with its row).
 * Where two hold at once the one that says more of what the member can do comes first: a
 * household that does not write before a browser that is offline, and either before what the
 * entries themselves are.
 */
export function inboxState({ phase, entries, online, writes }: InboxFacts): InboxState {
  if (phase === 'elsewhere') return 'elsewhere'
  if (phase === 'unavailable') return 'error'
  if (phase === 'opening' || entries === undefined) return 'loading'
  if (entries.length === 0) return 'empty'
  if (!writes) return 'readonly'
  if (!online) return 'offline'
  if (entries.some((entry) => entry.outcome === 'rejected')) return 'rejected'
  if (entries.some((entry) => entry.outcome === 'conflict')) return 'conflicted'
  return 'populated'
}

interface EntryProps {
  readonly outcome: RecordedOutcome
  readonly reading: Reading
  readonly words: Words
  readonly setting: Setting
  readonly describers: Describers
  readonly onOpen: () => void
}

/** A merge's row: no mark, since nothing of it is in question, and its banner under it. */
function MergedEntry({ outcome, reading, words, setting, describers }: EntryProps) {
  const t = useTranslate()
  const details = useId()
  const [shown, setShown] = useState(false)
  const when = instantOf(outcome.answered_at, words)
  const fields = overrode(outcome)
  const said =
    when === undefined
      ? t(fields ? 'sync.kept.overridden.title' : 'sync.kept.replaced.title')
      : t(fields ? 'sync.inbox.overridden' : 'sync.inbox.replaced', { when })
  return (
    <ListRow
      title={reading.name}
      secondary={said}
      chip={reading.module === undefined ? undefined : <ModuleChip module={reading.module} />}
      trailing={
        <>
          <Button
            variant="ghost"
            aria-expanded={shown}
            aria-controls={details}
            onClick={() => {
              setShown(!shown)
            }}
          >
            {t('sync.kept.show')}
          </Button>
          <div id={details} className={styles.kept} hidden={!shown}>
            {shown ? (
              <KeptLoser outcome={outcome} setting={setting} describers={describers} />
            ) : null}
          </div>
        </>
      }
    />
  )
}

function Entry(props: EntryProps) {
  const t = useTranslate()
  const { outcome, reading, words, onOpen } = props
  if (outcome.outcome !== 'conflict' && outcome.outcome !== 'rejected') {
    return <MergedEntry {...props} />
  }
  const when = instantOf(outcome.answered_at, words)
  return (
    <ListRow
      title={reading.name}
      secondary={when === undefined ? undefined : t('sync.inbox.since', { when })}
      chip={reading.module === undefined ? undefined : <ModuleChip module={reading.module} />}
      mark={outcome.outcome}
      onOpenMark={onOpen}
    />
  )
}

export interface InboxViewProps {
  readonly setting: Setting
  /** How a module describes its rows. Left out, the app's own; a test and the dev page give theirs. */
  readonly describers?: Describers | undefined
}

/** The inbox without its page: every state of it, under whatever title its owner gives it. */
export function InboxView({ setting, describers = appDescribers }: InboxViewProps) {
  const t = useTranslate()
  const { replica: held, online, receiving } = useSync()
  const replica = useReplica()
  const entries = useInbox()
  const words = useWords(setting.timezone)
  const state = inboxState({ phase: held.phase, entries, online, writes: setting.writes })

  const [openedId, setOpenedId] = useState<string | null>(null)
  // An answer that left the list while its panel was open leaves the panel with it: the replica
  // sent what it was holding, or the member answered it from the row's own screen.
  const opened =
    openedId === null ? undefined : entries?.find((entry) => entry.mutation_id === openedId)

  // The row a panel was opened from is gone once its answer is given, and the focus the panel
  // gave back went with it: it is put on the list's own place, where the next row is.
  const view = useRef<HTMLDivElement>(null)
  const answering = useRef<string | null>(null)
  useEffect(() => {
    const id = answering.current
    if (id === null || entries === undefined) return
    if (entries.some((entry) => entry.mutation_id === id)) return
    answering.current = null
    const focused = document.activeElement
    if (focused === null || focused === document.body) view.current?.focus()
  }, [entries])

  // A state the inbox was first drawn in is read in its place, and one it comes to is announced
  // (ui/StateFrame): the same holds of the one state the frame does not know.
  const [first] = useState(state)
  const [moved, setMoved] = useState(false)
  if (!moved && state !== first) setMoved(true)

  const readings = useMemo(
    () =>
      replica === undefined
        ? []
        : (entries ?? []).map((outcome) => ({
            outcome,
            reading: read(outcome, replica.registry, describers, words, setting.household),
          })),
    [entries, replica, describers, words, setting.household],
  )

  if (state === 'elsewhere') {
    return (
      <Banner tone="info" title={t('sync.inbox.elsewhere.title')} announce={moved}>
        {t('sync.inbox.elsewhere.text')}
      </Banner>
    )
  }
  return (
    <div ref={view} tabIndex={-1} className={styles.view}>
      <StateFrame
        state={state}
        skeleton={
          <Skeleton
            bars={[
              [58, 1],
              [34, 0.8125],
              [70, 1],
              [42, 0.8125],
            ]}
          />
        }
        empty={
          <EmptyState
            sentence={
              !online
                ? t('sync.inbox.empty_offline')
                : receiving === false
                  ? t('sync.inbox.empty_plain')
                  : t('sync.inbox.empty')
            }
          />
        }
        texts={{
          error: {
            title: t('sync.inbox.error.title'),
            text: t('sync.inbox.error.text'),
            actions: (
              <Button
                onClick={() => {
                  window.location.reload()
                }}
              >
                {t('ui.reload')}
              </Button>
            ),
          },
          // No state of the inbox: an entry leaves with a row that was withdrawn. The frame asks
          // for the sentence of every state that stands in a body's place.
          withdrawn: withdrawnText(t, 'access'),
          readonly: { title: t('sync.inbox.readonly.title'), text: t('sync.inbox.readonly.text') },
        }}
      >
        {() => (
          <>
            <p className={styles.lead}>{t('sync.inbox.lead')}</p>
            {online ? null : <p className={styles.aside}>{t('sync.inbox.offline')}</p>}
            <List label={t('sync.inbox.list')}>
              {readings.map(({ outcome, reading }) => (
                <Entry
                  key={outcome.mutation_id}
                  outcome={outcome}
                  reading={reading}
                  words={words}
                  setting={setting}
                  describers={describers}
                  onOpen={() => {
                    answering.current = outcome.mutation_id
                    setOpenedId(outcome.mutation_id)
                  }}
                />
              ))}
            </List>
          </>
        )}
      </StateFrame>
      <Resolver
        outcome={opened}
        onClose={() => {
          setOpenedId(null)
        }}
        setting={setting}
        describers={describers}
      />
    </div>
  )
}

/** The inbox's page: its one title, and the inbox under it. */
export function Inbox() {
  const t = useTranslate()
  const setting = useSetting()
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('sync.inbox.title')}</h1>
      <InboxView setting={setting} />
    </div>
  )
}
