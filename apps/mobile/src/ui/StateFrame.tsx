// One body, twelve states (02-components §0): the frame applies a state's treatment (states.ts)
// to whatever body it is given. It draws the skeleton, the teaching empty state or the message
// that stands in the body's place, the strip above a rejected or a read-only body, and nothing at
// all for a member who may not see it. The body is told which row mark it carries and whether the
// affordances that write are drawn: where they are not, they are absent, never disabled. A
// sentence of a state the frame comes to while it is drawn is announced; one it opened on is not.
//
// The frame has no element of its own to give the focus to: a body whose *Try again* leaves with
// its sentence is given a place for the focus by its screen, which knows what stands around it.
// The contract is the web's (apps/web/src/ui/StateFrame.tsx).
import { useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { Banner } from './Banner.tsx'
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

/** The states whose message stands in the body's place: `error` and `withdrawn`, by the table. */
type MessageState = {
  [State in DataState]: (typeof treatments)[State]['kind'] extends 'message' ? State : never
}[DataState]

/** The states that put a strip above the body: `rejected` and `readonly`, by the table. */
type StripState = {
  [State in DataState]: (typeof treatments)[State] extends { readonly banner: string }
    ? State
    : never
}[DataState]

export interface StateFrameProps {
  readonly state: DataState
  /** The body's own shape, for `loading`. */
  readonly skeleton: ReactNode
  /** The body's own teaching empty state, for `empty`. */
  readonly empty: ReactNode
  /**
   * The sentences of the states that have one. The two that stand in the body's place are always
   * given: with no sentence there would be nothing where the body was, and a failed load would
   * be a blank screen. A strip's may be left out, and its body is then drawn bare.
   */
  readonly texts: Readonly<Record<MessageState, StateText>> & Partial<Record<StripState, StateText>>
  readonly children: (context: BodyContext) => ReactNode
}

function standsInPlace(state: DataState): state is MessageState {
  return treatments[state].kind === 'message'
}

function hasStrip(state: DataState): state is StripState {
  return 'banner' in treatments[state]
}

export function StateFrame({ state, skeleton, empty, texts, children }: StateFrameProps) {
  const theme = useTheme()
  // The state the frame was first drawn in was there when the screen opened, and its sentence is
  // read in its place. A state it comes to later arrived while the member was here, and nothing
  // moved the focus to it: its sentence is announced (Banner), or a member who does not see the
  // screen is not told that a load failed, a write was refused or a row was taken back.
  const [opened, setOpened] = useState<DataState | null>(state)
  if (opened !== null && opened !== state) setOpened(null)
  const arrived = opened !== state

  if (standsInPlace(state)) {
    const { title, text, actions } = texts[state]
    return (
      // Each state's sentence is a banner of its own, so that one which takes another's place is
      // announced as one that arrives is, and not as a change to what was there.
      <Banner
        key={state}
        tone={treatments[state].message}
        title={title}
        actions={actions}
        announce={arrived}
      >
        {text}
      </Banner>
    )
  }
  const treatment: Treatment = treatments[state]
  switch (treatments[state].kind) {
    case 'absent':
      // Gone: no label, no placeholder, nothing that says something would have been here.
      return null
    case 'skeleton':
      return skeleton
    case 'teach':
      return empty
    case 'body': {
      const strip = hasStrip(state) ? texts[state] : undefined
      return (
        <View style={{ gap: theme.space['space-15'] }}>
          {treatment.banner === undefined || strip === undefined ? null : (
            <Banner
              key={state}
              tone={treatment.banner}
              title={strip.title}
              actions={strip.actions}
              announce={arrived}
            >
              {strip.text}
            </Banner>
          )}
          {children({ mark: treatment.mark, writes: treatment.writes })}
        </View>
      )
    }
  }
}
