// What the storage screen works out from the answers it reads, and draws nothing with (C-54):
// whether a household stores anything, where what it stores stands against its allowance, what
// its lines leave out of the total, and where the columns of its trend stand. Every figure here
// is arithmetic on what the server answered: no allowance, block or price is this file's own.
import { storageWarns } from '@household/domain'
import type { UsageSummary } from '../household/data.ts'
import { moduleKeys } from '../household/households.ts'
import type { StorageReport } from './data.ts'

/**
 * `report` as this build can name it. A module the server has and this build has no word for, one
 * added since the page was loaded, has no line and none of its items is listed: it is drawn as a
 * module its reader cannot see is, in the total and in no line, which the screen then says.
 */
export function named(report: StorageReport): StorageReport {
  const known = ({ module }: { readonly module: string }) =>
    moduleKeys.some((key) => key === module)
  return {
    ...report,
    by_module: report.by_module.filter(known),
    largest: report.largest.filter(known),
  }
}

/**
 * Whether the household stores nothing and, as far as its samples reach, never did: the state
 * the screen teaches in. One that stored something once and removed it has a trend to show and a
 * month's average that may still be billed, and is drawn as any other.
 */
export function storesNothing(report: StorageReport): boolean {
  return report.total_bytes === 0 && report.trend.every((day) => day.bytes === 0)
}

/** Where what a household stores stands against its allowance (PRD 04 §4, FR-BI3). */
export type Standing = 'under' | 'near' | 'reached' | 'ceiling'

/**
 * Where what `report` says is stored stands: at the most a household may store, where uploads
 * stop; at the whole of its allowance, the base and the blocks in effect, where the next block
 * follows the month's average; or at four fifths of it, where its owners are first told. They
 * are the marks the server's own notices go out at (storage.Sampler, `fairuse.Warns`). No answer
 * carries the four fifths, so it is computed here as it is there, by the rule both sides are
 * held to (`storageWarns`, @household/domain; vectors/storage.json).
 *
 * What is stored and the allowance are the picture's own, the two figures the screen draws
 * beside what this comes to, and the month's answer says the same of both. Of that answer only
 * the ceiling is read, and not its `upload_blocked`, which is true as well of a household whose
 * state takes no uploads, whatever it stores: that is the household's own to say
 * (`entitlement.can_upload`), and is no ceiling reached.
 */
export function standingOf(
  report: Pick<StorageReport, 'total_bytes' | 'included_bytes'>,
  usage: Pick<UsageSummary, 'hard_ceiling_bytes'>,
): Standing {
  if (report.total_bytes >= usage.hard_ceiling_bytes) return 'ceiling'
  if (report.total_bytes >= report.included_bytes) return 'reached'
  if (storageWarns(report.total_bytes, report.included_bytes)) return 'near'
  return 'under'
}

/** What a module's line comes to: its files and the copies derived from them. */
export function moduleBytes(line: StorageReport['by_module'][number]): number {
  return line.bytes + line.derived_bytes
}

/**
 * Whether the total counts more than the modules' lines do: something is kept in a module the
 * reader cannot see or the household has off, which has no line (D-108). How much is not said:
 * the line that is absent would say it.
 */
export function hasUnlisted(report: StorageReport): boolean {
  return report.by_module.reduce((sum, line) => sum + moduleBytes(line), 0) < report.total_bytes
}

/** The derived copies of the modules that have a line: previews and thumbnails, in bytes. */
export function derivedBytes(report: StorageReport): number {
  return report.by_module.reduce((sum, line) => sum + line.derived_bytes, 0)
}

/**
 * What the total counts that is in no member's name: the split by member counts every byte that
 * has an owner, whatever its reader sees, so the difference is what has none.
 */
export function unattributedBytes(report: StorageReport): number {
  return Math.max(
    0,
    report.total_bytes - report.by_member.reduce((sum, line) => sum + line.bytes, 0),
  )
}

/** The sample of the trend that held the most, the earliest of them where several did. */
export function fullestDay(
  trend: StorageReport['trend'],
): StorageReport['trend'][number] | undefined {
  return trend.reduce<StorageReport['trend'][number] | undefined>(
    (most, day) => (most === undefined || day.bytes > most.bytes ? day : most),
    undefined,
  )
}

/** The height of the trend's plot, in the units its columns are drawn in. */
export const plotHeight = 100

/** The least a column that holds something is drawn to, so that a small day is still a column. */
const leastColumn = 2

export interface Columns {
  /** How many days the plot spans, from its first sample's to its last's. */
  readonly days: number
  /** A column for each day that was sampled and held something: its place, and how tall it is. */
  readonly bars: readonly { readonly day: number; readonly height: number }[]
}

const dayLength = 24 * 60 * 60 * 1000

/** A calendar day, `YYYY-MM-DD`, as a count of days: the UTC day it names (D-109). */
function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / dayLength)
}

/**
 * Where the trend's columns stand, oldest first as the server lists the samples: each at its own
 * day, so that a day with no sample is a gap as wide as a day and never a line drawn across it,
 * and each as tall as its share of the fullest day. A day that held nothing has no column, and a
 * trend that never held anything has none at all.
 */
export function columnsOf(trend: StorageReport['trend']): Columns {
  const first = trend[0]
  const last = trend.at(-1)
  const top = Math.max(0, ...trend.map((day) => day.bytes))
  if (first === undefined || last === undefined || top === 0) return { days: 0, bars: [] }
  const start = dayNumber(first.date)
  return {
    days: dayNumber(last.date) - start + 1,
    bars: trend
      .filter((day) => day.bytes > 0)
      .map((day) => ({
        day: dayNumber(day.date) - start,
        height: Math.max(leastColumn, (day.bytes / top) * plotHeight),
      })),
  }
}
