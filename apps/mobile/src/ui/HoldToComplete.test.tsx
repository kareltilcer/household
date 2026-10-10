// Hold-to-complete (02-components §4.1), ported from the web's tests of the same gesture and held
// to its two non-negotiables: progress shown for the whole 2000 ms, and an immediate path for
// assistive technology and a keyboard.
//
// What a test can prove of the immediate path is that each event a platform sends for an
// activation completes at once: the `activate` action, the accessibility tap, and the click of a
// press that no touch began. That a screen reader sends them is the platform's, and a device's
// to show.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { catalogs } from '@household/i18n'
import { nativeThemes } from '@household/tokens/native'
import {
  act,
  fireEvent,
  isHiddenFromAccessibility,
  screen,
  userEvent,
} from '@testing-library/react-native'
import { Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import type { TestInstance } from 'test-renderer'
import { elementsOf, expectAccessible, violations } from '../test/a11y.ts'
import { render, TestProviders, type DrawOptions } from '../test/render.tsx'
import * as announcer from './announce.ts'
import { HoldToComplete, stepped } from './HoldToComplete.tsx'

const en = catalogs.en
const label = 'Complete Take out the bins'

function Hold({ onComplete }: { readonly onComplete: () => unknown }) {
  return <HoldToComplete label={label} onComplete={onComplete} />
}

/** The one control assistive technology and a keyboard meet. */
function control(): TestInstance {
  return screen.getByRole('button', { name: label })
}

/** The ring a finger holds: hidden from a screen reader, so asked for as what is hidden. */
function ring(): TestInstance {
  return screen.getByTestId('hold-ring', { includeHiddenElements: true })
}

function phase(): string {
  return String(control().props.testID).replace(/^hold:/, '')
}

function styleOf(element: TestInstance): ViewStyle {
  return StyleSheet.flatten(element.props.style as StyleProp<ViewStyle>)
}

/** Everything the test drew. */
function root(): TestInstance {
  if (screen.root === null) throw new Error('nothing is drawn')
  return screen.root
}

/** Where the ring stands on the test's screen, and a touch at a place in it. */
const corner = { x: 100, y: 300 }
function touch(x = 22, y = 22) {
  return {
    nativeEvent: { pageX: corner.x + x, pageY: corner.y + y, locationX: x, locationY: y },
  }
}

async function down(): Promise<void> {
  await fireEvent(ring(), 'responderGrant', touch())
}
async function up(): Promise<void> {
  await fireEvent(ring(), 'responderRelease', touch())
}

async function advance(ms: number): Promise<void> {
  await act(() => {
    jest.advanceTimersByTime(ms)
  })
}

/** How far round the ring is filled: nothing of it, or all. */
function filled(): number {
  const [, fill] = elementsOf(ring()).filter((inner) => inner.type === 'RNSVGCircle')
  const offset = Number(fill?.props.strokeDashoffset)
  return offset === 0 ? 1 : 0
}

let said: jest.SpiedFunction<typeof announcer.announce>

beforeEach(() => {
  said = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
})
afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('holding', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  it('completes after the whole 2000 ms, and not a moment before', async () => {
    const onComplete = jest.fn()
    await render(<Hold onComplete={onComplete} />)
    await down()
    expect(phase()).toBe('holding')
    await advance(1999)
    expect(onComplete).not.toHaveBeenCalled()
    await advance(1)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(phase()).toBe('completed')
    expect(screen.getByText(en['ui.hold.completed'])).toBeOnTheScreen()
    expect(said.mock.calls).toEqual([[en['ui.hold.completed']]])
  })

  it('completes under a finger held for the whole of it, through the touch itself', async () => {
    const onComplete = jest.fn()
    await render(<Hold onComplete={onComplete} />)
    await userEvent.longPress(ring(), { duration: 1999 })
    expect(onComplete).not.toHaveBeenCalled()
    expect(phase()).toBe('released')
    await userEvent.longPress(ring(), { duration: 2000 })
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(phase()).toBe('completed')
  })

  it('does not complete on a tap, says to keep holding, and is then as it was', async () => {
    const onComplete = jest.fn()
    await render(<Hold onComplete={onComplete} />)
    await userEvent.press(ring())
    expect(phase()).toBe('released')
    expect(screen.getByText(en['ui.hold.keep_holding'])).toBeOnTheScreen()
    expect(said.mock.calls).toEqual([[en['ui.hold.keep_holding']]])
    // The word stays as long as a toast would, and no longer: a row touched once is not left
    // saying it (02-components §4.1: released early, it returns to idle).
    await advance(4999)
    expect(phase()).toBe('released')
    await advance(1)
    expect(phase()).toBe('idle')
    expect(screen.queryByText(en['ui.hold.keep_holding'])).toBeNull()
    expect(onComplete).not.toHaveBeenCalled()
    expect(said).toHaveBeenCalledTimes(1)
  })

  it('completes with what its owner asks at the end of the hold, not at its start', async () => {
    const stale = jest.fn()
    const current = jest.fn()
    const view = await render(<Hold onComplete={stale} />)
    await down()
    await advance(1000)
    // The row was drawn again under the hold: a sync brought it a newer version to complete.
    await view.rerender(
      <TestProviders>
        <Hold onComplete={current} />
      </TestProviders>,
    )
    expect(phase()).toBe('holding')
    await advance(1000)
    expect(current).toHaveBeenCalledTimes(1)
    expect(stale).not.toHaveBeenCalled()
  })

  it('gives the hold up when the touch is taken from it', async () => {
    const onComplete = jest.fn()
    await render(<Hold onComplete={onComplete} />)
    await down()
    await advance(1000)
    await fireEvent(ring(), 'responderTerminate', touch())
    expect(phase()).toBe('released')
    await advance(5000)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it.each([
    ['off its start', -1, 22],
    ['off its end', 45, 22],
    ['off its top', 22, -1],
    ['off its foot', 22, 45],
  ])(
    'gives the hold up when the finger slides %s, and sliding back begins none',
    async (_, x, y) => {
      const onComplete = jest.fn()
      await render(<Hold onComplete={onComplete} />)
      await down()
      await advance(1000)
      // Still on the ring, at its very edge: the hold goes on.
      await fireEvent(ring(), 'responderMove', touch(44, 0))
      expect(phase()).toBe('holding')
      await fireEvent(ring(), 'responderMove', touch(x, y))
      expect(phase()).toBe('released')
      await fireEvent(ring(), 'responderMove', touch(22, 22))
      expect(phase()).toBe('released')
      await advance(5000)
      expect(onComplete).not.toHaveBeenCalled()
    },
  )

  it('keeps the touch it was given: a hold is no swipe of the row it sits in', async () => {
    await render(<Hold onComplete={() => undefined} />)
    const props = ring().props as {
      onStartShouldSetResponder: () => boolean
      onResponderTerminationRequest: () => boolean
      pointerEvents: string
    }
    expect(props.onStartShouldSetResponder()).toBe(true)
    expect(props.onResponderTerminationRequest()).toBe(false)
    // And it is the ring's own from where it lands, whatever is drawn in the ring.
    expect(props.pointerEvents).toBe('box-only')
  })

  it('starts over on a second hold: time held before does not count', async () => {
    const onComplete = jest.fn()
    await render(<Hold onComplete={onComplete} />)
    await down()
    await advance(1500)
    await up()
    await down()
    await advance(1999)
    expect(onComplete).not.toHaveBeenCalled()
    await advance(1)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('is not taken back to idle under a second hold by the word of the first', async () => {
    const onComplete = jest.fn()
    await render(<Hold onComplete={onComplete} />)
    await down()
    await advance(500)
    await up()
    // Held again just before the first release's word would have gone.
    await advance(4500)
    await down()
    await advance(1000)
    expect(phase()).toBe('holding')
    await advance(1000)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(phase()).toBe('completed')
  })

  it('takes no second completion once it has completed, by a hold or without one', async () => {
    const onComplete = jest.fn()
    await render(<Hold onComplete={onComplete} />)
    await down()
    await advance(2000)
    await up()
    await down()
    await advance(2000)
    await fireEvent(control(), 'accessibilityTap')
    await fireEvent(control(), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } })
    expect(onComplete).toHaveBeenCalledTimes(1)
    // It says so, and stays where it is: completed, it is never taken away.
    expect(control()).toBeDisabled()
    expect(control().props.disabled).toBeUndefined()
    expect(violations(root()).map(({ rule }) => rule)).toEqual(['never-disabled'])
    expectAccessible(root(), { outOfForm: [label] })
  })

  it('stays completed when the finger is lifted in the instant the hold ends', async () => {
    const onComplete = jest.fn()
    await render(<Hold onComplete={onComplete} />)
    await down()
    // The hold's timer and the release in one turn, with nothing drawn between them: what the
    // control last drew still says it is held.
    const { onResponderRelease } = ring().props as { onResponderRelease: (event: unknown) => void }
    await act(() => {
      jest.advanceTimersByTime(2000)
      onResponderRelease(touch())
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(phase()).toBe('completed')
    expect(screen.getByText(en['ui.hold.completed'])).toBeOnTheScreen()
    // And it is not taken back to idle by the word of a release that was none.
    await advance(5000)
    expect(phase()).toBe('completed')
    await down()
    await advance(2000)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('stays completing, then completed, when the finger is lifted as a slow completion begins', async () => {
    let finish: () => void = () => undefined
    const onComplete = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    await render(<Hold onComplete={onComplete} />)
    await down()
    const { onResponderTerminate } = ring().props as {
      onResponderTerminate: (event: unknown) => void
    }
    await act(() => {
      jest.advanceTimersByTime(2000)
      onResponderTerminate(touch())
    })
    expect(phase()).toBe('completing')
    await act(async () => {
      finish()
      await Promise.resolve()
    })
    expect(phase()).toBe('completed')
    await advance(5000)
    expect(phase()).toBe('completed')
  })

  it('is idle again, and completes again, where its owner draws one of its own for what was undone', async () => {
    // It stays completed for as long as it is drawn. A row whose completion was undone, or
    // refused by the server, draws its control afresh, by a key that changes with it.
    const onComplete = jest.fn()
    const view = await render(<HoldToComplete key={1} label={label} onComplete={onComplete} />)
    await down()
    await advance(2000)
    expect(phase()).toBe('completed')
    await view.rerender(
      <TestProviders>
        <HoldToComplete key={2} label={label} onComplete={onComplete} />
      </TestProviders>,
    )
    expect(phase()).toBe('idle')
    expect(screen.queryByText(en['ui.hold.completed'])).toBeNull()
    await down()
    await advance(2000)
    expect(onComplete).toHaveBeenCalledTimes(2)
  })
})

describe('assistive technology and a keyboard', () => {
  it('meet one control, a button named for what it completes: the ring is a finger’s alone', async () => {
    await render(<Hold onComplete={() => undefined} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(control().props.accessible).toBe(true)
    expect(control().props.focusable).toBe(true)
    expect(isHiddenFromAccessibility(ring())).toBe(true)
    // The ring is over all of the button: a finger lands on the ring, wherever it lands.
    const { width, height } = styleOf(ring())
    expect(styleOf(control())).toMatchObject({ minWidth: width, minHeight: height })
    expectAccessible()
  })

  it('complete at once by the activate action, which carries the control’s own name', async () => {
    const onComplete = jest.fn()
    await render(<Hold onComplete={onComplete} />)
    // Listed under its label where a platform lists an element's actions: never as its
    // identifier, which is an English word.
    expect(control().props.accessibilityActions).toEqual([{ name: 'activate', label }])
    await fireEvent(control(), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } })
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(phase()).toBe('completed')
    expect(said.mock.calls).toEqual([[en['ui.hold.completed']]])
  })

  it('complete at once where the platform asks the element to activate: a screen reader’s double tap', async () => {
    const onComplete = jest.fn()
    await render(<Hold onComplete={onComplete} />)
    await fireEvent(control(), 'accessibilityTap')
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(phase()).toBe('completed')
  })

  it('complete at once by a press no touch began: a keyboard’s Enter, a switch', async () => {
    const onComplete = jest.fn()
    await render(<Hold onComplete={onComplete} />)
    const pressed = control()
    await fireEvent(pressed, 'click', {
      nativeEvent: {},
      currentTarget: pressed,
      target: pressed,
      stopPropagation: () => undefined,
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(phase()).toBe('completed')
  })

  it('do nothing by an action that is not its own', async () => {
    const onComplete = jest.fn()
    await render(<Hold onComplete={onComplete} />)
    await fireEvent(control(), 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } })
    expect(onComplete).not.toHaveBeenCalled()
    expect(phase()).toBe('idle')
  })

  it('show where the focus is on the ring, and is as large as any target at 200 % text', async () => {
    await render(<Hold onComplete={() => undefined} />, { scale: 2 })
    expect(styleOf(control())).toMatchObject({ minWidth: 88, minHeight: 88 })
    expect(styleOf(ring())).toMatchObject({ width: 88, height: 88 })
    await fireEvent(control(), 'focus')
    expect(styleOf(control())).toMatchObject({
      outlineWidth: 2,
      outlineColor: nativeThemes.light.color.focus,
    })
    await fireEvent(control(), 'blur')
    expect(styleOf(control()).outlineWidth).toBeUndefined()
    expectAccessible()
  })
})

describe('a completion that takes a while', () => {
  it('says it is completing, then that it completed', async () => {
    let finish: () => void = () => undefined
    const onComplete = () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
    await render(<Hold onComplete={onComplete} />)
    await fireEvent(control(), 'accessibilityTap')
    expect(phase()).toBe('completing')
    expect(control()).toBeBusy()
    expect(screen.getByText(en['ui.hold.completing'])).toBeOnTheScreen()
    await act(async () => {
      finish()
      await Promise.resolve()
    })
    expect(phase()).toBe('completed')
    expect(control()).not.toBeBusy()
    expect(said.mock.calls).toEqual([[en['ui.hold.completing']], [en['ui.hold.completed']]])
  })

  it('says so when it fails, in words, and can be tried again', async () => {
    const onComplete = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce()
    await render(<Hold onComplete={onComplete} />)
    await fireEvent(control(), 'accessibilityTap')
    expect(await screen.findByText(en['ui.hold.failed'])).toBeOnTheScreen()
    expect(phase()).toBe('failed')
    expect(said).toHaveBeenLastCalledWith(en['ui.hold.failed'])
    // Failed, it is no settled control: it takes the next activation, and says nothing else of it.
    expect(control()).toBeEnabled()
    expectAccessible()
    await fireEvent(control(), 'accessibilityTap')
    expect(await screen.findByText(en['ui.hold.completed'])).toBeOnTheScreen()
    expect(onComplete).toHaveBeenCalledTimes(2)
  })

  it('waits for a promise that is not the app’s own, as for one that is', async () => {
    let refuse: (reason: Error) => void = () => undefined
    const waited = new Promise<void>((_, reject) => {
      refuse = reject
    })
    // What a library's own promise is to the app: a `then`, and no instance of its Promise.
    const onComplete = () => ({ then: waited.then.bind(waited) })
    await render(<Hold onComplete={onComplete} />)
    await fireEvent(control(), 'accessibilityTap')
    expect(phase()).toBe('completing')
    await act(() => {
      refuse(new Error('offline'))
    })
    expect(await screen.findByText(en['ui.hold.failed'])).toBeOnTheScreen()
    expect(phase()).toBe('failed')
  })
})

describe('a completion that threw', () => {
  // A throw is its owner's fault, and no write refused: the control says it failed, and what
  // was thrown is thrown on, to wherever the app reports what nothing caught.
  const thrown = new Error('no row to complete')
  const fails = () => {
    throw thrown
  }

  it('says it failed, as one that was refused did, and throws on what was thrown', async () => {
    await render(<Hold onComplete={fails} />)
    const { onAccessibilityTap } = control().props as { onAccessibilityTap: () => void }
    // Caught here as the platform would catch it, which then draws what the handler left.
    let uncaught: unknown
    await act(() => {
      try {
        onAccessibilityTap()
      } catch (error) {
        uncaught = error
      }
    })
    expect(uncaught).toBe(thrown)
    expect(phase()).toBe('failed')
    expect(screen.getByText(en['ui.hold.failed'])).toBeOnTheScreen()
  })

  it('says it failed at the end of a hold too, and throws on what was thrown', async () => {
    jest.useFakeTimers()
    await render(<Hold onComplete={fails} />)
    await down()
    // The hold's timer is a task of the app's own: what is thrown in it nothing catches. Here
    // the clock is the test's, and what its task throws comes to it.
    let uncaught: unknown
    await act(() => {
      try {
        jest.advanceTimersByTime(2000)
      } catch (error) {
        uncaught = error
      }
    })
    expect(uncaught).toBe(thrown)
    expect(phase()).toBe('failed')
  })
})

describe('the progress', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  /** What the fill was last started with: how long it runs, and how it gets there. */
  function sweep(timing: jest.SpiedFunction<typeof Animated.timing>) {
    const config = timing.mock.calls.at(-1)?.[1]
    if (config?.easing === undefined) throw new Error('no fill was started')
    return { duration: config.duration, toValue: config.toValue, easing: config.easing }
  }

  async function held(options?: DrawOptions) {
    const timing = jest.spyOn(Animated, 'timing')
    await render(<Hold onComplete={() => undefined} />, options)
    await down()
    return sweep(timing)
  }

  it('is a sweep for the whole hold', async () => {
    const { duration, toValue, easing } = await held()
    expect(duration).toBe(2000)
    expect(toValue).toBe(1)
    expect(easing).toBe(Easing.linear)
  })

  it('is ten steps, and not a sweep, when the member asks for reduced motion: and no shorter', async () => {
    const { duration, easing } = await held({ motion: 'reduced' })
    expect(duration).toBe(2000)
    expect([0, 0.09, 0.1, 0.55, 0.99, 1].map(easing)).toEqual([0, 0, 0.1, 0.5, 0.9, 1])
  })

  it('is ten steps when the device asks for reduced motion', async () => {
    jest.spyOn(announcer, 'watchReducedMotion').mockImplementation((listener) => {
      listener(true)
      return () => undefined
    })
    const { duration, easing } = await held()
    expect(duration).toBe(2000)
    expect(easing(0.55)).toBe(0.5)
  })

  it('fills in as many steps as it is asked for, each as its share of the time ends', () => {
    const ten = stepped(10)
    expect(new Set(Array.from({ length: 1001 }, (_, at) => ten(at / 1000))).size).toBe(11)
    expect([0.3, 0.7, 0.999].map(ten)).toEqual([0.3, 0.7, 0.9])
  })

  it('is emptied by a hold let go early, and stays full once the hold has completed', async () => {
    await render(<Hold onComplete={() => undefined} />)
    expect(filled()).toBe(0)
    await down()
    await up()
    expect(filled()).toBe(0)
    await down()
    await advance(2000)
    expect(filled()).toBe(1)
  })
})
