// A diagnostic bundle (A-33; FR-PS1, PRD 10 §6, D-142): what it holds, how it is put together
// from what this browser knows, and what of it is sent once its member has taken parts out. This
// file is data and pure functions, with nothing of React's: the screen draws what `bodyOf`
// answers, and sends that same object.
//
// A bundle is metadata and nothing else. Platform staff cannot read a household's content (D-3),
// and a bundle is the one thing that reaches them, so it holds what says how the replica stands
// and no value any member wrote: no row, no field, no name, no file. The replica keeps, with each
// answer it recorded, the row the answer carried and the mutation it answered, which is what the
// member wrote. `lineOf` takes the six things of an answer that are about it and leaves those
// two behind, with the server's own message, which is a developer's English about the row.
//
// The server reads none of a bundle (D-142): its shape is this file's to choose. It is a part
// to a top-level name of `payload`, so that a part taken out is a name that is not there, and
// `redacted_fields` lists those names.
import type { components } from '@household/api'
import type { RecordedOutcome, Replica } from '@household/sync'
import { sameId } from '../account/common.ts'
import type { Browser, System } from '../account/userAgent.ts'
import type { Report } from './data.ts'

/** What `postMeDiagnostics` takes. */
export type BundleBody = components['schemas']['DiagnosticBundle']

/** An answer the replica recorded, as a bundle carries it: what it was, and nothing it held. */
export interface OutcomeLine {
  readonly mutation_id: string
  readonly entity_type: string
  readonly op: string
  readonly outcome: string
  readonly code: string | null
  readonly answered_at: string
}

/** `outcome` as a bundle carries it. Its row, its mutation and its message are left behind. */
export function lineOf(outcome: RecordedOutcome): OutcomeLine {
  return {
    mutation_id: outcome.mutation_id,
    entity_type: outcome.entity_type,
    op: outcome.op,
    outcome: outcome.outcome,
    code: outcome.code,
    answered_at: outcome.answered_at,
  }
}

/** How many of the replica's answers a bundle carries: the last ones, as the prototype's forty. */
export const outcomesCarried = 40

/** The last answers of `outcomes`, which is oldest first, each as a bundle carries it. */
export function linesOf(outcomes: readonly RecordedOutcome[]): OutcomeLine[] {
  return outcomes.slice(-outcomesCarried).map(lineOf)
}

/** Whether this tab holds the household's replica, and why not where it does not. */
export type ReplicaHeld = 'open' | 'elsewhere' | 'unavailable'

/** The parts of a bundle, each a name of `payload`. */
export interface Parts {
  /** The build, as the app names itself to the server, and the browser it runs in. */
  readonly client: {
    readonly name: string
    readonly browser: Browser | null
    readonly system: System | null
  }
  /** The language the app is shown in, the locale it formats in, and the member's zone. */
  readonly locale: {
    readonly language: string
    readonly formats: string
    readonly time_zone: string
  }
  /** Whose bundle it is and what it is about, as ids: no name is among them. */
  readonly ids: {
    readonly member: string
    readonly household: string
    readonly replica: string | null
  }
  /** How this browser's replica stands as the bundle is built. */
  readonly sync: {
    readonly replica: ReplicaHeld
    readonly online: boolean
    readonly receiving: boolean | null
    readonly queued: number | null
    readonly held: number | null
  }
  /**
   * What the replica last reported of itself, as the server kept it. Absent where the server
   * lists no report of this replica, or could not be asked.
   */
  readonly report?: {
    readonly reported_at: string | null
    readonly checkpoint: string | null
    readonly checksum_failures: number
    readonly digest_mismatch_entity_types: readonly string[]
    readonly marked_to_download_again: boolean
  }
  /** The last answers the replica recorded that were not a plain *applied*. */
  readonly outcomes: readonly OutcomeLine[]
}

export type PartId = keyof Parts

/** The parts in the order a bundle lists them. */
export const partIds = [
  'client',
  'locale',
  'ids',
  'sync',
  'report',
  'outcomes',
] as const satisfies readonly PartId[]

/** A bundle as it was built when its screen opened. */
export interface Bundle {
  /** The screen it is about: the address its member came from. */
  readonly screen: string
  readonly household: string
  readonly parts: Parts
}

/** What this browser's replica said of itself as the bundle was built. */
export interface ReplicaFacts {
  readonly held: ReplicaHeld
  readonly id: string | null
  readonly queued: number | null
  readonly heldBack: number | null
  readonly receiving: boolean | null
  readonly outcomes: readonly RecordedOutcome[]
}

/** What a bundle asks of a replica. */
export type Asked = Pick<Replica, 'id' | 'queued' | 'held' | 'outcomes'>

/**
 * What this browser's replica says of itself now: `replica` where this tab holds it, and
 * otherwise why it does not (`elsewhere`, or it keeps none). A replica whose database fails
 * under the questions says nothing, as one this browser could not open.
 */
export async function factsOf(
  replica: Asked | undefined,
  elsewhere: boolean,
  receiving: boolean | null,
): Promise<ReplicaFacts> {
  const none = (held: ReplicaHeld): ReplicaFacts => ({
    held,
    id: null,
    queued: null,
    heldBack: null,
    receiving: null,
    outcomes: [],
  })
  if (replica === undefined) return none(elsewhere ? 'elsewhere' : 'unavailable')
  try {
    const [id, queued, held, outcomes] = await Promise.all([
      replica.id(),
      replica.queued(),
      replica.held(),
      replica.outcomes(),
    ])
    return { held: 'open', id, queued, heldBack: held.length, receiving, outcomes }
  } catch {
    return none('unavailable')
  }
}

export interface Known {
  readonly screen: string
  readonly household: string
  readonly member: string
  readonly client: Parts['client']
  readonly locale: Parts['locale']
  readonly online: boolean
  readonly replica: ReplicaFacts
  /** The reader's replicas as the server lists them, or undefined where it could not be asked. */
  readonly reports: readonly Report[] | undefined
}

/** The longest `screen` the server takes, in characters. */
export const screenLimit = 200

/** The longest reference a member may type, in characters. */
export const referenceLimit = 200

/** The bundle of what is `known`. */
export function compose(known: Known): Bundle {
  const { replica } = known
  const reported =
    replica.id === null
      ? undefined
      : known.reports?.find((each) => sameId(each.replica_id, replica.id))
  return {
    screen: Array.from(known.screen).slice(0, screenLimit).join(''),
    household: known.household,
    parts: {
      client: known.client,
      locale: known.locale,
      ids: { member: known.member, household: known.household, replica: replica.id },
      sync: {
        replica: replica.held,
        online: known.online,
        receiving: replica.receiving,
        queued: replica.queued,
        held: replica.heldBack,
      },
      ...(reported === undefined
        ? {}
        : {
            report: {
              reported_at: reported.last_report_at ?? null,
              checkpoint: reported.checkpoint ?? null,
              checksum_failures: reported.checksum_failures ?? 0,
              digest_mismatch_entity_types: reported.digest_mismatch_entity_types ?? [],
              marked_to_download_again: reported.needs_resnapshot === true,
            },
          }),
      outcomes: linesOf(replica.outcomes),
    },
  }
}

/** The parts `bundle` holds, in a bundle's order: every one but a report nothing gave. */
export function heldParts(bundle: Bundle): PartId[] {
  return partIds.filter((id) => bundle.parts[id] !== undefined)
}

/**
 * What is sent of `bundle` under `id`, with the parts in `out` taken out: each is absent from
 * `payload` and named in `redacted_fields`, in a bundle's order. `reference` is what its member
 * typed, or nothing.
 */
export function bodyOf(
  bundle: Bundle,
  id: string,
  out: ReadonlySet<PartId>,
  reference: string,
): BundleBody {
  const held = heldParts(bundle)
  const typed = reference.trim()
  return {
    id,
    screen: bundle.screen,
    household_id: bundle.household,
    ...(typed === '' ? {} : { ticket_reference: typed }),
    payload: Object.fromEntries(
      held.filter((part) => !out.has(part)).map((part) => [part, bundle.parts[part]]),
    ),
    redacted_fields: held.filter((part) => out.has(part)),
  }
}

/** `body` as text, set out to be read: the same object that is sent, and nothing beside it. */
export function textOf(body: BundleBody): string {
  return JSON.stringify(body, null, 2)
}
