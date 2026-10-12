// The stepper's rules (the web's `controls.test.tsx`, "a stepper", is their twin): what its
// buttons do, what typing gives its owner and when, and what it holds once it is left.
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { createTranslator } from '@household/i18n'
import { fireEvent, screen, userEvent } from '@testing-library/react-native'
import { useState } from 'react'
import { Platform, Pressable, StyleSheet, type StyleProp, type TextStyle } from 'react-native'
import type { TestInstance } from 'test-renderer'
import { expectAccessible, violations } from '../test/a11y.ts'
import { render, styleOf } from '../test/render.tsx'
import { sample } from './controls.fixtures.ts'
import { Stepper } from './Stepper.tsx'

const t = createTranslator('en')
const increase = t('ui.stepper.increase', { name: sample.members })
const decrease = t('ui.stepper.decrease', { name: sample.members })

function Count({
  start,
  min,
  max,
  step,
  onChange,
}: {
  readonly start: number
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly onChange?: (value: number) => void
}) {
  const [value, setValue] = useState(start)
  return (
    <Stepper
      label={sample.members}
      value={value}
      onChange={(next) => {
        onChange?.(next)
        setValue(next)
      }}
      {...(min === undefined ? {} : { min })}
      {...(max === undefined ? {} : { max })}
      {...(step === undefined ? {} : { step })}
    />
  )
}

const field = () => screen.getByLabelText(sample.members)
const shows = () => field().props.value as string

/** Types `text` over what the field holds, a key at a time, and stays in the field. */
async function retype(text: string): Promise<void> {
  await fireEvent.changeText(field(), '')
  for (let length = 1; length <= text.length; length += 1) {
    await fireEvent.changeText(field(), text.slice(0, length))
  }
}

const leave = () => fireEvent(field(), 'blur')

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a stepper', () => {
  it('steps by its buttons, each named for what it does to what', async () => {
    await render(<Count start={2} />)
    await userEvent.press(screen.getByRole('button', { name: increase }))
    await userEvent.press(screen.getByRole('button', { name: increase }))
    expect(shows()).toBe('4')
    await userEvent.press(screen.getByRole('button', { name: decrease }))
    expect(shows()).toBe('3')
    expectAccessible()
  })

  it('stops at its bounds, and holds a typed value to them once the field is left', async () => {
    await render(<Count start={1} min={1} max={3} />)
    expect(screen.getByRole('button', { name: decrease })).toBeDisabled()
    await retype('9')
    expect(shows()).toBe('9')
    await leave()
    expect(shows()).toBe('3')
    expect(screen.getByRole('button', { name: increase })).toBeDisabled()
    expect(screen.getByRole('button', { name: decrease })).toBeEnabled()
  })

  it('takes a value typed key by key under its least, and an emptied field on the way', async () => {
    const onChange = jest.fn()
    await render(<Count start={5} min={5} max={50} onChange={onChange} />)
    await fireEvent.changeText(field(), '')
    expect(shows()).toBe('')
    await retype('12')
    expect(shows()).toBe('12')
    // The "1" on the way was under the least, which is what its owner held already.
    expect(onChange.mock.calls).toEqual([[12]])
    await leave()
    expect(shows()).toBe('12')

    // Left empty, it is what it was.
    await fireEvent.changeText(field(), '')
    await leave()
    expect(shows()).toBe('12')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  // A press on a device takes no focus from the field (Stepper.tsx says where that is read), so
  // a form's Save reads what the field was last given: that is what leaving it would show.
  describe('gives at each key what leaving the field would make of what is typed', () => {
    it('holds a number typed past its most to the most, with the field not left', async () => {
      const onChange = jest.fn()
      await render(<Count start={3} min={1} max={12} onChange={onChange} />)
      await retype('15')
      // Not the "1" it was on its way through, which is what a form sent.
      expect(onChange.mock.lastCall).toEqual([12])
      expect(shows()).toBe('15')
      await leave()
      expect(shows()).toBe('12')
      expect(onChange.mock.lastCall).toEqual([12])
    })

    it('holds a number typed under its least to the least, with the field not left', async () => {
      const onChange = jest.fn()
      await render(<Count start={7} min={5} max={50} onChange={onChange} />)
      await retype('3')
      // Not the 7 it was before, which is what a form sent.
      expect(onChange.mock.calls).toEqual([[5]])
      expect(shows()).toBe('3')
      await leave()
      expect(shows()).toBe('5')
    })

    it('shows what is typed throughout: the "1" of "12" under a least of 5 is typed as it was', async () => {
      const onChange = jest.fn()
      await render(<Count start={7} min={5} max={50} onChange={onChange} />)
      await fireEvent.changeText(field(), '')
      expect(shows()).toBe('')
      await fireEvent.changeText(field(), '1')
      expect(shows()).toBe('1')
      expect(onChange.mock.calls).toEqual([[5]])
      await fireEvent.changeText(field(), '12')
      expect(shows()).toBe('12')
      expect(onChange.mock.calls).toEqual([[5], [12]])
    })

    it('steps by its buttons from that number, and not from one the field no longer shows', async () => {
      await render(<Count start={3} min={1} max={12} />)
      await retype('15')
      await userEvent.press(screen.getByRole('button', { name: decrease }))
      expect(shows()).toBe('11')

      await retype('0')
      await userEvent.press(screen.getByRole('button', { name: increase }))
      expect(shows()).toBe('2')
    })

    // Another control of a form may set the number, and its press leaves no field: what was
    // typed is the field's until it is left, and is given to nobody a second time then.
    it('gives nothing again as the field is left: a number its owner changed meanwhile stands', async () => {
      const onChange = jest.fn()
      function Form() {
        const [value, setValue] = useState(3)
        return (
          <>
            <Stepper
              label={sample.members}
              value={value}
              min={1}
              max={12}
              onChange={(next) => {
                onChange(next)
                setValue(next)
              }}
            />
            <Pressable
              testID="form:reset"
              onPress={() => {
                setValue(3)
              }}
            />
          </>
        )
      }
      await render(<Form />)
      await retype('7')
      expect(onChange.mock.calls).toEqual([[7]])
      await fireEvent.press(screen.getByTestId('form:reset'))
      await leave()
      expect(shows()).toBe('3')
      expect(onChange.mock.calls).toEqual([[7]])
    })

    // An owner may take a number later than it is given, and shows the one before it until
    // then. Leaving the field no longer says the last one again, so each key must.
    it('gives a number typed back to the one its owner still shows, which is not the one it was last given', async () => {
      const onChange = jest.fn()
      await render(
        <Stepper label={sample.members} value={3} min={1} max={12} onChange={onChange} />,
      )
      await fireEvent.changeText(field(), '5')
      await fireEvent.changeText(field(), '')
      await fireEvent.changeText(field(), '3')
      expect(onChange.mock.calls).toEqual([[5], [3]])
      // And once left, what is typed next is held against what its owner shows alone.
      await leave()
      await fireEvent.changeText(field(), '3')
      expect(onChange.mock.calls).toEqual([[5], [3]])
      // A step is counted from the number typed, and not from the one its owner still shows.
      await fireEvent.changeText(field(), '9')
      await userEvent.press(screen.getByRole('button', { name: decrease }))
      expect(onChange.mock.lastCall).toEqual([8])
    })
  })

  it.each(['.', ','])(
    'holds a whole number alone: a fraction typed with "%s" is given as the nearest one, and shown as it once left',
    async (mark) => {
      const onChange = jest.fn()
      await render(<Count start={2} min={1} max={12} onChange={onChange} />)
      await retype(`2${mark}`)
      // The "2" on the way is what its owner holds, and "2," is no number yet.
      expect(onChange).not.toHaveBeenCalled()
      await retype(`2${mark}5`)
      expect(onChange.mock.calls).toEqual([[3]])
      expect(shows()).toBe(`2${mark}5`)
      await leave()
      expect(onChange.mock.calls).toEqual([[3]])
      expect(shows()).toBe('3')

      // Rounded first and held to the bounds after: 12.6 is no 13 over a most of 12.
      await retype(`12${mark}6`)
      await leave()
      expect(shows()).toBe('12')
      expect(onChange.mock.calls.flat().every((value) => Number.isInteger(value))).toBe(true)
    },
  )

  it('is what it was once left with what is no number', async () => {
    const onChange = jest.fn()
    await render(<Count start={4} onChange={onChange} />)
    await fireEvent.changeText(field(), '4 a')
    await leave()
    expect(shows()).toBe('4')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is settled by the keyboard’s own key, before the field is left: what is sent is what it shows', async () => {
    const onChange = jest.fn()
    await render(<Count start={2} min={1} max={12} onChange={onChange} />)
    await retype('20')
    await fireEvent(field(), 'submitEditing')
    expect(shows()).toBe('12')
    expect(onChange.mock.lastCall).toEqual([12])

    await retype('2.5')
    await fireEvent(field(), 'submitEditing')
    expect(shows()).toBe('3')

    // Emptied, it is what it was. And the leaving that follows the key settles nothing twice.
    await fireEvent.changeText(field(), '')
    await fireEvent(field(), 'submitEditing')
    await leave()
    expect(shows()).toBe('3')
    expect(onChange.mock.lastCall).toEqual([3])
  })

  it('moves by its step under a button, and takes any whole number typed between two steps', async () => {
    await render(<Count start={5} min={0} step={5} />)
    await userEvent.press(screen.getByRole('button', { name: increase }))
    expect(shows()).toBe('10')
    await retype('7')
    await leave()
    expect(shows()).toBe('7')
    await userEvent.press(screen.getByRole('button', { name: increase }))
    expect(shows()).toBe('12')
    // A step that would pass the least is held to it.
    await userEvent.press(screen.getByRole('button', { name: decrease }))
    await userEvent.press(screen.getByRole('button', { name: decrease }))
    await userEvent.press(screen.getByRole('button', { name: decrease }))
    expect(shows()).toBe('0')
  })

  it('keeps a button that has stepped to its bound, which then does nothing and says so', async () => {
    const onChange = jest.fn()
    await render(<Count start={2} min={1} max={3} onChange={onChange} />)
    await userEvent.press(screen.getByRole('button', { name: decrease }))
    expect(shows()).toBe('1')
    // Still there, under the finger that stepped, and still a screen reader's to stand on.
    const button = screen.getByRole('button', { name: decrease })
    expect(button).toBeDisabled()
    expect(button.props.accessible).toBe(true)
    expect(button).not.toBeBusy()
    await userEvent.press(button)
    expect(shows()).toBe('1')
    expect(onChange).toHaveBeenCalledTimes(1)
    // The rules take it for a disabled control until the test says which one it is.
    expect(violations(button).map(({ rule }) => rule)).toEqual(['never-disabled'])
    expectAccessible(screen.root, { outOfForm: [decrease] })
  })

  it('has no buttons where it takes no change: read-only, and out of its form', async () => {
    const view = await render(
      <Stepper label={sample.members} value={2} onChange={() => undefined} readOnly />,
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(field().props).toMatchObject({ editable: false, accessibilityState: {} })
    expect(field().props.accessibilityActions).toBeUndefined()
    expectAccessible()
    await view.unmount()

    await render(<Stepper label={sample.members} value={2} onChange={() => undefined} disabled />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(field().props).toMatchObject({
      editable: false,
      accessibilityState: { disabled: true },
    })
    expectAccessible(screen.root, { outOfForm: [sample.members] })
  })

  it('steps by a screen reader’s own actions on the field, named as its buttons are', async () => {
    const onChange = jest.fn()
    await render(<Count start={2} min={1} max={3} onChange={onChange} />)
    expect(field().props.accessibilityActions).toEqual([
      { name: 'increment', label: increase },
      { name: 'decrement', label: decrease },
    ])
    await fireEvent(field(), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } })
    expect(shows()).toBe('3')
    // At its bound the action does nothing, as its button does.
    await fireEvent(field(), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } })
    await fireEvent(field(), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } })
    expect(onChange.mock.calls).toEqual([[3], [2]])
  })

  it('names its buttons in the member’s language, and is a number’s field at 200 %', async () => {
    await render(<Count start={2} min={0} />, { locale: 'de', scale: 2 })
    expect(
      screen.getByRole('button', {
        name: createTranslator('de')('ui.stepper.increase', { name: sample.members }),
      }),
    ).toBeOnTheScreen()
    expect(field().props).toMatchObject({ keyboardType: 'number-pad', allowFontScaling: false })
    expectAccessible()
  })

  // Three targets and two gaps: 88 + 8 + 88 + 8 + 88 at 200 %, which is what a dialog leaves
  // on a phone 360 pt wide. With the count held to 64 pt a scale the second button was cut.
  it('needs no more room at 200 % than a dialog leaves it on a phone, and wraps where it has less', async () => {
    await render(<Count start={2} min={0} />, { scale: 2 })
    const row = field().parent as TestInstance
    const style = styleOf(row)
    expect(style).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' })
    const least = (row.children as TestInstance[]).map((part) => styleOf(part).minWidth)
    expect(least).toEqual([88, 88, 88])
    expect(88 * 3 + (style.gap as number) * 2).toBeLessThanOrEqual(360 - 2 * 16 - 2 * 24)
    expectAccessible()
  })

  // Past the whole numbers a number holds exactly, what is typed is no longer what is given.
  it('holds what is typed to the numbers it can hold exactly, where nothing else bounds it', async () => {
    const onChange = jest.fn<(value: number) => void>()
    await render(<Count start={2} onChange={onChange} />)
    await retype('9'.repeat(22))
    expect(onChange.mock.calls.length).toBeGreaterThan(0)
    expect(onChange.mock.calls.every(([value]) => Number.isSafeInteger(value))).toBe(true)
    await leave()
    expect(shows()).toBe(String(Number.MAX_SAFE_INTEGER))
    await retype(`-${'9'.repeat(22)}`)
    await leave()
    expect(shows()).toBe(String(Number.MIN_SAFE_INTEGER))
  })

  it('asks for a keyboard with a minus where nothing holds it above nothing', async () => {
    await render(<Count start={0} />)
    expect(field().props.keyboardType).toBe('numbers-and-punctuation')
    await retype('-3')
    await leave()
    expect(shows()).toBe('-3')
  })

  // On Android a field of one line that is centred keeps the touch that begins on it from the
  // page it stands on, which then does not scroll (Stepper.tsx says what of that is read).
  it('centres its count on iOS, and leaves it at its start on Android', async () => {
    const aligned = () => StyleSheet.flatten(field().props.style as StyleProp<TextStyle>).textAlign
    const view = await render(<Count start={2} />)
    expect(aligned()).toBe('center')
    await view.unmount()
    jest.replaceProperty(Platform, 'OS', 'android')
    await render(<Count start={2} />)
    expect(aligned()).toBeUndefined()
    expectAccessible()
  })
})
