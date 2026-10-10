// How the processor's word is waited for once it has taken a confirmation (D-134): the
// subscription is read again this often, this many times, and no longer. The server hears of a
// payment or a method from the processor, seconds later as a rule and with no bound: a page that
// read once would say nothing had changed, and one that read for ever would never say that it
// does not know. A file of its own, so that a test waits a moment and not ten seconds.
export const confirmationReads = {
  /** Milliseconds between one read and the next. */
  every: 2000,
  /** How many reads are made before the screen says the processor has not said yet. */
  times: 5,
} as const
