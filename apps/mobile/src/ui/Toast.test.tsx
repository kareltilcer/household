// The toast's contract (02-components §1, 03-patterns §5; the web's `overlays.test.tsx`, "a
// toast", is its twin): what it says and to whom, how long it stays, how it is taken back and
// put away, and where it is drawn while a modal is open.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { controls } from '@household/icons'
import { catalogs } from '@household/i18n'
import { nativeThemes } from '@household/tokens/native'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { useState } from 'react'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { elementsOf, expectAccessible, nameOf, takesPress } from '../test/a11y.ts'
import { render } from '../test/render.tsx'
import * as announcer from './announce.ts'
import { Button } from './Button.tsx'
import { sample } from './controls.fixtures.ts'
import { Dialog } from './Dialog.tsx'
import { Sheet } from './Sheet.tsx'
import { useToast, useToastsAbove } from './Toast.tsx'

const undoWord = catalogs.en['ui.toast.undo']
const dismiss = catalogs.en[controls.dismiss.labelKey]
const dwell = nativeThemes.light.thresholds['toast-dwell']

/** A control that raises a toast, with an Undo where the test gives one. */
function Raise({
  message = sample.cleared,
  undo,
}: {
  readonly message?: string
  readonly undo?: () => void
}) {
  const toast = useToast()
  return (
    <Button
      onPress={() => {
        toast({ message, ...(undo === undefined ? {} : { undo }) })
      }}
    >
      {message}
    </Button>
  )
}

const raise = (message: string = sample.cleared) =>
  fireEvent.press(screen.getByRole('button', { name: message }))

/** The toasts on the screen, by what each says. */
function toasts(): string[] {
  return screen
    .queryAllByTestId('toast')
    .map((toast) => elementsOf(toast).find((each) => each.type === 'Text'))
    .map((text) => (text === undefined ? '' : (text.children[0] as string)))
}

const pass = (time: number) =>
  act(() => {
    jest.advanceTimersByTime(time)
  })

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('a toast', () => {
  it('says what happened, and is said to a screen reader after the one word, politely', async () => {
    const politely = jest.spyOn(announcer, 'announce')
    const atOnce = jest.spyOn(announcer, 'announceNow')
    await render(<Raise />)
    expect(toasts()).toEqual([])
    await raise()
    expect(toasts()).toEqual([sample.cleared])
    const said = `${catalogs.en['ui.toast.label']}: ${sample.cleared}`
    expect(politely.mock.calls).toEqual([[said]])
    expect(atOnce).not.toHaveBeenCalled()
    // Met where it is drawn, it is read as it was announced.
    expect(screen.getByLabelText(said)).toBeOnTheScreen()
    expectAccessible()
  })

  it('takes it back with a button, and goes once it has', async () => {
    const undo = jest.fn()
    await render(<Raise undo={undo} />)
    await raise()
    await fireEvent.press(screen.getByRole('button', { name: undoWord }))
    expect(undo).toHaveBeenCalledTimes(1)
    expect(toasts()).toEqual([])
  })

  it('has no Undo where nothing takes it back, and can be put away by a control with a name', async () => {
    await render(<Raise />)
    await raise()
    expect(screen.queryByRole('button', { name: undoWord })).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: dismiss }))
    expect(toasts()).toEqual([])
  })

  it('keeps its undo for the whole dwell, and goes when the dwell is over', async () => {
    await render(<Raise undo={() => undefined} />)
    await raise()
    await pass(dwell - 1)
    expect(screen.getByRole('button', { name: undoWord })).toBeOnTheScreen()
    await pass(1)
    expect(toasts()).toEqual([])
  })

  it('is put away by no gesture: nothing of it answers a finger moved across it', async () => {
    await render(<Raise undo={() => undefined} />)
    await raise()
    const toast = screen.getByTestId('toast')
    // The toast itself listens for nothing, a drag across it least of all: what takes
    // anything in it is one of its two controls, and each takes a press.
    expect(Object.keys(toast.props).filter((prop) => prop.startsWith('on'))).toEqual([])
    expect(elementsOf(toast).filter(takesPress).map(nameOf)).toEqual([undoWord, dismiss])
  })

  it('shows each of several, apart, each for its own dwell', async () => {
    await render(
      <>
        <Raise />
        <Raise message={sample.archived} />
      </>,
    )
    await raise()
    await pass(2000)
    await raise(sample.archived)
    expect(toasts()).toEqual([sample.cleared, sample.archived])
    expect(screen.getAllByRole('button', { name: dismiss })).toHaveLength(2)
    await pass(dwell - 2000)
    expect(toasts()).toEqual([sample.archived])
    await pass(2000)
    expect(toasts()).toEqual([])
  })

  it('goes when its dwell is over though another beside it was put away by a press', async () => {
    await render(
      <>
        <Raise />
        <Raise message={sample.archived} />
      </>,
    )
    await raise()
    await raise(sample.archived)
    const [first] = screen.getAllByRole('button', { name: dismiss })
    if (first === undefined) throw new Error('no toast')
    await fireEvent.press(first)
    expect(toasts()).toEqual([sample.archived])
    await pass(dwell)
    expect(toasts()).toEqual([])
  })

  it('stays while a screen reader is on, until it is put away or taken back', async () => {
    // The device says a screen reader is on, and later that it is off.
    let tell: (on: boolean) => void = () => undefined
    jest.spyOn(announcer, 'watchScreenReader').mockImplementation((listener) => {
      tell = listener
      return () => undefined
    })
    await render(<Raise undo={() => undefined} />)
    await act(() => {
      tell(true)
    })
    await raise()
    await pass(dwell * 4)
    // Found by ear, its Undo is still there to be found.
    expect(screen.getByRole('button', { name: undoWord })).toBeOnTheScreen()
    // Off again, it stays for a dwell, and no less.
    await act(() => {
      tell(false)
    })
    await pass(dwell - 1)
    expect(toasts()).toEqual([sample.cleared])
    await pass(1)
    expect(toasts()).toEqual([])
  })

  it('stands over the foot of the screen, above the bar the shell says it has there', async () => {
    function Bar() {
      useToastsAbove(56)
      return <Raise />
    }
    await render(<Bar />)
    await raise()
    const region = screen.getByTestId('toast').parent
    if (region == null) throw new Error('no region')
    const space = nativeThemes.light.space['space-2']
    expect(StyleSheet.flatten(region.props.style as StyleProp<ViewStyle>).paddingBottom).toBe(
      space + 56,
    )
    // And takes no press but on a toast: the screen beside it is the screen's.
    expect(region.props.pointerEvents).toBe('box-none')
  })

  it.each(['light', 'dark'] as const)(
    'is drawn on the inverse surface in its own ink, a target at 200 %% as at 100, in the %s theme',
    async (theme) => {
      await render(<Raise undo={() => undefined} />, { theme, scale: 2 })
      await raise()
      const toast = screen.getByTestId('toast')
      expect(StyleSheet.flatten(toast.props.style as StyleProp<ViewStyle>).backgroundColor).toBe(
        nativeThemes[theme].color['surface-inverse'],
      )
      expectAccessible()
    },
  )
})

describe('a toast and a modal', () => {
  function Editor({ nested = false }: { readonly nested?: boolean }) {
    const [open, setOpen] = useState(true)
    return (
      <>
        <Raise message={sample.archived} />
        <Sheet
          testID="editor"
          open={open}
          onClose={() => {
            setOpen(false)
          }}
          title={sample.edit}
        >
          <Raise undo={() => undefined} />
          <Dialog
            testID="question"
            open={nested}
            onClose={() => undefined}
            title={sample.discard}
          />
        </Sheet>
      </>
    )
  }

  const inside = (testID: string) =>
    elementsOf(screen.getByTestId(testID)).filter((each) => each.props.testID === 'toast')

  it('is drawn inside an open sheet, where its Undo can be pressed, and nowhere else', async () => {
    await render(<Editor />)
    await raise()
    expect(inside('editor')).toHaveLength(1)
    expect(screen.getAllByTestId('toast')).toHaveLength(1)
    expect(screen.getByRole('button', { name: undoWord })).toBeOnTheScreen()
    // In a row of its own at the sheet's foot, and not over the sheet's own.
    const region = screen.getByTestId('toast').parent
    expect(StyleSheet.flatten(region?.props.style as StyleProp<ViewStyle>).position).toBeUndefined()
    expectAccessible()
  })

  it('is drawn inside the inner of two modals, which is the one on top', async () => {
    await render(<Editor nested />)
    await raise()
    expect(inside('question')).toHaveLength(1)
    expect(screen.getAllByTestId('toast')).toHaveLength(1)
  })

  it('stays, on the screen again, when the sheet it was raised in closes, for what is left of its dwell', async () => {
    await render(<Editor />)
    await raise()
    await pass(3000)
    await fireEvent(screen.getByTestId('editor'), 'requestClose')
    expect(screen.queryByTestId('editor')).toBeNull()
    expect(toasts()).toEqual([sample.cleared])
    expect(screen.getByRole('button', { name: undoWord })).toBeOnTheScreen()
    // Drawn anew on the screen, and its dwell ran on: it is not begun again.
    await pass(dwell - 3000 - 1)
    expect(toasts()).toEqual([sample.cleared])
    await pass(1)
    expect(toasts()).toEqual([])
  })

  it('is moved into a sheet that opens over it', async () => {
    function Later() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Raise />
          <Button
            onPress={() => {
              setOpen(true)
            }}
          >
            {sample.edit}
          </Button>
          <Sheet testID="editor" open={open} onClose={() => undefined} title={sample.edit} />
        </>
      )
    }
    await render(<Later />)
    await raise()
    await fireEvent.press(screen.getByRole('button', { name: sample.edit }))
    expect(inside('editor')).toHaveLength(1)
    expect(screen.getAllByTestId('toast')).toHaveLength(1)
  })
})
