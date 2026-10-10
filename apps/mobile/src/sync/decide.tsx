// A member's decision about a change that was not saved as they made it (F-6, F-7), as each
// resolver carries it out: one at a time, and said where it comes to nothing. Every decision is a
// write to the replica on this device alone (ADR 0019): `retry` writes the change again as a new
// one and gives the old one up, `discard` gives it up, `resolve` marks it seen. None of them is
// undone, and none is written to the activity log, so neither is said. A retry reports whether
// it wrote: a row this device no longer holds is written by nothing, and the member is told so
// where they would otherwise think the change was on its way.
import { useCallback, useState } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'

/**
 * What a decision came to, where it did not do what was asked: `nothing` for one that wrote
 * nothing, and `failed` for one the replica could not carry out, which changed nothing either.
 */
export type Trouble = 'nothing' | 'failed'

export interface Decision<Kind extends string> {
  /** The decision under way, which takes no second press. */
  readonly busy: Kind | null
  readonly trouble: Trouble | null
  /**
   * Carries out `act`, and calls `done` once it has done what was asked. `act` answers whether
   * it wrote; one that only gives a change up answers true.
   */
  readonly decide: (kind: Kind, act: () => Promise<boolean>, done: () => void) => void
}

export function useDecision<Kind extends string>(): Decision<Kind> {
  const [busy, setBusy] = useState<Kind | null>(null)
  const [trouble, setTrouble] = useState<Trouble | null>(null)
  const decide = useCallback(
    (kind: Kind, act: () => Promise<boolean>, done: () => void) => {
      if (busy !== null) return
      setBusy(kind)
      setTrouble(null)
      void (async () => {
        try {
          if (await act()) done()
          else setTrouble('nothing')
        } catch {
          setTrouble('failed')
        } finally {
          setBusy(null)
        }
      })()
    },
    [busy],
  )
  return { busy, trouble, decide }
}

/** What a decision came to, in words, announced as it arrives. */
export function TroubleBanner({ trouble }: { readonly trouble: Trouble | null }) {
  const t = useTranslate()
  if (trouble === null) return null
  return (
    // Each its own banner, so that one which follows the other is announced as it arrives.
    <Banner
      key={trouble}
      tone={trouble === 'failed' ? 'danger' : 'warning'}
      testID={`sync:trouble:${trouble}`}
      announce
    >
      {t(trouble === 'failed' ? 'sync.action.failed' : 'device.sync.retry.nothing')}
    </Banner>
  )
}
