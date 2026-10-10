// The fields' contract (02-components §1; the web's `controls.test.tsx` is its twin): what a
// field is called, what is read with it, and what it takes.
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { catalogs } from '@household/i18n'
import { nativeThemes } from '@household/tokens/native'
import { screen, userEvent } from '@testing-library/react-native'
import { createRef } from 'react'
import { Platform, StyleSheet, type StyleProp, type TextInput, type TextStyle } from 'react-native'
import { expectAccessible, violations } from '../test/a11y.ts'
import { render } from '../test/render.tsx'
import { sample } from './controls.fixtures.ts'
import { PasswordField, TextArea, TextField } from './Field.tsx'

const required = catalogs.en['ui.field.required']
const show = catalogs.en['ui.password.show']

function styleOf(label: string): TextStyle {
  return StyleSheet.flatten(screen.getByLabelText(label).props.style as StyleProp<TextStyle>)
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a text field', () => {
  it('is named by its label, and its help is read with it', async () => {
    await render(<TextField label={sample.value} help={sample.help} />)
    const input = screen.getByLabelText(sample.value)
    expect(input.props.accessibilityHint).toBe(sample.help)
    // The label is drawn, and read once: as the field's name, and not again beside it.
    expect(screen.getByText(sample.value, { includeHiddenElements: true })).toBeOnTheScreen()
    expect(screen.queryByText(sample.value)).toBeNull()
    expect(screen.getByText(sample.help)).toBeOnTheScreen()
    expectAccessible()
  })

  it('states an error in words beside the field, with its glyph, and it is read with the field', async () => {
    await render(<TextField label={sample.value} help={sample.help} error={sample.low} />)
    const input = screen.getByLabelText(sample.value)
    expect(input.props.accessibilityHint).toBe(`${sample.help} ${sample.low}`)
    expect(screen.getByText(sample.low)).toBeOnTheScreen()
    // Never the edge alone: the sentence stands beside it, and a drawing before the sentence.
    expect(styleOf(sample.value).borderColor).toBe(nativeThemes.light.color.danger)
    const sentence = screen.getByText(sample.low)
    expect(sentence.parent?.children[0]).toHaveProperty('type', 'RNSVGSvgView')
    expectAccessible()
  })

  it('says a required field is required in a word, drawn and in its name', async () => {
    await render(<TextField label={sample.value} required />)
    expect(screen.getByLabelText(`${sample.value}, ${required}`)).toBeOnTheScreen()
    expect(
      screen.getByText(new RegExp(required), { includeHiddenElements: true }),
    ).toBeOnTheScreen()
    expectAccessible()
  })

  it('takes what is typed, in the app’s own type at the reader’s scale', async () => {
    const onChangeText = jest.fn()
    await render(<TextField label={sample.value} numeric onChangeText={onChangeText} />, {
      scale: 2,
    })
    const input = screen.getByLabelText(sample.value)
    await userEvent.type(input, '18')
    expect(onChangeText.mock.calls).toEqual([['1'], ['18']])
    // The system's scaling is off, as the app's `Text` has it: the two would multiply.
    expect(input.props.allowFontScaling).toBe(false)
    expect(styleOf(sample.value)).toMatchObject({
      fontSize: 32,
      minHeight: 88,
      fontFamily: nativeThemes.light.type.num.fontFamily,
    })
    expectAccessible()
  })

  it('tells read-only from out of its form: one is read as it is, the other says it takes nothing', async () => {
    const view = await render(<TextField label={sample.value} readOnly value="18 116,0" />)
    const shown = screen.getByLabelText(sample.value)
    expect(shown.props.editable).toBe(false)
    // Not said to be unavailable: it is a value to read, and is not out of anything.
    expect(shown.props.accessibilityState).toEqual({})
    expect(styleOf(sample.value)).toMatchObject({
      backgroundColor: nativeThemes.light.color['surface-sunken'],
      color: nativeThemes.light.color['text-primary'],
    })
    expectAccessible()
    await view.unmount()

    await render(<TextField label={sample.value} disabled value="18 116,0" />)
    const out = screen.getByLabelText(sample.value)
    expect(out.props.editable).toBe(false)
    expect(out.props.accessibilityState).toEqual({ disabled: true })
    expect(styleOf(sample.value).color).toBe(nativeThemes.light.color['text-disabled'])
    // Disabled is for a control out of its form alone, which a test names.
    expect(violations(out).map(({ rule }) => rule)).toEqual(['never-disabled'])
    expectAccessible(screen.root, { outOfForm: [sample.value] })
  })

  it('shows where a keyboard’s focus is, and tells its owner of it', async () => {
    const onFocus = jest.fn()
    const onBlur = jest.fn()
    await render(<TextField label={sample.value} onFocus={onFocus} onBlur={onBlur} />)
    expect(styleOf(sample.value).outlineWidth).toBeUndefined()
    await userEvent.type(screen.getByLabelText(sample.value), '1', { skipBlur: true })
    expect(styleOf(sample.value)).toMatchObject({
      outlineWidth: 2,
      outlineColor: nativeThemes.light.color.focus,
    })
    expect(onFocus).toHaveBeenCalledTimes(1)
    expect(onBlur).not.toHaveBeenCalled()
  })

  it('hands its control to a caller that asks for it by a ref', async () => {
    const ref = createRef<TextInput>()
    await render(<TextField label={sample.value} ref={ref} />)
    expect(ref.current?.props).toMatchObject({ accessibilityLabel: sample.value })
  })

  it('is tied to its drawn label on Android, which reads a filled field by its text', async () => {
    jest.replaceProperty(Platform, 'OS', 'android')
    await render(<TextField label={sample.value} required value="18" />)
    const input = screen.getByLabelText(new RegExp(sample.value))
    expect(input.props.accessibilityLabel).toBeUndefined()
    // The label is the drawn text, the required word in it, and so must be read.
    const label = screen.getByText(new RegExp(`^${sample.value}`))
    expect(label).toHaveTextContent(new RegExp(required))
    expect(input.props.accessibilityLabelledBy).toBe(label.props.nativeID)
    expectAccessible()
  })
})

describe('a password field', () => {
  it('hides what is typed until its member asks to see it, and says which it is', async () => {
    await render(<PasswordField label={sample.password} autoComplete="current-password" />)
    const input = screen.getByLabelText(sample.password)
    expect(input.props).toMatchObject({
      secureTextEntry: true,
      autoCapitalize: 'none',
      autoCorrect: false,
      autoComplete: 'current-password',
    })
    const toggle = screen.getByRole('switch', { name: show })
    expect(toggle).not.toBeChecked()
    await userEvent.press(toggle)
    expect(screen.getByLabelText(sample.password).props.secureTextEntry).toBe(false)
    expect(screen.getByRole('switch', { name: show })).toBeChecked()
    await userEvent.press(screen.getByRole('switch', { name: show }))
    expect(screen.getByLabelText(sample.password).props.secureTextEntry).toBe(true)
    expectAccessible()
  })

  it('is as large a target at 200 % as any other, its toggle too', async () => {
    await render(<PasswordField label={sample.password} error={sample.low} />, { scale: 2 })
    expect(screen.getByLabelText(sample.password).props.accessibilityHint).toBe(sample.low)
    expectAccessible()
  })
})

describe('a text area', () => {
  it('is a field as any other, of several lines, as tall as what is typed', async () => {
    await render(<TextArea label={sample.note} error={sample.low} />)
    const area = screen.getByLabelText(sample.note)
    expect(area.props.multiline).toBe(true)
    expect(area.props.accessibilityHint).toBe(sample.low)
    const style = styleOf(sample.note)
    // Three lines to begin with: a least height, and no height.
    expect(style.minHeight).toBeGreaterThan(nativeThemes.light.type.body.lineHeight * 3)
    expect(style.height).toBeUndefined()
    expectAccessible()
  })
})
