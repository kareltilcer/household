// Checkbox, switch and radio (02-components §1; the web's `controls.test.tsx` is their twin):
// what each is called, what a press does, and what it is while its owner says so.
import { describe, expect, it, jest } from '@jest/globals'
import { nativeThemes } from '@household/tokens/native'
import { screen, userEvent } from '@testing-library/react-native'
import { createRef, useState } from 'react'
import { StyleSheet, type StyleProp, type View, type ViewStyle } from 'react-native'
import { elementsOf, expectAccessible, violations } from '../test/a11y.ts'
import { render } from '../test/render.tsx'
import { Checkbox, RadioGroup, Switch } from './Choice.tsx'
import { intervals, sample } from './controls.fixtures.ts'

function Both() {
  const [remind, setRemind] = useState(false)
  const [share, setShare] = useState(false)
  return (
    <>
      <Checkbox testID="remind" label={sample.remind} checked={remind} onChange={setRemind} />
      <Switch testID="share" label={sample.share} checked={share} onChange={setShare} />
    </>
  )
}

function styleOf(testID: string): ViewStyle {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style as StyleProp<ViewStyle>)
}

/** Whether anything is drawn in the mark of the choice called `name`: a check, or a dash. */
function glyphIn(role: 'checkbox' | 'radio', name: string): boolean {
  return elementsOf(screen.getByRole(role, { name })).some(
    (element) => element.type === 'RNSVGSvgView',
  )
}

describe('a checkbox and a switch', () => {
  it('are named by their labels, and the whole row is the target', async () => {
    await render(<Both />)
    // A press on the words is a press on the control: the row is the one target.
    await userEvent.press(screen.getByText(sample.remind))
    expect(screen.getByRole('checkbox', { name: sample.remind })).toBeChecked()
    await userEvent.press(screen.getByText(sample.share))
    expect(screen.getByRole('switch', { name: sample.share })).toBeChecked()
    await userEvent.press(screen.getByRole('switch', { name: sample.share }))
    expect(screen.getByRole('switch', { name: sample.share })).not.toBeChecked()
    expect(styleOf('remind')).toMatchObject({ alignSelf: 'stretch', minHeight: 44 })
    expect(styleOf('share')).toMatchObject({ alignSelf: 'stretch', minHeight: 44 })
    expectAccessible()
  })

  it('say what is chosen by more than a colour: a check in the box, where the thumb stands', async () => {
    await render(<Both />)
    expect(glyphIn('checkbox', sample.remind)).toBe(false)
    await userEvent.press(screen.getByRole('checkbox', { name: sample.remind }))
    expect(glyphIn('checkbox', sample.remind)).toBe(true)

    const track = () => {
      const [, mark] = elementsOf(screen.getByTestId('share'))
      return StyleSheet.flatten(mark?.props.style as StyleProp<ViewStyle>)
    }
    expect(track().alignItems).toBe('flex-start')
    await userEvent.press(screen.getByRole('switch', { name: sample.share }))
    expect(track()).toMatchObject({
      alignItems: 'flex-end',
      backgroundColor: nativeThemes.light.color.accent,
    })
  })

  it('shows a checkbox that is neither on nor off, and says so', async () => {
    const view = await render(
      <Checkbox label={sample.remind} checked={false} indeterminate onChange={() => undefined} />,
    )
    expect(screen.getByRole('checkbox')).toBePartiallyChecked()
    expect(glyphIn('checkbox', sample.remind)).toBe(true)
    await view.unmount()
    await render(<Checkbox label={sample.remind} checked={false} onChange={() => undefined} />)
    expect(screen.getByRole('checkbox')).not.toBePartiallyChecked()
    expect(glyphIn('checkbox', sample.remind)).toBe(false)
  })

  it('is still neither after a press where its owner still says so, and tells its owner of the press', async () => {
    // A box that stands for many rows is what its owner says of them, and an owner whose rows
    // are still some and not all says so.
    const onChange = jest.fn()
    await render(
      <Checkbox label={sample.remind} checked={false} indeterminate onChange={onChange} />,
    )
    await userEvent.press(screen.getByRole('checkbox'))
    expect(onChange.mock.calls).toEqual([[true]])
    expect(screen.getByRole('checkbox')).toBePartiallyChecked()
  })

  it('is on or off after a press where its owner then says it is', async () => {
    function All() {
      const [all, setAll] = useState(false)
      return (
        <Checkbox
          label={sample.remind}
          checked={all}
          indeterminate={!all}
          onChange={() => {
            setAll(true)
          }}
        />
      )
    }
    await render(<All />)
    expect(screen.getByRole('checkbox')).toBePartiallyChecked()
    await userEvent.press(screen.getByRole('checkbox'))
    expect(screen.getByRole('checkbox')).not.toBePartiallyChecked()
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('hand their row to a caller that asks for it by a ref', async () => {
    const checkbox = createRef<View>()
    const toggle = createRef<View>()
    await render(
      <>
        <Checkbox ref={checkbox} label={sample.remind} checked onChange={() => undefined} />
        <Switch ref={toggle} label={sample.share} checked onChange={() => undefined} />
      </>,
    )
    expect(checkbox.current).not.toBeNull()
    expect(toggle.current).not.toBeNull()
  })

  it('take no press out of their form, and say so', async () => {
    const onChange = jest.fn()
    await render(
      <>
        <Checkbox label={sample.remind} checked disabled onChange={onChange} />
        <Switch label={sample.share} checked={false} disabled onChange={onChange} />
      </>,
    )
    await userEvent.press(screen.getByRole('checkbox', { name: sample.remind }))
    await userEvent.press(screen.getByRole('switch', { name: sample.share }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByRole('switch')).toBeDisabled()
    // Disabled is for a control out of its form alone, which a test names.
    expect(
      [...violations(screen.getByRole('checkbox')), ...violations(screen.getByRole('switch'))].map(
        ({ rule }) => rule,
      ),
    ).toEqual(['never-disabled', 'never-disabled'])
    expectAccessible(screen.root, { outOfForm: [sample.remind, sample.share] })
  })

  it.each(['light', 'dark'] as const)(
    'grow with the reader’s text, mark and target alike, in the %s theme',
    async (theme) => {
      await render(<Both />, { scale: 2, theme })
      expect(styleOf('remind').minHeight).toBe(88)
      const [, box] = elementsOf(screen.getByTestId('remind'))
      expect(StyleSheet.flatten(box?.props.style as StyleProp<ViewStyle>)).toMatchObject({
        width: 48,
        height: 48,
        backgroundColor: nativeThemes[theme].color['input-bg'],
      })
      expectAccessible()
    },
  )
})

describe('a radio group', () => {
  function Repeats({ onChange }: { readonly onChange?: (value: string) => void }) {
    const [value, setValue] = useState<string | undefined>('month')
    return (
      <RadioGroup
        label={sample.repeats}
        value={value}
        options={intervals}
        onChange={(next) => {
          onChange?.(next)
          setValue(next)
        }}
      />
    )
  }

  it('is a group named by its label, which is drawn and read', async () => {
    await render(<Repeats />)
    const group = screen.getByLabelText(sample.repeats)
    expect(group.props.accessibilityRole).toBe('radiogroup')
    expect(screen.getByText(sample.repeats)).toBeOnTheScreen()
    expect(screen.getAllByRole('radio')).toHaveLength(intervals.length)
    expectAccessible()
  })

  it('chooses one, and tells its owner of a change alone', async () => {
    const onChange = jest.fn()
    await render(<Repeats onChange={onChange} />)
    expect(screen.getByRole('radio', { name: intervals[1].label })).toBeChecked()
    expect(glyphIn('radio', intervals[1].label)).toBe(false)
    await userEvent.press(screen.getByRole('radio', { name: intervals[0].label }))
    expect(onChange.mock.calls).toEqual([['week']])
    expect(screen.getByRole('radio', { name: intervals[0].label })).toBeChecked()
    expect(screen.getByRole('radio', { name: intervals[1].label })).not.toBeChecked()
    // The one that is chosen is chosen already.
    await userEvent.press(screen.getByRole('radio', { name: intervals[0].label }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('has nothing chosen where its owner says nothing is', async () => {
    await render(
      <RadioGroup
        label={sample.repeats}
        value={undefined}
        options={intervals}
        onChange={() => undefined}
      />,
      { scale: 2 },
    )
    expect(screen.queryByRole('radio', { checked: true })).toBeNull()
    expectAccessible()
  })
})
