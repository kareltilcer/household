// The bucket checksum failures PowerSync finds, which a replica's report carries (D-125). PowerSync
// verifies each bucket's checksum at every checkpoint and downloads a failing bucket again; it says so
// only in its log, so the replica's database is opened with this logger in front of the one that writes
// the log, which counts the failures it passes on.

import { createConsoleLogger, type LogRecord, type PowerSyncLogger } from '@powersync/common'

/** What the core logs when a checkpoint's checksums disagree with what a replica holds. */
const failure = /checksums didn't match/i

export class ChecksumWatch implements PowerSyncLogger {
  private failures = 0
  private readonly next: PowerSyncLogger

  constructor(next: PowerSyncLogger = createConsoleLogger()) {
    this.next = next
  }

  log(record: LogRecord): void {
    if (failure.test(record.message)) this.failures++
    this.next.log(record)
  }

  /** The failures counted since the last take. */
  get count(): number {
    return this.failures
  }

  /** Forgets the first n failures, which a report has carried. */
  take(n: number): void {
    this.failures = Math.max(0, this.failures - n)
  }
}
