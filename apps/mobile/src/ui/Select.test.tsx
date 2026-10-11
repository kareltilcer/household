// The select's contract (02-components §1, D-172; the web's `controls.test.tsx`, "a select",
// is its twin): what it reads, what its sheet offers, and that nothing is chosen until a
// member chooses.
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { controls } from '@household/icons'
import { catalogs } from '@household/i18n'
import { nativeThemes } from '@household/tokens/native'
import { act, screen, userEvent } from '@testing-library/react-native'
import { useState } from 'react'
import { Keyboard, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { expectAccessible, violations } from '../test/a11y.ts'
import { render } from '../test/render.tsx'
import * as announcer from './announce.ts'
import { sample, tariffs } from './controls.fixtures.ts'
import { Select } from './Select.tsx'

const required = catalogs.en['ui.field.required']
const close = catalogs.en[controls.close_sheet.labelKey]
const [day, night] = tariffs

function Register({
  start,
  placeholder = sample.choose,
  onChange,
}: {
  readonly start?: string
  readonly placeholder?: string | null
  readonly onChange?: (value: string) => void
}) {
  const [value, setValue] = useState<string | undefined>(start)
  return (
    <Select
      testID="register"
      label={sample.register}
      options={tariffs}
      value={value}
      {...(placeholder === null ? {} : { placeholder })}
      onChange={(next) => {
        onChange?.(next)
        setValue(next)
      }}
    />
  )
}

const field = () => screen.getByRole('button', { name: sample.register })

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a select', () => {
  it('has nothing chosen where nothing says what is: no first option taken without a word', async () => {
    const onChange = jest.fn()
    await render(<Register onChange={onChange} />)
    // It reads its placeholder, which is no option of it.
    expect(field()).toHaveAccessibilityValue({ text: sample.choose })
    expect(field()).toHaveTextContent(sample.choose)
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.press(field())
    expect(screen.getAllByRole('radio')).toHaveLength(tariffs.length)
    expect(screen.queryByRole('radio', { checked: true })).toBeNull()
    expect(screen.queryByRole('radio', { name: sample.choose })).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expectAccessible()
  })

  it('reads nothing at all where it has no placeholder either', async () => {
    await render(<Register placeholder={null} />)
    expect(field()).toHaveAccessibilityValue({})
    expect(field()).toHaveTextContent('')
    expect(screen.queryByText(day.label)).toBeNull()
  })

  it('opens a sheet of its choices, named as it is, and takes the one that is pressed', async () => {
    // Everywhere but on iOS the sheet is gone as soon as it is closed.
    jest.replaceProperty(Platform, 'OS', 'android')
    const order: string[] = []
    jest.spyOn(announcer, 'focusOn').mockImplementation(() => {
      order.push('focus')
      return true
    })
    const onChange = jest.fn((value: string) => {
      order.push(value)
    })
    await render(<Register onChange={onChange} />)
    expect(field()).toBeCollapsed()
    await userEvent.press(field())
    expect(field()).toBeExpanded()
    expect(screen.getByRole('header', { name: sample.register })).toBeOnTheScreen()
    await userEvent.press(screen.getByRole('radio', { name: night.label }))
    expect(onChange.mock.calls).toEqual([['night']])
    // The focus is back on the field first: what the choice sets off may move it on.
    expect(order).toEqual(['focus', 'night'])
    // The sheet is closed, and the field reads what was chosen.
    expect(screen.queryByRole('radio')).toBeNull()
    expect(field()).toHaveAccessibilityValue({ text: night.label })
    expect(field()).toHaveTextContent(night.label)
  })

  it('waits on iOS until the platform says the sheet has gone, and tells its owner once', async () => {
    jest.spyOn(announcer, 'focusOn').mockReturnValue(true)
    const onChange = jest.fn()
    await render(<Register onChange={onChange} />)
    await userEvent.press(field())
    const { onDismiss } = screen.getByTestId('register:choices').props as {
      readonly onDismiss: () => void
    }
    await userEvent.press(screen.getByRole('radio', { name: night.label }))
    // The sheet is still leaving: nobody is told, and the field reads what it read.
    expect(onChange).not.toHaveBeenCalled()
    expect(field()).toHaveTextContent(sample.choose)
    await act(() => {
      onDismiss()
    })
    expect(onChange.mock.calls).toEqual([['night']])
    expect(field()).toHaveTextContent(night.label)
    // Said again by the platform, nobody is told twice.
    await act(() => {
      onDismiss()
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('starts on what its owner says is chosen, and tells nobody when that is chosen again', async () => {
    jest.replaceProperty(Platform, 'OS', 'android')
    const onChange = jest.fn()
    await render(<Register start="day" onChange={onChange} />)
    expect(field()).toHaveAccessibilityValue({ text: day.label })
    await userEvent.press(field())
    expect(screen.getByRole('radio', { name: day.label })).toBeChecked()
    expect(screen.getByRole('radio', { name: night.label })).not.toBeChecked()
    await userEvent.press(screen.getByRole('radio', { name: day.label }))
    expect(screen.queryByRole('radio')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is closed with nothing chosen by its close control, and gives the focus back to the field', async () => {
    jest.replaceProperty(Platform, 'OS', 'android')
    const focus = jest.spyOn(announcer, 'focusOn').mockReturnValue(true)
    const onChange = jest.fn()
    await render(<Register onChange={onChange} />)
    await userEvent.press(field())
    await userEvent.press(screen.getByRole('button', { name: close }))
    expect(screen.queryByRole('radio')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect({ ...focus.mock.lastCall?.[0].current?.props }).toMatchObject({
      accessibilityLabel: sample.register,
    })
  })

  it('says what is required of it and what is wrong with it, as any field does', async () => {
    await render(
      <Select
        testID="register"
        label={sample.register}
        options={tariffs}
        value={undefined}
        onChange={() => undefined}
        placeholder={sample.choose}
        help={sample.help}
        error={sample.low}
        required
      />,
      { scale: 2 },
    )
    const control = screen.getByRole('button', { name: `${sample.register}, ${required}` })
    expect(control.props.accessibilityHint).toBe(`${sample.help} ${sample.low}`)
    expect(screen.getByText(sample.low)).toBeOnTheScreen()
    expect(StyleSheet.flatten(control.props.style as StyleProp<ViewStyle>).borderColor).toBe(
      nativeThemes.light.color.danger,
    )
    expectAccessible()
  })

  // The sheet takes the screen from whatever field was being typed in, whose keyboard would
  // stand over its choices.
  it('puts the keyboard away as it opens, and leaves it be where it opens nothing', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined)
    const view = await render(<Register />)
    expect(dismiss).not.toHaveBeenCalled()
    await userEvent.press(field())
    expect(dismiss).toHaveBeenCalledTimes(1)
    await view.unmount()
    dismiss.mockClear()
    await render(
      <Select
        label={sample.register}
        options={tariffs}
        value="day"
        onChange={() => undefined}
        disabled
      />,
    )
    await userEvent.press(field())
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('opens nothing out of its form, and says so', async () => {
    await render(
      <Select
        label={sample.register}
        options={tariffs}
        value="day"
        onChange={() => undefined}
        disabled
      />,
    )
    await userEvent.press(field())
    expect(field()).toBeDisabled()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(violations(field()).map(({ rule }) => rule)).toEqual(['never-disabled'])
    expectAccessible(screen.root, { outOfForm: [sample.register] })
  })

  it.each(['light', 'dark'] as const)(
    'draws its sheet accessibly in the %s theme',
    async (theme) => {
      await render(<Register start="night" />, { theme, scale: 2 })
      await userEvent.press(field())
      expectAccessible()
    },
  )
})
