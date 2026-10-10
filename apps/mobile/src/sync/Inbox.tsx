// What needs the member's attention in a household (F-5, 06-clients §5, DD-4): the changes they
// made on this device that were not saved as they made them, oldest first, across every module.
// A conflict opens its comparison, a change that was not accepted its reason, and a merge the
// banner that says what became of it. Nothing here is a modal at reconnect: the list waits, in
// the member's own time. The web's is its twin (apps/web/src/sync/Inbox.tsx).
//
// design/v1 has the inbox derived on the server. Under the library it is this replica's own
// table: each mutation's last answer that still asks for attention (ADR 0019), so it is as local
// as the changes it lists, and a change made on the phone is in the phone's. Its states follow
// from that. Loading is the replica being opened; the error is a replica this device could not
// open, which it is asked to open once more, a device having no page to reload. In sync is the
// absence of an indicator, so the empty state teaches nothing: it is one calm sentence. In a
// household that does not write the list is read and nothing in it is sent (FR-BI2): a conflict
// and a refused change still open their sheets, the conflict's with neither answer and the
// refused change's with the one that gives it up, which is this device's own and asks nothing
// of the server, and what is not given up waits as it is until the household writes again. A
// merge asks nothing, and is put away there as anywhere: that is the member's own note that
// they have seen it, and gives no change up.
import type { RecordedOutcome } from '@household/sync'
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import type { Household } from '../household/data.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { announce, focusOn } from '../ui/announce.ts'
import { Button } from '../ui/Button.tsx'
import { ModuleChip } from '../ui/Chip.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { List, ListRow } from '../ui/ListRow.tsx'
import { Screen } from '../ui/Screen.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import type { DataState } from '../ui/states.ts'
import { Text } from '../ui/Text.tsx'
import {
  describers as appDescribers,
  read,
  type Describers,
  type Reading,
  type Words,
} from './describe.ts'
import { useOwn } from './household.ts'
import { KeptLoser, overrode } from './KeptLoser.tsx'
import { useInbox, useReplica, useSync, type ReplicaState } from './ReplicaProvider.tsx'
import { Resolver } from './Resolver.tsx'
import { withdrawnText } from './rowState.ts'
import { useSetting, type Setting } from './setting.ts'
import { instantOf, useWords } from './words.ts'

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
 * household that does not write before a device that is offline, and either before what the
 * entries themselves are.
 */
export function inboxState({ phase, entries, online, writes }: InboxFacts): DataState {
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
            accessibilityState={{ expanded: shown }}
            onPress={() => {
              setShown(!shown)
            }}
          >
            {t('sync.kept.show')}
          </Button>
          {shown ? (
            // A line of its own under the row, as wide as the row.
            <View style={{ flexBasis: '100%', flexGrow: 1 }}>
              <KeptLoser outcome={outcome} setting={setting} describers={describers} />
            </View>
          ) : null}
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
  /** How a module describes its rows. Left out, the app's own; a test and the dev screen give theirs. */
  readonly describers?: Describers | undefined
}

/** The inbox without its screen: every state of it, under whatever title its owner gives it. */
export function InboxView({ setting, describers = appDescribers }: InboxViewProps) {
  const t = useTranslate()
  const theme = useTheme()
  const { replica: held, online, receiving } = useSync()
  const replica = useReplica()
  const entries = useInbox()
  const words = useWords(setting.timezone)
  const state = inboxState({ phase: held.phase, entries, online, writes: setting.writes })

  const [openedId, setOpenedId] = useState<string | null>(null)
  // An answer that left the list while its sheet was open leaves the sheet with it: the replica
  // sent what it was holding, or the member answered it from the row's own screen.
  const opened =
    openedId === null ? undefined : entries?.find((entry) => entry.mutation_id === openedId)

  // The row a sheet was opened from is gone once its answer is given, and the focus the sheet
  // gave back went with it: it is put on the list's own place, where the next row is. Not
  // before the sheet has gone from the screen, which would take the focus back from under it;
  // and by asking the replica whether the answer still waits, since the list drawn here hears
  // of it a moment later on one platform and a moment sooner on the other.
  const place = useRef<View>(null)
  const answering = useRef<string | null>(null)
  const closed = () => {
    const id = answering.current
    answering.current = null
    if (id === null || replica === undefined) return
    replica.inbox().then(
      (waiting) => {
        if (!waiting.some((entry) => entry.mutation_id === id)) focusOn(place)
      },
      // A replica that was closed meanwhile has no list to put the focus on.
      () => undefined,
    )
  }

  const empty = !online
    ? t('sync.inbox.empty_offline')
    : receiving === false
      ? t('sync.inbox.empty_plain')
      : t('sync.inbox.empty')

  // What *Try again* came to is said: the control that was pressed leaves with its sentence,
  // and nothing else tells whoever cannot see the screen that their copy was opened after all.
  // Where it could not be, the sentence that comes back is announced as any that arrives is.
  const retried = useRef(false)
  const arrived = state === 'empty' ? empty : t('sync.inbox.list')
  useEffect(() => {
    if (!retried.current || state === 'error' || state === 'loading') return
    retried.current = false
    announce(arrived)
  }, [state, arrived])

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

  return (
    <View style={{ gap: theme.space['space-2'] }}>
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
        empty={<EmptyState sentence={empty} />}
        texts={{
          error: {
            title: t('sync.inbox.error.title'),
            text: t('device.sync.inbox.error.text'),
            actions:
              held.phase === 'unavailable' ? (
                <Button
                  testID="sync:inbox:retry"
                  onPress={() => {
                    retried.current = true
                    held.retry()
                  }}
                >
                  {t('ui.retry')}
                </Button>
              ) : undefined,
          },
          // No state of the inbox: an entry leaves with a row that was withdrawn. The frame asks
          // for the sentence of every state that stands in a body's place.
          withdrawn: withdrawnText(t, 'access'),
          readonly: {
            title: t('sync.inbox.readonly.title'),
            text: t('device.sync.inbox.readonly.text'),
          },
        }}
      >
        {() => (
          <>
            {/* One thing to a screen reader, and where its focus is put once a row has left. */}
            <View ref={place} accessible>
              <Text color="text-muted">{t('device.sync.inbox.lead')}</Text>
            </View>
            {/* Said where there is something to decide: a household that does not write reads. */}
            {online || !setting.writes ? null : (
              <Text step="caption" color="text-muted">
                {t('device.sync.inbox.offline')}
              </Text>
            )}
            <List label={t('sync.inbox.list')} testID="sync:inbox:list">
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
        onClosed={closed}
        setting={setting}
        describers={describers}
      />
    </View>
  )
}

/** The inbox over the household its address names, once that household has been read. */
function Held({ household }: { readonly household: Household }) {
  const setting = useSetting(household)
  return <InboxView setting={setting} />
}

/**
 * The inbox's screen: its one title, and the inbox under it. The household's frame draws what
 * stands in a screen's place where the household could not be read or is not the member's
 * (shell/HouseholdFrame.tsx): this draws nothing of its own then.
 */
export function Inbox() {
  const t = useTranslate()
  const { household } = useLocalSearchParams<{ household: string }>()
  const own = useOwn(household)
  return (
    <Screen testID="route:sync" title={t('sync.inbox.title')}>
      {own === undefined ? null : <Held household={own.household} />}
    </Screen>
  )
}
