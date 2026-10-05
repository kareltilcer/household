// One body, twelve states (02-components §0): the frame applies a state's treatment (states.ts)
// to whatever body it is given. It draws the skeleton, the teaching empty state or the message
// that stands in the body's place, the strip above a rejected or a read-only body, and nothing at
// all for a member who may not see it. The body is told which row mark it carries and whether the
// affordances that write are drawn: where they are not, they are absent, never disabled.
import type { ReactNode } from 'react'
import { Banner } from './Banner.tsx'
import styles from './StateFrame.module.css'
import type { SyncState } from './StatusMark.tsx'
import { treatments, type DataState, type Treatment } from './states.ts'

export interface StateText {
  /** What the state is, in two or three words, where the sentence alone would not say. */
  readonly title?: string
  /** The sentence, written for this body: never a shared "Something went wrong". */
  readonly text: string
  /** What answers it. Not drawn in a state that writes nothing, unless it only navigates. */
  readonly actions?: ReactNode
}

export interface BodyContext {
  /** The sync mark the body's affected row carries. */
  readonly mark: SyncState | undefined
  /** Whether to draw the affordances that write. */
  readonly writes: boolean
}

export interface StateFrameProps {
  readonly state: DataState
  /** The body's own shape, for `loading`. */
  readonly skeleton: ReactNode
  /** The body's own teaching empty state, for `empty`. */
  readonly empty: ReactNode
  /** The sentences of the states that have one. A state whose sentence is left out draws its body bare. */
  readonly texts: Partial<Record<'error' | 'rejected' | 'withdrawn' | 'readonly', StateText>>
  readonly children: (context: BodyContext) => ReactNode
}

function textOf(state: DataState, texts: StateFrameProps['texts']): StateText | undefined {
  return state === 'error' || state === 'rejected' || state === 'withdrawn' || state === 'readonly'
    ? texts[state]
    : undefined
}

export function StateFrame({ state, skeleton, empty, texts, children }: StateFrameProps) {
  const treatment: Treatment = treatments[state]
  const text = textOf(state, texts)
  switch (treatment.kind) {
    case 'absent':
      // Gone: no label, no placeholder, nothing that says something would have been here.
      return null
    case 'skeleton':
      return skeleton
    case 'teach':
      return empty
    case 'message':
      return text === undefined ? null : (
        <Banner tone={treatment.message ?? 'neutral'} title={text.title} actions={text.actions}>
          {text.text}
        </Banner>
      )
    case 'body':
      return (
        <div className={styles.frame}>
          {treatment.banner === undefined || text === undefined ? null : (
            <Banner tone={treatment.banner} title={text.title} actions={text.actions}>
              {text.text}
            </Banner>
          )}
          {children({ mark: treatment.mark, writes: treatment.writes })}
        </div>
      )
  }
}
