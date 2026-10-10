// The sync UI in its states (plan item 28; A-37, F-5 to F-10), on one dev-only screen: the
// offline bar and its not-receiving sentence, the inbox in each state it has, the two resolvers,
// the kept-loser banner, a row in each state a module's screen draws it in, the not-enough tile
// with its action, and the sentence for a write that needs a connection. Each state is drawn in
// both themes, as the harness draws its bodies. The web's page is its twin
// (apps/web/src/dev/sync/DevSync.tsx).
//
// No entity the server serves is written offline yet, so no real replica has any of this to
// show: the screen draws the app's own components over a stand-in replica (sync/standIn.ts) and
// fixture answers (sync/sync.fixtures.ts), with describers of its own. What a shipped component
// says comes from the catalogs; the screen's own words, and what a member would have written,
// are fixtures, in no catalog (D-154), and accented under the pseudo-locale with the rest.
//
// A sheet is opened from the screen, never drawn open: a modal stands over everything else.
//
// One part of it is no fixture: with somebody signed in, the first of their households that
// opens has its real replica opened here, and the screen says in lines an end-to-end flow reads
// whether it is open and whether it is receiving, and has it report itself when asked, which is
// how the flow sees the server name this device among the household's clients (D-178). That is
// the one thing of the replica only a device can show: nothing on a developer's machine opens
// its SQLite.
import type { RecordedOutcome, Replica } from '@household/sync'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { ThemeScope, useTheme } from '../../display/DisplayProvider.tsx'
import { opening, useHousehold, useHouseholds } from '../../household/data.ts'
import { useFormat, useTranslate } from '../../i18n/I18nProvider.tsx'
import { useSession } from '../../session/context.ts'
import type { Describers } from '../../sync/describe.ts'
import { HouseholdBars } from '../../sync/HouseholdBars.tsx'
import { InboxView } from '../../sync/Inbox.tsx'
import { KeptLoser } from '../../sync/KeptLoser.tsx'
import {
  ReplicaProvider,
  SyncFixture,
  useInbox,
  useSync,
  type Sync,
} from '../../sync/ReplicaProvider.tsx'
import { Resolver } from '../../sync/Resolver.tsx'
import { markOf, needsConnectionText, useRowState, withdrawnText } from '../../sync/rowState.ts'
import type { Setting } from '../../sync/setting.ts'
import { rowKey, standIn } from '../../sync/standIn.ts'
import {
  conflict,
  describersFor,
  overriddenMerge,
  refusalCodes,
  registry,
  rejectionWith,
  replacingMerge,
  settingFor,
  type Sample,
} from '../../sync/sync.fixtures.ts'
import { Banner } from '../../ui/Banner.tsx'
import { Button } from '../../ui/Button.tsx'
import { ModuleChip } from '../../ui/Chip.tsx'
import { List, ListRow } from '../../ui/ListRow.tsx'
import { MetricTile } from '../../ui/MetricTile.tsx'
import { OfflineBar } from '../../ui/OfflineBar.tsx'
import { StateFrame } from '../../ui/StateFrame.tsx'
import { Text } from '../../ui/Text.tsx'
import { DevScreen } from '../DevScreen.tsx'
import { Shown } from '../Only.tsx'
import { useSample } from '../sample.ts'
import {
  cellId,
  cellThemes,
  inboxCases,
  inboxStates,
  rowCases,
  rowStates,
  watched,
  type InboxCell,
  type RowCell,
} from './model.ts'

/** A water meter's own unit, as its record names it: a symbol, and no word of any language. */
const cubicMetres = 'm³'

/** The least a cell is wide before two stand side by side: a phone's width, more or less. */
const cellWidth = 320

/**
 * The screen's sections, which it can be narrowed to (Only.tsx): by the names their `testID`s
 * carry, `sync:section:<id>`. Narrowed to the live one, the only offline bar on the screen is
 * the real replica's own.
 */
const sections = [
  'live',
  'bar',
  'inbox',
  'resolvers',
  'kept',
  'row',
  'honesty',
  'connection',
] as const

/** What every cell of the screen is drawn with. */
interface Fixtures {
  readonly sample: Sample
  readonly describers: Describers
}

/** A cell's own ground, in the theme of the scope it stands in. */
function Ground({ testID, children }: { readonly testID: string; readonly children: ReactNode }) {
  const theme = useTheme()
  return (
    <View
      testID={testID}
      style={{
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: cellWidth,
        gap: theme.space['space-15'],
        padding: theme.space['space-2'],
        backgroundColor: theme.color.surface,
        borderWidth: 1,
        borderColor: theme.color.border,
        borderRadius: theme.radii['radius-card'],
      }}
    >
      {children}
    </View>
  )
}

/** One state, in both themes: its name, the rule it keeps, and a cell of each theme. */
function Pair({
  section,
  state,
  name,
  rule,
  children,
}: {
  readonly section: string
  readonly state: string
  readonly name: string
  readonly rule?: string
  /** Draws the cell, which is told its own name: what it draws is found under it. */
  readonly children: (cell: string) => ReactNode
}) {
  const sample = useSample()
  const theme = useTheme()
  return (
    <View style={{ gap: theme.space['space-1'] }}>
      <Text weight={600} header>
        {sample(name)}
      </Text>
      {rule === undefined ? null : (
        <Text step="caption" color="text-muted">
          {sample(rule)}
        </Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['space-1'] }}>
        {cellThemes.map((cell) => (
          <ThemeScope key={cell} theme={cell}>
            <Ground testID={cellId(section, state, cell)}>
              {children(cellId(section, state, cell))}
            </Ground>
          </ThemeScope>
        ))}
      </View>
    </View>
  )
}

function Section({
  id,
  name,
  note,
  children,
}: {
  readonly id: string
  readonly name: string
  readonly note: string
  readonly children: ReactNode
}) {
  const sample = useSample()
  const theme = useTheme()
  return (
    <Shown part={id}>
      <View testID={`sync:section:${id}`} style={{ gap: theme.space['space-3'] }}>
        <View style={{ gap: theme.space['space-05'] }}>
          <Text step="title-3" header>
            {sample(name)}
          </Text>
          <Text color="text-muted">{sample(note)}</Text>
        </View>
        {children}
      </View>
    </Shown>
  )
}

/** Nothing to ask again: a fixture's replica is none. */
const never = () => undefined

/** A stand-in replica of its own for whatever is drawn inside, in the state of sync it is given. */
function StandInReplica({
  entries = [],
  online = true,
  receiving = true,
  phase = 'open',
  row,
  children,
}: {
  readonly entries?: readonly RecordedOutcome[]
  readonly online?: boolean
  readonly receiving?: boolean | null
  readonly phase?: Sync['replica']['phase']
  /** Where the screen's one watched row stands. */
  readonly row?: RowCell
  readonly children: ReactNode
}) {
  // Made once for the cell: what a member decides in one theme's cell leaves the other's as it was.
  const [stand] = useState(() =>
    standIn({
      registry,
      entries,
      ...(row === undefined
        ? {}
        : { rows: { [rowKey(watched.table, watched.id)]: rowCases[row].state } }),
    }),
  )
  const value = useMemo<Sync>(
    () => ({
      replica:
        phase === 'open'
          ? { phase, ...stand.opened }
          : phase === 'unavailable'
            ? { phase, retry: never }
            : { phase },
      online,
      receiving: phase === 'open' ? receiving : null,
    }),
    [phase, stand, online, receiving],
  )
  return <SyncFixture value={value}>{children}</SyncFixture>
}

function InboxCellBody({ state, sample, describers }: Fixtures & { readonly state: InboxCell }) {
  const { facts, receiving } = inboxCases[state]
  const setting = useMemo(() => settingFor(sample, { writes: facts.writes }), [sample, facts])
  return (
    <StandInReplica
      entries={facts.entries}
      online={facts.online}
      receiving={receiving}
      phase={facts.phase}
    >
      {/* It was there when the screen opened, as every cell's state was: read in its place. */}
      {facts.online ? null : <OfflineBar announce={false} />}
      <InboxView setting={setting} describers={describers} />
    </StandInReplica>
  )
}

/** A control for each answer, each opening the sheet a row's mark would. */
function Openers({
  cell,
  answers,
  setting,
  describers,
}: {
  readonly cell: string
  readonly answers: readonly { readonly name: string; readonly outcome: RecordedOutcome }[]
  readonly setting: Setting
  readonly describers: Describers
}) {
  const theme = useTheme()
  const [opened, setOpened] = useState<RecordedOutcome>()
  return (
    <StandInReplica entries={answers.map((answer) => answer.outcome)}>
      <View style={{ alignItems: 'flex-start', gap: theme.space['space-1'] }}>
        {answers.map(({ name, outcome }) => (
          <Button
            key={outcome.mutation_id}
            testID={`${cell}:open:${outcome.code ?? outcome.mutation_id}`}
            onPress={() => {
              setOpened(outcome)
            }}
          >
            {name}
          </Button>
        ))}
      </View>
      <Resolver
        outcome={opened}
        onClose={() => {
          setOpened(undefined)
        }}
        setting={setting}
        describers={describers}
      />
    </StandInReplica>
  )
}

/**
 * One row as a module's screen draws it: the state the replica reports for it, the mark that
 * state carries, the sheet the mark opens, the banner of a merge, and the sentence that stands
 * in its place once it is withdrawn.
 */
function WatchedRow({ sample, describers }: Fixtures) {
  const t = useTranslate()
  const setting = useMemo(() => settingFor(sample), [sample])
  const { state, since } = useRowState(watched.table, watched.id)
  const [opened, setOpened] = useState<RecordedOutcome>()
  // Until the replica has said where the row stands there is nothing to draw of it: a screen
  // draws its row's own skeleton meanwhile, which this screen has none of.
  if (state === undefined) return null
  const answer =
    state.kind === 'conflict' || state.kind === 'rejected' || state.kind === 'merged'
      ? state.outcome
      : undefined
  return (
    <StateFrame
      state={state.kind === 'withdrawn' ? 'withdrawn' : 'populated'}
      skeleton={null}
      empty={null}
      texts={{
        error: { text: sample('Could not load this settlement.') },
        withdrawn: withdrawnText(t, state.kind === 'withdrawn' ? state.reason : 'access'),
      }}
    >
      {() => (
        <>
          {state.kind === 'merged' ? (
            <KeptLoser outcome={state.outcome} setting={setting} describers={describers} />
          ) : null}
          <List label={sample('Settlements')}>
            <ListRow
              title={sample('March electricity settlement')}
              secondary={sample('Due 15 March')}
              chip={<ModuleChip module="finance" />}
              mark={markOf(state)}
              syncingSince={since}
              onOpenMark={() => {
                setOpened(answer)
              }}
            />
          </List>
          <Resolver
            outcome={opened}
            onClose={() => {
              setOpened(undefined)
            }}
            setting={setting}
            describers={describers}
          />
        </>
      )}
    </StateFrame>
  )
}

/** A line of the live replica's: what it is, and how it stands, which is also its `testID`. */
function Line({
  of,
  stands,
  children,
}: {
  readonly of: string
  readonly stands: string
  readonly children: string
}) {
  return <Text testID={`sync:live:${of}:${stands}`}>{children}</Text>
}

/** How a report asked for here stands: not asked, waiting for the replica to catch up, or answered. */
type Reported = 'never' | 'waiting' | 'sent' | 'refused' | 'failed'

/**
 * Has the replica report itself now, and says what that came to. A replica reports by itself
 * every quarter of an hour, and a household's clients are read off those reports (D-178), so a
 * flow that wants to see this device named there asks here. It reports once it has caught up,
 * as every report waits to: one made before would be read as a copy that does not match.
 */
function Report({ replica }: { readonly replica: Replica }) {
  const sample = useSample()
  const [stands, setStands] = useState<Reported>('never')
  useEffect(() => {
    if (stands !== 'waiting') return undefined
    let asked = false
    const send = () => {
      if (asked || !replica.caughtUp) return
      asked = true
      replica.report().then(
        // Null where the server took none: a write still queued, or a household that takes none.
        (verdict) => {
          setStands(verdict === null ? 'refused' : 'sent')
        },
        () => {
          setStands('failed')
        },
      )
    }
    const unlisten = replica.db.registerListener({ statusChanged: send })
    send()
    return unlisten
  }, [stands, replica])
  return (
    <>
      <Line of="reported" stands={stands}>
        {sample(`Its report: ${stands}`)}
      </Line>
      {/* As wide as its words, and no wider. */}
      <View style={{ alignItems: 'flex-start' }}>
        <Button
          testID="sync:live:report"
          loading={stands === 'waiting'}
          onPress={() => {
            setStands('waiting')
          }}
        >
          {sample('Report this replica now')}
        </Button>
      </View>
    </>
  )
}

/** The lines of a real replica, as the provider around them says it stands. */
function LiveLines({ household }: { readonly household: string }) {
  const sample = useSample()
  const theme = useTheme()
  const { replica, online, receiving } = useSync()
  const waiting = useInbox()
  // The household's own answer, which the provider above reads too: asked once for both.
  const read = useHousehold(household)
  const told = receiving === null ? 'unknown' : receiving ? 'yes' : 'no'
  return (
    <View style={{ gap: theme.space['space-1'] }}>
      {/* The household's own bar, as its screens have it above them. */}
      {read.status === 'read' ? <HouseholdBars household={read.household} /> : null}
      <Line of="replica" stands={replica.phase}>
        {sample(`The replica: ${replica.phase}`)}
      </Line>
      <Line of="receiving" stands={told}>
        {sample(`Receiving changes: ${told}`)}
      </Line>
      <Line of="online" stands={online ? 'yes' : 'no'}>
        {sample(`The device says it is online: ${online ? 'yes' : 'no'}`)}
      </Line>
      <Line of="inbox" stands={waiting === undefined ? 'unread' : String(waiting.length)}>
        {sample(
          `Waiting in its inbox: ${waiting === undefined ? 'not read' : String(waiting.length)}`,
        )}
      </Line>
      {replica.phase === 'open' ? <Report replica={replica.replica} /> : null}
    </View>
  )
}

/** The real replica of whoever is signed in, and a line that says so where nobody is. */
function Live() {
  const sample = useSample()
  const { state } = useSession()
  if (state.status !== 'member') {
    return (
      <Line of="session" stands="none">
        {sample(
          'Nobody is signed in. Sign in on the dev sign-in screen, and a replica is opened here.',
        )}
      </Line>
    )
  }
  return <LiveReplica />
}

/** The real replica of the member's first household that opens (D-162). */
function LiveReplica() {
  const sample = useSample()
  const households = useHouseholds()
  const first = households.data === undefined ? undefined : opening(households.data, null)
  if (first === undefined) {
    return (
      <Line of="household" stands={households.data === undefined ? 'unread' : 'none'}>
        {sample(
          'No household of this member’s has been read, so there is none to open a replica of.',
        )}
      </Line>
    )
  }
  return (
    <ReplicaProvider household={first.id}>
      <LiveLines household={first.id} />
    </ReplicaProvider>
  )
}

export default function DevSync() {
  const sample = useSample()
  const t = useTranslate()
  const format = useFormat()
  const describers = useMemo(() => describersFor(sample), [sample])
  const fixtures: Fixtures = { sample, describers }
  const writing = useMemo(() => settingFor(sample), [sample])
  const reading = useMemo(() => settingFor(sample, { writes: false }), [sample])
  const refusals = refusalCodes.map((code) => ({
    name: sample(`Not accepted: ${code}`),
    outcome: rejectionWith(code),
  }))
  return (
    <DevScreen page="sync" title={sample('Sync UI')} parts={sections}>
      <Text>
        {sample(
          'The inbox, its resolvers and a row’s own states, over a stand-in replica and fixture answers. No entity the server serves is written offline yet, so nothing here but the first section can be reached on real data.',
        )}
      </Text>

      <Section
        id="live"
        name="This device’s replica"
        note="No fixture: the real replica of the first household of whoever is signed in, opened here as a household’s own screens open it. What it says is what a device alone can show."
      >
        <Live />
      </Section>

      <Section
        id="bar"
        name="Offline bar"
        note="Persistent and unobtrusive: a read looks the same with it as without. With the device online and the sync service down, it says the household’s changes are not arriving, and that everything else works."
      >
        <Pair section="bar" state="offline" name="Offline">
          {() => <OfflineBar announce={false} />}
        </Pair>
        <Pair section="bar" state="not-receiving" name="Not receiving changes">
          {() => <OfflineBar announce={false} sentence={t('sync.not_receiving')} />}
        </Pair>
        <Pair section="bar" state="reading" name="Offline, in a household that takes no writes">
          {() => <OfflineBar announce={false} sentence={t('device.sync.offline.reading')} />}
        </Pair>
        <Pair section="bar" state="settings" name="Offline, where a change is made on the server">
          {() => <OfflineBar announce={false} sentence={t('device.sync.offline.settings')} />}
        </Pair>
      </Section>

      <Section
        id="inbox"
        name="Inbox"
        note="What needs the member’s attention, oldest first. It is the replica’s own table, so it is as local as the changes it lists."
      >
        {inboxStates.map((state) => (
          <Pair
            key={state}
            section="inbox"
            state={state}
            name={inboxCases[state].name}
            rule={inboxCases[state].rule}
          >
            {() => <InboxCellBody state={state} {...fixtures} />}
          </Pair>
        ))}
      </Section>

      <Section
        id="resolvers"
        name="Resolvers"
        note="Each control opens the sheet a row’s mark would: the comparison for a conflict, and the reason for a change that was not accepted, one for every code a refusal is recorded with and one for a code that has no sentence of its own."
      >
        <Pair section="resolvers" state="conflict" name="Conflict resolver">
          {(cell) => (
            <Openers
              cell={cell}
              answers={[{ name: sample('Two versions of a settlement'), outcome: conflict }]}
              setting={writing}
              describers={describers}
            />
          )}
        </Pair>
        <Pair section="resolvers" state="rejected" name="Rejected-mutation resolver">
          {(cell) => (
            <Openers cell={cell} answers={refusals} setting={writing} describers={describers} />
          )}
        </Pair>
        <Pair
          section="resolvers"
          state="readonly"
          name="In a household that takes no writes"
          rule="The comparison draws neither answer. The refused change keeps Discard, behind its confirmation."
        >
          {(cell) => (
            <Openers
              cell={cell}
              answers={[
                { name: sample('Two versions of a settlement'), outcome: conflict },
                { name: sample('Not accepted: forbidden'), outcome: rejectionWith('forbidden') },
              ]}
              setting={reading}
              describers={describers}
            />
          )}
        </Pair>
      </Section>

      <Section
        id="kept"
        name="Kept loser"
        note="What a merge asks a member to see: here it is, and no question. A field they set that the row does not hold, or a version of an entity that keeps its loser which their own replaced."
      >
        <Pair section="kept" state="overridden" name="A field was overridden">
          {() => (
            <StandInReplica entries={[overriddenMerge]}>
              <KeptLoser outcome={overriddenMerge} setting={writing} describers={describers} />
            </StandInReplica>
          )}
        </Pair>
        <Pair section="kept" state="replaced" name="A version was replaced, and kept">
          {() => (
            <StandInReplica entries={[replacingMerge]}>
              <KeptLoser outcome={replacingMerge} setting={writing} describers={describers} />
            </StandInReplica>
          )}
        </Pair>
      </Section>

      <Section
        id="row"
        name="A row’s state"
        note="What a module’s screen draws from the state the replica reports for a row. A row in sync carries no mark: the absence of one is that state."
      >
        {rowStates.map((state) => (
          <Pair
            key={state}
            section="row"
            state={state}
            name={rowCases[state].name}
            rule={rowCases[state].rule}
          >
            {() => (
              <StandInReplica row={state}>
                <WatchedRow {...fixtures} />
              </StandInReplica>
            )}
          </Pair>
        ))}
      </Section>

      <Section
        id="honesty"
        name="Not enough information"
        note="An absence, which names what is missing and offers the one action that supplies it, beside a genuine zero, which is a measurement and is drawn as a figure."
      >
        <Pair section="honesty" state="not-enough" name="Not enough information">
          {() => (
            <MetricTile
              label={sample('Water, garden tap')}
              missing={sample(
                'Two readings on this register produce the first figure. There is one.',
              )}
              action={<Button variant="primary">{sample('Add a reading')}</Button>}
            />
          )}
        </Pair>
        <Pair section="honesty" state="zero" name="A genuine zero">
          {() => (
            <MetricTile
              label={sample('Water, garden tap')}
              value={format.number(0)}
              unit={cubicMetres}
            />
          )}
        </Pair>
      </Section>

      <Section
        id="connection"
        name="Needs a connection"
        note="A write to an entity that is not written offline is refused before it is queued. The screen says so in place of the change, and nothing is greyed out."
      >
        <Pair section="connection" state="needed" name="A write that needs a connection">
          {() => <Banner tone="info">{needsConnectionText(t)}</Banner>}
        </Pair>
      </Section>
    </DevScreen>
  )
}
