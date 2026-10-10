// The twelve-state harness (plan item 28, 02-components §0): the eight data-bearing bodies a
// phone draws, each in twelve states, each state in both themes, at 200 % text. It is a dev-only
// screen: what the app's own accessibility rules are held over (harness.test.tsx), what the
// end-to-end flow opens on a device, and where a reviewer sees every state a screen will have
// before any screen has it.
//
// A theme is a scope around each cell, which paints its own ground from the scope's tokens
// (display/DisplayProvider.tsx). The text scale is the display's alone, so the screen holds it
// at 200 % for as long as it is open; the toolbar's own hold, taken later, is over it, which is
// how the harness is seen at 100 %.
import type { Theme } from '@household/tokens/native'
import { useEffect, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { ThemeScope, useDisplay, useTheme } from '../../display/DisplayProvider.tsx'
import { Button } from '../../ui/Button.tsx'
import { EmptyState } from '../../ui/EmptyState.tsx'
import { OfflineBar } from '../../ui/OfflineBar.tsx'
import { Skeleton } from '../../ui/Skeleton.tsx'
import { StateFrame } from '../../ui/StateFrame.tsx'
import { dataStates, treatments, type DataState } from '../../ui/states.ts'
import { Text } from '../../ui/Text.tsx'
import { DevScreen } from '../DevScreen.tsx'
import { useSample } from '../sample.ts'
import { BodyOf } from './bodies.tsx'
import {
  bodies,
  bodyIds,
  cellId,
  cellThemes,
  states,
  variantId,
  variantIds,
  variants,
  type BodyId,
  type VariantId,
} from './model.ts'

/** The scale the harness holds the text at: the most a reader's text is drawn at. */
const heldScale = 2

/** The least a cell is wide before two stand side by side: a phone's width, more or less. */
const cellWidth = 320

function Cell({
  body,
  state,
  variant,
}: {
  readonly body: BodyId
  readonly state: DataState
  readonly variant?: VariantId
}) {
  const sample = useSample()
  const { empty, skeleton, error, rejected, withdrawn, readonly } = bodies[body]
  const treatment = treatments[state]
  return (
    <>
      {/* It was there when the screen opened, as every cell's state was: read in its place. */}
      {treatment.offline ? <OfflineBar announce={false} /> : null}
      <StateFrame
        state={state}
        skeleton={<Skeleton bars={skeleton} />}
        empty={
          <EmptyState
            sentence={sample(empty.sentence)}
            example={sample(empty.example)}
            action={<Button variant="primary">{sample(empty.action)}</Button>}
            {...(body === 'list' ? { composition: 'utilities.not_enough' as const } : {})}
          />
        }
        texts={{
          error: {
            text: sample(error),
            actions: <Button>{sample('Try again')}</Button>,
          },
          rejected: {
            title: sample('Not accepted'),
            text: sample(rejected),
            actions: (
              <>
                <Button>{sample('Retry')}</Button>
                <Button>{sample('Edit')}</Button>
                <Button variant="ghost">{sample('Discard')}</Button>
              </>
            ),
          },
          withdrawn: {
            text: sample(withdrawn),
            actions: <Button>{sample('Back')}</Button>,
          },
          // No action: the app links to no purchase (PRD 04 §6), and nothing else answers it.
          readonly: {
            title: sample('Read-only'),
            text: sample(readonly),
          },
        }}
      >
        {(context) => <BodyOf body={body} variant={variant} sample={sample} {...context} />}
      </StateFrame>
    </>
  )
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

/** One state of one body, in both themes: side by side where there is the room, else stacked. */
function Pair({
  body,
  state,
  variant,
  name,
  rule,
}: {
  readonly body: BodyId
  readonly state: DataState
  readonly variant?: VariantId
  readonly name: string
  readonly rule?: string
}) {
  const sample = useSample()
  const theme = useTheme()
  const idOf = (cell: Theme) =>
    variant === undefined ? cellId(body, state, cell) : variantId(variant, cell)
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
            <Ground testID={idOf(cell)}>
              <Cell body={body} state={state} {...(variant === undefined ? {} : { variant })} />
            </Ground>
          </ThemeScope>
        ))}
      </View>
    </View>
  )
}

export default function Harness() {
  const sample = useSample()
  const theme = useTheme()
  const { hold } = useDisplay()
  // Every body, or the one a reader narrowed the screen to: the whole of it is two hundred cells.
  const [only, setOnly] = useState<BodyId | null>(null)

  useEffect(() => hold({ scale: heldScale }), [hold])

  const shown = bodyIds.filter((id) => only === null || only === id)
  return (
    <DevScreen page="harness" title={sample('Twelve states')}>
      <Text>
        {sample(
          'Eight bodies, twelve states, two themes. Every cell is built from the same treatment table, at 200 % text.',
        )}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['space-1'] }}>
        <Button
          testID="harness:only:all"
          variant={only === null ? 'primary' : 'secondary'}
          accessibilityState={{ selected: only === null }}
          onPress={() => {
            setOnly(null)
          }}
        >
          {sample('Every body')}
        </Button>
        {bodyIds.map((id) => (
          <Button
            key={id}
            testID={`harness:only:${id}`}
            variant={only === id ? 'primary' : 'secondary'}
            accessibilityState={{ selected: only === id }}
            onPress={() => {
              setOnly(id)
            }}
          >
            {sample(bodies[id].name)}
          </Button>
        ))}
      </View>
      {shown.map((id) => (
        <View key={id} testID={`harness:body:${id}`} style={{ gap: theme.space['space-3'] }}>
          <View style={{ gap: theme.space['space-05'] }}>
            <Text step="title-3" header>
              {sample(bodies[id].name)}
            </Text>
            <Text color="text-muted">{sample(bodies[id].note)}</Text>
          </View>
          {dataStates.map((state) => (
            <Pair
              key={state}
              body={id}
              state={state}
              name={states[state].name}
              rule={states[state].rule}
            />
          ))}
          {variantIds
            .filter((variant) => variants[variant].body === id)
            .map((variant) => (
              <Pair
                key={variant}
                body={id}
                state="populated"
                variant={variant}
                name={variants[variant].name}
              />
            ))}
        </View>
      ))}
    </DevScreen>
  )
}
