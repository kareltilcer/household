// The sync UI in its states (plan item 25; A-37, F-5 to F-10), on one dev-only page: the offline
// bar and its not-receiving sentence, the inbox in each state it has, the two resolvers, the
// kept-loser banner, a row in each state a module's screen draws it in, the not-enough tile with
// its action, and the sentence for a write that needs a connection. Each state is drawn in both
// themes, side by side, as the harness draws its bodies.
//
// No entity the server serves is written offline yet, so no real replica has any of this to show:
// the page draws the app's own components over a stand-in replica (standIn.ts) and fixture
// answers (fixtures.ts), with describers of its own. What a shipped component says comes from
// the catalogs; the page's own words, and what a member would have written, are fixtures, in no
// catalog (D-154), and accented under the pseudo-locale with the rest.
//
// A panel is opened from the page, never drawn open: a modal makes everything else inert. The
// end-to-end suite opens each from a cell it finds by `data-sync-cell` (model.ts).
import type { RecordedOutcome } from '@household/sync'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { useFormat, useTranslate } from '../../i18n/I18nProvider.tsx'
import type { Describers } from '../../sync/describe.ts'
import { InboxView } from '../../sync/Inbox.tsx'
import { KeptLoser } from '../../sync/KeptLoser.tsx'
import { SyncFixture, type Sync } from '../../sync/ReplicaProvider.tsx'
import { Resolver } from '../../sync/Resolver.tsx'
import { markOf, needsConnectionText, useRowState, withdrawnText } from '../../sync/rowState.ts'
import type { Setting } from '../../sync/setting.ts'
import { Banner, OfflineBar } from '../../ui/Banner.tsx'
import { Button } from '../../ui/Button.tsx'
import { ModuleChip } from '../../ui/Chip.tsx'
import { List, ListRow } from '../../ui/ListRow.tsx'
import { MetricTile } from '../../ui/MetricTile.tsx'
import { StateFrame } from '../../ui/StateFrame.tsx'
import { DevToolbar } from '../DevToolbar.tsx'
import { useSample, type Sample } from '../sample.ts'
import styles from './DevSync.module.css'
import {
  conflict,
  describersFor,
  overriddenMerge,
  registry,
  rejectionWith,
  replacingMerge,
  settingFor,
} from './fixtures.ts'
import {
  cellId,
  cellThemes,
  inboxCases,
  inboxStates,
  refusalCodes,
  rowCases,
  rowStates,
  watched,
  type InboxCell,
  type RowCell,
} from './model.ts'
import { rowKey, standIn } from './standIn.ts'

/** A water meter's own unit, as its record names it: a symbol, and no word of any language. */
const cubicMetres = 'm³'

/** What every cell of the page is drawn with. */
interface Fixtures {
  readonly sample: Sample
  readonly describers: Describers
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
  readonly children: () => ReactNode
}) {
  const sample = useSample()
  const heading = useId()
  return (
    <article className={styles.state} aria-labelledby={heading}>
      <h3 id={heading} className={styles.stateName}>
        {sample(name)}
      </h3>
      {rule === undefined ? null : <p className={styles.rule}>{sample(rule)}</p>}
      <div className={styles.pair}>
        {cellThemes.map((theme) => (
          <div
            key={theme}
            className={styles.cell}
            data-theme={theme}
            data-sync-cell={cellId(section, state, theme)}
          >
            {children()}
          </div>
        ))}
      </div>
    </article>
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
  return (
    <section className={styles.section} aria-labelledby={`sync-${id}`}>
      <h2 id={`sync-${id}`} className={styles.sectionName}>
        {sample(name)}
      </h2>
      <p className={styles.note}>{sample(note)}</p>
      <div className={styles.states}>{children}</div>
    </section>
  )
}

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
  /** Where the page's one watched row stands. */
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
      replica: phase === 'open' ? { phase, ...stand.opened } : { phase },
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
      {facts.online ? null : <OfflineBar />}
      <InboxView setting={setting} describers={describers} />
    </StandInReplica>
  )
}

/** A control for each answer, each opening the panel a row's mark would. */
function Openers({
  answers,
  setting,
  describers,
}: {
  readonly answers: readonly { readonly name: string; readonly outcome: RecordedOutcome }[]
  readonly setting: Setting
  readonly describers: Describers
}) {
  const [opened, setOpened] = useState<RecordedOutcome>()
  return (
    <StandInReplica entries={answers.map((answer) => answer.outcome)}>
      <div className={styles.openers}>
        {answers.map(({ name, outcome }) => (
          <Button
            key={outcome.mutation_id}
            onClick={() => {
              setOpened(outcome)
            }}
          >
            {name}
          </Button>
        ))}
      </div>
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
 * state carries, the panel the mark opens, the banner of a merge, and the sentence that stands
 * in its place once it is withdrawn.
 */
function WatchedRow({ sample, describers }: Fixtures) {
  const t = useTranslate()
  const setting = useMemo(() => settingFor(sample), [sample])
  const { state, since } = useRowState(watched.table, watched.id)
  const [opened, setOpened] = useState<RecordedOutcome>()
  // Until the replica has said where the row stands there is nothing to draw of it: a screen
  // draws its row's own skeleton meanwhile, which this page has none of.
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

export function DevSync() {
  const sample = useSample()
  const t = useTranslate()
  const format = useFormat()
  const describers = useMemo(() => describersFor(sample), [sample])
  const fixtures: Fixtures = { sample, describers }
  const writing = useMemo(() => settingFor(sample), [sample])
  const refusals = refusalCodes.map((code) => ({
    name: sample(`Not accepted: ${code}`),
    outcome: rejectionWith(code),
  }))
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{sample('Sync UI')}</h1>
        <p className={styles.lead}>
          {sample(
            'The inbox, its resolvers and a row’s own states, over a stand-in replica and fixture answers. No entity the server serves is written offline yet, so nothing here can be reached on real data.',
          )}
        </p>
        <DevToolbar />
      </header>

      <Section
        id="bar"
        name="Offline bar"
        note="Persistent and unobtrusive: a read looks the same with it as without. With the browser online and the sync service down, it says the household’s changes are not arriving, and that everything else works."
      >
        <Pair section="bar" state="offline" name="Offline">
          {() => <OfflineBar />}
        </Pair>
        <Pair section="bar" state="not-receiving" name="Not receiving changes">
          {() => <OfflineBar sentence={t('sync.not_receiving')} />}
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
        note="Each control opens the side panel a row’s mark would: the comparison for a conflict, and the reason for a change that was not accepted, one for every code a refusal is recorded with and one for a code that has no sentence of its own."
      >
        <Pair section="resolvers" state="conflict" name="Conflict resolver">
          {() => (
            <Openers
              answers={[{ name: sample('Two versions of a settlement'), outcome: conflict }]}
              setting={writing}
              describers={describers}
            />
          )}
        </Pair>
        <Pair section="resolvers" state="rejected" name="Rejected-mutation resolver">
          {() => <Openers answers={refusals} setting={writing} describers={describers} />}
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
    </div>
  )
}
