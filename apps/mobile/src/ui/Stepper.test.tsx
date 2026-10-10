// The stepper's rules (the web's `controls.test.tsx`, "a stepper", is their twin): what its
// buttons do, what typing gives its owner and when, and what it holds once it is left.
import { describe, expect, it, jest } from '@jest/globals'
import { createTranslator } from '@household/i18n'
import { fireEvent, screen, userEvent } from '@testing-library/react-native'
import { useState } from 'react'
import { expectAccessible, violations } from '../test/a11y.ts'
import { render } from '../test/render.tsx'
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
    // The "1" on the way was under the least, and was no value yet.
    expect(onChange.mock.calls).toEqual([[12]])
    await leave()
    expect(shows()).toBe('12')

    // Left empty, it is what it was.
    await fireEvent.changeText(field(), '')
    await leave()
    expect(shows()).toBe('12')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it.each(['.', ','])(
    'holds a whole number alone: a fraction typed with "%s" is no value, and is the nearest one once left',
    async (mark) => {
      const onChange = jest.fn()
      await render(<Count start={2} min={1} max={12} onChange={onChange} />)
      await retype(`2${mark}5`)
      // The "2" on the way is a whole number; the fraction is not, and is given to nobody.
      expect(onChange.mock.calls).toEqual([[2]])
      await leave()
      expect(onChange.mock.calls).toEqual([[2], [3]])
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

  it('asks for a keyboard with a minus where nothing holds it above nothing', async () => {
    await render(<Count start={0} />)
    expect(field().props.keyboardType).toBe('numbers-and-punctuation')
    await retype('-3')
    await leave()
    expect(shows()).toBe('-3')
  })
})
