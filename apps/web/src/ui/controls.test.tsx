// Buttons and inputs (02-components §1): each in the states it has.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState, type SyntheticEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { draw } from '../test/render.tsx'
import { Button, IconButton, type ButtonVariant } from './Button.tsx'
import { Checkbox, RadioGroup, Switch } from './Choice.tsx'
import { Select, Stepper, TextArea, TextField } from './Field.tsx'

// The words a test draws. Named here, since the lint that keeps literals out of the clients'
// markup holds a test's markup too.
const words = {
  save: 'Save reading',
  edit: 'Edit Cellar meter',
  value: 'Value, kWh',
  help: 'The reading on the dial, decimals included.',
  low: 'That is lower than the reading on 3 February.',
  note: 'Note',
  register: 'Register',
  choose: 'Choose',
  members: 'Members',
  remind: 'Remind me a week before',
  share: 'Share this list with the household',
  repeats: 'Repeats',
} as const

const tariffs = [
  { value: 'day', label: 'Day tariff' },
  { value: 'night', label: 'Night tariff' },
]

const intervals = [
  { value: 'week', label: 'Every week' },
  { value: 'month', label: 'Every month' },
  { value: 'never', label: 'Never', disabled: true },
]

describe('a button', () => {
  it.each<ButtonVariant>(['primary', 'secondary', 'ghost', 'danger'])(
    'is a button of its own kind, pressed once per press: %s',
    async (variant) => {
      const onClick = vi.fn()
      draw(
        <Button variant={variant} onClick={onClick}>
          {words.save}
        </Button>,
      )
      const button = screen.getByRole('button', { name: words.save })
      expect(button).toHaveAttribute('type', 'button')
      expect(button.className).toContain(variant)
      await userEvent.click(button)
      expect(onClick).toHaveBeenCalledTimes(1)
    },
  )

  it('keeps its place, its words and its focus while loading, and takes no second press', async () => {
    const onClick = vi.fn()
    draw(
      <Button loading onClick={onClick}>
        {words.save}
      </Button>,
    )
    const button = screen.getByRole('button', { name: words.save })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // Not disabled: it stays in the tab order, where the focus was.
    expect(button).toBeEnabled()
    await userEvent.tab()
    expect(button).toHaveFocus()
    await userEvent.click(button)
    await userEvent.keyboard('{Enter}')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('submits its form once: no second time while loading, by a press or by Enter in a field', async () => {
    const onSubmit = vi.fn((event: SyntheticEvent) => {
      event.preventDefault()
    })
    const form = (loading: boolean) => (
      <form onSubmit={onSubmit}>
        <TextField label={words.value} />
        <Button type="submit" loading={loading}>
          {words.save}
        </Button>
      </form>
    )
    const { rerender } = draw(form(false))
    await userEvent.click(screen.getByRole('button', { name: words.save }))
    expect(onSubmit).toHaveBeenCalledTimes(1)

    rerender(form(true))
    await userEvent.click(screen.getByRole('button', { name: words.save }))
    await userEvent.type(screen.getByRole('textbox', { name: words.value }), '18{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)

    rerender(form(false))
    await userEvent.type(screen.getByRole('textbox', { name: words.value }), '{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('takes no press, and keeps the focus, where it is said to have nothing to do', async () => {
    const onClick = vi.fn()
    draw(
      <Button aria-disabled onClick={onClick}>
        {words.save}
      </Button>,
    )
    const button = screen.getByRole('button', { name: words.save })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toHaveAttribute('aria-busy')
    await userEvent.tab()
    expect(button).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('takes no press when it is disabled', async () => {
    const onClick = vi.fn()
    draw(
      <Button disabled onClick={onClick}>
        {words.save}
      </Button>,
    )
    await userEvent.click(screen.getByRole('button', { name: words.save }))
    expect(onClick).not.toHaveBeenCalled()
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('submits a form only when it is told it is the form’s', () => {
    draw(
      <Button type="submit" variant="primary">
        {words.save}
      </Button>,
    )
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
  })
})

describe('an icon button', () => {
  it('is named by its label, since nothing is written on it', async () => {
    const onClick = vi.fn()
    draw(<IconButton label={words.edit} icon={<svg aria-hidden="true" />} onClick={onClick} />)
    const button = screen.getByRole('button', { name: words.edit })
    expect(button).toHaveTextContent('')
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('says it is busy while loading, under the same name', () => {
    draw(<IconButton label={words.edit} icon={<svg aria-hidden="true" />} loading />)
    expect(screen.getByRole('button', { name: words.edit })).toHaveAttribute('aria-busy', 'true')
  })
})

describe('a text field', () => {
  it('is labelled, and described by its help', () => {
    draw(<TextField label={words.value} help={words.help} />)
    const input = screen.getByRole('textbox', { name: words.value })
    expect(input).toHaveAccessibleDescription(words.help)
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toBeRequired()
  })

  it('states an error in words, tied to the field, and marks the field invalid', () => {
    draw(<TextField label={words.value} help={words.help} error={words.low} />)
    const input = screen.getByRole('textbox', { name: words.value })
    expect(input).toBeInvalid()
    expect(input).toHaveAccessibleDescription(`${words.help} ${words.low}`)
    expect(screen.getByText(words.low)).toBeVisible()
  })

  it('says a required field is required in a word, and to the platform', () => {
    draw(<TextField label={words.value} required />)
    expect(screen.getByRole('textbox', { name: /Value, kWh/ })).toBeRequired()
    expect(screen.getByText('Required')).toBeVisible()
  })

  it('takes what is typed, is read-only when told, and takes nothing when disabled', async () => {
    const onChange = vi.fn()
    const { rerender } = draw(<TextField label={words.value} numeric onChange={onChange} />)
    await userEvent.type(screen.getByRole('textbox'), '18')
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('textbox').className).toContain('numeric')

    rerender(<TextField label={words.value} readOnly defaultValue="18 116,0" />)
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly')
    rerender(<TextField label={words.value} disabled />)
    expect(screen.getByRole('textbox')).toBeDisabled()
  })
})

describe('a text area and a select', () => {
  it('are labelled as a field is', () => {
    draw(
      <>
        <TextArea label={words.note} error={words.low} />
        <Select
          label={words.register}
          placeholder={words.choose}
          defaultValue=""
          options={tariffs}
        />
      </>,
    )
    expect(screen.getByRole('textbox', { name: words.note })).toBeInvalid()
    const select = screen.getByRole('combobox', { name: words.register })
    expect(select).toHaveDisplayValue(words.choose)
    // What it reads while nothing is chosen cannot be chosen back.
    expect(screen.getByRole('option', { name: words.choose })).toBeDisabled()
  })

  it('chooses an option', async () => {
    const onChange = vi.fn()
    draw(<Select label={words.register} defaultValue="day" onChange={onChange} options={tariffs} />)
    await userEvent.selectOptions(screen.getByRole('combobox'), 'night')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('combobox')).toHaveDisplayValue('Night tariff')
  })

  it('has nothing chosen where nothing says what is: no first option taken without a word', async () => {
    draw(<Select label={words.register} placeholder={words.choose} required options={tariffs} />)
    const select = screen.getByRole('combobox', { name: /Register/ })
    expect(select).toHaveDisplayValue(words.choose)
    expect(select).toHaveValue('')
    // A required field with nothing chosen does not pass as filled.
    expect(select).toBeInvalid()
    await userEvent.selectOptions(select, 'night')
    expect(select).toHaveDisplayValue('Night tariff')
    expect(select).toBeValid()
  })

  it('starts on what its caller says is chosen, placeholder or not', () => {
    const { rerender } = draw(
      <Select
        label={words.register}
        placeholder={words.choose}
        defaultValue="night"
        options={tariffs}
      />,
    )
    expect(screen.getByRole('combobox')).toHaveDisplayValue('Night tariff')
    rerender(
      <Select
        key="held"
        label={words.register}
        placeholder={words.choose}
        value="day"
        onChange={() => undefined}
        options={tariffs}
      />,
    )
    expect(screen.getByRole('combobox')).toHaveDisplayValue('Day tariff')
  })
})

function Count({
  start,
  min,
  max,
  onChange,
}: {
  start: number
  min?: number
  max?: number
  onChange?: (value: number) => void
}) {
  const [value, setValue] = useState(start)
  return (
    <Stepper
      label={words.members}
      value={value}
      onChange={(next) => {
        onChange?.(next)
        setValue(next)
      }}
      {...(min === undefined ? {} : { min })}
      {...(max === undefined ? {} : { max })}
    />
  )
}

describe('a stepper', () => {
  it('steps by its buttons, each named for what it does to what', async () => {
    draw(<Count start={2} />)
    const input = screen.getByRole('spinbutton', { name: words.members })
    await userEvent.click(screen.getByRole('button', { name: 'Increase Members' }))
    await userEvent.click(screen.getByRole('button', { name: 'Increase Members' }))
    expect(input).toHaveValue(4)
    await userEvent.click(screen.getByRole('button', { name: 'Decrease Members' }))
    expect(input).toHaveValue(3)
  })

  it('stops at its bounds, and holds a typed value to them once the field is left', async () => {
    draw(<Count start={1} min={1} max={3} />)
    expect(screen.getByRole('button', { name: 'Decrease Members' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    const input = screen.getByRole('spinbutton')
    await userEvent.clear(input)
    await userEvent.type(input, '9')
    expect(input).toHaveValue(9)
    await userEvent.tab()
    expect(input).toHaveValue(3)
    expect(screen.getByRole('button', { name: 'Increase Members' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('takes a value typed key by key under its least, and an emptied field on the way', async () => {
    const onChange = vi.fn()
    draw(<Count start={5} min={5} max={50} onChange={onChange} />)
    const input = screen.getByRole('spinbutton')
    await userEvent.clear(input)
    expect(input).toHaveValue(null)
    await userEvent.type(input, '12')
    expect(input).toHaveValue(12)
    // The "1" on the way was under the least, and was no value yet.
    expect(onChange.mock.calls).toEqual([[12]])
    await userEvent.tab()
    expect(input).toHaveValue(12)

    // Left empty, it is what it was.
    await userEvent.clear(input)
    await userEvent.tab()
    expect(input).toHaveValue(12)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('holds a whole number alone: a fraction typed in is no value, and is the nearest one once left', async () => {
    const onChange = vi.fn()
    draw(<Count start={2} min={1} max={12} onChange={onChange} />)
    const input = screen.getByRole('spinbutton')
    await userEvent.clear(input)
    await userEvent.type(input, '2.5')
    // The "2" on the way is a whole number; "2.5" is not, and is given to nobody.
    expect(onChange.mock.calls).toEqual([[2]])
    await userEvent.tab()
    expect(onChange.mock.calls).toEqual([[2], [3]])
    expect(input).toHaveValue(3)

    // Rounded first and held to the bounds after: 12.6 is no 13 over a most of 12.
    await userEvent.clear(input)
    await userEvent.type(input, '12.6')
    await userEvent.tab()
    expect(input).toHaveValue(12)
    expect(onChange.mock.calls.flat().every((value) => Number.isInteger(value))).toBe(true)
  })

  it('is settled before Enter submits its form: what is sent is what the field shows', async () => {
    // Enter in a field submits its form, and the field has not been left: what was typed over a
    // bound, or between two whole numbers, has been given to nobody yet.
    const sent: number[] = []
    function Form() {
      const [value, setValue] = useState(2)
      return (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            sent.push(value)
          }}
        >
          <Stepper label={words.members} value={value} onChange={setValue} min={1} max={12} />
          <Button type="submit">{words.save}</Button>
        </form>
      )
    }
    draw(<Form />)
    const input = screen.getByRole('spinbutton')
    await userEvent.clear(input)
    await userEvent.type(input, '20{Enter}')
    expect(input).toHaveValue(12)
    expect(sent).toEqual([12])

    await userEvent.clear(input)
    await userEvent.type(input, '2.5{Enter}')
    expect(input).toHaveValue(3)
    expect(sent).toEqual([12, 3])

    // Emptied, it is what it was, and that is what is sent.
    await userEvent.clear(input)
    await userEvent.type(input, '{Enter}')
    expect(input).toHaveValue(3)
    expect(sent).toEqual([12, 3, 3])
  })

  it('keeps the focus on a button that has stepped to its bound, which then does nothing', async () => {
    draw(<Count start={2} min={1} max={3} />)
    const decrease = screen.getByRole('button', { name: 'Decrease Members' })
    await userEvent.click(decrease)
    expect(screen.getByRole('spinbutton')).toHaveValue(1)
    expect(decrease).toHaveFocus()
    // Not disabled: a disabled button would drop the focus it holds.
    expect(decrease).toBeEnabled()
    expect(decrease).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('spinbutton')).toHaveValue(1)
  })

  it('takes no step and no typing where it is disabled', () => {
    draw(<Stepper label={words.members} value={2} onChange={() => undefined} disabled />)
    expect(screen.getByRole('button', { name: 'Decrease Members' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Increase Members' })).toBeDisabled()
    expect(screen.getByRole('spinbutton')).toBeDisabled()
  })

  it('names its buttons in the member’s language', () => {
    draw(<Count start={2} />, 'de')
    expect(screen.getByRole('button', { name: 'Members erhöhen' })).toBeInTheDocument()
  })
})

describe('a checkbox, a switch and a radio group', () => {
  it('are named by their labels, and the whole label is the target', async () => {
    draw(
      <>
        <Checkbox label={words.remind} />
        <Switch label={words.share} />
      </>,
    )
    await userEvent.click(screen.getByText(words.remind))
    expect(screen.getByRole('checkbox', { name: words.remind })).toBeChecked()
    await userEvent.click(screen.getByText(words.share))
    expect(screen.getByRole('switch', { name: words.share })).toBeChecked()
  })

  it('shows a checkbox that is neither on nor off', () => {
    const { rerender } = draw(<Checkbox label={words.remind} indeterminate />)
    expect(screen.getByRole('checkbox')).toBePartiallyChecked()
    rerender(<Checkbox label={words.remind} />)
    expect(screen.getByRole('checkbox')).not.toBePartiallyChecked()
  })

  it('is still neither after a press where its owner still says so, and tells its owner of the press', async () => {
    // The platform makes a pressed box plainly on or off. A box that stands for many rows is
    // what its owner says of them, and an owner whose rows are still some and not all says so.
    const onChange = vi.fn()
    draw(<Checkbox label={words.remind} indeterminate onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('checkbox')).toBePartiallyChecked()
  })

  it('is on or off after a press where its owner then says it is', async () => {
    function All() {
      const [all, setAll] = useState(false)
      return (
        <Checkbox
          label={words.remind}
          checked={all}
          indeterminate={!all}
          onChange={() => {
            setAll(true)
          }}
        />
      )
    }
    draw(<All />)
    expect(screen.getByRole('checkbox')).toBePartiallyChecked()
    await userEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('checkbox')).not.toBePartiallyChecked()
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('hands their input to a caller that asks for it by a ref', () => {
    const checkbox = createRef<HTMLInputElement>()
    const told = vi.fn()
    const toggle = createRef<HTMLInputElement>()
    const { rerender } = draw(
      <>
        <Checkbox label={words.remind} ref={checkbox} indeterminate />
        <Switch label={words.share} ref={toggle} />
      </>,
    )
    expect(checkbox.current).toBe(screen.getByRole('checkbox', { name: words.remind }))
    expect(toggle.current).toBe(screen.getByRole('switch', { name: words.share }))
    // The component still reaches it itself, for what has no attribute.
    expect(checkbox.current).toBePartiallyChecked()

    rerender(<Checkbox label={words.remind} ref={told} />)
    expect(told).toHaveBeenCalledWith(screen.getByRole('checkbox', { name: words.remind }))
    expect(checkbox.current).toBeNull()
  })

  it('chooses one of a named group, and leaves a disabled one alone', async () => {
    const onChange = vi.fn()
    draw(<RadioGroup label={words.repeats} value="month" onChange={onChange} options={intervals} />)
    expect(screen.getByRole('group', { name: words.repeats })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Every month' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Every week' }))
    expect(onChange).toHaveBeenCalledWith('week')
    await userEvent.click(screen.getByRole('radio', { name: 'Never' }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
