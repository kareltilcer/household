// The modal's and the sheet's contract (02-components §1; the web's `overlays.test.tsx` is its
// twin): what each is called, who closes it, and where a screen reader's focus is before,
// while and after.
//
// Jest's stand-in for React Native's `Modal` draws its children while `visible` and nothing
// otherwise, and says nothing of being shown or of having gone: a test says both as the
// platform would, by the events of the `Modal` it finds by its `testID`.
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { controls } from '@household/icons'
import { catalogs } from '@household/i18n'
import { nativeThemes } from '@household/tokens/native'
import { act, fireEvent, screen, userEvent } from '@testing-library/react-native'
import { useRef, useState, type ReactNode } from 'react'
import {
  Platform,
  Pressable,
  StyleSheet,
  type StyleProp,
  type TextInput,
  type View,
  type ViewStyle,
} from 'react-native'
import { elementsOf, expectAccessible } from '../test/a11y.ts'
import { render, type DrawOptions } from '../test/render.tsx'
import * as announcer from './announce.ts'
import { Button } from './Button.tsx'
import { sample } from './controls.fixtures.ts'
import { Dialog } from './Dialog.tsx'
import { TextField } from './Field.tsx'
import { Sheet } from './Sheet.tsx'
import { Text } from './Text.tsx'

const close = catalogs.en[controls.close_sheet.labelKey]

interface OwnerProps {
  readonly sheet?: boolean
  /** Whether its owner closes it when asked: one with a save under way does not. */
  readonly closes?: boolean
  readonly asked?: () => void
  readonly onClosed?: () => void
  /** Whether the focus goes to its first field as it opens. */
  readonly toField?: boolean
  readonly children?: ReactNode
}

/** A screen with a control that opens a dialog or a sheet, and takes the focus back from it. */
function Owner({
  sheet = false,
  closes = true,
  asked,
  onClosed,
  toField = false,
  children,
}: OwnerProps) {
  const [open, setOpen] = useState(false)
  const opener = useRef<View>(null)
  const field = useRef<TextInput>(null)
  const Kind = sheet ? Sheet : Dialog
  return (
    <>
      <Pressable
        ref={opener}
        accessibilityRole="button"
        onPress={() => {
          setOpen(true)
        }}
        style={{ minHeight: 44, minWidth: 44 }}
      >
        <Text>{sample.edit}</Text>
      </Pressable>
      <Kind
        testID="it"
        open={open}
        onClose={() => {
          asked?.()
          if (closes) setOpen(false)
        }}
        title={sample.deleteTitle}
        description={sample.deleteBody}
        opener={opener}
        {...(onClosed === undefined ? {} : { onClosed })}
        {...(toField ? { initialFocus: field } : {})}
        actions={
          <>
            <Button
              onPress={() => {
                setOpen(false)
              }}
            >
              {sample.keep}
            </Button>
            <Button variant="danger">{sample.deleteIt}</Button>
          </>
        }
      >
        {toField ? <TextField ref={field} label={sample.value} /> : null}
        {children}
      </Kind>
    </>
  )
}

async function opened(props: OwnerProps = {}, options?: DrawOptions) {
  await render(<Owner {...props} />, options)
  await userEvent.press(screen.getByRole('button', { name: sample.edit }))
}

const modal = () => screen.getByTestId('it')
const focusOn = () => jest.spyOn(announcer, 'focusOn').mockReturnValue(true)

/** What the last call gave the focus to, by a prop that tells it from anything else. */
function lastFocused(spy: ReturnType<typeof focusOn>): Readonly<Record<string, unknown>> {
  return { ...spy.mock.lastCall?.[0].current?.props }
}

function styled(element: { readonly props: Readonly<Record<string, unknown>> }): ViewStyle {
  return StyleSheet.flatten(element.props.style as StyleProp<ViewStyle>)
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a dialog', () => {
  it('opens over the screen, named by its title and saying what will be lost', async () => {
    await opened()
    expect(screen.getByRole('header', { name: sample.deleteTitle })).toBeOnTheScreen()
    expect(screen.getByText(sample.deleteBody)).toBeOnTheScreen()
    // After the control that opened it: the safe choice first, and the one that destroys
    // names what it destroys.
    const [, safe, destroys] = screen.getAllByRole('button')
    expect(safe).toHaveTextContent(sample.keep)
    expect(destroys).toHaveTextContent(sample.deleteIt)
    // What is behind it is no part of what a screen reader walks.
    expect(elementsOf(modal()).some((each) => each.props.accessibilityViewIsModal === true)).toBe(
      true,
    )
    expect(modal().props).toMatchObject({ visible: true, transparent: true })
    expectAccessible()
  })

  it('draws nothing while it is closed', async () => {
    await render(<Owner />)
    expect(screen.queryByTestId('it')).toBeNull()
    expect(screen.queryByText(sample.deleteTitle)).toBeNull()
  })

  it('takes the focus as it is shown: its title, or what its owner names', async () => {
    const spy = focusOn()
    await opened()
    // Not before the platform says it is on the screen: there is nothing to focus until then.
    expect(spy).not.toHaveBeenCalled()
    await fireEvent(modal(), 'show')
    expect(lastFocused(spy)).toMatchObject({
      accessibilityRole: 'header',
      accessibilityLabel: sample.deleteTitle,
    })
  })

  it('gives the focus to an editor’s first field where its owner says so', async () => {
    const spy = focusOn()
    await opened({ sheet: true, toField: true })
    await fireEvent(modal(), 'show')
    expect(lastFocused(spy)).toMatchObject({ accessibilityLabel: sample.value })
  })

  it('is closed by its owner alone: the system’s back asks, and so does a screen reader’s escape', async () => {
    const asked = jest.fn()
    await opened({ closes: false, asked })
    await fireEvent(modal(), 'requestClose')
    expect(asked).toHaveBeenCalledTimes(1)
    const [inside] = elementsOf(modal()).filter(
      (each) => each.props.accessibilityViewIsModal === true,
    )
    if (inside === undefined) throw new Error('nothing is modal')
    await fireEvent(inside, 'accessibilityEscape')
    expect(asked).toHaveBeenCalledTimes(2)
    // Its owner keeps it open, a save under way, and it is open.
    expect(screen.getByRole('header', { name: sample.deleteTitle })).toBeOnTheScreen()
  })

  it('asks to close on a press on the ground behind it, and not on one inside it', async () => {
    const asked = jest.fn()
    await opened({ asked })
    await userEvent.press(screen.getByText(sample.deleteBody))
    await userEvent.press(screen.getByRole('header', { name: sample.deleteTitle }))
    expect(asked).not.toHaveBeenCalled()
    await userEvent.press(screen.getByTestId('it:ground', { includeHiddenElements: true }))
    expect(asked).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('it')).toBeNull()
  })

  it('shows a screen reader no ground: it has the choices and its own escape', async () => {
    await opened()
    expect(screen.queryByTestId('it:ground')).toBeNull()
    const ground = screen.getByTestId('it:ground', { includeHiddenElements: true })
    expect(ground.props.accessible).toBe(false)
    // A veil of the theme's darkest surface, which is the inverse one in the light theme.
    expect(styled(ground)).toMatchObject({
      backgroundColor: nativeThemes.light.color['surface-inverse'],
      opacity: 0.45,
    })
  })

  it('dims the screen by the sunken surface in the dark theme, where the inverse one is light', async () => {
    await opened({}, { theme: 'dark' })
    expect(
      styled(screen.getByTestId('it:ground', { includeHiddenElements: true })).backgroundColor,
    ).toBe(nativeThemes.dark.color['surface-sunken'])
    expectAccessible()
  })

  it('gives the focus back to what opened it once it has gone, and then tells its owner', async () => {
    // Everywhere but on iOS it is gone as soon as it is closed.
    jest.replaceProperty(Platform, 'OS', 'android')
    const order: string[] = []
    const spy = focusOn().mockImplementation(() => {
      order.push('focus')
      return true
    })
    await opened({
      onClosed: () => {
        order.push('closed')
      },
    })
    expect(order).toEqual([])
    await userEvent.press(screen.getByRole('button', { name: sample.keep }))
    expect(screen.queryByTestId('it')).toBeNull()
    expect(order).toEqual(['focus', 'closed'])
    expect(spy.mock.lastCall?.[0].current).not.toBeNull()
    expect(lastFocused(spy)).toMatchObject({ accessibilityRole: 'button' })
  })

  it('waits on iOS for the platform to say it has gone, which is later than it was closed', async () => {
    const onClosed = jest.fn()
    const spy = focusOn()
    await opened({ onClosed })
    const { onDismiss } = modal().props as { onDismiss: () => void }
    await userEvent.press(screen.getByRole('button', { name: sample.keep }))
    // Closed, and still leaving: nothing is given the focus, and its owner is told nothing.
    expect(spy).not.toHaveBeenCalled()
    expect(onClosed).not.toHaveBeenCalled()
    await act(() => {
      onDismiss()
    })
    expect(lastFocused(spy)).toMatchObject({ accessibilityRole: 'button' })
    expect(onClosed).toHaveBeenCalledTimes(1)
  })

  it('has no close control: a modal is closed by its choices', async () => {
    await opened()
    expect(screen.queryByRole('button', { name: close })).toBeNull()
  })

  it('makes its change at once under reduced motion, and turns with the device', async () => {
    await opened({}, { motion: 'reduced' })
    expect(modal().props).toMatchObject({ animationType: 'none' })
    expect(modal().props.supportedOrientations).toEqual(
      expect.arrayContaining(['portrait', 'landscape']),
    )
  })

  it.each([1, 2])('is drawn accessibly at a text scale of %i', async (scale) => {
    await opened({}, { scale })
    expect(modal().props.animationType).toBe('fade')
    expectAccessible(modal())
  })
})

describe('a sheet', () => {
  it('has a close control with a name, in the member’s language', async () => {
    await opened({ sheet: true }, { locale: 'de' })
    expect(
      screen.getByRole('button', { name: catalogs.de[controls.close_sheet.labelKey] }),
    ).toBeOnTheScreen()
    expectAccessible()
  })

  it('asks to close with nothing: the press is the control’s own, and no event of it its owner’s', async () => {
    const onClose = jest.fn()
    await render(<Sheet open onClose={onClose} title={sample.edit} />)
    await userEvent.press(screen.getByRole('button', { name: close }))
    expect(onClose.mock.calls).toEqual([[]])
  })

  it('comes from the foot of the screen, its top corners rounded, and what it holds scrolls', async () => {
    await opened({ sheet: true, toField: true })
    const header = screen.getByRole('header', { name: sample.deleteTitle })
    const surface = header.parent?.parent
    const stage = surface?.parent
    if (surface == null || stage == null) throw new Error('no surface')
    expect(styled(stage).justifyContent).toBe('flex-end')
    const drawn = styled(surface)
    expect(drawn.borderTopLeftRadius).toBe(nativeThemes.light.radii['radius-sheet'])
    expect(drawn.borderBottomLeftRadius).toBeUndefined()
    // No taller than the screen leaves it, and no fixed height: its body scrolls instead.
    expect(drawn).toMatchObject({ flexShrink: 1 })
    expect(drawn.height).toBeUndefined()
    const body = elementsOf(surface).find((each) => each.type === 'RCTScrollView')
    expect(body?.props.keyboardShouldPersistTaps).toBe('handled')
    expect(elementsOf(body ?? surface).some((each) => each.type === 'TextInput')).toBe(true)
  })

  it('draws a dialog its owner asks inside it over it, both of them open', async () => {
    function Editor() {
      const [asking, setAsking] = useState(false)
      return (
        <Sheet open onClose={() => undefined} title={sample.edit} testID="editor">
          <Button
            onPress={() => {
              setAsking(true)
            }}
          >
            {sample.archive}
          </Button>
          <Dialog
            testID="question"
            open={asking}
            onClose={() => {
              setAsking(false)
            }}
            title={sample.discard}
          />
        </Sheet>
      )
    }
    await render(<Editor />)
    await userEvent.press(screen.getByRole('button', { name: sample.archive }))
    // Inside the sheet's own modal: iOS presents a modal from the one it is drawn in.
    expect(elementsOf(screen.getByTestId('editor'))).toContain(screen.getByTestId('question'))
    expect(screen.getByRole('header', { name: sample.discard })).toBeOnTheScreen()
    expectAccessible()
  })
})
