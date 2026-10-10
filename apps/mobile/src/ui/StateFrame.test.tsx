// The frame that applies one of the twelve states (02-components §0) to a body. The table of
// treatments has a test of its own (states.test.ts); the web's `states.test.tsx` is this one's twin.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { screen, type RenderResult } from '@testing-library/react-native'
import { View } from 'react-native'
import type { TestInstance } from 'test-renderer'
import { elementsOf, expectAccessible, rules, violations } from '../test/a11y.ts'
import { render, TestProviders } from '../test/render.tsx'
import * as announcer from './announce.ts'
import { Button } from './Button.tsx'
import { StateFrame, type BodyContext } from './StateFrame.tsx'
import { dataStates, type DataState } from './states.ts'
import { Text } from './Text.tsx'

const words = {
  loading: 'the shape of the body',
  empty: 'No readings on this meter yet.',
  body: 'Electricity, cellar meter',
  open: 'Open',
  error: 'Could not load the readings.',
  again: 'Try again',
  rejected: 'That reading is lower than the one on 3 March.',
  refused: 'Not accepted',
  withdrawn: 'Your access to this changed, so it was removed from this device.',
  readonly: 'The household is read-only. Everything is readable.',
} as const

function Framed({ state }: { readonly state: DataState }) {
  return (
    <StateFrame
      state={state}
      skeleton={<Text>{words.loading}</Text>}
      empty={<Text>{words.empty}</Text>}
      texts={{
        error: { text: words.error, actions: <Button>{words.again}</Button> },
        rejected: { title: words.refused, text: words.rejected },
        withdrawn: { text: words.withdrawn },
        readonly: { text: words.readonly },
      }}
    >
      {({ mark, writes }: BodyContext) => (
        <View testID={`mark:${mark ?? 'none'}`}>
          <Text>{words.body}</Text>
          {writes ? <Button>{words.open}</Button> : null}
        </View>
      )}
    </StateFrame>
  )
}

/** Draws the frame in `state` where `view` drew it in another: the body's state changed. */
async function come(view: RenderResult, state: DataState): Promise<void> {
  await view.rerender(
    <TestProviders>
      <Framed state={state} />
    </TestProviders>,
  )
}

/** Everything the test drew. */
function root(): TestInstance {
  if (screen.root === null) throw new Error('nothing is drawn')
  return screen.root
}

/** The glyphs drawn: a banner's, a mark's. */
function drawings(): number {
  return elementsOf(root()).filter((element) => element.type === 'RNSVGSvgView').length
}

let said: jest.SpiedFunction<typeof announcer.announce>
let saidNow: jest.SpiedFunction<typeof announcer.announceNow>

beforeEach(() => {
  said = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
  saidNow = jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
})
afterEach(() => {
  jest.restoreAllMocks()
})

describe('the state frame', () => {
  it('draws the skeleton, the empty state or the body, and one of them only', async () => {
    const view = await render(<Framed state="loading" />)
    expect(screen.getByText(words.loading)).toBeOnTheScreen()
    expect(screen.queryByText(words.body)).toBeNull()
    await come(view, 'empty')
    expect(screen.getByText(words.empty)).toBeOnTheScreen()
    expect(screen.queryByText(words.body)).toBeNull()
    await come(view, 'populated')
    expect(screen.getByText(words.body)).toBeOnTheScreen()
    expect(screen.queryByText(words.empty)).toBeNull()
  })

  it('draws nothing at all for a member who may not see the body', async () => {
    await render(<Framed state="absent" />)
    // Nothing of the frame's: only what the providers themselves draw.
    expect(root().children).toEqual([])
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('names an error in words, with its action, in the body’s place', async () => {
    await render(<Framed state="error" />)
    expect(screen.getByText(words.error)).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: words.again })).toBeOnTheScreen()
    expect(screen.getByTestId('banner:danger')).toBeOnTheScreen()
    expect(screen.queryByText(words.body)).toBeNull()
    expectAccessible()
  })

  it('says a row was withdrawn in the body’s place, which is no error and no empty state', async () => {
    await render(<Framed state="withdrawn" />)
    expect(screen.getByText(words.withdrawn)).toBeOnTheScreen()
    expect(screen.queryByText(words.body)).toBeNull()
    expect(screen.queryByText(words.empty)).toBeNull()
    expect(screen.getByTestId('banner:neutral')).toBeOnTheScreen()
    expect(screen.queryByTestId('banner:danger')).toBeNull()
  })

  it('says why a write was rejected above the body, which stays and carries the mark', async () => {
    await render(<Framed state="rejected" />)
    expect(screen.getByText(words.refused)).toBeOnTheScreen()
    expect(screen.getByText(words.rejected)).toBeOnTheScreen()
    expect(screen.getByText(words.body)).toBeOnTheScreen()
    expect(screen.getByTestId('mark:rejected')).toBeOnTheScreen()
    expect(screen.getByTestId('banner:danger')).toBeOnTheScreen()
  })

  it('keeps a read-only body readable, explains above it, and draws nothing that writes', async () => {
    await render(<Framed state="readonly" />)
    expect(screen.getByText(words.readonly)).toBeOnTheScreen()
    expect(screen.getByTestId('banner:warning')).toBeOnTheScreen()
    expect(screen.getByText(words.body)).toBeOnTheScreen()
    expect(screen.queryByRole('button', { name: words.open })).toBeNull()
    // Absent, and never disabled: with nothing named as out of its form, nothing may be.
    expect(violations(root(), { rules })).toEqual([])
  })

  it('announces a failure that arrives while the member is here, at once', async () => {
    // A screen opens on its skeleton, and the load fails: nothing moved the focus, so the
    // sentence is said as it arrives, or a member who does not see the screen is told nothing.
    const view = await render(<Framed state="loading" />)
    await come(view, 'error')
    expect(saidNow.mock.calls).toEqual([[words.error]])
    // A write refused under a body that was there: its reason, above the body.
    await come(view, 'populated')
    expect(saidNow).toHaveBeenCalledTimes(1)
    await come(view, 'rejected')
    expect(saidNow.mock.calls).toEqual([[words.error], [`${words.refused}\n${words.rejected}`]])
    expect(said).not.toHaveBeenCalled()
  })

  it('announces what is no failure once the screen reader has finished: a row withdrawn, a body gone read-only', async () => {
    const view = await render(<Framed state="populated" />)
    await come(view, 'withdrawn')
    expect(said.mock.calls).toEqual([[words.withdrawn]])
    await come(view, 'populated')
    await come(view, 'readonly')
    expect(said.mock.calls).toEqual([[words.withdrawn], [words.readonly]])
    expect(saidNow).not.toHaveBeenCalled()
  })

  it('announces a sentence that takes another’s place as one that arrives', async () => {
    const view = await render(<Framed state="populated" />)
    await come(view, 'withdrawn')
    await come(view, 'error')
    expect(said.mock.calls).toEqual([[words.withdrawn]])
    expect(saidNow.mock.calls).toEqual([[words.error]])
  })

  it.each(['error', 'rejected', 'withdrawn', 'readonly'] as const)(
    'announces no %s sentence that was there when the screen opened: it is read in its place',
    async (state) => {
      const view = await render(<Framed state={state} />)
      // Drawn again as it was, it has still not arrived.
      await come(view, state)
      expect(said).not.toHaveBeenCalled()
      expect(saidNow).not.toHaveBeenCalled()
    },
  )

  it('announces the state it opened in when it comes back to it: it arrived this time', async () => {
    const view = await render(<Framed state="error" />)
    await come(view, 'populated')
    await come(view, 'error')
    expect(saidNow.mock.calls).toEqual([[words.error]])
  })

  it.each<[DataState, string]>([
    ['populated', 'none'],
    ['offline', 'none'],
    ['pending', 'pending'],
    ['syncing', 'syncing'],
    ['conflicted', 'conflict'],
  ])('hands the %s body its mark, %s, and its write affordances', async (state, mark) => {
    await render(<Framed state={state} />)
    expect(screen.getByTestId(`mark:${mark}`)).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: words.open })).toBeOnTheScreen()
    // An offline read is the online read: the frame adds nothing to it.
    expect(drawings()).toBe(0)
  })

  // The two sentences that stand in a body's place are not a frame's to leave out: its type asks
  // for both, so a failed load is never a blank screen. A strip's may be, and its body is bare.
  const inPlace = { error: { text: words.error }, withdrawn: { text: words.withdrawn } }

  it.each(['readonly', 'rejected'] as const)(
    'draws a %s body bare where its strip’s sentence was left out',
    async (state) => {
      await render(
        <StateFrame state={state} skeleton={null} empty={null} texts={inPlace}>
          {() => <Text>{words.body}</Text>}
        </StateFrame>,
      )
      expect(screen.getByText(words.body)).toBeOnTheScreen()
      expect(drawings()).toBe(0)
    },
  )

  it.each<['error' | 'withdrawn', string]>([
    ['error', words.error],
    ['withdrawn', words.withdrawn],
  ])('says a %s body’s sentence with no title and no action given', async (state, sentence) => {
    await render(
      <StateFrame state={state} skeleton={null} empty={null} texts={inPlace}>
        {() => <Text>{words.body}</Text>}
      </StateFrame>,
    )
    expect(screen.getByText(sentence)).toBeOnTheScreen()
    expect(screen.queryByText(words.body)).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('has no element of its own in any state: nothing of it takes a press or the focus', async () => {
    const bare = { error: { text: words.error }, withdrawn: { text: words.withdrawn } }
    for (const state of dataStates) {
      const view = await render(
        <StateFrame state={state} skeleton={null} empty={null} texts={bare}>
          {() => null}
        </StateFrame>,
      )
      const pressable = elementsOf(root()).filter(
        (element) =>
          typeof element.props.onClick === 'function' || element.props.focusable === true,
      )
      expect(pressable).toEqual([])
      await view.unmount()
    }
  })
})
