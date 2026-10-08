// The twelve-state harness (plan item 24, 02-components §0): nine data-bearing bodies, each in
// twelve states, each state in both themes side by side, at 200 % text. It is a dev-only route:
// what the end-to-end suite holds to axe, to the pseudo-locale and to the policy, and where a
// reviewer sees every state a screen will have before any screen has it.
//
// A theme is set on each cell, inside a page of whichever theme the browser is in: the tokens'
// stylesheet declares every colour in each theme's block so that this works (ADR 0024). The text
// scale is the root's alone, so the page holds it at 200 % for as long as it is open, and at
// 100 % under `?scale=100`.
import { useEffect, useId } from 'react'
import { useSearchParams } from 'react-router'
import { usePageTitle } from '../../app/title.ts'
import { useDisplay } from '../../display/DisplayProvider.tsx'
import { Button } from '../../ui/Button.tsx'
import { EmptyState } from '../../ui/EmptyState.tsx'
import { OfflineBar } from '../../ui/Banner.tsx'
import { Skeleton } from '../../ui/Skeleton.tsx'
import { StateFrame } from '../../ui/StateFrame.tsx'
import { dataStates, treatments, type DataState } from '../../ui/states.ts'
import { DevToolbar } from '../DevToolbar.tsx'
import { useSample } from '../sample.ts'
import { BodyOf } from './bodies.tsx'
import styles from './Harness.module.css'
import {
  bodies,
  bodyIds,
  cellId,
  cellThemes,
  states,
  variantIds,
  variants,
  type BodyId,
  type VariantId,
} from './model.ts'

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
      {treatment.offline ? <OfflineBar /> : null}
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
          readonly: {
            title: sample('Read-only'),
            text: sample(readonly),
            actions: <Button>{sample('See plans')}</Button>,
          },
        }}
      >
        {(context) => <BodyOf body={body} variant={variant} sample={sample} {...context} />}
      </StateFrame>
    </>
  )
}

/** One state of one body, in both themes. */
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
            data-harness-cell={variant === undefined ? cellId(body, state, theme) : undefined}
            data-harness-variant={variant === undefined ? undefined : `${variant}:${theme}`}
            data-kind={treatments[state].kind}
          >
            <Cell body={body} state={state} {...(variant === undefined ? {} : { variant })} />
          </div>
        ))}
      </div>
    </article>
  )
}

export function Harness() {
  const sample = useSample()
  usePageTitle(sample('Twelve-state harness'))
  const { hold } = useDisplay()
  const [params] = useSearchParams()
  const scale = params.get('scale') === '100' ? '100' : '200'
  const only = params.get('body')

  useEffect(() => hold({ scale }), [hold, scale])

  const shown = bodyIds.filter((id) => only === null || only === id)
  return (
    <div className={styles.harness}>
      <header className={styles.header}>
        <h1 className={styles.title}>{sample('Twelve-state harness')}</h1>
        <p className={styles.lead}>
          {sample(
            'Nine bodies, twelve states, two themes. Every cell is built from the same treatment table, at 200 % text.',
          )}
        </p>
        <DevToolbar />
      </header>
      {shown.map((id) => (
        <section key={id} className={styles.body} aria-labelledby={`harness-${id}`}>
          <h2 id={`harness-${id}`} className={styles.bodyName}>
            {sample(bodies[id].name)}
          </h2>
          <p className={styles.note}>{sample(bodies[id].note)}</p>
          <div className={styles.states}>
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
          </div>
        </section>
      ))}
    </div>
  )
}
